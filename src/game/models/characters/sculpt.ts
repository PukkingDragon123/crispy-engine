// Sculpt kit for the HD characters (Sundown HD, Pinch HD): shapes are authored in
// continuous "design units" and rasterised onto a finer voxel grid (k voxels per
// unit), so forms stay smooth, tapered and organic at any resolution. Every shape
// tests voxel CENTRES ((i + 0.5) / k); the mirror plane x = 0 lies between voxel
// columns -1 and 0, so symmetric shapes stay perfectly symmetric.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { V3 } from '../../../engine/voxel/Rig';
import type { Ramp } from '../style';

export type Col = number | ((x: number, y: number, z: number) => number | null);
export type Mode = 'set' | 'carve' | 'paint' | 'under';
export interface Op {
  mode?: Mode;
  flags?: number;
  /** superellipse power (2 = ellipsoid, higher = boxier) */
  p?: number;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sstep = (t: number) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
export const vadd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vmul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const vdot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vlen = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const vnorm = (a: V3): V3 => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** mirror a design-space point across x = 0 */
export const mxs = (p: V3, s: number): V3 => [p[0] * s, p[1], p[2]];

/** distance from p to the polyline pts */
export function distPoly(p: V3, pts: V3[]) {
  let best = 1e9;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], ab = vsub(pts[i], a);
    const t = clamp(vdot(vsub(p, a), ab) / (vdot(ab, ab) || 1e-9), 0, 1);
    const d = vlen(vsub(p, vadd(a, vmul(ab, t))));
    if (d < best) best = d;
  }
  return best;
}

/** centripetal-ish Catmull-Rom through pts, n samples per span */
export function spline(pts: V3[], n = 8): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (j: number) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      out.push([f(0), f(1), f(2)]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** resample a polyline at a fixed spacing; returns points + unit tangents */
export function resample(pts: V3[], step: number): { p: V3; t: V3 }[] {
  const out: { p: V3; t: V3 }[] = [];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], d = vsub(pts[i], a), L = vlen(d);
    if (L < 1e-6) continue;
    const t = vmul(d, 1 / L);
    let s = carry;
    while (s <= L) {
      out.push({ p: vadd(a, vmul(t, s)), t });
      s += step;
    }
    carry = s - L;
  }
  return out;
}

