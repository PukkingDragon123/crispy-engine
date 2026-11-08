// THOTH'S HALL: the sculpted pieces of the little god's library. A long nave of
// sandstone slabs with lapis and gold inlay, papyrus-bundle columns painted in
// bands, towering cedar bookcases crammed with leather books, scroll cubbies and
// curios, a gallery walkway with a brass ladder rail, a starry lapis vault with gold
// stars and glyph constellations, an apse with a carved moon, Thoth's huge writing
// desk (and the stool he needs to reach it), turned-wood specimen stands with glass
// bell jars, dusty sheets over the jars nobody has filled yet, bronze lamps on
// chains, woven rugs, and the books that fly about (rigged, they flap).
//
// Units: shell 1/12 m, vault 1/8 m, columns 1/16 m, bookcases 1/24 m, props 1/32 m,
// small things 1/48 m. Fronts face +Z unless stated. Layout constants (metres) are
// exported in HALL so the scene can place things on the same plan.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec } from '../../../engine/voxel/Rig';
import { hash3, noise } from '../../../engine/math/rand';
import { TOON } from '../../models/style';
import { mixRGB, GLYPHS, rngOf } from '../../models/props/helpers';

export type V3 = [number, number, number];
export interface Built {
  model: VoxelModel;
  voxelSize: number;
  pivot: V3 | 'bottom' | 'center';
}

// ======================================================================= the plan (metres)
export const HALL = {
  /** nave half width */
  NX: 3,
  /** bay depth beyond the nave edge */
  BAY_D: 3.4,
  /** bay width (along z) */
  BAY_W: 4,
  /** bay centres (z), front to back */
  BAYS: [6, 1.2, -3.6],
  /** piers between bays: [z0, z1] */
  PIERS: [[8, 8.8], [3.2, 4], [-1.6, -0.8], [-6.4, -5.6]] as [number, number][],
  /** entrance wall (z) */
  FRONT: 8.8,
  /** the apse: back wall z, half width */
  APSE_Z: -11,
  APSE_X: 4.4,
  /** where the nave ends and the apse begins */
  APSE_START: -6.4,
  /** shelves and piers top out here; the ceilings spring here */
  SHELF_TOP: 6.4,
  CEIL: 7.2,
  /** gallery walkway height (floor of the walk) */
  GALLERY: 3.3,
  /** vault radius over the nave */
  VAULT_R: 3,
};

// ======================================================================= palette
const SAND = [0xa98353, 0xbb9462, 0xcaa36f, 0xd8b47e, 0xe6c590];
const MORTAR = 0x7c6040;
const LAPIS = [0x16246a, 0x1e3282, 0x26409a, 0x3254b4, 0x4a6ed0];
const NIGHT = [0x18286e, 0x1e307e, 0x24398c];
const GOLD = TOON.gold;
const OCHRE = [0x8a3a1e, 0xa84a26, 0xc0603a];
const PGREEN = [0x2a5a3e, 0x3a7650, 0x52966a];
const CEDAR = [0x3a2014, 0x4e2c1a, 0x643a22, 0x7a4a2c, 0x92603a];
const EBONY = [0x1e1410, 0x2a1c14, 0x3a281c];
const LEATHERS = [0x6e1e16, 0x8a2a1c, 0x24386e, 0x2e4e8a, 0x2c5232, 0x3e6a3a, 0x8a5a22, 0xa8742e, 0x6a4424, 0x8a5a36, 0x2a2420, 0x3a2e28, 0x24504e, 0x4a2a52, 0xcab88e, 0x5a1a2e];
const BRONZE = [0x5a3a18, 0x7a5224, 0x9a6a30, 0xc08a44, 0xe0b060];
const PAPYRUS = [0xb89a62, 0xccb078, 0xe0c68e, 0xeed8a8];

const pick = <T>(a: readonly T[], t: number) => a[Math.max(0, Math.min(a.length - 1, Math.floor(t * a.length)))];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** a lathe: a turned body around the Y axis (radius profile over t 0..1), optional hollow shell */
function lathe(m: VoxelModel, cx: number, cz: number, y0: number, y1: number, prof: (t: number) => number, col: (x: number, y: number, z: number, outer: boolean, ang: number, t: number) => number | null, flags = 0, hollow = false) {
  for (let y = y0; y <= y1; y++) {
    const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
    const r = prof(t);
    if (r <= 0) continue;
    const R = Math.ceil(r) + 1;
    for (let x = -R; x <= R; x++)
      for (let z = -R; z <= R; z++) {
        const d = Math.hypot(x, z);
        if (d > r + 0.35) continue;
        const outer = d > r - 1.1;
        if (hollow && !outer && y !== y0) continue;
        const c = col(x, y, z, outer, Math.atan2(z, x), t);
        if (c === null) continue;
        m.set(cx + x, y, cz + z, c, flags);
      }
  }
}

/** a HUD glyph bitmap (7x9, '.' empty) as voxel rows */
export const GLYPH_BITMAPS: string[][] = [
  ['..###..', '.#..##.', '....#.#', '...#...', '..###..', '.#####.', '..###..', '..#.#..', '..#.#..'], // ibis
  ['.......', '.#####.', '#.....#', '#..##.#', '.#####.', '...#...', '..#..#.', '.#....#', '.......'], // eye
  ['..###..', '.#...#.', '.#...#.', '..#.#..', '#######', '...#...', '...#...', '...#...', '...#...'], // ankh
  ['....#..', '...##..', '..###..', '..###..', '..###..', '.####..', '.###...', '..##...', '..#....'], // feather
  ['..#.#..', '.#####.', '#.###.#', '.#####.', '#######', '.#####.', '#.###.#', '..###..', '.......'], // scarab
  ['.......', '..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..', '.......'], // sun
  ['#######', '.......', '#######', '.......', '#######', '..###..', '..###..', '..###..', '.#####.'], // djed
  ['...#...', '..###..', '...#...', '..###..', '...#...', '..###..', '...#...', '...#...', '..###..'], // reed
];

// ======================================================================= the floor (1/12)
/** sandstone slabs, a lapis-and-gold border down each side of the nave, a moon medallion
 *  inlaid at the crossing, worn paths, a step up into the apse */
export function hallFloor(): Built {
  const vs = 1 / 12;
  const m = new VoxelModel('hall_floor');
  const H = HALL;
  const X1 = Math.round((H.NX + H.BAY_D) / vs) + 2, Z0 = Math.round(H.APSE_Z / vs) - 1, Z1 = Math.round(H.FRONT / vs) + 1;
  const nx = H.NX / vs, apseZ = H.APSE_START / vs;
  const medZ = Math.round(1.2 / vs);
  for (let x = -X1; x <= X1; x++)
    for (let z = Z0; z <= Z1; z++) {
      const inApse = z < apseZ;
      if (inApse && Math.abs(x) > H.APSE_X / vs + 1) continue;
      // slabs: 0.5 m in the nave, running bond; big 1 m slabs in the apse
      const sw = inApse ? 12 : 6;
      const row = Math.floor(z / sw);
      const sx = x + (row % 2 ? sw / 2 : 0);
      const ju = ((sx % sw) + sw) % sw, jv = ((z % sw) + sw) % sw;
      const joint = ju === 0 || jv === 0;
      const slab = hash3(Math.floor(sx / sw), row, 3);
      // worn path down the middle and into every bay (one tone per slab: the slab is the brush stroke)
      const scx = Math.floor(sx / sw) * sw + sw / 2 - (row % 2 ? sw / 2 : 0);
      const wear = Math.max(0, 1 - Math.abs(scx) / (nx * 0.55)) * 0.35 + (Math.abs(scx) > nx ? 0.1 : 0);
      let c = joint ? MORTAR : pick(SAND, clamp01(0.2 + slab * 0.5 + wear));
      // a hairline crack across the odd slab
      if (!joint && slab > 0.86 && Math.abs(ju - jv * 0.7 - 1) < 0.5) c = mixRGB(c, MORTAR, 0.5);
      // the apse step: one course higher
      const y = inApse ? 0 : -1;
      if (inApse && z === Math.round(apseZ) - 1) c = mixRGB(c, 0xfff0c8, 0.2);
      m.set(x, y, z, c);
      m.set(x, y - 1, z, MORTAR);
      if (inApse) m.set(x, -1, z, MORTAR);
    }
  // the borders: a gold fillet, a lapis band with gold stars, a gold fillet
  for (const s of [-1, 1])
    for (let z = Math.round(apseZ); z <= Z1 - 2; z++) {
      const bx = s * Math.round(nx - 4);
      for (let k = -2; k <= 2; k++) {
        const x = bx + k;
        let c: number = Math.abs(k) === 2 ? GOLD.base : LAPIS[2];
        let f = Math.abs(k) === 2 ? VF.METAL : 0;
        if (Math.abs(k) < 2 && ((z % 6) + 6) % 6 === 0 && k === 0) {
          c = GOLD.hi;
          f = VF.METAL;
        }
        m.set(x, -1, z, c, f);
      }
    }
  // the medallion at the crossing: a ring of lapis with gold stars, a silver crescent moon, an ibis in gold
  const R = 18;
  for (let x = -R - 2; x <= R + 2; x++)
    for (let z = -R - 2; z <= R + 2; z++) {
      const d = Math.hypot(x, z);
      if (d > R + 1.5) continue;
      let c: number | null = null, f = 0;
      if (d > R + 0.5) c = GOLD.base, (f = VF.METAL);
      else if (d > R - 3) {
        c = LAPIS[1];
        const a = Math.atan2(z, x);
        if (Math.abs(((a / (Math.PI * 2)) * 24 + 24) % 1 - 0.5) < 0.12 && Math.abs(d - (R - 1.2)) < 0.8) (c = GOLD.hi), (f = VF.METAL);
      } else if (d > R - 4) (c = GOLD.shade), (f = VF.METAL);
      else {
        c = mixRGB(SAND[3], 0xf4e2bc, 0.4);
        // the crescent
        if (d < 10 && Math.hypot(x - 3.5, z + 1.5) > 8.2) (c = TOON.silver.hi), (f = VF.METAL);
        else if (d < 10.8 && d > 10) c = TOON.silver.shade;
      }
      if (c !== null) m.set(x, -1, medZ + z, c, f);
    }
  // the ibis in the crescent's hollow
  const ib = GLYPH_BITMAPS[0];
  ib.forEach((r, i) => [...r].forEach((ch, j) => ch === '#' && m.set(3 + j, -1, medZ - 5 + i, GOLD.base, VF.METAL)));
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] };
}

