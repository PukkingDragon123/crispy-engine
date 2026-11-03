// Realistic-creature kit (STYLE v3 exceptions): smooth meter-space primitives on
// top of the RBm/Sc rig builder, natural material shaders (chitin, fur, dried
// skin, dung) and a subtle shading pass (no outlines, no pixel-art ramps).
import { RBm, Sc, M3, VoxelModel, VF, mix, mulRGB, hash3, noise } from './sculpt';
import type { CSpec, ColorFn } from '../../../../engine/voxel/VoxelModel';
import { rgb } from '../../../../engine/voxel/VoxelModel';

export { RBm, Sc, VF, mix, mulRGB, hash3, noise, rgb };
export type { M3, CSpec, ColorFn };

const res = (c: CSpec, x: number, y: number, z: number) => (typeof c === 'number' ? c : c(x, y, z));

/** rotate a vector by yaw (Y), pitch (X), roll (Z) — used for oriented ellipsoids */
function rot(v: M3, r: M3): M3 {
  let [x, y, z] = v;
  // roll (z)
  let c = Math.cos(r[2]), s = Math.sin(r[2]);
  [x, y] = [x * c - y * s, x * s + y * c];
  // pitch (x)
  c = Math.cos(r[0]);
  s = Math.sin(r[0]);
  [y, z] = [y * c - z * s, y * s + z * c];
  // yaw (y)
  c = Math.cos(r[1]);
  s = Math.sin(r[1]);
  [x, z] = [x * c + z * s, -x * s + z * c];
  return [x, y, z];
}
function irot(v: M3, r: M3): M3 {
  let [x, y, z] = v;
  let c = Math.cos(-r[1]), s = Math.sin(-r[1]);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(-r[0]);
  s = Math.sin(-r[0]);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(-r[2]);
  s = Math.sin(-r[2]);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

/** smooth (optionally rotated) ellipsoid; `keep` filters voxels by local normalized coords */
export function ell(s: Sc, c: M3, r: M3, col: CSpec, o: { rot?: M3; fl?: number; keep?: (lx: number, ly: number, lz: number) => boolean; carve?: boolean } = {}) {
  const vs = s.vs;
  const R = Math.max(r[0], r[1], r[2]);
  const i0 = s.i(c[0] - R) - 1, i1 = s.i(c[0] + R) + 1;
  const j0 = s.i(c[1] - R) - 1, j1 = s.i(c[1] + R) + 1;
  const k0 = s.i(c[2] - R) - 1, k1 = s.i(c[2] + R) + 1;
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++)
      for (let k = k0; k <= k1; k++) {
        let p: M3 = [(i + 0.5) * vs - c[0], (j + 0.5) * vs - c[1], (k + 0.5) * vs - c[2]];
        if (o.rot) p = irot(p, o.rot);
        const lx = p[0] / r[0], ly = p[1] / r[1], lz = p[2] / r[2];
        if (lx * lx + ly * ly + lz * lz > 1) continue;
        if (o.keep && !o.keep(lx, ly, lz)) continue;
        if (o.carve) s.m.del(i, j, k);
        else {
          const cc = res(col, i, j, k);
          if (cc !== null) s.m.set(i, j, k, cc, o.fl);
        }
      }
  return s;
}

/** smooth round capsule/cone from a to b (radius r0 -> r1) */
export function cap(s: Sc, a: M3, b: M3, r0: number, r1: number, col: CSpec, fl?: number) {
  const vs = s.vs;
  const R = Math.max(r0, r1);
  const lo: M3 = [Math.min(a[0], b[0]) - R, Math.min(a[1], b[1]) - R, Math.min(a[2], b[2]) - R];
  const hi: M3 = [Math.max(a[0], b[0]) + R, Math.max(a[1], b[1]) + R, Math.max(a[2], b[2]) + R];
  const d: M3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1e-9;
  for (let i = s.i(lo[0]) - 1; i <= s.i(hi[0]) + 1; i++)
    for (let j = s.i(lo[1]) - 1; j <= s.i(hi[1]) + 1; j++)
      for (let k = s.i(lo[2]) - 1; k <= s.i(hi[2]) + 1; k++) {
        const px = (i + 0.5) * vs - a[0], py = (j + 0.5) * vs - a[1], pz = (k + 0.5) * vs - a[2];
        const t = Math.max(0, Math.min(1, (px * d[0] + py * d[1] + pz * d[2]) / L2));
        const qx = px - d[0] * t, qy = py - d[1] * t, qz = pz - d[2] * t;
        const rr = r0 + (r1 - r0) * t;
        if (qx * qx + qy * qy + qz * qz > rr * rr) continue;
        const cc = res(col, i, j, k);
        if (cc !== null) s.m.set(i, j, k, cc, fl);
      }
  return s;
}

