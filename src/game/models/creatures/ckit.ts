// Creature kit for the meerkat colony and the giant jerboa (self-contained, so
// other workers' kits can change freely). Organic implicit sculpting (smooth
// unions of ellipsoids / tapered capsules), glossy modelled eyes, soft fur
// texture, cloth sheets and hand-thrown vessels.
//
// COORDINATES: geometric voxel units — voxel i spans [i, i+1) with its centre at
// i + 0.5. Bodies mirror across geometric x = 0 (voxel i <-> -1 - i, pivot
// x <-> -x). Every part of a rig is sculpted in ONE shared rig space, so a
// part's attach point equals its pivot.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, V3, PartSpec, SocketSpec } from '../../../engine/voxel/Rig';
import { hash3, noise } from '../../../engine/math/rand';

export { VoxelModel, VF };
export type { V3, RigSpec };
export type Col = number | ((x: number, y: number, z: number) => number | null);

// ================================================================ rig builder
interface CPart {
  name: string;
  parent?: string;
  pivot: V3;
  rest?: V3;
  model: VoxelModel;
}

export class CRig {
  parts: CPart[] = [];
  sockets: Record<string, SocketSpec> = {};
  constructor(public name: string, public vs: number) {}
  part(name: string, parent: string | undefined, pivot: V3, rest?: V3): VoxelModel {
    const model = new VoxelModel(name);
    this.parts.push({ name, parent, pivot, rest, model });
    return model;
  }
  m(name: string): VoxelModel {
    const p = this.parts.find((q) => q.name === name);
    if (!p) throw new Error(`[${this.name}] no part ${name}`);
    return p.model;
  }
  has(name: string) {
    return this.parts.some((q) => q.name === name);
  }
  pivotOf(name: string): V3 {
    const p = this.parts.find((q) => q.name === name);
    if (!p) throw new Error(`[${this.name}] no part ${name}`);
    return p.pivot;
  }
  socket(name: string, part: string, at: V3, rot?: V3) {
    this.sockets[name] = { part, at, rot };
  }
  /** mirror a left (+x) part into a new right part */
  mirror(src: string, dst: string, parent?: string) {
    const p = this.parts.find((q) => q.name === src);
    if (!p) throw new Error(`[${this.name}] no part ${src}`);
    const m = new VoxelModel(dst);
    p.model.forEach((x, y, z, c, f) => m.set(-1 - x, y, z, c, f));
    this.parts.push({ name: dst, parent: parent ?? p.parent, pivot: [-p.pivot[0], p.pivot[1], p.pivot[2]], rest: p.rest ? [p.rest[0], -p.rest[1], -p.rest[2]] : undefined, model: m });
    return m;
  }
  build(meta: Record<string, any> = {}): RigSpec {
    const parts: PartSpec[] = this.parts.map((p) => ({ name: p.name, model: p.model, pivot: p.pivot, parent: p.parent, attach: [p.pivot[0], p.pivot[1], p.pivot[2]], rest: p.rest }));
    for (const p of parts) if (p.model.count === 0) p.model.set(Math.floor(p.pivot[0]), Math.floor(p.pivot[1]), Math.floor(p.pivot[2]), 0x2a1a10);
    return { name: this.name, voxelSize: this.vs, parts, sockets: this.sockets, meta };
  }
}

// ================================================================ colour helpers
export const rgbOf = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
export function mixc(a: number, b: number, t: number) {
  const [ar, ag, ab] = rgbOf(a), [br, bg, bb] = rgbOf(b);
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return ((Math.round(ar + (br - ar) * k) << 16) | (Math.round(ag + (bg - ag) * k) << 8) | Math.round(ab + (bb - ab) * k)) >>> 0;
}
export function mulc(c: number, f: number) {
  const [r, g, b] = rgbOf(c);
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return ((cl(r) << 16) | (cl(g) << 8) | cl(b)) >>> 0;
}
/** smooth 3D noise in [0,1] */
export const n01 = (x: number, y: number, z: number, f: number, seed = 0) => noise.n3(x * f + seed * 13.1, y * f - seed * 7.7, z * f + seed * 3.3) * 0.5 + 0.5;
/** deterministic 0..1 per voxel */
export const h01 = (x: number, y: number, z: number, seed = 0) => hash3(x * 1.31 + seed * 17, y * 1.73 - seed * 7, z * 2.11 + seed * 3);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const sstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Soft fur: broad streaks stretched along the hair flow (`stretch` per axis,
 * > 1 = longer along that axis), a few lighter guard hairs and darker roots.
 * Deliberately low contrast so cel shading stays clean.
 */
