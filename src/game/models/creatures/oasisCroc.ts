// The oasis crocodile (~4.4 m, 1/36 m voxels): a low, heavy Nile croc built for
// the 'lizard' skeleton of the horde renderer (sprawled trot, swishing tail,
// snapping jaw). One continuous sculpt cut into:
//   body (root) → head → jaw, eye_l/eye_r (golden eyes with slit pupils in
//   raised orbits); body → leg_fl/fr → foot_fl/fr (five clawed fingers),
//   leg_bl/br → foot_bl/br (four webbed toes); body → tail1 → tail2 → tail3.
// Rows of keeled osteoderms down the back, the nuchal shield, a double tail
// crest merging into one, a square-scaled pale belly, dark transverse bands,
// interlocking ivory teeth (the 4th lower tooth shows), a pale yellow mouth.
// Alpha ("Sobek's Favourite"): darker, scarred, gold temple earrings and a
// gold bangle on the foreleg, as the old priests dressed their sacred crocs.
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { CRig, VoxelModel, VF, units, sculpt, cutInto, topOf, mottledHide, wetGlints, paintM, tooth, band, mixc, mulc, clamp01, ell, cap, hash3, noise, type SPrim } from './oasisKit';

export interface CrocOpts {
  alpha?: boolean;
}

const VS = 1 / 36;
const U = units(VS);
const v = U.v;
const n = U.n;
const M = (i: number) => (i + 0.5) * VS;
const E = (c: [number, number, number], r: [number, number, number], rot?: V3, sub = false): SPrim => ({ c: v(...c), r: [n(r[0]), n(r[1]), n(r[2])], rot, sub });
const C = (a: [number, number, number], b: [number, number, number], r0: number, r1: number): SPrim => ({ a: v(...a), b: v(...b), r0: n(r0), r1: n(r1) });

const NECK = 0.82, JAW_Z = 0.94, T1 = -0.72, T2 = -1.34, T3 = -1.86;
/** where the jaws meet (rises toward the back of the gape) */
const lipY = (Z: number) => 0.335 + Math.max(0, 1.12 - Z) * 0.28;
/** half-width of the snout at z (metres) */
const snoutW = (Z: number) => Math.max(0.05, 0.19 - (Z - 1.05) * 0.1);

