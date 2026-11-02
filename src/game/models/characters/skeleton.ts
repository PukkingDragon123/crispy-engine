// "Sundown" — the skeleton cowboy, chosen of Serket. STYLE v2: a charming
// cartoon voxel skeleton (big cream skull, square sockets, toothy grin, thin
// knobby bones, chunky fists & boots) in a clean cowboy kit. Built on the shared
// toon humanoid kit at 1/30 m — every part authored in one rig-space grid.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { TOON, Ramp } from '../style';
import {
  JOINT, TOON_VS, mirrored, mirrorV3, roundBox, roundBoxX, autoShade, toonSkull, ribCage, toonPelvis, boneUpperArm,
  boneForearm, boneThigh, boneShin, cowboyBoot, buildHumanoid, defaultExpressions, sleeve, ExtraPart,
} from '../toon/humanoid';

export type HatId = 'stetson' | 'duck' | 'sombrero' | 'nemes' | 'tophat' | 'bandit';
export type OutfitId = 'duster' | 'poncho' | 'vest' | 'sheriff' | 'pharaoh';
export interface CowboyLook {
  hat: HatId;
  outfit: OutfitId;
}
export const HAT_IDS: HatId[] = ['stetson', 'duck', 'sombrero', 'nemes', 'tophat', 'bandit'];
export const OUTFIT_IDS: OutfitId[] = ['duster', 'poncho', 'vest', 'sheriff', 'pharaoh'];
export const SUNDOWN_EXPRESSIONS = ['neutral', 'focus', 'smug', 'surprised', 'hurt', 'angry', 'laugh', 'wink', 'dead', 'determined'] as const;

const B = TOON.bone;
const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });

interface Outfit {
  coat: Ramp; // main garment
  trim: Ramp; // lapels / lining / collar
  band: Ramp; // bandana
  boot: Ramp;
  belt: Ramp;
}
const OUT: Record<OutfitId, Outfit> = {
  duster: { coat: TOON.duster, trim: TOON.leatherDark, band: TOON.red, boot: TOON.leather, belt: TOON.leatherDark },
  poncho: { coat: TOON.poncho, trim: TOON.linen, band: TOON.turquoise, boot: TOON.leather, belt: TOON.leatherDark },
  vest: { coat: TOON.leather, trim: TOON.leatherDark, band: TOON.red, boot: ramp(0x8e3b26, 0x6c2a1b, 0xad5236, 0x4a1a10), belt: TOON.leatherDark },
  sheriff: { coat: ramp(0x3a3a48, 0x2a2a36, 0x50505e, 0x1a1a22), trim: TOON.black, band: TOON.black, boot: TOON.black, belt: TOON.black },
  pharaoh: { coat: TOON.linen, trim: TOON.gold, band: TOON.lapis, boot: TOON.gold, belt: TOON.gold },
};

