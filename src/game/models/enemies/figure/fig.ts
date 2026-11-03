// Figure kit: every humanoid enemy is dressed on Sundown's bare skeleton figure.
// The bones are IMPORTED from characters/skeleton.ts (skeletonFigure / figureRig),
// never copied, so every humanoid keeps Sundown's part names, joint pivots,
// hierarchy, proportions and 1/36 grid, and the procedural animation fits all.
//
// COORDINATES: geometric voxel coords of the shared rig space (voxel i spans
// [i, i+1)), origin on the ground between the feet, faces +Z, LEFT = +X. The
// mirror plane is x = 0: a geometric x mirrors to -x, a voxel index i to -1 - i.
// Sculptors are real/sculpt.ts `Sc` objects with vs = 1, so every Sc / rk
// primitive takes geometric voxel coords directly.
import { skeletonFigure, figureRig, SUNDOWN_VS } from '../../characters/skeleton';
import type { SkeletonFigure } from '../../characters/skeleton';
import type { RigSpec, V3, SocketSpec } from '../../../../engine/voxel/Rig';
import { VoxelModel, VF, mix, mulRGB } from '../../../../engine/voxel/VoxelModel';
import type { CSpec, ColorFn } from '../../../../engine/voxel/VoxelModel';
import { hash3, noise } from '../../../../engine/math/rand';
import { Sc } from '../real/sculpt';
import { ell, cap, tube } from '../real/rk';
import { defaultExpressions } from '../../toon/humanoid';

export { VoxelModel, VF, mix, mulRGB, hash3, noise, Sc, ell, cap, tube };
export type { V3, CSpec, ColorFn, RigSpec };
export type G = [number, number, number];

export const FIG_VS = SUNDOWN_VS;
export const ENEMY_EXPR = ['neutral', 'angry', 'hurt', 'surprised', 'laugh', 'dead', 'stunned'];

