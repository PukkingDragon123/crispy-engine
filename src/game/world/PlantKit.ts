// The 3D plant kit shared by Trees (palms, acacias, tamarisks, scrub, oasis shrubs) and
// Foliage (grass, reeds, cattails, papyrus, crops, wildflowers, dead brush).
//
// Two instanced primitives build every plant:
//  - a WOOD tube: a tapered sweep along a quadratic Bezier (trunks, limbs, twigs, frond
//    spines, reed stems, cattail heads, date clusters), bark-textured, with an optional
//    bulge, capsule or bead profile;
//  - a LEAF card: a small pixel-art card (PlantArt) bent along its own Bezier spine and
//    folded along its midrib, set at its own angle in 3D, so a crown is hundreds of cards
//    with real volume from every side, never one flat plane or a camera-facing sprite.
// Wind is branch-aware: the whole plant leans with gusts (weighted by height in the
// plant), each frond or leaf bounces on its own phase from its attachment point out, and
// card edges flutter. Angry trees (WorldLife) lean, lash and shudder through a slot
// table. Detail instances flagged LOD collapse beyond a distance.
import * as THREE from 'three';
import { plantAtlas } from './PlantArt';
import { celify, globalUniforms } from '../../engine/render/VoxelMaterial';
import { BURN, BURN_GLSL } from './NileBurn';

export const STRIDE = 28;
export const SLOTS = 16;
export type V3 = [number, number, number];

/** per-plant wind parameters (baseY/H weight the whole-plant lean, phT its phase) */
export interface Wind {
  baseY: number;
  H: number;
  phT: number;
  /** this element's own bounce: phase, amplitude (m) and weight at its start / end */
  phB: number;
  fl: number;
  bA: number;
  bB: number;
}

/** appends instances to plain arrays (swap the `wood` / `card` arrays to route into LOD buckets) */
export class PlantWriter {
  wood: number[] = [];
  card: number[] = [];
  slot = -1;
  /** a bark tube from p0 to p1 bowing through c (profile 0 taper, 1 capsule, 2 bulge, 3 beads) */
  tube(p0: V3, c: V3, p1: V3, r0: number, r1: number, prof: number, layer: number, vRep: number, tint: number, w: Wind, o: { lod?: boolean; ink?: number; uRep?: number } = {}) {
    this.wood.push(
      p0[0], p0[1], p0[2], layer,
      c[0], c[1], c[2], prof + (o.lod ? 10 : 0),
      p1[0], p1[1], p1[2], tint,
      r0, r1, vRep, this.slot,
      w.baseY, w.H, w.bA, w.bB,
      w.phT, w.phB, w.fl, 0,
      0, o.ink ?? 0, o.uRep ?? 1, 0
    );
  }
  /** a leaf card along p0 -> c -> p1, `side` spanning its width (centred, or out from the spine) */
  leaf(p0: V3, c: V3, p1: V3, side: V3, oneSided: boolean, layer: number, tint: number, w: Wind, vn: V3 | null, lod = false) {
    this.card.push(
      p0[0], p0[1], p0[2], layer,
      c[0], c[1], c[2], (oneSided ? 1 : 0) + (lod ? 10 : 0),
      p1[0], p1[1], p1[2], tint,
      side[0], side[1], side[2], this.slot,
      w.baseY, w.H, w.bA, w.bB,
      w.phT, w.phB, w.fl, 0,
      vn ? vn[0] : 0, vn ? vn[1] : 0, vn ? vn[2] : 0, 0
    );
  }
}

// ------------------------------------------------------------------ geometry
/** a ring sweep: x = angle fraction (0..1, seam duplicated), y = t along the spine */
function tubeGeo(sides: number, rings: number) {
  const P: number[] = [], I: number[] = [];
  for (let r = 0; r < rings; r++) for (let s = 0; s <= sides; s++) P.push(s / sides, r / (rings - 1), 0);
  const W = sides + 1;
  for (let r = 0; r < rings - 1; r++)
    for (let s = 0; s < sides; s++) {
      const a = r * W + s, b = a + 1, c = a + W + 1, d = a + W;
      I.push(a, b, c, a, c, d);
    }
  return finish(P, I);
}
/** a card grid: x = u across (0..1), y = t along */
function cardGeo(cols: number, rows: number) {
  const P: number[] = [], I: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) P.push(c / (cols - 1), r / (rows - 1), 0);
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      I.push(a, b, e, a, e, d);
    }
  return finish(P, I);
}
function finish(P: number[], I: number[]) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(P.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(I);
  g.instanceCount = 0;
  return g;
}

