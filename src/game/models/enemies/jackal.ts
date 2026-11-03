// Jackal Warrior: Anubis's temple guard, built on Sundown's skeleton figure
// (characters/skeleton.ts, 1/36: same joints, so the shared animation fits) with
// a jackal head on the figure's skull (long snout with a wet black nose, fangs, a
// canine lower jaw on the `jaw` part, tall ears with gold trim, real amber eyes
// lined with kohl), a muscular furred body, gold usekh collar and armbands, a
// pleated linen kilt (front panels ride the thighs, the back is the swaying
// `coat`), digitigrade legs on padded clawed feet, a bushy `tail`, a bronze
// khopesh (`weapon`, fore_r, hook forward, `blade_tip` socket) and a painted
// shield with the eye of Horus (`shield`, fore_l, facing +X).
// v1 golden-sand fur, v2 grey fur. Alpha: black fur, gold chest plate + ear caps.
// (jackalHead / furArms below are the legacy toon helpers still used by sethos.ts.)
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { toonPelvis, buildHumanoid, defaultExpressions, sleeve, toonHand, pantLeg, JOINT, mirrorV3 } from '../toon/humanoid';
import type { HumanoidParts } from '../toon/humanoid';
import { EnemyOpts, roundBox, roundBoxX, autoShade, mirrored, pickV } from './human';
import { seg, chain } from './tk';
import { Fig, finish, figMeta, sections, limbG, cutG, coatG, wrapShell, ell, tube, isSurf, furC, mix, noise, CSpec, G } from './figure/fig';
import { METAL, frontZ, usekhG } from './figure/gear';


const FUR: Ramp[] = [
  TOON.jackal,
  { base: 0xb7864e, shade: 0x93683a, hi: 0xd2a066, dark: 0x5e3e20 },
  { base: 0x7a7480, shade: 0x5e5864, hi: 0x948e9a, dark: 0x3a3640 },
];
const BRONZE: Ramp = { base: 0xc08a40, shade: 0x9a6a2c, hi: 0xe6b264, dark: 0x5e3e16 };

/** jackal head: returns head, jaw, eye plugs, brows (rig-global coords) */
export function jackalHead(F: Ramp, o: { gold?: Ramp; alpha?: boolean } = {}) {
  const G = o.gold ?? TOON.gold;
  const head = new VoxelModel('head');
  // cranium
  for (let y = 40; y <= 51; y++) {
    const hx = y >= 51 ? 5 : y >= 49 ? 6 : 7;
    const zb = y >= 50 ? -5 : -6, zf = y >= 50 ? 4 : 6;
    roundBox(head, -hx, y, zb, hx, y, zf, F.base, y >= 49 ? 2 : 1);
  }
  // snout (muzzle) + black nose
  roundBox(head, -3, 39, 6, 3, 44, 13, F.base, 1);
  roundBox(head, -2, 42, 13, 2, 44, 14, TOON.black.base, 1);
  head.set(0, 44, 14, TOON.black.hi);
  for (let z = 7; z <= 12; z++) head.set(0, 45, z, F.hi); // bridge highlight
  // cheek ruffs
  for (const s of [1, -1]) roundBox(head, s * 6, 39, -1, s * 8, 42, 4, F.shade, 1);
  // mouth line + upper fangs
  for (let z = 7; z <= 13; z++) for (const s of [1, -1]) head.set(s * 3, 39, z, F.dark);
  head.set(2, 38, 12, TOON.bone.hi).set(-2, 38, 12, TOON.bone.hi);
  // eye sockets 3x3 above the snout
  for (const s of [1, -1])
    for (let i = 2; i <= 4; i++)
      for (let y = 45; y <= 47; y++) {
        head.del(s * i, y, 6);
        head.set(s * i, y, 5, TOON.socket.dark);
      }
  // tall ears with gold trim
  for (const s of [1, -1])
    for (let y = 50; y <= 61; y++) {
      const t = (y - 50) / 11;
      const x0 = Math.round(3 + t * 1.5), x1 = Math.round(7 - t * 2.5);
      for (let x = x0; x <= x1; x++)
        for (let z = -3; z <= -1; z++) {
          const inner = z === -1 && x >= x0 && x < x1 && y < 59 && y > 51;
          const rim = (x === x1 || y >= 60) && z === -2 && o.gold !== undefined;
          head.set(s * x, y, z, inner ? TOON.red.shade : rim ? G.base : F.base, rim ? VF.METAL : VF.SOLID);
        }
      if (o.alpha && y >= 59) for (let x = x0; x <= x1; x++) head.set(s * x, y, -2, G.hi, VF.METAL);
    }
  // gold headband
  for (let x = -7; x <= 7; x++) for (let z = -6; z <= 6; z++) if (head.has(x, 48, z) && (Math.abs(x) >= 6 || z >= 5 || z <= -5)) head.set(x, 48, z, G.base, VF.METAL);
  autoShade(head, [F]);
  const jaw = new VoxelModel('jaw');
  roundBox(jaw, -3, 36, 4, 3, 38, 12, F.shade, 1);
  for (let z = 6; z <= 12; z++) jaw.set(0, 36, z, F.dark);
  jaw.set(2, 39, 11, TOON.bone.base).set(-2, 39, 11, TOON.bone.base);
  const eye_l = new VoxelModel('eye_l');
  for (let i = 2; i <= 4; i++) for (let y = 45; y <= 47; y++) eye_l.set(i, y, 5, TOON.socket.dark);
  const brow_l = new VoxelModel('brow_l');
  for (let i = 1; i <= 5; i++) brow_l.set(i, 48, 7, F.dark);
  return { head, jaw, eye_l, eye_r: mirrored(eye_l, 'eye_r'), brow_l, brow_r: mirrored(brow_l, 'brow_r') };
}
export const JACKAL_EYE: V3 = [3.5, 46.5, 6];
export const JACKAL_BROW: V3 = [3.5, 48.5, 7.5];

