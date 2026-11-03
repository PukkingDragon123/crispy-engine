// =============================================================================
// THE REALM OF SPIRITS: every model of the Weighing of the Heart (AnubisTrial).
//
// The tomb is a gateway into the Duat. A floating terrace of broken flagstones
// hangs over the abyss before a colossal pylon GATE (1/10 m): battered granite
// towers with torus mouldings and painted cavetto cornices, jackal-headed
// guardians in high pillowed relief, hieroglyph columns of spirit-rune pigment
// (they glow when the gate wakes), a weighing-scale lintel between recumbent
// jackals, a winged sun disc, and two bronze door leaves on real hinges.
// Behind it the HALL OF TWO TRUTHS: polished black floor tiles with gold
// inlay, towering open-lotus columns (1/12 m) carved and painted all round,
// architraves, tomb walls in three painted registers (processions of gods,
// the 42 assessors with Ma'at feathers, columns of the Negative Confession)
// and an end wall with a glowing false door. Bronze jackal-pawed braziers hold
// cold spirit fire. The SCALES OF MA'AT (rig: beam, pans, beating heart, plumb
// bob, Thoth's baboon on the post). ANUBIS'S SOUL AVATAR (1/24 m, ~9 m, 10.2 m
// to the ear tips): a realistic jackal god, obsidian core under a luminous
// spirit shell, gold regalia, separate ears, jaw, lappets, kilt apron, open
// left hand with index / fingers / thumb, a fist around the was-sceptre; his
// eyes are separate finely modelled eyeballs (1/96 m). The SPIRITS of the dead:
// hooded wraiths with screaming faces and trailing shrouds, bony reaching
// hands and soul wisps, all rigged and rendered by the trial's spirit shader.
//
// Relief carving: 2D masks (figures, signs, ornaments) are cut into or raised
// from the voxel surfaces; raised relief gets a rounded, pillowed profile from
// a distance transform, so every picture here is real lit 3D geometry.
// =============================================================================
import * as THREE from 'three';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import type { Ramp } from '../style';
import { TRig, ell, seg, chain, rbox, carveEll, toonShade } from '../enemies/tk';

type M = VoxelModel;
export type StaticModel = { model: VoxelModel; voxelSize: number; meta?: Record<string, any> };

// ----------------------------------------------------------------------------- palette
const GRANITE = 0x5f5a56;
const STONE = 0x6e665c;
const BASALT = 0x2e2c31;
const LAPIS = 0x2d56a6;
const TURQ = 0x2f9a86;
const RED = 0x9a3e26;
const OCHRE = 0xc4963e;
const INK = 0x1c1a20;
const PLASTER = 0xd8d0bc;
const WALLP = 0x8a7a62; // faded ochre plaster of the tomb walls
const GOLD = 0xd8a640;
const GOLD_S = 0xa87a26;
const GOLD_H = 0xf2cf72;
const RUNE = 0x5ad6de; // spirit-rune pigment (GLOW: lights up with the material's emissive strength)
const BRONZE = 0x6e5536;
const PATINA = 0x3f7464;
const OBSIDIAN = 0x15161f;
const OBS_S = 0x0d0d14;
const OBS_H = 0x262a40;
const NOSE = 0x07070b;
const LINEN = 0xd9d2c0;
const LINEN_S = 0xb3aa95;
const SPIRIT = 0xdaf6ff;
const SPIRIT_S = 0x9cc8dc;
const HOLLOW = 0x121c26;
const GLINT = 0xc8fbff;
const SKIN = 0x8a4a2e;
const HEART = 0x8c1c22;
const MET = VF.METAL;
const GLW = VF.GLOW;
const EMI = VF.EMISSIVE;
const R_OBS: Ramp = { base: OBSIDIAN, shade: OBS_S, hi: OBS_H, dark: 0x08080c };
const R_GOLD: Ramp = { base: GOLD, shade: GOLD_S, hi: GOLD_H, dark: 0x6a4a12 };

// ----------------------------------------------------------------------------- utilities
function h3(x: number, y: number, z: number, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, z: number, cell: number, s = 0) {
  const fx = x / cell, fy = y / cell, fz = z / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const tx = fx - ix, ty = fy - iy, tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), sz = tz * tz * (3 - 2 * tz);
  const c = (a: number, b: number, d: number) => h3(ix + a, iy + b, iz + d, s);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy), l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy), sz);
}
function mul(c: number, f: number) {
  const r = Math.max(0, Math.min(255, ((c >> 16) & 255) * f)) | 0;
  const g = Math.max(0, Math.min(255, ((c >> 8) & 255) * f)) | 0;
  const b = Math.max(0, Math.min(255, (c & 255) * f)) | 0;
  return (r << 16) | (g << 8) | b;
}
function mixc(a: number, b: number, t: number) {
  t = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
const N6: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function isSurf(m: M, x: number, y: number, z: number) {
  return !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z) || !m.has(x, y - 1, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
}
/**
 * Fill a solid given by `inside`, keeping only voxels within `thick` of its
 * surface (huge architecture stays light). Colour from `col`.
 */
function solid(m: M, b: [number, number, number, number, number, number], inside: (x: number, y: number, z: number) => boolean, col: (x: number, y: number, z: number) => number, thick = 3, flags: (x: number, y: number, z: number) => number = () => 0) {
  for (let x = b[0]; x <= b[3]; x++)
    for (let y = b[1]; y <= b[4]; y++)
      for (let z = b[2]; z <= b[5]; z++) {
        if (!inside(x, y, z)) continue;
        let edge = 0;
        for (let k = 1; k <= thick && !edge; k++)
          if (!inside(x + k, y, z) || !inside(x - k, y, z) || !inside(x, y + k, z) || !inside(x, y - k, z) || !inside(x, y, z + k) || !inside(x, y, z - k)) edge = k;
        if (edge === 1) m.set(x, y, z, col(x, y, z), flags(x, y, z) || VF.SOLID);
        else if (edge) m.set(x, y, z, 0x1a1816);
      }
  return m;
}
/** cut-stone courses: staggered blocks, recessed-looking joints, quiet per-block tone */
function ashlar(base: number, u: number, y: number, course = 9, len = 17, seed = 0) {
  const row = Math.floor(y / course);
  const off = (row * 7 + seed * 5) % len;
  const uu = u + off + 4096;
  if (((y % course) + course) % course === 0 || uu % len === 0) return mul(base, 0.6);
  const k = h3(Math.floor(uu / len), row, seed);
  return mul(base, 0.9 + k * 0.17);
}

// ----------------------------------------------------------------------------- relief canvas
type Paint = number | ((u: number, v: number) => number);
/** a 2D mask with colour + voxel flags per pixel; v grows upward */
export class Relief {
  c: Uint32Array;
  f: Uint8Array;
  constructor(public w: number, public h: number) {
    this.c = new Uint32Array(w * h);
    this.f = new Uint8Array(w * h);
  }
  at(u: number, v: number) {
    u = Math.round(u);
    v = Math.round(v);
    return u < 0 || v < 0 || u >= this.w || v >= this.h ? -1 : v * this.w + u;
  }
  set(u: number, v: number, c: Paint, f = 0) {
    const i = this.at(u, v);
    if (i < 0) return;
    const col = typeof c === 'number' ? c : c(Math.round(u), Math.round(v));
    this.c[i] = (col & 0xffffff) | 0x1000000;
    this.f[i] = f;
  }
  erase(u: number, v: number) {
    const i = this.at(u, v);
    if (i >= 0) this.c[i] = 0;
  }
  rect(u0: number, v0: number, u1: number, v1: number, c: Paint, f = 0) {
    for (let v = Math.round(Math.min(v0, v1)); v <= Math.round(Math.max(v0, v1)); v++) for (let u = Math.round(Math.min(u0, u1)); u <= Math.round(Math.max(u0, u1)); u++) this.set(u, v, c, f);
  }
  frame(u0: number, v0: number, u1: number, v1: number, w: number, c: Paint, f = 0) {
    this.rect(u0, v0, u1, v0 + w - 1, c, f);
    this.rect(u0, v1 - w + 1, u1, v1, c, f);
    this.rect(u0, v0, u0 + w - 1, v1, c, f);
    this.rect(u1 - w + 1, v0, u1, v1, c, f);
  }
  ellipse(cu: number, cv: number, ru: number, rv: number, c: Paint, f = 0) {
    ru = Math.max(0.5, ru);
    rv = Math.max(0.5, rv);
    for (let v = Math.floor(cv - rv); v <= Math.ceil(cv + rv); v++)
      for (let u = Math.floor(cu - ru); u <= Math.ceil(cu + ru); u++) if (((u - cu) / ru) ** 2 + ((v - cv) / rv) ** 2 <= 1.02) this.set(u, v, c, f);
  }
  poly(pts: [number, number][], c: Paint, f = 0) {
    let lo = 1e9, hi = -1e9;
    for (const p of pts) {
      lo = Math.min(lo, p[1]);
      hi = Math.max(hi, p[1]);
    }
    for (let v = Math.ceil(lo); v <= Math.floor(hi); v++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= v && b[1] > v) || (b[1] <= v && a[1] > v)) xs.push(a[0] + ((v - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let u = Math.round(xs[k]); u <= Math.round(xs[k + 1]); u++) this.set(u, v, c, f);
    }
  }
  line(u0: number, v0: number, u1: number, v1: number, w: number, c: Paint, f = 0) {
    const r = Math.max(0.5, w / 2);
    const du = u1 - u0, dv = v1 - v0, L2 = du * du + dv * dv || 1;
    for (let v = Math.floor(Math.min(v0, v1) - r); v <= Math.ceil(Math.max(v0, v1) + r); v++)
      for (let u = Math.floor(Math.min(u0, u1) - r); u <= Math.ceil(Math.max(u0, u1) + r); u++) {
        const t = Math.max(0, Math.min(1, ((u - u0) * du + (v - v0) * dv) / L2));
        const pu = u0 + du * t - u, pv = v0 + dv * t - v;
        if (pu * pu + pv * pv <= r * r + 0.15) this.set(u, v, c, f);
      }
  }
  /** a sign from string rows (row 0 on top), bottom-left corner at (u, v) */
  glyph(rows: string[], u: number, v: number, c: Paint, f = 0, sc = 1, flip = false) {
    const H = rows.length, W = rows[0].length;
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        if (rows[j][flip ? W - 1 - i : i] === '.') continue;
        for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) this.set(u + i * sc + a, v + (H - 1 - j) * sc + b, c, f);
      }
  }
  /** chamfer distance (px) from each masked pixel to the nearest empty one */
  dist(): Float32Array {
    const { w, h } = this;
    const d = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) d[i] = this.c[i] ? 1e9 : 0;
    const g = (u: number, v: number) => (u < 0 || v < 0 || u >= w || v >= h ? 0 : d[v * w + u]);
    for (let v = 0; v < h; v++)
      for (let u = 0; u < w; u++) {
        const i = v * w + u;
        if (d[i]) d[i] = Math.min(d[i], g(u - 1, v) + 1, g(u, v - 1) + 1, g(u - 1, v - 1) + 1.414, g(u + 1, v - 1) + 1.414);
      }
    for (let v = h - 1; v >= 0; v--)
      for (let u = w - 1; u >= 0; u--) {
        const i = v * w + u;
        if (d[i]) d[i] = Math.min(d[i], g(u + 1, v) + 1, g(u, v + 1) + 1, g(u + 1, v + 1) + 1.414, g(u - 1, v + 1) + 1.414);
      }
    return d;
  }
}
type Map2 = (u: number, v: number) => V3 | null;
/** raised relief with a rounded (pillowed) profile, standing out along `out` */
function raiseFlat(m: M, R: Relief, map: Map2, out: V3, depth: number, slope = 0.9) {
  const dist = R.dist();
  for (let v = 0; v < R.h; v++)
    for (let u = 0; u < R.w; u++) {
      const i = v * R.w + u;
      if (!R.c[i]) continue;
      const p = map(u, v);
      if (!p || !m.has(p[0], p[1], p[2])) continue;
      const c = R.c[i] & 0xffffff, f = R.f[i] || VF.SOLID;
      const hgt = Math.max(1, Math.min(depth, Math.round(dist[i] * slope)));
      for (let d = 1; d <= hgt; d++) m.set(p[0] + out[0] * d, p[1] + out[1] * d, p[2] + out[2] * d, d === hgt ? c : mul(c, 0.8), f);
    }
}
/** sunk relief: the mask is cut `depth` voxels in (along `inn`) and its floor painted */
function sinkFlat(m: M, R: Relief, map: Map2, inn: V3, depth = 1) {
  for (let v = 0; v < R.h; v++)
    for (let u = 0; u < R.w; u++) {
      const i = v * R.w + u;
      if (!R.c[i]) continue;
      const p = map(u, v);
      if (!p || !m.has(p[0], p[1], p[2])) continue;
      for (let d = 0; d < depth; d++) m.del(p[0] + inn[0] * d, p[1] + inn[1] * d, p[2] + inn[2] * d);
      m.set(p[0] + inn[0] * depth, p[1] + inn[1] * depth, p[2] + inn[2] * depth, R.c[i] & 0xffffff, R.f[i] || VF.SOLID);
    }
}
function paintFlat(m: M, R: Relief, map: Map2) {
  for (let v = 0; v < R.h; v++)
    for (let u = 0; u < R.w; u++) {
      const i = v * R.w + u;
      if (!R.c[i]) continue;
      const p = map(u, v);
      if (!p || !m.has(p[0], p[1], p[2])) continue;
      m.set(p[0], p[1], p[2], R.c[i] & 0xffffff, R.f[i] || VF.SOLID);
    }
}
/** sunk relief on a curved surface: every surface voxel that `uv` maps into the mask is cut 1 deep */
function sinkMapped(m: M, R: Relief, uv: (x: number, y: number, z: number) => [number, number] | null) {
  const hits: V3[] = [];
  const look = (x: number, y: number, z: number) => {
    const q = uv(x, y, z);
    if (!q) return -1;
    const i = R.at(q[0], q[1]);
    return i >= 0 && R.c[i] ? i : -1;
  };
  m.forEach((x, y, z) => {
    if (isSurf(m, x, y, z) && look(x, y, z) >= 0) hits.push([x, y, z]);
  });
  for (const [x, y, z] of hits) m.del(x, y, z);
  for (const [x, y, z] of hits)
    for (const [dx, dy, dz] of N6) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (!m.has(X, Y, Z)) continue;
      const i = look(X, Y, Z);
      if (i >= 0) m.set(X, Y, Z, R.c[i] & 0xffffff, R.f[i] || VF.SOLID);
    }
}

