// Old Mother Tamsin — the tortoise shopkeeper. A very old desert tortoise lady
// who carries her whole life on her shell. Everything is hand-shaped and
// organic (noise-wobbled masses, bent tubes) — no plain primitives — and
// everything that moves is its own rig part: neck, head, jaw, droopy lids,
// headscarf coins, spectacle chain, arms, cane, cane bells, legs, tail, the
// three strapped pouches, the hanging lantern and the bead necklaces.
//
// She can RETRACT into her shell: meta.retract gives, per part, the local
// offset (metres, parent space) that pulls it inside; meta.shellDrop is how far
// the shell sinks to the ground once the legs are in.
//
// GRID: designed at 1/36 m and re-cut to 1/72 m with fine detail passes (see DETAIL RE-CUT;
// she also carries a merchant's pack frame, a kettle, a chilli ristra and a brass balance),
// origin on the ground between the feet, faces +Z, LEFT = +X,
// even-width symmetry (voxel x mirrors to -1 - x, geometric gx to -gx).
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, SocketSpec, V3 } from '../../../engine/voxel/Rig';
import { defaultExpressions } from '../toon/humanoid';
import { lump, tube } from './organic';
import { noise } from '../../../engine/math/rand';
import { cellular } from '../materials';
import { weather } from '../wear';

export const TORTOISE_EXPRESSIONS = ['neutral', 'laugh', 'surprised', 'scared', 'squinty'];
const VS = 1 / 36;
const mx = (x: number) => -1 - x;
const mg = (p: V3): V3 => [-p[0], p[1], p[2]];
function symm(m: VoxelModel) {
  const add: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, rgb, flags) => {
    if (x >= 0) add.push([mx(x), y, z, rgb, flags]);
  });
  for (const [x, y, z, c, f] of add) m.set(x, y, z, c, f);
  return m;
}
function mirrorPart(src: VoxelModel, name: string) {
  const o = new VoxelModel(name);
  src.forEach((x, y, z, rgb, flags) => o.set(mx(x), y, z, rgb, flags));
  return o;
}

// ------------------------------------------------------------------ palette (clean regions for cel shading)
const SKIN = { base: 0x8a8261, shade: 0x6d6649, hi: 0xa39b78, dark: 0x4c4734, scale: 0xa9a17c, scaleEdge: 0x5d573f };
const HORN = { base: 0x4a4030, hi: 0x6a5c44, claw: 0xd8cba0 };
const CARA = { base: 0x8a6a3a, ring: 0x9c7a46, seam: 0x4a3520, bleach: 0xb59360, chip: 0xc9a46c, paintR: 0xb04a32, paintW: 0xe8dcc0, mid: 0x7e5f33, winter: 0x5e4426, sun: 0xa88552 };
const PLAS = { base: 0xc8b07a, seam: 0x7a6038, ring: 0xb89e68 };
const KNIT = { a: 0xb0563a, b: 0x8e4028, cream: 0xe8d6b0 };
const SCARF = { base: 0x3f4c7c, shade: 0x2f3a62, motif: 0xd9a53a };
const GOLD = { base: 0xd8b04a, hi: 0xf2d77a, dark: 0x8a6a24 };
const LEATHER = { base: 0x8a5a32, shade: 0x6a4224, hi: 0xa87444, stitch: 0xe0c89a };
const WOOD = { base: 0x7a5530, shade: 0x5a3c20, hi: 0x9a7044, knot: 0x3e2814 };
const EYE = { pupil: 0x16100c, iris: 0x5a3a14, glint: 0x9c9284 }; // a soft wet catch-light, not a cartoon sparkle

// ------------------------------------------------------------------ joints (geometric)
const J = {
  shell: [0, 13, -3] as V3,
  neck: [0, 35.5, -1.5] as V3,
  head: [0, 44, 3.5] as V3,
  jaw: [0, 46.2, 3.5] as V3,
  tails: [0, 45, -2.5] as V3,
  chain: [0, 38.8, 2.5] as V3,
  shoulder: [10, 33, 0] as V3,
  elbow: [12.5, 27, 2.5] as V3,
  hand: [13, 20.5, 6] as V3,
  hip: [5, 14, -1] as V3,
  tail: [0, 14, -12] as V3,
};

// ================================================================== SHELL (root): carapace, plastron, shawl, rugs, cactus
function carapaceColor(x: number, y: number, z: number): number {
  const cy = 28, cz = -6;
  const u = Math.atan2(x + 0.5, -(z + 0.5 - cz)) / (Math.PI / 2); // -1..1 side to side
  const v = (y + 0.5 - cy) / 16; // -1..1 bottom to top
  const wob = noise.n2(u * 3.1, v * 3.1) * 0.035;
  // scute layout: vertebrals (centre strip), costals (flanks), marginals (rim)
  const au = Math.abs(u);
  let seam = false, cu = 0, cv = 0, band = 0;
  if (v < -0.82) {
    // marginal row along the bottom rim
    const k = Math.round((u + wob) / 0.16);
    seam = Math.abs(u + wob - k * 0.16) < 0.022 || Math.abs(v + 0.82) < 0.04;
    cu = k * 0.16;
    cv = -0.91;
    band = 0;
  } else if (au < 0.24 + wob) {
    const B = [-0.82, -0.48, -0.12, 0.24, 0.6, 1.2];
    for (let i = 0; i < B.length - 1; i++) if (v >= B[i] && v < B[i + 1]) {
      cv = (B[i] + B[i + 1]) / 2;
      band = i;
      seam = v - B[i] < 0.045 || B[i + 1] - v < 0.02;
    }
    seam = seam || Math.abs(au - (0.24 + wob)) < 0.035;
    cu = 0;
  } else if (au < 0.74 + wob) {
    const B = [-0.82, -0.36, 0.08, 0.5, 1.2];
    for (let i = 0; i < B.length - 1; i++) if (v + wob >= B[i] && v + wob < B[i + 1]) {
      cv = (B[i] + B[i + 1]) / 2;
      band = 10 + i;
      seam = v + wob - B[i] < 0.045;
    }
    seam = seam || Math.abs(au - (0.74 + wob)) < 0.035;
    cu = Math.sign(u) * 0.49;
  } else {
    const k = Math.round((v + wob) / 0.17);
    seam = Math.abs(v + wob - k * 0.17) < 0.03;
    cu = Math.sign(u) * 0.87;
    cv = k * 0.17;
    band = 20;
  }
  if (seam) return CARA.seam;
  // growth rings around each scute centre + sun-bleached top
  const d = Math.hypot((u - cu) * 1.25, v - cv);
  const ring = Math.floor(d / 0.055) % 2 === 1;
  // faded painted glyphs on three scutes (sun, snake, scorpion)
  const lu = (u - cu) / 0.12, lv = (v - cv) / 0.14;
  if (band === 3 && Math.hypot(lu, lv) < 0.55) return Math.hypot(lu, lv) < 0.32 ? CARA.paintR : CARA.paintW;
  if (band === 3 && Math.abs(Math.hypot(lu, lv) - 0.85) < 0.12 && Math.floor((Math.atan2(lv, lu) + 4) * 2.5) % 2 === 0) return CARA.paintR;
  if (band === 11 && u > 0 && Math.abs(lv - Math.sin(lu * 3.2) * 0.35) < 0.14 && Math.abs(lu) < 0.9) return CARA.paintW;
  if (band === 12 && u < 0 && ((Math.abs(lu) < 0.18 && Math.abs(lv) < 0.6) || (Math.abs(lv + 0.1) < 0.12 && Math.abs(lu) < 0.65) || (lu > 0.45 && Math.abs(lv - 0.45) < 0.14))) return CARA.paintR;
  if (FINE_RINGS) {
    // the 1/72 re-cut: dense growth rings in three tones (wide summer bands, thin dark winter
    // lines), each scute's areola paler, the sun-bleached crown, and the worn marginal rim
    const k = d / 0.031, ri = Math.floor(k), fr = k - ri;
    if (d < 0.05) return v > 0.4 ? CARA.chip : CARA.bleach;
    if (fr < 0.2) return v > 0.5 ? CARA.ring : CARA.winter;
    if (v > 0.5) return ri % 2 ? CARA.bleach : CARA.sun;
    if (v < -0.84) return ri % 2 ? CARA.ring : CARA.base;
    return ri % 3 === 0 ? CARA.ring : ri % 3 === 1 ? CARA.base : CARA.mid;
  }
  if (v > 0.55 && ring) return CARA.bleach;
  return ring ? CARA.ring : CARA.base;
}
let FINE_RINGS = false;

