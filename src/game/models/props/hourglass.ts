// The loading-screen hourglass: a sculpted voxel frame of gold, lapis and old bone around a hand-blown
// glass. Gold caps carry a band of carved hieroglyphs inlaid with glowing jade, a lotus-petal lip and a
// beaded collar where the glass seats; four bound papyrus columns of bone hold the caps apart; jackal-paw
// feet below and a winged soul-disc on top. Pure geometry (no DOM): it is built inside the loading worker.
//
// Units: voxels of HG.vs metres, origin at the waist of the glass, Y up. Cells are integers; a cell's
// centre sits at (x + 0.5, y + 0.5, z + 0.5), so the model is symmetric about the origin.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';

export const HG = {
  /** metres per voxel */
  vs: 1 / 44,
  /** the glass spans |y| <= GLASS_H (voxels) */
  glassH: 30,
  /** glass wall thickness (voxels) */
  glassT: 0.7,
  /** how far the frame reaches above / below the origin (voxels), for framing the camera */
  top: 55,
  bottom: -44,
};

// inner radius of the glass by height |y| (voxels): a narrow waist, full shoulders, a soft lip at the caps
const PROF: [number, number][] = [
  [0, 1.15], [1.2, 1.35], [2.6, 2.4], [4.5, 4.6], [7, 7.9], [10, 11], [13, 13.4], [16, 14.8], [19, 15.3],
  [21.5, 15], [24, 13.6], [26.2, 11.3], [28, 8.8], [29.3, 7], [30, 6.3],
];

/** inner glass radius (voxels) at height y (voxels); 0 outside the glass */
export function glassR(y: number): number {
  const a = Math.abs(y);
  if (a > HG.glassH) return 0;
  let i = 0;
  while (i < PROF.length - 2 && PROF[i + 1][0] < a) i++;
  // Catmull-Rom through the profile keys
  const p0 = PROF[Math.max(0, i - 1)], p1 = PROF[i], p2 = PROF[i + 1], p3 = PROF[Math.min(PROF.length - 1, i + 2)];
  const t = (a - p1[0]) / Math.max(1e-6, p2[0] - p1[0]);
  const t2 = t * t, t3 = t2 * t;
  const m1 = ((p2[1] - p0[1]) / Math.max(1e-6, p2[0] - p0[0])) * (p2[0] - p1[0]);
  const m2 = ((p3[1] - p1[1]) / Math.max(1e-6, p3[0] - p1[0])) * (p2[0] - p1[0]);
  return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
}

// ------------------------------------------------------------------ palette (base / shade / light / accent)
const GOLD = { d: 0x4e3009, s: 0x9a6a1c, m: 0xcf9a36, l: 0xefc865, h: 0xfff0b4 };
const LAPIS = { d: 0x101c48, s: 0x1c2f72, m: 0x284a9e, l: 0x4a72c8 };
const BONE = { d: 0x8a7350, s: 0xc4aa7c, m: 0xe6d3a8, l: 0xf8eed4 };
const JADE = { glow: 0x5effb8, mid: 0x2fbf7e, deep: 0x0f5a3a };

const METAL = VF.SOLID | VF.METAL;
const GLOWF = VF.SOLID | VF.GLOW;
const EMIS = VF.SOLID | VF.EMISSIVE;

// ------------------------------------------------------------------ hieroglyphs (one char per carved cell)
/** carvings for the cap bands: five rows tall */
const BAND_GLYPHS: string[][] = [
  ['.#.', '#.#', '###', '.#.', '.#.'], // ankh
  ['#####', '.....', '.###.', '##.##', '.###.'], // eye under its brow
  ['###', '.#.', '###', '.#.', '###'], // djed
  ['.#', '##', '##', '.#', '.#'], // feather of Maat
  ['.###.', '#####', '.###.', '#.#.#', '.#.#.'], // scarab
  ['#.#.#', '.#.#.', '.....', '#.#.#', '.#.#.'], // water
  ['.###.', '#####', '#####', '.###.', '#...#'], // horned sun
  ['##.', '.#.', '.#.', '.#.', '.##'], // was sceptre
];

