// The land catfish (~3.3 m, 1/36 m voxels): a pot-bellied walking catfish on
// four stumpy, webbed legs, the King's footsoldiers. Built for the horde's
// 'lizard' skeleton (waddling trot, tail swish, gulping jaw):
//   body (root) → head → jaw (+ chin barbels), eye_l/eye_r (glossy modelled
//   eyes), whisker_l / whisker_r (long maxillary barbels); body → leg_fl/fr →
//   foot_fl/fr, leg_bl/br → foot_bl/br; body → tail1 → tail2 → tail3 (caudal fin).
// A huge pink gape with brushy teeth pads, thick lips, slimy mottled hide,
// a dotted lateral line, serrated pectoral spines and a ragged dorsal fin.
// Alpha ("The Bailiff"): bigger, near-black with a pale belly, a gold ring
// in each barbel and a lily pad slapped on its head.
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { CRig, VoxelModel, VF, units, sculpt, cutInto, mottledHide, wetGlints, paintM, fin, spine, tooth, barbel, curve, band, wetEye, mixc, mulc, ell, hash3, noise, topOf, type SPrim } from './oasisKit';

export interface CatfishOpts {
  alpha?: boolean;
  variant?: number;
}

const VS = 1 / 36;
const U = units(VS);
const v = U.v;
const n = U.n;
const M = (i: number) => (i + 0.5) * VS;
const E = (c: [number, number, number], r: [number, number, number], rot?: V3, sub = false): SPrim => ({ c: v(...c), r: [n(r[0]), n(r[1]), n(r[2])], rot, sub });
const C = (a: [number, number, number], b: [number, number, number], r0: number, r1: number): SPrim => ({ a: v(...a), b: v(...b), r0: n(r0), r1: n(r1) });

const NECK = 0.68, JAW_Z = 0.86, T1 = -0.42, T2 = -0.86, T3 = -1.18;
const lipY = (X: number, Z: number) => 0.55 - 0.08 * X * X - Math.max(0, 1.2 - Z) * 0.05;
const inMouth = (X: number, Y: number, Z: number, s = 1) => (X / (0.42 * s)) ** 2 + ((Y - 0.54) / (0.13 * s)) ** 2 + ((Z - 1.07) / (0.4 * s)) ** 2 < 1;

const PALS = [
  { back: 0x3b3829, side: 0x77704e, belly: 0xe0d6b2, blotch: 0x221f17, fleck: 0xb4ac84 },
  { back: 0x434a2a, side: 0x83824c, belly: 0xe2dab0, blotch: 0x262b16, fleck: 0xbcbc84 },
];
const ALPHA = { back: 0x1e1c16, side: 0x4c4636, belly: 0xd0c6a2, blotch: 0x0e0d0a, fleck: 0x8a8264 };

