// KHONSU'S MOON AND HIS INSTRUMENTS OF TIME (both Khonsu fights; bosses/khonsu/*).
//
// The moon he raises over the desert: a sculpted voxel face of the moon (the half that
// faces the hunter; it is turned to the camera at all times), 61 voxels across, with
// ray craters, terraced rims, central peaks, dark seas, highland grit and pale ejecta
// rays. Three fracture stages (glowing seams that grow from one fissure into a
// shattered web, each a separate mesh one voxel proud of the face), and the corona of
// the blood eclipse: ragged streamers of light around the rim.
// Crescent shards: broken horns of moon rock (three cuts), chipped back edge, pocked
// face, a cold glowing inner edge. 1/20 m.
// The hourglass (rig, 1/24 m, 2 m tall): moon-silver caps with gold rims and crescent
// finials, three turned posts, a glass of two bulbs (meta.glass: a separate model the
// boss draws translucent) and pale-gold sand: `sand_top` (pivot at the neck: scale y to
// drain), `sand_bot` (pivot on the floor: scale to pile), `stream` (neck to floor).
// The clock dial (rig, 1/16 m, 4.2 m radius): a bezel lying on the sand with sixty
// minute ticks, twelve hour marks cut as moon phases, a crescent-crowned minute hand
// (`hand_m`) and a short hour hand (`hand_h`) on a moon boss. +rotation.y on a hand
// turns it clockwise seen from above.
// Mark's crescent board (fallback for the reveal and the hideout, 1/32 m) and a moon-cat
// rider silhouette (1/30 m, only ever drawn as a dark shape against moonlight).
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec } from '../../../engine/voxel/Rig';
import { RNG } from '../../../engine/math/rand';
import { ell, seg, chain, rbox, type V3 } from './tk';

// ----------------------------------------------------------------------------- palette
const HIGH = [0xe7ebf2, 0xd8dde8, 0xf3f5fa]; // highlands
const SEA = [0x8f99ae, 0x7f899f, 0x9ca6ba]; // maria
const FLOOR = 0xb9c1d1;
const RIM = 0xfbfcff;
const RAY = 0xf6f8fd;
const SILVER = { base: 0xc9d2e2, shade: 0x96a1b8, hi: 0xf0f4fb, dark: 0x5f6a82 };
const GOLD = { base: 0xd2a63c, shade: 0xa47b25, hi: 0xf0d273, dark: 0x6a4a12 };
const LAPIS = 0x2f4f9c;
const SANDG = [0xf3d29a, 0xe8c27e, 0xfae3b4];
const CRACK = [0xe8f6ff, 0xbfe4ff, 0x9fd0ff];

