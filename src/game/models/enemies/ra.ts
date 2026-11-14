// RA, THE SUN KING (Nile stage, wave 100) + his fire falcons, sunfire meteors,
// the obsidian spires they cool into and the eclipse moon.
//
// Ra comes down as the sun itself: a ~34 m falcon-headed colossus of living
// fire, sculpted at 1/5 m voxels. Below the waist he is not a man but a star:
// a twisting trunk of solar plasma (three coronal ropes wound round it) that
// tapers to a white-hot tail point, with a fan of flame tail feathers behind
// it. Above it: a pleated gold shendyt, a belt with a sun buckle, gold scale
// plates over a muscled plasma torso, a broad usekh collar of molten-seamed
// gold bands with lapis inlays, falcon-feather pauldrons and gold bracers.
// The falcon head (re-sculpted at 1/10 m for close shots) has fiery scalloped
// plumage, a gold beak with a burnt tip and a white-hot cere, gold brow plates
// that glare, the obsidian Eye-of-Ra malar stripes and a crest of flame
// feathers. The eyes are modelled orbs (1/24 m): a black pupil with a
// white-hot eclipse corona, a molten gold iris with radial fibres, a red limbal
// ring and a glint. Behind him burns the sun disc: a gold rim with 24 rays and
// coronal prominence loops around a plasma lens with granulation, limb
// darkening and sunspots (`core`, the weak point), a gold uraeus cobra rearing
// at its foot. Two 26 m wings: gold-armoured bones, gold covert plates and
// fire flight feathers that burn white at the root and tear into red flame at
// the tips (the boss shader animates the plasma and flickers the tips).
//
// Rig (all parts authored in place: rest frames aligned with rig space; faces
// +Z, left = +X, origin = the tail point, 0 m):
//   pelvis (root, kilt) → tail1 → tail2 → tail3 → tail4 · pelvis → tailfan
//   pelvis → torso → head → jaw, eye_l/_r, brow_l/_r
//   torso → disc → core, uraeus
//   torso → arm_l → fore_l → hand_l → fing1..4_l → tip1..4_l, thumb_l → thumbtip_l
//   torso → wing_l → wing2_l → wing3_l
// meta.ik holds rest joints (rig-local metres) and finger / thumb / wrist axes
// for the boss's arm IK; meta.wing the wing joints; meta.hd the 1/10 m head
// and 1/24 m eye builders' pivots.
import { TRig, VoxelModel, VF } from './tk';
import type { RigSpec, V3 } from './tk';

/** voxels per metre of the body rig */
export const RA_S = 5;
const S = RA_S;
const VS = 1 / S;
const XS = 0.5 / S;
/** the close-up head and the eyes */
export const RA_HEAD_S = 8;
export const RA_EYE_S = 24;

// ----------------------------------------------------------------------------- palette
const GOLD = { white: 0xfff3c4, hi: 0xffd66a, base: 0xe9aa2e, shade: 0xb97a1a, dark: 0x7c4c0e, deep: 0x4a2a08 };
/** molten seams: never red (red is the flame-tip colour the shader tears) */
const MOLTEN = { white: 0xfffbe8, yellow: 0xffe27c, amber: 0xffc040, orange: 0xffa23a };
/** solar plasma, hot to cool; the last two are flame tips (the shader flickers them away) */
const PLASMA = [0xfff7d8, 0xffe9a6, 0xffd36c, 0xffb444, 0xff962e, 0xfb7622, 0xe0501a, 0xb2321a];
const OBSIDIAN = { hi: 0x51485e, base: 0x2c2636, shade: 0x1a1621, deep: 0x0c0a10 };
const LAPIS = { hi: 0x5b86e0, base: 0x2c52b2, shade: 0x1b3479 };
const CARNELIAN = { base: 0xb8452a, shade: 0x8a2c1a };
const TURQ = 0x34b8a6;
const PLUME = { hi: 0xffcf7a, base: 0xf4a446, shade: 0xd77a2e, dark: 0xa8521e, edge: 0x7a3416 };
const BEAK = { hi: 0xfff0b0, base: 0xe7b23e, shade: 0xb5801e, burnt: 0x3a2a24, tip: 0x1c1418 };
const SOCKET = 0x1a0d08;
const EYE = { pupil: 0x060304, corona: 0xfffbe6, iris0: 0xffd65a, iris1: 0xffae2e, iris2: 0xf58a1e, fibre: 0xfff0a0, limbal: 0xc8401a, back: 0x2a0e08, glint: 0xffffff };
const STONE = { hi: 0x5a5060, base: 0x2e2834, shade: 0x1d1922, deep: 0x100d14 };
const MOON = { hi: 0x7a7480, base: 0x4c4854, shade: 0x34313c, deep: 0x1c1a22 };

// ----------------------------------------------------------------------------- math
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
function sstep(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function h3(x: number, y: number, z: number, s: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** smooth value noise on a unit lattice, 0..1 */
function vn(x: number, y: number, z: number, s: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const a = h3(ix, iy, iz, s), b = h3(ix + 1, iy, iz, s), c = h3(ix, iy + 1, iz, s), d = h3(ix + 1, iy + 1, iz, s);
  const e = h3(ix, iy, iz + 1, s), f = h3(ix + 1, iy, iz + 1, s), g = h3(ix, iy + 1, iz + 1, s), h = h3(ix + 1, iy + 1, iz + 1, s);
  const ab = a + (b - a) * fx, cd = c + (d - c) * fx, ef = e + (f - e) * fx, gh = g + (h - g) * fx;
  const lo = ab + (cd - ab) * fy, hi = ef + (gh - ef) * fy;
  return lo + (hi - lo) * fz;
}
const pk = (c: number, f: number = VF.SOLID) => ((f << 24) | (c & 0xffffff)) >>> 0;
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** voxel-space pivot of a metric point at a grid resolution */
const Pv = (m: V3, s = S): V3 => [m[0] * s + 0.5, m[1] * s, m[2] * s];
const P = (m: V3) => Pv(m, S);
/** rig-local metres of a metric point (what the boss reads from meta) */
const RL = (m: V3): V3 => [m[0] + XS, m[1], m[2]];

// ----------------------------------------------------------------------------- distance-field bits (metres)
function ell(px: number, py: number, pz: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) {
  const x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz;
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const k1 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  return k1 < 1e-6 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
const ellV = (px: number, py: number, pz: number, c: V3, r: V3) => ell(px, py, pz, c[0], c[1], c[2], r[0], r[1], r[2]);
/** round cone between a and b (radius lerps along the segment) */
function cone(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const t = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1));
  const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
}
const coneV = (px: number, py: number, pz: number, a: V3, b: V3, ra: number, rb: number) => cone(px, py, pz, a[0], a[1], a[2], b[0], b[1], b[2], ra, rb);
/** parameter t of the closest point on segment ab */
function segT(px: number, py: number, pz: number, a: V3, b: V3) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  return clamp01(((px - a[0]) * bax + (py - a[1]) * bay + (pz - a[2]) * baz) / (bax * bax + bay * bay + baz * baz || 1));
}
function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}
/** 2D cellular noise: [F1, F2 - F1] on a unit lattice */
function cell2(u: number, v: number, seed: number): [number, number] {
  const iu = Math.floor(u), iv = Math.floor(v);
  let f1 = 9, f2 = 9;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++) {
      const cu = iu + a, cv = iv + b;
      const dd = (u - cu - h3(cu, cv, 1, seed)) ** 2 + (v - cv - h3(cu, cv, 2, seed)) ** 2;
      if (dd < f1) {
        f2 = f1;
        f1 = dd;
      } else if (dd < f2) f2 = dd;
    }
  return [Math.sqrt(f1), Math.sqrt(f2) - Math.sqrt(f1)];
}

// ----------------------------------------------------------------------------- dense sculpting grid
type Field = (x: number, y: number, z: number) => number;
type Paint = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

class Grid {
  readonly i0: number;
  readonly j0: number;
  readonly k0: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly occ: Uint8Array;
  /** metric origin of the sampled frame (local sculpts: the grid is centred on a pivot) */
  constructor(readonly s: number, box: number[], readonly o: V3 = [0, 0, 0]) {
    const s0 = s;
    this.i0 = Math.floor((box[0] - o[0]) * s0) - 2;
    this.j0 = Math.floor((box[1] - o[1]) * s0) - 2;
    this.k0 = Math.floor((box[2] - o[2]) * s0) - 2;
    this.nx = Math.ceil((box[3] - o[0]) * s0) + 3 - this.i0;
    this.ny = Math.ceil((box[4] - o[1]) * s0) + 3 - this.j0;
    this.nz = Math.ceil((box[5] - o[2]) * s0) + 3 - this.k0;
    this.occ = new Uint8Array(this.nx * this.ny * this.nz);
  }
  X(i: number) {
    return (this.i0 + i) / this.s + this.o[0];
  }
  Y(j: number) {
    return (this.j0 + j + 0.5) / this.s + this.o[1];
  }
  Z(k: number) {
    return (this.k0 + k + 0.5) / this.s + this.o[2];
  }
  fill(f: Field) {
    const { nx, ny, nz, occ } = this;
    for (let k = 1; k < nz - 1; k++) {
      const z = this.Z(k);
      for (let j = 1; j < ny - 1; j++) {
        const y = this.Y(j);
        let n = 1 + nx * (j + ny * k);
        for (let i = 1; i < nx - 1; i++, n++) if (!occ[n] && f(this.X(i), y, z) < 0) occ[n] = 1;
      }
    }
  }
  /** surface cells get painted with an occupancy normal; interior cells stay plain fill (never meshed) */
  emit(m: VoxelModel, paint: Paint, inner = SOCKET) {
    const { nx, ny, nz, occ } = this;
    const sxy = nx * ny;
    for (let k = 1; k < nz - 1; k++)
      for (let j = 1; j < ny - 1; j++)
        for (let i = 1; i < nx - 1; i++) {
          const n = i + nx * (j + ny * k);
          if (!occ[n]) continue;
          let surf = false;
          for (let dz = -1; dz <= 1 && !surf; dz++)
            for (let dy = -1; dy <= 1 && !surf; dy++)
              for (let dx = -1; dx <= 1; dx++)
                if (!occ[n + dx + nx * dy + sxy * dz]) {
                  surf = true;
                  break;
                }
          if (!surf) {
            m.set(this.i0 + i, this.j0 + j, this.k0 + k, inner);
            continue;
          }
          let ax = 0, ay = 0, az = 0;
          for (let dz = -2; dz <= 2; dz++) {
            const kk = k + dz;
            if (kk < 0 || kk >= nz) continue;
            for (let dy = -2; dy <= 2; dy++) {
              const jj = j + dy;
              if (jj < 0 || jj >= ny) continue;
              for (let dx = -2; dx <= 2; dx++) {
                const ii = i + dx;
                if (ii < 0 || ii >= nx) continue;
                if (!occ[ii + nx * (jj + ny * kk)]) {
                  ax += dx;
                  ay += dy;
                  az += dz;
                }
              }
            }
          }
          const l = Math.hypot(ax, ay, az) || 1;
          const v = paint(this.X(i), this.Y(j), this.Z(k), ax / l, ay / l, az / l);
          if (v < 0) continue;
          m.set(this.i0 + i, this.j0 + j, this.k0 + k, v & 0xffffff, v >>> 24 || VF.SOLID);
        }
  }
}
function bounds(pts: V3[], r: number): number[] {
  const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (const p of pts)
    for (let a = 0; a < 3; a++) {
      b[a] = Math.min(b[a], p[a] - r);
      b[a + 3] = Math.max(b[a + 3], p[a] + r);
    }
  return b;
}
function sculpt(m: VoxelModel, box: number[], f: Field, paint: Paint, s = S, origin: V3 = [0, 0, 0]) {
  const g = new Grid(s, box, origin);
  g.fill(f);
  g.emit(m, paint);
  return g;
}

