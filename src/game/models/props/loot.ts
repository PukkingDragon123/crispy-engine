// Loot — STYLE v2: treasure chests with hinged lids, ore nodes, and the crisp
// item models shown large in the 3D HUD (1/48 m: ~16-26 voxels across, clean
// silhouettes, 3-tone shading, a bright accent each).
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { Ramp } from '../style';
import { S, StaticModel, V3, PR, rngOf, inCircle, chunk, mod, sandDrift } from './helpers';

export type ChestTier = 'wood' | 'silver' | 'gold' | 'divine';
export interface ChestModel {
  base: VoxelModel;
  lid: VoxelModel;
  voxelSize: number;
  /** hinge axis point (voxel coords, shared frame). Build lid with pivot = hinge; rotate lid.rotation.x NEGATIVE to open */
  hinge: V3;
  /** build base with this pivot (bottom centre); place lid node at (hinge - basePivot) * voxelSize */
  basePivot: V3;
}

/** treasure chest ≈0.9×0.6 m, 1/24. Front (+Z) lock plate; domed lid hinged at the back top edge. */
export function chest(tier: ChestTier = 'wood'): ChestModel {
  const vs = 1 / 24;
  const base = new VoxelModel('chest_' + tier);
  const lid = new VoxelModel('chest_lid_' + tier);
  const T: Record<ChestTier, { body: Ramp; band: Ramp; gem?: number }> = {
    wood: { body: PR.wood, band: PR.iron },
    silver: { body: PR.woodDark, band: PR.silver, gem: PR.turquoise.base },
    gold: { body: PR.barnRed, band: PR.gold, gem: PR.red.hi },
    divine: { body: PR.lapis, band: PR.gold, gem: PR.serket.base },
  };
  const t = T[tier];
  const L = 11, D = 7, H = 10;
  const x0 = -L, x1 = L - 1, z0 = -D, z1 = D - 1;
  const bandX = (x: number) => x === x0 || x === x1 || Math.abs(x - -6) <= 0 || Math.abs(x - 5) <= 0 || x === -7 || x === 6;
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      for (let y = 0; y <= H; y++) {
        const shell = x === x0 || x === x1 || z === z0 || z === z1 || y === 0;
        if (!shell) {
          if (y === H) base.set(x, y, z, PR.socket.base);
          continue;
        }
        let c = mod(y, 3) === 0 ? t.body.dark : t.body.base;
        if (y === H) c = t.body.hi;
        const metal = bandX(x) || y === 0 || (y === H && (z === z0 || z === z1));
        if (metal) c = y === H || y === 0 ? t.band.hi : t.band.base;
        base.set(x, y, z, c, metal ? VF.METAL : 0);
      }
  // corner caps
  for (const x of [x0, x1]) for (const z of [z0, z1]) for (const y of [0, 1, H - 1, H]) base.set(x, y, z, t.band.shade, VF.METAL);
  // lock plate + keyhole
  base.box(-2, 3, z1 + 1, 1, 8, z1 + 1, t.band.base, VF.METAL);
  base.box(-1, 4, z1 + 1, 0, 6, z1 + 1, PR.socket.base);
  base.set(-1, 7, z1 + 1, t.band.hi, VF.METAL).set(0, 7, z1 + 1, t.band.hi, VF.METAL);
  // nail heads
  for (const x of [x0 + 2, x1 - 2]) for (const y of [3, 7]) base.set(x, y, z1 + 1, t.band.dark, VF.METAL);
  // domed lid: half-cylinder along x on top of the box
  const R = D;
  for (let x = x0; x <= x1; x++)
    for (let zz = -R; zz <= R - 1; zz++)
      for (let yy = 0; yy <= R; yy++) {
        const dz = zz + 0.5;
        const d = Math.sqrt(dz * dz + yy * yy);
        if (d > R - 0.3) continue;
        const outer = d > R - 1.4 || x === x0 || x === x1;
        if (!outer) continue;
        let c = yy > R * 0.6 ? t.body.hi : mod(Math.round(Math.atan2(yy, dz) * 4), 2) ? t.body.base : t.body.shade;
        const metal = bandX(x) || (yy <= 1 && (zz === -R || zz === R - 1));
        if (metal) c = yy > R * 0.6 ? t.band.hi : t.band.base;
        lid.set(x, H + 1 + yy, zz, c, metal ? VF.METAL : 0);
      }
  // lid latch tongue + gem
  lid.box(-2, H + 1, z1 + 1, 1, H + 4, z1 + 1, t.band.base, VF.METAL);
  if (t.gem !== undefined) {
    lid.box(-1, H + 2 + R - 2, z1 - 1, 0, H + 3 + R - 2, z1, t.gem);
    lid.set(-1, H + 3 + R - 2, z1, 0xffffff);
  }
  if (tier === 'divine') {
    // gold scarab emblem on the lid
    const sc = ['.#..#.', '######', '.####.', '######', '.#..#.'];
    sc.forEach((row, i) => [...row].forEach((ch, j) => ch === '#' && lid.set(-3 + j, H + 1 + R, -2 + i, PR.gold.hi, VF.METAL)));
  }
  const hinge: V3 = [0, H + 1, z0];
  const b = base.bounds();
  return { base, lid, voxelSize: vs, hinge, basePivot: [(b.minX + b.maxX + 1) / 2, b.minY, (b.minZ + b.maxZ + 1) / 2] };
}

