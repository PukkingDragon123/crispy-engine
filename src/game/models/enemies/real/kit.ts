// Sculpting kit for enemy rigs. Every rig is sculpted in ONE shared "rig space"
// (origin on the ground, faces +Z, left = +X) and split into parts; because all
// parts share that space, each part's `attach` equals its `pivot`.
// Symmetry plane is x = 0.5 (voxel column 0 is the center column), so a voxel
// at x mirrors to -x and a pivot at px mirrors to 1 - px.

import { VoxelModel, VF, CSpec, ColorFn, mix, mulRGB, rgb } from '../../../../engine/voxel/VoxelModel';
import { P } from '../../../../engine/voxel/palette';
import type { RigSpec, V3, PartSpec, SocketSpec } from '../../../../engine/voxel/Rig';
import { hash3, noise } from '../../../../engine/math/rand';

export { VF, P, mix, mulRGB, rgb, hash3, noise };
export type { V3, CSpec, ColorFn };

// ---------------------------------------------------------------------------
// Rig builder
// ---------------------------------------------------------------------------
interface RBPart {
  name: string;
  parent?: string;
  pivot: V3;
  rest?: V3;
  model: VoxelModel;
}

export class RB {
  parts: RBPart[] = [];
  sockets: Record<string, SocketSpec> = {};
  /** symmetry plane in voxel coords: 0.5 = center of voxel column 0 (x -> -x), 0 = voxel boundary (x -> -1-x) */
  plane = 0.5;
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
  /** mirror every `*_l` part into `*_r` (x -> -x) unless the _r part already exists */
  mirrorLR() {
    const add: RBPart[] = [];
    const LR = /_l(\d*)$/;
    for (const p of this.parts) {
      if (!LR.test(p.name)) continue; // arm_l, leg_l3, eye_l ...
      const rn = p.name.replace(LR, '_r$1');
      if (this.has(rn)) continue;
      const m = new VoxelModel(rn);
      const P2 = 2 * this.plane;
      p.model.forEach((x, y, z, c, f) => m.set(P2 - 1 - x, y, z, c, f));
      const parent = p.parent && LR.test(p.parent) ? p.parent.replace(LR, '_r$1') : p.parent;
      add.push({
        name: rn,
        parent,
        pivot: [2 * this.plane - p.pivot[0], p.pivot[1], p.pivot[2]],
        rest: p.rest ? [p.rest[0], -p.rest[1], -p.rest[2]] : undefined,
        model: m,
      });
    }
    this.parts.push(...add);
    return this;
  }
  /** mirror a single named part model into another (existing) part's model */
  mirrorInto(src: string, dst: string) {
    const s = this.m(src);
    const d = this.m(dst);
    const P2 = 2 * this.plane;
    s.forEach((x, y, z, c, f) => d.set(P2 - 1 - x, y, z, c, f));
  }
  socket(name: string, part: string, at: V3, rot?: V3) {
    this.sockets[name] = { part, at, rot };
  }
  /** move all voxels + pivots + sockets (useful to recenter big creatures) */
  build(meta: Record<string, any> = {}): RigSpec {
    // parents must come before children for Rig.ts builds (index lookup is name based, fine),
    // but keep root first for clarity.
    const parts: PartSpec[] = this.parts.map((p) => ({
      name: p.name,
      model: p.model,
      pivot: p.pivot,
      parent: p.parent,
      attach: [p.pivot[0], p.pivot[1], p.pivot[2]],
      rest: p.rest,
    }));
    // drop empty parts' risk: give them a single hidden voxel? Keep them but ensure non-empty
    for (const p of parts) {
      if (p.model.count === 0) p.model.set(Math.round(p.pivot[0]), Math.round(p.pivot[1]), Math.round(p.pivot[2]), P.shadow);
    }
    return { name: this.name, voxelSize: this.voxelSize, parts, sockets: this.sockets, meta };
  }
}

