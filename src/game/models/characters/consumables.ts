// Consumables — Sundown's pocket items as polished, hand-sculpted HD props (1/200 m).
// Sculpted in centimetres with the sculpt kit (2 voxels per cm), so every form is
// smooth and tapered: rolled linen with spiral layers, glass bottles with liquid
// lines and highlights, waxed paper sticks, a carved scorpion amulet...
// Each returns { model, voxelSize, meta: { grip, len } } (grip = hand-hold point in voxel
// coords; len = longest extent in metres). Registry keys: see registryItems.ts.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { V3 } from '../../../engine/voxel/Rig';
import { TOON, Ramp } from '../style';
import { Sc, clamp, lerp, sstep, vadd, spline, distPoly, shadeRamps } from './sculpt';

/** base resolution (small flat items use 1/300–1/400) */
export const CONSUMABLE_VS = 1 / 200;
const K = 2; // voxels per cm
const M = VF.METAL;
const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });
const sc = (name: string, k = K) => new Sc(name, k);
const frac = (v: number) => v - Math.floor(v);
const TAU = Math.PI * 2;

export interface Consumable {
  model: VoxelModel;
  voxelSize: number;
  meta: { grip: V3; len: number; gem?: VoxelModel };
}
const out = (m: Sc, grip: V3, len: number, gem?: VoxelModel): Consumable => ({ model: m.m, voxelSize: 1 / (100 * m.k), meta: { grip: [grip[0] * m.k, grip[1] * m.k, grip[2] * m.k], len: len / 100, gem } });

const LIN = ramp(0xeee4cc, 0xd2c4a2, 0xfff6e2, 0xa89a78);
const OLD_LIN = ramp(0xdcc690, 0xbea66c, 0xf0dcaa, 0x8a7444);
const GOLD = TOON.gold, BRASS = TOON.brass, LAPIS = TOON.lapis;
const TWINE = ramp(0xc8a46a, 0xa8844a, 0xe0c08a, 0x7a5c30);
const CORK = ramp(0xb98a52, 0x94683a, 0xd6a66c, 0x5e4020);

/** a hanging linen tail (thin strip) with frayed threads at the end */
function tail(m: Sc, pts: V3[], halfW: number, col: (x: number, y: number, z: number, t: number) => number, fray: number) {
  const sm = spline(pts, 8);
  m.sweep(sm, () => [halfW, 0.26, 0.22], (x, y, z) => col(x, y, z, 0), 0.12);
  const end = sm[sm.length - 1];
  for (let x = -halfW + 0.3; x <= halfW - 0.2; x += 0.55) {
    const L = 0.5 + 0.45 * frac(Math.sin(x * 12.9) * 43758.5);
    m.cap([x, end[1] + 0.1, end[2]], [x + 0.1, end[1] - L, end[2] + 0.1], 0.2, 0.14, fray);
  }
}

// ================================================================== TRAIL BANDAGE
export function bandageRoll(): Consumable {
  const m = sc('item_bandage');
  // the roll: axis along X, spiral layers on both end faces, edge stripes, soft weave
  m.region([-2.9, -3.4, -3.4], [2.9, 3.4, 3.4], (x, y, z) => {
    const r = Math.hypot(y, z);
    return r <= 3.2 && r >= 0.8 && Math.abs(x) <= 2.75;
  }, (x, y, z) => {
    const r = Math.hypot(y, z), a = Math.atan2(z, y);
    if (Math.abs(x) > 2.3) return frac((r - ((a + Math.PI) / TAU) * 0.62) / 0.62) < 0.3 ? LIN.dark : r < 1.15 ? LIN.shade : LIN.base;
    if (Math.abs(Math.abs(x) - 1.85) < 0.26) return 0x5a78ac; // field-dressing stripes
    return (Math.floor(a * 9) & 1) && r > 3.0 ? LIN.hi : LIN.base;
  });
  m.region([-2.9, -1, -1], [2.9, 1, 1], (x, y, z) => Math.hypot(y, z) < 0.8, 0x6a5c44); // card core
  // the loose tail unrolled off the front and hanging, frayed
  tail(m, [[0, -2.6, 2.0], [0, -4.6, 2.7], [0, -6.6, 2.3], [0, -8.2, 2.9]], 2.45, (x) => (Math.abs(Math.abs(x) - 1.85) < 0.26 ? 0x5a78ac : LIN.base), LIN.shade);
  // a brass safety pin through the tail
  m.cap([-1.5, -4.9, 3.05], [1.3, -4.75, 3.15], 0.17, 0.17, BRASS.hi, { flags: M });
  m.cap([-1.5, -5.25, 3.0], [1.15, -5.05, 3.1], 0.15, 0.15, BRASS.base, { flags: M });
  m.ell([1.55, -4.95, 3.1], [0.42, 0.5, 0.3], BRASS.base, { flags: M });
  m.region([-2.1, -5.6, 2.6], [-1.2, -4.5, 3.6], (x, y, z) => Math.abs(Math.hypot(x + 1.65, y + 5.05) - 0.36) < 0.16 && Math.abs(z - 3.05) < 0.22, BRASS.hi, { flags: M });
  shadeRamps(m.m, [LIN], true);
  return out(m, [0, 0, 0], 11.5);
}

