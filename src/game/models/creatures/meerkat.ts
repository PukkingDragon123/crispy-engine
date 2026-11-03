// Meerkats (Suricata suricatta) for the meerkat colony: lean upright sentinels
// with tan fur, dark transverse back bands, a pale belly, dark eye patches
// around big glossy modelled eyes, small dark crescent ears and a black-tipped
// tail that props them up like a tripod. Everything is an organic implicit
// sculpt (smooth unions), every moving piece is its own rig part.
//
// The four Beatles of the burrow ("Sgt. Peppercorn's Lonely Burrows Club Band")
// wear marching-band jackets in lime, sky blue, scarlet and pink with gold
// frogging, fringed gold epaulettes, contrast collars and cuffs, mop-top
// fringes and moustaches, and each carries a tiny instrument. A loving homage:
// no logos, no likenesses — just meerkats.
//
// RIG (faces +Z, LEFT = +X, origin on the ground between the feet, 1/200 m):
//   hips (root) → chest → neck → head → jaw, ear_l/ear_r, eye_l/eye_r
//   chest → arm_l → paw_l, arm_r → paw_r (+ `instrument` on chest for the band)
//   hips → thigh_l → shin_l → foot_l (and _r); hips → tail1 → tail2 → tail3
// Rest pose = the natural sentinel stance (upright, forepaws in front of the
// belly, tail on the ground behind). meta.playPose holds the arm/paw rotations
// that put the band's paws on their instruments.
import { CRig, VoxelModel, VF, V3, RigSpec, Prim, blob, ell, cap, tube, line, paint, exposed, thicken, splitInto, frontSurface, mixc, mulc, n01, h01, fur, wetEye, rotXYZ, invXYZ, add3, sub3, scl3, dot3, cross3, norm3, lerp3, sstep, memoBy } from './ckit';

export type BeatleId = 'lime' | 'sky' | 'scarlet' | 'pink';
export type InstrumentKind = 'acoustic' | 'bass' | 'electric' | 'drum';

export interface BeatleInfo {
  id: BeatleId;
  name: string;
  jacket: number;
  trim: number;
  hair: number;
  stache: 'walrus' | 'neat' | 'handlebar' | 'droop';
  instrument: InstrumentKind;
}
export const BAND_NAME = "Sgt. Peppercorn's Lonely Burrows Club Band";
export const BEATLES: Record<BeatleId, BeatleInfo> = {
  lime: { id: 'lime', name: 'Meer Lennon', jacket: 0x9ccb3c, trim: 0xe0563f, hair: 0x5a3a20, stache: 'walrus', instrument: 'acoustic' },
  sky: { id: 'sky', name: 'Paul McBurrowny', jacket: 0x58a6e0, trim: 0xf2a636, hair: 0x4a2f1e, stache: 'neat', instrument: 'bass' },
  scarlet: { id: 'scarlet', name: 'George Harrisand', jacket: 0xe24c36, trim: 0x2a2630, hair: 0x6a4222, stache: 'handlebar', instrument: 'electric' },
  pink: { id: 'pink', name: 'Ringo Starrkat', jacket: 0xe45aa8, trim: 0xf4c63a, hair: 0x3e2a1c, stache: 'droop', instrument: 'drum' },
};
export const BEATLE_IDS: BeatleId[] = ['lime', 'sky', 'scarlet', 'pink'];

// ------------------------------------------------------------------ grid
const VS = 1 / 200;
/** design metres -> final metres (≈ 0.40 m standing) */
export const MEERKAT_K = 1.08;
const UNIT = MEERKAT_K / VS; // voxel units per design metre
const U = (m: number) => m * UNIT;
const P = (x: number, y: number, z: number): V3 => [x * UNIT, y * UNIT, z * UNIT];
const Pv = (v: V3): V3 => [v[0] * UNIT, v[1] * UNIT, v[2] * UNIT];
/** voxel index -> design metres at the cell centre */
const D = (i: number) => (i + 0.5) / UNIT;
const mirX = (v: V3): V3 => [-v[0], v[1], v[2]];

// ------------------------------------------------------------------ coats
interface Coat {
  tan: number;
  tanL: number;
  tanD: number;
  band: number;
  pale: number;
  paleD: number;
  crown: number;
  patch: number;
  ear: number;
  earIn: number;
  skin: number;
  claw: number;
  nose: number;
  tip: number;
}
const COATS: Coat[] = [
  // 0: classic warm tan
  { tan: 0xc99b62, tanL: 0xdab27b, tanD: 0xa67c4b, band: 0x684a2e, pale: 0xe2c595, paleD: 0xcdab7a, crown: 0xab7f4e, patch: 0x2a1b12, ear: 0x2c1f17, earIn: 0x4e3828, skin: 0x6c5242, claw: 0x231912, nose: 0x1b130f, tip: 0x1d1511 },
  // 1: cooler grey-fawn
  { tan: 0xbe9a6e, tanL: 0xd2b38c, tanD: 0x9a7a54, band: 0x5b4431, pale: 0xdcc6a0, paleD: 0xc4ab84, crown: 0xa07e58, patch: 0x281c14, ear: 0x2a1f18, earIn: 0x4a382a, skin: 0x665040, claw: 0x221a14, nose: 0x1a130f, tip: 0x1b1511 },
  // 2: rich russet (Mama Mim, the trader)
  { tan: 0xc6915a, tanL: 0xd9aa72, tanD: 0xa27144, band: 0x613f28, pale: 0xe6c592, paleD: 0xd0a874, crown: 0xa2703f, patch: 0x281910, ear: 0x2b1d14, earIn: 0x503626, skin: 0x6e5040, claw: 0x221810, nose: 0x1a120e, tip: 0x1c140f },
];

