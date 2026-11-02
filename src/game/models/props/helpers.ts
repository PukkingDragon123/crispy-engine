// STYLE v2 prop helpers — clean, hand-made cartoon voxel art. Flat colour regions
// from 3-tone ramps, deliberate seams / nail heads / grain dashes, stair-stepped
// round forms. No per-voxel noise, no automatic texture passes.
import { VoxelModel, VF, CSpec } from '../../../engine/voxel/VoxelModel';
import { RNG, hash3 } from '../../../engine/math/rand';
import { TOON, Ramp } from '../style';

export type V3 = [number, number, number];
export type Axis = 'x' | 'y' | 'z';
/** always-positive modulo */
export const mod = (a: number, n: number) => ((a % n) + n) % n;
export interface StaticModel {
  model: VoxelModel;
  voxelSize: number;
}
export const S = (model: VoxelModel, voxelSize: number): StaticModel => ({ model, voxelSize });
export const rngOf = (seed: number, salt = 0) => new RNG(((seed + 1) * 2654435761 + salt * 97531) >>> 0);
/** meters -> whole voxels at voxel size vs */
export const meters = (vs: number) => (m: number) => Math.round(m / vs);

const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });
/** prop-specific ramps on top of the shared TOON set */
export const PR = {
  ...TOON,
  woodLight: ramp(0xd3a46c, 0xb0844f, 0xe8bf88, 0x7c5530),
  woodDark: ramp(0x7a5034, 0x5e3c25, 0x93654a, 0x3c2516),
  barnRed: ramp(0xb0483a, 0x8a3428, 0xc8624e, 0x5c2018),
  paintWhite: ramp(0xece2cc, 0xcbbfa6, 0xfaf3e2, 0x9c917a),
  paintGreen: ramp(0x5e8a5a, 0x476c44, 0x78a672, 0x2e4a2c),
  paintBlue: ramp(0x5a7ea8, 0x445f84, 0x7a9ec6, 0x2c405c),
  paintYellow: ramp(0xe8b84a, 0xc49232, 0xf8d478, 0x8a6418),
  canvas: ramp(0xeadbb8, 0xcab98e, 0xf8eed4, 0x9c8a62),
  canvasStripe: ramp(0xc0583e, 0x9a4230, 0xd8765a, 0x6a2a1c),
  tin: ramp(0xb4b2ac, 0x908e88, 0xd2d0ca, 0x66645e),
  rust: ramp(0xb0643a, 0x8c4a28, 0xc8804e, 0x5c2e18),
  terracotta: ramp(0xc8744a, 0xa45a36, 0xe0905e, 0x703a20),
  adobe: ramp(0xd8a878, 0xb88a5c, 0xeac094, 0x8a6240),
  lime: ramp(0xeee2c4, 0xd2c29e, 0xfbf3dc, 0xa8966e),
  water: ramp(0x4aa6b8, 0x3a8496, 0x72c8d6, 0x24586a),
  hay: ramp(0xe8c868, 0xc8a84a, 0xf8e08c, 0x9a7a2c),
  rope: ramp(0xc8a66e, 0xa88850, 0xe0c28c, 0x7a5e34),
  ember: ramp(0xff8a2a, 0xd8541a, 0xffc04a, 0x8a2a10),
  coal: ramp(0x3a3634, 0x2a2624, 0x4e4a46, 0x1a1816),
  leaf: ramp(0x7aa84a, 0x5c8a36, 0x9ac668, 0x3e6424),
  oliveLeaf: ramp(0x8a9a5a, 0x6c7c44, 0xa8b878, 0x4a5630),
  twig: ramp(0x9a7448, 0x7a5834, 0xb48c5c, 0x523a20),
  copper: ramp(0xc87a4a, 0xa05c34, 0xe89c6a, 0x6a3a1e),
  amethyst: ramp(0x9a6ad0, 0x7a4eb0, 0xc49af0, 0x4a2c7a),
  felt: ramp(0x3e7a4a, 0x2e5e38, 0x52965e, 0x1e3e26),
  glassGreen: ramp(0x5a9a5e, 0x427a48, 0x86c48a, 0x2a5030),
  glassBrown: ramp(0x9a5a2a, 0x7a421c, 0xc07a42, 0x4e2810),
  glassClear: ramp(0xbcdcd8, 0x98bcb8, 0xe4f6f2, 0x6a8a86),
  parchment: ramp(0xf0deb0, 0xd6c08c, 0xfff0cc, 0xa88e5c),
  ink: ramp(0x3a2a20, 0x2a1e16, 0x4e3a2c, 0x1a120c),
  cloth: ramp(0xb84a3a, 0x923a2c, 0xd06a54, 0x62241a),
  redRock: ramp(0xc0744a, 0x9c5836, 0xd8905e, 0x6e3a22),
  mesaRock: ramp(0xb0623e, 0x8c4a2e, 0xc87c52, 0x5e3020),
  greyRock: ramp(0x9a948c, 0x7a746c, 0xb6b0a6, 0x56504a),
} as const;
export type PRName = keyof typeof PR;