const res = (c: CSpec, x: number, y: number, z: number) => (typeof c === 'number' ? c : c(x, y, z));
const N6: G[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// ============================================================================ the dressed figure
export class Fig {
  readonly vs = SUNDOWN_VS;
  readonly fig: SkeletonFigure;
  /** Sundown's joints (geometric voxel coords; `<name>_r` = mirrored right side) */
  readonly J: Record<string, V3>;
  /** pristine copies of the bare bones (bone show-through, restoring exposed bone) */
  readonly bone: Record<string, VoxelModel> = {};
  private scs = new Map<string, Sc>();
  constructor() {
    this.fig = skeletonFigure();
    this.J = this.fig.joints;
    for (const [n, p] of Object.entries(this.fig.parts)) this.bone[n] = p.model.clone();
  }
  has(n: string) {
    return !!this.fig.parts[n];
  }
  m(n: string): VoxelModel {
    const p = this.fig.parts[n];
    if (!p) throw new Error(`figure has no part ${n}`);
    return p.model;
  }
  pivot(n: string): V3 {
    return this.fig.parts[n].pivot;
  }
  /** geometric-voxel sculptor over a part */
  s(n: string): Sc {
    const m = this.m(n);
    let s = this.scs.get(n);
    if (!s || s.m !== m) {
      s = new Sc(m, 1);
      this.scs.set(n, s);
    }
    return s;
  }
  /** add a new part (pivot == attach, shared rig space) */
  part(name: string, parent: string | undefined, pivot: V3): Sc {
    this.fig.parts[name] = { model: new VoxelModel(name), pivot: [...pivot] as V3, parent };
    this.scs.delete(name);
    return this.s(name);
  }
  setModel(n: string, m: VoxelModel) {
    this.fig.parts[n].model = m;
    this.scs.delete(n);
  }
  remove(n: string) {
    delete this.fig.parts[n];
    this.scs.delete(n);
  }
  /** replace `dst`'s model with the mirror image of `src` (x -> -1 - x); dst keeps its own pivot */
  mirror(src: string, dst: string) {
    const o = new VoxelModel(dst);
    this.m(src).forEach((x, y, z, c, f) => o.set(-1 - x, y, z, c, f));
    if (!this.fig.parts[dst]) {
      const p = this.fig.parts[src];
      const par = p.parent && /_l$/.test(p.parent) ? p.parent.replace(/_l$/, '_r') : p.parent;
      this.fig.parts[dst] = { model: o, pivot: [-p.pivot[0], p.pivot[1], p.pivot[2]], parent: par };
    } else this.fig.parts[dst].model = o;
    this.scs.delete(dst);
  }
  /** mirrored copy of the bare left bone part (e.g. the open left hand for a right claw) */
  boneMirror(src: string, dst: string) {
    const o = new VoxelModel(dst);
    this.bone[src].forEach((x, y, z, c, f) => o.set(-1 - x, y, z, c, f));
    this.setModel(dst, o);
  }
  sock(name: string, part: string, at: V3, rot?: V3) {
    this.fig.sockets[name] = { part, at: [...at] as V3, rot } as SocketSpec;
  }
  build(name: string, meta: Record<string, any> = {}): RigSpec {
    const exprs = meta.expressions ?? defaultExpressions(ENEMY_EXPR);
    return figureRig(this.fig, name, { ...meta, expressions: exprs, look: undefined, cloth: meta.cloth });
  }
}

// ============================================================================ geometry helpers
/** voxels of a model that touch air */
export function isSurf(m: VoxelModel, x: number, y: number, z: number) {
  for (const [dx, dy, dz] of N6) if (!m.has(x + dx, y + dy, z + dz)) return true;
  return false;
}
/** repaint surface voxels where pred(voxel centre, geometric) holds */
export function coatG(s: Sc, pred: (x: number, y: number, z: number) => boolean, col: CSpec, fl?: number, surfaceOnly = true) {
  const m = s.m;
  const todo: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, _c, f) => {
    if (!pred(x + 0.5, y + 0.5, z + 0.5)) return;
    if (surfaceOnly && !isSurf(m, x, y, z)) return;
    const cc = res(col, x, y, z);
    if (cc !== null) todo.push([x, y, z, cc, fl ?? f]);
  });
  for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f);
}
/** remove voxels where pred(voxel centre) holds */
export function cutG(s: Sc, pred: (x: number, y: number, z: number) => boolean) {
  const del: G[] = [];
  s.m.forEach((x, y, z) => pred(x + 0.5, y + 0.5, z + 0.5) && del.push([x, y, z]));
  for (const [x, y, z] of del) s.m.del(x, y, z);
}
/** copy voxels of `src` into `dst` where pred holds (bone restoring) */
export function copyWhere(src: VoxelModel, dst: VoxelModel, pred: (x: number, y: number, z: number, c: number) => boolean, col?: CSpec) {
  src.forEach((x, y, z, c, f) => {
    if (!pred(x + 0.5, y + 0.5, z + 0.5, c)) return;
    const cc = col === undefined ? c : res(col, x, y, z);
    if (cc !== null) dst.set(x, y, z, cc, f);
  });
}
/** set a voxel only where empty */
export function addIfEmpty(m: VoxelModel, x: number, y: number, z: number, c: number, f?: number) {
  if (!m.has(x, y, z)) m.set(x, y, z, c, f);
}
/**
 * Organic body section stack: for every voxel row y0..y1 fills a superellipse
 * cross-section from sec(y) = { a: half width, f: front z, b: back z, cx?, p? }.
 * Used for torsos, pelvises, wrapped bodies.
 */
