// The roadside legends of old Egypt (run/MythRoad): gods and monsters who stand by the trail with a
// story and a job. Every one is sculpted in metres on the realistic kit (enemies/real/sculpt + rk),
// rigged on the standard humanoid names so one procedural animator drives them all:
//   pelvis (root) -> torso -> head (-> jaw, eye_l/eye_r modelled eyes), arm_l/r -> fore_l/r (hand),
//   thigh_l/r -> shin_l/r (foot). Extras: 'tail' (pelvis), 'wing_l/r' (fore), 'held' (a hand prop),
//   'crown' (head). Faces +Z, LEFT = +X, origin on the ground, 1/80 m.
//   Bes            the dwarf protector: lion mane, beard, tongue out, a five-plume crown, a lion-skin tail,
//                  a curved snake knife and a frame drum; bandy legs and a proud pot belly
//   Taweret        the hippo mother: hippo head, tripartite wig, plumes, lion paws, a crocodile back and
//                  tail, the sa knot of protection in her paw
//   Hathor         the cow-headed lady of the west: a dappled cow head, lyre horns holding the red sun
//                  disc and its cobra, a menat collar, a red beaded sheath, a sistrum
//   Khnum          the ram-headed potter: long wavy horizontal horns, a plaited divine beard, a clay-
//                  smeared kilt and apron, a half-thrown pot in his hand (plus his wheel, a static prop)
//   Isis           the High Priestess: kohl-lined eyes, a long black wig, the throne glyph on her head,
//                  feathered wings along her arms, the red knot of Isis, an ankh
// Also: the Shipwrecked Sailor's serpent (a gold coil with lapis brows and a beard, its neck rigged
// seg1..seg6 -> head -> jaw), Mojo the scruffy coffee-gum terrier (body, head, jaw, ears, legs, tail),
// the quest tokens (red beer jar, river clay, ivory wand, pieces of Osiris, myrrh, a page of the Book of
// Thoth), the shadow props (oar, bow, book) and the coffee gum pack.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { RBm, Sc, type M3, mix, mulRGB, hash3, noise, tonal, cloth, metal, hornM, VoxelModel } from '../enemies/real/sculpt';
import { ell, cap, tube, mammalEye, fur, leather, realFinish, rope, loopPts, lumpy, paint, cut } from '../enemies/real/rk';
import type { CSpec } from '../../../engine/voxel/VoxelModel';

export const MYTH_VS = 1 / 80;
const GOLD = 0xe2b24a, GOLD_D = 0xa8781e, LAPIS = 0x2c4a9a, TURQ = 0x3aa8a0, CARN = 0xb8402a, LINEN = 0xeee2c8, INK = 0x1a120c;

// ====================================================================== the body
interface BodyO {
  H: number;
  fem?: boolean;
  /** leg, torso and arm length factors (a dwarf is short in the leg) */
  legs?: number;
  tor?: number;
  arms?: number;
  /** girth */
  g?: number;
  /** 0 flat .. 1.5 a proud belly */
  belly?: number;
  skin: CSpec;
  hand?: 'hand' | 'paw';
  foot?: 'bare' | 'paw' | 'sandal';
}
interface Jt {
  k: number;
  g: number;
  pelvis: M3;
  waist: M3;
  neck: M3;
  shoulder: M3;
  elbow: M3;
  wrist: M3;
  hip: M3;
  knee: M3;
  ankle: M3;
}
function joints(o: BodyO): Jt {
  const k = o.H / 1.75, lg = o.legs ?? 1, tr = o.tor ?? 1, ar = o.arms ?? 1, g = o.g ?? 1;
  const shX = (o.fem ? 0.165 : 0.188) * k * g, hipX = (o.fem ? 0.095 : 0.09) * k * g;
  const ankle = 0.085 * k, knee = ankle + 0.425 * k * lg, hip = knee + 0.42 * k * lg;
  const waist = hip + 0.11 * k, shoulder = waist + 0.39 * k * tr, neck = shoulder + 0.115 * k;
  const elbow = shoulder - 0.295 * k * ar, wrist = elbow - 0.255 * k * ar;
  return {
    k, g,
    pelvis: [0, hip + 0.05 * k, 0], waist: [0, waist, -0.005 * k], neck: [0, neck, -0.012 * k],
    shoulder: [shX, shoulder, -0.02 * k], elbow: [shX + 0.02 * k * g, elbow, -0.034 * k], wrist: [shX + 0.026 * k * g, wrist, -0.004 * k],
    hip: [hipX, hip, 0], knee: [hipX + 0.008 * k * (o.legs && o.legs < 0.8 ? 3 : 1), knee, 0.012 * k], ankle: [hipX + 0.01 * k, ankle, -0.012 * k],
  };
}
const add3 = (a: M3, b: M3): M3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp3 = (a: M3, b: M3, t: number): M3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const vsM = (i: number) => (i + 0.5) * MYTH_VS;

/** a whole sculpted body (left limbs; mirrored at the end of each builder) */
function body(rb: RBm, o: BodyO): Jt {
  const J = joints(o), k = J.k, g = J.g, c = o.skin, b = o.belly ?? 0;
  const W = J.waist[1], S = J.shoulder[1], Hp = J.hip[1];
  // pelvis: hip mass, glutes
  const pel = rb.pm('pelvis', undefined, J.pelvis);
  ell(pel, [0, Hp + 0.035 * k, -0.005 * k], [(o.fem ? 0.162 : 0.142) * k * g, 0.1 * k, 0.098 * k * g], c);
  for (const sx of [1, -1]) {
    ell(pel, [sx * 0.07 * k * g, Hp - 0.03 * k, -0.045 * k], [0.075 * k * g, 0.085 * k, 0.07 * k * g], c);
    ell(pel, [sx * J.hip[0], Hp - 0.03 * k, 0.005], [0.085 * k * g, 0.07 * k, 0.08 * k * g], c);
  }
  // torso: abdomen (and belly), ribcage, chest, deltoids, trapezius, shoulder blades, neck
  const tor = rb.pm('torso', 'pelvis', J.waist);
  ell(tor, [0, W + 0.07 * k + b * 0.02 * k, 0.005 * k + b * 0.07 * k], [(0.13 + b * 0.06) * k * g, (0.11 + b * 0.05) * k, (0.094 + b * 0.085) * k * g], c);
  ell(tor, [0, W + (S - W) * 0.67, -0.008 * k], [(o.fem ? 0.138 : 0.158) * k * g, (S - W) * 0.44, 0.108 * k * g], c);
  for (const sx of [1, -1]) {
    if (o.fem) ell(tor, [sx * 0.058 * k * g, W + (S - W) * 0.64, 0.07 * k * g], [0.06 * k * g, 0.056 * k, 0.052 * k], c, { rot: [0.2, sx * 0.25, 0] });
    else ell(tor, [sx * 0.07 * k * g, W + (S - W) * 0.77, 0.055 * k * g], [0.072 * k * g, 0.05 * k, 0.04 * k], c);
    ell(tor, [sx * (J.shoulder[0] - 0.005), S - 0.015 * k, -0.02 * k], [0.062 * k * g, 0.064 * k, 0.064 * k * g], c);
    cap(tor, [sx * 0.035 * k, J.neck[1] - 0.045 * k, -0.035 * k], [sx * (J.shoulder[0] - 0.03), S + 0.015 * k, -0.03 * k], 0.05 * k * g, 0.042 * k * g, c);
    ell(tor, [sx * 0.075 * k * g, W + (S - W) * 0.82, -0.075 * k * g], [0.065 * k * g, 0.085 * k, 0.04 * k], c);
  }
  cap(tor, [0, S + 0.01 * k, -0.022 * k], [0, J.neck[1] + 0.015 * k, -0.01 * k], 0.054 * k * g, 0.047 * k * g, c);
  // arm and hand
  const arm = rb.pm('arm_l', 'torso', J.shoulder);
  ell(arm, add3(J.shoulder, [0.006, -0.01, 0]), [0.058 * k * g, 0.062 * k, 0.06 * k * g], c);
  cap(arm, J.shoulder, J.elbow, 0.052 * k * g, 0.04 * k * g, c);
  ell(arm, lerp3(J.shoulder, J.elbow, 0.45), [0.046 * k * g, 0.072 * k, 0.048 * k * g], c, { rot: [0, 0, 0.05] });
  const fore = rb.pm('fore_l', 'arm_l', J.elbow);
  ell(fore, J.elbow, [0.038 * k * g, 0.038 * k, 0.038 * k * g], c);
  cap(fore, J.elbow, J.wrist, 0.042 * k * g, 0.028 * k * g, c);
  ell(fore, lerp3(J.elbow, J.wrist, 0.28), [0.046 * k * g, 0.072 * k, 0.042 * k * g], c);
  const Wr = J.wrist;
  if (o.hand === 'paw') {
    // a lion's forepaw: a broad pad, four toes, dark claws
    ell(fore, add3(Wr, [0.004, -0.05 * k, 0.012 * k]), [0.036 * k * g, 0.056 * k, 0.05 * k * g], c);
    for (let t = 0; t < 4; t++) {
      const z = (-0.03 + t * 0.022) * k * g;
      ell(fore, add3(Wr, [0.004, -0.1 * k, z + 0.024 * k]), [0.016 * k * g, 0.022 * k, 0.014 * k * g], c);
      cap(fore, add3(Wr, [0.004, -0.112 * k, z + 0.032 * k]), add3(Wr, [0.002, -0.128 * k, z + 0.042 * k]), 0.006 * k, 0.002, 0x2a2018);
    }
  } else {
    ell(fore, add3(Wr, [0.003, -0.055 * k, 0.004]), [0.02 * k * g, 0.05 * k, 0.04 * k * g], c);
    ell(fore, add3(Wr, [0, -0.11 * k, 0.012 * k]), [0.017 * k * g, 0.04 * k, 0.036 * k * g], c, { rot: [-0.25, 0, 0] });
    cap(fore, add3(Wr, [-0.008 * k, -0.03 * k, 0.03 * k]), add3(Wr, [-0.014 * k, -0.075 * k, 0.046 * k]), 0.012 * k * g, 0.009 * k * g, c);
  }
  // leg and foot
  const th = rb.pm('thigh_l', 'pelvis', J.hip);
  cap(th, J.hip, J.knee, 0.088 * k * g, 0.056 * k * g, c);
  ell(th, lerp3(J.hip, J.knee, 0.35), [0.078 * k * g, (J.hip[1] - J.knee[1]) * 0.36, 0.08 * k * g], c, { rot: [0.04, 0, 0] });
  const sh = rb.pm('shin_l', 'thigh_l', J.knee);
  ell(sh, add3(J.knee, [0, 0, 0.012]), [0.054 * k * g, 0.052 * k, 0.052 * k * g], c);
  cap(sh, J.knee, J.ankle, 0.05 * k * g, 0.032 * k * g, c);
  ell(sh, add3(lerp3(J.knee, J.ankle, 0.27), [0.004, 0, -0.03 * k]), [0.052 * k * g, (J.knee[1] - J.ankle[1]) * 0.27, 0.052 * k * g], c);
  const A = J.ankle;
  if (o.foot === 'paw') {
    ell(sh, add3(A, [0, -0.045 * k, 0.03 * k]), [0.06 * k * g, 0.045 * k, 0.085 * k * g], c);
    for (let t = 0; t < 4; t++) {
      const x = (-0.036 + t * 0.024) * k * g;
      ell(sh, add3(A, [x, -0.06 * k, 0.11 * k]), [0.016 * k, 0.024 * k, 0.02 * k], c);
      cap(sh, add3(A, [x, -0.07 * k, 0.125 * k]), add3(A, [x, -0.082 * k, 0.142 * k]), 0.006 * k, 0.002, 0x2a2018);
    }
  } else {
    ell(sh, add3(A, [0, -0.04 * k, -0.035 * k]), [0.034 * k * g, 0.04 * k, 0.04 * k], c, { keep: (_x, ly) => ly > -0.95 });
    tube(sh, [add3(A, [0, -0.045 * k, -0.02 * k]), add3(A, [0.004, -0.058 * k, 0.07 * k]), add3(A, [0.008, -0.066 * k, 0.165 * k])], (t) => (0.038 - t * 0.012) * k * g, c);
    if (o.foot === 'sandal') {
      // a papyrus sandal: the sole under the foot, a toe thong and an ankle strap
      ell(sh, add3(A, [0.004, -0.078 * k, 0.06 * k]), [0.05 * k * g, 0.009 * k, 0.13 * k], 0xc89a58, { keep: (_x, ly) => ly < 0.6 });
      cap(sh, add3(A, [0.004, -0.05 * k, 0.12 * k]), add3(A, [0.004, -0.03 * k, 0.02 * k]), 0.006 * k, 0.006 * k, 0x8a5a2a);
    }
  }
  return J;
}

