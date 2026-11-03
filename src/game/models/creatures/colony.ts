// The meerkat colony set: an organic sandy warren mound with eight burrow
// holes (four for the colony, four for the band) that read as deep tunnels —
// raised spoil heaps with kicked-out sand fans, crumbly lips, walls that fade
// to black and a dark floor plug deep inside — plus pebbles, dry grass tufts,
// a layered sandstone lookout rock, and the colony's tiny trading stall (two
// plank crates under a counter board, a sagging striped awning on crooked
// sticks with a scalloped valance, jars, a brass balance, bundles and a sack).
//
// meerkatWarrenModel(): 1/32 m, origin = colony centre ON THE GROUND (y = 0),
//   faces +Z. Not 'bottom'-pivoted: the skirt and shafts reach below y = 0 —
//   mesh it with pivot [0, 0, 0]. meta.holes / meta.rockTop / meta.stall give
//   the gameplay layout (metres, colony-local), meta.surfaceY(x, z) the voxel
//   top of the mound.
// meerkatStallModel(): 1/96 m, pivot 'bottom' ≈ origin (stall centre on the
//   ground), counter along X, customers on +Z. meta.counterTop / meta.trader.
import { VoxelModel, VF, V3, ell, cap, tube, line, blob, Prim, vessel, sheet, mixc, mulc, n01, h01, sstep, memoBy } from './ckit';
import { noise, RNG } from '../../../engine/math/rand';

// ================================================================ layout (metres, colony-local, +Z = front)
export interface BurrowHole {
  x: number;
  z: number;
  role: 'colony' | 'band';
  /** yaw of the kicked-out sand fan */
  fan: number;
  peak: number;
  /** filled in by the build: rim height (top of the opening) and the dark floor plug */
  rim: number;
  plug: number;
}
export const WARREN_HOLES: Omit<BurrowHole, 'rim' | 'plug'>[] = [
  { x: -1.35, z: -0.55, role: 'colony', fan: Math.atan2(-0.8, 0.5), peak: 0.4 },
  { x: -0.45, z: -1.2, role: 'colony', fan: Math.atan2(-0.15, -1), peak: 0.42 },
  { x: 0.78, z: -0.85, role: 'colony', fan: Math.atan2(0.7, -0.7), peak: 0.39 },
  { x: -0.4, z: 0.06, role: 'colony', fan: Math.atan2(0.3, 1), peak: 0.41 },
  { x: -0.98, z: 1.1, role: 'band', fan: -0.12, peak: 0.37 },
  { x: -0.4, z: 1.36, role: 'band', fan: -0.04, peak: 0.37 },
  { x: 0.2, z: 1.42, role: 'band', fan: 0.04, peak: 0.37 },
  { x: 0.78, z: 1.3, role: 'band', fan: 0.12, peak: 0.37 },
];
export const WARREN_ROCK = { x: -1.95, z: -1.35 };
/** where the stall stands (colony-local) and its yaw */
export const WARREN_STALL = { x: 1.66, z: 1.08, rot: -0.14 };
const SHAFT_DEPTH = 0.31;
const SHAFT_R = 0.094;

