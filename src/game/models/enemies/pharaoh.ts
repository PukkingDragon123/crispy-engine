// The Pharaoh (boss): an undead king on Sundown's skeleton figure
// (characters/skeleton.ts: same parts, joints and proportions), scaled to boss
// size with bigger voxels (1/22). A weathered skull face with cold embers under a
// striped gold-and-lapis nemes with a cobra uraeus, a braided gold false beard,
// a body swaddled in burial bandages, a huge usekh collar, a pleated kilt with a
// gold belt and apron, gold arm rings, a gold crook (`weapon`, fore_r,
// `crook_tip` socket) and his own sarcophagus lid as a shield (`shield`, fore_l,
// facing +X — the front guard). The cape is engine cloth from `cape_anchor`.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { defaultExpressions } from '../toon/humanoid';
import { Fig, finish, figMeta, VoxelModel, VF, mix, wrapShell, G } from './figure/fig';
import { ageBones, emberEyes, addHat, frontZ, METAL, rescaleRig } from './figure/gear';
import { mummyBody } from './mummy';
import { BOSS_EXPR, BOSS_VS } from './marshal';

const LAP = 0x2a4a9a;

/** nemes headdress: flat crown, striped side panels flaring behind the ears, lappets over the chest, a tail */
function nemes() {
  const m = new VoxelModel('hat');
  const G0 = METAL.gold;
  const stripe = (y: number) => ((y >> 1) & 1 ? G0[0] : LAP);
  const flag = (c: number) => (c === LAP ? VF.SOLID : VF.METAL);
  for (let y = 46; y <= 64; y++) {
    const top = y >= 62;
    const hx = top ? 6.6 - (y - 62) * 0.5 : y >= 56 ? 7.6 : 7.6 + (56 - y) * 0.28;
    const zb = top ? -7.6 : -8.8, zf = top ? 5.6 : y >= 57 ? 6.6 : 0.6;
    for (let x = -11; x < 11; x++)
      for (let z = -10; z <= 7; z++) {
        const gx = Math.abs(x + 0.5), gz = z + 0.5;
        const u = gx / hx, v = Math.abs(gz - (zf + zb) / 2) / ((zf - zb) / 2);
        if (u ** 2.6 + v ** 2.6 > 1) continue;
        const inner = (gx / (hx - 1.1)) ** 2.6 + (Math.abs(gz - (zf + zb) / 2) / ((zf - zb) / 2 - 1.1)) ** 2.6 <= 1;
        if (inner && !top) continue;
        const c = stripe(y);
        m.set(x, y, z, c, flag(c));
      }
  }
  // brow band + uraeus cobra with a carnelian eye
  for (let x = -7; x <= 6; x++) m.set(x, 57, 7, G0[2], VF.METAL);
  for (const [x, y, z, c] of [[-1, 58, 8, 0], [0, 58, 8, 0], [-1, 59, 8, 2], [0, 59, 8, 0], [-1, 60, 9, 0], [0, 60, 9, 2], [-1, 61, 9, 1], [0, 61, 9, 1]] as number[][]) m.set(x, y, z, G0[c], VF.METAL);
  m.set(-1, 60, 10, 0xa8321e).set(0, 60, 10, 0xa8321e);
  // lappets falling over the front of the shoulders
  for (const s1 of [1, -1])
    for (let y = 36; y <= 50; y++)
      for (let x = 7; x <= 9; x++)
        for (let z = 0; z <= 3; z++) {
          const c = stripe(y);
          m.set(s1 > 0 ? x : -1 - x, y, z, y === 36 ? G0[1] : c, y === 36 ? VF.METAL : flag(c));
        }
  // the queue at the back
  for (let y = 40; y <= 50; y++) for (let x = -2; x <= 1; x++) m.set(x, y, -10, stripe(y), flag(stripe(y)));
  return { model: m, top: 66 };
}

