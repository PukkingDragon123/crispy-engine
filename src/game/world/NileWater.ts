// The Nile's surface: a rideable, flowing river (and, once Ra burns the valley,
// a river of lava).
//
//  - Geometry: the wet part of the map as 128 m tiles of a 2 m grid (frustum
//    culled), each vertex carrying the river's own coordinates (along s, across u),
//    the swell amplitude, the bed depth and the current. Swells are displaced in the
//    vertex shader near the camera; the CPU twin (heightAt / sample) evaluates the
//    same maths, so the board, enemies and boats ride exactly what is drawn.
//  - Look (anime-painted, phone-cheap): a banded depth ramp, three cel light bands
//    on the swell faces, a banded sky fresnel, pixel sun glitter, flow-advected foam
//    blobs and shore wash with dark ink rims, V wakes behind the riders and boats,
//    whitecaps on steep swell fronts, all on the terrain's 16 texel / m pixel grid.
//  - Lava: crust plates drifting downstream (cooled, safe to ride) between molten,
//    glowing channels (deep molten lava burns), shallows crusted over, HDR glow.
//  - Fx: rooster-tail spray, a foam trail, carve spray, landing splashes, rapids
//    mist; on lava embers, sparks, smoke and falling ash.
import * as THREE from 'three';
import type { Heightfield } from './Heightfield';
import { RiverNet, swellAt, SWELL, hash2, type RiverHit } from './NileRiver';
import { BURN, BURN_GLSL, burnAt } from './NileBurn';
import { globalUniforms, atmoFogUniforms } from '../../engine/render/VoxelMaterial';

export interface WaterSample {
  /** surface height (m), including swells */
  h: number;
  /** surface minus bed (m); <= 0 means dry ground */
  depth: number;
  /** current (m/s) */
  fx: number;
  fz: number;
  /** surface gradient (rise per metre) */
  gx: number;
  gz: number;
  /** 0 water .. 1 lava */
  lava: number;
  /** molten lava here (not crust): burns on contact */
  molten: boolean;
  /** swell amplitude here (m) */
  amp: number;
}

/** what every water body in the game answers (the Nile river, the oasis pool) */
export interface WaterSurface {
  readonly level: number;
  /** the surface's material (shader uniforms), where it has one */
  material?: THREE.Material | null;
  /** surface height incl. swells (the still level over dry ground) */
  heightAt(x: number, z: number): number;
  /** current (m/s) */
  flowAt(x: number, z: number, out?: { x: number; z: number }): { x: number; z: number };
  /** surface minus bed (m), <= 0 dry */
  depthAt(x: number, z: number): number;
  isWater(x: number, z: number, minDepth?: number): boolean;
  /** 0..1: how far Ra's fire has turned the water here to lava */
  lavaAt(x: number, z: number): number;
  /** molten lava (not cooled crust): contact burns */
  moltenAt(x: number, z: number): boolean;
  sample(x: number, z: number, out: WaterSample): WaterSample;
  /** a moving hull this frame (boats, swimmers): draws its V wake */
  wake(x: number, z: number, vx: number, vz: number, size?: number): void;
  /** something hit the water: spray and rings */
  splash(x: number, z: number, size?: number): void;
  update(dt: number, time: number, focus: THREE.Vector3, fx: any): void;
  dispose(): void;
}

const TILE = 128;
const CELL = 2;
const MAX_WAKES = 8;
/** crust plates drift downstream at this speed (m/s) */
const CRUST_V = 1.25;
const PLATE_S = 7, PLATE_U = 4.5;

