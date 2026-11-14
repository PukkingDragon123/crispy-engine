// The Nile's channel network: the main river and its side channels as dense
// centre lines (2.5 m spacing) with half width, depth, surface speed and
// roughness (swell size) per point, rasterised into a 2 m lookup grid (nearest
// channel segment within 72 m of a bank) and an 8 m grid of distance to the
// nearest bank (the valley profile reaches ~300 m). Generation (NileGen) sculpts
// the terrain from it; the runtime water (NileWater) reads flow, swells and the
// river's own (along, across) coordinates from it.

export interface NileChannel {
  id: number;
  main: boolean;
  n: number;
  x: Float32Array;
  z: Float32Array;
  /** cumulative length (m) */
  s: Float32Array;
  /** half width (m) */
  hw: Float32Array;
  /** depth at the centre line (m below the surface) */
  depth: Float32Array;
  /** surface speed at the centre line (m/s) */
  speed: Float32Array;
  /** swell size multiplier (0 calm .. ~1.6 rapids) */
  rough: Float32Array;
}

export interface RiverHit {
  ch: number;
  main: boolean;
  /** along the channel (m), across it (m, + = left of the flow) */
  s: number;
  u: number;
  /** distance to the centre line, signed distance to the bank (< 0 inside) */
  d: number;
  e: number;
  hw: number;
  depth: number;
  speed: number;
  rough: number;
  /** unit flow direction */
  tx: number;
  tz: number;
}

const FINE = 2;
const COARSE = 8;
/** fine grid reach past the bank (m) */
export const FINE_REACH = 72;
const COARSE_REACH = 320;

export class RiverNet {
  readonly n: number;
  readonly cn: number;
  /** packed (channel << 20 | segment) of the nearest segment, -1 out of reach */
  private near: Int32Array;
  private fe: Float32Array;
  private ce: Float32Array;

  constructor(public size: number, public level: number, public channels: NileChannel[]) {
    const n = (this.n = Math.ceil(size / FINE) + 1);
    const cn = (this.cn = Math.ceil(size / COARSE) + 1);
    this.near = new Int32Array(n * n).fill(-1);
    this.fe = new Float32Array(n * n).fill(FINE_REACH);
    this.ce = new Float32Array(cn * cn).fill(COARSE_REACH);
    for (const c of channels) this.raster(c);
  }

