// Procedural region generator with rules: zone layout (non-overlapping snake
// path), wind-shaped transverse dunes, themed zone sculpting (canyons, temples,
// outposts, craters, mesas, oasis lakes, pyramids), corridors and blockers.
import { Heightfield, MAT, Stamp } from './Heightfield';
import { Noise, RNG, smoothstep, clamp, lerp } from '../../engine/math/rand';
import type { NileInfo } from './NileGen';

export type ThemeId =
  | 'flats' | 'canyon' | 'bones' | 'temple' | 'outpost' | 'glassdunes' | 'hollows' | 'obelisks' | 'mesas' | 'arena'
  | 'palmshore' | 'marsh' | 'floodruins' | 'lotustemple' | 'oasisheart'
  | 'stormapproach' | 'sphinxavenue' | 'pyramidbase' | 'pyramidterraces' | 'apex';

export type BlockerKind = 'rockwall' | 'dune' | 'bones' | 'storm' | 'gate';

export interface Anchor {
  kind: string;
  x: number;
  z: number;
  rot?: number;
  scale?: number;
  /** id of stamp this anchor rises with (emerges on zone unlock) */
  rise?: string;
  data?: any;
}

export interface ZoneDef {
  index: number;
  name: string;
  theme: ThemeId;
  cx: number;
  cz: number;
  r: number;
  waves: [number, number];
  /** corridor from previous zone: endpoints and midpoint (blocker) */
  corridor?: { ax: number; az: number; bx: number; bz: number; mx: number; mz: number; w: number };
  blocker?: BlockerKind;
  blockerStamp?: string;
  riseStamp?: string;
  anchors: Anchor[];
  /**
   * Points of interest in this zone, spread out so riding between them is a little journey:
   * the theme set piece, landmark buildings, lookout towers, ghost towns, oases, camps and the
   * wild sights (rock arches, colossi, shipwrecks, bone fields, dry riverbeds, mesas, viewpoints,
   * shrines, dune ramps). `r` is the footprint radius (m) kept clear around it.
   */
  pois: Poi[];
  /** where corridors meet this zone's rim (`to` = the neighbouring zone's index) */
  mouths: { x: number; z: number; to: number }[];
  dir: number; // heading from previous zone (radians)
  /** the Nile stage's own zone theme (world/NileGen.ts); `theme` then carries the closest desert theme */
  nile?: string;
}

export interface Poi {
  kind: string;
  name: string;
  x: number;
  z: number;
  /** footprint radius (m) */
  r: number;
  data?: any;
}

export interface SubArea {
  key: 'A' | 'B' | 'C';
  name: string;
  subtitle: string;
  size: number;
  seed: number;
  zones: ZoneDef[];
  field: Heightfield;
  wind: { x: number; z: number };
  waterLevel: number;
  env: 'dunes' | 'oasis' | 'pyramid' | 'nileDay' | 'nileDusk' | 'nileBurn';
  start: { x: number; z: number; heading: number };
  /** the Nile stage: river network, burn state, foliage hints (world/NileGen.ts) */
  nile?: NileInfo;
}

export interface SubAreaSpec {
  key: 'A' | 'B' | 'C';
  name: string;
  subtitle: string;
  size: number;
  waveStart: number;
  zones: { name: string; theme: ThemeId; r: number; blocker: BlockerKind }[];
  env: SubArea['env'];
  water: number;
}

export const SUBAREAS: Record<'A' | 'B' | 'C', SubAreaSpec> = {
  // zones are big open stretches of desert (radius ~95-145 m, 3-4x the old area) joined by
  // 50-80 m corridors, so riding from one sight to the next on the push board (8-11 m/s) is a trip
  A: {
    key: 'A',
    name: 'The Bonewind Dunes',
    subtitle: "Serket's Reach — Outer Sands",
    size: 1400,
    waveStart: 1,
    env: 'dunes',
    water: -1000,
    zones: [
      { name: 'Sundown Flats', theme: 'flats', r: 118, blocker: 'storm' },
      { name: 'Rattlesnake Canyon', theme: 'canyon', r: 126, blocker: 'rockwall' },
      { name: 'The Bone Garden', theme: 'bones', r: 120, blocker: 'bones' },
      { name: 'Sunken Temple of Thoth', theme: 'temple', r: 122, blocker: 'dune' },
      { name: 'Outlaw Gulch', theme: 'outpost', r: 116, blocker: 'rockwall' },
      { name: 'The Glass Dunes', theme: 'glassdunes', r: 138, blocker: 'storm' },
      { name: 'Scarab Hollows', theme: 'hollows', r: 122, blocker: 'dune' },
      { name: 'Field of Needles', theme: 'obelisks', r: 120, blocker: 'gate' },
      { name: 'Mesa Steps', theme: 'mesas', r: 132, blocker: 'rockwall' },
      { name: 'Red Mesa Arena', theme: 'arena', r: 96, blocker: 'storm' },
    ],
  },
  B: {
    key: 'B',
    name: 'The Mirage Oasis',
    subtitle: "Serket's Reach — Waters of Sekhmet",
    size: 1100,
    waveStart: 51,
    env: 'oasis',
    water: 3.2,
    zones: [
      { name: 'Palm Shore', theme: 'palmshore', r: 140, blocker: 'storm' },
      { name: 'Reedwater Marsh', theme: 'marsh', r: 134, blocker: 'dune' },
      { name: 'Drowned Ruins', theme: 'floodruins', r: 132, blocker: 'gate' },
      { name: 'Lotus Temple', theme: 'lotustemple', r: 136, blocker: 'rockwall' },
      { name: 'Heart of the Oasis', theme: 'oasisheart', r: 110, blocker: 'storm' },
    ],
  },
  C: {
    key: 'C',
    name: 'The Red Pyramid',
    subtitle: "Serket's Reach — Throne of Set",
    size: 1100,
    waveStart: 76,
    env: 'pyramid',
    water: -1000,
    zones: [
      { name: 'Eye of the Storm', theme: 'stormapproach', r: 144, blocker: 'storm' },
      { name: 'Avenue of Sphinxes', theme: 'sphinxavenue', r: 132, blocker: 'gate' },
      { name: 'Foot of the Pyramid', theme: 'pyramidbase', r: 146, blocker: 'rockwall' },
      { name: 'The Terraces', theme: 'pyramidterraces', r: 130, blocker: 'dune' },
      { name: 'Apex of Set', theme: 'apex', r: 100, blocker: 'storm' },
    ],
  },
};

const distSeg = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax,
    dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = clamp(t, 0, 1);
  const x = ax + dx * t,
    z = az + dz * t;
  return { d: Math.hypot(px - x, pz - z), t };
};

/** distance from a point to a segment (no allocation; for per-cell loops) */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax,
    dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t - px,
    z = az + dz * t - pz;
  return Math.sqrt(x * x + z * z);
}

/**
 * Distance field to a polyline, rasterised per segment into a local window (cells further
 * than `reach` read `reach`). `along` is the segment index + param of the nearest point.
 */
function polyField(field: Heightfield, pts: { x: number; z: number }[], reach: number) {
  const r = field.res,
    n = field.n;
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z);
  }
  const i0 = Math.max(0, Math.floor((x0 - reach) / r)), i1 = Math.min(n - 1, Math.ceil((x1 + reach) / r));
  const j0 = Math.max(0, Math.floor((z0 - reach) / r)), j1 = Math.min(n - 1, Math.ceil((z1 + reach) / r));
  const W = Math.max(1, i1 - i0 + 1), H = Math.max(1, j1 - j0 + 1);
  const D = new Float32Array(W * H).fill(reach);
  const A = new Float32Array(W * H);
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s], b = pts[s + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const si0 = Math.max(i0, Math.floor((Math.min(a.x, b.x) - reach) / r)), si1 = Math.min(i1, Math.ceil((Math.max(a.x, b.x) + reach) / r));
    const sj0 = Math.max(j0, Math.floor((Math.min(a.z, b.z) - reach) / r)), sj1 = Math.min(j1, Math.ceil((Math.max(a.z, b.z) + reach) / r));
    for (let j = sj0; j <= sj1; j++)
      for (let i = si0; i <= si1; i++) {
        const px = i * r, pz = j * r;
        let t = ((px - a.x) * dx + (pz - a.z) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = a.x + dx * t - px, ez = a.z + dz * t - pz;
        const d = Math.sqrt(ex * ex + ez * ez);
        const o = i - i0 + (j - j0) * W;
        if (d < D[o]) {
          D[o] = d;
          A[o] = s + t;
        }
      }
  }
  return {
    /** distance / along at heightfield index k */
    at(k: number, out: { d: number; along: number }) {
      const i = k % n, j = (k / n) | 0;
      const li = i - i0, lj = j - j0;
      if (li < 0 || lj < 0 || li >= W || lj >= H) {
        out.d = reach;
        out.along = 0;
      } else {
        const o = li + lj * W;
        out.d = D[o];
        out.along = A[o];
      }
      return out;
    },
    bounds: { x0: i0 * r, z0: j0 * r, x1: i1 * r, z1: j1 * r },
  };
}

/** corridor width (m) */
const CORRIDOR_W = 34;

/** zone layout: non-overlapping random snake inside the square, 50-80 m corridors between neighbours */
export function layoutZones(spec: SubAreaSpec, rng: RNG): ZoneDef[] {
  const S = spec.size;
  const margin = 80;
  for (let attempt = 0; attempt < 800; attempt++) {
    const zones: ZoneDef[] = [];
    let heading = rng.range(-0.4, 0.4) + Math.PI / 2; // roughly +z (north)
    let cx = S * rng.range(0.3, 0.7);
    let cz = margin + spec.zones[0].r * 0.8;
    let ok = true;
    for (let i = 0; i < spec.zones.length; i++) {
      const zs = spec.zones[i];
      if (i > 0) {
        const prev = zones[i - 1];
        let placed = false;
        for (let k = 0; k < 60 && !placed; k++) {
          const h = heading + rng.range(-1.1, 1.1);
          const corridor = rng.range(50, 80);
          const d = prev.r + zs.r + corridor;
          const nx = prev.cx + Math.cos(h) * d;
          const nz = prev.cz + Math.sin(h) * d;
          if (nx < margin + zs.r * 0.6 || nx > S - margin - zs.r * 0.6 || nz < margin + zs.r * 0.6 || nz > S - margin - zs.r * 0.6) continue;
          let clash = false;
          for (let j = 0; j < i - 1; j++) {
            const o = zones[j];
            if (Math.hypot(o.cx - nx, o.cz - nz) < o.r + zs.r + 60) {
              clash = true;
              break;
            }
          }
          if (clash) continue;
          cx = nx;
          cz = nz;
          heading = h;
          placed = true;
        }
        if (!placed) {
          ok = false;
          break;
        }
      }
      const waves: [number, number] = [spec.waveStart + i * 5, spec.waveStart + i * 5 + 4];
      zones.push({ index: i, name: zs.name, theme: zs.theme, cx, cz, r: zs.r, waves, anchors: [], pois: [], mouths: [], blocker: i > 0 ? zs.blocker : undefined, dir: heading });
    }
    if (!ok) continue;
    // corridors
    for (let i = 1; i < zones.length; i++) {
      const a = zones[i - 1],
        b = zones[i];
      const dx = b.cx - a.cx,
        dz = b.cz - a.cz;
      const L = Math.hypot(dx, dz);
      const ux = dx / L,
        uz = dz / L;
      const ax = a.cx + ux * (a.r - 8),
        az = a.cz + uz * (a.r - 8);
      const bx = b.cx - ux * (b.r - 8),
        bz = b.cz - uz * (b.r - 8);
      b.corridor = { ax, az, bx, bz, mx: (ax + bx) / 2, mz: (az + bz) / 2, w: CORRIDOR_W };
      b.dir = Math.atan2(dz, dx);
      // the mouths on each rim (keep set pieces off the way in and out)
      a.mouths.push({ x: a.cx + ux * a.r, z: a.cz + uz * a.r, to: i });
      b.mouths.push({ x: b.cx - ux * b.r, z: b.cz - uz * b.r, to: i - 1 });
    }
    return zones;
  }
  throw new Error('zone layout failed');
}

