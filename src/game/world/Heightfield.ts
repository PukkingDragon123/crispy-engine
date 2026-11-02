// Heightfield = static base terrain + animated "stamps" (blocker walls that collapse,
// temples that rise, dunes that shift). Physics samples the smooth field; the
// mesher quantizes it into voxel columns.

export const MAT = {
  SAND: 0,
  SAND_DARK: 1,
  RED_SAND: 2,
  ROCK: 3,
  DARK_ROCK: 4,
  TILE: 5,
  DIRT: 6,
  GRASS: 7,
  MUD: 8,
  BONE: 9,
  GOLD: 10,
  CRYSTAL: 11,
} as const;
export type MatId = (typeof MAT)[keyof typeof MAT];

export interface Stamp {
  id: string;
  /** world-space bounds (meters) */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** height delta function (meters), evaluated in world space */
  fn: (x: number, z: number) => number;
  /** material override where delta is meaningful */
  mat?: MatId | ((x: number, z: number, dh: number) => MatId | -1);
  weight: number;
  /** if true, replace height instead of add: h = lerp(h, fn, weight) */
  replace?: boolean;
  /** with replace: never lower terrain (h = lerp(h, max(h, fn), weight)) */
  max?: boolean;
}

export class Heightfield {
  /** cells per meter = 1 / res */
  readonly res: number;
  readonly n: number; // cells per side
  readonly size: number; // meters
  base: Float32Array;
  baseMat: Uint8Array;
  h: Float32Array;
  mat: Uint8Array;
  stamps: Stamp[] = [];
  waterLevel = -1000;
  /** listeners notified with dirty rect (world meters) */
  onDirty: ((x0: number, z0: number, x1: number, z1: number) => void)[] = [];

  constructor(size: number, res = 1) {
    this.size = size;
    this.res = res;
    this.n = Math.round(size / res) + 1;
    const N = this.n * this.n;
    this.base = new Float32Array(N);
    this.baseMat = new Uint8Array(N);
    this.h = new Float32Array(N);
    this.mat = new Uint8Array(N);
  }

  idx(i: number, j: number) {
    return i + j * this.n;
  }

