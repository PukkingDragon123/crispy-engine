// AVATAR OF KHONSU (first boss) + THE HAND OF KHONSU.
//
// Khonsu, the moon god who crosses the night sky. His avatar is a towering,
// hunched mummy (~3 m to the crown of the head, 1/56 m voxels). Aged linen is
// wrapped tight over a gaunt body (ribs, spine, collarbones and knees show
// through) in layered, sagging bands with cross-straps, resin stains and dust,
// and torn gaps that open onto a starry void inside him. Face fully in voxels:
// a dark gap in the wraps, deep slanted sockets with tiny moon-silver pinpoint
// pupils, heavy linen brows, a polished silver falcon nose-hook, a gaunt jaw
// with dry teeth, the braided sidelock of youth. Lunar crown: a hand-beaten
// silver crescent (asymmetric horns, chipped, layered spine) cradling a
// cratered gold full moon on a flared modius, with bead charms hanging at the
// temples. Usekh collar, moon-scarab pectoral, gold & lapis bands, and a huge
// hand-forged CRESCENT-MOON SCYTHE (`weapon`, fore_r; meta.weaponTip, socket
// `blade_tip`) with charms on chains. Everything that moves is its own part:
// jaw, brows, crown charms, scythe charms and the grip ribbon, and every loose
// wrap ribbon (`ribbon1`…). Longer wrap streamers from `cape_anchor` are engine
// cloth (meta.cloth.cape).
// `khonsu_avatar_enraged` (phase 3): stained wraps unravelling, wide void tears,
// broken collar beads, cracked crown disc, broken horn, chipped blade.
//
// The Hand (1/24 m, ~12 m): moon-silver divine skin with a faint star speckle,
// tendons, knuckle wrinkles, palm lines, nails, gold rings, and a faint crescent
// glyph on the palm (its only glow). Linen wraps at the wrist tear apart into
// threads, loose ribbons (rig parts) and a billowing cloud. Rig: `palm` root
// (wrist at origin, fingers +Y, palm faces +Z, thumb on +X), fingers f1 (index)
// … f4 (little) × 3 phalanges, thumb t_1..t_3, each pivot at its knuckle;
// +rotation.x curls a finger into the palm.
import { TRig, Ramp, RigSpec, VoxelModel, V3, ell, seg, chain, bossExpressions, rbox, VF } from './tk';

// ----------------------------------------------------------------------------- palette (natural, aged; clear colour regions)
const LINEN: Ramp = { base: 0xcdbf9f, shade: 0xa99b7c, hi: 0xe2d7ba, dark: 0x766a50 };
const LINEN_E: Ramp = { base: 0xb9a886, shade: 0x968566, hi: 0xd0c3a2, dark: 0x5c5039 };
const MOON: Ramp = { base: 0xc9d2e2, shade: 0x96a1b8, hi: 0xf0f4fb, dark: 0x5f6a82 };
const GOLD: Ramp = { base: 0xd2a63c, shade: 0xa47b25, hi: 0xf0d273, dark: 0x6a4a12 };
const LAPIS: Ramp = { base: 0x2f4f9c, shade: 0x22397a, hi: 0x4e72c4, dark: 0x16244e };
const CARNELIAN = 0xa4402a;
const TURQ = 0x3aa596;
const RESIN = 0x6e5032;
const DUST = 0xc4a678;
const HAIR = [0x2c2219, 0x19120d, 0x3b2e22];
const VOID = [0x0a1230, 0x111c46, 0x182760];
const STAR = [0xf2f5ff, 0xb4c3f4, 0xffe7b0];
const SOCKET = [0x0b0806, 0x17100b];
const PUPIL = [0xeef4ff, 0xb7c6ea];
const TOOTH = [0xc9b78c, 0x9a8862];
const MARK = 0x010203; // linen still to be wrapped
const TORN = 0x020304; // torn linen lip / crease
const STRAP = 0x030201; // raised strap / pleat

// ----------------------------------------------------------------------------- utilities
function h3(x: number, y: number, z: number, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** smooth value noise on a `cell`-sized lattice, 0..1 */
function vnoise(x: number, y: number, z: number, cell: number, s = 0) {
  const fx = x / cell, fy = y / cell, fz = z / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const tx = fx - ix, ty = fy - iy, tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), sz = tz * tz * (3 - 2 * tz);
  const c = (a: number, b: number, d: number) => h3(ix + a, iy + b, iz + d, s);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy), l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy), sz);
}
function mixc(a: number, b: number, t: number) {
  t = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
const col = (m: VoxelModel, x: number, y: number, z: number) => {
  const v = m.get(x, y, z);
  return v === undefined ? -1 : v & 0xffffff;
};
function isSurf(m: VoxelModel, x: number, y: number, z: number) {
  return !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z) || !m.has(x, y - 1, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
}
/** front-most filled z at column (x, y) */
function zfAt(m: VoxelModel, x: number, y: number, from = 400, to = -400) {
  for (let z = from; z > to; z--) if (m.has(x, y, z)) return z;
  return -9999;
}
/** back-most filled z at column (x, y) */
function zbAt(m: VoxelModel, x: number, y: number, from = -400, to = 400) {
  for (let z = from; z < to; z++) if (m.has(x, y, z)) return z;
  return 9999;
}
/** remove voxels fully enclosed by their 26 neighbours (dense-grid version, fast on big parts) */
function fastHollow(m: VoxelModel) {
  if (m.count < 64) return m;
  const b = m.bounds();
  const sx = b.maxX - b.minX + 3, sy = b.maxY - b.minY + 3, sz = b.maxZ - b.minZ + 3;
  const ox = b.minX - 1, oy = b.minY - 1, oz = b.minZ - 1;
  const g = new Uint8Array(sx * sy * sz);
  const P: number[] = [];
  m.forEach((x, y, z) => {
    g[x - ox + sx * (y - oy + sy * (z - oz))] = 1;
    P.push(x, y, z);
  });
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i] - ox, y = P[i + 1] - oy, z = P[i + 2] - oz;
    let full = true;
    for (let dz = -1; dz <= 1 && full; dz++)
      for (let dy = -1; dy <= 1 && full; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (!g[x + dx + sx * (y + dy + sy * (z + dz))]) {
            full = false;
            break;
          }
    if (full) m.del(P[i], P[i + 1], P[i + 2]);
  }
  return m;
}
const DIRS: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function centroidOf(m: VoxelModel, pred?: (c: number) => boolean): V3 {
  let sx = 0, sy = 0, sz = 0, n = 0;
  m.forEach((x, y, z, c) => {
    if (pred && !pred(c)) return;
    sx += x;
    sy += y;
    sz += z;
    n++;
  });
  return n ? [sx / n, sy / n, sz / n] : [0, 0, 0];
}
/** the empty neighbour direction that best faces away from `c` (a cheap surface normal) */
function outward(m: VoxelModel, x: number, y: number, z: number, c: V3): V3 | null {
  const vx = x - c[0], vy = (y - c[1]) * 0.5, vz = z - c[2];
  let best: V3 | null = null, bd = -1e9;
  for (const d of DIRS) {
    if (m.has(x + d[0], y + d[1], z + d[2])) continue;
    const dot = d[0] * vx + d[1] * vy + d[2] * vz;
    if (dot > bd) {
      bd = dot;
      best = d;
    }
  }
  return best;
}

/** sculpting in "base" units scaled onto a finer grid: base coordinate b ↦ voxel index b·S */
class Sc {
  constructor(readonly S: number) {}
  /** scaled voxel-index range covering the base range [a, b] */
  rng(a: number, b: number): [number, number] {
    return [Math.floor(a * this.S), Math.ceil(b * this.S)];
  }
  /** pivot (mesh coordinate) of a base pivot */
  P(p: V3): V3 {
    const S = this.S;
    return [(p[0] - 0.5) * S + 0.5, (p[1] - 0.5) * S + 0.5, (p[2] - 0.5) * S + 0.5];
  }
  v(p: V3): V3 {
    return [p[0] * this.S, p[1] * this.S, p[2] * this.S];
  }
  ell(m: VoxelModel, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: number, f?: number) {
    const S = this.S;
    return ell(m, cx * S, cy * S, cz * S, rx * S, ry * S, rz * S, c, f);
  }
  /** organic lump: an ellipsoid whose surface is pushed in and out by noise (beads, nuggets, knots) */
  blob(m: VoxelModel, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: number | ((x: number, y: number, z: number) => number), s = 0, amp = 0.22, cell = 0.9, f?: number) {
    const S = this.S;
    const R = 1 + amp;
    const [x0, x1] = this.rng(cx - rx * R, cx + rx * R), [y0, y1] = this.rng(cy - ry * R, cy + ry * R), [z0, z1] = this.rng(cz - rz * R, cz + rz * R);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const d = Math.hypot((x / S - cx) / rx, (y / S - cy) / ry, (z / S - cz) / rz);
          if (d > 1 + amp * (vnoise(x, y, z, cell * S, s) - 0.5) * 2) continue;
          m.set(x, y, z, typeof c === 'number' ? c : c(x, y, z), f);
        }
    return m;
  }
  seg(m: VoxelModel, a: V3, b: V3, r: number, c: number, f?: number, r1?: number) {
    return seg(m, this.v(a), this.v(b), r * this.S, c, f, r1 === undefined ? undefined : r1 * this.S);
  }
  chain(m: VoxelModel, pts: V3[], radii: number[], c: number, f?: number) {
    return chain(m, pts.map((p) => this.v(p)), radii.map((r) => r * this.S), c, f);
  }
  /** rounded box over the base range [x0..x1] etc. (inclusive base cells) */
  box(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, r = 1, axes = 'xyz', f?: number) {
    const S = this.S;
    return rbox(m, Math.round(x0 * S), Math.round(y0 * S), Math.round(z0 * S), Math.round((x1 + 1) * S) - 1, Math.round((y1 + 1) * S) - 1, Math.round((z1 + 1) * S) - 1, c, r * S, axes, f);
  }
}

// ----------------------------------------------------------------------------- organic surface passes
/** break up primitive-perfect surfaces: noise-driven sags and swellings on the wrapped flesh */
function lumpify(Z: Sc, m: VoxelModel, s: number, amt = 1) {
  const S = Z.S;
  const c = centroidOf(m, (k) => k === MARK);
  const add: [number, number, number][] = [], del: [number, number, number][] = [];
  m.forEach((x, y, z, k) => {
    if (k !== MARK || !isSurf(m, x, y, z)) return;
    const n = vnoise(x, y, z, 3.4 * S, s);
    if (n > 1 - 0.27 * amt) {
      const d = outward(m, x, y, z, c);
      if (d) add.push([x + d[0], y + d[1], z + d[2]]);
    } else if (n < 0.17 * amt) {
      const d = outward(m, x, y, z, c);
      if (d && m.has(x - d[0], y - d[1], z - d[2]) && m.has(x - 2 * d[0], y - 2 * d[1], z - 2 * d[2])) del.push([x, y, z]);
    }
  });
  for (const [x, y, z] of del) m.del(x, y, z);
  for (const [x, y, z] of add) m.set(x, y, z, MARK);
}

