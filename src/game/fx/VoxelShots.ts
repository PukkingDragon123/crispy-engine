// Voxel projectiles: every bullet, venom glob, arrow, dung ball, needle, stick of dynamite,
// bone, blood drop, cannon ball, seed pod and the hunter's own revolver slugs is a small
// sculpted voxel model, drawn instanced (one draw per kind). Oriented kinds point along
// their velocity; tumbling kinds spin. Users push instances during their update; the
// renderer rides on the Particles group (so it is in whichever scene the particles are)
// and clears itself on frames nobody pushed.
import * as THREE from 'three';
import { VoxelModel, VF, mix, mulRGB } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedVoxelMaterial, ensureInstFx, globalUniforms } from '../../engine/render/VoxelMaterial';
import { hash3 } from '../../engine/math/rand';
import type { Particles } from './Particles';

export type ShotKind = 'bullet' | 'venom' | 'curse' | 'dung' | 'arrow' | 'sand' | 'needle' | 'dynamite' | 'bone' | 'blood' | 'cannon' | 'pod' | 'slug';
/** kinds that fly nose-first; the rest tumble */
const ORIENTED = new Set<ShotKind>(['bullet', 'arrow', 'needle', 'blood', 'slug', 'venom']);
const E = VF.EMISSIVE, G = VF.GLOW, M = VF.METAL;
const vary = (c: number, x: number, y: number, z: number, a = 0.1) => mulRGB(c, 1 + (hash3(x, y, z) - 0.5) * a);

/** a body of revolution along +Z: radius profile r(t), t = 0 tail .. 1 nose */
function lathe(m: VoxelModel, len: number, r: (t: number) => number, col: (x: number, y: number, z: number, t: number, rr: number) => number | null, flags: number = VF.SOLID) {
  for (let z = 0; z < len; z++) {
    const t = (z + 0.5) / len, R = r(t);
    const C = Math.ceil(R);
    for (let x = -C; x <= C; x++)
      for (let y = -C; y <= C; y++) {
        const d = Math.hypot(x, y);
        if (d > R + 0.25) continue;
        const c = col(x, y, z, t, d / Math.max(0.5, R));
        if (c !== null) m.set(x, y, z, c, flags);
      }
  }
}
/** lumpy organic blob (radius r voxels, elongation along z) */
function blob(m: VoxelModel, r: number, ez: number, seed: number, col: (x: number, y: number, z: number, k: number) => number, flags?: (k: number) => number) {
  const R = Math.ceil(r * Math.max(1, ez)) + 2;
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++)
      for (let z = -R; z <= R; z++) {
        const d = Math.hypot(x / r, y / r, z / (r * ez));
        const lump = (hash3(Math.floor((x + 40) / 2) + seed, Math.floor((y + 40) / 2), Math.floor((z + 40) / 2)) - 0.5) * 0.28;
        if (d > 1 + lump) continue;
        const k = 1 - d;
        m.set(x, y, z, col(x, y, z, k), flags ? flags(k) : VF.SOLID);
      }
}

