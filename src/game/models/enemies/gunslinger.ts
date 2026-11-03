// Skeletal Gunslinger: "Quickest Draw in the Afterlife". Built on Sundown's own
// skeleton figure (characters/skeleton.ts, 1/36) with weathered outlaw bones and
// ember eyes deep in the sockets, dressed in villain black: felt cowboy hat with a
// bullet hole, knotted neckerchief, open stitched leather vest, gun belt with
// brass cartridge loops and an empty holster, stitched boots with spurs, and a
// single-action revolver (`gun` on fore_r, barrel down at rest so it aims forward
// when the arm raises; `muzzle` socket). v1 wide grey hat + black bandana + a
// cracked skull, v2 bowler + blue bandana + open left hand. Alpha: tall black hat
// with a silver star and red feather, fangs, Set-red bandana, bandolier, long gold
// revolver.
// (vest / bootShins below are the legacy toon helpers still used by sethos.ts.)
import type { RigSpec } from '../../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { skeletonParts, buildHumanoid, defaultExpressions, boneShin, cowboyBoot, JOINT, mirrorV3 } from '../toon/humanoid';
import { EnemyOpts, roundBox, autoShade, mirrored, hatModel, HatStyle, bandana, gunBelt, revolverDown, pickV } from './human';
import { Fig, finish, figMeta } from './figure/fig';
import { ageBones, emberEyes, skullCrack, fangs, hatG, addHat, HatKind, neckerchief, vestG, bandolierG, gunBeltG, bootG, revolverG, METAL } from './figure/gear';


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
  const v = (((o.variant ?? 0) % 3) + 3) % 3;
  const F = new Fig();
  if (alpha || v !== 2) F.boneMirror('fore_r', 'fore_l'); // left fist (v2 keeps the open hand)
  ageBones(F, { seed: v + (alpha ? 7 : 0), tint: alpha ? 0x7a6a58 : 0xb89a6a, amt: alpha ? 0.34 : 0.22 });
  if (v === 1 || alpha) skullCrack(F);
  if (alpha) fangs(F);
  emberEyes(F, alpha ? 0xff2a10 : 0xff6a20);
  const looks: { hat: HatKind; felt: number; band: number; neck: number; vest: number }[] = [
    { hat: 'cowboy', felt: 0x2a2422, band: 0x8a2a20, neck: 0x9a3424, vest: 0x4a2c18 },
    { hat: 'wide', felt: 0x6a6460, band: 0x1e1a18, neck: 0x2a2624, vest: 0x5a3a22 },
    { hat: 'bowler', felt: 0x6a4428, band: 0x1e1a18, neck: 0x3a5a8a, vest: 0x3e2a1a },
  ];
  const L = alpha ? { hat: 'tall' as HatKind, felt: 0x1e1a1a, band: 0x8a1e16, neck: 0x8a1e16, vest: 0x221c1a } : looks[v];
  const top = addHat(F, hatG(L.hat, L.felt, L.band, { bullet: v === 0 && !alpha, star: alpha ? METAL.silver : undefined, feather: alpha ? [0x8a1e16, 0x5a1410] : undefined, seed: v + 1 }));
  neckerchief(F, L.neck, v);
  vestG(F, L.vest, { seed: v, buttons: alpha ? METAL.silver : METAL.brass });
  if (alpha) bandolierG(F, 0x3a2414);
  gunBeltG(F, 0x6a4226, alpha ? METAL.gold : METAL.brass, { loops: true, holster: true, seed: v });
  for (const s1 of [1, -1]) bootG(F, s1, alpha ? 0x221c1a : [0x5a3820, 0x3a2a20, 0x6a4226][v], { seed: v, spur: alpha ? METAL.gold : METAL.silver });
  revolverG(F, { long: alpha, metal: alpha ? METAL.gold : METAL.iron, grip: alpha ? 0xe8dcc0 : 0x6a4226 });
  finish(F);
  return F.build(`gunslinger${alpha ? '_alpha' : ''}_v${v}`, figMeta(F, 'gunslinger', {
    alpha,
    variant: v,
    height: top * F.vs,
    radius: 0.3,
    weaponRest: '-Y',
    expressions: defaultExpressions(['neutral', 'angry', 'hurt', 'surprised', 'laugh', 'smug', 'dead', 'stunned']),
  }));
}
void hatModel;
void bandana;
void gunBelt;
void revolverDown;
void pickV;
void skeletonParts;
void buildHumanoid;
void JOINT;
void mirrorV3;
void VoxelModel;
void VF;
void TOON;