// ---------------------------------------------------------------------------
// Color functions
// ---------------------------------------------------------------------------
/** brightness jitter + optional painterly noise between palette entries */
export function tone(cols: number[], scale = 0.22, jitter = 0.07, seed = 0): ColorFn {
  return (x, y, z) => {
    const n = noise.n3(x * scale + seed * 7.13, y * scale + seed * 1.7, z * scale - seed * 3.1) * 0.5 + 0.5;
    const h = hash3(x + seed * 31, y, z - seed * 17);
    const i = Math.max(0, Math.min(cols.length - 1, Math.floor((n + (h - 0.5) * 0.25) * cols.length)));
    return mulRGB(cols[i], 1 + (h - 0.5) * 2 * jitter);
  };
}
/** single color with jitter */
export function jit(c: number, j = 0.07, seed = 0): ColorFn {
  const jj = j * 0.3; // polished: whisper of variation only
  return (x, y, z) => mulRGB(c, 1 + (hash3(x + seed, y - seed * 3, z + seed * 7) - 0.5) * 2 * jj);
}
/** linen wrap bands: diagonal strips with dark gaps (mummy) */
export function wraps(light: number[], gap: number, period = 3, slope = 0.6, seed = 0): ColorFn {
  return (x, y, z) => {
    const w = noise.n3(x * 0.3 + seed, y * 0.2, z * 0.3) * 1.2;
    const v = y + (x + z) * slope + w;
    const k = ((Math.floor(v) % period) + period) % period;
    const h = hash3(x, y + seed, z);
    if (k === 0 && h < 0.75) return mulRGB(gap, 0.9 + h * 0.2);
    const c = light[Math.floor(h * light.length) % light.length];
    return mulRGB(c, 0.93 + h * 0.12);
  };
}

