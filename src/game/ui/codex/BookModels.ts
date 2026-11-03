// The Codex's physical book, sculpted in voxels: two thick leather boards (blind
// tooling, a raised medallion, the gilded Alagard title, scuffs, a water stain,
// brass corner caps with rivets and patina, a clasp boss), a rounded spine with
// raised bands, the page blocks (deckled, yellowed, foxed fore-edges), the leather
// clasp strap, a walnut desk, an inkwell with a quill.
// Units: voxels of 1/320 m for the book (see BOOK), meshed with pivot [0, 0, 0] so
// voxel (i, j, k) sits at (i, j, k) / 320 m.
import * as THREE from 'three';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { hash3 } from '../../../engine/math/rand';
import { sculpt, dCap, dEll, smin, lump, mul } from '../../models/props/hideout';

export const BV = 1 / 320;
/** book dimensions (voxels): page width / height, text block thickness, board overhang width / height, board thickness */
export const BOOK = { PW: 96, PH: 134, TB: 20, CW: 101, CH: 142, BT: 4, SP: 7 };
/** the same in metres */
export const BM = { PW: BOOK.PW * BV, PH: BOOK.PH * BV, TB: BOOK.TB * BV, CW: BOOK.CW * BV, CH: BOOK.CH * BV, BT: BOOK.BT * BV };

/** the gutter: how the page block rises from the spine (u = 0) to its full height (u ≈ 0.15), then sags a hair */
export function prof(u: number) {
  return (1 - Math.exp(-Math.max(0, u) / 0.042)) * (1 - 0.035 * u);
}

const LEATHER = 0x5a2c18;
const LEATHER_DK = 0x3a1a0e;
const LEATHER_HI = 0x7a4426;
const BRASS = 0xb8892e;
const BRASS_HI = 0xe6c25a;
const BRASS_DK = 0x6e5018;
const PATINA = 0x5e7a5a;
const GOLD = 0xd8a84a;
const GOLD_DK = 0x8a6420;
const ENDPAPER = [0x3a4a6a, 0x6a3a2a, 0xa8865a, 0x2a3348];
const h01 = (x: number, y: number, z: number) => hash3(x, y, z);

function geo(m: VoxelModel, ao = 0.85) {
  return buildVoxelGeometry(m, { voxelSize: BV, pivot: [0, 0, 0], ao });
}

