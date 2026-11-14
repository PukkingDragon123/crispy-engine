// KHONSU'S POWERS over the night, the moon and time, shared by both Khonsu fights
// (the Avatar at desert waves 5/35/65 and Khonsu of the Sands at 75). Each power is a
// named attack (song titles) that the boss weaves into its own phases:
//   Undercover of the Night (Stones)      his entrance: the sun sinks, the moon comes up (LunarSky)
//   Shine a Light (Stones)                moonbeams crash down along the moon's bearing; each spot
//                                         is ringed and glints run down the beam's path first
//   Lucy in the Sky with Diamonds (Beatles)  crescent shards of the moon fall on ringed spots,
//                                         stick in the sand and splinter
//   2000 Light Years from Home (Stones)   he drags the moon close: it swells over the dunes, its
//                                         pull tugs the hunter toward it and its light burns hotter
//   November Rain (GnR)                   the moon cracks and sheds a storm of shards
//   Ruby Tuesday (Stones)                 blood eclipse: the moon goes red and black, the world dark
//   Patience (GnR)                        clock dials bloom on the sand: inside, time crawls (you and
//                                         every bullet); when the minute hand reaches twelve the dial
//                                         strikes, so ride out before it does
//   Tomorrow Never Knows (Beatles)        an hourglass flips over his head and his bullets stop dead
//                                         in the air (each shows where it will go); when the sand
//                                         runs out they all fly on
//   Yesterday (Beatles)                   a volley you dodged is rewound: his bullets stop, then fly
//                                         back along the very paths they came by
// Everything is driven by entities with their own clocks (update), so a fight that ends
// mid-attack never leaves a frozen bullet, a dial or a ring behind (calm / dispose).
import * as THREE from 'three';
import type { Boss } from '../Boss';
import type { Proj } from '../../enemies/Projectiles';
import type { MarkHandle } from '../../enemies/Warnings';
import { LunarSky, type LunarSkyOpts } from './LunarSky';
import { buildRigGeo, RigGeo, RigInstance } from '../../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { khonsuDialRig, khonsuHourglassRig, khonsuShardModel, DIAL_R, HOURGLASS_VS, SHARD_VS } from '../../models/enemies/khonsuMoon';
import { rnd, damp, clamp } from '../../../engine/math/rand';

const MOONC = 0xcfe8ff;
const PALE = [0xcfe8ff, 0xffffff, 0x9fd0ff];
const BLOOD = [0xff7a5a, 0xffc0a8, 0xd8402a];
const GRAINS = ['grain0', 'grain1', 'grain2', 'grain3'];
const SANDG = [0xf3d29a, 0xe8c27e, 0xfae3b4];
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const UPZ = new THREE.Vector3(0, 0, 1);

let DIAL_GEO: RigGeo | null = null;
let GLASS_GEO: { rig: RigGeo; glass: THREE.BufferGeometry; pivot: [number, number, number] } | null = null;
let SHARD_GEO: THREE.BufferGeometry[] | null = null;
function dialGeo() {
  return (DIAL_GEO ??= buildRigGeo(khonsuDialRig(), 'khonsu_dial'));
}
function glassGeo() {
  if (!GLASS_GEO) {
    const spec = khonsuHourglassRig();
    const pivot = spec.meta!.glassPivot as [number, number, number];
    GLASS_GEO = { rig: buildRigGeo(spec, 'khonsu_hourglass'), glass: buildVoxelGeometry(spec.meta!.glass, { voxelSize: HOURGLASS_VS, pivot, ao: 0.3 }), pivot };
  }
  return GLASS_GEO;
}
function shardGeos() {
  return (SHARD_GEO ??= [0, 1, 2].map((k) => {
    const s = khonsuShardModel(k);
    return buildVoxelGeometry(s.model, { voxelSize: SHARD_VS, pivot: 'center' });
  }));
}

interface Beam {
  x: number;
  z: number;
  r: number;
  t: number;
  lead: number;
  dmg: number;
  hit: boolean;
  blood: boolean;
  fx: number;
  mark: MarkHandle | null;
}
interface Shard {
  kind: number;
  slot: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  T: number;
  r: number;
  dmg: number;
  splinters: number;
  landed: number;
  spin: number;
  axis: THREE.Vector3;
  rot: THREE.Quaternion;
  scale: number;
}
interface Bubble {
  rig: RigInstance;
  x: number;
  z: number;
  R: number;
  t: number;
  bloom: number;
  dur: number;
  dmg: number;
  struck: boolean;
  out: number;
  tick: number;
  fx: number;
}
interface Glass {
  rig: RigInstance;
  glass: THREE.Mesh;
  glassMat: VoxelMaterial;
  anchor: () => THREE.Vector3;
  scale: number;
  t: number;
  /** seconds the sand runs */
  run: number;
  /** -1: the sand runs back up (a rewind) */
  dir: 1 | -1;
  flip: number;
  out: number;
}
interface TS {
  k: number;
  vx: number;
  vy: number;
  vz: number;
  g: number;
}

export interface LunarKitOpts extends LunarSkyOpts {
  /** size of everything (dials, shards, beams, the hourglass): 1 for the Avatar, ~2.4 for the colossus */
  scale: number;
  callout: (song: string) => void;
}