// local palettes
export const C = {
  flesh: [0x8a6a4c, 0x765a40, 0x5f4733, 0x9b7b58],
  fleshDark: 0x3d2c1f,
  crust: [P.sand2, P.sand3, P.sand1, P.sand4],
  linen: [P.linen1, P.linen2, P.linen0, P.linen2],
  linenDirty: [P.linen2, P.linen3, 0xa8966f, P.linen2],
  bone: [P.bone1, P.bone2, P.bone0, P.bone2, P.bone3],
  bronze: [0xc98d48, 0xa86f33, 0x8a5626, 0xe0a85c],
  chitinRed: [0x8a3a22, 0x6e2a18, 0xa34a2b, 0x5a2014],
  chitinDark: [0x3b2a22, 0x2c1f1a, 0x4a3529, 0x22181a],
  crystal: [P.alphaCrystal0, P.alphaCrystal1, P.alphaCrystal2],
};

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------
/** tapered limb between two points (radius r0 at a, r1 at b) */
export function limb(m: VoxelModel, a: V3, b: V3, r0: number, r1: number, c: CSpec, flags?: number) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const steps = Math.max(2, Math.ceil(len * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = r0 + (r1 - r0) * t;
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    ball(m, x, y, z, r, c, flags);
  }
}
/** sphere at fractional center (voxel cells whose centers fall inside) */
export function ball(m: VoxelModel, cx: number, cy: number, cz: number, r: number, c: CSpec, flags?: number) {
  const R = Math.ceil(r + 1);
  const bx = Math.floor(cx), by = Math.floor(cy), bz = Math.floor(cz);
  for (let x = bx - R; x <= bx + R; x++)
    for (let y = by - R; y <= by + R; y++)
      for (let z = bz - R; z <= bz + R; z++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
        if (dx * dx + dy * dy + dz * dz <= r * r + 0.15) m.set(x, y, z, c, flags);
      }
}
/** ellipsoid at fractional center */
export function ell(m: VoxelModel, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: CSpec, flags?: number) {
  const bx = Math.floor(cx), by = Math.floor(cy), bz = Math.floor(cz);
  for (let x = bx - Math.ceil(rx) - 1; x <= bx + Math.ceil(rx) + 1; x++)
    for (let y = by - Math.ceil(ry) - 1; y <= by + Math.ceil(ry) + 1; y++)
      for (let z = bz - Math.ceil(rz) - 1; z <= bz + Math.ceil(rz) + 1; z++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
        if (dx * dx + dy * dy + dz * dz <= 1.0) m.set(x, y, z, c, flags);
      }
}
export function carveEll(m: VoxelModel, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) {
  const bx = Math.floor(cx), by = Math.floor(cy), bz = Math.floor(cz);
  for (let x = bx - Math.ceil(rx) - 1; x <= bx + Math.ceil(rx) + 1; x++)
    for (let y = by - Math.ceil(ry) - 1; y <= by + Math.ceil(ry) + 1; y++)
      for (let z = bz - Math.ceil(rz) - 1; z <= bz + Math.ceil(rz) + 1; z++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
        if (dx * dx + dy * dy + dz * dz <= 1.0) m.del(x, y, z);
      }
}
/** rounded box (superellipse-ish): corners shaved by radius rr */
export function rbox(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rr: number, c: CSpec, flags?: number) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const ex = Math.max(0, x0 + rr - x, x - (x1 - rr));
        const ey = Math.max(0, y0 + rr - y, y - (y1 - rr));
        const ez = Math.max(0, z0 + rr - z, z - (z1 - rr));
        if (ex * ex + ey * ey + ez * ez <= rr * rr + 0.5) m.set(x, y, z, c, flags);
      }
}
/** knobby bone segment */
export function bone(m: VoxelModel, a: V3, b: V3, r: number, c: CSpec = tone(C.bone, 0.3, 0.06)) {
  limb(m, a, b, r, r * 0.9, c);
  ball(m, a[0], a[1], a[2], r + 0.55, c);
  ball(m, b[0], b[1], b[2], r + 0.5, c);
}
/** hanging tattered cloth strip set along x at depth z: top at yTop, length per column */
export function tatters(m: VoxelModel, x0: number, x1: number, z: number, yTop: number, minLen: number, maxLen: number, c: CSpec, seed = 0, thick = 1) {
  for (let x = x0; x <= x1; x++) {
    const h = hash3(x * 3 + seed, seed * 7, z);
    const len = Math.round(minLen + (maxLen - minLen) * h);
    for (let i = 0; i < len; i++) for (let t = 0; t < thick; t++) m.set(x, yTop - i, z + t, c);
  }
}
/** same along z at x */
export function tattersZ(m: VoxelModel, z0: number, z1: number, x: number, yTop: number, minLen: number, maxLen: number, c: CSpec, seed = 0) {
  for (let z = z0; z <= z1; z++) {
    const h = hash3(seed, z * 5 + seed, x);
    const len = Math.round(minLen + (maxLen - minLen) * h);
    for (let i = 0; i < len; i++) m.set(x, yTop - i, z, c);
  }
}
/** glowing crystal shard growing from base along dir */
export function crystal(m: VoxelModel, base: V3, dir: V3, len: number, r: number, seed = 0) {
  const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / L, dir[1] / L, dir[2] / L];
  const steps = Math.max(2, Math.ceil(len * 1.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const rr = r * (1 - t * 0.85) + 0.2;
    const x = base[0] + d[0] * len * t, y = base[1] + d[1] * len * t, z = base[2] + d[2] * len * t;
    const col = t > 0.72 ? P.alphaCrystal0 : t > 0.35 ? P.alphaCrystal1 : P.alphaCrystal2;
    const fl = t > 0.72 ? VF.GLOW : t > 0.35 ? VF.EMISSIVE : VF.SOLID;
    ball(m, x, y, z, rr, (xx, yy, zz) => mulRGB(col, 0.9 + hash3(xx, yy + seed, zz) * 0.2), fl);
  }
}
/** cluster of crystals around a point (alpha mutation) */
export function crystalCluster(m: VoxelModel, at: V3, up: V3, size: number, seed = 0, count = 4) {
  for (let i = 0; i < count; i++) {
    const h1 = hash3(seed, i, 1) - 0.5, h2 = hash3(seed, i, 2) - 0.5, h3 = hash3(seed, i, 3);
    const dir: V3 = [up[0] + h1 * 1.3, up[1] + h3 * 0.3, up[2] + h2 * 1.3];
    crystal(m, [at[0] + h1 * size * 0.6, at[1], at[2] + h2 * size * 0.6], dir, size * (0.55 + h3 * 0.7), Math.max(0.6, size * 0.18), seed + i);
  }
}
/** a spike/horn cone from base along dir */
export function horn(m: VoxelModel, base: V3, dir: V3, len: number, r: number, c: CSpec, curl: V3 = [0, 0, 0]) {
  const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  let d = [dir[0] / L, dir[1] / L, dir[2] / L];
  const steps = Math.max(2, Math.ceil(len * 2));
  let x = base[0], y = base[1], z = base[2];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    ball(m, x, y, z, Math.max(0.3, r * (1 - t)), c);
    x += (d[0] * len) / steps;
    y += (d[1] * len) / steps;
    z += (d[2] * len) / steps;
    d = [d[0] + (curl[0] / steps), d[1] + (curl[1] / steps), d[2] + (curl[2] / steps)];
  }
}
/** emissive eye pair helper (2-voxel eyes) */
export function eyes(m: VoxelModel, xs: number[], y: number, z: number, col: number, size = 1) {
  for (const x of xs) for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) m.set(x + i * Math.sign(x || 1), y + j, z, col, VF.GLOW);
}
/** paint voxels on the outer surface only where predicate holds */
export function surfacePaint(m: VoxelModel, pred: (x: number, y: number, z: number) => boolean, c: CSpec, flags?: number) {
  const list: [number, number, number][] = [];
  m.forEach((x, y, z) => {
    if (!pred(x, y, z)) return;
    if (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z) || !m.has(x, y - 1, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1)) list.push([x, y, z]);
  });
  for (const [x, y, z] of list) m.paintAt(x, y, z, c, flags);
}
/** lighten exposed top edges / darken undersides for a hand-painted read */
export function edgeLight(m: VoxelModel, up = 1.1, down = 0.82) {
  const changes: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (f & (VF.EMISSIVE | VF.GLOW)) return;
    const above = m.has(x, y + 1, z);
    const below = m.has(x, y - 1, z);
    if (!above) changes.push([x, y, z, mulRGB(c, up), f]);
    else if (!below) changes.push([x, y, z, mulRGB(c, down), f]);
  });
  for (const [x, y, z, c, f] of changes) m.set(x, y, z, c, f);
}
/**
 * Revolver held in a fist at (gx,gy,gz). Built in "aim space" then mapped to rest
 * space: in REST pose (arm hanging) the barrel points -Y and the gun's top faces +Z,
 * so rotating the arm forward by -90deg about X makes the gun aim along +Z.
 * aim (x, yUp, zFwd) -> rest (gx+x, gy - zFwd, gz + yUp)
 */
