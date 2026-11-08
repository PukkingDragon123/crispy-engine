// Pixel-art foliage: grass tufts, dry grass, dead brush, desert wildflowers,
// flowering oasis shrubs and reeds as crossed sprite planes, scattered densely
// over oasis turf, along the zone rims and round the ruins, swaying in the wind.
//
// The sprites are not drawn: each is a photograph of one of the game's own
// voxel flora models, taken by a small CPU voxel camera (orthographic, a touch
// above and to the side, lit from the upper left, with face shading, contact
// occlusion and a darkened selective outline), at 32 texels per metre so the
// plants share the terrain's pixel density. One instanced draw call carries them
// all; cells of scatter are generated deterministically around the focus.
import * as THREE from 'three';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { unkey } from '../../engine/voxel/VoxelModel';
import { celify } from '../../engine/render/VoxelMaterial';
import { deadBush, dryGrass, turfTuft, wildflower } from '../models/props/flora';
import { oasisReeds, oasisFlowers } from '../models/props/ruins';
import { MAT } from './Heightfield';
import type { World } from './World';
import { globalUniforms } from '../../engine/render/VoxelMaterial';

const LS = 128; // layer size (texels)
const PXM = 64; // texels per metre (the fine flora voxels keep their twigs)

// ------------------------------------------------------------------ the voxel camera
const s2l = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const l2s = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));

interface Photo {
  rgba: Uint8Array; // LS x LS, row 0 = bottom
  /** quad size (m) */
  w: number;
  h: number;
}

/**
 * Photograph a voxel model into a LS x LS sprite: orthographic view from `yaw`
 * (rad, about +Y) and `elev` above the horizon, 2 x 2 rays per texel (thin twigs
 * stay connected), the nearest hit wins (no blur), the plant's foot on the bottom row.
 */