  private raster(c: NileChannel) {
    const n = this.n, cn = this.cn;
    for (let k = 0; k < c.n - 1; k++) {
      const ax = c.x[k], az = c.z[k], bx = c.x[k + 1], bz = c.z[k + 1];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz || 1e-6;
      const h0 = c.hw[k], h1 = c.hw[k + 1];
      const pack = (c.id << 20) | k;
      // fine
      {
        const R = Math.max(h0, h1) + FINE_REACH;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R) / FINE)), i1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + R) / FINE));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R) / FINE)), j1 = Math.min(n - 1, Math.ceil((Math.max(az, bz) + R) / FINE));
        for (let j = j0; j <= j1; j++) {
          const pz = j * FINE;
          for (let i = i0; i <= i1; i++) {
            const px = i * FINE;
            let t = ((px - ax) * dx + (pz - az) * dz) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = ax + dx * t - px, ez = az + dz * t - pz;
            const e = Math.sqrt(ex * ex + ez * ez) - (h0 + (h1 - h0) * t);
            const o = i + j * n;
            if (e < this.fe[o]) {
              this.fe[o] = e;
              this.near[o] = pack;
            }
          }
        }
      }
      // coarse (bank distance only)
      if (k % 2 === 0 || k === c.n - 2) {
        const kb = Math.min(c.n - 1, k + 2);
        const bx2 = c.x[kb], bz2 = c.z[kb];
        const dx2 = bx2 - ax, dz2 = bz2 - az, l22 = dx2 * dx2 + dz2 * dz2 || 1e-6;
        const h2 = c.hw[kb];
        const R = Math.max(h0, h2) + COARSE_REACH;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx2) - R) / COARSE)), i1 = Math.min(cn - 1, Math.ceil((Math.max(ax, bx2) + R) / COARSE));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz2) - R) / COARSE)), j1 = Math.min(cn - 1, Math.ceil((Math.max(az, bz2) + R) / COARSE));
        for (let j = j0; j <= j1; j++) {
          const pz = j * COARSE;
          for (let i = i0; i <= i1; i++) {
            const px = i * COARSE;
            let t = ((px - ax) * dx2 + (pz - az) * dz2) / l22;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = ax + dx2 * t - px, ez = az + dz2 * t - pz;
            const e = Math.sqrt(ex * ex + ez * ez) - (h0 + (h2 - h0) * t);
            const o = i + j * cn;
            if (e < this.ce[o]) this.ce[o] = e;
          }
        }
      }
    }
  }

  /** signed distance to the nearest bank (m, < 0 in a channel), smooth (bilinear) */
  bankDist(x: number, z: number): number {
    const gx = x / FINE, gz = z / FINE;
    const n = this.n;
    const i = Math.floor(gx), j = Math.floor(gz);
    if (i >= 0 && j >= 0 && i < n - 1 && j < n - 1) {
      const fx = gx - i, fz = gz - j, o = i + j * n;
      const a = this.fe[o], b = this.fe[o + 1], c = this.fe[o + n], d = this.fe[o + n + 1];
      if (a < FINE_REACH - 4 && b < FINE_REACH - 4 && c < FINE_REACH - 4 && d < FINE_REACH - 4) return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
    }
    return this.coarseDist(x, z);
  }
  coarseDist(x: number, z: number): number {
    const cn = this.cn;
    let gx = x / COARSE, gz = z / COARSE;
    gx = Math.max(0, Math.min(cn - 1.001, gx));
    gz = Math.max(0, Math.min(cn - 1.001, gz));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, o = i + j * cn;
    const C = this.ce;
    return (C[o] * (1 - fx) + C[o + 1] * fx) * (1 - fz) + (C[o + cn] * (1 - fx) + C[o + cn + 1] * fx) * fz;
  }

  /** the nearest channel point (within the fine reach), null further out */
  hit(x: number, z: number, out: RiverHit): RiverHit | null {
    const n = this.n;
    const i = Math.round(x / FINE), j = Math.round(z / FINE);
    if (i < 0 || j < 0 || i >= n || j >= n) return null;
    const pk = this.near[i + j * n];
    if (pk < 0) return null;
    const c = this.channels[pk >>> 20];
    const k0 = pk & 0xfffff;
    let best = 1e9, bk = k0, bt = 0;
    for (let k = Math.max(0, k0 - 3); k <= Math.min(c.n - 2, k0 + 3); k++) {
      const ax = c.x[k], az = c.z[k], dx = c.x[k + 1] - ax, dz = c.z[k + 1] - az;
      const l2 = dx * dx + dz * dz || 1e-6;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + dx * t - x, ez = az + dz * t - z;
      const e = Math.sqrt(ex * ex + ez * ez) - (c.hw[k] + (c.hw[k + 1] - c.hw[k]) * t);
      if (e < best) {
        best = e;
        bk = k;
        bt = t;
      }
    }
    const k = bk, t = bt;
    const ax = c.x[k], az = c.z[k], dx = c.x[k + 1] - ax, dz = c.z[k + 1] - az;
    const L = Math.sqrt(dx * dx + dz * dz) || 1e-6;
    // a smooth tangent: blend toward the next segment's direction along the segment
    let tx = dx / L, tz = dz / L;
    const kn = t > 0.5 ? Math.min(c.n - 2, k + 1) : Math.max(0, k - 1);
    if (kn !== k) {
      const nx = c.x[kn + 1] - c.x[kn], nz = c.z[kn + 1] - c.z[kn], nl = Math.sqrt(nx * nx + nz * nz) || 1e-6;
      const w = Math.abs(t - 0.5);
      tx = tx * (1 - w) + (nx / nl) * w;
      tz = tz * (1 - w) + (nz / nl) * w;
      const tl = Math.sqrt(tx * tx + tz * tz) || 1;
      tx /= tl;
      tz /= tl;
    }
    const px = ax + dx * t, pz = az + dz * t;
    const u = (x - px) * -tz + (z - pz) * tx;
    const L1 = (a: Float32Array) => a[k] + (a[k + 1] - a[k]) * t;
    out.ch = c.id;
    out.main = c.main;
    out.s = c.s[k] + L * t;
    out.u = u;
    out.d = Math.abs(u);
    out.hw = L1(c.hw);
    out.e = out.d - out.hw;
    out.depth = L1(c.depth);
    out.speed = L1(c.speed);
    out.rough = L1(c.rough);
    out.tx = tx;
    out.tz = tz;
    return out;
  }

  /** a point on a channel at arc length s (clamped), with its unit tangent */
  pointAt(ch: number, s: number, out: { x: number; z: number; tx: number; tz: number; hw: number }) {
    const c = this.channels[ch];
    const S = c.s;
    s = Math.max(0, Math.min(S[c.n - 1], s));
    let lo = 0, hi = c.n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (S[m] <= s) lo = m;
      else hi = m;
    }
    const seg = S[hi] - S[lo] || 1e-6;
    const t = (s - S[lo]) / seg;
    out.x = c.x[lo] + (c.x[hi] - c.x[lo]) * t;
    out.z = c.z[lo] + (c.z[hi] - c.z[lo]) * t;
    out.tx = (c.x[hi] - c.x[lo]) / seg;
    out.tz = (c.z[hi] - c.z[lo]) / seg;
    out.hw = c.hw[lo] + (c.hw[hi] - c.hw[lo]) * t;
    return out;
  }
}