/** layered wraps: every third band stands one voxel proud of the body, so the bands overlap like real linen */
function raiseBands(Z: Sc, m: VoxelModel, o: { s?: number; period?: number; tx?: number; tz?: number; txFn?: (yb: number) => number }) {
  const S = Z.S;
  const s = o.s ?? 0, Pv = Math.max(4, Math.round((o.period ?? 3) * S)), tx = o.tx ?? 0.42, tz = o.tz ?? 0.28;
  const c = centroidOf(m, (k) => k === MARK);
  const add: [number, number, number][] = [];
  m.forEach((x, y, z, k) => {
    if (k !== MARK || !isSurf(m, x, y, z)) return;
    const uv = y + (o.txFn ? o.txFn(y / S) : tx) * x + tz * z + s * 7;
    const band = Math.floor(uv / Pv), fv = uv - band * Pv;
    if (((band % 3) + 3) % 3 !== 0 || fv < 1 || fv >= Pv - 0.5) return;
    const d = outward(m, x, y, z, c);
    if (d && d[1] === 0) add.push([x + d[0], y, z + d[2]]);
  });
  for (const [x, y, z] of add) m.set(x, y, z, MARK);
}

/** a torn gap in the wraps (base coords): carve the shell, the exposed inside is starry night */
function voidTear(Z: Sc, m: VoxelModel, c: V3, r: V3, s = 0) {
  const S = Z.S;
  const d2 = (x: number, y: number, z: number) => ((x / S - c[0]) / r[0]) ** 2 + ((y / S - c[1]) / r[1]) ** 2 + ((z / S - c[2]) / r[2]) ** 2;
  const inside = (x: number, y: number, z: number, k: number) => d2(x, y, z) <= k * (0.75 + 0.5 * vnoise(x, y, z, 1.6 * S, s));
  for (let pass = 0; pass < 2; pass++) {
    const del: V3[] = [];
    m.forEach((x, y, z) => {
      if (inside(x, y, z, 1) && isSurf(m, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) m.del(x, y, z);
  }
  const todo: [number, number, number, number][] = [];
  m.forEach((x, y, z, cc) => {
    if (!isSurf(m, x, y, z)) return;
    if (inside(x, y, z, 1.08)) {
      const h = h3(x, y, z, s);
      const v = h < 0.03 ? STAR[0] : h < 0.045 ? STAR[1] : h < 0.05 ? STAR[2] : vnoise(x, y, z, 2 * S, s + 9) > 0.55 ? VOID[2] : VOID[1];
      todo.push([x, y, z, v]);
    } else if (inside(x, y, z, 1.7) && cc === MARK) todo.push([x, y, z, TORN]);
  });
  for (const [x, y, z, v] of todo) m.set(x, y, z, v, v === STAR[0] ? VF.EMISSIVE : VF.SOLID);
}

/**
 * Linen colours in clear regions: the raised layer is light, the middle band
 * plain, the third band a touch darker, one shaded seam row per band; resin
 * stains and desert dust in two flat steps. Only touches MARK / TORN / STRAP.
 */
function wrapPaint(Z: Sc, m: VoxelModel, R: Ramp, o: { s?: number; period?: number; tx?: number; tz?: number; stain?: number; dustY?: number; txFn?: (yb: number) => number } = {}) {
  const S = Z.S;
  const s = o.s ?? 0, Pv = Math.max(4, Math.round((o.period ?? 3) * S)), tx = o.tx ?? 0.42, tz = o.tz ?? 0.28, stain = o.stain ?? 0.22, dustY = o.dustY ?? 12;
  const todo: [number, number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    if (c !== MARK && c !== TORN && c !== STRAP) return;
    const yb = y / S;
    let v: number;
    if (c === TORN) v = vnoise(x, y, z, 1.2 * S, s) < 0.5 ? R.dark : R.shade;
    else if (c === STRAP) v = R.hi;
    else {
      const uv = y + (o.txFn ? o.txFn(yb) : tx) * x + tz * z + s * 7;
      const band = Math.floor(uv / Pv), fv = uv - band * Pv;
      const b3 = ((band % 3) + 3) % 3;
      v = b3 === 0 ? mixc(R.base, R.hi, 0.55) : b3 === 1 ? R.base : mixc(R.base, R.shade, 0.35);
      if (fv < 1) v = R.shade;
    }
    const n = vnoise(x, y, z, 7 * S, s + 23);
    if (n > 1 - stain * 0.45) v = mixc(v, RESIN, 0.6);
    else if (n > 1 - stain) v = mixc(v, RESIN, 0.32);
    if (yb < dustY * 0.45) v = mixc(v, DUST, 0.45);
    else if (yb < dustY) v = mixc(v, DUST, 0.22);
    todo.push([x, y, z, v]);
  });
  for (const [x, y, z, v] of todo) m.set(x, y, z, v);
}

/** metal in clear regions: lit top edges, shaded undersides */
function metalFinish(m: VoxelModel, ramps: Ramp[]) {
  const map = new Map<number, Ramp>();
  for (const r of ramps) map.set(r.base, r);
  const todo: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    const r = map.get(c);
    if (!r) return;
    if (!m.has(x, y + 1, z)) todo.push([x, y, z, mixc(c, r.hi, 0.5), f]);
    else if (!m.has(x, y - 1, z)) todo.push([x, y, z, mixc(c, r.shade, 0.5), f]);
  });
  for (const [x, y, z, v, f] of todo) m.set(x, y, z, v, f);
}

/** sculpt a loose frayed linen ribbon hanging from base point p: a curling strip that splits into threads */
function ribbonInto(Z: Sc, m: VoxelModel, p: V3, len: number, R: Ramp, s = 0, w = 1.4, sway = 0.9, lean = 0.22) {
  const S = Z.S;
  const N = Math.round(len * S), W = Math.max(2, Math.round(w * S));
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const ox = Math.sin(t * 5 + s) * sway * S, oz = t * len * lean * S + Math.sin(t * 3.1 + s * 2) * 0.6 * S;
    const twist = Math.sin(t * 4 + s) * 0.6; // the strip turns as it falls
    const split = t > 0.72;
    for (let j = 0; j < W; j++) {
      if (split && (j % 2 === 1 || h3(i, j, 7, s) < (t - 0.72) * 2.2)) continue;
      const jj = j - W / 2;
      const x = Math.round(p[0] * S + ox + jj * Math.cos(twist)), y = Math.round(p[1] * S - i), z = Math.round(p[2] * S + oz + jj * Math.sin(twist));
      const edge = j === 0 || j === W - 1;
      m.set(x, y, z, split ? R.shade : edge ? R.shade : Math.floor(i / (2.2 * S)) % 2 ? R.base : mixc(R.base, R.hi, 0.4));
    }
  }
}
/** a ribbon as its own rig part (pivot at the knot) so the engine can sway it */
function addRibbon(rig: TRig, Z: Sc, parent: string, name: string, p: V3, len: number, R: Ramp, s = 0, w = 1.4, sway = 0.9, lean = 0.22) {
  const m = rig.part(name, parent, Z.P(p));
  Z.blob(m, p[0], p[1] + 0.2, p[2], w * 0.55, 0.7, 0.6, R.shade, s + 3, 0.25); // the knot it hangs from
  ribbonInto(Z, m, p, len, R, s, w, sway, lean);
  return m;
}

/** paint surface voxels in base y range [y0, y1] (wavy band edges optional) */
function bandY(Z: Sc, m: VoxelModel, y0: number, y1: number, c: (xb: number, yb: number, zb: number) => number, f?: number, pred?: (x: number, y: number, z: number) => boolean, wave = 0) {
  const S = Z.S;
  const todo: V3[] = [];
  m.forEach((x, y, z) => {
    const yb = y / S - (wave ? Math.sin(Math.atan2(x, z) * 2 + y0) * wave : 0);
    if (yb >= y0 && yb < y1 + 1 / S && isSurf(m, x, y, z) && (!pred || pred(x, y, z))) todo.push([x, y, z]);
  });
  for (const [x, y, z] of todo) m.set(x, y, z, c(x / S, y / S, z / S), f);
}

/** a small organic crescent pendant in the XY plane (chipped, uneven horns) */
function crescentCharm(Z: Sc, m: VoxelModel, cx: number, cy: number, cz: number, r: number, c: number, s: number) {
  const S = Z.S;
  const [x0, x1] = Z.rng(cx - r * 1.2, cx + r * 1.2), [y0, y1] = Z.rng(cy - r * 1.2, cy + r * 1.2), [z0, z1] = Z.rng(cz - 0.3, cz + 0.3);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const xb = x / S - cx, yb = y / S - cy;
      const a = Math.hypot(xb, yb), b = Math.hypot(xb - r * 0.18, yb - r * 0.42);
      if (a > r * (0.92 + 0.16 * vnoise(x, y, 0, 0.5 * S, s)) || b < r * 0.82) continue;
      for (let z = z0; z <= z1; z++) m.set(x, y, z, b < r * 0.95 ? MOON.hi : c, VF.METAL);
    }
}

