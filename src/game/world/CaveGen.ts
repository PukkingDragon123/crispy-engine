// The Glass Hollow: the giant sand cave under the desert (generation + runtime world).
//
// Generation (generateCave): a 176 m heightfield FLOOR (rippled sand dunes, rocky talus
// climbing into sheer strata walls, three rock columns, a sunken lake basin, the sand
// mound under the chute you fall through) and a CEILING heightfield (a lumpy dome that
// sinks toward the walls, ridged with flowstone, hung with stalactites, pierced by sky
// cracks and the sand chute). Plus the spots every system needs: the wake-up mound, the
// lake (the Olm's den) and its geyser, bat roosts on the ceiling, goblin dens, crab beds,
// crystal clusters, stalactites / stalagmites / glowing mushrooms, the light shafts.
//
// Runtime (CaveWorld): a World-shaped object (groundAt / groundSmooth / surface / normal /
// slope / deform / colliders / env / sa / field / storm stub / sand) so the player, board,
// gun, enemies, pickups and bosses run inside it unchanged. It renders the floor with the
// voxel Terrain, the ceiling with a second Terrain mirrored upside down (its rock casts the
// sun's shadow, so the daylight only falls through the cracks in pools), volumetric dusty
// light shafts, a dark lake with glowing plankton and drip ripples, crystal clusters lit by
// coloured point lights, falling sand from the chute and drips from the stalactites.
import * as THREE from 'three';
import { Heightfield, MAT } from './Heightfield';
import { Terrain } from './Terrain';
import { Env, EnvPreset } from './Env';
import { Colliders } from './Colliders';
import { SandWaves } from './SandWaves';
import type { SurfaceInfo } from '../player/Board';
import { RNG, noise, clamp, smoothstep, lerp } from '../../engine/math/rand';
import { ATMO, globalUniforms, atmoFogUniforms, makeVoxelMaterial, sharedVoxelMaterial, ensureInstFx } from '../../engine/render/VoxelMaterial';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { modelEntry } from '../models/lookup';
import { caveColumn } from '../models/cave/props';

// ============================================================================ layout
export const CAVE_SIZE = 176;
const RES = 0.5;
export const CAVE_WATER = -0.45;

export interface CaveSpot {
  x: number;
  z: number;
  y?: number;
  r?: number;
  rot?: number;
  scale?: number;
  key?: string;
  tone?: 'cyan' | 'violet' | 'teal';
}
export interface CaveCrack {
  x: number;
  z: number;
  /** half length / half width of the crack (m), orientation */
  hl: number;
  hw: number;
  rot: number;
  exit?: boolean;
}
export interface CaveLayout {
  seed: number;
  size: number;
  cx: number;
  cz: number;
  field: Heightfield;
  ceil: Heightfield;
  /** ceiling height (m) at x, z (positive, world space) */
  ceilingAt: (x: number, z: number) => number;
  /** signed distance to the floor boundary (m): positive inside the cave */
  sdf: (x: number, z: number) => number;
  lake: { x: number; z: number; r: number };
  start: { x: number; z: number; heading: number };
  chute: { x: number; z: number; r: number; top: number };
  exit: { x: number; z: number };
  cracks: CaveCrack[];
  columns: { x: number; z: number; r: number }[];
  roosts: CaveSpot[];
  dens: CaveSpot[];
  crabBeds: CaveSpot[];
  crystals: CaveSpot[];
  hanging: CaveSpot[];
  stalactites: CaveSpot[];
  stalagmites: CaveSpot[];
  mushrooms: CaveSpot[];
}

/** sun (sky light through the cracks): steep, so the shafts slant only a little */
const SUN_ELEV = 76;
const SUN_AZIM = 214;
export function caveSunDir() {
  const el = THREE.MathUtils.degToRad(SUN_ELEV), az = THREE.MathUtils.degToRad(SUN_AZIM);
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
}