export function sections(s: Sc, y0: number, y1: number, sec: (y: number) => { a: number; f: number; b: number; cx?: number; p?: number } | null, col: CSpec, fl?: number) {
  for (let y = y0; y <= y1; y++) {
    const q = sec(y + 0.5);
    if (!q) continue;
    const p = q.p ?? 2.2;
    const zc = (q.f + q.b) / 2, zr = (q.f - q.b) / 2, cx = q.cx ?? 0;
    for (let x = Math.floor(cx - q.a) - 1; x <= Math.ceil(cx + q.a) + 1; x++)
      for (let z = Math.floor(q.b) - 1; z <= Math.ceil(q.f) + 1; z++) {
        const u = Math.abs(x + 0.5 - cx) / q.a, v = Math.abs(z + 0.5 - zc) / zr;
        if (Math.pow(u, p) + Math.pow(v, p) > 1) continue;
        const c = res(col, x, y, z);
        if (c !== null) s.m.set(x, y, z, c, fl);
      }
  }
}
/** tapered limb with a muscle-belly profile from a to b: r(t) (t 0 at a) */
export function limbG(s: Sc, a: G, b: G, r: (t: number) => number, col: CSpec, fl?: number, steps = 0) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = steps || Math.max(2, Math.ceil(L * 2));
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const p0: G = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2] + (b[2] - a[2]) * t0];
    const p1: G = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2] + (b[2] - a[2]) * t1];
    cap(s, p0, p1, Math.max(0.5, r(t0)), Math.max(0.5, r(t1)), col, fl);
  }
}
/** single-voxel polyline (cords, straps, threads) */
export function lineG(s: Sc, pts: G[], col: CSpec | ((t: number) => CSpec), fl?: number) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(len * 2));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      const cc = typeof col === 'function' && col.length <= 1 ? (col as (t: number) => CSpec)((acc + len * t) / (total || 1)) : (col as CSpec);
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      const c = res(cc, xi, yi, zi);
      if (c !== null) s.m.set(xi, yi, zi, c, fl);
    }
    acc += len;
  }
}
/** curved horn / spike / claw from base along dir with curl (geometric voxels) */
export function hornG(s: Sc, base: G, dir: G, len: number, r: number, col: CSpec, curl: G = [0, 0, 0], ridge?: CSpec) {
  let d = norm(dir);
  const n = Math.max(3, Math.ceil(len * 1.6));
  let p: G = [...base];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const rr = Math.max(0.5, r * (1 - t * 0.92));
    ell(s, p, [rr, rr, rr], ridge !== undefined && k % 3 === 0 && t < 0.75 ? ridge : col);
    p = [p[0] + (d[0] * len) / n, p[1] + (d[1] * len) / n, p[2] + (d[2] * len) / n];
    d = norm([d[0] + curl[0] / n, d[1] + curl[1] / n, d[2] + curl[2] / n]);
  }
  return p;
}
export const norm = (v: G): G => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** frayed hanging strips: columns x0..x1 at depth z, top yTop, ragged lengths (voxel columns) */
export function frayStrip(s: Sc, x0: number, x1: number, z: number, yTop: number, minL: number, maxL: number, col: CSpec, seed = 0, bulge?: (y: number) => number) {
  for (let x = x0; x <= x1; x++) {
    const h = hash3(x * 3 + seed, seed * 7, z), h2 = hash3(x, seed, 9);
    const len = Math.round(minL + (maxL - minL) * (h * 0.7 + h2 * 0.3));
    for (let i = 0; i < len; i++) {
      const y = yTop - i;
      const zz = z + (bulge ? Math.round(bulge(y)) : 0);
      const c = res(col, x, y, zz) as number;
      // thread ends are a shade darker and sometimes split
      s.m.set(x, y, zz, i === len - 1 ? mulRGB(c, 0.86) : c);
    }
    if (h2 > 0.62) s.m.set(x, yTop - len, z + (bulge ? Math.round(bulge(yTop - len)) : 0), mulRGB(res(col, x, yTop - len, z) as number, 0.8));
  }
}
/** same, strips running along z at a fixed x */
export function frayStripZ(s: Sc, z0: number, z1: number, x: number, yTop: number, minL: number, maxL: number, col: CSpec, seed = 0) {
  for (let z = z0; z <= z1; z++) {
    const h = hash3(seed, z * 5 + seed, x), h2 = hash3(z, seed, 11);
    const len = Math.round(minL + (maxL - minL) * (h * 0.7 + h2 * 0.3));
    for (let i = 0; i < len; i++) {
      const c = res(col, x, yTop - i, z) as number;
      s.m.set(x, yTop - i, z, i === len - 1 ? mulRGB(c, 0.86) : c);
    }
  }
}
/** twisted rope through points (2 tones), optional closed loop */
export function ropeG(s: Sc, pts: G[], cols: [number, number], closed = false, thick = 0.62) {
  const path = closed ? [...pts, pts[0], pts[1]] : pts;
  const tw = (x: number, y: number, z: number) => (((x + y * 2 + z) % 4) + 4) % 4 < 2 ? cols[0] : cols[1];
  tube(s, path, () => thick, tw);
}
/** ellipse points (xz plane at height y) */
export function loopXZ(c: G, rx: number, rz: number, n = 28, wob = 0.03, seed = 0): G[] {
  const out: G[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 1 + (hash3(i, seed, 3) - 0.5) * wob * 2;
    out.push([c[0] + Math.sin(a) * rx * w, c[1] + (hash3(i, seed, 7) - 0.5) * 0.5, c[2] + Math.cos(a) * rz * w]);
  }
  return out;
}
/** wrap a band (shell) around existing voxels of a part between y0..y1: every empty neighbour of a solid voxel gets cloth */
export function wrapShell(s: Sc, y0: number, y1: number, col: CSpec, pred: (x: number, y: number, z: number) => boolean = () => true, fl?: number) {
  const m = s.m;
  const add: [number, number, number, number][] = [];
  m.forEach((x, y, z) => {
    if (y < y0 || y > y1) return;
    for (const [dx, dy, dz] of N6) {
      if (dy !== 0) continue;
      const X = x + dx, Z = z + dz;
      if (m.has(X, y, Z) || !pred(X + 0.5, y + 0.5, Z + 0.5)) continue;
      const c = res(col, X, y, Z);
      if (c !== null) add.push([X, y, Z, c]);
    }
  });
  for (const [x, y, z, c] of add) m.set(x, y, z, c, fl);
}