function model(kind: ShotKind): { m: VoxelModel; vs: number } {
  const m = new VoxelModel('shot_' + kind);
  switch (kind) {
    case 'bullet': {
      // a fat lead slug with a copper driving band and a heat-glowing base (reads at speed)
      lathe(m, 16, (t) => (t < 0.62 ? 4.2 : 4.2 * Math.sqrt(Math.max(0, 1 - ((t - 0.62) / 0.4) ** 2)) + 0.4), (x, y, z, t, rr) => {
        if (t < 0.14) return mix(0xffb050, 0xff7020, rr);
        if (t > 0.3 && t < 0.4) return y > 1 ? 0xe0925a : 0xb5683a;
        const base = y > 1.5 ? 0xc6cbd2 : y < -1.5 ? 0x5d626b : 0x8f949c;
        return vary(base, x, y, z, 0.08);
      });
      for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) if (Math.hypot(x, y) < 3.6) m.set(x, y, 0, 0xffd080, E | G);
      return { m, vs: 1 / 60 };
    }
    case 'slug': {
      lathe(m, 12, (t) => (t < 0.6 ? 2.6 : 2.6 * Math.sqrt(Math.max(0, 1 - ((t - 0.6) / 0.42) ** 2)) + 0.3), (x, y, z, t) => (t < 0.16 ? 0xffc070 : vary(y > 0 ? 0xf2c060 : 0xb8862e, x, y, z, 0.06)), M);
      for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) if (Math.hypot(x, y) < 2.4) m.set(x, y, 0, 0xffe2a0, E | G);
      return { m, vs: 1 / 70 };
    }
    case 'venom': {
      // a quivering glob of venom: glossy skin, a bright sickly core, a dragging drip tail
      blob(m, 6.5, 1.15, 3, (x, y, z, k) => (k > 0.55 ? 0xd8ff70 : y > 2 ? 0xa8f04a : k < 0.15 ? 0x2f8a22 : vary(0x6ccf34, x, y, z, 0.14)), (k) => (k > 0.45 ? E : VF.SOLID));
      for (let i = 0; i < 7; i++) m.set(0, -1 - (i % 2), -7 - i, i < 4 ? 0x6ccf34 : 0x3f9a28);
      m.set(-2, 3, 3, 0xf4ffd8, E);
      return { m, vs: 1 / 48 };
    }
    case 'curse': {
      // a little cursed skull trailing violet: dome, cheekbones, dark sockets, ember eyes, teeth
      blob(m, 6, 1, 9, (x, y, z) => (y > 3 ? 0xeedcff : y < -2 ? 0x9a78c8 : vary(0xd2b6f2, x, y, z, 0.08)));
      for (const sx of [-2.5, 2.5])
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            m.del(Math.round(sx + dx), dy, 6);
            m.set(Math.round(sx + dx), dy, 5, 0x2a1840);
          }
      m.set(-2, 0, 5, 0xe090ff, E | G).set(3, 0, 5, 0xe090ff, E | G);
      for (let x = -3; x <= 3; x++) m.set(x, -4, 5, x % 2 ? 0xf6eaff : 0x4a2c66);
      m.del(0, -1, 6).set(0, -1, 5, 0x2a1840);
      return { m, vs: 1 / 40 };
    }
    case 'dung': {
      blob(m, 7, 1, 21, (x, y, z, k) => (hash3(x, y, z) > 0.86 ? 0x3a2412 : y > 3 ? 0x9a6a3a : vary(0x6a4626, x, y, z, 0.2)));
      // straw bits poking out
      for (let i = 0; i < 6; i++) {
        const a = i * 1.7, b = i * 0.9;
        for (let s = 5; s < 9; s++) m.set(Math.round(Math.cos(a) * Math.cos(b) * s), Math.round(Math.sin(b) * s), Math.round(Math.sin(a) * Math.cos(b) * s), s > 7 ? 0xe6c886 : 0xc8a060);
      }
      return { m, vs: 1 / 40 };
    }
    case 'arrow': {
      // reed shaft, sinew wraps, a forged iron broadhead, three barred feather vanes and a nock
      const L = 46;
      for (let z = 0; z < L; z++)
        for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) m.set(x, y, z, (z % 9 === 0 && z > 6 && z < 38) ? 0x6a4a2a : vary(y ? 0xd2b48c : 0xa88a62, x, y, z, 0.1));
      for (let z = 0; z < 9; z++) {
        const w = Math.round((9 - z) * 0.45);
        for (let x = -w; x <= w + 1; x++) m.set(x, 0, L + z, z > 6 ? 0xd8dde2 : x === -w || x === w + 1 ? 0xe4e8ec : 0x80878e, M), m.set(x, 1, L + z, 0x9aa0a6, M);
      }
      for (let z = 1; z < 12; z++) {
        const h = z < 3 ? z : z > 9 ? 12 - z : 3;
        for (let k = 1; k <= h + 1; k++) {
          const c = z % 4 < 2 ? 0xb03a2a : 0xf0e6d2;
          m.set(0, 1 + k, z, c).set(-k, -k + 1, z, c).set(1 + k, -k + 1, z, mulRGB(c, 0.85));
        }
      }
      m.set(0, 0, -1, 0x3a2614).set(1, 1, -1, 0x3a2614);
      return { m, vs: 1 / 56 };
    }
    case 'sand': {
      for (let i = 0; i < 4; i++) {
        const ox = [0, 4, -3, 1][i], oy = [0, 2, 1, -3][i], oz = [0, -2, 3, 2][i];
        const r = [4.5, 3, 3.2, 2.6][i];
        for (let x = -5; x <= 5; x++)
          for (let y = -5; y <= 5; y++)
            for (let z = -5; z <= 5; z++) if (Math.hypot(x, y, z) < r + (hash3(x + i * 9, y, z) - 0.5) * 0.9) m.set(ox + x, oy + y, oz + z, y + oy > 2 ? 0xf0d29a : vary(i % 2 ? 0xc49a68 : 0xd9b276, x, y, z, 0.16));
      }
      return { m, vs: 1 / 36 };
    }
    case 'needle': {
      lathe(m, 26, (t) => 1.3 * (1 - t) + 0.25, (x, y, z, t) => (t > 0.85 ? 0x5a3a20 : t < 0.12 ? 0x8a6a3a : y > 0 ? 0xf4ecc8 : 0xd8c89a));
      return { m, vs: 1 / 64 };
    }
    case 'dynamite': {
      // a sweating red paper stick, a printed band, a twisted fuse with a live spark
      for (let z = 0; z < 20; z++)
        for (let x = -3; x <= 3; x++)
          for (let y = -3; y <= 3; y++) {
            if (Math.hypot(x, y) > 3.3) continue;
            const band = z > 7 && z < 12;
            m.set(x, y, z, band ? (y > 1 ? 0xf0e2c0 : 0xc8b890) : z === 0 || z === 19 ? 0x7a1a12 : vary(y > 1 ? 0xe0483a : 0xb8281e, x, y, z, 0.08));
          }
      for (let z = 20; z < 25; z++) m.set(z % 2, (z - 20) >> 1, z, 0x5a4a3a);
      m.set(0, 2, 25, 0xfff0a0, E | G).set(1, 2, 25, 0xffa040, E | G);
      return { m, vs: 1 / 48 };
    }
    case 'bone': {
      lathe(m, 22, (t) => 1.6 + Math.pow(Math.abs(t - 0.5) * 2, 6) * 1.5, (x, y, z) => vary(y > 0 ? 0xf6e6c4 : 0xd6b78a, x, y, z, 0.06));
      for (const [z, dx] of [[0, -2], [0, 2], [21, -2], [21, 2]]) for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let k = 0; k < 2; k++) m.set(dx + x, y, z + (z ? k : -k), y > 0 ? 0xfff1d6 : 0xe2c8a0);
      return { m, vs: 1 / 48 };
    }
    case 'blood': {
      lathe(m, 12, (t) => 3.2 * Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.7)))) + 0.3, (x, y, z, t) => (y > 1 && t > 0.5 ? 0xe84a3a : vary(0xa0140e, x, y, z, 0.1)));
      m.set(-1, 2, 8, 0xffb0a0, E);
      return { m, vs: 1 / 48 };
    }
    case 'cannon': {
      // cast iron shot: the mould seam, pitting, flaking rust and a smouldering powder smear
      for (let x = -13; x <= 13; x++)
        for (let y = -13; y <= 13; y++)
          for (let z = -13; z <= 13; z++) {
            const d = Math.hypot(x, y, z);
            if (d > 13.2) continue;
            if (d > 12.2 && hash3(x, y, z) > 0.9) continue; // pits
            let c = y > 6 ? 0x6a6e78 : y < -6 ? 0x2c2e34 : 0x45484f;
            if (Math.abs(y) < 0.6) c = 0x7c808a; // seam
            const rust = hash3(Math.floor(x / 3), Math.floor(y / 3), Math.floor(z / 3));
            if (rust > 0.8) c = mix(c, 0x8a4a2a, 0.55);
            m.set(x, y, z, vary(c, x, y, z, 0.1), M);
          }
      return { m, vs: 1 / 32 };
    }
    case 'pod': {
      // a curled acacia seed pod: leathery, seed bumps down its length, a dry stalk
      for (let i = 0; i < 26; i++) {
        const t = i / 25, a = t * 2.2 - 1.1;
        const cx = Math.sin(a) * 9, cz = Math.cos(a) * 9 - 9 + i * 0.6;
        const w = 2.4 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)) + 0.6;
        for (let x = -1; x <= 1; x++)
          for (let y = -Math.ceil(w); y <= Math.ceil(w); y++) {
            if (Math.abs(y) > w) continue;
            const seed = i % 4 === 1 && Math.abs(y) < 1.2;
            m.set(Math.round(cx + x * Math.cos(a)), y, Math.round(cz - x * Math.sin(a) + (seed ? 0 : 0)), seed ? 0x7a4a1e : Math.abs(y) > w - 0.8 ? 0x5a3416 : vary(y > 0 ? 0xb07a3e : 0x8a5a2a, i, y, x, 0.12));
            if (seed) m.set(Math.round(cx + 2 * Math.cos(a)), y, Math.round(cz - 2 * Math.sin(a)), 0x9a6230);
          }
      }
      for (let k = 0; k < 4; k++) m.set(Math.round(Math.sin(-1.1) * 9) - k, 0, -1 - k, 0x6a5a3a);
      return { m, vs: 1 / 48 };
    }
  }
}