export function generateSubArea(key: 'A' | 'B' | 'C', seed: number): SubArea {
  const spec = SUBAREAS[key];
  const rng = new RNG(seed);
  const noise = new Noise(seed * 7 + 13);
  const zones = layoutZones(spec, rng);
  const field = new Heightfield(spec.size, 1);
  const windAng = rng.range(0, Math.PI * 2);
  const wind = { x: Math.cos(windAng), z: Math.sin(windAng) };
  const S = spec.size;
  const glassDunes = spec.key === 'C' ? 1.6 : 1;

  // ---------------------------------------------------------------- base dunes
  const duneH = (x: number, z: number, ampMul = 1) => {
    const u = x * wind.x + z * wind.z;
    const v = -x * wind.z + z * wind.x;
    const wu = u + noise.n2(x * 0.004, z * 0.004) * 40 + noise.n2(x * 0.013, z * 0.013) * 7;
    const wv = v + noise.n2(x * 0.005 + 7, z * 0.005 - 3) * 30;
    const lambda = 68 + 26 * noise.n2(x * 0.002 + 3, z * 0.002);
    const phase = wu / lambda + noise.n2(wv * 0.008, 3.1) * 0.65;
    const t = phase - Math.floor(phase);
    const prof = t < 0.76 ? smoothstep(0, 1, t / 0.76) : 1 - smoothstep(0, 1, (t - 0.76) / 0.24);
    const crest = 0.45 + 0.55 * (noise.n2(wv * 0.011, Math.floor(phase) * 1.7) * 0.5 + 0.5);
    const amp = (6.5 + 4 * noise.n2(x * 0.003 - 9, z * 0.003 + 4)) * ampMul;
    return prof * crest * amp;
  };
  const broad = (x: number, z: number) => noise.fbm2(x / 330, z / 330, 3) * 9 + noise.fbm2(x / 85, z / 85, 3) * 2.2;

  // Generation budget for the 3-4x bigger map:
  //  - the low-frequency terms (broad swells, sand tint, butte mask) live on a 4 m lattice and
  //    are interpolated per metre (they vary over 20-300 m, the error is a few cm);
  //  - the wind dunes (sharp crests the hunter rides) are evaluated per metre near the playable
  //    space (zones, corridors and a 12 m apron past their soft rims);
  //  - the land deep inside the storm (only ever seen through the murk) is the lattice alone.
  const n = field.n;
  const corrs = zones.filter((z) => z.corridor).map((z) => z.corridor!);
  const C = 4;
  const nc = Math.ceil((n - 1) / C) + 1;
  const latB = new Float32Array(nc * nc), latT = new Float32Array(nc * nc), latU = new Float32Array(nc * nc), latV = new Float32Array(nc * nc);
  const farH = new Float32Array(nc * nc);
  const farM = new Uint8Array(nc * nc);
  const butteH = (u: number, v: number) => smoothstep(0.8, 0.83, u) * (12 + 8 * (v * 0.5 + 0.5)) + Math.floor(smoothstep(0.83, 0.95, u) * 3) * 2.5;
  const edgeRise = (x: number, z: number) => {
    const edge = Math.min(x, z, S - x, S - z);
    return edge < 40 ? (1 - edge / 40) * (1 - edge / 40) * 30 : 0;
  };
  for (let j = 0; j < nc; j++)
    for (let i = 0; i < nc; i++) {
      const x = Math.min(i * C, n - 1) * field.res,
        z = Math.min(j * C, n - 1) * field.res;
      const q = i + j * nc;
      const b = (latB[q] = broad(x, z));
      const t = (latT[q] = noise.n2(x * 0.006 + 11, z * 0.006 - 5));
      const u = (latU[q] = noise.ridged2(x * 0.0042 + 5, z * 0.0042 - 2, 2));
      const v = (latV[q] = noise.n2(x * 0.01, z * 0.01 + 9));
      let h = 8 + b + duneH(x, z, glassDunes) + edgeRise(x, z);
      let m: number = t > 0.45 ? MAT.RED_SAND : MAT.SAND;
      if (u > 0.8) {
        const bh = butteH(u, v);
        h += bh;
        if (bh > 1.2) m = MAT.ROCK;
      }
      farH[q] = h;
      farM[q] = m;
    }
  // 16 m blocks near the playable space, each with the zones / corridors that reach it
  const B = 16;
  const nb = Math.ceil(n / B);
  const bZones: (number[] | null)[] = new Array(nb * nb).fill(null);
  const bCorrs: number[][] = new Array(nb * nb);
  const reachB = B * 0.75;
  for (let bj = 0; bj < nb; bj++)
    for (let bi = 0; bi < nb; bi++) {
      const x = (bi + 0.5) * B * field.res,
        z = (bj + 0.5) * B * field.res;
      let d = 1e9;
      const zl: number[] = [], cl: number[] = [];
      zones.forEach((zn, zi) => {
        const dz = Math.hypot(x - zn.cx, z - zn.cz) - zn.r - 26;
        d = Math.min(d, dz);
        if (dz < reachB) zl.push(zi);
      });
      corrs.forEach((c, ci) => {
        const dc = segDist(x, z, c.ax, c.az, c.bx, c.bz) - c.w * 0.5 - 14;
        d = Math.min(d, dc);
        if (dc < reachB) cl.push(ci);
      });
      if (d < 12 + reachB) {
        bZones[bi + bj * nb] = zl;
        bCorrs[bi + bj * nb] = cl;
      }
    }
  for (let j = 0; j < n; j++) {
    const z = j * field.res;
    const cj = Math.min(nc - 2, Math.floor(j / C)),
      fz = j / C - cj;
    for (let i = 0; i < n; i++) {
      const x = i * field.res;
      const k = i + j * n;
      const ci = Math.min(nc - 2, Math.floor(i / C)),
        fx = i / C - ci;
      const q = ci + cj * nc;
      const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
      const blk = ((i / B) | 0) + ((j / B) | 0) * nb;
      const zl = bZones[blk];
      if (!zl) {
        field.base[k] = farH[q] * w00 + farH[q + 1] * w10 + farH[q + nc] * w01 + farH[q + nc + 1] * w11;
        field.baseMat[k] = farM[Math.round(i / C) + Math.round(j / C) * nc];
        continue;
      }
      const lerp4 = (A: Float32Array) => A[q] * w00 + A[q + 1] * w10 + A[q + nc] * w01 + A[q + nc + 1] * w11;
      const b = lerp4(latB),
        dn = duneH(x, z, glassDunes);
      // zone influence
      let zoneMax = 0;
      for (const zi of zl) {
        const zn = zones[zi];
        const w = smoothstep(zn.r + 26, zn.r - 6, Math.hypot(x - zn.cx, z - zn.cz));
        if (w > zoneMax) zoneMax = w;
      }
      // corridors
      let corrW = 0;
      for (const cc of bCorrs[blk]) {
        const c = corrs[cc];
        corrW = Math.max(corrW, smoothstep(c.w * 0.5 + 14, c.w * 0.5 - 2, segDist(x, z, c.ax, c.az, c.bx, c.bz)));
      }
      const playable = Math.max(zoneMax, corrW);
      let h = 8 + b + dn + edgeRise(x, z);
      let m: number = lerp4(latT) > 0.45 ? MAT.RED_SAND : MAT.SAND;
      // rock outcrops outside zones (buttes) for silhouette
      if (playable < 0.2) {
        const u = lerp4(latU);
        if (u > 0.8) {
          const bh = butteH(u, lerp4(latV));
          h += bh * (1 - playable * 5);
          if (bh > 1.2) m = MAT.ROCK;
        }
      }
      // soften dunes inside playable space a bit so arenas are rideable
      if (playable > 0) h = lerp(h, 8 + b * 0.6 + dn * 0.75, playable * 0.5);
      field.base[k] = h;
      field.baseMat[k] = m;
    }
  }

  // ------------------------------------------------------------- zone themes
  const ctx: ThemeCtx = { field, noise, rng, wind, zones, spec };
  for (const zn of zones) applyTheme(ctx, zn);

  // corridors: flatten + clear rock
  for (const zn of zones) {
    if (!zn.corridor) continue;
    const c = zn.corridor;
    const x0 = Math.min(c.ax, c.bx) - 30,
      x1 = Math.max(c.ax, c.bx) + 30;
    const z0 = Math.min(c.az, c.bz) - 30,
      z1 = Math.max(c.az, c.bz) + 30;
    // target height interpolated between end heights
    const ha = sampleBase(field, c.ax, c.az),
      hb = sampleBase(field, c.bx, c.bz);
    forRect(field, x0, z0, x1, z1, (k, x, z) => {
      const { d, t } = distSeg(x, z, c.ax, c.az, c.bx, c.bz);
      const w = smoothstep(c.w * 0.5 + 10, c.w * 0.5 - 3, d);
      if (w <= 0) return;
      // long corridors roll gently: a few soft swells to pump through on the board
      const swell = Math.sin(t * Math.PI) * (1.5 + Math.sin(t * Math.PI * 5 + c.mx * 0.01) * 1.1);
      const target = lerp(ha, hb, smoothstep(0, 1, t)) + swell + noise.n2(x * 0.05, z * 0.05) * 0.8;
      field.base[k] = lerp(field.base[k], target, w * 0.85);
      if (w > 0.5 && (field.baseMat[k] === MAT.ROCK || field.baseMat[k] === MAT.DARK_ROCK)) field.baseMat[k] = MAT.SAND_DARK;
    });
    // blocker stamp (collapses/clears when this zone unlocks)
    addBlocker(ctx, zn);
  }

  // slope based rock exposure + dark sand in troughs (final material rules)
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const k = i + j * n;
      const dx = field.base[k + 1] - field.base[k - 1];
      const dz = field.base[k + n] - field.base[k - n];
      const slope = Math.hypot(dx, dz) * 0.5;
      const m = field.baseMat[k];
      if (slope > 1.25 && (m === MAT.SAND || m === MAT.RED_SAND || m === MAT.SAND_DARK)) field.baseMat[k] = MAT.ROCK;
      else if (m === MAT.SAND && slope < 0.08 && noise.n2(i * 0.05, j * 0.05) > 0.35) field.baseMat[k] = MAT.SAND_DARK;
    }
  }

  field.waterLevel = spec.water;
  field.finalize();
  const z0 = zones[0];
  return {
    key,
    name: spec.name,
    subtitle: spec.subtitle,
    size: S,
    seed,
    zones,
    field,
    wind,
    waterLevel: spec.water,
    env: spec.env,
    start: { x: z0.cx, z: z0.cz - z0.r * 0.45, heading: Math.PI / 2 },
  };
}

// ---------------------------------------------------------------------------
interface ThemeCtx {
  field: Heightfield;
  noise: Noise;
  rng: RNG;
  wind: { x: number; z: number };
  zones: ZoneDef[];
  spec: SubAreaSpec;
}

function forRect(f: Heightfield, x0: number, z0: number, x1: number, z1: number, fn: (k: number, x: number, z: number) => void) {
  const r = f.res,
    n = f.n;
  const i0 = Math.max(0, Math.floor(x0 / r)),
    i1 = Math.min(n - 1, Math.ceil(x1 / r));
  const j0 = Math.max(0, Math.floor(z0 / r)),
    j1 = Math.min(n - 1, Math.ceil(z1 / r));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(i + j * n, i * r, j * r);
}
function sampleBase(f: Heightfield, x: number, z: number) {
  const i = clamp(Math.round(x / f.res), 0, f.n - 1),
    j = clamp(Math.round(z / f.res), 0, f.n - 1);
  return f.base[i + j * f.n];
}
/** average base height in a disc (used to set plateau heights) */
function avgBase(f: Heightfield, cx: number, cz: number, r: number) {
  let s = 0,
    c = 0;
  for (let a = 0; a < 16; a++) {
    for (const rr of [0, r * 0.5, r]) {
      s += sampleBase(f, cx + Math.cos(a) * rr, cz + Math.sin(a) * rr);
      c++;
    }
  }
  return s / c;
}

function zoneFrame(zn: ZoneDef) {
  const fx = Math.cos(zn.dir),
    fz = Math.sin(zn.dir);
  return {
    fx,
    fz,
    rx: -fz,
    rz: fx,
    toLocal: (x: number, z: number) => {
      const dx = x - zn.cx,
        dz = z - zn.cz;
      return { f: dx * fx + dz * fz, s: dx * -fz + dz * fx };
    },
    toWorld: (f: number, s: number) => ({ x: zn.cx + fx * f - fz * s, z: zn.cz + fz * f + fx * s }),
  };
}

// ---------------------------------------------------------------------------
// spatial index over a zone's anchors (scatter spacing tests stay cheap in the big zones);
// rebuilt when the anchor array is replaced, extended when it grows
const AGRID = 8;
interface AGrid {
  arr: Anchor[];
  n: number;
  cells: Map<number, Anchor[]>;
}
const agrids = new WeakMap<ZoneDef, AGrid>();
const acell = (i: number, j: number) => (i + 2048) * 4096 + (j + 2048);
function agrid(zn: ZoneDef): AGrid {
  let g = agrids.get(zn);
  if (!g || g.arr !== zn.anchors || g.n > zn.anchors.length) {
    g = { arr: zn.anchors, n: 0, cells: new Map() };
    agrids.set(zn, g);
  }
  for (; g.n < zn.anchors.length; g.n++) {
    const a = zn.anchors[g.n];
    const k = acell(Math.floor(a.x / AGRID), Math.floor(a.z / AGRID));
    let l = g.cells.get(k);
    if (!l) g.cells.set(k, (l = []));
    l.push(a);
  }
  return g;
}
/** visit anchors within r of (x, z); return true from fn to stop */
function anchorsNear(zn: ZoneDef, x: number, z: number, r: number, fn: (a: Anchor) => boolean | void) {
  const g = agrid(zn);
  const i0 = Math.floor((x - r) / AGRID), i1 = Math.floor((x + r) / AGRID);
  const j0 = Math.floor((z - r) / AGRID), j1 = Math.floor((z + r) / AGRID);
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const l = g.cells.get(acell(i, j));
      if (!l) continue;
      for (const a of l) if (Math.hypot(a.x - x, a.z - z) < r && fn(a)) return true;
    }
  return false;
}

function scatter(ctx: ThemeCtx, zn: ZoneDef, kind: string, count: number, minR: number, maxR: number, minSpacing = 6, extra?: (a: Anchor) => void) {
  const out: Anchor[] = [];
  for (let k = 0; k < count * 6 && out.length < count; k++) {
    const a = ctx.rng.range(0, Math.PI * 2);
    const r = Math.sqrt(ctx.rng.range((minR / zn.r) ** 2, (maxR / zn.r) ** 2)) * zn.r;
    const x = zn.cx + Math.cos(a) * r,
      z = zn.cz + Math.sin(a) * r;
    if (anchorsNear(zn, x, z, minSpacing, () => true)) continue;
    const an: Anchor = { kind, x, z, rot: ctx.rng.range(0, Math.PI * 2), scale: ctx.rng.range(0.85, 1.25) };
    extra?.(an);
    zn.anchors.push(an);
    out.push(an);
  }
  return out;
}

/** area factor of a zone against the old 64 m discs (scatter counts scale with it) */
const areaK = (zn: ZoneDef) => (zn.r / 64) ** 2;

const WOOD_SINGLES = ['fenceBroken', 'signpost', 'hitchingPost', 'wagonWheel', 'cattleSkullPost', 'whiskeyBarrel', 'tntCrate', 'crate', 'barrel', 'mineCart'];
const WOOD_LANDMARKS = ['windmill', 'waterTower', 'outhouse', 'gallows', 'mineEntrance', 'saloonFacade', 'sheriffFacade', 'storeFacade', 'wagon'];

