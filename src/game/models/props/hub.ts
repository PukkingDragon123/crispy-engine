// Hideout saloon pieces + main-menu signpost — STYLE v2. Furniture 1/24 m,
// small tabletop objects 1/48 m, room shell pieces 1/24 m. Fronts face +Z.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { Ramp } from '../style';
import { S, StaticModel, V3, PR, rngOf, meters, board, post, inCircle, cylY, mod, stampText, textWidth, rope } from './helpers';

const FVS = 1 / 24;
const SVS = 1 / 48;

/** plank top surface along x with dark seams */
function plankTop(m: VoxelModel, x0: number, x1: number, z0: number, z1: number, y: number, r: Ramp, bw = 4) {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) m.set(x, y, z, mod(z - z0, bw) === 0 && z !== z0 ? r.dark : z === z1 || z === z0 ? r.hi : r.base);
}

// ---------------------------------------------------------------------------
export function barCounter(): StaticModel {
  const m = new VoxelModel('bar_counter');
  const L = 60, D = 12, H = 26;
  // front panels with raised frames
  for (let x = -L; x <= L; x++)
    for (let y = 0; y <= H; y++)
      for (let z = -D; z <= D; z++) {
        const shell = z === D || z === -D || Math.abs(x) === L;
        if (!shell) continue;
        const px = mod(x + L, 20);
        const frame = px < 2 || y < 3 || y > H - 3 || mod(y, 11) < 1;
        m.set(x, y, z, y < 2 ? PR.woodDark.dark : frame ? PR.woodDark.base : px === 2 || px === 19 ? PR.woodDark.shade : PR.woodDark.hi);
      }
  // polished top + brass foot rail
  plankTop(m, -L - 2, L + 2, -D - 2, D + 2, H + 1, PR.woodDark);
  for (let x = -L - 2; x <= L + 2; x++) m.set(x, H + 2, D + 2, PR.woodDark.hi);
  for (let x = -L; x <= L; x++) m.set(x, 4, D + 4, PR.brass.base, VF.METAL);
  for (let x = -L; x <= L; x += 20) m.box(x, 0, D + 1, x, 4, D + 4, PR.brass.shade, VF.METAL);
  // spittoon
  cylY(m, L - 6, D + 8, 0, 3, 3, PR.brass.base, VF.METAL);
  return S(m, FVS);
}

const BOTTLES: { glass: Ramp; label: number; cap: number; shape: 'tall' | 'round' | 'square' }[] = [
  { glass: PR.glassBrown, label: PR.parchment.base, cap: PR.red.base, shape: 'tall' },
  { glass: PR.glassGreen, label: PR.paintWhite.base, cap: PR.woodDark.base, shape: 'round' },
  { glass: PR.glassClear, label: PR.red.base, cap: PR.iron.base, shape: 'square' },
  { glass: PR.glassBrown, label: PR.paintYellow.base, cap: PR.leather.base, shape: 'round' },
];
/** whiskey / snake-oil bottle (1/48) — also the HUD item model */
export function bottle(seed = 0): StaticModel {
  const b = BOTTLES[mod(seed, BOTTLES.length)];
  const m = new VoxelModel('bottle');
  const H = 22;
  for (let y = 0; y <= H; y++) {
    const neck = y > 14;
    const rr = b.shape === 'round' ? (neck ? 1.6 : 4.2 + Math.sin(((y + 1) / 15) * Math.PI) * 0.8) : neck ? 1.6 : y > 12 ? 4 - (y - 12) : 4;
    for (let x = -6; x <= 6; x++)
      for (let z = -6; z <= 6; z++) {
        const inside = b.shape === 'square' && !neck ? Math.abs(x) <= rr && Math.abs(z) <= rr : inCircle(x, z, rr);
        if (!inside) continue;
        const lit = x - z < -2;
        let c = lit ? b.glass.hi : x + z > 3 ? b.glass.shade : b.glass.base;
        if (!neck && y >= 4 && y <= 10 && z > 0) c = y === 4 || y === 10 ? PR.ink.base : b.label;
        if (y === 0) c = b.glass.dark;
        m.set(x, y, z, c, VF.METAL);
      }
  }
  // highlight streak + cork/cap
  for (let y = 2; y <= 12; y++) m.set(-2, y, -3, 0xffffff, VF.METAL);
  m.box(-1, H + 1, -1, 1, H + 3, 1, b.cap);
  // XXX on label
  for (let i = 0; i < 3; i++) m.set(-2 + i * 2, 7, b.shape === 'square' ? 5 : 5, PR.ink.base);
  return S(m, SVS);
}