// ------------------------------------------------------------------ skeleton (design metres)
const J = {
  hips: [0, 0.125, -0.006] as V3,
  chest: [0, 0.192, -0.002] as V3,
  neck: [0, 0.287, 0.006] as V3,
  head: [0, 0.32, 0.012] as V3,
  jaw: [0, 0.3262, 0.033] as V3,
  ear: [0.0245, 0.3455, 0.004] as V3,
  eye: [0.0168, 0.3475, 0.0295] as V3,
  shoulder: [0.029, 0.263, 0.012] as V3,
  elbow: [0.033, 0.226, 0.024] as V3,
  wrist: [0.026, 0.207, 0.046] as V3,
  grip: [0.0255, 0.1985, 0.0505] as V3,
  hip: [0.024, 0.108, -0.01] as V3,
  knee: [0.03, 0.062, 0.014] as V3,
  ankle: [0.027, 0.018, -0.012] as V3,
  toe: [0.027, 0.0045, 0.042] as V3,
  tail1: [0, 0.098, -0.04] as V3,
  tail2: [0, 0.052, -0.078] as V3,
  tail3: [0, 0.016, -0.118] as V3,
  tailMid: [0, 0.0095, -0.163] as V3,
  tailTip: [0, 0.0125, -0.205] as V3,
};
const EYE_R = 0.0122;
/** cute head: the whole head is sculpted 17% larger about the head joint */
const HS = 1.17;
const HJ = J.head;
/** head design point -> voxel units (scaled about the head joint) */
const PH = (x: number, y: number, z: number): V3 => P(HJ[0] + (x - HJ[0]) * HS, HJ[1] + (y - HJ[1]) * HS, HJ[2] + (z - HJ[2]) * HS);
const RH = (x: number, y: number, z: number): V3 => P(x * HS, y * HS, z * HS);
const UH = (m: number) => U(m * HS);
/** voxel index -> unscaled head design coords */
const DX = (i: number) => HJ[0] + (D(i) - HJ[0]) / HS;
const DY = (j: number) => HJ[1] + (D(j) - HJ[1]) / HS;
const DZ = (k: number) => HJ[2] + (D(k) - HJ[2]) / HS;
/** head design height -> voxel row */
const rowH = (y: number) => U(HJ[1] + (y - HJ[1]) * HS);
const CUT_HC = 0.192; // hips | chest
const CUT_CN = 0.287; // chest | neck
const MOUTH_Y = 0.326; // jaw seam

/** play poses: arm/paw rotations that land the paws on each instrument */
const PLAY: Record<InstrumentKind, { arm_l: V3; arm_r: V3; paw_l: V3; paw_r: V3 }> = {
  acoustic: { arm_r: [-0.52, 0, 0.34], paw_r: [0.25, 0, 0], arm_l: [-1.02, 0, 0.3], paw_l: [0.5, 0, -0.2] },
  electric: { arm_r: [-0.52, 0, 0.34], paw_r: [0.25, 0, 0], arm_l: [-1.02, 0, 0.3], paw_l: [0.5, 0, -0.2] },
  bass: { arm_l: [-0.52, 0, -0.34], paw_l: [0.25, 0, 0], arm_r: [-1.02, 0, -0.3], paw_r: [0.5, 0, 0.2] },
  drum: { arm_l: [-0.62, 0, -0.1], paw_l: [0.55, 0, 0], arm_r: [-0.62, 0, 0.1], paw_r: [0.55, 0, 0] },
};

/** paw grip (design metres, rest frame) after posing arm + paw (forward kinematics) */
function gripAt(side: 1 | -1, arm: V3, paw: V3): V3 {
  const s = (v: V3) => (side > 0 ? v : mirX(v));
  const SH = s(J.shoulder), WR = s(J.wrist), G = s(J.grip);
  const wr = add3(SH, rotXYZ(sub3(WR, SH), arm));
  return add3(wr, rotXYZ(rotXYZ(sub3(G, WR), paw), arm));
}

// ------------------------------------------------------------------ colour fields
function torsoColour(cs: Coat, seed: number) {
  const tanF = fur(cs.tan, cs.tanL, cs.tanD, 2.6, seed, [1, 3.2, 1]);
  const paleF = fur(cs.pale, mixc(cs.pale, 0xffffff, 0.12), cs.paleD, 2.6, seed + 1, [1, 3.2, 1]);
  return (i: number, j: number, k: number) => {
    const X = D(i), Y = D(j), Z = D(k);
    const front = Math.cos(Math.atan2(X, Z - (Y > 0.2 ? 0.003 : 0)));
    const wob = (n01(i, j, k, 0.16, seed) - 0.5) * 0.32;
    let c = tanF(i, j, k);
    if (Y > 0.104 && Y < 0.292) {
      const narrow = Y < 0.13 ? (0.13 - Y) * 9 : 0; // tapers between the legs
      if (front + wob > 0.6 + narrow) c = paleF(i, j, k);
      else if (front + wob > 0.4 + narrow) c = mixc(c, cs.pale, 0.5);
    }
    // dark transverse back bands between the shoulder blades and the tail root
    if (front < -0.18 && Y > 0.112 && Y < 0.254) {
      const w = (n01(i, j * 0.5, k, 0.2, seed + 4) - 0.5) * 0.009 + Math.sin(X * 150 + seed) * 0.0022;
      const ph = ((((Y + w) / 0.0178) % 1) + 1) % 1;
      const fade = sstep(-0.18, -0.55, front) * (1 - sstep(0.238, 0.254, Y));
      if (ph < 0.46 * fade) c = mixc(c, cs.band, 0.88);
    }
    if (front < -0.8 && Y > 0.244) c = mixc(c, cs.band, 0.34); // darker spine streak to the nape
    return c;
  };
}