// ================================================================== EMBALMER'S LINEN
export function embalmersLinen(): Consumable {
  const m = sc('item_linen');
  m.region([-3.2, -3.7, -3.7], [3.2, 3.7, 3.7], (x, y, z) => {
    const r = Math.hypot(y, z);
    return r <= 3.5 && r >= 0.9 && Math.abs(x) <= 3.0;
  }, (x, y, z) => {
    const r = Math.hypot(y, z), a = Math.atan2(z, y);
    if (Math.abs(x) > 2.55) return frac((r - ((a + Math.PI) / TAU) * 0.6) / 0.6) < 0.3 ? OLD_LIN.dark : OLD_LIN.shade;
    if (Math.abs(x) > 2.2) return GOLD.base; // gold-leaf edges
    if (Math.abs(x) < 0.75 && r > 3.2) {
      const g = Math.floor((a + Math.PI) * 6.5);
      return g % 3 === 0 ? GOLD.hi : g % 3 === 1 && Math.abs(x) < 0.35 ? LAPIS.base : OLD_LIN.base; // glyph band
    }
    return OLD_LIN.base;
  });
  m.region([-3.2, 3.15, -3.7], [3.2, 3.7, 3.7], (x, y, z) => Math.abs(x) > 2.2 && Math.abs(x) <= 3.0 && Math.hypot(y, z) > 3.2 && Math.hypot(y, z) <= 3.5, GOLD.base, { mode: 'paint', flags: M });
  // a gold cord wound twice round the roll, a lapis scarab clasp on top
  const cord: V3[] = [];
  for (let k = 0; k <= 60; k++) {
    const a = (k / 60) * TAU * 2;
    cord.push([lerp(-1.7, 1.7, k / 60), Math.cos(a) * 3.65, Math.sin(a) * 3.65]);
  }
  m.path(cord, () => 0.24, GOLD.hi, { flags: M });
  m.ell([0, 3.75, 0.6], [1.15, 0.7, 1.45], LAPIS.base, { flags: M });
  m.ell([0, 4.05, 1.55], [0.55, 0.45, 0.45], LAPIS.hi, { flags: M });
  m.region([-1.4, 3.3, -1.1], [1.4, 4.2, 2.3], (x, y, z) => Math.abs(((x / 1.25) ** 2 + ((z - 0.6) / 1.55) ** 2) - 1) < 0.22 && y > 3.4, GOLD.base, { flags: M });
  m.cap([0, 4.3, -0.6], [0, 4.4, 1.6], 0.12, 0.12, GOLD.hi, { flags: M });
  // the resin-stained tail with a fringe
  tail(m, [[0, -2.9, 2.3], [0, -5.0, 3.1], [0, -7.0, 2.5], [0, -8.6, 3.2]], 2.7, (x, y) => (Math.abs(x) > 2.2 ? GOLD.shade : y < -7.5 ? 0xb08a4e : OLD_LIN.base), OLD_LIN.dark);
  shadeRamps(m.m, [OLD_LIN, GOLD], true);
  return out(m, [0, 0, 0], 12);
}

