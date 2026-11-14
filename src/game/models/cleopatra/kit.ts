// Sculpt kit for Cleopatra's court (Cleopatra, her ram-headed royal guards,
// her tamed lions, the golden royal barge and the sun scarabs).
//
// Everything is authored in METRES in one shared rig space (origin on the
// ground, faces +Z, left = +X) and rasterised onto the rig's voxel grid:
//   - `Field` is a signed distance (metres) evaluated at voxel centres;
//   - `raster()` fills a box from a field and paints each voxel with its
//     position, outward normal (field gradient) and depth below the surface;
//   - the smooth primitives below (ellipsoids, round cones, smooth unions)
//     build organic, hand-sculpted masses: never a bare sphere or box.
// Voxel i spans [i, i+1) * vs, so x mirrors i <-> -1 - i and pivot x <-> -x.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, V3, SocketSpec, PartSpec } from '../../../engine/voxel/Rig';
import { hash3, noise } from '../../../engine/math/rand';

export { VoxelModel, VF, hash3, noise };
export type { V3, RigSpec };

// ============================================================================ math
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function sstep(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export const add3 = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scl3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm3 = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mirX = (p: V3): V3 => [-p[0], p[1], p[2]];

/** smooth value noise 0..1 (metres in, scaled by f) */
export const n01 = (x: number, y: number, z: number, f: number, seed = 0) => noise.n3(x * f + seed * 13.1, y * f - seed * 7.7, z * f + seed * 3.3) * 0.5 + 0.5;
/** signed noise -1..1 */
export const nS = (x: number, y: number, z: number, f: number, seed = 0) => noise.n3(x * f + seed * 13.1, y * f - seed * 7.7, z * f + seed * 3.3);
export const h01 = (x: number, y: number, z: number, seed = 0) => hash3(Math.floor(x * 997 + seed * 17), Math.floor(y * 991 - seed * 7), Math.floor(z * 983 + seed * 3));

// ============================================================================ colour
export function mixc(a: number, b: number, t: number) {
  t = clamp01(t);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  return (Math.round(ar + (((b >> 16) & 255) - ar) * t) << 16) | (Math.round(ag + (((b >> 8) & 255) - ag) * t) << 8) | Math.round(ab + ((b & 255) - ab) * t);
}
export function mulc(c: number, f: number) {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f)), g = Math.min(255, Math.round(((c >> 8) & 255) * f)), b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}
/** colour with voxel flags packed in the high byte (what Paint returns) */
export const pk = (c: number, f: number = VF.SOLID) => (((f | VF.SOLID) << 24) | (c & 0xffffff)) >>> 0;

/** a material ramp: base, shade (recesses / undersides), light (sky-facing), dark (deep creases) */
export interface Ramp {
  base: number;
  shade: number;
  light: number;
  dark: number;
}
export const ramp = (base: number, shade: number, light: number, dark: number): Ramp => ({ base, shade, light, dark });
/** cel-friendly shading of a ramp from the surface normal and a crease value (0 open .. 1 deep) */
export function shadeRamp(r: Ramp, ny: number, crease = 0) {
  if (crease > 0.72) return r.dark;
  if (crease > 0.42 || ny < -0.55) return r.shade;
  if (ny > 0.55 && crease < 0.2) return r.light;
  return r.base;
}

// ============================================================================ signed distance primitives (metres)
export type Field = (x: number, y: number, z: number) => number;
/** iq's ellipsoid bound (good enough near the surface) */
export function sdEll(px: number, py: number, pz: number, c: V3, r: V3) {
  const x = (px - c[0]) / r[0], y = (py - c[1]) / r[1], z = (pz - c[2]) / r[2];
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const k1 = Math.sqrt((x / r[0]) ** 2 + (y / r[1]) ** 2 + (z / r[2]) ** 2);
  return k1 < 1e-9 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
}
/** round cone from a (radius ra) to b (radius rb) */
export function sdCone(px: number, py: number, pz: number, a: V3, b: V3, ra: number, rb: number) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const t = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1e-9));
  const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
}
/** parameter t (0..1) of p projected on segment a-b */
export function segT(px: number, py: number, pz: number, a: V3, b: V3) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  return clamp01(((px - a[0]) * bax + (py - a[1]) * bay + (pz - a[2]) * baz) / (bax * bax + bay * bay + baz * baz || 1e-9));
}
export function segDist(px: number, py: number, pz: number, a: V3, b: V3) {
  const t = segT(px, py, pz, a, b);
  return Math.hypot(px - (a[0] + (b[0] - a[0]) * t), py - (a[1] + (b[1] - a[1]) * t), pz - (a[2] + (b[2] - a[2]) * t));
}
export function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a: number, b: number, k: number) {
  return -smin(-a, -b, k);
}