// ----------------------------------------------------------------------------- shared paint
/** plasma colour by heat (1 = white-hot core, 0 = red flame tip) */
function plasma(heat: number, x: number, y: number, z: number, grain = 1, tips = false): number {
  const n = (vn(x * 0.9, y * 0.55, z * 0.9, 7) - 0.5) * 0.22 * grain;
  // only thin flames may reach the red tip tones (the shader tears those away)
  const h = Math.max(tips ? 0 : 0.3, clamp01(heat + n));
  const idx = Math.min(PLASMA.length - 1, Math.max(0, Math.round((1 - h) * (PLASMA.length - 1))));
  return pk(PLASMA[idx], h > 0.82 ? VF.GLOW : VF.EMISSIVE);
}
/** polished gold, lit from above, darker in recesses */
function gold(ny: number, k = 0): number {
  const c = ny > 0.55 + k ? GOLD.hi : ny > -0.2 ? GOLD.base : ny > -0.65 ? GOLD.shade : GOLD.dark;
  return pk(c, VF.METAL);
}
const molten = (hot: boolean) => pk(hot ? MOLTEN.yellow : MOLTEN.amber, hot ? VF.GLOW : VF.EMISSIVE);

// ============================================================================= landmarks (metric rig space)
const PELVIS_PIV: V3 = [0, 11.0, 0];
const TORSO_PIV: V3 = [0, 12.4, 0];
const HEAD_PIV: V3 = [0, 22.2, 0.9];
/** the head is sculpted in design units and grown by HS into the rig */
const HS = 1.3;
const SH: V3 = [4.9, 19.3, -0.2];
const EL: V3 = [7.3, 15.3, 0.7];
const WR: V3 = [8.5, 11.6, 2.5];
const DISC_C: V3 = [0, 32.2, -4.3];
const DISC_R = 4.6;
const W0: V3 = [2.3, 19.4, -2.4];
const W1: V3 = [9.6, 24.6, -3.3];
const W2: V3 = [16.8, 26.4, -3.1];
const WT: V3 = [21.4, 26.0, -3.25];
/** head-local landmarks (relative to HEAD_PIV) */
const EYE_L: V3 = [1.28, 2.8, 1.3];
const EYE_R = 0.56;
const EYE_AX = norm([0.78, 0.03, 1]);
const BROW_PIV: V3 = [0.5, 3.05, 2.25];
const JAW_PIV: V3 = [0, 1.82, 2.1];
const hp = (c: V3): V3 => add(HEAD_PIV, c, HS);
const hfS = (f: Field): Field => (x, y, z) => f(x / HS, y / HS, z / HS) * HS;
const hpS = (p: Paint): Paint => (x, y, z, nx, ny, nz) => p(x / HS, y / HS, z / HS, nx, ny, nz);

// ----------------------------------------------------------------------------- plasma trunk (the star below the waist)
/** centre line of the trunk: sweeps back and twists as it tapers to the point */
function trunkC(y: number): [number, number] {
  const k = clamp01((10 - y) / 10);
  return [0.35 * Math.sin(k * 3.1) * k, -2.6 * k * k - 0.3 * k];
}
function trunkR(y: number) {
  const k = clamp01(y / 10);
  return 0.18 + 2.5 * Math.pow(k, 0.62);
}
function trunkF(x: number, y: number, z: number) {
  if (y > 11.2 || y < -0.4) return 1;
  const [cx, cz] = trunkC(y);
  const dx = x - cx, dz = (z - cz) / 0.85;
  const R = trunkR(y);
  const rho = Math.hypot(dx, dz), th = Math.atan2(dz, dx);
  // flame flutes spiralling down the trunk (calmer up inside the kilt)
  const calm = 0.3 + 0.7 * (1 - sstep(8.0, 10.2, y));
  const flute = (0.16 * R * Math.sin(5 * th + y * 0.9) + 0.08 * R * Math.sin(9 * th - y * 1.7)) * calm;
  let d = (rho - R - flute) * 0.8;
  // three coronal ropes wound round it
  for (let k = 0; k < 3; k++) {
    const a = y * 0.72 + (k * Math.PI * 2) / 3;
    const rr = R * (0.86 + 0.06 * calm);
    const rx = cx + Math.cos(a) * rr, rz = cz + Math.sin(a) * rr * 0.85;
    const r0 = (0.2 + 0.36 * clamp01(y / 10)) * (0.6 + 0.4 * calm);
    d = smin(d, Math.hypot(x - rx, z - rz) * 0.85 - r0, 0.5);
  }
  d = Math.max(d, -y - 0.05);
  return d + (vn(x * 0.8, y * 0.35, z * 0.8, 21) - 0.5) * 0.35;
}
function trunkPaint(x: number, y: number, z: number) {
  const [cx, cz] = trunkC(y);
  const rho = Math.hypot(x - cx, z - cz);
  const R = trunkR(y);
  // hotter up into the body and along the ropes, cooling to flame at the point... then white again at the very tip (a star point)
  const rope = clamp01((rho - R * 0.9) / 0.5);
  let heat = 0.42 + 0.5 * clamp01((y - 1.5) / 8) + rope * 0.18;
  if (y < 1.2) heat = 0.95; // the white star point
  const spot = vn(x * 0.7, y * 0.7, z * 0.7, 33);
  if (spot > 0.72 && y > 2) heat -= 0.35; // cooler granules
  return plasma(heat, x, y, z);
}

// ----------------------------------------------------------------------------- kilt (shendyt), belt
function kiltF(x: number, y: number, z: number) {
  if (y < 6.8 || y > 12.4) return 1;
  // a flared pleated skirt round the hips: wider at the hem, open at the bottom
  const k = clamp01((11.6 - y) / 4.2);
  const rx = 3.0 + 0.95 * k, rz = 2.4 + 0.75 * k;
  const th = Math.atan2(z / rz, x / rx);
  const pleat = 0.07 * Math.abs(Math.sin(th * 15));
  const rho = Math.hypot(x / rx, (z + 0.15) / rz);
  const shell = Math.abs(rho - 1 + pleat) * Math.min(rx, rz) - 0.26;
  // ragged hem: plates of different length
  const plate = Math.floor((th + Math.PI) * 15 / Math.PI);
  const hem = 7.5 + 0.55 * h3(plate, 3, 1, 5) - 0.6 * Math.max(0, Math.cos(th - Math.PI / 2)); // longer at the front apron
  let d = Math.max(shell, hem - y, y - 11.9);
  // the belt: a thick gold band
  const belt = Math.max(Math.abs(Math.hypot(x / 3.05, (z + 0.1) / 2.45) - 1) * 2.6 - 0.36, Math.abs(y - 11.65) - 0.42);
  d = Math.min(d, belt);
  // the front apron (a trapezoid tab hanging below the belt)
  const ay = clamp01((11.3 - y) / 3.8);
  const apron = Math.max(Math.abs(x) - (0.85 + 0.55 * ay), Math.abs(z - (2.42 + 0.7 * ay)) - 0.2, y - 11.3, 7.05 - y);
  d = Math.min(d, apron);
  // the sun buckle
  d = Math.min(d, ell(x, y, z, 0, 11.65, 2.55, 0.62, 0.62, 0.3));
  return d;
}
function kiltPaint(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
  // buckle: a little sun with a white-hot centre
  const bd = Math.hypot(x, y - 11.65);
  if (z > 2.4 && bd < 0.66) return bd < 0.28 ? pk(MOLTEN.white, VF.GLOW) : bd < 0.42 ? molten(false) : gold(ny);
  if (Math.abs(y - 11.65) < 0.44 && Math.hypot(x / 3.05, (z + 0.1) / 2.45) > 0.85) {
    // belt: gold with lapis cells and molten seams top and bottom
    if (Math.abs(y - 11.65) > 0.34) return molten(false);
    const th = Math.atan2(z, x);
    const c = Math.floor((th + Math.PI) * 7);
    return c % 2 ? pk(LAPIS.base) : gold(ny);
  }
  const ay = clamp01((11.3 - y) / 3.8);
  if (Math.abs(x) < 0.9 + 0.55 * ay && z > 2.2 && y < 11.3) {
    // apron: vertical stripes of gold, lapis and carnelian, edged in gold
    if (Math.abs(x) > 0.7 + 0.55 * ay) return gold(ny, 0.2);
    const st = Math.floor((x + 2) / 0.32);
    const band = Math.floor((11.3 - y) / 0.9);
    if ((11.3 - y) % 0.9 < 0.12) return molten(false);
    return st % 3 === 0 ? pk(LAPIS.base) : st % 3 === 1 ? gold(ny) : pk(band % 2 ? CARNELIAN.base : TURQ);
  }
  // pleated plates: gold, alternating shade on the pleat faces, molten under the hem
  const th = Math.atan2(z, x);
  const pf = Math.sin(th * 15);
  if (ny < -0.6) return molten(false);
  const k = clamp01((11.6 - y) / 4.2);
  if ((11.4 - y) % 1.1 < 0.12 && y < 11.3) return pk(GOLD.white, VF.METAL); // engraved bands
  void nx;
  void nz;
  return pk(pf > 0.35 ? GOLD.hi : pf < -0.35 ? GOLD.shade : k > 0.85 ? GOLD.dark : GOLD.base, VF.METAL);
}