// ================================================================== HATS
/** stetson: oval brim with curled sides, creased crown, band with a brass Serket concho */
function stetson(felt: Ramp, band: Ramp, concho = true) {
  const m = new VoxelModel('hat');
  // brim (y 48) — oval, sides curl up, slight dip at front & back
  for (let x = -12; x <= 12; x++)
    for (let z = -11; z <= 11; z++) {
      const e = (x * x) / (12.6 * 12.6) + (z * z) / (11.6 * 11.6);
      if (e > 1) continue;
      const ax = Math.abs(x);
      const y = ax >= 11 ? 50 : ax >= 9 ? 49 : 48;
      const rim = e > 0.8;
      m.set(x, y, z, rim && y === 48 ? felt.shade : felt.base);
      if (y === 50) m.set(x, 49, z, felt.shade);
    }
  // crown: covers the skull, rounded, creased top with front pinches
  for (let y = 49; y <= 55; y++) {
    const top = y === 55;
    const hx = top ? 7 : 8, zb = top ? -7 : -8, zf = top ? 6 : 7, cut = top ? 4 : 3;
    for (let x = -hx; x <= hx; x++)
      for (let z = zb; z <= zf; z++) {
        const dx = hx - Math.abs(x), dz = Math.min(z - zb, zf - z);
        if (dx + dz < cut) continue;
        if (top && Math.abs(x) <= 1 && z > zb + 1) continue; // centre crease
        m.set(x, y, z, felt.base);
      }
  }
  // front pinch dents
  for (const s of [1, -1]) for (const [x, y, z] of [[3, 55, 5], [4, 55, 4], [4, 54, 6], [5, 54, 5]] as [number, number, number][]) m.del(s * x, y, z);
  // band (crown wall, 2 rows)
  for (let y = 49; y <= 50; y++)
    for (let x = -8; x <= 8; x++)
      for (let z = -8; z <= 7; z++) {
        if (!m.has(x, y, z)) continue;
        const dx = 8 - Math.abs(x), dz = Math.min(z + 8, 7 - z);
        if (dx + dz === 3 || dx === 0 || dz === 0) m.set(x, y, z, y === 49 ? band.shade : band.base);
      }
  if (concho) {
    // brass Serket scorpion concho on the front of the band
    for (const [x, y, c] of [[0, 49, TOON.brass.base], [0, 50, TOON.brass.hi], [-1, 49, TOON.brass.shade], [1, 49, TOON.brass.shade], [-1, 50, TOON.brass.base], [1, 50, TOON.brass.base]] as [number, number, number][])
      m.set(x, y, 8, c);
    m.set(0, 50, 9, TOON.serket.base);
  }
  // shading by hand: crown top rim highlight, brim underside shade
  m.forEach((x, y, z, c) => {
    if (c !== felt.base) return;
    if (y === 55 && (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1))) m.set(x, y, z, felt.hi);
  });
  return m;
}

function hatDuck() {
  const Y = TOON.gold; // yellow rubber
  const yel = ramp(0xffd23a, 0xe8a91c, 0xffeb8a, 0xb07a10);
  const org = ramp(0xff8a2a, 0xd8661a, 0xffac5a, 0x9a4410);
  const m = new VoxelModel('hat');
  // body sitting on the skull
  roundBox(m, -7, 50, -8, 7, 55, 5, yel.base, 3);
  roundBox(m, -6, 56, -7, 6, 57, 3, yel.base, 3);
  // tail flick
  roundBox(m, -2, 56, -10, 2, 59, -8, yel.base, 1);
  // wings
  for (const s of [1, -1]) roundBox(m, s * 7, 52, -5, s * 8, 55, 1, yel.shade, 1);
  // head
  roundBox(m, -4, 58, 0, 4, 65, 7, yel.base, 2);
  // beak
  roundBox(m, -3, 59, 8, 3, 61, 11, org.base, 1);
  for (let x = -2; x <= 2; x++) m.set(x, 59, 11, org.shade);
  // eyes (painted dots)
  for (const s of [1, -1]) {
    m.set(s * 2, 63, 8, 0x1a1410).set(s * 2, 62, 8, 0x1a1410);
    m.set(s * 3, 63, 8, 0xffffff);
  }
  autoShade(m, [yel, org]);
  void Y;
  return m;
}

function sombrero() {
  const straw = ramp(0xe8c47a, 0xc9a25a, 0xf8dc9c, 0x9a7a3a);
  const m = new VoxelModel('hat');
  for (let x = -17; x <= 17; x++)
    for (let z = -17; z <= 17; z++) {
      const r = Math.hypot(x, z);
      if (r > 17.3) continue;
      const y = r > 15 ? 50 : 48;
      m.set(x, y, z, r > 15.5 ? TOON.red.base : straw.base);
      if (y === 50) m.set(x, 49, z, straw.shade);
    }
  // conical crown
  for (let y = 49; y <= 60; y++) {
    const rr = y <= 51 ? 8.6 : 8.6 - (y - 51) * 0.55;
    for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) if (x * x + z * z <= rr * rr) m.set(x, y, z, straw.base);
  }
  // colourful band + pompoms around the brim edge
  for (let x = -9; x <= 9; x++)
    for (let z = -9; z <= 9; z++)
      for (let y = 50; y <= 51; y++) {
        if (!m.has(x, y, z)) continue;
        const edge = !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
        if (edge) m.set(x, y, z, ((x + z) & 3) === 0 ? TOON.green.base : y === 50 ? TOON.red.base : TOON.gold.base);
      }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const x = Math.round(Math.cos(a) * 16.5), z = Math.round(Math.sin(a) * 16.5);
    m.set(x, 49, z, i % 2 ? TOON.green.base : TOON.gold.base).set(x, 48, z, i % 2 ? TOON.green.shade : TOON.gold.shade);
  }
  autoShade(m, [straw]);
  return m;
}

