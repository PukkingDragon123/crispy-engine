// Abandoned desert: every building in the wastes is a ruin now. This file holds
//  - ruinify(): the weathering/collapse pass that turns an intact building model
//    into an abandoned ruin (caved-in roofs with sagging rafters and fallen beams,
//    breached walls with splintered plank ends, a lean, bleached and peeling
//    timber, rusted tin, drifted sand piled against the windward walls and pooled
//    inside), keeping its footprint and entrance;
//  - ruinSpots(): finds the interior floor, corners and walls of a ruin (for loot,
//    nests, egg sacs and webs);
//  - spider decor: cobwebs (1/40), funnel-web nests (1/36), egg sacs intact/burst;
//  - outposts: tall ruined lookout towers (timber signal tower, stone lookout);
//  - oasis plants: lush reeds with cattails, flowering shrubs, lily pads + lotus;
//  - a dragonfly critter rig and broken-plank debris.
// Fronts face +Z. Static models return { model, voxelSize, meta? } (pivot bottom-centre).
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec } from '../../../engine/voxel/Rig';
import { RNG, Noise, hash3 } from '../../../engine/math/rand';
import { PR } from './helpers';
import { mix, mulRGB } from '../../../engine/voxel/VoxelModel';

/** voxel flag (unused by the mesher): decor that never becomes a collider (sand, rubble, silk, cloth scraps) */
export const NOCOL = 64;

type V3 = [number, number, number];
export interface RuinModel {
  model: VoxelModel;
  voxelSize: number;
  meta?: any;
}

const SANDSET = new Set([PR.sand.base, PR.sand.shade, PR.sand.hi, PR.sand.dark]);
const BLEACH = 0xd0c4aa;
const BLEACH_DK = 0xa89c84;
const ROT = 0x5c4a36;
const DUST = 0xe2c492;
const DS = { top: 0xeccb92, ripple: 0xf6dcaa, mid: 0xdcb47c, low: 0xc9a06a };
const SILK = [0xece8de, 0xdcd6c8, 0xf4f1ea, 0xcfc8b6];

const N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const K = (x: number, y: number, z: number) => ((x + 512) << 20) | ((y + 512) << 10) | (z + 512);
const UK = (k: number): V3 => [((k >>> 20) & 1023) - 512, ((k >>> 10) & 1023) - 512, (k & 1023) - 512];

const HSV = new Map<number, [number, number, number]>();
function hsv(c: number): [number, number, number] {
  let h = HSV.get(c);
  if (!h) {
    h = hsvRaw(c);
    if (HSV.size < 20000) HSV.set(c, h);
  }
  return h;
}
function hsvRaw(c: number): [number, number, number] {
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx > 0 ? d / mx : 0, mx];
}

/** thick 3D segment in voxel space (sphere brush of radius r voxels) */
function seg(m: VoxelModel, a: V3, b: V3, col: number | ((t: number, x: number, y: number, z: number) => number | null), r = 0, fl = 0) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = Math.max(1, Math.ceil(L * 2));
  const R = Math.ceil(r);
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t, pz = a[2] + (b[2] - a[2]) * t;
    for (let dx = -R; dx <= R; dx++)
      for (let dy = -R; dy <= R; dy++)
        for (let dz = -R; dz <= R; dz++) {
          if (dx * dx + dy * dy + dz * dz > r * r + 0.25) continue;
          const x = Math.round(px + dx), y = Math.round(py + dy), z = Math.round(pz + dz);
          const c = typeof col === 'number' ? col : col(t, x, y, z);
          if (c !== null) m.set(x, y, z, c, fl);
        }
  }
}

/** ellipsoid fill in voxel space with optional noise and colour fn */
function blobV(m: VoxelModel, c: V3, r: V3, col: (x: number, y: number, z: number) => number | null, o: { noise?: Noise; amp?: number; freq?: number; fl?: number; carve?: boolean; keep?: (lx: number, ly: number, lz: number) => boolean; under?: boolean } = {}) {
  const R = Math.max(r[0], r[1], r[2]) * (1 + (o.amp ?? 0)) + 1;
  for (let x = Math.floor(c[0] - R); x <= Math.ceil(c[0] + R); x++)
    for (let y = Math.floor(c[1] - R); y <= Math.ceil(c[1] + R); y++)
      for (let z = Math.floor(c[2] - R); z <= Math.ceil(c[2] + R); z++) {
        const lx = (x + 0.5 - c[0]) / r[0], ly = (y + 0.5 - c[1]) / r[1], lz = (z + 0.5 - c[2]) / r[2];
        let d = lx * lx + ly * ly + lz * lz;
        if (o.noise) d += o.noise.n3(x * (o.freq ?? 0.2), y * (o.freq ?? 0.2), z * (o.freq ?? 0.2)) * (o.amp ?? 0.3);
        if (d > 1) continue;
        if (o.keep && !o.keep(lx, ly, lz)) continue;
        if (o.carve) {
          m.del(x, y, z);
          continue;
        }
        if (o.under && m.has(x, y, z)) continue;
        const cc = col(x, y, z);
        if (cc !== null) m.set(x, y, z, cc, o.fl ?? 0);
      }
}

// =============================================================================== the ruin pass
export interface RuinOpts {
  seed: number;
  vs: number;
  /** 0..1: how far the roof / upper storey caves in */
  collapse?: number;
  /** wall breaches per 10 m of perimeter */
  breach?: number;
  /** windward drift height (m) */
  sand?: number;
  /** lean of the upper structure (m per m) */
  lean?: number;
  /** model-local entrance point (m from the bottom-centre pivot): the doorway is torn open */
  entrance?: [number, number];
  /** nothing below this height (m) caves in (towers on legs, tanks on stilts) */
  keepBelow?: number;
  /** fraction of canvas to tear away (tents, awnings) */
  tear?: number;
}

const isWoodish = (h: number, s: number, v: number) => h >= 8 && h <= 52 && s > 0.16 && v > 0.18 && v < 0.93;

/**
 * Weather and wreck a building model. Returns a new model; footprint (bounds) and
 * pivot stay put so meta.entrance / footprint keep working.
 */
