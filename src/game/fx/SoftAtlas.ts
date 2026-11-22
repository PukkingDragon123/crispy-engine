// High-resolution particle textures, generated once from noise fields (no painted pictures):
// self-shadowed volumetric smoke puffs (density + light march), hot star-burst flashes,
// flame tongues, soft glows, sparks, shock rings, shaded sand grains, water drops and rock
// chips. Particles.ts routes the old low-res pixel sprite names onto these.
import * as THREE from 'three';

export interface SoftFrame {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  w: number;
  h: number;
}
/** how a soft frame is drawn: 2 lit volumetric smoke, 3 additive glow, 4 shaded solid grain */
export type SoftLayer = 2 | 3 | 4;

const W = 512, H = 512;
let built: { tex: THREE.DataTexture; frames: Map<string, SoftFrame> } | null = null;

// --- tiny value noise (deterministic)
function hash(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number, oct = 5) {
  let f = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    f += vnoise(x, y, s + i * 17) * a;
    n += a;
    x = x * 2.03 + 7.1;
    y = y * 2.03 - 3.7;
    a *= 0.5;
  }
  return f / n;
}
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function softAtlas() {
  if (built) return built;
  const data = new Uint8Array(W * H * 4);
  const frames = new Map<string, SoftFrame>();
  const reg = (name: string, x0: number, y0: number, w: number, h: number) => frames.set(name, { u0: x0 / W, v0: y0 / H, u1: (x0 + w) / W, v1: (y0 + h) / H, w, h });
  const put = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    const o = (x + y * W) * 4;
    data[o] = Math.round(Math.min(1, Math.max(0, r)) * 255);
    data[o + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    data[o + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
    data[o + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
  };
  // ---- volumetric smoke: 4 billowing puffs, 128 px, R/A density, G sun-light transmittance
  const S = 128;
  for (let v = 0; v < 4; v++) {
    const dens = new Float32Array(S * S);
    const seed = 101 + v * 31;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const px = ((x + 0.5) / S) * 2 - 1, py = ((y + 0.5) / S) * 2 - 1;
        const r = Math.hypot(px, py * (1.05 + v * 0.04));
        const n = fbm(px * 2.1 + v * 3, py * 2.1 - v, seed);
        const lumps = fbm(px * 4.6, py * 4.6, seed + 7, 4);
        let d = sstep(0.98, 0.2, r + (n - 0.5) * 0.9);
        d *= 0.45 + 0.75 * lumps;
        dens[x + y * S] = Math.min(1, d * 1.15);
      }
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= S || y >= S ? 0 : dens[(x | 0) + (y | 0) * S]);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = dens[x + y * S];
        // march toward the light (upper left): the denser the cloud above, the darker the puff
        let sum = 0;
        for (let k = 1; k <= 7; k++) sum += at(x - k * 2.6, y + k * 6.2);
        const light = Math.exp(-sum * 0.42);
        const rim = Math.max(0, 1 - d * 2.2) * light;
        put(v * S + x, y, d, light, rim, d);
      }
    reg('smoke' + v, v * S, 0, S, S);
  }
  // ---- star-burst muzzle flashes (128 px): hot core, ragged rays (row 1, side by side)
  for (let f = 0; f < 3; f++) {
    const rays = 5 + f * 2;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const px = ((x + 0.5) / S) * 2 - 1, py = ((y + 0.5) / S) * 2 - 1;
        const r = Math.hypot(px, py), th = Math.atan2(py, px);
        const jag = fbm(th * 3 + f * 5, r * 3, 300 + f, 3);
        const ray = Math.pow(Math.max(0, Math.cos(th * rays + jag * 2.4)), 6) * Math.exp(-r * (2.4 - jag));
        const core = Math.exp(-r * r * 22) + Math.exp(-r * r * 5) * 0.45;
        const i = Math.min(1, core + ray * 0.9);
        const hot = Math.min(1, core * 1.4);
        put(f * S + x, S + y, i, i * (0.82 + hot * 0.18), i * (0.5 + hot * 0.5), i);
      }
  }
  for (let f = 0; f < 3; f++) reg('flash' + f, f * S, S, S, S);
  // ---- shock ring (128 px)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const px = ((x + 0.5) / S) * 2 - 1, py = ((y + 0.5) / S) * 2 - 1;
      const r = Math.hypot(px, py), th = Math.atan2(py, px);
      const br = 0.6 + 0.4 * fbm(th * 2.5, 1, 77, 3);
      const i = Math.exp(-((r - 0.82) ** 2) / 0.006) * br + Math.exp(-((r - 0.7) ** 2) / 0.03) * 0.25;
      put(384 + x, S + y, i, i, i, i);
    }
  reg('ring', 384, S, S, S);
  // ---- flame tongues (64 x 96): white core, orange body, red licking edge
  for (let f = 0; f < 4; f++)
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 64; x++) {
        const px = ((x + 0.5) / 64) * 2 - 1, t = (y + 0.5) / 96;
        const turb = (fbm(px * 2 + f * 1.7, t * 3 - f * 0.9, 500 + f, 4) - 0.5) * 0.7 * t;
        const width = Math.sin(Math.PI * Math.pow(Math.min(1, t * 1.1), 0.62)) * (1 - t * 0.55) * 0.92;
        const e = Math.abs(px + turb) / Math.max(0.02, width);
        let i = sstep(1.0, 0.35, e) * sstep(1.0, 0.75, t);
        i *= 0.75 + 0.25 * fbm(px * 6, t * 8 - f, 600 + f, 3);
        const core = sstep(0.55, 0.0, e) * sstep(0.7, 0.1, t);
        const r = Math.min(1, i * 1.25), g = Math.min(1, i * (0.42 + core * 0.6)), b = Math.min(1, i * core * 0.7);
        put(f * 64 + x, 256 + y, r, g, b, i);
      }
  for (let f = 0; f < 4; f++) reg('flame' + f, f * 64, 256, 64, 96);
  // ---- glow, glint, spark, mist (row 2 right)
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const px = ((x + 0.5) / 64) * 2 - 1, py = ((y + 0.5) / 64) * 2 - 1;
      const r2 = px * px + py * py;
      const g = Math.exp(-r2 * 7) * 0.85 + Math.exp(-r2 * 28) * 0.4;
      put(256 + x, 256 + y, g, g, g, Math.min(1, g));
      const ax = Math.abs(px), ay = Math.abs(py);
      const st = Math.exp(-ax * 30) * Math.exp(-ay * 3.2) + Math.exp(-ay * 30) * Math.exp(-ax * 3.2) + Math.exp(-r2 * 30) * 0.9;
      const s = Math.min(1, st);
      put(320 + x, 256 + y, s, s, s, s);
      // mist: a soft volumetric round puff (lit from above)
      const n = fbm(px * 3, py * 3, 900, 4);
      const d = sstep(1.0, 0.1, Math.sqrt(r2) + (n - 0.5) * 0.5);
      put(432 + x, 256 + y, d, sstep(-1, 1, py * 0.8 + (n - 0.5) * 0.6) * 0.6 + 0.4, 0, d);
    }
  reg('glow', 256, 256, 64, 64);
  reg('glint', 320, 256, 64, 64);
  reg('mist', 432, 256, 64, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 16; x++) {
      const px = ((x + 0.5) / 16) * 2 - 1, py = ((y + 0.5) / 64) * 2 - 1;
      const i = Math.exp(-px * px * 5) * sstep(1, 0.2, Math.abs(py));
      const hot = Math.exp(-px * px * 14);
      put(384 + x, 256 + y, i, i * (0.85 + hot * 0.15), i * (0.6 + hot * 0.4), i);
    }
  reg('spark', 384, 256, 16, 64);
  // ---- shaded grain (16 px): lit sphere, soft rim
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const px = ((x + 0.5) / 16) * 2 - 1, py = ((y + 0.5) / 16) * 2 - 1;
      const r2 = px * px + py * py;
      const nz = Math.sqrt(Math.max(0, 1 - r2));
      const l = Math.max(0, -px * 0.45 + py * 0.6 + nz * 0.66);
      const s = 0.42 + 0.58 * l;
      put(400 + x, 256 + y, s, s, s, r2 < 0.92 ? 1 : 0);
      // water drop: clear body, bright specular, darker rim
      const sp = Math.exp(-((px + 0.3) ** 2 + (py - 0.35) ** 2) * 22);
      const b = 0.7 + 0.25 * nz + sp * 0.6;
      put(416 + x, 256 + y, b, b, b, r2 < 0.9 ? 1 : 0);
      // rock chip: faceted lump
      const ang = Math.atan2(py, px);
      const rr = 0.72 + 0.22 * Math.cos(ang * 3 + 1.3) + 0.1 * Math.cos(ang * 5);
      const facet = Math.floor((ang + Math.PI) / 1.05);
      const fl = 0.55 + 0.45 * ((facet * 0.37 + (py > 0 ? 0.4 : 0)) % 1);
      put(400 + x, 272 + y, fl, fl, fl, Math.sqrt(r2) < rr ? 1 : 0);
    }
  reg('grain', 400, 256, 16, 16);
  reg('drop', 416, 256, 16, 16);
  reg('chunk', 400, 272, 16, 16);
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  built = { tex, frames };
  return built;
}

