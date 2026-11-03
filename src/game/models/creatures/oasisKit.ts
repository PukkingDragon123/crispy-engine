// Sculpting kit for the Heart of the Oasis creatures (the Oasis King, its
// crocodiles, land catfish and walking carnivorous plants). Builds on ckit's
// rig builder, glossy modelled eyes and finishing passes, and adds:
//  - a FAST smooth-union sculptor (per-primitive bounding boxes, precomputed
//    rotations, sqrt instead of hypot) so a 16 m boss voxelises in a blink;
//  - wet, slimy, mottled hides with glints, lateral lines and scars;
//  - fin membranes spanned between bony rays, serrated spines, teeth rows,
//    tapering barbels and leaf blades.
// Everything is authored in METRES and converted with the builder's voxel
// size (`K.v(...)`), in ckit's shared rig space (origin on the ground, +Z
// forward, left = +X, a part's attach point = its pivot).
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { V3 } from '../../../engine/voxel/Rig';
import { hash3, noise } from '../../../engine/math/rand';
import { CRig, wetEye, mixc, mulc, n01, h01, sstep, clamp01, finish, smoothVox, hollow, exposed, splitInto, cap, ell, line, norm3, sub3, add3, scl3, cross3, lerp3, type Col } from './ckit';

export { CRig, wetEye, mixc, mulc, n01, h01, sstep, clamp01, finish, smoothVox, hollow, exposed, splitInto, cap, ell, line, norm3, sub3, add3, scl3, cross3, lerp3, VF, VoxelModel, hash3, noise };
export type { V3, Col };

// ================================================================ metre space
/** a builder's unit helpers: metres <-> voxel coordinates for one voxel size */
export function units(vs: number) {
  return {
    vs,
    /** metres -> geometric voxel coordinates */
    v: (x: number, y: number, z: number): V3 => [x / vs, y / vs, z / vs],
    /** metres -> voxel count (radii, thicknesses) */
    n: (m: number) => m / vs,
    /** voxel index -> metres (voxel centre) */
    m: (i: number) => (i + 0.5) * vs,
  };
}

