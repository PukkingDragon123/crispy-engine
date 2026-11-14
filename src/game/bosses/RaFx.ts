// Ra's effects kit: his own solar shot system (pixel-sprite sun orbs: a crisp
// readable core inside a posterized additive halo, with ember trails; they
// skim the ground, ride the solar wind or arc as flare globs that burst into
// rings), plasma ribbons for the eye beams and the rift that splits the sky
// (camera-facing strips with a flowing posterized plasma shader), and the boss
// material (the cel/ink voxel shader plus boiling solar plasma: white-hot
// surges rising through the fire, flame tips that tear and flicker away).
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Player } from '../player/Player';
import { SpriteBatch } from '../fx/SpriteBatch';
import { makeVoxelMaterial, VoxelMaterial, globalUniforms } from '../../engine/render/VoxelMaterial';
import { rnd } from '../../engine/math/rand';

export const SUN = { white: 0xfff6dc, gold: 0xffd46a, amber: 0xffa63a, orange: 0xff7a22, red: 0xe0461a, ember: 0xff9a3a };
export const EMBERS = ['flame0', 'flame1', 'flame2', 'flame3'];
export const FIRE_COLS = [0xfff2c0, 0xffd070, 0xffa040, 0xff7020];

// ----------------------------------------------------------------------------- the boss material
const NOISE_GLSL = /* glsl */ `
float raH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float raNoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(raH(i), raH(i + vec3(1,0,0)), f.x), mix(raH(i + vec3(0,1,0)), raH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(raH(i + vec3(0,0,1)), raH(i + vec3(1,0,1)), f.x), mix(raH(i + vec3(0,1,1)), raH(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

/**
 * uRa: x plasma glow (1 = normal, eclipse dims it), y flame-tip tearing (0..1),
 * z white-hot surge strength, w flow speed. The per-material fx vec4 keeps the
 * engine meaning (flash, dissolve, emissive boost).
 */
export function raMaterial(fx: { value: THREE.Vector4 }, ra: { value: THREE.Vector4 }, key = 'body', o: { fog?: boolean } = {}): VoxelMaterial {
  const m = makeVoxelMaterial({ roughness: 0.6, fog: o.fog ?? true });
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    sh.uniforms.uFx = fx;
    sh.uniforms.uRa = ra;
    sh.uniforms.uTime = globalUniforms.uTime;
    let f = sh.fragmentShader.replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform vec4 uRa;\n${NOISE_GLSL}`);
    f = f.replace(
      'dissolveEdge = 1.0 - smoothstep(0.0, 0.08, hn - th + 0.04);\n        }',
      `dissolveEdge = 1.0 - smoothstep(0.0, 0.08, hn - th + 0.04);
        }
        #ifdef USE_COLOR
        if (vMatx.x > 0.05 && uRa.y > 0.001) {
          // red flame tips tear and flicker away (thin flames only carry those tones)
          float ratio = vColor.g / max(vColor.r, 1e-3);
          float tip = 1.0 - smoothstep(0.05, 0.15, ratio);
          if (tip > 0.0) {
            float tn = raNoise(vWPos * 1.15 + vec3(0.0, -uTime * 3.4 * uRa.w, 0.0));
            if (tn < tip * 0.6 * uRa.y) discard;
          }
        }
        #endif`
    );
    f = f.replace(
      'totalEmissiveRadiance += diffuseColor.rgb * (vMatx.x * uEmissiveStrength * (1.0 + vFx.z));',
      `{
        float em = vMatx.x;
        if (em > 0.05) {
          // boiling plasma: a rising two-octave flow, white-hot surges, cooler lanes
          vec3 q = vWPos * 0.42 + vec3(0.0, -uTime * 1.3 * uRa.w, 0.0);
          float n = raNoise(q) * 0.62 + raNoise(q * 2.3 + 7.1) * 0.38;
          float flick = 0.62 + 0.8 * n;
          vec3 surge = vec3(1.0, 0.84, 0.58) * smoothstep(0.66, 0.95, n) * uRa.z;
          totalEmissiveRadiance += (diffuseColor.rgb * flick + surge) * em * uEmissiveStrength * (1.0 + vFx.z) * uRa.x;
        }
      }`
    );
    sh.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'ra-sun-' + key + (o.fog === false ? '-nofog' : '') + '-v1';
  m.userData.fx = fx;
  return m;
}