export function ruinify(src: VoxelModel, o: RuinOpts): VoxelModel {
  const rng = new RNG(o.seed * 7919 + 17);
  const nz = new Noise(o.seed * 31 + 5);
  const vs = o.vs;
  const v = (mm: number) => mm / vs;
  const b = src.bounds();
  const W = b.maxX - b.minX + 1, D = b.maxZ - b.minZ + 1, H = b.maxY - b.minY + 1;
  const cx = (b.minX + b.maxX + 1) / 2, cz = (b.minZ + b.maxZ + 1) / 2;
  const y0 = b.minY;
  const collapse = o.collapse ?? 0.7;
  const keepY = y0 + Math.max(v(o.keepBelow ?? 0), H * 0.3);
  let m = src.clone();
  const removed: number[] = []; // colours of wood that fell
  const carved = new Set<number>();
  const kill = (x: number, y: number, z: number) => {
    const c = m.get(x, y, z);
    if (c === undefined) return;
    const rgbv = c & 0xffffff;
    if (SANDSET.has(rgbv)) return;
    m.del(x, y, z);
    carved.add(K(x, y, z));
    if (removed.length < 4000 && hash3(x, y, z) < 0.5) removed.push(rgbv);
  };

  // ---- 1. roof / upper storey collapse: jagged craters bitten into the roofline (measured
  //         from each column's own top, so signs and chimneys don't shield the roof)
  const colTop = new Map<number, number>();
  for (const key of m.map.keys()) {
    const ck = key & ~(1023 << 10);
    const y = ((key >>> 10) & 1023) - 512;
    const t = colTop.get(ck);
    if (t === undefined || y > t) colTop.set(ck, y);
  }
  const holes: { x: number; z: number; r: number }[] = [];
  if (collapse > 0) {
    const n = 1 + (W * D * vs * vs > 70 ? 1 : 0) + (rng.chance(0.45) ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const sp = i === 0 ? 0.12 : 0.3;
      const hx = cx + rng.range(-sp, sp) * W, hz = cz + rng.range(-sp, sp) * D;
      const r = rng.range(0.22, 0.34) * Math.min(W, D) * (0.65 + 0.5 * collapse);
      holes.push({ x: hx, z: hz, r });
    }
    const del: V3[] = [];
    m.forEach((x, y, z) => {
      if (y < keepY) return;
      const top = colTop.get(K(x, 0, z) & ~(1023 << 10)) ?? b.maxY;
      const hgt = top - y0;
      let cut = 1e9;
      for (const h of holes) {
        const dd = Math.hypot(x + 0.5 - h.x, z + 0.5 - h.z) / (h.r * (1 + 0.28 * nz.n2(x * 0.11, z * 0.11)));
        if (dd >= 1) continue;
        cut = Math.min(cut, top - hgt * 0.55 * collapse * (1 - dd * dd) + nz.n2(x * 0.3 + 4, z * 0.3) * 2.5);
      }
      // the whole roofline is gnawed: jagged broken tops everywhere
      const bite = Math.max(0, nz.n2(x * 0.06 + 9, z * 0.06 - 3) * 0.5 + 0.5 - 0.5) * hgt * 0.32 * collapse;
      cut = Math.min(cut, top + 1 - bite);
      if (y > cut) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) kill(x, y, z);
  }

  // ---- 2. wall breaches (low, wide enough to ride through)
  const per = 2 * (W + D) * vs;
  const nb = Math.round((o.breach ?? 0.8) * per / 8 + rng.range(0, 0.6));
  if (nb > 0) {
    const cand: V3[] = [];
    m.forEach((x, y, z, c) => {
      const hm = (y - y0) * vs;
      if (hm < 0.5 || hm > 1.4 || SANDSET.has(c)) return;
      if ((x * 7 + z * 13 + y * 3) % 5) return;
      for (const [dx, dz] of N4) if (!m.has(x + dx, y, z + dz) && !m.has(x + dx * 3, y, z + dz * 3)) {
        // outward-facing surface: the open side points away from the centre
        if ((x - cx) * dx + (z - cz) * dz > 0) cand.push([x, y, z]);
        break;
      }
    });
    const picked: V3[] = [];
    for (let t = 0; t < nb * 40 && picked.length < nb && cand.length; t++) {
      const p = cand[rng.int(0, cand.length - 1)];
      if (picked.some((q) => Math.hypot(q[0] - p[0], q[2] - p[2]) < v(3))) continue;
      picked.push(p);
    }
    for (const p of picked) {
      const rw = v(rng.range(0.65, 1.15)), rh = v(rng.range(0.8, 1.3));
      const base = y0 + v(0.32);
      for (let x = Math.floor(p[0] - rw - 2); x <= p[0] + rw + 2; x++)
        for (let z = Math.floor(p[2] - rw - 2); z <= p[2] + rw + 2; z++)
          for (let y = base; y <= p[1] + rh + 2; y++) {
            const dy = y - p[1];
            const ry = dy < 0 ? Math.max(1, p[1] - base + 1) : rh;
            const d = ((x - p[0]) ** 2 + (z - p[2]) ** 2) / (rw * rw) + (dy * dy) / (ry * ry);
            if (d > 1 + nz.n3(x * 0.25, y * 0.25, z * 0.25) * 0.45) continue;
            kill(x, y, z);
          }
    }
  }

  // ---- 3. the doorway is torn open (door gone, frame splintered)
  if (o.entrance) {
    const ex = cx + v(o.entrance[0]), ez = cz + v(o.entrance[1]);
    let dx = cx - ex, dz = cz - ez;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    const hw = v(0.85), len = L * 0.75;
    const x0 = Math.floor(Math.min(ex, ex + dx * len) - hw - 1), x1 = Math.ceil(Math.max(ex, ex + dx * len) + hw + 1);
    const z0 = Math.floor(Math.min(ez, ez + dz * len) - hw - 1), z1 = Math.ceil(Math.max(ez, ez + dz * len) + hw + 1);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const rx = x + 0.5 - ex, rz = z + 0.5 - ez;
        const along = rx * dx + rz * dz, side = -rx * dz + rz * dx;
        if (along < 0 || along > len || Math.abs(side) > hw) continue;
        const top = y0 + v(2.3) + Math.round(nz.n2(x * 0.4, z * 0.4) * 2);
        for (let y = y0 + Math.round(v(0.32)); y <= top; y++) if (m.map.has(K(x, y, z))) kill(x, y, z);
      }
  }

  // ---- 4. tattered canvas (tents, awnings): holes and ragged edges
  if (o.tear) {
    const del: V3[] = [];
    m.forEach((x, y, z, c) => {
      const [h, s, vv] = hsv(c);
      const canvas = (vv > 0.7 && s < 0.32 && h > 20 && h < 60) || (h < 20 && s > 0.45 && vv > 0.5);
      if (!canvas || (y - y0) * vs < 0.4) return;
      if (nz.n3(x * 0.13, y * 0.13, z * 0.13) > 1 - (o.tear ?? 0) * 1.1) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) kill(x, y, z);
  }

  // ---- 5. splintered plank ends along every break
  const spl: [number, number, number, number][] = [];
  for (const k of carved) {
    const [x, y, z] = UK(k);
    const below = m.get(x, y - 1, z);
    if (below !== undefined && hash3(x, y, z) < 0.42) {
      const [h, s, vv] = hsv(below & 0xffffff);
      if (isWoodish(h, s, vv)) {
        const L = 1 + Math.floor(hash3(z, x, y) * 3);
        for (let l = 0; l < L; l++) if (carved.has(K(x, y + l, z))) spl.push([x, y + l, z, mix(below & 0xffffff, BLEACH, 0.6)]);
      }
    }
  }
  for (const [x, y, z, c] of spl) m.set(x, y, z, c);

  // ---- 6. lean + sag: the whole frame racks over, rafters slump toward the holes
  const leanX = (o.lean ?? 0.04) * (rng.chance(0.5) ? 1 : -1) * rng.range(0.6, 1.2), leanZ = (o.lean ?? 0.04) * rng.range(-0.6, 0.6);
  const yl = y0 + v(0.45);
  const ys = y0 + H * 0.45;
  const sagA = v(0.35) * collapse;
  {
    const out = new VoxelModel(src.name + '_ruin');
    for (const [key, val] of m.map) {
      const y = ((key >>> 10) & 1023) - 512;
      if (y <= yl) {
        out.map.set(key, val);
        continue;
      }
      const x = ((key >>> 20) & 1023) - 512, z = (key & 1023) - 512;
      let dy = 0;
      if (y > ys)
        for (const h of holes) {
          const d2 = ((x - h.x) ** 2 + (z - h.z) ** 2) / (2 * (h.r * 1.25) ** 2);
          dy = Math.min(dy, -sagA * Math.exp(-d2) * Math.min(1, (y - ys) / Math.max(1, b.maxY - ys)));
        }
      out.map.set(K(Math.round(x + leanX * (y - yl)), Math.round(y + dy), Math.round(z + leanZ * (y - yl))), val);
    }
    m = out;
  }

  // ---- 7. weathering: bleached, split, sun-cracked timber; peeling paint; rust; dusty tops
  for (const [key, val] of m.map) {
    const c = val & 0xffffff, f = val >>> 24;
    const x = ((key >>> 20) & 1023) - 512, y = ((key >>> 10) & 1023) - 512, z = (key & 1023) - 512;
    if (SANDSET.has(c)) {
      m.map.set(key, VoxelModel.pack((y & 1) ? DS.mid : DS.low, NOCOL));
      continue;
    }
    const [h, s, vv] = hsv(c);
    const n = nz.n2(x * 0.09 + y * 0.05, z * 0.09 - y * 0.06) * 0.5 + 0.5;
    let out = c;
    let fl = f;
    if (f & VF.METAL) {
      const rust = nz.n2(x * 0.2 + y * 0.13, z * 0.2 - y * 0.11) * 0.5 + 0.5;
      out = mix(c, rust > 0.55 ? 0x7a3a1c : 0xa0582e, 0.35 + rust * 0.45);
      if (rust > 0.5) fl = f & ~VF.METAL;
    } else if (isWoodish(h, s, vv)) {
      out = mix(c, BLEACH, 0.42 + n * 0.3);
      const grain = Math.abs(nz.n2((x + z) * 0.7, y * 0.06));
      if (grain < 0.045) out = mix(out, ROT, 0.55);
      else if (hash3(x, y, z) < 0.04) out = mix(out, BLEACH_DK, 0.6);
    } else if (s > 0.32 || (vv > 0.85 && s < 0.16)) {
      // paint: faded, peeling off in patches down to grey wood
      const peel = nz.n2((x + z) * 0.13 + 3, y * 0.13) * 0.65 + nz.n2((x - z) * 0.31 - 7, y * 0.31 + 2) * 0.35;
      out = peel > 0.12 ? mix(BLEACH, BLEACH_DK, n * 0.6) : peel > 0.04 ? mix(c, BLEACH, 0.7) : mix(c, BLEACH, 0.38);
    } else if (vv > 0.2) out = mix(c, BLEACH, 0.22);
    if (!m.map.has(key + 1024)) out = mix(out, DUST, 0.22);
    if ((y - y0) * vs < 0.35) out = mix(out, 0x8a6a48, 0.2);
    if (out !== c || fl !== f) m.map.set(key, VoxelModel.pack(out, fl));
  }

  // ---- 8. what fell: rubble mounds of planks and slanted beams under each hole
  const woodCol = (i: number) => mix(removed.length ? removed[Math.floor(hash3(i, 7, 3) * removed.length) % removed.length] : PR.wood.base, BLEACH, 0.55);
  holes.forEach((h, hi) => {
    const fy = y0 + v(0.3);
    const rr = h.r * 0.75;
    for (let x = Math.floor(h.x - rr); x <= h.x + rr; x++)
      for (let z = Math.floor(h.z - rr); z <= h.z + rr; z++) {
        const d = Math.hypot(x + 0.5 - h.x, z + 0.5 - h.z) / rr;
        if (d > 1) continue;
        const hh = Math.round(v(0.32) * Math.pow(1 - d * d, 1.2) * (0.55 + 0.45 * (nz.n2(x * 0.3, z * 0.3) * 0.5 + 0.5)));
        for (let y = fy; y < fy + hh; y++) if (!m.has(x, y, z)) m.set(x, y, z, mulRGB(woodCol(x * 31 + z * 7 + (y >> 1)), 0.9 + hash3(x, y, z) * 0.15), NOCOL);
      }
    const nbm = 3 + rng.int(0, 3);
    for (let i = 0; i < nbm; i++) {
      const a = rng.range(0, Math.PI * 2);
      const A: V3 = [h.x + Math.cos(a) * rr * rng.range(0, 0.6), fy + 1, h.z + Math.sin(a) * rr * rng.range(0, 0.6)];
      const a2 = a + rng.range(-0.8, 0.8);
      const B: V3 = [h.x + Math.cos(a2) * h.r * 1.05, y0 + H * rng.range(0.45, 0.75) * (0.6 + 0.4 * (1 - collapse)), h.z + Math.sin(a2) * h.r * 1.05];
      const wc = woodCol(hi * 17 + i);
      const thick = rng.chance(0.5) ? 1 : 0.6;
      seg(m, A, B, (t, x, y, z) => (Math.abs(nz.n3(x * 0.8, y * 0.8, z * 0.8)) < 0.08 ? mix(wc, ROT, 0.5) : t > 0.96 ? BLEACH : wc), thick, NOCOL);
    }
  });
  // loose planks thrown around outside
  for (let i = 0; i < 3 + rng.int(0, 4); i++) {
    const a = rng.range(0, Math.PI * 2);
    const px = cx + Math.cos(a) * (W / 2 + v(rng.range(0.3, 1.4))), pz = cz + Math.sin(a) * (D / 2 + v(rng.range(0.3, 1.4)));
    const pa = rng.range(0, Math.PI);
    const L = v(rng.range(0.8, 1.8));
    seg(m, [px - Math.cos(pa) * L / 2, y0, pz - Math.sin(pa) * L / 2], [px + Math.cos(pa) * L / 2, y0 + (rng.chance(0.3) ? 1 : 0), pz + Math.sin(pa) * L / 2], (t) => (t < 0.05 || t > 0.95 ? BLEACH : woodCol(i * 13)), 0.5, NOCOL);
  }

  // ---- 9. drifted sand: banked against the windward walls, a long lee tail, pooled inside
  const M = Math.min(22, Math.ceil(v(1.7)));
  const gx0 = b.minX - M, gz0 = b.minZ - M, GW = W + 2 * M, GD = D + 2 * M;
  const occ = new Uint8Array(GW * GD);
  const floorTop = new Int16Array(GW * GD).fill(-999);
  m.forEach((x, y, z, c, f) => {
    if (f & NOCOL) return;
    const i = x - gx0, j = z - gz0;
    if (i < 0 || j < 0 || i >= GW || j >= GD) return;
    const hm = (y - y0) * vs;
    if (hm < 1.3 && hm > 0.42) occ[i + j * GW] = 1;
    if (hm < 0.5) floorTop[i + j * GW] = Math.max(floorTop[i + j * GW], y + 1);
    void c;
  });
  const dist = new Float32Array(GW * GD).fill(1e9);
  const q: number[] = [];
  for (let k = 0; k < occ.length; k++) if (occ[k]) {
    dist[k] = 0;
    q.push(k);
  }
  for (let qi = 0; qi < q.length; qi++) {
    const k = q[qi];
    const i = k % GW, j = (k / GW) | 0;
    for (const [di, dj] of N4) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= GW || nj >= GD) continue;
      const nk = ni + nj * GW;
      if (dist[nk] <= dist[k] + 1) continue;
      dist[nk] = dist[k] + 1;
      if (dist[nk] < M) q.push(nk);
    }
  }
  // enclosed = walls on all four sides (row / column extents of the occupancy)
  const rowLo = new Int32Array(GD).fill(1e9), rowHi = new Int32Array(GD).fill(-1), colLo = new Int32Array(GW).fill(1e9), colHi = new Int32Array(GW).fill(-1);
  for (let j = 0; j < GD; j++)
    for (let i = 0; i < GW; i++)
      if (occ[i + j * GW]) {
        rowLo[j] = Math.min(rowLo[j], i);
        rowHi[j] = Math.max(rowHi[j], i);
        colLo[i] = Math.min(colLo[i], j);
        colHi[i] = Math.max(colHi[i], j);
      }
  const enclosed = (i: number, j: number) => i > rowLo[j] && i < rowHi[j] && j > colLo[i] && j < colHi[i];
  const sandH = v(o.sand ?? 0.55);
  for (let j = 0; j < GD; j++)
    for (let i = 0; i < GW; i++) {
      const k = i + j * GW;
      if (occ[k]) continue;
      const x = gx0 + i, z = gz0 + j;
      const rip = nz.n2(x * 0.22, z * 0.22);
      let h: number;
      if (enclosed(i, j)) {
        const ft = floorTop[k] > -999 ? floorTop[k] - y0 : 0;
        if (ft < 2 && dist[k] > v(0.9)) continue; // open yards: sand only banks against the walls
        const patch = nz.n2(x * 0.08 + 5, z * 0.08) + (ft < 2 ? 0.4 - dist[k] / v(0.9) * 0.4 : 0);
        h = patch > -0.1 ? ft + 1 + Math.round((patch + 0.1) * v(0.28)) : 0;
      } else {
        const d = dist[k];
        if (d > M) continue;
        const wind = x + 0.5 < cx ? 1 : 0.5;
        h = sandH * wind * Math.exp(-d / v(0.6));
        if (x + 0.5 > cx) h = Math.max(h, sandH * 0.4 * Math.exp(-d / v(1.25)) * Math.min(1, (x - cx) / (W * 0.3)));
        h = Math.round(h * (0.8 + 0.3 * rip) + rip * 1.2 * (d < M * 0.8 ? 1 : 0));
      }
      for (let y = y0; y < y0 + h; y++) {
        if (m.has(x, y, z)) continue;
        const topv = y === y0 + h - 1;
        m.set(x, y, z, topv ? (((x + z) & 3) === 0 && rip > 0 ? DS.ripple : DS.top) : y < y0 + h - 3 ? DS.low : DS.mid, NOCOL);
      }
    }
  return m;
}