function nemes() {
  const G = TOON.gold, L = TOON.lapis;
  const m = new VoxelModel('hat');
  // headcloth: shell over the skull top, sides & back, with lappets in front of the shoulders
  for (let y = 40; y <= 53; y++) {
    const hx = y >= 52 ? 6 : 8;
    const zb = y >= 52 ? -6 : -8;
    const zf = y >= 52 ? 5 : y >= 46 ? 6 : 1;
    for (let x = -hx; x <= hx; x++)
      for (let z = zb; z <= zf; z++) {
        const dx = hx - Math.abs(x), dz = Math.min(z - zb, zf - z);
        if (dx + dz < 2) continue;
        // only the shell
        const inner = Math.abs(x) < hx - 1 && z > zb + 1 && z < zf - 0 && y < 52;
        if (inner) continue;
        if (y < 46 && z > 1) continue;
        m.set(x, y, z, (y & 1) ? L.base : G.base);
      }
  }
  // forehead band
  for (let x = -7; x <= 7; x++) m.set(x, 47, 7, G.hi);
  // lappets (front flaps beside the jaw)
  for (const s of [1, -1]) for (let y = 30; y <= 41; y++) for (let x = 7; x <= 9; x++) for (let z = 0; z <= 2; z++) m.set(s * x, y, z, (y & 1) ? L.base : G.base);
  // back tail
  for (let y = 33; y <= 40; y++) for (let x = -3; x <= 3; x++) m.set(x, y, -8, (y & 1) ? L.base : G.base);
  // uraeus cobra
  roundBox(m, -1, 48, 7, 1, 51, 8, G.base, 1);
  m.set(0, 52, 8, G.hi).set(0, 50, 9, TOON.red.base);
  autoShade(m, [G, L]);
  return m;
}

function tophat() {
  const K = TOON.black;
  const m = new VoxelModel('hat');
  for (let x = -10; x <= 10; x++) for (let z = -9; z <= 9; z++) if ((x * x) / 110 + (z * z) / 90 <= 1) m.set(x, Math.abs(x) >= 9 ? 49 : 48, z, K.base);
  for (let y = 49; y <= 63; y++) {
    const hx = y <= 51 ? 8 : 7;
    for (let x = -hx; x <= hx; x++)
      for (let z = -hx; z <= hx - 1; z++) {
        const dx = hx - Math.abs(x), dz = Math.min(z + hx, hx - 1 - z);
        if (dx + dz < 3) continue;
        m.set(x, y, z, y >= 52 && y <= 54 ? TOON.red.base : K.base);
      }
  }
  // a playing card tucked in the band
  roundBox(m, 3, 53, 7, 5, 57, 7, TOON.white.base, 0);
  m.set(4, 55, 8, TOON.red.base);
  autoShade(m, [K, TOON.red, TOON.white]);
  return m;
}

function banditHat() {
  const K = ramp(0x34302e, 0x242120, 0x4a4542, 0x141212);
  const m = stetson(K, TOON.silver, false);
  // flat-top gambler: shave the crease
  for (let x = -7; x <= 7; x++) for (let z = -7; z <= 6; z++) m.del(x, 55, z);
  // silver conchos around the band
  for (const [x, z] of [[0, 8], [5, 7], [-5, 7], [8, 0], [-8, 0]] as [number, number][]) m.set(x, 50, z + (Math.abs(x) === 8 ? 0 : 0), TOON.silver.hi);
  // feather
  for (let i = 0; i < 6; i++) m.set(-8 - (i >> 2), 51 + i, -3 - (i >> 1), i > 3 ? TOON.white.base : TOON.red.base);
  return m;
}