// ---------------------------------------------------------------------------
// basic shape helpers
// ---------------------------------------------------------------------------
export function box(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: CSpec, flags?: number) {
  return m.box(x0, y0, z0, x1, y1, z1, c, flags);
}

/** circle membership for a clean stair-stepped disc. r in voxels; even=true centres between voxels */
export function inCircle(a: number, b: number, r: number, even = false) {
  const aa = even ? a + 0.5 : a, bb = even ? b + 0.5 : b;
  return aa * aa + bb * bb <= r * r + r * 0.6;
}

/** vertical stepped cylinder with a radius profile r(t), t 0..1 bottom->top */
export function cylY(m: VoxelModel, cx: number, cz: number, y0: number, y1: number, r: number | ((t: number, y: number) => number), c: CSpec, flags?: number, even = false) {
  const n = y1 - y0;
  for (let y = y0; y <= y1; y++) {
    const t = n <= 0 ? 0 : (y - y0) / n;
    const rr = typeof r === 'number' ? r : r(t, y);
    if (rr <= 0) continue;
    const R = Math.ceil(rr) + 1;
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) if (inCircle(x, z, rr, even)) m.set(cx + x, y, cz + z, c, flags);
  }
  return m;
}
/** horizontal stepped cylinder along x or z, centre line (cy, c2) */
export function cylH(m: VoxelModel, axis: 'x' | 'z', a0: number, a1: number, cy: number, c2: number, r: number | ((t: number) => number), c: CSpec, flags?: number, even = false) {
  const n = a1 - a0;
  for (let a = a0; a <= a1; a++) {
    const t = n <= 0 ? 0 : (a - a0) / n;
    const rr = typeof r === 'number' ? r : r(t);
    const R = Math.ceil(rr) + 1;
    for (let u = -R; u <= R; u++)
      for (let w = -R; w <= R; w++) {
        if (!inCircle(u, w, rr, even)) continue;
        if (axis === 'x') m.set(a, cy + u, c2 + w, c, flags);
        else m.set(c2 + w, cy + u, a, c, flags);
      }
  }
  return m;
}

/** clean ellipsoid (voxel centres) */
export function blob(m: VoxelModel, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: CSpec, flags?: number) {
  const X = Math.ceil(rx), Y = Math.ceil(ry), Z = Math.ceil(rz);
  for (let x = -X; x <= X; x++)
    for (let y = -Y; y <= Y; y++)
      for (let z = -Z; z <= Z; z++) {
        const d = (x * x) / (rx * rx + 0.01) + (y * y) / (ry * ry + 0.01) + (z * z) / (rz * rz + 0.01);
        if (d <= 1.04) m.set(cx + x, cy + y, cz + z, c, flags);
      }
  return m;
}

/** thick straight segment of square cross-section w (voxels) */
export function seg(m: VoxelModel, a: V3, b: V3, w: number, c: CSpec, flags?: number) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1);
  const steps = Math.ceil(len * 1.5);
  const h0 = -Math.floor((w - 1) / 2), h1 = h0 + w - 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(a[0] + dx * t), y = Math.round(a[1] + dy * t), z = Math.round(a[2] + dz * t);
    for (let u = h0; u <= h1; u++) for (let v = h0; v <= h1; v++) for (let q = h0; q <= h1; q++) m.set(x + u, y + v, z + q, c, flags);
  }
  return m;
}

/** recolour every voxel of colour `from` inside a box (keeps flags) */
export function recolor(m: VoxelModel, from: number, to: number, x0 = -999, y0 = -999, z0 = -999, x1 = 999, y1 = 999, z1 = 999) {
  const f = from & 0xffffff;
  m.forEach((x, y, z, c, fl) => {
    if (c === f && x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1) m.set(x, y, z, to, fl);
  });
  return m;
}

