// THE SOUL BAR — the ultimate's charge as Serket's soul, kept in a glass
// canopic jar that stands above the beating heart (Serket guards the canopic
// jars). A real 3D piece in the HUD overlay:
//  • a hand-blown glass body (sculpted lathe profile with a lean, wobble and
//    seed bubbles; anime-hard specular streaks, a fresnel rim)
//  • inside it, jade soul smoke — a ray-marched volume bounded by the jar's own
//    profile, swirling, with a sloshing meniscus and a cel-stepped light ramp
//  • a riveted brass cage (lotus-petal foot, four straps, a shoulder band with
//    a jade soul-gem cartouche, a knurled collar) and a gadrooned stopper with
//    Pinch the scorpion standing guard on it
// Kill streaks pour soul in (motes spiral into the mouth on every surge); when
// it is full the smoke glows and pulses, wisps leak from under the lid, the lid
// rattles and Pinch snaps his claws while the 2D HUD shows "[Z] UNLEASH". Using
// the ultimate uncorks the jar: the smoke whirls down in a vortex and streams
// out into Sundown.
import * as THREE from 'three';
import type { Hud } from './Hud';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { VF } from '../../engine/voxel/VoxelModel';
import { modelEntry } from '../models/lookup';
import { sculpt, Surf, PixelFx, fbm3, h3, mixc, mulc, clamp01, sstep, len2, len3, TAU, uiSfx, METAL, lerp } from './HudKit';

// ------------------------------------------------------------------ profile (HUD px)
/** interior bottom of the glass above the foot */
const BODY_Y0 = 5;
/** interior height */
const BODY_H = 30;
/** inner glass radius at interior heights (blown canopic belly, tight shoulder, neck, lip) */
const PROF: [number, number][] = [
  [0, 7.6], [2, 9.0], [5, 10.4], [9, 11.5], [13, 12.1], [17, 12.2], [20, 11.6], [22.5, 10.0], [24.5, 7.6], [26, 6.0], [27.5, 5.5], [29, 5.6], [30, 6.2],
];
const GLASS_T = 0.7;
const VPH = 2; // voxels per HUD px
/** the jar's full height incl. Pinch, HUD px (for layout) */
export const SOUL_JAR_H = 50;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
/** dense samples of the inner profile along a Catmull-Rom spline */
function profileSamples(per = 6) {
  const out: [number, number][] = [];
  const P = PROF;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], d = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      out.push([catmull(a[0], b[0], c[0], d[0], t), catmull(a[1], b[1], c[1], d[1], t)]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
}
const SAMPLES = profileSamples(8);
/** inner radius at interior height y (0..BODY_H) */
const R_TAB = (() => {
  const n = BODY_H * 20 + 1;
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const y = i / 20;
    let r = SAMPLES[0][1];
    for (let k = 0; k < SAMPLES.length - 1; k++) {
      const [ya, ra] = SAMPLES[k], [yb, rb] = SAMPLES[k + 1];
      if (y >= ya && y <= yb) {
        r = ra + (rb - ra) * ((y - ya) / Math.max(1e-6, yb - ya));
        break;
      }
      if (y > yb) r = rb;
    }
    t[i] = r;
  }
  return t;
})();
export function innerR(y: number) {
  const f = Math.max(0, Math.min(BODY_H, y)) * 20;
  const i = Math.min(R_TAB.length - 2, Math.floor(f));
  return R_TAB[i] + (R_TAB[i + 1] - R_TAB[i]) * (f - i);
}
/** outer glass radius at absolute jar height Y */
const outerAt = (Y: number) => innerR(Y - BODY_Y0) + GLASS_T;

// ------------------------------------------------------------------ brass
const BR = { base: 0xc79236, shade: 0x8c5a1e, hi: 0xf6d27c, dark: 0x4a2c0c, patina: 0x4f9e86, patinaD: 0x2f6a5a };
function brassPaint(salt: number) {
  return (x: number, y: number, z: number, s: Surf): number | [number, number] => {
    const X = x / VPH, Y = y / VPH, Z = z / VPH;
    const n = fbm3(X * 0.35 + salt, Y * 0.35, Z * 0.35);
    const fine = h3(x, y, z, salt);
    // key light from upper-left-front
    const lit = s.nx * -0.45 + s.ny * 0.62 + s.nz * 0.64;
    let c = lit > 0.55 ? BR.hi : lit > 0.05 ? BR.base : lit > -0.35 ? mixc(BR.base, BR.shade, 0.6) : BR.shade;
    if (s.exp > 0.52) c = mixc(c, BR.hi, 0.55); // rubbed bright edges
    if (s.exp < 0.3) {
      // crevices: dark grime and verdigris blooms
      c = mixc(c, BR.dark, 0.55);
      if (n > -0.1) c = mixc(c, n > 0.3 ? BR.patina : BR.patinaD, 0.55 + 0.3 * fine);
    } else if (n > 0.45 && s.ny > -0.2) c = mixc(c, BR.patina, (n - 0.45) * 1.2);
    c = mulc(c, 0.93 + fine * 0.12);
    return [c, METAL];
  };
}

