// The lens takes a bullet. A post-process pass slotted into the engine's HDR stack
// (before bloom, so everything hot blooms) that turns the camera's lens into a
// pane of glass with a real bullet hole in it:
// - a ragged hole with a scorched, ember-lit lip and a crushed, frosted ring;
// - radial cracks (long primaries, short secondaries) joined by spider-web chords;
// - every shard refracts the rendered scene a little differently and catches the
//   light at its own angle; crack edges glint;
// - light bleeds through the hole and runs out along the cracks;
// - `push` flies the view into the hole until it swallows the frame, `white`
//   burns everything to a white-hot sun;
// - afterwards the same pass boils the air: heat shimmer rising off the sand,
//   strongest around the sun, plus a hot glare and streak on the sun itself.
// Nothing is painted: the pattern is procedural and every pixel is the real scene.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Engine } from '../../engine/Engine';

const FS = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uHole, uSun;
uniform float uAspect, uTime, uSeed, uOn, uCrack, uPush, uBurn, uLight, uWhite, uShimmer, uGlare, uR;
varying vec2 vUv;
#define PI 3.14159265
float h11(float n){ return fract(sin(n * 127.1 + uSeed * 31.7) * 43758.5453); }
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031 + uSeed * 0.37); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
float wrapA(float a){ return a - 2.0 * PI * floor((a + PI) / (2.0 * PI)); }
float segD(vec2 q, vec2 a, vec2 b){ vec2 pa = q - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }

// a radial crack set: N sectors, one jagged ray per sector. Returns min distance (pattern units); id of the
// nearest ray in .y; the ray's reach is grown by uCrack.
vec2 rays(vec2 q, float r, float a, float N, float seed, float minL, float maxL){
  float sw = 2.0 * PI / N;
  float s0 = floor((a + PI) / sw);
  float best = 1e3, id = 0.0;
  for (int k = -1; k <= 1; k++) {
    float s = mod(s0 + float(k) + N, N);
    float th = -PI + (s + 0.5 + (h11(s + seed) - 0.5) * 0.7) * sw;
    float L = mix(minL, maxL, pow(h11(s + seed + 40.0), 1.6)) * uCrack;
    // a ray that kinks and wanders a little as it runs out
    float wob = 0.012 * sin(r * 41.0 + s * 3.1) + 0.024 * (vn(vec2(r * 17.0, s * 7.0 + seed)) - 0.5) + 0.006 * sin(r * 130.0 + s);
    float d = abs(wrapA(a - th - wob)) * r;
    d += max(0.0, r - L) * 3.0;
    if (d < best) { best = d; id = s; }
  }
  return vec2(best, id);
}