// =============================================================================== ruin analysis
export interface RuinSpots {
  /** interior free floor cells: x, z (m from pivot), y (floor/sand top, m), walls = solid neighbours */
  interior: { x: number; z: number; y: number; walls: number }[];
  /** interior corners: web/egg anchors. rot faces into the room. top = lowest wall top (m) */
  corners: { x: number; z: number; y: number; rot: number; top: number }[];
}

/** find the interior floor, corners and wall tops of a (ruined) building model (metres from `pivot`, default bottom-centre) */
export function ruinSpots(m: VoxelModel, vs: number, pivot?: [number, number, number]): RuinSpots {
  const b = m.bounds();
  const cs = Math.max(2, Math.round(0.5 / vs));
  const px = pivot ? pivot[0] : (b.minX + b.maxX + 1) / 2, pz = pivot ? pivot[2] : (b.minZ + b.maxZ + 1) / 2;
  const GW = Math.ceil((b.maxX - b.minX + 1) / cs), GD = Math.ceil((b.maxZ - b.minZ + 1) / cs);
  const occ = new Uint8Array(GW * GD);
  const top = new Float32Array(GW * GD);
  const floor = new Float32Array(GW * GD);
  m.forEach((x, y, z, _c, f) => {
    const i = Math.floor((x - b.minX) / cs), j = Math.floor((z - b.minZ) / cs);
    const k = i + j * GW;
    const hm = (y - (pivot ? pivot[1] : b.minY)) * vs;
    if (!(f & NOCOL) && hm > 0.45 && hm < 2.2) occ[k] = 1;
    if (!(f & NOCOL)) top[k] = Math.max(top[k], hm + vs);
    if (hm < 0.75) floor[k] = Math.max(floor[k], hm + vs);
  });
  const ray = (i: number, j: number, di: number, dj: number) => {
    for (let s = 1; s < 40; s++) {
      const ni = i + di * s, nj = j + dj * s;
      if (ni < 0 || nj < 0 || ni >= GW || nj >= GD) return false;
      if (occ[ni + nj * GW]) return true;
    }
    return false;
  };
  const isOcc = (i: number, j: number) => i >= 0 && j >= 0 && i < GW && j < GD && occ[i + j * GW] === 1;
  const out: RuinSpots = { interior: [], corners: [] };
  for (let j = 1; j < GD - 1; j++)
    for (let i = 1; i < GW - 1; i++) {
      const k = i + j * GW;
      if (occ[k]) continue;
      let hits = 0;
      for (const [di, dj] of N4) if (ray(i, j, di, dj)) hits++;
      if (hits < 3) continue;
      // keep clear of the walls themselves (one free ring around the spot)
      let walls = 0;
      for (const [di, dj] of N4) if (isOcc(i + di, j + dj)) walls++;
      const x = (b.minX + (i + 0.5) * cs - px) * vs, z = (b.minZ + (j + 0.5) * cs - pz) * vs;
      out.interior.push({ x, z, y: floor[k], walls });
      for (const [di, dj] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as [number, number][]) {
        if (!isOcc(i + di, j) || !isOcc(i, j + dj)) continue;
        const t = Math.min(top[i + di + j * GW], top[i + (j + dj) * GW]);
        if (t < 1.6) continue;
        out.corners.push({ x: x + di * cs * vs * 0.25, z: z + dj * cs * vs * 0.25, y: floor[k], rot: Math.atan2(-di, -dj), top: t });
      }
    }
  return out;
}

// =============================================================================== cobwebs (1/40)
/**
 * A dusty orb web strung across a corner or a doorway: radial threads from an
 * off-centre hub to the frame (top line, two side anchors, sagging bottom
 * line), sagging capture spirals, torn gaps with dangling strands, a dense
 * tangle in the upper corners, dust caught in the silk and a silk-wrapped husk.
 * Vertical plane (X wide, Y tall), z = 0. variant: 0-2 corners, 3-4 doorways (tattered).
 */
