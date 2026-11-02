// The living sandstorm: allowed play-space SDF (union of zone discs + corridor
// capsules, all animatable), a swirling curtain rendered along the boundary,
// and roaming dust devils that damage anything inside them.
import * as THREE from 'three';
import { globalUniforms } from '../../engine/render/VoxelMaterial';
import { rnd } from '../../engine/math/rand';

export interface StormDisc { id: string; x: number; z: number; r: number; target: number; speed: number; }
export interface StormCapsule { id: string; ax: number; az: number; bx: number; bz: number; w: number; target: number; speed: number; }
export interface DustDevil { x: number; z: number; vx: number; vz: number; r: number; life: number; dps: number; mesh: THREE.Group; }

const curtainVert = /* glsl */ `
attribute vec3 iPos; attribute float iSeed;
varying vec2 vUv; varying float vSeed; varying float vFog;
uniform float uWidth, uHeight;
void main(){
  vec3 base = iPos;
  vec4 mvBase = modelViewMatrix * vec4(base, 1.0);
  // cylindrical billboard (rotate around Y toward camera)
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  camRight.y = 0.0; camRight = normalize(camRight);
  vec3 wp = base + camRight * position.x * uWidth + vec3(0.0, (position.y + 0.5) * uHeight, 0.0);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vUv = position.xy + 0.5;
  vSeed = iSeed;
  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const curtainFrag = /* glsl */ `
