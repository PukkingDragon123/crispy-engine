// Cursed Mummy (STYLE v2, 1/28 — a touch bigger than the rank and file): a
// hulking tank wrapped in diagonal bandage bands, dark square eye sockets
// peeking out of the wraps, a broad gold-and-lapis usekh collar and a red
// heart-jewel amulet (the weak point, `heart` socket). v1 has a loose strip
// over one eye, v2 a gold headband with a cobra. Alpha: gold face mask,
// Set-red sash and spiked gold shoulder plates.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { toonSkull, toonPelvis, boneUpperArm, boneForearm, boneThigh, boneShin, buildHumanoid, defaultExpressions, sleeve, toonHand, JOINT } from '../toon/humanoid';
import { EnemyOpts, roundBox, roundBoxX, autoShade, mirrored, pickV } from './human';
import type { HumanoidParts } from '../toon/humanoid';

const WRAP: Ramp[] = [
  TOON.bandage,
  { base: 0xdacb9e, shade: 0xb8a77c, hi: 0xeee2bc, dark: 0x8a7a54 },
  { base: 0xd2c8b4, shade: 0xaea48e, hi: 0xe8e0ce, dark: 0x847a66 },
];

/** repaint every voxel of colour `base` with diagonal wrap bands */
export function wrapBands(m: VoxelModel, R: Ramp, period = 4) {
  const hits: [number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (c !== R.base) return;
    const b = (((y * 2 + x + (z >> 1)) % period) + period) % period;
    if (b === 0) hits.push([x, y, z, f]);
  });
  for (const [x, y, z, f] of hits) m.set(x, y, z, R.shade, f || VF.SOLID);
  return m;
}