function photograph(model: VoxelModel, vs: number, skip?: (x: number, y: number, z: number, c: number) => boolean, yaw = 0.42, elev = 0.2): Photo {
  // dense grid
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  const vox: [number, number, number, number][] = [];
  for (const [k, v] of model.map) {
    const [x, y, z] = unkey(k);
    const c = v & 0xffffff;
    if (skip?.(x, y, z, c)) continue;
    vox.push([x, y, z, c]);
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (z < z0) z0 = z;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
    if (z > z1) z1 = z;
  }
  const gx = x1 - x0 + 1, gy = y1 - y0 + 1, gz = z1 - z0 + 1;
  const grid = new Int32Array(gx * gy * gz).fill(-1);
  for (const [x, y, z, c] of vox) grid[x - x0 + gx * (y - y0 + gy * (z - z0))] = c;
  const at = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= gx || y >= gy || z >= gz ? -1 : grid[x + gx * (y + gy * z)]);
  // camera basis (voxel units, grid space)
  const d = [-Math.sin(yaw) * Math.cos(elev), -Math.sin(elev), -Math.cos(yaw) * Math.cos(elev)];
  const r = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const u = [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]];
  if (u[1] < 0) for (let i = 0; i < 3; i++) u[i] = -u[i];
  const cx = gx / 2, cy = gy / 2, cz = gz / 2;
  let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9;
  for (const px of [0, gx]) for (const py of [0, gy]) for (const pz of [0, gz]) {
    const p = [px - cx, py - cy, pz - cz];
    const a = p[0] * r[0] + p[1] * r[1] + p[2] * r[2], b = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
    sx0 = Math.min(sx0, a); sx1 = Math.max(sx1, a); sy0 = Math.min(sy0, b); sy1 = Math.max(sy1, b);
  }
  // texels per voxel: the shared 32 px/m, shrunk if the plant would not fit the layer
  let s = vs * PXM;
  s = Math.min(s, (LS - 2) / (sx1 - sx0), (LS - 2) / (sy1 - sy0));
  const W = Math.ceil((sx1 - sx0) * s), H = Math.ceil((sy1 - sy0) * s);
  const D = gx + gy + gz;
  // light: upper left, a little toward the camera
  const L = [-0.55, 0.75, 0.37];
  const col = new Float32Array(W * H * 3);
  const opq = new Uint8Array(W * H);
  const sub = [0.25, 0.75];
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      let best = 1e9, bc = -1, bAxis = 0, bSign = 0, bx = 0, by = 0, bz = 0, hits = 0;
      for (const oy of sub)
        for (const ox of sub) {
          const a = sx0 + (px + ox) / s, b = sy1 - (py + oy) / s;
          // ray origin well in front of the grid
          let ox3 = cx + r[0] * a + u[0] * b - d[0] * D, oy3 = cy + r[1] * a + u[1] * b - d[1] * D, oz3 = cz + r[2] * a + u[2] * b - d[2] * D;
          // enter the box
          let tmin = 0, tmax = 1e9;
          const o = [ox3, oy3, oz3], g = [gx, gy, gz];
          let ok = true;
          for (let i = 0; i < 3; i++) {
            if (Math.abs(d[i]) < 1e-9) {
              if (o[i] < 0 || o[i] > g[i]) ok = false;
              continue;
            }
            let t0 = (0 - o[i]) / d[i], t1 = (g[i] - o[i]) / d[i];
            if (t0 > t1) [t0, t1] = [t1, t0];
            tmin = Math.max(tmin, t0);
            tmax = Math.min(tmax, t1);
          }
          if (!ok || tmin > tmax) continue;
          const t = tmin + 1e-4;
          let ix = Math.floor(o[0] + d[0] * t), iy = Math.floor(o[1] + d[1] * t), iz = Math.floor(o[2] + d[2] * t);
          const stx = d[0] > 0 ? 1 : -1, sty = d[1] > 0 ? 1 : -1, stz = d[2] > 0 ? 1 : -1;
          const dx = Math.abs(1 / d[0]), dy = Math.abs(1 / d[1]), dz = Math.abs(1 / d[2]);
          let tx = ((d[0] > 0 ? ix + 1 : ix) - o[0]) / d[0], ty = ((d[1] > 0 ? iy + 1 : iy) - o[1]) / d[1], tz = ((d[2] > 0 ? iz + 1 : iz) - o[2]) / d[2];
          let axis = 0, tc = t;
          for (let n = 0; n < D * 2; n++) {
            if (ix < 0 || iy < 0 || iz < 0 || ix >= gx || iy >= gy || iz >= gz) {
              if (n > 0) break;
            } else {
              const c = grid[ix + gx * (iy + gy * iz)];
              if (c >= 0) {
                hits++;
                if (tc < best) {
                  best = tc;
                  bc = c;
                  bAxis = axis;
                  bSign = axis === 0 ? -stx : axis === 1 ? -sty : -stz;
                  bx = ix; by = iy; bz = iz;
                }
                break;
              }
            }
            if (tx < ty && tx < tz) { ix += stx; tc = tx; tx += dx; axis = 0; }
            else if (ty < tz) { iy += sty; tc = ty; ty += dy; axis = 1; }
            else { iz += stz; tc = tz; tz += dz; axis = 2; }
          }
        }
      // at least half the texel covered: thin twigs stay one texel wide, clumps keep their gaps
      if (bc < 0 || hits < 2) continue;
      // face light, contact occlusion round the face, darker deep inside the clump
      const n = [0, 0, 0];
      n[bAxis] = bSign;
      const ndl = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / Math.hypot(L[0], L[1], L[2]);
      let occ = 0;
      const fx = bx + n[0], fy = by + n[1], fz = bz + n[2];
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          if (!a && !b) continue;
          const q = bAxis === 0 ? at(fx, fy + a, fz + b) : bAxis === 1 ? at(fx + a, fy, fz + b) : at(fx + a, fy + b, fz);
          if (q >= 0) occ++;
        }
      const above = bAxis !== 1 && at(bx, by + 1, bz) >= 0 ? 0.9 : 1;
      // kept a little dark: the planes are lit again in game by the sun from straight above
      const k = (0.6 + 0.42 * ndl) * (1 - occ * 0.05) * above;
      const o = (px + py * W) * 3;
      col[o] = s2l((bc >> 16) & 255) * k;
      col[o + 1] = s2l((bc >> 8) & 255) * k;
      col[o + 2] = s2l(bc & 255) * k;
      opq[px + py * W] = 1;
    }
  // crop to the opaque pixels, foot on the bottom row, centred
  let ax0 = W, ax1 = -1, ay0 = H, ay1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (opq[x + y * W]) { ax0 = Math.min(ax0, x); ax1 = Math.max(ax1, x); ay0 = Math.min(ay0, y); ay1 = Math.max(ay1, y); }
  const out = new Uint8Array(LS * LS * 4);
  if (ax1 < 0) return { rgba: out, w: LS / PXM, h: LS / PXM };
  const cw = ax1 - ax0 + 1, ch = ay1 - ay0 + 1;
  const offX = Math.floor((LS - cw) / 2), offY = 0; // bottom aligned (row 0 = bottom)
  const put = (lx: number, ly: number, rr: number, gg: number, bb: number) => {
    const oo = (lx + ly * LS) * 4;
    out[oo] = l2s(rr);
    out[oo + 1] = l2s(gg);
    out[oo + 2] = l2s(bb);
    out[oo + 3] = 255;
  };
  const lay = new Int32Array(LS * LS).fill(-1);
  for (let y = ay0; y <= ay1; y++)
    for (let x = ax0; x <= ax1; x++) {
      if (!opq[x + y * W]) continue;
      const lx = offX + x - ax0, ly = offY + (ay1 - y);
      if (lx < 0 || lx >= LS || ly < 0 || ly >= LS) continue;
      const o = (x + y * W) * 3;
      put(lx, ly, col[o], col[o + 1], col[o + 2]);
      lay[lx + ly * LS] = o;
    }
  // selective outline on the shadow side (light comes from the upper left): transparent texels
  // right of or below the plant take its colour, deeply darkened
  const ink: [number, number, number][] = [];
  for (let y = 0; y < LS; y++)
    for (let x = 0; x < LS; x++) {
      if (lay[x + y * LS] >= 0) continue;
      let src = -1;
      for (const [dx, dy] of [[-1, 0], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= LS || ny >= LS) continue;
        if (lay[nx + ny * LS] >= 0) { src = lay[nx + ny * LS]; break; }
      }
      if (src >= 0 && y > 0) ink.push([x, y, src]);
    }
  for (const [x, y, o] of ink) put(x, y, col[o] * 0.38, col[o + 1] * 0.36, col[o + 2] * 0.4);
  // the quad spans the whole layer; the sprite's own scale is the shared texel density
  const ppm = s / vs;
  return { rgba: out, w: LS / ppm, h: LS / ppm };
}