/** Alagard text rasterised to a voxel stencil (typography only: the letters are then embossed in gold) */
function stencil(text: string, px: number): { w: number; h: number; on: (x: number, y: number) => boolean } {
  const cv = document.createElement('canvas');
  // read back on the CPU: a GPU canvas would stall the frame on getImageData
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.font = `${px}px Alagard`;
  const w = Math.ceil(c.measureText(text).width) + 4;
  const h = Math.ceil(px * 1.25) + 4;
  cv.width = w;
  cv.height = h;
  c.font = `${px}px Alagard`;
  c.textBaseline = 'top';
  c.fillStyle = '#fff';
  c.imageSmoothingEnabled = false;
  c.fillText(text, 2, 2);
  const d = c.getImageData(0, 0, w, h).data;
  return { w, h, on: (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 110 };
}

/**
 * A leather board, authored lying flat: x ∈ [0, CW) (spine edge at x = 0), y ∈ [0, BT) plus relief on top,
 * z ∈ [-CH/2, CH/2). The OUTER face is the top (y = BT - 1, relief at y = BT); the inside (turn-ins and
 * marbled endpaper) is the bottom (y = 0). front: the title, the medallion and the clasp boss.
 */
export function coverBoard(front: boolean, seed = 3) {
  const { CW, CH, BT } = BOOK;
  const m = new VoxelModel(front ? 'codex_front' : 'codex_back');
  const z0 = -Math.floor(CH / 2), z1 = z0 + CH - 1;
  const top = BT - 1;
  // leather: mottled, darker in the creases, rubbed lighter at the edges and corners
  const leather = (x: number, y: number, z: number) => {
    const n = lump(x, y, z, 0.11, seed) * 0.5 + lump(x, z, y, 0.31, seed + 2) * 0.3;
    let c = mul(LEATHER, 1 + n * 0.12 + (h01(x, y, z) - 0.5) * 0.06);
    const ex = Math.min(x, CW - 1 - x), ez = Math.min(z - z0, z1 - z);
    const edge = Math.min(ex, ez);
    if (edge < 3) c = mul(LEATHER_HI, 0.92 + (h01(x, z, 7) - 0.5) * 0.12);
    // a water stain across the lower half
    const st = Math.hypot((x - CW * 0.62) / 30, (z - CH * 0.18) / 22) + lump(x, 0, z, 0.2, seed) * 0.18;
    if (st < 1 && st > 0.82) c = mul(c, 0.72);
    else if (st < 0.82) c = mul(c, 0.9);
    return c;
  };
  for (let x = 0; x < CW; x++)
    for (let z = z0; z <= z1; z++) {
      // rounded corners and a slightly soft, worn outline
      const cx = Math.min(x, CW - 1 - x), cz = Math.min(z - z0, z1 - z);
      if (cx < 2 && cz < 2 && Math.hypot(2 - cx, 2 - cz) > 2.3) continue;
      for (let y = 0; y < BT; y++) {
        let c = leather(x, y, z);
        // the inside: leather turn-ins round the edge, marbled endpaper inside them
        if (y === 0 && cx > 5 && cz > 5) {
          const mv = Math.sin(x * 0.21 + Math.sin(z * 0.13 + lump(x, 0, z, 0.17, seed) * 3) * 2.4);
          c = ENDPAPER[Math.floor((mv * 0.5 + 0.5) * 3.99)];
          if (h01(x, z, 11) > 0.97) c = mul(c, 1.3);
        }
        m.set(x, y, z, c);
      }
    }
  const set = (x: number, y: number, z: number, c: number, f?: number) => m.set(x, y, z, c, f);
  const carve = (x: number, z: number, deep: boolean) => {
    // blind tooling: pressed a voxel into the leather (darker, burnished)
    m.set(x, top, z, mul(LEATHER_DK, 0.9 + h01(x, z, 3) * 0.2));
    if (deep && m.has(x, top - 1, z)) m.set(x, top - 1, z, LEATHER_DK);
  };
  // double tooled frame
  for (const inset of [7, 10]) {
    for (let x = inset; x < CW - inset; x++) {
      carve(x, z0 + inset, false);
      carve(x, z1 - inset, false);
    }
    for (let z = z0 + inset; z <= z1 - inset; z++) {
      carve(inset, z, false);
      carve(CW - 1 - inset, z, false);
    }
  }
  // corner fleurons between the frame lines: little tooled diamonds
  for (const [fx, fz] of [[14, z0 + 14], [CW - 15, z0 + 14], [14, z1 - 14], [CW - 15, z1 - 14]])
    for (let a = -3; a <= 3; a++)
      for (let b = -3; b <= 3; b++) if (Math.abs(a) + Math.abs(b) === 3 || (a === 0 && b === 0)) carve(fx + a, fz + b, false);
  // brass corner caps on the outer corners (fore-edge side), wrapping both faces, riveted, gone green in the creases
  const cap = (zc: number, sgn: number) => {
    const L = 15;
    for (let i = 0; i < L; i++)
      for (let j = 0; j < L - i; j++) {
        const x = CW - 1 - i, z = zc - sgn * j;
        const rim = i + j >= L - 2;
        const pat = h01(x, z, 5) > 0.82 && !rim;
        const c = rim ? BRASS_DK : pat ? PATINA : i + j < 4 ? BRASS_HI : BRASS;
        for (const y of [-1, BT]) set(x, y, z, c, VF.METAL);
        if (i === 0 || j === 0) for (let y = -1; y <= BT; y++) set(i === 0 ? CW : x, y, j === 0 ? zc + sgn : z, c, VF.METAL);
      }
    for (const [ri, rj] of [[3, 7], [7, 3]]) {
      set(CW - 1 - ri, BT + 1, zc - sgn * rj, BRASS_HI, VF.METAL);
      set(CW - 1 - ri, -2, zc - sgn * rj, BRASS_HI, VF.METAL);
    }
  };
  cap(z1, 1);
  cap(z0, -1);
  if (front) {
    // the medallion: a raised oval ring with sun rays tooled round it
    const mx = Math.round(CW / 2), mz = Math.round(z0 + CH * 0.6);
    for (let x = mx - 26; x <= mx + 26; x++)
      for (let z = mz - 22; z <= mz + 22; z++) {
        const e = Math.hypot((x - mx) / 22, (z - mz) / 18);
        if (e > 0.86 && e < 1.0) set(x, BT, z, mul(LEATHER_HI, 0.95 + h01(x, z, 9) * 0.1));
        else if (e >= 1.0 && e < 1.35) {
          const a = Math.atan2(z - mz, x - mx);
          if (Math.abs(Math.sin(a * 12)) < 0.22) carve(x, z, false);
        } else if (e < 0.86) {
          // inside: an embossed scarab with its sun disc (Khepri), sculpted as relief
          const X = (x - mx) / 22, Z = (z - mz) / 18;
          const body = Math.hypot(X / 0.34, (Z - 0.12) / 0.46) < 1;
          const head = Math.hypot(X / 0.2, (Z + 0.42) / 0.14) < 1;
          const sun = Math.hypot(X, (Z + 0.68) / 0.9) < 0.22 && Z < -0.5;
          const legs = [-1, 1].some((s) => [-0.05, 0.18, 0.4].some((zz, k) => Math.abs(Z - zz - X * s * (0.25 + k * 0.1)) < 0.05 && Math.abs(X) > 0.3 && Math.abs(X) < 0.62));
          const split = Math.abs(X) < 0.035 && Z > -0.1 && Z < 0.55;
          if ((body || head || legs) && !split) set(x, BT, z, mul(LEATHER_HI, 1 + (body ? (0.6 - Math.hypot(X, Z - 0.12)) * 0.3 : 0)));
          if (sun) set(x, BT, z, GOLD, VF.METAL);
        }
      }
    // the title in gilt Alagard, raised; a smaller line under it
    const gild = (text: string, px: number, zTop: number) => {
      const s = stencil(text, px);
      const x0 = Math.round(CW / 2 - s.w / 2);
      for (let i = 0; i < s.w; i++)
        for (let j = 0; j < s.h; j++) {
          if (!s.on(i, j)) continue;
          const x = x0 + i, z = zTop + j;
          const shade = s.on(i, j + 1) ? (s.on(i - 1, j) ? GOLD : mul(GOLD, 1.15)) : GOLD_DK;
          set(x, BT, z, h01(x, z, 13) > 0.93 ? mul(shade, 0.7) : shade, VF.METAL);
        }
    };
    gild('CODEX', 30, z0 + 18);
    gild("of Serket's Reach", 13, z0 + 52);
    // the clasp boss near the fore-edge: a riveted brass plate with a domed stud
    const bz = Math.round(z0 + CH / 2);
    for (let x = CW - 13; x <= CW - 4; x++)
      for (let z = bz - 6; z <= bz + 6; z++) {
        const r = Math.hypot(x - (CW - 8.5), (z - bz) * 0.8);
        if (r < 5.6) set(x, BT, z, r > 4.6 ? BRASS_DK : BRASS, VF.METAL);
        if (r < 2.4) set(x, BT + 1, z, BRASS_HI, VF.METAL);
      }
  }
  // scuffs: a few scratches through the finish
  for (let k = 0; k < 7; k++) {
    let x = 12 + h01(k, 1, seed) * (CW - 24), z = z0 + 12 + h01(k, 2, seed) * (CH - 24);
    const a = h01(k, 3, seed) * Math.PI, L = 6 + h01(k, 4, seed) * 14;
    for (let s = 0; s < L; s++) {
      x += Math.cos(a);
      z += Math.sin(a);
      const xi = Math.round(x), zi = Math.round(z);
      if (m.get(xi, top, zi) !== undefined && !m.has(xi, BT, zi)) m.set(xi, top, zi, mul(LEATHER_HI, 1.15));
    }
  }
  return geo(m);
}

/** the spine (closed book): a rounded leather back with five raised bands and gilt rules; x ∈ [-SP, 0) */
export function spine(seed = 5) {
  const { CH, BT, TB, SP } = BOOK;
  const m = new VoxelModel('codex_spine');
  const H = BT * 2 + TB;
  const z0 = -Math.floor(CH / 2), z1 = z0 + CH - 1;
  const bands = [0.16, 0.32, 0.5, 0.68, 0.84].map((f) => Math.round(z0 + CH * f));
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H * 2 - 1;
    const bulge = Math.sqrt(Math.max(0, 1 - v * v));
    for (let z = z0; z <= z1; z++) {
      const band = bands.some((b) => Math.abs(z - b) <= 1);
      const depth = Math.round(2 + bulge * (SP - 3) + (band ? 1.4 : 0));
      for (let d = 0; d < depth; d++) {
        let c = mul(LEATHER, 1 + lump(y, d, z, 0.2, seed) * 0.1 + (h01(y, d, z) - 0.5) * 0.05);
        if (d === depth - 1 && band) c = mul(LEATHER_HI, 1.05);
        if (d === depth - 1 && bands.some((b) => Math.abs(z - b) === 3)) c = GOLD_DK;
        if (Math.min(z - z0, z1 - z) < 2) c = mul(LEATHER_HI, 0.9);
        m.set(-1 - d, y, z, c, c === GOLD_DK ? VF.METAL : undefined);
      }
    }
  }
  return geo(m);
}

