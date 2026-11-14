// Cleopatra's river craft and guns: the papyrus reed skiff, the cedar war barge
// and the bronze cannon (on a spoked carriage behind wicker gabions for the
// shore batteries; on a pivot block aboard). All rigs share one rig space per
// model (pivot == attach, voxel coords, origin at the waterline amidships,
// bow toward +Z, port = +X).
//
// Breakable hull sections are separate parts (hull_b / hull_f on the skiff;
// bow / stern on the barge, the waist is the root) so the fleet can blow a
// section off and let the rest list and founder. Moving pieces are rigged: the
// sail on its yard, every oar on its oarlock, the steering oars, the gun on
// its trunnions, the carriage wheels.
//
// meta (metres, boat space): deck: [x0, x1, z0, z1, y][] walkable deck rects;
// stations: [x, y, z][] where crew stand; sections: { part, z0, z1, share }[];
// guns: { part, at: [x, y, z] }[]; draft (m below the waterline); length; beam.
import type { RigSpec, PartSpec, V3 } from '../../../engine/voxel/Rig';
import { VoxelModel, VF, mix, mulRGB } from '../../../engine/voxel/VoxelModel';
import type { CSpec } from '../../../engine/voxel/VoxelModel';
import { hash3, noise } from '../../../engine/math/rand';
import { Sc } from '../enemies/real/sculpt';
import { ell, cap, tube } from '../enemies/real/rk';
import { NILE } from './kit';

type G = [number, number, number];
const res = (c: CSpec, x: number, y: number, z: number) => (typeof c === 'number' ? c : (c(x, y, z) as number));

export class BoatRig {
  parts: PartSpec[] = [];
  sockets: Record<string, { part: string; at: V3 }> = {};
  constructor(public name: string, public vs: number) {}
  part(name: string, parent: string | undefined, pivot: G): Sc {
    const m = new VoxelModel(name);
    this.parts.push({ name, model: m, pivot: [...pivot] as V3, attach: [...pivot] as V3, parent });
    return new Sc(m, 1);
  }
  get(name: string) {
    return this.parts.find((p) => p.name === name)!.model;
  }
  sock(name: string, part: string, at: G) {
    this.sockets[name] = { part, at: [...at] as V3 };
  }
  build(meta: Record<string, unknown>): RigSpec {
    // parents first
    const out: PartSpec[] = [];
    const done = new Set<string>();
    const add = (p: PartSpec) => {
      if (done.has(p.name)) return;
      if (p.parent) add(this.parts.find((q) => q.name === p.parent)!);
      done.add(p.name);
      out.push(p);
    };
    for (const p of this.parts) add(p);
    return { name: this.name, voxelSize: this.vs, parts: out, sockets: this.sockets, meta };
  }
}

/** sky light on top faces, darker undersides (the renderer adds AO and the cel ramp) */
export function shadeTops(r: BoatRig, up = 1.06, down = 0.86) {
  for (const p of r.parts) {
    const m = p.model;
    const todo: [number, number, number, number, number][] = [];
    m.forEach((x, y, z, c, f) => {
      if (f & (VF.EMISSIVE | VF.GLOW)) return;
      const u = !m.has(x, y + 1, z), d = !m.has(x, y - 1, z);
      if (u === d) return;
      todo.push([x, y, z, mulRGB(c, u ? up : down), f]);
    });
    for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f);
  }
}

