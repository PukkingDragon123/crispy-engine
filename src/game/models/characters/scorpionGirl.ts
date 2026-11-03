// Serket's spirit avatar, the scorpion girl: the goddess come up out of the sand
// as a figure of jade-and-gold light. A slender, stylised young woman (not chibi)
// in an Egyptian tripartite wig with straight-cut bangs, a gold diadem crowned by
// a gold scorpion, a broad bead collar (wesekh), a gold-trimmed bodice, scorpion
// chitin gauntlets that end in working pincers over gold-taloned hands, and a long
// flared skirt of spirit-cloth that trails into glowing wisps instead of feet (she
// floats). A segmented scorpion tail rises from the small of her back, arcs over
// her right shoulder and hangs a glowing venom stinger above it.
//
// Everything that moves is its own part: the back hair (3-link chain), both front
// wig locks, both sashes (3 links each), the apron (3 links), the 8-segment tail
// and the stinger, arms / forearms / hands, both pincer jaws, the jaw, brows,
// blinking lids and modelled eyes (glowing gold irises with slit pupils and a wet
// catch-light; no 2D eyes).
//
// GRID: 1/48 m, origin on the ground under her, faces +Z, LEFT = +X. Voxel x
// mirrors to -x (a geometric / pivot x mirrors to 1 - x). Parts are authored in
// shared rig space, so every pivot equals its attach point.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, SocketSpec, V3, ExpressionSpec } from '../../../engine/voxel/Rig';
import { lump, tube } from './organic';
import { autoShade } from '../toon/humanoid';
import type { Ramp } from '../style';
import { noise, hash3 } from '../../../engine/math/rand';

export const SERKET_GIRL_VS = 1 / 48;
const VS = SERKET_GIRL_VS;
const GL = VF.GLOW, EM = VF.EMISSIVE, MT = VF.METAL, SOFT = VF.SOFTAO;

// ------------------------------------------------------------------ palette (clean regions for the cel ramp)
const SKIN = { base: 0x86e2c0, shade: 0x5cbf9d, hi: 0xc2f9e4, dark: 0x2e8a70, blush: 0xb4f0d2 };
const GOLD: Ramp = { base: 0xf0c24a, shade: 0xc28c28, hi: 0xffe592, dark: 0x7c5414 };
const LAPIS: Ramp = { base: 0x2f5cc2, shade: 0x22459c, hi: 0x5c88e8, dark: 0x16306e };
const CARN = 0xd2482c;
const CLOTH = { base: 0xdcfbef, shade: 0xa4e4cf, hi: 0xffffff, dark: 0x66bba0, glow: 0x9dffd8 };
const HAIR = { base: 0x1c4c47, shade: 0x133633, hi: 0x3c8e80, dark: 0x0c2422, glow: 0x6ff2cc };
const CHIT = { base: 0x2f9e80, shade: 0x1f705a, hi: 0x74dcbc, dark: 0x134a3c, belly: 0xa6ecd2 };
const VENOM = { base: 0xb6ff58, core: 0xecffb4 };
const EYE = { sclera: 0xf2fff8, scleraShade: 0xbfe6d8, iris: 0xffbf36, irisDeep: 0xd8820e, irisLow: 0xffe27a, pupil: 0x170c06, glint: 0xffffff, kohl: 0x0f1210, kohlSoft: 0x24564a };
const LIP = { base: 0x2c8a70, hi: 0x56b898 };
const MOUTH = 0x1a0d10;
const GOLD_R: Ramp = GOLD;
const HAIR_R: Ramp = { base: HAIR.base, shade: HAIR.shade, hi: HAIR.hi, dark: HAIR.dark };
const CLOTH_R: Ramp = { base: CLOTH.base, shade: CLOTH.shade, hi: CLOTH.hi, dark: CLOTH.dark };
const SKIN_R: Ramp = { base: SKIN.base, shade: SKIN.shade, hi: SKIN.hi, dark: SKIN.dark };

// ------------------------------------------------------------------ joints (geometric, rig space, LEFT side)
const J = {
  pelvis: [0.5, 54, 0.5] as V3,
  waist: [0.5, 59, 0.5] as V3,
  neck: [0.5, 80.5, 0.5] as V3,
  jaw: [0.5, 86.5, 0.5] as V3,
  lock: [8.2, 88.5, 1.5] as V3,
  hair1: [0.5, 95, -6.5] as V3,
  hair2: [0.5, 81, -9] as V3,
  hair3: [0.5, 67, -10] as V3,
  shoulder: [12.5, 75, 0.5] as V3,
  elbow: [15.4, 60.5, 0] as V3,
  wrist: [16.6, 47.6, 1.5] as V3,
  claw: [18.6, 47.5, 3.4] as V3,
  sash: [11.5, 71.5, -5.5] as V3,
  sash2: [16, 64.5, -12] as V3,
  sash3: [19.2, 53, -17.5] as V3,
  apron: [0.5, 52, 9] as V3,
  apron2: [0.5, 40, 10.8] as V3,
  apron3: [0.5, 26, 12.9] as V3,
};
/** the tail joints: out of the small of the back, down, then up and over her right shoulder */
const TJ: V3[] = [
  [0.5, 53, -7.5],
  [-0.5, 46.5, -17.5],
  [-1.5, 48, -28.5],
  [-2.5, 56.5, -38],
  [-3.5, 70.5, -43],
  [-4.5, 85.5, -42.5],
  [-5.5, 99.5, -36.5],
  [-7.5, 110.5, -26.5],
  [-9.5, 116.5, -14.5],
];
const TR = [5.0, 4.7, 4.4, 4.1, 3.8, 3.5, 3.2, 2.9, 2.7];

// ------------------------------------------------------------------ helpers
const mg = (p: V3): V3 => [1 - p[0], p[1], p[2]];
type Paint = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number | null;

function mirrorPart(src: VoxelModel, name: string) {
  const o = new VoxelModel(name);
  src.forEach((x, y, z, c, f) => o.set(-x, y, z, c, f));
  return o;
}
/** keep the +x half (and the centre column) and mirror it onto -x: a perfectly symmetric form */
function symm(m: VoxelModel) {
  m.carveWhere((x) => x < 0);
  const add: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (x > 0) add.push([-x, y, z, c, f]);
  });
  for (const [x, y, z, c, f] of add) m.set(x, y, z, c, f);
  return m;
}
function frontZ(m: VoxelModel, x: number, y: number) {
  for (let z = 40; z >= -40; z--) if (m.has(x, y, z)) return z;
  return -999;
}
function topY(m: VoxelModel, x: number, z: number, y0: number, y1: number) {
  for (let y = y1; y >= y0; y--) if (m.has(x, y, z)) return y;
  return -999;
}
const exposed = (m: VoxelModel, x: number, y: number, z: number) =>
  !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z) || !m.has(x, y - 1, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);