uniform float uTime; uniform vec3 uColor; uniform vec3 uDark; uniform float uOpacity;
varying vec2 vUv; varying float vSeed; varying float vFog;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  vec2 uv = vUv;
  // pixelate for voxel-pixel coherence
  vec2 pu = floor(uv * vec2(14.0, 34.0)) / vec2(14.0, 34.0);
  float t = uTime;
  float n = fbm(vec2(pu.x * 2.0 + vSeed * 7.0 - t * 0.35, pu.y * 6.0 - t * 0.9 + vSeed));
  float n2 = fbm(vec2(pu.x * 4.0 + t * 0.6 + vSeed * 3.0, pu.y * 6.0 - t * 1.1));
  float edge = smoothstep(0.0, 0.25, uv.x) * smoothstep(1.0, 0.75, uv.x);
  float vert = smoothstep(1.0, 0.35, uv.y) * (0.75 + 0.25 * smoothstep(0.0, 0.08, uv.y));
  float a = clamp((n * 1.25 + n2 * 0.45 - 0.25) * edge * vert, 0.0, 1.0) * uOpacity;
  vec3 col = mix(uDark, uColor, n2 * 0.6 + uv.y * 0.4);
  float near = smoothstep(2.0, 18.0, vFog);
  a *= near;
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export class Storm {
  discs: StormDisc[] = [];
  capsules: StormCapsule[] = [];
  devils: DustDevil[] = [];
  group = new THREE.Group();
  private curtain: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private iPos: Float32Array;
  private iSeed: Float32Array;
  private dirty = true;
  private rebuildTimer = 0;
  uniforms = {
    uTime: globalUniforms.uTime,
    uColor: { value: new THREE.Color(0xe8c48c) },
    uDark: { value: new THREE.Color(0xa87444) },
    uOpacity: { value: 0.82 },
    uWidth: { value: 16 },
    uHeight: { value: 46 },
  };
  /** 0..1: storm intensity weakened by boss kills */
  strength = 1;

  constructor(public heightAt: (x: number, z: number) => number) {
    const MAXN = 900;
    this.geo = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    this.geo.index = q.index;
    this.geo.setAttribute('position', q.getAttribute('position'));
    this.iPos = new Float32Array(MAXN * 3);
    this.iSeed = new Float32Array(MAXN);
    this.geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.iPos, 3));
    this.geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(this.iSeed, 1));
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ vertexShader: curtainVert, fragmentShader: curtainFrag, uniforms: this.uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.curtain = new THREE.Mesh(this.geo, mat);
    this.curtain.frustumCulled = false;
    this.curtain.renderOrder = 5;
    this.group.add(this.curtain);
  }

  addDisc(id: string, x: number, z: number, r: number, open = true) {
    const d = { id, x, z, r: open ? r : 0, target: r, speed: 14 };
    this.discs.push(d);
    this.dirty = true;
    return d;
  }
  addCapsule(id: string, ax: number, az: number, bx: number, bz: number, w: number, open = true) {
    const c = { id, ax, az, bx, bz, w: open ? w : 0, target: w, speed: 6 };
    this.capsules.push(c);
    this.dirty = true;
    return c;
  }
  /** animate a shape open/closed */
  setTarget(id: string, target: number, speed?: number) {
    for (const d of this.discs) if (d.id === id) { d.target = target; if (speed) d.speed = speed; }
    for (const c of this.capsules) if (c.id === id) { c.target = target; if (speed) c.speed = speed; }
  }
  remove(id: string) {
    this.discs = this.discs.filter((d) => d.id !== id);
    this.capsules = this.capsules.filter((c) => c.id !== id);
    this.dirty = true;
  }

  /** signed distance: >0 inside safe area */
  sdf(x: number, z: number) {
    let s = -1e9;
    for (const d of this.discs) if (d.r > 0.5) s = Math.max(s, d.r - Math.hypot(x - d.x, z - d.z));
    for (const c of this.capsules) {
      if (c.w < 0.5) continue;
      const dx = c.bx - c.ax, dz = c.bz - c.az;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - c.ax) * dx + (z - c.az) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      s = Math.max(s, c.w * 0.5 - Math.hypot(x - (c.ax + dx * t), z - (c.az + dz * t)));
    }
    return s;
  }
  /** gradient pointing inward (toward safety) */
  inward(x: number, z: number, out: { x: number; z: number }) {
    const e = 1;
    const gx = this.sdf(x + e, z) - this.sdf(x - e, z);
    const gz = this.sdf(x, z + e) - this.sdf(x, z - e);
    const l = Math.hypot(gx, gz) || 1;
    out.x = gx / l;
    out.z = gz / l;
    return out;
  }

  /** random point inside safe area near (x,z) within [minR,maxR] */
  randomPointNear(x: number, z: number, minR: number, maxR: number, margin = 6) {
    for (let k = 0; k < 30; k++) {
      const a = rnd.next() * Math.PI * 2, r = minR + rnd.next() * (maxR - minR);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (this.sdf(px, pz) > margin) return { x: px, z: pz };
    }
    return null;
  }

  private rebuild() {
    let n = 0;
    const push = (x: number, z: number) => {
      if (n >= 900) return;
      if (this.sdf(x, z) > 1.5) return; // interior seam
      this.iPos[n * 3] = x;
      this.iPos[n * 3 + 1] = this.heightAt(x, z) - 4;
      this.iPos[n * 3 + 2] = z;
      this.iSeed[n] = ((x * 0.137 + z * 0.311) % 1 + 1) % 1;
      n++;
    };
    for (const d of this.discs) {
      if (d.r < 1) continue;
      const steps = Math.max(12, Math.ceil((Math.PI * 2 * d.r) / 7));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        push(d.x + Math.cos(a) * (d.r + 2), d.z + Math.sin(a) * (d.r + 2));
      }
    }
    for (const c of this.capsules) {
      if (c.w < 1) continue;
      const dx = c.bx - c.ax, dz = c.bz - c.az;
      const L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L, nz = dx / L;
      const steps = Math.ceil(L / 7);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        for (const s of [-1, 1]) push(c.ax + dx * t + nx * s * (c.w * 0.5 + 2), c.az + dz * t + nz * s * (c.w * 0.5 + 2));
      }
    }
    this.geo.instanceCount = n;
    (this.geo.getAttribute('iPos') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('iSeed') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  spawnDevil(x: number, z: number, r = 6, dps = 14, life = 24) {
    const g = new THREE.Group();
    this.group.add(g);
    const a = rnd.next() * Math.PI * 2;
    this.devils.push({ x, z, vx: Math.cos(a) * 4, vz: Math.sin(a) * 4, r, life, dps, mesh: g });
  }

  update(dt: number, fx: { p: { emit: (o: any) => void } } | null) {
    let moving = false;
    for (const d of this.discs) {
      if (Math.abs(d.r - d.target) > 0.05) {
        d.r += Math.sign(d.target - d.r) * Math.min(Math.abs(d.target - d.r), d.speed * dt);
        moving = true;
      }
    }
    for (const c of this.capsules) {
      if (Math.abs(c.w - c.target) > 0.05) {
        c.w += Math.sign(c.target - c.w) * Math.min(Math.abs(c.target - c.w), c.speed * dt);
        moving = true;
      }
    }
    this.rebuildTimer -= dt;
    if (this.dirty || (moving && this.rebuildTimer <= 0)) {
      this.rebuild();
      this.dirty = false;
      this.rebuildTimer = 0.25;
    }
    this.uniforms.uOpacity.value = 0.55 + 0.4 * this.strength;
    // dust devils roam inside the safe area
    for (let i = this.devils.length - 1; i >= 0; i--) {
      const dv = this.devils[i];
      dv.life -= dt;
      if (rnd.chance(dt * 0.6)) {
        const a = rnd.next() * Math.PI * 2;
        dv.vx = dv.vx * 0.5 + Math.cos(a) * 3;
        dv.vz = dv.vz * 0.5 + Math.sin(a) * 3;
      }
      dv.x += dv.vx * dt;
      dv.z += dv.vz * dt;
      if (this.sdf(dv.x, dv.z) < dv.r) {
        const inw = this.inward(dv.x, dv.z, { x: 0, z: 0 });
        dv.vx += inw.x * 6 * dt;
        dv.vz += inw.z * 6 * dt;
      }
      if (fx) {
        const y = this.heightAt(dv.x, dv.z);
        for (let k = 0; k < 3; k++) {
          const h = rnd.next() * dv.r * 3;
          const ang = rnd.next() * Math.PI * 2;
          const rr = dv.r * (0.3 + (h / (dv.r * 3)) * 0.9);
          fx.p.emit({
            pos: { x: dv.x + Math.cos(ang) * rr, y: y + h, z: dv.z + Math.sin(ang) * rr },
            count: 1,
            vel: { x: -Math.sin(ang) * 9 + dv.vx, y: 2.5, z: Math.cos(ang) * 9 + dv.vz },
            life: [0.5, 0.9],
            size: [1.2, 2.6],
            sprite: ['cloud0', 'cloud1', 'puff1'],
            color: [0xe0b77a, 0xc99a5d, 0xf0d0a0],
            alpha: 0.8,
            drag: 0.5,
            rot: 6,
            rotSpeed: 3,
          });
        }
      }
      if (dv.life <= 0) {
        dv.mesh.removeFromParent();
        this.devils.splice(i, 1);
      }
    }
  }

  devilDamageAt(x: number, z: number) {
    let d = 0;
    for (const dv of this.devils) if (Math.hypot(x - dv.x, z - dv.z) < dv.r) d += dv.dps;
    return d;
  }
}
