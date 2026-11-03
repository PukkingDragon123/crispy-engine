// Sand-cave set dressing (1/12 – 1/32 m): glowing crystal clusters growing out of
// crusted rock, dripping stalactites and curtain drapery, melted-candle
// stalagmites with flowstone skirts, bioluminescent mushroom clumps, and the
// sinkhole pieces (spiralling sand ridges for the vortex, the dark throat).
//
// Static models: { model, voxelSize }. Origins:
//   crystals / stalagmites / mushrooms: pivot 'bottom' (ground contact).
//   stalactites: origin = the attachment point on the ceiling (mesh with pivot [0, 0, 0]),
//                the body hangs down -Y.
//   pit vortex / throat: origin = funnel centre at the rim level (pivot [0, 0, 0]).
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { Sc, M3, VF, mix, mulRGB, hash3, noise, ell, cap, tube, lumpy, hollow } from '../enemies/real/rk';
import { CRYSTAL, CrystalPal, crystal, crystalSpray, wetGlints } from './kit';

export type CrystalTone = keyof typeof CRYSTAL;

/** crusted cave rock: dark slate with sandy mineral crust and pale calcite flecks */
function caveRock(vs: number, seed: number) {
  const cell = 0.18 / vs;
  return (x: number, y: number, z: number) => {
    const n = noise.n3(x / cell + seed, y / cell, z / cell);
    const n2 = noise.n3(x / (cell * 0.4), y / (cell * 0.4) + seed, z / (cell * 0.4));
    let c = n > 0.25 ? 0x6a5a4c : n < -0.3 ? 0x3a3236 : 0x52464a;
    if (n2 > 0.45) c = mix(c, 0xb89a6c, 0.5); // sandy crust
    const h = hash3(x + seed, y, z);
    if (h < 0.02) c = 0xd8ccb8; // calcite fleck
    return c;
  };
}

/**
 * A crystal cluster growing out of a crusted rock: a central spire with satellites,
 * and a few smaller sprays leaning off the rock's shoulders.
 * size: 0 small (~0.6 m), 1 medium (~1.7 m), 2 large (~3.6 m).
 */
export function caveCrystalCluster(tone: CrystalTone, size: 0 | 1 | 2, seed = 0) {
  const vs = size === 0 ? 1 / 32 : size === 1 ? 1 / 22 : 1 / 14;
  const H = size === 0 ? 0.62 : size === 1 ? 1.7 : 3.6;
  const s = new Sc(new VoxelModel(`cave_crystal_${tone}_${size}_${seed}`), vs);
  const pal = CRYSTAL[tone];
  const alt: CrystalPal = tone === 'cyan' ? CRYSTAL.teal : tone === 'violet' ? CRYSTAL.rose : CRYSTAL.cyan;
  // the rock it grew from
  const rr = H * 0.32;
  ell(s, [0, rr * 0.25, 0], [rr, rr * 0.62, rr * 0.85], caveRock(vs, seed));
  ell(s, [rr * 0.45, rr * 0.18, -rr * 0.3], [rr * 0.6, rr * 0.45, rr * 0.55], caveRock(vs, seed + 1));
  lumpy(s.m, 3, 1, seed + 2, 0.32);
  s.m.carveWhere((_x, y) => y < 0);
  // the main spray
  crystalSpray(s, [0, rr * 0.3, 0], [0.12, 1, 0.05], H * 0.82, pal, seed * 7 + 1, size === 0 ? 4 : 6);
  // shoulder sprays
  const n = size === 0 ? 1 : size === 1 ? 3 : 4;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + hash3(seed, k, 9) * 1.2;
    const c: M3 = [Math.cos(a) * rr * 0.7, rr * 0.2, Math.sin(a) * rr * 0.6];
    const dir: M3 = [Math.cos(a) * 0.9, 0.85, Math.sin(a) * 0.9];
    crystalSpray(s, c, dir, H * (0.3 + hash3(k, seed, 1) * 0.22), k % 2 ? alt : pal, seed * 13 + k * 5, 3);
  }
  // a few loose shards fallen at the foot
  for (let k = 0; k < (size === 0 ? 1 : 4); k++) {
    const a = hash3(k, seed, 3) * Math.PI * 2, d = rr * (1.1 + hash3(seed, k, 5) * 0.5);
    crystal(s, [Math.cos(a) * d, 0, Math.sin(a) * d], [Math.cos(a + 1.3) * 0.9, 0.25, Math.sin(a + 1.3) * 0.9], H * 0.16, H * 0.035, pal, { seed: k });
  }
  if (s.m.count > 9000) hollow(s.m, 2);
  return { model: s.m, voxelSize: vs };
}

