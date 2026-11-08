// Shared kit for Sundown's firearms (the six-shooter, the coach gun, the Thompson
// and their hand items). Guns are sculpted once in design centimetres and
// rasterised at two resolutions (GUN_RES):
//   - 'hd': the six-shooter at 1/512 m, the long guns at 1/384 m. Everything
//     uses it: the hideout, menus, cinematics, the bullet-cam and the gun in hand;
//   - 'lo': half that, only swapped in by Weapons while an HD voxel would be
//     smaller than a pixel on screen (so the swap is invisible).
// Every component is its own rig part (GunRigBuilder) with a label, the
// customisation slot it belongs to and an exploded-view vector (meta.explode).
// Materials here take DESIGN CENTIMETRES (not voxel indices), so both builds
// share one surface: blued steel, case hardening, oiled gunstock walnut, brass,
// gold, jigged bone, ivory, lapis. Finishing passes: worn edges (bluing rubbed
// off the corners, handling wear on wood) and a gentle top-light relief.
import { VoxelModel, VF, mix, mulRGB } from '../../../engine/voxel/VoxelModel';
import { noise, hash3 } from '../../../engine/math/rand';
import { woodGrain, cellular, tone, type WoodSpecies } from '../materials';
import { Sc, type Col, type Op } from './sculpt';
import type { V3, PartSpec, SocketSpec } from '../../../engine/voxel/Rig';

export type GunLod = 'hd' | 'lo';
/** voxels per design centimetre, per gun family and build */
export const GUN_RES = { revolver: { hd: 5.12, lo: 2.56 }, long: { hd: 3.84, lo: 1.92 } } as const;
export type GunFamily = keyof typeof GUN_RES;
export const gunK = (f: GunFamily, lod: GunLod): number => GUN_RES[f][lod];
/** voxel size (m) of a build */
export const gunVS = (f: GunFamily, lod: GunLod) => 1 / (100 * gunK(f, lod));
export const MET = VF.METAL;
/** voxel flag: colour still to be resolved (a lazy material id sits in the rgb bits) */
export const LZ = 64;
export const PI = Math.PI;

// ------------------------------------------------------------------ small maths
export const fract = (v: number) => v - Math.floor(v);
/** how much to shave at distance d inside a face so the edge rounds with radius r (quarter-circle fillet) */
export const fil = (d: number, r: number) => (d >= r ? 0 : r - Math.sqrt(Math.max(0, r * r - (r - d) * (r - d))));
export const n3 = (x: number, y: number, z: number) => noise.n3(x, y, z);

// ------------------------------------------------------------------ palette
/** hot-salt blued steel: blue-black body, cool sheen, bright steel where the bluing has worn through */
export const BLUED = { base: 0x465062, shade: 0x323a48, hi: 0x6a788e, dark: 0x121519, worn: 0x9ea6b2, wornHi: 0xc8ced6 };
/** a darker, older bluing for the long guns' tubes */
export const BLUED_L = { base: 0x424b5c, shade: 0x2e3542, hi: 0x627088, dark: 0x101318, worn: 0x949ca8, wornHi: 0xbcc2ca };
/** parkerised / phosphate grey (suppressor) */
export const PARK = { base: 0x4c5052, shade: 0x34373a, hi: 0x787e84, dark: 0x1c1d1f, worn: 0x8a8e92, wornHi: 0xa8acb0 };
export const BRASS = { base: 0xc89a3a, shade: 0x9a7024, hi: 0xf0cc6a, dark: 0x5e4214 };
export const GOLD = { base: 0xe2b752, shade: 0xb08a30, hi: 0xfff0a0, dark: 0x6e4c14 };
export const LEAD = { base: 0x8a8c92, shade: 0x6a6c72, hi: 0xa8aab0 };
export const COPPER = 0xc06a3a;
export const LENS = 0x9fd6e8;
export const LASER_RED = 0xff2a1a;
export const VENOM = { base: 0x8ee04a, hi: 0xc6f48a, deep: 0x3f8a22 };
export const BORE = 0x0c0d10;
/** case-hardening palette: dark steel, steel, light steel, plum, peacock blue, umber, straw */
const CASE_T = [0x3c424e, 0x4e5464, 0x5c6374, 0x5e5274, 0x4c6288, 0x6a5e54, 0x84745a];

