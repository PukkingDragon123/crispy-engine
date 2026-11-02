// Generic instanced pixel-sprite renderer (bullets, pickups, telegraph icons).
// Same look as the particle "cut" layer: crisp texels + dithered alpha, no sorting.
import * as THREE from 'three';
import { atlas } from './PixelArt';

export class SpriteBatch {
  mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private iPos: Float32Array;
  private iCol: Float32Array;
  private iUV: Float32Array;
  private iSRS: Float32Array;
  private iVel: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[] = [];
  n = 0;

  constructor(public max = 2000, additive = false) {
    this.geo = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    this.geo.index = q.index;
    this.geo.setAttribute('position', q.getAttribute('position'));
    const mk = (n: number, name: string) => {
      const a = new Float32Array(max * n);
      const at = new THREE.InstancedBufferAttribute(a, n);
      at.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, at);
      this.attrs.push(at);
      return a;
    };
    this.iPos = mk(3, 'iPos');
    this.iCol = mk(4, 'iCol');
    this.iUV = mk(4, 'iUV');
    this.iSRS = mk(4, 'iSRS');
    this.iVel = mk(3, 'iVel');
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas().texture }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } },
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iUV; attribute vec4 iSRS; attribute vec3 iVel;
        varying vec2 vUv; varying vec4 vCol; varying float vFog;
        void main(){
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          vec2 c = position.xy;
          vec2 sz = iSRS.xy;
          if (iSRS.w > 0.0) {
            vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
            vec2 dir = vv.xy; float l = length(dir);
            dir = l > 1e-4 ? dir / l : vec2(0.0, 1.0);
            vec2 perp = vec2(-dir.y, dir.x);
            mv.xy += dir * c.y * (sz.y + l * iSRS.w) + perp * c.x * sz.x;
          } else {
            float cs = cos(iSRS.z), sn = sin(iSRS.z);
            mv.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * sz;
          }
          vUv = mix(iUV.xy, iUV.zw, c + 0.5);
          vCol = iCol; vFog = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 fogColor; uniform float fogNear, fogFar;
        varying vec2 vUv; varying vec4 vCol; varying float vFog;
        float bayer(vec2 p){ ivec2 q = ivec2(mod(p, 4.0)); int i = q.x + q.y * 4;
          float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return (m[i] + 0.5) / 16.0; }
        void main(){
          vec4 c = texture2D(map, vUv) * vCol;
          ${additive ? 'if (c.a < 0.01) discard; c.rgb *= c.a;' : 'if (c.a < bayer(gl_FragCoord.xy)) discard; c.a = 1.0;'}
          float f = smoothstep(fogNear, fogFar, vFog);
          c.rgb = mix(c.rgb, ${additive ? 'vec3(0.0)' : 'fogColor'}, f);
          gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
      transparent: additive,
      depthWrite: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 11 : 3;
  }

  begin() {
    this.n = 0;
  }
  push(x: number, y: number, z: number, sprite: string, sx: number, sy: number, rot = 0, color = 0xffffff, alpha = 1, vel?: { x: number; y: number; z: number }, stretch = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const f = atlas().get(sprite);
    this.iPos[i * 3] = x;
    this.iPos[i * 3 + 1] = y;
    this.iPos[i * 3 + 2] = z;
    this.iCol[i * 4] = ((color >> 16) & 255) / 255;
    this.iCol[i * 4 + 1] = ((color >> 8) & 255) / 255;
    this.iCol[i * 4 + 2] = (color & 255) / 255;
    this.iCol[i * 4 + 3] = alpha;
    this.iUV[i * 4] = f.u0;
    this.iUV[i * 4 + 1] = f.v0;
    this.iUV[i * 4 + 2] = f.u1;
    this.iUV[i * 4 + 3] = f.v1;
    const aspect = f.w / f.h;
    this.iSRS[i * 4] = aspect >= 1 ? sx : sx * aspect;
    this.iSRS[i * 4 + 1] = aspect >= 1 ? sy / aspect : sy;
    this.iSRS[i * 4 + 2] = rot;
    this.iSRS[i * 4 + 3] = stretch;
    this.iVel[i * 3] = vel?.x ?? 0;
    this.iVel[i * 3 + 1] = vel?.y ?? 0;
    this.iVel[i * 3 + 2] = vel?.z ?? 0;
  }
  end(fog?: THREE.Fog | null) {
    this.geo.instanceCount = this.n;
    for (const at of this.attrs) {
      at.needsUpdate = true;
      at.clearUpdateRanges();
      at.addUpdateRange(0, this.n * at.itemSize);
    }
    if (fog) {
      const m = this.mesh.material as THREE.ShaderMaterial;
      m.uniforms.fogColor.value.copy(fog.color);
      m.uniforms.fogNear.value = fog.near;
      m.uniforms.fogFar.value = fog.far;
    }
  }
}