const smaxP = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1e-6)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/** analytic mound height (metres) before voxelisation and shaft carving */
export function warrenHeight(x: number, z: number) {
  // the main dome: a low, wobbly-edged mound
  const dx = (x + 0.35) / 1.85, dz = (z + 0.45) / 1.38;
  const ang = Math.atan2(dz, dx);
  const wob = 1 + 0.1 * noise.n2(Math.cos(ang) * 1.4 + 3, Math.sin(ang) * 1.4) + 0.05 * noise.n2(Math.cos(ang) * 3, Math.sin(ang) * 3 + 7);
  const rr = Math.hypot(dx, dz) / wob;
  let h = rr < 1 ? 0.21 * Math.pow(1 - rr * rr, 1.3) : 0;
  // a low ridge joining the band burrows in front
  const band = WARREN_HOLES.filter((q) => q.role === 'band');
  let rd = 1e9;
  for (let i = 0; i < band.length - 1; i++) rd = Math.min(rd, segDist(x, z, band[i].x, band[i].z, band[i + 1].x, band[i + 1].z));
  rd = Math.min(rd, segDist(x, z, band[0].x, band[0].z, -1.2, 0.35));
  h = smaxP(h, 0.12 * Math.exp(-((rd / 0.36) ** 2)), 0.06);
  // spoil heaps around every hole, with the kicked-out sand fan
  for (const q of WARREN_HOLES) {
    const ex = x - q.x, ez = z - q.z, d = Math.hypot(ex, ez);
    let y = d < 0.17 ? q.peak : q.peak * Math.exp(-(((d - 0.17) / 0.34) ** 2));
    y += 0.022 * Math.exp(-(((d - 0.13) / 0.03) ** 2)); // crumbly lip
    const fx = Math.sin(q.fan), fz = Math.cos(q.fan);
    const along = ex * fx + ez * fz, side = -ex * fz + ez * fx;
    if (along > 0) y = Math.max(y, q.peak * 0.56 * Math.exp(-(((along - 0.33) / 0.27) ** 2) - (side / 0.21) ** 2));
    h = smaxP(h, y, 0.06);
  }
  // hand-placed undulation (only on the mound)
  h += (0.012 * noise.n2(x * 2.6, z * 2.6) + 0.005 * noise.n2(x * 8.5 + 3, z * 8.5)) * sstep(0.01, 0.06, h);
  return h;
}

// ================================================================ warren model
const WVS = 1 / 32;
const SKIRT = 6; // voxels below ground so the mound sits into slopes
const SAND = { packed: 0xe4c28c, fresh: 0xd4a268, damp: 0xb98a58, edge: 0xe0b373, deep: 0xb48c5c, grainD: 0xc49660, grainL: 0xf2dcae };
const STONES = [0x9b8b78, 0x7d6b5a, 0xb9a688, 0x6b5444, 0xc8b49a, 0xa08c70];

