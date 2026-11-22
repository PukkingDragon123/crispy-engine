// The living world on a run: angry trees and water physics.
//  - Angry trees: shoot an ornery tree and it shudders awake (leaves rain off), then
//    defends itself: close up it winds back and lashes its crown down at you (and any
//    enemy in reach), further out it lobs voxel seed pods. It calms after a while unpunished,
//    or after a beating goes dormant, shedding leaves.
//  - Water: the hunter and every enemy splash when they enter water, throw spray and
//    leave expanding ripple rings / wakes while they move (WaterFx ripples on the pools and
//    lakes, the river's own wake field on the Nile), and a few buoyant props (lotus,
//    drifting palm logs) bob on the ripples and get shoved aside by whoever wades by.
// Self-registering: RunScene constructs it once; it ticks on the engine's after-update hook
// and removes itself when its world is disposed.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import { Trees, type TreeRef, SLOTS } from './Trees';
import { VoxelShots } from '../fx/VoxelShots';
import { addRipple, rippleHeight } from './WaterFx';
import { VoxelModel, mix } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedVoxelMaterial, ensureInstFx } from '../../engine/render/VoxelMaterial';
import { hash3, rnd } from '../../engine/math/rand';

interface PlayerLike {
  pos: THREE.Vector3;
  alive: boolean;
  board?: { vel: THREE.Vector3 };
  takeHit(hit: any, from?: THREE.Vector3): number;
}

interface Angry {
  t: TreeRef;
  state: 'wake' | 'idle' | 'windup' | 'strike' | 'calm';
  timer: number;
  calm: number;
  hits: number;
  lean: THREE.Vector2;
  leanT: THREE.Vector2;
  shake: number;
  target: THREE.Vector3;
}
interface Pod {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  life: number;
}
interface Body {
  wet: boolean;
  t: number;
  px: number;
  pz: number;
}
interface Floater {
  kind: 0 | 1;
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  wy: number;
  level: number;
  cx: number;
  cz: number;
  r: number;
  ph: number;
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);

function lotus(): VoxelModel {
  const m = new VoxelModel('lotus');
  // the pad: a round leaf with its slit, raised veins and a curled rim
  for (let x = -9; x <= 9; x++)
    for (let z = -9; z <= 9; z++) {
      const d = Math.hypot(x, z), a = Math.atan2(z, x);
      if (d > 9.2 || (Math.abs(a) < 0.18 && d > 1.5)) continue;
      const vein = Math.abs(Math.sin(a * 5)) < 0.12 && d > 2;
      m.set(x, d > 8.4 ? 1 : 0, z, vein ? 0x6aa848 : d > 8.4 ? 0x2c6a2a : mix(0x3f8a38, 0x58a040, hash3(x, 0, z) * 0.6));
    }
  // the blossom: three rings of pointed petals, pink to white, a gold heart
  for (let ring = 0; ring < 3; ring++) {
    const n = 6 + ring * 2, len = 5 - ring * 1.2, up = 1.2 + ring * 0.8;
    for (let p = 0; p < n; p++) {
      const a = (p / n) * Math.PI * 2 + ring * 0.4;
      for (let s = 0; s <= len; s++) {
        const k = s / len;
        const y = 1 + Math.round(up * s * 0.8 + k * k * 2);
        m.set(Math.round(Math.cos(a) * s * 0.8), y, Math.round(Math.sin(a) * s * 0.8), k > 0.7 ? 0xfff0f4 : ring === 2 ? 0xf8c8d8 : mix(0xe0709a, 0xf4a8c4, k));
      }
    }
  }
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) m.set(x, 2, z, 0xf0c040);
  return m;
}
function driftLog(): VoxelModel {
  const m = new VoxelModel('log');
  for (let z = -24; z <= 24; z++)
    for (let x = -4; x <= 4; x++)
      for (let y = -4; y <= 4; y++) {
        const d = Math.hypot(x, y);
        if (d > 3.8 + Math.sin(z * 0.4) * 0.3) continue;
        const ring = z % 5 === 0;
        m.set(x, y, z, Math.abs(z) > 23 ? 0xc8a670 : ring ? 0x4a3420 : y > 1 ? 0x8a6a44 : mix(0x6a4e30, 0x5a4028, hash3(x, y, z)));
      }
  // a leaf stub and frayed fibres at one end
  for (let k = 0; k < 6; k++) m.set(k - 2, 4, 20 + (k % 2), 0x5a7a34);
  return m;
}