// ============================================================================ materials
export const REED = { a: 0xb8a248, b: 0x9a8a38, c: 0xd2bc62, d: 0x6e6428, band: 0x5a3a1e };
/** bundled papyrus: stalks running along z (stripes by x+y), lashed every `every` voxels */
function reedC(every: number, seed = 0): CSpec {
  return (x, y, z) => {
    if (((z + seed) % every + every) % every === 0) return REED.band;
    if (((z + seed) % every + every) % every === 1) return mix(REED.band, REED.a, 0.4);
    const s = ((x * 3 + y * 5) % 4 + 4) % 4;
    const n = noise.n3(x / 6 + seed, y / 6, z / 14);
    const base = s === 0 ? REED.b : s === 1 ? REED.c : REED.a;
    return n < -0.45 ? mix(base, REED.d, 0.35) : base;
  };
}
/** cedar planking: strakes along z with dark seams every 3 rows, trenails, weathered patches */
export function plankC(seed = 0, base = 0x8a4a2a): CSpec {
  const lite = mix(base, 0xd8a070, 0.22), dark = mix(base, 0x1a0c06, 0.4);
  return (x, y, z) => {
    if (((y % 3) + 3) % 3 === 0) return dark;
    const butt = ((z + Math.floor(y / 3) * 17 + seed) % 23 + 23) % 23 === 0;
    if (butt) return dark;
    const n = noise.n3(x / 5 + seed, y / 2, z / 18);
    return n > 0.42 ? lite : n < -0.45 ? mix(base, dark, 0.35) : base;
  };
}
/** deck boards along z */
export function deckC(seed = 0): CSpec {
  const base = 0xa8743e, dark = 0x5e3a1a, lite = 0xc89a5e;
  return (x, _y, z) => {
    if (((x % 4) + 4) % 4 === 0) return dark;
    const n = noise.n3(x / 4 + seed, 0, z / 20);
    if (((z + x * 13 + seed) % 31 + 31) % 31 === 0) return dark;
    return n > 0.4 ? lite : n < -0.45 ? mix(base, dark, 0.3) : base;
  };
}
/** painted frieze along a gunwale: lapis, gold, carnelian, turquoise bands with a lotus scallop */
export function friezeC(y0: number): CSpec {
  return (x, y, z) => {
    const k = y - y0;
    if (k <= 0) return NILE.lapis;
    if (k === 1) return ((z % 4) + 4) % 4 < 2 ? 0xe8b43a : NILE.carnelian;
    if (k === 2) return 0xe8b43a;
    if (k === 3) return ((Math.floor(z / 3) % 2) + 2) % 2 ? NILE.turq : 0xf0e6cc;
    return NILE.lapis;
  };
}
/** sail cloth: linen with broad red stripes and a few patches */
export function sailC(stripe = 0xa8281e, seed = 0): CSpec {
  return (x, y, z) => {
    const band = ((Math.floor(y / 6) % 2) + 2) % 2 === 0;
    const n = noise.n3(x / 7 + seed, y / 7, z / 7);
    const patch = hash3(Math.floor(x / 8), Math.floor(y / 8), seed) > 0.93;
    const c = band ? stripe : 0xefe2c4;
    return patch ? mix(c, 0x8a7a5a, 0.35) : n > 0.45 ? mix(c, 0xffffff, 0.1) : n < -0.45 ? mix(c, 0x5a4a30, 0.15) : c;
  };
}

// ============================================================================ the bronze gun
/**
 * A bronze cannon barrel along +Z with its trunnion axis at `at` (x across): tapered
 * reinforce rings, a gold-inlaid lotus band, a tulip muzzle and a cascabel knob.
 * `L` = length in voxels; radii scale with it.
 */
export function cannonBarrel(s: Sc, at: G, L: number, o: { gold?: boolean } = {}) {
  const B = o.gold ? [0xe8b43a, 0xb8862a, 0xffe08a] : [0xc08a46, 0x8a5a2a, 0xe8b26a];
  const R0 = L * 0.13, R1 = L * 0.085;
  const zb = at[2] - L * 0.42, zf = at[2] + L * 0.58;
  for (let z = Math.floor(zb); z <= Math.ceil(zf); z++) {
    const t = (z - zb) / (zf - zb);
    let r = R0 + (R1 - R0) * t;
    // the breech swell, reinforce rings, the tulip flare at the muzzle
    if (t < 0.08) r *= 0.75 + t * 3.1;
    const ring = [0.1, 0.32, 0.36, 0.62, 0.66, 0.9].some((q) => Math.abs(t - q) < 0.012);
    if (ring) r += 0.9;
    if (t > 0.88) r += (t - 0.88) * L * 0.12;
    const bore = t > 0.6 ? R1 * 0.5 : 0;
    const lotus = t > 0.42 && t < 0.52;
    for (let x = Math.floor(at[0] - r) - 1; x <= Math.ceil(at[0] + r); x++)
      for (let y = Math.floor(at[1] - r) - 1; y <= Math.ceil(at[1] + r); y++) {
        const dx = x + 0.5 - at[0], dy = y + 0.5 - at[1];
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        if (bore && d < bore && z > zf - L * 0.25) continue;
        const ang = Math.atan2(dy, dx);
        let c = B[0];
        if (ring) c = B[2];
        else if (lotus && d > r - 1.1) c = Math.sin(ang * 8 + (t - 0.42) * 40) > 0.3 ? 0xe8b43a : B[1];
        else if (d > r - 1 && dy > r * 0.5) c = B[2];
        else if (d > r - 1 && dy < -r * 0.4) c = B[1];
        else if (hash3(x, y, z) > 0.985) c = NILE.patina;
        s.m.set(x, y, z, c, c === 0xe8b43a || c === B[2] || c === B[0] ? VF.METAL : VF.METAL);
      }
  }
  // the muzzle mouth stays dark
  for (let x = Math.floor(at[0] - R1); x <= Math.ceil(at[0] + R1); x++)
    for (let y = Math.floor(at[1] - R1); y <= Math.ceil(at[1] + R1); y++)
      if (Math.hypot(x + 0.5 - at[0], y + 0.5 - at[1]) < R1 * 0.5) s.m.set(x, y, Math.floor(zf - 1), 0x0e0a08);
  // cascabel knob and trunnions
  ell(s, [at[0], at[1], zb - 1.2], [R0 * 0.38, R0 * 0.38, 1.6], B[1], { fl: VF.METAL });
  for (const sx of [1, -1]) cap(s, [at[0] + sx * (R0 * 0.8), at[1], at[2]], [at[0] + sx * (R0 + 2.2), at[1], at[2]], R0 * 0.28, R0 * 0.26, B[1], VF.METAL);
  return { muzzle: [at[0], at[1], zf + 0.5] as G };
}