/** oil-finished gunstock walnut: warm red-brown with dark figure */
export const GUNSTOCK: WoodSpecies = {
  tones: [0x341c0e, 0x432513, 0x522e18, 0x62381e, 0x744426],
  late: 0x2e170a,
  knot: 0x24120a,
  end: [0x6a3c20, 0x8a5430, 0x9c6840],
  check: 0x1e0f06,
};

// ------------------------------------------------------------------ materials (design cm)
type CM = (x: number, y: number, z: number) => number;

/** blued steel: flat body with a faint low sheen band (long merges, no noise) */
export function blued(R = BLUED): CM {
  return () => R.base;
}
/** case-hardened steel: blue-grey steel under broad, soft washes of peacock blue, plum and a little straw */
export function caseHardened(seed = 0, scale = 0.13): CM {
  return (x, y, z) => {
    const w = n3(x * scale * 0.5 + seed, y * scale * 0.5, z * scale * 0.5) * 0.9;
    const a = n3(x * scale + w, y * scale - seed, z * scale - w);
    const b = n3(x * scale * 0.8 - 5 + seed, y * scale * 0.8, z * scale * 0.8);
    if (b > 0.5) return b > 0.62 ? CASE_T[6] : CASE_T[5];
    if (a > 0.34) return CASE_T[4];
    if (a < -0.36) return CASE_T[3];
    return a > 0.08 ? CASE_T[2] : CASE_T[1];
  };
}
/** a grain frame: rotate p so the grain direction d becomes +z */
function grainFrame(d: V3) {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const w: V3 = [d[0] / l, d[1] / l, d[2] / l];
  const up: V3 = Math.abs(w[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u: V3 = [up[1] * w[2] - up[2] * w[1], up[2] * w[0] - up[0] * w[2], up[0] * w[1] - up[1] * w[0]];
  const ul = Math.hypot(u[0], u[1], u[2]) || 1;
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v: V3 = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  return { u, v, w };
}
/** oiled walnut, grain running along `dir` (design cm in; the library grain is evaluated at 4 units per cm) */
export function walnut(o: { dir?: V3; seed?: number; figure?: number; dark?: number; ring?: number } = {}): CM {
  const f = grainFrame(o.dir ?? [0, 0, 1]);
  const g = woodGrain({ along: 'z', species: GUNSTOCK, seed: o.seed ?? 3, ring: o.ring ?? 4.2, knots: 0, figure: o.figure ?? 0.35 });
  const S = 2.0;
  return (x, y, z) => {
    const c = g((x * f.u[0] + y * f.u[1] + z * f.u[2]) * S, (x * f.v[0] + y * f.v[1] + z * f.v[2]) * S, (x * f.w[0] + y * f.w[1] + z * f.w[2]) * S) ?? GUNSTOCK.tones[2];
    return o.dark ? mulRGB(c, 1 - o.dark) : c;
  };
}
/** gun brass: a warm tarnish cast, polished where it is handled (no verdigris on a cared-for gun) */
export function brassMat(seed = 0): CM {
  return (x, y, z) => {
    const s = n3(x * 0.22 + seed, y * 0.22, z * 0.22);
    return s > 0.55 ? BRASS.hi : s < -0.62 ? BRASS.shade : BRASS.base;
  };
}
/** polished gold with a soft warm sheen */
export function goldMat(seed = 0): CM {
  return (x, y, z) => {
    const s = n3(x * 0.25 + seed, y * 0.25, z * 0.25);
    return s > 0.5 ? GOLD.hi : s < -0.6 ? GOLD.shade : GOLD.base;
  };
}
/** jigged bone: cream bone with the irregular gouged pits of a stag-style grip */
export function jiggedBone(seed = 0, pit = 0.3): CM {
  const T = [0xb89a70, 0xd8c09a, 0xe9d6b4, 0xf6e8cc];
  return (x, y, z) => {
    const [f1] = cellular(x * 1.25 + seed, y * 0.8, z * 1.25, seed);
    if (f1 < pit) return f1 < pit * 0.55 ? 0x5a3c22 : 0x8a6644;
    const s = n3(x * 0.4, y * 0.4 + seed, z * 0.4);
    return tone(T, 0.55 + s * 0.6);
  };
}
/** sun-aged bone (cylinders, bone hardware) */
export function agedBone(seed = 0): CM {
  const T = [0xa9845a, 0xd6b78a, 0xead2a8, 0xfff1d6];
  return (x, y, z) => {
    const s = n3(x * 0.35 + seed, y * 0.35, z * 1.6);
    const c = n3(x * 1.4, y * 1.4, z * 0.25 + seed);
    if (c > 0.62) return 0x8a6a44; // hairline crack along the length
    return tone(T, 0.6 + s * 0.55);
  };
}
/** ivory: warm cream with the faint crossing Schreger lines */
export function ivoryMat(): CM {
  const T = [0xe2d4b4, 0xeee2c6, 0xf6eedc, 0xfdf8ec];
  return (x, y, z) => {
    const a = Math.sin((y * 0.9 + z * 0.9) * 2.2 + n3(x * 0.3, y * 0.3, z * 0.3) * 2);
    const b = Math.sin((y * 0.9 - z * 0.9) * 2.2);
    return tone(T, 0.62 + (a > 0.86 || b > 0.9 ? -0.25 : 0) + n3(x * 0.2, y * 0.2, z * 0.2) * 0.25);
  };
}
/** lapis lazuli: deep blue with calcite veils and sparse pyrite flecks */
export function lapisMat(seed = 0): CM {
  const T = [0x1a2e60, 0x2a4890, 0x3a62b8, 0x5a84d8];
  return (x, y, z) => {
    const h = hash3(Math.floor(x * 2.4) + seed, Math.floor(y * 2.4), Math.floor(z * 2.4));
    if (h > 0.965) return 0xe8c060; // pyrite
    const s = n3(x * 0.55 + seed, y * 0.55, z * 0.55);
    if (s > 0.55) return 0x8aa2d0; // calcite veil
    return tone(T, 0.5 + s * 0.7);
  };
}
/** dyed saddle leather with stitched edges handled by the caller */
export function leatherMat(base = 0x8a5a2c): CM {
  const T = [mulRGB(base, 0.62), mulRGB(base, 0.8), base, mix(base, 0xffe8c0, 0.18)];
  return (x, y, z) => {
    const c = n3(x * 0.9, y * 0.9, z * 0.9);
    if (c > 0.6) return T[0]; // crease
    return tone(T, 0.62 + n3(x * 0.25, y * 0.25, z * 0.25) * 0.45);
  };
}
/** paper shotgun hull */
export function hullMat(base = 0xb8382a): CM {
  return (x, y, z) => (n3(x * 0.7, y * 0.7, z * 0.2) > 0.45 ? mulRGB(base, 1.12) : base);
}

// ------------------------------------------------------------------ lazy materials
// Expensive materials (grain, case colours, bone pits) are only evaluated on the
// voxels that end up on the surface: a region stores the material id with the LZ
// flag, resolveLazy() paints the surface and fills the hidden core flat.
const LAZY: CM[] = [];
const lazyId = new Map<CM, number>();
/** [colour fn, op] for Sc calls: s.region(lo, hi, inside, ...lz(walnutFn, MET)) */
export function lz(fn: CM, flags = 0): [Col, Op] {
  let id = lazyId.get(fn);
  if (id === undefined) {
    id = LAZY.length;
    LAZY.push(fn);
    lazyId.set(fn, id);
  }
  const v = id;
  return [() => v, { flags: flags | LZ }];
}
/** paint every lazy voxel: surface voxels get their material at their design-space centre, hidden ones a flat fill */
export function resolveLazy(m: VoxelModel, k: number) {
  const todo: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (!(f & LZ)) return;
    const hidden = m.has(x + 1, y, z) && m.has(x - 1, y, z) && m.has(x, y + 1, z) && m.has(x, y - 1, z) && m.has(x, y, z + 1) && m.has(x, y, z - 1);
    const fn = LAZY[c];
    todo.push([x, y, z, hidden || !fn ? 0x34302c : fn((x + 0.5) / k, (y + 0.5) / k, (z + 0.5) / k), f & ~LZ]);
  });
  for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f);
  return m;
}
/** drop the voxels no ray can reach (all six neighbours filled): the mesh and its AO are unchanged, memory drops */
export function hollow(m: VoxelModel) {
  const del: number[] = [];
  m.forEach((x, y, z) => {
    if (m.has(x + 1, y, z) && m.has(x - 1, y, z) && m.has(x, y + 1, z) && m.has(x, y - 1, z) && m.has(x, y, z + 1) && m.has(x, y, z - 1)) del.push(x, y, z);
  });
  for (let i = 0; i < del.length; i += 3) m.del(del[i], del[i + 1], del[i + 2]);
  return m;
}