/** the floating glyphs of the background */
export const FLOAT_GLYPHS: string[][] = [
  ['..###..', '.#...#.', '.#...#.', '..#.#..', '#######', '...#...', '...#...', '...#...', '..###..'], // ankh
  ['###########', '...........', '...#####...', '.##.###.##.', '#...###...#', '.#########.', '....#..#...', '...#....##.', '..#......#.'], // wedjat
  ['#######', '.#####.', '#######', '.#####.', '#######', '..###..', '..###..', '..###..', '.#####.'], // djed
  ['....#....', '..#####..', '.#.###.#.', '#.#####.#', '..#####..', '#.##.##.#', '.#.#.#.#.', '..#...#..', '.#.....#.'], // scarab
  ['..##.', '.###.', '.####', '.####', '.###.', '.###.', '..##.', '..#..', '..#..'], // feather
  ['##....', '.###..', '..#...', '..#...', '..#...', '..#...', '..#...', '..#...', '.#.#..'], // was
  ['..###..', '.#...#.', '#.....#', '#.....#', '.#...#.', '..###..', '...#...', '#######', '.......'], // shen
  ['.#..#..#.', '#.##.##.#', '.........', '.#..#..#.', '#.##.##.#', '.........', '.#..#..#.', '#.##.##.#', '.........'], // water
];

/** one column of the carved frieze around a band: which glyph and which of its columns (or a divider) */
function friezeColumns(n: number): ({ g: number; c: number } | 'bar' | null)[] {
  const out: ({ g: number; c: number } | 'bar' | null)[] = [];
  let gi = 0;
  while (out.length < n) {
    // a cartouche: divider, three glyphs, divider
    out.push('bar', null);
    for (let k = 0; k < 3; k++) {
      const g = BAND_GLYPHS[gi % BAND_GLYPHS.length];
      for (let c = 0; c < g[0].length; c++) out.push({ g: gi % BAND_GLYPHS.length, c });
      out.push(null);
      gi++;
    }
  }
  return out.slice(0, n);
}