/**
 * One page block (the right one; the left one is the same mirrored), authored at full thickness TB and
 * scaled in y by its share of the pages. Only the visible walls: the fore-edge, head and tail.
 */
export function pageBlock(seed = 7) {
  const { PW, PH, TB } = BOOK;
  const m = new VoxelModel('codex_block');
  const z0 = -Math.floor(PH / 2), z1 = z0 + PH - 1;
  const paper = (x: number, y: number, z: number) => {
    const row = y;
    let c = row % 2 ? 0xe2cfa0 : 0xd8c290;
    if (h01(row, Math.floor(z / 9), seed) > 0.8) c = 0xc8ae7c;
    if (h01(x, y, z) > 0.985) c = 0x9a7448; // foxing
    const top = Math.max(0, (y - (TB - 4)) / 4);
    c = mul(c, 1 - top * 0.18 - (h01(Math.floor(x / 5), y, Math.floor(z / 5)) - 0.5) * 0.06);
    // the fore-edge is thumbed darker round the middle
    const thumb = Math.exp(-Math.pow((z - (z0 + PH * 0.62)) / 16, 2)) * (x > PW - 4 ? 1 : 0);
    return mul(c, 1 - thumb * 0.2);
  };
  for (let x = 0; x < PW; x++) {
    const H = Math.max(1, Math.round(TB * prof((x + 0.5) / PW)));
    for (let y = 0; y < H; y++) {
      // deckled: rows don't line up perfectly at the fore-edge
      const dk = h01(y, 3, seed) < 0.3 ? 1 : 0;
      for (let z = z0; z <= z1; z++) {
        const head = z - z0 < 2 || z1 - z < 2;
        const fore = x >= PW - 2 - dk && x < PW - dk;
        if (!head && !fore) continue;
        if (head && x >= PW - dk) continue;
        m.set(x, y, z, paper(x, y, z), VF.SOFTAO);
      }
    }
  }
  return geo(m, 0.6);
}