function buildHat(id: HatId, o: OutfitId) {
  switch (id) {
    case 'duck':
      return hatDuck();
    case 'sombrero':
      return sombrero();
    case 'nemes':
      return nemes();
    case 'tophat':
      return tophat();
    case 'bandit':
      return banditHat();
    default:
      return stetson(o === 'sheriff' ? ramp(0x5a4a3c, 0x45382c, 0x726050, 0x2c2218) : TOON.hat, o === 'sheriff' ? TOON.black : TOON.red);
  }
}

// ================================================================== TORSO / OUTFITS
/** red bandana: collar ring + front triangle (white polka dots) */
function bandana(m: VoxelModel, R: Ramp, dots = true) {
  for (let y = 34; y <= 35; y++)
    for (let x = -3; x <= 3; x++)
      for (let z = -5; z <= 1; z++) {
        const edge = Math.abs(x) === 3 || z === -5 || z === 1;
        if (!edge || (Math.abs(x) === 3 && (z === -5 || z === 1))) continue;
        m.set(x, y, z, R.base);
      }
  const tri: [number, number][] = [[33, 3], [32, 2], [31, 1], [30, 0]];
  for (const [y, hw] of tri) for (let x = -hw; x <= hw; x++) m.set(x, y, 4, R.base);
  for (let x = -3; x <= 3; x++) m.set(x, 34, 2, R.base).set(x, 33, 2, R.shade);
  for (let x = -2; x <= 2; x++) m.set(x, 33, 3, R.base);
  if (dots) for (const [x, y, z] of [[-2, 33, 4], [1, 32, 4], [0, 30, 4], [2, 33, 4], [-1, 31, 4], [3, 35, 1], [-3, 34, 0]] as [number, number, number][]) m.set(x, y, z, TOON.white.base);
  // knot at the back
  roundBox(m, -1, 34, -7, 1, 35, -6, R.shade, 0);
  m.set(0, 35, -7, R.base);
}

function dusterTorso(m: VoxelModel, C: Ramp, T: Ramp, sleevesShort = false) {
  // open coat shell around the rib cage, wide open front showing the ribs
  for (let y = 24; y <= 33; y++)
    for (let x = -7; x <= 7; x++)
      for (let z = -6; z <= 4; z++) {
        const shell = Math.abs(x) === 7 || z === -6;
        const front = z === 4 && Math.abs(x) >= 4;
        if (!shell && !front) continue;
        if (Math.abs(x) === 7 && (z === -6 || z === 4)) continue;
        if (y === 33 && Math.abs(x) === 7) continue;
        m.set(x, y, z, C.base);
      }
  // shoulders yoke
  for (let x = -6; x <= 6; x++) for (let z = -5; z <= 3; z++) if (Math.abs(x) >= 3 || z <= -3) m.set(x, 34, z, C.base);
  // turned-down lapels
  for (const s of [1, -1]) {
    for (let y = 27; y <= 33; y++) m.set(s * 4, y, 5, T.base);
    for (let y = 30; y <= 33; y++) m.set(s * 5, y, 5, T.base);
    m.set(s * 6, 33, 5, T.base);
  }
  // stand-up collar at the back of the neck
  for (let x = -5; x <= 5; x++) m.set(x, 35, -6, T.base).set(x, 36, -6, T.base);
  for (const s of [1, -1]) m.set(s * 5, 35, -5, T.base).set(s * 6, 35, -4, T.base);
  // back seam + yoke stitching (deliberate 1-voxel lines)
  for (let y = 24; y <= 31; y++) m.set(0, y, -7, C.shade);
  for (let x = -6; x <= 6; x++) m.set(x, 32, -7, C.dark);
  // lining visible along the opening
  for (const s of [1, -1]) for (let y = 24; y <= 26; y++) m.set(s * 4, y, 4, T.shade);
  // back half-belt with two brass buttons
  for (let x = -4; x <= 4; x++) m.set(x, 25, -7, T.base);
  m.set(-3, 25, -8, TOON.brass.hi).set(3, 25, -8, TOON.brass.hi);
  // patch pocket with flap, left chest
  roundBox(m, 4, 25, 5, 6, 27, 5, C.shade, 0);
  m.set(5, 27, 6, T.base);
  void sleevesShort;
}