// ----------------------------------------------------------------------------- torso
function torsoBase(x: number, y: number, z: number) {
  let d = ell(x, y, z, 0, 17.4, 0.15, 3.6, 3.3, 2.15); // ribcage
  if (d > 4.5) return d;
  d = smin(d, cone(x, y, z, 0, 12.0, 0.1, 0, 15.4, 0.25, 2.2, 2.75), 1.1); // abdomen: a narrow waist
  d = smin(d, ell(x, y, z, 0, 18.0, -1.2, 3.6, 2.9, 1.45), 1.0); // upper back
  for (let s = 1; s >= -1; s -= 2) {
    d = smin(d, ell(x, y, z, s * 1.95, 18.0, 1.55, 2.05, 1.4, 1.0), 0.8); // pectorals
    d = smin(d, ell(x, y, z, s * 3.15, 16.6, -0.45, 1.3, 2.6, 1.5), 0.9); // lats: the V
    d = smin(d, ell(x, y, z, s * 4.85, 19.15, -0.15, 1.75, 1.65, 1.75), 0.9); // deltoid mass
    d = smin(d, cone(x, y, z, s * 1.0, 21.0, -0.65, s * 4.3, 19.85, -0.4, 1.3, 1.1), 0.9); // trapezius
    d = smin(d, ell(x, y, z, s * 2.25, 19.4, -2.35, 1.25, 1.45, 1.05), 0.7); // wing roots
    d = smin(d, ell(x, y, z, s * 1.05, 13.6, 1.95, 0.95, 0.6, 0.5), 0.5); // obliques/abs
  }
  d = smin(d, cone(x, y, z, 0, 19.6, -0.2, 0, 23.0, 0.9, 1.7, 1.25), 1.0); // neck
  return d;
}
/** the broad usekh collar: a draped shell of bands round the neck */
function collarR(x: number, y: number, z: number) {
  return Math.hypot(x, y - 20.6, (z - 0.25) / 0.92);
}
const inCollar = (r: number, y: number) => r > 1.75 && r < 4.85 && y < 21.3;
function torsoF(x: number, y: number, z: number) {
  const base = torsoBase(x, y, z);
  if (base > 1.2) return base;
  let d = base;
  // gold abdomen scale plates: a little raised over the belly front
  if (y > 12.0 && y < 15.6 && z > 0.6) {
    const row = (y - 12.0) / 0.78, f = row - Math.floor(row);
    d -= 0.1 * sstep(0.12, 0.3, f) * (1 - sstep(0.82, 0.95, f));
  }
  // pectoral plates
  for (let s = 1; s >= -1; s -= 2) d = Math.min(d, Math.max(ell(x, y, z, s * 1.95, 18.05, 1.75, 2.15, 1.45, 0.95), 16.7 - y));
  // usekh collar
  const r = collarR(x, y, z);
  if (inCollar(r, y)) d = Math.min(d, Math.max(base - 0.32, 1.78 - r, r - 4.82));
  return d;
}
function torsoPaint(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
  const base = torsoBase(x, y, z);
  const r = collarR(x, y, z);
  if (inCollar(r, y) && base > -0.45) {
    // collar bands: gold / lapis beads / gold / carnelian drops / gold scallop rim, molten seams between
    const b = (r - 1.78) / 0.76, bi = Math.floor(b), bf = b - bi;
    if (bf < 0.14) return molten(bi % 2 === 0);
    const th = Math.atan2(x, z);
    const seg = Math.floor((th + Math.PI) * (6 + bi * 2.5));
    if (bi === 1) return seg % 2 ? pk(LAPIS.base) : pk(LAPIS.hi);
    if (bi === 3) return seg % 3 === 0 ? pk(TURQ) : pk(CARNELIAN.base);
    return seg % 2 ? gold(ny) : pk(GOLD.hi, VF.METAL);
  }
  // pectoral plates: gold feather scallops engraved in rows
  for (let s = 1; s >= -1; s -= 2) {
    if (y > 16.7 && ell(x, y, z, s * 1.95, 18.05, 1.75, 2.15, 1.45, 0.95) < 0.18 && z > 0.9) {
      const u = (x * s) * 2.2, v = (19.2 - y) * 2.4;
      const row = Math.floor(v), off = row % 2 ? 0.5 : 0;
      const fu = u + off - Math.floor(u + off), fv = v - row;
      if (Math.hypot(fu - 0.5, fv * 0.9) > 0.55) return molten(false);
      return fv < 0.25 ? pk(GOLD.white, VF.METAL) : gold(ny);
    }
  }
  if (y > 12.0 && y < 15.6 && z > 0.6) {
    // a cuirass of abdominal plates: two columns either side of a molten seam
    const row = (y - 12.0) / 0.78, f = row - Math.floor(row);
    if (f < 0.12 || Math.abs(x) < 0.13) return molten(true);
    const ax = Math.abs(x);
    if (Math.abs(ax - 1.15) < 0.09) return molten(false);
    return ax > 1.15 ? gold(ny, 0.1) : f > 0.7 ? pk(GOLD.hi, VF.METAL) : gold(ny);
  }
  // the living fire: muscled plasma, hotter in the grooves between masses
  const groove = clamp01(-base * 3);
  void nx;
  void nz;
  return plasma(0.55 + 0.3 * groove + (y - 12) * 0.012, x, y, z);
}

// ----------------------------------------------------------------------------- arms
function armF(x: number, y: number, z: number) {
  let d = coneV(x, y, z, SH, EL, 1.35, 1.02);
  d = smin(d, ellV(x, y, z, lerp3(SH, EL, 0.38), [1.3, 1.75, 1.35]), 0.6); // biceps / triceps
  d = smin(d, ellV(x, y, z, SH, [1.55, 1.5, 1.55]), 0.6);
  // pauldron: three overlapping gold feather plates over the shoulder
  for (let i = 0; i < 3; i++) {
    const c: V3 = [SH[0] + 0.35 + i * 0.25, SH[1] + 0.5 - i * 0.85, SH[2] - 0.05];
    const sh = Math.max(Math.abs(ellV(x, y, z, c, [1.95 - i * 0.12, 1.25, 1.95 - i * 0.1])) - 0.17, c[1] - 0.55 - y, SH[0] - 0.9 - x);
    d = Math.min(d, sh);
  }
  return d;
}
function armPaint(x: number, y: number, z: number, _nx: number, ny: number) {
  for (let i = 0; i < 3; i++) {
    const c: V3 = [SH[0] + 0.35 + i * 0.25, SH[1] + 0.5 - i * 0.85, SH[2] - 0.05];
    const e = ellV(x, y, z, c, [1.95 - i * 0.12, 1.25, 1.95 - i * 0.1]);
    if (Math.abs(e) < 0.3 && y > c[1] - 0.6 && x > SH[0] - 0.95) {
      if (y < c[1] - 0.38) return molten(i === 0); // the glowing scalloped edge
      const ribs = Math.sin(Math.atan2(z - c[2], x - c[0]) * 9);
      return ribs > 0.7 ? pk(GOLD.white, VF.METAL) : gold(ny);
    }
  }
  return plasma(0.6 + 0.1 * Math.sin(y * 2.1), x, y, z);
}
function foreF(x: number, y: number, z: number) {
  let d = coneV(x, y, z, EL, WR, 1.08, 0.78);
  d = smin(d, ellV(x, y, z, lerp3(EL, WR, 0.25), [1.15, 1.4, 1.15]), 0.5);
  // bracer
  const t = segT(x, y, z, EL, WR);
  if (t > 0.3 && t < 0.92) d = Math.min(d, coneV(x, y, z, EL, WR, 1.26, 0.98));
  return d;
}
function forePaint(x: number, y: number, z: number, _nx: number, ny: number) {
  const t = segT(x, y, z, EL, WR);
  const inB = coneV(x, y, z, EL, WR, 1.08, 0.78) > 0.06;
  if (t > 0.3 && t < 0.92 && inB) {
    if (t < 0.36 || t > 0.86) return molten(true);
    const u = (t - 0.36) / 0.5;
    if (Math.abs(u - 0.5) < 0.12) return pk(LAPIS.base); // lapis band with a gold eye of Ra
    if (Math.abs(u - 0.5) < 0.16) return pk(GOLD.white, VF.METAL);
    return Math.floor(u * 9) % 2 ? gold(ny) : pk(GOLD.base, VF.METAL);
  }
  return plasma(0.62, x, y, z);
}

// hand frame (left): +Z fingers, +Y back of the hand, +X outward (thumb on -X)
const HF = norm([0.18, -0.86, 0.48]);
const HU = norm(sub([1, 0, 0.1], [HF[0] * dot([1, 0, 0.1], HF), HF[1] * dot([1, 0, 0.1], HF), HF[2] * dot([1, 0, 0.1], HF)]));
const HL = cross(HU, HF);
const _h: V3 = [0, 0, 0];
function toHand(x: number, y: number, z: number) {
  const dx = x - WR[0], dy = y - WR[1], dz = z - WR[2];
  _h[0] = dx * HL[0] + dy * HL[1] + dz * HL[2];
  _h[1] = dx * HU[0] + dy * HU[1] + dz * HU[2];
  _h[2] = dx * HF[0] + dy * HF[1] + dz * HF[2];
  return _h;
}
const handVec = (c: V3): V3 => [HL[0] * c[0] + HU[0] * c[1] + HF[0] * c[2], HL[1] * c[0] + HU[1] * c[1] + HF[1] * c[2], HL[2] * c[0] + HU[2] * c[1] + HF[2] * c[2]];
const fromHand = (c: V3): V3 => add(WR, handVec(c));
const FINGERS = [
  { x: -0.56, z: 1.6, l1: 1.0, l2: 0.86, r0: 0.26, r1: 0.22, r2: 0.18, sp: -0.12 }, // index (thumb side)
  { x: -0.19, z: 1.7, l1: 1.08, l2: 0.92, r0: 0.27, r1: 0.23, r2: 0.19, sp: -0.03 },
  { x: 0.19, z: 1.66, l1: 1.02, l2: 0.88, r0: 0.26, r1: 0.22, r2: 0.18, sp: 0.05 },
  { x: 0.54, z: 1.5, l1: 0.84, l2: 0.72, r0: 0.23, r1: 0.19, r2: 0.16, sp: 0.15 }, // little
];
const REST_CURL: [number, number] = [0.32, 0.45];
const fdir = (sp: number, c: number): V3 => [Math.sin(sp) * Math.cos(c), -Math.sin(c), Math.cos(sp) * Math.cos(c)];
const THUMB = { b: [-0.66, -0.16, 0.45] as V3, d1: norm([-0.62, -0.32, 0.72]), l1: 0.72, d2: norm([-0.36, -0.46, 0.82]), l2: 0.6, r: [0.3, 0.25, 0.2] };
function palmF(x: number, y: number, z: number) {
  const h = toHand(x, y, z);
  let d = ell(h[0], h[1], h[2], 0, 0, 0.85, 0.8, 0.36, 0.95);
  d = smin(d, ell(h[0], h[1], h[2], 0, 0, 0.0, 0.62, 0.45, 0.6), 0.4);
  d = smin(d, ell(h[0], h[1], h[2], -0.5, -0.12, 0.55, 0.42, 0.34, 0.5), 0.3); // thumb pad
  return d;
}
function handPaint(x: number, y: number, z: number) {
  const h = toHand(x, y, z);
  if (h[2] < 0.25 && h[2] > -0.2) return molten(false); // the bracer's cuff glow at the wrist
  return plasma(0.66, x, y, z);
}
/** a finger segment with a gold talon on the last one */
function digit(a: V3, b: V3, ra: number, rb: number, claw: boolean): Field {
  const dir = norm(sub(b, a));
  const cTip = add(b, dir, 0.42);
  return (x, y, z) => {
    let d = coneV(x, y, z, a, b, ra, rb);
    d = smin(d, ell(x, y, z, a[0], a[1], a[2], ra * 1.1, ra, ra * 1.1), 0.15);
    if (claw) d = Math.min(d, coneV(x, y, z, b, cTip, rb * 0.95, 0.04));
    return d;
  };
}
function digitPaint(b: V3, rb: number, claw: boolean): Paint {
  return (x, y, z, _nx, ny) => {
    if (claw && Math.hypot(x - b[0], y - b[1], z - b[2]) > rb * 0.75) return gold(ny);
    return plasma(0.68, x, y, z);
  };
}