function h3(x: number, y: number, z: number, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, z: number, cell: number, s = 0) {
  const fx = x / cell, fy = y / cell, fz = z / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const tx = fx - ix, ty = fy - iy, tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), sz = tz * tz * (3 - 2 * tz);
  const c = (a: number, b: number, d: number) => h3(ix + a, iy + b, iz + d, s);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy), l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy), sz);
}
function mixc(a: number, b: number, t: number) {
  t = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

// ============================================================================= the moon
export const MOON_R = 30;
export interface MoonModels {
  body: VoxelModel;
  /** fracture stages 1..3 (cumulative): index 0 = one fissure */
  cracks: VoxelModel[];
  corona: VoxelModel;
  R: number;
}

interface Crater {
  d: [number, number, number];
  r: number;
  depth: number;
  young: boolean;
  peak: boolean;
}

let MOON: MoonModels | null = null;
export function khonsuMoonModels(): MoonModels {
  if (MOON) return MOON;
  const R = MOON_R;
  const rng = new RNG(7177);
  const craters: Crater[] = [];
  const dirOn = (): [number, number, number] => {
    // a point on the visible face, kept off the extreme limb
    for (;;) {
      const x = rng.range(-0.95, 0.95), y = rng.range(-0.95, 0.95);
      if (x * x + y * y > 0.86) continue;
      return [x, y, Math.sqrt(1 - x * x - y * y)];
    }
  };
  // the named landmarks first: two big ray craters, a terraced giant, then the field
  craters.push({ d: [-0.32, -0.55, Math.sqrt(1 - 0.32 * 0.32 - 0.55 * 0.55)], r: 4.5, depth: 1.6, young: true, peak: true });
  craters.push({ d: [0.46, 0.18, Math.sqrt(1 - 0.46 * 0.46 - 0.18 * 0.18)], r: 3.6, depth: 1.3, young: true, peak: false });
  craters.push({ d: [0.12, 0.56, Math.sqrt(1 - 0.12 * 0.12 - 0.56 * 0.56)], r: 7.5, depth: 2.2, young: false, peak: true });
  for (let i = 0; i < 34; i++) {
    const r = 1.4 + Math.pow(rng.next(), 2.2) * 6.5;
    craters.push({ d: dirOn(), r, depth: r * (0.22 + rng.next() * 0.1), young: false, peak: r > 4.5 && rng.chance(0.6) });
  }
  // the seas: broad, shallow, dark lowlands
  const seas = [
    { d: [-0.28, 0.3, 0.91], r: 12, depth: 0.8 },
    { d: [0.3, -0.25, 0.92], r: 10, depth: 0.7 },
    { d: [-0.55, -0.05, 0.83], r: 8, depth: 0.6 },
    { d: [0.05, 0.05, 1], r: 6, depth: 0.5 },
  ].map((s) => {
    const l = Math.hypot(s.d[0], s.d[1], s.d[2]);
    return { ...s, d: [s.d[0] / l, s.d[1] / l, s.d[2] / l] as [number, number, number] };
  });
  const cut = craters.map((c) => Math.cos(Math.min(Math.PI, ((c.young ? 7 : 1.8) * c.r) / R)));
  const rimH = craters.map((c, i) => Math.max(0.6, c.r * 0.14) * (0.8 + 0.4 * h3(i, 7, 1, 17)));
  const arc = (a: number[], b: number[]) => R * Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  // height (voxels above R) and the paint for a direction
  const surf = (dx: number, dy: number, dz: number): { h: number; c: number } => {
    const dir = [dx, dy, dz];
    let h = 0;
    let sea = 0;
    for (const s of seas) {
      const u = arc(dir, s.d) / s.r;
      if (u < 1.4) {
        const k = u < 1 ? 1 : 1 - (u - 1) / 0.4;
        h -= s.depth * k * (0.85 + 0.3 * vnoise(dx * 40, dy * 40, dz * 40, 4, 3));
        sea = Math.max(sea, k);
      }
    }
    sea = Math.min(1, sea * (0.75 + 0.5 * vnoise(dx * 30, dy * 30, dz * 30, 3, 9)));
    let floor = 0, rim = 0, ray = 0;
    for (let ci = 0; ci < craters.length; ci++) {
      const c = craters[ci];
      const dot = dir[0] * c.d[0] + dir[1] * c.d[1] + dir[2] * c.d[2];
      if (dot < cut[ci]) continue; // too far to touch this point
      const d = R * Math.acos(Math.min(1, dot));
      const u = d / c.r;
      if (u < 1) {
        h -= c.depth * (1 - u * u);
        floor = Math.max(floor, 1 - u);
        // a central peak in the bigger bowls
        if (c.peak && u < 0.22) h += c.depth * 0.75 * (1 - u / 0.22);
      }
      // terraced, raised rim (each crater its own height)
      if (u < 1.8) {
        const rr = Math.exp(-(((u - 1) / 0.24) ** 2));
        h += rimH[ci] * rr;
        rim = Math.max(rim, rr);
      }
      // young craters throw pale rays across the face
      if (c.young && u > 1.1 && u < 7) {
        const ax = dir[0] - c.d[0], ay = dir[1] - c.d[1];
        const ang = Math.atan2(ay, ax);
        const beam = Math.pow(Math.max(0, Math.cos(ang * 7 + c.r) * Math.cos(ang * 3.3 + 1.7)), 6);
        ray = Math.max(ray, beam * (1 - (u - 1.1) / 5.9));
      }
    }
    const hx = Math.round(dx * 120), hy = Math.round(dy * 120), hz = Math.round(dz * 120);
    const grit = h3(hx, hy, hz, 5);
    let c = mixc(HIGH[grit < 0.2 ? 1 : grit > 0.86 ? 2 : 0], SEA[grit < 0.3 ? 1 : grit > 0.8 ? 2 : 0], sea);
    if (floor > 0) c = mixc(c, mixc(FLOOR, SEA[0], sea), Math.min(1, floor * 1.4) * 0.55);
    if (rim > 0.55) c = mixc(c, RIM, (rim - 0.55) * 1.6);
    if (ray > 0.25 && sea < 0.7) c = mixc(c, RAY, Math.min(0.8, ray));
    return { h, c };
  };
  const body = new VoxelModel('khonsu_moon');
  const N = R + 3;
  const top = new Map<number, number>(); // (x,y) → outermost z, for the cracks
  for (let x = -N; x <= N; x++)
    for (let y = -N; y <= N; y++) {
      if (x * x + y * y > (R + 2.5) ** 2) continue;
      // one surface sample per column (the shell is thin, its bearing barely changes through it)
      const zs = Math.sqrt(Math.max(0, (R + 3) ** 2 - x * x - y * y));
      const zi = Math.sqrt(Math.max(0, (R - 7) ** 2 - x * x - y * y));
      const zc = Math.sqrt(Math.max(0, R * R - x * x - y * y));
      const rc = Math.hypot(x, y, zc) || 1;
      const sf = surf(x / rc, y / rc, zc / rc);
      for (let z = Math.min(N, Math.ceil(zs)); z >= Math.max(-3, Math.floor(zi) - 1); z--) {
        const r = Math.hypot(x, y, z);
        if (r > R + 3 || r < R - 6) continue;
        const Rs = R + sf.h;
        if (r <= Rs && r > Rs - 2.6) {
          body.set(x, y, z, sf.c);
          const k = (x + 64) * 256 + (y + 64);
          if (!top.has(k)) top.set(k, z);
        }
      }
    }
  // ------------------------------------------------------------------ fractures (cumulative stages)
  const cracks: VoxelModel[] = [];
  const crackRng = new RNG(911);
  const paths: [number, number][][] = [];
  const walk = (x0: number, y0: number, ang: number, len: number, wob: number) => {
    const p: [number, number][] = [[x0, y0]];
    let x = x0, y = y0, a = ang;
    for (let i = 0; i < len; i++) {
      a += crackRng.range(-wob, wob);
      x += Math.cos(a) * 2.4;
      y += Math.sin(a) * 2.4;
      if (x * x + y * y > (R - 1) ** 2) break;
      p.push([x, y]);
    }
    return p;
  };
  // stage 1: one great fissure from the upper left down across the face
  const main = walk(-19, 15, -0.72, 22, 0.42);
  paths.push(main);
  const stage1 = paths.length;
  // stage 2: three branches from the fissure
  for (const i of [5, 10, 15]) {
    const at = main[Math.min(i, main.length - 1)];
    paths.push(walk(at[0], at[1], -0.72 + (i % 2 ? 1.3 : -1.25), 7 + (i % 3), 0.5));
  }
  const stage2 = paths.length;
  // stage 3: the web: more branches, and a ring fracture round a slab about to break off
  for (let k = 0; k < 7; k++) {
    const src = paths[1 + (k % 3)] ?? main;
    const at = src[Math.min(src.length - 1, 2 + (k % 4))];
    paths.push(walk(at[0], at[1], crackRng.range(0, Math.PI * 2), 4 + (k % 3), 0.6));
  }
  {
    const ring: [number, number][] = [];
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.18) ring.push([12 + Math.cos(a) * 7 * (0.9 + 0.2 * Math.sin(a * 3)), -10 + Math.sin(a) * 6]);
    paths.push(ring);
  }
  const stage3 = paths.length;
  const stamp = (m: VoxelModel, p: [number, number][], wide: boolean) => {
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      for (let t = 0; t <= L; t += 0.45) {
        const x = Math.round(ax + ((bx - ax) * t) / L), y = Math.round(ay + ((by - ay) * t) / L);
        for (const [ox, oy] of wide ? [[0, 0], [1, 0], [0, 1]] : [[0, 0]]) {
          const zx = x + ox, zy = y + oy;
          const z = top.get((zx + 64) * 256 + (zy + 64));
          if (z === undefined) continue;
          const g = h3(zx, zy, 3, 77);
          m.set(zx, zy, z + 1, CRACK[g < 0.5 ? 0 : g < 0.85 ? 1 : 2], VF.GLOW);
        }
      }
    }
  };
  for (const upto of [stage1, stage2, stage3]) {
    const m = new VoxelModel('khonsu_moon_crack');
    for (let i = 0; i < upto; i++) stamp(m, paths[i], i === 0);
    cracks.push(m);
  }
  // ------------------------------------------------------------------ the corona (blood eclipse): ragged streamers round the rim
  const corona = new VoxelModel('khonsu_moon_corona');
  const cr = new RNG(4242);
  const STREAM = [0xffe2d0, 0xffb59a, 0xff7a5a, 0xffd8c8];
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + cr.range(-0.05, 0.05);
    const len = 3 + Math.pow(cr.next(), 2) * (i % 5 === 0 ? 16 : 8);
    const curl = cr.range(-0.3, 0.3);
    let px = Math.cos(a) * (R + 0.5), py = Math.sin(a) * (R + 0.5);
    let ang = a;
    for (let s = 0; s < len; s++) {
      ang += curl * 0.08;
      px += Math.cos(ang);
      py += Math.sin(ang);
      const k = s / len;
      const c = STREAM[Math.min(3, Math.floor(k * 3 + h3(i, s, 0, 2) * 1.2))];
      corona.set(Math.round(px), Math.round(py), -1, c, VF.GLOW);
      if (k < 0.45) corona.set(Math.round(px + Math.cos(ang + 1.57) * 0.6), Math.round(py + Math.sin(ang + 1.57) * 0.6), -1, c, VF.GLOW);
    }
  }
  // a thin bright ring hugging the limb under the streamers (the diamond edge of the eclipse)
  for (let a = 0; a < Math.PI * 2; a += 0.02) {
    const x = Math.round(Math.cos(a) * (R + 1.2)), y = Math.round(Math.sin(a) * (R + 1.2));
    if (h3(x, y, 1, 3) < 0.15) continue;
    corona.set(x, y, -1, 0xfff0e6, VF.GLOW);
  }
  MOON = { body, cracks, corona, R };
  return MOON;
}

