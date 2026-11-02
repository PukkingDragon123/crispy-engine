// Small fun things — STYLE v2: dung bomb, rubber duck, dung ball, the dumb scarab.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, V3 } from '../../../engine/voxel/Rig';
import { TOON, Ramp } from '../style';
import { roundBox, mirrored, mirrorV3, autoShade } from '../toon/humanoid';

const DUNG = TOON.dung;
const STRAW = 0xd8b45a;

/** clean stair-stepped ball (radius in voxels), coloured per voxel by fn */
function ball(m: VoxelModel, r: number, col: (x: number, y: number, z: number) => number, cy = r) {
  const R = Math.ceil(r);
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++)
      for (let z = -R; z <= R; z++) if (x * x + y * y + z * z <= r * r + 0.6) m.set(x, cy + y, z, col(x, y, z));
  return m;
}

export function dungBombModel(): { model: VoxelModel; voxelSize: number; meta: Record<string, unknown> } {
  const VS = 1 / 48;
  const m = new VoxelModel('dung_bomb');
  // a ball of dung bound with twine, straw bits, fuse on top
  // twine wraps around the equator and over the top
  ball(m, 4.4, (x, y, z) => (y === 0 || x === 0 ? TOON.linen.shade : y > 2 ? DUNG.hi : y < -2 ? DUNG.shade : DUNG.base), 4);
  m.set(3, 7, 2, STRAW).set(-3, 6, -3, STRAW);
  // fuse
  m.set(0, 9, 0, TOON.leatherDark.base).set(0, 10, 0, TOON.linen.shade).set(1, 11, 0, TOON.linen.shade).set(1, 12, 0, TOON.linen.shade);
  m.set(2, 13, 0, 0xffd27a, VF.EMISSIVE);
  autoShade(m, [DUNG], { hi: false });
  return { model: m, voxelSize: VS, meta: { fuseTip: [2.5 * VS, 13.5 * VS, 0.5 * VS], radius: 0.1 } };
}

export function rubberDuckModel(): { model: VoxelModel; voxelSize: number; meta: Record<string, unknown> } {
  const VS = 1 / 48;
  const Y: Ramp = { base: 0xffd23a, shade: 0xe8a91c, hi: 0xffeb8a, dark: 0xb07a10 };
  const O: Ramp = { base: 0xff8a2a, shade: 0xd8661a, hi: 0xffac5a, dark: 0x9a4410 };
  const m = new VoxelModel('rubber_duck');
  // body
  roundBox(m, -5, 0, -7, 5, 5, 5, Y.base, 3);
  roundBox(m, -4, 6, -6, 4, 6, 3, Y.base, 2);
  // tail flick
  roundBox(m, -2, 5, -9, 2, 8, -7, Y.base, 1);
  // wings
  for (const s of [1, -1]) roundBox(m, s * 5, 2, -4, s * 6, 5, 1, Y.shade, 1);
  // head
  roundBox(m, -3, 7, 0, 3, 13, 6, Y.base, 2);
  // beak
  roundBox(m, -2, 8, 7, 2, 10, 9, O.base, 1);
  for (let x = -1; x <= 1; x++) m.set(x, 8, 9, O.shade);
  // eyes
  for (const s of [1, -1]) {
    m.set(s * 2, 11, 7, 0x1a1410).set(s * 2, 12, 7, 0x1a1410);
    m.set(s * 3, 12, 6, 0xffffff);
  }
  autoShade(m, [Y, O]);
  return { model: m, voxelSize: VS, meta: { height: 14 * VS, squashPivot: [0, 0, 0] } };
}

export function dungBallModel(): { model: VoxelModel; voxelSize: number; meta: Record<string, unknown> } {
  const VS = 1 / 30;
  const m = new VoxelModel('dung_ball');
  ball(m, 9, (_x, y) => (y > 5 ? DUNG.hi : y < -5 ? DUNG.shade : DUNG.base));
  // a few deliberate straw tufts poking out of the surface
  const tufts: [number, number, number, number, number][] = [[6, 14, 6, 1, 0], [-7, 11, 5, -1, 1], [2, 6, -8, 0, -1], [-4, 15, -6, -1, -1], [8, 8, -2, 1, 0], [0, 17, 3, 0, 1]];
  for (const [x, y, z, dx, dz] of tufts) m.set(x, y, z, STRAW).set(x + dx, y + 1, z + dz, STRAW);
  // rolled-in grooves (a couple of darker bands)
  for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) if (Math.abs(x + z) === 0 && m.has(x, 9 + Math.round(Math.sqrt(Math.max(0, 81 - x * x - z * z))), z)) m.paintAt(x, 9 + Math.round(Math.sqrt(Math.max(0, 81 - x * x - z * z))), z, DUNG.dark);
  // a pebble and a stuck feather for character
  m.set(6, 15, 4, TOON.stone.base).set(7, 14, 4, TOON.stone.shade);
  for (let i = 0; i < 4; i++) m.set(-3 - i, 17 + i, 2, i === 3 ? TOON.white.hi : TOON.white.base);
  return { model: m, voxelSize: VS, meta: { radius: 0.3 } };
}

