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
// GRID: 1/36 m, origin on the ground between the feet, faces +Z, LEFT = +X,
// even-width symmetry (voxel x mirrors to -1 - x, geometric gx to -gx).
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, SocketSpec, V3 } from '../../../engine/voxel/Rig';
import { defaultExpressions } from '../toon/humanoid';
import { lump, tube } from './organic';
import { noise } from '../../../engine/math/rand';

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
const CARA = { base: 0x8a6a3a, ring: 0x9c7a46, seam: 0x4a3520, bleach: 0xb59360, chip: 0xc9a46c, paintR: 0xb04a32, paintW: 0xe8dcc0 };
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
  if (v > 0.55 && ring) return CARA.bleach;
  return ring ? CARA.ring : CARA.base;
}

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

// ================================================================== RIG
export function tortoiseLadyRig(): RigSpec {
  const parts: PartSpec[] = [];
  const P = (name: string, model: VoxelModel, joint: V3, parent?: string) => {
    if (model.count > 0) parts.push({ name, model, pivot: joint, attach: joint, parent });
  };
  const F = buildFace();
  const armL = buildArm();
  const foreL = buildForearm(false);
  const foreR = mirrorPart(buildForearm(true), 'fore_r');
  const legL = buildLeg();
  P('shell', buildShell(), J.shell);
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
  const v = (p: V3) => [p[0] * VS, p[1] * VS, p[2] * VS] as [number, number, number];
  const sock = (part: string, at: V3): SocketSpec => ({ part, at });
  let topY = 0;
  for (const p of parts) p.model.forEach((_x, y) => { if (y + 1 > topY) topY = y + 1; });
  // expressions: real lid alternates (droopy / squint / happy-closed), lids pulled away for wide eyes
  const lidPair = (m: VoxelModel) => ({ brow_l: m, brow_r: mirrorPart(m, 'brow_r') });
  const expressions = defaultExpressions(TORTOISE_EXPRESSIONS);
  expressions.laugh = { ...expressions.laugh, parts: lidPair(F.lids.closed) };
  expressions.squinty = { ...expressions.squinty, parts: lidPair(F.lids.squint) };
  expressions.surprised = { ...expressions.surprised, hide: ['brow_l', 'brow_r'] };
  expressions.scared = { ...expressions.scared, hide: ['brow_l', 'brow_r'] };
  return {
    name: 'tortoise_merchant',
    voxelSize: VS,
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
      height: topY * VS,
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
      swing: ['coins', 'chain', 'scarf_tails', 'bells', 'pouch_1', 'pouch_2', 'pouch_3', 'lantern', 'beads'],
      facePivots: { eye_l: v(F.eyeAt), eye_r: v(mg(F.eyeAt)), brow_l: v(F.lidAt), brow_r: v(mg(F.lidAt)), jaw: v(J.jaw) },
      eyes: 'voxel',
      expressions,
    },
  };
}