/** furry arms with gold armbands + clawed hands (LEFT) */
export function furArms(F: Ramp, G: Ramp, pose: 'fist' | 'open' = 'fist') {
  const arm = new VoxelModel('arm_l');
  sleeve(arm, 6, 9, 25, 33, -2, 1, F);
  roundBox(arm, 6, 28, -2, 9, 29, 1, G.base, 0, VF.METAL);
  const fore = new VoxelModel('fore_l');
  sleeve(fore, 6, 9, 18, 24, -2, 1, F);
  roundBox(fore, 6, 19, -2, 9, 20, 1, G.base, 0, VF.METAL);
  toonHand(fore, { ramp: F, pose });
  autoShade(arm, [F]);
  autoShade(fore, [F]);
  return { arm, fore };
}

const FURS = [
  { base: 0x3a3446, light: 0x585068, dark: 0x221e2a, belly: 0x6a6070 },
  { base: 0xb07c46, light: 0xd4a066, dark: 0x6e4a26, belly: 0xe0c08a },
  { base: 0x7a7480, light: 0x9a94a0, dark: 0x4a4650, belly: 0xb8b0b8 },
];
const JT: Record<number, [number, number, number]> = {
  28: [5.2, 2.0, -5.5], 29: [5.3, 2.2, -5.6], 30: [5.5, 2.4, -5.6], 31: [5.8, 2.7, -5.7], 32: [6.2, 3.0, -5.7], 33: [6.6, 3.4, -5.8],
  34: [6.9, 3.8, -5.8], 35: [7.2, 4.1, -5.8], 36: [7.4, 4.4, -5.9], 37: [7.6, 4.6, -5.9], 38: [7.8, 4.8, -5.9], 39: [7.9, 4.9, -5.9],
  40: [8.0, 4.9, -5.9], 41: [8.0, 4.8, -5.8], 42: [7.8, 4.4, -5.7], 43: [7.3, 3.4, -5.5], 44: [5.8, 1.9, -5.0], 45: [3.9, 1.1, -4.6],
  46: [3.2, 0.9, -4.4], 47: [3.0, 0.8, -4.3],
};