/**
 * Hand-placed two-tone finish for one material: top-exposed voxels on a silhouette edge get `hi`,
 * bottom-exposed voxels get `shade`. Only voxels currently of `r.base` are touched.
 */
export function edgeShade(m: VoxelModel, r: Ramp, o: { hi?: boolean; under?: boolean } = {}) {
  const hi = o.hi ?? true, under = o.under ?? true;
  const base = r.base & 0xffffff;
  const out: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, fl) => {
    if (c !== base) return;
    if (under && !m.has(x, y - 1, z)) out.push([x, y, z, r.shade, fl]);
    else if (hi && !m.has(x, y + 1, z) && (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1))) out.push([x, y, z, r.hi, fl]);
  });
  for (const [x, y, z, c, fl] of out) m.set(x, y, z, c, fl);
  return m;
}

/** copy a model into another with an offset */
export function paste(dst: VoxelModel, src: VoxelModel, dx: number, dy: number, dz: number) {
  src.forEach((x, y, z, c, f) => dst.set(x + dx, y + dy, z + dz, c, f));
  return dst;
}
/** rotate a model 90° steps around Y (about origin) */
export function rotY90(src: VoxelModel, steps: number) {
  const s = mod(steps, 4);
  const out = new VoxelModel(src.name);
  src.forEach((x, y, z, c, f) => {
    const [nx, nz] = s === 0 ? [x, z] : s === 1 ? [z, -x] : s === 2 ? [-x, -z] : [-z, x];
    out.set(nx, y, nz, c, f);
  });
  return out;
}

// ---------------------------------------------------------------------------
// wood
// ---------------------------------------------------------------------------
/**
 * A clean board filling the box. `along` = grain direction. The outer faces get a couple of
 * deliberate grain dashes (shade) and the board's end faces are a touch lighter (end grain).
 */
export function board(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: Ramp, along: Axis, seed = 0, o: { dashes?: number; endGrain?: boolean; flags?: number } = {}) {
  m.box(x0, y0, z0, x1, y1, z1, r.base, o.flags);
  const rng = rngOf(seed, 991);
  const lo = along === 'x' ? x0 : along === 'y' ? y0 : z0;
  const hi = along === 'x' ? x1 : along === 'y' ? y1 : z1;
  const len = hi - lo + 1;
  const dashes = o.dashes ?? (len > 10 ? 2 : len > 5 ? 1 : 0);
  // grain dashes on all outer faces at the same lateral position (reads as a line in the wood)
  for (let i = 0; i < dashes; i++) {
    const dl = Math.min(len - 2, 2 + rng.int(1, 3));
    if (dl < 2) break;
    const s0 = lo + rng.int(1, Math.max(1, len - dl - 1));
    const across = rng.next();
    for (let a = s0; a < s0 + dl; a++) {
      if (along === 'x') {
        const yy = Math.round(y0 + across * (y1 - y0)), zz = Math.round(z0 + across * (z1 - z0));
        for (const z of [z0, z1]) if (y1 - y0 >= 2) m.set(a, yy, z, r.shade, o.flags);
        for (const y of [y0, y1]) if (z1 - z0 >= 2) m.set(a, y, zz, r.shade, o.flags);
      } else if (along === 'z') {
        const yy = Math.round(y0 + across * (y1 - y0)), xx = Math.round(x0 + across * (x1 - x0));
        for (const x of [x0, x1]) if (y1 - y0 >= 2) m.set(x, yy, a, r.shade, o.flags);
        for (const y of [y0, y1]) if (x1 - x0 >= 2) m.set(xx, y, a, r.shade, o.flags);
      } else {
        const xx = Math.round(x0 + across * (x1 - x0)), zz = Math.round(z0 + across * (z1 - z0));
        for (const z of [z0, z1]) if (x1 - x0 >= 2) m.set(xx, a, z, r.shade, o.flags);
        for (const x of [x0, x1]) if (z1 - z0 >= 2) m.set(x, a, zz, r.shade, o.flags);
      }
    }
  }
  if (o.endGrain ?? true) {
    if (along === 'x') m.box(x1, y0, z0, x1, y1, z1, r.hi, o.flags), m.box(x0, y0, z0, x0, y1, z1, r.hi, o.flags);
    else if (along === 'z') m.box(x0, y0, z1, x1, y1, z1, r.hi, o.flags), m.box(x0, y0, z0, x1, y1, z0, r.hi, o.flags);
    else m.box(x0, y1, z0, x1, y1, z1, r.hi, o.flags);
  }
  return m;
}