// ----------------------------------------------------------------------------- feathers (wings, crest, tail fan, falcons)
interface Feather {
  b: V3;
  U: V3;
  V: V3;
  W: V3;
  len: number;
  wid: number;
  th: number;
  bend: number;
  curl: number;
  seed: number;
  /** 'fire' flight feather, 'gold' covert plate */
  kind: 'fire' | 'gold';
  box: number[];
}
function feather(b: V3, dir: V3, span: V3, len: number, wid: number, th: number, kind: 'fire' | 'gold', seed: number, bend = 0.05, curl = 0.04): Feather {
  const U = norm(dir);
  const V = norm(sub(span, [U[0] * dot(span, U), U[1] * dot(span, U), U[2] * dot(span, U)]));
  const W = cross(U, V);
  const pts: V3[] = [];
  for (const t of [0, 0.35, 0.7, 1])
    for (const s of [-1, 1]) {
      const u = len * t;
      pts.push(add(add(add(b, U, u), V, s * wid * 0.6 + bend * u * t), W, curl * u * t));
    }
  return { b, U, V, W, len, wid, th, bend, curl, seed, kind, box: bounds(pts, th + 0.35) };
}
/** distance to a feather vane and its (t, |v|/half-width) */
function featherD(f: Feather, x: number, y: number, z: number, out?: number[]) {
  const dx = x - f.b[0], dy = y - f.b[1], dz = z - f.b[2];
  const u = dx * f.U[0] + dy * f.U[1] + dz * f.U[2];
  const t = clamp01(u / f.len);
  const v = dx * f.V[0] + dy * f.V[1] + dz * f.V[2] - f.bend * u * t;
  const w = dx * f.W[0] + dy * f.W[1] + dz * f.W[2] - f.curl * u * t;
  const prof = Math.sin(Math.PI * Math.pow(t, 0.6));
  const ser = 1 + (f.kind === 'fire' ? 0.2 * Math.sin(u * 4.6 + f.seed * 2.3) * t * t : 0);
  const half = f.wid * 0.5 * (0.18 + 0.82 * prof) * ser;
  const tw = f.th * (1 - 0.4 * t) + (Math.abs(v) < f.wid * 0.08 ? 0.06 : 0);
  const du = Math.max(-u, u - f.len), dv = Math.abs(v) - half, dw = Math.abs(w) - tw;
  if (out) {
    out[0] = t;
    out[1] = half > 1e-4 ? Math.abs(v) / half : 1;
    out[2] = u;
  }
  const ox = Math.max(du, 0), oy = Math.max(dv, 0), oz = Math.max(dw, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(du, dv, dw), 0);
}
function feathersF(list: Feather[]): Field {
  return (x, y, z) => {
    let d = 1;
    for (const f of list) {
      const b = f.box;
      if (x < b[0] || y < b[1] || z < b[2] || x > b[3] || y > b[4] || z > b[5]) continue;
      d = Math.min(d, featherD(f, x, y, z));
    }
    return d;
  };
}
const _fo = [0, 0, 0];
/** paint of the nearest feather: fire burns white at the quill, tears into red flame at the tip; gold coverts are plates */
function featherPaint(f: Feather, x: number, y: number, z: number, ny: number): number {
  featherD(f, x, y, z, _fo);
  const t = _fo[0], v = _fo[1], u = _fo[2];
  if (f.kind === 'gold') {
    if (t > 0.86 || v > 0.86) return molten(t > 0.92);
    if (v < 0.12) return pk(GOLD.white, VF.METAL); // rachis
    const barb = (u * 3.2 + v * 2.4) % 1;
    return barb < 0.16 ? pk(GOLD.shade, VF.METAL) : gold(ny);
  }
  if (t < 0.08) return gold(ny); // the gold quill root
  if (v < 0.1 && t < 0.75) return pk(MOLTEN.white, VF.GLOW); // rachis: a white-hot spine
  let heat = 1.02 - t * 0.95 - v * 0.12;
  const barb = (u * 2.7 + v * f.wid * 2.2 + f.seed * 0.37) % 1;
  if (barb < 0.18) heat -= 0.12; // barbs read as cooler stripes
  if (v > 0.84) heat += 0.1; // a hot rim
  return plasma(heat, x, y, z, 0.8, true);
}
function paintFeathers(list: Feather[]): Paint {
  return (x, y, z, _nx, ny) => {
    let best = list[0], bd = 9;
    for (const f of list) {
      const b = f.box;
      if (x < b[0] - 0.3 || y < b[1] - 0.3 || z < b[2] - 0.3 || x > b[3] + 0.3 || y > b[4] + 0.3 || z > b[5] + 0.3) continue;
      const d = featherD(f, x, y, z);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return featherPaint(best, x, y, z, ny);
  };
}

// ----------------------------------------------------------------------------- wings (left; mirrored)
/** the wing plane: roughly facing forward, tilted back at the tips */
const WN = norm([0.0, 0.08, 1]);
interface WingSet {
  bone: [V3, V3, number, number][];
  inner: Feather[];
  mid: Feather[];
  outer: Feather[];
}
function wingSet(): WingSet {
  const bone: [V3, V3, number, number][] = [
    [W0, W1, 0.85, 0.62],
    [W1, W2, 0.62, 0.44],
    [W2, WT, 0.44, 0.24],
  ];
  const inner: Feather[] = [], mid: Feather[] = [], outer: Feather[] = [];
  const down: V3 = [0, -1, 0];
  // secondaries along the arm and forearm: long, hanging down-out, shingled back
  const sec = (a: V3, b: V3, n: number, l0: number, l1: number, into: Feather[], seed: number, z0: number) => {
    const e = norm(sub(b, a));
    const perp = norm(cross(e, WN)); // in-plane, pointing down-out
    const pd = dot(perp, down) < 0 ? ([-perp[0], -perp[1], -perp[2]] as V3) : perp;
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const base = add(add(lerp3(a, b, s), pd, 0.9), [0, 0, 1], z0 - i * 0.07);
      const dir = norm(add(lerp3(pd, down, 0.45), [0, 0, -1], 0.22));
      const len = l0 + (l1 - l0) * s + (h3(i, seed, 3, 9) - 0.5) * 0.6;
      into.push(feather(base, dir, e, len, 1.15, 0.2, 'fire', seed + i, 0.05 + s * 0.06, -0.05));
      // a gold covert plate over the root
      const cb = add(add(lerp3(a, b, s), pd, 0.15), [0, 0, 1], 0.3);
      into.push(feather(cb, norm(add(pd, [0, 0, -1], 0.15)), e, 2.3 + 0.3 * h3(i, seed, 5, 9), 1.0, 0.2, 'gold', seed + 50 + i, 0.03, 0.02));
      // greater coverts, a row further down
      if (i % 2 === 0) into.push(feather(add(cb, pd, 1.1), norm(add(pd, [0, 0, -1], 0.2)), e, 2.9, 1.2, 0.18, 'gold', seed + 80 + i, 0.04, 0.02));
    }
  };
  sec(W0, W1, 11, 5.6, 7.4, inner, 100, 0.0);
  sec(W1, W2, 9, 7.4, 8.4, mid, 200, -0.8);
  // primaries: fanned from down-out to straight out, longest toward the tip (a falcon's pointed hand)
  const e2 = norm(sub(WT, W2));
  const perp2 = norm(cross(e2, WN));
  const pd2 = dot(perp2, down) < 0 ? ([-perp2[0], -perp2[1], -perp2[2]] as V3) : perp2;
  const LEN = [7.6, 8.2, 8.8, 9.4, 9.9, 10.3, 10.5, 9.9, 8.8];
  for (let i = 0; i < LEN.length; i++) {
    const s = i / (LEN.length - 1);
    const base = add(lerp3(W2, WT, 0.1 + 0.9 * s), pd2, 0.55 - s * 0.3);
    const dir = norm(add(add(lerp3(pd2, e2, 0.15 + s * 0.66), [0, -1, 0], 0.18 * (1 - s)), [0, 0, -1], 0.18));
    outer.push(feather(add(base, [0, 0, 1], -1.4 - i * 0.08), dir, e2, LEN[i], 1.05, 0.2, 'fire', 300 + i, 0.18 * s, -0.08));
  }
  // primary coverts: gold plates along the hand
  for (let i = 0; i < 5; i++) {
    const s = (i + 0.5) / 5;
    outer.push(feather(add(add(lerp3(W2, WT, s), pd2, 0.1), [0, 0, 1], -0.6), norm(add(lerp3(pd2, e2, 0.3 + s * 0.4), [0, 0, -1], 0.15)), e2, 2.6, 1.0, 0.18, 'gold', 360 + i, 0.05, 0.02));
  }
  // alula: three small gold feathers at the wrist
  for (let i = 0; i < 3; i++) outer.push(feather(add(W2, [0, 0.2, 0.3]), norm(add(e2, [0, 0.35 - i * 0.2, 0.1])), [0, 1, 0], 2.0 + i * 0.4, 0.7, 0.16, 'gold', 390 + i, 0.02, 0.0));
  return { bone, inner, mid, outer };
}
function boneF(seg: [V3, V3, number, number]): Field {
  const [a, b, ra, rb] = seg;
  return (x, y, z) => {
    let d = coneV(x, y, z, a, b, ra, rb);
    d = smin(d, ellV(x, y, z, a, [ra * 1.15, ra * 1.15, ra * 1.15]), 0.4);
    // scalloped gold armour on the leading edge
    const t = segT(x, y, z, a, b);
    d -= 0.08 * Math.abs(Math.sin(t * 9 * Math.PI));
    return d;
  };
}
function bonePaint(seg: [V3, V3, number, number]): Paint {
  const [a, b] = seg;
  return (x, y, z, _nx, ny) => {
    const t = segT(x, y, z, a, b);
    const f = (t * 9) % 1;
    if (f < 0.1) return molten(true);
    if (ny < -0.5) return molten(false);
    return f > 0.75 ? pk(GOLD.white, VF.METAL) : gold(ny);
  };
}
function wingPart(m: VoxelModel, seg: [V3, V3, number, number], fs: Feather[]) {
  const bf = boneF(seg), ff = feathersF(fs);
  const box = bounds([seg[0], seg[1]], seg[2] + 0.6);
  for (const f of fs)
    for (let a = 0; a < 3; a++) {
      box[a] = Math.min(box[a], f.box[a]);
      box[a + 3] = Math.max(box[a + 3], f.box[a + 3]);
    }
  const bp = bonePaint(seg), fp = paintFeathers(fs);
  sculpt(m, box, (x, y, z) => Math.min(bf(x, y, z), ff(x, y, z)), (x, y, z, nx, ny, nz) => (bf(x, y, z) < 0.3 ? bp(x, y, z, nx, ny, nz) : fp(x, y, z, nx, ny, nz)));
}

// ----------------------------------------------------------------------------- tail fan (flame tail feathers behind the trunk)
function tailFan(): Feather[] {
  const out: Feather[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i - 3) * 0.17;
    const base: V3 = [Math.sin(a) * 1.6, 9.6, -2.2 - Math.cos(a) * 0.3];
    const dir = norm([Math.sin(a) * 0.55, -1, -0.38]);
    out.push(feather(base, dir, [1, 0, 0], 7.6 - Math.abs(i - 3) * 0.55, 1.25, 0.2, 'fire', 500 + i, 0.02 * (i - 3), -0.12));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i - 1.5) * 0.3;
    out.push(feather([Math.sin(a) * 2.2, 10.8, -2.85], norm([Math.sin(a) * 0.4, -1, -0.3]), [1, 0, 0], 2.8, 1.2, 0.2, 'gold', 520 + i, 0.02, -0.04));
  }
  return out;
}

