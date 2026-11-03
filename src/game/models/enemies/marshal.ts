// The Dust Marshal (boss): an undead lawman who "keeps the law" for Set, built on
// Sundown's skeleton figure (characters/skeleton.ts: same parts, joints and
// proportions) and scaled up with bigger voxels (1/22) to boss size. Wide felt
// hat with a star, handlebar mustache, a big tin star on an open vest, stiff
// duster shoulders and sleeves (`cape_anchor` + meta.cloth.cape for the
// engine-cloth tails), two long revolvers (`gun_l`, `gun_r`), a coiled lasso
// (`lasso` socket) and a jailer's key ring.
// Tier 2 (returns once): black hat with gold band, gold star, a scar + plaster,
// bandolier. Tier 3 (final): Set's corruption — horns, fangs, red duster, gold guns.
// (tinStar below is the legacy toon helper; BOSS_EXPR is shared with sethos.ts.)
import type { RigSpec } from '../../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { skeletonParts, buildHumanoid, defaultExpressions, JOINT, mirrorV3 } from '../toon/humanoid';
import { roundBox, autoShade, mirrored, hatModel, bandana, gunBelt, revolverDown } from './human';
import { bootShins, vest } from './gunslinger';
import { seg } from './tk';
import { Fig, finish, figMeta, mix, mulRGB, clothC, hornG, G } from './figure/fig';
import { ageBones, emberEyes, fangs, hatG, addHat, shirtG, neckerchief, vestG, dusterG, sleeveG, bandolierG, gunBeltG, bootG, revolverG, frontZ, METAL, rescaleRig } from './figure/gear';


export const BOSS_EXPR = ['neutral', 'angry', 'enraged', 'hurt', 'laugh', 'smug', 'stunned', 'defeated'];

