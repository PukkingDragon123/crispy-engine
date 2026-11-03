// THE OASIS KING — the boss of the Heart of the Oasis: a 17.5 m catfish that
// walks on stubby legs, rules the island pond and commands an army of
// crocodiles, land catfish and walking flytraps. Every move is a song title.
//   Phase 1 (100–66%)  Octopus's Garden (dives into the pond / sand, tracks you
//                      as a bulge, erupts under you and belly-flops down),
//                      Locomotive (rears up and toboggans across the sand on its
//                      belly — QTE dodge), Shotgun Blues (fans of water cannon
//                      slugs that knock you flying), Shackler's Revenge (the 6 m
//                      whiskers lash a wide arc), Civil War (the army rises
//                      from the water)
//   Phase 2 (66–33%)   + I Want You (She's So Heavy) (inhales a whirlpool that
//                      drags you toward the open mouth) → Savoy Truffle (it
//                      SWALLOWS you: shoot the belly from inside or mash E to
//                      burst out; failing, it digests a bite and retches you up),
//                      Rain Fall Down (geysers fall as water bombs on marked
//                      rings), Let It Loose (the pond floods the island: the King
//                      swims, fin up, and rams) → the drain leaves it stranded
//   Phase 3 (33–0%)    enraged: chained moves, Dust N' Bones (the drained pond:
//                      it flops and every slam rings out), faster everything.
// Intro: the fin circles, the pond erupts — "Heart of Stone". Death: it rolls
// belly-up into the pond — "The End" — and the oasis is cleansed (OasisHeart).
//
// Rendering: the King's rig is built in a worker (models/creatures/oasisKingGeo)
// and swapped in for the Boss base's placeholder (like Khonsu's enrage swap).
// The arena (pond level, flood, ripples, the army, water shots) is provided by
// run/OasisHeart.ts through the KingArena interface.
import * as THREE from 'three';
import { Boss, BossDeps, HitSphere } from './Boss';
import type { Ctx, RayHit } from '../Ctx';
import type { Hit } from '../combat/Damage';
import type { Enemy } from '../enemies/Enemies';
import { RigInstance, type RigGeo } from '../../engine/voxel/Rig';
import { RigEyes } from '../fx/FaceFx';
import { clamp, damp, dampAngle, rnd } from '../../engine/math/rand';
import { leg, GAITS, type LegSample } from '../anim/gait';
import { SpringF } from '../anim/spring';

const TAU = Math.PI * 2;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _leg: LegSample = { sweep: 0, lift: 0, stance: true, u: 0 };
const COL = '#7fe0c0';
const WATER = [0xd8f4f0, 0x9ad8d0, 0x6ab8b0, 0xffffff];
const MURK = [0xb8c890, 0x8a9a5a, 0x6a7a42, 0xdce4b8];

// ============================================================================ water shots
/** a slug of water: flies (optionally arcing), knocks the hunter back, bursts into spray */
export interface WaterShot {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  r: number;
  dmg: number;
  knock: number;
  life: number;
  grav: number;
  /** blast radius on landing (0 = only a direct hit hurts) */
  splash: number;
  big: boolean;
}

/**
 * Water cannon shots for the oasis (the King's cannons and bombs, the land
 * catfish's spit). Pixel-art water: a bright core, a shedding trail of
 * droplets and mist, a burst of spray and foam rings on impact.
 */
export class WaterShots {
  list: WaterShot[] = [];
  /** 0 = crystal water, 1 = murky green (tints the spray) */
  murk = 1;
  constructor(private ctx: Ctx, private player: { pos: THREE.Vector3; alive: boolean; center(o?: THREE.Vector3): THREE.Vector3; takeHit(h: Hit, from?: THREE.Vector3): number; board: { impulse: THREE.Vector3 } }) {}

  private cols() {
    return this.murk > 0.5 ? MURK : WATER;
  }

  /** straight (grav 0) or arcing shot from `from` to land on / pass through `to` */
  fire(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, o: { speed: number; dmg: number; knock?: number; grav?: number; r?: number; splash?: number; big?: boolean }) {
    const g = o.grav ?? 0;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const flat = Math.hypot(dx, dz) || 1;
    let vx: number, vy: number, vz: number;
    if (g > 0) {
      const T = Math.max(0.35, flat / o.speed);
      vx = dx / T;
      vz = dz / T;
      vy = dy / T + 0.5 * g * T;
    } else {
      const L = Math.hypot(dx, dy, dz) || 1;
      vx = (dx / L) * o.speed;
      vy = (dy / L) * o.speed;
      vz = (dz / L) * o.speed;
    }
    if (this.list.length > 160) this.list.shift();
    this.list.push({ x: from.x, y: from.y, z: from.z, vx, vy, vz, r: o.r ?? 0.32, dmg: o.dmg, knock: o.knock ?? 9, life: 5, grav: g, splash: o.splash ?? 0, big: !!o.big });
  }

  /** a fan of straight slugs aimed at `to` */
  fan(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, n: number, spread: number, o: { speed: number; dmg: number; knock?: number; r?: number }) {
    const base = Math.atan2(to.x - from.x, to.z - from.z);
    const dist = Math.hypot(to.x - from.x, to.z - from.z) || 1;
    for (let i = 0; i < n; i++) {
      const a = base + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread);
      this.fire(from, { x: from.x + Math.sin(a) * dist, y: to.y, z: from.z + Math.cos(a) * dist }, o);
    }
  }

  /** a big burst of spray (eruptions, belly flops, hits) */
  splash(x: number, y: number, z: number, power = 1) {
    const P = this.ctx.particles;
    const c = this.cols();
    P.emit({ pos: { x, y: y + 0.1, z }, count: Math.round(22 * power), vel: { x: 0, y: 4.5 * Math.sqrt(power), z: 0 }, spread: 3.2 * power, gravity: 14, drag: 0.3, life: [0.5, 1.1], size: [0.14, 0.05], sprite: ['dot3', 'dot4', 'bubble'], color: c, ground: true, jitter: 0.6 * power });
    P.emit({ pos: { x, y: y + 0.3, z }, count: Math.round(5 * power), spread: 1.1 * power, up: 1.4, life: [0.6, 1.3], size: [0.6 * power, 1.5 * power], sprite: ['puff0', 'puff1', 'puff2'], color: this.murk > 0.5 ? [0xc8d4b0, 0xaab890] : [0xf0fbff, 0xd0eef0], alpha: 0.55, drag: 2.2, rot: 6, rotSpeed: 0.5 });
    this.ctx.fx.ring({ x, y: y + 0.08, z }, this.murk > 0.5 ? 0xc8d8a0 : 0xd8fbff, 2.2 * power, 0.5);
  }

  update(dt: number) {
    const ctx = this.ctx, P = ctx.particles, pl = this.player;
    const pc = pl.center(_w);
    const c = this.cols();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.life -= dt;
      s.vy -= s.grav * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      const g = ctx.world.groundAt(s.x, s.z);
      let dead = s.life <= 0;
      // the hunter
      if (!dead && pl.alive && Math.hypot(s.x - pc.x, s.z - pc.z) < s.r + 0.5 && Math.abs(s.y - pc.y) < s.r + 0.95) {
        const sp = Math.hypot(s.vx, s.vz) || 1;
        pl.takeHit({ base: s.dmg, kind: 'phys', source: 'projectile', knock: s.knock }, _v.set(s.x - (s.vx / sp) * 0.6, pl.pos.y, s.z - (s.vz / sp) * 0.6));
        pl.board.impulse.x += (s.vx / sp) * s.knock * 0.6;
        pl.board.impulse.z += (s.vz / sp) * s.knock * 0.6;
        this.splash(s.x, s.y - 0.4, s.z, s.big ? 1.1 : 0.55);
        ctx.sfx('water_loop', { x: s.x, y: s.y, z: s.z }, 0.5, 1.6);
        dead = true;
      } else if (!dead && s.y <= g) {
        this.splash(s.x, g, s.z, s.big ? 1.4 : 0.6);
        if (s.splash > 0) {
          ctx.shake(Math.max(0, 0.25 - Math.hypot(pl.pos.x - s.x, pl.pos.z - s.z) * 0.012));
          ctx.sfx('sand_burst', { x: s.x, y: g, z: s.z }, 0.6, 1.4);
          if (pl.alive && Math.hypot(pl.pos.x - s.x, pl.pos.z - s.z) < s.splash && pl.pos.y < g + 2.2) pl.takeHit({ base: s.dmg, kind: 'phys', source: 'projectile', knock: s.knock }, _v.set(s.x, g, s.z));
        } else if (rnd.chance(0.3)) ctx.sfx('water_loop', { x: s.x, y: g, z: s.z }, 0.25, 1.8);
        dead = true;
      }
      if (dead) {
        this.list[i] = this.list[this.list.length - 1];
        this.list.pop();
        continue;
      }
      // the slug: a bright core, droplets shed behind, a little mist
      const k = s.big ? 1.6 : 1;
      P.emit({ pos: { x: s.x, y: s.y, z: s.z }, count: s.big ? 3 : 2, life: [0.05, 0.09], size: [s.r * 1.3, s.r * 0.9], sprite: ['dot4', 'bubble'], color: c, jitter: s.r * 0.35 });
      P.emit({ pos: { x: s.x, y: s.y, z: s.z }, count: 1, vel: { x: s.vx * 0.08, y: s.vy * 0.08, z: s.vz * 0.08 }, spread: 0.6 * k, gravity: 10, life: [0.25, 0.5], size: [0.08 * k, 0.03], sprite: ['dot3', 'dot4'], color: c, jitter: s.r * 0.5 });
      if (rnd.chance(s.big ? 0.5 : 0.2)) P.emit({ pos: { x: s.x, y: s.y, z: s.z }, count: 1, spread: 0.3, life: [0.3, 0.6], size: [0.25 * k, 0.6 * k], sprite: ['puff0', 'puff1'], color: this.murk > 0.5 ? 0xc8d4b0 : 0xeaf8ff, alpha: 0.35, drag: 2, rot: 6, rotSpeed: 0.4 });
    }
  }

  clear() {
    this.list.length = 0;
  }
}