// ======================================================================= the vault and ceilings (1/8)
/** the nave's barrel vault and the bays' coffered ceilings: deep lapis, gold stars, gold ribs
 *  over every pier, glyph constellations; the frieze of glyphs where the shelves stop */
export function hallVault(): Built {
  const vs = 1 / 8;
  const m = new VoxelModel('hall_vault');
  const H = HALL;
  const R = H.VAULT_R / vs, y0 = H.CEIL / vs, nx = H.NX / vs;
  const Z0 = Math.round(H.APSE_Z / vs), Z1 = Math.round(H.FRONT / vs);
  const apseZ = Math.round(H.APSE_START / vs);
  const pierZ = H.PIERS.map(([a, b]) => [Math.round(a / vs), Math.round(b / vs)]);
  const onRib = (z: number) => pierZ.some(([a, b]) => z >= a && z <= b);
  const star = (x: number, y: number, z: number) => {
    // a small scatter of stars: on a jittered grid
    const gx = Math.floor((x + 400) / 5), gz = Math.floor((z + 400) / 5), gy = Math.floor((y + 400) / 5);
    const h = hash3(gx, gy, gz);
    const ox = Math.floor(hash3(gx, gy, gz + 7) * 5), oz = Math.floor(hash3(gx + 3, gy, gz) * 5);
    return h > 0.35 && ((x + 400) % 5) === ox && ((z + 400) % 5) === oz;
  };
  // the barrel vault (shell 2 thick), running the nave into the apse
  for (let z = Z0; z <= Z1; z++)
    for (let a = 0; a <= 180; a += 0.6) {
      const t = (a * Math.PI) / 180;
      for (let k = 0; k < 2; k++) {
        const rr = R + k;
        const x = Math.round(Math.cos(t) * rr), y = Math.round(y0 + Math.sin(t) * rr);
        if (z < apseZ && Math.abs(x) > R) continue;
        let c = pick(NIGHT, hash3(Math.floor(z / 7), Math.floor(a / 14), 2) * 0.7 + 0.15), f = 0;
        if (k === 0 && onRib(z)) (c = (z % 2 ? GOLD.shade : GOLD.base)), (f = VF.METAL);
        else if (k === 0 && star(x, y, z)) (c = GOLD.hi), (f = VF.EMISSIVE);
        m.set(x, y, z, c, f);
      }
    }
  // the tympana closing both ends of the vault: lapis with stars; a gold winged sun over the apse
  for (const [zz, sun] of [[Z0 - 1, true], [Z1 + 1, false]] as const)
    for (let x = -R - 1; x <= R + 1; x++)
      for (let y = y0; y <= y0 + R + 1; y++) {
        const d = Math.hypot(x, y - y0);
        if (d > R + 1.5) continue;
        let c = d > R + 0.5 ? GOLD.shade : pick(NIGHT, hash3(Math.floor(x / 6), Math.floor(y / 6), 4) * 0.7 + 0.15);
        let f = d > R + 0.5 ? VF.METAL : 0;
        if (d <= R && star(x, y, zz * 3)) (c = GOLD.hi), (f = VF.EMISSIVE);
        if (sun) {
          const sy = y - (y0 + 9), dd = Math.hypot(x, sy);
          if (dd < 3.2) (c = dd < 2.2 ? 0xffd25a : GOLD.base), (f = VF.EMISSIVE);
          // the wings: feathered bands sweeping out and down from the disc
          const wx = Math.abs(x) - 3;
          if (wx > 0 && wx < 15 && Math.abs(sy + wx * 0.12) < 2.2 - wx * 0.08) {
            const band = Math.floor((sy + wx * 0.12 + 2.2) / 1.1);
            c = band % 2 ? GOLD.base : LAPIS[3];
            f = band % 2 ? VF.EMISSIVE : 0;
            if (wx % 3 === 0) (c = GOLD.shade), (f = VF.METAL);
          }
        }
        m.set(x, y, zz, c, f);
      }
  // the flat coffered ceilings over the bays and the apse wings
  const X1 = Math.round((H.NX + H.BAY_D) / vs) + 1;
  for (let x = -X1; x <= X1; x++)
    for (let z = Z0; z <= Z1; z++) {
      if (Math.abs(x) <= R) continue;
      if (z < apseZ && Math.abs(x) > H.APSE_X / vs + 1) continue;
      const cu = ((x % 8) + 8) % 8, cv = ((z % 8) + 8) % 8;
      const rim = cu === 0 || cv === 0;
      const deep = !rim && cu > 1 && cu < 7 && cv > 1 && cv < 7;
      let c = rim ? (onRib(z) ? GOLD.shade : LAPIS[3]) : deep ? NIGHT[1] : LAPIS[1];
      let f = rim && onRib(z) ? VF.METAL : 0;
      if (deep && cu === 4 && cv === 4) (c = GOLD.hi), (f = VF.EMISSIVE);
      if (deep && (cu === 3 || cu === 5) && cv === 4) (c = GOLD.base), (f = VF.EMISSIVE);
      if (deep && (cv === 3 || cv === 5) && cu === 4) (c = GOLD.base), (f = VF.EMISSIVE);
      m.set(x, deep ? y0 + 1 : y0, z, c, f);
      if (deep) m.set(x, y0 + 2, z, NIGHT[0]);
    }
  // the frieze (shelf top to ceiling) facing the nave over each bay opening: lapis, gold rules, glyph rows
  const fy0 = Math.round(H.SHELF_TOP / vs);
  for (const s of [-1, 1])
    for (let z = apseZ; z <= Z1; z++)
      for (let y = fy0; y < y0; y++) {
        const x = s * (R + 1);
        const rule = y === fy0 || y === y0 - 1;
        m.set(x, y, z, rule ? GOLD.base : LAPIS[1], rule ? VF.METAL : 0);
        m.set(x + s, y, z, LAPIS[0]);
      }
  // glyph runs on the frieze (gold, slightly proud)
  for (const s of [-1, 1]) {
    let gi = 0;
    for (let z = apseZ + 2; z < Z1 - 8; z += 9) {
      const g = GLYPH_BITMAPS[(gi++ + (s > 0 ? 3 : 0)) % GLYPH_BITMAPS.length];
      for (let i = 0; i < 7; i++)
        for (let j = 0; j < 7; j++) {
          // the 9-row glyphs squashed to the frieze's 5 rows
          const row = g[Math.min(8, Math.round((i * 8) / 6))];
          if (row?.[j] === '#') m.set(s * R, fy0 + 5 - Math.round((i * 4) / 6), z + (s > 0 ? j : 6 - j), GOLD.hi, VF.METAL);
        }
    }
  }
  // glyph constellations on the vault: big gold line-figures among the stars
  const figs: [number, number, number][] = [[0, 0.62, 4.6], [2, 0.32, -0.4], [4, 0.75, -3], [1, 0.4, 2.2], [5, 0.55, -8.6], [3, 0.7, 7.2]];
  for (const [gi, ang, zm] of figs) {
    const g = GLYPH_BITMAPS[gi];
    const t0 = ang * Math.PI;
    const zc = Math.round(zm / vs);
    for (let i = 0; i < 9; i++)
      for (let j = 0; j < 7; j++) {
        if (g[i][j] !== '#') continue;
        for (let u = 0; u < 2; u++)
          for (let v = 0; v < 2; v++) {
            const tt = t0 + ((j * 2 + u - 7) / R) * 0.9;
            const x = Math.round(Math.cos(tt) * (R - 0.4)), y = Math.round(y0 + Math.sin(tt) * (R - 0.4));
            const z = zc + (8 - i) * 2 + v - 9;
            if (z < Z0 || z > Z1) continue;
            m.set(x, y, z, GOLD.hi, VF.EMISSIVE);
          }
      }
  }
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] };
}

