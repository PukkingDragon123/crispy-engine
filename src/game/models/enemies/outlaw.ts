// Dune Outlaw (STYLE v2, 1/30): Set's posse. A toon skeleton bandit standing
// on a battered sandboard (`board`, a root-level part so the stance can yaw
// while the board tracks travel): bandana mask over the jaw, cowboy hat, stiff
// duster shoulders over an open shirt, gun belt, boots and a revolver (`gun`).
// v1 blue mask + black hat, v2 black mask + grey hat + poncho. Alpha: skull-
// painted black mask, tall hat, Set-red duster, gold-trimmed board.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { skeletonParts, buildHumanoid, defaultExpressions, JOINT, mirrorV3 } from '../toon/humanoid';
import { EnemyOpts, roundBox, autoShade, mirrored, hatModel, HatStyle, gunBelt, revolverDown, liftSpec, pickV } from './human';
import { bootShins } from './gunslinger';

const BH = 3; // board top in voxels: the rider stands on it

/** a sandboard plank along Z with kicked nose/tail, iron bands, painted stripe */
export function riderBoard(W: Ramp, trim: Ramp, stripe: Ramp) {
  const m = new VoxelModel('board');
  for (let z = -21; z <= 21; z++) {
    const az = Math.abs(z);
    const w = az > 18 ? 5 - (az - 18) : 5;
    const lift = az > 16 ? Math.min(3, az - 16) : 0;
    for (let x = -w; x <= w; x++) {
      const c = Math.abs(x) <= 1 && az < 15 ? stripe.base : W.base;
      m.set(x, lift, z, Math.abs(x) === w ? W.shade : c);
      m.set(x, lift + 1, z, (az === 21 || Math.abs(x) === w) ? trim.base : c, (az === 21 || Math.abs(x) === w) && trim !== W ? VF.METAL : VF.SOLID);
    }
  }
  for (const zb of [-12, 12]) for (let x = -5; x <= 5; x++) m.set(x, 2, zb, TOON.iron.base, VF.METAL);
  // foot straps
  for (const zf of [-7, 7]) for (let x = -4; x <= 4; x++) if (Math.abs(x) >= 3) m.set(x, 2, zf, TOON.leatherDark.base).set(x, 2, zf + 1, TOON.leatherDark.base);
  autoShade(m, [W]);
  return m;
}