// ----------------------------------------------------------------------------- solar shots
export interface SolarShot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  dmg: number;
  life: number;
  /** > 0: skims this high over the ground */
  hug: number;
  grav: number;
  size: number;
  grazed: boolean;
  t: number;
  kind: 'orb' | 'glob';
  /** a glob bursts on landing */
  onLand?: (s: SolarShot) => void;
  /** carried by the wind (added each frame) */
  wind?: boolean;
}

const _v = new THREE.Vector3();

export class SolarShots {
  list: SolarShot[] = [];
  private core = new SpriteBatch(1200, false);
  private glow = new SpriteBatch(1200, true);
  wind = new THREE.Vector3();
  dmgMul = 0.8;
  constructor(private ctx: Ctx, private player: Player, private sourceId: number) {
    ctx.scene.add(this.core.mesh, this.glow.mesh);
  }
  spawn(o: Partial<SolarShot> & { x: number; y: number; z: number; vx: number; vz: number; dmg: number }) {
    if (this.list.length > 1100) this.list.shift();
    const s: SolarShot = { vy: 0, r: 0.42, life: 7, hug: 0, grav: 0, size: 0.5, grazed: false, t: 0, kind: 'orb', ...o };
    s.dmg *= this.dmgMul;
    this.list.push(s);
    return s;
  }
  /** a ring of skimming orbs around a point (gap = missing slots so it can be slipped through) */
  ring(x: number, z: number, n: number, speed: number, dmg: number, o: { phase?: number; gap?: number; hug?: number; size?: number; r0?: number } = {}) {
    const ph = o.phase ?? rnd.next() * Math.PI * 2;
    const gap = o.gap ?? 0;
    const g0 = rnd.int(0, n - 1);
    for (let i = 0; i < n; i++) {
      if (gap > 0 && ((i - g0 + n) % n) < gap) continue;
      const a = ph + (i / n) * Math.PI * 2;
      const r0 = o.r0 ?? 0.8;
      const px = x + Math.sin(a) * r0, pz = z + Math.cos(a) * r0;
      this.spawn({ x: px, y: this.ctx.world.groundAt(px, pz) + (o.hug ?? 1.1), z: pz, vx: Math.sin(a) * speed, vz: Math.cos(a) * speed, dmg, hug: o.hug ?? 1.1, size: o.size ?? 0.55, life: 5.5 });
    }
  }
  clear() {
    this.list.length = 0;
  }
  update(dt: number) {
    const ctx = this.ctx, pl = this.player;
    const pc = pl.center(_v);
    const pcx = pc.x, pcy = pc.y, pcz = pc.z;
    const water = ctx.world.sa.waterLevel;
    this.core.begin();
    this.glow.begin();
    // ember trails thin out in a crowded sky (phones)
    const trail = Math.min(0.22, 14 / Math.max(1, this.list.length));
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.t += dt;
      s.life -= dt;
      if (s.wind) {
        s.vx += (this.wind.x - s.vx) * dt * 0.8;
        s.vz += (this.wind.z - s.vz) * dt * 0.8;
      }
      s.vy -= s.grav * dt;
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      let dead = s.life <= 0;
      const g = Math.max(ctx.world.field.heightAt(s.x, s.z), water);
      if (s.hug > 0) s.y += (g + s.hug - s.y) * Math.min(1, dt * 10);
      else {
        s.y += s.vy * dt;
        if (s.y < g + 0.2) {
          dead = true;
          if (s.onLand) s.onLand(s);
          else this.pop(s.x, g + 0.3, s.z, 0.6);
        }
      }
      if (!dead && pl.alive) {
        const dx = s.x - pcx, dz = s.z - pcz, dy = s.y - pcy;
        const dh = Math.hypot(dx, dz);
        if (dh < s.r + 0.42 && Math.abs(dy) < 1.0 + s.r) {
          const dealt = pl.takeHit({ base: s.dmg, kind: 'magic', source: 'projectile', knock: 3, status: [{ id: 'burn', stacks: 1, dur: 2.5 }] }, new THREE.Vector3(s.x - s.vx * 0.05, s.y, s.z - s.vz * 0.05));
          if (dealt > 0) pl.invuln = Math.max(pl.invuln, 0.45);
          dead = true;
          this.pop(s.x, s.y, s.z, 1);
        } else if (!s.grazed && dh < s.r + 1.4 && Math.abs(dy) < 1.6) {
          s.grazed = true;
          ctx.events.emit('graze', s);
        }
      }
      if (dead) {
        this.list[i] = this.list[this.list.length - 1];
        this.list.pop();
        continue;
      }
      // draw: crisp hot core, a flickering posterized halo, ember trail
      const fl = 0.85 + 0.15 * Math.sin(s.t * 23 + i);
      const big = s.kind === 'glob';
      this.core.push(s.x, s.y, s.z, big ? 'dot8' : 'dot6', s.size * 0.62, s.size * 0.62, 0, big ? SUN.white : 0xfff0c0, 1);
      this.glow.push(s.x, s.y, s.z, big ? 'glow32' : 'glow16', s.size * 2.3 * fl, s.size * 2.3 * fl, 0, big ? SUN.amber : SUN.orange, 0.9);
      if (rnd.chance(big ? 0.9 : trail))
        ctx.particles.emit({ pos: { x: s.x, y: s.y, z: s.z }, count: 1, vel: { x: -s.vx * 0.1, y: 0.6, z: -s.vz * 0.1 }, spread: 0.4, life: [0.2, 0.45], size: [s.size * (big ? 0.9 : 0.5), 0.04], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 2, gravity: -1.5 });
    }
    this.core.end(ctx.world.env.fog);
    this.glow.end(ctx.world.env.fog);
  }
  pop(x: number, y: number, z: number, k: number) {
    const ctx = this.ctx;
    ctx.particles.emit({ pos: { x, y, z }, count: Math.round(6 * k), spread: 3 * k, up: 1.5, life: [0.2, 0.45], size: [0.3 * k, 0.04], sprite: EMBERS, additive: true, color: FIRE_COLS, drag: 2.5 });
    ctx.particles.emit({ pos: { x, y, z }, count: 4, spread: 4, life: [0.15, 0.35], size: [0.06, 0.01], sprite: 'spark', additive: true, color: SUN.gold, stretch: 0.03, gravity: 6 });
  }
  dispose() {
    this.list.length = 0;
    for (const b of [this.core, this.glow]) {
      b.mesh.removeFromParent();
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
    }
  }
}