export function shelf(seed = 0): StaticModel {
  const m = new VoxelModel('shelf');
  const W = 30, H = 56, D = 7;
  for (let y = 0; y <= H; y++) for (let x = -W; x <= W; x++) m.set(x, y, -D, mod(x, 6) === 0 ? PR.woodDark.dark : PR.woodDark.shade);
  for (const x of [-W, W]) m.box(x, 0, -D, x, H, D, PR.woodDark.base);
  for (let s = 0; s < 4; s++) plankTop(m, -W, W, -D, D, 2 + s * 16, PR.woodDark, 7);
  // tiny bottles & jars on the shelves (1 voxel = 4 cm here)
  const r = rngOf(seed, 3);
  for (let s = 1; s < 4; s++)
    for (let x = -W + 3; x <= W - 3; x += r.int(3, 5)) {
      const g = r.pick([PR.glassBrown, PR.glassGreen, PR.glassClear]);
      const h = r.int(4, 8);
      m.box(x, 3 + (s - 1) * 16, 0, x + 1, 2 + (s - 1) * 16 + h, 1, g.base, VF.METAL);
      m.box(x, 3 + (s - 1) * 16 + h, 0, x, 3 + (s - 1) * 16 + h + 1, 0, g.hi, VF.METAL);
    }
  return S(m, FVS);
}

export function stool(): StaticModel {
  const m = new VoxelModel('stool');
  for (const [x, z] of [[-4, -4], [3, -4], [-4, 3], [3, 3]]) m.box(x, 0, z, x + 1, 16, z + 1, PR.woodDark.base);
  for (const y of [5]) for (let k = -4; k <= 4; k++) m.set(k, y, -4, PR.woodDark.shade).set(k, y, 4, PR.woodDark.shade);
  cylY(m, 0, 0, 17, 18, 6, PR.leather.base);
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) if (inCircle(x, z, 6) && !inCircle(x, z, 5)) m.set(x, 18, z, PR.brass.base, VF.METAL);
  return S(m, FVS);
}

export function table(seed = 0): StaticModel {
  const m = new VoxelModel('table');
  const card = mod(seed, 2) === 1;
  for (const [x, z] of [[-14, -10], [13, -10], [-14, 9], [13, 9]]) post(m, x, z, 0, 17, 2, PR.woodDark, x + z);
  if (card) {
    for (let x = -16; x <= 16; x++) for (let z = -13; z <= 13; z++) m.set(x, 18, z, Math.abs(x) >= 15 || Math.abs(z) >= 12 ? PR.woodDark.base : PR.felt.base);
    // cards and chips
    m.box(-3, 19, -2, 0, 19, 2, PR.paintWhite.base);
    m.box(3, 19, 0, 5, 19, 3, PR.paintWhite.base);
    m.set(4, 19, 1, PR.red.base);
    cylY(m, -9, 5, 19, 21, 1.4, PR.red.base);
    cylY(m, -6, 6, 19, 20, 1.4, PR.lapis.base);
  } else plankTop(m, -16, 16, -13, 13, 18, PR.wood);
  return S(m, FVS);
}

