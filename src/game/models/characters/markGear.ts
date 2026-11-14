// Mark's gear, sculpted as signed distance fields in centimetres and voxelised fine:
//  • the CRESCENT GLIDE BOARD (1/100 m): a waning crescent of temple bone, about
//    1.5 m tip to tip along Z, thick at the belly and thinning to two up-curled horns,
//    a silver rim inlay on the outer curve, a lapis channel down the deck set with
//    silver phase glyphs and a moon-disc boss under his feet; underneath, moonstone
//    runes and an emitter disc that glow (he hovers on that light).
//  • a TWIN BATON (1/256 m) as a rig (`grip` root, pivot at the grip centre, the
//    baton along +Y so the player's hand holder points it out of the thumb side of
//    the fist): a silver pommel with a crescent hook (the staff coupling), a linen-
//    over-lapis wrapped grip, a crescent guard, an ebony shaft ringed with silver
//    phase bands, and a silver cap carrying a glowing moonstone.
//  • the MOON CREST (1/192 m): a crescent boomerang ~42 cm across with honed inner
//    edges, a lapis groove inlay, engraved rim and a moonstone boss (lies in the XZ
//    plane, spins about Y in flight).
import type { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { sculpt, type Surf, smin, sdEll, h3, fbm3 } from '../../ui/HudKit';
import { MARK_PAL } from './mark';

const MT = VF.SOLID | VF.METAL, EM = VF.SOLID | VF.EMISSIVE, GL = VF.SOLID | VF.GLOW, S1 = VF.SOLID;
const SV = MARK_PAL.silver, LP = MARK_PAL.lapis, MN = MARK_PAL.moon;
const BONE = { base: 0xeadfc8, shade: 0xc9b998, hi: 0xfaf3e3, dark: 0x9c8a6c };
const EBONY = { base: 0x2a1e1c, shade: 0x1b1312, hi: 0x4a3732, grain: 0x3a2a26 };
const hyp = Math.hypot;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
type SD = (x: number, y: number, z: number) => number;
type Paint = (x: number, y: number, z: number, s: Surf) => [number, number];

function carveK(name: string, K: number, lo: V3, hi: V3, sd: SD, paint: Paint): VoxelModel {
  const box: [number, number, number, number, number, number] = [
    Math.floor(lo[0] * K) - 1, Math.floor(lo[1] * K) - 1, Math.floor(lo[2] * K) - 1,
    Math.ceil(hi[0] * K) + 1, Math.ceil(hi[1] * K) + 1, Math.ceil(hi[2] * K) + 1,
  ];
  return sculpt(name, box, (x, y, z) => sd(x / K, y / K, z / K), (x, y, z, s) => paint((x + 0.5) / K, (y + 0.5) / K, (z + 0.5) / K, s));
}
function silver(s: Surf): number {
  if (s.exp < 0.15) return SV.dark;
  if (s.ny > 0.45 || s.exp > 0.8) return SV.hi;
  if (s.ny < -0.4) return SV.shade;
  return SV.base;
}
function lapis(x: number, y: number, z: number, s: Surf): number {
  if (h3(Math.floor(x * 1.4), Math.floor(y * 1.4), Math.floor(z * 1.4), 4) < 0.05) return LP.fleck;
  return s.ny < -0.4 ? LP.shade : s.ny > 0.5 ? LP.hi : LP.base;
}

// ================================================================== CRESCENT GLIDE BOARD
// top view: outer circle A (centre x=-67, r 85), inner circle B (centre x=-335, r 317): the belly is
// 36 cm wide at z = 0 and the horns meet at z = +-75 (curving toward -X)
const BA = { x: -67, r: 85 }, BB = { x: -335, r: 317 };
function crescent2(x: number, z: number) {
  return Math.max(hyp(x - BA.x, z) - BA.r, -(hyp(x - BB.x, z) - BB.r));
}
/** deck shape: rocker (horns curl up), thickness tapering to the tips */
const rocker = (z: number) => 6.5 * Math.pow(Math.abs(z) / 75, 2.6);
const thick = (z: number) => 2.7 - 1.6 * Math.pow(Math.abs(z) / 75, 1.6);
function boardSd(x: number, y: number, z: number) {
  const c = crescent2(x, z);
  const yc = rocker(z);
  const h = thick(z);
  // a rounded slab: the 2D crescent extruded with soft edges
  const dy = Math.abs(y - yc) - h;
  let d = Math.min(Math.max(c, dy), 0) + hyp(Math.max(c, 0), Math.max(dy, 0)) - 0.6;
  // a slight dish in the deck under his feet
  if (y > yc + h - 0.9 && Math.abs(z) < 34 && c < -4) d = Math.max(d, y - (yc + h - 0.45 - 0.5 * Math.cos((z / 34) * 1.57)));
  // horn finials: silver points
  for (const s of [1, -1]) d = smin(d, sdEll(x + 26.6, y - rocker(74 * s) - 0.6, z - 75.5 * s, 1.6, 1.6, 3.2), 1.2);
  // the moon-disc boss under the belly
  d = smin(d, Math.max(hyp(x - 1.5, z) - 9.5, Math.abs(y + 3.0) - 1.4), 1.0);
  return d;
}
function buildBoard(): VoxelModel {
  const paint: Paint = (x, y, z, s) => {
    const c = crescent2(x, z);
    const yc = rocker(z);
    const top = y > yc + 0.3;
    if (Math.abs(z) > 72) return [silver(s), MT];
    if (y < -1.2 && hyp(x - 1.5, z) < 9.9) {
      // the emitter: moonstone core, silver ring of phases
      const r = hyp(x - 1.5, z);
      if (r < 5.4) return [r < 3 ? MN.core : MN.rim, GL];
      return Math.abs(((Math.atan2(x - 1.5, z) / (Math.PI / 4)) % 1) + 1) % 1 < 0.18 ? [LP.base, S1] : [silver(s), MT];
    }
    // rim inlay along the outer curve
    if (c > -2.3 && x > -20) return [silver(s), MT];
    if (top) {
      // lapis channel down the deck, silver phase glyphs set in it, the moon boss under his feet
      const ch = Math.abs(x - (-0.4 - 0.0012 * z * z)) < 2.3;
      if (hyp(x - 1.2, z) < 5.2) return hyp(x - 1.2, z) < 2.6 ? [MN.core, EM] : [silver(s), MT];
      if (ch) {
        const g = ((z + 75) / 9.2) % 1;
        return g < 0.16 ? [silver(s), MT] : [lapis(x, y, z, s), S1];
      }
      if (s.exp < 0.18) return [BONE.dark, S1];
      const n = fbm3(x * 0.12, 0, z * 0.05);
      return [n > 0.4 ? BONE.shade : s.exp > 0.7 ? BONE.hi : BONE.base, S1];
    }
    // the underside: lapis, moonstone runes that glow
    if (y < yc - 0.5) {
      const rune = h3(Math.floor(z / 4.5), Math.floor(x / 4.5), 0, 6) < 0.16 && c < -3;
      if (rune) return [MN.rim, GL];
      return [lapis(x, y, z, s), S1];
    }
    return [s.ny > 0.2 ? BONE.hi : BONE.shade, S1];
  };
  return carveK('board_crescent', 1, [-34, -6, -80], [22, 12, 80], boardSd, paint);
}
let boardMemo: { model: VoxelModel; voxelSize: number } | null = null;
/** the crescent glide board, centred (Player meshes it with pivot 'center'), nose along +Z */
export function crescentBoardModel() {
  return (boardMemo ??= { model: buildBoard(), voxelSize: 1 / 100 });
}

// ================================================================== TWIN BATON
const BK = 2.56; // 1/256 m
/** baton profile along y (cm): radius */
function batonR(y: number) {
  if (y < -10.5) return 1.4 * Math.sqrt(Math.max(0, 1 - ((y + 10.5) / 1.4) ** 2));
  if (y < -8.2) return 2.0; // pommel cap
  if (y < -7.2) return 1.55;
  if (y < 6.0) return 1.62 + 0.12 * Math.sin(y * 1.9); // the wrapped grip
  if (y < 8.4) return 1.5;
  if (y < 40.5) return 1.48 - (y - 8.4) * 0.0055; // ebony shaft, slight taper
  if (y < 43.2) return 1.62; // silver cap
  return 0;
}
function batonSd(x: number, y: number, z: number) {
  const r = hyp(x, z);
  let d = Math.max(r - batonR(y), Math.max(-11.9 - y, y - 43.2));
  // crescent guard: horns up, across the baton (in the YZ plane... set flat across x)
  const gy = y - 7.0;
  const cr = Math.max(Math.max(hyp(gy, z) - 3.4, -(hyp(gy - 1.8, z) - 3.0)), Math.abs(x) - 0.7);
  d = Math.min(d, Math.max(cr, -gy - 1.6));
  // the pommel's crescent hook (staff coupling)
  const hy = y + 11.6;
  d = Math.min(d, Math.max(Math.max(hyp(hy, x) - 1.9, -(hyp(hy + 0.8, x) - 1.5)), Math.abs(z) - 0.55));
  // the moonstone on the cap
  d = Math.min(d, sdEll(x, y - 44.0, z, 1.25, 1.25, 1.25));
  return d;
}
function buildBaton(): VoxelModel {
  const paint: Paint = (x, y, z, s) => {
    if (y > 43.0) return [hyp(x, z, y - 44.0) < 0.85 ? MN.core : MN.rim, GL];
    if (y > 40.5 || y < -7.2) return [silver(s), MT];
    if (y > 5.8 && y < 8.4) return [silver(s), MT];
    if (Math.abs(x) < 0.8 && y > 5 && y < 11) return [silver(s), MT];
    if (y < 6.0) {
      // linen spiral over lapis-blue leather
      const a = Math.atan2(x, z);
      const u = (((y + (a / (Math.PI * 2)) * 2.4) / 2.4) % 1 + 1) % 1;
      if (u < 0.62) return [u < 0.12 ? MARK_PAL.lin.hi : u > 0.5 ? MARK_PAL.lin.shade : MARK_PAL.lin.base, VF.SOLID | VF.SOFTAO];
      return [lapis(x, y, z, s), S1];
    }
    // ebony shaft: silver phase bands, engraved grain
    const band = [14, 20.5, 27, 33.5].some((b) => Math.abs(y - b) < 0.55);
    if (band) return [silver(s), MT];
    const g = Math.sin(Math.atan2(x, z) * 7 + y * 0.6);
    return [s.exp < 0.15 ? EBONY.shade : g > 0.75 ? EBONY.grain : s.ny > 0.4 ? EBONY.hi : EBONY.base, S1];
  };
  return carveK('mark_baton', BK, [-4, -14, -4], [4, 46, 4], batonSd, paint);
}
let batonMemo: RigSpec | null = null;
/** one of the twin batons as a rig: `grip` root (pivot at the grip centre), baton along +Y */
export function markBatonRig(): RigSpec {
  if (batonMemo) return batonMemo;
  const m = buildBaton();
  batonMemo = {
    name: 'mark_baton',
    voxelSize: 1 / (BK * 100),
    parts: [{ name: 'grip', model: m, pivot: [0, 0, 0], attach: [0, 0, 0] }],
    sockets: { tip: { part: 'grip', at: [0, 44 * BK, 0] }, pommel: { part: 'grip', at: [0, -11.6 * BK, 0] } },
    meta: { baton: true, length: 0.55, tip: [0, 0.44, 0], pommel: [0, -0.116, 0] },
  };
  return batonMemo;
}

// ================================================================== MOON CREST
const CK = 1.92; // 1/192 m
function crestSd(x: number, y: number, z: number) {
  // crescent in XZ: outer circle r 21 centred at the origin, inner circle r 18 shifted to -X
  const outer = hyp(x, z) - 21;
  const inner = hyp(x + 8.5, z) - 18;
  const c = Math.max(outer, -inner);
  // lens-shaped cross-section: thick at the belly, honed edges
  const w = clamp(-c / 4.2, 0, 1);
  const half = 0.25 + 1.35 * Math.sqrt(w);
  let d = Math.max(c, Math.abs(y) - half);
  // the moonstone boss on the belly
  d = Math.min(d, sdEll(x - 16.0, y, z, 2.6, 2.1, 2.6));
  return d;
}
function buildCrest(): VoxelModel {
  const paint: Paint = (x, y, z, s) => {
    const bd = hyp(x - 16.0, z);
    if (bd < 2.7 && Math.abs(y) > 0.4) return [bd < 1.4 ? MN.core : MN.rim, GL];
    const outer = hyp(x, z) - 21;
    const inner = hyp(x + 8.5, z) - 18;
    const c = Math.max(outer, -inner);
    // honed edges catch the light, a lapis groove follows the curve, an engraved rim line
    if (c > -0.9) return [SV.hi, MT];
    if (Math.abs(y) > 0.6 && Math.abs(c + 3.4) < 0.75 && bd > 3.6) return [lapis(x, y, z, s), S1];
    if (Math.abs(c + 1.7) < 0.3) return [SV.dark, MT];
    return [silver(s), MT];
  };
  return carveK('mark_crest', CK, [-12, -3, -22], [22, 3, 22], crestSd, paint);
}
let crestMemo: { model: VoxelModel; voxelSize: number } | null = null;
/** the throwable moon crest (flat in XZ, spins about Y) */
export function moonCrestModel() {
  return (crestMemo ??= { model: buildCrest(), voxelSize: 1 / (CK * 100) });
}