// ======================================================================= the walls (1/12)
/** the outer walls (mostly hidden behind the shelves), the entrance wall with its great door,
 *  the apse wall with the moon niche, the gallery walkway with its balustrade and brass rail */
export function hallWalls(): Built[] {
  const vs = 1 / 12;
  // separate pieces, so each mesh's working volume stays small
  const pieces = new Map<string, VoxelModel>();
  let m = new VoxelModel('');
  const use = (k: string) => {
    let v = pieces.get(k);
    if (!v) pieces.set(k, (v = new VoxelModel('hall_walls_' + k)));
    m = v;
  };
  const H = HALL;
  const X1 = Math.round((H.NX + H.BAY_D) / vs) + 1;
  const top = Math.round(H.CEIL / vs) + 1;
  const Z0 = Math.round(H.APSE_Z / vs), Z1 = Math.round(H.FRONT / vs);
  const apseZ = Math.round(H.APSE_START / vs), ax = Math.round(H.APSE_X / vs);
  const plaster = (x: number, y: number, z: number) => pick([0x4a3624, 0x5a4230, 0x6a4e38], hash3(x >> 2, y >> 2, z >> 2) * 0.8 + (y < 12 ? 0 : 0.15));
  // side walls behind the bays
  for (const s of [-1, 1]) {
    use('side' + s);
    for (let z = apseZ; z <= Z1; z++) for (let y = 0; y <= top; y++) m.set(s * X1, y, z, plaster(X1, y, z));
  }
  // the entrance wall with the great door (dark beyond, a gilded frame, a lintel with a winged sun)
  const doorW = Math.round(1.3 / vs), doorH = Math.round(4.2 / vs);
  use('front');
  for (let x = -X1; x <= X1; x++)
    for (let y = 0; y <= top; y++) {
      const inDoor = Math.abs(x) < doorW && y < doorH;
      if (inDoor) {
        m.set(x, y, Z1 + 3, 0x05040a);
        continue;
      }
      const frame = Math.abs(x) < doorW + 3 && y < doorH + 3;
      m.set(x, y, Z1, frame ? (Math.abs(x) >= doorW + 2 || y >= doorH + 2 ? GOLD.shade : GOLD.base) : plaster(x, y, Z1), frame ? VF.METAL : 0);
      if (frame) m.set(x, y, Z1 - 1, Math.abs(x) === doorW || y === doorH ? GOLD.hi : GOLD.base, VF.METAL);
    }
  for (let y = 0; y < doorH; y++) for (const s of [-1, 1]) for (let k = 1; k < 4; k++) m.set(s * doorW, y, Z1 + k, 0x2a1e14);
  // the apse: the back wall and its chamfered corners; the moon niche is a separate model
  use('apse');
  for (let x = -ax; x <= ax; x++) for (let y = -1; y <= top; y++) m.set(x, y, Z0 - 1, plaster(x, y, Z0));
  for (const s of [-1, 1]) {
    use('apse' + s);
    for (let z = Z0; z <= apseZ; z++) for (let y = -1; y <= top; y++) m.set(s * (ax + 1), y, z, plaster(ax, y, z));
  }
  // the gallery: a walkway along both sides of the nave at GALLERY height, over the bay mouths
  const gy = Math.round(H.GALLERY / vs), nx = Math.round(H.NX / vs);
  for (const s of [-1, 1]) {
    use('gallery' + s);
    for (let z = apseZ; z <= Z1 - 1; z++) {
      // the deck (cedar planks), a moulded fascia
      for (let k = 0; k < 8; k++) {
        const x = s * (nx + k);
        m.set(x, gy, z, pick(CEDAR, 0.45 + (((z + k * 3) % 9 === 0) ? -0.2 : hash3(z >> 3, k, 5) * 0.2)));
        m.set(x, gy - 1, z, CEDAR[1]);
      }
      m.set(s * nx, gy - 2, z, CEDAR[2]);
      m.set(s * nx, gy - 3, z, ((z % 4) + 4) % 4 === 0 ? GOLD.shade : CEDAR[0], ((z % 4) + 4) % 4 === 0 ? VF.METAL : 0);
      m.set(s * (nx - 1), gy, z, CEDAR[3]);
      // the balustrade: turned balusters every 3, a heavy handrail, a brass ladder rail below it
      const bx = s * nx;
      if (((z % 3) + 3) % 3 === 0)
        for (let y = gy + 1; y < gy + 11; y++) {
          const t = (y - gy) / 11;
          const r = t < 0.15 || t > 0.85 ? 1 : Math.abs(t - 0.45) < 0.1 ? 1 : 0;
          m.set(bx, y, z, CEDAR[3]);
          if (r) m.set(bx - s, y, z, CEDAR[2]);
        }
      for (const dx of [0, -s]) {
        m.set(bx + dx, gy + 11, z, CEDAR[4]);
        m.set(bx + dx, gy + 12, z, CEDAR[3]);
      }
      m.set(bx - s * 2, gy + 6, z, BRONZE[3], VF.METAL);
    }
  }
  return [...pieces.values()].map((model) => ({ model, voxelSize: vs, pivot: [0, 0, 0] as V3 }));
}

// ======================================================================= papyrus columns (1/16)
/** a papyrus-bundle column the height of the shelves: a disc base, a shaft of eight stalks
 *  that swells and tapers, tied with five painted bands, a closed bud capital with green and
 *  gold sepals, an abacus. Painted lapis, ochre and gold. */
export function papyrusColumn(seed = 0): Built {
  const vs = 1 / 16;
  const m = new VoxelModel('papyrus_col_' + seed);
  const Hh = Math.round(HALL.SHELF_TOP / vs);
  const capY = Math.round(Hh * 0.8), bandY = capY - 10;
  lathe(m, 0, 0, 0, 4, (t) => 9 - t * 1.4 + (t > 0.7 ? -1 : 0), (_x, y, _z, outer) => (outer ? (y === 4 ? SAND[4] : SAND[2]) : SAND[1]));
  // the shaft: a lobed section (8 stalks), swelling a little above the foot, tapering to the bands
  for (let y = 5; y < bandY; y++) {
    const t = (y - 5) / (bandY - 5);
    const R = 5.6 + Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * 0.9 - t * 1.1;
    const RR = Math.ceil(R + 1.5);
    for (let x = -RR; x <= RR; x++)
      for (let z = -RR; z <= RR; z++) {
        const a = Math.atan2(z, x);
        const lobe = Math.abs(Math.cos(a * 4));
        const r = R * (0.9 + 0.16 * Math.pow(lobe, 0.6));
        const d = Math.hypot(x, z);
        if (d > r + 0.3) continue;
        // painted: stalk ribs alternate pale sandstone and a thin ochre line in the valleys
        let c = lobe > 0.35 ? (lobe > 0.85 ? SAND[4] : SAND[3]) : OCHRE[1];
        // a chevron frieze of lapis and gold low on the shaft
        if (y > 10 && y < 18) {
          const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 24);
          const v = (y - 10 + k * 2) % 8;
          c = v < 3 ? LAPIS[3] : v < 4 ? GOLD.base : SAND[3];
        }
        m.set(x, y, z, c, c === GOLD.base ? VF.METAL : 0);
      }
  }
  // five bands where the stalks are tied
  for (let b = 0; b < 5; b++)
    lathe(m, 0, 0, bandY + b * 2, bandY + b * 2 + 1, () => 5.9, () => (b % 2 ? GOLD.base : b === 2 ? OCHRE[1] : LAPIS[3]), b % 2 ? VF.METAL : 0);
  // the bud capital: it swells and closes; sepals painted up from the bands
  for (let y = capY; y < Hh - 3; y++) {
    const t = (y - capY) / (Hh - 3 - capY);
    const R = 5.6 + Math.sin(t * Math.PI * 0.9) * 3.4 - t * 2.4;
    const RR = Math.ceil(R + 1);
    for (let x = -RR; x <= RR; x++)
      for (let z = -RR; z <= RR; z++) {
        const d = Math.hypot(x, z);
        if (d > R + 0.3) continue;
        const a = Math.atan2(z, x);
        const k = ((a + Math.PI) / (Math.PI * 2)) * 8;
        const fk = k - Math.floor(k);
        const sepal = Math.abs(fk - 0.5) * 2 < 1 - t * 1.2;
        let c = sepal ? (Math.abs(fk - 0.5) < 0.1 ? GOLD.hi : PGREEN[1 + (Math.floor(k) % 2)]) : (t > 0.75 ? GOLD.base : SAND[3]);
        if (sepal && Math.abs(Math.abs(fk - 0.5) * 2 - (1 - t * 1.2)) < 0.12) c = PGREEN[0];
        m.set(x, y, z, c, c === GOLD.hi || c === GOLD.base ? VF.METAL : 0);
      }
  }
  // the abacus: a square block, gilt edges
  for (let y = Hh - 3; y <= Hh; y++)
    for (let x = -6; x <= 6; x++)
      for (let z = -6; z <= 6; z++) {
        const edge = Math.abs(x) === 6 || Math.abs(z) === 6;
        m.set(x, y, z, edge && (y === Hh - 3 || y === Hh) ? GOLD.shade : SAND[2], edge && (y === Hh - 3 || y === Hh) ? VF.METAL : 0);
      }
  void seed;
  return { model: m, voxelSize: vs, pivot: 'bottom' };
}

