// Minibosses (every 5th wave): Big Bertha, the Dust Marshal (recurring, escapes
// through a High Noon duel), the Sunroller and its blazing dung-sun, the Pharaoh
// behind his sarcophagus lid, and the Sandworm. Each is a coroutine script on
// top of Boss: telegraph → commit → recover, faster and meaner per phase.
import * as THREE from 'three';
import { Boss, BossDeps, Cancelled } from './Boss';
import type { RayHit } from '../Ctx';
import type { Hit } from '../combat/Damage';
import { modelEntry } from '../models/lookup';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { clamp, damp, rnd } from '../../engine/math/rand';
import { P } from '../../engine/voxel/palette';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** QTE DODGE for a miniboss blow (the shared enemies.dodge); true = the hunter twisted clear */
async function dodgeQte(b: Boss, from: { x: number; z: number }, inZone: () => boolean) {
  const dg = b.d.enemies.dodge;
  if (!dg.qte) dg.qte = b.d.qte;
  if (!b.alive || !inZone() || !dg.ready()) return false;
  const r = await dg.offer({ from });
  return r === 'good' || r === 'perfect';
}

function nodeWorld(b: Boss, name: string, out = new THREE.Vector3()) {
  const n = b.rig.nodes[name] ?? b.rig.sockets[name];
  if (!n) return out.set(b.pos.x, b.pos.y + b.height * 0.6, b.pos.z);
  return n.getWorldPosition(out);
}

// ============================================================== BIG BERTHA
/** wave 5: a giant mama scorpion. Charges, venom tail slams, spits, burrows, calls her brood */
export class BigBertha extends Boss {
  private dashing = false;
  constructor(d: BossDeps, tier = 1) {
    super(d, 'big_bertha', { name: 'Big Bertha', title: 'Mother of a Thousand Stings', hp: 2400 * tier, eyes: ['organic', 0x1a0808] });
    this.hitSpheres = [
      { node: 'body', r: 1.5, part: 'body', offset: [0, 0.3, 0] },
      { node: 'stinger', r: 0.65, part: 'stinger', weak: 2.2 },
      { node: 'arm_l', r: 0.7, part: 'claw' },
      { node: 'arm_r', r: 0.7, part: 'claw' },
    ];
    this.armor = 40;
    this.bounty = 180 * tier;
    this.gold = 90 * tier;
    this.statusRes = { poison: 0.6 };
  }
  protected hitKind() {
    return 'chitin' as any;
  }

  protected async fight() {
    while (true) {
      this.check();
      const p = this.phase;
      const r = rnd.next();
      const d = this.distToPlayer();
      if (d > 18 || r < 0.28) await this.charge();
      else if (r < 0.52) await this.tailSlams(p >= 1 ? 3 : 1);
      else if (r < 0.74) await this.spit();
      else if (p >= 1 && r < 0.88) await this.burrow();
      else await this.brood();
      await this.wait(p >= 2 ? 0.45 : 0.85);
    }
  }

  private async charge() {
    const ctx = this.ctx;
    this.stop();
    this.setExpr('angry');
    this.anim.wind = 1;
    ctx.sfx('boss_roar', this.pos, 0.7, 1.25);
    this.d.enemies.warn.bang(this, { tier: 'heavy', life: 0.7, y: this.height + 0.6 });
    for (let i = 0; i < 5; i++) {
      this.faceTarget(this.playerPos());
      const dir = _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      for (let k = 2; k < 14; k += 3) ctx.particles.emit({ pos: { x: this.pos.x + dir.x * k, y: this.pos.y + 0.2, z: this.pos.z + dir.z * k }, count: 1, spread: 0.3, up: 0.6, life: [0.3, 0.5], size: [0.3, 0.5], sprite: ['puff0', 'puff1'], color: 0xe0c08a, alpha: 0.6 });
      await this.wait(0.14);
    }
    this.anim.wind = 0;
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const end = this.pos.clone().addScaledVector(dir, Math.min(32, this.distToPlayer() + 9));
    this.moveTarget = end;
    this.moveSpeed = 24 + this.phase * 5;
    this.dashing = true;
    let hit = false, offered = false, dodged = false;
    const t0 = this.t;
    ctx.sfx('whoosh_big', this.pos, 0.9);
    try {
      while (this.t - t0 < 1.7 && Math.hypot(end.x - this.pos.x, end.z - this.pos.z) > 1.6) {
        await this.wait(0.03);
        ctx.fx.dust({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z }, 1.2, 0xe6cf9f, 2);
        if (!offered && this.distToPlayer() < this.radius + 4.5) {
          offered = true;
          const px = this.player.pos.x - this.pos.x, pz = this.player.pos.z - this.pos.z;
          dodged = await dodgeQte(this, this.pos, () => px * dir.x + pz * dir.z > 0);
        }
        if (!hit && !dodged && this.distToPlayer() < this.radius + 1.3 && Math.abs(this.player.pos.y - this.pos.y) < 2.5) {
          hit = true;
          this.player.takeHit({ base: 26 + this.phase * 7, kind: 'phys', source: 'contact', knock: 18 }, this.pos.clone());
          ctx.shake(0.5);
          ctx.fx.word(this.player.pos, 'w_crack');
        }
        ctx.events.emit('bossPlow', this.pos, this.radius + 0.6);
      }
    } finally {
      this.dashing = false;
      this.stop();
    }
    this.squash.kick(3);
    this.anim.strike = 1;
    ctx.sfx('punch', this.pos, 0.9, 0.7);
    ctx.fx.sandBurst({ x: this.pos.x + dir.x * 2, y: this.pos.y, z: this.pos.z + dir.z * 2 }, 1.4);
    await this.wait(0.5);
  }