function buildShell() {
  const m = new VoxelModel('shell');
  // inner body (dark skin) so the openings never show a void
  lump(m, [0, 26, -3], [8.5, 11.5, 6], () => SKIN.dark, { wobble: 0.06, seed: 21 });
  // carapace: a high, slightly boxy dome, 2 voxels thick, open toward the front
  lump(m, [0, 28, -6], [13, 16, 11], (x, y, z) => (z > -1 ? null : carapaceColor(x, y, z)), { wobble: 0.05, seed: 4, power: 2.5, shell: 0.16 });
  // pyramided scute centres: a voxel raised on the vertebral + costal scutes
  for (const [x, y, z] of [[0, 44, -9], [0, 39, -16], [0, 32, -17], [0, 24, -17], [8, 40, -13], [9, 31, -15], [9, 22, -15]] as V3[]) {
    m.set(x, y, z, CARA.ring);
    m.set(mx(x), y, z, CARA.ring);
  }
  // chipped, worn rim (deliberate notches)
  for (const [x, y, z] of [[11, 14, -3], [-12, 17, -2], [6, 13, -9], [-4, 13, -11], [12, 36, -2]] as V3[]) m.del(x, y, z).set(x, y + 1, z, CARA.chip);
  // plastron: the belly plate, gently domed, plates with seams
  for (let y = 14; y <= 35; y++)
    for (let x = 0; x <= 9; x++) {
      const w = y < 17 ? 7 : y > 32 ? 6 : 9;
      if (x > w) continue;
      const bulge = Math.round(1.4 * Math.cos(((y - 24.5) / 12) * 1.3) - (x / 9) * 1.2);
      const z = 1 + Math.max(0, bulge);
      const seam = x === 0 || [18, 23, 28, 32].includes(y) || (x === 9 && y % 3 === 0);
      for (let k = 0; k <= 1; k++) m.set(x, y, z - k, seam ? PLAS.seam : (y + x) % 5 === 0 ? PLAS.ring : PLAS.base);
    }
  // bridges joining plastron to carapace along the flanks
  for (let y = 17; y <= 29; y++) for (let x = 9; x <= 12; x++) for (let z = -1; z <= 1; z++) if (!m.has(x, y, z)) m.set(x, y, z, x === 12 ? CARA.seam : CARA.base);
  symm(m);
  // knitted shawl draped over the shoulders and the front rim, with a point down the plastron
  lump(m, [0, 37, -2], [11.5, 3.2, 5.2], (x, y, z) => (z < -3 && y < 37 ? null : knit(x, y)), { wobble: 0.08, seed: 33, power: 2.6, shell: 0.42 });
  for (let y = 27; y <= 35; y++) {
    const w = Math.round((y - 26) * 0.9);
    for (let x = -w; x < w; x++) m.set(x, y, 4 + (y > 31 ? 0 : 0), knit(x, y)).set(x, y, 3, knit(x, y));
  }
  for (let x = -2; x < 2; x++) m.set(x, 26, 4, KNIT.cream).set(x, 25, 4, (x & 1) ? KNIT.cream : KNIT.a); // fringe tassels
  m.set(-1, 24, 4, KNIT.cream);
  // two rolled rugs strapped across the top of the shell, sagging a little, fringed ends
  rug(m, [-9.5, 45, -8], [8.5, 45.5, -8.5], 2.7, [0xb0442e, 0x2f4a7a, 0xe8d6b0], 61);
  rug(m, [-8.5, 42, -14], [7.5, 41.6, -13.6], 2.3, [0x3f6a4a, 0xc8903a, 0x8e2a20], 62);
  // ropes lashing the rugs to the shell
  for (const rx of [-5, 4])
    tube(m, [[rx, 48.5, -8], [rx + 0.3, 46, -4.5], [rx + 0.4, 41, -2.5]], 0.55, 0.55, () => 0xc9a86a, { wobble: 0.05, seed: rx + 70 });
  // a tiny saguaro growing from a crack on top, with a pink flower
  tube(m, [[6, 46, -3.5], [6.2, 49, -3.4], [6.1, 52.5, -3.6]], 1.25, 1.05, (x, y, z) => (Math.floor(Math.atan2(z + 3.5, x - 6) * 2.6) % 2 === 0 ? 0x4f8536 : 0x6aa548), { wobble: 0.06, seed: 80 });
  tube(m, [[6.5, 49.2, -3.5], [8.4, 49.4, -3.5], [8.6, 51.2, -3.4]], 0.7, 0.62, () => 0x5a9640, { wobble: 0.04, seed: 81 });
  m.set(6, 53, -4, 0xf06a8a).set(7, 53, -4, 0xf06a8a).set(6, 53, -3, 0xf06a8a).set(6, 54, -4, 0xffd25a);
  for (const [x, z] of [[5, -4], [7, -3], [6, -2], [5, -3]] as [number, number][]) m.set(x, 45, z, 0x4a3020);
  return m;
}

function knit(_x: number, y: number) {
  // knitted bands: cream stripe, a shadow row under it, terracotta body
  const r = ((y % 5) + 5) % 5;
  return r === 0 ? KNIT.cream : r === 4 ? KNIT.b : KNIT.a;
}

/** rolled rug: organic roll along a sagging axis, striped body, spiral rolled ends, fringe */
function rug(m: VoxelModel, a: V3, b: V3, r: number, cols: number[], seed: number) {
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.6, (a[2] + b[2]) / 2];
  tube(m, [a, mid, b], r, r * 0.94, (x, y, z, g) => {
    const end = g < 0.05 || g > 0.95;
    if (end) {
      const d = Math.hypot(y + 0.5 - (a[1] + (b[1] - a[1]) * g), z + 0.5 - (a[2] + (b[2] - a[2]) * g));
      return Math.floor(d * 1.6) % 2 ? cols[0] : cols[2];
    }
    const s = Math.floor(g * 14);
    return s % 4 === 0 ? cols[2] : s % 4 === 2 ? cols[1] : cols[0];
  }, { wobble: 0.06, seed });
  // fringe tassels at both ends
  for (const e of [a, b]) {
    const dir = e === a ? -1 : 1;
    for (let k = -1; k <= 1; k++) m.set(Math.round(e[0] + dir * 1.2), Math.round(e[1] + k), Math.round(e[2] + (k & 1)), cols[2]);
  }
}

// ================================================================== NECK, HEAD, JAW, EYES, LIDS
// One sculpted head volume is split along the mouth seam into the head and jaw
// parts (so the beak line always meets). Face features are seated on the
// sculpted surface, computed per column, never floating or painted on.
const BEAK = { base: 0xa39670, edge: 0x6a5e44, hi: 0xbcae86 };
const MOUTH = { roof: 0x6a3a32, tongue: 0x9a5a4a, line: 0x2e2a20 };
const FRAME = { base: 0x7c838c, hi: 0xb4bcc6, dark: 0x4e545c }; // thin steel wire spectacles (not gold: the coins are gold)

