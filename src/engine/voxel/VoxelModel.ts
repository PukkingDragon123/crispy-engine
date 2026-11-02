// VoxelModel: a tiny sculpting DSL for building detailed, shaded voxel art in code.
// Shapes accept either a packed color or a color function (x,y,z)=>color|null so
// every voxel can carry its own hand-painted-looking variation (dithering,
// gradients, strata, wear). Values are stored as (flags << 24) | rgb.

import { hash3, noise } from '../math/rand';

export const VF = {
  SOLID: 1,
  EMISSIVE: 2, // glows (adds own color as emission, bloom catches it)
  METAL: 4, // shiny / metallic response
  GLOW: 8, // extra strong emission (eyes, divine runes)
  SOFTAO: 16, // reduced AO darkening (cloth, glass)
} as const;

export type ColorFn = (x: number, y: number, z: number) => number | null;
export type CSpec = number | ColorFn;

const OFF = 512;
const key = (x: number, y: number, z: number) => ((x + OFF) << 20) | ((y + OFF) << 10) | (z + OFF);
export const unkey = (k: number): [number, number, number] => [((k >>> 20) & 1023) - OFF, ((k >>> 10) & 1023) - OFF, (k & 1023) - OFF];

export class VoxelModel {
  map = new Map<number, number>();
  constructor(public name = '') {}

  static pack(rgb: number, flags: number = VF.SOLID) {
    return (((flags | VF.SOLID) & 0x7f) << 24) | (rgb & 0xffffff);
  }

  private resolve(c: CSpec, x: number, y: number, z: number): number | null {
    return typeof c === 'number' ? c : c(x, y, z);
  }

  set(x: number, y: number, z: number, c: CSpec, flags: number = VF.SOLID) {
    x = Math.round(x);
    y = Math.round(y);
    z = Math.round(z);
    const col = this.resolve(c, x, y, z);
    if (col === null || col === undefined) return this;
    this.map.set(key(x, y, z), VoxelModel.pack(col, flags));
    return this;
  }
  /** set only if the cell is already filled (paint) */
  paintAt(x: number, y: number, z: number, c: CSpec, flags?: number) {
    const k = key(x, y, z);
    const old = this.map.get(k);
    if (old === undefined) return this;
    const col = this.resolve(c, x, y, z);
    if (col === null) return this;
    this.map.set(k, VoxelModel.pack(col, flags ?? (old >>> 24)));
    return this;
  }
  get(x: number, y: number, z: number): number | undefined {
    return this.map.get(key(x, y, z));
  }
  has(x: number, y: number, z: number) {
    return this.map.has(key(x, y, z));
  }
  del(x: number, y: number, z: number) {
    this.map.delete(key(x, y, z));
    return this;
  }
  get count() {
    return this.map.size;
  }

