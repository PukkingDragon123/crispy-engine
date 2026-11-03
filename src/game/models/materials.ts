// Voxel MATERIAL LIBRARY: reusable, parameterised procedural "textures" for the
// voxel DSL (src/engine/voxel/VoxelModel.ts), plus helpers that carve physical
// detail (nail heads, rivets, bolts, seams, splits, worm holes, scratches,
// bullet holes, rope lashings, iron straps, chains, hewn faces, worn edges).
//
// How to use:
//   m.box(x0, y0, z0, x1, y1, z1, oak({ along: 'x', seed: 3 }));        // a mat is a ColorFn
//   timber(m, [x0, y0, z0, x1, y1, z1], 'y', { mat: weathered({ along: 'y' }), chamfer: 1, hewn: 0.3 });
//   nailHead(m, [x, y, z], 'z+', { rust: 0.6 });
//
// Design rules every material follows (so props stay "anime-painted", not noisy,
// and the greedy mesher keeps triangle counts sane):
//  - Each material maps to a small dark->light tone list (4-6 tones). No per-voxel
//    random jitter: tone changes come from structure (grain lines, rings, knots,
//    cracks, paint chips, strata) so flat regions stay flat.
//  - Directional materials (wood, rope, streaked rust) stretch their features
//    along the grain / drip axis, so long same-colour runs merge into few quads.
//  - Everything is deterministic in (x, y, z, seed).
import { VoxelModel, VF, ColorFn, mix, mulRGB } from '../../engine/voxel/VoxelModel';
import { hash3, noise } from '../../engine/math/rand';
import type { Ramp } from './style';

export type Axis = 'x' | 'y' | 'z';
export type Face = 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-';
export type V3 = [number, number, number];
/** a material: (x,y,z) => packed rgb (null = leave the voxel empty) */
export type Mat = ColorFn;
/** inclusive voxel box [x0, y0, z0, x1, y1, z1] */
export type Box = [number, number, number, number, number, number];

// =============================================================================
// small maths
// =============================================================================
const fract = (v: number) => v - Math.floor(v);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** seeded 3D simplex (-1..1) on the shared noise field, offset by seed */
const n3 = (x: number, y: number, z: number, seed: number) => noise.n3(x + seed * 31.7, y - seed * 17.3, z + seed * 7.91);
/** seeded 3-octave fbm (-1..1, mostly within +-0.6) */
function fbm(x: number, y: number, z: number, seed: number, oct = 3) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * n3(x * f, y * f, z * f, seed + i * 3);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

/** pick a tone from a dark->light list with t in 0..1 (quantised, keeps mesher runs long) */
export function tone(tones: readonly number[], t: number): number {
  return tones[Math.max(0, Math.min(tones.length - 1, Math.floor(clamp01(t) * tones.length)))];
}
/** a TOON/PR ramp as a dark->light tone list [dark, shade, base, hi] */
export function rampTones(r: Ramp): number[] {
  return [r.dark, r.shade, r.base, r.hi];
}
/** a painter's 5-tone dark->light list from one colour: cool deep shade, warm light */
export function tonesOf(base: number, spread = 0.22): number[] {
  const warm = 0xfff2d8, cool = 0x2a2238;
  return [mix(base, cool, spread * 1.9), mix(base, cool, spread * 0.9), base, mix(base, warm, spread * 0.8), mix(base, warm, spread * 1.6)];
}
/** a Ramp (base/shade/hi/dark) from one colour, for code that wants the TOON shape */
export function rampOf(base: number, spread = 0.22): Ramp {
  const t = tonesOf(base, spread);
  return { base: t[2], shade: t[1], hi: t[3], dark: t[0] };
}

/** coordinates in a grain frame: a = along the axis, (u, v) = the cross-section */
export function frameOf(along: Axis, x: number, y: number, z: number): V3 {
  return along === 'x' ? [x, y, z] : along === 'y' ? [y, x, z] : [z, x, y];
}

/** 3D cellular (Worley) noise: [F1, F2] distances to the two nearest jittered feature points (cell size 1) */
export function cellular(x: number, y: number, z: number, seed = 0): [number, number] {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let f1 = 9, f2 = 9;
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (let k = -1; k <= 1; k++) {
        const cx = xi + i, cy = yi + j, cz = zi + k;
        const px = cx + hash3(cx + seed * 13, cy, cz), py = cy + hash3(cx, cy + seed * 7, cz + 5), pz = cz + hash3(cx - 3, cy, cz + seed * 11);
        const d = Math.hypot(px - x, py - y, pz - z);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
  return [f1, f2];
}

// =============================================================================
// WOOD
// =============================================================================
/** a wood species: 5 earlywood tones (dark->light), latewood ring line, knot core, 3 end-grain tones, check (crack) colour */
export interface WoodSpecies {
  tones: readonly number[];
  late: number;
  knot: number;
  end: readonly number[];
  check: number;
}
export const WOOD = {
  /** warm golden oak */
  oak: { tones: [0x6a4426, 0x8a5c34, 0xa36e40, 0xb8834f, 0xcd9c66], late: 0x6e4628, knot: 0x3e2614, end: [0x9a6c40, 0xc2925e, 0xd8ae7c], check: 0x2e1c10 },
  /** pale resinous pine with strong orange latewood */
  pine: { tones: [0x96643a, 0xb88250, 0xcf9c62, 0xdeb276, 0xeac690], late: 0xa86a34, knot: 0x5a3418, end: [0xb88a58, 0xdcb680, 0xeccb98], check: 0x4a2c16 },
  /** dark walnut / tarred timber */
  walnut: { tones: [0x3a2416, 0x4e3220, 0x62402a, 0x765036, 0x8c6446], late: 0x3e2818, knot: 0x22140a, end: [0x5e3e28, 0x7e5a3e, 0x967252], check: 0x1a0f08 },
  /** red cedar / redwood */
  cedar: { tones: [0x6e3424, 0x8e4630, 0xa85a3c, 0xbe7050, 0xd08a66], late: 0x7a3a26, knot: 0x42180e, end: [0x9a5a40, 0xc07a5a, 0xd49674], check: 0x341208 },
  /** sun-weathered silver-grey timber (UV-bleached surface, brown underneath) */
  weathered: { tones: [0x4a4138, 0x5f5447, 0x736656, 0x877866, 0x9c8c76], late: 0x8e7f6a, knot: 0x342c26, end: [0x7a6650, 0x957c60, 0xa88e70], check: 0x2a221c },
  /** bone-dry bleached boards (ruins, driftwood) */
  bleached: { tones: [0x6e6558, 0x857a6a, 0x9a8e7c, 0xaea08c, 0xc0b29c], late: 0xb4a690, knot: 0x4a4038, end: [0x9e8c72, 0xb4a084, 0xc6b296], check: 0x3a322a },
} as const satisfies Record<string, WoodSpecies>;
export type WoodName = keyof typeof WOOD;

export interface GrainOpts {
  /** grain direction */
  along: Axis;
  species?: WoodName | WoodSpecies;
  seed?: number;
  /** growth-ring spacing in voxels (default 3) */
  ring?: number;
  /** log pith in (u, v) cross-section coords; default seeded below/beside the board: flat-sawn cathedral figure */
  pith?: [number, number];
  /** knots per ~40 voxels of length (default 0.7; 0 = clear timber) */
  knots?: number;
  /** grain-axis coords of the board's two end faces: painted as end grain (rings + radial checks) */
  ends?: [number, number];
  /** 0..1 mix toward silver-grey sun-weathering */
  bleach?: number;
  /** 0..1 grain figure strength (default 1). Lower = calmer boards, fewer quads: use ~0.5 for scatter props */
  figure?: number;
}

function speciesOf(s: WoodName | WoodSpecies | undefined): WoodSpecies {
  if (!s) return WOOD.oak;
  return typeof s === 'string' ? WOOD[s] : s;
}

/**
 * Wood grain: growth rings (flat-sawn cathedral arches and straight quarter-sawn
 * stripes depending on the pith), latewood lines, fibre streaks along the grain,
 * knots with the grain swirling round them, end grain with rings and radial checks.
 */
export function woodGrain(o: GrainOpts): Mat {
  const sp = speciesOf(o.species);
  const seed = o.seed ?? 0;
  const ring = o.ring ?? 3;
  const pu = o.pith?.[0] ?? (hash3(seed, 11, 3) - 0.5) * 30;
  const pv = o.pith?.[1] ?? -(10 + hash3(seed, 5, 9) * 26);
  const drift = (hash3(seed, 2, 7) - 0.5) * 0.06; // rings slowly drift along the board: long flame figure
  const kDen = o.knots ?? 0.7;
  const KA = 40, KU = 9; // knot lattice (along, across)
  const bleach = o.bleach ?? 0;
  const grey = 0xa49a8a;
  const fin = (c: number) => (bleach > 0 ? mix(c, grey, bleach) : c);
  const ends = o.ends;
  const fig = o.figure ?? 1;
  const lateW = 0.17 * fig, fibHi = 0.46 + (1 - fig) * 0.35, fibLo = -0.55 - (1 - fig) * 0.35;
  return (x, y, z) => {
    const [a, u, v] = frameOf(o.along, x, y, z);
    // ---- end grain
    if (ends && (a === ends[0] || a === ends[1])) {
      const r = Math.hypot(u - pu, v - pv) + n3(u * 0.2, v * 0.2, a, seed) * 0.8;
      const ang = Math.atan2(v - pv, u - pu);
      const chk = fract((ang / (Math.PI * 2)) * 7 + hash3(seed, 1, 1)) < 0.05 && r > 2;
      if (chk) return fin(sp.check);
      const ph = fract(r / ring);
      return fin(ph < 0.22 ? sp.end[0] : n3(u * 0.3, v * 0.3, a + 7, seed) > 0.25 ? sp.end[2] : sp.end[1]);
    }
    // ---- knots: nearest knot in the (a, u) lattice; the knot runs straight through the board (along v)
    let swirl = 0;
    if (kDen > 0) {
      const ka0 = Math.floor(a / KA), ku0 = Math.floor(u / KU);
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          const ci = ka0 + i, cj = ku0 + j;
          if (hash3(ci, cj, seed + 77) > kDen * 0.55) continue;
          const kr = 1.1 + hash3(ci, cj, seed + 5) * 1.5;
          const ka = (ci + 0.15 + hash3(ci, cj, seed + 1) * 0.7) * KA, ku = (cj + 0.2 + hash3(ci, cj, seed + 2) * 0.6) * KU;
          const da = (a - ka) / (kr * 1.5), du = (u - ku) / kr;
          const d2 = da * da + du * du;
          if (d2 < 1) return fin(d2 < 0.3 ? sp.knot : mix(sp.knot, sp.late, 0.5));
          if (d2 < 12) swirl += kr * 2.2 * Math.exp(-d2 * 0.35) * (u > ku ? 1 : -1);
        }
    }
    // ---- rings
    const r = Math.hypot(u - pu + a * drift + swirl, v - pv) + n3(a * 0.035, u * 0.12, v * 0.12, seed) * 1.6;
    const ph = fract(r / (ring * (fig < 1 ? 1.5 - fig * 0.5 : 1)));
    if (ph < lateW) return fin(sp.late);
    // ---- earlywood: broad figure + fibre streaks (long along the grain)
    const broad = n3(a * 0.02, u * 0.1, v * 0.1, seed + 9) * 0.5;
    const fib = n3(a * 0.045, u * 0.6, v * 0.6, seed + 4);
    let t = 0.55 + broad;
    if (fib > fibHi) t += 0.22;
    else if (fib < fibLo) t -= 0.25;
    return fin(tone(sp.tones, t));
  };
}
/** oak planking (warm golden grain) */
export const oak = (o: Omit<GrainOpts, 'species'>) => woodGrain({ ...o, species: 'oak' });
/** pine planking (pale, strong latewood) */
export const pine = (o: Omit<GrainOpts, 'species'>) => woodGrain({ ...o, species: 'pine' });
/** walnut / tarred dark timber */
export const darkWood = (o: Omit<GrainOpts, 'species'>) => woodGrain({ ...o, species: 'walnut' });