export function generateCave(seed = 1): CaveLayout {
  const rng = new RNG(seed * 7919 + 13);
  const S = CAVE_SIZE, C = S / 2;
  const so = seed * 3.17;
  const lake = { x: C + 8, z: C + 40, r: 21 };
  const start = { x: C - 6, z: C - 52, heading: 0.1 };
  const chute = { x: start.x, z: start.z - 1.5, r: 1.7, top: 44 };
  const columns = [
    { x: C - 26, z: C - 6, r: 4.2 },
    { x: C + 28, z: C - 26, r: 3.4 },
    { x: C - 12, z: C + 30, r: 3.0 },
  ];
  const cracks: CaveCrack[] = [
    { x: C + 17, z: C - 20, hl: 6, hw: 2.0, rot: 0.6 },
    { x: C - 24, z: C + 10, hl: 4.8, hw: 1.6, rot: -0.5 },
    { x: lake.x - 1, z: lake.z + 1, hl: 7.5, hw: 2.8, rot: 1.15, exit: true },
  ];

  // ------------------------------------------------------------ boundary
  const sdf = (x: number, z: number) => {
    const dx = x - C, dz = z - C;
    const rho = Math.hypot(dx, dz) || 1e-6;
    const c = dx / rho, s = dz / rho;
    const re = 1 / Math.sqrt((c / 62) ** 2 + (s / 72) ** 2);
    const wob = 1 + 0.11 * noise.n2(c * 1.3 + so, s * 1.3) + 0.05 * noise.n2(c * 3.7 - so, s * 3.7 + 2) + 0.02 * noise.n2(c * 9 + so, s * 9);
    return re * wob - rho;
  };
  const lakeD = (x: number, z: number) => {
    const dx = x - lake.x, dz = z - lake.z;
    const a = Math.atan2(dz, dx);
    const rr = lake.r * (1 + 0.14 * Math.sin(a * 3 + so) + 0.07 * Math.sin(a * 5 - so));
    return Math.hypot(dx, dz) / rr;
  };
  const inCrack = (x: number, z: number, k: CaveCrack, pad = 0) => {
    const dx = x - k.x, dz = z - k.z;
    const u = dx * Math.cos(k.rot) + dz * Math.sin(k.rot), v = -dx * Math.sin(k.rot) + dz * Math.cos(k.rot);
    const jag = 1 + 0.25 * noise.n2(u * 0.9 + k.x, v * 0.9);
    return (u / (k.hl + pad)) ** 2 + (v / ((k.hw + pad) * jag)) ** 2;
  };

  // ------------------------------------------------------------ floor
  const field = new Heightfield(S, RES);
  field.waterLevel = CAVE_WATER;
  const n = field.n;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = i * RES, z = j * RES;
      const s = sdf(x, z);
      // rippled dunes: long transverse swells and small ripples, calmer toward the walls
      const dn = noise.fbm2(x * 0.018 + so, z * 0.018, 3) * 1.4 + noise.n2(x * 0.06, z * 0.045 - so) * 0.35;
      const swell = 2.2 * Math.exp(-((((z - (C - 14)) + Math.sin(x * 0.05) * 8) / 7) ** 2)) * smoothstep(8, 30, s);
      const swell2 = 1.6 * Math.exp(-((((x - (C + 22)) + Math.sin(z * 0.07) * 6) / 6) ** 2)) * smoothstep(8, 30, s) * smoothstep(C + 20, C - 10, z);
      let h = dn + swell + swell2;
      let m: number = noise.n2(x * 0.04 + 7, z * 0.04) > 0.25 ? MAT.SAND_DARK : MAT.SAND;
      // rocky talus climbing to the walls
      if (s < 14) {
        const t = 14 - Math.max(0, s);
        h += t * t * 0.03 + Math.max(0, noise.ridged2(x * 0.08 + so, z * 0.08, 3) - 0.4) * t * 0.18;
        if (s < 7 && noise.n2(x * 0.11, z * 0.11 + so) > -0.2) m = MAT.DARK_ROCK;
      }
      // the walls: sheer strata cliffs
      if (s < 0) {
        h = 5.9 + (-s) * 5.5 + noise.fbm2(x * 0.05, z * 0.05 + so, 3) * 4;
        h = Math.min(h, 70);
        m = noise.n2(x * 0.03 + so, z * 0.03) > 0.1 ? MAT.ROCK : MAT.DARK_ROCK;
        if (noise.ridged2(x * 0.05 - so, z * 0.05, 2) > 0.82) m = MAT.CRYSTAL;
      }
      // the lake basin with a damp sand beach
      const ld = lakeD(x, z);
      if (ld < 1.45) {
        const bed = -0.35 - 4.4 * Math.max(0, 1 - ld * ld) + noise.n2(x * 0.2, z * 0.2) * 0.2;
        const k = smoothstep(0.92, 1.45, ld);
        h = lerp(bed, h, k);
        if (ld < 1.22) m = h < CAVE_WATER ? MAT.MUD : MAT.SAND_DARK;
      }
      // the mound of sand poured down the chute (the wake-up spot)
      const ds = Math.hypot(x - chute.x, z - chute.z);
      if (ds < 9) h += 2.4 * (1 - ds / 9) ** 2;
      // the flowstone columns' feet (the columns themselves are sculpted models): rubble mounds
      for (const c of columns) {
        const d = Math.hypot(x - c.x, z - c.z);
        if (d < c.r + 6) {
          h += (c.r + 6 - d) ** 2 * 0.05;
          if (d < c.r + 3) m = MAT.DARK_ROCK;
        }
      }
      field.base[i + j * n] = h;
      field.baseMat[i + j * n] = m;
    }
  field.finalize();

  // ------------------------------------------------------------ ceiling (stores -height)
  const ceilingRaw = (x: number, z: number) => {
    const s = sdf(x, z);
    let y = 15 + 22 * smoothstep(-6, 42, s) + noise.fbm2(x * 0.035 + so, z * 0.035, 3) * 4;
    // flowstone ridges hanging down
    y -= Math.max(0, noise.ridged2(x * 0.045, z * 0.045 + so, 3) - 0.55) * 9;
    // the lake vault is higher
    const ld = lakeD(x, z);
    if (ld < 1.6) y += 7 * (1 - smoothstep(0.6, 1.6, ld));
    return y;
  };
  const ceilingAt = (x: number, z: number) => {
    for (const k of cracks) if (inCrack(x, z, k) < 1) return 90;
    if (Math.hypot(x - chute.x, z - chute.z) < chute.r) return chute.top;
    return ceilingRaw(x, z);
  };
  const ceil = new Heightfield(S, RES);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = i * RES, z = j * RES;
      const y = ceilingAt(x, z);
      ceil.base[i + j * n] = -y;
      let m: number = noise.n2(x * 0.05 - so, z * 0.05) > 0.2 ? MAT.ROCK : MAT.DARK_ROCK;
      if (noise.ridged2(x * 0.04 + so, z * 0.04, 2) > 0.86) m = MAT.CRYSTAL;
      ceil.baseMat[i + j * n] = m;
    }
  ceil.finalize();

  // ------------------------------------------------------------ spots
  const floorAt = (x: number, z: number) => field.heightAt(x, z);
  const clearOf = (x: number, z: number, r: number, list: { x: number; z: number; r?: number }[]) => list.every((o) => Math.hypot(o.x - x, o.z - z) > r + (o.r ?? 1));
  const blockers: { x: number; z: number; r?: number }[] = [...columns.map((c) => ({ x: c.x, z: c.z, r: c.r + 4 })), { x: chute.x, z: chute.z, r: 10 }];
  const crackFree = (x: number, z: number, pad: number) => cracks.every((k) => inCrack(x, z, k, pad) > 1);

  const crystals: CaveSpot[] = [];
  const tones: ('cyan' | 'violet' | 'teal')[] = ['cyan', 'violet', 'cyan', 'violet', 'teal'];
  for (let tries = 0; crystals.length < 22 && tries < 900; tries++) {
    const a = rng.next() * Math.PI * 2, r = rng.range(20, 80);
    const x = C + Math.cos(a) * r, z = C + Math.sin(a) * r;
    const s = sdf(x, z);
    const big = crystals.length < 9;
    if (s < (big ? 1.5 : 3) || s > (big ? 9 : 26) || lakeD(x, z) < 1.25) continue;
    if (!clearOf(x, z, big ? 6 : 3.5, [...blockers, ...crystals])) continue;
    const size = big ? 'l' : rng.chance(0.6) ? 'm' : 's';
    const tone = tones[crystals.length % tones.length];
    crystals.push({ x, z, y: floorAt(x, z), r: size === 'l' ? 2.2 : size === 'm' ? 1.1 : 0.5, rot: rng.next() * 6.28, scale: rng.range(0.85, 1.25), key: `cave_crystal_${tone === 'teal' && size !== 'm' ? 'cyan' : tone}_${size}`, tone });
  }
  // clusters around the lake shore glow over the water
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.4;
    const x = lake.x + Math.cos(a) * lake.r * 1.28, z = lake.z + Math.sin(a) * lake.r * 1.28;
    if (sdf(x, z) < 2) continue;
    crystals.push({ x, z, y: floorAt(x, z), r: 1.1, rot: a, scale: rng.range(0.9, 1.3), key: k % 2 ? 'cave_crystal_teal_m' : 'cave_crystal_cyan_m', tone: k % 2 ? 'teal' : 'cyan' });
  }
  // crystals hanging from the ceiling
  const hanging: CaveSpot[] = [];
  for (let tries = 0; hanging.length < 7 && tries < 300; tries++) {
    const x = C + rng.range(-50, 50), z = C + rng.range(-55, 55);
    if (sdf(x, z) < 8 || !crackFree(x, z, 4) || !clearOf(x, z, 10, hanging)) continue;
    hanging.push({ x, z, y: ceilingRaw(x, z), r: 1, rot: rng.next() * 6.28, scale: rng.range(0.8, 1.2), key: rng.chance(0.5) ? 'cave_crystal_violet_m' : 'cave_crystal_cyan_m', tone: 'violet' });
  }
  const stalactites: CaveSpot[] = [];
  for (let tries = 0; stalactites.length < 70 && tries < 2000; tries++) {
    const x = C + rng.range(-70, 70), z = C + rng.range(-75, 75);
    const s = sdf(x, z);
    if (s < 1 || !crackFree(x, z, 3) || Math.hypot(x - chute.x, z - chute.z) < 6) continue;
    if (!clearOf(x, z, 2.5, stalactites)) continue;
    const near = s < 22;
    if (!near && rng.chance(0.55)) continue;
    const v = rng.int(0, 5);
    const key = v >= 4 ? `stalactite_curtain_${v - 4}` : `stalactite_${v}`;
    stalactites.push({ x, z, y: ceilingRaw(x, z), r: 1, rot: rng.next() * 6.28, scale: rng.range(0.7, 1.35) * (near ? 1 : 0.85), key });
  }
  const stalagmites: CaveSpot[] = [];
  for (let tries = 0; stalagmites.length < 34 && tries < 1500; tries++) {
    const a = rng.next() * Math.PI * 2, r = rng.range(14, 82);
    const x = C + Math.cos(a) * r, z = C + Math.sin(a) * r;
    const s = sdf(x, z);
    if (s < 1 || s > 20 || lakeD(x, z) < 1.25) continue;
    if (!clearOf(x, z, 3, [...blockers, ...stalagmites, ...crystals])) continue;
    const v = rng.int(0, 3);
    const sc = rng.range(0.7, 1.3);
    stalagmites.push({ x, z, y: floorAt(x, z), r: [0.55, 0.85, 1.15, 0.7][v] * sc, rot: rng.next() * 6.28, scale: sc, key: `stalagmite_${v}` });
  }
  const mushrooms: CaveSpot[] = [];
  for (let tries = 0; mushrooms.length < 30 && tries < 900; tries++) {
    const nearLake = mushrooms.length < 14;
    const a = rng.next() * Math.PI * 2;
    const x = nearLake ? lake.x + Math.cos(a) * lake.r * rng.range(1.15, 1.6) : C + Math.cos(a) * rng.range(20, 80);
    const z = nearLake ? lake.z + Math.sin(a) * lake.r * rng.range(1.15, 1.6) : C + Math.sin(a) * rng.range(20, 80);
    const s = sdf(x, z);
    if (s < 1 || (!nearLake && s > 14) || lakeD(x, z) < 1.12) continue;
    if (!clearOf(x, z, 1.4, [...blockers, ...mushrooms, ...stalagmites])) continue;
    mushrooms.push({ x, z, y: floorAt(x, z), r: 0.3, rot: rng.next() * 6.28, scale: rng.range(0.9, 1.8), key: `cave_mushrooms_${rng.int(0, 2)}` });
  }
  // bat roosts: a colony hanging from the vault over the middle of the cave
  const roosts: CaveSpot[] = [];
  for (let tries = 0; roosts.length < 9 && tries < 400; tries++) {
    const x = C + 4 + rng.range(-16, 16), z = C + 2 + rng.range(-16, 16);
    if (!crackFree(x, z, 3) || !clearOf(x, z, 2.2, roosts)) continue;
    roosts.push({ x, z, y: ceilingRaw(x, z) - 0.15, rot: rng.next() * 6.28 });
  }
  const dens: CaveSpot[] = [
    { x: C - 36, z: C - 18, r: 9 },
    { x: C + 36, z: C + 12, r: 9 },
  ];
  const crabBeds: CaveSpot[] = [];
  for (let k = 0; k < 3; k++) {
    const a = -1.9 + k * 0.9;
    crabBeds.push({ x: lake.x + Math.cos(a) * lake.r * 1.35, z: lake.z + Math.sin(a) * lake.r * 1.35, r: 6 });
  }
  return {
    seed, size: S, cx: C, cz: C, field, ceil, ceilingAt, sdf, lake, start, chute,
    exit: { x: lake.x, z: lake.z }, cracks, columns, roosts, dens, crabBeds, crystals, hanging, stalactites, stalagmites, mushrooms,
  };
}