/** square post with chamfered vertical edges (w>=3), end grain on top */
export function post(m: VoxelModel, x0: number, z0: number, y0: number, y1: number, w: number, r: Ramp, seed = 0) {
  board(m, x0, y0, z0, x0 + w - 1, y1, z0 + w - 1, r, 'y', seed, { dashes: (y1 - y0) > 16 ? 2 : 1 });
  if (w >= 4) for (const [x, z] of [[x0, z0], [x0 + w - 1, z0], [x0, z0 + w - 1], [x0 + w - 1, z0 + w - 1]]) for (let y = y0; y < y1; y++) m.del(x, y, z);
  return m;
}

/** nail head (1 voxel, iron) */
export function nail(m: VoxelModel, x: number, y: number, z: number) {
  m.set(x, y, z, PR.iron.dark, VF.METAL);
}

/** diagonal brace between two points (square section w) */
export function brace(m: VoxelModel, a: V3, b: V3, w: number, r: Ramp) {
  return seg(m, a, b, w, r.base);
}

/** wall descriptor: plane at `out` along axis (x: wall spans x, constant z) facing `sign` */
export interface Wall {
  axis: 'x' | 'z';
  out: number;
  sign: 1 | -1;
  thick: number;
}
/** wall-space (u along wall, y, d depth inward from the outer face) -> world voxel */
export function W(w: Wall, u: number, y: number, d: number): V3 {
  const p = w.out - w.sign * d;
  return w.axis === 'x' ? [u, y, p] : [p, y, u];
}
export function setW(m: VoxelModel, w: Wall, u: number, y: number, d: number, c: number, flags?: number) {
  const [x, yy, z] = W(w, u, y, d);
  m.set(x, yy, z, c, flags);
}
export function delW(m: VoxelModel, w: Wall, u: number, y: number, d: number) {
  const [x, yy, z] = W(w, u, y, d);
  m.del(x, yy, z);
}

/**
 * Plank wall between u0..u1, y0..y1. Boards `bw` voxels wide; each board's lower row is a dark seam
 * (outer face only), boards alternate two close tones, plus deliberate grain dashes.
 */
export function plankWall(m: VoxelModel, w: Wall, u0: number, u1: number, y0: number, y1: number, o: { vertical?: boolean; r?: Ramp; bw?: number; seed?: number; missing?: number; nails?: boolean } = {}) {
  const r = o.r ?? PR.wood;
  const bw = o.bw ?? 3;
  const rng = rngOf(o.seed ?? 0, 313);
  const vert = !!o.vertical;
  const alt = mixRGB(r.base, r.shade, 0.25);
  const nBoards = Math.floor(((vert ? u1 - u0 : y1 - y0) + 1) / bw) + 1;
  const missing = new Set<number>();
  if (o.missing) for (let i = 0; i < nBoards; i++) if (rng.chance(o.missing)) missing.add(i);
  // grain dashes per board
  const dashes: { b: number; s: number; len: number; across: number }[] = [];
  for (let i = 0; i < nBoards; i++) {
    const L = vert ? y1 - y0 : u1 - u0;
    if (L > 8 && rng.chance(0.75)) dashes.push({ b: i, s: rng.int(1, L - 6), len: rng.int(2, 4), across: rng.int(1, bw - 2 >= 1 ? bw - 2 : 1) });
  }
  for (let u = u0; u <= u1; u++)
    for (let y = y0; y <= y1; y++) {
      const a = vert ? u - u0 : y - y0;
      const bi = Math.floor(a / bw), row = a % bw;
      if (missing.has(bi)) continue;
      const along = vert ? y - y0 : u - u0;
      let c = bi % 2 ? alt : r.base;
      if (row === 0 && a > 0) c = r.dark;
      for (const dd of dashes) if (dd.b === bi && row === dd.across && along >= dd.s && along < dd.s + dd.len) c = r.shade;
      for (let d = 0; d < w.thick; d++) setW(m, w, u, y, d, d === 0 ? c : r.shade);
    }
  // nail heads near board ends
  if (o.nails ?? true) {
    for (let bi = 0; bi < nBoards; bi++) {
      if (missing.has(bi)) continue;
      const mid = bi * bw + Math.floor(bw / 2);
      if (vert) {
        const u = u0 + mid;
        if (u > u1) continue;
        for (const y of [y0 + 1, y1 - 1]) setW(m, w, u, y, -1, PR.iron.dark, VF.METAL);
      } else {
        const y = y0 + mid;
        if (y > y1) continue;
        for (const u of [u0 + 1, u1 - 1]) setW(m, w, u, y, -1, PR.iron.dark, VF.METAL);
      }
    }
  }
  return m;
}