/** end grain only (log ends, sawn post tops): concentric rings around a pith + radial checks */
export function endGrain(o: { along: Axis; species?: WoodName | WoodSpecies; seed?: number; ring?: number; pith?: [number, number] }): Mat {
  const sp = speciesOf(o.species);
  const seed = o.seed ?? 0;
  const ring = o.ring ?? 2.2;
  return (x, y, z) => {
    const [a, u, v] = frameOf(o.along, x, y, z);
    const pu = o.pith?.[0] ?? 0, pv = o.pith?.[1] ?? 0;
    const r = Math.hypot(u - pu, v - pv) + n3(u * 0.25, v * 0.25, a * 0.1, seed) * 0.7;
    const ang = Math.atan2(v - pv, u - pu);
    if (r > 1.5 && fract((ang / (Math.PI * 2)) * 5 + hash3(seed, 3, 3)) < 0.06) return sp.check;
    if (r < 0.8) return sp.end[0];
    return fract(r / ring) < 0.25 ? sp.end[0] : r > 6 && hash3(Math.round(r), seed, 1) > 0.5 ? sp.end[2] : sp.end[1];
  };
}

/**
 * Sun-bleached weathered planks: silver-grey surface, raised latewood ridges that
 * catch the light, deep dark checks (drying cracks) running with the grain with
 * sand caught in them, optional rot darkening near the bottom.
 */
export function weathered(o: Omit<GrainOpts, 'species'> & { species?: WoodName | WoodSpecies; checks?: number; dust?: number; rotBelow?: number; rotFrom?: number }): Mat {
  const sp = speciesOf(o.species ?? 'weathered');
  const seed = o.seed ?? 0;
  const base = woodGrain({ ...o, species: { ...sp, late: sp.tones[3] } }); // weathered: latewood stands proud and catches the light
  const chk = o.checks ?? 0.6;
  const dust = o.dust ?? 0.5;
  const rotC = 0x4e4236, rotC2 = 0x6a5a48;
  return (x, y, z) => {
    const [a, u, v] = frameOf(o.along, x, y, z);
    if (chk > 0) {
      // a check: a thin long crack (low frequency along a, high across), only in some stretches
      const line = Math.abs(n3(a * 0.016, u * 0.5, v * 0.5, seed + 21));
      const zone = n3(a * 0.025, u * 0.05, v * 0.05, seed + 22);
      if (line < 0.032 * chk && zone > 0.1) return dust > 0 && hash3(Math.floor(a / 3), u, v + seed) < dust * 0.35 ? 0xc4a87e : sp.check;
    }
    if (o.rotBelow !== undefined && y <= o.rotBelow) {
      const depth = (o.rotBelow - y) / Math.max(1, o.rotBelow - (o.rotFrom ?? o.rotBelow - 8));
      const n = fbm(x * 0.2, y * 0.2, z * 0.2, seed + 31);
      if (n + depth * 0.6 > 0.35) return n > 0.3 ? rotC : rotC2;
    }
    return base(x, y, z);
  };
}

/**
 * Painted wood with chipped and peeling paint: brush streaks along the grain, sun
 * fade, a white primer edge round every chip, bare (weathered) wood showing through.
 * `chip` 0..1 = how much paint is gone.
 */
export function paintedWood(paint: number | Ramp, o: { along: Axis; seed?: number; chip?: number; fade?: number; under?: Mat; primer?: number; ends?: [number, number] }): Mat {
  const seed = o.seed ?? 0;
  const pt = typeof paint === 'number' ? tonesOf(paint, 0.16) : [paint.dark, paint.shade, paint.base, paint.hi];
  const p3 = typeof paint === 'number' ? [pt[1], pt[2], pt[3]] : [pt[1], pt[2], pt[3]];
  const lip = pt[0];
  const chip = o.chip ?? 0.3;
  const fade = o.fade ?? 0.15;
  const under = o.under ?? weathered({ along: o.along, seed: seed + 5, checks: 0.4, ends: o.ends });
  const primer = o.primer ?? 0xe6dcc6;
  const thr = -0.62 + chip * 1.1; // coverage threshold
  return (x, y, z) => {
    const [a, u, v] = frameOf(o.along, x, y, z);
    if (o.ends && (a === o.ends[0] || a === o.ends[1])) return under(x, y, z); // sawn ends are never painted
    // peel field: elongated along the grain, ragged at small scale
    const c = fbm(a * 0.045, u * 0.28, v * 0.28, seed) + n3(a * 0.3, u * 0.9, v * 0.9, seed + 3) * 0.12;
    if (c < thr) return under(x, y, z);
    if (c < thr + 0.05) return hash3(Math.floor(a / 2), u, v) < 0.5 ? primer : lip; // primer edge / curled lip
    const brush = n3(a * 0.06, u * 0.8, v * 0.8, seed + 7);
    let col = brush > 0.38 ? p3[2] : brush < -0.42 ? p3[0] : p3[1];
    if (fade > 0) {
      const f = fbm(a * 0.015, u * 0.06, v * 0.06, seed + 9);
      col = mix(col, 0xf0e6d2, f > 0.15 ? fade * 1.4 : fade * 0.6);
    }
    return col;
  };
}

/**
 * Charred wood: alligator-cracked charcoal blocks (glossy crowns, deep black
 * fissures), fading to scorched brown wood where `depth` < 1.
 */