const hash = (x: number, y: number, z: number) => {
  let h = Math.imul(x * 374761393 + y * 668265263 + z * 2147483647, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ------------------------------------------------------------------ the cap (bottom when s = -1, top when s = +1)
const BAND_R = 21;
const FRIEZE_N = Math.round(2 * Math.PI * BAND_R);
const FRIEZE = friezeColumns(FRIEZE_N);

function buildCap(m: VoxelModel, s: 1 | -1) {
  // layer d (0 = against the glass) -> cell y
  const Y = (d: number) => (s > 0 ? HG.glassH + d : -HG.glassH - 1 - d);
  const R = 25;
  for (let d = 0; d <= 10; d++) {
    const y = Y(d);
    for (let x = -R; x < R; x++)
      for (let z = -R; z < R; z++) {
        const cx = x + 0.5, cz = z + 0.5;
        const r = Math.hypot(cx, cz);
        const th = Math.atan2(cz, cx);
        if (d === 0) {
          // the seat: a beaded gold collar that cups the glass
          const bead = Math.cos(th * 16) > 0.2 ? 0.7 : 0;
          if (r > 5.6 && r < 8.8 + bead) m.set(x, y, z, r > 8.2 ? GOLD.l : GOLD.s, METAL);
          // lapis ring between the collar and the columns, stepped down to the glass
          else if (r >= 8.8 + bead && r < 12.5) m.set(x, y, z, LAPIS.s);
          continue;
        }
        if (d === 1) {
          // inner face of the cap: gold, a rope of beads at the rim
          const rim = 21.4 + (Math.cos(th * 44) > 0 ? 0.6 : 0);
          if (r < rim) m.set(x, y, z, r > 20.4 ? GOLD.l : r < 12.5 ? GOLD.s : GOLD.m, METAL);
          continue;
        }
        if (d >= 2 && d <= 8) {
          // the hieroglyph band, gold trims top and bottom
          const trim = d === 2 || d === 8;
          const rr = trim ? 21.7 : BAND_R;
          if (r >= rr) continue;
          if (trim) {
            m.set(x, y, z, r > 20.8 ? GOLD.l : GOLD.m, METAL);
            continue;
          }
          // carve: rows 0..4 live in d = 3..7, glyph top row towards the far side of the cap from the glass
          const row = s > 0 ? 7 - d : d - 3;
          const ci = Math.floor(((th + Math.PI) / (Math.PI * 2)) * FRIEZE_N) % FRIEZE_N;
          const f = FRIEZE[ci];
          let on = false;
          if (f === 'bar') on = true;
          else if (f && row >= 0 && row < 5) on = BAND_GLYPHS[f.g][row][f.c] === '#';
          if (r > BAND_R - 1) {
            if (on) continue; // carved away
            const fleck = hash(x, y, z) < 0.025;
            m.set(x, y, z, fleck ? GOLD.l : row === 0 ? LAPIS.l : row === 4 ? LAPIS.s : LAPIS.m, fleck ? METAL : VF.SOLID);
          } else if (r > BAND_R - 2) {
            // the floor of each carved line: jade inlay that glows
            m.set(x, y, z, on ? (f === 'bar' ? JADE.mid : JADE.glow) : LAPIS.d, on ? (f === 'bar' ? EMIS : GLOWF) : VF.SOLID);
          } else m.set(x, y, z, GOLD.s, METAL);
          continue;
        }
        if (d === 9) {
          // lotus lip: twelve petals, each with a raised midrib
          const pk = Math.abs(Math.cos(th * 6));
          const rr = 21.2 + 2.2 * Math.pow(pk, 0.55);
          if (r >= rr) continue;
          const rib = pk > 0.97 && r > 20;
          m.set(x, y, z, rib ? GOLD.h : r > rr - 1.1 ? GOLD.l : GOLD.m, METAL);
          continue;
        }
        if (d === 10) {
          // stepped back bevel, the petal tips folding over it
          const pk = Math.abs(Math.cos(th * 6));
          const rr = 19.5 + 2.2 * Math.pow(pk, 0.8);
          if (r >= rr) continue;
          m.set(x, y, z, r > rr - 1 ? GOLD.l : GOLD.m, METAL);
        }
      }
  }
}

// ------------------------------------------------------------------ columns: four bound papyrus stems of bone
function buildColumns(m: VoxelModel) {
  const RC = 20.3;
  const yb = -HG.glassH - 1, yt = HG.glassH;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const px = Math.cos(a) * RC, pz = Math.sin(a) * RC;
    for (let y = yb; y <= yt; y++) {
      const cy = y + 0.5;
      const u = Math.abs(cy) / HG.glassH; // 0 at the waist, 1 at the caps
      // entasis, a flared lotus capital at each end, three bindings at each end
      const flare = Math.pow(Math.max(0, (u - 0.8) / 0.2), 1.6) * 1.7;
      const base = 1.75 * (1 + 0.06 * Math.cos(u * Math.PI * 0.5)) + flare;
      const ay = Math.abs(cy);
      const binding = (ay > 20 && ay < 21.4) || (ay > 22.2 && ay < 23.6) || (ay > 2.2 && ay < 3.4) || ay < 0.9;
      const R = base + (binding ? 0.8 : 0) + 0.6;
      for (let x = Math.floor(px - R - 1); x <= Math.ceil(px + R + 1); x++)
        for (let z = Math.floor(pz - R - 1); z <= Math.ceil(pz + R + 1); z++) {
          const dx = x + 0.5 - px, dz = z + 0.5 - pz;
          const r = Math.hypot(dx, dz);
          const phi = Math.atan2(dz, dx) - a;
          // a bundle of four stems: lobed cross-section, grooves between them
          const lobe = Math.pow(Math.abs(Math.cos(phi * 2)), 0.7);
          const rr = binding ? base + 0.8 : base * (0.8 + 0.28 * lobe) + 0.25;
          if (r >= rr) continue;
          if (binding) {
            m.set(x, y, z, ay < 0.9 ? GOLD.h : (y & 1) === 0 ? GOLD.l : GOLD.m, METAL);
            continue;
          }
          const groove = lobe < 0.35 && r > rr - 1.1;
          const petal = flare > 0.05 && Math.cos(phi * 4) > 0.6 && r > rr - 1;
          m.set(x, y, z, petal ? GOLD.m : groove ? BONE.s : r > rr - 0.9 && lobe > 0.85 ? BONE.l : BONE.m, petal ? METAL : VF.SOLID);
        }
    }
    // a jade scarab-gem on the outer face at the waist, gold bezel
    const ox = Math.cos(a), oz = Math.sin(a);
    for (let j = -2; j <= 2; j++)
      for (let i = -2; i <= 2; i++) {
        if (Math.abs(i) + Math.abs(j) > 3) continue;
        const gx = px + ox * 2.9 - oz * i, gz = pz + oz * 2.9 + ox * i;
        const edge = Math.abs(i) + Math.abs(j) === 3 || Math.abs(i) === 2 || Math.abs(j) === 2;
        m.set(Math.floor(gx), j + 9, Math.floor(gz), edge ? GOLD.l : JADE.glow, edge ? METAL : GLOWF);
        if (!edge) m.set(Math.floor(gx - ox), j + 9, Math.floor(gz - oz), JADE.mid, EMIS);
      }
  }
}

// ------------------------------------------------------------------ jackal-paw feet
function buildFeet(m: VoxelModel) {
  const y0 = -HG.glassH - 12;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const ox = Math.cos(a), oz = Math.sin(a);
    const px = ox * 17, pz = oz * 17;
    for (let y = y0 - 2; y <= y0; y++)
      for (let x = Math.floor(px - 6); x <= Math.ceil(px + 6); x++)
        for (let z = Math.floor(pz - 6); z <= Math.ceil(pz + 6); z++) {
          const dx = x + 0.5 - px, dz = z + 0.5 - pz;
          const along = dx * ox + dz * oz, side = -dx * oz + dz * ox;
          const h = (y0 + 1 - (y + 0.5)) / 3; // 0 top .. 1 floor
          // a pad that swells forward into three toes
          const toe = along > 1.2 ? 0.55 + 0.45 * Math.abs(Math.cos(side * 1.05)) : 1;
          const rr = (3.4 + h * 1.1) * toe + (along > 0 ? 1.4 : 0);
          if (Math.hypot(along * 0.82, side) >= rr) continue;
          const claw = along > 3.6 && h > 0.6 && Math.abs(Math.cos(side * 1.05)) > 0.8;
          m.set(x, y, z, claw ? BONE.l : h < 0.3 ? GOLD.l : h > 0.7 ? GOLD.s : GOLD.m, claw ? VF.SOLID : METAL);
        }
  }
}