// ================================================================== SACRIFICIAL DAGGER (obsidian blade, jackal-gold fittings)
export function sacrificialDagger(): Consumable {
  const m = sc('item_dagger', 3);
  const OB = ramp(0x23202c, 0x121018, 0x5a5672, 0x07060a);
  // leaf blade in the XY plane, a raised spine and a blood-stained fuller
  m.region([-2.2, -2.2, -0.6], [2.2, 14.6, 0.6], (x, y, z) => {
    const t = (y + 2) / 16.4;
    if (t < 0 || t > 1) return false;
    const w = 1.75 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.98 + 0.02)), 0.55) * (1 - 0.35 * t) + 0.15 * (1 - t);
    const cx = 0.35 * Math.sin(t * Math.PI) ; // a gentle curve
    const ax = Math.abs(x - cx);
    if (ax > w) return false;
    const th = 0.42 * (1 - ax / Math.max(w, 0.01)) + 0.12;
    return Math.abs(z) <= th;
  }, (x, y, z) => {
    const t = (y + 2) / 16.4, cx = 0.35 * Math.sin(t * Math.PI);
    const w = 1.75 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.98 + 0.02)), 0.55) * (1 - 0.35 * t) + 0.15 * (1 - t);
    const ax = Math.abs(x - cx);
    if (w - ax < 0.35) return OB.hi; // knapped edge catching the light
    if (ax < 0.28 && t < 0.72) return t < 0.45 ? 0x6a1010 : 0x3a0c0c; // fuller with dried blood
    return Math.abs(z) > 0.3 ? OB.base : OB.shade;
  }, { flags: M });
  // crescent gold guard with a lapis eye
  m.path([[-3.0, -1.4, 0], [-1.6, -2.35, 0], [0, -2.6, 0], [1.6, -2.35, 0], [3.0, -1.4, 0]], (t) => 0.5 - 0.22 * Math.abs(t - 0.5), GOLD.base, { flags: M });
  for (const s of [1, -1]) m.ell([s * 3.05, -1.25, 0], [0.42, 0.42, 0.42], GOLD.hi, { flags: M });
  m.ell([0, -2.55, 0.45], [0.55, 0.45, 0.3], LAPIS.base, { flags: M });
  // leather-wrapped grip
  m.region([-1.1, -9.6, -1.1], [1.1, -2.9, 1.1], (x, y, z) => Math.hypot(x, z) <= 0.95 - 0.08 * Math.sin(((y + 9.6) / 6.7) * Math.PI), (x, y, z) => (frac((y + Math.atan2(z, x) / TAU * 1.1) / 1.1) < 0.28 ? TOON.leatherDark.dark : TOON.leatherDark.base));
  m.region([-1.2, -3.3, -1.2], [1.2, -2.8, 1.2], (x, y, z) => Math.hypot(x, z) <= 1.12, GOLD.shade, { flags: M });
  // pommel: gold collar, onyx ovoid, gold cap with a garnet
  m.region([-1.3, -10.2, -1.3], [1.3, -9.5, 1.3], (x, y, z) => Math.hypot(x, z) <= 1.2, GOLD.base, { flags: M });
  m.ell([0, -11.3, 0], [1.25, 1.15, 1.1], 0x15131a, { flags: M });
  m.ell([0, -12.35, 0], [0.8, 0.45, 0.8], GOLD.hi, { flags: M });
  m.ell([0, -11.3, 1.05], [0.38, 0.38, 0.3], 0xb01c2a, { flags: M });
  shadeRamps(m.m, [GOLD, TOON.leatherDark], true);
  return out(m, [0, -6.2, 0], 27);
}

