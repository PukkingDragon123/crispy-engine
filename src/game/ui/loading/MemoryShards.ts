// "Collecting pieces of memory": the first-boot layer of the loading hourglass (HourglassView).
// Glowing shards of memory-glass drift in out of the dark void and turn slowly round the glass. Inside
// each one floats a tiny sculpted voxel moment from the backstory (the swaddle with its little tail, the
// camp fire, the scorpion tail, a swinging lantern, the father's turned back, the cold ashes, the board).
// Hover a shard (or click it) to take it; the loading also takes them by itself as it goes. A taken
// shard flies up to the lens, its moment lit and turning, while its line is written under the glass
// (LoadingScreen), then it breaks into light that pours into the hourglass. When loading ends, every
// shard left is drawn in at once and the glass flares: the backstory opens from that light.
// No DOM: runs in the loading worker too.
import * as THREE from 'three';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { makeVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import type { Engine } from '../../../engine/Engine';

export interface MemoryEvent {
  i: number;
  line: string;
  /** seconds the fragment is shown */
  hold: number;
}

/** the fragments, in the order they come back */
export const MEMORY_LINES = [
  'Hush now, little stinger...',
  'A fire, and a song.',
  'A tail that would not hide.',
  'A lantern, swinging in the dark.',
  'His back, turned away.',
  'Cold ashes at dawn.',
  'Then the wind. The board. The hunt.',
];

// ------------------------------------------------------------------ the tiny moments (voxel dioramas)
const h3 = (x: number, y: number, z: number) => {
  let n = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
type Fill = (x: number, y: number, z: number) => number | null;
function sdfFill(m: VoxelModel, R: number, f: Fill, flags?: (c: number) => number) {
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) {
    const c = f(x + 0.5, y + 0.5, z + 0.5);
    if (c !== null) m.set(x, y, z, c, flags ? flags(c) : 0);
  }
}
const ell = (x: number, y: number, z: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
function segD(px: number, py: number, pz: number, a: number[], b: number[]) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy + (pz - a[2]) * dz) / (dx * dx + dy * dy + dz * dz || 1)));
  return { d: Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t, pz - a[2] - dz * t), t };
}
const LIN = [0xeee2c8, 0xd6c6a4, 0xfaf2e0];
const CHI = [0xd0905a, 0xe8b47e, 0x8a5634];
const EMBER = [0xfff0a0, 0xffb040, 0xff6a20];