// ------------------------------------------------------------------ shape helpers
/** a solid of revolution round an axis parallel to Z through (cx, cy); r(z) in design cm */
export function lathe(s: Sc, cx: number, cy: number, z0: number, z1: number, r: (z: number) => number, col: Col, o: Op = {}) {
  let R = 0;
  for (let i = 0; i <= 32; i++) R = Math.max(R, r(z0 + ((z1 - z0) * i) / 32));
  return s.region([cx - R, cy - R, z0], [cx + R, cy + R, z1], (x, y, z) => z >= z0 && z <= z1 && Math.hypot(x - cx, y - cy) <= r(z), col, o);
}
/** a tube band (ring) round a Z axis */
export function ring(s: Sc, cx: number, cy: number, z0: number, z1: number, r0: number, r1: number, col: Col, o: Op = {}) {
  return s.region([cx - r1, cy - r1, z0], [cx + r1, cy + r1, z1], (x, y) => {
    const r = Math.hypot(x - cx, y - cy);
    return r <= r1 && r >= r0;
  }, col, o);
}
/** a domed screw head on a face whose normal is ±X, with its slot cut at angle a (radians) */
export function screwX(s: Sc, c: V3, sx: number, r: number, col: number, a = 0.6, slot = 0x262a32) {
  const k = s.k;
  const t = Math.max(0.3, 1.0 / k);
  s.region([c[0] - t, c[1] - r, c[2] - r], [c[0] + t, c[1] + r, c[2] + r], (x, y, z) => {
    const d = Math.hypot(y - c[1], z - c[2]);
    return d <= r && (x - c[0]) * sx <= t * (1 - (d / r) ** 2 * 0.6) && (x - c[0]) * sx >= -t;
  }, col, { flags: MET });
  if (r * k >= 1.5) {
    const ca = Math.cos(a), sa = Math.sin(a);
    s.region([c[0] - t, c[1] - r, c[2] - r], [c[0] + t, c[1] + r, c[2] + r], (x, y, z) => {
      const u = (y - c[1]) * ca + (z - c[2]) * sa, v = -(y - c[1]) * sa + (z - c[2]) * ca;
      return Math.abs(v) < 0.55 / k && Math.abs(u) < r * 0.82;
    }, slot, { mode: 'paint', flags: MET });
  }
  return s;
}

