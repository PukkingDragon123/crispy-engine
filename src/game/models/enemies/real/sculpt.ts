// Meter-based sculpting for the high-resolution enemy rigs.
// All coordinates are METERS in rig space (origin on the ground, faces +Z,
// left = +X). The symmetry plane is x = 0 m, which sits on a voxel BOUNDARY
// (voxel x mirrors to -1-x), so even-width bodies mirror perfectly.
import { VoxelModel, VF, CSpec, ColorFn, mix, mulRGB } from '../../../../engine/voxel/VoxelModel';
import { P } from '../../../../engine/voxel/palette';
import type { RigSpec, V3 } from '../../../../engine/voxel/Rig';
import { hash3, noise } from '../../../../engine/math/rand';
import { RB, ball as vBall, ell as vEll, carveEll as vCarveEll, rbox as vRbox, jit } from './kit';

export type M3 = [number, number, number];

// ---------------------------------------------------------------------------
// v3: the Sc methods below are SMOOTH (realistic creatures); cboxV stays for legacy callers.
// A "ball"/"ellipsoid" becomes an axis-aligned box with chamfered edges, a
// "capsule" becomes a stair-stepped run of boxes, a "disc" a chamfered square slab.
// ---------------------------------------------------------------------------
/** chamfer steps for a given half size (voxels) */
function chamferFor(h: number) {
  return h >= 5 ? 2.01 : h >= 1.9 ? 1.01 : 0;
}
/** chamfered box centered at (cx,cy,cz) with half extents (hx,hy,hz) in voxels */
export function cboxV(m: VoxelModel, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, col: CSpec, fl?: number, chamfer?: number) {
  const k = chamfer ?? chamferFor(Math.min(hx, hy, hz));
  const x0 = Math.round(cx - hx), x1 = Math.round(cx + hx) - 1;
  const y0 = Math.round(cy - hy), y1 = Math.round(cy + hy) - 1;
  const z0 = Math.round(cz - hz), z1 = Math.round(cz + hz) - 1;
  for (let x = x0; x <= Math.max(x0, x1); x++)
    for (let y = y0; y <= Math.max(y0, y1); y++)
      for (let z = z0; z <= Math.max(z0, z1); z++) {
        if (k > 0) {
          const dx = Math.min(x - x0, x1 - x) + 0.5, dy = Math.min(y - y0, y1 - y) + 0.5, dz = Math.min(z - z0, z1 - z) + 0.5;
          if (dx + dy < k || dx + dz < k || dy + dz < k) continue;
        }
        m.set(x, y, z, col, fl);
      }
}
export function carveBoxV(m: VoxelModel, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number) {
  const x0 = Math.round(cx - hx), x1 = Math.round(cx + hx) - 1;
  const y0 = Math.round(cy - hy), y1 = Math.round(cy + hy) - 1;
  const z0 = Math.round(cz - hz), z1 = Math.round(cz + hz) - 1;
  for (let x = x0; x <= Math.max(x0, x1); x++) for (let y = y0; y <= Math.max(y0, y1); y++) for (let z = z0; z <= Math.max(z0, z1); z++) m.del(x, y, z);
}


/** Sculptor: wraps a VoxelModel with meter-space primitives */
export class Sc {
  f: number;
  constructor(public m: VoxelModel, public vs: number) {
    this.f = 1 / vs;
  }
  /** meters -> continuous voxel coordinate */
  v(x: number) {
    return x * this.f;
  }
  /** meters -> voxel index containing that point */
  i(x: number) {
    return Math.floor(x * this.f);
  }
  /** SMOOTH (realistic v3): sphere of radius r */
  ball(c: M3, r: number, col: CSpec, fl?: number) {
    return this.ell(c, [r, r, r], col, fl);
  }
  /** SMOOTH: axis-aligned ellipsoid with radii r (each at least half a voxel) */
  ell(c: M3, r: M3, col: CSpec, fl?: number) {
    this.ellOp(c, r, (i, j, k) => this.m.set(i, j, k, col, fl));
    return this;
  }
  private ellOp(c: M3, r: M3, fn: (i: number, j: number, k: number) => void) {
    const vs = this.vs;
    const rx = Math.max(vs * 0.5, r[0]), ry = Math.max(vs * 0.5, r[1]), rz = Math.max(vs * 0.5, r[2]);
    const i0 = this.i(c[0] - rx) - 1, i1 = this.i(c[0] + rx) + 1;
    const j0 = this.i(c[1] - ry) - 1, j1 = this.i(c[1] + ry) + 1;
    const k0 = this.i(c[2] - rz) - 1, k1 = this.i(c[2] + rz) + 1;
    let any = false;
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (let k = k0; k <= k1; k++) {
          const dx = ((i + 0.5) * vs - c[0]) / rx, dy = ((j + 0.5) * vs - c[1]) / ry, dz = ((k + 0.5) * vs - c[2]) / rz;
          if (dx * dx + dy * dy + dz * dz <= 1) {
            fn(i, j, k);
            any = true;
          }
        }
    if (!any) fn(this.i(c[0]), this.i(c[1]), this.i(c[2]));
  }
  /** SMOOTH: ellipsoidal carve with radii r */
  carve(c: M3, r: M3) {
    this.ellOp(c, r, (i, j, k) => this.m.del(i, j, k));
    return this;
  }
  /** SMOOTH: round capsule/cone from a to b (radius r0 -> r1) */
  limb(a: M3, b: M3, r0: number, r1: number, col: CSpec, fl?: number) {
    const vs = this.vs;
    const ra = Math.max(vs * 0.5, r0), rb2 = Math.max(vs * 0.5, r1);
    const R = Math.max(ra, rb2);
    const d: M3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1e-9;
    for (let i = this.i(Math.min(a[0], b[0]) - R) - 1; i <= this.i(Math.max(a[0], b[0]) + R) + 1; i++)
      for (let j = this.i(Math.min(a[1], b[1]) - R) - 1; j <= this.i(Math.max(a[1], b[1]) + R) + 1; j++)
        for (let k = this.i(Math.min(a[2], b[2]) - R) - 1; k <= this.i(Math.max(a[2], b[2]) + R) + 1; k++) {
          const px = (i + 0.5) * vs - a[0], py = (j + 0.5) * vs - a[1], pz = (k + 0.5) * vs - a[2];
          const t = Math.max(0, Math.min(1, (px * d[0] + py * d[1] + pz * d[2]) / L2));
          const qx = px - d[0] * t, qy = py - d[1] * t, qz = pz - d[2] * t;
          const rr = ra + (rb2 - ra) * t;
          if (qx * qx + qy * qy + qz * qz <= rr * rr) this.m.set(i, j, k, col, fl);
        }
    this.m.set(this.i(a[0]), this.i(a[1]), this.i(a[2]), col, fl);
    this.m.set(this.i(b[0]), this.i(b[1]), this.i(b[2]), col, fl);
    return this;
  }
  /** smooth tube through points with radius interpolated r0->r1 */
  tube(pts: M3[], r0: number, r1: number, col: CSpec, fl?: number) {
    let total = 0;
    for (let k = 0; k < pts.length - 1; k++) total += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1], pts[k + 1][2] - pts[k][2]);
    let acc = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const ra = r0 + (r1 - r0) * (acc / (total || 1));
      const rb = r0 + (r1 - r0) * ((acc + seg) / (total || 1));
      this.limb(a, b, ra, rb, col, fl);
      acc += seg;
    }
    return this;
  }
  /** axis-aligned box in meters (min/max corners, inclusive of covered voxels) */
  box(a: M3, b: M3, col: CSpec, fl?: number) {
    this.m.box(this.i(Math.min(a[0], b[0]) + 1e-6), this.i(Math.min(a[1], b[1]) + 1e-6), this.i(Math.min(a[2], b[2]) + 1e-6), this.i(Math.max(a[0], b[0]) - 1e-6), this.i(Math.max(a[1], b[1]) - 1e-6), this.i(Math.max(a[2], b[2]) - 1e-6), col, fl);
    return this;
  }
  /** SMOOTH: rounded box between corners, corner radius rr (meters) */
  rbox(a: M3, b: M3, rr: number, col: CSpec, fl?: number) {
    const vs = this.vs;
    const lo: M3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
    const hi: M3 = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
    const r = Math.max(0, Math.min(rr, (hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2));
    const ilo: M3 = [lo[0] + r, lo[1] + r, lo[2] + r], ihi: M3 = [hi[0] - r, hi[1] - r, hi[2] - r];
    for (let i = this.i(lo[0]); i <= this.i(hi[0] - 1e-6); i++)
      for (let j = this.i(lo[1]); j <= this.i(hi[1] - 1e-6); j++)
        for (let k = this.i(lo[2]); k <= this.i(hi[2] - 1e-6); k++) {
          const p: M3 = [(i + 0.5) * vs, (j + 0.5) * vs, (k + 0.5) * vs];
          const dx = Math.max(ilo[0] - p[0], 0, p[0] - ihi[0]), dy = Math.max(ilo[1] - p[1], 0, p[1] - ihi[1]), dz = Math.max(ilo[2] - p[2], 0, p[2] - ihi[2]);
          if (dx * dx + dy * dy + dz * dz <= r * r + 1e-9) this.m.set(i, j, k, col, fl);
        }
    return this;
  }
  carveBox(a: M3, b: M3) {
    this.m.carveBox(this.i(Math.min(a[0], b[0]) + 1e-6), this.i(Math.min(a[1], b[1]) + 1e-6), this.i(Math.min(a[2], b[2]) + 1e-6), this.i(Math.max(a[0], b[0]) - 1e-6), this.i(Math.max(a[1], b[1]) - 1e-6), this.i(Math.max(a[2], b[2]) - 1e-6));
    return this;
  }
  /** single voxel containing the meter point */
  dot(p: M3, col: CSpec, fl?: number) {
    this.m.set(this.i(p[0]), this.i(p[1]), this.i(p[2]), col, fl);
    return this;
  }
  /** voxel at meter point offset by integer voxel steps */
  px(p: M3, dx: number, dy: number, dz: number, col: CSpec, fl?: number) {
    this.m.set(this.i(p[0]) + dx, this.i(p[1]) + dy, this.i(p[2]) + dz, col, fl);
    return this;
  }
  del(p: M3, dx = 0, dy = 0, dz = 0) {
    this.m.del(this.i(p[0]) + dx, this.i(p[1]) + dy, this.i(p[2]) + dz);
    return this;
  }
  /** 1-voxel line */
  line(a: M3, b: M3, col: CSpec, fl?: number) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * this.f;
    const steps = Math.max(1, Math.ceil(len * 1.5));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      this.m.set(this.i(a[0] + (b[0] - a[0]) * t), this.i(a[1] + (b[1] - a[1]) * t), this.i(a[2] + (b[2] - a[2]) * t), col, fl);
    }
    return this;
  }
  /** SMOOTH disc: cylinder of radius r and height h around axis through c, optional hole rIn */
  disc(c: M3, r: number, h: number, axis: 'x' | 'y' | 'z', col: CSpec, fl?: number, rIn = 0) {
    const vs = this.vs;
    const H = Math.max(1, Math.round(h * this.f));
    const R = Math.max(vs * 0.5, r);
    const n = Math.ceil(R / vs) + 1;
    const ci = this.i(c[0]), cj = this.i(c[1]), ck = this.i(c[2]);
    for (let a = -n; a <= n; a++)
      for (let b = -n; b <= n; b++) {
        // offsets measured between voxel centres and the axis point
        const pa = axis === 'x' ? (cj + a + 0.5) * vs - c[1] : (ci + a + 0.5) * vs - c[0];
        const pb = axis === 'z' ? (cj + b + 0.5) * vs - c[1] : (ck + b + 0.5) * vs - c[2];
        const d = Math.hypot(pa, pb);
        if (d > R || (rIn > 0 && d < rIn)) continue;
        for (let t = 0; t < H; t++) {
          if (axis === 'y') this.m.set(ci + a, cj + t, ck + b, col, fl);
          else if (axis === 'x') this.m.set(ci + t, cj + a, ck + b, col, fl);
          else this.m.set(ci + a, cj + b, ck + t, col, fl);
        }
      }
    return this;
  }
  /** wrap a band of voxels around an existing limb segment at height y (shell between r0 and r1 from axis point) */
  band(c: M3, rOut: number, rIn: number, thick: number, col: CSpec, fl?: number) {
    return this.disc([c[0], c[1] - thick / 2, c[2]], rOut, thick, 'y', col, fl, rIn);
  }
  /** voxels of the model within radius r of point (meters) */
  each(fn: (x: number, y: number, z: number, rgb: number, flags: number) => void) {
    this.m.forEach(fn);
  }
}