export class WorldLife {
  private trees: Trees | null = null;
  private angry: Angry[] = [];
  private pods: Pod[] = [];
  private bodies = new Map<object, Body>();
  private floaters: Floater[] = [];
  private floatMesh: THREE.InstancedMesh[] = [];
  private off: (() => void)[] = [];
  private hook = (dt: number) => this.update(dt);
  private shots: VoxelShots;

  constructor(private ctx: Ctx, private player: () => PlayerLike) {
    this.shots = VoxelShots.of(ctx.particles);
    ctx.engine.onAfterUpdate.push(this.hook);
    this.off.push(ctx.events.on('propShot', (c: any, p: THREE.Vector3) => c?.data?.tree && this.hitTree(c.data.tree as TreeRef, p)));
    this.off.push(ctx.events.on('explosion', (p: { x: number; y: number; z: number }, r: number) => {
      const T = this.trees;
      if (T) for (const t of T.list) if (Math.hypot(t.x - p.x, t.z - p.z) < r + 1.5) this.hitTree(t, _v.set(t.x, t.y + 2, t.z));
      this.splashAt(p.x, p.z, r * 0.6);
    }));
    this.spawnFloaters();
  }

  private dispose() {
    const h = this.ctx.engine.onAfterUpdate;
    const i = h.indexOf(this.hook);
    if (i >= 0) h.splice(i, 1);
    for (const f of this.off) f();
    for (const m of this.floatMesh) m.removeFromParent();
  }

  // ------------------------------------------------------------------ angry trees
  private hitTree(t: TreeRef, at: THREE.Vector3) {
    const T = this.trees;
    if (!T) return;
    const P = this.ctx.particles;
    // leaves and bark fly off every hit
    P.emit({ pos: { x: at.x, y: at.y, z: at.z }, count: 6, spread: 2.2, up: 1.5, life: [0.5, 1.1], size: [0.06, 0.04], sprite: 'woodchip', gravity: 12, ground: true, bounce: 0.2 });
    P.emit({ pos: { x: t.x, y: t.y + t.h * 0.85, z: t.z }, count: 8, spread: 1.4, jitter: t.h * 0.25, life: [1.2, 2.4], size: [0.09, 0.07], sprite: 'twig', color: [0x5a8a3a, 0x7aa848, 0x8a9a5a], gravity: 2.2, drag: 2.2, rot: 6, rotSpeed: 5 });
    let a = this.angry.find((q) => q.t === t);
    if (!a) {
      const used = new Set(this.angry.map((q) => q.t.slot));
      let slot = -1;
      for (let s = 0; s < SLOTS; s++) if (!used.has(s)) { slot = s; break; }
      if (slot < 0) return;
      T.setSlot(t, slot);
      a = { t, state: t.ornery ? 'wake' : 'calm', timer: t.ornery ? 0.9 : 0.8, calm: 14, hits: 0, lean: new THREE.Vector2(), leanT: new THREE.Vector2(), shake: 0.35, target: new THREE.Vector3() };
      this.angry.push(a);
      if (t.ornery) this.ctx.sfx('whoosh_big', { x: t.x, y: t.y + 2, z: t.z }, 0.6, 0.55);
    }
    a.hits++;
    a.calm = 14;
    a.shake = Math.max(a.shake, 0.18);
    // a beating sends it back to sleep, shedding its leaves
    if (a.t.ornery && a.hits >= 9) {
      a.t.ornery = false;
      a.state = 'calm';
      a.timer = 1.6;
      P.emit({ pos: { x: t.x, y: t.y + t.h * 0.8, z: t.z }, count: 30, spread: 2, jitter: t.h * 0.35, life: [1.6, 3], size: [0.1, 0.08], sprite: 'twig', color: [0x8a7a3a, 0x6a8a3a, 0xa08a48], gravity: 1.8, drag: 2.4, rot: 6, rotSpeed: 4 });
    }
  }