/** a relief ring: every outer voxel of row y gets a voxel one step out from the axis (cx, cz) */
function ringOut(m: VoxelModel, y: number, cx: number, cz: number, col: (x: number, z: number, a: number) => [number, number] | null) {
  const row: [number, number][] = [];
  m.forEach((x, yy, z) => {
    if (yy === y && (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1))) row.push([x, z]);
  });
  for (const [x, z] of row) {
    const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
    const l = Math.hypot(dx, dz) || 1;
    const c = col(x, z, Math.atan2(dx, dz));
    if (!c) continue;
    const ox = x + Math.round(dx / l), oz = z + Math.round(dz / l);
    if (!m.has(ox, y, oz)) m.set(ox, y, oz, c[0], c[1]);
    m.set(x, y, z, c[0], c[1]);
  }
}

/**
 * A ribbon of cloth along a bent path: width runs horizontally across the path
 * (twisting slowly), one voxel thick, tapering from w0 to w1 half-widths.
 * `col(s, u, step)` gets the path fraction, the signed width fraction and the step index.
 */
function ribbon(m: VoxelModel, pts: V3[], w0: number, w1: number, col: (s: number, u: number, k: number) => [number, number] | null, o: { twist?: number; across?: V3 } = {}) {
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    seg.push(d);
    total += d;
  }
  const steps = Math.ceil(total / 0.3);
  for (let k = 0; k <= steps; k++) {
    const s = k / steps;
    let d = s * total, i = 0;
    while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
    const t = Math.min(1, d / seg[i]);
    const a = pts[i], b = pts[i + 1];
    const c: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const dir: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const dl = Math.hypot(...dir) || 1;
    dir[0] /= dl;
    dir[1] /= dl;
    dir[2] /= dl;
    // width axis: horizontal, across the path (or a given axis), twisted about the path
    let wx: number, wy: number, wz: number;
    if (o.across) [wx, wy, wz] = o.across;
    else {
      wx = dir[2];
      wy = 0;
      wz = -dir[0];
      const wl = Math.hypot(wx, wz);
      if (wl < 0.2) [wx, wy, wz] = [1, 0, 0];
      else {
        wx /= wl;
        wz /= wl;
      }
    }
    const tw = (o.twist ?? 0) * s;
    if (tw) {
      // rotate the width axis about the path direction (Rodrigues)
      const cs = Math.cos(tw), sn = Math.sin(tw);
      const cx = dir[1] * wz - dir[2] * wy, cy = dir[2] * wx - dir[0] * wz, cz = dir[0] * wy - dir[1] * wx;
      const dot = dir[0] * wx + dir[1] * wy + dir[2] * wz;
      wx = wx * cs + cx * sn + dir[0] * dot * (1 - cs);
      wy = wy * cs + cy * sn + dir[1] * dot * (1 - cs);
      wz = wz * cs + cz * sn + dir[2] * dot * (1 - cs);
    }
    const hw = w0 + (w1 - w0) * s;
    for (let w = -hw; w <= hw + 1e-6; w += 0.35) {
      const cc = col(s, hw > 0 ? w / hw : 0, k);
      if (!cc) continue;
      m.set(Math.floor(c[0] + wx * w), Math.floor(c[1] + wy * w), Math.floor(c[2] + wz * w), cc[0], cc[1]);
    }
  }
  return m;
}

// ================================================================== PELVIS (root): hips, belt, the bell skirt, wisps
const hipF = (y: number) => {
  const ny = Math.abs((y + 0.5 - 53.5) / 6.0);
  return ny >= 1 ? 0 : Math.pow(1 - Math.pow(ny, 2.3), 1 / 2.3);
};
const skirtR = (y: number) => {
  const k = 52 - y;
  return [9.9 + k * 0.17, 7.7 + k * 0.145];
};
/** the hem: irregular, longer behind (she trails her light) */
const hemY = (th: number) => 6 + 4 * (0.5 + 0.5 * Math.cos(th)) + 2.6 * noise.n2(th * 1.7 + 4.1, 2.3) + 1.2 * Math.sin(th * 5 + 0.7);

function buildPelvis() {
  const m = new VoxelModel('pelvis');
  lump(m, [0.5, 53.5, 0], [9.6, 6.0, 7.2], (_x, _y, _z, _nx, ny) => (ny < -0.6 ? SKIN.shade : SKIN.base), { wobble: 0.04, seed: 3, power: 2.3 });
  // the skirt: a flared bell of spirit-cloth with deep folds, a lapis-and-gold border and a hem that burns into light
  for (let y = 3; y <= 52; y++) {
    const [rx, rz] = skirtR(y);
    const k = 52 - y;
    const steps = Math.ceil(Math.PI * 2 * rx * 1.7);
    for (let s = 0; s < steps; s++) {
      const th = (s / steps) * Math.PI * 2;
      const hem = Math.max(3, Math.round(hemY(th)));
      if (y < hem) continue;
      const wave = Math.sin(th * 9 + k * 0.07 + Math.sin(th * 2) * 0.6);
      const fold = 1 + 0.07 * wave * Math.min(1, k / 10) + 0.025 * noise.n2(th * 3.3, y * 0.13);
      const dy = y - hem;
      const tile = Math.floor((th / (Math.PI * 2)) * 30);
      let col: number = wave < -0.45 ? CLOTH.shade : wave > 0.8 ? CLOTH.hi : CLOTH.base;
      let fl: number = SOFT;
      if (dy <= 0) [col, fl] = [CLOTH.glow, GL];
      else if (dy === 1) [col, fl] = [CLOTH.glow, EM];
      else if (dy === 3) [col, fl] = [GOLD.shade, MT];
      else if (dy === 4 || dy === 5) [col, fl] = [dy === 5 ? GOLD.hi : GOLD.base, MT];
      else if (dy === 6) [col, fl] = [tile % 3 === 0 ? CARN : tile % 3 === 1 ? LAPIS.base : LAPIS.hi, 0];
      else if (dy === 7) [col, fl] = [GOLD.shade, MT];
      for (let d = 0; d <= 1.21; d += 0.6) {
        const x = 0.5 + (rx * fold - d) * Math.sin(th), z = 0.2 + (rz * fold - d) * Math.cos(th);
        m.set(Math.floor(x), y, Math.floor(z), col, fl);
      }
    }
  }
  // wisps: the hem unravels into curling threads of light
  for (let i = 0; i < 12; i++) {
    const th = (i / 12) * Math.PI * 2 + 0.25 + (hash3(i, 3, 7) - 0.5) * 0.3;
    const hem = Math.max(3, Math.round(hemY(th)));
    const [rx, rz] = skirtR(hem);
    const x0 = 0.5 + rx * Math.sin(th), z0 = 0.2 + rz * Math.cos(th);
    const len = Math.min(hem - 0.5, 4 + hash3(i, 9, 1) * 5);
    const out = 0.6 + hash3(i, 2, 5);
    const curl = (hash3(i, 4, 4) - 0.5) * 2.4;
    tube(m, [[x0, hem, z0], [x0 + Math.sin(th) * out, hem - len * 0.5, z0 + Math.cos(th) * out], [x0 + Math.sin(th + curl) * out * 1.8, hem - len, z0 + Math.cos(th + curl) * out * 1.8]], 1.15, 0.45, () => CLOTH.glow, { flags: GL, wobble: 0.1, seed: i });
  }
  // the belt: gold plates with lapis and carnelian inlays, hugging the hips
  const steps = 300;
  for (let s = 0; s < steps; s++) {
    const th = (s / steps) * Math.PI * 2;
    const seg = Math.floor((th / (Math.PI * 2)) * 32);
    for (let y = 53; y <= 56; y++) {
      const f = hipF(y);
      const rx = 9.6 * f + 0.75, rz = 7.2 * f + 0.75;
      const x = Math.floor(0.5 + rx * Math.sin(th)), z = Math.floor(rz * Math.cos(th));
      const edge = y === 53 || y === 56;
      const inlay = !edge && seg % 2 === 0;
      m.set(x, y, z, edge ? (y === 56 ? GOLD.hi : GOLD.shade) : inlay ? (seg % 4 === 0 ? CARN : LAPIS.base) : GOLD.base, inlay ? 0 : MT);
    }
  }
  // the buckle: a little gold scorpion clasping a carnelian
  const bz = Math.round(7.2 * hipF(54.5) + 1.2);
  lump(m, [0.5, 55, bz + 0.6], [2.7, 2.2, 1.1], (_x, _y, _z, _nx, ny) => (ny > 0.5 ? GOLD.hi : GOLD.base), { wobble: 0, power: 2.2, flags: MT });
  m.set(0, 55, bz + 2, CARN, GL).set(0, 54, bz + 2, CARN, EM);
  for (const s of [1, -1]) {
    m.set(s * 3, 56, bz + 1, GOLD.base, MT).set(s * 4, 57, bz + 1, GOLD.shade, MT); // claws reaching up
    m.set(s * 3, 53, bz + 1, GOLD.shade, MT); // legs
  }
  autoShade(m, [GOLD_R], { hi: false });
  return m;
}