// ------------------------------------------------------------------ finishing passes
/**
 * Worn edges: a voxel on a convex edge (few filled cells in the (2r+1)^3 box round
 * it) is recoloured by worn(rgb, amount). A summed-volume table keeps it O(n).
 * Wear is broken up with a low-frequency rub pattern so it reads hand-used, not traced.
 */
export function wearEdges(m: VoxelModel, k: number, worn: (rgb: number, amt: number) => number | null, o: { r?: number; thr?: number; rub?: number } = {}) {
  if (!m.count) return m;
  const r = o.r ?? Math.max(1, Math.round(0.8 * k));
  const R2 = r * 2 + 1;
  const thr = o.thr ?? (r >= 2 ? 0.47 : 0.4);
  const rub = o.rub ?? 0.55;
  const b = m.bounds();
  const P = R2 + 1;
  const ox = b.minX - P, oy = b.minY - P, oz = b.minZ - P;
  const sx = b.maxX - b.minX + 2 * P + 1, sy = b.maxY - b.minY + 2 * P + 1, sz = b.maxZ - b.minZ + 2 * P + 1;
  const SX = sx + 1, SY = sy + 1;
  const S = new Int32Array(SX * SY * (sz + 1));
  const id = (x: number, y: number, z: number) => x + SX * (y + SY * z);
  m.forEach((x, y, z) => (S[id(x - ox + 1, y - oy + 1, z - oz + 1)] = 1));
  for (let z = 1; z <= sz; z++) for (let y = 1; y <= sy; y++) for (let x = 1; x <= sx; x++) S[id(x, y, z)] += S[id(x - 1, y, z)];
  for (let z = 1; z <= sz; z++) for (let y = 1; y <= sy; y++) for (let x = 1; x <= sx; x++) S[id(x, y, z)] += S[id(x, y - 1, z)];
  for (let z = 1; z <= sz; z++) for (let y = 1; y <= sy; y++) for (let x = 1; x <= sx; x++) S[id(x, y, z)] += S[id(x, y, z - 1)];
  const sum = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
    S[id(x1, y1, z1)] - S[id(x0 - 1, y1, z1)] - S[id(x1, y0 - 1, z1)] - S[id(x1, y1, z0 - 1)] + S[id(x0 - 1, y0 - 1, z1)] + S[id(x0 - 1, y1, z0 - 1)] + S[id(x1, y0 - 1, z0 - 1)] - S[id(x0 - 1, y0 - 1, z0 - 1)];
  const vol = (2 * r + 1) ** 3, vol2 = (2 * R2 + 1) ** 3;
  const todo: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (f & (VF.EMISSIVE | VF.GLOW)) return;
    if (m.has(x + 1, y, z) && m.has(x - 1, y, z) && m.has(x, y + 1, z) && m.has(x, y - 1, z) && m.has(x, y, z + 1) && m.has(x, y, z - 1)) return;
    const X = x - ox + 1, Y = y - oy + 1, Z = z - oz + 1;
    const fr = sum(X - r, Y - r, Z - r, X + r, Y + r, Z + r) / vol;
    if (fr >= thr) return;
    // a thin rod or a small bit is all edge: leave its finish alone
    if (sum(X - R2, Y - R2, Z - R2, X + R2, Y + R2, Z + R2) / vol2 < 0.2) return;
    const rubN = n3((x / k) * 0.45 + 3.3, (y / k) * 0.45, (z / k) * 0.45) * 0.5 + 0.5;
    const amt = Math.min(1, (thr - fr) / 0.12) * (1 - rub + rub * rubN);
    if (amt < 0.42) return;
    const nc = worn(c, amt);
    if (nc !== null && nc !== c) todo.push([x, y, z, nc, f]);
  });
  for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f);
  return m;
}
/** the standard wear map: bluing rubs through to bright steel, gold and brass polish up, wood and bone lighten */
export function gunWear(extra?: (rgb: number, amt: number) => number | null) {
  const blue = new Set<number>([BLUED.base, BLUED.shade, BLUED.hi, BLUED_L.base, BLUED_L.shade, BLUED_L.hi, 0x5a6880]);
  const cased = new Set<number>(CASE_T);
  const wood = new Set<number>([...GUNSTOCK.tones, GUNSTOCK.late]);
  return (c: number, amt: number): number | null => {
    const e = extra?.(c, amt);
    if (e !== undefined && e !== null) return e;
    if (blue.has(c)) return amt > 0.75 ? BLUED.wornHi : amt > 0.45 ? BLUED.worn : BLUED.hi;
    if (cased.has(c)) return amt > 0.7 ? 0xb4b0a8 : mix(c, 0xb4b0a8, 0.5);
    if (wood.has(c)) return mix(c, 0xc08850, 0.32 * amt);
    if (c === GOLD.base || c === GOLD.shade) return GOLD.hi;
    if (c === BRASS.base || c === BRASS.shade) return BRASS.hi;
    if (c === PARK.base || c === PARK.shade) return amt > 0.6 ? PARK.worn : PARK.hi;
    return null;
  };
}
/** gentle top-light relief: open tops a touch warmer and lighter, open undersides a touch darker */
export function relief(m: VoxelModel, up = 1.06, down = 0.88) {
  const todo: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (f & (VF.EMISSIVE | VF.GLOW)) return;
    if (!m.has(x, y + 1, z)) todo.push([x, y, z, mulRGB(c, up), f]);
    else if (!m.has(x, y - 1, z)) todo.push([x, y, z, mulRGB(c, down), f]);
  });
  for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f);
  return m;
}