// ------------------------------------------------------------------ shaders
export interface PlantUniforms {
  uWind: { value: THREE.Vector2 };
  uShake: { value: THREE.Vector4[] };
  /** whole-plant lean (m per m of plant height at the top) */
  uAmp: { value: number };
  /** LOD-flagged instances collapse beyond this camera distance */
  uLod: { value: number };
  /** card base darkening (contact / inner shade) */
  uAo: { value: number };
  uFocus: { value: THREE.Vector3 };
  uRad: { value: number };
}
export function plantUniforms(amp: number, lod: number, ao: number): PlantUniforms {
  return {
    uWind: { value: new THREE.Vector2(1, 0) },
    uShake: { value: Array.from({ length: SLOTS }, () => new THREE.Vector4()) },
    uAmp: { value: amp },
    uLod: { value: lod },
    uAo: { value: ao },
    uFocus: { value: new THREE.Vector3() },
    uRad: { value: 1e6 },
  };
}

const HEAD = /* glsl */ `
attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute vec4 iD; attribute vec4 iE; attribute vec4 iF; attribute vec4 iG;
uniform float uTime, uAmp, uLod, uAo, uRad;
uniform vec2 uWind;
uniform vec3 uFocus;
uniform vec4 uShake[${SLOTS}];
varying vec3 vUv3;
varying float vTint, vNear, vBurnt, vInk;
${BURN_GLSL}
vec3 pBez(float t) { float s = 1.0 - t; return s * s * iA.xyz + 2.0 * s * t * iB.xyz + t * t * iC.xyz; }
vec3 pBezD(float t) { return 2.0 * (1.0 - t) * (iB.xyz - iA.xyz) + 2.0 * t * (iC.xyz - iB.xyz) + vec3(0.0, 1e-5, 0.0); }
#ifdef PLANT_WOOD
vec3 plantShape(vec3 pos, out vec3 nrm, out float edge) {
  float t = pos.y, a = pos.x * 6.2831853;
  float kind = mod(iB.w, 10.0);
  vec3 sp = pBez(t), T = normalize(pBezD(t));
  vec3 ax = iC.xyz - iA.xyz;
  vec3 ref = abs(ax.y) > 0.7 * length(ax) ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 Bn = normalize(cross(T, ref)), Nn = cross(Bn, T);
  float r = mix(iD.x, iD.y, t);
  if (kind > 0.5 && kind < 1.5) r *= pow(max(0.0, sin(t * 3.14159)), 0.55);
  else if (kind > 1.5 && kind < 2.5) r *= 0.94 + 0.13 * sin(t * 3.14159);
  else if (kind > 2.5) r *= pow(max(0.0, sin(t * 3.14159)), 0.45) * (1.0 + 0.14 * sin(a * 3.0 + t * 17.0) * sin(t * 23.0 + a));
  nrm = cos(a) * Nn + sin(a) * Bn;
  edge = 0.0;
  vUv3 = vec3(pos.x * iG.z, t * iD.z, iA.w);
  vInk = iG.y;
  vTint = iC.w;
  return sp + nrm * r;
}
#else
vec3 plantShape(vec3 pos, out vec3 nrm, out float edge) {
  float u = pos.x, t = pos.y;
  float one = mod(iB.w, 10.0);
  vec3 sp = pBez(t), T = normalize(pBezD(t));
  float uo = one > 0.5 ? u : u - 0.5;
  vec3 S = iD.xyz;
  vec3 N = normalize(cross(T, S) + vec3(0.0, 1e-5, 0.0));
  // folded along the midrib (or curled across a leaflet strip): no card is ever a flat plane
  float fold = one > 0.5 ? u * (1.0 - u) * 0.9 : (0.25 - uo * uo) * 1.2;
  vec3 p = sp + S * uo + N * fold * length(S) * 0.45;
  edge = one > 0.5 ? u : abs(uo) * 2.0;
  vec3 vn = iG.xyz;
  // crowns are lit as volumes (the card's place on the crown); ground cover as turf
  if (dot(vn, vn) > 0.25) nrm = normalize(vn + N * 0.35 * sign(dot(N, vn) + 1e-3));
  else nrm = normalize(vec3(0.0, 1.0, 0.0) + N * 0.3 * sign(N.y + 1e-3) + T * 0.15);
  vUv3 = vec3(clamp(u, 0.01, 0.99), t * 0.992 + 0.004, iA.w);
  vInk = 0.0;
  vTint = iC.w * mix(uAo, 1.0, t);
  return p;
}
#endif
vec3 plantWind(vec3 p, float t, vec3 nrm, float edge) {
  float k = clamp((p.y - iE.x) / max(0.2, iE.y), 0.0, 1.4);
  float kb = mix(iE.z, iE.w, t);
  vec2 wd = normalize(uWind + vec2(1e-4));
  float g = 0.6 + 0.4 * sin(uTime * 0.55 + iF.x * 0.37);
  float sT = (0.55 + 0.45 * sin(uTime * 1.25 + iF.x)) * g;
  float sB = sin(uTime * 2.3 + iF.y) * (0.45 + 0.55 * g);
  vec3 d = vec3(wd.x, 0.0, wd.y) * (sT * k * k * iE.y * uAmp);
  d += vec3(wd.x * 0.5, 0.4, wd.y * 0.5) * (sB * kb * iF.z);
  d += nrm * (sin(uTime * 6.1 + iF.y * 4.0 + edge * 2.5 + t * 2.0) * iF.z * 0.35 * edge * kb);
  if (iD.w > -0.5) {
    vec4 s = uShake[int(iD.w + 0.5)];
    d.xz += s.xy * k * k;
    d.y -= length(s.xy) * k * k * 0.25;
    d += vec3(sin(uTime * 37.0 + p.y * 2.3), 0.3 * sin(uTime * 29.0 + p.y), cos(uTime * 33.0 + p.y * 1.7)) * s.z * k;
  }
  return d;
}
vec3 plantFinish(vec3 p, vec3 nrm, float edge) {
  vec3 root = iA.xyz;
#ifdef PLANT_FADE
  // ground cover grows out of the sand at the edge of the scatter radius instead of popping
  float fade = 1.0 - smoothstep(uRad * 0.78, uRad, distance(root.xz, uFocus.xz));
  p = fade < 0.01 ? root : root + (p - root) * vec3(mix(0.4, 1.0, fade), fade, mix(0.4, 1.0, fade));
#endif
  vBurnt = burnSmooth(root.xz);
#ifdef PLANT_FADE
  p.y = iE.x + (p.y - iE.x) * (1.0 - 0.75 * vBurnt);
#endif
  p += plantWind(p, position.y, nrm, edge);
#ifndef PLANT_DEPTH
  if (iB.w > 9.5 && distance(root, cameraPosition) > uLod) p = root;
  vNear = smoothstep(1.2, 3.0, distance(p, cameraPosition));
#endif
  return p;
}
`;

