// World props: turns zone anchors into instanced scatter (cacti, rocks, crates,
// fences...), unique structures and landmark buildings. Colliders for big
// structures are derived from their voxels (1 m occupancy cells merged into
// oriented boxes). Destructibles shatter into their own voxel chunks; TNT
// chain-explodes; tumbleweeds roll with the wind; windmills spin; temple
// pieces rise from the sand when their zone unlocks.
import * as THREE from 'three';
import * as PM from '../models/props';
import { deadBush, dryGrass } from '../models/props/flora';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedFoliageMaterial, sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import type { World } from './World';
import type { Anchor, ZoneDef } from './RegionGen';
import type { Collider } from './Colliders';
import { RNG, rnd, hash2i, hash3, Noise } from '../../engine/math/rand';
import { VoxelModel as VM, unkey, downsampleModel, mix as mixRGB, mulRGB } from '../../engine/voxel/VoxelModel';
import { ruinify, ruinSpots, RuinOpts, RuinSpots, NOCOL, cobweb, spiderNest, plankDebris, outpostTower, oasisReeds, oasisFlowers, lilyPads } from '../models/props/ruins';
import { globalUniforms, atmoFogUniforms } from '../../engine/render/VoxelMaterial';
import { PRESETS } from './Env';

type SM = {
  model: VoxelModel;
  voxelSize: number;
  meta?: any;
  anchor?: [number, number, number];
  rotor?: VoxelModel;
  rotorPivot?: any;
  rotorAt?: any;
  /** geometry origin in voxel coords (ruins keep the intact building's bottom-centre so meta.entrance stays exact) */
  pivot?: [number, number, number];
  /** an abandoned ruin: interior spots for loot, nests, egg sacs and webs */
  ruin?: RuinSpots;
};

// ---------------------------------------------------------------------------
// Abandoned desert: every building is a ruin (see models/props/ruins.ts)
const SAND_COLS = new Set([0xf0d29a, 0xd9b276]);
/** wreck a building model, keeping its original bottom-centre pivot */
function ruined(sm: SM | null, o: Partial<RuinOpts> & { seed: number }): SM | null {
  if (!sm?.model) return sm;
  const b = sm.model.bounds();
  const pivot: [number, number, number] = [(b.minX + b.maxX + 1) / 2, b.minY, (b.minZ + b.maxZ + 1) / 2];
  const model = ruinify(sm.model, { vs: sm.voxelSize, entrance: sm.meta?.entrance, ...o });
  let rotor = sm.rotor;
  if (rotor) {
    // the windmill's sails: blades snapped off, slats missing
    const rb = rotor.bounds();
    const hx = (rb.minX + rb.maxX + 1) / 2, hy = (rb.minY + rb.maxY + 1) / 2;
    const r = new VM(rotor.name + '_ruin');
    const gone = (o.seed * 3) % 4;
    rotor.forEach((x, y, z, c, f) => {
      const a = Math.atan2(y + 0.5 - hy, x + 0.5 - hx), d = Math.hypot(x + 0.5 - hx, y + 0.5 - hy);
      const sector = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 8;
      if (d > 6 && (sector === gone * 2 || (sector === (gone * 2 + 5) % 8 && d > 14) || hash3(x, y, 7) < 0.12)) return;
      r.set(x, y, z, mixRGB(c, 0xd0c4aa, 0.45), f);
    });
    rotor = r;
  }
  return { ...sm, model, rotor, pivot, ruin: ruinSpots(model, sm.voxelSize, pivot) };
}
const ruinMemo = new Map<string, SM | null>();
const memoRuin = (key: string, f: () => SM | null) => {
  if (!ruinMemo.has(key)) ruinMemo.set(key, f());
  return ruinMemo.get(key)!;
};


interface KindDef {
  variants: number;
  build: (v: number, a: Anchor) => SM | null;
  solid?: 'circle' | 'box' | 'voxel' | 'none';
  radius?: number; // circle radius multiplier of footprint
  destructible?: { hp: number; material: 'wood' | 'cactus' | 'pottery' | 'bone' | 'rock'; explode?: number };
  foliage?: boolean;
  grapple?: boolean;
  unique?: boolean; // individual mesh (big structure)
}

const P: any = PM;

