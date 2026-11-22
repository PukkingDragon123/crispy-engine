// Shared kit for the music-reference bosses (Master of Puppets, the Beetles):
//  - Strands: one additive ribbon mesh for every jagged branching lightning bolt
//    ("Ride the Lightning") and every sagging marionette string, camera-facing,
//    white-hot core over a coloured HDR glow so bloom catches it. Bolts live a few
//    flickers; strings are immediate-mode (re-sent every frame by their owner).
//  - song(): the move-name callout every boss uses (floating song title over the
//    boss, the enemySkill event, a toast with the band name).
//  - stinger(): the boss-intro music stinger, when the soundtrack has one.
import * as THREE from 'three';
import type { Boss } from '../Boss';
import { rnd } from '../../../engine/math/rand';

type V = { x: number; y: number; z: number };

const vert = /* glsl */ `
attribute float aA;
attribute float aU;
attribute vec3 aCol;
varying float vA;
varying float vU;
varying vec3 vCol;
void main(){ vA = aA; vU = aU; vCol = aCol; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const frag = /* glsl */ `
varying float vA;
varying float vU;
varying vec3 vCol;
void main(){
  float u = abs(vU);
  float core = exp(-u * u * 16.0);
  float glow = exp(-u * u * 2.6) * 0.5;
  vec3 c = vec3(1.0, 0.97, 0.92) * core * 2.2 + vCol * (glow + core * 0.6) * 2.0;
  gl_FragColor = vec4(c * vA, 1.0);
}`;

interface Seg {
  a: THREE.Vector3;
  b: THREE.Vector3;
  w: number;
}
interface Bolt {
  segs: Seg[];
  t: number;
  life: number;
  col: THREE.Color;
  flick: number[];
}

const MAX_SEGS = 1400;
const _c = new THREE.Vector3(), _d = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Vector3();

export class Strands {
  mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(MAX_SEGS * 4 * 3);
  private aA = new Float32Array(MAX_SEGS * 4);
  private aU = new Float32Array(MAX_SEGS * 4);
  private aCol = new Float32Array(MAX_SEGS * 4 * 3);
  private bolts: Bolt[] = [];
  private lines: { a: V; b: V; sag: number; w: number; col: THREE.Color; alpha: number; buzz: number }[] = [];
  private n = 0;

  constructor(scene: THREE.Scene) {
    const idx = new Uint32Array(MAX_SEGS * 6);
    for (let i = 0; i < MAX_SEGS; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aA', new THREE.BufferAttribute(this.aA, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aU', new THREE.BufferAttribute(this.aU, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aCol', new THREE.BufferAttribute(this.aCol, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }

  /** a jagged, branching bolt from a to b (sky strike, a string catching fire, a ride between two points) */
  bolt(a: V, b: V, o: { width?: number; life?: number; color?: number; branches?: number; jag?: number } = {}) {
    const segs: Seg[] = [];
    const jag = o.jag ?? 0.09;
    const branch = (p: THREE.Vector3, q: THREE.Vector3, w: number, depth: number) => {
      const dir = q.clone().sub(p);
      const len = dir.length();
      const n = Math.max(4, Math.min(18, Math.round(len / 0.9)));
      const pts = [p.clone()];
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const m = p.clone().addScaledVector(dir, t);
        const j = len * jag * Math.sin(t * Math.PI);
        m.x += rnd.range(-j, j);
        m.y += rnd.range(-j, j) * 0.5;
        m.z += rnd.range(-j, j);
        pts.push(m);
      }
      pts.push(q.clone());
      for (let i = 0; i < pts.length - 1 && segs.length < 260; i++) {
        segs.push({ a: pts[i], b: pts[i + 1], w: w * (1 - (i / pts.length) * 0.4) });
        if (depth > 0 && i > 1 && rnd.chance(0.22)) {
          const off = new THREE.Vector3(rnd.range(-1, 1), rnd.range(-0.8, 0.2), rnd.range(-1, 1)).normalize().multiplyScalar(len * rnd.range(0.12, 0.28));
          branch(pts[i], pts[i].clone().add(off), w * 0.5, depth - 1);
        }
      }
    };
    branch(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z), o.width ?? 0.35, o.branches ?? 2);
    const life = o.life ?? 0.42;
    this.bolts.push({ segs, t: 0, life, col: new THREE.Color(o.color ?? 0x7ab8ff), flick: [0, 0.08, 0.17, 0.26].map((f) => f + rnd.range(0, 0.03)) });
    if (this.bolts.length > 40) this.bolts.shift();
  }

  /** a string for this frame only: a catenary-ish sag between a and b, an optional electric buzz */
  line(a: V, b: V, o: { sag?: number; width?: number; color?: number; alpha?: number; buzz?: number } = {}) {
    if (this.lines.length > 64) return;
    this.lines.push({ a, b, sag: o.sag ?? 0.4, w: o.width ?? 0.05, col: new THREE.Color(o.color ?? 0xe8dcc0), alpha: o.alpha ?? 1, buzz: o.buzz ?? 0 });
  }

  private quad(a: THREE.Vector3, b: THREE.Vector3, w: number, alpha: number, col: THREE.Color, cam: THREE.Vector3) {
    if (this.n >= MAX_SEGS) return;
    const i = this.n++;
    _d.subVectors(b, a);
    _c.addVectors(a, b).multiplyScalar(0.5).sub(cam);
    _s.crossVectors(_d, _c).normalize().multiplyScalar(w);
    const P = this.pos;
    const o = i * 12;
    P[o] = a.x - _s.x; P[o + 1] = a.y - _s.y; P[o + 2] = a.z - _s.z;
    P[o + 3] = a.x + _s.x; P[o + 4] = a.y + _s.y; P[o + 5] = a.z + _s.z;
    P[o + 6] = b.x - _s.x; P[o + 7] = b.y - _s.y; P[o + 8] = b.z - _s.z;
    P[o + 9] = b.x + _s.x; P[o + 10] = b.y + _s.y; P[o + 11] = b.z + _s.z;
    for (let k = 0; k < 4; k++) {
      this.aA[i * 4 + k] = alpha;
      this.aU[i * 4 + k] = k % 2 === 0 ? -1 : 1;
      this.aCol[(i * 4 + k) * 3] = col.r;
      this.aCol[(i * 4 + k) * 3 + 1] = col.g;
      this.aCol[(i * 4 + k) * 3 + 2] = col.b;
    }
  }

  update(dt: number, camera: THREE.Camera) {
    this.n = 0;
    const cam = camera.position;
    for (let k = this.bolts.length - 1; k >= 0; k--) {
      const b = this.bolts[k];
      b.t += dt;
      if (b.t >= b.life) {
        this.bolts.splice(k, 1);
        continue;
      }
      // flickers: bright re-strikes along the same channel, fading between them
      let a = 0;
      for (const f of b.flick) {
        const u = b.t - f;
        if (u >= 0) a = Math.max(a, Math.exp(-u * 26));
      }
      a *= 1 - b.t / b.life;
      for (const s of b.segs) this.quad(s.a, s.b, s.w * (0.6 + a * 0.6), a, b.col, cam);
    }
    for (const l of this.lines) {
      const N = 10;
      const A = _e.set(l.a.x, l.a.y, l.a.z).clone();
      let prev = A;
      const t0 = performance.now() * 0.001;
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const p = new THREE.Vector3(l.a.x + (l.b.x - l.a.x) * t, l.a.y + (l.b.y - l.a.y) * t - Math.sin(t * Math.PI) * l.sag, l.a.z + (l.b.z - l.a.z) * t);
        if (l.buzz > 0 && i < N) {
          const j = l.buzz * 0.18;
          p.x += Math.sin(t0 * 61 + i * 3.1) * j;
          p.y += Math.sin(t0 * 53 + i * 2.3) * j;
          p.z += Math.sin(t0 * 47 + i * 1.7) * j;
        }
        this.quad(prev, p, l.w, l.alpha, l.col, cam);
        prev = p;
      }
    }
    this.lines.length = 0;
    this.geo.setDrawRange(0, this.n * 6);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aA') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aU') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aCol') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** the boss-intro music stinger (the soundtrack's 'bossIntro' cue) */
export function stinger(kind = 'bossIntro') {
  (window as unknown as { __music?: { stinger?(k: string): void } }).__music?.stinger?.(kind);
}

/** a named move: the song title floats over the boss, the HUD and barks hear it, the band gets a toast line */
export function song(b: Boss, title: string, band: string, color = '#ffb070', big = true) {
  const pos = { x: b.pos.x, y: b.pos.y + b.height + 1.2, z: b.pos.z };
  b.d.enemies.callout(title, pos, 'boss');
  b.ctx.events.emit('enemySkill', { title, enemy: b, pos, tier: 'boss' });
  if (big) b.ctx.toast(title.toUpperCase(), color, band);
}

/** world position of a rig socket or node */
export function socketAt(b: Boss, name: string, out = new THREE.Vector3()) {
  const s = b.rig.sockets[name] ?? b.rig.nodes[name];
  if (!s) return out.set(b.pos.x, b.pos.y + b.height * 0.6, b.pos.z);
  s.updateWorldMatrix(true, false);
  return s.getWorldPosition(out);
}