// ======================================================================= bookcases (1/24)
/** a cedar bookcase `wm` wide and `hm` tall (metres): fluted uprights, a plinth, a cornice with
 *  dentils and a gilt frieze, shelves crammed with leather books (gilt bands, labels, leaners,
 *  flat stacks, gaps), a shelf of papyrus scroll cubbies, the odd curio. Front faces +Z. */
export function bookcase(wm: number, hm: number, seed = 0, o: { scrolls?: boolean; plinth?: boolean } = {}): Built {
  const vs = 1 / 24;
  const m = new VoxelModel('bookcase_' + seed);
  const W = Math.round(wm / vs), Hh = Math.round(hm / vs), D = 11;
  const r = rngOf(seed, 41);
  const x0 = -Math.floor(W / 2), x1 = x0 + W - 1;
  const plinth = o.plinth === false ? 0 : 5, cornice = 6;
  const wood = (x: number, y: number, z: number, lift = 0) => pick(CEDAR, clamp01(0.42 + lift + (((x * 3 + y * 7 + z) % 11 === 0) ? -0.15 : 0) + noise.n2(y * 0.12 + seed, x * 0.02) * 0.12));
  // back panel
  for (let x = x0; x <= x1; x++) for (let y = 0; y < Hh; y++) m.set(x, y, 0, EBONY[1]);
  // uprights: 3 wide, fluted on the front
  for (const ux of [x0, x1])
    for (let y = 0; y < Hh; y++)
      for (let dx = 0; dx < 3; dx++)
        for (let z = 0; z <= D; z++) {
          const x = ux === x0 ? x0 + dx : x1 - dx;
          let c = wood(x, y, z, 0.1);
          if (z === D && dx === 1 && y > plinth + 2 && y < Hh - cornice - 2) c = CEDAR[1];
          m.set(x, y, z, c);
        }
  // plinth with a moulded lip
  for (let x = x0; x <= x1; x++)
    for (let y = 0; y < plinth; y++)
      for (let z = 0; z <= D + (y === plinth - 1 ? 1 : 0); z++) m.set(x, y, z, y === plinth - 1 ? CEDAR[3] : y === 0 ? CEDAR[0] : wood(x, y, z, -0.1));
  // cornice: dentils, a gilt glyph frieze, a cap that overhangs
  for (let x = x0 - 1; x <= x1 + 1; x++)
    for (let y = Hh - cornice; y < Hh; y++) {
      const k = y - (Hh - cornice);
      const over = k >= 4 ? 2 : k >= 2 ? 1 : 0;
      for (let z = 0; z <= D + over; z++) {
        let c = wood(x, y, z, 0.15);
        if (z === D + over) {
          if (k === 1) c = ((x % 3) + 3) % 3 === 0 ? CEDAR[0] : CEDAR[3];
          if (k === 2 || k === 3) c = LAPIS[2];
          if (k === 5) c = CEDAR[4];
        }
        m.set(x, y, z, c);
      }
    }
  // the frieze: a run of tiny gold glyphs on the lapis band
  for (let x = x0 + 2; x < x1 - 2; x += 4) {
    const g = GLYPHS[Math.floor(hash3(x, seed, 9) * GLYPHS.length)];
    for (let j = 0; j < Math.min(3, g[0].length); j++) {
      if (g[1][j] === '#') m.set(x + j, Hh - cornice + 3, D + 1, GOLD.hi, VF.METAL);
      if (g[3][j] === '#') m.set(x + j, Hh - cornice + 2, D + 1, GOLD.base, VF.METAL);
    }
  }
  // shelves
  const inner0 = plinth, inner1 = Hh - cornice;
  const rows: [number, number][] = [];
  const n = Math.max(2, Math.round((inner1 - inner0) / 10));
  const step = (inner1 - inner0) / n;
  for (let i = 0; i < n; i++) rows.push([Math.round(inner0 + i * step), Math.round(inner0 + (i + 1) * step)]);
  for (const [y0] of rows.slice(1))
    for (let x = x0 + 3; x <= x1 - 3; x++)
      for (let z = 1; z <= D; z++) m.set(x, y0, z, z === D ? CEDAR[4] : CEDAR[2]);
  const scrollRow = o.scrolls ? Math.min(rows.length - 1, 1) : -1;
  rows.forEach(([ya, yb], ri) => {
    const yb2 = yb - 1, h = yb2 - ya;
    if (ri === scrollRow) {
      scrollCubbies(m, x0 + 3, x1 - 3, ya + 1, yb2, D, seed + ri);
      return;
    }
    let x = x0 + 3;
    const xe = x1 - 3;
    let runDep = D - 1;
    while (x <= xe) {
      const roll = r.next();
      if (roll < 0.05 && xe - x > 6) {
        x += r.int(2, 4); // a gap
        continue;
      }
      if (roll < 0.11 && xe - x > 8) {
        // a flat stack of three or four
        const sw = r.int(5, 7), cnt = r.int(2, 4);
        for (let k = 0; k < cnt; k++) {
          const col = LEATHERS[r.int(0, LEATHERS.length - 1)];
          const off = r.int(0, 1);
          for (let xx = x + off; xx < x + sw - (1 - off); xx++) for (let z = 2; z < D - r.int(0, 1); z++) m.set(xx, ya + 1 + k, z, z === D - 1 ? mixRGB(col, 0xfff0c8, 0.12) : col);
          if (k === cnt - 1 && r.chance(0.4)) m.set(x + 2, ya + 2 + k, D - 3, 0xe8dcc0); // a slip of paper
        }
        x += sw + 1;
        continue;
      }
      if (roll < 0.15 && xe - x > 5) {
        curio(m, x, ya + 1, D, Math.min(h, 7), r.int(0, 3));
        x += 5;
        continue;
      }
      // a book standing: 1-3 thick, 60-95% of the shelf, its own leather, gilt bands, a label
      const bw = r.chance(0.6) ? 2 : r.chance(0.5) ? 1 : 3;
      const bh = Math.max(3, Math.round(h * (0.62 + r.next() * 0.33)));
      const col = LEATHERS[r.int(0, LEATHERS.length - 1)];
      if (r.chance(0.12)) runDep = D - 1 - r.int(0, 1);
      const dep = runDep;
      const lean = roll > 0.96 && x > x0 + 6 ? 1 : 0;
      for (let xx = 0; xx < bw; xx++)
        for (let y = 0; y < bh; y++) {
          const sx = x + xx + (lean && y > bh / 2 ? 1 : 0);
          if (sx > xe) continue;
          for (let z = 2; z <= dep; z++) {
            let c = col;
            if (z === dep) {
              if (y === 1 || (y === bh - 2 && bh > 5)) c = GOLD.base;
              else if (bh > 8 && bw > 1 && y >= Math.floor(bh * 0.55) && y <= Math.floor(bh * 0.55) + 1) c = mixRGB(col, 0xf0e0b0, 0.55);
            }
            m.set(sx, ya + 1 + y, z, c, c === GOLD.base ? VF.METAL : 0);
          }
        }
      x += bw + lean;
    }
  });
  return { model: m, voxelSize: vs, pivot: 'bottom' };
}