export function charredWood(o: { along: Axis; seed?: number; depth?: number; block?: number; under?: Mat }): Mat {
  const seed = o.seed ?? 0;
  const depth = o.depth ?? 1;
  const bs = o.block ?? 3.2;
  const under = o.under ?? darkWood({ along: o.along, seed });
  const char = [0x141010, 0x231c19, 0x332a25, 0x4a3f38];
  return (x, y, z) => {
    const [a, u, v] = frameOf(o.along, x, y, z);
    const burn = depth >= 1 ? 1 : fbm(x * 0.07, y * 0.07, z * 0.07, seed + 2) * 0.8 + depth * 1.4 - 0.4;
    if (burn < 0) return under(x, y, z);
    if (burn < 0.12) return mix(under(x, y, z) ?? char[2], 0x2a1a10, 0.6); // scorched rim
    const [f1, f2] = cellular(a / (bs * 0.75), u / bs, v / bs, seed);
    if (f2 - f1 < 0.12) return char[0];
    return f1 < 0.3 ? char[3] : f1 < 0.55 ? char[2] : char[1];
  };
}

// =============================================================================
// METALS
// =============================================================================
const IRON = [0x2c2a29, 0x403d3a, 0x56524d, 0x6e6962, 0x8a857c];
const RUST_T = [0x4e2414, 0x6e3218, 0x8c4422, 0xa85a2c, 0xc27a40];
/** deep, old rust for blackened hardware (no bright orange) */
const RUST_DARK = [0x34201a, 0x42261a, 0x50301e, 0x5e3a24, 0x6a4430];

/**
 * Rusted iron: dark forged iron, rust blooms with pitting in their hearts, and
 * vertical rust streaks running down (-y) below them. rust 0..1.
 */
export function rustedIron(o: { seed?: number; rust?: number; pitting?: number; streaks?: boolean; tones?: number[]; rustTones?: number[] } = {}): Mat {
  const seed = o.seed ?? 0;
  const rust = o.rust ?? 0.45;
  const pit = o.pitting ?? 0.5;
  const it = o.tones ?? IRON;
  const RUST = o.rustTones ?? RUST_T;
  return (x, y, z) => {
    const r = fbm(x * 0.16, y * 0.16, z * 0.16, seed) + n3(x * 0.6, y * 0.6, z * 0.6, seed + 1) * 0.15;
    const thr = 0.5 - rust * 0.9;
    if (r > thr) {
      const k = (r - thr) / 0.5;
      if (k > 0.55 && hash3(x, y, z + seed) < pit * 0.22) return RUST[0]; // pits
      return tone(RUST, 0.25 + k * 0.6 + (n3(x * 0.5, y * 0.5, z * 0.5, seed + 2) > 0.3 ? 0.25 : 0));
    }
    if (o.streaks ?? true) {
      const s = n3(x * 0.55 + z * 0.55, y * 0.06, seed, seed + 3);
      if (s > 0.62 - rust * 0.25) return s > 0.75 ? RUST[2] : RUST[1];
    }
    const sheen = n3(x * 0.25, y * 0.25, z * 0.25, seed + 4);
    return sheen > 0.35 ? it[3] : sheen < -0.4 ? it[1] : it[2];
  };
}
/** blackened wrought iron (straps, hinges, chain): mostly dark iron with rust only at the edges of blooms */
export const blackIron = (seed = 0, rust = 0.25) => rustedIron({ seed, rust, pitting: 0.3, streaks: false, rustTones: RUST_DARK });

/** brass with verdigris patina in blooms and a tarnished brown cast; polish 0..1 adds bright worn highlights */
export function brass(o: { seed?: number; patina?: number; polish?: number } = {}): Mat {
  const seed = o.seed ?? 0;
  const pat = o.patina ?? 0.35;
  const pol = o.polish ?? 0.3;
  const B = [0x6e4c16, 0x9a7024, 0xc4952e, 0xdcb04a, 0xf2d27a];
  const V = [0x2e6a58, 0x4a8c74, 0x6eae94];
  return (x, y, z) => {
    const p = fbm(x * 0.2, y * 0.2, z * 0.2, seed);
    if (p > 0.5 - pat * 0.7) return tone(V, (p - (0.5 - pat * 0.7)) * 2.2);
    if (p > 0.38 - pat * 0.7) return 0x6a5426; // tarnish halo round the patina
    const s = n3(x * 0.35, y * 0.35, z * 0.35, seed + 1);
    return tone(B, 0.45 + s * 0.6 + (s > 0.45 ? pol * 0.4 : 0));
  };
}

/** galvanised tin: zinc spangle (big crystal cells in slightly different greys), dull oxide and rust at the bottom edge */
export function tin(o: { seed?: number; rust?: number; rustBelow?: number } = {}): Mat {
  const seed = o.seed ?? 0;
  const T = [0x6a6862, 0x8c8a84, 0xa8a6a0, 0xc2c0ba, 0xd8d6d0];
  return (x, y, z) => {
    if (o.rustBelow !== undefined && y <= o.rustBelow && n3(x * 0.3, y * 0.15, z * 0.3, seed + 5) > -0.2 + (y - o.rustBelow) * 0.15) return RUST_T[1 + ((hash3(x >> 1, y, z >> 1) * 3) | 0)];
    const rr = o.rust ?? 0.15;
    if (fbm(x * 0.18, y * 0.18, z * 0.18, seed + 3) > 0.55 - rr * 0.8) return RUST_T[2];
    const [f1] = cellular(x / 5, y / 5, z / 5, seed);
    const cell = hash3(Math.floor(x / 5 + f1), Math.floor(y / 5), seed);
    return T[1 + Math.floor(cell * 3)];
  };
}

// =============================================================================
// ORGANICS: leather, rope, linen / canvas, paper, cloth dyes, bone
// =============================================================================
/** leather: creases (dark wandering lines), scuffed light wear on high spots, sparse pores. tone = base colour */
export function leather(o: { seed?: number; tone?: number; wear?: number } = {}): Mat {
  const seed = o.seed ?? 0;
  const t = tonesOf(o.tone ?? 0x8a5530, 0.2);
  const wear = o.wear ?? 0.35;
  return (x, y, z) => {
    const cr = Math.abs(n3(x * 0.22, y * 0.3, z * 0.22, seed));
    if (cr < 0.045) return t[0];
    const w = fbm(x * 0.15, y * 0.15, z * 0.15, seed + 1);
    if (w > 0.45 - wear * 0.4) return t[3];
    return cr < 0.12 ? t[1] : t[2];
  };
}

const ROPE = [0x6e5432, 0x94764a, 0xb2925e, 0xcaa874];
/** rope laid along an axis: three twisted strands (diagonal bands), fibre fuzz. tones dark->light */
export function ropeMat(o: { along: Axis; seed?: number; tones?: number[] }): Mat {
  const t = o.tones ?? ROPE;
  const seed = o.seed ?? 0;
  return (x, y, z) => {
    const [a, u, v] = frameOf(o.along, x, y, z);
    const s = ((Math.floor(a + u * 0.7 - v * 0.7) % 3) + 3) % 3;
    if (hash3(x + seed, y, z) < 0.04) return t[3];
    return s === 0 ? t[0] : s === 1 ? t[1] : t[2];
  };
}

/** linen / canvas: warp and weft thread lines, slubs, tide-line stains, sun fade. weave = thread spacing */
export function linen(o: { seed?: number; tone?: number; weave?: number; stains?: number; fade?: number; heavy?: boolean } = {}): Mat {
  const seed = o.seed ?? 0;
  const t = tonesOf(o.tone ?? 0xe6d8b6, o.heavy ? 0.2 : 0.14);
  const w = o.weave ?? (o.heavy ? 2 : 3);
  const st = o.stains ?? 0.3;
  const fade = o.fade ?? 0;
  return (x, y, z) => {
    const s = fbm(x * 0.09, y * 0.09, z * 0.09, seed);
    if (st > 0 && Math.abs(s - 0.2) < 0.03 * st + 0.005) return t[0]; // tide line
    let i = s > 0.2 && st > 0.3 ? 1 : 2;
    const warp = (((x + z) % w) + w) % w === 0, weft = ((y % w) + w) % w === 0;
    if (warp && weft) i -= 1;
    else if (warp || weft) i += o.heavy ? -1 : 0;
    if (n3(x * 0.04, y * 0.6, z * 0.04, seed + 2) > 0.55) i += 1; // slub thread
    const c = t[Math.max(0, Math.min(4, i))];
    return fade > 0 ? mix(c, 0xf6eedc, fade * clamp01(0.5 + fbm(x * 0.03, y * 0.03, z * 0.03, seed + 4))) : c;
  };
}
/** heavy canvas (tarps, tents, sacks) */
export const canvas = (o: { seed?: number; tone?: number; stains?: number; fade?: number } = {}) => linen({ ...o, tone: o.tone ?? 0xcdb88e, heavy: true });