export function mummyRig(o: EnemyOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = o.variant ?? 0;
  const W = pickV(WRAP, v);
  const G = TOON.gold, L = TOON.lapis, Q = TOON.turquoise;

  // ---------------------------------------------------------------- head: a skull fully wrapped, sockets left open
  const sk = toonSkull({ ramp: W, mouth: 'smile' });
  const head = sk.head;
  // wrap over the teeth / nose (keep the eye sockets)
  for (let x = -5; x <= 5; x++) for (const y of [39, 40, 41]) if (head.has(x, y, 6) || head.has(x, y, 5)) head.set(x, y, 6, W.base);
  for (let x = -4; x <= 4; x++) sk.jaw.set(x, 37, 6, W.base);
  // rounded crown wrap
  roundBox(head, -5, 52, -5, 5, 52, 4, W.base, 2);
  if (v === 1 && !alpha) for (let y = 40; y <= 47; y++) head.set(3 + ((y >> 1) & 1), y, 7, W.hi); // loose strip
  if (v === 2 && !alpha) {
    // gold headband + cobra
    for (let x = -7; x <= 7; x++) for (let z = -7; z <= 6; z++) if (head.has(x, 48, z) && (Math.abs(x) >= 6 || z >= 5 || z <= -6)) head.set(x, 48, z, G.base, VF.METAL);
    roundBox(head, -1, 49, 6, 1, 52, 7, G.base, 0, VF.METAL);
    head.set(0, 53, 7, G.hi, VF.METAL).set(0, 51, 8, TOON.red.base);
  }
  if (alpha) {
    // gold face mask around the sockets
    for (let x = -6; x <= 6; x++) for (let y = 39; y <= 47; y++) if (head.has(x, y, 6)) head.set(x, y, 6, (y === 47 || Math.abs(x) === 6) ? G.shade : G.base, VF.METAL);
    for (const s of [1, -1]) for (let y = 42; y <= 45; y++) head.set(s * 6, y, 7, L.base); // kohl lines
  }
  wrapBands(head, W);
  wrapBands(sk.jaw, W);

  // ---------------------------------------------------------------- torso: bulky wrapped block + usekh collar + heart amulet
  const torso = new VoxelModel('torso');
  roundBox(torso, -7, 24, -5, 7, 34, 4, W.base, 2);
  roundBox(torso, -2, 35, -3, 2, 37, 0, W.shade, 1); // neck
  for (let y = 31; y <= 34; y++)
    for (let x = -7; x <= 7; x++) {
      const r = 34 - y;
      if (Math.abs(x) > 3 + r * 1.3) continue;
      torso.set(x, y, 5, r === 0 ? G.base : r === 1 ? L.base : r === 2 ? G.hi : Q.base, r === 1 || r === 3 ? VF.SOLID : VF.METAL);
    }
  roundBox(torso, -1, 28, 5, 1, 30, 5, alpha ? TOON.setRed.base : TOON.red.base, 0);
  torso.set(0, 29, 6, TOON.red.hi);
  if (alpha) for (let y = 24; y <= 33; y++) for (const dx of [0, 1, 2]) torso.set(Math.round(-6 + (y - 24) * 1.3) + dx, y, 5, TOON.setRed.base);
  wrapBands(torso, W);
  autoShade(torso, [W]);

  // ---------------------------------------------------------------- pelvis + kilt
  const pelvis = toonPelvis({ ramp: W });
  roundBox(pelvis, -7, 17, -5, 7, 23, 4, W.base, 2);
  for (let x = -7; x <= 7; x++) for (let z = -5; z <= 4; z++) if (pelvis.has(x, 23, z)) pelvis.set(x, 23, z, G.base, VF.METAL);
  roundBox(pelvis, -2, 14, 5, 2, 22, 5, alpha ? TOON.setRed.base : L.base, 0); // apron
  wrapBands(pelvis, W);
  autoShade(pelvis, [W]);

  // ---------------------------------------------------------------- limbs: bone cores in fat bandage sleeves
  const armL = boneUpperArm({ ramp: W });
  sleeve(armL, 6, 10, 25, 33, -2, 2, W);
  if (alpha) {
    roundBox(armL, 6, 32, -3, 11, 35, 3, G.base, 1, VF.METAL);
    for (let i = 0; i < 3; i++) armL.set(9 + (i === 1 ? 1 : 0), 36 + i, 0, G.hi, VF.METAL);
  }
  const foreL = boneForearm({ ramp: W, pose: 'open' });
  sleeve(foreL, 6, 10, 17, 24, -2, 2, W);
  toonHand(foreL, { ramp: W, pose: 'open' });
  const thighL = boneThigh({ ramp: W });
  roundBox(thighL, 2, 12, -2, 6, 20, 2, W.base, 1);
  const shinL = boneShin({ ramp: W });
  roundBox(shinL, 2, 2, -2, 6, 11, 2, W.base, 1);
  roundBox(shinL, 2, 0, -2, 6, 1, 4, W.shade, 1);
  for (const m of [armL, foreL, thighL, shinL]) {
    wrapBands(m, W);
    autoShade(m, [W]);
  }
  const P: HumanoidParts = {
    pelvis,
    torso,
    head,
    jaw: sk.jaw,
    eye_l: sk.eye_l,
    eye_r: sk.eye_r,
    brow_l: sk.brow_l,
    brow_r: sk.brow_r,
    arm_l: armL,
    fore_l: foreL,
    arm_r: mirrored(armL, 'arm_r'),
    fore_r: mirrored(foreL, 'fore_r'),
    thigh_l: thighL,
    shin_l: shinL,
    thigh_r: mirrored(thighL, 'thigh_r'),
    shin_r: mirrored(shinL, 'shin_r'),
  };
  const VS = 1 / 28;
  return buildHumanoid({
    name: `mummy${alpha ? '_alpha' : ''}_v${v}`,
    parts: P,
    voxelSize: VS,
    topY: 54,
    radius: 0.36,
    sockets: { heart: { part: 'torso', at: [0.5, 29.5, 6] } },
    expressions: defaultExpressions(['neutral', 'angry', 'hurt', 'surprised', 'dead', 'stunned']),
    meta: { kind: 'mummy', alpha, headY: 44 * VS, armor: true, weakPoint: 'heart' },
  });
}
void roundBoxX;
void JOINT;