/**
 * The clasp strap, two links: the band (pivot at the back board's fore-edge, running up the closed book's edge)
 * and the tongue (pivot at the band's top end, lying over the front cover) with its brass catch.
 */
export function strap(seed = 9) {
  const { BT, TB } = BOOK;
  const H = BT * 2 + TB + 1;
  const band = new VoxelModel('codex_strap_band');
  const tongue = new VoxelModel('codex_strap_tongue');
  const W = 9;
  const lea = (a: number, b: number, c: number) => mul(LEATHER_DK, 1.15 + lump(a, b, c, 0.3, seed) * 0.12 + (h01(a, b, c) - 0.5) * 0.08);
  // band: x ∈ [0, 2), y ∈ [0, H), z ∈ [-W/2, W/2)
  for (let y = 0; y < H; y++)
    for (let z = -Math.floor(W / 2); z < Math.ceil(W / 2); z++)
      for (let x = 0; x < 2; x++) {
        const stitch = Math.abs(z) === 3 && y % 3 === 0 && x === 1;
        band.set(x, y, z, stitch ? 0xd8c8a0 : lea(x, y, z));
      }
  // tongue: lies along -x from its pivot, y ∈ [0, 2), rounded end with a brass catch plate
  const L = 24;
  for (let i = 0; i < L; i++)
    for (let z = -Math.floor(W / 2); z < Math.ceil(W / 2); z++) {
      const endR = i > L - 5 ? Math.hypot(i - (L - 5), z * 1.1) : 0;
      if (endR > 4.6) continue;
      for (let y = 0; y < 2; y++) {
        const stitch = Math.abs(z) === 3 && i % 3 === 0 && y === 1 && i < L - 7;
        tongue.set(-1 - i, y, z, stitch ? 0xd8c8a0 : lea(i, y, z));
      }
      // the brass catch: a slotted plate on the tongue's end
      if (i > L - 10 && i < L - 2 && Math.abs(z) <= 3) {
        const slot = Math.abs(z) <= 1 && i > L - 8 && i < L - 4;
        if (!slot) tongue.set(-1 - i, 2, z, i === L - 9 || i === L - 3 || Math.abs(z) === 3 ? BRASS_DK : BRASS, VF.METAL);
      }
    }
  return { band: geo(band), tongue: geo(tongue), height: H * BV, len: L * BV };
}