/** the dumb scarab: chunky blue-green beetle, googly 2D eyes, stubby horn (beetle convention) */
export function dumbScarabRig(): RigSpec {
  const VS = 1 / 30;
  const SH: Ramp = { base: 0x3a7a8a, shade: 0x2a5a68, hi: 0x5aa0ac, dark: 0x1a3a44 };
  const UNDER = TOON.black;
  const body = new VoxelModel('body');
  roundBox(body, -4, 2, -5, 4, 4, 4, UNDER.base, 1);
  // pronotum (shield behind the head)
  roundBox(body, -4, 4, 2, 4, 7, 5, SH.base, 2);
  for (let x = -3; x <= 3; x++) body.set(x, 7, 4, SH.hi);
  autoShade(body, [SH]);
  const head = new VoxelModel('head');
  roundBox(head, -3, 2, 6, 3, 5, 8, SH.shade, 1);
  // stubby horn
  head.set(0, 6, 8, SH.base).set(0, 7, 8, SH.base).set(0, 8, 9, SH.hi);
  // mandibles + rake
  head.set(-2, 2, 9, UNDER.hi).set(2, 2, 9, UNDER.hi);
  for (let x = -2; x <= 2; x += 2) head.set(x, 3, 9, SH.dark);
  // googly eye bulbs (engine draws the pupils)
  const eyeL = new VoxelModel('eye_l');
  roundBox(eyeL, 2, 5, 7, 4, 7, 9, 0xfaf6ee, 1);
  const eyeR = mirrored(eyeL, 'eye_r');
  const wingL = new VoxelModel('wing_l');
  // elytron: shiny shell half with a rim and iridescent dots
  roundBox(wingL, 0, 5, -7, 5, 8, 2, SH.base, 2);
  for (let z = -6; z <= 1; z++) wingL.set(0, 8, z, SH.dark);
  for (const z of [-5, -2, 1]) wingL.set(3, 8, z, 0x7ad0b8);
  for (let z = -7; z <= 2; z++) for (let x = 1; x <= 4; x++) if (wingL.has(x, 8, z) && wingL.get(x, 8, z)! % 0x1000000 === SH.base) wingL.set(x, 8, z, SH.hi);
  autoShade(wingL, [SH], { hi: false });
  const wingR = mirrored(wingL, 'wing_r');
  const J = (name: string, model: VoxelModel, j: V3, parent?: string): PartSpec => ({ name, model, pivot: j, attach: j, parent });
  const eyeJ: V3 = [3.5, 6.5, 10];
  const parts: PartSpec[] = [
    J('body', body, [0.5, 3, 0.5]),
    J('head', head, [0.5, 4, 6], 'body'),
    J('eye_l', eyeL, eyeJ, 'head'),
    J('eye_r', eyeR, mirrorV3(eyeJ), 'head'),
    J('wing_l', wingL, [1, 8, 2.5], 'body'),
    J('wing_r', wingR, mirrorV3([1, 8, 2.5]), 'body'),
  ];
  const LZ = [3, 0, -3];
  for (let i = 0; i < 3; i++) {
    const leg = new VoxelModel('leg_l' + (i + 1));
    const z = LZ[i], dz = 1 - i;
    leg.set(5, 3, z, UNDER.base).set(6, 3, z, UNDER.base).set(7, 3, z + dz, UNDER.base);
    leg.set(7, 2, z + dz, UNDER.hi).set(8, 1, z + dz, UNDER.hi).set(8, 0, z + dz, UNDER.hi).set(8, 0, z + dz + 1, UNDER.base);
    const j: V3 = [5, 3.5, z + 0.5];
    parts.push(J('leg_l' + (i + 1), leg, j, 'body'), J('leg_r' + (i + 1), mirrored(leg, 'leg_r' + (i + 1)), mirrorV3(j), 'body'));
  }
  return { name: 'dumb_scarab', voxelSize: VS, parts, sockets: { push: { part: 'head', at: [0.5, 3, 10] } }, meta: { length: 16 * VS, height: 10 * VS, radius: 0.16 } };
}