// ============================================================================ the arena
/** what the King needs from the area controller (run/OasisHeart implements it) */
export interface KingArena {
  cx: number;
  cz: number;
  /** island radius (m) */
  r: number;
  /** current surface level / radius of the pond in the island's bowl */
  pondLevel(): number;
  pondR(): number;
  inPond(x: number, z: number): boolean;
  /** 1 = flood the island, 0 = normal pond, -1 = drained to mud (eased over dur seconds) */
  flood(state: -1 | 0 | 1, dur: number): void;
  ripple(x: number, z: number, amp: number): void;
  /** a travelling hump on the water (slot 0..3; h = 0 clears it) */
  bulge(slot: number, x: number, z: number, r: number, h: number): void;
  /** a whirlpool on the pond (k = 0 clears it) */
  vortex(x: number, z: number, r: number, k: number): void;
  shots: WaterShots;
  /** the army answers: spawned from the water / sand around `near` */
  summon(kind: 'croc' | 'catfish' | 'flytrap', n: number, near: { x: number; z: number }, alpha?: boolean): Enemy[];
  /** the King's lurking silhouette hands over / the boss reports in */
  onKingIntro?(): void;
}

// ============================================================================ the boss
export class OasisKing extends Boss {
  /** 0..1 blends driven by the moves */
  private swimW = 0;
  private swim = 0;
  private slideW = 0;
  private slide = 0;
  private rearW = 0;
  private rear = 0;
  private mouthW = 0;
  private mouth = 0;
  private flopW = 0;
  private flop = 0;
  private bellyW = 0;
  private belly = 0;
  private lash = 0;
  private lashW = 0;
  private gillK = 0;
  /** whole-body pose overrides (breach, death) */
  private pitchO = 0;
  private rollO = 0;
  private liftO = 0;
  private sinkO = 0;
  private gait = 0;
  private swimClock = 0;
  private lookYaw = new SpringF(0, 1.2, 0.8);
  private turn = 0;
  private prevYaw = 0;
  private flinch = new SpringF(0, 2.6, 0.4);
  private deadT = -1;
  /** opening after a dodged blow / a botched swallow */
  private exposedT = 0;
  private stranded = 0;
  /** the hunter is inside */
  private swallowed = false;
  private bellyDmg = 0;
  private hunterVis = true;
  private pendingWar = false;
  private warCd = 14;
  private floodCd = 4;
  private army: Enemy[] = [];
  private lastCallout = '';
  private rest: Record<string, THREE.Vector3> = {};
  private bodyPivot = new THREE.Vector3(0, 1.95, 0.4);

  constructor(d: BossDeps, private arena: KingArena, geo: RigGeo, private tier = 1) {
    // the base builds a cheap placeholder; the real rig (built off-thread) is swapped in below
    super(d, 'oasis_king_placeholder', { name: 'The Oasis King', title: 'Heart of Stone, Belly of the Lake', hp: 5200 * tier, scale: 1, eyes: ['organic', 0xc9952c] });
    const old = this.rig;
    this.root.remove(old.root);
    old.material.dispose();
    this.rig = new RigInstance(geo, { ownMaterial: true });
    this.root.add(this.rig.root);
    this.eyes = new RigEyes(this.rig, 'organic', 0xc9952c);
    this.height = (geo.spec.meta?.height as number) ?? 3.6;
    this.radius = 2.6;
    for (const p of geo.parts) this.rest[p.name] = p.offset.clone();
    this.hitSpheres = [
      { node: 'head', r: 2.0, part: 'head', weak: 1.3, offset: [0, 0.05, 1.8] },
      { node: 'body', r: 2.15, part: 'body', offset: [0, 0, 0.9] },
      { node: 'body', r: 1.9, part: 'body', offset: [0, 0, -1.4] },
      { node: 'tail1', r: 1.3, part: 'tail', offset: [0, 0, -1.2] },
      { node: 'tail2', r: 0.85, part: 'tail', offset: [0, 0, -1.0] },
      { node: '__mouth', r: 0.001, part: 'mouth', weak: 2.2 } as HitSphere,
    ];
    this.armor = 40;
    this.physRes = 0.1;
    this.magicRes = 0.1;
    this.statusRes = { poison: 0.4, bleed: 0.2 };
    this.bounty = 420 * tier;
    this.gold = 160 * tier;
    this.phases = [0.66, 0.33];
    if (!d.enemies.qte) d.enemies.qte = d.qte;
    this.setExpr('angry');
  }

  protected hitKind() {
    return 'flesh' as any;
  }

