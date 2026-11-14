// Voxel detail: a pixel-art surface layer for every voxel model, 2 x 2 texels per
// voxel face, laid on the model's own voxel grid (so it never swims, never
// changes a shape or silhouette, and stays crisp). The pattern follows the
// voxel's colour family: wood grain, pebbled leather, cloth weave, denim twill,
// bone with pores and growth lines, brushed blued steel, brass patina, scale
// rows, granular stone. Patterns are synthesised material texture (tileable
// noise, cellular grain, weave and twill layouts), never pictures.
//
// Eyes (very light neutral or very dark), glowing / emissive voxels and ink stay
// exact. The layer fades out once a voxel covers less than ~4 screen pixels,
// so far models keep their clean look and nothing shimmers.
import * as THREE from 'three';

const S = 64;
export const VD = { WOOD: 0, LEATHER: 1, CLOTH: 2, DENIM: 3, BONE: 4, STEEL: 5, BRASS: 6, SCALES: 7, STONE: 8 } as const;
const LAYERS = 9;
type RGB = [number, number, number];

function ih(x: number, y: number, s: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const wrap = (v: number, p: number) => ((v % p) + p) % p;
const sm = (t: number) => t * t * (3 - 2 * t);
function vn(x: number, y: number, cx: number, cy: number, seed: number) {
  const px = S / cx, py = S / cy;
  const gx = x / cx, gy = y / cy;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = sm(gx - ix), fy = sm(gy - iy);
  const a = ih(wrap(ix, px), wrap(iy, py), seed), b = ih(wrap(ix + 1, px), wrap(iy, py), seed);
  const c = ih(wrap(ix, px), wrap(iy + 1, py), seed), d = ih(wrap(ix + 1, px), wrap(iy + 1, py), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function cell(x: number, y: number, c: number, seed: number) {
  const p = S / c;
  const ix = Math.floor(x / c), iy = Math.floor(y / c);
  let f1 = 1e9, f2 = 1e9, id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const wx = wrap(ix + i, p), wy = wrap(iy + j, p);
      const px = (ix + i + 0.15 + 0.7 * ih(wx, wy, seed)) * c, py = (iy + j + 0.15 + 0.7 * ih(wx, wy, seed + 1)) * c;
      const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = wx + wy * 977;
      } else if (d < f2) f2 = d;
    }
  return { f1, f2, id };
}
const M = (v: number, warm = 0): RGB => [v * (1 + warm), v, v * (1 - warm)];

// every pattern: x along the face's u axis, y down the face (v); values are colour multipliers
const PATTERNS: ((x: number, y: number) => RGB)[] = [];
PATTERNS[VD.WOOD] = (x, y) => {
  // fibres running along v, broken now and then, a darker late-wood line, a rare knot
  let v = 1 + (vn(x, y, 1, 12, 11) - 0.5) * 0.12;
  const late = vn(x, y, 3, 32, 12);
  if (late > 0.47 && late < 0.53) v *= 0.88;
  const k = cell(x, y, 16, 13);
  if (ih(k.id, 1, 13) < 0.25 && k.f1 < 1.6) v *= k.f1 < 0.8 ? 0.76 : 0.9;
  return M(v, 0.02);
};
PATTERNS[VD.LEATHER] = (x, y) => {
  // pebbled grain: small cells with darker creases, scuffed lighter patches, a long crease line
  const c = cell(x, y, 3, 21);
  let v = 1 + (ih(c.id, 1, 21) - 0.5) * 0.12;
  if (c.f2 - c.f1 < 0.45) v *= 0.87;
  if (vn(x, y, 16, 16, 22) > 0.68) v *= 1.07;
  const crease = ((x * 0.6 + y + vn(x, y, 8, 8, 23) * 9) % 23 + 23) % 23;
  if (crease < 0.7 && vn(x, y, 32, 32, 24) > 0.5) v *= 0.86;
  return M(v, 0.03);
};
PATTERNS[VD.CLOTH] = (x, y) => {
  // plain weave with slub threads and faint sun-faded patches
  let v = (x + y) % 2 === 0 ? 1.04 : 0.96;
  if (ih(0, y, 31) < 0.08) v *= 1.04;
  if (ih(x, 0, 32) < 0.06) v *= 0.96;
  if (vn(x, y, 16, 16, 33) > 0.7) v *= 1.05;
  return M(v);
};
PATTERNS[VD.DENIM] = (x, y) => {
  // 3/1 twill: diagonal ribs of pale weft over indigo, fading in vertical whiskers
  const t = (x + y) % 4;
  let rgb: RGB = t === 0 ? [1.1, 1.1, 1.08] : t === 1 ? [1.0, 1.0, 1.0] : [0.93, 0.93, 0.95];
  const fade = vn(x, y, 8, 32, 41);
  if (fade > 0.62) rgb = [rgb[0] * 1.07, rgb[1] * 1.07, rgb[2] * 1.04];
  if (ih(x, y, 42) < 0.02) rgb = [1.18, 1.18, 1.14];
  return rgb;
};
PATTERNS[VD.BONE] = (x, y) => {
  // compact bone: growth lines, pores, a hairline crack here and there
  let v = 1 + (vn(x, y, 16, 16, 51) - 0.5) * 0.06;
  const g = (y + vn(x, y, 16, 4, 52) * 5) % 7;
  if (g < 0.8) v *= 0.95;
  if (ih(x, y, 53) < 0.035) v *= 0.84;
  const cr = cell(x, y, 21, 54);
  if (ih(cr.id, 1, 54) < 0.3 && cr.f2 - cr.f1 < 0.5) v *= 0.86;
  return M(v, 0.01);
};
PATTERNS[VD.STEEL] = (x, y) => {
  // brushed steel: long horizontal strokes, the odd pit, a bright scratch
  let v = 1 + (vn(x, y, 24, 1, 61) - 0.5) * 0.09;
  if (ih(x, y, 62) < 0.02) v *= 0.8;
  if (((x - y * 2 + 640) % 29) < 0.7 && vn(x, y, 16, 16, 63) > 0.6) v *= 1.18;
  return [v * 0.99, v, v * 1.02];
};
PATTERNS[VD.BRASS] = (x, y) => {
  // brass: polished highs, dark patina freckles in the low spots
  const p = vn(x, y, 8, 8, 71) * 0.7 + vn(x, y, 2, 2, 72) * 0.3;
  if (p > 0.68) return [0.86, 0.94, 0.9];
  if (p < 0.3) return [1.1, 1.08, 1.02];
  return ih(x, y, 73) < 0.03 ? [0.8, 0.86, 0.84] : M(1, 0.01);
};
PATTERNS[VD.SCALES] = (x, y) => {
  // overlapping scale rows: lit upper edge, shaded lower rim, a darker seam between scales
  const row = Math.floor(y / 3);
  const lx = wrap(x + (row % 2) * 2, 4), ly = y - row * 3;
  let v = 1 + (ih(Math.floor(wrap(x + (row % 2) * 2, S) / 4), row, 81) - 0.5) * 0.08;
  if (ly === 0) v *= 1.1;
  else if (ly === 2) v *= 0.86;
  if (lx === 0) v *= 0.9;
  return M(v);
};
PATTERNS[VD.STONE] = (x, y) => {
  // granular stone: clustered grains in three tones, small pits
  const c = cell(x, y, 2, 91);
  const k = ih(c.id, 1, 91);
  let v = k < 0.3 ? 0.93 : k > 0.75 ? 1.07 : 1;
  if (ih(x, y, 92) < 0.025) v *= 0.82;
  v *= 1 + (vn(x, y, 16, 16, 93) - 0.5) * 0.06;
  return M(v);
};

/** global switch (quality setting / A-B timing): 1 on, 0 off */
export const VOXEL_DETAIL = { on: { value: 1 } };

let atlas: THREE.DataArrayTexture | null = null;
export function voxelDetailAtlas() {
  if (atlas) return atlas;
  const data = new Uint8Array(S * S * 4 * LAYERS);
  for (let l = 0; l < LAYERS; l++)
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const c = PATTERNS[l](x, y);
        const o = (l * S * S + x + y * S) * 4;
        for (let q = 0; q < 3; q++) data[o + q] = Math.max(0, Math.min(255, Math.round((c[q] / 2) * 255)));
        data[o + 3] = 255;
      }
  const tex = new THREE.DataArrayTexture(data, S, S, LAYERS);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  atlas = tex;
  return tex;
}