// ---------------------------------------------------------------------------
// Zone rim markers: wind-worn standing stones (1/10 m voxels). Each is a tapered,
// leaning, slightly twisted sandstone slab with a sand-blasted waist, horizontal
// flutes cut into its windward (-x) face, strata, desert-varnish streaks running
// down the lee side and a bleached crown; it stands half-buried in a drift that
// trails downwind (+x), with spalled fragments on the windward side. Variants
// 6-7 are the taller gate stones that flank each corridor mouth (carved band and
// weathered tally notches facing the zone).
const STONE = { base: 0xc49468, shade: 0xa47650, deep: 0x845a3c, hi: 0xdcb282, bleach: 0xecd4a8, varnish: 0x5a3a28, sand: 0xe0b478, sandHi: 0xf0cf98, sandLo: 0xcf9f66 };
function rimStone(v: number): SM {
  const rng = new RNG(7719 + v * 131);
  const nz = new Noise(311 + v * 17);
  const m = new VM('rimStone' + v);
  const gate = v >= 6;
  const G = 6; // buried rows below the sand line
  const H = Math.round((gate ? rng.range(6.4, 7.4) : rng.range(3.0, 5.4)) * 10);
  const W0 = (gate ? rng.range(1.1, 1.3) : rng.range(0.72, 1.1)) * 10;
  const D0 = W0 * (gate ? rng.range(0.62, 0.75) : rng.range(0.5, 0.78));
  const leanX = rng.range(-0.09, 0.09) * (gate ? 0.25 : 1), leanZ = rng.range(-0.07, 0.07) * (gate ? 0.25 : 1);
  const twist = rng.range(-0.4, 0.4) * (gate ? 0.3 : 1);
  const broken = !gate && rng.chance(0.34);
  const crownT = 0.8;
  const strata = [STONE.base, STONE.shade, STONE.hi, STONE.base, STONE.deep, STONE.base, STONE.hi];
  for (let y = 0; y < H + G; y++) {
    const ym = y - G;
    const t = Math.max(0, ym) / H;
    let k = (1 - 0.36 * t) * (1 + 0.07 * Math.sin(t * Math.PI));
    k *= 1 - 0.15 * Math.exp(-(((ym - 7) / 4) ** 2)); // sand-blasted waist
    if (!broken && t > crownT) k *= Math.sqrt(Math.max(0, 1 - ((t - crownT) / (1 - crownT)) ** 2));
    const hw = W0 * k, hd = D0 * k;
    if (hw < 0.8 || hd < 0.6) continue;
    const cx = leanX * Math.max(0, ym), cz = leanZ * Math.max(0, ym);
    const ang = twist * t;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const R = Math.ceil(Math.max(hw, hd) + Math.abs(cx) + Math.abs(cz)) + 2;
    for (let x = -R; x <= R; x++)
      for (let z = -R; z <= R; z++) {
        const dx = x - cx, dz = z - cz;
        const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
        const e = Math.pow(Math.abs(lx) / hw, 2.4) + Math.pow(Math.abs(lz) / hd, 2.4);
        const pit = nz.n3(x * 0.21, y * 0.13, z * 0.21) * 0.14 + nz.n3(x * 0.6, y * 0.6, z * 0.6) * 0.05;
        const flute = lx < 0 ? (Math.sin(y * 0.85 + nz.n2(z * 0.15, y * 0.04) * 2.5) * 0.5 + 0.5) * 0.17 * Math.min(1, -lx / hw) * (ym > 2 ? 1 : 0) : 0;
        if (e > 1 - pit - flute) continue;
        if (broken && ym > H - 5 + nz.n2(x * 0.35, z * 0.35) * 5) continue; // jagged fracture
        const sw = nz.n2(x * 0.15 + 3, z * 0.15) * 2.5;
        let c = strata[((Math.floor((y + sw) / 5) % strata.length) + strata.length) % strata.length];
        const vs = nz.n2(x * 0.32 + 11, z * 0.32 - 4);
        if (vs > 0.3 && ym > H * (0.25 + 0.3 * (nz.n2(x * 0.1, z * 0.1) * 0.5 + 0.5)) && lx > -hw * 0.3) c = mixRGB(c, STONE.varnish, Math.min(0.75, 0.45 + (vs - 0.3)));
        if (lx < -hw * 0.55) c = mixRGB(c, STONE.bleach, 0.32);
        if (t > 0.86 || (broken && ym > H - 7)) c = mixRGB(c, STONE.bleach, 0.38);
        if (ym < 4) c = mixRGB(c, STONE.sand, 0.45);
        m.set(x, y, z, mulRGB(c, 1 + (hash3(x, y, z) - 0.5) * 0.08));
      }
  }
  if (gate) {
    // a carved band ringing the stone and weathered tally notches on the face toward the zone (+z)
    const band = G + Math.round(H * 0.68);
    const groove: [number, number, number][] = [];
    m.forEach((x, y, z) => {
      if (y < band || y > band + 2) return;
      if (!m.has(x, y, z + 1) || !m.has(x, y, z - 1) || !m.has(x + 1, y, z) || !m.has(x - 1, y, z)) groove.push([x, y, z]);
    });
    for (const [x, y, z] of groove) m.del(x, y, z);
    for (let i = 0; i < 5; i++) {
      const nx = -4 + i * 2;
      for (let y = band - 10 - (i % 2) * 2; y < band - 4; y++) {
        let zt = -999;
        for (let z = 20; z > -20; z--) if (m.has(nx, y, z)) { zt = z; break; }
        if (zt > -999) m.del(nx, y, zt);
      }
    }
  }
  // the drift: piled against the windward face, trailing downwind; spalled fragments upwind
  const tail = gate ? 6 : Math.round(rng.range(12, 17));
  const up = gate ? 6 : 8;
  for (let x = -Math.ceil(W0) - up; x <= Math.ceil(W0) + tail; x++)
    for (let z = -Math.ceil(D0) - 6; z <= Math.ceil(D0) + 6; z++) {
      const zf = Math.exp(-((z / (D0 + 3)) ** 2) * 1.4);
      let h: number;
      if (x >= 0) h = 5 * Math.max(0, 1 - x / (W0 + tail)) * zf;
      else h = 3.4 * Math.exp(-(((x + W0 * 0.8) / 4) ** 2)) * zf;
      h += nz.n2(x * 0.3, z * 0.3) * 0.8;
      const top = Math.round(G + h);
      for (let y = G - 2; y < top; y++) {
        if (m.has(x, y, z)) continue;
        m.set(x, y, z, y === top - 1 ? (hash3(x, 7, z) > 0.6 ? STONE.sandHi : STONE.sand) : STONE.sandLo);
      }
    }
  for (let f = 0; f < (gate ? 2 : 3); f++) {
    const fx = -Math.round(W0) - rng.int(4, 9), fz = rng.int(-8, 8), r = rng.range(1.4, 2.6);
    for (let x = -3; x <= 3; x++)
      for (let y = 0; y <= 3; y++)
        for (let z = -3; z <= 3; z++) {
          const d = Math.hypot(x, y * 1.4, z) + nz.n3((fx + x) * 0.5, y * 0.5, (fz + z) * 0.5) * 0.9;
          if (d > r) continue;
          m.set(fx + x, G - 1 + y, fz + z, mulRGB(y >= 2 ? STONE.hi : STONE.shade, 1 + (hash3(x, y, z) - 0.5) * 0.08));
        }
  }
  return { model: m, voxelSize: 0.1 };
}

const cactusKind = (v: number) => (['saguaro', 'saguaro', 'saguaro', 'barrel', 'prickly', 'organ', 'saguaro', 'barrel', 'prickly', 'organ'] as const)[v % 10];