  // ------------------------------------------------------------------ helpers
  private get warn() {
    return this.d.enemies.warn;
  }
  private get haste() {
    return (1 - this.phase * 0.13) * (1 - (this.tier - 1) * 0.08);
  }
  private callout(song: string, big = true) {
    const pos = { x: this.pos.x, y: this.pos.y + this.height + 1.2, z: this.pos.z };
    this.d.enemies.callout(song, pos, 'boss');
    this.ctx.events.emit('enemySkill', { title: song, enemy: this, pos, tier: 'boss' });
    if (big && song !== this.lastCallout) {
      this.lastCallout = song;
      this.ctx.toast(`« ${song} »`, COL, 'The Oasis King');
      this.ctx.engine.tweens.after(2, () => (this.lastCallout = ''));
    }
  }
  private sock(name: string, out: THREE.Vector3) {
    const s = this.rig.sockets[name];
    this.root.updateMatrixWorld(true);
    if (s) s.getWorldPosition(out);
    else out.set(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z);
    return out;
  }
  private ground(x: number, z: number) {
    return this.ctx.world.groundAt(x, z);
  }
  private predicted(t: number) {
    const v = this.player.board.vel;
    return this.playerPos().clone().addScaledVector(_w.set(v.x, 0, v.z), t);
  }
  private inFront(maxD: number, cosMin = 0.2) {
    const dx = this.player.pos.x - this.pos.x, dz = this.player.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return d < maxD && (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / d > cosMin;
  }
  /** clamp a point into the island (the storm, the moat) */
  private clampIsland(x: number, z: number, margin = 6) {
    const a = this.arena;
    const dx = x - a.cx, dz = z - a.cz;
    const d = Math.hypot(dx, dz);
    const R = a.r - margin;
    if (d <= R) return { x, z };
    return { x: a.cx + (dx / d) * R, z: a.cz + (dz / d) * R };
  }
  private async dodge(from: { x: number; z: number }, inZone: () => boolean, up = false) {
    const dg = this.d.enemies.dodge;
    if (!dg.qte) dg.qte = this.d.qte;
    if (!inZone() || !dg.ready()) return false;
    const r = await dg.offer({ from, up });
    this.check();
    return r === 'good' || r === 'perfect';
  }
  private openUp(dur = 2.6) {
    this.exposedT = dur;
    const top = { x: this.pos.x, y: this.pos.y + this.height + 0.8, z: this.pos.z };
    this.d.enemies.callout('OPENING!', top, 'elite');
    this.ctx.sfx('counter_clang', this.pos, 0.8, 0.6);
    this.ctx.fx.sparkle(top, 0xffd36b, 18, 1.6);
  }
  private armyAlive() {
    this.army = this.army.filter((e) => e.alive);
    return this.army.length;
  }
  private roar(pitch = 0.75, vol = 1) {
    this.mouth = 1;
    this.gillK = 1;
    this.ctx.sfx('boss_roar', this.pos, vol, pitch);
    this.ctx.sfx('quake_rumble', this.pos, 0.6 * vol, 0.7);
    this.ctx.shake(0.4);
    const m = this.sock('mouth', new THREE.Vector3());
    this.ctx.particles.emit({ pos: m, count: 14, vel: { x: Math.sin(this.yaw) * 5, y: 1.5, z: Math.cos(this.yaw) * 5 }, spread: 2.2, gravity: 9, life: [0.4, 0.9], size: [0.12, 0.05], sprite: ['dot3', 'dot4', 'bubble'], color: this.arena.shots.murk > 0.5 ? MURK : WATER, drag: 0.6 });
  }
  /** is the point under the King's water (pond / flood)? */
  private wet(x: number, z: number) {
    return this.arena.inPond(x, z) && this.arena.pondLevel() > this.ground(x, z) + 0.05;
  }
  private spray(x: number, z: number, power: number) {
    const g = this.ground(x, z);
    if (this.wet(x, z)) this.arena.shots.splash(x, this.arena.pondLevel(), z, power);
    else this.ctx.fx.sandBurst({ x, y: g, z }, power);
  }

  // ------------------------------------------------------------------ intro: the pond erupts
  async intro() {
    const ctx = this.ctx, cam = this.d.cam;
    ctx.engine.letterbox(true, 0.5);
    this.invulnerable = true;
    this.flying = true;
    const a = this.arena;
    const g = this.ground(this.pos.x, this.pos.z);
    const lvl = Math.max(a.pondLevel(), g);
    this.sinkO = 0;
    this.pos.y = g - 3.6;
    this.swim = 1;
    this.swimW = 1;
    a.onKingIntro?.();
    // a low camera on the bank, looking across the churning water toward the King
    const pp = this.playerPos();
    const toK = new THREE.Vector3(this.pos.x - pp.x, 0, this.pos.z - pp.z);
    const dist = toK.length() || 1;
    toK.multiplyScalar(1 / dist);
    const side = new THREE.Vector3(toK.z, 0, -toK.x);
    const camAt = new THREE.Vector3(this.pos.x, 0, this.pos.z).addScaledVector(toK, -Math.min(22, dist * 0.7)).addScaledVector(side, 6);
    camAt.y = Math.max(this.ground(camAt.x, camAt.z), lvl) + 2.2;
    cam.setCine({ pos: camAt, look: new THREE.Vector3(this.pos.x, lvl + 1.5, this.pos.z), fov: 50 });
    ctx.sfx('quake_rumble', this.pos, 1, 0.55);
    ctx.shake(0.3);
    // the water boils: rings, bubbles, the hump rises
    for (let t = 0; t < 1.6; t += 0.1) {
      a.bulge(0, this.pos.x, this.pos.z, 5 + t * 2, t * 0.6);
      if (rnd.chance(0.5)) a.ripple(this.pos.x + (rnd.next() - 0.5) * 6, this.pos.z + (rnd.next() - 0.5) * 6, 0.4);
      ctx.fx.bubbles({ x: this.pos.x + (rnd.next() - 0.5) * 6, y: lvl, z: this.pos.z + (rnd.next() - 0.5) * 6 }, 3);
      await this.wait(0.1);
    }
    // ERUPTION: it breaches nose-first out of the pond toward the hunter and slams down
    this.faceTarget(pp);
    this.callout('Heart of Stone');
    a.bulge(0, 0, 0, 1, 0);
    ctx.sfx('explosion_big', this.pos, 0.8, 0.55);
    ctx.sfx('boss_roar', this.pos, 1, 0.7);
    this.mouth = 1;
    const from = this.pos.clone();
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const land = this.clampIsland(from.x + fwd.x * 9, from.z + fwd.z * 9, 10);
    const T = 1.25;
    for (let t = 0; t <= T; t += 0.04) {
      const k = t / T;
      this.pos.x = from.x + (land.x - from.x) * k;
      this.pos.z = from.z + (land.z - from.z) * k;
      const gy = this.ground(this.pos.x, this.pos.z);
      this.pos.y = gy - 3.6 * (1 - k) * (1 - k) + Math.sin(k * Math.PI) * 6.5;
      this.pitchO = -1.0 + k * 1.35;
      this.swim = 1 - k;
      if (t < 0.4) a.shots.splash(from.x + (rnd.next() - 0.5) * 4, lvl, from.z + (rnd.next() - 0.5) * 4, 1.8);
      if (k > 0.3 && k < 0.6) cam.setCine({ pos: camAt, look: new THREE.Vector3(this.pos.x, this.pos.y + 2, this.pos.z), fov: 46 });
      await this.wait(0.04);
    }
    this.pitchO = 0.0;
    this.pos.y = this.ground(this.pos.x, this.pos.z);
    this.flying = false;
    this.swim = 0;
    this.spray(this.pos.x, this.pos.z, 2.2);
    ctx.sfx('explosion', this.pos, 1, 0.5);
    if (Math.hypot(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z) < 7) this.player.board.impulse.add(_w.set(this.player.pos.x - this.pos.x, 0, this.player.pos.z - this.pos.z).normalize().multiplyScalar(12).setY(5));
    ctx.world.sand.ring(this.pos.x, this.pos.z, { speed: 16, height: 1.2, width: 2.4, life: 2.2, rise: 0.1, fall: 1.2 });
    a.ripple(this.pos.x, this.pos.z, 1.2);
    ctx.shake(0.9);
    // a close shot of the face: the roar, whiskers whipping, gills flaring
    const face = this.sock('mouth', new THREE.Vector3());
    const close = face.clone().addScaledVector(fwd, 8.5).addScaledVector(side, 3.5);
    close.y = Math.max(close.y + 1.2, this.ground(close.x, close.z) + 1.4);
    cam.setCine({ pos: close, look: face.clone().add(new THREE.Vector3(0, 0.6, 0)), fov: 44 });
    this.lash = 0.5;
    this.roar(0.7, 1);
    this.taunt('You drank from MY water. Now the water drinks YOU.', COL);
    ctx.events.emit('bossIntro', this);
    await this.wait(2.4);
    cam.setCine(null);
    ctx.engine.letterbox(false, 0.5);
    this.invulnerable = false;
    this.mouth = 0;
    this.lash = 0;
    ctx.toast('THE OASIS KING', COL, 'Shoot into the open mouth — it is soft inside', true);
  }

  // ------------------------------------------------------------------ fight loop
  protected async fight() {
    while (true) {
      this.check();
      const p = this.phase;
      if (this.pendingWar) {
        this.pendingWar = false;
        await this.civilWar(true);
        continue;
      }
      if (this.warCd <= 0 && this.armyAlive() < 3 + p * 2) {
        await this.civilWar(false);
        continue;
      }
      if (p >= 1 && this.floodCd <= 0) {
        await this.letItLoose();
        continue;
      }
      const d = this.distToPlayer();
      const r = rnd.next();
      if (d < 10.5 && this.inFront(11, -0.1) && r < 0.45) await this.shacklersRevenge();
      else if (p === 0) {
        if (r < 0.3) await this.locomotive();
        else if (r < 0.55) await this.shotgunBlues();
        else if (r < 0.82) await this.octopussGarden();
        else await this.stalk();
      } else if (p === 1) {
        if (r < 0.22) await this.iWantYou();
        else if (r < 0.42) await this.locomotive();
        else if (r < 0.6) await this.rainFallDown();
        else if (r < 0.8) await this.shotgunBlues();
        else await this.octopussGarden();
      } else {
        if (r < 0.24) {
          await this.locomotive();
          if (rnd.chance(0.55)) await this.locomotive();
        } else if (r < 0.44) await this.iWantYou();
        else if (r < 0.62) {
          void this.rainFallDown().catch(() => {});
          await this.shotgunBlues();
        } else if (r < 0.82) await this.octopussGarden();
        else await this.shotgunBlues();
      }
      await this.wait((p >= 2 ? 0.25 : p === 1 ? 0.45 : 0.7) * this.haste);
    }
  }

  private async stalk() {
    const pp = this.playerPos();
    const t = this.clampIsland(pp.x, pp.z);
    await this.moveTo(t.x, t.z, 6 + this.phase * 1.2, 1.6);
  }

  /** "Locomotive": rears, then toboggans on its belly down a long lane and slams */
  private async locomotive() {
    const ctx = this.ctx;
    this.callout('Locomotive');
    this.stop();
    this.faceTarget(this.predicted(0.6));
    this.rear = 1;
    this.mouth = 0.5;
    ctx.sfx('boss_roar', this.pos, 0.8, 0.95);
    const W = 0.95 * this.haste + 0.15;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const len = Math.min(34, this.distToPlayer() + 12);
    this.warn.bang(this, { tier: 'heavy', life: W, y: this.height + 1 });
    this.warn.lane(this.pos.x, this.pos.z, fwd.x, fwd.z, len, 6.5, W, 'heavy');
    await this.wait(W);
    this.rear = 0;
    this.slide = 1;
    this.mouth = 0.8;
    const end = this.clampIsland(this.pos.x + fwd.x * len, this.pos.z + fwd.z * len, 7);
    this.moveTarget = new THREE.Vector3(end.x, 0, end.z);
    this.moveSpeed = 21 + this.phase * 3;
    ctx.sfx('whoosh_big', this.pos, 1, 0.6);
    ctx.sfx('board_slide_loop', this.pos, 0.8, 0.6);
    let hit = false, offered = false, dodged = false;
    const t0 = this.t;
    try {
      while (this.t - t0 < 2.4 && Math.hypot(end.x - this.pos.x, end.z - this.pos.z) > 2) {
        await this.wait(0.03);
        const hx = this.pos.x + Math.sin(this.yaw) * 5, hz = this.pos.z + Math.cos(this.yaw) * 5;
        this.spray(hx + (rnd.next() - 0.5) * 3, hz + (rnd.next() - 0.5) * 3, 0.9);
        ctx.events.emit('bossPlow', this.pos, this.radius + 1);
        if (rnd.chance(0.4)) ctx.events.emit('groundMark', this.pos.x, this.pos.z, 2.2, 0);
        const pd = Math.hypot(this.player.pos.x - hx, this.player.pos.z - hz);
        if (!offered && pd < 8) {
          offered = true;
          dodged = await this.dodge({ x: hx, z: hz }, () => true);
        }
        if (!hit && !dodged && (pd < 3.4 || this.distToPlayer() < this.radius + 0.6) && this.player.pos.y < this.pos.y + 3) {
          hit = true;
          this.player.takeHit({ base: 30 + this.phase * 6, kind: 'phys', source: 'contact', knock: 18 }, this.pos.clone());
          ctx.shake(0.55);
        }
      }
    } finally {
      this.stop();
      this.slide = 0;
      this.mouth = 0;
    }
    // the slam at the end
    ctx.shake(0.6);
    ctx.sfx('explosion', this.pos, 0.8, 0.6);
    this.spray(this.pos.x, this.pos.z, 1.8);
    ctx.world.sand.ring(this.pos.x, this.pos.z, { speed: 14, height: 0.8, width: 2, life: 1.8, rise: 0.08, fall: 1 });
    this.arena.ripple(this.pos.x, this.pos.z, 0.9);
    if (this.phase >= 2) this.arena.shots.fan(_v.set(this.pos.x, this.pos.y + 1.2, this.pos.z), this.player.center(_w), 14, TAU * 0.92, { speed: 11, dmg: 9, knock: 7 });
    if (dodged) this.openUp(2.6);
    await this.wait((dodged ? 2.2 : 0.6) * this.haste);
  }

  /** "Shotgun Blues": gills flare, fans of water cannon slugs from the mouth */
  private async shotgunBlues() {
    this.callout('Shotgun Blues');
    this.stop();
    this.faceTarget(this.playerPos());
    const vol = 2 + (this.phase >= 1 ? 1 : 0);
    for (let i = 0; i < vol; i++) {
      this.mouth = 0.4;
      this.gillK = 1;
      const W = Math.max(0.35, 0.6 * this.haste);
      this.warn.bang(this, { tier: 'tell', life: W, y: this.height + 1 });
      for (let t = 0; t < W; t += 0.05) {
        this.faceTarget(this.playerPos(), 3, 0.05);
        await this.wait(0.05);
      }
      this.mouth = 1;
      const m = this.sock('mouth', new THREE.Vector3());
      const tgt = this.predicted(0.25);
      tgt.y = this.player.center(_w).y;
      const n = 7 + this.phase * 2 + (i % 2);
      this.arena.shots.fan(m, tgt, n, 1.0 + this.phase * 0.15, { speed: 18 + this.phase * 2, dmg: 11 + this.phase * 2, knock: 11, r: 0.42 });
      if (this.phase >= 1) this.arena.shots.fire(m, tgt, { speed: 26, dmg: 18, knock: 16, r: 0.75, big: true });
      this.ctx.sfx('water_loop', m, 1, 0.7);
      this.ctx.sfx('shotgun_shot', m, 0.5, 0.5);
      this.ctx.shake(0.2);
      this.arena.shots.splash(m.x, m.y - 0.5, m.z, 0.8);
      await this.wait(0.3);
      this.mouth = 0.2;
    }
    this.mouth = 0;
    await this.wait(0.3 * this.haste);
  }

  /** "Shackler's Revenge": the long whiskers rear back and lash a wide arc in front */
  private async shacklersRevenge() {
    this.callout("Shackler's Revenge", false);
    this.stop();
    this.faceTarget(this.playerPos());
    const W = Math.max(0.45, 0.75 * this.haste);
    this.lash = -1;
    this.warn.bang(this, { tier: 'tell', life: W, y: this.height + 1 });
    this.warn.wedge(this.pos.x, this.pos.z, this.yaw, 12, 1.25, W, 'heavy');
    this.ctx.sfx('whoosh', this.pos, 0.8, 0.6);
    await this.wait(W);
    this.lash = 1.4;
    this.ctx.sfx('whoosh_big', this.pos, 1, 0.75);
    await this.wait(0.12);
    if (this.inFront(12.5, -0.3)) {
      this.player.takeHit({ base: 22 + this.phase * 4, kind: 'phys', source: 'contact', knock: 14, status: [{ id: 'slow', stacks: 1, dur: 1.6 }] }, this.pos.clone());
      this.ctx.shake(0.35);
    }
    for (let i = 0; i < 6; i++) {
      const a = this.yaw + (i / 5 - 0.5) * 2.4;
      this.spray(this.pos.x + Math.sin(a) * 9, this.pos.z + Math.cos(a) * 9, 0.6);
    }
    await this.wait(0.45);
    this.lash = 0;
  }

  /** "Octopus's Garden": dives, hunts you as a hump in the water (or the sand), erupts under you, flops down */
  private async octopussGarden() {
    const ctx = this.ctx, a = this.arena;
    this.callout("Octopus's Garden");
    this.stop();
    // head for the pond if it is close, else burrow into the sand where it stands
    const toPond = Math.hypot(this.pos.x - a.cx, this.pos.z - a.cz) - a.pondR();
    if (toPond > 0 && toPond < 22) await this.moveTo(a.cx + (this.pos.x - a.cx) * 0.4, a.cz + (this.pos.z - a.cz) * 0.4, 9, 2);
    this.flying = true;
    this.invulnerable = true;
    this.swim = 1;
    const sandy = !this.wet(this.pos.x, this.pos.z);
    ctx.sfx(sandy ? 'sand_rise' : 'water_loop', this.pos, 1, 0.6);
    let mound = sandy ? ctx.world.sand.mound(this.pos.x, this.pos.z, { height: 1.4, width: 4.5, life: 1e6, rise: 0.4, fall: 0.6 }) : null;
    for (let t = 0; t < 0.9; t += 0.05) {
      this.pos.y = this.ground(this.pos.x, this.pos.z) - (t / 0.9) * 4.2;
      this.pitchO = (t / 0.9) * 0.35;
      this.spray(this.pos.x + (rnd.next() - 0.5) * 4, this.pos.z + (rnd.next() - 0.5) * 4, 0.9);
      await this.wait(0.05);
    }
    this.pitchO = 0;
    this.root.visible = false;
    // the hunt: a hump that homes on the hunter, then a ring that locks
    const hunt = (1.8 + rnd.next() * 0.8) * (this.phase >= 2 ? 0.8 : 1);
    const sp = 11 + this.phase * 2.5;
    let t = 0;
    try {
      while (t < hunt) {
        const pp = this.playerPos();
        const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const step = Math.min(d, sp * 0.05);
        const nx = this.pos.x + (dx / d) * step, nz = this.pos.z + (dz / d) * step;
        const c = this.clampIsland(nx, nz, 4);
        this.pos.x = c.x;
        this.pos.z = c.z;
        this.yaw = Math.atan2(dx, dz);
        if (this.wet(this.pos.x, this.pos.z)) {
          a.bulge(0, this.pos.x, this.pos.z, 3.5, 0.55);
          if (rnd.chance(0.5)) ctx.fx.bubbles({ x: this.pos.x + (rnd.next() - 0.5) * 3, y: a.pondLevel(), z: this.pos.z + (rnd.next() - 0.5) * 3 }, 2);
          if (mound) {
            ctx.world.sand.remove(mound);
            mound = null;
          }
        } else {
          a.bulge(0, 0, 0, 1, 0);
          if (!mound) mound = ctx.world.sand.mound(this.pos.x, this.pos.z, { height: 1.4, width: 4.5, life: 1e6, rise: 0.3, fall: 0.6 });
          mound.x = this.pos.x;
          mound.z = this.pos.z;
          if (rnd.chance(0.6)) ctx.fx.sandSpray({ x: this.pos.x, y: this.ground(this.pos.x, this.pos.z), z: this.pos.z }, { x: (dx / d) * 2, y: 2.5, z: (dz / d) * 2 }, 1.4);
        }
        if (rnd.chance(0.15)) ctx.sfx('quake_rumble', this.pos, 0.35, 1.2);
        this.pos.y = this.ground(this.pos.x, this.pos.z) - 4.2;
        t += 0.05;
        await this.wait(0.05);
      }
      // lock: a ring where it will burst out
      const at = this.predicted(0.35);
      const c = this.clampIsland(at.x, at.z, 4);
      this.pos.x = c.x;
      this.pos.z = c.z;
      const lead = Math.max(0.45, 0.75 * this.haste);
      this.warn.circle(c.x, c.z, 5.2, lead + 0.1, 'heavy');
      this.warn.bang({ x: c.x, y: this.ground(c.x, c.z), z: c.z }, { tier: 'heavy', life: lead, y: 3 });
      a.bulge(0, c.x, c.z, 5, 0.9);
      ctx.sfx('quake_rumble', this.pos, 0.9, 0.8);
      ctx.shake(0.25);
      await this.wait(lead);
    } finally {
      a.bulge(0, 0, 0, 1, 0);
      if (mound) ctx.world.sand.remove(mound);
    }
    // ERUPT: straight up out of the water / sand, mouth wide
    const g = this.ground(this.pos.x, this.pos.z);
    this.root.visible = true;
    this.invulnerable = false;
    this.mouth = 1;
    this.faceTarget(this.playerPos());
    ctx.sfx('explosion_big', this.pos, 0.7, 0.6);
    ctx.sfx('boss_roar', this.pos, 0.9, 0.85);
    this.spray(this.pos.x, this.pos.z, 2.4);
    a.ripple(this.pos.x, this.pos.z, 1.4);
    ctx.shake(0.7);
    const pd = Math.hypot(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z);
    // standing right on top of it: straight into the mouth (phase 2+), else tossed into the air
    if (pd < 3.2 && this.phase >= 1 && this.player.alive) {
      await this.savoyTruffle();
      this.flying = false;
      this.swim = 0;
      return;
    }
    if (pd < 5.4 && this.player.pos.y < g + 3) {
      this.player.takeHit({ base: 26 + this.phase * 5, kind: 'phys', source: 'contact', knock: 10 }, this.pos.clone());
      this.player.board.impulse.y += 11;
    }
    const T = 1.0;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const from = this.pos.clone();
    for (let k = 0; k <= 1; k += 0.05 / T) {
      this.pos.x = from.x + fwd.x * 6 * k;
      this.pos.z = from.z + fwd.z * 6 * k;
      this.pos.y = this.ground(this.pos.x, this.pos.z) - 4.2 * (1 - k) * (1 - k) + Math.sin(k * Math.PI) * 5.5;
      this.pitchO = -1.1 + k * 1.3;
      this.swim = 1 - k;
      await this.wait(0.05);
    }
    this.pitchO = 0;
    this.flying = false;
    this.swim = 0;
    this.mouth = 0;
    // the belly flop
    const lp = this.pos.clone();
    ctx.shake(0.8);
    ctx.sfx('explosion', lp, 1, 0.55);
    this.spray(lp.x, lp.z, 2.6);
    ctx.world.sand.ring(lp.x, lp.z, { speed: 15, height: 1.0, width: 2.2, life: 2, rise: 0.08, fall: 1.1 });
    a.ripple(lp.x, lp.z, 1.3);
    if (Math.hypot(this.player.pos.x - lp.x, this.player.pos.z - lp.z) < 7 && this.player.pos.y < lp.y + 2.4) this.player.takeHit({ base: 24 + this.phase * 4, kind: 'phys', source: 'contact', knock: 15 }, lp);
    if (this.phase >= 1) this.arena.shots.fan(_v.set(lp.x, lp.y + 1, lp.z), this.player.center(_w), 18, TAU * 0.95, { speed: 10, dmg: 8, knock: 6 });
    this.openUp(1.6);
    await this.wait(1.0 * this.haste);
  }

  /** "Civil War": tail slaps, the army bursts out of the water and the sand */
  private async civilWar(big: boolean) {
    const ctx = this.ctx, a = this.arena;
    this.callout('Civil War');
    this.stop();
    this.roar(0.8, big ? 1 : 0.7);
    this.taunt(rnd.pick(['To arms, my scaled ones!', 'Rise, children of the deep water!', 'The King calls — the lake answers!', 'Eat him!']), COL);
    this.warn.bang(this, { tier: 'tell', life: 0.9, y: this.height + 1 });
    for (let i = 0; i < 3; i++) {
      this.flinch.kick(6);
      this.spray(this.pos.x - Math.sin(this.yaw) * 8, this.pos.z - Math.cos(this.yaw) * 8, 1.4);
      ctx.sfx('punch', this.pos, 0.6, 0.5);
      await this.wait(0.25);
    }
    const p = this.phase;
    const pp = this.playerPos();
    const near = { x: (pp.x + this.pos.x) / 2, z: (pp.z + this.pos.z) / 2 };
    const spawned: Enemy[] = [];
    spawned.push(...a.summon('croc', big ? 2 + p : 1 + (p >= 2 ? 1 : 0), near));
    spawned.push(...a.summon('catfish', big ? 1 + p : 1, near));
    if (p >= 1) spawned.push(...a.summon('flytrap', big ? 2 : 1, near, big && p >= 2));
    this.army.push(...spawned);
    this.warCd = (p >= 2 ? 15 : 19) + rnd.next() * 4;
    await this.wait(0.8 * this.haste);
  }

  /** "I Want You (She's So Heavy)": a whirlpool drags you toward the open mouth; reach it and it swallows you */
  private async iWantYou() {
    const ctx = this.ctx, a = this.arena;
    this.callout("I Want You (She's So Heavy)");
    this.stop();
    this.faceTarget(this.playerPos());
    this.rear = 0.5;
    this.mouth = 1;
    this.gillK = 1;
    const m = this.sock('mouth', new THREE.Vector3());
    const R = 15 + this.phase * 2;
    const W = 0.7 * this.haste;
    this.warn.bang(this, { tier: 'grab', life: W + 0.4, y: this.height + 1 });
    this.warn.circle(m.x, m.z, R, W + 3.2, 'grab');
    ctx.sfx('wind_loop', this.pos, 1, 0.5);
    await this.wait(W);
    const dur = 3.3 + this.phase * 0.4;
    let caught = false;
    const t0 = this.t;
    try {
      while (this.t - t0 < dur) {
        const k = Math.min(1, (this.t - t0) / 0.8);
        this.sock('mouth', m);
        a.vortex(m.x, m.z, R, k);
        const pp = this.player.pos;
        const dx = m.x - pp.x, dz = m.z - pp.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d < R && this.player.alive) {
          // the drag: an acceleration toward the maw, stronger the closer you are (boost out!)
          const pull = (9 + this.phase * 3) * k * (0.45 + 0.55 * (1 - d / R));
          this.player.board.vel.x += (dx / d) * pull * 0.05;
          this.player.board.vel.z += (dz / d) * pull * 0.05;
        }
        // spiralling spray and sand into the maw
        for (let i = 0; i < 3; i++) {
          const ang = rnd.next() * TAU, rr = R * (0.3 + rnd.next() * 0.7);
          const px = m.x + Math.cos(ang) * rr, pz = m.z + Math.sin(ang) * rr;
          const tx = -Math.sin(ang), tz = Math.cos(ang);
          const gy = this.ground(px, pz);
          ctx.particles.emit({ pos: { x: px, y: Math.max(gy, this.wet(px, pz) ? a.pondLevel() : gy) + 0.2, z: pz }, count: 1, vel: { x: (m.x - px) * 0.9 + tx * 6, y: 0.6, z: (m.z - pz) * 0.9 + tz * 6 }, life: [0.6, 0.9], size: [0.1, 0.04], sprite: ['dot3', 'grain0', 'bubble'], color: this.wet(px, pz) ? (a.shots.murk > 0.5 ? MURK : WATER) : [0xe0c08a, 0xc9a06a], drag: 0.4 });
        }
        if (d < 3.6 && this.player.alive && this.player.pos.y < m.y + 2) {
          caught = true;
          break;
        }
        await this.wait(0.05);
      }
    } finally {
      a.vortex(0, 0, 1, 0);
    }
    if (caught) await this.savoyTruffle();
    else {
      this.mouth = 0;
      this.rear = 0;
      // it gasps: an opening
      this.openUp(1.8);
      await this.wait(1.2 * this.haste);
    }
  }