interface Batch {
  mesh: THREE.InstancedMesh;
  fx: THREE.InstancedBufferAttribute;
  n: number;
  cap: number;
  spin: boolean;
}
interface Flight {
  kind: ShotKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  life: number;
  scale: number;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _d = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, 1);
const _e = new THREE.Euler();
const _c = new THREE.Color();
const geoCache = new Map<ShotKind, THREE.BufferGeometry>();

export class VoxelShots {
  group = new THREE.Group();
  private batches = new Map<ShotKind, Batch>();
  private frame = -1;
  private flights: Flight[] = [];
  private static by = new WeakMap<Particles, VoxelShots>();
  /** the shared renderer of a particle system (created on first use) */
  static of(p: Particles) {
    let s = VoxelShots.by.get(p);
    if (!s) {
      s = new VoxelShots();
      VoxelShots.by.set(p, s);
      p.group.add(s.group);
      p.tickers.push((dt) => s!.tick(dt));
    }
    return s;
  }

  private batch(kind: ShotKind) {
    let b = this.batches.get(kind);
    if (b) return b;
    let geo = geoCache.get(kind);
    if (!geo) {
      const { m, vs } = model(kind);
      const bb = m.bounds();
      geo = buildVoxelGeometry(m, { voxelSize: vs, pivot: [(bb.minX + bb.maxX + 1) / 2, (bb.minY + bb.maxY + 1) / 2, (bb.minZ + bb.maxZ + 1) / 2] });
      geoCache.set(kind, geo);
    }
    const cap = kind === 'bullet' || kind === 'blood' ? 1200 : kind === 'slug' ? 200 : 400;
    const mesh = new THREE.InstancedMesh(geo.clone(), sharedVoxelMaterial, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, _c.setRGB(1, 1, 1));
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    const fx = ensureInstFx(mesh);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = kind === 'cannon' || kind === 'dynamite';
    mesh.receiveShadow = false;
    this.group.add(mesh);
    b = { mesh, fx, n: 0, cap, spin: !ORIENTED.has(kind) };
    this.batches.set(kind, b);
    return b;
  }