export class LunarKit {
  sky: LunarSky;
  private beams: Beam[] = [];
  private shards: Shard[] = [];
  private bubbles: Bubble[] = [];
  private dialPool: RigInstance[] = [];
  private glass: Glass | null = null;
  /** >0: the boss's bullets stand still in the air */
  private freeze = 0;
  private ts = new WeakMap<Proj, TS>();
  private touched: Proj[] = [];
  private shardMesh: THREE.InstancedMesh[] = [];
  private shardMat: VoxelMaterial;
  private slots: boolean[][] = [[], [], []];
  private t = 0;
  private hurtAt = -99;
  private offHurt: () => void;
  private pull = 0;
  private fxT = 0;
  private gone = false;
  /** the night is lifting on its own clock (end) */
  private ending = false;

  constructor(private b: Boss, private o: LunarKitOpts) {
    const ctx = b.ctx;
    this.sky = new LunarSky(ctx, o);
    this.shardMat = makeVoxelMaterial({ roughness: 0.7 });
    const geos = shardGeos();
    for (let k = 0; k < 3; k++) {
      const m = new THREE.InstancedMesh(geos[k], this.shardMat, 12);
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      ctx.scene.add(m);
      this.shardMesh.push(m);
    }
    this.offHurt = ctx.events.on('playerHurt', () => (this.hurtAt = this.t));
  }

  private get ctx() {
    return this.b.ctx;
  }
  private get pl() {
    return this.b.player;
  }
  private get warn() {
    return this.b.d.enemies.warn;
  }
  private ground(x: number, z: number) {
    return this.ctx.world.groundAt(x, z);
  }
  private inArena(x: number, z: number, m = 3) {
    return this.ctx.world.storm.sdf(x, z) > m;
  }
  /** the hunter has not been hurt for `s` seconds (the last volley missed) */
  missedFor(s: number) {
    return this.t - this.hurtAt > s;
  }
  predicted(t: number) {
    const v = this.pl.board.vel;
    return _v.set(this.pl.pos.x + v.x * t, 0, this.pl.pos.z + v.z * t).clone();
  }
  /** the way beams and shards come down: along the moon's bearing, but steep (58 degrees) so they never skim the dunes */
  private moonDir(out: THREE.Vector3) {
    this.sky.flatDir(out);
    const c = Math.cos(1.01), s = Math.sin(1.01);
    return out.set(out.x * c, s, out.z * c);
  }

  // ================================================================== the night
  /** Undercover of the Night: the sun goes down and his moon comes up (k: 1 full night) */
  fall(k = 1) {
    this.sky.nightT = k;
  }

  // ================================================================== Shine a Light
  /** one moonbeam on a spot: ringed for `lead` s, glints run down its path, then it crashes down */
  beam(x: number, z: number, o: { r?: number; lead?: number; dmg?: number; blood?: boolean } = {}) {
    if (!this.inArena(x, z, 2)) return;
    const r = (o.r ?? 2.5) * Math.sqrt(this.o.scale);
    const lead = o.lead ?? 1.05;
    const mark = this.warn.circle(x, z, r, lead, 'heavy');
    this.beams.push({ x, z, r, t: 0, lead, dmg: o.dmg ?? 18, hit: false, blood: !!o.blood, fx: 0, mark });
  }
  /**
   * a rain of moonbeams. pattern: 'track' (on and around where you are going), 'ring'
   * (a closing circle round you, the last one on you), 'spiral' (marching out from `at`)
   */
  async shineALight(o: { n: number; gap: number; lead?: number; r?: number; dmg?: number; pattern?: 'track' | 'ring' | 'spiral'; at?: THREE.Vector3; blood?: boolean; song?: boolean }) {
    if (o.song !== false) this.o.callout('Shine a Light');
    const pat = o.pattern ?? 'track';
    this.ctx.sfx('divine_whisper', this.b.pos, 0.8, 1.3);
    const a0 = rnd.next() * Math.PI * 2;
    for (let i = 0; i < o.n; i++) {
      let x: number, z: number;
      if (pat === 'ring') {
        const pp = this.pl.pos;
        if (i === o.n - 1) {
          const p = this.predicted(0.9);
          x = p.x;
          z = p.z;
        } else {
          const a = a0 + (i / (o.n - 1)) * Math.PI * 2;
          x = pp.x + Math.cos(a) * 6 * Math.sqrt(this.o.scale);
          z = pp.z + Math.sin(a) * 6 * Math.sqrt(this.o.scale);
        }
      } else if (pat === 'spiral') {
        const c = o.at ?? this.b.pos;
        const a = a0 + i * 0.75;
        const r = 6 + i * 1.6 * Math.sqrt(this.o.scale);
        x = c.x + Math.cos(a) * r;
        z = c.z + Math.sin(a) * r;
      } else {
        const p = this.predicted(0.75 + rnd.next() * 0.35);
        const j = i === 0 ? 0 : 4.5 * Math.sqrt(this.o.scale);
        x = p.x + (rnd.next() - 0.5) * 2 * j;
        z = p.z + (rnd.next() - 0.5) * 2 * j;
      }
      this.beam(x, z, { r: o.r, lead: o.lead, dmg: o.dmg, blood: o.blood });
      await this.b.wait(o.gap);
    }
  }