// ----------------------------------------------------------------------------- hieroglyphs
const GLYPHS: Record<string, string[]> = {
  ankh: ['..XXX..', '.X...X.', '.X...X.', '..X.X..', 'XXXXXXX', '...X...', '...X...', '...X...', '...X...'],
  djed: ['.XXXXX.', 'XXXXXXX', '.XXXXX.', 'XXXXXXX', '.XXXXX.', 'XXXXXXX', '..XXX..', '..XXX..', '.XXXXX.'],
  was: ['XX...', '.XXX.', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..', '.X.X.'],
  feather: ['..XX', '.XXX', '.XXX', '.XX.', '.XX.', 'XXX.', 'XX..', 'XX..', 'X...'],
  water: ['X...X...X', '.X.X.X.X.', '..X...X..'],
  sun: ['.XXX.', 'X...X', 'X.X.X', 'X...X', '.XXX.'],
  owl: ['XX..X.', 'XXXXX.', '.X.XX.', '.XXXX.', '.XXXXX', '.XXXXX', '..XXX.', '..X.X.'],
  vulture: ['.XX.....', 'XXXX....', '..XXXXX.', '..XXXXXX', '..XXXXX.', '...X.X..', '..XX.XX.'],
  reed: ['..X.', '.XX.', '.XXX', 'XXXX', '.XX.', '.XX.', '..X.', '..X.', '..X.'],
  mouth: ['.XXXXX.', 'XXXXXXX', '.XXXXX.'],
  bread: ['.XXXX.', 'XXXXXX', 'XXXXXX'],
  viper: ['.X.......', 'XXX......', '.XXXXXXXX', '.......XX'],
  scarab: ['.X...X.', '..XXX..', '.XXXXX.', 'XXX.XXX', '.XX.XX.', '.XXXXX.', 'X..X..X'],
  heart: ['X...X', '.XXX.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'],
  man: ['..XX..', '..XX..', '...X..', '.XXX..', 'X.XX..', '..XXX.', '..XXXX', '..X..X', 'XXXXXX'],
  quail: ['..XX..', '.XXXX.', '..XXXX', '.XXXXX', 'XXXXX.', '..X.X.', '.XX.XX'],
  basket: ['X.....X', 'XXXXXXX', '.XXXXX.'],
  eye: ['XXXXXXXXX', '.........', '..XXXXX..', '.XX.X.XXX', '..XXXXX..', '...X..X..', '..X....XX'],
  jackal: ['X........', 'XX.......', '.XXX.....', '.XXXXXXX.', '..XXXXXXX', '..X.X..XX', '..X.X..X.'],
};
const GLYPH_KEYS = Object.keys(GLYPHS);
const KHEKHER = ['.XXXX.', 'XX..XX', '.XXXX.', '..XX..', '.XXXX.', '..XX..', '..XX..', '.XXXX.', 'XXXXXX', '.X..X.'];
const PIGMENTS = [LAPIS, RED, TURQ, INK, LAPIS, RED];

/** a vertical column of signs filling [v0, v1] at u0 (column 9*sc wide) */
function glyphColumn(R: Relief, u0: number, v0: number, v1: number, seed: number, col: (k: number) => number, f = 0, sc = 1) {
  let v = v1, k = 0;
  for (;;) {
    const g = GLYPHS[GLYPH_KEYS[Math.floor(h3(k, seed, 7) * GLYPH_KEYS.length)]];
    const gh = g.length * sc, gw = g[0].length * sc;
    if (v - gh < v0) break;
    R.glyph(g, u0 + Math.floor((9 * sc - gw) / 2), v - gh, col(k), f, sc, h3(k, seed, 9) < 0.15);
    v -= gh + 2 * sc;
    k++;
  }
}
/** a horizontal band of signs, centred vertically in [v0, v0 + h) */
function glyphRow(R: Relief, u0: number, u1: number, v0: number, h: number, seed: number, col: (k: number) => number, f = 0, sc = 1) {
  let u = u0, k = 0;
  for (;;) {
    const g = GLYPHS[GLYPH_KEYS[Math.floor(h3(k, seed, 3) * GLYPH_KEYS.length)]];
    const gh = g.length * sc, gw = g[0].length * sc;
    if (gh > h) {
      k++;
      if (k > 400) break;
      continue;
    }
    if (u + gw > u1) break;
    R.glyph(g, u, v0 + Math.floor((h - gh) / 2), col(k), f, sc);
    u += gw + 2 * sc;
    k++;
  }
}
function cartouche(R: Relief, u0: number, v0: number, w: number, h: number, seed: number, frame: number, f = 0) {
  R.rect(u0 + 1, v0 + 2, u0 + w - 2, v0 + 2, frame, f);
  R.rect(u0 + 1, v0 + h - 1, u0 + w - 2, v0 + h - 1, frame, f);
  R.rect(u0, v0 + 3, u0, v0 + h - 2, frame, f);
  R.rect(u0 + w - 1, v0 + 3, u0 + w - 1, v0 + h - 2, frame, f);
  R.rect(u0 + 1, v0, u0 + w - 2, v0, frame, f); // the tie at the base
  glyphColumn(R, u0 + Math.floor((w - 9) / 2), v0 + 4, v0 + h - 3, seed, (k) => PIGMENTS[(k + seed) % PIGMENTS.length], f);
}

// ----------------------------------------------------------------------------- Egyptian figures (profile canon)
export interface FigOpts {
  head: 'jackal' | 'ibis' | 'falcon' | 'human';
  pose?: 'stride' | 'kneel';
  hold?: 'was' | 'ankh' | 'adore' | 'offer' | 'feather';
  facing: number;
  skin?: number;
  kilt?: number;
  wig?: number;
  gold?: number;
  f?: number;
}
/** a god or soul in the profile canon of tomb painting, `H` px tall, feet at (u0, v0) */
function paintFigure(R: Relief, u0: number, v0: number, H: number, o: FigOpts) {
  const s = o.facing, kneel = o.pose === 'kneel';
  const skin = o.skin ?? SKIN, kilt = o.kilt ?? PLASTER, wig = o.wig ?? INK, gold = o.gold ?? OCHRE, f = o.f ?? 0;
  const dy = kneel ? -0.27 : 0;
  const P = (a: number, b: number): [number, number] => [u0 + a * H * s, v0 + b * H];
  const poly = (pts: number[][], c: Paint) => R.poly(pts.map(([a, b]) => P(a, b)), c, f);
  const line = (a0: number, b0: number, a1: number, b1: number, w: number, c: Paint) => {
    const p = P(a0, b0), q = P(a1, b1);
    R.line(p[0], p[1], q[0], q[1], Math.max(1, w * H), c, f);
  };
  const oval = (a: number, b: number, ra: number, rb: number, c: Paint) => {
    const p = P(a, b);
    R.ellipse(p[0], p[1], ra * H, rb * H, c, f);
  };
  const per = Math.max(1, Math.round(H / 40));
  const stripes = (c1: number, c2: number) => (_u: number, v: number) => (Math.floor(v / per) & 1 ? c1 : c2);
  const sc = Math.max(1, Math.round(H / 55));
  // back arm
  if (o.hold === 'was' || o.hold === 'ankh') {
    line(-0.075, 0.79 + dy, -0.11, 0.62 + dy, 0.045, skin);
    line(-0.11, 0.62 + dy, -0.115, 0.5 + dy, 0.04, skin);
    const h = P(-0.115, 0.5 + dy);
    R.glyph(GLYPHS.ankh, h[0] - 3 * sc, h[1] - 8 * sc, gold, f, sc);
  } else if (o.hold === 'adore') line(-0.03, 0.79 + dy, 0.17, 0.9 + dy, 0.04, skin);
  else line(-0.075, 0.79 + dy, -0.1, 0.56 + dy, 0.042, skin);
  // legs
  if (!kneel) {
    line(-0.02, 0.5, -0.06, 0.27, 0.06, skin);
    line(-0.06, 0.27, -0.1, 0.045, 0.045, skin);
    poly([[-0.135, 0], [-0.135, 0.03], [-0.09, 0.05], [0.0, 0.016], [0.0, 0]], skin);
    line(0.03, 0.5, 0.08, 0.27, 0.062, skin);
    line(0.08, 0.27, 0.13, 0.045, 0.047, skin);
    poly([[0.1, 0], [0.1, 0.03], [0.15, 0.05], [0.25, 0.016], [0.25, 0]], skin);
    poly([[-0.085, 0.57], [0.085, 0.57], [0.15, 0.35], [-0.095, 0.37]], kilt);
    poly([[0.0, 0.565], [0.055, 0.565], [0.12, 0.37], [0.04, 0.38]], stripes(gold, LAPIS));
  } else {
    line(0.0, 0.26, 0.16, 0.06, 0.075, skin);
    line(0.16, 0.05, -0.08, 0.035, 0.05, skin);
    poly([[-0.14, 0], [-0.08, 0.065], [-0.05, 0.0]], skin);
    poly([[-0.1, 0.34], [0.06, 0.34], [0.17, 0.11], [-0.1, 0.12]], kilt);
  }
  // torso, belt, broad collar
  poly([[-0.065, 0.565 + dy], [0.065, 0.565 + dy], [0.08, 0.7 + dy], [0.12, 0.79 + dy], [0.1, 0.835 + dy], [0.03, 0.855 + dy], [-0.03, 0.86 + dy], [-0.11, 0.82 + dy], [-0.08, 0.7 + dy]], skin);
  line(-0.07, 0.565 + dy, 0.07, 0.565 + dy, 0.02, gold);
  [gold, LAPIS, TURQ, gold].forEach((c, k) => line(-0.09, 0.815 + dy - k * 0.017, 0.105, 0.81 + dy - k * 0.017, 0.015, c));
  // front arm and what it holds
  switch (o.hold) {
    case 'was':
      line(0.085, 0.8 + dy, 0.15, 0.67 + dy, 0.046, skin);
      line(0.15, 0.67 + dy, 0.215, 0.645 + dy, 0.04, skin);
      line(0.225, 0.04, 0.225, 1.0 + dy, 0.017, gold);
      line(0.225, 0.04, 0.205, 0.0, 0.012, gold);
      line(0.225, 0.04, 0.245, 0.0, 0.012, gold);
      poly([[0.212, 0.995 + dy], [0.226, 1.03 + dy], [0.285, 1.02 + dy], [0.285, 1.003 + dy], [0.238, 0.99 + dy]], gold);
      break;
    case 'offer':
      line(0.085, 0.8 + dy, 0.2, 0.72 + dy, 0.042, skin);
      oval(0.235, 0.745 + dy, 0.032, 0.042, RED);
      line(0.235, 0.79 + dy, 0.235, 0.86 + dy, 0.01, TURQ);
      oval(0.235, 0.875 + dy, 0.03, 0.02, LAPIS);
      break;
    case 'adore':
      line(0.085, 0.8 + dy, 0.23, 0.95 + dy, 0.04, skin);
      oval(0.238, 0.958 + dy, 0.018, 0.03, skin);
      break;
    case 'feather':
      line(0.085, 0.8 + dy, 0.17, 0.7 + dy, 0.042, skin);
      poly([[0.17, 0.68 + dy], [0.195, 0.68 + dy], [0.21, 0.94 + dy], [0.185, 0.97 + dy]], PLASTER);
      break;
    default:
      line(0.085, 0.8 + dy, 0.13, 0.57 + dy, 0.044, skin);
  }
  // heads
  const hy = 0.915 + dy;
  const lappet = () => poly([[-0.07, hy + 0.035], [-0.015, hy + 0.035], [0.0, 0.8 + dy], [-0.075, 0.8 + dy]], o.head === 'human' ? wig : stripes(gold, LAPIS));
  lappet();
  switch (o.head) {
    case 'jackal':
      oval(0.0, hy, 0.05, 0.058, skin);
      poly([[0.02, hy + 0.035], [0.165, hy - 0.012], [0.17, hy - 0.03], [0.03, hy - 0.048]], skin);
      oval(0.166, hy - 0.022, 0.011, 0.012, INK);
      poly([[-0.042, hy + 0.04], [0.022, hy + 0.05], [-0.016, hy + 0.18]], skin);
      line(-0.013, hy + 0.06, -0.013, hy + 0.14, 0.008, gold);
      oval(0.045, hy + 0.01, 0.015, 0.009, gold);
      break;
    case 'ibis':
      oval(0.005, hy, 0.043, 0.046, skin);
      line(0.035, hy, 0.12, hy - 0.05, 0.017, skin);
      line(0.12, hy - 0.05, 0.19, hy - 0.15, 0.012, skin);
      oval(0.025, hy + 0.012, 0.01, 0.008, gold);
      break;
    case 'falcon':
      oval(0.005, hy, 0.05, 0.052, skin);
      poly([[0.04, hy + 0.012], [0.088, hy - 0.004], [0.072, hy - 0.042], [0.045, hy - 0.022]], gold);
      oval(0.0, hy + 0.11, 0.062, 0.062, gold);
      oval(0.0, hy + 0.11, 0.05, 0.05, RED);
      line(0.025, hy - 0.002, 0.012, hy - 0.04, 0.008, INK);
      oval(0.03, hy + 0.012, 0.011, 0.008, gold);
      break;
    case 'human':
      oval(-0.01, hy + 0.005, 0.062, 0.068, wig);
      poly([[0.03, hy + 0.03], [0.072, hy + 0.0], [0.08, hy - 0.03], [0.062, hy - 0.05], [0.025, hy - 0.058]], skin);
      oval(0.048, hy + 0.002, 0.013, 0.007, PLASTER);
      oval(0.052, hy + 0.002, 0.005, 0.005, INK);
      break;
  }
  if (o.hold === 'feather') poly([[-0.012, hy + 0.06], [0.018, hy + 0.06], [0.03, hy + 0.21], [0.0, hy + 0.23]], PLASTER);
}
/** Anubis as a recumbent jackal on his shrine chest */
function paintShrineJackal(R: Relief, u0: number, v0: number, W: number, s: number, skin = INK, gold = OCHRE, f = 0) {
  const P = (a: number, b: number): [number, number] => [u0 + a * W * s, v0 + b * W];
  const poly = (pts: number[][], c: Paint) => R.poly(pts.map(([a, b]) => P(a, b)), c, f);
  const oval = (a: number, b: number, ra: number, rb: number, c: Paint) => {
    const p = P(a, b);
    R.ellipse(p[0], p[1], ra * W, rb * W, c, f);
  };
  const line = (a0: number, b0: number, a1: number, b1: number, w: number, c: Paint) => {
    const p = P(a0, b0), q = P(a1, b1);
    R.line(p[0], p[1], q[0], q[1], Math.max(1, w * W), c, f);
  };
  // the chest: cornice, frame, bolts
  poly([[-0.45, 0], [0.45, 0], [0.45, 0.3], [-0.45, 0.3]], gold);
  poly([[-0.4, 0.04], [0.4, 0.04], [0.4, 0.26], [-0.4, 0.26]], (u: number) => (Math.floor(u / 2) % 3 === 0 ? LAPIS : mul(gold, 0.8)));
  poly([[-0.5, 0.3], [0.5, 0.3], [0.48, 0.36], [-0.48, 0.36]], gold);
  // the jackal: haunch, body, chest, forelegs, neck, head, ears, tail
  oval(-0.24, 0.47, 0.12, 0.1, skin);
  oval(-0.03, 0.46, 0.27, 0.085, skin);
  oval(0.15, 0.5, 0.09, 0.1, skin);
  poly([[0.1, 0.37], [0.44, 0.37], [0.44, 0.405], [0.1, 0.44]], skin);
  line(0.17, 0.52, 0.25, 0.67, 0.08, skin);
  oval(0.27, 0.69, 0.065, 0.058, skin);
  poly([[0.29, 0.72], [0.44, 0.665], [0.44, 0.645], [0.29, 0.645]], skin);
  poly([[0.225, 0.72], [0.285, 0.735], [0.245, 0.87]], skin);
  line(-0.34, 0.45, -0.46, 0.3, 0.035, skin);
  line(0.19, 0.59, 0.26, 0.6, 0.025, RED);
  oval(0.31, 0.7, 0.015, 0.01, gold);
}
function paintScales(R: Relief, cu: number, v0: number, H: number, gold = OCHRE, f = 0) {
  R.poly([[cu - 0.13 * H, v0], [cu + 0.13 * H, v0], [cu + 0.05 * H, v0 + 0.07 * H], [cu - 0.05 * H, v0 + 0.07 * H]], gold, f);
  R.rect(cu - 0.022 * H, v0, cu + 0.022 * H, v0 + 0.82 * H, gold, f);
  R.ellipse(cu, v0 + 0.88 * H, 0.05 * H, 0.065 * H, TURQ, f);
  R.rect(cu - 0.47 * H, v0 + 0.79 * H, cu + 0.47 * H, v0 + 0.815 * H, gold, f);
  for (const s of [1, -1]) {
    const pu = cu + s * 0.44 * H;
    R.line(pu, v0 + 0.79 * H, pu - 0.1 * H, v0 + 0.43 * H, 1, gold, f);
    R.line(pu, v0 + 0.79 * H, pu + 0.1 * H, v0 + 0.43 * H, 1, gold, f);
    R.ellipse(pu, v0 + 0.41 * H, 0.13 * H, 0.028 * H, gold, f);
  }
  R.glyph(GLYPHS.heart, Math.round(cu - 0.44 * H - 2), Math.round(v0 + 0.44 * H), RED, f, Math.max(1, Math.round(H / 40)));
  R.poly([[cu + 0.42 * H, v0 + 0.43 * H], [cu + 0.455 * H, v0 + 0.43 * H], [cu + 0.47 * H, v0 + 0.7 * H], [cu + 0.43 * H, v0 + 0.72 * H]], PLASTER, f);
  R.line(cu, v0 + 0.79 * H, cu, v0 + 0.62 * H, 1, gold, f);
  R.ellipse(cu, v0 + 0.6 * H, 0.02 * H, 0.03 * H, gold, f);
}
function paintWingedDisc(R: Relief, cu: number, cv: number, W: number, gold = GOLD, f = 0) {
  const r = 0.075 * W;
  for (const s of [1, -1])
    [LAPIS, TURQ, RED, gold].forEach((c, k) => {
      const y0 = cv + r * 0.25 - k * 0.032 * W;
      const x0 = cu + s * r * 1.1, x1 = cu + s * (0.5 * W - k * 0.06 * W);
      R.poly([[x0, y0 + 0.014 * W], [x1, y0 + 0.022 * W], [x1, y0 - 0.006 * W], [x0, y0 - 0.016 * W]], (u: number) => (Math.round(u) % 3 === 0 ? mul(c, 0.7) : c), f);
    });
  R.ellipse(cu, cv, r + 1.2, r + 1.2, gold, f);
  R.ellipse(cu, cv, r, r, RED, f);
  for (const s of [1, -1]) {
    R.line(cu + s * r * 0.95, cv - r * 1.05, cu + s * r * 1.15, cv - r * 0.1, 1.4, gold, f);
    R.ellipse(cu + s * r * 1.12, cv - r * 0.05, 1, 1.6, gold, f);
  }
}

// ============================================================================= THE GATE
const pyOut = (y: number) => Math.round(128 - y * 0.14);
const pyZf = (y: number) => Math.round(20 - y * 0.05);
const flare = (k: number, n: number, amt: number) => Math.round(amt * Math.min(1, k / n) ** 2);
const leafCol = (u: number) => [LAPIS, mul(OCHRE, 0.85), TURQ, mul(RED, 0.9)][Math.floor((u + 2048) / 4) % 4];

export function gateRig(): RigSpec {
  const rig = new TRig('realm_gate', 1 / 10);
  const F = rig.part('frame', undefined, [0.5, 0, 0]);
  const inside = (x: number, y: number, z: number) => {
    const ax = Math.abs(x), az = Math.abs(z);
    if (y < 0 || y > 187) return false;
    if (y < 170 && ax >= 46 && ax <= pyOut(y) && az <= pyZf(y)) return true;
    if (y >= 170 && ax >= 44) {
      const fl = flare(y - 170, 13, 6);
      if (ax <= pyOut(170) + fl && az <= pyZf(170) + fl) return true;
    }
    if (y < 120 && ax <= 46 && az <= 16 && !(ax <= 29 && y < 90)) return true;
    if (y >= 120 && y < 134 && ax <= 47) {
      const fl = flare(y - 120, 11, 5);
      if (az <= 16 + fl && ax <= 45 + fl) return true;
    }
    return false;
  };
  const col = (x: number, y: number, z: number) => {
    const ax = Math.abs(x);
    const cornice = (y >= 170 && y < 184) || (y >= 120 && y < 132 && ax <= 50);
    if (cornice) return (y === 183 || y === 131 ? mul(GRANITE, 0.9) : mul(leafCol(x + z), 0.82 + 0.1 * h3(x >> 2, y, z >> 2)));
    return ashlar(GRANITE, x + z, y, 9, 17, 1);
  };
  solid(F, [-135, 0, -28, 135, 187, 28], inside, col, 3);
  // torus mouldings: vertical beads on the pylon corners, horizontal under the cornices
  const bead = (x: number, y: number, z: number, rr = 2.2) => {
    for (let a = -3; a <= 3; a++)
      for (let b = -3; b <= 3; b++) {
        if (a * a + b * b > rr * rr) continue;
        const band = (y + b * 2 + 400) % 10 < 5;
        F.set(x + a, y, z + b, band ? mul(OCHRE, 0.75) : mul(GRANITE, 0.75));
      }
  };
  for (const s of [1, -1])
    for (let y = 2; y < 168; y++) {
      bead(s * pyOut(y), y, pyZf(y));
      bead(s * pyOut(y), y, -pyZf(y));
    }
  for (const s of [1, -1])
    for (let xi = 46; xi <= pyOut(168); xi++)
      for (let a = -2; a <= 2; a++)
        for (let b = -2; b <= 2; b++) if (a * a + b * b <= 4.4) F.set(s * xi, 168 + a, pyZf(168) + b, (xi + a * 2) % 10 < 5 ? mul(OCHRE, 0.75) : mul(GRANITE, 0.75));
  for (let x = -46; x <= 46; x++) for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (a * a + b * b <= 4.4) F.set(x, 118 + a, 16 + b, (x + a * 2 + 99) % 10 < 5 ? mul(OCHRE, 0.75) : mul(GRANITE, 0.75));

  // ---- pylon faces: jackal-headed guardians, rune columns, glyph bands
  for (const s of [1, -1]) {
    const X0 = s > 0 ? 44 : -130, W = 87, Y0 = 4, H = 162;
    const map: Map2 = (u, v) => {
      const y = Y0 + v;
      return [X0 + u, y, pyZf(y)];
    };
    const raise = new Relief(W, H), sink = new Relief(W, H), paint = new Relief(W, H);
    const cu = (s > 0 ? 84 : -84) - X0;
    paintFigure(raise, cu, 8, 112, { head: 'jackal', pose: 'stride', hold: 'was', facing: -s, skin: 0x24222c, kilt: mul(GOLD, 0.9), gold: GOLD, f: 0 });
    // the kilt and collar gold are polished metal
    for (let i = 0; i < raise.c.length; i++) if (raise.c[i] && ((raise.c[i] & 0xffffff) === GOLD || (raise.c[i] & 0xffffff) === mul(GOLD, 0.9))) raise.f[i] = MET;
    // rune column on the outer side, a glyph band beneath the cornice, a dark dado
    const cx = (s > 0 ? 101 : -110) - X0;
    sink.frame(cx - 2, 8, cx + 10, 120, 1, mul(GRANITE, 0.55));
    glyphColumn(sink, cx, 10, 118, 11 + s, () => RUNE, GLW);
    const bu0 = (s > 0 ? 50 : -112) - X0;
    sink.rect(bu0, 128, bu0 + 62, 128, mul(GRANITE, 0.55));
    sink.rect(bu0, 146, bu0 + 62, 146, mul(GRANITE, 0.55));
    glyphRow(sink, bu0 + 2, bu0 + 60, 130, 15, 21 + s, (k) => PIGMENTS[k % PIGMENTS.length]);
    paint.rect(0, 0, W - 1, 3, mul(BASALT, 1.1));
    paint.rect(0, 4, W - 1, 4, mul(GOLD, 0.8));
    paintFlat(F, paint, map);
    sinkFlat(F, sink, map, [0, 0, -1], 1);
    raiseFlat(F, raise, map, [0, 0, 1], 5, 0.85);
  }
  // ---- portal face: door frame, rune jambs, the weighing on the lintel
  {
    const X0 = -46, W = 93, H = 120;
    const map: Map2 = (u, v) => [X0 + u, v, 16];
    const raise = new Relief(W, H), sink = new Relief(W, H);
    raise.frame(46 - 33, 0, 46 + 33, 93, 3, mul(GRANITE, 1.05));
    for (const s of [1, -1]) {
      const c0 = 46 + s * 39 - 4;
      sink.frame(c0 - 1, 4, c0 + 9, 88, 1, mul(GRANITE, 0.55));
      glyphColumn(sink, c0, 6, 86, 31 + s, () => RUNE, GLW);
    }
    paintScales(raise, 46, 94, 23, GOLD, MET);
    paintShrineJackal(raise, 46 - 30, 95, 22, 1, 0x24222c, GOLD, 0);
    paintShrineJackal(raise, 46 + 30, 95, 22, -1, 0x24222c, GOLD, 0);
    sinkFlat(F, sink, map, [0, 0, -1], 1);
    raiseFlat(F, raise, map, [0, 0, 1], 2, 1);
    // the winged sun disc rides the portal's cavetto
    const disc = new Relief(W, 16);
    paintWingedDisc(disc, 46, 6, 84, GOLD, MET);
    raiseFlat(F, disc, (u, v) => [X0 + u, 120 + v, 16 + flare(v, 11, 5)], [0, 0, 1], 2, 1);
  }
  // ---- inner (hall-side) faces: one spirit-rune band over the doorway
  {
    const sink = new Relief(60, 10);
    glyphRow(sink, 0, 59, 0, 10, 77, () => RUNE, GLW);
    sinkFlat(F, sink, (u, v) => [-30 + u, 100 + v, -16], [0, 0, 1], 1);
  }
  // ---- the door leaves (bronze over cedar), hinged at the jambs
  for (const s of [1, -1]) {
    const name = s > 0 ? 'door_l' : 'door_r';
    const D = rig.part(name, 'frame', [s > 0 ? 30 : -29, 0, -7.5]);
    const x0 = s > 0 ? 0 : -29, x1 = s > 0 ? 29 : -1;
    for (let x = x0; x <= x1; x++)
      for (let y = 0; y <= 89; y++)
        for (let z = -10; z <= -6; z++) {
          const pat = vnoise(x, y, z, 7, 5) * 0.7 + vnoise(x, y, z, 3, 6) * 0.3;
          const patina = pat * (1.15 - y / 110) > 0.62;
          D.set(x, y, z, patina ? mixc(PATINA, BRONZE, pat - 0.62) : mul(BRONZE, 0.9 + 0.1 * pat), MET);
        }
    const W = 30, map: Map2 = (u, v) => [x0 + u, v, -6];
    const raise = new Relief(W, 90);
    raise.frame(0, 0, W - 1, 89, 3, mul(BRONZE, 1.15));
    raise.rect(0, 30, W - 1, 32, mul(BRONZE, 1.15));
    raise.rect(0, 60, W - 1, 62, mul(BRONZE, 1.15));
    paintShrineJackal(raise, W / 2, 65, 21, -s, mul(BRONZE, 0.75), GOLD);
    const big = s > 0 ? GLYPHS.ankh : GLYPHS.djed;
    raise.glyph(big, Math.round(W / 2 - 10), 34, GOLD, 0, 3);
    raiseFlat(D, raise, map, [0, 0, 1], 1, 1);
    // stud rows on the rails and a grid in the lower panel
    const stud = (x: number, y: number) => {
      D.set(x, y, -5, GOLD_S, MET).set(x + 1, y, -5, GOLD_S, MET).set(x, y + 1, -5, GOLD_S, MET).set(x + 1, y + 1, -5, GOLD_S, MET);
      D.set(x, y, -4, GOLD_H, MET).set(x + 1, y + 1, -4, GOLD, MET);
    };
    for (let i = 0; i < 5; i++) {
      stud(x0 + 3 + i * 5, 30);
      stud(x0 + 3 + i * 5, 60);
      for (let j = 0; j < 4; j++) stud(x0 + 4 + i * 5, 6 + j * 6);
    }
    // jackal-head boss and ring knocker near the meeting edge
    const kx = s > 0 ? 5 : -6;
    ell(D, kx, 52, -4.5, 2.4, 2.6, 1.6, GOLD, MET);
    D.set(kx, 51, -3, INK).set(kx, 54, -3, GOLD_H, MET);
    for (let a = 0; a < 40; a++) {
      const t = (a / 40) * Math.PI * 2;
      D.set(Math.round(kx + Math.cos(t) * 4.4), Math.round(46 + Math.sin(t) * 4.4), -4, a % 5 === 0 ? GOLD_H : GOLD_S, MET);
    }
  }
  return rig.build({ height: 18.8, width: 26.6, depth: 4.6, doorHalf: 3.0 });
}

// ============================================================================= TERRACE OVER THE ABYSS (1/8 m)
export function terraceModel(): StaticModel {
  const m = new VoxelModel('realm_terrace');
  const edge = (x: number, z: number) => {
    const n = vnoise(x, 0, z, 14, 3) * 10 + vnoise(x, 5, z, 5, 4) * 4;
    return Math.min(112 - Math.abs(x) - n * 0.9, 127 - z - n, z + 6);
  };
  const cell = (x: number, z: number) => {
    let d1 = 1e9, d2 = 1e9, id = 0;
    const cx = Math.floor(x / 10), cz = Math.floor(z / 10);
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cz - 1; j <= cz + 1; j++) {
        const px = i * 10 + 2 + h3(i, j, 1) * 6, pz = j * 10 + 2 + h3(i, j, 2) * 6;
        const d = Math.hypot(x - px, z - pz);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = i * 997 + j;
        } else if (d < d2) d2 = d;
      }
    return { seam: d2 - d1 < 1.1, id };
  };
  // outline and underside depth per column, so the solid test is a lookup
  const bot = new Int16Array(229 * 138).fill(1);
  for (let x = -114; x <= 114; x++)
    for (let z = -8; z <= 129; z++) {
      const e = edge(x, z);
      if (e >= 0) bot[(x + 114) * 138 + z + 8] = -2 * Math.round((3 + Math.min(30, e * 0.55) * (0.55 + 0.45 * vnoise(x, 0, z, 16, 5))) / 2);
    }
  const inside = (x: number, y: number, z: number) => {
    if (y > 0 || x < -114 || x > 114 || z < -8 || z > 129) return false;
    const b0 = bot[(x + 114) * 138 + z + 8];
    return b0 <= 0 && y >= b0;
  };
  solid(m, [-114, -36, -8, 114, 0, 129], inside, (x, y, z) => {
    if (y === 0) {
      const c = cell(x, z);
      const base = mul(GRANITE, 0.72 + h3(c.id, 3, 3) * 0.22);
      return c.seam ? mul(GRANITE, 0.35) : base;
    }
    return mul(BASALT, Math.floor((y + 64 + ((x * 7 + z * 3) >> 4)) / 3) & 1 ? 1.15 : 0.9);
  }, 2);
  // seams become shallow grooves, a few stones have sunk or cracked
  m.forEach((x, y, z, c) => {
    if (y === 0 && c === mul(GRANITE, 0.35)) m.del(x, 0, z).set(x, -1, z, mul(GRANITE, 0.3));
  });
  for (let k = 0; k < 9; k++) {
    let x = Math.round((h3(k, 1, 9) - 0.5) * 180), z = Math.round(10 + h3(k, 2, 9) * 105);
    for (let i = 0; i < 26; i++) {
      if (m.has(x, 0, z)) m.del(x, 0, z).set(x, -1, z, mul(BASALT, 0.6));
      x += Math.round(h3(k, i, 3) * 2 - 1);
      z += h3(k, i, 4) < 0.5 ? 1 : 0;
    }
  }
  return { model: m, voxelSize: 1 / 8 };
}