/** the head volume: a blunt wedge, broad at the cheeks, tapering to a rounded snout */
function inHead(x: number, y: number, z: number): boolean {
  const gx = Math.abs(x + 0.5), gy = y + 0.5, gz = z + 0.5;
  const t = Math.min(1, Math.max(0, (gz - 1) / 14));
  const rx = 6.4 * (1 - 0.3 * t * t);
  const ry = 5.6 * (1 - 0.15 * Math.pow(t, 1.5));
  const cy = 48.6 - 1.1 * t;
  const nx = gx / rx, ny = (gy - cy) / ry, nz = (gz - 7.5) / 8.1;
  const d = Math.pow(Math.abs(nx), 2.4) + Math.pow(Math.abs(ny), 2.3) + Math.pow(Math.abs(nz), 2.7);
  return d <= 1 + noise.n3(gx * 0.31 + 4.2, gy * 0.31, gz * 0.31) * 0.06;
}
/** the mouth seam (rises a little toward the hinge, like a tortoise's long grin line) */
const mouthY = (z: number) => 45.6 + Math.max(0, 9.5 - (z + 0.5)) * 0.24;
const inJawZone = (y: number, z: number) => z >= 3 && y + 0.5 < mouthY(z);

function buildNeck() {
  const m = new VoxelModel('neck');
  // long, leathery, wrinkled neck reaching up and forward out of the shell
  const len = 10;
  tube(m, [[0, 34.5, -2], [0, 39.2, 0.2], [0, 43.8, 3.4]], 3.8, 3.3, (x, y, z, g) => {
    const s = g * len;
    if (s > 1.5 && Math.floor(s + 0.5) % 3 === 0) return SKIN.shade; // wrinkle rings
    return z > 1.5 && y < 41 ? SKIN.hi : SKIN.base;
  }, { wobble: 0.07, seed: 12 });
  // loose skin collar where the neck leaves the shell, and a saggy dewlap
  lump(m, [0, 35.2, -0.4], [4.4, 1.5, 3.6], (x, y) => (y >= 35 ? SKIN.base : SKIN.shade), { wobble: 0.14, seed: 14 });
  lump(m, [0, 39.4, 3.3], [2.6, 2.5, 1.6], (x, y) => (y === 38 ? SKIN.shade : SKIN.hi), { wobble: 0.12, seed: 13 });
  return m;
}

/** front surface (max z) of a model per (x, y) column; NaN where the column is empty */
function surface(m: VoxelModel) {
  const S = new Map<number, number>();
  m.forEach((x, y, z) => {
    const k = (x + 64) * 256 + y;
    if ((S.get(k) ?? -999) < z) S.set(k, z);
  });
  return (x: number, y: number) => S.get((x + 64) * 256 + y) ?? NaN;
}

type LidKind = 'neutral' | 'squint' | 'closed';
interface FaceOut {
  head: VoxelModel;
  jaw: VoxelModel;
  eye: VoxelModel;
  lids: Record<LidKind, VoxelModel>;
  coins: VoxelModel;
  tails: VoxelModel;
  eyeAt: V3;
  lidAt: V3;
  coinsAt: V3;
}

const EYE_X = [3, 4];
const EYE_Y = [47, 48, 49];

function buildFace(): FaceOut {
  const head = new VoxelModel('head');
  const jaw = new VoxelModel('jaw');
  for (let x = -8; x < 8; x++)
    for (let y = 40; y < 57; y++)
      for (let z = -3; z < 18; z++) {
        if (!inHead(x, y, z)) continue;
        const gz = z + 0.5;
        if (inJawZone(y, z)) jaw.set(x, y, z, gz > 11.6 ? BEAK.base : y <= 43 ? SKIN.shade : SKIN.base);
        else head.set(x, y, z, gz > 12.3 && y <= 46 ? BEAK.base : SKIN.base);
      }
  const put = (m: VoxelModel, x: number, y: number, z: number, c: number, f?: number) => {
    if (Number.isFinite(z)) m.set(x, y, z, c, f);
  };
  const empty = (x: number, y: number, z: number) => !head.has(x, y, z) && !jaw.has(x, y, z);
  // the beak's hooked tip overlaps the lower beak at the centre front
  for (const x of [0, -1]) {
    let z = 18;
    while (z > 0 && !jaw.has(x, 45, z)) z--;
    for (const zz of [z, z - 1]) if (jaw.has(x, 45, zz)) { jaw.del(x, 45, zz); head.set(x, 45, zz, BEAK.edge); }
  }
  // mouth: a dark line where the beak edges meet on the outside, pink roof + tongue inside (seen when it opens)
  const jawTop: [number, number, number][] = [];
  jaw.forEach((x, y, z) => { if (!jaw.has(x, y + 1, z)) jawTop.push([x, y, z]); });
  for (const [x, y, z] of jawTop) {
    const outside = empty(x + 1, y, z) || empty(x - 1, y, z) || empty(x, y, z + 1);
    jaw.set(x, y, z, outside ? MOUTH.line : MOUTH.tongue);
  }
  head.forEach((x, y, z) => {
    if (jaw.has(x, y - 1, z) && !(empty(x + 1, y, z) || empty(x - 1, y, z) || empty(x, y, z + 1))) head.set(x, y, z, MOUTH.roof);
  });

  // ---- eyes: wet, dark, glossy, seated in the cheek surface (modelled, not painted)
  const sf0 = surface(head);
  const eye = new VoxelModel('eye_l');
  const ez: Record<string, number> = {};
  for (const s of [1, -1]) {
    const X = (x: number) => (s > 0 ? x : mx(x));
    for (const x of EYE_X)
      for (const y of EYE_Y) {
        const z = sf0(X(x), y);
        if (!Number.isFinite(z)) continue;
        head.del(X(x), y, z).set(X(x), y, z - 1, SKIN.dark);
        if (s > 0) {
          ez[x + ',' + y] = z;
          const glint = x === 3 && y === 48, iris = x === 4 && y === 47;
          eye.set(x, y, z, glint ? EYE.glint : iris ? EYE.iris : EYE.pupil);
        }
      }
    // sunken, wrinkled skin around the eye; a soft bag under it
    for (const [x, y] of [[2, 47], [2, 48], [5, 47], [5, 48]] as [number, number][]) put(head, X(x), y, sf0(X(x), y), SKIN.shade);
    for (const x of [3, 4]) put(head, X(x), 46, sf0(X(x), 46), SKIN.hi);
  }
  // ---- heavy droopy lids (own parts; alternates per expression)
  const lidCell = (m: VoxelModel, x: number, y: number, c: number) => {
    const z = ez[x + ',' + y] ?? sf0(x, y);
    put(m, x, y, z + 1, c);
  };
  const lids = {} as Record<LidKind, VoxelModel>;
  lids.neutral = new VoxelModel('brow_l');
  for (const x of EYE_X) lidCell(lids.neutral, x, 49, SKIN.hi);
  lids.squint = new VoxelModel('brow_l');
  for (const x of EYE_X) lidCell(lids.squint, x, 49, SKIN.hi);
  for (const x of [2, 3, 4, 5]) lidCell(lids.squint, x, 48, SKIN.base);
  lids.closed = new VoxelModel('brow_l');
  for (const x of EYE_X) lidCell(lids.closed, x, 49, SKIN.hi);
  for (const [x, y, c] of [[2, 47, MOUTH.line], [3, 48, MOUTH.line], [4, 48, MOUTH.line], [5, 47, MOUTH.line], [2, 48, SKIN.base], [5, 48, SKIN.base], [3, 47, SKIN.hi], [4, 47, SKIN.hi]] as [number, number, number][])
    lidCell(lids.closed, x, y, c);

  // ---- a few deliberate wrinkles + nostrils on the snout
  const sf = surface(head);
  for (const x of [0, -1]) put(head, x, 47, sf(x, 47), SKIN.dark);
  for (const s of [1, -1]) for (const [x, y] of [[5, 44], [6, 45]] as [number, number][]) put(head, s > 0 ? x : mx(x), y, sf(s > 0 ? x : mx(x), y), SKIN.shade);

  // ---- headscarf: one cloth layer over the crown, sides and back, framing the face
  const faceZ = (gy: number) => 8 + Math.max(0, gy - 49.6) * 1.7;
  const layer = new Map<number, [number, number, number]>();
  const K = (x: number, y: number, z: number) => ((x + 64) * 256 + y) * 256 + (z + 64);
  head.forEach((x, y, z) => {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const p: [number, number, number] = [x + dx, y + dy, z + dz];
      if (empty(...p)) layer.set(K(...p), p);
    }
  });
  const isScarf = (x: number, y: number, z: number) => y + 0.5 > 44.6 && (z + 0.5 < faceZ(y + 0.5) || y + 0.5 > 52.4);
  const scarf: [number, number, number][] = [];
  layer.forEach((p) => { if (isScarf(...p)) scarf.push(p); });
  const inScarf = new Set(scarf.map((p) => K(...p)));
  for (const [x, y, z] of scarf) {
    // a deeper indigo hem where the cloth ends (face opening + nape); clean indigo body
    let edge = false;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const k = K(x + dx, y + dy, z + dz);
          if (layer.has(k) && !inScarf.has(k)) edge = true;
        }
    head.set(x, y, z, edge || (y <= 47 && z < 3) ? SCARF.shade : SCARF.base);
  }
  // knot at the nape
  lump(head, [0, 45.4, -1.6], [2.4, 1.7, 1.5], (x, y) => (y >= 46 ? SCARF.base : SCARF.shade), { wobble: 0.16, seed: 16 });

  // ---- gold coins on threads along the scarf's forehead edge (their own swinging part)
  const coins = new VoxelModel('coins');
  const sfC = surface(head);
  for (const [x, th, big] of [[0, 1, 1], [2, 1, 0], [4, 0, 0]] as [number, number, number][])
    for (const X of [x, mx(x)]) {
      const zE = sfC(X, 52);
      if (!Number.isFinite(zE)) continue;
      let z = zE;
      for (let k = 1; k <= th + 1; k++) {
        const zz = sfC(X, 52 - k);
        if (Number.isFinite(zz)) z = Math.max(z, zz + 1);
      }
      for (let k = 1; k <= th; k++) coins.set(X, 52 - k, z, SCARF.shade);
      coins.set(X, 51 - th, z, big ? GOLD.hi : GOLD.base, VF.METAL);
    }

  // ---- scarf tails hanging from the knot (own swinging part)
  const tails = new VoxelModel('scarf_tails');
  tube(tails, [[0.8, 45, -2.6], [1.6, 42, -3.2], [2.2, 38.6, -2.8]], 1.0, 1.25, (x, y) => (y <= 39 ? SCARF.motif : SCARF.base), { wobble: 0.1, seed: 17 });
  tube(tails, [[-1.2, 45, -2.6], [-2.4, 42.4, -3.0], [-3.2, 39.8, -2.4]], 0.95, 1.15, (x, y) => (y <= 40 ? SCARF.motif : SCARF.shade), { wobble: 0.1, seed: 18 });

  // ---- saggy wattle under the chin (moves with the jaw)
  lump(jaw, [0, 42.6, 8.4], [3.0, 1.5, 3.2], (x, y) => (y <= 41 ? SKIN.shade : SKIN.base), { wobble: 0.14, seed: 19 });

  const ezs = Object.values(ez);
  const eyeZ = ezs.length ? ezs.reduce((a, b) => a + b, 0) / ezs.length : 11;
  return { head, jaw, eye, lids, coins, tails, eyeAt: [4, 48.5, eyeZ + 0.5], lidAt: [4, 49.5, eyeZ + 1.5], coinsAt: [0, 52, sfC(0, 52) + 1] };
}