const KINDS: Record<string, KindDef> = {
  cactus: { variants: 10, build: (v) => P.cactus(v * 7 + 1, cactusKind(v)), solid: 'circle', radius: 0.35, destructible: { hp: 40, material: 'cactus' } },
  rock: { variants: 6, build: (v) => P.rock(v + 3, ((v % 3) + 1) as 1 | 2 | 3), solid: 'circle', radius: 0.8, destructible: undefined },
  boulder: { variants: 3, build: (v) => P.boulder(v), solid: 'circle', radius: 0.9 },
  bush: { variants: 4, build: (v) => P.dryBush(v), solid: 'none', foliage: true },
  deadBush: { variants: 12, build: (v) => deadBush(v), solid: 'none', foliage: true },
  dryGrass: { variants: 8, build: (v) => dryGrass(v), solid: 'none', foliage: true },
  reeds: { variants: 4, build: (v) => oasisReeds(v + 4), solid: 'none', foliage: true },
  palm: { variants: 4, build: (v) => P.palm(v), solid: 'circle', radius: 0.12, foliage: true },
  skull: { variants: 1, build: () => P.skull('cow'), solid: 'none' },
  giantSkull: { variants: 1, build: () => P.skull('giant'), solid: 'voxel' },
  boneScatter: { variants: 3, build: (v) => P.boneScatter(v), solid: 'none' },
  ribArch: { variants: 2, build: (v) => P.ribArch(v), solid: 'voxel', unique: true },
  boneGate: { variants: 1, build: () => P.ribArch(9), solid: 'voxel', unique: true },
  crate: { variants: 3, build: (v) => P.crate(v), solid: 'circle', radius: 0.7, destructible: { hp: 25, material: 'wood' } },
  tntCrate: { variants: 2, build: (v) => P.tntCrate(v), solid: 'circle', radius: 0.7, destructible: { hp: 12, material: 'wood', explode: 4.5 } },
  barrel: { variants: 2, build: (v) => P.barrel(v), solid: 'circle', radius: 0.8, destructible: { hp: 30, material: 'wood' } },
  whiskeyBarrel: { variants: 2, build: (v) => P.whiskeyBarrel(v), solid: 'circle', radius: 0.8, destructible: { hp: 30, material: 'wood' } },
  pot: { variants: 3, build: (v) => P.pot(v), solid: 'circle', radius: 0.7, destructible: { hp: 8, material: 'pottery' } },
  fence: { variants: 2, build: (v) => P.fence(3, v), solid: 'box', destructible: { hp: 30, material: 'wood' } },
  fenceBroken: { variants: 3, build: (v) => P.fenceBroken(v, 3, ((v % 2) + 1) as 1 | 2), solid: 'box', destructible: { hp: 20, material: 'wood' } },
  signpost: { variants: 4, build: (v) => P.signpost(v), solid: 'circle', radius: 0.25, destructible: { hp: 20, material: 'wood' } },
  hitchingPost: { variants: 2, build: (v) => P.hitchingPost(v), solid: 'box', destructible: { hp: 30, material: 'wood' } },
  wagonWheel: { variants: 2, build: (v) => P.wagonWheel(v), solid: 'circle', radius: 0.4, destructible: { hp: 15, material: 'wood' } },
  cattleSkullPost: { variants: 2, build: (v) => P.cattleSkullPost(v), solid: 'circle', radius: 0.3, destructible: { hp: 15, material: 'bone' } },
  mineCart: { variants: 2, build: (v) => P.mineCart(v), solid: 'circle', radius: 0.6 },
  mineEntrance: { variants: 1, build: () => P.railSegment(6, 2), solid: 'none' },
  wagon: { variants: 2, build: (v) => P.wagon(v), solid: 'voxel', unique: true },
  tent: { variants: 3, build: (v) => ruined(P.tent(v), { seed: 101 + v, collapse: 0.15, breach: 0, tear: 0.45, lean: 0.06, sand: 0.3 }), solid: 'voxel' },
  campfire: { variants: 1, build: () => P.campfire(1), solid: 'circle', radius: 0.5 },
  wantedBoard: { variants: 2, build: (v) => P.wantedBoard(v), solid: 'voxel' },
  well: { variants: 1, build: () => P.well(0), solid: 'circle', radius: 0.6 },
  trough: { variants: 1, build: () => P.trough(0), solid: 'box' },
  // every building out here is abandoned: caved-in, breached, bleached, half-buried in sand
  shack: { variants: 4, build: (v) => ruined(P.shack(v), { seed: 11 + v, collapse: 0.85, breach: 1.1, sand: 0.6 }), solid: 'voxel', unique: true },
  watchtower: { variants: 1, build: () => ruined(P.watchtower(0), { seed: 21, collapse: 0.5, keepBelow: 4.6, breach: 0, lean: 0.03, sand: 0.4 }), solid: 'voxel', unique: true },
  windmill: { variants: 1, build: () => ruined(P.windmill(0), { seed: 31, collapse: 0.3, keepBelow: 3, breach: 0, lean: 0.03, sand: 0.4 }), solid: 'voxel', unique: true },
  waterTower: { variants: 1, build: () => ruined(P.waterTower(0), { seed: 41, collapse: 0.35, keepBelow: 4.4, breach: 0, lean: 0.03, sand: 0.45 }), solid: 'voxel', unique: true },
  outhouse: { variants: 1, build: () => ruined(P.outhouse(0), { seed: 51, collapse: 0.45, breach: 0.4, lean: 0.12, sand: 0.4 }), solid: 'voxel', unique: true, destructible: { hp: 60, material: 'wood' } },
  gallows: { variants: 1, build: () => ruined(P.gallows(0), { seed: 61, collapse: 0.25, breach: 0, lean: 0.05, sand: 0.35 }), solid: 'voxel', unique: true },
  saloonFacade: { variants: 1, build: () => ruined(P.saloonFacade(0), { seed: 71, collapse: 0.75, breach: 0.9 }), solid: 'voxel', unique: true },
  sheriffFacade: { variants: 1, build: () => ruined(P.sheriffFacade(0), { seed: 81, collapse: 0.75, breach: 0.9 }), solid: 'voxel', unique: true },
  storeFacade: { variants: 1, build: () => ruined(P.generalStoreFacade(0), { seed: 91, collapse: 0.8, breach: 0.9 }), solid: 'voxel', unique: true },
  // spider country: webs strung across corners and doorways, funnel-web nests, broken planks
  cobweb: { variants: 5, build: (v) => cobweb(v), solid: 'none' },
  spiderNest: { variants: 3, build: (v) => spiderNest(v), solid: 'none' },
  plankDebris: { variants: 4, build: (v) => plankDebris(v), solid: 'none' },
  // tall ruined lookout towers (grapple to the top for the loot)
  outpost: { variants: 2, build: (v, a) => outpostTower(a.data?.variant ?? v), solid: 'voxel', unique: true, grapple: true },
  // oasis life
  oasisReeds: { variants: 4, build: (v) => oasisReeds(v), solid: 'none', foliage: true },
  oasisFlowers: { variants: 4, build: (v) => oasisFlowers(v), solid: 'none', foliage: true },
  lilyPads: { variants: 2, build: (v) => lilyPads(v), solid: 'none' },
  rug: { variants: 2, build: (v) => P.rug(v), solid: 'none' },
  obelisk: { variants: 2, build: (v) => P.obelisk(v, false), solid: 'circle', radius: 0.5, unique: true },
  obeliskBroken: { variants: 2, build: (v) => P.obelisk(v + 4, true), solid: 'circle', radius: 0.5, unique: true },
  column: { variants: 2, build: (v, a) => P.column(v, !!a.data?.broken), solid: 'circle', radius: 0.45, unique: true },
  sphinx: { variants: 1, build: () => P.sphinx(), solid: 'voxel', unique: true },
  statue: { variants: 1, build: (_v, a) => P.godStatue(a.data?.god ?? 'thoth'), solid: 'circle', radius: 0.5, unique: true },
  hieroglyphWall: { variants: 2, build: (v) => P.hieroglyphWall(v), solid: 'voxel', unique: true },
  ruinWall: { variants: 3, build: (v) => P.mudbrickRuin(v), solid: 'voxel', unique: true },
  sarcophagus: { variants: 1, build: () => P.sarcophagus(), solid: 'box', unique: true },
  totem: { variants: 1, build: () => P.scorpionTotem(), solid: 'circle', radius: 0.35, grapple: true, unique: true },
  capstone: { variants: 1, build: () => P.capstone(), solid: 'none', unique: true },
  stoneGate: { variants: 1, build: () => P.templeGate(0), solid: 'voxel', unique: true },
  ore: { variants: 5, build: (v, a) => P.oreNode(a.data?.type ?? (['copper', 'silver', 'gold', 'turquoise', 'amethyst'] as const)[v % 5], v), solid: 'circle', radius: 0.5, unique: true },
  tumbleweed: { variants: 3, build: (v) => P.tumbleweed(v), solid: 'none' },
  rimStone: { variants: 6, build: (v) => rimStone(v), solid: 'circle', radius: 0.7 },
  rimGate: { variants: 2, build: (v) => rimStone(6 + v), solid: 'circle', radius: 0.7 },
};
const RIM_KINDS = new Set(['rimStone', 'rimGate']);