export function fur(base: number, light: number, dark: number, cell: number, seed = 0, stretch: V3 = [1, 2.6, 1]): (x: number, y: number, z: number) => number {
  return (x, y, z) => {
    const a = noise.n3(x / (cell * stretch[0]) + seed * 3.1, y / (cell * stretch[1]) - seed, z / (cell * stretch[2]) + seed * 1.7);
    let c = a > 0.42 ? mixc(base, light, 0.5) : a < -0.45 ? mixc(base, dark, 0.42) : base;
    const h = hash3(x + seed * 31, y - seed * 11, z + seed * 7);
    if (h < 0.012) c = mixc(c, light, 0.55);
    else if (h > 0.99) c = mixc(c, dark, 0.5);
    return c;
  };
}

// ================================================================ rotations
/** v rotated by a THREE 'XYZ' euler (matrix Rx·Ry·Rz) */
export function rotXYZ(v: V3, e: V3): V3 {
  let [x, y, z] = v;
  let c = Math.cos(e[2]), s = Math.sin(e[2]);
  [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(e[1]);
  s = Math.sin(e[1]);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(e[0]);
  s = Math.sin(e[0]);
  [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z];
}
/** inverse of rotXYZ */
export function invXYZ(v: V3, e: V3): V3 {
  let [x, y, z] = v;
  let c = Math.cos(-e[0]), s = Math.sin(-e[0]);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(-e[1]);
  s = Math.sin(-e[1]);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(-e[2]);
  s = Math.sin(-e[2]);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}
export const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scl3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm3 = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const res = (c: Col, x: number, y: number, z: number) => (typeof c === 'number' ? c : c(x, y, z));

// ================================================================ shapes
export interface ShapeOpts {
  rot?: V3;
  fl?: number;
  keep?: (lx: number, ly: number, lz: number, x: number, y: number, z: number) => boolean;
  carve?: boolean;
  /** only fill empty cells */
  under?: boolean;
}
/** ellipsoid (optionally rotated) around geometric centre c with radii r */
export function ell(m: VoxelModel, c: V3, r: V3, col: Col, o: ShapeOpts = {}) {
  const R = Math.max(r[0], r[1], r[2]) + 1;
  for (let i = Math.floor(c[0] - R); i <= Math.ceil(c[0] + R); i++)
    for (let j = Math.floor(c[1] - R); j <= Math.ceil(c[1] + R); j++)
      for (let k = Math.floor(c[2] - R); k <= Math.ceil(c[2] + R); k++) {
        let p: V3 = [i + 0.5 - c[0], j + 0.5 - c[1], k + 0.5 - c[2]];
        if (o.rot) p = invXYZ(p, o.rot);
        const lx = p[0] / r[0], ly = p[1] / r[1], lz = p[2] / r[2];
        if (lx * lx + ly * ly + lz * lz > 1) continue;
        if (o.keep && !o.keep(lx, ly, lz, i, j, k)) continue;
        if (o.carve) {
          m.del(i, j, k);
          continue;
        }
        if (o.under && m.has(i, j, k)) continue;
        const cc = res(col, i, j, k);
        if (cc !== null) m.set(i, j, k, cc, o.fl);
      }
  return m;
}
/** tapered capsule from a to b, radius r0 -> r1 */
export function cap(m: VoxelModel, a: V3, b: V3, r0: number, r1: number, col: Col, o: ShapeOpts = {}) {
  const R = Math.max(r0, r1) + 1;
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1e-6;
  for (let i = Math.floor(Math.min(a[0], b[0]) - R); i <= Math.ceil(Math.max(a[0], b[0]) + R); i++)
    for (let j = Math.floor(Math.min(a[1], b[1]) - R); j <= Math.ceil(Math.max(a[1], b[1]) + R); j++)
      for (let k = Math.floor(Math.min(a[2], b[2]) - R); k <= Math.ceil(Math.max(a[2], b[2]) + R); k++) {
        const px = i + 0.5 - a[0], py = j + 0.5 - a[1], pz = k + 0.5 - a[2];
        const t = Math.max(0, Math.min(1, (px * d[0] + py * d[1] + pz * d[2]) / L2));
        const qx = px - d[0] * t, qy = py - d[1] * t, qz = pz - d[2] * t;
        const rr = r0 + (r1 - r0) * t;
        if (qx * qx + qy * qy + qz * qz > rr * rr) continue;
        if (o.keep && !o.keep(t, 0, 0, i, j, k)) continue;
        if (o.carve) {
          m.del(i, j, k);
          continue;
        }
        if (o.under && m.has(i, j, k)) continue;
        const cc = res(col, i, j, k);
        if (cc !== null) m.set(i, j, k, cc, o.fl);
      }
  return m;
}
/** chain of tapered capsules through points with per-point radius */
export function tube(m: VoxelModel, pts: V3[], radii: number[], col: Col, o: ShapeOpts = {}) {
  for (let i = 0; i < pts.length - 1; i++) cap(m, pts[i], pts[i + 1], radii[i], radii[i + 1], col, o);
  return m;
}
/** 1-voxel polyline (whiskers, strings, cords) */
export function line(m: VoxelModel, pts: V3[], col: Col, fl?: number) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 2.2));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const x = Math.floor(a[0] + (b[0] - a[0]) * t), y = Math.floor(a[1] + (b[1] - a[1]) * t), z = Math.floor(a[2] + (b[2] - a[2]) * t);
      const cc = res(col, x, y, z);
      if (cc !== null) m.set(x, y, z, cc, fl);
    }
  }
  return m;
}