// ================================================================== TORSO: waist, ribs, bust under the bodice, shoulders, neck, collar
function buildTorso() {
  const m = new VoxelModel('torso');
  const skin: Paint = (_x, _y, _z, _nx, ny, nz) => (ny < -0.7 && nz > -0.5 ? SKIN.shade : SKIN.base);
  lump(m, [0.5, 60.4, 0.3], [6.9, 4.9, 5.3], skin, { wobble: 0.03, seed: 21, power: 2.2 });
  lump(m, [0.5, 68.6, -0.3], [8.7, 8.3, 6.2], skin, { wobble: 0.03, seed: 22, power: 2.35 });
  lump(m, [11.1, 73.9, -0.4], [3.9, 3.3, 3.8], skin, { wobble: 0.03, seed: 23 });
  lump(m, [4.6, 69.2, 3.4], [3.7, 3.1, 2.9], (_x, _y, _z, _nx, ny) => (ny < -0.55 ? CLOTH.shade : CLOTH.base), { wobble: 0.02, seed: 24, power: 2.0 });
  tube(m, [[0.5, 74, -0.9], [0.5, 78, -0.4], [0.5, 82.5, 0.2]], 2.9, 2.35, () => SKIN.base, { wobble: 0.03 });
  symm(m);
  // the bodice: a band of spirit-cloth wrapped around the bust, gold-edged
  const bod: [number, number, number][] = [];
  m.forEach((x, y, z) => {
    if (y >= 64 && y <= 71 && exposed(m, x, y, z) && Math.hypot(x, z + 1) > 4.5) bod.push([x, y, z]);
  });
  for (const [x, y, z] of bod) m.set(x, y, z, y === 64 ? CLOTH.shade : CLOTH.base, SOFT);
  ringOut(m, 64, 0.5, 0, () => [GOLD.base, MT]);
  // clasp at the breastbone: carnelian in a gold lozenge
  {
    const z = frontZ(m, 0, 67);
    for (const [x, y] of [[0, 66], [0, 68], [1, 67], [-1, 67]]) m.set(x, y, frontZ(m, x, y) + 1, GOLD.base, MT);
    m.set(0, 67, z + 1, CARN, GL);
  }
  // navel
  m.paintAt(0, 60, frontZ(m, 0, 60), SKIN.dark);
  // the wesekh: concentric rows of gold, lapis, gold, jade and carnelian drops around the neck
  const COL = [GOLD.base, LAPIS.base, GOLD.hi, CHIT.hi, LAPIS.shade];
  const collar = (x: number, y: number): [number, number] | null => {
    const rc = Math.hypot(x, (y - 80.5) * 1.12);
    if (rc < 4.6 || rc > 11.6 || y > 78) return null;
    const band = Math.min(4, Math.floor((rc - 4.6) / 1.4));
    if (band === 4) return x % 2 === 0 ? [CARN, 0] : [GOLD.shade, MT];
    const c = COL[band];
    return [c, c === GOLD.base || c === GOLD.hi ? MT : 0];
  };
  for (let x = -12; x <= 12; x++)
    for (let y = 68; y <= 79; y++) {
      const c = collar(x, y);
      if (!c) continue;
      const z = frontZ(m, x, y);
      if (z < -900 || z < -1) continue;
      m.set(x, y, z + 1, c[0], c[1]);
      // carnelian drops hang one voxel below the outer row
      if (c[0] === CARN && !collar(x, y - 1)) m.set(x, y - 1, frontZ(m, x, y - 1) + 1, CARN, EM);
    }
  // the collar rides over the tops of the shoulders too
  for (let x = 4; x <= 12; x++)
    for (let z = -4; z <= 3; z++) {
      const y = topY(m, x, z, 70, 79);
      if (y < 0) continue;
      const c = collar(x, y);
      if (!c) continue;
      m.set(x, y + 1, z, c[0], c[1]).set(-x, y + 1, z, c[0], c[1]);
    }
  autoShade(m, [GOLD_R, CLOTH_R, SKIN_R]);
  return m;
}