/** flowstone colour: sandy-cream limestone with darker vertical flow streaks and drip rings */
function flowstone(vs: number, seed: number, tipY: number, rootY: number) {
  const cell = 0.25 / vs;
  return (x: number, y: number, z: number) => {
    const t = Math.min(1, Math.max(0, (y - rootY) / (tipY - rootY || 1)));
    let c = mix(0x8a7864, 0xd2c0a0, Math.pow(t, 0.8));
    const streak = noise.n3(x / (cell * 0.35) + seed, y / (cell * 3), z / (cell * 0.35));
    if (streak > 0.35) c = mulRGB(c, 0.86);
    else if (streak < -0.5) c = mix(c, 0xeee2c8, 0.3);
    if (Math.abs(Math.sin((y * vs) * 9 + seed)) < 0.1) c = mulRGB(c, 0.9); // drip rings
    if (hash3(x, y + seed, z) < 0.02) c = mulRGB(c, 1.08);
    return c;
  };
}

/**
 * A stalactite hanging from the ceiling (origin = the attachment point, body down -Y).
 * variant: 0-3 cones of different length / girth, 4-5 draped curtains.
 */
export function stalactite(variant: number) {
  const v = variant % 6;
  const vs = 1 / 12;
  const s = new Sc(new VoxelModel(`stalactite_${v}`), vs);
  const seed = v * 11 + 3;
  if (v < 4) {
    const L = [3.2, 5.4, 7.8, 2.2][v];
    const R0 = [0.55, 0.8, 1.05, 0.42][v];
    const col = flowstone(vs, seed, -L, 0);
    const pts: M3[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const wob = 0.18 * t * t * L * 0.1;
      pts.push([noise.n2(seed, t * 2) * wob * 3, -t * L, noise.n2(t * 2, seed) * wob * 3]);
    }
    tube(s, pts, (t) => {
      const ring = 1 + 0.09 * Math.sin(t * L * 7.5 + seed) + 0.05 * Math.sin(t * L * 17);
      return Math.max(vs * 0.6, R0 * Math.pow(1 - t, 0.85) * ring);
    }, col);
    // a fused root flaring into the ceiling
    ell(s, [0, -0.12, 0], [R0 * 1.6, 0.35, R0 * 1.45], col);
    // a few thin soda straws beside it
    for (let k = 0; k < 3; k++) {
      const a = hash3(k, seed, 1) * 6.28, d = R0 * (1.2 + hash3(seed, k, 2) * 0.8);
      const l = L * (0.12 + hash3(k, 3, seed) * 0.2);
      cap(s, [Math.cos(a) * d, -0.1, Math.sin(a) * d], [Math.cos(a) * d, -l, Math.sin(a) * d], vs * 1.2, vs * 0.7, col);
    }
    // the wet tip: a glossy bead of water
    const tip = pts[pts.length - 1];
    ell(s, [tip[0], tip[1] + 0.02, tip[2]], [vs * 1.4, vs * 1.8, vs * 1.4], 0xe8f4f6, { fl: VF.METAL | VF.SOFTAO });
  } else {
    // drapery: a wavy curtain folding along a curve, thinning to a fringe of drips
    const L = v === 4 ? 4.2 : 6;
    const W = v === 4 ? 3.4 : 4.6;
    const col = flowstone(vs, seed, -L, 0);
    for (let i = 0; i <= Math.round(W / vs); i++) {
      const u = i * vs - W / 2;
      const zc = Math.sin(u * 2.4 + seed) * 0.35;
      const len = L * (0.55 + 0.45 * Math.abs(Math.sin(u * 1.7 + seed * 0.3))) * (1 - Math.pow(Math.abs(u) / (W / 2), 4) * 0.8);
      const th = 0.12 + 0.05 * Math.sin(u * 9);
      for (let j = 0; j <= Math.round(len / vs); j++) {
        const y = -j * vs;
        const t = j / Math.max(1, Math.round(len / vs));
        const fold = zc + Math.sin(u * 5.3 + t * 2) * 0.08;
        const thick = th * (1 - t * 0.6);
        for (let k = s.i(fold - thick); k <= s.i(fold + thick); k++) s.m.set(s.i(u), s.i(y), k, col);
      }
      // translucent fringe drip at the bottom of every fold
      if (Math.abs(Math.sin(u * 5.3)) > 0.9) s.m.set(s.i(u), s.i(-len - vs), s.i(zc), 0xeef4f2, VF.METAL | VF.SOFTAO);
    }
    ell(s, [0, -0.1, 0], [W * 0.55, 0.3, 0.6], col);
  }
  lumpy(s.m, 4, 1, seed, 0.45);
  wetGlints(s, 0.04, 0xffffff, seed);
  return { model: s.m, voxelSize: vs };
}