  // ------------------------------------------------------------- primitives
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: CSpec, flags?: number) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    const ay = Math.min(y0, y1), by = Math.max(y0, y1);
    const az = Math.min(z0, z1), bz = Math.max(z0, z1);
    for (let x = ax; x <= bx; x++) for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) this.set(x, y, z, c, flags);
    return this;
  }
  /** box with only shell voxels */
  shell(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: CSpec, flags?: number) {
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          if (x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1) this.set(x, y, z, c, flags);
    return this;
  }
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: CSpec, flags?: number) {
    const X = Math.ceil(rx), Y = Math.ceil(ry), Z = Math.ceil(rz);
    for (let x = -X; x <= X; x++)
      for (let y = -Y; y <= Y; y++)
        for (let z = -Z; z <= Z; z++) {
          const d = (x * x) / (rx * rx + 1e-6) + (y * y) / (ry * ry + 1e-6) + (z * z) / (rz * rz + 1e-6);
          if (d <= 1.0) this.set(cx + x, cy + y, cz + z, c, flags);
        }
    return this;
  }
  sphere(cx: number, cy: number, cz: number, r: number, c: CSpec, flags?: number) {
    return this.ellipsoid(cx, cy, cz, r + 0.35, r + 0.35, r + 0.35, c, flags);
  }
  /** cylinder along axis, base center (cx,cy,cz), radius r (can be fn of t 0..1), length h */
  cylinder(cx: number, cy: number, cz: number, r: number | ((t: number) => number), h: number, c: CSpec, axis: 'x' | 'y' | 'z' = 'y', flags?: number) {
    const n = Math.max(1, Math.round(Math.abs(h)));
    const dir = h < 0 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      const rr = typeof r === 'number' ? r : r(t);
      const R = Math.ceil(rr);
      for (let a = -R; a <= R; a++)
        for (let b = -R; b <= R; b++) {
          if (a * a + b * b > (rr + 0.3) * (rr + 0.3)) continue;
          const o = i * dir;
          if (axis === 'y') this.set(cx + a, cy + o, cz + b, c, flags);
          else if (axis === 'x') this.set(cx + o, cy + a, cz + b, c, flags);
          else this.set(cx + a, cy + b, cz + o, c, flags);
        }
    }
    return this;
  }
  cone(cx: number, cy: number, cz: number, r0: number, r1: number, h: number, c: CSpec, axis: 'x' | 'y' | 'z' = 'y', flags?: number) {
    return this.cylinder(cx, cy, cz, (t) => r0 + (r1 - r0) * t, h, c, axis, flags);
  }
  /** thick line between two points */
  line(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: CSpec, radius = 0, flags?: number) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1);
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + dx * t, y = y0 + dy * t, z = z0 + dz * t;
      if (radius <= 0) this.set(x, y, z, c, flags);
      else this.sphere(Math.round(x), Math.round(y), Math.round(z), radius, c, flags);
    }
    return this;
  }
  /** a tapered tube following a list of points */
  tube(points: [number, number, number][], r0: number, r1: number, c: CSpec, flags?: number) {
    for (let p = 0; p < points.length - 1; p++) {
      const [ax, ay, az] = points[p];
      const [bx, by, bz] = points[p + 1];
      const segLen = Math.hypot(bx - ax, by - ay, bz - az);
      const steps = Math.max(2, Math.ceil(segLen * 2));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const gt = (p + t) / (points.length - 1);
        const r = r0 + (r1 - r0) * gt;
        const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
        if (r < 0.6) this.set(x, y, z, c, flags);
        else this.ellipsoid(Math.round(x), Math.round(y), Math.round(z), r, r, r, c, flags);
      }
    }
    return this;
  }

  // ---------------------------------------------------------------- carving
  carveBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.del(x, y, z);
    return this;
  }
  carveEllipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) {
    const X = Math.ceil(rx), Y = Math.ceil(ry), Z = Math.ceil(rz);
    for (let x = -X; x <= X; x++)
      for (let y = -Y; y <= Y; y++)
        for (let z = -Z; z <= Z; z++) {
          const d = (x * x) / (rx * rx + 1e-6) + (y * y) / (ry * ry + 1e-6) + (z * z) / (rz * rz + 1e-6);
          if (d <= 1.0) this.del(cx + x, cy + y, cz + z);
        }
    return this;
  }
  /** remove voxels where predicate is true */
  carveWhere(pred: (x: number, y: number, z: number) => boolean) {
    for (const k of [...this.map.keys()]) {
      const [x, y, z] = unkey(k);
      if (pred(x, y, z)) this.map.delete(k);
    }
    return this;
  }

  // ------------------------------------------------------------- paint/edit
  /** recolor every voxel matching predicate */
  paint(pred: (x: number, y: number, z: number, rgb: number) => boolean, c: CSpec, flags?: number) {
    for (const [k, v] of this.map) {
      const [x, y, z] = unkey(k);
      if (!pred(x, y, z, v & 0xffffff)) continue;
      const col = typeof c === 'number' ? c : c(x, y, z);
      if (col === null) continue;
      this.map.set(k, VoxelModel.pack(col, flags ?? v >>> 24));
    }
    return this;
  }
  /** darken voxels near the bottom / in creases for a hand-painted grime pass */
  grime(amount = 0.15, scale = 0.35) {
    for (const [k, v] of this.map) {
      const [x, y, z] = unkey(k);
      const n = noise.n3(x * scale, y * scale, z * scale) * 0.5 + 0.5;
      const f = 1 - amount * n;
      this.map.set(k, (v & 0xff000000) | mulRGB(v & 0xffffff, f));
    }
    return this;
  }
  /** mirror everything with x>=0 to negative side (x' = -x - 1 + offset) for symmetric sculpting */
  mirrorX(center = 0) {
    const add: [number, number][] = [];
    for (const [k, v] of this.map) {
      const [x, y, z] = unkey(k);
      const mx = 2 * center - x;
      add.push([key(mx, y, z), v]);
    }
    for (const [k, v] of add) if (!this.map.has(k)) this.map.set(k, v);
    return this;
  }
  translate(dx: number, dy: number, dz: number) {
    const m = new Map<number, number>();
    for (const [k, v] of this.map) {
      const [x, y, z] = unkey(k);
      m.set(key(x + dx, y + dy, z + dz), v);
    }
    this.map = m;
    return this;
  }
  /** copy another model into this one with an offset (and optional color override) */
  merge(o: VoxelModel, dx = 0, dy = 0, dz = 0) {
    for (const [k, v] of o.map) {
      const [x, y, z] = unkey(k);
      this.map.set(key(x + dx, y + dy, z + dz), v);
    }
    return this;
  }
  clone() {
    const m = new VoxelModel(this.name);
    m.map = new Map(this.map);
    return m;
  }
  bounds() {
    let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
    for (const k of this.map.keys()) {
      const [x, y, z] = unkey(k);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    if (minX > maxX) return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }
  forEach(fn: (x: number, y: number, z: number, rgb: number, flags: number) => void) {
    for (const [k, v] of this.map) {
      const [x, y, z] = unkey(k);
      fn(x, y, z, v & 0xffffff, v >>> 24);
    }
  }
}