/**
 * Aged paper: foxing spots, a darker ochre rim near the edge, sun-faded middle,
 * ink-safe flat tone in between. rect = sheet bounds in the sheet plane (for the edge darkening).
 */
export function agedPaper(o: { seed?: number; tone?: number; rect?: [number, number, number, number]; plane?: 'xy' | 'zy' | 'xz'; age?: number } = {}): Mat {
  const seed = o.seed ?? 0;
  const t = tonesOf(o.tone ?? 0xecdcb0, 0.13);
  const age = o.age ?? 0.5;
  const foxC = 0xb0864e;
  return (x, y, z) => {
    const [p, q] = o.plane === 'zy' ? [z, y] : o.plane === 'xz' ? [x, z] : [x, y];
    if (hash3(x + seed, y, z) < age * 0.02 && n3(x * 0.2, y * 0.2, z * 0.2, seed + 1) > 0.1) return foxC;
    let e = 9;
    if (o.rect) e = Math.min(p - o.rect[0], o.rect[2] - p, q - o.rect[1], o.rect[3] - q);
    const n = fbm(x * 0.1, y * 0.1, z * 0.1, seed);
    if (e <= 0 || (e <= 1 && n > 0.0 - age * 0.3)) return t[1];
    if (n > 0.42 - age * 0.25) return t[1];
    if (n < -0.3) return t[3];
    return t[2];
  };
}

/** dyed cloth from one colour: weave lines, sun fade toward the top, dirt toward the hem (below dirtY), optional stripes */
export function clothDye(base: number, o: { seed?: number; fade?: number; dirtY?: number; stripes?: { axis: Axis; every: number; width: number; color: number }; weave?: number } = {}): Mat {
  const seed = o.seed ?? 0;
  const tb = tonesOf(base, 0.18);
  const ts = o.stripes ? tonesOf(o.stripes.color, 0.18) : tb;
  const w = o.weave ?? 3;
  return (x, y, z) => {
    let t = tb;
    if (o.stripes) {
      const c = o.stripes.axis === 'x' ? x : o.stripes.axis === 'y' ? y : z;
      if ((((c % o.stripes.every) + o.stripes.every) % o.stripes.every) < o.stripes.width) t = ts;
    }
    let i = 2;
    if ((((x + z) % w) + w) % w === 0 && ((y % w) + w) % w === 0) i = 1;
    const f = fbm(x * 0.06, y * 0.06, z * 0.06, seed);
    if (f > 0.3) i += 1;
    else if (f < -0.35) i -= 1;
    let c = t[i];
    if (o.fade) c = mix(c, 0xf2e8d6, o.fade * (f > 0 ? 0.8 : 0.4));
    if (o.dirtY !== undefined && y < o.dirtY && n3(x * 0.25, y * 0.25, z * 0.25, seed + 3) > -0.3 + (y - o.dirtY) * 0.12) c = mix(c, 0x7a5e3e, 0.45);
    return c;
  };
}

/** sun-bleached bone: hairline cracks along the bone axis, porous spongy ends, dirt stain below dirtY */
export function boneMat(o: { seed?: number; along?: Axis; tones?: number[]; porous?: number; cracks?: number; dirtY?: number } = {}): Mat {
  const seed = o.seed ?? 0;
  const t = o.tones ?? [0xa9845a, 0xd0b088, 0xe8d2aa, 0xf6e6c6, 0xfff4de];
  const por = o.porous ?? 0.4;
  const crk = o.cracks ?? 0.5;
  const along = o.along ?? 'y';
  return (x, y, z) => {
    const [a, u, v] = frameOf(along, x, y, z);
    if (crk > 0 && Math.abs(n3(a * 0.05, u * 0.7, v * 0.7, seed)) < 0.028 * crk) return t[0];
    const p = fbm(x * 0.3, y * 0.3, z * 0.3, seed + 1);
    if (p > 0.55 - por * 0.4 && hash3(x, y, z + seed) < 0.5) return t[1];
    let c = tone(t, 0.6 + fbm(x * 0.07, y * 0.07, z * 0.07, seed + 2) * 0.8);
    if (o.dirtY !== undefined && y < o.dirtY && n3(x * 0.3, y * 0.2, z * 0.3, seed + 3) > -0.2) c = mix(c, 0x8a6a44, 0.4);
    return c;
  };
}

// =============================================================================
// EARTH & STONE: adobe, plaster, sandstone, limestone
// =============================================================================
/**
 * Adobe mud plaster: broad hand-trowelled mottling, branching hairline cracks,
 * straw flecks, and spalled patches showing the coursed mud bricks beneath.
 */
export function adobe(o: { seed?: number; tones?: number[]; cracks?: number; straw?: number; bricks?: number; brick?: [number, number] } = {}): Mat {
  const seed = o.seed ?? 0;
  const t = o.tones ?? [0x8a6240, 0xb08258, 0xc8986a, 0xd8a878, 0xe8bc8e];
  const crk = o.cracks ?? 0.5;
  const straw = o.straw ?? 0.4;
  const br = o.bricks ?? 0;
  const [bw, bh] = o.brick ?? [8, 4];
  const brickT = [0x6e4a30, 0x9a6c48, 0xae7e56];
  return (x, y, z) => {
    if (br > 0 && fbm(x * 0.06, y * 0.06, z * 0.06, seed + 5) > 0.55 - br * 0.5) {
      const row = Math.floor(y / bh), off = row % 2 ? bw >> 1 : 0;
      if (((y % bh) + bh) % bh === 0 || ((((x + z + off) % bw) + bw) % bw) === 0) return brickT[0];
      return hash3(Math.floor((x + z + off) / bw), row, seed) > 0.5 ? brickT[1] : brickT[2];
    }
    if (crk > 0) {
      const c1 = Math.abs(n3(x * 0.09, y * 0.09, z * 0.09, seed + 1));
      const c2 = Math.abs(n3(x * 0.2, y * 0.2, z * 0.2, seed + 2));
      if (c1 < 0.03 * crk || (c2 < 0.025 * crk && c1 < 0.12)) return t[0];
    }
    if (straw > 0 && hash3(x >> 1, y, z >> 1) < straw * 0.03) return 0xe2c47a;
    return tone(t, 0.62 + fbm(x * 0.05, y * 0.05, z * 0.05, seed) * 0.9);
  };
}

/** lime plaster / whitewash: crazed cracks, rain-run stains, spalled patches revealing adobe (spall 0..1) */
export function plaster(o: { seed?: number; tone?: number; cracks?: number; stains?: number; spall?: number; under?: Mat } = {}): Mat {
  const seed = o.seed ?? 0;
  const t = tonesOf(o.tone ?? 0xeee2c4, 0.12);
  const crk = o.cracks ?? 0.5;
  const stn = o.stains ?? 0.4;
  const spall = o.spall ?? 0.25;
  const under = o.under ?? adobe({ seed: seed + 3, bricks: 0.6 });
  return (x, y, z) => {
    const sp = fbm(x * 0.05, y * 0.05, z * 0.05, seed + 1);
    if (sp > 0.6 - spall * 0.6) return under(x, y, z);
    if (sp > 0.56 - spall * 0.6) return t[0]; // broken lip
    if (crk > 0 && Math.abs(n3(x * 0.15, y * 0.15, z * 0.15, seed + 2)) < 0.025 * crk) return t[1];
    if (stn > 0 && n3(x * 0.4 + z * 0.4, y * 0.05, seed, seed + 4) > 0.65 - stn * 0.3) return mix(t[1], 0xa08460, 0.4);
    return tone(t, 0.55 + fbm(x * 0.08, y * 0.08, z * 0.08, seed) * 0.6);
  };
}

/**
 * Sandstone: wobbling strata, cross-bedded lamina inside each bed (diagonal fine
 * lines that flip direction bed to bed), iron-oxide bands and honeycomb weathering pits.
 */
export function sandstone(o: { seed?: number; tones?: number[]; bed?: number; oxide?: number; pits?: number } = {}): Mat {
  const seed = o.seed ?? 0;
  const t = o.tones ?? [0x8e6440, 0xbb8d5c, 0xd2a472, 0xddb27e, 0xf0c896];
  const bed = o.bed ?? 6;
  const ox = o.oxide ?? 0.4;
  const pits = o.pits ?? 0.3;
  return (x, y, z) => {
    const w = fbm(x * 0.03, 0, z * 0.03, seed) * bed * 0.8;
    const yy = y + w;
    const bi = Math.floor(yy / bed);
    const inBed = yy - bi * bed;
    if (inBed < 0.7) return t[1]; // bedding plane
    if (pits > 0) {
      const [f1] = cellular(x / 3, y / 3, z / 3, seed + bi);
      if (f1 < 0.18 * pits + 0.02 && hash3(bi, seed, 3) < pits) return t[0];
    }
    const dir = hash3(bi, seed, 1) > 0.5 ? 1 : -1;
    const lam = fract((inBed + (x * 0.45 + z * 0.3) * dir) / 2.4);
    if (ox > 0 && Math.abs(n3(x * 0.04, yy * 0.18, z * 0.04, seed + 7)) < 0.05 * ox) return 0xa85a32;
    const bedTone = 0.35 + hash3(bi, seed, 2) * 0.6;
    return tone(t, bedTone + (lam < 0.2 ? -0.22 : 0));
  };
}