// ============================================================================= AVATAR
export function khonsuAvatarRig(o: { enraged?: boolean } = {}): RigSpec {
  const E = !!o.enraged;
  const VS = 1 / 56;
  const Z = new Sc(2);
  const S = Z.S;
  const L = E ? LINEN_E : LINEN;
  const rig = new TRig(E ? 'khonsu_avatar_enraged' : 'khonsu_avatar', VS);
  const metal: number = VF.METAL;

  // ------------------------------------------------------------------ pelvis + pleated kilt with a gold hem
  const pel = rig.part('pelvis', undefined, Z.P([0.5, 41, 0.5]));
  Z.ell(pel, 0, 42.5, 0, 9.4, 5, 6.8, MARK);
  Z.ell(pel, 0, 38.6, -0.5, 8.6, 3.6, 6, MARK);
  Z.ell(pel, 0, 39, -4.8, 7.6, 4, 3.2, MARK); // buttocks
  {
    const [y0, y1] = Z.rng(30.5, 41.5), [x0, x1] = Z.rng(-7, 7), [zz0, zz1] = Z.rng(5.6, 8.4);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        for (let z = zz0; z <= zz1; z++) {
          const yb = y / S, xb = x / S, zb = z / S;
          // asymmetric, sagging hem; pleats fan out toward the bottom
          const hemY = 31 + Math.sin(xb * 0.7 + 0.4) * 0.6 + (xb > 0 ? 0.5 : 0);
          if (yb < hemY) continue;
          const w = 4.1 + (41.5 - yb) * 0.17;
          if (Math.abs(xb) > w || zb > 5.6 + 1.3 + Math.cos(xb * 2.2 - (41.5 - yb) * 0.1) * 0.4) continue;
          const hem = yb < hemY + 0.9 || Math.abs(xb) > w - 0.6;
          pel.set(x, y, z, hem ? GOLD.base : Math.floor((xb + 20 + (41.5 - yb) * 0.06) / 0.95) % 2 ? MARK : STRAP, hem ? VF.METAL : VF.SOLID);
        }
    for (const s of [1, -1]) Z.blob(pel, s * 9.4, 36.5, 0, 0.9, 3.8, 4.4, MARK, 31 + s, 0.18, 1.4); // side flaps
  }
  // ------------------------------------------------------------------ legs (gaunt: knee caps, shin ridge, tendons, shaped wrapped feet)
  const th = rig.part('thigh_l', 'pelvis', Z.P([6.5, 40, 0.5]));
  Z.seg(th, [6, 40, 0], [6.8, 23, 1], 4.4, MARK, undefined, 3.4);
  Z.ell(th, 6.4, 33, 1.4, 4.1, 7, 4.3, MARK);
  Z.ell(th, 8, 30, -0.5, 2, 6, 2.8, MARK);
  const sh = rig.part('shin_l', 'thigh_l', Z.P([7.3, 22.5, 1.5]));
  Z.ell(sh, 6.8, 22, 1.3, 3.6, 3.3, 3.6, MARK);
  Z.blob(sh, 6.8, 22.4, 4.4, 2, 2.2, 1.2, MARK, 41); // knee cap
  Z.seg(sh, [6.8, 21, 1], [6.8, 6, -0.6], 3.2, MARK, undefined, 2.2);
  Z.ell(sh, 6.8, 16, -1.4, 2.9, 5, 2.7, MARK); // calf
  Z.seg(sh, [6.8, 20, 3.3], [6.8, 7, 1.9], 0.75, MARK); // shin bone ridge
  Z.seg(sh, [6.8, 9, -2.7], [6.8, 3.5, -3.1], 0.95, MARK); // achilles
  Z.blob(sh, 6.8, 2.4, -1.8, 2.2, 2.4, 2.1, MARK, 42); // heel
  Z.blob(sh, 6.8, 0.75, 1.6, 2.15, 0.85, 4.6, MARK, 44, 0.12, 1.2); // sole: flat, splayed, uneven
  Z.blob(sh, 6.8, 2.4, 2.4, 2.2, 1.5, 3.4, MARK, 43); // instep
  for (let t = 0; t < 5; t++) {
    const tx = 5.2 + t * 0.95, len = t === 0 ? 2.6 : 2.2 - t * 0.25;
    Z.seg(sh, [tx, 0.95, 5.6], [tx + (t - 2) * 0.12, 0.85, 5.8 + len], 0.55 - t * 0.04, MARK);
  }
  // ------------------------------------------------------------------ torso: lean & hunched — ribs, spine, shoulder blades, collarbones
  const T = rig.part('torso', 'pelvis', Z.P([0.5, 46, 0.5]));
  Z.ell(T, 0, 49, 0.6, 8.6, 6.4, 6.4, MARK); // sunken belly
  Z.ell(T, 0, 56.5, 2.2, 11.6, 9, 8.2, MARK);
  Z.ell(T, 0.4, 60, -3.2, 11, 6.2, 6.4, MARK); // hump (slightly off-centre)
  for (const s of [1, -1]) {
    Z.ell(T, s * 6.5, 63, -1, 5.4, 3.3, 4.6, MARK); // trapezius
    Z.blob(T, s * 5.6, 59, -8, 3.8, 4.4, 1.6, MARK, 50 + s); // shoulder blade
    Z.seg(T, [s * 2, 63.6, 6.2], [s * 10.2, 63.1, 2.6], 0.9, MARK); // collarbone
    for (let i = 0; i < 5; i++) {
      const y = 49.5 + i * 2.1;
      Z.seg(T, [s * 6, y + 0.8, 6.8 - i * 0.1], [s * (10.2 - i * 0.2), y, 1.4], 0.65, MARK); // ribs through the wraps
    }
  }
  for (let y = 47; y <= 64; y += 1.6) Z.blob(T, 0, y, -6 - (y - 47) * 0.22, 1.15, 0.7, 1.05, MARK, Math.round(y * 3)); // vertebrae
  Z.seg(T, [0, 62, 1], [0, 69, 4.5], 3.9, MARK, undefined, 3.3);
  Z.seg(T, [2.1, 63, 3.3], [1.3, 68.5, 6.2], 0.75, MARK); // neck tendons
  Z.seg(T, [-2.1, 63, 3.3], [-1.3, 68.5, 6.2], 0.75, MARK);
  // ------------------------------------------------------------------ head (pushed forward on the neck)
  const H = rig.part('head', 'torso', Z.P([0.5, 67.5, 4.5]));
  Z.ell(H, 0, 74, 5, 6.3, 7, 6.9, MARK);
  Z.ell(H, 0, 69.6, 7, 4.6, 3.4, 4.8, MARK);
  Z.ell(H, 0, 72.2, 9.3, 3.9, 2.8, 2.4, MARK); // cheekbones under the wraps
  Z.blob(H, 0, 77.4, 10.2, 1.5, 1.2, 1.5, MARK, 61); // central brow
  for (const s of [1, -1]) Z.blob(H, s * 6.2, 74, 4, 1.2, 2, 1.5, MARK, 62 + s); // wrapped ears
  // ------------------------------------------------------------------ arms (long, sinewy)
  const A = rig.part('arm_l', 'torso', Z.P([12.5, 61, 0.5]));
  Z.ell(A, 12, 60, 0, 4.8, 4.8, 4.8, MARK);
  Z.seg(A, [13, 59, 0], [15, 46, -1], 3.7, MARK, undefined, 3.1);
  Z.ell(A, 14, 52, 1.4, 3, 4.6, 2.8, MARK); // biceps
  Z.ell(A, 14.4, 51, -2.6, 2.7, 5, 2.2, MARK); // triceps
  const F = rig.part('fore_l', 'arm_l', Z.P([15.5, 46, -0.5]));
  Z.ell(F, 15, 46, -1, 3.1, 3, 3.1, MARK);
  Z.blob(F, 15.2, 46.6, -3.4, 1.4, 1.7, 1.2, MARK, 71); // elbow point
  Z.seg(F, [15, 45, -1], [15.5, 33, 1], 3.0, MARK, undefined, 2.3);
  Z.ell(F, 15, 41.5, 0.2, 2.9, 5, 2.9, MARK);
  Z.seg(F, [16.4, 44, 1.3], [16.4, 35, 2], 0.6, MARK); // forearm tendon
  Z.blob(F, 16.7, 33.5, 0.6, 0.9, 1, 0.9, MARK, 72); // wrist bone
  // claw hand: bony knuckles, long jointed fingers curling forward, black nails
  Z.blob(F, 15.5, 29.2, 0.9, 2.5, 3.1, 1.9, MARK, 79, 0.14, 1.1); // bony palm
  Z.blob(F, 15.4, 31.6, 0.7, 2.1, 1.4, 1.7, MARK, 78, 0.14, 1); // heel of the hand
  for (let i = 0; i < 4; i++) {
    const x = 13.6 + i * 1.45;
    const ln = i === 1 || i === 2 ? 0.9 : 0;
    Z.blob(F, x, 26.6, 0.8, 0.75, 0.75, 1.1, MARK, 80 + i);
    Z.chain(F, [[x, 26.5, 1], [x - 0.15, 22.5 - ln, 2.2], [x - 0.2, 19.4 - ln, 4], [x - 0.1, 17.8 - ln, 5.6]], [0.74, 0.66, 0.56, 0.46], MARK);
    Z.blob(F, x - 0.15, 22.5 - ln, 2.1, 0.74, 0.7, 0.74, MARK, 84 + i); // joint
    Z.seg(F, [x - 0.15, 18.6 - ln, 4.8], [x - 0.1, 17.4 - ln, 6], 0.44, TOOTH[1]); // bone tip
    Z.blob(F, x - 0.1, 17.2 - ln, 6.2, 0.42, 0.52, 0.38, SOCKET[0], 88 + i, 0.3); // nail
  }
  Z.chain(F, [[13, 29, 2.3], [11.8, 26.2, 3.7], [11.9, 23.8, 4.9], [12.2, 22.6, 5.7]], [0.88, 0.75, 0.6, 0.46], MARK);
  Z.blob(F, 12.2, 22.3, 5.9, 0.42, 0.48, 0.38, SOCKET[0], 92, 0.3);

  // ------------------------------------------------------------------ organic: sags & swellings on every wrapped part (before the tears)
  for (const [p, s] of [['pelvis', 1], ['thigh_l', 2], ['shin_l', 3], ['torso', 4], ['head', 5], ['arm_l', 6], ['fore_l', 7]] as [string, number][]) lumpify(Z, rig.m(p), s * 17, p === 'head' ? 0.55 : 0.85);

  // ------------------------------------------------------------------ the face (fully voxel)
  // 1) a dark, ragged gap between the wraps across the eyes
  {
    const [x0, x1] = Z.rng(-7, 7), [y0, y1] = Z.rng(72, 77.5);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const xb = x / S, yb = y / S;
        const rag = (vnoise(x, y, 0, 0.8 * S, 5) - 0.5) * 0.5;
        if ((xb / 6.6) ** 2 + ((yb - 74.8) / (2.0 + rag)) ** 2 > 1) continue;
        const z = zfAt(H, x, y);
        if (z < -999) continue;
        H.del(x, y, z);
        H.set(x, y, z - 1, vnoise(x, y, z, 1.5 * S, 3) < 0.75 ? SOCKET[0] : SOCKET[1]);
      }
  }
  // 2) deep slanted sockets with tiny moon-silver pinpoint pupils
  const eyeC: V3[] = [];
  for (const s of [1, -1]) {
    const cxb = s * 3.15, cyb = 74.7;
    const [x0, x1] = Z.rng(cxb - 2.2, cxb + 2.2), [y0, y1] = Z.rng(cyb - 1.8, cyb + 1.8);
    const phi = s * 0.3, cs = Math.cos(phi), sn = Math.sin(phi);
    const ee = (x: number, y: number) => {
      const dx = x / S - cxb, dy = y / S - cyb;
      return ((dx * cs + dy * sn) / 1.8) ** 2 + ((-dx * sn + dy * cs) / 1.15) ** 2;
    };
    let zTop = -9999;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (ee(x, y) <= 1) zTop = Math.max(zTop, zfAt(H, x, y));
    const D = Math.round(3 * S);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const e = ee(x, y);
        if (e > 1.5) continue;
        if (e <= 1) {
          const depth = Math.round(D * (1 - e * 0.35)); // funnel: deeper in the middle
          for (let d = 0; d <= depth + 2; d++) H.del(x, y, zTop - d);
          H.set(x, y, zTop - depth - 1, SOCKET[0]);
          H.set(x, y, zTop - depth - 2, SOCKET[0]);
        }
        for (let z = zTop; z > zTop - D - 3; z--) if (H.has(x, y, z) && isSurf(H, x, y, z)) H.set(x, y, z, e < 1.25 ? SOCKET[0] : SOCKET[1]);
      }
    const px = Math.round(cxb * S), py = Math.round(cyb * S);
    const pz = zTop - D;
    H.set(px, py, pz, PUPIL[0], VF.EMISSIVE).set(px, py - 1, pz, PUPIL[1]); // a cold pinpoint, one voxel bright
    eyeC.push([px + 0.5, py + 0.5, pz + 0.5]);
  }
  // 3) heavy linen brows (rig parts — the engine tilts them for expressions)
  const brow = rig.part('brow_l', 'head', Z.P([3.3, 77.4, 10.4]));
  Z.blob(brow, 3.4, 77.1, 10.6, 3.4, 1.4, 2.0, MARK, 95, 0.16, 1.2);
  Z.blob(brow, 3.2, 77.8, 10.3, 3.0, 0.8, 1.8, STRAP, 96, 0.16, 1.2);
  // 4) polished silver falcon nose-hook
  {
    const [y0, y1] = Z.rng(70.9, 79.2), [x0, x1] = Z.rng(-1.3, 1.3);
    for (let y = y0; y <= y1; y++) {
      const yb = y / S;
      const w = 0.45 + Math.max(0, Math.min(1, (yb - 71) / 7)) * 0.75;
      const hook = yb < 73.2 ? Math.pow(1 - (yb - 70.9) / 2.3, 1.4) * 1.5 : 0;
      for (let x = x0; x <= x1; x++) {
        const xb = x / S;
        if (Math.abs(xb) > w) continue;
        const base = zfAt(H, x, Math.min(y, Math.round(78 * S)));
        if (base < -999) continue;
        const thick = Math.round((1.1 + hook) * S * (1 - (Math.abs(xb) / w) * 0.5));
        for (let d = 1; d <= thick; d++) H.set(x, y, base + d, yb > 78 ? GOLD.base : Math.abs(xb) < 0.22 ? MOON.hi : d === thick ? MOON.base : MOON.shade, metal);
      }
    }
  }
  // 5) the jaw: split off the lower face; dark mouth, dry teeth in a slit of the wraps
  const J = rig.part('jaw', 'head', Z.P([0.5, 71.5, 4.5]));
  {
    const mv: V3[] = [];
    H.forEach((x, y, z) => {
      if (y / S <= 70.6 && z / S >= 5.8) mv.push([x, y, z]);
    });
    for (const [x, y, z] of mv) {
      const c = col(H, x, y, z);
      H.del(x, y, z);
      J.set(x, y, z, c === -1 ? MARK : c);
    }
    const [x0, x1] = Z.rng(-3.4, 3.4), [y0, y1] = Z.rng(68.6, 71.4), [zz0, zz1] = Z.rng(4.6, 10);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = zz0; z <= zz1; z++) if (H.has(x, y, z) && isSurf(H, x, y, z)) H.set(x, y, z, SOCKET[0]);
    const [sx0, sx1] = Z.rng(-2.2, 2.6), [sy0, sy1] = Z.rng(69.9, 70.6);
    for (let x = sx0; x <= sx1; x++)
      for (let y = sy0; y <= sy1; y++) {
        const xb = x / S;
        if (y / S > 70.25 + Math.sin(xb * 1.7) * 0.25) continue; // ragged slit
        const z = zfAt(J, x, y);
        if (z < -999) continue;
        J.del(x, y, z);
        const tooth = vnoise(x, 0, 0, 0.55 * S, 21) > 0.48;
        J.set(x, y, z - 1, tooth ? (vnoise(x, 0, 0, 1.1 * S, 22) > 0.5 ? TOOTH[0] : TOOTH[1]) : SOCKET[0]);
      }
  }
  // 6) sidelock of youth: a heavy three-strand braid from the right temple, gold clasps
  {
    const pts: V3[] = [[-6.4, 76.5, 2], [-7.6, 71, 2.6], [-8.2, 66, 3.1], [-7.2, 62.4, 4.4], [-5.8, 61.6, 5.4]];
    const tmp = new VoxelModel('lock');
    Z.chain(tmp, pts, [1.35, 1.25, 1.15, 1.0, 0.8], HAIR[0]);
    tmp.forEach((x, y, z) => {
      const yb = y / S, q = (x + z) / S;
      const strand = ((Math.floor(yb * 1.6 + q * 1.4) % 3) + 3) % 3;
      let c = HAIR[strand];
      if (Math.abs(yb - 71) < 0.45 || Math.abs(yb - 66) < 0.45) c = GOLD.base;
      H.set(x, y, z, c, c === GOLD.base ? metal : VF.SOLID);
    });
    Z.blob(H, -5.8, 60.8, 5.6, 0.7, 1.1, 0.7, HAIR[1], 97, 0.3); // the tuft at the end
  }
  // 7) the lunar crown — hand-beaten, chipped and layered, never a perfect primitive
  {
    const [x0, x1] = Z.rng(-13, 13), [y0, y1] = Z.rng(79.6, 101), [zz0, zz1] = Z.rng(-1, 10);
    const chips = [1.1, 2.6, 4.4, 5.6]; // angles where the moon's rim is chipped
    const craters: [number, number, number][] = [[-2.6, 94.4, 1.4], [2.4, 90.6, 1.1], [3.1, 95.6, 0.7], [-1.2, 89.6, 0.8], [0.6, 93.0, 0.5]];
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = zz0; z <= zz1; z++) {
          const xb = x / S, yb = y / S, zb = z / S;
          // ---- modius: flared, uneven rim, layered bands
          if (yb < 84.4) {
            const ang = Math.atan2(xb, zb - 4.5);
            const rOut = 4.65 + (yb - 79.6) * 0.09 + 0.18 * Math.sin(5 * ang + 0.6);
            const top = 83.5 + 0.35 * Math.sin(3 * ang + 1.3) + 0.25 * (vnoise(x, 0, z, 1.2 * S, 7) - 0.5);
            if (yb > top) continue;
            const d = Math.hypot(xb, (zb - 4.5) * 1.05);
            let c = -1;
            if (yb < 80.6) {
              if (d <= rOut + 0.35) c = GOLD.base; // raised foot band
            } else if (yb < 81.5) {
              if (d <= rOut - 0.1) c = GOLD.shade;
            } else if (yb < 82.8) {
              if (d <= rOut) {
                const blk = Math.floor((ang + Math.PI) * 2.6 + 0.6 * Math.sin(ang * 3));
                const edge = Math.abs((ang + Math.PI) * 2.6 + 0.6 * Math.sin(ang * 3) - blk - 0.5) > 0.42;
                c = edge ? GOLD.dark : blk % 2 ? LAPIS.base : CARNELIAN;
              }
            } else if (d <= rOut + 0.25) c = Math.floor((ang + Math.PI) * 5) % 2 ? GOLD.hi : GOLD.base; // beaded rim
            if (c < 0 || (d < rOut - 1.2 && yb > 80.4)) continue;
            H.set(x, y, z, c, c === LAPIS.base || c === CARNELIAN ? VF.SOLID : metal);
            continue;
          }
          // ---- the full moon (behind): wobbly rim, raised lip, maria, craters, chips, slight tilt
          const tilt = -(yb - 92.6) * 0.1;
          const zr = zb - tilt;
          const dx = xb - 0.2, dy = yb - 92.6;
          const ang = Math.atan2(dy, dx);
          const dd = Math.hypot(dx, dy);
          let rD = 7.25 + 0.22 * Math.sin(3 * ang + 0.4) + 0.35 * (vnoise(Math.round(Math.cos(ang) * 40), Math.round(Math.sin(ang) * 40), 0, 9, 3) - 0.5);
          for (const ca of chips) {
            const da = Math.abs(((ang - ca + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            if (da < 0.16) rD -= (0.16 - da) * 6;
          }
          if (dd <= rD + 0.35 && zr >= 2.6 && zr <= 5.1) {
            let c = -1;
            if (zr < 3.3) c = GOLD.shade; // back plate, a little wider
            else if (dd <= rD) {
              if (zr < 4.5) {
                c = GOLD.base;
                if (dd < rD - 1.1 && vnoise(x, y, 0, 1.8 * S, 11) > 0.6) c = GOLD.shade; // maria: darker seas
              } else if (dd >= rD - 1.0 && vnoise(Math.round(ang * 30), 0, 0, 2, 5) < 0.85) c = GOLD.hi; // raised lip with dents
              else if (zr < 4.9) {
                for (const [cx, cy, cr] of craters) {
                  const dc = Math.hypot(xb - cx, yb - cy);
                  if (Math.abs(dc - cr) < 0.32) c = GOLD.hi; // crater rims stand up
                }
              }
            }
            if (c >= 0) H.set(x, y, z, c, metal);
          }
          // ---- the silver crescent (in front): asymmetric horns, chipped, layered with a raised spine
          const a = Math.hypot(xb, yb - 92), b = Math.hypot(xb - 0.7, yb - 96.3);
          const aAng = Math.atan2(xb, -(yb - 92));
          const Ro = 11.6 + 0.25 * Math.sin(4 * aAng + 0.3);
          const notch = Math.abs(aAng - 0.95) < 0.07 || Math.abs(aAng + 0.5) < 0.05;
          const curl = Math.hypot(xb + 9.7, yb - 98.7) < 0.95; // the left horn curls into a little lump
          if (((a <= Ro && b >= 10.1 && yb <= 99.4 && !(notch && a > Ro - 0.7)) || curl) && zb >= 4.6 && zb <= 7.4) {
            const tIn = b - 10.1, tOut = Ro - a, wdt = Math.max(0.01, tIn + tOut);
            const ridge = Math.abs(tIn - tOut) < wdt * 0.2;
            let c = -1;
            if (zb < 5.4) c = MOON.shade; // back plate
            else if (zb < 6.6) c = tIn < 0.55 ? MOON.hi : tOut < 0.45 ? MOON.shade : MOON.base;
            else if (ridge && !curl) c = MOON.hi; // the raised spine
            if (c >= 0) H.set(x, y, z, c, metal);
          }
        }
    if (E) {
      // cracks across the disc and a broken horn
      const crack: V3[] = [[2.2, 99.4, 0], [1.2, 97, 0], [2, 95, 0], [0, 93, 0], [-1.1, 91, 0], [0.8, 88.8, 0], [-1.8, 86.6, 0]];
      const fork: V3[] = [[2, 95, 0], [4.2, 94.2, 0], [5.6, 96.2, 0]];
      for (const line of [crack, fork])
        for (let i = 0; i < line.length - 1; i++)
          for (let t = 0; t <= 1; t += 0.5 / S) {
            const xb = line[i][0] + (line[i + 1][0] - line[i][0]) * t, yb = line[i][1] + (line[i + 1][1] - line[i][1]) * t;
            const x = Math.round(xb * S), y = Math.round(yb * S);
            for (let z = Math.round(2.4 * S); z <= Math.round(7.5 * S); z++) if (H.has(x, y, z)) H.set(x, y, z, 0x140e0a);
          }
      const del: V3[] = [];
      H.forEach((x, y, z) => {
        if (x / S > 7.4 + vnoise(x, y, 0, 0.8 * S, 2) && y / S > 94.8 && z / S > 2.4) del.push([x, y, z]);
      });
      for (const [x, y, z] of del) H.del(x, y, z);
    }
  }
  // 8) bead charms hanging at the temples from the modius (rig parts; mirrored to the right)
  {
    const cc = rig.part('crown_charm_l', 'head', Z.P([5.3, 80.8, 7.4]));
    for (let i = 0; i < 4; i++) {
      const yb = 80.2 - i * 1.25;
      Z.blob(cc, 5.3 + Math.sin(i * 1.3) * 0.12, yb, 7.6, 0.66, 0.6, 0.62, i % 2 ? GOLD.base : i === 2 ? CARNELIAN : LAPIS.base, 100 + i, 0.25, 0.5, i % 2 ? metal : VF.SOLID);
    }
    crescentCharm(Z, cc, 5.3, 74.2, 7.6, 1.55, MOON.base, 105);
  }

  // ------------------------------------------------------------------ mirror, then the right hand becomes a fist around the haft
  rig.mirrorLR();
  const FR = rig.m('fore_r');
  const HX = -15.5, HZ = 1, HR = 1.5; // haft axis (base) and radius
  const haftX = (yb: number) => HX + 0.18 * Math.sin(yb * 0.09); // hand-made: the haft is not perfectly straight
  const haftZ = (yb: number) => HZ + 0.12 * Math.sin(yb * 0.07 + 1);
  {
    const del: V3[] = [];
    FR.forEach((x, y, z) => {
      if (y / S <= 32.4) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) FR.del(x, y, z);
    Z.blob(FR, -15.6, 28.8, 0.6, 2.9, 3.5, 2.6, MARK, 120, 0.12, 1.3); // the clenched palm
    for (let i = 0; i < 4; i++) {
      // each finger wraps around the front of the haft and tucks its tip back in
      const y = 26.4 + i * 1.5 - (i === 3 ? 0.3 : 0);
      Z.chain(FR, [[-18.0, y + 0.2, 1.8], [-17.2, y, 3.7], [-15.4, y - 0.1, 4.2], [-13.4, y, 3.3], [-13.3, y + 0.1, 1.6]], [0.7, 0.72, 0.72, 0.68, 0.55], MARK);
      Z.blob(FR, -17.6 + i * 0.05, y + 0.4, 2.6, 0.72, 0.62, 0.66, TORN, 110 + i, 0.2, 0.6); // knuckle
    }
    Z.chain(FR, [[-13.2, 31.4, 1.6], [-13.4, 32.6, 3.6], [-15.0, 33.1, 4.6], [-16.4, 32.6, 4.4]], [0.95, 0.85, 0.72, 0.6], MARK); // thumb over the top
    const [x0, x1] = Z.rng(HX - HR - 0.6, HX + HR + 0.6), [y0, y1] = Z.rng(24, 34), [zz0, zz1] = Z.rng(HZ - HR - 0.6, HZ + HR + 0.6);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = zz0; z <= zz1; z++) if (Math.hypot(x / S - haftX(y / S), z / S - haftZ(y / S)) <= HR + 0.15) FR.del(x, y, z);
    lumpify(Z, FR, 130, 0.6);
  }

  // ------------------------------------------------------------------ starry tears
  const tears: [string, V3, V3][] = [
    ['torso', [8.4, 50.5, 4.2], [3.6, 4.6, 4]],
    ['torso', [-7.5, 59.5, -7], [3.4, 3.4, 3.4]],
    ['thigh_l', [7.4, 33, 4], [2.4, 3.6, 3]],
  ];
  if (E)
    tears.push(
      ['torso', [-6, 54, 9.5], [4.4, 5, 4]],
      ['torso', [3, 47, 7.5], [3.4, 3, 3]],
      ['torso', [0, 58, -9.5], [5, 4, 4]],
      ['thigh_l', [5, 28, 3.5], [3, 4, 3]],
      ['shin_l', [8, 14, 3], [2.5, 3.5, 2.5]],
      ['arm_l', [15, 54, 3], [2.5, 3.5, 3]],
      ['pelvis', [-6, 40, 6.5], [3, 3, 3]],
      ['head', [-4.5, 78, 9], [2, 2.4, 2.4]]
    );
  tears.forEach(([p, c, r], i) => voidTear(Z, rig.m(p), c, r, i * 13 + (E ? 5 : 0)));

  // ------------------------------------------------------------------ wraps on every body part: layered relief, chest straps, colour
  const wrapParts: [string, number, number, number][] = [
    ['pelvis', 0, 0.35, 0.2], ['thigh_l', 1, 0.45, 0.3], ['thigh_r', 2, -0.45, 0.3], ['shin_l', 3, 0.5, 0.25], ['shin_r', 4, -0.5, 0.25],
    ['torso', 5, 0.16, 0.08], ['arm_l', 6, 0.5, 0.35], ['arm_r', 7, -0.5, 0.35], ['fore_l', 8, 0.55, 0.3], ['fore_r', 9, -0.55, 0.3], ['jaw', 10, 0.1, 0.05],
  ];
  for (const [p, s, tx, tz] of wrapParts) raiseBands(Z, rig.m(p), { s, tx, tz, period: p === 'torso' ? 2.6 : 3 });
  const headTx = (yb: number) => (yb > 77.2 ? 0.36 : yb > 72 ? 0.06 : -0.3); // crossing layers of wraps
  raiseBands(Z, H, { s: 21, period: 2.4, tz: 0.04, txFn: headTx });
  {
    // chest cross straps (raised, slightly wandering)
    const add: V3[] = [];
    T.forEach((x, y, z) => {
      const xb = x / S, yb = y / S;
      if (z / S < 1 || yb < 44 || yb > 63 || T.has(x, y, z + 1)) return;
      for (const sg of [1, -1]) if (Math.abs(xb - sg * (yb - 53) * 0.82 - Math.sin(yb * 0.6) * 0.3) < 0.85) add.push([x, y, z]);
    });
    for (const [x, y, z] of add) T.set(x, y, z + 1, STRAP);
  }
  for (const [p, s, tx, tz] of wrapParts) wrapPaint(Z, rig.m(p), L, { s, tx, tz, stain: E ? 0.32 : 0.22, period: p === 'torso' ? 2.6 : 3 });
  wrapPaint(Z, H, L, { s: 21, period: 2.4, tz: 0.04, txFn: headTx, stain: E ? 0.3 : 0.24 });
  for (const b of ['brow_l', 'brow_r']) wrapPaint(Z, rig.m(b), L, { s: 22, period: 1.2, tx: 0, tz: 0 });

  // ------------------------------------------------------------------ jewellery (organic: uneven, layered, a little askew)
  // belt: gold with lapis/carnelian inlays of uneven widths, a silver crescent buckle
  bandY(Z, pel, 44.6, 46.4, (xb, yb) => {
    if (Math.abs(yb - 44.7) < 0.2 || Math.abs(yb - 46.3) < 0.2) return GOLD.dark;
    const k = Math.floor((xb + 30 + Math.sin(xb * 0.8) * 0.4) / 1.6) % 3;
    return k === 0 ? LAPIS.base : k === 1 ? GOLD.base : CARNELIAN;
  }, metal, undefined, 0.25);
  {
    const [x0, x1] = Z.rng(-2.6, 2.6), [y0, y1] = Z.rng(43.4, 47.8);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const xb = x / S, yb = y / S;
        const a = Math.hypot(xb, yb - 45.5), b = Math.hypot(xb - 0.25, yb - 46.7);
        if (a <= 2.4 + 0.15 * vnoise(x, y, 0, 0.6 * S, 13) && b >= 1.7) {
          const z = zfAt(pel, x, y);
          if (z > -999) for (let d = 1; d <= 2; d++) pel.set(x, y, z + d, b < 1.95 ? MOON.hi : d === 2 ? MOON.base : MOON.shade, metal);
        }
      }
  }
  // usekh collar: bead rows sagging a little to the left, irregular beads, teardrop fringe
  {
    const todo: [number, number, number, number][] = [];
    T.forEach((x, y, z) => {
      const xb = x / S, yb = y / S, zb = z / S;
      if (yb < 53.5 || zb < -1.5 || !isSurf(T, x, y, z) || (T.has(x, y, z + 1) && T.has(x, y + 1, z))) return;
      const r = Math.hypot(xb, (yb - 64.5 + xb * 0.04) * 1.15);
      if (r < 6 || r > 12.3) return;
      if (vnoise(x, y, z, 1.25 * S, 91) > (E ? 0.74 : 0.92)) return; // missing beads
      const ang = Math.atan2(xb, -(yb - 64.5));
      const bl = 0.85 + 0.15 * Math.sin(ang * 7 + r);
      const bead = Math.floor((ang * r) / bl);
      const sep = Math.abs((ang * r) / bl - bead - 0.5) > 0.38;
      let c: number;
      if (r < 6.7 || Math.abs(r - 8.1) < 0.22 || Math.abs(r - 10.05) < 0.22 || r > 11.5) c = GOLD.base;
      else if (r < 7.95) c = sep ? LAPIS.dark : LAPIS.base;
      else if (r < 9.85) c = sep ? MOON.shade : MOON.base;
      else c = sep ? GOLD.dark : bead % 2 ? TURQ : CARNELIAN;
      todo.push([x, y, z, c]);
    });
    for (const [x, y, z, c] of todo) {
      const fl = c === LAPIS.base || c === LAPIS.dark || c === TURQ || c === CARNELIAN ? VF.SOLID : metal;
      T.set(x, y, z, c, fl);
      if (!T.has(x, y, z + 1) && z / S > 1) T.set(x, y, z + 1, c, fl); // stands off the wraps
    }
    for (let i = -10; i <= 10; i++) {
      const xb = i * 1.05;
      const yb = 64.5 - xb * 0.04 - Math.sqrt(Math.max(0, 12.3 * 12.3 - xb * xb)) / 1.15 - 0.4;
      if (yb < 53) continue;
      const x = Math.round(xb * S), y = Math.round(yb * S);
      const z = zfAt(T, x, y + 1);
      if (z < -999) continue;
      if (E && h3(i, 3, 1) < 0.3) continue;
      Z.blob(T, xb, yb - 0.9, z / S + 0.6, 0.42, 0.8, 0.38, GOLD.base, 140 + i, 0.2, 0.5, metal); // teardrop
    }
  }
  // moon-scarab pectoral, hanging a little askew
  {
    const rot = 0.1, cr = Math.cos(rot), sr = Math.sin(rot);
    const [x0, x1] = Z.rng(-10.5, 10.5), [y0, y1] = Z.rng(47, 60);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const xr = x / S, yr = y / S - 53;
        const xb = xr * cr - yr * sr, yb = xr * sr + yr * cr + 53;
        const zs = zfAt(T, x, y);
        if (zs < -999) continue;
        const put = (c: number, h: number, fl: number = metal) => {
          for (let d = 1; d <= Math.max(1, Math.round(h * S)); d++) T.set(x, y, zs + d, c, fl);
        };
        const body = (xb / 2.6) ** 2 + ((yb - 51) / 3.2) ** 2;
        const head = (xb / 1.4) ** 2 + ((yb - 54.6) / 0.9) ** 2;
        if (body <= 1) {
          let c = MOON.base;
          if (Math.abs(xb) < 0.2 && yb < 53) c = MOON.dark; // elytra split
          else if (Math.abs(yb - 53.1) < 0.2) c = MOON.dark; // pronotum line
          else if (body > 0.75) c = MOON.shade;
          put(c, 1.1 + (1 - body) * 0.6);
          continue;
        }
        if (head <= 1) {
          put(MOON.hi, 0.9);
          continue;
        }
        const ax = Math.abs(xb);
        if (ax > 2.4 && ax < 10.2) {
          const yc = 51.6 + (ax - 2.4) * 0.28;
          const half = 1.6 - (ax - 2.4) * 0.09 - (xb < 0 ? 0.15 : 0);
          if (Math.abs(yb - yc) <= half) {
            const fb = Math.floor((ax - 2.4) / 0.9);
            let c = fb % 3 === 0 ? GOLD.base : fb % 3 === 1 ? LAPIS.base : TURQ;
            if (yb - yc > half - 0.35) c = GOLD.hi;
            put(c, 0.6, c === GOLD.base || c === GOLD.hi ? metal : VF.SOLID);
            continue;
          }
        }
        let leg = false;
        for (const [lx, ly] of [[2.4, 49.6], [2.6, 51.2], [2.2, 52.6]])
          if (Math.abs(ax - lx - 0.6) < 0.25 && Math.abs(yb - ly) < 0.6) leg = true;
        if (leg) {
          put(MOON.shade, 0.6);
          continue;
        }
        const a = Math.hypot(xb, yb - 57.2), b = Math.hypot(xb, yb - 58.6);
        if (a <= 3 && b >= 2.25) put(MOON.hi, 0.8);
        else if (Math.hypot(xb, yb - 57.9) <= 1.35) put(GOLD.hi, 0.7);
      }
  }
  // arm & wrist bands (wavy edges), armlets, anklets
  for (const s of ['l', 'r']) {
    bandY(Z, rig.m('arm_' + s), 52, 54.4, (_x, yb) => (Math.abs(yb - 53.2) < 0.4 ? LAPIS.base : Math.abs(yb - 52.1) < 0.2 || Math.abs(yb - 54.3) < 0.2 ? GOLD.dark : GOLD.base), metal, undefined, 0.3);
    bandY(Z, rig.m('arm_' + s), 57, 57.8, () => MOON.base, metal, undefined, 0.25);
    bandY(Z, rig.m('fore_' + s), 33.2, 35.4, (xb, yb) => (Math.abs(yb - 34.3) < 0.35 ? (Math.floor((xb + 40) / 0.8) % 2 ? MOON.base : LAPIS.base) : GOLD.base), metal, undefined, 0.2);
    bandY(Z, rig.m('shin_' + s), 4.8, 6.2, (_x, yb) => (Math.abs(yb - 5.5) < 0.25 ? LAPIS.base : GOLD.shade), metal, undefined, 0.3);
  }

  // ------------------------------------------------------------------ loose wrap ribbons — each its own rig part
  const rb: [string, V3, number][] = [
    ['fore_l', [16.8, 45, -3], 8], ['fore_r', [-16.8, 44, -3], 9],
    ['pelvis', [9.6, 40, 3.6], 13], ['pelvis', [-9.6, 39, 2.6], 10], ['pelvis', [3.6, 31.4, 7.2], 5],
    ['shin_l', [9.2, 21, 2.6], 6], ['shin_r', [-9.2, 20, 1.8], 7],
    ['head', [1, 73, -2.5], 9], ['arm_l', [17, 52, 0.8], 6],
  ];
  if (E)
    rb.push(
      ['arm_r', [-17, 56, 0], 14], ['torso', [8, 52, 8], 14], ['torso', [-10, 49, 5.4], 18], ['pelvis', [-6.4, 37, 6.6], 16],
      ['thigh_l', [10, 33, 1.8], 12], ['thigh_r', [-10, 30, 2.6], 15], ['fore_l', [17.6, 38, 0.8], 13], ['head', [-6, 70, 5], 10], ['shin_l', [4.2, 12, 3.4], 8]
    );
  rb.forEach(([p, at, len], i) => addRibbon(rig, Z, p, `ribbon${i + 1}`, at, len, L, i * 1.3, 1.4, 0.9, 0.2));

  // ------------------------------------------------------------------ the hand-forged crescent scythe
  const W = rig.part('weapon', 'fore_r', Z.P([HX + 0.5, 28.5, HZ + 0.5]));
  let tip: V3 = Z.v([HX, 73, 27.5]);
  {
    // haft: slightly bent, engraved gold with uneven lapis rings, linen grip, faceted silver butt spike
    const [x0, x1] = Z.rng(HX - HR - 1, HX + HR + 1), [y0, y1] = Z.rng(-4.5, 98), [zz0, zz1] = Z.rng(HZ - HR - 1, HZ + HR + 1);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        for (let z = zz0; z <= zz1; z++) {
          const yb = y / S;
          const ax = x / S - haftX(yb), az = z / S - haftZ(yb);
          const d = Math.hypot(ax, az), ang = Math.atan2(ax, az);
          if (yb < 2) {
            // faceted spike: a six-sided cross-section that wobbles and tapers to a hooked point
            const facet = Math.cos(((ang * 3) % Math.PI) - Math.PI / 2) * 0.12;
            const rr = HR * Math.max(0.12, (yb + 4.5) / 6.5) * (1 - facet);
            if (Math.hypot(ax - (yb < -2 ? (-2 - yb) * 0.12 : 0), az) > rr) continue;
            W.set(x, y, z, d < 0.45 ? MOON.hi : MOON.base, metal);
            continue;
          }
          const rr = HR * (1 + 0.05 * Math.sin(yb * 0.8) + (vnoise(0, y, 0, 2 * S, 3) - 0.5) * 0.1);
          const grip = yb >= 22 && yb <= 36;
          if (d > rr + (grip ? 0.3 : 0)) continue;
          const rp = (yb + 0.4 * Math.sin(ang * 2)) % 9;
          const ring = rp < 1.1;
          let c = GOLD.base;
          if (grip) c = Math.floor(yb * 2.2 + ang * 0.9) % 2 ? L.shade : L.base;
          else if (ring) c = rp < 0.25 || rp > 0.85 ? GOLD.dark : LAPIS.base;
          else if (Math.floor(yb * 1.5 + ang * 2.5) % 7 === 0) c = GOLD.shade; // spiral engraving
          W.set(x, y, z, c, grip || ring ? VF.SOLID : metal);
        }
    Z.blob(W, HX + 0.4, 36.2, HZ + 1.4, 1.1, 0.8, 0.9, L.shade, 150, 0.3); // the grip's knot
    // layered collar where the blade meets the haft: three rings of different sizes, a linen tie, moon medallions
    Z.blob(W, haftX(92), 92.1, haftZ(92), 2.5, 0.6, 2.5, GOLD.shade, 151, 0.12, 0.8, metal);
    Z.blob(W, haftX(94), 94.1, haftZ(94), 2.05, 1.6, 2.05, GOLD.base, 152, 0.1, 0.8, metal);
    Z.blob(W, haftX(96.5), 96.6, haftZ(96.5), 2.35, 1.2, 2.35, GOLD.base, 153, 0.12, 0.8, metal);
    bandY(Z, W, 93.8, 94.6, () => LAPIS.base, VF.SOLID, (x, y, z) => Math.hypot(x / S - haftX(y / S), z / S - haftZ(y / S)) > 1.7);
    Z.blob(W, HX - 1.9, 95.2, HZ + 0.4, 0.9, 1.3, 1.1, L.base, 154, 0.3); // linen tie
    for (const s of [1, -1]) crescentCharm(Z, W, HX + s * 2.7, 94.6, HZ, 1.0, MOON.base, 155 + s);
    // the blade: a crescent with a hammered, wandering outline, nicks, a layered spine and an inward-curling tip
    const Cy = 80, Cz = 8;
    const th0 = (-25 * Math.PI) / 180, th1 = (112 * Math.PI) / 180;
    let tipT = -1;
    const nicks = E ? [0.28, 0.37, 0.55] : [0.31, 0.58];
    const [by0, by1] = Z.rng(62, 105), [bz0, bz1] = Z.rng(-7, 33), [bx0, bx1] = Z.rng(HX - 1.6, HX + 1.6);
    for (let y = by0; y <= by1; y++)
      for (let z = bz0; z <= bz1; z++) {
        const yb = y / S, zb = z / S;
        const r = Math.hypot(yb - Cy, zb - Cz);
        const thv = Math.atan2(zb - Cz, yb - Cy);
        if (thv < th0 || thv > th1) continue;
        const t = (thv - th0) / (th1 - th0);
        let Ro = 21 + 0.35 * Math.sin(thv * 5 + 0.6) + (vnoise(Math.round(t * 60), 0, 0, 3, 7) - 0.5) * 0.4;
        if (t > 0.93) Ro -= 1.4 * ((t - 0.93) / 0.07) ** 2; // the tip curls inward
        let w = 6.8 * Math.pow(1 - t, 0.75) + 0.55;
        for (const n of nicks) if (Math.abs(t - n) < 0.022) w -= (0.022 - Math.abs(t - n)) * 45; // forging nicks in the edge
        if (r > Ro || r < Ro - Math.max(0.3, w)) continue;
        const de = r - (Ro - w);
        const half = de < 0.55 ? 0.28 : de < 1.4 ? 0.62 : r > Ro - 0.9 ? 1.2 : 0.98 * (1 - t * 0.45);
        let c = MOON.base;
        if (de < 0.55) c = MOON.hi; // honed edge
        else if (de < 1.4) c = mixc(MOON.base, MOON.hi, 0.45); // bevel
        else if (r > Ro - 0.9) c = MOON.shade; // thick spine
        else if (Math.abs(r - (Ro - 2.8)) < 0.34 && t < 0.8) c = MOON.dark; // fuller
        else if (Math.abs(r - (Ro - 4.3)) < 0.3 && t < 0.55) c = GOLD.base; // gold inlay
        for (let x = bx0; x <= bx1; x++) {
          if (Math.abs(x / S - HX) > half) continue;
          W.set(x, y, z, c, metal);
        }
        if (t > tipT) {
          tipT = t;
          tip = [HX * S + 0.5, y + 0.5, z + 0.5];
        }
      }
    // a hooked beard under the blade root
    Z.chain(W, [[HX, 91.5, 3.2], [HX, 89.6, 4.6], [HX, 89.2, 6.2]], [0.75, 0.55, 0.3], MOON.shade, metal);
    // inlaid moon phases along the flat of the blade (waxing → full → waning)
    for (let i = 0; i < 5; i++) {
      const t = 0.1 + i * 0.105;
      const thv = th0 + t * (th1 - th0);
      const rr = 21 - 5.2 + t * 2.2;
      const cyb = Cy + Math.cos(thv) * rr, czb = Cz + Math.sin(thv) * rr;
      const [y0b, y1b] = Z.rng(cyb - 1.1, cyb + 1.1), [z0b, z1b] = Z.rng(czb - 1.1, czb + 1.1);
      const phase = (i - 2) * 0.55;
      for (let y = y0b; y <= y1b; y++)
        for (let z = z0b; z <= z1b; z++) {
          const d = Math.hypot(y / S - cyb, z / S - czb);
          if (d > 0.95) continue;
          const lit = i === 2 || Math.hypot(y / S - cyb, z / S - czb - phase) > 0.85;
          for (const xs of [1, -1]) {
            const xo = Math.round((HX + xs * 1.05) * S);
            if (W.has(xo - xs, y, z)) W.set(xo, y, z, lit ? GOLD.hi : GOLD.dark, metal);
          }
        }
    }
    metalFinish(W, [GOLD, MOON]);
  }
  // scythe charms on gold chains — rig parts, so they swing
  {
    const charms: [number, number, number][] = [[HX - 3, 6, 0], [HX + 3.2, 8, 1], [HX - 2.2, 10.5, 2]];
    charms.forEach(([cx, len, kind], i) => {
      const m = rig.part(`charm${i + 1}`, 'weapon', Z.P([cx + 0.5, 91.8, HZ + 0.5]));
      const [y0, y1] = Z.rng(91.6 - len, 91.6);
      for (let y = y0; y <= y1; y++) {
        const x = Math.round(cx * S + Math.sin(y * 0.3) * 0.4), z = Math.round(HZ * S);
        const link = Math.floor(y / 3) % 2;
        m.set(x, y, z, link ? GOLD.dark : GOLD.base, metal);
        if (!link) m.set(x + 1, y, z, GOLD.shade, metal).set(x - 1, y, z, GOLD.shade, metal); // flat links
        else m.set(x, y, z + 1, GOLD.shade, metal).set(x, y, z - 1, GOLD.shade, metal); // turned links
      }
      const cyb = 91.6 - len - 1.8;
      if (kind === 1) {
        Z.blob(m, cx, cyb, HZ, 1.75, 1.75, 0.55, (x, y) => (vnoise(x, y, 0, 0.6 * S, 160 + i) > 0.6 ? GOLD.shade : GOLD.hi), 161 + i, 0.12, 0.6, metal); // little full moon with maria
      } else if (kind === 0) crescentCharm(Z, m, cx, cyb, HZ, 2.2, MOON.base, 162 + i);
      else {
        Z.blob(m, cx, cyb, HZ, 1.15, 1.55, 0.7, LAPIS.base, 163, 0.18, 0.6); // scarab body
        Z.blob(m, cx, cyb + 1.6, HZ, 0.7, 0.55, 0.55, GOLD.base, 164, 0.2, 0.5, metal); // head
        for (const s of [1, -1]) for (let k = 0; k < 3; k++) Z.seg(m, [cx + s * 0.9, cyb + 0.6 - k * 0.7, HZ], [cx + s * 1.7, cyb + 0.2 - k * 0.9, HZ], 0.24, GOLD.shade, metal);
      }
    });
    // the grip ribbon
    addRibbon(rig, Z, 'weapon', 'grip_ribbon', [HX + 0.6, 35.6, HZ + 1.9], 9, L, 170, 1.1, 0.6, 0.3);
  }
  // finish metals on the body parts
  for (const p of rig.parts) if (p.name !== 'weapon') metalFinish(p.model, [GOLD, MOON]);

  // ------------------------------------------------------------------ sockets, hollow, build
  rig.socket('cape_anchor', 'torso', Z.P([0.5, 62, -10]));
  rig.socket('chest', 'torso', Z.P([0.5, 56, 11.5]));
  rig.socket('head_top', 'head', Z.P([0.5, 100.5, 4.5]));
  rig.socket('hand_l', 'fore_l', Z.P([16, 27, 1.5]));
  rig.socket('hand_r', 'fore_r', Z.P([HX + 0.5, 28.5, HZ + 0.5]));
  rig.socket('blade_tip', 'weapon', tip);
  rig.socket('eye_glint_l', 'head', eyeC[0]);
  rig.socket('eye_glint_r', 'head', eyeC[1]);
  for (const p of rig.parts) fastHollow(p.model);
  return rig.build({
    kind: 'khonsu',
    boss: true,
    height: 3.0,
    headY: 74 * S * VS,
    crownTop: 100 * S * VS,
    radius: 0.62,
    weaponTip: tip,
    weaponBase: Z.P([HX + 0.5, 92, HZ + 0.5]),
    defaultExpression: E ? 'enraged' : 'smug',
    expressions: bossExpressions(0.5),
    cloth: { cape: [L.base, L.dark, GOLD.base] },
    swing: rig.parts.filter((p) => /^(ribbon\d+|charm\d|grip_ribbon|crown_charm_[lr])$/.test(p.name)).map((p) => p.name),
    enraged: E,
    noEyes: true,
  });
}

