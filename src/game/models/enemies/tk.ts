// Enemy toon kit (STYLE v2): a rig builder that sculpts every part in one shared
// rig space, plus clean shape helpers (rounded boxes, ellipsoids, capsules,
// stepped profiles) and a hand-style 3-tone shading pass. No noise anywhere.
//
// Coordinates are voxel INDICES in rig space: origin on the ground, faces +Z,
// left = +X. Column x = 0 is the centre column, so a shape symmetric in x spans
// -n..n. Mesh-space symmetry plane is x = 0.5, so centred pivots use x = 0.5 and
// mirroring maps index x -> -x and pivot px -> 1 - px.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, V3, PartSpec, SocketSpec } from '../../../engine/voxel/Rig';
import { TOON, Ramp, bevelBox } from '../style';

export { VoxelModel, VF, TOON, bevelBox };
export type { Ramp, V3, RigSpec };

export interface EnemyOpts {
  alpha?: boolean;
  variant?: number;
}

interface TPart {
  name: string;
  parent?: string;
  pivot: V3;
  rest?: V3;
  model: VoxelModel;
}

const LR = /_l(\d*)$/;

export class TRig {
  parts: TPart[] = [];
  sockets: Record<string, SocketSpec> = {};
  constructor(public name: string, public voxelSize: number) {}

  part(name: string, parent: string | undefined, pivot: V3, rest?: V3): VoxelModel {
    const model = new VoxelModel(name);
    this.parts.push({ name, parent, pivot, rest, model });
    return model;
  }
  m(name: string): VoxelModel {
    const p = this.parts.find((q) => q.name === name);
    if (!p) throw new Error(`[${this.name}] no part ${name}`);
    return p.model;
  }
  has(name: string) {
    return this.parts.some((q) => q.name === name);
  }
  pivot(name: string): V3 {
    const p = this.parts.find((q) => q.name === name);
    if (!p) throw new Error(`[${this.name}] no part ${name}`);
    return p.pivot;
  }
  socket(name: string, part: string, at: V3, rot?: V3) {
    this.sockets[name] = { part, at, rot };
  }
  /** mirror every `*_l` / `*_lN` part (and socket) to the right side unless it already exists */
  mirrorLR() {
    const add: TPart[] = [];
    for (const p of this.parts) {
      if (!LR.test(p.name)) continue;
      const rn = p.name.replace(LR, '_r$1');
      if (this.has(rn)) continue;
      const m = new VoxelModel(rn);
      p.model.forEach((x, y, z, c, f) => m.set(-x, y, z, c, f));
      const parent = p.parent && LR.test(p.parent) ? p.parent.replace(LR, '_r$1') : p.parent;
      add.push({ name: rn, parent, pivot: [1 - p.pivot[0], p.pivot[1], p.pivot[2]], rest: p.rest ? [p.rest[0], -p.rest[1], -p.rest[2]] : undefined, model: m });
    }
    this.parts.push(...add);
    for (const [k, s] of Object.entries({ ...this.sockets })) {
      if (!LR.test(k)) continue;
      const rk = k.replace(LR, '_r$1');
      if (this.sockets[rk]) continue;
      const part = LR.test(s.part) ? s.part.replace(LR, '_r$1') : s.part;
      this.sockets[rk] = { part, at: [1 - s.at[0], s.at[1], s.at[2]], rot: s.rot ? [s.rot[0], -s.rot[1], -s.rot[2]] : undefined };
    }
    return this;
  }
  build(meta: Record<string, any> = {}): RigSpec {
    const parts: PartSpec[] = this.parts.map((p) => ({
      name: p.name,
      model: p.model,
      pivot: p.pivot,
      parent: p.parent,
      attach: [p.pivot[0], p.pivot[1], p.pivot[2]],
      rest: p.rest,
    }));
    for (const p of parts) if (p.model.count === 0) p.model.set(Math.floor(p.pivot[0]), Math.floor(p.pivot[1]), Math.floor(p.pivot[2]), TOON.socket.base);
    return { name: this.name, voxelSize: this.voxelSize, parts, sockets: this.sockets, meta };
  }
}

// ---------------------------------------------------------------------------
// clean shapes (all symmetric-friendly, deterministic)
// ---------------------------------------------------------------------------
type Col = number;

