// Monster kit: shared sculpting helpers for the big desert beasts (sand hippo,
// Gobi the house turtle, the dromedary). Builds on ckit.
//
//  plate()     a keratin / bone plate (osteoderm, scute, brow shield) grown out
//              of a surface: rounded-rect footprint with an uneven outline, a
//              domed top with an optional keel ridge, a shingled tilt (rear
//              edge proud), growth rings, a weathered rim, the odd crack, and
//              an optional horn spike. Clean colour regions, so the greedy
//              mesher still merges long runs.
//  castIn()    first filled cell along a ray (find a surface point).
//  normalAt()  outward surface normal estimated from local occupancy.
//  fblob()     culled smooth-union sculpt (only the primitives that can reach a
//              cell are evaluated), the fast path for big bodies.
//  splitMany() cut one sculpted mass into several rig parts, with hidden
//              interior plugs so joints never open a gap when they bend.
//  groove()    carve a skin fold / scute seam along an implicit surface.
//  upsample()  re-grid a coarse model at 2x (no visual change).
import { VoxelModel, VF, V3, Prim, mixc, n01, h01, add3, sub3, scl3, dot3, norm3, cross3, clamp01, exposed } from './ckit';

export type Pal = { top: number; mid: number; base: number; rim: number; ring: number; crack: number; sand: number };

export interface PlateOpt {
  /** half length along fwd, half width, height (voxels) */
  a: number;
  b: number;
  h: number;
  /** 0..1 central ridge strength */
  keel?: number;
  /** shingle tilt: rear edge raised by tilt * h */
  tilt?: number;
  /** how deep the plate roots into the skin (voxels) */
  sink?: number;
  seed?: number;
  /** footprint squareness (2 = ellipse, 3+ = rounded rectangle) */
  sq?: number;
  rings?: boolean;
  cracks?: boolean;
  /** horn spike length (voxels) rising from the rear of the keel */
  spike?: number;
  /** lean of the spike toward the rear (0 = straight out of the surface) */
  spikeLean?: number;
  fl?: number;
  /** only replace cells that pass (e.g. keep a plate inside one part's region) */
  keep?: (x: number, y: number, z: number) => boolean;
}