/** Rig builder in meters with boundary symmetry plane */
export class RBm extends RB {
  constructor(name: string, voxelSize: number) {
    super(name, voxelSize);
    this.plane = 0;
  }
  /** create part with pivot in meters; returns a sculptor */
  pm(name: string, parent: string | undefined, pivot: M3, rest?: V3): Sc {
    const f = 1 / this.voxelSize;
    const m = this.part(name, parent, [pivot[0] * f, pivot[1] * f, pivot[2] * f], rest);
    return new Sc(m, this.voxelSize);
  }
  sc(name: string): Sc {
    return new Sc(this.m(name), this.voxelSize);
  }
  sockM(name: string, part: string, at: M3, rot?: V3) {
    const f = 1 / this.voxelSize;
    this.socket(name, part, [at[0] * f, at[1] * f, at[2] * f], rot);
  }
}

// ---------------------------------------------------------------------------
// Color functions (cell sizes in voxels; use cellM(vs, meters) to convert)
// ---------------------------------------------------------------------------
export const cellM = (vs: number, meters: number) => vs / meters;

/** polished 3-tone material: broad clusters of hi / base / lo (no speckle) */
export function tonal(base: number, hi: number, lo: number, scale: number, seed = 0, j = 0.03): ColorFn {
  const jj = Math.min(j, 0.012);
  return (x, y, z) => {
    const n = noise.n3(x * scale * 0.8 + seed * 3.3, y * scale * 0.8 - seed * 1.1, z * scale * 0.8 + seed * 2.7);
    const c = n > 0.38 ? mix(base, hi, 0.75) : n < -0.38 ? mix(base, lo, 0.7) : base;
    return mulRGB(c, 1 + (hash3(x + seed, y, z - seed) - 0.5) * 2 * jj);
  };
}
/** cloth with vertical folds (darker crease every `period` voxels along axis, wobbly) + weave jitter */
export function cloth(base: number, crease: number, period: number, axis: 'x' | 'z', seed = 0, j = 0.03): ColorFn {
  return (x, y, z) => {
    const a = axis === 'x' ? x : z;
    const w = noise.n2(a * 0.18 + seed, y * 0.05) * period * 0.45;
    const ph = (((a + w) % period) + period) % period;
    const t = Math.abs(ph - period / 2) / (period / 2); // 1 at crease
    const c = t > 0.8 ? mix(base, crease, (t - 0.8) * 3) : t < 0.25 ? mix(base, 0xffffff, 0.06) : base;
    const weave = (x + y + z) % 2 === 0 ? 1.02 : 0.98;
    return mulRGB(c, weave * (1 + (hash3(x, y + seed, z) - 0.5) * 2 * j));
  };
}
/** stripes along y (serape / bands) */
export function stripes(cols: number[], h: number, slant = 0, seed = 0): ColorFn {
  // clean woven stripes: band index by y (h voxels tall), tiny weave checker + jitter
  return (x, y, z) => {
    const k = Math.floor((y + Math.floor(x * slant)) / Math.max(1, h));
    const c = cols[((k % cols.length) + cols.length) % cols.length];
    const weave = ((x + y + z) & 1) === 0 ? 1.03 : 0.97;
    return mulRGB(c, weave * (0.97 + hash3(x, y + seed, z) * 0.05));
  };
}
/** metal with subtle scratches/brushed sheen */
export function metal(base: number, seed = 0): ColorFn {
  // polished metal: clean base with occasional crisp highlight rows (no speckle)
  return (x, y, z) => {
    const row = ((y + seed) % 5 === 0) ? 1.08 : 1.0;
    return mulRGB(base, row * (0.99 + hash3(x + seed, y * 3, z) * 0.02));
  };
}
export { jit };