/** weathered Wild West wood everywhere: singles, fence runs and a few lone buildings per zone */
function woodScatter(ctx: ThemeCtx, zn: ZoneDef) {
  const { rng } = ctx;
  const R = zn.r;
  const K = areaK(zn);
  for (const k of WOOD_SINGLES) if (rng.chance(0.75)) scatter(ctx, zn, k, Math.round(rng.int(1, 3) * K * 0.6), 8, R - 4, 7);
  // fence runs
  for (let f = 0; f < Math.round(3 * Math.sqrt(K)); f++) {
    const a = rng.range(0, Math.PI * 2), r0 = rng.range(R * 0.3, R * 0.85);
    const x = zn.cx + Math.cos(a) * r0, z = zn.cz + Math.sin(a) * r0;
    const dir = a + Math.PI / 2 + rng.range(-0.3, 0.3);
    const len = rng.int(3, 7);
    for (let i = 0; i < len; i++) {
      if (rng.chance(0.2)) continue;
      zn.anchors.push({ kind: rng.chance(0.3) ? 'fenceBroken' : 'fence', x: x + Math.cos(dir) * i * 3.1, z: z + Math.sin(dir) * i * 3.1, rot: dir });
    }
  }
  const lm = rng.shuffle(WOOD_LANDMARKS.slice()).slice(0, rng.int(3, 5));
  for (const k of lm) scatter(ctx, zn, k, 1, R * 0.3, R - 12, 26);
}

function outlawCamp(ctx: ThemeCtx, zn: ZoneDef, x: number, z: number) {
  const { rng } = ctx;
  zn.anchors.push({ kind: 'campfire', x, z, rot: 0 });
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    zn.anchors.push({ kind: 'tent', x: x + Math.cos(a) * 6.5, z: z + Math.sin(a) * 6.5, rot: a + Math.PI });
  }
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2), rr = rng.range(3, 9);
    zn.anchors.push({ kind: rng.pick(['crate', 'barrel', 'tntCrate', 'whiskeyBarrel']), x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr, rot: rng.range(0, 6.28) });
  }
  zn.anchors.push({ kind: 'wagon', x: x + rng.range(-10, 10), z: z + rng.range(-10, 10), rot: rng.range(0, 6.28) });
}