// ================================================================== SMOKE BOMB (glazed clay, rope net, leaking cracks)
export function smokeBombHD(): Consumable {
  const m = sc('item_smoke');
  const CL = ramp(0x6e6878, 0x55505e, 0x9a94a8, 0x36323c);
  const R = 3.4;
  m.ell([0, 0, 0], [R, R, R], (x, y, z) => (y > 1.8 && x < -0.8 && z > 0.6 ? CL.hi : CL.base));
  // rope net: two crossing families of cords, standing proud of the glaze
  m.region([-R - 0.4, -R - 0.4, -R - 0.4], [R + 0.4, R + 0.4, R + 0.4], (x, y, z) => {
    const r = Math.hypot(x, y, z);
    if (r < R - 0.1 || r > R + 0.35) return false;
    const a = Math.atan2(z, x), b = Math.asin(clamp(y / r, -1, 1));
    return Math.abs(Math.sin(a * 3 + b * 2.6)) < 0.13 || Math.abs(Math.sin(a * 3 - b * 2.6)) < 0.13;
  }, TWINE.base);
  // hairline cracks leaking violet smoke-light
  const cracks: V3[][] = [[[-1.2, 2.4, 2.4], [-0.5, 1.2, 3.2], [-0.9, 0.1, 3.3], [-0.2, -1.1, 3.25]], [[2.3, -0.4, 2.4], [2.9, -1.2, 1.6], [2.7, -2.1, 1.0]]];
  m.region([-R, -R, -R], [R, R, R], (x, y, z) => cracks.some((c) => distPoly([x, y, z], c) < 0.3) && Math.hypot(x, y, z) > R - 0.7, 0xb07ad8, { mode: 'paint', flags: VF.EMISSIVE });
  // cork plug + a short twisted fuse
  m.region([-1.1, R - 0.6, -1.1], [1.1, R + 1.2, 1.1], (x, y, z) => Math.hypot(x, z) <= 0.95 - (y - R) * 0.12 && y > R - 0.5, (x, y) => (y > R + 0.9 ? CORK.shade : CORK.base));
  const fz = spline([[0, R + 1.1, 0], [0.4, R + 2.0, 0.3], [1.1, R + 2.6, 0.2], [1.6, R + 2.5, -0.4]], 6);
  m.path(fz, () => 0.24, (x, y) => ((Math.floor(y * 2 + x * 2) & 1) ? 0x3a3430 : 0x5a524a));
  m.ell(fz[fz.length - 1], [0.28, 0.28, 0.28], 0xd8d0c0);
  shadeRamps(m.m, [CL, TWINE, CORK], true);
  return out(m, [0, 0, 0], 9.5);
}

// ================================================================== TIN STAR (six points, ball tips, dented)
export function tinStar(): Consumable {
  const m = sc('item_star', 4);
  const TIN = ramp(0xc4c8ce, 0x8e939b, 0xf2f4f8, 0x5a5e66);
  const Ro = 4.1, Ri = 2.25;
  m.region([-4.8, -4.8, -0.5], [4.8, 4.8, 0.7], (x, y, z) => {
    const r = Math.hypot(x, y), a = Math.atan2(x, y);
    const f = Math.abs(frac(a / (TAU / 6)) - 0.5) * 2; // 1 at a point, 0 between
    const edge = Ri + (Ro - Ri) * Math.pow(f, 1.7);
    if (r > edge) return false;
    const bevel = 0.28 * (1 - r / edge);
    return z >= -0.25 && z <= 0.15 + bevel;
  }, (x, y, z) => {
    const r = Math.hypot(x, y);
    if (Math.abs(r - 1.45) < 0.2) return TIN.dark; // engraved ring
    return z > 0.2 ? TIN.hi : TIN.base;
  }, { flags: M });
  m.region([-1.8, -1.8, 0], [1.8, 1.8, 0.8], (x, y, z) => Math.hypot(x, y) < 1.25 && z <= 0.48, (x, y) => (y > 0.4 && x < 0 ? TIN.hi : TIN.base), { flags: M }); // raised boss
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    m.ell([Math.sin(a) * (Ro + 0.25), Math.cos(a) * (Ro + 0.25), 0], [0.62, 0.62, 0.55], (x, y) => (y > Math.cos(a) * (Ro + 0.25) + 0.2 ? TIN.hi : TIN.base), { flags: M });
  }
  for (const [x, y] of [[-0.9, -2.6], [0.9, -2.6]] as [number, number][]) m.ell([x, y, 0.25], [0.25, 0.25, 0.2], TIN.shade, { flags: M }); // rivets
  // a dent and a bullet nick
  m.ell([2.4, 1.7, 0.75], [0.8, 0.65, 0.4], 0, { mode: 'carve' });
  m.region([-4.6, -2.6, -0.6], [-2.6, -1.4, 0.8], (x, y) => Math.hypot(x + 3.45, y + 2.05) < 0.42, 0, { mode: 'carve' });
  // pin on the back
  m.cap([-2.0, 0.6, -0.45], [2.0, 0.6, -0.45], 0.14, 0.14, TIN.shade, { flags: M });
  return out(m, [0, 0, 0], 9.5);
}