  /**
   * "Savoy Truffle": the hunter is swallowed. Shoot the belly from inside (the
   * shots still land) or mash E to burst out. Fail and it digests a bite, then
   * retches you up anyway.
   */
  private async savoyTruffle() {
    const ctx = this.ctx, cam = this.d.cam, pl = this.player;
    this.callout('Savoy Truffle');
    this.stop();
    this.mouth = 1;
    ctx.sfx('scarab_squish', this.pos, 1, 0.4);
    ctx.sfx('water_loop', this.pos, 1, 0.5);
    ctx.shake(0.5);
    this.swallowed = true;
    this.radius = 0.1; // no contact bumps while the hunter is inside
    this.bellyDmg = 0;
    this.hunterVis = pl.root.visible;
    pl.root.visible = false;
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let escaped = false;
    try {
      await this.wait(0.25);
      this.mouth = 0;
      this.belly = 1;
      // a side shot of the swollen belly: shoot it from inside
      const b = this.sock('belly', new THREE.Vector3());
      const cp = b.clone().addScaledVector(side, 13).add(new THREE.Vector3(0, 2.5, 0));
      cp.y = Math.max(cp.y, this.ground(cp.x, cp.z) + 1.6);
      cam.setCine({ pos: cp, look: b.clone().add(new THREE.Vector3(0, 0.6, 0)), fov: 52 });
      ctx.toast('SWALLOWED!', '#ff8a6a', 'Shoot the belly from inside — then mash E', true);
      const need = this.maxHp * (0.035 + this.phase * 0.004);
      for (let t = 0; t < 2.8 && !escaped; t += 0.1) {
        await this.wait(0.1);
        if (Math.floor(t * 10) % 5 === 0) {
          pl.applyDamage(3 + this.phase, 'contact', true);
          ctx.sfx('poison_tick', this.pos, 0.4, 0.6);
        }
        if (this.bellyDmg >= need) escaped = true;
      }
      if (!escaped) {
        const r = await this.qte({ kind: 'mash', key: 'KeyE', label: 'BURST OUT', duration: 2.4, target: 14 + this.phase * 2 });
        escaped = r !== 'fail';
        if (!escaped) {
          pl.applyDamage(26 + this.phase * 6, 'contact', false);
          ctx.toast('DIGESTED…', '#ff6a3a', 'It spits out what it cannot stomach');
        }
      }
    } finally {
      // retch: the hunter comes back out of the mouth in a geyser
      this.swallowed = false;
      this.radius = 2.6;
      this.belly = 0;
      this.mouth = 1;
      const m = this.sock('mouth', new THREE.Vector3());
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const out = m.clone().addScaledVector(fwd, 2.5);
      pl.board.pos.set(out.x, this.ground(out.x, out.z), out.z);
      pl.board.vel.set(fwd.x * 6, 0, fwd.z * 6);
      pl.board.impulse.set(fwd.x * 15, 8, fwd.z * 15);
      pl.root.visible = this.hunterVis;
      pl.invuln = Math.max(pl.invuln, 1.1);
      this.arena.shots.splash(m.x, m.y - 0.6, m.z, 2);
      ctx.sfx('gore_splat', m, 0.8, 0.6);
      ctx.sfx('water_loop', m, 1, 0.9);
      ctx.shake(0.4);
      cam.setCine(null);
    }
    if (escaped) {
      ctx.toast('BURST OUT!', '#9dff3a', 'It is reeling — hit it now');
      this.setExpr('hurt');
      this.openUp(2.8);
      await this.wait(1.6);
      this.setExpr(this.phase >= 2 ? 'enraged' : 'angry');
    } else await this.wait(0.6);
    this.mouth = 0;
  }