function applyTheme(ctx: ThemeCtx, zn: ZoneDef) {
  const { field, noise, rng } = ctx;
  const fr = zoneFrame(zn);
  const R = zn.r;
  /** linear scale against the old 64 m zones (set pieces grow with it) */
  const K = R / 64;
  const AK = areaK(zn);
  const N = (c: number) => Math.max(1, Math.round(c * AK));
  const x0 = zn.cx - R - 30,
    x1 = zn.cx + R + 30,
    z0 = zn.cz - R - 30,
    z1 = zn.cz + R + 30;
  const wAt = (x: number, z: number, inner = 0) => smoothstep(R + 24, R - 6 - inner, Math.hypot(x - zn.cx, z - zn.cz));
  const baseAvg = avgBase(field, zn.cx, zn.cz, R * 0.6);
  // common sprinkles: mostly weathered outlaw wood + cacti
  const commonProps = (cact = 10, rocks = 8) => {
    scatter(ctx, zn, 'cactus', N(cact + 4), 10, R - 4, 7);
    scatter(ctx, zn, 'rock', N(Math.max(2, rocks - 3)), 8, R - 2, 8);
    scatter(ctx, zn, 'bush', N(6), 6, R - 2, 5);
    // the desert is full of dead brush and dry grass
    scatter(ctx, zn, 'deadBush', N(34), 4, R + 6, 3.2);
    scatter(ctx, zn, 'dryGrass', N(46), 3, R + 6, 2.2);
    scatter(ctx, zn, 'tumbleweed', N(5), 6, R - 8, 10);
    woodScatter(ctx, zn);
  };

  switch (zn.theme) {
    case 'flats': {
      forRect(field, x0, z0, x1, z1, (k, x, z) => {
        const w = wAt(x, z);
        if (w <= 0) return;
        const target = baseAvg + (field.base[k] - baseAvg) * 0.45;
        field.base[k] = lerp(field.base[k], target, w);
      });
      // ruined little homestead + the start camp
      const home = fr.toWorld(R * 0.25, -R * 0.35);
      const startZ = zn.cz - R * 0.45;
      zn.anchors.push({ kind: 'shack', x: home.x, z: home.z, rot: zn.dir + 0.4 });
      zn.anchors.push({ kind: 'wagon', x: home.x + 9, z: home.z - 4, rot: zn.dir - 1.2 });
      zn.anchors.push({ kind: 'campfire', x: zn.cx - 6, z: startZ, rot: 0 });
      zn.anchors.push({ kind: 'wantedBoard', x: zn.cx + 5, z: startZ + 4, rot: zn.dir - Math.PI / 2 });
      zn.anchors.push({ kind: 'dumbScarab', x: zn.cx + 12, z: startZ + 14 });
      zn.anchors.push({ kind: 'totem', x: zn.cx - R * 0.3, z: zn.cz + R * 0.3 });
      zn.pois.push({ kind: 'homestead', name: 'Abandoned Homestead', x: home.x, z: home.z, r: 12 });
      flattenDisc(field, home.x, home.z, 10, 0.9, MAT.DIRT, noise);
      commonProps(16, 10);
      scatter(ctx, zn, 'skull', N(3), 10, R - 6, 10);
      break;
    }
    case 'canyon': {
      // spine through zone along travel direction with lateral meander
      const pts: { x: number; z: number }[] = [];
      const ph0 = rng.range(0, 1);
      for (let t = -1.3; t <= 1.3; t += 0.08) {
        const f = t * R;
        const s = Math.sin(t * 2.4 + ph0) * R * 0.22 + Math.sin(t * 5.3 + ph0 * 3) * R * 0.05;
        pts.push(fr.toWorld(f, s));
      }
      const pf = polyField(field, pts, 40);
      const pd = { d: 0, along: 0 };
      const floor = baseAvg - 1.5;
      const mesa = floor + 15;
      const ramps: { x: number; z: number; len: number; dirx: number; dirz: number }[] = [];
      const hw0 = 14;
      forRect(field, x0, z0, x1, z1, (k, x, z) => {
        const w = wAt(x, z, 4);
        if (w <= 0) return;
        const { d, along } = pf.at(k, pd);
        // the canyon breathes: narrows, side pockets and wide bends
        const halfW = hw0 + 5 * noise.n2(along * 0.2, 2.2) + 7 * smoothstep(0.55, 0.9, noise.n2(along * 0.11, 7.7));
        const wall = smoothstep(halfW, halfW + 3, d);
        const terr = Math.floor((noise.n2(x * 0.02, z * 0.02) * 0.5 + 0.5) * 3) * 1.6;
        const top = mesa + terr + noise.n2(x * 0.07, z * 0.07) * 0.6;
        const fl = floor + noise.n2(x * 0.03, z * 0.03) * 1.2 + Math.sin(d * 0.25) * 0.4;
        const h = lerp(fl, top, wall);
        field.base[k] = lerp(field.base[k], h, w);
        if (w > 0.5) {
          if (wall > 0.25) field.baseMat[k] = noise.n2(x * 0.08, z * 0.08) > 0.35 && wall > 0.98 ? MAT.SAND : MAT.ROCK;
          else field.baseMat[k] = MAT.RED_SAND;
        }
      });
      // sand ramps leaning on walls (launch onto the mesa tops, which are wide open country to explore)
      for (let r = 0; r < 8; r++) {
        const t = -0.8 + (r / 7) * 1.6 + rng.range(-0.06, 0.06);
        const side = r % 2 ? 1 : -1;
        const sAt = Math.sin(t * 2.4 + ph0) * R * 0.22 + Math.sin(t * 5.3 + ph0 * 3) * R * 0.05;
        const base = fr.toWorld(t * R, sAt + side * 8);
        const out = fr.toWorld(t * R, sAt + side * 30);
        const L = Math.hypot(out.x - base.x, out.z - base.z);
        ramps.push({ x: base.x, z: base.z, len: 22, dirx: (out.x - base.x) / L, dirz: (out.z - base.z) / L });
      }
      for (const rp of ramps) {
        forRect(field, rp.x - 30, rp.z - 30, rp.x + 30, rp.z + 30, (k, x, z) => {
          const dx = x - rp.x,
            dz = z - rp.z;
          const along = dx * rp.dirx + dz * rp.dirz;
          const lat = Math.abs(dx * -rp.dirz + dz * rp.dirx);
          if (along < 0 || along > rp.len || lat > 6.5) return;
          const hh = floor + (along / rp.len) * (mesa - floor + 1.5) * smoothstep(6.5, 4, lat);
          if (hh > field.base[k]) {
            field.base[k] = hh;
            field.baseMat[k] = MAT.SAND;
          }
        });
      }
      zn.pois.push({ kind: 'canyon', name: 'Rattlesnake Canyon', x: zn.cx, z: zn.cz, r: 20 });
      scatter(ctx, zn, 'rock', N(12), 6, R - 4, 8);
      scatter(ctx, zn, 'cactus', N(8), 4, R - 4, 8);
      scatter(ctx, zn, 'deadBush', N(20), 4, R + 6, 3.2);
      scatter(ctx, zn, 'dryGrass', N(24), 3, R + 6, 2.4);
      scatter(ctx, zn, 'skull', N(2), 4, R - 10, 10);
      scatter(ctx, zn, 'boulder', 6, 4, R * 0.6, 14, (a) => (a.data = { rolling: true }));
      scatter(ctx, zn, 'mineEntrance', 2, 6, R - 6, 30);
      scatter(ctx, zn, 'mineCart', N(3), 4, R - 6, 8);
      scatter(ctx, zn, 'tntCrate', N(4), 4, R - 6, 6);
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(0, 0) });
      break;
    }
    case 'bones': {
      forRect(field, x0, z0, x1, z1, (k, x, z) => {
        const w = wAt(x, z);
        if (w <= 0) return;
        field.base[k] = lerp(field.base[k], baseAvg + (field.base[k] - baseAvg) * 0.7, w);
        if (w > 0.6 && noise.n2(x * 0.04, z * 0.04) > 0.55) field.baseMat[k] = MAT.BONE;
      });
      for (let i = 0; i < 6; i++) {
        const p = fr.toWorld(rng.range(-0.7, 0.7) * R, rng.range(-0.6, 0.6) * R);
        if (anchorsNear(zn, p.x, p.z, 26, (o) => o.kind === 'ribArch')) continue;
        zn.anchors.push({ kind: 'ribArch', x: p.x, z: p.z, rot: zn.dir + rng.range(-0.4, 0.4), scale: rng.range(0.9, 1.25) });
      }
      scatter(ctx, zn, 'giantSkull', 4, 12, R - 10, 34);
      scatter(ctx, zn, 'boneScatter', N(10), 4, R - 4, 8);
      scatter(ctx, zn, 'skull', N(6), 4, R - 4, 8);
      commonProps(6, 6);
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(-R * 0.3, R * 0.25) });
      break;
    }
    case 'temple':
    case 'lotustemple': {
      const sid = `rise_${ctx.spec.key}_${zn.index}`;
      const W = 56,
        D = 40,
        H = 2.6;
      const top = baseAvg + H;
      const ext = Math.hypot(W, D) / 2 + 8;
      const plinth: Stamp = {
        id: sid,
        x0: zn.cx - ext,
        z0: zn.cz - ext,
        x1: zn.cx + ext,
        z1: zn.cz + ext,
        replace: true,
        max: true,
        weight: 0,
        fn: (x, z) => {
          const { f, s } = fr.toLocal(x, z);
          const ef = Math.abs(f) - D / 2,
            es = Math.abs(s) - W / 2;
          const e = Math.max(ef, es);
          if (e > 6) return NaN;
          if (e <= 0) return top;
          // stepped edges (0.5 m steps, 1.1 m deep)
          const step = Math.ceil(e / 1.1);
          return top - step * 0.5;
        },
        mat: (x, z) => {
          const { f, s } = fr.toLocal(x, z);
          const e = Math.max(Math.abs(f) - D / 2, Math.abs(s) - W / 2);
          return e <= 5.5 ? MAT.TILE : -1;
        },
      };
      field.stamps.push(plinth);
      zn.riseStamp = sid;
      // columns along both long sides, obelisks at entrance, statue at back
      for (let c = -4; c <= 4; c++) {
        for (const side of [-1, 1]) {
          const p = fr.toWorld(c * 4.4, side * (W / 2 - 3));
          zn.anchors.push({ kind: 'column', x: p.x, z: p.z, rot: zn.dir, rise: sid, data: { broken: rng.chance(0.3) } });
        }
      }
      const e1 = fr.toWorld(-D / 2 - 9, -7),
        e2 = fr.toWorld(-D / 2 - 9, 7);
      zn.anchors.push({ kind: 'obelisk', x: e1.x, z: e1.z, rot: zn.dir, rise: sid });
      zn.anchors.push({ kind: 'obelisk', x: e2.x, z: e2.z, rot: zn.dir, rise: sid });
      const st = fr.toWorld(D / 2 - 4, 0);
      zn.anchors.push({ kind: 'statue', x: st.x, z: st.z, rot: zn.dir + Math.PI, rise: sid, data: { god: zn.theme === 'temple' ? 'thoth' : 'sekhmet' } });
      const sh = fr.toWorld(0, 0);
      zn.anchors.push({ kind: 'sarcophagus', x: sh.x, z: sh.z, rot: zn.dir, rise: sid });
      zn.pois.push({ kind: 'temple', name: zn.name, x: zn.cx, z: zn.cz, r: ext });
      if (zn.theme === 'lotustemple') {
        for (let p = 0; p < 8; p++) {
          const q = fr.toWorld(rng.range(-R * 0.75, R * 0.75), rng.range(-R * 0.75, R * 0.75));
          if (Math.hypot(q.x - zn.cx, q.z - zn.cz) < ext + 14) continue;
          carvePool(field, q.x, q.z, rng.range(9, 15), ctx.spec.water - 1.2);
        }
        scatter(ctx, zn, 'palm', N(10), R * 0.45, R - 4, 9);
        scatter(ctx, zn, 'reeds', N(6), R * 0.4, R - 4, 6);
      } else {
        // a processional way of sphinxes leads to the entrance
        for (let i = 0; i < 3; i++)
          for (const side of [-1, 1]) {
            const p = fr.toWorld(-D / 2 - 22 - i * 13, side * 11);
            zn.anchors.push({ kind: 'sphinx', x: p.x, z: p.z, rot: zn.dir + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
          }
        scatter(ctx, zn, 'hieroglyphWall', 9, R * 0.45, R - 6, 18);
        commonProps(6, 6);
      }
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(R * 0.55, R * 0.4) });
      break;
    }
    case 'outpost': {
      flattenDisc(field, zn.cx, zn.cz, 34, 1, MAT.DIRT, noise);
      // berm ring
      forRect(field, x0, z0, x1, z1, (k, x, z) => {
        const d = Math.hypot(x - zn.cx, z - zn.cz);
        const berm = Math.exp(-((d - 46) ** 2) / 50) * 3.8;
        field.base[k] += berm * wAt(x, z);
      });
      const ring = 9;
      for (let i = 0; i < ring; i++) {
        const a = zn.dir + (i / ring) * Math.PI * 2 + 0.3;
        const r = 24 + rng.range(-2, 3);
        zn.anchors.push({ kind: i % 3 === 2 ? 'tent' : 'shack', x: zn.cx + Math.cos(a) * r, z: zn.cz + Math.sin(a) * r, rot: a + Math.PI });
      }
      zn.anchors.push({ kind: 'watchtower', x: zn.cx + 6, z: zn.cz - 5, rot: 0 });
      zn.anchors.push({ kind: 'well', x: zn.cx - 4, z: zn.cz + 3, rot: 0 });
      zn.anchors.push({ kind: 'wantedBoard', x: zn.cx + 2, z: zn.cz + 8, rot: zn.dir });
      zn.anchors.push({ kind: 'wagon', x: zn.cx - 12, z: zn.cz - 8, rot: 1.1 });
      zn.anchors.push({ kind: 'campfire', x: zn.cx, z: zn.cz, rot: 0 });
      for (let i = 0; i < 14; i++) {
        const a = rng.range(0, Math.PI * 2),
          r = rng.range(8, 30);
        zn.anchors.push({ kind: rng.chance(0.6) ? 'crate' : 'barrel', x: zn.cx + Math.cos(a) * r, z: zn.cz + Math.sin(a) * r, rot: rng.range(0, 6.28) });
      }
      for (let i = 0; i < 9; i++) {
        const a = zn.dir + (i / 9) * Math.PI * 2;
        zn.anchors.push({ kind: 'fence', x: zn.cx + Math.cos(a) * 36, z: zn.cz + Math.sin(a) * 36, rot: a + Math.PI / 2 });
      }
      // the camp ring is a hard footprint for the wild sights
      zn.anchors.push({ kind: 'poiMark', x: zn.cx, z: zn.cz, data: { r: 48 } });
      zn.pois.push({ kind: 'outpost', name: 'Outlaw Gulch', x: zn.cx, z: zn.cz, r: 48 });
      commonProps(8, 6);
      break;
    }
    case 'glassdunes':
    case 'stormapproach': {
      forRect(field, x0, z0, x1, z1, (k, x, z) => {
        const w = wAt(x, z);
        if (w <= 0) return;
        const u = x * ctx.wind.x + z * ctx.wind.z;
        const ph = u / 56 + noise.n2(x * 0.008, z * 0.008) * 0.8;
        const t = ph - Math.floor(ph);
        const prof = t < 0.72 ? Math.pow(t / 0.72, 1.6) : 1 - smoothstep(0, 1, (t - 0.72) / 0.28);
        const amp = zn.theme === 'stormapproach' ? 14 : 12;
        field.base[k] = lerp(field.base[k], baseAvg - 2 + prof * amp * (0.7 + 0.3 * noise.n2(x * 0.02, z * 0.02)), w * 0.9);
        if (w > 0.5 && t > 0.6 && t < 0.78 && zn.theme === 'glassdunes') field.baseMat[k] = MAT.SAND_DARK;
      });
      scatter(ctx, zn, 'rock', N(5), 8, R - 2, 10);
      scatter(ctx, zn, 'tumbleweed', N(8), 6, R - 8, 10);
      scatter(ctx, zn, 'deadBush', N(14), 4, R + 6, 4);
      scatter(ctx, zn, 'dryGrass', N(20), 3, R + 6, 3);
      woodScatter(ctx, zn);
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(0, R * 0.3) });
      if (zn.theme === 'stormapproach') scatter(ctx, zn, 'obeliskBroken', 8, 10, R - 8, 24);
      break;
    }
    case 'hollows': {
      const craters: { x: number; z: number; r: number }[] = [];
      for (let c = 0; c < 30 && craters.length < 10; c++) {
        const p = fr.toWorld(rng.range(-0.7, 0.7) * R, rng.range(-0.7, 0.7) * R);
        const cr = rng.range(12, 22);
        if (Math.hypot(p.x - zn.cx, p.z - zn.cz) > R - cr - 10) continue;
        if (craters.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < o.r + cr + 12)) continue;
        craters.push({ x: p.x, z: p.z, r: cr });
      }
      for (const cc of craters) {
        const depth = rng.range(5, 8.5);
        forRect(field, cc.x - cc.r * 1.6, cc.z - cc.r * 1.6, cc.x + cc.r * 1.6, cc.z + cc.r * 1.6, (k, x, z) => {
          const d = Math.hypot(x - cc.x, z - cc.z) / cc.r;
          const bowl = d < 1 ? -depth * (1 - d * d) : 0;
          const rim = Math.exp(-((d - 1.05) ** 2) / 0.02) * 1.8;
          field.base[k] += (bowl + rim) * wAt(x, z);
          if (d < 0.75) field.baseMat[k] = MAT.SAND_DARK;
        });
        zn.anchors.push({ kind: 'scarabNest', x: cc.x, z: cc.z, data: { r: cc.r } });
      }
      commonProps(6, 10);
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(-R * 0.4, 0) });
      break;
    }
    case 'obelisks':
    case 'sphinxavenue': {
      const avenueW = zn.theme === 'sphinxavenue' ? 12 : 9;
      forRect(field, x0, z0, x1, z1, (k, x, z) => {
        const w = wAt(x, z);
        if (w <= 0) return;
        const { f, s } = fr.toLocal(x, z);
        const av = smoothstep(avenueW + 4, avenueW, Math.abs(s)) * smoothstep(R * 0.86, R * 0.7, Math.abs(f));
        field.base[k] = lerp(field.base[k], baseAvg + f * 0.02 + (field.base[k] - baseAvg) * 0.4, w * Math.max(0.5, av));
        if (av > 0.5 && w > 0.5) field.baseMat[k] = (Math.floor(f / 2) + Math.floor(s / 2)) % 2 === 0 ? MAT.TILE : MAT.SAND_DARK;
      });
      const nAv = Math.floor((R * 0.72) / 11);
      for (let i = -nAv; i <= nAv; i++) {
        for (const side of [-1, 1]) {
          const p = fr.toWorld(i * 11, side * (avenueW + 3));
          zn.anchors.push({ kind: zn.theme === 'sphinxavenue' ? 'sphinx' : i % 3 === 0 ? 'obeliskBroken' : 'obelisk', x: p.x, z: p.z, rot: zn.dir + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
        }
      }
      // the avenue is a hard strip for the wild sights (they flank it, never sit on it)
      for (let i = -nAv; i <= nAv; i += 2) zn.anchors.push({ kind: 'poiMark', ...fr.toWorld(i * 11, 0), data: { r: avenueW + 6 } });
      zn.pois.push({ kind: 'avenue', name: zn.theme === 'sphinxavenue' ? 'Avenue of Sphinxes' : 'Field of Needles', x: zn.cx, z: zn.cz, r: avenueW + 6 });
      if (zn.theme === 'obelisks') scatter(ctx, zn, 'obelisk', N(3), 14, R - 8, 20);
      commonProps(6, 6);
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(R * 0.3, R * 0.45) });
      break;
    }
    case 'mesas': {
      const centers: { x: number; z: number; r: number; h: number }[] = [];
      for (let t = 0; t < 40 && centers.length < 9; t++) {
        const p = fr.toWorld(rng.range(-0.62, 0.62) * R, rng.range(-0.62, 0.62) * R);
        const r = rng.range(14, 24);
        if (centers.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < c.r + r + 18)) continue;
        centers.push({ x: p.x, z: p.z, r, h: baseAvg + 4 + centers.length * 2.3 + rng.range(0, 2) });
      }
      forRect(field, x0, z0, x1, z1, (k, x, z) => {
        const w = wAt(x, z);
        if (w <= 0) return;
        let h = lerp(field.base[k], baseAvg, 0.6);
        let rock = false;
        for (const c of centers) {
          const d = Math.hypot(x - c.x, z - c.z) / c.r;
          const wob = noise.n2(x * 0.08, z * 0.08) * 0.12;
          const m = smoothstep(1.05 + wob, 0.95 + wob, d);
          if (m > 0) {
            h = Math.max(h, lerp(h, c.h, m));
            if (m > 0.05 && m < 0.95) rock = true;
          }
        }
        field.base[k] = lerp(field.base[k], h, w);
        if (rock && w > 0.5) field.baseMat[k] = MAT.ROCK;
      });
      // ramps up to each mesa
      for (const c of centers) {
        rampUp(field, rng.range(0, Math.PI * 2), c.x, c.z, c.r, c.h, 15 + (c.h - baseAvg) * 0.9, 5.5);
        zn.anchors.push({ kind: 'poiMark', x: c.x, z: c.z, data: { r: c.r + 4 } });
      }
      zn.pois.push({ kind: 'mesas', name: 'Mesa Steps', x: zn.cx, z: zn.cz, r: 20 });
      scatter(ctx, zn, 'cactus', N(10), 6, R - 4, 8);
      scatter(ctx, zn, 'rock', N(4), 6, R - 2, 10);
      scatter(ctx, zn, 'deadBush', N(16), 4, R + 6, 4);
      scatter(ctx, zn, 'dryGrass', N(20), 3, R + 6, 3);
      woodScatter(ctx, zn);
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(0, 0) });
      break;
    }
    case 'arena':
    case 'oasisheart':
    case 'apex': {
      const ar = Math.round(R * 0.68);
      const top = zn.theme === 'apex' ? baseAvg + 34 : baseAvg;
      forRect(field, x0, z0, x1, z1, (k, x, z) => {
        const d = Math.hypot(x - zn.cx, z - zn.cz);
        const w = wAt(x, z);
        if (w <= 0) return;
        // bowl with rideable rim (quarter pipe)
        const bowl = d < ar ? top + Math.pow(d / ar, 3) * 5.5 : top + 5.5 + (d - ar) * (zn.theme === 'apex' ? -0.9 : 0.15);
        field.base[k] = lerp(field.base[k], bowl, zn.theme === 'apex' ? Math.max(w, d < ar + 20 ? 1 : w) : w);
        if (d < ar - 3) field.baseMat[k] = zn.theme === 'oasisheart' ? MAT.GRASS : zn.theme === 'apex' ? MAT.TILE : MAT.RED_SAND;
      });
      if (zn.theme === 'oasisheart') {
        // island in lake: carve ring of water
        forRect(field, x0, z0, x1, z1, (k, x, z) => {
          const d = Math.hypot(x - zn.cx, z - zn.cz);
          if (d > ar + 4 && d < ar + 20) {
            const t = 1 - Math.abs(d - (ar + 12)) / 8;
            field.base[k] = Math.min(field.base[k], lerp(field.base[k], ctx.spec.water - 1.5, clamp(t * 1.5, 0, 1)));
            field.baseMat[k] = MAT.MUD;
          }
        });
        scatter(ctx, zn, 'palm', N(12) >> 1, ar - 14, ar - 2, 7);
      }
      const nr = 16;
      for (let i = 0; i < nr; i++) {
        const a = (i / nr) * Math.PI * 2;
        zn.anchors.push({ kind: zn.theme === 'apex' ? 'obelisk' : 'rock', x: zn.cx + Math.cos(a) * (ar + 4), z: zn.cz + Math.sin(a) * (ar + 4), rot: a, scale: 1.4 });
      }
      zn.anchors.push({ kind: 'bossMark', x: zn.cx, z: zn.cz, data: { r: ar } });
      zn.pois.push({ kind: 'arena', name: zn.name, x: zn.cx, z: zn.cz, r: ar });
      if (zn.theme === 'oasisheart') {
        // the island is the oasis boss arena: kept clear for the boss fight set-up
        zn.anchors.push({ kind: 'bossArena', x: zn.cx, z: zn.cz, data: { r: ar - 4, level: top, lake: [ar + 4, ar + 20] } });
      }
      // the outer ring between the bowl and the storm is open desert with a few dry sprinkles
      scatter(ctx, zn, 'deadBush', N(8), ar + 8, R + 4, 4);
      scatter(ctx, zn, 'dryGrass', N(10), ar + 8, R + 4, 3);
      break;
    }
    case 'palmshore':
    case 'marsh':
    case 'floodruins': {
      const water = ctx.spec.water;
      forRect(field, x0, z0, x1, z1, (k, x, z) => {
        const w = wAt(x, z);
        if (w <= 0) return;
        let h = lerp(field.base[k], baseAvg, 0.5);
        if (zn.theme === 'palmshore') {
          const { f } = fr.toLocal(x, z);
          const lake = smoothstep(-0.04 * R, 0.36 * R, f + noise.n2(x * 0.02, z * 0.02) * R * 0.18);
          h = lerp(h, water - 2.5, lake * 0.95);
        } else if (zn.theme === 'marsh') {
          const ch = Math.abs(noise.n2(x * 0.014, z * 0.014));
          const chan = smoothstep(0.12, 0.04, ch);
          h = lerp(baseAvg + 0.6 + noise.n2(x * 0.05, z * 0.05) * 0.8, water - 1.2, chan);
        } else {
          h = water - 0.6 + noise.n2(x * 0.04, z * 0.04) * 1.3;
        }
        field.base[k] = lerp(field.base[k], h, w);
        if (w > 0.4) {
          const hh = field.base[k];
          field.baseMat[k] = hh < water - 0.2 ? MAT.MUD : hh < water + 1.2 ? MAT.GRASS : field.baseMat[k];
        }
      });
      scatter(ctx, zn, 'palm', N(zn.theme === 'marsh' ? 10 : 18), 6, R - 3, 7);
      scatter(ctx, zn, 'reeds', N(16), 4, R - 3, 5);
      woodScatter(ctx, zn);
      if (zn.theme === 'floodruins') {
        scatter(ctx, zn, 'ruinWall', N(8) >> 1, 8, R - 6, 14);
        scatter(ctx, zn, 'column', N(8) >> 1, 6, R - 6, 10, (a) => (a.data = { broken: true }));
      }
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(0, R * 0.2) });
      break;
    }
    case 'pyramidbase':
    case 'pyramidterraces': {
      // the giant stepped pyramid looms inside the zone (pyramidbase) or the zone climbs its terraces
      const big = zn.theme === 'pyramidbase';
      const pc = fr.toWorld(big ? R * 0.42 : 0, big ? R * 0.18 : 0);
      const half = big ? R * 0.4 : R * 0.55;
      const height = big ? 50 : 34;
      const stepH = big ? 2.2 : 2.6,
        stepW = (half / height) * stepH;
      forRect(field, pc.x - half - 4, pc.z - half - 4, pc.x + half + 4, pc.z + half + 4, (k, x, z) => {
        const e = Math.max(Math.abs(x - pc.x), Math.abs(z - pc.z));
        if (e > half) return;
        const level = Math.floor((half - e) / stepW);
        const ph = baseAvg + Math.min(height, (level + 1) * stepH);
        if (ph > field.base[k]) {
          field.base[k] = ph;
          field.baseMat[k] = MAT.TILE;
        }
      });
      // drifted sand ramps climb the terraces (two faces on the big one, all four on the terraces)
      const nRamp = big ? 2 : 4;
      for (let r = 0; r < nRamp; r++) {
        const a = zn.dir + Math.PI + (r * Math.PI) / 2 - (big ? Math.PI / 4 : 0);
        const dirx = Math.cos(a),
          dirz = Math.sin(a);
        const reach = half + 10;
        forRect(field, pc.x - half - 12, pc.z - half - 12, pc.x + half + 12, pc.z + half + 12, (k, x, z) => {
          const dx = x - pc.x,
            dz = z - pc.z;
          const along = dx * dirx + dz * dirz;
          const lat = Math.abs(-dx * dirz + dz * dirx);
          if (lat > 6 || along < 0 || along > reach) return;
          const hh = baseAvg + height * (1 - along / reach) * smoothstep(6, 4, lat);
          if (hh > field.base[k] - 0.5) {
            field.base[k] = Math.max(field.base[k], hh);
            field.baseMat[k] = MAT.SAND;
          }
        });
      }
      zn.anchors.push({ kind: 'capstone', x: pc.x, z: pc.z, data: { y: baseAvg + height } });
      zn.anchors.push({ kind: 'poiMark', x: pc.x, z: pc.z, data: { r: half * 1.42 + 6 } });
      zn.pois.push({ kind: 'pyramid', name: big ? 'The Red Pyramid' : 'The Terraces', x: pc.x, z: pc.z, r: half * 1.42 });
      scatter(ctx, zn, 'obeliskBroken', 6, 10, R - 6, 20);
      scatter(ctx, zn, 'rock', N(4), 10, R - 2, 10);
      scatter(ctx, zn, 'deadBush', N(12), 4, R + 6, 4);
      scatter(ctx, zn, 'dryGrass', N(16), 3, R + 6, 3);
      woodScatter(ctx, zn);
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(-R * 0.35, -R * 0.3) });
      break;
    }
  }
  // room for other systems' content first (wildlife, the cave pit), so the set pieces leave it open
  reserveSpots(ctx, zn);
  // a dry riverbed snaking across some zones
  if (RIVER_THEMES.has(zn.theme) && rng.chance(0.75)) riverbed(ctx, zn);
  // a ghost town: a short street of abandoned, caved-in buildings (spiders and loot inside)
  const TOWN: ThemeId[] = ['flats', 'outpost', 'glassdunes', 'hollows', 'mesas', 'bones', 'obelisks', 'stormapproach', 'pyramidbase'];
  if (TOWN.includes(zn.theme)) ghostTown(ctx, zn);
  // a lush oasis in the zones that can hold one (water, reeds, palms, flowers, a resting spot)
  const OASIS: Partial<Record<ThemeId, number>> = { flats: 10, glassdunes: 12, mesas: 11, palmshore: 11, hollows: 9, sphinxavenue: 10 };
  if (OASIS[zn.theme]) placeOasis(ctx, zn, OASIS[zn.theme]!);
  // treasure, ore and secrets in every zone
  scatter(ctx, zn, 'ore', Math.round(3 * AK * 0.6), 10, R - 6, 18, (a) => (a.data = { type: rng.pick(['copper', 'silver', 'gold', 'turquoise', 'amethyst']) }));
  scatter(ctx, zn, 'chest', 3, R * 0.25, R - 6, 12);
  scatter(ctx, zn, 'pot', Math.round(4 * AK * 0.6), 6, R - 6, 8);
  // one big landmark encounter per zone (tall wooden building, walk-in cinematic + mission)
  const lmTypes: LandmarkType[] = ['tradingPost', 'outlawFort', 'mineHeadframe', 'ranchBarn', 'sheriffOffice', 'saloon'];
  const lt = zn.index === 0 ? 'tradingPost' : lmTypes[(zn.index * 7 + ctx.spec.key.charCodeAt(0)) % lmTypes.length];
  if (zn.theme !== 'arena' && zn.theme !== 'apex' && zn.theme !== 'oasisheart') {
    placeLandmark(ctx, zn, lt);
    // tall ruined lookout towers: landmarks seen from across the zone, loot at the top
    placeOutposts(ctx, zn);
  }
  // the wild sights: arches, colossi, wrecks, bone fields, mesas, viewpoints, camps, shrines, dune ramps
  placePois(ctx, zn);
  // treasure dig spots (for the digging system): by the sights and out in the open
  digSpots(ctx, zn);
}