export function pistol(m: VoxelModel, gx: number, gy: number, gz: number, opts: { long?: boolean; gold?: boolean; dark?: boolean; scale?: number } = {}) {
  const metal = opts.gold ? P.gold1 : opts.dark ? P.iron0 : P.silver1;
  const metal2 = opts.gold ? P.gold2 : opts.dark ? P.iron1 : P.silver2;
  const grip = opts.gold ? P.bone1 : P.wood2;
  const S = (x: number, yu: number, zf: number, c: CSpec, f: number = VF.METAL) => m.set(gx + x, gy - zf, gz + yu, c, f);
  // grip (down and slanted back)
  S(0, -1, 0, jit(grip, 0.08), VF.SOLID);
  S(0, -2, -1, jit(grip, 0.08), VF.SOLID);
  S(0, -3, -1, jit(grip, 0.08), VF.SOLID);
  S(0, -3, -2, P.brass);
  // frame
  S(0, 0, 0, metal2);
  S(0, 0, 1, metal2);
  S(0, -1, 1, metal2); // trigger guard
  S(0, 1, -1, metal2); // hammer
  S(0, 2, -1, P.iron2);
  // cylinder 3x3-ish around axis yu=0.5..1, zf=1..2
  for (let zf = 1; zf <= 2; zf++)
    for (let x = -1; x <= 1; x++)
      for (let yu = 0; yu <= 1; yu++) {
        if (Math.abs(x) === 1 && yu === 1 && zf === 2) continue;
        S(x, yu, zf, jit(metal, 0.06));
      }
  // barrel
  const bl = opts.long ? 7 : 5;
  for (let i = 0; i < bl; i++) S(0, 1, 3 + i, jit(metal, 0.05));
  S(0, 0, 3, metal2); // ejector rod housing
  S(0, 0, 4, metal2);
  S(0, 2, 2 + bl, metal2); // front sight
  S(0, 1, 3 + bl, P.iron2); // muzzle
}