// ============================================================================= POLISHED HALL FLOOR (1/5 m)
export function hallFloorModel(): StaticModel {
  const m = new VoxelModel('realm_floor');
  for (let x = -50; x <= 49; x++)
    for (let z = -120; z <= 129; z++) {
      const seam = ((x + 1000) % 10 === 0 || (z + 1000) % 10 === 0) && Math.abs(x) > 13;
      const aisleSeam = Math.abs(x) <= 13 && (z + 1000) % 6 === 0;
      const gold = Math.abs(x) === 13 || Math.abs(x) === 15;
      const r = Math.hypot(x, z + 62.5);
      const ring = Math.abs(r - 15) < 0.55 || Math.abs(r - 18.5) < 0.55;
      const tile = h3(Math.floor((x + 1000) / 10), Math.floor((z + 1000) / 10), 4);
      m.set(x, -1, z, 0x050508);
      if (gold || ring) m.set(x, 0, z, GOLD, MET);
      else if (!(seam || aisleSeam)) m.set(x, 0, z, mixc(0x0c0d12, 0x15161e, tile), MET);
    }
  // rune signs inlaid between the two gold rings round the scales
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const R = new Relief(9, 9);
    R.glyph(GLYPHS[GLYPH_KEYS[k % GLYPH_KEYS.length]], 1, 0, RUNE, GLW);
    const cx = Math.round(Math.cos(a) * 16.8), cz = Math.round(Math.sin(a) * 16.8 - 62.5);
    paintFlat(m, R, (u, v) => [cx + Math.round(((u - 4) * 1) / 3), 0, cz + Math.round((v - 4) / 3)]);
  }
  return { model: m, voxelSize: 1 / 5 };
}