// ------------------------------------------------------------------ the sprite set
export const SPR = {
  DRYGRASS: 0, // 0..3
  DEADBUSH: 4, // 4..7 (sage, creosote, tangle, red twigs)
  FLOWERS: 8, // 8..11 flowering oasis shrubs (pink, white, red, yellow)
  REEDS: 12, // 12..15
  TURF: 16, // 16..21 lush oasis grass
  WILD: 22, // 22..25 desert wildflowers
  SCRUB: 26, // 26..27 leafy low brush
} as const;
const SPR_COUNT = 28;

type Src = () => { model: VoxelModel; voxelSize: number; skip?: (x: number, y: number, z: number, c: number) => boolean };
const SAND_SKIP = new Set([0xe8c48a, 0xdcb478, 0xd0a86c]);
const groundSkip = (x: number, y: number, z: number) => y <= 0;
function sources(): Src[] {
  const s: Src[] = [];
  for (let i = 0; i < 4; i++) s[SPR.DRYGRASS + i] = () => dryGrass(i * 3 + 1);
  for (let i = 0; i < 4; i++) s[SPR.DEADBUSH + i] = () => ({ ...deadBush(i), skip: (_x, _y, _z, c) => SAND_SKIP.has(c) });
  for (let i = 0; i < 4; i++) s[SPR.FLOWERS + i] = () => ({ ...oasisFlowers(i), skip: groundSkip });
  for (let i = 0; i < 4; i++) s[SPR.REEDS + i] = () => ({ ...oasisReeds(i), skip: groundSkip });
  for (let i = 0; i < 6; i++) s[SPR.TURF + i] = () => turfTuft(i);
  for (let i = 0; i < 4; i++) s[SPR.WILD + i] = () => wildflower(i);
  for (let i = 0; i < 2; i++) s[SPR.SCRUB + i] = () => ({ ...deadBush(8 + i * 4), skip: (_x, _y, _z, c) => SAND_SKIP.has(c) });
  return s;
}

