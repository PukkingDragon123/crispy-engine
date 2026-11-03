// AVATAR OF KHONSU — LORD OF THE SHIFTING SANDS (wave-75 boss) + the sandstone
// spikes he raises out of the dunes.
//
// Khonsu returns as the desert itself: a hunched colossus, ~33 m to the top of
// the lunar disk, sculpted at 1/6 m voxels. Only the waist and up stand out of
// the sand: the lower body is a vast sand skirt that melts into the dunes (the
// boss also swells the real terrain around it). He is layered sandstone: strata
// bands, soft layers eroded back under hard crumbling lips, wind-carved flutes,
// loose sand settled on every shelf, pale moonlight glowing out of the cracks.
// A sandstone ribcage (two hinged gates `ribs_l`/`ribs_r`) closes over the
// glowing moon-disk heart (`core`, the weak point) inside a lit geode cavity.
// The head is Khonsu's falcon-skull mask, bleached bone over a sandstone skull,
// with modelled glowing moon-blue eye orbs (`eye_l`/`eye_r`: slit pupil, iris,
// glint) and the crescent-moon crown cradling the lunar disk. Long gorilla arms
// rest on heavy stone hands; worn linen wraps and a gold bracer remember the
// first avatar; a toppled obelisk is buried in his hump. Sand pours off the
// shoulders, elbows and beak (`pour_*` parts, drawn with the boss's flowing-sand
// material; `pour_hand_*` stay hidden until he pours an army out of his palms).
//
// Rig (every part is authored in place, so all rest frames are aligned with rig
// space; faces +Z, left = +X):
//   pelvis (root, the skirt) → spine (belly, pivot inside the mound) → torso
//   torso → head → jaw, eye_l/_r, mask_crack (hidden until the mask cracks), pour_beak
//   torso → ribs_l/_r (hinged at the chest sides: open = +rotation.y left / −y right), core
//   torso → arm_l → fore_l → hand_l → fing1..4_l → tip1..4_l, thumb_l → thumbtip_l
//   torso → pour_sh1_l, pour_sh2_l · fore_l → pour_el_l · hand_l → pour_hand_l
// meta.ik holds rest joints (rig-local metres) and finger / thumb / wrist axes
// for the boss's arm IK and finger curls.
import { TRig, VoxelModel, VF } from './tk';
import type { RigSpec, V3 } from './tk';

/** voxels per metre: 1/5 m keeps a 33 m giant at ~165 voxels tall and under ~200k triangles */
export const KS_VOXELS_PER_M = 5;
const S = KS_VOXELS_PER_M;
const VS = 1 / S;
/** voxel columns are centred on x = i/S, so rig-local x = metric x + XS (see P) */
const XS = 0.5 / S;

// ----------------------------------------------------------------------------- palette (the desert's own colours)
const SAND = { hi: 0xf6dcaa, top: 0xedc68a, base: 0xe0b06e, shade: 0xc99a5d, deep: 0xa87a45 };
/** sediment bands (the terrain's own strata), weighted toward the warm mid-tones of the body */
const STRATA = [0xc99a6c, 0xb5835a, 0xc08d62, 0x9e6c48, 0xd6aa7c, 0xb08058, 0x8a5a3c, 0xc99a6c, 0xe2bd8f, 0xa87650];
const LIP = 0xf3dcb0;
const RECESS = 0x5e3d26;
const CAVE = 0x2a1b12;
const BONE = { hi: 0xfdf8ec, base: 0xf3ead6, shade: 0xd9cdb2, dark: 0x9f8962 };
const RIB = { hi: 0xf4e6c4, base: 0xe4cc9e, shade: 0xc6a87a, dark: 0x8f7450 };
const MOON = { white: 0xf2f9ff, hi: 0xd2ebff, base: 0xaed6ff, deep: 0x78aef0, sea: 0x8aa9d2 };
const SILVER = { hi: 0xf0f4fb, base: 0xc9d2e2, shade: 0x96a1b8, dark: 0x5f6a82 };
const GOLD = { hi: 0xf0d273, base: 0xd2a63c, shade: 0xa47b25, dark: 0x6a4a12 };
const LINEN = { hi: 0xe2d7ba, base: 0xcdbf9f, shade: 0xa99b7c, dark: 0x766a50 };
const LAPIS = 0x2f4f9c;
const SOCKET = 0x150e09;
const GRANITE = [0x8a7a6a, 0x766858, 0x5f5246, 0x9c8a76];
const EYE = { pupil: 0x0a1428, ring: 0x3f7ad8, iris: 0x8fcaff, glint: 0xffffff, white: 0x6f9fd8, back: 0x1b2232 };

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
function mix(a: number, b: number, t: number) {
  t = clamp01(t);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  return (Math.round(ar + (((b >> 16) & 255) - ar) * t) << 16) | (Math.round(ag + (((b >> 8) & 255) - ag) * t) << 8) | Math.round(ab + ((b & 255) - ab) * t);
}
const pk = (c: number, f: number = VF.SOLID) => ((f << 24) | (c & 0xffffff)) >>> 0;
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
/** voxel-space pivot of a metric point */
const P = (m: V3): V3 => [m[0] * S + 0.5, m[1] * S, m[2] * S];
/** rig-local metres of a metric point (what the boss reads from meta) */
const RL = (m: V3): V3 => [m[0] + XS, m[1], m[2]];

// ----------------------------------------------------------------------------- distance-field bits (metres)
function ell(px: number, py: number, pz: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) {
  const x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz;
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const k1 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  return k1 < 1e-6 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
/** round cone between a and b (radius lerps along the segment) */
function cone(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const t = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1));
  const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
}
const coneV = (px: number, py: number, pz: number, a: V3, b: V3, ra: number, rb: number) => cone(px, py, pz, a[0], a[1], a[2], b[0], b[1], b[2], ra, rb);
function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

// ----------------------------------------------------------------------------- sandstone
/** strata height: bands warp gently so they read as real sediment, continuous across parts at rest */
function strataY(x: number, y: number, z: number) {
  return y + 0.32 * Math.sin(x * 0.15 + z * 0.19) + (vn(x * 0.07, y * 0.05, z * 0.07, 3) - 0.5) * 0.9;
}
function crackAt(x: number, y: number, z: number) {
  return Math.abs(vn(x * 0.45, y * 0.45, z * 0.45, 77) - 0.5);
}
/** where moonlight leaks: strong around the heart, scattered veins elsewhere */
function crackMask(x: number, y: number, z: number) {
  const dc = Math.hypot(x, (y - 15) * 0.9, (z - 3) * 1.3);
  return Math.max(1 - sstep(3.5, 9.5, dc), 0.65 * sstep(0.66, 0.72, vn(x * 0.1, y * 0.1, z * 0.1, 55)));
}
/**
 * Erosion added to a body field: big lumps, strata ledges (soft layers recess
 * under hard lips), sweeping wind flutes, crumbs, and carved moonlit cracks.
 */