/** Catmull-Rom smoothed tube through points; radius as a function of t (0..1) */
export function tube(s: Sc, pts: M3[], r: (t: number) => number, col: CSpec | ((t: number) => CSpec), fl?: number) {
  const P = (k: number) => pts[Math.max(0, Math.min(pts.length - 1, k))];
  const samples: M3[] = [];
  const N = Math.max(4, Math.ceil(pathLen(pts) / s.vs) * 2);
  for (let n = 0; n <= N; n++) {
    const g = (n / N) * (pts.length - 1);
    const k = Math.min(pts.length - 2, Math.floor(g)), t = g - k;
    const p0 = P(k - 1), p1 = P(k), p2 = P(k + 1), p3 = P(k + 2);
    const cr = (i: number) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t * t + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t * t * t);
    samples.push([cr(0), cr(1), cr(2)]);
  }
  for (let n = 0; n < samples.length - 1; n++) {
    const t0 = n / (samples.length - 1), t1 = (n + 1) / (samples.length - 1);
    const c = typeof col === 'function' && col.length <= 1 ? (col as (t: number) => CSpec)(t0) : (col as CSpec);
    cap(s, samples[n], samples[n + 1], r(t0), r(t1), c, fl);
  }
  return s;
}
export function pathLen(pts: M3[]) {
  let L = 0;
  for (let k = 0; k < pts.length - 1; k++) L += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1], pts[k + 1][2] - pts[k][2]);
  return L;
}

/** repaint existing voxels of a part where pred(meters) holds */
export function paint(s: Sc, pred: (x: number, y: number, z: number) => boolean, col: CSpec, fl?: number) {
  const vs = s.vs;
  const todo: [number, number, number, number, number][] = [];
  s.m.forEach((i, j, k, _rgb, flags) => {
    if (!pred((i + 0.5) * vs, (j + 0.5) * vs, (k + 0.5) * vs)) return;
    const cc = res(col, i, j, k);
    if (cc !== null) todo.push([i, j, k, cc, fl ?? flags]);
  });
  for (const [i, j, k, c, f] of todo) s.m.set(i, j, k, c, f);
  return s;
}

/** remove voxels where pred(meters) holds */
export function cut(s: Sc, pred: (x: number, y: number, z: number) => boolean) {
  const vs = s.vs;
  const todo: [number, number, number][] = [];
  s.m.forEach((i, j, k) => {
    if (pred((i + 0.5) * vs, (j + 0.5) * vs, (k + 0.5) * vs)) todo.push([i, j, k]);
  });
  for (const [i, j, k] of todo) s.m.del(i, j, k);
  return s;
}

/** surface-only repaint: voxels with at least one empty neighbour */
export function surface(m: VoxelModel, fn: (x: number, y: number, z: number, rgb: number, up: boolean, down: boolean) => number | null) {
  const todo: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, flags) => {
    const up = !m.has(x, y + 1, z), down = !m.has(x, y - 1, z);
    const side = !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
    if (!up && !down && !side) return;
    const n = fn(x, y, z, c, up, down);
    if (n !== null && n !== c) todo.push([x, y, z, n, flags]);
  });
  for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f);
}