/** round reading spectacles hanging on a fine steel chain over the shawl (hung a little crooked) */
function buildSpecs() {
  const m = new VoxelModel('chain');
  const Z = 6;
  for (const s of [1, -1]) {
    const X = (x: number) => (s > 0 ? x : mx(x));
    const dy = s > 0 ? 0 : -1; // the right lens hangs one lower: the pair tilts on its chain
    for (const [x, y] of [[2, 31], [3, 31], [1, 30], [4, 30], [1, 29], [4, 29], [2, 28], [3, 28]] as [number, number][])
      m.set(X(x), y + dy, Z, y === 31 ? FRAME.base : FRAME.dark, VF.METAL);
    for (const [x, y] of [[2, 30], [3, 30], [2, 29], [3, 29]] as [number, number][])
      m.set(X(x), y + dy, Z, s > 0 && x === 2 && y === 30 ? 0xffffff : y === 30 ? 0xd2ecf4 : 0xa8ccd8); // glass + one glint
    for (const x of [1, 2, 3, 4]) m.set(X(x), 30 + dy, Z - 1, FRAME.dark, VF.METAL); // folded temple behind the rim
  }
  m.set(0, 30, Z, FRAME.base, VF.METAL).set(-1, 29, Z, FRAME.base, VF.METAL); // crooked bridge
  // the fine chain from both hinges up around the back of the neck
  const strand = (pts: V3[]) => {
    let k = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 1.5);
      for (let j = 0; j < n; j++) {
        const t = j / n;
        m.set(Math.floor(a[0] + (b[0] - a[0]) * t), Math.floor(a[1] + (b[1] - a[1]) * t), Math.floor(a[2] + (b[2] - a[2]) * t), (k++ & 1) ? FRAME.base : FRAME.dark, VF.METAL);
      }
    }
  };
  strand([[4.5, 30.5, 6.2], [5.6, 33.5, 5.3], [5.3, 36.6, 3.5], [4.2, 38.8, 2.6]]);
  strand([[-4.5, 29.5, 6.2], [-6.1, 33, 5.3], [-5.6, 36.6, 3.5], [-4.6, 38.8, 2.6]]);
  return m;
}

// ================================================================== LIMBS (LEFT; right = mirror)
function scaly(x: number, y: number, z: number, g: number) {
  // overlapping limb scales read as clean bands: a darker seam every few rows, lighter plates on the front
  const row = Math.floor(g * 7.5);
  const seam = Math.floor(g * 7.5 * 3) % 3 === 0 && row > 0;
  if (seam) return SKIN.scaleEdge;
  return z > 0.8 ? SKIN.scale : SKIN.base;
}

function buildArm() {
  const m = new VoxelModel('arm_l');
  tube(m, [[10, 33, 0], [11.6, 30.2, 1.5], [12.5, 27.2, 2.5]], 2.5, 2.2, (x, y, z, g) => scaly(x - 11, y, z - 1.5, g), { wobble: 0.1, seed: 31 });
  return m;
}

function buildForearm(withCaneGrip: boolean) {
  const m = new VoxelModel('fore_l');
  tube(m, [[12.5, 27, 2.5], [12.9, 23.4, 4.4], [13.1, 20.8, 5.6]], 2.2, 2.6, (x, y, z, g) => scaly(x - 12.8, y, z - 4, g), { wobble: 0.1, seed: 32 });
  // stubby hand with blunt nails
  lump(m, [13.2, 19.4, 6.4], [2.5, 1.7, 2.3], (x, y) => (y < 19 ? SKIN.shade : SKIN.base), { wobble: 0.1, seed: 34 });
  for (const [x, z] of [[12, 8], [13, 8], [14, 8], [15, 7]] as [number, number][]) m.set(x, 18, z, HORN.claw).set(x, 19, z, HORN.claw);
  if (withCaneGrip) for (const z of [5, 6, 7]) m.set(15, 20, z, SKIN.shade); // curled fingers around the cane
  return m;
}