// ============================================================================= crescent shards (1/20 m)
export const SHARD_VS = 1 / 20;
const SHARDS: VoxelModel[] = [];
/** a broken horn of moon rock: the convex back leads (+Z), the glowing inner edge trails */
export function khonsuShardModel(seed: number): { model: VoxelModel; voxelSize: number } {
  const k = seed % 3;
  if (SHARDS[k]) return { model: SHARDS[k], voxelSize: SHARD_VS };
  const m = new VoxelModel('khonsu_shard_' + k);
  const Ro = [17, 15, 19][k], Ri = [13.5, 12, 15.5][k], off = [5.5, 5, 6.5][k];
  const span = [0.82, 0.7, 0.9][k]; // how much of the arc survived the break
  for (let x = -Ro - 1; x <= Ro + 1; x++)
    for (let z = -Ro - 1; z <= Ro + 1; z++) {
      const ro = Math.hypot(x, z);
      const ri = Math.hypot(x, z - off);
      if (ro > Ro || ri < Ri) continue;
      // keep only the front of the arc (the convex side faces +Z), broken off unevenly
      const ang = Math.atan2(x, z);
      if (Math.abs(ang) > Math.PI * span + (h3(x, 0, z, k) - 0.5) * 0.25) continue;
      // thickness: fat in the middle of the band, thin at the horns
      const band = (ro - Math.max(Ri, ri - off * 0.2)) / Math.max(1, Ro - Ri);
      const horn = 1 - Math.abs(ang) / (Math.PI * span);
      const th = Math.max(0.6, 3.2 * Math.sqrt(Math.max(0, horn)) * (0.6 + 0.4 * Math.sin(Math.min(1, band) * Math.PI)));
      for (let y = -Math.ceil(th); y <= Math.ceil(th); y++) {
        if (Math.abs(y) > th) continue;
        // chipped faces: bites out of the back, pocks on the broad faces
        if (Math.abs(y) >= th - 0.8 && h3(x, y, z, k + 9) < 0.12) continue;
        const inner = ri < Ri + 1.3;
        const g = h3(x, y, z, k + 3);
        let c = mixc(HIGH[g < 0.25 ? 1 : 0], SEA[0], vnoise(x, y, z, 5, k) * 0.55);
        if (Math.abs(y) < 1 && ro > Ro - 1.2) c = RIM;
        if (inner) {
          m.set(x, y, z, CRACK[g < 0.5 ? 0 : 1], VF.GLOW);
          continue;
        }
        m.set(x, y, z, c);
      }
    }
  // a few craters pocked into the faces
  const r = new RNG(31 + k);
  for (let i = 0; i < 5; i++) {
    const a = r.range(-2, 2), rad = r.range(Ri + 1.5, Ro - 1);
    const cx = Math.round(Math.sin(a) * rad), cz = Math.round(Math.cos(a) * rad);
    for (const y of [-3, -2, 2, 3]) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (m.has(cx + dx, y, cz + dz) && !m.has(cx + dx, y + Math.sign(y), cz + dz)) m.set(cx + dx, y, cz + dz, FLOOR);
  }
  SHARDS[k] = m;
  return { model: m, voxelSize: SHARD_VS };
}