/** the walnut desk the book lies on: wide grain, worn pale where elbows rest, an ink spill, a lamp-burn ring */
export function desk(seed = 11) {
  const VS = 1 / 48;
  const m = new VoxelModel('codex_desk');
  const X = 46, Z = 28;
  for (let x = -X; x <= X; x++)
    for (let z = -Z; z <= Z; z++) {
      const ez = Z - Math.abs(z), ex = X - Math.abs(x);
      for (let y = -3; y <= 0; y++) {
        if (y === 0 && (ez === 0 || ex === 0)) continue; // the bevelled edge
        const g = Math.sin(z * 0.9 + Math.sin(x * 0.05 + z * 0.2) * 2.2 + lump(x, 0, z, 0.08, seed) * 3);
        let c = mul(g > 0.6 ? 0x5a3420 : g < -0.5 ? 0x3a2012 : 0x4a2a18, 1 + (h01(x, y, z) - 0.5) * 0.05);
        if (y === 0) {
          const elbow = Math.exp(-Math.pow(z / 18, 2)) * Math.exp(-Math.pow((Math.abs(x) - 30) / 9, 2));
          c = mul(c, 1 + elbow * 0.25);
          const ink = Math.hypot((x - 31) / 4.5, (z + 13) / 3) + lump(x, 0, z, 0.6, seed) * 0.4;
          if (ink < 1) c = 0x14100e;
          const ring = Math.abs(Math.hypot(x + 28, z + 12) - 6.5);
          if (ring < 0.7) c = mul(c, 0.7);
        }
        m.set(x, y, z, c);
      }
    }
  return { geo: buildVoxelGeometry(m, { voxelSize: VS, pivot: [0.5, 1, 0.5], ao: 0.7 }), w: (X * 2 + 1) * VS, d: (Z * 2 + 1) * VS };
}