  private async tailSlams(n: number) {
    for (let i = 0; i < n; i++) {
      const pv = this.player.board.vel;
      const tgt = this.playerPos().clone().addScaledVector(_v.set(pv.x, 0, pv.z), 0.45);
      this.faceTarget(tgt);
      this.anim.wind = 1;
      this.ctx.sfx('scorpion_sting', this.pos, 0.6, 0.7);
      await this.slam(tgt, 3.2 + this.phase * 0.4, 24 + this.phase * 4, i === 0 ? 0.9 : 0.6, 'venom');
      this.anim.wind = 0;
      this.anim.strike = 1;
      if (this.phase >= 2) this.fire('ring', { count: 12, speed: 9, dmg: 8, proj: 'venom' }, tgt.clone().setY(tgt.y + 0.6));
      await this.wait(0.25);
    }
  }

  private async spit() {
    this.faceTarget(this.playerPos());
    this.setExpr('angry');
    this.anim.wind = 0.6;
    await this.wait(0.45);
    const from = nodeWorld(this, 'stinger');
    const venom = [{ id: 'poison' as const, stacks: 2, dur: 4 }];
    if (this.phase >= 2) this.fire('spiral', { count: 22, speed: 12, dmg: 9, proj: 'venom', status: venom }, from);
    else this.fire('fan', { count: 7 + this.phase * 2, spread: 1.1, speed: 15, dmg: 10, proj: 'venom', status: venom }, from);
    this.anim.wind = 0;
    this.anim.strike = 1;
    this.ctx.sfx('poison_burst', this.pos, 0.7);
    await this.wait(0.6);
  }

  private async burrow() {
    const ctx = this.ctx;
    this.stop();
    this.invulnerable = true;
    ctx.sfx('quake_rumble', this.pos, 0.9);
    // sink
    const y0 = this.pos.y;
    for (let i = 0; i < 12; i++) {
      this.rig.root.position.y = -i * 0.25;
      ctx.fx.sandBurst({ x: this.pos.x, y: y0, z: this.pos.z }, 0.8);
      await this.wait(0.05);
    }
    this.root.visible = false;
    // tunnel toward the player (a dust trail on the surface)
    const t0 = this.t;
    while (this.t - t0 < 2.2) {
      const tg = this.playerPos();
      const dx = tg.x - this.pos.x, dz = tg.z - this.pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      this.pos.x += (dx / dl) * Math.min(dl, 26 * 0.05);
      this.pos.z += (dz / dl) * Math.min(dl, 26 * 0.05);
      ctx.fx.dust({ x: this.pos.x, y: ctx.world.groundAt(this.pos.x, this.pos.z) + 0.2, z: this.pos.z }, 1.3, 0xe6cf9f, 3);
      ctx.events.emit('groundMark', this.pos.x, this.pos.z, 1.2, 1);
      await this.wait(0.05);
    }
    // erupt under the player
    const at = this.playerPos().clone();
    this.pos.x = at.x;
    this.pos.z = at.z;
    const g = ctx.world.groundAt(at.x, at.z);
    this.root.visible = true;
    this.rig.root.position.y = -3;
    this.d.enemies.warn.bang({ x: at.x, y: g, z: at.z }, { tier: 'heavy', life: 0.9, y: 3 });
    const slam = this.slam(at, 4.6, 34 + this.phase * 6, 0.9, 'sand');
    await this.wait(0.72);
    const pl = this.player;
    await dodgeQte(this, at, () => Math.hypot(pl.pos.x - at.x, pl.pos.z - at.z) < 4.6);
    await slam;
    this.player.board.impulse.y += 14;
    this.pos.y = g;
    for (let i = 0; i < 10; i++) {
      this.rig.root.position.y = -3 * (1 - (i + 1) / 10) + Math.sin(((i + 1) / 10) * Math.PI) * 1.2;
      await this.wait(0.03);
    }
    this.rig.root.position.y = 0;
    this.invulnerable = false;
    this.setExpr('laugh');
    await this.wait(0.7);
  }

  private async brood() {
    this.taunt(rnd.pick(['Babies! Dinner is served!', 'Go on, sweeties!', 'Mama is busy, darlings!']), '#ff9a5a');
    this.ctx.sfx('scorpion_chitter', this.pos, 1);
    this.summon(this.phase >= 2 ? 'bombScarab' : 'scarab', 4 + this.phase * 2, 5);
    this.anim.wind = 0.5;
    await this.wait(1.1);
    this.anim.wind = 0;
  }

  protected onPhase(p: number) {
    super.onPhase(p);
    this.summon('scarab', 3, 6);
  }