// ---------------------------------------------------------------- implicit organic forms
/** primitive of an organic implicit form: ellipsoid (c, r, rot) or tapered capsule (a, b, r0, r1) */
export interface Prim {
  c?: V3;
  r?: V3;
  rot?: V3;
  a?: V3;
  b?: V3;
  r0?: number;
  r1?: number;
  /** smooth subtraction instead of union */
  sub?: boolean;
  k?: number;
}
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);
function primSdf(q: Prim, px: number, py: number, pz: number) {
  if (q.a && q.b) {
    const a = q.a, b = q.b;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L2 = dx * dx + dy * dy + dz * dz || 1e-6;
    const ax = px - a[0], ay = py - a[1], az = pz - a[2];
    const t = Math.max(0, Math.min(1, (ax * dx + ay * dy + az * dz) / L2));
    const r = (q.r0 ?? 1) + ((q.r1 ?? q.r0 ?? 1) - (q.r0 ?? 1)) * t;
    return Math.hypot(ax - dx * t, ay - dy * t, az - dz * t) - r;
  }
  const c = q.c!, r = q.r!;
  let v: V3 = [px - c[0], py - c[1], pz - c[2]];
  if (q.rot) v = invXYZ(v, q.rot);
  // iq's ellipsoid distance bound
  const k0 = Math.hypot(v[0] / r[0], v[1] / r[1], v[2] / r[2]);
  const k1 = Math.hypot(v[0] / (r[0] * r[0]), v[1] / (r[1] * r[1]), v[2] / (r[2] * r[2])) || 1e-6;
  return (k0 * (k0 - 1)) / k1;
}
export function blobSdf(prims: Prim[], k: number, px: number, py: number, pz: number) {
  let d = 1e9;
  let first = true;
  for (const q of prims) {
    const di = primSdf(q, px, py, pz);
    if (q.sub) d = smax(d, -di, q.k ?? k);
    else if (first) {
      d = di;
      first = false;
    } else d = smin(d, di, q.k ?? k);
  }
  return d;
}
function primBounds(q: Prim, pad: number): [V3, V3] {
  if (q.a && q.b) {
    const R = Math.max(q.r0 ?? 1, q.r1 ?? 1) + pad;
    return [
      [Math.min(q.a[0], q.b[0]) - R, Math.min(q.a[1], q.b[1]) - R, Math.min(q.a[2], q.b[2]) - R],
      [Math.max(q.a[0], q.b[0]) + R, Math.max(q.a[1], q.b[1]) + R, Math.max(q.a[2], q.b[2]) + R],
    ];
  }
  const R = Math.max(q.r![0], q.r![1], q.r![2]) + pad;
  return [
    [q.c![0] - R, q.c![1] - R, q.c![2] - R],
    [q.c![0] + R, q.c![1] + R, q.c![2] + R],
  ];
}
/**
 * Organic form: smooth union of prims (+ smooth subtractions) with an optional
 * displacement field (positive = push inward). Everything melts together like
 * flesh and fur — never a bare primitive.
 */
