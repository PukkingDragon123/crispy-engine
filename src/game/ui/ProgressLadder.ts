// THE TRAIL LEDGER: what you are working toward in a run, as one tactile pixel-
// art object on its own HUD layer (a canvas over the run, on the HUD's pixel
// grid), in the HUD's style: real models sculpted on dense voxel grids and
// photographed once (HudSprites' SpriteBank), finished as flat pixel art, with
// Alagard type on top. Nothing on it is drawn by hand except the type and
// little square pixel sparks.
//
//  • A worn leather strap hangs down the left edge from a brass buckle, a
//    bandolier with punched notches. Four badges ride on it:
//      RANK     a stamped brass concho; its parchment tag reads the rank and the
//               reward of the next one, and eight cartridges sit in their loops
//               on the tag, one per eighth of the bounty to the next rank
//      BOSS     a photograph of the next boss itself (its own rig, posed), the
//               wave it waits at and its name; "NOW" while you fight it
//      ZONE     the treasure-map scrap: the wave that opens the next zone and its
//               name (the storm parting to the next region at 50 and 75)
//      FINDS    a rolled blueprint: blueprints and relics found, all time, with
//               this ride's finds counted on
//    In a fight only the badges and a short figure show; the tags slide out from
//    behind the strap for the 30 s break, and for a few seconds whenever a row
//    changes (it pops, glints and swings).
//  • THE SHOP COMPASS: a brass pocket compass at the screen edge whose needle
//    points at Ozymandias's walking shop when it is off-screen, beside a
//    photograph of Gobi's turtle house and the distance; on screen, the little
//    turtle house rides over him with the distance under it. It shows during
//    the break, when the shop is near, and early in a ride; grey while he is
//    dug in.
//  • FIRST-TIME TIPS: a pinned note slides out under the ledger the first time
//    something new happens (the break, the shop, a rank-up, a boss wave coming,
//    a zone opening, a blueprint or relic found). Each shows once, ever.
//
// RunScene hooks (one each): construct after the director exists, update at the
// end of updateHud, dispose in exit.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import type { Ctx } from '../Ctx';
import type { Hud } from './Hud';
import type { WaveDirector } from '../run/WaveDirector';
import type { World } from '../world/World';
import type { Shop } from './Shop';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { VF } from '../../engine/voxel/VoxelModel';
import { buildRigGeo, clearRigCache, RigInstance, type RigSpec } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import { blueprintScroll, mapFragment } from '../models/props/treasure';
import { sculpt, Surf, fbm3, h3, mixc, mulc, clamp, clamp01, len2, sdRoundBox2, TAU, METAL, KNZ } from './HudKit';
import { SpriteBank, Shot, Sprite, blitC, blitObj, variant, framingBox, wrap, pixelText, pixelTextWidth } from './HudSprites';
import { Blueprints } from '../meta/Blueprints';
import { SUBAREAS } from '../world/RegionGen';

export interface LadderDeps {
  engine: Engine;
  ctx: Ctx;
  hud: Hud;
  director: WaveDirector;
  world: World;
  shop: Shop;
  camera: THREE.Camera;
}

const V2 = 2; // voxels per HUD px
const geoOf = (m: ReturnType<typeof sculpt>, vph: number) => buildVoxelGeometry(m, { voxelSize: 1 / vph, pivot: [0, 0, 0] });
const lit = (s: Surf) => s.nx * -0.45 + s.ny * 0.6 + s.nz * 0.66;

// ================================================================== the models (only ever photographed)
const LEATHER = { base: 0x6e4226, shade: 0x4a2a16, dark: 0x2a160a, hi: 0x9a6438, worn: 0xb08050 };
const BRASS = { base: 0xb88426, shade: 0x7c5214, hi: 0xf0d27a, dark: 0x4a3008, tarnish: 0x6a5426 };
const PAPER = { base: 0xe2cc98, shade: 0xc4a874, hi: 0xf2e2b8, edge: 0x9a7a48, fox: 0xa8844e };
const STRAP_L = 128;