void main(){
  vec2 uv = vUv;
  vec3 col;
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
  // ---------------------------------------------------------------- the shot-through glass
  vec2 off = vec2(0.0);
  float crackInk = 0.0, crackLit = 0.0, frost = 0.0, soot = 0.0, ember = 0.0, inHole = 0.0, shardTint = 1.0, halo = 0.0;
  if (uOn > 0.001) {
    // pattern space: aspect-corrected, flown into on the push
    float Z = 1.0 + 70.0 * pow(uPush, 2.4);
    vec2 q = (uv - uHole) * vec2(uAspect, 1.0) / Z;
    float r = length(q) + 1e-5;
    float a = atan(q.y, q.x);
    float R = uR;
    // the ragged hole
    float Rj = R * (1.0 + 0.22 * (vn(vec2(a * 2.6 + 3.0, 1.3)) - 0.5) * 2.0 + 0.1 * (vn(vec2(a * 9.0, 4.0)) - 0.5));
    inHole = 1.0 - smoothstep(Rj * 0.97, Rj * 1.03, r);
    // radial cracks: long primaries, short secondaries
    vec2 p1 = rays(q, r, a, 15.0, 0.0, 0.16, 0.95);
    vec2 p2 = rays(q, r, a + 0.21, 23.0, 91.0, 0.05, 0.3);
    // pattern units: thick near the hole, hairlines further out; they widen slower than the zoom as we fly in
    float w = (0.0011 + 0.0034 * exp(-(r - R) * 10.0)) / sqrt(Z);
    float l1 = 1.0 - smoothstep(w * 0.45, w, p1.x);
    float l2 = (1.0 - smoothstep(w * 0.35, w * 0.8, p2.x)) * 0.85;
    // spider-web chords between neighbouring primaries
    float sw = 2.0 * PI / 15.0;
    float sA = floor((a + PI) / sw);
    float thA = -PI + (sA + 0.5 + (h11(sA) - 0.5) * 0.7) * sw;
    float sB = wrapA(a - thA) > 0.0 ? sA + 1.0 : sA - 1.0;
    sB = mod(sB + 15.0, 15.0);
    float thB = -PI + (sB + 0.5 + (h11(sB) - 0.5) * 0.7) * sw;
    float lo = min(sA, sB), hi = max(sA, sB);
    if (abs(sA - sB) > 1.5) { lo = hi; }
    float web = 0.0, band = 0.0;
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float rk = R * (1.9 + fk * 1.25 + fk * fk * 0.55);
      float ra = rk * (1.0 + (h11(sA * 7.0 + fk * 3.0 + 200.0) - 0.5) * 0.4);
      float rb = rk * (1.0 + (h11(sB * 7.0 + fk * 3.0 + 200.0) - 0.5) * 0.4);
      float keep = step(0.3, h11(lo * 11.0 + fk * 5.0 + 300.0)) * step(rk, uCrack * 0.55);
      vec2 A = ra * vec2(cos(thA), sin(thA)), B = rb * vec2(cos(thB), sin(thB));
      float d = segD(q, A, B);
      web = max(web, (1.0 - smoothstep(w * 0.35, w * 0.75, d)) * keep * smoothstep(0.35, 0.9, uCrack));
      band += step(0.5 * (ra + rb), r);
    }
    // shards: one per (primary sector, web band): each refracts and catches light on its own
    float sid = lo * 7.0 + band * 31.0;
    float near = exp(-(r - R) * 6.0);
    vec2 tilt = vec2(h11(sid + 500.0), h11(sid + 600.0)) - 0.5;
    off = tilt * (0.004 + 0.012 * near) * uOn * step(Rj, r);
    shardTint = 0.9 + 0.22 * h11(sid + 700.0) + 0.1 * near;
    // the crushed, frosted ring and the soot
    float ring = smoothstep(Rj * 2.3, Rj * 1.05, r) * (1.0 - inHole);
    float micro = smoothstep(0.55, 0.85, fbm(vec2(a * 14.0, r / R * 6.0))) + smoothstep(0.6, 0.95, vn(vec2(a * 40.0, r / R * 12.0)));
    frost = ring * (0.45 + 0.55 * micro);
    soot = smoothstep(Rj * 1.75, Rj * 1.02, r) * (0.65 + 0.35 * fbm(vec2(a * 5.0, r * 40.0))) * (1.0 - inHole);
    ember = smoothstep(Rj * 1.22, Rj * 1.0, r) * (1.0 - inHole) * (0.55 + 0.45 * vn(vec2(a * 9.0 + uTime * 1.5, uTime * 0.7)));
    crackInk = max(max(l1, l2), web) * (1.0 - inHole);
    // the light that comes through the hole runs out along the cracks
    crackLit = crackInk * (0.16 + uLight * 2.0 * exp(-(r - R) * 9.0)) * (1.0 - 0.75 * uPush);
    halo = exp(-max(0.0, r - Rj) / (R * 1.6)) * (1.0 - inHole);
  }
  // ---------------------------------------------------------------- composite
  vec2 su = clamp(uv + sh + off, vec2(0.001), vec2(0.999));
  col = texture2D(tDiffuse, su).rgb;
  if (uOn > 0.001) {
    vec3 clear = col;
    // glass: each shard a touch brighter or darker, the frost scatters (soft, milky, bright)
    vec3 g = col * shardTint;
    vec3 milky = (texture2D(tDiffuse, su + vec2(0.006, 0.004)).rgb + texture2D(tDiffuse, su - vec2(0.005, 0.006)).rgb + col) / 3.0;
    g = mix(g, milky * 1.15 + vec3(0.22, 0.21, 0.2) * (0.3 + uLight), frost * 0.8);
    // crack: a dark hairline with a bright, light-catching fringe
    g = mix(g, g * 0.45, crackInk * 0.7);
    g += vec3(1.0, 0.96, 0.88) * crackLit * 0.9;
    // the scorched lip and its cooling ember
    g = mix(g, vec3(0.025, 0.018, 0.012), soot * 0.82);
    g += vec3(5.0, 1.55, 0.32) * ember * uBurn;
    // light bleeding through: scattering in the glass round the hole
    g += vec3(1.0, 0.88, 0.66) * halo * uLight * 0.45;
    // the hole itself: clean, and blazing with the light behind it
    // (flying in, the light gives way to the frozen scene beyond, until the white takes it)
    float lk = uLight * (1.0 - 0.75 * uPush);
    vec3 hole = clear * (1.0 + lk * 1.2) + vec3(1.0, 0.9, 0.7) * lk * 0.8;
    col = mix(g, hole, inHole);
    col = mix(clear, col, uOn);
  }
  // ---------------------------------------------------------------- the blinding sun
  if (uGlare > 0.001) {
    vec2 d = (uv - uSun) * vec2(uAspect, 1.0);
    float ds = length(d);
    col += vec3(1.0, 0.82, 0.55) * (exp(-ds * 6.0) * 0.18 + exp(-ds * 22.0) * 1.5) * uGlare;
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
        uHole: { value: new THREE.Vector2(0.5, 0.5) },
        uSun: { value: new THREE.Vector2(0.5, 0.7) },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        uSeed: { value: Math.random() * 10 },
        uOn: { value: 0 },
        uCrack: { value: 0 },
        uPush: { value: 0 },
        uBurn: { value: 0 },
        uLight: { value: 0 },
        uWhite: { value: 0 },
        uShimmer: { value: 0 },
        uGlare: { value: 0 },
        uR: { value: 0.024 },
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
  /** glass on screen */
  on = 0;
  /** cracks running out from the hole */
  crack = 0;
  /** flying into the hole */
  push = 0;
  /** the lip's ember heat */
  burn = 0;
  /** light bleeding through (can exceed 1) */
  light = 0;
  /** white-out */
  white = 0;
  /** heat shimmer */
  shimmer = 0;
  /** the sun's glare + streak */
  glare = 0;
  /** blinding bloom (0 = the game's own) */
  blaze = 0;
  /** where the round went through (uv) */
  hole = new THREE.Vector2(0.5, 0.5);
  /** the sun on screen (uv) */
  sun = new THREE.Vector2(0.5, 0.7);
  /** hole radius in screen heights */
  radius = 0.03;

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

  private sunVis = 0;
  private ownFlash = false;
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
    u.uOn.value = this.on;
    u.uCrack.value = this.crack;
    u.uPush.value = this.push;
    u.uBurn.value = this.burn;
    u.uLight.value = this.light;
    u.uWhite.value = this.white;
    u.uShimmer.value = this.shimmer;
    u.uGlare.value = this.glare * this.sunVis;
    u.uR.value = this.radius;
    (u.uHole.value as THREE.Vector2).copy(this.hole);
    (u.uSun.value as THREE.Vector2).copy(this.sun);
    this.pass.enabled = this.on > 0.001 || this.white > 0.001 || this.shimmer > 0.001 || this.glare > 0.001;
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