/** the foot: a flanged, waisted brass cup with a ring of lotus petals */
function footModel() {
  const pts: [number, number][] = [[0, 10.0], [0.4, 10.6], [1.1, 10.6], [1.5, 9.5], [2.6, 8.8], [3.3, 9.2], [4.6, 9.75], [5.4, 9.1]];
  const rF = (Y: number) => {
    for (let i = 0; i < pts.length - 1; i++) if (Y <= pts[i + 1][0]) return lerp(pts[i][1], pts[i + 1][1], (Y - pts[i][0]) / (pts[i + 1][0] - pts[i][0]));
    return pts[pts.length - 1][1];
  };
  const sd = (x: number, y: number, z: number) => {
    const X = x / VPH, Y = y / VPH, Z = z / VPH;
    if (Y < 0 || Y > 5.4) return 1;
    const r = len2(X, Z), ph = Math.atan2(X, Z);
    let R = rF(Y);
    if (Y > 3.0) {
      const k = sstep(3.0, 3.6, Y) * (1 - sstep(4.9, 5.4, Y));
      const petal = Math.pow(Math.abs(Math.cos(ph * 6)), 2.5);
      R += k * (0.55 * petal - 0.25);
    }
    if (Y > 0.5 && Y < 0.9) R -= 0.25; // a turned groove on the flange
    if (Y > 4.2 && r < 8.3) return 1; // the glass sits in the cup
    return (r - R) * VPH;
  };
  return sculpt('soul_foot', [-23, 0, -23, 23, 11, 23], sd, brassPaint(1.3));
}

const STRAPS = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
const RIVET_Y = [9, 14.5, 20, 26.5];
const CART_Y = 19.4;
/** straps, bands, collar and the soul-gem cartouche (gem voxels are emissive) */
function cageModel() {
  const wrap = (a: number) => {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  };
  const gem = (X: number, Y: number, Z: number) => len3((X) / 1.9, (Y - CART_Y) / 2.4, (Z - 13.55) / 1.15) - 1;
  const sd = (x: number, y: number, z: number) => {
    const X = x / VPH, Y = y / VPH, Z = z / VPH;
    const r = len2(X, Z);
    let d = 9;
    // the cartouche plate + bezel + gem on the front of the belly
    if (Z > 11 && Math.abs(X) < 4.5 && Math.abs(Y - CART_Y) < 5) {
      const e = len2(X / 3.3, (Y - CART_Y) / 4.0);
      const plate = Math.max((e - 1) * 3.3, Math.abs(Z - 12.9) - 0.5);
      const bezel = Math.max(Math.abs(len2(X / 2.25, (Y - CART_Y) / 2.75) - 1) * 2.3 - 0.45, Math.abs(Z - 13.5) - 0.45);
      d = Math.min(d, plate, bezel, gem(X, Y, Z) * 1.2);
    }
    if (Y < 5.2 || Y > 35.2) return d * VPH;
    const out = outerAt(Y);
    if (r < out - 0.25) return Math.min(d, out - 0.25 - r + 0.01) * VPH;
    // collar round the neck
    if (Y > 29.4) {
      let Rc = Y < 30.4 ? 7.6 : Y > 34.2 ? 7.7 : 7.05;
      if (Y >= 30.4 && Y <= 34.2) Rc += 0.28 * Math.pow(Math.abs(Math.sin(Math.atan2(X, Z) * 14)), 1.5);
      if (Y > 31.6 && Y < 32.0) Rc -= 0.35;
      d = Math.min(d, Math.max(r - Rc, Math.max(29.4 - Y, Y - 35.0)));
    }
    if (r > out + 2.2) return d * VPH;
    const ph = Math.atan2(X, Z);
    // the low band and the shoulder band
    for (const [yc, hh] of [[6.6, 0.55], [23.3, 0.7]] as [number, number][]) {
      const band = Math.max(Math.abs(Y - yc) - hh, Math.abs(r - (out + 0.38)) - 0.38);
      d = Math.min(d, band);
    }
    // four straps with domed rivets
    for (const a of STRAPS) {
      const t = wrap(ph - a) * r;
      if (Math.abs(t) > 3) continue;
      const strap = Math.max(Math.abs(t) - 1.15, Math.abs(r - (out + 0.42)) - 0.42);
      d = Math.min(d, Y > 29.6 ? 9 : strap);
      for (const ry of RIVET_Y) {
        const rr = outerAt(ry) + 0.75;
        const rx = Math.sin(a) * rr, rz = Math.cos(a) * rr;
        d = Math.min(d, len3(X - rx, Y - ry, Z - rz) - 0.72);
      }
    }
    return d * VPH;
  };
  const paint = brassPaint(4.1);
  return sculpt('soul_cage', [-30, 10, -30, 30, 71, 31], sd, (x, y, z, s) => {
    const X = x / VPH, Y = y / VPH, Z = z / VPH;
    if (gem(X + 0.25, Y + 0.25, Z + 0.25) < 0.08) {
      // the soul gem: a jade cabochon with a bright crown and a deep heart
      const lit = s.nx * -0.4 + s.ny * 0.6 + s.nz * 0.7;
      const c = lit > 0.82 ? 0xeafff2 : lit > 0.45 ? 0x7cf2b4 : lit > 0 ? 0x36c486 : 0x15684a;
      return [c, VF.SOLID | VF.EMISSIVE];
    }
    return paint(x, y, z, s);
  });
}