export function blob(m: VoxelModel, prims: Prim[], col: Col, o: { k: number; disp?: (x: number, y: number, z: number) => number; keep?: (x: number, y: number, z: number) => boolean; fl?: number; carve?: boolean; under?: boolean }) {
  const lo: V3 = [1e9, 1e9, 1e9], hi: V3 = [-1e9, -1e9, -1e9];
  for (const q of prims) {
    if (q.sub) continue;
    const [a, b] = primBounds(q, o.k + 2);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], a[i]);
      hi[i] = Math.max(hi[i], b[i]);
    }
  }
  for (let i = Math.floor(lo[0]); i <= Math.ceil(hi[0]); i++)
    for (let j = Math.floor(lo[1]); j <= Math.ceil(hi[1]); j++)
      for (let kk = Math.floor(lo[2]); kk <= Math.ceil(hi[2]); kk++) {
        if (o.keep && !o.keep(i, j, kk)) continue;
        let d = blobSdf(prims, o.k, i + 0.5, j + 0.5, kk + 0.5);
        if (d > 2.5) continue;
        if (o.disp) d += o.disp(i + 0.5, j + 0.5, kk + 0.5);
        if (d > 0) continue;
        if (o.carve) {
          m.del(i, j, kk);
          continue;
        }
        if (o.under && m.has(i, j, kk)) continue;
        const cc = res(col, i, j, kk);
        if (cc !== null) m.set(i, j, kk, cc, o.fl);
      }
  return m;
}

// ================================================================ editing passes
/** repaint voxels that satisfy pred (keeps flags unless given) */
export function paint(m: VoxelModel, pred: (x: number, y: number, z: number, c: number) => boolean, col: Col, fl?: number) {
  const hits: [number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (pred(x, y, z, c)) hits.push([x, y, z, fl ?? f]);
  });
  for (const [x, y, z, f] of hits) {
    const cc = res(col, x, y, z);
    if (cc !== null) m.set(x, y, z, cc, f || VF.SOLID);
  }
  return m;
}
export const exposed = (m: VoxelModel, x: number, y: number, z: number) => !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z) || !m.has(x, y - 1, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
const N6: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Grow a 1-voxel layer outward over exposed voxels that satisfy pred (cloth
 * over fur, hair over skin). `dirs` limits growth directions (default all but
 * down). New voxels take col(x, y, z, srcColour).
 */
export function thicken(m: VoxelModel, pred: (x: number, y: number, z: number) => boolean, col: (x: number, y: number, z: number, src: number) => number | null, dirs: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]], fl?: number) {
  const add: [number, number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    if (!pred(x, y, z)) return;
    for (const [dx, dy, dz] of dirs) {
      if (m.has(x + dx, y + dy, z + dz)) continue;
      const cc = col(x + dx, y + dy, z + dz, c);
      if (cc !== null) add.push([x + dx, y + dy, z + dz, cc]);
    }
  });
  for (const [x, y, z, c] of add) m.set(x, y, z, c, fl);
  return m;
}