export function plate(m: VoxelModel, S: V3, nIn: V3, fwd: V3, o: PlateOpt, pal: Pal) {
  const n = norm3(nIn);
  let t = sub3(fwd, scl3(n, dot3(fwd, n)));
  if (Math.hypot(t[0], t[1], t[2]) < 1e-3) t = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  t = norm3(t);
  const b = cross3(n, t);
  const sink = o.sink ?? 2.5, keel = o.keel ?? 0.35, tilt = o.tilt ?? 0.3, sq = o.sq ?? 2.6, seed = o.seed ?? 0;
  const R = Math.max(o.a, o.b) * 1.2 + o.h * (1 + Math.abs(tilt)) + sink + 2;
  const crackA = (h01(seed, 3, 7) - 0.5) * 1.4, crackO = (h01(seed, 5, 1) - 0.5) * 0.6;
  const hasCrack = (o.cracks ?? true) && h01(seed, 9, 2) < 0.5;
  for (let i = Math.floor(S[0] - R); i <= Math.ceil(S[0] + R); i++)
    for (let j = Math.floor(S[1] - R); j <= Math.ceil(S[1] + R); j++)
      for (let k = Math.floor(S[2] - R); k <= Math.ceil(S[2] + R); k++) {
        const d: V3 = [i + 0.5 - S[0], j + 0.5 - S[1], k + 0.5 - S[2]];
        const w = dot3(d, n);
        if (w < -sink || w > o.h * 2.2) continue;
        const nu = dot3(d, t) / o.a, nv = dot3(d, b) / o.b;
        const ang = Math.atan2(nv, nu);
        const wob = 1 + (n01(Math.cos(ang) * 1.6, Math.sin(ang) * 1.6, seed * 0.37, 1, seed) - 0.5) * 0.32;
        const r = Math.pow(Math.abs(nu) ** sq + Math.abs(nv) ** sq, 1 / sq) / wob;
        if (r > 1) continue;
        const dome = Math.sqrt(Math.max(0, 1 - r * r));
        const ridge = 1 - keel * Math.min(1, Math.abs(nv));
        const hh = o.h * (0.55 + 0.45 * dome) * ridge + tilt * o.h * -nu * 0.55;
        if (w > hh) continue;
        if (o.keep && !o.keep(i, j, k)) continue;
        const top = w > hh - 1.4;
        let c: number;
        if (!top) c = w < 0.8 ? pal.sand : pal.base;
        else {
          // a weathered face, a bleached keel and proud rear edge, a dark worn rim, growth rings
          c = nu > 0.5 ? mixc(pal.mid, pal.base, 0.5) : pal.mid; // the front tucks under the plate ahead
          if ((keel > 0.2 && Math.abs(nv) < 0.2 + 0.1 * (1 - r) && nu < 0.5) || nu < -0.62) c = pal.top;
          if (r > 0.82 && nu > -0.62) c = pal.rim;
          else if ((o.rings ?? true) && r > 0.3 && (r * 3.4) % 1 < 0.18) c = pal.ring;
          if (hasCrack && Math.abs(nv - (nu * crackA + crackO)) * o.b < 0.55 && nu > -0.25 && r < 0.8) c = pal.crack;
        }
        m.set(i, j, k, c, o.fl);
      }
  if (o.spike && o.spike > 0) {
    const lean = o.spikeLean ?? 0.6;
    const root = add3(add3(S, scl3(t, -o.a * 0.25)), scl3(n, o.h * 0.6));
    const dir = norm3(add3(n, scl3(t, -lean)));
    const tip = add3(root, scl3(dir, o.spike));
    const r0 = Math.max(1.2, Math.min(o.a, o.b) * 0.42);
    const L = o.spike;
    for (let i = Math.floor(Math.min(root[0], tip[0]) - r0 - 1); i <= Math.ceil(Math.max(root[0], tip[0]) + r0 + 1); i++)
      for (let j = Math.floor(Math.min(root[1], tip[1]) - r0 - 1); j <= Math.ceil(Math.max(root[1], tip[1]) + r0 + 1); j++)
        for (let k = Math.floor(Math.min(root[2], tip[2]) - r0 - 1); k <= Math.ceil(Math.max(root[2], tip[2]) + r0 + 1); k++) {
          const p: V3 = [i + 0.5 - root[0], j + 0.5 - root[1], k + 0.5 - root[2]];
          const s = dot3(p, dir) / L;
          if (s < -0.1 || s > 1) continue;
          // slightly hooked: the axis bends back toward the tip
          const bend = scl3(t, -s * s * L * 0.18);
          const q = sub3(sub3(p, scl3(dir, s * L)), bend);
          const rr = r0 * Math.pow(1 - Math.max(0, s), 0.8) + 0.35;
          if (Math.hypot(q[0], q[1], q[2]) > rr) continue;
          if (o.keep && !o.keep(i, j, k)) continue;
          m.set(i, j, k, s > 0.72 ? pal.top : s > 0.35 ? pal.mid : pal.base, o.fl);
        }
  }
  return m;
}

/** first filled cell along a ray from `from` (voxel coords) */
export function castIn(m: VoxelModel, from: V3, dir: V3, max = 260): V3 | null {
  const d = norm3(dir);
  for (let s = 0; s < max; s += 0.5) {
    const x = Math.floor(from[0] + d[0] * s), y = Math.floor(from[1] + d[1] * s), z = Math.floor(from[2] + d[2] * s);
    if (m.has(x, y, z)) return [x, y, z];
  }
  return null;
}

/** outward normal at a surface cell (local occupancy gradient) */
export function normalAt(m: VoxelModel, p: V3, R = 3): V3 {
  let nx = 0, ny = 0, nz = 0;
  for (let dx = -R; dx <= R; dx++)
    for (let dy = -R; dy <= R; dy++)
      for (let dz = -R; dz <= R; dz++) {
        if (dx * dx + dy * dy + dz * dz > R * R) continue;
        if (!m.has(p[0] + dx, p[1] + dy, p[2] + dz)) {
          nx += dx;
          ny += dy;
          nz += dz;
        }
      }
  if (!nx && !ny && !nz) return [0, 1, 0];
  return norm3([nx, ny, nz]);
}