  protected animate(dt: number) {
    const n = this.rig.nodes;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.anim.walk += dt * (3 + sp * 1.6);
    const w = this.anim.walk;
    const stride = clamp(sp / 5, 0.15, 1.3);
    for (let i = 1; i <= 4; i++) {
      const ph = w + i * 1.3;
      const l = n['leg_l' + i], r = n['leg_r' + i];
      if (l) l.rotation.set(0, Math.sin(ph) * 0.35 * stride, Math.max(0, Math.cos(ph)) * 0.3 * stride);
      if (r) r.rotation.set(0, -Math.sin(ph + Math.PI) * 0.35 * stride, -Math.max(0, Math.cos(ph + Math.PI)) * 0.3 * stride);
    }
    // tail: idle sway, wind-up curl, strike whip
    const wind = this.anim.wind, strike = this.anim.strike;
    for (let k = 1; k <= 5; k++) {
      const t = n['tail' + k];
      if (!t) continue;
      t.rotation.x = -0.18 - wind * 0.22 + strike * 0.32 + Math.sin(this.t * 2 + k * 0.7) * 0.04;
      t.rotation.y = Math.sin(this.t * 1.3 + k) * 0.05;
    }
    const snap = this.dashing ? 0.9 : Math.max(0, Math.sin(this.t * 3)) * 0.25 + wind * 0.4;
    if (n['pincer_l']) n['pincer_l'].rotation.x = -snap;
    if (n['pincer_r']) n['pincer_r'].rotation.x = -snap;
    if (n['arm_l']) n['arm_l'].rotation.set(-wind * 0.3, 0.2 - strike * 0.4, 0);
    if (n['arm_r']) n['arm_r'].rotation.set(-wind * 0.3, -0.2 + strike * 0.4, 0);
    if (n['body']) n['body'].rotation.x = -wind * 0.08 + strike * 0.06;
    this.anim.strike = Math.max(0, this.anim.strike - dt * 3);
  }
}

// ============================================================== DUST MARSHAL
/** recurring gunslinger lawman (tiers 1-3). Escapes through a High Noon duel until tier 3 */
export class DustMarshal extends Boss {
  private dueled = false;
  constructor(d: BossDeps, public tier: 1 | 2 | 3 = 1) {
    super(d, `dust_marshal_${tier}`, { name: 'The Dust Marshal', title: tier === 3 ? 'Last Law of the Dunes' : 'Badge of Bone', hp: 1800 + tier * 1400, scale: 1.25, eyes: ['glow', 0xffc040] });
    this.hitSpheres = [
      { node: 'head', r: 0.5, part: 'head', weak: 1.8, offset: [0, 0.34, 0] },
      { node: 'torso', r: 0.6, part: 'torso', offset: [0, 0.3, 0] },
      { node: 'pelvis', r: 0.5, part: 'legs' },
    ];
    this.armor = 25 + tier * 10;
    this.phases = [0.75, 0.5, 0.25];
    this.bounty = 160 + tier * 90;
    this.gold = 80 + tier * 50;
  }

  protected async fight() {
    while (true) {
      this.check();
      const r = rnd.next();
      if (r < 0.35) await this.strafeAndShoot();
      else if (r < 0.58) await this.fanTheHammer();
      else if (r < 0.78) await this.dynamite();
      else if (r < 0.9) await this.posse();
      else await this.roll();
      await this.wait(0.55 - this.tier * 0.08);
    }
  }

  private gunPos(side: 'l' | 'r') {
    return nodeWorld(this, `gun_${side}`, new THREE.Vector3());
  }

  private async strafeAndShoot() {
    const pp = this.playerPos();
    const a = Math.atan2(this.pos.x - pp.x, this.pos.z - pp.z) + (rnd.chance(0.5) ? 1 : -1) * 0.9;
    const R = clamp(this.distToPlayer(), 10, 18);
    const mv = this.moveTo(pp.x + Math.sin(a) * R, pp.z + Math.cos(a) * R, 7 + this.tier, 2.2);
    for (let i = 0; i < 3 + this.tier; i++) {
      this.anim.aimR = 1;
      this.anim.aimL = i % 2;
      this.fire('burst', { count: 2 + this.tier, speed: 26, dmg: 9 + this.tier * 2 }, this.gunPos(i % 2 ? 'l' : 'r'));
      this.ctx.sfx('enemy_shot', this.pos, 0.8);
      await this.wait(0.4);
    }
    await mv;
    this.anim.aimR = this.anim.aimL = 0;
  }

  private async fanTheHammer() {
    this.stop();
    this.faceTarget(this.playerPos());
    this.taunt(rnd.pick(['Draw, bonehead!', 'You\'re under arrest… permanently.', 'Six for you, partner.']));
    this.anim.aimR = 1;
    this.anim.wind = 0.4;
    await this.wait(0.5);
    for (let k = 0; k < 2 + (this.tier >= 2 ? 1 : 0); k++) {
      this.faceTarget(this.playerPos());
      this.fire('fan', { count: 6 + this.tier, spread: 0.7 + k * 0.15, speed: 22, dmg: 8 + this.tier * 2 }, this.gunPos('r'));
      this.ctx.sfx('enemy_shot', this.pos, 1, 0.9);
      this.anim.strike = 0.5;
      await this.wait(0.35);
    }
    this.anim.aimR = 0;
    this.anim.wind = 0;
  }

  private async dynamite() {
    this.faceTarget(this.playerPos());
    this.anim.wind = 1;
    await this.wait(0.4);
    this.fire('lob', { count: 1 + this.tier, speed: 14, dmg: 24, proj: 'dynamite' }, nodeWorld(this, 'hand_l'));
    this.ctx.sfx('dynamite_fuse', this.pos, 0.8);
    this.anim.wind = 0;
    this.anim.strike = 1;
    await this.wait(0.6);
  }

  private async posse() {
    this.taunt('Deputies! Round him up!');
    this.summon(this.tier >= 2 ? 'shotgunner' : 'gunslinger', 2 + this.tier, 7, 'run');
    await this.wait(0.8);
  }