/**
 * rounded box: corners/edges rounded with radius r (voxels) on the axes in `axes`
 * ('xyz' = all, 'xz' = vertical prism with rounded vertical edges, ...)
 */
export function rbox(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: Col, r = 2, axes = 'xyz', flags?: number) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const hx = (x1 - x0 + 1) / 2, hy = (y1 - y0 + 1) / 2, hz = (z1 - z0 + 1) / 2;
  const ax = axes.includes('x'), ay = axes.includes('y'), az = axes.includes('z');
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const ux = ax ? Math.max(0, Math.abs(x - cx) - (hx - r)) : 0;
        const uy = ay ? Math.max(0, Math.abs(y - cy) - (hy - r)) : 0;
        const uz = az ? Math.max(0, Math.abs(z - cz) - (hz - r)) : 0;
        if (ux * ux + uy * uy + uz * uz > r * r + 0.01) continue;
        m.set(x, y, z, col, flags);
      }
  return m;
}

/** ellipsoid around a (possibly half-voxel) centre */
export function ell(m: VoxelModel, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, col: Col, flags?: number, clip?: (x: number, y: number, z: number) => boolean) {
  for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
        if (d > 1.0001) continue;
        if (clip && !clip(x, y, z)) continue;
        m.set(x, y, z, col, flags);
      }
  return m;
}
export function carveEll(m: VoxelModel, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) {
  for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1.0001) m.del(x, y, z);
  return m;
}

/** capsule between two points (voxel centres within r of the segment) */
export function seg(m: VoxelModel, a: V3, b: V3, r: number, col: Col, flags?: number, r1?: number) {
  const rr1 = r1 ?? r;
  const R = Math.max(r, rr1);
  const lo = [Math.min(a[0], b[0]) - R, Math.min(a[1], b[1]) - R, Math.min(a[2], b[2]) - R];
  const hi = [Math.max(a[0], b[0]) + R, Math.max(a[1], b[1]) + R, Math.max(a[2], b[2]) + R];
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  for (let x = Math.floor(lo[0]); x <= Math.ceil(hi[0]); x++)
    for (let y = Math.floor(lo[1]); y <= Math.ceil(hi[1]); y++)
      for (let z = Math.floor(lo[2]); z <= Math.ceil(hi[2]); z++) {
        const t = Math.max(0, Math.min(1, ((x - a[0]) * d[0] + (y - a[1]) * d[1] + (z - a[2]) * d[2]) / L2));
        const px = a[0] + d[0] * t - x, py = a[1] + d[1] * t - y, pz = a[2] + d[2] * t - z;
        const rad = r + (rr1 - r) * t;
        if (px * px + py * py + pz * pz <= rad * rad + 0.01) m.set(x, y, z, col, flags);
      }
  return m;
}

/** chain of capsules through points with per-point radius */
export function chain(m: VoxelModel, pts: V3[], radii: number[], col: Col, flags?: number) {
  for (let i = 0; i < pts.length - 1; i++) seg(m, pts[i], pts[i + 1], radii[i], col, flags, radii[i + 1]);
  return m;
}

/**
 * stacked profile: for each y in [y0, y1] a rectangle x in [-w, w], z in [z0, z1]
 * with its 4 vertical corners chamfered by `cut` voxels. prof(y) returns null to skip.
 */
export function stack(m: VoxelModel, y0: number, y1: number, prof: (y: number) => { w: number; z0: number; z1: number; cut?: number; xc?: number } | null, col: Col | ((x: number, y: number, z: number) => Col), flags?: number) {
  for (let y = y0; y <= y1; y++) {
    const p = prof(y);
    if (!p) continue;
    const xc = p.xc ?? 0;
    const cut = p.cut ?? 0;
    for (let x = xc - p.w; x <= xc + p.w; x++)
      for (let z = p.z0; z <= p.z1; z++) {
        const dx = Math.min(x - (xc - p.w), xc + p.w - x), dz = Math.min(z - p.z0, p.z1 - z);
        if (dx + dz < cut) continue;
        m.set(x, y, z, typeof col === 'number' ? col : col(x, y, z), flags);
      }
  }
  return m;
}

/** paint every existing voxel that satisfies pred */
export function paint(m: VoxelModel, pred: (x: number, y: number, z: number) => boolean, col: Col, flags?: number) {
  const hits: [number, number, number, number][] = [];
  m.forEach((x, y, z, _c, f) => {
    if (pred(x, y, z)) hits.push([x, y, z, flags ?? f]);
  });
  for (const [x, y, z, f] of hits) m.set(x, y, z, col, f || VF.SOLID);
  return m;
}

