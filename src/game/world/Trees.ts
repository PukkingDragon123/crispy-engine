// Impostor trees and bushes: 2D pixel-art sprites (PlantArt) assembled into 3D volume.
// A tree is a camera-facing cylindrical trunk, a cluster of spherical leaf-clump
// billboards placed in 3D (they parallax and overlap as you circle it) and, for palms,
// fixed drooping frond planes radiating from the crown. Every piece is one instance of a
// single instanced draw; the sun lights each clump as a ball of leaves (analytic sphere
// normals), the wind bends the crowns, and angry trees (WorldLife) lean, shake and lash
// through a small slot table of uniforms. Species: date palm, acacia, tamarisk, desert
// scrub and flowering oasis shrub.
import * as THREE from 'three';
import { plantAtlas, ART, LS, PALM_BEND, type Rect } from './PlantArt';
import { celify, globalUniforms } from '../../engine/render/VoxelMaterial';
import { BURN, BURN_GLSL } from './NileBurn';
import type { World } from './World';
import type { Collider } from './Colliders';

export type TreeKind = 'palm' | 'acacia' | 'tamarisk' | 'scrub' | 'shrub';
export const TREE_KINDS = new Set(['palm', 'acacia', 'tamarisk', 'bush', 'shrub']);

export interface TreeRef {
  id: number;
  kind: TreeKind;
  x: number;
  y: number;
  z: number;
  h: number;
  /** instance range in the buffer */
  i0: number;
  i1: number;
  collider: Collider | null;
  /** shake slot (-1 none) driven by WorldLife */
  slot: number;
  /** some trees wake up angry when attacked */
  ornery: boolean;
}

const STRIDE = 20;
export const SLOTS = 16;

function quad() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

const VERT_HEAD = /* glsl */ `
attribute vec4 iA; // x y z yaw
attribute vec4 iB; // w h mode slot
attribute vec4 iC; // uv rect u0 v0 u1 v1
attribute vec4 iD; // layer, hBase, treeH, tint
attribute vec4 iE; // crown offset along the trunk billboard, phase
uniform float uTime;
uniform vec2 uWind;
uniform vec4 uShake[${SLOTS}];
varying vec3 vSpr;
varying vec2 vQ;
varying float vMode;
varying float vTint;
varying float vNear;
varying float vBurnt;
${BURN_GLSL}
vec3 plantPos(vec3 position) {
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 hr = normalize(vec3(camR.x, 0.0, camR.z) + vec3(1e-5, 0.0, 0.0));
  float mode = iB.z;
  vec2 q = position.xy;
  vec3 off;
  if (mode < 0.5) off = hr * (q.x - 0.5) * iB.x + vec3(0.0, q.y * iB.y, 0.0);
  else if (mode < 1.5) off = camR * (q.x - 0.5) * iB.x + camU * (q.y - 0.5) * iB.y;
  else off = vec3(sin(iA.w), 0.0, cos(iA.w)) * q.x * iB.x + vec3(0.0, (q.y - 0.72) * iB.y, 0.0);
  off += hr * iE.x;
  float above = iD.y + off.y;
  float k = clamp(above / max(0.5, iD.z), 0.0, 1.3);
  float ph = iE.y + uTime * 1.25;
  vec2 wd = normalize(uWind + vec2(1e-4));
  float gust = 0.6 + 0.4 * sin(uTime * 0.55 + iA.x * 0.05 - iA.z * 0.04);
  float sway = (0.55 + 0.45 * sin(ph)) * gust * k * k * iD.z * 0.04;
  vec3 p = iA.xyz + off;
  p.xz += wd * sway;
  // leaves flutter at the edges of every clump and along the fronds
  if (mode > 0.5) p += vec3(wd.x, 0.35, wd.y) * sin(uTime * 5.3 + iE.y * 7.0 + q.x * 3.0 + q.y * 2.0) * 0.035 * k;
  // an angry tree: lean (lash) toward its target and shudder
  if (iB.w > -0.5) {
    vec4 s = uShake[int(iB.w + 0.5)];
    p.xz += s.xy * k * k;
    p.y -= length(s.xy) * k * k * 0.25;
    p += vec3(sin(uTime * 37.0 + above * 2.3), 0.3 * sin(uTime * 29.0 + above), cos(uTime * 33.0 + above * 1.7)) * s.z * k;
  }
  vBurnt = burnSmooth(iA.xz);
  vSpr = vec3(mix(iC.xy, iC.zw, q), iD.x);
  vQ = q;
  vMode = mode;
  vTint = iD.w;
  vNear = smoothstep(1.2, 3.0, distance(p, cameraPosition));
  return p;
}
`;