/**
 * Natural finishing: sky-lit tops a touch lighter, undersides darker. Subtle —
 * the renderer's cel ramp and AO do the heavy lifting.
 */
export function finish(m: VoxelModel, o: { top?: number; under?: number; skip?: (c: number) => boolean } = {}) {
  const top = o.top ?? 1.04, under = o.under ?? 0.9;
  const out: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (o.skip?.(c)) return;
    const up = !m.has(x, y + 1, z), dn = !m.has(x, y - 1, z);
    if (up && !dn) out.push([x, y, z, mulc(c, top), f]);
    else if (dn && !up) out.push([x, y, z, mulc(c, under), f]);
  });
  for (const [x, y, z, c, f] of out) m.set(x, y, z, c, f);
  return m;
}

/** 3D majority filter: removes 1-voxel spikes and fills pits (clean silhouettes under ink outlines) */
export function smoothVox(m: VoxelModel, iterations = 1, thresh = 13, floorY = -1e9) {
  for (let it = 0; it < iterations; it++) {
    const cand = new Set<number>();
    const K = (x: number, y: number, z: number) => ((x + 512) << 20) | ((y + 512) << 10) | (z + 512);
    m.forEach((x, y, z) => {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) cand.add(K(x + dx, y + dy, z + dz));
    });
    const add: [number, number, number, number, number][] = [];
    const del: [number, number, number][] = [];
    for (const k of cand) {
      const x = ((k >>> 20) & 1023) - 512, y = ((k >>> 10) & 1023) - 512, z = (k & 1023) - 512;
      let n = 0;
      let nc = -1, nf = VF.SOLID;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            if (!dx && !dy && !dz) continue;
            const v = m.get(x + dx, y + dy, z + dz);
            if (v === undefined) continue;
            n++;
            if (nc < 0 || (!dx && !dz)) {
              nc = v & 0xffffff;
              nf = v >>> 24;
            }
          }
      const has = m.has(x, y, z);
      if (has && n < thresh - 4) del.push([x, y, z]);
      else if (!has && n >= thresh + 4 && nc >= 0 && y >= floorY) add.push([x, y, z, nc, nf]);
    }
    for (const [x, y, z] of del) m.del(x, y, z);
    for (const [x, y, z, c, f] of add) m.set(x, y, z, c, f || VF.SOLID);
  }
  return m;
}

/** drop interior voxels (keeps a shell `keep` voxels thick) — less memory, same look */
export function hollow(m: VoxelModel, keep = 2) {
  const del: [number, number, number][] = [];
  m.forEach((x, y, z) => {
    for (let d = 1; d <= keep; d++)
      if (!m.has(x + d, y, z) || !m.has(x - d, y, z) || !m.has(x, y + d, z) || !m.has(x, y - d, z) || !m.has(x, y, z + d) || !m.has(x, y, z - d)) return;
    del.push([x, y, z]);
  });
  for (const [x, y, z] of del) m.del(x, y, z);
  return m;
}

/**
 * Split a sculpted mass into two parts along a predicate (voxels where `upper`
 * is true go to `b`). Interior voxels of `a` within `overlap` cells of the cut
 * are copied into `b` as a hidden plug, so the joint never opens a gap when
 * the part bends (they stay buried inside `a`'s surface at rest).
 */
export function splitInto(src: VoxelModel, a: VoxelModel, b: VoxelModel, upper: (x: number, y: number, z: number) => boolean, overlapPlug?: (x: number, y: number, z: number) => boolean) {
  src.forEach((x, y, z, c, f) => {
    if (upper(x, y, z)) b.set(x, y, z, c, f);
    else {
      a.set(x, y, z, c, f);
      if (overlapPlug && overlapPlug(x, y, z)) {
        // only deep interior cells (two cells in from every side) so the plug never shows
        let inner = true;
        for (const [dx, dy, dz] of N6) if (!src.has(x + dx * 2, y + dy * 2, z + dz * 2) || !src.has(x + dx, y + dy, z + dz)) inner = false;
        if (inner) b.set(x, y, z, c, f);
      }
    }
  });
}

