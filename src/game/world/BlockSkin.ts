// Big-block skin for large structures: instead of millions of tiny voxel colour
// quads, the walls, roofs, floors, hulls and stones become big flat surfaces
// carrying a crisp pixel-art material texture (planks, cut stone, mud brick,
// sandstone, rusted tin, canvas, bark, cactus skin) laid out at the world's
// 32 texels per metre.
//
// The model's geometry (silhouette, breaches, broken planks, posts, signs) is kept
// exactly. Its surface colour is classified into materials; inside a material the
// per-voxel grain is averaged away (a short box blur) and the result snapped to a
// small palette, so the greedy mesher merges big quads, and the texture brings
// the grain back as pixel art. Paint, lettering, glow, very dark iron and very
// light paper keep their exact colours. Plank grain direction is read from the
// original voxel colours (grain runs along the longest same-colour runs).
import * as THREE from 'three';
import { VoxelModel, VF, unkey } from '../../engine/voxel/VoxelModel';
import { PX } from './PixelTex';

export type SkinHint = 'wood' | 'stone' | 'adobe' | 'rock' | 'cloth' | 'bark' | 'cactus';

const AO_CURVE = [0.5, 0.68, 0.84, 1.0];
const s2l = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  s2l[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const l2s = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));

/** drift sand palettes used across the props (sand piles get the sand texture) */
const SAND = new Set([0xf0d29a, 0xd9b276, 0xfde6b8, 0xb08850, 0xeccb92, 0xf6dcaa, 0xdcb47c, 0xc9a06a, 0xe2c492, 0xe0b478, 0xf0cf98, 0xcf9f66, 0xe8c48a, 0xdcb478, 0xd0a86c]);
/** per material: grain blur radius (voxels) and palette size (fewer tones = bigger merged faces) */
const SKIN_BLUR: Record<SkinHint, number> = { wood: 3, stone: 3, adobe: 3, rock: 2, cloth: 3, bark: 2, cactus: 2 };
const SKIN_TONES: Record<SkinHint, number> = { wood: 4, stone: 3, adobe: 3, rock: 4, cloth: 3, bark: 3, cactus: 3 };
const HINT_LAYER: Record<SkinHint, number> = { wood: PX.WOOD, stone: PX.BRICK, adobe: PX.ADOBE, rock: PX.ROCK, cloth: PX.CLOTH, bark: PX.BARK, cactus: PX.CACTUS };