// ---------------------------------------------------------------------------
// Shading color functions (broad painterly tone, minimal salt-and-pepper)
// ---------------------------------------------------------------------------
/** base color modulated by low-frequency noise between shadow..highlight + tiny jitter */
export function paint(base: number, hi: number, lo: number, scale = 0.16, seed = 0, j = 0.035): ColorFn {
  return (x, y, z) => {
    const n = noise.n3(x * scale + seed * 3.3, y * scale - seed * 1.1, z * scale + seed * 2.7);
    const c = n > 0.25 ? mix(base, hi, Math.min(1, (n - 0.25) * 1.6)) : n < -0.25 ? mix(base, lo, Math.min(1, (-n - 0.25) * 1.6)) : base;
    return mulRGB(c, 1 + (hash3(x + seed, y, z - seed) - 0.5) * 2 * j);
  };
}
/** vertical cloth folds: darker stripes every `period` along axis */
export function folds(base: number, dark: number, period = 3, axis: 'x' | 'z' = 'x', seed = 0, j = 0.035): ColorFn {
  return (x, y, z) => {
    const a = axis === 'x' ? x : z;
    const w = noise.n2(a * 0.4 + seed, y * 0.08) * 0.8;
    const k = ((Math.floor(a + w) % period) + period) % period;
    const c = k === 0 ? mix(base, dark, 0.55) : base;
    return mulRGB(c, 1 + (hash3(x, y + seed, z) - 0.5) * 2 * j);
  };
}
/** gradient along y from lo (bottom) to hi (top) with optional jitter */
export function ygrad(lo: number, hi: number, y0: number, y1: number, j = 0.04): ColorFn {
  return (x, y, z) => {
    const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0 || 1)));
    return mulRGB(mix(lo, hi, t), 1 + (hash3(x, y, z) - 0.5) * 2 * j);
  };
}