// ------------------------------------------------------------------ the winged soul-disc on top
function buildFinial(m: VoxelModel) {
  const yb = HG.glassH + 11; // first free row above the top cap
  // the disc: a jade soul-orb held in a gold ring
  const cy = yb + 6.5;
  for (let y = yb; y < yb + 13; y++)
    for (let x = -6; x < 6; x++)
      for (let z = -3; z < 3; z++) {
        const dx = x + 0.5, dy = y + 0.5 - cy, dz = z + 0.5;
        const r = Math.hypot(dx, dy);
        if (r < 4.2 && Math.abs(dz) < 2.2 - (r > 3.4 ? 0.8 : 0)) m.set(x, y, z, r < 1.8 ? 0xd8fff0 : JADE.glow, GLOWF);
        else if (r < 5.6 && r >= 4.2 && Math.abs(dz) < 1.5) m.set(x, y, z, dy > 2 ? GOLD.h : GOLD.l, METAL);
      }
  // a pair of uraeus cobras rearing either side of the disc
  for (const sx of [-1, 1]) {
    for (let y = yb; y < yb + 9; y++) {
      const t = (y - yb) / 8;
      const xx = sx * (5.6 + Math.sin(t * Math.PI) * 0.8);
      const hood = t > 0.55 ? 1.2 : 0.6;
      for (let x = Math.floor(xx - hood); x <= Math.ceil(xx + hood); x++)
        for (let z = -1; z <= 0; z++) {
          if (Math.abs(x + 0.5 - xx) > hood) continue;
          m.set(x, y, z, t > 0.85 ? GOLD.h : z === 0 ? GOLD.l : GOLD.m, METAL);
        }
    }
    m.set(sx > 0 ? 5 : -6, yb + 7, 1, 0xff5a3a, GLOWF);
  }
  // the wings: three feather courses, coverts over lapis over long primaries with notched tips
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 18; i++) {
      const ax = 6 + i; // distance from centre (voxels)
      const t = i / 17;
      const top = yb + 7 - Math.pow(t, 1.4) * 6; // the leading edge droops to the tip
      const covertsB = top - 2.2;
      const lapisB = covertsB - 1.6 - t * 0.4;
      const notch = (i % 3) === 2 ? 1 : 0;
      const tipB = lapisB - 4.2 + t * 1.8 + notch;
      const x = sx > 0 ? ax : -ax - 1;
      for (let y = Math.floor(tipB); y < Math.ceil(top); y++) {
        const cyv = y + 0.5;
        if (cyv < tipB || cyv > top) continue;
        let col = GOLD.m, fl = METAL;
        if (cyv > covertsB) col = cyv > top - 1 ? GOLD.h : GOLD.l;
        else if (cyv > lapisB) {
          col = (i & 1) ? LAPIS.m : LAPIS.l;
          fl = VF.SOLID;
        } else col = i % 3 === 0 ? GOLD.s : GOLD.m;
        const zr = cyv > lapisB ? 1 : 0;
        for (let z = -1 - zr; z <= zr; z++) m.set(x, y, z, z === -1 - zr || z === zr ? col : GOLD.s, fl);
      }
    }
  }
}