// ================================================================== HEAD: face, modelled eyes, wig, diadem, scorpion crest
function buildHead() {
  const head = new VoxelModel('head');
  lump(head, [0.5, 93.3, -0.6], [7.5, 8.6, 8.1], () => SKIN.base, { wobble: 0.02, seed: 31, power: 2.3 });
  lump(head, [0.5, 88.3, 1.6], [6.5, 6.4, 6.1], () => SKIN.base, { wobble: 0.02, seed: 32, power: 2.6 });
  lump(head, [0.5, 84.9, 3.0], [3.9, 3.1, 3.9], () => SKIN.base, { wobble: 0.02, seed: 33, power: 2.0 });
  symm(head);
  // the face surface before any feature is cut (z of the front-most voxel per column)
  const ZS = new Map<number, number>();
  for (let x = -10; x <= 10; x++) for (let y = 78; y <= 104; y++) ZS.set(x * 1000 + y, frontZ(head, x, y));
  const Z = (x: number, y: number) => ZS.get(x * 1000 + y) ?? -999;

  // ---- eyes: almond, glowing gold irises, a vertical slit pupil, one wet catch-light (same side in both eyes)
  const E = EYE;
  const EYE_L: Record<string, [number, number]> = {
    '3,92': [E.scleraShade, 0], '4,92': [E.irisDeep, GL], '5,92': [E.irisDeep, GL], '6,92': [E.scleraShade, 0],
    '2,91': [E.sclera, 0], '3,91': [E.iris, GL], '4,91': [E.pupil, 0], '5,91': [E.glint, GL], '6,91': [E.sclera, 0],
    '2,90': [E.scleraShade, 0], '3,90': [E.iris, GL], '4,90': [E.pupil, 0], '5,90': [E.iris, GL], '6,90': [E.scleraShade, 0],
    '3,89': [E.scleraShade, 0], '4,89': [E.irisLow, GL], '5,89': [E.scleraShade, 0],
  };
  const eye_l = new VoxelModel('eye_l'), eye_r = new VoxelModel('eye_r');
  const lid_l = new VoxelModel('lid_l'), lid_r = new VoxelModel('lid_r');
  for (const [k, [c, f]] of Object.entries(EYE_L)) {
    const [x, y] = k.split(',').map(Number);
    const z = Z(x, y);
    head.del(x, y, z).del(-x, y, z);
    eye_l.set(x, y, z, c, f);
    const src = y === 91 && (x === 3 || x === 5) ? EYE_L[`${8 - x},91`] : [c, f];
    eye_r.set(-x, y, z, src[0], src[1]);
    // lids (shown while blinking): skin over the eye, the lash line along its lower edge
    const low = !EYE_L[`${x},${y - 1}`];
    lid_l.set(x, y, z + 1, low ? E.kohl : SKIN.base);
    lid_r.set(-x, y, z + 1, low ? E.kohl : SKIN.base);
  }
  const eyeZ = Z(4, 90);
  /** set a voxel on the original face surface (dz in front of it); silently skips columns the face doesn't reach */
  const put = (x: number, y: number, dz: number, c: number, f = 0) => {
    const z = Z(Math.abs(x), y);
    if (z > -900) head.set(x, y, z + dz, c, f);
  };
  for (const s of [1, -1]) {
    // upper lash line overhangs the eye; the kohl wing flicks out to the temple; a soft lower liner
    for (let x = 2; x <= 6; x++) put(s * x, 93, 1, E.kohl);
    put(s * 7, 92, 1, E.kohl);
    put(s * 7, 93, 0, E.kohl);
    put(s * 8, 94, 0, E.kohl);
    put(s * 1, 91, 0, E.kohl);
    for (let x = 3; x <= 6; x++) put(s * x, 88, 0, E.kohlSoft);
    put(s * 7, 89, 0, E.kohlSoft);
    // soft blush on the cheeks
    for (const [x, y] of [[5, 87], [6, 87], [6, 88]]) put(s * x, y, 0, SKIN.blush);
  }
  // ---- brows: thin dark arcs (their own parts so expressions can tilt them)
  const brow_l = new VoxelModel('brow_l');
  for (const [x, y] of [[2, 95], [3, 95], [4, 96], [5, 96], [6, 95]]) {
    const z = Z(x, y);
    head.del(x, y, z);
    brow_l.set(x, y, z, HAIR.base);
  }
  const brow_r = mirrorPart(brow_l, 'brow_r');
  brow_r.forEach((x, y, z) => head.del(x, y, z));
  const browZ = Z(4, 95);
  // ---- nose: a single ridge with a lit bridge and a shaded tip
  put(0, 89, 0, SKIN.hi);
  put(0, 88, 1, SKIN.base);
  put(0, 87, 1, SKIN.shade);
  put(0, 86, 0, SKIN.shade);
  // ---- lips: a darker jade cupid's bow above, a fuller lit lower lip below (on the jaw)
  for (let x = -2; x <= 2; x++) put(x, 85, 0, LIP.base);
  for (const s of [1, -1]) put(s * 3, 85, 0, SKIN.shade);
  for (let x = -1; x <= 1; x++) put(x, 84, 0, LIP.hi);
  for (const s of [1, -1]) put(s * 2, 84, 0, LIP.base);
  // ---- the forehead jewel: a tiny glowing lozenge of gold around a carnelian
  for (const [x, y] of [[0, 94], [0, 96], [1, 95], [-1, 95]]) put(x, y, 0, GOLD.hi, GL);
  put(0, 95, 0, CARN, GL);

  // ---- jaw: chin + lower lip, hinged far back so a small rotation parts the lips
  const jaw = new VoxelModel('jaw');
  head.forEach((x, y, z, c, f) => {
    if (y <= 84 && z >= 3 && Math.abs(x) <= 4) jaw.set(x, y, z, c, f);
  });
  jaw.forEach((x, y, z) => head.del(x, y, z));
  if (Z(0, 82) >= 3) jaw.set(0, 82, Z(0, 82), SKIN.hi);
  // the mouth's dark interior, only seen when the jaw drops
  for (let x = -3; x <= 3; x++) {
    for (let y = 82; y <= 84; y++) for (let z = 0; z <= 2; z++) if (head.has(x, y, z)) head.set(x, y, z, MOUTH);
    if (Z(x, 85) > -900) head.set(x, 85, Z(x, 85) - 1, MOUTH);
  }

  // ---- the tripartite wig: dark jade-black hair over the whole cranium except the face, with volume at the sides
  const C: V3 = [0.5, 93.3, -0.6];
  // the face opening (the temples stay bare so the kohl wings read)
  const isFace = (x: number, y: number, z: number) => (z >= 0 && Math.abs(x) <= 6 && y <= 96) || (z >= 2 && Math.abs(x) <= 8 && y >= 86 && y <= 95);
  const hairCol = (x: number, y: number, z: number) => {
    const a = Math.atan2(x + 0.5 - C[0], z + 0.5 - C[2]);
    const strand = Math.floor((a / Math.PI) * 22 + 40) % 2;
    if (y === 100 || y === 101) return strand ? HAIR.hi : HAIR.base; // the anime "angel ring" highlight
    return strand ? HAIR.shade : HAIR.base;
  };
  const scalp: [number, number, number][] = [];
  head.forEach((x, y, z) => {
    if (y >= 83 && !isFace(x, y, z) && exposed(head, x, y, z)) scalp.push([x, y, z]);
  });
  for (const [x, y, z] of scalp) {
    head.set(x, y, z, hairCol(x, y, z));
    const dx = x + 0.5 - C[0], dy = y + 0.5 - C[1], dz = z + 0.5 - C[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    const layers = y <= 97 ? 2 : 1;
    for (let k = 1; k <= layers; k++) {
      const ox = x + Math.round((dx / l) * k), oy = y + Math.round((dy / l) * k * 0.6), oz = z + Math.round((dz / l) * k);
      if (!head.has(ox, oy, oz)) head.set(ox, oy, oz, hairCol(ox, oy, oz));
    }
  }
  // side panels of the wig fall to the jaw line, framing the face
  for (let y = 80; y <= 86; y++)
    for (let x = 6; x <= 9; x++)
      for (let z = -6; z <= 2; z++) {
        if (x === 9 && (z < -4 || z > 0)) continue;
        if (x === 6 && z > -1) continue;
        head.set(x, y, z, hairCol(x, y, z)).set(-x, y, z, hairCol(-x, y, z));
      }
  // the bangs: a straight Cleopatra cut, two voxels thick
  for (let x = -6; x <= 6; x++)
    for (let y = 97; y <= 101; y++) {
      const z = Z(x, y);
      if (z < -900) continue;
      const c = y === 97 ? HAIR.shade : (x & 1) === 0 ? HAIR.base : y >= 100 ? HAIR.hi : HAIR.shade;
      head.set(x, y, z + 1, c).set(x, y, z + 2, c);
    }
  // ---- the diadem: a gold band across the bangs and around the temples, a lapis cabochon at the front
  for (let y = 99; y <= 100; y++) {
    const pts: [number, number, number][] = [];
    head.forEach((x, yy, z) => {
      if (yy === y && z >= -3 && (!head.has(x, y, z + 1) || !head.has(x + Math.sign(x || 1), y, z))) pts.push([x, y, z]);
    });
    for (const [x, , z] of pts) {
      const dx = x + 0.5 - C[0], dz = z + 0.5 - C[2];
      const l = Math.hypot(dx, dz) || 1;
      const ox = x + Math.round(dx / l), oz = z + Math.round(dz / l);
      head.set(ox, y, oz, y === 100 ? GOLD.hi : GOLD.base, MT);
    }
  }
  {
    const z = frontZ(head, 0, 99);
    head.set(0, 99, z + 1, LAPIS.hi, MT).set(0, 100, z + 1, LAPIS.base, MT).set(1, 99, z, GOLD.hi, MT).set(-1, 99, z, GOLD.hi, MT);
  }
  // ---- the crest: Serket's own scorpion in gold, crouched on the crown, claws over the brow, tail arched high
  const crestTop = topY(head, 0, 0, 90, 110);
  const cy = crestTop + 1.4;
  lump(head, [0.5, cy, 1.0], [3.0, 1.6, 4.2], (_x, _y, _z, _nx, ny) => (ny > 0.4 ? GOLD.hi : GOLD.base), { wobble: 0, power: 2.2, flags: MT });
  for (const s of [1, -1]) {
    const sx = (v: number) => (s > 0 ? v : 1 - v);
    tube(head, [[sx(2.6), cy, 3.8], [sx(4.6), cy - 0.4, 6.8], [sx(3.4), cy - 1.0, 9.4]], 0.9, 0.7, () => GOLD.base, { flags: MT, wobble: 0 });
    head.set(Math.floor(sx(3.4)), Math.floor(cy - 1), 10, GOLD.hi, MT);
    for (const k of [2.2, 0.2, -1.8]) tube(head, [[sx(2.4), cy - 0.3, k], [sx(4.4), cy - 1.2, k + 0.4], [sx(5.0), cy - 2.6, k + 0.8]], 0.55, 0.5, () => GOLD.shade, { flags: MT, wobble: 0 });
  }
  tube(head, [[0.5, cy + 0.8, -2.5], [0.5, cy + 3.8, -4.6], [0.5, cy + 7.2, -4.2], [0.5, cy + 9.4, -1.6], [0.5, cy + 9.2, 1.2], [0.5, cy + 7.6, 2.6]], 1.5, 0.8, (_x, y) => ((y & 1) === 0 ? GOLD.base : GOLD.shade), { flags: MT, wobble: 0 });
  head.set(0, Math.floor(cy + 6.8), 3, CARN, GL).set(0, Math.floor(cy + 6.2), 3, CARN, GL);
  autoShade(head, [GOLD_R, HAIR_R], { under: false });
  return { head, jaw, eye_l, eye_r, lid_l, lid_r, brow_l, brow_r, eyeZ, browZ, crestTop: cy + 10 };
}

/** a front lock of the wig: falls in front of the shoulder, two gold rings and a gold cap with a glowing tip */
function buildLock() {
  const m = new VoxelModel('lock_l');
  const pts: V3[] = [[8.2, 88.5, 1.5], [9.6, 81, 3.5], [10.3, 74, 5.8], [10.4, 68.5, 6.6]];
  tube(m, pts, 2.1, 1.5, (x, y, z) => (y <= 69 ? (y <= 68 ? HAIR.glow : GOLD.base) : y === 72 || y === 73 || y === 77 ? GOLD.base : (x + z) % 2 === 0 ? HAIR.base : HAIR.shade), { wobble: 0.04, seed: 41 });
  m.forEach((x, y, z, c) => {
    if (c === GOLD.base) m.set(x, y, z, c, MT);
    if (c === HAIR.glow) m.set(x, y, z, c, GL);
  });
  return m;
}

/** the long back hair in three links: a sheet of strands that flares and ends in glowing tips */
function buildHair(link: 1 | 2 | 3) {
  const m = new VoxelModel('hair' + link);
  const y0 = link === 1 ? 96 : link === 2 ? 81 : 67;
  const y1 = link === 1 ? 81 : link === 2 ? 67 : 53;
  for (let i = -7; i <= 7; i++) {
    const spread = link === 3 ? 1.18 : link === 2 ? 1.06 : 0.96;
    const pts: V3[] = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      const y = y0 + (y1 - y0) * t;
      const sp = spread + (link === 3 ? t * 0.12 : 0);
      const x = 0.5 + i * sp + Math.sin(y * 0.28 + i * 1.3) * 0.5;
      const back = link === 1 ? -8.6 + Math.pow(Math.abs(i) / 8, 2) * 3.5 - t * 0.6 : link === 2 ? -9.4 - t * 0.9 : -10.3 - t * 1.6;
      pts.push([x, y, back - (link === 1 ? 0 : Math.pow(Math.abs(i) / 8, 2) * -1.2)]);
    }
    const tone = (i + 8) % 3;
    tube(m, pts, 1.15, link === 3 ? 0.8 : 1.05, (_x, y) => {
      if (link === 3 && (y === 59 || y === 60)) return GOLD.base;
      if (link === 3 && y <= 55) return HAIR.glow;
      if (link === 3 && y <= 57) return HAIR.hi;
      return tone === 0 ? HAIR.shade : tone === 1 ? HAIR.base : (y & 3) === 0 ? HAIR.hi : HAIR.base;
    }, { wobble: 0.06, seed: 50 + i + link * 20 });
  }
  m.forEach((x, y, z, c) => {
    if (c === GOLD.base) m.set(x, y, z, c, MT);
    else if (c === HAIR.glow) m.set(x, y, z, c, GL);
    else if (c === HAIR.hi && link === 3 && y <= 57) m.set(x, y, z, c, EM);
  });
  return m;
}