export function pharaohRig(): RigSpec {
  const F = new Fig();
  F.boneMirror('fore_r', 'fore_l'); // fists: the crook and the lid
  ageBones(F, { seed: 71, tint: 0x9a8058, amt: 0.3 });
  mummyBody(F, { variant: 2, headWrap: false });
  emberEyes(F, 0x7fe0ff, { orb: 0x0a1418 });
  const G0 = METAL.gold;
  // braided false beard under the chin
  const jw = F.s('jaw');
  for (let y = 38; y <= 44; y++) for (const x of [-1, 0]) for (const z of [3, 4]) jw.m.set(x, y, z, (y & 1) ? G0[0] : LAP, (y & 1) ? VF.METAL : VF.SOLID);
  jw.m.set(-1, 37, 4, G0[2], VF.METAL).set(0, 37, 4, G0[2], VF.METAL);
  // gold arm rings and bracelets
  for (const s1 of [1, -1]) {
    wrapShell(F.s(s1 > 0 ? 'arm_l' : 'arm_r'), 38, 39, (x: number, y: number) => (y === 39 ? G0[2] : G0[0]), () => true, VF.METAL);
    wrapShell(F.s(s1 > 0 ? 'fore_l' : 'fore_r'), 26, 27, (x: number, y: number) => (y === 27 ? LAP : G0[0]), () => true, VF.METAL);
  }
  const top = addHat(F, nemes());
  // the crook (heka): banded staff hanging from the right fist, hook curling forward at the bottom
  const wp = F.part('weapon', 'fore_r', F.J.hand_r);
  for (let y = 5; y <= 25; y++) for (const x of [-10, -9]) wp.m.set(x, y, 0, (y >> 1) & 1 ? LAP : G0[0], (y >> 1) & 1 ? VF.SOLID : VF.METAL);
  const hook: [number, number][] = [[4, 0], [3, 1], [3, 2], [3, 3], [4, 4], [5, 5], [6, 5], [7, 5], [8, 4]];
  for (const [y, dz] of hook) for (const x of [-10, -9]) wp.m.set(x, y, dz, G0[dz === 5 ? 2 : 0], VF.METAL);
  F.sock('crook_tip', 'weapon', [-9, 8.5, 4.5]);
  // his own sarcophagus lid as a shield on the left forearm (outer side, faces +X)
  const sd = F.part('shield', 'fore_l', [11, 27, 0]);
  for (let y = 3; y <= 44; y++) {
    const hw = y >= 37 ? 7 - Math.round((y - 37) * 0.75) : y <= 8 ? 4 + Math.round((y - 3) * 0.6) : 7;
    for (let z = -hw; z < hw; z++) {
      const rim = z === -hw || z === hw - 1;
      const c = rim ? G0[1] : y >= 33 ? G0[0] : y >= 28 ? (Math.abs(z + 0.5) < 2.5 ? G0[2] : LAP) : (y + Math.abs(z)) % 4 === 0 ? G0[0] : LAP;
      sd.m.set(12, y, z, c, c === LAP ? VF.SOLID : VF.METAL);
      sd.m.set(11, y, z, 0x5a3a22);
    }
  }
  for (const z of [-3, 2]) for (const y of [38, 39]) sd.m.set(13, y, z, 0x141012); // the lid's own kohl eyes
  sd.m.set(13, 36, -1, G0[1], VF.METAL).set(13, 36, 0, G0[1], VF.METAL);
  for (let y = 28; y <= 33; y++) sd.m.set(13, y, -1, LAP).set(13, y, 0, LAP); // beard
  for (let z = -5; z <= 4; z++) sd.m.set(13, 22 + Math.round(Math.abs(z + 0.5) * 0.6), z, 0xa8321e); // crossed arms
  F.sock('cape_anchor', 'torso', [0, 44, -8]);
  finish(F);
  const spec = F.build('pharaoh', figMeta(F, 'pharaoh', {
    boss: true,
    height: top * F.vs,
    radius: 0.54,
    defaultExpression: 'judging',
    frontGuard: true,
    expressions: defaultExpressions(BOSS_EXPR),
    cloth: { cape: [0x2c56b3, 0x1b3a80, G0[0]] },
  }));
  return rescaleRig(spec, BOSS_VS);
}
void mix;
void frontZ;