// ------------------------------------------------------------------ composition
const CACHE = new Map<string, unknown>();
/** build-once memo for gun components (keyed by a name that includes the resolution and the options) */
export function once<T>(key: string, make: () => T): T {
  let v = CACHE.get(key) as T | undefined;
  if (v === undefined) CACHE.set(key, (v = make()));
  return v;
}
/** merge component models (later wins) into one part model, shifted by an integer voxel offset */
export function compose(name: string, parts: (VoxelModel | null | undefined | false)[], d: V3 = [0, 0, 0]) {
  const out = new VoxelModel(name);
  const [dx, dy, dz] = d;
  for (const p of parts) if (p) p.forEach((x, y, z, c, f) => out.set(x + dx, y + dy, z + dz, c, f));
  return out;
}
/** a design-space point (cm) to a part's voxel coordinates */
export const vox = (p: V3, k: number, d: V3 = [0, 0, 0]): V3 => [p[0] * k + d[0], p[1] * k + d[1], p[2] * k + d[2]];
/** thin features never thinner than ~1.1 voxels, so the in-run build keeps them whole */
export const thick = (r: number, k: number) => Math.max(r, 0.56 / k);

/** a dense occupancy grid over a model (one voxel of padding), for the finishing passes */
function occGrid(m: VoxelModel, pad: number) {
  const b = m.bounds();
  const ox = b.minX - pad, oy = b.minY - pad, oz = b.minZ - pad;
  const sx = b.maxX - b.minX + 1 + 2 * pad, sy = b.maxY - b.minY + 1 + 2 * pad, sz = b.maxZ - b.minZ + 1 + 2 * pad;
  const occ = new Uint8Array(sx * sy * sz);
  const sxy = sx * sy;
  m.forEach((x, y, z) => (occ[x - ox + sx * (y - oy) + sxy * (z - oz)] = 1));
  return { occ, ox, oy, oz, sx, sy, sz, sxy };
}
/**
 * Lazy colours, worn edges, relief, then the hidden core dropped: one dense
 * occupancy grid serves every pass (the same results as resolveLazy, wearEdges,
 * relief and hollow run one after another, several times faster).
 */