function erode(x: number, y: number, z: number, seed: number, a: number, crackK: number) {
  let d = (vn(x * 0.27, y * 0.27, z * 0.27, seed) - 0.5) * 1.25 * a;
  const sy = strataY(x, y, z);
  // major ledges: a hard cap juts over a recessed soft layer every ~2.4 m (uneven)
  const F = majorF(sy), Bi = Math.floor(sy / 2.4 + 0.35 * Math.sin(sy * 0.23));
  d += a * 0.4 * (0.55 + 0.45 * h3(Bi, 13, 7, 0)) * sstep(0.05, 0.4, F) * (1 - sstep(0.76, 0.88, F));
  // the odd soft layer between them
  const b = sy / 1.05, bi = Math.floor(b), f = b - bi;
  if (h3(bi, 11, 5, 0) < 0.3) d += a * 0.14 * sstep(0.1, 0.4, f) * (1 - sstep(0.6, 0.8, f));
  // vertical joints: the rock breaks into blocks
  d += a * 0.3 * jointAt(x, y, z);
  const g = Math.sin((x * 0.6 - y * 0.33 + z * 0.45) * 1.55 + vn(x * 0.18, y * 0.18, z * 0.18, seed + 5) * 4.2);
  if (g > 0) d += a * 0.26 * g * g * g * g;
  d += (vn(x * 0.9, y * 0.9, z * 0.9, seed + 7) - 0.5) * 0.1 * a;
  if (crackK > 0 && crackAt(x, y, z) < 0.03 * crackK) d += 0.3;
  return d;
}
function majorF(sy: number) {
  const B = sy / 2.4 + 0.35 * Math.sin(sy * 0.23);
  return B - Math.floor(B);
}
/** 1 inside a vertical joint fissure (2D cellular borders, ~3 m blocks), 0 elsewhere */
function jointAt(x: number, y: number, z: number) {
  const u = x * 0.33 + y * 0.04, v = z * 0.33 - y * 0.03;
  const iu = Math.floor(u), iv = Math.floor(v);
  let f1 = 9, f2 = 9;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++) {
      const cu = iu + a, cv = iv + b;
      const dd = (u - cu - h3(cu, cv, 1, 91)) ** 2 + (v - cv - h3(cu, cv, 2, 91)) ** 2;
      if (dd < f1) {
        f2 = f1;
        f1 = dd;
      } else if (dd < f2) f2 = dd;
    }
  return 1 - sstep(0.03, 0.08, Math.sqrt(f2) - Math.sqrt(f1));
}
/** sandstone colour: moon cracks, sand settled on shelves, strata bands with lit lips, dark joints */
function rockPaint(x: number, y: number, z: number, ny: number, crackK: number, sandK = 1): number {
  if (crackK > 0) {
    const ck = crackAt(x, y, z);
    if (ck < 0.046 * crackK) return pk(ck < 0.018 * crackK ? MOON.white : vn(x * 0.9, y * 0.9, z * 0.9, 91) > 0.55 ? MOON.hi : MOON.base, VF.EMISSIVE);
  }
  const sl = 0.72 + (vn(x * 0.45, y * 0.45, z * 0.45, 13) - 0.5) * 0.3;
  if (sandK > 0 && ny > sl) return pk(SAND.top); // ripples are drawn by the boss shader
  // clear tones per stratum; the cel ramp, AO and ink do the rest
  const sy = strataY(x, y, z), bi = Math.floor(sy / 1.05);
  let c = STRATA[Math.floor(h3(bi, 3, 1, 0) * STRATA.length)];
  if (majorF(sy) > 0.8 && ny > -0.3) c = mix(c, LIP, 0.45); // the hard cap of a ledge catches the light
  else if (jointAt(x, y, z) > 0.5) c = mix(c, RECESS, 0.55);
  return pk(c);
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
  constructor(readonly s: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.i0 = Math.floor(x0 * s) - 2;
    this.j0 = Math.floor(y0 * s) - 2;
    this.k0 = Math.floor(z0 * s) - 2;
    this.nx = Math.ceil(x1 * s) + 3 - this.i0;
    this.ny = Math.ceil(y1 * s) + 3 - this.j0;
    this.nz = Math.ceil(z1 * s) + 3 - this.k0;
    this.occ = new Uint8Array(this.nx * this.ny * this.nz);
  }
  X(i: number) {
    return (this.i0 + i) / this.s;
  }
  Y(j: number) {
    return (this.j0 + j + 0.5) / this.s;
  }
  Z(k: number) {
    return (this.k0 + k + 0.5) / this.s;
  }
  /** occupy every cell inside f (optionally only within a metric sub-box) */
  fill(f: Field, box?: number[]) {
    const s = this.s;
    let ia = 1, ib = this.nx - 2, ja = 1, jb = this.ny - 2, ka = 1, kb = this.nz - 2;
    if (box) {
      ia = Math.max(ia, Math.floor(box[0] * s) - this.i0);
      ja = Math.max(ja, Math.floor(box[1] * s) - this.j0);
      ka = Math.max(ka, Math.floor(box[2] * s) - this.k0);
      ib = Math.min(ib, Math.ceil(box[3] * s) - this.i0);
      jb = Math.min(jb, Math.ceil(box[4] * s) - this.j0);
      kb = Math.min(kb, Math.ceil(box[5] * s) - this.k0);
    }
    const { nx, ny, occ } = this;
    for (let k = ka; k <= kb; k++) {
      const z = this.Z(k);
      for (let j = ja; j <= jb; j++) {
        const y = this.Y(j);
        let n = ia + nx * (j + ny * k);
        for (let i = ia; i <= ib; i++, n++) if (!occ[n] && f(this.X(i), y, z) < 0) occ[n] = 1;
      }
    }
  }
  /**
   * Write the solid into m. Only surface cells (an empty 26-neighbour) are painted, with an occupancy
   * normal; interior cells are kept as plain fill so the mesher never builds inner faces.
   */
  emit(m: VoxelModel, paint: Paint) {
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
            m.set(this.i0 + i, this.j0 + j, this.k0 + k, RECESS);
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
/** metric AABB of points padded by r */
function bounds(pts: V3[], r: number): number[] {
  const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (const p of pts)
    for (let a = 0; a < 3; a++) {
      b[a] = Math.min(b[a], p[a] - r);
      b[a + 3] = Math.max(b[a + 3], p[a] + r);
    }
  return b;
}
/** metric AABB of a canonical head-frame box */
function headBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const pts: V3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push(fromHead([x, y, z]));
  return bounds(pts, 0.1);
}
function sculpt(m: VoxelModel, box: number[], f: Field, paint: Paint) {
  const g = new Grid(S, box[0], box[1], box[2], box[3], box[4], box[5]);
  g.fill(f);
  g.emit(m, paint);
  return g;
}

// ----------------------------------------------------------------------------- landmarks (metric rig space)
const SH: V3 = [7.8, 18.6, 0.4]; // left shoulder joint
const EL: V3 = [12.4, 9.6, 3.2]; // elbow
const WR: V3 = [14.6, 1.6, 6.9]; // wrist
const SPINE_PIV: V3 = [0, 5.2, -0.3];
const TORSO_PIV: V3 = [0, 11.6, -1.0];
const HEAD_PIV: V3 = [0, 21.0, 5.0];
const CORE_C: V3 = [0, 15.0, 2.95];
const RIB_HINGE: V3 = [4.62, 15.0, 2.2];

// head frame: canonical (+Z = beak) tilted down a little
const HT = 0.12, HC = Math.cos(HT), HSN = Math.sin(HT);
const _c: V3 = [0, 0, 0];
function toHead(x: number, y: number, z: number) {
  const Y = y - HEAD_PIV[1], Z = z - HEAD_PIV[2];
  _c[0] = x;
  _c[1] = Y * HC + Z * HSN;
  _c[2] = -Y * HSN + Z * HC;
  return _c;
}
const fromHead = (c: V3): V3 => [HEAD_PIV[0] + c[0], HEAD_PIV[1] + c[1] * HC - c[2] * HSN, HEAD_PIV[2] + c[1] * HSN + c[2] * HC];
const headVec = (c: V3): V3 => [c[0], c[1] * HC - c[2] * HSN, c[1] * HSN + c[2] * HC];

// hand frame (left): +Z fingers, +Y back of the hand, +X outward (thumb on −X)
const HF = norm([0.2, -0.17, 0.965]);
const HU = norm([-HF[0] * HF[1], 1 - HF[1] * HF[1], -HF[2] * HF[1]]);
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
  { x: -1.02, z: 2.8, l1: 1.45, l2: 1.25, r0: 0.44, r1: 0.37, r2: 0.3, sp: -0.13 }, // index (thumb side)
  { x: -0.33, z: 2.95, l1: 1.62, l2: 1.38, r0: 0.47, r1: 0.39, r2: 0.31, sp: -0.04 },
  { x: 0.36, z: 2.88, l1: 1.5, l2: 1.28, r0: 0.43, r1: 0.36, r2: 0.29, sp: 0.06 },
  { x: 1.0, z: 2.6, l1: 1.16, l2: 1.0, r0: 0.37, r1: 0.31, r2: 0.25, sp: 0.17 }, // little
];
const REST_CURL: [number, number] = [0.3, 0.42];
const fdir = (sp: number, c: number): V3 => [Math.sin(sp) * Math.cos(c), -Math.sin(c), Math.cos(sp) * Math.cos(c)];
const THUMB = { b: [-1.32, -0.3, 0.9] as V3, d1: norm([-0.6, -0.3, 0.74]), l1: 1.35, d2: norm([-0.36, -0.44, 0.82]), l2: 1.05, r: [0.53, 0.44, 0.34] };