// ---------------------------------------------------------------------------
// Detail primitives
// ---------------------------------------------------------------------------
/**
 * Hand hanging below the wrist (fingers point -Y, curling toward +Z).
 * side: +1 left hand (thumb toward +Z/-X inside), -1 right hand.
 * kind: 'claw' (long nailed fingers), 'bony' (skeletal phalanges), 'glove', 'wrapped', 'paw'
 */
export function handM(s: Sc, w: M3, side: 1 | -1, kind: 'claw' | 'bony' | 'glove' | 'wrapped' | 'paw', col: CSpec, accent: CSpec, size = 1) {
  const vs = s.vs;
  const pw = 0.034 * size; // palm half width (z)
  const pt = 0.022 * size; // palm half thickness (x)
  const ph = 0.05 * size; // palm half height
  const pc: M3 = [w[0], w[1] - ph * 0.9, w[2] + 0.004];
  if (kind === 'bony') {
    // carpal block + metacarpals
    s.ell([w[0], w[1] - 0.02, w[2]], [pt, 0.022, pw * 0.8], col);
    for (let f = 0; f < 4; f++) {
      const z = w[2] - pw + (f / 3) * pw * 2;
      const len = (f === 1 || f === 2 ? 0.115 : 0.095) * size;
      const knuckle: M3 = [w[0], w[1] - 0.055 * size, z];
      s.line([w[0], w[1] - 0.03, z * 0.6 + w[2] * 0.4], knuckle, col);
      s.dot(knuckle, mulRGB(0xfff2d8, 1.0));
      // phalanges curl slightly forward
      const mid: M3 = [w[0], knuckle[1] - len * 0.5, z + 0.012];
      const tip: M3 = [w[0] - side * 0.004, knuckle[1] - len, z + 0.03];
      s.line(knuckle, mid, col);
      s.line(mid, tip, col);
      s.dot(mid, accent);
    }
    // thumb
    s.line([w[0] - side * 0.02, w[1] - 0.03, w[2] + pw], [w[0] - side * 0.03, w[1] - 0.08 * size, w[2] + pw + 0.025], col);
    return;
  }
  if (kind === 'paw') {
    s.ell(pc, [pt * 1.25, ph * 1.2, pw * 1.25], col);
    for (let f = 0; f < 4; f++) {
      const z = pc[2] - pw * 1.1 + (f / 3) * pw * 2.2;
      s.ball([pc[0], pc[1] - ph * 1.1, z], 0.016 * size, col);
      s.dot([pc[0], pc[1] - ph * 1.1 - 0.018 * size, z + 0.012], accent); // claw
    }
    return;
  }
  // palm
  s.ell(pc, [pt, ph, pw], col);
  const fingerLen = (kind === 'claw' ? 0.11 : 0.075) * size;
  const n = kind === 'glove' || kind === 'wrapped' ? 4 : 4;
  for (let f = 0; f < n; f++) {
    const z = pc[2] - pw * 0.85 + (f / (n - 1)) * pw * 1.7;
    const base: M3 = [pc[0], pc[1] - ph * 0.8, z];
    const mid: M3 = [pc[0] - side * 0.003, base[1] - fingerLen * 0.55, z + 0.012];
    const tip: M3 = [pc[0] - side * 0.006, base[1] - fingerLen, z + 0.03];
    s.limb(base, mid, 0.011 * size, 0.01 * size, col);
    s.limb(mid, tip, 0.01 * size, 0.008 * size, col);
    if (kind === 'claw') s.dot([tip[0], tip[1] - vs * 0.6, tip[2] + vs * 0.4], accent);
    if (kind === 'glove' && f === 0) s.dot([pc[0], pc[1] + ph * 0.6, pc[2]], accent);
  }
  // thumb
  s.limb([pc[0] - side * pt * 0.6, pc[1] + ph * 0.2, pc[2] + pw * 0.7], [pc[0] - side * pt * 1.2, pc[1] - ph * 0.9, pc[2] + pw * 1.4], 0.012 * size, 0.009 * size, col);
  if (kind === 'claw') s.dot([pc[0] - side * pt * 1.3, pc[1] - ph * 1.1, pc[2] + pw * 1.6], accent);
  if (kind === 'wrapped') for (let k = 0; k < 3; k++) s.band([pc[0], pc[1] + ph * (0.6 - k * 0.6), pc[2]], pt + 0.012, pt * 0.3, vs, accent);
}