/**
 * Give a voxel geometry its grid: `pxv` = (offset of the voxel grid in the model's space x64,
 * voxels per metre). Geometries that are not voxel meshes (no userData.voxelSize) or that wear a
 * big-block skin get w = 0, which switches the layer off. Done once, lazily, on first draw.
 */
export function ensureVoxelGrid(geo: THREE.BufferGeometry) {
  if (geo.userData.__pxv) return;
  geo.userData.__pxv = 1;
  const pos = geo.getAttribute('position');
  if (!pos) return;
  const vs = geo.userData.voxelSize as number | undefined;
  const n = pos.count;
  const a = new Uint8Array(n * 4);
  if (vs && vs > 0 && !geo.getAttribute('pxl')) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    const mn = geo.boundingBox!.min;
    const fr = (v: number) => {
      const f = v / vs - Math.floor(v / vs);
      return Math.round(f * 64) & 63;
    };
    const ox = fr(mn.x), oy = fr(mn.y), oz = fr(mn.z), w = Math.max(1, Math.min(255, Math.round(1 / vs)));
    for (let i = 0; i < n; i++) {
      a[i * 4] = ox;
      a[i * 4 + 1] = oy;
      a[i * 4 + 2] = oz;
      a[i * 4 + 3] = w;
    }
  }
  geo.setAttribute('pxv', new THREE.BufferAttribute(a, 4));
}

