// Greedy voxel mesher with baked ambient occlusion.
// Produces BufferGeometry with: position, normal, color (linear, AO baked),
// matx (x = emission strength, y = metalness).

import * as THREE from 'three';
import { VoxelModel, VF, unkey } from './VoxelModel';

export interface MeshOptions {
  voxelSize?: number;
  /** pivot in voxel coordinates that maps to the geometry origin. 'bottom' = center of xz, min y */
  pivot?: [number, number, number] | 'bottom' | 'center';
  /** extra brightness multiplier */
  brightness?: number;
  /** AO strength 0..1 */
  ao?: number;
}

const AO_CURVE = [0.5, 0.68, 0.84, 1.0];

const srgbToLin = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  srgbToLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function buildVoxelGeometry(model: VoxelModel, opts: MeshOptions = {}): THREE.BufferGeometry {
  const vs = opts.voxelSize ?? 1 / 16;
  const aoStrength = opts.ao ?? 1;
  const bright = opts.brightness ?? 1;
  const b = model.bounds();
  // dense grid with 1 padding
  const ox = b.minX - 1, oy = b.minY - 1, oz = b.minZ - 1;
  const sx = b.maxX - b.minX + 3, sy = b.maxY - b.minY + 3, sz = b.maxZ - b.minZ + 3;
  const vol = new Uint32Array(sx * sy * sz);
  for (const [k, v] of model.map) {
    const [x, y, z] = unkey(k);
    vol[x - ox + sx * (y - oy + sy * (z - oz))] = v >>> 0;
  }
  const dims = [sx, sy, sz];
  const at = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return 0;
    return vol[x + sx * (y + sy * z)];
  };
  const solid = (p: number[]) => at(p[0], p[1], p[2]) !== 0;

  let pivot: [number, number, number];
  if (opts.pivot === 'bottom' || opts.pivot === undefined) pivot = [(b.minX + b.maxX + 1) / 2, b.minY, (b.minZ + b.maxZ + 1) / 2];
  else if (opts.pivot === 'center') pivot = [(b.minX + b.maxX + 1) / 2, (b.minY + b.maxY + 1) / 2, (b.minZ + b.maxZ + 1) / 2];
  else pivot = opts.pivot;

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const mat: number[] = [];
  const idx: number[] = [];

  const x = [0, 0, 0];
  const q = [0, 0, 0];
  const nb = [0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const du = dims[u], dv = dims[v];
    const maskKey = new Float64Array(du * dv); // packed face key (value + ao)
    const maskVal = new Uint32Array(du * dv);
    const maskAO = new Uint8Array(du * dv * 4);
    for (const sign of [1, -1]) {
      q[0] = q[1] = q[2] = 0;
      q[d] = sign;
      for (x[d] = 0; x[d] < dims[d]; x[d]++) {
        // build mask
        let n = 0;
        let any = false;
        for (x[v] = 0; x[v] < dv; x[v]++) {
          for (x[u] = 0; x[u] < du; x[u]++, n++) {
            const cur = at(x[0], x[1], x[2]);
            const nxt = at(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
            if (cur !== 0 && nxt === 0) {
              // AO samples on neighbour layer
              const L = x[d] + sign;
              const a = x[u], bb = x[v];
              const s = (du2: number, dv2: number) => {
                nb[d] = L;
                nb[u] = a + du2;
                nb[v] = bb + dv2;
                return solid(nb) ? 1 : 0;
              };
              const flags = cur >>> 24;
              const soft = (flags & VF.SOFTAO) !== 0;
              const vao = (s1: number, s2: number, c: number) => (s1 && s2 ? 0 : 3 - (s1 + s2 + c));
              let a00 = vao(s(-1, 0), s(0, -1), s(-1, -1));
              let a10 = vao(s(1, 0), s(0, -1), s(1, -1));
              let a11 = vao(s(1, 0), s(0, 1), s(1, 1));
              let a01 = vao(s(-1, 0), s(0, 1), s(-1, 1));
              if (soft) {
                a00 = Math.max(a00, 2);
                a10 = Math.max(a10, 2);
                a11 = Math.max(a11, 2);
                a01 = Math.max(a01, 2);
              }
              maskVal[n] = cur;
              maskAO[n * 4] = a00;
              maskAO[n * 4 + 1] = a10;
              maskAO[n * 4 + 2] = a11;
              maskAO[n * 4 + 3] = a01;
              maskKey[n] = cur * 256 + (a00 | (a10 << 2) | (a11 << 4) | (a01 << 6)) + 1;
              any = true;
            } else {
              maskKey[n] = 0;
            }
          }
        }
        if (!any) continue;
        // greedy merge
        n = 0;
        for (let j = 0; j < dv; j++) {
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
            outer: for (; j + h < dv; h++) {
              for (let t = 0; t < w; t++) if (maskKey[n + t + h * du] !== k) break outer;
            }
            // emit quad
            const value = maskVal[n];
            const ao0 = maskAO[n * 4], ao1 = maskAO[n * 4 + 1], ao2 = maskAO[n * 4 + 2], ao3 = maskAO[n * 4 + 3];
            const base = [0, 0, 0];
            base[d] = x[d] + (sign > 0 ? 1 : 0);
            base[u] = i;
            base[v] = j;
            const duv = [0, 0, 0];
            const dvv = [0, 0, 0];
            duv[u] = w;
            dvv[v] = h;
            const corners = [
              [base[0], base[1], base[2]],
              [base[0] + duv[0], base[1] + duv[1], base[2] + duv[2]],
              [base[0] + duv[0] + dvv[0], base[1] + duv[1] + dvv[1], base[2] + duv[2] + dvv[2]],
              [base[0] + dvv[0], base[1] + dvv[1], base[2] + dvv[2]],
            ];
            const aos = [ao0, ao1, ao2, ao3];
            const vi = pos.length / 3;
            const rgbv = value & 0xffffff;
            const flags = value >>> 24;
            const r = srgbToLin[(rgbv >> 16) & 255] * bright;
            const g = srgbToLin[(rgbv >> 8) & 255] * bright;
            const bl = srgbToLin[rgbv & 255] * bright;
            const em = flags & VF.GLOW ? 2.6 : flags & VF.EMISSIVE ? 1.0 : 0;
            const me = flags & VF.METAL ? 1 : 0;
            for (let c = 0; c < 4; c++) {
              const P = corners[c];
              pos.push((P[0] + ox - pivot[0]) * vs, (P[1] + oy - pivot[1]) * vs, (P[2] + oz - pivot[2]) * vs);
              const nn = [0, 0, 0];
              nn[d] = sign;
              nor.push(nn[0], nn[1], nn[2]);
              const aof = em > 0 ? 1 : 1 - (1 - AO_CURVE[aos[c]]) * aoStrength;
              col.push(r * aof, g * aof, bl * aof);
              mat.push(em, me);
            }
            const flip = aos[0] + aos[2] < aos[1] + aos[3];
            if (sign > 0) {
              if (!flip) idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
              else idx.push(vi + 1, vi + 2, vi + 3, vi + 1, vi + 3, vi);
            } else {
              if (!flip) idx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
              else idx.push(vi + 1, vi + 3, vi + 2, vi + 1, vi, vi + 3);
            }
            // clear mask
            for (let hh = 0; hh < h; hh++) for (let ww = 0; ww < w; ww++) maskKey[n + ww + hh * du] = 0;
            i += w;
            n += w;
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('matx', new THREE.Float32BufferAttribute(mat, 2));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.voxelSize = vs;
  geo.userData.voxelCount = model.count;
  return geo;
}

/** Utility: extract voxel positions (for debris bursts that match a model's colors) */
export function sampleVoxels(model: VoxelModel, maxCount: number, voxelSize = 1 / 16, pivot?: [number, number, number]) {
  const out: { x: number; y: number; z: number; color: number }[] = [];
  const b = model.bounds();
  const pv = pivot ?? [(b.minX + b.maxX + 1) / 2, b.minY, (b.minZ + b.maxZ + 1) / 2];
  const all: { x: number; y: number; z: number; color: number }[] = [];
  model.forEach((x, y, z, rgb) => all.push({ x: (x + 0.5 - pv[0]) * voxelSize, y: (y + 0.5 - pv[1]) * voxelSize, z: (z + 0.5 - pv[2]) * voxelSize, color: rgb }));
  const step = Math.max(1, Math.floor(all.length / maxCount));
  for (let i = 0; i < all.length && out.length < maxCount; i += step) out.push(all[i]);
  return out;
}