// ------------------------------------------------------------------ building channels
/** resample a polyline to even spacing */
export function resample(pts: { x: number; z: number }[], step: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [{ ...pts[0] }];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    let d = step - carry;
    while (d <= L) {
      const t = d / L;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      d += step;
    }
    carry = L - (d - step);
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(out[out.length - 1].x - last.x, out[out.length - 1].z - last.z) > step * 0.3) out.push({ ...last });
  return out;
}

/** centripetal-ish Catmull-Rom through the waypoints, sampled every `step` m */
export function spline(way: { x: number; z: number }[], step: number): { x: number; z: number }[] {
  const P = [way[0], ...way, way[way.length - 1]];
  const out: { x: number; z: number }[] = [];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const L = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n = Math.max(2, Math.ceil(L / (step * 0.5)));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push({ ...way[way.length - 1] });
  return resample(out, step);
}

/** a channel from a polyline and per-point profile callbacks (s = arc length, k = 0..1) */
export function makeChannel(
  id: number,
  main: boolean,
  pts: { x: number; z: number }[],
  prof: (s: number, k: number, x: number, z: number) => { hw: number; depth: number; speed: number; rough: number }
): NileChannel {
  const n = pts.length;
  const c: NileChannel = {
    id, main, n,
    x: new Float32Array(n), z: new Float32Array(n), s: new Float32Array(n),
    hw: new Float32Array(n), depth: new Float32Array(n), speed: new Float32Array(n), rough: new Float32Array(n),
  };
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    c.x[i] = pts[i].x;
    c.z[i] = pts[i].z;
    c.s[i] = s;
  }
  for (let i = 0; i < n; i++) {
    const p = prof(c.s[i], c.s[i] / Math.max(1, s), c.x[i], c.z[i]);
    c.hw[i] = p.hw;
    c.depth[i] = p.depth;
    c.speed[i] = p.speed;
    c.rough[i] = p.rough;
  }
  return c;
}

// ------------------------------------------------------------------ shared swell maths (CPU twin of the water shader)
export const fract = (v: number) => v - Math.floor(v);
/** the shader's hash (same arithmetic, so CPU and GPU agree on lava crust plates) */
export function hash2(x: number, y: number) {
  let p0 = fract(x * 0.1031), p1 = fract(y * 0.1031), p2 = fract(x * 0.1031);
  const d = p0 * (p1 + 33.33) + p1 * (p2 + 33.33) + p2 * (p0 + 33.33);
  p0 += d;
  p1 += d;
  p2 += d;
  return fract((p0 + p1) * p2);
}
const sm = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** asymmetric swell: a long gentle back (upstream side), a steep front (downstream) */
export function swellProfile(ph: number) {
  const f = ph - Math.floor(ph);
  return f < 0.74 ? -1 + 2 * sm(f / 0.74) : 1 - 2 * sm((f - 0.74) / 0.26);
}
/** wave constants (shared with the shader through uniforms) */
export const SWELL = {
  /** main swell: wavelength (m), speed (m/s), amplitude (m) */
  l1: 19, c1: 4.2, a1: 0.42,
  /** rapids add standing waves (fixed in place) */
  l0: 13, a0: 0.55,
  /** diagonal chop */
  l2: 7.5, c2: 2.6, a2: 0.09,
  l3: 4.3, c3: 1.9, a3: 0.05,
};
/** swell height (m) at river coords s, u for amplitude `amp`, standing-wave share `stand`, time t */
export function swellAt(s: number, u: number, amp: number, stand: number, t: number) {
  if (amp <= 0.001) return 0;
  const S = SWELL;
  const p1 = swellProfile((s - S.c1 * t) / S.l1 + u * 0.011);
  const p0 = stand > 0.001 ? swellProfile(s / S.l0 + Math.sin(u * 0.21) * 0.18) * stand : 0;
  const ch = Math.sin(((s * 0.8 + u * 0.6) / S.l2 - (S.c2 / S.l2) * t) * 6.2831853) * S.a2 + Math.sin(((s * 0.55 - u * 0.83) / S.l3 - (S.c3 / S.l3) * t) * 6.2831853) * S.a3;
  return amp * (p1 * S.a1 + p0 * S.a0) + Math.min(1, amp * 1.5) * ch;
}