// ============================================================================= OPEN-LOTUS COLUMN (1/12 m, 12 m)
function columnRadius(y: number) {
  if (y < 8) return 15 + 2 * Math.sin((Math.PI * y) / 8);
  if (y < 112) return 12.4 - (y - 8) * 0.012 + 1.6 * Math.exp(-(((y - 13) / 6) ** 2));
  if (y < 136) return 11.2 + 9.4 * Math.pow((y - 112) / 23, 1.7);
  return 0;
}
export function columnModel(seed: number): StaticModel {
  const m = new VoxelModel('realm_column_' + seed);
  const S = mul(STONE, 0.92);
  for (let y = 0; y < 144; y++) {
    const r = columnRadius(y);
    const R = Math.ceil(y >= 136 ? 11 : r + 1);
    for (let x = -R; x <= R; x++)
      for (let z = -R; z <= R; z++) {
        if (y >= 136) {
          if (Math.abs(x) <= 10 && Math.abs(z) <= 10) m.set(x, y, z, y === 136 ? mul(S, 0.7) : ashlar(S, x + z, y, 4, 9, seed));
          continue;
        }
        const d = Math.hypot(x, z);
        if (d > r + 0.35) continue;
        const th = Math.atan2(z, x);
        let c = mul(S, 0.94 + 0.08 * vnoise(x, y, z, 6, seed));
        if (y < 8) c = mul(S, 0.8);
        else if (y < 112) {
          // leaf sheaths round the swollen foot of the shaft
          const w = Math.abs((((th / (Math.PI * 2)) * 8 + 8.5) % 1) - 0.5) * 2;
          if (y < 30 && w < 1 - (y - 8) / 22) c = w > 0.8 - (y - 8) / 30 ? mul(OCHRE, 0.75) : mul(TURQ, 0.8);
          // the five ties under the capital
          if (y >= 100 && y <= 109 && y % 2 === 0) c = [RED, LAPIS, OCHRE, LAPIS, RED][(y - 100) / 2];
        } else {
          // the open lotus: pointed sepals, alternating pigment, gold rim
          const t = (y - 112) / 23;
          const sec = (th / (Math.PI * 2)) * 16 + 16;
          const w = Math.abs((sec % 1) - 0.5) * 2;
          const inner = Math.abs(((sec + 0.5) % 1) - 0.5) * 2;
          if (y >= 134) c = GOLD_S;
          else if (w < 0.9 * (1 - t * t * 0.85)) c = Math.floor(sec) & 1 ? mul(TURQ, 0.8) : mul(LAPIS, 0.85);
          else if (inner < 0.6 * (1 - t)) c = mul(RED, 0.8);
          else c = mul(OCHRE, 0.7);
          if (w > 0.82 && w < 0.92) c = mul(c, 0.6);
        }
        m.set(x, y, z, c, y >= 134 && y < 136 ? MET : VF.SOLID);
      }
  }
  // raised ties and sepal edges catch the light
  for (let y = 100; y <= 108; y += 2) {
    const r = columnRadius(y) + 1;
    for (let a = 0; a < 96; a++) {
      const t = (a / 96) * Math.PI * 2;
      m.set(Math.round(Math.cos(t) * r), y, Math.round(Math.sin(t) * r), [RED, LAPIS, OCHRE, LAPIS, RED][(y - 100) / 2]);
    }
  }
  // the carved, painted shaft: scenes of the judgement all the way round
  const W = 78, H = 86;
  const R = new Relief(W, H);
  glyphRow(R, 1, W - 2, 1, 9, seed * 13 + 1, (k) => PIGMENTS[k % PIGMENTS.length]);
  const kinds: FigOpts['head'][] = seed & 1 ? ['jackal', 'ibis', 'falcon'] : ['ibis', 'jackal', 'human'];
  paintFigure(R, 9, 13, 40, { head: 'human', pose: 'kneel', hold: 'offer', facing: 1 });
  paintFigure(R, 33, 13, 42, { head: kinds[0], hold: 'was', facing: -1, skin: kinds[0] === 'jackal' ? INK : SKIN });
  paintFigure(R, 50, 13, 42, { head: kinds[1], hold: 'ankh', facing: 1, skin: kinds[1] === 'jackal' ? INK : kinds[1] === 'ibis' ? mul(TURQ, 0.8) : SKIN });
  paintFigure(R, 70, 13, 40, { head: kinds[2], pose: 'kneel', hold: 'adore', facing: -1 });
  glyphColumn(R, 16, 40, 56, seed * 5 + 2, (k) => PIGMENTS[(k + 1) % 6]);
  glyphColumn(R, 57, 40, 56, seed * 5 + 3, (k) => PIGMENTS[(k + 3) % 6]);
  R.rect(0, 58, W - 1, 58, RED);
  R.rect(0, 60, W - 1, 60, LAPIS);
  cartouche(R, 6, 63, 13, 22, seed * 7 + 1, OCHRE);
  cartouche(R, 45, 63, 13, 22, seed * 7 + 2, OCHRE);
  glyphColumn(R, 25, 63, 84, seed * 3 + 4, () => LAPIS);
  glyphColumn(R, 35, 63, 84, seed * 3 + 5, () => RED);
  glyphColumn(R, 63, 63, 84, seed * 3 + 6, () => TURQ);
  sinkMapped(m, R, (x, y, z) => (y >= 14 && y < 14 + H ? [((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * W, y - 14] : null));
  // age: chipped rims, a cracked sepal
  for (let k = 0; k < 6; k++) {
    const a = h3(seed, k, 1) * Math.PI * 2;
    const y = k < 3 ? 4 + h3(seed, k, 2) * 4 : 128 + h3(seed, k, 2) * 7;
    const r = columnRadius(Math.floor(y)) + 0.5;
    carveEll(m, Math.cos(a) * r, y, Math.sin(a) * r, 2 + h3(seed, k, 3) * 1.5, 1.6, 2 + h3(seed, k, 4));
  }
  return { model: m, voxelSize: 1 / 12, meta: { height: 12 } };
}

// ============================================================================= ARCHITRAVE (1/10 m)
export function beamModel(len: number): StaticModel {
  const m = new VoxelModel('realm_beam_' + len);
  const L = Math.round(len * 10);
  for (let x = 0; x < L; x++)
    for (let y = 0; y < 12; y++)
      for (let z = -6; z <= 6; z++) {
        if (y > 0 && y < 11 && Math.abs(z) < 5 && x > 0 && x < L - 1) continue;
        m.set(x, y, z, y === 0 ? mul(STONE, 0.6) : ashlar(mul(STONE, 0.85), x, y, 12, 23, 2));
      }
  for (const s of [1, -1]) {
    const R = new Relief(L, 12);
    R.rect(0, 1, L - 1, 1, mul(STONE, 0.5));
    R.rect(0, 10, L - 1, 10, mul(STONE, 0.5));
    glyphRow(R, 2, L - 3, 2, 8, 41 + s + len, () => RUNE, GLW);
    sinkFlat(m, R, (u, v) => [u, v, s * 6], [0, 0, -s], 1);
  }
  return { model: m, voxelSize: 1 / 10 };
}

// ============================================================================= PAINTED TOMB WALLS (1/10 m, 14 m)
export function wallModel(len: number, seed: number, end: boolean): StaticModel {
  const m = new VoxelModel('realm_wall_' + seed);
  const Hh = 140, T = end ? 7 : 4;
  for (let x = 0; x < len; x++)
    for (let y = 0; y < Hh; y++)
      for (let z = 0; z < T; z++) m.set(x, y, z, z === T - 1 ? mul(WALLP, 0.9 + 0.12 * vnoise(x, y, 0, 9, seed)) : mul(STONE, 0.7));
  const zf = T - 1;
  const map: Map2 = (u, v) => [u, v, zf];
  const paint = new Relief(len, Hh), sink = new Relief(len, Hh), raise = new Relief(len, Hh);
  // dado, register dividers, frieze ground
  paint.rect(0, 0, len - 1, 11, mul(INK, 1.2));
  paint.rect(0, 12, len - 1, 12, RED);
  paint.rect(0, 13, len - 1, 13, GOLD);
  for (const [v, cs] of [[49, [LAPIS, OCHRE, RED, LAPIS]], [92, [LAPIS, OCHRE, RED, LAPIS]], [128, [RED, OCHRE]]] as [number, number[]][])
    cs.forEach((c, k) => paint.rect(0, v + k, len - 1, v + k, c));
  paint.rect(0, 130, len - 1, 139, mul(WALLP, 0.75));
  for (let u = 0; u + 6 <= len; u += 7) raise.glyph(KHEKHER, u, 130, [LAPIS, TURQ, RED][Math.floor(u / 7) % 3]);
  if (!end) {
    // register 1: a procession of gods and souls toward the judge
    const kinds: FigOpts[] = [
      { head: 'jackal', hold: 'was', facing: 1, skin: INK, kilt: PLASTER },
      { head: 'human', hold: 'offer', facing: 1 },
      { head: 'ibis', hold: 'was', facing: 1, skin: mul(TURQ, 0.75) },
      { head: 'human', pose: 'kneel', hold: 'adore', facing: 1 },
      { head: 'falcon', hold: 'ankh', facing: 1, skin: SKIN },
    ];
    for (let i = 0; i * 25 + 12 < len; i++) {
      const k = kinds[(i + seed) % kinds.length];
      const u = i * 25 + 10;
      paintFigure(raise, u, 15, 33, k);
      glyphColumn(sink, u + 6, 34, 47, seed * 31 + i, (j) => PIGMENTS[(i + j) % 6]);
    }
    // register 2: the assessors, kneeling, each crowned with Ma'at's feather
    for (let i = 0; i * 16 + 8 < len; i++) {
      paintFigure(raise, i * 16 + 6, 55, 42, { head: (i + seed) % 3 === 0 ? 'jackal' : (i + seed) % 3 === 1 ? 'human' : 'falcon', pose: 'kneel', hold: 'feather', facing: 1, skin: (i + seed) % 3 === 0 ? INK : SKIN });
    }
    // register 3: the Negative Confession in spirit-rune columns
    for (let u = 1; u + 10 <= len; u += 11) {
      sink.rect(u + 10, 97, u + 10, 126, mul(WALLP, 0.55));
      glyphColumn(sink, u, 97, 126, seed * 101 + u, () => RUNE, GLW);
    }
  } else {
    // the end wall: a stepped false door that glows from beyond, guardians, winged sun
    const c = Math.floor(len / 2);
    for (let k = 0; k < 4; k++) {
      const fr = new Relief(len, Hh);
      fr.rect(c - 30 + k * 5, 14, c + 30 - k * 5, 112 - k * 4, k & 1 ? mul(STONE, 0.75) : mul(WALLP, 0.8));
      glyphColumn(fr, c - 29 + k * 5, 16, 108 - k * 4, 300 + k, () => RUNE, GLW);
      glyphColumn(fr, c + 21 - k * 5, 16, 108 - k * 4, 310 + k, () => RUNE, GLW);
      sinkFlat(m, fr, (u, v) => [u, v, zf - k], [0, 0, -1], 1);
    }
    const slot = new Relief(len, Hh);
    slot.rect(c - 6, 14, c + 6, 88, 0xbff4ff, GLW);
    sinkFlat(m, slot, (u, v) => [u, v, zf - 4], [0, 0, -1], 2);
    paintWingedDisc(raise, c, 120, 74, GOLD, MET);
    for (const s of [1, -1]) {
      paintFigure(raise, c + s * 58, 14, 96, { head: 'jackal', hold: 'was', facing: -s, skin: 0x24222c, kilt: mul(GOLD, 0.9), gold: GOLD });
      for (let u = s > 0 ? len - 34 : 2; u < (s > 0 ? len - 2 : 34); u += 11) glyphColumn(sink, u, 16, 126, 400 + u, () => RUNE, GLW);
    }
  }
  paintFlat(m, paint, map);
  sinkFlat(m, sink, map, [0, 0, -1], 1);
  raiseFlat(m, raise, map, [0, 0, 1], 2, 1);
  return { model: m, voxelSize: 1 / 10, meta: { length: len / 10, height: Hh / 10 } };
}

// ============================================================================= DAIS (1/10 m)
export function daisModel(): StaticModel {
  const m = new VoxelModel('realm_dais');
  for (let k = 0; k < 3; k++)
    for (let y = k * 4; y < k * 4 + 4; y++)
      for (let x = -(60 - k * 7); x <= 60 - k * 7; x++)
        for (let z = -30; z <= 29 - k * 7; z++) {
          const nose = y === k * 4 + 3 && (z === 29 - k * 7 || Math.abs(x) === 60 - k * 7);
          m.set(x, y, z, nose ? GOLD : ashlar(BASALT, x + z, y, 4, 13, k), nose ? MET : VF.SOLID);
        }
  for (let k = 0; k < 3; k++) {
    const w = 2 * (60 - k * 7) + 1;
    const sink = new Relief(w, 4);
    // only the 3-tall signs fit: water, mouth, bread, basket
    let u = 3, i = k;
    while (u + 9 < w - 3) {
      const g = GLYPHS[['water', 'mouth', 'bread', 'basket'][i++ % 4]];
      sink.glyph(g, u, 0, RUNE, GLW);
      u += g[0].length + 3;
    }
    sinkFlat(m, sink, (uu, v) => [-(60 - k * 7) + uu, k * 4 + v, 29 - k * 7], [0, 0, -1], 1);
  }
  return { model: m, voxelSize: 1 / 10, meta: { height: 1.2 } };
}

// ============================================================================= BRAZIER (1/24 m)
export function brazierModel(): StaticModel {
  const m = new VoxelModel('realm_brazier');
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
    const P = (r: number, y: number): V3 => [Math.cos(a) * r, y, Math.sin(a) * r];
    // jackal paw: pad, four toes, dew claw
    ell(m, ...P(11, 2), 3, 2.2, 3, BRONZE, MET);
    for (let t = -1.5; t <= 1.5; t += 1) {
      const b = a + t * 0.18;
      ell(m, Math.cos(b) * 13.6, 1.2, Math.sin(b) * 13.6, 1.1, 1.1, 1.1, mul(BRONZE, 1.1), MET);
    }
    chain(m, [P(10.5, 3), P(12, 9), P(8.5, 17), P(5, 23), P(4.2, 29)], [2.2, 1.8, 1.6, 1.5, 1.6], BRONZE, MET);
    ell(m, ...P(12, 9), 2.1, 2.1, 2.1, GOLD, MET);
  }
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    seg(m, [Math.cos(t) * 8.6, 14, Math.sin(t) * 8.6], [Math.cos(t + 0.1) * 8.6, 14, Math.sin(t + 0.1) * 8.6], 0.8, GOLD_S, MET);
  }
  seg(m, [0, 8, 0], [0, 30, 0], 2.2, BRONZE, MET);
  ell(m, 0, 12, 0, 3.4, 2.4, 3.4, GOLD, MET);
  ell(m, 0, 22, 0, 3, 1.4, 3, GOLD, MET);
  // the bowl, its lapis-and-gold band, rolled lip, heaped coals with cold embers
  for (let y = 29; y <= 41; y++) {
    const ro = 5.5 + (y - 29) * 0.62 + (y > 36 ? (y - 36) * 0.25 : 0);
    const ri = y <= 31 ? -1 : ro - 1.8;
    const R = Math.ceil(ro) + 1;
    for (let x = -R; x <= R; x++)
      for (let z = -R; z <= R; z++) {
        const d = Math.hypot(x, z);
        if (d > ro || d < ri) continue;
        const th = Math.atan2(z, x);
        const band = y >= 34 && y <= 37 && d > ro - 1;
        const c = band ? (Math.floor((th / (Math.PI * 2)) * 20 + 20) & 1 ? LAPIS : GOLD) : BRONZE;
        m.set(x, y, z, c, band && c === LAPIS ? VF.SOLID : MET);
      }
  }
  for (let a = 0; a < 90; a++) {
    const t = (a / 90) * Math.PI * 2;
    ell(m, Math.cos(t) * 13.2, 42, Math.sin(t) * 13.2, 0.9, 0.9, 0.9, GOLD_H, MET);
  }
  for (let x = -11; x <= 11; x++)
    for (let z = -11; z <= 11; z++) {
      const d = Math.hypot(x, z);
      if (d > 11.2) continue;
      const top = Math.round(39.5 - d * 0.32 + vnoise(x, 0, z, 3, 7) * 1.6);
      for (let y = 31; y <= top; y++) {
        const r = h3(x, y, z, 7);
        const ember = y >= top - 1 && r < 0.18;
        m.set(x, y, z, ember ? (r < 0.05 ? 0xd6f8ff : 0x3fa8ff) : r < 0.5 ? 0x14161c : 0x1d2028, ember ? GLW : VF.SOLID);
      }
    }
  return { model: m, voxelSize: 1 / 24, meta: { fireY: 41 / 24, height: 43 / 24 } };
}