// ============================================================================ runtime
const CAVE_PRESET: EnvPreset = {
  zenith: 0x5b8ad6, horizon: 0x24384a, ground: 0x0c0a10, sunColor: 0xffe0b0, sunIntensity: 2.4, sunElev: SUN_ELEV, sunAzim: SUN_AZIM,
  hemiSky: 0x4a6aa8, hemiGround: 0x2a1e2c, hemiIntensity: 1.25, fog: 0x091219, fogNear: 8, fogFar: 135, exposure: 1, stars: 0, clouds: 0, cloudColor: 0x203040,
};

const lakeVert = /* glsl */ `
varying vec3 vW;
#include <fog_pars_vertex>
void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const lakeFrag = /* glsl */ `
uniform float uTime, uLevel; uniform vec3 uDeep, uShallow, uGlow, uSky;
uniform sampler2D uHeight; uniform vec4 uHInfo;
uniform vec4 uRip[8];
uniform float uStir;
varying vec3 vW;
#include <fog_pars_fragment>
float h12(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
void main(){
  vec2 px = floor(vW.xz * 8.0) / 8.0;
  float g = texture2D(uHeight, vW.xz * uHInfo.x + uHInfo.y).r;
  float depth = clamp(uLevel - g, 0.0, 4.5) / 4.5;
  float w1 = sin(px.x * 0.9 + uTime * 0.7) * cos(px.y * 0.8 - uTime * 0.6);
  float w2 = sin(px.x * 2.3 - px.y * 1.7 + uTime * 1.3);
  // drip rings
  float ring = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 r = uRip[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 3.0 || r.w <= 0.0) continue;
    float d = distance(px, r.xy);
    float rad = age * 1.6;
    ring += smoothstep(0.18, 0.0, abs(d - rad)) * (1.0 - age / 3.0) * r.w;
  }
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 1.0, depth));
  col += (w1 * 0.025 + w2 * 0.02) * (1.0 + uStir * 3.0);
  // glowing plankton drifting below the surface, brighter where the water is stirred
  float pk = step(0.993 - uStir * 0.01, h12(floor(vW.xz * 6.0) + floor(uTime * 0.5 + h12(floor(vW.xz * 6.0)) * 7.0)));
  col += uGlow * pk * (0.6 + 0.4 * sin(uTime * 3.0 + vW.x));
  col += uGlow * ring * 0.55;
  float foam = smoothstep(0.1, 0.0, depth) * 0.5;
  col = mix(col, vec3(0.75, 0.85, 0.88), foam * 0.6);
  float fr = pow(1.0 - clamp(normalize(cameraPosition - vW).y, 0.0, 1.0), 4.0);
  col = mix(col, uSky, 0.1 + 0.45 * fr);
  gl_FragColor = vec4(col, mix(0.9, 0.7, foam));
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

