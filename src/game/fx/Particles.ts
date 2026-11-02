// GPU-instanced pixel-art particle system. Two layers:
//  - "cut": crisp pixel sprites, dithered fade (no sorting, writes depth)
//  - "add": additive glow sprites (flashes, magic, sparks)
// Supports velocity-stretched streaks, sprite animation, ground bounce on the
// heightfield and screen-constant sprites (damage digits).
import * as THREE from 'three';
import { atlas, SpriteFrame } from './PixelArt';
import { rnd } from '../../engine/math/rand';

export interface EmitOpts {
  pos: { x: number; y: number; z: number };
  count?: number;
  vel?: { x: number; y: number; z: number };
  /** random velocity magnitude added in random directions */
  spread?: number;
  /** extra random upward velocity */
  up?: number;
  /** random positional jitter radius */
  jitter?: number;
  life?: [number, number];
  size?: [number, number]; // start, end (meters, or pixels*0.01 when screen)
  sizeJitter?: number;
  sprite?: string | string[];
  /** animate through sprite list over life instead of random pick */
  animate?: boolean;
  color?: number | number[];
  alpha?: number;
  additive?: boolean;
  gravity?: number;
  drag?: number;
  ground?: boolean;
  bounce?: number;
  rot?: number; // random initial rotation range
  rotSpeed?: number;
  stretch?: number; // velocity stretch factor
  screen?: boolean; // constant screen size
  offset?: [number, number];
  fadeIn?: number;
  delay?: number;
}

const MAX = 6000;

interface Layer {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  iPos: Float32Array;
  iCol: Float32Array;
  iUV: Float32Array;
  iSRS: Float32Array;
  iVel: Float32Array;
  iOff: Float32Array;
  attrs: THREE.InstancedBufferAttribute[];
}

export class Particles {
  group = new THREE.Group();
  private n = 0;
  // SoA
  private px = new Float32Array(MAX); private py = new Float32Array(MAX); private pz = new Float32Array(MAX);
  private vx = new Float32Array(MAX); private vy = new Float32Array(MAX); private vz = new Float32Array(MAX);
  private life = new Float32Array(MAX); private maxLife = new Float32Array(MAX);
  private s0 = new Float32Array(MAX); private s1 = new Float32Array(MAX);
  private rot = new Float32Array(MAX); private rotV = new Float32Array(MAX);
  private cr = new Float32Array(MAX); private cg = new Float32Array(MAX); private cb = new Float32Array(MAX); private ca = new Float32Array(MAX);
  private grav = new Float32Array(MAX); private drag = new Float32Array(MAX); private bounce = new Float32Array(MAX);
  private stretch = new Float32Array(MAX); private fadeIn = new Float32Array(MAX); private delay = new Float32Array(MAX);
  private ox = new Float32Array(MAX); private oy = new Float32Array(MAX);
  private flags = new Uint8Array(MAX); // 1 additive, 2 ground, 4 screen, 8 animate
  private frames: SpriteFrame[][] = [];
  private frameOf: Int32Array = new Int32Array(MAX); // index into frames table
  private frameKey = new Map<string, number>();
  private cut: Layer;
  private add: Layer;
  /** ground height sampler for bounce (set by world) */
  groundAt: ((x: number, z: number) => number) | null = null;
  quality = 1;

  constructor() {
    const tex = atlas().texture;
    this.cut = this.makeLayer(tex, false);
    this.add = this.makeLayer(tex, true);
    this.group.add(this.cut.mesh, this.add.mesh);
  }

