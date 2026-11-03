// The living sandstorm that walls in every zone.
//  - The allowed play space is an SDF: the union of zone discs + corridor capsules, all
//    animatable (radius / width / how far along its length a corridor is open / where a
//    disc's centre sits), so the storm can part, sweep and swallow.
//  - It is drawn as a towering, roiling wall of sand: three ribbon walls following the
//    union's offset outlines (7 / 26 / 60 m out, 70 / 170 / 320 m tall, leaning outward as
//    they rise), shaded from a tileable 3D noise volume (domain-warped billows rolling up
//    and racing downwind, lit crowns and shadowed bellies on a cel ramp, a gold silver
//    lining when the sun is behind it), plus a low curtain of racing sand at its foot.
//  - Lightning flickers inside it (internal glow + branching bolts, thunder by distance),
//    debris (tumbleweeds, planks, wheels, rocks) whirls along its face, pixel sand blows
//    out of it as you approach, and a positional howl rises the closer you ride.
// The murk (visibility collapsing into orange haze near and inside it) is driven by World.
import * as THREE from 'three';
import { globalUniforms, atmoFogUniforms, sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { rnd, RNG, smoothstep, clamp } from '../../engine/math/rand';
import { tumbleweed, rock, wagonWheel } from '../models/props';
import { plankDebris } from '../models/props/ruins';

export interface StormDisc { id: string; x: number; z: number; r: number; target: number; speed: number; tx: number; tz: number; mspeed: number }
export interface StormCapsule {
  id: string;
  ax: number; az: number; bx: number; bz: number;
  w: number; target: number; speed: number;
  /** open span along a->b (0..1): the storm parts from a toward b, and closes from a again */
  s0: number; s1: number; s0t: number; s1t: number; sspeed: number;
}
export interface DustDevil { x: number; z: number; vx: number; vz: number; r: number; life: number; dps: number; mesh: THREE.Group }

// ---------------------------------------------------------------------------
// tileable 3D value noise (32^3, two octaves baked) for the wall shader
let noiseTex: THREE.Data3DTexture | null = null;
function stormNoise() {
  if (noiseTex) return noiseTex;
  const N = 32;
  const rng = new RNG(90210);
  const lat = (P: number) => {
    const v = new Float32Array(P * P * P);
    for (let i = 0; i < v.length; i++) v[i] = rng.next();
    return (x: number, y: number, z: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      const fx = x - xi, fy = y - yi, fz = z - zi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
      const at = (a: number, b: number, c: number) => v[(((a % P) + P) % P) + ((((b % P) + P) % P) + (((c % P) + P) % P) * P) * P];
      const l = (a: number, b: number, t: number) => a + (b - a) * t;
      return l(
        l(l(at(xi, yi, zi), at(xi + 1, yi, zi), sx), l(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), sx), sy),
        l(l(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), sx), l(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), sx), sy),
        sz
      );
    };
  };
  const o1 = lat(8), o2 = lat(16);
  const data = new Uint8Array(N * N * N);
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const v = o1((x / N) * 8, (y / N) * 8, (z / N) * 8) * 0.68 + o2((x / N) * 16, (y / N) * 16, (z / N) * 16) * 0.32;
        data[x + (y + z * N) * N] = Math.round(clamp(v, 0, 1) * 255);
      }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RedFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  noiseTex = t;
  return t;
}

// ---------------------------------------------------------------------------
// the storm walls
const wallVert = /* glsl */ `
attribute vec2 aN;
attribute vec2 aUV;
uniform float uTime, uBillow;
varying vec3 vWP;
varying float vV;
#include <fog_pars_vertex>
void main(){
  vec3 p = position;
  float v = aUV.y;
  // the face roils: slow bulges pushing out and sucking back along the outward normal
  float b = sin(p.x * 0.021 + uTime * 0.31 + p.y * 0.013) * sin(p.z * 0.019 - uTime * 0.23 + p.y * 0.011)
          + 0.5 * sin(p.x * 0.047 - uTime * 0.53 + p.z * 0.031);
  p.xz += aN * b * uBillow * (0.25 + v);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWP = wp.xyz;
  vV = v;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const wallFrag = /* glsl */ `