// ================================================================== ARMS: upper arm (armlet), forearm (chitin gauntlet + fixed jaw), hand (talons), movable jaw
function buildUpperArm() {
  const m = new VoxelModel('arm_l');
  const axis = (y: number): [number, number] => {
    const t = (75 - y) / 15;
    return [12.5 + (15.4 - 12.5) * t, 0.3 - 0.5 * t];
  };
  tube(m, [[12.5, 75, 0.3], [13.7, 68, 0.1], [15.4, 60.5, -0.2]], 3.1, 2.3, (_x, _y, _z, _g, ny) => (ny < -0.6 ? SKIN.shade : SKIN.base), { wobble: 0.04, seed: 61 });
  lump(m, [12.8, 73.4, 0.2], [3.4, 3.6, 3.4], () => SKIN.base, { wobble: 0.03, seed: 62 });
  // the armlet: a gold band with a lapis stone on the outside
  for (const y of [66, 67]) {
    const [cx, cz] = axis(y);
    ringOut(m, y, cx, cz, (x, _z, a) => (y === 66 && Math.abs(a - Math.PI / 2) < 0.5 && x > cx ? [LAPIS.hi, MT] : [y === 67 ? GOLD.hi : GOLD.base, MT]));
  }
  // a thin spiral of light winding down the arm: Serket's mark
  for (let k = 0; k <= 40; k++) {
    const y = 72 - k * 0.2;
    if (y < 68) break;
    const [cx, cz] = axis(y);
    const a = k * 0.42;
    const x = Math.floor(cx + Math.sin(a) * 3.2), z = Math.floor(cz + Math.cos(a) * 3.2);
    if (m.has(x, Math.floor(y), z)) m.set(x, Math.floor(y), z, CLOTH.glow, GL);
  }
  for (let k = 0; k <= 30; k++) {
    const y = 65 - k * 0.2;
    const [cx, cz] = axis(y);
    const a = k * 0.42 + 1.4;
    const x = Math.floor(cx + Math.sin(a) * 2.8), z = Math.floor(cz + Math.cos(a) * 2.8);
    if (m.has(x, Math.floor(y), z)) m.set(x, Math.floor(y), z, CLOTH.glow, GL);
  }
  return m;
}