/** cast onto a surface and grow a plate there (centre of the hit cell); returns the hit or null */
export function plateOn(m: VoxelModel, target: VoxelModel, from: V3, dir: V3, fwd: V3, o: PlateOpt, pal: Pal, lift = 0) {
  const hit = castIn(target, from, dir);
  if (!hit) return null;
  const nrm = normalAt(target, hit, 3);
  const S: V3 = [hit[0] + 0.5 + nrm[0] * lift, hit[1] + 0.5 + nrm[1] * lift, hit[2] + 0.5 + nrm[2] * lift];
  plate(m, S, nrm, fwd, o, pal);
  return { S, n: nrm };
}

// ---------------------------------------------------------------- culled organic sculpt
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);
function primSdf(q: Prim, px: number, py: number, pz: number) {
  if (q.a && q.b) {
    const a = q.a, b = q.b;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L2 = dx * dx + dy * dy + dz * dz || 1e-6;
    const ax = px - a[0], ay = py - a[1], az = pz - a[2];
    const t = Math.max(0, Math.min(1, (ax * dx + ay * dy + az * dz) / L2));
    const r = (q.r0 ?? 1) + ((q.r1 ?? q.r0 ?? 1) - (q.r0 ?? 1)) * t;
    const ex = ax - dx * t, ey = ay - dy * t, ez = az - dz * t;
    return Math.sqrt(ex * ex + ey * ey + ez * ez) - r;
  }
  const c = q.c!, r = q.r!;
  let vx = px - c[0], vy = py - c[1], vz = pz - c[2];
  if (q.rot) {
    // inverse XYZ euler
    let cc = Math.cos(-q.rot[0]), s = Math.sin(-q.rot[0]);
    [vy, vz] = [vy * cc - vz * s, vy * s + vz * cc];
    cc = Math.cos(-q.rot[1]);
    s = Math.sin(-q.rot[1]);
    [vx, vz] = [vx * cc + vz * s, -vx * s + vz * cc];
    cc = Math.cos(-q.rot[2]);
    s = Math.sin(-q.rot[2]);
    [vx, vy] = [vx * cc - vy * s, vx * s + vy * cc];
  }
  const ax = vx / r[0], ay = vy / r[1], az = vz / r[2];
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / r[0], by = ay / r[1], bz = az / r[2];
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz) || 1e-6;
  return (k0 * (k0 - 1)) / k1;
}
/**
 * Smooth union of prims (sub prims carve smoothly), culled per primitive. disp > 0
 * pushes the surface in. col may return null to skip a cell.
 */
export function fblob(m: VoxelModel, prims: Prim[], col: (x: number, y: number, z: number) => number | null, o: { k: number; disp?: (x: number, y: number, z: number) => number; keep?: (x: number, y: number, z: number) => boolean; fl?: number; inner?: number; innerDepth?: number }) {
  const pad = o.k + 4;
  const box = prims.map((q) => {
    if (q.a && q.b) {
      const R = Math.max(q.r0 ?? 1, q.r1 ?? 1) + pad;
      return [Math.min(q.a[0], q.b[0]) - R, Math.min(q.a[1], q.b[1]) - R, Math.min(q.a[2], q.b[2]) - R, Math.max(q.a[0], q.b[0]) + R, Math.max(q.a[1], q.b[1]) + R, Math.max(q.a[2], q.b[2]) + R];
    }
    const R = Math.max(q.r![0], q.r![1], q.r![2]) + pad;
    return [q.c![0] - R, q.c![1] - R, q.c![2] - R, q.c![0] + R, q.c![1] + R, q.c![2] + R];
  });
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  box.forEach((b, i) => {
    if (prims[i].sub) return;
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], b[a]);
      hi[a] = Math.max(hi[a], b[a + 3]);
    }
  });
  for (let i = Math.floor(lo[0]); i <= Math.ceil(hi[0]); i++)
    for (let j = Math.floor(lo[1]); j <= Math.ceil(hi[1]); j++)
      for (let kk = Math.floor(lo[2]); kk <= Math.ceil(hi[2]); kk++) {
        const x = i + 0.5, y = j + 0.5, z = kk + 0.5;
        let d = 1e9;
        let first = true;
        for (let p = 0; p < prims.length; p++) {
          const b = box[p];
          if (x < b[0] || y < b[1] || z < b[2] || x > b[3] || y > b[4] || z > b[5]) continue;
          const q = prims[p];
          const di = primSdf(q, x, y, z);
          if (q.sub) {
            if (!first) d = smax(d, -di, q.k ?? o.k);
          } else if (first) {
            d = di;
            first = false;
          } else d = smin(d, di, q.k ?? o.k);
        }
        if (first || d > 2.5) continue;
        if (o.keep && !o.keep(i, j, kk)) continue;
        if (o.inner !== undefined && d < -(o.innerDepth ?? 3.5) - 1) {
          // deep inside: never seen (cut faces show one flat colour, which also meshes cheaply)
          m.set(i, j, kk, o.inner, o.fl);
          continue;
        }
        if (o.disp) d += o.disp(x, y, z);
        if (d > 0) continue;
        const c = o.inner !== undefined && d < -(o.innerDepth ?? 3.5) ? o.inner : col(i, j, kk);
        if (c !== null) m.set(i, j, kk, c, o.fl);
      }
  return m;
}