// ----------------------------------------------------------------------------- head (head-local metres; built twice: body rig 1/5, close-up 1/10)
// beak centre line: base at the cere, hooking down to the point
const BK: [V3, number][] = [
  [[0, 2.42, 2.05], 0.78],
  [[0, 2.38, 3.0], 0.62],
  [[0, 2.05, 3.78], 0.45],
  [[0, 1.42, 4.12], 0.26],
  [[0, 0.86, 3.96], 0.08],
];
const JW: [V3, number][] = [
  [[0, 1.76, 2.2], 0.5],
  [[0, 1.46, 3.2], 0.3],
  [[0, 1.28, 3.64], 0.13],
];
function chainD(x: number, y: number, z: number, ch: [V3, number][], sx: number) {
  let d = 9;
  const xs = x / sx;
  for (let i = 0; i < ch.length - 1; i++) d = Math.min(d, coneV(xs, y, z, ch[i][0], ch[i + 1][0], ch[i][1], ch[i + 1][1]));
  return d * sx;
}
function crestFeathers(): Feather[] {
  const out: Feather[] = [];
  for (let i = 0; i < 9; i++) {
    const s = (i - 4) / 4;
    const base: V3 = [s * 1.35, 3.55 - Math.abs(s) * 0.55, -0.35 - Math.abs(s) * 0.4];
    const dir = norm([s * 0.55, -0.42 - Math.abs(s) * 0.2, -1]);
    out.push(feather(base, dir, [1, 0, 0.0], 4.6 - Math.abs(s) * 1.2, 0.95, 0.18, 'fire', 600 + i, s * 0.25, 0.32));
  }
  // side lappets: gold plates down behind the cheeks, like a nemes of metal feathers
  for (const sx of [1, -1])
    for (let i = 0; i < 3; i++)
      out.push(feather([sx * (1.55 + i * 0.12), 2.6 - i * 0.6, -0.5 - i * 0.25], norm([sx * 0.25, -1, -0.45]), [0, 0, 1], 2.4 - i * 0.3, 0.95, 0.18, 'gold', 640 + i + (sx > 0 ? 0 : 5), 0.02, 0.02));
  return out;
}
const CREST = crestFeathers();
const CREST_F = feathersF(CREST);
const CREST_P = paintFeathers(CREST);
/**
 * Feather scallops on the head: rows run from the beak back over the skull,
 * staggered; returns [edge 0..1 (1 on a feather's rim), centre 0..1, row tone].
 */
function plumeCell(x: number, y: number, z: number): [number, number, number] {
  const u = Math.atan2(x, y - 1.6) * 1.9; // round the head
  const v = (2.4 - z) * 2.3 + Math.abs(x) * 0.25; // back from the beak
  const row = Math.floor(v), fv = v - row;
  const uu = u * 2.4 + (row % 2) * 0.5;
  const col = Math.floor(uu), fu = uu - col;
  const d = Math.hypot((fu - 0.5) * 1.15, fv * 0.95); // a feather tip rounds off toward the back
  const edge = sstep(0.42, 0.56, d) * (1 - sstep(0.62, 0.7, d));
  return [edge, 1 - Math.min(1, d / 0.56), h3(row, col, 3, 79)];
}
function skullD(x: number, y: number, z: number) {
  let d = ell(x, y, z, 0, 2.7, -0.35, 1.78, 1.85, 2.25); // cranium: wide at the back
  d = smin(d, ell(x, y, z, 0, 2.55, 1.2, 1.0, 1.2, 1.45), 0.8); // a narrow forehead sloping into the beak
  for (let s = 1; s >= -1; s -= 2) {
    d = smin(d, ell(x, y, z, s * 0.8, 1.65, 0.6, 0.7, 0.9, 1.0), 0.6); // cheek / jowl
    d = smin(d, cone(x, y, z, s * 1.72, 3.42, 0.95, s * 0.58, 3.1, 2.22, 0.38, 0.26), 0.25); // brow ridge: a hard shelf over the eye
  }
  d = smin(d, cone(x, y, z, 0, -0.1, -0.45, 0, 1.4, 0.05, 1.15, 1.35), 0.8); // throat
  return d;
}
function headF(x: number, y: number, z: number) {
  let d = skullD(x, y, z);
  if (d < 1.4) {
    // falcon plumage: rows of scalloped feathers, each tip a little proud
    const pc = plumeCell(x, y, z);
    d -= 0.05 * pc[1];
  }
  d = Math.min(d, chainD(x, y, z, BK, 0.74)); // upper beak
  d = smin(d, ell(x, y, z, 0, 2.46, 2.2, 0.72, 0.6, 0.36), 0.15); // cere
  for (let s = 1; s >= -1; s -= 2) {
    d = smax(d, -ell(x, y, z, s * EYE_L[0], EYE_L[1], EYE_L[2], 0.62, 0.6, 0.6), 0.12); // eye socket
    d = smax(d, -ell(x, y, z, s * 0.3, 2.55, 2.36, 0.11, 0.1, 0.16), 0.04); // nostril
  }
  // the mouth line under the beak: cut so the jaw can open
  d = smax(d, -Math.max(chainD(x, y, z, JW, 0.8) + 0.04, -(y - 1.25)), 0.05);
  d = Math.min(d, CREST_F(x, y, z));
  return d;
}
function headPaint(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
  if (CREST_F(x, y, z) < 0.12 && skullD(x, y, z) > -0.05) return CREST_P(x, y, z, nx, ny, nz);
  // beak: gold, burnt dark toward the hooked point, the cere white-hot
  if (chainD(x, y, z, BK, 0.74) < 0.12 && z > 2.05) {
    if (ell(x, y, z, 0, 2.46, 2.2, 0.74, 0.62, 0.38) < 0.05) {
      if (ell(x, y, z, Math.sign(x) * 0.3, 2.55, 2.36, 0.15, 0.14, 0.2) < 0.02) return pk(SOCKET);
      return pk(MOLTEN.white, VF.GLOW);
    }
    const tip = clamp01((z - 3.1) / 0.8) * clamp01((2.3 - y) / 1.2);
    if (tip > 0.55) return pk(tip > 0.8 ? BEAK.tip : BEAK.burnt, VF.METAL);
    if (y < 1.95 && Math.abs(x) > 0.25) return molten(false); // the cutting edge glows
    return pk(ny > 0.5 ? BEAK.hi : ny > -0.3 ? BEAK.base : BEAK.shade, VF.METAL);
  }
  for (let s = 1; s >= -1; s -= 2) {
    const ex = x - s * EYE_L[0], ey = y - EYE_L[1], ez = z - EYE_L[2];
    const er = Math.hypot(ex, ey, ez);
    // eye ring: a molten gold rim round the socket
    if (er < 0.8) return er < 0.66 ? pk(SOCKET) : molten(true);
    // the Eye-of-Ra malar stripe: an obsidian teardrop sweeping down the cheek, gold-rimmed
    const my = EYE_L[1] - 0.55 - y;
    if (my > -0.1 && my < 1.35 && x * s > 0.4) {
      const cx = s * (EYE_L[0] - 0.08 - my * 0.18), cz = EYE_L[2] - 0.15 - my * 0.3;
      const w = 0.36 * (1 - my / 1.6) + 0.06;
      const dd = Math.hypot((x - cx) * 0.9, z - cz);
      if (dd < w) return pk(dd > w - 0.12 ? GOLD.hi : OBSIDIAN.base, dd > w - 0.12 ? VF.METAL : VF.SOLID);
    }
    // a long gold kohl line behind the eye (the god's painted eye)
    if (x * s > 0.9 && Math.abs(y - (EYE_L[1] - 0.05 - (EYE_L[2] - z) * 0.08)) < 0.09 && z < EYE_L[2] - 0.6 && z > EYE_L[2] - 1.9) return pk(GOLD.hi, VF.METAL);
  }
  // inside the mouth: a furnace
  if (chainD(x, y, z, JW, 0.8) < 0.25 && y < 1.95 && z > 2.0) return pk(MOLTEN.orange, VF.GLOW);
  // plumage: scalloped feathers flowing back from the beak, an ember edge on each, lighter on the crown
  const pc = plumeCell(x, y, z);
  if (pc[0] > 0.88) return pk(PLUME.edge, VF.EMISSIVE);
  const lift = 0.3 + (y - 1.0) / 3.2 + pc[1] * 0.3 + (pc[2] - 0.5) * 0.3;
  const c = lift > 0.85 ? PLUME.hi : lift > 0.4 ? PLUME.base : PLUME.shade;
  return pk(c, VF.EMISSIVE);
}
function jawF(x: number, y: number, z: number) {
  return Math.max(chainD(x, y, z, JW, 0.78), y - 1.95);
}
function jawPaint(x: number, y: number, z: number, _nx: number, ny: number, _nz = 0) {
  if (ny > 0.5) return pk(MOLTEN.orange, VF.GLOW); // tongue-side: the furnace
  const tip = clamp01((z - 3.0) / 0.5);
  void x;
  return pk(tip > 0.5 ? BEAK.burnt : ny > -0.3 ? BEAK.base : BEAK.shade, VF.METAL);
}
/** the gold brow plate over the left eye (its own part: it glares) */
function browF(x: number, y: number, z: number) {
  return cone(x, y, z, 1.74, 3.6, 1.0, 0.46, 3.24, 2.38, 0.27, 0.18);
}
function browPaint(x: number, y: number, z: number, _nx: number, ny: number, _nz = 0) {
  void x;
  void z;
  if (ny < -0.45) return molten(true);
  return gold(ny);
}
const HEAD_BOX = [-3.4, -1.3, -5.5, 3.4, 4.9, 4.5];

// ----------------------------------------------------------------------------- the eye (eye-local metres: +Z the gaze)
function eyeF(x: number, y: number, z: number) {
  const r = Math.hypot(x, y, z);
  // the cornea bulges a little over the iris
  const th = Math.acos(clamp01(z / (r || 1)));
  return r - EYE_R - (th < 0.7 ? 0.03 * Math.cos(th * 2.2) : 0);
}
function eyePaint(x: number, y: number, z: number) {
  const r = Math.hypot(x, y, z) || 1;
  const th = Math.acos(Math.max(-1, Math.min(1, z / r)));
  const az = Math.atan2(y, x);
  // glint: up and toward the beak
  if (Math.hypot(th - 0.38, (az - 2.3) * 0.35) < 0.07) return pk(EYE.glint, VF.GLOW);
  if (th < 0.17) return pk(EYE.pupil);
  if (th < 0.235) return pk(EYE.corona, VF.GLOW); // the eclipse corona round the pupil
  if (th < 0.62) {
    // radial fibres: streaks running out from the pupil
    const f = (th - 0.235) / 0.385;
    const fib = vn(az * 9, f * 0.9, 0.5, 91);
    if (fib > 0.68) return pk(EYE.fibre, VF.GLOW);
    return pk(f < 0.35 ? EYE.iris0 : f < 0.7 ? EYE.iris1 : EYE.iris2, VF.GLOW);
  }
  if (th < 0.72) return pk(EYE.limbal, VF.EMISSIVE);
  return pk(EYE.back);
}