export class Sc {
  m: VoxelModel;
  constructor(name: string, readonly k: number) {
    this.m = new VoxelModel(name);
  }
  /** voxel index -> design-space centre */
  c(i: number) {
    return (i + 0.5) / this.k;
  }
  /** visit every voxel whose centre lies in the box and inside(), applying col with the given mode */
  region(lo: V3, hi: V3, inside: (x: number, y: number, z: number) => boolean, col: Col, o: Op = {}) {
    const k = this.k, m = this.m, mode = o.mode ?? 'set';
    const i0 = Math.floor(lo[0] * k - 0.5), i1 = Math.ceil(hi[0] * k - 0.5);
    const j0 = Math.floor(lo[1] * k - 0.5), j1 = Math.ceil(hi[1] * k - 0.5);
    const l0 = Math.floor(lo[2] * k - 0.5), l1 = Math.ceil(hi[2] * k - 0.5);
    for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) / k;
      for (let j = j0; j <= j1; j++) {
        const y = (j + 0.5) / k;
        for (let l = l0; l <= l1; l++) {
          const z = (l + 0.5) / k;
          if (!inside(x, y, z)) continue;
          if (mode === 'carve') {
            m.del(i, j, l);
            continue;
          }
          const has = m.has(i, j, l);
          if (mode === 'paint' && !has) continue;
          if (mode === 'under' && has) continue;
          const c = typeof col === 'number' ? col : col(x, y, z);
          if (c === null || c === undefined) continue;
          if (mode === 'paint') m.paintAt(i, j, l, c, o.flags);
          else m.set(i, j, l, c, o.flags ?? VF.SOLID);
        }
      }
    }
    return this;
  }
  /** (super)ellipsoid */
  ell(c: V3, r: V3, col: Col, o: Op = {}) {
    const p = o.p ?? 2;
    return this.region(vsub(c, r), vadd(c, r), (x, y, z) => Math.pow(Math.abs(x - c[0]) / r[0], p) + Math.pow(Math.abs(y - c[1]) / r[1], p) + Math.pow(Math.abs(z - c[2]) / r[2], p) <= 1, col, o);
  }
  /** ellipsoid shell (thickness th measured on the normalised radius) */
  shell(c: V3, r: V3, th: number, col: Col, keep: (x: number, y: number, z: number) => boolean, o: Op = {}) {
    const p = o.p ?? 2, rm = (r[0] + r[1] + r[2]) / 3, inner = 1 - th / rm;
    return this.region(vsub(c, r), vadd(c, r), (x, y, z) => {
      const d = Math.pow(Math.pow(Math.abs(x - c[0]) / r[0], p) + Math.pow(Math.abs(y - c[1]) / r[1], p) + Math.pow(Math.abs(z - c[2]) / r[2], p), 1 / p);
      return d <= 1 && d >= inner && keep(x, y, z);
    }, col, o);
  }
  /** tapered capsule a -> b */
  cap(a: V3, b: V3, ra: number, rb: number, col: Col, o: Op = {}) {
    const R = Math.max(ra, rb);
    const lo: V3 = [Math.min(a[0], b[0]) - R, Math.min(a[1], b[1]) - R, Math.min(a[2], b[2]) - R];
    const hi: V3 = [Math.max(a[0], b[0]) + R, Math.max(a[1], b[1]) + R, Math.max(a[2], b[2]) + R];
    const ab = vsub(b, a), L2 = vdot(ab, ab) || 1e-9;
    return this.region(lo, hi, (x, y, z) => {
      const t = clamp(((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / L2, 0, 1);
      const r = ra + (rb - ra) * t;
      const dx = x - a[0] - ab[0] * t, dy = y - a[1] - ab[1] * t, dz = z - a[2] - ab[2] * t;
      return dx * dx + dy * dy + dz * dz <= r * r;
    }, col, o);
  }
  /** chain of tapered capsules; r(t) over the whole length (t 0..1) */
  path(pts: V3[], r: (t: number) => number, col: Col, o: Op = {}) {
    const L: number[] = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + vlen(vsub(pts[i], pts[i - 1])));
    const tot = L[L.length - 1] || 1;
    for (let i = 1; i < pts.length; i++) this.cap(pts[i - 1], pts[i], r(L[i - 1] / tot), r(L[i] / tot), col, o);
    return this;
  }
  /** ellipsoid stamps along a path (flat bands, jaw bodies): r(t) gives per-axis radii */
  sweep(pts: V3[], r: (t: number) => V3, col: Col, step = 0.25, o: Op = {}) {
    const L: number[] = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + vlen(vsub(pts[i], pts[i - 1])));
    const tot = L[L.length - 1] || 1;
    for (const s of resample(pts, step)) {
      // arc position of this sample
      let best = 0, bd = 1e9;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], ab = vsub(pts[i], a);
        const t = clamp(vdot(vsub(s.p, a), ab) / (vdot(ab, ab) || 1e-9), 0, 1);
        const d = vlen(vsub(s.p, vadd(a, vmul(ab, t))));
        if (d < bd) {
          bd = d;
          best = (L[i - 1] + (L[i] - L[i - 1]) * t) / tot;
        }
      }
      this.ell(s.p, r(best), col, o);
    }
    return this;
  }
  /** elongated ovoid between a and b (segments, bulbs) */
  ovoid(a: V3, b: V3, ra: number, rb: number, col: Col, o: Op & { over?: number } = {}) {
    const over = o.over ?? 0.15;
    const ab = vsub(b, a), L = vlen(ab) || 1e-6, ax = vmul(ab, 1 / L);
    const R = Math.max(ra, rb);
    const lo: V3 = [Math.min(a[0], b[0]) - R - L * over, Math.min(a[1], b[1]) - R - L * over, Math.min(a[2], b[2]) - R - L * over];
    const hi: V3 = [Math.max(a[0], b[0]) + R + L * over, Math.max(a[1], b[1]) + R + L * over, Math.max(a[2], b[2]) + R + L * over];
    return this.region(lo, hi, (x, y, z) => {
      const d: V3 = [x - a[0], y - a[1], z - a[2]];
      const t = vdot(d, ax) / L; // 0..1 along
      const rad = vlen(vsub(d, vmul(ax, t * L)));
      const tt = clamp(t, 0, 1);
      const r = ra + (rb - ra) * tt;
      const u = (t - 0.5) / (0.5 + over);
      return u * u + (rad / r) * (rad / r) <= 1;
    }, col, o);
  }
  /** oriented ellipsoid on the orthonormal axes ax */
  oell(c: V3, ax: [V3, V3, V3], r: V3, col: Col, o: Op = {}) {
    const R = Math.max(r[0], r[1], r[2]);
    return this.region(vsub(c, [R, R, R]), vadd(c, [R, R, R]), (x, y, z) => {
      const d: V3 = [x - c[0], y - c[1], z - c[2]];
      const a = vdot(d, ax[0]) / r[0], b = vdot(d, ax[1]) / r[1], e = vdot(d, ax[2]) / r[2];
      return a * a + b * b + e * e <= 1;
    }, col, o);
  }
  /** rounded box (SDF) */
  rbox(c: V3, h: V3, rr: number, col: Col, o: Op = {}) {
    return this.region(vsub(c, h), vadd(c, h), (x, y, z) => {
      const qx = Math.abs(x - c[0]) - (h[0] - rr), qy = Math.abs(y - c[1]) - (h[1] - rr), qz = Math.abs(z - c[2]) - (h[2] - rr);
      const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
      return out <= rr;
    }, col, o);
  }
  /** paint the voxels that face into an empty `hole` (socket walls, nostrils, rips) */
  walls(lo: V3, hi: V3, hole: (x: number, y: number, z: number) => boolean, col: Col, flags?: number) {
    const k = this.k, m = this.m;
    const i0 = Math.floor(lo[0] * k - 0.5), i1 = Math.ceil(hi[0] * k - 0.5);
    const j0 = Math.floor(lo[1] * k - 0.5), j1 = Math.ceil(hi[1] * k - 0.5);
    const l0 = Math.floor(lo[2] * k - 0.5), l1 = Math.ceil(hi[2] * k - 0.5);
    const todo: [number, number, number, number][] = [];
    const N: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (let l = l0; l <= l1; l++) {
          if (!m.has(i, j, l)) continue;
          let wall = false;
          for (const n of N) {
            const a = i + n[0], b = j + n[1], c = l + n[2];
            if (m.has(a, b, c)) continue;
            if (hole((a + 0.5) / k, (b + 0.5) / k, (c + 0.5) / k)) {
              wall = true;
              break;
            }
          }
          if (!wall) continue;
          const cc = typeof col === 'number' ? col : col((i + 0.5) / k, (j + 0.5) / k, (l + 0.5) / k);
          if (cc !== null) todo.push([i, j, l, cc]);
        }
    for (const [i, j, l, c] of todo) m.paintAt(i, j, l, c, flags);
    return this;
  }
  /** copy every voxel of another model in (later wins) */
  merge(o: VoxelModel) {
    o.forEach((x, y, z, c, f) => this.m.set(x, y, z, c, f));
    return this;
  }
}