// ================================================================ fast sculptor
/** ellipsoid (c, r, rot) or tapered capsule (a, b, r0, r1); `sub` carves smoothly */
export interface SPrim {
  c?: V3;
  r?: V3;
  rot?: V3;
  a?: V3;
  b?: V3;
  r0?: number;
  r1?: number;
  sub?: boolean;
  /** per-prim blend radius */
  k?: number;
}
interface Prep {
  sub: boolean;
  k: number;
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
  ell: boolean;
  cx: number; cy: number; cz: number;
  irx: number; iry: number; irz: number;
  /** inverse rotation rows (or null) */
  m: number[] | null;
  ax: number; ay: number; az: number; dx: number; dy: number; dz: number; l2: number; r0: number; r1: number;
}
function invRot(e: V3): number[] {
  // inverse of THREE 'XYZ' (R = Rx * Ry * Rz) = Rz^T * Ry^T * Rx^T, as a row-major 3x3
  const [a, b, c] = e;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  // R = Rx Ry Rz
  const R = [
    cb * cc, -cb * sc, sb,
    sa * sb * cc + ca * sc, -sa * sb * sc + ca * cc, -sa * cb,
    -ca * sb * cc + sa * sc, ca * sb * sc + sa * cc, ca * cb,
  ];
  // transpose
  return [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
}
function prep(q: SPrim, k: number, pad: number): Prep {
  const kk = q.k ?? k;
  const P: Prep = { sub: !!q.sub, k: kk, x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0, ell: !q.a, cx: 0, cy: 0, cz: 0, irx: 0, iry: 0, irz: 0, m: null, ax: 0, ay: 0, az: 0, dx: 0, dy: 0, dz: 0, l2: 1, r0: 0, r1: 0 };
  const g = kk + pad;
  if (q.a && q.b) {
    const a = q.a, b = q.b;
    P.ax = a[0]; P.ay = a[1]; P.az = a[2];
    P.dx = b[0] - a[0]; P.dy = b[1] - a[1]; P.dz = b[2] - a[2];
    P.l2 = P.dx * P.dx + P.dy * P.dy + P.dz * P.dz || 1e-6;
    P.r0 = q.r0 ?? 1;
    P.r1 = q.r1 ?? P.r0;
    const R = Math.max(P.r0, P.r1) + g;
    P.x0 = Math.min(a[0], b[0]) - R; P.x1 = Math.max(a[0], b[0]) + R;
    P.y0 = Math.min(a[1], b[1]) - R; P.y1 = Math.max(a[1], b[1]) + R;
    P.z0 = Math.min(a[2], b[2]) - R; P.z1 = Math.max(a[2], b[2]) + R;
  } else {
    const c = q.c!, r = q.r!;
    P.cx = c[0]; P.cy = c[1]; P.cz = c[2];
    P.irx = 1 / r[0]; P.iry = 1 / r[1]; P.irz = 1 / r[2];
    if (q.rot && (q.rot[0] || q.rot[1] || q.rot[2])) P.m = invRot(q.rot);
    const R = Math.max(r[0], r[1], r[2]) + g;
    P.x0 = c[0] - R; P.x1 = c[0] + R; P.y0 = c[1] - R; P.y1 = c[1] + R; P.z0 = c[2] - R; P.z1 = c[2] + R;
  }
  return P;
}
function sdf(P: Prep, px: number, py: number, pz: number) {
  if (!P.ell) {
    const ax = px - P.ax, ay = py - P.ay, az = pz - P.az;
    let t = (ax * P.dx + ay * P.dy + az * P.dz) / P.l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax - P.dx * t, qy = ay - P.dy * t, qz = az - P.dz * t;
    return Math.sqrt(qx * qx + qy * qy + qz * qz) - (P.r0 + (P.r1 - P.r0) * t);
  }
  let x = px - P.cx, y = py - P.cy, z = pz - P.cz;
  const m = P.m;
  if (m) {
    const X = m[0] * x + m[1] * y + m[2] * z, Y = m[3] * x + m[4] * y + m[5] * z, Z = m[6] * x + m[7] * y + m[8] * z;
    x = X; y = Y; z = Z;
  }
  const ux = x * P.irx, uy = y * P.iry, uz = z * P.irz;
  const k0 = Math.sqrt(ux * ux + uy * uy + uz * uz);
  const vx = ux * P.irx, vy = uy * P.iry, vz = uz * P.irz;
  const k1 = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1e-6;
  return (k0 * (k0 - 1)) / k1;
}
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

export interface SculptOpts {
  /** smooth-union blend radius (voxels) */
  k: number;
  /** displacement (voxels, positive pushes inward) */
  disp?: (x: number, y: number, z: number) => number;
  /** max |disp| (voxels) so the bounds stay exact */
  dispMax?: number;
  keep?: (x: number, y: number, z: number) => boolean;
  fl?: number;
  under?: boolean;
  carve?: boolean;
  /** keep only a skin this many voxels thick (big bodies stay light) ... */
  shell?: number;
  /** ... except where this says solid (joint cuts, cavity walls) */
  solid?: (x: number, y: number, z: number) => boolean;
  /** colour for buried voxels (never seen): skips the colour function deep inside big bodies */
  interior?: number;
}
/** organic smooth union of ellipsoids / capsules (+ smooth subtractions): flesh, never a bare primitive */
export function sculpt(m: VoxelModel, prims: SPrim[], col: Col, o: SculptOpts) {
  const pad = 3 + (o.dispMax ?? 0);
  const P = prims.map((q) => prep(q, o.k, pad));
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (const q of P) {
    if (q.sub) continue;
    x0 = Math.min(x0, q.x0); y0 = Math.min(y0, q.y0); z0 = Math.min(z0, q.z0);
    x1 = Math.max(x1, q.x1); y1 = Math.max(y1, q.y1); z1 = Math.max(z1, q.z1);
  }
  const res = (c: Col, x: number, y: number, z: number) => (typeof c === 'number' ? c : c(x, y, z));
  const dm = 2.5 + (o.dispMax ?? 0);
  // slab -> row -> cell: only the primitives whose padded boxes cover the slab / row are tested
  for (let kk = Math.floor(z0); kk <= Math.ceil(z1); kk++) {
    const pz = kk + 0.5;
    const PZ = P.filter((q) => pz >= q.z0 && pz <= q.z1);
    if (!PZ.some((q) => !q.sub)) continue;
    for (let j = Math.floor(y0); j <= Math.ceil(y1); j++) {
      const py = j + 0.5;
      const PY = PZ.filter((q) => py >= q.y0 && py <= q.y1);
      if (!PY.length) continue;
      for (let i = Math.floor(x0); i <= Math.ceil(x1); i++) {
        const px = i + 0.5;
        let d = 1e9;
        let any = false;
        for (let n = 0; n < PY.length; n++) {
          const q = PY[n];
          if (px < q.x0 || px > q.x1) continue;
          const di = sdf(q, px, py, pz);
          if (q.sub) {
            if (any) d = smax(d, -di, q.k);
          } else if (!any) {
            d = di;
            any = true;
          } else d = smin(d, di, q.k);
        }
        if (!any || d > dm) continue;
        if (o.disp && d > -(o.dispMax ?? 0) - 1) d += o.disp(px, py, pz);
        if (d > 0) continue;
        if (o.shell !== undefined && d < -o.shell && !(o.solid && o.solid(i, j, kk))) continue;
        if (o.keep && !o.keep(i, j, kk)) continue;
        if (o.carve) {
          m.del(i, j, kk);
          continue;
        }
        if (o.under && m.has(i, j, kk)) continue;
        const cc = o.interior !== undefined && d < -3 ? o.interior : res(col, i, j, kk);
        if (cc !== null) m.set(i, j, kk, cc, o.fl);
      }
    }
  }
  return m;
}

// ================================================================ hides
export interface HideOpts {
  back: number;
  side: number;
  belly: number;
  /** blotch colour (mottling) */
  blotch: number;
  /** pale speckle */
  fleck: number;
  /** y (metres) where the pale belly ends / the dark back begins */
  bellyTop: number;
  backLow: number;
  /** mottling cell size (metres) */
  cell: number;
  seed: number;
  vs: number;
}
/**
 * Slimy, mottled fish/reptile hide: pale belly -> olive flanks -> dark back,
 * irregular dark blotches across back and flanks, pale freckles, a soft
 * contrast that keeps the cel ramp clean.
 */
export function mottledHide(o: HideOpts) {
  const { vs, seed } = o;
  return (x: number, y: number, z: number) => {
    const Y = (y + 0.5) * vs;
    const n = noise.n3((x * vs) / o.cell + seed * 3.1, (y * vs) / o.cell - seed, (z * vs) / (o.cell * 1.4) + seed * 1.7);
    const wob = n * 0.12;
    const q = (t: number, k = 5) => Math.round(t * k) / k;
    let c = mixc(o.belly, o.side, q(sstep(o.bellyTop - 0.12, o.bellyTop + 0.18, Y + wob)));
    c = mixc(c, o.back, q(sstep(o.backLow - 0.25, o.backLow + 0.35, Y + wob * 1.6)));
    const onBelly = Y < o.bellyTop - 0.05;
    // dark blotches (fused patches) on back + flanks
    if (!onBelly) {
      const b = noise.n3((x * vs) / (o.cell * 0.55) - seed * 2.3, (y * vs) / (o.cell * 0.55) + seed, (z * vs) / (o.cell * 0.75) - seed * 0.7);
      if (b > 0.32) c = mixc(c, o.blotch, q(Math.min(0.85, (b - 0.32) * 3.2), 3));
    } else if (hash3(x + seed * 11, y, z - seed) > 0.985) c = mixc(c, o.blotch, 0.3);
    const h = hash3(x * 1.7 + seed * 5, y * 1.3, z * 0.9 - seed * 3);
    if (h > 0.988) c = mixc(c, o.fleck, 0.6);
    return c;
  };
}

/** sparse wet glints on sky-facing surfaces (+METAL sheen): slime catching the sun */
export function wetGlints(m: VoxelModel, density: number, seed = 0, pred?: (x: number, y: number, z: number, c: number) => boolean, tint = 0xf4f8e8) {
  const out: [number, number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    if (m.has(x, y + 1, z)) return;
    if (pred && !pred(x, y, z, c)) return;
    if (hash3(x * 3.1 + seed, y * 1.7 - seed * 2, z * 2.3) > density) return;
    out.push([x, y, z, mixc(c, tint, 0.42)]);
  });
  for (const [x, y, z, c] of out) m.set(x, y, z, c, VF.METAL | VF.SOFTAO);
  return m;
}

