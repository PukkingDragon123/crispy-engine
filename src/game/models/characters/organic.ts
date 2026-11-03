// Organic, hand-shaped voxel forms (no plain primitives): noise-wobbled masses,
// tapering tubes along bent paths, sagging cloth sheets and hand-shaped jars.
// Shapes are deterministic (seeded) so every rebuild looks identical.
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { noise, hash3 } from '../../../engine/math/rand';
import type { V3 } from '../../../engine/voxel/Rig';

export type Paint = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number | null;

/**
 * An organic mass: an asymmetric superellipsoid whose surface is displaced by
 * low-frequency noise (lumps, sags), never a clean sphere. `col` receives the
 * voxel position and its normalised offset from the centre (-1..1 per axis).
 */
export function lump(m: VoxelModel, c: V3, r: V3, col: Paint, o: { wobble?: number; seed?: number; power?: number; flags?: number; shell?: number } = {}) {
  const wob = o.wobble ?? 0.14, seed = o.seed ?? 1, p = o.power ?? 2.2;
  const [cx, cy, cz] = c, [rx, ry, rz] = r;
  const R = Math.ceil(Math.max(rx, ry, rz) * (1 + wob) + 1);
  for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++)
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
      for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry, nz = (z + 0.5 - cz) / rz;
        const d = Math.pow(Math.abs(nx), p) + Math.pow(Math.abs(ny), p) + Math.pow(Math.abs(nz), p);
        const n = noise.n3(x * 0.19 + seed * 7.1, y * 0.19 - seed * 3.3, z * 0.19 + seed * 1.7) * wob + noise.n3(x * 0.5 + seed, y * 0.5, z * 0.5 - seed) * wob * 0.35;
        const lim = 1 + n;
        if (d > lim) continue;
        if (o.shell !== undefined) {
          const inner = 1 - o.shell;
          if (d < Math.pow(inner, p) * lim) continue;
        }
        const cc = col(x, y, z, nx, ny, nz);
        if (cc !== null) m.set(x, y, z, cc, o.flags);
      }
  return m;
}

/**
 * A tapering tube along a bent polyline (necks, limbs, tails, canes, ropes).
 * Radius goes r0 -> r1 along the path, with a gentle noise bulge so it reads
 * as flesh / wood, not a pipe.
 */
export function tube(m: VoxelModel, pts: V3[], r0: number, r1: number, col: Paint, o: { wobble?: number; seed?: number; flags?: number; step?: number } = {}) {
  const wob = o.wobble ?? 0.12, seed = o.seed ?? 3;
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    seg.push(d);
    total += d;
  }
  const step = o.step ?? 0.35;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = seg[i - 1];
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const g = (acc + L * t) / Math.max(1e-6, total);
      const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t, pz = a[2] + (b[2] - a[2]) * t;
      const rr = (r0 + (r1 - r0) * g) * (1 + noise.n2(g * 6 + seed, seed * 2.3) * wob);
      const R = Math.ceil(rr + 1);
      for (let x = Math.floor(px - R); x <= Math.ceil(px + R); x++)
        for (let y = Math.floor(py - R); y <= Math.ceil(py + R); y++)
          for (let z = Math.floor(pz - R); z <= Math.ceil(pz + R); z++) {
            const dx = x + 0.5 - px, dy = y + 0.5 - py, dz = z + 0.5 - pz;
            if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
            const cc = col(x, y, z, g, dy / Math.max(rr, 0.5), 0);
            if (cc !== null) m.set(x, y, z, cc, o.flags);
          }
    }
    acc += L;
  }
  return m;
}

/** a hand-shaped jar/pot/bottle by radius profile (bottom->top), slightly leaning & lopsided */
export function vessel(m: VoxelModel, base: V3, profile: number[], col: (y: number, x: number, z: number) => number | null, o: { lean?: [number, number]; seed?: number; flags?: number; hollowTop?: boolean } = {}) {
  const [bx, by, bz] = base;
  const seed = o.seed ?? 5;
  const [lx, lz] = o.lean ?? [0, 0];
  for (let i = 0; i < profile.length; i++) {
    const y = by + i;
    const t = i / Math.max(1, profile.length - 1);
    const cx = bx + lx * t, cz = bz + lz * t;
    const r = profile[i];
    const R = Math.ceil(r + 1);
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++)
      for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) {
        const a = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
        const rr = r * (1 + noise.n2(Math.cos(a) * 1.3 + seed, Math.sin(a) * 1.3 + i * 0.15) * 0.08);
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
        if (d > rr) continue;
        if (o.hollowTop && i === profile.length - 1 && d < rr - 1) continue;
        const c = col(i, x, z);
        if (c !== null) m.set(x, y, z, c, o.flags);
      }
  }
  return m;
}

/**
 * A sagging cloth sheet spanned between four corners (canopies, awnings, shawls):
 * bilinear surface with catenary sag + noise ripples, `thick` voxels thick.
 */
export function sheet(m: VoxelModel, c00: V3, c10: V3, c01: V3, c11: V3, col: (u: number, v: number, x: number, y: number, z: number) => number | null, o: { sag?: number; ripple?: number; thick?: number; res?: number; seed?: number } = {}) {
  const sag = o.sag ?? 2, rip = o.ripple ?? 0.6, th = o.thick ?? 1, res = o.res ?? 0.4, seed = o.seed ?? 9;
  const du = Math.hypot(c10[0] - c00[0], c10[1] - c00[1], c10[2] - c00[2]);
  const dv = Math.hypot(c01[0] - c00[0], c01[1] - c00[1], c01[2] - c00[2]);
  const nu = Math.ceil(du / res), nv = Math.ceil(dv / res);
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j <= nv; j++) {
      const u = i / nu, v = j / nv;
      const L = (a: number, b: number, c: number, d: number) => a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
      const x = L(c00[0], c10[0], c01[0], c11[0]);
      let y = L(c00[1], c10[1], c01[1], c11[1]);
      const z = L(c00[2], c10[2], c01[2], c11[2]);
      y -= sag * 4 * u * (1 - u) * (0.5 + 0.5 * 4 * v * (1 - v));
      y += noise.n2(u * 5 + seed, v * 5 - seed) * rip;
      for (let t = 0; t < th; t++) {
        const c = col(u, v, Math.floor(x), Math.floor(y) - t, Math.floor(z));
        if (c !== null) m.set(Math.floor(x), Math.floor(y) - t, Math.floor(z), c);
      }
    }
  return m;
}

/** deterministic 0..1 per voxel (for sparse, deliberate wear marks — not colour noise) */
export const h01 = (x: number, y: number, z: number, s = 0) => hash3(x * 1.31 + s * 17, y * 1.73 - s * 7, z * 2.11 + s * 3);
