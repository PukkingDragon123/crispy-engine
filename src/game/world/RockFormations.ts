// Procedural desert rock formations, sculpted as voxel volumes and worn as big
// pixel-textured blocks (BlockSkin 'rock'): hoodoo groups (soft banded columns necked
// under hard caprocks), mesas / buttes (talus skirts, stepped strata cliffs with ledges
// and desert-varnish streaks, a bleached flat top), balanced rocks (a boulder perched on
// an eroded pedestal) and layered sandstone ledges (stacked slabs with overhanging lips).
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import { RNG, Noise, hash3 } from '../../engine/math/rand';
import { mix, mulRGB } from '../../engine/voxel/VoxelModel';

type SM = { model: VoxelModel; voxelSize: number };

/** red-rock strata, bottom to top repeating */
const STRATA = [0xc0703f, 0xcf8550, 0xe0a46c, 0xedc490, 0xb4603a, 0xd2905a, 0x9a5434, 0xdcae7a];
const CAP = [0x6a4a3a, 0x7e5a44, 0x5a3e30];
const VARNISH = 0x4a2e22, BLEACH = 0xf0d6aa, SAND = 0xe2b67c;

function strataAt(y: number, wob: number, band: number) {
  return STRATA[((Math.floor((y + wob) / band) % STRATA.length) + STRATA.length) % STRATA.length];
}

/** a hoodoo group: 1-3 banded columns, each pinched under its own dark caprock */
export function hoodoo(v: number): SM {
  const rng = new RNG(4100 + v * 97), nz = new Noise(77 + v);
  const m = new VoxelModel('hoodoo' + v);
  const cols = 1 + (v % 3);
  for (let c = 0; c < cols; c++) {
    const ox = c === 0 ? 0 : rng.range(-9, 9), oz = c === 0 ? 0 : rng.range(-9, 9);
    const H = Math.round(rng.range(c === 0 ? 34 : 18, c === 0 ? 54 : 34));
    const R0 = rng.range(6, 8.5) * (c === 0 ? 1 : 0.75);
    const capH = Math.round(rng.range(4, 6));
    const band = rng.range(3.2, 4.6);
    for (let y = 0; y < H + capH; y++) {
      const t = y / H;
      const cap = y >= H;
      // the column tapers, ripples with its soft and hard bands and necks just below the cap
      let r = R0 * (1.18 - 0.42 * t) * (1 + 0.14 * Math.sin(y * 0.55 + c)) * (1 - 0.32 * Math.exp(-(((t - 0.93) / 0.07) ** 2)));
      if (y < 4) r += (4 - y) * 0.9; // sand-buried foot
      if (cap) r = R0 * rng.range(0.95, 1.02) * (1.05 - ((y - H) / capH) * 0.35) + 0.8;
      const C = Math.ceil(r + 3);
      for (let x = -C; x <= C; x++)
        for (let z = -C; z <= C; z++) {
          const a = Math.atan2(z, x);
          const rr = r * (1 + 0.12 * nz.n2(Math.cos(a) * 2 + c * 5, y * 0.09) + 0.05 * nz.n3(x * 0.4, y * 0.4, z * 0.4));
          if (Math.hypot(x, z) > rr) continue;
          let col = cap ? CAP[Math.floor(hash3(x >> 1, y, z >> 1) * 3)] : strataAt(y, nz.n2(x * 0.15, z * 0.15) * 1.5, band);
          if (!cap && nz.n2(a * 3 + c, y * 0.05) > 0.35 && y > 6) col = mix(col, VARNISH, 0.4);
          if (y < 4) col = mix(col, SAND, 0.55);
          if (cap && y === H + capH - 1) col = mix(col, 0x9a7a5a, 0.4);
          m.set(Math.round(ox + x), y, Math.round(oz + z), mulRGB(col, 1 + (hash3(x, y, z) - 0.5) * 0.06));
        }
    }
  }
  return { model: m, voxelSize: 0.2 };
}