/** a ramp of drifted sand from the flat up onto a plateau (c: plateau centre, r: radius, top: height) */
function rampUp(field: Heightfield, a: number, cx: number, cz: number, r: number, top: number, len: number, hw: number) {
  const dirx = Math.cos(a),
    dirz = Math.sin(a);
  const sx = cx + dirx * (r + len),
    sz = cz + dirz * (r + len);
  forRect(field, cx - r - len - 8, cz - r - len - 8, cx + r + len + 8, cz + r + len + 8, (k, x, z) => {
    const dx = x - sx,
      dz = z - sz;
    const along = -(dx * dirx + dz * dirz);
    const lat = Math.abs(-dx * dirz + dz * dirx);
    if (along < 0 || along > len + 2 || lat > hw) return;
    const ground = field.base[k];
    const t = smoothstep(0, 1, Math.min(1, along / len));
    const hh = lerp(ground, top, t);
    const s = smoothstep(hw, hw - 1.6, lat);
    const v = ground + (hh - ground) * s;
    if (v > field.base[k]) {
      field.base[k] = v;
      field.baseMat[k] = MAT.SAND;
    }
  });
}

// ---------------------------------------------------------------------------
// Footprints: how much room an anchor takes (m). Small scatter can be cleared away by a
// set piece; foliage never blocks anything.
const FOLIAGE = new Set(['deadBush', 'dryGrass', 'bush', 'tumbleweed', 'reeds', 'oasisReeds', 'oasisFlowers', 'lilyPads']);
const FOOT: Record<string, number> = {
  outpost: 6, shack: 5.5, saloonFacade: 6.5, sheriffFacade: 6.5, storeFacade: 6.5, tent: 3.4, wagon: 3.8, windmill: 4.5, waterTower: 4.5, watchtower: 4.5, outhouse: 2, gallows: 3.6,
  mineEntrance: 3.5, well: 1.8, campfire: 1.5, rug: 1.6, wantedBoard: 1.5, oasisMark: 3.5, rockArch: 13, colossusLegs: 6.5, colossusHead: 6, shipwreck: 11, shrine: 5.5, cairn: 1.6,
  ribArch: 6, giantSkull: 4.5, sphinx: 6, statue: 2.2, column: 1.2, obelisk: 1.4, obeliskBroken: 1.4, hieroglyphWall: 4, sarcophagus: 2.2, totem: 1.2, capstone: 0, stoneGate: 7,
  boneGate: 7, ruinWall: 3.5, palm: 1, cactus: 1, rock: 1.4, boulder: 1.6, chest: 1.2, ore: 1, pot: 0.8, crate: 0.9, barrel: 0.9, whiskeyBarrel: 0.9, tntCrate: 0.9,
};
/** kinds whose footprint radius is carried in data.r */
const RADIAL = new Set(['poiMark', 'bossMark', 'bossArena', 'scarabNest', 'wildlifeSpot', 'cavePit', 'digSpot', 'riverMark', 'duneRamp', 'viewpoint', 'claim']);
export function footprintOf(a: Anchor): number {
  if (RADIAL.has(a.kind)) return a.data?.r ?? 4;
  if (a.kind === 'landmark') {
    const info = LANDMARK_INFO[a.data?.type as LandmarkType];
    return info ? Math.max(info.size[0], info.size[1]) * 0.5 + 4 : 12;
  }
  if (a.kind === 'oasisPool') return (a.data?.r ?? 9) * 1.6;
  if (FOLIAGE.has(a.kind)) return 0;
  return (FOOT[a.kind] ?? 2) * (a.scale ?? 1);
}
/** a set piece of radius r at (x, z) would collide with something that may not be cleared */
function blocked(zn: ZoneDef, x: number, z: number, r: number, pad = 0) {
  return anchorsNear(zn, x, z, r + 40, (a) => {
    if (SMALL_SCATTER.has(a.kind) || FOLIAGE.has(a.kind)) return false;
    return Math.hypot(a.x - x, a.z - z) < r + footprintOf(a) + pad;
  });
}
function clearSmall(zn: ZoneDef, x: number, z: number, r: number) {
  zn.anchors = zn.anchors.filter((o) => Math.hypot(o.x - x, o.z - z) >= r || !(SMALL_SCATTER.has(o.kind) || FOLIAGE.has(o.kind)));
}

export interface OpenSpotOpts {
  /** search around this point (default: the whole zone) */
  near?: { x: number; z: number };
  minDist?: number;
  maxDist?: number;
  tries?: number;
  /** max rise over run across the spot (default 0.3) */
  maxSlope?: number;
  /** keep out of water (default true) */
  dry?: boolean;
  /** count small scatter (cacti, rocks, crates) as blocking too (default true) */
  strict?: boolean;
  /** extra metres kept from corridor mouths (default 24) */
  mouthPad?: number;
  /** 0..1 random source (default Math.random) */
  rand?: () => number;
}

/**
 * Find an open, roughly level spot of radius `radius` inside a zone: clear of every anchor
 * footprint (buildings, sights, reserved spots, and small scatter unless strict = false),
 * off the corridor mouths, out of water and pools, comfortably inside the storm rim.
 */