export function finishPart(m: VoxelModel, k: number, o: { wear?: ((rgb: number, amt: number) => number | null) | false; relief?: boolean } = {}) {
  if (!m.count) return m;
  const r = Math.max(1, Math.round(0.8 * k));
  const R2 = r * 2 + 1;
  const thr = r >= 2 ? 0.47 : 0.4;
  const G = occGrid(m, R2 + 1);
  const { occ, ox, oy, oz, sx, sy, sz, sxy } = G;
  const at = (x: number, y: number, z: number) => x - ox + sx * (y - oy) + sxy * (z - oz);
  // summed-volume table for the wear pass
  const wear = o.wear === false ? null : o.wear ?? gunWear();
  let S: Int32Array | null = null;
  const SX = sx + 1, SY = sy + 1;
  if (wear) {
    S = new Int32Array(SX * SY * (sz + 1));
    for (let z = 0; z < sz; z++)
      for (let y = 0; y < sy; y++) {
        let row = 0;
        for (let x = 0; x < sx; x++) {
          row += occ[x + sx * y + sxy * z];
          const i = x + 1 + SX * (y + 1 + SY * (z + 1));
          S[i] = row + S[i - SX] + S[i - SX * SY] - S[i - SX - SX * SY];
        }
      }
  }
  const id = (x: number, y: number, z: number) => x + SX * (y + SY * z);
  const sum = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
    S![id(x1, y1, z1)] - S![id(x0 - 1, y1, z1)] - S![id(x1, y0 - 1, z1)] - S![id(x1, y1, z0 - 1)] + S![id(x0 - 1, y0 - 1, z1)] + S![id(x0 - 1, y1, z0 - 1)] + S![id(x1, y0 - 1, z0 - 1)] - S![id(x0 - 1, y0 - 1, z0 - 1)];
  const vol = (2 * r + 1) ** 3, vol2 = (2 * R2 + 1) ** 3;
  const doRelief = o.relief !== false;
  const sets: number[] = [];
  const dels: number[] = [];
  m.forEach((x, y, z, c, f) => {
    const i = at(x, y, z);
    const up = occ[i + sx], dn = occ[i - sx];
    const hidden = occ[i + 1] && occ[i - 1] && up && dn && occ[i + sxy] && occ[i - sxy];
    if (hidden) {
      dels.push(x, y, z);
      return;
    }
    let col = c, fl = f;
    if (f & LZ) {
      const fn = LAZY[c];
      col = fn ? fn((x + 0.5) / k, (y + 0.5) / k, (z + 0.5) / k) : 0x34302c;
      fl = f & ~LZ;
    }
    const lit = !(fl & (VF.EMISSIVE | VF.GLOW));
    if (wear && lit) {
      const X = x - ox + 1, Y = y - oy + 1, Z = z - oz + 1;
      const fr = sum(X - r, Y - r, Z - r, X + r, Y + r, Z + r) / vol;
      if (fr < thr && sum(X - R2, Y - R2, Z - R2, X + R2, Y + R2, Z + R2) / vol2 >= 0.2) {
        const rubN = n3((x / k) * 0.45 + 3.3, (y / k) * 0.45, (z / k) * 0.45) * 0.5 + 0.5;
        const amt = Math.min(1, (thr - fr) / 0.12) * (0.45 + 0.55 * rubN);
        if (amt >= 0.42) {
          const nc = wear(col, amt);
          if (nc !== null) col = nc;
        }
      }
    }
    if (doRelief && lit) {
      if (!up) col = mulRGB(col, 1.06);
      else if (!dn) col = mulRGB(col, 0.88);
    }
    if (col !== c || fl !== f) sets.push(x, y, z, col, fl);
  });
  for (let i = 0; i < sets.length; i += 5) m.set(sets[i], sets[i + 1], sets[i + 2], sets[i + 3], sets[i + 4]);
  for (let i = 0; i < dels.length; i += 3) m.del(dels[i], dels[i + 1], dels[i + 2]);
  return m;
}