function buildCane() {
  // gnarled walking stick: knotty bent wood, a curled crook, a red ribbon wrap
  const m = new VoxelModel('cane');
  tube(m, [[13.5, 30.2, 6.5], [13.1, 25, 6.3], [13, 20.5, 6.3], [13.3, 10, 7], [13.9, 0.6, 7.6]], 0.85, 0.95, (x, y) => (y % 7 === 3 ? WOOD.knot : (y & 1) ? WOOD.base : WOOD.shade), { wobble: 0.18, seed: 41, step: 0.25 });
  tube(m, [[13.5, 30, 6.5], [14.6, 31.8, 6.5], [16.1, 31.6, 6.5], [16.6, 29.9, 6.5]], 0.8, 0.7, () => WOOD.hi, { wobble: 0.1, seed: 42, step: 0.25 });
  for (let y = 26; y <= 27; y++) for (const [x, z] of [[13, 6], [14, 6], [13, 7], [14, 7], [12, 6], [12, 7]] as [number, number][]) m.set(x, y, z, 0xb0392a);
  m.set(15, 25, 7, 0xb0392a).set(15, 24, 7, 0x8e2a20); // ribbon tail
  return m;
}

function buildBells() {
  const m = new VoxelModel('bells');
  // three little brass bells on short cords from the crook
  for (const [x, y, z, s] of [[16.6, 27.2, 6.5, 0.95], [17.6, 26.4, 7.2, 0.8], [15.8, 26.2, 7.4, 0.75]] as [number, number, number, number][]) {
    for (let yy = Math.floor(y + s); yy <= 29; yy++) m.set(Math.floor(x), yy, Math.floor(z), 0xc9a86a);
    lump(m, [x, y, z], [s, s * 1.2, s], (xx, yy) => (yy <= Math.floor(y - s * 0.6) ? GOLD.dark : GOLD.base), { wobble: 0.05, seed: Math.round(x * 10), flags: VF.METAL });
  }
  return m;
}

function buildLeg() {
  const m = new VoxelModel('leg_l');
  tube(m, [[5, 14.5, -1], [5.3, 8, -0.5], [5.5, 3, 0]], 3.0, 3.4, (x, y, z, g) => scaly(x - 5.3, y, z, g), { wobble: 0.08, seed: 51 });
  // flat elephantine foot with four short nails
  lump(m, [5.6, 1.4, 0.9], [3.5, 1.5, 3.7], (x, y) => (y === 0 ? SKIN.dark : SKIN.base), { wobble: 0.07, seed: 52, power: 2.6 });
  for (const x of [3, 5, 6, 8]) m.set(x, 0, 4, HORN.claw).set(x, 1, 4, HORN.claw);
  return m;
}

function buildTail() {
  const m = new VoxelModel('tail');
  tube(m, [[0, 14, -12], [0, 12.2, -14.6], [0, 10.4, -16.4]], 1.6, 0.55, (x, y, z, g) => scaly(x, y, z, g), { wobble: 0.05, seed: 61 });
  return m;
}

// ================================================================== STRAPPED GEAR (each swings on its strap)
function buildPouch(kind: 1 | 2 | 3) {
  const m = new VoxelModel('pouch_' + kind);
  if (kind === 1) {
    // satchel on the left flank: saggy leather body, flap, brass buckle, strap up to the pivot
    lump(m, [12.8, 22.2, -9], [2.1, 3.0, 2.5], (x, y) => (y >= 24 ? LEATHER.shade : LEATHER.base), { wobble: 0.12, seed: 71 });
    for (let z = -11; z <= -7; z++) m.set(14, 24, z, LEATHER.shade).set(15, 23, z, LEATHER.shade);
    m.set(15, 22, -9, GOLD.base, VF.METAL);
    for (let y = 24; y <= 26; y++) m.set(13, y, -9, LEATHER.hi);
    for (const y of [20, 22]) m.set(15, y, -10, LEATHER.stitch);
  } else if (kind === 2) {
    // round drawstring bag low on the back
    lump(m, [7, 16.6, -15.8], [2.2, 2.4, 1.8], (x, y) => (y >= 18 ? LEATHER.hi : LEATHER.base), { wobble: 0.15, seed: 72 });
    for (let y = 18; y <= 20; y++) m.set(7, y, -15, 0xc9a86a);
    m.set(6, 19, -16, 0xc9a86a).set(8, 19, -16, 0xc9a86a);
  } else {
    // a dried gourd water flask with a cork and cord, on the right flank
    lump(m, [-8.5, 20, -15.2], [2.2, 2.6, 2.0], (x, y) => (y < 19 ? 0xb08a46 : 0xc89e56), { wobble: 0.08, seed: 73 });
    lump(m, [-8.5, 23.4, -15.2], [1.3, 1.4, 1.2], () => 0xc89e56, { wobble: 0.08, seed: 74 });
    m.set(-9, 25, -16, 0x8a6a3a).set(-8, 25, -16, 0x8a6a3a);
    for (let y = 23; y <= 25; y++) m.set(-7, y, -15, 0xc9a86a);
  }
  return m;
}

function buildLantern() {
  // a dented tin lantern on a bent bail, hanging from a hook on the right flank
  const m = new VoxelModel('lantern');
  const T = { base: 0x8a8c90, shade: 0x5e6066, rust: 0x8a4a2a };
  const cx = -13.5, cz = -8;
  for (let y = 22; y <= 23; y++) for (let x = -2; x <= 1; x++) for (let z = -2; z <= 1; z++) m.set(Math.floor(cx) + x, y, cz + z, y === 22 ? T.shade : T.base, VF.METAL); // base
  for (let y = 24; y <= 27; y++)
    for (const [x, z] of [[-2, -2], [1, -2], [-2, 1], [1, 1]] as [number, number][]) m.set(Math.floor(cx) + x, y, cz + z, T.shade, VF.METAL); // corner posts
  // amber glass panes + the little flame (the only faint glow)
  for (let y = 24; y <= 27; y++)
    for (let x = -1; x <= 0; x++) {
      m.set(Math.floor(cx) + x, y, cz - 2, 0xd89a48).set(Math.floor(cx) + x, y, cz + 1, 0xd89a48);
      m.set(Math.floor(cx) - 2, y, cz + x, 0xd89a48).set(Math.floor(cx) + 1, y, cz + x, 0xd89a48);
    }
  m.set(Math.floor(cx), 25, cz, 0xffc860, VF.EMISSIVE).set(Math.floor(cx) - 1, 25, cz - 1, 0xffd88a, VF.EMISSIVE);
  // dented conical roof, a rust streak, ring + bail up to the hook
  for (let x = -2; x <= 1; x++) for (let z = -2; z <= 1; z++) m.set(Math.floor(cx) + x, 28, cz + z, (x + z) % 3 === 0 ? T.rust : T.base, VF.METAL);
  for (let x = -1; x <= 0; x++) for (let z = -1; z <= 0; z++) m.set(Math.floor(cx) + x, 29, cz + z, T.base, VF.METAL);
  m.del(Math.floor(cx) + 1, 28, cz - 2).set(Math.floor(cx) + 1, 27, cz - 2, T.shade, VF.METAL);
  m.set(Math.floor(cx), 30, cz, T.shade, VF.METAL);
  for (const [x, y] of [[-2, 30], [-2, 31], [-1, 32], [0, 32], [1, 31]] as [number, number][]) m.set(Math.floor(cx) + x, y, cz, 0x3a3a3e, VF.METAL);
  return m;
}

function buildBeads() {
  // one strand of chunky turquoise beads knotted on dark cord, a coral bead at the low point
  const m = new VoxelModel('beads');
  const pts: V3[] = [[5.6, 37.6, 3.2], [4.6, 35.4, 4.6], [2.6, 33.9, 5.1], [0, 33.4, 5.2]];
  let k = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 1.4);
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      const x = Math.floor(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t), z = Math.round(a[2] + (b[2] - a[2]) * t);
      if (x < 0 || m.has(x, y, z)) continue;
      m.set(x, y, z, x === 0 ? 0xc8503a : k++ % 3 === 2 ? 0x2c7f74 : 0x45b0a0);
    }
  }
  symm(m);
  return m;
}