export function cobweb(variant = 0): RuinModel {
  const vs = 1 / 40;
  const rng = new RNG(4401 + variant * 97);
  const nz = new Noise(77 + variant);
  const door = variant >= 3;
  const W = (door ? rng.range(2.1, 2.6) : rng.range(1.2, 1.8)) / vs;
  const H = (door ? rng.range(1.5, 1.9) : rng.range(0.9, 1.3)) / vs;
  const m = new VoxelModel('cobweb' + variant);
  const silk = (x: number, y: number, z: number) => {
    const h = hash3(x, y, z);
    return h < 0.12 ? SILK[3] : h < 0.3 ? SILK[1] : h > 0.93 ? SILK[2] : SILK[0];
  };
  const line = (a: V3, b: V3, sag = 0, torn = 0) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(2, Math.ceil(L * 1.6));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      if (torn > 0 && nz.n2((a[0] + (b[0] - a[0]) * t) * 0.05, (a[1] + (b[1] - a[1]) * t) * 0.05) > 1 - torn) continue;
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), z = a[2] + (b[2] - a[2]) * t + Math.sin(t * Math.PI) * sag * 0.15;
      m.set(Math.round(x), Math.round(y), Math.round(z), silk(Math.round(x), Math.round(y), Math.round(z)), VF.SOFTAO | NOCOL);
    }
  };
  // frame: top line, two sides, sagging bottom
  const tl: V3 = [-W / 2, H, 0], tr: V3 = [W / 2, H, 0];
  const bl: V3 = [-W / 2 + rng.range(0, 6), H * 0.22, 1], br: V3 = [W / 2 - rng.range(0, 6), H * 0.3, -1];
  line(tl, tr, 2);
  line(tl, bl, 1);
  line(tr, br, 1);
  line(bl, br, H * 0.12);
  const hub: V3 = [rng.range(-0.12, 0.12) * W, H * rng.range(0.56, 0.68), 0];
  const frame = (t: number): V3 => {
    // walk the frame perimeter (0..1)
    const segs: [V3, V3, number][] = [[tl, tr, 2], [tr, br, 1], [br, bl, H * 0.12], [bl, tl, 1]];
    const s = Math.min(3.999, (((t % 1) + 1) % 1) * 4);
    const [a, b2, sag] = segs[Math.floor(s)];
    const u = s - Math.floor(s);
    return [a[0] + (b2[0] - a[0]) * u, a[1] + (b2[1] - a[1]) * u - sag * 4 * u * (1 - u), 0];
  };
  const nR = door ? 16 : 13;
  const radials: V3[] = [];
  for (let r = 0; r < nR; r++) radials.push(frame((r + rng.range(-0.2, 0.2)) / nR));
  const torn = door ? 0.55 : 0.25;
  for (const p of radials) line(hub, p, 0.6, torn * 0.6);
  // capture spiral: rings at growing fractions between neighbouring radials, drooping
  for (let ring = 1; ring <= 10; ring++) {
    const f = ring / 10.5;
    for (let r = 0; r < nR; r++) {
      const a = radials[r], c = radials[(r + 1) % nR];
      const pa: V3 = [hub[0] + (a[0] - hub[0]) * f, hub[1] + (a[1] - hub[1]) * f, 0];
      const pc: V3 = [hub[0] + (c[0] - hub[0]) * (f + 0.03), hub[1] + (c[1] - hub[1]) * (f + 0.03), 0];
      line(pa, pc, 0.8 + f * 1.4, torn);
    }
  }
  // dense tangled sheet in the top corners (old silk, dust)
  for (const sx of [-1, 1]) {
    for (let i = 0; i < (door ? 90 : 60); i++) {
      const u = rng.next() * W * 0.22, w = rng.next() * H * 0.25;
      if (u + w > W * 0.24) continue;
      const x = Math.round(sx * (W / 2 - u)), y = Math.round(H - w);
      m.set(x, y, Math.round(rng.range(-1, 1)), rng.chance(0.3) ? 0xd6c8a8 : SILK[1], VF.SOFTAO | NOCOL);
    }
  }
  // dangling broken strands
  for (let i = 0; i < (door ? 7 : 3); i++) {
    const x = rng.range(-W * 0.4, W * 0.4), y = rng.range(H * 0.3, H * 0.8);
    line([x, y, 0], [x + rng.range(-3, 3), y - rng.range(6, 18), rng.range(-2, 2)], 0, 0);
  }
  // a silk-wrapped husk hanging in it (and a dried leaf on door webs)
  const wx = Math.round(hub[0] + rng.range(-0.25, 0.25) * W), wy = Math.round(hub[1] - rng.range(0.1, 0.25) * H);
  blobV(m, [wx, wy, 0], [1.6, 3.2, 1.6], (x, y, z) => (((y + x) & 1) ? SILK[1] : 0xc8bca4), { fl: VF.SOFTAO | NOCOL });
  if (door) blobV(m, [wx + 9, wy + 6, 0], [2.2, 1.4, 0.6], () => 0x8a6a3a, { fl: NOCOL });
  return { model: m, voxelSize: vs };
}

// =============================================================================== funnel-web nest (1/36)
/**
 * A ground nest: a low sand mound with a silk funnel spiralling down into a dark
 * burrow, a silk sheet spread around the mouth, trip lines radiating out, and
 * the remains of meals: a silk-wrapped bundle, small bones and a skull.
 */
export function spiderNest(seed = 0): RuinModel {
  const vs = 1 / 36;
  const rng = new RNG(8803 + seed * 61);
  const nz = new Noise(19 + seed);
  const m = new VoxelModel('spider_nest' + seed);
  const R = 1.1 / vs;
  // mound
  for (let x = -R - 4; x <= R + 4; x++)
    for (let z = -R - 4; z <= R + 4; z++) {
      const d = Math.hypot(x, z) / R;
      if (d > 1.15) continue;
      const h = Math.round(Math.max(0, (1 - d * d)) * 6 + nz.n2(x * 0.15, z * 0.15) * 1.5);
      for (let y = 0; y < h; y++) m.set(x, y, z, y === h - 1 ? DS.top : DS.mid, NOCOL);
    }
  // burrow mouth (dark pit) + silk funnel collar rising and flaring
  const mx = Math.round(rng.range(-4, 4)), mz = Math.round(rng.range(-4, 4));
  for (let y = 0; y < 14; y++) {
    const rr = 3.2 + Math.pow(y / 13, 1.6) * 6.5;
    for (let a = 0; a < Math.PI * 2; a += 0.12) {
      const wob = nz.n2(a * 2, y * 0.3) * 1.1;
      const x = Math.round(mx + Math.cos(a) * (rr + wob)), z = Math.round(mz + Math.sin(a) * (rr + wob));
      if (y > 9 && nz.n2(a * 3 + 5, y) > 0.25) continue; // torn rim
      m.set(x, y - 3, z, hash3(x, y, z) < 0.25 ? SILK[1] : SILK[0], VF.SOFTAO | NOCOL);
    }
  }
  for (let x = mx - 4; x <= mx + 4; x++) for (let z = mz - 4; z <= mz + 4; z++) if (Math.hypot(x - mx, z - mz) < 3.4) for (let y = -4; y <= 7; y++) m.del(x, y, z);
  for (let x = mx - 3; x <= mx + 3; x++) for (let z = mz - 3; z <= mz + 3; z++) if (Math.hypot(x - mx, z - mz) < 3) m.set(x, -4, z, 0x140c08, NOCOL);
  // silk sheet over the mound + radiating trip lines
  const sheet: V3[] = [];
  m.forEach((x, y, z) => {
    if (m.has(x, y + 1, z)) return;
    const d = Math.hypot(x - mx, z - mz);
    if (d < 12 + nz.n2(x * 0.1, z * 0.1) * 4 && hash3(x, y, z) < 0.7) sheet.push([x, y + 1, z]);
  });
  for (const [x, y, z] of sheet) m.set(x, y, z, hash3(x, 2, z) < 0.3 ? SILK[3] : SILK[0], VF.SOFTAO | NOCOL);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const L = R * rng.range(0.9, 1.4);
    for (let s = 6; s < L; s += 0.7) {
      const x = Math.round(mx + Math.cos(a) * s), z = Math.round(mz + Math.sin(a) * s);
      let y = 0;
      while (m.has(x, y, z) && y < 12) y++;
      m.set(x, y + (s > L * 0.8 ? 0 : 1), z, SILK[1], VF.SOFTAO | NOCOL);
    }
  }
  // a silk-wrapped meal
  const wa = rng.range(0, Math.PI * 2);
  const wx = mx + Math.cos(wa) * 14, wz = mz + Math.sin(wa) * 14;
  for (let s = -7; s <= 7; s++) {
    const r = 2.6 * Math.sqrt(1 - (s / 8) ** 2) + 0.4;
    blobV(m, [wx + Math.cos(wa + 1.6) * s, 6 + Math.abs(s) * -0.2, wz + Math.sin(wa + 1.6) * s], [r, r, r], (x, y, z) => ((x + y * 2 + z) % 3 === 0 ? 0xcfc4ac : SILK[0]), { fl: VF.SOFTAO | NOCOL });
  }
  // bones: a small skull, ribs and long bones
  const bone = 0xe8dcc0, boneD = 0xc8b898;
  const sa = wa + Math.PI * rng.range(0.6, 1.2);
  const sx = mx + Math.cos(sa) * 17, sz = mz + Math.sin(sa) * 17;
  blobV(m, [sx, 6, sz], [3.2, 2.6, 3.8], (x, y, z) => (hash3(x, y, z) < 0.2 ? boneD : bone), { fl: NOCOL });
  for (const e of [-1, 1]) blobV(m, [sx + e * 1.4, 6.4, sz + 2.6], [0.9, 0.9, 0.9], () => 0x2a1a10, { carve: false, fl: NOCOL });
  for (let r = 0; r < 4; r++) {
    const ra = sa + 0.9 + r * 0.3;
    seg(m, [mx + Math.cos(ra) * 20, 5, mz + Math.sin(ra) * 20], [mx + Math.cos(ra) * 24, 4 + r % 2, mz + Math.sin(ra) * 24 + 3], bone, 0.5, NOCOL);
  }
  seg(m, [sx + 6, 5, sz - 5], [sx + 14, 5, sz - 2], (t) => (t < 0.08 || t > 0.92 ? boneD : bone), 0.8, NOCOL);
  return { model: m, voxelSize: vs };
}

// =============================================================================== egg sacs (1/40)
/**
 * A clutch of papery silk egg sacs on a silk mat, strung to the wall/floor with
 * guy threads. burst = torn open from inside, ragged rims, wet goo and empty shells.
 */
