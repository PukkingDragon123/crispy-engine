// The merchant's camel (the merchant herself is the tortoise lady in tortoise.ts).
// Camel: quadruped at 1/24 (body root, neck, head, jaw, eyes, 4 legs, tail).
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, V3 } from '../../../engine/voxel/Rig';
import { TOON, Ramp } from '../style';
import { roundBox, mirrored, mirrorV3, autoShade } from '../toon/humanoid';

export { TORTOISE_EXPRESSIONS as MERCHANT_EXPRESSIONS } from './tortoise';
/** the shopkeeper is now Old Mother Tamsin, the tortoise lady (see tortoise.ts) */
export { tortoiseLadyRig as merchantRig } from './tortoise';
export const CAMEL_EXPRESSIONS = ['neutral', 'bored', 'smug', 'spit'];


// ===================================================================== CAMEL (1/24)
const HIDE: Ramp = { base: 0xd2a066, shade: 0xb0804a, hi: 0xe8bc84, dark: 0x7a5228 };

function camelBody() {
  const m = new VoxelModel('body');
  // chunky barrel body
  roundBox(m, -7, 22, -16, 7, 34, 14, HIDE.base, 4);
  // big hump
  for (let y = 35; y <= 44; y++) {
    const t = (y - 35) / 9;
    const hx = Math.round(6 - t * 3), hz = Math.round(10 - t * 6);
    roundBox(m, -hx, y, -2 - hz, hx, y, -2 + hz, HIDE.base, 2);
  }
  // colourful saddle blanket draped over the hump
  for (let x = -8; x <= 8; x++)
    for (let z = -10; z <= 7; z++)
      for (let y = 27; y <= 45; y++) {
        if (!m.has(x, y, z)) continue;
        const outer = !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z);
        if (!outer) continue;
        const band = z === -10 || z === 7 || y === 27 ? TOON.gold.base : (z + 20) % 4 < 2 ? TOON.red.base : TOON.turquoise.base;
        m.set(x, y, z, band);
      }
  // tassels hanging from the blanket hem
  for (const s of [1, -1]) for (let z = -9; z <= 6; z += 3) m.set(s * 8, 26, z, TOON.gold.shade).set(s * 8, 25, z, TOON.red.base);
  // saddle bags
  for (const s of [1, -1]) roundBox(m, s * 8, 24, -15, s * 10, 31, -10, TOON.leather.base, 1);
  for (const s of [1, -1]) m.set(s * 10, 29, -13, TOON.brass.hi);
  // shaggy hump fur fringe
  for (let z = -10; z <= 6; z += 2) m.set(0, 45, z - 2, HIDE.shade);
  autoShade(m, [HIDE, TOON.leather]);
  return m;
}
function camelNeck() {
  const m = new VoxelModel('neck');
  // thick S-curved neck rising forward
  const pts: [number, number][] = [[28, 13], [30, 15], [32, 17], [35, 19], [38, 20], [41, 20], [44, 21]];
  for (const [y, z] of pts) roundBox(m, -3, y, z - 3, 3, y + 3, z + 3, HIDE.base, 2);
  // shaggy fringe under the neck
  for (const [y, z] of pts.slice(0, 5)) m.set(0, y, z + 4, HIDE.shade).set(1, y - 1, z + 4, HIDE.dark);
  autoShade(m, [HIDE]);
  return m;
}
function camelHead() {
  const m = new VoxelModel('head');
  // big cartoon head
  roundBox(m, -5, 45, 17, 5, 53, 28, HIDE.base, 3);
  // long muzzle
  roundBox(m, -4, 45, 29, 4, 50, 34, HIDE.hi, 2);
  m.set(-2, 49, 35, HIDE.dark).set(2, 49, 35, HIDE.dark);
  // ears + fuzzy tuft
  for (const s of [1, -1]) roundBox(m, s * 5, 53, 19, s * 6, 55, 20, HIDE.shade, 0);
  roundBox(m, -3, 54, 21, 3, 55, 26, HIDE.dark, 1);
  // bridle with brass studs
  for (let y = 45; y <= 52; y++) for (const s of [1, -1]) m.set(s * 6, y, 27, TOON.red.base);
  for (let x = -4; x <= 4; x++) m.set(x, 51, 31 - (Math.abs(x) === 4 ? 1 : 0), TOON.red.base);
  for (const s of [1, -1]) m.set(s * 6, 48, 28, TOON.brass.hi);
  // heavy-lidded brows over the side eyes
  for (const s of [1, -1]) for (let z = 21; z <= 25; z++) m.set(s * 6, 51, z, HIDE.shade);
  autoShade(m, [HIDE]);
  return m;
}
function camelJaw() {
  // big floppy lower lip (chews)
  const m = new VoxelModel('jaw');
  roundBox(m, -4, 42, 25, 4, 44, 34, HIDE.shade, 2);
  for (let x = -3; x <= 3; x++) m.set(x, 44, 35, 0xb46a5a).set(x, 43, 35, 0xb46a5a);
  return m;
}
function camelLeg(front: boolean) {
  const m = new VoxelModel(front ? 'leg_fl' : 'leg_bl');
  const z = front ? 10 : -12;
  // thick thigh, knobby knee, sturdy shin, big flat padded foot
  roundBox(m, 3, 15, z - 3, 7, 25, z + 2, HIDE.base, 2);
  roundBox(m, 3, 12, z - 3, 7, 14, z + 2, HIDE.shade, 2);
  roundBox(m, 4, 3, z - 2, 6, 11, z + 1, HIDE.base, 1);
  roundBox(m, 3, 0, z - 3, 7, 2, z + 3, HIDE.dark, 2);
  autoShade(m, [HIDE]);
  return m;
}