  /** "Rain Fall Down": a geyser from the mouth, then water bombs fall on marked rings round the hunter */
  private async rainFallDown() {
    const ctx = this.ctx;
    this.callout('Rain Fall Down');
    this.stop();
    this.rear = 1;
    this.mouth = 1;
    const m = this.sock('mouth', new THREE.Vector3());
    for (let i = 0; i < 6; i++) {
      ctx.particles.emit({ pos: m, count: 10, vel: { x: 0, y: 16, z: 0 }, spread: 2, gravity: 10, life: [0.6, 1.1], size: [0.18, 0.08], sprite: ['dot4', 'dot3', 'bubble'], color: this.arena.shots.murk > 0.5 ? MURK : WATER });
      await this.wait(0.06);
    }
    ctx.sfx('water_loop', m, 1, 0.6);
    this.rear = 0;
    this.mouth = 0;
    const n = 7 + this.phase * 3;
    const pp = this.playerPos().clone();
    const pv = this.player.board.vel;
    const spots: THREE.Vector3[] = [new THREE.Vector3(pp.x + pv.x * 0.9, 0, pp.z + pv.z * 0.9)];
    for (let i = 1; i < n; i++) {
      const a = rnd.next() * TAU, r = 2.5 + rnd.next() * 9;
      spots.push(new THREE.Vector3(pp.x + Math.cos(a) * r, 0, pp.z + Math.sin(a) * r));
    }
    for (const s of spots) {
      s.y = this.ground(s.x, s.z);
      this.warn.circle(s.x, s.z, 2.6, 1.3 * this.haste + 0.3, 'heavy');
    }
    await this.wait(0.55 * this.haste);
    for (const s of spots) {
      const from = { x: s.x + (rnd.next() - 0.5) * 2, y: s.y + 22, z: s.z + (rnd.next() - 0.5) * 2 };
      this.arena.shots.fire(from, s, { speed: 26, dmg: 16 + this.phase * 3, knock: 10, r: 0.7, splash: 2.6, big: true });
      await this.wait(0.07);
    }
    await this.wait(0.7 * this.haste);
  }

