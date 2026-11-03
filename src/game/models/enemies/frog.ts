// Desert rain frogs (Breviceps macrops): round, squishy, grumpy-mouthed and
// adorable. The mama has a big mouth and a long sticky rigged tongue, and wears a
// big fabulous lilac curly wig (also a hat for the hunter: `frogWigHat()`), pearls
// and a tiny purse. Also a little desert moth for her to catch (`desertMothRig`).
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
// Desert rain frogs (Breviceps macrops), as cute as the real thing: a round,
// squishy body that settles onto the sand, big glossy dark eyes under soft
// grumpy lids (rigged `lid_l`/`lid_r`: they blink and pull into moods), a wide
// downturned mouth with a modelled jaw over a real mouth cavity (ridged palate,
// floor, gullet), tiny stubby legs and soft warm colours.
// Mama: a BIG mouth and a long sticky tongue: a 12-segment telescoping chain
// (`tongue1`..`tongue12` + `tongue_tip`, all pivoting at the root on the front
// of the mouth floor) that lies folded back along the floor at rest and flips out
// over the lip like a real frog's. She wears pearls, a little purse and a big
// fabulous lilac curly wig (`wig` + bouncy `ringlet_*` parts), the very wig the
// hunter can wear afterwards (`frogWigHat()`).
interface FrogPal {
  skin: number;
  lo: number;
  hi: number;
  belly: number;
  blush: number;
  lip: number;
}
const BABY_PALS: FrogPal[] = [
  { skin: 0xe2bc8c, lo: 0xc79c6c, hi: 0xf3dab4, belly: 0xfaf0e2, blush: 0xf5a496, lip: 0xf3dfc4 }, // sand peach
  { skin: 0xd4c8b6, lo: 0xb0a18e, hi: 0xede6da, belly: 0xfbf7f0, blush: 0xf2aaae, lip: 0xefe8dc }, // cream grey
  { skin: 0xdeaa6e, lo: 0xbe884e, hi: 0xf2cd98, belly: 0xf8ead4, blush: 0xf59e86, lip: 0xf3d9b4 }, // honey
  { skin: 0xd0c08e, lo: 0xab9d6c, hi: 0xe6dcb2, belly: 0xf6f2de, blush: 0xefa894, lip: 0xebe3c6 }, // olive sand
  { skin: 0xe6b4a0, lo: 0xc78e7a, hi: 0xf7d6c8, belly: 0xfcefe8, blush: 0xf8969e, lip: 0xf7ddd2 }, // rosy
];
const MAMA_PAL: FrogPal = { skin: 0xd8aa7a, lo: 0xb98a5c, hi: 0xeecba2, belly: 0xf7e9d6, blush: 0xf2988c, lip: 0xf2dcc0 };
/** mouth interior */
const MOUTH = { floor: 0xd8727e, palate: 0xc46474, ridge: 0xac5064, gullet: 0x5a1e28, gum: 0xe69a9c, line: 0x5a2c2a };
/** the wig: soft lilac "blue rinse" curls and a hot-pink satin bow with a pearl */
const WIG = { base: 0xb9a2de, shade: 0x9882c4, deep: 0x6c5496, hi: 0xd7c8f1, sheen: 0xf1e8fc, bow: 0xe4558e, bowShade: 0xbb3a6c, bowDeep: 0x8c2450, bowHi: 0xf794bc, pearl: 0xfaf4ec };

interface FrogCfg {
  name: string;
  vs: number;
  R: number;
  pal: FrogPal;
  eyeK: number;
  mama: boolean;
  seed: number;
}