const vert = /* glsl */ `
attribute vec4 aRiv;   // s, u, amp, bed depth
attribute vec3 aFlow;  // flow x, z, standing-wave share
uniform float uWaveT;
uniform vec4 uSw1; // l1 c1 a1 l0
uniform vec4 uSw2; // a0 l2 c2 a2
uniform vec4 uSw3; // l3 c3 a3 -
varying vec3 vW;
varying vec4 vRiv;
varying vec3 vFlow;
varying vec3 vN;
varying float vCrest;
${BURN_GLSL}
#include <fog_pars_vertex>
float prof(float ph){ float f = fract(ph); return f < 0.74 ? -1.0 + 2.0 * smoothstep(0.0, 1.0, f / 0.74) : 1.0 - 2.0 * smoothstep(0.0, 1.0, (f - 0.74) / 0.26); }
float swell(float s, float u, float amp, float stand, float t) {
  float p1 = prof((s - uSw1.y * t) / uSw1.x + u * 0.011);
  float p0 = stand > 0.001 ? prof(s / uSw1.w + sin(u * 0.21) * 0.18) * stand : 0.0;
  float ch = sin(((s * 0.8 + u * 0.6) / uSw2.y - (uSw2.z / uSw2.y) * t) * 6.2831853) * uSw2.w
           + sin(((s * 0.55 - u * 0.83) / uSw3.x - (uSw3.y / uSw3.x) * t) * 6.2831853) * uSw3.z;
  return amp * (p1 * uSw1.z + p0 * uSw2.x) + min(1.0, amp * 1.5) * ch;
}
void main(){
  vec3 p = position;
  vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
  float amp = aRiv.z * (1.0 - 0.65 * burnSmooth(wp0.xz));
  float fade = 1.0 - smoothstep(130.0, 190.0, distance(wp0.xz, cameraPosition.xz));
  vec2 T = normalize(aFlow.xy + vec2(1e-5, 0.0));
  vec2 Nn = vec2(-T.y, T.x);
  float h = 0.0;
  vec2 g = vec2(0.0);
  if (amp > 0.001 && fade > 0.0) {
    h = swell(aRiv.x, aRiv.y, amp, aFlow.z, uWaveT);
    float hs = (swell(aRiv.x + 0.5, aRiv.y, amp, aFlow.z, uWaveT) - h) / 0.5;
    float hu = (swell(aRiv.x, aRiv.y + 0.5, amp, aFlow.z, uWaveT) - h) / 0.5;
    g = (T * hs + Nn * hu) * fade;
  }
  vN = normalize(vec3(-g.x, 1.0, -g.y));
  vCrest = amp > 0.001 ? h / (amp * (uSw1.z + uSw2.x * aFlow.z) + 0.12) : 0.0;
  p.y += h * fade;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vRiv = aRiv;
  vFlow = aFlow;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
uniform float uTime, uCrustT;
uniform vec3 uDeep, uMid, uShallow, uFoam, uInk, uSky, uHorizon, uSunDirW, uSunCol;
uniform vec4 uWake[${MAX_WAKES}];
uniform float uWakeS[${MAX_WAKES}];
uniform float uWakeN;
varying vec3 vW;
varying vec4 vRiv;
varying vec3 vFlow;
varying vec3 vN;
varying float vCrest;
${BURN_GLSL}
#include <fog_pars_fragment>
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  vec2 cell = floor(vW.xz * 16.0);
  vec2 px = (cell + 0.5) / 16.0;
  float depth = vRiv.w;
  float hp = h21(cell);
  vec3 N = normalize(vN);
  float rel = dot(N, uSunDirW) - uSunDirW.y;
  // ------------------------------------------------ the painted river
  float b = clamp(depth / 3.2, 0.0, 1.0) + (hp - 0.5) * 0.05;
  vec3 col = b < 0.06 ? uShallow : b < 0.2 ? mix(uShallow, uMid, 0.5) : b < 0.48 ? uMid : b < 0.76 ? mix(uMid, uDeep, 0.55) : uDeep;
  col *= rel > 0.05 ? 1.15 : rel > -0.045 ? 1.0 : 0.82;
  vec3 V = normalize(cameraPosition - vW);
  vec3 R = reflect(-V, N);
  float fr = pow(1.0 - clamp(dot(V, N), 0.0, 1.0), 4.0);
  float frB = fr > 0.42 ? 0.6 : fr > 0.13 ? 0.34 : 0.12;
  vec3 sky = mix(uHorizon, uSky, smoothstep(0.02, 0.45, R.y));
  col = mix(col, sky, frB);
  float spk = pow(max(dot(R, uSunDirW), 0.0), 70.0);
  float tw = h21(floor(vW.xz * 8.0) + floor(uTime * 7.0) * 13.1);
  vec3 glint = uSunCol * 0.2 * step(0.3, spk) * step(0.7, tw);
  // flow-advected foam (two phases, pixel snapped)
  vec2 fl = vFlow.xy;
  float spd = length(fl);
  float ph = uTime * 0.3;
  float f0 = fract(ph), f1 = fract(ph + 0.5);
  float w0 = 1.0 - abs(2.0 * f0 - 1.0);
  vec2 q0 = px - fl * f0 * 3.33, q1 = px - fl * f1 * 3.33;
  float n0 = vn(q0 * 0.32) * 0.62 + vn(q0 * 1.05 + 3.1) * 0.38;
  float n1 = vn(q1 * 0.32 + 17.0) * 0.62 + vn(q1 * 1.05 + 9.7) * 0.38;
  float n = mix(n1, n0, w0);
  float thr = 0.76 - clamp(spd * 0.035, 0.0, 0.12) - max(vCrest, 0.0) * 0.08 + smoothstep(1.2, 0.0, spd) * 0.06;
  float foam = 0.0, ink = 0.0;
  if (n > thr) foam = 1.0; else if (n > thr - 0.028) ink = 1.0;
  // shore wash: a foam line breathing on the bank, an ink rim on its water side
  float wash = 0.07 + 0.045 * sin(uTime * 1.25 + (vW.x + vW.z) * 0.13) + (h21(cell + 5.0) - 0.5) * 0.05;
  if (depth < wash) foam = 1.0; else if (depth < wash + 0.055) ink = max(ink, 1.0 - foam);
  float wash2 = wash + 0.2 + 0.05 * sin(uTime * 0.9 + vW.x * 0.21 - vW.z * 0.17);
  if (abs(depth - wash2) < 0.018 && hp > 0.35) foam = 1.0;
  // whitecaps on steep swell fronts
  if (vCrest > 0.8 && h21(floor(vW.xz * 8.0) + floor(uTime * 4.0)) > 0.5) foam = 1.0;
  // wakes: a V of foam behind each rider and hull, churned water straight behind
  float wk = 0.0, churn = 0.0;
  for (int i = 0; i < ${MAX_WAKES}; i++) {
    if (float(i) >= uWakeN) break;
    vec4 w = uWake[i];
    vec2 d = px - w.xy;
    float sp2 = length(w.zw);
    vec2 dir = w.zw / max(sp2, 0.01);
    float a = -dot(d, dir);
    float Lw = 9.0 + sp2 * 1.6;
    if (a < -0.6 || a > Lw) continue;
    float bl = abs(dir.x * d.y - dir.y * d.x);
    float sz = uWakeS[i];
    float arm = max(a, 0.0) * 0.36 + 0.45 * sz;
    float wd = (0.2 + max(a, 0.0) * 0.035) * sz;
    float fade = 1.0 - max(a, 0.0) / Lw;
    wk = max(wk, (1.0 - smoothstep(0.0, wd, abs(bl - arm))) * fade);
    churn = max(churn, (1.0 - smoothstep(0.15 * sz, (0.6 + max(a, 0.0) * 0.05) * sz, bl)) * (1.0 - smoothstep(0.0, Lw * 0.5, a)));
  }
  float wn = h21(cell + floor(uTime * 9.0) * 7.0);
  if (wk > 0.55 || churn * (0.5 + 0.5 * wn) > 0.45) foam = 1.0;
  else if (wk > 0.36 || churn > 0.3) ink = max(ink, 1.0 - foam);
  col = mix(col, col * uInk, ink * 0.75);
  col = mix(col, uFoam * (rel > -0.045 ? 1.0 : 0.86), foam);
  col += glint * (1.0 - foam);
  float alpha = max(mix(0.6, 0.95, smoothstep(0.0, 1.4, depth)), max(foam, ink * 0.9));
  // ------------------------------------------------ the river of fire
  float lv = burnMask(px);
  if (lv > 0.001) {
    vec2 lp = vec2((vRiv.x - uCrustT) / ${PLATE_S.toFixed(1)}, vRiv.y / ${PLATE_U.toFixed(1)});
    lp = floor(lp * vec2(${(PLATE_S * 8).toFixed(1)}, ${(PLATE_U * 8).toFixed(1)})) / vec2(${(PLATE_S * 8).toFixed(1)}, ${(PLATE_U * 8).toFixed(1)});
    vec2 ci = floor(lp), cf = fract(lp);
    float F1 = 9.0, F2 = 9.0;
    vec2 id = ci;
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec2 gg = vec2(float(x), float(y));
        vec2 o = vec2(burnH(ci + gg), burnH(ci + gg + 19.7)) * 0.8 + 0.1;
        float d = length(gg + o - cf);
        if (d < F1) { F2 = F1; F1 = d; id = ci + gg; } else if (d < F2) F2 = d;
      }
    float chance = mix(1.0, 0.4, smoothstep(0.5, 1.7, depth));
    bool crust = burnH(id + 7.3) < chance || vRiv.z < 0.001 && depth < 0.9;
    float edge = F2 - F1;
    float m0 = vn(q0 * 0.45) * 0.6 + vn(q0 * 1.4 + 5.0) * 0.4;
    float m1 = vn(q1 * 0.45 + 11.0) * 0.6 + vn(q1 * 1.4 + 2.0) * 0.4;
    float mf = mix(m1, m0, w0);
    vec3 hot = mf > 0.62 ? vec3(1.0, 0.86, 0.38) : mf > 0.42 ? vec3(1.0, 0.45, 0.07) : vec3(0.82, 0.17, 0.03);
    hot *= 2.4 + 0.5 * sin(uTime * 2.0 + vRiv.x * 0.3);
    vec3 crustC = hp > 0.82 ? vec3(0.16, 0.1, 0.075) : hp < 0.15 ? vec3(0.035, 0.024, 0.02) : vec3(0.075, 0.05, 0.04);
    crustC *= rel > 0.05 ? 1.35 : rel > -0.045 ? 1.0 : 0.75;
    vec3 lc = hot;
    if (crust) lc = edge < 0.06 ? hot * 0.8 : edge < 0.1 ? mix(crustC, vec3(0.9, 0.2, 0.03), 0.55) : crustC;
    if (wk > 0.5 || churn > 0.45) lc = hot * 1.25;
    // the fire front races across the water
    lc += vec3(1.6, 0.5, 0.08) * burnFront(px) * (0.6 + 0.4 * wn);
    col = mix(col, lc, lv);
    alpha = mix(alpha, 1.0, lv);
  }
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

export interface WaterLook {
  deep: number;
  mid: number;
  shallow: number;
  foam: number;
  ink: number;
  sky: number;
  horizon: number;
}
export const NILE_LOOKS: Record<string, WaterLook> = {
  nileDay: { deep: 0x15627c, mid: 0x2b9ea6, shallow: 0x79d6c0, foam: 0xf6fbf4, ink: 0x2a4f66, sky: 0x4a8ed8, horizon: 0xdcecf0 },
  nileDusk: { deep: 0x1a4a68, mid: 0x2f8394, shallow: 0x8bc8aa, foam: 0xfff2e0, ink: 0x2c3e5a, sky: 0x6a72b8, horizon: 0xffc89a },
  nileBurn: { deep: 0x3a1a14, mid: 0x5a2a18, shallow: 0x7a4a2a, foam: 0xffd8a0, ink: 0x2a1008, sky: 0x8a2a20, horizon: 0xff8a40 },
};

export class NileWater implements WaterSurface {
  readonly level: number;
  group = new THREE.Group();
  material: THREE.ShaderMaterial;
  private u: Record<string, THREE.IUniform>;
  waveT = 0;
  crustT = 0;
  private hit: RiverHit = { ch: 0, main: true, s: 0, u: 0, d: 0, e: 0, hw: 0, depth: 0, speed: 0, rough: 0, tx: 1, tz: 0 };
  private tmp: WaterSample = { h: 0, depth: 0, fx: 0, fz: 0, gx: 0, gz: 0, lava: 0, molten: false, amp: 0 };
  private pending: { x: number; z: number; vx: number; vz: number; s: number; d: number }[] = [];
  private splashes: { x: number; z: number; s: number }[] = [];
  // the rider (World passes the camera focus = the hunter)
  private last = new THREE.Vector3(NaN, 0, 0);
  private vel = new THREE.Vector3();
  private heading = 0;
  private wasOn = false;
  private fallV = 0;
  private emitAcc = 0;
  private ambT = 0;

  constructor(public field: Heightfield, public river: RiverNet, look: WaterLook) {
    this.level = river.level;
    const W = new THREE.Vector4();
    this.u = {
      ...atmoFogUniforms(),
      uTime: globalUniforms.uTime,
      uSunDirW: globalUniforms.uSunDirW,
      uSunCol: globalUniforms.uSunCol,
      uBurn: BURN,
      uWaveT: { value: 0 },
      uCrustT: { value: 0 },
      uSw1: { value: new THREE.Vector4(SWELL.l1, SWELL.c1, SWELL.a1, SWELL.l0) },
      uSw2: { value: new THREE.Vector4(SWELL.a0, SWELL.l2, SWELL.c2, SWELL.a2) },
      uSw3: { value: new THREE.Vector4(SWELL.l3, SWELL.c3, SWELL.a3, 0) },
      uDeep: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uShallow: { value: new THREE.Color() },
      uFoam: { value: new THREE.Color() },
      uInk: { value: new THREE.Color() },
      uSky: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uWake: { value: Array.from({ length: MAX_WAKES }, () => W.clone()) },
      uWakeS: { value: new Array(MAX_WAKES).fill(1) },
      uWakeN: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.u,
      transparent: true,
      fog: true,
      depthWrite: true,
      // keep the terrain's alpha 0 underneath: the ink pass treats the river like ground
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.setLook(look);
    this.group.name = 'nileWater';
    this.build();
  }

  setLook(l: WaterLook) {
    const U = this.u;
    (U.uDeep.value as THREE.Color).setHex(l.deep);
    (U.uMid.value as THREE.Color).setHex(l.mid);
    (U.uShallow.value as THREE.Color).setHex(l.shallow);
    (U.uFoam.value as THREE.Color).setHex(l.foam);
    // the ink tint multiplies the water colour (rgb 0..1 of the hex, kept as a factor)
    (U.uInk.value as THREE.Color).setHex(l.ink).multiplyScalar(2.2);
    (U.uSky.value as THREE.Color).setHex(l.sky);
    (U.uHorizon.value as THREE.Color).setHex(l.horizon);
  }
  lerpLook(a: WaterLook, b: WaterLook, k: number) {
    const c = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), k).getHex();
    this.setLook({ deep: c(a.deep, b.deep), mid: c(a.mid, b.mid), shallow: c(a.shallow, b.shallow), foam: c(a.foam, b.foam), ink: c(a.ink, b.ink), sky: c(a.sky, b.sky), horizon: c(a.horizon, b.horizon) });
  }

  // ------------------------------------------------------------------ the river's own numbers at a point
  /** bed height from the unstamped base (bilinear), as the mesh was built */
  private bedAt(x: number, z: number) {
    const f = this.field, n = f.n;
    const gx = Math.max(0, Math.min(n - 1.001, x)), gz = Math.max(0, Math.min(n - 1.001, z));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const B = f.base, H = f.h, o = i + j * n;
    const a = Math.min(B[o], H[o]), b = Math.min(B[o + 1], H[o + 1]), c = Math.min(B[o + n], H[o + n]), d = Math.min(B[o + n + 1], H[o + n + 1]);
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }
  /** swell amplitude, standing share and current at a channel hit, for bed depth `depth` */
  private params(h: RiverHit | null, depth: number, out: { amp: number; stand: number; fx: number; fz: number }) {
    if (!h || h.e > 2.5) {
      out.amp = out.stand = out.fx = out.fz = 0;
      return out;
    }
    const r = Math.min(1, (h.u / Math.max(1, h.hw)) ** 2);
    const inside = h.e < 0 ? 1 : 1 - h.e / 2.5;
    const dk = depth <= 0.35 ? 0 : depth >= 2 ? 1 : ((depth - 0.35) / 1.65) ** 2 * (3 - 2 * ((depth - 0.35) / 1.65));
    const nk = h.hw < 4 ? 0 : h.hw > 9 ? 1 : (h.hw - 4) / 5;
    out.amp = h.e < 0 ? h.rough * dk * nk * (1 - 0.55 * r) : 0;
    out.stand = Math.max(0, Math.min(1, h.rough - 1));
    const sp = h.speed * (1 - 0.65 * r) * inside;
    out.fx = h.tx * sp;
    out.fz = h.tz * sp;
    return out;
  }
  private prm = { amp: 0, stand: 0, fx: 0, fz: 0 };

  sample(x: number, z: number, out: WaterSample): WaterSample {
    const L = this.level;
    const bed = this.bedAt(x, z);
    const depth0 = L - bed;
    const h = depth0 > -1 ? this.river.hit(x, z, this.hit) : null;
    const p = this.params(h, depth0, this.prm);
    const lava = burnAt(x, z);
    const amp = p.amp * (1 - 0.65 * lava);
    let sh = 0, gx = 0, gz = 0;
    if (amp > 0.001 && h) {
      const t = this.waveT;
      sh = swellAt(h.s, h.u, amp, p.stand, t);
      const hs = (swellAt(h.s + 0.5, h.u, amp, p.stand, t) - sh) / 0.5;
      const hu = (swellAt(h.s, h.u + 0.5, amp, p.stand, t) - sh) / 0.5;
      gx = h.tx * hs - h.tz * hu;
      gz = h.tz * hs + h.tx * hu;
    }
    out.h = L + sh;
    out.depth = out.h - bed;
    out.fx = p.fx;
    out.fz = p.fz;
    out.gx = gx;
    out.gz = gz;
    out.lava = lava;
    out.amp = amp;
    out.molten = lava > 0.5 && depth0 > 0.5 && !!h && h.e < 0 && !this.crustAt(h, depth0);
    return out;
  }
  /** cooled crust plate at a channel point (CPU twin of the shader's plates) */
  private crustAt(h: RiverHit, depth: number) {
    const lx = (h.s - this.crustT) / PLATE_S, lz = h.u / PLATE_U;
    const cx = Math.floor(lx), cz = Math.floor(lz), fx = lx - cx, fz = lz - cz;
    let F1 = 9, idx = cx, idz = cz;
    for (let y = -1; y <= 1; y++)
      for (let xx = -1; xx <= 1; xx++) {
        const ox = hash2(cx + xx, cz + y) * 0.8 + 0.1, oz = hash2(cx + xx + 19.7, cz + y + 19.7) * 0.8 + 0.1;
        const d = Math.hypot(xx + ox - fx, y + oz - fz);
        if (d < F1) {
          F1 = d;
          idx = cx + xx;
          idz = cz + y;
        }
      }
    const k = depth <= 0.5 ? 0 : depth >= 1.7 ? 1 : ((depth - 0.5) / 1.2) ** 2 * (3 - 2 * ((depth - 0.5) / 1.2));
    const chance = 1 + (0.4 - 1) * k;
    return hash2(idx + 7.3, idz + 7.3) < chance;
  }

  heightAt(x: number, z: number) {
    return this.sample(x, z, this.tmp).h;
  }
  flowAt(x: number, z: number, out = { x: 0, z: 0 }) {
    const s = this.sample(x, z, this.tmp);
    out.x = s.fx;
    out.z = s.fz;
    return out;
  }
  depthAt(x: number, z: number) {
    return this.sample(x, z, this.tmp).depth;
  }
  isWater(x: number, z: number, minDepth = 0.05) {
    return this.level - this.bedAt(x, z) > minDepth;
  }
  isDeep(x: number, z: number) {
    return this.level - this.bedAt(x, z) > 1.2;
  }
  lavaAt(x: number, z: number) {
    return this.isWater(x, z) ? burnAt(x, z) : 0;
  }
  moltenAt(x: number, z: number) {
    return this.sample(x, z, this.tmp).molten;
  }
  wake(x: number, z: number, vx: number, vz: number, size = 1) {
    if (this.pending.length < 48) this.pending.push({ x, z, vx, vz, s: size, d: 0 });
  }
  splash(x: number, z: number, size = 1) {
    if (this.splashes.length < 24) this.splashes.push({ x, z, s: size });
  }

  // ------------------------------------------------------------------ mesh
  private build() {
    const t0 = performance.now();
    const f = this.field, river = this.river, L = this.level;
    const S = f.size, n = f.n;
    const NT = Math.ceil(S / TILE);
    const G = TILE / CELL;
    const bedAtV = (x: number, z: number) => {
      const i = Math.min(n - 1, Math.max(0, Math.round(x))), j = Math.min(n - 1, Math.max(0, Math.round(z)));
      const o = i + j * n;
      return Math.min(f.base[o], f.h[o]);
    };
    let tris = 0, trisFar = 0;
    const hit = this.hit;
    const prm = { amp: 0, stand: 0, fx: 0, fz: 0 };
    /** one level of a tile: cells of `step` fine cells, wet if any fine cell inside is */
    const level = (ox: number, oz: number, wetC: Uint8Array, bedC: Float32Array, step: number) => {
      const Gs = G / step;
      const vid = new Int32Array((Gs + 1) * (Gs + 1)).fill(-1);
      const pos: number[] = [], riv: number[] = [], flo: number[] = [], idx: number[] = [];
      const vtx = (i: number, j: number) => {
        const k = i + j * (Gs + 1);
        if (vid[k] >= 0) return vid[k];
        const lx = i * step * CELL, lz = j * step * CELL;
        const x = ox + lx, z = oz + lz;
        const bed = bedC[i * step + j * step * (G + 1)];
        const depth = L - bed;
        const h = river.hit(x, z, hit);
        const p = this.params(h, depth, prm);
        vid[k] = pos.length / 3;
        // tile-local positions (the LOD sits at the tile centre)
        pos.push(lx - TILE / 2, 0, lz - TILE / 2);
        riv.push(h ? h.s : 0, h ? h.u : 0, step > 1 ? 0 : p.amp, depth);
        flo.push(p.fx, p.fz, p.stand);
        return vid[k];
      };
      for (let j = 0; j < Gs; j++)
        for (let i = 0; i < Gs; i++) {
          let wet = false;
          for (let b2 = 0; b2 < step && !wet; b2++) for (let a2 = 0; a2 < step && !wet; a2++) if (wetC[i * step + a2 + (j * step + b2) * G]) wet = true;
          if (!wet) continue;
          const a = vtx(i, j), b = vtx(i + 1, j), c = vtx(i, j + 1), d = vtx(i + 1, j + 1);
          idx.push(a, c, b, b, c, d);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aRiv', new THREE.Float32BufferAttribute(riv, 4));
      g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flo, 3));
      g.setIndex(idx);
      g.boundingBox = new THREE.Box3(new THREE.Vector3(-TILE / 2, -1.5, -TILE / 2), new THREE.Vector3(TILE / 2, 1.5, TILE / 2));
      g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
      const m = new THREE.Mesh(g, this.material);
      m.renderOrder = 3;
      return { m, tris: idx.length / 3 };
    };
    for (let tj = 0; tj < NT; tj++)
      for (let ti = 0; ti < NT; ti++) {
        const ox = ti * TILE, oz = tj * TILE;
        const wetC = new Uint8Array(G * G);
        let any = false;
        const bedC = new Float32Array((G + 1) * (G + 1));
        for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) bedC[i + j * (G + 1)] = bedAtV(Math.min(S, ox + i * CELL), Math.min(S, oz + j * CELL));
        for (let j = 0; j < G; j++)
          for (let i = 0; i < G; i++) {
            if (ox + i * CELL >= S || oz + j * CELL >= S) continue;
            const a = bedC[i + j * (G + 1)], b = bedC[i + 1 + j * (G + 1)], c = bedC[i + (j + 1) * (G + 1)], d = bedC[i + 1 + (j + 1) * (G + 1)];
            // only where the water shows (the surface meets the banks at the still level)
            if (Math.min(a, b, c, d) < L + 0.1) {
              wetC[i + j * G] = 1;
              any = true;
            }
          }
        if (!any) continue;
        const near = level(ox, oz, wetC, bedC, 1);
        const far = level(ox, oz, wetC, bedC, 4);
        // a far tile is flat, coarse and cheap (the swells fade out by ~190 m anyway)
        const lod = new THREE.LOD();
        lod.position.set(ox + TILE / 2, L, oz + TILE / 2);
        lod.addLevel(near.m, 0);
        lod.addLevel(far.m, 230);
        this.group.add(lod);
        tris += near.tris;
        trisFar += far.tris;
      }
    console.log(`[nile] water: ${this.group.children.length} tiles, ${tris} tris near / ${trisFar} far in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number, time: number, focus: THREE.Vector3, fx: any) {
    const burnK = BURN.value.w;
    this.waveT += dt * (1 - 0.65 * burnK);
    this.crustT += dt * CRUST_V;
    this.u.uWaveT.value = this.waveT;
    this.u.uCrustT.value = this.crustT;
    const P = fx?.p;
    // the rider: velocity from the focus track
    if (Number.isNaN(this.last.x)) this.last.copy(focus);
    const idt = dt > 1e-4 ? 1 / dt : 0;
    const vx = (focus.x - this.last.x) * idt, vy = (focus.y - this.last.y) * idt, vz = (focus.z - this.last.z) * idt;
    const jump = Math.hypot(focus.x - this.last.x, focus.z - this.last.z) > 6;
    this.last.copy(focus);
    if (!jump && dt > 1e-4) this.vel.set(this.vel.x + (vx - this.vel.x) * Math.min(1, dt * 12), vy, this.vel.z + (vz - this.vel.z) * Math.min(1, dt * 12));
    const s = this.sample(focus.x, focus.z, this.tmp);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const on = s.depth > 0.12 && Math.abs(focus.y - s.h) < 0.45;
    const lavaHere = s.lava > 0.5;
    if (on && sp > 1.5) this.wake(focus.x, focus.z, this.vel.x, this.vel.z, 1);
    if (P && on && !jump) {
      const hd = sp > 0.5 ? Math.atan2(this.vel.x, this.vel.z) : this.heading;
      let turn = hd - this.heading;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      this.heading = hd;
      const carve = Math.min(1, Math.abs(turn) * idt * 0.35);
      if (sp > 2.5) this.riderSpray(P, focus, s, sp, carve, Math.sign(turn), lavaHere, dt);
      // landing in the water
      if (!this.wasOn && this.fallV < -3.5) this.splash(focus.x, focus.z, Math.min(2, -this.fallV / 6));
    }
    this.fallV = on ? 0 : vy;
    this.wasOn = on;
    // wakes: the nearest hulls this frame
    const pend = this.pending;
    for (const w of pend) w.d = (w.x - focus.x) ** 2 + (w.z - focus.z) ** 2;
    pend.sort((a, b) => a.d - b.d);
    const nW = Math.min(MAX_WAKES, pend.length);
    const UW = this.u.uWake.value as THREE.Vector4[], US = this.u.uWakeS.value as number[];
    for (let i = 0; i < nW; i++) {
      UW[i].set(pend[i].x, pend[i].z, pend[i].vx, pend[i].vz);
      US[i] = pend[i].s;
    }
    this.u.uWakeN.value = nW;
    pend.length = 0;
    // splashes
    if (P) for (const sp2 of this.splashes) this.splashFx(P, sp2.x, sp2.z, sp2.s);
    this.splashes.length = 0;
    // ambience near the hunter: rapids mist, embers and smoke off the lava, falling ash
    if (P) this.ambience(P, focus, dt, burnK);
  }

  private riderSpray(P: any, at: THREE.Vector3, s: WaterSample, sp: number, carve: number, side: number, lava: boolean, dt: number) {
    const fxn = this.vel.x / sp, fzn = this.vel.z / sp;
    const rate = Math.min(80, sp * 3 + carve * 50);
    this.emitAcc += rate * dt;
    const nE = Math.floor(this.emitAcc);
    this.emitAcc -= nE;
    if (nE <= 0) return;
    const back = { x: at.x - fxn * 0.7, y: s.h + 0.05, z: at.z - fzn * 0.7 };
    if (lava) {
      P.emit({ pos: back, count: nE, vel: { x: -fxn * sp * 0.2, y: 1.6 + sp * 0.12, z: -fzn * sp * 0.2 }, spread: 1.4, jitter: 0.3, gravity: 4, drag: 0.8, life: [0.3, 0.75], size: [0.07, 0.02], sprite: 'spark', additive: true, color: [0xffe08a, 0xffa040, 0xff6a1a], stretch: 0.03 });
      if (Math.random() < dt * 6) P.emit({ pos: back, count: 1, vel: { x: 0, y: 1.4, z: 0 }, spread: 0.5, life: [0.9, 1.6], size: [0.5, 1.4], sprite: ['puff0', 'puff1'], color: [0x3a2a24, 0x524038], alpha: 0.45, drag: 1.2 });
      return;
    }
    const WHITE = [0xffffff, 0xeefcff, 0xcdf2f6];
    // rooster tail
    P.emit({ pos: back, count: nE, vel: { x: -fxn * sp * 0.24, y: 2.0 + sp * 0.13, z: -fzn * sp * 0.24 }, spread: 1.3, jitter: 0.25, gravity: 12, drag: 0.5, life: [0.35, 0.8], size: [0.075, 0.04], sprite: ['dot3', 'dot4', 'dot3'], color: WHITE });
    // carve spray thrown off the edge
    if (carve > 0.15) {
      const rx = fzn * side, rz = -fxn * side;
      P.emit({ pos: { x: at.x + rx * 0.3, y: s.h + 0.1, z: at.z + rz * 0.3 }, count: Math.ceil(nE * carve * 1.6), vel: { x: rx * (3 + sp * 0.35) - fxn * 1.5, y: 2.6 + carve * 3, z: rz * (3 + sp * 0.35) - fzn * 1.5 }, spread: 1.6, jitter: 0.4, gravity: 12, drag: 0.4, life: [0.4, 0.9], size: [0.09, 0.04], sprite: ['dot3', 'dot4'], color: WHITE });
    }
    // the foam trail lies on the water and drifts off with the current
    if (Math.random() < 0.7) P.emit({ pos: { x: back.x, y: s.h + 0.03, z: back.z }, count: 2, vel: { x: s.fx * 0.8, y: 0, z: s.fz * 0.8 }, spread: 0.4, jitter: 0.45, gravity: 0, drag: 2.2, life: [0.9, 1.7], size: [0.1, 0.05], sprite: 'dot3', color: [0xffffff, 0xf2fbff] });
  }

  private splashFx(P: any, x: number, z: number, k: number) {
    const s = this.sample(x, z, this.tmp);
    if (s.depth < 0.05) return;
    const y = s.h + 0.05;
    if (s.lava > 0.5) {
      P.emit({ pos: { x, y, z }, count: Math.round(18 * k), spread: 4 * k, up: 4 * k, gravity: 9, drag: 0.5, life: [0.4, 1.0], size: [0.09, 0.03], sprite: 'spark', additive: true, color: [0xffe08a, 0xff9a3a, 0xff5a1a], jitter: 0.5 * k });
      P.emit({ pos: { x, y: y + 0.4, z }, count: Math.round(3 * k), spread: 1.2, up: 1.5, life: [1.0, 2.0], size: [0.8 * k, 2.2 * k], sprite: ['puff0', 'puff1'], color: [0x3a2a24, 0x5a4034], alpha: 0.5, drag: 1 });
      return;
    }
    P.emit({ pos: { x, y, z }, count: Math.round(26 * k), spread: 3.4 * k, up: 5 * k, gravity: 12, drag: 0.4, life: [0.45, 1.0], size: [0.09, 0.04], sprite: ['dot3', 'dot4'], color: [0xffffff, 0xe6fbff, 0xbfeef4], jitter: 0.6 * k });
    // a ring of foam pixels spreading on the surface
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      P.emit({ pos: { x: x + Math.cos(a) * 0.4, y: s.h + 0.03, z: z + Math.sin(a) * 0.4 }, count: 1, vel: { x: Math.cos(a) * 2.6 * k + s.fx, y: 0, z: Math.sin(a) * 2.6 * k + s.fz }, drag: 1.6, life: [0.7, 1.2], size: [0.11, 0.05], sprite: 'dot3', color: 0xffffff });
    }
    P.emit({ pos: { x, y: y + 0.3, z }, count: 2, spread: 1, up: 1, life: [0.6, 1.1], size: [0.8 * k, 1.8 * k], sprite: ['puff0', 'puff1'], color: 0xeefaff, alpha: 0.5, drag: 1.5 });
  }

  private ambience(P: any, focus: THREE.Vector3, dt: number, burnK: number) {
    this.ambT -= dt;
    if (this.ambT > 0) return;
    this.ambT = 0.05;
    const s = this.tmp;
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 34;
      const x = focus.x + Math.cos(a) * r, z = focus.z + Math.sin(a) * r;
      this.sample(x, z, s);
      if (s.depth < 0.2) continue;
      if (s.lava > 0.5) {
        if (s.molten || Math.random() < 0.25) {
          // embers spat off the molten lava, the odd fat bubble of fire
          P.emit({ pos: { x, y: s.h + 0.05, z }, count: 2, vel: { x: s.fx * 0.3, y: 2.2, z: s.fz * 0.3 }, spread: 0.9, jitter: 0.6, gravity: -0.6, drag: 0.6, life: [0.8, 1.8], size: [0.07, 0.02], sprite: 'spark', additive: true, color: [0xffe6a0, 0xffa848, 0xff6a20] });
          if (Math.random() < 0.18) P.emit({ pos: { x, y: s.h + 0.1, z }, count: 1, vel: { x: 0, y: 0.8, z: 0 }, life: [0.5, 0.8], size: [0.35, 0.6], sprite: 'glow', additive: true, color: 0xff7a2a, alpha: 0.7 });
        }
        if (Math.random() < 0.12) P.emit({ pos: { x, y: s.h + 0.6, z }, count: 1, vel: { x: 0.4, y: 1.6, z: 0.3 }, spread: 0.4, life: [2.2, 3.6], size: [1.4, 4.2], sprite: ['cloud0', 'cloud1', 'puff1'], color: [0x2e2420, 0x4a3a30], alpha: 0.38, drag: 0.5, rot: 6, rotSpeed: 0.3 });
      } else if (s.amp > 0.9 && Math.random() < 0.5) {
        // rapids mist over the standing waves
        P.emit({ pos: { x, y: s.h + 0.3, z }, count: 1, vel: { x: s.fx * 0.6, y: 0.5, z: s.fz * 0.6 }, spread: 0.4, life: [1.2, 2.2], size: [0.9, 2.4], sprite: ['puff0', 'puff1'], color: 0xf4fbff, alpha: 0.32, drag: 0.8 });
        P.emit({ pos: { x, y: s.h + 0.1, z }, count: 3, vel: { x: s.fx, y: 2.2, z: s.fz }, spread: 1.2, gravity: 11, life: [0.4, 0.7], size: [0.06, 0.03], sprite: 'dot3', color: [0xffffff, 0xdff6fa] });
      }
    }
    // ash drifting down over the burnt land
    if (burnK > 0.05 && burnAt(focus.x, focus.z) > 0.4) {
      const n = 3;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 26;
        P.emit({ pos: { x: focus.x + Math.cos(a) * r, y: focus.y + 7 + Math.random() * 6, z: focus.z + Math.sin(a) * r }, count: 1, vel: { x: 0.6, y: -0.8, z: 0.25 }, spread: 0.4, jitter: 0.5, gravity: 0.25, drag: 0.6, life: [3, 5], size: [0.05, 0.04], sprite: 'dot3', color: [0x5a524c, 0x8a807a, 0x3a3430, 0xc8b8a8] });
      }
      if (Math.random() < 0.3) {
        const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 20;
        P.emit({ pos: { x: focus.x + Math.cos(a) * r, y: focus.y + 2 + Math.random() * 5, z: focus.z + Math.sin(a) * r }, count: 1, vel: { x: 0.3, y: 1.2, z: 0.2 }, spread: 0.6, gravity: -0.4, drag: 0.4, life: [1.4, 2.6], size: [0.06, 0.02], sprite: 'spark', additive: true, color: [0xffc060, 0xff7a2a] });
      }
    }
  }

  dispose() {
    for (const c of this.group.children) for (const l of (c as THREE.LOD).levels) (l.object as THREE.Mesh).geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

/** a still pool (the desert oasis): the same questions, flat answers */
export class FlatWater implements WaterSurface {
  /** the pool's own surface material (the oasis heart reads its height texture) */
  material: THREE.Material | null = null;
  constructor(public level: number, private ground: (x: number, z: number) => number) {}
  heightAt() {
    return this.level;
  }
  flowAt(_x: number, _z: number, out = { x: 0, z: 0 }) {
    out.x = out.z = 0;
    return out;
  }
  depthAt(x: number, z: number) {
    return this.level - this.ground(x, z);
  }
  isWater(x: number, z: number, minDepth = 0.05) {
    return this.depthAt(x, z) > minDepth;
  }
  lavaAt() {
    return 0;
  }
  moltenAt() {
    return false;
  }
  sample(x: number, z: number, out: WaterSample) {
    out.h = this.level;
    out.depth = this.depthAt(x, z);
    out.fx = out.fz = out.gx = out.gz = out.lava = out.amp = 0;
    out.molten = false;
    return out;
  }
  wake() {}
  splash() {}
  update() {}
  dispose() {}
}