// ============================================================================= parts
// ------------------------------------------------------------------ pelvis: the sand skirt (columns) + buried outcrops
function skirtH(x: number, z: number) {
  const zz = z < 0 ? z * 0.85 : z;
  const rho = Math.hypot(x, zz), th = Math.atan2(x, z);
  const r = Math.max(0, rho - 3.6);
  let h = 6.4 - 1.15 * r - 0.06 * r * r;
  h += (0.35 * Math.sin(3 * th + 0.7) + 0.25 * Math.sin(5 * th + 2.1)) * sstep(4, 6, rho);
  h -= 0.5 * gullyAt(x, z) * sstep(3.6, 5.5, rho);
  h += 0.45 * Math.pow(Math.max(0, Math.sin(9 * th + 1.3)), 3) * Math.exp(-(((rho - 5.6) / 1.0) ** 2)); // slump lobes
  h += (vn(x * 0.33, 1.7, z * 0.33, 31) - 0.5) * 0.6;
  return h - 1.6 * sstep(6.6, 7.6, rho); // tuck the rim under the terrain mound
}
function gullyAt(x: number, z: number) {
  const rho = Math.hypot(x, z), th = Math.atan2(x, z);
  return Math.pow(Math.max(0, Math.cos(7 * th + 0.5 * Math.sin(rho * 0.55))), 10);
}
const OUTCROPS = [
  [-5.0, 3.4, 2.9, 1.5, 1.3, 1.3],
  [4.7, 3.1, -3.7, 1.7, 1.5, 1.4],
  [-2.2, 3.3, -5.4, 1.3, 1.1, 1.3],
  [5.3, 2.9, 2.4, 1.1, 0.9, 1.1],
  [2.0, 4.4, 4.4, 1.2, 0.9, 1.0],
];
function outcropBase(x: number, y: number, z: number) {
  let d = 1e9;
  for (const o of OUTCROPS) d = Math.min(d, ell(x, y, z, o[0], o[1], o[2], o[3], o[4], o[5]));
  return d;
}
function outcropF(x: number, y: number, z: number) {
  const d = outcropBase(x, y, z);
  return d > 1.6 ? d : d + erode(x, y, z, 41, 1.1, 0.4);
}
function buildSkirt(m: VoxelModel) {
  const g = new Grid(S, -7.8, -1.6, -7.8, 7.8, 8.0, 7.8);
  const { nx, ny, nz, occ } = g;
  const top = new Int32Array(nx * nz).fill(-1);
  for (let k = 1; k < nz - 1; k++)
    for (let i = 1; i < nx - 1; i++) {
      const x = g.X(i), z = g.Z(k);
      if (Math.hypot(x, z) < 3.6) continue; // inside the belly
      top[i + nx * k] = Math.min(ny - 2, Math.floor(skirtH(x, z) * S - 0.5) - g.j0);
    }
  for (let k = 1; k < nz - 1; k++)
    for (let i = 1; i < nx - 1; i++) {
      const jt = top[i + nx * k];
      for (let j = 1; j <= jt; j++) occ[i + nx * (j + ny * k)] = 1; // solid to the buried floor
    }
  for (const o of OUTCROPS) g.fill(outcropF, [o[0] - o[3] - 1, o[1] - o[4] - 1, o[2] - o[5] - 1, o[0] + o[3] + 1, o[1] + o[4] + 1, o[2] + o[5] + 1]);
  g.emit(m, (x, y, z, _nx, ny2) => {
    if (outcropBase(x, y, z) < 0.35) return rockPaint(x, y, z, ny2, 0.35);
    if (y < -1.1) return pk(SAND.shade); // buried floor
    const rho = Math.hypot(x, z);
    let c = ny2 > 0.5 ? SAND.top : ny2 > -0.2 ? SAND.base : SAND.shade;
    if (gullyAt(x, z) > 0.45 && rho > 3.6 && rho < 7.5 && y > 1.0) c = SAND.shade; // sand-fall channels
    return pk(c);
  });
}

// ------------------------------------------------------------------ spine: belly and lower back, crumbling belly ledges
function spineF(x: number, y: number, z: number) {
  let d = ell(x, y, z, 0, 8.5, 0.5, 5.0, 3.7, 4.3);
  d = smin(d, ell(x, y, z, 0, 9.3, -1.5, 4.8, 3.6, 3.8), 1.2);
  d = smin(d, cone(x, y, z, 0, 3.4, -0.2, 0, 7.4, 0.1, 4.6, 4.8), 1.4);
  d = smin(d, cone(x, y, z, 0, 10.6, -0.7, 0, 12.8, -0.5, 4.7, 4.5), 1.2);
  d = smin(d, ell(x, y, z, 4.2, 7.9, 0.2, 2.0, 2.7, 2.8), 1.0);
  d = smin(d, ell(x, y, z, -4.2, 7.9, 0.2, 2.0, 2.7, 2.8), 1.0);
  d = smin(d, ell(x, y, z, 0.3, 7.2, 3.8, 3.7, 0.8, 1.5), 0.6);
  d = smin(d, ell(x, y, z, -0.5, 9.9, 3.7, 3.3, 0.7, 1.4), 0.6);
  if (d > 2.2 || d < -2.2) return d;
  return d + erode(x, y, z, 101, 1, crackMask(x, y, z) * 0.8);
}

