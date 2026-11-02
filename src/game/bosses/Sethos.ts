// SETHOS, Hand of Set — the recurring major boss (waves 50 / 75 / 100).
// Form 1: storm-gunslinger (twin revolvers, sand-step teleports, red lightning).
// Form 2: the storm itself answers him (dust devils, riders, crossing curtains).
// Form 3: the Avatar of Set — a giant at the heart of the storm; climb the air
// (ramps, grapple) to shoot his head while dodging staff quakes and meteor rain.
import * as THREE from 'three';
import { Boss, BossDeps } from './Boss';
import { clamp, damp, rnd } from '../../engine/math/rand';

const _v = new THREE.Vector3();

export class Sethos extends Boss {
  constructor(d: BossDeps, public form: 1 | 2 | 3) {
    super(d, `sethos_${form}`, {
      name: form === 3 ? 'Avatar of Set' : 'Sethos',
      title: form === 1 ? 'Hand of Set' : form === 2 ? 'Voice of the Storm' : 'The Red God Walks',
      hp: form === 1 ? 9000 : form === 2 ? 15000 : 26000,
      eyes: ['glow', 0xff3a1a],
      scale: form === 3 ? 1.4 : 1,
    });
    this.phases = [0.66, 0.33];
    this.armor = 40 + form * 15;
    this.bounty = 600 * form;
    this.gold = 300 * form;
    if (form === 3) {
      this.hitSpheres = [
        { node: 'head', r: 1.6, part: 'head', weak: 2.5, offset: [0, 0.6, 0] },
        { node: 'torso', r: 2.6, part: 'torso', weak: 0.6, offset: [0, 1, 0] },
        { node: 'fore_r', r: 1.2, part: 'arm', weak: 0.8 },
      ];
    } else {
      this.hitSpheres = [
        { node: 'head', r: 0.5, part: 'head', weak: 1.9, offset: [0, 0.25, 0] },
        { node: 'torso', r: 0.75, part: 'torso', offset: [0, 0.3, 0] },
        { node: 'pelvis', r: 0.6, part: 'legs' },
      ];
    }
  }