precision highp sampler3D;
uniform sampler3D uNoise;
uniform float uTime, uOpacity, uDensity, uScale, uRise, uSeed;
uniform vec3 uSunDirW, uSunCol, uLit, uDeep, uHigh;
uniform vec2 uWind;
uniform vec4 uFlash[4];
uniform vec3 uFlashCol;
varying vec3 vWP;
varying float vV;
#include <fog_pars_fragment>
float n3(vec3 p){ return texture(uNoise, p).r; }
float fbm(vec3 p){ return (n3(p) * 0.5 + n3(p * 2.03 + 0.17) * 0.25 + n3(p * 4.07 + 0.41) * 0.125 + n3(p * 8.11 + 0.73) * 0.0625) / 0.9375; }
float fbm3(vec3 p){ return (n3(p) * 0.5 + n3(p * 2.03 + 0.17) * 0.25 + n3(p * 4.07 + 0.41) * 0.125) / 0.875; }
void main(){
  vec3 w = vWP;
  float t = uTime;
  // billows roll up the wall and race along it with the wind
  vec3 q = w * uScale + vec3(uSeed);
  q.y -= t * uRise;
  q.xz -= uWind * t * uScale * 9.0;
  vec3 warp = vec3(n3(q * 0.5 + vec3(0.0, t * 0.004, 0.0)), n3(q * 0.5 + 3.3), n3(q * 0.5 - 1.7)) - 0.5;
  q += warp * 0.55;
  float n = fbm(q);
  // thick and dark at the foot, breaking into towering crowns up high
  float body = mix(1.28, 0.46, pow(vV, 0.75)) * uDensity;
  float dens = smoothstep(0.34, 0.74, n * body + (1.0 - vV) * 0.18);
  float crown = 0.8 + 0.2 * n3(vec3(w.x, 0.0, w.z) * uScale * 0.8 + vec3(uSeed, t * 0.006, 0.0));
  dens *= smoothstep(crown, crown - 0.2, vV);
  // one step toward the sun through the volume: lit crowns, shadowed bellies (cel ramp)
  float n2 = fbm3(q + uSunDirW * 0.07);
  float lit = clamp(0.55 + (n - n2) * 7.0, 0.0, 1.0);
  float band = lit < 0.36 ? 0.12 : lit < 0.68 ? 0.52 : 0.95;
  lit = mix(lit, band, 0.7);
  vec3 sky = vec3(0.30, 0.32, 0.38);
  vec3 sun = uSunCol * 0.28;
  vec3 alb = mix(uDeep, uLit, smoothstep(0.1, 0.9, lit));
  alb = mix(alb, uHigh, smoothstep(0.3, 1.0, vV) * 0.55);
  vec3 col = alb * (sky * 1.05 + sun * lit * mix(0.55, 1.0, vV));
  col *= mix(0.62, 1.0, smoothstep(0.0, 0.35, vV));
  // sun behind the wall: a gold lining where the billows thin out
  vec3 vd = normalize(w - cameraPosition);
  float back = pow(max(dot(vd, uSunDirW), 0.0), 5.0);
  col += uSunCol * vec3(1.0, 0.78, 0.5) * back * (1.0 - dens) * 0.45;
  // lightning inside the storm lights the clouds from within
  vec3 fl = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 d = w - uFlash[i].xyz;
    fl += uFlashCol * uFlash[i].w * exp(-dot(d, d) / 7200.0);
  }
  col += fl * (0.3 + 0.9 * n);
  float a = dens * uOpacity * smoothstep(2.0, 22.0, vFogDepth);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}`;

interface WallLayer {
  d: number; H: number; lean: number; opacity: number; density: number; scale: number; billow: number; rise: number; step: number;
  mesh?: THREE.Mesh; geo?: THREE.BufferGeometry; u?: Record<string, THREE.IUniform>;
  buf?: { vcap: number; icap: number; pos: Float32Array; nrm: Float32Array; uv: Float32Array; idx: Uint32Array };
}
const WALLS: WallLayer[] = [
  { d: 60, H: 320, lean: 130, opacity: 0.94, density: 1.0, scale: 1 / 560, billow: 16, rise: 0.0042, step: 12 },
  { d: 26, H: 170, lean: 46, opacity: 0.9, density: 1.02, scale: 1 / 380, billow: 9, rise: 0.0065, step: 9 },
  { d: 7, H: 72, lean: 12, opacity: 0.9, density: 1.08, scale: 1 / 250, billow: 4, rise: 0.011, step: 7 },
];
const ROWS = 10;

// the low racing curtain of sand at the storm's foot (pixel streaks, ragged billowing crest)
const curtainVert = /* glsl */ `
attribute vec4 iPos; attribute float iSeed;
varying vec2 vUv; varying vec2 vM; varying float vSeed; varying vec3 vWP;
#include <fog_pars_vertex>
void main(){
  vec2 size = vec2(22.0, 13.0);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  camRight.y = 0.0; camRight = normalize(camRight);
  vec3 wp = iPos.xyz + camRight * position.x * size.x + vec3(0.0, (position.y + 0.5) * size.y, 0.0);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  vUv = position.xy + 0.5;
  vM = vUv * size;
  vSeed = iSeed;
  vWP = wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const curtainFrag = /* glsl */ `
uniform float uTime, uOpacity;
uniform vec3 uColor, uDark, uSunDirW, uSunCol;
varying vec2 vUv; varying vec2 vM; varying float vSeed; varying vec3 vWP;
#include <fog_pars_fragment>
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  float t = uTime;
  vec2 uv = vUv;
  float edge = smoothstep(0.0, 0.24, uv.x) * smoothstep(1.0, 0.76, uv.x);
  vec3 vd = normalize(vWP - cameraPosition);
  float back = pow(max(dot(vd, uSunDirW), 0.0), 3.0);
  vec3 light = uSunCol * 0.3 + vec3(0.32, 0.34, 0.4);
  vec2 pm = floor(vM * 6.0) / 6.0;
  float sx = pm.x + vSeed * 53.0;
  float streak = fbm(vec2(sx * 0.16 - t * 2.6, pm.y * 1.9 + vSeed * 7.0));
  float billow = fbm(vec2(sx * 0.05 - t * 0.55, pm.y * 0.22 - t * 0.35 + vSeed * 3.0));
  float topH = 0.3 + 0.64 * billow;
  float body = 1.0 - smoothstep(topH - 0.32, topH + 0.06, uv.y);
  float a = clamp(body * (0.55 + 0.85 * streak), 0.0, 1.0) * edge;
  float gr = step(0.972, hash(floor(vec2(pm.x - t * 22.0, pm.y * 6.0) + vSeed * 91.0))) * body;
  vec3 col = mix(uDark, uColor, 0.45 + 0.4 * uv.y + streak * 0.3) * light;
  col += uColor * light * gr * 0.7;
  a = max(a, gr * edge * 0.85);
  col += uSunCol * vec3(1.0, 0.8, 0.55) * back * 0.14;
  a *= uOpacity * smoothstep(1.5, 9.0, vFogDepth);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}`;
const MAX_CURTAIN = 1600;

// lightning bolts: camera-facing strips along jagged branching paths, white-hot core, HDR glow
const boltVert = /* glsl */ `
attribute float aA;
attribute float aU;
varying float vA;
varying float vU;
void main(){ vA = aA; vU = aU; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const boltFrag = /* glsl */ `
uniform vec3 uCore, uGlow;
varying float vA;
varying float vU;
void main(){
  float u = abs(vU);
  float core = exp(-u * u * 18.0);
  float glow = exp(-u * u * 3.0) * 0.55;
  vec3 c = uCore * core + uGlow * glow;
  gl_FragColor = vec4(c * vA, 1.0);
}`;
const MAX_BOLT_SEGS = 420;

interface Bolt { segs: { a: THREE.Vector3; b: THREE.Vector3; w: number }[]; t: number; life: number; flashes: number[]; mid: THREE.Vector3; power: number }
interface Debris { mesh: THREE.InstancedMesh; i: number; p: THREE.Vector3; v: THREE.Vector3; ax: THREE.Vector3; spin: number; q: THREE.Quaternion; s: number; life: number; age: number }
/** a point on the storm's front with its outward normal and the downwind tangent */
interface Edge { x: number; z: number; nx: number; nz: number }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Vector3();

export class Storm {
  discs: StormDisc[] = [];
  capsules: StormCapsule[] = [];
  devils: DustDevil[] = [];
  group = new THREE.Group();
  /** downwind direction (set by World) */
  wind = { x: 1, z: 0 };
  /** 0..1: storm intensity weakened by boss kills */
  strength = 1;
  /** 0..1 proximity of the focus to the storm front (1 = at / inside it), for murk and audio */
  near = 0;
  /** signed distance of the focus to the front (> 0 inside the safe area) */
  focusSdf = 1e9;
  private curtain: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private iPos: Float32Array;
  private iSeed: Float32Array;
  private dirty = true;
  private rebuildTimer = 0;
  private walls = WALLS.map((w) => ({ ...w }));
  /** samples of the front (wall 0 outline) for debris, pixel sand and lightning placement */
  private front: Edge[] = [];
  private bolts: Bolt[] = [];
  private boltMesh: THREE.Mesh;
  private boltGeo: THREE.BufferGeometry;
  private flashU: THREE.Vector4[] = [0, 1, 2, 3].map(() => new THREE.Vector4(0, -1e4, 0, 0));
  private flashes: { p: THREE.Vector3; t: number; life: number; power: number }[] = [];
  private flashT = 1;
  private boltT = 3;
  private debris: Debris[] = [];
  private debrisMeshes: THREE.InstancedMesh[] = [];
  private emitAcc = 0;
  private time = 0;
  private audio: any = null;
  private howl: any = null;
  private focus = new THREE.Vector3();
  uniforms = {
    ...atmoFogUniforms(),
    uTime: globalUniforms.uTime,
    uSunDirW: globalUniforms.uSunDirW,
    uSunCol: globalUniforms.uSunCol,
    uColor: { value: new THREE.Color(0xf6dcb0) },
    uDark: { value: new THREE.Color(0xb0784a) },
    uOpacity: { value: 0.9 },
  };

  constructor(public heightAt: (x: number, z: number) => number) {
    // foot curtain
    this.geo = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    this.geo.index = q.index;
    this.geo.setAttribute('position', q.getAttribute('position'));
    this.iPos = new Float32Array(MAX_CURTAIN * 4);
    this.iSeed = new Float32Array(MAX_CURTAIN);
    this.geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.iPos, 4));
    this.geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(this.iSeed, 1));
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ vertexShader: curtainVert, fragmentShader: curtainFrag, uniforms: this.uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
    this.curtain = new THREE.Mesh(this.geo, mat);
    this.curtain.frustumCulled = false;
    this.curtain.renderOrder = 9;
    this.group.add(this.curtain);
    // the walls, outermost first
    const tex = stormNoise();
    this.walls.forEach((L, i) => {
      L.u = {
        ...atmoFogUniforms(),
        uTime: globalUniforms.uTime,
        uSunDirW: globalUniforms.uSunDirW,
        uSunCol: globalUniforms.uSunCol,
        uNoise: { value: tex },
        uOpacity: { value: L.opacity },
        uDensity: { value: L.density },
        uScale: { value: L.scale },
        uRise: { value: L.rise },
        uBillow: { value: L.billow },
        uSeed: { value: i * 0.37 },
        uWind: { value: new THREE.Vector2(1, 0) },
        uLit: { value: new THREE.Color(0xe2aa6a) },
        uDeep: { value: new THREE.Color(0x8a4e2a) },
        uHigh: { value: new THREE.Color(0xe8c9a4) },
        uFlash: { value: this.flashU },
        uFlashCol: { value: new THREE.Color(1.0, 0.86, 0.7).multiplyScalar(2.6) },
      };
      const m = new THREE.ShaderMaterial({ vertexShader: wallVert, fragmentShader: wallFrag, uniforms: L.u, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
      L.geo = new THREE.BufferGeometry();
      L.mesh = new THREE.Mesh(L.geo, m);
      L.mesh.frustumCulled = false;
      L.mesh.renderOrder = 5 + i;
      L.mesh.name = 'stormWall' + i;
      this.group.add(L.mesh);
    });
    // lightning
    this.boltGeo = new THREE.BufferGeometry();
    this.boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_BOLT_SEGS * 4 * 3), 3));
    this.boltGeo.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(MAX_BOLT_SEGS * 4), 1));
    this.boltGeo.setAttribute('aU', new THREE.BufferAttribute(new Float32Array(MAX_BOLT_SEGS * 4), 1));
    const idx = new Uint16Array(MAX_BOLT_SEGS * 6);
    for (let i = 0; i < MAX_BOLT_SEGS; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    this.boltGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.boltGeo.setDrawRange(0, 0);
    const bm = new THREE.ShaderMaterial({
      vertexShader: boltVert,
      fragmentShader: boltFrag,
      uniforms: { uCore: { value: new THREE.Color(1, 0.97, 0.9).multiplyScalar(7) }, uGlow: { value: new THREE.Color(1.0, 0.62, 0.38).multiplyScalar(2.2) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.boltMesh = new THREE.Mesh(this.boltGeo, bm);
    this.boltMesh.frustumCulled = false;
    this.boltMesh.renderOrder = 6.5;
    this.boltMesh.onBeforeRender = (_r, _s, cam) => this.buildBolts(cam.position);
    this.group.add(this.boltMesh);
    this.buildDebris();
  }

  // ------------------------------------------------------------------- shapes
  addDisc(id: string, x: number, z: number, r: number, open = true) {
    const d: StormDisc = { id, x, z, r: open ? r : 0, target: open ? r : 0, speed: 14, tx: x, tz: z, mspeed: 0 };
    this.discs.push(d);
    this.dirty = true;
    return d;
  }
  addCapsule(id: string, ax: number, az: number, bx: number, bz: number, w: number, open = true) {
    const c: StormCapsule = { id, ax, az, bx, bz, w: open ? w : 0, target: open ? w : 0, speed: 6, s0: 0, s1: 1, s0t: 0, s1t: 1, sspeed: 0.3 };
    this.capsules.push(c);
    this.dirty = true;
    return c;
  }
  /** animate a shape's radius / width open or closed */
  setTarget(id: string, target: number, speed?: number) {
    for (const d of this.discs) if (d.id === id) { d.target = target; if (speed) d.speed = speed; }
    for (const c of this.capsules) if (c.id === id) { c.target = target; if (speed) c.speed = speed; }
  }
  /** animate how much of a corridor is open along its length (0 = at a, 1 = at b) */
  setSpan(id: string, s0: number, s1: number, speed = 0.3) {
    for (const c of this.capsules) if (c.id === id) { c.s0t = s0; c.s1t = s1; c.sspeed = speed; }
  }
  /** slide a disc's centre (m/s) */
  moveDisc(id: string, x: number, z: number, speed: number) {
    for (const d of this.discs) if (d.id === id) { d.tx = x; d.tz = z; d.mspeed = speed; }
  }
  /** set values immediately (cinematics drive the storm frame by frame) */
  drive(id: string, v: { r?: number; w?: number; s0?: number; s1?: number }) {
    for (const d of this.discs)
      if (d.id === id && v.r !== undefined) d.r = d.target = v.r;
    for (const c of this.capsules)
      if (c.id === id) {
        if (v.w !== undefined) c.w = c.target = v.w;
        if (v.s0 !== undefined) c.s0 = c.s0t = v.s0;
        if (v.s1 !== undefined) c.s1 = c.s1t = v.s1;
      }
    this.dirty = true;
  }
  get(id: string): StormDisc | StormCapsule | undefined {
    return this.discs.find((d) => d.id === id) ?? this.capsules.find((c) => c.id === id);
  }
  remove(id: string) {
    this.discs = this.discs.filter((d) => d.id !== id);
    this.capsules = this.capsules.filter((c) => c.id !== id);
    this.dirty = true;
  }

  /** signed distance: >0 inside safe area */
  sdf(x: number, z: number) {
    let s = -1e9;
    for (const d of this.discs) if (d.r > 0.5) s = Math.max(s, d.r - Math.hypot(x - d.x, z - d.z));
    for (const c of this.capsules) {
      if (c.w < 0.5 || c.s1 - c.s0 < 0.002) continue;
      s = Math.max(s, c.w * 0.5 - capDist(c, x, z));
    }
    return s;
  }
  /** gradient pointing inward (toward safety) */
  inward(x: number, z: number, out: { x: number; z: number }) {
    const e = 1;
    const gx = this.sdf(x + e, z) - this.sdf(x - e, z);
    const gz = this.sdf(x, z + e) - this.sdf(x, z - e);
    const l = Math.hypot(gx, gz) || 1;
    out.x = gx / l;
    out.z = gz / l;
    return out;
  }

  /** random point inside safe area near (x,z) within [minR,maxR] */
  randomPointNear(x: number, z: number, minR: number, maxR: number, margin = 6) {
    for (let k = 0; k < 30; k++) {
      const a = rnd.next() * Math.PI * 2, r = minR + rnd.next() * (maxR - minR);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (this.sdf(px, pz) > margin) return { x: px, z: pz };
    }
    return null;
  }

  // ------------------------------------------------------------------- outlines
  /**
   * The union's boundary offset outward by d, as polylines (runs) with outward normals:
   * each shape's own offset outline sampled every `step` m, keeping the samples no other
   * (offset) shape covers, with the junctions found by bisection so neighbouring runs meet.
   */
  private outline(d: number, step: number): Edge[][] {
    type Shape = { inside: (x: number, z: number) => number; loop: Edge[]; closed: boolean };
    const shapes: Shape[] = [];
    for (const disc of this.discs) {
      if (disc.r < 0.5) continue;
      const R = disc.r + d;
      const n = Math.max(12, Math.ceil((Math.PI * 2 * R) / step));
      const loop: Edge[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        loop.push({ x: disc.x + Math.cos(a) * R, z: disc.z + Math.sin(a) * R, nx: Math.cos(a), nz: Math.sin(a) });
      }
      shapes.push({ inside: (x, z) => disc.r - Math.hypot(x - disc.x, z - disc.z), loop, closed: true });
    }
    for (const c of this.capsules) {
      if (c.w < 0.5 || c.s1 - c.s0 < 0.002) continue;
      const ax = c.ax + (c.bx - c.ax) * c.s0, az = c.az + (c.bz - c.az) * c.s0;
      const bx = c.ax + (c.bx - c.ax) * c.s1, bz = c.az + (c.bz - c.az) * c.s1;
      const L = Math.hypot(bx - ax, bz - az) || 1e-3;
      const ux = (bx - ax) / L, uz = (bz - az) / L, px = -uz, pz = ux;
      const R = c.w * 0.5 + d;
      const loop: Edge[] = [];
      const ns = Math.max(1, Math.ceil(L / step));
      const nc = Math.max(4, Math.ceil((Math.PI * R) / step));
      for (let i = 0; i < ns; i++) loop.push({ x: ax + ux * (L * i) / ns + px * R, z: az + uz * (L * i) / ns + pz * R, nx: px, nz: pz });
      for (let i = 0; i < nc; i++) {
        const a = Math.atan2(pz, px) - (i / nc) * Math.PI;
        loop.push({ x: bx + Math.cos(a) * R, z: bz + Math.sin(a) * R, nx: Math.cos(a), nz: Math.sin(a) });
      }
      for (let i = 0; i < ns; i++) loop.push({ x: bx - ux * (L * i) / ns - px * R, z: bz - uz * (L * i) / ns - pz * R, nx: -px, nz: -pz });
      for (let i = 0; i < nc; i++) {
        const a = Math.atan2(-pz, -px) - (i / nc) * Math.PI;
        loop.push({ x: ax + Math.cos(a) * R, z: az + Math.sin(a) * R, nx: Math.cos(a), nz: Math.sin(a) });
      }
      const cap = c;
      shapes.push({ inside: (x, z) => cap.w * 0.5 - capDist(cap, x, z), loop, closed: true });
    }
    const runs: Edge[][] = [];
    shapes.forEach((sh, si) => {
      const covered = (x: number, z: number) => {
        let m = -1e9;
        for (let j = 0; j < shapes.length; j++) if (j !== si) m = Math.max(m, shapes[j].inside(x, z) + d);
        return m;
      };
      const L = sh.loop;
      const keep = L.map((p) => covered(p.x, p.z) < 0);
      if (keep.every((k) => k)) {
        runs.push([...L, L[0]]);
        return;
      }
      if (!keep.some((k) => k)) return;
      const n = L.length;
      // edge point between a kept and a covered sample
      const cut = (a: Edge, b: Edge): Edge => {
        let lo = 0, hi = 1;
        for (let k = 0; k < 10; k++) {
          const m = (lo + hi) / 2;
          if (covered(a.x + (b.x - a.x) * m, a.z + (b.z - a.z) * m) < 0) lo = m;
          else hi = m;
        }
        return { x: a.x + (b.x - a.x) * lo, z: a.z + (b.z - a.z) * lo, nx: a.nx, nz: a.nz };
      };
      let start = keep.findIndex((k, i) => k && !keep[(i - 1 + n) % n]);
      for (let c = 0; c < n; c++) {
        const i = (start + c) % n;
        if (!keep[i] || keep[(i - 1 + n) % n]) continue;
        const run: Edge[] = [cut(L[i], L[(i - 1 + n) % n])];
        let j = i;
        while (keep[j]) {
          run.push(L[j]);
          j = (j + 1) % n;
          if (j === i) break;
        }
        run.push(cut(L[(j - 1 + n) % n], L[j]));
        runs.push(run);
      }
      void start;
    });
    return runs;
  }

  private rebuild() {
    // walls
    for (let li = 0; li < this.walls.length; li++) {
      const W = this.walls[li];
      const runs = this.outline(W.d, W.step);
      let nv = 0, ni = 0;
      for (const r of runs) {
        nv += r.length * (ROWS + 1);
        ni += (r.length - 1) * ROWS * 6;
      }
      // fixed buffers, grown (never shrunk) when the outline gets longer; drawRange trims them
      if (!W.buf || W.buf.vcap < nv || W.buf.icap < ni) {
        const vcap = Math.max(nv, 512) * 2, icap = Math.max(ni, 1024) * 2;
        W.buf = { vcap, icap, pos: new Float32Array(vcap * 3), nrm: new Float32Array(vcap * 2), uv: new Float32Array(vcap * 2), idx: new Uint32Array(icap) };
        W.geo!.dispose();
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(W.buf.pos, 3));
        g.setAttribute('aN', new THREE.BufferAttribute(W.buf.nrm, 2));
        g.setAttribute('aUV', new THREE.BufferAttribute(W.buf.uv, 2));
        g.setIndex(new THREE.BufferAttribute(W.buf.idx, 1));
        W.geo = g;
        W.mesh!.geometry = g;
      }
      const { pos, nrm, uv, idx } = W.buf;
      let v = 0, o = 0;
      for (const run of runs) {
        const base = v;
        let u = 0;
        for (let k = 0; k < run.length; k++) {
          const p = run[k];
          if (k > 0) u += Math.hypot(p.x - run[k - 1].x, p.z - run[k - 1].z);
          const g = this.heightAt(p.x, p.z) - 4;
          for (let j = 0; j <= ROWS; j++) {
            const t = j / ROWS;
            const h = t * t * 0.35 + t * 0.65; // rows bunch near the foot
            const lean = W.lean * Math.pow(h, 1.5);
            pos[v * 3] = p.x + p.nx * lean;
            pos[v * 3 + 1] = g + W.H * h;
            pos[v * 3 + 2] = p.z + p.nz * lean;
            nrm[v * 2] = p.nx;
            nrm[v * 2 + 1] = p.nz;
            uv[v * 2] = u;
            uv[v * 2 + 1] = h;
            v++;
          }
        }
        for (let k = 0; k < run.length - 1; k++)
          for (let j = 0; j < ROWS; j++) {
            const a = base + k * (ROWS + 1) + j, b = a + ROWS + 1;
            idx[o++] = a; idx[o++] = b; idx[o++] = a + 1;
            idx[o++] = a + 1; idx[o++] = b; idx[o++] = b + 1;
          }
      }
      const geo = W.geo!;
      for (const k of ['position', 'aN', 'aUV']) (geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
      geo.index!.needsUpdate = true;
      geo.setDrawRange(0, o);
      if (li === this.walls.length - 1) {
        this.front.length = 0;
        for (const run of runs) for (const p of run) this.front.push(p);
      }
    }
    // foot curtain (racing sand) just past the rim
    let n = 0;
    for (const run of this.outline(2.5, 6)) {
      for (const p of run) {
        if (n >= MAX_CURTAIN) break;
        this.iPos[n * 4] = p.x;
        this.iPos[n * 4 + 1] = this.heightAt(p.x, p.z) - 0.7;
        this.iPos[n * 4 + 2] = p.z;
        this.iPos[n * 4 + 3] = 0;
        this.iSeed[n] = ((p.x * 0.137 + p.z * 0.311) % 1 + 1) % 1;
        n++;
      }
    }
    this.geo.instanceCount = n;
    (this.geo.getAttribute('iPos') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('iSeed') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  // ------------------------------------------------------------------- devils
  spawnDevil(x: number, z: number, r = 6, dps = 14, life = 24) {
    const g = new THREE.Group();
    this.group.add(g);
    const a = rnd.next() * Math.PI * 2;
    this.devils.push({ x, z, vx: Math.cos(a) * 4, vz: Math.sin(a) * 4, r, life, dps, mesh: g });
  }

  // ------------------------------------------------------------------- audio
  /** the storm's own sound: a positional howl that swells as you ride up to it, thunder after the lightning */
  bindAudio(audio: any) {
    if (this.audio === audio) return;
    this.audio = audio;
    try {
      this.howl = audio?.loop?.('storm_loop', 0, { x: 0, y: 0, z: 0 }) ?? null;
      this.howl?.setRate?.(0.82);
    } catch {
      this.howl = null;
    }
  }

  // ------------------------------------------------------------------- lightning
  /** a bolt inside the storm at a point of the front (or the given spot) */
  strike(at?: { x: number; z: number }, depth = 30, power = 1) {
    let x: number, z: number, nx = 0, nz = 0;
    if (at) {
      x = at.x;
      z = at.z;
      const inw = this.inward(x, z, { x: 0, z: 0 });
      nx = -inw.x;
      nz = -inw.z;
    } else {
      const e = this.pickFront(260);
      if (!e) return;
      x = e.x;
      z = e.z;
      nx = e.nx;
      nz = e.nz;
    }
    const g = this.heightAt(x, z);
    const bx = x + nx * depth, bz = z + nz * depth;
    const top = new THREE.Vector3(bx + rnd.range(-20, 20), g + rnd.range(140, 240), bz + rnd.range(-20, 20));
    const bot = new THREE.Vector3(bx + rnd.range(-8, 8), this.heightAt(bx, bz), bz + rnd.range(-8, 8));
    const segs: Bolt['segs'] = [];
    const branch = (a: THREE.Vector3, b: THREE.Vector3, w: number, depthLeft: number) => {
      const pts = [a.clone()];
      const n = 14;
      const dir = b.clone().sub(a);
      const len = dir.length();
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const p = a.clone().addScaledVector(dir, t);
        const j = len * 0.07 * Math.sin(t * Math.PI);
        p.x += rnd.range(-j, j);
        p.z += rnd.range(-j, j);
        p.y += rnd.range(-j, j) * 0.3;
        pts.push(p);
      }
      pts.push(b.clone());
      for (let i = 0; i < pts.length - 1 && segs.length < MAX_BOLT_SEGS; i++) {
        segs.push({ a: pts[i], b: pts[i + 1], w: w * (1 - (i / pts.length) * 0.45) });
        if (depthLeft > 0 && i > 2 && rnd.chance(0.18)) {
          const s = pts[i];
          const e = s.clone().add(new THREE.Vector3(rnd.range(-1, 1), -rnd.range(0.4, 1), rnd.range(-1, 1)).normalize().multiplyScalar(len * rnd.range(0.12, 0.3)));
          branch(s, e, w * 0.5, depthLeft - 1);
        }
      }
    };
    branch(top, bot, 1.6 * power, 2);
    const life = 0.55;
    this.bolts.push({ segs, t: 0, life, flashes: [0, 0.1, 0.24, 0.33].map((f) => f + rnd.range(0, 0.04)), mid: top.clone().lerp(bot, 0.45), power });
    this.flash(top.clone().lerp(bot, 0.5), 1.4 * power, 0.5);
    if (this.audio) {
      const dist = Math.hypot(bx - this.focus.x, bz - this.focus.z);
      try {
        this.audio.play('thunder', { pos: { x: bx, y: g + 20, z: bz }, volume: clamp(1.3 - dist / 400, 0.25, 1) * power, delay: Math.min(1.6, dist / 340), pitch: rnd.range(0.85, 1.05) });
      } catch {
        /* */
      }
    }
  }
  /** an internal sheet flash lighting the clouds from inside */
  flash(p: THREE.Vector3, power = 1, life = 0.35) {
    this.flashes.push({ p, t: 0, life, power });
    if (this.flashes.length > 4) this.flashes.shift();
  }
  private pickFront(maxDist: number): Edge | null {
    for (let k = 0; k < 12; k++) {
      const e = this.front[(rnd.next() * this.front.length) | 0];
      if (!e) return null;
      if (Math.hypot(e.x - this.focus.x, e.z - this.focus.z) < maxDist) return e;
    }
    return null;
  }
  private buildBolts(cam: THREE.Vector3) {
    const pos = this.boltGeo.getAttribute('position') as THREE.BufferAttribute;
    const aA = this.boltGeo.getAttribute('aA') as THREE.BufferAttribute;
    const aU = this.boltGeo.getAttribute('aU') as THREE.BufferAttribute;
    let s = 0;
    for (const b of this.bolts) {
      let on = 0;
      for (const f of b.flashes) if (b.t >= f && b.t < f + 0.07) on = 1;
      const fade = on * (1 - b.t / b.life) * b.power;
      if (fade <= 0.01) continue;
      for (const sg of b.segs) {
        if (s >= MAX_BOLT_SEGS) break;
        _v.subVectors(sg.b, sg.a);
        _c.addVectors(sg.a, sg.b).multiplyScalar(0.5).sub(cam);
        _s.crossVectors(_v, _c).normalize().multiplyScalar(sg.w * 2.2);
        const P = [sg.a.x - _s.x, sg.a.y - _s.y, sg.a.z - _s.z, sg.a.x + _s.x, sg.a.y + _s.y, sg.a.z + _s.z, sg.b.x - _s.x, sg.b.y - _s.y, sg.b.z - _s.z, sg.b.x + _s.x, sg.b.y + _s.y, sg.b.z + _s.z];
        (pos.array as Float32Array).set(P, s * 12);
        (aA.array as Float32Array).fill(fade, s * 4, s * 4 + 4);
        (aU.array as Float32Array).set([-1, 1, -1, 1], s * 4);
        s++;
      }
    }
    this.boltGeo.setDrawRange(0, s * 6);
    pos.needsUpdate = aA.needsUpdate = aU.needsUpdate = true;
  }

  // ------------------------------------------------------------------- debris
  private buildDebris() {
    const kinds: [() => { model: any; voxelSize: number }, number][] = [
      [() => tumbleweed(1), 10],
      [() => tumbleweed(2), 8],
      [() => plankDebris(1), 8],
      [() => wagonWheel(0), 5],
      [() => rock(5, 1), 9],
    ];
    for (const [mk, n] of kinds) {
      let sm: { model: any; voxelSize: number };
      try {
        sm = mk();
      } catch {
        continue;
      }
      const geo = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: 'center' });
      const im = new THREE.InstancedMesh(geo, sharedVoxelMaterial, n);
      im.frustumCulled = false;
      im.castShadow = false;
      im.count = n;
      for (let i = 0; i < n; i++) {
        im.setMatrixAt(i, _m.makeScale(0, 0, 0));
        this.debris.push({ mesh: im, i, p: new THREE.Vector3(), v: new THREE.Vector3(), ax: new THREE.Vector3(0, 1, 0), spin: 0, q: new THREE.Quaternion(), s: 1, life: 0, age: 1 });
      }
      this.debrisMeshes.push(im);
      this.group.add(im);
    }
  }
  private updateDebris(dt: number) {
    for (const d of this.debris) {
      d.age += dt;
      if (d.age >= d.life) {
        // respawn somewhere on the nearby front, deep enough in the murk to pop in unseen
        const e = this.front.length ? this.pickFront(170) : null;
        if (!e) {
          d.mesh.setMatrixAt(d.i, _m.makeScale(0, 0, 0));
          d.life = 0.5;
          d.age = 0;
          continue;
        }
        const tx = -e.nz, tz = e.nx;
        const dirSign = tx * this.wind.x + tz * this.wind.z >= 0 ? 1 : -1;
        const dep = rnd.range(5, 26);
        d.p.set(e.x + e.nx * dep, this.heightAt(e.x, e.z) + rnd.range(1.5, 34), e.z + e.nz * dep);
        const sp = rnd.range(11, 24) * dirSign;
        d.v.set(tx * sp + e.nx * rnd.range(-1.5, 1.5), rnd.range(-1.5, 4), tz * sp + e.nz * rnd.range(-1.5, 1.5));
        d.ax.set(rnd.range(-1, 1), rnd.range(-1, 1), rnd.range(-1, 1)).normalize();
        d.spin = rnd.range(3, 9);
        d.s = rnd.range(0.8, 1.6);
        d.life = rnd.range(2.5, 5);
        d.age = 0;
      }
      d.p.addScaledVector(d.v, dt);
      d.v.y += Math.sin(this.time * 1.7 + d.i * 1.3) * 3 * dt;
      _q.setFromAxisAngle(d.ax, d.spin * dt);
      d.q.premultiply(_q);
      const env = smoothstep(0, 0.5, d.age) * smoothstep(d.life, d.life - 0.6, d.age);
      _s.setScalar(d.s * env);
      d.mesh.setMatrixAt(d.i, _m.compose(d.p, d.q, _s));
    }
    for (const m of this.debrisMeshes) m.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------- update
  update(dt: number, fx: { p: { emit: (o: any) => void } } | null, focus?: THREE.Vector3) {
    this.time += dt;
    if (focus) this.focus.copy(focus);
    let moving = false;
    for (const d of this.discs) {
      if (Math.abs(d.r - d.target) > 0.05) {
        d.r += Math.sign(d.target - d.r) * Math.min(Math.abs(d.target - d.r), d.speed * dt);
        moving = true;
      }
      if (d.mspeed > 0 && (Math.abs(d.x - d.tx) > 0.05 || Math.abs(d.z - d.tz) > 0.05)) {
        const dx = d.tx - d.x, dz = d.tz - d.z, l = Math.hypot(dx, dz);
        const st = Math.min(l, d.mspeed * dt);
        d.x += (dx / l) * st;
        d.z += (dz / l) * st;
        moving = true;
      }
    }
    for (const c of this.capsules) {
      if (Math.abs(c.w - c.target) > 0.05) {
        c.w += Math.sign(c.target - c.w) * Math.min(Math.abs(c.target - c.w), c.speed * dt);
        moving = true;
      }
      for (const k of ['s0', 's1'] as const) {
        const tk = k === 's0' ? c.s0t : c.s1t;
        if (Math.abs(c[k] - tk) > 0.0005) {
          c[k] += Math.sign(tk - c[k]) * Math.min(Math.abs(tk - c[k]), c.sspeed * dt);
          moving = true;
        }
      }
    }
    this.rebuildTimer -= dt;
    if (this.dirty || (moving && this.rebuildTimer <= 0)) {
      this.rebuild();
      this.dirty = false;
      this.rebuildTimer = 0.05;
    }
    this.uniforms.uOpacity.value = 0.6 + 0.35 * this.strength;
    for (const W of this.walls) {
      W.u!.uOpacity.value = W.opacity * (0.75 + 0.25 * this.strength);
      (W.u!.uWind.value as THREE.Vector2).set(this.wind.x, this.wind.z);
    }
    // proximity of the focus to the front
    const sd = (this.focusSdf = this.sdf(this.focus.x, this.focus.z));
    this.near = clamp(1 - (sd - 2) / 110, 0, 1);
    // lightning: sheet flashes often, bolts now and then (more as you get close)
    this.flashT -= dt;
    if (this.flashT <= 0 && this.front.length) {
      this.flashT = rnd.range(0.5, 2.2) * (1.2 - this.near * 0.5);
      const e = this.pickFront(320);
      if (e) this.flash(new THREE.Vector3(e.x + e.nx * rnd.range(20, 90), this.heightAt(e.x, e.z) + rnd.range(40, 200), e.z + e.nz * rnd.range(20, 90)), rnd.range(0.5, 1.1), rnd.range(0.15, 0.4));
    }
    this.boltT -= dt;
    if (this.boltT <= 0 && this.front.length) {
      this.boltT = rnd.range(3, 9) * (1.3 - this.near * 0.6);
      this.strike(undefined, rnd.range(18, 60), rnd.range(0.7, 1.1));
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.t >= b.life) this.bolts.splice(i, 1);
    }
    for (let i = 0; i < 4; i++) {
      const f = this.flashes[i];
      const u = this.flashU[i];
      if (!f) {
        u.w = 0;
        continue;
      }
      f.t += dt;
      const k = f.t / f.life;
      // a flash is a few flickers, not a fade
      const flick = k < 1 ? (0.55 + 0.45 * Math.sin(f.t * 61 + i)) * (1 - k) : 0;
      u.set(f.p.x, f.p.y, f.p.z, flick * f.power);
    }
    this.flashes = this.flashes.filter((f) => f.t < f.life);
    // a bolt's flickers light the clouds round it
    for (const b of this.bolts) {
      let on = 0;
      for (const f of b.flashes) if (b.t >= f && b.t < f + 0.07) on = 1;
      if (on) {
        const u = this.flashU[3];
        u.set(b.mid.x, b.mid.y, b.mid.z, Math.max(u.w, 1.6 * b.power));
      }
    }
    this.updateDebris(dt);
    // pixel sand blowing out of the storm as you ride up to it
    if (fx && sd < 45 && sd > -30) {
      const k = clamp(1 - sd / 45, 0, 1);
      this.emitAcc += dt * (8 + 50 * k * k);
      const inw = this.inward(this.focus.x, this.focus.z, { x: 0, z: 0 });
      const tx = -inw.z, tz = inw.x;
      const ts = tx * this.wind.x + tz * this.wind.z >= 0 ? 1 : -1;
      const SANDC = [0xf0d29a, 0xe3bd80, 0xd6a968, 0xfbe6b8];
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1;
        const off = rnd.range(-22, 22);
        const ex = this.focus.x - inw.x * Math.max(0, sd) + tx * off, ez = this.focus.z - inw.z * Math.max(0, sd) + tz * off;
        const y = this.heightAt(ex, ez);
        fx.p.emit({ pos: { x: ex, y: y + rnd.range(0.2, 5), z: ez }, count: 3, vel: { x: tx * ts * 9 + inw.x * 5, y: 1.2, z: tz * ts * 9 + inw.z * 5 }, spread: 2.2, jitter: 2.5, gravity: 2, drag: 0.4, life: [0.7, 1.5], size: [0.07, 0.15], sprite: ['dot3', 'dot3', 'puff0'], color: SANDC, ground: true });
        if (rnd.chance(0.3)) fx.p.emit({ pos: { x: ex, y: y + rnd.range(1, 6), z: ez }, count: 1, vel: { x: tx * ts * 6 + inw.x * 3, y: 0.8, z: tz * ts * 6 + inw.z * 3 }, spread: 1, life: [1.0, 1.9], size: [1.6, 3.4], sprite: ['cloud0', 'cloud1', 'puff1'], color: [0xd8a86a, 0xc89058, 0xe6c08a], alpha: 0.55, drag: 0.6, rot: 6, rotSpeed: 1.2 });
      }
    }
    // the howl: positional, from the nearest stretch of the storm, swelling as you close in
    if (this.howl) {
      const inw = this.inward(this.focus.x, this.focus.z, { x: 0, z: 0 });
      try {
        this.howl.setPosition({ x: this.focus.x - inw.x * 7, y: this.focus.y + 2, z: this.focus.z - inw.z * 7 });
        this.howl.setVolume((0.07 + 0.85 * Math.pow(this.near, 1.7)) * (0.7 + 0.3 * this.strength), 0.4);
      } catch {
        /* */
      }
    }
    // dust devils roam inside the safe area
    for (let i = this.devils.length - 1; i >= 0; i--) {
      const dv = this.devils[i];
      dv.life -= dt;
      if (rnd.chance(dt * 0.6)) {
        const a = rnd.next() * Math.PI * 2;
        dv.vx = dv.vx * 0.5 + Math.cos(a) * 3;
        dv.vz = dv.vz * 0.5 + Math.sin(a) * 3;
      }
      dv.x += dv.vx * dt;
      dv.z += dv.vz * dt;
      if (this.sdf(dv.x, dv.z) < dv.r) {
        const inw = this.inward(dv.x, dv.z, { x: 0, z: 0 });
        dv.vx += inw.x * 6 * dt;
        dv.vz += inw.z * 6 * dt;
      }
      if (fx) {
        const y = this.heightAt(dv.x, dv.z);
        for (let k = 0; k < 3; k++) {
          const h = rnd.next() * dv.r * 3;
          const ang = rnd.next() * Math.PI * 2;
          const rr = dv.r * (0.3 + (h / (dv.r * 3)) * 0.9);
          fx.p.emit({
            pos: { x: dv.x + Math.cos(ang) * rr, y: y + h, z: dv.z + Math.sin(ang) * rr },
            count: 1,
            vel: { x: -Math.sin(ang) * 9 + dv.vx, y: 2.5, z: Math.cos(ang) * 9 + dv.vz },
            life: [0.5, 0.9],
            size: [1.2, 2.6],
            sprite: ['cloud0', 'cloud1', 'puff1'],
            color: [0xe0b77a, 0xc99a5d, 0xf0d0a0],
            alpha: 0.8,
            drag: 0.5,
            rot: 6,
            rotSpeed: 3,
          });
        }
      }
      if (dv.life <= 0) {
        dv.mesh.removeFromParent();
        this.devils.splice(i, 1);
      }
    }
  }

  devilDamageAt(x: number, z: number) {
    let d = 0;
    for (const dv of this.devils) if (Math.hypot(x - dv.x, z - dv.z) < dv.r) d += dv.dps;
    return d;
  }

  dispose() {
    try {
      this.howl?.stop?.(0.8);
    } catch {
      /* */
    }
    this.howl = null;
    for (const W of this.walls) {
      W.geo?.dispose();
      (W.mesh?.material as THREE.Material | undefined)?.dispose();
    }
    this.boltGeo.dispose();
    (this.boltMesh.material as THREE.Material).dispose();
    this.geo.dispose();
    (this.curtain.material as THREE.Material).dispose();
    for (const m of this.debrisMeshes) m.geometry.dispose();
    this.group.removeFromParent();
  }
}

/** distance from a point to a capsule's open span */
function capDist(c: StormCapsule, x: number, z: number) {
  const ax = c.ax + (c.bx - c.ax) * c.s0, az = c.az + (c.bz - c.az) * c.s0;
  const bx = c.ax + (c.bx - c.ax) * c.s1, bz = c.az + (c.bz - c.az) * c.s1;
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((x - ax) * dx + (z - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}