export function piano(): StaticModel {
  const m = new VoxelModel('piano');
  const W = 30, H = 32, D = 12;
  for (let x = -W; x <= W; x++)
    for (let y = 4; y <= H; y++)
      for (let z = -D; z <= 0; z++) {
        const shell = Math.abs(x) === W || y === H || z === 0 || z === -D || y === 4;
        if (shell) m.set(x, y, z, y === H ? PR.woodDark.hi : z === 0 && mod(x + W, 15) < 1 ? PR.woodDark.dark : PR.woodDark.base);
      }
  for (const x of [-W + 2, W - 3]) m.box(x, 0, -2, x + 1, 3, 4, PR.woodDark.base);
  // keyboard
  for (let x = -W + 4; x <= W - 4; x++) {
    m.set(x, 16, 1, PR.woodDark.base).set(x, 16, 2, PR.white.base).set(x, 16, 3, PR.white.hi);
    if (mod(x, 7) !== 2 && mod(x, 7) !== 6 && mod(x, 2) === 0) m.set(x, 17, 2, PR.ink.base);
  }
  m.box(-W + 3, 15, 1, W - 3, 15, 4, PR.woodDark.shade);
  // sheet music + candle
  m.box(-6, 22, 1, 6, 29, 1, PR.parchment.base);
  for (let y = 23; y <= 28; y += 2) m.box(-5, y, 2, 5, y, 2, PR.ink.shade);
  m.box(W - 8, H + 1, -6, W - 6, H + 5, -4, PR.paintWhite.base);
  m.set(W - 7, H + 6, -5, PR.ember.hi, VF.EMISSIVE);
  return S(m, FVS);
}

export function mirror(): StaticModel {
  const m = new VoxelModel('mirror');
  const W = 14, H = 26;
  for (let x = -W; x <= W; x++)
    for (let y = 0; y <= H * 2; y++) {
      const e = (x * x) / (W * W) + ((y - H) * (y - H)) / (H * H);
      if (e > 1) continue;
      const frame = e > 0.78;
      m.set(x, y, 0, frame ? (mod(x + y, 4) === 0 ? PR.gold.hi : PR.gold.base) : x - y / 3 < -6 && x - y / 3 > -9 ? 0xe8f4f6 : 0xa8c4cc, VF.METAL);
      if (frame) m.set(x, y, 1, PR.gold.shade, VF.METAL);
    }
  return S(m, FVS);
}

export function wardrobe(): StaticModel {
  const m = new VoxelModel('wardrobe');
  const W = 18, H = 52, D = 9;
  for (let x = -W; x <= W; x++)
    for (let y = 2; y <= H; y++)
      for (let z = -D; z <= D; z++) {
        if (!(Math.abs(x) === W || y === H || y === 2 || Math.abs(z) === D)) continue;
        const door = z === D && Math.abs(x) < W - 1 && y > 3 && y < H - 4;
        const panel = door && (mod(x + W, 18) < 2 || mod(y, 22) < 2);
        m.set(x, y, z, door ? (panel ? PR.wood.shade : PR.wood.base) : PR.woodDark.base);
      }
  plankTop(m, -W - 1, W + 1, -D - 1, D + 1, H + 1, PR.woodDark);
  for (let x = -W - 2; x <= W + 2; x++) m.set(x, H + 2, D + 1, PR.woodDark.hi);
  for (const x of [-W, W - 1]) m.box(x, 0, -D, x + 1, 1, D, PR.woodDark.dark);
  m.box(-1, 26, D + 1, -1, 30, D + 1, PR.brass.base, VF.METAL);
  m.box(1, 26, D + 1, 1, 30, D + 1, PR.brass.base, VF.METAL);
  m.box(-W + 1, 0, -D, W - 1, 0, D, PR.woodDark.shade);
  return S(m, FVS);
}