export function camelRig(): RigSpec {
  const J = (name: string, model: VoxelModel, j: V3, parent?: string, rest?: V3): PartSpec => ({ name, model, pivot: j, attach: j, parent, rest });
  const eyeL = new VoxelModel('eye_l');
  // eye plug on the side of the head (+X), facing out
  for (let y = 48; y <= 50; y++) for (let z = 22; z <= 24; z++) eyeL.set(6, y, z, TOON.socket.dark);
  const fl = camelLeg(true), bl = camelLeg(false);
  const tail = new VoxelModel('tail');
  for (let y = 24; y <= 31; y++) tail.set(0, y, -17, HIDE.shade);
  roundBox(tail, -1, 21, -18, 1, 23, -17, HIDE.dark, 0);
  const parts: PartSpec[] = [
    J('body', camelBody(), [0.5, 28, 0.5]),
    J('neck', camelNeck(), [0.5, 29, 13], 'body'),
    J('head', camelHead(), [0.5, 46, 21], 'neck'),
    J('jaw', camelJaw(), [0.5, 44.5, 26], 'head'),
    J('eye_l', eyeL, [7, 49.5, 23.5], 'head', [0, Math.PI / 2, 0]),
    J('eye_r', mirrored(eyeL, 'eye_r'), mirrorV3([7, 49.5, 23.5]), 'head', [0, -Math.PI / 2, 0]),
    J('leg_fl', fl, [5.5, 24, 10], 'body'),
    J('leg_fr', mirrored(fl, 'leg_fr'), mirrorV3([5.5, 24, 10]), 'body'),
    J('leg_bl', bl, [5.5, 24, -12], 'body'),
    J('leg_br', mirrored(bl, 'leg_br'), mirrorV3([5.5, 24, -12]), 'body'),
    J('tail', tail, [0.5, 31, -16.5], 'body'),
  ];
  const expressions: Record<string, { jaw?: number }> = {};
  for (const e of CAMEL_EXPRESSIONS) expressions[e] = { jaw: e === 'spit' ? 0.35 : e === 'smug' ? 0.05 : 0 };
  const VS = 1 / 24;
  return {
    name: 'camel',
    voxelSize: VS,
    parts,
    sockets: { mouth: { part: 'jaw', at: [0.5, 43, 35] }, saddle: { part: 'body', at: [0.5, 45, -2] }, head_top: { part: 'head', at: [0.5, 56, 23] } },
    meta: { height: 56 * VS, length: 52 * VS, radius: 0.7, expressions },
  };
}
