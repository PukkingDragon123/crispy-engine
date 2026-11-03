// A little film studio for 2D art: photographs a real 3D diorama (game models,
// posed rigs, sculpted set pieces) with a painted sky dome, a sun that casts
// crisp cel shadows, fog for depth, then finishes it like an anime background
// painting: depth ink lines, bloom on everything that glows, a colour grade
// (split toning, contrast, vignette) and the game's AgX tone curve.
// Used for the tarot ability cards and any other picture the game shows.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

type V3 = [number, number, number];

export interface SkyLook {
  zenith: number;
  mid: number;
  horizon: number;
  ground?: number;
  /** direction toward the sun / moon (need not be normalised) */
  sunDir: V3;
  sunColor: number;
  /** disc angular radius (radians) — 0 hides the disc */
  sunSize?: number;
  /** halo width (radians) */
  sunGlow?: number;
  sunGain?: number;
  clouds?: number;
  cloudLit?: number;
  cloudShade?: number;
  cloudScale?: number;
  stars?: number;
  seed?: number;
  /** overall sky radiance (default 0.72: keeps the painted colours saturated through the tone curve) */
  gain?: number;
}

export interface Shot {
  root: THREE.Object3D;
  cam: { pos: V3; look: V3; fov: number; roll?: number };
  sky: SkyLook;
  key: { dir: V3; color: number; intensity: number; center: V3; radius: number };
  hemi: { sky: number; ground: number; intensity: number };
  rim?: { dir: V3; color: number; intensity: number };
  lamps?: { pos: V3; color: number; intensity: number; distance: number }[];
  fog?: { color: number; near: number; far: number };
  grade?: {
    exposure?: number;
    sat?: number;
    contrast?: number;
    shadowTint?: number;
    highTint?: number;
    vignette?: number;
    bloom?: [number, number, number];
    /** paper grain amount (default 0.05) */
    grain?: number;
  };
  ink?: { color?: number; thr?: number; rel?: number; thick?: number; strength?: number };
  /** image-based light from the painted sky (default 0.45) */
  env?: number;
  /**
   * 'screen' (default): final display colours (AgX + sRGB) for unlit HUD use.
   * 'scene': graded linear light ×0.5, sRGB-encoded, for textures shown inside the
   * world (the main post stack tone-maps them once; multiply by 2 when sampling).
   */
  display?: 'screen' | 'scene';
}

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // on the far plane
}`;

const SKY_FS = /* glsl */ `
uniform vec3 uZen, uMid, uHor, uGround, uSunDir, uSunCol, uCloudLit, uCloudShade;
uniform float uSunSize, uSunGlow, uSunGain, uClouds, uCloudScale, uStars, uSeed, uSkyGain;
varying vec3 vDir;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float e = d.y;
  vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.3, e));
  col = mix(col, uZen, smoothstep(0.25, 0.9, e));
  if (e < 0.0) col = mix(uHor, uGround, smoothstep(0.0, -0.3, e));
  vec3 sd = normalize(uSunDir);
  float ang = acos(clamp(dot(d, sd), -1.0, 1.0));
  // anime sky: a big soft bloom of warm light around the sun, then the disc
  col += uSunCol * exp(-ang * ang / max(1e-4, uSunGlow * uSunGlow)) * 0.55 * uSunGain;
  col += uSunCol * exp(-ang / max(1e-4, uSunGlow * 3.0)) * 0.12 * uSunGain;
  if (uSunSize > 0.0) col = mix(col, uSunCol * 5.0 * uSunGain, smoothstep(uSunSize, uSunSize * 0.92, ang));
  if (uClouds > 0.0) {
    vec2 cp = d.xz / (max(e, 0.0) + 0.16) * uCloudScale + uSeed;
    float n = fbm(cp + vec2(0.0, uSeed * 0.3));
    float cov = 0.62 - uClouds * 0.28;
    float c = smoothstep(cov, cov + 0.05, n);
    float n2 = fbm(cp - sd.xz * 0.22 + vec2(0.0, uSeed * 0.3));
    float lit = clamp((n - n2) * 7.0 + 0.45, 0.0, 1.0);
    lit = smoothstep(0.3, 0.38, lit) * 0.65 + smoothstep(0.72, 0.8, lit) * 0.35; // cel bands
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    cc += uSunCol * exp(-ang * ang / max(1e-4, uSunGlow * uSunGlow * 4.0)) * 0.5 * uSunGain;
    col = mix(col, cc, c * smoothstep(-0.03, 0.1, e) * (1.0 - smoothstep(0.75, 1.0, e) * 0.5));
  }
  if (uStars > 0.0) {
    vec2 sp = d.xz / (abs(e) + 0.35) * 160.0;
    float st = step(0.996, h21(floor(sp)));
    col += vec3(0.9, 0.95, 1.0) * st * uStars * smoothstep(0.05, 0.4, e);
  }
  gl_FragColor = vec4(col * uSkyGain, 1.0);
}`;

const INK_FS = /* glsl */ `
#include <packing>
uniform sampler2D tDiffuse, tDepth;
uniform float uNear, uFar, uThr, uRel, uThick, uStrength;
uniform vec2 uRes;
uniform vec3 uColor;
varying vec2 vUv;
float ld(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  float d0 = ld(vUv);
  vec2 p = vec2(uThick / uRes.x, uThick / uRes.y);
  float dm = 0.0;
  dm = max(dm, ld(vUv + vec2(-p.x, 0.0)) - d0);
  dm = max(dm, ld(vUv + vec2(p.x, 0.0)) - d0);
  dm = max(dm, ld(vUv + vec2(0.0, p.y)) - d0);
  dm = max(dm, ld(vUv + vec2(0.0, -p.y)) - d0);
  dm = max(dm, (ld(vUv + p) - d0) * 0.8);
  dm = max(dm, (ld(vUv - p) - d0) * 0.8);
  dm = max(dm, (ld(vUv + vec2(p.x, -p.y)) - d0) * 0.8);
  dm = max(dm, (ld(vUv + vec2(-p.x, p.y)) - d0) * 0.8);
  float thr = uThr + d0 * uRel;
  float e = smoothstep(thr, thr * 1.7, dm);
  // glowing things are drawn with light, not ink
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  e *= 1.0 - smoothstep(1.4, 3.0, lum);
  gl_FragColor = vec4(mix(c.rgb, uColor + c.rgb * 0.06, e * uStrength), 1.0);
}`;

const GRADE_FS = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uExposure, uSat, uContrast, uVig, uGrain, uOut;
uniform vec3 uShadowTint, uHighTint;
uniform vec2 uRes;
varying vec2 vUv;
float gh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec3 c = max(texture2D(tDiffuse, vUv).rgb * uExposure, 0.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = pow(c / 0.18 + 1e-5, vec3(uContrast)) * 0.18;
  float t = smoothstep(0.01, 0.5, l);
  c *= mix(uShadowTint, uHighTint, t);
  vec2 q = vUv - 0.5;
  c *= clamp(1.0 - dot(q, q) * uVig * 2.2, 0.0, 1.0);
  // printed-card tooth: a fine fibre grain, strongest in the mid tones
  vec2 gp = floor(vUv * uRes / 2.0);
  float gr = gh(gp) * 0.6 + gh(gp * 0.37 + 11.0) * 0.4 - 0.5;
  c *= 1.0 + gr * uGrain * (1.0 - smoothstep(0.6, 1.6, l));
  gl_FragColor = vec4(c * uOut, 1.0);
}`;