// ================================================================== MERCHANT PACK (a travelling trader's frame on her back)
const COPPER = { base: 0xb0643a, hi: 0xd88a58, dark: 0x6a3a20, verd: 0x5a8a6a };
const ROPE = 0xc9a86a;
const poleWood = (x: number, y: number, z: number) => {
  const g = Math.floor(y * 0.55 + noise.n2(x * 0.6 + 3, z * 0.6) * 2.2);
  return g % 7 === 3 ? WOOD.knot : g % 3 === 0 ? WOOD.shade : g % 3 === 1 ? WOOD.base : WOOD.hi;
};
/** the pack frame, lashings, a scroll case and a herb bundle: rigid, so they go on the shell */
function addPack(m: VoxelModel) {
  for (const s of [1, -1]) {
    tube(m, [[s * 7.6, 19.5, -17.6], [s * 7.3, 38, -18.2], [s * 6.9, 58.6, -15.9]], 0.95, 0.8, poleWood, { wobble: 0.08, seed: 90 + s });
    // lashings where the bars cross the poles
    for (const [y, z] of [[24, -18.4], [50.2, -17.2], [57.6, -16.1]] as [number, number][])
      lump(m, [s * 7.2, y, z], [1.35, 0.9, 1.3], (x, yy) => ((yy + x) & 1 ? ROPE : 0xa88a52), { wobble: 0.1, seed: 95 + y });
  }
  tube(m, [[-8.6, 24, -18.6], [0, 23.6, -18.9], [8.6, 24, -18.6]], 0.7, 0.7, poleWood, { wobble: 0.06, seed: 97 });
  tube(m, [[-8.2, 50.2, -17.4], [0, 49.7, -17.7], [8.2, 50.2, -17.4]], 0.7, 0.7, poleWood, { wobble: 0.06, seed: 98 });
  tube(m, [[-11.2, 57.8, -16.1], [0, 57.3, -16.4], [11.2, 57.8, -16.1]], 0.75, 0.7, poleWood, { wobble: 0.06, seed: 99 });
  // straps from the frame over the shell to the shoulders
  for (const s of [1, -1])
    tube(m, [[s * 7.2, 50, -17], [s * 7.6, 47.6, -11.5], [s * 8.4, 41.5, -4.2], [s * 9.4, 36.5, -1.8]], 0.55, 0.55, (x, y) => (y % 3 === 0 ? LEATHER.stitch : LEATHER.shade), { wobble: 0.04, seed: 100 + s });
  // a leather scroll case strapped to the right pole, brass end caps
  tube(m, [[-9.6, 29, -19.4], [-9.7, 37, -19.6], [-9.6, 45, -19.3]], 1.35, 1.3, (x, y) => (y < 30.2 || y > 43.8 ? GOLD.dark : y % 4 === 0 ? LEATHER.shade : LEATHER.base), { wobble: 0.05, seed: 103 });
  for (const y of [33, 41]) lump(m, [-9.6, y, -19.4], [1.65, 0.55, 1.6], () => LEATHER.stitch, { wobble: 0.04, seed: 104 + y });
  // a bundle of dried desert sage tied to the left pole
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1;
    tube(m, [[8.2, 44.5, -18.6], [8.6 + Math.cos(a) * 1.2, 40.2, -18.8 + Math.sin(a) * 1.0], [9 + Math.cos(a) * 2.0, 36.8 - (i % 3), -19 + Math.sin(a) * 1.6]], 0.55, 0.75, (x, y) => (y > 43 ? 0x8a6a3a : (i + y) % 3 ? 0x8a9a6a : 0x6e7e52), { wobble: 0.14, seed: 110 + i });
  }
  lump(m, [8.3, 43.4, -18.6], [1.3, 0.7, 1.3], () => ROPE, { wobble: 0.08, seed: 117 });
}

/** a dented copper kettle swinging from the top bar (pivot at its hook) */
function buildKettle() {
  const m = new VoxelModel('kettle');
  lump(m, [9.6, 51.6, -15.8], [2.7, 2.2, 2.7], (x, y, z) => (y <= 49 ? COPPER.dark : y >= 53 ? COPPER.hi : noise.n3(x * 0.6, y * 0.6, z * 0.6) > 0.45 ? COPPER.verd : COPPER.base), { wobble: 0.06, seed: 120, power: 2.3, flags: VF.METAL });
  lump(m, [9.6, 54, -15.8], [1.8, 0.6, 1.8], () => COPPER.dark, { wobble: 0.04, seed: 121, flags: VF.METAL });
  lump(m, [9.6, 54.9, -15.8], [0.6, 0.6, 0.6], () => 0x2a2420, { wobble: 0.02, seed: 122 });
  tube(m, [[11.6, 51, -15.8], [12.9, 52.2, -15.8], [13.6, 53.8, -15.8]], 0.75, 0.45, () => COPPER.base, { wobble: 0.04, seed: 123, flags: VF.METAL });
  tube(m, [[7.4, 53.2, -15.8], [7.9, 56.2, -15.8], [9.6, 57.4, -15.8], [11.3, 56.2, -15.8], [11.8, 53.2, -15.8]], 0.42, 0.42, () => 0x3a3a3e, { wobble: 0.02, seed: 124, flags: VF.METAL });
  m.del(8, 50, -14).set(8, 50, -15, COPPER.dark, VF.METAL); // a dent on the belly
  return m;
}

/** a ristra of sun-dried red chillies on a cord */
function buildRistra() {
  const m = new VoxelModel('ristra');
  for (let y = 44; y <= 57; y++) m.set(-10, y, -16, ROPE);
  for (let i = 0; i < 9; i++) {
    const y = 55.6 - i * 1.35, s = i % 2 ? 1 : -1, a = i * 1.7;
    const tip: V3 = [-9.5 + s * 1.6 + Math.cos(a) * 0.4, y - 2.3, -15.5 + Math.sin(a) * 1.3];
    tube(m, [[-9.5, y, -15.5], [-9.5 + s * 1.1, y - 1.1, -15.5 + Math.sin(a) * 0.7], tip], 0.8, 0.35, (x, yy) => (yy > y - 0.4 ? 0x4a6a2a : i % 3 === 0 ? 0x8a1c14 : i % 3 === 1 ? 0xb02a1e : 0xc8402a), { wobble: 0.08, seed: 130 + i });
  }
  return m;
}

/** a little brass trader's balance: beam, two pans on cords */
function buildScale() {
  const m = new VoxelModel('scale');
  const B = (x: number, y: number) => ((x + y) % 4 === 0 ? GOLD.hi : GOLD.base);
  for (let y = 54; y <= 57; y++) m.set(0, y, -17, ROPE);
  tube(m, [[-4.6, 53.6, -17], [0, 54, -17], [4.6, 53.6, -17]], 0.45, 0.45, B, { wobble: 0.02, seed: 140, flags: VF.METAL });
  lump(m, [0, 54.4, -17], [0.8, 0.9, 0.8], () => GOLD.dark, { wobble: 0.02, seed: 141, flags: VF.METAL });
  for (const s of [1, -1]) {
    for (const [dx, dz] of [[-1.4, 0], [1.4, 0], [0, 1.3]] as [number, number][]) {
      const n = 9;
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        m.set(Math.round(s * 4.6 + dx * t), Math.round(53.4 - t * 4.2), Math.round(-17 + dz * t), 0xb8a070);
      }
    }
    lump(m, [s * 4.6, 48.7, -17], [2.1, 0.55, 2.0], (x, y) => (y >= 49 ? GOLD.hi : GOLD.dark), { wobble: 0.03, seed: 142 + s, power: 2.2, flags: VF.METAL });
  }
  // a gold nugget and a turquoise bead being weighed
  m.set(4, 49, -17, 0xf2d77a, VF.METAL).set(5, 49, -17, 0xd8b04a, VF.METAL).set(-5, 49, -17, 0x45b0a0);
  return m;
}