  /**
   * "Let It Loose": the pond floods the island; the King submerges and rams as a fin.
   * Then the water drains away ("Dust N' Bones" when enraged) and leaves it stranded.
   */
  private async letItLoose() {
    const ctx = this.ctx, a = this.arena;
    this.floodCd = 32 + rnd.next() * 8;
    this.callout('Let It Loose');
    this.stop();
    this.taunt(rnd.pick(['The lake rises when I say it rises.', 'Swim, little bones.', 'All of this was water once.']), COL);
    this.roar(0.75, 1);
    for (let i = 0; i < 2; i++) {
      this.flinch.kick(8);
      this.spray(this.pos.x, this.pos.z, 2);
      ctx.sfx('explosion', this.pos, 0.6, 0.5);
      await this.wait(0.35);
    }
    a.flood(1, 2.6);
    ctx.toast('THE ISLAND FLOODS', COL, 'Keep moving — watch the fin', true);
    await this.wait(1.6);
    // fin passes: submerged, only the dorsal fin and back cut the water
    this.swim = 1;
    this.sinkO = 2.1;
    this.invulnerable = false;
    const passes = 2 + this.phase;
    for (let i = 0; i < passes; i++) {
      const pp = this.playerPos();
      const dir = new THREE.Vector3(pp.x - this.pos.x, 0, pp.z - this.pos.z);
      const d = dir.length() || 1;
      dir.multiplyScalar(1 / d);
      this.yaw = Math.atan2(dir.x, dir.z);
      const len = d + 10;
      const W = 0.7 * this.haste;
      this.warn.lane(this.pos.x, this.pos.z, dir.x, dir.z, len, 5, W + 0.4, 'heavy');
      await this.wait(W);
      const end = this.clampIsland(this.pos.x + dir.x * len, this.pos.z + dir.z * len, 6);
      this.moveTarget = new THREE.Vector3(end.x, 0, end.z);
      this.moveSpeed = 17 + this.phase * 3;
      let hit = false;
      const t0 = this.t;
      while (this.t - t0 < 2.2 && Math.hypot(end.x - this.pos.x, end.z - this.pos.z) > 2) {
        await this.wait(0.04);
        const fin = this.sock('dorsal_tip', _v);
        a.bulge(1, this.pos.x + Math.sin(this.yaw) * 3, this.pos.z + Math.cos(this.yaw) * 3, 3, 0.45);
        if (rnd.chance(0.7)) a.shots.splash(fin.x, a.pondLevel(), fin.z, 0.45);
        if (!hit && this.distToPlayer() < 4.2) {
          hit = true;
          this.mouth = 1;
          this.player.takeHit({ base: 24 + this.phase * 4, kind: 'phys', source: 'contact', knock: 14 }, this.pos.clone());
          this.player.board.impulse.y += 6;
        }
      }
      this.stop();
      this.mouth = 0;
      a.bulge(1, 0, 0, 1, 0);
      await this.wait(0.4 * this.haste);
    }
    this.sinkO = 0;
    this.swim = 0;
    // the drain: the water runs out of the bowl, the King is left flopping on the mud
    const enraged = this.phase >= 2;
    this.callout(enraged ? "Dust N' Bones" : 'Let It Loose', enraged);
    a.flood(-1, 2.2);
    ctx.sfx('water_loop', this.pos, 1, 0.4);
    await this.wait(1.4);
    this.stranded = enraged ? 4.2 : 4.6;
    this.flop = 1;
    this.setExpr('stunned');
    ctx.toast('STRANDED!', '#ffd36b', 'The King is beached — unload on it', true);
    const tS = this.t;
    while (this.t - tS < this.stranded) {
      await this.wait(enraged ? 0.55 : 0.8);
      // every heave slaps the mud; enraged, the slaps ring out shock waves
      this.flinch.kick(9);
      ctx.shake(0.3);
      ctx.sfx('punch', this.pos, 0.7, 0.45);
      ctx.fx.dust({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z }, 3, 0x6a5a3a, 6);
      if (enraged) {
        ctx.world.sand.ring(this.pos.x, this.pos.z, { speed: 12, height: 0.6, width: 1.6, life: 1.4, rise: 0.06, fall: 0.8 });
        if (Math.hypot(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z) < 7 && this.player.pos.y < this.pos.y + 1.5) this.player.takeHit({ base: 16, kind: 'phys', source: 'contact', knock: 10 }, this.pos.clone());
      }
    }
    this.stranded = 0;
    this.flop = 0;
    this.setExpr(enraged ? 'enraged' : 'angry');
    a.flood(0, 3);
    this.roar(0.85, 0.8);
    await this.wait(0.6);
  }