/** Foot at ankle `a` pointing +Z. kind: 'boot' (heel, sole, stitching, optional spur), 'bare', 'wrapped', 'sandal', 'paw' */
export function footM(s: Sc, a: M3, kind: 'boot' | 'bare' | 'wrapped' | 'sandal' | 'paw', col: CSpec, accent: CSpec, o: { len?: number; w?: number; spur?: boolean; shaft?: number } = {}) {
  const vs = s.vs;
  const len = o.len ?? 0.3;
  const w = o.w ?? 0.1;
  const zb = a[2] - len * 0.3, zf = a[2] + len * 0.7;
  if (kind === 'boot') {
    s.rbox([a[0] - w / 2, 0, zb], [a[0] + w / 2, 0.085, zf], 0.03, col);
    s.ell([a[0], 0.06, zf - 0.04], [w / 2, 0.045, 0.06], col); // toe cap
    s.box([a[0] - w / 2, 0, zb], [a[0] + w / 2, vs, zf], accent); // sole
    s.box([a[0] - w / 2, 0, zb], [a[0] + w / 2, 0.05, zb + 0.07], mulCol(col, 0.7)); // heel
    const sh = o.shaft ?? 0.22;
    s.rbox([a[0] - w / 2 - vs * 0.5, 0.06, zb], [a[0] + w / 2 + vs * 0.5, sh, zb + 0.12], 0.02, col); // shaft
    s.box([a[0] - w / 2 - vs, sh - vs * 1.5, zb - vs * 0.5], [a[0] + w / 2 + vs, sh, zb + 0.12 + vs * 0.5], mulCol(col, 1.12)); // cuff
    // stitching along the welt
    for (let z = zb + 0.03; z < zf - 0.02; z += vs * 2) {
      s.dot([a[0] + w / 2 - 1e-4, vs * 1.2, z], 0xe8d2a8);
      s.dot([a[0] - w / 2 + 1e-4, vs * 1.2, z], 0xe8d2a8);
    }
    if (o.spur) {
      const sp: M3 = [a[0], 0.04, zb - 0.03];
      s.line([a[0], 0.045, zb + 0.01], sp, metal(P.silver1), VF.METAL);
      // rowel star
      for (const [dy, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        if (Math.abs(dy) + Math.abs(dz) === 2 && (dy + dz) % 2 === 0) s.px(sp, 0, dy * 2, dz * 2, P.silver0, VF.METAL);
        s.px(sp, 0, dy, dz, P.silver1, VF.METAL);
      }
    }
  } else if (kind === 'sandal') {
    s.ell([a[0], 0.035, a[2] + len * 0.2], [w / 2, 0.035, len / 2], col);
    s.box([a[0] - w / 2 - vs, 0, zb], [a[0] + w / 2 + vs, vs, zf], accent);
    s.band([a[0], 0.05, a[2] + 0.05], w / 2 + vs * 0.5, w / 2 - vs * 0.5, vs, accent);
  } else if (kind === 'paw') {
    s.ell([a[0], 0.04, a[2] + len * 0.25], [w / 2, 0.045, len / 2], col);
    for (let t = 0; t < 3; t++) s.dot([a[0] - w / 3 + (t * w) / 3, 0.01, zf + vs], accent);
  } else {
    // bare / wrapped: bony foot with toes
    s.ell([a[0], 0.04, a[2] + len * 0.2], [w / 2, 0.042, len / 2], col);
    s.limb([a[0], 0.07, a[2]], [a[0], 0.04, a[2] + len * 0.35], 0.03, 0.025, col);
    const toes = 4;
    for (let t = 0; t < toes; t++) {
      const x = a[0] - w / 2 + vs * 0.5 + (t / (toes - 1)) * (w - vs);
      s.dot([x, vs * 0.5, zf], col);
      s.dot([x, vs * 0.5, zf + vs], accent);
    }
    if (kind === 'wrapped') for (let k = 0; k < 3; k++) s.band([a[0], 0.04 + k * 0.035, a[2] + 0.02], w / 2 + vs * 0.6, w / 2 - vs, vs, accent);
  }
}

function mulCol(c: CSpec, k: number): CSpec {
  return typeof c === 'number' ? mulRGB(c, k) : (x, y, z) => {
    const v = c(x, y, z);
    return v === null ? null : mulRGB(v, k);
  };
}
export { mulCol };

export interface HumanM {
  hip: M3;
  knee: M3;
  ankle: M3;
  shoulder: M3;
  elbow: M3;
  wrist: M3;
  waist: M3;
  pelvis: { c: M3; r: M3 };
  torso: { y0: number; y1: number; f: (t: number) => { zc: number; rx: number; rz: number; xc?: number } };
  thighR: [number, number];
  shinR: [number, number];
  armR: [number, number];
  foreR: [number, number];
  col: { pelvis: CSpec; torso: CSpec; arm: CSpec; fore: CSpec; hand: CSpec; thigh: CSpec; shin: CSpec; foot: CSpec; accent: CSpec; footAccent?: CSpec };
  hand: 'claw' | 'bony' | 'glove' | 'wrapped' | 'paw';
  foot: 'boot' | 'bare' | 'wrapped' | 'sandal' | 'paw';
  footLen?: number;
  footW?: number;
  handSize?: number;
  spur?: boolean;
  bootShaft?: number;
}

/** Base humanoid volumes, LEFT side only for limbs (call rb.mirrorLR() afterwards). */
export function humanM(rb: RBm, h: HumanM) {
  const pelvis = rb.pm('pelvis', undefined, [0, h.hip[1], h.waist[2]]);
  pelvis.ell(h.pelvis.c, h.pelvis.r, h.col.pelvis);
  const torso = rb.pm('torso', 'pelvis', h.waist);
  const vs = rb.voxelSize;
  for (let y = h.torso.y0; y <= h.torso.y1 + 1e-6; y += vs) {
    const t = (y - h.torso.y0) / (h.torso.y1 - h.torso.y0);
    const { zc, rx, rz } = h.torso.f(t);
    torso.ell([0, y + vs * 0.5, zc], [rx, vs * 0.6, rz], h.col.torso);
  }
  const arm = rb.pm('arm_l', 'torso', h.shoulder);
  arm.ball(h.shoulder, h.armR[0] * 1.15, h.col.arm);
  arm.limb(h.shoulder, h.elbow, h.armR[0], h.armR[1], h.col.arm);
  const fore = rb.pm('fore_l', 'arm_l', h.elbow);
  fore.ball(h.elbow, h.foreR[0] * 0.95, h.col.fore);
  fore.limb(h.elbow, h.wrist, h.foreR[0], h.foreR[1], h.col.fore);
  handM(fore, h.wrist, 1, h.hand, h.col.hand, h.col.accent, h.handSize ?? 1);
  const thigh = rb.pm('thigh_l', 'pelvis', h.hip);
  thigh.ball(h.hip, h.thighR[0] * 1.05, h.col.thigh);
  thigh.limb(h.hip, h.knee, h.thighR[0], h.thighR[1], h.col.thigh);
  const shin = rb.pm('shin_l', 'thigh_l', h.knee);
  shin.ball(h.knee, h.shinR[0] * 0.98, h.col.shin);
  shin.limb(h.knee, h.ankle, h.shinR[0], h.shinR[1], h.col.shin);
  footM(shin, h.ankle, h.foot, h.col.foot, h.col.footAccent ?? h.col.accent, { len: h.footLen, w: h.footW, spur: h.spur, shaft: h.bootShaft });
  return { pelvis, torso, arm, fore, thigh, shin };
}

/** torso radius/center at height y (for surface details) */
export function torsoAt(h: HumanM, y: number) {
  const t = Math.max(0, Math.min(1, (y - h.torso.y0) / (h.torso.y1 - h.torso.y0)));
  return h.torso.f(t);
}

/** Detailed skull on a head sculptor. c = skull center (meters). Returns face front z (meters). */
export function skullM(s: Sc, c: M3, o: { r: number; eye: number; boneC: CSpec; dark: CSpec; glow?: boolean; cracks?: boolean; noEyes?: boolean }) {
  const vs = s.vs, r = o.r;
  s.ell([c[0], c[1] + r * 0.18, c[2] - r * 0.1], [r, r * 0.95, r * 1.08], o.boneC); // cranium
  s.rbox([c[0] - r * 0.86, c[1] - r * 0.95, c[2] - r * 0.4], [c[0] + r * 0.86, c[1] + r * 0.2, c[2] + r * 0.95], r * 0.35, o.boneC); // face
  const zf = c[2] + r * 0.95;
  // brow ridge
  s.box([c[0] - r * 0.82, c[1] + r * 0.18, zf - vs], [c[0] + r * 0.82, c[1] + r * 0.18 + vs * 1.5, zf + vs * 0.8], mulCol(o.boneC, 1.06));
  // eye sockets: rounded, deep, with a pinpoint glow at the back
  for (const sx of [-1, 1]) {
    const ec: M3 = [c[0] + sx * r * 0.42, c[1] - r * 0.08, zf];
    s.carve(ec, [r * 0.27, r * 0.24, r * 0.38]);
    s.ell([ec[0], ec[1], ec[2] - r * 0.32], [r * 0.24, r * 0.22, vs * 0.8], o.dark);
    if (!o.noEyes) s.ell([ec[0], ec[1] - vs * 0.3, ec[2] - r * 0.26], [vs * 0.8, vs * 0.8, vs * 0.7], o.eye, o.glow ? VF.GLOW : VF.EMISSIVE);
  }
  // nasal cavity (inverted heart)
  const nc: M3 = [c[0], c[1] - r * 0.42, zf];
  s.carve(nc, [r * 0.13, r * 0.16, r * 0.2]);
  s.ell([nc[0], nc[1], nc[2] - r * 0.17], [r * 0.12, r * 0.14, vs * 0.7], o.dark);
  // cheekbones
  s.ell([c[0] - r * 0.7, c[1] - r * 0.42, zf - r * 0.22], [r * 0.18, r * 0.12, r * 0.18], mulCol(o.boneC, 1.05));
  s.ell([c[0] + r * 0.7, c[1] - r * 0.42, zf - r * 0.22], [r * 0.18, r * 0.12, r * 0.18], mulCol(o.boneC, 1.05));
  // upper teeth row
  const ty = c[1] - r * 0.78;
  for (let x = c[0] - r * 0.5; x <= c[0] + r * 0.5 + 1e-6; x += vs) {
    s.dot([x, ty, zf - vs * 0.2], hash3(Math.round(x / vs), 1, 2) > 0.15 ? mulRGB(0xf6ead0, 0.97 + hash3(Math.round(x / vs), 3, 4) * 0.06) : o.dark);
    s.dot([x, ty - vs, zf - vs * 0.2], Math.round(x / vs) % 2 ? 0xf3e4c4 : 0xdac39a);
    s.dot([x, ty, zf - vs * 1.2], o.dark);
  }
  // temporal hollows
  s.carve([c[0] - r * 0.98, c[1] - r * 0.1, c[2] + r * 0.2], [vs * 1.2, r * 0.25, r * 0.3]);
  s.carve([c[0] + r * 0.98, c[1] - r * 0.1, c[2] + r * 0.2], [vs * 1.2, r * 0.25, r * 0.3]);
  // sutures / cracks
  if (o.cracks !== false) {
    s.line([c[0] + r * 0.1, c[1] + r * 1.1, c[2] + r * 0.2], [c[0] + r * 0.45, c[1] + r * 0.65, zf - r * 0.15], o.dark);
    s.line([c[0] - r * 0.6, c[1] + r * 0.9, c[2] - r * 0.3], [c[0] - r * 0.2, c[1] + r * 1.08, c[2] + r * 0.1], o.dark);
  }
  return zf;
}
/** where skullM puts the left eye light (meters) */
export function skullEyeL(c: M3, r: number, vs: number): M3 {
  return [c[0] + r * 0.42, c[1] - r * 0.08 - vs * 0.3, c[2] + r * 0.95 - r * 0.26];
}

/** Lower jaw for skullM (sculpt on the jaw part). */
export function jawM(s: Sc, c: M3, r: number, zf: number, boneC: CSpec, dark: CSpec) {
  const vs = s.vs;
  const ty = c[1] - r * 0.78;
  s.rbox([c[0] - r * 0.62, ty - r * 0.42, c[2] - r * 0.2], [c[0] + r * 0.62, ty - vs * 1.5, zf - vs * 0.2], r * 0.18, boneC);
  // ramus up to the hinge
  s.limb([c[0] - r * 0.62, ty - r * 0.3, c[2] - r * 0.1], [c[0] - r * 0.7, c[1] - r * 0.3, c[2] - r * 0.15], vs * 1.1, vs, boneC);
  s.limb([c[0] + r * 0.62, ty - r * 0.3, c[2] - r * 0.1], [c[0] + r * 0.7, c[1] - r * 0.3, c[2] - r * 0.15], vs * 1.1, vs, boneC);
  for (let x = c[0] - r * 0.45; x <= c[0] + r * 0.45 + 1e-6; x += vs) {
    s.dot([x, ty - vs * 2, zf - vs * 0.5], Math.round(x / vs) % 2 ? 0xf3e4c4 : 0xdac39a);
    s.dot([x, ty - vs * 2, zf - vs * 1.5], dark);
  }
}

/** Glowing alpha crystal shard (meters) */
export const CRYSTAL_ALPHA = [P.alphaCrystal2, P.alphaCrystal1, P.alphaCrystal0, 0xffb8f6];
export const CRYSTAL_SERKET = [0x2f6a2a, 0x5aa83a, 0x9ad86a, 0xd8f8b0];
export const CRYSTAL_QUARTZ = [0x8a7a6a, 0xc8b8a0, 0xe8dcc8, 0xfff8ec];
export function crystalM(s: Sc, base: M3, dir: M3, len: number, r: number, seed = 0, _tipGlow = false, pal: number[] = CRYSTAL_ALPHA) {
  // BLOCKY painted crystal prism: stacked square boxes tapering in 2-3 steps, no glow
  const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / L, dir[1] / L, dir[2] / L];
  const steps = Math.max(3, Math.ceil((len / s.vs) * 1.4));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const tier = t < 0.45 ? 1 : t < 0.8 ? 0.62 : 0.3;
    const rr = Math.max(s.vs * 0.5, r * tier);
    const p: M3 = [base[0] + d[0] * len * t, base[1] + d[1] * len * t, base[2] + d[2] * len * t];
    const col = t > 0.8 ? pal[3] : t > 0.45 ? pal[2] : t > 0.15 ? pal[1] : pal[0];
    s.ball(p, rr, (x, y, z) => mulRGB(col, 0.9 + hash3(x, y + seed, z) * 0.14 + (((x + y) & 1) === 0 ? 0.05 : 0)));
  }
}
export function crystalsM(s: Sc, at: M3, up: M3, size: number, seed = 0, count = 4, pal: number[] = CRYSTAL_ALPHA) {
  for (let k = 0; k < count; k++) {
    const h1 = hash3(seed, k, 1) - 0.5, h2 = hash3(seed, k, 2) - 0.5, h3 = hash3(seed, k, 3);
    crystalM(s, [at[0] + h1 * size * 0.5, at[1], at[2] + h2 * size * 0.5], [up[0] + h1 * 1.2, up[1] + h3 * 0.25, up[2] + h2 * 1.2], size * (0.55 + h3 * 0.7), Math.max(s.vs, size * 0.17), seed + k, false, pal);
  }
}
/** curved horn/spike (meters) */
export function hornM(s: Sc, base: M3, dir: M3, len: number, r: number, col: CSpec, curl: M3 = [0, 0, 0], ridges = true) {
  const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  let d = [dir[0] / L, dir[1] / L, dir[2] / L];
  const steps = Math.max(3, Math.ceil((len / s.vs) * 1.6));
  let p: M3 = [base[0], base[1], base[2]];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const rr = Math.max(s.vs * 0.45, r * (1 - t * 0.95));
    s.ball(p, rr, ridges && k % 4 === 0 && t < 0.8 ? mulCol(col, 0.82) : col);
    p = [p[0] + (d[0] * len) / steps, p[1] + (d[1] * len) / steps, p[2] + (d[2] * len) / steps];
    d = [d[0] + curl[0] / steps, d[1] + curl[1] / steps, d[2] + curl[2] / steps];
    const l2 = Math.hypot(d[0], d[1], d[2]) || 1;
    d = [d[0] / l2, d[1] / l2, d[2] / l2];
  }
}
/** frayed hanging cloth strips along x at depth z (meters), length random per voxel column */
export function frayX(s: Sc, x0: number, x1: number, z: number, yTop: number, minL: number, maxL: number, col: CSpec, seed = 0, thick = 1) {
  const vs = s.vs;
  for (let x = x0; x <= x1 + 1e-6; x += vs) {
    const ix = Math.round(x / vs);
    const h = hash3(ix * 3 + seed, seed * 7, Math.round(z / vs));
    const h2 = hash3(ix, seed, 9);
    const len = minL + (maxL - minL) * (h * 0.7 + h2 * 0.3);
    for (let y = 0; y < len; y += vs) for (let t = 0; t < thick; t++) s.px([x, yTop - y, z], 0, 0, t, col);
    // frayed thread end
    if (h2 > 0.6) s.px([x, yTop - len - vs, z], 0, 0, 0, mulCol(col, 0.85));
  }
}
export function frayZ(s: Sc, z0: number, z1: number, x: number, yTop: number, minL: number, maxL: number, col: CSpec, seed = 0) {
  const vs = s.vs;
  for (let z = z0; z <= z1 + 1e-6; z += vs) {
    const iz = Math.round(z / vs);
    const h = hash3(seed, iz * 5 + seed, Math.round(x / vs));
    const len = minL + (maxL - minL) * h;
    for (let y = 0; y < len; y += vs) s.dot([x, yTop - y, z], col);
  }
}
/** paint exposed surface voxels matching predicate (meter coords passed to pred) */
export function coat(s: Sc, pred: (x: number, y: number, z: number) => boolean, col: CSpec, fl?: number) {
  const m = s.m, vs = s.vs;
  const list: [number, number, number][] = [];
  m.forEach((x, y, z) => {
    if (!pred((x + 0.5) * vs, (y + 0.5) * vs, (z + 0.5) * vs)) return;
    if (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z) || !m.has(x, y - 1, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1)) list.push([x, y, z]);
  });
  for (const [x, y, z] of list) m.paintAt(x, y, z, col, fl);
}
/** carve a voxel only if it's on the surface (for pits, cracks, wear) */
export function pit(s: Sc, p: M3, col: CSpec) {
  s.del(p);
  s.px(p, 0, 0, 0, col);
}