/** limestone: pale cream-grey, dissolution pits, small fossil shells (ring arcs) and ochre staining */
export function limestone(o: { seed?: number; tones?: number[]; fossils?: number; pits?: number } = {}): Mat {
  const seed = o.seed ?? 0;
  const t = o.tones ?? [0x8e867a, 0xb2aa9a, 0xcac2b0, 0xdcd4c2, 0xece4d2];
  const fos = o.fossils ?? 0.4;
  const pits = o.pits ?? 0.4;
  return (x, y, z) => {
    const [f1] = cellular(x / 4, y / 4, z / 4, seed);
    if (pits > 0 && f1 < 0.12 * pits) return t[0];
    if (fos > 0) {
      const [g1] = cellular(x / 6 + 3.3, y / 6, z / 6, seed + 9);
      if (Math.abs(g1 - 0.32) < 0.05 && hash3(Math.floor(x / 6), Math.floor(y / 6), Math.floor(z / 6) + seed) < fos) return t[1];
    }
    const st = fbm(x * 0.05, y * 0.12, z * 0.05, seed + 2);
    if (st > 0.45) return mix(t[2], 0xc49a5e, 0.35);
    return tone(t, 0.6 + fbm(x * 0.09, y * 0.09, z * 0.09, seed + 1) * 0.7);
  };
}

/** wind-blown sand: pale ripple crests across the wind (windX), darker troughs, a few grit grains */
export function sandMat(o: { seed?: number; tones?: number[]; ripple?: number } = {}): Mat {
  const seed = o.seed ?? 0;
  const t = o.tones ?? [0xc9a06a, 0xdcb47c, 0xeccb92, 0xf6dcaa];
  const rp = o.ripple ?? 4;
  return (x, y, z) => {
    const ph = fract((x + n3(x * 0.08, 0, z * 0.08, seed) * 3 + z * 0.25) / rp);
    if (hash3(x + seed, y, z) < 0.012) return 0x9a7a52;
    const hiTop = ph < 0.3 ? 3 : ph > 0.75 ? 1 : 2;
    return t[Math.max(0, hiTop - (y < 1 ? 1 : 0))];
  };
}

// =============================================================================
// applying materials
// =============================================================================
/** repaint existing voxels (all, or those inside `box` and/or passing `pred`) with a material, keeping flags */
export function applyMat(m: VoxelModel, mat: Mat, box?: Box, pred?: (x: number, y: number, z: number, rgb: number) => boolean) {
  const out: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (box && (x < box[0] || y < box[1] || z < box[2] || x > box[3] || y > box[4] || z > box[5])) return;
    if (pred && !pred(x, y, z, c)) return;
    const n = mat(x, y, z);
    if (n !== null) out.push([x, y, z, n, f]);
  });
  for (const [x, y, z, c, f] of out) m.set(x, y, z, c, f);
  return m;
}

// =============================================================================
// faces
// =============================================================================
/** outward normal of a face */
export function normalOf(face: Face): V3 {
  return face === 'x+' ? [1, 0, 0] : face === 'x-' ? [-1, 0, 0] : face === 'y+' ? [0, 1, 0] : face === 'y-' ? [0, -1, 0] : face === 'z+' ? [0, 0, 1] : [0, 0, -1];
}
/** two in-plane tangents (u, v) of a face; v is "up" (+y) on side faces */
export function tangentsOf(face: Face): [V3, V3] {
  if (face[0] === 'x') return [[0, 0, 1], [0, 1, 0]];
  if (face[0] === 'z') return [[1, 0, 0], [0, 1, 0]];
  return [[1, 0, 0], [0, 0, 1]];
}
const add = (p: V3, d: V3, k = 1): V3 => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const colAt = (m: VoxelModel, p: V3) => {
  const v = m.get(p[0], p[1], p[2]);
  return v === undefined ? undefined : v & 0xffffff;
};

// =============================================================================
// DETAIL HELPERS (carving & small hardware)
// =============================================================================
/**
 * Nail head driven into a face at p (p = the surface voxel). size 1: one proud voxel;
 * 2: a 2x2 cut-nail head; 3: a domed clout head. rust streak runs down the wood below it.
 */
export function nailHead(m: VoxelModel, p: V3, face: Face, o: { size?: 1 | 2 | 3; rust?: number; streak?: number; seed?: number; mat?: Mat } = {}) {
  const n = normalOf(face);
  const [tu, tv] = tangentsOf(face);
  const size = o.size ?? 1;
  // old nail heads: near-black iron with a little deep rust (bright orange reads as noise at distance)
  const rr = o.rust ?? 0.4;
  const mat: Mat = o.mat ?? ((x, y, z) => (hash3(x, y, z + (o.seed ?? 0)) < rr * 0.55 ? 0x5a3220 : 0x34302c));
  const h = add(p, n);
  if (size === 1) m.set(h[0], h[1], h[2], mat, VF.METAL);
  else if (size === 2) for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) m.set(h[0] + tu[0] * i + tv[0] * j, h[1] + tu[1] * i + tv[1] * j, h[2] + tu[2] * i + tv[2] * j, mat, VF.METAL);
  else {
    for (const [i, j] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) m.set(h[0] + tu[0] * i + tv[0] * j, h[1] + tu[1] * i + tv[1] * j, h[2] + tu[2] * i + tv[2] * j, mat, VF.METAL);
    const d = add(h, n);
    m.set(d[0], d[1], d[2], mat, VF.METAL);
  }
  // rust bleeding down the surface below the nail
  const L = o.streak ?? Math.round((o.rust ?? 0.4) * 4);
  for (let k = 1; k <= L; k++) {
    const q: V3 = [p[0], p[1] - k - (size === 3 ? 1 : 0), p[2]];
    const c = colAt(m, q);
    if (c === undefined) break;
    m.set(q[0], q[1], q[2], mix(c, 0x7a3c1e, k < 2 ? 0.4 : 0.22)); // a soft tea-coloured run, not a spot
  }
  return m;
}

/** domed rivet on a face: a 3x3 head (r=1) proud 1 voxel with a raised centre (r=2: 5-wide head) */
export function rivet(m: VoxelModel, p: V3, face: Face, o: { r?: 1 | 2; mat?: Mat } = {}) {
  const n = normalOf(face);
  const [tu, tv] = tangentsOf(face);
  const r = o.r ?? 1;
  const mat = o.mat ?? blackIron();
  const h = add(p, n);
  for (let i = -r; i <= r; i++)
    for (let j = -r; j <= r; j++) {
      if (r === 2 && Math.abs(i) + Math.abs(j) > 3) continue;
      if (r === 1 && Math.abs(i) + Math.abs(j) > 1) continue;
      m.set(h[0] + tu[0] * i + tv[0] * j, h[1] + tu[1] * i + tv[1] * j, h[2] + tu[2] * i + tv[2] * j, mat, VF.METAL);
    }
  const d = add(h, n);
  m.set(d[0], d[1], d[2], mat, VF.METAL);
  return m;
}

/** hex/square bolt: a square nut (size 2 or 3) on a washer, with the threaded tip standing proud */
export function bolt(m: VoxelModel, p: V3, face: Face, o: { size?: 2 | 3; washer?: boolean; mat?: Mat } = {}) {
  const n = normalOf(face);
  const [tu, tv] = tangentsOf(face);
  const s = o.size ?? 2;
  const mat = o.mat ?? rustedIron({ rust: 0.5 });
  const lo = -Math.floor((s - 1) / 2), hi = lo + s - 1;
  if (o.washer ?? true) {
    const w = add(p, n);
    for (let i = lo - 1; i <= hi + 1; i++) for (let j = lo - 1; j <= hi + 1; j++) if (!((i === lo - 1 || i === hi + 1) && (j === lo - 1 || j === hi + 1))) m.set(w[0] + tu[0] * i + tv[0] * j, w[1] + tu[1] * i + tv[1] * j, w[2] + tu[2] * i + tv[2] * j, mat, VF.METAL);
  }
  const b = add(p, n, (o.washer ?? true) ? 2 : 1);
  for (let i = lo; i <= hi; i++) for (let j = lo; j <= hi; j++) m.set(b[0] + tu[0] * i + tv[0] * j, b[1] + tu[1] * i + tv[1] * j, b[2] + tu[2] * i + tv[2] * j, mat, VF.METAL);
  const tip = add(b, n);
  m.set(tip[0], tip[1], tip[2], 0x8a857c, VF.METAL);
  return m;
}