/** fragment GLSL: needs varyings vOP (object position), vON (object normal), vPxv (grid) and vColor */
export const VOXEL_DETAIL_GLSL = /* glsl */ `
uniform highp sampler2DArray uVDTex;
uniform float uVDOn;
float vdLayer(vec3 lin, float metal, float glow) {
  if (glow > 0.01) return -1.0;
  vec3 c = sqrt(clamp(lin, 0.0, 1.0));
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn;
  float s = mx > 1e-4 ? d / mx : 0.0;
  float h = 0.0;
  if (d > 1e-4) {
    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h *= 60.0;
  }
  if (mx < 0.1) return -1.0;                  // pupils, ink, lettering
  if (s < 0.1 && mx > 0.84) return -1.0;      // eye whites, paper whites, highlights
  if (metal > 0.5) return (h > 28.0 && h < 62.0 && s > 0.3) ? ${VD.BRASS}.0 : ${VD.STEEL}.0;
  if (h > 190.0 && h < 255.0 && s > 0.18) return ${VD.DENIM}.0;
  if (h > 62.0 && h < 175.0 && s > 0.2) return ${VD.SCALES}.0;
  if ((h < 14.0 || h > 320.0) && s > 0.45) return ${VD.CLOTH}.0;
  if (h >= 255.0 && h <= 320.0) return ${VD.CLOTH}.0;
  if (s < 0.12) return ${VD.STONE}.0;
  if (s < 0.4 && mx > 0.62) return ${VD.BONE}.0;
  if (mx < 0.45) return ${VD.LEATHER}.0;
  return ${VD.WOOD}.0;
}
`;
(globalThis as any).__voxelDetail = VOXEL_DETAIL;