const N6: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/**
 * Cut a mass into parts: `assign` names the part of each cell. `plugs` copies deep
 * interior cells of a parent region near a cut into the child (`near(x, y, z)`),
 * so the joint never opens a gap as the child bends.
 */
export function splitMany(src: VoxelModel, parts: Record<string, VoxelModel>, assign: (x: number, y: number, z: number) => string, plugs: { from: string; to: string; near: (x: number, y: number, z: number) => boolean }[] = []) {
  src.forEach((x, y, z, c, f) => {
    const p = assign(x, y, z);
    parts[p]?.set(x, y, z, c, f);
    for (const pl of plugs) {
      if (pl.from !== p || !pl.near(x, y, z)) continue;
      let inner = true;
      for (const [dx, dy, dz] of N6) if (!src.has(x + dx * 2, y + dy * 2, z + dz * 2) || !src.has(x + dx, y + dy, z + dz)) inner = false;
      if (inner) parts[pl.to]?.set(x, y, z, c, f);
    }
  });
}

/**
 * Carve a groove (skin fold, scute seam) where `dist(x, y, z)` (signed, voxels)
 * crosses zero on the surface: `depth` passes of 1 cell; then shade the rims
 * (`behind` for dist < 0, `front` for dist > 0) within `rim` cells.
 */