function diorama(i: number): VoxelModel {
  const m = new VoxelModel('memory_' + i);
  const tailPts = [[-10, 2, 0], [-14, 6, 0], [-15, 11, 0], [-12, 15, 0], [-8, 16, 0], [-6, 13, 0]];
  if (i === 0) {
    // the swaddle: a wrapped bundle, a hood, a little curled tail and two claws peeking out
    sdfFill(m, 18, (x, y, z) => {
      const e = ell(x, y, z, 0, 0, 0, 12, 5.5, 6);
      if (e < 1) return (Math.floor(x * 0.9 + Math.atan2(z, y) * 1.6) & 3) === 0 ? LIN[1] : LIN[0];
      if (ell(x, y, z, 10, 1.5, 0, 5, 5, 5.5) < 1 && ell(x, y, z, 12, 4, 0, 3.5, 3.5, 3.8) > 1) return LIN[2];
      if (ell(x, y, z, 11.5, 2.5, 0, 3, 2.6, 3) < 1) return CHI[(x + y) & 1];
      for (let k = 0; k < 3; k++) if (segD(x, y, z, tailPts[k], tailPts[k + 1]).d < 2 - k * 0.3) return CHI[k & 1];
      if (segD(x, y, z, tailPts[3], tailPts[4]).d < 1.2) return 0x7aff7a;
      for (const s of [1, -1]) if (segD(x, y, z, [7, 4, s * 3], [8.5, 8, s * 3.5]).d < 1.2) return CHI[2];
      return null;
    }, (c) => (c === 0x7aff7a ? VF.EMISSIVE : 0));
  } else if (i === 1 || i === 5) {
    // the fire: a ring of stones, crossed logs, embers and (lit) a column of flame voxels
    const lit = i === 1;
    sdfFill(m, 16, (x, y, z) => {
      const r = Math.hypot(x, z);
      if (y < 0 && y > -3 && r < 11) return r > 8 ? (h3(Math.floor(x), 0, Math.floor(z)) < 0.5 ? 0x8a8278 : 0x6a625a) : lit ? (h3(Math.floor(x), 1, Math.floor(z)) < 0.4 ? EMBER[2] : 0x3a2e26) : (h3(Math.floor(x), 1, Math.floor(z)) < 0.03 ? EMBER[1] : 0x8a8278);
      if (y >= 0 && y < 3 && r > 8 && r < 11 && h3(Math.floor(Math.atan2(z, x) * 3), 2, 0) < 0.8) return 0x9a9288;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        if (segD(x, y, z, [Math.cos(a) * 7, 0, Math.sin(a) * 7], [Math.cos(a) * 1, lit ? 7 : 2, Math.sin(a) * 1]).d < 1.3) return lit ? 0x5a3a22 : 0x2a2420;
      }
      if (lit && y >= 1 && y < 14) {
        const w = (1 - y / 14) * 4.2 + Math.sin(y * 1.7) * 0.6;
        if (Math.hypot(x + Math.sin(y * 0.9) * 0.8, z) < w) return y < 4 ? EMBER[0] : y < 8 ? EMBER[1] : EMBER[2];
      }
      return null;
    }, (c) => (EMBER.includes(c) ? VF.EMISSIVE : 0));
  } else if (i === 2) {
    // the scorpion tail: five segments curling up, the stinger tip glowing green
    const P = [[0, -12, 0], [-4, -6, 0], [-6, 1, 0], [-4, 8, 0], [1, 12, 0], [6, 10, 0], [7, 5, 0]];
    sdfFill(m, 18, (x, y, z) => {
      for (let k = 0; k < 5; k++) {
        const s = segD(x, y, z, P[k], P[k + 1]);
        const r = 3.6 - k * 0.45 + Math.sin(s.t * Math.PI) * 0.6;
        if (s.d < r) return s.t < 0.12 ? CHI[2] : s.d > r - 0.9 && ((x + y) & 1) ? CHI[1] : CHI[0];
      }
      const s = segD(x, y, z, P[5], P[6]);
      if (s.d < 1.8 - s.t * 1.2) return s.t > 0.7 ? 0x9aff6a : 0x3a7a2a;
      return null;
    }, (c) => (c === 0x9aff6a ? VF.EMISSIVE : 0));
  } else if (i === 3) {
    // a tin lantern on its bail, the flame inside
    sdfFill(m, 16, (x, y, z) => {
      const r = Math.hypot(x, z);
      if (y > -10 && y < -8 && r < 6) return 0x4a4a52;
      if (y >= -8 && y < 4) {
        const ang = Math.atan2(z, x);
        if (r < 5.2 && r > 4.2 && (Math.floor(ang * 2.6) & 1) === 0) return 0x5a5a64;
        if (r < 2.2 && y > -6 && y < 1) return y < -2 ? EMBER[1] : EMBER[0];
        if (r < 4.6 && r > 3.8) return 0xffe0a0;
      }
      if (y >= 4 && y < 8 && r < 6 - (y - 4) * 1.2) return 0x4a4a52;
      if (y >= 8 && y < 13 && Math.abs(Math.hypot(x, y - 8) - 4) < 0.8 && Math.abs(z) < 0.8) return 0x6a6a72;
      return null;
    }, (c) => (c === 0xffe0a0 || EMBER.includes(c) ? VF.EMISSIVE : 0));
  } else if (i === 4) {
    // the father: a robed shadow standing turned away, a staff in his hand
    sdfFill(m, 18, (x, y, z) => {
      if (y < -14 || y > 17) return null;
      const t = (y + 14) / 31;
      const rr = y < 2 ? 4.2 - t * 2 + (1 - t) * 1.6 : y < 10 ? 3.6 : 0;
      if (rr > 0 && ell(x, 0, z, 0, 0, 0, rr * 1.2, 1, rr) < 1) return 0x141218;
      if (ell(x, y, z, 0, 12.5, 0, 2.6, 3, 2.6) < 1) return 0x141218;
      if (ell(x, y, z, 0, 9, -0.5, 5.4, 2.4, 3) < 1) return 0x141218;
      if (segD(x, y, z, [-5.5, -14, 1], [-5, 14, 1]).d < 0.9) return 0x2a2018;
      return null;
    });
  } else {
    // the board: a long driftwood deck with its bindings
    sdfFill(m, 18, (x, y, z) => {
      const e = ell(x, 0, z, 0, 0, 0, 16, 1, 4.6);
      if (e < 1 && y >= -1 && y < 1) return Math.abs(z) > 3.6 ? 0x5a3a22 : (Math.floor(x + z * 0.3) & 3) === 0 ? 0x8a6038 : 0xa47a4a;
      for (const bx of [-6, 6]) if (y >= 1 && y < 3 && Math.abs(x - bx) < 2 && Math.abs(z) < 3.4) return 0x2a2224;
      if (y >= -1 && y < 1 && Math.abs(x - 12) < 2 && Math.abs(z) < 1) return 0xe8b04a;
      return null;
    });
  }
  return m;
}

