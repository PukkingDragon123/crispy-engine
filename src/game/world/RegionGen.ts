// Procedural region generator with rules: zone layout (non-overlapping snake
// path), wind-shaped transverse dunes, themed zone sculpting (canyons, temples,
// outposts, craters, mesas, oasis lakes, pyramids), corridors and blockers.
import { Heightfield, MAT, Stamp } from './Heightfield';
import { Noise, RNG, smoothstep, clamp, lerp } from '../../engine/math/rand';

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
  dir: number; // heading from previous zone (radians)
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
  env: 'dunes' | 'oasis' | 'pyramid';
  start: { x: number; z: number; heading: number };
}

interface SubAreaSpec {
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
  A: {
    key: 'A',
    name: 'The Bonewind Dunes',
    subtitle: "Serket's Reach — Outer Sands",
    size: 760,
    waveStart: 1,
    env: 'dunes',
    water: -1000,
    zones: [
      { name: 'Sundown Flats', theme: 'flats', r: 62, blocker: 'storm' },
      { name: 'Rattlesnake Canyon', theme: 'canyon', r: 66, blocker: 'rockwall' },
      { name: 'The Bone Garden', theme: 'bones', r: 62, blocker: 'bones' },
      { name: 'Sunken Temple of Thoth', theme: 'temple', r: 64, blocker: 'dune' },
      { name: 'Outlaw Gulch', theme: 'outpost', r: 62, blocker: 'rockwall' },
      { name: 'The Glass Dunes', theme: 'glassdunes', r: 70, blocker: 'storm' },
      { name: 'Scarab Hollows', theme: 'hollows', r: 64, blocker: 'dune' },
      { name: 'Field of Needles', theme: 'obelisks', r: 62, blocker: 'gate' },
      { name: 'Mesa Steps', theme: 'mesas', r: 66, blocker: 'rockwall' },
      { name: 'Red Mesa Arena', theme: 'arena', r: 60, blocker: 'storm' },
    ],
  },
  B: {
    key: 'B',
    name: 'The Mirage Oasis',
    subtitle: "Serket's Reach — Waters of Sekhmet",
    size: 560,
    waveStart: 51,
    env: 'oasis',
    water: 3.2,
    zones: [
      { name: 'Palm Shore', theme: 'palmshore', r: 64, blocker: 'storm' },
      { name: 'Reedwater Marsh', theme: 'marsh', r: 62, blocker: 'dune' },
      { name: 'Drowned Ruins', theme: 'floodruins', r: 62, blocker: 'gate' },
      { name: 'Lotus Temple', theme: 'lotustemple', r: 64, blocker: 'rockwall' },
      { name: 'Heart of the Oasis', theme: 'oasisheart', r: 62, blocker: 'storm' },
    ],
  },
  C: {
    key: 'C',
    name: 'The Red Pyramid',
    subtitle: "Serket's Reach — Throne of Set",
    size: 560,
    waveStart: 76,
    env: 'pyramid',
    water: -1000,
    zones: [
      { name: 'Eye of the Storm', theme: 'stormapproach', r: 66, blocker: 'storm' },
      { name: 'Avenue of Sphinxes', theme: 'sphinxavenue', r: 64, blocker: 'gate' },
      { name: 'Foot of the Pyramid', theme: 'pyramidbase', r: 68, blocker: 'rockwall' },
      { name: 'The Terraces', theme: 'pyramidterraces', r: 62, blocker: 'dune' },
      { name: 'Apex of Set', theme: 'apex', r: 56, blocker: 'storm' },
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

/** zone layout: non-overlapping random snake inside the square */
function layoutZones(spec: SubAreaSpec, rng: RNG): ZoneDef[] {
  const S = spec.size;
  const margin = 70;
  for (let attempt = 0; attempt < 400; attempt++) {
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
        for (let k = 0; k < 40 && !placed; k++) {
          const h = heading + rng.range(-1.1, 1.1);
          const corridor = rng.range(16, 26);
          const d = prev.r + zs.r + corridor;
          const nx = prev.cx + Math.cos(h) * d;
          const nz = prev.cz + Math.sin(h) * d;
          if (nx < margin + zs.r * 0.6 || nx > S - margin - zs.r * 0.6 || nz < margin + zs.r * 0.6 || nz > S - margin - zs.r * 0.6) continue;
          let clash = false;
          for (let j = 0; j < i - 1; j++) {
            const o = zones[j];
            if (Math.hypot(o.cx - nx, o.cz - nz) < o.r + zs.r + 34) {
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
      zones.push({ index: i, name: zs.name, theme: zs.theme, cx, cz, r: zs.r, waves, anchors: [], blocker: i > 0 ? zs.blocker : undefined, dir: heading });
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
      b.corridor = { ax, az, bx, bz, mx: (ax + bx) / 2, mz: (az + bz) / 2, w: 26 };
      b.dir = Math.atan2(dz, dx);
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

  const n = field.n;
  const zoneW = new Float32Array(zones.length);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i * field.res,
        z = j * field.res;
      let h = 8 + broad(x, z) + duneH(x, z, glassDunes);
      let m: number = MAT.SAND;
      // macro color variation of sand
      const tint = noise.n2(x * 0.006 + 11, z * 0.006 - 5);
      if (tint > 0.45) m = MAT.RED_SAND;
      // map edge: rise into unreachable dunes/cliffs
      const edge = Math.min(x, z, S - x, S - z);
      if (edge < 40) h += (1 - edge / 40) * (1 - edge / 40) * 30;
      // rock outcrops outside zones (buttes) for silhouette
      const butte = noise.ridged2(x * 0.0042 + 5, z * 0.0042 - 2, 2);
      // zone influence
      let zoneMax = 0;
      for (let zi = 0; zi < zones.length; zi++) {
        const zn = zones[zi];
        const d = Math.hypot(x - zn.cx, z - zn.cz);
        zoneW[zi] = smoothstep(zn.r + 26, zn.r - 6, d);
        if (zoneW[zi] > zoneMax) zoneMax = zoneW[zi];
      }
      // corridors
      let corrW = 0;
      for (const zn of zones) {
        if (!zn.corridor) continue;
        const c = zn.corridor;
        const { d } = distSeg(x, z, c.ax, c.az, c.bx, c.bz);
        corrW = Math.max(corrW, smoothstep(c.w * 0.5 + 14, c.w * 0.5 - 2, d));
      }
      const playable = Math.max(zoneMax, corrW);
      if (butte > 0.8 && playable < 0.2) {
        const bh = smoothstep(0.8, 0.83, butte) * (12 + 8 * (noise.n2(x * 0.01, z * 0.01 + 9) * 0.5 + 0.5)) + Math.floor(smoothstep(0.83, 0.95, butte) * 3) * 2.5;
        h += bh * (1 - playable * 5);
        if (bh > 1.2) m = MAT.ROCK;
      }
      // soften dunes inside playable space a bit so arenas are rideable
      if (playable > 0) {
        const soft = 8 + broad(x, z) * 0.6 + duneH(x, z, glassDunes) * 0.75;
        h = lerp(h, soft, playable * 0.5);
      }
      field.base[i + j * n] = h;
      field.baseMat[i + j * n] = m;
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
      const target = lerp(ha, hb, smoothstep(0, 1, t)) + Math.sin(t * Math.PI) * 1.5 + noise.n2(x * 0.05, z * 0.05) * 0.8;
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

function scatter(ctx: ThemeCtx, zn: ZoneDef, kind: string, count: number, minR: number, maxR: number, minSpacing = 6, extra?: (a: Anchor) => void) {
  const out: Anchor[] = [];
  for (let k = 0; k < count * 6 && out.length < count; k++) {
    const a = ctx.rng.range(0, Math.PI * 2);
    const r = Math.sqrt(ctx.rng.range((minR / zn.r) ** 2, (maxR / zn.r) ** 2)) * zn.r;
    const x = zn.cx + Math.cos(a) * r,
      z = zn.cz + Math.sin(a) * r;
    if (zn.anchors.some((o) => Math.hypot(o.x - x, o.z - z) < minSpacing)) continue;
    const an: Anchor = { kind, x, z, rot: ctx.rng.range(0, Math.PI * 2), scale: ctx.rng.range(0.85, 1.25) };
    extra?.(an);
    zn.anchors.push(an);
    out.push(an);
  }
  return out;
}

const WOOD_SINGLES = ['fenceBroken', 'signpost', 'hitchingPost', 'wagonWheel', 'cattleSkullPost', 'whiskeyBarrel', 'tntCrate', 'crate', 'barrel', 'mineCart'];
const WOOD_LANDMARKS = ['windmill', 'waterTower', 'outhouse', 'gallows', 'mineEntrance', 'saloonFacade', 'sheriffFacade', 'storeFacade', 'wagon'];

/** weathered Wild West wood everywhere: singles, a landmark and an outlaw camp per zone */
function woodScatter(ctx: ThemeCtx, zn: ZoneDef) {
  const { rng } = ctx;
  const R = zn.r;
  for (const k of WOOD_SINGLES) if (rng.chance(0.75)) scatter(ctx, zn, k, rng.int(1, 3), 8, R - 4, 7);
  // fence runs
  for (let f = 0; f < 3; f++) {
    const a = rng.range(0, Math.PI * 2), r0 = rng.range(R * 0.3, R * 0.85);
    const x = zn.cx + Math.cos(a) * r0, z = zn.cz + Math.sin(a) * r0;
    const dir = a + Math.PI / 2 + rng.range(-0.3, 0.3);
    const len = rng.int(3, 6);
    for (let i = 0; i < len; i++) {
      if (rng.chance(0.2)) continue;
      zn.anchors.push({ kind: rng.chance(0.3) ? 'fenceBroken' : 'fence', x: x + Math.cos(dir) * i * 3.1, z: z + Math.sin(dir) * i * 3.1, rot: dir });
    }
  }
  const lm = rng.shuffle(WOOD_LANDMARKS.slice()).slice(0, rng.int(2, 3));
  for (const k of lm) scatter(ctx, zn, k, 1, R * 0.35, R - 10, 18);
  // outlaw camp cluster
  const a = rng.range(0, Math.PI * 2), r = rng.range(R * 0.35, R * 0.7);
  outlawCamp(ctx, zn, zn.cx + Math.cos(a) * r, zn.cz + Math.sin(a) * r);
}

function outlawCamp(ctx: ThemeCtx, zn: ZoneDef, x: number, z: number) {
  const { rng } = ctx;
  if (zn.anchors.some((o) => Math.hypot(o.x - x, o.z - z) < 8)) return;
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
  const x0 = zn.cx - R - 30,
    x1 = zn.cx + R + 30,
    z0 = zn.cz - R - 30,
    z1 = zn.cz + R + 30;
  const wAt = (x: number, z: number, inner = 0) => smoothstep(R + 24, R - 6 - inner, Math.hypot(x - zn.cx, z - zn.cz));
  const baseAvg = avgBase(field, zn.cx, zn.cz, R * 0.6);
  // common sprinkles: mostly weathered outlaw wood + cacti
  const commonProps = (cact = 10, rocks = 8) => {
    scatter(ctx, zn, 'cactus', cact + 4, 10, R - 4, 7);
    scatter(ctx, zn, 'rock', Math.max(2, rocks - 3), 8, R - 2, 8);
    scatter(ctx, zn, 'bush', 6, 6, R - 2, 5);
    // the desert is full of dead brush and dry grass
    scatter(ctx, zn, 'deadBush', 34, 4, R + 6, 3.2);
    scatter(ctx, zn, 'dryGrass', 46, 3, R + 6, 2.2);
    scatter(ctx, zn, 'tumbleweed', 5, 6, R - 8, 10);
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
      zn.anchors.push({ kind: 'shack', x: home.x, z: home.z, rot: zn.dir + 0.4 });
      zn.anchors.push({ kind: 'wagon', x: home.x + 9, z: home.z - 4, rot: zn.dir - 1.2 });
      zn.anchors.push({ kind: 'campfire', x: zn.cx - 6, z: zn.cz - R * 0.45, rot: 0 });
      zn.anchors.push({ kind: 'wantedBoard', x: zn.cx + 5, z: zn.cz - R * 0.45 + 4, rot: zn.dir - Math.PI / 2 });
      zn.anchors.push({ kind: 'dumbScarab', x: zn.cx + 12, z: zn.cz - 10 });
      zn.anchors.push({ kind: 'totem', x: zn.cx - R * 0.3, z: zn.cz + R * 0.3 });
      flattenDisc(field, home.x, home.z, 10, 0.9, MAT.DIRT, noise);
      commonProps(16, 10);
      scatter(ctx, zn, 'skull', 3, 10, R - 6, 10);
      break;
    }
    case 'canyon': {
      // spine through zone along travel direction with lateral meander
      const pts: [number, number][] = [];
      for (let t = -1.3; t <= 1.3; t += 0.1) {
        const f = t * R;
        const s = Math.sin(t * 2.4 + rng.range(0, 1)) * R * 0.22;
        const p = fr.toWorld(f, s);
        pts.push([p.x, p.z]);
      }
      const floor = baseAvg - 1.5;
      const mesa = floor + 13;
      const ramps: { x: number; z: number; len: number; dirx: number; dirz: number }[] = [];
      forRect(field, x0, z0, x1, z1, (k, x, z) => {
        const w = wAt(x, z, 4);
        if (w <= 0) return;
        let d = 1e9,
          along = 0;
        for (let p = 0; p < pts.length - 1; p++) {
          const r = distSeg(x, z, pts[p][0], pts[p][1], pts[p + 1][0], pts[p + 1][1]);
          if (r.d < d) {
            d = r.d;
            along = p + r.t;
          }
        }
        const halfW = 10 + 4 * noise.n2(along * 0.25, 2.2);
        const wall = smoothstep(halfW, halfW + 2.6, d);
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
      // sand ramps leaning on walls (launch onto mesas)
      for (let r = 0; r < 4; r++) {
        const t = rng.range(-0.7, 0.7);
        const side = r % 2 ? 1 : -1;
        const base = fr.toWorld(t * R, side * 6);
        const out = fr.toWorld(t * R, side * 22);
        ramps.push({ x: base.x, z: base.z, len: 18, dirx: (out.x - base.x) / 16, dirz: (out.z - base.z) / 16 });
      }
      for (const rp of ramps) {
        forRect(field, rp.x - 26, rp.z - 26, rp.x + 26, rp.z + 26, (k, x, z) => {
          const dx = x - rp.x,
            dz = z - rp.z;
          const along = dx * rp.dirx + dz * rp.dirz;
          const lat = Math.abs(dx * -rp.dirz + dz * rp.dirx);
          if (along < 0 || along > rp.len || lat > 5.5) return;
          const hh = floor + (along / rp.len) * (mesa - floor + 1.5) * smoothstep(5.5, 3.5, lat);
          if (hh > field.base[k]) {
            field.base[k] = hh;
            field.baseMat[k] = MAT.SAND;
          }
        });
      }
      scatter(ctx, zn, 'rock', 12, 6, R - 4, 8);
      scatter(ctx, zn, 'cactus', 8, 4, R - 4, 8);
      scatter(ctx, zn, 'skull', 2, 4, R - 10, 10);
      scatter(ctx, zn, 'boulder', 3, 4, R * 0.6, 14, (a) => (a.data = { rolling: true }));
      scatter(ctx, zn, 'mineEntrance', 1, 6, R - 6, 20);
      scatter(ctx, zn, 'mineCart', 3, 4, R - 6, 8);
      scatter(ctx, zn, 'tntCrate', 4, 4, R - 6, 6);
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
      for (let i = 0; i < 4; i++) {
        const p = fr.toWorld(rng.range(-0.6, 0.6) * R, rng.range(-0.5, 0.5) * R);
        zn.anchors.push({ kind: 'ribArch', x: p.x, z: p.z, rot: zn.dir + rng.range(-0.4, 0.4), scale: rng.range(0.9, 1.2) });
      }
      scatter(ctx, zn, 'giantSkull', 2, 12, R - 10, 24);
      scatter(ctx, zn, 'boneScatter', 10, 4, R - 4, 8);
      scatter(ctx, zn, 'skull', 6, 4, R - 4, 8);
      commonProps(6, 6);
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(-R * 0.3, R * 0.25) });
      break;
    }
    case 'temple':
    case 'lotustemple': {
      const sid = `rise_${ctx.spec.key}_${zn.index}`;
      const W = 46,
        D = 34,
        H = 2.6;
      const top = baseAvg + H;
      const plinth: Stamp = {
        id: sid,
        x0: zn.cx - 50,
        z0: zn.cz - 50,
        x1: zn.cx + 50,
        z1: zn.cz + 50,
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
      for (let c = -3; c <= 3; c++) {
        for (const side of [-1, 1]) {
          const p = fr.toWorld(c * 4.6, side * (W / 2 - 3));
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
      if (zn.theme === 'lotustemple') {
        for (let p = 0; p < 4; p++) {
          const q = fr.toWorld(rng.range(-R * 0.7, R * 0.7), rng.range(-R * 0.7, R * 0.7));
          carvePool(field, q.x, q.z, rng.range(8, 13), ctx.spec.water - 1.2);
        }
        scatter(ctx, zn, 'palm', 10, R * 0.6, R - 4, 9);
      } else {
        scatter(ctx, zn, 'hieroglyphWall', 4, R * 0.55, R - 6, 14);
        commonProps(6, 6);
      }
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(R * 0.55, R * 0.4) });
      break;
    }
    case 'outpost': {
      flattenDisc(field, zn.cx, zn.cz, 30, 1, MAT.DIRT, noise);
      // berm ring
      forRect(field, x0, z0, x1, z1, (k, x, z) => {
        const d = Math.hypot(x - zn.cx, z - zn.cz);
        const berm = Math.exp(-((d - 40) ** 2) / 40) * 3.5;
        field.base[k] += berm * wAt(x, z);
      });
      const ring = 7;
      for (let i = 0; i < ring; i++) {
        const a = zn.dir + (i / ring) * Math.PI * 2 + 0.3;
        const r = 20 + rng.range(-2, 3);
        zn.anchors.push({ kind: i % 3 === 2 ? 'tent' : 'shack', x: zn.cx + Math.cos(a) * r, z: zn.cz + Math.sin(a) * r, rot: a + Math.PI });
      }
      zn.anchors.push({ kind: 'watchtower', x: zn.cx + 6, z: zn.cz - 5, rot: 0 });
      zn.anchors.push({ kind: 'well', x: zn.cx - 4, z: zn.cz + 3, rot: 0 });
      zn.anchors.push({ kind: 'wantedBoard', x: zn.cx + 2, z: zn.cz + 8, rot: zn.dir });
      zn.anchors.push({ kind: 'wagon', x: zn.cx - 12, z: zn.cz - 8, rot: 1.1 });
      zn.anchors.push({ kind: 'campfire', x: zn.cx, z: zn.cz, rot: 0 });
      for (let i = 0; i < 10; i++) {
        const a = rng.range(0, Math.PI * 2),
          r = rng.range(8, 26);
        zn.anchors.push({ kind: rng.chance(0.6) ? 'crate' : 'barrel', x: zn.cx + Math.cos(a) * r, z: zn.cz + Math.sin(a) * r, rot: rng.range(0, 6.28) });
      }
      for (let i = 0; i < 6; i++) {
        const a = zn.dir + (i / 6) * Math.PI * 2;
        zn.anchors.push({ kind: 'fence', x: zn.cx + Math.cos(a) * 31, z: zn.cz + Math.sin(a) * 31, rot: a + Math.PI / 2 });
      }
      commonProps(8, 6);
      break;
    }
    case 'glassdunes':
    case 'stormapproach': {
      forRect(field, x0, z0, x1, z1, (k, x, z) => {
        const w = wAt(x, z);
        if (w <= 0) return;
        const u = x * ctx.wind.x + z * ctx.wind.z;
        const ph = u / 42 + noise.n2(x * 0.01, z * 0.01) * 0.8;
        const t = ph - Math.floor(ph);
        const prof = t < 0.72 ? Math.pow(t / 0.72, 1.6) : 1 - smoothstep(0, 1, (t - 0.72) / 0.28);
        const amp = zn.theme === 'stormapproach' ? 11 : 9;
        field.base[k] = lerp(field.base[k], baseAvg - 2 + prof * amp * (0.7 + 0.3 * noise.n2(x * 0.02, z * 0.02)), w * 0.9);
        if (w > 0.5 && t > 0.6 && t < 0.78 && zn.theme === 'glassdunes') field.baseMat[k] = MAT.SAND_DARK;
      });
      scatter(ctx, zn, 'rock', 5, 8, R - 2, 10);
      scatter(ctx, zn, 'tumbleweed', 8, 6, R - 8, 10);
      woodScatter(ctx, zn);
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(0, R * 0.3) });
      if (zn.theme === 'stormapproach') scatter(ctx, zn, 'obeliskBroken', 4, 10, R - 8, 20);
      break;
    }
    case 'hollows': {
      const craters = 4;
      for (let c = 0; c < craters; c++) {
        const p = fr.toWorld(rng.range(-0.55, 0.55) * R, rng.range(-0.55, 0.55) * R);
        const cr = rng.range(11, 17),
          depth = rng.range(5, 8);
        forRect(field, p.x - cr * 1.6, p.z - cr * 1.6, p.x + cr * 1.6, p.z + cr * 1.6, (k, x, z) => {
          const d = Math.hypot(x - p.x, z - p.z) / cr;
          const bowl = d < 1 ? -depth * (1 - d * d) : 0;
          const rim = Math.exp(-((d - 1.05) ** 2) / 0.02) * 1.6;
          field.base[k] += (bowl + rim) * wAt(x, z);
          if (d < 0.75) field.baseMat[k] = MAT.SAND_DARK;
        });
        zn.anchors.push({ kind: 'scarabNest', x: p.x, z: p.z });
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
        const av = smoothstep(avenueW + 4, avenueW, Math.abs(s));
        field.base[k] = lerp(field.base[k], baseAvg + f * 0.02 + (field.base[k] - baseAvg) * 0.4, w * Math.max(0.5, av));
        if (av > 0.5 && w > 0.5) field.baseMat[k] = (Math.floor(f / 2) + Math.floor(s / 2)) % 2 === 0 ? MAT.TILE : MAT.SAND_DARK;
      });
      for (let i = -4; i <= 4; i++) {
        for (const side of [-1, 1]) {
          const p = fr.toWorld(i * 11, side * (avenueW + 3));
          zn.anchors.push({ kind: zn.theme === 'sphinxavenue' ? 'sphinx' : i % 3 === 0 ? 'obeliskBroken' : 'obelisk', x: p.x, z: p.z, rot: zn.dir + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
        }
      }
      commonProps(6, 6);
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(R * 0.3, R * 0.45) });
      break;
    }
    case 'mesas': {
      const tiers = 4;
      const centers: { x: number; z: number; r: number; h: number }[] = [];
      for (let t = 0; t < tiers; t++) {
        const p = fr.toWorld(rng.range(-0.5, 0.5) * R, rng.range(-0.55, 0.55) * R);
        centers.push({ x: p.x, z: p.z, r: rng.range(12, 18), h: baseAvg + 3 + t * 2.6 });
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
        const a = rng.range(0, Math.PI * 2);
        const dirx = Math.cos(a),
          dirz = Math.sin(a);
        const sx = c.x + dirx * (c.r + 14),
          sz = c.z + dirz * (c.r + 14);
        forRect(field, c.x - c.r - 20, c.z - c.r - 20, c.x + c.r + 20, c.z + c.r + 20, (k, x, z) => {
          const dx = x - sx,
            dz = z - sz;
          const along = -(dx * dirx + dz * dirz);
          const lat = Math.abs(-dx * dirz + dz * dirx);
          if (along < 0 || along > 15 || lat > 5) return;
          const hh = lerp(field.base[k], c.h, along / 15) * smoothstep(5, 3.5, lat) + field.base[k] * (1 - smoothstep(5, 3.5, lat));
          if (hh > field.base[k]) {
            field.base[k] = hh;
            field.baseMat[k] = MAT.SAND;
          }
        });
      }
      scatter(ctx, zn, 'cactus', 10, 6, R - 4, 8);
      scatter(ctx, zn, 'rock', 4, 6, R - 2, 10);
      woodScatter(ctx, zn);
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(0, 0) });
      break;
    }
    case 'arena':
    case 'oasisheart':
    case 'apex': {
      const ar = zn.theme === 'apex' ? 44 : 46;
      const top = zn.theme === 'apex' ? baseAvg + 28 : baseAvg;
      forRect(field, x0, z0, x1, z1, (k, x, z) => {
        const d = Math.hypot(x - zn.cx, z - zn.cz);
        const w = wAt(x, z);
        if (w <= 0) return;
        // bowl with rideable rim (quarter pipe)
        const bowl = d < ar ? top + Math.pow(d / ar, 3) * 4.5 : top + 4.5 + (d - ar) * (zn.theme === 'apex' ? -0.9 : 0.15);
        field.base[k] = lerp(field.base[k], bowl, zn.theme === 'apex' ? Math.max(w, d < ar + 20 ? 1 : w) : w);
        if (d < ar - 3) field.baseMat[k] = zn.theme === 'oasisheart' ? MAT.GRASS : zn.theme === 'apex' ? MAT.TILE : MAT.RED_SAND;
      });
      if (zn.theme === 'oasisheart') {
        // island in lake: carve ring of water
        forRect(field, x0, z0, x1, z1, (k, x, z) => {
          const d = Math.hypot(x - zn.cx, z - zn.cz);
          if (d > ar + 4 && d < ar + 18) {
            const t = 1 - Math.abs(d - (ar + 11)) / 7;
            field.base[k] = Math.min(field.base[k], lerp(field.base[k], ctx.spec.water - 1.5, clamp(t * 1.5, 0, 1)));
            field.baseMat[k] = MAT.MUD;
          }
        });
        scatter(ctx, zn, 'palm', 12, ar - 12, ar - 2, 7);
      }
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        zn.anchors.push({ kind: zn.theme === 'apex' ? 'obelisk' : 'rock', x: zn.cx + Math.cos(a) * (ar + 4), z: zn.cz + Math.sin(a) * (ar + 4), rot: a, scale: 1.4 });
      }
      zn.anchors.push({ kind: 'bossMark', x: zn.cx, z: zn.cz });
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
          const lake = smoothstep(-5, 25, f + noise.n2(x * 0.03, z * 0.03) * 12);
          h = lerp(h, water - 2.5, lake * 0.95);
        } else if (zn.theme === 'marsh') {
          const ch = Math.abs(noise.n2(x * 0.018, z * 0.018));
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
      scatter(ctx, zn, 'palm', zn.theme === 'marsh' ? 10 : 18, 6, R - 3, 7);
      scatter(ctx, zn, 'reeds', 16, 4, R - 3, 5);
      woodScatter(ctx, zn);
      if (zn.theme === 'floodruins') {
        scatter(ctx, zn, 'ruinWall', 8, 8, R - 6, 12);
        scatter(ctx, zn, 'column', 8, 6, R - 6, 9, (a) => (a.data = { broken: true }));
      }
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(0, R * 0.2) });
      break;
    }
    case 'pyramidbase':
    case 'pyramidterraces': {
      // giant stepped pyramid sits beyond the zone (pyramidbase) or the zone climbs its terraces
      const big = zn.theme === 'pyramidbase';
      const pc = fr.toWorld(big ? R * 0.95 : 0, big ? R * 0.55 : 0);
      const half = big ? 70 : 52;
      const height = big ? 46 : 26;
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
      if (!big) {
        // ramps of sand to climb terraces
        for (let r = 0; r < 4; r++) {
          const a = zn.dir + (r * Math.PI) / 2;
          const dirx = Math.cos(a),
            dirz = Math.sin(a);
          forRect(field, pc.x - half - 10, pc.z - half - 10, pc.x + half + 10, pc.z + half + 10, (k, x, z) => {
            const dx = x - pc.x,
              dz = z - pc.z;
            const along = dx * dirx + dz * dirz;
            const lat = Math.abs(-dx * dirz + dz * dirx);
            if (lat > 5 || along < 0 || along > half + 8) return;
            const hh = baseAvg + height * (1 - along / (half + 8));
            if (hh > field.base[k] - 0.5) {
              field.base[k] = Math.max(field.base[k], hh);
              field.baseMat[k] = MAT.SAND;
            }
          });
        }
      }
      zn.anchors.push({ kind: 'capstone', x: pc.x, z: pc.z, data: { y: baseAvg + height } });
      scatter(ctx, zn, 'obeliskBroken', 3, 10, R - 6, 16);
      scatter(ctx, zn, 'rock', 4, 10, R - 2, 10);
      woodScatter(ctx, zn);
      zn.anchors.push({ kind: 'totem', ...fr.toWorld(-R * 0.35, -R * 0.3) });
      break;
    }
  }
  // treasure, ore and secrets in every zone
  scatter(ctx, zn, 'ore', 3, 10, R - 6, 14, (a) => (a.data = { type: rng.pick(['copper', 'silver', 'gold', 'turquoise', 'amethyst']) }));
  scatter(ctx, zn, 'chest', 2, R * 0.25, R - 6, 8);
  scatter(ctx, zn, 'pot', 4, 6, R - 6, 6);
  // one big landmark encounter per zone (tall wooden building, walk-in cinematic + mission)
  const lmTypes: LandmarkType[] = ['tradingPost', 'outlawFort', 'mineHeadframe', 'ranchBarn', 'sheriffOffice', 'saloon'];
  const lt = zn.index === 0 ? 'tradingPost' : lmTypes[(zn.index * 7 + ctx.spec.key.charCodeAt(0)) % lmTypes.length];
  if (zn.theme !== 'arena' && zn.theme !== 'apex' && zn.theme !== 'oasisheart') placeLandmark(ctx, zn, lt);
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
  const SMALL = new Set(['cactus', 'bush', 'tumbleweed', 'deadBush', 'dryGrass', 'rock', 'boulder', 'ore', 'pot', 'boneScatter', 'skull', 'palm', 'reeds', 'obeliskBroken', 'mineCart', 'tntCrate', 'ruinWall', 'chest']);
  let best: { x: number; z: number } | null = null;
  let bestSoft = 1e9;
  for (let k = 0; k < 60; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(R * 0.45, R * 0.72);
    const x = zn.cx + Math.cos(a) * r, z = zn.cz + Math.sin(a) * r;
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
  if (!best) return;
  const { x, z } = best;
  // clear the scatter off the footprint and its yard
  zn.anchors = zn.anchors.filter((o) => Math.hypot(o.x - x, o.z - z) >= half + 4 || !SMALL.has(o.kind));
  const rot = Math.atan2(zn.cz - z, zn.cx - x); // entrance faces zone center
  flattenDisc(field, x, z, half, 1, MAT.DIRT, noise);
  zn.anchors.push({ kind: 'landmark', x, z, rot, data: { type, name: info.name, mission: info.mission } });
}

function flattenDisc(field: Heightfield, cx: number, cz: number, r: number, strength: number, mat: number, noise: Noise) {
  const h0 = avgBase(field, cx, cz, r * 0.7);
  forRect(field, cx - r - 12, cz - r - 12, cx + r + 12, cz + r + 12, (k, x, z) => {
    const d = Math.hypot(x - cx, z - cz);
    const w = smoothstep(r + 10, r - 2, d) * strength;
    if (w <= 0) return;
    field.base[k] = lerp(field.base[k], h0 + noise.n2(x * 0.08, z * 0.08) * 0.15, w);
    if (d < r - 2 + noise.n2(x * 0.1, z * 0.1) * 3) field.baseMat[k] = mat;
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
