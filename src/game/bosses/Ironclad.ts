// THE IRONCLAD — miniboss (debut wave 20, returns in the rotation). A ~4 m buff
// skeleton in scavenged locomotive armour: riveted helm with a headlamp, boiler
// plate pauldrons and cuirass, a cow-catcher shield on the left arm, a six-barrel
// gatling for a right hand and a smokestack on its back. Moves are Guns N'
// Roses / Stones titles:
//   Locomotive              shield-first charge down a marked lane (QTE DODGE)
//   Dust N' Bones           leaps and pounds a tracking ring that locks (QTE);
//                           enraged: three pounds in a row
//   Shotgun Blues           the gatling spins up and sweeps a marked arc
//   Get in the Ring         close range: two shield bashes and a point-blank burst
//   Right Next Door to Hell the stack belches burning coals onto marked spots
//   19th Nervous Breakdown  (enraged) the boiler overloads: a huge marked blast (QTE)
// ARMOUR: every plate (helm, both pauldrons, cuirass, cow-catcher) is its own
// part with its own hp. Shots on a plate mostly ring off it (the body takes a
// quarter) but wear it down; a broken plate tears off and tumbles away in
// sparks, rust and bolts, and the bone under it takes extra damage (bone chips
// fly). Phase 2 (66%) the boiler blows the pauldrons and the helm off; phase 3
// (33%) the cuirass bursts and the furnace heart is bare (a big weak point) —
// "Shackler's Revenge": faster, angrier, black smoke and embers.
// A dodged charge / pound / blast leaves him stuck and wide open (+50% damage).
import * as THREE from 'three';
import { Boss, BossDeps, HitSphere } from './Boss';
import type { RayHit } from '../Ctx';
import type { Hit } from '../combat/Damage';
import { clamp, damp, dampAngle, rnd } from '../../engine/math/rand';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

interface Plate {
  name: string;
  label: string;
  socket: string;
  r: number;
  hp: number;
  max: number;
  broken: boolean;
}
interface Debris {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  ang: THREE.Vector3;
  life: number;
  rest: boolean;
}
interface Sphere {
  socket: string;
  r: number;
  part: string;
  weak?: number;
  plate?: Plate;
}

const BONE_COLS = [0xd8c49a, 0xbca47a, 0xf0e2c0, 0x8a7050];
const IRON_COLS = [0x5e6066, 0x46484e, 0x8a4a22, 0x2a2624];

export class Ironclad extends Boss {
  private plates: Plate[];
  private debris: Debris[] = [];
  private rest: Record<string, THREE.Euler> = {};
  /** furnace glow (drives the rig's emissive boost: coals, grate, eyes, lamp) and the headlamp's on-switch */
  private heat = 0.3;
  private heatT = 0.3;
  private lampOn = false;
  /** anim drives (0..1 unless noted) */
  private guard = 1;
  private aim = 0;
  private aimT = 0;
  private crouch = 0;
  private crouchT = 0;
  private pound = 0;
  private poundT = 0;
  private bash = 0;
  private lean = 0;
  private leanT = 0;
  private spin = 0;
  private spinT = 0;
  private barrelAng = 0;
  private tremble = 0;
  private steps = 0;
  private smokeAcc = 0;
  private chuff = 0;
  private exposedT = 0;
  private enraged = false;
  private speedMul = 1;
  private lastCall = '';

  constructor(d: BossDeps, private tier = 1) {
    super(d, tier >= 3 ? 'ironclad_3' : tier === 2 ? 'ironclad_2' : 'ironclad', { name: 'The Ironclad', title: 'Last Train Out of the Duat', hp: 3200 * tier, scale: 1, eyes: ['glow', 0xff7a1e] });
    const P = (name: string, label: string, socket: string, r: number, share: number): Plate => ({ name, label, socket, r, hp: 3200 * tier * share, max: 3200 * tier * share, broken: false });
    this.plates = [
      P('helm', 'HELM', 'hs_helm', 0.66, 0.07),
      P('pauldron_l', 'PAULDRON', 'hs_pl', 0.62, 0.075),
      P('pauldron_r', 'PAULDRON', 'hs_pr', 0.62, 0.075),
      P('chest', 'BOILER PLATE', 'hs_chest', 0.86, 0.11),
      P('shield', 'COW-CATCHER', 'hs_shield', 0.95, 0.13),
    ];
    // weak multipliers by part tag (the base takeDamage reads these); positions come from sockets (see hitTest)
    this.hitSpheres = [
      { node: '', r: 0.001, part: 'skull', weak: 1.8 },
      { node: '', r: 0.001, part: 'heart', weak: 2.4 },
      { node: '', r: 0.001, part: 'bone', weak: 1.3 },
    ] as HitSphere[];
    this.armor = 55;
    this.physRes = 0.15;
    this.magicRes = 0.1;
    this.statusRes = { bleed: 1, poison: 0.5 };
    this.bounty = 230 * tier;
    this.gold = 110 * tier;
    this.phases = [0.66, 0.33];
    for (const p of this.rig.geo.parts) this.rest[p.name] = p.rest.clone();
    // the dodge QTE needs the overlay even if the scene never handed it to the horde
    if (!d.enemies.qte) d.enemies.qte = d.qte;
  }

  protected hitKind() {
    return 'armor' as any;
  }

