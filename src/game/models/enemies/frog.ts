// Desert rain frogs (Breviceps macrops): round, fat, granular-skinned, grumpy-
// mouthed and adorable. The mama wears an old lady's curly grey wig, a little
// rose-felt hat with a flower and a veil, pearls and a tiny purse.
//
// Also hosts the small realistic-creature kit shared by frog / lizard / snake /
// quest NPC models (CRig + geometric shape helpers + natural texture helpers).
//
// KIT CONVENTIONS: every part is sculpted in ONE shared rig grid (voxel units),
// origin on the ground, faces +Z, character LEFT = +X. Shapes take GEOMETRIC
// coordinates; voxel i has its centre at i + 0.5. The body mirror plane is
// geometric x = 0 (voxels -1 and 0 are mirror images): mirror index i -> -1 - i,
// pivot x -> -x. Pivot == attach == joint (geometric), so parts are just cut
// from the same space.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, V3, PartSpec, SocketSpec, ExpressionSpec } from '../../../engine/voxel/Rig';
import { hash3, noise } from '../../../engine/math/rand';

export { VoxelModel, VF };
export type { V3, RigSpec };
export type Col = number | ((x: number, y: number, z: number) => number | null);

// ============================================================== rig builder
interface CPart {
  name: string;
  parent?: string;
  pivot: V3;
  rest?: V3;
  model: VoxelModel;
}
const LR = /_l(\d*)$|_(f|b)l$/;

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
  pivot(name: string): V3 {
    const p = this.parts.find((q) => q.name === name);
    if (!p) throw new Error(`[${this.name}] no part ${name}`);
    return p.pivot;
  }
  socket(name: string, part: string, at: V3, rot?: V3) {
    this.sockets[name] = { part, at, rot };
  }
  /** mirror a left part (x>0) to a new right part (parent name mapped by `pmap`) */
  mirror(src: string, dst: string, parent?: string) {
    const p = this.parts.find((q) => q.name === src);
    if (!p) throw new Error(`[${this.name}] no part ${src}`);
    const m = new VoxelModel(dst);
    p.model.forEach((x, y, z, c, f) => m.set(-1 - x, y, z, c, f));
    this.parts.push({ name: dst, parent: parent ?? p.parent, pivot: [-p.pivot[0], p.pivot[1], p.pivot[2]], rest: p.rest ? [p.rest[0], -p.rest[1], -p.rest[2]] : undefined, model: m });
    return m;
  }
  /** move every voxel matching pred from one part to another (cutting regions out of a sculpted mass) */
  move(from: string, to: string, pred: (x: number, y: number, z: number) => boolean) {
    const a = this.m(from), b = this.m(to);
    const mv: [number, number, number, number, number][] = [];
    a.forEach((x, y, z, c, f) => {
      if (pred(x, y, z)) mv.push([x, y, z, c, f]);
    });
    for (const [x, y, z, c, f] of mv) {
      a.del(x, y, z);
      b.set(x, y, z, c, f || VF.SOLID);
    }
    return mv.length;
  }
  build(meta: Record<string, any> = {}): RigSpec {
    const parts: PartSpec[] = this.parts.map((p) => ({ name: p.name, model: p.model, pivot: p.pivot, parent: p.parent, attach: [p.pivot[0], p.pivot[1], p.pivot[2]], rest: p.rest }));
    for (const p of parts) if (p.model.count === 0) p.model.set(Math.floor(p.pivot[0]), Math.floor(p.pivot[1]), Math.floor(p.pivot[2]), 0x2a1a10);
    return { name: this.name, voxelSize: this.vs, parts, sockets: this.sockets, meta };
  }
}
void LR;

// ============================================================== colour helpers
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
/** per-voxel brightness jitter (deterministic) */
export const jit = (c: number, x: number, y: number, z: number, amt = 0.06, seed = 0) => mulc(c, 1 + (hash3(x + seed * 17, y - seed * 5, z + seed * 3) - 0.5) * 2 * amt);
/** smooth 3D value in [0,1] */
export const n01 = (x: number, y: number, z: number, f: number, seed = 0) => noise.n3(x * f + seed * 13.1, y * f - seed * 7.7, z * f + seed * 3.3) * 0.5 + 0.5;
const res = (c: Col, x: number, y: number, z: number) => (typeof c === 'number' ? c : c(x, y, z));

// ============================================================== shapes (geometric coords)
/** rotate offset by the inverse of euler (yaw Y, pitch X, roll Z) so shapes can be oriented */
function inv(p: V3, r: V3): V3 {
  let [x, y, z] = p;
  let c = Math.cos(-r[1]), s = Math.sin(-r[1]);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(-r[0]);
  s = Math.sin(-r[0]);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(-r[2]);
  s = Math.sin(-r[2]);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}
