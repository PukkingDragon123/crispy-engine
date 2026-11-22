// Camera motion blur: every pixel is reprojected through last frame's view-projection
// (scene depth -> world -> previous screen position) and blurred along that screen-space
// velocity over a fixed shutter time, so it does not depend on the frame rate. Carving
// at speed streaks the ground and the world; whip pans smear the horizon. The hero and
// whatever is close to the lens (voxel models write alpha 1, terrain and plants 0) stay
// sharp, and their pixels are kept out of the background's smear. Camera cuts reset it.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export const MOTION = {
  /** shutter (s): blur = screen velocity x shutter */
  shutter: 1 / 26,
  /** extra blur gain at camera speed (m/s) between these */
  fast: [7, 26] as [number, number],
  fastGain: 1.3,
  /** 0..1 master (settings / cinematics can scale it) */
  amount: 1,
};

export class MotionBlurPass extends Pass {
  material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  depthTexture: THREE.Texture | null = null;
  camera: THREE.PerspectiveCamera | null = null;
  private prevVP = new THREE.Matrix4();
  private curVP = new THREE.Matrix4();
  private prevPos = new THREE.Vector3();
  private prevQ = new THREE.Quaternion();
  private lastCam: THREE.Camera | null = null;
  private speed = 0;
  dt = 1 / 60;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uInvVP: { value: new THREE.Matrix4() },
        uPrevVP: { value: new THREE.Matrix4() },
        uScale: { value: 0 },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uKeep: { value: 9 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tDiffuse, tDepth;
        uniform mat4 uInvVP, uPrevVP;
        uniform float uScale, uNear, uFar, uKeep;
        varying vec2 vUv;
        float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        float lin(float z){ return -perspectiveDepthToViewZ(z, uNear, uFar); }
        // 1 = keep sharp: a voxel model (alpha 1) close to the lens
        float keep(float a, float d){ return step(0.5, a) * (1.0 - smoothstep(uKeep, uKeep * 2.2, d)); }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float z = texture2D(tDepth, vUv).x;
          vec4 wp = uInvVP * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
          wp /= wp.w;
          vec4 pp = uPrevVP * wp;
          vec2 prev = pp.xy / pp.w * 0.5 + 0.5;
          vec2 vel = (vUv - prev) * uScale;
          float l = length(vel);
          // a small dead zone keeps slow drifts crisp; long smears are clamped
          float lc = clamp(l - 0.0012, 0.0, 0.07);
          float d0 = lin(z);
          float k0 = keep(c.a, d0);
          if (lc < 0.0006 || k0 > 0.99 || pp.w <= 0.0) { gl_FragColor = vec4(c.rgb, 1.0); return; }
          vel *= lc / max(l, 1e-5) * (1.0 - k0);
          vec3 acc = c.rgb;
          float tw = 1.0;
          float j = ign(gl_FragCoord.xy) - 0.5;
          for (int i = 0; i < 8; i++) {
            float t = (float(i) + 0.5 + j) / 8.0 - 0.5;
            vec2 su = clamp(vUv + vel * t, vec2(0.001), vec2(0.999));
            vec4 s = texture2D(tDiffuse, su);
            float w = 1.0 - keep(s.a, lin(texture2D(tDepth, su).x));
            acc += s.rgb * w;
            tw += w;
          }
          gl_FragColor = vec4(acc / tw, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /** remember this frame's camera; returns false when there is nothing to blur (cut, first frame) */
  private track(): boolean {
    const cam = this.camera;
    if (!cam || !cam.isPerspectiveCamera) return false;
    cam.updateMatrixWorld();
    this.curVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const pos = cam.getWorldPosition(_p);
    const q = cam.getWorldQuaternion(_q);
    const dt = Math.max(1e-3, this.dt);
    const moved = pos.distanceTo(this.prevPos);
    const turned = 2 * Math.acos(Math.min(1, Math.abs(q.dot(this.prevQ))));
    const cut = cam !== this.lastCam || moved > Math.max(4, 60 * dt) || turned > 0.6 || this.dt > 0.2;
    this.speed += ((cut ? 0 : moved / dt) - this.speed) * Math.min(1, dt * 6);
    const u = this.material.uniforms;
    if (!cut) {
      u.uPrevVP.value.copy(this.prevVP);
      (u.uInvVP.value as THREE.Matrix4).copy(this.curVP).invert();
      const f = MOTION.fast;
      const gain = 1 + MOTION.fastGain * THREE.MathUtils.smoothstep(this.speed, f[0], f[1]);
      u.uScale.value = (MOTION.shutter / dt) * gain * MOTION.amount;
      u.uNear.value = cam.near;
      u.uFar.value = cam.far;
    }
    this.prevVP.copy(this.curVP);
    this.prevPos.copy(pos);
    this.prevQ.copy(q);
    this.lastCam = cam;
    return !cut && MOTION.amount > 0.01;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    const on = this.track();
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = this.depthTexture;
    if (!on) u.uScale.value = 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
