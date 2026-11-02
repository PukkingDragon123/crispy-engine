// GPU ground marks: a wrapping world-space render target (0.125 m texels) where
// board tracks, scorch craters, blood and venom splats are stamped as
// timestamps. The terrain shader reads it and fades marks by age, so marks
// conform perfectly to the voxel steps with zero z-fighting.
import * as THREE from 'three';

export const MARK_AREA = 256; // meters covered (wraps)
const RES = 2048;

export type MarkChannel = 0 | 1 | 2 | 3; // 0 track, 1 scorch, 2 blood, 3 venom

export class GroundMarks {
  rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(0, MARK_AREA, MARK_AREA, 0, -10, 10);
  private geo: THREE.InstancedBufferGeometry;
  private iA: Float32Array; // x0,z0,x1,z1
  private iB: Float32Array; // width, channel, value, round
  private n = 0;
  private cleared = false;
  clock = 1;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.rt = new THREE.WebGLRenderTarget(RES, RES, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });
    this.rt.texture.wrapS = this.rt.texture.wrapT = THREE.RepeatWrapping;
    this.rt.texture.magFilter = THREE.NearestFilter;
    this.rt.texture.minFilter = THREE.NearestFilter;
    this.rt.texture.generateMipmaps = false;
    const MAX = 512;
    this.geo = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    this.geo.index = q.index;
    this.geo.setAttribute('position', q.getAttribute('position'));
    this.iA = new Float32Array(MAX * 4);
    this.iB = new Float32Array(MAX * 4);
    this.geo.setAttribute('iA', new THREE.InstancedBufferAttribute(this.iA, 4));
    this.geo.setAttribute('iB', new THREE.InstancedBufferAttribute(this.iB, 4));
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec4 iA; attribute vec4 iB;
        varying vec2 vL; varying vec4 vB; varying float vLen;
        uniform float uArea;
        void main(){
          vec2 a = mod(iA.xy, uArea), b = a + (iA.zw - iA.xy);
          vec2 d = b - a; float len = length(d);
          vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
          vec2 n = vec2(-dir.y, dir.x);
          float w = iB.x;
          vec2 p = a + dir * ((position.x + 0.5) * (len + w) - w * 0.5) + n * position.y * w;
          vL = vec2((position.x + 0.5) * (len + w) - w * 0.5, position.y * w);
          vLen = len; vB = iB;
          gl_Position = projectionMatrix * viewMatrix * vec4(p.x, p.y, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vL; varying vec4 vB; varying float vLen;
        void main(){
          // round caps for splats
          if (vB.w > 0.5) { vec2 c = vec2(vL.x - vLen * 0.5, vL.y); if (length(c) > vB.x * 0.5) discard; }
          vec4 o = vec4(0.0);
          int ch = int(vB.y + 0.5);
          if (ch == 0) o.r = vB.z; else if (ch == 1) o.g = vB.z; else if (ch == 2) o.b = vB.z; else o.a = vB.z;
          gl_FragColor = o;
        }`,
      uniforms: { uArea: { value: MARK_AREA } },
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendEquationAlpha: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    // camera looks down at XY plane where y = world z
    this.cam.position.set(0, 0, 5);
    this.cam.lookAt(0, 0, 0);
  }

  /** stamp a segment (x0,z0)->(x1,z1) */
  segment(x0: number, z0: number, x1: number, z1: number, width: number, ch: MarkChannel) {
    if (this.n >= 512) return;
    const i = this.n++;
    this.iA[i * 4] = x0;
    this.iA[i * 4 + 1] = z0;
    this.iA[i * 4 + 2] = x1;
    this.iA[i * 4 + 3] = z1;
    this.iB[i * 4] = width;
    this.iB[i * 4 + 1] = ch;
    this.iB[i * 4 + 2] = this.clock;
    this.iB[i * 4 + 3] = 0;
  }
  splat(x: number, z: number, radius: number, ch: MarkChannel) {
    if (this.n >= 512) return;
    const i = this.n++;
    this.iA[i * 4] = x;
    this.iA[i * 4 + 1] = z;
    this.iA[i * 4 + 2] = x + 0.001;
    this.iA[i * 4 + 3] = z;
    this.iB[i * 4] = radius * 2;
    this.iB[i * 4 + 1] = ch;
    this.iB[i * 4 + 2] = this.clock;
    this.iB[i * 4 + 3] = 1;
  }

  flush(dt: number) {
    this.clock += dt;
    const r = this.renderer;
    if (!this.cleared) {
      const prev = r.getRenderTarget();
      r.setRenderTarget(this.rt);
      r.setClearColor(0x000000, 0);
      r.clear(true, false, false);
      r.setRenderTarget(prev);
      this.cleared = true;
    }
    if (this.n === 0) return;
    this.geo.instanceCount = this.n;
    (this.geo.getAttribute('iA') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('iB') as THREE.InstancedBufferAttribute).needsUpdate = true;
    const prev = r.getRenderTarget();
    const ac = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
    r.autoClear = ac;
    this.n = 0;
  }

  dispose() {
    this.rt.dispose();
  }
}