/** paint only voxels that are exposed on some side (surface details on a solid) */
export function paintSurf(m: VoxelModel, pred: (x: number, y: number, z: number) => boolean, col: Col, flags?: number) {
  return paint(m, (x, y, z) => pred(x, y, z) && (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z) || !m.has(x, y - 1, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1)), col, flags);
}

/**
 * Hand-style 3-tone shading for the given ramps: a voxel of a ramp's base colour
 * becomes `shade` when its underside is open and it has material above (the
 * bottom layer of a form), and `hi` when its top is open and it sits on an
 * outer edge (top rim). One-voxel-thin plates keep base underneath.
 */
export function toonShade(m: VoxelModel, ramps: Ramp[], opts: { hi?: boolean; under?: boolean } = {}) {
  const hi = opts.hi ?? true, under = opts.under ?? true;
  const map = new Map<number, Ramp>();
  for (const r of ramps) map.set(r.base & 0xffffff, r);
  const todo: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    const r = map.get(c);
    if (!r) return;
    const up = m.has(x, y + 1, z), dn = m.has(x, y - 1, z);
    if (under && !dn && up) todo.push([x, y, z, r.shade, f]);
    else if (hi && !up && (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1))) todo.push([x, y, z, r.hi, f]);
  });
  for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f || VF.SOLID);
  return m;
}

/** remove voxels fully enclosed by their 26 neighbours (keeps the surface + AO intact) */
export function hollow(m: VoxelModel) {
  const del: [number, number, number][] = [];
  m.forEach((x, y, z) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (!m.has(x + a, y + b, z + c)) return;
    del.push([x, y, z]);
  });
  for (const [x, y, z] of del) m.del(x, y, z);
  return m;
}

// ---------------------------------------------------------------------------
// faces
// ---------------------------------------------------------------------------
/**
 * Carve a square eye socket into `face` (1 voxel deep, dark back wall) and add the
 * eye plug part `eye_l` (left side, +X) whose pivot is the socket centre on the face
 * surface, +Z out. Call mirrorLR() later for eye_r. x0..x1/y0..y1 = left socket
 * extent; zf = the front voxel layer of the face at that spot.
 */
export function eyeSocket(rig: TRig, headPart: string, x0: number, x1: number, y0: number, y1: number, zf: number, opts: { depth?: number; wall?: number; mirror?: boolean } = {}) {
  const face = rig.m(headPart);
  const depth = opts.depth ?? 1;
  const wall = opts.wall ?? TOON.socket.base;
  for (const s of opts.mirror === false ? [1] : [1, -1]) {
    const xa = s > 0 ? x0 : -x1, xb = s > 0 ? x1 : -x0;
    for (let x = xa; x <= xb; x++)
      for (let y = y0; y <= y1; y++) {
        for (let d = 0; d < depth; d++) face.del(x, y, zf - d);
        face.set(x, y, zf - depth, wall);
      }
  }
  const eye = rig.part('eye_l', headPart, [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, zf + 1]);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let d = 0; d < depth; d++) eye.set(x, y, zf - d, TOON.socket.dark);
  return eye;
}

/** standard boss expression set (jaw angle + brow z-angles; eyes are engine-drawn 2D) */
export function bossExpressions(jawOpen = 0.45) {
  const j = jawOpen;
  return {
    neutral: { jaw: 0, brow: [0, 0] },
    angry: { jaw: j * 0.25, brow: [0.4, -0.4] },
    enraged: { jaw: j, brow: [0.55, -0.55] },
    hurt: { jaw: j * 0.5, brow: [-0.35, 0.35] },
    laugh: { jaw: j * 0.8, brow: [-0.2, 0.2] },
    smug: { jaw: j * 0.1, brow: [0.15, 0.25] },
    stunned: { jaw: j * 0.6, brow: [-0.25, 0.1] },
    defeated: { jaw: j * 0.7, brow: [-0.45, 0.45] },
  } as Record<string, { jaw: number; brow: [number, number] }>;
}

/** small helpers */
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function pick<T>(arr: T[], v: number): T {
  return arr[((v % arr.length) + arr.length) % arr.length];
}
