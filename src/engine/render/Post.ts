// Post-processing stack: MSAA HDR render -> bloom -> tonemap/sRGB -> cinematic grade.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ATMO } from './VoxelMaterial';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uCA: { value: 0.0 },
    uGrain: { value: 0.022 },
    uSaturation: { value: 1.14 },
    uContrast: { value: 1.08 },
    uDesat: { value: 0.0 },
    uTintShadows: { value: new THREE.Color(0.985, 0.99, 1.01) },
    uTintHighlights: { value: new THREE.Color(1.01, 1.0, 0.98) },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uRadial: { value: 0.0 },
    uRadialCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uDamage: { value: 0.0 },
    uPoison: { value: 0.0 },
    uSpirit: { value: 0.0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    /** 0..1 painterly desert grade (on while an Env-lit world is on screen) */
    uLook: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uCA, uGrain, uSaturation, uContrast, uDesat, uRadial, uDamage, uPoison, uSpirit, uLook;
    uniform vec3 uTintShadows, uTintHighlights;
    uniform vec4 uFlash;
    uniform vec2 uRadialCenter, uResolution;
    varying vec2 vUv;
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec2 uv = vUv;
      vec2 dc = uv - 0.5;
      float r2 = dot(dc, dc);
      // radial speed blur
      vec3 col;
      if (uRadial > 0.001) {
        vec2 dir = (uv - uRadialCenter);
        vec3 acc = vec3(0.0);
        float tw = 0.0;
        for (int i = 0; i < 8; i++) {
          float t = float(i) / 7.0;
          float w = 1.0 - t * 0.6;
          acc += texture2D(tDiffuse, uv - dir * t * uRadial * 0.09).rgb * w;
          tw += w;
        }
        col = acc / tw;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      // chromatic aberration (edges)
      float ca = uCA * (0.4 + r2 * 3.0);
      if (ca > 0.0005) {
        col.r = texture2D(tDiffuse, uv + dc * ca * 0.04).r;
        col.b = texture2D(tDiffuse, uv - dc * ca * 0.04).b;
      }
      // split toning
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= mix(uTintShadows, uTintHighlights, smoothstep(0.1, 0.8, l));
      // contrast around mid grey (display space)
      col = (col - 0.5) * uContrast + 0.5;
      // saturation
      l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation * (1.0 - uDesat));
      // painterly desert grade: lavender-blue shade, warm gold light, soft S-curve, vibrance
      if (uLook > 0.001) {
        vec3 g = col;
        float lg = dot(g, vec3(0.2126, 0.7152, 0.0722));
        g *= mix(vec3(0.93, 0.965, 1.08), vec3(1.045, 1.0, 0.935), smoothstep(0.06, 0.72, lg));
        vec3 sc = clamp(g, 0.0, 1.0);
        g = mix(g, sc * sc * (3.0 - 2.0 * sc), 0.2);
        float mx = max(g.r, max(g.g, g.b)), mn = min(g.r, min(g.g, g.b));
        lg = dot(g, vec3(0.2126, 0.7152, 0.0722));
        g = mix(vec3(lg), g, 1.0 + 0.22 * (1.0 - clamp((mx - mn) * 2.0, 0.0, 1.0)) * (1.0 - uDesat));
        col = mix(col, g, uLook);
      }
      // spirit world: cold teal with gold highlights
      if (uSpirit > 0.001) {
        vec3 sp = mix(vec3(0.05, 0.14, 0.2), vec3(0.45, 0.85, 0.95), l) + vec3(1.0, 0.75, 0.3) * smoothstep(0.75, 1.0, l) * 0.6;
        col = mix(col, sp, uSpirit);
      }
      // poison: green edge pulse
      if (uPoison > 0.001) {
        float e = smoothstep(0.12, 0.5, r2) * uPoison * (0.75 + 0.25 * sin(uTime * 6.0));
        col = mix(col, col * vec3(0.55, 1.15, 0.45) + vec3(0.02, 0.08, 0.0), e);
      }
      // damage: red vignette
      if (uDamage > 0.001) {
        float e = smoothstep(0.08, 0.55, r2) * uDamage;
        col = mix(col, vec3(0.55, 0.02, 0.0), e * 0.7);
      }
      // vignette
      col *= 1.0 - uVignette * smoothstep(0.15, 0.75, r2 * 1.6);
      // flash
      col = mix(col, uFlash.rgb, uFlash.a);
      // grain
      float g = h12(uv * uResolution + fract(uTime * 37.0) * 311.0) - 0.5;
      col += g * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

/**
 * Anime ink outlines from depth discontinuities: silhouettes against the world
 * get a dark line, tiny voxel steps don't (threshold is relative to depth).
 * Lines thin out and fade with distance so far terrain stays clean.
 */
export class OutlinePass extends Pass {
  material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  camera: THREE.PerspectiveCamera | null = null;
  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uColor: { value: new THREE.Color(0x150a05) },
        uStrength: { value: 0.92 },
        uThick: { value: 1.4 },
        /** contact shadow strength (0 = off) */
        uAO: { value: 0 },
        /** pixels per metre at 1 m depth (projection scale) */
        uProjY: { value: 600 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tDiffuse, tDepth;
        uniform float uNear, uFar, uStrength, uThick, uAO, uProjY;
        uniform vec2 uRes;
        uniform vec3 uColor;
        varying vec2 vUv;
        float ld(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
        float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float d0 = ld(vUv);
          // contact shadows: concavities where something stands on / leans against something else.
          // Pairs of opposite samples must both be nearer than the centre (a plane never is), and
          // sand against sand never darkens (dune steps are not contacts).
          if (uAO > 0.001 && d0 < 70.0) {
            float tc = 1.0 - step(0.5, c.a);
            float rpx = clamp(0.55 * uProjY / d0, 3.0, 46.0);
            float rot = ign(gl_FragCoord.xy) * 6.2831853;
            float occ = 0.0;
            for (int i = 0; i < 4; i++) {
              float a = rot + float(i) * 0.7853982;
              vec2 o = vec2(cos(a), sin(a)) * rpx / uRes;
              for (int k = 0; k < 2; k++) {
                vec2 oo = o * (k == 0 ? 0.42 : 1.0);
                vec2 ua = vUv + oo, ub = vUv - oo;
                float da = ld(ua), db = ld(ub);
                float ta = 1.0 - step(0.5, texture2D(tDiffuse, ua).a), tb = 1.0 - step(0.5, texture2D(tDiffuse, ub).a);
                float dz = d0 - 0.5 * (da + db);
                float near = min(d0 - da, d0 - db);
                float w = smoothstep(0.004, 0.03, dz / d0) * step(-0.003 * d0, near) * (1.0 - smoothstep(0.6, 1.8, max(abs(d0 - da), abs(d0 - db))));
                w *= 1.0 - tc * ta * tb;
                occ += w;
              }
            }
            occ = clamp(occ / 8.0 * 1.6, 0.0, 1.0) * (1.0 - smoothstep(35.0, 70.0, d0));
            c.rgb = mix(c.rgb, c.rgb * vec3(0.5, 0.47, 0.6), occ * uAO);
          }
          float px = uThick / uRes.x, py = uThick / uRes.y;
          float dm = 0.0;
          vec2 ol = vUv + vec2(-px, 0.0), or_ = vUv + vec2(px, 0.0), ou = vUv + vec2(0.0, py), od = vUv + vec2(0.0, -py);
          float dl = ld(ol), dr = ld(or_), du = ld(ou), dd = ld(od);
          // terrain writes alpha 0: a jump from sand to sand (a dune step) is not a silhouette
          float t0 = 1.0 - step(0.5, c.a);
          float tl = 1.0 - step(0.5, texture2D(tDiffuse, ol).a), tr = 1.0 - step(0.5, texture2D(tDiffuse, or_).a);
          float tu = 1.0 - step(0.5, texture2D(tDiffuse, ou).a), td = 1.0 - step(0.5, texture2D(tDiffuse, od).a);
          // only the nearer side of a depth jump gets ink (lines hug the foreground)
          dm = max(max((dl - d0) * (1.0 - t0 * tl), (dr - d0) * (1.0 - t0 * tr)), max((du - d0) * (1.0 - t0 * tu), (dd - d0) * (1.0 - t0 * td)));
          // silhouettes jump metres; sand steps at grazing angles only jump a little
          float thr = 0.45 + d0 * 0.1;
          float e = smoothstep(thr, thr * 1.6, dm);
          e *= 1.0 - smoothstep(90.0, 220.0, d0);
          // far sand silhouettes melt into the haze instead of carrying hard ink
          e *= 1.0 - t0 * smoothstep(28.0, 110.0, d0) * 0.92;
          vec3 ink = mix(uColor * c.rgb * 0.25 + uColor, c.rgb * 0.6, smoothstep(25.0, 140.0, d0));
          gl_FragColor = vec4(mix(c.rgb, ink, e * uStrength), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    if (this.camera) {
      u.uNear.value = this.camera.near;
      u.uFar.value = this.camera.far;
    }
    u.uRes.value.set(readBuffer.width, readBuffer.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

/**
 * Sun shafts through dust: a radial march from each pixel toward the sun's screen
 * position, gathering open sky (depth = far) near the sun, so silhouettes of dunes,
 * mesas, clouds and characters cut beams into the haze. Additive and warm.
 */
export class SunShaftPass extends Pass {
  material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  depthTexture: THREE.Texture | null = null;
  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uSun: { value: new THREE.Vector2(0.5, 0.8) },
        uAspect: { value: 1 },
        uAmount: { value: 0 },
        uColor: { value: new THREE.Color(1, 0.8, 0.55) },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tDepth;
        uniform vec2 uSun;
        uniform float uAspect, uAmount;
        uniform vec3 uColor;
        varying vec2 vUv;
        float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          vec2 dir = (uSun - vUv) * 0.86 / 26.0;
          vec2 uv = vUv + dir * ign(gl_FragCoord.xy);
          float acc = 0.0, w = 1.0, tw = 0.0;
          for (int i = 0; i < 26; i++) {
            uv += dir;
            vec2 cu = clamp(uv, vec2(0.001), vec2(0.999));
            float sky = step(0.9999995, texture2D(tDepth, cu).x);
            vec2 q = (cu - uSun) * vec2(uAspect, 1.0);
            acc += sky * exp(-dot(q, q) * 2.6) * w;
            tw += w;
            w *= 0.95;
          }
          acc /= tw;
          vec2 p = (vUv - uSun) * vec2(uAspect, 1.0);
          float glare = exp(-dot(p, p) * 1.8);
          c.rgb += uColor * (acc * 1.4 + glare * 0.08) * uAmount;
          gl_FragColor = c;
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = this.depthTexture;
    u.uAspect.value = readBuffer.width / Math.max(1, readBuffer.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

const _sv = new THREE.Vector3();
const _fw = new THREE.Vector3();
const _db = new THREE.Vector2();

export class PostStack {
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: UnrealBloomPass;
  outline: OutlinePass;
  shafts: SunShaftPass;
  output: OutputPass;
  grade: ShaderPass;
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number) {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(w, h) });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.outline = new OutlinePass();
    this.outline.camera = camera as THREE.PerspectiveCamera;
    this.composer.addPass(this.outline);
    this.shafts = new SunShaftPass();
    this.shafts.depthTexture = rt.depthTexture;
    this.shafts.enabled = false;
    this.composer.addPass(this.shafts);
    // bloom only catches the sun disk and true highlights (no glow haze)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.07, 0.25, 1.8);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  get u() {
    return this.grade.uniforms as typeof GradeShader.uniforms;
  }

  setSceneCamera(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.outline.camera = camera as THREE.PerspectiveCamera;
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.u.uResolution.value.set(w * pixelRatio, h * pixelRatio);
  }

  /** world look (contact AO, sun shafts, desert grade) follows whichever scene the Env drives */
  private updateLook(dt: number) {
    const cam = this.renderPass.camera as THREE.PerspectiveCamera;
    const on = !!ATMO.scene && ATMO.scene === this.renderPass.scene;
    const g = this.u.uLook;
    g.value += ((on ? 1 : 0) - g.value) * Math.min(1, dt * 4);
    if (!on && g.value < 0.01) g.value = 0;
    const ou = this.outline.material.uniforms;
    ou.uAO.value = on ? 0.62 : 0;
    if (cam.isPerspectiveCamera) ou.uProjY.value = cam.projectionMatrix.elements[5] * 0.5 * this.renderer.getDrawingBufferSize(_db).y;
    // sun shafts only when the camera faces the sun
    let amt = 0;
    if (on && cam.isPerspectiveCamera) {
      cam.getWorldDirection(_fw);
      const facing = _fw.dot(ATMO.sunDir);
      if (facing > 0.05 && ATMO.sunDir.y > -0.02) {
        _sv.copy(ATMO.sunDir).multiplyScalar(1000).add(cam.position).project(cam);
        this.shafts.material.uniforms.uSun.value.set(_sv.x * 0.5 + 0.5, _sv.y * 0.5 + 0.5);
        amt = ATMO.shafts * THREE.MathUtils.smoothstep(facing, 0.05, 0.75);
        (this.shafts.material.uniforms.uColor.value as THREE.Color).copy(ATMO.sunColor);
      }
    }
    this.shafts.material.uniforms.uAmount.value = amt;
    this.shafts.enabled = amt > 0.002;
  }

  render(dt: number) {
    this.updateLook(dt);
    this.composer.render(dt);
  }
}