/** big 5-point tin star on the chest (torso, front face z=5) */
export function tinStar(T: VoxelModel, cx: number, cy: number, z: number, R: Ramp) {
  const pts: [number, number][] = [[0, 4], [0, 3], [-1, 2], [0, 2], [1, 2], [-4, 1], [-3, 1], [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [-3, -2], [-2, -2], [2, -2], [3, -2], [-3, -3], [3, -3]];
  for (const [x, y] of pts) T.set(cx + x, cy + y, z, x === 0 && y === 0 ? R.dark : y > 0 && x <= 0 ? R.hi : R.base, VF.METAL);
  T.set(cx, cy + 1, z + 1, R.hi, VF.METAL);
}

/** bosses on the figure use bigger voxels (Sundown's layout at boss size) */
export const BOSS_VS = 1 / 22;

export function dustMarshalRig(tier = 1): RigSpec {
  const T3 = Math.max(1, Math.min(3, tier | 0));
  const F = new Fig();
  F.boneMirror('fore_r', 'fore_l'); // two fists, two guns
  ageBones(F, { seed: 61 + T3, tint: T3 === 3 ? 0x7a5a48 : 0xb89a6a, amt: T3 === 3 ? 0.34 : 0.24 });
  if (T3 === 3) fangs(F);
  emberEyes(F, T3 === 3 ? 0xff2a10 : 0xffa030);
  const hd = F.s('head');
  // handlebar mustache
  const mus = T3 === 3 ? 0x4a1a14 : 0x1e1a18;
  for (let x = -4; x <= 3; x++) hd.m.set(x, 49, 6, mus);
  for (const s1 of [1, -1]) {
    const X = (x: number) => (s1 > 0 ? x : -1 - x);
    hd.m.set(X(4), 49, 6, mus).set(X(5), 50, 6, mus).set(X(6), 51, 5, mus).set(X(6), 52, 5, mix(mus, 0xffffff, 0.12));
  }
  if (T3 >= 2) {
    // a scar across the right brow and a sticking plaster on the crown
    for (const [x, y, z] of [[-6, 58, 4], [-5, 57, 5], [-4, 56, 5], [-6, 59, 3]] as G[]) if (hd.m.has(x, y, z)) hd.m.set(x, y, z, 0x6a4a2c);
    for (let x = 1; x <= 4; x++) for (const y of [60, 61]) hd.m.set(x, y, 5, (x + y) & 1 ? 0xe8dcc0 : 0xd8c8a8);
    hd.m.set(2, 61, 6, 0xc8b898).set(3, 60, 6, 0xc8b898);
  }
  if (T3 === 3) for (const s1 of [1, -1]) hornG(hd, [s1 * 5.4, 59.5, -1.0], [s1 * 0.85, 0.5, -0.15], 14, 2.3, (x: number, y: number) => mix(0x5a1a14, 0x1a0a08, Math.min(1, (y - 59) / 12)), [s1 * -0.3, 1.4, -0.3], 0x2a0e0a);
  // clothes: shirt, neckerchief, vest, stiff duster shoulders and sleeves, a big tin star
  const coat = T3 === 3 ? 0x8a2018 : 0x7c5638;
  shirtG(F, 0xd0c4a8, T3);
  neckerchief(F, T3 === 3 ? 0x1e1a1a : 0xa83424, T3);
  vestG(F, T3 === 1 ? 0x4a2c18 : 0x1e1a1a, { seed: T3, buttons: T3 >= 2 ? METAL.gold : METAL.brass });
  dusterG(F, coat, mulRGB(coat, 0.7), { seed: T3, tails: false });
  for (const s1 of [1, -1]) sleeveG(F, s1, clothC(coat, 60 + T3, { fold: 3, crease: mulRGB(coat, 0.8) }), { cuff: mulRGB(coat, 0.7) });
  if (T3 >= 2) bandolierG(F, 0x3a2414);
  const tr = F.s('torso');
  const S = T3 >= 2 ? METAL.gold : METAL.silver;
  const sz = frontZ(tr.m, 4, 38) + 1;
  const star: [number, number][] = [[0, 4], [0, 3], [-1, 2], [0, 2], [1, 2], [-4, 1], [-3, 1], [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [-3, -2], [-2, -2], [2, -2], [3, -2], [-3, -3], [3, -3]];
  for (const [x, y] of star) tr.m.set(4 + x, 37 + y, sz, x === 0 && y === 0 ? S[1] : y > 0 && x <= 0 ? S[2] : S[0], VF.METAL);
  tr.m.set(4, 38, sz + 1, S[2], VF.METAL);
  // belt, holsters, lasso coil on the left hip, key ring on the right
  gunBeltG(F, 0x5a3a22, S, { loops: true, holster: true, seed: T3 });
  const pv = F.s('pelvis');
  for (let k = 0; k < 3; k++) {
    const r = 3.4 - k * 0.5;
    for (let a = 0; a < 26; a++) {
      const t = (a / 26) * Math.PI * 2;
      pv.m.set(9 + (k & 1), Math.floor(20.5 + Math.sin(t) * r), Math.floor(-0.5 + Math.cos(t) * r), (a + k) & 1 ? 0xd8bc84 : 0xb49a64);
    }
  }
  for (const [x, y, z] of [[-9, 21, 2], [-10, 20, 2], [-10, 19, 3], [-9, 18, 3], [-8, 19, 3]] as G[]) pv.m.set(x, y, z, METAL.iron[0], VF.METAL);
  pv.m.set(-10, 18, 3, METAL.brass[0], VF.METAL).set(-11, 17, 3, METAL.brass[1], VF.METAL).set(-9, 17, 4, METAL.brass[0], VF.METAL);
  for (const s1 of [1, -1]) bootG(F, s1, T3 === 3 ? 0x1e1a1a : 0x5a3820, { seed: 60 + T3, spur: S });
  const gm = T3 === 3 ? METAL.gold : METAL.steel;
  revolverG(F, { name: 'gun_r', side: -1, long: true, metal: gm, grip: 0xe2d2b0 });
  revolverG(F, { name: 'gun_l', side: 1, long: true, metal: gm, grip: 0xe2d2b0 });
  const hatFelt = T3 === 1 ? 0x7a5236 : T3 === 2 ? 0x1e1a1a : 0xd8c8a8;
  const top = addHat(F, hatG('wide', hatFelt, T3 === 1 ? 0x3a2414 : T3 === 2 ? METAL.gold[0] : 0x8a1e16, { star: S, seed: 60 + T3 }));
  F.sock('cape_anchor', 'torso', [0, 44, -8]);
  F.sock('lasso', 'pelvis', [9.5, 20.5, -0.5]);
  finish(F);
  const spec = F.build(`dust_marshal_${T3}`, figMeta(F, 'dust_marshal', {
    tier: T3,
    boss: true,
    height: top * F.vs,
    radius: 0.48,
    defaultExpression: 'smug',
    expressions: defaultExpressions(BOSS_EXPR),
    cloth: { cape: [coat, mulRGB(coat, 0.78), T3 === 3 ? 0x1e1a1a : 0x4a2c18] },
  }));
  return rescaleRig(spec, BOSS_VS);
}
void skeletonParts;
void buildHumanoid;
void JOINT;
void mirrorV3;
void roundBox;
void autoShade;
void mirrored;
void hatModel;
void bandana;
void gunBelt;
void revolverDown;
void bootShins;
void vest;
void seg;
void TOON;