// ============================================================================= the hourglass (rig, 1/24 m)
export const HOURGLASS_VS = 1 / 24;
export function khonsuHourglassRig(): RigSpec {
  const H = 48, CAP = 4, R = 13;
  const frame = new VoxelModel('khonsu_hourglass_frame');
  const silver = (x: number, y: number, z: number) => {
    const g = h3(x, y, z, 21);
    return g < 0.12 ? SILVER.shade : g > 0.9 ? SILVER.hi : SILVER.base;
  };
  // caps: stepped lunar discs (octagon-ish) with a gold rim and a lapis inlay band
  for (const [y0, dir] of [[0, 1], [H - CAP, -1]] as const) {
    for (let s = 0; s < CAP; s++) {
      const y = y0 + (dir > 0 ? s : CAP - 1 - s);
      const rr = R + 1 - Math.abs(s - 1.2) * 0.9;
      for (let x = -R - 2; x <= R + 2; x++)
        for (let z = -R - 2; z <= R + 2; z++) {
          const oct = Math.max(Math.abs(x), Math.abs(z), (Math.abs(x) + Math.abs(z)) * 0.72);
          if (oct > rr) continue;
          const edge = oct > rr - 1;
          frame.set(x, y, z, edge ? (s === 1 ? GOLD.base : GOLD.shade) : s === 2 && oct > rr - 3 ? LAPIS : silver(x, y, z), edge ? VF.METAL : VF.METAL);
        }
    }
    // a crescent finial at the centre of each cap (outside face)
    const fy = dir > 0 ? -1 : H;
    for (let a = -1.9; a <= 1.9; a += 0.08) {
      const x = Math.round(Math.sin(a) * 4), yy = fy - dir * Math.round(2 + Math.cos(a) * 3);
      frame.set(x, yy, 0, GOLD.hi, VF.METAL).set(x, yy, 1, GOLD.base, VF.METAL);
    }
  }
  // three turned posts with bead mouldings
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const px = Math.round(Math.cos(a) * (R - 1)), pz = Math.round(Math.sin(a) * (R - 1));
    for (let y = CAP; y < H - CAP; y++) {
      const t = (y - CAP) / (H - 2 * CAP);
      const bead = Math.abs(Math.sin(t * Math.PI * 6)) > 0.85 || t < 0.06 || t > 0.94;
      const rr = bead ? 1.6 : 0.9;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (dx * dx + dz * dz <= rr * rr + 0.3) frame.set(px + dx, y, pz + dz, bead ? GOLD.base : silver(px + dx, y, pz + dz), VF.METAL);
    }
  }
  // the glass: two bulbs pinched at the neck (a separate translucent model)
  const mid = H / 2;
  /** outer radius of the glass at height y: a thread at the neck, round bulbs, drawn in at the caps */
  const glassO = (y: number) => {
    const t = Math.abs(y - mid) / (mid - CAP);
    if (t < 0.62) return 1.3 + 9.4 * Math.pow(Math.sin((t / 0.62) * Math.PI * 0.5), 1.2);
    return 10.7 - ((t - 0.62) / 0.38) * 3.2;
  };
  const glass = new VoxelModel('khonsu_hourglass_glass');
  for (let y = CAP; y < H - CAP; y++) {
    const ro = glassO(y);
    for (let x = -12; x <= 12; x++)
      for (let z = -12; z <= 12; z++) {
        const d = Math.hypot(x, z);
        if (d > ro || d < ro - 1.1) continue;
        glass.set(x, y, z, h3(x, y, z, 4) > 0.93 ? 0xffffff : 0xcfe4f4, VF.SOFTAO);
      }
  }
  const glassR = (y: number) => glassO(y) - 1.2;
  const sandC = (x: number, y: number, z: number) => SANDG[h3(x, y, z, 8) < 0.25 ? 1 : h3(x, y, z, 8) > 0.88 ? 2 : 0];
  // top sand: fills the upper bulb from the neck to a level surface (pivot at the neck)
  const top = new VoxelModel('khonsu_hourglass_sand_top');
  for (let y = mid + 1; y <= mid + 13; y++) {
    const rr = glassR(y);
    // the surface dips into a funnel at the centre
    for (let x = -11; x <= 11; x++) for (let z = -11; z <= 11; z++) {
      const d = Math.hypot(x, z);
      if (d > rr) continue;
      if (y > mid + 13 - Math.max(0, 3 - d * 0.6)) continue;
      top.set(x, y - mid, z, sandC(x, y, z), VF.EMISSIVE);
    }
  }
  // bottom pile: a cone heaped on the floor (pivot at the floor)
  const bot = new VoxelModel('khonsu_hourglass_sand_bot');
  for (let y = 0; y <= 12; y++) {
    const rr = Math.min(glassR(CAP + y), 10.5 - y * 0.78);
    for (let x = -11; x <= 11; x++) for (let z = -11; z <= 11; z++) if (Math.hypot(x, z) <= rr) bot.set(x, y, z, sandC(x, y, z), VF.EMISSIVE);
  }
  // the falling thread
  const stream = new VoxelModel('khonsu_hourglass_stream');
  for (let y = 0; y < mid - CAP; y++) {
    stream.set(0, -y, 0, SANDG[(y >> 1) % 3], VF.EMISSIVE);
    if (y % 3 === 1) stream.set(h3(0, y, 0, 6) > 0.5 ? 1 : -1, -y, 0, SANDG[2], VF.EMISSIVE);
  }
  return {
    name: 'khonsu_hourglass',
    voxelSize: HOURGLASS_VS,
    parts: [
      { name: 'frame', model: frame, pivot: [0.5, mid, 0.5], attach: [0, 0, 0] },
      { name: 'sand_top', model: top, pivot: [0.5, 0, 0.5], parent: 'frame', attach: [0.5, mid + 1, 0.5] },
      { name: 'sand_bot', model: bot, pivot: [0.5, 0, 0.5], parent: 'frame', attach: [0.5, CAP, 0.5] },
      { name: 'stream', model: stream, pivot: [0.5, 1, 0.5], parent: 'frame', attach: [0.5, mid, 0.5] },
    ],
    meta: { glass, glassPivot: [0.5, mid, 0.5], height: H * HOURGLASS_VS },
  };
}