// ------------------------------------------------------------------ torso: chest barrel, hump, shoulders, neck, the heart's cave
const CAV = [0, 15.0, 3.7, 3.0, 3.3, 2.8];
const TEND = [
  [2.6, 16.7, 1.9, 1.42, 15.95, 2.5],
  [-2.7, 16.2, 1.8, -1.5, 15.55, 2.45],
  [2.5, 13.1, 2.1, 1.36, 14.1, 2.55],
  [-2.4, 13.3, 1.9, -1.45, 14.25, 2.5],
  [0.25, 18.1, 2.0, 0.15, 16.85, 2.55],
];
function tendrilD(x: number, y: number, z: number) {
  let d = cone(x, y, z, 0, 15.0, 0.7, 0, 15.0, 2.35, 0.66, 0.46); // the stalk that holds the heart
  for (const t of TEND) d = Math.min(d, cone(x, y, z, t[0], t[1], t[2], t[3], t[4], t[5], 0.3, 0.16));
  return d;
}
// a toppled obelisk swallowed by the hump
const OB_A = norm([-0.34, 0.72, -0.6]);
const OB_P1 = norm(cross(OB_A, [1, 0, 0]));
const OB_P2 = cross(OB_A, OB_P1);
const OB_O: V3 = [-2.0, 17.6, -5.6];
const OB_LEN = 6.2;
function obeliskD(x: number, y: number, z: number) {
  const dx = x - OB_O[0], dy = y - OB_O[1], dz = z - OB_O[2];
  const a = dx * OB_A[0] + dy * OB_A[1] + dz * OB_A[2];
  if (a < -2.5 || a > OB_LEN + 1.5) return 9;
  const p = dx * OB_P1[0] + dy * OB_P1[1] + dz * OB_P1[2], q = dx * OB_P2[0] + dy * OB_P2[1] + dz * OB_P2[2];
  const w = 0.82 - 0.22 * clamp01(a / OB_LEN);
  const brk = OB_LEN - 0.7 * vn(p * 1.6 + 3, q * 1.6, 0.5, 19) - 0.25 * Math.sin(p * 3 + q * 2); // jagged break
  const ax = Math.abs(p) - w + 0.12, ay = Math.abs(q) - w + 0.12;
  const box = Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0) - 0.12;
  return Math.max(box, a - brk, -a - 1.5) + (vn(x * 1.5, y * 1.5, z * 1.5, 23) - 0.5) * 0.12;
}
function obeliskPaint(x: number, y: number, z: number, ny: number) {
  if (ny > 0.62) return pk(SAND.top);
  const dx = x - OB_O[0], dy = y - OB_O[1], dz = z - OB_O[2];
  const a = dx * OB_A[0] + dy * OB_A[1] + dz * OB_A[2];
  const p = dx * OB_P1[0] + dy * OB_P1[1] + dz * OB_P1[2], q = dx * OB_P2[0] + dy * OB_P2[1] + dz * OB_P2[2];
  const u = Math.abs(p) > Math.abs(q) ? q : p; // across the face
  const cell = h3(Math.floor(a * 2.4), Math.floor(u * 2.4 + 9), Math.abs(p) > Math.abs(q) ? 1 : 2, 33);
  const fa = a * 2.4 - Math.floor(a * 2.4), fu = u * 2.4 - Math.floor(u * 2.4);
  if (cell < 0.45 && fa > 0.2 && fa < 0.8 && fu > 0.22 && fu < 0.78) return pk(GRANITE[2]); // carved glyph notch
  return pk(GRANITE[(Math.floor(vn(x * 0.9, y * 0.9, z * 0.9, 29) * 3.99) + (ny < -0.3 ? 2 : 0)) % 4]);
}
function torsoF(x: number, y: number, z: number) {
  let d = ell(x, y, z, 0, 15.0, 1.0, 6.0, 4.6, 4.4);
  d = smin(d, ell(x, y, z, 0, 16.6, -3.0, 5.4, 5.4, 4.0), 1.8); // hump
  if (d > 6) return d;
  d = smin(d, cone(x, y, z, 0, 11.0, -0.8, 0, 13.6, -0.2, 4.7, 4.9), 1.4);
  for (let s = 1; s >= -1; s -= 2) {
    d = smin(d, cone(x, y, z, s * 1.4, 20.4, -0.4, s * 7.2, 18.5, 0.0, 2.2, 2.35), 1.3); // trapezius sloping off the neck
    d = smin(d, ell(x, y, z, s * 8.0, 18.4, 0.3, 2.9, 3.0, 3.1), 1.1); // shoulder mass
    d = smin(d, ell(x, y, z, s * 3.4, 16.9, 3.5, 3.0, 1.9, 1.6), 0.9); // pectoral shelf
    d = smin(d, ell(x, y, z, s * 9.3, 20.0, 1.1, 2.0, 0.55, 2.2), 0.6); // crumbling shoulder ledge
    d = smin(d, ell(x, y, z, s * 5.3, 14.3, 1.4, 1.7, 3.5, 3.0), 1.2); // chest wall (rib hinge)
  }
  d = smin(d, cone(x, y, z, 0, 17.3, 1.2, 0, 21.4, 5.1, 2.45, 2.0), 1.2); // neck thrust forward
  for (let i = 0; i < 6; i++) {
    const yy = 13.2 + i * 1.45;
    const zr = -3.0 - 4.0 * Math.sqrt(Math.max(0, 1 - ((yy - 16.6) / 5.4) ** 2)) + 0.35;
    d = smin(d, ell(x, y, z, 0.25 * Math.sin(i * 1.7), yy, zr, 1.0, 0.65, 0.85), 0.45); // spine ridge
  }
  d = smax(d, -ell(x, y, z, CAV[0], CAV[1], CAV[2], CAV[3], CAV[4], CAV[5]), 0.5); // the heart's cave
  d = Math.min(d, obeliskD(x, y, z));
  if (d < 2.2 && d > -2.2) {
    const inCave = ell(x, y, z, CAV[0], CAV[1], CAV[2], CAV[3] + 0.7, CAV[4] + 0.7, CAV[5] + 0.7) < 0;
    d += erode(x, y, z, 131, inCave ? 0.45 : 1, inCave ? 1.4 : crackMask(x, y, z));
  }
  return Math.abs(x) < 3.4 && y > 12.4 && y < 18.6 && z > 0 && z < 3.2 ? Math.min(d, tendrilD(x, y, z)) : d;
}
function torsoPaint(x: number, y: number, z: number, _nx: number, ny: number) {
  if (y < 10.9) return pk(RECESS); // the cut inside the belly
  if (obeliskD(x, y, z) < 0.2) return obeliskPaint(x, y, z, ny);
  if (ell(x, y, z, CAV[0], CAV[1], CAV[2], CAV[3], CAV[4], CAV[5]) < 0.55) {
    if (tendrilD(x, y, z) < 0.12) return pk(h3(Math.round(x * 6), Math.round(y * 6), Math.round(z * 6), 4) < 0.5 ? MOON.base : MOON.deep, VF.EMISSIVE);
    const ck = crackAt(x, y, z);
    if (ck < 0.065) return pk(ck < 0.025 ? MOON.hi : MOON.deep, VF.EMISSIVE);
    return pk(mix(CAVE, RECESS, vn(x * 1.2, y * 1.2, z * 1.2, 5) * 0.8));
  }
  return rockPaint(x, y, z, ny, crackMask(x, y, z));
}

// ------------------------------------------------------------------ ribs (left gate; mirrored)
const RIBS: { p: number[]; r: number[] }[] = [];
for (let r = 0; r < 5; r++) {
  const y0 = 12.45 + r * 1.27, tip = r === 4 ? 0.95 : 0.5 + (r % 2) * 0.12;
  const p: number[] = [], rr: number[] = [];
  for (let i = 0; i <= 6; i++) {
    const f = i / 6, ph = f * Math.PI * 0.5;
    p.push(tip + (RIB_HINGE[0] - tip) * Math.cos(ph), y0 - 0.55 * f - 0.12 * Math.sin(ph * 2), RIB_HINGE[2] + 3.15 * Math.sin(ph) * (r === 4 ? 0.9 : 1));
    rr.push(0.47 - 0.14 * f);
  }
  RIBS.push({ p, r: rr });
}
function ribD(x: number, y: number, z: number) {
  let d = cone(x, y, z, 4.78, 11.7, 2.05, 4.66, 18.4, 2.3, 0.64, 0.56); // the hinge column
  for (const rb of RIBS) {
    const p = rb.p, r = rb.r;
    if (Math.abs(y - p[1]) > 1.6) continue;
    for (let i = 0; i < 6; i++) d = Math.min(d, cone(x, y, z, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], p[i * 3 + 3], p[i * 3 + 4], p[i * 3 + 5], r[i], r[i + 1]));
    d = Math.min(d, ell(x, y, z, p[0], p[1], p[2], 0.42, 0.4, 0.4)); // tip knob
  }
  return d;
}
function ribsF(x: number, y: number, z: number) {
  const d = ribD(x, y, z);
  return d > 1 || d < -1 ? d : d + erode(x, y, z, 61, 0.22, 0.5);
}
function ribPaint(x: number, y: number, z: number, _nx: number, ny: number) {
  const ck = crackAt(x, y, z);
  if (ck < 0.03) return pk(ck < 0.012 ? MOON.white : MOON.base, VF.EMISSIVE);
  if (ny > 0.66) return pk(SAND.top);
  const b = strataY(x, y, z) / 0.7, f = b - Math.floor(b);
  let c = f < 0.5 ? RIB.base : mix(RIB.base, RIB.shade, 0.45);
  if (ny > 0.35) c = mix(c, RIB.hi, 0.5);
  else if (ny < -0.35) c = mix(c, RIB.dark, 0.35);
  return pk(c);
}

// ------------------------------------------------------------------ core: the moon-disk heart
const CRATERS = [
  [-0.62, 15.55, 0.42],
  [0.55, 14.35, 0.36],
  [0.82, 15.72, 0.25],
  [-0.2, 14.2, 0.28],
  [0.15, 16.2, 0.2],
  [-1.0, 14.75, 0.22],
];
function coreF(x: number, y: number, z: number) {
  const dy = y - CORE_C[1], r = Math.hypot(x, dy), a = Math.atan2(dy, x);
  const R = 1.78 + 0.07 * Math.sin(a * 5 + 0.4) + (vn(Math.cos(a) * 3, Math.sin(a) * 3, 0, 61) - 0.5) * 0.18;
  const bl = 0.22 * (1 - Math.min(1, (r / R) ** 2));
  return Math.max(r - R, Math.abs(z - CORE_C[2] - bl * 0.5) - (0.46 + bl * 0.5));
}
function corePaint(x: number, y: number, z: number, _nx: number, _ny: number, nz: number) {
  const r = Math.hypot(x, y - CORE_C[1]);
  if (nz < -0.4) return pk(SILVER.dark, VF.METAL);
  if (r > 1.52) return pk(nz > 0.5 ? SILVER.hi : SILVER.base, VF.METAL); // the setting
  for (const [cx, cy, cr] of CRATERS) {
    const dc = Math.hypot(x - cx, y - cy);
    if (Math.abs(dc - cr) < 0.13) return pk(MOON.white, VF.GLOW);
    if (dc < cr) return pk(MOON.sea, VF.EMISSIVE);
  }
  return pk(vn(x * 1.4, y * 1.4, 0, 47) > 0.6 ? MOON.base : MOON.hi, VF.GLOW);
}