const LANDMARKS: Record<string, () => SM> = {
  // the trading post is a giant travelling tortoise now (Ozymandias, spawned by
  // Missions); his landmark is just the campfire he plods round, so the mission
  // scan and the escort routes still find "the trading post"
  tradingPost: () => ({ ...P.campfire(3), meta: { entrance: [0, 3], footprint: [6, 6], height: 1.5, turtleCamp: true } }), // Gobi the turtle house walks round this fire (run/Missions.ts)
  // the rest are ghost towns now: abandoned, caved in and full of spiders (built once per type)
  outlawFort: () => memoRuin('outlawFort', () => ruined(P.outlawFort(2), { seed: 201, collapse: 0.55, breach: 0.5, sand: 0.7 }))!,
  mineHeadframe: () => memoRuin('mineHeadframe', () => ruined(P.mineHeadframe(3), { seed: 202, collapse: 0.35, keepBelow: 3.2, breach: 0.5, lean: 0.025, sand: 0.6 }))!,
  ranchBarn: () => memoRuin('ranchBarn', () => ruined(P.ranchBarn(4), { seed: 203, collapse: 0.85, breach: 0.8, sand: 0.7 }))!,
  sheriffOffice: () => memoRuin('sheriffOffice', () => ruined(P.sheriffOffice(5), { seed: 204, collapse: 0.8, breach: 0.9, sand: 0.6 }))!,
  saloon: () => memoRuin('saloon', () => ruined(P.saloon(6), { seed: 205, collapse: 0.75, breach: 0.8, sand: 0.6 }))!,
};

interface Variant {
  sm: SM;
  geo: THREE.BufferGeometry;
  lodGeo?: THREE.BufferGeometry;
  mesh: THREE.InstancedMesh | null;
  count: number;
  cap: number;
  height: number;
  halfX: number;
  halfZ: number;
}

interface Batch {
  v: Variant;
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
  insts: PropInst[];
  foliage: boolean;
}

export interface PropInst {
  kind: string;
  batch?: Batch;
  anchor: Anchor;
  zone: number;
  variant: Variant;
  index: number; // instance index or -1 for unique
  mesh: THREE.Mesh | null;
  matrix: THREE.Matrix4;
  colliders: Collider[];
  hp: number;
  broken: boolean;
  baseY: number;
  rise?: string;
  extra?: any;
}

