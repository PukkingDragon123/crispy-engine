// STYLE v2 shared kit — clean, hand-made cartoon voxel art (see CONTRACT.md).
// One palette of 3-tone material ramps + a few clean-shape helpers. No noise,
// no dithering, no resampling: every voxel is placed on purpose.
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';

/** material ramp: base, shade (undersides / recesses), hi (top edges), dark (deep recess / outline accents) */
export interface Ramp {
  base: number;
  shade: number;
  hi: number;
  dark: number;
}
const r = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });

export const TOON = {
  bone: r(0xf2dcb4, 0xd6b78a, 0xfff1d6, 0xa9845a),
  socket: r(0x4a2c1a, 0x341e12, 0x5e3a24, 0x24140b),
  leather: r(0x9a5f35, 0x774726, 0xb97a48, 0x52301a),
  leatherDark: r(0x5e3a22, 0x452917, 0x75492c, 0x2e1a0e),
  hat: r(0x8a5a36, 0x6c4428, 0xa87046, 0x4a2c18),
  duster: r(0x7c5638, 0x5f4029, 0x97704c, 0x412b1a),
  denim: r(0x4f6a8c, 0x3c5270, 0x6886aa, 0x2a3a52),
  linen: r(0xeee0c0, 0xcfbd98, 0xfff4dc, 0xa8946e),
  red: r(0xc0442f, 0x963222, 0xdc6448, 0x6a2014),
  poncho: r(0xc8743a, 0xa0562a, 0xe39456, 0x6e3a1a),
  green: r(0x7cc04a, 0x5a9636, 0x9edc68, 0x3c6a22),
  serket: r(0x9ee05a, 0x6fae3a, 0xc6f48a, 0x3f7a22),
  wood: r(0xb7834f, 0x93643a, 0xd29d65, 0x67431f),
  woodGrey: r(0xa8957a, 0x86745c, 0xc4b296, 0x5e5040),
  iron: r(0x6c6f75, 0x4f5258, 0x8e9198, 0x34363b),
  brass: r(0xd9a640, 0xae7f28, 0xf5d070, 0x7a5414),
  gold: r(0xf2c443, 0xc9952a, 0xffe58a, 0x8a5e14),
  silver: r(0xc9cdd4, 0xa0a5ae, 0xeef0f4, 0x6e737c),
  sand: r(0xf0d29a, 0xd9b276, 0xfde6b8, 0xb08850),
  sandstone: r(0xddb27e, 0xbb8d5c, 0xf0c896, 0x8e6440),
  stone: r(0xb8b0a2, 0x958c7e, 0xd2cabc, 0x6a6258),
  cactus: r(0x6aa548, 0x4f8536, 0x8cc664, 0x356024),
  flower: r(0xf06a8a, 0xc84a6a, 0xff9ab2, 0x8a2a44),
  husk: r(0xb59a74, 0x957b58, 0xcdb48c, 0x6a5438),
  bandage: r(0xe6dcc2, 0xc4b796, 0xfaf2de, 0x958865),
  jackal: r(0x3a3446, 0x2a2534, 0x4e475c, 0x1a1622),
  lapis: r(0x3a62b8, 0x2a4890, 0x5a84d8, 0x1a2e60),
  turquoise: r(0x3fbfae, 0x2e9688, 0x6ad8c8, 0x1e6058),
  setRed: r(0xb8322a, 0x8a221c, 0xd8544a, 0x5a1410),
  dung: r(0x7a5530, 0x5c3e22, 0x936a40, 0x3e2814),
  black: r(0x2c2420, 0x1e1814, 0x3c322c, 0x120e0c),
  white: r(0xf4f0e8, 0xd8d2c6, 0xffffff, 0xb0a99c),
} as const;

export type RampName = keyof typeof TOON;

/**
 * Box with stepped bevels: `bevel` voxels are cut from each of the 12 edges in a
 * clean staircase (bevel=1 cuts edge voxels, 2 cuts a 2-step chamfer). Gives the
 * soft-but-blocky look of the reference skull without any noise.
 */
export function bevelBox(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: number, bevel = 1, flags?: number) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const dx = Math.min(x - x0, x1 - x), dy = Math.min(y - y0, y1 - y), dz = Math.min(z - z0, z1 - z);
        // edge cut: two axes near their limits
        if (dx + dy < bevel || dx + dz < bevel || dy + dz < bevel) continue;
        m.set(x, y, z, col, flags);
      }
  return m;
}

/**
 * Hand-style shading for a region: voxels whose top is exposed and that sit on a
 * top edge get `hi`; voxels whose underside is exposed get `shade`. Only touches
 * voxels currently of colour `base` inside the box, so painted details survive.
 */
export function shadeRegion(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, ramp: Ramp, opts: { hi?: boolean; under?: boolean } = {}) {
  const hi = opts.hi ?? true, under = opts.under ?? true;
  const base = ramp.base & 0xffffff;
  const todo: [number, number, number, number][] = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const v = m.get(x, y, z);
        if (v === undefined || (v & 0xffffff) !== base) continue;
        const flags = v >>> 24;
        if (under && !m.has(x, y - 1, z)) todo.push([x, y, z, ramp.shade | (flags << 24)]);
        else if (hi && !m.has(x, y + 1, z) && (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1)))
          todo.push([x, y, z, ramp.hi | (flags << 24)]);
      }
  for (const [x, y, z, c] of todo) m.set(x, y, z, c & 0xffffff, (c >>> 24) || VF.SOLID);
  return m;
}

/** clean stair-stepped disc/cylinder (no noise); radius measured to voxel centres */
export function disc(m: VoxelModel, cx: number, cz: number, y0: number, y1: number, rad: number, col: number, flags?: number) {
  const R = Math.ceil(rad);
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++) {
      if (x * x + z * z > rad * rad + 0.25) continue;
      for (let y = y0; y <= y1; y++) m.set(cx + x, y, cz + z, col, flags);
    }
  return m;
}

/** mirror every voxel with x > center onto the left (-x) side — build one half, mirror for perfect symmetry */
export function symmetrize(m: VoxelModel, center = 0) {
  const add: [number, number, number, number][] = [];
  m.forEach((x, y, z, rgb, flags) => {
    if (x > center) add.push([2 * center - x, y, z, (flags << 24) | rgb]);
  });
  for (const [x, y, z, v] of add) m.map.set(((x + 512) << 20) | ((y + 512) << 10) | (z + 512), v);
  return m;
}
