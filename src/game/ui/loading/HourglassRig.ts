// The sculpted hourglass itself, shared by the loading screen (loading/HourglassView, perspective, in the
// worker) and the run HUD's day timer (ui/SoulGlassHud, the HUD's orthographic CSS-pixel camera):
//  • the gold, lapis and bone frame (models/props/hourglass)
//  • real sand: one voxel column per grid cell, the top and bottom surfaces solved for volume each time the
//    fill changes, a crater over the neck and a heap at the angle of repose below
//  • the hand-blown glass shell (fresnel and window streaks, a back face and a front face)
//  • a stream of pixel grains through the waist that splashes on the heap
//  • SOULS: jade and violet motes that spiral down through the bulbs and slip through the neck with the sand
//  • optional soul WISPS that swim round the outside of the glass (the caller places them: they do not turn
//    with the glass)
// Units: `body` is in voxels (scale it to metres or pixels); the wisps are in metres (HG.vs per voxel).
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { makeVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { HG, glassR, hourglassFrame } from '../../models/props/hourglass';

// ------------------------------------------------------------------ sand: one voxel column per grid cell
const SAND_VERT = /* glsl */ `
attribute vec4 aCol;   // x, z, floor y, ceiling y (voxels)
attribute vec4 aInfo;  // r, hash, bulb (1 top), glint
uniform float uTopH, uBotH, uCrater, uC, uSlopeT, uSlopeB;
varying vec3 vN; varying vec3 vV; varying vec3 vCol; varying float vDeep; varying float vUp; varying float vGlint;
void main(){
  float r = aInfo.x, h = aInfo.y;
  float s = aInfo.z > 0.5 ? uTopH + uSlopeT * uCrater * r * r / (r + 2.0) : uBotH - uSlopeB * r;
  s += (h - 0.5) * uC * 0.8;
  float top = min(floor(s / uC + 0.5) * uC, aCol.w);
  float hgt = top - aCol.z;
  vec3 lp = vec3(aCol.x + position.x * uC, aCol.z + position.y * max(hgt, 0.0), aCol.y + position.z * uC);
  vec4 mv = modelViewMatrix * vec4(lp, 1.0);
  gl_Position = hgt > 0.01 ? projectionMatrix * mv : vec4(0.0, 0.0, -2.0, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vDeep = (1.0 - position.y) * max(hgt, 0.0);
  vUp = normal.y;
  vec3 a = vec3(0.62, 0.34, 0.10), b = vec3(0.50, 0.25, 0.07), c = vec3(0.74, 0.45, 0.15);
  vCol = h < 0.34 ? a : h < 0.67 ? b : c;
  vGlint = aInfo.w;
}`;
const SAND_FRAG = /* glsl */ `
uniform vec3 uKeyDir, uKeyCol, uRimDir, uRimCol, uAmb; uniform float uTime;
varying vec3 vN; varying vec3 vV; varying vec3 vCol; varying float vDeep; varying float vUp; varying float vGlint;
void main(){
  vec3 n = normalize(vN);
  float k = max(dot(n, uKeyDir), 0.0);
  float cel = smoothstep(0.0, 0.09, k) * 0.8 + smoothstep(0.5, 0.62, k) * 0.2;
  float rim = smoothstep(0.0, 0.12, dot(n, uRimDir));
  vec3 col = vCol * mix(0.42, 1.0, exp(-vDeep * 0.09));
  if (vUp > 0.5) col *= 1.15;
  vec3 lit = col * (uAmb + uKeyCol * cel) + col * uRimCol * rim * 0.35;
  if (vUp > 0.5 && vGlint > 0.0) lit += vec3(1.0, 0.85, 0.55) * vGlint * max(0.0, sin(uTime * 3.0 + vGlint * 40.0)) * 1.4;
  gl_FragColor = vec4(lit, 1.0);
}`;

// ------------------------------------------------------------------ glass: thin hand-blown shell, fresnel + streaks
const GLASS_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying float vY;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; vY = position.y; gl_Position = projectionMatrix * mv; }`;
const GLASS_FRAG = /* glsl */ `
uniform float uFront; uniform vec3 uRimCol; uniform float uOrtho;
varying vec3 vN; varying vec3 vV; varying float vY;
void main(){
  vec3 n = normalize(vN); vec3 v = uOrtho > 0.5 ? vec3(0.0, 0.0, 1.0) : normalize(vV);
  if (uFront < 0.5) n = -n;
  float f = 1.0 - abs(dot(n, v));
  float fres = pow(f, 3.0);
  // window streaks that follow the bulbs, a thin cool one on the far side
  float s1 = smoothstep(0.07, 0.0, abs(n.x + 0.55 - n.y * 0.1)) * smoothstep(0.2, 0.6, f + 0.3);
  float s2 = smoothstep(0.04, 0.0, abs(n.x - 0.42)) * 0.45;
  float waist = exp(-vY * vY * 0.05) * 0.35;
  vec3 col = uRimCol * fres * 1.4 + vec3(1.0, 0.92, 0.78) * (s1 * 1.6 + s2) + vec3(0.25, 0.9, 0.65) * waist * fres;
  float a = (0.035 + fres * 0.55 + (s1 + s2) * 0.55 + waist * 0.1) * (uFront > 0.5 ? 1.0 : 0.55);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

// ------------------------------------------------------------------ pixel particles (square points)
export const PT_FRAG = /* glsl */ `
varying vec3 vCol; varying float vA; varying float vHead;
void main(){
  if (vHead > 0.5) { vec2 q = floor(gl_PointCoord * 3.0); if (q.x != 1.0 && q.y != 1.0) discard; }
  if (vA < 0.004) discard;
  gl_FragColor = vec4(vCol * vA, vA);
}`;
const GRAIN_VERT = /* glsl */ `
attribute float aSeed; attribute float aKind;
uniform float uTime, uBotY, uFlow, uPx, uHurry;
varying vec3 vCol; varying float vA; varying float vHead;
void main(){
  float s = aSeed;
  float t = fract(uTime * (1.3 + s * 0.5) * (1.0 + uHurry * 1.6) + s * 7.13);
  vec3 p; float a = uFlow; float sz = 2.0;
  if (aKind < 0.5) {
    float k = t * t * 0.6 + t * 0.4;
    float sp = 0.35 + k * 0.5 + uHurry * 0.5;
    p = vec3((fract(s * 13.7) - 0.5) * sp, mix(0.6, uBotY, k), (fract(s * 29.3) - 0.5) * sp);
    if (p.y < uBotY) a = 0.0;
  } else {
    float ang = s * 43.98;
    float rr = t * (1.2 + fract(s * 5.1) * 2.2);
    p = vec3(cos(ang) * rr, uBotY + 0.4 + sin(t * 3.14159) * (0.6 + fract(s * 3.3) * 1.4), sin(ang) * rr);
    a *= (1.0 - t) * 0.9;
    sz = 1.5;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, floor(sz * uPx + 0.5));
  vCol = fract(s * 91.7) > 0.5 ? vec3(1.0, 0.78, 0.42) : vec3(0.86, 0.58, 0.26);
  vA = a; vHead = 0.0;
}`;
// souls flowing through the glass with the sand: slow in the bulbs, quick through the neck
const SOUL_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime, uPx, uFlow, uHurry;
varying vec3 vCol; varying float vA; varying float vHead;
float prof(float a){
  return a < 19.0 ? 1.15 + 14.2 * pow(sin(clamp(a / 19.0, 0.0, 1.0) * 1.5708), 1.6) : max(6.3, 15.3 - 9.0 * pow((a - 19.0) / 11.0, 2.0));
}
void main(){
  float s = aSeed;
  float t = fract(uTime * (0.07 + fract(s * 3.7) * 0.05) * (1.0 + uHurry * 2.5) + s * 9.31);
  float y = 26.0 * cos(t * 3.14159);
  float r = prof(abs(y)) * (0.2 + 0.55 * fract(s * 7.1));
  float ang = s * 40.0 + uTime * (0.7 + fract(s * 5.3)) * (1.0 + uHurry) + t * 7.0;
  vec3 p = vec3(cos(ang) * r, y, sin(ang) * r);
  float big = step(0.8, fract(s * 13.3));
  vA = (0.25 + 0.75 * uFlow) * smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.92, 1.0, t)) * (0.6 + 0.4 * sin(uTime * 3.0 + s * 30.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, floor((2.0 + big) * uPx + 0.5));
  float c = fract(s * 17.3);
  vCol = c < 0.72 ? vec3(0.35, 1.1, 0.72) : c < 0.9 ? vec3(0.85, 0.6, 1.25) : vec3(1.1, 0.95, 0.6);
  vHead = big;
}`;
const WISP_VERT = /* glsl */ `
attribute vec4 aP0; attribute vec4 aP1; attribute float aT; attribute float aHue;
uniform float uTime, uPx, uOrtho; uniform vec2 uWispK;
varying vec3 vCol; varying float vA; varying float vHead;
void main(){
  float t = uTime - aT * 1.15;
  float ang = aP0.x + t * aP0.y;
  // a soul swims: it spirals up around the glass, weaving in and out
  float rad = (aP0.z + aP0.w * sin(t * aP1.z + aP1.w) + 0.16 * sin(t * 2.3 + aP1.w * 3.0)) * uWispK.x;
  float yy = mod(aP1.x + t * aP1.y + 2.6, 5.2) - 2.6;
  vec3 p = vec3(cos(ang) * rad, (yy + 0.1 + 0.14 * sin(t * 3.1 + aP1.w)) * uWispK.y, sin(ang) * rad);
  float edge = smoothstep(-2.6, -1.5, yy) * (1.0 - smoothstep(1.3, 2.5, yy));
  vA = edge * pow(1.0 - aT, 1.3) * 0.85;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float head = step(aT, 0.001);
  float sz = (mix(3.2, 1.1, aT) + head * 1.2) * (uOrtho > 0.5 ? 0.75 : 7.5 / -mv.z);
  gl_PointSize = max(1.0, floor(sz * uPx + 0.5));
  vec3 hc = mix(vec3(0.32, 1.05, 0.68), vec3(0.8, 0.55, 1.2), aHue);
  vec3 tc = mix(vec3(0.02, 0.32, 0.19), vec3(0.18, 0.04, 0.36), aHue);
  vCol = mix(hc, tc, pow(aT, 0.5));
  vHead = head;
}`;

export const hash1 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

interface Column { x: number; z: number; lo: number; hi: number; r: number }

export interface RigOpts {
  /** drawn by an orthographic camera (the HUD): fresnel and point sizes stop using the view distance */
  ortho?: boolean;
  /** soul wisps round the outside (0: none) */
  wisps?: number;
  /** wisp trail length (points per wisp) */
  trail?: number;
  /** wisp orbit radius and height factors (1, 1 on the loading screen) */
  wispK?: [number, number];
  /** soul motes flowing through the glass (0: none) */
  souls?: number;
}

export class HourglassRig {
  /** frame, sand, glass, grains and souls, in voxels (neck at the origin) */
  readonly body = new THREE.Group();
  /** the soul wisps (metres): add them beside the body so they do not turn with it */
  readonly wisps: THREE.Points | null = null;
  /** shared particle uniforms (the loading view's motes read these too) */
  readonly ptU = { uTime: { value: 0 }, uPx: { value: 1 }, uOrtho: { value: 0 }, uWispK: { value: new THREE.Vector2(1, 1) }, uHurry: { value: 0 }, uFlow: { value: 0 } };
  /** the frame's bounds (voxels) */
  readonly box = new THREE.Box3();
  readonly frameMat: THREE.Material;
  private cols: { top: Column[]; bot: Column[] } = { top: [], bot: [] };
  private sandU!: Record<string, THREE.IUniform>;
  private grainU!: Record<string, THREE.IUniform>;
  private vTotal = 0;
  private lastP = -1;
  private readonly C = 0.75; // sand cell (voxels)
  private readonly slopeT = 0.55;
  private readonly slopeB = 0.62;
  private disposables: { dispose(): void }[] = [];

  constructor(o: RigOpts = {}) {
    this.ptU.uOrtho.value = o.ortho ? 1 : 0;
    if (o.wispK) this.ptU.uWispK.value.set(o.wispK[0], o.wispK[1]);
    const geo = buildVoxelGeometry(hourglassFrame(), { voxelSize: 1, pivot: [0, 0, 0], ao: 0.85 });
    geo.computeBoundingBox();
    this.box.copy(geo.boundingBox!);
    const mat = makeVoxelMaterial({ fog: false, roughness: 0.8 });
    mat.envMapIntensity = 1.3;
    this.frameMat = mat;
    this.body.add(new THREE.Mesh(geo, mat));
    this.disposables.push(geo, mat);
    this.buildSand();
    this.buildGlass(!!o.ortho);
    this.buildGrains();
    if ((o.souls ?? 0) > 0) this.buildSouls(o.souls!);
    if ((o.wisps ?? 14) > 0) (this as { wisps: THREE.Points | null }).wisps = this.buildWisps(o.wisps ?? 14, o.trail ?? 110);
  }

  private buildSand() {
    const C = this.C;
    const margin = 0.45;
    const top: Column[] = [], bot: Column[] = [];
    const N = Math.ceil(16 / C);
    for (let i = -N; i < N; i++)
      for (let j = -N; j < N; j++) {
        const x = (i + 0.5) * C, z = (j + 0.5) * C;
        const r = Math.hypot(x, z);
        const re = r + C * 0.6;
        if (re > 15.3) continue;
        for (const sgn of [1, -1]) {
          // the bulb interior at this radius is one span of height
          let lo = Infinity, hi = -Infinity;
          for (let y = 0.3; y <= HG.glassH; y += 0.1) {
            if (glassR(y) - margin > re) {
              const yy = y * sgn;
              lo = Math.min(lo, yy);
              hi = Math.max(hi, yy);
            }
          }
          if (!isFinite(lo)) continue;
          if (sgn < 0) lo = Math.max(lo, -HG.glassH);
          lo = Math.ceil(lo / C) * C;
          hi = Math.floor(hi / C) * C;
          if (hi - lo < C) continue;
          (sgn > 0 ? top : bot).push({ x, z, lo, hi, r });
        }
      }
    this.cols = { top, bot };
    let full = 0;
    for (const c of top) full += c.hi - c.lo;
    this.vTotal = full * 0.6;

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = box.index;
    g.setAttribute('position', box.getAttribute('position'));
    g.setAttribute('normal', box.getAttribute('normal'));
    const all = [...top.map((c) => [c, 1] as const), ...bot.map((c) => [c, 0] as const)];
    const aCol = new Float32Array(all.length * 4), aInfo = new Float32Array(all.length * 4);
    all.forEach(([c, b], k) => {
      aCol.set([c.x, c.z, c.lo, c.hi], k * 4);
      const hh = hash1(c.x * 13.1 + c.z * 7.7 + b * 3);
      aInfo.set([c.r, hh, b, hash1(c.x * 3.3 - c.z * 9.1) > 0.965 ? 0.4 + hash1(c.z) * 0.6 : 0], k * 4);
    });
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 4));
    g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(aInfo, 4));
    g.instanceCount = all.length;
    this.sandU = {
      uTopH: { value: 20 }, uBotH: { value: -30 }, uCrater: { value: 0 }, uC: { value: C }, uSlopeT: { value: this.slopeT }, uSlopeB: { value: this.slopeB },
      uKeyDir: { value: new THREE.Vector3(0, 1, 0) }, uKeyCol: { value: new THREE.Color(1.15, 0.9, 0.62) }, uRimDir: { value: new THREE.Vector3(1, 0, 0) }, uRimCol: { value: new THREE.Color(0.35, 1.3, 0.9) },
      uAmb: { value: new THREE.Color(0.16, 0.12, 0.26) }, uTime: this.ptU.uTime,
    };
    const m = new THREE.ShaderMaterial({ vertexShader: SAND_VERT, fragmentShader: SAND_FRAG, uniforms: this.sandU });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    this.body.add(mesh);
    this.disposables.push(g, m, box);
  }

  private buildGlass(ortho: boolean) {
    const pts: THREE.Vector2[] = [];
    const H = HG.glassH + 0.4;
    for (let i = 0; i <= 72; i++) {
      // denser samples at the waist
      const u = i / 72 * 2 - 1;
      const y = Math.sign(u) * Math.pow(Math.abs(u), 1.35) * H;
      pts.push(new THREE.Vector2(Math.max(glassR(Math.min(Math.abs(y), HG.glassH)), 1.1) + HG.glassT, y));
    }
    const geo = new THREE.LatheGeometry(pts, 56);
    // hand-blown: the bulbs are not quite true
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const th = Math.atan2(z, x);
      const k = 1 + 0.014 * Math.sin(3 * th + y * 0.19) + 0.007 * Math.sin(5 * th - y * 0.11);
      p.setXYZ(i, x * k, y, z * k);
    }
    const mk = (front: boolean) =>
      new THREE.ShaderMaterial({
        vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG, transparent: true, depthWrite: false,
        side: front ? THREE.FrontSide : THREE.BackSide,
        uniforms: { uFront: { value: front ? 1 : 0 }, uRimCol: { value: new THREE.Color(0.45, 1.25, 0.95) }, uOrtho: { value: ortho ? 1 : 0 } },
      });
    const bm = mk(false), fm = mk(true);
    const back = new THREE.Mesh(geo, bm);
    const front = new THREE.Mesh(geo, fm);
    back.renderOrder = 1;
    front.renderOrder = 3;
    this.body.add(back, front);
    this.disposables.push(geo, bm, fm);
  }

  private buildGrains() {
    const N = 150, M = 46;
    const seed = new Float32Array(N + M), kind = new Float32Array(N + M), pos = new Float32Array((N + M) * 3);
    for (let i = 0; i < N + M; i++) {
      seed[i] = hash1(i * 1.618 + 0.3);
      kind[i] = i < N ? 0 : 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    this.grainU = { uTime: this.ptU.uTime, uPx: this.ptU.uPx, uHurry: this.ptU.uHurry, uBotY: { value: -28 }, uFlow: this.ptU.uFlow };
    const m = new THREE.ShaderMaterial({ vertexShader: GRAIN_VERT, fragmentShader: PT_FRAG, uniforms: this.grainU, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 2;
    this.body.add(pts);
    this.disposables.push(g, m);
  }

  private buildSouls(n: number) {
    const seed = new Float32Array(n), pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) seed[i] = hash1(i * 2.718 + 5.1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: SOUL_VERT, fragmentShader: PT_FRAG, uniforms: this.ptU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 2;
    this.body.add(pts);
    this.disposables.push(g, m);
  }

  private buildWisps(W: number, T: number) {
    const n = W * T;
    const p0 = new Float32Array(n * 4), p1 = new Float32Array(n * 4), at = new Float32Array(n), hue = new Float32Array(n), pos = new Float32Array(n * 3);
    for (let w = 0; w < W; w++) {
      const rnd = (k: number) => hash1(w * 17.3 + k * 3.7);
      const dir = rnd(1) > 0.3 ? 1 : -1;
      const P0 = [rnd(2) * Math.PI * 2, dir * (0.38 + rnd(3) * 0.3), 1.0 + rnd(4) * 0.7, 0.1 + rnd(5) * 0.25];
      const P1 = [rnd(6) * 5.2, 0.16 + rnd(7) * 0.16, 0.5 + rnd(8) * 1.1, rnd(9) * 6.28];
      const hu = rnd(10) > 0.78 ? 1 : 0;
      for (let t = 0; t < T; t++) {
        const k = w * T + t;
        p0.set(P0, k * 4);
        p1.set(P1, k * 4);
        at[k] = t / (T - 1);
        hue[k] = hu;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aP0', new THREE.BufferAttribute(p0, 4));
    g.setAttribute('aP1', new THREE.BufferAttribute(p1, 4));
    g.setAttribute('aT', new THREE.BufferAttribute(at, 1));
    g.setAttribute('aHue', new THREE.BufferAttribute(hue, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: WISP_VERT, fragmentShader: PT_FRAG, uniforms: this.ptU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    this.disposables.push(g, m);
    return pts;
  }

  private solve(cols: Column[], vol: number, surf: (c: Column, h: number) => number, lo: number, hi: number) {
    const C = this.C;
    const volAt = (h: number) => {
      let v = 0;
      for (const c of cols) {
        const t = Math.min(Math.floor(surf(c, h) / C + 0.5) * C, c.hi);
        if (t > c.lo) v += t - c.lo;
      }
      return v;
    };
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (volAt(mid) < vol) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** the sand: `p` of it has fallen (0 full top .. 1 all below); `run` lets the stream fall while there is sand to fall */
  setFill(p: number, dt: number, run = true) {
    p = Math.max(0, Math.min(1, p));
    const vt = this.vTotal * (1 - p), vb = this.vTotal * p;
    if (Math.abs(p - this.lastP) > 1e-4) {
      this.lastP = p;
      const crater = Math.min(1, p / 0.06);
      const hT = vt <= 0.01 ? -40 : this.solve(this.cols.top, vt, (c, h) => h + this.slopeT * crater * (c.r * c.r) / (c.r + 2), -20, HG.glassH + 2);
      const hB = vb <= 0.01 ? -60 : this.solve(this.cols.bot, vb, (c, h) => h - this.slopeB * c.r, -HG.glassH - 12, 14);
      this.sandU.uTopH.value = hT;
      this.sandU.uBotH.value = hB;
      this.sandU.uCrater.value = crater;
      this.grainU.uBotY.value = vb <= 0.01 ? -HG.glassH : Math.min(hB, -1);
    }
    const flowing = run && p < 0.999 && vt > 0.01;
    const fl = this.ptU.uFlow.value;
    this.ptU.uFlow.value = fl + ((flowing ? 1 : 0) - fl) * (1 - Math.exp(-dt * 6));
  }

  /** the sand's key and rim light, given as world directions, into the camera's view space */
  lights(cam: THREE.Camera, key: THREE.Vector3, rim: THREE.Vector3) {
    cam.updateMatrixWorld();
    const vm = cam.matrixWorldInverse;
    (this.sandU.uKeyDir.value as THREE.Vector3).copy(key).normalize().transformDirection(vm);
    (this.sandU.uRimDir.value as THREE.Vector3).copy(rim).normalize().transformDirection(vm);
  }

  dispose() {
    this.body.removeFromParent();
    this.wisps?.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