  private stepTrees(dt: number) {
    const T = this.trees;
    if (!T) return;
    const pl = this.player();
    const ctx = this.ctx;
    for (let i = this.angry.length - 1; i >= 0; i--) {
      const a = this.angry[i];
      const t = a.t;
      a.timer -= dt;
      a.calm -= dt;
      const dx = pl.pos.x - t.x, dz = pl.pos.z - t.z, d = Math.hypot(dx, dz) || 1;
      const reach = 2.6 + t.h * 0.45;
      if (a.calm <= 0 && a.state !== 'calm') {
        a.state = 'calm';
        a.timer = 1.2;
      }
      switch (a.state) {
        case 'wake':
          // shaking itself awake, crown thrashing
          a.shake = 0.32 * Math.min(1, a.timer + 0.3);
          a.leanT.set(Math.sin(a.timer * 9) * 0.4, Math.cos(a.timer * 7) * 0.4);
          if (rnd.chance(dt * 18)) ctx.particles.emit({ pos: { x: t.x, y: t.y + t.h * 0.85, z: t.z }, count: 2, spread: 1.6, jitter: t.h * 0.3, life: [1, 2], size: [0.09, 0.07], sprite: 'twig', color: [0x5a8a3a, 0x7aa848], gravity: 2, drag: 2, rot: 6, rotSpeed: 5 });
          if (a.timer <= 0) {
            a.state = 'idle';
            a.timer = 0.4;
          }
          break;
        case 'idle':
          a.shake = 0.04;
          a.leanT.set(0, 0);
          if (a.timer <= 0 && pl.alive) {
            if (d < reach + 1.2) {
              a.state = 'windup';
              a.timer = 0.42;
              a.target.copy(pl.pos);
            } else if (d < 30) {
              this.throwPods(t, pl.pos, pl.board?.vel);
              a.timer = 1.7 + rnd.next() * 0.8;
            } else a.timer = 0.6;
          }
          break;
        case 'windup':
          // rear back away from the target...
          a.leanT.set((-dx / d) * t.h * 0.22, (-dz / d) * t.h * 0.22);
          a.shake = 0.08;
          if (a.timer <= 0) {
            a.state = 'strike';
            a.timer = 0.22;
            ctx.sfx('whoosh_big', { x: t.x, y: t.y + t.h * 0.7, z: t.z }, 0.8, 0.7);
          }
          break;
        case 'strike': {
          // ...and whip the crown down at it
          const ux = (a.target.x - t.x) / (Math.hypot(a.target.x - t.x, a.target.z - t.z) || 1), uz = (a.target.z - t.z) / (Math.hypot(a.target.x - t.x, a.target.z - t.z) || 1);
          a.leanT.set(ux * t.h * 0.48, uz * t.h * 0.48);
          if (a.timer <= 0.12 && a.timer + dt > 0.12) {
            const hx = t.x + ux * reach * 0.85, hz = t.z + uz * reach * 0.85;
            if (pl.alive && Math.hypot(pl.pos.x - hx, pl.pos.z - hz) < 2.2) pl.takeHit({ base: 16, kind: 'phys', source: 'melee', knock: 9, dirX: ux, dirZ: uz }, _v.set(t.x, t.y + 1, t.z));
            ctx.enemies?.inRadius(_w.set(hx, t.y + 1, hz), 2.4, (e) => ctx.enemies.damage(e, { base: 40, kind: 'phys', source: 'melee', knock: 8, dirX: ux, dirZ: uz }, _w.clone(), new THREE.Vector3(ux, 0, uz)));
            ctx.fx.dust({ x: hx, y: ctx.world.groundAt(hx, hz) + 0.2, z: hz }, 1.1, undefined, 5);
            ctx.shake(0.18);
          }
          if (a.timer <= 0) {
            a.state = 'idle';
            a.timer = 1.4 + rnd.next() * 0.7;
          }
          break;
        }
        case 'calm':
          a.shake *= Math.exp(-dt * 3);
          a.leanT.set(0, 0);
          if (a.timer <= 0 && a.lean.lengthSq() < 0.002) {
            if (t.slot >= 0) T.uShake.value[t.slot].set(0, 0, 0, 0);
            T.setSlot(t, -1);
            this.angry.splice(i, 1);
            continue;
          }
          break;
      }
      // the crown springs toward its target lean
      const k = a.state === 'strike' ? 28 : 7;
      a.lean.x += (a.leanT.x - a.lean.x) * Math.min(1, dt * k);
      a.lean.y += (a.leanT.y - a.lean.y) * Math.min(1, dt * k);
      if (t.slot >= 0) T.uShake.value[t.slot].set(a.lean.x, a.lean.y, a.shake, 0);
    }
  }

  private throwPods(t: TreeRef, at: THREE.Vector3, vel?: THREE.Vector3) {
    const n = 2 + Math.floor(rnd.next() * 2);
    for (let i = 0; i < n; i++) {
      const T = 0.9 + rnd.next() * 0.3;
      const tx = at.x + (vel?.x ?? 0) * T * 0.6 + (rnd.next() - 0.5) * 2.4, tz = at.z + (vel?.z ?? 0) * T * 0.6 + (rnd.next() - 0.5) * 2.4;
      const sx = t.x, sy = t.y + t.h * 0.85, sz = t.z;
      const ty = this.ctx.world.groundAt(tx, tz) + 0.8;
      this.pods.push({ x: sx, y: sy, z: sz, vx: (tx - sx) / T, vy: (ty - sy) / T + 0.5 * 16 * T, vz: (tz - sz) / T, spin: rnd.next() * 6, life: 4 });
    }
    this.ctx.sfx('whoosh', { x: t.x, y: t.y + t.h, z: t.z }, 0.5, 0.8);
  }