// ================================================================== SERKET'S CHARM (gold scorpion on a lapis plaque, venom gem, braided cord)
export function serketCharm(): Consumable {
  const m = sc('item_charm', 4);
  const TQ = TOON.turquoise;
  // oval plaque with a raised gold rim
  m.region([-2.7, -3.4, -0.5], [2.7, 3.4, 0.4], (x, y, z) => (x / 2.4) ** 2 + (y / 3.1) ** 2 <= 1 && z >= -0.35 && z <= 0.1, (x, y) => ((x / 2.4) ** 2 + (y / 3.1) ** 2 > 0.78 ? GOLD.base : (Math.floor((x + y) * 1.5) & 1) ? LAPIS.base : LAPIS.shade), { flags: M });
  m.region([-2.7, -3.4, 0], [2.7, 3.4, 0.5], (x, y, z) => Math.abs((x / 2.45) ** 2 + (y / 3.15) ** 2 - 0.9) < 0.1 && z <= 0.38, GOLD.hi, { flags: M });
  // the gold scorpion: carapace, segmented abdomen, claws, a tail curling up over its back
  const G = GOLD;
  m.ell([0, -0.4, 0.45], [0.95, 1.05, 0.45], G.base, { flags: M });
  for (let i = 0; i < 4; i++) m.ell([0, -1.5 - i * 0.55, 0.42], [0.85 - i * 0.12, 0.32, 0.4], i & 1 ? G.shade : G.base, { flags: M });
  for (const s of [1, -1]) {
    m.path([[s * 0.7, 0.1, 0.45], [s * 1.35, 0.8, 0.5], [s * 1.25, 1.65, 0.5]], () => 0.2, G.base, { flags: M });
    m.ell([s * 1.2, 2.05, 0.5], [0.42, 0.55, 0.32], G.hi, { flags: M });
    m.cap([s * 1.05, 2.45, 0.5], [s * 0.75, 2.75, 0.5], 0.15, 0.06, G.hi, { flags: M });
    for (const y of [-0.9, -1.4, -1.9]) m.cap([s * 0.7, y, 0.4], [s * 1.5, y - 0.35, 0.35], 0.1, 0.07, G.shade, { flags: M });
  }
  const tl = spline([[0, -3.3, 0.45], [0.8, -2.9, 0.75], [1.3, -1.6, 0.95], [1.0, -0.5, 1.15], [0.35, 0.05, 1.25]], 6);
  m.path(tl, (t) => 0.3 - 0.12 * t, G.base, { flags: M });
  // venom gem at the stinger (a separate model too, so the use animation can pulse it)
  const gemC: V3 = [0.15, 0.25, 1.45];
  const gem = sc('item_charm_gem', 4);
  gem.ell(gemC, [0.42, 0.42, 0.38], (x, y) => (y > gemC[1] + 0.12 && x < gemC[0] ? 0xeaffc8 : 0x8cf03c), { flags: VF.GLOW });
  m.ell(gemC, [0.42, 0.42, 0.38], 0x8cf03c, { flags: VF.GLOW });
  // braided leather cord loop through a gold bail
  m.region([-0.6, 3.0, -0.4], [0.6, 3.9, 0.4], (x, y, z) => Math.abs(Math.hypot(x, y - 3.45) - 0.38) < 0.17 && Math.abs(z) < 0.25, G.hi, { flags: M });
  const loop: V3[] = [];
  for (let k = 0; k <= 40; k++) {
    const a = (k / 40) * TAU;
    loop.push([Math.sin(a) * 2.2, 3.7 + 2.6 - Math.cos(a) * 2.6, Math.sin(a * 2) * 0.25]);
  }
  m.path(loop, () => 0.2, (x, y, z) => ((Math.floor((x + y) * 3) & 1) ? TOON.leatherDark.base : TOON.leatherDark.hi));
  shadeRamps(m.m, [LAPIS, TQ], true);
  return out(m, [0, 0, 0], 9.5, gem.m);
}

