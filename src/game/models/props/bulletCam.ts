// Sculpted pieces for the rank-up bullet-cam (src/game/fx/BulletCam.ts):
//  - bulletRound(): a jacketed .45 soft-point, nose along +Z. Copper jacket with
//    six helical rifling grooves engraved by the barrel (bright fresh copper on
//    the land edges), a knurled crimp groove, a serrated jacket mouth over the
//    exposed lead tip and a heel still glowing from the powder burn.
//  - boneShard(seed, kind): a splinter blown out of an exit wound. Faceted
//    fracture planes, a smooth outer cortex on one face, porous diploe and
//    marrow (or sand, linen dust, chitin and ichor) on the broken faces.
//  - skullStake(seed): the fallback target when nothing is in range: a bleached
//    longhorn skull hung on a split, weathered stake with a rope lashing, sand
//    drifted round its foot. Skull and stake are separate so the skull can burst.
// All authored directly on their final grids (no resampling).
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { hash3, RNG } from '../../../engine/math/rand';
import { TOON } from '../style';
import { PR, mixRGB, sandDrift, type StaticModel } from './helpers';

// ------------------------------------------------------------------ the round

/** voxel size of the round: 26 voxels long ~ 6 cm (about twice life size, so it reads in the chase shot) */
export const BULLET_VS = 1 / 430;
export const BULLET_LEN = 26 * BULLET_VS;
export const BULLET_R = 5.6 * BULLET_VS;

const COPPER = { base: 0xc4733c, shade: 0x96522a, hi: 0xeba062, fresh: 0xffcf98, deep: 0x6a3418 };
const LEAD = { base: 0x868a92, shade: 0x62666e, hi: 0xb2b8c0 };

export function bulletRound(): StaticModel {
  const m = new VoxelModel('bullet_round');
  const L = 26, R = 5.6, NG = 6;
  const TAU = Math.PI * 2;
  for (let z = 0; z < L; z++) {
    const zc = z + 0.5;
    let r: number;
    if (zc < 1) r = R - 1.15; // boat-tail bevel at the heel
    else if (zc < 2) r = R - 0.45;
    else if (zc < 12.5) r = R;
    else {
      // tangent ogive to a small flat meplat
      const k = (zc - 12.5) / 14.2;
      r = Math.max(1.25, R * Math.sqrt(Math.max(0, 1 - k * k)));
    }
    const Ri = Math.ceil(r) + 1;
    for (let x = -Ri; x < Ri; x++)
      for (let y = -Ri; y < Ri; y++) {
        const px = x + 0.5, py = y + 0.5;
        const d = Math.hypot(px, py);
        const a = Math.atan2(py, px);
        const u = (a / TAU + 1) % 1;
        // rifling: six lands engraved into the bearing surface, twisting along the length
        const bearing = zc >= 2 && zc < 12.5;
        const gp = (((u * NG + zc * 0.055) % 1) + 1) % 1;
        const groove = bearing && gp < 0.2;
        const edge = bearing && !groove && gp < 0.3;
        // the crimp groove (cannelure)
        const cann = zc >= 9 && zc < 10.5;
        let rr = r;
        if (groove) rr -= 0.8;
        if (cann) rr -= 0.65;
        if (d > rr) continue;
        const surf = d > rr - 1.15;
        // the jacket mouth: serrated skive petals over the soft lead nose
        const mouth = 18.6 + 0.9 * Math.sin(u * TAU * 6);
        let c: number;
        let f: number = VF.METAL;
        if (z === 0) {
          // the heel, still hot from the powder burn: an ember core cooling to a sooty rim
          const k = d / (R - 1.15);
          c = k < 0.24 ? 0xffc47a : k < 0.48 ? 0xd86a30 : k < 0.8 ? COPPER.deep : 0x4a2c20;
          f = k < 0.48 ? VF.EMISSIVE : VF.METAL;
        } else if (zc >= mouth) {
          // exposed lead: soft, darker where the jacket bites, bright at the very tip
          c = zc < mouth + 1 ? LEAD.shade : zc > L - 1.6 ? LEAD.hi : LEAD.base;
        } else if (cann && surf) {
          // knurled crimp: a checker of struck dots
          c = (Math.round(u * 36) + z) % 2 ? COPPER.deep : COPPER.hi;
        } else if (groove && surf) c = COPPER.shade;
        else if (edge && surf) c = COPPER.fresh;
        else if (zc < 2 && surf) c = COPPER.shade;
        else c = surf && zc > 14 && zc < mouth - 1 ? COPPER.hi : COPPER.base;
        m.set(x, y, z, c, f);
      }
  }
  return { model: m, voxelSize: BULLET_VS };
}