  private gun(side: 'l' | 'r') {
    const n = this.rig.nodes[`gun_${side}`] ?? this.rig.sockets[`hand_${side}`];
    return n ? n.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z);
  }

  protected async fight() {
    if (this.form === 3) return this.fightAvatar();
    while (true) {
      this.check();
      const p = this.phase;
      const r = rnd.next();
      if (r < 0.26) await this.twinStorm();
      else if (r < 0.44) await this.sandStep();
      else if (r < 0.62 && p >= 1) await this.redLightning();
      else if (r < 0.74 && (p >= 1 || this.form === 2)) await this.callTheStorm();
      else if (r < 0.86) await this.deadEye();
      else await this.minions();
      await this.wait(Math.max(0.25, 0.7 - p * 0.15 - this.form * 0.1));
    }
  }

  // ---------------------------------------------------------- form 1/2 moves
  private async twinStorm() {
    this.stop();
    this.faceTarget(this.playerPos());
    this.anim.aimL = this.anim.aimR = 1;
    this.taunt(rnd.pick(['Dance for me, bone-rider.', 'Set sends his regards.', 'Six chambers, twelve ways to die.']), '#ff5a3a');
    await this.wait(0.4);
    const turns = 4 + this.phase * 2 + this.form;
    for (let i = 0; i < turns; i++) {
      this.fire('ring', { count: 10 + this.form * 2, speed: 10 + this.phase, dmg: 9 + this.form * 3, phase: i * 0.17 }, this.gun('l'));
      this.fire('ring', { count: 10 + this.form * 2, speed: 10 + this.phase, dmg: 9 + this.form * 3, phase: i * 0.17 + 0.5 }, this.gun('r'));
      this.ctx.sfx('enemy_shot', this.pos, 0.9, 0.8);
      this.yaw += 0.35;
      await this.wait(0.28);
    }
    this.anim.aimL = this.anim.aimR = 0;
  }

  private async sandStep() {
    const ctx = this.ctx;
    const pp = this.playerPos();
    ctx.fx.dust({ x: this.pos.x, y: this.pos.y + 1, z: this.pos.z }, 2.5, 0xc89a6a, 10);
    ctx.sfx('sand_burst', this.pos, 1);
    this.root.visible = false;
    this.invulnerable = true;
    await this.wait(0.35);
    const a = rnd.next() * Math.PI * 2;
    const R = 8 + rnd.next() * 6;
    this.place(pp.x + Math.cos(a) * R, pp.z + Math.sin(a) * R, 0);
    this.faceTarget(pp);
    ctx.fx.dust({ x: this.pos.x, y: this.pos.y + 1, z: this.pos.z }, 2.5, 0xc89a6a, 10);
    this.root.visible = true;
    this.invulnerable = false;
    this.anim.aimR = 1;
    this.fire('fan', { count: 5 + this.form * 2, spread: 0.6, speed: 24, dmg: 12 + this.form * 3 }, this.gun('r'));
    ctx.sfx('rev_shot', this.pos, 1, 0.8);
    await this.wait(0.35);
    this.anim.aimR = 0;
  }

  private async redLightning() {
    const ctx = this.ctx;
    this.stop();
    this.anim.wind = 1;
    this.setExpr('laugh');
    ctx.sfx('thunder', null, 0.9);
    ctx.engine.flash(0xff4020, 0.25, 0.3);
    const n = 3 + this.phase + this.form;
    const strikes: Promise<void>[] = [];
    for (let i = 0; i < n; i++) {
      const pv = this.player.board.vel;
      const at = this.playerPos().clone().addScaledVector(_v.set(pv.x, 0, pv.z), 0.5).add(new THREE.Vector3((rnd.next() - 0.5) * 4, 0, (rnd.next() - 0.5) * 4));
      strikes.push(
        this.slam(at, 2.6, 22 + this.form * 5, 0.7, 'fire').then(() => {
          ctx.sfx('thunder', at, 0.7);
          ctx.particles.emit({ pos: { x: at.x, y: at.y + 6, z: at.z }, count: 10, spread: 0.4, up: -20, life: [0.12, 0.2], size: [0.3, 0.6], sprite: 'spark', color: 0xff6040, additive: true });
        })
      );
      await this.wait(0.22);
    }
    await Promise.all(strikes);
    this.anim.wind = 0;
    this.setExpr('angry');
  }

  private async callTheStorm() {
    const ctx = this.ctx;
    this.taunt('The storm is MINE to command!', '#ff5a3a');
    ctx.sfx('thunder', null, 1);
    const pp = this.playerPos();
    for (let i = 0; i < 1 + this.form; i++) {
      const a = rnd.next() * Math.PI * 2;
      ctx.world.storm.spawnDevil(pp.x + Math.cos(a) * 14, pp.z + Math.sin(a) * 14, 4 + this.form, 10 + this.form * 4, 14);
    }
    if (this.form === 2) this.summon('outlaw', 2, 10, 'run');
    await this.wait(0.8);
  }

  private async deadEye() {
    const ctx = this.ctx;
    this.stop();
    this.faceTarget(this.playerPos());
    this.anim.aimR = 1;
    ctx.events.emit('cutin', 'DEAD EYE', '#ff5a3a', 'focus');
    ctx.sfx('time_slow', null, 0.8);
    await this.wait(0.9);
    for (let i = 0; i < 3 + this.form; i++) {
      this.faceTarget(this.playerPos());
      this.fire('snipe', { speed: 46, dmg: 20 + this.form * 6 }, this.gun('r'));
      ctx.sfx('rifle_shot', this.pos, 0.9);
      await this.wait(0.38);
    }
    this.anim.aimR = 0;
  }

  private async minions() {
    this.taunt(rnd.pick(['Jackals! Feast!', 'Rise, faithless dead!']), '#ff5a3a');
    this.summon(rnd.pick(['jackal', 'gunslinger', 'mummy', 'jackalArcher']), 3 + this.form, 7);
    await this.wait(0.6);
  }

  // ---------------------------------------------------------- form 3: the Avatar
  private async fightAvatar() {
    while (true) {
      this.check();
      const r = rnd.next();
      if (r < 0.32) await this.staffQuake();
      else if (r < 0.58) await this.meteorRain();
      else if (r < 0.8) await this.sweep();
      else await this.redLightning();
      await this.wait(Math.max(0.4, 1.1 - this.phase * 0.25));
    }
  }

  private async staffQuake() {
    const ctx = this.ctx;
    this.faceTarget(this.playerPos());
    this.anim.wind = 1;
    ctx.sfx('boss_roar', this.pos, 1, 0.6);
    await this.wait(0.9);
    this.anim.wind = 0;
    this.anim.strike = 1;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const at = this.pos.clone().addScaledVector(fwd, 8);
    await this.slam(at, 7, 40, 0.35, 'fire');
    ctx.shake(1);
    // shockwave rings
    for (let k = 0; k < 2 + this.phase; k++) {
      this.fire('ring', { count: 28, speed: 9 + k * 2, dmg: 14 }, at.clone().setY(ctx.world.groundAt(at.x, at.z) + 0.8));
      await this.wait(0.3);
    }
  }

  private async meteorRain() {
    const ctx = this.ctx;
    this.anim.wind = 0.6;
    ctx.sfx('thunder', null, 1);
    const n = 6 + this.phase * 4;
    const all: Promise<void>[] = [];
    for (let i = 0; i < n; i++) {
      const pp = this.playerPos();
      const at = new THREE.Vector3(pp.x + (rnd.next() - 0.5) * 18, 0, pp.z + (rnd.next() - 0.5) * 18);
      if (i % 3 === 0) at.set(pp.x, 0, pp.z);
      all.push(this.slam(at, 3, 26, 1.1, 'fire'));
      await this.wait(0.16);
    }
    await Promise.all(all);
    this.anim.wind = 0;
  }

  private async sweep() {
    this.faceTarget(this.playerPos());
    this.anim.aimR = 1;
    this.setExpr('enraged');
    const from = new THREE.Vector3(this.pos.x, this.pos.y + 1.2, this.pos.z);
    for (let i = 0; i < 14 + this.phase * 6; i++) {
      this.fire('spiral', { count: 3, speed: 13, dmg: 12, proj: 'curse' }, from);
      this.yaw += 0.22;
      await this.wait(0.12);
    }
    this.anim.aimR = 0;
  }

  protected onPhase(p: number) {
    super.onPhase(p);
    if (this.form < 3) void this.sandStep().catch(() => {});
  }

  protected animate(dt: number) {
    super.animate(dt);
    if (this.form === 3) {
      // the giant breathes; the storm swirls around him
      const n = this.rig.nodes;
      if (n['torso']) n['torso'].rotation.x += Math.sin(this.t * 0.8) * 0.03;
      if (rnd.chance(dt * 6)) this.ctx.particles.emit({ pos: { x: this.pos.x + (rnd.next() - 0.5) * 8, y: this.pos.y + rnd.next() * this.height, z: this.pos.z + (rnd.next() - 0.5) * 8 }, count: 2, spread: 2, up: 0.5, life: [1.2, 2], size: [0.8, 1.6], sprite: ['cloud0', 'cloud1'], color: 0xb05a3a, alpha: 0.5, drag: 0.6 });
    }
    this.anim.aimL = damp(this.anim.aimL, this.anim.aimL, 1, dt);
    void clamp;
  }
}
