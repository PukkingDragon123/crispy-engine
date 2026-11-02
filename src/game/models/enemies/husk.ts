// Sand Husk (STYLE v2, 1/30): the desert's shambling rank-and-file. A dried
// tan corpse on the toon skeleton layout: big cracked skull with deep square
// sockets and a gappy grin, a linen sash wrapped across the ribs, rope belt,
// tattered loincloth, wrapped wrists. v1 wears a rag hood, v2 a dented bucket.
// Alpha: ram horns, bone pauldrons, Set-red war paint and sash.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { skeletonParts, buildHumanoid, defaultExpressions } from '../toon/humanoid';
import { EnemyOpts, roundBox, roundBoxX, autoShade, mirrored, flap, pickV } from './human';
import { seg } from './tk';

export type { EnemyOpts };

const HUSK: Ramp[] = [
  TOON.husk,
  { base: 0xa88a66, shade: 0x8a6e4e, hi: 0xc4a682, dark: 0x5e4a32 },
  { base: 0xc2a882, shade: 0xa08866, hi: 0xd8c09c, dark: 0x6e5a40 },
];

export function huskRig(o: EnemyOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = o.variant ?? 0;
  const SK = alpha ? { base: 0x9a7a58, shade: 0x7a5e42, hi: 0xb8966e, dark: 0x4e3a26 } : pickV(HUSK, v);
  const RAG = TOON.bandage;
  const RED = TOON.setRed;
  const P = skeletonParts({ ramp: SK, skull: { mouth: alpha ? 'fangs' : 'grin', crack: true }, handL: { pose: 'open' }, handR: { pose: 'open' } });

  // ---------------------------------------------------------------- torso: linen sash wrapped across the ribs
  const T = P.torso;
  for (let y = 25; y <= 32; y++) {
    const x0 = Math.round(6 - (y - 25) * 1.5);
    for (let x = x0 - 1; x <= x0 + 1; x++) {
      if (Math.abs(x) > 6) continue;
      T.set(x, y, 4, alpha ? RED.base : RAG.base).set(x, y, -5, alpha ? RED.shade : RAG.shade);
    }
  }
  // ---------------------------------------------------------------- pelvis: rope belt + loincloth
  const PV = P.pelvis;
  roundBox(PV, -6, 22, -4, 6, 22, 2, TOON.leather.base, 1);
  PV.set(-3, 21, 3, TOON.leather.shade).set(-3, 20, 3, TOON.leather.shade);
  flap(PV, -3, 3, 21, 6, 3, alpha ? RED : RAG);
  flap(PV, -3, 3, 21, 5, -5, alpha ? RED : RAG);
  // ---------------------------------------------------------------- wrist wraps
  for (const [name, s] of [['fore_l', 1], ['fore_r', -1]] as [keyof typeof P, number][]) {
    const m = P[name]!;
    roundBox(m, s > 0 ? 6 : -10, 17, -2, s > 0 ? 10 : -6, 18, 1, RAG.base, 1);
  }
  // ---------------------------------------------------------------- head dressing
  const H = P.head;
  if (!alpha && v === 1) {
    // rag hood draped over the cranium
    for (let y = 44; y <= 52; y++)
      for (let x = -8; x <= 8; x++)
        for (let z = -8; z <= 5; z++) {
          if (H.has(x, y, z)) continue;
          const touching = H.has(x - 1, y, z) || H.has(x + 1, y, z) || H.has(x, y - 1, z) || H.has(x, y, z + 1) || H.has(x, y, z - 1);
          if (touching && (y >= 47 || z <= 0)) H.set(x, y, z, y === 44 ? RAG.shade : RAG.base);
        }
  } else if (!alpha && v === 2) {
    // dented bucket helmet
    roundBox(H, -6, 49, -6, 6, 54, 6, TOON.iron.base, 2, VF.METAL);
    roundBox(H, -7, 49, -7, 7, 49, 7, TOON.iron.shade, 2, VF.METAL);
    H.del(3, 54, 4).del(4, 54, 3).set(3, 53, 4, TOON.iron.dark);
    for (let x = -4; x <= 4; x++) H.set(x, 55, 0, TOON.iron.hi, VF.METAL); // handle
  } else {
    // dry hair tufts
    for (const [x, z, h] of [[-2, -1, 2], [1, 0, 3], [3, -3, 2], [-4, -4, 1]] as [number, number, number][]) for (let i = 1; i <= h; i++) H.set(x, 51 + i, z, TOON.dung.shade);
  }
  if (alpha) {
    // ram horns curling from the temples
    for (const s of [1, -1]) {
      seg(H, [s * 7, 48, -1], [s * 10, 50, -2], 1.6, TOON.bone.base);
      seg(H, [s * 10, 50, -2], [s * 11, 47, 0], 1.3, TOON.bone.shade);
      seg(H, [s * 11, 47, 0], [s * 10, 45, 2], 1.0, TOON.bone.dark);
    }
    // war paint stripes under the sockets
    for (const s of [1, -1]) for (let y = 39; y <= 41; y++) H.set(s * 4, y, 6, RED.base);
    // bone pauldrons with a spike
    for (const [name, s] of [['arm_l', 1], ['arm_r', -1]] as [keyof typeof P, number][]) {
      const m = P[name]!;
      roundBox(m, s > 0 ? 6 : -10, 32, -3, s > 0 ? 10 : -6, 34, 2, TOON.bone.base, 1);
      seg(m, [s * 8, 34, 0], [s * 10, 38, -1], 1, TOON.bone.hi, undefined, 0.4);
    }
  }
  for (const m of [T, PV, H]) autoShade(m, [RAG, RED]);

  return buildHumanoid({
    name: `husk${alpha ? '_alpha' : ''}_v${v}`,
    parts: P,
    topY: v === 2 && !alpha ? 56 : 53,
    radius: 0.3,
    expressions: defaultExpressions(['neutral', 'angry', 'hurt', 'surprised', 'laugh', 'dead', 'stunned']),
    meta: { kind: 'husk', alpha, headY: 44 / 30 },
  });
}
void roundBoxX;
void mirrored;