  // ------------------------------------------------------------------ helpers
  private call(title: string) {
    if (title === this.lastCall) return;
    this.lastCall = title;
    this.ctx.engine.tweens.after(1.5, () => (this.lastCall = ''));
    const pos = { x: this.pos.x, y: this.pos.y + this.height + 0.6, z: this.pos.z };
    this.d.enemies.callout(title, pos, 'boss');
    this.ctx.events.emit('enemySkill', { title, enemy: this, pos, tier: 'boss' });
  }
  private sock(name: string, out: THREE.Vector3) {
    const s = this.rig.sockets[name];
    if (!s) return out.set(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z);
    return s.getWorldPosition(out);
  }
  private predicted(t: number) {
    const v = this.player.board.vel;
    return this.playerPos().clone().addScaledVector(_w.set(v.x, 0, v.z), t);
  }
  private ground(x: number, z: number) {
    return this.ctx.world.groundAt(x, z);
  }
  private get warn() {
    return this.d.enemies.warn;
  }
  private plate(name: string) {
    return this.plates.find((p) => p.name === name);
  }
  /** offer the QTE dodge if the hunter is in the blow's way; true = dodged */
  private async dodge(from: { x: number; z: number }, inZone: () => boolean, up = false) {
    const dg = this.d.enemies.dodge;
    if (!dg.qte) dg.qte = this.d.qte;
    if (!inZone() || !dg.ready()) return false;
    this.warn.bang(this, { tier: 'grab', life: 1.1, y: this.height + 0.9 });
    const r = await dg.offer({ from, up });
    this.check();
    return r === 'good' || r === 'perfect';
  }
  /** a dodged blow leaves him stuck and wide open */
  private openUp(dur = 2.6) {
    this.exposedT = dur;
    const top = { x: this.pos.x, y: this.pos.y + this.height + 0.9, z: this.pos.z };
    this.d.enemies.callout('OPENING!', top, 'elite');
    this.ctx.sfx('counter_clang', this.pos, 0.8, 0.6);
    this.ctx.fx.sparkle(top, 0xffd36b, 16, 1.2);
    this.setExpr('stunned');
  }
  private hunterHit(base: number, knock: number, from: THREE.Vector3, status?: Hit['status']) {
    return this.player.takeHit({ base: base * (1 + (this.tier - 1) * 0.35), kind: 'phys', source: 'contact', knock, status }, from);
  }

  // ------------------------------------------------------------------ intro: he comes in like a train
  async intro() {
    const ctx = this.ctx;
    const cam = this.d.cam;
    this.invulnerable = true;
    ctx.engine.letterbox(true, 0.5);
    const pp = this.playerPos().clone();
    let ax = this.pos.x - pp.x, az = this.pos.z - pp.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    const far = { x: pp.x + ax * 36, z: pp.z + az * 36 };
    const near = { x: pp.x + ax * 12, z: pp.z + az * 12 };
    if (ctx.world.storm.sdf(far.x, far.z) > 4) this.place(far.x, far.z, Math.atan2(-ax, -az));
    else this.place(this.pos.x, this.pos.z, Math.atan2(-ax, -az));
    // a low shot past the hunter's shoulder down the line he is coming along
    const side = { x: -az, z: ax };
    const camPos = new THREE.Vector3(pp.x - ax * 3.2 + side.x * 2.6, 0, pp.z - az * 3.2 + side.z * 2.6);
    camPos.y = this.ground(camPos.x, camPos.z) + 1.1;
    const look = new THREE.Vector3(near.x, this.ground(near.x, near.z) + 2.6, near.z);
    cam.setCine({ pos: camPos, look, fov: 46 });
    this.call('Locomotive');
    this.guard = 1;
    this.leanT = 1;
    ctx.sfx('quake_rumble', this.pos, 1, 0.6);
    this.moveTarget = new THREE.Vector3(near.x, 0, near.z);
    this.moveSpeed = 15;
    this.chuff = 1;
    const t0 = this.t;
    while (this.t - t0 < 2.6 && Math.hypot(near.x - this.pos.x, near.z - this.pos.z) > 1.5) {
      ctx.shake(Math.max(0.05, 0.4 - this.distToPlayer() * 0.01));
      if (rnd.chance(0.6)) ctx.fx.sandSpray({ x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z }, { x: -this.vel.x * 0.1, y: 1.6, z: -this.vel.z * 0.1 }, 1.8);
      await this.wait(0.05);
    }
    this.stop();
    // skid, slam the cow-catcher into the sand
    this.leanT = 0;
    this.bash = 1;
    ctx.sfx('explosion', this.pos, 0.8, 0.7);
    ctx.sfx('counter_clang', this.pos, 1, 0.5);
    ctx.shake(0.7);
    const f = this.sock('shield_front', _v);
    ctx.fx.sandBurst({ x: f.x, y: this.ground(f.x, f.z), z: f.z }, 2.4);
    ctx.fx.dust({ x: f.x, y: this.ground(f.x, f.z) + 0.4, z: f.z }, 2.4, 0xe6cf9f, 9);
    ctx.world.deform(f.x, f.z, 2, 0.4);
    this.chuff = 0;
    await this.wait(0.45);
    // close on the helm: the headlamp kicks on, the gatling spins up
    const g = this.ground(this.pos.x, this.pos.z);
    const fwd = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    const close = new THREE.Vector3(this.pos.x + fwd.x * 6.2 - fwd.z * 1.6, g + 2.3, this.pos.z + fwd.z * 6.2 + fwd.x * 1.6);
    cam.setCine({ pos: close, look: new THREE.Vector3(this.pos.x, g + this.height * 0.82, this.pos.z), fov: 40 });
    this.setExpr('angry');
    ctx.events.emit('bossIntro', this);
    for (let i = 0; i < 12; i++) {
      this.heat = (i % 3 === 1 ? 0.2 : 1.6) * (i / 11);
      if (i % 3 === 0) ctx.fx.light(this.sock('lamp', _v), 0xfff0b0, 3 * (i / 11), 0.25, 12);
      await this.wait(0.06);
    }
    this.lampOn = true;
    this.aimT = 0.6;
    this.spinT = 1;
    ctx.sfx('rev_spin', this.pos, 1, 0.55);
    this.taunt(rnd.pick(['ALL ABOARD.', 'Next stop: the boneyard.', 'I was the fireman on the Set Express. Now I AM the express.']), '#ffb070');
    ctx.sfx('boss_roar', this.pos, 1, 0.7);
    await this.wait(1.7);
    this.spinT = 0;
    this.aimT = 0;
    cam.setCine(null);
    ctx.engine.letterbox(false, 0.5);
    this.invulnerable = false;
  }

  // ------------------------------------------------------------------ fight loop
  protected async fight() {
    while (true) {
      this.check();
      const p = this.phase;
      const d = this.distToPlayer();
      const r = rnd.next();
      if (d < 7.5 && r < 0.5) await this.getInTheRing();
      else if (d > 15 && r < 0.55) await this.locomotive();
      else if (r < 0.28) await this.shotgunBlues();
      else if (r < 0.5) await this.dustNBones();
      else if (r < 0.66) await this.locomotive();
      else if (p >= 2 && r < 0.84) await this.nervousBreakdown();
      else await this.nextDoorToHell();
      await this.wait(p >= 2 ? 0.3 : p === 1 ? 0.55 : 0.8);
      // lumber in between moves
      if (this.distToPlayer() > 9) {
        const pp = this.playerPos();
        await this.moveTo(pp.x, pp.z, 3.6 * this.speedMul, 0.9 + rnd.next() * 0.6);
      }
    }
  }