// ============================================================================= the clock dial (rig, 1/16 m)
export const DIAL_VS = 1 / 16;
export const DIAL_R = 4.2;
export function khonsuDialRig(): RigSpec {
  const RO = Math.round(DIAL_R / DIAL_VS); // 67
  const dial = new VoxelModel('khonsu_dial');
  const silver = (x: number, y: number, z: number) => {
    const g = h3(x, y, z, 51);
    return g < 0.15 ? SILVER.shade : g > 0.9 ? SILVER.hi : SILVER.base;
  };
  // the bezel: a two-step ring, the outer lip notched at every hour
  for (let x = -RO - 2; x <= RO + 2; x++)
    for (let z = -RO - 2; z <= RO + 2; z++) {
      const d = Math.hypot(x, z);
      if (d > RO + 1 || d < RO - 4) continue;
      const a = Math.atan2(x, z);
      const hour = Math.abs(((a / (Math.PI * 2)) * 12 + 120) % 1 - 0.5) > 0.46;
      const outer = d > RO - 1;
      if (outer && hour) continue; // the notch
      dial.set(x, 0, z, d > RO - 2 ? GOLD.shade : silver(x, 0, z), VF.METAL);
      if (d > RO - 2.5 && d < RO) dial.set(x, 1, z, GOLD.base, VF.METAL);
      else if (d <= RO - 2.5) dial.set(x, 1, z, silver(x, 1, z), VF.METAL);
    }
  // sixty minute ticks
  for (let i = 0; i < 60; i++) {
    if (i % 5 === 0) continue;
    const a = (i / 60) * Math.PI * 2;
    for (let r = RO - 8; r <= RO - 5; r++) dial.set(Math.round(Math.sin(a) * r), 0, Math.round(Math.cos(a) * r), SILVER.hi, VF.EMISSIVE);
  }
  // twelve hour marks cut as moon phases: new moon at twelve, full at six
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const cx = Math.sin(a) * (RO - 12), cz = Math.cos(a) * (RO - 12);
    const phase = Math.cos((i / 12) * Math.PI * 2); // 1 = new, -1 = full
    for (let dx = -4; dx <= 4; dx++)
      for (let dz = -4; dz <= 4; dz++) {
        if (dx * dx + dz * dz > 14) continue;
        // lit part: a disc minus a shifted disc (crescent → full → crescent)
        const sx = dx * Math.cos(a) - dz * Math.sin(a);
        const lit = phase > 0.95 ? false : (sx - phase * 4.2) ** 2 + (dx * Math.sin(a) + dz * Math.cos(a)) ** 2 > 14 || phase < -0.95;
        dial.set(Math.round(cx + dx), 0, Math.round(cz + dz), lit ? 0xf4f8ff : 0x30384e, lit ? VF.GLOW : VF.METAL);
      }
    // the rim of each mark
    for (let t = 0; t < Math.PI * 2; t += 0.3) dial.set(Math.round(cx + Math.cos(t) * 4.4), 0, Math.round(cz + Math.sin(t) * 4.4), GOLD.base, VF.METAL);
  }
  // the hub: a small boss with a crescent on it
  ell(dial, 0, 1, 0, 4.5, 2, 4.5, GOLD.base, VF.METAL);
  ell(dial, 0, 2.6, 0, 2.6, 0.8, 2.6, GOLD.hi, VF.METAL);
  // minute hand: tapered blade with an open crescent near the tip and a moon counterweight
  const hm = new VoxelModel('khonsu_dial_hand_m');
  const L = RO - 9;
  for (let r = -12; r <= L; r++) {
    const t = r / L;
    const w = r < 0 ? 1.2 : r < 6 ? 2.4 : Math.max(0.5, 2.2 * (1 - t) + 0.4);
    for (let x = -3; x <= 3; x++) if (Math.abs(x) <= w) hm.set(x, 0, r, Math.abs(x) > w - 1 ? SILVER.shade : SILVER.hi, VF.EMISSIVE);
    if (r > 0 && r % 9 === 0) hm.set(0, 1, r, GOLD.base, VF.METAL);
  }
  for (let a = 0; a < Math.PI * 2; a += 0.05) {
    // the open crescent two thirds out
    const x = Math.cos(a) * 5, z = L * 0.72 + Math.sin(a) * 5;
    if (Math.hypot(x - 2, z - L * 0.72) < 4.2) continue;
    hm.set(Math.round(x), 0, Math.round(z), GOLD.hi, VF.GLOW);
  }
  ell(hm, 0, 0, -13, 3.6, 1, 3.6, GOLD.base, VF.METAL);
  // hour hand: short and broad with a lozenge tip
  const hh = new VoxelModel('khonsu_dial_hand_h');
  const L2 = Math.round(RO * 0.45);
  for (let r = -6; r <= L2; r++) {
    const t = r / L2;
    const w = t > 0.78 ? 3.2 * (1 - (t - 0.78) / 0.22) : r < 0 ? 1.6 : 1.8;
    for (let x = -4; x <= 4; x++) if (Math.abs(x) <= w) hh.set(x, 0, r, t > 0.78 ? GOLD.hi : GOLD.base, VF.METAL);
  }
  return {
    name: 'khonsu_dial',
    voxelSize: DIAL_VS,
    parts: [
      { name: 'dial', model: dial, pivot: [0.5, 0, 0.5], attach: [0, 0, 0] },
      { name: 'hand_h', model: hh, pivot: [0.5, 0, 0.5], parent: 'dial', attach: [0.5, 3, 0.5] },
      { name: 'hand_m', model: hm, pivot: [0.5, 0, 0.5], parent: 'dial', attach: [0.5, 4, 0.5] },
    ],
    meta: { radius: DIAL_R },
  };
}