/** a scorpion-carapace pauldron on the LEFT shoulder only (she is not symmetric) */
function pauldron(m: VoxelModel) {
  for (let k = 0; k < 3; k++) {
    const cy = 77.4 - k * 2.0;
    lump(m, [13.1 + k * 0.7, cy, 0.2], [4.7 - k * 0.3, 1.9, 4.5 - k * 0.25], (_x, y, _z, _nx, ny) => (y < cy - 0.6 ? null : ny < -0.1 ? GOLD.base : ny > 0.6 ? CHIT.hi : CHIT.base), { wobble: 0.02, seed: 70 + k, power: 2.1, shell: 0.5 });
  }
  m.forEach((x, y, z, c) => {
    if (c === GOLD.base) m.set(x, y, z, c, MT);
  });
  tube(m, [[14.2, 76.4, 3.4], [15.6, 76.2, 5.2], [15.2, 75.4, 6.6]], 0.9, 0.55, () => GOLD.hi, { flags: MT, wobble: 0 });
  tube(m, [[15.6, 74.4, 2.4], [17.2, 73.8, 3.6], [17.0, 73.0, 4.8]], 0.8, 0.5, () => GOLD.base, { flags: MT, wobble: 0 });
}

function buildForearm() {
  const m = new VoxelModel('fore_l');
  const A: V3 = [15.4, 60.5, -0.2], B: V3 = [16.6, 47.6, 1.5];
  const axis = (y: number): [number, number] => {
    const t = (A[1] - y) / (A[1] - B[1]);
    return [A[0] + (B[0] - A[0]) * t, A[2] + (B[2] - A[2]) * t];
  };
  tube(m, [A, [16.1, 54, 0.6], B], 2.4, 1.9, () => SKIN.base, { wobble: 0.03, seed: 81 });
  // the gauntlet: three flared chitin bracers, each with a gold lip, stacked like a scorpion's tail
  for (let k = 0; k < 3; k++) {
    const yTop = 58 - k * 3.4, yBot = yTop - 3.5;
    for (let y = Math.floor(yBot); y <= Math.floor(yTop); y++) {
      const [cx, cz] = axis(y);
      const t = (y - yBot) / (yTop - yBot);
      const R = 2.25 - (2.25 - 1.95) * ((A[1] - y) / (A[1] - B[1])) + 0.9 + 0.75 * t;
      for (let x = Math.floor(cx - R - 1); x <= Math.ceil(cx + R + 1); x++)
        for (let z = Math.floor(cz - R - 1); z <= Math.ceil(cz + R + 1); z++) {
          const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
          if (d > R || d < R - 1.6) continue;
          const outer = x + 0.5 - cx > R * 0.55;
          const col = y === Math.floor(yTop) ? GOLD.base : outer ? CHIT.hi : y === Math.floor(yBot) ? CHIT.shade : CHIT.base;
          m.set(x, y, z, col, col === GOLD.base ? MT : 0);
        }
      // a backward-raked gold spike on the outer ridge of each bracer
      if (y === Math.floor(yTop) - 1) m.set(Math.floor(cx + R + 0.6), y, Math.floor(cz), GOLD.base, MT).set(Math.floor(cx + R + 1.4), y + 1, Math.floor(cz - 0.6), GOLD.hi, MT);
    }
  }
  // the fixed jaw of the pincer, sweeping down past the hand on the outer side
  tube(m, [[18.0, 50, 0.6], [19.2, 44, 0.1], [19.6, 39, 0.6], [19.0, 35.5, 2.0], [18.2, 34.0, 2.9]], 1.5, 0.6, (_x, _y, _z, g, ny) => (g > 0.84 ? GOLD.base : g < 0.12 ? GOLD.shade : ny > 0.4 ? CHIT.hi : CHIT.base), { wobble: 0.02, seed: 83 });
  // serrated gold teeth along its inner edge
  for (const y of [44, 41, 38]) m.set(19, y, 2, GOLD.hi, MT);
  m.forEach((x, y, z, c) => {
    if (c === GOLD.base || c === GOLD.shade) m.set(x, y, z, c, MT);
  });
  return m;
}

function buildClaw() {
  const m = new VoxelModel('claw_l');
  tube(m, [[18.6, 47.5, 3.4], [19.4, 42, 4.6], [19.4, 38, 4.4], [18.8, 35.2, 3.4], [18.3, 34.4, 3.0]], 1.3, 0.55, (_x, _y, _z, g, ny) => (g > 0.82 ? GOLD.base : ny > 0.3 ? CHIT.hi : CHIT.base), { wobble: 0.02, seed: 85 });
  for (const y of [42, 39]) m.set(18, y, 3, GOLD.hi, MT);
  m.forEach((x, y, z, c) => {
    if (c === GOLD.base) m.set(x, y, z, c, MT);
  });
  return m;
}

function buildHand() {
  const m = new VoxelModel('hand_l');
  lump(m, [16.6, 44.4, 1.8], [1.6, 2.7, 2.1], (_x, _y, _z, _nx, ny) => (ny < -0.6 ? SKIN.shade : SKIN.base), { wobble: 0.02, seed: 91 });
  for (let f = 0; f < 4; f++) {
    const z0 = 0.3 + f * 1.05;
    const len = f === 0 || f === 3 ? 0.85 : 1;
    tube(m, [[16.7, 42.2, z0], [16.5, 42.2 - 2.4 * len, z0 + 0.3], [16.0, 42.2 - 4.4 * len, z0 + 0.6]], 0.55, 0.5, () => SKIN.base, { wobble: 0 });
    // the talons: gold, curving in
    const ty = 42.2 - 4.4 * len;
    tube(m, [[16.0, ty, z0 + 0.6], [15.5, ty - 1.6, z0 + 0.7], [14.9, ty - 2.4, z0 + 0.5]], 0.5, 0.5, () => GOLD.base, { flags: MT, wobble: 0 });
  }
  tube(m, [[15.6, 44.4, 3.4], [15.0, 42.4, 4.5], [14.7, 41.0, 4.9]], 0.6, 0.5, () => SKIN.base, { wobble: 0 });
  tube(m, [[14.7, 41.0, 4.9], [14.3, 39.9, 5.0]], 0.5, 0.5, () => GOLD.base, { flags: MT, wobble: 0 });
  // a gold ring with a carnelian
  m.set(17, 42, 2, GOLD.hi, MT).set(17, 42, 3, CARN, EM);
  return m;
}