// ----------------------------------------------------------------------------- the sun disc, its core and the uraeus
/** distance to the 24 tapered rays round the rim (long and short alternating), and the ray's fraction out */
function rayD(dx: number, dy: number, dz: number, out?: number[]) {
  const rho = Math.hypot(dx, dy), rr = rho - DISC_R;
  if (rr < 0 || rr > 2.6) return 9;
  const sector = ((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * 24;
  const si = Math.floor(sector), sf = sector - si - 0.5;
  const L = si % 2 ? 1.15 : 1.95;
  const k = clamp01(rr / L);
  const across = Math.abs(sf) * ((Math.PI * 2 * rho) / 24);
  if (out) out[0] = k;
  return Math.max(across - 0.46 * (1 - k) - 0.04, Math.abs(dz) - 0.32 * (1 - k) - 0.08, rr - L);
}
function rimF(x: number, y: number, z: number) {
  const dx = x - DISC_C[0], dy = y - DISC_C[1], dz = z - DISC_C[2];
  const rho = Math.hypot(dx, dy);
  let d = Math.hypot(rho - DISC_R, dz * 1.2) - 0.5; // the rim
  d = Math.min(d, rayD(dx, dy, dz));
  // engraved inner lip
  d = Math.min(d, Math.max(Math.abs(rho - DISC_R + 0.55) - 0.12, Math.abs(dz - 0.35) - 0.42));
  return Math.min(d, promD(dx, dy, dz));
}
/** coronal prominences: plasma arches springing off the rim, in the disc plane */
const PROMS: [number, number, number][] = [
  [0.55, 0.95, 1.6],
  [2.1, 2.42, 1.3],
  [3.6, 4.1, 2.0],
  [5.3, 5.62, 1.2],
];
function promD(dx: number, dy: number, dz: number) {
  let d = 9;
  for (const [a0, a1, h] of PROMS) {
    const am = (a0 + a1) / 2, half = (a1 - a0) / 2;
    const ux = Math.cos(am), uy = Math.sin(am);
    const lx = dx - ux * DISC_R, ly = dy - uy * DISC_R;
    const ta = lx * -uy + ly * ux; // along the rim
    const tn = lx * ux + ly * uy; // outward
    if (tn < -0.4) continue;
    const chord = DISC_R * Math.sin(half);
    const arch = Math.hypot(ta / chord, tn / h);
    d = Math.min(d, Math.hypot((arch - 1) * Math.min(chord, h), dz * 0.9) - 0.26 + (tn < 0 ? -tn * 0.5 : 0));
  }
  return d;
}
const _ro = [0];
function rimPaint(x: number, y: number, z: number, _nx: number, ny: number, nz: number) {
  const dx = x - DISC_C[0], dy = y - DISC_C[1], dz = z - DISC_C[2];
  const rho = Math.hypot(dx, dy);
  if (rho > DISC_R + 0.42) {
    if (rayD(dx, dy, dz, _ro) < 0.1) return _ro[0] > 0.62 ? molten(true) : _ro[0] > 0.5 ? molten(false) : gold(ny);
    return plasma(0.35 + 0.4 * clamp01(1 - (rho - DISC_R) / 2.2), x, y, z, 1, true);
  }
  if (Math.abs(rho - DISC_R + 0.55) < 0.14 && dz > 0) return molten(true);
  // lapis cartouche cells round the front face of the rim
  const g = Math.floor((Math.atan2(dy, dx) + Math.PI) * 9);
  if (nz > 0.5 && Math.abs(rho - DISC_R) < 0.22 && g % 3 === 0) return pk(LAPIS.base);
  return gold(ny);
}
function coreF(x: number, y: number, z: number) {
  const dx = x - DISC_C[0], dy = y - DISC_C[1], dz = z - DISC_C[2];
  // a plasma lens bulging forward, its surface boiling in granules
  const g = cell2(dx * 1.4, dy * 1.4, 41);
  return ell(dx, dy, dz, 0, 0, 0.2, DISC_R - 0.45, DISC_R - 0.45, 1.05) - 0.06 * sstep(0, 0.2, g[1]);
}
function corePaint(x: number, y: number, z: number) {
  const dx = x - DISC_C[0], dy = y - DISC_C[1];
  const rho = Math.hypot(dx, dy) / (DISC_R - 0.45);
  // sunspots: dark umbra in an orange penumbra
  for (const [sx, sy, sr] of SPOTS) {
    const d = Math.hypot(dx - sx, dy - sy);
    if (d < sr * 0.45) return pk(0x3a1408, VF.EMISSIVE);
    if (d < sr) return pk(PLASMA[5], VF.EMISSIVE);
  }
  const g = cell2(dx * 1.4, dy * 1.4, 41);
  // limb darkening: white-hot middle, cooling toward the edge
  let heat = 1.08 - rho * rho * 0.55;
  if (g[1] < 0.12) heat -= 0.22; // granule lanes
  void z;
  return plasma(heat, x, y, z, 0.6);
}
const SPOTS: [number, number, number][] = [
  [-1.6, 1.1, 0.55],
  [-1.1, 1.5, 0.32],
  [1.9, -1.4, 0.42],
];
// uraeus: a gold cobra coiled round the foot of the disc, rearing in front of it
const URA_PATH: V3[] = (() => {
  const pts: V3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 - 0.95 + (i / 12) * 0.95; // along the rim to the bottom centre
    pts.push([Math.cos(a) * (DISC_R + 0.25), DISC_C[1] + Math.sin(a) * (DISC_R + 0.25), DISC_C[2] + 0.75]);
  }
  pts.push([0, DISC_C[1] - DISC_R + 0.15, DISC_C[2] + 1.15]);
  pts.push([0, DISC_C[1] - DISC_R + 0.95, DISC_C[2] + 1.45]);
  pts.push([0, DISC_C[1] - DISC_R + 1.75, DISC_C[2] + 1.5]);
  return pts;
})();
const URA_HOOD: V3 = [0, DISC_C[1] - DISC_R + 1.95, DISC_C[2] + 1.45];
const URA_HEAD: V3 = [0, DISC_C[1] - DISC_R + 2.45, DISC_C[2] + 1.75];
function uraeusF(x: number, y: number, z: number) {
  let d = 9;
  const n = URA_PATH.length;
  for (let i = 0; i < n - 1; i++) {
    const r0 = 0.18 + 0.2 * (i / n), r1 = 0.18 + 0.2 * ((i + 1) / n);
    d = Math.min(d, coneV(x, y, z, URA_PATH[i], URA_PATH[i + 1], r0, r1));
  }
  d = smin(d, ell(x, y, z, URA_HOOD[0], URA_HOOD[1], URA_HOOD[2], 0.85, 1.0, 0.22), 0.25); // hood
  d = smin(d, ell(x, y, z, URA_HEAD[0], URA_HEAD[1], URA_HEAD[2], 0.32, 0.25, 0.5), 0.2); // head
  return d;
}
function uraeusPaint(x: number, y: number, z: number, _nx: number, ny: number, nz: number) {
  // eyes: two glowing points
  for (const s of [1, -1]) if (Math.hypot(x - s * 0.22, y - URA_HEAD[1] - 0.06, z - URA_HEAD[2] - 0.1) < 0.12) return pk(MOLTEN.white, VF.GLOW);
  if (ell(x, y, z, URA_HOOD[0], URA_HOOD[1], URA_HOOD[2], 0.86, 1.02, 0.24) < 0.06 && nz > 0.3) {
    // hood front: lapis and gold bands, a molten centre line
    if (Math.abs(x) < 0.1) return molten(true);
    return Math.floor((URA_HOOD[1] + 1 - y) * 3.2) % 2 ? pk(LAPIS.base) : gold(ny);
  }
  const sc = (y * 4 + x * 2) % 1;
  return sc < 0.15 ? pk(GOLD.shade, VF.METAL) : gold(ny);
}

// ============================================================================= the colossus
export function raRig(): RigSpec {
  const rig = new TRig('ra', VS);
  const W = wingSet();

  // ------------------------------------------------------------------ body
  sculpt(rig.part('pelvis', undefined, P(PELVIS_PIV)), [-4.4, 6.6, -3.6, 4.4, 12.6, 3.8], kiltF, kiltPaint);
  const tailCuts = [10.6, 7.4, 4.9, 2.5, -0.4];
  for (let i = 0; i < 4; i++) {
    const yTop = tailCuts[i], yBot = tailCuts[i + 1];
    const c = trunkC(yTop);
    const parent = i === 0 ? 'pelvis' : 'tail' + i;
    const lo = i === 3 ? yBot : yBot - 0.5;
    sculpt(rig.part('tail' + (i + 1), parent, P([c[0], yTop, c[1]])), [-4.2, lo, -6.2, 4.2, yTop + 0.3, 4.0], (x, y, z) => (y < lo || y > yTop + 0.3 ? 1 : trunkF(x, y, z)), trunkPaint);
  }
  const fan = tailFan();
  {
    const m = rig.part('tailfan', 'pelvis', P([0, 10.2, -2.2]));
    const ff = feathersF(fan), fp = paintFeathers(fan);
    const box = bounds([[0, 10, -2]], 1);
    for (const f of fan)
      for (let a = 0; a < 3; a++) {
        box[a] = Math.min(box[a], f.box[a]);
        box[a + 3] = Math.max(box[a + 3], f.box[a + 3]);
      }
    sculpt(m, box, ff, fp);
  }
  sculpt(rig.part('torso', 'pelvis', P(TORSO_PIV)), [-7.0, 11.4, -4.2, 7.0, 22.6, 4.6], torsoF, torsoPaint);

  // ------------------------------------------------------------------ head (the close-up version is built by raHeadHD)
  // head-local metric fields (the head is designed at 1 and grown by HS)
  const local = (f: Field): Field => {
    const g = hfS(f);
    return (x, y, z) => g(x - HEAD_PIV[0], y - HEAD_PIV[1], z - HEAD_PIV[2]);
  };
  const localP = (p: Paint): Paint => {
    const g = hpS(p);
    return (x, y, z, nx, ny, nz) => g(x - HEAD_PIV[0], y - HEAD_PIV[1], z - HEAD_PIV[2], nx, ny, nz);
  };
  const hb = HEAD_BOX.map((v) => v * HS);
  sculpt(rig.part('head', 'torso', P(HEAD_PIV)), [hb[0], hb[1] + HEAD_PIV[1], hb[2] + HEAD_PIV[2], hb[3], hb[4] + HEAD_PIV[1], hb[5] + HEAD_PIV[2]], local(headF), localP(headPaint));
  sculpt(rig.part('jaw', 'head', P(hp(JAW_PIV))), bounds([hp([0, 1.6, 2.3]), hp([0, 1.3, 3.7])], 0.8), local(jawF), localP(jawPaint));
  const ec = hp(EYE_L);
  sculpt(rig.part('eye_l', 'head', P(ec)), bounds([ec], EYE_R * HS + 0.3), (x, y, z) => {
    const l = eyeLocal((x - ec[0]) / HS, (y - ec[1]) / HS, (z - ec[2]) / HS);
    return eyeF(l[0], l[1], l[2]) * HS;
  }, (x, y, z) => {
    const l = eyeLocal((x - ec[0]) / HS, (y - ec[1]) / HS, (z - ec[2]) / HS);
    return eyePaint(l[0], l[1], l[2]);
  });
  sculpt(rig.part('brow_l', 'head', P(hp(BROW_PIV))), bounds([hp([1.74, 3.6, 1.0]), hp([0.46, 3.24, 2.38])], 0.7), local(browF), localP(browPaint));

  // ------------------------------------------------------------------ the sun disc
  const disc = rig.part('disc', 'torso', P(DISC_C));
  sculpt(disc, [DISC_C[0] - DISC_R - 2.4, DISC_C[1] - DISC_R - 2.4, DISC_C[2] - 1.4, DISC_C[0] + DISC_R + 2.4, DISC_C[1] + DISC_R + 2.4, DISC_C[2] + 1.2], (x, y, z) => {
    // the rim, and a back plate (the disc is solid from behind)
    const dx = x - DISC_C[0], dy = y - DISC_C[1], dz = z - DISC_C[2];
    const back = Math.max(Math.hypot(dx, dy) - DISC_R + 0.1, Math.abs(dz + 0.55) - 0.32);
    return Math.min(rimF(x, y, z), back);
  }, (x, y, z, nx, ny, nz) => {
    const dz = z - DISC_C[2];
    if (dz < -0.4 && Math.hypot(x - DISC_C[0], y - DISC_C[1]) < DISC_R - 0.3) {
      // the back plate: gold with concentric molten rings
      const r = Math.hypot(x - DISC_C[0], y - DISC_C[1]);
      return r % 1.1 < 0.12 ? molten(false) : gold(ny);
    }
    return rimPaint(x, y, z, nx, ny, nz);
  });
  sculpt(rig.part('core', 'disc', P(DISC_C)), [DISC_C[0] - DISC_R, DISC_C[1] - DISC_R, DISC_C[2] - 1.0, DISC_C[0] + DISC_R, DISC_C[1] + DISC_R, DISC_C[2] + 1.4], coreF, corePaint);
  sculpt(rig.part('uraeus', 'disc', P(URA_PATH[12])), bounds([...URA_PATH, URA_HOOD, URA_HEAD], 1.1), uraeusF, uraeusPaint);

  // ------------------------------------------------------------------ arm, forearm, hand, fingers
  sculpt(rig.part('arm_l', 'torso', P(SH)), bounds([SH, EL], 2.3), armF, armPaint);
  sculpt(rig.part('fore_l', 'arm_l', P(EL)), bounds([EL, WR], 1.3), foreF, forePaint);
  const pc: V3[] = [];
  for (const cx of [-1.0, 1.0]) for (const cy of [-0.6, 0.6]) for (const cz of [-0.5, 2.0]) pc.push(fromHand([cx, cy, cz]));
  sculpt(rig.part('hand_l', 'fore_l', P(WR)), bounds(pc, 0.2), palmF, handPaint);
  const fingerAxes: V3[] = [];
  FINGERS.forEach((f, k) => {
    const K: V3 = [f.x, -0.05, f.z];
    const J = add(K, fdir(f.sp, REST_CURL[0]), f.l1);
    const T = add(J, fdir(f.sp, REST_CURL[0] + REST_CURL[1]), f.l2);
    const [Kr, Jr, Tr] = [fromHand(K), fromHand(J), fromHand(T)];
    sculpt(rig.part(`fing${k + 1}_l`, 'hand_l', P(Kr)), bounds([Kr, Jr], f.r0 + 0.4), digit(Kr, Jr, f.r0, f.r1, false), digitPaint(Jr, f.r1, false));
    const tdir = norm(sub(Tr, Jr));
    sculpt(rig.part(`tip${k + 1}_l`, `fing${k + 1}_l`, P(Jr)), bounds([Jr, add(Tr, tdir, 0.5)], f.r1 + 0.4), digit(Jr, Tr, f.r1, f.r2, true), digitPaint(Tr, f.r2, true));
    fingerAxes.push(handVec([Math.cos(f.sp), 0, -Math.sin(f.sp)]));
  });
  {
    const B = THUMB.b, J = add(B, THUMB.d1, THUMB.l1), T = add(J, THUMB.d2, THUMB.l2);
    const [Br, Jr, Tr] = [fromHand(B), fromHand(J), fromHand(T)];
    sculpt(rig.part('thumb_l', 'hand_l', P(Br)), bounds([Br, Jr], THUMB.r[0] + 0.4), digit(Br, Jr, THUMB.r[0], THUMB.r[1], false), digitPaint(Jr, THUMB.r[1], false));
    const tdir = norm(sub(Tr, Jr));
    sculpt(rig.part('thumbtip_l', 'thumb_l', P(Jr)), bounds([Jr, add(Tr, tdir, 0.5)], THUMB.r[1] + 0.4), digit(Jr, Tr, THUMB.r[1], THUMB.r[2], true), digitPaint(Tr, THUMB.r[2], true));
  }
  const thumbAxis = handVec(norm(cross(THUMB.d1, norm([0.55, -0.55, 0.62]))));

  // ------------------------------------------------------------------ wings
  wingPart(rig.part('wing_l', 'torso', P(W0)), W.bone[0], W.inner);
  wingPart(rig.part('wing2_l', 'wing_l', P(W1)), W.bone[1], W.mid);
  wingPart(rig.part('wing3_l', 'wing2_l', P(W2)), W.bone[2], W.outer);

  // ------------------------------------------------------------------ sockets, mirror, build
  const palm = fromHand([0, -0.5, 1.0]);
  rig.socket('core', 'core', P([DISC_C[0], DISC_C[1], DISC_C[2] + 1.25]));
  rig.socket('mouth', 'head', P(hp([0, 1.7, 3.5])));
  rig.socket('head_top', 'head', P(hp([0, 4.2, 0])));
  rig.socket('chest', 'torso', P([0, 18.0, 2.6]));
  rig.socket('hand_l', 'hand_l', P(palm));
  rig.socket('wingtip_l', 'wing3_l', P(add(WT, [3.5, -5.5, -1.5])));
  rig.socket('wingmid_l', 'wing2_l', P(add(lerp3(W1, W2, 0.5), [0, -4.5, -0.8])));
  rig.socket('tailtip', 'tail4', P([trunkC(0.3)[0], 0.3, trunkC(0.3)[1]]));
  rig.socket('gaze_l', 'eye_l', P(add(ec, EYE_AX, EYE_R * HS)));
  rig.mirrorLR();

  const K0 = fromHand([0, -0.5, 1.6]);
  const ik = {
    shoulder: RL(SH),
    elbow: RL(EL),
    wrist: RL(WR),
    knuckle: RL(K0),
    palm: RL(palm),
    fist: RL(add(K0, handVec([0, -0.5, 0.1]))),
    handX: HL,
    handY: HU,
    handZ: HF,
    fingerAxes,
    thumbAxis,
    restCurl: REST_CURL,
  };
  return rig.build({
    kind: 'ra',
    boss: true,
    height: 34,
    radius: 6.5,
    ik,
    mirrorX: 1 / S,
    disc: RL(DISC_C),
    discR: DISC_R,
    headPivot: RL(HEAD_PIV),
    eyeCenter: RL(ec),
    eyeAxis: EYE_AX,
    eyeR: EYE_R * HS,
    chest: RL([0, 17.6, 1.2]),
    wing: { w0: RL(W0), w1: RL(W1), w2: RL(W2), wt: RL(WT) },
    hd: { headS: RA_HEAD_S, eyeS: RA_EYE_S },
    defaultExpression: 'smug',
    expressions: {
      neutral: { jaw: 0, brow: [0, 0] },
      smug: { jaw: 0.02, brow: [0.06, -0.06] },
      angry: { jaw: 0.1, brow: [-0.16, 0.16] },
      hurt: { jaw: 0.24, brow: [0.12, -0.12] },
      laugh: { jaw: 0.3, brow: [0.1, -0.1] },
      stunned: { jaw: 0.22, brow: [0.2, -0.2] },
      enraged: { jaw: 0.34, brow: [-0.26, 0.26] },
      defeated: { jaw: 0.4, brow: [0.24, -0.24] },
    },
    noEyes: true,
  });
}
/** eye-local frame: +Z along the left eye's gaze axis */
const EZ = EYE_AX;
const EX = norm(cross([0, 1, 0], EZ));
const EY = cross(EZ, EX);
function eyeLocal(x: number, y: number, z: number): V3 {
  return [x * EX[0] + y * EX[1] + z * EX[2], x * EY[0] + y * EY[1] + z * EY[2], x * EZ[0] + y * EZ[1] + z * EZ[2]];
}

// ============================================================================= close-up head and eyes
/**
 * The head at 1/10 m (the boss swaps it in over the body-rig head): head-local
 * voxels, pivot at the head pivot. The jaw and brows stay rig parts.
 */
export function raHeadHD(): { model: VoxelModel; voxelSize: number; pivot: V3 } {
  const m = new VoxelModel('ra_head_hd');
  const s = RA_HEAD_S;
  const g = new Grid(s, HEAD_BOX.map((v) => v * HS));
  g.fill(hfS(headF));
  g.emit(m, hpS(headPaint));
  return { model: m, voxelSize: 1 / s, pivot: Pv([0, 0, 0], s) };
}
/** a jaw at 1/10 m, jaw-pivot local */
export function raJawHD(): { model: VoxelModel; voxelSize: number; pivot: V3 } {
  const m = new VoxelModel('ra_jaw_hd');
  const s = RA_HEAD_S;
  const o = JAW_PIV;
  const g = new Grid(s, bounds([sub([0, 1.6, 2.3], o), sub([0, 1.3, 3.7], o)], 0.8).map((v) => v * HS));
  const f = hfS((x, y, z) => jawF(x + o[0], y + o[1], z + o[2]));
  const pnt = hpS((x, y, z, nx, ny, nz) => jawPaint(x + o[0], y + o[1], z + o[2], nx, ny, nz));
  g.fill(f);
  g.emit(m, pnt);
  return { model: m, voxelSize: 1 / s, pivot: Pv([0, 0, 0], s) };
}
/**
 * A modelled eye at 1/24 m, centred on the eyeball, sculpted in the left eye's
 * frame (+Z gaze); `right` mirrors it. The boss parents it to eye_l / eye_r.
 */
export function raEyeHD(right = false): { model: VoxelModel; voxelSize: number; pivot: V3 } {
  const m = new VoxelModel(right ? 'ra_eye_r_hd' : 'ra_eye_l_hd');
  const s = RA_EYE_S;
  const r = EYE_R * HS + 0.15;
  const g = new Grid(s, [-r, -r, -r, r, r, r]);
  // sculpt in rig orientation: the eye frame rotated into head space (design units, grown by HS)
  const toE = (x: number, y: number, z: number) => eyeLocal((right ? -x : x) / HS, y / HS, z / HS);
  g.fill((x, y, z) => {
    const l = toE(x, y, z);
    return eyeF(l[0], l[1], l[2]) * HS;
  });
  g.emit(m, (x, y, z) => {
    const l = toE(x, y, z);
    return eyePaint(l[0], l[1], l[2]);
  });
  return { model: m, voxelSize: 1 / s, pivot: [0.5, 0, 0] };
}

// ============================================================================= fire falcon (Jumpin' Jack Flash)
/**
 * A falcon of living flame, ~2 m long, 4.4 m span, 1/12 m. Bird convention:
 * body (root), head, wing_l / wing_r (→ wtip_l / wtip_r), tail. Faces +Z.
 */
export function fireFalconRig(): RigSpec {
  const s = 12;
  const rig = new TRig('ra_falcon', 1 / s);
  const Pf = (m: V3) => Pv(m, s);
  const bodyF: Field = (x, y, z) => {
    let d = ell(x, y, z, 0, 0, 0, 0.34, 0.32, 0.85);
    d = smin(d, ell(x, y, z, 0, 0.06, 0.45, 0.3, 0.3, 0.42), 0.15); // chest
    d = smin(d, ell(x, y, z, 0, 0.02, -0.7, 0.18, 0.12, 0.42), 0.12); // rump
    return d;
  };
  const bodyP: Paint = (x, y, z, _nx, ny) => {
    // breast barring: cooler stripes across a hot chest, darker back
    if (ny > 0.4) return plasma(0.45, x, y, z);
    if (Math.floor(z * 9 + Math.sin(x * 12) * 0.4) % 2 === 0 && ny < -0.2) return plasma(0.62, x, y, z);
    return plasma(0.8, x, y, z);
  };
  sculpt(rig.part('body', undefined, Pf([0, 0, 0])), [-0.6, -0.5, -1.3, 0.6, 0.5, 1.1], bodyF, bodyP, s);
  const headFf: Field = (x, y, z) => {
    let d = ell(x, y, z, 0, 0.12, 0.98, 0.21, 0.22, 0.26);
    d = smin(d, cone(x, y, z, 0, 0.12, 1.16, 0, 0.02, 1.36, 0.09, 0.02), 0.04); // hooked beak
    for (const sx of [1, -1]) d = smax(d, -ell(x, y, z, sx * 0.13, 0.17, 1.06, 0.07, 0.07, 0.07), 0.02);
    return d;
  };
  sculpt(rig.part('head', 'body', Pf([0, 0.1, 0.82])), [-0.35, -0.2, 0.65, 0.35, 0.45, 1.45], (x, y, z) => {
    let d = headFf(x, y, z);
    for (const sx of [1, -1]) d = Math.min(d, ell(x, y, z, sx * 0.13, 0.17, 1.06, 0.06, 0.06, 0.06)); // eyeballs
    return d;
  }, (x, y, z, _nx, ny) => {
    for (const sx of [1, -1]) {
      const r = Math.hypot(x - sx * 0.13, y - 0.17, z - 1.06);
      if (r < 0.075) return r < 0.03 && z > 1.09 ? pk(EYE.pupil) : pk(EYE.iris0, VF.GLOW);
    }
    if (z > 1.16) return pk(z > 1.3 ? BEAK.tip : BEAK.base, VF.METAL);
    if (y < 0.06 && Math.abs(x) > 0.08) return pk(OBSIDIAN.base); // malar stripe
    return plasma(ny > 0 ? 0.7 : 0.55, x, y, z);
  }, s);
  // wing: bone + 6 primaries + 5 secondaries, all flame
  const a0: V3 = [0.25, 0.12, 0.25], a1: V3 = [1.05, 0.28, 0.05], a2: V3 = [2.05, 0.18, -0.25];
  const fs1: Feather[] = [], fs2: Feather[] = [];
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    fs1.push(feather(lerp3(a0, a1, t), norm([0.15, 0, -1]), [1, 0, 0], 0.85 + t * 0.2, 0.3, 0.04, 'fire', 700 + i, 0.02, 0));
  }
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    fs2.push(feather(lerp3(a1, a2, t), norm([0.25 + t * 0.9, 0, -1 + t * 0.6]), [1, 0, 0.3], 1.05 + t * 0.35, 0.28, 0.04, 'fire', 710 + i, 0.03, 0));
  }
  const wingSeg = (a: V3, b: V3, fs: Feather[]): [Field, Paint, number[]] => {
    const ff = feathersF(fs), fp = paintFeathers(fs);
    const box = bounds([a, b], 0.2);
    for (const f of fs)
      for (let k = 0; k < 3; k++) {
        box[k] = Math.min(box[k], f.box[k]);
        box[k + 3] = Math.max(box[k + 3], f.box[k + 3]);
      }
    const f: Field = (x, y, z) => Math.min(coneV(x, y, z, a, b, 0.08, 0.06), ff(x, y, z));
    const p: Paint = (x, y, z, nx, ny, nz) => (coneV(x, y, z, a, b, 0.08, 0.06) < 0.05 ? gold(ny) : fp(x, y, z, nx, ny, nz));
    return [f, p, box];
  };
  const [f1, p1, b1] = wingSeg(a0, a1, fs1);
  sculpt(rig.part('wing_l', 'body', Pf(a0)), b1, f1, p1, s);
  const [f2, p2, b2] = wingSeg(a1, a2, fs2);
  sculpt(rig.part('wtip_l', 'wing_l', Pf(a1)), b2, f2, p2, s);
  const tf: Feather[] = [];
  for (let i = 0; i < 5; i++) tf.push(feather([(i - 2) * 0.05, 0.02, -0.95], norm([(i - 2) * 0.22, 0, -1]), [1, 0, 0], 0.9 - Math.abs(i - 2) * 0.08, 0.26, 0.04, 'fire', 730 + i, 0, 0.03));
  const tfF = feathersF(tf), tfP = paintFeathers(tf);
  sculpt(rig.part('tail', 'body', Pf([0, 0.02, -0.9])), [-0.7, -0.4, -2.1, 0.7, 0.4, -0.8], tfF, tfP, s);
  rig.socket('beak', 'head', Pf([0, 0.05, 1.38]));
  rig.mirrorLR();
  return rig.build({ kind: 'ra_falcon', height: 0.8, radius: 0.7, length: 2.2 });
}