export function eggSacs(seed = 0, burst = false): RuinModel {
  const vs = 1 / 40;
  const rng = new RNG(3301 + seed * 13);
  const nz = new Noise(5 + seed);
  const m = new VoxelModel('egg_sacs' + seed + (burst ? 'b' : ''));
  const n = 3 + (seed % 2);
  const sacs: { c: V3; r: V3 }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const d = i === 0 ? 0 : rng.range(5, 9);
    const r: V3 = [rng.range(4.5, 6.5), rng.range(5.5, 8), rng.range(4.5, 6.5)];
    sacs.push({ c: [Math.cos(a) * d, r[1] * 0.85, Math.sin(a) * d], r });
  }
  // silk mat
  for (let x = -16; x <= 16; x++)
    for (let z = -16; z <= 16; z++) {
      const d = Math.hypot(x, z) / 15;
      if (d > 1 || hash3(x, 1, z) > 0.75 - d * 0.4) continue;
      m.set(x, 0, z, hash3(x, 2, z) < 0.3 ? SILK[3] : SILK[0], VF.SOFTAO | NOCOL);
    }
  const sacCol = (x: number, y: number, z: number) => {
    const w = nz.n3(x * 0.35, y * 0.35, z * 0.35);
    const vein = Math.abs(nz.n3(x * 0.2 + 9, y * 0.5, z * 0.2)) < 0.05;
    return vein ? 0xc8b488 : w > 0.3 ? 0xf6f0de : w < -0.3 ? 0xe0d4b6 : 0xece4cc;
  };
  for (const s of sacs) {
    blobV(m, s.c, s.r, sacCol, { noise: nz, amp: 0.18, freq: 0.3, fl: VF.SOFTAO | NOCOL });
    // the eggs visible as faint bumps through the paper
    for (let e = 0; e < 7; e++) {
      const a = rng.range(0, Math.PI * 2), b = rng.range(-0.6, 0.8);
      const p: V3 = [s.c[0] + Math.cos(a) * s.r[0] * Math.cos(b), s.c[1] + s.r[1] * Math.sin(b), s.c[2] + Math.sin(a) * s.r[2] * Math.cos(b)];
      blobV(m, p, [1.2, 1.2, 1.2], () => 0xfaf2da, { fl: VF.SOFTAO | NOCOL });
    }
    if (burst) {
      // torn open from the top: ragged rim, wet goo, empty shells inside
      const top = s.c[1] + s.r[1] * rng.range(-0.1, 0.25);
      blobV(m, s.c, [s.r[0] - 1.2, s.r[1] - 1.2, s.r[2] - 1.2], () => null, { carve: true });
      const del: V3[] = [];
      m.forEach((x, y, z) => {
        const lx = (x + 0.5 - s.c[0]) / s.r[0], lz = (z + 0.5 - s.c[2]) / s.r[2];
        if (lx * lx + lz * lz < 1.3 && y > top + nz.n2(x * 0.6, z * 0.6) * 2.5 && y < s.c[1] + s.r[1] + 3) del.push([x, y, z]);
      });
      for (const [x, y, z] of del) m.del(x, y, z);
      blobV(m, [s.c[0], s.c[1] - s.r[1] * 0.55, s.c[2]], [s.r[0] - 1.5, 1.6, s.r[2] - 1.5], (x, y, z) => (hash3(x, y, z) < 0.3 ? 0xd8e070 : 0xa8b848), { fl: VF.EMISSIVE | NOCOL });
      for (let e = 0; e < 4; e++) m.set(Math.round(s.c[0] + rng.range(-2, 2)), Math.round(s.c[1] - s.r[1] * 0.35), Math.round(s.c[2] + rng.range(-2, 2)), 0xf4ead0, NOCOL);
      // goo dribbling down the outside
      for (let d = 0; d < 3; d++) {
        const a = rng.range(0, Math.PI * 2);
        const x = Math.round(s.c[0] + Math.cos(a) * s.r[0]), z = Math.round(s.c[2] + Math.sin(a) * s.r[2]);
        for (let y = Math.round(top); y > top - rng.range(3, 8); y--) m.set(x, y, z, 0xb8c850, VF.EMISSIVE | NOCOL);
      }
    }
    // guy threads up to the wall and out to the floor
    for (let g = 0; g < 5; g++) {
      const a = rng.range(0, Math.PI * 2);
      const from: V3 = [s.c[0] + Math.cos(a) * s.r[0] * 0.8, s.c[1] + s.r[1] * rng.range(-0.2, 0.7), s.c[2] + Math.sin(a) * s.r[2] * 0.8];
      const to: V3 = g < 2 ? [from[0] + Math.cos(a) * 6, from[1] + rng.range(8, 16), from[2] + Math.sin(a) * 6] : [from[0] + Math.cos(a) * rng.range(6, 12), 0, from[2] + Math.sin(a) * rng.range(6, 12)];
      seg(m, from, to, (_t, x, y, z) => SILK[hash3(x, y, z) < 0.3 ? 1 : 0], 0, VF.SOFTAO | NOCOL);
    }
  }
  return { model: m, voxelSize: vs };
}

// =============================================================================== broken plank debris (1/16)
export function plankDebris(seed = 0): RuinModel {
  const vs = 1 / 16;
  const rng = new RNG(5501 + seed * 7);
  const m = new VoxelModel('plank_debris' + seed);
  // low sand bank they lie in
  for (let x = -14; x <= 14; x++) for (let z = -12; z <= 12; z++) {
    const d = Math.hypot(x / 14, z / 12);
    if (d > 1) continue;
    const h = Math.round((1 - d) * 2.5);
    for (let y = 0; y < h; y++) m.set(x, y, z, y === h - 1 ? DS.top : DS.mid, NOCOL);
  }
  const n = 3 + rng.int(0, 3);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI);
    const L = rng.range(12, 26), w = rng.chance(0.5) ? 2 : 3;
    const ox = rng.range(-6, 6), oz = rng.range(-5, 5), y = 1 + (i % 3);
    const base = mix(rng.pick([PR.wood.base, PR.woodGrey.base, PR.woodLight.base, PR.barnRed.base]), BLEACH, 0.55);
    for (let s = -L / 2; s <= L / 2; s += 0.6) {
      for (let q = 0; q < w; q++) {
        const x = Math.round(ox + Math.cos(a) * s - Math.sin(a) * q), z = Math.round(oz + Math.sin(a) * s + Math.cos(a) * q);
        const end = Math.abs(s) > L / 2 - 2 && hash3(x, q, z) < 0.5;
        if (end && q === w - 1) continue; // splintered, jagged ends
        m.set(x, y + (Math.abs(s) > L * 0.35 && i % 2 ? 1 : 0), z, end ? BLEACH : Math.abs(s % 8) < 0.6 ? 0x3a3434 : hash3(x, y, z) < 0.1 ? ROT : base, NOCOL);
      }
    }
  }
  return { model: m, voxelSize: vs };
}

// =============================================================================== outposts (1/10)
/**
 * Tall ruined lookout towers, landmarks seen from across the zone.
 *  variant 0: timber signal outpost (~18 m): four splayed log legs, X-bracing
 *    (one brace snapped and hanging), a ladder with missing rungs, a holed plank
 *    deck at ~14 m with a broken rail, a half-collapsed lookout hut, a heliograph
 *    mirror on a tripod, a crane arm with a dangling rope, a tattered banner.
 *  variant 1: stone lookout (~15 m): a tapering round tower of sandstone blocks,
 *    crumbled away on one side down to its floor joists, arrow slits, an arched
 *    door, a timber crow's nest with a signal brazier, a skirt of fallen blocks.
 * meta.top: the lookout floor (m from the pivot), meta.anchor: grapple point.
 */
export function outpostTower(variant = 0): RuinModel {
  return variant % 2 === 0 ? timberOutpost(variant) : stoneOutpost(variant);
}

const LOG = { base: 0x9a8268, shade: 0x7a654e, hi: 0xc2ad90, dark: 0x4e4032 };
function logCol(x: number, y: number, z: number, nz: Noise) {
  const n = nz.n3(x * 0.4, y * 0.05, z * 0.4);
  if (Math.abs(n) < 0.06) return LOG.dark;
  return n > 0.35 ? LOG.hi : n < -0.4 ? LOG.shade : LOG.base;
}