// oasis pool water (same look as the sub-area sea: pixel ripples, depth tint, shoreline foam, glints, sky sheen)
const POOL_VERT = /* glsl */ `
attribute float aDepth;
varying vec3 vW;
varying float vD;
#include <fog_pars_vertex>
void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vD = aDepth; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const POOL_FRAG = /* glsl */ `
uniform float uTime; uniform vec3 uDeep, uShallow, uSky;
varying vec3 vW;
varying float vD;
#include <fog_pars_fragment>
float h12(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
void main(){
  if (vD < 0.0) discard;
  vec2 px = floor(vW.xz * 4.0) / 4.0;
  float w1 = sin(px.x * 0.9 + uTime * 1.1) * cos(px.y * 0.8 - uTime * 0.9);
  float w2 = sin(px.x * 2.1 - px.y * 1.5 + uTime * 1.7);
  float depth = clamp(vD, 0.0, 1.6) / 1.6;
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 1.0, depth));
  col += (w1 * 0.035 + w2 * 0.025);
  float glint = step(0.986, h12(px + floor(uTime * 3.0))) * 0.55;
  float foam = smoothstep(0.1, 0.0, vD) * (0.55 + 0.45 * step(0.5, fract(w2 * 2.0)));
  col = mix(col, vec3(0.93, 0.96, 0.9), foam);
  col += glint;
  float fr = pow(1.0 - clamp(normalize(cameraPosition - vW).y, 0.0, 1.0), 4.0);
  col = mix(col, uSky, 0.12 + 0.45 * fr);
  gl_FragColor = vec4(col, mix(0.82, 0.55, foam));
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Props {
  group = new THREE.Group();
  variants = new Map<string, Variant>();
  list: PropInst[] = [];
  built = new Set<number>();
  tumbleweeds: { inst: PropInst; vel: THREE.Vector3; spin: number }[] = [];
  rotors: { mesh: THREE.Mesh; speed: number }[] = [];
  landmarks: PropInst[] = [];
  batches: Batch[] = [];
  onBreak?: (p: PropInst, spd: number, dir?: THREE.Vector3) => void;
  private rng = new RNG(1234);
  /** ruined landmark geometry, shared by every zone that has one */
  private lmVariants = new Map<string, Variant>();
  /** oasis pools (local water surfaces in the dry sub-areas) */
  pools: { x: number; z: number; r: number; level: number; mesh: THREE.Mesh }[] = [];
  private lastLodPos = new THREE.Vector3(1e9, 0, 0);
  lodNear = 55;

  private lod(v: Variant) {
    if (!v.lodGeo) {
      const ds = downsampleModel(v.sm.model, 2);
      const pv = v.sm.pivot;
      v.lodGeo = ds.count > 0 ? buildVoxelGeometry(ds, { voxelSize: v.sm.voxelSize * 2, pivot: pv ? [pv[0] / 2, pv[1] / 2, pv[2] / 2] : 'bottom' }) : v.geo;
    }
    return v.lodGeo;
  }

  /** unique mesh with automatic distance LOD */
  private lodMesh(v: Variant, foliage: boolean, nearDist = 60) {
    const lod = new THREE.LOD();
    const mat = foliage ? sharedFoliageMaterial : sharedVoxelMaterial;
    const a = new THREE.Mesh(v.geo, mat);
    a.castShadow = true;
    a.receiveShadow = true;
    const b = new THREE.Mesh(this.lod(v), mat);
    b.castShadow = true;
    b.receiveShadow = true;
    lod.addLevel(a, 0);
    lod.addLevel(b, nearDist);
    return lod;
  }

  constructor(private world: World) {
    this.group.name = 'props';
    world.group.add(this.group);
  }

  private variant(kind: string, v: number, a: Anchor): Variant | null {
    const def = KINDS[kind];
    const key = def.unique && (kind === 'statue' || kind === 'ore' || kind === 'column') ? `${kind}:${v}:${a.data?.god ?? a.data?.type ?? (a.data?.broken ? 'b' : 'w')}` : `${kind}:${v}`;
    let vr = this.variants.get(key);
    if (vr) return vr;
    let sm: SM | null = null;
    try {
      sm = def.build(v, a);
    } catch (e) {
      console.warn('[props] build failed', kind, e);
    }
    if (!sm || !sm.model) return null;
    const geo = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: sm.pivot ?? 'bottom' });
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    vr = { sm, geo, mesh: null, count: 0, cap: 0, height: bb.max.y - bb.min.y, halfX: (bb.max.x - bb.min.x) / 2, halfZ: (bb.max.z - bb.min.z) / 2 };
    this.variants.set(key, vr);
    return vr;
  }

  /** instantiate everything for a zone (call for zones the player may reach soon) */
  buildZone(z: ZoneDef) {
    if (this.built.has(z.index)) return;
    this.built.add(z.index);
    const t0 = performance.now();
    // gather per variant counts first for instanced capacity
    const plan: { a: Anchor; kind: string; v: Variant }[] = [];
    const zoneBatches = new Map<string, Batch>();
    const extra: Anchor[] = [];
    const planOf = (a: Anchor) => {
      const def = KINDS[a.kind];
      if (!def) return null;
      let v = hash2i(Math.round(a.x * 10), Math.round(a.z * 10)) % def.variants;
      if (typeof a.data?.variant === 'number') v = a.data.variant % def.variants;
      const vr = this.variant(a.kind, v, a);
      return vr ? { a, kind: a.kind, v: vr } : null;
    };
    for (const a of [...z.anchors, ...this.rimAnchors(z)]) {
      if (a.kind === 'landmark') {
        this.addLandmark(z, a, extra);
        continue;
      }
      if (a.kind === 'oasisPool') {
        this.addPool(a);
        continue;
      }
      const p = planOf(a);
      if (!p) continue;
      plan.push(p);
      if (p.v.sm.ruin) {
        a.rot ??= this.rng.range(0, Math.PI * 2);
        this.ruinDecor(a, p.v, a.rot, a.scale ?? 1, this.world.groundAt(a.x, a.z) - 0.05, extra, false);
      }
    }
    for (const a of extra) {
      const p = planOf(a);
      if (p) plan.push(p);
    }
    for (const { a, kind, v } of plan) {
      const def = KINDS[kind];
      const g = this.world.groundAt(a.x, a.z);
      const sc = (a.scale ?? 1) * (kind === 'rock' ? 1 : 1);
      const rot = a.rot ?? this.rng.range(0, Math.PI * 2);
      let y = g - 0.05;
      if (kind === 'capstone') y = a.data?.y ?? g;
      else if (typeof a.data?.y === 'number') y = a.data.y;
      if (RIM_KINDS.has(kind)) {
        // stand on the lowest sand under the footprint, the base row buried
        const w = this.world.groundAt;
        y = Math.min(g, w(a.x + 1.2, a.z), w(a.x - 1.2, a.z), w(a.x, a.z + 1.2), w(a.x, a.z - 1.2)) - 0.55;
      }
      _q.setFromAxisAngle(UP, rot);
      _s.setScalar(sc);
      const riseDepth = a.rise ? v.height * sc + 0.5 : 0;
      _p.set(a.x, y - riseDepth, a.z);
      const matrix = new THREE.Matrix4().compose(_p, _q, _s);
      const inst: PropInst = { kind, anchor: a, zone: z.index, variant: v, index: -1, mesh: null, matrix, colliders: [], hp: def.destructible?.hp ?? 0, broken: false, baseY: y, rise: a.rise };
      if (def.unique || kind === 'tumbleweed') {
        const mesh = kind === 'tumbleweed' ? new THREE.Mesh(v.geo, sharedVoxelMaterial) : (this.lodMesh(v, !!def.foliage) as unknown as THREE.Mesh);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(matrix);
        mesh.matrixWorldNeedsUpdate = true;
        this.group.add(mesh);
        inst.mesh = mesh;
        if (v.sm.rotor) {
          const rg = buildVoxelGeometry(v.sm.rotor, { voxelSize: v.sm.voxelSize, pivot: v.sm.rotorPivot ?? 'center' });
          const rm = new THREE.Mesh(rg, sharedVoxelMaterial);
          rm.castShadow = true;
          const at = v.sm.rotorAt ?? [0, v.height * 0.8, 0.5];
          rm.position.set(at[0], at[1], at[2]);
          mesh.matrixAutoUpdate = false;
          const holder = new THREE.Group();
          holder.matrixAutoUpdate = false;
          holder.matrix.copy(matrix);
          holder.add(rm);
          this.group.add(holder);
          this.rotors.push({ mesh: rm, speed: v.sm.ruin ? 0.12 + this.rng.next() * 0.25 : 1.2 + this.rng.next() });
        }
      } else {
        const bkey = z.index + ':' + kind + ':' + this.variantKey(v);
        let b = zoneBatches.get(bkey);
        if (!b) {
          const mat = def.foliage ? sharedFoliageMaterial : sharedVoxelMaterial;
          const cap = plan.filter((q) => q.v === v).length + 1;
          const near = new THREE.InstancedMesh(v.geo, mat, cap);
          const far = new THREE.InstancedMesh(this.lod(v), mat, cap);
          for (const im of [near, far]) {
            im.castShadow = true;
            im.receiveShadow = true;
            im.count = 0;
            this.group.add(im);
          }
          b = { v, near, far, insts: [], foliage: !!def.foliage };
          zoneBatches.set(bkey, b);
          this.batches.push(b);
        }
        inst.batch = b;
        inst.index = b.insts.length;
        b.insts.push(inst);
      }
      if (kind === 'tumbleweed') this.tumbleweeds.push({ inst, vel: new THREE.Vector3(), spin: 0 });
      else this.addColliders(inst, def, sc, rot, g, riseDepth > 0);
      if (kind === 'totem' && v.sm.anchor) {
        const an = v.sm.anchor;
        const c = this.world.colliders.circle(a.x + an[0], a.z + an[2], 0.8, y + an[1] - 1, y + an[1] + 1, { tag: 'grapple', solid: false, bullets: false });
        inst.colliders.push(c);
      }
      if (kind === 'outpost' && v.sm.meta?.anchor) {
        // the lookout: a grapple point at the top, the loot platform for RuinNests
        const cs = Math.cos(rot), sn = Math.sin(rot);
        const at = (p: [number, number, number]) => ({ x: a.x + (p[0] * cs + p[2] * sn) * sc, y: y + p[1] * sc, z: a.z + (-p[0] * sn + p[2] * cs) * sc });
        const an = at(v.sm.meta.anchor);
        inst.colliders.push(this.world.colliders.circle(an.x, an.z, 0.9, an.y - 1, an.y + 1, { tag: 'grapple', solid: false, bullets: false }));
        a.data = { ...(a.data ?? {}), top: at(v.sm.meta.top), grapple: an };
      }
      this.list.push(inst);
    }
    for (const b of zoneBatches.values()) this.layoutBatch(b, this.lastLodPos);
    console.log(`[props] zone ${z.index}: ${plan.length} props in ${(performance.now() - t0).toFixed(0)}ms`);
  }

  /**
   * Standing stones just outside a zone's rim, one every ~10 m with the odd smaller
   * companion, a gap at each corridor mouth flanked by two tall gate stones.
   */
  private rimAnchors(z: ZoneDef): Anchor[] {
    const sa = this.world.sa;
    const out: Anchor[] = [];
    const rng = new RNG(z.index * 7919 + sa.seed * 13 + 5);
    const R = z.r + 3.5;
    const windRot = Math.atan2(-sa.wind.z, sa.wind.x);
    const mouths: { x: number; z: number; ux: number; uz: number; w: number }[] = [];
    const addMouth = (tx: number, tz: number, cw: number) => {
      const d = Math.hypot(tx - z.cx, tz - z.cz) || 1;
      const ux = (tx - z.cx) / d, uz = (tz - z.cz) / d;
      mouths.push({ x: z.cx + ux * R, z: z.cz + uz * R, ux, uz, w: cw });
    };
    const prev = sa.zones[z.index - 1], next = sa.zones[z.index + 1];
    if (prev && z.corridor) addMouth(prev.cx, prev.cz, z.corridor.w);
    if (next?.corridor) addMouth(next.cx, next.cz, next.corridor.w);
    const ok = (x: number, zz: number, pad: number) =>
      this.world.field.inBounds(x, zz, 6) &&
      this.world.groundAt(x, zz) > sa.waterLevel + 0.3 &&
      !z.anchors.some((a) => a.kind !== 'tumbleweed' && Math.hypot(a.x - x, a.z - zz) < pad);
    const n = Math.round((Math.PI * 2 * R) / 8.5);
    for (let i = 0; i < n; i++) {
      const a = ((i + rng.range(-0.25, 0.25)) / n) * Math.PI * 2;
      const rr = R + rng.range(-0.8, 2.2);
      const x = z.cx + Math.cos(a) * rr, zz = z.cz + Math.sin(a) * rr;
      if (mouths.some((m) => Math.hypot(m.x - x, m.z - zz) < m.w * 0.5 + 8)) continue;
      if (!ok(x, zz, 4)) continue;
      out.push({ kind: 'rimStone', x, z: zz, rot: windRot + rng.range(-0.35, 0.35), scale: rng.range(0.95, 1.4) });
      if (rng.chance(0.24)) {
        const b = a + rng.range(-0.04, 0.04), r2 = rr + rng.range(2.6, 4.6);
        const x2 = z.cx + Math.cos(b) * r2, z2 = z.cz + Math.sin(b) * r2;
        if (ok(x2, z2, 3)) out.push({ kind: 'rimStone', x: x2, z: z2, rot: windRot + rng.range(-0.5, 0.5), scale: rng.range(0.5, 0.68) });
      }
    }
    for (const m of mouths) {
      const px = -m.uz, pz = m.ux;
      for (const s of [-1, 1]) {
        const off = m.w * 0.5 + 4.5;
        const x = m.x + px * s * off + m.ux * 1.5, zz = m.z + pz * s * off + m.uz * 1.5;
        if (ok(x, zz, 3)) out.push({ kind: 'rimGate', x, z: zz, rot: Math.atan2(-m.ux, -m.uz), scale: 1.2 });
      }
    }
    return out;
  }

  private vkeys = new Map<Variant, number>();
  private variantKey(v: Variant) {
    let k = this.vkeys.get(v);
    if (k === undefined) this.vkeys.set(v, (k = this.vkeys.size));
    return k;
  }

  /** split a batch's live instances into near / far instanced meshes and refresh bounds */
  private layoutBatch(b: Batch, focus: THREE.Vector3) {
    let n = 0, f = 0;
    const p = new THREE.Vector3();
    for (const inst of b.insts) {
      if (inst.broken) continue;
      p.setFromMatrixPosition(inst.matrix);
      const near = p.distanceTo(focus) < this.lodNear;
      if (near) b.near.setMatrixAt(n++, inst.matrix);
      else b.far.setMatrixAt(f++, inst.matrix);
    }
    b.near.count = n;
    b.far.count = f;
    b.near.instanceMatrix.needsUpdate = true;
    b.far.instanceMatrix.needsUpdate = true;
    b.near.computeBoundingSphere();
    b.far.computeBoundingSphere();
  }

  private addColliders(inst: PropInst, def: KindDef, sc: number, rot: number, g: number, buried: boolean) {
    const a = inst.anchor;
    const v = inst.variant;
    const cols = this.world.colliders;
    const data = def.destructible ? { destructible: true, hp: def.destructible.hp, material: def.destructible.material, prop: inst, onBreak: (spd: number, dir?: THREE.Vector3) => this.breakProp(inst, spd, dir) } : { material: (def as any).material ?? 'rock', prop: inst };
    const y0 = buried ? -1000 : g - 0.5, y1 = buried ? -999 : g + v.height * sc;
    if (def.solid === 'circle') {
      const r = Math.max(0.2, Math.min(v.halfX, v.halfZ) * sc * (def.radius ?? 0.6) * 1.4);
      inst.colliders.push(cols.circle(a.x, a.z, r, y0, y1, { data }));
    } else if (def.solid === 'box') {
      inst.colliders.push(cols.box(a.x, a.z, v.halfX * sc, v.halfZ * sc, -rot, y0, y1, { data }));
    } else if (def.solid === 'voxel') {
      for (const c of this.voxelColliders(v, a.x, a.z, rot, sc, y0, g)) {
        c.data = data;
        inst.colliders.push(c);
      }
    }
  }

  /** occupancy-cell colliders derived from the model's voxels */
  private voxelColliders(v: Variant, x: number, z: number, rot: number, sc: number, y0: number, g: number) {
    const vs = v.sm.voxelSize * sc;
    const b = v.sm.model.bounds();
    const pv = v.sm.pivot;
    const cx = pv ? pv[0] : (b.minX + b.maxX + 1) / 2, cz = pv ? pv[2] : (b.minZ + b.maxZ + 1) / 2, by = pv ? pv[1] : b.minY;
    const cell = 1.0;
    const occ = new Map<string, number>(); // key -> top height
    for (const [k, val] of v.sm.model.map) {
      // drifted sand, rubble, silk and cloth scraps never block the board
      if ((val >>> 24) & NOCOL || SAND_COLS.has(val & 0xffffff)) continue;
      const [vx, vy, vz] = unkey(k);
      const ly = (vy - by) * vs;
      if (ly < 0.15 || ly > 2.6) continue;
      const lx = (vx + 0.5 - cx) * vs, lz = (vz + 0.5 - cz) * vs;
      const ix = Math.floor(lx / cell), iz = Math.floor(lz / cell);
      const key = ix + ',' + iz;
      const top = (vy - by + 1) * vs;
      occ.set(key, Math.max(occ.get(key) ?? 0, top));
    }
    // merge runs along x per row
    const rows = new Map<number, number[]>();
    for (const key of occ.keys()) {
      const [ix, iz] = key.split(',').map(Number);
      let r = rows.get(iz);
      if (!r) rows.set(iz, (r = []));
      r.push(ix);
    }
    const out: Collider[] = [];
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (const [iz, xs] of rows) {
      xs.sort((a, b) => a - b);
      let start = xs[0], prev = xs[0];
      const flush = (s: number, e: number) => {
        let top = 0;
        for (let i = s; i <= e; i++) top = Math.max(top, occ.get(i + ',' + iz) ?? 0);
        const lx = ((s + e + 1) / 2) * cell, lz = (iz + 0.5) * cell;
        const wx = x + lx * cs + lz * sn, wz = z - lx * sn + lz * cs;
        out.push(this.world.colliders.box(wx, wz, ((e - s + 1) * cell) / 2, cell / 2, -rot, y0, g + Math.max(1, top)));
      };
      for (let i = 1; i < xs.length; i++) {
        if (xs[i] !== prev + 1) {
          flush(start, prev);
          start = xs[i];
        }
        prev = xs[i];
      }
      flush(start, prev);
    }
    return out;
  }

  private addLandmark(z: ZoneDef, a: Anchor, extra: Anchor[] = []) {
    const type = a.data?.type as string;
    const mk = LANDMARKS[type];
    if (!mk) return;
    const t0 = performance.now();
    let sm: SM;
    try {
      sm = mk();
    } catch (e) {
      console.warn('[props] landmark failed', type, e);
      return;
    }
    let v = this.lmVariants.get(type);
    if (!v) {
      const geo = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: sm.pivot ?? 'bottom' });
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      v = { sm, geo, mesh: null, count: 1, cap: 1, height: bb.max.y - bb.min.y, halfX: (bb.max.x - bb.min.x) / 2, halfZ: (bb.max.z - bb.min.z) / 2 };
      if (sm.ruin) this.lmVariants.set(type, v);
    }
    const g = this.world.groundAt(a.x, a.z);
    // entrance faces zone center: model fronts face +Z -> rotate so +Z points along anchor rot
    const rot = Math.PI / 2 - (a.rot ?? 0);
    _q.setFromAxisAngle(UP, rot);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(a.x, g - 0.1, a.z), _q, new THREE.Vector3(1, 1, 1));
    const mesh = this.lodMesh(v, false, 70) as unknown as THREE.Mesh;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrix);
    mesh.matrixWorldNeedsUpdate = true;
    this.group.add(mesh);
    const inst: PropInst = { kind: 'landmark', anchor: a, zone: z.index, variant: v, index: -1, mesh, matrix, colliders: [], hp: 0, broken: false, baseY: g, extra: { type, meta: sm.meta, rot } };
    inst.colliders = this.voxelColliders(v, a.x, a.z, rot, 1, g - 0.5, g);
    if (sm.ruin) this.ruinDecor(a, v, rot, 1, g - 0.1, extra, true);
    this.list.push(inst);
    this.landmarks.push(inst);
    console.log(`[props] landmark ${type} built in ${(performance.now() - t0).toFixed(0)}ms`);
  }

  /**
   * Dress a ruin from its interior analysis: webs in the high corners and across the
   * doorway, a funnel-web nest, egg sacs, pots and a crate on the floor, broken planks,
   * bones and a skull around it. The loot / spider spots for RuinNests are written to
   * the building's anchor as `data.ruin` (world space).
   */
  private ruinDecor(a: Anchor, v: Variant, rot: number, sc: number, baseY: number, out: Anchor[], big: boolean) {
    const sp = v.sm.ruin;
    if (!sp) return;
    const rng = new RNG(hash2i(Math.round(a.x * 7), Math.round(a.z * 7)) + 99);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const W = (lx: number, lz: number) => ({ x: a.x + (lx * cs + lz * sn) * sc, z: a.z + (-lx * sn + lz * cs) * sc });
    const ent = v.sm.meta?.entrance as [number, number] | undefined;
    const door = ent ?? [0, 0];
    const fp = (v.sm.meta?.footprint as [number, number] | undefined) ?? [v.halfX * 2, v.halfZ * 2];
    const radius = Math.hypot(fp[0], fp[1]) * 0.5 * sc;
    const used: { x: number; z: number }[] = [];
    const free = (x: number, z: number, d: number) => !used.some((u) => Math.hypot(u.x - x, u.z - z) < d);
    const take = (x: number, z: number) => used.push({ x, z });
    // floor spots, furthest from the door first (the back of the room), walls preferred
    const spots = sp.interior.filter((c) => c.walls > 0).sort((p, q) => Math.hypot(q.x - door[0], q.z - door[1]) - Math.hypot(p.x - door[0], p.z - door[1]));
    const roomy = sp.interior.length >= (big ? 12 : 6);
    const info: any = { chest: null, nests: [], eggs: [], drops: [], cx: a.x, cz: a.z, r: radius, big, y: baseY };
    // the loot: a chest at the back of the room
    const chest = roomy ? spots[0] : undefined;
    if (chest) {
      const w = W(chest.x, chest.z);
      info.chest = { x: w.x, y: baseY + chest.y * sc, z: w.z, rot: rot + Math.atan2(door[0] - chest.x, door[1] - chest.z) };
      take(chest.x, chest.z);
    }
    // the nest: deep in the room, away from the chest
    if (roomy) {
      const ns = spots.find((c) => free(c.x, c.z, big ? 4 : 2.2));
      if (ns) {
        const w = W(ns.x, ns.z);
        out.push({ kind: 'spiderNest', x: w.x, z: w.z, rot: rng.range(0, Math.PI * 2), data: { y: baseY + ns.y * sc - 0.08 } });
        info.nests.push({ x: w.x, y: baseY + ns.y * sc, z: w.z, alpha: big && rng.chance(0.5) });
        take(ns.x, ns.z);
      }
    }
    // webs in the high corners (spiders drop from these)
    const nWeb = big ? 5 : 2;
    let webs = 0;
    for (const c of rng.shuffle(sp.corners.slice())) {
      if (webs >= nWeb || !free(c.x, c.z, 1.6)) continue;
      const w = W(c.x, c.z);
      const top = baseY + c.top * sc;
      out.push({ kind: 'cobweb', x: w.x, z: w.z, rot: rot + c.rot, scale: 1, data: { y: top - 1.35, variant: rng.int(0, 2) } });
      info.drops.push({ x: w.x, y: top - 0.3, z: w.z });
      take(c.x, c.z);
      webs++;
      // an egg clutch under some of the webs
      if (info.eggs.length < (big ? 2 : 1) && rng.chance(0.7)) info.eggs.push({ x: w.x, y: baseY + c.y * sc, z: w.z, rot: rot + c.rot });
    }
    // a tattered web across the doorway
    if (ent && sp.interior.length) {
      const near = sp.interior.reduce((p, q) => (Math.hypot(q.x - ent[0], q.z - ent[1]) < Math.hypot(p.x - ent[0], p.z - ent[1]) ? q : p));
      const w = W(near.x, near.z);
      out.push({ kind: 'cobweb', x: w.x, z: w.z, rot: rot + Math.atan2(ent[0], ent[1]), scale: 1, data: { y: baseY + near.y * sc + 0.25, variant: 3 + rng.int(0, 1) } });
      info.drops.push({ x: w.x, y: baseY + near.y * sc + 2.4, z: w.z });
    }
    // breakables on the floor: pots and a crate (loot), plus the egg sacs' spots kept clear
    const nPots = big ? 3 : 1 + rng.int(0, 1);
    let pots = 0;
    for (const c of spots) {
      if (pots >= nPots) break;
      if (!free(c.x, c.z, 1.3)) continue;
      const w = W(c.x, c.z);
      out.push({ kind: pots === 0 && rng.chance(0.5) ? 'crate' : 'pot', x: w.x, z: w.z, rot: rng.range(0, 6.28), scale: rng.range(0.85, 1.05), data: { y: baseY + c.y * sc - 0.04 } });
      take(c.x, c.z);
      pots++;
    }
    // outside: broken planks, bones and a bleached skull in the drifts
    const nDeb = big ? 4 : 1 + rng.int(0, 1);
    for (let i = 0; i < nDeb; i++) {
      const ang = rng.range(0, Math.PI * 2), d = radius + rng.range(0.5, 3);
      out.push({ kind: 'plankDebris', x: a.x + Math.cos(ang) * d, z: a.z + Math.sin(ang) * d, rot: rng.range(0, 6.28), scale: 1 });
    }
    for (let i = 0; i < (big ? 2 : 1); i++) {
      const ang = rng.range(0, Math.PI * 2), d = radius * rng.range(0.6, 1.1) + 1;
      out.push({ kind: rng.chance(0.6) ? 'boneScatter' : 'skull', x: a.x + Math.cos(ang) * d, z: a.z + Math.sin(ang) * d, rot: rng.range(0, 6.28), scale: 1 });
    }
    a.data = { ...(a.data ?? {}), ruin: info };
  }

  /** a local oasis pool (dry sub-areas have no sea level): a water surface clipped to the carved basin */
  private addPool(a: Anchor) {
    const lvl = a.data?.level as number | undefined;
    const r = (a.data?.r as number | undefined) ?? 9;
    if (lvl === undefined || lvl <= this.world.sa.waterLevel + 0.05) return;
    const R = r * 1.45, step = 0.5;
    const n = Math.ceil((R * 2) / step) + 1;
    const pos: number[] = [], depth: number[] = [], idx: number[] = [];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = a.x - R + i * step, z = a.z - R + j * step;
        pos.push(x, lvl, z);
        depth.push(lvl - this.world.sa.field.heightSmooth(x, z));
      }
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const k = i + j * n;
        const q = [k, k + 1, k + n, k + n + 1];
        if (q.every((t) => depth[t] < -0.05)) continue;
        idx.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const env = PRESETS[this.world.sa.env];
    const mat = new THREE.ShaderMaterial({
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      transparent: true,
      fog: true,
      uniforms: {
        ...atmoFogUniforms(),
        uTime: globalUniforms.uTime,
        uDeep: { value: new THREE.Color(0x1f6a6e) },
        uShallow: { value: new THREE.Color(0x63c4b0) },
        uSky: { value: new THREE.Color(env.zenith).lerp(new THREE.Color(env.fog), 0.45) },
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    mesh.receiveShadow = false;
    this.group.add(mesh);
    this.pools.push({ x: a.x, z: a.z, r, level: lvl, mesh });
  }

  /** world position of a landmark-local point (meta.entrance etc.) */
  landmarkPoint(inst: PropInst, lx: number, lz: number) {
    const rot = inst.extra.rot;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    return new THREE.Vector3(inst.anchor.x + lx * cs + lz * sn, inst.baseY, inst.anchor.z - lx * sn + lz * cs);
  }

  breakProp(inst: PropInst, spd = 8, dir?: THREE.Vector3) {
    if (inst.broken) return;
    inst.broken = true;
    for (const c of inst.colliders) this.world.colliders.remove(c);
    if (inst.mesh) inst.mesh.visible = false;
    else if (inst.batch) this.layoutBatch(inst.batch, this.lastLodPos);
    this.onBreak?.(inst, spd, dir);
  }

  private dirtyBatches = new Set<Batch>();
  riseFor(stamp: string, k: number) {
    for (const p of this.list) {
      if (p.rise !== stamp) continue;
      const depth = (p.variant.height + 0.5) * (1 - k);
      const e = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      p.matrix.decompose(e, q, s);
      e.y = p.baseY - depth;
      p.matrix.compose(e, q, s);
      if (p.mesh) {
        p.mesh.matrix.copy(p.matrix);
        p.mesh.matrixWorldNeedsUpdate = true;
      } else if (p.batch) this.dirtyBatches.add(p.batch);
      if (k > 0.98 && !p.colliders.length) this.addColliders(p, KINDS[p.kind], s.x, Math.atan2(2 * (q.w * q.y), 1 - 2 * q.y * q.y), p.baseY, false);
    }
  }

  update(dt: number, focus: THREE.Vector3, wind: { x: number; z: number }, fx?: any) {
    if (focus.distanceTo(this.lastLodPos) > 8) {
      this.lastLodPos.copy(focus);
      for (const b of this.batches) this.layoutBatch(b, focus);
      this.dirtyBatches.clear();
    } else if (this.dirtyBatches.size) {
      for (const b of this.dirtyBatches) this.layoutBatch(b, this.lastLodPos);
      this.dirtyBatches.clear();
    }
    for (const r of this.rotors) r.mesh.rotation.z += r.speed * dt;
    // tumbleweeds roll with the wind and bounce over dunes
    for (const t of this.tumbleweeds) {
      const p = t.inst;
      if (p.broken || !p.mesh) continue;
      const pos = _p.setFromMatrixPosition(p.matrix);
      if (pos.distanceTo(focus) > 90) continue;
      t.vel.x += (wind.x * 4 - t.vel.x) * dt * 0.8 + (rnd.next() - 0.5) * dt * 2;
      t.vel.z += (wind.z * 4 - t.vel.z) * dt * 0.8 + (rnd.next() - 0.5) * dt * 2;
      t.vel.y -= 14 * dt;
      pos.addScaledVector(t.vel, dt);
      const g = this.world.groundAt(pos.x, pos.z) + 0.02;
      if (pos.y < g) {
        pos.y = g;
        t.vel.y = 1.5 + rnd.next() * 2.5;
      }
      if (this.world.storm.sdf(pos.x, pos.z) < 1) {
        t.vel.x *= -1;
        t.vel.z *= -1;
      }
      t.spin += Math.hypot(t.vel.x, t.vel.z) * dt * 1.6;
      _q.setFromEuler(new THREE.Euler(t.spin, Math.atan2(t.vel.x, t.vel.z), 0, 'YXZ'));
      p.matrix.compose(pos, _q, _s.setScalar(1));
      p.mesh.matrix.copy(p.matrix);
      if (fx && rnd.chance(dt * 3) && pos.y <= g + 0.05) fx.sandSpray(pos, { x: 0, y: 0, z: 0 }, 0.3);
    }
  }

  /** nearest tumbleweed to a point (for ram/shoot interactions) */
  tumbleweedAt(p: THREE.Vector3, r: number) {
    for (const t of this.tumbleweeds) {
      if (t.inst.broken) continue;
      const q = _p.setFromMatrixPosition(t.inst.matrix);
      if (q.distanceTo(p) < r) return t.inst;
    }
    return null;
  }
}