// ====================================================================== dress
/** a pleated wrap kilt (shendyt) from the waist to above the knee, with its front tab */
function kilt(rb: RBm, J: Jt, base: number, crease: number, hemK = 0.55, belt = GOLD) {
  const pel = rb.sc('pelvis'), k = J.k, g = J.g;
  const top = J.waist[1] + 0.02 * k, hem = J.hip[1] - (J.hip[1] - J.knee[1]) * hemK;
  const col = cloth(base, crease, 4, 'x', 3);
  for (let y = hem; y <= top; y += MYTH_VS) {
    const t = (top - y) / (top - hem);
    const rx = (0.15 + t * 0.07) * k * g, rz = (0.11 + t * 0.06) * k * g;
    ell(pel, [0, y, 0.004 * k], [rx, MYTH_VS * 0.7, rz], col);
  }
  // the front tab: a starched trapezoid hanging from the belt
  ell(pel, [0, (top + hem) / 2 + 0.02 * k, 0.15 * k * g], [0.07 * k, (top - hem) * 0.46, 0.022 * k], mulRGB(base, 1.06), { keep: (lx, ly) => Math.abs(lx) < 0.55 + (1 - ly) * 0.25 });
  ell(pel, [0, top - 0.01 * k, 0.004 * k], [0.16 * k * g, 0.022 * k, 0.118 * k * g], metal(belt, 2));
}
/** a long sheath dress from under the chest to the ankles, flaring a little to the hem */
function sheath(rb: RBm, J: Jt, col: CSpec, straps: number) {
  const pel = rb.sc('pelvis'), tor = rb.sc('torso'), k = J.k, g = J.g;
  const top = J.waist[1] + 0.03 * k, hem = J.ankle[1] + 0.02 * k;
  for (let y = hem; y <= top; y += MYTH_VS) {
    const t = (top - y) / (top - hem);
    const rx = (0.168 + t * 0.06 - Math.sin(t * Math.PI) * 0.01) * k * g, rz = (0.122 + t * 0.05) * k * g;
    ell(pel, [0, y, 0.004 * k], [rx, MYTH_VS * 0.7, rz], col);
  }
  ell(tor, [0, J.waist[1] + 0.1 * k, 0.004 * k], [0.142 * k * g, 0.12 * k, 0.108 * k * g], col);
  for (const sx of [1, -1]) cap(tor, [sx * 0.07 * k * g, J.waist[1] + 0.2 * k, 0.07 * k], [sx * 0.09 * k * g, J.shoulder[1] + 0.01 * k, -0.01 * k], 0.016 * k, 0.014 * k, straps);
}
/** the broad usekh collar: concentric bead bands round the neck over the chest and shoulders */
function usekh(rb: RBm, J: Jt, rIn: number, rOut: number, cols: number[]) {
  const tor = rb.sc('torso'), k = J.k, g = J.g;
  const c: M3 = [0, J.shoulder[1] + 0.02 * k, -0.012 * k];
  const bw = (rOut - rIn) / cols.length;
  ell(tor, c, [rOut * g * 1.05, 0.09 * k, rOut * 0.82 * g], (i, j, kk) => {
    const x = vsM(i) - c[0], z = vsM(kk) - c[2];
    const r = Math.hypot(x / g, z / (0.82 * g));
    if (r < rIn) return null;
    const band = Math.min(cols.length - 1, Math.floor((r - rIn) / bw));
    const bead = (i + kk + j) % 3 === 0 ? 0.86 : 1;
    return mulRGB(cols[band], bead);
  }, { keep: (_lx, ly) => ly > -0.55 && ly < 0.6 });
}
/** a ring of metal round a limb (armlet, bracelet, anklet) */
function band(s: Sc, a: M3, b: M3, r: number, col = GOLD) {
  cap(s, a, b, r, r, metal(col, 1));
}
/** a tall feather plume standing up from `at`, banded, with its quill rib */
function plume(s: Sc, at: M3, h: number, w: number, cols: number[], lean = 0) {
  const tip: M3 = [at[0] + lean, at[1] + h, at[2]];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, p = lerp3(at, tip, t);
    const ww = w * Math.sin(Math.min(1, t * 1.15 + 0.1) * Math.PI * 0.92) + MYTH_VS;
    ell(s, p, [ww, h / 22, w * 0.3], (_i, j) => cols[Math.max(0, Math.floor((vsM(j) - at[1]) / (h / 6))) % cols.length]);
  }
  cap(s, at, tip, MYTH_VS * 0.9, MYTH_VS * 0.6, mulRGB(cols[0], 0.7));
}

// ====================================================================== the gods
const cache = new Map<string, RigSpec>();
function memo(key: string, make: () => RigSpec) {
  let r = cache.get(key);
  if (!r) cache.set(key, (r = make()));
  return r;
}
function finish(rb: RBm, meta: Record<string, unknown>) {
  realFinish(rb, 0.8, true);
  return rb.build(meta);
}
/** a held prop part on the right hand (made after the mirror, so it stays one-sided) */
function heldR(rb: RBm, J: Jt) {
  const w: M3 = [-J.wrist[0], J.wrist[1] - 0.08 * J.k, J.wrist[2] + 0.03 * J.k];
  return { s: rb.pm('held', 'fore_r', w), w };
}