function headColour(cs: Coat, seed: number) {
  const tanF = fur(cs.tan, cs.tanL, cs.tanD, 2.2, seed + 7, [1, 1, 2.4]);
  const face = mixc(cs.pale, 0xf2e2c0, 0.5);
  const paleF = fur(face, mixc(face, 0xffffff, 0.15), cs.paleD, 2.2, seed + 8, [1, 1, 2.4]);
  return (i: number, j: number, k: number) => {
    const X = DX(i), Y = DY(j), Z = DZ(k), ax = Math.abs(X);
    const axis = 0.3375 - (Z - 0.03) * 0.146; // snout centre line height
    let c = tanF(i, j, k);
    if (Z > 0.027) {
      // muzzle: pale below, a soft tan bridge on top
      c = Y - axis > 0.0058 ? mixc(c, face, 0.34) : paleF(i, j, k);
    } else if (Y < 0.3405 && Z > 0.006) c = paleF(i, j, k); // cheeks + chin
    else if (Y < 0.334) c = mixc(c, face, 0.55); // throat sides
    if (Y > 0.355) c = mixc(c, cs.crown, 0.25 + sstep(0.355, 0.366, Y) * 0.55); // darker crown
    if (ax < 0.006 && Y > 0.35 && Z > 0.012) c = mixc(c, cs.crown, 0.35); // forehead streak
    return c;
  };
}

// ------------------------------------------------------------------ builder
export interface MeerkatOpts {
  /** coat variant: 0 classic, 1 grey-fawn, 2 russet (trader) */
  variant?: number;
  beatle?: BeatleId;
}