/** a six-spoked chariot wheel in the y-z plane at x (axle along x) */
function wheel(s: Sc, c: G, R: number, w: number) {
  for (let y = Math.floor(c[1] - R) - 1; y <= Math.ceil(c[1] + R); y++)
    for (let z = Math.floor(c[2] - R) - 1; z <= Math.ceil(c[2] + R); z++) {
      const dy = y + 0.5 - c[1], dz = z + 0.5 - c[2];
      const d = Math.hypot(dy, dz);
      const ang = Math.atan2(dy, dz);
      const tyre = d <= R && d > R - 1.6;
      const felloe = d <= R - 1.6 && d > R - 2.8;
      const spoke = d <= R - 2.8 && d > 1.8 && Math.abs(((ang / (Math.PI / 3)) % 1 + 1) % 1 - 0.5) > 0.42 - 0.6 / Math.max(1, d);
      const hub = d <= 1.9;
      if (!(tyre || felloe || spoke || hub)) continue;
      for (let k = 0; k < w + (hub ? 2 : 0); k++) {
        const x = Math.floor(c[0]) + k - (hub ? 1 : 0);
        s.m.set(x, y, z, tyre ? 0x6a5a48 : felloe ? NILE.wood : hub ? NILE.bronze[0] : NILE.woodDark, tyre || hub ? VF.METAL : VF.SOLID);
      }
    }
}