/** BES: the jolly dwarf protector, terror of snakes and bandits */
export function besRig(): RigSpec {
  return memo('bes', () => {
    const rb = new RBm('myth_bes', MYTH_VS);
    const skin = tonal(0xc0844a, 0xd89a5c, 0x8e5a30, 0.08, 4);
    const J = body(rb, { H: 1.22, legs: 0.62, tor: 0.92, arms: 0.84, g: 1.32, belly: 1.25, skin, foot: 'bare' });
    const k = J.k;
    // the lion skin: a short kilt of tawny hide with a spotted belt, its tail behind
    kilt(rb, J, 0xc89a4a, 0x8a6228, 0.4, 0x8a4a22);
    const tail = rb.pm('tail', 'pelvis', [0, J.hip[1] + 0.02 * k, -0.15 * k]);
    tube(tail, [[0, J.hip[1] + 0.02 * k, -0.15 * k], [0.02, J.hip[1] - 0.12 * k, -0.24 * k], [0.04, J.knee[1] - 0.05 * k, -0.22 * k], [0.03, J.ankle[1] + 0.08, -0.12 * k]], (t) => (0.03 - t * 0.012) * k * 1.3, fur(0xc89a4a, 0xe0b870, 0x8a6228, MYTH_VS, 2));
    ell(tail, [0.03, J.ankle[1] + 0.06, -0.11 * k], [0.03, 0.05, 0.03], fur(0x5a3418, 0x7a4a22, 0x2a160c, MYTH_VS, 3));
    // the head: broad, leonine, the mane round it like a sunburst
    const hc: M3 = [0, J.neck[1] + 0.17 * k, 0.01];
    const hd = rb.pm('head', 'torso', J.neck);
    ell(hd, hc, [0.125, 0.12, 0.115], skin);
    ell(hd, add3(hc, [0, -0.035, 0.06]), [0.1, 0.075, 0.075], skin);
    ell(hd, add3(hc, [0, 0.03, 0.098]), [0.09, 0.022, 0.03], mulRGB(0xc0844a, 0.92)); // heavy brow
    ell(hd, add3(hc, [0, -0.02, 0.125]), [0.042, 0.034, 0.034], mulRGB(0xc0844a, 0.96)); // the broad flat nose
    for (const sx of [1, -1]) {
      ell(hd, add3(hc, [sx * 0.022, -0.035, 0.145]), [0.011, 0.008, 0.01], 0x3a1e10, { carve: false });
      ell(hd, add3(hc, [sx * 0.062, -0.03, 0.1]), [0.035, 0.03, 0.03], skin); // puffed cheeks
      // round lion ears high in the mane
      ell(hd, add3(hc, [sx * 0.13, 0.085, -0.01]), [0.032, 0.036, 0.016], skin, { rot: [0, sx * 0.4, sx * 0.3] });
      ell(hd, add3(hc, [sx * 0.13, 0.085, 0.002]), [0.016, 0.022, 0.008], 0x8a4a3a, { rot: [0, sx * 0.4, sx * 0.3] });
    }
    const mane = fur(0x8a4a1a, 0xb8702a, 0x4a2410, MYTH_VS, 7, 'y');
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const r = 0.14 + hash3(i, 2, 9) * 0.02;
      ell(hd, add3(hc, [Math.sin(a) * r, Math.cos(a) * r * 0.95 + 0.005, -0.01 - Math.abs(Math.sin(a)) * 0.02]), [0.042, 0.042, 0.05], mane, { rot: [0, 0, -a] });
    }
    mammalEye(rb, 'eye_l', 'head', add3(hc, [0.042, 0.005, 0.104]), 0.019, [0.25, 0, 1], { iris: 0xd8a030 });
    // the jaw: grinning mouth, the tongue out over a curled beard
    const jw = rb.pm('jaw', 'head', add3(hc, [0, -0.045, 0.02]));
    ell(jw, add3(hc, [0, -0.075, 0.085]), [0.07, 0.03, 0.05], skin);
    ell(jw, add3(hc, [0, -0.07, 0.125]), [0.05, 0.012, 0.012], 0x5a1a10);
    tube(jw, [add3(hc, [0, -0.075, 0.13]), add3(hc, [0, -0.11, 0.15]), add3(hc, [0.004, -0.14, 0.145])], (t) => 0.026 - t * 0.006, 0xd05a5a);
    for (let i = 0; i < 9; i++) {
      const x = (i - 4) * 0.022, d = 1 - Math.abs(i - 4) / 5;
      tube(jw, [add3(hc, [x, -0.09, 0.09]), add3(hc, [x * 1.1, -0.14 - d * 0.05, 0.1]), add3(hc, [x * 0.9 + 0.01, -0.18 - d * 0.08, 0.08])], (t) => 0.02 - t * 0.008, mane);
    }
    // the crown: a modius and five tall plumes
    const cr = rb.pm('crown', 'head', add3(hc, [0, 0.12, 0]));
    cap(cr, add3(hc, [0, 0.105, 0]), add3(hc, [0, 0.15, 0]), 0.075, 0.085, metal(GOLD, 3));
    for (let i = 0; i < 5; i++) plume(cr, add3(hc, [(i - 2) * 0.036, 0.15, 0.004]), 0.34 - Math.abs(i - 2) * 0.04, 0.02, [0x2a6ab0, 0xe8d6a8, 0x2a8a5a, 0xc83a2a], (i - 2) * 0.03);
    band(rb.sc('arm_l'), lerp3(J.shoulder, J.elbow, 0.28), lerp3(J.shoulder, J.elbow, 0.36), 0.058 * k * J.g);
    band(rb.sc('fore_l'), lerp3(J.elbow, J.wrist, 0.82), lerp3(J.elbow, J.wrist, 0.92), 0.04 * k * J.g, 0x3aa8a0);
    rb.mirrorLR();
    // the frame drum in his left hand, the curved snake knife in his right
    const L: M3 = [J.wrist[0], J.wrist[1] - 0.09 * k, J.wrist[2] + 0.05];
    const drum = rb.pm('drum', 'fore_l', L);
    ell(drum, add3(L, [0.05, 0, 0.04]), [0.02, 0.14, 0.14], (i, j, kk) => { const r = Math.hypot(vsM(j) - L[1], vsM(kk) - L[2] - 0.04); return r > 0.122 ? 0x8a5a2a : mix(0xe8d0a0, 0xc8a870, noise.n3(i * 0.3, j * 0.3, kk * 0.3) * 0.5 + 0.5); }, { rot: [0, 0, 0.2] });
    const { s: kn, w } = heldR(rb, J);
    cap(kn, add3(w, [0, 0.02, 0]), add3(w, [0, -0.05, 0.02]), 0.016, 0.014, 0x5a3418);
    tube(kn, [add3(w, [0, -0.05, 0.03]), add3(w, [0, -0.02, 0.15]), add3(w, [0, 0.08, 0.22]), add3(w, [0, 0.18, 0.2])], (t) => 0.018 * (1 - t * 0.85) + 0.004, metal(0xd8d8d0, 4));
    return finish(rb, { height: 1.22 + 0.36, hatTop: 1.6, radius: 0.36, hipY: J.hip[1], shoulderY: J.shoulder[1], eye: hc, talk: 'jaw' });
  });
}