function makeMaterial(tex: THREE.Texture, uWind: { value: THREE.Vector2 }, uShake: { value: THREE.Vector4[] }) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSpr = { value: tex };
    sh.uniforms.uTime = globalUniforms.uTime;
    sh.uniforms.uWind = uWind;
    sh.uniforms.uShake = uShake;
    sh.uniforms.uBurn = BURN;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = iB.z > 1.5 ? vec3(cos(iA.w), 0.0, -sin(iA.w)) : normalize(vec3(cameraPosition.x - iA.x, 0.0, cameraPosition.z - iA.z) + vec3(1e-4));`
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = plantPos(position);');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform highp sampler2DArray uSpr;
        varying vec3 vSpr; varying vec2 vQ; varying float vMode; varying float vTint; varying float vNear; varying float vBurnt;`
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        // lit as volumes: a round trunk, a ball of leaves, a frond that catches the sky
        if (vMode < 0.5) { float x = vQ.x * 2.0 - 1.0; normal = normalize(vec3(x * 0.85, 0.12, sqrt(max(0.05, 1.0 - x * x)))); }
        else if (vMode < 1.5) { vec2 q = vQ * 2.0 - 1.0; normal = normalize(vec3(q.x * 0.75, q.y * 0.75 + 0.2, 1.0)); }
        else normal = normalize(normal + vec3(0.0, 0.5, 0.0));`
      )
      .replace(
        '#include <map_fragment>',
        `if (vNear < 0.999 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > vNear) discard;
        vec4 spr = texture(uSpr, vSpr);
        if (spr.a < 0.5) discard;
        diffuseColor.rgb *= mix(spr.rgb * vTint, vec3(0.06, 0.045, 0.04), smoothstep(0.05, 0.5, vBurnt));`
      )
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n        gl_FragColor.a = 0.0;');
    celify(sh);
  };
  m.customProgramCacheKey = () => 'plant-impostor-v1';
  return m;
}

/** depth material for the sun's shadow map: same billboards, cut out by the sprite alpha */
function makeDepth(tex: THREE.Texture, uWind: { value: THREE.Vector2 }, uShake: { value: THREE.Vector4[] }) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSpr = { value: tex };
    sh.uniforms.uTime = globalUniforms.uTime;
    sh.uniforms.uWind = uWind;
    sh.uniforms.uShake = uShake;
    sh.uniforms.uBurn = BURN;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_HEAD).replace('#include <begin_vertex>', 'vec3 transformed = plantPos(position);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray uSpr;\nvarying vec3 vSpr;')
      .replace('#include <alphatest_fragment>', 'if (texture(uSpr, vSpr).a < 0.5) discard;');
  };
  m.customProgramCacheKey = () => 'plant-impostor-depth-v1';
  return m;
}

const rectUV = (r: Rect) => [r.x / LS, r.y / LS, (r.x + r.w) / LS, (r.y + r.h) / LS, r.l] as const;

export class Trees {
  mesh: THREE.Mesh;
  list: TreeRef[] = [];
  private geo: THREE.InstancedBufferGeometry;
  private data: number[] = [];
  private arr: Float32Array | null = null;
  private dirty = false;
  private uWind = { value: new THREE.Vector2(1, 0) };
  /** shake slots: xy lean (m at the crown), z shudder amplitude */
  uShake = { value: Array.from({ length: SLOTS }, () => new THREE.Vector4()) };
  private static by = new WeakMap<World, Trees>();
  static of(w: World) {
    return Trees.by.get(w) ?? null;
  }

  constructor(private world: World) {
    const tex = plantAtlas();
    this.geo = quad();
    this.geo.instanceCount = 0;
    this.uWind.value.set(world.sa.wind.x, world.sa.wind.z);
    this.mesh = new THREE.Mesh(this.geo, makeMaterial(tex, this.uWind, this.uShake));
    this.mesh.customDepthMaterial = makeDepth(tex, this.uWind, this.uShake);
    this.mesh.name = 'trees';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    Trees.by.set(world, this);
  }

  private piece(x: number, y: number, z: number, yaw: number, w: number, h: number, mode: number, r: Rect, hBase: number, treeH: number, tint: number, crownOff: number, phase: number) {
    const [u0, v0, u1, v1, l] = rectUV(r);
    this.data.push(x, y, z, yaw, w, h, mode, -1, u0, v0, u1, v1, l, hBase, treeH, tint, crownOff, phase, 0, 0);
  }

  /** plant a tree or bush (anchor kinds: palm, acacia, tamarisk, bush = desert scrub, shrub) */
  add(anchorKind: string, variant: number, x: number, z: number, rot: number, scale: number) {
    const kind: TreeKind = anchorKind === 'bush' ? 'scrub' : (anchorKind as TreeKind);
    const y = this.world.groundAt(x, z) - 0.06;
    let seed = (Math.imul(Math.round(x * 13), 73856093) ^ Math.imul(Math.round(z * 13), 19349663)) >>> 0;
    const rnd = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
      return seed / 4294967296;
    };
    const i0 = this.data.length / STRIDE;
    const ph = rnd() * 6.28;
    let H = 1, colR = 0;
    const clumps = (rects: readonly Rect[], n: number, cy: number, rx: number, ry: number, s0: number, s1: number, extra?: { rect: Rect; k: number }) => {
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
        const px = Math.cos(a) * rx * rr, pz = Math.sin(a) * rx * rr;
        const py = cy + (rnd() * 2 - 1) * ry * Math.sqrt(1 - rr * rr * 0.6);
        const s = (s0 + rnd() * (s1 - s0)) * scale;
        const rect = extra && rnd() < extra.k ? extra.rect : rects[Math.floor(rnd() * rects.length)];
        // lower / inner clumps sit in shade, the crown top catches the light
        const tint = 0.78 + 0.3 * THREE.MathUtils.clamp((py - (cy - ry)) / (2 * ry + 1e-3), 0, 1);
        this.piece(x + px, y + py, z + pz, 0, s, s, 1, rect, py, H, tint, 0, ph + i * 0.7);
      }
    };
    switch (kind) {
      case 'palm': {
        H = (5.3 + rnd() * 1.9) * scale;
        const t = variant % 2;
        // the sprite's crown sits right of centre by the trunk's bend (see PlantArt.palmTrunk)
        const bend = PALM_BEND[t];
        this.piece(x, y, z, 0, H * 0.5, H, 0, ART.palmTrunk[t], 0, H, 1, 0, ph);
        const crownOff = ((bend * 0.45) / 64) * H * 0.5;
        const nF = 10 + Math.floor(rnd() * 3);
        for (let i = 0; i < nF; i++) {
          const yaw = rot + (i / nF) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
          const fw = (2.5 + rnd() * 0.8) * scale * (H / 6.2);
          this.piece(x, y + H - 0.12, z, yaw, fw, fw * 0.5, 2, ART.frond[i % 2], H - 0.1, H, 0.9 + rnd() * 0.2, crownOff, ph + i);
        }
        this.piece(x, y + H - 0.05, z, 0, 1.5 * scale, 1.5 * scale, 1, ART.palmCrown, H, H, 0.95, crownOff, ph);
        if (rnd() < 0.7) this.piece(x, y + H - 0.75 * scale, z, 0, 1.1 * scale, 1.1 * scale, 1, ART.dates, H - 0.6, H, 1, crownOff, ph);
        colR = 0.32;
        break;
      }
      case 'acacia': {
        H = (4.2 + rnd() * 1.1) * scale;
        this.piece(x, y, z, 0, H * 0.5, H, 0, ART.acaciaTrunk, 0, H, 1, 0, ph);
        const Rc = (2.6 + rnd() * 0.9) * scale;
        clumps(ART.acacia, 14, H * 0.93, Rc, 0.38 * scale, 1.45, 2.0);
        colR = 0.34;
        break;
      }
      case 'tamarisk': {
        H = (3.5 + rnd() * 1.0) * scale;
        this.piece(x, y, z, 0, H * 0.375, H * 0.75, 0, ART.tamariskTrunk, 0, H, 1, 0, ph);
        clumps(ART.tamarisk, 15, H * 0.64, 1.5 * scale, 1.05 * scale, 1.05, 1.5, { rect: ART.tamariskPink, k: 0.32 });
        colR = 0.38;
        break;
      }
      case 'scrub': {
        H = 1.0 * scale;
        clumps(ART.scrub, 5, 0.42 * scale, 0.7 * scale, 0.18 * scale, 0.75, 1.05);
        break;
      }
      case 'shrub': {
        H = 1.2 * scale;
        clumps(ART.shrub, 6, 0.55 * scale, 0.8 * scale, 0.22 * scale, 0.85, 1.15, { rect: ART.shrubBloom, k: 0.35 });
        break;
      }
    }
    const t: TreeRef = { id: this.list.length, kind, x, y, z, h: H, i0, i1: this.data.length / STRIDE, collider: null, slot: -1, ornery: false };
    // about a third of the big trees are ornery: shoot one and it wakes up swinging
    t.ornery = H > 3 && rnd() < 0.36;
    if (colR > 0) t.collider = this.world.colliders.circle(x, z, colR * scale, y, y + H * 0.7, { data: { material: 'wood', tree: t } });
    this.list.push(t);
    this.dirty = true;
    return t;
  }

  /** route a tree into (or out of) a shake slot */
  setSlot(t: TreeRef, slot: number) {
    t.slot = slot;
    const a = this.arr;
    if (!a) return;
    for (let i = t.i0; i < t.i1; i++) a[i * STRIDE + 7] = slot;
    const attr = this.geo.getAttribute('iB') as THREE.InterleavedBufferAttribute;
    attr.data.needsUpdate = true;
  }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    const a = (this.arr = new Float32Array(this.data));
    for (const t of this.list) if (t.slot >= 0) for (let i = t.i0; i < t.i1; i++) a[i * STRIDE + 7] = t.slot;
    const buf = new THREE.InstancedInterleavedBuffer(a, STRIDE, 1);
    this.geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    this.geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    this.geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
    this.geo.setAttribute('iD', new THREE.InterleavedBufferAttribute(buf, 4, 12));
    this.geo.setAttribute('iE', new THREE.InterleavedBufferAttribute(buf, 4, 16));
    this.geo.instanceCount = a.length / STRIDE;
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.customDepthMaterial?.dispose();
    this.mesh.removeFromParent();
  }
}