/** realistic finishing: gentle sky-light on top faces, darker undersides, crevice darkening. No outlines. */
export function realFinish(rb: RBm, strength = 1, crevices = true) {
  for (const p of rb.parts) {
    const m = p.model;
    surface(m, (x, y, z, c, up, down) => {
      let f = 1;
      if (up) f *= 1 + 0.05 * strength;
      if (down) f *= 1 - 0.12 * strength;
      // crevices: count solid neighbours in a 3x3x3 shell
      let n = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (m.has(x + dx, y + dy, z + dz)) n++;
      if (crevices && n > 20) f *= 1 - (n - 20) * 0.012 * strength;
      return f === 1 ? null : mulRGB(c, f);
    });
  }
}

// ----------------------------------------------------------------- materials
/** glossy insect chitin: broad tonal waves, fine punctures, rim/sheen tint */
export function chitin(base: number, sheen: number, vs: number, seed = 0, o: { punct?: number; cell?: number } = {}): ColorFn {
  const cell = (o.cell ?? 0.08) / vs;
  const punct = o.punct ?? 0.06;
  return (x, y, z) => {
    const n = noise.n3(x / cell + seed * 7.1, y / cell, z / cell - seed * 3.3) * 0.5 + 0.5;
    let c = n > 0.72 ? mix(base, sheen, 0.45) : n > 0.5 ? mix(base, sheen, 0.18) : base;
    if (hash3(x + seed, y * 3, z) < punct * 0.35) c = mulRGB(c, 0.8);
    return c;
  };
}
/** iridescent (structural colour) chitin: hue drifts across the shell */
export function irid(cols: number[], vs: number, seed = 0): ColorFn {
  const cell = 0.12 / vs;
  return (x, y, z) => {
    const n = noise.n3(x / cell + seed, y / cell * 0.7, z / cell) * 0.5 + 0.5;
    const t = Math.min(0.999, Math.max(0, (n * 0.8 + ((y * 0.37 + z * 0.11) / cell) * 0.08) % 1));
    const f = t * (cols.length - 1), k = Math.floor(f);
    let c = mix(cols[k], cols[Math.min(cols.length - 1, k + 1)], f - k);
    return c;
  };
}
/** fur: streaks along `dir` (axis), darker roots/tips, guard-hair flecks */
export function fur(base: number, light: number, dark: number, vs: number, seed = 0, axis: 'y' | 'z' = 'z'): ColorFn {
  const cell = 0.05 / vs;
  return (x, y, z) => {
    const a = axis === 'z' ? noise.n3(x / cell + seed, y / cell, z / (cell * 4)) : noise.n3(x / cell + seed, y / (cell * 4), z / cell);
    const b = noise.n3(x / (cell * 3), y / (cell * 3) + seed, z / (cell * 3)) * 0.5 + 0.5;
    let c = a > 0.38 ? mix(base, light, 0.55) : a < -0.45 ? mix(base, dark, 0.5) : base;
    if (b < 0.25) c = mix(c, dark, 0.15);
    const h = hash3(x + seed, y, z);
    if (h < 0.012) c = mix(c, light, 0.5);
    else if (h > 0.988) c = mix(c, dark, 0.5);
    return c;
  };
}
/** dried, cracked leathery skin with crack network */
export function leather(base: number, light: number, crack: number, vs: number, seed = 0): ColorFn {
  const cell = 0.06 / vs;
  return (x, y, z) => {
    const n = noise.n3(x / cell + seed, y / cell, z / cell);
    const n2 = noise.n3(x / (cell * 0.45) - seed, y / (cell * 0.45), z / (cell * 0.45));
    if (Math.abs(n2) < 0.06) return mix(crack, base, 0.25);
    return n > 0.35 ? light : n > -0.2 ? base : mix(base, crack, 0.3);
  };
}
/** dung / packed earth with straw fibres and pebbles */
export function dung(base: number, vs: number, seed = 0): ColorFn {
  const cell = 0.07 / vs;
  return (x, y, z) => {
    const n = noise.n3(x / cell + seed, y / cell, z / cell) * 0.5 + 0.5;
    let c = mix(mulRGB(base, 0.75), mulRGB(base, 1.18), n);
    const h = hash3(x, y + seed, z);
    if (h < 0.035) c = 0xb8a060; // straw
    else if (h > 0.985) c = 0x8a8478; // pebble
    return c;
  };
}
/** bone with fine cracks and grime in recesses */
export function boneR(base: number, vs: number, seed = 0): ColorFn {
  const cell = 0.04 / vs;
  return (x, y, z) => {
    const n = noise.n3(x / cell + seed, y / cell, z / cell);
    let c = mix(base, mulRGB(base, 0.82), Math.max(0, -n) * 0.9);
    if (Math.abs(noise.n3(x / (cell * 0.5), y / (cell * 0.5) + seed, z / (cell * 0.5))) < 0.035) c = mulRGB(c, 0.7);
    return mulRGB(c, 0.97 + hash3(x, y, z) * 0.05);
  };
}