  /** shield-first charge down a marked lane */
  private async locomotive() {
    const ctx = this.ctx;
    this.call('Locomotive');
    this.stop();
    const W = this.enraged ? 0.75 : this.phase === 1 ? 0.95 : 1.15;
    this.faceTarget(this.playerPos());
    this.leanT = 0.6;
    this.crouchT = 0.5;
    this.chuff = 1;
    this.warn.bang(this, { tier: 'heavy', life: W, y: this.height + 0.6 });
    const lane = this.warn.lane(this.pos.x, this.pos.z, Math.sin(this.yaw), Math.cos(this.yaw), 28, this.radius * 2 + 1.6, W + 0.3, 'heavy');
    // two stamps
    for (let i = 0; i < 2; i++) {
      await this.wait(W * 0.35);
      this.faceTarget(this.predicted(0.4), 6, W * 0.35);
      lane.x = this.pos.x;
      lane.z = this.pos.z;
      (lane as any).dx = Math.sin(this.yaw);
      (lane as any).dz = Math.cos(this.yaw);
      ctx.shake(0.2);
      ctx.sfx('board_land', this.pos, 1, 0.5);
      ctx.fx.dust({ x: this.pos.x, y: this.pos.y + 0.2, z: this.pos.z }, 1.6, 0xe6cf9f, 4);
    }
    await this.wait(W * 0.3);
    this.crouchT = 0;
    this.leanT = 1;
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const end = this.pos.clone().addScaledVector(dir, Math.min(30, this.distToPlayer() + 10));
    this.moveTarget = end;
    this.moveSpeed = (this.enraged ? 25 : 21) * (1 + (this.tier - 1) * 0.08);
    ctx.sfx('whoosh_big', this.pos, 1, 0.6);
    ctx.sfx('boss_roar', this.pos, 0.7, 0.8);
    let hit = false, dodged = false, offered = false;
    const t0 = this.t;
    try {
      while (this.t - t0 < 1.7 && Math.hypot(end.x - this.pos.x, end.z - this.pos.z) > 1.6) {
        await this.wait(0.03);
        ctx.fx.dust({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z }, 1.6, 0xe6cf9f, 2);
        if (rnd.chance(0.7)) ctx.fx.sandSpray({ x: this.pos.x + dir.x * 1.6, y: this.pos.y + 0.1, z: this.pos.z + dir.z * 1.6 }, { x: -dir.z * 4 * rnd.sign(), y: 2, z: dir.x * 4 }, 1.4);
        ctx.events.emit('bossPlow', this.pos, this.radius + 0.8);
        const px = this.player.pos.x - this.pos.x, pz = this.player.pos.z - this.pos.z;
        const along = px * dir.x + pz * dir.z, lat = Math.abs(-px * dir.z + pz * dir.x);
        if (!offered && along > 0 && along < 5.5 && lat < this.radius + 1.4) {
          offered = true;
          dodged = await this.dodge(this.pos, () => true);
        }
        if (!hit && !dodged && along > -0.5 && along < this.radius + 1.2 && lat < this.radius + 1 && Math.abs(this.player.pos.y - this.pos.y) < 3) {
          hit = true;
          this.hunterHit(30 + this.phase * 6, 22, this.pos.clone());
          ctx.shake(0.6);
          ctx.fx.word(this.player.pos, 'w_crack');
        }
      }
    } finally {
      this.stop();
      this.leanT = 0;
      this.chuff = 0;
    }
    // skid stop
    this.squash.kick(3);
    this.bash = 1;
    ctx.sfx('punch', this.pos, 1, 0.6);
    ctx.fx.sandBurst({ x: this.pos.x + dir.x * 2, y: this.pos.y, z: this.pos.z + dir.z * 2 }, 1.8);
    if (dodged) {
      this.openUp();
      this.crouchT = 0.8;
      await this.wait(2.4);
      this.crouchT = 0;
      this.setExpr(this.enraged ? 'enraged' : 'angry');
    } else await this.wait(0.55);
  }