// ---------------------------------------------------------------------------
// Pixel-art shading pass (hue-shifted ramps, rim outlines, metal glints)
// ---------------------------------------------------------------------------
function rgb2hsl(c: number): [number, number, number] {
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h: number, s: number, l: number): number {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgb((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
function towardHue(h: number, target: number, amt: number) {
  let d = ((target - h + 540) % 360) - 180;
  if (Math.abs(d) < amt) return target;
  return h + Math.sign(d) * amt;
}
const rampCache = new Map<number, number[]>();
/** 5-step hue-shifted ramp of a base color: [deep, shadow, base, light, highlight] */
export function pixelRamp(c: number): number[] {
  const hit = rampCache.get(c);
  if (hit) return hit;
  const [h, s, l] = rgb2hsl(c);
  const out: number[] = [];
  for (const st of [-2, -1, 0, 1, 2]) {
    if (st === 0) {
      out.push(c);
      continue;
    }
    if (st < 0) {
      const k = -st;
      let hh = h, ss = s;
      if (s < 0.2) {
        hh = towardHue(h, 225, 5 * k); // greys/steel/linen -> slate
        ss = Math.min(1, s + 0.02 * k);
      } else if (h >= 18 && h <= 85) {
        hh = h - 4 * k; // ochres, browns, bone, sand -> deeper burnt sienna
        ss = Math.min(1, s + 0.025 * k);
      } else if (h < 18 || h > 300) {
        hh = towardHue(h, 285, 6 * k); // reds -> red-violet
        ss = Math.min(1, s + 0.04 * k);
      } else {
        hh = towardHue(h, 245, 7 * k); // greens/blues -> blue
        ss = Math.min(1, s + 0.05 * k);
      }
      const ll = Math.max(0.02, l * (1 - 0.15 * k));
      out.push(hsl2rgb(hh, ss, ll));
    } else {
      const k = st;
      const hh = towardHue(h, 52, 5 * k);
      const ss = Math.max(0, s - 0.02 * k);
      const ll = Math.min(0.96, l + (1 - l) * 0.12 * k);
      out.push(hsl2rgb(hh, ss, ll));
    }
  }
  rampCache.set(c, out);
  return out;
}
/**
 * Rotation-safe pixel-art pass on one model: top faces step up the ramp, crisp
 * top edges get the highlight, undersides and lower silhouette rims step down
 * (cool, saturated outline), overhang shadows under brims/chins/arms, and sparse
 * warm glints on exposed metal edges. Emissive voxels are left alone.
 */
export function pixelShade(m: VoxelModel, glints = true) {
  const changes: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (f & (VF.EMISSIVE | VF.GLOW)) return;
    const up = !m.has(x, y + 1, z), down = !m.has(x, y - 1, z);
    const ex = (m.has(x + 1, y, z) ? 0 : 1) + (m.has(x - 1, y, z) ? 0 : 1) + (m.has(x, y, z + 1) ? 0 : 1) + (m.has(x, y, z - 1) ? 0 : 1);
    if (!up && !down && ex === 0) return; // interior
    let st = 0;
    if (up && ex > 0) st = 2;
    else if (up) st = 1;
    else if (down && ex > 0) st = -2;
    else if (down) st = -1;
    else if (ex > 0 && (m.has(x, y + 2, z) || m.has(x, y + 3, z)) && !m.has(x, y + 1, z)) st = -1;
    else if (ex > 0) {
      // overhang: something solid above within 4 voxels in the exposed direction column
      let shade = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (m.has(x + dx, y, z + dz)) continue;
        for (let k = 1; k <= 4 && !shade; k++) if (m.has(x + dx, y + k, z + dz)) shade = true;
      }
      if (shade) st = -1;
    }
    if (st === 0) return;
    const ramp = pixelRamp(c);
    let col = ramp[st + 2];
    if (glints && (f & VF.METAL) && st === 2 && hash3(x * 7, y * 3, z * 5) < 0.28) col = mix(ramp[4], 0xfffbea, 0.6);
    changes.push([x, y, z, col, f]);
  });
  for (const [x, y, z, c, f] of changes) m.set(x, y, z, c, f);
}

/** apply the pixel-art pass to every part (signature kept for existing callers) */
export function finish(rb: RB, _up = 1.09, _down = 0.84) {
  for (const p of rb.parts) pixelShade(p.model);
}