// ============================================================================= Mark's crescent board (fallback, 1/32 m)
/** a sandboard cut as a waxing crescent: horns up at nose and tail, linen-wrapped rails, silver inlay */
export function crescentBoardModel(): { model: VoxelModel; voxelSize: number } {
  const m = new VoxelModel('mark_crescent_board_fallback');
  const L = 26; // half length (along z)
  const DECK = [0x2b2f45, 0x232638, 0x353a55];
  const LINEN = [0xd9ccae, 0xbfb08f];
  for (let z = -L - 4; z <= L + 4; z++)
    for (let x = -10; x <= 10; x++) {
      const t = z / L;
      // outer arc of the crescent (convex side down), inner arc cut from the top
      const half = 8.5 * Math.sqrt(Math.max(0, 1 - t * t * 0.92));
      if (Math.abs(x) > half + (Math.abs(t) > 0.9 ? -1 : 0)) continue;
      const lift = Math.round(Math.pow(Math.abs(t), 3.2) * 9); // the horns sweep up
      const rail = Math.abs(x) > half - 1.4;
      const g = h3(x, 0, z, 61);
      const wrap = rail && (z & 3) === 0;
      const col = wrap ? LINEN[g < 0.5 ? 0 : 1] : rail ? SILVER.base : DECK[g < 0.2 ? 1 : g > 0.9 ? 2 : 0];
      m.set(x, lift, z, col, rail ? VF.METAL : VF.SOLID);
      m.set(x, lift + 1, z, wrap ? LINEN[0] : rail ? SILVER.hi : DECK[0], rail ? VF.METAL : VF.SOLID);
    }
  // silver crescent inlay down the deck, glowing faintly
  for (let a = -1.2; a <= 1.2; a += 0.03) {
    const x = Math.round(Math.sin(a) * 4 - 1), z = Math.round(Math.cos(a) * 15 - 9);
    if (m.has(x, 1, z)) m.set(x, 2, z, 0xdfeaff, VF.GLOW);
  }
  // bandage tails trailing off the tail horn
  chain(m, [[2, 9, -L - 1], [4, 7, -L - 6], [3, 5, -L - 11]], [0.8, 0.7, 0.5], LINEN[1]);
  return { model: m, voxelSize: 1 / 32 };
}