// ============================================================================= sunfire meteor and the obsidian spire it cools into
/** a molten meteor ~2.6 m across: dark crust, white-hot cracks (1/8 m, centred) */
export function sunMeteorModel(seed = 0): { model: VoxelModel; voxelSize: number } {
  const s = 8;
  const R = (k: number) => h3(seed, k, 5, 73);
  const r0 = 1.25 + R(1) * 0.25;
  const f: Field = (x, y, z) => {
    let d = Math.hypot(x, y * 1.08, z) - r0;
    d += (vn(x * 1.4 + seed, y * 1.4, z * 1.4, 81) - 0.5) * 0.7 + (vn(x * 3.1, y * 3.1, z * 3.1, 82) - 0.5) * 0.22;
    // a leading face flattened by the fall
    d = smax(d, y - r0 * 0.75, 0.4);
    return d;
  };
  const m = new VoxelModel('ra_meteor');
  const g = new Grid(s, [-2.2, -2.2, -2.2, 2.2, 2.2, 2.2]);
  g.fill(f);
  g.emit(m, (x, y, z, _nx, ny) => {
    const ck = Math.abs(vn(x * 1.7 + 3, y * 1.7, z * 1.7, 83) - 0.5);
    if (ck < 0.05) return ck < 0.02 ? pk(MOLTEN.white, VF.GLOW) : pk(MOLTEN.yellow, VF.GLOW);
    if (ck < 0.08) return pk(PLASMA[4], VF.EMISSIVE);
    return pk(ny > 0.4 ? STONE.hi : ny > -0.3 ? STONE.base : STONE.shade);
  });
  return { model: m, voxelSize: 1 / s };
}
/** a jagged obsidian spire (cover in the eclipse): ~5 m tall, molten veins cooling in it; origin = ground under it */
export function obsidianSpireModel(seed = 0): { model: VoxelModel; voxelSize: number } {
  const s = 8;
  const R = (k: number) => h3(seed, k, 9, 37);
  const H = 4.6 + R(1) * 1.4;
  const blades: { a: number; lean: number; h: number; w: number }[] = [];
  for (let i = 0; i < 4; i++) blades.push({ a: R(10 + i) * 6.28, lean: 0.08 + R(20 + i) * 0.22, h: H * (0.55 + R(30 + i) * 0.45), w: 0.55 + R(40 + i) * 0.35 });
  const f: Field = (x, y, z) => {
    // a cluster of faceted shards round a main spire, splayed by the impact
    let d = 9;
    const main = Math.max(Math.abs(x * 0.9 + z * 0.3) + Math.abs(z * 0.9 - x * 0.3) - (1.25 * (1 - y / H) + 0.08), -y - 0.4, y - H);
    d = Math.min(d, main);
    for (const b of blades) {
      const ax = Math.cos(b.a), az = Math.sin(b.a);
      const px = x - ax * (0.6 + y * b.lean), pz = z - az * (0.6 + y * b.lean);
      const sh = Math.max(Math.abs(px * ax + pz * az) * 1.1 + Math.abs(-px * az + pz * ax) - (b.w * (1 - y / b.h) + 0.05), -y - 0.4, y - b.h);
      d = Math.min(d, sh);
    }
    // the splash crater lip of cooled rock
    d = Math.min(d, Math.max(Math.abs(Math.hypot(x, z) - 1.9) - 0.6 + y * 1.3, -y - 0.4, y - 0.5));
    return d + (vn(x * 2, y * 2, z * 2, 61 + seed) - 0.5) * 0.12;
  };
  const m = new VoxelModel('ra_spire');
  const g = new Grid(s, [-3.0, -0.4, -3.0, 3.0, H + 0.2, 3.0]);
  g.fill(f);
  g.emit(m, (x, y, z, nx, ny, nz) => {
    const ck = Math.abs(vn(x * 1.3, y * 0.9, z * 1.3, 64 + seed) - 0.5);
    if (ck < 0.035 && y < H * 0.7) return pk(ck < 0.015 ? MOLTEN.yellow : PLASMA[4], VF.EMISSIVE);
    // glassy facets: a bright edge where the facet faces the sky
    const facet = Math.abs(nx) + Math.abs(nz);
    if (ny > 0.5) return pk(OBSIDIAN.hi);
    return pk(facet > 1.15 ? OBSIDIAN.base : ny < -0.2 ? OBSIDIAN.deep : OBSIDIAN.shade);
  });
  return { model: m, voxelSize: 1 / s };
}
/** the eclipse moon: a cratered basalt disc slid across the sun disc (1/5 m, centred, faces +Z) */
export function eclipseMoonModel(): { model: VoxelModel; voxelSize: number } {
  const R = DISC_R + 0.6;
  const craters: [number, number, number][] = [];
  for (let i = 0; i < 14; i++) craters.push([(h3(i, 1, 2, 51) - 0.5) * R * 1.6, (h3(i, 3, 4, 51) - 0.5) * R * 1.6, 0.35 + h3(i, 5, 6, 51) * 0.9]);
  const f: Field = (x, y, z) => {
    let d = ell(x, y, z, 0, 0, 0, R, R, 1.2);
    for (const [cx, cy, cr] of craters) {
      const cd = Math.hypot(x - cx, y - cy);
      if (cd < cr * 1.3 && z > 0) d += 0.18 * (1 - sstep(0, cr, cd)) - 0.08 * Math.exp(-(((cd - cr) / 0.2) ** 2));
    }
    return d + (vn(x * 0.9, y * 0.9, z * 0.9, 52) - 0.5) * 0.18;
  };
  const m = new VoxelModel('ra_moon');
  const g = new Grid(S, [-R - 0.5, -R - 0.5, -1.5, R + 0.5, R + 0.5, 1.5]);
  g.fill(f);
  g.emit(m, (x, y, _z, _nx, ny) => {
    for (const [cx, cy, cr] of craters) if (Math.hypot(x - cx, y - cy) < cr * 0.75) return pk(MOON.deep);
    const n = vn(x * 0.5, y * 0.5, 0.5, 53);
    return pk(ny > 0.6 ? MOON.hi : n > 0.62 ? MOON.base : n < 0.38 ? MOON.deep : MOON.shade);
  });
  return { model: m, voxelSize: VS };
}