// ============================================================================ materials (cel friendly: broad patches, no speckle)
/** three broad tone patches; cell in voxels */
export function tones(dark: number, base: number, light: number, cell = 4, seed = 0, lo = -0.36, hi = 0.36): ColorFn {
  return (x, y, z) => {
    const n = noise.n3(x / cell + seed * 1.7, y / cell - seed * 0.9, z / cell + seed * 2.3);
    return n < lo ? dark : n > hi ? light : base;
  };
}
/** desiccated leathery hide: broad tonal patches, darker creases, a sparse crack network */
export function hide(base: number, seed = 0, o: { cell?: number; crack?: number; crackCol?: number; light?: number; dark?: number } = {}): ColorFn {
  const cell = o.cell ?? 5.5;
  const dark = o.dark ?? mix(base, 0x24170e, 0.17);
  const light = o.light ?? mix(base, 0xc8a47a, 0.14);
  const crackCol = o.crackCol ?? mix(base, 0x140c08, 0.42);
  const thr = o.crack ?? 0.013;
  return (x, y, z) => {
    const n = noise.n3(x / cell + seed * 3.1, y / (cell * 1.3) - seed, z / cell + seed * 0.7);
    const k = noise.n3(x / 3.1 - seed, y / 3.4 + seed * 2.1, z / 3.1 + 4.7);
    if (Math.abs(k) < thr) return crackCol;
    return n < -0.4 ? dark : n > 0.42 ? light : base;
  };
}
/** weathered bone: ivory with broad grime patches and the odd hairline crack */
export function agedBone(base = 0xe2cfa6, seed = 0, grime = 0x9a8058): ColorFn {
  return (x, y, z) => {
    const n = noise.n3(x / 3.2 + seed, y / 3.6, z / 3.2 - seed);
    const k = noise.n3(x / 1.9 + seed * 2, y / 1.9, z / 1.9);
    if (Math.abs(k) < 0.035) return mix(base, grime, 0.75);
    return n < -0.3 ? mix(base, grime, 0.45) : n > 0.42 ? mix(base, 0xfff4dc, 0.35) : base;
  };
}
/** woven cloth with soft folds running along y (period in voxels) */
export function clothC(base: number, seed = 0, o: { fold?: number; crease?: number; axis?: 'x' | 'z'; stain?: number } = {}): ColorFn {
  const P = o.fold ?? 4;
  const crease = o.crease ?? mix(base, 0x2a2016, 0.3);
  const stain = o.stain ?? mix(base, 0x5a4428, 0.35);
  return (x, y, z) => {
    const a = o.axis === 'z' ? z : x;
    const w = noise.n2(a * 0.21 + seed, y * 0.07 - seed) * P * 0.5;
    const ph = (((a + w) % P) + P) % P;
    const st = noise.n3(x / 4 + seed, y / 4.5, z / 4 - seed);
    if (st < -0.5) return stain;
    if (ph < 0.9) return crease;
    return ph > P - 1.1 ? mix(base, 0xffffff, 0.07) : base;
  };
}
/** leather with broad wear patches + scuffs */
export function leatherC(base: number, seed = 0): ColorFn {
  return (x, y, z) => {
    const n = noise.n3(x / 3 + seed, y / 3.4 - seed, z / 3);
    const k = noise.n3(x / 1.6, y / 1.6 + seed, z / 1.6);
    if (k > 0.62) return mix(base, 0xd8b890, 0.25); // scuff
    return n < -0.35 ? mulRGB(base, 0.82) : n > 0.4 ? mix(base, 0xe0b080, 0.16) : base;
  };
}
/** fur with strands running down (dark roots, lighter tips) */
export function furC(base: number, light: number, dark: number, seed = 0): ColorFn {
  return (x, y, z) => {
    const n = noise.n3(x / 3.4 + seed, y / 5.5, z / 3.4 - seed);
    const s = noise.n3(x / 2.0, y / 4.2 + seed, z / 2.0);
    return s > 0.55 ? light : n < -0.45 || s < -0.62 ? dark : base;
  };
}
/** brushed metal: clean base with crisp highlight rows */
export function metalC(base: number, hi: number, seed = 0): ColorFn {
  return (x, y, z) => ((y + x * 2 + seed) % 5 === 0 ? hi : base);
}

// ============================================================================ finishing
/** gentle sky light on top faces, darker undersides (the renderer adds AO + cel light) */
export function finish(F: Fig, o: { up?: number; down?: number; skip?: string[] } = {}) {
  const up = o.up ?? 1.05, down = o.down ?? 0.86;
  const skip = new Set(o.skip ?? ['eye_l', 'eye_r']);
  for (const [n, p] of Object.entries(F.fig.parts)) {
    if (skip.has(n)) continue;
    const m = p.model;
    const todo: [number, number, number, number, number][] = [];
    m.forEach((x, y, z, c, f) => {
      if (f & (VF.EMISSIVE | VF.GLOW)) return;
      const u = !m.has(x, y + 1, z), d = !m.has(x, y - 1, z);
      if (u === d) return;
      todo.push([x, y, z, mulRGB(c, u ? up : down), f]);
    });
    for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f);
  }
}

/** standard enemy meta on the figure (Sundown's metrics are inherited from the figure) */
export function figMeta(F: Fig, kind: string, o: Record<string, any> = {}) {
  return { kind, eyes: 'voxel', headY: F.J.eye[1] * F.vs, ...o };
}
