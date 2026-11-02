// The Dust Marshal (STYLE v2 boss, 1/20 — same toon layout, bigger voxels):
// an undead lawman who "keeps the law" for Set. Wide hat, a comically big tin
// star, handlebar mustache, open vest, stiff duster shoulders (`cape_anchor`
// + meta.cloth.cape for the engine-cloth tails), two revolvers (`gun_l`,
// `gun_r`), a coiled lasso (`lasso` socket) and a jailer's key ring.
// Tier 2 (returns once): black hat with gold band, gold star, a scar, extra
// bandolier. Tier 3 (final): Set's corruption — horns, red duster, gold guns.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { skeletonParts, buildHumanoid, defaultExpressions, JOINT, mirrorV3 } from '../toon/humanoid';
import { roundBox, autoShade, mirrored, hatModel, bandana, gunBelt, revolverDown } from './human';
import { bootShins, vest } from './gunslinger';
import { seg } from './tk';

export const BOSS_EXPR = ['neutral', 'angry', 'enraged', 'hurt', 'laugh', 'smug', 'stunned', 'defeated'];

/** big 5-point tin star on the chest (torso, front face z=5) */
export function tinStar(T: VoxelModel, cx: number, cy: number, z: number, R: Ramp) {
  const pts: [number, number][] = [[0, 4], [0, 3], [-1, 2], [0, 2], [1, 2], [-4, 1], [-3, 1], [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [-3, -2], [-2, -2], [2, -2], [3, -2], [-3, -3], [3, -3]];
  for (const [x, y] of pts) T.set(cx + x, cy + y, z, x === 0 && y === 0 ? R.dark : y > 0 && x <= 0 ? R.hi : R.base, VF.METAL);
  T.set(cx, cy + 1, z + 1, R.hi, VF.METAL);
}

export function dustMarshalRig(tier = 1): RigSpec {
  const T3 = Math.max(1, Math.min(3, tier | 0));
  const B = TOON.bone;
  const P = skeletonParts({ ramp: B, skull: { mouth: T3 === 3 ? 'fangs' : 'grin', crack: T3 >= 2 }, handR: { pose: 'fist' }, handL: { pose: 'fist' } });
  const hatR = T3 === 1 ? TOON.hat : T3 === 2 ? TOON.black : TOON.bone;
  const bandR = T3 === 1 ? TOON.leatherDark : T3 === 2 ? TOON.gold : TOON.setRed;
  P.hat = hatModel('wide', hatR, bandR, { star: T3 >= 2 ? TOON.gold : TOON.silver });
  const H = P.head;
  // handlebar mustache under the nose
  const mus: [number, number][] = [[-1, 40], [0, 40], [1, 40], [-2, 40], [2, 40], [-3, 40], [3, 40], [-4, 41], [4, 41], [-5, 41], [5, 41], [-5, 42], [5, 42]];
  for (const [x, y] of mus) H.set(x, y, 7, T3 === 3 ? TOON.setRed.dark : TOON.black.base);
  if (T3 >= 2) {
    // scar slash across the right brow + a sticking plaster on the cranium
    for (const [x, y] of [[-6, 49], [-6, 48], [-5, 47], [-2, 41], [-1, 40]] as [number, number][]) if (H.has(x, y, 6)) H.set(x, y, 6, B.dark);
    roundBox(H, 2, 49, 5, 5, 50, 6, TOON.bandage.base, 0);
    H.set(3, 50, 7, TOON.bandage.shade).set(4, 49, 7, TOON.bandage.shade);
  }
  if (T3 === 3) {
    for (const s of [1, -1]) {
      seg(H, [s * 6, 49, -1], [s * 10, 53, -2], 1.5, TOON.setRed.dark);
      seg(H, [s * 10, 53, -2], [s * 11, 58, -1], 1.0, TOON.black.base, undefined, 0.5);
    }
  }
  // torso: bandana, vest, star, duster shoulders
  const T = P.torso;
  bandana(T, T3 === 3 ? TOON.black : TOON.red);
  vest(T, T3 === 1 ? TOON.leatherDark : TOON.black, TOON.brass);
  const coat = T3 === 3 ? TOON.setRed : TOON.duster;
  roundBox(T, -7, 26, -6, 7, 35, -6, coat.base, 1);
  for (const s of [1, -1]) roundBox(T, s > 0 ? 6 : -9, 30, -5, s > 0 ? 9 : -6, 35, 2, coat.base, 2); // shoulder capes
  tinStar(T, 4, 29, 6, T3 >= 2 ? TOON.gold : TOON.silver);
  if (T3 >= 2) for (let y = 25; y <= 33; y++) for (const dx of [0, 1]) T.set(Math.round(-6 + (y - 25) * 1.4) + dx, y, 6, TOON.leather.base);
  autoShade(T, [coat]);
  // pelvis: belt, holsters, lasso coil, key ring
  gunBelt(P.pelvis, TOON.leather, T3 >= 2 ? TOON.gold : TOON.silver, { loops: true, holster: true });
  for (let a = 0; a < 14; a++) {
    const t = (a / 14) * Math.PI * 2;
    for (const r of [3, 4]) P.pelvis.set(8, 17 + Math.round(Math.sin(t) * r), Math.round(Math.cos(t) * r) - 1, TOON.wood.hi);
  }
  roundBox(P.pelvis, -9, 17, -1, -9, 19, 1, TOON.iron.base, 0, VF.METAL);
  P.pelvis.set(-9, 16, 0, TOON.brass.base, VF.METAL).set(-9, 15, 1, TOON.brass.base, VF.METAL);
  Object.assign(P, bootShins(B, T3 === 3 ? TOON.black : TOON.leather));

  const metal = T3 === 3 ? TOON.gold : TOON.iron;
  const gunR = new VoxelModel('gun_r');
  revolverDown(gunR, metal, TOON.bone, { long: true });
  const gunL = mirrored(gunR, 'gun_l');
  const VS = 1 / 20;
  const lc = [8.5, 17.5, -0.5] as [number, number, number];
  return buildHumanoid({
    name: `dust_marshal_${T3}`,
    parts: P,
    voxelSize: VS,
    extra: [
      { name: 'gun_r', model: gunR, parent: 'fore_r', joint: mirrorV3(JOINT.hand) },
      { name: 'gun_l', model: gunL, parent: 'fore_l', joint: JOINT.hand },
    ],
    sockets: {
      cape_anchor: { part: 'torso', at: [0.5, 34, -7] },
      lasso: { part: 'pelvis', at: lc },
      head_top: { part: 'hat', at: [0.5, 58, 0.5] },
    },
    topY: 58,
    radius: 0.32 * 1.5,
    expressions: defaultExpressions(BOSS_EXPR),
    meta: {
      kind: 'dust_marshal',
      tier: T3,
      boss: true,
      headY: 44 * VS,
      defaultExpression: 'smug',
      cloth: { cape: [coat.base, coat.shade, T3 === 3 ? TOON.black.base : TOON.leatherDark.base] },
    },
  });
}