// ============================================================================= THE SCALES OF MA'AT (1/24 m)
export function scalesRig(): RigSpec {
  const rig = new TRig('realm_scales', 1 / 24);
  const B = rig.part('base', undefined, [0.5, 0, 0.5]);
  rbox(B, -15, 0, -15, 15, 4, 15, BASALT, 2);
  for (let x = -15; x <= 15; x++) for (const z of [-15, 15]) B.set(x, 4, z, GOLD, MET).set(z, 4, x, GOLD, MET);
  rbox(B, -11, 5, -11, 11, 9, 11, GOLD, 2, 'xyz', MET);
  // lotus-petal band round the gold drum
  for (let y = 6; y <= 8; y++)
    for (let a = 0; a < 120; a++) {
      const t = (a / 120) * Math.PI * 2;
      const r = 11.6;
      const pet = Math.abs((((t / (Math.PI * 2)) * 24 + 24) % 1) - 0.5) * 2 < 1 - (y - 6) / 3;
      if (pet) B.set(Math.round(Math.cos(t) * r), y, Math.round(Math.sin(t) * r), (Math.floor((t / (Math.PI * 2)) * 24) & 1) ? LAPIS : TURQ);
    }
  // the papyrus post with lapis bands and an umbel capital
  for (let y = 10; y <= 77; y++) {
    const r = 2.7 - (y - 10) * 0.01 + 0.5 * Math.exp(-(((y - 13) / 3) ** 2));
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) if (Math.hypot(x, z) <= r + 0.3) B.set(x, y, z, y % 12 < 2 ? LAPIS : GOLD, y % 12 < 2 ? VF.SOLID : MET);
  }
  for (let y = 77; y <= 83; y++) {
    const r = 2.4 + (y - 77) * 0.6;
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) if (Math.hypot(x, z) <= r + 0.3) B.set(x, y, z, y === 83 ? GOLD_H : GOLD, MET);
  }
  rbox(B, -2, 84, -2, 2, 87, 2, GOLD_S, 1, 'xyz', MET);
  // Thoth's baboon squats on the post: faience body, mane cape, moon crown
  const T = mul(TURQ, 0.9);
  ell(B, 0, 92, -1, 4.2, 4.6, 3.6, T);
  ell(B, 0, 97, -0.5, 4.6, 2.6, 4, mul(TURQ, 1.15));
  ell(B, 0, 100.5, 0.5, 2.8, 2.9, 2.8, T);
  ell(B, 0, 99.8, 3.2, 1.6, 1.3, 1.6, mul(TURQ, 0.75));
  for (const s of [1, -1]) {
    ell(B, s * 2.6, 89.5, 1.5, 1.6, 2.4, 2.6, T);
    seg(B, [s * 3.4, 95, 0.5], [s * 2.4, 90.5, 3.2], 1, T);
    B.set(s * 1.1, 101, 2.8, GOLD_H, GLW);
  }
  for (let a = -1.2; a <= 1.2; a += 0.08) B.set(Math.round(Math.sin(a) * 2.6), Math.round(104.5 + Math.cos(a) * 1.5 - 1.5 + Math.abs(a) * 1.6), 0, GOLD_H, MET);
  ell(B, 0, 105, 0, 1.5, 1.5, 0.7, GOLD, MET);
  // the beam with lotus-bud ends
  const Bm = rig.part('beam', 'base', [0.5, 85.5, 0.5]);
  for (let x = -37; x <= 37; x++) for (let y = 84; y <= 86; y++) for (let z = -1; z <= 1; z++) if (Math.abs(y - 85) + Math.abs(z) < 2 || Math.abs(x) % 9 !== 0) Bm.set(x, y, z, Math.abs(x) % 9 === 0 ? LAPIS : GOLD, MET);
  for (const s of [1, -1]) {
    ell(Bm, s * 38.5, 85.5, 0, 2.3, 2.4, 2.3, GOLD_H, MET);
    ell(Bm, s * 39.8, 85.5, 0, 1.2, 1.4, 1.2, LAPIS);
    seg(Bm, [s * 36, 84, 0], [s * 36, 82, 0], 0.8, GOLD_S, MET);
  }
  // the plumb line with its bob
  const Pl = rig.part('plumb', 'beam', [0.5, 84, 2.5]);
  seg(Pl, [0, 83, 2.5], [0, 71, 2.5], 0.4, GOLD_S, MET);
  ell(Pl, 0, 69, 2.5, 1.3, 2, 1.3, GOLD, MET);
  // the pans on three beaded chains
  for (const s of [1, -1]) {
    const name = s > 0 ? 'pan_l' : 'pan_r';
    const px = s * 36;
    const P = rig.part(name, 'beam', [s > 0 ? 36.5 : -35.5, 81.5, 0.5]);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
      const end: V3 = [px + Math.cos(a) * 8, 52, Math.sin(a) * 8];
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        P.set(px + (end[0] - px) * t, 81 + (52 - 81) * t, end[2] * t, i % 3 === 0 ? GOLD_H : GOLD_S, MET);
      }
    }
    for (let y = 45; y <= 52; y++) {
      const r = 2.5 + (y - 45) * 0.95;
      for (let x = -10; x <= 10; x++)
        for (let z = -10; z <= 10; z++) {
          const d = Math.hypot(x, z);
          if (d > r || (y > 46 && d < r - 1.4)) continue;
          P.set(px + x, y, z, y === 52 ? GOLD_H : y === 49 ? LAPIS : GOLD, y === 49 ? VF.SOLID : MET);
        }
    }
    ell(P, px, 44, 0, 1.4, 1.4, 1.4, GOLD_H, MET);
    if (s < 0) {
      // Ma'at's ostrich feather: rachis and barbs, the tip curling over
      for (let i = 0; i <= 26; i++) {
        const t = i / 26;
        const cx = px - 0.5 - t * t * 3.5, cy = 47 + i;
        const w = 3.4 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.6) + 0.4;
        for (let x = Math.floor(cx - w); x <= Math.ceil(cx + w * 0.8); x++) {
          const barb = (x + i) % 3 === 0;
          P.set(x, cy, 0, Math.abs(x - cx) < 0.6 ? 0xc9c2b2 : barb ? 0xd8d2c4 : 0xf4f1e8);
          if (Math.abs(x - cx) < 1.2) P.set(x, cy, -1, 0xe8e3d6).set(x, cy, 1, 0xe8e3d6);
        }
      }
    }
  }
  // the heart, its own part so it can beat
  const Ht = rig.part('heart', 'pan_l', [36.5, 56.5, 0.5]);
  const hx = 36;
  ell(Ht, hx, 55.5, 0, 4, 4.8, 3.6, HEART, EMI);
  ell(Ht, hx + 1, 52.6, 0.5, 2.5, 2.8, 2.4, mul(HEART, 0.85), EMI);
  ell(Ht, hx - 1.6, 59.4, 0, 2.1, 2, 2.2, mul(HEART, 1.15), EMI);
  ell(Ht, hx + 2, 59.4, -0.6, 2, 2, 2, mul(HEART, 1.1), EMI);
  chain(Ht, [[hx, 60, 0], [hx, 63, 0], [hx + 2, 64.4, 0], [hx + 3.6, 62.6, 0]], [1.3, 1.3, 1.2, 1.1], 0xb83a3a, EMI);
  seg(Ht, [hx - 1.2, 60, 1.2], [hx - 2.4, 63, 1.8], 1, 0x7a2a5a, EMI);
  seg(Ht, [hx + 2.6, 59, -1.4], [hx + 3, 63, -1.8], 0.8, 0x4a2a6a, EMI);
  for (let i = 0; i < 9; i++) Ht.set(hx - 2 + i * 0.4, 58 - i, 3.4 - Math.abs(i - 4) * 0.2, 0xe0a050, EMI);
  return rig.build({ height: 105 / 24, beamY: 85.5 / 24, panDrop: 30 / 24 });
}