/** the strap: stitched, notched leather hanging from a brass buckle, a pointed tip at the foot */
function strapModel() {
  const L = STRAP_L, half = L / 2;
  const holes: number[] = [];
  for (let y = half - 22; y > -half + 10; y -= 12) holes.push(y);
  const col = (x: number, y: number) => {
    const X = x / V2, Y = y / V2;
    // strap outline: rounded sides, tapering to a point at the foot
    const hw = Math.min(6, Math.max(0, (Y + half + 3) * 0.75));
    const strap = Math.max(Math.abs(X) - hw, Math.abs(Y - 3) - (half + 3));
    // the buckle frame round the top
    const by = half + 4;
    const outer = sdRoundBox2(X, Y - by, 8.2, 5.4, 2.2), inner = sdRoundBox2(X, Y - by, 5.6, 2.9, 1.2);
    const frame = Math.max(outer, -inner);
    const prong = Math.max(Math.abs(X) - 0.8, Math.abs(Y - (by - 1.5)) - 4);
    let hole = 9;
    for (const hy of holes) hole = Math.min(hole, len2(X, Y - hy));
    return { strap, frame, prong, hole, X, Y };
  };
  type C = ReturnType<typeof col>;
  const sd = (x: number, y: number, z: number, c: C) => {
    const Z = z / V2;
    let d = 9;
    if (c.strap < 0.5) {
      const top = 1.5 + 0.35 * (1 - (c.X / 6) ** 2) + 0.15 * fbm3(c.X * 0.4, c.Y * 0.2, 1);
      let s = Math.max(c.strap, Z - top, -Z);
      if (c.hole < 1.25) s = Math.max(s, 1.25 - c.hole);
      // saddle stitching down both edges
      if (Math.abs(Math.abs(c.X) - 4.3) < 0.45 && ((c.Y + 400) % 2.6) < 1.5 && c.Y < STRAP_L / 2) s = Math.min(s, Math.max(c.strap, Z - top - 0.45, -Z));
      d = s;
    }
    if (c.frame < 0.5) d = Math.min(d, Math.max(c.frame, Math.abs(Z - 2.1) - 1.1 - 0.4 * clamp01(-c.frame)));
    if (c.prong < 0.5) d = Math.min(d, Math.max(c.prong, Math.abs(Z - 2.6) - 0.7));
    return d * V2;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const c = col(x, y);
    const L0 = lit(s);
    if ((c.frame < 0.6 || c.prong < 0.6) && z / V2 > 0.9) {
      let k = L0 > 0.8 ? BRASS.hi : L0 > 0.45 ? BRASS.base : L0 > 0.1 ? BRASS.shade : BRASS.dark;
      if (s.exp < 0.3) k = mixc(k, BRASS.tarnish, 0.5);
      if (s.exp > 0.55) k = mixc(k, BRASS.hi, 0.4);
      return [k, METAL];
    }
    let k = L0 > 0.85 ? LEATHER.hi : L0 > 0.5 ? LEATHER.base : L0 > 0.15 ? LEATHER.shade : LEATHER.dark;
    const n = fbm3(x * 0.07, y * 0.03, 3);
    if (n > 0.32 && s.nz > 0.5) k = mixc(k, LEATHER.worn, 0.35); // rubbed where it lies on the coat
    if (Math.abs(Math.abs(c.X) - 4.3) < 0.5 && z / V2 > 1.55) k = 0xd8c49a; // waxed thread
    if (c.hole < 2.0) k = mixc(k, LEATHER.dark, 0.6);
    if (s.exp < 0.3) k = mixc(k, LEATHER.dark, 0.4);
    return [mulc(k, 0.94 + h3(x, y, z, 2) * 0.1), VF.SOLID];
  };
  return sculpt('ledger_strap', [-18, -(STRAP_L / 2 + 6) * V2, 0, 18, (STRAP_L / 2 + 11) * V2, 8], sd, paint, VF.SOLID, col);
}