  private async roll() {
    const side = rnd.chance(0.5) ? 1 : -1;
    const right = _v.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(side * 6);
    this.invulnerable = true;
    this.ctx.sfx('whoosh', this.pos, 0.8);
    await this.moveTo(this.pos.x + right.x, this.pos.z + right.z, 16, 0.5);
    this.invulnerable = false;
  }

  protected onPhase(p: number) {
    super.onPhase(p);
    if (p >= 2 && !this.dueled && this.alive) {
      this.dueled = true;
      void this.highNoon().catch((e) => {
        if (!(e instanceof Cancelled)) console.error(e);
      });
    }
  }

  /** the duel: everyone freezes, the bell tolls, draw on the ring */
  private async highNoon() {
    const ctx = this.ctx;
    const eng = ctx.engine;
    this.stop();
    this.invulnerable = true;
    eng.letterbox(true, 0.4);
    ctx.events.emit('cutin', 'HIGH NOON', '#ffd36b', 'determined');
    ctx.sfx('time_slow', null, 1);
    const pp = this.playerPos();
    this.faceTarget(pp);
    const mid = pp.clone().add(this.pos).multiplyScalar(0.5);
    const side = new THREE.Vector3(this.pos.z - pp.z, 0, pp.x - this.pos.x).normalize();
    this.d.cam.setCine({ pos: mid.clone().addScaledVector(side, 9).add(new THREE.Vector3(0, 1.6, 0)), look: mid.clone().add(new THREE.Vector3(0, 1.4, 0)), fov: 40 });
    await eng.tweens.wait(1.2, true);
    const r = await this.d.qte.run({ kind: 'ring', key: 'KeyF', label: 'DRAW!', duration: 0.75 - this.tier * 0.08, at: () => ({ x: this.pos.x, y: this.pos.y + this.height * 0.6, z: this.pos.z }) });
    this.anim.aimR = 1;
    ctx.sfx('rev_shot', null, 1);
    eng.hitStop(0.12);
    if (r === 'perfect' || r === 'good') {
      this.invulnerable = false;
      this.takeDamage({ base: this.maxHp * (r === 'perfect' ? 0.16 : 0.08), kind: 'phys', source: 'gun', canCrit: false });
      ctx.fx.word(this.pos.clone().setY(this.pos.y + this.height), r === 'perfect' ? 'w_headshot' : 'w_bang', 1.3, true);
      this.setExpr('hurt');
      ctx.toast(r === 'perfect' ? 'FASTEST GUN IN THE DUNES' : 'CLEAN DRAW', '#ffd36b');
    } else {
      this.player.takeHit({ base: 30, kind: 'phys', source: 'gun', knock: 8 }, this.pos.clone());
      this.setExpr('smug');
      ctx.toast('TOO SLOW', '#ff6a3a');
    }
    await eng.tweens.wait(0.8, true);
    this.d.cam.setCine(null);
    eng.letterbox(false, 0.4);
    this.invulnerable = false;
    if (this.tier < 3 && this.alive) await this.escape(this.tier === 1 ? 'This town ain\'t big enough… yet.' : 'Next time, I bring the whole county.');
  }
}