// ============================================================================= ANUBIS'S SOUL AVATAR (1/24 m)
export function anubisSoulRig(): RigSpec {
  const rig = new TRig('realm_anubis_soul', 1 / 24);
  const C = OBSIDIAN;
  // ---- pelvis, kilt, apron
  const pel = rig.part('pelvis', undefined, [0.5, 112, 0]);
  ell(pel, 0, 117, 0, 20, 12, 13, C);
  for (const s of [1, -1]) ell(pel, s * 9, 110, -7, 10, 10, 8, C);
  const kilt = rig.part('kilt', 'pelvis', [0.5, 126, 0]);
  for (let y = 84; y <= 128; y++) {
    const t = (128 - y) / 44;
    const rx = 21.5 + 6 * t, rz = 14 + 5 * t;
    const hem = (x: number) => 84 + 9 * (1 - Math.min(1, Math.abs(x) / rx)) ** 1.5;
    for (let x = -Math.ceil(rx); x <= Math.ceil(rx); x++)
      for (let z = -Math.ceil(rz); z <= Math.ceil(rz); z++) {
        const d = (x / rx) ** 2 + (z / rz) ** 2, di = (x / (rx - 1.8)) ** 2 + (z / (rz - 1.8)) ** 2;
        if (d > 1 || di < 1) continue;
        if (z > 0 && y < hem(x)) continue;
        const ang = Math.atan2(z, x);
        const pleat = Math.floor((ang / Math.PI) * 26 + 52) & 1;
        let c = pleat ? LINEN : LINEN_S;
        let f = 0;
        if (y >= 123) {
          c = y === 125 ? LAPIS : (x + z + 64) % 6 < 3 && y !== 123 && y !== 128 ? GOLD_H : GOLD;
          f = c === LAPIS ? 0 : MET;
        }
        kilt.set(x, y, z, c, f || VF.SOLID);
      }
  }
  ell(kilt, 0, 125.5, 17.5, 3.2, 3, 2, GOLD_H, MET);
  kilt.set(0, 125, 19.5, LAPIS);
  const ap = rig.part('apron', 'kilt', [0.5, 122, 18]);
  for (let y = 88; y <= 122; y++) {
    const w = 4 + (122 - y) * 0.12;
    for (let x = -Math.round(w); x <= Math.round(w); x++) {
      const edge = Math.abs(x) >= Math.round(w) - 0.5 || y === 88;
      const c = edge ? GOLD : [LAPIS, GOLD, RED, GOLD][(x + 64) % 4];
      ap.set(x, y, 18, c, c === GOLD ? MET : VF.SOLID).set(x, y, 17, mul(c, 0.7));
    }
    if (y <= 92) for (let x = -5; x <= 5; x += 2) ap.set(x, 87, 18, GOLD_H, MET).set(x, 86, 18, GOLD_H, MET);
  }
  // ---- torso: ribcage, abdomen, pecs, lats, traps, neck; the broad collar laid over it
  const tor = rig.part('torso', 'pelvis', [0.5, 128, 0]);
  ell(tor, 0, 132, 1, 19, 9, 12, C);
  ell(tor, 0, 142, 2, 20, 14, 12.5, C);
  ell(tor, 0, 158, 0, 27, 20, 15, C);
  ell(tor, 0, 160, -5, 29, 17, 12, C);
  for (const s of [1, -1]) {
    ell(tor, s * 12, 161, 10, 12, 8, 6.5, C);
    ell(tor, s * 25, 168, 0, 8, 7, 9, C);
    ell(tor, s * 18, 146, 6, 5, 9, 6, C);
  }
  for (let r = 0; r < 3; r++) for (const s of [1, -1]) ell(tor, s * 5, 135 + r * 6, 13.2, 4, 2.6, 2, C);
  ell(tor, 0, 174, -3, 17, 7, 11, C);
  seg(tor, [0.5, 170, -1], [0.5, 190, 3], 9.5, C);
  const collar: [number, number, number, number, number][] = [];
  const bands = [GOLD, LAPIS, GOLD, TURQ, GOLD, RED, GOLD_H];
  tor.forEach((x, y, z) => {
    if (y < 148 || y > 184 || !isSurf(tor, x, y, z)) return;
    const d = Math.hypot(x, (y - 186) * 1.3);
    if (d < 12 || d > 33) return;
    for (const [dx, dy, dz] of N6) {
      if (tor.has(x + dx, y + dy, z + dz) || dy !== 0) continue;
      let c = bands[Math.min(6, Math.floor((d - 12) / 3))];
      if (d > 30 && (Math.round(Math.atan2(y - 186, x) * 18) & 1)) c = 0;
      if (c) collar.push([x + dx, y, z + dz, c, c === LAPIS || c === TURQ || c === RED ? VF.SOLID : MET]);
      break;
    }
  });
  for (const [x, y, z, c, f] of collar) tor.set(x, y, z, c, f);
  // ---- head: a real jackal skull shape under black hide
  const hd = rig.part('head', 'torso', [0.5, 186, 2]);
  ell(hd, 0, 202, -2, 12, 13, 14, C);
  ell(hd, 0, 207, 6, 10.5, 5, 6.5, C);
  for (const s of [1, -1]) ell(hd, s * 8.5, 197, 6, 5, 5.5, 8, C);
  for (let z = 6; z <= 37; z++) {
    const t = (z - 6) / 31;
    ell(hd, 0, 197.6 - 2.2 * t, z, 8.2 - 4.6 * t, 5.6 - 2.4 * t, 0.6, C);
  }
  ell(hd, 0, 197, 37.6, 3.2, 2.6, 2.2, NOSE);
  for (const s of [1, -1]) hd.del(s * 1, 196, 39).del(s * 1, 196, 40);
  for (let z = 24; z <= 34; z++) for (const s of [1, -1]) hd.set(s * Math.round(4.6 - (z - 24) * 0.2), 192, z, z === 31 || z === 32 ? 0xece4d4 : 0x2a0a10);
  // eye sockets with gold kohl rims and lines sweeping back
  const eyeL: V3 = [7.8, 202.5, 11.5];
  for (const s of [1, -1]) {
    carveEll(hd, s * eyeL[0], eyeL[1], eyeL[2], 3.4, 2, 3);
    for (let a = 0; a < 40; a++) {
      const t = (a / 40) * Math.PI * 2;
      const x = Math.round(s * eyeL[0] + Math.cos(t) * 4), y = Math.round(eyeL[1] + Math.sin(t) * 2.6);
      for (let z = 16; z > 2; z--)
        if (hd.has(x, y, z)) {
          hd.set(x, y, z, GOLD, MET);
          break;
        }
    }
    for (let z = 9; z >= 1; z--)
      for (let xi = 16; xi >= 0; xi--)
        if (hd.has(s * xi, 202, z)) {
          hd.set(s * xi, 202, z, GOLD, MET);
          break;
        }
  }
  // gold brow band and the striped back lappet of the tripartite wig
  hd.forEach((x, y, z) => {
    if (y === 210 && z > -2 && isSurf(hd, x, y, z)) hd.set(x, y, z, GOLD, MET);
  });
  for (let y = 172; y <= 204; y++)
    for (let x = -11; x <= 11; x++) {
      const z = -17 - (204 - y) * 0.12;
      hd.set(x, y, Math.round(z), (y >> 1) & 1 ? GOLD : LAPIS, (y >> 1) & 1 ? MET : VF.SOLID);
      hd.set(x, y, Math.round(z) + 1, LAPIS);
    }
  // ---- jaw
  const jw = rig.part('jaw', 'head', [0.5, 193, 8]);
  for (let z = 8; z <= 34; z++) {
    const t = (z - 8) / 26;
    ell(jw, 0, 189.6 + 0.8 * t, z, 6.5 - 3.6 * t, 2.6 - 0.8 * t, 0.6, C);
  }
  ell(jw, 0, 188, 10, 7, 3.6, 6, C);
  jw.forEach((x, y, z) => {
    if (z > 12 && !jw.has(x, y + 1, z) && Math.abs(x) < 3) jw.set(x, y, z, 0x3a0e16);
  });
  for (const s of [1, -1]) jw.set(s * 3, 191, 30, 0xece4d4).set(s * 3, 192, 30, 0xece4d4);
  // ---- ears: tall, cupped, gold-lined
  const er = rig.part('ear_l', 'head', [10.5, 211, -3]);
  for (let y = 207; y <= 246; y++) {
    const t = (y - 207) / 39;
    const w = 7.4 * Math.pow(1 - t, 0.85) + 0.6;
    ell(er, 10.5 + 3.5 * t, y, -3 - 2 * t, w * 0.9, 0.6, 2.4 * (1 - t * 0.6) + 0.7, C);
  }
  for (let y = 211; y <= 240; y++) {
    const t = (y - 207) / 39;
    const w = 7.4 * Math.pow(1 - t, 0.85) + 0.6;
    carveEll(er, 10.5 + 3.5 * t, y, -3 - 2 * t + 2.3, w * 0.62, 0.6, 1.3);
  }
  er.forEach((x, y, z, c) => {
    if (c !== C || y < 211 || y > 241) return;
    if (!er.has(x, y, z + 1)) {
      const t = (y - 207) / 39;
      const w = 7.4 * Math.pow(1 - t, 0.85) + 0.6;
      const rim = Math.abs(x - (10.5 + 3.5 * t)) > w * 0.5;
      er.set(x, y, z, rim ? GOLD : 0x2a1e34, rim ? MET : VF.SOLID);
    }
  });
  // ---- front lappets (striped wig ends) hanging over the collar
  const lp = rig.part('lappet_l', 'head', [12.5, 202, -4]);
  for (let y = 158; y <= 202; y++) {
    const cx = 12.5 + (202 - y) * 0.06, cz = -4 + (202 - y) * 0.36;
    ell(lp, cx, y, cz, 4.4, 0.6, 2, y < 161 ? GOLD : (y >> 1) & 1 ? GOLD : LAPIS, y < 161 || (y >> 1) & 1 ? MET : VF.SOLID);
  }
  // ---- arms
  const al = rig.part('arm_l', 'torso', [29.5, 168, 0]);
  ell(al, 29, 166, 0, 10, 10, 10.5, C);
  seg(al, [31, 164, 0], [34, 130, 0], 8.6, C, undefined, 6.8);
  ell(al, 33.5, 147, 5, 6, 10, 5.5, C);
  ell(al, 33.5, 148, -4, 6.5, 11, 5.5, C);
  ell(al, 32.6, 151, 0.3, 9.6, 2.3, 9.6, GOLD, MET, (x, y, z) => !al.has(x, y, z));
  al.forEach((x, y, z, c) => {
    if (c === GOLD && y === 151 && (x + z) % 4 === 0) al.set(x, y, z, LAPIS);
  });
  const fl = rig.part('fore_l', 'arm_l', [34.5, 129, 0]);
  ell(fl, 34.5, 127, 0, 7.4, 6, 7.4, C);
  seg(fl, [34.5, 127, 0], [36.5, 92, 2], 7, C, undefined, 4.6);
  ell(fl, 35.5, 118, 1.5, 6.6, 9, 6.4, C);
  for (let y = 92; y <= 104; y++) {
    const t = (127 - y) / 35;
    const r = 7 - 2.4 * t + 1.4;
    ell(fl, 34.5 + 2 * t, y, 2 * t, r, 0.6, r, y === 95 || y === 100 ? LAPIS : y === 92 || y === 104 ? GOLD_H : GOLD, y === 95 || y === 100 ? 0 : MET, (x, yy, z) => !fl.has(x, yy, z));
  }
  // open left hand: palm, thenar pad, then index / three fingers / thumb as their own parts
  const hl = rig.part('lhand', 'fore_l', [36.5, 91, 2]);
  rbox(hl, 34, 76, -3, 39, 91, 7, C, 2);
  ell(hl, 36.5, 82, 6.5, 2.6, 5, 2.4, C);
  for (const z of [-2, 0.5, 3, 5.5]) ell(hl, 36.5, 76.5, z, 2.4, 1.6, 1.3, C);
  const fg = rig.part('lfing', 'lhand', [36.5, 76, 1]);
  for (const [z, len] of [[3, 19], [0.4, 18], [-2.2, 15]] as [number, number][])
    chain(fg, [[36.5, 76, z], [36.6, 69, z], [36.2, 62, z], [35.6, 76 - len, z]], [1.55, 1.45, 1.3, 1.05], C);
  for (const [z, len] of [[3, 19], [0.4, 18], [-2.2, 15]] as [number, number][]) fg.set(35, 76 - len, Math.round(z), 0x34364a);
  fg.forEach((x, y, z) => {
    if (y === 66 && z === 0) fg.set(x, y, z, GOLD, MET);
  });
  const ix = rig.part('lindex', 'lhand', [36.5, 76, 5.5]);
  chain(ix, [[36.5, 76, 5.5], [36.6, 68, 5.6], [36.2, 61, 5.7], [35.7, 57, 5.8]], [1.6, 1.45, 1.3, 1.05], C);
  ix.set(35, 57, 6, 0x34364a);
  const th = rig.part('lthumb', 'lhand', [35.5, 85, 7]);
  chain(th, [[35.5, 85, 7], [34.8, 80, 9], [34.3, 75, 10.2], [34, 72, 10.8]], [2, 1.7, 1.5, 1.2], C);
  // ---- legs: thigh, knee, shin and calf, sandalled foot with toes
  const tl = rig.part('thigh_l', 'pelvis', [11.5, 112, 0]);
  seg(tl, [11.5, 112, 0], [12.5, 62, 1.5], 11.5, C, undefined, 7.5);
  ell(tl, 12, 92, 4, 9, 16, 7, C);
  ell(tl, 13.5, 100, -3, 7, 12, 7, C);
  const sl = rig.part('shin_l', 'thigh_l', [12.5, 62, 1.5]);
  ell(sl, 12.5, 61, 3.5, 6.5, 6, 5.5, C);
  seg(sl, [12.5, 61, 1.5], [12.5, 12, -1], 7, C, undefined, 4.4);
  ell(sl, 12.8, 44, -3, 6.4, 12, 5.8, C);
  rbox(sl, 8, 1, -6, 17, 8, 7, C, 2);
  ell(sl, 12.5, 4, -4, 4.4, 4, 3.6, C);
  for (let i = 0; i < 5; i++) {
    const x = 8.6 + i * 2.1, len = [14, 15.5, 15, 14, 12.5][i];
    chain(sl, [[x, 4.5, 6], [x, 3.2, len - 2], [x, 2.2, len]], [1.5, 1.25, 1.05], C);
  }
  for (let x = 6; x <= 19; x++) for (let z = -7; z <= 17; z++) if (((x - 12.5) / 6.8) ** 2 + ((z - 5) / 12.5) ** 2 <= 1) sl.set(x, 0, z, GOLD_S, MET);
  ell(sl, 12.5, 6.5, 2, 5.6, 0.7, 5.6, GOLD, MET, (x, y, z) => !sl.has(x, y, z));
  seg(sl, [12.5, 5, 8], [11, 3.5, 12], 0.8, GOLD, MET);
  for (let y = 12; y <= 15; y++) ell(sl, 12.5, y, -1, 5.6, 0.6, 5.6, y === 13 ? LAPIS : GOLD, y === 13 ? 0 : MET, (x, yy, z) => !sl.has(x, yy, z));
  // shade the obsidian and gold before mirroring
  for (const p of rig.parts) toonShade(p.model, [R_OBS, R_GOLD], { hi: true, under: true });
  rig.mirrorLR();
  // ---- right fist closed round the was-sceptre
  const hr = rig.part('hand_r', 'fore_r', [-35.5, 91, 2]);
  rbox(hr, -39, 77, -3, -34, 91, 7, C, 2);
  for (const y of [78.5, 81.5, 84.5, 87.5]) chain(hr, [[-34, y, 6], [-33.4, y, 11.5], [-36.5, y, 14.6], [-39.6, y, 12]], [1.6, 1.6, 1.5, 1.3], C);
  chain(hr, [[-39.5, 88, 5], [-40, 90, 10], [-37, 90.6, 13.2]], [2, 1.8, 1.5], C);
  for (let y = 92; y <= 97; y++) ell(hr, -36.5, y, 2, 6.2, 0.6, 6.2, y === 94 ? LAPIS : GOLD, y === 94 ? 0 : MET, (x, yy, z) => !hr.has(x, yy, z));
  toonShade(hr, [R_OBS, R_GOLD]);
  const wp = rig.part('weapon', 'hand_r', [-36.5, 84, 11]);
  for (let y = 9; y <= 214; y++) {
    const band = y % 18 < 3;
    const rune = y % 18 === 9;
    for (let x = -38; x <= -35; x++)
      for (let z = 9; z <= 12; z++) {
        if ((x === -38 || x === -35) && (z === 9 || z === 12)) continue;
        wp.set(x, y, z, rune ? RUNE : band ? LAPIS : GOLD, rune ? GLW : band ? VF.SOLID : MET);
      }
  }
  seg(wp, [-36.5, 10, 10.5], [-39.5, 0, 10.5], 1.2, GOLD_S, MET);
  seg(wp, [-36.5, 10, 10.5], [-33.5, 0, 10.5], 1.2, GOLD_S, MET);
  seg(wp, [-36.5, 213, 10.5], [-36.5, 221, 12], 1.6, GOLD, MET);
  seg(wp, [-36.5, 221, 12], [-36.5, 224, 19], 2.3, GOLD, MET, 1.8);
  seg(wp, [-36.5, 224, 19], [-36.5, 222.5, 24], 1.8, GOLD_H, MET, 1);
  for (const s of [1, -1]) seg(wp, [-36.5 + s, 224, 13.5], [-36.5 + s * 1.4, 230, 12.5], 0.7, GOLD_H, MET);
  wp.set(-38, 224, 20, RUNE, GLW).set(-35, 224, 20, RUNE, GLW);
  rig.socket('eye_l', 'head', [8.3, 203, 12]);
  rig.socket('eye_r', 'head', [-7.3, 203, 12]);
  rig.socket('staff_top', 'weapon', [-36, 226, 19]);
  rig.socket('palm_l', 'lhand', [34, 81, 2.5]);
  rig.socket('mouth', 'jaw', [0.5, 191, 32]);
  rig.socket('chest', 'torso', [0.5, 160, 16]);
  return rig.build({
    height: 216 / 24,
    earTop: 246 / 24,
    radius: 1.6,
    eyeL: [eyeL[0] + 0.5, eyeL[1], eyeL[2] + 2],
    eyeR: [-eyeL[0] + 0.5, eyeL[1], eyeL[2] + 2],
    staffTop: [-36.5, 226, 18],
    palm: [36.5, 80, 2],
  });
}