// ================================================================== SPIRIT-CLOTH: sashes and the apron
const sashCol = (end: boolean) => (s: number, u: number, k: number): [number, number] => {
  if (Math.abs(u) > 0.74) return [GOLD.base, MT];
  if (end && s > 0.82) return [CLOTH.glow, GL];
  if (end && s > 0.55) return [CLOTH.glow, EM];
  if (k % 6 === 0 && Math.abs(u) < 0.3) return [LAPIS.base, 0];
  return [Math.abs(u) > 0.5 ? CLOTH.shade : CLOTH.base, SOFT];
};
function buildSash(link: 1 | 2 | 3) {
  const m = new VoxelModel('sash_l' + link);
  if (link === 1) ribbon(m, [J.sash, [14, 68, -9], J.sash2], 1.6, 2.4, sashCol(false), { twist: 0.4 });
  else if (link === 2) ribbon(m, [J.sash2, [18, 59, -15], J.sash3], 2.4, 2.6, sashCol(false), { twist: -0.5 });
  else ribbon(m, [J.sash3, [19.8, 46, -19.5], [20, 38, -20.5]], 2.6, 0.3, sashCol(true), { twist: 0.6 });
  return m;
}
function buildApron(link: 1 | 2 | 3) {
  const m = new VoxelModel('apron' + link);
  const chevron = (s: number, u: number, k: number): [number, number] => {
    if (Math.abs(u) > 0.82) return [GOLD.base, MT];
    if (link === 3) return s > 0.7 ? [CLOTH.glow, s > 0.88 ? GL : EM] : [Math.abs(u) > 0.5 ? CLOTH.shade : CLOTH.base, SOFT];
    const row = (Math.floor(k / 3) + Math.round(Math.abs(u) * 4)) % 4;
    return row < 2 ? [LAPIS.base, 0] : row === 2 ? [GOLD.hi, MT] : [GOLD.base, MT];
  };
  const across: V3 = [1, 0, 0];
  if (link === 1) ribbon(m, [J.apron, [0.5, 46, 9.9], J.apron2], 3.4, 3.8, chevron, { across });
  else if (link === 2) ribbon(m, [J.apron2, [0.5, 33, 11.9], J.apron3], 3.8, 4.0, chevron, { across });
  else ribbon(m, [J.apron3, [0.5, 19, 13.9], [0.5, 11, 14.9]], 4.0, 0.5, chevron, { across });
  return m;
}

// ================================================================== TAIL: eight chitin segments and the venom stinger
const CURL: V3 = [-3, 80, -16]; // inside of the tail's arc (dorsal plates face away from it)
function buildTailSeg(k: number) {
  const m = new VoxelModel('tail' + (k + 1));
  const A = TJ[k], B = TJ[k + 1];
  const rA = TR[k], rB = TR[k + 1];
  const d: V3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const L = Math.hypot(...d);
  const T: V3 = [d[0] / L, d[1] / L, d[2] / L];
  const mid: V3 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
  // dorsal direction: away from the curl centre, perpendicular to the segment
  let D: V3 = [mid[0] - CURL[0], mid[1] - CURL[1], mid[2] - CURL[2]];
  const dt = D[0] * T[0] + D[1] * T[1] + D[2] * T[2];
  D = [D[0] - T[0] * dt, D[1] - T[1] * dt, D[2] - T[2] * dt];
  const dl = Math.hypot(...D) || 1;
  D = [D[0] / dl, D[1] / dl, D[2] / dl];
  const R = Math.max(rA, rB) * 1.25 + 1;
  const lo = [Math.min(A[0], B[0]) - R, Math.min(A[1], B[1]) - R, Math.min(A[2], B[2]) - R];
  const hi = [Math.max(A[0], B[0]) + R, Math.max(A[1], B[1]) + R, Math.max(A[2], B[2]) + R];
  for (let x = Math.floor(lo[0]); x <= Math.ceil(hi[0]); x++)
    for (let y = Math.floor(lo[1]); y <= Math.ceil(hi[1]); y++)
      for (let z = Math.floor(lo[2]); z <= Math.ceil(hi[2]); z++) {
        const px = x + 0.5 - A[0], py = y + 0.5 - A[1], pz = z + 0.5 - A[2];
        let t = (px * T[0] + py * T[1] + pz * T[2]) / L;
        if (t < -0.04 || t > 1.02) continue;
        t = Math.max(0, Math.min(1, t));
        const vx = px - T[0] * t * L, vy = py - T[1] * t * L, vz = pz - T[2] * t * L;
        const dist = Math.hypot(vx, vy, vz);
        // a bead: swollen mid-segment, flared where it overlaps the previous plate
        const r = (rA + (rB - rA) * t) * (1 + 0.13 * Math.sin(Math.PI * t)) * (t < 0.14 ? 1.07 : 1);
        if (dist > r) continue;
        const s = dist > 0.01 ? (vx * D[0] + vy * D[1] + vz * D[2]) / dist : 0;
        let col: number, fl = 0;
        if (t > 0.88 && s > -0.5) [col, fl] = [GOLD.base, MT];
        else if (Math.abs(s) < 0.09 && t > 0.15 && t < 0.85) [col, fl] = [CLOTH.glow, GL]; // the seam of light along each flank
        else if (s > 0.9) col = CHIT.hi;
        else if (s > 0.35) col = CHIT.base;
        else if (s < -0.45) [col, fl] = [CHIT.belly, EM];
        else col = CHIT.shade;
        m.set(x, y, z, col, fl);
      }
  // a short gold spike on the dorsal ridge
  const r0 = (rA + rB) / 2 * 1.13;
  for (const e of [1, 1.9]) {
    const p: V3 = [mid[0] + D[0] * (r0 + e), mid[1] + D[1] * (r0 + e), mid[2] + D[2] * (r0 + e)];
    m.set(Math.floor(p[0] - T[0] * e * 0.5), Math.floor(p[1] - T[1] * e * 0.5), Math.floor(p[2] - T[2] * e * 0.5), e > 1.5 ? GOLD.hi : GOLD.base, MT);
  }
  return m;
}

