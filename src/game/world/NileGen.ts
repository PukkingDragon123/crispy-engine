// The Nile stage generator: a variant of the region generator built around a wide,
// winding river that runs through every zone and corridor of the sub-area.
//
//  A  the river delta and the lower Nile: side channels and islands, papyrus marsh,
//     green farmland strips with irrigation canals, palm groves, sandbanks; the
//     Sphinx waits at the Gate (wave 50).
//  B  the upper Nile: rapids at the cataract, then the temple city on the banks
//     (quays, stairs into the water, processional avenues, pylons, obelisks,
//     hypostyle columns, seated colossi, jetties); Cleopatra's Barge Court (75).
//  C  the same valley after Ra burns it: a lava river with cooling crust, charred
//     palms, obsidian, the cinder temples; Ra's Throne of the Sun (100).
//
// The river surface is one constant level per sub-area (so every "out of the water"
// rule in the game keeps working); the flow, swells and lava live in NileWater.
// Terrain heights are written straight into the height field: near ground, ruins
// and temple platforms read as big blocks with pixel-art textures (Terrain).
import { Heightfield, MAT, type Stamp } from './Heightfield';
import { Noise, RNG, smoothstep, clamp, lerp } from '../../engine/math/rand';
import { layoutZones, findOpenSpot, type SubArea, type ZoneDef, type Anchor, type ThemeId, type BlockerKind, type SubAreaSpec } from './RegionGen';
import { RiverNet, makeChannel, spline, hash2, fract, type NileChannel, type RiverHit } from './NileRiver';

/** the river's surface height (m) in every Nile sub-area */
export const NILE_LEVEL = 4;

export type NileTheme =
  | 'reeds' | 'papyrus' | 'fields' | 'hippo' | 'shaduf' | 'islands' | 'palms' | 'delta' | 'mouths' | 'sphinxGate'
  | 'cataract' | 'avenue' | 'hypostyle' | 'colossi' | 'court'
  | 'ash' | 'glass' | 'cinder' | 'fire' | 'throne';

interface NileZoneSpec {
  name: string;
  theme: NileTheme;
  /** the closest desert theme (systems that read ZoneDef.theme: wildlife, arenas) */
  base: ThemeId;
  r: number;
  blocker: BlockerKind;
}
interface NileAreaSpec {
  key: 'A' | 'B' | 'C';
  name: string;
  subtitle: string;
  size: number;
  waveStart: number;
  env: SubArea['env'];
  /** main channel half width in the zones (m) */
  hw: number;
  /** floodplain lift over the river (m) */
  plain: number;
  /** sandstone cliffs closing in on the valley (0..1) */
  cliffs: number;
  burned: boolean;
  zones: NileZoneSpec[];
}

export const NILE_AREAS: Record<'A' | 'B' | 'C', NileAreaSpec> = {
  A: {
    key: 'A', name: 'The Green Delta', subtitle: "Cleopatra's Nile — the Lower Kingdom", size: 1400, waveStart: 1, env: 'nileDay',
    hw: 25, plain: 0.62, cliffs: 0.35, burned: false,
    zones: [
      { name: 'Reed Landing', theme: 'reeds', base: 'palmshore', r: 118, blocker: 'storm' },
      { name: 'Ibis Shallows', theme: 'papyrus', base: 'marsh', r: 124, blocker: 'storm' },
      { name: "Farmers' Bend", theme: 'fields', base: 'palmshore', r: 126, blocker: 'rockwall' },
      { name: 'Hippo Pools', theme: 'hippo', base: 'marsh', r: 124, blocker: 'storm' },
      { name: 'The Shaduf Fields', theme: 'shaduf', base: 'palmshore', r: 122, blocker: 'rockwall' },
      { name: 'Crocodile Islands', theme: 'islands', base: 'marsh', r: 130, blocker: 'storm' },
      { name: 'Date Palm Reach', theme: 'palms', base: 'palmshore', r: 124, blocker: 'rockwall' },
      { name: 'The Papyrus Maze', theme: 'delta', base: 'marsh', r: 130, blocker: 'storm' },
      { name: 'The Thousand Mouths', theme: 'mouths', base: 'marsh', r: 132, blocker: 'rockwall' },
      { name: 'Gate of the Sphinx', theme: 'sphinxGate', base: 'arena', r: 106, blocker: 'storm' },
    ],
  },
  B: {
    key: 'B', name: 'The Upper Nile', subtitle: "Cleopatra's Nile — the City of Temples", size: 1100, waveStart: 51, env: 'nileDusk',
    hw: 22, plain: 0.95, cliffs: 1, burned: false,
    zones: [
      { name: 'The First Cataract', theme: 'cataract', base: 'floodruins', r: 138, blocker: 'storm' },
      { name: 'Avenue of Obelisks', theme: 'avenue', base: 'floodruins', r: 134, blocker: 'rockwall' },
      { name: 'Hypostyle Shore', theme: 'hypostyle', base: 'floodruins', r: 134, blocker: 'storm' },
      { name: 'Quay of the Colossi', theme: 'colossi', base: 'floodruins', r: 136, blocker: 'rockwall' },
      { name: "Cleopatra's Barge Court", theme: 'court', base: 'arena', r: 112, blocker: 'storm' },
    ],
  },
  C: {
    key: 'C', name: 'The Burning River', subtitle: 'Wrath of Ra — the Land of Fire', size: 1100, waveStart: 76, env: 'nileBurn',
    hw: 21, plain: 0.85, cliffs: 0.8, burned: true,
    zones: [
      { name: 'The Ashen Banks', theme: 'ash', base: 'stormapproach', r: 144, blocker: 'storm' },
      { name: 'The Glass Delta', theme: 'glass', base: 'glassdunes', r: 132, blocker: 'rockwall' },
      { name: 'The Cinder Temples', theme: 'cinder', base: 'stormapproach', r: 140, blocker: 'storm' },
      { name: 'The River of Fire', theme: 'fire', base: 'glassdunes', r: 130, blocker: 'rockwall' },
      { name: 'Throne of the Sun', theme: 'throne', base: 'apex', r: 106, blocker: 'storm' },
    ],
  },
};

/** name + subtitle of a sub-area of a stage (the HUD cut-in, the travel toast) */
export function nileAreaName(key: 'A' | 'B' | 'C') {
  return NILE_AREAS[key];
}

/** what the foliage layer should grow at a point (null: its own desert rules) */
export interface FoliageHint {
  dens: number;
  grp: 'reed' | 'papyrus' | 'crop' | 'turf' | 'flower' | 'wild' | 'dry' | 'dead' | 'scrub';
}

export interface NileInfo {
  key: 'A' | 'B' | 'C';
  level: number;
  river: RiverNet;
  /** the sub-area starts burned (region C) */
  burned: boolean;
  themes: NileTheme[];
  /** the gate boss's open ground (Sphinx / Cleopatra / Ra) */
  arena: { x: number; z: number; r: number; y: number; zone: number } | null;
  /**
   * The river gate at the end of region A (the Sphinx's gate): the bronze-doored water gate
   * spanning the narrows; yaw turns its front (+z) upstream, toward the Sphinx's arena.
   * World raises the gate model and fills in openGate() (the doors swing open).
   */
  gate: { x: number; z: number; yaw: number } | null;
  openGate?: () => void;
  /** farmland crop kind at a point (-1: not a field) */
  fieldAt(x: number, z: number): number;
  foliage(x: number, z: number, h: number, mat: number, pick: number): FoliageHint | null;
}

// ---------------------------------------------------------------------------
const FIELD_THEMES = new Set<NileTheme>(['reeds', 'fields', 'shaduf', 'palms', 'islands', 'hippo', 'avenue']);
const MARSH_THEMES = new Set<NileTheme>(['papyrus', 'delta', 'mouths', 'hippo', 'reeds']);
const TEMPLE_THEMES = new Set<NileTheme>(['avenue', 'hypostyle', 'colossi', 'court', 'cinder']);
const BRANCHES: Partial<Record<NileTheme, number>> = { papyrus: 1, hippo: 1, islands: 2, palms: 1, delta: 3, mouths: 3, glass: 2, cataract: 1, ash: 1 };

function forRect(f: Heightfield, x0: number, z0: number, x1: number, z1: number, fn: (k: number, x: number, z: number) => void) {
  const r = f.res, n = f.n;
  const i0 = Math.max(0, Math.floor(x0 / r)), i1 = Math.min(n - 1, Math.ceil(x1 / r));
  const j0 = Math.max(0, Math.floor(z0 / r)), j1 = Math.min(n - 1, Math.ceil(z1 / r));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(i + j * n, i * r, j * r);
}