/** a dark eye plug centred at c (the engine hides it and draws 2D eyes): a small recess-filling slab */
export function eyePlug(rb: RBm, name: string, parent: string, c: M3, w: number, h: number, depth: number) {
  const s = rb.pm(name, parent, c);
  const vs = rb.voxelSize;
  ell(s, c, [Math.max(vs * 0.8, w / 2), Math.max(vs * 0.8, h / 2), Math.max(vs * 0.6, depth / 2)], 0x0e0806);
  return s;
}

/** hollow-out the deep interior of big parts (keeps a shell) to save voxels */
export function hollow(m: VoxelModel, keep = 3) {
  const del: [number, number, number][] = [];
  m.forEach((x, y, z) => {
    for (let d = 1; d <= keep; d++) {
      if (!m.has(x + d, y, z) || !m.has(x - d, y, z) || !m.has(x, y + d, z) || !m.has(x, y - d, z) || !m.has(x, y, z + d) || !m.has(x, y, z - d)) return;
    }
    del.push([x, y, z]);
  });
  for (const [x, y, z] of del) m.del(x, y, z);
}


/** voxel of a model maximising score(x,y,z) */
export function argmax(m: VoxelModel, score: (x: number, y: number, z: number) => number | null): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let bs = -1e18;
  m.forEach((x, y, z) => {
    const sc = score(x, y, z);
    if (sc !== null && sc > bs) {
      bs = sc;
      best = [x, y, z];
    }
  });
  return best;
}

// ----------------------------------------------------------------- real voxel eyes (no 2D overlay anymore)
/** glossy black compound eye: faceted dither + one or two specular highlight voxels (top-front) */
export function compoundEye(rb: RBm, name: string, parent: string, c: M3, r: number, side: 1 | -1 = 1) {
  const s = rb.pm(name, parent, c);
  const vs = rb.voxelSize;
  const R = Math.max(vs * 1.1, r);
  ell(s, c, [R * 0.9, R, R], (x, y, z) => ((x + y * 2 + z * 3) % 3 === 0 ? 0x1c2026 : (x + z) & 1 ? 0x0b0c10 : 0x121418), { fl: VF.METAL });
  // specular highlights: topmost-front-outer voxels
  const best = argmax(s.m, (x, y, z) => y * 1.0 + z * 0.7 + side * x * 0.4);
  if (best) {
    const [x, y, z] = best;
    s.m.set(x, y, z, 0xd8e4f0, VF.METAL);
    if (R > vs * 2) s.m.set(x, y - 1, z, 0x7a8696, VF.METAL);
  }
  return s;
}

