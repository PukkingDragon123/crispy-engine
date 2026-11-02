// Serket's avatar — the colossal divine scorpion of the ultimate. STYLE v2 at 1/20 m (~5.3 m long):
// jade chitin plates with gold trims, a gold sun-disc diadem, huge claws, ringed curled tail.
// Scorpion convention: body, tail1..tail5, stinger, arm_l/arm_r, pincer_l/pincer_r, leg_l1..4/leg_r1..4.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, V3 } from '../../../engine/voxel/Rig';
import { TOON, Ramp } from '../style';
import { roundBox, mirrored, mirrorV3, autoShade } from '../toon/humanoid';

const VS = 1 / 20;
const JADE: Ramp = { base: 0x4fae9a, shade: 0x3a8a78, hi: 0x78d0bc, dark: 0x22584c };
const G = TOON.gold;
const BELLY = 0xcfe8d8;
const M = VF.METAL;

function body() {
  const m = new VoxelModel('body');
  // cephalothorax
  roundBox(m, -12, 8, 6, 12, 20, 30, JADE.base, 4);
  roundBox(m, -9, 21, 9, 9, 22, 27, JADE.base, 3);
  // abdomen plates with gold trailing edges
  for (let p = 0; p < 6; p++) {
    const z1 = 5 - p * 5, z0 = z1 - 4;
    const hx = 12 - Math.floor(p * 0.8);
    roundBox(m, -hx, 8, z0, hx, 19 - (p >> 1), z1, JADE.base, 3);
    for (let x = -hx + 2; x <= hx - 2; x++) m.set(x, 19 - (p >> 1), z0, G.base, M);
    m.set(0, 20 - (p >> 1), z0 + 2, JADE.hi);
  }
  // belly
  for (let z = -24; z <= 28; z++) for (let x = -8; x <= 8; x++) if (m.has(x, 8, z)) m.set(x, 8, z, (z & 3) === 0 ? JADE.shade : BELLY);
  // face: eye sockets (4x4, 1 deep) + mandibles
  for (const s of [1, -1]) {
    for (let i = 3; i <= 6; i++) for (let y = 14; y <= 17; y++) m.del(s * i, y, 30).set(s * i, y, 29, TOON.socket.dark);
    roundBox(m, s * 2, 9, 31, s * 4, 12, 33, JADE.shade, 1);
    m.set(s * 3, 9, 34, G.base, M);
  }
  // gold diadem with a sun disc between two horns
  for (let x = -10; x <= 10; x++) m.set(x, 21, 26 - (Math.abs(x) > 7 ? 2 : 0), G.base, M);
  for (let y = 23; y <= 33; y++)
    for (let x = -5; x <= 5; x++) {
      const r = Math.hypot(x, y - 28);
      if (r <= 5.2) m.set(x, y, 22, r > 4 ? G.shade : G.base, M);
    }
  m.set(0, 28, 23, TOON.red.hi);
  for (const s of [1, -1]) for (let i = 0; i < 8; i++) m.set(s * (6 + (i >> 1)), 22 + i, 22, G.base, M);
  autoShade(m, [JADE]);
  return m;
}