/**
 * Plank seams on a panel: every `every` voxels along `across`, the surface layer
 * facing ±`normal` is recessed by one voxel and the voxel behind it darkened.
 * gapThrough = true cuts the seam right through (light shows between boards).
 */
export function plankSeams(m: VoxelModel, box: Box, across: Axis, normal: Axis, every: number, o: { offset?: number; color?: number; gapThrough?: boolean } = {}) {
  const ai = across === 'x' ? 0 : across === 'y' ? 1 : 2;
  const ni = normal === 'x' ? 0 : normal === 'y' ? 1 : 2;
  const off = o.offset ?? 0;
  const dark = o.color ?? 0x241a12;
  const lo = box[ai], hi = box[ai + 3];
  for (let s = lo + every + off; s < hi; s += every) {
    const p: number[] = [0, 0, 0];
    p[ai] = s;
    const oi = 3 - ai - ni;
    for (let w = box[oi]; w <= box[oi + 3]; w++) {
      p[oi] = w;
      if (o.gapThrough) {
        for (let d = box[ni]; d <= box[ni + 3]; d++) {
          p[ni] = d;
          m.del(p[0], p[1], p[2]);
        }
        continue;
      }
      for (const end of [box[ni], box[ni + 3]]) {
        p[ni] = end;
        if (!m.has(p[0], p[1], p[2])) continue;
        m.del(p[0], p[1], p[2]);
        const inward = end === box[ni] ? 1 : -1;
        p[ni] = end + inward;
        if (m.has(p[0], p[1], p[2]) && p[ni] >= box[ni] && p[ni] <= box[ni + 3]) m.set(p[0], p[1], p[2], dark);
      }
    }
  }
  return m;
}

/**
 * A split (drying check / crack) starting at p on `face`, running `len` voxels
 * along `dir` (the grain), wandering sideways, tapering; carved `depth` deep with a dark floor.
 */
export function split(m: VoxelModel, p: V3, face: Face, dir: V3, len: number, o: { seed?: number; depth?: number; width?: number; dark?: number } = {}) {
  const n = normalOf(face);
  const [tu, tv] = tangentsOf(face);
  const side: V3 = Math.abs(dir[0] * tu[0] + dir[1] * tu[1] + dir[2] * tu[2]) > 0.5 ? tv : tu;
  const seed = o.seed ?? 0;
  const depth = o.depth ?? 2;
  const dark = o.dark ?? 0x1e140c;
  let off = 0;
  for (let k = 0; k < len; k++) {
    if (hash3(k, seed, 9) < 0.18) off += hash3(k, seed, 10) < 0.5 ? -1 : 1;
    const w = (o.width ?? 2) > 1 && k < len * 0.4 ? 2 : 1;
    for (let q = 0; q < w; q++) {
      const s = add(add(p, dir, k), side, off + q);
      const dd = k > len * 0.7 ? 1 : depth;
      for (let d = 0; d < dd; d++) {
        const c = add(s, n, -d);
        m.del(c[0], c[1], c[2]);
      }
      const fl = add(s, n, -dd);
      if (m.has(fl[0], fl[1], fl[2])) m.set(fl[0], fl[1], fl[2], dark);
    }
  }
  return m;
}

/** worm / beetle holes: tiny pits (and short engraved galleries) on surface voxels facing `face` inside box */
export function wormHoles(m: VoxelModel, box: Box, face: Face, o: { density?: number; seed?: number; galleries?: boolean } = {}) {
  const n = normalOf(face);
  const den = o.density ?? 0.02;
  const seed = o.seed ?? 0;
  const pits: V3[] = [];
  m.forEach((x, y, z) => {
    if (x < box[0] || y < box[1] || z < box[2] || x > box[3] || y > box[4] || z > box[5]) return;
    if (m.has(x + n[0], y + n[1], z + n[2])) return;
    if (hash3(x + seed * 3, y, z) < den) pits.push([x, y, z]);
  });
  const [tu] = tangentsOf(face);
  for (const p of pits) {
    m.del(p[0], p[1], p[2]);
    const b = add(p, n, -1);
    if (m.has(b[0], b[1], b[2])) m.set(b[0], b[1], b[2], 0x1a120c);
    if (o.galleries && hash3(p[0], p[1], seed) < 0.3)
      for (let k = 1; k <= 2; k++) {
        const g = add(p, tu, k);
        const c = colAt(m, g);
        if (c !== undefined) m.set(g[0], g[1], g[2], mix(c, 0x2a1c12, 0.5));
      }
  }
  return m;
}

/** scratches & gouges: short light (or dark) diagonal strokes painted on surface voxels facing `face` in box */
export function scratches(m: VoxelModel, box: Box, face: Face, o: { n?: number; seed?: number; len?: number; tone?: number; amount?: number } = {}) {
  const nn = normalOf(face);
  const [tu, tv] = tangentsOf(face);
  const seed = o.seed ?? 0;
  const cnt = o.n ?? 6;
  const len = o.len ?? 5;
  const tn = o.tone ?? 0xf0e2c4;
  for (let i = 0; i < cnt; i++) {
    const h = (k: number) => hash3(i, seed, k);
    const p: V3 = [Math.round(box[0] + h(1) * (box[3] - box[0])), Math.round(box[1] + h(2) * (box[4] - box[1])), Math.round(box[2] + h(3) * (box[5] - box[2]))];
    const du = h(4) < 0.5 ? 1 : -1, dv = h(5) < 0.5 ? 1 : 0.5;
    for (let k = 0; k < len; k++) {
      const q: V3 = [p[0] + Math.round(tu[0] * k * du + tv[0] * k * dv), p[1] + Math.round(tu[1] * k * du + tv[1] * k * dv), p[2] + Math.round(tu[2] * k * du + tv[2] * k * dv)];
      // find the surface along the normal
      let s: V3 | null = null;
      for (let d = 3; d >= -3; d--) {
        const c = add(q, nn, d);
        if (m.has(c[0], c[1], c[2]) && !m.has(c[0] + nn[0], c[1] + nn[1], c[2] + nn[2])) {
          s = c;
          break;
        }
      }
      if (!s) continue;
      const c = colAt(m, s)!;
      m.set(s[0], s[1], s[2], mix(c, tn, o.amount ?? 0.45));
    }
  }
  return m;
}

/**
 * Bullet hole into a face at p: punched `through` voxels deep (a real hole when the
 * board is thinner), scorched ring, pale fresh-wood splinters round the entry, a
 * couple of splinters standing proud. Works on paper too (torn ring instead).
 */
export function bulletHole(m: VoxelModel, p: V3, face: Face, o: { through?: number; seed?: number; big?: boolean; fresh?: number; scorch?: number; paper?: boolean } = {}) {
  const n = normalOf(face);
  const [tu, tv] = tangentsOf(face);
  const seed = o.seed ?? 0;
  const thr = o.through ?? 3;
  const fresh = o.fresh ?? 0xe8c890;
  const scorch = o.scorch ?? 0x2a1c14;
  const core: [number, number][] = o.big ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]];
  for (const [i, j] of core)
    for (let d = 0; d < thr; d++) {
      const c = add(add(add(p, tu, i), tv, j), n, -d);
      m.del(c[0], c[1], c[2]);
    }
  // dark wall just past the hole (what you see inside it if it doesn't go through)
  for (const [i, j] of core) {
    const b = add(add(add(p, tu, i), tv, j), n, -thr);
    if (m.has(b[0], b[1], b[2])) m.set(b[0], b[1], b[2], 0x120c08);
  }
  const ring: [number, number][] = o.big ? [[-1, 0], [2, 0], [-1, 1], [2, 1], [0, -1], [1, -1], [0, 2], [1, 2]] : [[-1, 0], [1, 0], [0, -1], [0, 1]];
  ring.forEach(([i, j], k) => {
    const q = add(add(p, tu, i), tv, j);
    const c = colAt(m, q);
    if (c === undefined) return;
    if (o.paper) {
      if (hash3(k, seed, 3) < 0.35) m.del(q[0], q[1], q[2]);
      else m.set(q[0], q[1], q[2], mix(c, 0x4a3420, 0.45));
      return;
    }
    m.set(q[0], q[1], q[2], hash3(k, seed, 1) < 0.5 ? fresh : mix(c, scorch, 0.55));
    if (hash3(k, seed, 2) < 0.25) {
      const s = add(q, n);
      if (!m.has(s[0], s[1], s[2])) m.set(s[0], s[1], s[2], fresh);
    }
  });
  return m;
}