  // ------------------------------------------------------------------ damage, phases
  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    if (!this.alive) return 0;
    const m = (this.exposedT > 0 ? 1.5 : 1) * (this.stranded > 0 ? 1.6 : 1) * (this.swallowed ? 1.35 : 1);
    const amt = super.takeDamage({ ...hit, mult: (hit.mult ?? 1) * m }, point, dir);
    if (amt > 0) {
      this.flinch.kick(-1.5 - (amt / this.maxHp) * 60);
      if (this.swallowed) {
        this.bellyDmg += amt;
        this.belly = 1.25;
      }
    }
    return amt;
  }

  protected onPhase(p: number) {
    super.onPhase(p);
    this.pendingWar = true;
    this.floodCd = Math.min(this.floodCd, p === 1 ? 6 : 10);
    if (p === 1) this.taunt('You have not even wet your boots yet.', COL);
    if (p === 2) this.taunt('ENOUGH! THE WHOLE LAKE IS MY MOUTH!', COL);
  }

  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    const best = super.hitTest(o, d, maxT);
    if (!this.alive || this.mouthW < 0.4 || !this.root.visible) return best;
    // the open mouth is a weak point
    const c = this.sock('throat', _v);
    const r = 1.6;
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const disc = b * b - (ox * ox + oy * oy + oz * oz - r * r);
    if (disc < 0) return best;
    let t = -b - Math.sqrt(disc);
    if (t < 0) t = -b + Math.sqrt(disc);
    if (t < 0 || t > (best?.t ?? maxT) + 1.2) return best;
    const point = o.clone().addScaledVector(d, t);
    return { enemy: this, t, point, normal: point.clone().sub(c).normalize(), headshot: true, part: 'mouth', surface: 'enemy' } as RayHit;
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number) {
    super.update(dt);
    if (!this.alive) {
      if (this.deadT >= 0) this.deadT += dt;
      return;
    }
    this.warCd -= dt;
    this.floodCd -= dt;
    this.exposedT = Math.max(0, this.exposedT - dt);
    if (this.exposedT > 0 && rnd.chance(dt * 10))
      this.ctx.particles.emit({ pos: { x: this.pos.x + (rnd.next() - 0.5) * 4, y: this.pos.y + this.height * (0.4 + rnd.next() * 0.6), z: this.pos.z + (rnd.next() - 0.5) * 4 }, count: 1, vel: { x: 0, y: 0.7, z: 0 }, life: [0.3, 0.5], size: [0.5, 0.08], sprite: 'star4', additive: true, color: [0xffd36b, 0xffffff] });
    // between moves it keeps its face toward the hunter
    if (!this.moveTarget && this.slide === 0 && this.stranded === 0 && this.root.visible && !this.swallowed) this.faceTarget(this.player.pos, 1.6, dt);
    // swallowed: the hunter rides inside the belly
    if (this.swallowed) {
      const b = this.sock('belly', _v);
      const pb = this.player.board;
      pb.pos.set(b.x, this.ground(b.x, b.z), b.z);
      pb.vel.set(0, 0, 0);
      this.player.root.visible = false;
    }
    // wading: a wake in the pond
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 2 && this.root.visible && this.wet(this.pos.x, this.pos.z) && rnd.chance(dt * 12)) {
      const s = rnd.sign();
      this.arena.shots.splash(this.pos.x + Math.cos(this.yaw) * 2.4 * s, this.arena.pondLevel(), this.pos.z - Math.sin(this.yaw) * 2.4 * s, 0.5);
    }
    // heavy footfalls on dry ground
    if (sp > 1 && this.slide === 0 && this.swim < 0.5 && rnd.chance(dt * sp * 0.25)) this.ctx.sfx('footstep_sand', this.pos, 0.6, 0.35);
  }

  private node(name: string) {
    return this.rig.nodes[name];
  }
  private R(name: string, x: number, y = 0, z = 0) {
    const n = this.rig.nodes[name];
    if (n) n.rotation.set(x, y, z);
  }

  protected animate(dt: number) {
    const t = this.t;
    const k = (w: number, target: number, rate: number) => damp(w, target, rate, dt);
    this.swimW = k(this.swimW, this.swim, 3);
    this.slideW = k(this.slideW, this.slide, 7);
    this.rearW = k(this.rearW, this.rear, 4);
    this.mouthW = k(this.mouthW, this.mouth, 9);
    this.flopW = k(this.flopW, this.flop, 5);
    this.bellyW = k(this.bellyW, this.belly, 5);
    this.lashW = k(this.lashW, this.lash, this.lash > 1 ? 16 : 5);
    this.gillK = Math.max(0, this.gillK - dt * 0.8);
    this.flinch.step(0, dt);
    const dead = !this.alive;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const moving = clamp(sp / 1.2, 0, 1) * (1 - this.slideW) * (1 - this.swimW) * (1 - this.flopW) * (dead ? 0 : 1);
    this.gait += clamp(sp * 0.3, 0.7, 2.6) * dt * (sp > 0.3 ? 1 : 0);
    this.swimClock += dt * (1.2 + sp * 0.15 + this.swimW * 1.2);
    let dy = this.yaw - this.prevYaw;
    while (dy > Math.PI) dy -= TAU;
    while (dy < -Math.PI) dy += TAU;
    this.prevYaw = this.yaw;
    this.turn = damp(this.turn, dy / Math.max(dt, 1e-3), 4, dt);
    const breath = Math.sin(t * 1.3);
    // ---- the whole body: breach pitch, slide flatten, rear, flop roll, death roll, sink
    const pitch = this.pitchO - this.rearW * 0.22 + this.slideW * 0.06 + this.flinch.x * 0.02;
    const roll = this.rollO + (this.flopW > 0.01 ? Math.sin(t * 5.5) * 0.32 * this.flopW : 0) + this.turn * 0.04 * (1 - this.slideW);
    const lift = this.liftO + this.rearW * 0.35 - this.slideW * 0.45 - this.flopW * 0.35 - this.swimW * 0.25 - this.sinkO;
    _e.set(pitch, 0, roll, 'YXZ');
    _q.setFromEuler(_e);
    const P = this.bodyPivot;
    _v.copy(P).applyQuaternion(_q);
    this.rig.root.quaternion.copy(_q);
    this.rig.root.position.set(P.x - _v.x, P.y - _v.y + lift, P.z - _v.z);
    // ---- legs: a heavy, stubby trot; tucked back to slide and swim; pedalling the air when beached
    const tuck = Math.max(this.slideW, this.swimW);
    const L: [string, number, number, boolean][] = [['fl', GAITS.trot.fl, 1, true], ['fr', GAITS.trot.fr, -1, true], ['bl', GAITS.trot.bl, 1, false], ['br', GAITS.trot.br, -1, false]];
    for (const [key, off, s, front] of L) {
      const l = leg(this.gait + off, 0.6, _leg);
      let yaw = -s * l.sweep * 0.42 * moving;
      let lift2 = s * l.lift * 0.5 * moving;
      // tucked flat against the flanks, swept back
      yaw = yaw * (1 - tuck) + s * (front ? 0.9 : 0.6) * tuck;
      lift2 = lift2 * (1 - tuck) + s * 0.55 * tuck;
      if (this.flopW > 0.01) {
        yaw += Math.sin(t * 9 + off * 7) * 0.4 * this.flopW;
        lift2 += s * (0.3 + Math.sin(t * 7 + off * 5) * 0.4) * this.flopW;
      }
      if (dead) lift2 += s * 0.7 * Math.min(1, this.deadT);
      this.R('leg_' + key, 0, yaw, lift2);
      this.R('foot_' + key, 0, -yaw * 0.5, -lift2 * 0.85);
    }
    // ---- spine and tail: a salamander S-wave walking, a strong scull swimming, slaps when beached
    const walkWave = Math.sin(this.gait * TAU) * 0.07 * moving;
    this.R('body', 0, walkWave + this.flinch.x * 0.015, 0);
    const swimAmp = 0.22 * this.swimW + 0.05 + 0.1 * moving + 0.35 * this.flopW;
    const freq = this.flopW > 0.01 ? 6 : 2.2 + this.swimW * 1.5;
    for (let i = 1; i <= 3; i++) {
      const lag = i * 0.85;
      const a = Math.sin(this.swimClock * freq - lag) * swimAmp * (0.6 + i * 0.35) - this.turn * 0.12 * i + (this.slideW > 0.01 ? Math.sin(t * 4 - lag) * 0.12 : 0);
      const up = this.slideW * 0.12 + (dead ? -0.1 : 0) + Math.sin(t * 0.9 + i) * 0.015;
      this.R('tail' + i, up, a, 0);
    }
    // ---- head: looks at the hunter, lifts as the mouth opens, shakes when hit
    const lx = this.player.pos.x - this.pos.x, lz = this.player.pos.z - this.pos.z;
    const ly = Math.atan2(lx * Math.cos(this.yaw) - lz * Math.sin(this.yaw), lx * Math.sin(this.yaw) + lz * Math.cos(this.yaw));
    this.lookYaw.step(dead ? 0 : clamp(ly, -0.45, 0.45) * (1 - this.slideW), dt);
    this.R('head', -this.mouthW * 0.32 - this.rearW * 0.18 + breath * 0.012 + this.flinch.x * 0.03 + (dead ? 0.15 : 0), this.lookYaw.x - walkWave * 0.6, Math.sin(t * 0.7) * 0.02);
    this.R('jaw', this.rig.exprJaw + this.mouthW * 0.82 + Math.max(0, breath) * 0.03 + (dead ? 0.35 : 0));
    // ---- gills flare with the breath, the roar and every gulp
    const gill = 0.08 + Math.max(0, Math.sin(t * 1.3 + 0.6)) * 0.12 + this.gillK * 0.45 + this.mouthW * 0.2;
    this.R('gill_l', 0, -gill, 0);
    this.R('gill_r', 0, gill, 0);
    // ---- whiskers: long lagging waves, swept back by speed, a wide lash on cue
    const drag = clamp(sp / 12, 0, 1) * 0.5 + this.swimW * 0.4;
    for (const s of [1, -1]) {
      for (let i = 1; i <= 3; i++) {
        const lag = i * 0.75;
        let sway = Math.sin(t * 1.1 - lag + (s > 0 ? 0 : 1.7)) * (0.12 + 0.05 * i) + drag * (0.35 + i * 0.1) - this.turn * 0.15 * i * s;
        let droop = -0.05 + Math.sin(t * 0.8 - lag) * 0.06 - (dead ? 0.25 : 0);
        if (Math.abs(this.lashW) > 0.01) {
          sway += this.lashW < 0 ? this.lashW * 0.75 * (i === 1 ? 1 : 0.6) : -this.lashW * (0.6 + i * 0.25) + Math.sin(t * 18 - lag) * 0.15 * this.lashW;
          droop += 0.1 * Math.abs(this.lashW);
        }
        if (this.slideW > 0.01) sway += this.slideW * 0.5;
        this.R(`whisker_${s > 0 ? 'l' : 'r'}${i}`, 0, sway * s, droop * -s);
      }
      this.R(s > 0 ? 'chin_l' : 'chin_r', Math.sin(t * 1.6 + s) * 0.08 + drag * 0.3 - this.mouthW * 0.2, 0, Math.sin(t * 1.2 + s) * 0.06 * s);
    }
    // ---- fins
    const fl = Math.sin(t * 2.4) * 0.08 + this.swimW * Math.sin(this.swimClock * 3) * 0.25;
    this.R('fin_pec_l', 0, -0.1 + fl * 0.5 - tuck * 0.35, fl);
    this.R('fin_pec_r', 0, 0.1 - fl * 0.5 + tuck * 0.35, -fl);
    this.R('fin_dorsal', -this.swimW * 0.1 - this.slideW * 0.35 + (this.phase >= 2 ? 0.05 : 0) + Math.sin(t * 1.7) * 0.03, Math.sin(t * 1.1) * 0.03, 0);
    // ---- the belly: swollen with a hunter inside, squirming as he fights
    const bm = this.rig.meshes['belly'];
    if (bm) {
      const bw = this.bellyW;
      const sq = bw > 0.02 ? Math.sin(t * 9) * 0.05 * bw + Math.sin(t * 13.3) * 0.03 * bw : 0;
      bm.scale.set(1 + bw * 0.12 + sq, 1 + bw * 0.22 - sq * 0.5, 1 + bw * 0.1);
      bm.position.set(0, -bw * 0.1, 0);
    }
  }

  // ------------------------------------------------------------------ death: belly up into the pond — "The End"
  die() {
    if (!this.alive) return;
    this.alive = false;
    const ctx = this.ctx;
    this.deadT = 0;
    this.setExpr('defeated');
    ctx.engine.slowMo(0.2, 30);
    ctx.engine.tweens.after(1.4, () => ctx.engine.slowMo(1, 3), true);
    ctx.sfx('boss_death', this.pos, 1, 0.7);
    ctx.sfx('boss_roar', this.pos, 1, 0.55);
    ctx.shake(0.9);
    ctx.engine.flash(0xe8fff4, 0.35, 0.6);
    this.callout('The End');
    this.taunt('The water… was never… mine…', COL);
    if (this.swallowed) {
      this.swallowed = false;
      this.player.root.visible = this.hunterVis;
      this.d.cam.setCine(null);
    }
    this.arena.vortex(0, 0, 1, 0);
    this.arena.bulge(0, 0, 0, 1, 0);
    this.arena.bulge(1, 0, 0, 1, 0);
    this.stop();
    this.flying = true;
    this.mouth = 0.6;
    this.lash = 0;
    this.swim = 0;
    this.slide = 0;
    this.flop = 0;
    ctx.events.emit('bossKilled', this);
    ctx.events.emit('oasisKingDefeated', this);
    void (async () => {
      const tw = ctx.engine.tweens;
      const y0 = this.pos.y;
      // a last thrash, then it rolls over onto its back and settles, gills slowing
      for (let t = 0; t < 1.8; t += 0.05) {
        this.rollO = Math.sin(t * 9) * 0.3 * (1 - t / 1.8) + (t / 1.8) ** 2 * Math.PI * 0.95;
        this.liftO = Math.sin((t / 1.8) * Math.PI) * 0.8;
        if (rnd.chance(0.3)) this.spray(this.pos.x + (rnd.next() - 0.5) * 6, this.pos.z + (rnd.next() - 0.5) * 6, 1);
        await tw.wait(0.05);
      }
      this.spray(this.pos.x, this.pos.z, 2.6);
      this.arena.ripple(this.pos.x, this.pos.z, 1.5);
      ctx.shake(0.5);
      ctx.fx.coins({ x: this.pos.x, y: this.pos.y + 3, z: this.pos.z }, 40);
      await tw.wait(2.2);
      // it sinks away under the clearing water
      for (let t = 0; t < 3; t += 0.05) {
        this.pos.y = y0 - (t / 3) ** 2 * 5;
        if (rnd.chance(0.3)) ctx.fx.bubbles({ x: this.pos.x + (rnd.next() - 0.5) * 6, y: this.arena.pondLevel(), z: this.pos.z + (rnd.next() - 0.5) * 6 }, 3);
        await tw.wait(0.05);
      }
      this.root.visible = false;
      this.onDefeated?.(this, false);
      this.dispose();
    })();
  }
}