/** a stamped brass concho: scalloped rim, a bead, a domed boss with a raised five-point star */
function conchoModel() {
  const sdStar5 = (x: number, y: number, r: number) => {
    const a = Math.atan2(x, y), n = 5;
    const seg = TAU / n;
    const b = ((a % seg) + seg) % seg - seg / 2;
    const L = len2(x, y);
    const px = L * Math.cos(b), py = Math.abs(L * Math.sin(b));
    // the edge from the tip (r, 0) to the notch (0.45 r at half a segment)
    const ax = r, ay = 0, bx = 0.45 * r * Math.cos(seg / 2), by = 0.45 * r * Math.sin(seg / 2);
    const ex = bx - ax, ey = by - ay;
    const t = clamp(((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey), 0, 1);
    const dx = px - ax - ex * t, dy = py - ay - ey * t;
    return len2(dx, dy) * Math.sign(ex * (py - ay) - ey * (px - ax)) * -1;
  };
  const col = (x: number, y: number) => {
    const X = x / V2, Y = y / V2;
    const r = len2(X, Y), a = Math.atan2(Y, X);
    const R = 10 + 0.7 * Math.cos(a * 12);
    return { r, d2: r - R, star: sdStar5(X, Y, 5.6) };
  };
  type C = ReturnType<typeof col>;
  const sd = (x: number, y: number, z: number, c: C) => {
    const Z = z / V2;
    if (c.d2 > 0.5) return 1;
    let top = 1.0 + 1.5 * (1 - (c.r / 10.7) ** 2);
    if (c.r > 7.8 && c.r < 9.0) top += 0.5; // the bead
    if (c.star < 0) top += 1.0 + 0.3 * clamp01(-c.star);
    top += 0.1 * fbm3(x * 0.2, y * 0.2, 4);
    return Math.max(c.d2, Z - top, -Z) * V2;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const c = col(x, y);
    const L0 = lit(s);
    let k = L0 > 0.86 ? BRASS.hi : L0 > 0.55 ? BRASS.base : L0 > 0.2 ? mixc(BRASS.base, BRASS.shade, 0.6) : BRASS.shade;
    if (s.exp < 0.3) k = mixc(k, BRASS.tarnish, 0.55);
    if (c.star < -0.4 && L0 > 0.5) k = mixc(k, BRASS.hi, 0.5); // the polished star
    if (s.exp > 0.5) k = mixc(k, BRASS.hi, 0.4);
    return [mulc(k, 0.95 + h3(x, y, z, 3) * 0.08), METAL];
  };
  return sculpt('ledger_concho', [-24, -24, 0, 24, 24, 10], sd, paint, VF.SOLID, col);
}

/** a strip of foxed parchment, torn ragged at the free end, held by an iron tack (left, or top for a note) */
function paperModel(W: number, H: number, pin: 'left' | 'top', seed: number) {
  const tack = pin === 'left' ? [5, 0] : [0, H / 2 - 5];
  const col = (x: number, y: number) => {
    const X = x / V2, Y = y / V2;
    const tear = KNZ.n2(Y * 0.45 + seed, seed * 3) * 2.2 + KNZ.n2(Y * 1.7, seed) * 0.8;
    const tearY = KNZ.n2(X * 0.3 + seed * 2, seed) * 0.9;
    let d = sdRoundBox2(X - W / 2, Y, W / 2, H / 2 + tearY * 0.6, 1.2);
    if (pin === 'left') d = Math.max(d, X - (W - 3 + tear));
    else d = Math.max(d, -Y - (H / 2 - 2 + tear * 0.7));
    return { d, nail: len2(X - (pin === 'left' ? tack[0] : W / 2), Y - tack[1]), X, Y };
  };
  type C = ReturnType<typeof col>;
  const sd = (x: number, y: number, z: number, c: C) => {
    const Z = z / V2;
    const curl = 0.7 * Math.sin((c.X / W) * Math.PI) * (pin === 'left' ? 1 : 0.6) + 0.25 * fbm3(c.X * 0.12, c.Y * 0.12, seed);
    let d = Math.max(c.d, Math.abs(Z - 0.9 - curl) - 0.55);
    if (c.nail < 2.2) d = Math.min(d, len2(c.nail / 1.6, (Z - 2.2) / 0.8) - 1);
    return d * V2;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const c = col(x, y);
    if (c.nail < 2.2 && z / V2 > 1.6) {
      const L0 = lit(s);
      return [L0 > 0.7 ? 0x8a8478 : L0 > 0.3 ? 0x5a5650 : 0x302c28, METAL];
    }
    const L0 = lit(s);
    let k = L0 > 0.9 ? PAPER.hi : L0 > 0.45 ? PAPER.base : PAPER.shade;
    const n = fbm3(x * 0.05, y * 0.05, seed);
    if (n > 0.3) k = mixc(k, PAPER.shade, 0.5);
    if (c.d > -1.6) k = mixc(k, PAPER.edge, 0.6); // the dark, handled edge
    if (h3(Math.floor(x / 3), Math.floor(y / 3), seed) > 0.985) k = PAPER.fox;
    if (c.nail < 3.2) k = mixc(k, 0x6a4a28, 0.4); // rust bleeding from the tack
    return [k, VF.SOLID];
  };
  return sculpt('ledger_paper', [-2, -(H / 2 + 3) * V2, 0, (W + 2) * V2, (H / 2 + 3) * V2, 7], sd, paint, VF.SOLID, col);
}

/** a brass cartridge standing up: rimmed base, waisted case, lead round nose */
function cartridgeModel() {
  const V = 4;
  const sd = (x: number, y: number, z: number) => {
    const X = x / V, Y = y / V, Z = z / V - 2;
    const r = len2(X, Z);
    let R: number;
    if (Y < 0.6) R = 1.95; // rim
    else if (Y < 0.9) R = 1.5; // extractor groove
    else if (Y < 6.6) R = 1.7 - (Y - 0.9) * 0.02;
    else if (Y < 10) R = 1.55 * Math.sqrt(Math.max(0, 1 - ((Y - 6.6) / 3.6) ** 2)); // the bullet's round nose
    else return 1;
    return Math.max(r - R, -Y) * V;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const Y = y / V;
    const L0 = lit(s);
    if (Y >= 6.6) return [L0 > 0.75 ? 0x9a9690 : L0 > 0.35 ? 0x6e6a66 : 0x45423e, METAL];
    let k = L0 > 0.8 ? BRASS.hi : L0 > 0.4 ? BRASS.base : BRASS.shade;
    if (Y < 0.9) k = mixc(k, BRASS.dark, 0.3);
    return [k, METAL];
  };
  return sculpt('ledger_cartridge', [-8, 0, 0, 8, 42, 16], sd, paint);
}

/** a brass pocket compass: knurled bezel, enamel dial with four studs (north in red), the bail at the top */
function compassModel() {
  const col = (x: number, y: number) => {
    const X = x / V2, Y = y / V2;
    return { r: len2(X, Y), a: Math.atan2(Y, X), X, Y, bail: len2(len2(X, Y - 12.2) - 2.4, 0) };
  };
  type C = ReturnType<typeof col>;
  const studs = [[0, 6.3], [6.3, 0], [0, -6.3], [-6.3, 0]];
  const sd = (x: number, y: number, z: number, c: C) => {
    const Z = z / V2;
    let d = 9;
    if (c.r < 10.6) {
      const edge = clamp01((c.r - 8.4) / 2.2);
      let top = c.r < 8.2 ? 2.2 : 3.4 - edge * edge * 1.6;
      if (c.r > 8.2 && c.r < 9.4) top += 0.25 * (Math.cos(c.a * 36) > 0 ? 1 : 0); // knurling
      for (const [sx, sy] of studs) if (len2(c.X - sx, c.Y - sy) < 0.9) top = 2.8;
      d = Math.max(c.r - 10.3, Z - top, -Z);
    }
    // the bail ring standing up from the crown, and the crown stem
    const ring = len2(len2(c.X, c.Y - 12.4) - 2.3, Z - 1.6) - 0.75;
    const stem = Math.max(Math.abs(c.X) - 1.1, Math.abs(c.Y - 10.4) - 1.0, Math.abs(Z - 1.6) - 1.1);
    return Math.min(d, ring, stem) * V2;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const c = col(x, y);
    const Z = z / V2;
    const L0 = lit(s);
    if (c.r < 8.2 && Z < 2.5 && Z > 1.6) {
      // the enamel dial, crazed with age
      let k = 0xe6d8b8;
      if (fbm3(x * 0.1, y * 0.1, 7) > 0.35) k = 0xd2c098;
      if (Math.abs(Math.sin(c.a * 8)) < 0.05 && c.r > 5 && c.r < 7.6) k = 0x6a5030;
      return [k, VF.SOLID];
    }
    for (const [sx, sy] of studs) if (len2(c.X - sx, c.Y - sy) < 1.0 && Z > 2.3) return [sx === 0 && sy > 0 ? 0xb8322a : 0x3a2a1a, VF.SOLID];
    let k = L0 > 0.86 ? BRASS.hi : L0 > 0.5 ? BRASS.base : L0 > 0.15 ? BRASS.shade : BRASS.dark;
    if (s.exp < 0.3) k = mixc(k, BRASS.tarnish, 0.5);
    if (s.exp > 0.55) k = mixc(k, BRASS.hi, 0.35);
    return [k, METAL];
  };
  return sculpt('ledger_compass', [-24, -24, 0, 24, 32, 9], sd, paint, VF.SOLID, col);
}

/** the needle: a slim lozenge, the north half red-lacquered, the south half blued steel, a brass cap */
function needleModel() {
  const V = 3;
  const sd = (x: number, y: number, z: number) => {
    const X = x / V, Y = y / V, Z = z / V;
    const w = 1.25 * (1 - Math.abs(Y) / 6.6);
    const d = Math.max(Math.abs(X) - w, Math.abs(Y) - 6.6, Math.abs(Z - 0.5) - 0.45);
    const cap = len2(len2(X, Y) - 0, Z - 0.9) - 1.2;
    return Math.min(d, cap) * V;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const X = x / V, Y = y / V;
    const L0 = lit(s);
    if (len2(X, Y) < 1.25) return [L0 > 0.6 ? BRASS.hi : BRASS.base, METAL];
    if (Y > 0) return [L0 > 0.6 ? 0xd85a44 : 0xa8281c, VF.SOLID];
    return [L0 > 0.6 ? 0x7a8aa8 : 0x3a4a6a, METAL];
  };
  return sculpt('ledger_needle', [-5, -21, 0, 5, 21, 7], sd, paint);
}

// ------------------------------------------------------------------ boss table (mirrors bosses/BossRoster)
const BOSS: Record<string, { name: string; model: string }> = {
  khonsu: { name: 'Avatar of Khonsu', model: 'khonsu_avatar' },
  khonsuSand: { name: 'Khonsu of the Sands', model: 'khonsu_sand' },
  sethos: { name: 'Sethos', model: 'sethos_1' },
  setAvatar: { name: 'Avatar of Set', model: 'sethos_3' },
  bertha: { name: 'Big Bertha', model: 'big_bertha' },
  marshal: { name: 'The Dust Marshal', model: 'dust_marshal_1' },
  sunroller: { name: 'The Sunroller', model: 'sunroller' },
  pharaoh: { name: 'Pharaoh Nekh-Amun', model: 'pharaoh' },
  sandworm: { name: 'Old Gulp', model: 'sandworm' },
  ironclad: { name: 'The Ironclad', model: 'ironclad' },
  thornback: { name: 'Old Thornback', model: 'thorny_lizard_boss' },
};
/** which boss waits at boss wave w (the same table as makeBoss) */
export function bossAt(w: number) {
  let id: string;
  if (w >= 100) id = 'setAvatar';
  else if (w === 85 || w === 50) id = 'sethos';
  else if (w === 75) id = 'khonsuSand';
  else if (w === 5 || w === 35 || w === 65) id = 'khonsu';
  else if (w === 10 || w === 25 || w === 40) id = 'marshal';
  else {
    const first: Record<number, string> = { 15: 'thornback', 20: 'ironclad', 30: 'sandworm', 45: 'bertha', 55: 'pharaoh', 60: 'sunroller' };
    const rot = ['bertha', 'sunroller', 'ironclad', 'sandworm', 'pharaoh', 'thornback'];
    id = first[w] ?? rot[Math.floor(w / 5) % rot.length];
  }
  return { id, ...BOSS[id] };
}

// ------------------------------------------------------------------ first-time tips
const TIP_KEY = 'dustup-tips-v1';
const TIPS: Record<string, [string, string, string]> = {
  ledger: ['THE TRAIL LEDGER', 'Your next rank, the next boss', 'and your finds hang here.'],
  break: ['A THIRTY SECOND BREAK', 'Heal up, shop or explore.', 'Hold T to ring the bell early.'],
  shop: ['THE WALKING SHOP', 'Follow the smoke and the bell.', 'Ride up slowly to trade.'],
  rank: ['BOUNTY RANK UP', 'Every rank deals three cards.', 'Keep one upgrade for the ride.'],
  boss: ['A BOSS RIDES IN NEXT', 'Every fifth wave. Beat it and', 'the storm opens a new zone.'],
  zone: ['THE STORM PARTED', 'A new zone is open: new jobs,', 'new landmarks, richer loot.'],
  blueprint: ['BLUEPRINT FOUND', 'Kept forever. Fit it on the', 'workbench at the hideout.'],
  relic: ['RELIC DUG UP', 'It goes on the curio shelf', 'at home, and pays the bank.'],
};
function seenTips(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(TIP_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  t: number;
  c: string;
}
interface Row {
  /** the figure shown next to the badge in a fight */
  short: string;
  title: string;
  sub: string;
  /** pops when it changes */
  pop: number;
  key: string;
  /** 0..1 how far its tag is slid out */
  slide: number;
}

const _cv = new THREE.Vector3();
const M = new Map<string, THREE.Object3D>();
function piece(name: string, make: () => THREE.Object3D) {
  let g = M.get(name);
  if (!g) {
    g = wrap(make());
    M.set(name, g);
  }
  return g;
}

export class ProgressLadder {
  private cv = document.createElement('canvas');
  private c: CanvasRenderingContext2D;
  private bank = SpriteBank.get();
  private s = 2;
  private w = 0;
  private h = 0;
  private t = 0;
  private show = 0;
  /** seconds the tags stay out after something changed */
  private hold = 10;
  private rows: Row[] = [];
  private sparks: Spark[] = [];
  private bp0 = 0;
  private rel0 = 0;
  private bpRun = 0;
  private relRun = 0;
  private counts = { bp: { found: 0, total: 0 }, rel: { found: 0, total: 0 } };
  private unsub: (() => void)[] = [];
  // compass
  private cmp = { x: 0, y: 0, show: 0, ang: 0, on: false };
  // tips
  private seen = seenTips();
  private tipQ: string[] = [];
  private tip: { id: string; t: number } | null = null;
  private lastZone = 0;
  private wasBreak = false;

  constructor(private d: LadderDeps) {
    this.c = this.cv.getContext('2d')!;
    this.cv.id = 'ledger';
    this.cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;image-rendering:pixelated';
    d.engine.overlay.appendChild(this.cv);
    this.resize();
    this.readCounts();
    this.bp0 = this.counts.bp.found;
    this.rel0 = this.counts.rel.found;
    this.lastZone = d.world.activeZone;
    const ev = d.ctx.events;
    const on = (e: string, f: (...a: any[]) => void) => this.unsub.push(ev.on(e, f));
    on('blueprintFound', () => {
      this.bpRun++;
      this.readCounts();
      this.poke(3);
      this.want('blueprint');
    });
    on('relicFound', () => {
      this.relRun++;
      this.readCounts();
      this.poke(3);
      this.want('relic');
    });
    on('rankUp', () => {
      this.poke(0);
      this.want('rank');
    });
    on('intermission', (b: { next?: number }) => {
      this.want('break');
      if ((b?.next ?? 0) % 5 === 0) this.want('boss');
    });
    this.want('ledger');
    for (let i = 0; i < 4; i++) this.rows.push({ short: '', title: '', sub: '', pop: 0, key: '', slide: 0 });
  }

  private resize() {
    this.s = this.d.hud.scale || (window.innerWidth > 1800 ? 3 : 2);
    const w = Math.ceil(window.innerWidth / this.s), h = Math.ceil(window.innerHeight / this.s);
    if (w === this.w && h === this.h) return;
    this.w = this.cv.width = w;
    this.h = this.cv.height = h;
    this.c.imageSmoothingEnabled = false;
  }

  private readCounts() {
    try {
      this.counts.bp = Blueprints.count();
      let f = 0, t = 0;
      for (const r of Blueprints.relics()) {
        f += r.found;
        t += r.total;
      }
      this.counts.rel = { found: f, total: t };
    } catch {
      /* no save */
    }
  }

  /** a row changed: it pops and the tags slide out for a few seconds */
  private poke(i: number) {
    const r = this.rows[i];
    if (r) r.pop = 1;
    this.hold = Math.max(this.hold, 6);
  }

  private want(id: string) {
    if (this.seen.has(id) || this.tipQ.includes(id) || this.tip?.id === id) return;
    this.tipQ.push(id);
  }

  // ---------------------------------------------------------------- photographs
  private strap() {
    const w = 18, h = STRAP_L + 18;
    return this.bank.get('lg:strap', `${w}x${h}`, 58, (): Shot => ({ obj: piece('strap', () => new THREE.Mesh(geoOf(strapModel(), V2), this.bank.material())), w, h, yaw: 0.05, pitch: 0.06, fit: true }));
  }
  private concho(S: number) {
    return this.bank.get('lg:concho', S, 57, (): Shot => ({ obj: piece('concho', () => new THREE.Mesh(geoOf(conchoModel(), V2), this.bank.material())), w: S, h: S, yaw: 0.18, pitch: 0.14, fit: true }));
  }
  private paper(W: number, H: number, pin: 'left' | 'top') {
    const k = `${W}x${H}${pin}`;
    return this.bank.get('lg:paper' + k, k, 54, (): Shot => ({
      obj: piece('paper' + k, () => new THREE.Mesh(geoOf(paperModel(W, H, pin, (W * 7 + H) % 13), V2), this.bank.material())),
      w: W + 4, h: H + 6, yaw: 0, pitch: 0.04, fit: true,
    }));
  }
  private cartridge() {
    return this.bank.get('lg:cart', 'c', 53, (): Shot => ({ obj: piece('cart', () => new THREE.Mesh(geoOf(cartridgeModel(), 4), this.bank.material())), w: 6, h: 12, yaw: 0.3, pitch: 0.1, fit: true }));
  }
  /** a prop model from the game (a map scrap, a blueprint roll) */
  private prop(name: string, S: number, make: () => { model: any; voxelSize: number }, yaw: number, pitch: number) {
    return this.bank.get('lg:' + name, S, 52, (): Shot => ({
      obj: piece(name, () => {
        const m = make();
        return new THREE.Mesh(buildVoxelGeometry(m.model, { voxelSize: m.voxelSize, pivot: 'center' }), this.bank.material());
      }),
      w: S, h: S, yaw, pitch, fit: true,
    }));
  }
  /** the next boss, photographed from its own rig (built once, then let go) */
  private boss(key: string, S: number) {
    return this.bank.get('lg:boss', key + '@' + S, 40, (): Shot | null => {
      const spec = modelEntry(key)?.() as RigSpec | undefined;
      if (!spec?.parts) return null;
      const ck = 'ledger:' + key;
      const rig = new RigInstance(buildRigGeo(spec, ck), { material: this.bank.material() });
      return {
        obj: wrap(rig.root), w: S, h: S, yaw: 0.5, pitch: 0.1, fit: true,
        after: () => {
          rig.root.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
          clearRigCache(ck);
        },
      };
    });
  }
  /** Gobi's turtle house, as the compass's picture */
  private turtle(S: number, grey: boolean) {
    const sp = this.bank.get('lg:turtle', S, 56, (): Shot | null => {
      const spec = modelEntry('turtle_house')?.() as RigSpec | undefined;
      if (!spec?.parts) return null;
      const rig = new RigInstance(buildRigGeo(spec, 'turtle_house:npc'), { material: this.bank.material() });
      return { obj: wrap(rig.root), w: Math.round(S * 1.25), h: S, yaw: -0.75, pitch: 0.18, fit: true };
    });
    return sp && grey ? variant(sp, 'grey') : sp;
  }
  private compass(frame: number) {
    return this.bank.get('lg:cmp' + frame, 'c', 50, (): Shot => {
      const g = piece('compass', () => {
        const body = new THREE.Group();
        body.add(new THREE.Mesh(geoOf(compassModel(), V2), this.bank.material()));
        const nd = new THREE.Group();
        nd.name = 'needle';
        const nm = new THREE.Mesh(geoOf(needleModel(), 3), this.bank.material());
        nm.position.z = 2.3;
        nd.add(nm);
        body.add(nd);
        body.add(framingBox([-12, -12, 0], [12, 16, 5]));
        return body;
      });
      const nd = g.getObjectByName('needle');
      if (nd) nd.rotation.z = -(frame / 16) * TAU;
      return { obj: g, w: 24, h: 28, yaw: 0, pitch: 0.08, fit: true };
    });
  }

  // ---------------------------------------------------------------- state -> rows
  private compute() {
    const { ctx, director: dr, world } = this.d;
    const run = ctx.run;
    const R = this.rows;
    // rank
    const frac = clamp01(run.bounty / Math.max(1, run.bountyToNext));
    R[0].short = String(run.rank);
    R[0].title = `RANK ${run.rank}`;
    R[0].sub = 'next rank: an upgrade';
    // the next boss: the wave you are on or the one coming
    const cur = Math.max(1, dr.inBreak ? dr.nextWave : dr.wave || 1);
    const bw = Math.ceil(cur / 5) * 5;
    const fighting = dr.phase === 'boss' && dr.wave === bw;
    const b = bossAt(bw);
    R[1].short = fighting ? 'NOW' : String(bw);
    R[1].title = fighting ? 'BOSS: NOW' : `BOSS AT WAVE ${bw}`;
    R[1].sub = b.name;
    // the next zone (or the storm parting to the next region)
    const zs = world.sa.zones, zi = world.activeZone;
    const next = zs[zi + 1];
    const zw = zs[zi]?.waves?.[1] ?? bw;
    const area = world.sa.key;
    if (next) {
      R[2].short = String(zw);
      R[2].title = `WAVE ${zw} OPENS`;
      R[2].sub = next.name;
    } else if (area !== 'C') {
      const to = SUBAREAS[area === 'A' ? 'B' : 'C'];
      R[2].short = String(zw);
      R[2].title = `WAVE ${zw}: STORM PARTS`;
      R[2].sub = to.name;
    } else {
      R[2].short = '100';
      R[2].title = 'WAVE 100';
      R[2].sub = 'the storm breaks';
    }
    // finds
    const c = this.counts;
    R[3].short = `${c.bp.found}/${c.bp.total}`;
    R[3].title = `BLUEPRINTS ${c.bp.found}/${c.bp.total}`;
    const runFinds = this.bpRun + this.relRun;
    R[3].sub = `relics ${c.rel.found}/${c.rel.total}` + (runFinds ? `  +${runFinds} this ride` : '');
    // a row whose meaning changed pops
    R.forEach((r, i) => {
      const k = i === 0 ? r.short : r.title + r.sub;
      if (r.key && k !== r.key && i !== 3) this.poke(i);
      r.key = k;
    });
    return { frac, boss: b, fighting };
  }

  // ---------------------------------------------------------------- per frame
  update(rdt: number) {
    const dt = Math.min(0.1, rdt);
    this.t += dt;
    this.resize();
    const { hud, engine: eng, director: dr, world } = this.d;
    const c = this.c;
    c.clearRect(0, 0, this.w, this.h);
    const vis = hud.visible && !eng.paused;
    this.show += ((vis ? 1 : 0) - this.show) * Math.min(1, dt * 6);
    if (this.show < 0.02) return;
    this.bank.pump(eng.renderer, 2);
    const S = this.compute();
    // tips: the zone opening, the shop in sight
    if (world.activeZone !== this.lastZone) {
      this.lastZone = world.activeZone;
      this.want('zone');
      this.hold = Math.max(this.hold, 6);
    }
    const shop = this.d.shop.nearestShop();
    if (shop && shop.dist < 140 && !shop.visited) this.want('shop');
    const brk = dr.inBreak;
    if (brk && !this.wasBreak) this.hold = Math.max(this.hold, 3);
    this.wasBreak = brk;
    this.hold = Math.max(0, this.hold - dt);
    const open = brk || this.hold > 0;
    const k = 1;
    const x0 = Math.round(-30 * (1 - this.show)) + 4;
    const top = Math.max(58, Math.round(this.h * 0.17));
    this.paintLedger(c, dt, x0, top, open, S, k);
    this.paintTip(c, dt, x0, top + STRAP_L + 22);
    this.paintCompass(c, dt, shop, brk);
    this.paintSparks(c, dt);
  }

  private paintLedger(c: CanvasRenderingContext2D, dt: number, x0: number, top: number, open: boolean, S: ReturnType<ProgressLadder['compute']>, k: number) {
    void k;
    const sx = x0 + 9;
    const strap = this.strap();
    if (strap) blitObj(c, strap, sx, top + strap.h / 2 - 9, 2, this.show);
    const pitch = 30;
    const y0 = top + 22;
    const icons: (Sprite | null)[] = [
      this.concho(22),
      this.boss(S.boss.model, 24),
      this.prop('map', 22, () => mapFragment(5), 0.3, 1.2),
      this.prop('scroll', 22, () => blueprintScroll('gun'), 0.6, 0.35),
    ];
    this.rows.forEach((r, i) => {
      const cy = y0 + i * pitch;
      r.pop = Math.max(0, r.pop - dt * 1.6);
      // the tag slides out from behind the strap (a little stagger down the strap)
      const want = open ? 1 : 0;
      r.slide += (want - r.slide) * Math.min(1, dt * (want ? 7 - i : 9));
      if (r.slide > 0.02) this.paintTag(c, r, i, sx + 8, cy, S);
      // the badge on the strap
      const ic = icons[i];
      const bounce = Math.sin(r.pop * Math.PI) * 3;
      const sz = 1 + 0.25 * Math.sin(r.pop * Math.PI);
      if (ic) {
        blitObj(c, ic, sx, cy - bounce, 2 + bounce, this.show, ic.w * sz, ic.h * sz);
        if (r.pop > 0.6 && Math.random() < dt * 30) this.spark(sx + (Math.random() - 0.5) * 16, cy + (Math.random() - 0.5) * 14);
      }
      // in a fight: just the figure beside the badge
      const fig = 1 - r.slide;
      if (fig > 0.05 && r.short && i !== 2) {
        c.globalAlpha = fig * this.show;
        pixelText(c, r.short, sx + 14, cy - 8, { size: 16, color: i === 1 && S.fighting ? '#ff8a6a' : '#fff3d6', outline: '#1a0e06' });
        c.globalAlpha = 1;
      }
    });
  }

  private paintTag(c: CanvasRenderingContext2D, r: Row, i: number, x: number, cy: number, S: ReturnType<ProgressLadder['compute']>) {
    const tw = Math.max(pixelTextWidth(r.title, 16), pixelTextWidth(r.sub, 16) + 4) + (i === 0 ? 0 : 0);
    const W = Math.min(220, Math.ceil((tw + 22) / 16) * 16);
    const H = 30;
    const pp = this.paper(W, H, 'left');
    if (!pp) return;
    const e = 1 - Math.pow(1 - r.slide, 3);
    const px = Math.round(x - (W + 10) * (1 - e));
    const swing = Math.sin(this.t * 1.3 + i) * 0.4 + Math.sin(r.pop * Math.PI * 3) * r.pop * 2;
    // clip to the right of the strap so it seems to come out from behind it
    c.save();
    c.beginPath();
    c.rect(x - 3, cy - 30, this.w, 60);
    c.clip();
    blitObj(c, pp, px + pp.w / 2 - 2, cy + Math.round(swing), 2, this.show * Math.min(1, r.slide * 2));
    const tx = px + 10, ty = cy - 14 + Math.round(swing);
    const al = this.show * clamp01(r.slide * 1.6 - 0.4);
    c.globalAlpha = al;
    pixelText(c, r.title, tx, ty, { size: 16, color: '#3a1c0a', lip: '#f6e8c4' });
    pixelText(c, r.sub, tx, ty + 13, { size: 16, color: i === 1 ? '#8a2016' : '#6a4a28' });
    c.globalAlpha = 1;
    // the rank row: eight cartridges in their loops, one per eighth of the bounty to the next rank
    if (i === 0) {
      const cart = this.cartridge();
      if (cart) {
        const n = 8, filled = Math.floor(S.frac * n + 1e-6);
        const cx0 = tx + pixelTextWidth(r.title, 16) + 8;
        for (let j = 0; j < n; j++) {
          const on = j < filled;
          const xx = cx0 + j * 6, yy = ty + 6;
          c.globalAlpha = al * (on ? 1 : 0.35);
          blitC(c, on ? cart : variant(cart, 'shadow'), xx, yy);
        }
        c.globalAlpha = 1;
      }
    }
    c.restore();
  }

  // ---------------------------------------------------------------- the shop compass
  private paintCompass(c: CanvasRenderingContext2D, dt: number, shop: ReturnType<Shop['nearestShop']>, brk: boolean) {
    const C = this.cmp;
    const run = this.d.ctx.run;
    const want = !!shop && !this.d.shop.visiting && shop.dist > 22 && (brk || shop.dist < 170 || run.time < 75);
    C.show += ((want ? 1 : 0) - C.show) * Math.min(1, dt * 4);
    if (C.show < 0.03 || !shop) return;
    const p = this.d.hud.project?.({ x: shop.pos.x, y: shop.pos.y + 8.5, z: shop.pos.z });
    if (!p) return;
    const s = this.s, W = this.w, H = this.h;
    let x = p.x / s, y = p.y / s;
    const onScreen = p.visible && !p.behind && x > 20 && x < W - 20 && y > 30 && y < H - 30;
    const dist = `${Math.round(shop.dist)} m`;
    const tur = this.turtle(22, shop.hidden);
    const al = C.show * this.show;
    if (onScreen) {
      // over Gobi: the little turtle house and the distance under it
      const bob = Math.round(Math.sin(this.t * 2.2) * 1.5);
      if (tur) blitObj(c, tur, x, y - 10 + bob, 3, al);
      c.globalAlpha = al;
      pixelText(c, shop.hidden ? 'dug in' : dist, x, y + 4 + bob, { size: 16, color: shop.hidden ? '#c9a97c' : '#ffd36b', align: 'center', outline: '#1a0e06' });
      c.globalAlpha = 1;
      return;
    }
    // off screen: the compass at the edge, its needle pointing the way (straight ahead = up, behind = down)
    const cx = W / 2, cy = H / 2;
    const v = _cv.set(shop.pos.x, shop.pos.y + 3, shop.pos.z).applyMatrix4(this.d.camera.matrixWorldInverse);
    const ang = Math.atan2(v.x, -v.z); // 0 = up, clockwise
    const mx = W / 2 - 26, my = H / 2 - 34;
    const t = Math.min(mx / Math.max(1e-3, Math.abs(Math.sin(ang))), my / Math.max(1e-3, Math.abs(Math.cos(ang))));
    x = cx + Math.sin(ang) * t;
    y = cy - Math.cos(ang) * t;
    C.ang += Math.atan2(Math.sin(ang - C.ang), Math.cos(ang - C.ang)) * Math.min(1, dt * 8);
    const frame = ((Math.round((C.ang / TAU) * 16) % 16) + 16) % 16;
    const cmp = this.compass(frame);
    const wob = Math.round(Math.sin(this.t * 3.1) * 0.6);
    if (cmp) blitObj(c, cmp, x, y + wob, 3, al);
    // the turtle house and the distance on the inner side
    const ix = x - Math.sin(ang) * 30, iy = y + Math.cos(ang) * 22;
    if (tur) blitObj(c, tur, ix, iy - 4, 2, al * 0.95);
    c.globalAlpha = al;
    pixelText(c, shop.hidden ? 'dug in' : dist, ix, iy + 8, { size: 16, color: shop.hidden ? '#c9a97c' : '#ffd36b', align: 'center', outline: '#1a0e06' });
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- first-time tips
  private paintTip(c: CanvasRenderingContext2D, dt: number, x0: number, y: number) {
    if (!this.tip && this.tipQ.length && this.show > 0.9) {
      const id = this.tipQ.shift()!;
      this.tip = { id, t: 0 };
      this.seen.add(id);
      try {
        localStorage.setItem(TIP_KEY, JSON.stringify([...this.seen]));
      } catch {
        /* storage blocked */
      }
      this.d.ctx.sfx('paper_flutter', null, 0.45, 1.1);
    }
    const T = this.tip;
    if (!T) return;
    T.t += dt;
    const DUR = 8.5;
    if (T.t > DUR) {
      this.tip = null;
      return;
    }
    const lines = TIPS[T.id];
    if (!lines) {
      this.tip = null;
      return;
    }
    const W = 208, H = 52;
    const pp = this.paper(W, H, 'top');
    if (!pp) return;
    const inK = clamp01(T.t / 0.45), outK = clamp01((T.t - (DUR - 0.5)) / 0.5);
    const e = 1 - Math.pow(1 - inK, 3) - outK * outK;
    const x = Math.round(x0 - (W + 12) * (1 - e)) + 2;
    const yy = Math.min(y, this.h - H - 96);
    const sway = Math.sin(T.t * 2.4) * Math.max(0, 1 - T.t * 0.6) * 2;
    blitObj(c, pp, x + pp.w / 2, yy + H / 2 + Math.round(sway), 3, this.show);
    c.globalAlpha = this.show * clamp01(e * 1.5);
    pixelText(c, lines[0], x + 10, yy + 7, { size: 16, color: '#8a2016', lip: '#f6e8c4' });
    pixelText(c, lines[1], x + 10, yy + 22, { size: 16, color: '#3a1c0a' });
    pixelText(c, lines[2], x + 10, yy + 35, { size: 16, color: '#3a1c0a' });
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- pixel sparks
  private spark(x: number, y: number) {
    if (this.sparks.length > 60) return;
    const a = Math.random() * TAU, v = 18 + Math.random() * 30;
    this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 10, life: 0.35 + Math.random() * 0.35, t: 0, c: Math.random() < 0.5 ? '#fff6d0' : '#ffd36b' });
  }
  private paintSparks(c: CanvasRenderingContext2D, dt: number) {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.t += dt;
      if (p.t > p.life) {
        this.sparks.splice(i, 1);
        continue;
      }
      p.vx *= 1 - dt * 3;
      p.vy = p.vy * (1 - dt * 3) + 30 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      c.globalAlpha = (1 - p.t / p.life) * this.show;
      c.fillStyle = p.c;
      c.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    c.globalAlpha = 1;
  }

  dispose() {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.cv.remove();
  }
}