  /** world meters -> grid coordinates (world origin = grid 0,0) */
  heightAt(x: number, z: number): number {
    const r = this.res;
    let gx = x / r,
      gz = z / r;
    const n1 = this.n - 1;
    if (gx < 0) gx = 0;
    else if (gx > n1 - 0.001) gx = n1 - 0.001;
    if (gz < 0) gz = 0;
    else if (gz > n1 - 0.001) gz = n1 - 0.001;
    const i = Math.floor(gx),
      j = Math.floor(gz);
    const fx = gx - i,
      fz = gz - j;
    const n = this.n,
      H = this.h;
    const a = H[i + j * n],
      b = H[i + 1 + j * n],
      c = H[i + (j + 1) * n],
      d = H[i + 1 + (j + 1) * n];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  /** C1-continuous Catmull-Rom bicubic height (board physics: no slope kinks at grid lines) */
  heightSmooth(x: number, z: number): number {
    const r = this.res, n = this.n, H = this.h;
    let gx = x / r, gz = z / r;
    const m = n - 2.001;
    if (gx < 1) gx = 1; else if (gx > m) gx = m;
    if (gz < 1) gz = 1; else if (gz > m) gz = m;
    const i = Math.floor(gx), j = Math.floor(gz);
    const tx = gx - i, tz = gz - j;
    const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
      p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const row = (jj: number) => {
      const b = jj * n;
      return cr(H[b + i - 1], H[b + i], H[b + i + 1], H[b + i + 2], tx);
    };
    return cr(row(j - 1), row(j), row(j + 1), row(j + 2), tz);
  }

  /** smooth-ish normal via central differences (into out array [x,y,z]) */
  normalAt(x: number, z: number, out: { x: number; y: number; z: number }, eps = 0.6) {
    const hl = this.heightSmooth(x - eps, z),
      hr = this.heightSmooth(x + eps, z);
    const hd = this.heightSmooth(x, z - eps),
      hu = this.heightSmooth(x, z + eps);
    let nx = hl - hr,
      ny = 2 * eps,
      nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l;
    out.y = ny / l;
    out.z = nz / l;
    return out;
  }

  matAt(x: number, z: number): number {
    const i = Math.max(0, Math.min(this.n - 1, Math.round(x / this.res)));
    const j = Math.max(0, Math.min(this.n - 1, Math.round(z / this.res)));
    return this.mat[i + j * this.n];
  }

  /** slope magnitude (rise over run) */
  slopeAt(x: number, z: number) {
    const e = 0.75;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  inBounds(x: number, z: number, margin = 0) {
    return x >= margin && z >= margin && x <= this.size - margin && z <= this.size - margin;
  }

  addStamp(s: Stamp) {
    this.stamps.push(s);
    this.recompute(s.x0, s.z0, s.x1, s.z1);
    return s;
  }
  getStamp(id: string) {
    return this.stamps.find((s) => s.id === id);
  }
  setStampWeight(id: string, w: number) {
    const s = this.getStamp(id);
    if (!s) return;
    if (Math.abs(s.weight - w) < 1e-4) return;
    s.weight = w;
    this.recompute(s.x0, s.z0, s.x1, s.z1);
  }

  /** recompute final heights in a world rect from base + stamps */
  recompute(x0: number, z0: number, x1: number, z1: number, notify = true) {
    const r = this.res,
      n = this.n;
    const i0 = Math.max(0, Math.floor(x0 / r)),
      i1 = Math.min(n - 1, Math.ceil(x1 / r));
    const j0 = Math.max(0, Math.floor(z0 / r)),
      j1 = Math.min(n - 1, Math.ceil(z1 / r));
    const active = this.stamps.filter((s) => s.weight > 0.0001 && !(s.x1 < x0 || s.x0 > x1 || s.z1 < z0 || s.z0 > z1));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = i + j * n;
        let h = this.base[k];
        let m = this.baseMat[k];
        const x = i * r,
          z = j * r;
        for (const s of active) {
          if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
          const v = s.fn(x, z);
          if (s.replace) {
            if (Number.isNaN(v)) continue;
            const tv = s.max ? Math.max(v, h) : v;
            h = h + (tv - h) * s.weight;
          } else {
            h += v * s.weight;
          }
          if (s.mat !== undefined && s.weight > 0.35) {
            const mm = typeof s.mat === 'function' ? s.mat(x, z, v) : Math.abs(v) > 0.2 || s.replace ? s.mat : -1;
            if (mm >= 0) m = mm as number;
          }
        }
        this.h[k] = h;
        this.mat[k] = m;
      }
    }
    if (notify) for (const f of this.onDirty) f(i0 * r, j0 * r, i1 * r, j1 * r);
  }

  /** copy base -> final for whole map (after generation) */
  finalize() {
    this.h.set(this.base);
    this.mat.set(this.baseMat);
    if (this.stamps.length) this.recompute(0, 0, this.size, this.size, false);
  }

  /** ray march against heightfield; returns distance or -1 */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, step = 0.5): number {
    let t = 0;
    let prevAbove = oy - this.heightAt(ox, oz);
    if (prevAbove < 0) return 0;
    while (t < maxDist) {
      const s = Math.max(step, prevAbove * 0.5);
      const nt = Math.min(maxDist, t + s);
      const x = ox + dx * nt,
        y = oy + dy * nt,
        z = oz + dz * nt;
      const above = y - this.heightAt(x, z);
      if (above <= 0) {
        // refine
        let a = t,
          b = nt;
        for (let k = 0; k < 6; k++) {
          const m = (a + b) / 2;
          const yy = oy + dy * m;
          if (yy - this.heightAt(ox + dx * m, oz + dz * m) > 0) a = m;
          else b = m;
        }
        return (a + b) / 2;
      }
      prevAbove = above;
      t = nt;
      if (t >= maxDist) break;
    }
    return -1;
  }
}
