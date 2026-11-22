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
import { globalUniforms } from '../../../engine/render/VoxelMaterial';
import { HG, glyphModel, FLOAT_GLYPHS } from '../../models/props/hourglass';
import { HourglassRig, PT_FRAG, hash1 } from './HourglassRig';
import { MemoryShards, type MemoryEvent } from './MemoryShards';

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
  // fx
  /** the hourglass itself (frame, sand, glass, grains, wisps: loading/HourglassRig) */
  private rig = new HourglassRig();
  private ptU = this.rig.ptU;
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
  /** first boot: the memory shards drifting round the glass (see MemoryShards) */
  private memory: MemoryShards | null = null;

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
    this.hg.add(this.rig.body);
    if (this.rig.wisps) this.scene.add(this.rig.wisps);
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
    this.memory?.setPx(this.ptU.uPx.value);
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
    if (mode === 'finish') {
      this.target = 1;
      this.memory?.end();
    }
    this.mode = mode;
  }

  /** first boot: collecting pieces of memory (on), or the plain glass (off) */
  setMemory(on: boolean) {
    if (on && !this.memory) {
      this.memory = new MemoryShards();
      this.memory.setPx(this.ptU.uPx.value);
      this.scene.add(this.memory.group);
    } else if (!on && this.memory) {
      this.memory.group.removeFromParent();
      this.memory = null;
      this.renderer.toneMappingExposure = 0.95;
    }
  }
  /** the pointer over the cover (CSS px of the view) */
  pointer(x: number, y: number, down: boolean) {
    this.memory?.pointer((x / this.w) * 2 - 1, 1 - (y / this.h) * 2, down);
  }
  /** memory fragments taken since the last call */
  drain(): MemoryEvent[] {
    if (!this.memory?.events.length) return [];
    return this.memory.events.splice(0);
  }

  /** the displayed fraction (sand that has fallen) */
  get value() {
    return this.shown;
  }

  tick(dt: number) {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.time += dt;
    const t = this.time;
    // progress
    if (this.mode === 'pace') {
      this.paceT += dt;
      this.target = Math.max(this.target, this.paceFrom + (0.96 - this.paceFrom) * (1 - Math.exp(-this.paceT / 2.4)));
    }
    const maxRate = this.mode === 'finish' ? 1.6 : 0.5;
    this.shown += Math.min(maxRate * dt, Math.max(0, this.target - this.shown) * (1 - Math.exp(-dt * 4)));
    this.shown = Math.max(0, Math.min(1, this.shown));
    const p = this.shown;

    this.rig.setFill(p, dt);

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
    this.rig.lights(this.cam, this.key.position, this.rim.position);

    if (this.memory) {
      this.memory.update(dt, this.cam, p);
      this.renderer.toneMappingExposure = 0.95 + this.memory.flare * 2.2;
    }
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