  private stepPods(dt: number) {
    const pl = this.player();
    const ctx = this.ctx;
    for (let i = this.pods.length - 1; i >= 0; i--) {
      const p = this.pods[i];
      p.vy -= 16 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.spin += dt * 9;
      p.life -= dt;
      let dead = p.life <= 0;
      if (pl.alive && Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z) < 0.8 && Math.abs(pl.pos.y + 1 - p.y) < 1.2) {
        pl.takeHit({ base: 9, kind: 'phys', source: 'projectile', knock: 3 }, _v.set(p.x - p.vx * 0.05, p.y, p.z - p.vz * 0.05));
        dead = true;
      }
      const g = ctx.world.groundAt(p.x, p.z);
      if (p.y < g + 0.1) dead = true;
      if (dead) {
        // the pod bursts: seeds and dry husk
        ctx.particles.emit({ pos: { x: p.x, y: Math.max(g + 0.1, p.y), z: p.z }, count: 9, spread: 3, up: 2.5, life: [0.5, 1], size: [0.06, 0.04], sprite: 'pebble', color: [0x7a4a1e, 0x9a6230, 0x5a3416], gravity: 14, ground: true, bounce: 0.3 });
        ctx.fx.dust({ x: p.x, y: g + 0.1, z: p.z }, 0.5, undefined, 2);
        ctx.sfx('crate_break', { x: p.x, y: p.y, z: p.z }, 0.25, 1.6);
        this.pods[i] = this.pods[this.pods.length - 1];
        this.pods.pop();
        continue;
      }
      this.shots.push('pod', p.x, p.y, p.z, p.vx, p.vy, p.vz, p.spin, 1.25);
    }
  }

  // ------------------------------------------------------------------ water
  private splashAt(x: number, z: number, k: number) {
    const w = this.ctx.world.waterAt(x, z);
    if (w === null) return;
    this.ctx.fx.waterSplash({ x, y: w + 0.05, z }, Math.min(3, k));
    addRipple(x, z, Math.min(2, k));
  }

  private stepBody(key: object, x: number, y: number, z: number, vx: number, vz: number, size: number, dt: number) {
    const world = this.ctx.world;
    const w = world.waterAt(x, z);
    let b = this.bodies.get(key);
    if (!b) this.bodies.set(key, (b = { wet: false, t: 0, px: x, pz: z }));
    const inW = w !== null && y < w + 0.45;
    const sp = Math.hypot(vx, vz);
    if (inW && !b.wet) {
      // entering the water: a crown of drops and a ring, bigger the faster it came in
      this.ctx.fx.waterSplash({ x, y: w! + 0.05, z }, Math.min(3, 0.6 + sp * 0.12 + size * 0.4), { x: vx, y: 0, z: vz });
      addRipple(x, z, Math.min(2, 0.6 + sp * 0.1 + size * 0.3));
      this.ctx.sfx('whoosh', { x, y: w!, z }, 0.3, 1.6);
    }
    b.wet = inW;
    if (inW && sp > 0.6) {
      b.t -= dt;
      if (b.t <= 0) {
        // wake: rings laid down along the path open into a V behind a fast body
        b.t = Math.max(0.07, 0.22 - sp * 0.008);
        addRipple(x, z, Math.min(1.4, 0.25 + sp * 0.05) * (0.7 + size * 0.3));
        if (world.river) world.river.wake(x, z, vx, vz, Math.min(1.5, size));
      }
      if (rnd.chance(dt * (4 + sp * 1.5))) this.ctx.fx.waterSpray({ x: x - vx * 0.03, y: w! + 0.06, z: z - vz * 0.03 }, { x: vx, y: 0, z: vz }, sp);
    }
    b.px = x;
    b.pz = z;
    return inW;
  }

  private stepWater(dt: number) {
    const pl = this.player();
    const v = pl.board?.vel;
    if (pl.alive) this.stepBody(pl, pl.pos.x, pl.pos.y, pl.pos.z, v?.x ?? 0, v?.z ?? 0, 1, dt);
    const fx = pl.pos.x, fz = pl.pos.z;
    for (const e of this.ctx.enemies?.list ?? []) {
      if (!e.alive || e.flying || Math.abs(e.pos.x - fx) > 70 || Math.abs(e.pos.z - fz) > 70) continue;
      this.stepBody(e, e.pos.x, e.pos.y, e.pos.z, e.vel.x, e.vel.z, Math.min(3, e.radius * 1.6), dt);
    }
    if (this.bodies.size > 400) for (const k of this.bodies.keys()) if (!(k as { alive?: boolean }).alive) this.bodies.delete(k);
    this.stepFloaters(dt, pl);
  }

  /** buoyant props on the oasis pools: lotus blossoms and a drifting palm log or two */
  private spawnFloaters() {
    const pools = this.ctx.world.pools;
    if (!pools.length) return;
    for (const p of pools) {
      const R = p.r / 1.6;
      for (let i = 0; i < 5; i++) {
        const a = rnd.next() * Math.PI * 2, d = R * (0.25 + rnd.next() * 0.45);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (this.ctx.world.waterAt(x, z) === null) continue;
        this.floaters.push({ kind: i < 4 ? 0 : 1, x, z, vx: 0, vz: 0, yaw: rnd.next() * 6.28, wy: (rnd.next() - 0.5) * 0.2, level: p.level, cx: p.x, cz: p.z, r: R * 0.85, ph: rnd.next() * 6 });
      }
    }
    const mk = (m: VoxelModel, vs: number) => {
      const im = new THREE.InstancedMesh(buildVoxelGeometry(m, { voxelSize: vs, pivot: 'center' }), sharedVoxelMaterial, 64);
      ensureInstFx(im);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.ctx.scene.add(im);
      return im;
    };
    this.floatMesh = [mk(lotus(), 1 / 22), mk(driftLog(), 1 / 18)];
  }

  private stepFloaters(dt: number, pl: PlayerLike) {
    if (!this.floaters.length) return;
    const counts = [0, 0];
    const t = this.ctx.engine.realTime;
    for (const f of this.floaters) {
      // shoved by whoever wades past, drifting on a slow eddy, kept off the banks
      const dx = f.x - pl.pos.x, dz = f.z - pl.pos.z, d = Math.hypot(dx, dz);
      const v = pl.board?.vel;
      if (d < 2.2 && d > 1e-3) {
        const push = (2.2 - d) * (2 + Math.hypot(v?.x ?? 0, v?.z ?? 0) * 0.4);
        f.vx += (dx / d) * push * dt * 3;
        f.vz += (dz / d) * push * dt * 3;
        f.wy += (rnd.next() - 0.5) * push * dt * 2;
      }
      f.vx += -Math.sin(t * 0.05 + f.ph) * 0.02 * dt;
      f.vz += Math.cos(t * 0.05 + f.ph) * 0.02 * dt;
      const ox = f.x - f.cx, oz = f.z - f.cz, od = Math.hypot(ox, oz);
      if (od > f.r) {
        f.vx -= (ox / od) * (od - f.r) * dt * 4;
        f.vz -= (oz / od) * (od - f.r) * dt * 4;
      }
      const damp = Math.exp(-dt * 0.9);
      f.vx *= damp;
      f.vz *= damp;
      f.wy *= Math.exp(-dt * 0.6);
      f.x += f.vx * dt;
      f.z += f.vz * dt;
      f.yaw += f.wy * dt;
      // buoyancy: ride the ripples, bob, tilt with the local slope
      const h = rippleHeight(f.x, f.z);
      const hx = rippleHeight(f.x + 0.4, f.z) - h, hz = rippleHeight(f.x, f.z + 0.4) - h;
      const bob = Math.sin(t * 1.3 + f.ph) * 0.015;
      _q.setFromEuler(_e.set(-hz * 2.5 + Math.sin(t * 0.9 + f.ph) * 0.03, f.yaw, hx * 2.5, 'YXZ'));
      _m.compose(_v.set(f.x, f.level + h + bob + (f.kind ? -0.08 : 0.02), f.z), _q, _s);
      const im = this.floatMesh[f.kind];
      if (im) im.setMatrixAt(counts[f.kind]++, _m);
    }
    for (let k = 0; k < 2; k++) {
      const im = this.floatMesh[k];
      if (!im) continue;
      im.count = counts[k];
      im.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt: number) {
    if (!this.ctx.world.group.parent) return this.dispose();
    if (!this.trees) this.trees = Trees.of(this.ctx.world);
    if (dt <= 0) return;
    this.stepTrees(dt);
    this.stepPods(dt);
    this.stepWater(dt);
  }
}