/** a stalagmite: stacked melted-candle lobes, a drip crater on top, a flowstone skirt */
export function stalagmite(variant: number) {
  const v = variant % 4;
  const vs = 1 / 12;
  const s = new Sc(new VoxelModel(`stalagmite_${v}`), vs);
  const seed = v * 7 + 1;
  const H = [1.6, 3.4, 5.2, 2.4][v];
  const R0 = [0.55, 0.85, 1.15, 0.7][v];
  const col = flowstone(vs, seed, H, 0);
  const lobes = 4 + v;
  for (let k = 0; k < lobes; k++) {
    const t = k / lobes;
    const r = R0 * Math.pow(1 - t, 0.9) * (0.92 + hash3(k, seed, 1) * 0.16);
    const y = t * H * 0.92 + r * 0.4;
    ell(s, [noise.n2(t * 3, seed) * R0 * 0.15, y, noise.n2(seed, t * 3) * R0 * 0.15], [r, r * 0.8, r], col);
  }
  // rounded top with a drip crater
  const topY = H;
  ell(s, [0, topY - R0 * 0.15, 0], [R0 * 0.28, R0 * 0.22, R0 * 0.28], col);
  ell(s, [0, topY + R0 * 0.02, 0], [R0 * 0.12, R0 * 0.1, R0 * 0.12], 0, { carve: true });
  // flowstone skirt: rippled rim pools around the foot
  for (let k = 0; k < 3; k++) {
    const r = R0 * (1.3 + k * 0.32);
    s.disc([0, k * 0.02, 0], r, 0.1 + 0.04 * (2 - k), 'y', col);
  }
  lumpy(s.m, 4, 1, seed, 0.4);
  s.m.carveWhere((_x, y) => y < 0);
  wetGlints(s, 0.05, 0xffffff, seed);
  if (s.m.count > 9000) hollow(s.m, 2);
  return { model: s.m, voxelSize: vs };
}