// ------------------------------------------------------------------ bone shards

export type ShardKind = 'blood' | 'sand' | 'dust' | 'ichor' | 'acid' | 'skull';

interface ShardPal {
  cortex: [number, number, number];
  diploe: number;
  pit: number;
  wet: number[];
}
const PALS: Record<ShardKind, ShardPal> = {
  blood: { cortex: [TOON.bone.hi, TOON.bone.base, TOON.bone.shade], diploe: 0xe6c79a, pit: 0xb07a5a, wet: [0x8a1010, 0xb82020, 0x6a0808] },
  sand: { cortex: [TOON.bone.hi, TOON.bone.base, TOON.bone.shade], diploe: 0xe8cc98, pit: 0xc79a5c, wet: [TOON.sand.base, TOON.sand.shade, 0xb88a50] },
  dust: { cortex: [0xeedfb8, 0xd8c294, 0xb8a070], diploe: 0xd2b888, pit: 0x8a7656, wet: [0x5a4630, 0xd8ccb0, TOON.bandage.shade] },
  ichor: { cortex: [0x5a4a34, 0x3e3224, 0x2a2018], diploe: 0xc8b890, pit: 0x6fbf2a, wet: [0x9dff3a, 0x6fbf2a, 0x4a8a1a] },
  acid: { cortex: [TOON.bone.hi, TOON.bone.base, TOON.bone.shade], diploe: 0xe6c79a, pit: 0x6fbf2a, wet: [0x9dff3a, 0xb8f05c, 0x8a1010] },
  skull: { cortex: [TOON.bone.hi, TOON.bone.base, TOON.bone.shade], diploe: 0xe8d0a4, pit: 0xb89a6a, wet: [TOON.sand.base, 0xd9b276, TOON.bone.shade] },
};

export const SHARD_VS = 1 / 150;

/**
 * A splinter of skull: a jagged convex chunk cut by random fracture planes, long
 * along Z. The +Y face keeps the smooth outer bone; every broken face shows the
 * spongy layer, pitted, wet with whatever this creature bleeds.
 */
export function boneShard(seed: number, kind: ShardKind): StaticModel {
  const rng = new RNG(0x51ed + seed * 7919);
  const P = PALS[kind];
  const m = new VoxelModel('bone_shard');
  const len = rng.range(4.5, 9), wid = rng.range(2.2, 3.8), thick = rng.range(1.6, 2.6);
  // fracture planes (normal, offset): a lozenge with random bevels
  const planes: [number, number, number, number][] = [];
  const n = 7 + rng.int(0, 4);
  for (let i = 0; i < n; i++) {
    const th = rng.range(0, Math.PI * 2), ph = rng.range(-0.9, 0.9);
    const nx = Math.cos(th) * Math.cos(ph), ny = Math.sin(ph), nz = Math.sin(th) * Math.cos(ph);
    // support of the ellipsoid along the normal, pulled in a little
    const s = Math.sqrt((nx * wid) ** 2 + (ny * thick) ** 2 + (nz * len) ** 2) * rng.range(0.62, 0.86);
    planes.push([nx, ny, nz, s]);
  }
  const X = Math.ceil(wid), Y = Math.ceil(thick), Z = Math.ceil(len);
  const inside = (x: number, y: number, z: number) => {
    const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
    if ((px / wid) ** 2 + (py / thick) ** 2 + (pz / len) ** 2 > 1.05) return false;
    for (const [a, b, c, s] of planes) if (a * px + b * py + c * pz > s) return false;
    return true;
  };
  for (let x = -X; x <= X; x++)
    for (let y = -Y; y <= Y; y++)
      for (let z = -Z; z <= Z; z++) {
        if (!inside(x, y, z)) continue;
        const top = !inside(x, y + 1, z);
        const h = hash3(x * 13 + seed, y * 7, z * 11);
        let c: number;
        if (top && y >= 0) c = h < 0.3 ? P.cortex[0] : P.cortex[1]; // smooth outer table
        else if (y === -Y || !inside(x, y - 1, z)) c = P.cortex[2]; // inner table
        else c = h < 0.2 ? P.pit : h < 0.27 ? P.wet[(h * 97) % P.wet.length | 0] : P.diploe; // spongy layer
        m.set(x, y, z, c);
      }
  // a drip of what it bled clinging to one broken end
  const tip = rng.sign() * (Z - 1);
  for (let x = -1; x <= 1; x++) if (m.has(x, 0, tip)) m.set(x, 0, tip, P.wet[0]);
  return { model: m, voxelSize: SHARD_VS };
}

