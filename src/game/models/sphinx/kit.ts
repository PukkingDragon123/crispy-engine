// Sculpting kit for the Sphinx colossus and the river gate: signed distance
// fields in metres (rig space), a dense occupancy grid that writes only what
// the mesher needs (surface cells painted with an occupancy normal, interior
// cells as plain fill) and routes every cell to a rig part, so one continuous
// body can be cut into parts that stay sealed (buried plugs) when they bend.
//
// Grid convention (matches the voxel mirror plane x = 0): cell i is centred on
// x = i / S, cell j on y = (j + 0.5) / S, cell k on z = (k + 0.5) / S. A part
// pivot at metric point m is the voxel coordinate P(m) = [m.x S + 0.5, m.y S, m.z S].
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, SocketSpec, V3 } from '../../../engine/voxel/Rig';

export { VoxelModel, VF };
export type { V3, RigSpec };

export type Field = (x: number, y: number, z: number) => number;
/** packed colour (flags << 24 | rgb), or -1 to leave the cell empty */
export type Paint = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

// ----------------------------------------------------------------------------- math
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function sstep(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export function h3(x: number, y: number, z: number, s: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** smooth value noise on a unit lattice, 0..1 */
export function vn(x: number, y: number, z: number, s: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const a = h3(ix, iy, iz, s), b = h3(ix + 1, iy, iz, s), c = h3(ix, iy + 1, iz, s), d = h3(ix + 1, iy + 1, iz, s);
  const e = h3(ix, iy, iz + 1, s), f = h3(ix + 1, iy, iz + 1, s), g = h3(ix, iy + 1, iz + 1, s), h = h3(ix + 1, iy + 1, iz + 1, s);
  const ab = a + (b - a) * fx, cd = c + (d - c) * fx, ef = e + (f - e) * fx, gh = g + (h - g) * fx;
  const lo = ab + (cd - ab) * fy, hi = ef + (gh - ef) * fy;
  return lo + (hi - lo) * fz;
}
/** 3D cellular borders: f2 - f1 of the nearest jittered cell centres (0 on a border) */
export function cellEdge(x: number, y: number, z: number, s: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let f1 = 9, f2 = 9;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (let c = -1; c <= 1; c++) {
        const cx = ix + a, cy = iy + b, cz = iz + c;
        const dx = cx + h3(cx, cy, cz, s) - x, dy = cy + h3(cx, cy, cz, s + 1) - y, dz = cz + h3(cx, cy, cz, s + 2) - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
  return Math.sqrt(f2) - Math.sqrt(f1);
}
export function mix(a: number, b: number, t: number) {
  t = clamp01(t);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  return (Math.round(ar + (((b >> 16) & 255) - ar) * t) << 16) | (Math.round(ag + (((b >> 8) & 255) - ag) * t) << 8) | Math.round(ab + ((b & 255) - ab) * t);
}
export const pk = (c: number, f: number = VF.SOLID) => (((f | VF.SOLID) << 24) | (c & 0xffffff)) >>> 0;
export const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
export const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mirX = (v: V3): V3 => [-v[0], v[1], v[2]];

// ----------------------------------------------------------------------------- distance fields (metres)
export function ell(px: number, py: number, pz: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) {
  const x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz;
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const k1 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  return k1 < 1e-6 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
export const ellV = (px: number, py: number, pz: number, c: V3, r: V3) => ell(px, py, pz, c[0], c[1], c[2], r[0], r[1], r[2]);
/** capsule between a and b whose radius lerps from ra to rb */
export function cone(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const t = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1));
  const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
}
export const coneV = (px: number, py: number, pz: number, a: V3, b: V3, ra: number, rb: number) => cone(px, py, pz, a[0], a[1], a[2], b[0], b[1], b[2], ra, rb);
/** rounded box */
export function rbox(px: number, py: number, pz: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, r: number) {
  const qx = Math.abs(px - cx) - hx + r, qy = Math.abs(py - cy) - hy + r, qz = Math.abs(pz - cz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
/** a polyline tube (radius per vertex) */
export function tube(px: number, py: number, pz: number, pts: V3[], r: number[]) {
  let d = 1e9;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, coneV(px, py, pz, pts[i], pts[i + 1], r[i], r[i + 1]));
  return d;
}
export function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

// ----------------------------------------------------------------------------- the grid
export interface Route {
  /** the part that owns a cell */
  part(x: number, y: number, z: number): VoxelModel | null;
  /** an extra part that also gets a buried interior cell (seals a joint when it bends) */
  plug?(x: number, y: number, z: number): VoxelModel | null;
}

export class Grid {
  readonly i0: number;
  readonly j0: number;
  readonly k0: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly occ: Uint8Array;
  constructor(readonly S: number, box: number[]) {
    const s = S;
    this.i0 = Math.floor(box[0] * s) - 2;
    this.j0 = Math.floor(box[1] * s) - 2;
    this.k0 = Math.floor(box[2] * s) - 2;
    this.nx = Math.ceil(box[3] * s) + 3 - this.i0;
    this.ny = Math.ceil(box[4] * s) + 3 - this.j0;
    this.nz = Math.ceil(box[5] * s) + 3 - this.k0;
    this.occ = new Uint8Array(this.nx * this.ny * this.nz);
  }
  X(i: number) {
    return (this.i0 + i) / this.S;
  }
  Y(j: number) {
    return (this.j0 + j + 0.5) / this.S;
  }
  Z(k: number) {
    return (this.k0 + k + 0.5) / this.S;
  }
  /**
   * Occupy every cell inside f. Coarse 4-cell blocks are tested at their centre first: a block far
   * outside (or deep inside) the solid is skipped (or filled) whole, so only cells near the surface
   * pay for the full field.
   */
  fill(f: Field) {
    const { nx, ny, nz, occ } = this;
    const B = 4, margin = (B * 0.87) / this.S + 0.5;
    for (let k0 = 1; k0 < nz - 1; k0 += B)
      for (let j0 = 1; j0 < ny - 1; j0 += B)
        for (let i0 = 1; i0 < nx - 1; i0 += B) {
          const i1 = Math.min(nx - 1, i0 + B), j1 = Math.min(ny - 1, j0 + B), k1 = Math.min(nz - 1, k0 + B);
          const c = f(this.X((i0 + i1 - 1) / 2), this.Y((j0 + j1 - 1) / 2), this.Z((k0 + k1 - 1) / 2));
          if (c > margin) continue;
          const all = c < -margin;
          for (let k = k0; k < k1; k++) {
            const z = this.Z(k);
            for (let j = j0; j < j1; j++) {
              const y = this.Y(j);
              let n = i0 + nx * (j + ny * k);
              for (let i = i0; i < i1; i++, n++) if (all || f(this.X(i), y, z) < 0) occ[n] = 1;
            }
          }
        }
  }
  /** add cells inside f (union) */
  carveIn(f: Field) {
    this.fill(f);
  }
  /** remove cells inside f */
  carveOut(f: Field) {
    const { nx, ny, nz, occ } = this;
    for (let k = 1; k < nz - 1; k++) {
      const z = this.Z(k);
      for (let j = 1; j < ny - 1; j++) {
        const y = this.Y(j);
        let n = 1 + nx * (j + ny * k);
        for (let i = 1; i < nx - 1; i++, n++) if (occ[n] && f(this.X(i), y, z) < 0) occ[n] = 0;
      }
    }
  }
  /**
   * Write the solid into its parts. Surface cells (an empty 26-neighbour) are painted with an occupancy
   * normal; interior cells get `inner` (or a plain fill) so the mesher never builds inner faces.
   */
  emit(route: Route, paint: Paint, inner?: (x: number, y: number, z: number) => number) {
    const { nx, ny, nz, occ } = this;
    const sxy = nx * ny;
    for (let k = 1; k < nz - 1; k++)
      for (let j = 1; j < ny - 1; j++)
        for (let i = 1; i < nx - 1; i++) {
          const n = i + nx * (j + ny * k);
          if (!occ[n]) continue;
          const x = this.X(i), y = this.Y(j), z = this.Z(k);
          const m = route.part(x, y, z);
          if (!m) continue;
          const vi = this.i0 + i, vj = this.j0 + j, vk = this.k0 + k;
          let surf = false;
          for (let dz = -1; dz <= 1 && !surf; dz++)
            for (let dy = -1; dy <= 1 && !surf; dy++)
              for (let dx = -1; dx <= 1; dx++)
                if (!occ[n + dx + nx * dy + sxy * dz]) {
                  surf = true;
                  break;
                }
          if (!surf) {
            const v = inner ? inner(x, y, z) : pk(0x4e3c2a);
            m.set(vi, vj, vk, v & 0xffffff, v >>> 24 || VF.SOLID);
            const pm = route.plug?.(x, y, z);
            if (pm && pm !== m) pm.set(vi, vj, vk, v & 0xffffff, v >>> 24 || VF.SOLID);
            continue;
          }
          let ax = 0, ay = 0, az = 0;
          for (let dz = -2; dz <= 2; dz++) {
            const kk = k + dz;
            if (kk < 0 || kk >= nz) continue;
            for (let dy = -2; dy <= 2; dy++) {
              const jj = j + dy;
              if (jj < 0 || jj >= ny) continue;
              for (let dx = -2; dx <= 2; dx++) {
                const ii = i + dx;
                if (ii < 0 || ii >= nx) continue;
                if (!occ[ii + nx * (jj + ny * kk)]) {
                  ax += dx;
                  ay += dy;
                  az += dz;
                }
              }
            }
          }
          const l = Math.hypot(ax, ay, az) || 1;
          const v = paint(x, y, z, ax / l, ay / l, az / l);
          if (v < 0) continue;
          m.set(vi, vj, vk, v & 0xffffff, v >>> 24 || VF.SOLID);
        }
  }
}

export function bounds(pts: V3[], r: number): number[] {
  const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (const p of pts)
    for (let a = 0; a < 3; a++) {
      b[a] = Math.min(b[a], p[a] - r);
      b[a + 3] = Math.max(b[a + 3], p[a] + r);
    }
  return b;
}

/** march from `from` along `dir` until the field goes inside; returns the surface point (or null) */
export function castOnto(f: Field, from: V3, dir: V3, max = 30, step = 0.04): V3 | null {
  const d = norm(dir);
  for (let t = 0; t < max; t += step) {
    const p: V3 = [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t];
    if (f(p[0], p[1], p[2]) < 0) return p;
  }
  return null;
}

// ----------------------------------------------------------------------------- rig builder
export class SRig {
  parts: { name: string; parent?: string; pivot: V3; model: VoxelModel }[] = [];
  sockets: Record<string, SocketSpec> = {};
  constructor(public name: string, public S: number) {}
  /** voxel coordinates of a metric point */
  P(m: V3): V3 {
    return [m[0] * this.S + 0.5, m[1] * this.S, m[2] * this.S];
  }
  part(name: string, parent: string | undefined, pivot: V3): VoxelModel {
    const model = new VoxelModel(name);
    this.parts.push({ name, parent, pivot: this.P(pivot), model });
    return model;
  }
  m(name: string): VoxelModel {
    const p = this.parts.find((q) => q.name === name);
    if (!p) throw new Error(`[${this.name}] no part ${name}`);
    return p.model;
  }
  socket(name: string, part: string, at: V3) {
    this.sockets[name] = { part, at: this.P(at) };
  }
  build(meta: Record<string, unknown>): RigSpec {
    const parts: PartSpec[] = this.parts.map((p) => {
      // the root's attach drops the half-voxel column shift so rig-local metres equal metric metres
      const attach: V3 = p.parent ? [p.pivot[0], p.pivot[1], p.pivot[2]] : [p.pivot[0] - 0.5, p.pivot[1], p.pivot[2]];
      if (p.model.count === 0) p.model.set(Math.floor(p.pivot[0]), Math.floor(p.pivot[1]), Math.floor(p.pivot[2]), 0x4e3c2a);
      return { name: p.name, model: p.model, pivot: p.pivot, parent: p.parent, attach };
    });
    return { name: this.name, voxelSize: 1 / this.S, parts, sockets: this.sockets, meta };
  }
}