// ---------------------------------------------------------------------------
// Generic humanoid body (left side sculpted, mirrored by caller with rb.mirrorLR())
// ---------------------------------------------------------------------------
export interface HumanSpec {
  hip: V3;
  knee: V3;
  ankle: V3;
  shoulder: V3;
  elbow: V3;
  wrist: V3;
  /** torso pivot (waist) */
  waist: V3;
  /** pelvis ellipsoid */
  pelvis: { c: V3; r: V3 };
  /** torso stack from y0 to y1; f(t) gives center z, radii (t 0..1) */
  torso: { y0: number; y1: number; f: (t: number) => { zc: number; rx: number; rz: number } };
  thighR: [number, number];
  shinR: [number, number];
  armR: [number, number];
  foreR: [number, number];
  col: { pelvis: CSpec; torso: CSpec; arm: CSpec; fore: CSpec; hand: CSpec; thigh: CSpec; shin: CSpec; foot: CSpec; nail?: CSpec };
  hand?: 'claw' | 'fist' | 'bony' | 'glove';
  foot?: 'bare' | 'boot' | 'paw' | 'wrapped';
  footLen?: number;
  footW?: number;
  handScale?: number;
}

export function humanoid(rb: RB, s: HumanSpec) {
  const pelvis = rb.part('pelvis', undefined, [s.waist[0], s.hip[1], s.waist[2]]);
  ell(pelvis, s.pelvis.c[0], s.pelvis.c[1], s.pelvis.c[2], s.pelvis.r[0], s.pelvis.r[1], s.pelvis.r[2], s.col.pelvis);
  const torso = rb.part('torso', 'pelvis', s.waist);
  for (let y = Math.floor(s.torso.y0); y <= Math.ceil(s.torso.y1); y++) {
    const t = (y - s.torso.y0) / (s.torso.y1 - s.torso.y0);
    if (t < 0 || t > 1) continue;
    const { zc, rx, rz } = s.torso.f(t);
    for (let x = Math.floor(0.5 - rx - 1); x <= Math.ceil(0.5 + rx + 1); x++)
      for (let z = Math.floor(zc - rz - 1); z <= Math.ceil(zc + rz + 1); z++) {
        const dx = (x + 0.5 - 0.5) / rx, dz = (z + 0.5 - zc) / rz;
        if (dx * dx + dz * dz <= 1) torso.set(x, y, z, s.col.torso);
      }
  }
  // arm
  const arm = rb.part('arm_l', 'torso', s.shoulder);
  ball(arm, s.shoulder[0], s.shoulder[1], s.shoulder[2], s.armR[0] + 0.35, s.col.arm);
  limb(arm, s.shoulder, s.elbow, s.armR[0], s.armR[1], s.col.arm);
  const fore = rb.part('fore_l', 'arm_l', s.elbow);
  ball(fore, s.elbow[0], s.elbow[1], s.elbow[2], s.foreR[0] * 0.9, s.col.fore);
  limb(fore, s.elbow, s.wrist, s.foreR[0], s.foreR[1], s.col.fore);
  hand(fore, s.wrist, s.hand ?? 'fist', s.col.hand, s.col.nail ?? P.shadow, s.handScale ?? 1);
  // leg
  const thigh = rb.part('thigh_l', 'pelvis', s.hip);
  ball(thigh, s.hip[0], s.hip[1], s.hip[2], s.thighR[0] + 0.2, s.col.thigh);
  limb(thigh, s.hip, s.knee, s.thighR[0], s.thighR[1], s.col.thigh);
  const shin = rb.part('shin_l', 'thigh_l', s.knee);
  ball(shin, s.knee[0], s.knee[1], s.knee[2], s.shinR[0] * 0.95, s.col.shin);
  limb(shin, s.knee, s.ankle, s.shinR[0], s.shinR[1], s.col.shin);
  foot(shin, s.ankle, s.foot ?? 'boot', s.col.foot, s.col.nail ?? P.shadow, s.footLen ?? 5, s.footW ?? 3);
  return { pelvis, torso, arm, fore, thigh, shin };
}