/** a knot hole: a ragged round hole r voxels across, punched through, with a dark knot rim */
export function knotHole(m: VoxelModel, p: V3, face: Face, o: { r?: number; through?: number; rim?: number } = {}) {
  const n = normalOf(face);
  const [tu, tv] = tangentsOf(face);
  const r = o.r ?? 1.5;
  const R = Math.ceil(r) + 1;
  for (let i = -R; i <= R; i++)
    for (let j = -R; j <= R; j++) {
      const d = Math.hypot(i, j * 1.25);
      const q = add(add(p, tu, i), tv, j);
      if (d <= r) for (let k = 0; k < (o.through ?? 4); k++) {
        const c = add(q, n, -k);
        m.del(c[0], c[1], c[2]);
      }
      else if (d <= r + 1.1 && m.has(q[0], q[1], q[2])) m.set(q[0], q[1], q[2], o.rim ?? 0x3a2414);
    }
  return m;
}

/** rope along a polyline: a 1-voxel (r=0) or plump (r=1) twisted rope; the twist comes from arc length */
export function ropeLine(m: VoxelModel, pts: V3[], o: { r?: 0 | 1; tones?: number[]; flags?: number } = {}) {
  const t = o.tones ?? ROPE;
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const steps = Math.max(1, Math.ceil(L * 2));
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, z = a[2] + (b[2] - a[2]) * f;
      const ss = s + L * f;
      const strand = Math.floor(ss * 0.85) % 3;
      const c = strand === 0 ? t[0] : strand === 1 ? t[1] : t[2];
      if ((o.r ?? 0) === 0) m.set(x, y, z, c, o.flags ?? VF.SOFTAO);
      else
        for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as V3[]) {
          const tt = Math.floor(ss * 0.85 + dx + dy * 2 + dz) % 3;
          m.set(x + dx, y + dy, z + dz, dx || dy || dz ? (tt === 0 ? t[1] : tt === 1 ? t[2] : t[3]) : c, o.flags ?? VF.SOFTAO);
        }
    }
    s += L;
  }
  return m;
}

/**
 * Rope lashing wound round a post: coils from a0 to a1 along `axis`, one voxel
 * outside the rectangle rect = [u0, v0, u1, v1] (cross-section of the post), each
 * coil twisted, a knot on the `knotFace` side and a frayed tail hanging down.
 */
export function ropeLashing(m: VoxelModel, axis: Axis, rect: [number, number, number, number], a0: number, a1: number, o: { tones?: number[]; tail?: number; seed?: number; gap?: boolean } = {}) {
  const t = o.tones ?? ROPE;
  const seed = o.seed ?? 0;
  const [u0, v0, u1, v1] = [rect[0] - 1, rect[1] - 1, rect[2] + 1, rect[3] + 1];
  const put = (a: number, u: number, v: number, c: number) => {
    if (axis === 'y') m.set(u, a, v, c, VF.SOFTAO);
    else if (axis === 'x') m.set(a, u, v, c, VF.SOFTAO);
    else m.set(u, v, a, c, VF.SOFTAO);
  };
  for (let a = a0; a <= a1; a++) {
    if (o.gap && (a - a0) % 3 === 2) continue;
    let k = 0;
    for (let u = u0; u <= u1; u++)
      for (let v = v0; v <= v1; v++) {
        const edge = u === u0 || u === u1 || v === v0 || v === v1;
        const corner = (u === u0 || u === u1) && (v === v0 || v === v1);
        if (!edge || corner) continue;
        const s = (((u + v + a * 2 + seed) % 3) + 3) % 3;
        put(a, u, v, s === 0 ? t[0] : s === 1 ? t[1] : t[2]);
        k++;
      }
  }
  // knot on the +v side, tail hanging down (-a when axis is y; along -y otherwise)
  const ku = Math.round((u0 + u1) / 2), kv = v1 + 1, ka = Math.round((a0 + a1) / 2);
  for (let du = -1; du <= 1; du++) for (let da = -1; da <= 1; da++) if (Math.abs(du) + Math.abs(da) < 2) put(ka + da, ku + du, kv, t[(du + da + 3) % 3 + 1] ?? t[2]);
  put(ka, ku, kv + 1, t[3] ?? t[2]);
  const tail = o.tail ?? 6;
  for (let k = 1; k <= tail; k++) {
    const sway = Math.round(Math.sin(k * 0.7 + seed) * 0.6);
    if (axis === 'y') put(ka - 1 - k, ku + 1 + sway, kv, k === tail ? t[3] ?? t[2] : t[k % 3]);
    else put(ka + sway, ku - 1 - k, kv, k === tail ? t[3] ?? t[2] : t[k % 3]);
  }
  return m;
}

/**
 * Flat iron strap lying on a face from a to b (both on the surface voxels): `width`
 * wide, one voxel proud, rivets/nails every `rivetEvery` voxels, rusty streaks below.
 */
export function ironStrap(m: VoxelModel, a: V3, b: V3, face: Face, o: { width?: number; rivetEvery?: number; mat?: Mat; bolts?: boolean } = {}) {
  const n = normalOf(face);
  const [tu, tv] = tangentsOf(face);
  const w = o.width ?? 2;
  const mat = o.mat ?? blackIron();
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1);
  // the strap's width runs across the strap direction, in the face plane
  const dirU = Math.abs(dx * tu[0] + dy * tu[1] + dz * tu[2]) >= Math.abs(dx * tv[0] + dy * tv[1] + dz * tv[2]);
  const across = dirU ? tv : tu;
  const lo = -Math.floor((w - 1) / 2);
  const every = o.rivetEvery ?? 6;
  for (let k = 0; k <= L; k++) {
    const f = k / L;
    const c: V3 = [Math.round(a[0] + dx * f), Math.round(a[1] + dy * f), Math.round(a[2] + dz * f)];
    for (let q = lo; q < lo + w; q++) {
      const s = add(add(c, across, q), n);
      m.set(s[0], s[1], s[2], mat, VF.METAL);
    }
    if (every > 0 && (k === 1 || k === L - 1 || (k % every === 0 && k > 2 && k < L - 2))) {
      const s = add(add(c, across, lo + Math.floor(w / 2)), n);
      if (o.bolts) bolt(m, s, face, { size: 2, washer: false, mat });
      else rivet(m, add(s, n, -1), face, { r: 1, mat });
    }
  }
  return m;
}

/**
 * Iron band wrapped round a rectangular post: one voxel proud of the cross-section
 * rect = [u0, v0, u1, v1], from a0 to a1 along `axis`, with rivets on each face.
 */
export function wrapBand(m: VoxelModel, axis: Axis, rect: [number, number, number, number], a0: number, a1: number, o: { mat?: Mat; rivets?: boolean } = {}) {
  const mat = o.mat ?? blackIron();
  const [u0, v0, u1, v1] = [rect[0] - 1, rect[1] - 1, rect[2] + 1, rect[3] + 1];
  const put = (a: number, u: number, v: number) => (axis === 'y' ? m.set(u, a, v, mat, VF.METAL) : axis === 'x' ? m.set(a, u, v, mat, VF.METAL) : m.set(u, v, a, mat, VF.METAL));
  for (let a = a0; a <= a1; a++)
    for (let u = u0; u <= u1; u++)
      for (let v = v0; v <= v1; v++) if (u === u0 || u === u1 || v === v0 || v === v1) put(a, u, v);
  if (o.rivets ?? true) {
    const am = Math.round((a0 + a1) / 2), um = Math.round((u0 + u1) / 2), vm = Math.round((v0 + v1) / 2);
    put(am, um, v0 - 1);
    put(am, um, v1 + 1);
    put(am, u0 - 1, vm);
    put(am, u1 + 1, vm);
  }
  return m;
}

/** a hanging chain along a polyline: alternating links (one seen face-on as a ring, the next edge-on) */
export function chainLinks(m: VoxelModel, pts: V3[], o: { mat?: Mat; link?: number } = {}) {
  const mat = o.mat ?? blackIron(3, 0.35);
  const Lk = o.link ?? 3;
  let s = 0, idx = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    while (s <= L) {
      const f = s / L;
      const c: V3 = [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
      // a link: ring of voxels around the chain direction (approx vertical): face-on in x or in z
      const flat = idx % 2 === 0;
      for (let k = -1; k <= Lk - 1; k++)
        for (const w of [-1, 1]) {
          if (k === -1 || k === Lk - 1) {
            m.set(c[0], c[1] - k, c[2], mat, VF.METAL);
            continue;
          }
          if (flat) m.set(c[0] + w, c[1] - k, c[2], mat, VF.METAL);
          else m.set(c[0], c[1] - k, c[2] + w, mat, VF.METAL);
        }
      s += Lk;
      idx++;
    }
    s -= L;
  }
  return m;
}