export function findOpenSpot(zone: ZoneDef, field: Heightfield, radius: number, opts: OpenSpotOpts = {}): { x: number; z: number; y: number } | null {
  const rand = opts.rand ?? Math.random;
  const tries = opts.tries ?? 80;
  const maxSlope = opts.maxSlope ?? 0.3;
  const dry = opts.dry ?? true;
  const strict = opts.strict ?? true;
  const pad = opts.mouthPad ?? 24;
  const lim = zone.r - radius - 8;
  if (lim <= 0) return null;
  for (let t = 0; t < tries; t++) {
    let x: number, z: number;
    if (opts.near) {
      const a = rand() * Math.PI * 2;
      const d0 = opts.minDist ?? 0, d1 = opts.maxDist ?? 30;
      const d = d0 + (d1 - d0) * Math.sqrt(rand());
      x = opts.near.x + Math.cos(a) * d;
      z = opts.near.z + Math.sin(a) * d;
    } else {
      const a = rand() * Math.PI * 2;
      const d0 = Math.min(lim, opts.minDist ?? 0), d1 = Math.min(lim, opts.maxDist ?? lim);
      const d = Math.sqrt(d0 * d0 + (d1 * d1 - d0 * d0) * rand());
      x = zone.cx + Math.cos(a) * d;
      z = zone.cz + Math.sin(a) * d;
    }
    if (Math.hypot(x - zone.cx, z - zone.cz) > lim) continue;
    if (zone.mouths.some((m) => Math.hypot(m.x - x, m.z - z) < radius + pad)) continue;
    const hit = anchorsNear(zone, x, z, radius + 40, (a) => {
      if (FOLIAGE.has(a.kind)) return false;
      if (!strict && SMALL_SCATTER.has(a.kind)) return false;
      if (a.kind === 'oasisPool') return Math.hypot(a.x - x, a.z - z) < radius + (a.data?.r ?? 9) * 1.5;
      return Math.hypot(a.x - x, a.z - z) < radius + footprintOf(a);
    });
    if (hit) continue;
    const h0 = field.heightAt(x, z);
    let ok = !dry || h0 > field.waterLevel + 0.3;
    for (let i = 0; i < 8 && ok; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = field.heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
      if (Math.abs(h - h0) > radius * maxSlope + 0.4) ok = false;
      if (dry && h < field.waterLevel + 0.3) ok = false;
    }
    if (!ok) continue;
    return { x, z, y: h0 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reserved room for other systems: herds and dens (wildlife), the sand-pit cave entrance,
// the oasis boss arena (oasisheart, placed by its theme) and treasure dig spots.
const HABITAT: Partial<Record<ThemeId, string>> = { palmshore: 'oasis', marsh: 'oasis', floodruins: 'oasis', lotustemple: 'oasis', oasisheart: 'oasis', canyon: 'rocks', mesas: 'rocks', bones: 'bones', hollows: 'bones' };
const CAVE_ZONES: Record<'A' | 'B' | 'C', ThemeId[]> = { A: ['bones', 'hollows'], B: ['lotustemple'], C: ['pyramidbase'] };
function reserveSpots(ctx: ThemeCtx, zn: ZoneDef) {
  const { rng, field } = ctx;
  const rand = () => rng.next();
  if (zn.theme === 'arena' || zn.theme === 'apex' || zn.theme === 'oasisheart') return;
  if (CAVE_ZONES[ctx.spec.key].includes(zn.theme)) {
    const p = findOpenSpot(zn, field, 12, { rand, minDist: zn.r * 0.3, maxDist: zn.r * 0.7, maxSlope: 0.22, strict: false, mouthPad: 40 });
    if (p) {
      clearSmall(zn, p.x, p.z, 13);
      zn.anchors.push({ kind: 'cavePit', x: p.x, z: p.z, rot: rng.range(0, Math.PI * 2), data: { r: 12, y: p.y } });
    }
  }
  for (let i = 0; i < 2; i++) {
    const p = findOpenSpot(zn, field, 16, { rand, minDist: zn.r * 0.25, maxDist: zn.r * 0.85, maxSlope: 0.3, strict: false });
    if (!p) continue;
    zn.anchors.push({ kind: 'wildlifeSpot', x: p.x, z: p.z, data: { r: 16, habitat: HABITAT[zn.theme] ?? 'dunes', y: p.y } });
  }
}

function digSpots(ctx: ThemeCtx, zn: ZoneDef) {
  const { rng, field } = ctx;
  const rand = () => rng.next();
  const sights = zn.pois.filter((p) => p.kind !== 'arena');
  let n = 0;
  for (let i = 0; i < 2 && sights.length; i++) {
    const s = rng.pick(sights);
    const p = findOpenSpot(zn, field, 2.5, { rand, near: s, minDist: s.r * 0.4, maxDist: s.r + 14, maxSlope: 0.45, strict: true, tries: 40 });
    if (p) {
      zn.anchors.push({ kind: 'digSpot', x: p.x, z: p.z, data: { r: 2.5, near: s.name, y: p.y } });
      n++;
    }
  }
  for (let i = 0; n < 4 && i < 6; i++) {
    const p = findOpenSpot(zn, field, 2.5, { rand, maxSlope: 0.45, tries: 40 });
    if (p) {
      zn.anchors.push({ kind: 'digSpot', x: p.x, z: p.z, data: { r: 2.5, y: p.y } });
      n++;
    }
  }
}

// ---------------------------------------------------------------------------
// A dry riverbed: a sinuous cracked-mud channel cutting across the zone off-centre, with
// soft banks, boulders and dead brush along it (riverMarks keep the set pieces off it).
const RIVER_THEMES = new Set<ThemeId>(['flats', 'bones', 'hollows', 'stormapproach', 'pyramidbase', 'glassdunes']);
function riverbed(ctx: ThemeCtx, zn: ZoneDef) {
  const { rng, field, noise } = ctx;
  const R = zn.r;
  // a chord through the zone that stays clear of its heart
  const a0 = rng.range(0, Math.PI * 2);
  const off = R * rng.range(0.32, 0.55) * (rng.chance(0.5) ? 1 : -1);
  const ux = Math.cos(a0), uz = Math.sin(a0), nx = -uz, nz = ux;
  const half = Math.sqrt(Math.max(0, (R + 20) ** 2 - off * off));
  const pts: { x: number; z: number }[] = [];
  const ph = rng.range(0, 10);
  for (let t = -half; t <= half; t += 6) {
    const s = off + Math.sin(t * 0.03 + ph) * 14 + Math.sin(t * 0.071 + ph * 2) * 6;
    pts.push({ x: zn.cx + ux * t + nx * s, z: zn.cz + uz * t + nz * s });
  }
  // never through a corridor mouth or the start camp
  const keepOut = (x: number, z: number) => {
    let k = 1;
    for (const m of zn.mouths) k = Math.min(k, smoothstep(26, 46, Math.hypot(m.x - x, m.z - z)));
    if (zn.index === 0) k = Math.min(k, smoothstep(24, 44, Math.hypot(zn.cx - x, zn.cz - R * 0.45 - z)));
    return k;
  };
  if (blocked(zn, zn.cx + nx * off, zn.cz + nz * off, 6)) return;
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z);
  }
  const bedY = avgBase(field, zn.cx + nx * off, zn.cz + nz * off, R * 0.3) - 2.6;
  const pf = polyField(field, pts, 19);
  const pd = { d: 0, along: 0 };
  forRect(field, x0 - 20, z0 - 20, x1 + 20, z1 + 20, (k, x, z) => {
    const { d, along } = pf.at(k, pd);
    if (d > 18) return;
    const inZone = smoothstep(R + 14, R - 4, Math.hypot(x - zn.cx, z - zn.cz));
    const ko = keepOut(x, z) * inZone;
    if (ko <= 0) return;
    const hw = 6 + 2.5 * noise.n2(along * 0.15, 4.1) + 2 * noise.n2(along * 0.05, 1.3);
    const bank = smoothstep(hw + 7, hw, d);
    const floorK = smoothstep(hw, hw - 2.5, d);
    const target = Math.min(field.base[k], bedY + noise.n2(x * 0.06, z * 0.06) * 0.25 + (1 - floorK) * 1.2);
    field.base[k] = lerp(field.base[k], target, bank * ko);
    if (ko > 0.5) {
      if (floorK > 0.4) field.baseMat[k] = noise.n2(x * 0.3, z * 0.3) > -0.25 ? MAT.DIRT : MAT.MUD;
      else if (bank > 0.3) field.baseMat[k] = MAT.SAND_DARK;
    }
  });
  // keep the set pieces off the channel; dress the banks
  for (let i = 0; i < pts.length; i += 2) {
    const p = pts[i];
    if (Math.hypot(p.x - zn.cx, p.z - zn.cz) > R - 4 || keepOut(p.x, p.z) < 0.5) continue;
    clearSmall(zn, p.x, p.z, 8);
    zn.anchors.push({ kind: 'riverMark', x: p.x, z: p.z, data: { r: 10 } });
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    if (Math.hypot(p.x - zn.cx, p.z - zn.cz) > R - 6 || keepOut(p.x, p.z) < 0.9) continue;
    const q = pts[i + 1];
    const tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1;
    for (const side of [-1, 1]) {
      if (!rng.chance(0.55)) continue;
      const o = rng.range(8, 13);
      const bx = p.x + (-tz / tl) * o * side, bz = p.z + (tx / tl) * o * side;
      const kind = rng.pick(['deadBush', 'deadBush', 'rock', 'boulder', 'dryGrass', 'skull', 'cactus']);
      zn.anchors.push({ kind, x: bx, z: bz, rot: rng.range(0, 6.28), scale: rng.range(0.8, 1.2) });
    }
    if (rng.chance(0.08)) zn.anchors.push({ kind: rng.pick(['wagonWheel', 'boneScatter', 'rock']), x: p.x + rng.range(-2, 2), z: p.z + rng.range(-2, 2), rot: rng.range(0, 6.28) });
  }
  const mid = pts[pts.length >> 1];
  zn.pois.push({ kind: 'riverbed', name: rng.pick(['Dry Creek', 'Dead Man\'s Wash', 'Old River', 'Rattler Wash']), x: mid.x, z: mid.z, r: 10, data: { path: pts.filter((_, i) => i % 3 === 0).map((p) => ({ x: p.x, z: p.z })) } });
}

// ---------------------------------------------------------------------------
// The wild sights. Placed by best-candidate sampling so they spread right across the zone
// (60-110 m apart: 6-12 s of riding at cruise between them), then each sculpts its own ground.
type PoiKind = 'arch' | 'colossus' | 'shipwreck' | 'bonefield' | 'mesa' | 'viewpoint' | 'camp' | 'shrine' | 'duneramps';
const POI_R: Record<PoiKind, number> = { arch: 16, colossus: 16, shipwreck: 15, bonefield: 22, mesa: 30, viewpoint: 24, camp: 14, shrine: 10, duneramps: 34 };
const POI_NAMES: Record<PoiKind, string[]> = {
  arch: ["Devil's Arch", "The Needle's Eye", 'Windgate Arch', 'Sunbridge', 'The Keyhole'],
  colossus: ['The Fallen King', 'Ozymandias', 'The Shattered Colossus', 'Feet of the Pharaoh'],
  shipwreck: ['The Sand Galleon', 'Wreck of the Esperanza', 'The Dry Dock', 'Ghost Ship'],
  bonefield: ['The Boneyard', 'Field of Giants', 'Leviathan Bones', 'The Ossuary Flats'],
  mesa: ['Lone Mesa', 'Table Rock', 'Hawk Mesa', 'Anvil Rock'],
  viewpoint: ['Lookout Knob', "Buzzard's Roost", "Prospector's Peak", 'Sunset Point'],
  camp: ['Outlaw Camp', 'Nomad Camp', "Drifters' Fire", 'Smugglers\' Rest'],
  shrine: ['Shrine of Bastet', 'Whispering Shrine', 'Shrine of the Jackal', 'Moon Shrine'],
  duneramps: ['The Ramps', 'Kicker Dunes', 'Rollercoaster Dunes', 'Sky Jumps'],
};
const THEME_POIS: Record<ThemeId, PoiKind[]> = {
  flats: ['camp', 'shrine', 'arch', 'shipwreck', 'viewpoint', 'duneramps'],
  canyon: ['arch', 'viewpoint', 'shrine', 'camp', 'arch'],
  bones: ['bonefield', 'colossus', 'shrine', 'camp', 'viewpoint', 'bonefield'],
  temple: ['colossus', 'shrine', 'arch', 'duneramps', 'camp'],
  outpost: ['camp', 'shipwreck', 'viewpoint', 'mesa', 'shrine'],
  glassdunes: ['duneramps', 'shipwreck', 'arch', 'bonefield', 'viewpoint', 'duneramps'],
  hollows: ['bonefield', 'shrine', 'arch', 'camp', 'mesa'],
  obelisks: ['colossus', 'shrine', 'viewpoint', 'arch', 'camp'],
  mesas: ['arch', 'viewpoint', 'camp', 'shipwreck', 'mesa'],
  arena: [],
  palmshore: ['shipwreck', 'camp', 'shrine', 'viewpoint', 'arch'],
  marsh: ['shrine', 'camp', 'colossus', 'bonefield'],
  floodruins: ['colossus', 'shrine', 'camp', 'shipwreck'],
  lotustemple: ['colossus', 'shrine', 'arch', 'camp'],
  oasisheart: [],
  stormapproach: ['shipwreck', 'colossus', 'bonefield', 'duneramps', 'viewpoint'],
  sphinxavenue: ['colossus', 'shrine', 'arch', 'camp'],
  pyramidbase: ['colossus', 'shrine', 'camp', 'bonefield', 'viewpoint'],
  pyramidterraces: ['shrine', 'viewpoint', 'camp'],
  apex: [],
};

function placePois(ctx: ThemeCtx, zn: ZoneDef) {
  const { rng, field } = ctx;
  const list = THEME_POIS[zn.theme];
  if (!list.length) return;
  const n = clamp(Math.round((Math.PI * zn.r * zn.r) / 10000), 3, 7);
  const startZ = zn.cz - zn.r * 0.45;
  const used = new Set<string>();
  for (let i = 0; i < n; i++) {
    const kind = list[i % list.length];
    const pr = POI_R[kind];
    let best: { x: number; z: number } | null = null;
    let bestScore = -1;
    for (let t = 0; t < 48; t++) {
      const a = rng.range(0, Math.PI * 2);
      const lim = zn.r - pr - 10;
      const d = Math.sqrt(rng.next()) * lim;
      const x = zn.cx + Math.cos(a) * d, z = zn.cz + Math.sin(a) * d;
      if (zn.mouths.some((m) => Math.hypot(m.x - x, m.z - z) < pr + 30)) continue;
      if (zn.index === 0 && Math.hypot(x - zn.cx, z - startZ) < pr + 26) continue;
      if (blocked(zn, x, z, pr, 2)) continue;
      // dry ground under the middle and the edge
      let wet = false;
      for (let k = 0; k < 7 && !wet; k++) {
        const aa = (k / 6) * Math.PI * 2, rr = k === 6 ? 0 : pr * 0.7;
        if (field.heightAt(x + Math.cos(aa) * rr, z + Math.sin(aa) * rr) < field.waterLevel + 0.4) wet = true;
      }
      if (wet && kind !== 'colossus') continue;
      // spread: the furthest from every other sight wins
      let score = 1e9;
      for (const p of zn.pois) score = Math.min(score, Math.hypot(p.x - x, p.z - z) - p.r - pr);
      score = Math.min(score, 200);
      if (score < 18) continue;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
    if (!best) continue;
    const names = POI_NAMES[kind].filter((s) => !used.has(s));
    const name = rng.pick(names.length ? names : POI_NAMES[kind]);
    used.add(name);
    clearSmall(zn, best.x, best.z, pr);
    const poi: Poi = { kind, name, x: best.x, z: best.z, r: pr };
    buildPoi(ctx, zn, poi);
    zn.pois.push(poi);
    zn.anchors.push({ kind: 'poiMark', x: best.x, z: best.z, data: { r: pr, poi: kind } });
  }
}

function buildPoi(ctx: ThemeCtx, zn: ZoneDef, p: Poi) {
  const { rng, field, noise } = ctx;
  const { x, z } = p;
  const at = (d: number, a: number) => ({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d });
  const windRot = Math.atan2(-ctx.wind.z, ctx.wind.x);
  switch (p.kind as PoiKind) {
    case 'arch': {
      // a natural sandstone arch, its span across the wind (you ride under it)
      const rot = windRot + Math.PI / 2 + rng.range(-0.4, 0.4);
      zn.anchors.push({ kind: 'rockArch', x, z, rot, scale: rng.range(0.92, 1.12), data: { variant: rng.int(0, 2) } });
      for (let i = 0; i < 5; i++) {
        const q = at(rng.range(10, 15), rng.range(0, Math.PI * 2));
        zn.anchors.push({ kind: rng.chance(0.4) ? 'boulder' : 'rock', x: q.x, z: q.z, rot: rng.range(0, 6.28), scale: rng.range(0.8, 1.3) });
      }
      for (let i = 0; i < 8; i++) {
        const q = at(rng.range(6, 15), rng.range(0, Math.PI * 2));
        zn.anchors.push({ kind: rng.chance(0.5) ? 'deadBush' : 'dryGrass', x: q.x, z: q.z, rot: rng.range(0, 6.28) });
      }
      p.data = { rot };
      break;
    }
    case 'colossus': {
      // "two vast and trunkless legs of stone"; near them, half sunk, a shattered visage
      const rot = rng.range(0, Math.PI * 2);
      flattenDisc(field, x, z, 8, 0.7, -1, noise);
      zn.anchors.push({ kind: 'colossusLegs', x, z, rot, scale: rng.range(0.95, 1.1) });
      const ha = rot + rng.range(0.6, 1.4) * (rng.chance(0.5) ? 1 : -1);
      const h = at(11.5, ha);
      zn.anchors.push({ kind: 'colossusHead', x: h.x, z: h.z, rot: rng.range(0, Math.PI * 2), scale: rng.range(0.95, 1.1) });
      for (let i = 0; i < 3; i++) {
        const q = at(rng.range(9, 15), rng.range(0, Math.PI * 2));
        if (Math.hypot(q.x - h.x, q.z - h.z) < 7) continue;
        zn.anchors.push({ kind: rng.pick(['obeliskBroken', 'ruinWall', 'boneScatter', 'rock']), x: q.x, z: q.z, rot: rng.range(0, 6.28) });
      }
      p.data = { rot, head: h };
      break;
    }
    case 'shipwreck': {
      const rot = rng.range(0, Math.PI * 2);
      flattenDisc(field, x, z, 10, 0.6, -1, noise);
      zn.anchors.push({ kind: 'shipwreck', x, z, rot, scale: 1, data: { variant: rng.int(0, 1) } });
      // its spilled cargo, and the captain's chest by the hull
      for (let i = 0; i < 9; i++) {
        const q = at(rng.range(9, 15), rot + rng.range(-1.2, 1.2) + (i % 2 ? Math.PI : 0));
        zn.anchors.push({ kind: rng.pick(['plankDebris', 'plankDebris', 'barrel', 'crate', 'whiskeyBarrel', 'skull']), x: q.x, z: q.z, rot: rng.range(0, 6.28) });
      }
      const c = at(9.5, rot + Math.PI / 2);
      zn.anchors.push({ kind: 'chest', x: c.x, z: c.z, rot: rot + Math.PI });
      p.data = { rot };
      break;
    }
    case 'bonefield': {
      forRect(field, x - p.r - 4, z - p.r - 4, x + p.r + 4, z + p.r + 4, (k, px, pz) => {
        const d = Math.hypot(px - x, pz - z) / p.r;
        if (d < 0.95 && noise.n2(px * 0.07, pz * 0.07) > 0.25 - d * 0.4) field.baseMat[k] = MAT.BONE;
      });
      const rot = rng.range(0, Math.PI * 2);
      zn.anchors.push({ kind: 'giantSkull', x, z, rot, scale: rng.range(1, 1.25) });
      for (let i = 0; i < 2; i++) {
        const q = at(rng.range(9, 14), rot + Math.PI + (i - 0.5) * 0.7);
        zn.anchors.push({ kind: 'ribArch', x: q.x, z: q.z, rot: rot + rng.range(-0.3, 0.3), scale: rng.range(0.85, 1.1) });
      }
      for (let i = 0; i < 10; i++) {
        const q = at(rng.range(4, p.r), rng.range(0, Math.PI * 2));
        zn.anchors.push({ kind: rng.pick(['boneScatter', 'boneScatter', 'skull', 'cattleSkullPost']), x: q.x, z: q.z, rot: rng.range(0, 6.28) });
      }
      break;
    }
    case 'mesa':
    case 'viewpoint': {
      // a lone plateau (wide, climb the ramp for the chest) or a tall knoll with a cairn on top (look out over the zone)
      const view = p.kind === 'viewpoint';
      const r = view ? 7 : rng.range(13, 17);
      const g = avgBase(field, x, z, r);
      const H = view ? rng.range(15, 19) : rng.range(9, 13);
      const top = g + H;
      const foot = view ? 20 : r + 6;
      forRect(field, x - foot - 6, z - foot - 6, x + foot + 6, z + foot + 6, (k, px, pz) => {
        const d = Math.hypot(px - x, pz - z);
        const wob = noise.n2(px * 0.09, pz * 0.09) * (view ? 1.2 : 2.2);
        let h: number;
        if (view) {
          // knoll: concave flanks rising to a small flat crown
          const t = clamp((foot - d + wob) / (foot - r), 0, 1);
          h = g + H * Math.pow(smoothstep(0, 1, t), 1.6);
        } else {
          const m = smoothstep(r + 2.5 + wob, r - 1 + wob, d);
          h = lerp(g, top + Math.floor((noise.n2(px * 0.05, pz * 0.05) * 0.5 + 0.5) * 2) * 0.8, m);
        }
        if (h > field.base[k]) {
          field.base[k] = h;
          const steep = view ? d > r + 1 : d > r - 1.5 && d < r + 3;
          if (steep) field.baseMat[k] = MAT.ROCK;
        }
      });
      rampUp(field, rng.range(0, Math.PI * 2), x, z, r, top, view ? H * 2.2 : H * 2 + 6, 5);
      const cairn = view ? { x, z } : at(r * 0.4, rng.range(0, Math.PI * 2));
      zn.anchors.push({ kind: 'cairn', x: cairn.x, z: cairn.z, rot: rng.range(0, 6.28), scale: 1 });
      if (!view) {
        const c = at(r * 0.45, rng.range(0, Math.PI * 2));
        zn.anchors.push({ kind: 'chest', x: c.x, z: c.z, rot: rng.range(0, 6.28) });
        for (let i = 0; i < 4; i++) {
          const q = at(rng.range(2, r - 3), rng.range(0, Math.PI * 2));
          zn.anchors.push({ kind: rng.pick(['rock', 'deadBush', 'cactus', 'dryGrass']), x: q.x, z: q.z, rot: rng.range(0, 6.28) });
        }
      } else zn.anchors.push({ kind: 'viewpoint', x, z, data: { r: 4, top } });
      p.data = { top, r };
      break;
    }
    case 'camp': {
      if (rng.chance(0.5)) {
        p.name = p.name === 'Nomad Camp' ? 'Outlaw Camp' : p.name;
        outlawCamp(ctx, zn, x, z);
      } else {
        // a nomad camp: tents round a fire, a rug with pots, a trough and a water well
        flattenDisc(field, x, z, 9, 0.8, MAT.DIRT, noise);
        zn.anchors.push({ kind: 'campfire', x, z, rot: 0 });
        const n = 3;
        const a0 = rng.range(0, Math.PI * 2);
        for (let i = 0; i < n; i++) {
          const a = a0 + (i / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
          zn.anchors.push({ kind: 'tent', ...at(7.5, a), rot: a + Math.PI });
        }
        const ra = a0 + Math.PI / 3;
        zn.anchors.push({ kind: 'rug', ...at(3.6, ra), rot: ra + Math.PI / 2 });
        for (let i = 0; i < 4; i++) zn.anchors.push({ kind: 'pot', ...at(rng.range(2.5, 5), ra + rng.range(-0.6, 0.6)), rot: rng.range(0, 6.28), scale: rng.range(0.8, 1.05) });
        zn.anchors.push({ kind: 'well', ...at(11, a0 + Math.PI), rot: 0 });
        zn.anchors.push({ kind: 'trough', ...at(12.5, a0 + Math.PI + 0.35), rot: a0 });
        for (let i = 0; i < 3; i++) zn.anchors.push({ kind: rng.pick(['crate', 'barrel']), ...at(rng.range(9, 12), rng.range(0, Math.PI * 2)), rot: rng.range(0, 6.28) });
      }
      break;
    }
    case 'shrine': {
      const rot = Math.atan2(zn.cz - z, zn.cx - x) - Math.PI / 2 + rng.range(-0.5, 0.5);
      flattenDisc(field, x, z, 6.5, 0.9, MAT.TILE, noise);
      zn.anchors.push({ kind: 'shrine', x, z, rot, scale: 1, data: { variant: rng.int(0, 2) } });
      for (const s of [-1, 1]) {
        const q = at(7.5, rot + Math.PI / 2 + s * 0.55);
        zn.anchors.push({ kind: 'column', x: q.x, z: q.z, rot, data: { broken: rng.chance(0.7) } });
      }
      for (let i = 0; i < 3; i++) zn.anchors.push({ kind: 'pot', ...at(rng.range(4.5, 6.5), rot + Math.PI / 2 + rng.range(-1, 1)), rot: rng.range(0, 6.28), scale: rng.range(0.75, 1) });
      p.data = { rot };
      break;
    }
    case 'duneramps': {
      // a line of wind-carved kicker dunes: long windward run-ups, steep lips, soft landings
      const dir = rng.range(0, Math.PI * 2);
      const dx = Math.cos(dir), dz = Math.sin(dir);
      const kick = [-18, 2, 22].map((a) => a + rng.range(-2, 2));
      const H = kick.map(() => rng.range(3.2, 4.8));
      forRect(field, x - p.r - 6, z - p.r - 6, x + p.r + 6, z + p.r + 6, (k, px, pz) => {
        const ox = px - x, oz = pz - z;
        const along = ox * dx + oz * dz, lat = ox * -dz + oz * dx;
        const latK = smoothstep(11, 6, Math.abs(lat + Math.sin(along * 0.08) * 2));
        if (latK <= 0) return;
        let h = 0;
        for (let i = 0; i < kick.length; i++) {
          const a = along - kick[i];
          if (a > -16 && a <= 0) h = Math.max(h, H[i] * Math.pow((a + 16) / 16, 1.7));
          else if (a > 0 && a < 7) h = Math.max(h, H[i] * (1 - smoothstep(0, 7, a)) * 0.92);
        }
        if (h <= 0) return;
        field.base[k] += h * latK;
        if (latK > 0.6 && h > 1) field.baseMat[k] = MAT.SAND;
      });
      zn.anchors.push({ kind: 'duneRamp', x, z, rot: dir, data: { r: p.r, kickers: kick.map((a) => ({ x: x + dx * a, z: z + dz * a })) } });
      zn.anchors.push({ kind: 'signpost', ...at(16, dir + Math.PI * 0.6), rot: dir });
      p.data = { dir };
      break;
    }
  }
}

/** scatter that a set piece may clear away from its footprint */
const SMALL_SCATTER = new Set(['cactus', 'bush', 'tumbleweed', 'deadBush', 'dryGrass', 'rock', 'boulder', 'ore', 'pot', 'boneScatter', 'skull', 'palm', 'reeds', 'obeliskBroken', 'mineCart', 'tntCrate', 'ruinWall', 'chest', 'crate', 'barrel', 'whiskeyBarrel', 'fence', 'fenceBroken', 'signpost', 'hitchingPost', 'wagonWheel', 'cattleSkullPost']);

/** corridor mouths of a zone (keep set pieces off the way in and out) */
function mouths(ctx: ThemeCtx, zn: ZoneDef) {
  const out: { x: number; z: number }[] = [];
  if (zn.corridor) out.push({ x: zn.corridor.bx, z: zn.corridor.bz });
  const nx = ctx.zones[zn.index + 1]?.corridor;
  if (nx) out.push({ x: nx.ax, z: nx.az });
  return out;
}

/**
 * A lush oasis: a sunken pool with a wobbly shoreline (local water in the dry
 * sub-areas, the sea level where there is one), mud under the water, a ring of
 * green bank and damp dark sand, reeds and cattails at the waterline, lily pads,
 * palms and flowering shrubs on the bank, and a resting spot with a drinking place.
 */
function placeOasis(ctx: ThemeCtx, zn: ZoneDef, R: number) {
  const { rng, field, noise } = ctx;
  const half = R * 1.6;
  const mo = mouths(ctx, zn);
  const startZ = zn.cz - zn.r * 0.45;
  let best: { x: number; z: number } | null = null;
  let bestSoft = 1e9;
  for (let k = 0; k < 90; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(zn.r * 0.2, Math.max(zn.r * 0.25, zn.r - half - 4));
    const x = zn.cx + Math.cos(a) * r, z = zn.cz + Math.sin(a) * r;
    if (mo.some((m) => Math.hypot(m.x - x, m.z - z) < half + 10)) continue;
    if (zn.index === 0 && Math.hypot(x - zn.cx, z - startZ) < half + 8) continue;
    if (blocked(zn, x, z, half + 2)) continue;
    let hard = 0, soft = 0;
    for (const o of zn.anchors) {
      if (Math.hypot(o.x - x, o.z - z) >= half + 3) continue;
      if (SMALL_SCATTER.has(o.kind)) soft++;
      else hard++;
    }
    if (hard > 0 || soft >= bestSoft) continue;
    best = { x, z };
    bestSoft = soft;
    if (soft < 4) break;
  }
  if (!best) return;
  const { x, z } = best;
  zn.anchors = zn.anchors.filter((o) => Math.hypot(o.x - x, o.z - z) >= half + 2 || !SMALL_SCATTER.has(o.kind));
  const ground = avgBase(field, x, z, R);
  const sea = ctx.spec.water;
  const level = sea > -100 && ground - 0.7 < sea + 0.3 ? sea : ground - 0.7;
  const shore = (px: number, pz: number) => {
    const ang = Math.atan2(pz - z, px - x);
    const wob = 1 + 0.16 * noise.n2(Math.cos(ang) * 1.3 + x * 0.01, Math.sin(ang) * 1.3 + z * 0.01) + 0.06 * noise.n2(px * 0.15, pz * 0.15);
    return Math.hypot(px - x, pz - z) / (R * wob);
  };
  forRect(field, x - half - 10, z - half - 10, x + half + 10, z + half + 10, (k, px, pz) => {
    const d = shore(px, pz);
    if (d > 1.8) return;
    let h: number;
    if (d < 1) h = level - 0.65 * Math.pow(1 - d * d, 0.6) - 0.06;
    else if (d < 1.35) h = level + 0.12 + ((d - 1) / 0.35) * 0.38;
    else h = lerp(level + 0.5, field.base[k], smoothstep(1.35, 1.8, d));
    field.base[k] = h;
    const n = noise.n2(px * 0.2, pz * 0.2) * 0.08;
    if (d < 0.97) field.baseMat[k] = MAT.MUD;
    else if (d < 1.3 + n) field.baseMat[k] = MAT.GRASS;
    else if (d < 1.62 + n) field.baseMat[k] = MAT.SAND_DARK;
  });
  const at = (d: number, a: number) => ({ x: x + Math.cos(a) * R * d, z: z + Math.sin(a) * R * d });
  // the resting spot faces the water from the side away from the zone centre's bustle
  const restA = Math.atan2(z - zn.cz, x - zn.cx) + rng.range(-0.6, 0.6);
  const rest = at(1.42, restA), drink = at(1.02, restA + 0.25);
  zn.anchors.push({ kind: 'oasisPool', x, z, data: { r: R, level, rest: { ...rest, rot: restA + Math.PI }, drink } });
  zn.pois.push({ kind: 'oasis', name: 'Oasis', x, z, r: half, data: { level } });
  // hard markers keep the scatter / set pieces out of the water
  for (let i = 0; i < 9; i++) zn.anchors.push({ kind: 'oasisMark', ...(i === 0 ? { x, z } : at(0.65, (i / 8) * Math.PI * 2)) });
  zn.anchors.push({ kind: 'rug', ...rest, rot: restA + Math.PI / 2 });
  const ring = (kind: string, n: number, d0: number, d1: number, extra?: (a: Anchor) => void) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
      if (Math.abs(((a - restA + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.32 && kind !== 'palm') continue; // keep the resting spot open
      const p = at(rng.range(d0, d1), a);
      const an: Anchor = { kind, x: p.x, z: p.z, rot: rng.range(0, Math.PI * 2), scale: rng.range(0.85, 1.2) };
      extra?.(an);
      zn.anchors.push(an);
    }
  };
  ring('palm', 7 + rng.int(0, 2), 1.08, 1.45, (a) => (a.scale = rng.range(0.95, 1.35)));
  ring('oasisReeds', 13, 0.84, 1.04);
  ring('oasisFlowers', 8, 1.16, 1.55);
  ring('lilyPads', 4, 0.25, 0.7, (a) => (a.data = { y: level - 0.02 }));
  ring('rock', 3, 1.0, 1.15, (a) => (a.scale = rng.range(0.5, 0.8)));
}

/**
 * A ghost town: 2-4 ruined buildings (shacks and a false-front saloon / sheriff /
 * store) facing each other across a short dirt street, with broken fences,
 * hitching posts and a leaning signpost.
 */
function ghostTown(ctx: ThemeCtx, zn: ZoneDef) {
  const { rng, field, noise } = ctx;
  const mo = mouths(ctx, zn);
  const startZ = zn.cz - zn.r * 0.45;
  for (let k = 0; k < 70; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(zn.r * 0.25, zn.r * 0.72);
    const x = zn.cx + Math.cos(a) * r, z = zn.cz + Math.sin(a) * r;
    const dir = rng.range(0, Math.PI);
    const ux = Math.cos(dir), uz = Math.sin(dir), nx = -uz, nz = ux;
    const n = 2 + rng.int(0, 2);
    const lots: { x: number; z: number; side: number }[] = [];
    for (let i = 0; i < n; i++) {
      const along = (i - (n - 1) / 2) * 10.5 + rng.range(-1, 1);
      const side = i % 2 ? 1 : -1;
      lots.push({ x: x + ux * along + nx * side * 7, z: z + uz * along + nz * side * 7, side });
    }
    if (lots.some((l) => Math.hypot(l.x - zn.cx, l.z - zn.cz) > zn.r - 8)) continue;
    if (lots.some((l) => mo.some((m) => Math.hypot(m.x - l.x, m.z - l.z) < 18))) continue;
    if (zn.index === 0 && lots.some((l) => Math.hypot(l.x - zn.cx, l.z - startZ) < 16)) continue;
    if (lots.some((l) => blocked(zn, l.x, l.z, 7))) continue;
    for (const l of lots) {
      zn.anchors = zn.anchors.filter((o) => Math.hypot(o.x - l.x, o.z - l.z) >= 8 || !SMALL_SCATTER.has(o.kind));
      flattenDisc(field, l.x, l.z, 5.5, 0.8, MAT.DIRT, noise);
    }
    zn.pois.push({ kind: 'ghostTown', name: rng.pick(['Ghost Town', 'Dry Gulch', 'Tombstone Row', 'Last Chance']), x, z, r: n * 5.5 + 8, data: { dir } });
    zn.anchors.push({ kind: 'poiMark', x, z, data: { r: n * 5.5 + 6 } });
    const fronts = rng.shuffle(['saloonFacade', 'sheriffFacade', 'storeFacade']);
    lots.forEach((l, i) => {
      // front (+Z) faces the street
      const rot = Math.atan2(-nx * l.side, -nz * l.side);
      zn.anchors.push({ kind: i === 1 ? fronts[0] : i === 3 ? fronts[1] : 'shack', x: l.x, z: l.z, rot, scale: 1 });
    });
    // the street's leftovers
    for (let i = 0; i < 4; i++) {
      const along = rng.range(-1, 1) * n * 5, side = rng.chance(0.5) ? 1 : -1;
      const px = x + ux * along + nx * side * 2.6, pz = z + uz * along + nz * side * 2.6;
      zn.anchors.push({ kind: rng.pick(['hitchingPost', 'fenceBroken', 'wagonWheel', 'whiskeyBarrel', 'signpost']), x: px, z: pz, rot: dir + rng.range(-0.3, 0.3) });
    }
    return;
  }
}

/**
 * 2-3 tall ruined lookout towers per zone, spread out, off the corridor mouths,
 * on a small levelled pad.
 */
function placeOutposts(ctx: ThemeCtx, zn: ZoneDef) {
  const { rng, field, noise } = ctx;
  const n = 2 + (rng.chance(0.4) ? 1 : 0);
  const mo = mouths(ctx, zn);
  const placed: { x: number; z: number }[] = [];
  const first = rng.int(0, 1);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 60; k++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(zn.r * 0.42, zn.r * 0.86);
      const x = zn.cx + Math.cos(a) * r, z = zn.cz + Math.sin(a) * r;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 48)) continue;
      if (mo.some((m) => Math.hypot(m.x - x, m.z - z) < 20)) continue;
      if (blocked(zn, x, z, 7, 2)) continue;
      zn.anchors = zn.anchors.filter((o) => Math.hypot(o.x - x, o.z - z) >= 5.5 || !SMALL_SCATTER.has(o.kind));
      flattenDisc(field, x, z, 4.5, 0.85, MAT.DIRT, noise);
      zn.anchors.push({ kind: 'outpost', x, z, rot: rng.range(0, Math.PI * 2), scale: 1, data: { variant: (first + i) % 2 } });
      zn.pois.push({ kind: 'tower', name: 'Lookout Tower', x, z, r: 7 });
      placed.push({ x, z });
      break;
    }
  }
}