// ================================================================== DETAIL RE-CUT (user note: "a lot a lot more detailed")
// Every part is sculpted on the 1/36 design grid above, then re-cut at 1/72: each design voxel
// becomes 2 x 2 x 2, convex corners are rounded off and concave creases filled in (a smooth
// re-cut of the same sculpt, thin threads and glints kept whole), then the fine grid gets its
// own hand-written detail: carved scute seams, dense growth rings, scratches, chips and lichen
// on the carapace; folded, creased old skin on the neck and face; pebbled scales on the limbs;
// glossy domed eyes with an iris, pupil, limbal ring and a catch-light; wear on the gear.
const RES = 2;
const OFF = 512;
const KEY = (x: number, y: number, z: number) => ((x + OFF) << 20) | ((y + OFF) << 10) | (z + OFF);
const D6: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function recut(src: VoxelModel, taken: Set<number>): VoxelModel {
  const o = new VoxelModel(src.name);
  const W = [0.75, 0.25];
  const w8 = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    let w = 0;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) if (src.has(x + i * sx, y + j * sy, z + k * sz)) w += W[i] * W[j] * W[k];
    return w;
  };
  const cand = new Map<number, V3>();
  src.forEach((x, y, z, c, f) => {
    let nb = 0;
    for (const [dx, dy, dz] of D6) {
      if (src.has(x + dx, y + dy, z + dz)) nb++;
      else if (!taken.has(KEY(x + dx, y + dy, z + dz))) cand.set(KEY(x + dx, y + dy, z + dz), [x + dx, y + dy, z + dz]);
    }
    const thin = nb < 3;
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
      if (!thin && w8(x, y, z, dx ? 1 : -1, dy ? 1 : -1, dz ? 1 : -1) < 0.43) continue;
      o.set(x * RES + dx, y * RES + dy, z * RES + dz, c, f);
    }
  });
  for (const [x, y, z] of cand.values())
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
      const sx = dx ? 1 : -1, sy = dy ? 1 : -1, sz = dz ? 1 : -1;
      if (w8(x, y, z, sx, sy, sz) < 0.4) continue;
      const v = src.get(x + sx, y, z) ?? src.get(x, y + sy, z) ?? src.get(x, y, z + sz);
      if (v !== undefined) o.set(x * RES + dx, y * RES + dy, z * RES + dz, v & 0xffffff, v >>> 24);
    }
  return o;
}
const surf = (m: VoxelModel, x: number, y: number, z: number) => D6.some(([dx, dy, dz]) => !m.has(x + dx, y + dy, z + dz));
const FC = (X: number) => (X + 0.5) / RES - 0.5; // fine voxel index -> design-grid voxel coordinate (fractional)
const CARA_SET = new Set<number>([CARA.base, CARA.ring, CARA.bleach, CARA.seam, CARA.chip]);
const SKIN_SET = new Set<number>([SKIN.base, SKIN.shade, SKIN.hi, SKIN.scale, SKIN.scaleEdge]);

/** carapace: dense rings, carved seams, scratches, chips and lichen */
function fineShell(m: VoxelModel) {
  FINE_RINGS = true;
  const cx = 0, cy = 28 * RES, cz = -6 * RES;
  const carve: V3[] = [];
  const todo: [number, number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    if (!CARA_SET.has(c)) return;
    let col = carapaceColor(FC(x), FC(y), FC(z));
    const s = surf(m, x, y, z);
    if (s && col === CARA.seam) {
      // outward neighbour empty: carve a groove one fine voxel deep along the seam
      const ox = x - cx, oy = y - cy, oz = z - cz, ax = Math.abs(ox), ay = Math.abs(oy), az = Math.abs(oz);
      const n: V3 = ax > ay && ax > az ? [Math.sign(ox), 0, 0] : ay > az ? [0, Math.sign(oy), 0] : [0, 0, Math.sign(oz)];
      if (!m.has(x + n[0], y + n[1], z + n[2]) && oz < 4) carve.push([x, y, z]);
    }
    if (s && col !== CARA.seam) {
      if (Math.abs(noise.n3(x * 0.085 + 2, y * 0.3 + x * 0.21, z * 0.085)) < 0.011) col = CARA.chip; // scratches
      const li = noise.n3(x * 0.16 + 7, y * 0.16, z * 0.16 - 3);
      if (y > cy + 14 && li > 0.5) col = li > 0.6 ? 0xb8b884 : 0x8e9a68; // pale desert lichen
    }
    if (col !== c) todo.push([x, y, z, col]);
  });
  FINE_RINGS = false;
  for (const [x, y, z, c] of todo) m.set(x, y, z, c);
  for (const [x, y, z] of carve) m.del(x, y, z);
}

/** old skin: folds on the neck, a crease network on the face, pebbled scales on the limbs */
function fineSkin(m: VoxelModel, kind: 'neck' | 'head' | 'limb') {
  const todo: [number, number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    if (!SKIN_SET.has(c) || !surf(m, x, y, z)) return;
    let col = c;
    if (kind === 'neck') {
      const f = (((y + noise.n2(x * 0.28, z * 0.28) * 2.4) % 4.6) + 4.6) % 4.6;
      if (f < 0.9) col = SKIN.shade;
      else if (f < 1.7 && c !== SKIN.shade) col = SKIN.hi;
      if (Math.abs(noise.n3(x * 0.3, y * 0.12, z * 0.3)) < 0.03) col = SKIN.dark;
    } else if (kind === 'head') {
      const n = noise.n3(x * 0.24 + 5, y * 0.34, z * 0.24);
      if (Math.abs(n) < 0.026) col = SKIN.shade; // fine crease lines only, no blotches
    } else {
      const [f1, f2] = cellular(x / 3.4, y / 3.0, z / 3.4, 7);
      if (f2 - f1 < 0.13) col = SKIN.scaleEdge;
      else if (f1 < 0.3 && c !== SKIN.shade) col = SKIN.scale;
    }
    if (col !== c) todo.push([x, y, z, col]);
  });
  for (const [x, y, z, c] of todo) m.set(x, y, z, c);
}

/** glossy domed eye: limbal ring, warm amber-brown iris, round pupil, one wet catch-light */
function fineEye(eye: VoxelModel, head: VoxelModel, at: V3) {
  const ex = at[0] * RES, ey = at[1] * RES;
  const front = new Map<string, number>();
  eye.forEach((x, y, z) => {
    const k = x + ',' + y;
    if ((front.get(k) ?? -999) < z) front.set(k, z);
  });
  const add: [number, number, number, number][] = [];
  eye.forEach((x, y, z) => {
    const u = (x + 0.5 - ex) / 2.1, v = (y + 0.5 - ey + 0.4) / 2.9, r = Math.hypot(u, v);
    let c = r < 0.4 ? EYE.pupil : r < 0.62 ? (v > 0 ? 0xa86e26 : 0x7a4a18) : r < 0.82 ? 0x8a5a1c : 0x2e1c10;
    if (x === Math.floor(ex - 1) && y === Math.floor(ey)) c = 0xf2eee4; // catch-light, upper inner edge of the pupil (clear of the lid)
    eye.set(x, y, z, c);
    if (front.get(x + ',' + y) === z && r < 0.62 && y <= Math.floor(ey + 0.6)) add.push([x, y, z + 1, c === 0xf2eee4 ? c : r < 0.4 ? EYE.pupil : 0x9a6422]);
  });
  for (const [x, y, z, c] of add) eye.set(x, y, z, c);
  eyeRim(eye, head);
}
/** a dark wet rim of skin round the eye */
function eyeRim(eye: VoxelModel, head: VoxelModel) {
  const rim: V3[] = [];
  head.forEach((x, y, z) => {
    if (D6.some(([dx, dy]) => (dx || dy) && eye.has(x + dx, y + dy, z))) rim.push([x, y, z]);
  });
  for (const [x, y, z] of rim) head.set(x, y, z, 0x3a3024);
}
const mirrorFine = (src: VoxelModel, name: string) => mirrorPart(src, name);