// ------------------------------------------------------------------ the fallback target: a skull on a stake

export const SKULL_VS = 1 / 96;
export const STAKE_VS = 1 / 56;
/** the point under the back of the skull that rests on the stake tip (meters, skull space) */
export const SKULL_SEAT: [number, number, number] = [0, -0.058, -0.112];
/** between the eyes, where the shot goes in (meters, skull space) */
export const SKULL_AIM: [number, number, number] = [0, 0.012, 0.02];

type V = [number, number, number];
const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
/** ellipsoid distance (good near the surface) */
function sdEll(x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  const k0 = len3(x / rx, y / ry, z / rz);
  const k1 = len3(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
/** round cone between a (radius ra) and b (radius rb) */
function sdCone(p: V, a: V, b: V, ra: number, rb: number) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = p[0] - a[0], pay = p[1] - a[1], paz = p[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const t = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / l2));
  const d = len3(pax - bax * t, pay - bay * t, paz - baz * t);
  return { d: d - (ra + (rb - ra) * t), t };
}
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
};

/** the longhorn's sweep (meters, skull space, +x side): out from the poll, then up and forward */
const HORN: { p: V; r: number }[] = [
  { p: [0.1, 0.05, -0.125], r: 0.037 },
  { p: [0.19, 0.04, -0.125], r: 0.031 },
  { p: [0.29, 0.05, -0.1], r: 0.025 },
  { p: [0.38, 0.09, -0.065], r: 0.019 },
  { p: [0.44, 0.15, -0.02], r: 0.013 },
  { p: [0.465, 0.215, 0.025], r: 0.008 },
  { p: [0.47, 0.25, 0.05], r: 0.004 },
];

interface SkullHit {
  d: number;
  horn: number; // >= 0: position along the horn (0 base .. 1 tip), -1 bone
  socket: boolean;
}

function skullField(x: number, y: number, z: number): SkullHit {
  const ax = Math.abs(x);
  // braincase and poll
  let d = sdEll(x, y - 0.015, z + 0.075, 0.104, 0.07, 0.086);
  // frontal plate running down into the face
  d = smin(d, sdEll(x, y, z - 0.03, 0.09, 0.056, 0.1), 0.04);
  // the long face: a flattened tapering cone from under the orbits to the muzzle
  const face = sdCone([x / 0.86, (y + 0.02) / 0.8, z], [0, 0, 0.05], [0, -0.03, 0.29], 0.068, 0.033).d * 0.8;
  d = smin(d, face, 0.04);
  // flared muzzle (premaxilla)
  d = smin(d, sdEll(x, y + 0.052, z - 0.3, 0.038, 0.024, 0.034), 0.02);
  // orbit rims bulging out to the sides
  d = smin(d, sdEll(ax - 0.088, y - 0.004, z - 0.045, 0.035, 0.041, 0.04), 0.022);
  // poll ridge and the bosses the horns grow from
  d = smin(d, sdEll(x, y - 0.058, z + 0.12, 0.118, 0.022, 0.03), 0.03);
  d = smin(d, sdEll(ax - 0.103, y - 0.045, z + 0.123, 0.04, 0.034, 0.034), 0.03);
  // carve: eye sockets, nasal aperture, palate, foramen (the stake goes in there)
  const sock = sdEll(ax - 0.1, y - 0.006, z - 0.05, 0.03, 0.032, 0.031);
  d = Math.max(d, -sock);
  const nasal = sdEll(x, y + 0.016, z - 0.335, 0.021, 0.03, 0.05);
  d = Math.max(d, -nasal);
  d = Math.max(d, -sdEll(x, y + 0.08, z - 0.15, 0.036, 0.026, 0.13));
  d = Math.max(d, -sdEll(x, y + 0.03, z + 0.16, 0.024, 0.024, 0.045));
  // the jaw is long gone: the maxilla ends in a flat, slightly tilted underside
  d = Math.max(d, -(y + 0.072 + z * 0.045));
  // horns
  let hd = 1e9, ht = 0;
  for (let i = 0; i < HORN.length - 1; i++) {
    const a = HORN[i], b = HORN[i + 1];
    const c = sdCone([ax, y, z], a.p, b.p, a.r, b.r);
    if (c.d < hd) {
      hd = c.d;
      ht = (i + c.t) / (HORN.length - 1);
    }
  }
  const total = smin(d, hd, 0.012);
  return { d: total, horn: hd < d ? ht : -1, socket: sock < 0.012 || nasal < 0.01 };
}