// ----------------------------------------------------------------------------- plasma ribbons (beams, the sky rift)
const RIBBON_VERT = /* glsl */ `
attribute float aW;
varying vec2 vUv;
varying float vW;
void main(){
  vUv = uv; vW = aW;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const RIBBON_FRAG = /* glsl */ `
uniform float uTime, uLen, uI, uFlow;
uniform vec3 uCore, uEdge;
varying vec2 vUv;
varying float vW;
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  float a = abs(vUv.y - 0.5) * 2.0;
  float s = vUv.x * uLen;
  float n = n2(vec2(s * 0.35 - uTime * uFlow, vUv.y * 4.0)) * 0.6 + n2(vec2(s * 1.1 - uTime * uFlow * 2.3, vUv.y * 9.0 + 3.0)) * 0.4;
  float edge = 1.0 - a;
  float body = smoothstep(0.0, 0.55, edge - (1.0 - n) * 0.45);
  float core = smoothstep(0.55, 0.9, edge) * (0.75 + 0.25 * n);
  // posterize: the beam reads as pixel art
  body = floor(body * 4.0 + 0.5) / 4.0;
  core = floor(core * 3.0 + 0.5) / 3.0;
  vec3 c = uEdge * body * 1.6 + uCore * core * 3.2;
  float fade = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
  gl_FragColor = vec4(c * uI * fade * vW, 1.0);
}`;

export class Ribbon {
  mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private wt: Float32Array;
  u: { [k: string]: THREE.IUniform };
  private pts: THREE.Vector3[];
  widths: number[];
  constructor(public n: number, o: { core?: number; edge?: number; flow?: number } = {}) {
    this.pos = new Float32Array(n * 2 * 3);
    this.wt = new Float32Array(n * 2).fill(1);
    const uv = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      uv.set([u, 0, u, 1], i * 4);
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setAttribute('aW', new THREE.BufferAttribute(this.wt, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    this.u = {
      uTime: globalUniforms.uTime,
      uLen: { value: 10 },
      uI: { value: 1 },
      uFlow: { value: o.flow ?? 6 },
      uCore: { value: new THREE.Color(o.core ?? 0xfff4dc) },
      uEdge: { value: new THREE.Color(o.edge ?? 0xff8a2a) },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.pts = Array.from({ length: n }, () => new THREE.Vector3());
    this.widths = new Array(n).fill(1);
  }
  get points() {
    return this.pts;
  }
  /** a straight beam a → b with a living wobble */
  beam(a: THREE.Vector3, b: THREE.Vector3, w0: number, w1: number, wobble = 0.25, t = 0) {
    const n = this.n;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    const sx = -dz / L, sz = dx / L;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const wv = Math.sin(k * 9 + t * 13) * wobble * Math.sin(k * Math.PI);
      this.pts[i].set(a.x + dx * k + sx * wv, a.y + dy * k + Math.cos(k * 7 + t * 11) * wobble * 0.5 * Math.sin(k * Math.PI), a.z + dz * k + sz * wv);
      this.widths[i] = w0 + (w1 - w0) * k;
    }
    this.u.uLen.value = L;
  }
  /** rebuild the camera-facing strip from points/widths */
  update(cam: THREE.Camera) {
    const n = this.n, p = this.pts, out = this.pos;
    const cp = cam.position;
    let L = 0;
    for (let i = 0; i < n; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
      const tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
      const vx = cp.x - p[i].x, vy = cp.y - p[i].y, vz = cp.z - p[i].z;
      // side = tangent × view
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const w = this.widths[i] * 0.5;
      sx = (sx / sl) * w;
      sy = (sy / sl) * w;
      sz = (sz / sl) * w;
      out[i * 6] = p[i].x - sx;
      out[i * 6 + 1] = p[i].y - sy;
      out[i * 6 + 2] = p[i].z - sz;
      out[i * 6 + 3] = p[i].x + sx;
      out[i * 6 + 4] = p[i].y + sy;
      out[i * 6 + 5] = p[i].z + sz;
      if (i > 0) L += p[i].distanceTo(p[i - 1]);
    }
    if (L > 0) this.u.uLen.value = L;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
  set intensity(v: number) {
    this.u.uI.value = v;
    this.mesh.visible = v > 0.002;
  }
  get intensity() {
    return this.u.uI.value as number;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** closest distance from p to segment ab */
export function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz || 1)));
  return Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t, p.z - a.z - abz * t);
}

/** the river's flow at a point, if the world knows its river (NILE WORLD); null otherwise */
export function riverFlow(world: unknown, x: number, z: number): { x: number; z: number } | null {
  const w = world as { riverFlow?: (x: number, z: number) => { x: number; z: number } | null; nile?: { flowAt?: (x: number, z: number) => { x: number; z: number } | null } };
  const f = w.riverFlow?.(x, z) ?? w.nile?.flowAt?.(x, z) ?? null;
  if (!f) return null;
  const l = Math.hypot(f.x, f.z);
  return l > 1e-4 ? { x: f.x / l, z: f.z / l } : null;
}