export function workbench(): StaticModel {
  const m = new VoxelModel('workbench');
  for (const [x, z] of [[-26, -10], [25, -10], [-26, 9], [25, 9]]) post(m, x, z, 0, 20, 2, PR.woodDark, x);
  board(m, -26, 6, -10, 26, 7, 10, PR.wood, 'x', 2);
  board(m, -28, 21, -12, 28, 23, 12, PR.wood, 'x', 3);
  // vise
  m.box(20, 24, 8, 26, 28, 13, PR.iron.base, VF.METAL);
  m.box(22, 26, 14, 24, 26, 18, PR.iron.hi, VF.METAL);
  // revolver parts laid out: cylinder, barrel, grip
  cylY(m, -14, 0, 24, 25, 3, PR.iron.shade, VF.METAL);
  m.box(-6, 24, -2, 6, 25, 0, PR.iron.base, VF.METAL);
  m.box(8, 24, -4, 12, 26, 1, PR.leather.base);
  // hammer + tool board behind
  m.box(-22, 24, 4, -12, 24, 5, PR.wood.base);
  m.box(-12, 24, 3, -10, 26, 6, PR.iron.base, VF.METAL);
  for (let x = -26; x <= 26; x++) for (let y = 24; y <= 44; y++) m.set(x, y, -12, mod(x, 8) === 0 ? PR.wood.dark : PR.wood.shade);
  for (const x of [-20, -8, 4, 16]) m.box(x, 34, -11, x + 2, 40, -11, PR.iron.base, VF.METAL);
  return S(m, FVS);
}

export function noticeBoard(seed = 0): StaticModel {
  const r = rngOf(seed, 5);
  const m = new VoxelModel('notice_board');
  const W = 24, H = 18;
  for (let x = -W; x <= W; x++)
    for (let y = 0; y <= H * 2; y++) m.set(x, y, 0, Math.abs(x) >= W - 1 || y <= 1 || y >= H * 2 - 1 ? PR.woodDark.base : mod(x * 3 + y * 5, 13) === 0 ? PR.leather.shade : PR.leather.base);
  for (let i = 0; i < 6; i++) {
    const x0 = -W + 3 + (i % 3) * 15 + r.int(-1, 1), y0 = 4 + Math.floor(i / 3) * 16 + r.int(-1, 1);
    const isWanted = i % 2 === 0;
    for (let x = x0; x < x0 + 12; x++) for (let y = y0; y < y0 + 13; y++) m.set(x, y, 1, isWanted && y === y0 + 11 ? PR.ink.base : PR.parchment.base);
    if (isWanted) m.box(x0 + 3, y0 + 3, 1, x0 + 8, y0 + 8, 1, PR.parchment.shade);
    else for (let y = y0 + 2; y < y0 + 11; y += 2) m.box(x0 + 2, y, 1, x0 + 9 - (y % 4), y, 1, PR.ink.shade);
    m.set(x0 + 6, y0 + 12, 2, PR.red.base);
  }
  return S(m, FVS);
}

/** closed leather-bound codex with gold corners & a scarab clasp (1/48) */
export function book(): StaticModel {
  const m = new VoxelModel('book');
  const W = 12, D = 16, T = 6;
  for (let x = -W; x <= W; x++)
    for (let z = -D; z <= D; z++)
      for (let y = 0; y <= T; y++) {
        const cover = y === 0 || y === T || x === -W;
        if (!cover) {
          m.set(x, y, z, Math.abs(z) === D || x === W ? (mod(y, 2) ? PR.parchment.base : PR.parchment.shade) : PR.parchment.base);
          continue;
        }
        const corner = (Math.abs(x) > W - 4 || x < -W + 4) && Math.abs(z) > D - 4;
        m.set(x, y, z, corner ? PR.gold.base : y === T && (x + z) % 9 === 0 ? PR.leatherDark.shade : PR.leatherDark.base, corner ? VF.METAL : 0);
      }
  // spine ridges
  for (const z of [-10, -4, 4, 10]) m.box(-W - 1, 1, z, -W - 1, T - 1, z, PR.gold.shade, VF.METAL);
  // cover emblem: scorpion in gold + title bar
  const em = ['..#..', '.###.', '#####', '.#.#.', '#...#'];
  em.forEach((row, i) => [...row].forEach((ch, j) => ch === '#' && m.set(-2 + j, T + 1, -2 + i, PR.gold.hi, VF.METAL)));
  m.box(-6, T + 1, -10, 6, T + 1, -9, PR.gold.base, VF.METAL);
  // clasp
  m.box(W - 1, 2, -2, W + 1, T - 1, 2, PR.brass.base, VF.METAL);
  return S(m, SVS);
}