// ============================================================================ SHORE CANNON
/** the bronze shore cannon on a spoked carriage behind wicker gabions and powder jars (1/24) */
export function bankCannonRig(): RigSpec {
  const r = new BoatRig('nile_cannon', 1 / 24);
  // emplacement: a horseshoe of wicker gabions filled with sand, powder jars, a rammer
  const base = r.part('base', undefined, [0, 0, 0]);
  const wick = (x: number, y: number, z: number) => (((x + z) & 1) ^ (y & 1) ? 0x9a7a44 : 0x6e5428);
  for (let k = 0; k < 6; k++) {
    const a = -1.3 + (k / 5) * 2.6;
    const cx = Math.sin(a) * 31, cz = Math.cos(a) * 31;
    const R = 4.4 + hash3(k, 1, 2) * 0.6, H = 10 + Math.floor(hash3(k, 3, 4) * 3);
    for (let y = 0; y <= H; y++)
      for (let x = Math.floor(cx - R) - 1; x <= Math.ceil(cx + R); x++)
        for (let z = Math.floor(cz - R) - 1; z <= Math.ceil(cz + R); z++) {
          const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
          const bulge = R * (1 + Math.sin((y / H) * Math.PI) * 0.06);
          if (d > bulge) continue;
          const top = y === H;
          if (!top && d < bulge - 1.4) continue;
          base.m.set(x, y, z, top ? (noise.n3(x / 3, 0, z / 3) > 0 ? 0xe2bc80 : 0xd2a66a) : y % 5 === 0 ? 0x5a4220 : wick(x, y, z));
        }
  }
  for (const [x, z, h] of [[-22, -14, 13], [-17, -20, 10], [22, -16, 12]] as G[]) {
    // powder jars: amphorae of red clay sealed with tar
    ell(base, [x, h * 0.55, z], [4.2, h * 0.55, 4.2], (xx, yy) => (yy % 4 === 0 ? 0x8a3a22 : 0xb85a32));
    cap(base, [x, h, z], [x, h + 3, z], 2.2, 1.7, 0xa04a2a);
    ell(base, [x, h + 3.4, z], [1.9, 1.0, 1.9], 0x1a1210);
  }
  for (let z = -10; z <= 8; z++) base.m.set(-30, 1, z, NILE.wood); // rammer lying by the gabions
  ell(base, [-30, 1.5, 9.5], [1.6, 1.6, 2.2], 0xd8c8a0);
  // carriage: two cheeks of planked cedar on an axle, a trail sledge behind
  const car = r.part('carriage', 'base', [0, 0, 0]);
  const plank = plankC(3, 0x7a4426);
  for (const sx of [1, -1])
    for (let z = -26; z <= 10; z++) {
      const top = z > 0 ? 22 - (z - 0) * 0.3 : 22 + z * 0.42;
      for (let y = Math.max(2, Math.floor(top - 9)); y <= Math.floor(top); y++) for (let x = 6; x <= 8; x++) car.m.set(sx > 0 ? x : -1 - x, y, z, res(plank, x, y, z));
    }
  for (let x = -8; x <= 7; x++) for (let y = 9; y <= 12; y++) for (let z = -2; z <= 1; z++) car.m.set(x, y, z, NILE.woodDark); // axle beam
  for (let x = -6; x <= 5; x++) for (let z = -24; z <= -14; z++) car.m.set(x, 4, z, res(plank, x, 4, z)); // trail
  // wheels on the axle
  for (const sx of [1, -1]) {
    const wh = r.part(sx > 0 ? 'wheel_l' : 'wheel_r', 'carriage', [sx * 10, 11, 0]);
    wheel(wh, [sx > 0 ? 9 : -12, 11, 0], 11, 3);
  }
  // the gun on its trunnions
  const gun = r.part('gun', 'carriage', [0, 22, 0]);
  const { muzzle } = cannonBarrel(gun, [0, 22, 0], 54);
  r.sock('muzzle', 'gun', muzzle);
  shadeTops(r);
  return r.build({ kind: 'cannon', length: 3.2, height: 1.6, radius: 1.6, muzzle: muzzle.map((v) => v / 24), guns: [{ part: 'gun', at: [0, 22 / 24, 0] }], stations: [[-1.4, 0, -1.3], [1.3, 0, -1.1]] });
}