/** TAWERET: the hippo mother, who keeps the cradle and bites the dark */
export function taweretRig(): RigSpec {
  return memo('taweret', () => {
    const rb = new RBm('myth_taweret', MYTH_VS);
    const skin = leather(0x8a7280, 0xa88c96, 0x5a4652, MYTH_VS, 3);
    const J = body(rb, { H: 2.0, fem: true, legs: 0.86, g: 1.42, belly: 1.5, skin, hand: 'paw', foot: 'paw' });
    const k = J.k;
    // a linen wrap round the hips and the broad collar
    kilt(rb, J, LINEN, 0xc8b898, 0.45, GOLD);
    usekh(rb, J, 0.06 * k, 0.2 * k, [GOLD, TURQ, CARN, LAPIS, GOLD]);
    // the crocodile down her back: a ridged hide from the neck to a heavy tail on the ground
    const tor = rb.sc('torso'), croc = 0x4a5a3a;
    tube(tor, [[0, J.neck[1], -0.1 * k], [0, J.shoulder[1] - 0.1 * k, -0.17 * k * J.g], [0, J.waist[1], -0.17 * k * J.g]], () => 0.07 * k, leather(croc, 0x6a7a4a, 0x2a3420, MYTH_VS, 5));
    for (let i = 0; i < 9; i++) ell(tor, [0, J.neck[1] - i * 0.06 * k, -0.235 * k - Math.sin(i / 3) * 0.02], [0.02, 0.026, 0.024], 0x3a4a2a);
    const tail = rb.pm('tail', 'pelvis', [0, J.hip[1], -0.16 * k]);
    tube(tail, [[0, J.hip[1], -0.16 * k], [0, J.knee[1], -0.3 * k], [0.04, 0.08, -0.46 * k], [0.12, 0.05, -0.72 * k]], (t) => (0.1 - t * 0.085) * k * 1.3, leather(croc, 0x6a7a4a, 0x2a3420, MYTH_VS, 6));
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      ell(tail, [0.03 + t * 0.09, J.hip[1] * (1 - t) + 0.1 * t + 0.08, -0.2 * k - t * 0.5 * k], [0.018, 0.024, 0.02], 0x3a4a2a);
    }
    // the head: a hippo's huge muzzle, nostrils and eyes on top, little ears
    const hc: M3 = [0, J.neck[1] + 0.16 * k, 0.03 * k];
    const hd = rb.pm('head', 'torso', J.neck);
    ell(hd, hc, [0.15, 0.14, 0.15], skin);
    ell(hd, add3(hc, [0, -0.02, 0.17]), [0.16, 0.12, 0.15], skin);
    for (const sx of [1, -1]) {
      ell(hd, add3(hc, [sx * 0.065, 0.07, 0.28]), [0.035, 0.03, 0.03], skin); // nostril mounds
      ell(hd, add3(hc, [sx * 0.065, 0.098, 0.29]), [0.013, 0.008, 0.012], 0x2a1a20);
      ell(hd, add3(hc, [sx * 0.085, 0.11, 0.07]), [0.04, 0.04, 0.04], skin); // eye turrets
      ell(hd, add3(hc, [sx * 0.11, 0.15, -0.04]), [0.025, 0.03, 0.016], skin, { rot: [0, sx * 0.3, 0] }); // ears
      ell(hd, add3(hc, [sx * 0.11, 0.15, -0.032]), [0.012, 0.018, 0.008], 0xc87a8a, { rot: [0, sx * 0.3, 0] });
    }
    paint(hd, (x, y, z) => z > hc[2] + 0.2 && y < hc[1] - 0.04, mulRGB(0xc89aa0, 0.95)); // the pink lip
    mammalEye(rb, 'eye_l', 'head', add3(hc, [0.092, 0.122, 0.095]), 0.018, [0.4, 0.3, 1], { iris: 0x8a4a1a });
    const jw = rb.pm('jaw', 'head', add3(hc, [0, -0.06, 0.04]));
    ell(jw, add3(hc, [0, -0.11, 0.18]), [0.15, 0.05, 0.13], skin);
    for (const sx of [1, -1]) cap(jw, add3(hc, [sx * 0.1, -0.08, 0.27]), add3(hc, [sx * 0.105, -0.02, 0.29]), 0.016, 0.006, 0xf0e6cc); // tusks
    // the wig: a tripartite black wig, two lappets over the shoulders; the modius and two plumes
    const wig = (i: number, j: number) => ((i + j * 2) % 4 === 0 ? 0x1a1a2a : 0x0e0e18);
    ell(hd, add3(hc, [0, 0.07, -0.06]), [0.17, 0.12, 0.14], wig, { keep: (_x, ly, lz) => lz < 0.3 || ly > 0.4 });
    for (const sx of [1, -1]) tube(hd, [add3(hc, [sx * 0.15, 0.06, 0]), add3(hc, [sx * 0.17, -0.1, 0.03]), add3(hc, [sx * 0.16, -0.26, 0.06])], (t) => 0.06 - t * 0.012, wig);
    tube(hd, [add3(hc, [0, 0.05, -0.15]), add3(hc, [0, -0.15, -0.18]), add3(hc, [0, -0.32, -0.16])], (t) => 0.11 - t * 0.03, wig);
    const cr = rb.pm('crown', 'head', add3(hc, [0, 0.17, -0.02]));
    cap(cr, add3(hc, [0, 0.16, -0.02]), add3(hc, [0, 0.22, -0.02]), 0.085, 0.095, metal(GOLD, 2));
    for (const sx of [1, -1]) plume(cr, add3(hc, [sx * 0.034, 0.22, -0.02]), 0.36, 0.03, [0xe8e0c8, 0x2a4a9a, 0xe8e0c8, 0xc8a040], sx * 0.02);
    ell(cr, add3(hc, [0, 0.27, 0.02]), [0.075, 0.075, 0.02], metal(0xd83a20, 5));
    band(rb.sc('fore_l'), lerp3(J.elbow, J.wrist, 0.78), lerp3(J.elbow, J.wrist, 0.9), 0.05 * k * J.g);
    rb.mirrorLR();
    // the sa knot of protection in her right paw: a looped linen cord tied over a staff
    const { s, w } = heldR(rb, J);
    rope(s, loopPts(add3(w, [0, 0.26, 0.08]), 0.07, 0.1, 'xy', 20, 0.02, 3), 0.014, [0xf0e6cc, 0xc8b898], { closed: true });
    cap(s, add3(w, [0, 0.16, 0.08]), add3(w, [0, -0.42, 0.1]), 0.018, 0.016, 0xf0e6cc);
    cap(s, add3(w, [-0.08, 0.15, 0.08]), add3(w, [0.08, 0.15, 0.08]), 0.016, 0.016, 0xf0e6cc);
    return finish(rb, { height: 2.0 + 0.5, hatTop: 2.5, radius: 0.55, hipY: J.hip[1], shoulderY: J.shoulder[1], eye: hc, talk: 'jaw' });
  });
}

/** HATHOR in her cow aspect: the lady of drink, dance and the western hills */
export function hathorRig(): RigSpec {
  return memo('hathor', () => {
    const rb = new RBm('myth_hathor', MYTH_VS);
    const skin = tonal(0xb8784a, 0xd09060, 0x8a5434, 0.08, 6);
    const J = body(rb, { H: 1.82, fem: true, skin, foot: 'sandal' });
    const k = J.k;
    // a red sheath with a net of faience beads, the menat collar
    const red: CSpec = (i, j, kk) => ((i + j) % 6 === 0 || (i - j + 600) % 6 === 0 ? (hash3(i, j, kk) > 0.5 ? TURQ : GOLD) : mulRGB(0xa82a22, 0.95 + hash3(i, j, kk) * 0.08));
    sheath(rb, J, red, GOLD);
    usekh(rb, J, 0.055 * k, 0.17 * k, [TURQ, GOLD, LAPIS, CARN, GOLD]);
    // the menat counterpoise down her back
    const tor = rb.sc('torso');
    cap(tor, [0, J.shoulder[1] + 0.02 * k, -0.11 * k], [0, J.shoulder[1] - 0.16 * k, -0.13 * k], 0.014, 0.014, metal(GOLD, 1));
    ell(tor, [0, J.shoulder[1] - 0.2 * k, -0.135 * k], [0.04, 0.06, 0.014], metal(GOLD_D, 2));
    // the cow head: a long dappled face, a wet nose, big gentle eyes, ears out to the sides
    const hc: M3 = [0, J.neck[1] + 0.15 * k, 0.02 * k];
    const coat: CSpec = (i, j, kk) => { const n = noise.n3(i * 0.06, j * 0.06, kk * 0.06); return n > 0.25 ? mix(0x6a3a1a, 0x8a5028, hash3(i, j, kk) * 0.4) : mix(0xf0e6d4, 0xe0d2b8, hash3(i, j, kk)); };
    const hd = rb.pm('head', 'torso', J.neck);
    ell(hd, hc, [0.1, 0.1, 0.1], coat);
    cap(hd, add3(hc, [0, 0.04, 0.04]), add3(hc, [0, -0.08, 0.19]), 0.085, 0.07, coat);
    ell(hd, add3(hc, [0, -0.09, 0.22]), [0.07, 0.05, 0.045], 0x5a3a3a); // the muzzle
    for (const sx of [1, -1]) {
      ell(hd, add3(hc, [sx * 0.028, -0.075, 0.262]), [0.014, 0.01, 0.008], 0x1a0e0e);
      ell(hd, add3(hc, [sx * 0.15, 0.04, -0.02]), [0.07, 0.022, 0.035], coat, { rot: [0, 0, sx * 0.35] }); // ears
      ell(hd, add3(hc, [sx * 0.15, 0.04, -0.008]), [0.05, 0.012, 0.018], 0xc88a7a, { rot: [0, 0, sx * 0.35] });
      // lyre horns: out, up and curling in, cradling the sun
      hornM(hd, add3(hc, [sx * 0.07, 0.09, -0.01]), [sx * 1, 0.25, 0], 0.32, 0.026, 0xe8dcc0, [-sx * 1.6, 2.4, 0]);
    }
    mammalEye(rb, 'eye_l', 'head', add3(hc, [0.07, 0.02, 0.07]), 0.024, [0.8, 0, 0.6], { iris: 0x3a1a0a });
    // long dark lashes over each eye
    for (const sx of [1, -1]) for (let i = 0; i < 4; i++) cap(hd, add3(hc, [sx * (0.07 + i * 0.008), 0.046, 0.066 + i * 0.006]), add3(hc, [sx * (0.09 + i * 0.01), 0.058, 0.08 + i * 0.006]), 0.004, 0.003, INK);
    const jw = rb.pm('jaw', 'head', add3(hc, [0, -0.08, 0.1]));
    ell(jw, add3(hc, [0, -0.13, 0.19]), [0.06, 0.03, 0.05], coat);
    // the sun disc between the horns, and its rearing cobra
    const cr = rb.pm('crown', 'head', add3(hc, [0, 0.16, 0]));
    ell(cr, add3(hc, [0, 0.28, -0.01]), [0.13, 0.13, 0.028], (i, j) => mix(0xd83a1a, 0xf0a030, Math.max(0, (vsM(j) - hc[1] - 0.2) * 4)));
    tube(cr, [add3(hc, [0, 0.16, 0.03]), add3(hc, [0, 0.2, 0.05]), add3(hc, [0, 0.25, 0.04])], (t) => 0.014 + t * 0.008, metal(GOLD, 3));
    ell(cr, add3(hc, [0, 0.262, 0.045]), [0.024, 0.026, 0.012], metal(GOLD, 3));
    band(rb.sc('fore_l'), lerp3(J.elbow, J.wrist, 0.85), lerp3(J.elbow, J.wrist, 0.95), 0.032 * k, TURQ);
    band(rb.sc('arm_l'), lerp3(J.shoulder, J.elbow, 0.3), lerp3(J.shoulder, J.elbow, 0.36), 0.05 * k);
    rb.mirrorLR();
    // the sistrum: a handle, a loop frame with rattling rods and discs
    const { s, w } = heldR(rb, J);
    cap(s, add3(w, [0, -0.02, 0]), add3(w, [0, 0.14, 0.03]), 0.012, 0.012, metal(GOLD, 1));
    rope(s, loopPts(add3(w, [0, 0.24, 0.035]), 0.05, 0.1, 'xy', 18, 0, 1).map((p) => [w[0], p[1], p[2] + p[0] - w[0]] as M3), 0.008, [GOLD, GOLD_D], { closed: true });
    for (let i = 0; i < 3; i++) cap(s, add3(w, [0, 0.19 + i * 0.045, -0.02]), add3(w, [0, 0.19 + i * 0.045, 0.09]), 0.005, 0.005, metal(0xd8d8d0, i));
    return finish(rb, { height: 2.2, hatTop: 2.2, radius: 0.34, hipY: J.hip[1], shoulderY: J.shoulder[1], eye: hc, talk: 'jaw' });
  });
}