export function gramophone(): StaticModel {
  const m = new VoxelModel('gramophone');
  board(m, -9, 0, -9, 9, 7, 9, PR.woodDark, 'x', 4);
  cylY(m, 0, 0, 8, 8, 8, PR.ink.base);
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) if (inCircle(x, z, 8) && mod(Math.round(Math.sqrt(x * x + z * z)), 2) === 0) m.set(x, 8, z, PR.ink.hi);
  cylY(m, 0, 0, 8, 9, 2, PR.red.base);
  m.box(6, 8, 6, 7, 18, 7, PR.brass.base, VF.METAL);
  // brass horn flaring out toward +Z
  for (let k = 0; k <= 16; k++) {
    const rr = 1.2 + Math.pow(k / 16, 2) * 9;
    for (let a = -12; a <= 12; a++)
      for (let b = -12; b <= 12; b++) {
        if (!inCircle(a, b, rr) || inCircle(a, b, rr - 1.2)) continue;
        m.set(6 + a, 18 + Math.round(k * 0.7) + b, 7 + k, a + b > 0 ? PR.brass.hi : PR.brass.base, VF.METAL);
      }
  }
  m.box(-9, 4, 9, -8, 5, 12, PR.brass.shade, VF.METAL);
  return S(m, SVS * 2);
}

export function dartboard(): StaticModel {
  const m = new VoxelModel('dartboard');
  const R = 14;
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++) {
      if (!inCircle(x, y, R)) continue;
      const d = Math.sqrt(x * x + y * y);
      const seg20 = mod(Math.floor(((Math.atan2(y, x) + Math.PI) / (Math.PI * 2)) * 20), 2);
      let c = seg20 ? PR.ink.base : PR.parchment.base;
      if (d > R - 1.5) c = PR.woodDark.base;
      else if (d > R - 3.5 || (d > 7 && d < 8.5)) c = seg20 ? PR.red.base : PR.felt.base;
      if (d < 1.6) c = PR.red.base;
      m.set(x, y + R, 0, c);
      m.set(x, y + R, -1, PR.woodDark.shade);
    }
  // two darts stuck in
  for (const [x, y] of [[3, R + 2], [-5, R - 4]]) {
    m.box(x, y, 1, x, y, 5, PR.iron.base, VF.METAL);
    m.box(x - 1, y, 5, x + 1, y, 6, PR.red.base);
  }
  return S(m, FVS);
}

/** hanging oil lantern (1/48) */
export function lantern(): StaticModel {
  const m = new VoxelModel('lantern');
  m.box(-6, 0, -6, 6, 2, 6, PR.iron.base, VF.METAL);
  for (let y = 3; y <= 16; y++)
    for (let x = -5; x <= 5; x++)
      for (let z = -5; z <= 5; z++) {
        const corner = Math.abs(x) === 5 && Math.abs(z) === 5;
        const glass = Math.abs(x) === 5 || Math.abs(z) === 5;
        if (corner) m.set(x, y, z, PR.iron.dark, VF.METAL);
        else if (glass) m.set(x, y, z, PR.paintYellow.hi, VF.EMISSIVE);
      }
  m.box(-1, 3, -1, 1, 9, 1, PR.paintWhite.base);
  m.box(0, 10, 0, 0, 12, 0, PR.ember.hi, VF.GLOW);
  for (let y = 17; y <= 22; y++) {
    const e = 6 - (y - 17);
    for (let x = -e; x <= e; x++) for (let z = -e; z <= e; z++) if (Math.abs(x) === e || Math.abs(z) === e) m.set(x, y, z, PR.iron.base, VF.METAL);
  }
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI;
    m.set(Math.round(Math.cos(t) * 4), 23 + Math.round(Math.sin(t) * 5), 0, PR.iron.dark, VF.METAL);
  }
  return S(m, SVS);
}