/** mammal eye: amber iris ring, dark pupil, dark upper lid line, catch-light; `fwd` = viewing direction */
export function mammalEye(rb: RBm, name: string, parent: string, c: M3, r: number, fwd: M3, o: { iris?: number; lid?: number; pupil?: number } = {}) {
  const s = rb.pm(name, parent, c);
  const vs = rb.voxelSize;
  const R = Math.max(vs * 1.2, r);
  const fl = Math.hypot(fwd[0], fwd[1], fwd[2]) || 1;
  const f: M3 = [fwd[0] / fl, fwd[1] / fl, fwd[2] / fl];
  // right = up x fwd ; up' = fwd x right
  let rx = f[2], rz = -f[0];
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = f[1] * rz - 0, uy = f[2] * rx - f[0] * rz, uz = 0 - f[1] * rx;
  const iris = o.iris ?? 0xc8881e, lid = o.lid ?? 0x2a1a10, pupil = o.pupil ?? 0x080504;
  ell(s, c, [R, R * 0.85, R], (i, j, k) => {
    const px = (i + 0.5) * vs - c[0], py = (j + 0.5) * vs - c[1], pz = (k + 0.5) * vs - c[2];
    const pf = px * f[0] + py * f[1] + pz * f[2];
    const pr = px * rx + pz * rz;
    const pu = px * ux + py * uy + pz * uz;
    if (pu > R * 0.45) return lid;
    if (pf < R * 0.1) return 0x1a120c;
    const d = Math.hypot(pr, pu) / R;
    if (d < 0.32) return pupil;
    if (d < 0.8) return mix(iris, mulRGB(iris, 0.7), d);
    return 0x2a1a10;
  });
  // catch-light: the voxel most toward (fwd + up*0.5 - right*0.4)
  const best = argmax(s.m, (i, j, k) => {
    const px = (i + 0.5) * vs - c[0], py = (j + 0.5) * vs - c[1], pz = (k + 0.5) * vs - c[2];
    const pu = px * ux + py * uy + pz * uz;
    if (pu > R * 0.45) return null;
    return (px * f[0] + py * f[1] + pz * f[2]) * 1.0 + pu * 0.35 - (px * rx + pz * rz) * 0.3;
  });
  if (best) s.m.set(best[0], best[1], best[2], 0xfff2d8);
  return s;
}

/** shrivelled, cloudy dried eyeball sunk deep in a socket (husks) */
export function driedEye(rb: RBm, name: string, parent: string, c: M3, r: number) {
  const s = rb.pm(name, parent, c);
  const vs = rb.voxelSize;
  const R = Math.max(vs * 1.1, r);
  ell(s, c, [R, R * 0.75, R * 0.8], (x, y, z) => {
    const h = hash3(x, y, z);
    return h < 0.2 ? 0x3a2e24 : h < 0.55 ? 0x6a5e4a : 0x7e745e;
  });
  const best = argmax(s.m, (_x, y, z) => z * 1.0 + y * 0.5);
  if (best) s.m.set(best[0], best[1], best[2], 0xa8a294); // dull cloudy glint
  return s;
}

// ----------------------------------------------------------------- organic shaping (no primitive blobs)
const N6: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Break perfect primitive surfaces into hand-sculpted lumps: surface voxels grow
 * outward where low-frequency noise is high and erode where it is low.
 * `cellV` = lump size in voxels, `passes` = amplitude in voxels.
 */
export function lumpy(m: VoxelModel, cellV = 5, passes = 1, seed = 0, thr = 0.3) {
  for (let p = 0; p < passes; p++) {
    const add: [number, number, number, number, number][] = [];
    const del: [number, number, number][] = [];
    m.forEach((x, y, z, c, f) => {
      let open = -1;
      for (let d = 0; d < 6; d++) if (!m.has(x + N6[d][0], y + N6[d][1], z + N6[d][2])) open = d;
      if (open < 0) return;
      const n = noise.n3(x / cellV + seed * 3.7 + p * 11, y / cellV - seed, z / cellV + p * 5);
      if (n > thr) {
        const [dx, dy, dz] = N6[open];
        add.push([x + dx, y + dy, z + dz, c, f]);
      } else if (n < -thr - 0.1) {
        let solid = 0;
        for (const [dx, dy, dz] of N6) if (m.has(x + dx, y + dy, z + dz)) solid++;
        if (solid >= 3) del.push([x, y, z]);
      }
    });
    for (const [x, y, z] of del) m.del(x, y, z);
    for (const [x, y, z, c, f] of add) if (!m.has(x, y, z)) m.map.set(((x + 512) << 20) | ((y + 512) << 10) | (z + 512), ((f & 0x7f) << 24) | (c & 0xffffff));
  }
}