/** the jackal on Sundown's figure: head, furred body, kilt, digitigrade legs, tail (no weapons). Returns the head top row. */
export function jackalBody(F: Fig, o: { alpha?: boolean; variant?: number; fur?: { base: number; light: number; dark: number; belly: number } } = {}) {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % 3) + 3) % 3;
  const seed = 9 + v * 5 + (alpha ? 2 : 0);
  const Fu = o.fur ?? (alpha ? { base: 0x1e1c22, light: 0x34303a, dark: 0x0e0c10, belly: 0x3a3640 } : FURS[v]);
  const fur = furC(Fu.base, Fu.light, Fu.dark, seed);
  const G = METAL.gold, LAP = 0x2a4a9a, TURQ = 0x2e9a8a;
  F.boneMirror('fore_r', 'fore_l'); // fists: one on the weapon, one on the shield grip / bow
  // ---------------------------------------------------------------- the jackal head on the figure's skull
  const hd = F.s('head');
  // fur over the dome; the human sockets, nose notch and grin are filled
  hd.m.forEach((x, y, z) => hd.m.set(x, y, z, res(fur, x, y, z)));
  for (let x = -6; x <= 5; x++) for (let y = 47; y <= 57; y++) for (let z = -2; z <= 5; z++) if (!hd.m.has(x, y, z) && (z < 5 || Math.abs(x + 0.5) < 5.5)) hd.m.set(x, y, z, res(fur, x, y, z));
  // the long muzzle, tapering to a wet black nose
  for (let z = 4; z <= 15; z++) {
    const t = (z - 4) / 11;
    const hw = 3.4 - t * 1.4, y0 = 47.5 + t * 0.5, y1 = 52.6 - t * 2.4;
    for (let x = -4; x < 4; x++) for (let y = 46; y <= 53; y++) {
      const gx = x + 0.5, gy = y + 0.5;
      const u = Math.abs(gx) / hw, w = (gy - (y0 + y1) / 2) / ((y1 - y0) / 2);
      if (u ** 2.2 + Math.abs(w) ** 2.2 > 1) continue;
      const top = gy > y1 - 1.0;
      hd.m.set(x, y, z, top && Math.abs(gx) < 1.4 ? mix(Fu.base, Fu.light, 0.5) : res(fur, x, y, z));
    }
  }
  for (let x = -2; x <= 1; x++) for (let y = 48; y <= 50; y++) hd.m.set(x, y, 15, y === 50 && (x === -2 || x === 1) ? 0x2a2224 : 0x141012);
  hd.m.set(-1, 49, 16, 0x141012).set(0, 49, 16, 0x141012).set(-1, 50, 16, 0x3a3236).set(0, 50, 16, 0x141012);
  hd.m.set(-2, 48, 16, 0x0a0808).set(1, 48, 16, 0x0a0808); // nostrils
  // lip line, upper fangs, cheek ruffs
  for (let z = 6; z <= 14; z++) for (const x of [-3, 2]) if (hd.m.has(x, 47, z)) hd.m.set(x, 47, z, Fu.dark);
  hd.m.set(-2, 46, 13, 0xf0e6d0).set(1, 46, 13, 0xf0e6d0).set(-2, 46, 12, 0xe0d4b8).set(1, 46, 12, 0xe0d4b8);
  for (const sx of [1, -1]) {
    const X = (x: number) => sx * x;
    ell(hd, [X(6.2), 49.5, 1.0], [1.4, 2.4, 2.4], furC(Fu.light, Fu.belly, Fu.base, seed + 3));
    // almond eye sockets above the muzzle, kohl lines sweeping back
    for (let i = 1; i <= 4; i++) for (const y of [53, 54]) for (const z of [4, 5]) hd.m.del(sx > 0 ? i : -1 - i, y, z);
    for (let i = 1; i <= 4; i++) for (const y of [53, 54]) hd.m.set(sx > 0 ? i : -1 - i, y, 3, 0x1a1214);
    for (const [x, y, z] of [[1, 52, 5], [2, 52, 5], [3, 52, 5], [4, 52, 5], [5, 53, 4], [5, 54, 4], [1, 55, 5], [2, 55, 5], [3, 55, 5], [4, 55, 5], [6, 53, 2], [6, 53, 1]] as G[]) hd.m.set(sx > 0 ? x : -1 - x, y, z, 0x0e0a0c);
    // tall ears with gold trim (and gold caps for the alpha)
    for (let y = 60; y <= 74; y++) {
      const t = (y - 60) / 14;
      const x0 = 2 + Math.round(t * 1.4), x1 = 6 - Math.round(t * 2.6);
      for (let x = x0; x <= x1; x++)
        for (let z = -3; z <= -1; z++) {
          const X0 = sx > 0 ? x : -1 - x;
          const inner = z === -1 && x > x0 && x < x1 && y < 72;
          const rim = x === x1 || x === x0 || y >= 73;
          const capd = alpha && y >= 69;
          hd.m.set(X0, y, z, capd ? G[0] : inner ? 0x4a2a2e : rim && z === -2 && y > 63 ? G[1] : res(fur, X0, y, z), capd || (rim && z === -2 && y > 63) ? VF.METAL : VF.SOLID);
        }
    }
  }
  // gold headband across the brow
  hd.m.forEach((x, y, z) => {
    if (y === 57 && isSurf(hd.m, x, y, z)) hd.m.set(x, y, z, (x & 3) === 0 ? LAP : G[0], (x & 3) === 0 ? VF.SOLID : VF.METAL);
  });
  // canine lower jaw (the figure's chin is replaced)
  const jw = F.s('jaw');
  jw.m.map.clear();
  for (let z = -2; z <= 14; z++) {
    const t = Math.max(0, (z - 2) / 12);
    const hw = 3.2 - t * 1.4;
    for (let x = -4; x < 4; x++) for (let y = 43; y <= 46; y++) {
      const gx = x + 0.5;
      if (Math.abs(gx) > hw || (y === 43 && (z > 10 || Math.abs(gx) > hw - 1))) continue;
      jw.m.set(x, y, z, y === 46 && Math.abs(gx) < hw - 0.9 && z > 2 ? 0x5a1e22 : y <= 44 ? res(furC(Fu.light, Fu.belly, Fu.base, seed + 4), x, y, z) : res(fur, x, y, z));
    }
  }
  jw.m.set(-2, 47, 12, 0xf0e6d0).set(1, 47, 12, 0xf0e6d0);
  for (let z = 4; z <= 9; z++) jw.m.set(-1, 46, z, 0x8a3438).set(0, 46, z, 0x8a3438); // tongue
  // real eyes: amber iris, black pupil, a catch-light
  for (const sx of [1, -1]) {
    const name = sx > 0 ? 'eye_l' : 'eye_r';
    const m = new VoxelModel(name);
    const X = (i: number) => (sx > 0 ? i : -1 - i);
    m.set(X(1), 53, 4, 0x6a3a10).set(X(1), 54, 4, 0x8a5418);
    m.set(X(2), 53, 4, 0x0a0606).set(X(2), 54, 4, 0xd88a20);
    m.set(X(3), 53, 4, 0xc07818).set(X(3), 54, 4, 0xfff0c8);
    m.set(X(4), 53, 4, 0x8a5418).set(X(4), 54, 4, 0x6a3a10);
    F.setModel(name, m);
  }
  for (const n of ['brow_l', 'brow_r']) {
    const b = F.s(n);
    const pts: G[] = [];
    b.m.forEach((x, y, z) => pts.push([x, y, z]));
    for (const [x, y, z] of pts) b.m.set(x, y, z, Fu.dark).set(x, y, z + 1, Fu.base);
  }
  // ---------------------------------------------------------------- muscular furred body
  const tr = F.s('torso');
  tr.m.map.clear();
  sections(tr, 28, 47, (y) => {
    const r = JT[Math.floor(y)];
    return r ? { a: r[0], f: r[1], b: r[2], p: 2.3 } : null;
  }, fur);
  coatG(tr, (x, y, z) => z > 1.5 && Math.abs(x) < 4.2 && y > 29 && y < 43, furC(Fu.belly, mix(Fu.belly, 0xffffff, 0.15), Fu.light, seed + 5));
  for (const sx of [1, -1]) ell(tr, [sx * 3.6, 39.4, 3.6], [3.0, 2.2, 1.4], fur); // pectorals
  // usekh collar
  usekhG(tr, [G[0], LAP, G[0], TURQ, G[2], LAP], { rMax: 10.0, y0: 39 });
  if (alpha) for (let y = 31; y <= 38; y++) for (let x = -5; x <= 4; x++) if (Math.abs(x + 0.5) < 5.2 - Math.max(0, 33 - y)) tr.m.set(x, y, frontZ(tr.m, x, y) + 1, (x + y) % 4 === 0 ? G[2] : G[0], VF.METAL);
  const pv = F.s('pelvis');
  pv.m.map.clear();
  sections(pv, 20, 29, (y) => ({ a: 5.6 + Math.min(1, (y - 20) / 4) * 1.0, f: 2.4, b: -5.6, p: 2.4 }), fur);
  // pleated linen kilt + gold belt; front panels ride the thighs, the back is the swaying `coat`
  const lin = (x: number, y: number, z: number) => ((x + z) & 1 ? 0xf0e6cc : 0xd8ccb0);
  wrapShell(pv, 21, 27, lin);
  pv.m.forEach((x, y, z) => {
    if (y === 27 && isSurf(pv.m, x, y, z)) pv.m.set(x, y, z, (x & 3) === 1 ? LAP : G[0], (x & 3) === 1 ? VF.SOLID : VF.METAL);
  });
  const cp = F.part('coat', 'pelvis', [0, 27, -6.5]);
  for (let y = 15; y <= 26; y++) for (let x = -7; x < 7; x++) cp.m.set(x, y, -8 + (y < 20 ? 1 : 0), lin(x, y, 0));
  // ---------------------------------------------------------------- limbs
  for (const s1 of [1, -1]) {
    const X = (x: number) => s1 * x;
    if (s1 < 0) {
      F.boneMirror('arm_l', 'arm_r');
      F.boneMirror('thigh_l', 'thigh_r');
      F.boneMirror('shin_l', 'shin_r');
    }
    const a = F.s(s1 > 0 ? 'arm_l' : 'arm_r');
    ell(a, [X(8.6), 41.3, 0.0], [2.45, 2.6, 2.45], fur);
    limbG(a, [X(8.6), 40.0, 0.0], [X(8.5), 34.6, 0.1], (t) => 2.1 - 0.3 * t, fur);
    ell(a, [X(8.5), 37.6, 1.0], [1.4, 2.1, 1.0], fur); // biceps
    ell(a, [X(8.5), 33.9, -0.1], [2.0, 1.25, 1.7], fur);
    wrapShell(a, 37, 38, (x, y) => (y === 38 ? G[0] : G[1]), () => true, VF.METAL);
    const f = F.s(s1 > 0 ? 'fore_l' : 'fore_r');
    // the figure's fist stays: fur over the forearm and the back of the hand, claws on the knuckles
    f.m.forEach((x, y, z) => {
      if (y >= 25) f.m.set(x, y, z, res(fur, x, y, z));
    });
    ell(f, [X(8.5), 31.9, -0.3], [1.95, 1.25, 1.7], fur);
    limbG(f, [X(8.6), 31.4, -0.1], [X(8.9), 25.6, 0.0], (t) => 1.9 - 0.45 * t, fur);
    for (let y = 26; y <= 28; y++) wrapShell(f, y, y, (x, yy) => (yy === 27 ? LAP : G[0]), () => true, VF.METAL);
    f.m.forEach((x, y, z, c) => {
      if (y < 25) f.m.set(x, y, z, z === 2 && y <= 21 ? 0x1e1618 : mix(c & 0xffffff, Fu.base, 0.75));
    });
    const th = F.s(s1 > 0 ? 'thigh_l' : 'thigh_r');
    limbG(th, [X(3.8), 23.4, 0.1], [X(3.6), 17.2, 0.2], (t) => 2.6 - 0.55 * t, fur);
    ell(th, [X(3.6), 20.8, -1.3], [1.8, 2.6, 1.3], fur); // heavy hamstrings
    ell(th, [X(3.6), 16.7, 0.4], [1.9, 1.3, 1.8], fur);
    // digitigrade shank: knee -> raised hock -> long metatarsal -> padded paw on its toes
    const sh = F.s(s1 > 0 ? 'shin_l' : 'shin_r');
    sh.m.map.clear();
    ell(sh, [X(3.6), 14.6, 0.3], [1.95, 1.3, 1.8], fur);
    limbG(sh, [X(3.6), 14.0, -0.2], [X(3.6), 6.6, -2.0], (t) => 1.85 - 0.5 * t, fur);
    ell(sh, [X(3.6), 6.0, -2.4], [1.15, 1.2, 1.15], furC(Fu.dark, Fu.base, Fu.dark, seed)); // hock
    limbG(sh, [X(3.7), 6.0, -1.9], [X(3.9), 1.8, 2.0], (t) => 1.3 - 0.25 * t, fur);
    ell(sh, [X(3.9), 1.1, 3.0], [2.0, 1.15, 2.1], fur); // paw
    for (let k = 0; k < 4; k++) {
      const x = X(2.5 + k);
      sh.m.set(Math.floor(x), 0, 5, 0x2a2224).set(Math.floor(x), 0, 6, 0x0e0a0c).set(Math.floor(x), 1, 5, Fu.dark);
    }
    cutG(sh, (x, y) => y < 0);
    // kilt panel on the front of the thigh
    const zf = Math.max(...[-1, 0, 1, 2, 3, 4].map((dx) => frontZ(th.m, s1 > 0 ? dx : -1 - dx, 20))) + 1;
    for (let y = 15; y <= 23; y++) for (let x = 0; x <= 5; x++) th.m.set(s1 > 0 ? x : -1 - x, y, zf, x <= 1 ? (y & 1 ? LAP : G[0]) : lin(x, y, zf), x <= 1 && !(y & 1) ? VF.METAL : VF.SOLID);
  }
  // ---------------------------------------------------------------- bushy tail
  const tl = F.part('tail', 'pelvis', [0, 25.5, -5.5]);
  tube(tl, [[0, 25.5, -6.0], [0, 23.0, -8.6], [0, 18.5, -10.6], [0, 13.0, -11.0], [0, 9.5, -10.2]], (t) => 1.2 + Math.sin(Math.min(1, t * 1.4) * Math.PI) * 1.2 - t * 0.5, (x, y, z) => (y < 12 ? Fu.light : res(fur, x, y, z)));
  let top = 63;
  hd.m.forEach((_x, y) => (top = Math.max(top, y + 1)));
  F.sock('head_top', 'head', [0, top, -2]);
  return { top, seed, Fu };
}

