// Voxel fire and smoke billows for the cinematics.
//
// A billow is a lumpy, cauliflower-shaped shell of voxels (one of a handful of
// noise-sculpted templates, never a plain ball) that swells, rises on its own
// heat, spins slowly and cools: white-hot core voxels glow through yellow,
// orange and blood red into charred brown, then into lit, cel-shaded smoke or
// sand dust that crumbles away voxel by voxel. Explosions are built from many
// of them: a fireball, a mushrooming stem, a ground-hugging dust skirt and late
// soot that keeps rolling up. One instanced draw call for everything.
import * as THREE from 'three';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, ensureInstFx, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { noise, hash3 } from '../../engine/math/rand';

const MAX = 12000;
const GRID = 4;

interface Tpl {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** 0 core .. 1 outer shell */
  shell: Float32Array;
  /** per-voxel random 0..1 */
  n: Float32Array;
  count: number;
  /** cells from the centre to the rim */
  grid: number;
}

function makeTemplate(seed: number, N = GRID): Tpl {
  const xs: number[] = [], ys: number[] = [], zs: number[] = [], sh: number[] = [], ns: number[] = [];
  const shell = N >= 4 ? 0.36 : 0.48;
  for (let gx = -N; gx <= N; gx++)
    for (let gy = -N; gy <= N; gy++)
      for (let gz = -N; gz <= N; gz++) {
        const px = gx / N, py = gy / N, pz = gz / N;
        const d = Math.hypot(px, py * (py < 0 ? 1.25 : 0.95), pz);
        // lumpy cauliflower surface: big lobes plus small knuckles, flatter underside
        const lump = 0.78 + 0.32 * noise.n3(px * 1.4 + seed * 7.13, py * 1.4 + seed * 3.31, pz * 1.4 - seed * 5.77) + 0.12 * noise.n3(px * 3.1 - seed, py * 3.1 + seed * 2, pz * 3.1);
        if (d > lump) continue;
        if (d < lump - shell) continue; // hollow: only the visible shell
        xs.push(px + (hash3(gx, gy, gz + seed * 31) - 0.5) * 0.12);
        ys.push(py + (hash3(gx + 11, gy, gz + seed * 17) - 0.5) * 0.12);
        zs.push(pz + (hash3(gx, gy + 5, gz + seed * 13) - 0.5) * 0.12);
        sh.push(Math.min(1, d / Math.max(0.2, lump)));
        ns.push(hash3(gx * 3 + seed, gy * 5 - seed, gz * 7));
      }
  return { x: new Float32Array(xs), y: new Float32Array(ys), z: new Float32Array(zs), shell: new Float32Array(sh), n: new Float32Array(ns), count: xs.length, grid: N };
}

let TPLS: Tpl[] | null = null;
let TPLS_S: Tpl[] | null = null;
const templates = () => (TPLS ??= Array.from({ length: 8 }, (_, i) => makeTemplate(i + 1)));
/** coarser shells for small puffs (their voxels are tiny anyway) */
const templatesSmall = () => (TPLS_S ??= Array.from({ length: 8 }, (_, i) => makeTemplate(i + 21, 3)));

/** temperature ramp (sRGB), hot to cold */
const RAMP: [number, number][] = [
  [1.0, 0xfff8e0],
  [0.82, 0xffe080],
  [0.66, 0xffae36],
  [0.5, 0xff761c],
  [0.36, 0xe0441a],
  [0.26, 0x9a2410],
  [0.17, 0x4a2218],
  [0.1, 0x2e2622],
];
const RAMP_C = RAMP.map(([k, c]) => [k, new THREE.Color(c)] as const);
const SOOT = new THREE.Color(0x2a2624), SMOKE = new THREE.Color(0x857868), SMOKE_HI = new THREE.Color(0xb8aa96);
const DUST = new THREE.Color(0xc4a070), DUST_HI = new THREE.Color(0xf0dab0);
const _c = new THREE.Color(), _c2 = new THREE.Color();

function ramp(t: number, out: THREE.Color) {
  if (t >= RAMP_C[0][0]) return out.copy(RAMP_C[0][1]);
  for (let i = 1; i < RAMP_C.length; i++) {
    const [k1, c1] = RAMP_C[i];
    if (t >= k1) {
      const [k0, c0] = RAMP_C[i - 1];
      return out.copy(c1).lerp(c0, (t - k1) / (k0 - k1));
    }
  }
  return out.copy(RAMP_C[RAMP_C.length - 1][1]);
}

