// Jackal Warrior (STYLE v2, 1/30): Anubis's temple guard. Big cartoon jackal
// head (long snout, black nose, tall gold-trimmed ears, square eye sockets
// under heavy brows), furry chest with a gold usekh collar, white linen kilt
// with a lapis apron, bushy tail, a bronze khopesh (`weapon`, fore_r, hanging
// down with the hook forward) and a painted shield (`shield`, fore_l, facing +X).
// v1 golden-sand fur, v2 grey fur. Alpha: black fur, gold chest plate + ear caps.
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { toonPelvis, buildHumanoid, defaultExpressions, sleeve, toonHand, pantLeg, JOINT, mirrorV3 } from '../toon/humanoid';
import type { HumanoidParts } from '../toon/humanoid';
import { EnemyOpts, roundBox, roundBoxX, autoShade, mirrored, pickV } from './human';
import { seg, chain } from './tk';

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

export function jackalRig(o: EnemyOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = o.variant ?? 0;
  const F = alpha ? TOON.black : pickV(FUR, v);
  const G = TOON.gold;
  const hd = jackalHead(F, { gold: G, alpha });

  // ---------------------------------------------------------------- torso: furry chest + usekh collar (+ alpha chest plate)
  const torso = new VoxelModel('torso');
  roundBox(torso, -6, 24, -4, 6, 34, 4, F.base, 2);
  roundBox(torso, -4, 25, 5, 4, 30, 5, F.hi, 1); // chest fluff
  roundBox(torso, -2, 35, -3, 2, 38, 1, F.shade, 1); // neck
  for (let y = 31; y <= 35; y++)
    for (let x = -7; x <= 7; x++) {
      const r = 35 - y;
      if (Math.abs(x) > 3 + r * 1.2) continue;
      torso.set(x, y, 5, r % 2 === 0 ? G.base : TOON.lapis.base, r % 2 === 0 ? VF.METAL : VF.SOLID);
    }
  if (alpha) roundBox(torso, -5, 25, 5, 5, 30, 6, G.base, 1, VF.METAL);
  autoShade(torso, [F]);

  // ---------------------------------------------------------------- pelvis: linen kilt, gold belt, lapis apron
  const pelvis = toonPelvis({ ramp: F });
  roundBox(pelvis, -6, 16, -4, 6, 23, 3, TOON.linen.base, 2);
  for (let x = -6; x <= 6; x++) for (let z = -4; z <= 3; z++) if (pelvis.has(x, 23, z)) pelvis.set(x, 23, z, G.base, VF.METAL);
  for (let y = 16; y <= 22; y++) for (let x = -2 + ((22 - y) >> 2); x <= 2 - ((22 - y) >> 2); x++) pelvis.set(x, y, 4, TOON.lapis.base);
  for (let x = -6; x <= 6; x += 2) for (let z = -4; z <= 3; z++) if (pelvis.has(x, 16, z) && (Math.abs(x) === 6 || z === 3 || z === -4)) pelvis.set(x, 16, z, TOON.linen.shade); // pleats
  autoShade(pelvis, [TOON.linen]);

  // ---------------------------------------------------------------- limbs
  const { arm, fore } = furArms(F, G);
  const thigh = pantLeg('thigh', F);
  const shin = pantLeg('shin', F);
  roundBox(shin, 2, 0, -2, 5, 2, 4, F.shade, 1); // paw
  for (const x of [2, 4]) shin.set(x, 0, 5, TOON.black.base);
  const foreR = mirrored(fore, 'fore_r');

  // ---------------------------------------------------------------- tail
  const tail = new VoxelModel('tail');
  chain(tail, [[0, 20, -5], [0, 17, -8], [0, 12, -9], [0, 8, -8]], [1.6, 2.2, 2.2, 1.4], F.base);
  seg(tail, [0, 9, -8.5], [0, 7, -8], 1.3, F.hi);
  autoShade(tail, [F]);

  // ---------------------------------------------------------------- khopesh (right hand, hanging down, hook forward)
  const hr = mirrorV3(JOINT.hand);
  const hx = Math.round(hr[0] - 0.5), hz = Math.round(hr[2] - 0.5);
  const weapon = new VoxelModel('weapon');
  roundBox(weapon, hx - 1, 11, hz - 1, hx, 15, hz, TOON.wood.dark, 0); // grip
  weapon.set(hx - 1, 10, hz, BRONZE.dark, VF.METAL).set(hx, 10, hz, BRONZE.dark, VF.METAL);
  for (let y = 3; y <= 9; y++) for (let z = hz - 1; z <= hz + 1; z++) weapon.set(hx - 1, y, z, z === hz + 1 ? BRONZE.hi : BRONZE.base, VF.METAL);
  // the sickle hook curling forward at the bottom
  const hook: [number, number][] = [[2, 0], [1, 1], [1, 2], [1, 3], [2, 4], [3, 5], [4, 5]];
  for (const [y, dz] of hook) for (let w = 0; w < 2; w++) weapon.set(hx - 1, y - w, hz + dz, dz >= 4 ? BRONZE.hi : BRONZE.base, VF.METAL);

  // ---------------------------------------------------------------- shield on the left forearm (outer side, faces +X)
  const shield = new VoxelModel('shield');
  const sx = 11;
  for (let y = 13; y <= 26; y++)
    for (let z = -5; z <= 5; z++) {
      const top = y >= 24 ? Math.abs(z) <= 4 - (y - 24) * 1.5 : true;
      if (!top) continue;
      const rim = Math.abs(z) === 5 || y === 13 || (y >= 24 && Math.abs(z) >= 3 - (y - 24));
      shield.set(sx, y, z, rim ? G.base : TOON.wood.base, rim ? VF.METAL : VF.SOLID);
      shield.set(sx - 1, y, z, TOON.wood.shade);
    }
  // painted eye of Horus
  for (const [y, z, c] of [[20, -2, 0], [20, -1, 0], [20, 0, 0], [20, 1, 0], [21, -1, 1], [21, 0, 1], [19, 0, 0], [18, 1, 0], [17, 2, 0]] as [number, number, number][]) shield.set(sx + 1, y, z, c ? TOON.lapis.hi : TOON.lapis.base);
  autoShade(shield, [TOON.wood]);

  const P: HumanoidParts = {
    pelvis,
    torso,
    head: hd.head,
    jaw: hd.jaw,
    eye_l: hd.eye_l,
    eye_r: hd.eye_r,
    brow_l: hd.brow_l,
    brow_r: hd.brow_r,
    arm_l: arm,
    fore_l: fore,
    arm_r: mirrored(arm, 'arm_r'),
    fore_r: foreR,
    thigh_l: thigh,
    shin_l: shin,
    thigh_r: mirrored(thigh, 'thigh_r'),
    shin_r: mirrored(shin, 'shin_r'),
  };
  return buildHumanoid({
    name: `jackal${alpha ? '_alpha' : ''}_v${v}`,
    parts: P,
    joints: { eye: JACKAL_EYE, brow: JACKAL_BROW },
    extra: [
      { name: 'tail', model: tail, parent: 'pelvis', joint: [0.5, 20.5, -4.5] },
      { name: 'weapon', model: weapon, parent: 'fore_r', joint: hr },
      { name: 'shield', model: shield, parent: 'fore_l', joint: [10.5, 20, 0.5] },
    ],
    sockets: { blade_tip: { part: 'weapon', at: [hx - 0.5, 0.5, hz + 5.5] }, head_top: { part: 'head', at: [0.5, 62, -2] } },
    topY: 62,
    radius: 0.34,
    expressions: defaultExpressions(['neutral', 'angry', 'snarl', 'hurt', 'surprised', 'dead', 'stunned']),
    meta: { kind: 'jackal', alpha, headY: 46 / 30, blocksFront: true, weaponRest: '-Y, hook toward +Z', shieldFacing: '+X' },
  });
}
void roundBoxX;

