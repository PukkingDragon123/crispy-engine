// Pinch — Sundown's little scorpion buddy (Serket's messenger). STYLE v2:
// chunky, cute, clean. Amber chitin with darker segment bands, cream belly,
// big claws, curled tail with a venom-green drop on the stinger. 1/48 m.
// Scorpion convention: body (root), tail1..tail5, stinger, arm_l/arm_r, pincer_l/pincer_r,
// leg_l1..leg_l4, leg_r1..leg_r4, eye_l/eye_r (2D eyes drawn by the engine).
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, V3 } from '../../../engine/voxel/Rig';
import { TOON, Ramp } from '../style';
import { roundBox, mirrored, mirrorV3, autoShade } from '../toon/humanoid';

export const PINCH_EXPRESSIONS = ['neutral', 'happy', 'angry', 'sleepy', 'surprised', 'determined'] as const;
const VS = 1 / 48;

const A: Ramp = { base: 0xcf6a32, shade: 0xa44e22, hi: 0xec8c50, dark: 0x5e2810 };
const BAND = 0x7e3a18;
const BELLY = TOON.linen;
const SOCK = TOON.socket;

function body() {
  const m = new VoxelModel('body');
  // cephalothorax (head + chest): a rounded chunky block with a domed top
  roundBox(m, -3, 1, 1, 3, 5, 7, A.base, 2);
  roundBox(m, -2, 6, 2, 2, 6, 6, A.base, 1);
  // abdomen: ridged plates, tapering towards the tail
  for (let z = -7; z <= 0; z++) {
    const hx = z <= -5 ? 2 : 3;
    const ridge = (z & 1) === 0;
    const top = ridge ? 5 : 4;
    for (let x = -hx; x <= hx; x++) for (let y = 1; y <= top; y++) {
      if (Math.abs(x) === hx && y === top) continue;
      m.set(x, y, z, ridge && y === top ? A.base : y === top ? BAND : A.base);
    }
  }
  // cream belly plates
  for (let z = -6; z <= 6; z++) for (let x = -2; x <= 2; x++) m.set(x, 1, z, (z & 1) ? BELLY.base : BELLY.shade);
  // face: eye sockets (2x2, 1 deep) + mouth with tiny chelicerae
  for (const s of [1, -1]) {
    for (const x of [1, 2]) for (const y of [4, 5]) m.del(s * x, y, 7).set(s * x, y, 6, SOCK.dark);
    m.set(s * 1, 1, 8, BELLY.base).set(s * 1, 2, 8, BELLY.hi);
  }
  m.set(0, 2, 7, SOCK.base);
  // cheeks (rosy, he is a sweetheart)
  m.set(3, 2, 6, 0xf08a6a).set(-3, 2, 6, 0xf08a6a);
  autoShade(m, [A]);
  return m;
}

/** tail segments authored as a curled arc (pivot at each segment base) */
const TAIL: { box: [number, number, number, number, number, number]; pivot: V3 }[] = [
  { box: [-2, 2, -10, 2, 5, -8], pivot: [0.5, 3.5, -7.5] },
  { box: [-2, 6, -11, 2, 9, -9], pivot: [0.5, 6, -9.5] },
  { box: [-1, 10, -10, 1, 12, -8], pivot: [0.5, 10, -9.5] },
  { box: [-1, 12, -7, 1, 14, -5], pivot: [0.5, 12.5, -7.5] },
  { box: [-1, 12, -4, 1, 14, -2], pivot: [0.5, 13, -4.5] },
];

function tailSeg(i: number) {
  const m = new VoxelModel('tail' + (i + 1));
  const [x0, y0, z0, x1, y1, z1] = TAIL[i].box;
  roundBox(m, x0, y0, z0, x1, y1, z1, A.base, 1);
  // dark joint band where it meets the previous segment
  const bandAtFront = i >= 3;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const z = bandAtFront ? z0 : i === 2 ? z1 : z1;
      if (m.has(x, y, z) && (i < 2 ? y === y0 : true)) m.set(x, y, z, BAND);
    }
  // a lighter keel along the top
  for (let z = z0; z <= z1; z++) if (m.has(0, y1, z)) m.set(0, y1, z, A.hi);
  autoShade(m, [A], { hi: false });
  return m;
}

function stinger() {
  const m = new VoxelModel('stinger');
  // bulb
  roundBox(m, -1, 11, -1, 1, 14, 1, A.shade, 1);
  m.set(0, 14, 0, A.base).set(0, 13, 1, A.base);
  // curved barb, pointing forward-down
  m.set(0, 12, 2, A.dark).set(0, 11, 2, A.dark).set(0, 10, 3, A.dark);
  // venom drop
  m.set(0, 9, 3, TOON.serket.hi);
  return m;
}