export { VF, P, mix, mulRGB, hash3, noise, VoxelModel };
export type { CSpec, ColorFn, RigSpec, V3 };

/**
 * Detailed revolver gripped by a fist at `h` (meters). In REST pose the barrel
 * points -Y and the gun's top faces +Z (so raising the arm forward aims it +Z).
 * aim-space (x, up, fwd) in VOXELS -> rest voxel (hx + x, hy - fwd, hz + up).
 */
export function revolverM(s: Sc, h: M3, o: { long?: boolean; gold?: boolean; dark?: boolean; scale?: number; side?: 1 | -1 } = {}) {
  const sc = (o.scale ?? 1) * ((1 / 32) / s.vs); // authored at 1/32 m; keep real-world size at other resolutions
  const hx = s.i(h[0]), hy = s.i(h[1]), hz = s.i(h[2]);
  const steel = o.gold ? P.gold1 : o.dark ? 0x5a5754 : P.silver1;
  const steel2 = o.gold ? P.gold2 : o.dark ? 0x353331 : P.silver2;
  const wood = o.gold ? P.bone1 : P.wood2;
  const met = metal(steel, 3);
  const S = (x: number, up: number, fwd: number, c: CSpec, fl: number = VF.METAL) => {
    const X = Math.round(x * sc), U = Math.round(up * sc), F = Math.round(fwd * sc);
    s.m.set(hx + X, hy - F, hz + U, c, fl);
  };
  const X2 = [-1, 0];
  // grip (slanted down-back), wood panels with brass screw + butt cap
  for (let up = -1; up >= -5; up--) {
    const back = Math.round((up + 1) * 0.45);
    for (const x of X2) for (let fw = back - 1; fw <= back + 1; fw++) S(x, up, fw, fw === back - 1 || x === X2[0] ? mulRGB(wood, 0.8) : jit(wood, 0.06), VF.SOLID);
  }
  S(0, -3, -1, P.brass);
  S(-1, -3, -1, P.brass);
  for (const x of X2) for (let fw = -3; fw <= -1; fw++) S(x, -6, fw, steel2);
  // frame
  for (const x of X2) for (let up = 0; up <= 2; up++) for (let fw = -1; fw <= 1; fw++) S(x, up, fw, met);
  // trigger guard loop + trigger
  for (const x of X2) {
    S(x, -1, 2, steel2);
    S(x, -2, 2, steel2);
    S(x, -2, 1, steel2);
  }
  S(0, -1, 0, P.iron2);
  // cylinder: 4x4 rounded with flutes
  for (let x = -2; x <= 1; x++)
    for (let up = 0; up <= 3; up++)
      for (let fw = 2; fw <= 5; fw++) {
        const corner = (x === -2 || x === 1) && (up === 0 || up === 3);
        if (corner) continue;
        const flute = (x === -2 || x === 1 || up === 0 || up === 3) && fw >= 3 && fw <= 4;
        S(x, up, fw, flute ? steel2 : met);
      }
  // barrel (top strap + barrel + rib + front sight + muzzle)
  const bl = o.long ? 10 : 7;
  for (const x of X2) {
    for (let fw = 6; fw < 6 + bl; fw++) {
      S(x, 2, fw, met);
      S(x, 3, fw, met);
    }
    S(x, 4, -1, steel2); // rear sight notch base
  }
  for (let fw = 0; fw <= 5; fw++) S(0, 4, fw, steel2); // top strap
  S(0, 4, 5 + bl, steel2); // front sight blade
  S(-1, 4, 5 + bl, steel2);
  for (const x of X2) S(x, 2, 6 + bl, P.iron2); // muzzle bore
  // ejector rod housing under the barrel
  for (let fw = 6; fw <= 6 + Math.floor(bl * 0.6); fw++) S(0, 1, fw, steel2);
  // hammer with spur
  S(0, 3, -1, steel2);
  S(0, 4, -2, steel2);
  S(0, 5, -3, P.iron2);
  if (o.gold) for (let fw = 7; fw < 5 + bl; fw += 2) S(0, 3, fw, P.gold0); // engraving glints
}