// ============================================================================ REED SKIFF
/** the papyrus skiff (8 m, 1/14): three lashed bundles, up-curled lotus ends, a reed mat deck, a small sail */
export function reedBoatRig(o: { alpha?: boolean } = {}): RigSpec {
  const vs = 1 / 14;
  const r = new BoatRig('nile_reed_boat', vs);
  const HL = 56; // half length
  const keelY = (z: number) => {
    const u = Math.abs(z) / HL;
    return -3 + Math.max(0, u - 0.45) ** 2 * 50;
  };
  const rad = (z: number, side: boolean) => {
    const u = Math.abs(z) / HL;
    return (side ? 5.6 : 7.4) * Math.max(0.22, 1 - u ** 3) ** 0.7;
  };
  const deck = r.part('deck', undefined, [0, 0, 0]);
  const reeds = reedC(7, 3);
  const half = (zs: number) => r.part(zs > 0 ? 'hull_f' : 'hull_b', 'deck', [0, 0, zs * 4]);
  const hf = half(1), hb = half(-1);
  for (const [sx, side] of [[0, false], [1, true], [-1, true]] as [number, boolean][]) {
    const pts: G[] = [];
    for (let k = 0; k <= 24; k++) {
      const z = -HL + (k / 24) * HL * 2;
      const xo = side ? sx * 6.4 * Math.max(0.15, 1 - (Math.abs(z) / HL) ** 2.4) : 0;
      pts.push([xo, keelY(z) + (side ? -1.0 : 0) + 3, z]);
    }
    // split the bundle at the waist so each half can break away
    const front = pts.filter((p) => p[2] >= -2), back = pts.filter((p) => p[2] <= 2);
    tube(hf, front, (t) => rad(front[0][2] + (front[front.length - 1][2] - front[0][2]) * t, side), reeds);
    tube(hb, back, (t) => rad(back[0][2] + (back[back.length - 1][2] - back[0][2]) * t, side), reeds);
  }
  // the lotus-umbel finials: the bundle ends curl up and over
  for (const [s, zs] of [[hf, 1], [hb, -1]] as [Sc, number][]) {
    const tip = keelY(HL) + 3;
    const pts: G[] = [[0, tip - 4, zs * (HL - 3)], [0, tip + 2, zs * (HL + 1)], [0, tip + 8, zs * (HL + 1)], [0, tip + 11, zs * (HL - 3)], [0, tip + 9, zs * (HL - 7)]];
    tube(s, pts, (t) => 3.0 - t * 1.6, reeds);
    ell(s, [0, tip + 8.5, zs * (HL - 7.5)], [3.0, 2.2, 2.4], (x, y, z) => (((x + y + z) & 1) ? 0x8aa848 : 0x6a8a38));
  }
  // reed-mat deck with a raised helmsman's step and a cane railing
  for (let z = -34; z <= 36; z++)
    for (let x = -9; x <= 8; x++) {
      const w = 9 * Math.max(0, 1 - (Math.abs(z) / 44) ** 4);
      if (Math.abs(x + 0.5) > w) continue;
      deck.m.set(x, 6, z, ((x + z) & 1) ? 0xc8b064 : 0xb09a50);
      deck.m.set(x, 5, z, 0x8a7a3a);
    }
  for (let z = -42; z <= -34; z++) for (let x = -5; x <= 4; x++) deck.m.set(x, 7, z, 0xa89048);
  for (const sx of [1, -1]) for (let z = -30; z <= 30; z += 6) for (let y = 7; y <= 11; y++) deck.m.set(sx > 0 ? 8 : -9, y, z, y === 11 ? REED.band : 0xc8b064);
  for (const sx of [1, -1]) for (let z = -30; z <= 30; z++) deck.m.set(sx > 0 ? 8 : -9, 11, z, REED.band);
  // shields hung on the rail
  for (const sx of [1, -1])
    for (let k = -1; k <= 1; k++)
      for (let y = 7; y <= 13; y++)
        for (let z = k * 16 - 3; z <= k * 16 + 3; z++) {
          const rr = Math.hypot(y - 10, z - k * 16);
          if (rr > 3.6 || (y > 12 && rr > 3)) continue;
          deck.m.set(sx > 0 ? 9 : -10, y, z, rr > 2.8 ? NILE.bronze[0] : rr < 0.8 ? NILE.bronze[2] : ((y + z) & 2) ? 0xe8dcc4 : 0x3a2418, rr > 2.8 || rr < 0.8 ? VF.METAL : VF.SOLID);
        }
  // mast, yard and a small striped sail
  const mast = r.part('mast', 'deck', [0, 6, 14]);
  for (let y = 6; y <= 62; y++) mast.m.set(0, y, 14, y % 9 === 0 ? REED.band : NILE.wood).set(-1, y, 14, NILE.woodDark);
  const sail = r.part('sail', 'mast', [0, 58, 14]);
  for (let x = -16; x <= 15; x++) sail.m.set(x, 58, 15, NILE.woodDark).set(x, 59, 15, NILE.wood);
  const sc = sailC(o.alpha ? 0x2a2a6a : 0xa8281e, 5);
  for (let y = 30; y <= 57; y++)
    for (let x = -15; x <= 14; x++) {
      const belly = Math.round(Math.sin(((x + 15.5) / 30) * Math.PI) * Math.sin(((y - 29) / 29) * Math.PI) * 3.2);
      sail.m.set(x, y, 16 + belly, res(sc, x, y, 0), VF.SOFTAO);
    }
  for (let x = -15; x <= 14; x++) sail.m.set(x, 30, 16, NILE.woodDark);
  // the steering oar at the stern quarter
  const oar = r.part('oar_st', 'deck', [6, 9, -40]);
  for (let k = 0; k <= 30; k++) oar.m.set(6 + Math.round(k * 0.25), 9 - Math.round(k * 0.5), -40 - k, NILE.wood);
  for (let k = 0; k <= 9; k++) for (let w = -2; w <= 2; w++) oar.m.set(14 + w, -6 - Math.round(k * 0.5), -70 - k, NILE.woodDark);
  // bronze-shod ram at the bow waterline
  cap(hf, [0, 1, HL - 12], [0, 0, HL - 1], 2.6, 0.8, NILE.bronze[0], VF.METAL);
  shadeTops(r);
  const m = vs;
  return r.build({
    kind: 'reed', length: HL * 2 * m, beam: 1.4, draft: 0.25, height: 2.4,
    deck: [[-0.6, 0.6, -2.4, 2.6, 7 * m]],
    stations: [[0, 7 * m, 1.9], [0.25, 7 * m, -0.3], [-0.2, 7 * m, -2.3]],
    sections: [{ part: 'hull_f', z0: 0, z1: HL * m, share: 0.5 }, { part: 'hull_b', z0: -HL * m, z1: 0, share: 0.5 }],
    guns: [],
  });
}

