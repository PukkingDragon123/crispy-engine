// Full 3D voxel gold coins: a minted disc with a raised, milled rim, an ankh struck in relief
// on both faces, worn high points and a recessed field, drawn instanced. Coins stand on
// edge and spin about their upright axis, flash a gleam when a face swings toward the
// camera, and bursts (boss hoards, chests) throw real coins that bounce, roll and sink.
import * as THREE from 'three';
import { VoxelModel, VF, mix } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedVoxelMaterial, ensureInstFx } from '../../engine/render/VoxelMaterial';
import { hash3, rnd } from '../../engine/math/rand';
import type { Particles } from './Particles';

const GOLD = { hi: 0xfff0a6, base: 0xf0c048, mid: 0xd49a2a, shade: 0xa8701c, deep: 0x6e4610 };
/** the ankh, rows top to bottom, 9 wide (x = -4..4) */
const ANKH = ['..XXX..', '.X...X.', '.X...X.', '..X.X..', 'XXXXXXX', '...X...', '...X...', '...X...', '..XXX..'];

let geo: THREE.BufferGeometry | null = null;
function coinGeo() {
  if (geo) return geo;
  const m = new VoxelModel('coin');
  const R = 10;
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++) {
      const d = Math.hypot(x, y);
      if (d > R + 0.2) continue;
      const rim = d > R - 2.2;
      const edge = d > R - 1;
      const ang = Math.atan2(y, x);
      // milled edge: a notch every few degrees
      const mill = edge && Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 40) % 2 === 0;
      const lit = y > 3 ? 1 : y < -3 ? -1 : 0;
      for (let z = -2; z <= 2; z++) {
        if (!rim && Math.abs(z) === 2) continue; // recessed field
        let c = rim ? (lit > 0 ? GOLD.hi : lit < 0 ? GOLD.shade : GOLD.base) : lit > 0 ? GOLD.base : lit < 0 ? GOLD.mid : mix(GOLD.base, GOLD.mid, 0.4);
        if (mill) c = mix(c, GOLD.deep, 0.45);
        if (Math.abs(z) === 2 && d > R - 1.2) c = mix(c, GOLD.hi, 0.3);
        c = mix(c, GOLD.mid, (hash3(x, y, z) - 0.5) * 0.25 + 0.05);
        m.set(x, y, z, c, VF.METAL);
      }
    }
  // the ankh in relief on both faces (the field sits at |z| = 1, the relief at |z| = 2)
  for (let j = 0; j < ANKH.length; j++)
    for (let i = 0; i < 7; i++) {
      if (ANKH[j][i] !== 'X') continue;
      const x = i - 3, y = 5 - j;
      for (const z of [-2, 2]) m.set(x, y, z, y > 1 ? GOLD.hi : y < -2 ? GOLD.mid : GOLD.base, VF.METAL);
    }
  // a ring of struck dots inside the rim
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    for (const z of [-2, 2]) m.set(Math.round(Math.cos(a) * 6.6), Math.round(Math.sin(a) * 6.6), z, GOLD.base, VF.METAL);
  }
  geo = buildVoxelGeometry(m, { voxelSize: 1 / 62, pivot: [0.5, 0.5, 0.5] });
  return geo;
}

interface Burst {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  ws: number;
  t: number;
  life: number;
  rest: boolean;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();

class CoinBatch {
  mesh: THREE.InstancedMesh;
  fx: THREE.InstancedBufferAttribute;
  n = 0;
  constructor(parent: THREE.Object3D, cap: number) {
    this.mesh = new THREE.InstancedMesh(coinGeo().clone(), sharedVoxelMaterial, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fx = ensureInstFx(this.mesh);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    parent.add(this.mesh);
  }
  push(x: number, y: number, z: number, spin: number, scale: number, gleam: number, tilt: number) {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    _q.setFromEuler(_e.set(tilt, spin, 0, 'YXZ'));
    _m.compose(_p.set(x, y, z), _q, _s.setScalar(scale));
    this.mesh.setMatrixAt(this.n, _m);
    this.fx.setXYZW(this.n, 0, 0, gleam * 0.9, 0);
    this.n++;
  }
  flush() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fx.needsUpdate = true;
  }
}

export class CoinRender {
  private pick: CoinBatch;
  private loose: CoinBatch;
  private bursts: Burst[] = [];
  private static by = new WeakMap<Particles, CoinRender>();
  static of(p: Particles) {
    let r = CoinRender.by.get(p);
    if (!r) {
      r = new CoinRender(p);
      CoinRender.by.set(p, r);
    }
    return r;
  }

  private constructor(private p: Particles) {
    this.pick = new CoinBatch(p.group, 1000);
    this.loose = new CoinBatch(p.group, 320);
    p.tickers.push((dt) => this.tick(dt));
  }

  /** start a new frame of pickup coins (Pickups calls begin, push..., end) */
  begin() {
    this.pick.n = 0;
  }
  /** a coin on edge at (x, y, z), turned `spin` rad about the vertical, with a 0..1 gleam */
  push(x: number, y: number, z: number, spin: number, scale = 1, gleam = 0, tilt = 0) {
    this.pick.push(x, y, z, spin, scale, gleam, tilt);
  }
  end() {
    this.pick.flush();
  }

  /** a gleam glint off the rim (soft four-point star) */
  glint(x: number, y: number, z: number, k = 1) {
    this.p.emit({ pos: { x, y, z }, count: 1, life: [0.18, 0.26], size: [0.32 * k, 0.04], sprite: 'star4', additive: true, color: [0xfff2c0, 0xffe08a], rot: 0.6, sizeJitter: 0.2 });
  }

  /** a burst of real coins (boss hoards, broken chests): they fly, bounce, roll flat and sink */
  burst(pos: { x: number; y: number; z: number }, n: number) {
    for (let i = 0; i < Math.min(n, 60); i++) {
      if (this.bursts.length > 300) this.bursts.shift();
      const a = rnd.next() * Math.PI * 2, s = 1.5 + rnd.next() * 4;
      this.bursts.push({ x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * s, vy: 5 + rnd.next() * 6, vz: Math.sin(a) * s, spin: rnd.next() * 6, ws: 8 + rnd.next() * 10, t: 0, life: 2.4 + rnd.next() * 1.2, rest: false });
    }
  }

  private tick(dt: number) {
    const L = this.loose;
    if (!this.bursts.length && L.mesh.count === 0) return;
    L.n = 0;
    const g = this.p.groundAt;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      if (b.t > b.life) {
        this.bursts[i] = this.bursts[this.bursts.length - 1];
        this.bursts.pop();
        continue;
      }
      if (!b.rest) {
        b.vy -= 18 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.z += b.vz * dt;
        b.spin += b.ws * dt;
        const gy = g ? g(b.x, b.z) + 0.04 : -1e9;
        if (b.y < gy) {
          b.y = gy;
          if (Math.abs(b.vy) > 2.5) {
            b.vy = -b.vy * 0.42;
            b.vx *= 0.6;
            b.vz *= 0.6;
            if (rnd.chance(0.35)) this.glint(b.x, b.y + 0.15, b.z, 0.6);
          } else b.rest = true;
        }
      }
      const sink = Math.max(0, b.t - (b.life - 0.6)) * 0.5;
      L.push(b.x, b.y + (b.rest ? 0.02 : 0.17) - sink, b.z, b.spin, 1, 0, b.rest ? Math.PI / 2 : 0);
    }
    L.flush();
  }
}