// ------------------------------------------------------------------ head: falcon-skull mask, sandstone skull, crescent crown, lunar disk
const BEAK = [
  [0, 2.95, 1.6, 1.3],
  [0, 2.95, 3.0, 1.12],
  [0, 2.55, 4.2, 0.9],
  [0, 1.65, 5.1, 0.62],
  [0, 0.55, 5.55, 0.36],
  [0, -0.25, 5.2, 0.16],
];
const ORBIT = [1.7, 2.5, 1.32, 1.12, 1.02, 1.05];
function maskF(cx: number, cy: number, cz: number) {
  let d = ell(cx, cy, cz, 0, 2.7, -0.4, 2.55, 2.4, 2.75);
  d = smin(d, ell(cx, cy, cz, 1.55, 3.42, 1.5, 1.3, 0.55, 1.0), 0.45); // brow shelves
  d = smin(d, ell(cx, cy, cz, -1.55, 3.42, 1.5, 1.3, 0.55, 1.0), 0.45);
  const bx = cx / 0.72; // the beak is laterally compressed
  let db = 1e9;
  for (let i = 0; i < 5; i++) {
    const a = BEAK[i], b = BEAK[i + 1];
    db = Math.min(db, cone(bx, cy, cz, a[0], a[1], a[2], b[0], b[1], b[2], a[3], b[3]));
  }
  db = smin(db * 0.78, ell(cx, cy, cz, 0, 2.15, 2.3, 1.38, 1.02, 1.05), 0.5); // cere
  if (cz > 1.7 && cz < 5.1) db = Math.max(db, 1.08 + (cz - 1.7) * 0.11 - cy); // the gape
  d = smin(d, db, 0.45);
  d = smin(d, cone(cx, cy, cz, 1.22, 1.25, 0.45, 0.76, 1.48, 2.55, 0.37, 0.3), 0.3); // cheek bars
  d = smin(d, cone(cx, cy, cz, -1.22, 1.25, 0.45, -0.76, 1.48, 2.55, 0.37, 0.3), 0.3);
  d = smax(d, -ell(cx, cy, cz, ORBIT[0], ORBIT[1], ORBIT[2], ORBIT[3], ORBIT[4], ORBIT[5]), 0.25);
  d = smax(d, -ell(cx, cy, cz, -ORBIT[0], ORBIT[1], ORBIT[2], ORBIT[3], ORBIT[4], ORBIT[5]), 0.25);
  d = smax(d, -ell(cx, cy, cz, 0.44, 2.36, 3.05, 0.2, 0.15, 0.38), 0.08); // nares
  d = smax(d, -ell(cx, cy, cz, -0.44, 2.36, 3.05, 0.2, 0.15, 0.38), 0.08);
  return d;
}
function skullBackF(cx: number, cy: number, cz: number) {
  return smin(ell(cx, cy, cz, 0, 2.0, -1.5, 2.4, 2.3, 2.3), cone(cx, cy, cz, 0, -1.4, -1.2, 0, 1.4, -0.7, 1.95, 1.85), 0.8);
}
function modiusF(cx: number, cy: number, cz: number) {
  const zz = cz + 0.6, mr = Math.hypot(cx, zz), ang = Math.atan2(cx, zz);
  const rr = 1.82 + (cy - 4.6) * 0.18 + 0.07 * Math.sin(ang * 9) + (vn(cx * 1.4, cy * 1.4, cz * 1.4, 41) - 0.5) * 0.14;
  return Math.max(mr - rr, Math.abs(cy - 5.4) - 0.8);
}
const DISK_Y = 8.9, DISK_R = 2.9;
function diskF(cx: number, cy: number, cz: number) {
  const dy = cy - DISK_Y, r = Math.hypot(cx, dy), a = Math.atan2(dy, cx);
  let R = DISK_R + 0.09 * Math.sin(a * 3 + 0.4) + (vn(Math.cos(a) * 4, Math.sin(a) * 4, 1, 43) - 0.5) * 0.2;
  for (const ca of [1.1, 2.7, 4.6]) {
    const da = Math.abs(((a - ca + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da < 0.14) R -= (0.14 - da) * 4; // chipped rim
  }
  const k = Math.min(1, (r / DISK_R) ** 2);
  return Math.max(r - R, Math.abs(cz + 1.15 - 0.16 * (1 - k)) - (0.42 + 0.1 * (1 - k)));
}
function crescentF(cx: number, cy: number, cz: number) {
  const o = Math.hypot(cx, cy - 8.0) - (3.95 + 0.08 * Math.sin(Math.atan2(cy - 8.0, cx) * 4) + (vn(cx * 1.1, cy * 1.1, 2, 45) - 0.5) * 0.16);
  const i = Math.hypot(cx - 0.1, cy - 9.0) - 3.3;
  return Math.max(o, -i, Math.abs(cz + 0.05) - 0.46);
}
const DISK_CRATERS = [
  [-1.04, 9.81, 0.6],
  [0.95, 8.07, 0.48],
  [1.39, 10.2, 0.35],
  [-0.35, 7.6, 0.4],
  [0.26, 10.53, 0.3],
  [-1.65, 8.4, 0.33],
];
function headF(x: number, y: number, z: number) {
  const c = toHead(x, y, z), cx = c[0], cy = c[1], cz = c[2];
  let d = cy > 3.4 ? Math.min(modiusF(cx, cy, cz), cy > 5.6 ? diskF(cx, cy, cz) : 9, crescentF(cx, cy, cz)) : 9;
  if (cy < 7) {
    const dk = maskF(cx, cy, cz), db = skullBackF(cx, cy, cz);
    let h = smin(dk, db, 0.6);
    if (h < 1.6 && h > -1.6) h += db < dk - 0.15 ? erode(x, y, z, 151, 0.55, 0.3) : (vn(x * 2.6, y * 2.6, z * 2.6, 153) - 0.5) * 0.12;
    d = Math.min(d, h);
  }
  return d;
}
function headPaint(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
  const c = toHead(x, y, z), cx = c[0], cy = c[1], cz = c[2];
  const cny = ny * HC + nz * HSN, cnz = -ny * HSN + nz * HC;
  const dm = modiusF(cx, cy, cz), dd = diskF(cx, cy, cz), dc = crescentF(cx, cy, cz);
  const dk = cy < 7 ? maskF(cx, cy, cz) : 9, db = cy < 7 ? skullBackF(cx, cy, cz) : 9;
  const m = Math.min(dm, dd, dc, dk, db);
  if (m === dd) {
    if (cnz > 0.45) {
      for (const [kx, ky, kr] of DISK_CRATERS) {
        const q = Math.hypot(cx - kx, cy - ky);
        if (Math.abs(q - kr) < 0.14) return pk(MOON.white, VF.EMISSIVE);
        if (q < kr) return pk(MOON.deep, VF.EMISSIVE);
      }
      return pk(vn(cx * 0.7, cy * 0.7, 0, 47) > 0.55 ? MOON.sea : MOON.base, VF.EMISSIVE);
    }
    return pk(cnz < -0.45 ? SILVER.dark : SILVER.shade, VF.METAL);
  }
  if (m === dc) {
    const inner = Math.hypot(cx - 0.1, cy - 9.0) - 3.3, outer = Math.hypot(cx, cy - 8.0) - 3.95;
    if (inner < 0.22) return pk(SILVER.hi, VF.METAL);
    if (outer > -0.24 || cnz < -0.45) return pk(SILVER.shade, VF.METAL);
    return pk(vn(cx * 2.2, cy * 2.2, 3, 49) > 0.62 ? SILVER.hi : SILVER.base, VF.METAL); // hammered
  }
  if (m === dm) {
    const ang = Math.atan2(cx, cz + 0.6);
    if (cy > 5.95) return pk(GOLD.base, VF.METAL);
    if (cy < 4.75) return pk(GOLD.shade, VF.METAL);
    if (cy > 5.12 && cy < 5.62) {
      if (vn(cx * 2, cy * 2, cz * 2, 51) > 0.68) return rockPaint(x, y, z, ny, 0, 0); // worn through
      return Math.floor((ang + Math.PI) * 4.5) % 3 === 0 ? pk(LAPIS) : pk(GOLD.hi, VF.METAL);
    }
    return pk(Math.sin(ang * 9) > 0.55 ? mix(STRATA[0], RECESS, 0.25) : STRATA[0]);
  }
  if (m === db || cz < -0.25 + (vn(cx * 1.3, cy * 1.3, 4, 52) - 0.5) * 1.3) return rockPaint(x, y, z, ny, 0.3);
  // the bone mask
  for (const s of [1, -1]) if (ell(cx, cy, cz, s * ORBIT[0], ORBIT[1], ORBIT[2], ORBIT[3] + 0.18, ORBIT[4] + 0.18, ORBIT[5] + 0.18) < 0) return pk(SOCKET);
  if (ell(cx, cy, cz, Math.sign(cx) * 0.44, 2.36, 3.05, 0.3, 0.25, 0.48) < 0) return pk(SOCKET);
  if (cz > 1.7 && cz < 5.1 && cy < 1.18 + (cz - 1.7) * 0.11) return pk(BONE.dark); // the gape edge
  if (crackAt(x, y, z) < 0.012) return pk(BONE.dark);
  let col = cny > 0.5 ? BONE.hi : cny < -0.4 ? BONE.shade : BONE.base;
  if (vn(cx * 1.6, cy * 1.6, cz * 1.6, 57) > 0.68) col = mix(col, BONE.shade, 0.6); // weathering stains
  if (h3(Math.round(x * 6), Math.round(y * 6), Math.round(z * 6), 58) < 0.025) col = BONE.dark; // pits
  return pk(col);
}
// mandible
function jawF(x: number, y: number, z: number) {
  const c = toHead(x, y, z), bx = Math.abs(c[0]), cy = c[1], cz = c[2];
  let d = cone(bx, cy, cz, 1.12, 1.0, -0.45, 0.95, 0.84, 1.4, 0.43, 0.38);
  d = Math.min(d, cone(bx, cy, cz, 0.95, 0.84, 1.4, 0.5, 0.72, 3.3, 0.38, 0.31));
  d = Math.min(d, cone(bx, cy, cz, 0.5, 0.72, 3.3, 0.0, 0.66, 4.6, 0.31, 0.22));
  d = Math.min(d, Math.max(Math.abs(cy - 0.74) - 0.12, bx - (1.0 - (cz + 0.3) * 0.2), -cz - 0.3, cz - 4.3)); // mouth floor
  return d + (vn(x * 2.6, y * 2.6, z * 2.6, 161) - 0.5) * 0.08;
}
function jawPaint(x: number, y: number, z: number, _nx: number, ny: number, nz: number) {
  const c = toHead(x, y, z);
  const cny = ny * HC + nz * HSN;
  if (cny > 0.5 && Math.abs(c[0]) < 0.62 && c[2] > 0 && c[2] < 4.1) return pk(mix(SOCKET, RECESS, 0.4)); // inside of the mouth
  return pk(cny > 0.5 ? BONE.hi : cny < -0.4 ? BONE.shade : BONE.base);
}
// modelled eye orb (left), slit pupil facing out of the socket
const EYE_C: V3 = [1.5, 2.48, 1.22];
const EYE_A = norm([0.62, -0.06, 0.78]);
const EYE_U = norm(cross([0, 1, 0], EYE_A)); // across the pupil
function eyeF(x: number, y: number, z: number) {
  const c = toHead(x, y, z);
  return ell(c[0], c[1], c[2], EYE_C[0], EYE_C[1], EYE_C[2], 0.8, 0.76, 0.76);
}
function eyePaint(x: number, y: number, z: number) {
  const c = toHead(x, y, z);
  const vx = c[0] - EYE_C[0], vy = c[1] - EYE_C[1], vz = c[2] - EYE_C[2];
  const l = Math.hypot(vx, vy, vz) || 1;
  const dp = (vx * EYE_A[0] + vy * EYE_A[1] + vz * EYE_A[2]) / l;
  const across = (vx * EYE_U[0] + vy * EYE_U[1] + vz * EYE_U[2]) / l;
  if (dp > 0.86 && Math.abs(across) < 0.13) return pk(EYE.pupil);
  if (dp > 0.8 && dp < 0.9 && vy / l > 0.3 && across > 0) return pk(EYE.glint, VF.GLOW);
  if (dp > 0.74) return pk(EYE.iris, VF.GLOW);
  if (dp > 0.6) return pk(EYE.ring, VF.GLOW);
  if (dp > -0.15) return pk(EYE.white, VF.EMISSIVE);
  return pk(EYE.back);
}

// ------------------------------------------------------------------ arms (left; mirrored)
function armF(x: number, y: number, z: number) {
  let d = ell(x, y, z, 8.4, 19.0, 0.5, 2.85, 2.7, 3.0); // shoulder cap
  d = smin(d, coneV(x, y, z, SH, EL, 2.2, 1.62), 1.2);
  d = smin(d, ell(x, y, z, 9.6, 15.5, 2.4, 1.9, 2.9, 1.7), 1.0); // biceps
  d = smin(d, ell(x, y, z, 10.0, 15.4, 0.4, 1.8, 3.0, 1.6), 1.0); // triceps
  d = smin(d, ell(x, y, z, 9.6, 20.6, 1.0, 2.0, 0.55, 2.2), 0.6); // shelf on the shoulder
  if (d > 2.2 || d < -2.2) return d;
  return d + erode(x, y, z, 211, 1, crackMask(x, y, z) * 0.45 + 0.25);
}
const FA: V3 = [WR[0] - EL[0], WR[1] - EL[1], WR[2] - EL[2]];
const FA_L2 = FA[0] * FA[0] + FA[1] * FA[1] + FA[2] * FA[2];
const alongFore = (x: number, y: number, z: number) => ((x - EL[0]) * FA[0] + (y - EL[1]) * FA[1] + (z - EL[2]) * FA[2]) / FA_L2;
const band = (t: number, a: number, b: number) => sstep(a - 0.02, a + 0.02, t) * (1 - sstep(b - 0.02, b + 0.02, t));
function foreF(x: number, y: number, z: number) {
  let d = ell(x, y, z, 12.6, 10.0, 1.9, 1.55, 1.65, 1.35); // elbow knob
  d = smin(d, coneV(x, y, z, EL, WR, 1.86, 1.2), 1.0);
  d = smin(d, ell(x, y, z, 13.6, 7.4, 4.6, 1.9, 2.7, 1.75), 1.0); // brachioradialis bulk
  d = smin(d, ell(x, y, z, 14.3, 2.9, 6.3, 1.42, 1.3, 1.42), 0.6); // wrist
  if (d > 2.2 || d < -2.2) return d;
  const t = alongFore(x, y, z);
  const wrap = band(t, 0.48, 0.66), bracer = band(t, 0.79, 0.9);
  return d - 0.16 * wrap - 0.22 * bracer + erode(x, y, z, 223, 1 - 0.8 * Math.max(wrap, bracer), (crackMask(x, y, z) * 0.45 + 0.3) * (1 - Math.max(wrap, bracer)));
}
function forePaint(x: number, y: number, z: number, _nx: number, ny: number) {
  const t = alongFore(x, y, z);
  if (t > 0.79 && t < 0.9) {
    if (Math.abs(t - 0.845) < 0.018) return h3(Math.round(x * 3), Math.round(y * 3), Math.round(z * 3), 7) < 0.5 ? pk(LAPIS) : pk(GOLD.hi, VF.METAL);
    return pk(t < 0.8 || t > 0.888 ? GOLD.shade : ny > 0.4 ? GOLD.hi : GOLD.base, VF.METAL);
  }
  if (t > 0.48 && t < 0.66) {
    const u = t * 38 + Math.atan2(x - 14, z - 5) * 1.2;
    const f = u - Math.floor(u);
    let c = f < 0.18 ? LINEN.shade : Math.floor(u) % 3 === 0 ? LINEN.hi : LINEN.base;
    if (vn(x * 1.2, y * 1.2, z * 1.2, 71) > 0.62) c = mix(c, SAND.shade, 0.5); // sand-stained
    if (ny > 0.62) c = SAND.top;
    return pk(c, VF.SOFTAO);
  }
  return rockPaint(x, y, z, ny, crackMask(x, y, z) * 0.45 + 0.3);
}
function palmF(x: number, y: number, z: number) {
  const c = toHand(x, y, z), cx = c[0], cy = c[1], cz = c[2];
  const hx = 1.22 + 0.32 * clamp01(cz / 2.85);
  const arch = 0.22 * (1 - (cx / 1.6) ** 2);
  const qx = Math.abs(cx) - hx + 0.5, qy = Math.abs(cy - arch * 0.5) - 0.62 + 0.5, qz = Math.abs(cz - 1.45) - 1.42 + 0.5;
  let d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - 0.5;
  d = smin(d, ell(cx, cy, cz, 0, 0.05, 0.0, 1.3, 1.08, 1.15), 0.5); // wrist blend
  for (const f of FINGERS) d = smin(d, ell(cx, cy, cz, f.x, 0.5, f.z - 0.15, 0.5, 0.38, 0.52), 0.3); // knuckles
  d = smin(d, ell(cx, cy, cz, -0.9, -0.45, 1.1, 0.75, 0.45, 0.95), 0.4); // thenar pad
  return d > 1.2 || d < -1.2 ? d : d + erode(x, y, z, 241, 0.5, 0.45);
}
const handPaint: Paint = (x, y, z, _nx, ny) => rockPaint(x, y, z, ny, 0.45);

// ------------------------------------------------------------------ falling sand (a ragged curtain tearing into strands)
function pourInto(m: VoxelModel, top: V3, len: number, w: number, face: number, seed: number) {
  const N = Math.round(len * S);
  const ux = Math.cos(face), uz = -Math.sin(face); // across the curtain
  const tx = Math.sin(face), tz = Math.cos(face); // through it
  for (let j = 0; j < N; j++) {
    const t = j / N;
    const y = top[1] - j / S;
    const half = Math.max(1, Math.round((w * (1 - 0.5 * t) + 0.2) * S * 0.5));
    const sa = Math.sin(t * 4.2 + seed) * 0.22 * t, sb = Math.cos(t * 3.1 + seed * 1.7) * 0.18 * t;
    const thick = t < 0.3 ? 2 : 1;
    for (let u = -half; u <= half; u++) {
      const uu = u / half;
      if (t > 0.3 && Math.abs(Math.sin(uu * 3.6 + seed * 2.3 + t * 2.2)) < 0.35 + (t - 0.3) * 0.8) continue;
      if (Math.abs(uu) > 0.85 && h3(u, j, 1, seed) < 0.5) continue;
      if (t > 0.78 && h3(u, j, 2, seed) < (t - 0.78) * 3.5) continue;
      const c = (Math.floor(j / 2) + u) % 3 === 0 ? SAND.hi : h3(u, j, 3, seed) < 0.5 ? SAND.top : SAND.base;
      for (let k = 0; k < thick; k++) {
        const al = u / S + sa;
        const x = top[0] + ux * al + tx * (k / S + sb), z = top[2] + uz * al + tz * (k / S + sb);
        m.set(Math.round(x * S), Math.round(y * S - 0.5), Math.round(z * S - 0.5), c, VF.SOFTAO);
      }
    }
  }
}

// ------------------------------------------------------------------ the crack that splits the mask when it hits the sand
function crackInto(m: VoxelModel) {
  const paths: [number, number][][] = [
    [[0.25, 4.6], [0.05, 3.9], [0.45, 3.3], [0.3, 2.6], [-0.25, 2.1], [0.1, 1.5], [-0.05, 0.6]],
    [[0.45, 3.3], [1.1, 3.55], [1.7, 3.95], [2.3, 4.0]],
    [[-0.25, 2.1], [-0.9, 1.75], [-1.5, 1.95], [-2.1, 2.5]],
    [[0.05, 3.9], [-0.7, 4.3], [-1.4, 4.6]],
  ];
  for (const path of paths)
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, ay] = path[i], [bx, by] = path[i + 1];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) * S * 2);
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        const cx = ax + (bx - ax) * t + Math.sin(t * 9 + i) * 0.04, cy = ay + (by - ay) * t;
        let cz = 6.5;
        while (cz > -2 && maskF(cx, cy, cz) > 0) cz -= 0.04;
        if (cz <= -2) continue;
        for (const [ox, f] of [[0, 0], [1, 1], [-1, 1]] as [number, number][]) {
          const p = fromHead([cx + (ox * 0.9) / S, cy, cz + 0.12]);
          m.set(Math.round(p[0] * S), Math.round(p[1] * S - 0.5), Math.round(p[2] * S - 0.5), f ? MOON.base : 0x24160c, f ? VF.EMISSIVE : VF.SOLID);
        }
      }
    }
}

