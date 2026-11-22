// The main menu's ruined cantina (scenes/menu/MenuRuin): the pieces the hideout's adobe walls and
// rubble do not already give. The hanging sign (a two-plank board, its name painted in flaking red,
// iron eye-bolts for the chains), the roof vigas (peeled pine logs, sun-checked, one snapped off) and
// loose mud bricks for the debris. Surface texture comes from the material library.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { alagardMask } from './menuSet';
import { weathered, adobe, rustedIron } from '../materials';
import { mixRGB } from './helpers';

const h2 = (a: number, b: number, s = 0) => {
  let h = (a * 374761393 + b * 668265263 + s * 974634121) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export interface HangingSign {
  model: VoxelModel;
  voxelSize: number;
  /** voxel pivot: top centre, between the eye-bolts */
  pivot: [number, number, number];
  width: number;
  height: number;
  /** the two eye-bolts, metres from the pivot (x) */
  hooks: number[];
}

/** the cantina's hanging sign: two weathered planks, the name painted in flaking oxblood with a pale
 *  outline, a lost corner, iron straps and eye-bolts on top (1/64 m, pivot top centre) */
export function hangingSign(text = 'CANTINA', seed = 3): HangingSign {
  const vs = 1 / 64;
  const g = alagardMask(text, 26);
  const L = g.w + 24, H = Math.max(30, g.h + 14), T = 3;
  const m = new VoxelModel('menu_hanging_sign');
  const wood = weathered({ along: 'x', seed, bleach: 0.4, checks: 0.9, knots: 0.6 });
  const iron = rustedIron({ seed: seed + 4, rust: 0.55 });
  const tx0 = Math.round((L - g.w) / 2), ty0 = Math.round((H - g.h) / 2) - 1;
  const ink = (x: number, y: number) => g.on(x - tx0, H - 1 - y - ty0);
  const seam = Math.floor(H / 2);
  for (let x = 0; x < L; x++)
    for (let y = 0; y < H; y++) {
      // worn round corners and one broken-off lower corner
      const cx = Math.min(x, L - 1 - x), cy = Math.min(y, H - 1 - y);
      if (cx + cy < 2) continue;
      if (x > L - 12 && y < 7 && L - 1 - x + y < 9 + Math.round(h2(x, y, seed) * 2)) continue;
      // nicks along the edges
      if ((cx === 0 || cy === 0) && h2(x * 3, y * 5, seed) < 0.12) continue;
      for (let z = 0; z < T; z++) {
        const front = z === T - 1;
        let c = wood(x, y, z) ?? 0x8a7458;
        let fl: number = VF.SOLID;
        if (y === seam || y === seam - 1) c = mixRGB(c, 0x2a1a10, y === seam ? 0.55 : 0.2); // the gap between the planks
        if (front && ink(x, y)) {
          // painted letters: flaking oxblood, sun-faded on top, the wood showing where it lifted
          const flake = h2(x * 7, y * 11, seed + 9) < 0.1 || (h2(x >> 1, y >> 1, seed + 2) < 0.06);
          if (!flake) c = !ink(x, y + 1) ? 0xc04a2c : !ink(x, y - 1) ? 0x6e1e12 : 0x96301c;
        } else if (front && (ink(x - 1, y) || ink(x + 1, y) || ink(x, y + 1) || ink(x, y - 1)) && h2(x, y, seed + 5) > 0.25) c = 0xe8d6ae; // pale outline
        else if (front && ink(x - 1, y + 1)) c = mixRGB(c, 0x24160c, 0.5); // a drop shadow
        if (!front) c = mixRGB(c, 0x3a2414, z === 0 ? 0.35 : 0.15);
        m.set(x, y, z, c, fl);
      }
    }
  // iron straps over the ends and the eye-bolts on top
  const hooks: number[] = [];
  for (const sx of [5, L - 6]) {
    for (let y = 2; y < H - 1; y++)
      for (const z of [-1, T]) {
        const c = iron(sx, y, z) ?? 0x4a4440;
        m.set(sx, y, z, c, VF.METAL).set(sx + 1, y, z, c, VF.METAL);
      }
    // rivets
    for (const y of [4, H - 4]) m.set(sx, y, T + 1, 0x8a847a, VF.METAL);
    // the eye: a small ring standing on the top edge
    for (let a = 0; a < 14; a++) {
      const th = (a / 14) * Math.PI * 2;
      const u = Math.round(Math.cos(th) * 1.6), v = Math.round(Math.sin(th) * 1.6);
      m.set(sx + u, H + 1 + v, 1, a < 7 ? 0x6a625a : 0x3e3a36, VF.METAL);
    }
    hooks.push((sx + 0.5 - L / 2) * vs);
  }
  return { model: m, voxelSize: vs, pivot: [L / 2, H + 3, T / 2], width: L * vs, height: (H + 3) * vs, hooks };
}

/** a roof viga: a peeled pine log, sun-checked and silver on top, the end either sawn or snapped
 *  into long splinters (1/32 m, along +X from the pivot at its sawn end, axis at y = z = 0) */
export function vigaLog(len: number, seed = 0, snapped = true) {
  const vs = 1 / 32;
  const N = Math.round(len / vs);
  const m = new VoxelModel('menu_viga');
  const wood = weathered({ along: 'x', seed, bleach: 0.55, checks: 1, knots: 0.9, ends: [0, N] });
  const R0 = 3.4 + h2(seed, 1) * 0.6;
  for (let a = 0; a <= N; a++) {
    const t = a / N;
    const r = R0 * (1 - 0.12 * t) + Math.sin(a * 0.21 + seed) * 0.25;
    // the snapped end: each fibre of the log breaks at its own length
    for (let u = -5; u <= 5; u++)
      for (let w = -5; w <= 5; w++) {
        if (u * u + w * w > r * r) continue;
        if (snapped && a > N - 14 && a > N - 2 - Math.floor(h2(u + 9, w + 9, seed) * 14) * (0.5 + 0.5 * h2(u, w, seed + 3))) continue;
        let c = wood(a, u, w) ?? 0x8a7458;
        if (u > r - 1.2) c = mixRGB(c, 0xd8ccb4, 0.25); // sun-bleached top
        if (u < -r + 1.2) c = mixRGB(c, 0x3a2a1c, 0.3);
        m.set(a, u, w, c);
      }
  }
  return { model: m, voxelSize: vs, pivot: [0, 0.5, 0.5] as [number, number, number], length: len };
}

/** a loose mud brick, chipped at the corners, straw in the clay (1/32 m, pivot bottom centre) */
export function mudBrick(seed = 0) {
  const vs = 1 / 32;
  const m = new VoxelModel('menu_brick');
  const mat = adobe({ seed: seed + 11, cracks: 0.7, straw: 0.8 });
  const W = 11, H = 4, D = 6;
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++)
      for (let z = 0; z < D; z++) {
        const ex = x === 0 || x === W - 1, ey = y === H - 1, ez = z === 0 || z === D - 1;
        if ((ex && ez) || (ex && ey && h2(x, z, seed) < 0.6) || (ez && ey && h2(x + 3, z, seed) < 0.25)) continue;
        if (x > W - 4 && y > 1 && z < 3 && h2(x, y + z, seed) < 0.7) continue; // a broken corner
        m.set(x, y, z, mat(x + seed * 13, y, z) ?? 0xb08258);
      }
  return { model: m, voxelSize: vs };
}
