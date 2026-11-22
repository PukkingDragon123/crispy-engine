// GPU-instanced particle system. Five layers:
//  - "cut": crisp pixel sprites, dithered fade (digits, glyphs, bone chips, linen)
//  - "add": additive pixel glyph sprites (magic)
//  - "soft": lit volumetric smoke / dust / mist (self-shadowed density, alpha blended)
//  - "glow": high-resolution additive flashes, flames, sparks, glints, rings
//  - "solid": shaded sand grains, drops and chips (motion-stretched along velocity)
// The old pixel sprite names are routed onto the soft atlas (SoftAtlas.softFor).
// Supports velocity-stretched streaks, sprite animation, ground bounce on the
// heightfield and screen-constant sprites (damage digits).
import * as THREE from 'three';
import { atlas, SpriteFrame } from './PixelArt';
import { rnd } from '../../engine/math/rand';
import { softAtlas, softFor } from './SoftAtlas';
import { ATMO } from '../../engine/render/VoxelMaterial';

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
const _amb = new THREE.Color(0.2, 0.2, 0.24);

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
  /** layer (0 cut, 1 add, 2 soft, 3 glow, 4 solid) and colour tint of each frame set */
  private setLayer: number[] = [];
  private setTint: [number, number, number][] = [];
  private lay = new Uint8Array(MAX);
  private frameOf: Int32Array = new Int32Array(MAX); // index into frames table
  private frameKey = new Map<string, number>();
  private cut: Layer;
  private add: Layer;
  private layers: Layer[];
  /** per-frame hooks run from update (voxel shots, 3D coin bursts parented to the group) */
  tickers: ((dt: number) => void)[] = [];
  /** ground height sampler for bounce (set by world) */
  groundAt: ((x: number, z: number) => number) | null = null;
  quality = 1;

  constructor() {
    const tex = atlas().texture;
    const soft = softAtlas().tex;
    this.cut = this.makeLayer(tex, 0);
    this.add = this.makeLayer(tex, 1);
    this.layers = [this.cut, this.add, this.makeLayer(soft, 2), this.makeLayer(soft, 3), this.makeLayer(soft, 4)];
    for (const L of this.layers) this.group.add(L.mesh);
  }

  private makeLayer(tex: THREE.Texture, mode: number): Layer {
    const additive = mode === 1 || mode === 3;
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
        uSun: { value: new THREE.Color(1, 0.95, 0.85) },
        uAmb: { value: new THREE.Color(0.55, 0.56, 0.66) },
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
        uniform sampler2D map; uniform vec3 fogColor, uSun, uAmb; uniform float fogNear, fogFar;
        varying vec2 vUv; varying vec4 vCol; varying float vFogDepth;
        float bayer(vec2 p){ ivec2 q = ivec2(mod(p, 4.0)); int i = q.x + q.y * 4;
          float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return (m[i] + 0.5) / 16.0; }
        void main(){
          vec4 t = texture2D(map, vUv);
          float f = smoothstep(fogNear, fogFar, vFogDepth);
          vec4 c;
          ${
            mode === 1 || mode === 3
              ? `c = t * vCol; if (c.a < 0.004) discard; c.rgb *= c.a * (1.0 - f);`
              : mode === 2
                ? `float d = t.a * vCol.a * smoothstep(0.35, 1.8, vFogDepth); if (d < 0.004) discard;
                   // self-shadowed volume: sun-lit tops, cool sky-lit undersides, a bright rim against the light
                   vec3 lit = vCol.rgb * (uAmb + uSun * (t.g * 0.95 + t.b * 0.35));
                   c = vec4(mix(lit, fogColor, f * 0.92), d);`
                : mode === 4
                  ? `if (t.a < 0.5) discard; vec3 lit = vCol.rgb * t.rgb * (uAmb * 0.7 + uSun * 0.62);
                     if (vCol.a < 0.999 && vCol.a < bayer(gl_FragCoord.xy)) discard;
                     c = vec4(mix(lit, fogColor, f), 1.0);`
                  : `c = t * vCol; if (c.a < bayer(gl_FragCoord.xy)) discard; c.a = 1.0; c.rgb = mix(c.rgb, fogColor, f);`
          }
          gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
      transparent: additive || mode === 2,
      depthWrite: !additive && mode !== 2,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = additive ? 10 : mode === 2 ? 9 : 2;
    return { mesh, geo, iPos: p.a, iCol: c.a, iUV: u.a, iSRS: s.a, iVel: v.a, iOff: o.a, attrs: [p.at, c.at, u.at, s.at, v.at, o.at] };
  }

  private framesFor(sprite: string | string[] | undefined, animate: boolean, additive: boolean): number {
    const key = (Array.isArray(sprite) ? sprite.join(',') : sprite ?? 'dot4') + (animate ? '@a' : '') + (additive ? '+' : '');
    let k = this.frameKey.get(key);
    if (k === undefined) {
      const names = Array.isArray(sprite) ? sprite : [sprite ?? 'dot4'];
      // the whole set goes soft when its first sprite has a soft counterpart
      const sf = softFor(names[0], additive);
      if (sf) {
        const sa = softAtlas().frames;
        this.frames.push(names.map((n) => sa.get(softFor(n, additive)?.frame ?? sf.frame) ?? sa.get(sf.frame)!) as SpriteFrame[]);
        this.setLayer.push(sf.layer);
        const t = sf.tint;
        this.setTint.push(t === undefined ? [1, 1, 1] : [((t >> 16) & 255) / 255, ((t >> 8) & 255) / 255, (t & 255) / 255]);
      } else {
        this.frames.push(names.map((n) => atlas().get(n)));
        this.setLayer.push(additive ? 1 : 0);
        this.setTint.push([1, 1, 1]);
      }
      k = this.frames.length - 1;
      this.frameKey.set(key, k);
    }
    return k;
  }

  emit(o: EmitOpts) {
    const count = Math.max(1, Math.round((o.count ?? 1) * (o.screen ? 1 : this.quality)));
    const fr = this.framesFor(o.sprite, !!o.animate, !!o.additive);
    const layer = this.setLayer[fr], tint = this.setTint[fr];
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
      this.cr[i] = (((col >> 16) & 255) / 255) * tint[0];
      this.cg[i] = (((col >> 8) & 255) / 255) * tint[1];
      this.cb[i] = ((col & 255) / 255) * tint[2];
      this.lay[i] = layer;
      this.ca[i] = o.alpha ?? 1;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0;
      this.bounce[i] = o.bounce ?? 0.3;
      // solid grains read as motion-blurred streaks while they fly
      this.stretch[i] = o.stretch ?? (layer === 4 && !o.screen ? 0.014 : 0);
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
    this.flags[i] = this.flags[l]; this.frameOf[i] = this.frameOf[l]; this.lay[i] = this.lay[l];
  }

  update(dt: number, fog?: THREE.Fog | null) {
    for (const t of this.tickers) t(dt);
    const cnt = [0, 0, 0, 0, 0];
    const LS = this.layers;
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
      const li = this.lay[i];
      const L = LS[li];
      const j = cnt[li]++;
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
    for (let li = 0; li < LS.length; li++) {
      const L = LS[li], n = cnt[li];
      L.geo.instanceCount = n;
      if (n === 0 && !L.mesh.visible) continue;
      L.mesh.visible = n > 0;
      for (const at of L.attrs) {
        at.needsUpdate = true;
        at.clearUpdateRanges();
        at.addUpdateRange(0, n * at.itemSize);
      }
      const m = L.mesh.material as THREE.ShaderMaterial;
      if (fog) {
        m.uniforms.fogColor.value.copy(fog.color);
        m.uniforms.fogNear.value = fog.near;
        m.uniforms.fogFar.value = fog.far;
        // smoke takes the sky's tint in its shade and the sun's colour on its lit side
        if (li >= 2) {
          (m.uniforms.uAmb.value as THREE.Color).copy(fog.color).multiplyScalar(0.42).add(_amb);
          const sc = (ATMO as { sunColor?: THREE.Color }).sunColor;
          if (sc) (m.uniforms.uSun.value as THREE.Color).copy(sc).multiplyScalar(0.62);
        }
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