/** a primitive in a smooth union: ellipsoid (c, r, optional yaw/pitch/roll) or round cone (a, b, ra, rb); sub = smooth carve */
export interface Prim {
  c?: V3;
  r?: V3;
  rot?: V3;
  a?: V3;
  b?: V3;
  ra?: number;
  rb?: number;
  sub?: boolean;
  k?: number;
}
export const E = (c: V3, r: V3, rot?: V3, k?: number): Prim => ({ c, r, rot, k });
export const C = (a: V3, b: V3, ra: number, rb: number, k?: number): Prim => ({ a, b, ra, rb, k });
export const SUB = (p: Prim): Prim => ({ ...p, sub: true });

interface PPrim extends Prim {
  lo: V3;
  hi: V3;
  m: number[] | null;
}
function invRot(e: V3): number[] {
  const [a, b, c] = e;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  const R = [cb * cc, -cb * sc, sb, sa * sb * cc + ca * sc, -sa * sb * sc + ca * cc, -sa * cb, -ca * sb * cc + sa * sc, ca * sb * sc + sa * cc, ca * cb];
  return [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
}
/** compile prims into a fast field (bbox-culled smooth union, blend radius k metres) */
export function union(prims: Prim[], k: number): Field & { lo: V3; hi: V3 } {
  const pad = k + 0.02;
  const P: PPrim[] = prims.map((q) => {
    let lo: V3, hi: V3;
    if (q.a && q.b) {
      const R = Math.max(q.ra ?? 0, q.rb ?? 0) + pad;
      lo = [Math.min(q.a[0], q.b[0]) - R, Math.min(q.a[1], q.b[1]) - R, Math.min(q.a[2], q.b[2]) - R];
      hi = [Math.max(q.a[0], q.b[0]) + R, Math.max(q.a[1], q.b[1]) + R, Math.max(q.a[2], q.b[2]) + R];
    } else {
      const R = Math.max(q.r![0], q.r![1], q.r![2]) + pad;
      lo = [q.c![0] - R, q.c![1] - R, q.c![2] - R];
      hi = [q.c![0] + R, q.c![1] + R, q.c![2] + R];
    }
    return { ...q, lo, hi, m: q.rot && (q.rot[0] || q.rot[1] || q.rot[2]) ? invRot(q.rot) : null };
  });
  const lo: V3 = [1e9, 1e9, 1e9], hi: V3 = [-1e9, -1e9, -1e9];
  for (const q of P)
    if (!q.sub)
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], q.lo[i]);
        hi[i] = Math.max(hi[i], q.hi[i]);
      }
  const f = ((x: number, y: number, z: number) => {
    let d = 1;
    let any = false;
    for (let n = 0; n < P.length; n++) {
      const q = P[n];
      if (x < q.lo[0] || x > q.hi[0] || y < q.lo[1] || y > q.hi[1] || z < q.lo[2] || z > q.hi[2]) continue;
      let di: number;
      if (q.a && q.b) di = sdCone(x, y, z, q.a, q.b, q.ra ?? 0.01, q.rb ?? q.ra ?? 0.01);
      else if (q.m) {
        const dx = x - q.c![0], dy = y - q.c![1], dz = z - q.c![2];
        const m = q.m;
        di = sdEll(m[0] * dx + m[1] * dy + m[2] * dz, m[3] * dx + m[4] * dy + m[5] * dz, m[6] * dx + m[7] * dy + m[8] * dz, [0, 0, 0], q.r!);
      } else di = sdEll(x, y, z, q.c!, q.r!);
      if (q.sub) {
        if (any) d = smax(d, -di, q.k ?? k);
      } else if (!any) {
        d = di;
        any = true;
      } else d = smin(d, di, q.k ?? k);
    }
    return any ? d : 0.5;
  }) as Field & { lo: V3; hi: V3 };
  f.lo = lo;
  f.hi = hi;
  return f;
}