/** front-most (max z) filled voxel per (x, y) column, NaN if empty */
export function frontSurface(m: VoxelModel) {
  const S = new Map<number, number>();
  m.forEach((x, y, z) => {
    const k = (x + 512) * 2048 + (y + 512);
    if ((S.get(k) ?? -1e9) < z) S.set(k, z);
  });
  return (x: number, y: number) => S.get((x + 512) * 2048 + (y + 512)) ?? NaN;
}

/** voxel of a model maximising score (null scores skipped) */
export function argmax(m: VoxelModel, score: (x: number, y: number, z: number) => number | null): V3 | null {
  let best: V3 | null = null;
  let bs = -1e18;
  m.forEach((x, y, z) => {
    const s = score(x, y, z);
    if (s !== null && s > bs) {
      bs = s;
      best = [x, y, z];
    }
  });
  return best;
}

// ================================================================ glossy modelled eyes
/**
 * A wet, glossy eye (real geometry, no 2D overlay): dark globe with a soft iris
 * ring around the gaze axis, a deep pupil, and anime catchlights — one big at
 * the upper-front-outer edge, one small lower-inner. Globe voxels are METAL so
 * the renderer gives them a specular sheen.
 */
export function wetEye(m: VoxelModel, c: V3, r: number, fwd: V3, o: { sclera?: number; iris?: number; irisEdge?: number; pupil?: number; irisR?: number; pupilR?: number; bigGlint?: number; smallGlint?: boolean } = {}) {
  const f = norm3(fwd);
  const scl = o.sclera ?? 0x1c120c;
  const iris = o.iris ?? 0x4a2c18;
  const edge = o.irisEdge ?? mixc(iris, 0x000000, 0.45);
  const pupil = o.pupil ?? 0x080505;
  const irisR = o.irisR ?? 0.86, pupilR = o.pupilR ?? 0.5;
  ell(m, c, [r, r, r], (x, y, z) => {
    const px = x + 0.5 - c[0], py = y + 0.5 - c[1], pz = z + 0.5 - c[2];
    const l = Math.hypot(px, py, pz) || 1;
    const along = (px * f[0] + py * f[1] + pz * f[2]) / l;
    let col = scl;
    if (along > 0.15) {
      const ring = Math.sqrt(Math.max(0, 1 - along * along));
      if (ring < irisR) col = ring > irisR * 0.78 ? edge : mixc(iris, mulc(iris, 0.7), ring / irisR);
      if (ring < pupilR) col = pupil;
    }
    return col;
  }, { fl: VF.METAL });
  // catchlights on the visible surface: big upper-front-outer, small lower-front-inner
  const side = Math.sign(f[0] || 1);
  const big = norm3([f[0] + side * 0.3, f[1] + 0.62, f[2]]);
  const small = norm3([f[0] - side * 0.25, f[1] - 0.42, f[2]]);
  const pick = (d: V3) => argmax(m, (x, y, z) => {
    const px = x + 0.5 - c[0], py = y + 0.5 - c[1], pz = z + 0.5 - c[2];
    if (Math.hypot(px, py, pz) > r + 0.6) return null;
    if (!exposed(m, x, y, z)) return null;
    return px * d[0] + py * d[1] + pz * d[2];
  });
  const b = pick(big);
  if (b) {
    m.set(b[0], b[1], b[2], 0xffffff, VF.SOFTAO);
    if ((o.bigGlint ?? (r >= 4 ? 2 : 1)) >= 2) {
      // a 2-3 voxel highlight cluster on big eyes
      for (const [dx, dy, dz] of [[0, -1, 0], [-side, 0, 0], [0, 0, -1]] as V3[]) {
        const x = b[0] + dx, y = b[1] + dy, z = b[2] + dz;
        if (m.has(x, y, z) && exposed(m, x, y, z)) {
          m.set(x, y, z, 0xf4f8ff, VF.SOFTAO);
          break;
        }
      }
    }
  }
  if (o.smallGlint ?? r >= 2.2) {
    const s = pick(small);
    if (s && !(b && s[0] === b[0] && s[1] === b[1] && s[2] === b[2])) m.set(s[0], s[1], s[2], 0xdfe8f2, VF.SOFTAO);
  }
  return m;
}