function buildWarren() {
  const m = new VoxelModel('meerkat_warren');
  const vs = WVS;
  const f = 1 / vs;
  const holeNear = (x: number, z: number) => {
    let d = 1e9;
    for (const q of WARREN_HOLES) d = Math.min(d, Math.hypot(x - q.x, z - q.z));
    return d;
  };
  // ---- columns
  const top = new Map<number, number>();
  const ck = (i: number, k: number) => (i + 512) * 2048 + (k + 512);
  for (let i = Math.floor(-2.6 * f); i <= Math.ceil(2.1 * f); i++)
    for (let k = Math.floor(-2.25 * f); k <= Math.ceil(2.15 * f); k++) {
      const x = (i + 0.5) * vs, z = (k + 0.5) * vs;
      const H = warrenHeight(x, z);
      if (H < 0.012) continue;
      const jTop = Math.floor(H * f - 0.5);
      top.set(ck(i, k), jTop);
      const dh = holeNear(x, z);
      const fresh = sstep(0.55, 0.18, dh);
      const edge = sstep(0.07, 0.015, H);
      for (let j = -SKIRT; j <= jTop; j++) {
        const depth = jTop - j;
        let c: number;
        if (depth > 2) c = SAND.deep;
        else {
          c = mixc(SAND.packed, SAND.fresh, fresh * 0.85);
          if (dh < 0.24) c = mixc(c, SAND.damp, sstep(0.24, 0.12, dh) * 0.6);
          c = mixc(c, SAND.edge, edge);
          const g = h01(i, j, k, 7);
          if (g < 0.035) c = SAND.grainD;
          else if (g > 0.975) c = SAND.grainL;
          else c = mulc(c, 0.97 + n01(i, j, k, 0.35, 2) * 0.06 - depth * 0.03);
        }
        m.set(i, j, k, c);
      }
    }
  const surfaceY = (x: number, z: number) => {
    const t = top.get(ck(Math.floor(x * f), Math.floor(z * f)));
    return t === undefined ? 0 : (t + 1) * vs;
  };

  // ---- burrow shafts: flared mouth, slight lean, walls fading to black, a dark floor plug
  const holes: BurrowHole[] = WARREN_HOLES.map((q) => {
    const rim = surfaceY(q.x, q.z);
    return { ...q, rim, plug: rim - SHAFT_DEPTH };
  });
  for (const q of holes) {
    const lx = -Math.sin(q.fan) * 0.12, lz = -Math.cos(q.fan) * 0.12; // the tunnel leans away from its fan
    const j0 = Math.floor(q.plug * f) - 1, j1 = Math.ceil((q.rim + 0.08) * f);
    const R = Math.ceil((SHAFT_R + 0.06) * f) + 3;
    const ci = Math.floor(q.x * f), ckk = Math.floor(q.z * f);
    const shaft = (i: number, j: number, k: number, grow = 0) => {
      const y = (j + 0.5) * vs;
      const dep = Math.max(0, q.rim - y);
      const ax = q.x + lx * dep, az = q.z + lz * dep;
      const r = SHAFT_R + 0.03 * Math.exp(-dep / 0.035) + grow + 0.006 * noise.n2(Math.atan2((k + 0.5) * vs - az, (i + 0.5) * vs - ax) * 2, j * 0.3);
      return Math.hypot((i + 0.5) * vs - ax, (k + 0.5) * vs - az) < r;
    };
    for (let i = ci - R; i <= ci + R; i++)
      for (let k = ckk - R; k <= ckk + R; k++)
        for (let j = j0; j <= j1; j++) {
          const y = (j + 0.5) * vs;
          if (y > q.plug && shaft(i, j, k)) {
            m.del(i, j, k);
            continue;
          }
          if (!m.has(i, j, k)) continue;
          const dep = q.rim - y;
          // walls: anything within ~1.5 voxels of the shaft, coloured by depth
          if (y > q.plug - vs * 1.5 && shaft(i, j, k, vs * 1.6)) {
            const t = sstep(0.0, 0.26, dep);
            let c = mixc(mixc(SAND.damp, 0x8a6440, sstep(0, 0.06, dep)), 0x140d08, t);
            if (y <= q.plug) c = 0x0e0906; // the floor plug, swallowed by shadow
            else if (h01(i, j, k, 13) < 0.08 && dep < 0.12) c = mulc(c, 0.82); // root fibres / crumbs
            m.set(i, j, k, c);
          }
        }
    // crumbs of kicked-out sand on the lip
    const rng = new RNG(Math.floor(q.x * 100 + q.z * 1000) + 77);
    for (let n = 0; n < 7; n++) {
      const a = rng.next() * Math.PI * 2, d = 0.14 + rng.next() * 0.12;
      const x = q.x + Math.sin(a) * d, z = q.z + Math.cos(a) * d;
      m.set(Math.floor(x * f), Math.floor(surfaceY(x, z) * f), Math.floor(z * f), rng.chance(0.5) ? SAND.fresh : SAND.damp);
    }
  }

  // ---- the lookout rock: layered sandstone with ledges, cracks and a weathered, flat-ish top
  {
    const rx = WARREN_ROCK.x, rz = WARREN_ROCK.z;
    const prims: Prim[] = [
      { c: [rx * f, 0.32 * f, rz * f], r: [0.58 * f, 0.42 * f, 0.5 * f], rot: [0, 0.3, 0] },
      { c: [(rx + 0.05) * f, 0.7 * f, (rz - 0.04) * f], r: [0.44 * f, 0.32 * f, 0.4 * f], rot: [0, 0.5, 0.06] },
      { c: [(rx + 0.08) * f, 0.97 * f, (rz - 0.06) * f], r: [0.34 * f, 0.15 * f, 0.31 * f] },
      { c: [(rx - 0.52) * f, 0.18 * f, (rz + 0.32) * f], r: [0.3 * f, 0.24 * f, 0.28 * f], rot: [0, -0.4, 0.1] },
    ];
    const strata = [0xd9a46a, 0xc68c56, 0xe3b47c, 0xb47c4c, 0xdcaa72, 0xcb945e];
    blob(m, prims, (i, j, k) => {
      const y = (j + 0.5) * vs + 0.025 * noise.n2(i * 0.12, k * 0.12);
      let c = strata[Math.floor(y / 0.105) % strata.length];
      if (Math.abs(noise.n3(i * 0.18, j * 0.05, k * 0.18)) < 0.035) c = 0x8c5c38; // vertical cracks
      if (y > 1.02) c = mixc(c, 0xf0d0a0, 0.35); // sun-bleached top
      return mulc(c, 0.97 + h01(i, j, k, 3) * 0.06);
    }, {
      k: 0.12 * f,
      disp: (x, y, z) => {
        const ym = y * vs;
        const ledge = Math.max(0, Math.sin((ym / 0.105) * Math.PI * 2)) * 0.9; // eroded strata ledges
        const under = ym < 0.16 ? (0.16 - ym) * f * 0.35 : 0; // undercut base
        return ledge + under + noise.n3(x * 0.15, y * 0.15, z * 0.15) * 0.9;
      },
      keep: (_i, j) => (j + 0.5) * vs < 1.085 && j >= -SKIRT,
    });
  }
  // the rock-top perch: highest voxel near the rock top centre
  let rockTop: V3 = [WARREN_ROCK.x + 0.08, 1.08, WARREN_ROCK.z - 0.06];
  {
    const ci = Math.floor(rockTop[0] * f), ckk = Math.floor(rockTop[2] * f);
    let best = -1e9;
    for (let j = Math.ceil(1.2 * f); j > 0; j--) if (m.has(ci, j, ckk)) {
      best = j;
      break;
    }
    if (best > 0) rockTop = [rockTop[0], (best + 1) * vs, rockTop[2]];
  }

  // ---- pebbles and dry grass tufts
  const rng = new RNG(4242);
  for (let n = 0; n < 54; n++) {
    const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next());
    const x = -0.35 + Math.cos(a) * d * 2.3, z = -0.2 + Math.sin(a) * d * 1.85;
    if (holeNear(x, z) < 0.24 || Math.hypot(x - WARREN_ROCK.x, z - WARREN_ROCK.z) < 0.62) continue;
    if (Math.hypot(x - WARREN_STALL.x, z - WARREN_STALL.z) < 0.55) continue;
    const r = 0.03 + rng.next() * 0.035;
    const y = surfaceY(x, z);
    const col = STONES[Math.floor(rng.next() * STONES.length)];
    ell(m, [x * f, y * f + r * f * 0.25, z * f], [r * f, r * f * 0.72, r * f * (0.8 + rng.next() * 0.4)], (i, j, k) => (h01(i, j, k, 8) < 0.2 ? mulc(col, 0.86) : j * vs > y + r * 0.3 ? mixc(col, 0xffffff, 0.12) : col), { rot: [0, rng.next() * 3, 0] });
  }
  const tuftSpots: [number, number][] = [[-2.3, 0.1], [-2.0, 0.75], [-1.5, 1.45], [1.25, -0.2], [1.45, 0.3], [0.25, -1.75], [-1.1, -1.65], [-2.55, -0.65], [-1.45, -1.95], [1.25, -1.15], [-2.45, -1.75], [0.55, 1.95], [-0.2, 1.9], [1.05, 1.85]];
  for (const [tx, tz] of tuftSpots) {
    const blades = 5 + Math.floor(rng.next() * 4);
    const y0 = surfaceY(tx, tz);
    for (let b = 0; b < blades; b++) {
      const a = rng.next() * Math.PI * 2, lean = 0.05 + rng.next() * 0.09, hgt = 0.12 + rng.next() * 0.14;
      const bx = tx + Math.cos(a) * 0.03, bz = tz + Math.sin(a) * 0.03;
      const pts: V3[] = [
        [bx * f, y0 * f, bz * f],
        [(bx + Math.cos(a) * lean * 0.4) * f, (y0 + hgt * 0.6) * f, (bz + Math.sin(a) * lean * 0.4) * f],
        [(bx + Math.cos(a) * lean) * f, (y0 + hgt) * f, (bz + Math.sin(a) * lean) * f],
      ];
      const straw = [0xc9b46e, 0xb09a58, 0xd8c88a][b % 3];
      line(m, pts, (_i, j) => ((j + 0.5) * vs < y0 + 0.04 ? 0x8a9450 : straw));
    }
  }

  return { model: m, voxelSize: WVS, meta: { holes, rockTop, stall: WARREN_STALL, surfaceY, pivot: [0, 0, 0] as V3 } };
}