// ================================================================== DYNAMITE BUNDLE
export function dynamiteHD(): Consumable {
  const m = sc('item_dynamite');
  const RD = ramp(0xc0342a, 0x962418, 0xdc5444, 0x5c140c);
  const sticks: [number, number][] = [[-1.25, -0.65], [1.25, -0.65], [0, 1.35]];
  for (const [sx, sz] of sticks) {
    m.region([sx - 1.3, -8.1, sz - 1.3], [sx + 1.3, 8.1, sz + 1.3], (x, y, z) => Math.hypot(x - sx, z - sz) <= 1.2 && Math.abs(y) <= 8, (x, y, z) => {
      const r = Math.hypot(x - sx, z - sz), ay = Math.abs(y);
      if (ay > 7.6) return r < 0.75 ? 0xd8c49a : RD.dark; // crimped paper over the packing
      if (ay < 2.4) return ay > 2.0 || ay < 0.35 ? 0x2a2420 : 0xece2c8; // warning label with dark bars
      return frac(Math.atan2(z - sz, x - sx) / TAU * 5 + y * 0.15) < 0.08 ? RD.shade : RD.base; // wound paper seam
    });
  }
  // twine wraps
  for (const y of [-5.1, 5.1]) {
    const loop: V3[] = [];
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * TAU;
      loop.push([Math.cos(a) * 2.75, y + Math.sin(a * 3) * 0.12, 0.05 + Math.sin(a) * 2.55]);
    }
    m.path(loop, () => 0.26, (x, yy) => ((Math.floor((x + yy) * 2.5) & 1) ? TWINE.base : TWINE.shade));
    m.ell([2.8, y, 1.1], [0.42, 0.42, 0.42], TWINE.shade);
  }
  // braided fuse curling up out of the front stick, frayed with powder at the tip
  const fz = spline([[0, 7.9, 1.35], [0.3, 9.6, 1.6], [1.4, 11.0, 1.2], [2.6, 11.5, 0.5], [3.2, 12.6, 0.1]], 8);
  m.path(fz, () => 0.27, (x, y) => ((Math.floor(y * 2.5 + x) & 1) ? 0x3c3632 : 0x6a625a));
  const tip = fz[fz.length - 1];
  for (const d of [[0.3, 0.4, 0], [-0.2, 0.45, 0.2], [0.1, 0.35, -0.3]] as V3[]) m.cap(tip, vadd(tip, d), 0.13, 0.1, 0xb0a898);
  shadeRamps(m.m, [RD, TWINE], true);
  return out(m, [0, 0, 0.3], 20);
}

// ================================================================== GLASS BOTTLES
interface Glass {
  r: Ramp;
  liquid: number;
  level: number;
}
/** a bottle shell from a radius profile; square-ish (p > 2) or round, with a liquid line and a highlight streak */
function bottleBody(m: Sc, prof: (y: number) => number, y0: number, y1: number, g: Glass, sq: number, zs = 1) {
  m.region([-5, y0, -5], [5, y1, 5], (x, y, z) => {
    const r = prof(y);
    if (r <= 0) return false;
    const d = Math.pow(Math.pow(Math.abs(x) / r, sq) + Math.pow(Math.abs(z) / (r * zs), sq), 1 / sq);
    return d <= 1;
  }, (x, y, z) => {
    const r = prof(y);
    if (x < -r * 0.45 && x > -r * 0.8 && z > 0 && y > y0 + 1 && y < y1 - 2.5) return g.r.hi; // highlight streak
    if (y < g.level) return Math.abs(y - g.level) < 0.35 ? g.r.hi : g.liquid; // liquid + meniscus
    return g.r.base;
  }, { flags: M });
}