// ============================================================== SUNROLLER
/** a sacred dung beetle rolling a burning sun-ball that chases the player. Pop the ball → beetle is stunned */
export class Sunroller extends Boss {
  private ball = new THREE.Group();
  private ballPos = new THREE.Vector3();
  private ballVel = new THREE.Vector3();
  private ballR = 1.6;
  private ballHp = 1;
  private ballMax = 1;
  private stunned = 0;
  constructor(d: BossDeps, tier = 1) {
    super(d, 'sunroller', { name: 'The Sunroller', title: 'Khepri\'s Wayward Son', hp: 2600 * tier, eyes: ['organic', 0x2a1408] });
    this.hitSpheres = [{ node: 'body', r: 1.3, part: 'body', offset: [0, 0.3, 0] }, { node: 'head', r: 0.6, part: 'head', weak: 1.6 }];
    this.armor = 55;
    this.ballMax = this.ballHp = 500 * tier;
    const sm = modelEntry('sun_ball')?.() as any;
    if (sm?.model) {
      const geo = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: 'center' });
      geo.computeBoundingSphere();
      this.ballR = geo.boundingSphere!.radius * 0.9;
      const mesh = new THREE.Mesh(geo, makeVoxelMaterial());
      mesh.castShadow = true;
      this.ball.add(mesh);
    } else {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(this.ballR, 1), new THREE.MeshStandardMaterial({ color: 0x8a5a2a, flatShading: true, emissive: 0x401000 }));
      this.ball.add(mesh);
    }
    d.ctx.scene.add(this.ball);
    this.bounty = 200 * tier;
  }

  place(x: number, z: number, yaw = 0) {
    super.place(x, z, yaw);
    this.ballPos.set(x + Math.sin(yaw) * 3, 0, z + Math.cos(yaw) * 3);
  }

  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    const best = super.hitTest(o, d, maxT);
    if (this.ballHp <= 0 || !this.alive) return best;
    const c = _v2.copy(this.ballPos).setY(this.ballPos.y + this.ballR);
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const disc = b * b - (ox * ox + oy * oy + oz * oz - this.ballR * this.ballR);
    if (disc < 0) return best;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > (best?.t ?? maxT)) return best;
    const point = o.clone().addScaledVector(d, t);
    return { enemy: this, t, point, normal: point.clone().sub(c).normalize(), headshot: false, part: 'ball', surface: 'enemy' };
  }

  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    if (hit.tags?.[0] === 'ball' && this.ballHp > 0) {
      const amt = Math.round((hit.base ?? 10) * (hit.mult ?? 1));
      this.ballHp -= amt;
      this.ctx.fx.hit(point ?? this.ballPos, { x: 0, y: 1, z: 0 }, 'sand', 1);
      this.ctx.fx.number({ x: (point ?? this.ballPos).x, y: (point ?? this.ballPos).y + 0.4, z: (point ?? this.ballPos).z }, amt, 0xffb050, 1);
      if (this.ballHp <= 0) this.popBall();
      return amt;
    }
    const mult = this.stunned > 0 ? 2 : 1;
    return super.takeDamage({ ...hit, mult: (hit.mult ?? 1) * mult }, point, dir);
  }

  private popBall() {
    const ctx = this.ctx;
    const c = { x: this.ballPos.x, y: this.ballPos.y + this.ballR, z: this.ballPos.z };
    ctx.fx.explosion(c, 4.5);
    ctx.fx.word(c, 'w_splat', 1.4, true);
    ctx.sfx('explosion_big', c, 1);
    ctx.sfx('scarab_squish', c, 1);
    ctx.shake(0.6);
    ctx.particles.emit({ pos: c, count: 40, spread: 6, up: 6, life: [0.8, 1.6], size: [0.2, 0.4], sprite: ['dot3', 'puff0'], color: [0x7a5530, 0x5c3e22, 0xffa040], gravity: 14, ground: true });
    ctx.events.emit('groundMark', c.x, c.z, 4, 1);
    this.ball.visible = false;
    this.stunned = 5;
    this.setExpr('stunned');
    ctx.toast('SUN-BALL POPPED', '#ffd36b', 'He\'s dizzy — unload!');
    ctx.engine.tweens.after(6.5, () => {
      if (!this.alive) return;
      this.ballMax = Math.round(this.ballMax * 1.2);
      this.ballHp = this.ballMax;
      this.ball.visible = true;
      this.ballPos.set(this.pos.x + Math.sin(this.yaw) * 3, 0, this.pos.z + Math.cos(this.yaw) * 3);
      this.ballVel.set(0, 0, 0);
      this.setExpr('angry');
      ctx.sfx('dung_roll_loop', this.pos, 1);
    });
  }

  protected async fight() {
    while (true) {
      this.check();
      if (this.stunned > 0) {
        this.stop();
        await this.wait(0.25);
        continue;
      }
      if (this.ballHp > 0) {
        // keep behind the ball, pushing it toward the player
        const pp = this.playerPos();
        const dx = pp.x - this.ballPos.x, dz = pp.z - this.ballPos.z;
        const dl = Math.hypot(dx, dz) || 1;
        const behind = { x: this.ballPos.x - (dx / dl) * (this.ballR + 1.4), z: this.ballPos.z - (dz / dl) * (this.ballR + 1.4) };
        this.moveTarget = new THREE.Vector3(behind.x, 0, behind.z);
        this.moveSpeed = 9 + this.phase * 2.5;
        if (rnd.chance(0.12 + this.phase * 0.05)) {
          // solar flare off the ball
          this.fire(this.phase >= 2 ? 'spiral' : 'ring', { count: this.phase >= 2 ? 20 : 12, speed: 11, dmg: 9, proj: 'sand', status: [{ id: 'burn', stacks: 2, dur: 3 }] }, _v.copy(this.ballPos).setY(this.ballPos.y + this.ballR));
          this.ctx.sfx('whoosh_big', this.ballPos, 0.8);
        }
        await this.wait(0.3);
      } else {
        // no ball: charge around like an angry bull
        await this.moveTo(this.playerPos().x, this.playerPos().z, 13, 1.5);
        await this.wait(0.3);
      }
    }
  }

  update(dt: number) {
    super.update(dt);
    if (!this.alive) {
      this.ball.visible = false;
      return;
    }
    this.stunned = Math.max(0, this.stunned - dt);
    if (this.ballHp <= 0) return;
    // push physics: beetle contact accelerates the ball toward the player
    const pp = this.player.pos;
    const bdx = this.ballPos.x - this.pos.x, bdz = this.ballPos.z - this.pos.z;
    const bd = Math.hypot(bdx, bdz) || 1;
    if (bd < this.ballR + 2.2 && this.stunned <= 0) {
      const tx = pp.x - this.ballPos.x, tz = pp.z - this.ballPos.z;
      const tl = Math.hypot(tx, tz) || 1;
      const acc = 9 + this.phase * 3;
      this.ballVel.x += ((bdx / bd) * 0.5 + (tx / tl) * 0.5) * acc * dt;
      this.ballVel.z += ((bdz / bd) * 0.5 + (tz / tl) * 0.5) * acc * dt;
    }
    const maxV = 11 + this.phase * 3;
    const v = Math.hypot(this.ballVel.x, this.ballVel.z);
    if (v > maxV) this.ballVel.multiplyScalar(maxV / v);
    this.ballVel.x = damp(this.ballVel.x, 0, 0.6, dt);
    this.ballVel.z = damp(this.ballVel.z, 0, 0.6, dt);
    this.ballPos.x += this.ballVel.x * dt;
    this.ballPos.z += this.ballVel.z * dt;
    const g = this.ctx.world.groundAt(this.ballPos.x, this.ballPos.z);
    this.ballPos.y = g;
    this.ball.position.set(this.ballPos.x, g + this.ballR, this.ballPos.z);
    // roll: rotate about the axis perpendicular to velocity
    if (v > 0.1) {
      const axis = _v.set(this.ballVel.z, 0, -this.ballVel.x).normalize();
      this.ball.rotateOnWorldAxis(axis, (v * dt) / this.ballR);
    }
    // burning trail + crushing
    if (v > 3 && rnd.chance(dt * 12)) {
      this.ctx.events.emit('groundMark', this.ballPos.x, this.ballPos.z, this.ballR * 0.8, 1);
      this.ctx.particles.emit({ pos: { x: this.ballPos.x, y: g + 0.3, z: this.ballPos.z }, count: 3, spread: 1, up: 1.5, life: [0.4, 0.8], size: [0.2, 0.35], sprite: ['flame0', 'flame1'], color: [0xffb040, 0xff7020], additive: true, drag: 1 });
    }
    this.ctx.events.emit('bossPlow', this.ballPos, this.ballR + 0.3);
    const pd = Math.hypot(pp.x - this.ballPos.x, pp.z - this.ballPos.z);
    if (pd < this.ballR + 0.6 && this.player.pos.y < g + this.ballR * 2 && this.t % 0.6 < dt) {
      this.player.takeHit({ base: 22 + this.phase * 5, kind: 'phys', source: 'contact', knock: 14, status: [{ id: 'burn', stacks: 3, dur: 3 }] }, this.ballPos.clone());
      this.ctx.fx.word(this.player.pos, 'w_pow');
    }
  }

  dispose() {
    super.dispose();
    this.ball.removeFromParent();
  }

  protected animate(dt: number) {
    const n = this.rig.nodes;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.anim.walk += dt * (4 + sp * 2);
    const w = this.anim.walk;
    const st = clamp(sp / 4, 0.2, 1.2);
    for (let i = 1; i <= 3; i++) {
      const l = n['leg_l' + i], r = n['leg_r' + i];
      if (l) l.rotation.set(Math.sin(w + i * 2.1) * 0.4 * st, 0, 0);
      if (r) r.rotation.set(Math.sin(w + i * 2.1 + Math.PI) * 0.4 * st, 0, 0);
    }
    const dizzy = this.stunned > 0;
    if (n['head']) n['head'].rotation.set(dizzy ? Math.sin(this.t * 7) * 0.2 : 0, dizzy ? Math.sin(this.t * 5) * 0.4 : Math.sin(this.t) * 0.1, 0);
    if (n['body']) n['body'].rotation.set(-0.05 + (dizzy ? 0.1 : 0), 0, dizzy ? Math.sin(this.t * 6) * 0.15 : 0);
    if (dizzy && rnd.chance(dt * 4)) this.ctx.particles.emit({ pos: { x: this.pos.x, y: this.pos.y + this.height + 0.3, z: this.pos.z }, count: 1, vel: { x: 0, y: 0.5, z: 0 }, life: [0.6, 0.6], size: [0.35, 0.35], sprite: 'fx_star', color: 0xffffff, screen: true });
  }
}