export function groove(m: VoxelModel, dist: (x: number, y: number, z: number) => number, o: { depth?: number; width?: number; rim?: number; region?: (x: number, y: number, z: number) => boolean; floor?: (c: number) => number; behind?: (c: number) => number; front?: (c: number) => number; cand?: V3[]; lip?: number; lipCol?: (c: number) => number }) {
  const depth = o.depth ?? 2, width = o.width ?? 0.55, rim = o.rim ?? 1.8;
  let cand = o.cand;
  if (!cand) {
    cand = [];
    const cc = cand;
    m.forEach((x, y, z) => {
      if (exposed(m, x, y, z)) cc.push([x, y, z]);
    });
  }
  // only surface cells close to the groove surface matter
  let work = cand.filter(([x, y, z]) => Math.abs(dist(x + 0.5, y + 0.5, z + 0.5)) < rim + width + 1 && (!o.region || o.region(x, y, z)));
  for (let p = 0; p < depth; p++) {
    const del: V3[] = [];
    for (const [x, y, z] of work) {
      if (!m.has(x, y, z) || !exposed(m, x, y, z)) continue;
      if (Math.abs(dist(x + 0.5, y + 0.5, z + 0.5)) < width) del.push([x, y, z]);
    }
    for (const [x, y, z] of del) m.del(x, y, z);
    const next: V3[] = [];
    for (const [x, y, z] of del) for (const [dx, dy, dz] of N6) if (m.has(x + dx, y + dy, z + dz)) next.push([x + dx, y + dy, z + dz]);
    work = work.concat(next);
  }
  const seen = new Set<number>();
  const rep: [number, number, number, number, number][] = [];
  for (const [x, y, z] of work) {
    const key = ((x + 512) << 20) | ((y + 512) << 10) | (z + 512);
    if (seen.has(key)) continue;
    seen.add(key);
    const v = m.get(x, y, z);
    if (v === undefined || !exposed(m, x, y, z)) continue;
    const c = v & 0xffffff, f = v >>> 24;
    const d = dist(x + 0.5, y + 0.5, z + 0.5);
    if (Math.abs(d) > rim + width) continue;
    if (Math.abs(d) < width + 0.6 && o.floor) rep.push([x, y, z, o.floor(c), f]);
    else if (d < 0 && o.behind) rep.push([x, y, z, o.behind(c), f]);
    else if (d > 0 && o.front) rep.push([x, y, z, o.front(c), f]);
  }
  for (const [x, y, z, c, f] of rep) m.set(x, y, z, c, f || VF.SOLID);
  // a raised lip on the front side: the overlapping flap of hide that casts the fold's shadow
  if (o.lip) {
    const add: [number, number, number, number][] = [];
    for (const key of seen) {
      const x = ((key >>> 20) & 1023) - 512, y = ((key >>> 10) & 1023) - 512, z = (key & 1023) - 512;
      const v = m.get(x, y, z);
      if (v === undefined) continue;
      const d = dist(x + 0.5, y + 0.5, z + 0.5);
      if (d <= width + 0.2 || d > width + o.lip) continue;
      for (const [dx, dy, dz] of N6) {
        if (m.has(x + dx, y + dy, z + dz) || dy < 0) continue;
        const dn = dist(x + dx + 0.5, y + dy + 0.5, z + dz + 0.5);
        if (dn <= width + 0.3) continue;
        const c = v & 0xffffff;
        add.push([x + dx, y + dy, z + dz, o.lipCol ? o.lipCol(c) : c]);
      }
    }
    for (const [x, y, z, c] of add) m.set(x, y, z, c);
  }
  return m;
}

/** exposed cells of a model (candidate list for groove()) */
export function surfaceCells(m: VoxelModel) {
  const out: V3[] = [];
  m.forEach((x, y, z) => {
    if (exposed(m, x, y, z)) out.push([x, y, z]);
  });
  return out;
}

/**
 * Drop a child part's cells that lie deep inside its parent (at least `depth`
 * cells in from the parent's surface): they can never be seen, and a buried
 * capsule end costs as many triangles as a visible one.
 */
export function cullBuried(child: VoxelModel, parent: VoxelModel, depth = 3) {
  const del: V3[] = [];
  child.forEach((x, y, z) => {
    if (!parent.has(x, y, z)) return;
    for (let d = 1; d <= depth; d++) for (const [dx, dy, dz] of N6) if (!parent.has(x + dx * d, y + dy * d, z + dz * d)) return;
    del.push([x, y, z]);
  });
  for (const [x, y, z] of del) child.del(x, y, z);
  return child;
}

/** re-grid a model at 2x resolution (each cell becomes 2x2x2; exact same shape) */
export function upsample2(src: VoxelModel, dst = new VoxelModel(src.name)) {
  src.forEach((x, y, z, c, f) => {
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let d = 0; d < 2; d++) dst.set(x * 2 + a, y * 2 + b, z * 2 + d, c, f);
  });
  return dst;
}

/** quick membrane: fill the triangle (a, b, c) with a 1-cell sheet */
export function tri(m: VoxelModel, a: V3, b: V3, c: V3, col: (u: number, v: number, x: number, y: number, z: number) => number | null, fl?: number, step = 0.45) {
  const lab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), lac = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const n1 = Math.max(2, Math.ceil(lab / step)), n2 = Math.max(2, Math.ceil(lac / step));
  for (let i = 0; i <= n1; i++)
    for (let j = 0; j <= n2; j++) {
      const u = i / n1, v = j / n2;
      if (u + v > 1) continue;
      const x = Math.floor(a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v);
      const y = Math.floor(a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v);
      const z = Math.floor(a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v);
      const cc = col(u, v, x, y, z);
      if (cc !== null) m.set(x, y, z, cc, fl);
    }
  return m;
}

export { VF };