export interface ShapeOpts {
  rot?: V3;
  fl?: number;
  /** filter by normalized local coords (each in [-1,1]) and voxel index */
  keep?: (lx: number, ly: number, lz: number, x: number, y: number, z: number) => boolean;
  carve?: boolean;
  /** only fill empty cells (don't overwrite) */
  under?: boolean;
}
/** ellipsoid (optionally rotated) around geometric centre c with radii r */
export function ell(m: VoxelModel, c: V3, r: V3, col: Col, o: ShapeOpts = {}) {
  const R = Math.max(r[0], r[1], r[2]) + 1;
  for (let i = Math.floor(c[0] - R); i <= Math.ceil(c[0] + R); i++)
    for (let j = Math.floor(c[1] - R); j <= Math.ceil(c[1] + R); j++)
      for (let k = Math.floor(c[2] - R); k <= Math.ceil(c[2] + R); k++) {
        let p: V3 = [i + 0.5 - c[0], j + 0.5 - c[1], k + 0.5 - c[2]];
        if (o.rot) p = inv(p, o.rot);
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
/** capsule / cone from a to b with radius r0 -> r1 */
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
/** chain of cones through points with per-point radius */
export function tube(m: VoxelModel, pts: V3[], radii: number[], col: Col, o: ShapeOpts = {}) {
  for (let i = 0; i < pts.length - 1; i++) cap(m, pts[i], pts[i + 1], radii[i], radii[i + 1], col, o);
  return m;
}
/** axis-aligned box over voxels whose centres lie inside [a, b] */
export function box(m: VoxelModel, a: V3, b: V3, col: Col, o: ShapeOpts = {}) {
  for (let i = Math.floor(Math.min(a[0], b[0])); i <= Math.ceil(Math.max(a[0], b[0])); i++)
    for (let j = Math.floor(Math.min(a[1], b[1])); j <= Math.ceil(Math.max(a[1], b[1])); j++)
      for (let k = Math.floor(Math.min(a[2], b[2])); k <= Math.ceil(Math.max(a[2], b[2])); k++) {
        const x = i + 0.5, y = j + 0.5, z = k + 0.5;
        if (x < Math.min(a[0], b[0]) || x > Math.max(a[0], b[0]) || y < Math.min(a[1], b[1]) || y > Math.max(a[1], b[1]) || z < Math.min(a[2], b[2]) || z > Math.max(a[2], b[2])) continue;
        if (o.keep && !o.keep(0, 0, 0, i, j, k)) continue;
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

/** a primitive of an organic implicit form */
export interface Prim {
  c: V3;
  r: V3;
  rot?: V3;
  /** smooth subtraction instead of union */
  sub?: boolean;
  /** per-primitive smoothing (defaults to the blob's k) */
  k?: number;
}
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);
/** approximate signed distance of the smooth union of prims at geometric point p (voxel units) */
export function blobSdf(prims: Prim[], k: number, px: number, py: number, pz: number) {
  let d = 1e9;
  let first = true;
  for (const q of prims) {
    let v: V3 = [px - q.c[0], py - q.c[1], pz - q.c[2]];
    if (q.rot) v = inv(v, q.rot);
    const lx = v[0] / q.r[0], ly = v[1] / q.r[1], lz = v[2] / q.r[2];
    const di = (Math.sqrt(lx * lx + ly * ly + lz * lz) - 1) * Math.min(q.r[0], q.r[1], q.r[2]);
    if (q.sub) d = smax(d, -di, q.k ?? k);
    else if (first) d = di;
    else d = smin(d, di, q.k ?? k);
    if (!q.sub) first = false;
  }
  return d;
}
/**
 * organic form: smooth union of ellipsoids (+ smooth subtractions) with an
 * optional displacement field (positive = push inward: creases, lumps).
 * Never a bare primitive: everything melts together like flesh.
 */
export function blob(m: VoxelModel, prims: Prim[], col: Col, o: { k: number; disp?: (x: number, y: number, z: number) => number; keep?: (x: number, y: number, z: number) => boolean; fl?: number; carve?: boolean; under?: boolean }) {
  let lo: V3 = [1e9, 1e9, 1e9], hi: V3 = [-1e9, -1e9, -1e9];
  for (const q of prims) {
    if (q.sub) continue;
    const R = Math.max(q.r[0], q.r[1], q.r[2]) + o.k + 2;
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], q.c[a] - R);
      hi[a] = Math.max(hi[a], q.c[a] + R);
    }
  }
  for (let i = Math.floor(lo[0]); i <= Math.ceil(hi[0]); i++)
    for (let j = Math.floor(lo[1]); j <= Math.ceil(hi[1]); j++)
      for (let kk = Math.floor(lo[2]); kk <= Math.ceil(hi[2]); kk++) {
        if (o.keep && !o.keep(i, j, kk)) continue;
        let d = blobSdf(prims, o.k, i + 0.5, j + 0.5, kk + 0.5);
        if (d > 3) continue;
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
/** lumpy-flesh displacement: low-frequency lumps + finer warts (voxel units) */
export const lumps = (amp: number, freq: number, seed = 0, wart = 0, wf = 2.4) => (x: number, y: number, z: number) => {
  let d = noise.n3(x * freq + seed, y * freq - seed * 0.7, z * freq + seed * 0.3) * amp;
  if (wart > 0) {
    // smooth rounded warts (a soft bump profile, not single-voxel spikes)
    const w = noise.n3(x * freq * wf - seed, y * freq * wf, z * freq * wf + seed);
    if (w > 0.45) {
      const t = Math.min(1, (w - 0.45) / 0.35);
      d -= wart * t * t * (3 - 2 * t); // smoothstep dome
    }
  }
  return d;
};

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

/**
 * natural finishing pass: sky-lit tops a touch lighter, undersides darker,
 * concave cells (open on few sides) slightly darkened. Subtle — the renderer's
 * lighting and AO do the heavy lifting.
 */
export function finish(m: VoxelModel, o: { top?: number; under?: number; skip?: (c: number) => boolean } = {}) {
  const top = o.top ?? 1.05, under = o.under ?? 0.86;
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

/**
 * 3D majority filter on occupancy: removes 1-voxel spikes and fills pits so
 * organic sculpts get clean, readable silhouettes (great under cel outlines).
 * New voxels copy a filled neighbour's colour.
 */
export function smoothVox(m: VoxelModel, iterations = 1, thresh = 13) {
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
      else if (!has && n >= thresh + 4 && nc >= 0 && y >= 0) add.push([x, y, z, nc, nf]);
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

/** add 1-voxel outward bumps on exposed surface voxels (warty / granular skin) */
export function bumps(m: VoxelModel, centre: V3, density: number, col: (x: number, y: number, z: number, c: number) => number, seed = 1, pred?: (x: number, y: number, z: number) => boolean) {
  const add: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (hash3(x * 3 + seed, y * 5 - seed, z * 7 + seed * 2) > density) return;
    if (pred && !pred(x, y, z)) return;
    const nx = x + 0.5 - centre[0], ny = y + 0.5 - centre[1], nz = z + 0.5 - centre[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    const ox = Math.round(nx / l), oy = Math.round(ny / l), oz = Math.round(nz / l);
    if (m.has(x + ox, y + oy, z + oz)) return;
    if (!exposed(m, x, y, z)) return;
    add.push([x + ox, y + oy, z + oz, col(x, y, z, c), f]);
  });
  for (const [x, y, z, c, f] of add) if (y >= 0) m.set(x, y, z, c, f);
  return m;
}

/** glossy wet eye: dark (or tinted) globe, optional iris ring + pupil, catchlights */
export function wetEye(m: VoxelModel, c: V3, r: number, fwd: V3, o: { sclera?: number; iris?: number; pupil?: number; irisR?: number; pupilR?: number; slit?: boolean; cloudy?: number } = {}) {
  const f = (() => {
    const l = Math.hypot(fwd[0], fwd[1], fwd[2]) || 1;
    return [fwd[0] / l, fwd[1] / l, fwd[2] / l] as V3;
  })();
  const scl = o.sclera ?? 0x1b120d;
  const iris = o.iris ?? 0x4a3020;
  const pupil = o.pupil ?? 0x070504;
  const irisR = o.irisR ?? 0.78, pupilR = o.pupilR ?? 0.42;
  ell(m, c, [r, r, r], (x, y, z) => {
    const px = x + 0.5 - c[0], py = y + 0.5 - c[1], pz = z + 0.5 - c[2];
    const l = Math.hypot(px, py, pz) || 1;
    const along = (px * f[0] + py * f[1] + pz * f[2]) / l; // 1 = looking straight out
    // lateral offset from the gaze axis (for the slit pupil: vertical ellipse)
    const ax = px - f[0] * along * l, ay = py - f[1] * along * l, az = pz - f[2] * along * l;
    const lat = Math.hypot(ax, az) / r, vert = Math.abs(ay) / r;
    let col = scl;
    if (along > 0.2) {
      const ring = Math.sqrt(Math.max(0, 1 - along * along));
      if (ring < irisR) col = mixc(iris, mulc(iris, 0.6), n01(x, y, z, 0.9, 3));
      const pd = o.slit ? Math.hypot(lat * 2.6, vert * 0.85) : ring / pupilR;
      if (o.slit ? pd < 0.55 && along > 0.55 : pd < 1) col = pupil;
    }
    if (o.cloudy) col = mixc(col, 0xc8ccc8, o.cloudy * (0.6 + hash3(x, y, z) * 0.4));
    return col;
  }, { fl: VF.METAL });
  // catchlights: upper-front-outer
  const hl: V3 = [c[0] + f[0] * r * 0.72 + Math.sign(c[0] || 1) * r * 0.18, c[1] + r * 0.42, c[2] + f[2] * r * 0.72];
  const hi = Math.floor(hl[0]), hj = Math.floor(hl[1]), hk = Math.floor(hl[2]);
  if (m.has(hi, hj, hk)) m.set(hi, hj, hk, 0xffffff, VF.SOLID);
  if (r >= 3 && m.has(hi, hj - 1, hk)) m.set(hi, hj - 1, hk, 0xe8eef2, VF.SOLID);
  return m;
}

/** jaw/brow expression set */
export function jawExpressions(map: Record<string, number>, brows?: Record<string, [number, number]>): Record<string, ExpressionSpec> {
  const out: Record<string, ExpressionSpec> = {};
  for (const [k, v] of Object.entries(map)) out[k] = { jaw: v, brow: brows?.[k] ?? [0, 0] };
  return out;
}

/** memoise a builder per argument key */
export function memo<A, R>(fn: (a: A) => R): (a?: A) => R {
  const cache = new Map<string, R>();
  return (a?: A) => {
    const k = JSON.stringify(a ?? null);
    let r = cache.get(k);
    if (!r) {
      r = fn((a ?? {}) as A);
      cache.set(k, r);
    }
    return r;
  };
}

// ============================================================== RAIN FROGS
interface FrogPal {
  skin: number;
  lo: number;
  hi: number;
  belly: number;
  wart: number;
  blush: number;
}
const BABY_PALS: FrogPal[] = [
  { skin: 0xd8bf94, lo: 0xae9068, hi: 0xeedcb8, belly: 0xf4ebdc, wart: 0xe9d3a8, blush: 0xeab09a },
  { skin: 0xc6c0b4, lo: 0x9c958a, hi: 0xe4e0d6, belly: 0xf2efe8, wart: 0xdcd6ca, blush: 0xe6b2ac },
  { skin: 0xcc9c66, lo: 0xa07446, hi: 0xe8c28a, belly: 0xf2e2ca, wart: 0xe0b47a, blush: 0xeca486 },
  { skin: 0xbfb88a, lo: 0x958f62, hi: 0xdad6aa, belly: 0xf0ecd6, wart: 0xd0ca98, blush: 0xe2ae96 },
  { skin: 0xd8ae98, lo: 0xae8270, hi: 0xf2d2c0, belly: 0xf7e8e0, wart: 0xeac2ae, blush: 0xf2a0a0 },
];
const MAMA_PAL: FrogPal = { skin: 0xcbb08a, lo: 0x9e8464, hi: 0xe6d2b2, belly: 0xf1e6d4, wart: 0xdcc49c, blush: 0xeaa498 };

interface FrogCfg {
  name: string;
  vs: number;
  R: number;
  pal: FrogPal;
  eyeK: number;
  mama: boolean;
  seed: number;
}

/** first filled voxel scanning from the front (+Z) along a row — the face surface */
function frontZ(m: VoxelModel, xi: number, yi: number, zMax: number, zMin: number) {
  for (let k = zMax; k >= zMin; k--) if (m.has(xi, yi, k)) return k;
  return null;
}

function frog(c: FrogCfg): RigSpec {
  const { R, pal, seed } = c;
  const rig = new CRig(c.name, c.vs);
  const C: V3 = [0, R * 0.84, 0];
  const body = rig.part('body', undefined, [0, C[1], 0]);
  // ---------------------------------------------------------- the plump flesh mass (never a sphere)
  const prims: Prim[] = [
    { c: [0, R * 0.84, -R * 0.04], r: [R * 1.0, R * 0.84, R * 0.94] }, // main mass
    { c: [0, R * 0.42, R * 0.06], r: [R * 1.1, R * 0.46, R * 0.92] }, // belly sagging onto the sand
    { c: [R * 0.56, R * 0.74, R * 0.5], r: [R * 0.42, R * 0.35, R * 0.38] }, // puffy jowls
    { c: [-R * 0.56, R * 0.74, R * 0.5], r: [R * 0.42, R * 0.35, R * 0.38] },
    { c: [0, R * 1.04, -R * 0.42], r: [R * 0.8, R * 0.6, R * 0.6] }, // back hump
    { c: [0, R * 0.6, -R * 0.68], r: [R * 0.82, R * 0.5, R * 0.42] }, // rump
    { c: [R * 0.4, R * 1.3, R * 0.38], r: [R * 0.32, R * 0.24, R * 0.3] }, // brow mounds the eyes sit under
    { c: [-R * 0.4, R * 1.3, R * 0.38], r: [R * 0.32, R * 0.24, R * 0.3] },
    { c: [R * 0.78, R * 0.6, R * 0.7], r: [R * 0.11, R * 0.08, R * 0.1], sub: true, k: R * 0.08 }, // mouth-corner dimples
    { c: [-R * 0.78, R * 0.6, R * 0.7], r: [R * 0.11, R * 0.08, R * 0.1], sub: true, k: R * 0.08 },
  ];
  const lumpy = lumps(R * 0.018, 1 / (R * 0.45), seed, R > 12 ? R * 0.05 : 0, 2.0);
  const fold = (x: number, y: number, z: number) => {
    // a fat roll around the sides and back, and a double-chin crease
    const side = Math.min(1, Math.max(0, (Math.abs(x) - R * 0.45) / (R * 0.3))) * (z < R * 0.55 ? 1 : 0.2);
    const roll = Math.exp(-(((y - R * 0.52) / (R * 0.05)) ** 2)) * R * 0.085 * side;
    const chin = Math.exp(-(((y - R * 0.36) / (R * 0.045)) ** 2)) * R * 0.07 * (z > R * 0.45 && Math.abs(x) < R * 0.7 ? 1 : 0);
    return roll + chin;
  };
  const wartAt = (x: number, y: number, z: number) => R > 12 && noise.n3((x + 0.5) * (2.0 / (R * 0.45)) - seed, (y + 0.5) * (2.0 / (R * 0.45)), (z + 0.5) * (2.0 / (R * 0.45)) + seed) > 0.7;
  // clean cel-friendly colour regions: base, darker dorsal patches, pale belly, light warts
  const skin = (x: number, y: number, z: number) => {
    const gy = y + 0.5;
    const warp = noise.n3(x * (0.9 / R) + seed, y * (0.9 / R), z * (0.9 / R)) * R * 0.08;
    if (gy + warp < R * 0.46) return pal.belly;
    if (gy + warp < R * 0.58) return mixc(pal.belly, pal.skin, 0.55);
    if (wartAt(x, y, z)) return pal.wart;
    const patch = n01(x, y, z, 1 / (R * 0.55), seed + 4);
    if (patch > 0.66 && gy > R * 0.72) return pal.lo;
    return pal.skin;
  };
  blob(body, prims, skin, { k: R * 0.28, disp: (x, y, z) => lumpy(x, y, z) + fold(x, y, z), keep: (_x, y) => y >= 0 });
  smoothVox(body, 2);
  // ---------------------------------------------------------- split head / jaw / throat / belly so they can move
  const mouthY = (x: number) => C[1] + R * 0.04 - R * 0.12 * (x / (R * 0.75)) ** 2; // grumpy downturned line, just under the eyes
  rig.part('head', 'body', [0, C[1] - R * 0.08, R * 0.04]);
  rig.part('jaw', 'body', [0, mouthY(R * 0.7), R * 0.26]);
  const thr: V3 = [0, C[1] - R * 0.64, R * 0.58];
  rig.part('throat', 'jaw', [0, thr[1] + R * 0.12, thr[2] - R * 0.04]);
  rig.part('belly', 'body', [0, R * 0.36, R * 0.1]);
  // carve the mouth groove into the solid face before splitting
  for (let xi = Math.floor(-R * 0.82); xi <= Math.ceil(R * 0.82); xi++) {
    const yi = Math.floor(mouthY(xi + 0.5));
    const z = frontZ(body, xi, yi, Math.ceil(R * 1.4), 0);
    if (z === null) continue;
    for (let d = 0; d <= 1; d++) {
      body.del(xi, yi, z - d);
      body.del(xi, yi + (Math.abs(xi + 0.5) > R * 0.6 ? 1 : 0), z - d);
    }
    if (body.has(xi, yi, z - 2)) body.set(xi, yi, z - 2, 0x3a2420);
  }
  rig.move('body', 'jaw', (x, y, z) => {
    const gx = x + 0.5, gy = y + 0.5, gz = z + 0.5;
    return gz > R * 0.3 && gy < mouthY(gx) && gy > C[1] - R * 0.56 && Math.abs(gx) < R * 0.86;
  });
  rig.move('body', 'throat', (x, y, z) => Math.hypot((x + 0.5 - thr[0]) / (R * 0.44), (y + 0.5 - thr[1]) / (R * 0.24), (z + 0.5 - thr[2]) / (R * 0.32)) < 1);
  rig.move('body', 'head', (x, y, z) => {
    const gx = x + 0.5, gy = y + 0.5, gz = z + 0.5;
    return gz > -R * 0.02 && gy >= mouthY(gx) && gy > C[1] - R * 0.5;
  });
  rig.move('body', 'belly', (x, y, z) => {
    const gy = y + 0.5, gz = z + 0.5;
    return gy < R * 0.44 && gz > -R * 0.35 && Math.abs(x + 0.5) < R * 0.95;
  });
  const head = rig.m('head'), jaw = rig.m('jaw');
  // inner mouth (pink) visible when the jaw opens
  const inner = (m: VoxelModel, x: number, y: number, z: number) => m.has(x, y, z + 1) && m.has(x + 1, y, z) && m.has(x - 1, y, z) && m.has(x, y, z - 1);
  paint(jaw, (x, y, z) => !jaw.has(x, y + 1, z) && inner(jaw, x, y, z) && y + 0.5 > mouthY(x + 0.5) - 3, 0xd88a86);
  paint(head, (x, y, z) => !head.has(x, y - 1, z) && inner(head, x, y, z) && y + 0.5 < mouthY(x + 0.5) + 3 && z + 0.5 > R * 0.3, 0xc87476);
  // throat: soft pale pouch that puffs
  paint(rig.m('throat'), () => true, (x, y, z) => (n01(x, y, z, 1 / (R * 0.2), seed) > 0.7 ? 0xf6e2d6 : mixc(pal.belly, 0xf2d8cc, 0.4)));
  // nostrils
  for (const sgn of [1, -1]) {
    const xi = Math.floor(sgn * R * 0.12 + (sgn < 0 ? -0.5 : 0)), yi = Math.floor(C[1] + R * 0.05);
    const z = frontZ(head, xi, yi, Math.ceil(R * 1.4), 0);
    if (z !== null) {
      head.del(xi, yi, z);
      head.set(xi, yi, z - 1, 0x2a1a14);
    }
  }
  // cheek blush below the eyes (clean soft region)
  paint(head, (x, y, z) => {
    const gx = Math.abs(x + 0.5), gy = y + 0.5, gz = z + 0.5;
    return Math.hypot(gx - R * 0.55, gy - (C[1] - R * 0.03), gz - R * 0.72) < R * 0.17 && exposed(head, x, y, z);
  }, pal.blush);
  // ---------------------------------------------------------- big glossy eyes (anime catchlights) + heavy lids
  const eyeR = R * c.eyeK;
  const eL: V3 = [R * 0.43, R * 1.36, R * 0.6]; // high and bulging, frog-like
  const eR: V3 = [-eL[0], eL[1], eL[2]];
  for (const e of [eL, eR]) ell(head, e, [eyeR * 0.98, eyeR * 0.98, eyeR * 0.98], 0, { carve: true });
  const eyeL = rig.part('eye_l', 'head', eL);
  wetEye(eyeL, eL, eyeR, [0.5, 0.3, 0.82], { sclera: 0x1a110c, iris: 0x4e3422, pupil: 0x050403, irisR: 0.88, pupilR: 0.52 });
  paint(eyeL, (x, y, z) => hash3(x * 11, y * 13, z * 17) > 0.9 && exposed(eyeL, x, y, z) && eyeL.get(x, y, z)! !== 0xffffff, 0x8a6434, VF.METAL);
  // big + small catchlight (reads as cute under cel shading)
  {
    const f: V3 = [0.5, 0.3, 0.82];
    const l = Math.hypot(...f);
    const hp: V3 = [eL[0] + (f[0] / l) * eyeR * 0.6 + eyeR * 0.2, eL[1] + eyeR * 0.5, eL[2] + (f[2] / l) * eyeR * 0.7];
    ell(eyeL, hp, [Math.max(0.9, eyeR * 0.24), Math.max(0.9, eyeR * 0.24), Math.max(0.9, eyeR * 0.2)], 0xffffff, { keep: (_a, _b, _c, x, y, z) => eyeL.has(x, y, z) && exposed(eyeL, x, y, z) });
    const hp2: V3 = [eL[0] + (f[0] / l) * eyeR * 0.75 - eyeR * 0.15, eL[1] - eyeR * 0.15, eL[2] + (f[2] / l) * eyeR * 0.82];
    const hi = Math.floor(hp2[0]), hj = Math.floor(hp2[1]), hk = Math.floor(hp2[2]);
    if (eyeL.has(hi, hj, hk)) eyeL.set(hi, hj, hk, 0xf2f6ff);
  }
  rig.mirror('eye_l', 'eye_r');
  // heavy upper lids (sleepy-grumpy look) folded over the top of each globe
  for (const e of [eL, eR])
    blob(head, [{ c: [e[0] * 1.02, e[1] + eyeR * 0.58, e[2] - eyeR * 0.22], r: [eyeR * 1.06, eyeR * 0.46, eyeR * 0.96] }], (x, y, z) => (wartAt(x, y, z) ? pal.wart : pal.skin), { k: 1, keep: (x, y, z) => !eyeL.has(x, y, z) && !rig.m('eye_r').has(x, y, z) && y + 0.5 > e[1] + eyeR * 0.15 && z + 0.5 < e[2] + eyeR * 0.8, under: true });
  // ---------------------------------------------------------- stubby chubby arms with little hands
  const sh: V3 = [R * 0.58, C[1] - R * 0.46, R * 0.5];
  const el: V3 = [R * 0.72, R * 0.32, R * 0.6];
  const wr: V3 = [R * 0.68, R * 0.14, R * 0.78];
  const legFL = rig.part('leg_fl', 'body', sh);
  tube(legFL, [sh, el, wr], [R * 0.16, R * 0.15, R * 0.12], (x, y, z) => (y + 0.5 < R * 0.3 ? mixc(pal.skin, pal.belly, 0.4) : pal.skin));
  const footFL = rig.part('foot_fl', 'leg_fl', wr);
  blob(footFL, [{ c: [wr[0], wr[1] - R * 0.05, wr[2] + R * 0.05], r: [R * 0.16, R * 0.07, R * 0.14] }], pal.skin, { k: 1, keep: (_x, y) => y >= 0 });
  for (let f = 0; f < 4; f++) {
    const a = -0.65 + f * 0.43;
    const tip: V3 = [wr[0] + Math.sin(a) * R * 0.22, R * 0.045, wr[2] + Math.cos(a) * R * 0.21];
    cap(footFL, [wr[0], R * 0.08, wr[2] + R * 0.05], tip, R * 0.05, R * 0.042, pal.skin, { keep: (_a, _b, _c, _x, y) => y >= 0 });
    ell(footFL, tip, [R * 0.065, R * 0.045, R * 0.065], mixc(pal.hi, 0xf6dcd0, 0.5), { keep: (_a, _b, _c, _x, y) => y >= 0 }); // toe pads
  }
  // ---------------------------------------------------------- fat folded hind legs + splayed feet
  const hip: V3 = [R * 0.62, R * 0.48, -R * 0.42];
  const ank: V3 = [R * 0.72, R * 0.13, -R * 0.36];
  const legBL = rig.part('leg_bl', 'body', hip);
  blob(legBL, [
    { c: [R * 0.76, R * 0.32, -R * 0.34], r: [R * 0.3, R * 0.26, R * 0.42] }, // thigh
    { c: [R * 0.84, R * 0.2, -R * 0.12], r: [R * 0.2, R * 0.16, R * 0.3] }, // folded calf
  ], (x, y, z) => (y + 0.5 < R * 0.18 ? mixc(pal.skin, pal.belly, 0.4) : wartAt(x, y, z) ? pal.wart : pal.skin), { k: R * 0.12, disp: lumpy, keep: (_x, y) => y >= 0 });
  const footBL = rig.part('foot_bl', 'leg_bl', ank);
  blob(footBL, [{ c: [R * 0.74, R * 0.05, -R * 0.04], r: [R * 0.17, R * 0.06, R * 0.26] }], pal.skin, { k: 1, keep: (_x, y) => y >= 0 });
  for (let f = 0; f < 5; f++) {
    const a = -0.5 + f * 0.27;
    const tip: V3 = [R * 0.74 + Math.sin(a) * R * 0.28, R * 0.035, R * 0.02 + Math.cos(a) * R * 0.27];
    cap(footBL, [R * 0.74, R * 0.05, R * 0.02], tip, R * 0.046, R * 0.04, pal.skin, { keep: (_a, _b, _c, _x, y) => y >= 0 });
    ell(footBL, tip, [R * 0.06, R * 0.04, R * 0.06], mixc(pal.hi, 0xf6dcd0, 0.5), { keep: (_a, _b, _c, _x, y) => y >= 0 });
  }
  rig.mirror('leg_fl', 'leg_fr');
  rig.mirror('foot_fl', 'foot_fr', 'leg_fr');
  rig.mirror('leg_bl', 'leg_br');
  rig.mirror('foot_bl', 'foot_br', 'leg_br');

  // ---------------------------------------------------------- mama's finery
  let top = C[1] + R * 0.9;
  if (c.mama) {
    // pearl necklace resting in the fat fold under the chin
    for (let a = -1.2; a <= 1.201; a += 0.13) {
      const p: V3 = [Math.sin(a) * R * 0.98, R * 0.36 + Math.abs(Math.sin(a)) * R * 0.2, Math.cos(a) * R * 0.95];
      ell(rig.m('belly'), p, [R * 0.062, R * 0.062, R * 0.062], (x, y, z) => (hash3(x, y, z) > 0.75 ? 0xffffff : 0xefe4e2), { fl: VF.METAL, under: true });
    }
    // the wig: a mass of tight grey curls over crown, sides and back (each curl has a spiral groove)
    const hd = rig.m('head');
    const curls: V3[] = [];
    const cr = R * 0.15;
    let ring = 0;
    for (let elv = 0.2; elv < 1.5; elv += 0.15, ring++) {
      const n = Math.max(1, Math.round(Math.cos(elv) * 16));
      for (let i = 0; i < n; i++) {
        const az = (i / n) * Math.PI * 2 + (ring % 2) * 0.21;
        if (Math.cos(az) > 0.2 && elv < 0.9) continue; // leave the face
        const d: V3 = [Math.sin(az) * Math.cos(elv), Math.sin(elv), Math.cos(az) * Math.cos(elv)];
        const p: V3 = [d[0] * R * 1.04, C[1] + R * 0.2 + d[1] * R * 0.86, -R * 0.06 + d[2] * R * 0.98];
        if (p[1] < C[1] + R * 0.1) continue;
        curls.push(p);
      }
    }
    for (const s2 of [1, -1]) for (let i = 0; i < 3; i++) curls.push([s2 * R * (0.92 - i * 0.06), C[1] + R * (0.3 + i * 0.17), R * (0.4 - i * 0.12)]);
    curls.forEach((p, idx) => {
      const r = cr * (0.88 + hash3(idx, 3, 7) * 0.3);
      ell(hd, p, [r, r * 0.92, r], (x, y, z) => {
        const vx = x + 0.5 - p[0], vy = y + 0.5 - p[1], vz = z + 0.5 - p[2];
        const ang = Math.atan2(vy, vx + vz * 0.5);
        const rr = Math.hypot(vx, vy, vz) / r;
        const groove = Math.sin(ang * 1 + rr * 7) > 0.55;
        return groove ? 0x9c96a4 : rr > 0.78 ? 0xc6c0ce : 0xdedbe4;
      }, { under: true });
    });
    top = C[1] + R * 0.2 + R * 0.86 + cr * 1.6;
    // the little hat: felt cloche with a dented crown, curled brim, band, rose, daisy, veil
    const hb: V3 = [R * 0.1, top - cr * 0.8, -R * 0.04];
    const hat = rig.part('hat', 'head', hb);
    const tilt: V3 = [-0.14, 0.15, -0.2];
    const hr = R * 0.47;
    blob(hat, [
      { c: [hb[0], hb[1] + R * 0.17, hb[2]], r: [hr * 0.82, R * 0.2, hr * 0.82], rot: tilt }, // crown
      { c: [hb[0], hb[1] + R * 0.02, hb[2]], r: [hr * 1.15, R * 0.06, hr * 1.15], rot: tilt }, // brim
      { c: [hb[0], hb[1] + R * 0.38, hb[2] + R * 0.05], r: [hr * 0.36, R * 0.08, hr * 0.2], rot: tilt, sub: true, k: R * 0.06 }, // crown dent
    ], (x, y, z) => {
      const rel = y + 0.5 - hb[1];
      if (rel > R * 0.05 && rel < R * 0.14) return 0x7a3a50; // band
      return n01(x, y, z, 1 / (R * 0.25), 21) > 0.62 ? 0xc48ea0 : 0xb47888;
    }, { k: R * 0.07 });
    // rose on the right side of the band (petals spiral in clear colour bands)
    const rose: V3 = [hb[0] - hr * 0.86, hb[1] + R * 0.12, hb[2] + hr * 0.3];
    blob(hat, [{ c: rose, r: [R * 0.13, R * 0.12, R * 0.13] }], (x, y, z) => {
      const a = Math.atan2(z + 0.5 - rose[2], x + 0.5 - rose[0]);
      const rr = Math.hypot(x + 0.5 - rose[0], z + 0.5 - rose[2]);
      const sp = Math.sin(a * 2 + rr * (6 / (R * 0.13)));
      return sp > 0.25 ? 0xc02a3c : sp > -0.35 ? 0x9a1a2c : 0xe2485c;
    }, { k: 1, disp: lumps(R * 0.012, 1 / (R * 0.05), 5) });
    blob(hat, [{ c: [rose[0] + R * 0.04, rose[1] - R * 0.07, rose[2] + R * 0.15], r: [R * 0.06, R * 0.025, R * 0.1], rot: [0.3, 0.5, 0] }], 0x5a7c34, { k: 1, under: true });
    // daisy on the other side
    const dz: V3 = [hb[0] + hr * 0.72, hb[1] + R * 0.2, hb[2] + hr * 0.48];
    for (let pi = 0; pi < 8; pi++) {
      const a = (pi / 8) * Math.PI * 2;
      blob(hat, [{ c: [dz[0] + Math.cos(a) * R * 0.075, dz[1] + Math.sin(a) * R * 0.075, dz[2] + R * 0.03], r: [R * 0.05, R * 0.028, R * 0.03], rot: [0, 0, a] }], 0xf8f4ec, { k: 1, under: true });
    }
    ell(hat, [dz[0], dz[1], dz[2] + R * 0.05], [R * 0.04, R * 0.04, R * 0.03], 0xe8b428);
    // veil: a neat sparse net hanging off the front brim over the brow
    const vz = hb[2] + hr * 0.98;
    for (let xi = Math.floor(hb[0] - hr * 0.9); xi <= Math.ceil(hb[0] + hr * 0.7); xi++)
      for (let yi = Math.floor(hb[1] - R * 0.34); yi <= Math.floor(hb[1]); yi++) {
        if ((xi + yi) % 2 !== 0) continue;
        const sag = Math.round(((xi + 0.5 - hb[0]) / hr) ** 2 * 1.5);
        const zz = Math.floor(vz + (hb[1] - yi) * 0.22) - sag;
        if (!head.has(xi, yi, zz) && !rig.m('eye_l').has(xi, yi, zz) && !rig.m('eye_r').has(xi, yi, zz)) hat.set(xi, yi, zz, 0x7a6a88);
      }
    // purse dangling from her left wrist (soft sagging leather bag, strap, brass clasp)
    const purse = rig.part('purse', 'foot_fl', [wr[0] + R * 0.04, wr[1] + R * 0.12, wr[2] + R * 0.02]);
    const pc: V3 = [wr[0] + R * 0.14, wr[1] + R * 0.02, wr[2] + R * 0.12];
    blob(purse, [
      { c: pc, r: [R * 0.07, R * 0.12, R * 0.16] },
      { c: [pc[0], pc[1] - R * 0.07, pc[2]], r: [R * 0.075, R * 0.07, R * 0.17] },
    ], (_x, y) => (y + 0.5 > pc[1] + R * 0.06 ? 0x9a6e2c : 0xb88a40), { k: R * 0.05 });
    tube(purse, [[pc[0], pc[1] + R * 0.11, pc[2] - R * 0.09], [pc[0], pc[1] + R * 0.21, pc[2]], [pc[0], pc[1] + R * 0.11, pc[2] + R * 0.09]], [R * 0.022, R * 0.022, R * 0.022], 0x5e3e1c);
    box(purse, [pc[0] - R * 0.02, pc[1] + R * 0.08, pc[2] - R * 0.025], [pc[0] + R * 0.09, pc[1] + R * 0.115, pc[2] + R * 0.025], 0xe8c860, { fl: VF.METAL });
    top = hb[1] + R * 0.42;
  }
  hollow(body, 3);
  hollow(rig.m('belly'), 3);
  rig.socket('head_top', 'head', [0, top, 0]);
  rig.socket('mouth', 'jaw', [0, mouthY(0), R * 1.0]);
  rig.socket('back', 'body', [0, C[1] + R * 0.3, -R * 0.95]);
  const vs = c.vs;
  const m3 = (p: V3) => [p[0] * vs, p[1] * vs, p[2] * vs];
  return rig.build({
    kind: 'frog',
    height: top * vs,
    radius: R * 1.12 * vs,
    length: R * 2 * vs,
    bodyCenter: m3(C),
    eyes: { l: m3(eL), r: m3(eR), radius: eyeR * vs },
    throatCenter: m3(thr),
    /** puff: scale the `throat` part up to ~1.6x; jiggle: scale `belly` */
    puffMax: 1.6,
    expressions: jawExpressions({ neutral: 0, happy: 0.12, surprised: 0.35, scared: 0.28, laugh: 0.3, sing: 0.4, hurt: 0.15, sleepy: 0.02 }),
    defaultExpression: 'neutral',
  });
}

/** the mama rain frog (old lady wig, felt hat with rose, daisy and veil, pearls, purse) ~0.95 m with hat */
export const rainFrogMamaRig = memo((_: void): RigSpec => frog({ name: 'rain_frog_mama', vs: 1 / 56, R: 24, pal: MAMA_PAL, eyeK: 0.23, mama: true, seed: 7 }));
/** a tiny rain froglet, ~0.22 m; variant 0-4 = colour morph */
export const rainFrogBabyRig = memo((o: { variant?: number } = {}): RigSpec => {
  const v = (((o?.variant ?? 0) % BABY_PALS.length) + BABY_PALS.length) % BABY_PALS.length;
  return frog({ name: 'rain_frog_baby_' + v, vs: 1 / 80, R: 9, pal: BABY_PALS[v], eyeK: 0.3, mama: false, seed: 11 + v * 3 });
});