/** a shelf of pigeonholes, each holding papyrus rolls (ends showing, a tag tied on some) */
function scrollCubbies(m: VoxelModel, x0: number, x1: number, y0: number, y1: number, D: number, seed: number) {
  const cw = 5;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const wall = ((x - x0) % cw) === 0 || y === y0 + Math.floor((y1 - y0) / 2);
      if (wall) for (let z = 1; z <= D - 1; z++) m.set(x, y, z, CEDAR[2]);
    }
  const mid = y0 + Math.floor((y1 - y0) / 2);
  for (let cx = x0; cx + cw <= x1 + 1; cx += cw)
    for (const [ya, yb] of [[y0, mid - 1], [mid + 1, y1]]) {
      // rolls stacked like logs: 2 across, 1-2 high
      for (let k = 0; k < 3; k++) {
        const rx = cx + 1 + (k % 2) * 2 + (k === 2 ? 1 : 0), ry = ya + (k === 2 ? 2 : 0);
        if (ry + 1 > yb) continue;
        if (hash3(cx, ya, k + seed) < 0.18) continue;
        for (let z = 2; z <= D - 1; z++) {
          const end = z === D - 1;
          m.set(rx, ry, z, end ? PAPYRUS[3] : PAPYRUS[1]);
          m.set(rx + 1, ry, z, end ? PAPYRUS[2] : PAPYRUS[1]);
          m.set(rx, ry + 1, z, end ? PAPYRUS[2] : PAPYRUS[2]);
          m.set(rx + 1, ry + 1, z, end ? 0x8a6a3a : PAPYRUS[0]);
        }
        if (hash3(cx, ya, k + 4) > 0.7) m.set(rx, ry, D, 0xa82a1a); // a red tag
      }
    }
}

/** a little curio on a shelf: a canopic jar, a skull, an hourglass, a scarab on a stand */
function curio(m: VoxelModel, x: number, y: number, D: number, h: number, kind: number) {
  const cz = D - 4;
  if (kind === 0) {
    // canopic jar with a jackal lid
    lathe(m, x + 2, cz, y, y + Math.min(h - 2, 4), (t) => 1.2 + Math.sin(t * Math.PI) * 0.8, () => 0xd8c8a8);
    m.set(x + 2, y + Math.min(h - 2, 4) + 1, cz, 0x2a2420).set(x + 1, y + Math.min(h - 2, 4) + 2, cz, 0x2a2420).set(x + 3, y + Math.min(h - 2, 4) + 2, cz, 0x2a2420);
    m.set(x + 2, y + 2, cz + 2, LAPIS[3]);
  } else if (kind === 1) {
    // a small skull
    m.box(x + 1, y, cz - 1, x + 3, y + 2, cz + 1, 0xe8dcc0);
    m.set(x + 1, y + 1, cz + 2, 0x3a2a1a).set(x + 3, y + 1, cz + 2, 0x3a2a1a).set(x + 2, y, cz + 2, 0xd8c8a8);
  } else if (kind === 2) {
    // an hourglass: brass ends, sand
    m.box(x + 1, y, cz - 1, x + 3, y, cz + 1, BRONZE[3], VF.METAL);
    m.box(x + 1, y + 4, cz - 1, x + 3, y + 4, cz + 1, BRONZE[3], VF.METAL);
    m.set(x + 2, y + 1, cz, 0xe8c890).set(x + 2, y + 2, cz, 0xd8e8e8).set(x + 2, y + 3, cz, 0xe8c890);
    m.set(x + 1, y + 1, cz, 0xe8c890).set(x + 3, y + 1, cz, 0xe8c890);
  } else {
    // a jade scarab on a little stand
    m.box(x + 1, y, cz - 1, x + 3, y, cz + 1, EBONY[2]);
    m.box(x + 1, y + 1, cz - 1, x + 3, y + 1, cz + 1, PGREEN[2]);
    m.set(x + 2, y + 2, cz, PGREEN[2]).set(x + 2, y + 1, cz + 2, PGREEN[1]);
  }
}

// ======================================================================= the specimen stand (1/32)
/** a turned-cedar étagère with two tiers of five jar places, lotus-carved end posts and brass
 *  rails; returns the jar seats (metres, relative to the pivot at the floor, front faces +Z) */
export function jarStand(seed = 0): Built & { slots: V3[] } {
  const vs = 1 / 32;
  const m = new VoxelModel('jar_stand_' + seed);
  const W = 120, D0 = 14;
  const tiers = [[26, 6], [52, -10]] as const; // [height, depth offset] of each tier's top (voxels)
  const slots: V3[] = [];
  for (const [ty, dz] of tiers) {
    // the tier: a thick moulded board on two stretchers
    for (let x = -W / 2; x <= W / 2; x++)
      for (let z = dz - D0 / 2; z <= dz + D0 / 2; z++) {
        const edge = z === dz + D0 / 2 || z === dz - D0 / 2;
        m.set(x, ty, z, edge ? CEDAR[4] : CEDAR[3]);
        m.set(x, ty - 1, z, CEDAR[2]);
        if (edge) m.set(x, ty - 2, z, ((x % 6) + 6) % 6 === 0 ? GOLD.shade : CEDAR[1], ((x % 6) + 6) % 6 === 0 ? VF.METAL : 0);
      }
    for (let k = 0; k < 5; k++) slots.push([((k - 2) * 23) * vs, (ty + 1) * vs, dz * vs]);
    // a brass gallery rail on the front lip
    for (let x = -W / 2 + 2; x <= W / 2 - 2; x++) {
      if (x % 8 === 0) m.set(x, ty + 1, dz + D0 / 2, BRONZE[3], VF.METAL);
      m.set(x, ty + 2, dz + D0 / 2, BRONZE[4], VF.METAL);
    }
  }
  // the posts: turned, with lotus-bud finials, four of them
  for (const px of [-W / 2 - 2, W / 2 + 2])
    for (const pz of [6 + D0 / 2 - 1, -10 - D0 / 2 + 1]) {
      const top = pz > 0 ? 34 : 62;
      lathe(m, px, pz, 0, top, (t) => 2.2 + (t < 0.06 ? 1 : 0) + Math.sin(t * Math.PI * 7) * 0.35, (_x, y) => (y < 2 ? CEDAR[0] : pick(CEDAR, 0.55 + Math.sin(y * 0.7) * 0.2)));
      lathe(m, px, pz, top + 1, top + 6, (t) => 2.6 * Math.sin((0.25 + t * 0.75) * Math.PI), (_x, y, _z, _o, ang) => (Math.abs(Math.sin(ang * 2)) > 0.8 ? GOLD.base : y > top + 4 ? PGREEN[2] : PGREEN[1]), 0);
    }
  // stretchers low down
  for (let x = -W / 2; x <= W / 2; x++) for (const z of [12, -16]) m.set(x, 6, z, CEDAR[2]);
  void seed;
  return { model: m, voxelSize: vs, pivot: [0, 0, 0], slots };
}

// ======================================================================= bell jars (1/32)
/** the jar's turned base: a stepped cedar plinth, a brass ring, a little brass label plate */
export function jarBase(): Built {
  const vs = 1 / 32;
  const m = new VoxelModel('jar_base');
  lathe(m, 0, 0, 0, 3, (t) => 6.6 - t * 0.8, (_x, y) => (y === 3 ? CEDAR[4] : y === 0 ? CEDAR[0] : CEDAR[2]));
  lathe(m, 0, 0, 4, 4, () => 5.6, () => BRONZE[3], VF.METAL);
  // the label plate on the front edge
  for (let x = -2; x <= 2; x++) for (let y = 1; y <= 2; y++) m.set(x, y, 7, y === 2 ? BRONZE[4] : BRONZE[3], VF.METAL);
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] };
}

/** the glass dome: a tall bell with a rolled lip and a knob (render it see-through) */
export function jarGlass(): Built {
  const vs = 1 / 32;
  const m = new VoxelModel('jar_glass');
  const H = 18;
  lathe(m, 0, 0, 5, 5 + H, (t) => (t < 0.08 ? 5.3 : 5.0 * Math.cos(Math.pow(Math.max(0, t - 0.55) / 0.45, 1.6) * Math.PI * 0.5) + 0.2), (_x, y, _z, outer) => (outer ? (y === 5 ? 0xd8f0f0 : 0xa8d4dc) : null), 0, true);
  lathe(m, 0, 0, 6 + H, 7 + H, (t) => 1.4 - t * 0.4, () => 0xc8e8ec);
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] };
}

/** a dust sheet thrown over a jar nobody has filled: heavy folds to the base, a cord at the
 *  neck, grey dust on the shoulders */