// ---------------------------------------------------------------- little vector helpers
const nrm3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add3 = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
/** local -> world for euler [pitch X, yaw Y, roll Z] (the inverse of the shape kit's orientation) */
function rotFwd(p: V3, r: V3): V3 {
  let [x, y, z] = p;
  let c = Math.cos(r[2]), s = Math.sin(r[2]);
  [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(r[0]);
  s = Math.sin(r[0]);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(r[1]);
  s = Math.sin(r[1]);
  [x, z] = [x * c + z * s, -x * s + z * c];
  return [x, y, z];
}
/** world -> local for the same euler */
function rotInv(p: V3, r: V3): V3 {
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

/** first filled voxel scanning from the front (+Z) along a row — the face surface */
function frontZ(m: VoxelModel, xi: number, yi: number, zMax: number, zMin: number) {
  for (let k = zMax; k >= zMin; k--) if (m.has(xi, yi, k)) return k;
  return null;
}

/** recolour one surface voxel near p (tiny catchlights that an ellipsoid would miss) */
function dabAt(m: VoxelModel, p: V3, back: V3, col: number) {
  for (let s = 0; s < 4; s++) {
    const x = Math.floor(p[0] - back[0] * s), y = Math.floor(p[1] - back[1] * s), z = Math.floor(p[2] - back[2] * s);
    if (m.has(x, y, z)) {
      m.set(x, y, z, col);
      return;
    }
  }
}

// ---------------------------------------------------------------- eyes and lids
/**
 * big glossy anime-cute frog eye: a dark wet globe, a bronze iris ring, a wide
 * oval pupil, a warm light bounce in the lower iris and two catchlights that sit
 * in the same screen corner on both eyes (as real light does)
 */
function cuteEye(m: VoxelModel, c: V3, r: number, fwd: V3, ring: number, iris: number) {
  const f = nrm3(fwd);
  const e1 = nrm3(cross3([0, 1, 0], f));
  const e2 = cross3(f, e1);
  ell(m, c, [r, r, r], (x, y, z) => {
    const p: V3 = [x + 0.5 - c[0], y + 0.5 - c[1], z + 0.5 - c[2]];
    if (dot3(p, f) / r < 0.12) return 0x22160f;
    const u = dot3(p, e1) / r, w = dot3(p, e2) / r;
    const d = Math.hypot(u, w);
    if (d > 0.86) return 0x2c1d13;
    if ((u / 0.5) ** 2 + ((w + 0.03) / 0.4) ** 2 < 1) return 0x070403; // pupil (slightly wide, frog-like)
    if (w < -0.42 && Math.abs(u) < 0.52) return mixc(ring, 0xf6d49a, 0.3); // warm bounce light
    if (d > 0.68) return ring;
    return w > 0.32 ? mulc(iris, 0.72) : iris; // the lid shades the top of the iris
  }, { fl: VF.METAL });
  const X: V3 = [1, 0, 0];
  const big = add3(add3(add3(c, f, r * 0.8), e2, r * 0.42), X, r * 0.24);
  const br = Math.max(0.95, r * 0.24);
  ell(m, big, [br, br, br], 0xffffff, { keep: (_a, _b, _c, x, y, z) => m.has(x, y, z) && exposed(m, x, y, z) });
  dabAt(m, big, f, 0xffffff);
  const small = add3(add3(add3(c, f, r * 0.92), e2, -r * 0.34), X, -r * 0.24);
  if (r * 0.13 >= 0.9) ell(m, small, [r * 0.13, r * 0.13, r * 0.13], 0xeef4ff, { keep: (_a, _b, _c, x, y, z) => m.has(x, y, z) && exposed(m, x, y, z) });
  else dabAt(m, small, f, 0xeef4ff);
}

/** a soft skin eyelid: a spherical cap hugging the globe (pivot = eye centre; +X rotation closes it) */
function lidCap(m: VoxelModel, c: V3, r: number, axis: V3, half: number, skin: number, rim: number) {
  const a = nrm3(axis);
  const r0 = r * 1.03 + 0.15, r1 = r0 + Math.max(1.3, r * 0.22);
  const ch = Math.cos(half), chr = Math.cos(half - Math.max(0.1, 1.15 / r1));
  const B = Math.ceil(r1) + 1;
  for (let i = Math.floor(c[0] - B); i <= Math.ceil(c[0] + B); i++)
    for (let j = Math.floor(c[1] - B); j <= Math.ceil(c[1] + B); j++)
      for (let k = Math.floor(c[2] - B); k <= Math.ceil(c[2] + B); k++) {
        const p: V3 = [i + 0.5 - c[0], j + 0.5 - c[1], k + 0.5 - c[2]];
        const l = Math.hypot(p[0], p[1], p[2]);
        if (l < r0 || l > r1) continue;
        const ca = dot3(p, a) / l;
        if (ca < ch) continue;
        m.set(i, j, k, ca < chr ? rim : skin);
      }
}

// ---------------------------------------------------------------- the sticky tongue
/** one telescoping tongue segment: lies from `root` back along -Z for L voxels, flat top with a midline groove */
function tongueSeg(m: VoxelModel, root: V3, L: number, rx: number, ry: number, seed: number) {
  const top = 0xe27884, groove = 0xc65a6a, side = 0xd86a78, under = 0xf0a2a8, wet = 0xffd2da;
  for (let k = Math.floor(root[2] - L - 2); k <= Math.ceil(root[2] + 2); k++) {
    const u = (root[2] - (k + 0.5)) / L;
    if (u < -0.06 || u > 1.06) continue;
    const e = u < 0.1 ? Math.sqrt(Math.max(0, 1 - ((0.1 - u) / 0.16) ** 2)) : u > 0.9 ? Math.sqrt(Math.max(0, 1 - ((u - 0.9) / 0.16) ** 2)) : 1;
    if (e < 0.2) continue;
    const ax = rx * e, ay = ry * e;
    for (let i = Math.floor(root[0] - ax - 1); i <= Math.ceil(root[0] + ax); i++)
      for (let j = Math.floor(root[1] - ay - 1); j <= Math.ceil(root[1] + ay); j++) {
        const dx = (i + 0.5 - root[0]) / ax, dy = (j + 0.5 - root[1]) / ay;
        const q = dx * dx + (dy > 0 ? Math.pow(Math.abs(dy), 2.6) : dy * dy); // flatter on top
        if (q > 1) continue;
        let col = dy > 0.3 ? (Math.abs(i + 0.5 - root[0]) < 0.75 ? groove : top) : dy < -0.35 ? under : side;
        if (dy > 0.3 && hash3(i + seed, j, k) > 0.94) col = wet;
        m.set(i, j, k, col);
      }
  }
}
/** the sticky tip: a bulbous, gently cleft, glossy pad */
function tonguePad(m: VoxelModel, at: V3, R: number) {
  blob(m, [
    { c: [at[0] + R * 0.06, at[1], at[2] - R * 0.07], r: [R * 0.12, R * 0.08, R * 0.12] },
    { c: [at[0] - R * 0.06, at[1], at[2] - R * 0.07], r: [R * 0.12, R * 0.08, R * 0.12] },
    { c: [at[0], at[1] + R * 0.02, at[2] - R * 0.2], r: [R * 0.035, R * 0.06, R * 0.05], sub: true, k: R * 0.04 },
  ], (_x, y) => {
    const dy = y + 0.5 - at[1];
    return dy > R * 0.04 ? 0xd85a6c : dy < -R * 0.03 ? 0xec8c98 : 0xe06a7a;
  }, { k: R * 0.06, fl: VF.METAL });
  paint(m, (x, y, z) => !m.has(x, y + 1, z) && hash3(x * 5, y * 3, z * 7) > 0.86, 0xffe0e6, VF.SOLID);
}

// ---------------------------------------------------------------- the fabulous curly wig
/** how a wig sits on a head (geometric voxel coords of the wearer) */
interface WigFit {
  /** head ellipsoid the wig sits on */
  hc: V3;
  hr: V3;
  /** curl ball radius */
  cr: number;
  /** keep the face clear: no hair where z > faceZ, y < browY and |x| < faceX */
  faceZ: number;
  browY: number;
  faceX: number;
  /** lowest the hair falls (back and sides) */
  hangY: number;
  /** ringlet length and ball radius */
  ringLen: number;
  ringR: number;
  /** where the bow sits (direction from the wig centre), its size and jaunty roll */
  bowDir: V3;
  bowS: number;
  bowRoll: number;
  seed: number;
}
/** the hair mass: a teased bouffant dome piled high, a back fall, side puffs framing the face, a fringe roll */
function wigMass(f: WigFit): Prim[] {
  const [x0, y0, z0] = f.hc, [S, H, D] = f.hr;
  return [
    { c: [x0, y0 + H * 0.58, z0 - D * 0.1], r: [S * 1.36, H * 0.8, D * 1.28] },
    { c: [x0, y0 + H * 1.02, z0 - D * 0.18], r: [S * 0.95, H * 0.5, D * 0.9] },
    { c: [x0, y0 - H * 0.1, z0 - D * 0.55], r: [S * 1.26, H * 0.92, D * 0.74] },
    { c: [x0 + S * 1.1, y0 - H * 0.02, z0 - D * 0.04], r: [S * 0.52, H * 0.82, D * 0.74] },
    { c: [x0 - S * 1.1, y0 - H * 0.02, z0 - D * 0.04], r: [S * 0.52, H * 0.82, D * 0.74] },
    { c: [x0, y0 + H * 0.66, z0 + D * 0.66], r: [S * 1.0, H * 0.3, D * 0.42] },
  ];
}
const wigCentre = (f: WigFit): V3 => [f.hc[0], f.hc[1] + f.hr[1] * 0.3, f.hc[2] - f.hr[2] * 0.15];
/** ringlet anchors: [left front, left back, right front, right back] */
function wigRinglets(f: WigFit): V3[] {
  const [x0, y0, z0] = f.hc, [S, H, D] = f.hr;
  return [
    [x0 + S * 1.2, y0 - H * 0.48, z0 + D * 0.22],
    [x0 + S * 0.96, y0 - H * 0.6, z0 - D * 0.52],
    [x0 - S * 1.2, y0 - H * 0.48, z0 + D * 0.22],
    [x0 - S * 0.96, y0 - H * 0.6, z0 - D * 0.52],
  ];
}
/** march from inside the mass along d to its surface */
function marchOut(prims: Prim[], k: number, from: V3, d: V3, maxT: number): V3 | null {
  for (let t = 0; t < maxT; t += 0.4) {
    const p = add3(from, d, t);
    if (blobSdf(prims, k, p[0], p[1], p[2]) > 0) return p;
  }
  return null;
}
function sdfNormal(prims: Prim[], k: number, p: V3): V3 {
  const e = 0.6;
  const g = (dx: number, dy: number, dz: number) => blobSdf(prims, k, p[0] + dx, p[1] + dy, p[2] + dz);
  return nrm3([g(e, 0, 0) - g(-e, 0, 0), g(0, e, 0) - g(0, -e, 0), g(0, 0, e) - g(0, 0, -e)]);
}
/** one tight curl: a ball with a spiral groove winding round its outward axis, lit from above */
function curlBall(m: VoxelModel, q: V3, r: number, n: V3, seed: number, ok: (x: number, y: number, z: number) => boolean) {
  const up: V3 = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = nrm3(cross3(up, n)), e2 = cross3(n, e1);
  const ph = hash3(seed, 3, 9) * Math.PI * 2;
  const turn = 6.5 + hash3(seed, 7, 1) * 2;
  ell(m, q, [r, r * 0.94, r], (x, y, z) => {
    if (!ok(x, y, z)) return null;
    const a: V3 = [x + 0.5 - q[0], y + 0.5 - q[1], z + 0.5 - q[2]];
    const along = dot3(a, n) / r;
    const u = dot3(a, e1) / r, w = dot3(a, e2) / r;
    const rho = Math.hypot(u, w), phi = Math.atan2(w, u);
    const lit = along * 0.5 + (a[1] / r) * 0.5;
    if (Math.sin(phi + rho * turn + ph) > 0.6 && along > -0.25) return along > 0.4 ? WIG.shade : WIG.deep;
    if (lit > 0.72 && along > 0.45) return WIG.sheen;
    return lit > 0.3 ? WIG.hi : lit > -0.28 ? WIG.base : WIG.shade;
  });
}
/** a corkscrew ringlet: curls stacked along a tightening helix, ending in a little flick */
function ringlet(m: VoxelModel, at: V3, f: WigFit, idx: number) {
  const side = at[0] >= f.hc[0] ? 1 : -1;
  const K = Math.max(4, Math.round(f.ringLen / (f.ringR * 0.85)) + 1);
  for (let j = 0; j < K; j++) {
    const t = j / (K - 1);
    const a = j * 2.2 + idx * 1.3;
    const hr = f.ringR * 0.55 * (1 - 0.3 * t);
    const q: V3 = [at[0] + Math.cos(a) * hr + side * t * f.ringR * 0.35, at[1] - t * f.ringLen, at[2] + Math.sin(a) * hr];
    curlBall(m, q, f.ringR * (1 - 0.42 * t), nrm3([Math.cos(a) * side, 0.25, Math.sin(a)]), 977 + idx * 13 + j, () => true);
  }
}
/** a satin bow (two loops with folds, a pinched knot with a pearl, two tails) pinned to the curls */
function wigBow(m: VoxelModel, f: WigFit, mass: Prim[], k: number) {
  const d = nrm3(f.bowDir);
  const s = marchOut(mass, k, wigCentre(f), d, f.hr[0] * 5);
  if (!s) return;
  const bs = f.bowS;
  const c = add3(s, d, -bs * 0.12);
  const rot: V3 = [-Math.asin(d[1]), Math.atan2(d[0], d[2]), f.bowRoll];
  const prims: Prim[] = [
    { c: [bs * 0.88, bs * 0.1, 0], r: [bs * 0.9, bs * 0.58, bs * 0.34], rot: [0, 0, 0.2] },
    { c: [-bs * 0.88, bs * 0.1, 0], r: [bs * 0.9, bs * 0.58, bs * 0.34], rot: [0, 0, -0.2] },
    { c: [bs * 1.05, bs * 0.12, bs * 0.32], r: [bs * 0.42, bs * 0.22, bs * 0.22], sub: true, k: bs * 0.2 },
    { c: [-bs * 1.05, bs * 0.12, bs * 0.32], r: [bs * 0.42, bs * 0.22, bs * 0.22], sub: true, k: bs * 0.2 },
    { c: [0, 0, bs * 0.08], r: [bs * 0.34, bs * 0.4, bs * 0.34] },
    { c: [bs * 0.42, -bs * 0.78, -bs * 0.04], r: [bs * 0.2, bs * 0.62, bs * 0.12], rot: [0, 0, 0.5] },
    { c: [-bs * 0.42, -bs * 0.78, -bs * 0.04], r: [bs * 0.2, bs * 0.62, bs * 0.12], rot: [0, 0, -0.5] },
  ];
  const B = Math.ceil(bs * 2.3) + 1;
  for (let i = Math.floor(c[0] - B); i <= Math.ceil(c[0] + B); i++)
    for (let j = Math.floor(c[1] - B); j <= Math.ceil(c[1] + B); j++)
      for (let kk = Math.floor(c[2] - B); kk <= Math.ceil(c[2] + B); kk++) {
        const l = rotInv([i + 0.5 - c[0], j + 0.5 - c[1], kk + 0.5 - c[2]], rot);
        if (blobSdf(prims, bs * 0.16, l[0], l[1], l[2]) > 0) continue;
        const ax = Math.abs(l[0]);
        let col = WIG.bow;
        if (ax < bs * 0.36 && l[1] > -bs * 0.45) col = ax < bs * 0.1 ? WIG.bowDeep : WIG.bowShade; // pinched knot
        else if (l[1] < -bs * 0.42) col = l[1] < -bs * 1.2 ? WIG.bowShade : WIG.bow; // tails
        else if (l[2] > bs * 0.12 && Math.hypot(ax - bs * 1.05, l[1] - bs * 0.12) < bs * 0.36) col = WIG.bowDeep; // inside the loop
        else if (Math.sin(Math.atan2(l[1], ax - bs * 0.15) * 4) > 0.55) col = WIG.bowShade; // satin folds
        else if (l[1] > bs * 0.3) col = WIG.bowHi;
        else if (l[1] < -bs * 0.28) col = WIG.bowShade;
        m.set(i, j, kk, col);
      }
  const pearl = add3(c, rotFwd([0, bs * 0.02, bs * 0.44], rot));
  const pr = Math.max(0.8, bs * 0.17);
  ell(m, pearl, [pr, pr, pr], WIG.pearl, { fl: VF.METAL });
  dabAt(m, add3(pearl, d, pr * 0.8), d, 0xffffff);
}
/** sculpt the whole wig into `m` (ringlets into `rings[i]` when given, so they can bounce) */
function curlyWig(m: VoxelModel, f: WigFit, rings?: VoxelModel[]) {
  const mass = wigMass(f);
  const [S, H, D] = f.hr;
  const k = S * 0.32;
  const ok = (x: number, y: number, z: number) => {
    const gx = x + 0.5, gy = y + 0.5, gz = z + 0.5;
    if (gy < f.hangY) return false;
    if (gz > f.faceZ && gy < f.browY && Math.abs(gx - f.hc[0]) < f.faceX) return false;
    const ex = (gx - f.hc[0]) / S, ey = (gy - f.hc[1]) / H, ez = (gz - f.hc[2]) / D;
    return ex * ex + ey * ey + ez * ez > 0.86; // hollow cap: it sits ON the head (and is hollow when lifted off)
  };
  // shadowed core between the curls
  blob(m, mass, (x, y, z) => (ok(x, y, z) ? WIG.deep : null), { k, disp: () => f.cr * 0.55 });
  // tight curls over the whole surface (fibonacci-spread, each on the true surface normal)
  const mc = wigCentre(f);
  const avg = (S * 1.3 + H * 1.05 + D * 1.15) / 3;
  const n = Math.round(((4 * avg * avg) / (f.cr * f.cr)) * 1.35);
  for (let i = 0; i < n; i++) {
    const yv = 1 - (2 * (i + 0.5)) / n, rr = Math.sqrt(1 - yv * yv), th = i * 2.399963;
    const d: V3 = [Math.cos(th) * rr, yv, Math.sin(th) * rr];
    const s = marchOut(mass, k, mc, d, avg * 4);
    if (!s) continue;
    const q = add3(s, d, -f.cr * 0.3);
    if (q[1] < f.hangY + f.cr * 0.2) continue;
    if (q[2] > f.faceZ && q[1] < f.browY && Math.abs(q[0] - f.hc[0]) < f.faceX) continue;
    curlBall(m, q, f.cr * (0.86 + hash3(i, f.seed, 5) * 0.3), sdfNormal(mass, k, s), i * 7 + f.seed * 31, ok);
  }
  wigRinglets(f).forEach((a, i) => ringlet(rings?.[i] ?? m, a, f, i));
  wigBow(m, f, mass, k);
}

/** the hunter's fit: Sundown's skull (1/36 grid, rows 48-62, 12 wide, brows ~57, face front z 6) */
const SUNDOWN_WIG: WigFit = { hc: [0, 56, -0.5], hr: [6.6, 7.6, 7.0], cr: 2.35, faceZ: 1, browY: 58.6, faceX: 6.9, hangY: 46.5, ringLen: 6.5, ringR: 1.85, bowDir: [0.55, 0.7, 0.45], bowS: 2.3, bowRoll: -0.45, seed: 3 };

/** voxel size of the wig hat (Sundown's grid) */
export const FROG_WIG_VS = 1 / 36;
/** the hat part's joint in Sundown's rig (same as every hat: `J.hat`) */
export const FROG_WIG_PIVOT: V3 = [0, 59, -1];
/** `hat_top` row for the wig (the top of the bouffant), for `HAT_TOP` */
export const FROG_WIG_TOP = 69;
const wigHatBase = memo((_: void): VoxelModel => {
  const m = new VoxelModel('hat');
  curlyWig(m, SUNDOWN_WIG);
  hollow(m, 2);
  return m;
});
/**
 * Mama Rain Frog's big fabulous curly wig as a hat for the hunter: lilac bouffant,
 * corkscrew ringlets, satin bow with a pearl. Authored in Sundown's rig space like
 * every hat in characters/skeleton.ts: part `hat`, parent `head`, pivot/attach
 * `FROG_WIG_PIVOT` ([0,59,-1]), voxel size `FROG_WIG_VS` (1/36); `hat_top` row
 * `FROG_WIG_TOP`. Returns a fresh copy.
 */
export function frogWigHat(): VoxelModel {
  return wigHatBase().clone();
}

// ---------------------------------------------------------------- the frog
function frog(c: FrogCfg): RigSpec {
  const { R, pal, seed, mama } = c;
  const rig = new CRig(c.name, c.vs);
  const C: V3 = [0, R * 0.8, 0];
  const eyeR = R * c.eyeK;
  const eL: V3 = [R * 0.45, R * (mama ? 1.2 : 1.16), R * (mama ? 0.7 : 0.72)]; // bulging out of the face, frog-like
  const eR: V3 = [-eL[0], eL[1], eL[2]];
  const W = R * (mama ? 0.86 : 0.62); // mouth half-width: mama's is BIG
  const mouthY0 = C[1] - R * (mama ? 0.08 : 0.05);
  const droop = R * (mama ? 0.15 : 0.13);
  const mouthY = (x: number) => mouthY0 - droop * Math.min(1, (x / W) ** 2); // grumpy downturned line
  const zH = R * 0.06; // jaw hinge plane
  const body = rig.part('body', undefined, [0, C[1], 0]);
  // ---------------------------------------------------------- the plump, squishy flesh mass
  const mound = (s: number): Prim => ({ c: [s * eL[0] * 0.97, eL[1] - eyeR * 0.22, eL[2] - eyeR * 0.4], r: [eyeR * 1.3, eyeR * 1.12, eyeR * 1.2] });
  const dimple = (s: number): Prim => ({ c: [s * W * 0.93, mouthY(W) + R * 0.01, R * (mama ? 0.6 : 0.68)], r: [R * 0.1, R * 0.08, R * 0.1], sub: true, k: R * 0.08 });
  const prims: Prim[] = [
    { c: [0, R * 0.82, -R * 0.04], r: [R, R * 0.8, R * 0.94] }, // round main mass
    { c: [0, R * 0.42, R * 0.04], r: [R * 1.07, R * 0.42, R * 0.9] }, // belly settling onto the sand
    { c: [R * 0.5, R * 0.64, R * 0.5], r: [R * 0.44, R * 0.36, R * 0.38] }, // puffy cheeks
    { c: [-R * 0.5, R * 0.64, R * 0.5], r: [R * 0.44, R * 0.36, R * 0.38] },
    { c: [0, R * 0.58, -R * 0.6], r: [R * 0.82, R * 0.46, R * 0.42] }, // rump
    { c: [0, R * 0.9, R * 0.6], r: [R * 0.42, R * 0.3, R * 0.34] }, // short blunt snout
    mound(1),
    mound(-1),
    dimple(1),
    dimple(-1),
  ];
  const lumpy = lumps(R * 0.012, 1 / (R * 0.5), seed);
  const fold = (x: number, y: number, z: number) => {
    const chin = Math.exp(-(((y - R * 0.38) / (R * 0.045)) ** 2)) * R * (mama ? 0.07 : 0.03) * (z > R * 0.45 && Math.abs(x) < R * 0.7 ? 1 : 0);
    if (!mama) return chin;
    // granny's fat roll round the sides and back
    const side = Math.min(1, Math.max(0, (Math.abs(x) - R * 0.45) / (R * 0.3))) * (z < R * 0.55 ? 1 : 0.2);
    return chin + Math.exp(-(((y - R * 0.52) / (R * 0.05)) ** 2)) * R * 0.08 * side;
  };
  // clean soft colour regions: warm base, a few darker dorsal mottles, pale belly, sparse light granules
  const skin = (x: number, y: number, z: number) => {
    const gy = y + 0.5;
    const warp = noise.n3(x * (0.9 / R) + seed, y * (0.9 / R), z * (0.9 / R)) * R * 0.08;
    if (gy + warp < R * 0.46) return pal.belly;
    if (gy + warp < R * 0.56) return mixc(pal.belly, pal.skin, 0.5);
    if (gy > R * 0.62 && hash3(x * 7 + seed, y * 3, z * 5) > (mama ? 0.93 : 0.955)) return pal.hi;
    if (n01(x, y, z, 1 / (R * 0.5), seed + 4) > 0.67 && gy > R * 0.78) return pal.lo;
    return pal.skin;
  };
  blob(body, prims, skin, { k: R * 0.28, disp: (x, y, z) => lumpy(x, y, z) + fold(x, y, z), keep: (_x, y) => y >= 0 });
  smoothVox(body, mama ? 1 : 2);
  // ---------------------------------------------------------- the mouth line, then split head / jaw / throat / belly
  const seen = new Set<number>();
  for (let x = -W; x <= W; x += 0.25) {
    const xi = Math.floor(x), yi = Math.floor(mouthY(x));
    const key = xi * 4096 + yi;
    if (seen.has(key)) continue;
    seen.add(key);
    const z = frontZ(body, xi, yi, Math.ceil(R * 1.4), 0);
    if (z === null) continue;
    body.del(xi, yi, z);
    if (body.has(xi, yi, z - 1)) body.set(xi, yi, z - 1, MOUTH.line);
  }
  rig.part('head', 'body', [0, C[1] - R * 0.1, R * 0.04]);
  rig.part('jaw', 'body', [0, mouthY(W), zH]);
  const thr: V3 = [0, mouthY0 - R * 0.36, R * 0.62];
  rig.part('throat', 'jaw', [0, thr[1] + R * 0.12, thr[2] - R * 0.04]);
  rig.part('belly', 'body', [0, R * 0.36, R * 0.1]);
  rig.move('body', 'jaw', (x, y, z) => {
    const gx = x + 0.5, gy = y + 0.5;
    return z + 0.5 > zH && gy < mouthY(gx) && gy > mouthY(gx) - R * 0.3 && Math.abs(gx) < W + R * 0.05;
  });
  rig.move('body', 'throat', (x, y, z) => Math.hypot((x + 0.5 - thr[0]) / (R * 0.4), (y + 0.5 - thr[1]) / (R * 0.2), (z + 0.5 - thr[2]) / (R * 0.3)) < 1);
  rig.move('body', 'head', (x, y, z) => z + 0.5 > -R * 0.04 && y + 0.5 >= mouthY(x + 0.5));
  rig.move('body', 'belly', (x, y, z) => y + 0.5 < R * 0.44 && z + 0.5 > -R * 0.35 && Math.abs(x + 0.5) < R * 0.95);
  const head = rig.m('head'), jaw = rig.m('jaw');
  // ---------------------------------------------------------- the mouth cavity: ridged palate, soft floor, dark gullet
  const cav: V3 = [0, mouthY0 - R * 0.01, R * 0.4];
  const cavR: V3 = [W * 0.8, R * (mama ? 0.15 : 0.11), R * 0.46];
  const lipT = Math.max(2, R * 0.085);
  const inCav = (x: number, y: number, z: number, s = 1) => ((x + 0.5 - cav[0]) / (cavR[0] * s)) ** 2 + ((y + 0.5 - cav[1]) / (cavR[1] * s)) ** 2 + ((z + 0.5 - cav[2]) / (cavR[2] * s)) ** 2 <= 1;
  const carveMouth = (m: VoxelModel) => {
    const front = new Map<number, number>();
    m.forEach((x, y, z) => {
      const kk = x * 4096 + y;
      const f = front.get(kk);
      if (f === undefined || z > f) front.set(kk, z);
    });
    const del: V3[] = [];
    m.forEach((x, y, z) => {
      if (!inCav(x, y, z)) return;
      const f = front.get(x * 4096 + y);
      if (f !== undefined && z <= f - lipT) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) m.del(x, y, z);
  };
  carveMouth(jaw);
  carveMouth(head);
  const facesCav = (m: VoxelModel, x: number, y: number, z: number) => {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as V3[]) if (!m.has(x + dx, y + dy, z + dz) && inCav(x + dx, y + dy, z + dz, 1.12)) return true;
    return false;
  };
  const deep = (z: number) => z + 0.5 < cav[2] - cavR[2] * 0.5;
  paint(jaw, (x, y, z) => facesCav(jaw, x, y, z), (_x, _y, z) => (deep(z) ? MOUTH.gullet : MOUTH.floor));
  paint(head, (x, y, z) => facesCav(head, x, y, z), (_x, _y, z) => (deep(z) ? MOUTH.gullet : Math.floor(z + 0.5) % 3 === 0 ? MOUTH.ridge : MOUTH.palate));
  // lips (pale rim along the line) and gums (the flat faces behind them), seen when the jaw drops
  const lipOrGum = (m: VoxelModel, x: number, y: number, z: number) => (frontZ(m, x, y, Math.ceil(R * 1.4), Math.floor(z)) ?? z) - z < lipT ? pal.lip : MOUTH.gum;
  paint(jaw, (x, y, z) => !jaw.has(x, y + 1, z) && y + 0.5 > mouthY(x + 0.5) - 2 && !facesCav(jaw, x, y, z), (x, y, z) => lipOrGum(jaw, x, y, z));
  paint(head, (x, y, z) => !head.has(x, y - 1, z) && y + 0.5 < mouthY(x + 0.5) + 2 && z + 0.5 > zH && !facesCav(head, x, y, z), (x, y, z) => lipOrGum(head, x, y, z));
  // the back wall of the mouth (body, behind the hinge) is the dark throat
  paint(body, (x, y, z) => Math.abs(z + 0.5 - zH) < R * 0.12 && Math.abs(y + 0.5 - mouthY0) < R * 0.17 && Math.abs(x + 0.5) < W * 0.75 && !body.has(x, y, z + 1), MOUTH.gullet);
  // throat: a soft pale pouch that puffs
  paint(rig.m('throat'), () => true, (x, y, z) => (n01(x, y, z, 1 / (R * 0.2), seed) > 0.7 ? 0xf8e6da : mixc(pal.belly, 0xf4dcd0, 0.4)));
  // nostrils on the snout
  for (const sgn of [1, -1]) {
    const xi = Math.floor(sgn * R * 0.11 + (sgn < 0 ? -0.5 : 0)), yi = Math.floor(R * 0.98);
    const z = frontZ(head, xi, yi, Math.ceil(R * 1.4), 0);
    if (z !== null) {
      head.del(xi, yi, z);
      head.set(xi, yi, z - 1, 0x3a221a);
    }
  }
  // soft blush on the cheeks
  paint(head, (x, y, z) => {
    const gx = Math.abs(x + 0.5), gy = y + 0.5, gz = z + 0.5;
    return Math.hypot(gx - R * 0.56, gy - (mouthY0 + R * 0.1), gz - R * 0.72) < R * 0.17 && exposed(head, x, y, z);
  }, (x, y, z) => (Math.hypot(Math.abs(x + 0.5) - R * 0.56, y + 0.5 - (mouthY0 + R * 0.1), z + 0.5 - R * 0.72) < R * 0.11 ? pal.blush : mixc(pal.blush, pal.skin, 0.5)));
  // ---------------------------------------------------------- big glossy modelled eyes under soft rigged lids
  for (const e of [eL, eR]) ell(head, e, [eyeR * 0.98, eyeR * 0.98, eyeR * 0.98], 0, { carve: true });
  const look = (s: number): V3 => [0.45 * s, 0.24, 0.86];
  const ring = mama ? 0x9a6630 : 0xa8763a, iris = mama ? 0x4a2c18 : 0x52321c;
  cuteEye(rig.part('eye_l', 'head', eL), eL, eyeR, look(1), ring, iris);
  cuteEye(rig.part('eye_r', 'head', eR), eR, eyeR, look(-1), ring, iris);
  // lids: a little heavier on the inner side (the grumpy-cute frown); babies wider-eyed
  lidCap(rig.part('lid_l', 'head', eL), eL, eyeR, mama ? [-0.2, 1, -0.45] : [-0.16, 1, -0.6], mama ? 1.15 : 0.98, pal.skin, mixc(pal.skin, 0x5a3426, 0.5));
  rig.mirror('lid_l', 'lid_r');
  // ---------------------------------------------------------- tiny stubby arms with round-padded fingers
  const pad = mixc(pal.hi, 0xf8dcd2, 0.5);
  const sh: V3 = [R * 0.52, R * 0.4, R * 0.5];
  const el: V3 = [R * 0.62, R * 0.22, R * 0.58];
  const wr: V3 = [R * 0.58, R * 0.1, R * 0.72];
  const legFL = rig.part('leg_fl', 'body', sh);
  tube(legFL, [sh, el, wr], [R * 0.14, R * 0.13, R * 0.1], (_x, y) => (y + 0.5 < R * 0.28 ? mixc(pal.skin, pal.belly, 0.4) : pal.skin));
  const footFL = rig.part('foot_fl', 'leg_fl', wr);
  blob(footFL, [{ c: [wr[0], wr[1] - R * 0.05, wr[2] + R * 0.04], r: [R * 0.13, R * 0.06, R * 0.12] }], pal.skin, { k: 1, keep: (_x, y) => y >= 0 });
  for (let f = 0; f < 4; f++) {
    const a = -0.6 + f * 0.4;
    const tip: V3 = [wr[0] + Math.sin(a) * R * 0.17, R * 0.04, wr[2] + Math.cos(a) * R * 0.16];
    cap(footFL, [wr[0], R * 0.07, wr[2] + R * 0.04], tip, R * 0.045, R * 0.04, pal.skin, { keep: (_a, _b, _c, _x, y) => y >= 0 });
    ell(footFL, tip, [R * 0.058, R * 0.042, R * 0.058], pad, { keep: (_a, _b, _c, _x, y) => y >= 0 });
  }
  // ---------------------------------------------------------- fat folded hind legs + splayed little feet
  const hip: V3 = [R * 0.62, R * 0.46, -R * 0.42];
  const ank: V3 = [R * 0.72, R * 0.12, -R * 0.34];
  const legBL = rig.part('leg_bl', 'body', hip);
  blob(legBL, [
    { c: [R * 0.76, R * 0.3, -R * 0.34], r: [R * 0.28, R * 0.24, R * 0.38] }, // thigh
    { c: [R * 0.84, R * 0.18, -R * 0.12], r: [R * 0.18, R * 0.14, R * 0.26] }, // folded calf
  ], (_x, y) => (y + 0.5 < R * 0.18 ? mixc(pal.skin, pal.belly, 0.4) : pal.skin), { k: R * 0.12, disp: lumpy, keep: (_x, y) => y >= 0 });
  const footBL = rig.part('foot_bl', 'leg_bl', ank);
  blob(footBL, [{ c: [R * 0.74, R * 0.05, -R * 0.04], r: [R * 0.15, R * 0.055, R * 0.22] }], pal.skin, { k: 1, keep: (_x, y) => y >= 0 });
  for (let f = 0; f < 5; f++) {
    const a = -0.5 + f * 0.27;
    const tip: V3 = [R * 0.74 + Math.sin(a) * R * 0.24, R * 0.035, R * 0.02 + Math.cos(a) * R * 0.23];
    cap(footBL, [R * 0.74, R * 0.05, R * 0.02], tip, R * 0.042, R * 0.036, pal.skin, { keep: (_a, _b, _c, _x, y) => y >= 0 });
    ell(footBL, tip, [R * 0.055, R * 0.038, R * 0.055], pad, { keep: (_a, _b, _c, _x, y) => y >= 0 });
  }
  rig.mirror('leg_fl', 'leg_fr');
  rig.mirror('foot_fl', 'foot_fr', 'leg_fr');
  rig.mirror('leg_bl', 'leg_br');
  rig.mirror('foot_bl', 'foot_br', 'leg_br');

  // ---------------------------------------------------------- mama: tongue, pearls, purse, the wig
  let top = C[1] + R * 0.86;
  const vs = c.vs;
  const m3 = (p: V3) => [p[0] * vs, p[1] * vs, p[2] * vs];
  const meta: Record<string, unknown> = {};
  if (mama) {
    // the long sticky tongue, folded back along the mouth floor
    const N = 12, L = Math.round(R * 0.44);
    const tRoot: V3 = [0, mouthY0 - R * 0.075, R * 0.62];
    for (let i = 1; i <= N; i++) {
      const k = (i - 1) / (N - 1);
      tongueSeg(rig.part('tongue' + i, i === 1 ? 'jaw' : 'tongue' + (i - 1), tRoot), tRoot, L, R * (0.15 - 0.035 * k), R * (0.068 - 0.014 * k), i * 17);
    }
    const tip: V3 = [tRoot[0], tRoot[1], tRoot[2] - L];
    tonguePad(rig.part('tongue_tip', 'tongue' + N, tip), tip, R);
    meta.tongue = { segments: N, segLen: L * vs, root: m3(tRoot), reach: ((N - 1) * 0.95 * L + L + R * 0.12) * vs };
    // pearl necklace resting in the fat fold under the chin
    for (let a = -1.2; a <= 1.201; a += 0.13) {
      const p: V3 = [Math.sin(a) * R * 0.98, R * 0.36 + Math.abs(Math.sin(a)) * R * 0.2, Math.cos(a) * R * 0.95];
      ell(rig.m('belly'), p, [R * 0.062, R * 0.062, R * 0.062], (x, y, z) => (hash3(x, y, z) > 0.75 ? 0xffffff : 0xefe4e2), { fl: VF.METAL, under: true });
    }
    // purse dangling from her left wrist (soft sagging leather bag, strap, brass clasp)
    const purse = rig.part('purse', 'foot_fl', [wr[0] + R * 0.04, wr[1] + R * 0.12, wr[2] + R * 0.02]);
    const pc: V3 = [wr[0] + R * 0.14, wr[1] + R * 0.02, wr[2] + R * 0.12];
    blob(purse, [
      { c: pc, r: [R * 0.07, R * 0.12, R * 0.16] },
      { c: [pc[0], pc[1] - R * 0.07, pc[2]], r: [R * 0.075, R * 0.07, R * 0.17] },
    ], (_x, y) => (y + 0.5 > pc[1] + R * 0.06 ? 0x9a6e2c : 0xb88a40), { k: R * 0.05 });
    tube(purse, [[pc[0], pc[1] + R * 0.11, pc[2] - R * 0.09], [pc[0], pc[1] + R * 0.21, pc[2]], [pc[0], pc[1] + R * 0.11, pc[2] + R * 0.09]], [R * 0.022, R * 0.022, R * 0.022], 0x5e3e1c);
    blob(purse, [{ c: [pc[0] + R * 0.035, pc[1] + R * 0.1, pc[2]], r: [R * 0.05, R * 0.02, R * 0.03] }], 0xe8c860, { k: 1, fl: VF.METAL });
    // the big fabulous curly wig, with corkscrew ringlets that bounce
    const wf: WigFit = { hc: [0, R * 1.08, -R * 0.15], hr: [R * 0.7, R * 0.56, R * 0.78], cr: R * 0.12, faceZ: R * 0.1, browY: eL[1] + eyeR + R * 0.05, faceX: R * 0.86, hangY: R * 0.9, ringLen: R * 0.36, ringR: R * 0.105, bowDir: [0.55, 0.72, 0.42], bowS: R * 0.14, bowRoll: -0.45, seed: 5 };
    const wig = rig.part('wig', 'head', [0, R * 1.55, -R * 0.16]);
    const rnames = ['ringlet_l1', 'ringlet_l2', 'ringlet_r1', 'ringlet_r2'];
    const rings = wigRinglets(wf).map((a, i) => rig.part(rnames[i], 'wig', a));
    curlyWig(wig, wf, rings);
    hollow(wig, 2);
    const b = wig.bounds();
    top = b.maxY + 1;
    rig.socket('wig_top', 'wig', [0, top - R * 0.06, wf.hc[2] - wf.hr[2] * 0.18]);
    meta.wig = { top: top * vs, width: (b.maxX - b.minX + 1) * vs };
  } else {
    top = Math.max(top, eL[1] + eyeR * 1.3);
  }
  hollow(body, 3);
  hollow(rig.m('belly'), 3);
  hollow(head, 3);
  rig.socket('head_top', 'head', [0, top, 0]);
  rig.socket('mouth', 'jaw', [0, mouthY0, R * 0.95]);
  rig.socket('back', 'body', [0, C[1] + R * 0.3, -R * 0.95]);
  return rig.build({
    kind: 'frog',
    height: top * vs,
    radius: R * 1.12 * vs,
    length: R * 2 * vs,
    bodyCenter: m3(C),
    eyes: { l: m3(eL), r: m3(eR), radius: eyeR * vs },
    throatCenter: m3(thr),
    /** puff: scale the `throat` part up to ~1.6x; jiggle: scale `belly`; blink: rotate `lid_l`/`lid_r` +X ~1.9 rad */
    puffMax: 1.6,
    ...meta,
    expressions: jawExpressions(mama ? { neutral: 0, happy: 0.1, surprised: 0.42, scared: 0.26, laugh: 0.46, sing: 0.5, hurt: 0.18, sleepy: 0.02 } : { neutral: 0, happy: 0.1, surprised: 0.36, scared: 0.26, laugh: 0.34, sing: 0.42, hurt: 0.15, sleepy: 0.02 }),
    defaultExpression: 'neutral',
  });
}

/** the mama rain frog (big mouth, sticky tongue, big fabulous curly lilac wig, pearls, purse) ~0.9 m with the wig */
export const rainFrogMamaRig = memo((_: void): RigSpec => frog({ name: 'rain_frog_mama', vs: 1 / 70, R: 30, pal: MAMA_PAL, eyeK: 0.28, mama: true, seed: 7 }));
/** a tiny rain froglet, ~0.19 m; variant 0-4 = colour morph */
export const rainFrogBabyRig = memo((o: { variant?: number } = {}): RigSpec => {
  const v = (((o?.variant ?? 0) % BABY_PALS.length) + BABY_PALS.length) % BABY_PALS.length;
  return frog({ name: 'rain_frog_baby_' + v, vs: 1 / 116, R: 13, pal: BABY_PALS[v], eyeK: 0.38, mama: false, seed: 11 + v * 3 });
});

// ---------------------------------------------------------------- the moths she snaps out of the air
/** a fluffy little desert moth, ~7 cm wingspan (parts `body`, `wing_l`, `wing_r`; flap = rotate the wings about Z) */
export const desertMothRig = memo((_: void): RigSpec => {
  const rig = new CRig('desert_moth', 1 / 300);
  const body = rig.part('body', undefined, [0, 0, 0]);
  const fur = 0xeadfc6, furD = 0xcbb894, band = 0x8c6c48, leg = 0x7e6044;
  blob(body, [
    { c: [0, 0, 1.4], r: [2.1, 2.0, 2.4] }, // fuzzy thorax
    { c: [0, -0.4, -3.0], r: [1.6, 1.5, 3.4] }, // abdomen
    { c: [0, 0.3, 4.2], r: [1.5, 1.4, 1.3] }, // head
  ], (_x, y, z) => {
    const gz = z + 0.5;
    if (gz < -0.8) return Math.floor(gz * 0.8) & 1 ? band : furD;
    return y + 0.5 > 0.4 ? fur : furD;
  }, { k: 1.1 });
  bumps(body, [0, 0, 0.6], 0.45, (_x, _y, _z, c) => mulc(c, 1.07), 3, (_x, _y, z) => z + 0.5 > -1); // the fluff
  for (const s of [1, -1]) {
    ell(body, [s * 1.2, 0.6, 4.7], [1.0, 1.0, 1.0], 0x161010, { fl: VF.METAL }); // little glossy bead eyes
    dabAt(body, [s * 1.2 + 0.3, 1.2, 5.6], [0, 0, 1], 0xffffff);
    // feathery antennae
    const pts: V3[] = [[s * 0.6, 1.2, 4.9], [s * 1.9, 3.3, 6.5], [s * 3.4, 4.5, 7.6]];
    tube(body, pts, [0.55, 0.45, 0.4], 0x9c7c54);
    for (let t = 1; t < 6; t++) {
      const p = add3(pts[1], add3(pts[2], pts[1], -1), (t - 1) / 5);
      body.set(Math.floor(p[0] + s * 0.9), Math.floor(p[1] - 0.6), Math.floor(p[2]), 0xbca078);
    }
    // three pairs of thin bent legs tucked under the thorax
    for (let i = 0; i < 3; i++) tube(body, [[s * 0.9, -1.2, 2.4 - i * 1.2], [s * 2.1, -2.0, 2.7 - i * 1.5], [s * 2.5, -3.2, 3.0 - i * 1.8]], [0.45, 0.4, 0.35], leg);
  }
  // wings: cambered scalloped membranes in a shallow V, a thick costa, transverse band, eyespot, veins; rosy hindwings beneath
  const wl = rig.part('wing_l', 'body', [1.2, 0.9, 1.8]);
  const base: V3 = [1.2, 0.9, 1.8];
  for (let i = 1; i <= 14; i++)
    for (let k = -10; k <= 6; k++) {
      const u = i + 0.5 - base[0], v = k + 0.5 - base[2];
      const rho = Math.hypot(u, v), beta = Math.atan2(-v, u);
      const fore = beta > -0.22 && beta < 0.78 && rho < 11.2 * (1 - 0.3 * ((beta - 0.25) / 0.53) ** 2) + 0.35 * Math.sin(beta * 30);
      const hind = !fore && beta > 0.55 && beta < 1.42 && rho < 7.4 * (1 - 0.25 * ((beta - 1.0) / 0.45) ** 2) + 0.3 * Math.sin(beta * 26);
      if (!fore && !hind) continue;
      const y = Math.floor(base[1] + u * 0.14 + 0.02 * u * u - (hind ? 1 : 0));
      let col: number;
      if (fore) {
        const rmax = 11.2 * (1 - 0.3 * ((beta - 0.25) / 0.53) ** 2);
        const t = rho / rmax;
        const spot = Math.hypot(u - Math.cos(0.32) * rmax * 0.74, v + Math.sin(0.32) * rmax * 0.74);
        col = 0xcdb48c;
        if (Math.abs(t - 0.58) < 0.06) col = 0x8e6e4a;
        if ([0.02, 0.22, 0.42, 0.62].some((bv) => Math.abs(beta - bv) * rho < 0.42) && t < 0.9) col = 0xa88c64;
        if (spot < 1.9) col = spot < 0.9 ? 0xf2e4c4 : 0x5c3c26;
        if (t > 0.92) col = 0xeadfc8;
        wl.set(i, y, k, col);
        if (beta < -0.08) wl.set(i, y + 1, k, 0x9c7c58); // thick leading edge
      } else {
        const t = rho / 7.4;
        col = t < 0.35 ? 0xb88a7a : t > 0.9 ? 0xf0dcd4 : 0xe2b4a4;
        wl.set(i, y, k, col);
      }
    }
  rig.mirror('wing_l', 'wing_r');
  return rig.build({ kind: 'moth', span: 0.075 });
});