export function snakeOil(): Consumable {
  const m = sc('item_snakeoil');
  const g: Glass = { r: ramp(0x86a44a, 0x5e782c, 0xd2ea9a, 0x30401a), liquid: 0x4a6a14, level: 2.0 };
  const prof = (y: number) => (y < 4 ? 3.1 : y < 6.2 ? lerp(3.1, 0.9, sstep((y - 4) / 2.2)) : y < 10 ? 0.88 : y < 10.8 ? 1.12 : 0);
  bottleBody(m, prof, -8, 10.8, g, 3.2, 0.68);
  // embossed panel frame on the front + paper label with a red border and a dark band
  m.region([-3.2, -7, 1.6], [3.2, 3.3, 2.6], (x, y, z) => Math.abs(x) < 2.6 && y > -6.6 && y < 2.9 && (Math.abs(x) > 2.3 || y < -6.3 || y > 2.6) && z > 1.9, g.r.hi, { flags: M });
  m.region([-2.3, -5.4, 1.7], [2.3, 0.4, 2.5], (x, y, z) => Math.abs(x) < 2.15 && y > -5.2 && y < 0.2 && z > 1.95 && z < 2.4, (x, y) => (Math.abs(x) > 1.85 || y < -4.9 || y > -0.1 ? 0xa82a1c : Math.abs(y + 2.5) < 0.55 ? 0x2a2420 : 0xece0c4));
  // cork with a twine tie
  m.region([-1, 10.6, -1], [1, 12.6, 1], (x, y, z) => Math.hypot(x, z) <= 0.78 + (y - 10.6) * 0.08 && y > 10.6, (x, y) => (y > 12.2 ? CORK.shade : CORK.base));
  m.region([-1.2, 9.4, -1.2], [1.2, 9.9, 1.2], (x, y, z) => Math.abs(Math.hypot(x, z) - 0.95) < 0.17, TWINE.base);
  // a green snake coiling round the shoulder and neck, its head resting on the label
  const coil: V3[] = [];
  for (let k = 0; k <= 70; k++) {
    const t = k / 70, a = -0.4 + t * TAU * 1.6;
    const y = lerp(0.9, 9.0, t);
    const r = prof(Math.min(9.9, y)) * (y < 4 ? 1 : 1) + 0.45;
    coil.push([Math.sin(a) * r, y, Math.cos(a) * r * (y < 4.5 ? 0.7 : 1)]);
  }
  coil.reverse();
  // a desert rattler: sand scales with dark diamond bands, so it reads on the green glass
  const SN = ramp(0xd2a65a, 0x5c3a1c, 0xeac888, 0x2e1c0c);
  m.path(coil, (t) => lerp(0.22, 0.52, Math.min(1, t * 1.6)) * (t > 0.95 ? 0.8 : 1), (x, y, z) => (y < 1.6 ? 0xe8d8a8 : ((Math.floor(Math.atan2(x, z) * 2.2 + y * 1.3) % 3) + 3) % 3 === 0 ? SN.shade : SN.base));
  const head = coil[coil.length - 1];
  m.ell(vadd(head, [0, -0.15, 0.45]), [0.62, 0.42, 0.8], SN.hi);
  for (const s of [1, -1]) m.ell(vadd(head, [s * 0.32, 0.05, 0.85]), [0.14, 0.14, 0.12], 0xd8261c, { flags: VF.EMISSIVE });
  m.cap(vadd(head, [0, -0.25, 1.15]), vadd(head, [0, -0.35, 1.75]), 0.1, 0.06, 0xc81c2a);
  shadeRamps(m.m, [CORK, SN], true);
  return out(m, [0, -2.5, 0], 21);
}