export type OreType = 'copper' | 'silver' | 'gold' | 'turquoise' | 'amethyst';

/** chunky rock with ore nuggets / crystals poking out. 1/20 */
export function oreNode(type: OreType = 'gold', seed = 0): StaticModel {
  const r = rngOf(seed, 37);
  const m = new VoxelModel('ore_' + type);
  const rock = type === 'turquoise' || type === 'amethyst' ? PR.greyRock : PR.redRock;
  chunk(m, -12, 0, -10, 12, 14, 10, rock, 1, false, 3, seed * 3 + 1);
  chunk(m, -6, 8, -7, 8, 22, 7, rock, 1, false, 3, seed * 3 + 2);
  chunk(m, 6, 0, -4, 16, 10, 8, rock, 1, false, 2, seed * 3 + 3);
  const ore: Ramp = type === 'copper' ? PR.copper : type === 'silver' ? PR.silver : type === 'gold' ? PR.gold : type === 'turquoise' ? PR.turquoise : PR.amethyst;
  const metal = type === 'gold' || type === 'silver' || type === 'copper';
  if (type === 'amethyst' || type === 'turquoise') {
    // crystal prisms
    for (let i = 0; i < 7; i++) {
      const a = r.next() * Math.PI * 2;
      const bx = Math.round(Math.cos(a) * 8), bz = Math.round(Math.sin(a) * 6);
      let by = 22;
      while (by > 0 && !m.has(bx, by, bz)) by--;
      const h = r.int(6, 12);
      const lean = r.pick([-1, 0, 1]);
      for (let y = 0; y < h; y++) {
        const w = y > h - 3 ? 0 : 1;
        const ox = Math.round((lean * y) / 3);
        for (let x = -w; x <= w; x++) for (let z = -w; z <= w; z++) m.set(bx + ox + x, by + y, bz + z, y > h - 3 ? ore.hi : x + z > 0 ? ore.hi : x + z < 0 ? ore.shade : ore.base);
      }
    }
  } else {
    // nuggets + veins on the surface
    for (let i = 0; i < 9; i++) {
      const a = r.next() * Math.PI * 2;
      const bx = Math.round(Math.cos(a) * 10), bz = Math.round(Math.sin(a) * 8);
      let by = 22;
      while (by > 0 && !m.has(bx, by, bz)) by--;
      m.box(bx - 1, by, bz - 1, bx + 1, by + 2, bz + 1, ore.base, metal ? VF.METAL : 0);
      m.box(bx, by + 2, bz, bx + 1, by + 2, bz, ore.hi, metal ? VF.METAL : 0);
      if (type === 'copper') m.set(bx - 1, by + 1, bz + 1, PR.turquoise.shade);
    }
  }
  sandDrift(m, 0, 0, 16, 14, 3, 0, seed);
  return S(m, 1 / 20);
}

// ---------------------------------------------------------------------------
// HUD / inventory items (1/48)
// ---------------------------------------------------------------------------
const IVS = 1 / 48;