function timberOutpost(variant: number): RuinModel {
  const vs = 1 / 10;
  const rng = new RNG(9101 + variant * 31);
  const nz = new Noise(41 + variant);
  const m = new VoxelModel('outpost_timber' + variant);
  const PH = 140; // deck height (voxels) = 14 m
  const base = 24, topW = 13;
  const legAt = (y: number) => base - (base - topW) * (y / PH);
  const lean = rng.range(-0.025, 0.025);
  const L = (x: number, y: number) => x + Math.round(lean * y);
  // legs
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      for (let y = 0; y <= PH + 11; y++) {
        const o = legAt(Math.min(y, PH));
        const r = y < PH ? 2.1 - (y / PH) * 0.5 : 1.4;
        for (let a = -3; a <= 3; a++)
          for (let b = -3; b <= 3; b++) {
            if (a * a + b * b > r * r + 0.3) continue;
            const x = L(Math.round(sx * o) + a, y), z = Math.round(sz * o) + b;
            m.set(x, y, z, logCol(x, y, z, nz));
          }
      }
    }
  // girts + X braces per bay; one brace snapped and hanging
  const bays = [8, 52, 96];
  const snapped = rng.int(0, 5);
  let bi = 0;
  for (let i = 0; i < bays.length; i++) {
    const ya = bays[i], yb = i + 1 < bays.length ? bays[i + 1] : PH;
    const a = legAt(ya), bb = legAt(yb);
    for (const s of [-1, 1]) {
      // girts
      seg(m, [L(-Math.round(a), ya), ya, s * a], [L(Math.round(a), ya), ya, s * a], (_t, x, y, z) => logCol(x, y, z, nz), 1);
      seg(m, [L(s * Math.round(a), ya), ya, -a], [L(s * Math.round(a), ya), ya, a], (_t, x, y, z) => logCol(x, y, z, nz), 1);
      for (const face of [0, 1]) {
        for (const d of [-1, 1]) {
          bi++;
          const p0: V3 = face ? [L(-d * a, ya), ya, s * a] : [L(s * a, ya), ya, -d * a];
          let p1: V3 = face ? [L(d * bb, yb), yb, s * bb] : [L(s * bb, yb), yb, d * bb];
          if (bi === snapped + 1) p1 = [p0[0] + (p1[0] - p0[0]) * 0.45, ya - 22, p0[2] + (p1[2] - p0[2]) * 0.2]; // snapped, hanging down
          seg(m, p0, p1, (t, x, y, z) => (t > 0.97 ? BLEACH : (x + y + z) % 9 === 0 ? 0x3a3434 : mix(logCol(x, y, z, nz), BLEACH, 0.2)), 0.7);
        }
      }
    }
  }
  // ladder up the front face, rungs missing here and there
  for (let y = 0; y <= PH; y++) {
    const z = Math.round(legAt(y)) + 3;
    for (const x of [-4, 4]) m.set(L(x, y), y, z, mix(LOG.base, BLEACH, 0.3));
    if (y % 5 === 0 && hash3(y, 3, 1) > 0.18) for (let x = -3; x <= 3; x++) m.set(L(x, y), y, z, BLEACH);
  }
  // deck with holes, a broken rail
  const P = topW + 6;
  for (let x = -P; x <= P; x++)
    for (let z = -P; z <= P; z++) {
      if (nz.n2(x * 0.12, z * 0.12) > 0.42 && Math.abs(x) < P - 3) continue; // rotten holes
      if (Math.abs(x) % 4 === 0 && hash3(x, 1, z) < 0.1) continue;
      m.set(L(x, PH), PH, z, (x & 3) === 0 ? 0x5a4a3a : mix(LOG.base, BLEACH, 0.35 + hash3(x, 9, z) * 0.2));
      if (Math.abs(x) === P || Math.abs(z) === P) m.set(L(x, PH), PH - 1, z, LOG.shade);
    }
  for (let s = -P; s <= P; s++)
    for (const e of [-P, P]) {
      for (const [x, z] of [[s, e], [e, s]] as [number, number][]) {
        const broken = nz.n2(x * 0.15 + 3, z * 0.15) > 0.3;
        if ((Math.abs(s) % 6 === 0 || Math.abs(s) === P) && !broken) for (let y = PH + 1; y <= PH + 10; y++) m.set(L(x, y), y, z, LOG.shade);
        if (!broken) m.set(L(x, PH + 10), PH + 10, z, mix(LOG.hi, BLEACH, 0.3));
        if (!broken && hash3(x, 5, z) < 0.8) m.set(L(x, PH + 5), PH + 5, z, LOG.base);
      }
    }
  // half-collapsed lookout hut on the back half of the deck
  const hx0 = -11, hx1 = 11, hz0 = -P + 2, hz1 = 4, HH = 26;
  for (let x = hx0; x <= hx1; x++)
    for (let z = hz0; z <= hz1; z++) {
      const wall = x === hx0 || x === hx1 || z === hz0 || z === hz1;
      if (!wall) continue;
      for (let y = PH + 1; y <= PH + HH; y++) {
        const gone = (z === hz1 && x > -3 && x < 4 && y < PH + 22) || (x === hx1 && y > PH + 8 + nz.n2(z * 0.3, 1) * 8) || nz.n3(x * 0.2, y * 0.2, z * 0.2) > 0.5;
        if (gone) continue;
        m.set(L(x, y), y, z, (z === hz0 || z === hz1 ? x : z) % 3 === 0 ? 0x6a5a48 : mix(0xa08a6c, BLEACH, 0.3 + hash3(x, y, z) * 0.2));
      }
    }
  // roof: rafters exposed, half the boards gone, one end slumped
  for (let x = hx0 - 2; x <= hx1 + 2; x++) {
    const slump = x > 4 ? Math.round((x - 4) * 0.6) : 0;
    for (let z = hz0 - 2; z <= hz1 + 2; z++) {
      const y = PH + HH + 1 + Math.round(((z - hz0) / (hz1 - hz0)) * -4) - slump;
      const rafter = x % 5 === 0;
      if (!rafter && (nz.n2(x * 0.18 + 9, z * 0.18) > -0.05 || x > 6)) continue;
      m.set(L(x, y), y, z, rafter ? 0x5a4a3a : mix(0x8a7458, BLEACH, 0.3));
    }
  }
  // heliograph: tripod + round mirror (glinting)
  const hp: V3 = [P - 4, PH, P - 4];
  for (const [dx, dz] of [[-3, -3], [3, -2], [0, 3]]) seg(m, [L(hp[0] + dx, PH), PH + 1, hp[2] + dz], [L(hp[0], PH + 12), PH + 12, hp[2]], 0x4a4038, 0);
  for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) if (a * a + b * b <= 10) m.set(L(hp[0] + a, PH + 15), PH + 15 + b, hp[2] - 1, a * a + b * b <= 5 ? 0xdde8ee : 0x8a6a3a, VF.METAL);
  // crane arm with a pulley and a dangling frayed rope (+ an old bucket)
  seg(m, [L(-P, PH + 18), PH + 18, -2], [L(-P - 14, PH + 21), PH + 21, -2], (_t, x, y, z) => logCol(x, y, z, nz), 1);
  seg(m, [L(-P + 2, PH + 2), PH + 2, -2], [L(-P - 8, PH + 19), PH + 19, -2], LOG.shade, 0.6);
  for (let y = PH + 20; y > 46; y--) m.set(L(-P - 13 + Math.round(Math.sin(y * 0.05) * 0.6), y), y, -2, (y & 3) ? 0xb89a6a : 0x8a7048);
  blobV(m, [L(-P - 13, 44), 42, -2], [3, 3.5, 3], (x, y) => (y % 3 === 0 ? 0x5a5a5e : 0x8a6a48), { keep: (_lx, ly) => ly < 0.75 });
  // flag pole + tattered banner
  const fx = L(-8, PH + HH), fz = -6;
  for (let y = PH + HH - 4; y <= PH + HH + 42; y++) m.set(fx, y, fz, 0x4a3a2c);
  for (let u = 1; u <= 22; u++)
    for (let w = 0; w < 12 - Math.floor(u / 3); w++) {
      const y = PH + HH + 40 - w - Math.round(u * 0.25) + Math.round(Math.sin(u * 0.5) * 1.2);
      if (nz.n2(u * 0.3, w * 0.3) > 0.35 || (u > 14 && hash3(u, w, 2) < 0.4)) continue;
      m.set(fx + u, y, fz + Math.round(Math.sin(u * 0.4)), w < 2 ? 0x6a1a14 : 0x9a2e22);
    }
  // signal bell under the roof
  blobV(m, [L(0, PH + HH - 4), PH + HH - 4, 0], [2.5, 3, 2.5], (x, y) => (y % 4 === 0 ? 0x8a6a2a : 0xb8862e), { fl: VF.METAL, keep: (_lx, ly) => ly < 0.8 });
  // rubble + drift at the feet
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(18, 34);
    const pa = rng.range(0, Math.PI);
    const Ln = rng.range(10, 22);
    const px = Math.cos(a) * r, pz = Math.sin(a) * r;
    seg(m, [px - Math.cos(pa) * Ln / 2, 1, pz - Math.sin(pa) * Ln / 2], [px + Math.cos(pa) * Ln / 2, 1 + (i % 2), pz + Math.sin(pa) * Ln / 2], (t) => (t > 0.94 ? BLEACH : mix(LOG.base, BLEACH, 0.4)), 0.6, NOCOL);
  }
  driftRing(m, nz, 32, 7);
  clipBelow(m, 0);
  return { model: m, voxelSize: vs, meta: { top: rel(m, vs, [L(0, PH) + 0.5, PH + 1, 6.5]), anchor: rel(m, vs, [L(0, PH + HH) + 0.5, PH + HH + 6, 0.5]), height: (PH + HH + 44) * vs } };
}