/** keep-out discs + a spacing hash for scatter */
class Placer {
  private cells = new Map<number, { x: number; z: number; r: number }[]>();
  keep: { x: number; z: number; r: number }[] = [];
  private key(i: number, j: number) {
    return (i + 4096) * 8192 + (j + 4096);
  }
  free(x: number, z: number, r: number) {
    for (const k of this.keep) if (Math.hypot(k.x - x, k.z - z) < k.r + r) return false;
    const i0 = Math.floor((x - r - 8) / 8), i1 = Math.floor((x + r + 8) / 8), j0 = Math.floor((z - r - 8) / 8), j1 = Math.floor((z + r + 8) / 8);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = this.cells.get(this.key(i, j));
        if (c) for (const p of c) if (Math.hypot(p.x - x, p.z - z) < p.r + r) return false;
      }
    return true;
  }
  add(x: number, z: number, r: number) {
    const k = this.key(Math.floor(x / 8), Math.floor(z / 8));
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = []));
    c.push({ x, z, r });
  }
}

export function generateNileArea(key: 'A' | 'B' | 'C', seed: number): SubArea {
  const t0 = performance.now();
  const spec = NILE_AREAS[key];
  const rng = new RNG(seed * 31 + 7);
  const noise = new Noise(seed * 7 + 29);
  const S = spec.size;
  const L = NILE_LEVEL;
  const fakeSpec: SubAreaSpec = {
    key, name: spec.name, subtitle: spec.subtitle, size: S, waveStart: spec.waveStart, env: spec.env, water: L,
    zones: spec.zones.map((z) => ({ name: z.name, theme: z.base, r: z.r, blocker: z.blocker })),
  };
  const zones = layoutZones(fakeSpec, rng);
  zones.forEach((z, i) => (z.nile = spec.zones[i].theme));
  // the river needs its banks inside the corridors
  for (const z of zones) if (z.corridor) z.corridor.w = 64;
  const theme = (i: number) => spec.zones[i].theme;
  const field = new Heightfield(S, 1);
  const windAng = rng.range(0, Math.PI * 2);
  const wind = { x: Math.cos(windAng), z: Math.sin(windAng) };

  // ------------------------------------------------------------------ the main river
  const nearestZone = (x: number, z: number) => {
    let best = 0, bd = 1e9;
    for (const zn of zones) {
      const d = Math.hypot(x - zn.cx, z - zn.cz) - zn.r;
      if (d < bd) {
        bd = d;
        best = zn.index;
      }
    }
    return { zi: best, d: bd };
  };
  const clear = (x: number, z: number, skip: number) => zones.every((zn) => zn.index === skip || Math.hypot(x - zn.cx, z - zn.cz) > zn.r + 50);
  /** a straight run from a zone out to the map edge that keeps off the other zones */
  const toEdge = (zn: ZoneDef, prefer: number) => {
    for (const da of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2, Math.PI]) {
      const a = prefer + da;
      const dx = Math.cos(a), dz = Math.sin(a);
      let ok = true;
      let x = zn.cx, z = zn.cz;
      for (let d = zn.r; d < 2000; d += 20) {
        x = zn.cx + dx * d;
        z = zn.cz + dz * d;
        if (x < 0 || z < 0 || x > S || z > S) break;
        if (!clear(x, z, zn.index)) {
          ok = false;
          break;
        }
      }
      if (ok) return { x: clamp(x, 2, S - 2), z: clamp(z, 2, S - 2), a };
    }
    return { x: clamp(zn.cx + Math.cos(prefer) * 2000, 2, S - 2), z: clamp(zn.cz + Math.sin(prefer) * 2000, 2, S - 2), a: prefer };
  };
  const way: { x: number; z: number }[] = [];
  const z0 = zones[0], zl = zones[zones.length - 1];
  const out0 = zones[1] ? Math.atan2(zones[1].cz - z0.cz, zones[1].cx - z0.cx) : z0.dir;
  const inL = zl.corridor ? Math.atan2(zl.cz - zones[zones.length - 2].cz, zl.cx - zones[zones.length - 2].cx) : zl.dir;
  const e0 = toEdge(z0, out0 + Math.PI);
  const e1 = toEdge(zl, inL);
  way.push({ x: e0.x, z: e0.z });
  // the gate zones keep their river to one side: the boss gets open ground
  const offs: number[] = [];
  for (const zn of zones) {
    const prev = zn.index > 0 ? zones[zn.index - 1] : null, next = zones[zn.index + 1];
    const ain = prev ? Math.atan2(zn.cz - prev.cz, zn.cx - prev.cx) : out0;
    const aout = next ? Math.atan2(next.cz - zn.cz, next.cx - zn.cx) : ain;
    const am = Math.atan2(Math.sin(ain) + Math.sin(aout), Math.cos(ain) + Math.cos(aout));
    const nx = -Math.sin(am), nz = Math.cos(am);
    const gate = theme(zn.index) === 'sphinxGate' || theme(zn.index) === 'court' || theme(zn.index) === 'throne';
    const side = zn.index % 2 ? 1 : -1;
    const off = (gate ? 0.42 : TEMPLE_THEMES.has(theme(zn.index)) ? 0.3 : rng.range(0.14, 0.26)) * zn.r * side;
    offs.push(off);
    if (zn.corridor) way.push({ x: zn.corridor.mx, z: zn.corridor.mz });
    // two waypoints per zone so the river bends through it instead of cutting the centre
    const fx = Math.cos(am), fz = Math.sin(am);
    way.push({ x: zn.cx + nx * off - fx * zn.r * 0.28, z: zn.cz + nz * off - fz * zn.r * 0.28 });
    way.push({ x: zn.cx + nx * off * 0.8 + fx * zn.r * 0.3, z: zn.cz + nz * off * 0.8 + fz * zn.r * 0.3 });
  }
  way.push({ x: e1.x, z: e1.z });
  let mainPts = spline(way, 2.5);
  // meanders: lateral waves inside the zones, calm through the corridor gaps
  {
    const ph = rng.range(0, 6.28), lam = rng.range(190, 240);
    let s = 0;
    const out: { x: number; z: number }[] = [];
    for (let i = 0; i < mainPts.length; i++) {
      const a = mainPts[Math.max(0, i - 1)], b = mainPts[Math.min(mainPts.length - 1, i + 1)];
      if (i > 0) s += Math.hypot(mainPts[i].x - mainPts[i - 1].x, mainPts[i].z - mainPts[i - 1].z);
      const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / tl, nz = (b.x - a.x) / tl;
      const p = mainPts[i];
      let cw = 1;
      for (const zn of zones) if (zn.corridor) cw = Math.min(cw, smoothstep(24, 70, Math.hypot(p.x - zn.corridor.mx, p.z - zn.corridor.mz)));
      const amp = 13 * cw;
      const d = Math.sin((s / lam) * 6.2831853 + ph) * amp + noise.n2(s * 0.004, 3.3) * amp * 0.6;
      out.push({ x: p.x + nx * d, z: p.z + nz * d });
    }
    mainPts = spline(out.filter((_, i) => i % 6 === 0 || i === out.length - 1), 2.5);
  }
  const zoneOf = (x: number, z: number) => nearestZone(x, z);
  const corrDist = (x: number, z: number) => {
    let d = 1e9;
    for (const zn of zones) if (zn.corridor) d = Math.min(d, Math.hypot(x - zn.corridor.mx, z - zn.corridor.mz));
    return d;
  };
  const hwFor = (th: NileTheme) => (th === 'cataract' || th === 'fire' ? spec.hw * 0.68 : th === 'hippo' ? spec.hw * 1.45 : th === 'delta' || th === 'mouths' || th === 'glass' ? spec.hw * 1.15 : th === 'sphinxGate' || th === 'court' || th === 'throne' ? spec.hw * 0.85 : spec.hw);
  // the river gate (region A): the narrows two thirds of the way through the Sphinx's zone
  let gateS = -1;
  {
    const gz = zones.find((z) => theme(z.index) === 'sphinxGate');
    if (gz) {
      let sAcc = 0, a = -1, b = -1;
      for (let i = 0; i < mainPts.length; i++) {
        if (i > 0) sAcc += Math.hypot(mainPts[i].x - mainPts[i - 1].x, mainPts[i].z - mainPts[i - 1].z);
        if (Math.hypot(mainPts[i].x - gz.cx, mainPts[i].z - gz.cz) < gz.r - 22) {
          if (a < 0) a = sAcc;
          b = sAcc;
        }
      }
      if (a >= 0 && b - a > 60) gateS = a + (b - a) * 0.72;
    }
  }
  const main = makeChannel(0, true, mainPts, (s, _k, x, z) => {
    const { zi, d } = zoneOf(x, z);
    const th = theme(zi);
    const inZ = smoothstep(26, -30, d) * smoothstep(20, 75, corrDist(x, z));
    const hwZ = hwFor(th) * (1 + 0.2 * noise.n2(s / 170, 1.7));
    const hw0 = lerp(15, hwZ, inZ);
    // the gate's narrows: the river squeezes between the pylons
    const gk = gateS >= 0 ? smoothstep(44, 16, Math.abs(s - gateS)) : 0;
    const hw = lerp(hw0, 8.4, gk);
    const rapids = th === 'cataract' || th === 'fire' ? inZ : 0;
    const calm = th === 'delta' || th === 'mouths' || th === 'hippo' || th === 'papyrus' ? inZ : 0;
    const depth = lerp(3.2, 2.6 + 0.6 * noise.n2(s / 120, 9.1), inZ) * (1 - rapids * 0.25);
    const speed = clamp(2.3 * Math.pow(22 / hw, 0.75) * (1 + rapids * 0.65) * (1 - calm * 0.3), 1.3, 4.8);
    const rough = clamp(lerp(0.95, 0.55 + 0.4 * noise.n2(s / 260, 4.4), inZ) * (1 - calm * 0.5) + rapids * 0.95, 0.15, 1.65);
    return { hw, depth, speed: Math.min(speed, lerp(speed, 3.4, gk)), rough: rough * (1 - gk * 0.85) };
  });
  const channels: NileChannel[] = [main];
  let gate: NileInfo['gate'] = null;
  if (gateS >= 0) {
    const q = pointOn(main, gateS, { x: 0, z: 0, tx: 0, tz: 0, hw: 0 });
    gate = { x: q.x, z: q.z, yaw: Math.atan2(-q.tx, -q.tz) };
  }
  // ------------------------------------------------------------------ side channels
  const branchEnds: { x: number; z: number }[] = [];
  for (const zn of zones) {
    const th = theme(zn.index);
    const nb = th === 'sphinxGate' || th === 'court' || th === 'throne' ? 0 : BRANCHES[th] ?? (rng.chance(0.3) ? 1 : 0);
    if (!nb) continue;
    // the stretch of main river inside this zone
    let sa = -1, sb = -1;
    for (let i = 0; i < main.n; i++) {
      if (Math.hypot(main.x[i] - zn.cx, main.z[i] - zn.cz) < zn.r - 26) {
        if (sa < 0) sa = main.s[i];
        sb = main.s[i];
      }
    }
    if (sa < 0 || sb - sa < 120) continue;
    for (let b = 0; b < nb; b++) {
      const len = Math.min(sb - sa - 10, rng.range(130, 240));
      if (len < 100) break;
      const s0 = sa + rng.range(0, Math.max(1, sb - sa - len));
      // bend out toward the zone's heart (more land there)
      const mid = { x: 0, z: 0, tx: 0, tz: 0, hw: 0 };
      const pMid = pointOn(main, s0 + len / 2, mid);
      const toC = (zn.cx - pMid.x) * -pMid.tz + (zn.cz - pMid.z) * pMid.tx;
      const side = b % 2 === 0 ? Math.sign(toC || 1) : -Math.sign(toC || 1);
      let omax = rng.range(30, 52) + pMid.hw;
      const bw = th === 'cataract' ? rng.range(5, 7) : rng.range(6.5, 11.5);
      for (let tries = 0; tries < 4; tries++) {
        const tip = { x: pMid.x - pMid.tz * omax * side, z: pMid.z + pMid.tx * omax * side };
        if (Math.hypot(tip.x - zn.cx, tip.z - zn.cz) < zn.r - 20 - bw) break;
        omax *= 0.75;
      }
      const pts: { x: number; z: number }[] = [];
      const P = { x: 0, z: 0, tx: 0, tz: 0, hw: 0 };
      for (let t = 0; t <= 1.0001; t += 1 / 24) {
        const q = pointOn(main, s0 + len * t, P);
        const o = Math.pow(Math.sin(Math.PI * t), 0.75) * omax * side + noise.n2(t * 3 + b, zn.index) * 6 * Math.sin(Math.PI * t);
        pts.push({ x: q.x - q.tz * o, z: q.z + q.tx * o });
      }
      const bp = spline(pts, 2.5);
      const ch = makeChannel(channels.length, false, bp, (s, k) => {
        const w = Math.pow(Math.sin(Math.PI * clamp(k, 0, 1)), 0.35);
        return { hw: bw * (0.45 + 0.55 * w), depth: 1.5 * (0.6 + 0.4 * w), speed: th === 'cataract' ? 3.6 : 1.7, rough: (th === 'cataract' ? 1.3 : 0.25) * smoothstep(0.05, 0.25, k) * smoothstep(0.95, 0.75, k) };
      });
      channels.push(ch);
      branchEnds.push({ x: bp[0].x, z: bp[0].z }, { x: bp[bp.length - 1].x, z: bp[bp.length - 1].z });
      if (channels.length > 30) break;
    }
  }
  // the main swell calms where the side channels join (their along-coordinates meet there)
  for (let i = 0; i < main.n; i++)
    for (const be of branchEnds) {
      const d = Math.hypot(main.x[i] - be.x, main.z[i] - be.z);
      if (d < 60) main.rough[i] *= smoothstep(25, 60, d);
    }
  const river = new RiverNet(S, L, channels);
  const tRiver = performance.now();

  // ------------------------------------------------------------------ the desert beyond the valley
  const duneH = (x: number, z: number) => {
    const u = x * wind.x + z * wind.z;
    const v = -x * wind.z + z * wind.x;
    const wu = u + noise.n2(x * 0.004, z * 0.004) * 40 + noise.n2(x * 0.013, z * 0.013) * 7;
    const wv = v + noise.n2(x * 0.005 + 7, z * 0.005 - 3) * 30;
    const lambda = 68 + 26 * noise.n2(x * 0.002 + 3, z * 0.002);
    const phase = wu / lambda + noise.n2(wv * 0.008, 3.1) * 0.65;
    const t = phase - Math.floor(phase);
    const prof = t < 0.76 ? smoothstep(0, 1, t / 0.76) : 1 - smoothstep(0, 1, (t - 0.76) / 0.24);
    const crest = 0.45 + 0.55 * (noise.n2(wv * 0.011, Math.floor(phase) * 1.7) * 0.5 + 0.5);
    const amp = 6.5 + 4 * noise.n2(x * 0.003 - 9, z * 0.003 + 4);
    return prof * crest * amp;
  };
  const n = field.n;
  const C = 4;
  const nc = Math.ceil((n - 1) / C) + 1;
  const latB = new Float32Array(nc * nc), latT = new Float32Array(nc * nc), latU = new Float32Array(nc * nc), latD = new Float32Array(nc * nc), latW = new Float32Array(nc * nc);
  for (let j = 0; j < nc; j++)
    for (let i = 0; i < nc; i++) {
      const x = Math.min(i * C, n - 1), z = Math.min(j * C, n - 1);
      const q = i + j * nc;
      latB[q] = noise.fbm2(x / 330, z / 330, 3) * 8 + noise.fbm2(x / 85, z / 85, 3) * 2;
      latT[q] = noise.n2(x * 0.006 + 11, z * 0.006 - 5);
      latU[q] = noise.ridged2(x * 0.0042 + 5, z * 0.0042 - 2, 2);
      latD[q] = duneH(x, z);
      // floodplain width (m from the bank) and cliff jitter
      latW[q] = noise.n2(x / 150 + 3, z / 150 - 8);
    }
  // 16 m blocks: which zones touch it (playable softening, themes)
  const B = 16;
  const nb = Math.ceil(n / B);
  const bZone = new Int16Array(nb * nb).fill(-1);
  const bPlay = new Float32Array(nb * nb);
  for (let bj = 0; bj < nb; bj++)
    for (let bi = 0; bi < nb; bi++) {
      const x = (bi + 0.5) * B, z = (bj + 0.5) * B;
      const nz = nearestZone(x, z);
      bZone[bi + bj * nb] = nz.zi;
      let play = smoothstep(30, -10, nz.d);
      for (const zn of zones)
        if (zn.corridor) {
          const c = zn.corridor;
          const dx = c.bx - c.ax, dz = c.bz - c.az, l2 = dx * dx + dz * dz || 1;
          const t = clamp(((x - c.ax) * dx + (z - c.az) * dz) / l2, 0, 1);
          play = Math.max(play, smoothstep(c.w * 0.5 + 24, c.w * 0.5 - 4, Math.hypot(c.ax + dx * t - x, c.az + dz * t - z)));
        }
      bPlay[bi + bj * nb] = play;
    }
  const bWfp = new Float32Array(nb * nb), bMarsh = new Float32Array(nb * nb);
  {
    const wz = (zi: number) => {
      const th = theme(zi);
      return th === 'delta' || th === 'mouths' || th === 'hippo' ? 58 : TEMPLE_THEMES.has(th) ? 62 : th === 'cataract' || th === 'fire' ? 30 : 44;
    };
    for (let b = 0; b < nb * nb; b++) {
      bWfp[b] = wz(bZone[b]);
      bMarsh[b] = MARSH_THEMES.has(theme(bZone[b])) ? 1 : 0;
    }
  }
  const hit: RiverHit = { ch: 0, main: true, s: 0, u: 0, d: 0, e: 0, hw: 0, depth: 0, speed: 0, rough: 0, tx: 1, tz: 0 };
  const cropAt = (h: RiverHit, e: number, zi: number): number => {
    if (!FIELD_THEMES.has(theme(zi)) || e < 5) return -1;
    const W = 9 + (hash2(zi * 3.1, 7.7) * 4) | 0;
    const Lf = 20 + hash2(zi * 1.7, 2.2) * 8;
    const a = Math.floor(h.s / Lf), b = Math.floor((e - 5) / W) * (h.u >= 0 ? 1 : -1);
    const k = hash2(a + zi * 17.3, b * 3.7 + h.ch * 11.1);
    return k < 0.42 ? 0 : k < 0.66 ? 1 : k < 0.8 ? 2 : 3;
  };
  const bars = (h: RiverHit) => noise.n2(h.s * 0.017 + h.ch * 7.3, h.u * 0.065);
  const FP = L + spec.plain;
  let q = 0, w00 = 0, w10 = 0, w01 = 0, w11 = 0;
  const lerp4 = (A: Float32Array) => A[q] * w00 + A[q + 1] * w10 + A[q + nc] * w01 + A[q + nc + 1] * w11;
  let bo = 0, bfx = 0, bfz = 0;
  const bl = (A: Float32Array) => (A[bo] * (1 - bfx) + A[bo + 1] * bfx) * (1 - bfz) + (A[bo + nb] * (1 - bfx) + A[bo + nb + 1] * bfx) * bfz;
  for (let j = 0; j < n; j++) {
    const z = j;
    const cj = Math.min(nc - 2, Math.floor(j / C)), fz = j / C - cj;
    for (let i = 0; i < n; i++) {
      const x = i;
      const k = i + j * n;
      const ci = Math.min(nc - 2, Math.floor(i / C)), fx = i / C - ci;
      q = ci + cj * nc;
      w00 = (1 - fx) * (1 - fz);
      w10 = fx * (1 - fz);
      w01 = (1 - fx) * fz;
      w11 = fx * fz;
      const blk = ((i / B) | 0) + ((j / B) | 0) * nb;
      const zi = bZone[blk];
      const th = theme(zi);
      // per-block values blended between block centres (no seams at the block edges)
      const gbx = Math.max(0, Math.min(nb - 1.001, i / B - 0.5)), gbz = Math.max(0, Math.min(nb - 1.001, j / B - 0.5));
      const bi0 = Math.floor(gbx), bj0 = Math.floor(gbz);
      bfx = gbx - bi0;
      bfz = gbz - bj0;
      bo = bi0 + bj0 * nb;
      const play = bl(bPlay);
      const e = river.bankDist(x, z);
      const Wfp = bl(bWfp) + lerp4(latW) * 16;
      const marshW = bl(bMarsh);
      let h: number;
      let m: number = MAT.SAND;
      if (e < 0) {
        // ---------------------------------------------- the river bed
        const rh = river.hit(x, z, hit);
        const hw = rh ? rh.hw : 12;
        const t = clamp(-e / Math.max(2, hw), 0, 1);
        const depth = rh ? rh.depth : 2;
        h = L - 0.3 - depth * Math.pow(smoothstep(0, 0.8, t), 0.85);
        m = t < 0.22 ? MAT.MUD : MAT.SAND;
        if (rh) {
          // sandbars (shallows) and, in the wide channels, sandbank islands
          const bv = bars(rh);
          if (bv > 0.22) {
            const lift = smoothstep(0.22, 0.5, bv);
            const top = hw > 19 && t > 0.25 && t < 0.85 && bv > 0.5 ? L + 0.25 + (bv - 0.5) * 2.2 : L - 0.22;
            h = lerp(h, top, lift);
            m = MAT.SAND;
          }
          // the cataract: granite ledges breaking the surface
          if ((th === 'cataract' || th === 'fire') && rh.main) {
            const g = noise.ridged2(x * 0.06, z * 0.06, 2);
            if (g > 0.78 && t > 0.15) {
              h = Math.max(h, L - 0.6 + (g - 0.78) * 14);
              m = th === 'fire' ? MAT.DARK_ROCK : MAT.ROCK;
            }
          }
        }
      } else {
        // ---------------------------------------------- banks, floodplain, valley walls
        const near = e < Wfp + 80;
        const bankW = near ? 2.4 + noise.n2(x * 0.07, z * 0.07) * 1.2 : 3;
        const fpH = near ? FP + noise.n2(x * 0.021, z * 0.021) * 0.22 + noise.n2(x * 0.09, z * 0.09) * 0.06 : FP;
        if (e < bankW) {
          h = lerp(L - 0.3, fpH, smoothstep(0, bankW, e));
          m = MAT.MUD;
        } else {
          h = fpH;
          m = e < 9 ? MAT.GRASS : MAT.SAND_DARK;
          // papyrus marsh: low wet ground and pools beside the channels
          if (near && marshW > 0.01 && e < Wfp * 0.8) {
            const mv = (noise.n2(x * 0.03 + 5, z * 0.03 - 2) * 0.7 + noise.n2(x * 0.09, z * 0.09) * 0.3) * marshW - (1 - marshW) * 0.3;
            if (mv > 0.12) {
              const k2 = smoothstep(0.12, 0.42, mv);
              h = lerp(h, L - 0.45, k2 * 0.92);
              m = k2 > 0.35 ? MAT.MUD : MAT.GRASS;
            } else if (mv > -0.05) m = MAT.GRASS;
          }
          // farmland strips (crops, tilled earth, flax, fallow), dikes and irrigation canals
          if (FIELD_THEMES.has(th) && e < Wfp - 4 && e > 5) {
            const rh = river.hit(x, z, hit);
            if (rh) {
              const ck = cropAt(rh, e, zi);
              if (ck >= 0) {
                const W = 9 + (hash2(zi * 3.1, 7.7) * 4) | 0;
                const Lf = 20 + hash2(zi * 1.7, 2.2) * 8;
                const fa = fract(rh.s / Lf), fb = fract((e - 5) / W);
                const edge = Math.min(Math.min(fa, 1 - fa) * Lf, Math.min(fb, 1 - fb) * W);
                const bIdx = Math.floor((e - 5) / W);
                const aIdx = Math.floor(rh.s / Lf);
                const canalAcross = fb < 0.5 ? bIdx % 3 === 1 : (bIdx + 1) % 3 === 1;
                const canalAlong = Math.abs(aIdx) % 4 === 2 && fa < 0.5;
                m = ck === 0 ? MAT.GRASS : ck === 1 ? MAT.DIRT : ck === 2 ? MAT.GRASS : MAT.SAND_DARK;
                if (edge < 0.7) {
                  h += 0.22;
                  m = MAT.DIRT;
                }
                if ((canalAcross && Math.min(fb, 1 - fb) * W < 0.85) || (canalAlong && Math.min(fa, 1 - fa) * Lf < 0.85 && e < Wfp - 8)) {
                  h = L - 0.55;
                  m = MAT.MUD;
                }
              }
            }
          }
          // the valley walls: dunes rising off the plain, sandstone cliffs where the desert closes in
          const kv = smoothstep(Wfp, Wfp + 80, e);
          if (kv > 0) {
            const bb = lerp4(latB);
            const dn = play > 0.05 || kv < 0.6 ? duneH(x, z) : lerp4(latD);
            let desert = 9 + bb * 0.8 + dn * lerp(0.75, 1, 1 - play) + (e - Wfp) * 0.04;
            let dm: number = lerp4(latT) > 0.45 ? MAT.RED_SAND : MAT.SAND;
            const cl = spec.cliffs * (1 - play * 0.55);
            if (cl > 0.02) {
              // a terraced escarpment a little way off the plain, buttes beyond
              const ce = Wfp + 26 + lerp4(latW) * 18;
              const ck = smoothstep(ce - 4, ce + 4, e);
              if (ck > 0) {
                const steps = Math.floor(smoothstep(ce - 4, ce + 60, e) * 3.99) / 3;
                const tv = lerp4(latT);
                desert += ck * cl * (8 + steps * 9 + tv * 1.5);
                if (ck > 0.3 && ck < 0.995) dm = spec.burned ? MAT.DARK_ROCK : MAT.ROCK;
                else if (ck >= 0.995 && tv > 0.1) dm = spec.burned ? MAT.DARK_ROCK : MAT.ROCK;
              }
            }
            const u = lerp4(latU);
            if (u > 0.8 && play < 0.3) {
              desert += smoothstep(0.8, 0.83, u) * (12 + 8 * (lerp4(latT) * 0.5 + 0.5)) * (1 - play * 3);
              dm = spec.burned ? MAT.DARK_ROCK : MAT.ROCK;
            }
            if (desert > h) {
              h = lerp(h, desert, kv);
              if (kv > 0.35) m = dm;
            }
          }
          // the edge of the map rises into the haze
          const edgeD = Math.min(x, z, S - x, S - z);
          if (edgeD < 40) h += (1 - edgeD / 40) ** 2 * 26 * smoothstep(-5, 20, e);
        }
      }
      field.base[k] = h;
      field.baseMat[k] = m;
    }
  }
  const tTerr = performance.now();

  // ------------------------------------------------------------------ set pieces
  const placers = zones.map(() => new Placer());
  let arena: NileInfo['arena'] = null;
  const P = { x: 0, z: 0, tx: 0, tz: 0, hw: 0 };
  /** main-river stretch inside a zone: [s0, s1] */
  const zoneSpan = (zn: ZoneDef, pad = 20) => {
    let a = -1, b = -1;
    for (let i = 0; i < main.n; i++)
      if (Math.hypot(main.x[i] - zn.cx, main.z[i] - zn.cz) < zn.r - pad) {
        if (a < 0) a = main.s[i];
        b = main.s[i];
      }
    return a < 0 ? null : { a, b };
  };
  /** the bank point at arc length s, `off` metres inland of the water's edge on the zone-heart side */
  const bankFrame = (zn: ZoneDef, s: number, off: number, forceSide?: number) => {
    const q = pointOn(main, s, P);
    const nx = -q.tz, nz = q.tx;
    const side = forceSide ?? (Math.sign((zn.cx - q.x) * nx + (zn.cz - q.z) * nz) || 1);
    const ox = nx * side, oz = nz * side;
    return { x: q.x + ox * (q.hw + off), z: q.z + oz * (q.hw + off), nx: ox, nz: oz, tx: q.tx, tz: q.tz, hw: q.hw, rx: q.x, rz: q.z, side };
  };
  /** a raised flagstone platform in a river-aligned frame (f inland from the bank, a along the river) */
  const platform = (bf: ReturnType<typeof bankFrame>, f0: number, f1: number, a0: number, a1: number, top: number, mat: number = MAT.TILE) => {
    const cx = bf.rx, cz = bf.rz;
    const corners = [[f0, a0], [f1, a0], [f0, a1], [f1, a1]].map(([f, a]) => ({ x: cx + bf.nx * (bf.hw + f) + bf.tx * a, z: cz + bf.nz * (bf.hw + f) + bf.tz * a }));
    const xs = corners.map((c) => c.x), zs = corners.map((c) => c.z);
    forRect(field, Math.min(...xs) - 1, Math.min(...zs) - 1, Math.max(...xs) + 1, Math.max(...zs) + 1, (k, x, z) => {
      const dx = x - cx, dz = z - cz;
      const f = dx * bf.nx + dz * bf.nz - bf.hw, a = dx * bf.tx + dz * bf.tz;
      if (f < f0 || f > f1 || a < a0 || a > a1) return;
      field.base[k] = top;
      field.baseMat[k] = mat;
    });
  };
  /** stairs from a platform's river edge down into the water (a ghat) */
  const ghat = (bf: ReturnType<typeof bankFrame>, fTop: number, a0: number, a1: number, top: number) => {
    const cx = bf.rx, cz = bf.rz;
    const run = 0.9, rise = 0.42;
    const nSteps = Math.ceil((top - (L - 1.4)) / rise);
    const fBot = fTop - nSteps * run;
    forRect(field, Math.min(cx + bf.nx * (bf.hw + fBot), cx + bf.nx * (bf.hw + fTop)) - Math.abs(a1) - 4, Math.min(cz + bf.nz * (bf.hw + fBot), cz + bf.nz * (bf.hw + fTop)) - Math.abs(a1) - 4, Math.max(cx + bf.nx * (bf.hw + fBot), cx + bf.nx * (bf.hw + fTop)) + Math.abs(a1) + 4, Math.max(cz + bf.nz * (bf.hw + fBot), cz + bf.nz * (bf.hw + fTop)) + Math.abs(a1) + 4, (k, x, z) => {
      const dx = x - cx, dz = z - cz;
      const f = dx * bf.nx + dz * bf.nz - bf.hw, a = dx * bf.tx + dz * bf.tz;
      if (f < fBot || f > fTop || a < a0 || a > a1) return;
      const step = Math.ceil((fTop - f) / run);
      field.base[k] = Math.max(L - 1.4, top - step * rise);
      field.baseMat[k] = MAT.TILE;
    });
  };
  /** a raised wall line (temple enclosure) between two points */
  const wallLine = (ax: number, az: number, bx: number, bz: number, hgt: number, thick: number, gaps: number[] = []) => {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    forRect(field, Math.min(ax, bx) - thick - 2, Math.min(az, bz) - thick - 2, Math.max(ax, bx) + thick + 2, Math.max(az, bz) + thick + 2, (k, x, z) => {
      const t = ((x - ax) * dx + (z - az) * dz) / (l * l);
      if (t < 0 || t > 1) return;
      const lat = Math.abs((x - ax) * -dz / l + (z - az) * dx / l);
      if (lat > thick * 0.5) return;
      for (const g of gaps) if (Math.abs(t * l - g) < 5) return;
      // weathered crown: broken courses
      const crown = noise.n2(t * l * 0.15, 2.7) > 0.55 ? -1.2 : 0;
      field.base[k] = Math.max(field.base[k], field.base[k] + hgt + crown);
      field.baseMat[k] = MAT.TILE;
    });
  };
  const anchor = (zn: ZoneDef, a: Anchor, keepR = 0) => {
    zn.anchors.push(a);
    if (keepR > 0) placers[zn.index].keep.push({ x: a.x, z: a.z, r: keepR });
  };
  const faceRiver = (bf: { nx: number; nz: number }) => Math.atan2(-bf.nx, -bf.nz);

  for (const zn of zones) {
    const th = theme(zn.index);
    const span = zoneSpan(zn);
    if (!span) continue;
    const sMid = (span.a + span.b) / 2;
    const top = FP + 1.3;
    switch (th) {
      case 'sphinxGate':
      case 'court':
      case 'throne': {
        // the gate boss's ground: a wide open plaza on the bank, kept clear (the Sphinx lies
        // in the river 34 m upstream of its gate, the plaza beside it)
        const bf = bankFrame(zn, th === 'sphinxGate' && gateS >= 0 ? gateS - 36 : sMid, 0);
        const R = th === 'court' ? 46 : 48;
        const cx = bf.rx + bf.nx * (bf.hw + R + 6), cz = bf.rz + bf.nz * (bf.hw + R + 6);
        const y = th === 'court' ? top : FP + 0.4;
        forRect(field, cx - R - 30, cz - R - 30, cx + R + 30, cz + R + 30, (k, x, z) => {
          const d = Math.hypot(x - cx, z - cz);
          const w = smoothstep(R + 22, R + 2, d);
          if (w <= 0) return;
          field.base[k] = lerp(field.base[k], y + (d > R ? (d - R) * 0.12 : 0), w);
          if (d < R + 1) {
            if (th === 'court') field.baseMat[k] = MAT.TILE;
            else if (th === 'throne') field.baseMat[k] = noise.n2(x * 0.06, z * 0.06) > -0.2 ? MAT.DARK_ROCK : MAT.TILE;
            else field.baseMat[k] = noise.n2(x * 0.05, z * 0.05) > 0.25 ? MAT.TILE : MAT.SAND;
          }
        });
        if (th === 'court') {
          // the plaza runs down to the river as a quay with two ghats for the royal barge
          platform(bf, -1, R + 6, -R * 0.6, R * 0.6, y);
          ghat(bf, 4, -R * 0.5, -R * 0.2, y);
          ghat(bf, 4, R * 0.2, R * 0.5, y);
          // a colonnade ringing the court, open to the river
          const nCol = 22;
          for (let c = 0; c < nCol; c++) {
            const a = (c / nCol) * Math.PI * 2;
            const px = cx + Math.cos(a) * (R + 3), pz = cz + Math.sin(a) * (R + 3);
            if ((px - cx) * bf.nx + (pz - cz) * bf.nz < -R * 0.55) continue;
            anchor(zn, { kind: 'column', x: px, z: pz, rot: a, scale: 1.75, data: { broken: c % 7 === 3 } }, 2.2);
          }
          for (const sd of [-1, 1]) {
            anchor(zn, { kind: 'statue', x: bf.rx + bf.nx * (bf.hw + 8) + bf.tx * sd * R * 0.68, z: bf.rz + bf.nz * (bf.hw + 8) + bf.tz * sd * R * 0.68, rot: faceRiver(bf), scale: 2.6, data: { god: sd < 0 ? 'bastet' : 'ra' } }, 4);
            anchor(zn, { kind: 'obelisk', x: bf.rx + bf.nx * (bf.hw + 3) + bf.tx * sd * 9, z: bf.rz + bf.nz * (bf.hw + 3) + bf.tz * sd * 9, rot: 0, scale: 1.35 }, 2.5);
            anchor(zn, { kind: 'nileDock', x: bf.rx + bf.nx * (bf.hw - 4) + bf.tx * sd * 26, z: bf.rz + bf.nz * (bf.hw - 4) + bf.tz * sd * 26, rot: faceRiver(bf), data: { y: L - 0.85, variant: 2 } }, 4);
          }
          anchor(zn, { kind: 'stoneGate', x: cx + bf.nx * (R + 4), z: cz + bf.nz * (R + 4), rot: faceRiver(bf), scale: 1.8 }, 16);
        } else if (th === 'sphinxGate') {
          // broken causeway paving, toppled obelisks and the old shrine walls at the edge
          for (const sd of [-1, 1]) {
            anchor(zn, { kind: 'obeliskBroken', x: cx + bf.tx * sd * (R + 8), z: cz + bf.tz * sd * (R + 8), rot: rng.range(0, 6.28), scale: 1.5 }, 3);
            anchor(zn, { kind: 'hieroglyphWall', x: cx + bf.nx * (R + 10) + bf.tx * sd * 18, z: cz + bf.nz * (R + 10) + bf.tz * sd * 18, rot: faceRiver(bf), scale: 1.6 }, 6);
          }
          // keep the banks under the river gate's pylons clear
          if (gate) for (const sd of [-1, 1]) placers[zn.index].keep.push({ x: gate.x + Math.cos(gate.yaw) * 16 * sd, z: gate.z - Math.sin(gate.yaw) * 16 * sd, r: 11 });
        } else {
          const nsp = 14;
          for (let c = 0; c < nsp; c++) {
            const a = (c / nsp) * Math.PI * 2 + 0.2;
            anchor(zn, { kind: 'obsidian', x: cx + Math.cos(a) * (R + 6), z: cz + Math.sin(a) * (R + 6), rot: a, scale: 1.6 + (c % 3) * 0.4 }, 3);
          }
          for (const sd of [-1, 1]) anchor(zn, { kind: 'charredObelisk', x: cx + bf.tx * sd * (R - 6) - bf.nx * 6, z: cz + bf.tz * sd * (R - 6) - bf.nz * 6, rot: 0, scale: 1.4 }, 3);
        }
        placers[zn.index].keep.push({ x: cx, z: cz, r: R + 2 });
        zn.anchors.push({ kind: 'bossArena', x: cx, z: cz, data: { r: R - 4, level: y } });
        zn.anchors.push({ kind: 'bossMark', x: cx, z: cz, data: { r: R } });
        zn.pois.push({ kind: 'arena', name: zn.name, x: cx, z: cz, r: R });
        arena = { x: cx, z: cz, r: R, y, zone: zn.index };
        break;
      }
      case 'avenue': {
        // a processional avenue from a ghat on the river up to a pylon, lined with obelisks and statues
        const bf = bankFrame(zn, sMid, 0);
        const len = 64;
        platform(bf, -1, len + 14, -9, 9, top);
        platform(bf, -1, 8, -22, 22, top);
        ghat(bf, 5, -7, 7, top);
        for (let c = 0; c < 6; c++) {
          const f = 16 + c * 8.5;
          for (const sd of [-1, 1]) {
            const x = bf.rx + bf.nx * (bf.hw + f) + bf.tx * sd * 7.5, z = bf.rz + bf.nz * (bf.hw + f) + bf.tz * sd * 7.5;
            anchor(zn, c % 2 === 0 ? { kind: 'obelisk', x, z, rot: 0, scale: 1.2 } : { kind: 'statue', x, z, rot: Math.atan2(-bf.tx * sd, -bf.tz * sd), scale: 1.5, data: { god: c % 4 === 1 ? 'horus' : 'thoth' } }, 2.4);
          }
        }
        const gf = len + 8;
        anchor(zn, { kind: 'stoneGate', x: bf.rx + bf.nx * (bf.hw + gf), z: bf.rz + bf.nz * (bf.hw + gf), rot: faceRiver(bf), scale: 1.7 }, 18);
        for (const sd of [-1, 1]) anchor(zn, { kind: 'nileDock', x: bf.rx + bf.nx * (bf.hw - 4) + bf.tx * sd * 17, z: bf.rz + bf.nz * (bf.hw - 4) + bf.tz * sd * 17, rot: faceRiver(bf), data: { y: L - 0.85 } }, 3.5);
        placers[zn.index].keep.push({ x: bf.rx + bf.nx * (bf.hw + len * 0.5), z: bf.rz + bf.nz * (bf.hw + len * 0.5), r: len * 0.5 + 6 });
        zn.pois.push({ kind: 'temple', name: 'Avenue of Obelisks', x: bf.rx + bf.nx * (bf.hw + gf), z: bf.rz + bf.nz * (bf.hw + gf), r: 20 });
        break;
      }
      case 'hypostyle':
      case 'cinder': {
        // a great hall of columns on a quay platform, its enclosure wall, a pylon at the river
        const burnt = th === 'cinder';
        const bf = bankFrame(zn, sMid, 0);
        const D = 56, Wd = 30;
        platform(bf, -1, D, -Wd, Wd, top);
        ghat(bf, 6, -Wd + 4, -Wd + 16, top);
        ghat(bf, 6, Wd - 16, Wd - 4, top);
        const P0 = (f: number, a: number) => ({ x: bf.rx + bf.nx * (bf.hw + f) + bf.tx * a, z: bf.rz + bf.nz * (bf.hw + f) + bf.tz * a });
        // enclosure (inland three sides), weathered and breached
        const c1 = P0(D, -Wd), c2 = P0(D, Wd), c3 = P0(10, -Wd), c4 = P0(10, Wd);
        wallLine(c3.x, c3.z, c1.x, c1.z, 4.2, 2.2, [20]);
        wallLine(c1.x, c1.z, c2.x, c2.z, 4.2, 2.2, [Wd]);
        wallLine(c4.x, c4.z, c2.x, c2.z, 4.2, 2.2, [26]);
        for (let fi = 0; fi < 5; fi++)
          for (let ai = 0; ai < 6; ai++) {
            if (burnt && hash2(fi, ai) < 0.3) continue;
            const p = P0(16 + fi * 7.5, -18.75 + ai * 7.5);
            const broken = burnt ? hash2(ai, fi + 3) < 0.6 : hash2(fi * 3, ai) < 0.18;
            anchor(zn, { kind: burnt ? 'charredColumn' : 'column', x: p.x, z: p.z, rot: 0, scale: 1.85, data: { broken, variant: broken ? 1 : 0 } }, 2.2);
          }
        const g = P0(7, 0);
        anchor(zn, { kind: burnt ? 'charredObelisk' : 'stoneGate', x: g.x, z: g.z, rot: faceRiver(bf), scale: burnt ? 1.5 : 1.75 }, burnt ? 3 : 17);
        if (!burnt) for (const sd of [-1, 1]) anchor(zn, { kind: 'nileDock', ...P0(-5, sd * (Wd + 9)), rot: faceRiver(bf), data: { y: L - 0.85 } }, 3.5);
        if (burnt) for (const sd of [-1, 1]) anchor(zn, { kind: 'charredStatue', ...P0(4, sd * 14), rot: faceRiver(bf), scale: 2.2, data: { god: 'ra' } }, 3.5);
        const mid = P0(D * 0.5, 0);
        placers[zn.index].keep.push({ x: mid.x, z: mid.z, r: Math.hypot(D * 0.5, Wd) + 4 });
        zn.pois.push({ kind: 'temple', name: burnt ? 'The Cinder Hall' : 'The Hall of Columns', x: mid.x, z: mid.z, r: 30 });
        break;
      }
      case 'colossi': {
        // the quay of the colossi: an embankment with ghats, two seated giants facing the river
        const bf = bankFrame(zn, sMid, 0);
        platform(bf, -1, 26, -46, 46, top);
        ghat(bf, 5, -40, -28, top);
        ghat(bf, 5, 28, 40, top);
        ghat(bf, 5, -6, 6, top);
        const P0 = (f: number, a: number) => ({ x: bf.rx + bf.nx * (bf.hw + f) + bf.tx * a, z: bf.rz + bf.nz * (bf.hw + f) + bf.tz * a });
        for (const sd of [-1, 1]) {
          anchor(zn, { kind: 'nileColossus', ...P0(17, sd * 16), rot: faceRiver(bf), data: { variant: sd < 0 ? 0 : 1, y: top - 0.05 } }, 8);
          anchor(zn, { kind: 'obelisk', ...P0(8, sd * 6), rot: 0, scale: 1.45 }, 2.5);
          anchor(zn, { kind: 'nileDock', ...P0(-5, sd * 52), rot: faceRiver(bf), data: { y: L - 0.85 } }, 3.5);
        }
        const g = P0(24, 0);
        anchor(zn, { kind: 'stoneGate', x: g.x, z: g.z, rot: faceRiver(bf), scale: 1.55 }, 15);
        anchor(zn, { kind: 'hieroglyphWall', ...P0(30, -30), rot: faceRiver(bf), scale: 1.5 }, 6);
        anchor(zn, { kind: 'hieroglyphWall', ...P0(30, 30), rot: faceRiver(bf), scale: 1.5 }, 6);
        const mid = P0(14, 0);
        placers[zn.index].keep.push({ x: mid.x, z: mid.z, r: 48 });
        zn.pois.push({ kind: 'temple', name: 'The Seated Kings', x: mid.x, z: mid.z, r: 30 });
        break;
      }
      case 'cataract': {
        // granite boulders shouldering the rapids, an old shrine on the bluff
        for (let b = 0; b < 26; b++) {
          const s = rng.range(span.a, span.b);
          const q = pointOn(main, s, P);
          const u = rng.range(-0.75, 0.75) * q.hw;
          const x = q.x - q.tz * u, z = q.z + q.tx * u;
          const bed = field.base[Math.round(x) + Math.round(z) * n];
          anchor(zn, { kind: 'boulder', x, z, rot: rng.range(0, 6.28), scale: rng.range(1.6, 2.8), data: { y: bed - 0.3 } }, 0);
        }
        const bf = bankFrame(zn, sMid + 30, 22);
        anchor(zn, { kind: 'hieroglyphWall', x: bf.x, z: bf.z, rot: faceRiver(bf), scale: 1.3 }, 7);
        anchor(zn, { kind: 'column', x: bf.x + bf.tx * 8, z: bf.z + bf.tz * 8, rot: 0, scale: 1.4, data: { broken: true } }, 2);
        anchor(zn, { kind: 'statue', x: bf.x - bf.tx * 8 + bf.nx * 3, z: bf.z - bf.tz * 8 + bf.nz * 3, rot: faceRiver(bf), scale: 1.6, data: { god: 'sekhmet' } }, 3);
        zn.pois.push({ kind: 'shrine', name: 'Shrine of the Cataract', x: bf.x, z: bf.z, r: 14 });
        break;
      }
      case 'fire': {
        for (let b = 0; b < 18; b++) {
          const s = rng.range(span.a, span.b);
          const q = pointOn(main, s, P);
          const u = rng.range(-0.7, 0.7) * q.hw;
          const x = q.x - q.tz * u, z = q.z + q.tx * u;
          anchor(zn, { kind: 'obsidian', x, z, rot: rng.range(0, 6.28), scale: rng.range(1.2, 2.2), data: { y: field.base[Math.round(x) + Math.round(z) * n] - 0.3 } }, 0);
        }
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ corridor blockers: rockfalls dam the river until the zone opens
  for (const zn of zones) {
    if (!zn.corridor || zn.blocker !== 'rockwall') continue;
    const c = zn.corridor;
    const id = `nile_block_${key}_${zn.index}`;
    const dx = c.bx - c.ax, dz = c.bz - c.az, Lc = Math.hypot(dx, dz) || 1;
    const ux = dx / Lc, uz = dz / Lc;
    const len = c.w + 30;
    const stamp: Stamp = {
      id, x0: c.mx - len, z0: c.mz - len, x1: c.mx + len, z1: c.mz + len, weight: 1, replace: true, max: true,
      fn: (x, z) => {
        const ddx = x - c.mx, ddz = z - c.mz;
        const along = ddx * ux + ddz * uz, lat = ddx * -uz + ddz * ux;
        const wob = noise.n2(lat * 0.12, 5.1) * 2.5;
        const t = smoothstep(9, 2, Math.abs(along + wob));
        const l = smoothstep(len * 0.5 + 6, len * 0.5 - 6, Math.abs(lat));
        const crag = 1 + noise.n2(x * 0.22, z * 0.22) * 0.3 + noise.ridged2(x * 0.08, z * 0.08, 2) * 0.4;
        return t * l > 0.01 ? L + 0.5 + t * l * 9 * crag : NaN;
      },
      mat: (_x, _z, v) => (v > L + 1 ? (spec.burned ? MAT.DARK_ROCK : MAT.ROCK) : -1),
    };
    field.stamps.push(stamp);
    zn.blockerStamp = id;
  }

  // final material rules: steep sand turns to rock
  for (let j = 1; j < n - 1; j++)
    for (let i = 1; i < n - 1; i++) {
      const k = i + j * n;
      const m = field.baseMat[k];
      if (m !== MAT.SAND && m !== MAT.RED_SAND && m !== MAT.SAND_DARK) continue;
      const slope = Math.hypot(field.base[k + 1] - field.base[k - 1], field.base[k + n] - field.base[k - n]) * 0.5;
      if (slope > 1.25) field.baseMat[k] = spec.burned ? MAT.DARK_ROCK : MAT.ROCK;
    }
  // a few cooled lava flows on the burnt plain (region C)
  if (spec.burned)
    for (let k = 0; k < n * n; k += 1) {
      const m = field.baseMat[k];
      if (m === MAT.TILE || m === MAT.MUD) continue;
      const x = k % n, z = (k / n) | 0;
      if (field.base[k] < L + 0.3) continue;
      const v = noise.n2(x * 0.018 + 40, z * 0.018 - 13) * 0.75 + noise.n2(x * 0.07, z * 0.07) * 0.25;
      if (v > 0.46) {
        field.baseMat[k] = MAT.DARK_ROCK;
        field.base[k] += smoothstep(0.46, 0.58, v) * 0.35;
      }
    }
  field.waterLevel = L;
  field.finalize();

  // ------------------------------------------------------------------ scatter (on the final ground)
  const hAt = (x: number, z: number) => field.heightAt(x, z);
  /** heading that turns a model's +z toward the middle of the nearest channel */
  const towardWater = (x: number, z: number) => {
    const rh = river.hit(x, z, hit);
    if (!rh) return rng.range(0, Math.PI * 2);
    const sg = rh.u >= 0 ? 1 : -1;
    return Math.atan2(rh.tz * sg, -rh.tx * sg);
  };
  const scatterIn = (zn: ZoneDef, kind: string, count: number, spacing: number, test: (x: number, z: number, e: number, h: number) => boolean, opts: { scale?: [number, number]; data?: (x: number, z: number) => any; rMin?: number; rMax?: number; rot?: (x: number, z: number) => number } = {}) => {
    const pl = placers[zn.index];
    let made = 0;
    for (let t = 0; t < count * 10 && made < count; t++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.range(((opts.rMin ?? 0) / zn.r) ** 2, ((opts.rMax ?? zn.r - 3) / zn.r) ** 2)) * zn.r;
      const x = zn.cx + Math.cos(a) * r, z = zn.cz + Math.sin(a) * r;
      if (!field.inBounds(x, z, 4)) continue;
      if (!pl.free(x, z, spacing)) continue;
      if (zn.mouths.some((mo) => Math.hypot(mo.x - x, mo.z - z) < 14)) continue;
      const e = river.bankDist(x, z);
      const h = hAt(x, z);
      if (!test(x, z, e, h)) continue;
      const sc = opts.scale ? rng.range(opts.scale[0], opts.scale[1]) : rng.range(0.85, 1.2);
      zn.anchors.push({ kind, x, z, rot: opts.rot ? opts.rot(x, z) : rng.range(0, Math.PI * 2), scale: sc, data: opts.data?.(x, z) });
      pl.add(x, z, spacing * 0.5);
      made++;
    }
    return made;
  };
  const dryFlat = (minE: number, maxE: number) => (x: number, z: number, e: number, h: number) => e > minE && e < maxE && h > L + 0.3 && field.slopeAt(x, z) < 0.5 && field.matAt(x, z) !== MAT.TILE;
  const notField = (x: number, z: number, e: number) => {
    const rh = river.hit(x, z, hit);
    return !rh || cropAt(rh, e, zoneOf(x, z).zi) < 0;
  };
  for (const zn of zones) {
    const th = theme(zn.index);
    const K = (zn.r / 64) ** 2;
    const N = (c: number) => Math.max(1, Math.round(c * K));
    const burnt = spec.burned;
    const palmKind = burnt ? 'charredPalm' : 'palm';
    const gate = th === 'sphinxGate' || th === 'court' || th === 'throne';
    // palm groves: clusters along the banks and round the fields
    const groves = gate ? 2 : th === 'palms' || th === 'islands' ? 9 : TEMPLE_THEMES.has(th) ? 4 : 6;
    for (let g = 0; g < groves; g++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(0.2, 0.85) * zn.r;
      const gx = zn.cx + Math.cos(a) * r, gz = zn.cz + Math.sin(a) * r;
      const e = river.bankDist(gx, gz);
      if (e < 4 || e > 70) continue;
      const nP = rng.int(5, 11);
      for (let p = 0; p < nP; p++) {
        const x = gx + rng.range(-12, 12), z = gz + rng.range(-12, 12);
        const ee = river.bankDist(x, z);
        if (ee < 3 || hAt(x, z) < L + 0.35 || !placers[zn.index].free(x, z, 2.2) || !notField(x, z, ee)) continue;
        zn.anchors.push({ kind: palmKind, x, z, rot: rng.range(0, 6.28), scale: rng.range(0.85, 1.3) });
        placers[zn.index].add(x, z, 1.4);
      }
    }
    // lone palms leaning over the water
    scatterIn(zn, palmKind, N(gate ? 3 : 9), 5, (x, z, e, h) => e > 2.5 && e < 9 && h > L + 0.3 && notField(x, z, e), { scale: [0.9, 1.35] });
    if (!burnt) {
      // reed and papyrus beds as placed sprites on the wet margins (the foliage layer fills the rest)
      scatterIn(zn, 'papyrus', N(MARSH_THEMES.has(th) ? 26 : 10), 2.2, (_x, _z, e, h) => e > -3 && e < 3.5 && h < L + 0.7);
      scatterIn(zn, 'oasisFlowers', N(5), 3, (x, z, e, h) => e > 6 && e < 30 && h > L + 0.3 && notField(x, z, e));
      // lily pads in the calm shallows and backwaters
      scatterIn(zn, 'lilyPads', N(MARSH_THEMES.has(th) ? 9 : 3), 4, (x, z, e) => {
        if (e > -1.5) return false;
        const rh = river.hit(x, z, hit);
        return !!rh && (!rh.main || rh.speed < 2.2) && -e < rh.hw * 0.4;
      });
      // field life: farmhouses of mud brick, pots and baskets
      if (FIELD_THEMES.has(th) && !gate) {
        scatterIn(zn, 'ruinWall', N(th === 'shaduf' || th === 'fields' ? 1.6 : 0.6), 18, dryFlat(16, 90), { scale: [0.9, 1.1] });
        scatterIn(zn, 'nileShaduf', N(th === 'shaduf' ? 3 : 1), 10, (x, z, e, h) => e > 1.2 && e < 4.5 && h > L + 0.3, { scale: [0.95, 1.1], rot: towardWater });
      }
      scatterIn(zn, 'nileDock', TEMPLE_THEMES.has(th) || gate ? 0 : rng.int(1, 2), 30, (x, z, e) => e > -5 && e < -2.5, { scale: [1, 1], data: () => ({ y: L - 0.85 }), rot: towardWater });
      scatterIn(zn, 'rock', N(3), 8, dryFlat(25, 200));
    } else {
      scatterIn(zn, 'obsidian', N(th === 'glass' ? 12 : 6), 9, (_x, _z, e, h) => e > 6 && h > L + 0.4, { scale: [0.9, 1.9] });
      scatterIn(zn, 'charredColumn', N(th === 'cinder' ? 3 : 1), 14, dryFlat(10, 80), { scale: [1.2, 1.6], data: () => ({ broken: true, variant: 1 }) });
      scatterIn(zn, 'charredObelisk', N(1), 30, dryFlat(12, 70), { scale: [1.1, 1.4] });
    }
    // temple rubble on the banks of the upper Nile
    if (spec.key === 'B' && !gate) {
      scatterIn(zn, 'column', N(1.2), 12, dryFlat(8, 70), { scale: [1.3, 1.7], data: () => ({ broken: true }) });
      scatterIn(zn, 'obeliskBroken', N(0.5), 26, dryFlat(10, 80), { scale: [1.1, 1.4] });
    }
    scatterIn(zn, 'pot', N(1.4), 6, dryFlat(3, 80));
    scatterIn(zn, 'chest', 3, 12, dryFlat(6, 120), { rMin: zn.r * 0.2 });
  }
  // the tortoise shopkeeper's camp (the first shop of the run), within sight of the start
  const st = (() => {
    const span = zoneSpan(z0, 10);
    const s = span ? span.a + 16 : 40;
    const bf = bankFrame(z0, s, 1.5);
    return { x: bf.x, z: bf.z, heading: Math.atan2(bf.tx - bf.nx * 0.35, bf.tz - bf.nz * 0.35), bf };
  })();
  {
    const bf = st.bf;
    for (let tries = 0; tries < 30; tries++) {
      const along = rng.range(34, 70), inland = rng.range(14, 30);
      const x = bf.rx + bf.nx * (bf.hw + inland) + bf.tx * along, z = bf.rz + bf.nz * (bf.hw + inland) + bf.tz * along;
      if (!placers[0].free(x, z, 9) || hAt(x, z) < L + 0.4 || field.slopeAt(x, z) > 0.35) continue;
      flatten(field, x, z, 7, MAT.DIRT);
      z0.anchors.push({ kind: 'landmark', x, z, rot: Math.atan2(st.z - z, st.x - x), data: { type: 'tradingPost', name: 'Trading Post', mission: '' } });
      z0.pois.push({ kind: 'landmark', name: 'Trading Post', x, z, r: 10, data: { type: 'tradingPost' } });
      placers[0].keep.push({ x, z, r: 10 });
      break;
    }
  }
  // room for the other systems: wildlife herds by the water, treasure dig spots near the sights
  for (const zn of zones) {
    const rand = () => rng.next();
    const gate = arena && arena.zone === zn.index;
    if (!gate)
      for (let i = 0; i < 2; i++) {
        const p = findOpenSpot(zn, field, 14, { rand, minDist: zn.r * 0.2, maxDist: zn.r * 0.85, maxSlope: 0.3, strict: false });
        if (p) zn.anchors.push({ kind: 'wildlifeSpot', x: p.x, z: p.z, data: { r: 14, habitat: spec.burned ? 'bones' : 'oasis', y: p.y } });
      }
    for (let i = 0, made = 0; made < 4 && i < 8; i++) {
      const near = zn.pois.length && rng.chance(0.5) ? rng.pick(zn.pois) : null;
      const p = findOpenSpot(zn, field, 2.5, { rand, near: near ?? undefined, minDist: near ? near.r * 0.5 : 0, maxDist: near ? near.r + 16 : undefined, maxSlope: 0.45, tries: 40 });
      if (p) {
        zn.anchors.push({ kind: 'digSpot', x: p.x, z: p.z, data: { r: 2.5, y: p.y, near: near?.name } });
        made++;
      }
    }
  }
  field.finalize();

  const fieldAt = (x: number, z: number) => {
    const e = river.bankDist(x, z);
    if (e < 5 || e > 90) return -1;
    const rh = river.hit(x, z, hit);
    return rh ? cropAt(rh, e, zoneOf(x, z).zi) : -1;
  };
  const burnedArea = spec.burned;
  const fh: FoliageHint = { dens: 0, grp: 'dry' };
  const foliage = (x: number, z: number, h: number, mat: number, pick: number): FoliageHint | null => {
    if (burnedArea) {
      // the burnt land: scorched stubble, the odd dead bush
      fh.dens = mat === MAT.DARK_ROCK || mat === MAT.TILE ? 0 : 0.05;
      fh.grp = pick < 0.6 ? 'dead' : 'dry';
      return fh;
    }
    const e = river.bankDist(x, z);
    if (h < L + 0.06) {
      // standing in the water: papyrus and reeds in the shallows only
      const depth = L - h;
      if (depth < 0.45 && e > -6) {
        fh.dens = e > -2.5 ? 1.0 : 0.35;
        fh.grp = pick < 0.55 ? 'papyrus' : 'reed';
        return fh;
      }
      fh.dens = 0;
      return fh;
    }
    if (mat === MAT.MUD) {
      fh.dens = e < 4 ? 1.6 : 0.9;
      fh.grp = pick < 0.5 ? 'papyrus' : pick < 0.85 ? 'reed' : 'turf';
      return fh;
    }
    if (mat === MAT.GRASS || mat === MAT.DIRT) {
      const ck = e > 5 && e < 90 ? fieldAt(x, z) : -1;
      if (ck === 0 || ck === 2) {
        // planted rows (along the river), the furrows between them bare
        const rh = river.hit(x, z, hit);
        const row = rh ? fract((rh.d - rh.hw) / 0.9) : 0;
        fh.dens = row < 0.5 ? 4.2 : 0.15;
        fh.grp = ck === 2 ? (pick < 0.3 ? 'flower' : 'crop') : 'crop';
        return fh;
      }
      if (ck === 1) {
        fh.dens = 0.05;
        fh.grp = 'dry';
        return fh;
      }
    }
    return null;
  };

  console.log(`[nile] ${key}: ${channels.length} channels (${(main.s[main.n - 1] | 0)} m main), river ${(tRiver - t0).toFixed(0)} ms, terrain ${(tTerr - tRiver).toFixed(0)} ms, all ${(performance.now() - t0).toFixed(0)} ms`);
  const nile: NileInfo = { key, level: L, river, burned: spec.burned, themes: spec.zones.map((z) => z.theme), arena, gate, fieldAt, foliage };
  return {
    key,
    name: spec.name,
    subtitle: spec.subtitle,
    size: S,
    seed,
    zones,
    field,
    wind,
    waterLevel: L,
    env: spec.env,
    start: { x: st.x, z: st.z, heading: st.heading },
    nile,
  };
}

/** point + tangent on a channel at arc length s */
function pointOn(c: NileChannel, s: number, out: { x: number; z: number; tx: number; tz: number; hw: number }) {
  const S = c.s;
  s = Math.max(0, Math.min(S[c.n - 1], s));
  let lo = 0, hi = c.n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (S[m] <= s) lo = m;
    else hi = m;
  }
  const seg = S[hi] - S[lo] || 1e-6;
  const t = (s - S[lo]) / seg;
  out.x = c.x[lo] + (c.x[hi] - c.x[lo]) * t;
  out.z = c.z[lo] + (c.z[hi] - c.z[lo]) * t;
  out.tx = (c.x[hi] - c.x[lo]) / seg;
  out.tz = (c.z[hi] - c.z[lo]) / seg;
  out.hw = c.hw[lo] + (c.hw[hi] - c.hw[lo]) * t;
  return out;
}

function flatten(field: Heightfield, cx: number, cz: number, r: number, mat: number) {
  let s = 0, c = 0;
  for (let a = 0; a < 12; a++) {
    s += field.heightAt(cx + Math.cos(a) * r * 0.6, cz + Math.sin(a) * r * 0.6);
    c++;
  }
  const h0 = s / c;
  forRect(field, cx - r - 6, cz - r - 6, cx + r + 6, cz + r + 6, (k, x, z) => {
    const w = smoothstep(r + 6, r, Math.hypot(x - cx, z - cz));
    if (w <= 0) return;
    field.base[k] = lerp(field.base[k], h0, w);
    if (w > 0.6) field.baseMat[k] = mat;
  });
}