/** two hairline cracks across the frontal plate (x, z polylines, meters) */
const CRACKS: V[][] = [
  [[-0.02, 0, -0.06], [0.01, 0, -0.02], [0.0, 0, 0.03], [0.03, 0, 0.07], [0.02, 0, 0.12]],
  [[0.05, 0, -0.1], [0.07, 0, -0.06], [0.06, 0, -0.03]],
];
function nearCrack(x: number, z: number) {
  for (const pl of CRACKS)
    for (let i = 0; i < pl.length - 1; i++) {
      const a = pl[i], b = pl[i + 1];
      const bx = b[0] - a[0], bz = b[2] - a[2];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * bx + (z - a[2]) * bz) / (bx * bx + bz * bz)));
      if (Math.hypot(x - a[0] - bx * t, z - a[2] - bz * t) < 0.0055) return true;
    }
  return false;
}

/** the bleached longhorn skull, origin at the foramen (where it sits on the stake), face along +Z */
export function longhornSkull(): StaticModel {
  const vs = SKULL_VS;
  const m = new VoxelModel('longhorn_skull');
  const X = Math.ceil(0.5 / vs), Y0 = Math.floor(-0.1 / vs), Y1 = Math.ceil(0.27 / vs), Z0 = Math.floor(-0.2 / vs), Z1 = Math.ceil(0.36 / vs);
  const nx = 2 * X + 1, ny = Y1 - Y0 + 1, nz = Z1 - Z0 + 1;
  const solid = new Uint8Array(nx * ny * nz);
  const info: (SkullHit | null)[] = new Array(nx * ny * nz).fill(null);
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        const x = (i - X + 0.5) * vs, y = (Y0 + j + 0.5) * vs, z = (Z0 + k + 0.5) * vs;
        const h = skullField(x, y, z);
        if (h.d < 0) {
          solid[idx(i, j, k)] = 1;
          info[idx(i, j, k)] = h;
        }
      }
  const at = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : solid[idx(i, j, k)]);
  const B = TOON.bone;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        const h = info[idx(i, j, k)];
        if (!h) continue;
        const surf = !at(i + 1, j, k) || !at(i - 1, j, k) || !at(i, j + 1, k) || !at(i, j - 1, k) || !at(i, j, k + 1) || !at(i, j, k - 1);
        const x = (i - X + 0.5) * vs, y = (Y0 + j + 0.5) * vs, z = (Z0 + k + 0.5) * vs;
        // crude normal from the occupancy
        const gy = at(i, j - 1, k) - at(i, j + 1, k);
        const up = !at(i, j + 1, k);
        const down = !at(i, j - 1, k);
        let c: number;
        if (h.horn >= 0) {
          const t = h.horn;
          if (t < 0.16) c = Math.floor(t * 70) % 2 ? 0x6e6050 : 0x857560; // growth rings at the base
          else if (t > 0.86) c = t > 0.94 ? 0x2e2620 : 0x4e4034; // dark tips
          else c = mixRGB(0xb8a888, 0xeee2c8, Math.min(1, (t - 0.16) / 0.4));
          if (up && t >= 0.16 && t <= 0.86) c = mixRGB(c, 0xfff6e2, 0.35);
          if (down) c = mixRGB(c, 0x6a5a48, 0.3);
        } else if (h.socket && surf) c = TOON.socket.base;
        else if (!surf) c = hash3(i, j, k) < 0.18 ? 0xc9a676 : 0xe6cfa2; // spongy bone inside (shows when it bursts)
        else if (y > 0 && up && nearCrack(x, z)) c = B.dark;
        else if (up && gy >= 0) c = y > 0.04 ? B.hi : B.base;
        else if (down) c = B.shade;
        else c = B.base;
        m.set(i - X, Y0 + j, Z0 + k, c);
      }
  // a short row of worn molars along each side of the palate
  for (const s of [-1, 1])
    for (let zz = 0.05; zz <= 0.2; zz += 0.024) {
      const x0 = Math.round((s * 0.044) / vs), y0 = Math.round((-0.074 - zz * 0.045) / vs), z0 = Math.round(zz / vs);
      for (let dx = 0; dx <= 1; dx++)
        for (let dz = 0; dz <= 1; dz++) {
          m.set(x0 + dx * s, y0, z0 + dz, dz === 1 && dx === 1 ? 0xc8b07a : 0xeadcb0);
          m.set(x0 + dx * s, y0 - 1, z0 + dz, 0xd8c690);
        }
    }
  return { model: m, voxelSize: vs };
}

export interface SkullStake {
  stake: StaticModel;
  skull: StaticModel;
  /** where the skull's origin sits on the stake (meters, stake space) and its nose-down tilt (rad about X) */
  skullAt: V;
  skullTilt: number;
}