// ------------------------------------------------------------------ the glass of a shard
const SHARD_VS = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const SHARD_FS = /* glsl */ `
uniform vec3 uCol; uniform float uGlow, uFade, uTime, uSeed;
varying vec3 vN; varying vec3 vV;
void main(){
  vec3 n = normalize(vN), v = normalize(vV);
  float f = 1.0 - abs(dot(n, v));
  float edge = pow(f, 2.2);
  float glint = pow(max(0.0, dot(reflect(-v, n), normalize(vec3(0.4, 0.8, 0.5)))), 24.0);
  float shimmer = 0.75 + 0.25 * sin(uTime * 2.3 + uSeed * 7.0 + dot(n, vec3(5.0, 3.0, 4.0)));
  vec3 col = uCol * (0.14 + edge * 1.5 * shimmer) * (0.7 + uGlow) + vec3(1.0, 0.97, 0.9) * glint * 1.6;
  float a = (0.16 + edge * 0.7 + glint) * uFade;
  gl_FragColor = vec4(col * uFade, a);
}`;

/** an irregular faceted crystal shard (a jagged bipyramid, chipped), height ~1 */
function shardGeo(seed: number) {
  const N = 6 + (seed % 2);
  const r = (k: number) => h3(seed, k, 7);
  const top = new THREE.Vector3((r(1) - 0.5) * 0.18, 0.55 + r(2) * 0.25, (r(3) - 0.5) * 0.12);
  const bot = new THREE.Vector3((r(4) - 0.5) * 0.12, -0.42 - r(5) * 0.18, (r(6) - 0.5) * 0.1);
  const ringA: THREE.Vector3[] = [], ringB: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + r(10 + i) * 0.4;
    const R = 0.17 + r(20 + i) * 0.1;
    ringA.push(new THREE.Vector3(Math.cos(a) * R, 0.12 + r(30 + i) * 0.14, Math.sin(a) * R * 0.75));
    ringB.push(new THREE.Vector3(Math.cos(a + 0.2) * R * 0.85, -0.12 - r(40 + i) * 0.1, Math.sin(a + 0.2) * R * 0.7));
  }
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    tri(top, ringA[j], ringA[i]);
    tri(ringA[i], ringA[j], ringB[i]);
    tri(ringA[j], ringB[j], ringB[i]);
    tri(bot, ringB[i], ringB[j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

type State = 'wait' | 'drift' | 'taken' | 'pour' | 'gone';
interface Shard {
  i: number;
  root: THREE.Group;
  glass: THREE.Mesh;
  inner: THREE.Mesh;
  u: Record<string, THREE.IUniform>;
  state: State;
  t: number;
  orbitA: number;
  orbitR: number;
  orbitY: number;
  depth: number;
  hover: number;
  from: THREE.Vector3;
  spin: number;
}

const COLS = [0xffc070, 0xff9a4a, 0x7affb0, 0xffd890, 0x9ab4ff, 0xc8c0d8, 0xffb060];
const LENS = new THREE.Vector3(0, 0.35, 3.1);
const GLASS_TOP = new THREE.Vector3(0, 1.25, 0);

export class MemoryShards {
  group = new THREE.Group();
  events: MemoryEvent[] = [];
  /** 0..1 the flare that ends the boot (the backstory opens from it) */
  flare = 0;
  private shards: Shard[] = [];
  private mat = makeVoxelMaterial({ emissiveStrength: 1.6 });
  private time = 0;
  private ptr = new THREE.Vector2(9, 9);
  private down = false;
  private ending = false;
  private showing: Shard | null = null;
  private pts: THREE.Points;
  private ptPos: Float32Array;
  private ptLife: Float32Array;
  private ptVel: Float32Array;
  private ptN = 0;
  private light = new THREE.PointLight(0xffc070, 0, 4, 1.5);

  constructor() {
    for (let i = 0; i < MEMORY_LINES.length; i++) {
      const root = new THREE.Group();
      const u = { uCol: { value: new THREE.Color(COLS[i]) }, uGlow: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 }, uSeed: { value: i } };
      const glass = new THREE.Mesh(shardGeo(i * 13 + 5), new THREE.ShaderMaterial({ vertexShader: SHARD_VS, fragmentShader: SHARD_FS, uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      glass.renderOrder = 5;
      const inner = new THREE.Mesh(buildVoxelGeometry(diorama(i), { voxelSize: 0.0105, pivot: 'center' }), this.mat);
      inner.scale.setScalar(0.9);
      root.add(inner, glass);
      root.scale.setScalar(0.0001);
      root.visible = false;
      this.group.add(root);
      const a = (i / MEMORY_LINES.length) * Math.PI * 2 + 0.6;
      this.shards.push({ i, root, glass, inner, u, state: 'wait', t: 0, orbitA: a, orbitR: 1.7 + (i % 3) * 0.35, orbitY: -0.6 + ((i * 5) % 7) * 0.22, depth: -0.4 + ((i * 3) % 4) * 0.3, hover: 0, from: new THREE.Vector3(), spin: (i % 2 ? 1 : -1) * (0.3 + i * 0.05) });
    }
    // light motes: drift off the shards, stream into the glass when one breaks
    const N = 360;
    this.ptPos = new Float32Array(N * 3);
    this.ptLife = new Float32Array(N);
    this.ptVel = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.ptPos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.ptLife, 1));
    this.pts = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uPx: { value: 2 } },
        vertexShader: `attribute float aLife; uniform float uPx; varying float vL; void main(){ vL = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = aLife > 0.0 ? projectionMatrix * mv : vec4(0.0, 0.0, -2.0, 1.0); gl_PointSize = uPx * (aLife > 0.6 ? 2.0 : 1.0); }`,
        fragmentShader: `varying float vL; void main(){ gl_FragColor = vec4(vec3(1.0, 0.82, 0.5) * vL * 1.4, vL); }`,
      })
    );
    this.pts.frustumCulled = false;
    this.group.add(this.pts, this.light);
  }

  setPx(px: number) {
    (this.pts.material as THREE.ShaderMaterial).uniforms.uPx.value = Math.max(1, Math.round(px));
  }

  /** pointer in normalised device coords (-1..1, y up); `down` = pressed */
  pointer(x: number, y: number, down: boolean) {
    this.ptr.set(x, y);
    this.down = down;
  }

  /** take every shard left (the load has finished) */
  end() {
    this.ending = true;
  }

  get taken() {
    return this.shards.filter((s) => s.state !== 'wait' && s.state !== 'drift').length;
  }

  private mote(p: THREE.Vector3, v: THREE.Vector3) {
    const k = this.ptN++ % this.ptLife.length;
    this.ptPos.set([p.x, p.y, p.z], k * 3);
    this.ptVel.set([v.x, v.y, v.z], k * 3);
    this.ptLife[k] = 1;
  }

  private take(s: Shard) {
    if (s.state !== 'drift') return;
    s.state = 'taken';
    s.t = 0;
    s.from.copy(s.root.position);
    this.showing = s;
    this.events.push({ i: s.i, line: MEMORY_LINES[s.i], hold: this.ending ? 0.6 : 1.6 });
  }

  update(dt: number, cam: THREE.PerspectiveCamera, progress: number) {
    this.time += dt;
    const t = this.time;
    const N = this.shards.length;
    const _p = new THREE.Vector3();
    let hoverBest: Shard | null = null, hoverD = 1e9;
    for (const s of this.shards) {
      s.t += dt;
      s.u.uTime.value = t;
      // arrive one by one, out of the dark
      if (s.state === 'wait' && (t > 0.8 + s.i * 1.35 || progress > s.i / (N + 1) || this.ending)) {
        s.state = 'drift';
        s.t = 0;
        s.root.visible = true;
      }
      if (s.state === 'wait' || s.state === 'gone') continue;
      if (s.state === 'drift') {
        const k = Math.min(1, s.t / 2.2);
        const e = 1 - (1 - k) ** 3;
        const a = s.orbitA + t * 0.09 * (s.i % 2 ? 1 : -1);
        const tgt = _p.set(Math.cos(a) * s.orbitR * 1.25, s.orbitY + Math.sin(t * 0.6 + s.i) * 0.08, s.depth + Math.sin(a) * 0.9);
        const far = new THREE.Vector3(Math.cos(s.orbitA) * 7, s.orbitY * 2 + 1, -9);
        s.root.position.copy(far).lerp(tgt, e);
        const sc = 0.42 * e * (1 + s.hover * 0.22);
        s.root.scale.setScalar(Math.max(0.0001, sc));
        s.root.rotation.set(Math.sin(t * 0.4 + s.i) * 0.3, t * s.spin, Math.sin(t * 0.3 + s.i * 2) * 0.2);
        s.u.uFade.value = e;
        s.u.uGlow.value = 0.2 + s.hover * 1.2 + 0.15 * Math.sin(t * 2 + s.i);
        // the pointer finds it
        const ndc = _p.copy(s.root.position).project(cam);
        const d = Math.hypot(ndc.x - this.ptr.x, (ndc.y - this.ptr.y) * (cam.aspect > 1 ? 1 / cam.aspect : 1));
        if (e > 0.6 && d < 0.13 && d < hoverD) {
          hoverD = d;
          hoverBest = s;
        }
        if (Math.random() < dt * 5) this.mote(s.root.position, new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.15 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3));
        // the load takes it by itself in good time
        const due = progress > (s.i + 1) / (N + 1) && s.t > 2.6 && !this.showing;
        if (this.ending || (due && !this.showing)) this.take(s);
      } else if (s.state === 'taken') {
        // up to the lens, the moment inside it lit and turning
        const hold = this.ending ? 0.6 : 1.6;
        const k = Math.min(1, s.t / 0.6);
        const e = 1 - (1 - k) ** 3;
        s.root.position.copy(s.from).lerp(LENS, e);
        s.root.position.y += Math.sin(t * 1.3) * 0.02;
        s.root.scale.setScalar(0.42 + e * 0.5);
        s.root.rotation.set(Math.sin(t * 0.7) * 0.15, s.root.rotation.y + dt * 0.8, 0);
        s.u.uGlow.value = 0.6 + e * 0.8;
        this.light.position.copy(s.root.position);
        this.light.intensity = e * 3;
        this.light.color.setHex(COLS[s.i]);
        if (s.t > hold) {
          s.state = 'pour';
          s.t = 0;
          s.from.copy(s.root.position);
          for (let k2 = 0; k2 < 40; k2++) this.mote(s.root.position, new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2));
        }
      } else if (s.state === 'pour') {
        // it breaks into light that pours into the glass
        const k = Math.min(1, s.t / 0.55);
        s.root.position.copy(s.from).lerp(GLASS_TOP, k * k);
        s.root.scale.setScalar(Math.max(0.0001, 0.92 * (1 - k)));
        s.u.uFade.value = 1 - k;
        this.light.intensity = (1 - k) * 3;
        if (Math.random() < 0.8) this.mote(s.root.position, new THREE.Vector3((Math.random() - 0.5) * 0.4, -0.3, (Math.random() - 0.5) * 0.4));
        if (k >= 1) {
          s.state = 'gone';
          s.root.visible = false;
          if (this.showing === s) this.showing = null;
        }
      }
    }
    for (const s of this.shards) s.hover += ((s === hoverBest ? 1 : 0) - s.hover) * Math.min(1, dt * 8);
    // hovering a moment draws it out; a click takes it at once
    if (hoverBest && !this.showing && (this.down || hoverBest.hover > 0.92)) this.take(hoverBest);
    // the motes
    for (let k = 0; k < this.ptLife.length; k++) {
      if (this.ptLife[k] <= 0) continue;
      this.ptLife[k] -= dt * 0.7;
      const o = k * 3;
      // pulled gently toward the glass
      this.ptVel[o] += (GLASS_TOP.x - this.ptPos[o]) * dt * 0.3;
      this.ptVel[o + 1] += (GLASS_TOP.y - this.ptPos[o + 1]) * dt * 0.3;
      this.ptVel[o + 2] += (GLASS_TOP.z - this.ptPos[o + 2]) * dt * 0.3;
      for (let j = 0; j < 3; j++) {
        this.ptVel[o + j] *= 1 - dt * 0.8;
        this.ptPos[o + j] += this.ptVel[o + j] * dt;
      }
    }
    (this.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.pts.geometry.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    // the end: once every shard is home, the glass flares
    const allHome = this.shards.every((s) => s.state === 'gone');
    this.flare += ((this.ending && allHome ? 1 : 0) - this.flare) * Math.min(1, dt * 2.5);
  }
}

/**
 * The new game's first step (run/NewGame.ts calls it after the boot assets): hold the boot cover while the
 * memories are collected, by hand or by themselves (at least `min` s, at most `max` s, done early once all
 * seven are home). It leaves the cover up: the backstory builds behind it and opens from the glass's flare.
 */
export async function playMemoryPieces(engine: Engine, o: { min?: number; max?: number } = {}): Promise<void> {
  const L = engine.loader as unknown as { collecting?: boolean; gather?: (min: number, max: number) => Promise<void> } | null;
  if (!L?.collecting || !L.gather) return;
  await L.gather(o.min ?? 6, o.max ?? 15);
}
