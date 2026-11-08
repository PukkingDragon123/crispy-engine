// The lens in the intro: a post-process pass slotted into the engine's HDR stack
// (before bloom, so everything hot blooms) for the shot into the camera and the
// hot desert sun that follows it.
// - `burst`: a radial flash that blooms out of one point on screen (the muzzle
//   when he fires into the lens) until it swallows the frame; run backwards on
//   the sun, the same flash collapses into the sun's disc;
// - `white`: the white-out itself (the grade's overlay, after tone mapping);
// - `shimmer`: heat boiling off the sand, strongest around the sun;
// - `glare`: a white-hot disc, corona and streak on the sun;
// - `blaze`: blinding bloom.
// Nothing is painted: every pixel is the rendered scene, bent and lit.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Engine } from '../../engine/Engine';

const FS = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uSun, uBurstAt;
uniform float uAspect, uTime, uWhite, uShimmer, uGlare, uBurst;
varying vec2 vUv;
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }

void main(){
  vec2 uv = vUv;
  // ---------------------------------------------------------------- heat shimmer (air boiling off the sand)
  vec2 sh = vec2(0.0);
  if (uShimmer > 0.001) {
    float ds = length((uv - uSun) * vec2(uAspect, 1.0));
    float band = mix(1.0, 0.45, smoothstep(0.1, 0.7, uv.y)) + 1.4 * exp(-ds * 5.0);
    vec2 p = vec2(uv.x * uAspect * 30.0, uv.y * 18.0 - uTime * 2.4);
    sh.x = (vn(p) - 0.5) * 0.0055;
    sh.y = (vn(p * 1.63 + vec2(11.0, -uTime * 1.7)) - 0.5) * 0.007;
    sh += (vec2(vn(p * 3.1 + 5.0), vn(p * 2.7 - 3.0)) - 0.5) * 0.0022;
    sh *= uShimmer * band;
  }
  // the flash shoves the image outward from its heart a touch as it blooms
  vec2 bd = (uv - uBurstAt) * vec2(uAspect, 1.0);
  float bl = length(bd);
  if (uBurst > 0.001) sh -= (uv - uBurstAt) * 0.06 * uBurst * exp(-bl * 2.0);
  vec3 col = texture2D(tDiffuse, clamp(uv + sh, vec2(0.001), vec2(0.999))).rgb;
  // ---------------------------------------------------------------- the flash
  if (uBurst > 0.001) {
    float r = mix(0.015, 1.6, uBurst * uBurst);
    float core = exp(-bl / r);
    float rays = 0.75 + 0.25 * vn(vec2(atan(bd.y, bd.x) * 6.0, uTime * 3.0));
    col += vec3(1.0, 0.86, 0.6) * core * (1.5 + 7.0 * uBurst) * rays;
    col += vec3(1.0, 0.95, 0.85) * exp(-bl / (r * 0.25)) * 4.0 * uBurst;
  }
  // ---------------------------------------------------------------- the blinding sun
  if (uGlare > 0.001) {
    vec2 d = (uv - uSun) * vec2(uAspect, 1.0);
    float ds = length(d);
    // a white-hot disc, a tight corona, a little haze round it, a streak
    col += vec3(1.0, 0.95, 0.85) * exp(-ds * 42.0) * 3.6 * uGlare;
    col += vec3(1.0, 0.82, 0.55) * (exp(-ds * 6.0) * 0.12 + exp(-ds * 12.0) * 0.55) * uGlare;
    col += vec3(1.0, 0.86, 0.62) * exp(-abs(d.y) * 90.0) * exp(-abs(d.x) * 2.6) * 0.8 * uGlare;
  }
  // white heat (the white-out itself is the grade's overlay, after tone mapping)
  col += vec3(1.0, 0.9, 0.75) * uWhite * uWhite * 2.0;
  gl_FragColor = vec4(col, 1.0);
}`;

class LensPass extends Pass {
  material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uSun: { value: new THREE.Vector2(0.5, 0.7) },
        uBurstAt: { value: new THREE.Vector2(0.5, 0.5) },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        uWhite: { value: 0 },
        uShimmer: { value: 0 },
        uGlare: { value: 0 },
        uBurst: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: FS,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.uAspect.value = readBuffer.width / Math.max(1, readBuffer.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

const _fw = new THREE.Vector3();

/** the lens rig a cinematic drives (all values 0..1 unless noted) */
export class LensShot {
  private pass = new LensPass();
  private t0 = performance.now();
  private bloom0: { strength: number; radius: number; threshold: number } | null = null;
  private sunVis = 0;
  private ownFlash = false;
  /** white-out */
  white = 0;
  /** heat shimmer */
  shimmer = 0;
  /** the sun's glare + streak */
  glare = 0;
  /** blinding bloom (0 = the game's own) */
  blaze = 0;
  /** the radial flash: 0 a pinpoint, 1 swallowing the frame */
  burst = 0;
  /** where the flash blooms from (uv) */
  burstAt = new THREE.Vector2(0.5, 0.5);
  /** the sun on screen (uv) */
  sun = new THREE.Vector2(0.5, 0.7);

  constructor(private eng: Engine) {
    const c = eng.post.composer;
    const i = c.passes.indexOf(eng.post.bloom);
    c.insertPass(this.pass, i >= 0 ? i : Math.max(1, c.passes.length - 2));
    this.pass.enabled = false;
    const b = eng.post.bloom;
    this.bloom0 = { strength: b.strength, radius: b.radius, threshold: b.threshold };
  }

  /** project a world point (the sun direction when `dir`) to screen uv */
  static toUv(cam: THREE.Camera, p: THREE.Vector3, out: THREE.Vector2, dir = false) {
    const v = dir ? p.clone().multiplyScalar(1000).add(cam.position) : p.clone();
    v.project(cam);
    return out.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
  }

  /** follow the sun on screen (glare and the boiling air around it fade when it is off-frame or behind) */
  track(cam: THREE.PerspectiveCamera, sunDir: THREE.Vector3) {
    const f = cam.getWorldDirection(_fw).dot(sunDir);
    this.sunVis = THREE.MathUtils.smoothstep(f, 0.15, 0.6);
    if (this.sunVis > 0) LensShot.toUv(cam, sunDir, this.sun, true);
    else this.sun.set(-9, -9);
  }

  /** push the state to the GPU (call once a frame) */
  sync() {
    const u = this.pass.material.uniforms;
    u.uTime.value = (performance.now() - this.t0) / 1000;
    u.uWhite.value = this.white;
    u.uShimmer.value = this.shimmer;
    u.uGlare.value = this.glare * this.sunVis;
    u.uBurst.value = this.burst;
    (u.uSun.value as THREE.Vector2).copy(this.sun);
    (u.uBurstAt.value as THREE.Vector2).copy(this.burstAt);
    this.pass.enabled = this.white > 0.001 || this.shimmer > 0.001 || this.glare > 0.001 || this.burst > 0.001;
    // the white-out: the grade's flash overlay (display space, so 1 is truly white); let go of it at 0
    const fl = this.eng.post.u.uFlash.value;
    if (this.white > 0.001) {
      fl.set(1, 0.975, 0.92, Math.min(1, this.white));
      this.ownFlash = true;
    } else if (this.ownFlash) {
      fl.w = 0;
      this.ownFlash = false;
    }
    const b = this.eng.post.bloom, b0 = this.bloom0;
    if (b0) {
      const k = this.blaze;
      b.strength = b0.strength + (0.85 - b0.strength) * k;
      b.radius = b0.radius + (0.75 - b0.radius) * k;
      b.threshold = b0.threshold + (0.95 - b0.threshold) * k;
    }
  }

  dispose() {
    const b = this.eng.post.bloom, b0 = this.bloom0;
    if (b0) {
      b.strength = b0.strength;
      b.radius = b0.radius;
      b.threshold = b0.threshold;
    }
    this.bloom0 = null;
    if (this.ownFlash) this.eng.post.u.uFlash.value.w = 0;
    this.eng.post.composer.removePass(this.pass);
    this.pass.dispose();
  }
}