export interface PuffOpts {
  pos: { x: number; y: number; z: number };
  vel?: { x: number; y: number; z: number };
  /** start / end radius (m) */
  r0: number;
  r1: number;
  /** swell rate */
  grow?: number;
  life: number;
  /** 0..1 starting temperature (0 = cold smoke / dust) */
  heat?: number;
  /** cooling rate */
  cool?: number;
  /** upward acceleration from heat */
  buoy?: number;
  drag?: number;
  /** sand dust instead of smoke once cold */
  dust?: boolean;
  /** 0..1 how sooty-black the smoke is */
  soot?: number;
  delay?: number;
  spin?: number;
}

interface Puff {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  r0: number; r1: number; grow: number;
  age: number; life: number;
  heat: number; cool: number; buoy: number; drag: number;
  dust: boolean; soot: number;
  tpl: Tpl;
  q: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  /** settling early (thin()): seconds since */
  thinT: number;
}

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _o = new THREE.Vector3();

export class Billows {
  mesh: THREE.InstancedMesh;
  private mat: VoxelMaterial;
  private fx: THREE.InstancedBufferAttribute;
  private puffs: Puff[] = [];
  /** ground sampler for the dust skirt (optional) */
  groundAt: ((x: number, z: number) => number) | null = null;

  constructor() {
    const v = new VoxelModel('billow_voxel');
    v.set(0, 0, 0, 0xffffff, VF.EMISSIVE | VF.SOFTAO);
    const geo = buildVoxelGeometry(v, { voxelSize: 1, pivot: [0.5, 0.5, 0.5], ao: 0 });
    this.mat = makeVoxelMaterial({ fog: true, emissiveStrength: 1.5, roughness: 1 });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.fx = ensureInstFx(this.mesh);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  get active() {
    return this.puffs.length > 0;
  }

  spawn(o: PuffOpts) {
    const T = o.r1 < 1.1 ? templatesSmall() : templates();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    if (this.puffs.length > 90) this.puffs.shift();
    this.puffs.push({
      x: o.pos.x, y: o.pos.y, z: o.pos.z,
      vx: o.vel?.x ?? 0, vy: o.vel?.y ?? 0, vz: o.vel?.z ?? 0,
      r0: o.r0, r1: o.r1, grow: o.grow ?? 2.4,
      age: -(o.delay ?? 0), life: o.life,
      heat: o.heat ?? 0, cool: o.cool ?? 1.2, buoy: o.buoy ?? 1.5, drag: o.drag ?? 1.4,
      dust: !!o.dust, soot: o.soot ?? 0.5,
      tpl: T[Math.floor(Math.random() * T.length)],
      q, axis, spin: o.spin ?? 0.35 + Math.random() * 0.4,
      thinT: -1,
    });
  }

  /**
   * A whole explosion: a white-hot fireball, a mushrooming stem, a ring of
   * flame tongues, a dust skirt rolling over the ground and late soot.
   */
  fireball(at: { x: number; y: number; z: number }, r: number, o: { dust?: boolean; soot?: number; stem?: number; delay?: number } = {}) {
    const d0 = o.delay ?? 0;
    const g = at.y;
    const rnd = Math.random;
    // the core: a cluster of lobes (one huge puff would read as a few giant blocks)
    this.spawn({ pos: { x: at.x, y: g + r * 0.35, z: at.z }, vel: { x: 0, y: r * 0.9, z: 0 }, r0: r * 0.2, r1: r * 0.58, grow: 3.4, life: 3.4, heat: 1, cool: 0.85, buoy: 2.2, drag: 1.6, soot: o.soot ?? 0.6, delay: d0 });
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + rnd() * 0.6;
      const cx = Math.cos(a), cz = Math.sin(a);
      this.spawn({ pos: { x: at.x + cx * r * 0.38, y: g + r * (0.25 + rnd() * 0.35), z: at.z + cz * r * 0.38 }, vel: { x: cx * r * 0.7, y: r * (0.7 + rnd() * 0.5), z: cz * r * 0.7 }, r0: r * 0.15, r1: r * (0.4 + rnd() * 0.1), grow: 3.2, life: 3 + rnd() * 0.6, heat: 0.95, cool: 0.95, buoy: 2.2, drag: 1.8, soot: o.soot ?? 0.6, delay: d0 + rnd() * 0.04 });
    }
    // flame tongues thrown outward and up
    const n = 5 + Math.round(r * 0.6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
      const out = r * (1.6 + rnd() * 1.4);
      this.spawn({ pos: { x: at.x + Math.cos(a) * r * 0.25, y: g + r * 0.25, z: at.z + Math.sin(a) * r * 0.25 }, vel: { x: Math.cos(a) * out, y: r * (0.6 + rnd() * 1.4), z: Math.sin(a) * out }, r0: r * 0.16, r1: r * (0.38 + rnd() * 0.2), grow: 3, life: 2.2 + rnd() * 1.2, heat: 0.85 + rnd() * 0.15, cool: 1.3 + rnd() * 0.6, buoy: 1.8, drag: 2.2, soot: o.soot ?? 0.55, delay: d0 + rnd() * 0.06 });
    }
    // the stem and cap: puffs climbing on their own heat
    const stem = o.stem ?? 3;
    for (let i = 0; i < stem; i++)
      this.spawn({ pos: { x: at.x + (rnd() - 0.5) * r * 0.3, y: g + r * 0.4, z: at.z + (rnd() - 0.5) * r * 0.3 }, vel: { x: (rnd() - 0.5) * r * 0.4, y: r * (1.8 + i * 0.5), z: (rnd() - 0.5) * r * 0.4 }, r0: r * 0.25, r1: r * (0.55 + i * 0.12), grow: 2, life: 3.6 + i * 0.4, heat: 0.8 - i * 0.12, cool: 0.9, buoy: 2.4, drag: 1.1, soot: o.soot ?? 0.6, delay: d0 + 0.04 + i * 0.07 });
    // dust skirt rolling over the ground
    const ns = 6 + Math.round(r);
    for (let i = 0; i < ns; i++) {
      const a = (i / ns) * Math.PI * 2 + rnd() * 0.4;
      const sp = r * (2.6 + rnd() * 1.6);
      const x = at.x + Math.cos(a) * r * 0.5, z = at.z + Math.sin(a) * r * 0.5;
      const gy = this.groundAt ? this.groundAt(x, z) : g;
      this.spawn({ pos: { x, y: gy + r * 0.12, z }, vel: { x: Math.cos(a) * sp, y: 0.5, z: Math.sin(a) * sp }, r0: r * 0.08, r1: r * (0.2 + rnd() * 0.12), grow: 1.6, life: 2.4 + rnd() * 1.2, heat: 0.18, cool: 4, buoy: 0.4, drag: 1.5, dust: o.dust ?? true, delay: d0 + 0.05 + rnd() * 0.1 });
    }
    // late soot, rolling up from the fire
    for (let i = 0; i < 2; i++)
      this.spawn({ pos: { x: at.x + (rnd() - 0.5) * r, y: g + r * (0.8 + i * 0.4), z: at.z + (rnd() - 0.5) * r }, vel: { x: (rnd() - 0.5) * 1.5, y: 2 + i, z: (rnd() - 0.5) * 1.5 }, r0: r * 0.4, r1: r * (0.9 + i * 0.15), grow: 1.1, life: 5 + i, heat: 0.3, cool: 2, buoy: 0.6, drag: 0.8, soot: 0.85, delay: d0 + 0.35 + i * 0.25 });
  }