// ============================================================================ WAR BARGE
/** the cedar war barge (15 m, 1/12): painted strakes, castles fore and aft, a deckhouse, mast and
 *  striped sail, six oars a side, twin steering oars, a lion-head ram and a bronze bow gun */
export function warBargeRig(o: { alpha?: boolean; scale?: number } = {}): RigSpec {
  const vs = 1 / 12;
  const r = new BoatRig('nile_war_barge', vs);
  const HL = 90, W = 25;
  const keel = (z: number) => -9 + 7 * (z / HL) ** 2 + (z < -HL * 0.55 ? ((-z - HL * 0.55) / (HL * 0.45)) ** 2 * 10 : 0);
  const gun = (z: number) => 9 + (z > HL * 0.6 ? ((z - HL * 0.6) / (HL * 0.4)) ** 2 * 6 : 0) + (z < -HL * 0.6 ? ((-z - HL * 0.6) / (HL * 0.4)) ** 2 * 12 : 0);
  const halfW = (z: number) => W * Math.max(0, 1 - Math.abs(z / (HL + 2)) ** 2.6) ** 0.55;
  const plank = plankC(7, o.alpha ? 0x5a2a1e : 0x8a4a2a);
  const mid = r.part('hull', undefined, [0, 0, 0]);
  const bow = r.part('bow', 'hull', [0, 0, 30]);
  const stern = r.part('stern', 'hull', [0, 0, -30]);
  const secOf = (z: number) => (z > 30 ? bow : z < -30 ? stern : mid);
  for (let z = -HL; z <= HL; z++) {
    const yk = keel(z), yg = gun(z), w = halfW(z);
    if (w < 0.6) continue;
    const s = secOf(z);
    for (let y = Math.floor(yk); y <= Math.ceil(yg); y++) {
      const k = Math.max(0, Math.min(1, (y - yk) / Math.max(1, yg - yk)));
      const wy = w * k ** 0.35;
      for (let x = -Math.ceil(wy) - 1; x <= Math.ceil(wy); x++) {
        const d = wy - Math.abs(x + 0.5);
        if (d < 0) continue;
        const shell = d < 1.8 || y <= Math.floor(yk) + 1;
        if (!shell) continue;
        const frieze = y >= yg - 4;
        s.m.set(x, y, z, frieze ? res(friezeC(Math.ceil(yg) - 4), x, y, z) : y < 1 ? mix(res(plank, x, y, z), 0x2a3a2a, 0.35) : res(plank, x, y, z));
      }
    }
    // the deck
    if (Math.abs(z) < HL - 6)
      for (let x = -Math.floor(w) + 1; x < Math.floor(w) - 1; x++) s.m.set(x, 8, z, res(deckC(3), x, 8, z));
  }
  // forecastle and aftcastle platforms with shield rails
  const castle = (s: Sc, z0: number, z1: number, h: number) => {
    for (let z = z0; z <= z1; z++) {
      const w = halfW(z) - 1.5;
      for (let x = -Math.floor(w); x < Math.floor(w); x++) {
        s.m.set(x, 8 + h, z, res(deckC(5), x, 8 + h, z));
        if (Math.abs(x + 0.5) > w - 1.5 || z === z0) for (let y = 9; y < 8 + h; y++) s.m.set(x, y, z, res(plank, x, y, z));
      }
      for (const sx of [1, -1]) {
        const x = sx > 0 ? Math.floor(w) - 1 : -Math.floor(w);
        for (let y = 9 + h; y <= 12 + h; y++) s.m.set(x, y, z, y === 12 + h ? NILE.bronze[0] : NILE.wood, y === 12 + h ? VF.METAL : VF.SOLID);
        if ((z - z0) % 9 === 4)
          for (let y = 8 + h; y <= 14 + h; y++)
            for (let dz = -3; dz <= 3; dz++) {
              const rr = Math.hypot(y - (11 + h), dz);
              if (rr > 3.6) continue;
              s.m.set(x + sx, y, z + dz, rr > 2.8 ? NILE.bronze[0] : rr < 0.8 ? NILE.bronze[2] : res(((xx: number, yy: number, zz: number) => (noise.n3(xx / 2, yy / 2, zz / 2) > 0.2 ? 0x3a2418 : 0xe8dcc4)) as CSpec, x, y, z + dz), rr > 2.8 || rr < 0.8 ? VF.METAL : VF.SOLID);
            }
      }
    }
  };
  castle(bow, 56, 80, 8);
  castle(stern, -80, -58, 9);
  // the deckhouse: painted columns and a striped canopy
  for (let z = -34; z <= 8; z++)
    for (let x = -14; x <= 13; x++) {
      const edgeX = x === -14 || x === 13, edgeZ = z === -34 || z === 8;
      const col = (edgeX || edgeZ) && ((x + 100) % 7 === 0 || (z + 100) % 7 === 0 || (edgeX && edgeZ));
      if (col) for (let y = 9; y <= 26; y++) mid.m.set(x, y, z, y > 23 ? 0x2e9a8a : y < 12 ? NILE.lapis : ((y & 1) ? 0xe8dcc0 : 0xd8c8a8));
      mid.m.set(x, 27, z, ((Math.floor(x / 3) & 1) ? NILE.lapis : 0xf0e6cc));
      if (edgeX || edgeZ) mid.m.set(x, 26, z, 0xe8b43a, VF.METAL);
    }
  // mast + yard + the great sail (rigged)
  const mast = r.part('mast', 'hull', [0, 8, 18]);
  for (let y = 8; y <= 96; y++) for (const [dx, dz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) mast.m.set(dx, y, 18 + dz, (y % 12 === 0) ? NILE.rawhide : dx + dz === -1 ? NILE.woodDark : NILE.wood);
  ell(mast, [-0.5, 97, 17.5], [2.2, 1.6, 2.2], NILE.bronze[0], { fl: VF.METAL });
  const sail = r.part('sail', 'mast', [0, 90, 19]);
  for (let x = -36; x <= 35; x++) for (const y of [90, 91]) sail.m.set(x, y, 19, y === 91 ? NILE.wood : NILE.woodDark);
  for (let x = -34; x <= 33; x++) for (const y of [38, 39]) sail.m.set(x, y, 20 + Math.round(Math.sin(((x + 34.5) / 68) * Math.PI) * 5), NILE.woodDark);
  const sc = sailC(o.alpha ? 0x1e2a6a : 0xa8281e, 9);
  for (let y = 40; y <= 89; y++)
    for (let x = -34; x <= 33; x++) {
      const belly = Math.round(Math.sin(((x + 34.5) / 68) * Math.PI) * (0.6 + 0.4 * Math.sin(((y - 39) / 51) * Math.PI)) * 6);
      sail.m.set(x, y, 20 + belly, res(sc, x, y, 0), VF.SOFTAO);
    }
  // a winged sun disc stitched at the centre of the sail
  for (let x = -14; x <= 13; x++)
    for (let y = 58; y <= 72; y++) {
      const d = Math.hypot(x + 0.5, (y - 65) * 1.1);
      const wing = Math.abs(x + 0.5) > 5 && Math.abs(y - 66 + Math.abs(x + 0.5) * 0.18) < 2.4 - Math.abs(x + 0.5) * 0.1;
      if (d < 5.2 || wing) {
        const belly = Math.round(Math.sin(((x + 34.5) / 68) * Math.PI) * (0.6 + 0.4 * Math.sin(((y - 39) / 51) * Math.PI)) * 6);
        sail.m.set(x, y, 21 + belly, d < 5.2 ? (d < 4 ? 0xe8b43a : 0xb8862a) : ((x + y) & 1 ? 0xe8b43a : 0x2a4a9a), VF.METAL);
      }
    }
  // oars: six a side, from the oarlocks down into the river (rigged for the stroke)
  const oarZ = [-48, -34, -20, 32, 42, 52];
  oarZ.forEach((z, i) => {
    for (const sx of [1, -1]) {
      const ox = sx * (halfW(z) - 1);
      const op = r.part(`oar_${sx > 0 ? 'l' : 'r'}${i + 1}`, 'hull', [ox, 10, z]);
      for (let k = 0; k <= 50; k++) {
        const x = ox + sx * k * 0.86, y = 10 - k * 0.5;
        op.m.set(Math.floor(x), Math.floor(y), z, k > 38 ? NILE.woodDark : NILE.wood);
        if (k > 38) for (let w = -2; w <= 2; w++) op.m.set(Math.floor(x), Math.floor(y), z + w, (k & 1) ? NILE.wood : NILE.woodDark);
      }
    }
  });
  // twin steering oars off the stern quarters
  for (const sx of [1, -1]) {
    const rp = r.part(sx > 0 ? 'rudder_l' : 'rudder_r', 'stern', [sx * 12, 22, -74]);
    for (let k = 0; k <= 46; k++) rp.m.set(sx * 12 + Math.round(sx * k * 0.18) - (sx < 0 ? 1 : 0), 22 - Math.round(k * 0.62), -74 - Math.round(k * 0.55), NILE.wood);
    for (let k = 0; k <= 12; k++) for (let w = -1; w <= 1; w++) for (let h = 0; h < 6; h++) rp.m.set(sx * 20 + w, -6 - h + Math.round(k * 0.2), -98 - k, (h + k) % 4 === 0 ? 0x2e9a8a : NILE.woodDark);
  }
  // the stern rises into a recurved papyrus umbel; the bow carries a bronze lion-head ram
  tube(stern, [[0, gun(-HL) - 2, -HL + 2], [0, gun(-HL) + 10, -HL - 2], [0, gun(-HL) + 22, -HL + 2], [0, gun(-HL) + 26, -HL + 10]], (t) => 4.2 - t * 2.2, plank);
  ell(stern, [0, gun(-HL) + 27, -HL + 12], [5.0, 3.2, 4.0], (x, y, z) => (((x + y + z) & 1) ? 0xe8b43a : 0x6a9a3a), { fl: VF.METAL });
  const ramC = (x: number, y: number) => (y % 3 === 0 ? NILE.bronze[2] : NILE.bronze[0]);
  cap(bow, [0, 0, HL - 6], [0, -1, HL + 9], 5.5, 2.8, ramC, VF.METAL);
  ell(bow, [0, 1.5, HL + 7], [4.6, 4.2, 4.4], NILE.bronze[0], { fl: VF.METAL }); // the lion's head
  for (const sx of [1, -1]) {
    ell(bow, [sx * 3.4, 4.0, HL + 6], [1.8, 2.2, 2.6], NILE.bronze[1], { fl: VF.METAL }); // mane cheeks
    bow.m.set(sx > 0 ? 2 : -3, 3, HL + 11, 0x1a1008).set(sx > 0 ? 1 : -2, 3, HL + 11, 0x1a1008);
  }
  for (let x = -2; x <= 1; x++) bow.m.set(x, -1, HL + 11, 0x1a1008).set(x, -2, HL + 10, NILE.ivory);
  // the bow gun on a pivot block on the forecastle
  const blk = 8 + 8;
  for (let x = -4; x <= 3; x++) for (let z = 64; z <= 72; z++) for (let y = blk + 1; y <= blk + 5; y++) bow.m.set(x, y, z, res(plank, x, y, z));
  const g = r.part('gun', 'bow', [0, blk + 8, 68]);
  const { muzzle } = cannonBarrel(g, [0, blk + 8, 68], 30, { gold: !!o.alpha });
  r.sock('muzzle', 'gun', muzzle);
  shadeTops(r);
  const m = vs;
  return r.build({
    kind: 'barge', length: HL * 2 * m, beam: W * 2 * m, draft: 0.6, height: 8,
    deck: [[-1.6, 1.6, -4.4, 4.4, 9 * m], [-1.5, 1.5, 4.6, 6.7, 17 * m], [-1.5, 1.5, -6.6, -4.8, 18 * m]],
    stations: [[0, 17 * m, 5.3], [0.9, 9 * m, 2.6], [-0.9, 9 * m, 2.6], [1.1, 9 * m, -3.6], [-1.1, 9 * m, -3.6], [0, 18 * m, -5.7]],
    sections: [{ part: 'bow', z0: 30 * m, z1: HL * m, share: 0.3 }, { part: 'hull', z0: -30 * m, z1: 30 * m, share: 0.4 }, { part: 'stern', z0: -HL * m, z1: -30 * m, share: 0.3 }],
    guns: [{ part: 'gun', at: [0, (blk + 8) * m, 68 * m] }],
    oars: oarZ.length,
  });
}

void mulRGB;