/** 2×2 m floorboard tile (1/24) */
export function floorTile(seed = 0): StaticModel {
  const m = new VoxelModel('floor_tile');
  const r = rngOf(seed, 9);
  const N = 24;
  const tones = [PR.wood.base, PR.wood.base, PR.woodLight.shade, PR.wood.hi];
  for (let x = -N; x < N; x++) {
    const plank = Math.floor((x + N) / 4);
    const tone = tones[mod(plank * 7 + seed, tones.length)];
    const seamZ = mod(plank * 13 + seed * 5, 48) - 24;
    for (let z = -N; z < N; z++) {
      let c = mod(x + N, 4) === 0 ? PR.wood.dark : tone;
      if (z === seamZ) c = PR.wood.dark;
      m.set(x, 0, z, c);
      m.set(x, -1, z, PR.wood.shade);
    }
    if (r.chance(0.25)) m.set(x, 0, seamZ + 1, PR.iron.dark, VF.METAL);
  }
  return S(m, FVS);
}

/** 2 m wall section (1/24): wainscot + wallpaper, optional window */
export function wallSegment(withWindow = true, seed = 0): StaticModel {
  const m = new VoxelModel('wall_segment');
  const N = 24, H = 76;
  const paper = mod(seed, 2) ? PR.red : PR.paintGreen;
  for (let x = -N; x < N; x++)
    for (let y = 0; y <= H; y++)
      for (let z = 0; z < 3; z++) {
        let c: number;
        if (y < 24) c = y === 23 ? PR.woodDark.hi : mod(x + N, 6) === 0 ? PR.woodDark.dark : PR.woodDark.base;
        else if (y > H - 4) c = PR.woodDark.base;
        else c = mod(x + N, 8) === 0 && mod(y, 8) < 4 ? paper.shade : mod(x + N + 4, 8) === 0 && mod(y + 4, 8) < 4 ? paper.shade : paper.base;
        m.set(x, y, z, z === 2 ? c : PR.woodDark.shade);
      }
  if (withWindow) {
    for (let x = -10; x <= 10; x++)
      for (let y = 32; y <= 62; y++) {
        for (let z = 0; z < 3; z++) m.del(x, y, z);
        const frame = Math.abs(x) >= 9 || y <= 33 || y >= 61 || x === 0 || y === 47;
        if (frame) m.set(x, y, 2, PR.paintWhite.base);
        else m.set(x, y, 0, 0x9ad0e8, VF.EMISSIVE);
      }
    for (let x = -12; x <= 12; x++) m.set(x, 31, 3, PR.paintWhite.hi).set(x, 31, 4, PR.paintWhite.base);
  }
  return S(m, FVS);
}

/** saloon batwing door leaf (1/24), hinge on the left edge at x=0 */
export function swingDoor(): StaticModel {
  const m = new VoxelModel('swing_door');
  const W = 14, H = 26;
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++) {
      const top = y > H - 3 - Math.round(Math.sin((x / W) * Math.PI) * 3);
      if (top && y > H - 3) continue;
      const frame = x === 0 || x === W - 1 || y === 0 || y === H - 3;
      m.set(x, y, 0, frame ? PR.woodDark.base : mod(y, 3) === 0 ? PR.woodDark.dark : PR.woodDark.hi);
      m.set(x, y, -1, PR.woodDark.shade);
    }
  m.box(0, 4, 1, 1, 6, 1, PR.brass.base, VF.METAL);
  m.box(0, H - 8, 1, 1, H - 6, 1, PR.brass.base, VF.METAL);
  return S(m, FVS);
}

export function roofBeam(): StaticModel {
  const m = new VoxelModel('roof_beam');
  board(m, -48, 0, -3, 48, 6, 3, PR.woodDark, 'x', 7, { dashes: 3 });
  for (const x of [-40, 0, 40]) {
    m.box(x - 4, -1, -4, x + 4, 7, -4, PR.iron.base, VF.METAL);
    m.box(x - 4, -1, 4, x + 4, 7, 4, PR.iron.base, VF.METAL);
  }
  rope(m, [[-20, -1, 0], [-20, -12, 0]]);
  return S(m, FVS);
}