let atlas: { tex: THREE.DataArrayTexture; size: Float32Array } | null = null;
/** photograph every flora model once (~150 ms) */
export function spriteAtlas() {
  if (atlas) return atlas;
  const t0 = performance.now();
  const data = new Uint8Array(LS * LS * 4 * SPR_COUNT);
  const size = new Float32Array(SPR_COUNT * 2);
  const src = sources();
  for (let l = 0; l < SPR_COUNT; l++) {
    const m = src[l]();
    const ph = photograph(m.model, m.voxelSize, m.skip, 0.42 + l * 0.37, 0.2);
    data.set(ph.rgba, l * LS * LS * 4);
    size[l * 2] = ph.w;
    size[l * 2 + 1] = ph.h;
  }
  const tex = new THREE.DataArrayTexture(data, LS, LS, SPR_COUNT);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  atlas = { tex, size };
  console.log(`[foliage] ${SPR_COUNT} flora sprites photographed in ${(performance.now() - t0).toFixed(0)}ms`);
  return atlas;
}

// ------------------------------------------------------------------ material + geometry
function crossQuads() {
  // two upright planes crossed at right angles, unit size (base at y = 0)
  const P: number[] = [], U: number[] = [], I: number[] = [];
  for (let q = 0; q < 2; q++) {
    const a = q * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    const b = P.length / 3;
    for (const [x, y] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) {
      P.push(x * c, y, -x * s);
      U.push(x + 0.5, y);
    }
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('sUV', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(P.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(I);
  return g;
}

function makeMaterial(tex: THREE.Texture, uFocus: { value: THREE.Vector3 }, uRad: { value: number }, uWind: { value: THREE.Vector2 }) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSpr = { value: tex };
    sh.uniforms.uTime = globalUniforms.uTime;
    sh.uniforms.uFocus = uFocus;
    sh.uniforms.uRad = uRad;
    sh.uniforms.uWind = uWind;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 iPos; // x y z yaw
        attribute vec4 iSpr; // layer, width, height, seed
        attribute vec2 sUV;
        uniform float uTime, uRad;
        uniform vec3 uFocus;
        uniform vec2 uWind;
        varying vec3 vSpr;
        varying float vNear;`
      )
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace(
        '#include <begin_vertex>',
        `float cy = cos(iPos.w), sy = sin(iPos.w);
        vec3 lp = vec3(position.x * iSpr.y, position.y * iSpr.z, position.z * iSpr.y);
        lp = vec3(cy * lp.x + sy * lp.z, lp.y, -sy * lp.x + cy * lp.z);
        // grow out of the ground at the edge of the scatter radius instead of popping
        float fade = 1.0 - smoothstep(uRad * 0.78, uRad, distance(iPos.xz, uFocus.xz));
        lp.y *= fade;
        lp.xz *= mix(0.4, 1.0, fade);
        // wind: a slow lean with gusts and a quick flutter, growing with height above the ground (m)
        float hm = position.y * iSpr.z;
        float ph = uTime * (1.4 + iSpr.w * 0.8) + iPos.x * 0.29 + iPos.z * 0.21;
        float gust = 0.55 + 0.45 * sin(uTime * 0.6 + iPos.x * 0.05 - iPos.z * 0.04);
        vec2 wd = normalize(uWind + vec2(1e-4));
        float sw = (0.5 + sin(ph) * 0.7 + sin(ph * 2.7 + iSpr.w * 6.0) * 0.25) * gust;
        lp.xz += wd * sw * (hm * 0.1 + hm * hm * 0.04);
        vec3 transformed = iPos.xyz + lp;
        vSpr = vec3(sUV, iSpr.x);
        // plants right in front of the camera dissolve instead of filling the view
        vNear = smoothstep(1.3, 3.2, distance(iPos.xyz + vec3(0.0, iSpr.z * 0.3, 0.0), cameraPosition));`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform highp sampler2DArray uSpr;
        varying vec3 vSpr;
        varying float vNear;`
      )
      // both faces of a plane are lit as ground cover (the back face must not turn its normal down)
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace(
        '#include <map_fragment>',
        `if (vNear < 0.999 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > vNear) discard;
        vec4 spr = texture(uSpr, vSpr);
        if (spr.a < 0.5) discard;
        diffuseColor.rgb *= spr.rgb;`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        gl_FragColor.a = 0.0; // ground cover: no ink silhouettes (the sprites carry their own outline)`
      );
    celify(sh);
  };
  m.customProgramCacheKey = () => 'foliage-spr-v3';
  return m;
}

