// The loading screen's 3D scene: the sculpted hourglass turning slowly in a dark void of souls.
// Real sand (voxel columns solved for volume each frame) drains from the upper bulb into the lower one as
// loading progresses; a stream of pixel grains falls through the waist and splashes on the heap. Jade soul
// wisps spiral up around the glass, motes drift, faint carved glyphs wheel in the dark behind.
// Post: anime ink from depth, a soft jade bloom, vignette, AgX.
//
// No DOM: it renders into an OffscreenCanvas inside the loading worker (so it keeps turning while the main
// thread builds a scene), or into a plain canvas on the main thread where workers cannot draw.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { makeVoxelMaterial, globalUniforms } from '../../../engine/render/VoxelMaterial';
import { HG, glassR, hourglassFrame, glyphModel, FLOAT_GLYPHS } from '../../models/props/hourglass';

export type ProgressMode = 'set' | 'pace' | 'finish' | 'reset';

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// ------------------------------------------------------------------ the void behind everything
const BG_FRAG = /* glsl */ `
uniform float uTime; uniform vec2 uAspect;
varying vec2 vUv;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
void main(){
  vec2 p = (vUv - vec2(0.5, 0.53)) * uAspect;
  float r = length(p);
  // the souls' vortex: smoke turns faster near the glass
  vec2 q = rot(uTime * 0.04 + 0.9 / (r + 0.45)) * p;
  float n = fbm(q * 2.4 + vec2(0.0, -uTime * 0.05));
  float n2 = fbm(q * 5.2 + n * 1.6 - vec2(uTime * 0.03, 0.0));
  vec3 base = mix(vec3(0.02, 0.012, 0.06), vec3(0.0015, 0.001, 0.005), smoothstep(0.05, 0.9, r));
  float smoke = smoothstep(0.42, 0.9, n) * (1.0 - smoothstep(0.15, 1.1, r));
  float veins = pow(1.0 - abs(n2 - 0.5) * 2.0, 8.0);
  vec3 col = base;
  col += vec3(0.07, 0.018, 0.13) * smoke * 0.5;
  col += vec3(0.02, 0.24, 0.15) * veins * smoke * 0.3;
  // the soft jade halo the hourglass stands in
  col += vec3(0.008, 0.07, 0.05) * exp(-r * r * 6.0);
  gl_FragColor = vec4(col, 1.0);
}`;

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
uniform float uFront; uniform vec3 uRimCol;
varying vec3 vN; varying vec3 vV; varying float vY;
void main(){
  vec3 n = normalize(vN); vec3 v = normalize(vV);
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
const PT_FRAG = /* glsl */ `
varying vec3 vCol; varying float vA; varying float vHead;
void main(){
  if (vHead > 0.5) { vec2 q = floor(gl_PointCoord * 3.0); if (q.x != 1.0 && q.y != 1.0) discard; }
  if (vA < 0.004) discard;
  gl_FragColor = vec4(vCol * vA, vA);
}`;
const GRAIN_VERT = /* glsl */ `
attribute float aSeed; attribute float aKind;
uniform float uTime, uBotY, uFlow, uPx;
varying vec3 vCol; varying float vA; varying float vHead;
void main(){
  float s = aSeed;
  float t = fract(uTime * (1.3 + s * 0.5) + s * 7.13);
  vec3 p; float a = uFlow; float sz = 2.0;
  if (aKind < 0.5) {
    float k = t * t * 0.6 + t * 0.4;
    float sp = 0.35 + k * 0.5;
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
const WISP_VERT = /* glsl */ `
attribute vec4 aP0; attribute vec4 aP1; attribute float aT; attribute float aHue;
uniform float uTime, uPx;
varying vec3 vCol; varying float vA; varying float vHead;
void main(){
  float t = uTime - aT * 1.15;
  float ang = aP0.x + t * aP0.y;
  // a soul swims: it spirals up around the glass, weaving in and out
  float rad = aP0.z + aP0.w * sin(t * aP1.z + aP1.w) + 0.16 * sin(t * 2.3 + aP1.w * 3.0);
  float yy = mod(aP1.x + t * aP1.y + 2.6, 5.2) - 2.6;
  vec3 p = vec3(cos(ang) * rad, yy + 0.1 + 0.14 * sin(t * 3.1 + aP1.w), sin(ang) * rad);
  float edge = smoothstep(-2.6, -1.5, yy) * (1.0 - smoothstep(1.3, 2.5, yy));
  vA = edge * pow(1.0 - aT, 1.3) * 0.85;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float head = step(aT, 0.001);
  float sz = (mix(3.2, 1.1, aT) + head * 1.2) * (7.5 / -mv.z);
  gl_PointSize = max(1.0, floor(sz * uPx + 0.5));
  vec3 hc = mix(vec3(0.55, 1.35, 0.95), vec3(0.95, 0.7, 1.35), aHue);
  vec3 tc = mix(vec3(0.02, 0.32, 0.19), vec3(0.18, 0.04, 0.36), aHue);
  vCol = mix(hc, tc, pow(aT, 0.5));
  vHead = head;
}`;
const MOTE_VERT = /* glsl */ `
attribute vec3 aBase; attribute float aSeed;
uniform float uTime, uPx;
varying vec3 vCol; varying float vA; varying float vHead;
void main(){
  float s = aSeed;
  float y = mod(aBase.y + uTime * (0.05 + s * 0.12) + 4.0, 8.0) - 4.0;
  vec3 p = vec3(aBase.x + sin(uTime * 0.3 + s * 20.0) * 0.35, y, aBase.z + cos(uTime * 0.23 + s * 11.0) * 0.3);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.5 + 0.5 * sin(uTime * (1.0 + s * 2.5) + s * 50.0);
  vA = tw * smoothstep(-4.0, -3.0, y) * (1.0 - smoothstep(3.0, 4.0, y)) * (0.35 + 0.65 * fract(s * 7.7));
  float sz = (fract(s * 3.1) > 0.85 ? 2.0 : 1.0) * clamp(7.0 / -mv.z, 0.6, 1.6);
  gl_PointSize = max(1.0, floor(sz * uPx + 0.5));
  float c = fract(s * 17.3);
  vCol = c < 0.7 ? vec3(0.3, 1.0, 0.66) : c < 0.88 ? vec3(1.0, 0.8, 0.45) : vec3(0.7, 0.45, 1.0);
  vHead = 0.0;
}`;
const GLYPH_VERT = /* glsl */ `
varying vec3 vCol;
void main(){ vCol = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GLYPH_FRAG = /* glsl */ `
uniform float uA; varying vec3 vCol;
void main(){ gl_FragColor = vec4(vCol * uA * 2.2, uA); }`;

// ------------------------------------------------------------------ post
const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
vec3 b(vec2 o){ vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb; return max(c - vec3(1.0), 0.0); }
void main(){ gl_FragColor = vec4((b(vec2(-1.0, -1.0)) + b(vec2(1.0, -1.0)) + b(vec2(-1.0, 1.0)) + b(vec2(1.0, 1.0))) * 0.25, 1.0); }`;
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
  c += (texture2D(tSrc, vUv + uDir * 1.385).rgb + texture2D(tSrc, vUv - uDir * 1.385).rgb) * 0.316;
  c += (texture2D(tSrc, vUv + uDir * 3.231).rgb + texture2D(tSrc, vUv - uDir * 3.231).rgb) * 0.070;
  gl_FragColor = vec4(c, 1.0);
}`;
const COMP_FRAG = /* glsl */ `
uniform sampler2D tCol; uniform sampler2D tDepth; uniform sampler2D tBloom;
uniform vec2 uTexel; uniform float uNear, uFar, uTime; uniform vec2 uAspect;
varying vec2 vUv;
float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
void main(){
  vec3 c = texture2D(tCol, vUv).rgb;
  float d0 = lin(texture2D(tDepth, vUv).r);
  float e = 0.0;
  e = max(e, lin(texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).r) - d0);
  e = max(e, lin(texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).r) - d0);
  e = max(e, lin(texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).r) - d0);
  e = max(e, lin(texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).r) - d0);
  float ink = smoothstep(0.05, 0.14, e / d0);
  c = mix(c, c * 0.18 + vec3(0.012, 0.006, 0.03), ink * 0.9);
  c += texture2D(tBloom, vUv).rgb * 0.55;
  vec2 q = (vUv - 0.5) * uAspect;
  c *= 1.0 - smoothstep(0.3, 1.0, length(q)) * 0.8;
  // a little grain keeps the dark gradients from banding
  float g = fract(sin(dot(vUv * 1000.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  c += (g - 0.5) * 0.006;
  gl_FragColor = vec4(max(c, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const hash1 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

interface Column { x: number; z: number; lo: number; hi: number; r: number }

export class HourglassView {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.5, 40);
  private hg = new THREE.Group();
  private time = 0;
  private w = 1;
  private h = 1;
  private dpr = 1;
  // progress
  private shown = 0;
  private target = 0;
  private mode: ProgressMode = 'set';
  private paceFrom = 0;
  private paceT = 0;
  // sand
  private cols: { top: Column[]; bot: Column[] } = { top: [], bot: [] };
  private sandU!: Record<string, THREE.IUniform>;
  private grainU!: Record<string, THREE.IUniform>;
  private vTotal = 0;
  private readonly C = 0.75; // sand cell (voxels)
  private readonly slopeT = 0.55;
  private readonly slopeB = 0.62;
  // fx
  private ptU = { uTime: { value: 0 }, uPx: { value: 1 } };
  private bgU = { uTime: { value: 0 }, uAspect: { value: new THREE.Vector2(1, 1) } };
  private glyphs: { m: THREE.Mesh; u: { value: number }; a: number; i: number }[] = [];
  private key = new THREE.DirectionalLight(0xffd7a0, 2.8);
  private rim = new THREE.DirectionalLight(0x58ffc0, 2.2);
  // post
  private rt!: THREE.WebGLRenderTarget;
  private rtA!: THREE.WebGLRenderTarget;
  private rtB!: THREE.WebGLRenderTarget;
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private fsQuad: THREE.Mesh;
  private brightM: THREE.ShaderMaterial;
  private blurM: THREE.ShaderMaterial;
  private compM: THREE.ShaderMaterial;
  private fsScene = new THREE.Scene();

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, w: number, h: number, dpr: number) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: canvas as HTMLCanvasElement, antialias: false, alpha: false, powerPreference: 'low-power', stencil: false }));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.autoClear = true;
    this.scene.add(this.hg);
    this.hg.scale.setScalar(HG.vs);

    this.buildBackground();
    this.buildLights();
    this.buildFrame();
    this.buildSand();
    this.buildGlass();
    this.buildGrains();
    this.buildWisps();
    this.buildMotes();
    this.buildGlyphs();

    // post
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const mk = (frag: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
    this.brightM = mk(BRIGHT_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.blurM = mk(BLUR_FRAG, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.compM = mk(COMP_FRAG, {
      tCol: { value: null }, tDepth: { value: null }, tBloom: { value: null }, uTexel: { value: new THREE.Vector2() },
      uNear: { value: this.cam.near }, uFar: { value: this.cam.far }, uTime: { value: 0 }, uAspect: { value: new THREE.Vector2(1, 1) },
    });
    this.compM.toneMapped = true;
    this.fsQuad = new THREE.Mesh(tri, this.compM);
    this.fsQuad.frustumCulled = false;
    this.fsScene.add(this.fsQuad);
    this.resize(w, h, dpr);
  }

  // ================================================================== build
  private buildBackground() {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const m = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
      fragmentShader: BG_FRAG, uniforms: this.bgU, depthWrite: false, depthTest: false, toneMapped: false,
    });
    const bg = new THREE.Mesh(tri, m);
    bg.frustumCulled = false;
    bg.renderOrder = -100;
    this.scene.add(bg);
  }

  private buildLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x6a58b8, 0x0c0816, 1.1));
    this.key.position.set(-2.6, 3.4, 4.2);
    this.rim.position.set(2.8, 1.2, -4);
    s.add(this.key, this.rim);
    // a small environment for the gold to reflect: violet dome, a jade horizon band, a warm candle window
    const envScene = new THREE.Scene();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(10, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: /* glsl */ `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `varying vec3 vD; void main(){
          vec3 d = normalize(vD);
          vec3 c = mix(vec3(0.02, 0.012, 0.04), vec3(0.09, 0.05, 0.2), smoothstep(-0.2, 0.8, d.y));
          c += vec3(0.08, 0.6, 0.4) * exp(-d.y * d.y * 40.0) * 0.25;
          c += vec3(2.6, 1.7, 0.8) * pow(max(dot(d, normalize(vec3(-0.5, 0.55, 0.65))), 0.0), 12.0);
          c += vec3(0.5, 0.32, 0.12) * smoothstep(-0.1, -0.6, d.y);
          c += vec3(0.3, 1.6, 1.0) * pow(max(dot(d, normalize(vec3(0.6, 0.2, -0.75))), 0.0), 16.0);
          gl_FragColor = vec4(c, 1.0); }`,
      })
    );
    envScene.add(dome);
    const pm = new THREE.PMREMGenerator(this.renderer);
    s.environment = pm.fromScene(envScene, 0, 0.1, 50).texture;
    pm.dispose();
    dome.geometry.dispose();
    (dome.material as THREE.Material).dispose();
  }

  private buildFrame() {
    const geo = buildVoxelGeometry(hourglassFrame(), { voxelSize: 1, pivot: [0, 0, 0], ao: 0.85 });
    const mat = makeVoxelMaterial({ fog: false, roughness: 0.8 });
    mat.envMapIntensity = 1.3;
    const mesh = new THREE.Mesh(geo, mat);
    this.hg.add(mesh);
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
      uKeyDir: { value: new THREE.Vector3() }, uKeyCol: { value: new THREE.Color(1.15, 0.9, 0.62) }, uRimDir: { value: new THREE.Vector3() }, uRimCol: { value: new THREE.Color(0.35, 1.3, 0.9) },
      uAmb: { value: new THREE.Color(0.16, 0.12, 0.26) }, uTime: this.ptU.uTime,
    };
    const m = new THREE.ShaderMaterial({ vertexShader: SAND_VERT, fragmentShader: SAND_FRAG, uniforms: this.sandU });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    this.hg.add(mesh);
  }

  private buildGlass() {
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
        uniforms: { uFront: { value: front ? 1 : 0 }, uRimCol: { value: new THREE.Color(0.45, 1.25, 0.95) } },
      });
    const back = new THREE.Mesh(geo, mk(false));
    const front = new THREE.Mesh(geo, mk(true));
    back.renderOrder = 1;
    front.renderOrder = 3;
    this.hg.add(back, front);
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
    this.grainU = { uTime: this.ptU.uTime, uPx: this.ptU.uPx, uBotY: { value: -28 }, uFlow: { value: 0 } };
    const m = new THREE.ShaderMaterial({ vertexShader: GRAIN_VERT, fragmentShader: PT_FRAG, uniforms: this.grainU, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 2;
    this.hg.add(pts);
  }

  private buildWisps() {
    const W = 14, T = 110;
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
    this.scene.add(pts);
  }

  private buildMotes() {
    const N = 320;
    const base = new Float32Array(N * 3), seed = new Float32Array(N), pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      base.set([(hash1(i * 2.1) - 0.5) * 11, (hash1(i * 3.3) - 0.5) * 8, -5.5 + hash1(i * 5.7) * 8], i * 3);
      seed[i] = hash1(i * 7.9 + 1.1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: PT_FRAG, uniforms: this.ptU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 5;
    this.scene.add(pts);
  }

  private buildGlyphs() {
    FLOAT_GLYPHS.forEach((def, i) => {
      const geo = buildVoxelGeometry(glyphModel(def), { voxelSize: 0.05, pivot: 'center', ao: 0.4 });
      const u = { value: 0.2 };
      const m = new THREE.ShaderMaterial({ vertexShader: GLYPH_VERT, fragmentShader: GLYPH_FRAG, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uA: u } });
      const mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = -50;
      this.scene.add(mesh);
      this.glyphs.push({ m: mesh, u, a: (i / FLOAT_GLYPHS.length) * Math.PI * 2, i });
    });
  }

  // ================================================================== runtime
  resize(w: number, h: number, dpr: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.dpr = dpr;
    const r = this.renderer;
    r.setPixelRatio(dpr);
    r.setSize(this.w, this.h, false);
    const W = Math.max(1, Math.round(this.w * dpr)), H = Math.max(1, Math.round(this.h * dpr));
    this.rt?.dispose();
    this.rtA?.dispose();
    this.rtB?.dispose();
    this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(W, H), depthBuffer: true });
    const bw = Math.max(1, W >> 2), bh = Math.max(1, H >> 2);
    this.rtA = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false });
    const aspect = this.w / this.h;
    this.cam.aspect = aspect;
    // keep the whole hourglass (and its wings) in view on tall phone screens
    const fitH = 3.95, fitW = 2.7;
    const vh = Math.max(fitH, fitW / aspect);
    const fov = 30;
    const dist = vh / 2 / Math.tan((fov * Math.PI) / 360);
    this.cam.fov = fov;
    this.cam.position.set(0, 0.3, dist);
    this.cam.lookAt(0, -0.14, 0);
    this.cam.updateProjectionMatrix();
    this.bgU.uAspect.value.set(aspect, 1);
    (this.compM.uniforms.uAspect.value as THREE.Vector2).set(aspect, 1);
    (this.compM.uniforms.uTexel.value as THREE.Vector2).set(Math.max(1, Math.round(dpr)) / W, Math.max(1, Math.round(dpr)) / H);
    this.ptU.uPx.value = dpr * Math.max(1, Math.min(2, Math.round(this.h / 540)));
  }

  /** drive the sand: 'set' a known fraction, 'pace' on its own toward the end, 'finish', 'reset' to a full top */
  progress(mode: ProgressMode, v = 0) {
    if (mode === 'reset') {
      this.shown = this.target = 0;
      this.mode = 'set';
      return;
    }
    if (mode === 'set') this.target = Math.max(this.target, Math.min(1, v));
    if (mode === 'pace') {
      this.paceFrom = Math.max(this.shown, this.target);
      this.paceT = 0;
    }
    if (mode === 'finish') this.target = 1;
    this.mode = mode;
  }

  /** the displayed fraction (sand that has fallen) */
  get value() {
    return this.shown;
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

  tick(dt: number) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const t = this.time;
    // progress
    if (this.mode === 'pace') {
      this.paceT += dt;
      this.target = Math.max(this.target, this.paceFrom + (0.96 - this.paceFrom) * (1 - Math.exp(-this.paceT / 2.4)));
    }
    const maxRate = this.mode === 'finish' ? 1.6 : 0.5;
    this.shown += Math.min(maxRate * dt, Math.max(0, this.target - this.shown) * (1 - Math.exp(-dt * 4)));
    const p = this.shown;

    // sand volumes -> surface heights
    const crater = Math.min(1, p / 0.06);
    const vt = this.vTotal * (1 - p), vb = this.vTotal * p;
    const hT = vt <= 0.01 ? -40 : this.solve(this.cols.top, vt, (c, h) => h + this.slopeT * crater * (c.r * c.r) / (c.r + 2), -20, HG.glassH + 2);
    const hB = vb <= 0.01 ? -60 : this.solve(this.cols.bot, vb, (c, h) => h - this.slopeB * c.r, -HG.glassH - 12, 14);
    this.sandU.uTopH.value = hT;
    this.sandU.uBotH.value = hB;
    this.sandU.uCrater.value = crater;
    const apex = vb <= 0.01 ? -HG.glassH : Math.min(hB, -1);
    this.grainU.uBotY.value = apex;
    const flowing = p < 0.999 && vt > 0.01;
    const fl = this.grainU.uFlow.value as number;
    this.grainU.uFlow.value = fl + ((flowing ? 1 : 0) - fl) * (1 - Math.exp(-dt * 6));

    // motion: a slow turn with a breath of sway
    this.hg.rotation.y = t * 0.32;
    this.hg.rotation.z = Math.sin(t * 0.41) * 0.035;
    this.hg.rotation.x = Math.sin(t * 0.29 + 1) * 0.025;
    this.hg.position.y = Math.sin(t * 0.8) * 0.035;
    this.ptU.uTime.value = t;
    this.bgU.uTime.value = t;
    (this.compM.uniforms.uTime as THREE.IUniform).value = t;
    for (const g of this.glyphs) {
      const a = g.a + t * 0.045;
      g.m.position.set(Math.cos(a) * 3.9, 0.25 + Math.sin(a) * 2.2, -3.4 + Math.sin(a * 2 + g.i) * 0.3);
      g.m.rotation.set(Math.sin(t * 0.21 + g.i) * 0.25, Math.sin(t * 0.33 + g.i * 2.1) * 0.5, Math.sin(t * 0.17 + g.i) * 0.12);
      g.u.value = 0.09 + 0.07 * Math.max(0, Math.sin(t * 0.7 + g.i * 1.9));
    }

    // light directions for the sand (view space)
    this.cam.updateMatrixWorld();
    const vm = this.cam.matrixWorldInverse;
    (this.sandU.uKeyDir.value as THREE.Vector3).copy(this.key.position).normalize().transformDirection(vm);
    (this.sandU.uRimDir.value as THREE.Vector3).copy(this.rim.position).normalize().transformDirection(vm);

    this.render();
    return p;
  }

  private render() {
    const r = this.renderer;
    // the voxel material reads shared uniforms: give it a gentler warm rim for this render only
    const rim0 = globalUniforms.uRim.value;
    const look0 = globalUniforms.uLook.value.clone();
    globalUniforms.uRim.value = 0.32;
    globalUniforms.uLook.value.set(0, 0, 0, 0);
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.cam);
    globalUniforms.uRim.value = rim0;
    globalUniforms.uLook.value.copy(look0);
    // bloom
    const W = this.rt.width, H = this.rt.height;
    this.fsQuad.material = this.brightM;
    this.brightM.uniforms.tSrc.value = this.rt.texture;
    (this.brightM.uniforms.uTexel.value as THREE.Vector2).set(1 / W, 1 / H);
    r.setRenderTarget(this.rtA);
    r.render(this.fsScene, this.fsCam);
    this.fsQuad.material = this.blurM;
    const bw = this.rtA.width, bh = this.rtA.height;
    for (const s of [1, 2.2]) {
      this.blurM.uniforms.tSrc.value = this.rtA.texture;
      (this.blurM.uniforms.uDir.value as THREE.Vector2).set(s / bw, 0);
      r.setRenderTarget(this.rtB);
      r.render(this.fsScene, this.fsCam);
      this.blurM.uniforms.tSrc.value = this.rtB.texture;
      (this.blurM.uniforms.uDir.value as THREE.Vector2).set(0, s / bh);
      r.setRenderTarget(this.rtA);
      r.render(this.fsScene, this.fsCam);
    }
    // composite to screen
    this.fsQuad.material = this.compM;
    this.compM.uniforms.tCol.value = this.rt.texture;
    this.compM.uniforms.tDepth.value = this.rt.depthTexture;
    this.compM.uniforms.tBloom.value = this.rtA.texture;
    r.setRenderTarget(null);
    r.render(this.fsScene, this.fsCam);
  }

  dispose() {
    this.rt?.dispose();
    this.rtA?.dispose();
    this.rtB?.dispose();
    this.renderer.dispose();
  }
}
