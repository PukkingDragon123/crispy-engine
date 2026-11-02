// Desert flora at high voxel density (1/40 m): branching dead shrubs
// (sagebrush / creosote skeletons, some with a few clinging dry leaves) and dry
// grass tufts. Seeded, so every instance batch gets real variety.
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { RNG } from '../../../engine/math/rand';

export interface FloraModel {
  model: VoxelModel;
  voxelSize: number;
}

const pick = (a: number[], i: number) => a[((Math.floor(i) % a.length) + a.length) % a.length];
// sun-bleached silver-grey wood (reads bright under the desert sun)
const WOOD = [0xb8aa92, 0xa29480, 0x8c7e6a, 0xd2c5ac, 0x978570];
const RED_WOOD = [0x9a6446, 0x87563a, 0xae7452];
const LEAF = [0x9a9a5a, 0x86844c, 0xa8a068, 0x7a7444];
const SAND = [0xe8c48a, 0xdcb478, 0xd0a86c];

function branch(m: VoxelModel, r: RNG, x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, thick: number, depth: number, pal: number[], leaves: boolean) {
  let px = x, py = y, pz = z;
  const steps = Math.max(3, Math.round(len));
  for (let i = 0; i < steps; i++) {
    // gnarled growth: slight random curvature, gravity droop on thin twigs
    dx += (r.next() - 0.5) * 0.35;
    dz += (r.next() - 0.5) * 0.35;
    dy += (r.next() - 0.5) * 0.2 - (thick < 1.2 ? 0.04 : 0);
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    px += dx;
    py += Math.max(-0.2, dy);
    pz += dz;
    const t = i / steps;
    const th = thick * (1 - t * 0.55);
    const col = pick(pal, Math.floor(py * 0.7) + i);
    if (th > 1.1) {
      for (let ox = 0; ox <= 1; ox++) for (let oz = 0; oz <= 1; oz++) m.set(Math.round(px) + ox, Math.round(py), Math.round(pz) + oz, col);
    } else m.set(Math.round(px), Math.round(py), Math.round(pz), col);
    // forks
    if (depth > 0 && i > 2 && r.chance(0.16 + (3 - depth) * 0.05)) {
      const a = r.range(0.4, 0.9) * (r.chance(0.5) ? 1 : -1);
      const cs = Math.cos(a), sn = Math.sin(a);
      branch(m, r, px, py, pz, dx * cs - dz * sn, dy + 0.25, dx * sn + dz * cs, len * r.range(0.45, 0.7), Math.max(1, thick * 0.6), depth - 1, pal, leaves);
    }
  }
  // twig tips: tiny forks + an occasional cluster of dry leaves
  for (let k = 0; k < 2; k++) m.set(Math.round(px + (r.next() - 0.5) * 2), Math.round(py + r.next() * 1.5), Math.round(pz + (r.next() - 0.5) * 2), pal[3]);
  if (leaves && r.chance(0.5)) {
    const n = r.int(3, 7);
    for (let k = 0; k < n; k++) m.set(Math.round(px + (r.next() - 0.5) * 3), Math.round(py + (r.next() - 0.3) * 2), Math.round(pz + (r.next() - 0.5) * 3), LEAF[r.int(0, LEAF.length - 1)]);
  }
}

/** a dead desert shrub, 0.5–1.4 m tall */
export function deadBush(seed = 0): FloraModel {
  const r = new RNG(seed * 7919 + 13);
  const m = new VoxelModel('dead_bush_' + seed);
  const kind = seed % 4; // 0 sage, 1 creosote (tall), 2 round tangle, 3 red dead twigs
  const pal = kind === 3 ? RED_WOOD.concat(WOOD.slice(0, 2)) : WOOD;
  // sand mound collected at the base
  const mr = r.int(5, 9);
  for (let x = -mr; x <= mr; x++)
    for (let z = -mr; z <= mr; z++) {
      const d = Math.hypot(x, z) / mr;
      if (d > 1) continue;
      const h = Math.round((1 - d * d) * 3);
      for (let y = 0; y < h; y++) m.set(x, y, z, pick(SAND, x + z + y));
    }
  const stems = kind === 2 ? r.int(7, 11) : r.int(3, 6);
  for (let s = 0; s < stems; s++) {
    const a = (s / stems) * Math.PI * 2 + r.range(-0.4, 0.4);
    const out = kind === 1 ? r.range(0.15, 0.35) : kind === 2 ? r.range(0.6, 0.95) : r.range(0.3, 0.6);
    const len = kind === 1 ? r.range(26, 40) : kind === 2 ? r.range(12, 18) : r.range(16, 26);
    branch(m, r, r.range(-1.5, 1.5), 2, r.range(-1.5, 1.5), Math.cos(a) * out, 1, Math.sin(a) * out, len, kind === 1 ? 2 : 1.6, kind === 2 ? 2 : 3, pal, kind !== 3);
  }
  // a couple of fallen twigs on the sand
  for (let k = 0; k < 3; k++) {
    const a = r.range(0, Math.PI * 2), l = r.int(4, 9);
    for (let i = 0; i < l; i++) m.set(Math.round(Math.cos(a) * (mr - 2 + i)), 1, Math.round(Math.sin(a) * (mr - 2 + i)), pick(WOOD, i + k));
  }
  return { model: m, voxelSize: 1 / 40 };
}

/** a tuft of dry straw grass, 15–45 cm */
export function dryGrass(seed = 0): FloraModel {
  const r = new RNG(seed * 104729 + 7);
  const m = new VoxelModel('dry_grass_' + seed);
  const straw = [0xd8c07a, 0xc8ab62, 0xb8984f, 0xe4d08e, 0xa88a48];
  const n = r.int(16, 30);
  for (let b = 0; b < n; b++) {
    const a = r.range(0, Math.PI * 2);
    const lean = r.range(0.05, 0.6);
    let x = Math.cos(a) * r.range(0, 2.5), z = Math.sin(a) * r.range(0, 2.5), y = 0;
    const h = r.int(6, seed % 3 === 0 ? 18 : 13);
    const col = straw[r.int(0, straw.length - 1)];
    for (let i = 0; i < h; i++) {
      const t = i / h;
      x += Math.cos(a) * lean * t * 0.9;
      z += Math.sin(a) * lean * t * 0.9;
      y += 1 - t * t * lean * 0.6;
      m.set(Math.round(x), Math.round(y), Math.round(z), i > h - 3 ? straw[3] : col);
    }
    // seed head on some blades
    if (r.chance(0.25)) m.set(Math.round(x), Math.round(y) + 1, Math.round(z), 0xf0e0a8);
  }
  return { model: m, voxelSize: 1 / 40 };
}