export type LandmarkType = 'tradingPost' | 'outlawFort' | 'mineHeadframe' | 'ranchBarn' | 'sheriffOffice' | 'saloon';
export const LANDMARK_INFO: Record<LandmarkType, { name: string; size: [number, number]; mission: string }> = {
  tradingPost: { name: 'Trading Post', size: [12, 12], mission: 'merchant' },
  outlawFort: { name: 'Outlaw Fort', size: [34, 30], mission: 'clearFort' },
  mineHeadframe: { name: 'Abandoned Mine', size: [16, 16], mission: 'mining' },
  ranchBarn: { name: 'Dusty Ranch', size: [24, 18], mission: 'camelRescue' },
  sheriffOffice: { name: "Sheriff's Office", size: [16, 12], mission: 'alphaHunt' },
  saloon: { name: 'Last Chance Saloon', size: [20, 16], mission: 'cardGame' },
};

function placeLandmark(ctx: ThemeCtx, zn: ZoneDef, type: LandmarkType) {
  const { rng, field, noise } = ctx;
  const info = LANDMARK_INFO[type];
  const R = zn.r;
  const half = Math.max(info.size[0], info.size[1]) * 0.5 + 4;
  // small scatter may be cleared away for the building; set pieces may not
  const SMALL = { has: (k: string) => SMALL_SCATTER.has(k) || FOLIAGE.has(k) };
  let best: { x: number; z: number } | null = null;
  let bestSoft = 1e9;
  // where to look: the first zone's trading post (the run's first shop) goes within sight of the
  // start, ahead of the rider (36-72 m, its smoke and lanterns lead him in); a trading post that
  // finds no room looks wider before giving up (every run needs its shop)
  const ring = (cx: number, cz: number, a0: number, a1: number, r0: number, r1: number) => () => {
    const a = rng.range(a0, a1), r = rng.range(r0, r1);
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  };
  const phases: { n: number; mouth: number; at: () => number[] }[] = [];
  if (type === 'tradingPost' && zn.index === 0) phases.push({ n: 90, mouth: half + 22, at: ring(zn.cx, zn.cz - zn.r * 0.45, -1.05, 1.05, 36, 72) });
  phases.push({ n: 120, mouth: half + 22, at: ring(zn.cx, zn.cz, 0, Math.PI * 2, R * 0.4, R * 0.74) });
  if (type === 'tradingPost') phases.push({ n: 200, mouth: half + 8, at: ring(zn.cx, zn.cz, 0, Math.PI * 2, R * 0.15, R * 0.84) });
  for (const ph of phases) {
    for (let k = 0; k < ph.n; k++) {
      const [x, z] = ph.at();
      if (Math.hypot(x - zn.cx, z - zn.cz) > R * 0.84) continue;
      if (zn.mouths.some((m) => Math.hypot(m.x - x, m.z - z) < ph.mouth)) continue;
      if (blocked(zn, x, z, half + 2)) continue;
      let hard = 0,
        soft = 0;
      for (const o of zn.anchors) {
        if (Math.hypot(o.x - x, o.z - z) >= half + 4) continue;
        if (SMALL.has(o.kind)) soft++;
        else hard++;
      }
      if (hard > 0 || soft >= bestSoft) continue;
      best = { x, z };
      bestSoft = soft;
      if (soft === 0) break;
    }
    if (best) break;
  }
  if (!best) return;
  const { x, z } = best;
  // clear the scatter off the footprint and its yard
  zn.anchors = zn.anchors.filter((o) => Math.hypot(o.x - x, o.z - z) >= half + 4 || !SMALL.has(o.kind));
  const rot = Math.atan2(zn.cz - z, zn.cx - x); // entrance faces zone center
  flattenDisc(field, x, z, half, 1, MAT.DIRT, noise);
  zn.anchors.push({ kind: 'landmark', x, z, rot, data: { type, name: info.name, mission: info.mission } });
  zn.pois.push({ kind: 'landmark', name: info.name, x, z, r: half + 4, data: { type } });
}