export function dustSheet(seed = 0): Built {
  const vs = 1 / 32;
  const m = new VoxelModel('dust_sheet_' + seed);
  const H = 24;
  for (let y = 0; y <= H + 2; y++) {
    const t = y / H;
    const R = y > H ? 2.4 - (y - H) : t < 0.7 ? 6.4 - t * 0.6 + (t < 0.12 ? (0.12 - t) * 6 : 0) : 6.0 * Math.cos(((t - 0.7) / 0.3) * Math.PI * 0.45) + 0.4;
    const RR = Math.ceil(R + 2);
    for (let x = -RR; x <= RR; x++)
      for (let z = -RR; z <= RR; z++) {
        const a = Math.atan2(z, x);
        // folds: deeper toward the hem, swinging a little
        const fold = (Math.sin(a * 7 + seed + t * 1.5) * 0.7 + Math.sin(a * 3 - seed) * 0.4) * (1 - t) * 1.1;
        const d = Math.hypot(x, z);
        if (d > R + fold + 0.3 || d < R + fold - 1.4) continue;
        const shoulder = t > 0.62;
        const tn = Math.sin(a * 7 + seed + t * 1.5);
        let c = tn < -0.45 ? 0x8a7c6a : tn < 0.1 ? 0x9e8f7a : tn < 0.6 ? 0xb2a28a : 0xc4b498;
        if (shoulder) c = tn < -0.2 ? 0xb8ad9a : 0xd2c8b6; // a grey bloom of dust on the shoulders
        m.set(x, y, z, c, VF.SOFTAO);
      }
  }
  // the cord round the neck and a dangling end
  for (let a = 0; a < Math.PI * 2; a += 0.25) m.set(Math.round(Math.cos(a) * 4.2), Math.round(H * 0.86), Math.round(Math.sin(a) * 4.2), 0x8a3a22);
  for (let k = 0; k < 6; k++) m.set(3 + (k > 3 ? 1 : 0), Math.round(H * 0.86) - k, 4, 0x8a3a22);
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] };
}

// ======================================================================= the pedestal (1/32)
/** where Thoth sets the specimen he is showing: a sandstone plinth with a cavetto cornice,
 *  lapis panels with a gold border, a gold top inlaid with a ring of glyphs */
export function pedestal(): Built & { top: number } {
  const vs = 1 / 32;
  const m = new VoxelModel('pedestal');
  const H = 28, R = 11;
  for (let y = 0; y <= H; y++) {
    const t = y / H;
    let r = R - 2;
    if (y < 3) r = R + 1 - y * 0.5;
    if (t > 0.86) r = R - 2 + (t - 0.86) * 24;
    for (let x = -Math.ceil(r); x <= Math.ceil(r); x++)
      for (let z = -Math.ceil(r); z <= Math.ceil(r); z++) {
        if (Math.max(Math.abs(x), Math.abs(z)) > r) continue;
        const face = Math.max(Math.abs(x), Math.abs(z)) > r - 1;
        let c = face ? SAND[3] : SAND[1];
        let f = 0;
        if (face && y > 5 && y < H - 6) {
          const u = Math.abs(x) > r - 1 ? Math.abs(z) : Math.abs(x);
          if (u < r - 2) c = LAPIS[2];
          if (Math.abs(u - (r - 2)) < 0.6 || y === 6 || y === H - 7) (c = GOLD.base), (f = VF.METAL);
        }
        if (y === H) (c = GOLD.shade), (f = VF.METAL);
        m.set(x, y, z, c, f);
      }
  }
  // the ring of glyphs on top
  for (let a = 0; a < Math.PI * 2; a += 0.09) {
    const x = Math.round(Math.cos(a) * 9), z = Math.round(Math.sin(a) * 9);
    if (Math.floor(a / 0.36) % 2 === 0) m.set(x, H, z, GOLD.hi, VF.EMISSIVE);
  }
  // a glyph on each lapis panel
  const g = GLYPH_BITMAPS[0];
  for (const [fx, fz] of [[0, 1], [0, -1], [1, 0], [-1, 0]])
    g.forEach((row, i) =>
      [...row].forEach((ch, j) => {
        if (ch !== '#') return;
        const u = j - 3, y = H - 9 - i;
        if (fz) m.set(u * fz, y, fz * (R - 1), GOLD.hi, VF.METAL);
        else m.set(fx * (R - 1), y, -u * fx, GOLD.hi, VF.METAL);
      })
    );
  return { model: m, voxelSize: vs, pivot: [0, 0, 0], top: (H + 1) * vs };
}

// ======================================================================= rugs (1/24)
/** a woven rug: a field of madder red with lapis lozenges, a gold-and-black border, fringe */
export function rug(wm: number, dm: number, seed = 0): Built {
  const vs = 1 / 24;
  const m = new VoxelModel('rug_' + seed);
  const W = Math.round(wm / vs), D = Math.round(dm / vs);
  for (let x = 0; x < W; x++)
    for (let z = -2; z < D + 2; z++) {
      if (z < 0 || z >= D) {
        if (x % 2 === 0) m.set(x, 0, z, 0xd8c8a0);
        continue;
      }
      const e = Math.min(x, z, W - 1 - x, D - 1 - z);
      let c: number;
      if (e < 1) c = 0x2a1a14;
      else if (e < 4) c = (x + z) % 4 < 2 ? GOLD.shade : 0x2a1a14;
      else if (e < 5) c = 0x5a1a12;
      else {
        const u = ((x - W / 2) / 6), v = ((z - D / 2) / 6);
        const lz = Math.abs(((u % 2) + 2) % 2 - 1) + Math.abs(((v % 2) + 2) % 2 - 1);
        c = lz < 0.5 ? LAPIS[3] : lz < 0.62 ? GOLD.base : lz > 1.7 ? 0x6a1a12 : 0x8a2a1c;
      }
      // a worn patch where everybody walks
      if (hash3(x >> 1, z >> 1, seed) > 0.93) c = mixRGB(c, 0xc8a878, 0.3);
      m.set(x, 0, z, c, VF.SOFTAO);
    }
  return { model: m, voxelSize: vs, pivot: [W / 2, 0, D / 2] };
}

// ======================================================================= the apse moon (1/16)
/** the great carved moon on the apse wall: a silver disc with craters and maria, a crescent of
 *  bright gold, set in a lapis roundel ringed with stars; it glows faintly (Thoth is the moon) */
export function moonRoundel(): Built {
  const vs = 1 / 16;
  const m = new VoxelModel('moon_roundel');
  const R = 30;
  for (let x = -R - 5; x <= R + 5; x++)
    for (let y = -R - 5; y <= R + 5; y++) {
      const d = Math.hypot(x, y);
      if (d > R + 5) continue;
      if (d > R + 1) {
        const a = Math.atan2(y, x);
        const st = Math.abs(((a / (Math.PI * 2)) * 36 + 36) % 1 - 0.5) < 0.14 && Math.abs(d - (R + 3)) < 0.9;
        m.set(x, y, 0, st ? GOLD.hi : d > R + 4 ? GOLD.shade : LAPIS[1], st ? VF.EMISSIVE : d > R + 4 ? VF.METAL : 0);
        continue;
      }
      const cr = Math.hypot(x + 9, y - 4);
      const lit = Math.hypot(x - 11, y - 3) > R - 2;
      const maria = noise.n2(x * 0.09 + 3, y * 0.09) > 0.25;
      let c = lit ? (maria ? 0x8e98ac : 0xc4ccd8) : maria ? 0x6a7488 : 0x8a94a6;
      let depth = 1;
      for (const [cx, cy, rr] of [[-12, 8, 5], [6, -14, 4], [14, 12, 3], [-4, -6, 3], [-18, -8, 2.5], [20, -4, 2]] as const) {
        const dd = Math.hypot(x - cx, y - cy);
        if (dd < rr) depth = 0;
        else if (dd < rr + 1) c = mixRGB(c, 0xffffff, 0.25);
      }
      if (cr < 0) depth = 1;
      const rim = !lit && d > R - 3;
      if (rim) c = GOLD.hi;
      const limb = lit && Math.hypot(x - 11, y - 3) < R + 1.5;
      for (let z = 0; z <= depth + 1; z++) m.set(x, y, z, z === depth + 1 ? (limb ? 0xeef2f8 : c) : 0x5a6274, z === depth + 1 ? (rim || limb ? VF.GLOW : VF.EMISSIVE) : 0);
    }
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] };
}

// ======================================================================= Thoth's desk (1/32)
/** Thoth's writing desk: much too big for him (he has a stool with three steps). A heavy cedar
 *  table on lion-paw legs, an open tome, unrolled papyri weighted with a scarab, an inkpot and a
 *  rack of reed pens, a stack of books, a bronze lamp. Front faces +Z. */