// ============================================================================= the colossus
export function khonsuSandRig(): RigSpec {
  const rig = new TRig('khonsu_sand', VS);
  const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

  // ------------------------------------------------------------------ body
  buildSkirt(rig.part('pelvis', undefined, P([0, 6.0, 0])));
  sculpt(rig.part('spine', 'pelvis', P(SPINE_PIV)), [-6.6, 4.0, -6.2, 6.6, 12.8, 6.4], spineF, (x, y, z, _nx, ny) => (y < 4.1 || y > 12.2 ? pk(RECESS) : rockPaint(x, y, z, ny, crackMask(x, y, z) * 0.8)));
  const torso = rig.part('torso', 'spine', P(TORSO_PIV));
  sculpt(torso, [-12.4, 10.4, -10.4, 12.4, 23.4, 7.6], torsoF, torsoPaint);
  sculpt(rig.part('ribs_l', 'torso', P(RIB_HINGE)), [-0.2, 11.1, 1.2, 5.6, 18.9, 6.2], ribsF, ribPaint);
  sculpt(rig.part('core', 'torso', P(CORE_C)), [-2.1, 12.8, 2.2, 2.1, 17.2, 3.9], coreF, corePaint);

  // ------------------------------------------------------------------ head
  const head = rig.part('head', 'torso', P(HEAD_PIV));
  sculpt(head, headBox(-4.4, -1.6, -3.6, 4.4, 12.2, 5.9), headF, headPaint);
  sculpt(rig.part('jaw', 'head', P(fromHead([0, 1.05, -0.4]))), headBox(-1.8, 0.1, -1.1, 1.8, 1.7, 5.0), jawF, jawPaint);
  const ec = fromHead(EYE_C);
  sculpt(rig.part('eye_l', 'head', P(ec)), bounds([ec], 1.0), eyeF, eyePaint);
  crackInto(rig.part('mask_crack', 'head', P(HEAD_PIV)));
  const beakTip = fromHead([0, -0.25, 5.15]);
  pourInto(rig.part('pour_beak', 'head', P(beakTip)), beakTip, 3.8, 0.45, 0, 7);

  // ------------------------------------------------------------------ arm, forearm, hand, fingers
  sculpt(rig.part('arm_l', 'torso', P(SH)), [4.6, 7.0, -3.4, 14.8, 22.8, 6.6], armF, (x, y, z, _nx, ny) => rockPaint(x, y, z, ny, crackMask(x, y, z) * 0.45 + 0.25));
  sculpt(rig.part('fore_l', 'arm_l', P(EL)), [10.2, -0.4, -0.4, 16.6, 12.2, 9.2], foreF, forePaint);
  const pc: V3[] = [];
  for (const cx of [-2.0, 2.0]) for (const cy of [-1.4, 1.4]) for (const cz of [-1.4, 3.6]) pc.push(fromHand([cx, cy, cz]));
  sculpt(rig.part('hand_l', 'fore_l', P(WR)), bounds(pc, 0.2), palmF, handPaint);
  const fingerAxes: V3[] = [];
  FINGERS.forEach((f, k) => {
    const K: V3 = [f.x, -0.08, f.z];
    const J = add(K, fdir(f.sp, REST_CURL[0]), f.l1);
    const T = add(J, fdir(f.sp, REST_CURL[0] + REST_CURL[1]), f.l2);
    const [Kr, Jr, Tr] = [fromHand(K), fromHand(J), fromHand(T)];
    const seg = (a: V3, b: V3, ra: number, rb: number, knob: number, seed: number): Field => (x, y, z) => {
      let d = coneV(x, y, z, a, b, ra, rb);
      d = smin(d, ell(x, y, z, a[0], a[1], a[2], knob, knob * 0.9, knob), 0.2);
      return d > 0.8 || d < -0.8 ? d : d + erode(x, y, z, seed, 0.3, 0.45);
    };
    sculpt(rig.part(`fing${k + 1}_l`, 'hand_l', P(Kr)), bounds([Kr, Jr], f.r0 + 0.5), seg(Kr, Jr, f.r0, f.r1, f.r0 * 1.12, 300 + k), handPaint);
    sculpt(rig.part(`tip${k + 1}_l`, `fing${k + 1}_l`, P(Jr)), bounds([Jr, Tr], f.r1 + 0.5), seg(Jr, Tr, f.r1, f.r2, f.r1 * 1.1, 310 + k), handPaint);
    fingerAxes.push(handVec([Math.cos(f.sp), 0, -Math.sin(f.sp)]));
  });
  {
    const B = THUMB.b, J = add(B, THUMB.d1, THUMB.l1), T = add(J, THUMB.d2, THUMB.l2);
    const [Br, Jr, Tr] = [fromHand(B), fromHand(J), fromHand(T)];
    const thumbSeg = (a: V3, b: V3, ra: number, rb: number, seed: number): Field => (x, y, z) => {
      const d = smin(coneV(x, y, z, a, b, ra, rb), ell(x, y, z, a[0], a[1], a[2], ra * 1.1, ra, ra * 1.1), 0.25);
      return d > 0.8 || d < -0.8 ? d : d + erode(x, y, z, seed, 0.3, 0.45);
    };
    sculpt(rig.part('thumb_l', 'hand_l', P(Br)), bounds([Br, Jr], THUMB.r[0] + 0.5), thumbSeg(Br, Jr, THUMB.r[0], THUMB.r[1], 320), handPaint);
    sculpt(rig.part('thumbtip_l', 'thumb_l', P(Jr)), bounds([Jr, Tr], THUMB.r[1] + 0.5), thumbSeg(Jr, Tr, THUMB.r[1], THUMB.r[2], 321), handPaint);
  }
  const thumbAxis = handVec(norm(cross(THUMB.d1, norm([0.55, -0.55, 0.62]))));

  // ------------------------------------------------------------------ sand pouring off him (the material makes it flow)
  const sh1: V3 = [9.6, 20.2, 3.1], sh2: V3 = [11.1, 19.9, 0.6], elb: V3 = [12.7, 9.9, 1.75];
  pourInto(rig.part('pour_sh1_l', 'torso', P(sh1)), sh1, 7.5, 1.4, 0.35, 1);
  pourInto(rig.part('pour_sh2_l', 'torso', P(sh2)), sh2, 6.2, 1.0, -1.25, 2);
  pourInto(rig.part('pour_el_l', 'fore_l', P(elb)), elb, 6.4, 0.9, -0.9, 3);
  const palmBottom = fromHand([0, -0.66, 1.5]);
  pourInto(rig.part('pour_hand_l', 'hand_l', P(palmBottom)), palmBottom, 12, 1.5, 0.2, 4);

  // ------------------------------------------------------------------ sockets, mirror, build
  rig.socket('core', 'core', P([0, CORE_C[1], 3.7]));
  rig.socket('mouth', 'head', P(fromHead([0, 0.3, 4.9])));
  rig.socket('head_top', 'head', P(fromHead([0, DISK_Y, -0.5])));
  rig.socket('back', 'torso', P([0, 21.6, -5.6]));
  rig.socket('hand_l', 'hand_l', P(palmBottom));
  rig.socket('shoulder_l', 'torso', P([9.4, 20.8, 1.2]));
  rig.mirrorLR();

  const K0 = fromHand([0, -0.62, 2.7]); // IK effector: under the knuckles
  const ik = {
    shoulder: RL(SH),
    elbow: RL(EL),
    wrist: RL(WR),
    knuckle: RL(K0),
    palm: RL(fromHand([0, 0, 1.5])),
    fist: RL(add3(fromHand([0, -0.62, 2.7]), handVec([0, -0.75, 0.15]))),
    handX: HL,
    handY: HU,
    handZ: HF,
    fingerAxes,
    thumbAxis,
    restCurl: REST_CURL,
    pourTops: { pour_sh1: RL(sh1), pour_sh2: RL(sh2), pour_el: RL(elb), pour_hand: RL(palmBottom) },
  };
  return rig.build({
    kind: 'khonsu_sand',
    boss: true,
    height: 33,
    radius: 7.5,
    ik,
    mirrorX: 1 / S, // right side in rig-local metres: x_r = mirrorX − x_l
    core: RL(CORE_C),
    skull: RL(fromHead([0, 2.6, 0.4])),
    eyeAxis: headVec(EYE_A),
    eyeCenter: RL(ec),
    headPivot: RL(HEAD_PIV),
    ribHinge: RL(RIB_HINGE),
    pours: ['pour_sh1_l', 'pour_sh2_l', 'pour_el_l', 'pour_sh1_r', 'pour_sh2_r', 'pour_el_r', 'pour_beak', 'pour_hand_l', 'pour_hand_r'],
    defaultExpression: 'smug',
    expressions: {
      neutral: { jaw: 0 },
      smug: { jaw: 0.04 },
      angry: { jaw: 0.12 },
      hurt: { jaw: 0.2 },
      laugh: { jaw: 0.3 },
      stunned: { jaw: 0.26 },
      enraged: { jaw: 0.34 },
      defeated: { jaw: 0.42 },
    },
    noEyes: true,
  });
}

