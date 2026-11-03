// The walking flytrap (~2.6 m, 1/36 m voxels): a giant carnivorous plant that
// pulls itself along on six gnarled root legs. Built for the horde's 'beetle'
// skeleton (tripod root gait, rearing lunge, snapping side leaves):
//   body (root: woody bulb, leaf rosette, baby traps) → head (stalk + upper
//   lobe of the trap) → jaw (lower lobe, hinged at the trap's midrib);
//   body → mandible_l / mandible_r (two long spiny leaves that clap shut);
//   body → leg_l1..3 / leg_r1..3 (root legs with rootlets and dirt clods).
// The trap: cupped crimson lobes with dark veins and trigger hairs, a glossy
// rim fringed with long interlocking cilia, a green outside flushed red.
// Variants: 0 classic green, 1 bog-wine morph. Alpha ("Pitcher Queen"): bigger,
// thorny, with a ring of acid-filled pitcher cups growing from its bulb.
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { CRig, VoxelModel, VF, units, sculpt, wetGlints, barbel, curve, leaf, tooth, mixc, mulc, ell, cap, hash3, noise, line, norm3, add3, scl3, sub3, type SPrim } from './oasisKit';
import { vessel } from './ckit';

export interface FlytrapOpts {
  alpha?: boolean;
  variant?: number;
}

const VS = 1 / 36;
const U = units(VS);
const v = U.v;
const n = U.n;
const M = (i: number) => (i + 0.5) * VS;
const E = (c: [number, number, number], r: [number, number, number], rot?: V3): SPrim => ({ c: v(...c), r: [n(r[0]), n(r[1]), n(r[2])], rot });

interface Pal { out: number; outD: number; outL: number; flush: number; inn: number; vein: number; rim: number; cil: number; cilB: number; wood: number; woodD: number; root: number; dirt: number }
const PALS: Pal[] = [
  { out: 0x4a7a2a, outD: 0x2c4a16, outL: 0x8ab446, flush: 0xb8442e, inn: 0xc8283a, vein: 0x7a1020, rim: 0xd8483a, cil: 0xd8e08a, cilB: 0xb83030, wood: 0x6a5a32, woodD: 0x4a3c20, root: 0x6a4a2a, dirt: 0x4a3420 },
  { out: 0x4a2a3a, outD: 0x2a1420, outL: 0x7a4a5a, flush: 0xa83038, inn: 0xa01820, vein: 0x4a0810, rim: 0xe0603a, cil: 0xe8c890, cilB: 0x8a1a20, wood: 0x5a4430, woodD: 0x3a2a1c, root: 0x5a3c26, dirt: 0x3e2c1c },
];
const ALPHA: Pal = { out: 0x2e5a1e, outD: 0x1a3410, outL: 0x6a9a3a, flush: 0xc0303a, inn: 0xb01428, vein: 0x5a0818, rim: 0xe8402e, cil: 0xe8e8a0, cilB: 0xa01c20, wood: 0x5a4a2a, woodD: 0x3a2e18, root: 0x5e4226, dirt: 0x40301e };

// the trap's hinge (metres) and its shape
const HY = 2.05, HZ = 0.42, A = 0.62, B = 0.56, CUP = 0.3;

/** rotate p (voxels) about the X axis through the hinge by ang */
function hingeRot(p: V3, ang: number): V3 {
  const hy = n(HY), hz = n(HZ);
  const y = p[1] - hy, z = p[2] - hz;
  const c = Math.cos(ang), s = Math.sin(ang);
  return [p[0], hy + y * c - z * s, hz + y * s + z * c];
}