/** KHNUM: the ram-headed potter, who throws every child on his wheel */
export function khnumRig(): RigSpec {
  return memo('khnum', () => {
    const rb = new RBm('myth_khnum', MYTH_VS);
    const skin = tonal(0x9a5a34, 0xb46c40, 0x6e3c20, 0.08, 8);
    const J = body(rb, { H: 1.86, skin, foot: 'sandal' });
    const k = J.k;
    // a clay-smeared kilt and a leather apron; clay up to the elbows
    kilt(rb, J, LINEN, 0xc0b090, 0.6, GOLD);
    const pel = rb.sc('pelvis');
    ell(pel, [0, J.hip[1] - 0.08 * k, 0.135 * k], [0.085 * k, 0.2 * k, 0.014 * k], leather(0x7a4a2a, 0x9a6438, 0x4a2a14, MYTH_VS, 2), { keep: (lx, ly) => Math.abs(lx) < 0.75 + ly * 0.2 });
    const clay: CSpec = (i, j, kk) => mix(0x8a6a5a, 0xa8887a, hash3(i, j, kk) * 0.6);
    paint(pel, (x, y, z) => z > 0.1 && noise.n3(x * 20, y * 20, z * 20) > 0.25, clay);
    paint(rb.sc('fore_l'), (x, y) => y < J.elbow[1] - 0.06 * k + noise.n3(x * 40, y * 40, 1) * 0.04, clay);
    usekh(rb, J, 0.055 * k, 0.15 * k, [LAPIS, GOLD, TURQ, GOLD]);
    // the ram head: a long Roman nose, a fleece crown, droopy ears, the plaited beard
    const hc: M3 = [0, J.neck[1] + 0.14 * k, 0.03];
    const fleece = fur(0xd8c8a8, 0xf0e4c8, 0x9a8a6a, MYTH_VS, 4, 'y');
    const hd = rb.pm('head', 'torso', J.neck);
    ell(hd, hc, [0.095, 0.105, 0.1], fleece);
    cap(hd, add3(hc, [0, 0.05, 0.05]), add3(hc, [0, -0.07, 0.18]), 0.07, 0.055, tonal(0xc8b494, 0xe0d0b0, 0x9a8868, 0.1, 2));
    ell(hd, add3(hc, [0, -0.085, 0.2]), [0.048, 0.04, 0.04], 0x6a5a4a);
    for (const sx of [1, -1]) {
      ell(hd, add3(hc, [sx * 0.018, -0.08, 0.235]), [0.009, 0.012, 0.006], 0x1a0e0a);
      ell(hd, add3(hc, [sx * 0.1, -0.01, 0.0]), [0.06, 0.018, 0.028], tonal(0xc8b494, 0xe0d0b0, 0x9a8868, 0.1, 3), { rot: [0.3, 0, sx * -0.7] }); // ears droop
      // the horns: long, flat and twisting straight out to the side (the old ram of Elephantine)
      const pts: M3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push(add3(hc, [sx * (0.06 + t * 0.38), 0.085 + Math.sin(t * Math.PI * 3) * 0.035, -0.02 + Math.cos(t * Math.PI * 3) * 0.03]));
      }
      tube(hd, pts, (t) => 0.034 * (1 - t * 0.8) + 0.004, (i: number, j: number, kk: number) => ((i + j + kk) % 5 === 0 ? 0x8a7a5a : mix(0xd8c8a0, 0xb8a47c, hash3(i, j, kk))));
    }
    mammalEye(rb, 'eye_l', 'head', add3(hc, [0.07, 0.03, 0.08]), 0.018, [0.8, 0, 0.6], { iris: 0xc8a020, pupil: 0x1a120a });
    const jw = rb.pm('jaw', 'head', add3(hc, [0, -0.08, 0.08]));
    ell(jw, add3(hc, [0, -0.115, 0.17]), [0.04, 0.025, 0.04], 0x8a7a6a);
    tube(jw, [add3(hc, [0, -0.11, 0.12]), add3(hc, [0, -0.2, 0.13]), add3(hc, [0, -0.27, 0.16]), add3(hc, [0, -0.28, 0.19])], (t) => 0.024 - t * 0.008, (i, j) => (j % 3 === 0 ? 0x3a2a1a : 0x1a120c));
    rb.mirrorLR();
    // a half-thrown pot on his left palm
    const L: M3 = [J.wrist[0], J.wrist[1] - 0.06 * k, J.wrist[2] + 0.08];
    const pot = rb.pm('pot', 'fore_l', L);
    for (let i = 0; i <= 14; i++) {
      const t = i / 14, r = 0.05 + Math.sin(t * Math.PI) * 0.05 - (t > 0.85 ? 0.02 : 0);
      ell(pot, add3(L, [0.02, -0.04 + t * 0.16, 0]), [r, 0.007, r], (ii, jj, kk) => mix(0x9a6a4a, 0xb88a62, ((jj * 7) % 5) / 5), { keep: (lx, _y, lz) => t < 0.1 || lx * lx + lz * lz > 0.55 });
    }
    return finish(rb, { height: 2.0, hatTop: 2.0, radius: 0.32, hipY: J.hip[1], shoulderY: J.shoulder[1], eye: hc, talk: 'jaw' });
  });
}