function ponchoTorso(m: VoxelModel, C: Ramp) {
  // draped poncho: narrow at the shoulders, flaring to the hem, woven stripes + fringe
  for (let y = 25; y <= 35; y++) {
    const hx = y >= 35 ? 4 : y >= 34 ? 6 : y >= 32 ? 8 : y >= 29 ? 9 : 10;
    const zb = y >= 35 ? -4 : y >= 33 ? -5 : -6;
    const zf = y >= 35 ? 2 : y >= 33 ? 4 : 5;
    for (let x = -hx; x <= hx; x++)
      for (let z = zb; z <= zf; z++) {
        const outer = Math.abs(x) === hx || z === zb || z === zf || y === 35 || (y >= 32 && (Math.abs(x) >= hx - 1));
        if (!outer) continue;
        if (Math.abs(x) === hx && (z === zb || z === zf)) continue;
        if (y === 35 && Math.abs(x) <= 2 && z >= -2 && z <= 1) continue; // neck hole
        const stripe = y === 28 || y === 31 ? TOON.linen.base : y === 29 || y === 30 ? TOON.red.base : y === 25 ? C.shade : C.base;
        m.set(x, y, z, stripe);
      }
  }
  // zig-zag pattern on the cream stripes
  for (let x = -10; x <= 10; x++) {
    if (((x + 20) & 1) === 0) for (const z of [5, -6]) if (m.has(x, 28, z)) m.set(x, 28, z, TOON.turquoise.base);
    if (((x + 21) & 1) === 0) for (const z of [5, -6]) if (m.has(x, 31, z)) m.set(x, 31, z, TOON.turquoise.base);
  }
  // fringe along the front & back hem
  for (let x = -9; x <= 9; x += 2) for (const z of [5, -6]) m.set(x, 24, z, TOON.linen.shade);
}

function vestTorso(m: VoxelModel, C: Ramp, T: Ramp, star: boolean) {
  for (let y = 24; y <= 33; y++)
    for (let x = -7; x <= 7; x++)
      for (let z = -6; z <= 4; z++) {
        const shell = Math.abs(x) === 7 || z === -6 || (z === 4 && Math.abs(x) >= 3);
        if (!shell) continue;
        if (Math.abs(x) === 7 && (z === -6 || z === 4)) continue;
        if (y >= 31 && Math.abs(x) === 7) continue; // armholes
        if (y === 33 && Math.abs(x) <= 2) continue;
        m.set(x, y, z, C.base);
      }
  for (let x = -6; x <= 6; x++) for (let z = -5; z <= 3; z++) if (Math.abs(x) >= 3 && Math.abs(x) <= 5) m.set(x, 34, z, C.base);
  // edging + buttons
  for (const s of [1, -1]) for (let y = 24; y <= 33; y++) m.set(s * 3, y, 5, T.base);
  for (const y of [25, 28]) m.set(-4, y, 5, TOON.brass.hi);
  // pocket watch chain
  for (let x = 1; x <= 3; x++) m.set(x, 26 - (x === 2 ? 1 : 0), 5, TOON.gold.base);
  if (star) {
    // sheriff star, left chest
    const SV = TOON.gold;
    for (const [x, y, c] of [[5, 30, SV.hi], [4, 29, SV.base], [5, 29, SV.base], [6, 29, SV.base], [3, 29, SV.shade], [7, 29, SV.shade], [5, 28, SV.base], [4, 27, SV.base], [6, 27, SV.base]] as [number, number, number][]) m.set(x, y, 6, c);
  }
}