// ================================================================== RIG
let TORTOISE: RigSpec | null = null;
/** Old Mother Tamsin (built once: the 1/72 re-cut takes most of a second) */
export function tortoiseLadyRig(): RigSpec {
  return (TORTOISE ??= buildTortoise());
}
function buildTortoise(): RigSpec {
  const parts: PartSpec[] = [];
  const P = (name: string, model: VoxelModel, joint: V3, parent?: string) => {
    if (model.count > 0) parts.push({ name, model, pivot: joint, attach: joint, parent });
  };
  const F = buildFace();
  const armL = buildArm();
  const foreL = buildForearm(false);
  const foreR = mirrorPart(buildForearm(true), 'fore_r');
  const legL = buildLeg();
  const shell = buildShell();
  addPack(shell);
  P('shell', shell, J.shell);
  P('neck', buildNeck(), J.neck, 'shell');
  P('head', F.head, J.head, 'neck');
  P('jaw', F.jaw, J.jaw, 'head');
  P('eye_l', F.eye, F.eyeAt, 'head');
  P('eye_r', mirrorPart(F.eye, 'eye_r'), mg(F.eyeAt), 'head');
  P('brow_l', F.lids.neutral, F.lidAt, 'head');
  P('brow_r', mirrorPart(F.lids.neutral, 'brow_r'), mg(F.lidAt), 'head');
  P('coins', F.coins, F.coinsAt, 'head');
  P('scarf_tails', F.tails, J.tails, 'head');
  P('chain', buildSpecs(), J.chain, 'shell');
  P('arm_l', armL, J.shoulder, 'shell');
  P('fore_l', foreL, J.elbow, 'arm_l');
  P('arm_r', mirrorPart(armL, 'arm_r'), mg(J.shoulder), 'shell');
  P('fore_r', foreR, mg(J.elbow), 'arm_r');
  P('cane', mirrorPart(buildCane(), 'cane'), mg(J.hand), 'fore_r');
  P('bells', mirrorPart(buildBells(), 'bells'), [-16.6, 29.5, 6.5], 'cane');
  P('leg_l', legL, J.hip, 'shell');
  P('leg_r', mirrorPart(legL, 'leg_r'), mg(J.hip), 'shell');
  P('tail', buildTail(), J.tail, 'shell');
  P('pouch_1', buildPouch(1), [12.8, 26.5, -9], 'shell');
  P('pouch_2', buildPouch(2), [7, 20.5, -15.5], 'shell');
  P('pouch_3', buildPouch(3), [-8.5, 26, -15], 'shell');
  P('lantern', buildLantern(), [-13.5, 32.5, -8], 'shell');
  P('beads', buildBeads(), [0, 37.5, 3.5], 'shell');
  P('kettle', buildKettle(), [9.6, 57.4, -15.8], 'shell');
  P('ristra', buildRistra(), [-10, 57.4, -16], 'shell');
  P('scale', buildScale(), [0, 57.2, -17], 'shell');
  // ---- the 1/72 detail re-cut (see recut / fineShell / fineSkin / fineEye)
  const lidClosed = F.lids.closed, lidSquint = F.lids.squint;
  const lidClosedR = mirrorPart(lidClosed, 'brow_r'), lidSquintR = mirrorPart(lidSquint, 'brow_r');
  const taken = new Set<number>();
  for (const m of [...parts.map((p) => p.model), lidClosed, lidSquint, lidClosedR, lidSquintR]) m.forEach((x, y, z) => taken.add(KEY(x, y, z)));
  const fine = new Map<VoxelModel, VoxelModel>();
  const up = (m: VoxelModel) => {
    let o = fine.get(m);
    if (!o) {
      o = recut(m, taken);
      fine.set(m, o);
    }
    return o;
  };
  const x2 = (p: V3): V3 => [p[0] * RES, p[1] * RES, p[2] * RES];
  const byName: Record<string, VoxelModel> = {};
  for (const p of parts) {
    if (p.name === 'eye_r') continue;
    p.model = up(p.model);
    byName[p.name] = p.model;
  }
  fineShell(byName.shell);
  fineSkin(byName.neck, 'neck');
  fineSkin(byName.head, 'head');
  fineSkin(byName.jaw, 'head');
  for (const n of ['arm_l', 'arm_r', 'fore_l', 'fore_r', 'leg_l', 'leg_r', 'tail']) if (byName[n]) fineSkin(byName[n], 'limb');
  fineEye(byName.eye_l, byName.head, F.eyeAt);
  const eyeR = mirrorFine(byName.eye_l, 'eye_r');
  eyeRim(eyeR, byName.head);
  for (const p of parts) {
    if (p.name === 'eye_r') p.model = eyeR;
    p.pivot = x2(p.pivot);
    p.attach = x2(p.attach);
    // worn edges, crease grime and dust (the eyes stay glossy and exact)
    if (p.name !== 'eye_l' && p.name !== 'eye_r') weather(p.model, { seed: p.name.length, edge: 0.12, cavity: 0.18, dust: 0.08, scuffs: 0.25, stains: 0, dirtFrom: 0, dirtTo: p.name.startsWith('leg') ? 10 : 0, dirt: 0.3 });
  }
  const VSF = VS / RES;
  const v = (p: V3) => [p[0] * VS, p[1] * VS, p[2] * VS] as [number, number, number];
  const sock = (part: string, at: V3): SocketSpec => ({ part, at: x2(at) });
  let topY = 0;
  for (const p of parts) p.model.forEach((_x, y) => { if (y + 1 > topY) topY = y + 1; });
  // expressions: real lid alternates (droopy / squint / happy-closed), lids pulled away for wide eyes
  const lidPair = (l: VoxelModel, r: VoxelModel) => ({ brow_l: up(l), brow_r: up(r) });
  const expressions = defaultExpressions(TORTOISE_EXPRESSIONS);
  expressions.laugh = { ...expressions.laugh, parts: lidPair(lidClosed, lidClosedR) };
  expressions.squinty = { ...expressions.squinty, parts: lidPair(lidSquint, lidSquintR) };
  expressions.surprised = { ...expressions.surprised, hide: ['brow_l', 'brow_r'] };
  expressions.scared = { ...expressions.scared, hide: ['brow_l', 'brow_r'] };
  return {
    name: 'tortoise_merchant',
    voxelSize: VSF,
    parts,
    sockets: {
      hand_r: sock('fore_r', mg(J.hand)),
      hand_l: sock('fore_l', J.hand),
      head_top: sock('head', [0, 55, 6]),
      mouth: sock('jaw', [0, 44.5, 14]),
      eye_l: sock('head', F.eyeAt),
      eye_r: sock('head', mg(F.eyeAt)),
      chest: sock('shell', [0, 30, 4]),
      back: sock('shell', [0, 30, -18]),
      lantern_hook: sock('shell', [-13.5, 32.5, -8]),
    },
    meta: {
      height: topY * VSF,
      radius: 0.45,
      // local offsets (metres, parent space) that pull each part INSIDE the shell
      retract: {
        neck: v([0, -11, -10]),
        arm_l: v([-4.5, 1, -4]),
        arm_r: v([4.5, 1, -4]),
        leg_l: v([-1, 8.5, -1.5]),
        leg_r: v([1, 8.5, -1.5]),
        tail: v([0, 2.5, 3.5]),
      },
      /** how far the shell sinks (metres) once the legs are pulled in, so she rests on the ground */
      shellDrop: 8 * VS,
      /** parts that should swing / jingle (secondary motion) */
      swing: ['coins', 'chain', 'scarf_tails', 'bells', 'pouch_1', 'pouch_2', 'pouch_3', 'lantern', 'beads', 'kettle', 'ristra', 'scale'],
      facePivots: { eye_l: v(F.eyeAt), eye_r: v(mg(F.eyeAt)), brow_l: v(F.lidAt), brow_r: v(mg(F.lidAt)), jaw: v(J.jaw) },
      eyes: 'voxel',
      expressions,
    },
  };
}