// ============================================================================ rasteriser
/** paint callback: metres, outward normal, depth below the surface (m, >= 0); returns pk(colour, flags) or -1 to skip */
export type Paint = (x: number, y: number, z: number, nx: number, ny: number, nz: number, depth: number) => number;

export interface RasterOpts {
  /** colour of buried voxels (never seen; keeps the mesher from building inner faces) */
  interior?: number;
  /** only fill empty cells */
  under?: boolean;
  /** remove instead of add */
  carve?: boolean;
  /** keep the voxel (metres) */
  keep?: (x: number, y: number, z: number) => boolean;
}

/**
 * Fill a metric box from a signed-distance field. Surface voxels (an empty
 * 6-neighbour) are painted with their field normal; buried voxels get the
 * interior colour.
 */
export function raster(m: VoxelModel, vs: number, lo: V3, hi: V3, f: Field, paint: Paint, o: RasterOpts = {}) {
  const i0 = Math.floor(lo[0] / vs) - 1, j0 = Math.floor(lo[1] / vs) - 1, k0 = Math.floor(lo[2] / vs) - 1;
  const i1 = Math.ceil(hi[0] / vs) + 1, j1 = Math.ceil(hi[1] / vs) + 1, k1 = Math.ceil(hi[2] / vs) + 1;
  const nx = i1 - i0 + 1, ny = j1 - j0 + 1, nz = k1 - k0 + 1;
  const D = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = (k0 + k + 0.5) * vs;
    for (let j = 0; j < ny; j++) {
      const y = (j0 + j + 0.5) * vs;
      let n = nx * (j + ny * k);
      for (let i = 0; i < nx; i++, n++) D[n] = f((i0 + i + 0.5) * vs, y, z);
    }
  }
  const sx = 1, sy = nx, sz = nx * ny;
  const interior = o.interior ?? 0x2a1c14;
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const n = i + nx * (j + ny * k);
        const d = D[n];
        if (d >= 0) continue;
        const X = (i0 + i + 0.5) * vs, Y = (j0 + j + 0.5) * vs, Z = (k0 + k + 0.5) * vs;
        if (o.keep && !o.keep(X, Y, Z)) continue;
        const vi = i0 + i, vj = j0 + j, vk = k0 + k;
        if (o.carve) {
          m.del(vi, vj, vk);
          continue;
        }
        if (o.under && m.has(vi, vj, vk)) continue;
        const surf = D[n + sx] >= 0 || D[n - sx] >= 0 || D[n + sy] >= 0 || D[n - sy] >= 0 || D[n + sz] >= 0 || D[n - sz] >= 0;
        if (!surf && d < -vs * 1.6) {
          m.set(vi, vj, vk, interior);
          continue;
        }
        let gx = D[n + sx] - D[n - sx], gy = D[n + sy] - D[n - sy], gz = D[n + sz] - D[n - sz];
        const gl = Math.hypot(gx, gy, gz) || 1;
        gx /= gl;
        gy /= gl;
        gz /= gl;
        const v = paint(X, Y, Z, gx, gy, gz, -d);
        if (v < 0) continue;
        m.set(vi, vj, vk, v & 0xffffff, v >>> 24 || VF.SOLID);
      }
  return m;
}
/** raster a compiled union over its own bounds */
export function rasterU(m: VoxelModel, vs: number, f: Field & { lo: V3; hi: V3 }, paint: Paint, o: RasterOpts = {}) {
  return raster(m, vs, f.lo, f.hi, f, paint, o);
}