function armL() {
  // pedipalp: from the front corner, out and forward, ending in the big claw's fixed half
  const m = new VoxelModel('arm_l');
  roundBox(m, 3, 2, 6, 4, 3, 8, A.base, 0);
  roundBox(m, 4, 2, 9, 5, 3, 10, A.base, 0);
  // claw "hand": chunky with a seam
  roundBox(m, 3, 1, 11, 7, 5, 14, A.base, 1);
  for (let y = 1; y <= 5; y++) if (m.has(7, y, 12)) m.set(7, y, 12, BAND);
  // fixed finger (outer) — dark tip
  roundBox(m, 6, 2, 15, 7, 4, 17, A.base, 0);
  m.set(6, 3, 18, A.dark).set(7, 3, 18, A.dark).set(6, 2, 18, A.dark);
  autoShade(m, [A]);
  return m;
}
function pincerL() {
  // movable finger (inner)
  const m = new VoxelModel('pincer_l');
  roundBox(m, 3, 2, 15, 4, 4, 17, A.base, 0);
  m.set(3, 3, 18, A.dark).set(4, 3, 18, A.dark).set(4, 2, 18, A.dark);
  autoShade(m, [A]);
  return m;
}

const LEG_Z = [5, 3, 1, -1];
function legL(i: number) {
  const m = new VoxelModel('leg_l' + (i + 1));
  const z = LEG_Z[i];
  const splay = i - 1.5; // back legs point backward a little
  const dz = Math.round(splay * 0.7);
  m.set(4, 3, z, A.base).set(5, 3, z, A.base).set(5, 4, z, A.base);
  m.set(6, 4, z + dz, A.base).set(6, 3, z + dz, A.shade);
  m.set(7, 2, z + dz, A.shade).set(7, 1, z + dz, A.shade).set(7, 0, z + dz, A.dark);
  return m;
}

export function pinchRig(): RigSpec {
  const J = (name: string, model: VoxelModel, joint: V3, parent?: string): PartSpec => ({ name, model, pivot: joint, attach: joint, parent });
  const parts: PartSpec[] = [J('body', body(), [0.5, 3, 0.5])];
  const parents = ['body', 'tail1', 'tail2', 'tail3', 'tail4'];
  for (let i = 0; i < 5; i++) parts.push(J('tail' + (i + 1), tailSeg(i), TAIL[i].pivot, parents[i]));
  parts.push(J('stinger', stinger(), [0.5, 13, -1.5], 'tail5'));
  const arm = armL(), pin = pincerL();
  const armJ: V3 = [3.5, 2.5, 6.5];
  const pinJ: V3 = [4, 3, 15];
  parts.push(J('arm_l', arm, armJ, 'body'), J('arm_r', mirrored(arm, 'arm_r'), mirrorV3(armJ), 'body'));
  parts.push(J('pincer_l', pin, pinJ, 'arm_l'), J('pincer_r', mirrored(pin, 'pincer_r'), mirrorV3(pinJ), 'arm_r'));
  for (let i = 0; i < 4; i++) {
    const leg = legL(i);
    const j: V3 = [4.5, 3.5, LEG_Z[i] + 0.5];
    parts.push(J(`leg_l${i + 1}`, leg, j, 'body'), J(`leg_r${i + 1}`, mirrored(leg, `leg_r${i + 1}`), mirrorV3(j), 'body'));
  }
  // eye plugs (engine hides them and draws 2D eyes in the sockets)
  const eye = new VoxelModel('eye_l');
  for (const x of [1, 2]) for (const y of [4, 5]) eye.set(x, y, 6, SOCK.dark);
  const eyeJ: V3 = [2, 5, 7];
  parts.push(J('eye_l', eye, eyeJ, 'body'), J('eye_r', mirrored(eye, 'eye_r'), mirrorV3(eyeJ), 'body'));
  const expressions: Record<string, { parts: Record<string, VoxelModel> }> = {};
  for (const e of PINCH_EXPRESSIONS) expressions[e] = { parts: {} };
  return {
    name: 'pinch',
    voxelSize: VS,
    parts,
    sockets: {
      stinger_tip: { part: 'stinger', at: [0.5, 9.5, 3.5] },
      pincer_l_tip: { part: 'arm_l', at: [5.5, 3, 18.5] },
      pincer_r_tip: { part: 'arm_r', at: mirrorV3([5.5, 3, 18.5]) },
      back: { part: 'body', at: [0.5, 6, -2] },
      head_top: { part: 'body', at: [0.5, 7, 4.5] },
    },
    meta: { length: 29 * VS, height: 15 * VS, radius: 0.1, expressions, faceParts: ['eye_l', 'eye_r'] },
  };
}