// ============================================================================= the moon-cat rider (silhouette stand-in, 1/30 m)
/**
 * Seen only as a dark shape against the moonlight in the reveal: a lean rider crouched on
 * a crescent board, tall cat ears, a long bandage scarf streaming behind. Used when the
 * real Mark rig is not in the build yet. Parts: `board` (root) → `pelvis` → `torso` →
 * `head`, `arm_l`, `arm_r`, `scarf`.
 */
export function moonCatSilhouetteRig(): RigSpec {
  const DARK = 0x1a1c2a, DARK2 = 0x232637;
  const board = crescentBoardModel().model;
  const pelvis = new VoxelModel('mooncat_pelvis');
  // legs in a surf crouch: front leg bent forward, back leg trailing
  chain(pelvis, [[2, 0, 0], [3, -6, 5], [3, -13, 3]], [2.2, 1.8, 1.6], DARK);
  chain(pelvis, [[-2, 0, 0], [-3, -6, -4], [-3, -13, -6]], [2.2, 1.8, 1.6], DARK);
  rbox(pelvis, -3, -15, 1, 5, -13, 7, DARK2, 1);
  rbox(pelvis, -5, -15, -9, 0, -13, -3, DARK2, 1);
  ell(pelvis, 0, 0, 0, 3.6, 2.6, 2.6, DARK);
  const torso = new VoxelModel('mooncat_torso');
  chain(torso, [[0, 0, 0], [0, 6, 1.5], [0, 11, 2.5]], [3, 3.4, 3.6], DARK);
  ell(torso, 0, 11, 2, 5.2, 2, 2.6, DARK2); // shoulders
  const head = new VoxelModel('mooncat_head');
  ell(head, 0, 3.5, 0.5, 3.4, 3.6, 3.4, DARK);
  ell(head, 0, 2, 3, 1.8, 1.4, 1.6, DARK2); // muzzle
  for (const s of [-1, 1]) {
    // tall, pointed ears, tilted out
    for (let y = 0; y < 7; y++) {
      const w = 1.8 * (1 - y / 7) + 0.3;
      for (let x = -2; x <= 2; x++) if (Math.abs(x) <= w) head.set(Math.round(s * (2.2 + y * 0.28) + x), 6 + y, 0, DARK);
    }
  }
  const arm = (s: number) => {
    const a = new VoxelModel('mooncat_arm');
    chain(a, [[0, 0, 0], [s * 3, -5, 2], [s * 6, -8, 5]], [1.6, 1.4, 1.2], DARK);
    ell(a, s * 6, -8.5, 5.5, 1.6, 1.6, 1.6, DARK2);
    return a;
  };
  const scarf = new VoxelModel('mooncat_scarf');
  chain(scarf, [[0, 0, 0], [0, 1, -5], [1, 0, -10], [0, -1, -15], [1, -1, -20]], [1.6, 1.4, 1.2, 1.0, 0.7], 0x2c3048);
  return {
    name: 'mooncat_silhouette',
    voxelSize: 1 / 30,
    parts: [
      { name: 'board', model: board, pivot: [0.5, 0, 0.5], attach: [0, 0, 0] },
      { name: 'pelvis', model: pelvis, pivot: [0.5, 0.5, 0.5], parent: 'board', attach: [0.5 * (30 / 32), 16, 0.5] },
      { name: 'torso', model: torso, pivot: [0.5, 0.5, 0.5], parent: 'pelvis', attach: [0.5, 1, 0.5], rest: [0.35, 0, 0] },
      { name: 'head', model: head, pivot: [0.5, 0.5, 0.5], parent: 'torso', attach: [0.5, 13, 2.5] },
      { name: 'arm_l', model: arm(1), pivot: [0.5, 0.5, 0.5], parent: 'torso', attach: [5, 10, 2] },
      { name: 'arm_r', model: arm(-1), pivot: [0.5, 0.5, 0.5], parent: 'torso', attach: [-5, 10, 2] },
      { name: 'scarf', model: scarf, pivot: [0.5, 0.5, 0.5], parent: 'torso', attach: [0.5, 11, 0] },
    ],
    meta: { height: 1.4 },
  };
}

export type { V3 };
export { seg };