/** bioluminescent cave mushrooms: slender stems, domed speckled caps with glowing gills */
export function caveMushrooms(variant: number) {
  const v = variant % 3;
  const vs = 1 / 32;
  const s = new Sc(new VoxelModel(`cave_mushrooms_${v}`), vs);
  const seed = v * 5 + 2;
  const glowC = [0x5ff0e0, 0x9a7cff, 0x7cf0a0][v];
  const capC = [0x2c5a6a, 0x3c2c6a, 0x2a5a44][v];
  // a mossy root pad
  ell(s, [0, 0.03, 0], [0.32, 0.06, 0.28], (x, y, z) => (hash3(x, y, z) < 0.3 ? 0x3a4a3a : 0x2c3830));
  const n = 4 + v * 2;
  for (let k = 0; k < n; k++) {
    const a = hash3(k, seed, 1) * 6.28, d = hash3(seed, k, 2) * 0.26;
    const h = 0.12 + hash3(k, 3, seed) * 0.42 * (k === 0 ? 1.4 : 1);
    const cr = 0.04 + h * 0.18;
    const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
    const lean = (hash3(k, seed, 7) - 0.5) * 0.4;
    const top: M3 = [bx + lean * h, h, bz + lean * h * 0.5];
    tube(s, [[bx, 0.02, bz], [bx + lean * h * 0.4, h * 0.55, bz + lean * h * 0.2], top], (t) => Math.max(vs * 0.6, cr * 0.22 * (1 - t * 0.3)), 0xd8e4dc);
    // cap: dome, speckled, darker rim
    ell(s, [top[0], top[1] + cr * 0.25, top[2]], [cr, cr * 0.55, cr], (x, y, z) => {
      const dy = (y + 0.5) * vs - (top[1] + cr * 0.25);
      let c = mix(capC, mulRGB(capC, 1.4), Math.max(0, dy / (cr * 0.55)));
      if (hash3(x * 3, y, z * 3 + seed) < 0.08) c = mix(c, glowC, 0.7);
      return c;
    }, { keep: (_lx, ly) => ly > -0.15 });
    // glowing gills underneath
    s.disc([top[0], top[1] + cr * 0.12, top[2]], cr * 0.92, vs, 'y', glowC, VF.EMISSIVE | VF.SOFTAO);
  }
  return { model: s.m, voxelSize: vs };
}

/**
 * One spiralling sand ridge for the sinkhole vortex: a crest that winds `turns` times
 * from the rim (radius R) down into the throat, riding the funnel `profile(r)` (y offset
 * of the bowl surface at radius r, negative going down). Rotate it about Y to swirl.
 */
export function pitVortexArm(R: number, profile: (r: number) => number, arm: number, arms: number, turns = 1.6) {
  const vs = 1 / 12;
  const s = new Sc(new VoxelModel(`pit_vortex_${arm}`), vs);
  const N = 220;
  const a0 = (arm / arms) * Math.PI * 2;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const r = R * (1 - t * 0.9);
    const a = a0 + t * turns * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = profile(r);
    const crest = 0.07 + 0.22 * Math.sin(Math.PI * Math.min(1, t * 1.25));
    const w = 0.22 + 0.45 * (1 - t);
    // crest cross-section: a low triangle across the arm
    for (let q = -w; q <= w; q += vs * 0.8) {
      const px = x + Math.cos(a) * q, pz = z + Math.sin(a) * q;
      const hh = crest * (1 - Math.abs(q) / w);
      const yb = profile(Math.hypot(px, pz));
      for (let yy = yb - vs; yy <= yb + hh; yy += vs) {
        const shade = 0.75 + 0.35 * (1 - t) + (yy - yb) / Math.max(crest, 0.01) * 0.12;
        const base = t > 0.75 ? mix(0xb48a58, 0x3a2a1e, (t - 0.75) * 4) : 0xd9b27a;
        const c = mulRGB(hash3(Math.floor(px / vs), Math.floor(yy / vs), Math.floor(pz / vs)) < 0.2 ? 0xe8c890 : base, shade);
        s.m.set(s.i(px), s.i(yy), s.i(pz), c);
      }
    }
  }
  return { model: s.m, voxelSize: vs };
}

/**
 * The throat of the sinkhole: a funnel lining that pours down into darkness, ringed by
 * slumping sand shelves, with a near-black plug of shadow at the bottom (the drop).
 */