/** raise ridges: wherever pred(meters) holds on the surface, add a voxel outward (keels, striae, veins, seams) */
export function ridge(s: Sc, pred: (x: number, y: number, z: number) => boolean, col?: CSpec, height = 1) {
  const vs = s.vs, m = s.m;
  for (let h = 0; h < height; h++) {
    const add: [number, number, number, number, number][] = [];
    m.forEach((x, y, z, c, f) => {
      if (!pred((x + 0.5) * vs, (y + 0.5) * vs, (z + 0.5) * vs)) return;
      for (const [dx, dy, dz] of N6) {
        if (dy < 0) continue;
        if (!m.has(x + dx, y + dy, z + dz)) {
          const cc = col === undefined ? c : res(col, x, y, z);
          if (cc !== null) add.push([x + dx, y + dy, z + dz, cc, f]);
          break;
        }
      }
    });
    for (const [x, y, z, c, f] of add) m.set(x, y, z, c, f);
  }
}

/** knobbly bumps scattered over a part's surface (tubercles, granules, warts) */
export function tubercles(s: Sc, count: number, r: number, col: CSpec, pred: (x: number, y: number, z: number) => boolean = () => true, seed = 0) {
  const vs = s.vs;
  const surf: [number, number, number][] = [];
  s.m.forEach((x, y, z) => {
    if (!s.m.has(x, y + 1, z) || !s.m.has(x + 1, y, z) || !s.m.has(x - 1, y, z)) if (pred((x + 0.5) * vs, (y + 0.5) * vs, (z + 0.5) * vs)) surf.push([x, y, z]);
  });
  if (!surf.length) return;
  for (let k = 0; k < count; k++) {
    const [x, y, z] = surf[Math.floor(hash3(k, seed, 7) * surf.length) % surf.length];
    const rr = r * (0.6 + hash3(k, seed, 9) * 0.8);
    cap(s, [(x + 0.5) * vs, (y + 0.5) * vs, (z + 0.5) * vs], [(x + 0.5) * vs + (hash3(k, 1, seed) - 0.5) * vs, (y + 1) * vs, (z + 0.5) * vs], rr, rr * 0.6, col);
  }
}

/** three clean colour bands (cel-friendly): dark / base / light picked by broad noise */
export function bands(dark: number, base: number, light: number, vs: number, cellM = 0.15, seed = 0, lo = -0.35, hi = 0.4): ColorFn {
  const cell = cellM / vs;
  return (x, y, z) => {
    const n = noise.n3(x / cell + seed, y / cell, z / cell - seed);
    return n < lo ? dark : n > hi ? light : base;
  };
}

/** twisted two-strand rope along points (optionally closed loop) with a knot at the start */
export function rope(s: Sc, pts: M3[], r: number, cols: [number, number], o: { closed?: boolean; knot?: boolean } = {}) {
  const path = o.closed ? [...pts, pts[0], pts[1]] : pts;
  const vs = s.vs;
  const twist = (x: number, y: number, z: number) => ((x + y * 2 + z) % 4 < 2 ? cols[0] : cols[1]);
  tube(s, path, () => Math.max(vs * 0.7, r), twist);
  if (o.knot) {
    const k0 = pts[0];
    ell(s, k0, [r * 2.2, r * 2, r * 2.2], twist);
    lumpy(s.m, 2, 1, 5, 0.55);
    // two frayed tails hanging from the knot
    for (const dx of [-1, 1]) tube(s, [k0, [k0[0] + dx * r * 2, k0[1] - r * 5, k0[2] + r], [k0[0] + dx * r * 3, k0[1] - r * 9, k0[2] + r * 2]], () => Math.max(vs * 0.6, r * 0.8), twist);
  }
}

/** points around an ellipse in the XY plane at depth z (or XZ plane at height y), lightly irregular */
export function loopPts(c: M3, rx: number, ry: number, plane: 'xy' | 'xz', n = 24, wobble = 0.04, seed = 0): M3[] {
  const out: M3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 1 + (hash3(i, seed, 3) - 0.5) * wobble * 2;
    if (plane === 'xy') out.push([c[0] + Math.sin(a) * rx * w, c[1] + Math.cos(a) * ry * w, c[2] + (hash3(i, seed, 5) - 0.5) * rx * wobble]);
    else out.push([c[0] + Math.sin(a) * rx * w, c[1] + (hash3(i, seed, 7) - 0.5) * ry * wobble, c[2] + Math.cos(a) * ry * w]);
  }
  return out;
}