  /** a burning wreck: keeps pumping small flame puffs and smoke (call per frame with dt) */
  smoulder(at: { x: number; y: number; z: number }, r: number, dt: number, rate = 1) {
    if (Math.random() < dt * 9 * rate)
      this.spawn({ pos: { x: at.x + (Math.random() - 0.5) * r, y: at.y + Math.random() * r * 0.4, z: at.z + (Math.random() - 0.5) * r }, vel: { x: 0, y: 1.5 + Math.random() * 1.5, z: 0 }, r0: r * 0.1, r1: r * (0.22 + Math.random() * 0.12), grow: 2.5, life: 1.2 + Math.random() * 0.8, heat: 0.7 + Math.random() * 0.25, cool: 2.2, buoy: 2.5, drag: 1.4, soot: 0.7 });
    if (Math.random() < dt * 3 * rate)
      this.spawn({ pos: { x: at.x + (Math.random() - 0.5) * r * 0.6, y: at.y + r * 0.5, z: at.z + (Math.random() - 0.5) * r * 0.6 }, vel: { x: 0.6, y: 2.2, z: 0.3 }, r0: r * 0.2, r1: r * (0.5 + Math.random() * 0.3), grow: 1, life: 4 + Math.random() * 2, heat: 0.22, cool: 2, buoy: 0.5, drag: 0.6, soot: 0.8 });
  }