/** Linen wrap bands (diagonal), dark 1-voxel gaps, per-band shade, grime stains */
export function wrapsM(light: number, gap: number, period: number, slope: number, seed = 0, stain = 0x8a6a40): ColorFn {
  return (x, y, z) => {
    const w = noise.n3(x * 0.07 + seed, y * 0.05, z * 0.07) * 1.6;
    const vv = y + (x * 0.6 + z * 0.45) * slope + w;
    const k = ((Math.floor(vv) % period) + period) % period;
    const h = hash3(x, y + seed, z);
    if (k === 0) return mulRGB(gap, 0.85 + h * 0.25);
    const band = Math.floor(vv / period);
    let c = mulRGB(light, 0.9 + hash3(band, seed, 1) * 0.12);
    const st = noise.n3(x * 0.09 + seed, y * 0.09, z * 0.09);
    if (st > 0.35) c = mix(c, stain, Math.min(0.6, (st - 0.35) * 1.8));
    if (k === 1) c = mulRGB(c, 0.9); // shadow under the overlapping edge
    return mulRGB(c, 0.99 + h * 0.02);
  };
}
/** Raise every Nth wrap band one voxel off the surface for a layered look */
export function raiseBands(s: Sc, period: number, slope: number, every: number, seed: number, col: CSpec, pred?: (x: number, y: number, z: number) => boolean) {
  const m = s.m;
  const add: [number, number, number][] = [];
  m.forEach((x, y, z) => {
    if (pred && !pred((x + 0.5) * s.vs, (y + 0.5) * s.vs, (z + 0.5) * s.vs)) return;
    const w = noise.n3(x * 0.07 + seed, y * 0.05, z * 0.07) * 1.6;
    const vv = y + (x * 0.6 + z * 0.45) * slope + w;
    const band = Math.floor(vv / period);
    const k = ((Math.floor(vv) % period) + period) % period;
    if (k === 0 || ((band % every) + every) % every !== 0) return;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) if (!m.has(x + dx, y + dy, z + dz)) add.push([x + dx, y + dy, z + dz]);
  });
  for (const [x, y, z] of add) m.set(x, y, z, col);
}

// ---------------------------------------------------------------------------
// Faces: separate eye / brow parts + expression alternates
// ---------------------------------------------------------------------------
export type EyeShape = 'round' | 'wide' | 'angry' | 'enraged' | 'hurt' | 'laugh' | 'smug' | 'stunned' | 'defeated' | 'slit' | 'dot';

/**
 * Voxel offsets (dx, dy, flags) of an eye glyph in the face plane, centered at 0.
 * side: +1 = character's left eye (+X), -1 = right eye. Inner side (toward the nose) = -side.
 * w, h: half extents in voxels.
 */
export function eyeGlyph(shape: EyeShape, side: 1 | -1, w: number, h: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const add = (dx: number, dy: number, f: number = VF.EMISSIVE) => out.push([dx, dy, f]);
  const W = Math.max(1, w), H = Math.max(1, h);
  const inEll = (dx: number, dy: number, a: number, b: number) => (dx * dx) / (a * a + 0.01) + (dy * dy) / (b * b + 0.01) <= 1.05;
  const R = (n: number) => Math.round(n);
  for (let dy = -H - 2; dy <= H + 2; dy++)
    for (let dx = -W - 2; dx <= W + 2; dx++) {
      const u = dx * side; // + outer, - inner
      switch (shape) {
        case 'round':
          if (inEll(dx, dy, W, H)) add(dx, dy, dx === 0 && dy === 0 ? VF.GLOW : VF.EMISSIVE);
          break;
        case 'wide':
          if (inEll(dx, dy, W + 0.6, H + 0.8)) add(dx, dy, Math.abs(dx) <= 0 && Math.abs(dy) <= 0 ? VF.GLOW : VF.EMISSIVE);
          break;
        case 'dot':
          if (inEll(dx, dy, Math.max(0.6, W * 0.5), Math.max(0.6, H * 0.5))) add(dx, dy, VF.GLOW);
          break;
        case 'angry':
          if (inEll(dx, dy, W, H) && dy <= H * 0.15 + u * 0.55) add(dx, dy, dx === 0 && dy === 0 ? VF.GLOW : VF.EMISSIVE);
          break;
        case 'enraged':
          if (inEll(dx, dy, W + 0.8, H + 0.6) && dy <= H * 0.35 + u * 0.6) add(dx, dy, VF.GLOW);
          if (dy === R(H + 1.5) && u >= R(W * 0.2) && u <= R(W + 0.8)) add(dx, dy, VF.GLOW); // flare
          if (dy === R(H + 2.5) && u === R(W)) add(dx, dy, VF.GLOW);
          break;
        case 'hurt': {
          // chevron pointing to the inner side: lines from outer corners to inner middle
          const t = (u + W) / (2 * W); // 0 inner .. 1 outer
          if (t < 0 || t > 1) break;
          const yy = t * H;
          if (Math.abs(Math.abs(dy) - yy) < 0.6) add(dx, dy);
          break;
        }
        case 'laugh': {
          // ^ arc
          const yy = R(H * 0.9 * (1 - (dx * dx) / ((W + 0.5) * (W + 0.5))) - H * 0.4);
          if (Math.abs(dx) <= W && (dy === yy || dy === yy - 1)) add(dx, dy);
          break;
        }
        case 'smug':
          if (inEll(dx, dy, W, H) && dy <= 0 && dy >= -H) add(dx, dy, dy === 0 ? VF.GLOW : VF.EMISSIVE);
          break;
        case 'stunned': {
          const d = Math.sqrt((dx * dx) / (W * W + 0.01) + (dy * dy) / (H * H + 0.01));
          if ((d > 0.6 && d <= 1.08 && !(dx > 0 && dy > 0 && dx === 1)) || (dx === 0 && dy === 0)) add(dx, dy);
          break;
        }
        case 'defeated':
          if (Math.abs(dx) <= W && Math.abs(dy) <= H && (Math.abs(dx * H - dy * W) < Math.max(W, H) * 0.7 || Math.abs(dx * H + dy * W) < Math.max(W, H) * 0.7)) add(dx, dy, VF.SOLID);
          break;
        case 'slit':
          if (inEll(dx, dy, W, H)) add(dx, dy, Math.abs(dx) === 0 ? VF.GLOW : VF.EMISSIVE);
          break;
      }
    }
  return out;
}