function flattenDisc(field: Heightfield, cx: number, cz: number, r: number, strength: number, mat: number, noise: Noise) {
  const h0 = avgBase(field, cx, cz, r * 0.7);
  forRect(field, cx - r - 12, cz - r - 12, cx + r + 12, cz + r + 12, (k, x, z) => {
    const d = Math.hypot(x - cx, z - cz);
    const w = smoothstep(r + 10, r - 2, d) * strength;
    if (w <= 0) return;
    field.base[k] = lerp(field.base[k], h0 + noise.n2(x * 0.08, z * 0.08) * 0.15, w);
    if (mat >= 0 && d < r - 2 + noise.n2(x * 0.1, z * 0.1) * 3) field.baseMat[k] = mat;
  });
}

function carvePool(field: Heightfield, cx: number, cz: number, r: number, depthTo: number) {
  forRect(field, cx - r - 4, cz - r - 4, cx + r + 4, cz + r + 4, (k, x, z) => {
    const d = Math.hypot(x - cx, z - cz) / r;
    if (d > 1.25) return;
    const t = smoothstep(1.25, 0.8, d);
    field.base[k] = lerp(field.base[k], depthTo, t);
    field.baseMat[k] = d < 1 ? MAT.MUD : MAT.GRASS;
  });
}

function addBlocker(ctx: ThemeCtx, zn: ZoneDef) {
  const c = zn.corridor!;
  const kind = zn.blocker ?? 'storm';
  if (kind === 'storm') return;
  const id = `block_${ctx.spec.key}_${zn.index}`;
  const dx = c.bx - c.ax,
    dz = c.bz - c.az;
  const L = Math.hypot(dx, dz);
  const ux = dx / L,
    uz = dz / L;
  const noise = ctx.noise;
  const thick = kind === 'dune' ? 10 : 4.5;
  const height = kind === 'dune' ? 9 : kind === 'bones' ? 0 : 15;
  const len = c.w + 26;
  if (kind === 'bones' || kind === 'gate') {
    // physical prop blocker only (bone gate / stone gate) + low ridge
    zn.anchors.push({ kind: kind === 'bones' ? 'boneGate' : 'stoneGate', x: c.mx, z: c.mz, rot: Math.atan2(uz, ux) + Math.PI / 2, data: { blocker: id } });
  }
  const stamp: Stamp = {
    id,
    x0: c.mx - len,
    z0: c.mz - len,
    x1: c.mx + len,
    z1: c.mz + len,
    weight: 1,
    fn: (x, z) => {
      const ddx = x - c.mx,
        ddz = z - c.mz;
      const along = ddx * ux + ddz * uz; // across wall thickness
      const lat = ddx * -uz + ddz * ux; // along wall length
      const wob = noise.n2(lat * 0.15, 3) * 1.5;
      const t = smoothstep(thick + 3, thick - 1, Math.abs(along + wob));
      const l = smoothstep(len * 0.5 + 6, len * 0.5 - 4, Math.abs(lat));
      const crag = kind === 'dune' ? Math.cos(Math.max(-1.5, Math.min(1.5, along / thick))) : 1 + noise.n2(x * 0.2, z * 0.2) * 0.25;
      return Math.max(0, t * l * (height > 0 ? height : 3) * crag);
    },
    mat: kind === 'dune' ? undefined : (x, z, dh) => (dh > 1 ? MAT.ROCK : -1),
  };
  ctx.field.stamps.push(stamp);
  zn.blockerStamp = id;
}