/** paint exposed voxels whose metre position satisfies pred (scars, lateral lines, lips) */
export function paintM(m: VoxelModel, vs: number, pred: (X: number, Y: number, Z: number, x: number, y: number, z: number) => boolean, col: (c: number, x: number, y: number, z: number) => number, onlyExposed = true, fl?: number) {
  const out: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (!pred((x + 0.5) * vs, (y + 0.5) * vs, (z + 0.5) * vs, x, y, z)) return;
    if (onlyExposed && !exposed(m, x, y, z)) return;
    out.push([x, y, z, col(c, x, y, z), fl ?? f]);
  });
  for (const [x, y, z, c, f] of out) m.set(x, y, z, c, f || VF.SOLID);
  return m;
}

// ================================================================ fins, spines, teeth, whiskers
/**
 * A fin membrane spanned between bony rays: rays[i] = [root, tip] (voxel coords).
 * Filled as a thin double-curved sheet (`th` voxels thick, thicker at the root),
 * rays a touch darker and raised, the free edge paler and ragged.
 */
export function fin(m: VoxelModel, rays: [V3, V3][], o: { membrane: number; ray: number; edge: number; th?: number; ragged?: number; seed?: number; bulge?: V3; fl?: number }) {
  const th = o.th ?? 1;
  const seed = o.seed ?? 3;
  for (let i = 0; i < rays.length - 1; i++) {
    const [a0, a1] = rays[i];
    const [b0, b1] = rays[i + 1];
    const la = Math.hypot(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]);
    const lb = Math.hypot(b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]);
    const w = Math.max(Math.hypot(b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]), Math.hypot(b1[0] - a1[0], b1[1] - a1[1], b1[2] - a1[2]));
    const ns = Math.ceil(Math.max(la, lb) * 2.4) + 1, nu = Math.ceil(w * 2.4) + 1;
    // sheet normal (for thickness)
    const nrm = norm3(cross3(sub3(a1, a0), sub3(b0, a0)));
    for (let s = 0; s <= ns; s++) {
      const t = s / ns;
      // ragged free edge: rays reach further than the membrane between them
      for (let u = 0; u <= nu; u++) {
        const k = u / nu;
        const mid = Math.sin(k * Math.PI);
        const reach = 1 - mid * (o.ragged ?? 0.12) * (0.6 + 0.4 * hash3(i * 7 + seed, u, s));
        if (t > reach) continue;
        const pa = lerp3(a0, a1, t), pb = lerp3(b0, b1, t);
        let p = lerp3(pa, pb, k);
        if (o.bulge) p = add3(p, scl3(o.bulge, mid * Math.sin(t * Math.PI) * 0.5));
        const onRay = k < 0.12 || k > 0.88;
        const thick = th + (t < 0.25 ? 1 : 0) + (onRay && t < 0.85 ? 0.6 : 0);
        const edge = t > reach - 0.12;
        const c = edge ? o.edge : onRay ? o.ray : mixc(o.membrane, o.ray, 0.15 * Math.sin(k * Math.PI * 4 + seed));
        for (let d = -thick / 2; d <= thick / 2 + 1e-6; d += 0.7) {
          const q = add3(p, scl3(nrm, d));
          m.set(Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2]), c, o.fl);
        }
      }
    }
  }
  return m;
}