// ============================================================================= HAND
export function khonsuHandRig(): RigSpec {
  const VS = 1 / 24;
  const Z = new Sc(24 / 9);
  const S = Z.S;
  const SKIN: Ramp = { base: 0xc2cce2, shade: 0x939fbc, hi: 0xe6ecf8, dark: 0x67738f };
  const NAIL = 0xeae6f0;
  const SK = 0x030405; // skin marker
  const CREASE = 0x060708;
  const VEIN = 0x060709;
  const WRINKLE = 0x06070a;
  const rig = new TRig('khonsu_hand', VS);

  // ------------------------------------------------------------------ palm: a rounded, tapered, slightly cupped slab
  const palm = rig.part('palm', undefined, Z.P([0.5, 0, 0.5]));
  {
    const [x0, x1] = Z.rng(-16.5, 16.5), [y0, y1] = Z.rng(-1, 37.5), [zz0, zz1] = Z.rng(-7.5, 6);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = zz0; z <= zz1; z++) {
          const xb = x / S, yb = y / S, zb = z / S;
          const sm = Math.max(0, Math.min(1, yb / 20));
          let hw = 10.4 + 5 * sm * sm * (3 - 2 * sm);
          if (yb > 33.5) hw -= (yb - 33.5) * 0.9;
          if (xb < 0 && yb > 24) hw -= (yb - 24) * 0.14; // the little-finger edge curves in
          const back = -5.0 - 0.7 * Math.max(0, Math.min(1, (yb - 8) / 22));
          const cup = 1.25 * Math.max(0, 1 - ((xb / 7.5) ** 2 + ((yb - 19.5) / 9.5) ** 2));
          const front = 3.6 - cup + (yb < 9 ? 0.6 : 0);
          const zc = (front + back) / 2, hz = (front - back) / 2;
          const ux = Math.abs(xb) / hw, uz = (zb - zc) / hz;
          if (ux ** 4 + uz ** 2 > 1) continue;
          if (yb > 36.6 - ux * ux * 2.5 - (xb < 0 ? (-xb / 15) * 2.8 : 0)) continue; // knuckle line slopes toward the little finger
          palm.set(x, y, z, SK);
        }
    Z.blob(palm, 9.6, 10, 2.5, 6.2, 8.8, 3.3, SK, 1, 0.08, 4); // thenar (thumb pad)
    Z.blob(palm, -8.6, 9.5, 2.0, 5.2, 9.8, 2.9, SK, 2, 0.08, 4); // hypothenar
    Z.blob(palm, 0, 2.2, 1.0, 10.5, 3.6, 4.4, SK, 3, 0.06, 4); // heel
    for (const kx of [9.5, 2.5, -4.5, -10.5]) Z.blob(palm, kx, 34.8, -4.9, 3.1, 2.4, 2.0, SK, 4 + kx, 0.1, 1.5); // knuckles
    for (const kx of [9.5, 2.5, -4.5, -10.5]) Z.blob(palm, kx, 35, 2.6, 3.0, 2.0, 1.8, SK, 9 + kx, 0.1, 1.5); // pads under the fingers
    for (const kx of [9.5, 2.5, -4.5, -10.5]) Z.seg(palm, [kx * 0.32, 3, -5.35], [kx * 0.95, 33, -5.85], 0.75, SK, undefined, 0.85); // tendons
    Z.chain(palm, [[1.5, 2, -5.4], [4.2, 12, -5.6], [7.2, 22, -5.7], [8.4, 28, -5.6]], [0.45, 0.45, 0.42, 0.38], VEIN);
    Z.chain(palm, [[-2.5, 2, -5.4], [-4.6, 13, -5.6], [-3.6, 23, -5.7]], [0.42, 0.42, 0.38], VEIN);
    Z.chain(palm, [[4.2, 12, -5.6], [1.8, 19, -5.7], [-0.6, 26, -5.6]], [0.4, 0.38, 0.35], VEIN);
  }
  // ------------------------------------------------------------------ fingers: tapering phalanges, joints, pads, nails, rings
  const fingers: { n: string; x: number; y: number; w: number; L: number[]; rest: V3[] }[] = [
    { n: 'f1', x: 9.5, y: 36, w: 3.55, L: [13, 9, 7.5], rest: [[0.1, 0, -0.07], [0.16, 0, 0], [0.12, 0, 0]] },
    { n: 'f2', x: 2.5, y: 37.5, w: 3.65, L: [14, 10, 8], rest: [[0.08, 0, -0.01], [0.14, 0, 0], [0.12, 0, 0]] },
    { n: 'f3', x: -4.5, y: 36.5, w: 3.4, L: [13, 9.5, 7.5], rest: [[0.12, 0, 0.05], [0.17, 0, 0], [0.13, 0, 0]] },
    { n: 'f4', x: -10.5, y: 33, w: 2.95, L: [10, 7.5, 6], rest: [[0.16, 0, 0.14], [0.2, 0, 0], [0.15, 0, 0]] },
  ];
  const zc = -0.6;
  for (const f of fingers) {
    let y0 = f.y;
    let parent = 'palm';
    for (let k = 0; k < 3; k++) {
      const name = `${f.n}_${k + 1}`;
      const m = rig.part(name, parent, Z.P([f.x + 0.5, y0, zc + 0.5]), f.rest[k]);
      const y1 = y0 + f.L[k];
      const r0 = f.w * (1 - k * 0.11), r1 = f.w * (1 - (k + 1) * 0.11);
      Z.seg(m, [f.x, y0 + 0.4, zc], [f.x, y1 - (k === 2 ? r1 * 0.55 : 0.4), zc], r0, SK, undefined, r1);
      Z.blob(m, f.x, (y0 + y1) / 2, zc + r0 * 0.42, r0 * 0.78, (y1 - y0) * 0.36, r0 * 0.6, SK, k * 7 + f.x, 0.06, 3); // pad
      Z.blob(m, f.x, y0 + 0.9, zc - r0 * 0.5, r0 * 0.74, 1.7, 1.5, SK, k * 9 + f.x, 0.1, 1.2); // knuckle
      const [cx0, cx1] = Z.rng(f.x - r0, f.x + r0);
      for (const dy of k === 0 ? [1.1, 1.8] : [0.6, 1.3]) {
        const y = Math.round((y0 + dy) * S);
        for (let x = cx0; x <= cx1; x++) {
          const z = zfAt(m, x, y);
          if (z > -999 && Math.abs(x / S - f.x) < r0 * 0.8) m.set(x, y, z, CREASE);
        }
      }
      if (k > 0)
        for (const dy of [-0.4, 0.5, 1.3]) {
          for (let x = cx0; x <= cx1; x++) {
            const xr = (x / S - f.x) / r0;
            if (Math.abs(xr) > 0.7) continue;
            const y = Math.round((y0 + dy + xr * xr * 0.8) * S);
            const z = zbAt(m, x, y);
            if (z < 999) m.set(x, y, z, WRINKLE);
          }
        }
      if (k === 2) {
        // nail plate with lunula, cuticle and a pale free edge, raised off the back of the fingertip
        const [ny0, ny1] = Z.rng(y1 - 5.6, y1 - 0.6);
        for (let y = ny0; y <= ny1; y++)
          for (let x = cx0; x <= cx1; x++) {
            const xb = x / S, yb = y / S;
            if (Math.abs(xb - f.x) > r1 * 0.74) continue;
            const z = zbAt(m, x, y);
            if (z > 999) continue;
            const fromBase = yb - (y1 - 5.6);
            let c = NAIL;
            if (fromBase < 0.35) c = SKIN.shade; // cuticle
            else if (fromBase < 1.3 && Math.abs(xb - f.x) < r1 * 0.45) c = 0xf7f2f8; // lunula
            else if (yb > y1 - 1.4) c = 0xfbfaff; // free edge
            m.set(x, y, z, c, VF.METAL);
            if (fromBase > 0.35) m.set(x, y, z - 1, c, VF.METAL);
          }
      }
      if (k === 0 && (f.n === 'f1' || f.n === 'f3')) {
        // a hand-made gold ring: uneven band, a raised bezel and its stone
        const [ry0, ry1] = Z.rng(y0 + 5.4, y0 + 7.2), [rx0, rx1] = Z.rng(f.x - r0 - 0.8, f.x + r0 + 0.8), [rz0, rz1] = Z.rng(zc - r0 - 0.8, zc + r0 + 0.8);
        for (let y = ry0; y <= ry1; y++)
          for (let x = rx0; x <= rx1; x++)
            for (let z = rz0; z <= rz1; z++) {
              const ax = x / S - f.x, az = z / S - zc, ang = Math.atan2(ax, az);
              const d = Math.hypot(ax, az);
              const half = 0.85 + 0.15 * Math.sin(ang * 3 + f.x);
              if (Math.abs(y / S - (y0 + 6.3 + 0.12 * Math.sin(ang * 2))) > half || d > r0 + 0.34 || d < r0 - 0.4) continue;
              m.set(x, y, z, Math.abs(y / S - (y0 + 6.3)) < 0.18 ? GOLD.dark : GOLD.base, VF.METAL);
            }
        Z.blob(m, f.x, y0 + 6.3, zc - r0 - 0.4, 1.25, 1.2, 0.5, GOLD.hi, 20 + f.x, 0.15, 0.6, VF.METAL); // bezel
        Z.blob(m, f.x, y0 + 6.3, zc - r0 - 0.85, 0.9, 0.9, 0.5, f.n === 'f1' ? 0xdbe6ff : LAPIS.hi, 24 + f.x, 0.15, 0.5, f.n === 'f1' ? VF.METAL : VF.SOLID);
      }
      parent = name;
      y0 = y1;
    }
  }
  // thumb: from the heel of the hand, angled out (+X) and forward
  const tp: V3[] = [[12, 8, 1.5], [18, 17, 4], [21.5, 25, 5.5], [23.5, 32, 6]];
  {
    let parent = 'palm';
    for (let k = 0; k < 3; k++) {
      const name = `t_${k + 1}`;
      const m = rig.part(name, parent, Z.P([tp[k][0] + 0.5, tp[k][1], tp[k][2] + 0.5]), k === 0 ? undefined : [0.08, 0, 0]);
      const r0 = 4.4 - k * 0.55, r1 = 4.4 - (k + 1) * 0.55;
      Z.seg(m, tp[k], tp[k + 1], r0, SK, undefined, r1);
      Z.blob(m, tp[k][0] + (tp[k + 1][0] - tp[k][0]) * 0.5, tp[k][1] + (tp[k + 1][1] - tp[k][1]) * 0.5, tp[k][2] + 1.8, r0 * 0.75, 3, r0 * 0.6, SK, 30 + k, 0.06, 3); // pad
      if (k === 2) {
        const [x1, y1] = tp[3];
        const [ny0, ny1] = Z.rng(y1 - 5, y1 - 0.4), [nx0, nx1] = Z.rng(x1 - 2, x1 + 2);
        for (let y = ny0; y <= ny1; y++)
          for (let x = nx0; x <= nx1; x++) {
            if (Math.abs(x / S - x1) > 1.7) continue;
            const z = zbAt(m, x, y);
            if (z > 999) continue;
            m.set(x, y, z, y / S > y1 - 1.3 ? 0xfbfaff : NAIL, VF.METAL);
            m.set(x, y, z - 1, NAIL, VF.METAL);
          }
      }
      parent = name;
    }
  }
  // ------------------------------------------------------------------ palm lines
  const line = (pts: [number, number][]) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) * S * 1.5);
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        const x = Math.round((ax + (bx - ax) * t) * S), y = Math.round((ay + (by - ay) * t) * S);
        const z = zfAt(palm, x, y);
        if (z > -999) palm.set(x, y, z, CREASE);
      }
    }
  };
  line([[-13.5, 27.5], [-7, 28.3], [0, 29.4], [6.5, 31.2]]); // heart line
  line([[-12, 22.8], [-4, 23.2], [3.5, 24.2], [9.5, 26]]); // head line
  line([[8.5, 27.5], [5.2, 22], [3.8, 15], [4.6, 8], [7, 2.5]]); // life line
  line([[-1, 6], [-0.6, 14], [0.2, 22]]); // fate line
  line([[-9, 1.4], [0, 0.9], [9, 1.4]]); // wrist crease

  // ------------------------------------------------------------------ wrist wraps tearing apart into threads, ribbons and cloud
  {
    const [x0, x1] = Z.rng(-18.5, 18.5), [y0, y1] = Z.rng(-38, -0.5), [zz0, zz1] = Z.rng(-16.5, 14.5);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        for (let z = zz0; z <= zz1; z++) {
          const xb = x / S, yb = y / S, zb = z / S;
          const t = -yb / 36;
          const ang = Math.atan2(zb + 0.5, xb);
          const R = 12.0 + t * 3.0 + 0.4 * Math.sin(2 * ang + yb * 0.1) + 0.55 * Math.sin(yb * 0.33 + ang * 1.5) + (vnoise(x, y, z, 4 * S, 6) - 0.5) * 1.1; // sagging, bunching, uneven sleeve
          const d = Math.hypot(xb / 1.15, (zb + 0.5) / 0.8);
          const u = (yb + xb * 0.33 + zb * 0.12 + 40) / 2.8;
          const band = Math.floor(u), f = u - band;
          const proud = ((band % 3) + 3) % 3 === 0 ? 0.5 : 0; // layered: every third band stands proud
          if (d > R + proud || d < R - 2.0) continue;
          const sector = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 9);
          const endT = 0.45 + 0.55 * h3(band, sector, 1);
          if (t > endT) continue; // this band has torn away here
          let c = proud ? mixc(LINEN.base, LINEN.hi, 0.55) : band % 3 === 1 ? LINEN.base : mixc(LINEN.base, LINEN.shade, 0.35);
          if (f < 0.12) c = LINEN.shade;
          if (t > endT - 0.05) c = LINEN.dark; // frayed lip
          if (vnoise(x, y, z, 9 * S * 0.4, 3) > 0.72) c = mixc(c, RESIN, 0.35);
          palm.set(x, y, z, c);
        }
    Z.blob(palm, 0, -0.6, -0.5, 11.8, 1.2, 8.2, SK, 40, 0.05, 3); // a skin cap at the wrist
    // threads hanging from the torn bands
    for (let i = 0; i < 40; i++) {
      const a = h3(i, 2, 3) * Math.PI * 2;
      const R = 12.8 + h3(i, 4, 5) * 2;
      const xb = Math.cos(a) * R * 1.15, zb = Math.sin(a) * R * 0.8 - 0.5;
      const yTop = -14 - h3(i, 6, 7) * 18, len = 4 + h3(i, 8, 9) * 9;
      const N = Math.round(len * S);
      for (let j = 0; j < N; j++) {
        const x = Math.round((xb + Math.sin(j * 0.15 + i) * 0.5) * S), y = Math.round(yTop * S) - j, z = Math.round(zb * S);
        palm.set(x, y, z, j > N * 0.7 ? LINEN.dark : LINEN.shade);
      }
    }
    // the cloud swallowing the forearm: a billowing mass of noise-shaped lumps, flat underside, lit from above
    const lumps: [number, number, number, number][] = [];
    for (let i = 0; i < 26; i++) {
      const a = h3(i, 1, 2) * Math.PI * 2, r = 5 + h3(i, 3, 4) * 15;
      lumps.push([Math.cos(a) * r, -33 - h3(i, 5, 6) * 7 + (r < 9 ? 2.5 : 0), Math.sin(a) * r * 0.85, 3.2 + h3(i, 7, 8) * 4.2]);
    }
    const [cx0, cx1] = Z.rng(-26, 26), [cy0, cy1] = Z.rng(-45, -24), [cz0, cz1] = Z.rng(-22, 22);
    for (let x = cx0; x <= cx1; x++)
      for (let z = cz0; z <= cz1; z++)
        for (let y = cy0; y <= cy1; y++) {
          const xb = x / S, yb = y / S, zb = z / S;
          let f = -1;
          for (const [lx, ly, lz, lr] of lumps) {
            if (Math.abs(xb - lx) > lr * 1.3 || Math.abs(zb - lz) > lr * 1.3 || Math.abs(yb - ly) > lr) continue;
            const dd = Math.hypot(xb - lx, (yb - ly) * 1.25, zb - lz) / lr;
            if (1 - dd > f) f = 1 - dd;
          }
          f += (vnoise(x, y, z, 2.2 * S, 77) - 0.5) * 0.45;
          if (f <= 0 || f > 0.3) continue; // only the outer skin of the cloud
          if (yb < -41.5 + vnoise(x, 0, z, 3 * S, 78) * 1.6) continue; // flattened underside
          const c = yb > -31.5 ? 0xf1f4fa : yb > -36.5 ? 0xdde3ee : 0xc3cbdb;
          palm.set(x, y, z, c);
        }
  }
  // loose wrap ribbons curling off the wrist — rig parts so they can drift
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    addRibbon(rig, Z, 'palm', `ribbon${i + 1}`, [Math.cos(a) * 14.4, -12 - (i % 3) * 5, Math.sin(a) * 10.4], 15 + (i % 3) * 5, LINEN, i * 2.1, 2.6, 2.2, 0);
  }
  // ------------------------------------------------------------------ skin finish in clear regions: tone, creases, veins, star speckle
  for (const p of rig.parts) {
    const m = p.model;
    const todo: [number, number, number, number, number][] = [];
    m.forEach((x, y, z, c, f) => {
      if (c === CREASE) todo.push([x, y, z, SKIN.shade, VF.SOLID]);
      else if (c === VEIN) todo.push([x, y, z, mixc(SKIN.base, 0x8a9cc8, 0.45), VF.SOLID]);
      else if (c === WRINKLE) todo.push([x, y, z, mixc(SKIN.base, SKIN.shade, 0.6), VF.SOLID]);
      else if (c === SK) {
        const yb = y / S;
        let v = yb > 44 ? mixc(SKIN.base, SKIN.hi, 0.25) : SKIN.base; // fingers a step lighter
        if (vnoise(x, y, z, 14, 41) > 0.68) v = mixc(v, 0xb4b2e0, 0.3); // a faint nebula wash
        const back = !m.has(x, y, z - 1) && z / S < -1;
        const hv = h3(x, y, z, 31);
        if (back ? hv < 0.012 : hv < 0.003) v = 0xffffff;
        else if (back && hv < 0.017) v = 0xfff0c4;
        todo.push([x, y, z, v, f]);
      }
    });
    for (const [x, y, z, v, f] of todo) m.set(x, y, z, v, f);
  }
  // faint crescent-and-disc glyph burnt into the palm (the only glow)
  {
    const [x0, x1] = Z.rng(-10, 10), [y0, y1] = Z.rng(9, 31);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const xb = x / S, yb = y / S;
        const a = Math.hypot(xb, yb - 18.6), b = Math.hypot(xb, yb - 21.6);
        const cres = a <= 8.4 && b >= 7.5 && yb <= 25.5;
        const disc = Math.abs(Math.hypot(xb, yb - 21.8) - 4.1) < 0.42;
        if (!cres && !disc) continue;
        const z = zfAt(palm, x, y, Math.round(8 * S));
        if (z > -999) palm.set(x, y, z, cres ? 0xd9cfa6 : 0xc9bf98, cres ? VF.EMISSIVE : VF.SOLID);
      }
  }
  metalFinish(rig.m('f1_1'), [GOLD]);
  metalFinish(rig.m('f3_1'), [GOLD]);
  for (const p of rig.parts) fastHollow(p.model);
  return rig.build({
    kind: 'khonsu_hand',
    height: (36 + 38 + 36) / 9,
    palmCenter: [0, 19 / 9, 4 / 9],
    fingertip: [2.5 / 9, (37.5 + 32) / 9, -0.6 / 9],
    wristRadius: 13 / 9,
    curlAxis: 'x+',
    swing: rig.parts.filter((p) => /^ribbon\d+$/.test(p.name)).map((p) => p.name),
  });
}