/** rolled linen bandage lying on its side with a loose tail and a red stripe */
export function bandage(): StaticModel {
  const m = new VoxelModel('bandage');
  const R = 6.5, L = 6;
  for (let x = -L; x <= L; x++)
    for (let y = -7; y <= 7; y++)
      for (let z = -7; z <= 7; z++) {
        if (!inCircle(y, z, R)) continue;
        const d = Math.sqrt(y * y + z * z);
        const end = Math.abs(x) === L;
        let c = PR.bandage.base;
        if (end) c = mod(Math.round(d), 2) ? PR.bandage.shade : PR.bandage.hi; // spiral rings
        else if (d > R - 1) c = y > 2 ? PR.bandage.hi : y < -3 ? PR.bandage.shade : PR.bandage.base;
        if (!end && Math.abs(x) === L - 1 && d > R - 1) c = PR.red.base;
        if (end && d < 1.6) c = PR.socket.base;
        m.set(x, y + 8, z, c);
      }
  // loose tail unrolling forward along the ground
  for (let z = 0; z <= 12; z++)
    for (let x = -L + 1; x <= L - 1; x++) {
      const y = z < 5 ? 1 + Math.round(Math.sqrt(Math.max(0, 25 - (z - 5) * (z - 5))) * 0.0) : 1;
      if (z < 6) continue;
      m.set(x, y, z, Math.abs(x) === L - 1 ? PR.red.base : z % 4 === 0 ? PR.bandage.shade : PR.bandage.base);
    }
  for (let x = -L + 1; x <= L - 1; x++) for (let y = 1; y <= 2; y++) m.set(x, y, 6, PR.bandage.base);
  // safety pin
  m.box(-2, 2, 10, 2, 2, 10, PR.silver.base, VF.METAL);
  m.set(3, 2, 10, PR.silver.hi, VF.METAL);
  return S(m, IVS);
}

/** ceremonial dagger, blade up: silver blade with fuller, gold guard, wrapped grip, gem pommel */
export function dagger(): StaticModel {
  const m = new VoxelModel('dagger');
  // pommel
  m.box(-2, 0, -2, 2, 2, 2, PR.gold.base, VF.METAL);
  m.box(-1, 1, 2, 1, 1, 2, PR.red.hi);
  m.set(0, 3, 0, PR.gold.shade, VF.METAL);
  // wrapped grip
  for (let y = 3; y <= 9; y++) m.box(-1, y, -1, 1, y, 1, mod(y, 2) ? PR.leather.base : PR.leatherDark.base);
  // guard: wings curling up
  m.box(-6, 10, -2, 6, 11, 2, PR.gold.base, VF.METAL);
  for (const sx of [-1, 1]) {
    m.box(sx * 6, 12, -1, sx * 7, 13, 1, PR.gold.hi, VF.METAL);
    m.set(sx * 3, 11, 2, PR.lapis.hi).set(sx * 3, 11, -2, PR.lapis.hi);
  }
  m.box(-1, 10, 2, 1, 11, 2, PR.turquoise.hi);
  // blade: tapering to a point, edge highlight, dark fuller line
  const BL = 16;
  for (let k = 0; k < BL; k++) {
    const y = 12 + k;
    const w = k > BL - 4 ? BL - 1 - k : 2;
    for (let x = -w; x <= w; x++) {
      const edge = Math.abs(x) === w;
      const c = x === 0 && k < BL - 5 ? PR.silver.shade : edge ? PR.silver.hi : x < 0 ? PR.silver.base : PR.white.base;
      m.set(x, y, 0, c, VF.METAL);
      if (Math.abs(x) < w) m.set(x, y, x < 0 ? -1 : 1, x < 0 ? PR.silver.shade : PR.silver.base, VF.METAL);
    }
  }
  // blood drop on the tip (it is sacrificial)
  m.set(0, 12 + BL - 2, 1, PR.red.base);
  return S(m, IVS);
}

/** round smoke bomb with brass cap, rope fuse with a spark, paper label band */
export function smokeBomb(): StaticModel {
  const m = new VoxelModel('smoke_bomb');
  const R = 7;
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++)
      for (let z = -R; z <= R; z++) {
        const d = x * x + y * y + z * z;
        if (d > R * R + R) continue;
        const surf = d > (R - 1) * (R - 1) + (R - 1);
        if (!surf) {
          m.set(x, y + R, z, PR.coal.base);
          continue;
        }
        let c = PR.coal.base;
        if (y > 2 && x + z < 2) c = PR.coal.hi;
        if (y < -3) c = PR.coal.dark;
        if (Math.abs(y) <= 1) c = y === 0 && mod(Math.round(Math.atan2(z, x) * 5), 3) === 0 ? PR.ink.base : PR.parchment.base;
        if (y > 4 && x < -1 && z > 1 && x * x + z * z < 8) c = 0x8a8a92;
        m.set(x, y + R, z, c);
      }
  // brass cap + fuse + spark
  m.box(-2, 2 * R, -2, 2, 2 * R + 1, 2, PR.brass.base, VF.METAL);
  m.box(-1, 2 * R + 2, -1, 1, 2 * R + 2, 1, PR.brass.hi, VF.METAL);
  const fuse: V3[] = [[0, 2 * R + 3, 0], [1, 2 * R + 4, 0], [2, 2 * R + 5, 1], [2, 2 * R + 6, 2]];
  for (const [x, y, z] of fuse) m.set(x, y, z, PR.rope.base);
  m.set(3, 2 * R + 7, 2, PR.ember.hi, VF.EMISSIVE);
  m.set(2, 2 * R + 7, 3, PR.ember.base, VF.EMISSIVE);
  // little cloud icon on the label
  for (const [x, y] of [[-1, R], [0, R], [1, R], [0, R + 1]]) m.set(x, y, R, PR.socket.shade);
  return S(m, IVS);
}