// ============================================================== PHARAOH
/** cursed king behind a sarcophagus-lid shield: flank him or break his guard with the balance duel */
export class Pharaoh extends Boss {
  constructor(d: BossDeps, tier = 1) {
    super(d, 'pharaoh', { name: 'Pharaoh Nekh-Amun', title: 'He Who Refuses to Lie Down', hp: 3000 * tier, scale: 1.3, eyes: ['glow', 0x7fe0ff] });
    this.hitSpheres = [
      { node: 'head', r: 0.52, part: 'head', weak: 1.8, offset: [0, 0.36, 0] },
      { node: 'torso', r: 0.65, part: 'torso', offset: [0, 0.3, 0] },
    ];
    this.frontGuard = 0.12;
    this.armor = 35;
    this.bounty = 220 * tier;
  }
  protected hitKind() {
    return 'linen' as any;
  }

  protected async fight() {
    while (true) {
      this.check();
      const r = rnd.next();
      this.guarding = true;
      if (r < 0.3) await this.curseSlam();
      else if (r < 0.55) await this.scarabStorm();
      else if (r < 0.75) await this.raiseDead();
      else if (this.phase >= 1 && r < 0.9) await this.lidThrow();
      else await this.advance();
      await this.wait(0.6);
    }
  }

  private async advance() {
    const pp = this.playerPos();
    await this.moveTo(pp.x, pp.z, 4.5 + this.phase, 2.2);
  }

  private async curseSlam() {
    this.stop();
    this.faceTarget(this.playerPos());
    this.anim.wind = 1;
    this.guarding = false;
    this.ctx.sfx('divine_whisper', this.pos, 0.9);
    this.d.enemies.warn.bang(this, { tier: 'heavy', life: 0.8 * (1 + this.phase), y: this.height + 0.5 });
    const n = 1 + this.phase;
    for (let i = 0; i < n; i++) {
      const pv = this.player.board.vel;
      await this.slam(this.playerPos().clone().addScaledVector(_v.set(pv.x, 0, pv.z), 0.4), 3.4, 22 + this.phase * 5, 0.8, 'curse');
    }
    this.anim.wind = 0;
    this.anim.strike = 1;
    this.guarding = true;
  }