/** one lobe of the trap: a cupped crimson bowl (side = +1 upper, -1 lower), rotated open by ang */
function lobe(m: VoxelModel, P: Pal, side: 1 | -1, ang: number, seed: number) {
  const zc = HZ + B;
  const step = 0.45;
  const R = n(Math.max(A, B));
  for (let ix = -R; ix <= R; ix += step)
    for (let iz = -R; iz <= R; iz += step) {
      const X = ix * VS, Z = zc + iz * VS;
      const r2 = (X / A) ** 2 + ((Z - zc) / B) ** 2;
      if (r2 > 1) continue;
      const r = Math.sqrt(r2);
      const depth = CUP * (1 - r2) * (0.75 + 0.25 * Math.sin(Math.atan2(Z - zc, X) * 2 + seed) * 0.2);
      const rimK = r > 0.9;
      const ph = Math.atan2(Z - zc, X / A * B);
      for (let t = 0; t < 3; t++) {
        // t = 0 inner face (red), 2 outer face (green)
        const y = HY + side * (depth + t * VS * 0.9);
        let col: number;
        if (rimK) col = t === 0 ? P.rim : mixc(P.flush, P.rim, 0.4);
        else if (t === 0) {
          const vein = Math.abs(Math.sin(ph * 9 + r * 4)) < 0.16 || Math.abs(X) < 0.02;
          col = vein ? P.vein : hash3(ix * 7, iz * 5, seed) > 0.93 ? mixc(P.inn, 0xffffff, 0.25) : P.inn;
        } else {
          const fl = r > 0.62 ? (r - 0.62) / 0.38 : 0;
          col = mixc(hash3(ix * 3, iz * 9, seed) > 0.8 ? P.outD : P.out, P.flush, fl * 0.85);
          if (Math.abs(X) < 0.025) col = P.outL; // midrib
        }
        const p = hingeRot([X / VS, y / VS, Z / VS], ang);
        m.set(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]), col, t === 0 && !rimK ? VF.METAL : VF.SOLID);
      }
    }
  // the cilia: long interlocking teeth fringing the rim (none at the hinge)
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const ph = -Math.PI * 0.08 + (i / N) * Math.PI * 1.16;
    const ca = Math.cos(ph), sa = Math.sin(ph);
    const base: V3 = v(A * ca * 0.98, HY + side * 0.02, zc + B * sa * 0.98);
    const out = norm3([ca / A, 0, sa / B]);
    const len = n(0.2 + 0.06 * Math.sin(i * 1.7 + seed));
    const tip = add3(base, add3(scl3(out, len), [0, -side * len * 0.35, 0]));
    const b2 = hingeRot(base, ang), t2 = hingeRot(tip, ang);
    const mid = scl3(add3(b2, t2), 0.5);
    line(m, [b2, mid], P.cilB);
    line(m, [mid, t2], P.cil);
  }
  // trigger hairs on the inner face
  for (let i = 0; i < 3; i++) {
    const a = seed + i * 2.1;
    const X = Math.cos(a) * 0.22, Z = zc + Math.sin(a) * 0.18;
    const r2 = (X / A) ** 2 + ((Z - zc) / B) ** 2;
    const y = HY + side * CUP * (1 - r2);
    line(m, [hingeRot(v(X, y, Z), ang), hingeRot(v(X, y - side * 0.07, Z + 0.01), ang)], 0x2a0a10);
  }
}