/**
 * A dusty sunbeam through a ceiling crack: the crack's ellipse (O + a·U + b·V, a, b in
 * [-1, 1]) swept along the light (L). Back faces of the enclosing parallelepiped; each
 * fragment marches its view ray in unit space, integrating the soft elliptical edge,
 * flickering caustic streaks, a fade toward the floor and slow drifting dust.
 */
function shaftMaterial(O: THREE.Vector3, U: THREE.Vector3, V: THREE.Vector3, L: THREE.Vector3, color: THREE.Color, density: number) {
  const M = new THREE.Matrix4().makeBasis(U.clone().multiplyScalar(2), V.clone().multiplyScalar(2), L).setPosition(O.clone().sub(U).sub(V));
  const inv = M.clone().invert();
  return new THREE.ShaderMaterial({
    uniforms: { uInv: { value: inv }, uTime: globalUniforms.uTime, uDensity: { value: density }, uColor: { value: color }, uK: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform mat4 uInv; uniform float uTime, uDensity, uK; uniform vec3 uColor;
      varying vec3 vW;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hh(i), hh(i + vec2(1.0, 0.0)), f.x), mix(hh(i + vec2(0.0, 1.0)), hh(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){
        vec3 rdW = vW - cameraPosition;
        float tEnd = length(rdW);
        rdW /= tEnd;
        vec3 ro = (uInv * vec4(cameraPosition, 1.0)).xyz;
        vec3 rd = (uInv * vec4(rdW, 0.0)).xyz + vec3(1e-6);
        vec3 ia = 1.0 / rd;
        vec3 ta = -ro * ia, tb = (1.0 - ro) * ia;
        vec3 tmn = min(ta, tb), tmx = max(ta, tb);
        float tn = max(max(tmn.x, tmn.y), max(tmn.z, 0.0));
        float tf = min(min(min(tmx.x, tmx.y), tmx.z), tEnd);
        if (tf <= tn) discard;
        float acc = 0.0;
        for (int i = 0; i < 10; i++) {
          float t = mix(tn, tf, (float(i) + 0.5) / 10.0);
          vec3 q = ro + rd * t;
          vec2 e2 = (q.xy - 0.5) * 2.0;
          float r = length(e2);
          float edge = 1.0 - smoothstep(0.25, 1.0, r);
          edge *= edge;
          float streak = 0.55 + 0.45 * vn(vec2(atan(e2.y, e2.x) * 3.0 + q.z * 0.6, uTime * 0.25));
          float along = smoothstep(0.0, 0.12, q.z) * (1.0 - smoothstep(0.45, 1.0, q.z)) * (0.55 + 0.45 * vn(vec2(q.z * 6.0 - uTime * 0.2, atan(e2.y, e2.x) * 2.0)));
          vec3 wp = cameraPosition + rdW * t;
          float dust = 0.65 + 0.35 * vn(wp.xz * 0.9 + vec2(uTime * 0.11, -uTime * 0.07) + wp.y * 0.3);
          acc += edge * streak * along * dust;
        }
        float a = acc / 10.0 * (tf - tn) * uDensity * uK;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    fog: false,
  });
}

interface Batch {
  mesh: THREE.InstancedMesh;
}

/** World-shaped runtime for the cave (see the header). */
export class CaveWorld {
  layout: CaveLayout;
  field: Heightfield;
  terrain: Terrain;
  ceiling: Terrain;
  env: Env;
  colliders = new Colliders();
  group = new THREE.Group();
  sand = new SandWaves();
  water: THREE.Mesh;
  center: THREE.Vector3;
  sunDir = caveSunDir();
  /** the parts of the World API other systems read */
  sa: { field: Heightfield; wind: { x: number; z: number }; waterLevel: number; zones: any[]; start: { x: number; z: number; heading: number }; env: string; size: number };
  props = null;
  activeZone = 0;
  unlockedZone = 0;
  storm: any;
  lights: THREE.PointLight[] = [];
  crystalLights: { light: THREE.PointLight; base: number; phase: number }[] = [];
  shafts: { mesh: THREE.Mesh; O: THREE.Vector3; U: THREE.Vector3; V: THREE.Vector3; L: THREE.Vector3; exit: boolean }[] = [];
  /** the lake: drip ripples (x, z, start time, strength) and how stirred it is (the Olm) */
  ripples: THREE.Vector4[] = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -99, 0));
  private rip = 0;
  stir = 0;
  private batches: Batch[] = [];
  private columnMeshes: THREE.Mesh[] = [];
  private crystalMat = makeVoxelMaterial({ emissiveStrength: 2.6 });
  private drops: { x: number; z: number; t: number; y: number; land: number }[] = [];
  private dripT = 0.5;
  private chuteT = 0;
  private _g = { x: 0, z: 0 };
  private time = 0;

  constructor(public scene: THREE.Scene, seed = 1) {
    const t0 = performance.now();
    const L = (this.layout = generateCave(seed));
    this.field = L.field;
    this.center = new THREE.Vector3(L.cx, 0, L.cz);
    this.sa = { field: L.field, wind: { x: 0.12, z: 0.05 }, waterLevel: CAVE_WATER, zones: [], start: L.start, env: 'cave', size: L.size };
    // ---- the sky light, ambient and atmosphere
    this.env = new Env(scene, 'underworld', seed);
    this.env.apply({ ...CAVE_PRESET });
    this.env.shadowExtent = 100;
    this.env.sun.shadow.camera.far = 320;
    (this.env.sun.shadow as any).radius = 2.4;
    this.env.setWind(0.12, 0.05);
    this.env.setHazeFloor(-1);
    ATMO.shafts = 0.75;
    ATMO.u[10] = 6; // a deeper dust layer
    ATMO.u[11] = 0.22;
    scene.background = new THREE.Color(0x05080c);
    // ---- floor + mirrored ceiling
    this.terrain = new Terrain(L.field, this.sa.wind, this.sand);
    this.ceiling = new Terrain(L.ceil, this.sa.wind);
    this.ceiling.group.scale.y = -1;
    // the vault is cool, dark rock (no sun reaches it): tint the ceiling's strata down
    this.ceiling.material.color.setRGB(0.42, 0.42, 0.5);
    this.ceiling.group.name = 'cave-ceiling';
    this.group.add(this.terrain.group, this.ceiling.group);
    this.sand.ground = (x, z) => L.field.heightSmooth(x, z);
    scene.add(this.group);
    this.water = this.makeLake();
    this.group.add(this.water);
    this.dress();
    this.makeShafts();
    this.makeLights();
    this.storm = this.makeStorm();
    console.log(`[cave] generated in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  // ------------------------------------------------------------ the World API
  surface = (x: number, z: number, out: SurfaceInfo): SurfaceInfo => {
    const f = this.field;
    const h = f.heightSmooth(x, z) + (this.sand.n ? this.sand.offset(x, z) : 0);
    if (h < CAVE_WATER - 0.05) {
      out.h = CAVE_WATER;
      out.drag = 0.04;
      out.speedMul = 0.78;
      out.kind = 'water';
      return out;
    }
    out.h = h;
    const m = f.matAt(x, z);
    if (m === MAT.ROCK || m === MAT.DARK_ROCK || m === MAT.CRYSTAL) {
      out.drag = 0.0;
      out.speedMul = 1.1;
      out.kind = 'hard';
    } else if (m === MAT.MUD) {
      out.drag = 0.03;
      out.speedMul = 0.8;
      out.kind = 'mud';
    } else {
      out.drag = 0.008;
      out.speedMul = 1;
      out.kind = 'sand';
    }
    return out;
  };
  groundAt = (x: number, z: number) => Math.max(this.field.heightAt(x, z) + (this.sand.n ? this.sand.offset(x, z) : 0), CAVE_WATER);
  groundSmooth = (x: number, z: number) => Math.max(this.field.heightSmooth(x, z) + (this.sand.n ? this.sand.offset(x, z) : 0), CAVE_WATER);
  normal = (x: number, z: number, out: THREE.Vector3) => {
    if (this.field.heightSmooth(x, z) < CAVE_WATER) return out.set(0, 1, 0);
    this.field.normalAt(x, z, out);
    if (this.sand.n) {
      const g = this.sand.grad(x, z, this._g);
      if (g.x !== 0 || g.z !== 0) {
        const hx = -out.x / out.y + g.x, hz = -out.z / out.y + g.z;
        out.set(-hx, 1, -hz).normalize();
      }
    }
    return out;
  };
  slope = (x: number, z: number) => this.field.slopeAt(x, z);
  ceilingAt(x: number, z: number) {
    return this.layout.ceilingAt(x, z);
  }
  /** sand physics: blasts dig craters with a rim (permanent) */
  deform(x: number, z: number, radius: number, depth: number) {
    const f = this.field;
    const r = f.res;
    const i0 = Math.max(1, Math.floor((x - radius * 1.6) / r)), i1 = Math.min(f.n - 2, Math.ceil((x + radius * 1.6) / r));
    const j0 = Math.max(1, Math.floor((z - radius * 1.6) / r)), j1 = Math.min(f.n - 2, Math.ceil((z + radius * 1.6) / r));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i * r - x, j * r - z) / radius;
        if (d > 1.6) continue;
        const k = i + j * f.n;
        const m = f.baseMat[k];
        const soft = m === MAT.ROCK || m === MAT.DARK_ROCK || m === MAT.CRYSTAL ? 0.12 : 1;
        f.base[k] += ((d < 1 ? -depth * (1 - d * d) : 0) + Math.exp(-((d - 1.1) ** 2) / 0.05) * depth * 0.35) * soft;
      }
    f.recompute(x - radius * 1.7, z - radius * 1.7, x + radius * 1.7, z + radius * 1.7);
  }
  /** a random open floor point (not in the lake, away from the walls), or null */
  openSpot(rng: () => number, near?: { x: number; z: number }, rMin = 0, rMax = 60, wall = 6) {
    const L = this.layout;
    for (let t = 0; t < 40; t++) {
      const a = rng() * Math.PI * 2, r = rMin + rng() * (rMax - rMin);
      const x = (near?.x ?? L.cx) + Math.cos(a) * r, z = (near?.z ?? L.cz) + Math.sin(a) * r;
      if (L.sdf(x, z) < wall || this.field.heightAt(x, z) < CAVE_WATER + 0.1) continue;
      let hit = false;
      this.colliders.query(x, z, 3, (c) => {
        if (c.enabled && c.solid && Math.hypot(c.x - x, c.z - z) < c.r + 1.2) hit = true;
      });
      if (!hit) return { x, z, y: this.groundAt(x, z) };
    }
    return null;
  }

  /** the storm stub: the cave walls are the "storm" (keeps enemies and bosses inside) */
  private makeStorm() {
    const L = this.layout;
    return {
      strength: 0,
      near: 0,
      focusSdf: 999,
      wind: { x: 0, z: 0 },
      sdf: (x: number, z: number) => L.sdf(x, z) - 3,
      inward: (x: number, z: number, out: { x: number; z: number }) => {
        const dx = L.cx - x, dz = L.cz - z;
        const l = Math.hypot(dx, dz) || 1;
        out.x = dx / l;
        out.z = dz / l;
        return out;
      },
      devilDamageAt: () => 0,
      spawnDevil: () => {},
      strike: () => {},
      randomPointNear: (x: number, z: number) => ({ x, z }),
      update: () => {},
      bindAudio: () => {},
      dispose: () => {},
    };
  }

  // ------------------------------------------------------------ visuals
  private makeLake() {
    const f = this.field;
    const N = 256;
    const data = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) data[i + j * N] = f.heightAt((i / (N - 1)) * f.size, (j / (N - 1)) * f.size);
    const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const L = this.layout.lake;
    const R = L.r * 1.6;
    const mat = new THREE.ShaderMaterial({
      vertexShader: lakeVert,
      fragmentShader: lakeFrag,
      transparent: true,
      fog: true,
      uniforms: {
        ...atmoFogUniforms(),
        uTime: globalUniforms.uTime,
        uDeep: { value: new THREE.Color(0x03141c) },
        uShallow: { value: new THREE.Color(0x0e4a58) },
        uGlow: { value: new THREE.Color(0x6af6ff) },
        uSky: { value: new THREE.Color(0x203848) },
        uHeight: { value: tex },
        uHInfo: { value: new THREE.Vector4(1 / f.size, 0, 0, 0) },
        uLevel: { value: CAVE_WATER },
        uRip: { value: this.ripples },
        uStir: { value: 0 },
      },
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2, 1, 1), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(L.x, CAVE_WATER, L.z);
    m.renderOrder = 3;
    return m;
  }

  /** instanced set dressing + colliders */
  private dress() {
    const L = this.layout;
    const groups = new Map<string, CaveSpot[]>();
    const add = (list: CaveSpot[], tag: string) => {
      for (const s of list) {
        const k = tag + '|' + s.key;
        let g = groups.get(k);
        if (!g) groups.set(k, (g = []));
        g.push(s);
      }
    };
    add(L.crystals, 'floor');
    add(L.stalagmites, 'floor');
    add(L.mushrooms, 'floor');
    add(L.stalactites, 'ceil');
    add(L.hanging, 'hang');
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    const yq = new THREE.Quaternion();
    for (const [k, list] of groups) {
      const [tag, key] = k.split('|');
      const e = modelEntry(key);
      if (!e) continue;
      const sm = e() as { model: VoxelModel; voxelSize: number };
      if (!sm?.model) continue;
      let pivot: [number, number, number] | 'bottom' = 'bottom';
      if (tag === 'ceil') pivot = [0, 0, 0];
      const geo = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot });
      const crystal = key.startsWith('cave_crystal') || key.startsWith('cave_mushrooms');
      const mesh = new THREE.InstancedMesh(geo, crystal ? this.crystalMat : sharedVoxelMaterial, list.length);
      ensureInstFx(mesh);
      mesh.castShadow = tag !== 'ceil';
      mesh.receiveShadow = true;
      list.forEach((s, i) => {
        const S = s.scale ?? 1;
        yq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot ?? 0);
        if (tag === 'floor') {
          p.set(s.x, (s.y ?? this.field.heightAt(s.x, s.z)) - 0.08 * S, s.z);
          q.copy(yq);
        } else if (tag === 'ceil') {
          p.set(s.x, (s.y ?? 30) + 0.4, s.z);
          q.copy(yq);
        } else {
          p.set(s.x, (s.y ?? 30) + 0.3, s.z);
          q.copy(yq).multiply(flip);
        }
        sc.set(S, S, S);
        m4.compose(p, q, sc);
        mesh.setMatrixAt(i, m4);
        if (tag === 'floor' && !key.startsWith('cave_mushrooms') && (s.r ?? 0) > 0.4) this.colliders.circle(s.x, s.z, (s.r ?? 1) * 0.85, p.y - 0.5, p.y + 3 * S, { tag: 'cave', bullets: true, solid: true, data: { material: 'rock' } });
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
      this.batches.push({ mesh });
    }
    // the flowstone columns: one sculpted model each, floor to vault
    L.columns.forEach((c, i) => {
      const g = this.field.heightAt(c.x, c.z);
      const H = L.ceilingAt(c.x, c.z) - g + 1.5;
      const sm = caveColumn(H, c.r * 0.62, i * 5 + 1);
      const mesh = new THREE.Mesh(buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: [0, 0, 0] }), sharedVoxelMaterial);
      mesh.position.set(c.x, g - 0.3, c.z);
      mesh.rotation.y = i * 1.7;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.columnMeshes.push(mesh);
      this.colliders.circle(c.x, c.z, c.r * 0.62 * 0.75 + 0.4, -5, 80, { tag: 'cave', bullets: true, solid: true, data: { material: 'rock' } });
    });
  }

  private makeShafts() {
    const L = this.layout;
    const col = new THREE.Color(1.0, 0.86, 0.62);
    for (const k of L.cracks) {
      const top = L.ceilingAt(k.x + Math.cos(k.rot) * (k.hl + 2), k.z + Math.sin(k.rot) * (k.hl + 2));
      const O = new THREE.Vector3(k.x, top + 2, k.z);
      const U = new THREE.Vector3(Math.cos(k.rot), 0, Math.sin(k.rot)).multiplyScalar(k.hl * 0.9);
      const V = new THREE.Vector3(-Math.sin(k.rot), 0, Math.cos(k.rot)).multiplyScalar(k.hw * 1.1);
      const drop = top + 4 - this.field.heightAt(k.x, k.z);
      const Ld = this.sunDir.clone().multiplyScalar(-drop / this.sunDir.y);
      const geo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
      const M = new THREE.Matrix4().makeBasis(U.clone().multiplyScalar(2), V.clone().multiplyScalar(2), Ld).setPosition(O.clone().sub(U).sub(V));
      geo.applyMatrix4(M);
      const mesh = new THREE.Mesh(geo, shaftMaterial(O, U, V, Ld, col.clone(), k.exit ? 0.024 : 0.017));
      mesh.renderOrder = 10;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.shafts.push({ mesh, O, U, V, L: Ld, exit: !!k.exit });
    }
  }

  private makeLights() {
    const L = this.layout;
    const toneCol = { cyan: 0x58e6ff, violet: 0xb576ff, teal: 0x5cf0c8 };
    // the big clusters each light their part of the cave (a couple of medium ones by the lake too)
    const lit = [...L.crystals.filter((c) => c.key?.endsWith('_l')).slice(0, 7), ...L.crystals.filter((c) => c.key?.endsWith('_m')).slice(-2)];
    for (const c of lit) {
      const big = c.key!.endsWith('_l');
      const light = new THREE.PointLight(toneCol[c.tone ?? 'cyan'], big ? 60 : 26, big ? 30 : 18, 1.7);
      light.position.set(c.x, (c.y ?? 0) + (big ? 2.4 : 1.2) * (c.scale ?? 1), c.z);
      this.group.add(light);
      this.crystalLights.push({ light, base: light.intensity, phase: Math.random() * 6.28 });
    }
    for (const a of [0, 2.1, 4.2]) {
      const light = new THREE.PointLight(0x40d8e8, 34, 30, 1.6);
      light.position.set(L.lake.x + Math.cos(a) * L.lake.r * 0.45, CAVE_WATER + 1.2, L.lake.z + Math.sin(a) * L.lake.r * 0.45);
      this.group.add(light);
      this.lights.push(light);
    }
  }

  // ------------------------------------------------------------ per frame
  update(dt: number, focus: THREE.Vector3, time: number, fx: any) {
    this.time = time;
    this.sand.update(dt);
    this.terrain.update(focus, 4);
    this.ceiling.update(focus, 3);
    this.env.update(this.center, dt, time);
    ATMO.u[13] = -1;
    // crystals breathe
    for (const c of this.crystalLights) c.light.intensity = c.base * (0.86 + 0.14 * Math.sin(time * 0.9 + c.phase));
    // the lake: stir decays
    this.stir = Math.max(0, this.stir - dt * 0.25);
    (this.water.material as THREE.ShaderMaterial).uniforms.uStir.value = this.stir;
    if (fx) {
      this.chute(dt, fx);
      this.drips(dt, focus, fx);
      this.motes(dt, focus, fx);
    }
  }

  /** a ripple ring on the lake (drips, splashes, the Olm) */
  ripple(x: number, z: number, strength = 1) {
    const r = this.ripples[this.rip++ % this.ripples.length];
    r.set(x, z, this.time, strength);
  }

  /** sand trickling down the chute onto the mound */
  private chute(dt: number, fx: any) {
    const c = this.layout.chute;
    this.chuteT -= dt;
    if (this.chuteT > 0) return;
    this.chuteT = 0.05;
    const top = c.top - 1;
    fx.p.emit({ pos: { x: c.x, y: top, z: c.z }, count: 3, vel: { x: 0, y: -3, z: 0 }, spread: 0.6, jitter: c.r * 0.6, gravity: 9.8, drag: 0.1, life: [2.2, 3.2], size: [0.06, 0.1], sprite: 'dot3', color: [0xd8b47c, 0xc89c64, 0xe6c48e], ground: true });
    if (Math.random() < 0.25) fx.p.emit({ pos: { x: c.x, y: top - 2, z: c.z }, count: 1, vel: { x: 0, y: -2.5, z: 0 }, spread: 0.3, jitter: c.r * 0.5, life: [2.5, 3.5], size: [0.6, 1.4], sprite: ['puff0', 'puff1'], color: 0xb8925e, alpha: 0.3, drag: 0.6 });
  }

  /** water dripping from the stalactites near the hunter: drops fall, the lake rings, the sand darkens */
  private drips(dt: number, focus: THREE.Vector3, fx: any) {
    this.dripT -= dt;
    if (this.dripT <= 0) {
      this.dripT = 0.12 + Math.random() * 0.35;
      const st = this.layout.stalactites;
      const s = st[Math.floor(Math.random() * st.length)];
      if (s && Math.hypot(s.x - focus.x, s.z - focus.z) < 48) {
        const len = 3 * (s.scale ?? 1);
        const y0 = (s.y ?? 30) - len;
        const g = this.groundAt(s.x, s.z);
        const h = Math.max(0.5, y0 - g);
        const tFall = Math.sqrt((2 * h) / 9.8);
        fx.p.emit({ pos: { x: s.x, y: y0, z: s.z }, count: 1, vel: { x: 0, y: 0, z: 0 }, gravity: 9.8, life: [tFall, tFall], size: [0.05, 0.08], sprite: 'dot3', color: 0xd6f0ff, stretch: 0.03 });
        this.drops.push({ x: s.x, z: s.z, t: tFall, y: g, land: 0 });
      }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t -= dt;
      if (d.t > 0) continue;
      this.drops.splice(i, 1);
      if (d.y <= CAVE_WATER + 0.02) {
        this.ripple(d.x, d.z, 0.8);
        fx.p.emit({ pos: { x: d.x, y: CAVE_WATER + 0.05, z: d.z }, count: 5, spread: 1.2, up: 1.8, gravity: 9, life: [0.3, 0.6], size: [0.04, 0.03], sprite: 'dot3', color: [0xd6f0ff, 0x8ad8f0] });
      } else fx.p.emit({ pos: { x: d.x, y: d.y + 0.04, z: d.z }, count: 4, spread: 0.9, up: 1.2, gravity: 9, life: [0.2, 0.4], size: [0.04, 0.03], sprite: 'dot3', color: [0xd6f0ff, 0xb8a080], ground: true });
    }
  }

  /** dust motes glittering inside the light shafts */
  private motes(dt: number, focus: THREE.Vector3, fx: any) {
    for (const s of this.shafts) {
      if (Math.hypot(s.O.x - focus.x, s.O.z - focus.z) > 70 || Math.random() > dt * 10) continue;
      const a = (Math.random() * 2 - 1) * 0.7, b = (Math.random() * 2 - 1) * 0.7, t = 0.15 + Math.random() * 0.75;
      const p = s.O.clone().addScaledVector(s.U, a).addScaledVector(s.V, b).addScaledVector(s.L, t);
      fx.p.emit({ pos: p, count: 1, vel: { x: 0.1, y: -0.05, z: 0.06 }, jitter: 0.2, gravity: -0.01, drag: 0.2, life: [3, 5], size: [0.04, 0.05], sprite: 'dot3', color: [0xfff0c8, 0xffe0a0], additive: true, alpha: 0.9 });
    }
  }

  dispose() {
    this.terrain.dispose();
    this.ceiling.dispose();
    for (const b of this.batches) b.mesh.geometry.dispose();
    for (const m of this.columnMeshes) m.geometry.dispose();
    for (const s of this.shafts) {
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    this.water.geometry.dispose();
    (this.water.material as THREE.Material).dispose();
    this.crystalMat.dispose();
    this.group.removeFromParent();
    this.env.dispose();
  }
}