  private async scarabStorm() {
    this.stop();
    this.faceTarget(this.playerPos());
    this.guarding = false;
    this.anim.aimR = 1;
    await this.wait(0.4);
    const from = nodeWorld(this, 'weapon');
    for (let k = 0; k < 2 + this.phase; k++) {
      this.fire(k % 2 ? 'spiral' : 'fan', { count: k % 2 ? 18 : 9, spread: 1.4, speed: 12, dmg: 9, proj: 'curse', status: [{ id: 'curse', stacks: 1, dur: 5 }] }, from);
      await this.wait(0.45);
    }
    this.anim.aimR = 0;
    this.guarding = true;
  }

  private async raiseDead() {
    this.taunt(rnd.pick(['RISE, MY SERVANTS.', 'Kneel before your king!', 'The dead obey me, not you.']), '#7fe0ff');
    this.ctx.sfx('divine_whisper', this.pos, 1, 0.8);
    this.summon(this.phase >= 2 ? 'bandageWhipper' : 'mummy', 2 + this.phase, 6);
    await this.wait(1);
  }

  /** hurls the lid: it boomerangs; while it flies he's open — and the player can win a balance duel to stagger him */
  private async lidThrow() {
    const ctx = this.ctx;
    this.stop();
    this.faceTarget(this.playerPos());
    this.guarding = false;
    this.anim.wind = 1;
    await this.wait(0.6);
    this.anim.wind = 0;
    this.anim.strike = 1;
    this.fire('burst', { count: 1, speed: 20, dmg: 30, proj: 'bone' }, nodeWorld(this, 'shield'));
    this.rig.setPartVisible('shield', false);
    ctx.sfx('whoosh_big', this.pos, 1);
    if (this.distToPlayer() < 9) {
      const r = await this.qte({ kind: 'balance', label: 'HOLD YOUR GROUND', duration: 2.4, drift: 0.9 + this.phase * 0.3 });
      if (r !== 'fail') {
        ctx.toast('GUARD BROKEN', '#7fe0ff', 'He\'s wide open!');
        this.setExpr('stunned');
        this.status.apply('stun', 1, 3, 1, 1, {});
        await this.wait(3);
      } else this.player.takeHit({ base: 20, kind: 'phys', source: 'contact', knock: 12 }, this.pos.clone());
    } else await this.wait(2);
    this.rig.setPartVisible('shield', true);
    this.guarding = true;
  }
}