/** a flat paint (colour + flags) for quick parts */
export const flat = (c: number, f: number = VF.SOLID): Paint => () => pk(c, f);
/** paint a ramp by normal (sky light on top, shade underneath) */
export const rampPaint = (r: Ramp, f: number = VF.SOLID): Paint => (_x, _y, _z, _nx, ny) => pk(shadeRamp(r, ny, 0), f);

// ============================================================================ rig builder
interface KPart {
  name: string;
  parent?: string;
  pivot: V3;
  rest?: V3;
  model: VoxelModel;
}
/** rig builder in shared rig space: pivots in METRES; attach = pivot */
export class KRig {
  parts: KPart[] = [];
  sockets: Record<string, SocketSpec> = {};
  constructor(public name: string, public vs: number) {}
  part(name: string, parent: string | undefined, pivotM: V3, rest?: V3): VoxelModel {
    const model = new VoxelModel(name);
    this.parts.push({ name, parent, pivot: [pivotM[0] / this.vs, pivotM[1] / this.vs, pivotM[2] / this.vs], rest, model });
    return model;
  }
  m(name: string) {
    const p = this.parts.find((q) => q.name === name);
    if (!p) throw new Error(`[${this.name}] no part ${name}`);
    return p.model;
  }
  has(name: string) {
    return this.parts.some((q) => q.name === name);
  }
  /** socket at a metric point */
  socket(name: string, part: string, atM: V3, rot?: V3) {
    this.sockets[name] = { part, at: [atM[0] / this.vs, atM[1] / this.vs, atM[2] / this.vs], rot };
  }
  /** mirror every `*_l` part / socket into `*_r` (parents renamed too) unless it exists */
  mirrorLR() {
    const R = (s: string) => s.replace(/_l(\d*)$/, '_r$1');
    for (const p of [...this.parts]) {
      if (!/_l\d*$/.test(p.name) || this.has(R(p.name))) continue;
      const m = new VoxelModel(R(p.name));
      p.model.forEach((x, y, z, c, f) => m.set(-1 - x, y, z, c, f));
      this.parts.push({ name: R(p.name), parent: p.parent ? R(p.parent) : undefined, pivot: [-p.pivot[0], p.pivot[1], p.pivot[2]], rest: p.rest ? [p.rest[0], -p.rest[1], -p.rest[2]] : undefined, model: m });
    }
    for (const [k, s] of Object.entries({ ...this.sockets })) {
      if (!/_l\d*$/.test(k) || this.sockets[R(k)]) continue;
      this.sockets[R(k)] = { part: R(s.part), at: [-s.at[0], s.at[1], s.at[2]], rot: s.rot ? [s.rot[0], -s.rot[1], -s.rot[2]] : undefined };
    }
  }
  build(meta: Record<string, any> = {}): RigSpec {
    const parts: PartSpec[] = this.parts.map((p) => ({ name: p.name, model: p.model, pivot: p.pivot, parent: p.parent, attach: [p.pivot[0], p.pivot[1], p.pivot[2]], rest: p.rest }));
    for (const p of parts) if (p.model.count === 0) p.model.set(Math.floor(p.pivot[0]), Math.floor(p.pivot[1]), Math.floor(p.pivot[2]), 0x2a1a10);
    return { name: this.name, voxelSize: this.vs, parts, sockets: this.sockets, meta };
  }
}

// ============================================================================ passes
export const exposed = (m: VoxelModel, x: number, y: number, z: number) => !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z) || !m.has(x, y - 1, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);

/**
 * Cut one continuous sculpt into parts by nearest bone (distance to a segment
 * divided by its radius). Buried voxels near a joint are copied into the runner-up
 * part too, so bending never opens a gap.
 */