/** rectangular window opening with frame, sill and optional shutters / glass */
export function windowW(m: VoxelModel, w: Wall, u0: number, y0: number, wd: number, ht: number, o: { frame?: Ramp; glass?: boolean; shutters?: Ramp; cross?: boolean; broken?: boolean } = {}) {
  const fr = o.frame ?? PR.paintWhite;
  for (let u = u0; u < u0 + wd; u++) for (let y = y0; y < y0 + ht; y++) for (let d = 0; d < w.thick; d++) delW(m, w, u, y, d);
  // dark interior glass / void
  for (let u = u0; u < u0 + wd; u++)
    for (let y = y0; y < y0 + ht; y++) {
      const crossLine = o.cross !== false && (u === u0 + Math.floor(wd / 2) || y === y0 + Math.floor(ht / 2));
      if (crossLine) setW(m, w, u, y, 1, fr.shade);
      else if (o.glass !== false && !(o.broken && (u + y) % 5 === 0)) setW(m, w, u, y, w.thick, 0x2c3a44, VF.METAL);
      else setW(m, w, u, y, w.thick, PR.socket.base);
    }
  for (let u = u0 - 1; u <= u0 + wd; u++) {
    setW(m, w, u, y0 + ht, -1, fr.base);
    setW(m, w, u, y0 - 1, -1, fr.hi);
    setW(m, w, u, y0 - 1, -2, fr.shade);
  }
  for (let y = y0; y < y0 + ht; y++) {
    setW(m, w, u0 - 1, y, -1, fr.base);
    setW(m, w, u0 + wd, y, -1, fr.base);
  }
  if (o.shutters) {
    const sr = o.shutters;
    const sw = Math.ceil(wd / 2);
    for (let y = y0; y < y0 + ht; y++)
      for (let k = 0; k < sw; k++) {
        const c = k === sw - 1 ? sr.shade : y % 3 === 0 ? sr.shade : sr.base;
        setW(m, w, u0 - 2 - k, y, -1, c);
        setW(m, w, u0 + wd + 1 + k, y, -1, c);
      }
  }
}

/** door opening with plank door (closed / ajar) or batwing doors */
export function doorW(m: VoxelModel, w: Wall, u0: number, y0: number, wd: number, ht: number, o: { r?: Ramp; open?: boolean; batwing?: boolean; trim?: Ramp } = {}) {
  const r = o.r ?? PR.woodDark;
  const tr = o.trim ?? PR.woodDark;
  for (let u = u0; u < u0 + wd; u++) for (let y = y0; y < y0 + ht; y++) for (let d = 0; d < w.thick; d++) delW(m, w, u, y, d);
  for (let u = u0; u < u0 + wd; u++) for (let y = y0; y < y0 + ht; y++) setW(m, w, u, y, w.thick, PR.socket.base);
  if (o.batwing) {
    const half = Math.floor(wd / 2);
    for (let u = u0; u < u0 + wd; u++) {
      if (u === u0 + half && wd % 2) continue;
      for (let y = y0 + Math.round(ht * 0.25); y < y0 + Math.round(ht * 0.72); y++) {
        const edge = y === y0 + Math.round(ht * 0.25) || y === y0 + Math.round(ht * 0.72) - 1 || u === u0 || u === u0 + wd - 1;
        const slat = (y % 2 === 0) ? r.shade : r.base;
        setW(m, w, u, y, 0, edge ? r.dark : slat);
      }
    }
  } else if (!o.open) {
    for (let u = u0; u < u0 + wd; u++)
      for (let y = y0; y < y0 + ht; y++) {
        const seam = (u - u0) % 3 === 0 && u !== u0;
        const zrail = y === y0 + 2 || y === y0 + ht - 3;
        setW(m, w, u, y, 1, seam ? r.dark : zrail ? r.shade : r.base);
      }
    setW(m, w, u0 + wd - 2, y0 + Math.round(ht * 0.45), 0, PR.brass.base, VF.METAL);
  }
  for (let y = y0; y <= y0 + ht; y++) {
    setW(m, w, u0 - 1, y, -1, tr.base);
    setW(m, w, u0 + wd, y, -1, tr.base);
  }
  for (let u = u0 - 1; u <= u0 + wd; u++) setW(m, w, u, y0 + ht, -1, tr.hi);
}