// ---------------------------------------------------------------------------
// Color helpers (all sRGB packed ints)
// ---------------------------------------------------------------------------
export function rgb(r: number, g: number, b: number) {
  return ((Math.max(0, Math.min(255, r | 0)) << 16) | (Math.max(0, Math.min(255, g | 0)) << 8) | Math.max(0, Math.min(255, b | 0))) >>> 0;
}
export function mulRGB(c: number, f: number) {
  return rgb(((c >> 16) & 255) * f, ((c >> 8) & 255) * f, (c & 255) * f);
}
export function mix(a: number, b: number, t: number) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return rgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
/** per-voxel brightness + slight hue jitter, deterministic by position */
export function vary(base: number, amount = 0.08, seed = 0): ColorFn {
  return (x, y, z) => {
    const h = hash3(x + seed * 131, y - seed * 71, z + seed * 17);
    const f = 1 + (h - 0.5) * 2 * amount;
    const h2 = hash3(z + seed, x - 3, y + 11);
    const c = mulRGB(base, f);
    // tiny warm/cool shift
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    const s = (h2 - 0.5) * amount * 40;
    return rgb(r + s, g, b - s * 0.6);
  };
}
/** pick between palette entries using noise (painterly clusters) */
export function blotch(cols: number[], scale = 0.3, seed = 0): ColorFn {
  return (x, y, z) => {
    const n = noise.n3(x * scale + seed * 9.1, y * scale - seed * 3.7, z * scale + seed * 1.3) * 0.5 + 0.5;
    const jitter = (hash3(x, y, z) - 0.5) * 0.18;
    const i = Math.max(0, Math.min(cols.length - 1, Math.floor((n + jitter) * cols.length)));
    return cols[i];
  };
}
/** vertical gradient along y between y0..y1 */
export function gradY(c0: number, c1: number, y0: number, y1: number, jitter = 0.05): ColorFn {
  return (x, y, z) => {
    const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0 || 1)));
    return mulRGB(mix(c0, c1, t), 1 + (hash3(x, y, z) - 0.5) * 2 * jitter);
  };
}
/** dither between two colors with probability t */
export function dither(a: number, b: number, t: number, seed = 0): ColorFn {
  return (x, y, z) => (hash3(x + seed, y, z - seed) < t ? b : a);
}
/** horizontal bands (strata) along y */
export function strata(cols: number[], bandH = 2, wobble = 0.6, seed = 0): ColorFn {
  return (x, y, z) => {
    const w = noise.n2(x * 0.15 + seed, z * 0.15 - seed) * wobble * bandH;
    const i = Math.floor((y + w) / bandH);
    const c = cols[((i % cols.length) + cols.length) % cols.length];
    return mulRGB(c, 1 + (hash3(x, y, z) - 0.5) * 0.12);
  };
}

/**
 * Downsample a high-resolution model by an integer factor (LOD for distant
 * instances). A coarse voxel is solid when enough of its block is filled; its
 * color is the average of the block's colors; flags are OR-ed.
 */
export function downsampleModel(src: VoxelModel, factor = 2, fillThreshold = 0.3): VoxelModel {
  const acc = new Map<number, { r: number; g: number; b: number; n: number; flags: number }>();
  const f = factor;
  src.forEach((x, y, z, rgbv, flags) => {
    const cx = Math.floor(x / f),
      cy = Math.floor(y / f),
      cz = Math.floor(z / f);
    const k = ((cx + 512) << 20) | ((cy + 512) << 10) | (cz + 512);
    let a = acc.get(k);
    if (!a) {
      a = { r: 0, g: 0, b: 0, n: 0, flags: 0 };
      acc.set(k, a);
    }
    a.r += (rgbv >> 16) & 255;
    a.g += (rgbv >> 8) & 255;
    a.b += rgbv & 255;
    a.n++;
    a.flags |= flags;
  });
  const out = new VoxelModel(src.name + `_lod${f}`);
  const need = Math.max(1, Math.round(f * f * f * fillThreshold));
  for (const [k, a] of acc) {
    if (a.n < need && !(a.flags & (VF.EMISSIVE | VF.GLOW))) continue;
    out.map.set(k, VoxelModel.pack(rgb(a.r / a.n, a.g / a.n, a.b / a.n), a.flags));
  }
  return out;
}