// ================================================================ the trading stall
const SVS = 1 / 96;
const WOOD = [0xb08a5a, 0xa27c4e, 0xbc966a, 0x9a7248, 0xb48e5e];

function buildStall() {
  const m = new VoxelModel('meerkat_stall');
  const f = 1 / SVS;
  const V = (x: number, y: number, z: number): V3 => [x * f, y * f, z * f];
  const rng = new RNG(919);
  // ---- two plank crates side by side under the counter
  const crate = (x0: number, x1: number, seed: number) => {
    const y0 = 0, y1 = 0.2, z0 = -0.12, z1 = 0.12;
    const i0 = Math.floor(x0 * f), i1 = Math.floor(x1 * f) - 1, j0 = 0, j1 = Math.floor(y1 * f) - 1, k0 = Math.floor(z0 * f), k1 = Math.floor(z1 * f) - 1;
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (let k = k0; k <= k1; k++) {
          const shell = i <= i0 + 1 || i >= i1 - 1 || k <= k0 + 1 || k >= k1 - 1 || j === j0 || j === j1;
          if (!shell) continue;
          const onFace = i === i0 || i === i1 || k === k0 || k === k1;
          const plank = Math.floor((j + 0.5) / (0.05 * f));
          const gap = ((j + 1) % Math.round(0.05 * f)) === 0 && j < j1 - 1 && onFace;
          const corner = (i <= i0 + 2 || i >= i1 - 2) && (k <= k0 + 2 || k >= k1 - 2);
          let c = WOOD[(plank + seed) % WOOD.length];
          if (corner) c = mulc(c, 0.78);
          else if (gap) c = 0x3a2614;
          else {
            const grain = noise.n2(i * 0.08 + plank * 3.1, k * 0.08 + seed) + Math.sin((j + plank) * 2.1 + i * 0.05) * 0.2;
            if (grain > 0.45) c = mulc(c, 0.88);
            else if (grain < -0.5) c = mixc(c, 0xe0c290, 0.25);
          }
          m.set(i, j, k, c);
        }
    // corner battens stand a voxel proud, with iron nails on every plank
    for (const ii of [i0 - 1, i1 + 1]) for (const kk of [k0, k1]) for (let j = j0; j <= j1; j++) m.set(ii, j, kk, mulc(WOOD[seed % WOOD.length], 0.72));
    for (let p = 0; p < 4; p++) {
      const jy = Math.floor((p * 0.05 + 0.025) * f);
      for (const ii of [i0 + 1, i1 - 1]) m.set(ii, jy, k1 + 1, 0x3a3634, VF.METAL);
    }
  };
  crate(-0.33, -0.015, 0);
  crate(0.015, 0.33, 2);
  // ---- counter board: two warped planks overhanging the crates, worn corners
  for (let i = Math.floor(-0.38 * f); i < Math.floor(0.38 * f); i++)
    for (let k = Math.floor(-0.15 * f); k < Math.floor(0.16 * f); k++) {
      const warp = Math.round(Math.sin(((i * SVS) / 0.76) * Math.PI) * 0.6);
      const chip = (Math.abs(i * SVS) > 0.36 && Math.abs(k * SVS) > 0.13) || h01(i, 0, k, 4) < 0.006;
      if (chip) continue;
      for (let j = Math.floor(0.2 * f); j < Math.floor(0.226 * f) + warp; j++) {
        const seam = k === 0;
        const c = seam ? 0x5a3c22 : mulc(k < 0 ? 0xc6a070 : 0xb89260, 0.94 + n01(i, j, k, 0.18, 6) * 0.1);
        m.set(i, j, k, c);
      }
    }
  const counterTopJ = Math.floor(0.226 * f) - 1;
  // ---- crooked stick poles + twine lashings
  const poles: [V3, V3][] = [
    [V(0.36, 0, -0.13), V(0.37, 0.645, -0.15)],
    [V(-0.36, 0, -0.13), V(-0.37, 0.645, -0.15)],
    [V(0.38, 0, 0.215), V(0.39, 0.535, 0.24)],
    [V(-0.38, 0, 0.215), V(-0.39, 0.535, 0.24)],
  ];
  for (const [a, b] of poles) {
    const mid: V3 = [(a[0] + b[0]) / 2 + (rng.next() - 0.5) * 2.4, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + (rng.next() - 0.5) * 2];
    tube(m, [a, mid, b], [1.3, 1.1, 1.0], (i, j, k) => (h01(i, j, k, 11) < 0.07 ? 0x4a3220 : j % 9 === 0 ? 0x7a5636 : 0x6a4a2e));
    for (let t = 0; t < 3; t++) ell(m, [b[0], b[1] - 2 - t * 1.1, b[2]], [1.7, 0.6, 1.7], 0xd8c088);
  }
  // ---- the striped awning, sagging between the pole tops, with a scalloped valance
  const RED = 0xc6402e, REDD = 0xa2321f, CREAM = 0xf2e2c2, CREAMD = 0xdcc8a0;
  const stripe = (u: number) => Math.floor(u * 12) & 1;
  sheet(m, V(0.38, 0.655, -0.16), V(-0.38, 0.655, -0.16), V(0.4, 0.545, 0.25), V(-0.4, 0.545, 0.25), (u, v) => {
    const s = stripe(u);
    const shade = v > 0.85 ? 0.92 : 1;
    return mulc(s ? RED : CREAM, shade);
  }, { sag: 2.2, ripple: 0.45, thick: 2, res: 0.35, seed: 31 });
  for (let i = Math.floor(-0.4 * f); i < Math.floor(0.4 * f); i++) {
    const u = 1 - (i * SVS + 0.4) / 0.8;
    const seg = u * 12;
    const fr = seg - Math.floor(seg);
    const s = Math.floor(seg) & 1;
    const len = 2 + Math.round(Math.sqrt(Math.max(0, 1 - (fr * 2 - 1) ** 2)) * 3.2); // rounded scallop bottoms
    const sagY = 0.545 - 0.022 * 4 * u * (1 - u) * 0.55;
    const yTop = Math.floor(sagY * f) - 1;
    for (let t = 0; t < len; t++) m.set(i, yTop - t, Math.floor(0.252 * f), t === len - 1 ? (s ? REDD : CREAMD) : s ? RED : CREAM);
  }
  // ---- goods on the counter (the centre stays clear for the trade)
  const cy = counterTopJ + 1;
  // terracotta jar with a cream band and a cork
  vessel(m, V(0.29, 0, -0.07).map((v, n) => (n === 1 ? cy : v)) as V3, [3.2, 3.8, 4.1, 4.2, 4.1, 3.8, 3.3, 2.6, 2.0, 1.9, 2.1], (row) => (row === 4 || row === 5 ? 0xead6b0 : row >= 9 ? 0xa0522e : 0xb8643a), { seed: 3 });
  ell(m, [0.29 * f, cy + 11.4, -0.07 * f], [1.6, 1.0, 1.6], 0x9a7a52);
  // amber honey jar with a cloth cover tied with twine
  vessel(m, [0.215 * f, cy, -0.095 * f], [2.4, 2.7, 2.8, 2.8, 2.7, 2.4, 2.0], (row, x, z, a) => (Math.cos(a) > 0.55 && row > 1 && row < 5 ? 0xfff0b0 : row >= 5 ? 0xd88a20 : 0xe8a030), { seed: 5, fl: VF.METAL });
  ell(m, [0.215 * f, cy + 7.2, -0.095 * f], [2.9, 0.9, 2.9], 0xeadcc0);
  for (let a = 0; a < 12; a++) m.set(Math.floor(0.215 * f + Math.cos(a / 1.9) * 2.6), cy + 6, Math.floor(-0.095 * f + Math.sin(a / 1.9) * 2.6), 0xb89a5a);
  // woven basket of plump grubs (meerkat treats)
  vessel(m, [-0.27 * f, cy, -0.06 * f], [3.0, 3.6, 3.9, 4.1, 4.2], (row, x, z, a) => ((row + Math.floor((a + 4) * 3)) & 1 ? 0xb89058 : 0x96703e), { seed: 8, hollowTop: 1 });
  for (let g = 0; g < 7; g++) {
    const a = g * 0.9, d = g === 0 ? 0 : 2.2;
    ell(m, [-0.27 * f + Math.cos(a) * d, cy + 4.6, -0.06 * f + Math.sin(a) * d], [1.3, 0.9, 1.1], (i, j) => (j % 2 ? 0xf2e6c8 : 0xe2d2ae), { rot: [0, a, 0] });
  }
  // little brass balance scale
  {
    const bx = -0.17 * f, bz = -0.085 * f;
    ell(m, [bx, cy + 0.5, bz], [2.4, 0.7, 2.0], 0xb88a2c, { fl: VF.METAL });
    cap(m, [bx, cy, bz], [bx, cy + 9, bz], 0.6, 0.5, 0xd8a640, { fl: VF.METAL });
    line(m, [[bx - 4.5, cy + 9.2, bz], [bx + 4.5, cy + 8.6, bz]], 0xe8b850, VF.METAL);
    for (const [px, py] of [[-4.5, 9.2], [4.5, 8.6]] as [number, number][]) {
      line(m, [[bx + px, cy + py, bz], [bx + px, cy + py - 4, bz]], 0x8a6a2a);
      ell(m, [bx + px, cy + py - 4.4, bz], [1.8, 0.5, 1.8], 0xd8a640, { fl: VF.METAL });
    }
  }
  // ---- on the ground: a burlap sack spilling seeds, cloth bundles, a sheaf of dry grass
  {
    const sx = 0.42 * f, sz = -0.02 * f;
    blob(m, [{ c: [sx, 7, sz], r: [6, 7.5, 5.4] }, { c: [sx, 15, sz], r: [3, 3, 2.8] }], (i, j, k) => (((i + j * 2 + k) & 3) === 0 ? 0x9a7e52 : j > 13 && j < 15 ? 0x6a5030 : 0xb89a6a), { k: 2.5, keep: (_i, j) => j >= 0 });
    for (let s = 0; s < 9; s++) m.set(Math.floor(sx + 5 + s * 0.6), 0, Math.floor(sz + 5 + Math.sin(s * 2) * 2), s & 1 ? 0xd8b060 : 0xa87a3a);
  }
  for (const [bx, bz, by, col, rot] of [[-0.46, 0.04, 0, 0x41507e, 0.3], [-0.45, 0.07, 6.5, 0xc8903a, -0.4]] as [number, number, number, number, number][]) {
    blob(m, [{ c: [bx * f, by + 4.6, bz * f], r: [6.2, 4.6, 5], rot: [0, rot, 0] }], (i, j, k) => (Math.abs(((i - bx * f) * Math.cos(rot) - (k - bz * f) * Math.sin(rot))) < 0.8 ? 0xd8c088 : mulc(col, j % 3 === 0 ? 0.9 : 1)), { k: 2, keep: (_i, j) => j >= 0 });
  }
  for (let b = 0; b < 9; b++) {
    const ox = 0.3 + (b % 3) * 0.012, oz = 0.15 + Math.floor(b / 3) * 0.012;
    line(m, [V(ox + 0.04, 0, oz), V(ox + 0.02, 0.18, oz + 0.02), V(ox - 0.01, 0.26, oz + 0.03)], b % 2 ? 0xc9b46e : 0xd8c88a);
  }
  line(m, [V(0.29, 0.07, 0.16), V(0.35, 0.07, 0.18)], 0xb89a5a);

  return {
    model: m,
    voxelSize: SVS,
    meta: {
      counterTop: (counterTopJ + 1) * SVS,
      /** offer spots on the counter (stall-local metres): give items in front, prizes behind */
      offers: [-0.14, 0.0, 0.14].map((x) => ({ give: [x, 0, 0.075] as V3, get: [x, 0, -0.045] as V3 })),
      trader: [0, 0, -0.27] as V3,
      footprint: [0.9, 0.55],
    },
  };
}

export type WarrenBuild = ReturnType<typeof buildWarren>;
export type StallBuild = ReturnType<typeof buildStall>;
const warrenMemo = memoBy(() => 'w', buildWarren);
const stallMemo = memoBy(() => 's', buildStall);
/** the warren mound (see header for its pivot) */
export function meerkatWarrenModel(): WarrenBuild {
  return warrenMemo(undefined);
}
/** the colony's tiny trading stall */
export function meerkatStallModel(): StallBuild {
  return stallMemo(undefined);
}