/** corrugated tin roof plane: yAt(x,z) gives top height; ridges run down-slope (perpendicular to ridge axis) */
export function tinRoof(m: VoxelModel, x0: number, x1: number, z0: number, z1: number, yAt: (x: number, z: number) => number, ridge: Axis, seed = 0, thick = 1) {
  const rng = rngOf(seed, 41);
  const rustCols = new Set<number>();
  const span = ridge === 'x' ? x1 - x0 : z1 - z0;
  for (let i = 0; i < Math.max(1, span / 9); i++) rustCols.add(rng.int(0, span));
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const along = ridge === 'x' ? x - x0 : z - z0;
      const y = yAt(x, z);
      const corr = along % 2 === 0;
      let c = corr ? PR.tin.base : PR.tin.shade;
      if (rustCols.has(along) || rustCols.has(along - 1)) c = corr ? PR.rust.base : PR.rust.shade;
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      m.set(x, y, z, edge ? PR.tin.dark : c, VF.METAL);
      for (let t = 1; t < thick; t++) m.set(x, y - t, z, PR.tin.dark, VF.METAL);
    }
}

/** wooden shingle roof plane (staggered rows) */
export function shingleRoof(m: VoxelModel, x0: number, x1: number, z0: number, z1: number, yAt: (x: number, z: number) => number, rowAxis: Axis, r: Ramp = PR.woodDark, rowW = 3) {
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const y = yAt(x, z);
      const down = rowAxis === 'x' ? z : x; // rows run along rowAxis, stacked down-slope
      const acr = rowAxis === 'x' ? x : z;
      const row = Math.floor(down / rowW);
      const off = row % 2 ? 2 : 0;
      const seam = mod(down, rowW) === 0;
      const joint = mod(acr + off, 5) === 0;
      m.set(x, y, z, seam ? r.dark : joint ? r.shade : row % 2 ? r.base : mixRGB(r.base, r.hi, 0.3));
      m.set(x, y - 1, z, r.shade);
    }
}

// ---------------------------------------------------------------------------
// stone
// ---------------------------------------------------------------------------
/** clean ashlar blocks: mortar seams + per-block tone (base / hi / shade picked per block) */
export function masonry(r: Ramp, bw = 6, bh = 3, mortar: number = r.dark, seed = 0) {
  return (x: number, y: number, z: number): number => {
    const row = Math.floor(y / bh);
    const off = row % 2 ? Math.floor(bw / 2) : 0;
    const bx = Math.floor((x + off) / bw), bz = Math.floor((z + off) / bw);
    if (mod(y, bh) === 0) return mortar;
    if (mod(x + off, bw) === 0 || mod(z + off, bw) === 0) return mortar;
    const h = hash3(bx + seed, row, bz - seed);
    return h < 0.2 ? r.shade : h > 0.82 ? r.hi : r.base;
  };
}
/** big clean faceted stone chunk: bevelled box, optional planar facet cuts (seeded) */
export function chunk(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: Ramp, bevel = 2, topHi = true, cuts = 0, seed = 0) {
  const rng = rngOf(seed, 777);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const planes: { n: [number, number, number]; d: number }[] = [];
  for (let i = 0; i < cuts; i++) {
    const nx = rng.range(-1, 1), nz = rng.range(-1, 1), ny = rng.range(0.15, 0.7);
    const l = Math.hypot(nx, ny, nz);
    const n: [number, number, number] = [nx / l, ny / l, nz / l];
    const ext = Math.abs(n[0]) * (x1 - x0) / 2 + Math.abs(n[1]) * (y1 - y0) / 2 + Math.abs(n[2]) * (z1 - z0) / 2;
    planes.push({ n, d: ext * rng.range(0.55, 0.8) });
  }
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const dx = Math.min(x - x0, x1 - x), dy = Math.min(y - y0, y1 - y), dz = Math.min(z - z0, z1 - z);
        if (dx + dy < bevel || dx + dz < bevel || dy + dz < bevel) continue;
        let cut = false;
        for (const p of planes) if (p.n[0] * (x - cx) + p.n[1] * (y - cy) + p.n[2] * (z - cz) > p.d) cut = true;
        if (cut) continue;
        m.set(x, y, z, r.base);
      }
  if (topHi) {
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        for (let y = y1; y >= y0; y--) {
          const v = m.get(x, y, z);
          if (v === undefined) continue;
          if ((v & 0xffffff) === (r.base & 0xffffff) && !m.has(x, y + 1, z)) m.set(x, y, z, r.hi);
          break;
        }
      }
  }
  return m;
}