// ------------------------------------------------------------------ scatter
const CELL = 8;
const STRIDE = 8; // floats per instance
/** sprite groups: [first layer, count, base scale] */
const GROUP = {
  dry: [SPR.DRYGRASS, 4, 1.0],
  dead: [SPR.DEADBUSH, 4, 0.85],
  flower: [SPR.FLOWERS, 4, 0.7],
  reed: [SPR.REEDS, 4, 1.0],
  turf: [SPR.TURF, 6, 1.0],
  wild: [SPR.WILD, 4, 1.0],
  scrub: [SPR.SCRUB, 2, 0.8],
} as const;
type GroupId = keyof typeof GROUP;
/** anchors that leave the ground round them overgrown (ruins, wrecks, standing stones) */
const OVERGROWN = new Set(['shack', 'saloonFacade', 'sheriffFacade', 'storeFacade', 'tent', 'outpost', 'ruinWall', 'hieroglyphWall', 'landmark', 'windmill', 'waterTower', 'watchtower', 'outhouse', 'gallows', 'wagon', 'shipwreck', 'shrine', 'colossusLegs', 'colossusHead', 'rockArch', 'stoneGate', 'obeliskBroken', 'column', 'sphinx', 'statue', 'well', 'trough', 'giantSkull', 'ribArch', 'cairn']);
const FOOT: Record<string, number> = { shack: 4, saloonFacade: 4.5, sheriffFacade: 4.5, storeFacade: 4.5, landmark: 10, outpost: 4, shipwreck: 8, rockArch: 6, colossusLegs: 4, colossusHead: 4, shrine: 4, sphinx: 4, stoneGate: 5, windmill: 3, waterTower: 3, watchtower: 3 };

interface Ctx {
  oasis: { x: number; z: number; r: number; level: number } | null;
  arenas: { x: number; z: number; r: number }[];
  ruins: { x: number; z: number; foot: number }[];
  rims: { cx: number; cz: number; r: number }[];
}