// ------------------------------------------------------------------ rigs made of components
/** a component's exploded-view vector: unit dir in its parent's space, dist in metres, delay 0..0.6 staggers the fly-out */
export interface ExplodeSpec {
  dir: V3;
  dist: number;
  delay: number;
}
/** one component of a gun: rig part name, a label for the UI, the customisation slot that swaps it (if any) */
export interface GunComponent {
  name: string;
  label: string;
  slot?: string;
  parent?: string;
}
/**
 * Assembles a gun out of components. Component models are sculpted in the gun's
 * design space (voxel = design cm * k); `local` ones (cylinder, hammer, drum) are
 * built round their own origin. Pivots go at the given design points; attach
 * points are worked out in each parent's voxel space.
 */
export class GunRigBuilder {
  parts: PartSpec[] = [];
  explode: Record<string, ExplodeSpec> = {};
  components: GunComponent[] = [];
  private off = new Map<string, V3>();
  constructor(readonly k: number) {}
  /** the root part (its model in design voxels shifted by d), pivot at the design point `at` */
  root(name: string, model: VoxelModel, at: V3, label: string, d: V3 = [0, 0, 0]) {
    this.parts.push({ name, model, pivot: vox(at, this.k, d), attach: [0, 0, 0] });
    this.off.set(name, d);
    this.components.push({ name, label });
    return this;
  }
  add(name: string, model: VoxelModel | null | undefined, parent: string, at: V3, c: { label: string; slot?: string; ex?: V3; dist?: number; delay?: number; local?: boolean }) {
    if (!model || !model.count) return this;
    const po = this.off.get(parent);
    if (!po) return this;
    const k = this.k;
    this.parts.push({ name, model, pivot: c.local ? [0, 0, 0] : vox(at, k), attach: vox(at, k, po), parent });
    this.off.set(name, c.local ? [-at[0] * k, -at[1] * k, -at[2] * k] : [0, 0, 0]);
    if (c.ex) {
      const l = Math.hypot(c.ex[0], c.ex[1], c.ex[2]) || 1;
      this.explode[name] = { dir: [c.ex[0] / l, c.ex[1] / l, c.ex[2] / l], dist: c.dist ?? 0.06, delay: c.delay ?? 0 };
    }
    this.components.push({ name, label: c.label, slot: c.slot, parent });
    return this;
  }
  has(name: string) {
    return this.off.has(name);
  }
  /** a design-space point in a part's voxel coordinates */
  at(part: string, p: V3): V3 {
    return vox(p, this.k, this.off.get(part) ?? [0, 0, 0]);
  }
  sock(part: string, p: V3): SocketSpec {
    return { part, at: this.at(part, p) };
  }
}

/** run a build job to completion */
export function runJob<T>(job: Generator<void, T, void>): T {
  for (;;) {
    const r = job.next();
    if (r.done) return r.value;
  }
}