// ============================================================== SANDWORM
/** burrows, breaches in arcs, and can swallow you whole (mash out, or shoot its gullet) */
export class Sandworm extends Boss {
  private segs: THREE.Object3D[] = [];
  private trail: THREE.Vector3[] = [];
  private under = true;
  private spacing = 1.4;
  constructor(d: BossDeps, tier = 1) {
    super(d, tier > 1 ? 'sandworm_big' : 'sandworm', { name: 'Old Gulp', title: 'The Dune That Eats', hp: 3400 * tier, eyes: ['organic', 0x2a0a08] });
    this.hitSpheres = [{ node: 'head', r: 1.4, part: 'head', weak: 1.5 }];
    this.armor = 45;
    // flatten the chain: every segment lives in world space and follows the head's path
    const n = this.rig.nodes;
    for (let i = 1; n['seg' + i]; i++) {
      const s = n['seg' + i];
      this.ctx.scene.attach(s);
      this.segs.push(s);
    }
    this.spacing = (this.rig.geo.spec.meta?.segLength as number) ?? 1.4;
    this.flying = true;
    this.bounty = 260 * tier;
  }

  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (this.under) return null;
    return super.hitTest(o, d, maxT);
  }

  protected async fight() {
    this.root.visible = true;
    while (true) {
      this.check();
      const r = rnd.next();
      if (r < 0.55) await this.breach();
      else if (r < 0.8) await this.spitSand();
      else await this.gulp();
      await this.wait(0.4);
    }
  }

  async intro() {
    this.under = false;
    this.pos.y = this.ctx.world.groundAt(this.pos.x, this.pos.z) + 4;
    await super.intro();
  }

  /** tunnel to a spot near the player, then leap out in an arc over it */
  private async breach() {
    const ctx = this.ctx;
    this.under = true;
    const pp = this.playerPos();
    const a = rnd.next() * Math.PI * 2;
    const start = new THREE.Vector3(pp.x + Math.cos(a) * 10, 0, pp.z + Math.sin(a) * 10);
    const end = new THREE.Vector3(pp.x - Math.cos(a) * 10, 0, pp.z - Math.sin(a) * 10);
    // underground approach (dust ripple)
    for (let i = 0; i < 18; i++) {
      this.pos.lerp(start, 0.15);
      this.pos.y = ctx.world.groundAt(this.pos.x, this.pos.z) - 3;
      ctx.fx.dust({ x: this.pos.x, y: this.pos.y + 3.2, z: this.pos.z }, 1.4, 0xe6cf9f, 3);
      await this.wait(0.05);
    }
    ctx.fx.ring({ x: pp.x, y: ctx.world.groundAt(pp.x, pp.z) + 0.2, z: pp.z }, 0xff6a3a, 6, 0.6);
    ctx.sfx('quake_rumble', this.pos, 1);
    await this.wait(0.45);
    // arc
    const T = 1.6 - this.phase * 0.2;
    const H = 7 + this.phase;
    const t0 = this.t;
    this.under = false;
    ctx.sfx('boss_roar', this.pos, 1, 0.7);
    let hit = false;
    while (this.t - t0 < T) {
      const k = (this.t - t0) / T;
      this.pos.set(start.x + (end.x - start.x) * k, 0, start.z + (end.z - start.z) * k);
      this.pos.y = ctx.world.groundAt(this.pos.x, this.pos.z) + Math.sin(k * Math.PI) * H - 1.5;
      this.yaw = Math.atan2(end.x - start.x, end.z - start.z);
      if (k < 0.1 || k > 0.9) ctx.fx.sandBurst({ x: this.pos.x, y: ctx.world.groundAt(this.pos.x, this.pos.z), z: this.pos.z }, 1.5);
      if (!hit && this.pos.distanceTo(this.player.center(_v)) < 2.6) {
        hit = true;
        this.player.takeHit({ base: 30 + this.phase * 6, kind: 'phys', source: 'contact', knock: 16 }, this.pos.clone());
      }
      await this.wait(0.02);
    }
    this.under = true;
    ctx.shake(0.4);
  }

  private async spitSand() {
    const ctx = this.ctx;
    this.under = false;
    const pp = this.playerPos();
    const a = Math.atan2(this.pos.x - pp.x, this.pos.z - pp.z);
    this.pos.set(pp.x + Math.sin(a) * 14, 0, pp.z + Math.cos(a) * 14);
    const g = ctx.world.groundAt(this.pos.x, this.pos.z);
    for (let i = 0; i < 12; i++) {
      this.pos.y = g - 4 + (i / 11) * 6;
      ctx.fx.sandBurst({ x: this.pos.x, y: g, z: this.pos.z }, 1.2);
      await this.wait(0.04);
    }
    this.faceTarget(pp);
    this.setExpr('angry');
    for (let k = 0; k < 3 + this.phase; k++) {
      this.fire(k % 2 ? 'fan' : 'lob', { count: k % 2 ? 9 : 4, spread: 1.2, speed: 15, dmg: 12, proj: 'sand' }, nodeWorld(this, 'head'));
      ctx.sfx('sand_spray', this.pos, 0.9);
      await this.wait(0.5);
    }
    for (let i = 0; i < 12; i++) {
      this.pos.y = g + 2 - (i / 11) * 6;
      await this.wait(0.04);
    }
    this.under = true;
  }

  /** erupts under the player: mash to climb out, or get chewed */
  private async gulp() {
    const ctx = this.ctx;
    const pp = this.playerPos().clone();
    const g = ctx.world.groundAt(pp.x, pp.z);
    ctx.fx.ring({ x: pp.x, y: g + 0.2, z: pp.z }, 0xff6a3a, 5, 1);
    ctx.sfx('quake_rumble', pp, 1);
    await this.wait(1.0);
    this.pos.set(pp.x, g - 2, pp.z);
    this.under = false;
    if (this.player.pos.distanceTo(pp) < 3.2) {
      ctx.events.emit('cutin', 'SWALLOWED!', '#ff6a3a', 'surprised');
      this.player.invuln = Math.max(this.player.invuln, 3);
      const r = await this.qte({ kind: 'mash', key: 'KeyE', label: 'CLAW YOUR WAY OUT', duration: 2.2, target: 14 + this.phase * 3 });
      if (r === 'fail') this.player.takeHit({ base: 45, kind: 'phys', source: 'contact', knock: 20 }, this.pos.clone());
      else {
        this.invulnerable = false;
        this.takeDamage({ base: this.maxHp * (r === 'perfect' ? 0.12 : 0.06), kind: 'phys', source: 'gun', canCrit: false });
        ctx.toast(r === 'perfect' ? 'GUT SHOT!' : 'SPAT OUT', '#ffd36b');
      }
      this.player.board.impulse.y += 16;
    }
    for (let i = 0; i < 16; i++) {
      this.pos.y = g - 2 + Math.sin((i / 15) * Math.PI) * 7;
      await this.wait(0.03);
    }
    this.under = true;
  }

  update(dt: number) {
    super.update(dt);
    // record the head path & place segments along it
    const head = this.pos.clone();
    const last = this.trail[0];
    if (!last || last.distanceTo(head) > 0.25) this.trail.unshift(head);
    if (this.trail.length > 400) this.trail.pop();
    let acc = 0, ti = 0;
    const sc = this.scale;
    for (let i = 0; i < this.segs.length; i++) {
      const want = (i + 1) * this.spacing * sc;
      while (ti < this.trail.length - 1 && acc + this.trail[ti].distanceTo(this.trail[ti + 1]) < want) {
        acc += this.trail[ti].distanceTo(this.trail[ti + 1]);
        ti++;
      }
      const p = this.trail[Math.min(ti, this.trail.length - 1)];
      const q = this.trail[Math.max(0, ti - 1)];
      const s = this.segs[i];
      s.position.copy(p);
      if (q && q.distanceToSquared(p) > 1e-4) s.lookAt(q);
      s.scale.setScalar(sc);
      s.visible = this.root.visible && this.alive;
    }
    this.root.visible = this.alive;
  }

  dispose() {
    super.dispose();
    for (const s of this.segs) s.removeFromParent();
  }

  protected animate(dt: number) {
    const n = this.rig.nodes;
    if (n['jaw']) n['jaw'].rotation.x = damp(n['jaw'].rotation.x, 0.3 + Math.max(0, Math.sin(this.t * 4)) * 0.4, 10, dt);
    void P;
  }
}