  /** leap and pound a tracking ring that locks */
  private async dustNBones() {
    const n = this.enraged ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const dodged = await this.poundOnce(i === 0 ? 5.4 : 4.2, i === 0 ? 1.15 : 0.75, i === 0);
      if (dodged) {
        this.openUp(2.4);
        this.crouchT = 1;
        await this.wait(2.2);
        this.crouchT = 0;
        this.setExpr(this.enraged ? 'enraged' : 'angry');
        return;
      }
    }
    await this.wait(0.4);
  }

  private async poundOnce(R: number, warnT: number, announce: boolean) {
    const ctx = this.ctx;
    if (announce) this.call("Dust N' Bones");
    this.stop();
    const pl = this.player;
    const mark = this.warn.circle(pl.pos.x, pl.pos.z, R, warnT + 0.9, 'heavy', () => ({ x: pl.pos.x + pl.board.vel.x * 0.5, z: pl.pos.z + pl.board.vel.z * 0.5 }), warnT * 0.62);
    this.warn.bang(this, { tier: 'heavy', life: warnT, y: this.height + 0.6 });
    this.crouchT = 1;
    this.faceTarget(this.playerPos());
    ctx.sfx('quake_rumble', this.pos, 0.6, 1.3);
    await this.wait(warnT * 0.6);
    // leap
    this.crouchT = 0;
    this.poundT = 1;
    this.flying = true;
    const from = this.pos.clone();
    const T = warnT * 0.4 + 0.5;
    ctx.sfx('whoosh_big', this.pos, 1, 0.5);
    ctx.fx.sandBurst({ x: from.x, y: from.y, z: from.z }, 1.6);
    let dodged = false, offered = false;
    for (let t = 0; t < T; t += 0.03) {
      const k = Math.min(1, t / T);
      const tx = mark.x, tz = mark.z;
      this.pos.x = from.x + (tx - from.x) * k;
      this.pos.z = from.z + (tz - from.z) * k;
      this.pos.y = from.y + (this.ground(tx, tz) - from.y) * k + Math.sin(k * Math.PI) * 4.6;
      this.yaw = dampAngle(this.yaw, Math.atan2(tx - from.x, tz - from.z), 8, 0.03);
      if (!offered && k > 0.72) {
        offered = true;
        dodged = await this.dodge({ x: tx, z: tz }, () => Math.hypot(pl.pos.x - tx, pl.pos.z - tz) < R + 0.4);
      }
      await this.wait(0.03);
    }
    // impact
    const at = new THREE.Vector3(mark.x, 0, mark.z);
    const g = this.ground(at.x, at.z);
    this.pos.set(at.x, g, at.z);
    this.flying = false;
    this.poundT = 0;
    this.pound = 1.4;
    this.squash.kick(-6);
    this.warn.endMark(mark);
    ctx.shake(0.9);
    ctx.sfx('explosion', at, 1, 0.6);
    ctx.sfx('quake_rumble', at, 1, 0.8);
    ctx.world.deform(at.x, at.z, R * 0.55, 0.8);
    ctx.fx.sandBurst({ x: at.x, y: g, z: at.z }, R * 0.5);
    ctx.fx.dust({ x: at.x, y: g + 0.4, z: at.z }, R * 0.6, 0xe6cf9f, 10);
    ctx.fx.ring({ x: at.x, y: g + 0.2, z: at.z }, 0xffd0a0, R * 2.6, 0.5);
    ctx.events.emit('groundMark', at.x, at.z, R * 0.8, 1);
    if (!dodged && Math.hypot(pl.pos.x - at.x, pl.pos.z - at.z) < R && pl.pos.y < g + 2.6) this.hunterHit(32 + this.phase * 6, 16, at.clone().setY(g));
    if (this.phase >= 1) this.fire('ring', { count: 14 + this.phase * 6, speed: 10, dmg: 8, proj: 'sand' }, _v.set(at.x, g + 0.7, at.z));
    await this.wait(0.35);
    return dodged;
  }

  /** the gatling spins up and sweeps a marked arc */
  private async shotgunBlues() {
    const ctx = this.ctx;
    this.call('Shotgun Blues');
    this.stop();
    this.faceTarget(this.playerPos());
    const base = this.yaw;
    const W = this.enraged ? 0.65 : 0.9;
    this.aimT = 1;
    this.spinT = 1;
    this.warn.bang(this, { tier: 'heavy', life: W, y: this.height + 0.6 });
    const half = this.phase >= 1 ? 0.95 : 0.75;
    this.warn.wedge(this.pos.x, this.pos.z, base, 22, half, W + 0.25, 'heavy');
    ctx.sfx('rev_spin', this.pos, 1, 0.5);
    for (let t = 0; t < W; t += 0.1) {
      if (t > W - 0.3) {
        const m = this.sock('muzzle', _v);
        ctx.particles.emit({ pos: m, count: 1, life: [0.2, 0.2], size: [0.8, 0.15], sprite: 'star4', additive: true, color: 0xfff2c0, screen: true, sizeJitter: 0, rot: 0.4 });
      }
      await this.wait(0.1);
    }
    const dur = this.enraged ? 2.6 : this.phase === 1 ? 2.2 : 1.9;
    const sweeps = this.phase >= 1 ? 2 : 1;
    let n = 0;
    for (let t = 0; t < dur; t += 0.05) {
      const u = t / dur;
      const sw = Math.sin(u * Math.PI * sweeps - Math.PI / 2) * half;
      this.yaw = base + sw * 0.85;
      const m = this.sock('muzzle', _v);
      const tgt = this.player.center(new THREE.Vector3());
      const flat = Math.hypot(tgt.x - m.x, tgt.z - m.z) || 1;
      const ang = base + sw + (rnd.next() - 0.5) * 0.06;
      const sp = 21;
      for (let k = 0; k < (this.enraged ? 2 : 1); k++) {
        const a = ang + (k ? 0.12 : 0);
        this.d.enemies.proj.spawn({ kind: 'bullet', x: m.x, y: m.y, z: m.z, vx: Math.sin(a) * sp, vy: ((tgt.y - m.y) / flat) * sp, vz: Math.cos(a) * sp, dmg: 5 * (1 + (this.tier - 1) * 0.4), sourceId: this.id });
      }
      if (n++ % 2 === 0) {
        ctx.fx.muzzle(m, { x: Math.sin(ang), y: 0, z: Math.cos(ang) }, 0xffd090);
        ctx.sfx('enemy_shot', m, 0.55, 0.85 + rnd.next() * 0.1);
        ctx.fx.shells(m, { x: Math.cos(ang), y: 0.5, z: -Math.sin(ang) }, 1);
      }
      await this.wait(0.05);
    }
    if (this.enraged) this.fire('spiral', { count: 24, speed: 12, dmg: 7, proj: 'bullet' }, this.sock('muzzle', _v).clone());
    this.spinT = 0;
    await this.wait(0.35);
    this.aimT = 0;
  }

  /** close: two shield bashes and a point-blank burst */
  private async getInTheRing() {
    const ctx = this.ctx;
    this.call('Get in the Ring');
    this.stop();
    for (let i = 0; i < 2; i++) {
      this.faceTarget(this.playerPos());
      const W = i === 0 ? 0.55 : 0.42;
      this.warn.bang(this, { tier: i === 1 ? 'heavy' : 'tell', life: W, y: this.height + 0.6 });
      this.warn.wedge(this.pos.x, this.pos.z, this.yaw, 5.2, 0.85, W, i === 1 ? 'heavy' : 'tell');
      this.guard = 0.4;
      await this.wait(W);
      this.bash = 1;
      this.guard = 1;
      ctx.sfx('whoosh_big', this.pos, 0.9, 0.7);
      const px = this.player.pos.x - this.pos.x, pz = this.player.pos.z - this.pos.z;
      const d = Math.hypot(px, pz);
      const front = (px * Math.sin(this.yaw) + pz * Math.cos(this.yaw)) / (d || 1);
      if (d < 5.2 && front > 0.35 && Math.abs(this.player.pos.y - this.pos.y) < 2.6) {
        this.hunterHit(i === 0 ? 16 : 24, i === 0 ? 12 : 24, this.pos.clone());
        ctx.sfx('counter_clang', this.pos, 1, 0.55);
        ctx.shake(0.4);
      }
      await this.wait(0.3);
    }
    this.aimT = 1;
    this.spinT = 1;
    await this.wait(0.45);
    this.fire('fan', { count: 9 + this.phase * 2, spread: 0.8, speed: 20, dmg: 7, proj: 'bullet' }, this.sock('muzzle', _v).clone());
    ctx.sfx('shotgun_shot', this.pos, 0.9, 0.7);
    await this.wait(0.4);
    this.spinT = 0;
    this.aimT = 0;
  }

  /** the stack belches burning coals onto marked spots */
  private async nextDoorToHell() {
    const ctx = this.ctx;
    this.call('Right Next Door to Hell');
    this.stop();
    this.crouchT = 0.6;
    const n = 3 + this.phase * 2 + (this.tier - 1);
    const T = 1.2;
    const from = this.sock('smoke', new THREE.Vector3());
    ctx.sfx('explosion', from, 0.5, 1.4);
    for (let i = 0; i < n; i++) {
      const at = this.predicted(0.7 + rnd.next() * 0.5).add(_w.set((rnd.next() - 0.5) * 9, 0, (rnd.next() - 0.5) * 9));
      if (i === 0) at.copy(this.predicted(T));
      const g = this.ground(at.x, at.z);
      this.warn.circle(at.x, at.z, 2.6, T, 'heavy');
      // the coal itself (lands as its ring runs out)
      const dx = at.x - from.x, dz = at.z - from.z, dy = g - from.y;
      this.d.enemies.proj.spawn({ kind: 'dynamite', x: from.x, y: from.y, z: from.z, vx: dx / T, vy: dy / T + 0.5 * 16 * T, vz: dz / T, dmg: 6, life: T + 0.05, sourceId: this.id });
      ctx.engine.tweens.after(T, () => {
        if (!this.alive) return;
        ctx.fx.explosion({ x: at.x, y: g + 0.3, z: at.z }, 2.2);
        ctx.events.emit('groundMark', at.x, at.z, 2, 1);
        ctx.sfx('explosion', { x: at.x, y: g, z: at.z }, 0.6, 1.1);
        const pd = Math.hypot(this.player.pos.x - at.x, this.player.pos.z - at.z);
        if (pd < 2.7 && this.player.pos.y < g + 2.4) this.hunterHit(18 + this.phase * 4, 8, new THREE.Vector3(at.x, g, at.z), [{ id: 'burn', stacks: 2, dur: 3 }]);
      });
      this.smokeBurst(1.4);
      await this.wait(0.12);
    }
    this.crouchT = 0;
    await this.wait(T);
  }

  /** enraged: the boiler overloads into one huge blast */
  private async nervousBreakdown() {
    const ctx = this.ctx;
    this.call('19th Nervous Breakdown');
    this.stop();
    const R = 9.5;
    const W = 1.8;
    const c = this.pos.clone();
    this.warn.circle(c.x, c.z, R, W + 0.2, 'grab');
    this.warn.bang(this, { tier: 'grab', life: W, y: this.height + 0.6 });
    this.tremble = 1;
    this.crouchT = 0.4;
    ctx.sfx('quake_rumble', this.pos, 1, 0.7);
    ctx.sfx('time_slow', this.pos, 0.5, 0.6);
    for (let t = 0; t < W; t += 0.1) {
      this.heat = 1.5 + t * 2 + Math.random();
      if (Math.floor(t * 10) % 4 === 0) ctx.fx.light(this.sock('heart', _v), 0xff9a4a, 2 + t * 3, 0.3, 9);
      this.steam(0.6 + t);
      if (t > W - 0.25 && t < W - 0.15) {
        // nothing: the QTE comes right before the blast
      }
      await this.wait(0.1);
    }
    const pl = this.player;
    const dodged = await this.dodge(c, () => Math.hypot(pl.pos.x - c.x, pl.pos.z - c.z) < R);
    this.tremble = 0;
    this.crouchT = 0;
    const g = this.ground(c.x, c.z);
    const h = this.sock('heart', _v).clone();
    ctx.fx.explosion(h, 5);
    ctx.fx.ring({ x: c.x, y: g + 0.3, z: c.z }, 0xffc080, R * 2.2, 0.6);
    ctx.engine.flash(0xffd0a0, 0.35, 0.4);
    ctx.shake(1);
    ctx.sfx('explosion_big', this.pos, 1, 0.8);
    if (!dodged && Math.hypot(pl.pos.x - c.x, pl.pos.z - c.z) < R && pl.pos.y < g + 4) this.hunterHit(42, 22, c.clone(), [{ id: 'burn', stacks: 3, dur: 4 }]);
    this.fire('ring', { count: 30, speed: 12, dmg: 8, proj: 'bone' }, _v.set(c.x, g + 1.2, c.z).clone());
    ctx.engine.tweens.after(0.35, () => this.alive && this.fire('ring', { count: 26, speed: 9, dmg: 8, proj: 'bone', phase: 0.5 }, new THREE.Vector3(c.x, g + 1, c.z)));
    // the boiler has to vent afterwards: an opening either way, a long one after a dodge
    this.openUp(dodged ? 3 : 1.6);
    this.crouchT = 0.8;
    await this.wait(dodged ? 2.6 : 1.4);
    this.crouchT = 0;
    this.setExpr('enraged');
  }

  // ------------------------------------------------------------------ armour
  private breakPlate(p: Plate, dir?: THREE.Vector3, quiet = false) {
    if (p.broken) return;
    p.broken = true;
    const ctx = this.ctx;
    const node = this.rig.nodes[p.name];
    const mesh = this.rig.meshes[p.name];
    const at = this.sock(p.socket, new THREE.Vector3());
    if (mesh && node) {
      this.root.updateMatrixWorld(true);
      // a twin of the plate tumbles away; the part on the rig disappears
      const m = new THREE.Mesh(mesh.geometry, this.rig.material);
      m.castShadow = true;
      mesh.matrixWorld.decompose(m.position, m.quaternion, m.scale);
      ctx.scene.add(m);
      const out = at.clone().sub(_v.set(this.pos.x, at.y - 0.5, this.pos.z)).normalize();
      const vel = new THREE.Vector3(out.x * 6 + (dir?.x ?? 0) * 3, 6 + rnd.next() * 3, out.z * 6 + (dir?.z ?? 0) * 3);
      this.debris.push({ mesh: m, vel, ang: new THREE.Vector3((rnd.next() - 0.5) * 9, (rnd.next() - 0.5) * 9, (rnd.next() - 0.5) * 9), life: 9, rest: false });
      this.rig.setPartVisible(p.name, false);
    }
    if (p.name === 'helm') this.lampOn = false;
    // sparks, rust flakes, bolts, soot
    ctx.particles.emit({ pos: at, count: 26, spread: 7, up: 3, life: [0.3, 0.7], size: [0.12, 0.03], sprite: ['dot3', 'star4'], additive: true, color: [0xffd070, 0xff8a2a, 0xffffff], gravity: 12, sizeJitter: 0.3 });
    ctx.particles.emit({ pos: at, count: 18, spread: 4.5, up: 3, life: [0.8, 1.6], size: [0.1, 0.07], sprite: ['dot4', 'twig'], color: [0x8a4a22, 0x5e2e14, 0x46484e], gravity: 14, ground: true, bounce: 0.3, rot: 6, rotSpeed: 6 });
    ctx.particles.emit({ pos: at, count: 6, spread: 1.6, up: 1.2, life: [0.9, 1.6], size: [0.6, 1.4], sprite: ['puff0', 'puff1'], color: [0x6e685e, 0x4a4640], alpha: 0.7, drag: 2, rot: 6, rotSpeed: 0.5 });
    ctx.events.emit('gibs', at.x, at.y, at.z, 8, 0.09, IRON_COLS, 6, 5);
    ctx.sfx('counter_clang', at, 1, 0.55);
    ctx.sfx('hit_armor', at, 1, 0.7);
    if (!quiet) {
      ctx.sfx('explosion', at, 0.5, 1.5);
      ctx.shake(0.4);
      ctx.engine.hitStop(0.06);
      this.d.enemies.callout(`${p.label} BROKEN!`, { x: at.x, y: at.y + 1, z: at.z }, 'boss');
    }
    if (p.name === 'chest') {
      ctx.fx.light(at, 0xff8a3a, 5, 0.8, 12);
      ctx.toast('THE FURNACE HEART', '#ff9a4a', 'His boiler is bare — shoot the fire in his ribs!', true);
    }
    if (p.name === 'shield') ctx.toast('COW-CATCHER BROKEN', '#ffb070', 'Nothing between you and his ribs now');
    ctx.events.emit('bossArmorBreak', this, p.name);
  }

  // ------------------------------------------------------------------ damage
  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    const tag = hit.tags?.[0] ?? '';
    if (tag.startsWith('plate:') && this.alive && !this.invulnerable && !this.escaped) {
      const p = this.plate(tag.slice(6));
      if (p && !p.broken) {
        // it rings off the plate: the body takes a quarter, the plate wears down
        const amt = super.takeDamage({ ...hit, mult: (hit.mult ?? 1) * 0.25 * (this.exposedT > 0 ? 1.5 : 1), tags: ['plate'] }, point, dir);
        p.hp -= amt * 4 * (hit.source === 'explosion' ? 1.6 : hit.source === 'melee' ? 1.3 : 1);
        if (point) {
          this.ctx.particles.emit({ pos: point, count: 5, spread: 4, up: 1.5, life: [0.15, 0.35], size: [0.1, 0.03], sprite: 'dot3', additive: true, color: [0xffd070, 0xffffff], gravity: 10 });
          this.ctx.sfx('ricochet', point, 0.35, 0.9 + rnd.next() * 0.3);
        }
        if (p.hp <= 0 && this.alive) this.breakPlate(p, dir);
        return amt;
      }
    }
    const amt = super.takeDamage({ ...hit, mult: (hit.mult ?? 1) * (this.exposedT > 0 ? 1.5 : 1) }, point, dir);
    // bare bone chips and splinters; the furnace spits embers
    if (amt > 0 && point && this.ctx.camera.position.distanceTo(point) < 45) {
      if (tag === 'heart') {
        this.ctx.particles.emit({ pos: point, count: 8, spread: 4, up: 2.5, life: [0.4, 0.9], size: [0.1, 0.03], sprite: ['dot3', 'star4'], additive: true, color: [0xffb040, 0xff7a1e, 0xffe0a0], gravity: 6 });
        this.heat += 0.8;
      } else if (tag === 'skull' || tag === 'bone' || tag === 'ribs') {
        this.ctx.events.emit('gibs', point.x, point.y, point.z, hit.headshot ? 4 : 2, 0.07, BONE_COLS, 4, 3);
        this.ctx.particles.emit({ pos: point, count: 4, spread: 1.2, up: 0.8, life: [0.5, 0.9], size: [0.25, 0.5], sprite: ['puff0', 'puff1'], color: [0xd8c49a, 0xbca47a], alpha: 0.6, drag: 2.5 });
      }
    }
    return amt;
  }

  protected onPhase(p: number) {
    super.onPhase(p);
    const ctx = this.ctx;
    // the boiler blows: the plates nearest it tear free
    this.steam(3);
    ctx.engine.slowMo(0.35, 30);
    ctx.engine.tweens.after(0.7, () => ctx.engine.slowMo(1, 6), true);
    if (p === 1) {
      for (const n of ['pauldron_l', 'pauldron_r', 'helm']) {
        const pl = this.plate(n);
        if (pl && !pl.broken) this.breakPlate(pl, undefined, n !== 'helm');
      }
      this.taunt('You scratched the paint. You will PAY for the paint.', '#ffb070');
      this.speedMul = 1.12;
    }
    if (p === 2) {
      const pl = this.plate('chest');
      if (pl && !pl.broken) this.breakPlate(pl);
      this.enraged = true;
      this.speedMul = 1.3;
      this.call("Shackler's Revenge");
      this.taunt('FULL STEAM. NO BRAKES.', '#ff6a3a');
      ctx.sfx('boss_roar', this.pos, 1, 0.6);
    }
  }

  // ------------------------------------------------------------------ targeting: socket spheres, plates first
  private spheres(): Sphere[] {
    const out: Sphere[] = [];
    for (const p of this.plates) if (!p.broken) out.push({ socket: p.socket, r: p.r, part: 'plate:' + p.name, plate: p });
    const helm = this.plate('helm')!, chest = this.plate('chest')!;
    out.push({ socket: 'hs_skull', r: helm.broken ? 0.55 : 0.3, part: helm.broken ? 'skull' : 'bone', weak: helm.broken ? 1.8 : 1.3 });
    if (chest.broken) {
      out.push({ socket: 'hs_heart', r: 0.5, part: 'heart', weak: 2.4 });
      out.push({ socket: 'hs_chest', r: 0.95, part: 'ribs', weak: 1.25 });
    } else out.push({ socket: 'hs_heart', r: 0.75, part: 'torso' });
    if (this.plate('pauldron_l')!.broken) out.push({ socket: 'hs_pl', r: 0.45, part: 'bone' });
    if (this.plate('pauldron_r')!.broken) out.push({ socket: 'hs_pr', r: 0.45, part: 'bone' });
    out.push({ socket: 'hs_pelvis', r: 0.75, part: 'torso' });
    out.push({ socket: 'hs_thigh_l', r: 0.42, part: 'bone' });
    out.push({ socket: 'hs_thigh_r', r: 0.42, part: 'bone' });
    return out;
  }

  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (!this.alive || this.escaped || !this.root.visible) return null;
    let best: RayHit | null = null;
    let bt = maxT;
    this.root.updateMatrixWorld(true);
    for (const s of this.spheres()) {
      const c = this.sock(s.socket, _v);
      const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const cc = ox * ox + oy * oy + oz * oz - s.r * s.r;
      const disc = b * b - cc;
      if (disc < 0) continue;
      let t = -b - Math.sqrt(disc);
      if (t < 0) t = -b + Math.sqrt(disc);
      if (t < 0 || t > bt) continue;
      bt = t;
      const point = o.clone().addScaledVector(d, t);
      best = { enemy: this, t, point, normal: point.clone().sub(c).normalize(), headshot: (s.weak ?? 1) > 1.2, part: s.part, surface: 'enemy' };
    }
    return best;
  }

  // ------------------------------------------------------------------ smoke & steam
  private smokeBurst(k: number) {
    const s = this.sock('smoke', _v);
    this.ctx.particles.emit({ pos: s, count: Math.round(3 * k), vel: { x: 0, y: 3 * k, z: 0 }, spread: 1, up: 1.5, life: [1.4, 2.6], size: [0.7, 2.4], sprite: ['cloud0', 'cloud1', 'cloud2'], color: this.enraged ? [0x1e1c1a, 0x2a2624, 0x3a3430] : [0x4a4640, 0x6e685e, 0x5a5650], alpha: 0.85, drag: 1.2, rot: 6, rotSpeed: 0.4 });
  }
  private steam(k: number) {
    const P = this.ctx.particles;
    for (const n of ['hs_pl', 'hs_pr', 'hs_pelvis']) {
      const p = this.sock(n, _v);
      P.emit({ pos: p, count: Math.round(2 * k), spread: 3, up: 2, life: [0.5, 1.1], size: [0.4, 1.3], sprite: ['puff0', 'puff1'], color: [0xf0f0f0, 0xdadada], alpha: 0.6, drag: 2.2, rot: 6, rotSpeed: 0.6 });
    }
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    super.update(dt);
    this.exposedT = Math.max(0, this.exposedT - dt);
    // debris: tumble, bounce, rest, then sink into the sand
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const db = this.debris[i];
      db.life -= dt;
      const m = db.mesh;
      if (!db.rest) {
        db.vel.y -= 20 * dt;
        m.position.addScaledVector(db.vel, dt);
        _q.setFromEuler(new THREE.Euler(db.ang.x * dt, db.ang.y * dt, db.ang.z * dt));
        m.quaternion.premultiply(_q);
        const g = this.ground(m.position.x, m.position.z);
        if (m.position.y < g + 0.25) {
          m.position.y = g + 0.25;
          if (db.vel.y < -3) {
            this.ctx.fx.sandBurst({ x: m.position.x, y: g, z: m.position.z }, 0.9);
            this.ctx.sfx('counter_clang', m.position, 0.45, 0.6 + rnd.next() * 0.2);
          }
          db.vel.set(db.vel.x * 0.45, -db.vel.y * 0.3, db.vel.z * 0.45);
          db.ang.multiplyScalar(0.5);
          if (Math.abs(db.vel.y) < 1.2 && Math.hypot(db.vel.x, db.vel.z) < 0.8) db.rest = true;
        }
      } else if (db.life < 2) m.position.y -= dt * 0.35;
      if (db.life <= 0) {
        m.removeFromParent();
        this.debris.splice(i, 1);
      }
    }
    if (!this.alive) return;
    // smoke from the stack (heavier while charging, black when enraged), embers off the furnace
    this.smokeAcc += dt * (this.chuff ? 9 : this.enraged ? 6 : 3.5);
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      this.smokeBurst(this.chuff ? 1.2 : 0.6);
    }
    if (this.enraged && rnd.chance(dt * 8)) {
      const s = this.sock('smoke', _v);
      this.ctx.particles.emit({ pos: s, count: 2, spread: 1.5, up: 4, life: [0.6, 1.2], size: [0.08, 0.03], sprite: 'dot3', additive: true, color: [0xffb040, 0xff7a1e], gravity: -1, drag: 1 });
    }
    // the furnace breathes: emissive boost on the coals, grate, eyes and lamp
    const chestOff = this.plate('chest')!.broken;
    this.heatT = (chestOff ? 1.1 : 0.35) * (this.enraged ? 1.5 : 1) + (this.lampOn ? 0.25 : 0) + Math.sin(this.t * 13) * 0.12 + Math.sin(this.t * 31) * 0.08;
    this.heat = damp(this.heat, this.heatT, 3, dt);
    this.rig.material.userData.fx.value.z = this.heat;
    if (this.exposedT > 0 && rnd.chance(dt * 10)) this.ctx.particles.emit({ pos: { x: this.pos.x + (rnd.next() - 0.5) * 2, y: this.pos.y + this.height * (0.3 + rnd.next() * 0.6), z: this.pos.z + (rnd.next() - 0.5) * 2 }, count: 1, vel: { x: 0, y: 0.7, z: 0 }, life: [0.3, 0.5], size: [0.45, 0.06], sprite: 'star4', additive: true, color: [0xffd36b, 0xffffff] });
  }

  protected animate(dt: number) {
    const n = this.rig.nodes;
    const R = (name: string, x: number, y = 0, z = 0) => {
      const node = n[name];
      const r = this.rest[name];
      if (node && r) node.rotation.set(r.x + x, r.y + y, r.z + z);
    };
    // ease the drives
    this.aim = damp(this.aim, this.aimT, 7, dt);
    this.crouch = damp(this.crouch, this.crouchT, 6, dt);
    this.pound = Math.max(0, this.pound - dt * 2.2);
    this.bash = Math.max(0, this.bash - dt * 3);
    this.lean = damp(this.lean, this.leanT, 5, dt);
    this.spin = damp(this.spin, this.spinT * 32, this.spinT ? 2.5 : 1.2, dt);
    this.barrelAng += this.spin * dt;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.anim.walk += dt * (1.5 + sp * 0.75);
    const w = this.anim.walk;
    const stride = clamp(sp / 3.6, 0, 1.25);
    const hitK = Math.max(0, 1 - this.hitT / 0.35);
    const air = this.poundT > 0 ? 1 : 0;
    // heavy footfalls: dust and a thud every step
    const step = Math.floor(w / Math.PI);
    if (step !== this.steps) {
      this.steps = step;
      if (stride > 0.2 && !this.flying) {
        const side = step % 2 ? 1 : -1;
        const fx = this.pos.x + Math.cos(this.yaw) * side * 0.4, fz = this.pos.z - Math.sin(this.yaw) * side * 0.4;
        this.ctx.fx.dust({ x: fx, y: this.ground(fx, fz) + 0.1, z: fz }, 0.9 + stride * 0.6, 0xe6cf9f, 2);
        if (this.distToPlayer() < 16) this.ctx.shake(0.04 + stride * 0.05);
        this.ctx.sfx('board_land', this.pos, 0.35 + stride * 0.2, 0.55);
      }
    }
    // legs
    const cr = this.crouch * 0.55 + air * 0.4;
    R('thigh_l', -Math.sin(w) * 0.5 * stride - cr * 0.9 - this.lean * 0.35, 0, -0.06);
    R('thigh_r', Math.sin(w) * 0.5 * stride - cr * 0.9 - this.lean * 0.35, 0, 0.06);
    R('shin_l', Math.max(0, Math.sin(w + 1.3)) * 0.75 * stride + cr * 1.5 + this.lean * 0.3);
    R('shin_r', Math.max(0, Math.sin(w + 1.3 + Math.PI)) * 0.75 * stride + cr * 1.5 + this.lean * 0.3);
    this.rig.root.position.y = -Math.abs(Math.sin(w)) * 0.1 * stride - this.crouch * 0.42 - (this.pound > 1 ? 0.25 : 0);
    // torso: hunched brute lean, sway with each step, the hit snap, the boiler tremble
    const trem = this.tremble * Math.sin(this.t * 47) * 0.03;
    R('pelvis', 0, Math.sin(w) * 0.06 * stride, 0);
    R('torso', 0.16 + this.lean * 0.42 + this.crouch * 0.25 - hitK * 0.25 + Math.sin(this.t * 1.4) * 0.02 + trem, -Math.sin(w) * 0.1 * stride + this.aim * 0.18 + this.bash * -0.35, Math.sin(w) * 0.05 * stride + trem);
    // head: glares at the hunter, roars push the jaw
    const toX = this.player.pos.x - this.pos.x, toZ = this.player.pos.z - this.pos.z;
    let rel = Math.atan2(toX, toZ) - this.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    R('head', -0.12 + hitK * 0.3 - this.lean * 0.2, clamp(rel, -0.7, 0.7) * 0.6, 0);
    if (n['jaw']) n['jaw'].rotation.x = damp(n['jaw'].rotation.x, (this.rest['jaw']?.x ?? 0) + this.rig.exprJaw + this.anim.jaw + (this.tremble || this.crouchT === 1 ? 0.35 : 0), 14, dt);
    // shield arm: guard, plough while charging, both fists up for the pound, the bash shove
    const up = this.poundT > 0 ? 1 : 0;
    R('arm_l', -0.25 - this.guard * 0.15 - this.lean * 0.45 - up * 2.4 + this.pound * 0.9 - this.bash * 0.55 - Math.sin(w) * 0.15 * stride, 0, 0.12 + up * 0.25);
    R('fore_l', -this.lean * 0.1 + up * 0.6 + this.bash * 0.5, 0.15 * this.guard, 0);
    // gatling arm: swings when walking, aims when firing (recoil buzz while it spins)
    const buzz = this.spin > 5 ? Math.sin(this.t * 60) * 0.015 * (this.spin / 32) : 0;
    R('arm_r', -1.4 * this.aim + (1 - this.aim) * (Math.sin(w) * 0.3 * stride) - up * 2.2 + this.pound * 0.8 + this.lean * 0.4 + buzz, 0, -0.12 - up * 0.25);
    R('fore_r', 0.25 * this.aim + buzz);
    R('barrels', 0, this.barrelAng, 0);
    // the stack rocks with the chuffs
    R('stack', Math.sin(this.t * (this.chuff ? 14 : 3)) * (this.chuff ? 0.05 : 0.015), 0, 0);
    if (n['brow_l']) n['brow_l'].rotation.z = damp(n['brow_l'].rotation.z, this.rig.exprBrow[0], 12, dt);
    if (n['brow_r']) n['brow_r'].rotation.z = damp(n['brow_r'].rotation.z, this.rig.exprBrow[1], 12, dt);
  }

  die() {
    if (!this.alive) return;
    // everything still bolted on comes off; the furnace bursts
    for (const p of this.plates) if (!p.broken) this.breakPlate(p, undefined, true);
    this.ctx.fx.explosion(this.sock('heart', new THREE.Vector3()), 4);
    this.taunt('…end… of the… line…', '#ffb070');
    this.chuff = 0;
    super.die();
  }

  dispose() {
    super.dispose();
    // leave the torn plates in the sand for a while, then sink them
    const tw = this.ctx.engine.tweens;
    for (const db of this.debris) {
      db.rest = true;
      const m = db.mesh;
      tw.after(6, () => {
        void tw.tween(2, (k) => (m.position.y -= k * 0.02)).then(() => m.removeFromParent());
      });
    }
    this.debris.length = 0;
  }
}
void _s;