export function jackalRig(o: EnemyOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % 3) + 3) % 3;
  const F = new Fig();
  const { top, seed } = jackalBody(F, { alpha, variant: v });
  const G = METAL.gold, BR = METAL.bronze, LAP = 0x2a4a9a;
  // ---------------------------------------------------------------- bronze khopesh in the right fist (hook forward)
  const wp = F.part('weapon', 'fore_r', F.J.hand_r);
  for (let y = 19; y <= 25; y++) for (const x of [-10, -9]) wp.m.set(x, y, 0, y === 19 || y === 25 ? G[0] : 0x3a2414, y === 19 || y === 25 ? VF.METAL : VF.SOLID);
  const blade: [number, number][] = [[18, 0], [17, 0], [16, 0], [15, 0], [14, 0], [13, 0], [12, 1], [11, 1], [10, 2], [9, 3], [9, 4], [10, 5], [11, 6]];
  for (const [y, dz] of blade) for (const x of [-10, -9]) {
    wp.m.set(x, y, dz, x === -10 ? BR[0] : BR[1], VF.METAL);
    wp.m.set(x, y, dz + 1, x === -10 ? BR[2] : BR[0], VF.METAL); // bright edge
  }
  F.sock('blade_tip', 'weapon', [-9, 11.5, 7]);
  // ---------------------------------------------------------------- shield on the left forearm (outer side, faces +X)
  const sd = F.part('shield', 'fore_l', [11, 27, 0]);
  const hide = (y: number, z: number) => (noise.n2(y * 0.3, z * 0.3 + seed) > 0.3 ? 0xd8ccb0 : 0xc0b08a);
  for (let y = 13; y <= 33; y++)
    for (let z = -6; z <= 5; z++) {
      const gz = z + 0.5;
      const topR = y >= 28 ? Math.sqrt(Math.max(0, 1 - ((y - 28) / 6) ** 2)) * 6 : 6;
      if (Math.abs(gz) > topR) continue;
      const rim = Math.abs(gz) > topR - 1 || y === 13;
      sd.m.set(12, y, z, rim ? BR[0] : hide(y, z), rim ? VF.METAL : VF.SOLID);
      sd.m.set(11, y, z, rim ? BR[1] : 0x6a4a2c, rim ? VF.METAL : VF.SOLID);
    }
  // painted eye of Horus
  for (const [y, z, c] of [[24, -3, 0], [24, -2, 0], [24, -1, 0], [24, 0, 0], [24, 1, 0], [24, 2, 0], [25, -2, 1], [25, -1, 1], [25, 0, 1], [25, 1, 1], [23, -1, 2], [23, 0, 2], [22, 0, 0], [21, 1, 0], [20, 1, 0], [20, 2, 0], [22, -2, 0], [21, -3, 0], [26, -2, 0], [26, -1, 0], [26, 0, 0], [26, 1, 0]] as number[][])
    sd.m.set(13, y, z, c === 1 ? 0xf6efe0 : c === 2 ? 0x101018 : LAP);
  finish(F);
  return F.build(`jackal${alpha ? '_alpha' : ''}_v${v}`, figMeta(F, 'jackal', {
    alpha,
    variant: v,
    height: top * F.vs,
    radius: 0.34,
    blocksFront: true,
    weaponRest: '-Y, hook toward +Z',
    shieldFacing: '+X',
    expressions: defaultExpressions(['neutral', 'angry', 'snarl', 'hurt', 'surprised', 'dead', 'stunned']),
  }));
}
const res = (c: CSpec, x: number, y: number, z: number) => (typeof c === 'number' ? c : (c(x, y, z) as number));
void buildHumanoid;
void toonPelvis;
void pantLeg;
void JOINT;
void mirrorV3;
void roundBoxX;
void pickV;
void seg;
void chain;