export interface Bone {
  part: string;
  a: V3;
  b: V3;
  r: number;
  /** extra predicate: the bone only claims voxels where it holds */
  only?: (x: number, y: number, z: number) => boolean;
}
export function cutBones(whole: VoxelModel, vs: number, rig: KRig, bones: Bone[], plugSlack = 1.35) {
  const models: Record<string, VoxelModel> = {};
  for (const b of bones) models[b.part] = rig.m(b.part);
  whole.forEach((x, y, z, c, f) => {
    const X = (x + 0.5) * vs, Y = (y + 0.5) * vs, Z = (z + 0.5) * vs;
    let best = -1, bd = 1e9, second = -1, sd = 1e9;
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      if (b.only && !b.only(X, Y, Z)) continue;
      const d = segDist(X, Y, Z, b.a, b.b) / b.r;
      if (d < bd) {
        second = best;
        sd = bd;
        best = i;
        bd = d;
      } else if (d < sd) {
        second = i;
        sd = d;
      }
    }
    if (best < 0) return;
    models[bones[best].part].set(x, y, z, c, f);
    if (second >= 0 && sd < bd * plugSlack && bones[second].part !== bones[best].part && !exposed(whole, x, y, z) && whole.has(x + 2, y, z) && whole.has(x - 2, y, z) && whole.has(x, y + 2, z) && whole.has(x, y - 2, z))
      models[bones[second].part].set(x, y, z, c, f);
  });
}

/** sky-lit tops a touch lighter, undersides darker (subtle: the cel ramp and AO do the rest) */
export function finish(m: VoxelModel, top = 1.04, under = 0.9, skip?: (c: number, f: number) => boolean) {
  const out: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (skip?.(c, f)) return;
    const up = !m.has(x, y + 1, z), dn = !m.has(x, y - 1, z);
    if (up && !dn) out.push([x, y, z, mulc(c, top), f]);
    else if (dn && !up) out.push([x, y, z, mulc(c, under), f]);
  });
  for (const [x, y, z, c, f] of out) m.set(x, y, z, c, f);
}

/**
 * A glossy, realistic modelled eye (real geometry): sclera tint, iris ring around
 * the gaze axis with a darker limbal edge, a round or horizontal-bar pupil, and two
 * catch-lights. Globe voxels are METAL so the renderer gives them a wet sheen.
 */
export function eyeball(m: VoxelModel, vs: number, cM: V3, rM: number, fwd: V3, o: { sclera?: number; iris: number; pupil?: number; irisR?: number; pupilR?: number; bar?: boolean; lid?: number; lidUp?: V3 }) {
  const f = norm3(fwd);
  const up = norm3(o.lidUp ?? [0, 1, 0]);
  const right = norm3(cross3(up, f));
  const up2 = cross3(f, right);
  const scl = o.sclera ?? 0xd8cfb8;
  const pupil = o.pupil ?? 0x070504;
  const irisR = o.irisR ?? 0.82, pupilR = o.pupilR ?? 0.42;
  const edge = mulc(o.iris, 0.55);
  const field: Field = (x, y, z) => Math.hypot(x - cM[0], y - cM[1], z - cM[2]) - rM;
  const R = rM + vs * 2;
  raster(m, vs, [cM[0] - R, cM[1] - R, cM[2] - R], [cM[0] + R, cM[1] + R, cM[2] + R], field, (x, y, z) => {
    const px = x - cM[0], py = y - cM[1], pz = z - cM[2];
    const l = Math.hypot(px, py, pz) || 1;
    const along = (px * f[0] + py * f[1] + pz * f[2]) / l;
    const u = (px * up2[0] + py * up2[1] + pz * up2[2]) / l;
    const r = (px * right[0] + py * right[1] + pz * right[2]) / l;
    if (o.lid !== undefined && u > 0.62) return pk(o.lid);
    if (along < 0.2) return pk(mulc(scl, 0.8), VF.METAL);
    const ring = Math.sqrt(Math.max(0, 1 - along * along));
    if (o.bar ? Math.abs(u) < pupilR * 0.45 && Math.abs(r) < pupilR * 1.6 : ring < pupilR) return pk(pupil, VF.METAL);
    if (ring < irisR) return pk(ring > irisR * 0.8 ? edge : mixc(o.iris, mulc(o.iris, 0.72), ring / irisR), VF.METAL);
    return pk(scl, VF.METAL);
  });
  // catch-lights: a big one upper-front-outer, a small one lower-inner
  const side = Math.sign(f[0] || 1);
  const pick = (d: V3) => {
    let best: V3 | null = null, bs = -1e9;
    m.forEach((x, y, z) => {
      const px = (x + 0.5) * vs - cM[0], py = (y + 0.5) * vs - cM[1], pz = (z + 0.5) * vs - cM[2];
      if (Math.hypot(px, py, pz) > rM + vs * 0.8 || !exposed(m, x, y, z)) return;
      const s = px * d[0] + py * d[1] + pz * d[2];
      if (s > bs) {
        bs = s;
        best = [x, y, z];
      }
    });
    return best as V3 | null;
  };
  const big = pick(norm3([f[0] + side * 0.3, f[1] + 0.6, f[2]]));
  if (big) m.set(big[0], big[1], big[2], 0xffffff, VF.SOFTAO);
  if (rM / vs > 1.8) {
    const sm = pick(norm3([f[0] - side * 0.3, f[1] - 0.4, f[2]]));
    if (sm && (!big || sm[0] !== big[0] || sm[1] !== big[1] || sm[2] !== big[2])) m.set(sm[0], sm[1], sm[2], 0xe6eef6, VF.SOFTAO);
  }
}

