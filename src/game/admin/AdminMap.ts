// Admin testing mode: the teleport map. A top-down relief of the run's height field, read straight
// from the world data (no picture is painted: every pixel is the terrain's own height, slope and
// ground material), quantised onto the HUD's warm pixel ramps with an ordered dither, the storm
// wall's live edge traced in ember and everything beyond it shaded. Rebuilt when the world, the
// framing or the storm changes.
import type { World } from '../world/World';
import { MAT } from '../world/Heightfield';

type Ramp = number[][];
const hex = (s: string[]): Ramp => s.map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);

// five steps each, shadow to light (the HUD palette's sand, stone, jade and lapis families)
const R_SAND = hex(['#6e4422', '#9a6430', '#c08848', '#dcb070', '#f2d8a0']);
const R_DUNE = hex(['#5a3418', '#7a4a22', '#a86c36', '#c8925a', '#e2bc84']);
const R_RED = hex(['#5a2a12', '#8a4a22', '#b05a2c', '#c87440', '#e09a62']);
const R_ROCK = hex(['#2e2a28', '#4e4a44', '#6e6860', '#8a867c', '#b4ae9e']);
const R_DARK = hex(['#1e1c1c', '#34302e', '#4e4a44', '#625c54', '#7c766a']);
const R_TILE = hex(['#6e5a40', '#9a8460', '#b8a07a', '#d2bf96', '#e8dab4']);
const R_GRASS = hex(['#16351c', '#1d6a4a', '#3a8a3a', '#62a848', '#9cc860']);
const R_MUD = hex(['#2e180c', '#4e2a16', '#6e3c20', '#8e5430', '#a8703e']);
const R_BONE = hex(['#6e5a40', '#b8a07a', '#d2c09a', '#e0cfa8', '#f6ead0']);
const R_GOLD = hex(['#4a300c', '#7c5214', '#b88426', '#e2b24a', '#fff0a6']);
const R_GLASS = hex(['#1d5a6a', '#2f8a9a', '#5ab8c0', '#8ad8d0', '#c8fff0']);
const R_WATER = hex(['#0e2a3a', '#123e52', '#185a6e', '#22788a', '#3aa0a8']);

function rampFor(mat: number): Ramp {
  switch (mat) {
    case MAT.SAND_DARK: return R_DUNE;
    case MAT.RED_SAND: return R_RED;
    case MAT.ROCK: return R_ROCK;
    case MAT.DARK_ROCK: return R_DARK;
    case MAT.TILE: return R_TILE;
    case MAT.DIRT: case MAT.MUD: return R_MUD;
    case MAT.GRASS: return R_GRASS;
    case MAT.BONE: return R_BONE;
    case MAT.GOLD: return R_GOLD;
    case MAT.CRYSTAL: return R_GLASS;
    default: return R_SAND;
  }
}

// 4x4 ordered dither (Bayer), in 0..1
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

export interface MapFrame {
  x0: number;
  z0: number;
  span: number;
}

export class AdminMap {
  readonly cv = document.createElement('canvas');
  frame: MapFrame = { x0: 0, z0: 0, span: 1 };
  private key = '';
  private age = 99;
  private stormSig = '';

  constructor(readonly N = 160) {
    this.cv.width = this.cv.height = N;
  }

  /** world metres -> map pixels */
  toMap(x: number, z: number) {
    const f = this.frame;
    return { u: ((x - f.x0) / f.span) * this.N, v: ((z - f.z0) / f.span) * this.N };
  }
  /** map pixels -> world metres */
  toWorld(u: number, v: number) {
    const f = this.frame;
    return { x: f.x0 + (u / this.N) * f.span, z: f.z0 + (v / this.N) * f.span };
  }

  /** keep the relief current: a new world or framing rebuilds at once, the storm's drift every 2 s */
  update(world: World, focus: { x: number; z: number }, near: boolean, dt: number) {
    this.age += dt;
    const fr = near ? this.nearFrame(world, focus) : this.areaFrame(world);
    const key = `${world.sa.key}:${world.sa.seed}:${world.stage}:${near ? 'n' : 'a'}:${Math.round(fr.x0)}:${Math.round(fr.z0)}`;
    const sig = this.stormKey(world);
    // the near frame follows the hunter in 30 m steps; the storm is re-traced when its shape moves
    if (key !== this.key || (sig !== this.stormSig && this.age > 2)) {
      this.key = key;
      this.stormSig = sig;
      this.age = 0;
      this.frame = fr;
      this.build(world);
    }
  }