const TAIL: { box: [number, number, number, number, number, number]; pivot: V3 }[] = [
  { box: [-7, 10, -36, 7, 20, -28], pivot: [0.5, 15, -27] },
  { box: [-6, 21, -40, 6, 32, -32], pivot: [0.5, 21, -34] },
  { box: [-5, 33, -38, 5, 42, -30], pivot: [0.5, 33, -35] },
  { box: [-5, 41, -29, 5, 50, -21], pivot: [0.5, 43, -30] },
  { box: [-4, 43, -20, 4, 51, -12], pivot: [0.5, 46, -21] },
];
function tailSeg(i: number) {
  const m = new VoxelModel('tail' + (i + 1));
  const [x0, y0, z0, x1, y1, z1] = TAIL[i].box;
  roundBox(m, x0, y0, z0, x1, y1, z1, JADE.base, 3);
  // gold ring at the joint end
  const ringZ = i <= 1 ? null : i === 2 ? z1 : z0;
  if (ringZ !== null) for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (m.has(x, y, ringZ)) m.set(x, y, ringZ, G.base, M);
  else for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (m.has(x, y0, z)) m.set(x, y0, z, G.base, M);
  for (let z = z0 + 1; z <= z1 - 1; z++) if (m.has(0, y1, z)) m.set(0, y1, z, JADE.hi);
  autoShade(m, [JADE], { hi: false });
  return m;
}
function stinger() {
  const m = new VoxelModel('stinger');
  roundBox(m, -4, 40, -11, 4, 50, -2, JADE.shade, 3);
  for (let i = 0; i < 7; i++) roundBox(m, -1, 39 - i * 1.2, -1 + i, 1, 40 - i * 1.2, i, i > 4 ? G.shade : G.base, 0, M);
  return m;
}
function armL() {
  const m = new VoxelModel('arm_l');
  roundBox(m, 9, 10, 27, 13, 15, 35, JADE.base, 1);
  roundBox(m, 11, 10, 36, 15, 15, 44, JADE.base, 1);
  for (let y = 10; y <= 15; y++) m.set(13, y, 36, G.base, M);
  // claw hand ("palm"), with a gold seam
  roundBox(m, 9, 5, 45, 22, 18, 56, JADE.base, 4);
  for (let y = 7; y <= 16; y++) m.set(22, y, 50, G.shade, M);
  for (let z = 47; z <= 55; z += 4) m.set(16, 18, z, JADE.hi);
  // fixed outer finger: curves inward towards the tip, serrated inner edge
  const segs: [number, number, number, number][] = [[57, 60, 17, 22], [61, 64, 16, 21], [65, 68, 16, 20]];
  for (const [z0, z1, x0, x1] of segs) roundBox(m, x0, 8, z0, x1, 15, z1, JADE.base, 2);
  for (const z of [58, 62, 66]) m.set(16, 11, z, JADE.hi).set(15, 11, z, JADE.hi);
  roundBox(m, 16, 9, 69, 19, 13, 72, G.base, 1, M);
  m.set(16, 11, 73, G.hi, M);
  autoShade(m, [JADE]);
  return m;
}
function pincerL() {
  const m = new VoxelModel('pincer_l');
  const segs: [number, number, number, number][] = [[57, 60, 9, 13], [61, 64, 10, 13], [65, 67, 10, 13]];
  for (const [z0, z1, x0, x1] of segs) roundBox(m, x0, 8, z0, x1, 15, z1, JADE.base, 2);
  for (const z of [59, 63]) m.set(14, 11, z, JADE.hi);
  roundBox(m, 10, 9, 68, 13, 13, 71, G.base, 1, M);
  m.set(13, 11, 72, G.hi, M);
  autoShade(m, [JADE]);
  return m;
}
const LEG_Z = [24, 15, 6, -3];
function legL(i: number) {
  const m = new VoxelModel('leg_l' + (i + 1));
  const z = LEG_Z[i], dz = Math.round((i - 1.5) * 3);
  roundBox(m, 12, 12, z - 2, 19, 16, z + 2, JADE.base, 1);
  roundBox(m, 19, 13, z - 2 + dz, 23, 20, z + 2 + dz, JADE.base, 1);
  m.set(21, 20, z + dz, G.base, M);
  roundBox(m, 22, 4, z - 1 + dz, 25, 12, z + 1 + dz, JADE.shade, 1);
  roundBox(m, 23, 0, z - 1 + dz, 25, 3, z + 1 + dz, G.shade, 0, M);
  autoShade(m, [JADE], { hi: false });
  return m;
}

export function serketAvatarRig(): RigSpec {
  const J = (name: string, model: VoxelModel, j: V3, parent?: string): PartSpec => ({ name, model, pivot: j, attach: j, parent });
  const parts: PartSpec[] = [J('body', body(), [0.5, 14, 0.5])];
  const parents = ['body', 'tail1', 'tail2', 'tail3', 'tail4'];
  for (let i = 0; i < 5; i++) parts.push(J('tail' + (i + 1), tailSeg(i), TAIL[i].pivot, parents[i]));
  parts.push(J('stinger', stinger(), [0.5, 46, -11], 'tail5'));
  const a = armL(), p = pincerL();
  parts.push(J('arm_l', a, [11, 12.5, 28], 'body'), J('arm_r', mirrored(a, 'arm_r'), mirrorV3([11, 12.5, 28]), 'body'));
  parts.push(J('pincer_l', p, [12, 12, 59], 'arm_l'), J('pincer_r', mirrored(p, 'pincer_r'), mirrorV3([12, 12, 59]), 'arm_r'));
  for (let i = 0; i < 4; i++) {
    const l = legL(i);
    const j: V3 = [12.5, 14, LEG_Z[i] + 0.5];
    parts.push(J(`leg_l${i + 1}`, l, j, 'body'), J(`leg_r${i + 1}`, mirrored(l, `leg_r${i + 1}`), mirrorV3(j), 'body'));
  }
  const eye = new VoxelModel('eye_l');
  for (let i = 3; i <= 6; i++) for (let y = 14; y <= 17; y++) eye.set(i, y, 29, TOON.socket.dark);
  const eyeJ: V3 = [5, 16, 31];
  parts.push(J('eye_l', eye, eyeJ, 'body'), J('eye_r', mirrored(eye, 'eye_r'), mirrorV3(eyeJ), 'body'));
  return {
    name: 'serket_avatar',
    voxelSize: VS,
    parts,
    sockets: { stinger_tip: { part: 'stinger', at: [0.5, 32, 6] }, mask: { part: 'body', at: [0.5, 15, 31] }, crown: { part: 'body', at: [0.5, 28, 23] } },
    meta: { length: 112 * VS, height: 52 * VS, radius: 2.2, spirit: true, palette: { main: JADE.base, light: JADE.hi, dark: JADE.dark, gold: G.base } },
  };
}