function buildStinger() {
  const m = new VoxelModel('stinger');
  // the venom bulb: chitin over a sac of glowing venom that shows through in bands
  lump(m, [-9.95, 117.8, -11.8], [3.3, 3.2, 3.9], (x, y, z, nx, ny) => {
    const band = Math.sin((z + 0.5) * 1.35 + (y + 0.5) * 0.4);
    if (band > 0.62 && ny < 0.75) return VENOM.base;
    return ny > 0.55 ? CHIT.hi : nx < -0.5 ? CHIT.shade : CHIT.base;
  }, { wobble: 0.04, seed: 97, power: 2.1 });
  m.forEach((x, y, z, c) => {
    if (c === VENOM.base) m.set(x, y, z, c, GL);
  });
  // the barb: gold, hooked down, a bead of venom at the very tip
  tube(m, [[-10.3, 118.5, -8.2], [-10.6, 118.6, -5.2], [-10.8, 117, -2.6], [-10.9, 114.4, -1.4], [-10.9, 112.2, -1.6]], 1.6, 0.6, (_x, _y, _z, g) => (g > 0.9 ? VENOM.core : g < 0.1 ? GOLD.shade : GOLD.base), { wobble: 0, seed: 98 });
  m.forEach((x, y, z, c) => {
    if (c === GOLD.base || c === GOLD.shade) m.set(x, y, z, c, MT);
    if (c === VENOM.core) m.set(x, y, z, c, GL);
  });
  return m;
}

// ================================================================== RIG
const EXPR: Record<string, ExpressionSpec> = {
  neutral: { jaw: 0, brow: [0, 0] },
  happy: { jaw: 0.05, brow: [-0.12, 0.12] },
  smug: { jaw: 0.02, brow: [0.05, -0.22] },
  surprised: { jaw: 0.14, brow: [-0.24, 0.24] },
  laugh: { jaw: 0.12, brow: [-0.1, 0.1] },
  stern: { jaw: 0, brow: [0.22, -0.22] },
  sad: { jaw: 0.02, brow: [-0.26, 0.26] },
  wink: { jaw: 0.03, brow: [0.15, 0] },
};
export const SERKET_GIRL_EXPRESSIONS = Object.keys(EXPR);

let cached: RigSpec | null = null;
/** the scorpion-girl spirit avatar of Serket (registry key `serket_girl`) */
export function scorpionGirlRig(): RigSpec {
  if (cached) return cached;
  const parts: PartSpec[] = [];
  const P = (name: string, model: VoxelModel, joint: V3, parent?: string) => {
    if (model.count > 0) parts.push({ name, model, pivot: joint, attach: joint, parent });
  };
  const hd = buildHead();
  const eyeJ: V3 = [4.5, 90.5, hd.eyeZ + 0.5];
  const browJ: V3 = [4.5, 95.5, hd.browZ + 0.5];
  P('pelvis', buildPelvis(), J.pelvis);
  P('torso', buildTorso(), J.waist, 'pelvis');
  P('head', hd.head, J.neck, 'torso');
  P('jaw', hd.jaw, J.jaw, 'head');
  P('eye_l', hd.eye_l, eyeJ, 'head');
  P('eye_r', hd.eye_r, mg(eyeJ), 'head');
  P('lid_l', hd.lid_l, eyeJ, 'head');
  P('lid_r', hd.lid_r, mg(eyeJ), 'head');
  P('brow_l', hd.brow_l, browJ, 'head');
  P('brow_r', hd.brow_r, mg(browJ), 'head');
  const lock = buildLock();
  P('lock_l', lock, J.lock, 'head');
  P('lock_r', mirrorPart(lock, 'lock_r'), mg(J.lock), 'head');
  P('hair1', buildHair(1), J.hair1, 'head');
  P('hair2', buildHair(2), J.hair2, 'hair1');
  P('hair3', buildHair(3), J.hair3, 'hair2');
  // arms: the right is the mirrored left, then the left alone gets the scorpion pauldron
  const arm = buildUpperArm(), fore = buildForearm(), hand = buildHand(), claw = buildClaw();
  const armR = mirrorPart(arm, 'arm_r');
  pauldron(arm);
  P('arm_l', arm, J.shoulder, 'torso');
  P('fore_l', fore, J.elbow, 'arm_l');
  P('hand_l', hand, J.wrist, 'fore_l');
  P('claw_l', claw, J.claw, 'fore_l');
  P('arm_r', armR, mg(J.shoulder), 'torso');
  P('fore_r', mirrorPart(fore, 'fore_r'), mg(J.elbow), 'arm_r');
  P('hand_r', mirrorPart(hand, 'hand_r'), mg(J.wrist), 'fore_r');
  P('claw_r', mirrorPart(claw, 'claw_r'), mg(J.claw), 'fore_r');
  // sashes
  const sj = [J.sash, J.sash2, J.sash3];
  for (let i = 1; i <= 3; i++) {
    const s = buildSash(i as 1 | 2 | 3);
    P('sash_l' + i, s, sj[i - 1], i === 1 ? 'torso' : 'sash_l' + (i - 1));
    P('sash_r' + i, mirrorPart(s, 'sash_r' + i), mg(sj[i - 1]), i === 1 ? 'torso' : 'sash_r' + (i - 1));
  }
  // apron
  const aj = [J.apron, J.apron2, J.apron3];
  for (let i = 1; i <= 3; i++) P('apron' + i, buildApron(i as 1 | 2 | 3), aj[i - 1], i === 1 ? 'pelvis' : 'apron' + (i - 1));
  // tail + stinger
  for (let k = 0; k < 8; k++) P('tail' + (k + 1), buildTailSeg(k), TJ[k], k === 0 ? 'pelvis' : 'tail' + k);
  P('stinger', buildStinger(), TJ[8], 'tail8');

  const voxels = parts.reduce((n, p) => n + p.model.count, 0);
  const sockets: Record<string, SocketSpec> = {
    hand_l: { part: 'hand_l', at: [16.0, 41.0, 2.2] },
    hand_r: { part: 'hand_r', at: mg([16.0, 41.0, 2.2]) },
    head_top: { part: 'head', at: [0.5, hd.crestTop, 0.5] },
    crown: { part: 'head', at: [0.5, 104, 1.5] },
    chest: { part: 'torso', at: [0.5, 68, 7] },
    back: { part: 'torso', at: [0.5, 68, -7] },
    core: { part: 'torso', at: [0.5, 66, 0.5] },
    mouth: { part: 'jaw', at: [0.5, 84.5, 8] },
    eye_l: { part: 'eye_l', at: eyeJ },
    eye_r: { part: 'eye_r', at: mg(eyeJ) },
    stinger_tip: { part: 'stinger', at: [-10.4, 112.0, -1.1] },
  };
  cached = {
    name: 'serket_girl',
    voxelSize: VS,
    parts,
    sockets,
    meta: {
      height: 118 * VS,
      headTop: hd.crestTop * VS,
      radius: 0.45,
      /** where the spirit's light gathers (m, rig space): the "forming" field is centred here */
      core: [0, 66 * VS, 0],
      floats: true,
      spirit: true,
      eyes: 'voxel',
      voxels,
      partCount: parts.length,
      expressions: EXPR,
      palette: { skin: SKIN.base, gold: GOLD.base, cloth: CLOTH.base, hair: HAIR.base, chitin: CHIT.base, venom: VENOM.base, glow: CLOTH.glow },
    },
  };
  return cached;
}