function build(o: CatfishOpts): RigSpec {
  const alpha = !!o.alpha;
  const PAL = alpha ? ALPHA : PALS[(o.variant ?? 0) % PALS.length];
  const rig = new CRig(alpha ? 'oasis_catfish_alpha' : 'oasis_catfish' + (o.variant ? '_v' + o.variant : ''), VS);
  const hide = mottledHide({ ...PAL, bellyTop: 0.48, backLow: 0.78, cell: 0.42, seed: alpha ? 21 : 9 + (o.variant ?? 0) * 4, vs: VS });
  const whole = new VoxelModel('catfish');
  const prims: SPrim[] = [
    // a fat, slumped trunk with a pot belly
    E([0, 0.63, 0.15], [0.5, 0.37, 0.62]),
    E([0, 0.48, 0.2], [0.56, 0.27, 0.56]),
    E([0, 0.79, 0.0], [0.32, 0.24, 0.56]),
    E([0, 0.63, 0.62], [0.5, 0.31, 0.3]),
    // broad flat head, wide snout, heavy chin
    E([0, 0.63, 0.98], [0.57, 0.27, 0.44]),
    E([0, 0.585, 1.3], [0.5, 0.2, 0.27]),
    E([0, 0.47, 1.18], [0.47, 0.14, 0.36]),
    E([0.42, 0.56, 0.86], [0.18, 0.2, 0.3]),
    E([-0.42, 0.56, 0.86], [0.18, 0.2, 0.3]),
    E([0.46, 0.72, 1.16], [0.1, 0.09, 0.1]),
    E([-0.46, 0.72, 1.16], [0.1, 0.09, 0.1]),
    // tail
    E([0, 0.63, -0.52], [0.3, 0.33, 0.42]),
    E([0, 0.61, -0.95], [0.19, 0.26, 0.36]),
    E([0, 0.6, -1.28], [0.11, 0.17, 0.26]),
    // adipose ridge
    E([0, 0.94, -0.62], [0.05, 0.1, 0.24]),
  ];
  sculpt(whole, prims, hide, { k: n(0.12), disp: (x, y, z) => noise.n3(x * 0.2, y * 0.2, z * 0.2) * 0.7, dispMax: 1, interior: 0x2e2a1e });
  // the gape: a big pink mouth, brushy teeth pads behind thick lips
  const gone: V3[] = [];
  whole.forEach((x, y, z) => {
    const X = M(x), Y = M(y), Z = M(z);
    if (inMouth(X, Y, Z) || (Z > JAW_Z + 0.05 && Math.abs(Y - lipY(X, Z)) < 0.012 && inMouth(X, Y, Z, 1.5))) gone.push([x, y, z]);
  });
  for (const [x, y, z] of gone) whole.del(x, y, z);
  paintM(whole, VS, (X, Y, Z) => inMouth(X, Y, Z, 1.2), (c, x, y, z) => {
    const X = M(x), Y = M(y), Z = M(z);
    const lip = lipY(X, Z);
    if (Math.abs(Y - lip) < 0.06 && Math.abs(Y - lip) > 0.012 && (Z > 1.25 || Math.abs(X) > 0.33)) return hash3(x, y, z) > 0.5 ? 0xece0c4 : 0xc8b898;
    const deep = Math.max(0, 1 - (Z - 0.7) / 0.6);
    return mixc(hash3(x, y, z) > 0.8 ? 0xb85a5c : 0xd07a78, 0x3a1214, deep * deep);
  }, false);
  paintM(whole, VS, (X, Y, Z) => Z > 1.0 && Math.abs(Y - lipY(X, Z)) < 0.05 && !inMouth(X, Y, Z, 1.1), (c, x, y, z) => mixc(c, hash3(x, y, z) > 0.7 ? 0xa48464 : 0xc4a684, 0.75), false);
  sculpt(whole, [E([0, 0.43, 1.05], [0.26, 0.05, 0.3])], 0xc06460, { k: 2, under: true });
  // lateral line
  paintM(whole, VS, (X, Y, Z) => Z < 0.7 && Z > -1.3 && Math.abs(X) > 0.1 && Math.abs(Y - (0.6 + (Z + 1.3) * 0.06)) < 0.012, (c, x, y, z) => (hash3(x, y, z) > 0.35 ? mixc(c, 0xe0dab8, 0.55) : c), false);
  // ------------------------------------------------------------------ parts
  const body = rig.part('body', undefined, v(0, 0.6, 0));
  const head = rig.part('head', 'body', v(0, 0.62, NECK));
  const jaw = rig.part('jaw', 'head', v(0, 0.55, JAW_Z));
  const tail1 = rig.part('tail1', 'body', v(0, 0.62, T1));
  const tail2 = rig.part('tail2', 'tail1', v(0, 0.61, T2));
  const tail3 = rig.part('tail3', 'tail2', v(0, 0.6, T3));
  cutInto(whole, VS, { body, head, jaw, tail1, tail2, tail3 }, (X, Y, Z) => {
    if (Z > NECK) return Z > JAW_Z && Y < lipY(X, Z) ? 'jaw' : 'head';
    if (Z < T3) return 'tail3';
    if (Z < T2) return 'tail2';
    if (Z < T1) return 'tail1';
    return 'body';
  }, (_X, _Y, Z, p) => {
    if (p === 'body' && Z > NECK - 0.07) return 'head';
    if (p === 'body' && Z < T1 + 0.07) return 'tail1';
    if (p === 'tail1' && Z < T2 + 0.07) return 'tail2';
    if (p === 'tail2' && Z < T3 + 0.07) return 'tail3';
    return null;
  });
  // ------------------------------------------------------------------ eyes
  for (const s of [1, -1]) {
    const ec: V3 = v(0.5 * s, 0.735, 1.17);
    const er = n(0.055);
    ell(head, ec, [er * 1.1, er * 1.1, er * 1.1], 0, { carve: true });
    const eye = rig.part(s > 0 ? 'eye_l' : 'eye_r', 'head', ec);
    wetEye(eye, ec, er, [0.85 * s, 0.35, 0.4], { sclera: 0x2a2014, iris: alpha ? 0xb83a1a : 0xc0922c, irisEdge: 0x5a3a10, pupil: 0x060404, irisR: 0.92, pupilR: 0.45 });
  }
  // ------------------------------------------------------------------ barbels
  const wcol = (t: number, x: number, y: number, z: number) => {
    let c = mixc(alpha ? 0x14120e : 0x2a241a, 0xa09070, t * t);
    if (hash3(x, y, z) > 0.9) c = mulc(c, 1.25);
    return c;
  };
  for (const s of [1, -1]) {
    const w = rig.part(s > 0 ? 'whisker_l' : 'whisker_r', 'head', v(0.5 * s, 0.585, 1.28));
    const pts = curve([v(0.5 * s, 0.585, 1.28), v(0.72 * s, 0.6, 1.48), v(0.98 * s, 0.52, 1.56), v(1.2 * s, 0.38, 1.44), v(1.32 * s, 0.24, 1.22)], 12);
    barbel(w, pts, n(0.04), n(0.012), wcol);
    if (alpha) band(w, pts[4], [pts[5][0] - pts[4][0], pts[5][1] - pts[4][1], pts[5][2] - pts[4][2]], n(0.05), n(0.012), (x, y, z) => (hash3(x, y, z) > 0.7 ? 0x9a6a1a : 0xe0b040));
    // nasal barbels
    barbel(head, curve([v(0.2 * s, 0.82, 1.32), v(0.24 * s, 0.94, 1.26), v(0.3 * s, 1.0, 1.12)], 5), n(0.022), n(0.01), wcol);
    // chin barbels on the jaw
    for (const [bx, bz] of [[0.32, 1.2], [0.13, 1.32]] as [number, number][])
      barbel(jaw, curve([v(bx * s, 0.4, bz), v(bx * 1.15 * s, 0.28, bz + 0.06), v(bx * 1.25 * s, 0.18, bz + 0.08)], 5), n(0.022), n(0.009), wcol);
  }
  // ------------------------------------------------------------------ fins
  const FINC = { membrane: mixc(PAL.back, 0x5a5440, 0.4), ray: mulc(PAL.back, 0.8), edge: mixc(PAL.side, 0xa49a78, 0.4) };
  for (const s of [1, -1]) {
    const L = (x: number, y: number, z: number): V3 => v(x * s, y, z);
    fin(body, [[L(0.48, 0.45, 0.6), L(0.86, 0.3, 0.3)], [L(0.48, 0.44, 0.55), L(0.82, 0.29, 0.18)], [L(0.47, 0.44, 0.5), L(0.72, 0.31, 0.1)], [L(0.46, 0.45, 0.45), L(0.6, 0.36, 0.12)]], { ...FINC, th: 1, seed: s > 0 ? 2 : 5 });
    spine(body, L(0.48, 0.46, 0.62), L(0.88, 0.31, 0.3), n(0.025), mulc(PAL.back, 0.9), L(0, 0, -1), mixc(PAL.side, 0xffffff, 0.2));
  }
  fin(body, [[v(0, 0.95, 0.42), v(0, 1.28, 0.22)], [v(0, 0.98, 0.3), v(0, 1.22, 0.06)], [v(0, 0.98, 0.18), v(0, 1.14, -0.06)], [v(0, 0.97, 0.06), v(0, 1.05, -0.12)]], { ...FINC, th: 1, seed: 7, ragged: 0.25 });
  spine(body, v(0, 0.93, 0.44), v(0, 1.3, 0.22), n(0.03), mulc(PAL.back, 0.9), [0, 0, -1], mixc(PAL.side, 0xffffff, 0.2));
  fin(tail3, [
    [v(0, 0.66, -1.4), v(0, 0.98, -1.76)],
    [v(0, 0.63, -1.45), v(0, 0.82, -1.82)],
    [v(0, 0.6, -1.47), v(0, 0.6, -1.72)],
    [v(0, 0.57, -1.45), v(0, 0.4, -1.82)],
    [v(0, 0.54, -1.4), v(0, 0.24, -1.74)],
  ], { ...FINC, th: 1.5, seed: 3, ragged: 0.2 });
  fin(tail1, [[v(0, 0.34, -0.45), v(0, 0.2, -0.6)], [v(0, 0.36, -0.7), v(0, 0.22, -0.84)]], { ...FINC, th: 1, seed: 8 });
  fin(tail2, [[v(0, 0.4, -0.88), v(0, 0.27, -1.02)], [v(0, 0.46, -1.12), v(0, 0.36, -1.2)]], { ...FINC, th: 1, seed: 9 });
  // ------------------------------------------------------------------ stumpy legs: webbed, clawed
  const skin = (x: number, y: number, z: number) => mixc(hide(x, y, z), PAL.side, 0.3);
  const limb = (key: string, hip: [number, number, number], knee: [number, number, number], palm: [number, number, number], toes: number[]) => {
    const up = rig.part('leg_' + key, 'body', v(...hip));
    const ft = rig.part('foot_' + key, 'leg_' + key, v(...knee));
    sculpt(up, [C(hip, knee, 0.12, 0.09), E([(hip[0] + knee[0]) / 2, (hip[1] + knee[1]) / 2 + 0.02, (hip[2] + knee[2]) / 2], [0.13, 0.11, 0.12])], skin, { k: n(0.05) });
    const ank: [number, number, number] = [palm[0] - 0.02, 0.07, palm[2] - 0.03];
    sculpt(ft, [C(knee, ank, 0.09, 0.07), E(palm, [0.11, 0.04, 0.12]), E(knee, [0.1, 0.09, 0.1])], skin, { k: n(0.04) });
    const tips: V3[] = [], bases: V3[] = [];
    for (const a of toes) {
      const d = [Math.sin(a), 0, Math.cos(a)];
      const base: [number, number, number] = [palm[0] + d[0] * 0.07, 0.035, palm[2] + d[2] * 0.07];
      const tip: [number, number, number] = [palm[0] + d[0] * 0.2, 0.025, palm[2] + d[2] * 0.2];
      sculpt(ft, [C(base, tip, 0.032, 0.022)], skin, { k: 1 });
      tooth(ft, v(tip[0], 0.025, tip[2]), v(tip[0] + d[0] * 0.05, 0.004, tip[2] + d[2] * 0.05), n(0.014), 0x2a2218);
      tips.push(v(tip[0], 0.03, tip[2]));
      bases.push(v(base[0], 0.035, base[2]));
    }
    for (let i = 0; i < tips.length - 1; i++) fin(ft, [[bases[i], tips[i]], [bases[i + 1], tips[i + 1]]], { membrane: mixc(PAL.side, 0xc0a088, 0.4), ray: PAL.side, edge: mixc(PAL.side, 0xd8c0a0, 0.5), th: 1, ragged: 0.35 });
  };
  limb('fl', [0.4, 0.4, 0.45], [0.6, 0.27, 0.48], [0.65, 0.04, 0.58], [-0.1, 0.4, 0.9, 1.4]);
  limb('bl', [0.38, 0.38, -0.2], [0.57, 0.26, -0.24], [0.62, 0.04, -0.18], [0.3, 0.8, 1.3, 1.8]);
  rig.mirror('leg_fl', 'leg_fr');
  rig.mirror('foot_fl', 'foot_fr', 'leg_fr');
  rig.mirror('leg_bl', 'leg_br');
  rig.mirror('foot_bl', 'foot_br', 'leg_br');
  // ------------------------------------------------------------------ the alpha's lily pad hat
  if (alpha) {
    const cx = 0, cz = Math.round(n(0.92));
    const top = topOf(head, cx, cz, n(0.6), n(1.1));
    const R = n(0.26);
    for (let x = -R; x <= R; x++)
      for (let z = -R; z <= R; z++) {
        const d = Math.hypot(x, z) / R;
        const a = Math.atan2(z, x);
        if (d > 1 || (Math.abs(a + 1.2) < 0.25 && d > 0.1)) continue;
        head.set(x, top + 1 + Math.round(d * d * 1.5), cz + z, d > 0.88 ? 0x7aae46 : Math.abs(Math.sin(a * 7)) < 0.2 ? 0x3e6e24 : 0x4f8a2e, VF.SOFTAO);
      }
  }
  for (const m of [body, head, jaw, tail1, tail2, tail3]) wetGlints(m, 0.035, 5, (_x, y) => M(y) > 0.55);
  rig.socket('mouth', 'head', v(0, 0.55, 1.2));
  rig.socket('belly', 'body', v(0, 0.45, 0.2));
  rig.socket('head_top', 'head', v(0, 0.88, 1.0));
  rig.socket('back', 'body', v(0, 0.95, 0));
  return rig.build({
    kind: 'catfish',
    height: 1.05,
    radius: 0.75,
    length: 3.3,
    expressions: { neutral: { jaw: 0 }, angry: { jaw: 0.08 }, hurt: { jaw: 0.3 }, defeated: { jaw: 0.4 } },
  });
}

const cache = new Map<string, RigSpec>();
export function oasisCatfishRig(o: CatfishOpts = {}): RigSpec {
  const k = (o.alpha ? 'a' : 'n') + (o.variant ?? 0);
  let r = cache.get(k);
  if (!r) cache.set(k, (r = build(o)));
  return r;
}