/**
 * Worn edges: nibble voxels on exposed edges/corners inside box (those with two or
 * more open neighbours), more on corners. amount 0..1. Gives timber a used, hand-cut feel.
 */
export function chipEdges(m: VoxelModel, box: Box, o: { amount?: number; seed?: number; keepBelow?: number } = {}) {
  const amt = o.amount ?? 0.35;
  const seed = o.seed ?? 0;
  const del: V3[] = [];
  m.forEach((x, y, z) => {
    if (x < box[0] || y < box[1] || z < box[2] || x > box[3] || y > box[4] || z > box[5]) return;
    if (o.keepBelow !== undefined && y < o.keepBelow) return;
    let open = 0;
    if (!m.has(x + 1, y, z)) open++;
    if (!m.has(x - 1, y, z)) open++;
    if (!m.has(x, y + 1, z)) open++;
    if (!m.has(x, y - 1, z)) open++;
    if (!m.has(x, y, z + 1)) open++;
    if (!m.has(x, y, z - 1)) open++;
    if (open < 2) return;
    const p = open >= 3 ? amt * 1.6 : amt * 0.55;
    const n = n3(x * 0.3, y * 0.3, z * 0.3, seed) * 0.5 + 0.5;
    if (n * 0.6 + hash3(x + seed, y, z) * 0.4 < p) del.push([x, y, z]);
  });
  for (const [x, y, z] of del) m.del(x, y, z);
  return m;
}

/**
 * Hand-hewn faces: shallow adze scallops carved one voxel into the long faces of
 * a timber in box (grain along `axis`), leaving irregular facets and ridges.
 */
export function hewn(m: VoxelModel, box: Box, axis: Axis, o: { seed?: number; amount?: number } = {}) {
  const seed = o.seed ?? 0;
  const amt = o.amount ?? 0.3;
  const del: V3[] = [];
  m.forEach((x, y, z) => {
    if (x < box[0] || y < box[1] || z < box[2] || x > box[3] || y > box[4] || z > box[5]) return;
    const [a, u, v] = frameOf(axis, x, y, z);
    const [bu0, bu1] = axis === 'x' ? [box[1], box[4]] : axis === 'y' ? [box[0], box[3]] : [box[0], box[3]];
    const [bv0, bv1] = axis === 'x' ? [box[2], box[5]] : axis === 'y' ? [box[2], box[5]] : [box[1], box[4]];
    const onU = u === bu0 || u === bu1, onV = v === bv0 || v === bv1;
    if (!onU && !onV) return;
    if (onU && onV) return; // edges handled by chamfers
    const lat = onU ? v : u;
    // broad, long scallops (a few big facets read as adze work and stay cheap to mesh)
    const sc = n3(a * 0.05, lat * 0.16, (onU ? (u === bu0 ? 1 : 2) : v === bv0 ? 3 : 4) * 5.3, seed);
    if (sc > 0.62 - amt * 0.6) del.push([x, y, z]);
  });
  for (const [x, y, z] of del) m.del(x, y, z);
  return m;
}

/**
 * Chip painted lettering / trim: voxels of colour `ink` inside box lose their paint
 * where the (grain-stretched) peel field says so, showing `under` instead.
 */
export function chipPaint(m: VoxelModel, box: Box, ink: number, under: Mat, o: { chip?: number; seed?: number; along?: Axis } = {}) {
  const chip = o.chip ?? 0.3;
  const seed = o.seed ?? 0;
  const along = o.along ?? 'x';
  const thr = -0.62 + chip * 1.1;
  return applyMat(m, (x, y, z) => {
    const [a, u, v] = frameOf(along, x, y, z);
    const c = fbm(a * 0.05, u * 0.3, v * 0.3, seed + 17) + n3(a * 0.3, u * 0.9, v * 0.9, seed + 18) * 0.12;
    return c < thr ? under(x, y, z) : ink;
  }, box, (_x, _y, _z, c) => c === (ink & 0xffffff));
}

/** a horseshoe nailed to a face, open end up (it holds the luck): 7 wide, 8 tall, with nail heads */
export function horseshoe(m: VoxelModel, p: V3, face: Face, o: { mat?: Mat; up?: boolean } = {}) {
  const n = normalOf(face);
  const [tu, tv] = tangentsOf(face);
  const mat = o.mat ?? rustedIron({ rust: 0.6, streaks: false });
  const up = o.up ?? true;
  const pts: [number, number][] = [];
  for (let i = -3; i <= 3; i++)
    for (let j = 0; j <= 7; j++) {
      const jj = up ? j : 7 - j;
      // U: arc at the closed end, two arms
      const arc = jj <= 3 ? Math.hypot(i, (3 - jj) * 1.1) : Math.abs(i);
      const inArm = jj > 3 && Math.abs(i) >= 2 && Math.abs(i) <= 3;
      const inArc = jj <= 3 && arc >= 1.9 && arc <= 3.3;
      if (inArm || inArc) pts.push([i, j]);
    }
  for (const [i, j] of pts) {
    const q = add(add(add(p, n), tu, i), tv, j - 4);
    m.set(q[0], q[1], q[2], mat, VF.METAL);
  }
  for (const [i, j] of [[-3, up ? 5 : 2], [3, up ? 5 : 2]] as [number, number][]) {
    const q = add(add(add(p, n, 2), tu, i), tv, j - 4);
    m.set(q[0], q[1], q[2], 0x3a3634, VF.METAL);
  }
  return m;
}

/** a lumpy, faceted field stone (wedges at post feet, rubble): ellipsoid with noisy surface and two flat fracture faces */
export function fieldStone(m: VoxelModel, c: V3, r: V3, o: { mat?: Mat; seed?: number; flags?: number } = {}) {
  const seed = o.seed ?? 0;
  const mat = o.mat ?? sandstone({ seed, bed: 3 });
  const R = [Math.ceil(r[0]) + 1, Math.ceil(r[1]) + 1, Math.ceil(r[2]) + 1];
  const cuts: V3[] = [0, 1].map((i) => {
    const a = hash3(seed, i, 1) * Math.PI * 2, e = 0.3 + hash3(seed, i, 2) * 0.6;
    return [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
  });
  for (let x = -R[0]; x <= R[0]; x++)
    for (let y = -R[1]; y <= R[1]; y++)
      for (let z = -R[2]; z <= R[2]; z++) {
        const nx = x / r[0], ny = y / r[1], nz = z / r[2];
        const d = Math.hypot(nx, ny, nz) + n3(x * 0.35, y * 0.35, z * 0.35, seed) * 0.22;
        if (d > 1) continue;
        let cut = false;
        for (const p of cuts) if (p[0] * nx + p[1] * ny + p[2] * nz > 0.62) cut = true;
        if (cut) continue;
        m.set(c[0] + x, c[1] + y, c[2] + z, mat, o.flags);
      }
  return m;
}

/**
 * A finished timber (post, beam, plank, rail) filling box with grain along `axis`:
 * material, irregular chamfered long edges, optional hewn facets, worn edges and
 * proper end grain on the sawn ends. The workhorse for every wooden prop.
 */
export function timber(m: VoxelModel, box: Box, axis: Axis, o: { mat?: Mat; species?: WoodName; seed?: number; chamfer?: 0 | 1 | 2; hewn?: number; wear?: number; endMat?: Mat; flags?: number; noEnds?: boolean } = {}) {
  const [x0, y0, z0, x1, y1, z1] = box;
  const seed = o.seed ?? 0;
  const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const ends: [number, number] = [box[ai], box[ai + 3]];
  const mat = o.mat ?? weathered({ along: axis, seed, ends: o.noEnds ? undefined : ends, species: o.species });
  const ch = o.chamfer ?? 1;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const [a, u, v] = frameOf(axis, x, y, z);
        const [u0, u1, v0, v1] = axis === 'x' ? [y0, y1, z0, z1] : axis === 'y' ? [x0, x1, z0, z1] : [x0, x1, y0, y1];
        const du = Math.min(u - u0, u1 - u), dv = Math.min(v - v0, v1 - v);
        if (ch > 0 && u1 - u0 >= 3 && v1 - v0 >= 3) {
          // chamfer varies a little along the length (hand-cut, not machined)
          const c = ch + (n3(a * 0.035, u0, v0, seed + 3) > 0.45 ? 1 : 0);
          if (du + dv < c) continue;
        }
        m.set(x, y, z, o.endMat && (a === ends[0] || a === ends[1]) ? o.endMat : mat, o.flags);
      }
  if (o.hewn) hewn(m, box, axis, { seed, amount: o.hewn });
  if (o.wear) chipEdges(m, box, { amount: o.wear, seed });
  return m;
}