/** ISIS: the High Priestess, who tricked the sun out of his secret name */
export function isisRig(): RigSpec {
  return memo('isis', () => {
    const rb = new RBm('myth_isis', MYTH_VS);
    const skin = tonal(0xb87a52, 0xd0946a, 0x8a5636, 0.08, 9);
    const J = body(rb, { H: 1.78, fem: true, skin, foot: 'sandal' });
    const k = J.k;
    sheath(rb, J, cloth(0xf2ead8, 0xc8bca0, 5, 'x', 2), GOLD);
    usekh(rb, J, 0.055 * k, 0.16 * k, [LAPIS, GOLD, TURQ, CARN, GOLD]);
    // the knot of Isis (tyet): a red knot at the waist, its two ends down the front
    const pel = rb.sc('pelvis');
    ell(pel, [0, J.waist[1] - 0.01 * k, 0.13 * k], [0.035, 0.03, 0.025], 0xb8281e);
    for (const sx of [1, -1]) tube(pel, [[sx * 0.01, J.waist[1] - 0.03 * k, 0.14 * k], [sx * 0.03, J.hip[1] - 0.1 * k, 0.16 * k], [sx * 0.035, J.knee[1] + 0.05, 0.17 * k]], (t) => 0.016 - t * 0.004, 0xa8221a);
    // the face: high cheekbones, a straight nose, painted lips; kohl that wings out to the temples
    const hc: M3 = [0, J.neck[1] + 0.125 * k, 0.0];
    const hd = rb.pm('head', 'torso', J.neck);
    ell(hd, hc, [0.078, 0.096, 0.094], skin);
    ell(hd, add3(hc, [0, -0.05, 0.04]), [0.066, 0.068, 0.068], skin);
    ell(hd, add3(hc, [0, -0.1, 0.07]), [0.032, 0.028, 0.03], skin);
    cap(hd, add3(hc, [0, -0.01, 0.088]), add3(hc, [0, -0.05, 0.108]), 0.01, 0.015, skin);
    ell(hd, add3(hc, [0, -0.075, 0.093]), [0.024, 0.008, 0.01], 0x9a3a30);
    for (const sx of [1, -1]) {
      ell(hd, add3(hc, [sx * 0.045, -0.04, 0.072]), [0.026, 0.022, 0.024], skin);
      cap(hd, add3(hc, [sx * 0.05, 0.0, 0.082]), add3(hc, [sx * 0.082, 0.002, 0.05]), 0.004, 0.003, INK);
    }
    mammalEye(rb, 'eye_l', 'head', add3(hc, [0.03, 0.003, 0.08]), 0.012, [0.2, 0, 1], { iris: 0x3a2210, lid: INK });
    // the wig: long, black, banded with gold at the ends; the throne glyph on top
    const wig: CSpec = (i, j) => ((i + j * 3) % 5 === 0 ? 0x1c1c2c : 0x0e0e1a);
    ell(hd, add3(hc, [0, 0.03, -0.02]), [0.098, 0.105, 0.11], wig, { keep: (_x, ly, lz) => lz < 0.45 || ly > 0.55 });
    for (const sx of [1, -1]) {
      tube(hd, [add3(hc, [sx * 0.085, 0.0, 0.02]), add3(hc, [sx * 0.095, -0.15, 0.04]), add3(hc, [sx * 0.09, -0.28, 0.06])], (t) => 0.04 - t * 0.008, wig);
      ell(hd, add3(hc, [sx * 0.09, -0.27, 0.06]), [0.036, 0.016, 0.036], metal(GOLD, 2));
    }
    tube(hd, [add3(hc, [0, 0.02, -0.1]), add3(hc, [0, -0.2, -0.13]), add3(hc, [0, -0.36, -0.12])], (t) => 0.09 - t * 0.02, wig);
    const cr = rb.pm('crown', 'head', add3(hc, [0, 0.1, -0.01]));
    ell(cr, add3(hc, [0, 0.105, -0.01]), [0.07, 0.012, 0.07], metal(GOLD, 1));
    // the throne: a high back and a low seat, gold edged in lapis
    ell(cr, add3(hc, [0, 0.2, -0.05]), [0.05, 0.09, 0.022], (i, j) => (j % 5 === 0 ? LAPIS : GOLD));
    ell(cr, add3(hc, [0, 0.14, 0.02]), [0.05, 0.03, 0.06], (i, j, kk) => (kk % 5 === 0 ? LAPIS : GOLD));
    // the wings along her arms: banded feathers hanging back from the forearm
    const wing = rb.pm('wing_l', 'fore_l', J.elbow);
    const wc = [LAPIS, TURQ, GOLD, CARN, LAPIS, TURQ];
    for (let r = 0; r < 3; r++)
      for (let f = 0; f < 9; f++) {
        const t = f / 8;
        const root = add3(lerp3(add3(J.shoulder, [0.02, -0.02, 0]), add3(J.wrist, [0, -0.03, 0]), t), [0.03, 0, -0.03 - r * 0.03]);
        const len = (0.16 + r * 0.12) * (1 - t * 0.35);
        ell(wing, add3(root, [0.01, -len * 0.5, -0.06 - r * 0.02]), [0.008, len * 0.5, 0.035], wc[(f + r * 2) % wc.length], { rot: [0.35 + r * 0.12, 0, 0] });
      }
    band(rb.sc('fore_l'), lerp3(J.elbow, J.wrist, 0.85), lerp3(J.elbow, J.wrist, 0.95), 0.032 * k, GOLD);
    rb.mirrorLR();
    // the ankh in her right hand
    const { s, w } = heldR(rb, J);
    const gold = metal(GOLD, 2);
    cap(s, add3(w, [0, 0.02, 0.02]), add3(w, [0, -0.2, 0.06]), 0.012, 0.012, gold);
    cap(s, add3(w, [-0.055, 0.03, 0.025]), add3(w, [0.055, 0.03, 0.025]), 0.012, 0.012, gold);
    rope(s, loopPts(add3(w, [0, 0.09, 0.018]), 0.04, 0.055, 'xy', 18, 0, 2), 0.011, [GOLD, GOLD_D], { closed: true });
    return finish(rb, { height: 2.1, hatTop: 2.1, radius: 0.32, hipY: J.hip[1], shoulderY: J.shoulder[1], eye: hc, talk: 'jaw' });
  });
}

// ====================================================================== the serpent of the Island of the Ka
export const SERPENT_VS = 1 / 28;
export const SERPENT_SEGS = 6;
/**
 * The Shipwrecked Sailor's serpent: thirty cubits of gold scales banded in lapis, eyebrows of real lapis
 * lazuli and a beard two cubits long. A great coil on the sand (`coil`, root) and a rigged neck
 * seg1..seg6 rising out of it to the `head` (-> jaw, eye_l/eye_r). Faces +Z.
 */
export function serpentRig(): RigSpec {
  return memo('serpent', () => {
    const vs = SERPENT_VS;
    const rb = new RBm('myth_serpent', vs);
    const scales: CSpec = (i, j, kk) => {
      const u = Math.floor((i + j * 0.5) / 2), v = Math.floor((kk - j * 0.5) / 2);
      const ring = Math.floor(Math.hypot(i, kk) / 9 + j / 6) % 6 === 0;
      const base = ring ? mix(LAPIS, 0x4a6ac0, hash3(u, v, 2) * 0.5) : mix(0xe8b440, 0xc08a20, hash3(u, v, 1) * 0.7);
      return (u + v) % 2 === 0 ? mulRGB(base, 1.06) : base;
    };
    const belly = 0xf0dca0;
    const coil = rb.pm('coil', undefined, [0, 0, 0]);
    const pts: M3[] = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28, a = t * Math.PI * 3.2 + 0.4, r = 1.7 - t * 0.8;
      pts.push([Math.sin(a) * r, 0.34 + t * 0.42, Math.cos(a) * r - 0.2]);
    }
    tube(coil, pts, (t) => 0.4 - t * 0.06, scales);
    paint(coil, (_x, y) => y < 0.14, belly);
    // the neck: six segments rising from the coil's top
    let base: M3 = pts[pts.length - 1];
    const x0 = base[0];
    let parent = 'coil';
    const L = 0.46;
    for (let s = 1; s <= SERPENT_SEGS; s++) {
      const sc = rb.pm('seg' + s, parent, base);
      // the neck rises and swings round to the middle, so the head looks straight out over the coil
      const top: M3 = [x0 * (1 - s / SERPENT_SEGS), base[1] + L, base[2] + 0.12 * s];
      const r0 = 0.34 - s * 0.022, r1 = 0.34 - (s + 1) * 0.022;
      cap(sc, base, top, r0, r1, scales);
      paint(sc, (_x, _y, z) => z > top[2] + r1 * 0.55, belly);
      base = top;
      parent = 'seg' + s;
    }
    // the head: long and noble, gold, lapis brows, the beard
    const hc: M3 = [base[0], base[1] + 0.22, base[2] + 0.22];
    const hd = rb.pm('head', parent, base);
    ell(hd, hc, [0.3, 0.2, 0.42], scales);
    ell(hd, add3(hc, [0, 0.06, -0.12]), [0.26, 0.16, 0.26], scales);
    for (const sx of [1, -1]) {
      ell(hd, add3(hc, [sx * 0.16, 0.16, 0.1]), [0.1, 0.035, 0.14], mix(LAPIS, 0x6a8ae0, 0.2), { rot: [0.1, sx * 0.3, 0] });
      ell(hd, add3(hc, [sx * 0.08, 0.07, 0.38]), [0.025, 0.02, 0.02], 0x2a1a0a); // nostrils
    }
    mammalEye(rb, 'eye_l', 'head', add3(hc, [0.17, 0.1, 0.16]), 0.07, [0.7, 0.1, 0.7], { iris: 0xd8a020 });
    const jw = rb.pm('jaw', 'head', add3(hc, [0, -0.1, -0.15]));
    ell(jw, add3(hc, [0, -0.13, 0.1]), [0.24, 0.08, 0.32], scales);
    paint(jw, (_x, y) => y < hc[1] - 0.17, belly);
    tube(jw, [add3(hc, [0, -0.18, 0.12]), add3(hc, [0, -0.5, 0.2]), add3(hc, [0, -0.78, 0.18]), add3(hc, [0, -0.86, 0.26])], (t) => 0.08 - t * 0.04, (i, j) => (j % 3 === 0 ? 0x1a2a6a : LAPIS));
    rb.mirrorLR();
    realFinish(rb, 0.7, true);
    return rb.build({ height: 4.2, radius: 1.9, segs: SERPENT_SEGS, segLen: L, eye: hc, talk: 'jaw' });
  });
}