// ---------------------------------------------------------------------------
// ground / misc
// ---------------------------------------------------------------------------
/** smooth sand mound around a footprint (no noise): height h at centre falling off to the ellipse edge */
export function sandDrift(m: VoxelModel, cx: number, cz: number, rx: number, rz: number, h: number, y0 = 0, _seed = 0, windX = 1) {
  const X = Math.ceil(rx * 1.3), Z = Math.ceil(rz);
  for (let x = -X; x <= X; x++)
    for (let z = -Z; z <= Z; z++) {
      const lx = x * windX > 0 ? x / (rx * 1.3) : x / rx;
      const d = lx * lx + (z * z) / (rz * rz);
      if (d > 1) continue;
      const top = Math.round(h * Math.pow(1 - d, 1.4));
      for (let y = 0; y < top; y++) {
        const px = cx + x, py = y0 + y, pz = cz + z;
        if (m.has(px, py, pz)) continue;
        m.set(px, py, pz, y === top - 1 ? PR.sand.base : PR.sand.shade);
      }
    }
}

/** rope through points (1 voxel) */
export function rope(m: VoxelModel, pts: V3[], c: number = PR.rope.base) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i];
    const [bx, by, bz] = pts[i + 1];
    const n = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay), Math.abs(bz - az)) * 1.5) + 1;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      m.set(Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t), Math.round(az + (bz - az) * t), (k + i) % 4 === 0 ? PR.rope.shade : c);
    }
  }
}
/** sagging rope/chain points between a and b */
export function sagPoints(a: V3, b: V3, sag: number, n = 8): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t]);
  }
  return pts;
}

/** blend two packed colours */
export function mixRGB(a: number, b: number, t: number) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

/** voxel point -> meters relative to the model's bottom-centre pivot */
export function toMeters(m: VoxelModel, vs: number, p: V3): V3 {
  const b = m.bounds();
  const px = (b.minX + b.maxX + 1) / 2, pz = (b.minZ + b.maxZ + 1) / 2;
  return [(p[0] + 0.5 - px) * vs, (p[1] + 0.5 - b.minY) * vs, (p[2] + 0.5 - pz) * vs];
}
/** pivot (voxel coords) that buildVoxelGeometry uses for 'bottom' */
export function bottomPivot(m: VoxelModel): V3 {
  const b = m.bounds();
  return [(b.minX + b.maxX + 1) / 2, b.minY, (b.minZ + b.maxZ + 1) / 2];
}
/** approximate footprint (meters): half extents + height */
export function footprint(m: VoxelModel, vs: number) {
  const b = m.bounds();
  return { hx: ((b.maxX - b.minX + 1) * vs) / 2, hz: ((b.maxZ - b.minZ + 1) * vs) / 2, h: (b.maxY - b.minY + 1) * vs };
}

// ---------------------------------------------------------------------------
// painted / carved lettering and glyphs
// ---------------------------------------------------------------------------
export type Face = 'x+' | 'x-' | 'z+' | 'z-';

function surfaceAt(m: VoxelModel, face: Face, u: number, y: number, from: number, depth = 40): V3 | null {
  const sign = face.endsWith('+') ? 1 : -1;
  for (let d = 0; d < depth; d++) {
    const w = from - sign * d;
    const p: V3 = face[0] === 'x' ? [w, y, u] : [u, y, w];
    if (m.has(p[0], p[1], p[2])) return p;
  }
  return null;
}