function buildMeerkat(o: MeerkatOpts): RigSpec {
  const variant = o.variant ?? 0;
  const B = o.beatle ? BEATLES[o.beatle] : null;
  const cs = COATS[variant % COATS.length];
  const seed = 3 + variant * 11 + (B ? BEATLE_IDS.indexOf(B.id) * 5 : 0);
  const rig = new CRig(B ? `meerkat_beatle_${B.id}` : `meerkat_${variant}`, VS);

  // ================================================================ torso (one sculpt, split at the joints)
  const torso = new VoxelModel('torso');
  const torsoPrims: Prim[] = [
    { c: P(0, 0.15, 0.002), r: P(0.041, 0.05, 0.038) }, // belly
    { c: P(0, 0.113, -0.012), r: P(0.043, 0.034, 0.037) }, // pelvis
    { c: P(0.026, 0.099, -0.008), r: P(0.023, 0.032, 0.029) }, // haunches
    { c: P(-0.026, 0.099, -0.008), r: P(0.023, 0.032, 0.029) },
    { c: P(0, 0.232, 0.002), r: P(0.036, 0.055, 0.033) }, // chest
    { c: P(0.022, 0.262, 0.002), r: P(0.019, 0.02, 0.024) }, // shoulders
    { c: P(-0.022, 0.262, 0.002), r: P(0.019, 0.02, 0.024) },
    { c: P(0, 0.276, 0.005), r: P(0.026, 0.02, 0.025) }, // upper chest
    { a: P(0, 0.278, 0.004), b: P(0, 0.33, 0.013), r0: U(0.0245), r1: U(0.0205) }, // neck
  ];
  blob(torso, torsoPrims, torsoColour(cs, seed), {
    k: U(0.012),
    disp: (x, y, z) => (n01(x, y, z, 0.34, seed + 2) - 0.5) * 0.7, // soft fur clumps, never spiky
    keep: (_x, y) => D(y) < 0.322,
  });
  const hips = rig.part('hips', undefined, P(...J.hips));
  const upper = new VoxelModel('upper');
  splitInto(torso, hips, upper, (_x, y) => D(y) >= CUT_HC, (_x, y) => D(y) >= CUT_HC - 0.012);
  const chest = rig.part('chest', 'hips', P(...J.chest));
  const neck = rig.part('neck', 'chest', P(...J.neck));
  splitInto(upper, chest, neck, (_x, y) => D(y) >= CUT_CN, (_x, y) => D(y) >= CUT_CN - 0.01);

  // ================================================================ head + jaw (one sculpt, split along the mouth)
  const headMass = new VoxelModel('headMass');
  const headPrims: Prim[] = [
    { c: PH(0, 0.343, 0.012), r: RH(0.026, 0.0235, 0.026) }, // cranium
    { c: PH(0.0125, 0.336, 0.028), r: RH(0.0155, 0.014, 0.017) }, // cheeks
    { c: PH(-0.0125, 0.336, 0.028), r: RH(0.0155, 0.014, 0.017) },
    { a: PH(0, 0.3375, 0.03), b: PH(0, 0.3315, 0.071), r0: UH(0.0148), r1: UH(0.0058) }, // snout
    { c: PH(0, 0.352, 0.026), r: RH(0.016, 0.008, 0.012) }, // brow
    { a: PH(0, 0.3238, 0.033), b: PH(0, 0.3248, 0.064), r0: UH(0.0076), r1: UH(0.0046) }, // lower jaw / chin
    { a: P(0, 0.326, 0.004), b: PH(0, 0.326, 0.02), r0: U(0.021), r1: UH(0.018) }, // neck join
  ];
  blob(headMass, headPrims, headColour(cs, seed), { k: UH(0.0082), disp: (x, y, z) => (n01(x, y, z, 0.42, seed + 5) - 0.5) * 0.45 });
  const head = rig.part('head', 'neck', P(...J.head));
  const jaw = rig.part('jaw', 'head', PH(...J.jaw));
  splitInto(headMass, head, jaw, (_x, y, z) => DY(y) < MOUTH_Y && DY(y) > 0.3165 && DZ(z) > 0.031);
  // mouth: dark lip line where the jaw meets the head on the outside, pink-brown inside
  const empty = (x: number, y: number, z: number) => !head.has(x, y, z) && !jaw.has(x, y, z);
  const jawTop: V3[] = [];
  jaw.forEach((x, y, z) => {
    if (!jaw.has(x, y + 1, z)) jawTop.push([x, y, z]);
  });
  for (const [x, y, z] of jawTop) jaw.set(x, y, z, empty(x + 1, y, z) || empty(x - 1, y, z) || empty(x, y, z + 1) ? 0x3a2418 : 0x8a4a40);
  head.forEach((x, y, z) => {
    if (jaw.has(x, y - 1, z) && !(empty(x + 1, y, z) || empty(x - 1, y, z) || empty(x, y, z + 1))) head.set(x, y, z, 0x5a2e26);
  });
  // nose: a dark, wet leather tip (glossy)
  ell(head, PH(0, 0.332, 0.0745), RH(0.0064, 0.005, 0.0044), cs.nose, { fl: VF.METAL });

  // ---- eyes: sockets carved into the face, glossy eyeballs as their own parts
  const eyeC = PH(...J.eye);
  for (const e of [eyeC, mirX(eyeC)]) ell(head, e, [UH(EYE_R) * 1.02, UH(EYE_R) * 1.02, UH(EYE_R) * 1.02], 0, { carve: true });
  // dark mascara patches around the eyes (slanting back toward the ears), painted on the face surface
  for (const s of [1, -1]) {
    const pc = PH(0.0185 * s, 0.3466, 0.0262);
    paint(head, (x, y, z) => {
      const p = invXYZ([x + 0.5 - pc[0], y + 0.5 - pc[1], z + 0.5 - pc[2]], [0, 0.35 * s, -0.25 * s]);
      return (p[0] / UH(0.0148)) ** 2 + (p[1] / UH(0.0125)) ** 2 + (p[2] / UH(0.015)) ** 2 <= 1;
    }, (x, y, z) => mixc(cs.patch, cs.tanD, h01(x, y, z, 3) < 0.12 ? 0.25 : 0));
  }
  const eyeL = rig.part('eye_l', 'head', eyeC);
  wetEye(eyeL, eyeC, UH(EYE_R), [0.34, 0.06, 1], { sclera: 0x1a100b, iris: 0x4c2c16, pupil: 0x060404, irisR: 0.9, pupilR: 0.55 });
  rig.mirror('eye_l', 'eye_r');

  // ---- small dark crescent ears, set low on the sides of the head
  {
    const ec = PH(0.0283, 0.346, 0.003);
    const ear = rig.part('ear_l', 'head', PH(...J.ear));
    ell(ear, ec, RH(0.0049, 0.0097, 0.009), (x, y, z) => (h01(x, y, z, 9) < 0.1 ? mixc(cs.ear, cs.tanD, 0.3) : cs.ear), { rot: [0, -0.35, 0.12] });
    // the cupped opening faces forward-out: a lighter inner fold
    const ic = add3(ec, RH(0.0022, 0, 0.003));
    paint(ear, (x, y, z) => (x + 0.5 - ic[0]) ** 2 / UH(0.003) ** 2 + (y + 0.5 - ic[1]) ** 2 / UH(0.0068) ** 2 + (z + 0.5 - ic[2]) ** 2 / UH(0.006) ** 2 <= 1, cs.earIn);
    ell(ear, add3(ic, RH(0.0016, 0, 0.0016)), RH(0.0024, 0.006, 0.0048), 0, { carve: true });
    rig.mirror('ear_l', 'ear_r');
  }

  // ================================================================ forelimbs
  {
    const SH = P(...J.shoulder), EL = P(...J.elbow), WR = P(...J.wrist);
    const arm = rig.part('arm_l', 'chest', SH);
    const armTan = fur(mixc(cs.tan, cs.pale, 0.2), cs.tanL, cs.tanD, 2, seed + 12, [1, 2.4, 1]);
    const armPale = fur(mixc(cs.pale, cs.tan, 0.3), cs.pale, cs.paleD, 2, seed + 13, [1, 2.4, 1]);
    tube(arm, [add3(SH, P(0, 0.006, -0.002)), EL, WR], [U(0.0094), U(0.0076), U(0.006)], (x, y, z) => (D(z) > 0.022 || D(y) < 0.222 ? armPale(x, y, z) : armTan(x, y, z)));
    // paw: a small dark hand with four claws hanging down-forward
    const paw = rig.part('paw_l', 'arm_l', WR);
    blob(paw, [
      { c: P(0.0258, 0.2005, 0.049), r: P(0.0066, 0.0084, 0.0058), rot: [0.5, 0, 0] },
      { a: P(0.026, 0.206, 0.0465), b: P(0.0258, 0.2, 0.049), r0: U(0.0056), r1: U(0.0054) },
    ], (x, y, z) => mixc(cs.skin, cs.tanD, h01(x, y, z, 4) * 0.25), { k: U(0.003) });
    for (let f = 0; f < 4; f++) {
      const fx = 0.0218 + f * 0.0026;
      line(paw, [P(fx, 0.1945, 0.051), P(fx + 0.0002, 0.1902, 0.0532)], cs.claw);
    }
    rig.mirror('arm_l', 'arm_r');
    rig.mirror('paw_l', 'paw_r', 'arm_r');
  }

  // ================================================================ hind limbs
  {
    const HP = P(...J.hip), KN = P(...J.knee), AN = P(...J.ankle), TO = P(...J.toe);
    const legF = fur(cs.tan, cs.tanL, cs.tanD, 2.2, seed + 20, [1, 2.6, 1]);
    const thigh = rig.part('thigh_l', 'hips', HP);
    cap(thigh, HP, KN, U(0.018), U(0.0118), (x, y, z) => (D(x) < 0.02 ? mixc(legF(x, y, z), cs.pale, 0.4) : legF(x, y, z)));
    const shin = rig.part('shin_l', 'thigh_l', KN);
    cap(shin, KN, AN, U(0.0098), U(0.0069), (x, y, z) => mixc(legF(x, y, z), cs.pale, 0.28));
    const foot = rig.part('foot_l', 'shin_l', AN);
    blob(foot, [
      { c: P(0.027, 0.0112, -0.0128), r: P(0.0084, 0.011, 0.0118) }, // heel
      { a: P(0.027, 0.0078, -0.008), b: P(0.027, 0.005, 0.034), r0: U(0.0082), r1: U(0.0056) }, // long sole
    ], (x, y, z) => (D(y) < 0.004 ? mulc(cs.skin, 0.8) : mixc(cs.skin, cs.tanD, 0.35 + h01(x, y, z, 6) * 0.2)), { k: U(0.004), keep: (_x, y) => y >= 0 });
    for (let t = 0; t < 4; t++) {
      const a = (t - 1.5) * 0.0042;
      cap(foot, P(0.027 + a * 0.6, 0.0052, 0.031), P(0.027 + a, 0.0035, 0.044), U(0.0029), U(0.0022), mixc(cs.skin, cs.tanD, 0.3), { keep: (_t, _a, _b, _x, y) => y >= 0 });
      foot.set(Math.floor(U(0.027 + a)), 0, Math.floor(U(0.0465)), cs.claw);
    }
    void TO;
    rig.mirror('thigh_l', 'thigh_r');
    rig.mirror('shin_l', 'shin_r', 'thigh_r');
    rig.mirror('foot_l', 'foot_r', 'shin_r');
  }

  // ================================================================ tail: tan, darker on top, black tip
  {
    const tailF = fur(cs.tan, cs.tanL, cs.tanD, 2, seed + 30, [1, 1, 3]);
    const tcol = (x: number, y: number, z: number) => {
      const Z = D(z);
      if (Z < -0.174) return cs.tip;
      let c = tailF(x, y, z);
      if (Z < -0.162) c = mixc(c, cs.tip, sstep(-0.162, -0.174, Z));
      return Math.abs(D(x)) < 0.004 && D(y) > (Z < -0.1 ? 0.012 : 0.04) ? mixc(c, cs.band, 0.42) : c;
    };
    const t1 = rig.part('tail1', 'hips', P(...J.tail1));
    cap(t1, P(...J.tail1), P(...J.tail2), U(0.0118), U(0.0096), tcol);
    const t2 = rig.part('tail2', 'tail1', P(...J.tail2));
    cap(t2, P(...J.tail2), P(...J.tail3), U(0.0096), U(0.0077), tcol);
    const t3 = rig.part('tail3', 'tail2', P(...J.tail3));
    tube(t3, [P(...J.tail3), P(...J.tailMid), P(...J.tailTip)], [U(0.0077), U(0.0058), U(0.0028)], tcol);
  }

  // ================================================================ the band: jackets, mop-tops, moustaches, instruments
  let playPose: (typeof PLAY)['acoustic'] | undefined;
  if (B) {
    dressBeatle(rig, B);
    playPose = PLAY[B.instrument];
    buildInstrument(rig, B, playPose);
  }

  // overlapping parts never share an exposed cell (no coplanar z-fighting at the joints)
  for (const p of rig.parts) {
    if (!p.parent) continue;
    const par = rig.m(p.parent);
    const del: V3[] = [];
    p.model.forEach((x, y, z) => {
      if (par.has(x, y, z) && exposed(par, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) p.model.del(x, y, z);
  }

  rig.socket('mouth', 'head', PH(0, 0.33, 0.077));
  rig.socket('head_top', 'head', PH(0, 0.372, 0.012));
  rig.socket('paw_l', 'paw_l', P(0.0258, 0.195, 0.051));
  rig.socket('paw_r', 'paw_r', P(-0.0258, 0.195, 0.051));
  rig.socket('chest', 'chest', P(0, 0.235, 0.04));
  return rig.build({
    kind: 'meerkat',
    height: 0.4,
    radius: 0.05,
    headY: (HJ[1] + (0.343 - HJ[1]) * HS) * MEERKAT_K,
    eyeY: (HJ[1] + (J.eye[1] - HJ[1]) * HS) * MEERKAT_K,
    beatle: B?.id,
    name: B?.name,
    instrument: B?.instrument,
    playPose,
  });
}

// ------------------------------------------------------------------ costume
function dressBeatle(rig: CRig, B: BeatleInfo) {
  const jacket = B.jacket;
  const jShade = mixc(jacket, 0x1a0c14, 0.28), jHi = mixc(jacket, 0xffffff, 0.2), jDeep = mixc(jacket, 0x140810, 0.45);
  const gold = 0xe8b440, goldHi = 0xffde7a, goldD = 0xa8781e;
  const trim = B.trim, trimD = mixc(trim, 0x000000, 0.3);
  const jacketCol = (x: number, y: number, z: number) => {
    const X = D(x), Y = D(y), Z = D(z);
    const front = Math.cos(Math.atan2(X, Z - 0.003));
    if (front > 0.9 && Math.abs(X) < 0.003) return jDeep; // closure line
    const crease = Math.sin(Math.atan2(X, Z) * 7 + Y * 120) > 0.86; // a few soft folds
    if (crease) return jShade;
    return h01(x, y, z, 21) < 0.05 ? jHi : jacket;
  };
  // ---- the jacket over the chest and the upper hips (hem just below the waist)
  const chest = rig.m('chest'), hips = rig.m('hips'), neck = rig.m('neck');
  const jacketZone = (y: number) => D(y) >= 0.168;
  for (const m of [chest, hips]) {
    paint(m, (x, y, z) => jacketZone(y) && exposed(m, x, y, z), jacketCol);
    thicken(m, (x, y, z) => jacketZone(y) && D(y) < 0.284 && exposed(m, x, y, z), (x, y, z) => jacketCol(x, y, z), [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]);
  }
  // hem: trim colour band with gold piping
  for (const m of [hips]) {
    const r0 = Math.ceil(U(0.168) - 0.5);
    paint(m, (x, y, z) => y === r0 && exposed(m, x, y, z) && Math.hypot(D(x), D(z)) > 0.03, trim);
    paint(m, (x, y, z) => y === r0 + 1 && exposed(m, x, y, z) && Math.hypot(D(x), D(z)) > 0.03, gold, VF.METAL);
  }
  // ---- gold frogging: four braid bars with looped ends + toggle buttons across the front
  const fs = frontSurface(chest);
  for (const fy of [0.209, 0.223, 0.237, 0.251]) {
    const j = Math.floor(U(fy));
    const half = Math.round(U(0.0205));
    for (let i = -half; i < half; i++) {
      const z = fs(i, j);
      if (!Number.isFinite(z)) continue;
      const end = i === -half || i === half - 1;
      chest.set(i, j, z + 1, end ? goldD : gold, VF.METAL);
      if (end) {
        // the looped knot at each end of the bar
        const z2 = fs(i, j + 1), z3 = fs(i, j - 1);
        if (Number.isFinite(z2)) chest.set(i, j + 1, z2 + 1, gold, VF.METAL);
        if (Number.isFinite(z3)) chest.set(i, j - 1, z3 + 1, gold, VF.METAL);
      }
    }
    for (const i of [-1, 0]) {
      const z = fs(i, j);
      if (Number.isFinite(z)) chest.set(i, j, z + 2, goldHi, VF.METAL); // toggle button
    }
  }
  // ---- contrast collar standing around the neck, gold piping on top
  {
    const y0 = Math.floor(U(0.274)), y1 = Math.floor(U(0.2905));
    const zc = U(0.0055);
    for (let y = y0; y <= y1; y++)
      for (let x = -9; x < 9; x++)
        for (let z = -8; z < 12; z++) {
          const d = Math.hypot(x + 0.5, z + 0.5 - zc);
          const inR = U(0.0245) - 0.2, outR = inR + 1.35 + (y === y1 ? 0 : 0.3);
          if (d < inR || d > outR) continue;
          if (neck.has(x, y, z)) continue;
          chest.set(x, y, z, y >= y1 - 0 ? gold : (x + z) % 7 === 0 ? trimD : trim, y >= y1 ? VF.METAL : VF.SOLID);
        }
  }
  // ---- fringed gold epaulettes on the shoulder tops
  for (const s of [1, -1]) {
    const pad: V3[] = [];
    chest.forEach((x, y, z) => {
      const X = D(x) * s, Y = D(y), Z = D(z);
      if (X > 0.019 && Y > 0.266 && Math.abs(Z - 0.003) < 0.019 && !chest.has(x, y + 1, z)) pad.push([x, y, z]);
    });
    for (const [x, y, z] of pad) {
      chest.set(x, y, z, gold, VF.METAL);
      chest.set(x, y + 1, z, (x + z) & 1 ? goldHi : gold, VF.METAL);
    }
    // fringe: short golden strands hanging over the outer edge
    let maxX = -1e9;
    for (const [x] of pad) maxX = Math.max(maxX, x * s);
    for (const [x, y, z] of pad) {
      if (x * s < maxX - 0.5) continue;
      const len = (z & 1) === 0 ? 3 : 2;
      for (let k = 1; k <= len; k++) chest.set(x + s, y + 1 - k, z, k === len ? goldD : gold, VF.METAL);
    }
  }
  // ---- sleeves on both arms with contrast cuffs + gold piping at the wrist
  for (const side of ['arm_l', 'arm_r']) {
    const arm = rig.m(side);
    const WR = Pv(side === 'arm_l' ? J.wrist : mirX(J.wrist));
    paint(arm, (x, y, z) => exposed(arm, x, y, z), jacketCol);
    thicken(arm, (x, y, z) => exposed(arm, x, y, z) && Math.hypot(x + 0.5 - WR[0], y + 0.5 - WR[1], z + 0.5 - WR[2]) > 2.2, (x, y, z) => jacketCol(x, y, z), [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]);
    paint(arm, (x, y, z) => {
      const d = Math.hypot(x + 0.5 - WR[0], y + 0.5 - WR[1], z + 0.5 - WR[2]);
      return d < 4.4;
    }, (x, y, z) => (Math.hypot(x + 0.5 - WR[0], y + 0.5 - WR[1], z + 0.5 - WR[2]) > 3.4 ? gold : trim));
  }
  // ---- mop-top: a thick, glossy fringe cut straight across just above the eyes
  const head = rig.m('head');
  const hair = B.hair, hairD = mixc(hair, 0x000000, 0.3), hairHi = mixc(hair, 0xffe0b0, 0.22);
  const hairZone = (x: number, y: number, z: number) => {
    const X = DX(x), Y = DY(y), Z = DZ(z), ax = Math.abs(X);
    if (Z > 0.016) return Y > 0.3595 - (ax < 0.0055 ? 0.0024 : 0);
    if (Z > -0.004) return Y > 0.3568;
    return Y > 0.3568 - (-0.004 - Z) * 1.6;
  };
  const hairCol = (x: number, y: number, z: number) => {
    const strand = (((x * 3 + z * 5) % 4) + 4) % 4 === 0;
    if (!head.has(x, y + 1, z) && h01(x, y, z, 44) < 0.3) return hairHi;
    return strand ? hairD : hair;
  };
  paint(head, (x, y, z) => hairZone(x, y, z) && exposed(head, x, y, z), hairCol);
  thicken(head, (x, y, z) => hairZone(x, y, z) && exposed(head, x, y, z), (x, y, z) => hairCol(x, y, z), [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]);
  // a little extra volume on top (the "mop") and jagged bangs between/outside the eyes
  thicken(head, (x, y, z) => DY(y) > 0.364 && exposed(head, x, y, z) && DZ(z) < 0.03, (x, y, z) => hairCol(x, y, z), [[0, 1, 0]]);
  const fsH = frontSurface(head);
  const fringeRow = Math.floor(rowH(0.3595));
  for (let x = -8; x < 8; x++) {
    const X = DX(x), ax = Math.abs(X);
    if (ax > 0.006 && ax < 0.026) continue; // keep the eyes clear
    if (x & 1) continue;
    const z = fsH(x, fringeRow);
    if (Number.isFinite(z)) head.set(x, fringeRow - 1, z, hairD);
  }
  // ---- moustache on the upper lip, hanging in front of the muzzle (style per member)
  {
    const row = Math.ceil(rowH(MOUTH_Y) - 0.5); // upper-lip row just above the jaw seam
    const stache = 0x2e1d12, stacheHi = 0x4a3020;
    const zc = fsH(0, row);
    const put = (x: number, dy: number, c: number) => {
      if (!Number.isFinite(zc)) return;
      // follow the muzzle's front at the lip row; droops hang straight down in front of the jaw
      const fz = fsH(x, dy > 0 ? row + dy : row);
      const z = Number.isFinite(fz) && fz > zc - 3 ? fz : zc - 2;
      head.set(x, row + dy, z + 1, c);
    };
    const shapes: Record<BeatleInfo['stache'], [number, number][]> = {
      // [x, dy] cells of the left half (mirrored), dy relative to the lip row
      walrus: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, -1], [2, -2]],
      neat: [[0, 0], [1, 0], [2, 0]],
      handlebar: [[0, 0], [1, 0], [2, 0], [3, 1], [3, 2]],
      droop: [[0, 0], [1, 0], [2, -1], [2, -2], [2, -3]],
    };
    for (const [x, dy] of shapes[B.stache]) {
      put(x, dy, dy > 0 ? stacheHi : stache);
      put(-1 - x, dy, dy > 0 ? stacheHi : stache);
    }
  }
}

// ------------------------------------------------------------------ instruments
function buildInstrument(rig: CRig, B: BeatleInfo, pose: (typeof PLAY)['acoustic']) {
  const GL = gripAt(1, pose.arm_l, pose.paw_l);
  const GR = gripAt(-1, pose.arm_r, pose.paw_r);
  if (B.instrument === 'drum') return buildDrum(rig, GL, GR, pose);
  const lefty = B.instrument === 'bass';
  const S = lefty ? GL : GR; // strumming paw
  const F = lefty ? GR : GL; // fretting paw
  const u = norm3(sub3(F, S));
  const f0 = norm3([0, 0.3, 1]);
  const n = norm3(sub3(f0, scl3(u, dot3(f0, u))));
  const v = cross3(n, u);
  const O = sub3(S, scl3(n, 0.0056));
  const fretAt = Math.hypot(...sub3(F, S));
  const neckEnd = Math.max(0.074, fretAt + 0.024);
  const kind = B.instrument;
  const inst = rig.part('instrument', 'chest', Pv(O));
  // bounding box (design metres)
  const corners: V3[] = [];
  for (const a of [-0.05, neckEnd + 0.022]) for (const b of [-0.032, 0.032]) for (const c of [-0.016, 0.006]) corners.push(add3(O, add3(scl3(u, a), add3(scl3(v, b), scl3(n, c)))));
  const lo = [0, 1, 2].map((a) => Math.floor(U(Math.min(...corners.map((p) => p[a])))) - 1);
  const hi = [0, 1, 2].map((a) => Math.ceil(U(Math.max(...corners.map((p) => p[a])))) + 1);
  const el = (x: number, y: number, a: number, b: number) => (Math.hypot(x / a, y / b) - 1) * Math.min(a, b);
  const sminf = (a: number, b: number, k: number) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  };
  const bodyD = (pu: number, pv: number) => {
    if (kind === 'bass') {
      let d = sminf(el(pu + 0.019, pv, 0.02, 0.021), el(pu - 0.013, pv, 0.0145, 0.0165), 0.006);
      d = Math.max(d, -(Math.hypot(pu + 0.003, Math.abs(pv) - 0.0238) - 0.0082)); // violin waist
      return d;
    }
    return sminf(el(pu + 0.022, pv, 0.022, 0.026), el(pu - 0.009, pv, 0.016, 0.02), 0.008);
  };
  const thick = kind === 'electric' ? 0.0085 : kind === 'bass' ? 0.011 : 0.012;
  const top = kind === 'acoustic' ? 0xe7bf78 : kind === 'electric' ? 0xf0e6d0 : 0xe2a046;
  const sides = kind === 'acoustic' ? 0x8a4a26 : kind === 'electric' ? 0xd8ccb2 : 0x5a2a12;
  for (let i = lo[0]; i <= hi[0]; i++)
    for (let j = lo[1]; j <= hi[1]; j++)
      for (let k = lo[2]; k <= hi[2]; k++) {
        const q = sub3([D(i), D(j), D(k)], O);
        const pu = dot3(q, u), pv = dot3(q, v), pn = dot3(q, n);
        let c: number | null = null, fl: number = VF.SOLID;
        const bd = bodyD(pu, pv);
        if (bd <= 0 && pn >= -thick && pn <= 0.0005) {
          const face = pn > -0.0026;
          if (!face) c = sides;
          else if (bd > -0.0034) c = kind === 'electric' ? 0x2a2420 : 0xf4ead4; // binding
          else {
            c = top;
            if (kind === 'bass') {
              // sunburst: amber centre to dark umber edge
              const r = Math.hypot((pu + 0.004) / 0.03, pv / 0.022);
              c = mixc(mixc(0xf2b850, 0xb4521c, sstep(0.45, 0.9, r)), 0x3a1a0c, sstep(0.88, 1.15, r));
              if (pu > -0.02 && pu < 0.006 && pv < -0.004 && pv > -0.016) c = 0xf0e6cc; // cream pickguard
            } else if (kind === 'acoustic') {
              if (((Math.floor(pv * 900) % 5) + 5) % 5 === 0) c = mixc(top, 0xc89858, 0.5); // spruce grain
              const dh = Math.hypot(pu - 0.004, pv);
              if (dh < 0.0064) c = 0x150c08;
              else if (dh < 0.0086) c = 0x4a2c18;
            } else {
              if (pu > -0.034 && pu < 0.012 && pv > 0.004 && pv < 0.021) c = 0x8a2a1c; // tortoise pickguard
            }
          }
        }
        // bridge (acoustic / bass) and pickups (electric), raised above the top
        if (pn > -0.001 && pn < 0.0032 && bd < -0.002) {
          if (kind !== 'electric' && pu > -0.031 && pu < -0.0255 && Math.abs(pv) < 0.009) c = 0x2a1a10;
          if (kind !== 'acoustic' && Math.abs(pv) < 0.0085 && ((pu > -0.016 && pu < -0.011) || (kind === 'electric' && pu > -0.004 && pu < 0.001))) {
            c = 0xd0d4dc;
            fl = VF.METAL;
          }
        }
        // neck + fretboard
        if (pu > 0.018 && pu < neckEnd && Math.abs(pv) < 0.0044 + (pu < 0.026 ? 0.001 : 0) && pn > -0.0078 && pn < 0.0006) {
          c = pn > -0.0026 ? 0x2e1c12 : 0x7a4a2a;
          if (pn > -0.0026 && Math.abs(pv) < 0.0016 && [0.04, 0.05, 0.062].some((t) => Math.abs(pu - t) < 0.0018)) c = 0xf4ecdc; // pearl dots
        }
        // headstock, tilted back, with silver tuning pegs
        const hu = pu - neckEnd;
        if (hu >= 0 && hu < 0.018 && Math.abs(pv) < 0.0064 && pn > -0.0064 - hu * 0.2 && pn < 0.0004 - hu * 0.2) c = 0x2a1810;
        if (hu > 0.003 && hu < 0.016 && Math.abs(Math.abs(pv) - 0.0085) < 0.0018 && Math.abs(pn + 0.003 + hu * 0.2) < 0.0022 && (Math.floor(hu / 0.0046) & 1) === 0) {
          c = 0xdadde4;
          fl = VF.METAL;
        }
        // strings: a fine bright line from the bridge to the nut
        if (Math.abs(pv) < 0.0021 && pn > 0.0004 && pn < 0.0044 && pu > -0.028 && pu < neckEnd && c === null) {
          c = 0xece6d4;
          fl = VF.METAL;
        }
        if (c !== null) inst.set(i, j, k, c, fl);
      }
}

