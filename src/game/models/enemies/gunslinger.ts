// Skeletal Gunslinger (STYLE v2, 1/30): "Quickest Draw in the Afterlife".
// Toon bone skeleton in villain black: cowboy hat, neckerchief, open leather
// vest over the ribs, gun belt with bullet loops, boots with spurs and a
// revolver (`gun` part on fore_r, barrel down at rest so it aims forward when
// the arm raises). v1 wide grey hat + black bandana, v2 bowler + blue bandana.
// Alpha: tall black hat with a silver star, bandolier, long gold revolver.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { skeletonParts, buildHumanoid, defaultExpressions, boneShin, cowboyBoot, JOINT, mirrorV3 } from '../toon/humanoid';
import { EnemyOpts, roundBox, autoShade, mirrored, hatModel, HatStyle, bandana, gunBelt, revolverDown, pickV } from './human';

/** open leather vest on a toon torso (leaves the sternum + inner ribs visible) */
export function vest(T: VoxelModel, R: Ramp, buttons: Ramp) {
  roundBox(T, -6, 25, -5, 6, 33, -5, R.base, 1); // back
  for (const s of [1, -1]) {
    roundBox(T, s > 0 ? 5 : -7, 25, -4, s > 0 ? 7 : -5, 33, 3, R.base, 1); // side
    roundBox(T, s > 0 ? 3 : -7, 25, 4, s > 0 ? 7 : -3, 32, 4, R.base, 0); // front panel
    T.set(s * 3, 31, 5, R.hi).set(s * 3, 30, 5, R.hi); // lapel fold
    for (const y of [27, 29]) T.set(s * 4, y, 5, buttons.base, VF.METAL);
  }
  // little pocket square
  T.set(5, 30, 5, TOON.red.base);
  return T;
}

export function bootShins(B: Ramp, boot: Ramp, spur: Ramp | null = TOON.silver) {
  const shin = boneShin({ ramp: B, foot: (m) => cowboyBoot(m, { ramp: boot, spur }) });
  return { shin_l: shin, shin_r: mirrored(shin, 'shin_r') };
}

export function gunslingerRig(o: EnemyOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = o.variant ?? 0;
  const B = TOON.bone;
  const P = skeletonParts({ ramp: B, skull: { mouth: alpha ? 'fangs' : 'grin', crack: v === 1 || alpha }, handR: { pose: 'fist' }, handL: { pose: v === 2 ? 'open' : 'fist' } });
  const looks: [HatStyle, Ramp, Ramp, Ramp][] = [
    ['cowboy', TOON.black, TOON.red, TOON.red],
    ['wide', { base: 0x7a7470, shade: 0x5e5854, hi: 0x948e88, dark: 0x3e3a36 }, TOON.black, TOON.black],
    ['bowler', TOON.hat, TOON.black, TOON.denim],
  ];
  const [hs, hatR, bandR, neckR] = alpha ? (['tall', TOON.black, TOON.setRed, TOON.setRed] as [HatStyle, Ramp, Ramp, Ramp]) : pickV(looks, v);
  P.hat = hatModel(hs, hatR, bandR, { bullet: v === 0, star: alpha ? TOON.silver : undefined, feather: alpha ? TOON.setRed : undefined });
  bandana(P.torso, neckR);
  vest(P.torso, alpha ? TOON.black : TOON.leatherDark, TOON.brass);
  if (alpha) {
    // bandolier across the chest
    for (let y = 25; y <= 33; y++) {
      const x = Math.round(-6 + (y - 25) * 1.5);
      for (const dx of [0, 1]) P.torso.set(x + dx, y, 5, TOON.leather.base);
      if (y % 2 === 0) P.torso.set(x, y, 6, TOON.brass.hi, VF.METAL);
    }
  }
  gunBelt(P.pelvis, TOON.leather, TOON.brass, { loops: true, holster: true });
  Object.assign(P, bootShins(B, alpha ? TOON.black : TOON.leather));
  autoShade(P.torso, [TOON.leatherDark, TOON.black]);

  const gun = new VoxelModel('gun');
  revolverDown(gun, alpha ? TOON.gold : TOON.iron, alpha ? TOON.bone : TOON.wood, { long: alpha });
  return buildHumanoid({
    name: `gunslinger${alpha ? '_alpha' : ''}_v${v}`,
    parts: P,
    extra: [{ name: 'gun', model: gun, parent: 'fore_r', joint: mirrorV3(JOINT.hand) }],
    topY: hs === 'tall' ? 62 : 57,
    radius: 0.3,
    expressions: defaultExpressions(['neutral', 'angry', 'hurt', 'surprised', 'laugh', 'smug', 'dead', 'stunned']),
    meta: { kind: 'gunslinger', alpha, headY: 44 / 30, weaponRest: '-Y' },
  });
}