/** hand shading: base voxels with open undersides take `shade`; exposed top edges take `hi` */
export function shadeRamps(m: VoxelModel, ramps: Ramp[], hi = true) {
  const map = new Map<number, Ramp>();
  for (const r of ramps) map.set(r.base & 0xffffff, r);
  const todo: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, rgb, f) => {
    const r = map.get(rgb);
    if (!r) return;
    if (!m.has(x, y - 1, z)) todo.push([x, y, z, r.shade, f]);
    else if (hi && !m.has(x, y + 1, z) && (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1))) todo.push([x, y, z, r.hi, f]);
  });
  for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f);
  return m;
}

/** split voxels out of a model into a new one (by design-space predicate) */
export function splitOff(src: Sc, name: string, pred: (x: number, y: number, z: number) => boolean) {
  const out = new VoxelModel(name);
  const k = src.k;
  const del: [number, number, number][] = [];
  src.m.forEach((i, j, l, c, f) => {
    if (!pred((i + 0.5) / k, (j + 0.5) / k, (l + 0.5) / k)) return;
    out.set(i, j, l, c, f);
    del.push([i, j, l]);
  });
  for (const [i, j, l] of del) src.m.del(i, j, l);
  return out;
}

/** voxel-index mirror of a whole model across x = 0 (right limb from a left one) */
export function mirrorModel(src: VoxelModel, name: string) {
  const o = new VoxelModel(name);
  src.forEach((x, y, z, rgb, flags) => o.set(-1 - x, y, z, rgb, flags));
  return o;
}