const STONE = { a: 0xd2aa78, b: 0xbf9566, c: 0xe2c08e, mortar: 0x8e7656, dark: 0x6e5840 };
function stoneOutpost(variant: number): RuinModel {
  const vs = 1 / 10;
  const rng = new RNG(9203 + variant * 17);
  const nz = new Noise(53 + variant);
  const m = new VoxelModel('outpost_stone' + variant);
  const HT = 128; // full wall height
  const R0 = 23, R1 = 18, T = 4;
  const breakA = rng.range(0, Math.PI * 2); // the side that fell
  const angOff = (a: number, b: number) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const block = (y: number, a: number, r: number) => {
    const course = Math.floor(y / 4);
    const along = a * r + (course % 2) * 3.5;
    const bw = 7 + Math.floor(hash3(course, 1, 5) * 3);
    const bi = Math.floor(along / bw);
    const ph = ((along % bw) + bw) % bw;
    return { course, bi, joint: y % 4 === 0 || ph < 0.8, along };
  };
  const brick = (x: number, y: number, z: number, a: number, r: number) => {
    const bk = block(y, a, r);
    if (bk.joint) return STONE.mortar;
    const n = nz.n3(x * 0.25, y * 0.25, z * 0.25);
    const blockTint = hash3(bk.course, bk.bi, 3);
    let c = blockTint < 0.33 ? STONE.a : blockTint < 0.66 ? STONE.b : STONE.c;
    if (n > 0.45) c = mix(c, STONE.dark, 0.25);
    if (y < 12) c = mix(c, 0xc9a06a, 0.3 * (1 - y / 12)); // sand-scoured foot
    return c;
  };
  const radiusAt = (y: number) => (y < 16 ? R0 + 4 * Math.pow(1 - y / 16, 1.5) : R0 + (R1 - R0) * ((y - 16) / (HT - 16)));
  const topAt = (a: number) => {
    const off = angOff(a, breakA);
    if (off >= 1.5) return HT + 8;
    return 40 + Math.pow(off / 1.5, 1.6) * (HT - 40) + Math.floor(hash3(Math.floor(a * 12), 2, 3) * 3) * 4 + nz.n2(a * 5, 1) * 6;
  };
  const winA = breakA + Math.PI;
  for (let y = 0; y <= HT + 8; y++) {
    const R = radiusAt(Math.min(y, HT));
    for (let x = -R0 - 6; x <= R0 + 6; x++)
      for (let z = -R0 - 6; z <= R0 + 6; z++) {
        const d = Math.hypot(x, z);
        if (d > R0 + 6 || d < R1 - T - 2) continue;
        const a = Math.atan2(z, x);
        const bk = block(y, a, R);
        // rough masonry: whole blocks stand proud or sit back a little
        const hb = hash3(bk.course, bk.bi, 9);
        const relief = bk.joint ? -0.4 : hb < 0.22 ? 0.8 : hb > 0.88 ? -0.7 : 0;
        let Ro = R + relief + nz.n3(x * 0.3, y * 0.3, z * 0.3) * 0.45;
        // corbelled parapet: a stepped ring of corbels, crenellated merlons above the wall top
        if (y > HT - 7 && y <= HT) Ro += y > HT - 4 ? 2 : (bk.bi & 1 ? 1.6 : 0);
        if (y > HT && (Math.floor((a * R) / 8) & 1)) continue;
        if (d > Ro || d < R - T) continue;
        if (y > topAt(a)) continue;
        // arched door (+z) and arrow slits; an arched lookout window high on the intact side
        if (Math.abs(a - Math.PI / 2) < 0.2 && y < 18 + Math.round(Math.cos((a - Math.PI / 2) * 7.8) * 4)) continue;
        if ([44, 84].some((sy) => y > sy && y < sy + 10) && [0.4, 2.3, 4.2].some((sa) => Math.abs(((a + Math.PI * 2) % (Math.PI * 2)) - sa) < 0.045)) continue;
        const wo = angOff(a, winA);
        if (wo < 0.17 && y > 98 && y < 108 + Math.round(Math.cos(wo * 9) * 3)) continue;
        let c = brick(x, y, z, a, R);
        // putlog holes and a long crack running down from the break
        if (y % 24 === 12 && ((bk.along % 13) + 13) % 13 < 1 && d > R - 1) c = 0x3a2a1c;
        const off = angOff(a, breakA);
        if (Math.abs(off - 1.62 - Math.sin(y * 0.31) * 0.035) < 0.018 && y > 20 && d > R - 1.5) c = 0x4a3826;
        m.set(x, y, z, c);
      }
  }
  // fallen merlons / blocks perched on the broken rim
  for (let i = 0; i < 6; i++) {
    const a = breakA + rng.range(-1.3, 1.3);
    const r = R1 - 1;
    const y = Math.round(topAt(a)) + 1;
    if (y > HT) continue;
    blobV(m, [Math.cos(a) * r, y + 1, Math.sin(a) * r], [2.5, 1.8, 2.2], (xx, yy, zz) => brick(xx, yy, zz, a, r), { noise: nz, amp: 0.3, freq: 0.5 });
  }
  // floor joists at two levels: broken off and sticking out over the collapse
  for (const fy of [56, 100]) {
    const ux = Math.cos(breakA), uz = Math.sin(breakA);
    for (let j = -3; j <= 3; j++) {
      const ext = Math.abs(j) < 2 ? rng.range(4, 12) : 0;
      const A: V3 = [-ux * (R1 - 1) - uz * j * 5, fy, -uz * (R1 - 1) + ux * j * 5];
      const B: V3 = [ux * (R1 - 1 + ext) - uz * j * 5, fy - (ext ? 2 : 0), uz * (R1 - 1 + ext) + ux * j * 5];
      seg(m, A, B, (t, x, y, z) => (t > 0.95 ? BLEACH : mix(0x8a7056, BLEACH, 0.25 + hash3(x, y, z) * 0.2)), 0.8);
    }
    for (let x = -R1 + 1; x < R1 - 1; x++) for (let z = -R1 + 1; z < R1 - 1; z++) if (Math.hypot(x, z) < R1 - 2 && nz.n2(x * 0.15, z * 0.15 + fy) > 0.1) m.set(x, fy + 1, z, mix(0xa08a6c, BLEACH, 0.35));
  }
  // crow's nest: timber platform on top of the intact side + a signal brazier
  const nyY = HT + 1;
  const ax = -Math.cos(breakA) * 8, az = -Math.sin(breakA) * 8;
  for (let x = -14; x <= 14; x++)
    for (let z = -14; z <= 14; z++) {
      const px = Math.round(ax + x), pz = Math.round(az + z);
      if (Math.hypot(px, pz) > R1 + 3) continue;
      const toBreak = Math.cos(Math.atan2(pz, px) - breakA) * Math.hypot(px, pz);
      if (toBreak > 6 + nz.n2(x * 0.3, z * 0.3) * 4) continue;
      m.set(px, nyY, pz, (x & 3) === 0 ? 0x5a4a3a : mix(0x9a8468, BLEACH, 0.35));
      if (Math.hypot(px, pz) > R1 + 1.5 && hash3(px, 1, pz) < 0.7) for (let y = nyY + 1; y < nyY + 9; y++) if (y === nyY + 8 || (px + pz) % 4 === 0) m.set(px, y, pz, LOG.shade);
    }
  const bz: V3 = [Math.round(ax), nyY + 1, Math.round(az)];
  for (const [dx, dz] of [[-3, -3], [3, -3], [0, 3]]) seg(m, [bz[0] + dx, nyY + 1, bz[2] + dz], [bz[0], nyY + 8, bz[2]], 0x3a3434, 0.4);
  blobV(m, [bz[0], nyY + 9, bz[2]], [4.5, 2.5, 4.5], (x, y) => (y > nyY + 9 ? 0x2a2624 : 0x4a4442), { fl: VF.METAL, keep: (_lx, ly) => ly < 0.4 });
  blobV(m, [bz[0], nyY + 10, bz[2]], [3, 1, 3], (x, y, z) => (hash3(x, y, z) < 0.3 ? 0x8a8478 : 0x3a3430));
  // fallen blocks + drift on the broken side
  for (let i = 0; i < 40; i++) {
    const a = breakA + rng.range(-0.9, 0.9), r = rng.range(R0 + 2, R0 + 30);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const sz: V3 = [rng.range(2, 4.5), rng.range(1.5, 3), rng.range(2, 4)];
    blobV(m, [x, sz[1] * 0.6, z], sz, (xx, yy, zz) => brick(xx, yy + 1, zz, a, r), { noise: nz, amp: 0.25, freq: 0.4, fl: NOCOL });
  }
  driftRing(m, nz, 34, 8);
  clipBelow(m, 0);
  return { model: m, voxelSize: vs, meta: { top: rel(m, vs, [ax + 0.5, nyY + 1, az + 0.5]), anchor: rel(m, vs, [ax + 0.5, nyY + 6, az + 0.5]), height: (HT + 12) * vs } };
}

/** voxel point -> metres relative to the model's bottom-centre pivot */
function rel(m: VoxelModel, vs: number, p: V3): V3 {
  const b = m.bounds();
  return [(p[0] - (b.minX + b.maxX + 1) / 2) * vs, (p[1] - b.minY) * vs, (p[2] - (b.minZ + b.maxZ + 1) / 2) * vs];
}
function clipBelow(m: VoxelModel, y0: number) {
  const del: V3[] = [];
  m.forEach((x, y, z) => {
    if (y < y0) del.push([x, y, z]);
  });
  for (const [x, y, z] of del) m.del(x, y, z);
}

/** sand drift ring around a tower foot (NOCOL), deeper on the windward (-x) side */
function driftRing(m: VoxelModel, nz: Noise, R: number, H: number) {
  for (let x = -R - 10; x <= R + 10; x++)
    for (let z = -R - 10; z <= R + 10; z++) {
      const d = Math.hypot(x, z) / R;
      if (d > 1.3) continue;
      let h = H * Math.max(0, 1 - d) * (x < 0 ? 1 : 0.55) + nz.n2(x * 0.2, z * 0.2) * 1.5;
      h = Math.round(h);
      for (let y = 0; y < h; y++) if (!m.has(x, y, z)) m.set(x, y, z, y === h - 1 ? DS.top : DS.mid, NOCOL);
    }
}

// =============================================================================== oasis plants (1/30)
const GREENS = [0x4e7a32, 0x5f8a3a, 0x6e9a42, 0x86ae52, 0x3e6428];
/** lush reed clump: arching blades, cattails, papyrus umbels, on a wet mud base */
export function oasisReeds(seed = 0): RuinModel {
  const vs = 1 / 30;
  const rng = new RNG(6101 + seed * 11);
  const m = new VoxelModel('oasis_reeds' + seed);
  for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) if (Math.hypot(x, z) < 8.5 + hash3(x, 1, z) * 2) m.set(x, 0, z, hash3(x, 2, z) < 0.5 ? 0x4a3a2a : 0x5a4632);
  const blades = 34 + rng.int(0, 16);
  for (let i = 0; i < blades; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0, 7);
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const Ht = rng.range(26, 54);
    const out = rng.range(0.15, 0.5);
    const col = GREENS[rng.int(0, GREENS.length - 1)];
    const n = Math.ceil(Ht * 1.3);
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const droop = t > 0.6 ? (t - 0.6) ** 2 * Ht * 0.9 * out : 0;
      const x = bx + Math.cos(a) * (t * Ht * out * 0.5 + droop * 0.8), z = bz + Math.sin(a) * (t * Ht * out * 0.5 + droop * 0.8);
      const y = t * Ht - droop * 0.6;
      const c = t > 0.85 ? mix(col, 0xc8c870, (t - 0.85) * 4) : t < 0.15 ? mulRGB(col, 0.8) : col;
      m.set(Math.round(x), Math.round(y) + 1, Math.round(z), c);
      if (t < 0.35) m.set(Math.round(x + Math.cos(a + 1.57)), Math.round(y) + 1, Math.round(z + Math.sin(a + 1.57)), mulRGB(col, 0.9));
    }
  }
  // cattails: stiff stems with brown velvety heads
  for (let i = 0; i < 3 + (seed % 3); i++) {
    const bx = rng.range(-4, 4), bz = rng.range(-4, 4), Ht = rng.range(40, 56);
    const lx = rng.range(-0.08, 0.08), lz = rng.range(-0.08, 0.08);
    for (let y = 1; y <= Ht; y++) m.set(Math.round(bx + lx * y), y, Math.round(bz + lz * y), 0x6a8a3a);
    blobV(m, [bx + lx * (Ht - 6), Ht - 6, bz + lz * (Ht - 6)], [1.4, 5, 1.4], (x, y, z) => (hash3(x, y, z) < 0.25 ? 0x4a2e1a : 0x6a4428));
    m.set(Math.round(bx + lx * Ht), Ht + 1, Math.round(bz + lz * Ht), 0x8a8a4a);
  }
  // papyrus: a couple of umbrella heads
  for (let i = 0; i < (seed % 2) + 1; i++) {
    const bx = rng.range(-5, 5), bz = rng.range(-5, 5), Ht = rng.range(48, 62);
    for (let y = 1; y <= Ht; y++) m.set(Math.round(bx), y, Math.round(bz), 0x5e8a3a);
    for (let r = 0; r < 26; r++) {
      const a = rng.range(0, Math.PI * 2), L = rng.range(5, 9);
      seg(m, [bx, Ht, bz], [bx + Math.cos(a) * L, Ht + rng.range(-2, 3), bz + Math.sin(a) * L], (t) => (t > 0.8 ? 0x9ab858 : 0x6e9a42), 0);
    }
  }
  return { model: m, voxelSize: vs };
}