function build(o: CrocOpts): RigSpec {
  const alpha = !!o.alpha;
  const rig = new CRig(alpha ? 'oasis_croc_alpha' : 'oasis_croc', VS);
  const PAL = alpha
    ? { back: 0x262a1a, side: 0x4e5030, belly: 0xc8bc8a, blotch: 0x14160e, fleck: 0x7a7a4e }
    : { back: 0x3a4326, side: 0x6c6c3a, belly: 0xd8cd9c, blotch: 0x21271a, fleck: 0x9c9a62 };
  const hideBase = mottledHide({ ...PAL, bellyTop: 0.24, backLow: 0.42, cell: 0.32, seed: alpha ? 13 : 5, vs: VS });
  const hide = (x: number, y: number, z: number) => {
    const Y = M(y), Z = M(z), X = M(x);
    let c = hideBase(x, y, z);
    // dark transverse bands across the back and tail
    if (Y > 0.3 && Z < 0.7 && Math.sin(Z * 15 + Math.sin(X * 9) * 0.6) > 0.55) c = mixc(c, PAL.blotch, 0.55);
    // square belly scutes
    if (Y < 0.22) {
      const gx = Math.abs(((X / 0.055) % 1) + 1) % 1, gz = Math.abs(((Z / 0.065) % 1) + 1) % 1;
      if (gx < 0.18 || gz < 0.16) c = mulc(c, 0.82);
    }
    return c;
  };
  // ------------------------------------------------------------------ the whole animal
  const whole = new VoxelModel('croc');
  const prims: SPrim[] = [
    // trunk
    E([0, 0.34, 0.05], [0.42, 0.22, 0.76]),
    E([0, 0.29, 0.1], [0.47, 0.16, 0.62]),
    E([0, 0.38, 0.52], [0.34, 0.2, 0.32]),
    E([0, 0.37, -0.45], [0.33, 0.2, 0.32]),
    C([0, 0.37, 0.6], [0, 0.39, 0.92], 0.24, 0.2),
    // head: skull, jaw muscles, long V snout, nostril dome, raised orbits
    E([0, 0.41, 1.02], [0.22, 0.14, 0.22]),
    E([0.15, 0.36, 0.98], [0.1, 0.11, 0.16]),
    E([-0.15, 0.36, 0.98], [0.1, 0.11, 0.16]),
    E([0, 0.355, 1.45], [0.16, 0.075, 0.5]),
    E([0, 0.35, 1.88], [0.095, 0.062, 0.2]),
    E([0, 0.405, 1.98], [0.06, 0.035, 0.05]),
    E([0, 0.29, 1.38], [0.14, 0.05, 0.62]),
    E([0, 0.3, 1.0], [0.17, 0.07, 0.2]),
    E([0.105, 0.5, 1.03], [0.07, 0.06, 0.08]),
    E([-0.105, 0.5, 1.03], [0.07, 0.06, 0.08]),
    // tail: laterally compressed, tapering to a whip
    E([0, 0.34, -0.85], [0.26, 0.2, 0.42]),
    E([0, 0.33, -1.25], [0.19, 0.17, 0.42]),
    E([0, 0.32, -1.66], [0.12, 0.14, 0.38]),
    C([0, 0.32, -1.92], [0, 0.31, -2.32], 0.09, 0.025),
  ];
  sculpt(whole, prims, hide, { k: n(0.08), disp: (x, y, z) => noise.n3(x * 0.25, y * 0.25, z * 0.25) * 0.6, dispMax: 1, interior: 0x2a2a1a });
  // a flat mouth cavity between the jaws: pale yellow, a tongue, the palatal valve at the back
  const inMouth = (X: number, Y: number, Z: number) => (X / (snoutW(Z) * 0.8)) ** 2 + ((Y - 0.335) / 0.028) ** 2 < 1 && Z > JAW_Z + 0.04 && Z < 1.9;
  const gone: V3[] = [];
  whole.forEach((x, y, z) => {
    if (inMouth(M(x), M(y), M(z))) gone.push([x, y, z]);
  });
  for (const [x, y, z] of gone) whole.del(x, y, z);
  paintM(whole, VS, (X, Y, Z) => Z > JAW_Z && Z < 1.95 && Math.abs(Y - 0.335) < 0.06 && Math.abs(X) < snoutW(Z) * 0.95, (c, x, y, z) => {
    const Z = M(z), Y = M(y);
    if (Z < 1.05) return 0xc88a7a;
    if (Y < 0.33 && Math.abs(M(x)) < 0.06 && Z < 1.5) return 0xd8a088;
    return hash3(x, y, z) > 0.85 ? 0xd8c48a : 0xe8d8a0;
  }, false);
  // ------------------------------------------------------------------ cut into parts
  const body = rig.part('body', undefined, v(0, 0.36, 0));
  const head = rig.part('head', 'body', v(0, 0.39, NECK));
  const jaw = rig.part('jaw', 'head', v(0, 0.345, JAW_Z));
  const tail1 = rig.part('tail1', 'body', v(0, 0.35, T1));
  const tail2 = rig.part('tail2', 'tail1', v(0, 0.33, T2));
  const tail3 = rig.part('tail3', 'tail2', v(0, 0.32, T3));
  cutInto(whole, VS, { body, head, jaw, tail1, tail2, tail3 }, (X, Y, Z) => {
    if (Z > NECK) return Z > JAW_Z && Y < lipY(Z) ? 'jaw' : 'head';
    if (Z < T3) return 'tail3';
    if (Z < T2) return 'tail2';
    if (Z < T1) return 'tail1';
    return 'body';
  }, (_X, _Y, Z, p) => {
    if (p === 'body' && Z > NECK - 0.06) return 'head';
    if (p === 'body' && Z < T1 + 0.06) return 'tail1';
    if (p === 'tail1' && Z < T2 + 0.06) return 'tail2';
    if (p === 'tail2' && Z < T3 + 0.06) return 'tail3';
    return null;
  });
  // ------------------------------------------------------------------ teeth: interlocking, the 4th lower tooth outside
  const IV = alpha ? 0xd8c48c : 0xeee2c4, IVD = alpha ? 0xb8a068 : 0xd6c49a;
  for (const s of [1, -1]) {
    for (let i = 0; i < 15; i++) {
      const Z = 1.0 + i * 0.066;
      const w = snoutW(Z) * 0.9;
      if (alpha && (i === 5 || i === 11) && s > 0) continue; // broken, missing
      const col = hash3(i, s, 3) > 0.5 ? IV : IVD;
      const len = 0.035 + (i % 4 === 1 ? 0.018 : 0) + (i > 11 ? -0.008 : 0);
      tooth(head, v(w * s, lipY(Z) + 0.008, Z), v(w * s * 1.04, lipY(Z) - len, Z + 0.006), n(0.012), col);
      const Zl = Z + 0.033;
      const big = i === 3 ? 0.03 : 0;
      tooth(jaw, v(snoutW(Zl) * 0.86 * s, lipY(Zl) - 0.008, Zl), v(snoutW(Zl) * (0.92 + big * 3) * s, lipY(Zl) + 0.03 + big, Zl - 0.004), n(0.012 + big * 0.2), col);
    }
  }
  // ------------------------------------------------------------------ osteoderms, nuchal shield, tail crest
  const scute = (m: VoxelModel, X: number, Z: number, h: number, w: number, keel = true) => {
    const x = Math.floor(n(X)), z = Math.floor(n(Z));
    const top = topOf(m, x, z, n(0.1), n(0.75));
    if (top < 0) return;
    const c: V3 = [x + 0.5, top + 0.5, z + 0.5];
    ell(m, c, [n(w), n(h), n(w * 1.25)], (xx, yy, zz) => (yy > top + n(h) * 0.5 ? mixc(PAL.back, PAL.fleck, 0.25) : hash3(xx, yy, zz) > 0.7 ? PAL.blotch : mulc(PAL.back, 0.9)));
    if (keel) cap(m, [c[0], c[1] + n(h) * 0.6, c[2] - n(w)], [c[0], c[1] + n(h) * 1.2, c[2] + n(w) * 0.5], 0.7, 0.5, mixc(PAL.back, PAL.fleck, 0.3));
  };
  for (let Z = 0.42; Z > T1 - 0.02; Z -= 0.105) for (const X of [0.06, 0.15, 0.24]) for (const s of [1, -1]) scute(body, X * s, Z + (X > 0.2 ? 0.04 : 0), 0.024, 0.032);
  for (const [X, Z, w] of [[0.07, 0.68, 0.05], [-0.07, 0.68, 0.05], [0.07, 0.59, 0.045], [-0.07, 0.59, 0.045], [0.16, 0.64, 0.035], [-0.16, 0.64, 0.035]] as [number, number, number][]) scute(body, X, Z, alpha ? 0.04 : 0.03, w);
  const crest = (m: VoxelModel, z0: number, z1: number, double: boolean) => {
    for (let Z = z0; Z > z1; Z -= 0.075) {
      for (const X of double ? [0.07, -0.07] : [0]) {
        const x = Math.floor(n(X)), z = Math.floor(n(Z));
        const top = topOf(m, x, z, n(0.1), n(0.7));
        if (top < 0) continue;
        const h = n(double ? 0.075 : 0.06) * (alpha ? 1.25 : 1);
        for (let k = 0; k < h; k++) {
          const w = Math.max(0, Math.round((1 - k / h) * n(0.022)));
          for (let dz = -w; dz <= w; dz++) m.set(x, top + 1 + k, z + dz, k > h * 0.6 ? mixc(PAL.back, PAL.fleck, 0.3) : PAL.blotch);
        }
      }
    }
  };
  crest(tail1, T1 - 0.02, T2, true);
  crest(tail2, T2 - 0.02, -1.62, true);
  crest(tail2, -1.62, T3, false);
  crest(tail3, T3 - 0.02, -2.22, false);
  // ------------------------------------------------------------------ eyes: golden, vertical slit pupils, raised orbits
  for (const s of [1, -1]) {
    const ec: V3 = v(0.112 * s, 0.538, 1.045);
    const er = n(0.044);
    ell(head, ec, [er * 1.1, er * 1.1, er * 1.1], 0, { carve: true });
    const eye = rig.part(s > 0 ? 'eye_l' : 'eye_r', 'head', ec);
    ell(eye, ec, [er, er, er], (x, y, z) => {
      const lx = x + 0.5 - ec[0], ly = y + 0.5 - ec[1], lz = z + 0.5 - ec[2];
      const out = lx * s * 0.75 + lz * 0.6 + ly * 0.3;
      if (out > er * 0.5 && Math.abs(lx * 0.6 - lz * 0.75 * s) < 0.55) return 0x0a0806; // the slit
      return out > 0 ? (hash3(x, y, z) > 0.5 ? 0xd8a838 : 0xc08a24) : 0x5a4418;
    }, { fl: VF.METAL });
    // a heavy brow ridge over each eye
    cap(head, v(0.085 * s, 0.58, 0.99), v(0.13 * s, 0.575, 1.1), n(0.022), n(0.018), PAL.back);
  }
  // ------------------------------------------------------------------ legs (sprawled), clawed hands, webbed feet
  const skin = (x: number, y: number, z: number) => mixc(hideBase(x, y, z), PAL.side, 0.3);
  const claw = alpha ? 0x1a140e : 0x2e261a;
  const limb = (key: string, hip: [number, number, number], knee: [number, number, number], palm: [number, number, number], toes: number[], len: number, web: boolean, sz: number) => {
    const up = rig.part('leg_' + key, 'body', v(...hip));
    const ft = rig.part('foot_' + key, 'leg_' + key, v(...knee));
    sculpt(up, [C(hip, knee, 0.085 * sz, 0.065 * sz), E([(hip[0] + knee[0]) / 2, (hip[1] + knee[1]) / 2 + 0.01, (hip[2] + knee[2]) / 2], [0.1 * sz, 0.075 * sz, 0.085 * sz])], skin, { k: n(0.04) });
    const ank: [number, number, number] = [palm[0] - 0.01, 0.05, palm[2] - 0.03];
    sculpt(ft, [C(knee, ank, 0.065 * sz, 0.045 * sz), E(palm, [0.06 * sz, 0.028, 0.07 * sz])], skin, { k: n(0.03) });
    const tips: V3[] = [];
    for (const a of toes) {
      const d = [Math.sin(a), 0, Math.cos(a)];
      const base: [number, number, number] = [palm[0] + d[0] * 0.04, 0.03, palm[2] + d[2] * 0.04];
      const tip: [number, number, number] = [palm[0] + d[0] * len, 0.02, palm[2] + d[2] * len];
      sculpt(ft, [C(base, tip, 0.02 * sz, 0.014 * sz)], skin, { k: 1 });
      tooth(ft, v(tip[0], 0.022, tip[2]), v(tip[0] + d[0] * 0.035, 0.004, tip[2] + d[2] * 0.035), n(0.011), claw);
      tips.push(v(tip[0], 0.025, tip[2]));
    }
    if (web)
      for (let i = 0; i < tips.length - 1; i++) {
        const a = tips[i], b = tips[i + 1];
        for (let t = 0.15; t < 0.85; t += 0.08) {
          const p: V3 = [a[0] + (b[0] - a[0]) * t, a[1], a[2] + (b[2] - a[2]) * t];
          const c: V3 = v(palm[0], 0.03, palm[2]);
          cap(ft, c, p, 0.6, 0.5, mulc(PAL.side, 0.85));
        }
      }
    return { up, ft };
  };
  const front = limb('fl', [0.3, 0.3, 0.52], [0.52, 0.2, 0.5], [0.57, 0.035, 0.6], [-0.3, 0.15, 0.6, 1.05, 1.5], 0.085, false, 1);
  limb('bl', [0.28, 0.3, -0.42], [0.55, 0.2, -0.46], [0.6, 0.035, -0.55], [0.7, 1.15, 1.6, 2.05], 0.12, true, 1.15);
  if (alpha) band(front.up, v(0.49, 0.21, 0.5), [1, -0.35, 0], n(0.075), n(0.016), (x, y, z) => (hash3(x, y, z) > 0.7 ? 0x9a6a1a : 0xe0b040));
  rig.mirror('leg_fl', 'leg_fr');
  rig.mirror('foot_fl', 'foot_fr', 'leg_fr');
  rig.mirror('leg_bl', 'leg_br');
  rig.mirror('foot_bl', 'foot_br', 'leg_br');
  // ------------------------------------------------------------------ the alpha: scars, gold temple earrings
  if (alpha) {
    paintM(head, VS, (X, Y, Z) => Y > 0.38 && Math.abs(X - (Z - 1.2) * 0.4) < 0.012 && Z > 1.1 && Z < 1.6, () => 0xa08a72);
    paintM(body, VS, (X, Y, Z) => Y > 0.45 && Math.abs(Z - 0.1 - X * 0.6) < 0.014, () => 0xa08a72);
    for (const s of [1, -1]) {
      band(head, v(0.205 * s, 0.33, 0.93), [0, 0, 1], n(0.04), n(0.012), (x, y, z) => (hash3(x, y, z) > 0.75 ? 0x9a6a1a : 0xe6b444));
      ell(head, v(0.215 * s, 0.27, 0.93), [n(0.016), n(0.024), n(0.016)], 0x2a5ab8, { fl: VF.METAL });
    }
  }
  for (const m of [body, head, tail1, tail2, tail3]) wetGlints(m, 0.03, 3, (_x, y) => M(y) > 0.3);
  rig.socket('mouth', 'head', v(0, 0.36, 1.7));
  rig.socket('head_top', 'head', v(0, 0.56, 1.05));
  rig.socket('back', 'body', v(0, 0.55, 0));
  rig.socket('jaw_tip', 'jaw', v(0, 0.3, 1.95));
  void clamp01;
  return rig.build({
    kind: 'croc',
    height: 0.6,
    radius: 0.62,
    length: 4.4,
    expressions: { neutral: { jaw: 0 }, angry: { jaw: 0.05 }, hurt: { jaw: 0.25 }, defeated: { jaw: 0.35 } },
  });
}

const cache = new Map<string, RigSpec>();
export function oasisCrocRig(o: CrocOpts = {}): RigSpec {
  const k = o.alpha ? 'a' : 'n';
  let r = cache.get(k);
  if (!r) cache.set(k, (r = build(o)));
  return r;
}