/** a jackal god's eye, finely modelled: glowing sclera and iris, slit pupil, limbal ring, wet highlight */
export function anubisEyeModel(): StaticModel {
  const m = new VoxelModel('realm_anubis_eye');
  for (let x = -12; x <= 12; x++)
    for (let y = -7; y <= 7; y++)
      for (let z = -8; z <= 8; z++) {
        const d = (x / 12) ** 2 + (y / (6.8 * (1 - (Math.abs(x) / 13) ** 3))) ** 2 + (z / 8) ** 2;
        if (d > 1) continue;
        const r = Math.hypot(x - 1, y);
        let c = 0xf6e2b0;
        if (z > 3) {
          if (r < 1.4 + Math.abs(y) * 0.02 && Math.abs(x - 1) < 1.5) c = 0x0c0604;
          else if (r < 4.4) c = r < 2.6 ? 0xffe070 : 0xffb030;
          else if (r < 5.3) c = 0xb05a10;
        }
        m.set(x, y, z, c, c === 0x0c0604 ? VF.SOLID : GLW);
      }
  m.set(3, 3, 8, 0xffffff, GLW).set(4, 3, 8, 0xffffff, GLW).set(3, 4, 7, 0xffffff, GLW);
  return { model: m, voxelSize: 1 / 96 };
}