export function cactusWhiskey(): Consumable {
  const m = sc('item_whiskey');
  const g: Glass = { r: ramp(0xa8621e, 0x7a4212, 0xf0b060, 0x3e2008), liquid: 0x6a3410, level: -0.6 };
  const prof = (y: number) => (y < -7.6 ? lerp(3.5, 3.9, (y + 8) / 0.4) : y < 1.6 ? 3.95 + 0.18 * Math.sin(((y + 7.6) / 9.2) * Math.PI) : y < 4.8 ? lerp(3.95, 1.0, sstep((y - 1.6) / 3.2)) : y < 9.2 ? 1.0 : 0);
  bottleBody(m, prof, -8, 9.2, g, 2, 1);
  // cream label with a green border and a red stripe, round the front
  m.region([-4.5, -5.6, -4.5], [4.5, -0.6, 4.5], (x, y, z) => z > -0.6 && y > -5.2 && y < -1.0 && Math.hypot(x, z) > prof(y) - 0.1 && Math.hypot(x, z) < prof(y) + 0.32, (x, y) => (y < -4.75 || y > -1.45 ? 0x3e7a2a : Math.abs(y + 3.1) < 0.35 ? 0xa82a1c : 0xece0c4));
  // red wax dipped over the cork with drips running down the neck
  m.region([-1.5, 7.2, -1.5], [1.5, 10.6, 1.5], (x, y, z) => Math.hypot(x, z) <= (y > 9.2 ? 1.2 - (y - 9.2) * 0.25 : 1.32) && y < 10.5, (x, y) => (y > 10.1 ? 0xd2443a : 0xa8241c));
  for (const [a, L] of [[0.4, 1.6], [2.1, 1.0], [4.2, 2.1], [5.3, 0.8]] as [number, number][]) m.cap([Math.sin(a) * 1.3, 7.4, Math.cos(a) * 1.3], [Math.sin(a) * 1.15, 7.4 - L, Math.cos(a) * 1.15], 0.32, 0.36, 0xa8241c);
  // a tiny saguaro sprig tied to the neck with twine
  const CA = TOON.cactus;
  m.region([-1.4, 5.6, -1.4], [1.4, 6.1, 1.4], (x, y, z) => Math.abs(Math.hypot(x, z) - 1.15) < 0.18, TWINE.base);
  const base: V3 = [0.9, 5.2, 1.0];
  m.cap(base, vadd(base, [0.35, 3.6, 0.45]), 0.48, 0.42, (x, y, z) => ((Math.floor(Math.atan2(x - 0.9, z - 1) * 3) & 1) ? CA.base : CA.shade));
  m.path([vadd(base, [0.1, 1.6, 0.15]), vadd(base, [0.95, 1.7, 0.2]), vadd(base, [1.05, 2.6, 0.25])], () => 0.3, CA.base);
  m.ell(vadd(base, [0.4, 3.75, 0.5]), [0.35, 0.3, 0.35], TOON.flower.base); // a pink bloom on top
  for (const p of [[0.4, 1.0, 0.6], [0.6, 2.4, 0.7], [0.2, 3.0, 0.5], [1.3, 2.3, 0.3]] as V3[]) m.ell(vadd(base, p), [0.12, 0.12, 0.12], 0xf4ecd8);
  shadeRamps(m.m, [CA], true);
  return out(m, [0, -3, 0], 19.5);
}

/** every consumable by registry key */
export const CONSUMABLES: Record<string, () => Consumable> = {
  item_bandage: bandageRoll,
  item_linen: embalmersLinen,
  item_dagger: sacrificialDagger,
  item_smoke: smokeBombHD,
  item_star: tinStar,
  item_charm: serketCharm,
  item_dynamite: dynamiteHD,
  item_snakeoil: snakeOil,
  item_whiskey: cactusWhiskey,
};
const cache = new Map<string, Consumable>();
export function consumable(key: string): Consumable | null {
  let c = cache.get(key);
  if (!c) {
    const f = CONSUMABLES[key];
    if (!f) return null;
    cache.set(key, (c = f()));
  }
  return c;
}