export function outlawRiderRig(o: EnemyOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = o.variant ?? 0;
  const B = TOON.bone;
  const P = skeletonParts({ ramp: B, skull: { mouth: 'grin', crack: v === 2 }, handR: { pose: 'fist' }, handL: { pose: 'fist' } });
  const looks: [HatStyle, Ramp, Ramp, Ramp][] = [
    ['cowboy', TOON.hat, TOON.red, TOON.red],
    ['cowboy', TOON.black, TOON.denim, TOON.denim],
    ['wide', TOON.woodGrey, TOON.black, TOON.black],
  ];
  const [hs, hatR, bandR, maskR] = alpha ? (['tall', TOON.black, TOON.setRed, TOON.black] as [HatStyle, Ramp, Ramp, Ramp]) : pickV(looks, v);
  P.hat = hatModel(hs, hatR, bandR, { bullet: v === 1 });
  // bandana mask over the jaw + nose (the jaw keeps the mask so it moves with it)
  const H = P.head, J = P.jaw!;
  for (let x = -7; x <= 7; x++)
    for (let z = -7; z <= 7; z++) {
      for (const y of [39, 40, 41]) if (H.has(x, y, z) || H.has(x, y, z - 1) || (y === 41 && Math.abs(x) <= 2 && z === 6)) if (Math.abs(x) >= 6 || z >= 5) H.set(x, y, z === 5 ? 6 : z, maskR.base);
    }
  for (let x = -5; x <= 5; x++) for (let z = -1; z <= 7; z++) for (let y = 35; y <= 38; y++) if (J.has(x, y, z) || (y >= 36 && z === 7 && Math.abs(x) <= 5)) J.set(x, y, z, y === 35 ? maskR.shade : maskR.base);
  for (let i = 0; i < 3; i++) for (let x = -2 + i; x <= 2 - i; x++) J.set(x, 34 - i, 7, maskR.shade);
  if (alpha) for (const [x, y] of [[-3, 37], [-1, 37], [1, 37], [3, 37], [-2, 36], [2, 36]] as [number, number][]) J.set(x, y, 8, TOON.bone.base); // painted teeth
  // stiff duster shoulders + back over an open shirt
  const T = P.torso;
  const coat = alpha ? TOON.setRed : v === 2 ? TOON.poncho : TOON.duster;
  if (v === 2 && !alpha) {
    // poncho: a stepped tent over the shoulders
    for (let y = 26; y <= 34; y++) {
      const hw = 3 + Math.round((34 - y) * 0.6);
      for (let x = -hw - 1; x <= hw + 1; x++) for (let z = -5; z <= 4; z++) if (Math.abs(x) >= hw - 1 || z === -5 || z === 4) if (!(z === 4 && Math.abs(x) <= 1 && y >= 31)) T.set(x, y, z, (y - 26) % 3 === 0 ? coat.shade : coat.base);
    }
  } else {
    roundBox(T, -7, 24, -5, 7, 34, -5, coat.base, 1);
    for (const s of [1, -1]) {
      roundBox(T, s > 0 ? 5 : -8, 24, -4, s > 0 ? 8 : -5, 34, 3, coat.base, 1);
      roundBox(T, s > 0 ? 3 : -8, 25, 4, s > 0 ? 8 : -3, 33, 4, coat.base, 0);
      for (let y = 30; y <= 33; y++) T.set(s * 3, y, 5, coat.hi); // lapels
    }
    roundBox(T, -5, 34, -4, 5, 35, 0, coat.shade, 1); // collar
  }
  gunBelt(P.pelvis, TOON.leather, TOON.silver, { loops: !alpha, holster: true });
  Object.assign(P, bootShins(B, alpha ? TOON.black : TOON.leatherDark));
  autoShade(T, [coat]);
  const gun = new VoxelModel('gun');
  revolverDown(gun, TOON.iron, TOON.wood);
  const board = riderBoard(alpha ? TOON.black : TOON.wood, alpha ? TOON.gold : TOON.wood, alpha ? TOON.setRed : pickV([TOON.red, TOON.denim, TOON.poncho], v));

  const spec = buildHumanoid({
    name: `outlaw_rider${alpha ? '_alpha' : ''}_v${v}`,
    parts: P,
    extra: [
      { name: 'gun', model: gun, parent: 'fore_r', joint: mirrorV3(JOINT.hand) },
      { name: 'board', model: board, parent: undefined as unknown as string, joint: [0.5, 1, 0.5] },
    ],
    sockets: {
      coat_anchor_back: { part: 'torso', at: [0.5, 25, -6] },
      bandana_anchor: { part: 'head', at: [0.5, 40, -8] },
    },
    topY: (hs === 'tall' ? 62 : 57) + BH,
    radius: 0.32,
    expressions: defaultExpressions(['neutral', 'angry', 'hurt', 'surprised', 'laugh', 'dead']),
    meta: {
      kind: 'outlaw_rider',
      alpha,
      headY: (44 + BH) / 30,
      boardTop: BH / 30,
      cloth: { duster: [coat.base, coat.shade, TOON.leather.dark], bandana: [maskR.base, maskR.shade, 0xf0e6d6] },
    },
  });
  // stand the rider on the board
  liftSpec(spec, BH, ['board']);
  // root-level board: no parent
  const bp = spec.parts.find((p) => p.name === 'board');
  if (bp) delete bp.parent;
  return spec;
}
void mirrored;