/** a bony fin spine: tapering tube, serrated along one side (`saw` = direction of the teeth) */
export function spine(m: VoxelModel, a: V3, b: V3, r0: number, col: number, saw?: V3, sawCol?: number) {
  cap(m, a, b, r0, Math.max(0.5, r0 * 0.25), col);
  if (saw) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.floor(L / 2.2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const p = lerp3(a, b, t);
      const r = r0 + (r0 * 0.25 - r0) * t;
      const q = add3(p, scl3(norm3(saw), r + 0.6));
      const tip = add3(q, add3(scl3(norm3(saw), 1.1), scl3(norm3(sub3(a, b)), 0.8)));
      cap(m, q, tip, 0.6, 0.3, sawCol ?? col);
    }
  }
  return m;
}

/** conical tooth from base to tip (curved slightly by `hook`) */
export function tooth(m: VoxelModel, base: V3, tip: V3, r: number, col: number, hook?: V3) {
  if (hook) {
    const mid = add3(lerp3(base, tip, 0.55), hook);
    cap(m, base, mid, r, r * 0.65, col);
    cap(m, mid, tip, r * 0.65, 0.35, col);
  } else cap(m, base, tip, r, 0.35, col);
  return m;
}

/** tapering whisker / barbel / root through points (radius r0 -> r1), colour by param t */
export function barbel(m: VoxelModel, pts: V3[], r0: number, r1: number, col: (t: number, x: number, y: number, z: number) => number, fl?: number) {
  let L = 0;
  const seg: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    seg.push(L);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const t0 = seg[i] / L, t1 = seg[i + 1] / L;
    const ra = r0 + (r1 - r0) * t0, rb = r0 + (r1 - r0) * t1;
    cap(m, pts[i], pts[i + 1], ra, rb, (x, y, z) => {
      // param along this capsule (approx) for colour
      const a = pts[i], b = pts[i + 1];
      const d = sub3(b, a);
      const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
      const u = clamp01(((x + 0.5 - a[0]) * d[0] + (y + 0.5 - a[1]) * d[1] + (z + 0.5 - a[2]) * d[2]) / l2);
      return col(t0 + (t1 - t0) * u, x, y, z);
    }, { fl });
  }
  return m;
}