export function pitThroat(r: number, depth: number) {
  const vs = 1 / 12;
  const s = new Sc(new VoxelModel('pit_throat'), vs);
  const N = Math.round(depth / vs);
  for (let j = 0; j <= N; j++) {
    const t = j / N;
    const y = -t * depth;
    const rr = r * (1 - 0.65 * Math.pow(t, 0.7));
    const dark = Math.pow(t, 0.55);
    for (let a = 0; a < Math.PI * 2; a += vs / Math.max(rr, 0.2) * 0.8) {
      const wob = 1 + 0.08 * Math.sin(a * 5 + t * 9) + 0.05 * Math.sin(a * 13 - t * 5);
      for (let th = 0; th < 0.22; th += vs) {
        const R = rr * wob + th;
        const x = Math.cos(a) * R, z = Math.sin(a) * R;
        const ring = Math.abs(Math.sin(t * 22 + a * 0.5)) < 0.15 ? 0.85 : 1;
        const c = mulRGB(mix(0xc89c66, 0x0c0806, dark), ring);
        s.m.set(s.i(x), s.i(y), s.i(z), c, t > 0.6 ? VF.SOFTAO : undefined);
      }
    }
  }
  // the void: a dark plug that swallows the light
  s.disc([0, -depth - vs, 0], r * 0.4, vs * 2, 'y', 0x040302, VF.SOFTAO);
  return { model: s.m, voxelSize: vs };
}

/**
 * A flowstone column where a stalactite and a stalagmite grew into one: a wide
 * fluted foot spilling rimstone, a waist pinched like an hourglass and ringed with
 * melted-candle lobes, a crown that flares into the ceiling. Hollow shell (only the
 * skin is ever seen). `H` = floor-to-ceiling height (m), `R` = waist radius scale.
 * Origin = ground centre (mesh with pivot [0, 0, 0]).
 */
export function caveColumn(H: number, R: number, seed = 0) {
  const vs = 1 / 5;
  const s = new Sc(new VoxelModel(`cave_column_${seed}`), vs);
  const col = flowstone(vs, seed, H, 0);
  const rAt = (t: number, a: number) => {
    const flare = 1 + 1.1 * Math.exp(-t * 9) + 0.9 * Math.exp(-(1 - t) * 7);
    const waist = 0.6 + 0.4 * Math.abs(t - 0.52) * 2;
    const lobes = 1 + 0.09 * Math.sin(t * H * 1.3 + seed) + 0.05 * Math.sin(t * H * 3.3 + seed * 2);
    const flutes = 1 + 0.07 * Math.sin(a * 7 + t * 4 + seed) + 0.1 * noise.n3(Math.cos(a) * 1.4 + seed, Math.sin(a) * 1.4, t * 5);
    return R * flare * waist * lobes * flutes;
  };
  const N = Math.ceil(H / vs);
  const rMax = R * 2.3;
  for (let j = -2; j <= N; j++) {
    const t = Math.max(0, j / N);
    const y = j * vs;
    for (let i = -Math.ceil(rMax / vs); i <= Math.ceil(rMax / vs); i++)
      for (let k = -Math.ceil(rMax / vs); k <= Math.ceil(rMax / vs); k++) {
        const x = (i + 0.5) * vs, z = (k + 0.5) * vs;
        const d = Math.hypot(x, z);
        if (d > rMax) continue;
        const r = rAt(t, Math.atan2(z, x));
        if (d > r || d < r - vs * 3) continue;
        s.m.set(i, j, k, col);
      }
  }
  // rimstone dams spilling around the foot
  for (let k = 0; k < 3; k++) s.disc([0, k * 0.08, 0], R * (2.3 + k * 0.45), 0.14 + 0.05 * (2 - k), 'y', col, undefined, R * (2.0 + k * 0.45));
  wetGlints(s, 0.03, 0xffffff, seed);
  return { model: s.m, voxelSize: vs };
}