export class Foliage {
  mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private buf: THREE.InstancedInterleavedBuffer;
  private cap = 26000;
  private cells = new Map<number, Float32Array>();
  private anchors: number[] = [];
  private last = new THREE.Vector3(1e9, 0, 1e9);
  private dirty = true;
  private uFocus = { value: new THREE.Vector3() };
  private uRad = { value: 62 };
  private uWind = { value: new THREE.Vector2(1, 0) };
  private size: Float32Array;
  private ruins: { x: number; z: number; foot: number }[] = [];
  private oases: { x: number; z: number; r: number; level: number }[] = [];
  /** boss arenas: the cover is kept low there so nothing hides in it */
  private arenas: { x: number; z: number; r: number }[] = [];
  /** radius (m) the scatter reaches */
  radius = 62;

  constructor(private world: World) {
    const at = spriteAtlas();
    this.size = at.size;
    this.geo = crossQuads();
    this.buf = new THREE.InstancedInterleavedBuffer(new Float32Array(this.cap * STRIDE), STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
    this.geo.setAttribute('iSpr', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    this.geo.instanceCount = 0;
    this.uWind.value.set(world.sa.wind.x, world.sa.wind.z);
    this.mesh = new THREE.Mesh(this.geo, makeMaterial(at.tex, this.uFocus, this.uRad, this.uWind));
    this.mesh.name = 'foliage';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    for (const z of world.sa.zones) {
      for (const p of z.pois) if (p.kind === 'oasis') this.oases.push({ x: p.x, z: p.z, r: p.r / 1.6, level: p.data?.level ?? world.sa.waterLevel });
      for (const a of z.anchors) {
        if (OVERGROWN.has(a.kind)) this.ruins.push({ x: a.x, z: a.z, foot: FOOT[a.kind] ?? 2.5 });
        else if (a.kind === 'bossArena') this.arenas.push({ x: a.x, z: a.z, r: a.data?.r ?? 20 });
      }
    }
    // terrain edits (craters, rising temples, collapsing walls) regrow the cells they touch
    world.field.onDirty.push((x0, z0, x1, z1) => {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) this.cells.delete(i + j * 4096);
      this.dirty = true;
    });
  }

  /** a placed plant from a zone anchor (dead brush, dry grass, reeds, flowering shrubs) */
  addAnchor(kind: string, variant: number, x: number, z: number, rot: number, scale: number) {
    const g: GroupId | null = kind === 'deadBush' ? 'dead' : kind === 'dryGrass' ? 'dry' : kind === 'oasisReeds' || kind === 'reeds' ? 'reed' : kind === 'oasisFlowers' ? 'flower' : null;
    if (!g) return false;
    const [l0, n, sc] = GROUP[g];
    const layer = l0 + (variant % n);
    const y = this.world.groundAt(x, z) - 0.04;
    const k = scale * (g === 'flower' ? 1.0 : sc * 1.15);
    this.anchors.push(x, y, z, rot, layer, this.size[layer * 2] * k, this.size[layer * 2 + 1] * k, (variant * 0.618) % 1);
    this.dirty = true;
    return true;
  }

  private ctxAt(x: number, z: number): Ctx {
    let oasis: Ctx['oasis'] = null;
    for (const o of this.oases) if (Math.hypot(o.x - x, o.z - z) < o.r * 1.9 + CELL) oasis = o;
    const ruins = this.ruins.filter((r) => Math.hypot(r.x - x, r.z - z) < r.foot + 12 + CELL);
    const rims: Ctx['rims'] = [];
    for (const zn of this.world.sa.zones) {
      const d = Math.hypot(zn.cx - x, zn.cz - z);
      if (Math.abs(d - (zn.r + 3.5)) < 8 + CELL) rims.push({ cx: zn.cx, cz: zn.cz, r: zn.r + 3.5 });
    }
    const arenas = this.arenas.filter((r) => Math.hypot(r.x - x, r.z - z) < r.r + CELL);
    return { oasis, ruins, rims, arenas };
  }

  /** deterministic scatter for one 8 m cell */
  private genCell(ci: number, cj: number): Float32Array {
    const f = this.world.field;
    const sa = this.world.sa;
    const x0 = ci * CELL, z0 = cj * CELL;
    const ctx = this.ctxAt(x0 + CELL / 2, z0 + CELL / 2);
    // probe: lush ground in the cell (turf, mud, dirt, damp sand) needs the dense pass
    let lush = !!ctx.oasis || ctx.ruins.length > 0 || ctx.rims.length > 0;
    if (!lush)
      for (let k = 0; k < 9 && !lush; k++) {
        const m = f.matAt(x0 + (k % 3) * 3.5 + 0.5, z0 + Math.floor(k / 3) * 3.5 + 0.5);
        if (m === MAT.GRASS || m === MAT.MUD || m === MAT.DIRT || m === MAT.SAND_DARK) lush = true;
      }
    const nCand = lush ? 240 : 10;
    const candD = nCand / (CELL * CELL);
    const out: number[] = [];
    const H = (i: number, s: number) => {
      let h = Math.imul(ci, 73856093) ^ Math.imul(cj, 19349663) ^ Math.imul(i, 83492791) ^ Math.imul(s, 2654435761);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < nCand; i++) {
      const x = x0 + H(i, 1) * CELL, z = z0 + H(i, 2) * CELL;
      if (!f.inBounds(x, z, 1)) continue;
      const h = f.heightAt(x, z);
      if (h < sa.waterLevel + 0.06) continue;
      const m = f.matAt(x, z);
      if (m >= MAT.BONE) continue;
      if (f.slopeAt(x, z) > 1.1) continue;
      let dens = 0;
      let grp: GroupId = 'dry';
      const pick = H(i, 3);
      const o = ctx.oasis;
      if (o && h < o.level + 0.05) {
        // in the pool: reeds stand in the shallows along the bank only
        if (m === MAT.MUD && h > o.level - 0.32) {
          dens = 0.55;
          grp = 'reed';
        }
      } else if (m === MAT.GRASS) {
        dens = 3.4;
        grp = pick < 0.82 ? 'turf' : pick < 0.9 ? 'wild' : pick < 0.94 ? 'flower' : 'dry';
      } else if (m === MAT.MUD) {
        dens = 0.4;
        grp = pick < 0.6 ? 'reed' : 'turf';
      } else if (m === MAT.SAND_DARK) {
        dens = o ? 0.9 : 0.14;
        grp = pick < 0.42 ? 'dry' : pick < 0.74 ? (o ? 'turf' : 'dry') : pick < 0.86 ? 'wild' : 'scrub';
      } else if (m === MAT.DIRT) {
        dens = 0.32;
        grp = pick < 0.58 ? 'dry' : pick < 0.78 ? 'scrub' : pick < 0.9 ? 'dead' : 'wild';
      } else if (m === MAT.ROCK || m === MAT.DARK_ROCK) {
        dens = 0.05;
        grp = pick < 0.8 ? 'dry' : 'scrub';
      } else if (m === MAT.TILE) {
        dens = 0.03;
        grp = pick < 0.7 ? 'dry' : 'wild';
      } else {
        dens = 0.02;
        grp = pick < 0.74 ? 'dry' : 'dead';
      }
      // overgrown ground round the ruins (never inside them) and along the zone rims
      for (const r of ctx.ruins) {
        const d = Math.hypot(r.x - x, r.z - z);
        if (d < r.foot * 0.75) {
          dens = 0;
          break;
        }
        const k = 1 - Math.min(1, Math.max(0, (d - r.foot) / 10));
        if (k > 0 && m !== MAT.GRASS && m !== MAT.MUD) {
          dens = Math.max(dens, 0.55 * k);
          if (pick < 0.62) grp = 'dry';
          else if (pick < 0.82) grp = 'dead';
          else if (pick < 0.92) grp = 'scrub';
          else grp = 'wild';
        }
      }
      for (const rm of ctx.rims) {
        const d = Math.abs(Math.hypot(rm.cx - x, rm.cz - z) - rm.r);
        const k = 1 - Math.min(1, d / 6);
        if (k > 0 && dens < 0.4 * k && m !== MAT.MUD) {
          dens = 0.4 * k;
          grp = pick < 0.7 ? 'dry' : pick < 0.9 ? 'dead' : 'scrub';
        }
      }
      for (const ar of ctx.arenas) if (Math.hypot(ar.x - x, ar.z - z) < ar.r) dens *= 0.25;
      if (H(i, 4) * candD >= dens) continue;
      const [l0, n, sc] = GROUP[grp];
      const layer = l0 + Math.floor(H(i, 5) * n);
      const k = sc * (0.78 + H(i, 6) * 0.5);
      out.push(x, h - 0.03, z, H(i, 7) * Math.PI * 2, layer, this.size[layer * 2] * k, this.size[layer * 2 + 1] * k, H(i, 8));
    }
    return new Float32Array(out);
  }

  update(focus: THREE.Vector3) {
    this.uFocus.value.copy(focus);
    const moved = Math.hypot(focus.x - this.last.x, focus.z - this.last.z);
    if (!this.dirty && moved < 4) return;
    const R = this.radius;
    this.uRad.value = R;
    const i0 = Math.floor((focus.x - R) / CELL), i1 = Math.floor((focus.x + R) / CELL);
    const j0 = Math.floor((focus.z - R) / CELL), j1 = Math.floor((focus.z + R) / CELL);
    // generate a bounded number of new cells per frame (nearest first) so riding never hitches
    const missing: [number, number, number][] = [];
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const dx = Math.max(0, Math.abs((i + 0.5) * CELL - focus.x) - CELL / 2), dz = Math.max(0, Math.abs((j + 0.5) * CELL - focus.z) - CELL / 2);
        if (dx * dx + dz * dz > R * R) continue;
        if (!this.cells.has(i + j * 4096)) missing.push([i, j, dx * dx + dz * dz]);
      }
    missing.sort((a, b) => a[2] - b[2]);
    const t0 = performance.now();
    let made = 0;
    for (const [i, j] of missing) {
      if (made > 0 && performance.now() - t0 > 2.5) break;
      this.cells.set(i + j * 4096, this.genCell(i, j));
      made++;
    }
    this.dirty = made < missing.length;
    this.last.copy(focus);
    // forget cells far behind
    if (this.cells.size > 1600)
      for (const k of this.cells.keys()) {
        const i = ((k % 4096) + 4096) % 4096, j = Math.round((k - i) / 4096);
        if (Math.hypot((i + 0.5) * CELL - focus.x, (j + 0.5) * CELL - focus.z) > R * 2.2) this.cells.delete(k);
      }
    // pack the live instances
    const arr = this.buf.array as Float32Array;
    let n = 0;
    const R2 = R * R;
    const push = (src: Float32Array | number[], o: number) => {
      if (n >= this.cap) return;
      const dx = src[o] - focus.x, dz = src[o + 2] - focus.z;
      if (dx * dx + dz * dz > R2) return;
      for (let q = 0; q < STRIDE; q++) arr[n * STRIDE + q] = src[o + q];
      n++;
    };
    for (let o = 0; o < this.anchors.length; o += STRIDE) push(this.anchors, o);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = this.cells.get(i + j * 4096);
        if (c) for (let o = 0; o < c.length; o += STRIDE) push(c, o);
      }
    this.geo.instanceCount = n;
    this.buf.needsUpdate = true;
    this.buf.clearUpdateRanges();
    this.buf.addUpdateRange(0, n * STRIDE);
  }

  get count() {
    return this.geo.instanceCount;
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