/** a weathered split stake with a rope lashing; the skull rides on its tip */
export function skullStake(seed = 0): SkullStake {
  const vs = STAKE_VS;
  const rng = new RNG(0x5a7e + seed * 131);
  const m = new VoxelModel('skull_stake');
  const H = Math.round(1.36 / vs);
  const W = TOON.woodGrey;
  const flatA = rng.range(0, Math.PI * 2);
  const lean = rng.range(0.02, 0.045) / vs;
  const leanA = rng.range(0, Math.PI * 2);
  const checkA = flatA + Math.PI + rng.range(-0.6, 0.6);
  const cx = (y: number) => Math.cos(leanA) * lean * (y / H) ** 2;
  const cz = (y: number) => Math.sin(leanA) * lean * (y / H) ** 2;
  for (let y = -4; y <= H; y++) {
    const t = Math.max(0, y / H);
    let r = 4.1 - 1.2 * t;
    // the split, whittled top: a jagged point
    if (y > H - 7) r *= Math.max(0.18, (H - y) / 7);
    const R = Math.ceil(r) + 1;
    const ox = cx(y), oz = cz(y);
    for (let x = -R; x <= R; x++)
      for (let z = -R; z <= R; z++) {
        const px = x - ox, pz = z - oz;
        const a = Math.atan2(pz, px);
        // a split log: round on one side, a flat riven face on the other, knotty undulation
        const rr = r * (1 + 0.07 * Math.sin(a * 3 + seed) + 0.04 * Math.sin(a * 7 - y * 0.2));
        const d = Math.hypot(px, pz);
        if (d > rr) continue;
        const flat = Math.cos(a - flatA) * d;
        if (flat > rr * 0.62) continue;
        const surf = d > rr - 1.2 || flat > rr * 0.62 - 1.2;
        const col = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 18);
        let c = col % 3 === 0 ? W.shade : W.base; // grain runs up the stake
        if (flat > rr * 0.62 - 1.2) c = (y + col) % 5 === 0 ? W.dark : W.hi; // the riven face, pale and checked
        if (Math.abs(a - checkA) < 0.16 && y > 8 && y < H - 14 && surf) c = W.dark; // a long weather check
        if (y < 3) c = mixRGB(c, PR.sand.shade, 0.45); // sand-stained foot
        if (!surf) c = W.shade;
        m.set(x, y, z, c);
      }
  }
  // rope lashing under the skull: tight coils, then a frayed tail swinging loose
  const yr0 = H - 13, yr1 = H - 9;
  for (let y = yr0; y <= yr1; y++) {
    const r = 4.1 - 1.2 * (y / H) + 0.9;
    for (let s = 0; s < 40; s++) {
      const a = (s / 40) * Math.PI * 2;
      const x = Math.round(cx(y) + Math.cos(a) * r), z = Math.round(cz(y) + Math.sin(a) * r);
      if (Math.cos(a - flatA) * r > r * 0.7) continue;
      m.set(x, y, z, (s + y * 3) % 6 < 2 ? PR.rope.shade : (s + y * 3) % 6 === 5 ? PR.rope.hi : PR.rope.base);
    }
  }
  const tailA = flatA + Math.PI * 0.5;
  for (let i = 0; i < 16; i++) {
    const y = yr0 - i;
    const r = 4.6 + i * 0.1;
    const x = Math.round(cx(y) + Math.cos(tailA) * r + Math.sin(i * 0.5) * 0.6), z = Math.round(cz(y) + Math.sin(tailA) * r);
    m.set(x, y, z, i % 4 === 0 ? PR.rope.shade : PR.rope.base);
    if (i > 12) m.set(x + (i % 2 ? 1 : -1), y, z, PR.rope.hi); // frayed fibres
  }
  // sand drifted against the foot, two pebbles half buried
  sandDrift(m, 0, 0, 7, 6, 3, 0, seed, 1);
  for (const [px, pz, pr] of [[6, -3, 1.6], [-5, 4, 1.2]] as V[]) {
    for (let x = -2; x <= 2; x++)
      for (let y = 0; y <= 1; y++)
        for (let z = -2; z <= 2; z++)
          if ((x * x) / (pr * pr) + (y * y) / (pr * 0.7) ** 2 + (z * z) / (pr * pr) <= 1) m.set(Math.round(px) + x, y, Math.round(pz) + z, y ? TOON.stone.hi : TOON.stone.base);
  }
  return {
    stake: { model: m, voxelSize: vs },
    skull: longhornSkull(),
    skullAt: [cx(H) * vs, (H - 3) * vs, cz(H) * vs],
    skullTilt: 0.26,
  };
}