// ============================================================================= sandstone spike (Mr. Brownstone / Shattered)
/** an eroded, leaning sandstone spire with a broken tip and rubble at its foot; origin = ground under its centre */
export function khonsuSandSpikeModel(seed = 0): { model: VoxelModel; voxelSize: number } {
  const s = 8;
  const R = (k: number) => h3(seed, k, 3, 71);
  const H = 3.7 + R(1) * 1.0, r0 = 0.95 + R(2) * 0.25;
  const la = R(3) * Math.PI * 2, lean = 0.12 + R(4) * 0.12;
  const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
  const tw = 0.6 + R(5) * 0.8, lobes = 3 + Math.floor(R(6) * 2), ph = R(7) * 6, ca = R(8) * 6.28, ck = 0.35 + R(9) * 0.3;
  const rub: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const a = R(20 + i) * 6.28, d = 1.1 + R(30 + i) * 0.6;
    rub.push([Math.cos(a) * d, 0.05, Math.sin(a) * d, 0.28 + R(40 + i) * 0.22]);
  }
  const f: Field = (x, y, z) => {
    const t = clamp01(y / H);
    const ax = x - lx * y * (1 + t * 0.5), az = z - lz * y * (1 + t * 0.5);
    const rr = Math.hypot(ax, az), ang = Math.atan2(az, ax);
    const R0 = (r0 * Math.pow(1 - t, 0.8) + 0.07) * (1 + 0.2 * Math.sin(lobes * ang + tw * y + ph));
    let d = Math.max((rr - R0) * 0.75, -y - 0.7, y - (H - 0.35 - Math.cos(ang - ca) * ck * Math.min(rr, 0.6) * 1.6));
    for (const r of rub) d = Math.min(d, ell(x, y, z, r[0], r[1], r[2], r[3], r[3] * 0.8, r[3] * 1.1));
    return d > 0.6 || d < -0.6 ? d : d + erode(x * 1.6, y * 1.6, z * 1.6, 400 + seed, 0.28, 0.5) * 0.6;
  };
  const m = new VoxelModel('khonsu_sand_spike');
  const ox = lx * H * 1.5, oz = lz * H * 1.5;
  const g = new Grid(s, Math.min(0, ox) - 1.9, -0.8, Math.min(0, oz) - 1.9, Math.max(0, ox) + 1.9, H + 0.4, Math.max(0, oz) + 1.9);
  g.fill(f);
  g.emit(m, (x, y, z, _nx, ny) => {
    if (y < 0.35) return pk(ny > 0.4 ? SAND.top : SAND.base);
    return rockPaint(x * 1.6, y * 1.6, z * 1.6, ny, 0.45);
  });
  return { model: m, voxelSize: 1 / s };
}