/** the gadrooned stopper (origin = its bottom, sits on the collar) */
function lidModel() {
  const pts: [number, number][] = [[0, 7.7], [1.0, 7.7], [1.25, 7.1], [2, 6.85], [3, 6.05], [4, 4.7], [4.6, 3.5], [5.0, 2.7], [5.4, 2.9], [6.2, 2.85], [6.6, 2.4], [6.8, 0]];
  const rL = (Y: number) => {
    for (let i = 0; i < pts.length - 1; i++) if (Y <= pts[i + 1][0]) return lerp(pts[i][1], pts[i + 1][1], (Y - pts[i][0]) / (pts[i + 1][0] - pts[i][0]));
    return 0;
  };
  const sd = (x: number, y: number, z: number) => {
    const X = x / VPH, Y = y / VPH, Z = z / VPH;
    if (Y < 0 || Y > 6.8) return 1;
    const ph = Math.atan2(X, Z);
    let R = rL(Y);
    if (Y > 1.3 && Y < 4.5) R += 0.28 * Math.cos(ph * 16) * sstep(1.3, 1.8, Y) * (1 - sstep(4.0, 4.5, Y)); // gadroons
    if (Math.abs(Y - 1.6) < 0.18) R -= 0.3;
    if (Math.abs(Y - 5.6) < 0.2) R -= 0.3;
    return (len2(X, Z) - R) * VPH;
  };
  return sculpt('soul_lid', [-16, 0, -16, 16, 14, 16], sd, brassPaint(7.7));
}

// ------------------------------------------------------------------ glass + smoke (lathe meshes)
/** a lathe from (r, y) points with a blown-glass wobble and a slight lean */
function blownLathe(pts: [number, number][], seg: number, wob: number) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ph = Math.atan2(x, z);
    const k = 1 + wob * (Math.sin(ph * 3 + y * 0.31) * 0.6 + Math.sin(ph * 5 - y * 0.17 + 1.3) * 0.4);
    p.setXYZ(i, x * k + y * 0.012, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}

