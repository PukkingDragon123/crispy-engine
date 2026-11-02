// Upgrade attachments for Sundown — STYLE v2, on the hero's own 1/30 grid so they sit
// naturally on his body. Each model is built around its socket point (voxel origin 0,0,0
// = the socket): mesh it with pivot [0,0,0] (returned as `pivot`) and parent it to
// rig.sockets[socket]. Faces +Z like the hero; his RIGHT side is -X.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { roundBox, autoShade } from '../toon/humanoid';

export type AttachmentId =
  | 'scarab_pauldron'
  | 'scorpion_cape'
  | 'locust_bandolier'
  | 'venom_tank'
  | 'bone_crown'
  | 'serket_halo'
  | 'sun_disk'
  | 'feather_plume'
  | 'dynamite_belt'
  | 'sheriff_star'
  | 'ankh_amulet'
  | 'beetle_backpack';
export const ATTACHMENT_IDS: AttachmentId[] = ['scarab_pauldron', 'scorpion_cape', 'locust_bandolier', 'venom_tank', 'bone_crown', 'serket_halo', 'sun_disk', 'feather_plume', 'dynamite_belt', 'sheriff_star', 'ankh_amulet', 'beetle_backpack'];

type V3 = [number, number, number];
export interface Attachment {
  model: VoxelModel;
  voxelSize: number;
  socket: string;
  offset?: V3;
  rot?: V3;
  /** voxel-space pivot to mesh with (always the socket point) */
  pivot: V3;
}

const VS = 1 / 30;
const G = TOON.gold, L = TOON.lapis, T = TOON.turquoise, B = TOON.bone;
const CH: Ramp = { base: 0xcf6a32, shade: 0xa44e22, hi: 0xec8c50, dark: 0x5e2810 };
const M = VF.METAL;

/** 5-point star in the XY plane at depth z (sheriff star / badges) */
function star(m: VoxelModel, cx: number, cy: number, z: number, c: Ramp) {
  const px: [number, number, number][] = [
    [0, 3, c.hi], [0, 2, c.base], [-1, 1, c.base], [0, 1, c.hi], [1, 1, c.base], [-3, 1, c.shade], [-2, 1, c.base], [2, 1, c.base], [3, 1, c.shade],
    [-1, 0, c.base], [0, 0, c.base], [1, 0, c.base], [-1, -1, c.base], [1, -1, c.base], [0, -1, c.shade], [-2, -2, c.shade], [2, -2, c.shade],
  ];
  for (const [x, y, col] of px) m.set(cx + x, cy + y, z, col, M);
}