/** Build an eye VoxelModel at rig-space meter center c (eye part pivot = c). */
export function eyeModel(vs: number, c: M3, shape: EyeShape, side: 1 | -1, w: number, h: number, col: number, o: { pupil?: number; depth?: number; dim?: number; glint?: boolean } = {}): VoxelModel {
  const m = new VoxelModel('eye');
  const cx = Math.floor(c[0] / vs), cy = Math.floor(c[1] / vs), cz = Math.floor(c[2] / vs);
  const depth = o.depth ?? 1;
  const g = eyeGlyph(shape, side, w, h);
  for (const [dx, dy, f] of g) {
    for (let d = 0; d < depth; d++) {
      const colr = shape === 'defeated' ? mulRGB(col, 0.35) : f === VF.GLOW ? mix(col, 0xffffff, 0.35) : col;
      m.set(cx + dx, cy + dy, cz - d, mulRGB(colr, o.dim ?? 1), f);
    }
  }
  if (o.pupil !== undefined && shape !== 'defeated' && shape !== 'hurt' && shape !== 'laugh' && shape !== 'stunned') {
    m.set(cx, cy, cz + 1, o.pupil, VF.SOLID);
    if (shape === 'slit') for (let dy = -h; dy <= h; dy++) m.set(cx, cy + dy, cz + 1, o.pupil, VF.SOLID);
  }
  if (o.glint !== false && (shape === 'round' || shape === 'wide' || shape === 'angry' || shape === 'smug' || shape === 'dot' || shape === 'slit' || shape === 'enraged')) {
    // specular glint: one bright voxel at the upper-outer edge, nudged forward
    const gx = cx + (w >= 2 ? side : 0), gy = cy + (h >= 1 && shape !== 'smug' ? 1 : 0);
    m.set(gx, gy, cz + 1, 0xfffcf0, VF.EMISSIVE);
  }
  if (m.count === 0) m.set(cx, cy, cz, col, VF.EMISSIVE);
  return m;
}

/** Brow bar model (rotate via expression brow angles around Z at its pivot = c). */
export function browModel(vs: number, c: M3, halfLen: number, thick: number, col: CSpec, shape: 'flat' | 'arched' | 'bushy' = 'flat'): VoxelModel {
  const m = new VoxelModel('brow');
  const cx = Math.floor(c[0] / vs), cy = Math.floor(c[1] / vs), cz = Math.floor(c[2] / vs);
  for (let dx = -halfLen; dx <= halfLen; dx++) {
    const arch = shape === 'arched' ? Math.round((1 - (dx * dx) / (halfLen * halfLen + 0.01)) * 1.2) : 0;
    for (let t = 0; t < thick; t++) {
      m.set(cx + dx, cy + arch + t, cz, col);
      m.set(cx + dx, cy + arch + t, cz - 1, col);
      if (shape === 'bushy' && (dx + t) % 2 === 0) m.set(cx + dx, cy + arch + t + 1, cz, col);
    }
  }
  return m;
}

/** Add an eye part (and nothing else) to a rig: name eye_l/eye_r, parent head */
export function addEyePart(rb: RBm, name: string, parent: string, c: M3, shape: EyeShape, side: 1 | -1, w: number, h: number, col: number, o: { pupil?: number; depth?: number } = {}) {
  const f = 1 / rb.voxelSize;
  const model = eyeModel(rb.voxelSize, c, shape, side, w, h, col, o);
  rb.parts.push({ name, parent, pivot: [c[0] * f, c[1] * f, c[2] * f], model } as any);
  return model;
}

/** Standard boss expression set built from eye glyphs (+ optional brows). */
export function bossExpressions(vs: number, eyes: { l: M3; r: M3; w: number; h: number; col: number; pupil?: number; depth?: number }, jawOpen: number, hasBrows: boolean) {
  const E = (shape: EyeShape, col = eyes.col) => ({
    eye_l: eyeModel(vs, eyes.l, shape, 1, eyes.w, eyes.h, col, { pupil: eyes.pupil, depth: eyes.depth }),
    eye_r: eyeModel(vs, eyes.r, shape, -1, eyes.w, eyes.h, col, { pupil: eyes.pupil, depth: eyes.depth }),
  });
  const hot = mix(eyes.col, 0xffffff, 0.15);
  const b = (l: number, r: number) => (hasBrows ? ([l, r] as [number, number]) : undefined);
  return {
    neutral: { parts: E('round'), jaw: 0, brow: b(0, 0) },
    angry: { parts: E('angry'), jaw: jawOpen * 0.25, brow: b(0.35, -0.35) },
    enraged: { parts: E('enraged', hot), jaw: jawOpen, brow: b(0.55, -0.55) },
    hurt: { parts: E('hurt'), jaw: jawOpen * 0.55, brow: b(-0.3, 0.3) },
    laugh: { parts: E('laugh'), jaw: jawOpen * 0.8, brow: b(-0.2, 0.2) },
    smug: { parts: E('smug'), jaw: jawOpen * 0.08, brow: b(-0.15, 0.3) },
    stunned: { parts: E('stunned'), jaw: jawOpen * 0.45, brow: b(-0.4, 0.4) },
    defeated: { parts: E('defeated'), jaw: jawOpen * 0.6, brow: b(-0.25, 0.25) },
  };
}
/** snap a meter point to a voxel center (keeps mirrored eye parts voxel-exact) */
export function snapM(vs: number, p: M3): M3 {
  return [(Math.floor(p[0] / vs) + 0.5) * vs, (Math.floor(p[1] / vs) + 0.5) * vs, (Math.floor(p[2] / vs) + 0.5) * vs];
}

/**
 * Boss face: creates eye_l/eye_r (+ optional brow_l/brow_r) parts parented to `parent`
 * and returns the full expression table for meta.expressions.
 * eyeL: left eye center (meters, snapped internally); brows: left brow center.
 */
export function bossFace(rb: RBm, parent: string, eyeL: M3, w: number, h: number, col: number, jawOpen: number, brows?: { l: M3; half: number; thick: number; col: CSpec; shape?: 'flat' | 'arched' | 'bushy' }, pupil?: number) {
  const vs = rb.voxelSize, f = 1 / vs;
  const el = snapM(vs, eyeL);
  const er: M3 = [-el[0], el[1], el[2]];
  rb.parts.push({ name: 'eye_l', parent, pivot: [el[0] * f, el[1] * f, el[2] * f], model: eyeModel(vs, el, 'round', 1, w, h, col, { pupil }) } as any);
  rb.parts.push({ name: 'eye_r', parent, pivot: [er[0] * f, er[1] * f, er[2] * f], model: eyeModel(vs, er, 'round', -1, w, h, col, { pupil }) } as any);
  if (brows) {
    const bl = snapM(vs, brows.l);
    const br: M3 = [-bl[0], bl[1], bl[2]];
    rb.parts.push({ name: 'brow_l', parent, pivot: [bl[0] * f, bl[1] * f, bl[2] * f], model: browModel(vs, bl, brows.half, brows.thick, brows.col, brows.shape ?? 'flat') } as any);
    rb.parts.push({ name: 'brow_r', parent, pivot: [br[0] * f, br[1] * f, br[2] * f], model: browModel(vs, br, brows.half, brows.thick, brows.col, brows.shape ?? 'flat') } as any);
  }
  return bossExpressions(vs, { l: el, r: er, w, h, col, pupil }, jawOpen, !!brows);
}