export function thothDesk(): Built & { meta: { top: number; flame: V3; stool: V3; write: V3 } } {
  const vs = 1 / 32;
  const m = new VoxelModel('thoth_desk');
  const W = 60, D = 30, T = 30;
  const xA = -W / 2, xB = W / 2, zA = -D / 2, zB = D / 2;
  // top (two boards, a moulded edge)
  for (let x = xA; x <= xB; x++)
    for (let z = zA; z <= zB; z++) {
      const edge = x === xA || x === xB || z === zA || z === zB;
      for (let y = T - 2; y <= T; y++) m.set(x, y, z, edge ? (y === T ? CEDAR[4] : CEDAR[2]) : y === T ? pick(CEDAR, 0.55 + (z === 0 ? -0.2 : 0) + noise.n2(x * 0.1, z * 0.3) * 0.15) : CEDAR[1]);
    }
  // apron with a lapis-and-gold band
  for (let x = xA + 2; x <= xB - 2; x++)
    for (let y = T - 7; y < T - 2; y++) {
      const band = y === T - 4 || y === T - 5;
      const c = band ? (x % 4 === 0 ? GOLD.base : LAPIS[2]) : CEDAR[2];
      m.set(x, y, zB - 2, c, band && x % 4 === 0 ? VF.METAL : 0);
      m.set(x, y, zA + 2, CEDAR[2]);
    }
  // lion-paw legs
  for (const lx of [xA + 3, xB - 3])
    for (const lz of [zA + 3, zB - 3]) {
      lathe(m, lx, lz, 4, T - 3, (t) => 2.2 + Math.sin(t * Math.PI * 3) * 0.3 + (t > 0.9 ? 0.8 : 0), (_x, y) => (y % 6 === 0 ? CEDAR[1] : CEDAR[3]));
      // the paw: four toes forward
      for (let k = -2; k <= 2; k += 1.33) {
        const kx = Math.round(lx + k);
        for (let z = 0; z <= 4; z++) for (let y = 0; y <= 3 - (z > 3 ? 1 : 0); y++) m.set(kx, y, lz + z - 1, y === 0 ? CEDAR[0] : CEDAR[3]);
      }
    }
  // the open tome (on a slope), its pages and a ribbon
  for (let x = -14; x <= 6; x++)
    for (let z = -8; z <= 6; z++) {
      const y = T + 1 + Math.floor((6 - z) / 7);
      const gutter = x === -4;
      m.set(x, y, z, gutter ? 0xb8a880 : (x + z) % 9 === 0 ? 0xd8c8a0 : 0xeee2c4);
      if (z === -8 || x === -14 || x === 6) m.set(x, y - 1, z, 0x6e1e16);
      // lines of writing
      if (!gutter && z % 2 === 0 && z > -7 && z < 5 && Math.abs(x + 4) > 2 && hash3(x, z, 2) > 0.3) m.set(x, y, z, 0x3a2a20);
    }
  for (let k = 0; k < 7; k++) m.set(-4, T + 1, 7 + k, 0xa8221a);
  // unrolled papyrus to the right, curling at both ends, a jade scarab weight on it
  for (let x = 9; x <= 26; x++)
    for (let z = -10; z <= 4; z++) {
      m.set(x, T + 1, z, x % 5 === 0 && z % 3 === 0 ? 0x3a2a20 : PAPYRUS[(x + z) % 3 === 0 ? 2 : 3]);
    }
  for (let z = -10; z <= 4; z++) {
    m.set(8, T + 2, z, PAPYRUS[1]).set(8, T + 1, z, PAPYRUS[0]).set(27, T + 2, z, PAPYRUS[1]).set(27, T + 1, z, PAPYRUS[0]);
  }
  m.box(16, T + 2, 0, 19, T + 3, 2, PGREEN[2]);
  m.set(17, T + 4, 1, PGREEN[1]).set(18, T + 4, 1, PGREEN[1]);
  // the inkpot (faience blue) with reed pens in a rack
  lathe(m, 22, -12, T + 1, T + 5, (t) => 2.4 - t * 0.9, (_x, y) => (y === T + 5 ? 0x101418 : 0x2a8a9a));
  for (let k = 0; k < 3; k++) for (let y = 0; y < 12; y++) m.set(25 + k, T + 1 + y, -12 + Math.floor(y / 4), y > 9 ? 0x3a2a20 : PAPYRUS[0]);
  // a stack of books at the back left
  for (let k = 0; k < 4; k++) {
    const col = LEATHERS[(k * 5 + 3) % LEATHERS.length];
    m.box(-26 + (k % 2), T + 1 + k * 2, -12, -18 + (k % 2), T + 2 + k * 2, -5, col);
    m.box(-26 + (k % 2), T + 1 + k * 2, -5, -18 + (k % 2), T + 1 + k * 2, -5, 0xe8dcc0);
  }
  // the bronze lamp (a lotus bowl on a foot)
  lathe(m, -22, 6, T + 1, T + 3, (t) => 2.6 - t, () => BRONZE[2], VF.METAL);
  lathe(m, -22, 6, T + 4, T + 7, (t) => 1.2 + t * 2.4, (_x, _y, _z, outer, ang) => (outer && Math.abs(Math.sin(ang * 4)) > 0.7 ? BRONZE[4] : BRONZE[3]), VF.METAL);
  m.set(-22, T + 8, 6, 0xffd27a, VF.GLOW);
  // the stool with three steps (in front, to the left)
  for (let s = 0; s < 3; s++) {
    const sy = (s + 1) * 6, sz = zB + 12 - s * 5;
    for (let x = -14; x <= -2; x++)
      for (let z = sz - 4; z <= sz; z++)
        for (let y = 0; y <= sy; y++) {
          const shell = y === sy || x === -14 || x === -2 || z === sz || z === sz - 4;
          if (!shell) continue;
          m.set(x, y, z, y === sy ? (z === sz ? CEDAR[4] : CEDAR[3]) : CEDAR[1]);
        }
  }
  return { model: m, voxelSize: vs, pivot: 'bottom', meta: { top: (T + 1) * vs, flame: [-22 * vs, (T + 8.5) * vs, 6 * vs], stool: [-8 * vs, 19 * vs, (zB + 4) * vs], write: [-4 * vs, (T + 2) * vs, 0] } };
}

// ======================================================================= Thoth's book pile (1/32)
/** five giant tomes stacked crooked in the nave: Thoth's podium for saying hello (he is not
 *  small, everybody else is just very big). Gilt corners, page edges, a ribbon, a candle stub.
 *  meta.top: the height of the top cover (m). */
export function bookPile(): Built & { top: number } {
  const vs = 1 / 32;
  const m = new VoxelModel('book_pile');
  const books = [
    { w: 18, d: 13, h: 4, rot: 0.0, col: LEATHERS[0] },
    { w: 16, d: 12, h: 4, rot: 0.22, col: LEATHERS[3] },
    { w: 17, d: 12, h: 3, rot: -0.12, col: LEATHERS[5] },
    { w: 14, d: 10, h: 4, rot: 0.35, col: LEATHERS[7] },
    { w: 13, d: 10, h: 3, rot: 0.1, col: LEATHERS[13] },
  ];
  let y = 0;
  for (const b of books) {
    const c = Math.cos(b.rot), sn = Math.sin(b.rot);
    const R = Math.ceil(Math.hypot(b.w, b.d)) + 1;
    for (let x = -R; x <= R; x++)
      for (let z = -R; z <= R; z++) {
        // the book's own frame
        const u = x * c + z * sn, v = -x * sn + z * c;
        if (Math.abs(u) > b.w || Math.abs(v) > b.d) continue;
        for (let k = 0; k < b.h; k++) {
          const cover = k === 0 || k === b.h - 1;
          const spine = u < -b.w + 1.5;
          const corner = cover && Math.abs(u) > b.w - 2.5 && Math.abs(v) > b.d - 2.5 && !spine;
          let col: number = cover || spine ? b.col : (k % 2 ? 0xeee2c4 : 0xd8c8a0);
          let f = 0;
          if (corner) (col = GOLD.base), (f = VF.METAL);
          else if (spine && (k === 1 || k === b.h - 2)) (col = GOLD.shade), (f = VF.METAL);
          else if (!cover && !spine && (Math.abs(u) < b.w - 1 && Math.abs(v) < b.d - 1)) continue; // inside the page block
          m.set(x, y + k, z, col, f);
        }
      }
    y += b.h;
  }
  // a red ribbon hanging out of the second book, a candle stub on top
  for (let k = 0; k < 9; k++) m.set(4, 6 - Math.min(5, k), 13 + Math.min(k, 3), 0xa8221a);
  lathe(m, 5, -3, y, y + 2, () => 2.2, () => BRONZE[3], VF.METAL);
  lathe(m, 5, -3, y + 3, y + 7, () => 1, (_x, yy) => (yy === y + 7 ? 0x3a2a20 : 0xeee2c4));
  m.set(5, y + 8, -3, 0xffd27a, VF.GLOW);
  return { model: m, voxelSize: vs, pivot: [0, 0, 0], top: y * vs };
}