// ====================================================================== Mojo, the Fool's dog
export const DOG_VS = 1 / 120;
/**
 * A scruffy wire-haired desert terrier (an original mutt): a tan and grey brindle wiry coat with a
 * dark saddle, bushy brows and a beard, a carrot tail held high, one button ear with a torn notch, and a
 * faded red neckerchief. Rig: body (root) -> head -> jaw, ear_l/ear_r, eye_l/eye_r; leg_fl/fr/bl/br; tail.
 * Faces +Z, about 0.42 m at the head.
 */
export function terrierRig(): RigSpec {
  return memo('terrier', () => {
    const vs = DOG_VS;
    const rb = new RBm('myth_terrier', vs);
    const coat = (seed: number): CSpec => {
      const f = fur(0xb08a5a, 0xd0b080, 0x6a5038, vs, seed);
      return (i, j, kk) => {
        const c = f(i, j, kk) as number;
        const y = (j + 0.5) * vs, z = (kk + 0.5) * vs;
        if (y > 0.3 && z < 0.1 && z > -0.2) return mix(c, 0x5a5048, 0.6); // the dark saddle
        if (y < 0.18 && z > 0.05) return mix(c, 0xe8dcc4, 0.65); // pale chest and belly
        return (i * 3 + j * 5 + kk) % 11 === 0 ? mix(c, 0x3a3028, 0.5) : c; // brindle flecks
      };
    };
    const bodyC: M3 = [0, 0.26, -0.03];
    const b = rb.pm('body', undefined, bodyC);
    ell(b, [0, 0.27, -0.06], [0.085, 0.082, 0.17], coat(1));
    ell(b, [0, 0.27, 0.06], [0.08, 0.09, 0.08], coat(1));
    ell(b, [0, 0.34, 0.1], [0.06, 0.06, 0.07], coat(1)); // the neck
    lumpy(b.m, 3, 2, 4, 0.25);
    // the neckerchief, knotted on the left
    tube(b, loopPts([0, 0.35, 0.11], 0.066, 0.062, 'xz', 16, 0.03, 2), () => 0.014, (i, j) => ((i + j) % 4 === 0 ? 0xe8c8a0 : 0xa8281e));
    ell(b, [0.05, 0.31, 0.15], [0.025, 0.035, 0.012], 0xa8281e, { rot: [0.3, 0, 0.4] });
    // the head: a flat skull, a strong muzzle, the beard, the brows
    const hc: M3 = [0, 0.41, 0.15];
    const hd = rb.pm('head', 'body', [0, 0.36, 0.11]);
    ell(hd, hc, [0.062, 0.058, 0.064], coat(2));
    cap(hd, add3(hc, [0, -0.005, 0.03]), add3(hc, [0, -0.02, 0.11]), 0.046, 0.034, coat(3));
    ell(hd, add3(hc, [0, -0.008, 0.128]), [0.02, 0.016, 0.014], 0x1a1414);
    for (const sx of [1, -1]) {
      ell(hd, add3(hc, [sx * 0.028, 0.036, 0.05]), [0.024, 0.014, 0.02], fur(0x8a7258, 0xb09a78, 0x4a3a2a, vs, 5), { rot: [-0.3, sx * 0.3, 0] }); // brows
    }
    const beard = fur(0xd8ccb4, 0xf0e8d8, 0x9a8a70, vs, 6, 'y');
    ell(hd, add3(hc, [0, -0.05, 0.09]), [0.04, 0.032, 0.04], beard);
    lumpy(hd.m, 2, 2, 8, 0.25);
    mammalEye(rb, 'eye_l', 'head', add3(hc, [0.027, 0.018, 0.058]), 0.0105, [0.3, 0.05, 1], { iris: 0x4a2a12 });
    const jw = rb.pm('jaw', 'head', add3(hc, [0, -0.03, 0.03]));
    ell(jw, add3(hc, [0, -0.045, 0.085]), [0.03, 0.015, 0.04], beard);
    ell(jw, add3(hc, [0, -0.034, 0.1]), [0.018, 0.006, 0.02], 0xc8707a); // the tongue (for panting)
    const ear = rb.pm('ear_l', 'head', add3(hc, [0.042, 0.05, 0.0]));
    ell(ear, add3(hc, [0.05, 0.055, 0.025]), [0.026, 0.008, 0.032], coat(7), { rot: [0.7, 0, -0.3] }); // a button ear folded forward
    // legs: short, straight, wiry, with round paws
    const leg = (name: string, at: M3, back: boolean) => {
      const s = rb.pm(name, 'body', at);
      cap(s, at, [at[0], 0.06, at[2] + (back ? -0.01 : 0.005)], 0.026, 0.018, coat(back ? 9 : 8));
      if (back) ell(s, add3(at, [0, -0.04, -0.01]), [0.03, 0.06, 0.04], coat(9));
      ell(s, [at[0], 0.02, at[2] + 0.015], [0.024, 0.02, 0.032], fur(0xd8ccb4, 0xf0e8d8, 0x9a8a70, vs, 10));
      lumpy(s.m, 2, 1, 3, 0.3);
    };
    leg('leg_fl', [0.045, 0.24, 0.08], false);
    leg('leg_bl', [0.05, 0.25, -0.17], true);
    const tail = rb.pm('tail', 'body', [0, 0.33, -0.22]);
    tube(tail, [[0, 0.33, -0.22], [0, 0.4, -0.25], [0, 0.48, -0.24]], (t) => 0.022 - t * 0.012, coat(11));
    lumpy(tail.m, 2, 1, 5, 0.3);
    rb.mirrorLR();
    // the torn notch in the right ear
    cut(rb.sc('ear_r'), (x, _y, z) => x < -0.05 && Math.abs(z - (hc[2] + 0.03)) < 0.006);
    realFinish(rb, 0.7, true);
    return rb.build({ height: 0.47, radius: 0.18, eye: hc, talk: 'jaw' });
  });
}