function pharaohTorso(m: VoxelModel) {
  // broad usekh collar: stepped rings of gold / lapis / turquoise
  const rows: [number, number, number][] = [[34, 4, TOON.gold.base], [33, 6, TOON.lapis.base], [32, 7, TOON.gold.hi], [31, 7, TOON.turquoise.base], [30, 6, TOON.gold.base]];
  for (const [y, hw, c] of rows)
    for (let x = -hw; x <= hw; x++)
      for (let z = -6; z <= 5; z++) {
        const edge = Math.abs(x) === hw || z === -6 || z === 5;
        if (!edge) continue;
        if (y === 34 && Math.abs(x) <= 2 && z > -5 && z < 4) continue;
        m.set(x, y, z, c);
      }
  for (let x = -4; x <= 4; x++) m.set(x, 34, 4, TOON.gold.base);
  // scarab pectoral
  roundBox(m, -1, 27, 6, 1, 29, 6, TOON.lapis.base, 0);
  m.set(0, 29, 7, TOON.turquoise.hi).set(-2, 28, 6, TOON.gold.base).set(2, 28, 6, TOON.gold.base);
}

// ================================================================== PELVIS / BELT
function gunBelt(m: VoxelModel, L: Ramp, buckle: Ramp) {
  // belt ring slung on the hip bones
  for (let y = 21; y <= 22; y++)
    for (let x = -7; x <= 7; x++)
      for (let z = -5; z <= 2; z++) {
        const edge = Math.abs(x) === 7 || z === -5 || z === 2;
        if (!edge) continue;
        if (Math.abs(x) === 7 && (z === -5 || z === 2)) continue;
        m.set(x, y, z, L.base);
      }
  // brass bullet loops (left side)
  for (const x of [3, 5]) m.set(x, 22, 3, TOON.brass.hi);
  for (const z of [0, -2]) m.set(8, 22, z, TOON.brass.hi);
  // big buckle with the Serket scorpion
  roundBox(m, -2, 20, 3, 2, 23, 3, buckle.base, 1);
  for (const [x, y] of [[-1, 21], [0, 21], [1, 21], [0, 22], [1, 22]] as [number, number][]) m.set(x, y, 4, buckle.dark);
  m.set(-1, 22, 4, TOON.serket.base);
  // holster on the right hip (-X)
  roundBox(m, -9, 14, -2, -8, 21, 1, L.shade, 1);
  m.set(-9, 20, 2, L.base).set(-8, 20, 2, L.base);
  for (let y = 15; y <= 19; y++) m.set(-10, y, -1, L.dark);
  m.set(-10, 17, 0, TOON.silver.hi);
}

function dusterSkirt(C: Ramp, T: Ramp) {
  // short stiff skirt (the long tails are engine cloth). Hangs from the waist, open at the front.
  const m = new VoxelModel('coat');
  for (let y = 16; y <= 23; y++) {
    const hx = y <= 18 ? 9 : 8, zb = y <= 18 ? -8 : -7;
    for (let x = -hx; x <= hx; x++)
      for (let z = zb; z <= 3; z++) {
        const shell = Math.abs(x) === hx || z === zb;
        if (!shell) continue;
        if (Math.abs(x) === hx && z === zb) continue;
        if (Math.abs(x) === hx && z > 1) continue;
        m.set(x, y, z, y === 16 ? C.shade : C.base);
      }
  }
  // pocket flaps on the hips
  for (const s of [1, -1]) for (let z = -3; z <= 0; z++) m.set(s * 9, 20, z, T.base);
  // back vent
  for (let y = 16; y <= 19; y++) m.del(0, y, -8).del(0, y, -7);
  for (let y = 16; y <= 20; y++) m.set(0, y, -6, T.dark);
  autoShade(m, [C], { under: false });
  return m;
}