/** hand hanging below wrist (fingers point down, palm faces inward -X for left hand) */
export function hand(m: VoxelModel, w: V3, kind: 'claw' | 'fist' | 'bony' | 'glove', c: CSpec, nail: CSpec, k = 1) {
  const [x, y, z] = w;
  if (kind === 'fist' || kind === 'glove') {
    rbox(m, Math.floor(x - 1 * k), Math.floor(y - 3 * k), Math.floor(z - 1 * k), Math.floor(x + 0.6 * k), Math.floor(y - 0.5), Math.floor(z + 1.2 * k), 0.8, c);
    // thumb
    m.set(Math.floor(x - 1.3 * k), Math.floor(y - 1.5 * k), Math.floor(z + 1.2 * k), c);
    if (kind === 'glove') m.box(Math.floor(x - 1 * k), Math.floor(y - 0.5), Math.floor(z - 1 * k), Math.floor(x + 0.6 * k), Math.floor(y), Math.floor(z + 1.2 * k), mulColor(c, 0.8));
  } else if (kind === 'claw') {
    ell(m, x, y - 1.0 * k, z, 1.0 * k, 1.3 * k, 1.2 * k, c);
    for (let f = 0; f < 3; f++) {
      const fz = z - 0.9 * k + f * 0.95 * k;
      limb(m, [x, y - 2.0 * k, fz], [x - 0.2, y - 3.6 * k, fz + 0.8 * k], 0.48, 0.4, c);
      m.set(Math.floor(x - 0.2), Math.floor(y - 4.1 * k), Math.floor(fz + 1.0 * k), nail);
    }
    limb(m, [x - 0.8, y - 1.2 * k, z + 0.7 * k], [x - 1.1, y - 2.3 * k, z + 1.5 * k], 0.45, 0.4, c);
  } else {
    // bony: knuckle bar + thin finger bones
    m.box(Math.floor(x - 0.5), Math.floor(y - 1.5 * k), Math.floor(z - 1 * k), Math.floor(x + 0.5), Math.floor(y - 0.5), Math.floor(z + 1 * k), c);
    for (let f = -1; f <= 1; f++) {
      for (let i = 0; i < 3; i++) m.set(Math.floor(x), Math.floor(y - 2 * k - i), Math.floor(z + f * k + (i > 1 ? 1 : 0)), c);
    }
    m.set(Math.floor(x - 1), Math.floor(y - 1.5 * k), Math.floor(z + 1.5 * k), c);
  }
}
function mulColor(c: CSpec, f: number): CSpec {
  return typeof c === 'number' ? mulRGB(c, f) : (x, y, z) => {
    const v = c(x, y, z);
    return v === null ? null : mulRGB(v, f);
  };
}
/** foot below ankle, toes forward (+Z) */
export function foot(m: VoxelModel, a: V3, kind: 'bare' | 'boot' | 'paw' | 'wrapped', c: CSpec, nail: CSpec, len = 5, w = 3) {
  const [x, , z] = a;
  const x0 = Math.floor(x - w / 2 + 0.5 - 0.5), x1 = x0 + w - 1;
  const zb = Math.floor(z - 1.5), zf = zb + len - 1;
  if (kind === 'boot') {
    rbox(m, x0, 0, zb, x1, 2, zf, 0.7, c);
    m.box(x0, 0, zb, x1, 0, zf, mulColor(c, 0.55)); // sole
    m.box(x0, 0, zb, x1, 1, zb + 1, mulColor(c, 0.7)); // heel
    rbox(m, x0, 2, zb, x1, Math.floor(a[1]) + 2, zb + 2, 0.5, c); // shaft
  } else if (kind === 'wrapped') {
    rbox(m, x0, 0, zb, x1, 2, zf, 0.7, c);
  } else {
    ell(m, x + 0.0, 1.0, z + len * 0.25, w * 0.5, 1.0, len * 0.5, c);
    for (let t = 0; t < w; t++) {
      m.set(x0 + t, 0, zf, c);
      m.set(x0 + t, 0, zf + 1, nail);
    }
  }
}