/** shade gold by exposure: a highlight row on top edges, darker undersides (hand-placed, flat runs) */
function shadeGold(m: VoxelModel) {
  const ups: [number, number, number][] = [];
  const downs: [number, number, number][] = [];
  m.forEach((x, y, z, rgb, flags) => {
    if (!(flags & VF.METAL)) return;
    if (rgb === GOLD.h) return;
    if (!m.has(x, y + 1, z)) ups.push([x, y, z]);
    else if (!m.has(x, y - 1, z)) downs.push([x, y, z]);
  });
  for (const [x, y, z] of ups) m.paintAt(x, y, z, (m.get(x, y, z)! & 0xffffff) === GOLD.l ? GOLD.h : GOLD.l);
  for (const [x, y, z] of downs) m.paintAt(x, y, z, GOLD.s);
}

/** the whole frame (caps, columns, feet, finial) as one voxel model; mesh it with pivot [0, 0, 0] */
export function hourglassFrame(): VoxelModel {
  const m = new VoxelModel('hourglass_frame');
  buildCap(m, -1);
  buildCap(m, 1);
  buildColumns(m);
  buildFeet(m);
  buildFinial(m);
  shadeGold(m);
  return m;
}

/** a floating glyph tablet: the carved shape, two cells deep, raised edge cells on the front */
export function glyphModel(g: string[]): VoxelModel {
  const m = new VoxelModel('glyph');
  const h = g.length, w = g[0].length;
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      if (g[r][c] !== '#') continue;
      const x = c - Math.floor(w / 2), y = h - 1 - r - Math.floor(h / 2);
      m.set(x, y, 0, JADE.glow, GLOWF);
      m.set(x, y, -1, JADE.mid, EMIS);
    }
  return m;
}