  private sync() {
    const f = globalUniforms.uTime.value;
    if (f !== this.frame) {
      this.frame = f;
      for (const b of this.batches.values()) b.n = 0;
    }
  }

  /** draw one projectile this frame: oriented kinds point along (vx, vy, vz); tumbling ones use `spin` */
  push(kind: ShotKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, spin = 0, scale = 1, tint?: number, glow = 0) {
    this.sync();
    const b = this.batch(kind);
    if (b.n >= b.cap) return;
    _p.set(x, y, z);
    if (b.spin) _q.setFromEuler(_e.set(spin * 1.3, spin, spin * 0.7));
    else {
      _d.set(vx, vy, vz);
      const l = _d.length();
      if (l > 1e-4) _q.setFromUnitVectors(FWD, _d.multiplyScalar(1 / l));
      else _q.identity();
    }
    _m.compose(_p, _q, _s.setScalar(scale));
    b.mesh.setMatrixAt(b.n, _m);
    b.mesh.setColorAt(b.n, tint === undefined ? _c.setRGB(1, 1, 1) : _c.setHex(tint));
    b.fx.setXYZW(b.n, 0, 0, glow, 0);
    b.n++;
    b.mesh.count = b.n;
    b.mesh.instanceMatrix.needsUpdate = true;
    b.mesh.instanceColor!.needsUpdate = true;
    b.fx.needsUpdate = true;
  }

  /** a free-flying shot (the hunter's slugs riding their tracer): straight line, dies after `life` s */
  fly(kind: ShotKind, from: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }, life: number, scale = 1) {
    if (this.flights.length > 160) this.flights.shift();
    this.flights.push({ kind, x: from.x, y: from.y, z: from.z, vx: vel.x, vy: vel.y, vz: vel.z, t: 0, life, scale });
  }

  private tick(dt: number) {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      if (f.t >= f.life) {
        this.flights[i] = this.flights[this.flights.length - 1];
        this.flights.pop();
        continue;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      this.push(f.kind, f.x, f.y, f.z, f.vx, f.vy, f.vz, 0, f.scale, undefined, 0.6);
    }
    // nobody has drawn yet this frame: hide last frame's shots (later pushes this frame redraw them)
    if (globalUniforms.uTime.value !== this.frame)
      for (const b of this.batches.values()) {
        b.n = 0;
        b.mesh.count = 0;
      }
  }
}