// ======================================================================= rigs
/** a flying book (1/48): `spine` (root) carrying the page block's two halves on the covers;
 *  `cover_l` / `cover_r` hinge on the spine (flap them), `leaf` is one page that can flip.
 *  Tooled leather with gilt corners and a gilt eye on the front. Closed it is ~20 x 14 cm. */
export function flyingBookRig(seed = 0): RigSpec {
  const vs = 1 / 48;
  const col = LEATHERS[(seed * 7 + 2) % LEATHERS.length];
  const dark = mixRGB(col, 0x000000, 0.3), lite = mixRGB(col, 0xffffff, 0.15);
  const W = 7, L = 10; // half width (x), length (z) of a cover
  const cover = (side: 1 | -1) => {
    const m = new VoxelModel('fbook_cover');
    for (let x = 0; x <= W; x++)
      for (let z = -L; z <= L; z++) {
        const edge = x === W || Math.abs(z) === L;
        const corner = x >= W - 1 && Math.abs(z) >= L - 1;
        let c = edge ? dark : (x + z) % 7 === 0 ? lite : col;
        let f = 0;
        if (corner) (c = GOLD.base), (f = VF.METAL);
        if (x === W - 2 && Math.abs(z) < L - 2 && Math.abs(z) % 2 === 0) (c = GOLD.shade), (f = VF.METAL);
        m.set(side * x, 0, z, c, f);
        // the page block half on the cover's inside
        if (x < W && Math.abs(z) < L) m.set(side * x, 1, z, x === W - 1 || Math.abs(z) === L - 1 ? 0xd8c8a0 : 0xeee2c4);
      }
    // a gilt eye on the outside of the front cover
    if (side > 0) {
      const eye = ['.###.', '#...#', '#.#.#', '.###.'];
      eye.forEach((r, i) => [...r].forEach((ch, j) => ch === '#' && m.set(side * (2 + j), -1, -2 + i, GOLD.hi, VF.METAL)));
    }
    return m;
  };
  const spine = new VoxelModel('fbook_spine');
  for (let z = -L; z <= L; z++) for (let y = -1; y <= 2; y++) spine.set(0, y, z, Math.abs(z) % 4 === 0 ? GOLD.base : col, Math.abs(z) % 4 === 0 ? VF.METAL : 0);
  const leaf = new VoxelModel('fbook_leaf');
  for (let x = 0; x < W; x++) for (let z = -L + 1; z < L; z++) leaf.set(x, 0, z, (x * 3 + z) % 5 === 0 ? 0x5a4a3a : 0xf4ead2);
  return {
    name: 'flying_book_' + seed,
    voxelSize: vs,
    parts: [
      { name: 'spine', model: spine, pivot: [0, 0, 0], attach: [0, 0, 0] },
      { name: 'cover_l', model: cover(1), pivot: [0, 0, 0], parent: 'spine', attach: [0, 0, 0], rest: [0, 0, 0.9] },
      { name: 'cover_r', model: cover(-1), pivot: [0, 0, 0], parent: 'spine', attach: [0, 0, 0], rest: [0, 0, -0.9] },
      { name: 'leaf', model: leaf, pivot: [0, 0, 0], parent: 'spine', attach: [0, 2, 0], rest: [0, 0, 0.6] },
    ],
    meta: { height: 0.3, radius: 0.2 },
  };
}

/** a rolling library ladder (1/24) hooked on the gallery's brass rail: `ladder` (root, the hooks at
 *  the top at the origin), two `wheel_l` / `wheel_r` at the foot that turn as it rolls. Rungs worn
 *  pale in the middle. It leans back toward -Z by `lean` (radians, applied by the scene). */
export function ladderRig(hm: number): RigSpec {
  const vs = 1 / 24;
  const H = Math.round(hm / vs);
  const m = new VoxelModel('ladder');
  for (const sx of [-7, 7])
    for (let y = -H; y <= 2; y++) {
      m.set(sx, y, 0, pick(CEDAR, 0.6 + (y % 9 === 0 ? -0.2 : 0)));
      m.set(sx, y, 1, CEDAR[2]);
    }
  for (let y = -H + 4; y < -1; y += 6)
    for (let x = -6; x <= 6; x++) m.set(x, y, 0, Math.abs(x) < 3 ? CEDAR[4] : CEDAR[3]);
  // the brass hooks over the rail
  for (const sx of [-7, 7]) {
    m.set(sx, 3, 0, BRONZE[3], VF.METAL).set(sx, 4, -1, BRONZE[4], VF.METAL).set(sx, 3, -2, BRONZE[3], VF.METAL).set(sx, 2, -2, BRONZE[2], VF.METAL);
  }
  const wheel = new VoxelModel('ladder_wheel');
  for (let a = 0; a < Math.PI * 2; a += 0.3) wheel.set(0, Math.round(Math.sin(a) * 2), Math.round(Math.cos(a) * 2), BRONZE[3], VF.METAL);
  wheel.set(0, 0, 0, BRONZE[4], VF.METAL);
  return {
    name: 'hall_ladder_' + H,
    voxelSize: vs,
    parts: [
      { name: 'ladder', model: m, pivot: [0, 0, 0], attach: [0, 0, 0] },
      { name: 'wheel_l', model: wheel, pivot: [0, 0, 0], parent: 'ladder', attach: [8, -H, 0] },
      { name: 'wheel_r', model: wheel, pivot: [0, 0, 0], parent: 'ladder', attach: [-8, -H, 0] },
    ],
    meta: { height: hm },
  };
}

/** a bronze oil lamp hanging on a chain (1/32): `chain` (root, hook at the origin, hangs down -Y)
 *  and `lamp` (hinged at the chain's foot so it sways on its own). A lotus bowl with three spouts
 *  and three little flames. meta.flames: flame points in lamp space (m), meta.len: chain length (m). */
export function hangingLampRig(chainM: number): RigSpec {
  const vs = 1 / 32;
  const L = Math.round(chainM / vs);
  const chain = new VoxelModel('lamp_chain');
  for (let y = 0; y > -L; y--) {
    const k = Math.floor(-y / 3);
    if (k % 2 === 0) {
      chain.set(-1, y, 0, BRONZE[2], VF.METAL).set(1, y, 0, BRONZE[2], VF.METAL);
      if (-y % 3 === 0) chain.set(0, y, 0, BRONZE[3], VF.METAL);
    } else {
      chain.set(0, y, -1, BRONZE[3], VF.METAL).set(0, y, 1, BRONZE[3], VF.METAL);
      if (-y % 3 === 0) chain.set(0, y, 0, BRONZE[2], VF.METAL);
    }
  }
  const lamp = new VoxelModel('lamp_bowl');
  // three short chains to the bowl's rim
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    for (let s = 0; s <= 10; s++) lamp.set(Math.round(Math.cos(a) * s * 0.7), -s, Math.round(Math.sin(a) * s * 0.7), BRONZE[2], VF.METAL);
  }
  // the lotus bowl: petals rising round a shallow dish, a pine-cone foot below
  lathe(lamp, 0, 0, -18, -11, (t) => 3 + t * 5, (_x, _y, _z, outer, ang) => (outer ? (Math.abs(Math.sin(ang * 4)) > 0.75 ? BRONZE[1] : Math.abs(Math.sin(ang * 4)) < 0.2 ? BRONZE[4] : BRONZE[3]) : BRONZE[2]), VF.METAL);
  lathe(lamp, 0, 0, -22, -19, (t) => 1 + t * 2, (_x, y) => (y % 2 ? BRONZE[2] : BRONZE[3]), VF.METAL);
  const flames: V3[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    const sx = Math.round(Math.cos(a) * 9), sz = Math.round(Math.sin(a) * 9);
    lamp.set(sx, -11, sz, BRONZE[3], VF.METAL).set(Math.round(sx * 1.1), -10, Math.round(sz * 1.1), BRONZE[4], VF.METAL);
    lamp.set(Math.round(sx * 1.1), -9, Math.round(sz * 1.1), 0xffd27a, VF.GLOW);
    flames.push([Math.round(sx * 1.1) * vs, -8.5 * vs, Math.round(sz * 1.1) * vs]);
  }
  lamp.set(0, -12, 0, 0x6a4a1a); // oil
  return {
    name: 'hall_lamp_' + L,
    voxelSize: vs,
    parts: [
      { name: 'chain', model: chain, pivot: [0, 0, 0], attach: [0, 0, 0] },
      { name: 'lamp', model: lamp, pivot: [0, 0, 0], parent: 'chain', attach: [0, -L, 0] },
    ],
    meta: { flames, len: chainM },
  };
}