/** texture layer + 1 for a voxel colour (0 = keep the exact colour, untextured) */
function classify(rgb: number, flags: number, hint: SkinHint): number {
  if (flags & (VF.EMISSIVE | VF.GLOW)) return 0;
  if (SAND.has(rgb)) return PX.SAND + 1;
  const r = ((rgb >> 16) & 255) / 255, g = ((rgb >> 8) & 255) / 255, b = (rgb & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const s = mx > 0 ? d / mx : 0;
  let h = 0;
  if (d > 1e-6) h = (mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  if (h < 0) h += 360;
  if (flags & VF.METAL) return mx > 0.25 ? PX.METAL + 1 : 0;
  // dark iron, ink, lettering; bright paper, whitewash, silk keep their exact colour
  if (mx < 0.2 || mx > 0.9) return 0;
  if (hint === 'cactus') return h > 60 && h < 170 && s > 0.15 ? PX.CACTUS + 1 : 0;
  const warm = h <= 58 || h >= 345;
  if ((warm && s >= 0.06 && s <= 0.82) || (s < 0.12 && mx > 0.45)) return HINT_LAYER[hint] + 1;
  return 0;
}

export interface SkinOpts {
  voxelSize: number;
  pivot?: [number, number, number] | 'bottom';
  hint: SkinHint;
  /** box-blur radius (voxels) that averages the grain away inside a material */
  blur?: number;
  /** palette size per material */
  tones?: number;
}

/** classify + flatten a model's colours (per-voxel arrays; the dense grid only holds indices) */
function flatten(model: VoxelModel, o: SkinOpts) {
  const b = model.bounds();
  const ox = b.minX - 1, oy = b.minY - 1, oz = b.minZ - 1;
  const sx = b.maxX - b.minX + 3, sy = b.maxY - b.minY + 3, sz = b.maxZ - b.minZ + 3;
  const N = sx * sy * sz;
  const vol = new Uint32Array(N);
  const cls = new Uint8Array(N);
  const id = new Int32Array(N).fill(-1);
  const M = model.map.size;
  const vlist = new Int32Array(M);
  let m = 0;
  for (const [k, v] of model.map) {
    const [x, y, z] = unkey(k);
    const i = x - ox + sx * (y - oy + sy * (z - oz));
    vol[i] = v >>> 0;
    cls[i] = classify(v & 0xffffff, v >>> 24, o.hint);
    id[i] = m;
    vlist[m++] = i;
  }
  const strides = [1, sx, sx * sy];
  const dims = [sx, sy, sz];
  // grain direction of planks: same-colour run length along x / y / z (capped)
  const run = new Uint8Array(M * 3);
  for (let n = 0; n < M; n++) {
    const i = vlist[n];
    if (cls[i] !== PX.WOOD + 1) continue;
    const c0 = vol[i];
    for (let a = 0; a < 3; a++) {
      const st = strides[a], len = dims[a], coord = Math.floor(i / st) % len;
      let L = 1;
      for (let t = 1; t <= 12 && coord + t < len && vol[i + t * st] === c0; t++) L++;
      for (let t = 1; t <= 12 && coord - t >= 0 && vol[i - t * st] === c0; t++) L++;
      run[n * 3 + a] = L;
    }
  }
  // average the colour inside each material (separable box blur in linear light, sums + weights)
  const rad = o.blur ?? SKIN_BLUR[o.hint];
  let src = new Float32Array(M * 4);
  for (let n = 0; n < M; n++) {
    const i = vlist[n];
    if (!cls[i]) continue;
    const c = vol[i];
    src[n * 4] = s2l[(c >> 16) & 255];
    src[n * 4 + 1] = s2l[(c >> 8) & 255];
    src[n * 4 + 2] = s2l[c & 255];
    src[n * 4 + 3] = 1;
  }
  if (rad > 0) {
    let dst = new Float32Array(M * 4);
    for (let a = 0; a < 3; a++) {
      const st = strides[a], len = dims[a];
      for (let n = 0; n < M; n++) {
        const i = vlist[n];
        const ci = cls[i];
        if (!ci) continue;
        const coord = Math.floor(i / st) % len;
        let r = 0, g = 0, bb = 0, w = 0;
        for (let t = -rad; t <= rad; t++) {
          const c = coord + t;
          if (c < 0 || c >= len) continue;
          const j = i + t * st;
          const mj = id[j];
          if (mj < 0 || cls[j] !== ci) continue;
          r += src[mj * 4];
          g += src[mj * 4 + 1];
          bb += src[mj * 4 + 2];
          w += src[mj * 4 + 3];
        }
        dst[n * 4] = r;
        dst[n * 4 + 1] = g;
        dst[n * 4 + 2] = bb;
        dst[n * 4 + 3] = w;
      }
      const t = src;
      src = dst;
      dst = t;
    }
  }
  const acc = src;
  // a small palette per material (k-means on the averaged colours, seeded by luminance quantiles)
  const K = o.tones ?? SKIN_TONES[o.hint];
  const byCls = new Map<number, number[]>();
  for (let n = 0; n < M; n++) {
    const i = vlist[n];
    if (!cls[i]) continue;
    const w = acc[n * 4 + 3] || 1;
    acc[n * 4] /= w;
    acc[n * 4 + 1] /= w;
    acc[n * 4 + 2] /= w;
    let l = byCls.get(cls[i]);
    if (!l) byCls.set(cls[i], (l = []));
    l.push(n);
  }
  const lum = (n: number) => acc[n * 4] * 0.3 + acc[n * 4 + 1] * 0.59 + acc[n * 4 + 2] * 0.11;
  for (const [, ids] of byCls) {
    const k = Math.min(K, ids.length);
    const sorted = ids.slice().sort((p, q) => lum(p) - lum(q));
    const cen = new Float32Array(k * 3);
    for (let c = 0; c < k; c++) {
      const s = sorted[Math.floor(((c + 0.5) / k) * sorted.length)];
      cen[c * 3] = acc[s * 4];
      cen[c * 3 + 1] = acc[s * 4 + 1];
      cen[c * 3 + 2] = acc[s * 4 + 2];
    }
    const asg = new Uint8Array(ids.length);
    const step = Math.max(1, Math.floor(ids.length / 6000)); // centroid updates on a sample
    for (let it = 0; it < 6; it++) {
      const last = it === 5;
      const sum = new Float64Array(k * 4);
      for (let e = 0; e < ids.length; e += last ? 1 : step) {
        const n = ids[e];
        let best = 0, bd = 1e9;
        for (let c = 0; c < k; c++) {
          const dr = acc[n * 4] - cen[c * 3], dg = acc[n * 4 + 1] - cen[c * 3 + 1], db = acc[n * 4 + 2] - cen[c * 3 + 2];
          const dd = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
          if (dd < bd) {
            bd = dd;
            best = c;
          }
        }
        asg[e] = best;
        sum[best * 4] += acc[n * 4];
        sum[best * 4 + 1] += acc[n * 4 + 1];
        sum[best * 4 + 2] += acc[n * 4 + 2];
        sum[best * 4 + 3]++;
      }
      if (!last) for (let c = 0; c < k; c++) if (sum[c * 4 + 3] > 0) for (let q = 0; q < 3; q++) cen[c * 3 + q] = sum[c * 4 + q] / sum[c * 4 + 3];
    }
    const pal = new Uint32Array(k);
    for (let c = 0; c < k; c++) pal[c] = (l2s(cen[c * 3]) << 16) | (l2s(cen[c * 3 + 1]) << 8) | l2s(cen[c * 3 + 2]);
    for (let e = 0; e < ids.length; e++) {
      const i = vlist[ids[e]];
      vol[i] = ((vol[i] & 0xff000000) | pal[asg[e]]) >>> 0;
    }
  }
  const out = new VoxelModel(model.name + '_skin');
  for (let n = 0; n < M; n++) {
    const i = vlist[n];
    const x = (i % sx) + ox, y = (Math.floor(i / sx) % sy) + oy, z = Math.floor(i / (sx * sy)) + oz;
    out.map.set(((x + 512) << 20) | ((y + 512) << 10) | (z + 512), vol[i] | 0);
  }
  return { vol, cls, run, id, ox, oy, oz, sx, sy, sz, flat: out };
}

/**
 * Greedy-mesh a voxel model as big textured blocks. Attributes: position, normal,
 * color (linear, AO baked), matx (emission, metal) and pxl (texture layer + 1, grain swap).
 * `geo.userData.flat` holds the flattened model (for the distance LOD).
 */
export function buildSkinGeometry(model: VoxelModel, o: SkinOpts): THREE.BufferGeometry {
  const vs = o.voxelSize;
  const F = flatten(model, o);
  const { vol, cls, run, id, ox, oy, oz, sx, sy, sz } = F;
  const b = model.bounds();
  const pivot: [number, number, number] = o.pivot && o.pivot !== 'bottom' ? o.pivot : [(b.minX + b.maxX + 1) / 2, b.minY, (b.minZ + b.maxZ + 1) / 2];
  const dims = [sx, sy, sz];
  const at = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : vol[x + sx * (y + sy * z)]);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], mat: number[] = [], pxl: number[] = [], idx: number[] = [];
  const xx = [0, 0, 0], q = [0, 0, 0], nb = [0, 0, 0];
  // the axis the wood texture's planks run along, per face direction (see PIXEL_GLSL's pxUV)
  const texV = [1, 2, 1];
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const du = dims[u], dv = dims[v];
    const maskKey = new Float64Array(du * dv);
    const maskVal = new Uint32Array(du * dv);
    const maskAO = new Uint8Array(du * dv * 4);
    const maskPx = new Uint8Array(du * dv * 2);
    for (const sign of [1, -1]) {
      q[0] = q[1] = q[2] = 0;
      q[d] = sign;
      for (xx[d] = 0; xx[d] < dims[d]; xx[d]++) {
        let n = 0, any = false;
        for (xx[v] = 0; xx[v] < dv; xx[v]++)
          for (xx[u] = 0; xx[u] < du; xx[u]++, n++) {
            const cur = at(xx[0], xx[1], xx[2]);
            const nxt = at(xx[0] + q[0], xx[1] + q[1], xx[2] + q[2]);
            if (cur !== 0 && nxt === 0) {
              const L = xx[d] + sign, a = xx[u], bb = xx[v];
              const s = (d2: number, e2: number) => {
                nb[d] = L;
                nb[u] = a + d2;
                nb[v] = bb + e2;
                return at(nb[0], nb[1], nb[2]) !== 0 ? 1 : 0;
              };
              const soft = ((cur >>> 24) & VF.SOFTAO) !== 0;
              const vao = (s1: number, s2: number, c: number) => (s1 && s2 ? 0 : 3 - (s1 + s2 + c));
              let a00 = vao(s(-1, 0), s(0, -1), s(-1, -1)), a10 = vao(s(1, 0), s(0, -1), s(1, -1));
              let a11 = vao(s(1, 0), s(0, 1), s(1, 1)), a01 = vao(s(-1, 0), s(0, 1), s(-1, 1));
              if (soft) {
                a00 = Math.max(a00, 2);
                a10 = Math.max(a10, 2);
                a11 = Math.max(a11, 2);
                a01 = Math.max(a01, 2);
              }
              const vi = xx[0] + sx * (xx[1] + sy * xx[2]);
              const layer = cls[vi];
              let swap = 0;
              if (layer === PX.WOOD + 1) {
                const rn = id[vi] * 3;
                const grain = run[rn + u] > run[rn + v] ? u : v;
                swap = grain !== texV[d] ? 1 : 0;
              }
              maskVal[n] = cur;
              maskAO[n * 4] = a00;
              maskAO[n * 4 + 1] = a10;
              maskAO[n * 4 + 2] = a11;
              maskAO[n * 4 + 3] = a01;
              maskPx[n * 2] = layer;
              maskPx[n * 2 + 1] = swap;
              maskKey[n] = ((cur >>> 0) * 64 + layer * 2 + swap) * 256 + (a00 | (a10 << 2) | (a11 << 4) | (a01 << 6)) + 1;
              any = true;
            } else maskKey[n] = 0;
          }
        if (!any) continue;
        n = 0;
        for (let j = 0; j < dv; j++)
          for (let i = 0; i < du; ) {
            const k = maskKey[n];
            if (k === 0) {
              i++;
              n++;
              continue;
            }
            let w = 1;
            while (i + w < du && maskKey[n + w] === k) w++;
            let h = 1;
            outer: for (; j + h < dv; h++) for (let t = 0; t < w; t++) if (maskKey[n + t + h * du] !== k) break outer;
            const value = maskVal[n];
            const aos = [maskAO[n * 4], maskAO[n * 4 + 1], maskAO[n * 4 + 2], maskAO[n * 4 + 3]];
            const base = [0, 0, 0];
            base[d] = xx[d] + (sign > 0 ? 1 : 0);
            base[u] = i;
            base[v] = j;
            const du3 = [0, 0, 0], dv3 = [0, 0, 0];
            du3[u] = w;
            dv3[v] = h;
            const corners = [
              [base[0], base[1], base[2]],
              [base[0] + du3[0], base[1] + du3[1], base[2] + du3[2]],
              [base[0] + du3[0] + dv3[0], base[1] + du3[1] + dv3[1], base[2] + du3[2] + dv3[2]],
              [base[0] + dv3[0], base[1] + dv3[1], base[2] + dv3[2]],
            ];
            const vi0 = pos.length / 3;
            const rgb = value & 0xffffff, flags = value >>> 24;
            const r = s2l[(rgb >> 16) & 255], g = s2l[(rgb >> 8) & 255], bl = s2l[rgb & 255];
            const em = flags & VF.GLOW ? 1.35 : flags & VF.EMISSIVE ? 0.7 : 0;
            const me = flags & VF.METAL ? 1 : 0;
            for (let c = 0; c < 4; c++) {
              const P = corners[c];
              pos.push((P[0] + ox - pivot[0]) * vs, (P[1] + oy - pivot[1]) * vs, (P[2] + oz - pivot[2]) * vs);
              nor.push(d === 0 ? sign : 0, d === 1 ? sign : 0, d === 2 ? sign : 0);
              const aof = em > 0 ? 1 : AO_CURVE[aos[c]];
              col.push(r * aof, g * aof, bl * aof);
              mat.push(em, me);
              pxl.push(maskPx[n * 2], maskPx[n * 2 + 1]);
            }
            const flip = aos[0] + aos[2] < aos[1] + aos[3];
            if (sign > 0) {
              if (!flip) idx.push(vi0, vi0 + 1, vi0 + 2, vi0, vi0 + 2, vi0 + 3);
              else idx.push(vi0 + 1, vi0 + 2, vi0 + 3, vi0 + 1, vi0 + 3, vi0);
            } else {
              if (!flip) idx.push(vi0, vi0 + 2, vi0 + 1, vi0, vi0 + 3, vi0 + 2);
              else idx.push(vi0 + 1, vi0 + 3, vi0 + 2, vi0 + 1, vi0, vi0 + 3);
            }
            for (let hh = 0; hh < h; hh++) for (let ww = 0; ww < w; ww++) maskKey[n + ww + hh * du] = 0;
            i += w;
            n += w;
          }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('matx', new THREE.Float32BufferAttribute(mat, 2));
  geo.setAttribute('pxl', new THREE.BufferAttribute(new Uint8Array(pxl), 2));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.voxelSize = vs;
  geo.userData.flat = F.flat;
  geo.userData.pivot = pivot;
  return geo;
}