// ====================================================================== static props
interface Stat {
  model: VoxelModel;
  voxelSize: number;
}
function stat(name: string, vs: number, draw: (s: Sc) => void): Stat {
  const m = new VoxelModel(name);
  draw(new Sc(m, vs));
  return { model: m, voxelSize: vs };
}
/** a lathe: stacked rings following a radius profile r(t), t 0 bottom .. 1 top */
function lathe(s: Sc, y0: number, h: number, r: (t: number) => number, col: CSpec, hollowTop = 0) {
  const n = Math.ceil(h / s.vs);
  for (let i = 0; i <= n; i++) {
    const t = i / n, rr = r(t);
    ell(s, [0, y0 + t * h, 0], [rr, s.vs * 0.7, rr], col, { keep: hollowTop && t > 1 - hollowTop ? (lx, _y, lz) => lx * lx + lz * lz > 0.5 : undefined });
  }
}
const statCache = new Map<string, Stat>();
function smemo(key: string, make: () => Stat) {
  let r = statCache.get(key);
  if (!r) statCache.set(key, (r = make()));
  return r;
}
export type TokenKind = 'beer' | 'clay' | 'wand' | 'osiris' | 'myrrh' | 'page' | 'gum';
/** a quest token as a static model (pivot bottom); `v` picks a variant (the pieces of Osiris) */
export function tokenModel(kind: TokenKind, v = 0): Stat {
  return smemo(kind + v, () => stat('myth_' + kind, 1 / 64, (s) => {
    const vs = s.vs;
    if (kind === 'beer') {
      // a fat beer jar of red-ochre beer, its mouth stopped with a clay sealing over a linen cloth
      lathe(s, 0, 0.42, (t) => 0.06 + Math.sin(Math.min(1, t * 1.25) * Math.PI) * 0.1 - (t > 0.85 ? 0.03 : 0), tonal(0xb86a3a, 0xd08850, 0x8a4a28, 0.15, 2));
      ell(s, [0, 0.44, 0], [0.07, 0.04, 0.07], 0x9a7a6a);
      ell(s, [0, 0.4, 0], [0.09, 0.03, 0.09], LINEN, { keep: (_x, ly) => ly > -0.3 });
      rope(s, loopPts([0, 0.39, 0], 0.085, 0.085, 'xz', 16, 0.02, 1), 0.008, [0xc8a870, 0x8a6a40], { closed: true });
      paint(s, (x, y, z) => y > 0.12 && y < 0.3 && Math.abs(Math.atan2(x, z)) < 0.5 && (Math.floor(y / 0.03) % 2 === 0), 0x8a1a10); // a red painted band of glyphs
      ell(s, [0.05, 0.43, 0.04], [0.02, 0.01, 0.02], 0xb8221a); // a red drip
    } else if (kind === 'clay') {
      // a slab of wet river clay, thumbed and folded
      ell(s, [0, 0.07, 0], [0.13, 0.07, 0.1], (i, j, k) => mix(0x6a5a52, 0x8a7a6e, noise.n3(i * 0.2, j * 0.2, k * 0.2) * 0.5 + 0.5));
      ell(s, [0.04, 0.12, 0.02], [0.07, 0.05, 0.06], 0x7a6a60);
      lumpy(s.m, 3, 2, 3, 0.2);
      for (let i = 0; i < 3; i++) ell(s, [-0.05 + i * 0.045, 0.14, 0.05], [0.016, 0.012, 0.02], null as any, { carve: true });
    } else if (kind === 'wand') {
      // an ivory birth wand: a flat crescent of hippo tusk carved with guardian creatures
      for (let i = 0; i <= 30; i++) {
        const t = i / 30, a = (t - 0.5) * 2.2;
        ell(s, [Math.sin(a) * 0.24, 0.03 + (1 - Math.cos(a)) * 0.05, 0], [0.018, 0.03 - Math.abs(t - 0.5) * 0.02, 0.012], (ii, j, k) => ((ii + j * 2) % 7 === 0 ? 0x5a4a3a : mix(0xf0e6cc, 0xd8c8a8, hash3(ii, j, k))));
      }
      ell(s, [0.24, 0.13, 0], [0.025, 0.03, 0.014], 0xf0e6cc); // a jackal head on one end
      ell(s, [-0.24, 0.13, 0], [0.028, 0.026, 0.014], 0xf0e6cc); // a lion head on the other
    } else if (kind === 'osiris') {
      // a piece of the god: green stone, gilded; four pieces, four shapes
      const green = tonal(0x2f6a4a, 0x4a8a60, 0x1e4a34, 0.2, v);
      if (v % 4 === 0) {
        // the white atef crown with its feathers
        lathe(s, 0, 0.36, (t) => 0.09 * (1 - t * 0.7) + 0.01, 0xf0ead8);
        for (const sx of [1, -1]) ell(s, [sx * 0.1, 0.2, 0], [0.025, 0.15, 0.02], (i, j) => (j % 4 === 0 ? 0x2a4a9a : 0xe8e0c8));
        ell(s, [0, 0.38, 0], [0.025, 0.025, 0.025], metal(GOLD, 1));
      } else if (v % 4 === 1) {
        // the crook
        tube(s, [[0, 0, 0], [0, 0.3, 0], [0.02, 0.4, 0], [0.08, 0.43, 0], [0.11, 0.38, 0]], () => 0.016, (i, j) => (j % 5 < 2 ? LAPIS : GOLD));
      } else if (v % 4 === 2) {
        // the flail with its three beaded tails
        cap(s, [0, 0, 0], [0, 0.3, 0], 0.014, 0.014, (i, j) => (j % 5 < 2 ? LAPIS : GOLD));
        for (let t = 0; t < 3; t++) tube(s, [[0, 0.3, 0], [0.06 + t * 0.02, 0.32, (t - 1) * 0.03], [0.1 + t * 0.02, 0.2, (t - 1) * 0.04]], () => 0.012, (i, j) => (j % 3 === 0 ? CARN : GOLD));
      } else {
        // a green stone hand
        ell(s, [0, 0.08, 0], [0.05, 0.08, 0.035], green);
        for (let f = 0; f < 4; f++) cap(s, [(f - 1.5) * 0.022, 0.15, 0.01], [(f - 1.5) * 0.024, 0.22 + (f === 1 || f === 2 ? 0.02 : 0), 0.025], 0.012, 0.01, green);
        cap(s, [0.05, 0.08, 0.01], [0.08, 0.14, 0.03], 0.012, 0.01, green);
        band(s, [0, 0.0, 0], [0, 0.02, 0], 0.052);
      }
    } else if (kind === 'myrrh') {
      // a linen bundle of myrrh and incense, bound with cord, golden resin tears showing
      ell(s, [0, 0.1, 0], [0.12, 0.1, 0.09], cloth(0xe8dcc0, 0xb8a888, 4, 'x', 1));
      ell(s, [0, 0.2, 0], [0.05, 0.05, 0.05], cloth(0xe8dcc0, 0xb8a888, 3, 'z', 2));
      rope(s, loopPts([0, 0.1, 0], 0.125, 0.095, 'xz', 16, 0.02, 2), 0.009, [0x8a6a40, 0x6a4a28], { closed: true });
      for (let i = 0; i < 5; i++) ell(s, [Math.sin(i * 2.4) * 0.1, 0.13 + hash3(i, 1, 1) * 0.06, Math.cos(i * 2.4) * 0.075], [0.016, 0.014, 0.016], mix(0xd88a20, 0xf0b040, hash3(i, 2, 2)));
    } else if (kind === 'page') {
      // a loose page of the Book of Thoth: papyrus, curling, inked in two colours with a trump drawn on it
      for (let i = -10; i <= 10; i++)
        for (let j = 0; j <= 28; j++) {
          const x = i * vs, y = 0.02 + j * vs, z = Math.pow(Math.abs(i) / 10, 2) * 0.05;
          const ink = (Math.abs(i) < 7 && j % 4 === 1 && hash3(i, j, 3) > 0.35) || (Math.abs(i) < 4 && j > 10 && j < 20 && hash3(i, j, 4) > 0.7);
          s.m.set(s.i(x), s.i(y), s.i(z), ink ? (j > 10 && j < 20 ? 0xa8221a : INK) : mix(0xe8d8a8, 0xd0bc88, hash3(i, j, 1)));
        }
    } else {
      // a pack of coffee gum: a paper wrapper, a coffee bean on its band, five sticks
      ell(s, [0, 0.04, 0], [0.07, 0.04, 0.025], (i, j) => (Math.abs(j - 3) < 1 ? 0xe8d8b0 : 0x5a3418));
      ell(s, [0, 0.045, 0.022], [0.018, 0.022, 0.006], 0x3a1e0e);
      cap(s, [0, 0.03, 0.026], [0, 0.06, 0.026], 0.003, 0.003, 0x8a5a2a);
      for (let i = 0; i < 2; i++) ell(s, [0.08 + i * 0.012, 0.03, 0], [0.006, 0.026, 0.02], 0xe8e0d0);
    }
  }));
}
/** shadow props (drawn black with the shadow material): an oar, a bow, a heavy book */
export function shadowProp(kind: 'oar' | 'bow' | 'book'): Stat {
  return smemo('sh' + kind, () => stat('myth_' + kind, 1 / 80, (s) => {
    const c = 0x16131a;
    if (kind === 'oar') {
      cap(s, [0, 0, 0], [0, 1.5, 0], 0.022, 0.018, c);
      ell(s, [0, 0.1, 0], [0.012, 0.24, 0.08], c, { keep: (_x, ly) => ly < 0.6 }); // the broken blade, splintered
      cut(s, (x, y, z) => y < 0.06 && Math.sin(z * 120) > 0.2);
    } else if (kind === 'bow') {
      tube(s, [[0, -0.55, 0.06], [0, -0.25, 0.0], [0, 0, -0.03], [0, 0.25, 0.0], [0, 0.55, 0.06]], (t) => 0.018 - Math.abs(t - 0.5) * 0.016, c);
      cap(s, [0, -0.55, 0.06], [0, 0.55, 0.06], 0.004, 0.004, c);
    } else {
      ell(s, [0, 0.0, 0], [0.13, 0.03, 0.17], c);
      ell(s, [0, 0.035, 0], [0.12, 0.012, 0.16], c);
    }
  }));
}
/** Khnum's potter's wheel: a stone kick wheel, the head with a fresh lump of clay, a water bowl */
export function potterWheel(): Stat {
  return smemo('wheel', () => stat('myth_wheel', 1 / 40, (s) => {
    const stone = tonal(0x9a8a72, 0xb8a888, 0x6a5a48, 0.2, 2);
    lathe(s, 0, 0.12, (t) => 0.34 - t * 0.04, stone);
    cap(s, [0, 0.12, 0], [0, 0.6, 0], 0.04, 0.035, tonal(0x6a4a2a, 0x8a6238, 0x4a2a14, 0.2, 1));
    lathe(s, 0.6, 0.06, () => 0.2, stone);
    lathe(s, 0.66, 0.16, (t) => 0.09 - t * 0.03 + Math.sin(t * 3) * 0.02, (i, j, k) => mix(0x7a6a5e, 0x9a8a7a, hash3(i, j, k)));
    lathe(s, 0, 0.1, (t) => 0.12 + t * 0.03, 0x8a6a4a, 0.4);
  }));
}