// ============================================================================= SPIRITS OF THE DEAD
/** a hooded wraith with a screaming face, reaching bony hands and a trailing shroud (1/24 m, faces +Z) */
export function wraithRig(): RigSpec {
  const rig = new TRig('realm_wraith', 1 / 24);
  const S = SPIRIT, Ss = SPIRIT_S;
  const b = rig.part('body', undefined, [0.5, 0, 0]);
  ell(b, 0, 0, 0, 7, 5.5, 8, S);
  ell(b, 0, 2, 2, 8.2, 3.6, 5, Ss);
  for (let r = 0; r < 4; r++) for (const s of [1, -1]) seg(b, [s * 1.5, -1 - r * 1.6, 7], [s * 6, -2 - r * 1.4, 3], 0.7, Ss);
  seg(b, [0, 0, -6], [0, -2, 6], 1.1, Ss);
  // tattered collar of the shroud
  for (let a = 0; a < 30; a++) {
    const t = (a / 30) * Math.PI * 2;
    const L = 2 + h3(a, 1, 7) * 4;
    seg(b, [Math.cos(t) * 7, 1, Math.sin(t) * 6], [Math.cos(t) * 8.5, 1 - L, Math.sin(t) * 7.5 - 2], 0.8, S);
  }
  const hd = rig.part('head', 'body', [0.5, 3, 6]);
  ell(hd, 0, 7, 8, 6.6, 7.2, 7, S);
  carveEll(hd, 0, 5.5, 14.5, 4.8, 6, 4.6);
  ell(hd, 0, 5.5, 10.5, 4.3, 5.4, 4.4, 0xeefcff);
  ell(hd, 0, 8, 12.5, 3.6, 1.4, 2.4, 0xeefcff);
  for (const s of [1, -1]) {
    carveEll(hd, s * 1.8, 6.6, 14.4, 1.5, 1.4, 1.6);
    hd.set(s * 2, 6.6, 13, HOLLOW).set(s * 1, 6.6, 13, HOLLOW).set(s * 1.8, 5.6, 13, HOLLOW);
    hd.set(s * 1.8, 6.6, 12.6, GLINT, GLW);
    ell(hd, s * 3, 4.6, 12.6, 1.2, 1.2, 1.4, 0xeefcff);
  }
  carveEll(hd, 0, 4.8, 15, 0.9, 1, 1);
  hd.set(0, 4.8, 13.6, HOLLOW);
  for (let x = -3; x <= 3; x++) hd.set(x, 3.4, 13.8, x % 2 ? 0xc8dce6 : 0xf0faff);
  const jw = rig.part('jaw', 'head', [0.5, 3.6, 9]);
  ell(jw, 0, 1.4, 12, 3.4, 2.2, 3.2, 0xeefcff);
  carveEll(jw, 0, 2.6, 13, 2.4, 1.5, 2.6);
  jw.forEach((x, y, z) => {
    if (!jw.has(x, y + 1, z) && Math.abs(x) < 3 && z > 10) jw.set(x, y, z, HOLLOW);
  });
  for (let x = -2; x <= 2; x++) jw.set(x, 2.6, 14.6, 0xe0f2fa);
  const al = rig.part('arm_l', 'body', [5.5, 2, 3]);
  seg(al, [5.5, 2, 3], [8, -1, 9], 1.6, S, undefined, 1.1);
  const fl = rig.part('fore_l', 'arm_l', [8, -1, 9]);
  seg(fl, [8, -1, 9], [8.5, -1.5, 15], 1.1, S, undefined, 0.8);
  ell(fl, 8.5, -1.5, 16.2, 1.6, 0.9, 1.6, S);
  for (let k = 0; k < 4; k++) chain(fl, [[7.2 + k * 0.9, -1.5, 17], [7 + k * 1.1, -2.2, 20], [6.8 + k * 1.2, -3.4, 22.5]], [0.55, 0.5, 0.4], Ss);
  chain(fl, [[9.6, -1, 16], [10.8, -1.6, 18.5]], [0.6, 0.45], Ss);
  // the shroud trails behind in four tapering, torn segments
  const rad = [7.2, 5.4, 3.8, 2.4, 0.7];
  let parent = 'body';
  for (let i = 0; i < 4; i++) {
    const z0 = -6 - i * 10, z1 = z0 - 10;
    const tp = rig.part('tail' + (i + 1), parent, [0.5, -0.5 * i, z0]);
    for (let z = z0; z >= z1; z--) {
      const t = (z0 - z) / 10;
      const r = rad[i] + (rad[i + 1] - rad[i]) * t;
      for (let x = -Math.ceil(r); x <= Math.ceil(r); x++)
        for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) {
          const d = Math.hypot(x, y * 1.2);
          if (d > r || d < r - 1.4) continue;
          if (h3(x, y, z, 5) < 0.12 + i * 0.06) continue;
          tp.set(x, y - 0.5 * i, z, (x + z) % 5 === 0 ? Ss : S);
        }
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + i;
      tp.set(Math.round(Math.cos(a) * rad[i + 1]), Math.round(Math.sin(a) * rad[i + 1] - 0.5 * i), z1 - 1, S);
    }
    parent = 'tail' + (i + 1);
  }
  rig.mirrorLR();
  return rig.build({ length: 66 / 24 });
}

/** a bony ghost hand clawing up out of the dark (1/32 m, fingers +Y, palm faces +Z) */
export function spiritHandRig(): RigSpec {
  const rig = new TRig('realm_spirit_hand', 1 / 32);
  const S = SPIRIT, Ss = SPIRIT_S;
  const arm = rig.part('arm', undefined, [0.5, 0, 0]);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    seg(arm, [Math.cos(a) * 3, -10 - h3(k, 0, 3) * 8, Math.sin(a) * 3], [Math.cos(a) * 1.5, 4, Math.sin(a) * 1.5], 0.6, Ss);
  }
  seg(arm, [0, 0, 0], [0, 34, 0], 3.4, S, undefined, 2.4);
  seg(arm, [1.6, 6, -1.4], [1.2, 30, -1], 1.3, Ss);
  seg(arm, [-1.8, 8, 1.2], [-1.2, 31, 1.4], 1.1, Ss);
  ell(arm, 0, 33, 0, 3.2, 2, 2.6, Ss);
  const palm = rig.part('palm', 'arm', [0.5, 34, 0]);
  rbox(palm, -4, 34, -1, 4, 46, 1, S, 1);
  for (let k = 0; k < 4; k++) {
    seg(palm, [-3 + k * 2, 36, 1.2], [-3 + k * 2, 45, 1.2], 0.6, Ss);
    ell(palm, -3 + k * 2, 46, 0, 1.1, 1, 1.2, 0xeefcff);
  }
  ell(palm, 3, 38, 0.8, 1.8, 3, 1.6, S);
  for (let k = 0; k < 4; k++) {
    const x = -3 + k * 2, L = [7, 8, 7.5, 6][k];
    const fa = rig.part(`f${k + 1}a`, 'palm', [x + 0.5, 46, 0.5]);
    seg(fa, [x, 46, 0], [x, 46 + L, 0], 0.95, S, undefined, 0.85);
    ell(fa, x, 46 + L, 0, 1.1, 1, 1.1, 0xeefcff);
    const fb = rig.part(`f${k + 1}b`, `f${k + 1}a`, [x + 0.5, 46 + L, 0.5]);
    seg(fb, [x, 46 + L, 0], [x, 46 + L * 1.8, 0.4], 0.8, S, undefined, 0.55);
    fb.set(x, Math.round(46 + L * 1.8 + 1), 1, GLINT);
  }
  const ta = rig.part('thumb_a', 'palm', [4.5, 38, 0.5]);
  seg(ta, [4, 38, 0], [7, 43, 1.5], 1.1, S, undefined, 0.9);
  const tb = rig.part('thumb_b', 'thumb_a', [7.5, 43, 2]);
  seg(tb, [7, 43, 1.5], [8.5, 48, 2.5], 0.85, S, undefined, 0.6);
  return rig.build({ length: 62 / 32 });
}

/** a soul wisp: a bright head with a tapering, sinuous tail (1/32 m, faces +Z) */
export function wispRig(): RigSpec {
  const rig = new TRig('realm_wisp', 1 / 32);
  const h = rig.part('head', undefined, [0.5, 0, 0]);
  ell(h, 0, 0, 0, 3.2, 3.2, 3.8, SPIRIT);
  ell(h, 0, 0.5, 1.5, 1.6, 1.6, 1.8, 0xffffff, GLW);
  for (const s of [1, -1]) h.set(s, 0.8, 3.8, HOLLOW);
  let parent = 'head';
  for (let i = 0; i < 3; i++) {
    const z0 = -3 - i * 6;
    const p = rig.part('t' + (i + 1), parent, [0.5, 0, z0]);
    for (let z = z0; z >= z0 - 6; z--) {
      const r = 2.8 - (i * 6 + (z0 - z)) * 0.14;
      ell(p, Math.sin(z * 0.6) * 0.6, 0, z, Math.max(0.5, r), Math.max(0.5, r * 0.8), 0.6, (z & 1) ? SPIRIT : SPIRIT_S);
    }
    parent = 't' + (i + 1);
  }
  return rig.build({ length: 21 / 32 });
}

// ============================================================================= SPIRIT NORMALS
/**
 * Smooth normals for spirit shells: the part's voxels are blurred into a
 * density field and each vertex takes the field's gradient, so fresnel rims
 * follow the sculpted form instead of the voxel steps. Adds `snormal`.
 */
export function spiritNormals(geo: THREE.BufferGeometry, model: VoxelModel, pivot: V3, vs: number, R = 1) {
  const b = model.bounds();
  const pad = R * 2 + 2;
  const ox = b.minX - pad, oy = b.minY - pad, oz = b.minZ - pad;
  const nx = b.maxX - b.minX + 1 + pad * 2, ny = b.maxY - b.minY + 1 + pad * 2, nz = b.maxZ - b.minZ + 1 + pad * 2;
  let f = new Float32Array(nx * ny * nz);
  const id = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  model.forEach((x, y, z) => (f[id(x - ox, y - oy, z - oz)] = 1));
  let tmp = new Float32Array(f.length);
  const dims = [nx, ny, nz], strides = [1, nx, nx * ny];
  const blur = (src: Float32Array, dst: Float32Array, axis: number) => {
    const n = dims[axis], st = strides[axis];
    const [a1, a2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    for (let i = 0; i < dims[a1]; i++)
      for (let j = 0; j < dims[a2]; j++) {
        const base = i * strides[a1] + j * strides[a2];
        let acc = 0;
        for (let k = 0; k <= R && k < n; k++) acc += src[base + k * st];
        for (let k = 0; k < n; k++) {
          dst[base + k * st] = acc / (2 * R + 1);
          if (k + R + 1 < n) acc += src[base + (k + R + 1) * st];
          if (k - R >= 0) acc -= src[base + (k - R) * st];
        }
      }
  };
  for (let pass = 0; pass < 2; pass++)
    for (let a = 0; a < 3; a++) {
      blur(f, tmp, a);
      const t = f;
      f = tmp;
      tmp = t;
    }
  const S = (x: number, y: number, z: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const tx = x - ix, ty = y - iy, tz = z - iz;
    const g = (a: number, bb: number, c: number) => {
      const X = ix + a, Y = iy + bb, Z = iz + c;
      return X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz ? 0 : f[id(X, Y, Z)];
    };
    const l = (p: number, q: number, t: number) => p + (q - p) * t;
    return l(l(l(g(0, 0, 0), g(1, 0, 0), tx), l(g(0, 1, 0), g(1, 1, 0), tx), ty), l(l(g(0, 0, 1), g(1, 0, 1), tx), l(g(0, 1, 1), g(1, 1, 1), tx), ty), tz);
  };
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i) / vs + pivot[0] - 0.5 - ox, py = pos.getY(i) / vs + pivot[1] - 0.5 - oy, pz = pos.getZ(i) / vs + pivot[2] - 0.5 - oz;
    const fx = nor.getX(i), fy = nor.getY(i), fz = nor.getZ(i);
    // sample half a voxel outside the face so thin features keep a clean gradient
    const qx = px + fx * 0.5, qy = py + fy * 0.5, qz = pz + fz * 0.5;
    let gx = S(qx - 1, qy, qz) - S(qx + 1, qy, qz);
    let gy = S(qx, qy - 1, qz) - S(qx, qy + 1, qz);
    let gz = S(qx, qy, qz - 1) - S(qx, qy, qz + 1);
    const L = Math.hypot(gx, gy, gz);
    if (L < 1e-4) {
      gx = fx;
      gy = fy;
      gz = fz;
    } else {
      gx = gx / L * 0.88 + fx * 0.12;
      gy = gy / L * 0.88 + fy * 0.12;
      gz = gz / L * 0.88 + fz * 0.12;
    }
    const L2 = Math.hypot(gx, gy, gz) || 1;
    out[i * 3] = gx / L2;
    out[i * 3 + 1] = gy / L2;
    out[i * 3 + 2] = gz / L2;
  }
  geo.setAttribute('snormal', new THREE.BufferAttribute(out, 3));
  return geo;
}

// ============================================================================= registry
export const REALM_MODELS: Record<string, () => RigSpec | StaticModel> = {
  realm_gate: gateRig,
  realm_terrace: terraceModel,
  realm_floor: hallFloorModel,
  realm_column_a: () => columnModel(1),
  realm_column_b: () => columnModel(2),
  realm_beam_long: () => beamModel(9),
  realm_beam_cross: () => beamModel(11),
  realm_wall_a: () => wallModel(125, 1, false),
  realm_wall_b: () => wallModel(125, 2, false),
  realm_wall_end: () => wallModel(200, 3, true),
  realm_dais: daisModel,
  realm_brazier: brazierModel,
  realm_scales: scalesRig,
  realm_anubis_soul: anubisSoulRig,
  realm_anubis_eye: anubisEyeModel,
  realm_wraith: wraithRig,
  realm_spirit_hand: spiritHandRig,
  realm_wisp: wispRig,
};