const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const col = (h: number) => new THREE.Color(h);

export class CardStudio {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private key = new THREE.DirectionalLight(0xffffff, 1);
  private rim = new THREE.DirectionalLight(0xffffff, 0);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  private lamps: THREE.PointLight[] = [];
  private inkMat: THREE.ShaderMaterial;
  private gradeMat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private out = new OutputPass();
  private rts: { scene: THREE.WebGLRenderTarget; a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget; o: THREE.WebGLRenderTarget } | null = null;
  private bloom: UnrealBloomPass | null = null;
  private size = [0, 0];
  private envScene = new THREE.Scene();
  private envSky: THREE.Mesh;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uZen: { value: col(0x3a6fb8) },
        uMid: { value: col(0x8fb8e0) },
        uHor: { value: col(0xf2d6a8) },
        uGround: { value: col(0xc9a070) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: col(0xfff0d0) },
        uCloudLit: { value: col(0xffffff) },
        uCloudShade: { value: col(0xb0b8d0) },
        uSunSize: { value: 0.04 },
        uSunGlow: { value: 0.3 },
        uSunGain: { value: 1 },
        uClouds: { value: 0 },
        uCloudScale: { value: 1.2 },
        uStars: { value: 0 },
        uSeed: { value: 0 },
        uSkyGain: { value: 0.72 },
      },
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.skyMat);
    this.envScene.add(this.envSky);
    this.scene.add(this.sky, this.key, this.key.target, this.rim, this.hemi);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.025;
    this.inkMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 400 },
        uThr: { value: 0.08 },
        uRel: { value: 0.035 },
        uThick: { value: 1.6 },
        uStrength: { value: 0.95 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uColor: { value: col(0x1a0c06) },
      },
      vertexShader: QUAD_VS,
      fragmentShader: INK_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.gradeMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: 1 },
        uSat: { value: 1.12 },
        uContrast: { value: 1.06 },
        uVig: { value: 0.5 },
        uShadowTint: { value: new THREE.Vector3(0.92, 0.96, 1.08) },
        uHighTint: { value: new THREE.Vector3(1.05, 1.0, 0.92) },
        uGrain: { value: 0.05 },
        uOut: { value: 1 },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: QUAD_VS,
      fragmentShader: GRADE_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.inkMat);
  }

  private ensure(W: number, H: number) {
    if (this.rts && this.size[0] === W && this.size[1] === H) return this.rts;
    this.disposeTargets();
    const hf = { type: THREE.HalfFloatType, depthBuffer: false } as const;
    const scene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
    scene.depthTexture = new THREE.DepthTexture(W, H);
    scene.depthTexture.type = THREE.UnsignedIntType;
    this.rts = {
      scene,
      a: new THREE.WebGLRenderTarget(W, H, hf),
      b: new THREE.WebGLRenderTarget(W, H, hf),
      o: new THREE.WebGLRenderTarget(W, H, { depthBuffer: false }),
    };
    this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.5, 1.0);
    this.size = [W, H];
    return this.rts;
  }

  /** photograph the diorama; returns a w×h canvas (rendered at ss× then filtered down) */
  shoot(s: Shot, w: number, h: number, ss = 2): HTMLCanvasElement {
    const W = w * ss, H = h * ss;
    const rt = this.ensure(W, H);
    const r = this.renderer;
    // ---- set the stage
    const sky = s.sky, u = this.skyMat.uniforms;
    u.uZen.value.set(sky.zenith);
    u.uMid.value.set(sky.mid);
    u.uHor.value.set(sky.horizon);
    u.uGround.value.set(sky.ground ?? sky.horizon);
    u.uSunDir.value.set(...sky.sunDir).normalize();
    u.uSunCol.value.set(sky.sunColor);
    u.uSunSize.value = sky.sunSize ?? 0.035;
    u.uSunGlow.value = sky.sunGlow ?? 0.32;
    u.uSunGain.value = sky.sunGain ?? 1;
    u.uClouds.value = sky.clouds ?? 0;
    u.uCloudLit.value.set(sky.cloudLit ?? 0xffffff);
    u.uCloudShade.value.set(sky.cloudShade ?? 0xb4bcd4);
    u.uCloudScale.value = sky.cloudScale ?? 1.2;
    u.uStars.value = sky.stars ?? 0;
    u.uSeed.value = sky.seed ?? 0;
    u.uSkyGain.value = sky.gain ?? 0.72;
    const k = s.key;
    this.key.color.set(k.color);
    this.key.intensity = k.intensity;
    const kd = new THREE.Vector3(...k.dir).normalize();
    const c = new THREE.Vector3(...k.center);
    this.key.position.copy(c).addScaledVector(kd, 40);
    this.key.target.position.copy(c);
    const sc = this.key.shadow.camera;
    sc.left = -k.radius;
    sc.right = k.radius;
    sc.top = k.radius;
    sc.bottom = -k.radius;
    sc.near = 1;
    sc.far = 90;
    sc.updateProjectionMatrix();
    this.hemi.color.set(s.hemi.sky);
    this.hemi.groundColor.set(s.hemi.ground);
    this.hemi.intensity = s.hemi.intensity;
    if (s.rim) {
      this.rim.color.set(s.rim.color);
      this.rim.intensity = s.rim.intensity;
      this.rim.position.set(...s.rim.dir).normalize().multiplyScalar(40);
    } else this.rim.intensity = 0;
    for (const l of this.lamps) this.scene.remove(l);
    this.lamps = (s.lamps ?? []).map((l) => {
      const p = new THREE.PointLight(l.color, l.intensity, l.distance, 1.6);
      p.position.set(...l.pos);
      this.scene.add(p);
      return p;
    });
    this.scene.fog = s.fog ? new THREE.Fog(s.fog.color, s.fog.near, s.fog.far) : null;
    // image-based light from this very sky (metal and the shade side read the sky's colour)
    const envK = s.env ?? 0.28;
    if (envK > 0) {
      this.pmrem ??= new THREE.PMREMGenerator(r);
      this.envRT?.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0.035, 0.1, 200);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = envK;
    } else this.scene.environment = null;
    s.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m.material as THREE.Material & { userData: any }).userData?.noShadow) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    this.scene.add(s.root);
    this.cam.fov = s.cam.fov;
    this.cam.aspect = w / h;
    this.cam.near = 0.1;
    this.cam.far = 400;
    this.cam.position.set(...s.cam.pos);
    this.cam.lookAt(...s.cam.look);
    if (s.cam.roll) this.cam.rotateZ(s.cam.roll);
    this.cam.updateProjectionMatrix();
    this.scene.updateMatrixWorld(true);

    // ---- remember the renderer state
    const prevTarget = r.getRenderTarget();
    const prevTone = r.toneMapping, prevExp = r.toneMappingExposure;
    const prevShadow = r.shadowMap.enabled;
    const prevAuto = r.autoClear;
    const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.shadowMap.enabled = true;
    r.shadowMap.needsUpdate = true;
    r.autoClear = true;
    r.toneMapping = THREE.NoToneMapping;
    r.setClearColor(0x000000, 1);
    try {
      // 1. the photograph
      r.setRenderTarget(rt.scene);
      r.clear(true, true, true);
      r.render(this.scene, this.cam);
      // 2. ink
      const iu = this.inkMat.uniforms, ink = s.ink ?? {};
      iu.tDiffuse.value = rt.scene.texture;
      iu.tDepth.value = rt.scene.depthTexture;
      iu.uNear.value = this.cam.near;
      iu.uFar.value = this.cam.far;
      iu.uRes.value.set(W, H);
      iu.uThr.value = ink.thr ?? 0.07;
      iu.uRel.value = ink.rel ?? 0.03;
      iu.uThick.value = (ink.thick ?? 0.8) * ss;
      iu.uStrength.value = ink.strength ?? 0.95;
      iu.uColor.value.set(ink.color ?? 0x1a0c06);
      this.quad.material = this.inkMat;
      r.setRenderTarget(rt.a);
      this.quad.render(r);
      // 3. bloom (in place)
      const g = s.grade ?? {};
      const [bs, br, bt] = g.bloom ?? [0.24, 0.3, 1.5];
      const bloom = this.bloom!;
      bloom.strength = bs;
      bloom.radius = br;
      bloom.threshold = bt;
      bloom.render(r, rt.b, rt.a, 0, false);
      // 4. grade
      const gu = this.gradeMat.uniforms;
      gu.tDiffuse.value = rt.a.texture;
      gu.uExposure.value = g.exposure ?? 0.9;
      gu.uSat.value = g.sat ?? 1.12;
      gu.uContrast.value = g.contrast ?? 1.06;
      gu.uVig.value = g.vignette ?? 0.45;
      gu.uGrain.value = g.grain ?? 0.05;
      gu.uRes.value.set(W, H);
      const scene = s.display === 'scene';
      gu.uOut.value = scene ? 0.5 : 1;
      const st = col(g.shadowTint ?? 0xeaf2ff), ht = col(g.highTint ?? 0xfff4e6);
      gu.uShadowTint.value.set(st.r * 1.04, st.g * 1.04, st.b * 1.04);
      gu.uHighTint.value.set(ht.r * 1.03, ht.g * 1.03, ht.b * 1.03);
      this.quad.material = this.gradeMat;
      r.setRenderTarget(rt.b);
      this.quad.render(r);
      // 5. the game's tone curve + sRGB
      r.toneMapping = scene ? THREE.NoToneMapping : THREE.AgXToneMapping;
      r.toneMappingExposure = 1.0;
      this.out.render(r, rt.o, rt.b, 0, false);
      const buf = new Uint8Array(W * H * 4);
      r.readRenderTargetPixels(rt.o, 0, 0, W, H, buf);
      return this.finish(buf, W, H, w, h, ss);
    } finally {
      r.setRenderTarget(prevTarget);
      r.toneMapping = prevTone;
      r.toneMappingExposure = prevExp;
      r.shadowMap.enabled = prevShadow;
      r.autoClear = prevAuto;
      r.setClearColor(prevClear, prevAlpha);
      this.scene.remove(s.root);
      for (const l of this.lamps) this.scene.remove(l);
      this.lamps = [];
    }
  }

  /** box-filter the supersampled frame down (and flip it upright) */
  private finish(buf: Uint8Array, W: number, H: number, w: number, h: number, ss: number) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d')!;
    const img = c.createImageData(w, h);
    const n = ss * ss;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let rr = 0, gg = 0, bb = 0;
        for (let j = 0; j < ss; j++)
          for (let i = 0; i < ss; i++) {
            const k = ((H - 1 - (y * ss + j)) * W + (x * ss + i)) * 4;
            rr += buf[k];
            gg += buf[k + 1];
            bb += buf[k + 2];
          }
        const o = (y * w + x) * 4;
        img.data[o] = rr / n;
        img.data[o + 1] = gg / n;
        img.data[o + 2] = bb / n;
        img.data[o + 3] = 255;
      }
    c.putImageData(img, 0, 0);
    return cv;
  }

  private disposeTargets() {
    this.envRT?.dispose();
    this.envRT = null;
    this.scene.environment = null;
    if (!this.rts) return;
    this.rts.scene.depthTexture?.dispose();
    for (const t of Object.values(this.rts)) t.dispose();
    this.bloom?.dispose();
    this.rts = null;
  }

  dispose() {
    this.disposeTargets();
    this.skyMat.dispose();
    this.inkMat.dispose();
    this.gradeMat.dispose();
    this.out.dispose();
    this.quad.dispose();
    this.key.shadow.map?.dispose();
    this.pmrem?.dispose();
    this.pmrem = null;
    this.sky.geometry.dispose();
    this.envSky.geometry.dispose();
  }
}