/** sample points along a Catmull-Rom curve through ctrl (n samples) */
export function curve(ctrl: V3[], n: number): V3[] {
  const P = (k: number) => ctrl[Math.max(0, Math.min(ctrl.length - 1, k))];
  const out: V3[] = [];
  for (let s = 0; s <= n; s++) {
    const g = (s / n) * (ctrl.length - 1);
    const k = Math.min(ctrl.length - 2, Math.floor(g)), t = g - k;
    const p0 = P(k - 1), p1 = P(k), p2 = P(k + 1), p3 = P(k + 2);
    const cr = (i: number) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t * t + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t * t * t);
    out.push([cr(0), cr(1), cr(2)]);
  }
  return out;
}
/** a tube along a polyline (round cones between samples); radius as a function of t */
export function tubePrims(pts: V3[], r: (t: number) => number, k?: number): Prim[] {
  const out: Prim[] = [];
  for (let i = 0; i < pts.length - 1; i++) out.push(C(pts[i], pts[i + 1], r(i / (pts.length - 1)), r((i + 1) / (pts.length - 1)), k));
  return out;
}
/** memoise a builder by key */
export function memo<R>(fn: (key: string) => R) {
  const cache = new Map<string, R>();
  return (key: string) => {
    let r = cache.get(key);
    if (!r) cache.set(key, (r = fn(key)));
    return r;
  };
}

/** cheap direct stamp of a tapered tube (strands, whiskers, cords): spheres along the polyline */
export function stampTube(m: VoxelModel, vs: number, pts: V3[], r0: number, r1: number, paint: (x: number, y: number, z: number, t: number) => number, under = false) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += len3(sub3(pts[i], pts[i - 1]));
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = len3(sub3(b, a));
    const n = Math.max(1, Math.ceil(L / (vs * 0.5)));
    for (let s = 0; s <= n; s++) {
      const u = s / n;
      const p: V3 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
      const t = total > 0 ? (acc + L * u) / total : 0;
      const r = (r0 + (r1 - r0) * t) / vs;
      const R = Math.ceil(r);
      const ci = p[0] / vs - 0.5, cj = p[1] / vs - 0.5, ck = p[2] / vs - 0.5;
      for (let di = -R; di <= R; di++)
        for (let dj = -R; dj <= R; dj++)
          for (let dk = -R; dk <= R; dk++) {
            const i2 = Math.round(ci) + di, j2 = Math.round(cj) + dj, k2 = Math.round(ck) + dk;
            if ((i2 - ci) ** 2 + (j2 - cj) ** 2 + (k2 - ck) ** 2 > r * r + 0.25) continue;
            if (under && m.has(i2, j2, k2)) continue;
            const v = paint((i2 + 0.5) * vs, (j2 + 0.5) * vs, (k2 + 0.5) * vs, t);
            if (v < 0) continue;
            m.set(i2, j2, k2, v & 0xffffff, v >>> 24 || VF.SOLID);
          }
    }
    acc += L;
  }
}
