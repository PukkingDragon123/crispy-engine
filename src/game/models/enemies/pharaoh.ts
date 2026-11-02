// The Pharaoh (STYLE v2 boss, 1/20): an undead king. Toon skull face under a
// striped gold-and-lapis nemes with a cobra uraeus, braided false beard,
// bandage-wrapped body, a huge usekh collar, white kilt, a gold crook
// (`weapon`, fore_r, `crook_tip` socket) and his own sarcophagus lid as a
// shield (`shield`, fore_l, facing +X — the front guard). Cape is engine cloth
// from `cape_anchor` (meta.cloth.cape).
import type { RigSpec } from '../../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON } from '../style';
import { skeletonParts, buildHumanoid, defaultExpressions, sleeve, JOINT, mirrorV3 } from '../toon/humanoid';
import { roundBox, autoShade, mirrored } from './human';
import { wrapBands } from './mummy';
import { BOSS_EXPR } from './marshal';

export function pharaohRig(): RigSpec {
  const B = TOON.bone, G = TOON.gold, L = TOON.lapis, W = TOON.bandage;
  const P = skeletonParts({ ramp: B, skull: { mouth: 'smile' }, handR: { pose: 'fist' }, handL: { pose: 'fist' } });
  const H = P.head;
  // ---------------------------------------------------------------- nemes headdress
  const stripe = (y: number) => ((y >> 1) % 2 === 0 ? G : L);
  for (let y = 43; y <= 54; y++) {
    const hx = y >= 53 ? 6 : y >= 51 ? 7 : 8 + (y <= 46 ? 1 : 0);
    const zb = y >= 53 ? -6 : -8, zf = y >= 53 ? 4 : y >= 48 ? 6 : 1;
    for (let x = -hx; x <= hx; x++)
      for (let z = zb; z <= zf; z++) {
        if (H.has(x, y, z) && z >= 2) continue; // keep the face
        const shell = Math.abs(x) >= hx - 1 || z <= zb + 1 || y >= 52 || (y >= 48 && z >= 2);
        if (!shell) continue;
        const r = stripe(y);
        H.set(x, y, z, r.base, r === G ? VF.METAL : VF.SOLID);
      }
  }
  // brow band across the forehead
  for (let x = -7; x <= 7; x++) H.set(x, 48, 7, G.base, VF.METAL);
  // lappets falling in front of the shoulders
  for (const s of [1, -1])
    for (let y = 33; y <= 44; y++)
      for (let x = 6; x <= 9; x++)
        for (let z = 1; z <= 3; z++) {
          const r = stripe(y);
          H.set(s * x, y, z, r.base, r === G ? VF.METAL : VF.SOLID);
        }
  // uraeus cobra
  roundBox(H, -1, 49, 7, 1, 52, 8, G.base, 0, VF.METAL);
  H.set(0, 53, 8, G.hi, VF.METAL).set(0, 51, 9, TOON.red.base).set(-1, 52, 9, G.base, VF.METAL).set(1, 52, 9, G.base, VF.METAL);
  autoShade(H, [G, L]);
  // ---------------------------------------------------------------- braided false beard on the jaw
  const J = P.jaw!;
  for (let y = 30; y <= 35; y++) for (let x = -1; x <= 1; x++) for (let z = 5; z <= 7; z++) J.set(x, y, z, y % 2 === 0 ? G.base : L.base, y % 2 === 0 ? VF.METAL : VF.SOLID);
  // ---------------------------------------------------------------- body: wraps + usekh + kilt
  const T = P.torso;
  roundBox(T, -6, 24, -4, 6, 33, 3, W.base, 2);
  for (let y = 29; y <= 35; y++)
    for (let x = -9; x <= 9; x++) {
      const r = 35 - y;
      if (Math.abs(x) > 3 + r * 1.2) continue;
      for (const z of [4, 5]) if (z === 4 || r <= 4) T.set(x, y, z, r % 3 === 0 ? G.base : r % 3 === 1 ? L.base : TOON.turquoise.base, r % 3 === 0 ? VF.METAL : VF.SOLID);
    }
  roundBox(T, -1, 26, 5, 1, 28, 5, TOON.red.base, 0); // heart scarab
  T.set(0, 27, 6, G.hi, VF.METAL);
  wrapBands(T, W);
  autoShade(T, [W]);
  const PV = P.pelvis;
  roundBox(PV, -6, 15, -4, 6, 23, 3, TOON.white.base, 2);
  for (let x = -6; x <= 6; x++) for (let z = -4; z <= 3; z++) if (PV.has(x, 23, z)) PV.set(x, 23, z, G.base, VF.METAL);
  for (let y = 14; y <= 22; y++) for (let x = -2; x <= 2; x++) PV.set(x, y, 4, y % 2 ? G.base : L.base, y % 2 ? VF.METAL : VF.SOLID);
  autoShade(PV, [TOON.white]);
  for (const [name, s] of [['arm_l', 1], ['arm_r', -1]] as const) {
    const m = P[name];
    sleeve(m, s > 0 ? 6 : -9, s > 0 ? 9 : -6, 25, 32, -2, 1, W);
    roundBox(m, s > 0 ? 6 : -9, 29, -2, s > 0 ? 9 : -6, 30, 1, G.base, 0, VF.METAL);
    wrapBands(m, W);
  }
  for (const [name, s] of [['fore_l', 1], ['fore_r', -1]] as const) {
    const m = P[name];
    roundBox(m, s > 0 ? 6 : -9, 18, -2, s > 0 ? 9 : -6, 22, 1, G.base, 0, VF.METAL);
  }
  for (const [name] of [['thigh_l'], ['thigh_r'], ['shin_l'], ['shin_r']] as const) wrapBands(P[name], W);
  // ---------------------------------------------------------------- crook (right hand, hanging, hook at the bottom)
  const hr = mirrorV3(JOINT.hand);
  const hx = Math.round(hr[0] - 0.5), hz = Math.round(hr[2] - 0.5);
  const crook = new VoxelModel('weapon');
  for (let y = -4; y <= 16; y++) for (let x = hx - 1; x <= hx; x++) crook.set(x, y, hz, (y >> 1) % 2 ? L.base : G.base, (y >> 1) % 2 ? VF.SOLID : VF.METAL);
  const hook: [number, number][] = [[-5, 0], [-6, 1], [-6, 2], [-6, 3], [-5, 4], [-4, 4], [-3, 4]];
  for (const [y, dz] of hook) for (let x = hx - 1; x <= hx; x++) crook.set(x, y, hz + dz, G.base, VF.METAL);
  // ---------------------------------------------------------------- sarcophagus lid shield (left forearm, outer side)
  const lid = new VoxelModel('shield');
  const sx = 12;
  for (let y = 2; y <= 34; y++) {
    const hw = y >= 28 ? 6 - Math.round((y - 28) * 0.8) : y <= 6 ? 4 + Math.round((y - 2) * 0.5) : 6;
    for (let z = -hw; z <= hw; z++) {
      const rim = Math.abs(z) === hw;
      const c = rim ? G.dark : y >= 26 ? G.base : y >= 22 ? (Math.abs(z) <= 2 ? G.hi : L.base) : (y + Math.abs(z)) % 4 === 0 ? G.base : L.base;
      lid.set(sx, y, z, c, c === L.base ? VF.SOLID : VF.METAL);
      lid.set(sx - 1, y, z, TOON.wood.shade);
    }
  }
  // the lid's own face
  for (const zz of [-2, 2]) for (let y = 29; y <= 30; y++) lid.set(sx + 1, y, zz, TOON.black.base);
  lid.set(sx + 1, 27, 0, G.dark, VF.METAL);
  for (let y = 22; y <= 26; y++) lid.set(sx + 1, y, 0, L.base); // beard
  for (let z = -4; z <= 4; z++) lid.set(sx + 1, 18 + Math.round(Math.abs(z) * 0.5), z, TOON.red.base); // crossed arms
  autoShade(lid, [L]);
  const VS = 1 / 20;
  return buildHumanoid({
    name: 'pharaoh',
    parts: P,
    voxelSize: VS,
    extra: [
      { name: 'weapon', model: crook, parent: 'fore_r', joint: hr },
      { name: 'shield', model: lid, parent: 'fore_l', joint: [10.5, 20, 0.5] },
    ],
    sockets: {
      cape_anchor: { part: 'torso', at: [0.5, 33, -5] },
      crook_tip: { part: 'weapon', at: [hx + 0.5, -2.5, hz + 4.5] },
      head_top: { part: 'head', at: [0.5, 55, 0.5] },
    },
    topY: 55,
    radius: 0.36 * 1.5,
    expressions: defaultExpressions(BOSS_EXPR),
    meta: { kind: 'pharaoh', boss: true, headY: 44 * VS, defaultExpression: 'judging', frontGuard: true, cloth: { cape: [0x2c56b3, 0x1b3a80, G.base] } },
  });
}
void mirrored;