function shendyt() {
  // pharaoh's pleated linen kilt + gold belt + front apron
  const m = new VoxelModel('coat');
  const L = TOON.linen;
  for (let y = 14; y <= 22; y++) {
    const hx = 7 + (22 - y > 4 ? 1 : 0);
    for (let x = -hx; x <= hx; x++)
      for (let z = -6; z <= 3; z++) {
        const shell = Math.abs(x) === hx || z === -6 || z === 3;
        if (!shell) continue;
        m.set(x, y, z, (x & 1) ? L.base : L.shade);
      }
  }
  for (let x = -7; x <= 7; x++) for (let z = -6; z <= 3; z++) if (Math.abs(x) === 7 || z === -6 || z === 3) m.set(x, 23, z, TOON.gold.base);
  roundBox(m, -2, 15, 4, 2, 22, 4, TOON.gold.base, 0);
  for (let y = 16; y <= 21; y += 2) m.set(0, y, 5, TOON.lapis.base);
  autoShade(m, [L, TOON.gold], { under: false });
  return m;
}

// ================================================================== RIG
export function skeletonCowboyRig(look: CowboyLook = { hat: 'stetson', outfit: 'duster' }): RigSpec {
  const o = look.outfit;
  const OF = OUT[o];
  const skull = toonSkull({ crack: true });
  // Sundown's quirks: a gold tooth, and a stitched suture zig-zag on the back of the skull
  skull.head.set(2, 39, 6, TOON.gold.hi, VF.METAL);
  for (let y = 42; y <= 48; y++) skull.head.paintAt([0, 1, 0, -1][y & 3], y, -7, B.shade);

  // ---- torso
  const torso = ribCage();
  if (o === 'duster' || o === 'sheriff') dusterTorso(torso, OF.coat, OF.trim);
  else if (o === 'poncho') ponchoTorso(torso, OF.coat);
  else if (o === 'vest') vestTorso(torso, OF.coat, OF.trim, false);
  else pharaohTorso(torso);
  if (o === 'sheriff') {
    // star on the coat + string tie
    const SV = TOON.gold;
    for (const [x, y, c] of [[5, 30, SV.hi], [4, 29, SV.base], [5, 29, SV.base], [6, 29, SV.base], [3, 29, SV.shade], [7, 29, SV.shade], [5, 28, SV.base], [4, 27, SV.base], [6, 27, SV.base]] as [number, number, number][]) torso.set(x, y, 6, c);
    for (let y = 29; y <= 34; y++) torso.set(0, y, 4, TOON.black.base);
    torso.set(0, 34, 4, TOON.silver.hi);
  }
  if (o === 'duster' || o === 'vest' || o === 'poncho') bandana(torso, OF.band, o !== 'poncho');
  autoShade(torso, [OF.coat, OF.trim, OF.band]);

  // ---- pelvis + belt
  const pelvis = toonPelvis();
  gunBelt(pelvis, OF.belt, o === 'pharaoh' ? TOON.gold : TOON.brass);
  autoShade(pelvis, [OF.belt]);

  // ---- arms
  const armL = boneUpperArm();
  if (o === 'duster' || o === 'sheriff') sleeve(armL, 6, 10, 26, 33, -2, 2, OF.coat, OF.trim);
  else if (o === 'pharaoh') {
    for (let x = 6; x <= 9; x++) for (let z = -2; z <= 1; z++) if (x === 6 || x === 9 || z === -2 || z === 1) armL.set(x, 28, z, TOON.gold.base).set(x, 29, z, TOON.gold.hi);
  } else if (o === 'poncho') {
    // nothing: bones poke out from under the poncho
  }
  autoShade(armL, [OF.coat, OF.trim]);
  const foreL = boneForearm({ pose: 'open' });
  const foreR = mirrored(boneForearm({ pose: 'fist' }), 'fore_r');
  if (o === 'pharaoh') {
    for (const f of [foreL]) for (let x = 6; x <= 9; x++) for (let z = -2; z <= 1; z++) if (x === 6 || x === 9 || z === -2 || z === 1) f.set(x, 19, z, TOON.gold.base);
    for (let x = -9; x <= -6; x++) for (let z = -2; z <= 1; z++) if (x === -6 || x === -9 || z === -2 || z === 1) foreR.set(x, 19, z, TOON.gold.base);
  }

  // ---- legs: bare bones, cowboy boots with spurs
  const thighL = boneThigh();
  const shinL = boneShin({ foot: (m) => cowboyBoot(m, { ramp: OF.boot, spur: o === 'pharaoh' ? null : TOON.silver, shaftTop: 6 }) });

  const hat = buildHat(look.hat, o);
  const hatTopY = { stetson: 56, duck: 66, sombrero: 61, nemes: 54, tophat: 64, bandit: 55 }[look.hat];

  const extra: ExtraPart[] = [];
  if (o === 'duster' || o === 'sheriff') extra.push({ name: 'coat', model: dusterSkirt(OF.coat, OF.trim), parent: 'pelvis', joint: [0.5, 23.5, -6.5] as V3 });
  if (o === 'pharaoh') extra.push({ name: 'coat', model: shendyt(), parent: 'pelvis', joint: [0.5, 23.5, -5.5] as V3 });

  const poncho = o === 'poncho';
  const sock = (part: string, at: V3) => ({ part, at });
  const clothCoat = o === 'duster' || o === 'sheriff' || o === 'poncho';
  const name = `cowboy_${look.hat}_${look.outfit}`;
  const rig = buildHumanoid({
    name,
    parts: {
      pelvis,
      torso,
      head: skull.head,
      jaw: skull.jaw,
      eye_l: skull.eye_l,
      eye_r: skull.eye_r,
      brow_l: skull.brow_l,
      brow_r: skull.brow_r,
      hat,
      arm_l: armL,
      fore_l: foreL,
      arm_r: mirrored(armL, 'arm_r'),
      fore_r: foreR,
      thigh_l: thighL,
      shin_l: shinL,
      thigh_r: mirrored(thighL, 'thigh_r'),
      shin_r: mirrored(shinL, 'shin_r'),
    },
    extra,
    topY: hatTopY,
    radius: 0.32,
    expressions: defaultExpressions([...SUNDOWN_EXPRESSIONS]),
    sockets: {
      // Pinch perches on the left shoulder
      shoulder_l: sock('torso', [8, 35.5, -1]),
      hat_top: sock('hat', [0.5, hatTopY, 0]),
      ...(poncho
        ? {
            coat_anchor_l: sock('torso', [10, 26, 0]),
            coat_anchor_r: sock('torso', mirrorV3([10, 26, 0])),
            coat_anchor_back: sock('torso', [0.5, 26, -7]),
            coat_anchor_front: sock('torso', [0.5, 26, 6]),
          }
        : {
            coat_anchor_l: sock(o === 'duster' || o === 'sheriff' ? 'coat' : 'pelvis', [9, 17.5, -2]),
            coat_anchor_r: sock(o === 'duster' || o === 'sheriff' ? 'coat' : 'pelvis', mirrorV3([9, 17.5, -2])),
            coat_anchor_back: sock(o === 'duster' || o === 'sheriff' ? 'coat' : 'pelvis', [0.5, 17.5, -8]),
            coat_anchor_front: sock('pelvis', [0.5, 18, 3]),
          }),
      bandana_anchor: sock('torso', [0.5, 34.5, -7.5]),
    },
    meta: {
      look,
      hatTop: hatTopY * TOON_VS,
      eyeColor: TOON.serket.hi,
      cloth: {
        coat: clothCoat ? [OF.coat.base, OF.coat.shade, OF.trim.base] : undefined,
        coatStyle: poncho ? 'poncho' : clothCoat ? 'tails' : undefined,
        coatLen: o === 'sheriff' ? 0.56 : o === 'duster' ? 0.5 : poncho ? 0.3 : 0,
        coatWidth: poncho ? 0.6 : 0.5,
        bandana: o === 'duster' || o === 'vest' || o === 'poncho' ? [OF.band.base, OF.band.shade] : undefined,
        bandanaLen: 0.16,
      },
    },
  });
  void B;
  void JOINT;
  void roundBoxX;
  return rig;
}