const SMOKE_VS = /* glsl */ `
varying vec3 vObj;
void main(){ vObj = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SMOKE_FS = /* glsl */ `
uniform float uR[31];
uniform vec3 uDir, uLdir;
uniform float uT, uLevel, uReady, uSurge, uDrain, uTilt;
uniform vec3 uDeep, uMid, uHi;
varying vec3 vObj;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ return vn(p) * 0.55 + vn(p * 2.03 + 7.1) * 0.3 + vn(p * 4.11 + 3.3) * 0.15; }
float rAt(float y){ float f = clamp(y, 0.0, 29.999); int i = int(floor(f)); return mix(uR[i], uR[i + 1], f - float(i)); }
float level(vec2 xz){
  float a = atan(xz.y, xz.x);
  return uLevel * 29.6 + (sin(a * 2.0 + uT * 2.3) * 0.35 + sin(a * 3.0 - uT * 1.7) * 0.22) * (0.7 + uSurge * 2.5) + uTilt * xz.x;
}
float dens(vec3 p, out float body){
  body = 0.0;
  float r = length(p.xz);
  if (p.y < 0.0 || r > rAt(p.y) - 0.3) return 0.0;
  float L = level(p.xz);
  float sw = uT * (0.5 + uSurge * 2.5 + uDrain * 7.0) + p.y * 0.2 + uDrain * (7.0 - r) * 0.7;
  float c = cos(sw), s = sin(sw);
  vec2 q = mat2(c, -s, s, c) * p.xz;
  float n = fbm(vec3(q.x * 0.17, p.y * 0.12 - uT * 0.32, q.y * 0.17));
  body = smoothstep(L + 0.6, L - 1.6, p.y);
  float d = body * (0.25 + 1.1 * n * n * 1.6);
  // wisps curling above the surface once the jar is full
  float w = (1.0 - body) * uReady * smoothstep(0.52, 0.8, n) * smoothstep(L + 7.0, L + 0.5, p.y) * 0.9;
  return d + w;
}
void main(){
  vec3 dir = normalize(uDir);
  vec3 p = vObj + dir * 0.2;
  vec3 acc = vec3(0.0);
  float T = 1.0, body;
  for (int i = 0; i < 24; i++){
    float d = dens(p, body);
    if (d > 0.01){
      float bl;
      float dl = dens(p + uLdir * 1.8, bl);
      float lit = clamp(0.55 + (d - dl) * 1.2 - (1.0 - body) * 0.2, 0.0, 1.0);
      // anime-painted: a stepped light ramp with soft edges
      float ramp = smoothstep(0.32, 0.38, lit) * 0.5 + smoothstep(0.66, 0.72, lit) * 0.5;
      vec3 col = mix(uDeep, uMid, ramp * 0.9 + 0.1);
      col = mix(col, uHi, smoothstep(0.85, 1.0, lit) * 0.8);
      float L = level(p.xz);
      col += uHi * smoothstep(1.4, 0.0, abs(p.y - L)) * (0.25 + uReady * 0.25) * body;
      col *= 0.8 + uReady * (0.35 + 0.25 * sin(uT * 5.0));
      col += uMid * uSurge * 0.4;
      float a = 1.0 - exp(-d * 0.62);
      acc += T * a * col;
      T *= 1.0 - a;
      if (T < 0.04) break;
    }
    p += dir * 1.05;
  }
  float A = 1.0 - T;
  if (A < 0.01) discard;
  gl_FragColor = vec4(acc / A, A);
  #include <colorspace_fragment>
}`;

const GLASS_VS = /* glsl */ `
varying vec3 vN, vObj;
void main(){ vObj = position; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GLASS_FS = /* glsl */ `
uniform float uT, uReady, uFlash;
uniform vec3 uTintG, uGlow;
varying vec3 vN, vObj;
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec3 n = normalize(vN);
  float f = pow(1.0 - abs(n.z), 2.4);
  // anime glass: two hard specular streaks that follow the curvature, broken at the shoulder
  float y = vObj.y;
  float neckFade = smoothstep(30.0, 26.0, y) * smoothstep(1.0, 4.0, y);
  float s1 = smoothstep(-0.70, -0.64, n.x) * smoothstep(-0.36, -0.42, n.x) * neckFade * step(0.0, n.z);
  s1 *= 1.0 - smoothstep(0.4, 0.55, abs(n.y)) ;
  float s2 = smoothstep(0.48, 0.51, n.x) * smoothstep(0.60, 0.57, n.x) * neckFade;
  float s3 = smoothstep(0.55, 0.62, n.y) * smoothstep(-0.2, -0.05, n.x) * smoothstep(0.35, 0.2, n.x); // shoulder catch-light
  // seed bubbles in the glass
  vec2 cell = vec2(atan(vObj.x, vObj.z) * 9.0, y * 1.2);
  vec2 id = floor(cell), fr = fract(cell) - 0.5;
  float hb = hash2(id);
  float bub = step(0.9, hb) * smoothstep(0.16, 0.08, length(fr + (hash2(id + 3.1) - 0.5) * 0.5));
  // dust settled at the base
  float dust = smoothstep(3.5, 0.0, y);
  vec3 col = mix(uTintG, vec3(1.0), clamp(s1 + s2 * 0.8 + s3 * 0.6 + bub * 0.6, 0.0, 1.0));
  col = mix(col, vec3(0.55, 0.42, 0.28), dust * 0.6);
  col += uGlow * f * (uReady * (0.55 + 0.45 * sin(uT * 5.0)) + uFlash);
  float a = 0.05 + f * 0.5 + s1 * 0.75 + s2 * 0.55 + s3 * 0.35 + bub * 0.35 + dust * 0.25 + uFlash * 0.25;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
  #include <colorspace_fragment>
}`;

// ------------------------------------------------------------------ the bar

export interface SoulAnchor {
  /** jar foot centre, HUD px */
  x: number;
  y: number;
  /** size factor (small screens) */
  k: number;
  frac: number;
  ready: boolean;
  /** where the soul goes when unleashed (Sundown on screen), HUD px */
  heroX: number;
  heroY: number;
}

export class SoulBar {
  private root = new THREE.Group();
  private jar = new THREE.Group();
  private lid = new THREE.Group();
  private brassMat: VoxelMaterial;
  private smoke: THREE.Mesh;
  private smokeMat: THREE.ShaderMaterial;
  private glass: THREE.Mesh;
  private glassMat: THREE.ShaderMaterial;
  private pinch: RigInstance | null = null;
  private pinchMat: VoxelMaterial;
  private fx: PixelFx;
  private glow: PixelFx;
  private t = 0;
  private shown = 0;
  private lastUlt = -1;
  private ready = false;
  private readyT = 0;
  private surge = 0;
  private flash = 0;
  private jolt = 0;
  private drainT = -1;
  private drainFrom = 1;
  private tilt = 0;
  private tiltV = 0;
  private pinchHop = 0;
  private built = false;

  constructor(private scene: THREE.Scene, private hud: Hud) {
    this.brassMat = makeVoxelMaterial({ fog: false });
    this.pinchMat = makeVoxelMaterial({ fog: false });
    const smokePts: [number, number][] = [[0, 0.15]];
    for (const [y, r] of SAMPLES) if (y <= 29.4) smokePts.push([innerR(y) - 0.25, Math.max(0.15, y)]);
    smokePts.push([0, 29.4]);
    const uR = new Float32Array(31);
    for (let i = 0; i <= 30; i++) uR[i] = innerR(i);
    this.smokeMat = new THREE.ShaderMaterial({
      uniforms: {
        uR: { value: uR },
        uDir: { value: new THREE.Vector3(0, 0, -1) },
        uLdir: { value: new THREE.Vector3(-0.4, 0.7, 0.6) },
        uT: { value: 0 },
        uLevel: { value: 0 },
        uReady: { value: 0 },
        uSurge: { value: 0 },
        uDrain: { value: 0 },
        uTilt: { value: 0 },
        uDeep: { value: new THREE.Color(0x0b3d2c) },
        uMid: { value: new THREE.Color(0x2fbf7e) },
        uHi: { value: new THREE.Color(0xb8ffd8) },
      },
      vertexShader: SMOKE_VS,
      fragmentShader: SMOKE_FS,
      transparent: true,
      depthWrite: false,
    });
    this.smoke = new THREE.Mesh(blownLathe(smokePts, 40, 0), this.smokeMat);
    this.smoke.position.y = BODY_Y0;
    this.smoke.renderOrder = 1;
    const glassPts: [number, number][] = [[0, -GLASS_T]];
    for (const [y] of SAMPLES) glassPts.push([innerR(y) + GLASS_T, y]);
    glassPts.push([innerR(BODY_H) + GLASS_T * 0.6, BODY_H + 0.35], [innerR(BODY_H) - 0.1, BODY_H + 0.45]);
    this.glassMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uReady: { value: 0 }, uFlash: { value: 0 }, uTintG: { value: new THREE.Color(0xcfe8dc) }, uGlow: { value: new THREE.Color(0x6dffb4) } },
      vertexShader: GLASS_VS,
      fragmentShader: GLASS_FS,
      transparent: true,
      depthWrite: false,
    });
    this.glass = new THREE.Mesh(blownLathe(glassPts, 48, 0.012), this.glassMat);
    this.glass.position.y = BODY_Y0;
    this.glass.renderOrder = 2;
    this.jar.add(this.smoke, this.glass);
    this.jar.add(this.lid);
    this.root.add(this.jar);
    this.root.visible = false;
    scene.add(this.root);
    this.fx = new PixelFx(500, false, 30);
    this.glow = new PixelFx(500, true, 31);
    scene.add(this.fx.points, this.glow.points);
  }

  /** the voxel parts are sculpted on first use (keeps scene start snappy) */
  private build() {
    this.built = true;
    const T0 = performance.now(); setTimeout(() => console.log('[TMPPERF] build', 'SoulBar.ts', Math.round(performance.now() - T0)), 0);
    try {
      const vs = 1 / VPH;
      const foot = new THREE.Mesh(buildVoxelGeometry(footModel(), { voxelSize: vs, pivot: [0, 0, 0] }), this.brassMat);
      const cage = new THREE.Mesh(buildVoxelGeometry(cageModel(), { voxelSize: vs, pivot: [0, 0, 0] }), this.brassMat);
      const lid = new THREE.Mesh(buildVoxelGeometry(lidModel(), { voxelSize: vs, pivot: [0, 0, 0] }), this.brassMat);
      this.jar.add(foot, cage);
      this.lid.add(lid);
      this.lid.position.y = 34.9;
    } catch (e) {
      console.warn('[soul] jar build failed', e);
    }
    try {
      const ps = modelEntry('pinch')?.() as RigSpec | undefined;
      if (ps?.parts) {
        this.pinch = new RigInstance(buildRigGeo(ps, ps.name + ':soul'), { material: this.pinchMat, castShadow: false });
        const len = (ps.meta?.length as number) ?? 0.65;
        this.pinch.root.scale.setScalar(17 / len);
        this.pinch.root.position.set(0, 6.6, 0);
        this.lid.add(this.pinch.root);
      }
    } catch (e) {
      console.warn('[soul] pinch failed', e);
    }
  }

  update(dt: number, a: SoulAnchor | null, visible: boolean, s: number) {
    this.t += dt;
    const show = !!a && visible;
    this.root.visible = show;
    this.fx.update(dt, s);
    this.glow.update(dt, s);
    if (!a) return;
    if (show && !this.built) this.build();
    const ult = Math.max(0, Math.min(1, a.frac));
    const k = a.k;
    if (this.lastUlt < 0) {
      this.lastUlt = ult;
      this.shown = ult;
    }
    // ---------------------------------------------------- events
    const gain = ult - this.lastUlt;
    if (this.lastUlt >= 0.999 && ult < 0.5) this.unleash(a);
    else if (gain > 0.003 && this.drainT < 0) this.pour(a, gain);
    const nowReady = ult >= 0.999;
    if (nowReady && !this.ready) {
      this.flash = 1;
      this.jolt = 1;
      uiSfx('ult_ready', 0.7);
      this.burst(a, 36);
    }
    this.ready = nowReady;
    this.readyT = nowReady ? this.readyT + dt : 0;
    this.lastUlt = ult;

    // ---------------------------------------------------- level
    let drain = 0;
    if (this.drainT >= 0) {
      this.drainT += dt;
      const kd = Math.min(1, this.drainT / 1.05);
      drain = Math.sin(Math.min(1, this.drainT / 1.2) * Math.PI);
      this.shown = lerp(this.drainFrom, ult, kd * kd * (3 - 2 * kd));
      if (this.drainT < 0.95) this.stream(a, dt);
      if (this.drainT > 1.6) this.drainT = -1;
    } else this.shown += (ult - this.shown) * Math.min(1, dt * 3.2);
    this.surge = Math.max(0, this.surge - dt * 1.4);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.jolt = Math.max(0, this.jolt - dt * 3);

    // ---------------------------------------------------- pose
    // a damped slosh: the jar tilts with jolts, the smoke surface follows
    this.tiltV += (-this.tilt * 60 - this.tiltV * 7) * dt;
    this.tilt += this.tiltV * dt;
    const rattle = this.ready ? Math.sin(this.t * 47) * 0.012 * (0.5 + 0.5 * Math.sin(this.t * 3.1)) : 0;
    this.root.position.set(a.x * s, -a.y * s, 40);
    const pop = 1 + this.jolt * 0.06 * Math.sin(this.jolt * 12);
    this.root.scale.setScalar(s * k * pop);
    this.jar.rotation.set(0.1 + Math.sin(this.t * 0.8) * 0.02, -0.35 + Math.sin(this.t * 0.45) * 0.12, this.tilt + rattle + Math.sin(this.t * 0.9) * 0.015);
    // the stopper: rattles when full, pops and spins when uncorked
    let lidUp = 0, lidSpin = 0;
    if (this.drainT >= 0) {
      const u = this.drainT;
      lidUp = u < 0.12 ? (u / 0.12) * 7 : u < 1.1 ? 7 + Math.sin((u - 0.12) * 9) * 0.6 : Math.max(0, 7 * (1 - (u - 1.1) / 0.3));
      lidSpin = u * 7;
      if (u > 1.4 && u - dt <= 1.4) uiSfx('rev_close', 0.45, 0.8);
    } else if (this.ready) lidUp = Math.max(0, Math.sin(this.t * 23)) * 0.45 * (Math.sin(this.t * 2.7) > 0.3 ? 1 : 0.15);
    this.lid.position.y = 34.9 + lidUp;
    this.lid.rotation.set(rattle * 2, lidSpin + Math.sin(this.t * 0.5) * 0.1, -rattle * 3);
    this.animPinch(dt, a);

    // ---------------------------------------------------- shaders
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.smoke.matrixWorld).invert();
    (this.smokeMat.uniforms.uDir.value as THREE.Vector3).set(0, 0, -1).transformDirection(inv);
    (this.smokeMat.uniforms.uLdir.value as THREE.Vector3).set(-0.45, 0.8, 0.6).transformDirection(inv);
    const u = this.smokeMat.uniforms;
    u.uT.value = this.t;
    u.uLevel.value = this.shown <= 0.002 ? -0.05 : 0.04 + this.shown * 0.96;
    u.uReady.value = this.ready ? Math.min(1, this.readyT * 2) : 0;
    u.uSurge.value = Math.min(1.2, this.surge);
    u.uDrain.value = drain;
    u.uTilt.value = this.tilt * 2.5;
    const g = this.glassMat.uniforms;
    g.uT.value = this.t;
    g.uReady.value = u.uReady.value;
    g.uFlash.value = this.flash;
    this.brassMat.userData.fx.value.z = (this.ready ? 1.6 + Math.sin(this.t * 5) * 0.9 : 0.25 + this.shown * 0.6) + this.flash * 2;
    // ---------------------------------------------------- ambient particles
    if (show) this.ambient(dt, a);
  }

  /** soul motes fly in from the field and spiral down the mouth */
  private pour(a: SoulAnchor, gain: number) {
    this.surge = Math.min(1.5, this.surge + gain * 14);
    if (gain > 0.025) {
      this.jolt = Math.max(this.jolt, 0.7);
      this.tiltV += 1.2;
    } else this.tiltV += gain * 20;
    const k = a.k;
    const mx = a.x, my = a.y - 36 * k;
    const n = Math.min(46, 3 + Math.round(gain * 520));
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU, r = (26 + Math.random() * 34) * k;
      const sx = mx + Math.cos(ang) * r, sy = my + Math.sin(ang) * r * 0.8 - 8 * k;
      const life = 0.45 + Math.random() * 0.45;
      const c = Math.random() < 0.25 ? 0xeafff2 : Math.random() < 0.5 ? 0x7cf2b4 : 0x35c98a;
      this.glow.emit({ x: sx, y: sy, tx: mx + (Math.random() - 0.5) * 3 * k, ty: my + 3 * k, vx: -Math.sin(ang) * 22 * k, vy: Math.cos(ang) * 22 * k - 6, life, size: Math.random() < 0.3 ? 2 : 1, size1: 1, c0: c, c1: 0x2a9a6a, alpha: 0.95, curl: 4 });
    }
  }

  private burst(a: SoulAnchor, n: number) {
    const k = a.k;
    const cx = a.x, cy = a.y - 22 * k;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU, v = (40 + Math.random() * 70) * k;
      this.glow.emit({ x: cx + Math.cos(ang) * 8 * k, y: cy + Math.sin(ang) * 12 * k, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 20, ay: -10, drag: 2.5, life: 0.5 + Math.random() * 0.6, size: Math.random() < 0.3 ? 2 : 1, c0: 0xeafff2, c1: 0x2fbf7e, alpha: 1, flick: 0.4 });
    }
  }

  /** uncork: the whole soul whirls out and streams into Sundown */
  private unleash(a: SoulAnchor) {
    this.drainT = 0;
    this.drainFrom = Math.max(this.shown, 0.98);
    this.flash = 1;
    this.jolt = 1;
    this.tiltV -= 2.2;
    this.pinchHop = 1;
    uiSfx('soul_leave', 0.8, 1.15);
    uiSfx('rev_open', 0.5, 0.7);
    this.burst(a, 50);
  }

  private stream(a: SoulAnchor, dt: number) {
    const k = a.k;
    const mx = a.x, my = a.y - 37 * k;
    const n = Math.round(dt * 260);
    for (let i = 0; i < n; i++) {
      const life = 0.5 + Math.random() * 0.35;
      const side = (Math.random() - 0.5) * 2;
      const c = Math.random() < 0.3 ? 0xeafff2 : Math.random() < 0.6 ? 0x7cf2b4 : 0x2fbf7e;
      this.glow.emit({
        x: mx + (Math.random() - 0.5) * 6 * k, y: my - Math.random() * 4 * k,
        tx: a.heroX + (Math.random() - 0.5) * 14, ty: a.heroY + (Math.random() - 0.5) * 18,
        vx: 40 + side * 50, vy: -90 - Math.random() * 60,
        life, size: Math.random() < 0.35 ? 2 : 1, size1: Math.random() < 0.5 ? 3 : 1, c0: c, c1: 0x9dff3a, alpha: 1, curl: 10,
      });
      if (Math.random() < 0.35)
        this.fx.emit({ x: mx + (Math.random() - 0.5) * 8 * k, y: my, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 30, ay: -20, drag: 1.5, life: 0.6 + Math.random() * 0.5, size: 2, size1: 4, c0: 0x2a8a62, c1: 0x0e3a28, alpha: 0.5, curl: 8 });
    }
    // arrival flare at Sundown
    if (Math.random() < dt * 30)
      for (let i = 0; i < 5; i++) {
        const ang = Math.random() * TAU, v = 30 + Math.random() * 60;
        this.glow.emit({ x: a.heroX, y: a.heroY, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, drag: 3, life: 0.35 + Math.random() * 0.3, size: 1, c0: 0xeafff2, c1: 0x9dff3a, alpha: 1 });
      }
  }

  private ambient(dt: number, a: SoulAnchor) {
    const k = a.k;
    const mx = a.x, my = a.y - 35.5 * k;
    if (this.ready) {
      // wisps leak from under the stopper and curl up
      if (Math.random() < dt * 16) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.fx.emit({ x: mx + side * (6 + Math.random() * 2) * k, y: my, vx: side * (4 + Math.random() * 6), vy: -14 - Math.random() * 10, ay: -6, drag: 0.6, life: 1.1 + Math.random() * 0.9, size: 1, size1: 3, c0: 0x6ff0b0, c1: 0x1d6a4a, alpha: 0.65, curl: 7 });
      }
      if (Math.random() < dt * 10) this.glow.emit({ x: mx + (Math.random() - 0.5) * 16 * k, y: my + Math.random() * 10 * k, vx: (Math.random() - 0.5) * 6, vy: -16 - Math.random() * 14, drag: 0.4, life: 0.8 + Math.random() * 0.8, size: 1, c0: 0xeafff2, c1: 0x2fbf7e, alpha: 0.9, flick: 0.6, curl: 5 });
    } else if (this.shown > 0.05 && Math.random() < dt * (0.6 + this.shown * 2.5)) {
      // a faint motes drifting inside the glass
      const r = Math.random() * 8 * k;
      this.glow.emit({ x: mx + (Math.random() - 0.5) * r * 2, y: a.y - (6 + Math.random() * this.shown * 22) * k, vx: (Math.random() - 0.5) * 3, vy: -3 - Math.random() * 4, life: 0.7 + Math.random() * 0.6, size: 1, c0: 0xb8ffd8, c1: 0x2fbf7e, alpha: 0.55, flick: 0.5 });
    }
  }

  private animPinch(dt: number, a: SoulAnchor) {
    const p = this.pinch;
    if (!p) return;
    this.pinchHop = Math.max(0, this.pinchHop - dt * 1.6);
    const ready = this.ready;
    const hop = this.pinchHop > 0 ? Math.abs(Math.sin(this.pinchHop * Math.PI * 2)) * 5 * this.pinchHop : 0;
    p.root.position.set(0, 6.6 + hop + (ready ? Math.abs(Math.sin(this.t * 6)) * 0.6 : 0), 0);
    p.root.rotation.set(0, 0.9 + Math.sin(this.t * (ready ? 2.2 : 0.5)) * (ready ? 0.5 : 0.35), 0);
    const n = p.nodes;
    for (let i = 1; i <= 5; i++) if (n['tail' + i]) n['tail' + i].rotation.x = -0.28 + Math.sin(this.t * (ready ? 7 : 1.8) + i * 0.6) * (ready ? 0.2 : 0.07);
    const snap = ready ? Math.max(0, Math.sin(this.t * 9)) * 0.6 : this.surge > 0.3 ? Math.max(0, Math.sin(this.t * 14)) * 0.4 : 0;
    if (n['pincer_l']) n['pincer_l'].rotation.x = -snap;
    if (n['pincer_r']) n['pincer_r'].rotation.x = -snap * 0.8;
    const tint = this.pinchMat.userData.tint.value;
    const f = 0.82 + this.shown * 0.18;
    tint.setRGB(f, f, f);
    p.setExpression(ready || this.pinchHop > 0 ? 'happy' : this.shown < 0.2 ? 'sleepy' : 'neutral');
    void a;
  }

  dispose() {
    this.root.removeFromParent();
    this.fx.dispose();
    this.glow.dispose();
    this.smokeMat.dispose();
    this.glassMat.dispose();
    void this.scene;
    void this.hud;
  }
}
