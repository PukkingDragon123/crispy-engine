// "Old Thornback": an ancient ~5 m thorny devil with a saguaro growing out of
// its back and a crown of bleached bone. A skittering, push-up-pumping miniboss
// that cries blood in sweeping twin streams, flings it skyward to rain back
// down, curls into a rolling ball of spikes, and shakes needle rings off the
// cactus on its back. Every move is called out by its song title.
//
// INTEGRATION (BossRoster.ts — this file does not touch it):
//   import { Thornback } from './Thornback';
//   // in makeBoss(): give it a debut wave and a slot in the rotation, e.g.
//   //   first[55] = 'thornback';   rot.push('thornback');
//   if (k === 'thornback') return new Thornback(d, tier);
// Everything else (spawn point, intro cut-in, HUD boss bar, bounty drop) is the
// generic Boss path RunScene already runs. Callouts go through
// `enemies.callout()` and the `enemySkill` event (tier 'boss').
import * as THREE from 'three';
import { Boss, BossDeps } from './Boss';
import type { Hit } from '../combat/Damage';
import { clamp, damp, rnd } from '../../engine/math/rand';
import { leg, GAITS, LegSample } from '../anim/gait';
import { SpringF } from '../anim/spring';

const TAU = Math.PI * 2;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _leg: LegSample = { sweep: 0, lift: 0, stance: true, u: 0 };
const BLEED = [{ id: 'bleed' as const, stacks: 1, dur: 3 }];
const LEGS: [string, number, number, boolean][] = [
  ['fl', GAITS.trot.fl, 1, true],
  ['fr', GAITS.trot.fr, -1, true],
  ['bl', GAITS.trot.bl, 1, false],
  ['br', GAITS.trot.br, -1, false],
];
const easeOutBack = (t: number) => {
  const c = 1.70158;
  const u = Math.min(1, Math.max(0, t)) - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

export class Thornback extends Boss {
  private gait = 0;
  /** territorial push-ups (target / smoothed) */
  private display = 0;
  private displayW = 0;
  /** inflation */
  private puff = 0;
  private puffW = 0;
  /** cactus-back shake */
  private shakeK = 0;
  private shakeW = 0;
  /** spike-ball curl, and the roll angle of the ball */
  private curl = 0;
  private curlW = 0;
  private rollAng = 0;
  private rolling = false;
  /** dizzy after a roll: belly up, takes extra damage */
  private dizzy = 0;
  /** extra head yaw while sweeping the squirt, head thrown back for the rain */
  private headAim = 0;
  private rear = 0;
  private rearW = 0;
  private eyeBulge = 0;
  private snapIn = 0;
  private snapYaw = 0;
  private headYaw = new SpringF(0, 6, 0.75);
  private flinch = new SpringF(0, 3.5, 0.35);
  private summonCd = 0;
  private deadT = 0;
  private rest: Record<string, THREE.Euler> = {};
  private restY: Record<string, number> = {};

  constructor(d: BossDeps, private tier = 1) {
    super(d, 'thorny_lizard_boss', { name: 'Old Thornback', title: 'Cries Blood, Forgives Nothing', hp: 2600 * tier, scale: 1.25, eyes: ['organic', 0x2a1408] });
    this.hitSpheres = [
      { node: 'body', r: 1.05, part: 'body', offset: [0, 0.12, -0.15] },
      { node: 'head', r: 0.55, part: 'head', offset: [0, 0.1, 0.45], weak: 1.6 },
      { node: 'tail1', r: 0.45, part: 'tail', offset: [0, 0, -0.35] },
    ];
    this.armor = 48;
    this.physRes = 0.1;
    this.statusRes = { bleed: 1, poison: 0.3 };
    this.bounty = 200 * tier;
    this.gold = 95 * tier;
    for (const p of this.rig.geo.parts) {
      this.rest[p.name] = p.rest.clone();
      this.restY[p.name] = p.offset.y;
    }
  }

  protected hitKind() {
    return 'chitin' as any;
  }

  // ------------------------------------------------------------- damage
  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    // curled up it is a ball of spikes; dizzy on its back it is all soft belly
    const m = this.dizzy > 0 ? 1.6 : this.rolling ? 0.45 : 1;
    if (this.rolling && point) this.ctx.fx.hit(point, { x: 0, y: 1, z: 0 }, 'armor', 0.7);
    const amt = super.takeDamage({ ...hit, mult: (hit.mult ?? 1) * m }, point, dir);
    if (amt > 0) this.flinch.kick(-2.5 - (amt / this.maxHp) * 80);
    // kicking a thorny devil hurts
    if (amt > 0 && hit.source === 'melee' && this.alive) this.player.takeHit({ base: 7, kind: 'phys', source: 'thorns' }, this.pos);
    return amt;
  }

  protected onPhase(p: number) {
    super.onPhase(p);
    this.callout(p >= 2 ? 'Satisfaction' : 'Paint It Black');
    this.summon('thornyLizard', 1 + p, 6, 'sand');
    this.puff = 1;
    this.ctx.engine.tweens.after(0.9, () => (this.puff = 0));
  }

  async intro() {
    this.display = 1;
    this.puff = 0.7;
    await super.intro();
    this.display = 0;
    this.puff = 0;
  }

  // ------------------------------------------------------------- fight
  protected async fight() {
    while (true) {
      this.check();
      const p = this.phase;
      await this.skitter(p >= 2 ? 1 : 2);
      const d = this.distToPlayer();
      const r = rnd.next();
      if (d > 22 || r < 0.22) await this.spikeRoll(1 + Math.min(2, p));
      else if (r < 0.47) await this.cryBabyCry();
      else if (r < 0.67) await this.novemberRain();
      else if (r < 0.86 || this.summonCd > 0) await this.cactusShake();
      else await this.brood();
      this.summonCd = Math.max(0, this.summonCd - 1);
      await this.wait(p >= 2 ? 0.3 : 0.6);
    }
  }

  /** stop-and-go darts to flank points, freezing between bursts like any lizard */
  private async skitter(n: number) {
    const storm = this.ctx.world.storm;
    for (let i = 0; i < n; i++) {
      const pp = this.playerPos();
      const a = Math.atan2(this.pos.x - pp.x, this.pos.z - pp.z) + (rnd.next() - 0.5) * 1.8;
      const R = 9 + rnd.next() * 5;
      let x = pp.x + Math.sin(a) * R, z = pp.z + Math.cos(a) * R;
      if (storm.sdf(x, z) < 5) {
        x = (x + pp.x) * 0.5;
        z = (z + pp.z) * 0.5;
      }
      await this.moveTo(x, z, 11 + this.phase * 2, 0.9);
      this.stop();
      await this.wait(0.18 + rnd.next() * 0.25);
    }
  }

  /** "Cry Baby Cry": push-ups, then twin blood streams from both eyes sweeping across the hunter */
  private async cryBabyCry() {
    const ctx = this.ctx;
    this.stop();
    this.callout('Cry Baby Cry');
    this.setExpr('angry');
    this.display = 1;
    this.puff = 1;
    ctx.sfx('giant_scorpion_hiss', this.pos, 0.8, 0.8);
    await this.wait(0.85);
    this.display = 0.25;
    const bursts = 7 + this.phase * 3;
    const sweep = 1.0 + this.phase * 0.25;
    const sgn = rnd.sign();
    const acid = this.phase >= 2;
    for (let i = 0; i < bursts; i++) {
      const k = i / Math.max(1, bursts - 1);
      this.headAim = (k - 0.5) * sweep * sgn;
      const pc = this.player.center(_v2);
      const yaw = Math.atan2(pc.x - this.pos.x, pc.z - this.pos.z) + this.headAim;
      const dist = Math.max(4, Math.hypot(pc.x - this.pos.x, pc.z - this.pos.z));
      const tgt = new THREE.Vector3(this.pos.x + Math.sin(yaw) * dist, pc.y, this.pos.z + Math.cos(yaw) * dist);
      for (const side of ['l', 'r'] as const) {
        const from = this.eyeTip(side, new THREE.Vector3());
        this.d.enemies.proj.pattern('stream', from, tgt, { count: 3, speed: 13 + this.phase, dmg: 7 + this.phase * 2, proj: 'blood', status: BLEED, sourceId: this.id, acid });
        this.spurt(from, acid);
      }
      this.eyeBulge = 1;
      if (i % 2 === 0) ctx.sfx('gore_splat', this.pos, 0.5, 1.15 + rnd.next() * 0.2);
      await this.wait(0.12);
    }
    this.headAim = 0;
    this.display = 0;
    this.puff = 0;
    await this.wait(0.4);
  }

  /** "November Rain": blood geysers thrown skyward, then it rains down on red-ringed spots around the hunter */
  private async novemberRain() {
    const ctx = this.ctx;
    this.stop();
    this.callout('November Rain');
    this.setExpr('snarl');
    this.rear = 1;
    this.puff = 0.6;
    ctx.sfx('boss_roar', this.pos, 0.7, 1.3);
    await this.wait(0.35);
    for (let i = 0; i < 6; i++) {
      for (const side of ['l', 'r'] as const) {
        const from = this.eyeTip(side, new THREE.Vector3());
        this.d.enemies.proj.spawn({ kind: 'blood', x: from.x, y: from.y, z: from.z, vx: (rnd.next() - 0.5) * 3, vy: 15 + rnd.next() * 5, vz: (rnd.next() - 0.5) * 3, dmg: 6, life: 2.4, sourceId: this.id });
        this.spurt(from, false);
      }
      this.eyeBulge = 1;
      ctx.sfx('gore_splat', this.pos, 0.4, 1.4);
      await this.wait(0.07);
    }
    const n = 7 + this.phase * 3;
    const pp = this.playerPos().clone();
    const pv = this.player.board.vel;
    const spots: THREE.Vector3[] = [new THREE.Vector3(pp.x + pv.x * 0.9, 0, pp.z + pv.z * 0.9)];
    for (let i = 1; i < n; i++) {
      const a = rnd.next() * TAU, r = 2 + rnd.next() * 7;
      spots.push(new THREE.Vector3(pp.x + Math.cos(a) * r, 0, pp.z + Math.sin(a) * r));
    }
    for (const s of spots) {
      s.y = ctx.world.groundAt(s.x, s.z);
      ctx.fx.ring({ x: s.x, y: s.y + 0.15, z: s.z }, 0xc81e1e, 3.2, 1.6);
    }
    await this.wait(0.5);
    this.rear = 0;
    await this.wait(0.35);
    const acid = this.phase >= 2;
    for (const s of spots)
      for (let j = 0; j < 5; j++) {
        const x = s.x + (rnd.next() - 0.5) * 1.6, z = s.z + (rnd.next() - 0.5) * 1.6;
        this.d.enemies.proj.spawn({ kind: 'blood', x, y: s.y + 11 + rnd.next() * 3, z, vx: 0, vy: -12 - rnd.next() * 4, vz: 0, dmg: 9 + this.phase * 2, status: BLEED, life: 3, sourceId: this.id, acid: acid && j === 0 });
      }
    ctx.sfx('thunder', this.pos, 0.3, 1.4);
    this.puff = 0;
    await this.wait(0.8);
  }

  /** "Like a Rolling Stone": curls into a ball of spikes and bowls through the hunter, then lies dizzy */
  private async spikeRoll(n: number) {
    const ctx = this.ctx;
    this.callout('Like a Rolling Stone');
    for (let i = 0; i < n; i++) {
      this.stop();
      this.setExpr('angry');
      this.curl = 1;
      this.puff = 1;
      ctx.sfx('giant_scorpion_hiss', this.pos, 0.7, 0.7);
      const t0 = this.t;
      while (this.t - t0 < 0.6) {
        this.faceTarget(this.playerPos(), 8, 0.05);
        if (rnd.chance(0.6)) ctx.fx.sandSpray({ x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z }, { x: -Math.sin(this.yaw) * 3, y: 1, z: -Math.cos(this.yaw) * 3 }, 1.4);
        await this.wait(0.05);
      }
      this.rolling = true;
      const dir = new THREE.Vector3(this.player.pos.x - this.pos.x, 0, this.player.pos.z - this.pos.z).normalize();
      const reach = Math.min(32, this.distToPlayer() + 9);
      const end = this.pos.clone().addScaledVector(dir, reach);
      this.moveTarget = end;
      this.moveSpeed = 20 + this.phase * 4;
      ctx.sfx('whoosh_big', this.pos, 1, 0.8);
      ctx.sfx('quake_rumble', this.pos, 0.6, 1.3);
      let hit = false;
      const t1 = this.t;
      try {
        while (this.t - t1 < 2.2 && Math.hypot(end.x - this.pos.x, end.z - this.pos.z) > 1.6) {
          await this.wait(0.03);
          // later phases steer the ball after the hunter
          if (this.phase >= 1) {
            const tx = this.player.pos.x - this.pos.x, tz = this.player.pos.z - this.pos.z;
            const tl = Math.hypot(tx, tz) || 1;
            dir.lerp(_v.set(tx / tl, 0, tz / tl), 0.035 * this.phase).normalize();
            end.copy(this.pos).addScaledVector(dir, Math.max(2, Math.hypot(end.x - this.pos.x, end.z - this.pos.z)));
          }
          if (!hit && this.distToPlayer() < this.radius + 0.9 && Math.abs(this.player.pos.y - this.pos.y) < 2.5) {
            hit = true;
            this.player.takeHit({ base: 26 + this.phase * 6, kind: 'phys', source: 'contact', knock: 16, status: BLEED }, this.pos.clone());
            ctx.shake(0.5);
          }
          ctx.events.emit('bossPlow', this.pos, this.radius + 0.5);
        }
      } finally {
        this.rolling = false;
        this.stop();
      }
      this.curl = 0;
      this.puff = 0;
      ctx.fx.sandBurst({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, 1.4);
      ctx.sfx('sand_burst', this.pos, 0.9);
      ctx.shake(0.3);
      if (i === n - 1) {
        this.dizzy = 1.4;
        this.setExpr('stunned');
        ctx.toast('BELLY UP', '#ffd36b', 'Old Thornback is dizzy — unload!');
        await this.wait(1.4);
        this.setExpr('angry');
      } else await this.wait(0.3);
    }
  }

  /** "Get in the Ring": bristles, then shakes rings of needles off the saguaro on its back */
  private async cactusShake() {
    const ctx = this.ctx;
    this.stop();
    this.callout('Get in the Ring');
    this.setExpr('snarl');
    this.guarding = true;
    this.frontGuard = 0.4;
    this.puff = 0.8;
    this.shakeK = 0.35;
    ctx.sfx('cactus_hit', this.pos, 0.8, 0.8);
    try {
      await this.wait(0.6);
      const rings = 3 + this.phase;
      for (let i = 0; i < rings; i++) {
        this.shakeK = 1;
        const from = this.nodePos('cactus', new THREE.Vector3(), 0.5);
        this.fire('ring', { count: 16 + this.phase * 4, speed: 10 + i, dmg: 8 + this.phase * 2, proj: 'needle', phase: i % 2 ? 0.5 : 0 }, from);
        ctx.particles.emit({ pos: from, count: 12, spread: 4, up: 3, life: [0.4, 0.9], size: [0.08, 0.05], sprite: ['twig', 'dot3'], color: [0x6b9e45, 0x8fbf5a, 0xf0e8c0], gravity: 12, ground: true });
        ctx.sfx('cactus_hit', this.pos, 0.7, 1 + i * 0.08);
        ctx.shake(0.12);
        await this.wait(0.38 - this.phase * 0.05);
      }
      if (this.phase >= 2) this.fire('spiral', { count: 24, speed: 9, dmg: 7, proj: 'needle' }, this.nodePos('cactus', new THREE.Vector3(), 0.5));
    } finally {
      this.shakeK = 0;
      this.guarding = false;
      this.puff = 0;
    }
    await this.wait(0.5);
  }

  /** "All Together Now": push-ups and a call; the brood answers out of the sand */
  private async brood() {
    this.callout('All Together Now');
    this.taunt(rnd.pick(['Come out, little devils!', 'Cry for me, children!', 'The whole brood. Now.']), '#ff9a5a');
    this.display = 1;
    this.ctx.sfx('giant_scorpion_hiss', this.pos, 0.8, 1.2);
    this.summon('thornyLizard', 2 + this.phase, 5, 'sand');
    this.summonCd = 3;
    await this.wait(1.0);
    this.display = 0;
  }

  // ------------------------------------------------------------- helpers
  private callout(title: string) {
    const pos = { x: this.pos.x, y: this.pos.y + this.height + 0.7, z: this.pos.z };
    this.d.enemies.callout(title, pos, 'boss');
    this.ctx.events.emit('enemySkill', { title, enemy: this, pos, tier: 'boss' });
  }

  private eyeTip(side: 'l' | 'r', out: THREE.Vector3) {
    const s = this.rig.sockets['eye_tip_' + side] ?? this.rig.nodes['eye_' + side] ?? this.rig.nodes['head'];
    if (!s) return out.set(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z);
    this.root.updateMatrixWorld(true);
    return s.getWorldPosition(out);
  }

  /** world position of a part's pivot, raised by `up` metres in its own frame */
  private nodePos(name: string, out: THREE.Vector3, up = 0) {
    const n = this.rig.nodes[name] ?? this.rig.nodes['body'];
    if (!n) return out.set(this.pos.x, this.pos.y + this.height * 0.7, this.pos.z);
    this.root.updateMatrixWorld(true);
    out.set(0, up, 0);
    return n.localToWorld(out);
  }

  /** red mist and fat droplets bursting from the corner of an eye */
  private spurt(at: THREE.Vector3, acid: boolean) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.ctx.particles.emit({ pos: at, count: 5, vel: { x: fx * 2.6, y: 1.4, z: fz * 2.6 }, spread: 1.3, life: [0.15, 0.45], size: [0.09, 0.035], sprite: ['dot3', 'blood0', 'blood1'], color: acid ? [0xc81e1e, 0x9dff3a] : [0xc81e1e, 0x9a1010, 0xe03a2a], gravity: 9, drag: 2 });
  }

  // ------------------------------------------------------------- per-frame
  update(dt: number) {
    super.update(dt);
    if (!this.alive) {
      this.deadT += dt;
      return;
    }
    // rolling ball: spin from the ground speed, carve a trail
    const v = Math.hypot(this.vel.x, this.vel.z);
    if (this.rolling) {
      this.rollAng += (v * dt) / (1.0 * this.scale);
      if (rnd.chance(dt * 18)) this.ctx.fx.sandSpray({ x: this.pos.x, y: this.pos.y + 0.05, z: this.pos.z }, { x: -this.vel.x * 0.15, y: 1.2, z: -this.vel.z * 0.15 }, 1.6);
      if (rnd.chance(dt * 8)) this.ctx.events.emit('groundMark', this.pos.x, this.pos.z, 0.9, 0);
    } else if (this.curl > 0) {
      // winding up: rocking in place inside the spines
      this.rollAng += dt * 7 * this.curlW;
    } else {
      this.rollAng = damp(this.rollAng, Math.round(this.rollAng / TAU) * TAU, 9, dt);
    }
    // between moves it keeps its eyes (and its horns) on the hunter
    if (!this.moveTarget && !this.rolling && this.curl === 0) this.faceTarget(this.player.pos, 4, dt);
    if (this.dizzy > 0 && rnd.chance(dt * 6))
      this.ctx.particles.emit({ pos: { x: this.pos.x + (rnd.next() - 0.5), y: this.pos.y + this.height + 0.4, z: this.pos.z + (rnd.next() - 0.5) }, count: 1, vel: { x: 0, y: 0.4, z: 0 }, life: [0.5, 0.7], size: [0.16, 0.05], sprite: 'star4', color: 0xfff2a0, additive: true });
  }

  private R(name: string, x: number, y = 0, z = 0) {
    const n = this.rig.nodes[name];
    const r = this.rest[name];
    if (!n || !r) return;
    n.rotation.set(r.x + x, r.y + y, r.z + z);
  }

  protected animate(dt: number) {
    const n = this.rig.nodes;
    const t = this.t;
    this.displayW = damp(this.displayW, this.display, 6, dt);
    this.puffW = damp(this.puffW, this.alive ? this.puff : 0, 7, dt);
    this.curlW = damp(this.curlW, this.alive ? this.curl : 0, 9, dt);
    this.shakeW = damp(this.shakeW, this.shakeK, 10, dt);
    this.rearW = damp(this.rearW, this.rear, 5, dt);
    this.eyeBulge = Math.max(0, this.eyeBulge - dt * 4);
    this.dizzy = Math.max(0, this.dizzy - dt);
    this.flinch.step(0, dt);
    const dead = !this.alive;
    const deadK = dead ? easeOutBack(this.deadT / 0.4) : 0;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const moving = clamp(sp / 0.6, 0, 1) * (1 - this.curlW) * (dead ? 0 : 1);
    this.gait += (sp > 0.2 ? clamp(sp * 0.5, 1.2, 6) : 0) * dt;
    const push = this.displayW > 0.01 ? (0.5 + 0.5 * Math.sin(t * 7.5)) * this.displayW : 0;
    const c = this.curlW;
    // ---- legs: sprawled trot (sweep about Y, knee lift about Z), push-ups straighten the front pair,
    // the spike roll folds every leg tight against the flanks, death leaves them pedalling the sky
    for (const [k, off, sgn, front] of LEGS) {
      const l = leg(this.gait + off, 0.5, _leg);
      let yaw = -sgn * l.sweep * 0.5 * moving;
      let lift = sgn * l.lift * 0.42 * moving;
      if (front) lift += sgn * push * 0.5;
      lift = lift * (1 - c) + sgn * 1.15 * c;
      yaw = yaw * (1 - c) + (front ? -0.55 : 0.55) * sgn * c;
      if (dead) {
        yaw += Math.sin(t * 21 + off * 9) * 0.5 * Math.exp(-this.deadT * 2);
        lift += sgn * 0.6;
      }
      this.R('leg_' + k, 0, yaw, lift);
      this.R('foot_' + k, 0, -yaw * 0.5, -lift * 0.8);
    }
    // ---- body: push-up pitch, flinch, cactus shudder, the roll, the death flip
    const spine = Math.sin(this.gait * TAU) * 0.15 * moving;
    const shudder = this.shakeW > 0.01 ? this.shakeW : 0;
    this.R('body', -push * 0.22 + this.flinch.x * 0.25 - this.rearW * 0.3 + this.rollAng * (dead ? 0 : 1), spine + Math.sin(t * 31) * 0.07 * shudder + (this.dizzy > 0 ? Math.sin(t * 5) * 0.15 : 0), Math.sin(t * 37) * 0.1 * shudder + deadK * Math.PI + (this.dizzy > 0 ? Math.sin(t * 4) * 0.12 : 0));
    if (n['body']) n['body'].position.y = (this.restY['body'] ?? 0) + c * 0.55 + push * 0.12 + deadK * 0.5;
    this.rig.root.scale.setScalar(1 + this.puffW * 0.14);
    // ---- head: jerky snaps toward the hunter, sweeps while crying, thrown back for the rain, tucked for the roll
    this.snapIn -= dt;
    if (this.snapIn <= 0) {
      const toX = this.player.pos.x - this.pos.x, toZ = this.player.pos.z - this.pos.z;
      const lx = toX * Math.cos(this.yaw) - toZ * Math.sin(this.yaw);
      const lz = toX * Math.sin(this.yaw) + toZ * Math.cos(this.yaw);
      this.snapYaw = clamp(Math.atan2(lx, Math.max(0.1, lz)), -0.8, 0.8) + (rnd.next() - 0.5) * 0.25;
      this.snapIn = 0.3 + rnd.next() * 0.8;
    }
    this.headYaw.step(clamp(this.snapYaw * (this.headAim !== 0 ? 0.3 : 1) + this.headAim, -0.95, 0.95) * (1 - c), dt);
    const bob = this.displayW > 0.01 ? Math.sin(t * 15) * 0.1 * this.displayW : 0;
    const dizzyNod = this.dizzy > 0 ? Math.sin(t * 7) * 0.2 : 0;
    this.R('head', bob - this.rearW * 0.75 + c * 0.6 + this.flinch.x * 0.2 + dizzyNod, this.headYaw.x + (this.dizzy > 0 ? Math.sin(t * 5) * 0.35 : 0), 0);
    if (n['jaw']) n['jaw'].rotation.x = damp(n['jaw'].rotation.x, this.rig.exprJaw + this.rearW * 0.35 + this.eyeBulge * 0.12 + (this.dizzy > 0 ? 0.25 : 0) + (dead ? 0.4 : 0), 14, dt);
    // eyes swell as they squirt
    for (const e of ['eye_l', 'eye_r']) n[e]?.scale.setScalar(1 + this.eyeBulge * 0.16);
    // ---- frills fan out with the puff, horns and crown follow the head
    const flare = (this.puffW * 0.8 + this.displayW * 0.3) * ((this.rig.geo.spec.meta?.frillFlare as number) ?? 0.5);
    this.R('frill_l', 0, 0, -flare);
    this.R('frill_r', 0, 0, flare);
    // ---- the saguaro on its back: a lazy sway, a violent shake when it throws needles
    this.R('cactus', Math.sin(t * 1.1) * 0.03 + Math.sin(t * 29) * 0.22 * shudder, 0, Math.sin(t * 0.8) * 0.03 + Math.sin(t * 33) * 0.28 * shudder);
    // ---- tail: swishes with the stride, lashes while displaying, curls over the back in the roll
    for (let i = 1; i <= 3; i++) {
      const sw = Math.sin(this.gait * TAU - i * 0.9) * 0.25 * moving + Math.sin(t * 1.3 + i) * 0.06 + (this.displayW > 0.01 ? Math.sin(t * 9 - i) * 0.12 * this.displayW : 0);
      this.R('tail' + i, c * 0.95 - (dead ? 0.2 : 0), sw * (1 - c), 0);
    }
  }
}