/** a squat ink bottle (black glass, brass collar) with a quill standing in it */
export function inkwell(seed = 13) {
  const VS = 1 / 256;
  const m = new VoxelModel('codex_inkwell');
  const R = 11;
  sculpt(m, -R - 1, 0, -R - 1, R + 1, 18, R + 1, (x, y, z) => {
    const body = dEll(x + 0.5, y + 0.5, z + 0.5, 0, 7, 0, R, 7.2, R);
    const neck = dCap(x + 0.5, y + 0.5, z + 0.5, [0, 11, 0], [0, 16, 0], 5.2, 4.6);
    return smin(body, neck, 2.5);
  }, (x, y, z) => {
    if (y >= 14) return mul(BRASS, 0.95 + h01(x, y, z) * 0.15);
    const hi = x < -3 && z > 2 && y > 7 && y < 11;
    return hi ? 0x4a5a5a : mul(0x141a1a, 1 + (h01(x, y, z) - 0.5) * 0.2);
  });
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (x * x + z * z <= 10) m.set(x, 17, z, 0x05080a);
  // the quill: a curved shaft and a long, ragged vane
  const tip: [number, number, number] = [0, 10, 0];
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    pts.push([tip[0] - t * 18 - t * t * 10, tip[1] + t * 70 + Math.sin(t * 2.2) * 2, tip[2] + t * 9 + t * t * 6]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const t = i / (pts.length - 1);
    const [a, b] = [pts[i], pts[i + 1]];
    sculpt(m, Math.min(a[0], b[0]) - 2, Math.min(a[1], b[1]) - 2, Math.min(a[2], b[2]) - 2, Math.max(a[0], b[0]) + 2, Math.max(a[1], b[1]) + 2, Math.max(a[2], b[2]) + 2, (x, y, z) => dCap(x + 0.5, y + 0.5, z + 0.5, a, b, 0.9, 0.8), () => (t < 0.25 ? 0xe8dcc0 : 0xd8ccb0));
    if (t > 0.22) {
      const w = Math.sin(Math.min(1, (t - 0.22) / 0.78) * Math.PI) * 7 * (1 - t * 0.2) + 1.2;
      for (let s = 1; s <= w; s++)
        for (const side of [-1, 1]) {
          const jag = h01(i, s, seed) > 0.88 ? 0 : 1;
          if (!jag && s > 2) continue;
          const x = Math.round(a[0] + side * s * 0.92), y = Math.round(a[1] - s * 0.55), z = Math.round(a[2] + side * s * 0.3);
          m.set(x, y, z, side < 0 ? mul(0xf0e6d0, 0.95 + h01(x, y, z) * 0.1) : mul(0xb8a88a, 0.95 + h01(x, y, z) * 0.1), VF.SOFTAO);
        }
    }
  }
  return buildVoxelGeometry(m, { voxelSize: VS, pivot: 'bottom', ao: 0.8 });
}

/** a silk ribbon bookmark lying down the gutter and over the tail edge onto the desk, swallow-tailed */
export function ribbonGeometry(points: THREE.Vector3[], width: number) {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3 + 3);
  const uv = new Float32Array(n * 2 * 2 + 2);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < 2; s++) {
      const k = (i * 2 + s) * 3;
      pos[k] = points[i].x + (s ? width / 2 : -width / 2);
      pos[k + 1] = points[i].y;
      pos[k + 2] = points[i].z;
      uv[(i * 2 + s) * 2] = s;
      uv[(i * 2 + s) * 2 + 1] = i / (n - 1);
    }
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