function build(o: FlytrapOpts): RigSpec {
  const alpha = !!o.alpha;
  const P = alpha ? ALPHA : PALS[(o.variant ?? 0) % PALS.length];
  const rig = new CRig(alpha ? 'oasis_flytrap_alpha' : 'oasis_flytrap' + (o.variant ? '_v' + o.variant : ''), VS);
  const seed = alpha ? 31 : 7 + (o.variant ?? 0) * 5;
  // ------------------------------------------------------------------ the bulb (root crown)
  const body = rig.part('body', undefined, v(0, 0.72, 0));
  const bark = (x: number, y: number, z: number) => {
    const Y = M(y);
    const rings = Math.sin(Y * 40 + noise.n2(x * 0.3, z * 0.3) * 3) > 0.55;
    let c = rings ? P.woodD : P.wood;
    if (Y > 0.95) c = mixc(c, P.out, Math.min(1, (Y - 0.95) * 6));
    if (hash3(x, y, z) > 0.94) c = mulc(c, 1.2);
    return c;
  };
  sculpt(body, [
    E([0, 0.72, 0], [0.42, 0.36, 0.4]),
    E([0.2, 0.86, 0.14], [0.2, 0.16, 0.2]),
    E([-0.18, 0.62, -0.16], [0.22, 0.18, 0.2]),
    E([0.1, 0.55, -0.2], [0.2, 0.16, 0.18]),
    E([0, 1.0, 0.0], [0.24, 0.12, 0.24]),
    E([0, 0.45, 0], [0.32, 0.12, 0.3]),
  ], bark, { k: n(0.08), disp: (x, y, z) => noise.n3(x * 0.18, y * 0.18, z * 0.18) * 1.4, dispMax: 1.5, interior: 0x3a2c18 });
  // a rosette of drooping leaves round the crown
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const out: V3 = [Math.sin(a), 0, Math.cos(a)];
    const p0: V3 = v(out[0] * 0.18, 1.02, out[2] * 0.18);
    const rib = curve([p0, add3(p0, v(out[0] * 0.35, 0.18, out[2] * 0.35)), add3(p0, v(out[0] * 0.62, 0.05, out[2] * 0.62)), add3(p0, v(out[0] * 0.78, -0.22, out[2] * 0.78))], 10);
    leaf(body, rib, (t) => n(0.11) * Math.sin(Math.min(1, t * 1.1) * Math.PI) + 0.5, [0, 1, 0], { blade: P.out, vein: P.outD, margin: P.outL, cup: 1.5, serr: 0.25, seed: i + seed, th: 1 });
  }
  // two baby traps on short stalks
  for (const [x, z, h] of [[0.28, -0.12, 1.2], [-0.24, 0.16, 1.12]] as [number, number, number][]) {
    barbel(body, curve([v(x * 0.6, 0.98, z * 0.6), v(x, h - 0.08, z), v(x * 1.15, h, z * 1.1)], 5), n(0.03), n(0.022), () => P.out);
    const c = v(x * 1.15, h + 0.04, z * 1.1);
    ell(body, [c[0], c[1] + 1.5, c[2]], [n(0.09), n(0.035), n(0.08)], (xx, yy, zz) => (yy > c[1] + 1.5 ? P.out : P.inn));
    ell(body, [c[0], c[1] - 1.5, c[2]], [n(0.09), n(0.035), n(0.08)], (xx, yy) => (yy < c[1] - 1.5 ? P.out : P.inn));
  }
  // ------------------------------------------------------------------ the stalk and the trap
  const head = rig.part('head', 'body', v(0, 1.02, 0.0));
  const stalk = curve([v(0, 1.0, 0.0), v(0, 1.45, -0.06), v(0, 1.8, 0.06), v(0, 2.0, 0.26), v(0, 2.05, HZ - 0.02)], 14);
  barbel(head, stalk, n(alpha ? 0.14 : 0.115), n(0.08), (t, x, y, z) => (Math.sin(t * 70) > 0.85 ? P.outD : hash3(x, y, z) > 0.9 ? P.outL : P.out));
  // leafy sheath at the base, a few spines up the stalk
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const rib = curve([v(Math.sin(a) * 0.08, 1.04, Math.cos(a) * 0.08), v(Math.sin(a) * 0.16, 1.28, Math.cos(a) * 0.16), v(Math.sin(a) * 0.2, 1.42, Math.cos(a) * 0.2)], 6);
    leaf(head, rib, (t) => n(0.06) * (1 - t) + 0.5, [0, 0, 1], { blade: P.out, vein: P.outD, margin: P.outL, th: 1 });
  }
  for (let i = 0; i < (alpha ? 10 : 5); i++) {
    const k = 3 + Math.floor((i / (alpha ? 10 : 5)) * 9);
    const p = stalk[k];
    const a = i * 2.4;
    tooth(head, p, add3(p, v(Math.sin(a) * 0.09, 0.04, Math.cos(a) * 0.09)), n(0.014), 0xe0d8a0);
  }
  lobe(head, P, 1, -0.5, seed);
  const jaw = rig.part('jaw', 'head', v(0, HY, HZ), [0.4, 0, 0]);
  lobe(jaw, P, -1, 0, seed + 3);
  // drool: acid strings hanging off the lower lobe
  for (const [x, len] of [[0.25, 0.22], [-0.18, 0.3], [0.05, 0.16]] as [number, number][])
    barbel(jaw, curve([v(x, HY - 0.22, HZ + 0.85), v(x + 0.01, HY - 0.22 - len * 0.6, HZ + 0.87), v(x, HY - 0.22 - len, HZ + 0.86)], 4), n(0.018), n(0.012), (t) => mixc(0xb8e85a, 0x8acc3a, t), VF.METAL);
  // ------------------------------------------------------------------ the snapping side leaves
  for (const s of [1, -1]) {
    const md = rig.part(s > 0 ? 'mandible_l' : 'mandible_r', 'body', v(0.3 * s, 1.0, 0.15));
    const rib = curve([v(0.3 * s, 1.0, 0.15), v(0.62 * s, 1.24, 0.4), v(0.86 * s, 1.52, 0.74), v(0.92 * s, 1.74, 1.02), v(0.84 * s, 1.84, 1.18)], 16);
    leaf(md, rib, (t) => n(0.13) * Math.sin(Math.min(1, t * 1.05 + 0.08) * Math.PI) + 0.6, [0, 1, 0.2], { blade: P.out, vein: P.outD, margin: P.flush, cup: -1.2, serr: 0.35, seed: seed + s, th: 2 });
    // spines along the margins and a hooked thorn at the tip
    for (let i = 3; i < rib.length - 1; i += 2) {
      const d = norm3(sub3(rib[i + 1], rib[i - 1]));
      const side = norm3([d[2] * s, 0, -d[0] * s]);
      tooth(md, add3(rib[i], scl3(side, n(0.1))), add3(rib[i], add3(scl3(side, n(0.18)), [0, n(0.03), 0])), 0.8, 0xe0d8a0);
    }
    tooth(md, rib[rib.length - 1], add3(rib[rib.length - 1], v(-0.06 * s, -0.08, 0.06)), n(0.025), 0xe8dcb0, v(0, 0.02, 0.03));
  }
  // ------------------------------------------------------------------ root legs
  const rootCol = (t: number, x: number, y: number, z: number) => {
    let c = mixc(P.root, P.dirt, t * 0.7);
    if (Math.sin((x + z) * 0.9 + y * 0.4) > 0.75) c = mulc(c, 0.82);
    if (hash3(x, y, z) > 0.95) c = 0x8a7a50;
    return c;
  };
  const legs: [string, V3, number][] = [['1', [0.25, 0.5, 0.2], 0.5], ['2', [0.28, 0.48, 0.0], 0.0], ['3', [0.25, 0.5, -0.2], -0.5]];
  for (const [k, piv, ang] of legs) {
    const m = rig.part('leg_l' + k, 'body', v(...piv));
    const dir: V3 = [Math.cos(ang), 0, Math.sin(ang)];
    const pt = (r: number, y: number): V3 => v(piv[0] + dir[0] * r, y, piv[2] + dir[2] * r);
    const pts = curve([v(...piv), pt(0.35, 0.64), pt(0.66, 0.5), pt(0.84, 0.22), pt(0.88, 0.02)], 14);
    barbel(m, pts, n(alpha ? 0.13 : 0.105), n(0.03), rootCol);
    // knots and rootlets
    for (let i = 3; i < pts.length - 2; i += 3) {
      ell(m, pts[i], [n(0.06), n(0.05), n(0.06)], (x, y, z) => rootCol(i / pts.length, x, y, z), { under: true });
      const tip = add3(pts[i], v((hash3(i, 1, seed) - 0.5) * 0.2, -0.16 - hash3(i, 2, seed) * 0.12, (hash3(i, 3, seed) - 0.5) * 0.2));
      barbel(m, curve([pts[i], scl3(add3(pts[i], tip), 0.5), tip], 4), n(0.025), n(0.008), (t) => mixc(P.root, P.dirt, t));
    }
    // a clod of dirt on the foot
    ell(m, pts[pts.length - 1], [n(0.07), n(0.05), n(0.07)], (x, y, z) => (hash3(x, y, z) > 0.6 ? P.dirt : mulc(P.dirt, 1.25)), { under: true });
    rig.mirror('leg_l' + k, 'leg_r' + k);
  }
  // ------------------------------------------------------------------ the Pitcher Queen's cups
  if (alpha) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.8;
      const bx = Math.sin(a) * 0.38, bz = Math.cos(a) * 0.38;
      const base: V3 = v(bx, 0.62, bz);
      const prof = [0.04, 0.08, 0.11, 0.12, 0.12, 0.11, 0.095, 0.09, 0.1, 0.12].map((r) => n(r) * 1.1);
      const lean: [number, number] = [Math.sin(a) * n(0.22), Math.cos(a) * n(0.22)];
      vessel(body, base, [...prof, ...prof.slice(-3).map((r) => r * 1.04)], (row, x, z, ang) => {
        const top = row > prof.length;
        if (top) return Math.sin(ang * 14) > 0 ? 0xd83030 : 0x8a1418; // the ribbed peristome
        const spot = hash3(x, row, z) > 0.86;
        return spot ? 0xa02028 : mixc(0x9ab848, 0xc84a3a, row / prof.length);
      }, { lean, hollowTop: 4, seed: i + 3 });
      // acid inside, a lid above
      const top: V3 = [base[0] + lean[0], base[1] + prof.length + 2, base[2] + lean[1]];
      ell(body, [top[0], top[1] - 3, top[2]], [n(0.08), 1, n(0.08)], 0x9dff3a, { fl: VF.EMISSIVE });
      ell(body, [top[0] - Math.sin(a) * 2.5, top[1] + 4, top[2] - Math.cos(a) * 2.5], [n(0.12), n(0.02), n(0.1)], 0x5a8a2a);
    }
    // thorns all over the bulb
    for (let i = 0; i < 24; i++) {
      const a = i * 2.39996, y = 0.45 + (i % 6) * 0.1;
      const r = 0.36 + Math.sin(i) * 0.04;
      const p = v(Math.sin(a) * r, y, Math.cos(a) * r);
      tooth(body, p, add3(p, v(Math.sin(a) * 0.1, 0.03, Math.cos(a) * 0.1)), n(0.02), 0xe8dcb0);
    }
  }
  for (const m of [head, jaw]) wetGlints(m, 0.03, seed, (_x, _y, _z, c) => c === P.inn || c === P.out);
  rig.socket('mouth', 'head', v(0, HY + 0.05, HZ + 0.55));
  rig.socket('trap', 'jaw', v(0, HY, HZ + 0.55));
  rig.socket('head_top', 'head', v(0, HY + 0.6, HZ + 0.3));
  void cap;
  return rig.build({
    kind: 'plant',
    height: 2.5,
    radius: 0.75,
    expressions: { neutral: { jaw: 0 }, angry: { jaw: 0.15 }, hurt: { jaw: 0.25 }, defeated: { jaw: 0.4 } },
  });
}

const cache = new Map<string, RigSpec>();
export function oasisFlytrapRig(o: FlytrapOpts = {}): RigSpec {
  const k = (o.alpha ? 'a' : 'n') + (o.variant ?? 0);
  let r = cache.get(k);
  if (!r) cache.set(k, (r = build(o)));
  return r;
}