/** six-point tin star badge (hexagram) with ball tips and a raised centre disc */
export function shieldCharm(): StaticModel {
  const m = new VoxelModel('shield_charm');
  const R = 11;
  const tri = (x: number, y: number, rot: number) => {
    // point-in-triangle for an equilateral triangle of circumradius R rotated by rot
    const v = [0, 1, 2].map((i) => [Math.cos(rot + (i * Math.PI * 2) / 3) * R, Math.sin(rot + (i * Math.PI * 2) / 3) * R]);
    const sgn = (p: number[], a: number[], b: number[]) => (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    const p = [x, y];
    const d1 = sgn(p, v[0], v[1]), d2 = sgn(p, v[1], v[2]), d3 = sgn(p, v[2], v[0]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
  const inStar = (x: number, y: number) => tri(x, y, Math.PI / 2) || tri(x, y, -Math.PI / 2);
  const cy = R + 2;
  for (let x = -R - 1; x <= R + 1; x++)
    for (let y = -R - 1; y <= R + 1; y++) {
      if (!inStar(x, y)) continue;
      const edge = !inStar(x + 1, y) || !inStar(x - 1, y) || !inStar(x, y + 1) || !inStar(x, y - 1);
      m.set(x, y + cy, 0, edge ? PR.silver.shade : x - y < -3 ? PR.white.base : PR.silver.hi);
      m.set(x, y + cy, -1, PR.silver.dark);
    }
  // raised centre disc with a gold scorpion
  for (let x = -5; x <= 5; x++)
    for (let y = -5; y <= 5; y++) {
      if (!inCircle(x, y, 4.6)) continue;
      const rim = !inCircle(x, y, 3.6);
      m.set(x, y + cy, 1, rim ? PR.silver.base : PR.silver.hi);
    }
  for (const [x, y] of [[0, -2], [0, -1], [0, 0], [-1, 0], [1, 0], [0, 1], [-2, -2], [2, -2], [1, 2], [0, 3], [-1, 3]]) m.set(x, y + cy, 2, PR.gold.base, VF.METAL);
  // ball tips exactly on the six points
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 3;
    const bx = Math.round(Math.cos(a) * R), by = Math.round(Math.sin(a) * R);
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (Math.abs(x) + Math.abs(y) + Math.abs(z) <= 2) m.set(bx + x, by + y + cy, z, x + y > 0 ? PR.white.base : PR.silver.hi);
  }
  return S(m, IVS);
}

/** Serket's charm: gold medallion with a green gem and a scorpion relief, on a cord loop */
export function divineCharm(): StaticModel {
  const m = new VoxelModel('divine_charm');
  const R = 8;
  const cy = R + 1;
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++) {
      if (!inCircle(x, y, R)) continue;
      const rim = !inCircle(x, y, R - 1.5);
      const c = rim ? (x + y > 0 ? PR.gold.hi : PR.gold.shade) : PR.gold.base;
      for (let z = -1; z <= (rim ? 1 : 0); z++) m.set(x, y + cy, z, z < 0 ? PR.gold.shade : c, VF.METAL);
    }
  // gem
  for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) if (Math.abs(x) + Math.abs(y) <= 3) m.set(x, y + cy + 1, 1, x + y > 1 ? PR.serket.hi : x + y < -1 ? PR.serket.dark : PR.serket.base);
  m.set(-1, cy + 2, 2, 0xffffff);
  // scorpion tail curling around the gem
  for (const [x, y] of [[3, -3], [4, -2], [5, 0], [5, 2], [4, 4], [2, 5], [1, 4]]) m.set(x, y + cy, 1, PR.gold.hi, VF.METAL);
  for (const [x, y] of [[-3, -4], [-4, -4], [-5, -3], [-3, -5]]) m.set(x, y + cy, 1, PR.gold.hi, VF.METAL);
  // bail + cord loop
  m.box(-1, 2 * R + 1, -1, 1, 2 * R + 3, 1, PR.gold.base, VF.METAL);
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * Math.PI;
    m.set(Math.round(Math.cos(t) * 5), 2 * R + 3 + Math.round(Math.sin(t) * 6), 0, PR.leather.base);
  }
  return S(m, IVS);
}

