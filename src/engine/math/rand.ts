// Seeded randomness + coherent noise used by every generator in dustUP.
// Everything procedural (terrain, voxel color jitter, loot rolls) goes through
// here so a run can be reproduced from a single seed.

export class RNG {
  private s: number;
  constructor(seed = 1) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  /** mulberry32 */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  /** weighted pick: items with .w weights */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  gauss() {
    let u = 0,
      v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  fork(salt: number) {
    return new RNG(hash2i(Math.floor(this.next() * 1e9), salt));
  }
}

/** Global non-seeded convenience RNG for cosmetic randomness (particles etc). */
export const rnd = new RNG((Date.now() ^ 0x5bd1e995) >>> 0);

// ---------------------------------------------------------------------------
// Integer hashing (stable, fast) for per-voxel / per-cell variation
// ---------------------------------------------------------------------------
export function hash2i(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export function hash3i(x: number, y: number, z: number): number {
  return hash2i(hash2i(x, y), z);
}
/** 0..1 hash */
export function hash2(x: number, y: number) {
  return hash2i(x, y) / 4294967296;
}
export function hash3(x: number, y: number, z: number) {
  return hash3i(x, y, z) / 4294967296;
}

// ---------------------------------------------------------------------------
// Simplex noise (2D + 3D) - Stefan Gustavson style, seeded permutation
// ---------------------------------------------------------------------------
const grad3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

export class Noise {
  private perm = new Uint8Array(512);
  private permMod12 = new Uint8Array(512);
  constructor(seed = 1337) {
    const r = new RNG(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  /** 2D simplex noise in [-1, 1] */
  n2(xin: number, yin: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const perm = this.perm,
      pm = this.permMod12;
    let n0 = 0,
      n1 = 0,
      n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2,
      y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2,
      y2 = y0 - 1 + 2 * G2;
    const ii = i & 255,
      jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi = pm[ii + perm[jj]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi] * x0 + grad3[gi + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi = pm[ii + i1 + perm[jj + j1]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi] * x1 + grad3[gi + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi = pm[ii + 1 + perm[jj + 1]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi] * x2 + grad3[gi + 1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  /** 3D simplex noise in [-1, 1] */
  n3(xin: number, yin: number, zin: number): number {
    const F3 = 1 / 3,
      G3 = 1 / 6;
    const perm = this.perm,
      pm = this.permMod12;
    let n0, n1, n2, n3;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s),
      j = Math.floor(yin + s),
      k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t),
      y0 = yin - (j - t),
      z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
      }
    } else {
      if (y0 < z0) {
        i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
      } else if (x0 < z0) {
        i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
      } else {
        i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 < 0) n0 = 0;
    else {
      const gi = pm[ii + perm[jj + perm[kk]]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi] * x0 + grad3[gi + 1] * y0 + grad3[gi + 2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 < 0) n1 = 0;
    else {
      const gi = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi] * x1 + grad3[gi + 1] * y1 + grad3[gi + 2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 < 0) n2 = 0;
    else {
      const gi = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi] * x2 + grad3[gi + 1] * y2 + grad3[gi + 2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 < 0) n3 = 0;
    else {
      const gi = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
      t3 *= t3;
      n3 = t3 * t3 * (grad3[gi] * x3 + grad3[gi + 1] * y3 + grad3[gi + 2] * z3);
    }
    return 32 * (n0 + n1 + n2 + n3);
  }

  /** fractal brownian motion, result roughly [-1,1] */
  fbm2(x: number, y: number, oct = 4, lac = 2, gain = 0.5): number {
    let a = 1,
      f = 1,
      s = 0,
      n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.n2(x * f, y * f);
      n += a;
      a *= gain;
      f *= lac;
    }
    return s / n;
  }
  /** ridged multifractal 0..1 (sharp crests: dune ridges, canyon rims) */
  ridged2(x: number, y: number, oct = 4, lac = 2, gain = 0.5): number {
    let a = 1,
      f = 1,
      s = 0,
      n = 0;
    for (let i = 0; i < oct; i++) {
      const v = 1 - Math.abs(this.n2(x * f, y * f));
      s += a * v * v;
      n += a;
      a *= gain;
      f *= lac;
    }
    return s / n;
  }
  fbm3(x: number, y: number, z: number, oct = 3): number {
    let a = 1,
      f = 1,
      s = 0,
      n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.n3(x * f, y * f, z * f);
      n += a;
      a *= 0.5;
      f *= 2;
    }
    return s / n;
  }
}

export const noise = new Noise(20261102);

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp01((v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;
export function wrapAngle(a: number) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
export function dampAngle(a: number, b: number, lambda: number, dt: number) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}
export function approach(v: number, target: number, step: number) {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}