  private stormKey(world: World) {
    const s = world.storm as unknown as { discs: { r: number }[]; capsules: { w: number; s0: number; s1: number }[] };
    let a = 0;
    for (const d of s.discs ?? []) a += d.r;
    for (const c of s.capsules ?? []) a += c.w * 3 + (c.s1 - c.s0) * 50;
    return String(Math.round(a));
  }

  private areaFrame(world: World): MapFrame {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const z of world.sa.zones) {
      x0 = Math.min(x0, z.cx - z.r);
      z0 = Math.min(z0, z.cz - z.r);
      x1 = Math.max(x1, z.cx + z.r);
      z1 = Math.max(z1, z.cz + z.r);
    }
    const size = world.sa.field.size;
    if (!(x1 > x0)) return { x0: 0, z0: 0, span: size };
    const span = Math.min(size, Math.max(x1 - x0, z1 - z0) * 1.06);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    return { x0: clampTo(cx - span / 2, 0, size - span), z0: clampTo(cz - span / 2, 0, size - span), span };
  }

  private nearFrame(world: World, f: { x: number; z: number }): MapFrame {
    const size = world.sa.field.size;
    const span = Math.min(size, 240);
    const step = 30;
    const cx = Math.round(f.x / step) * step, cz = Math.round(f.z / step) * step;
    return { x0: clampTo(cx - span / 2, 0, size - span), z0: clampTo(cz - span / 2, 0, size - span), span };
  }

  private build(world: World) {
    const N = this.N, f = this.frame, field = world.sa.field, storm = world.storm;
    const water = world.sa.waterLevel;
    const cell = f.span / N;
    // heights on a one-pixel border for the slopes
    const M = N + 2;
    const H = new Float32Array(M * M);
    for (let j = 0; j < M; j++)
      for (let i = 0; i < M; i++) H[i + j * M] = field.heightAt(f.x0 + (i - 0.5) * cell, f.z0 + (j - 0.5) * cell);
    const c = this.cv.getContext('2d')!;
    const img = c.createImageData(N, N);
    const d = img.data;
    // the relief's contour interval grows with the framing so the lines stay sparse
    const band = f.span > 600 ? 6 : f.span > 300 ? 4 : 2;
    const L = norm3(-1, 1.25, -1);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = i + 1 + (j + 1) * M;
        const h = H[k];
        const x = f.x0 + (i + 0.5) * cell, z = f.z0 + (j + 0.5) * cell;
        const dhx = (H[k + 1] - H[k - 1]) / (2 * cell), dhz = (H[k + M] - H[k - M]) / (2 * cell);
        const n = norm3(-dhx * 2.2, 1, -dhz * 2.2);
        const lit = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
        const dith = BAYER[(i & 3) + (j & 3) * 4];
        let ramp: Ramp, step: number;
        if (h < water - 0.05) {
          ramp = R_WATER;
          step = Math.round(clampTo(4 - (water - h) * 0.6 + dith, 0, 4));
        } else {
          ramp = rampFor(field.matAt(x, z));
          step = Math.round(clampTo((lit - 0.42) * 7.5 + 2 + dith * 1.1, 0, 4));
          // contour lines: one step darker where the height crosses a band
          const b = Math.floor(h / band);
          if (Math.floor(H[k + 1] / band) !== b || Math.floor(H[k + M] / band) !== b) step = Math.max(0, step - 1);
        }
        let [r, g, bl] = ramp[step];
        const sdf = storm.sdf(x, z);
        if (sdf < 0) {
          // beyond the wall: the sand under the storm, smothered and checkered dark
          const dark = ((i + j) & 1) === 0 ? 0.42 : 0.55;
          r = r * dark + 58 * (1 - dark) * 0.6;
          g = g * dark + 40 * (1 - dark) * 0.6;
          bl = bl * dark + 26 * (1 - dark) * 0.6;
          if (sdf > -cell * 1.2) [r, g, bl] = [224, 120, 48];
        } else if (sdf < cell * 0.9) [r, g, bl] = [255, 196, 104];
        const o = (i + j * N) * 4;
        d[o] = r;
        d[o + 1] = g;
        d[o + 2] = bl;
        d[o + 3] = 255;
      }
    c.putImageData(img, 0, 0);
  }
}

function clampTo(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
function norm3(x: number, y: number, z: number) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