// ---------------------------------------------------------------------------
// Readable material textures (patterns, not speckle)
// ---------------------------------------------------------------------------
/** leather: worn lighter patches + rows of short crease dashes */
export function leatherTex(base: number, seed = 0): ColorFn {
  return (x, y, z) => {
    const n = noise.n3(x * 0.12 + seed, y * 0.12, z * 0.12);
    let c = n > 0.4 ? mix(base, 0xfff0d8, 0.12) : n < -0.45 ? mix(base, 0x1a0c06, 0.12) : base;
    if ((((y + seed) % 4) + 4) % 4 === 0 && hash3(Math.floor((x + z) / 3), y, seed) > 0.45) c = mix(c, 0x1a0a04, 0.28);
    return mulRGB(c, 0.995 + hash3(x, y, z) * 0.01);
  };
}
/** wood grain running along `axis` with growth rings and the odd knot */
export function woodTex(base: number, axis: 'x' | 'y' | 'z', seed = 0): ColorFn {
  return (x, y, z) => {
    const along = axis === 'x' ? x : axis === 'y' ? y : z;
    const a0 = axis === 'x' ? y : x, a1 = axis === 'z' ? y : z;
    const ring = a0 * 0.85 + a1 * 0.35 + noise.n2(along * 0.06 + seed, a0 * 0.2) * 2.4;
    const band = ((Math.floor(ring) % 3) + 3) % 3;
    let c = band === 0 ? mix(base, 0x1a0a04, 0.2) : band === 1 ? base : mix(base, 0xfff0d0, 0.07);
    if (noise.n3(x * 0.16 + seed, y * 0.16, z * 0.16) > 0.64) c = mix(base, 0x2a1408, 0.5); // knot
    return c;
  };
}
/** bone: sun-bleached highs, yellowed lows, hairline cracks */
export function boneTex(base: number, seed = 0): ColorFn {
  return (x, y, z) => {
    let c = base;
    const t = noise.n3(x * 0.07, y * 0.07 + seed, z * 0.07);
    if (t > 0.35) c = mix(c, 0xfffaee, 0.3);
    else if (t < -0.38) c = mix(c, 0xb8945e, 0.3);
    if (Math.abs(noise.n3(x * 0.2 + seed, y * 0.2, z * 0.2)) < 0.03) c = mix(c, 0x4a3420, 0.55);
    return c;
  };
}
/** iron with orange-brown rust blooms and pitting */
export function rustTex(base: number, seed = 0): ColorFn {
  return (x, y, z) => {
    const n = noise.n3(x * 0.14 + seed, y * 0.14, z * 0.14);
    if (n > 0.32) return mix(0x8a3a14, 0xb8622a, Math.min(1, (n - 0.32) * 2));
    if (n > 0.22) return mix(base, 0x6a2a10, 0.5);
    return base;
  };
}

// ---------------------------------------------------------------------------
// Accessories (storytelling bits): pouches, charms, poster scraps, rope, trophies
// ---------------------------------------------------------------------------
/** leather pouch facing +Z (front), with a flap, stitching and a brass buckle */
export function pouchM(s: Sc, c: M3, w: number, h: number, d: number, leather: CSpec, face: 1 | -1 = 1) {
  const vs = s.vs;
  s.rbox([c[0] - w / 2, c[1] - h / 2, c[2] - d / 2], [c[0] + w / 2, c[1] + h / 2, c[2] + d / 2], vs, leather);
  const fz = c[2] + face * (d / 2 + vs * 0.5);
  s.box([c[0] - w / 2, c[1] + h * 0.1, fz - vs * 0.5], [c[0] + w / 2, c[1] + h / 2, fz + vs * 0.5], mulCol(leather, 0.82)); // flap
  s.dot([c[0], c[1] + h * 0.1, fz + face * vs * 0.5], P.brass, VF.METAL); // buckle
  for (let x = c[0] - w / 2 + vs; x < c[0] + w / 2; x += vs * 2) s.dot([x, c[1] - h / 2 + vs, fz], 0xe0c890); // stitches
}
/** tiny skull charm (bone, two eye holes, teeth) facing +Z */
export function skullCharmM(s: Sc, c: M3, size: number) {
  const vs = s.vs;
  const bone = (x: number, y: number, z: number) => mulRGB(((x + y) & 1) ? 0xf0e4c8 : 0xe2d2b0, 1);
  s.box([c[0] - size, c[1] - size * 0.6, c[2] - size * 0.8], [c[0] + size, c[1] + size, c[2] + size * 0.8], bone);
  const fz = c[2] + size * 0.8;
  s.dot([c[0] - size * 0.5, c[1] + size * 0.2, fz], 0x1a120c).dot([c[0] + size * 0.5, c[1] + size * 0.2, fz], 0x1a120c);
  s.box([c[0] - size * 0.6, c[1] - size * 0.6 - vs, c[2]], [c[0] + size * 0.6, c[1] - size * 0.6, fz], bone); // jaw
  s.dot([c[0], c[1] - size * 0.6, fz + vs * 0.2], 0x1a120c);
}
/** torn wanted-poster scrap facing +Z: parchment, red WANTED band, portrait block, reward dots */
export function posterScrapM(s: Sc, c: M3, w: number, h: number) {
  const vs = s.vs;
  const paper = (x: number, y: number, z: number) => mulRGB(((x * 7 + y * 3) % 11 === 0) ? 0xc8b48a : 0xe6d6b0, 0.98 + hash3(x, y, z) * 0.04);
  s.box([c[0] - w / 2, c[1] - h / 2, c[2]], [c[0] + w / 2, c[1] + h / 2, c[2] + vs * 0.99], paper);
  s.box([c[0] - w / 2 + vs, c[1] + h / 2 - vs * 2, c[2] + vs * 0.5], [c[0] + w / 2 - vs, c[1] + h / 2 - vs, c[2] + vs * 0.99], P.setRed1); // WANTED
  s.box([c[0] - w / 4, c[1] - h / 6, c[2] + vs * 0.5], [c[0] + w / 4, c[1] + h / 4, c[2] + vs * 0.99], 0x3a2a1c); // portrait
  for (let x = c[0] - w / 2 + vs; x < c[0] + w / 2 - vs; x += vs * 2) s.dot([x, c[1] - h / 2 + vs * 1.5, c[2] + vs], 0x2a2018); // reward text
  s.del([c[0] + w / 2 - vs * 0.5, c[1] - h / 2 + vs * 0.5, c[2] + vs * 0.5]); // torn corner
  s.dot([c[0], c[1] + h / 2 - vs * 0.5, c[2] + vs * 1.2], 0x8a8a8a, VF.METAL); // nail
}
/** necklace of teeth/claws around a neck: ring at height y with center c and radii */
export function toothNecklaceM(s: Sc, c: M3, rx: number, rz: number, n: number) {
  const vs = s.vs;
  for (let a = -Math.PI * 0.85; a <= Math.PI * 0.85; a += 0.06) s.dot([c[0] + Math.sin(a) * rx, c[1], c[2] + Math.cos(a) * rz], 0x4a3420);
  for (let k = 0; k < n; k++) {
    const a = -1.0 + (k / Math.max(1, n - 1)) * 2.0;
    const p: M3 = [c[0] + Math.sin(a) * rx, c[1] - vs, c[2] + Math.cos(a) * rz];
    s.box([p[0] - vs * 0.5, p[1] - vs * (k % 2 ? 2 : 3), p[2] - vs * 0.5], [p[0] + vs * 0.5, p[1], p[2] + vs * 0.5], k % 3 === 0 ? 0xf6ecd4 : 0xe8d8b4);
  }
}
/** coil of rope (blocky rings) around axis */
export function ropeCoilM(s: Sc, c: M3, r: number, turns: number, axis: 'x' | 'y' | 'z') {
  const rope = (x: number, y: number, z: number) => mulRGB(((x + y + z) & 1) === 0 ? 0xc8a868 : 0xa88a50, 1);
  for (let k = 0; k < turns; k++) {
    const o = (k - (turns - 1) / 2) * s.vs * 1.2;
    const cc: M3 = axis === 'x' ? [c[0] + o, c[1], c[2]] : axis === 'y' ? [c[0], c[1] + o, c[2]] : [c[0], c[1], c[2] + o];
    s.disc(cc, r - k * s.vs * 0.2, s.vs, axis, rope, undefined, r - k * s.vs * 0.2 - s.vs * 1.6);
  }
}