// ---------------------------------------------------------------------------
// Main menu signpost
// ---------------------------------------------------------------------------
export interface MenuPlank {
  model: VoxelModel;
  voxelSize: number;
  label: string;
  /** nail point in the plank's own voxel coords (build the plank mesh with this pivot) */
  pivot: V3;
  /** where that pivot sits, metres relative to the post's bottom-centre pivot */
  at: V3;
  /** rest rotation (radians) — slight crooked tilt; z tilt only */
  rot: V3;
  /** +1 arrow points +X, -1 points -X */
  dir: 1 | -1;
}

/** chunky wooden signpost for the main menu: post with a cow skull + 5 arrow planks with painted labels (1/24) */
export function menuSign(): { post: StaticModel; planks: MenuPlank[] } {
  const vs = FVS;
  const v = meters(vs);
  const m = new VoxelModel('menu_post');
  const H = v(3.3);
  post(m, -2, -2, 0, H, 5, PR.wood, 11);
  // pointed cap + lantern hook + rope wrap
  for (let y = 0; y < 3; y++) m.box(-2 + y, H + 1 + y, -2 + y, 2 - y, H + 1 + y, 2 - y, PR.wood.hi);
  for (let y = 18; y < 24; y++) for (let x = -3; x <= 3; x++) for (const z of [-3, 3]) m.set(x, y, z, mod(y + x, 3) === 0 ? PR.rope.shade : PR.rope.base);
  for (let y = 18; y < 24; y++) for (let z = -3; z <= 3; z++) for (const x of [-3, 3]) m.set(x, y, z, mod(y + z, 3) === 0 ? PR.rope.shade : PR.rope.base);
  // sand mound at the base
  for (let x = -12; x <= 12; x++) for (let z = -10; z <= 10; z++) {
    const d = (x * x) / 144 + (z * z) / 100;
    if (d > 1) continue;
    const h = Math.round((1 - d) * 4);
    for (let y = 0; y < h; y++) if (!m.has(x, y, z)) m.set(x, y, z, y === h - 1 ? PR.sand.base : PR.sand.shade);
  }
  const labels = ['NEW RUN', 'RESUME', 'HIDEOUT', 'CODEX', 'SETTINGS'];
  const ramps = [PR.woodLight, PR.wood, PR.woodGrey, PR.wood, PR.woodLight];
  const out: MenuPlank[] = [];
  labels.forEach((label, i) => {
    const pm = new VoxelModel('plank_' + label);
    const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const tw = textWidth(label);
    const L = tw + 14, Hh = 11;
    const r = ramps[i];
    for (let x = 0; x < L; x++) {
      const tipD = dir > 0 ? L - 1 - x : x;
      const shrink = tipD < 5 ? 5 - tipD : 0;
      for (let y = shrink; y < Hh - shrink; y++)
        for (let z = 0; z < 3; z++) {
          const edge = y === shrink || y === Hh - shrink - 1;
          pm.set(x, y, z, z < 2 ? r.shade : edge ? (y === shrink ? r.shade : r.hi) : mod(y, 4) === 0 ? r.dark : r.base);
        }
    }
    stampText(pm, 'z+', label, Math.round(L / 2 - tw / 2) + (dir > 0 ? -2 : 2), Hh - 3, 3, { color: PR.ink.base });
    const nailX = dir > 0 ? 3 : L - 4;
    pm.set(nailX, Math.floor(Hh / 2), 3, PR.iron.dark, VF.METAL);
    const pivot: V3 = [nailX + 0.5, Hh / 2, 1.5];
    const y = H - 12 - i * 13;
    const at: V3 = [(dir > 0 ? 3 : -3) * vs, (y + Hh / 2) * vs, 4 * vs];
    out.push({ model: pm, voxelSize: vs, label, pivot, at, rot: [0, 0, ((i % 3) - 1) * 0.07], dir });
  });
  return { post: S(m, vs), planks: out };
}