  private makeLayer(tex: THREE.Texture, additive: boolean): Layer {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const mk = (n: number) => {
      const a = new Float32Array(MAX * n);
      const at = new THREE.InstancedBufferAttribute(a, n);
      at.setUsage(THREE.DynamicDrawUsage);
      return { a, at };
    };
    const p = mk(3), c = mk(4), u = mk(4), s = mk(4), v = mk(3), o = mk(2);
    geo.setAttribute('iPos', p.at);
    geo.setAttribute('iCol', c.at);
    geo.setAttribute('iUV', u.at);
    geo.setAttribute('iSRS', s.at);
    geo.setAttribute('iVel', v.at);
    geo.setAttribute('iOff', o.at);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: tex },
        fogColor: { value: new THREE.Color() },
        fogNear: { value: 1 },
        fogFar: { value: 1000 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iUV; attribute vec4 iSRS; attribute vec3 iVel; attribute vec2 iOff;
        varying vec2 vUv; varying vec4 vCol; varying float vFogDepth;
        void main(){
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          vec2 c = position.xy;
          float screenK = iSRS.w > 1.5 ? -mv.z * 0.06 : 1.0;
          vec2 sz = iSRS.xy * screenK;
          float stretch = iSRS.w > 1.5 ? 0.0 : iSRS.w;
          if (stretch > 0.0) {
            vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
            vec2 dir = vv.xy; float l = length(dir);
            dir = l > 1e-4 ? dir / l : vec2(0.0, 1.0);
            vec2 perp = vec2(-dir.y, dir.x);
            float len = sz.y + l * stretch;
            mv.xy += dir * c.y * len + perp * c.x * sz.x;
          } else {
            float cs = cos(iSRS.z), sn = sin(iSRS.z);
            vec2 r = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
            mv.xy += r * sz + iOff * screenK;
          }
          vUv = mix(iUV.xy, iUV.zw, c + 0.5);
          vCol = iCol;
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 fogColor; uniform float fogNear, fogFar;
        varying vec2 vUv; varying vec4 vCol; varying float vFogDepth;
        float bayer(vec2 p){ ivec2 q = ivec2(mod(p, 4.0)); int i = q.x + q.y * 4;
          float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return (m[i] + 0.5) / 16.0; }
        void main(){
          vec4 t = texture2D(map, vUv);
          vec4 c = t * vCol;
          ${
            additive
              ? `if (c.a < 0.01) discard; c.rgb *= c.a; float f = smoothstep(fogNear, fogFar, vFogDepth); c.rgb *= (1.0 - f);`
              : `if (c.a < bayer(gl_FragCoord.xy)) discard; c.a = 1.0; float f = smoothstep(fogNear, fogFar, vFogDepth); c.rgb = mix(c.rgb, fogColor, f);`
          }
          gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
      transparent: additive,
      depthWrite: !additive,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = additive ? 10 : 2;
    return { mesh, geo, iPos: p.a, iCol: c.a, iUV: u.a, iSRS: s.a, iVel: v.a, iOff: o.a, attrs: [p.at, c.at, u.at, s.at, v.at, o.at] };
  }

  private framesFor(sprite: string | string[] | undefined, animate: boolean): number {
    const key = (Array.isArray(sprite) ? sprite.join(',') : sprite ?? 'dot4') + (animate ? '@a' : '');
    let k = this.frameKey.get(key);
    if (k === undefined) {
      const names = Array.isArray(sprite) ? sprite : [sprite ?? 'dot4'];
      this.frames.push(names.map((n) => atlas().get(n)));
      k = this.frames.length - 1;
      this.frameKey.set(key, k);
    }
    return k;
  }

  emit(o: EmitOpts) {
    const count = Math.max(1, Math.round((o.count ?? 1) * (o.screen ? 1 : this.quality)));
    const fr = this.framesFor(o.sprite, !!o.animate);
    const cols = o.color === undefined ? [0xffffff] : Array.isArray(o.color) ? o.color : [o.color];
    for (let k = 0; k < count; k++) {
      if (this.n >= MAX) this.kill(0); // recycle oldest-ish
      const i = this.n++;
      const j = o.jitter ?? 0;
      this.px[i] = o.pos.x + (j ? (rnd.next() - 0.5) * 2 * j : 0);
      this.py[i] = o.pos.y + (j ? (rnd.next() - 0.5) * 2 * j * 0.5 : 0);
      this.pz[i] = o.pos.z + (j ? (rnd.next() - 0.5) * 2 * j : 0);
      const sp = o.spread ?? 0;
      let rx = 0, ry = 0, rz = 0;
      if (sp > 0) {
        // random direction in sphere
        const u = rnd.next() * 2 - 1, th = rnd.next() * Math.PI * 2, r = Math.sqrt(1 - u * u) * sp * (0.35 + rnd.next() * 0.65);
        rx = Math.cos(th) * r;
        rz = Math.sin(th) * r;
        ry = u * sp * (0.35 + rnd.next() * 0.65);
      }
      this.vx[i] = (o.vel?.x ?? 0) + rx;
      this.vy[i] = (o.vel?.y ?? 0) + ry + (o.up ? rnd.next() * o.up : 0);
      this.vz[i] = (o.vel?.z ?? 0) + rz;
      const L = o.life ? o.life[0] + rnd.next() * (o.life[1] - o.life[0]) : 1;
      this.life[i] = 0;
      this.maxLife[i] = L;
      const sj = 1 + (rnd.next() - 0.5) * 2 * (o.sizeJitter ?? 0.25);
      this.s0[i] = (o.size?.[0] ?? 0.2) * sj;
      this.s1[i] = (o.size?.[1] ?? o.size?.[0] ?? 0.2) * sj;
      this.rot[i] = (rnd.next() - 0.5) * (o.rot ?? 0);
      this.rotV[i] = (rnd.next() - 0.5) * 2 * (o.rotSpeed ?? 0);
      const col = cols[Math.floor(rnd.next() * cols.length)];
      this.cr[i] = ((col >> 16) & 255) / 255;
      this.cg[i] = ((col >> 8) & 255) / 255;
      this.cb[i] = (col & 255) / 255;
      this.ca[i] = o.alpha ?? 1;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0;
      this.bounce[i] = o.bounce ?? 0.3;
      this.stretch[i] = o.stretch ?? 0;
      this.fadeIn[i] = o.fadeIn ?? 0;
      this.delay[i] = o.delay ?? 0;
      this.ox[i] = o.offset?.[0] ?? 0;
      this.oy[i] = o.offset?.[1] ?? 0;
      this.flags[i] = (o.additive ? 1 : 0) | (o.ground ? 2 : 0) | (o.screen ? 4 : 0) | (o.animate ? 8 : 0);
      // random frame unless animate
      this.frameOf[i] = o.animate ? fr : fr | (Math.floor(rnd.next() * this.frames[fr].length) << 16);
    }
  }

  private kill(i: number) {
    const l = --this.n;
    if (i === l) return;
    this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
    this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
    this.life[i] = this.life[l]; this.maxLife[i] = this.maxLife[l];
    this.s0[i] = this.s0[l]; this.s1[i] = this.s1[l]; this.rot[i] = this.rot[l]; this.rotV[i] = this.rotV[l];
    this.cr[i] = this.cr[l]; this.cg[i] = this.cg[l]; this.cb[i] = this.cb[l]; this.ca[i] = this.ca[l];
    this.grav[i] = this.grav[l]; this.drag[i] = this.drag[l]; this.bounce[i] = this.bounce[l];
    this.stretch[i] = this.stretch[l]; this.fadeIn[i] = this.fadeIn[l]; this.delay[i] = this.delay[l];
    this.ox[i] = this.ox[l]; this.oy[i] = this.oy[l];
    this.flags[i] = this.flags[l]; this.frameOf[i] = this.frameOf[l];
  }

  update(dt: number, fog?: THREE.Fog | null) {
    let nc = 0, na = 0;
    const C = this.cut, A = this.add;
    for (let i = 0; i < this.n; i++) {
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        continue;
      }
      this.life[i] += dt;
      const t = this.life[i] / this.maxLife[i];
      if (t >= 1) {
        this.kill(i);
        i--;
        continue;
      }
      // integrate
      const d = this.drag[i];
      if (d > 0) {
        const f = Math.exp(-d * dt);
        this.vx[i] *= f; this.vy[i] *= f; this.vz[i] *= f;
      }
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.rotV[i] * dt;
      if (this.flags[i] & 2 && this.groundAt) {
        const g = this.groundAt(this.px[i], this.pz[i]) + 0.03;
        if (this.py[i] < g) {
          this.py[i] = g;
          if (this.vy[i] < 0) this.vy[i] = -this.vy[i] * this.bounce[i];
          this.vx[i] *= 0.6; this.vz[i] *= 0.6; this.rotV[i] *= 0.5;
        }
      }
      const add = this.flags[i] & 1;
      const L = add ? A : C;
      const j = add ? na++ : nc++;
      const fi = this.frameOf[i];
      const list = this.frames[fi & 0xffff];
      const frame = this.flags[i] & 8 ? list[Math.min(list.length - 1, Math.floor(t * list.length))] : list[(fi >>> 16) % list.length];
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const fin = this.fadeIn[i] > 0 ? Math.min(1, this.life[i] / this.fadeIn[i]) : 1;
      const a = this.ca[i] * fin * (t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1);
      const aspect = frame.w / frame.h;
      L.iPos[j * 3] = this.px[i]; L.iPos[j * 3 + 1] = this.py[i]; L.iPos[j * 3 + 2] = this.pz[i];
      L.iCol[j * 4] = this.cr[i]; L.iCol[j * 4 + 1] = this.cg[i]; L.iCol[j * 4 + 2] = this.cb[i]; L.iCol[j * 4 + 3] = a;
      L.iUV[j * 4] = frame.u0; L.iUV[j * 4 + 1] = frame.v0; L.iUV[j * 4 + 2] = frame.u1; L.iUV[j * 4 + 3] = frame.v1;
      L.iSRS[j * 4] = size * Math.min(1, aspect) * (aspect > 1 ? 1 : 1);
      L.iSRS[j * 4 + 1] = size / Math.max(1, aspect);
      if (aspect > 1) { L.iSRS[j * 4] = size; L.iSRS[j * 4 + 1] = size / aspect; } else { L.iSRS[j * 4] = size * aspect; L.iSRS[j * 4 + 1] = size; }
      L.iSRS[j * 4 + 2] = this.rot[i];
      L.iSRS[j * 4 + 3] = this.flags[i] & 4 ? 2.0 : this.stretch[i];
      L.iVel[j * 3] = this.vx[i]; L.iVel[j * 3 + 1] = this.vy[i]; L.iVel[j * 3 + 2] = this.vz[i];
      L.iOff[j * 2] = this.ox[i]; L.iOff[j * 2 + 1] = this.oy[i];
    }
    for (const [L, cnt] of [[C, nc], [A, na]] as [Layer, number][]) {
      L.geo.instanceCount = cnt;
      for (const at of L.attrs) {
        at.needsUpdate = true;
        at.clearUpdateRanges();
        at.addUpdateRange(0, cnt * at.itemSize);
      }
      const m = L.mesh.material as THREE.ShaderMaterial;
      if (fog) {
        m.uniforms.fogColor.value.copy(fog.color);
        m.uniforms.fogNear.value = fog.near;
        m.uniforms.fogFar.value = fog.far;
      }
    }
  }

  clear() {
    this.n = 0;
  }
  get count() {
    return this.n;
  }
}
