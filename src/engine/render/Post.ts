// Post-processing stack: MSAA HDR render -> bloom -> tonemap/sRGB -> cinematic grade.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uCA: { value: 0.0 },
    uGrain: { value: 0.045 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.06 },
    uDesat: { value: 0.0 },
    uTintShadows: { value: new THREE.Color(0.92, 0.95, 1.05) },
    uTintHighlights: { value: new THREE.Color(1.06, 1.0, 0.9) },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uRadial: { value: 0.0 },
    uRadialCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uDamage: { value: 0.0 },
    uPoison: { value: 0.0 },
    uSpirit: { value: 0.0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uCA, uGrain, uSaturation, uContrast, uDesat, uRadial, uDamage, uPoison, uSpirit;
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

export class PostStack {
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: UnrealBloomPass;
  output: OutputPass;
  grade: ShaderPass;
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number) {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.55, 0.92);
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
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.u.uResolution.value.set(w * pixelRatio, h * pixelRatio);
  }

  render(dt: number) {
    this.composer.render(dt);
  }
}