/** a mesa / butte: a talus skirt, stepped cliffs along the strata, a bleached flat top */
export function mesaButte(v: number): SM {
  const rng = new RNG(5200 + v * 131), nz = new Noise(141 + v);
  const m = new VoxelModel('mesa' + v);
  const R = rng.range(17, 26), H = Math.round(rng.range(16, 26));
  const steps = [0.3, 0.55, 0.8].map((k) => Math.round(H * k + rng.range(-1, 1)));
  const ex = rng.range(0.75, 1.0);
  for (let y = 0; y < H; y++) {
    const t = y / H;
    // talus skirt below, then near-vertical cliff that steps in at each hard bed
    let r = t < 0.22 ? R * (1.35 - t * 1.5) : R;
    for (const s of steps) if (y >= s) r -= 1.1;
    const C = Math.ceil(r * 1.3 + 3);
    for (let x = -C; x <= C; x++)
      for (let z = -C; z <= C; z++) {
        const a = Math.atan2(z, x);
        const lobe = 1 + 0.18 * nz.n2(Math.cos(a) * 1.6, Math.sin(a) * 1.6) + 0.06 * nz.n2(Math.cos(a) * 5, Math.sin(a) * 5 + y * 0.05);
        const d = Math.hypot(x, z / ex);
        if (d > r * lobe) continue;
        // hollow core (only the shell is ever seen)
        if (d < r * lobe - 4 && y < H - 2 && y > 1) continue;
        const edge = d > r * lobe - 1.5;
        let col = strataAt(y, nz.n2(x * 0.08, z * 0.08) * 1.2, 2);
        if (steps.includes(y)) col = mix(col, 0x8a4c30, 0.5); // the hard beds that make the ledges
        if (edge && nz.n2(a * 9, 0.3) > 0.25 && y > H * 0.3) col = mix(col, VARNISH, 0.45 * Math.min(1, (y / H - 0.3) * 2.5));
        if (y >= H - 1) col = mix(col, BLEACH, 0.45);
        if (t < 0.22) col = mix(col, SAND, 0.35 + (0.22 - t) * 2);
        m.set(x, y, z, mulRGB(col, 1 + (hash3(x, y, z) - 0.5) * 0.07));
      }
  }
  // a few fallen blocks on the skirt
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2), d = R * rng.range(1.15, 1.4), s = rng.range(1.2, 2.4);
    const bx = Math.cos(a) * d, bz = Math.sin(a) * d * ex;
    for (let x = -3; x <= 3; x++) for (let y = 0; y <= 3; y++) for (let z = -3; z <= 3; z++) if (Math.hypot(x, y * 1.3, z) < s + hash3(x, y, z + i) * 0.6) m.set(Math.round(bx + x), y, Math.round(bz + z), strataAt(y + i * 3, 0, 2));
  }
  return { model: m, voxelSize: 0.5 };
}

/** a balanced rock: a big rounded boulder perched on a narrow, wind-cut pedestal */
export function balancedRock(v: number): SM {
  const rng = new RNG(6300 + v * 53), nz = new Noise(211 + v);
  const m = new VoxelModel('balanced' + v);
  const PH = Math.round(rng.range(12, 18)), PR = rng.range(3.2, 4.4);
  for (let y = 0; y < PH; y++) {
    const t = y / PH;
    const r = PR * (1.25 - 0.55 * Math.sin(t * Math.PI * 0.9)) + (y < 3 ? (3 - y) * 1.2 : 0);
    const C = Math.ceil(r + 2);
    for (let x = -C; x <= C; x++)
      for (let z = -C; z <= C; z++) {
        if (Math.hypot(x, z) > r * (1 + 0.15 * nz.n3(x * 0.3, y * 0.2, z * 0.3))) continue;
        m.set(x, y, z, mix(strataAt(y, 0, 2.5), y < 3 ? SAND : 0xd2905a, y < 3 ? 0.5 : 0.1));
      }
  }
  const BR = rng.range(8, 11), by = PH + BR * 0.72, lean = rng.range(-2, 2);
  for (let x = -14; x <= 14; x++)
    for (let y = -12; y <= 12; y++)
      for (let z = -14; z <= 14; z++) {
        const d = Math.hypot(x / 1.15, y / 0.82, z);
        if (d > BR * (1 + 0.16 * nz.n3(x * 0.15, y * 0.15, z * 0.15))) continue;
        let col = y > BR * 0.4 ? 0xd09a66 : y < -BR * 0.3 ? 0x8a4e30 : 0xb4703f;
        if (nz.n3(x * 0.2 + 9, y * 0.1, z * 0.2) > 0.3) col = mix(col, VARNISH, 0.35);
        m.set(Math.round(x + lean), Math.round(by + y), z, mulRGB(col, 1 + (hash3(x, y, z) - 0.5) * 0.07));
      }
  return { model: m, voxelSize: 0.2 };
}

/** layered sandstone ledge: stacked slabs, each smaller and shifted, with overhanging lips */
export function sandstoneLedge(v: number): SM {
  const rng = new RNG(7400 + v * 71), nz = new Noise(301 + v);
  const m = new VoxelModel('ledge' + v);
  const L = rng.range(16, 24), W = rng.range(7, 10);
  const layers = 4 + (v % 3);
  let y0 = 0, cx = 0;
  for (let k = 0; k < layers; k++) {
    const th = Math.round(rng.range(2, 3.5));
    const l = L * (1 - k * 0.14), w = W * (1 - k * 0.12);
    cx += rng.range(-1.6, 2.4);
    const col0 = STRATA[(k * 3 + v) % STRATA.length];
    for (let y = 0; y < th; y++) {
      // each slab's lip juts out a little at the top: undercut below, overhang above
      const lip = y === th - 1 ? 0.8 : y === 0 ? -0.6 : 0;
      for (let x = -Math.ceil(l + 2); x <= Math.ceil(l + 2); x++)
        for (let z = -Math.ceil(w + 2); z <= Math.ceil(w + 2); z++) {
          const e = Math.pow(Math.abs((x - cx) / (l + lip)), 3) + Math.pow(Math.abs(z / (w + lip)), 3);
          if (e > 1 + 0.25 * nz.n2(x * 0.2 + k, z * 0.2)) continue;
          let col = y === th - 1 ? mix(col0, BLEACH, 0.2) : y === 0 ? mulRGB(col0, 0.78) : col0;
          if (k === 0 && y === 0) col = mix(col, SAND, 0.4);
          m.set(x, y0 + y, z, mulRGB(col, 1 + (hash3(x, y0 + y, z) - 0.5) * 0.07));
        }
    }
    y0 += th;
  }
  return { model: m, voxelSize: 0.33 };
}