  private updateBeams(dt: number) {
    const ctx = this.ctx;
    const P = ctx.particles;
    const md = this.moonDir(_w);
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const B = this.beams[i];
      B.t += dt;
      B.fx -= dt;
      const g = this.ground(B.x, B.z);
      const cols = B.blood ? BLOOD : PALE;
      if (!B.hit && B.fx <= 0) {
        // glints run down the path the beam will take
        B.fx = 0.07;
        const h = 18 + rnd.next() * 30;
        P.emit({ pos: { x: B.x + md.x * h, y: g + md.y * h, z: B.z + md.z * h }, count: 1, vel: { x: -md.x * 48, y: -md.y * 48, z: -md.z * 48 }, life: [0.3, 0.38], size: [0.3 * Math.sqrt(this.o.scale), 0.1], sprite: 'star4', additive: true, color: cols, stretch: 0.03 });
        if (B.t > B.lead * 0.55) P.emit({ pos: { x: B.x, y: g + 0.2, z: B.z }, count: 2, spread: B.r * 0.8, up: 0.6, life: [0.25, 0.45], size: [0.18, 0.05], sprite: 'spark', additive: true, color: cols, jitter: B.r * 0.6 });
      }
      if (!B.hit && B.t >= B.lead) {
        B.hit = true;
        const p = { x: B.x, y: g + 0.2, z: B.z };
        ctx.fx.ring(p, B.blood ? 0xff7a5a : MOONC, B.r * 2.4, 0.45);
        ctx.fx.light({ x: B.x, y: g + 2.5, z: B.z }, B.blood ? 0xff6a48 : MOONC, 9, 0.55, 12 + B.r * 3);
        ctx.fx.sandBurst(p, B.r * 0.55);
        P.emit({ pos: p, count: 14, spread: B.r * 1.4, up: 2.4, life: [0.4, 0.9], size: [0.28, 0.06], sprite: ['spark', 'star4'], additive: true, color: cols, drag: 1.4, jitter: B.r * 0.4 });
        ctx.sfx('divine_chime', p, 0.55, B.blood ? 0.45 : 0.7 + rnd.next() * 0.2);
        ctx.sfx('explosion', p, 0.35, 1.3);
        ctx.shake(0.12 + 0.05 * this.o.scale);
        ctx.events.emit('groundMark', B.x, B.z, B.r * 0.7, 1);
        const pl = this.pl;
        if (pl.alive && Math.hypot(pl.pos.x - B.x, pl.pos.z - B.z) < B.r && pl.pos.y < g + 3.5 * this.o.scale) pl.takeHit({ base: B.dmg, kind: 'magic', source: 'contact', knock: 6 }, new THREE.Vector3(B.x, g, B.z));
      }
      // the column of light lingers a moment
      if (B.hit && B.fx <= 0 && B.t < B.lead + 0.42) {
        B.fx = 0.035;
        const k = 1 - (B.t - B.lead) / 0.42;
        for (let h = 0; h < 44; h += 3.2 + rnd.next()) P.emit({ pos: { x: B.x + md.x * h, y: g + md.y * h, z: B.z + md.z * h }, count: 1, vel: { x: -md.x * 20, y: -md.y * 20, z: -md.z * 20 }, life: [0.12, 0.2], size: [B.r * 0.75 * k + 0.2, 0.1], sprite: 'glow16', additive: true, color: cols, jitter: B.r * 0.25 });
      }
      if (B.t > B.lead + 0.45) this.beams.splice(i, 1);
    }
  }

  // ================================================================== Lucy in the Sky with Diamonds
  /** one crescent shard falling on (x, z) in `T` s; it is ringed the whole way down */
  shard(x: number, z: number, o: { T?: number; r?: number; dmg?: number; splinters?: number } = {}) {
    if (!this.inArena(x, z, 2)) return;
    const kind = rnd.int(0, 2);
    const slot = this.slots[kind].findIndex((s) => !s);
    const sl = slot < 0 ? this.slots[kind].length : slot;
    if (sl >= 12) return;
    this.slots[kind][sl] = true;
    const g = this.ground(x, z);
    const md = this.moonDir(_w);
    const H = 70;
    const from = new THREE.Vector3(x + md.x * H, g + md.y * H, z + md.z * H);
    const T = o.T ?? 1.25;
    const r = (o.r ?? 2.2) * Math.sqrt(this.o.scale);
    this.warn.circle(x, z, r, T, 'heavy');
    const axis = new THREE.Vector3(rnd.next() - 0.5, rnd.next() - 0.5, rnd.next() - 0.5).normalize();
    this.shards.push({ kind, slot: sl, from, to: new THREE.Vector3(x, g, z), t: 0, T, r, dmg: o.dmg ?? 16, splinters: o.splinters ?? 6, landed: -1, spin: 3 + rnd.next() * 4, axis, rot: new THREE.Quaternion(), scale: this.o.scale * (0.9 + rnd.next() * 0.35) });
    this.ctx.sfx('whoosh', from, 0.4, 0.6 + rnd.next() * 0.3);
  }
  async lucy(o: { n: number; gap: number; T?: number; r?: number; dmg?: number; splinters?: number; spread?: number; song?: boolean }) {
    if (o.song !== false) this.o.callout('Lucy in the Sky with Diamonds');
    const spread = (o.spread ?? 7) * Math.sqrt(this.o.scale);
    for (let i = 0; i < o.n; i++) {
      const p = this.predicted(1.0);
      const j = i % 3 === 0 ? 0.25 : 1;
      this.shard(p.x + (rnd.next() - 0.5) * spread * j, p.z + (rnd.next() - 0.5) * spread * j, o);
      await this.b.wait(o.gap);
    }
  }

  private updateShards(dt: number) {
    const ctx = this.ctx;
    const used = [0, 0, 0];
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const S = this.shards[i];
      S.t += dt;
      let pos: THREE.Vector3;
      let sc = S.scale;
      if (S.landed < 0) {
        const k = Math.min(1, S.t / S.T);
        const e = k * k * (0.35 + 0.65 * k); // gathering speed
        pos = _s.copy(S.from).lerp(S.to, e);
        // the convex back leads along the fall, spinning on its own axis
        const dir = _v.copy(S.to).sub(S.from).normalize();
        _q.setFromUnitVectors(UPZ, dir);
        S.rot.copy(_q).multiply(new THREE.Quaternion().setFromAxisAngle(UPZ, S.t * S.spin));
        if (rnd.chance(0.6)) ctx.particles.emit({ pos: { x: pos.x, y: pos.y, z: pos.z }, count: 1, life: [0.3, 0.5], size: [0.3 * S.scale, 0.05], sprite: 'spark', additive: true, color: PALE, drag: 2 });
        if (k >= 1) {
          S.landed = S.t;
          const p = { x: S.to.x, y: S.to.y + 0.3, z: S.to.z };
          ctx.sfx('glass_break', p, 0.5, 0.55 + rnd.next() * 0.2);
          ctx.sfx('rock_crumble', p, 0.45, 1.2);
          ctx.fx.sandBurst(p, S.r * 0.6);
          ctx.fx.ring(p, MOONC, S.r * 2, 0.35);
          ctx.particles.emit({ pos: p, count: 12, spread: S.r * 1.6, up: 3, life: [0.5, 1], size: [0.2, 0.05], sprite: ['crystal', 'spark'], additive: true, color: PALE, gravity: 9, ground: true, jitter: 0.5 });
          ctx.shake(0.15 + 0.05 * this.o.scale);
          const pl = this.pl;
          if (pl.alive && Math.hypot(pl.pos.x - S.to.x, pl.pos.z - S.to.z) < S.r && pl.pos.y < S.to.y + 2.5 * this.o.scale) pl.takeHit({ base: S.dmg, kind: 'phys', source: 'contact', knock: 9 }, S.to.clone());
          if (S.splinters > 0) this.b.d.enemies.proj.pattern('ring', _v.set(S.to.x, S.to.y + 0.7, S.to.z), this.pl.pos, { count: S.splinters, speed: 7.5, dmg: 7, proj: 'curse', sourceId: this.b.id, phase: rnd.next() });
          // it sticks in the sand at a slant
          S.rot.setFromEuler(new THREE.Euler(0.5 + rnd.next() * 0.5, rnd.next() * 6.28, (rnd.next() - 0.5) * 0.6));
        }
      } else {
        const lt = S.t - S.landed;
        pos = _s.copy(S.to);
        pos.y -= Math.min(1, lt / 2.2) * 0.6 * S.scale;
        if (lt > 1.6) sc *= Math.max(0, 1 - (lt - 1.6) / 0.5);
        if (lt > 1.6 && rnd.chance(0.5)) ctx.particles.emit({ pos: { x: pos.x, y: pos.y + 0.4 * S.scale, z: pos.z }, count: 2, spread: 0.6 * S.scale, up: 1, life: [0.4, 0.7], size: [0.14, 0.04], sprite: 'spark', additive: true, color: PALE, drag: 1 });
        if (lt > 2.1) {
          this.slots[S.kind][S.slot] = false;
          this.shards.splice(i, 1);
          continue;
        }
      }
      const mesh = this.shardMesh[S.kind];
      const n = used[S.kind]++;
      _m.compose(pos, S.rot, _v.set(sc, sc, sc));
      mesh.setMatrixAt(n, _m);
    }
    for (let k = 0; k < 3; k++) {
      this.shardMesh[k].count = used[k];
      if (used[k]) this.shardMesh[k].instanceMatrix.needsUpdate = true;
    }
  }

  // ================================================================== Patience: clock dials
  /** a dial blooms at (x, z): inside it time crawls; when the minute hand comes round it strikes */
  dial(x: number, z: number, o: { R?: number; dur?: number; dmg?: number; bloom?: number } = {}) {
    if (!this.inArena(x, z, 3)) return;
    const R = o.R ?? 4.2 * Math.sqrt(this.o.scale);
    const rig = this.dialPool.pop() ?? new RigInstance(dialGeo(), { ownMaterial: true });
    rig.root.visible = true;
    this.ctx.scene.add(rig.root);
    const bloom = o.bloom ?? 0.85;
    const dur = o.dur ?? 3.0;
    this.warn.circle(x, z, R, bloom + dur, 'heavy');
    this.warn.bang({ x, y: this.ground(x, z), z }, { tier: 'heavy', life: bloom + 0.3, y: 2.6 });
    this.bubbles.push({ rig, x, z, R, t: 0, bloom, dur, dmg: o.dmg ?? 16, struck: false, out: 0, tick: 0, fx: 0 });
    this.ctx.sfx('time_slow', { x, y: this.ground(x, z), z }, 0.7, 1.25);
  }
  async patience(o: { n: number; gap?: number; R?: number; dur?: number; dmg?: number }) {
    this.o.callout('Patience');
    const sR = o.R ?? 4.2 * Math.sqrt(this.o.scale);
    const p0 = this.predicted(0.7);
    const a0 = rnd.next() * Math.PI * 2;
    for (let i = 0; i < o.n; i++) {
      // the first dial on you, the rest flanking where you would run
      const a = a0 + (i / Math.max(1, o.n - 1)) * Math.PI * 2;
      const d = i === 0 ? 0 : sR * 1.9;
      const pp = i === 0 ? this.predicted(0.5) : p0;
      this.dial(pp.x + Math.cos(a) * d, pp.z + Math.sin(a) * d, o);
      await this.b.wait(o.gap ?? 0.4);
    }
  }
  private inBubble(B: Bubble, x: number, y: number, z: number) {
    const g = this.ground(B.x, B.z);
    return (x - B.x) ** 2 + (z - B.z) ** 2 < B.R * B.R && y < g + B.R;
  }
  private updateBubbles(dt: number) {
    const ctx = this.ctx;
    const P = ctx.particles;
    const pl = this.pl;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const B = this.bubbles[i];
      B.t += dt;
      const g = this.ground(B.x, B.z);
      const live = B.t >= B.bloom && !B.struck;
      // ---------------------------------------------------- the dial on the sand
      const k = B.struck ? Math.max(0, 1 - B.out / 0.35) : Math.min(1, B.t / B.bloom);
      const e = 1 - (1 - k) ** 3;
      const root = B.rig.root;
      const sc = (B.R / DIAL_R) * (0.35 + 0.65 * e);
      root.scale.setScalar(sc);
      // tilted to the slope it lies on
      const gx = this.ground(B.x + B.R * 0.7, B.z) - this.ground(B.x - B.R * 0.7, B.z);
      const gz = this.ground(B.x, B.z + B.R * 0.7) - this.ground(B.x, B.z - B.R * 0.7);
      root.position.set(B.x, g + 0.08 - (1 - e) * 0.4, B.z);
      root.rotation.set(Math.atan2(gz, B.R * 1.4) * 0.85, 0, -Math.atan2(gx, B.R * 1.4) * 0.85, 'XYZ');
      const run = clamp((B.t - B.bloom) / B.dur, 0, 1);
      const n = B.rig.nodes;
      if (n['hand_m']) n['hand_m'].rotation.y = -run * Math.PI * 2;
      if (n['hand_h']) n['hand_h'].rotation.y = -run * (Math.PI / 6) - 0.4;
      const fx = B.rig.material.userData.fx.value;
      fx.z = live ? 0.6 + run * 1.4 + Math.sin(this.t * (6 + run * 14)) * 0.25 : 0.4;
      // ---------------------------------------------------- the bubble: a dotted dome and sand hanging in slow time
      B.fx -= dt;
      if (B.fx <= 0 && !B.struck) {
        B.fx = 0.05;
        for (let j = 0; j < 4; j++) {
          const a = rnd.next() * Math.PI * 2, el = Math.acos(rnd.next());
          const rr = B.R * e;
          P.emit({ pos: { x: B.x + Math.cos(a) * Math.sin(el) * rr, y: g + Math.cos(el) * rr, z: B.z + Math.sin(a) * Math.sin(el) * rr }, count: 1, life: [0.35, 0.6], size: [0.11 * Math.sqrt(this.o.scale), 0.05], sprite: 'dot3', additive: true, color: live ? [0xcfe8ff, 0xffe9b0] : [0x9fb8e0] });
        }
        if (live) P.emit({ pos: { x: B.x + (rnd.next() - 0.5) * B.R, y: g + B.R * (0.3 + rnd.next() * 0.5), z: B.z + (rnd.next() - 0.5) * B.R }, count: 1, vel: { x: 0, y: -0.35, z: 0 }, life: [1.2, 1.8], size: [0.09, 0.07], sprite: GRAINS, color: SANDG });
      }
      if (live) {
        // every second ticks out loud, faster at the end
        B.tick -= dt;
        if (B.tick <= 0) {
          B.tick = run > 0.75 ? 0.25 : 0.5;
          ctx.sfx('rev_hammer', { x: B.x, y: g, z: B.z }, 0.35, 1.5 + run * 0.4);
        }
        if (pl.alive && this.inBubble(B, pl.pos.x, pl.pos.y, pl.pos.z)) pl.status.apply('slow', 1, 0.25, 1, 4, {});
        if (run >= 1) {
          // the strike
          B.struck = true;
          const p = { x: B.x, y: g + 0.3, z: B.z };
          ctx.sfx('divine_chime', p, 0.8, 0.45);
          ctx.sfx('rev_hammer', p, 0.9, 0.7);
          ctx.fx.ring(p, 0xffe9b0, B.R * 2.2, 0.4);
          ctx.fx.light({ x: B.x, y: g + 1.5, z: B.z }, 0xffe9b0, 6, 0.4, B.R * 3);
          P.emit({ pos: p, count: 20, spread: B.R * 1.2, up: 2, life: [0.4, 0.8], size: [0.22, 0.05], sprite: ['spark', 'star4'], additive: true, color: [0xffe9b0, 0xcfe8ff], jitter: B.R * 0.5, drag: 1.5 });
          if (pl.alive && this.inBubble(B, pl.pos.x, pl.pos.y, pl.pos.z)) {
            const dealt = pl.takeHit({ base: B.dmg, kind: 'magic', source: 'contact', knock: 4 }, new THREE.Vector3(B.x, g, B.z));
            if (dealt > 0) {
              pl.status.apply('stun', 1, 0.7, 1, 2, {});
              ctx.toast('STOPPED IN TIME', '#ffe9b0');
            }
          }
        }
      }
      if (B.struck) {
        B.out += dt;
        if (B.out > 0.35) {
          B.rig.root.removeFromParent();
          B.rig.root.visible = false;
          this.dialPool.push(B.rig);
          this.bubbles.splice(i, 1);
        }
      }
    }
  }

  // ================================================================== Tomorrow Never Knows / Yesterday: the hourglass
  private showGlass(anchor: () => THREE.Vector3, run: number, dir: 1 | -1) {
    this.dropGlass();
    const G = glassGeo();
    const rig = new RigInstance(G.rig, { ownMaterial: true });
    const glassMat = makeVoxelMaterial({ transparent: true, opacity: 0.34 });
    glassMat.depthWrite = false;
    const glass = new THREE.Mesh(G.glass, glassMat);
    glass.renderOrder = 5;
    (rig.nodes['frame'] ?? rig.root).add(glass);
    this.ctx.scene.add(rig.root);
    this.glass = { rig, glass, glassMat, anchor, scale: this.o.scale * 1.15, t: 0, run, dir, flip: 0, out: -1 };
    const n = rig.nodes;
    // the sand starts in the lower bulb (it turns over to start)
    if (dir > 0) {
      n['sand_top'].scale.y = 0.001;
      n['sand_bot'].scale.set(1, 1, 1);
    } else {
      n['sand_top'].scale.y = 0.001;
      n['sand_bot'].scale.set(1, 1, 1);
    }
    n['stream'].visible = false;
  }
  private dropGlass() {
    const G = this.glass;
    if (!G) return;
    G.rig.root.removeFromParent();
    G.rig.material.dispose();
    G.glassMat.dispose();
    this.glass = null;
  }
  private updateGlass(dt: number) {
    const G = this.glass;
    if (!G) return;
    G.t += dt;
    const n = G.rig.nodes;
    const root = G.rig.root;
    root.position.copy(G.anchor());
    const appear = Math.min(1, G.t / 0.3);
    let s = G.scale * (1 - (1 - appear) ** 3);
    // turn over (0.3 → 0.75 s), then the sand runs
    const fk = clamp((G.t - 0.3) / 0.45, 0, 1);
    const fe = fk < 0.5 ? 2 * fk * fk : 1 - (-2 * fk + 2) ** 2 / 2;
    if (fk < 1) {
      root.rotation.set(0, this.t * 0.6, fe * Math.PI * G.dir);
    } else {
      if (G.flip === 0) {
        // over: the full bulb is on top now
        G.flip = 1;
        if (G.dir > 0) {
          n['sand_top'].scale.set(1, 1, 1);
          n['sand_bot'].scale.set(0.001, 0.001, 0.001);
        }
        this.ctx.particles.emit({ pos: { x: root.position.x, y: root.position.y, z: root.position.z }, count: 16, spread: 1.4 * G.scale, up: 1, life: [0.4, 0.8], size: [0.3 * Math.sqrt(G.scale), 0.05], sprite: ['spark', 'star4'], additive: true, color: [0xffe9b0, 0xcfe8ff], drag: 1.5 });
        this.ctx.sfx('rev_spin', root.position, 0.6, 0.7);
      }
      root.rotation.set(0, this.t * 0.6, 0);
      const k = clamp((G.t - 0.75) / G.run, 0, 1);
      if (G.dir > 0) {
        n['sand_top'].scale.set(1, Math.max(0.001, 1 - k), 1);
        const b = Math.max(0.001, k);
        n['sand_bot'].scale.set(Math.sqrt(b), b, Math.sqrt(b));
      } else {
        // a rewind: the sand climbs back up
        n['sand_top'].scale.set(1, Math.max(0.001, k), 1);
        const b = Math.max(0.001, 1 - k);
        n['sand_bot'].scale.set(Math.sqrt(b), b, Math.sqrt(b));
      }
      n['stream'].visible = k < 1 && G.out < 0;
      n['stream'].scale.y = G.dir;
      if (k >= 1 && G.out < 0) G.out = 0;
    }
    if (G.out >= 0) {
      G.out += dt;
      s *= Math.max(0, 1 - G.out / 0.35);
      if (G.out > 0.35) {
        this.dropGlass();
        return;
      }
    }
    root.scale.setScalar(Math.max(0.001, s));
    const fx = G.rig.material.userData.fx.value;
    fx.z = 0.5 + Math.sin(this.t * 4) * 0.2;
  }

  /**
   * Tomorrow Never Knows: `volley` fires, the hourglass over `anchor` turns, and every bullet
   * of his stops in the air for `hold` s (each one shows where it will go), then flies on.
   */
  async tomorrowNeverKnows(o: { volley: () => void; anchor: () => THREE.Vector3; hold: number; lead?: number }) {
    this.o.callout('Tomorrow Never Knows');
    o.volley();
    await this.b.wait(o.lead ?? 0.4);
    this.showGlass(o.anchor, o.hold, 1);
    await this.b.wait(0.75);
    this.freeze = o.hold;
    this.ctx.sfx('time_slow', this.b.pos, 1, 0.55);
    this.ctx.engine.flash(0xcfe8ff, 0.18, 0.35);
    this.ctx.toast('TIME STOPS', '#cfe8ff', 'Slip between the frozen shots before they fly on');
    await this.b.wait(o.hold);
    this.ctx.sfx('whoosh_big', this.b.pos, 0.8, 1.3);
    this.ctx.sfx('rev_hammer', this.b.pos, 0.8, 0.8);
  }

  /** how many of his bullets are in the air */
  liveBullets() {
    let n = 0;
    for (const q of this.b.d.enemies.proj.list) if (q.owner === 'enemy' && q.sourceId === this.b.id) n++;
    return n;
  }

  /** Yesterday: his bullets in the air stop, then fly back along the paths they came by */
  async yesterday(anchor: () => THREE.Vector3, hold = 0.55) {
    if (this.liveBullets() < 6) return false;
    this.o.callout('Yesterday');
    this.showGlass(anchor, hold + 0.4, -1);
    this.freeze = hold + 0.75;
    this.ctx.sfx('time_slow', this.b.pos, 0.9, 0.5);
    await this.b.wait(0.75 + hold);
    const list = this.b.d.enemies.proj.list;
    let n = 0;
    for (const q of list) {
      if (q.owner !== 'enemy' || q.sourceId !== this.b.id) continue;
      const st = this.ts.get(q);
      if (st) {
        st.vx = -st.vx;
        st.vy = -st.vy;
        st.vz = -st.vz;
      } else {
        q.vx = -q.vx;
        q.vy = -q.vy;
        q.vz = -q.vz;
      }
      q.life = clamp(6.2 - q.life, 0.8, 5);
      if (n++ < 40) this.ctx.particles.emit({ pos: { x: q.x, y: q.y, z: q.z }, count: 1, life: [0.25, 0.35], size: [0.5, 0.05], sprite: 'star4', additive: true, color: MOONC });
    }
    this.freeze = 0;
    this.ctx.engine.flash(0xdfefff, 0.16, 0.3);
    this.ctx.sfx('whoosh_big', this.b.pos, 0.8, 0.7);
    return true;
  }

  // ================================================================== bullets in slow / stopped time
  private timeFactor(q: Proj) {
    let k = 1;
    if (this.freeze > 0 && q.sourceId === this.b.id) k = 0;
    for (const B of this.bubbles) if (B.t >= B.bloom && !B.struck && (q.x - B.x) ** 2 + (q.z - B.z) ** 2 < B.R * B.R) k = Math.min(k, 0.16);
    return k;
  }
  private updateTime(dt: number) {
    const list = this.b.d.enemies.proj.list;
    const any = this.freeze > 0 || this.bubbles.length > 0;
    if (!any && !this.touched.length) return;
    const P = this.ctx.particles;
    let ticks = 0;
    const next: Proj[] = [];
    const seen = new Set<Proj>();
    for (const q of list) {
      if (q.owner !== 'enemy') continue;
      const k = any ? this.timeFactor(q) : 1;
      let st = this.ts.get(q);
      if (!st) {
        if (k >= 0.999) continue;
        st = { k: 1, vx: q.vx, vy: q.vy, vz: q.vz, g: q.grav };
        this.ts.set(q, st);
      }
      // recover the true velocity (gravity kept working on the scaled one)
      if (st.k > 0.001) {
        st.vx = q.vx / st.k;
        st.vy = q.vy / st.k;
        st.vz = q.vz / st.k;
      }
      q.life += dt * (1 - st.k);
      st.k = k;
      q.vx = st.vx * k;
      q.vy = st.vy * k;
      q.vz = st.vz * k;
      q.grav = st.g * k * k;
      if (k >= 0.999) {
        q.grav = st.g;
        this.ts.delete(q);
        continue;
      }
      next.push(q);
      seen.add(q);
      // a stopped bullet shows where it is going
      if (k === 0 && ticks < 18 && rnd.chance(0.25)) {
        ticks++;
        const l = Math.hypot(st.vx, st.vy, st.vz) || 1;
        P.emit({ pos: { x: q.x + (st.vx / l) * 0.7, y: q.y + (st.vy / l) * 0.7, z: q.z + (st.vz / l) * 0.7 }, count: 1, vel: { x: (st.vx / l) * 1.5, y: (st.vy / l) * 1.5, z: (st.vz / l) * 1.5 }, life: [0.2, 0.3], size: [0.12, 0.03], sprite: 'dot3', additive: true, color: 0xe8d8ff });
      }
    }
    // anything we slowed that has left the list is gone; anything left over is restored
    for (const q of this.touched) if (!seen.has(q)) this.ts.delete(q);
    this.touched = next;
  }
  /** every slowed or stopped bullet back to full speed */
  private releaseTime() {
    for (const q of this.touched) {
      const st = this.ts.get(q);
      if (!st) continue;
      if (st.k > 0.001) {
        st.vx = q.vx / st.k;
        st.vy = q.vy / st.k;
        st.vz = q.vz / st.k;
      }
      q.vx = st.vx;
      q.vy = st.vy;
      q.vz = st.vz;
      q.grav = st.g;
      this.ts.delete(q);
    }
    this.touched = [];
    this.freeze = 0;
  }

  // ================================================================== the moon itself
  /** the moon tugs the hunter toward it (m/s², 0 to let go) */
  tug(k: number) {
    this.pull = k;
  }

  /** 2000 Light Years from Home: drag the moon close for `dur` s; beams rain while it hangs there */
  async pullMoon(o: { dur: number; beams: number; gap: number; dmg?: number; pull?: number }) {
    this.o.callout('2000 Light Years from Home');
    const ctx = this.ctx;
    this.sky.nearT = 1;
    this.pull = o.pull ?? 3.2;
    ctx.sfx('quake_rumble', this.b.pos, 1, 0.55);
    ctx.sfx('divine_power', this.b.pos, 0.9, 0.5);
    ctx.toast('THE MOON COMES CLOSE', '#cfe8ff', 'It pulls you toward it: lean away');
    for (let t = 0; t < 1.6; t += 0.2) {
      ctx.shake(0.18);
      await this.b.wait(0.2);
    }
    const end = this.t + o.dur;
    let i = 0;
    while (this.t < end) {
      if (i++ % 2 === 0) void this.shineALight({ n: 5, gap: 0.1, pattern: 'ring', dmg: o.dmg, song: false, lead: 1.0 }).catch(() => {});
      else void this.shineALight({ n: 4, gap: 0.14, pattern: 'track', dmg: o.dmg, song: false }).catch(() => {});
      await this.b.wait(o.gap);
    }
    this.sky.nearT = 0;
    this.pull = 0;
  }

  /** November Rain: the moon cracks a stage further and a storm of shards comes down */
  async novemberRain(o: { stage: number; n: number; gap: number; dmg?: number; spread?: number }) {
    this.o.callout('November Rain');
    this.crack(o.stage);
    await this.b.wait(0.6);
    await this.lucy({ n: o.n, gap: o.gap, dmg: o.dmg, spread: o.spread ?? 12, T: 1.35, splinters: 4, song: false });
  }
  crack(stage: number) {
    const ctx = this.ctx;
    this.sky.crackTo(stage);
    ctx.sfx('ore_crack', this.b.pos, 1, 0.45);
    ctx.sfx('glass_break', this.b.pos, 0.8, 0.4);
    ctx.sfx('thunder', this.b.pos, 0.6, 1.2);
    ctx.engine.flash(0xdfefff, 0.25, 0.4);
    ctx.shake(0.4);
  }

  /** Ruby Tuesday: the blood eclipse for `dur` s, `during` runs in the dark */
  async rubyTuesday(o: { dur: number; during?: () => Promise<void> }) {
    this.o.callout('Ruby Tuesday');
    const ctx = this.ctx;
    this.sky.eclipseT = 1;
    ctx.sfx('divine_whisper', this.b.pos, 1, 0.4);
    ctx.sfx('heartbeat', this.b.pos, 1, 0.7);
    ctx.toast('BLOOD ECLIPSE', '#ff7a5a', 'Watch the rings: they still glow in the dark');
    try {
      await this.b.wait(1.6);
      const end = this.t + o.dur;
      if (o.during) await o.during();
      while (this.t < end) await this.b.wait(0.1);
    } finally {
      this.sky.eclipseT = 0;
    }
  }

  // ================================================================== per frame
  update(dt: number) {
    if (this.gone || this.ending) return;
    this.t += dt;
    this.freeze = Math.max(0, this.freeze - dt);
    this.sky.update(dt);
    this.updateBeams(dt);
    this.updateShards(dt);
    this.updateBubbles(dt);
    this.updateGlass(dt);
    this.updateTime(dt);
    // the moon's pull: the hunter drifts toward it, the sand streams the same way
    const pull = this.pull;
    if (pull > 0.05 && this.pl.alive) {
      const fd = this.sky.flatDir(_v);
      const v = this.pl.board.vel;
      v.x += fd.x * pull * dt;
      v.z += fd.z * pull * dt;
      this.fxT -= dt;
      if (this.fxT <= 0) {
        this.fxT = 0.05;
        const pp = this.pl.pos;
        for (let i = 0; i < 3; i++) {
          const x = pp.x + (rnd.next() - 0.5) * 24, z = pp.z + (rnd.next() - 0.5) * 24;
          this.ctx.particles.emit({ pos: { x, y: this.ground(x, z) + 0.2, z }, count: 2, vel: { x: fd.x * 7, y: 1.2, z: fd.z * 7 }, spread: 0.5, life: [0.6, 1.1], size: [0.16, 0.1], sprite: GRAINS, color: SANDG, gravity: 1.5, drag: 0.3 });
        }
      }
    }
  }

  /** the fight is over: every power lets go at once (bullets fly on, dials and rings vanish) */
  calm() {
    for (const B of this.beams) this.warn.endMark(B.mark);
    this.beams = [];
    for (const B of this.bubbles) if (!B.struck) {
      B.struck = true;
      B.out = 0;
    }
    if (this.glass && this.glass.out < 0) this.glass.out = 0;
    this.releaseTime();
    this.pull = 0;
    this.sky.nearT = 0;
    this.sky.eclipseT = 0;
  }

  /** the boss is gone: let the night lift on its own clock, then clean up */
  async end() {
    if (this.ending || this.gone) return;
    this.ending = true;
    this.calm();
    const tw = this.ctx.engine.tweens;
    const wait = (s: number) => tw.wait(s);
    // finish the dials and shards while the moon sets
    void (async () => {
      for (let t = 0; t < 2.5 && !this.gone; t += 0.05) {
        await wait(0.05);
        this.updateShards(0.05);
        this.updateBubbles(0.05);
        this.updateGlass(0.05);
      }
    })();
    await this.sky.restore(wait);
    this.dispose();
  }

  dispose() {
    if (this.gone) return;
    this.releaseTime();
    this.gone = true;
    this.offHurt();
    for (const m of this.shardMesh) m.removeFromParent();
    this.shardMat.dispose();
    for (const B of this.bubbles) {
      B.rig.root.removeFromParent();
      B.rig.material.dispose();
    }
    for (const r of this.dialPool) r.material.dispose();
    this.bubbles = [];
    this.dialPool = [];
    this.shards = [];
    this.dropGlass();
    this.sky.dispose();
  }
}