function defines(wood: boolean, fade: boolean, depth: boolean) {
  const d: Record<string, string> = {};
  if (wood) d.PLANT_WOOD = '';
  if (fade) d.PLANT_FADE = '';
  if (depth) d.PLANT_DEPTH = '';
  return d;
}
function bind(sh: THREE.WebGLProgramParametersWithUniforms, tex: THREE.Texture, U: PlantUniforms) {
  sh.uniforms.uSpr = { value: tex };
  sh.uniforms.uTime = globalUniforms.uTime;
  sh.uniforms.uBurn = BURN;
  for (const [k, v] of Object.entries(U)) sh.uniforms[k] = v;
}

function makeMaterial(wood: boolean, fade: boolean, tex: THREE.Texture, U: PlantUniforms) {
  const m = new THREE.MeshStandardMaterial({ roughness: wood ? 0.86 : 0.92, metalness: 0, side: wood ? THREE.FrontSide : THREE.DoubleSide });
  m.defines = defines(wood, fade, false);
  m.onBeforeCompile = (sh) => {
    bind(sh, tex, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + HEAD)
      .replace('#include <beginnormal_vertex>', 'vec3 plN; float plE; vec3 plP = plantShape(position, plN, plE);\nvec3 objectNormal = plN;')
      .replace('#include <begin_vertex>', 'vec3 transformed = plantFinish(plP, plN, plE);');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform highp sampler2DArray uSpr;
        varying vec3 vUv3; varying float vTint, vNear, vBurnt, vInk;`
      )
      // leaf cards are lit from both faces by their crown normal (no back-face flip)
      .replace('#include <normal_fragment_begin>', wood ? '#include <normal_fragment_begin>' : THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace(
        '#include <map_fragment>',
        `if (vNear < 0.999 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > vNear) discard;
        vec4 spr = texture(uSpr, vUv3, ${wood ? '0.0' : '-0.6'});
        if (spr.a < 0.5) discard;
        diffuseColor.rgb *= mix(spr.rgb * vTint, vec3(0.06, 0.045, 0.04), smoothstep(0.05, 0.5, vBurnt));`
      )
      // thin ink only round the big trunks; the leaf cards carry their own pixel outline
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n        gl_FragColor.a = vInk;');
    celify(sh);
  };
  m.customProgramCacheKey = () => `plant3d-${wood ? 'w' : 'c'}${fade ? 'f' : ''}-v1`;
  return m;
}

function makeDepth(wood: boolean, fade: boolean, tex: THREE.Texture, U: PlantUniforms) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.defines = defines(wood, fade, true);
  m.onBeforeCompile = (sh) => {
    bind(sh, tex, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + HEAD)
      .replace('#include <begin_vertex>', 'vec3 plN; float plE; vec3 plP = plantShape(position, plN, plE);\nvec3 transformed = plantFinish(plP, plN, plE);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray uSpr;\nvarying vec3 vUv3;')
      .replace('#include <alphatest_fragment>', wood ? '' : 'if (texture(uSpr, vUv3).a < 0.5) discard;');
  };
  m.customProgramCacheKey = () => `plant3d-depth-${wood ? 'w' : 'c'}${fade ? 'f' : ''}-v1`;
  return m;
}

/** one instanced draw of wood tubes or leaf cards */
export class PlantLayer {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  private buf: THREE.InstancedInterleavedBuffer | null = null;
  constructor(public wood: boolean, fine: boolean, U: PlantUniforms, o: { fade?: boolean; shadow?: boolean; name: string }) {
    const tex = plantAtlas();
    this.geo = wood ? tubeGeo(fine ? 8 : 5, 5) : fine ? cardGeo(3, 5) : cardGeo(2, 4);
    this.mesh = new THREE.Mesh(this.geo, makeMaterial(wood, !!o.fade, tex, U));
    if (o.shadow) this.mesh.customDepthMaterial = makeDepth(wood, !!o.fade, tex, U);
    this.mesh.name = o.name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !!o.shadow;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
  }
  /** (re)bind a new instance array (static plants) */
  set(a: Float32Array) {
    this.buf = new THREE.InstancedInterleavedBuffer(a, STRIDE, 1);
    this.bindAttrs();
    this.geo.instanceCount = a.length / STRIDE;
  }
  /** a fixed-capacity dynamic buffer (streamed plants) */
  alloc(cap: number) {
    this.buf = new THREE.InstancedInterleavedBuffer(new Float32Array(cap * STRIDE), STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    this.bindAttrs();
    this.geo.instanceCount = 0;
    return this.buf.array as Float32Array;
  }
  commit(n: number) {
    const b = this.buf!;
    this.geo.instanceCount = n;
    b.needsUpdate = true;
    b.clearUpdateRanges();
    b.addUpdateRange(0, n * STRIDE);
  }
  get array() {
    return this.buf ? (this.buf.array as Float32Array) : null;
  }
  touch() {
    if (this.buf) this.buf.needsUpdate = true;
  }
  private bindAttrs() {
    const b = this.buf!;
    ['iA', 'iB', 'iC', 'iD', 'iE', 'iF', 'iG'].forEach((n, i) => this.geo.setAttribute(n, new THREE.InterleavedBufferAttribute(b, 4, i * 4)));
  }
  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.customDepthMaterial?.dispose();
    this.mesh.removeFromParent();
  }
}

// ------------------------------------------------------------------ small vector helpers for the builders
export const v3 = (x: number, y: number, z: number): V3 => [x, y, z];
export const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** a direction from yaw (around +Y, 0 = +X) and elevation */
export const dir = (yaw: number, el: number): V3 => [Math.cos(yaw) * Math.cos(el), Math.sin(el), Math.sin(yaw) * Math.cos(el)];
/** quadratic Bezier point */
export const sc3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const len3 = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
/** horizontal unit perpendicular to a direction */
export const perpH = (d: V3): V3 => norm([-d[2], 0, d[0]]);
/** rotate v round the unit axis k by angle a */
export const rotAx = (v: V3, k: V3, a: number): V3 => {
  const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [v[0] * c + kv[0] * s + k[0] * d * (1 - c), v[1] * c + kv[1] * s + k[1] * d * (1 - c), v[2] * c + kv[2] * s + k[2] * d * (1 - c)];
};
/** a Bezier control that makes the curve pass through m at t = 0.5 */
export const thru = (a: V3, m: V3, b: V3): V3 => [2 * m[0] - (a[0] + b[0]) / 2, 2 * m[1] - (a[1] + b[1]) / 2, 2 * m[2] - (a[2] + b[2]) / 2];
export const bez = (p0: V3, c: V3, p1: V3, t: number): V3 => {
  const s = 1 - t;
  return [s * s * p0[0] + 2 * s * t * c[0] + t * t * p1[0], s * s * p0[1] + 2 * s * t * c[1] + t * t * p1[1], s * s * p0[2] + 2 * s * t * c[2] + t * t * p1[2]];
};