/** smooth curve through control points (Catmull-Rom), n samples */
export function curve(ctrl: V3[], n: number): V3[] {
  const out: V3[] = [];
  const P = (i: number) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  for (let s = 0; s <= n; s++) {
    const f = (s / n) * (ctrl.length - 1);
    const i = Math.min(ctrl.length - 2, Math.floor(f));
    const t = f - i;
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c = (k: number) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t);
    out.push([c(0), c(1), c(2)]);
  }
  return out;
}

/**
 * A leaf blade along a midrib curve: width profile w(t) (voxels), slight cup
 * (`cup` voxels of rise at the margins along `up`), serrated margin, midrib
 * and side veins painted.
 */
export function leaf(m: VoxelModel, rib: V3[], w: (t: number) => number, up: V3, o: { blade: number; vein: number; margin: number; cup?: number; serr?: number; th?: number; seed?: number }) {
  const n = rib.length - 1;
  const seed = o.seed ?? 1;
  for (let i = 0; i < n; i++) {
    const a = rib[i], b = rib[i + 1];
    const dir = norm3(sub3(b, a));
    const side = norm3(cross3(dir, up));
    const nrm = norm3(cross3(side, dir));
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ns = Math.max(1, Math.ceil(L * 2.2));
    for (let s = 0; s < ns; s++) {
      const t = (i + s / ns) / n;
      const c = lerp3(a, b, s / ns);
      let W = w(t);
      if (o.serr) W *= 1 - o.serr * Math.max(0, Math.sin(t * 60 + seed));
      const nw = Math.ceil(W * 2.2);
      for (let u = -nw; u <= nw; u++) {
        const k = u / Math.max(1, nw);
        const off = k * W;
        const lift = (o.cup ?? 0) * k * k;
        const p = add3(add3(c, scl3(side, off)), scl3(nrm, lift));
        const edge = Math.abs(k) > 0.86;
        const vein = Math.abs(k) < 0.08 || Math.abs(Math.sin((t * 9 - Math.abs(k) * 1.6) * Math.PI)) < 0.12;
        const col = edge ? o.margin : vein ? o.vein : o.blade;
        for (let d = 0; d < (o.th ?? 1); d++) {
          const q = add3(p, scl3(nrm, -d * 0.8));
          m.set(Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2]), col);
        }
      }
    }
  }
  return m;
}

/** a thick ring band (jewellery) around an axis: torus of small spheres */
export function band(m: VoxelModel, c: V3, axis: V3, R: number, r: number, col: Col, fl = VF.METAL) {
  const a = norm3(axis);
  const ref: V3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm3(cross3(a, ref)), v = norm3(cross3(a, u));
  const n = Math.max(10, Math.ceil(R * 7));
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const p = add3(c, add3(scl3(u, Math.cos(t) * R), scl3(v, Math.sin(t) * R)));
    ell(m, p, [r, r, r], col, { fl });
  }
  return m;
}

/** memoise a zero/one-argument builder */
export function memo<R>(fn: (key: string) => R) {
  const cache = new Map<string, R>();
  return (key: string) => {
    let r = cache.get(key);
    if (!r) {
      r = fn(key);
      cache.set(key, r);
    }
    return r;
  };
}

void smoothVox;
void finish;
void hollow;
void splitInto;
void line;
void wetEye;
void CRig;
void h01;
void n01;