/** gold coin standing on edge: raised rim, embossed scarab, reeded edge */
export function goldCoin(): StaticModel {
  const m = new VoxelModel('gold_coin');
  const R = 8;
  const cy = R;
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++) {
      if (!inCircle(x, y, R)) continue;
      const rim = !inCircle(x, y, R - 1.4);
      for (let z = -1; z <= 1; z++) {
        let c = PR.gold.base;
        if (rim) c = (x + y > 0) ? PR.gold.hi : PR.gold.shade;
        if (Math.abs(z) === 1 && !rim) c = PR.gold.base;
        if (Math.abs(z) === 0 && rim && mod(Math.round(Math.atan2(y, x) * 8), 2) === 0) c = PR.gold.dark;
        m.set(x, y + cy, z, c, VF.METAL);
      }
      if (rim) for (const z of [-2, 2]) m.set(x, y + cy, z, x + y > 0 ? PR.gold.hi : PR.gold.base, VF.METAL);
    }
  // embossed scarab both faces
  const sc = ['#.....#', '.#.#.#.', '..###..', '.#####.', '#######', '.#####.', '..###..', '.#...#.'];
  for (const z of [-2, 2])
    sc.forEach((row, i) => [...row].forEach((ch, j) => ch === '#' && m.set(-3 + j, cy + 3 - i, z, i < 3 ? PR.gold.hi : PR.gold.base, VF.METAL)));
  return S(m, IVS);
}

/** broken half of a stone ankh with gold inlay */
export function ankhFragment(): StaticModel {
  const m = new VoxelModel('ankh_fragment');
  // loop (upper part) intact, stem broken short
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    const x = Math.round(Math.cos(t) * 5), y = Math.round(Math.sin(t) * 6.5);
    m.box(x - 1, y + 22, -1, x + 1, y + 22, 1, y > 3 ? PR.lime.hi : PR.lime.base);
  }
  m.box(-10, 13, -1, 10, 15, 1, PR.lime.base);
  m.box(-10, 15, -1, 10, 15, 1, PR.lime.hi);
  m.box(-2, 3, -1, 2, 12, 1, PR.lime.base);
  // jagged break at the bottom
  for (let x = -2; x <= 2; x++) m.box(x, 0, -1, x, 2 + mod(x * 3, 3), 1, PR.lime.shade);
  // gold inlay line
  for (let a = 0; a < 40; a++) {
    const t = (a / 40) * Math.PI * 2;
    m.set(Math.round(Math.cos(t) * 5), Math.round(Math.sin(t) * 6.5) + 22, 2, PR.gold.base, VF.METAL);
  }
  m.box(-8, 14, 2, 8, 14, 2, PR.gold.base, VF.METAL);
  m.box(0, 4, 2, 0, 12, 2, PR.gold.base, VF.METAL);
  return S(m, IVS);
}

/** bundle of three dynamite sticks taped together with a twisted fuse */
export function dynamiteBundle(): StaticModel {
  const m = new VoxelModel('dynamite');
  const sticks: [number, number][] = [[-3, 0], [3, 0], [0, 3]];
  for (const [sx, sz] of sticks) {
    for (let y = 0; y <= 20; y++)
      for (let x = -2; x <= 2; x++)
        for (let z = -2; z <= 2; z++) {
          if (!inCircle(x, z, 2.2)) continue;
          const outer = !inCircle(x, z, 1.2);
          let c = outer ? (x + z > 0 ? PR.red.hi : x + z < -1 ? PR.red.shade : PR.red.base) : PR.red.base;
          if (y === 20) c = PR.paintWhite.shade;
          m.set(sx + x, y, sz + z, c);
        }
  }
  // tape bands
  for (const y of [4, 5, 15, 16]) for (let x = -6; x <= 6; x++) for (let z = -3; z <= 6; z++) if (m.has(x, y, z) && (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1))) m.set(x, y, z, PR.parchment.base);
  // TNT lettering hint (3 dark pixels) + fuse
  m.box(-1, 9, -3, 1, 9, -3, PR.ink.base);
  m.box(0, 7, -3, 0, 9, -3, PR.ink.base);
  const fuse: V3[] = [[0, 21, 1], [1, 22, 1], [1, 23, 0], [0, 24, -1], [-1, 25, -1], [-1, 26, 0]];
  for (const [x, y, z] of fuse) m.set(x, y, z, PR.rope.shade);
  m.set(-1, 27, 0, PR.ember.hi, VF.EMISSIVE);
  return S(m, IVS);
}