export function attachmentModel(id: AttachmentId): Attachment {
  const m = new VoxelModel('att_' + id);
  let socket = 'chest';
  switch (id) {
    case 'scarab_pauldron': {
      // lapis scarab shell over the right shoulder, gold rim, turquoise wing lines
      socket = 'shoulder_r';
      roundBox(m, -6, 0, -3, 0, 2, 3, L.base, 2);
      roundBox(m, -5, 3, -2, -1, 3, 2, L.base, 1);
      for (let z = -3; z <= 3; z++) if (m.has(-6, 0, z)) m.set(-6, 0, z, G.base, M);
      for (let z = -2; z <= 2; z++) m.set(-3, 3, z, G.hi, M);
      m.set(-5, 2, 3, T.base).set(-1, 2, 3, T.base).set(-3, 2, 4, G.base, M);
      break;
    }
    case 'scorpion_cape': {
      // stiff chitin mantle on the back with a scorpion-tail ridge
      socket = 'back';
      for (let y = -6; y <= 6; y++) {
        const hw = y >= 4 ? 8 : 7 - Math.max(0, -y - 3);
        for (let x = -hw; x <= hw; x++) m.set(x, y, -2, (y + 40) % 3 === 0 ? CH.shade : CH.base);
      }
      for (let y = -5; y <= 5; y++) m.set(0, y, -3, (y & 1) ? CH.hi : CH.base);
      m.set(0, -6, -3, CH.dark).set(0, -7, -2, CH.dark).set(0, -8, -1, TOON.serket.base);
      for (const s of [1, -1]) m.set(s * 8, 6, -1, G.base, M);
      break;
    }
    case 'locust_bandolier': {
      // diagonal strap from left shoulder to right hip with locust capsule pouches
      socket = 'chest';
      for (let i = -6; i <= 6; i++) {
        const x = i, y = Math.round(i * 0.9);
        m.set(x, y, 1, TOON.leatherDark.base).set(x, y + 1, 1, TOON.leatherDark.base);
        if (i % 3 === 0) roundBox(m, x, y - 1, 2, x + 1, y + 1, 2, i === 0 ? G.base : TOON.green.base, 0);
      }
      break;
    }
    case 'venom_tank': {
      // brass tank with a venom-green window and a feed tube over the shoulder
      socket = 'back';
      roundBox(m, -3, -6, -6, 3, 5, -2, TOON.brass.base, 2, M);
      for (let y = -4; y <= 3; y++) m.set(0, y, -7, TOON.serket.base).set(1, y, -7, y > 0 ? TOON.serket.hi : TOON.serket.base);
      for (const y of [-5, 4]) for (let x = -3; x <= 3; x++) m.set(x, y, -7 + (Math.abs(x) === 3 ? 1 : 0), TOON.brass.shade, M);
      for (let i = 0; i < 6; i++) m.set(-3 - (i >> 1), 6 + (i >> 2), -4 + i, TOON.black.base);
      break;
    }
    case 'bone_crown': {
      // ring of little bones + a skull on top of the hat
      socket = 'hat_top';
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * 5), z = Math.round(Math.sin(ang) * 5);
        m.set(x, 0, z, B.base);
        if (a % 2 === 0) m.set(x, 1, z, B.base).set(x, 2, z, B.hi);
      }
      roundBox(m, -1, 1, 4, 1, 3, 6, B.base, 1);
      m.set(-1, 2, 7, TOON.socket.dark).set(1, 2, 7, TOON.socket.dark);
      break;
    }
    case 'serket_halo': {
      // floating gold ring with a small scorpion at the front
      socket = 'hat_top';
      for (let a = 0; a < 28; a++) {
        const ang = (a / 28) * Math.PI * 2;
        m.set(Math.round(Math.cos(ang) * 8), 4, Math.round(Math.sin(ang) * 8), a % 7 === 0 ? G.hi : G.base, M);
      }
      roundBox(m, -1, 4, 8, 1, 5, 9, CH.base, 0);
      m.set(0, 6, 7, CH.base).set(0, 7, 8, CH.dark).set(-2, 4, 10, CH.shade).set(2, 4, 10, CH.shade);
      break;
    }
    case 'sun_disk': {
      // Ra's sun disc behind the shoulders with stubby rays
      socket = 'back';
      for (let x = -8; x <= 8; x++)
        for (let y = -2; y <= 14; y++) {
          const r = Math.hypot(x, y - 6);
          if (r <= 6.6) m.set(x, y, -3, r > 5.4 ? G.shade : r < 2 ? TOON.red.hi : r < 3.6 ? TOON.red.base : G.base, M);
        }
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        m.set(Math.round(Math.cos(ang) * 8), 6 + Math.round(Math.sin(ang) * 8), -3, G.hi, M);
      }
      break;
    }
    case 'feather_plume': {
      // Ma'at feather tucked into the hat band (left side)
      socket = 'hat_top';
      for (let i = 0; i < 9; i++) {
        const x = 8 + (i >> 2), y = -6 + i, z = -2 + (i >> 3);
        m.set(x, y, z, i > 6 ? TOON.white.hi : TOON.white.base).set(x, y, z - 1, i > 6 ? TOON.white.hi : TOON.white.base);
        if (i % 3 === 1) m.set(x, y, z, TOON.turquoise.base);
      }
      break;
    }
    case 'dynamite_belt': {
      // four red sticks with fuses strapped on the right hip
      socket = 'hip_r';
      for (let s = 0; s < 4; s++) {
        const x = -2 - s, z = 1 + (s & 1);
        for (let y = -4; y <= 1; y++) m.set(x, y, z, y === 1 ? TOON.red.hi : TOON.red.base);
        m.set(x, 2, z, TOON.linen.shade);
      }
      for (let x = -6; x <= -1; x++) m.set(x, -2, 3, TOON.leatherDark.base);
      break;
    }
    case 'sheriff_star': {
      socket = 'chest';
      star(m, 5, 1, 2, G);
      break;
    }
    case 'ankh_amulet': {
      // gold ankh on a cord at the sternum
      socket = 'chest';
      for (const [x, y] of [[0, -2], [0, -1], [0, 0], [-1, 1], [1, 1], [-2, 1], [2, 1], [0, 2], [-1, 3], [1, 3], [-1, 4], [1, 4], [0, 5]] as [number, number][]) m.set(x, y, 2, G.base, M);
      m.set(0, 1, 2, T.base);
      for (let i = 1; i <= 4; i++) m.set(-1 - i, 5 + i, 1, TOON.leatherDark.base).set(1 + i, 5 + i, 1, TOON.leatherDark.base);
      break;
    }
    case 'beetle_backpack': {
      // a big scarab shell backpack with straps
      socket = 'back';
      roundBox(m, -5, -6, -7, 5, 6, -2, TOON.turquoise.shade, 3);
      for (let y = -5; y <= 5; y++) m.set(0, y, -8, TOON.turquoise.dark);
      for (const s of [1, -1]) for (let y = -4; y <= 4; y += 4) m.set(s * 3, y, -8, TOON.turquoise.hi);
      roundBox(m, -3, 7, -6, 3, 9, -3, TOON.turquoise.base, 1); // head
      m.set(-2, 8, -7, G.base, M).set(2, 8, -7, G.base, M);
      for (const s of [1, -1]) for (let y = -4; y <= 6; y++) m.set(s * 4, y, -1, TOON.leatherDark.base);
      break;
    }
  }
  autoShade(m, [L, CH, G, TOON.brass, B], { hi: false });
  return { model: m, voxelSize: VS, socket, offset: [0, 0, 0], rot: [0, 0, 0], pivot: [0, 0, 0] };
}