// ================================================================ props helpers
/** hand-thrown vessel by radius profile (bottom -> top), slightly lopsided */
export function vessel(m: VoxelModel, base: V3, profile: number[], col: (row: number, x: number, z: number, a: number) => number | null, o: { lean?: [number, number]; seed?: number; fl?: number; hollowTop?: number } = {}) {
  const [bx, by, bz] = base;
  const seed = o.seed ?? 5;
  const [lx, lz] = o.lean ?? [0, 0];
  for (let i = 0; i < profile.length; i++) {
    const y = Math.floor(by) + i;
    const t = i / Math.max(1, profile.length - 1);
    const cx = bx + lx * t, cz = bz + lz * t;
    const r = profile[i];
    const R = Math.ceil(r + 1);
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++)
      for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) {
        const a = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
        const rr = r * (1 + noise.n2(Math.cos(a) * 1.3 + seed, Math.sin(a) * 1.3 + i * 0.15) * 0.07);
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
        if (d > rr) continue;
        if (o.hollowTop !== undefined && i >= profile.length - o.hollowTop && d < rr - 1) continue;
        const c = col(i, x, z, a);
        if (c !== null) m.set(x, y, z, c, o.fl);
      }
  }
  return m;
}

/**
 * Sagging cloth sheet spanned between four corners (awnings): bilinear surface
 * with catenary sag + soft ripples, `thick` voxels thick. col(u, v, x, y, z).
 */
export function sheet(m: VoxelModel, c00: V3, c10: V3, c01: V3, c11: V3, col: (u: number, v: number, x: number, y: number, z: number) => number | null, o: { sag?: number; ripple?: number; thick?: number; res?: number; seed?: number } = {}) {
  const sag = o.sag ?? 2, rip = o.ripple ?? 0.5, th = o.thick ?? 1, rs = o.res ?? 0.4, seed = o.seed ?? 9;
  const du = Math.hypot(c10[0] - c00[0], c10[1] - c00[1], c10[2] - c00[2]);
  const dv = Math.hypot(c01[0] - c00[0], c01[1] - c00[1], c01[2] - c00[2]);
  const nu = Math.ceil(du / rs), nv = Math.ceil(dv / rs);
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j <= nv; j++) {
      const u = i / nu, v = j / nv;
      const L = (a: number, b: number, c: number, d: number) => a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
      const x = L(c00[0], c10[0], c01[0], c11[0]);
      let y = L(c00[1], c10[1], c01[1], c11[1]);
      const z = L(c00[2], c10[2], c01[2], c11[2]);
      y -= sag * 4 * u * (1 - u) * (0.55 + 0.45 * 4 * v * (1 - v));
      y += noise.n2(u * 4 + seed, v * 4 - seed) * rip;
      for (let t = 0; t < th; t++) {
        const X = Math.floor(x), Y = Math.floor(y) - t, Z = Math.floor(z);
        const c = col(u, v, X, Y, Z);
        if (c !== null) m.set(X, Y, Z, c);
      }
    }
  return m;
}

/** memoise a builder by a string key */
export function memoBy<A, R>(key: (a: A) => string, fn: (a: A) => R): (a: A) => R {
  const cache = new Map<string, R>();
  return (a: A) => {
    const k = key(a);
    let r = cache.get(k);
    if (!r) {
      r = fn(a);
      cache.set(k, r);
    }
    return r;
  };
}