function buildDrum(rig: CRig, GL: V3, GR: V3, pose: (typeof PLAY)['drum']) {
  const mid = lerp3(GL, GR, 0.5);
  const Dc = add3(mid, [0, -0.033, 0.024]);
  const a = norm3([0, 1, 0.42]);
  const b1: V3 = [1, 0, 0];
  const b2 = norm3(cross3(a, b1));
  const R = 0.037, H = 0.0168;
  const drum = rig.part('instrument', 'chest', Pv(Dc));
  const lo = Pv(sub3(Dc, [R + 0.006, R + 0.006, R + 0.006])), hi = Pv(add3(Dc, [R + 0.006, R + 0.006, R + 0.006]));
  for (let i = Math.floor(lo[0]); i <= Math.ceil(hi[0]); i++)
    for (let j = Math.floor(lo[1]); j <= Math.ceil(hi[1]); j++)
      for (let k = Math.floor(lo[2]); k <= Math.ceil(hi[2]); k++) {
        const q = sub3([D(i), D(j), D(k)], Dc);
        const h = dot3(q, a);
        const rv = sub3(q, scl3(a, h));
        const rad = Math.hypot(...rv);
        if (Math.abs(h) > H || rad > R) continue;
        const th = Math.atan2(dot3(rv, b2), dot3(rv, b1));
        let c: number, fl: number = VF.SOLID;
        if (Math.abs(h) > H - 0.0042 && rad > R - 0.0052) {
          c = (Math.floor((th + 4) * 6) & 1) === 0 ? 0xe6b23c : 0xc8922a; // gold hoops with lugs
          fl = VF.METAL;
        } else if (Math.abs(h) > H - 0.0042) c = h > 0 ? 0xf2e8d2 : 0xe2d6bc; // heads
        else if (rad > R - 0.0048) {
          // red shell, gold rope tension zig-zag
          const s = ((th / (Math.PI * 2)) * 8 + 8) % 1;
          const tri = Math.abs(s - 0.5) * 2;
          const hh = (h + H - 0.0042) / (2 * (H - 0.0042));
          c = Math.abs(tri - hh) < 0.12 ? 0xf0cc60 : h01(i, j, k, 61) < 0.06 ? 0xd8423a : 0xc4302a;
        } else continue;
        drum.set(i, j, k, c, fl);
      }
  // neck cords from the hoops up to the collar
  for (const s of [1, -1]) line(drum, [Pv(add3(Dc, [s * (R - 0.004), 0.012, -0.012])), Pv([s * 0.034, 0.236, 0.038]), Pv([s * 0.019, 0.284, 0.028])], 0xe8c050, VF.METAL);
  // drumsticks in the paws, aimed at the drumhead (built in each paw's rest frame)
  for (const [side, G, arm, paw] of [[1, GL, pose.arm_l, pose.paw_l], [-1, GR, pose.arm_r, pose.paw_r]] as [1 | -1, V3, V3, V3][]) {
    const target = add3(add3(Dc, scl3(a, H)), [side * 0.012, 0, -0.004]);
    const toHead = sub3(target, G);
    const dWorld = norm3(toHead);
    const reach = Math.max(0.03, Math.min(0.05, Math.hypot(...toHead) - 0.002)); // tip rests on the drumhead
    const dRest = invXYZ(invXYZ(dWorld, arm), paw);
    const gRest = side > 0 ? J.grip : mirX(J.grip);
    const pm = rig.m(side > 0 ? 'paw_l' : 'paw_r');
    const butt = sub3(gRest, scl3(dRest, 0.008));
    const tip = add3(gRest, scl3(dRest, reach));
    line(pm, [Pv(butt), Pv(tip)], 0xe8cf9c);
    ell(pm, Pv(tip), [0.9, 0.9, 0.9], 0xf6ead0);
  }
}

// ------------------------------------------------------------------ public builders (memoised)
const build = memoBy((o: MeerkatOpts) => `${o.variant ?? 0}:${o.beatle ?? ''}`, buildMeerkat);
/** a plain meerkat (coat variant 0..2) */
export function meerkatRig(variant = 0): RigSpec {
  return build({ variant });
}
/** one of the four band members in costume with an instrument */
export function beatleMeerkatRig(id: BeatleId): RigSpec {
  return build({ variant: id === 'sky' ? 1 : 0, beatle: id });
}