/**
 * Old pixel sprite name -> soft frame. `layer` 2 smoke, 3 glow, 4 solid grain; `tint`
 * replaces the colour the pixel sprite carried itself (blood, ichor, pebbles, chips).
 * Names not listed keep their pixel sprite (digits, glyphs, bones, linen, crystals).
 */
export function softFor(name: string, additive: boolean): { frame: string; layer: SoftLayer; tint?: number } | null {
  if (/^(puff|cloud)\d$/.test(name) || name === 'smoke') return additive ? { frame: 'glow', layer: 3 } : { frame: 'smoke' + (name.charCodeAt(name.length - 1) % 4), layer: 2 };
  if (/^flash\d$/.test(name)) return { frame: name, layer: 3 };
  if (/^flame\d$/.test(name)) return { frame: name, layer: 3 };
  if (name === 'ring') return { frame: 'ring', layer: 3 };
  if (name === 'star4') return { frame: 'glint', layer: 3 };
  if (name === 'spark' || name === 'streak' || name === 'speedline') return { frame: 'spark', layer: 3 };
  if (/^glow\d+$/.test(name)) return { frame: 'glow', layer: 3 };
  if (/^dot\d$/.test(name)) return additive ? { frame: 'glow', layer: 3 } : { frame: 'grain', layer: 4 };
  if (/^grain\d$/.test(name)) return additive ? { frame: 'glow', layer: 3 } : { frame: 'grain', layer: 4 };
  if (/^blood\d$/.test(name)) return { frame: 'drop', layer: 4, tint: 0xa8180f };
  if (name === 'ichor') return { frame: 'drop', layer: 4, tint: 0x8ee03a };
  if (name === 'bubble') return { frame: 'drop', layer: 4, tint: 0xd8f0f4 };
  if (name === 'pebble') return { frame: 'chunk', layer: 4, tint: 0xb48a62 };
  if (name === 'woodchip') return { frame: 'chunk', layer: 4, tint: 0xa6764a };
  if (name === 'drop') return { frame: 'drop', layer: 4 };
  if (name === 'twig' || name === 'leaf' || name === 'bone' || name === 'linen') return { frame: 'chunk', layer: 4 };
  if (name === 'bullet') return { frame: 'chunk', layer: 4, tint: 0xe8b850 };
  if (name === 'splat') return { frame: 'mist', layer: 2, tint: 0xa8180f };
  if (name === 'venomSplat') return { frame: 'glow', layer: 3, tint: 0x9dff3a };
  if (name === 'mist') return { frame: 'mist', layer: 2 };
  return null;
}