  /** the cold dust and smoke within r of a point settles away over ~0.7 s (clears a shot) */
  thin(at: { x: number; y: number; z: number }, r: number) {
    for (const p of this.puffs) {
      if (p.thinT >= 0 || p.age < 0) continue;
      if (p.heat * Math.exp(-p.age * p.cool) > 0.25) continue;
      if (Math.hypot(p.x - at.x, p.z - at.z) < r) p.thinT = 0;
    }
  }

  update(dt: number) {
    const P = this.puffs;
    let i = 0;
    const col = this.mesh.instanceColor!;
    const fx = this.fx;
    for (let k = P.length - 1; k >= 0; k--) {
      const p = P[k];
      p.age += dt;
      if (p.thinT >= 0) p.thinT += dt;
      if (p.age >= p.life || p.thinT > 0.75) P.splice(k, 1);
    }
    for (let pi = P.length - 1; pi >= 0; pi--) {
      const p = P[pi];
      if (p.age < 0) continue;
      const lk = p.age / p.life;
      const heat = p.heat * Math.exp(-p.age * p.cool);
      // buoyancy, drag, travel
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vz *= dr;
      p.vy = p.vy * dr + (p.buoy * (0.25 + heat) - 0.2) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (this.groundAt) {
        const g = this.groundAt(p.x, p.z) + p.r0 * 0.4;
        if (p.y < g) {
          p.y = g;
          if (p.vy < 0) p.vy = 0;
        }
      }
      _q.setFromAxisAngle(p.axis, p.spin * dt);
      p.q.premultiply(_q);
      const R = p.r0 + (p.r1 - p.r0) * (1 - Math.exp(-p.age * p.grow));
      const cell = (R / p.tpl.grid) * 1.12;
      const T = p.tpl;
      // the cold puff crumbles away voxel by voxel over the last part of its life
      const van = Math.max(lk > 0.5 ? (lk - 0.5) / 0.5 : 0, p.thinT >= 0 ? p.thinT / 0.7 : 0);
      for (let j = 0; j < T.count && i < MAX; j++) {
        const nv = T.n[j];
        const keep = nv - van * 1.1;
        if (keep <= 0) continue;
        const shrink = Math.min(1, keep * 6);
        // hot at the heart and the underside, cooling outward and from the top
        let t = heat * (1.2 - 0.62 * T.shell[j]) - T.y[j] * 0.14 * (1 - heat) + (nv - 0.5) * 0.16;
        let emis = -1;
        if (t > 0.2) {
          ramp(t, _c);
          emis = t * t * 8;
        } else {
          // cold: soot to smoke (or sand dust), lighter on the outer lobes and with age
          const lit = Math.min(1, 0.25 + T.shell[j] * 0.45 + nv * 0.3 + lk * 0.35);
          if (p.dust) _c.copy(DUST).lerp(DUST_HI, lit * 0.8);
          else _c.copy(SOOT).lerp(SMOKE, Math.min(1, lit * (1 - p.soot * 0.6) + lk * 0.3)).lerp(SMOKE_HI, Math.max(0, lit - 0.75) * (1 - p.soot));
          // the last embers of the fire still blush the smoke
          if (t > 0.08) _c.lerp(ramp(0.3, _c2), (t - 0.08) * 2.5);
          t = 0;
        }
        _o.set(T.x[j], T.y[j], T.z[j]).applyQuaternion(p.q).multiplyScalar(R);
        _p.set(p.x + _o.x, p.y + _o.y, p.z + _o.z);
        const s = cell * (0.82 + nv * 0.36) * shrink;
        _s.set(s, s, s);
        _m.compose(_p, p.q, _s);
        this.mesh.setMatrixAt(i, _m);
        col.setXYZ(i, _c.r, _c.g, _c.b);
        fx.setXYZW(i, 0, 0, emis, 0);
        i++;
      }
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    col.needsUpdate = true;
    fx.needsUpdate = true;
    this.mesh.visible = i > 0;
  }

  clear() {
    this.puffs.length = 0;
    this.mesh.count = 0;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