const PETALS = [
  { p: 0xe86a9a, d: 0xc84a7a, l: 0xf6a8c4 }, // oleander pink
  { p: 0xf4eee2, d: 0xd8d0c0, l: 0xffffff }, // white jasmine
  { p: 0xe8543a, d: 0xb83a26, l: 0xf88a62 }, // red hibiscus
  { p: 0xf0c040, d: 0xc89a28, l: 0xffe08a }, // yellow desert marigold
];
/** a flowering shrub: dense leaf clumps with blossom clusters (1/30) */
export function oasisFlowers(seed = 0): RuinModel {
  const vs = 1 / 30;
  const rng = new RNG(6301 + seed * 19);
  const nz = new Noise(17 + seed);
  const m = new VoxelModel('oasis_flowers' + seed);
  const pet = PETALS[seed % PETALS.length];
  const clumps = 9 + rng.int(0, 6);
  const tips: V3[] = [];
  for (let i = 0; i < clumps; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0, 9);
    const c: V3 = [Math.cos(a) * r, rng.range(8, 22) - r * 0.4, Math.sin(a) * r];
    const rr: V3 = [rng.range(4, 7), rng.range(3.5, 6), rng.range(4, 7)];
    // twig from the ground
    seg(m, [Math.cos(a) * r * 0.2, 0, Math.sin(a) * r * 0.2], c, 0x5a4428, 0.5);
    blobV(m, c, rr, (x, y, z) => {
      const n = nz.n3(x * 0.4, y * 0.4, z * 0.4);
      const g = n > 0.35 ? 0x6e9a42 : n < -0.35 ? 0x3e6428 : hash3(x, y, z) < 0.5 ? 0x4e7a32 : 0x5f8a3a;
      return hash3(x * 3, y, z) < 0.18 ? null : g;
    }, { noise: nz, amp: 0.35, freq: 0.35 });
    tips.push([c[0], c[1] + rr[1] * 0.7, c[2]]);
  }
  // blossoms on the outer surface
  const surf: V3[] = [];
  m.forEach((x, y, z, c) => {
    if (c === 0x5a4428) return;
    if (!m.has(x, y + 1, z) || !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1)) if (hash3(x, y * 2, z) < 0.07 && y > 6) surf.push([x, y, z]);
  });
  for (const [x, y, z] of surf) {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]] as V3[]) m.set(x + dx, y + dy, z + dz, dy ? pet.l : hash3(x + dx, y, z + dz) < 0.4 ? pet.d : pet.p);
    m.set(x, y + 1, z, 0xf8d860);
  }
  // a few fallen petals on the ground
  for (let i = 0; i < 14; i++) m.set(Math.round(rng.range(-12, 12)), 0, Math.round(rng.range(-12, 12)), pet.p);
  return { model: m, voxelSize: vs };
}

/** floating lily pads (notched, veined, upturned rims) with a lotus flower or two (1/30) */
export function lilyPads(seed = 0): RuinModel {
  const vs = 1 / 30;
  const rng = new RNG(6701 + seed * 23);
  const m = new VoxelModel('lily_pads' + seed);
  const n = 4 + rng.int(0, 3);
  const pads: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), r = i === 0 ? 0 : rng.range(6, 16);
    const c: V3 = [Math.cos(a) * r, 0, Math.sin(a) * r];
    const R = rng.range(4, 8.5);
    const notch = rng.range(0, Math.PI * 2);
    for (let x = Math.floor(c[0] - R - 1); x <= c[0] + R + 1; x++)
      for (let z = Math.floor(c[2] - R - 1); z <= c[2] + R + 1; z++) {
        const dx = x + 0.5 - c[0], dz = z + 0.5 - c[2];
        const d = Math.hypot(dx, dz);
        if (d > R) continue;
        const ang = Math.atan2(dz, dx);
        const da = Math.abs(((ang - notch + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (da < 0.22 && d > R * 0.1) continue; // the notch
        const vein = Math.abs(Math.sin(ang * 5)) < 0.12 && d > 1.5;
        const col = d > R - 1 ? 0x3e6a2a : vein ? 0x8ab85a : hash3(x, 1, z) < 0.15 ? 0x5a8a3a : 0x4e7e30;
        m.set(x, d > R - 1.2 ? 1 : 0, z, col);
      }
    pads.push(c);
  }
  // lotus flowers: cupped layered petals around a golden seed head
  for (let f = 0; f < 1 + (seed % 2); f++) {
    const c = pads[f % pads.length];
    const pink = f % 2 === 0;
    for (let layer = 0; layer < 3; layer++) {
      const np = 6 + layer * 2;
      for (let p = 0; p < np; p++) {
        const a = (p / np) * Math.PI * 2 + layer * 0.3;
        const L = 4.5 - layer * 1.1;
        seg(m, [c[0], 2 + layer, c[2]], [c[0] + Math.cos(a) * L, 3 + layer + (2 - layer) * 1.6 + 2, c[2] + Math.sin(a) * L], (t) => (pink ? (t > 0.7 ? 0xf6b4cc : 0xec88aa) : t > 0.7 ? 0xffffff : 0xf0ece0), 0.6);
      }
    }
    blobV(m, [c[0], 4, c[2]], [1.3, 1, 1.3], () => 0xf2c840);
  }
  return { model: m, voxelSize: vs };
}

// =============================================================================== dragonfly critter (rig, 1/80)
/** tiny dragonfly: body (root: thorax + long segmented abdomen + big compound eyes), wing_l / wing_r (two veined wings each) */
export function dragonflyRig(seed = 0): RigSpec {
  const vs = 1 / 80;
  const body = new VoxelModel('df_body');
  const tints = [[0x2a8ab8, 0x1a5a7a], [0xc8402a, 0x7a2418], [0x5aa83a, 0x2e6a22]];
  const [c0, c1] = tints[seed % tints.length];
  // thorax
  blobV(body, [0, 0, 1], [2, 2, 2.6], (x, y) => (y > 0 ? c0 : c1));
  // abdomen: 9 tapering segments with dark rings
  for (let s = 0; s < 18; s++) {
    const r = 1.1 - s * 0.03;
    blobV(body, [0, -s * 0.06, -2 - s], [r, r, 0.75], () => (s % 2 ? c1 : c0));
  }
  // head + huge compound eyes
  blobV(body, [0, 0.4, 4], [1.6, 1.5, 1.2], () => 0x2a2420);
  for (const sx of [-1, 1]) {
    blobV(body, [sx * 1.4, 0.8, 4.2], [1.4, 1.5, 1.4], (x, y, z) => ((x + y + z) % 3 === 0 ? 0x3a6a4a : 0x1a3a2a), { fl: VF.METAL });
    body.set(sx * 1, 2, 5, 0xe8f4ee, VF.METAL);
  }
  // legs tucked under
  for (const sx of [-1, 1]) for (let l = 0; l < 3; l++) body.set(sx * 1, -2, l, 0x1a1410).set(sx * 2, -3, l, 0x1a1410);
  const wing = (name: string, sx: number) => {
    const w = new VoxelModel(name);
    for (const [zc, L] of [[1.6, 13], [-0.4, 12]] as [number, number][]) {
      for (let u = 1; u <= L; u++) {
        const width = Math.round(Math.sin((u / L) * Math.PI) * 1.8 + 0.6);
        for (let q = -width; q <= width; q++) {
          const vein = q === 0 || u % 4 === 0;
          const stig = u === L - 2 && q === width;
          w.set(sx * (u + 1), 0, Math.round(zc + q * 0.6), stig ? 0x3a2a20 : vein ? 0x8aa0a8 : 0xd8eef4, VF.SOFTAO | VF.METAL);
        }
      }
    }
    return w;
  };
  return {
    name: 'dragonfly' + seed,
    voxelSize: vs,
    parts: [
      { name: 'body', model: body, pivot: [0, 0, 0], attach: [0, 0, 0] },
      { name: 'wing_l', model: wing('wing_l', 1), pivot: [1, 1, 1], attach: [1, 1, 1], parent: 'body' },
      { name: 'wing_r', model: wing('wing_r', -1), pivot: [-1, 1, 1], attach: [-1, 1, 1], parent: 'body' },
    ],
    meta: { height: 0.06 },
  };
}