/** carve (recess 1 voxel) or paint a bitmap onto a face. rows top->bottom, '#' set. */
export function stampBitmap(m: VoxelModel, face: Face, bitmap: string[], u0: number, yTop: number, from: number, opts: { carve?: boolean; color?: number; flags?: number; flipU?: boolean; scale?: number } = {}) {
  const carve = opts.carve ?? false;
  const sign = face.endsWith('+') ? 1 : -1;
  const sc = opts.scale ?? 1;
  for (let r = 0; r < bitmap.length * sc; r++) {
    const row = bitmap[Math.floor(r / sc)];
    for (let c = 0; c < row.length * sc; c++) {
      if (row[Math.floor(c / sc)] !== '#') continue;
      const u = opts.flipU ? u0 - c : u0 + c;
      const y = yTop - r;
      const s = surfaceAt(m, face, u, y, from);
      if (!s) continue;
      let target = s;
      if (carve) {
        m.del(s[0], s[1], s[2]);
        target = face[0] === 'x' ? [s[0] - sign, s[1], s[2]] : [s[0], s[1], s[2] - sign];
        if (!m.has(target[0], target[1], target[2])) continue;
      }
      const old = m.get(target[0], target[1], target[2])!;
      const col = opts.color ?? mixRGB(old & 0xffffff, 0x1a120c, 0.45);
      m.set(target[0], target[1], target[2], col, opts.flags ?? VF.SOLID);
    }
  }
}

const FONT: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'], N: ['##.', '#.#', '#.#', '#.#', '#.#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'], '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'], '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'], '7': ['###', '..#', '.#.', '.#.', '.#.'], '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'], $: ['.#.', '###', '##.', '.##', '###'], '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'], '-': ['...', '...', '###', '...', '...'], '.': ['...', '...', '...', '...', '.#.'],
  "'": ['.#.', '.#.', '...', '...', '...'], '&': ['.#.', '#.#', '.#.', '#.#', '.##'], ' ': ['...', '...', '...', '...', '...'],
};

export function textWidth(text: string, spacing = 1, scale = 1) {
  return (text.length * (3 + spacing) - spacing) * scale;
}

/** paint/carve text onto a face. u0 = left edge in reading direction, yTop = top row */
export function stampText(m: VoxelModel, face: Face, text: string, u0: number, yTop: number, from: number, opts: { carve?: boolean; color?: number; flags?: number; spacing?: number; scale?: number } = {}) {
  const flip = face === 'z-' || face === 'x+';
  const sp = opts.spacing ?? 1;
  const sc = opts.scale ?? 1;
  let u = u0;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] ?? FONT['?'];
    stampBitmap(m, face, g, u, yTop, from, { ...opts, flipU: flip });
    u += (flip ? -(3 + sp) : 3 + sp) * sc;
  }
}

/** centred text on a z+ face (most signs face +Z) */
export function textCentered(m: VoxelModel, text: string, cx: number, yTop: number, zFront: number, color: number, face: Face = 'z+') {
  const tw = textWidth(text);
  const flip = face === 'z-' || face === 'x+';
  stampText(m, face, text, flip ? cx + Math.floor(tw / 2) : cx - Math.floor(tw / 2), yTop, zFront, { color });
}

/** hieroglyph bitmaps (5 tall) */
export const GLYPHS: string[][] = [
  ['.#.', '#.#', '.#.', '###', '.#.'],
  ['.##.', '#..#', '####', '.#..', '#...'],
  ['.#..', '###.', '.###', '..##', '..#.'],
  ['#.#.', '.#.#', '....', '#.#.', '.#.#'],
  ['.#', '##', '.#', '.#', '.#'],
  ['.##.', '#..#', '#..#', '.##.', '####'],
  ['#..#', '.##.', '####', '.##.', '#..#'],
  ['..#', '.##', '###', '.##', '..#'],
  ['##..', '.#..', '.##.', '..##', '...#'],
  ['.#.', '###', '#.#', '#.#', '###'],
  ['#.#', '###', '.#.', '.#.', '###'],
];

/** columns of glyphs inside a rectangular region of a face (carved or painted) */
export function glyphPanel(m: VoxelModel, face: Face, u0: number, u1: number, yBot: number, yTop: number, from: number, seed: number, opts: { color?: number; carve?: boolean } = {}) {
  const r = rngOf(seed, 77);
  const flip = face === 'z-' || face === 'x+';
  const lo = Math.min(u0, u1), hi = Math.max(u0, u1);
  let y = yTop;
  while (y - 4 >= yBot) {
    let u = lo;
    while (u + 2 <= hi) {
      const g = r.pick(GLYPHS);
      const w = g[0].length;
      if (u + w - 1 > hi) break;
      stampBitmap(m, face, g, flip ? hi - (u - lo) : u, y, from, { carve: opts.carve ?? true, color: opts.color, flipU: flip });
      u += w + 1;
    }
    y -= 6;
  }
}
