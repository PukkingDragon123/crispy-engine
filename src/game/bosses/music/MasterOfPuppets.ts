// MASTER OF PUPPETS: the Hanged Man of Set's cult (a Metallica nod in the Egyptian
// tarot). A marionette god hung from a floating golden tau cross, who works other
// puppets with the control crosses in his fists and calls lightning down his strings.
//
// Entrance: the storm darkens and bolts hammer the sand; the tau descends out of
// the clouds on strings of light with him hanging limp beneath it; the strings go
// taut and he jerks to life limb by limb, head last, eyes igniting.
// Moves (song titles; the band rides the toast):
//   Master of Puppets        (Metallica) strings shoot to the nearest foes (or drag new
//                            ones out of the sand): they move faster, hit harder and
//                            fire in unison when he yanks. Kill a puppet and the snapped
//                            string lashes back: he takes a share of its life and reels.
//   Trapped Under Ice        (Metallica) a hook flies down a marked lane; caught, your
//                            camera and aim are dragged to him and the board is reeled in,
//                            then lightning runs down the string. Shoot his hands, or wait:
//   I Want to Break Free     (Queen) the hook snaps.
//   Ride the Lightning       (Metallica) marked sky strikes chase you; from phase 2 he
//                            becomes the bolt, riding a marked lane to a new spot.
//   Run Like Hell            (Pink Floyd) far away, a strike line runs you down.
//   For Whom the Bell Tolls  (Metallica) the tau's bell tolls; each toll rolls a sand
//                            shockwave out from him: jump it.
//   Creeping Death           (Metallica, the plagues of Egypt) a locust wall closes on
//                            you from every side but one gap.
//   Enter Sandman            (Metallica) slow homing sleep-sand that drags you down.
//   Disposable Heroes        (Metallica) he flings his puppets onto marked rings: they burst.
//   High Voltage             (AC/DC, phase 3) electrified strings sweep round him at
//                            ground level: jump them near the tips, duck them near him.
//   The Show Must Go On      (Queen) phase 2: fresh puppets on fresh strings.
//   Fade to Black            (Metallica) phase 3: the world flashes black and he turns
//                            over to hang head-down by one foot, the true Hanged Man.
// Death (Comfortably Numb, Pink Floyd): his puppets drop, then his own strings snap one
// by one (each limb goes limp), he falls, the tau plants itself in the sand like a grave
// marker, the bell tolls once more and he dissolves into sand.
import * as THREE from 'three';
import { Boss, BossDeps, Cancelled } from '../Boss';
import type { Enemy } from '../../enemies/Enemies';
import { Strands, song, stinger, socketAt } from './MusicFx';
import { clamp, damp, rnd } from '../../../engine/math/rand';

const BLUE = 0x7ab8ff, VIOLET = 0xa890ff, GOLDS = 0xe8d8a8;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const TIPS = ['tip_a_l', 'tip_b_l', 'tip_c_l', 'tip_d_l', 'tip_a_r', 'tip_b_r', 'tip_c_r', 'tip_d_r'];

interface Puppet {
  e: Enemy;
  tip: string;
  t: number;
  spd: number;
  dmg: number;
  thrown: boolean;
}
interface Wave {
  x: number;
  z: number;
  r: number;
  speed: number;
  hit: boolean;
  dmg: number;
}
/** a spring that kicks and settles (limb secondary motion) */
class Sp {
  x = 0;
  v = 0;
  constructor(public k = 60, public c = 9) {}
  step(target: number, dt: number) {
    this.v += ((target - this.x) * this.k - this.v * this.c) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

export class MasterOfPuppets extends Boss {
  barTheme = 'puppet';
  private fx: Strands;
  private tier: number;
  private puppets: Puppet[] = [];
  private queue: string[] = [];
  private lastAttack = '';
  private float = 1.4;
  private hang = 0;
  private hangT = 0;
  /** limbs whose strings are cut (death) or not yet taut (intro): 1 = limp */
  private limp: Record<string, number> = { arm_l: 0, arm_r: 0, leg_l: 0, leg_r: 0, head: 0 };
  private lift = 0.6; // arms raised (0 hanging .. 1 forward .. 2 overhead)
  private spread = 0;
  private liftS = 0;
  private spreadS = 0;
  private pull = new Sp(140, 11);
  private sway = { x: new Sp(10, 3), z: new Sp(10, 3) };
  private dangle = { l: new Sp(30, 4), r: new Sp(30, 4) };
  private headTilt = { x: new Sp(160, 14), z: new Sp(160, 14) };
  private headGoal = { x: 0, z: 0, t: 0 };
  private bellSwing = new Sp(40, 2.2);
  private glowUp = 1;
  private hook: { t: number; dur: number; tip: string; zapped: boolean } | null = null;
  private hookFly: { from: THREE.Vector3; dir: THREE.Vector3; len: number; t: number; tip: string } | null = null;
  private waves: Wave[] = [];
  private swarm: { x: number; z: number; r: number; gap: number; t: number; dur: number; tick: number } | null = null;
  private sweep: { a: number; w: number; t: number; dur: number; n: number; len: number; armed: boolean } | null = null;
  private ownCut: Record<string, boolean> = {};
  private stun = 0;
  private tauDrop = 0;
  private skyStrings = 0;
  private dying = false;

  constructor(d: BossDeps, tier = 1) {
    super(d, 'master_puppets', { name: 'Master of Puppets', title: 'The Hanged Man, Strings of Set', hp: 3200 * tier, scale: 1, eyes: ['glow', 0x8fd4ff] });
    this.tier = tier;
    this.flying = true;
    this.phases = [0.66, 0.33];
    this.armor = 25;
    this.magicRes = 0.25;
    this.bounty = 380 * tier;
    this.gold = 140 * tier;
    this.statusRes = { poison: 0.5, bleed: 1, stun: 0.6 };
    this.hitSpheres = [
      { node: 'head', offset: [0, 0.35, 0.15], r: 0.5, part: 'head', weak: 2 },
      { node: 'torso', offset: [0, 0.42, 0], r: 0.62, part: 'torso' },
      { node: 'pelvis', offset: [0, -0.1, 0], r: 0.55, part: 'pelvis' },
      { node: 'thigh_l', offset: [0, -0.45, 0], r: 0.28, part: 'thigh_l' },
      { node: 'thigh_r', offset: [0, -0.45, 0], r: 0.28, part: 'thigh_r' },
      { node: 'hand_l', offset: [0, -0.15, 0.05], r: 0.36, part: 'hand_l', weak: 1.5 },
      { node: 'hand_r', offset: [0, -0.15, 0.05], r: 0.36, part: 'hand_r', weak: 1.5 },
    ];
    this.fx = new Strands(d.ctx.scene);
  }

  private get dmgK() {
    return 0.85 + this.tier * 0.15;
  }
  private ground(x = this.pos.x, z = this.pos.z) {
    return this.ctx.world.groundAt(x, z);
  }
  private fork(p: Promise<unknown>) {
    p.catch((e) => {
      if (!(e instanceof Cancelled)) console.error(e);
    });
  }
  private call(title: string, band: string) {
    song(this, title, band, '#9fd0ff');
    this.anim.jaw = 0.45;
    this.ctx.engine.tweens.after(0.35, () => (this.anim.jaw = 0));
  }

  // ------------------------------------------------------------------ the entrance
  async intro() {
    const ctx = this.ctx, cam = this.d.cam, eng = ctx.engine;
    stinger('bossIntro');
    eng.letterbox(true, 0.5);
    this.invulnerable = true;
    const bx = this.pos.x, bz = this.pos.z, g = this.ground();
    for (const k of Object.keys(this.limp)) this.limp[k] = 1;
    this.lift = 0;
    this.float = 34;
    this.skyStrings = 1;
    this.glowUp = 0;
    this.setExpr('defeated');
    const pp = this.playerPos();
    const dx = bx - pp.x, dz = bz - pp.z, dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl, uz = dz / dl;
    // 1) the storm gathers: bolts hammer the sand where he will hang
    const wide = new THREE.Vector3(pp.x - ux * 6 + uz * 3, 0, pp.z - uz * 6 - ux * 3);
    wide.y = this.ground(wide.x, wide.z) + 1.6;
    cam.setCine({ pos: wide, look: new THREE.Vector3(bx, g + 9, bz), fov: 56 });
    ctx.sfx('thunder', { x: bx, y: g + 20, z: bz }, 1, 0.8);
    for (let i = 0; i < 4; i++) {
      const a = rnd.next() * Math.PI * 2, r = 2 + rnd.next() * 7;
      const x = bx + Math.cos(a) * r, z = bz + Math.sin(a) * r;
      this.fx.bolt({ x, y: g + 40, z }, { x, y: this.ground(x, z), z }, { width: 0.5, life: 0.5, color: BLUE });
      ctx.fx.light({ x, y: g + 3, z }, BLUE, 6, 0.3, 26);
      ctx.fx.sandBurst({ x, y: this.ground(x, z), z }, 1.2);
      eng.flash(0xdfe8ff, 0.25, 0.18);
      ctx.shake(0.3);
      await this.waitRaw(0.32);
    }
    // 2) the tau comes down out of the clouds on strings of light, him limp beneath it
    const low = new THREE.Vector3(bx + uz * 5 - ux * 7, 0, bz - ux * 5 - uz * 7);
    low.y = this.ground(low.x, low.z) + 0.8;
    const look = new THREE.Vector3(bx, g + 10, bz);
    cam.setCine({ pos: low, look, fov: 50 });
    ctx.sfx('rope_reel', this.pos, 0.9, 0.6);
    const T = 2.6;
    for (let t = 0; t < T; t += 0.05) {
      const k = t / T, e = 1 - (1 - k) ** 3;
      this.float = 34 + (1.4 - 34) * e;
      look.y = g + 10 - e * 5.5;
      await this.waitRaw(0.05);
    }
    this.float = 1.4;
    this.bellSwing.v += 3;
    ctx.sfx('divine_chime', this.pos, 0.8, 0.55);
    // 3) the strings go taut: he jerks to life limb by limb, the head last, the eyes ignite
    this.root.updateMatrixWorld(true);
    const head = socketAt(this, 'head', new THREE.Vector3());
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    cam.setCine({ pos: new THREE.Vector3(head.x + fx * 4.2 + fz * 2.2, head.y - 0.6, head.z + fz * 4.2 - fx * 2.2), look: head.clone().add(new THREE.Vector3(0, -0.6, 0)), fov: 40 });
    for (const k of ['arm_r', 'arm_l', 'leg_l', 'leg_r']) {
      this.limp[k] = 0;
      this.pull.v += 6;
      ctx.sfx('counter_clang', this.pos, 0.35, 1.6 + rnd.next() * 0.3);
      ctx.shake(0.12);
      await this.waitRaw(0.32);
    }
    this.lift = 0.7;
    this.limp.head = 0;
    this.headTilt.x.v -= 14;
    this.skyStrings = 0;
    this.setExpr('smug');
    for (let t = 0; t < 0.5; t += 0.05) {
      this.glowUp = t / 0.5;
      await this.waitRaw(0.05);
    }
    this.glowUp = 1;
    ctx.sfx('boss_laugh', this.pos, 0.9, 0.8);
    this.taunt('Obey your master. Every hunter dances on my strings.', '#9fd0ff');
    this.call('Master of Puppets', 'Metallica');
    ctx.events.emit('bossIntro', this);
    await this.waitRaw(2.0);
    cam.setCine(null);
    eng.letterbox(false, 0.5);
    this.invulnerable = false;
    this.setExpr('angry');
  }

  // ------------------------------------------------------------------ the fight
  protected async fight() {
    await this.masterOfPuppets();
    while (true) {
      this.check();
      const q = this.queue.shift();
      if (q) {
        await this.run(q);
        continue;
      }
      if (this.stun > 0) {
        await this.wait(0.2);
        continue;
      }
      const p = this.phase, r = rnd.next(), d = this.distToPlayer();
      const strung = this.puppets.length;
      let pick: string;
      if (d > 42) pick = 'runLikeHell';
      else if (p === 0) pick = r < 0.22 && strung < 2 ? 'puppets' : r < 0.4 ? 'lightning' : r < 0.56 ? 'bell' : r < 0.72 ? 'hook' : r < 0.86 ? 'sandman' : 'drift';
      else if (p === 1) pick = r < 0.16 && strung < 3 ? 'puppets' : r < 0.32 ? 'lightning' : r < 0.44 ? 'bell' : r < 0.56 ? 'hook' : r < 0.68 ? 'creeping' : r < 0.78 && strung >= 2 ? 'heroes' : r < 0.9 ? 'sandman' : 'drift';
      else pick = r < 0.14 && strung < 3 ? 'puppets' : r < 0.3 ? 'voltage' : r < 0.44 ? 'lightning' : r < 0.55 ? 'hook' : r < 0.66 ? 'creeping' : r < 0.76 ? 'bell' : r < 0.86 && strung >= 2 ? 'heroes' : 'sandman';
      if (pick === this.lastAttack && pick !== 'drift') pick = pick === 'lightning' ? 'bell' : 'lightning';
      await this.run(pick);
      // he repositions between moves, keeping a fair distance
      if (rnd.chance(0.5)) await this.drift();
      await this.wait(p >= 2 ? 0.55 : 0.85);
    }
  }
  private async run(name: string) {
    this.lastAttack = name;
    switch (name) {
      case 'puppets':
        return this.masterOfPuppets();
      case 'hook':
        return this.trappedUnderIce();
      case 'lightning':
        return this.rideTheLightning();
      case 'runLikeHell':
        return this.runLikeHell();
      case 'bell':
        return this.forWhomTheBellTolls();
      case 'creeping':
        return this.creepingDeath();
      case 'sandman':
        return this.enterSandman();
      case 'heroes':
        return this.disposableHeroes();
      case 'voltage':
        return this.highVoltage();
      default:
        return this.drift();
    }
  }
  /** dev/test: queue a move (puppets, hook, lightning, runLikeHell, bell, creeping, sandman, heroes, voltage, drift) */
  debug(name: string) {
    this.queue.unshift(name);
  }

  private async drift() {
    const pp = this.playerPos();
    const a = Math.atan2(this.pos.z - pp.z, this.pos.x - pp.x) + rnd.range(-0.9, 0.9);
    const R = 15 + rnd.next() * 6;
    await this.moveTo(pp.x + Math.cos(a) * R, pp.z + Math.sin(a) * R, 7, 2.2);
  }

  // ------------------------------------------------------------------ Master of Puppets
  private async masterOfPuppets() {
    const ctx = this.ctx;
    this.call('Master of Puppets', 'Metallica');
    this.spread = 1;
    this.pull.v += 8;
    const want = 2 + this.phase + (this.tier > 1 ? 1 : 0);
    const taken = new Set(this.puppets.map((p) => p.e));
    const cands = this.d.enemies.list.filter((e) => e.alive && !taken.has(e) && e.state !== 'hidden' && e.state !== 'burrow' && !e.def.special?.startsWith('rolling') && Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < 38);
    cands.sort((p, q) => Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - Math.hypot(q.pos.x - this.pos.x, q.pos.z - this.pos.z));
    const got: Enemy[] = cands.slice(0, Math.max(0, want - this.puppets.length));
    // not enough? he drags puppets up out of the sand around the hunter
    const pp = this.playerPos();
    for (let i = got.length; i < Math.min(want - this.puppets.length, 4); i++) {
      const a = rnd.next() * Math.PI * 2, r = 9 + rnd.next() * 5;
      const x = pp.x + Math.cos(a) * r, z = pp.z + Math.sin(a) * r;
      if (ctx.world.storm.sdf(x, z) < 4) continue;
      const e = this.d.enemies.spawn(rnd.chance(0.55) ? 'gunslinger' : 'husk', x, z, { emerge: 'sand' });
      if (e) got.push(e);
    }
    for (const e of got) {
      const tip = TIPS[(this.puppets.length * 3 + 1) % TIPS.length];
      this.puppets.push({ e, tip, t: 0, spd: e.spdMul, dmg: e.dmgMul, thrown: false });
      e.spdMul *= 1.3;
      e.dmgMul *= 1.3;
      ctx.sfx('rope_reel', e.pos, 0.6, 1.4);
      await this.waitRaw(0.18);
    }
    await this.wait(0.5);
    this.spread = 0;
  }
  /** the puppets fire together when he yanks */
  private yank() {
    this.pull.v += 10;
    for (const p of this.puppets) for (let k = 0; k < p.e.cds.length; k++) p.e.cds[k] = Math.min(p.e.cds[k], 0.05 + k * 0.4);
    this.ctx.sfx('rope_reel', this.pos, 0.4, 1.8);
  }
  private updatePuppets(dt: number) {
    for (let i = this.puppets.length - 1; i >= 0; i--) {
      const p = this.puppets[i];
      p.t += dt;
      const gone = !p.e.alive || p.t > 22;
      if (gone) {
        this.puppets.splice(i, 1);
        p.e.spdMul = p.spd;
        p.e.dmgMul = p.dmg;
        if (!p.e.alive && !p.thrown && this.alive) this.backlash(p);
        continue;
      }
      if (this.alive && Math.floor(p.t / 1.9) !== Math.floor((p.t - dt) / 1.9)) this.yank();
      // the string: control-cross tip to the puppet's crown, buzzing when he yanks
      const from = socketAt(this, p.tip, _a);
      const to = _b.set(p.e.pos.x, p.e.pos.y + p.e.height * p.e.scale + 0.1, p.e.pos.z);
      this.fx.line({ x: from.x, y: from.y, z: from.z }, { x: to.x, y: to.y, z: to.z }, { sag: 0.5, width: 0.035, color: VIOLET, alpha: 0.75, buzz: Math.abs(this.pull.v) > 2 ? 1 : 0.2 });
    }
  }
  /** a puppet died on its string: the snapped string lashes him */
  private backlash(p: Puppet) {
    const ctx = this.ctx;
    const from = socketAt(this, p.tip, _a);
    this.fx.bolt({ x: from.x, y: from.y, z: from.z }, { x: p.e.pos.x, y: p.e.pos.y + 1, z: p.e.pos.z }, { width: 0.25, life: 0.3, color: VIOLET, branches: 1 });
    const amt = Math.round(this.maxHp * 0.035);
    this.hp = Math.max(1, this.hp - amt);
    this.flash = 1;
    this.hitT = 0;
    this.squash.kick(-3);
    ctx.fx.number({ x: from.x, y: from.y + 0.4, z: from.z }, amt, 0xc8a8ff, 1.3);
    ctx.sfx('counter_clang', from, 0.7, 0.7);
    ctx.toast('STRING CUT', '#c8a8ff', 'He reels');
    this.stun = 1.4;
    this.setExpr('hurt');
    this.headTilt.x.v += 12;
    while (this.phase < this.phases.length && this.frac <= this.phases[this.phase]) {
      this.phase++;
      this.onPhase(this.phase);
    }
  }

  // ------------------------------------------------------------------ Trapped Under Ice / I Want to Break Free
  private async trappedUnderIce() {
    const ctx = this.ctx;
    this.call('Trapped Under Ice', 'Metallica');
    const tip = rnd.chance(0.5) ? 'tip_d_l' : 'tip_d_r';
    this.lift = 1.1;
    const pp = this.playerPos();
    const from = socketAt(this, tip, new THREE.Vector3());
    const pv = this.player.board.vel;
    const aim = new THREE.Vector3(pp.x + pv.x * 0.35, 0, pp.z + pv.z * 0.35);
    const dir = new THREE.Vector3(aim.x - from.x, 0, aim.z - from.z);
    const len = dir.length() + 8;
    dir.normalize();
    this.d.enemies.warn.lane(this.pos.x, this.pos.z, dir.x, dir.z, len, 1.8, 1.0, 'grab');
    this.pull.v -= 6;
    await this.waitRaw(1.0);
    ctx.sfx('grapple_fire', from, 0.9, 0.8);
    this.pull.v += 12;
    this.hookFly = { from: from.clone(), dir, len, t: 0, tip };
    while (this.hookFly) await this.waitRaw(0.05);
    // hooked: hold on until the hook breaks or lightning runs down it
    while (this.hook) await this.waitRaw(0.1);
    this.lift = 0.7;
  }
  private updateHook(dt: number) {
    const ctx = this.ctx;
    const hf = this.hookFly;
    if (hf) {
      hf.t += dt;
      const s = Math.min(hf.len, hf.t * 30);
      const head = _c.copy(hf.from).addScaledVector(hf.dir, s);
      head.y = this.ground(head.x, head.z) + 1.1;
      const from = socketAt(this, hf.tip, _a);
      this.fx.line({ x: from.x, y: from.y, z: from.z }, { x: head.x, y: head.y, z: head.z }, { sag: 0.2, width: 0.04, color: VIOLET, buzz: 0.6 });
      ctx.particles.emit({ pos: head, count: 1, spread: 0.3, life: [0.15, 0.3], size: [0.12, 0.02], sprite: 'spark', color: 0xc8b8ff, additive: true });
      const pp = this.player.pos;
      if (Math.hypot(pp.x - head.x, pp.z - head.z) < 1.25 && pp.y - this.ground(pp.x, pp.z) < 2.2 && this.player.alive) {
        this.hookFly = null;
        this.hook = { t: 0, dur: 2.2 + this.tier * 0.2, tip: hf.tip, zapped: false };
        ctx.sfx('grapple_hit', pp, 0.9);
        ctx.shake(0.3);
        this.player.takeHit({ base: 6 * this.dmgK, kind: 'phys', source: 'projectile', knock: 0 }, this.pos);
      } else if (s >= hf.len) this.hookFly = null;
    }
    const h = this.hook;
    if (!h) return;
    h.t += dt;
    const pp = this.player.pos;
    const from = socketAt(this, h.tip, _a);
    this.fx.line({ x: from.x, y: from.y, z: from.z }, { x: pp.x, y: pp.y + 1.1, z: pp.z }, { sag: 0.15, width: 0.045, color: h.zapped ? BLUE : VIOLET, buzz: 1 });
    // the strings work you: the view and the aim are dragged toward him, the board is reeled in
    const cam = this.d.cam;
    const want = Math.atan2(this.pos.x - pp.x, this.pos.z - pp.z);
    let dy = want - cam.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    cam.nudge(dy * Math.min(1, dt * 3.2), Math.sin(h.t * 9) * 0.012);
    const dx = this.pos.x - pp.x, dz = this.pos.z - pp.z, dl = Math.hypot(dx, dz) || 1;
    if (dl > 6) this.player.board.vel.addScaledVector(_b.set(dx / dl, 0, dz / dl), dt * 14);
    // lightning runs down the string
    if (!h.zapped && h.t > 1.3) {
      h.zapped = true;
      this.fx.bolt({ x: from.x, y: from.y, z: from.z }, { x: pp.x, y: pp.y + 1.1, z: pp.z }, { width: 0.35, life: 0.5, color: BLUE, jag: 0.05 });
      ctx.sfx('thunder', pp, 0.7, 1.3);
      ctx.fx.light({ x: pp.x, y: pp.y + 1.5, z: pp.z }, BLUE, 4, 0.3, 14);
      this.player.takeHit({ base: 16 * this.dmgK, kind: 'magic', source: 'projectile', knock: 3, status: [{ id: 'stun', stacks: 1, dur: 0.4 }] }, this.pos);
    }
    if (h.t >= h.dur || !this.player.alive || !this.alive) this.breakFree(false);
  }
  private breakFree(shot: boolean) {
    if (!this.hook) return;
    const pp = this.player.pos;
    this.hook = null;
    this.ctx.sfx('counter_clang', pp, 0.7, 1.4);
    this.ctx.particles.emit({ pos: { x: pp.x, y: pp.y + 1.2, z: pp.z }, count: 14, spread: 3, life: [0.2, 0.5], size: [0.1, 0.02], sprite: 'spark', color: 0xc8b8ff, additive: true });
    if (this.alive) song(this, 'I Want to Break Free', 'Queen', '#c8a8ff', shot);
  }

  // ------------------------------------------------------------------ Ride the Lightning / Run Like Hell
  private async skyStrike(x: number, z: number, r: number, warn: number) {
    const ctx = this.ctx;
    this.d.enemies.warn.circle(x, z, r, warn, 'heavy');
    await this.waitRaw(warn);
    const g = this.ground(x, z);
    this.fx.bolt({ x: x + rnd.range(-3, 3), y: g + 36, z: z + rnd.range(-3, 3) }, { x, y: g, z }, { width: 0.55, life: 0.45, color: BLUE });
    ctx.fx.light({ x, y: g + 2.5, z }, BLUE, 7, 0.3, 20);
    ctx.fx.sandBurst({ x, y: g, z }, 1.1);
    ctx.fx.dust({ x, y: g + 0.2, z }, r * 0.5, 0xd9c19a, 4);
    ctx.particles.emit({ pos: { x, y: g + 0.3, z }, count: 10, spread: 5, up: 3, life: [0.2, 0.5], size: [0.1, 0.02], sprite: 'spark', color: 0xd8e8ff, additive: true });
    ctx.sfx('thunder', { x, y: g + 6, z }, 0.65, 1.1 + rnd.next() * 0.2);
    ctx.shake(0.18);
    ctx.world.deform(x, z, r * 0.35, 0.3);
    const pp = this.player.pos;
    if (Math.hypot(pp.x - x, pp.z - z) < r && pp.y < g + 3) this.player.takeHit({ base: 18 * this.dmgK, kind: 'magic', source: 'contact', knock: 7 }, new THREE.Vector3(x, g, z));
  }
  private async rideTheLightning() {
    this.call('Ride the Lightning', 'Metallica');
    this.lift = 2;
    this.pull.v -= 6;
    await this.waitRaw(0.35);
    const n = 4 + this.phase * 2;
    for (let i = 0; i < n; i++) {
      const pp = this.playerPos(), pv = this.player.board.vel;
      const lead = 0.55 + rnd.next() * 0.25;
      this.fork(this.skyStrike(pp.x + pv.x * lead + rnd.range(-1, 1), pp.z + pv.z * lead + rnd.range(-1, 1), 2.6, 0.75));
      this.pull.v += 5;
      await this.waitRaw(0.42 - this.phase * 0.05);
    }
    this.lift = 0.7;
    if (this.phase >= 1) await this.boltRide();
    await this.waitRaw(0.6);
  }
  /** he becomes the bolt: a marked lane, then he is at its far end */
  private async boltRide() {
    const ctx = this.ctx;
    const pp = this.playerPos();
    const side = rnd.chance(0.5) ? 1 : -1;
    const a = Math.atan2(pp.z - this.pos.z, pp.x - this.pos.x) + side * 0.5;
    const L = Math.min(30, this.distToPlayer() + 10);
    const tx = this.pos.x + Math.cos(a) * L, tz = this.pos.z + Math.sin(a) * L;
    if (ctx.world.storm.sdf(tx, tz) < 6) return;
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    this.d.enemies.warn.lane(this.pos.x, this.pos.z, dx, dz, L, 2.4, 0.85, 'heavy');
    await this.waitRaw(0.85);
    const from = new THREE.Vector3(this.pos.x, this.pos.y + 2.4, this.pos.z);
    this.root.visible = false;
    this.invulnerable = true;
    const to = new THREE.Vector3(tx, this.ground(tx, tz) + this.float + 2.4, tz);
    for (let k = 0; k < 3; k++) this.fx.bolt(from, to, { width: 0.6, life: 0.4, color: BLUE, jag: 0.06, branches: 1 });
    ctx.sfx('thunder', from, 0.9, 1.25);
    ctx.engine.flash(0xdfe8ff, 0.3, 0.15);
    // the lane burns
    const pl = this.player.pos;
    const t = clamp(((pl.x - this.pos.x) * dx + (pl.z - this.pos.z) * dz) / (L * L), 0, 1);
    const qx = this.pos.x + dx * t, qz = this.pos.z + dz * t;
    if (Math.hypot(pl.x - qx, pl.z - qz) < 1.5 && pl.y < this.ground(qx, qz) + 3) this.player.takeHit({ base: 22 * this.dmgK, kind: 'magic', source: 'contact', knock: 9 }, new THREE.Vector3(qx, pl.y, qz));
    this.pos.x = tx;
    this.pos.z = tz;
    this.vel.set(0, 0, 0);
    await this.waitRaw(0.25);
    this.root.visible = true;
    this.invulnerable = false;
    this.pull.v += 10;
    ctx.fx.sandBurst({ x: tx, y: this.ground(tx, tz), z: tz }, 1.5);
  }
  private async runLikeHell() {
    this.call('Run Like Hell', 'Pink Floyd');
    this.lift = 2;
    for (let i = 0; i < 9; i++) {
      const pp = this.playerPos(), pv = this.player.board.vel;
      this.fork(this.skyStrike(pp.x + pv.x * 0.8, pp.z + pv.z * 0.8, 2.8, 0.7));
      await this.waitRaw(0.35);
    }
    this.lift = 0.7;
    await this.moveTo(this.playerPos().x, this.playerPos().z, 10, 2.5);
  }

  // ------------------------------------------------------------------ For Whom the Bell Tolls
  private async forWhomTheBellTolls() {
    const ctx = this.ctx;
    this.call('For Whom the Bell Tolls', 'Metallica');
    const n = 3 + (this.phase >= 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      this.d.enemies.warn.circle(this.pos.x, this.pos.z, 3.2, 0.6, 'tell');
      this.pull.v -= 4;
      await this.waitRaw(0.6);
      this.bellSwing.v += 9 * (i % 2 ? -1 : 1);
      ctx.sfx('divine_chime', this.pos, 1, 0.42);
      ctx.sfx('counter_clang', this.pos, 0.6, 0.45);
      ctx.shake(0.25);
      const g = this.ground();
      ctx.world.sand.ring(this.pos.x, this.pos.z, { speed: 13, height: 0.55, width: 1.4, life: 2.4 });
      ctx.fx.ring({ x: this.pos.x, y: g + 0.2, z: this.pos.z }, 0xd8c080, 5, 0.5);
      this.waves.push({ x: this.pos.x, z: this.pos.z, r: 0.5, speed: 13, hit: false, dmg: 15 * this.dmgK });
      await this.waitRaw(i === n - 1 ? 0.6 : 0.55);
    }
  }
  private updateWaves(dt: number) {
    const pp = this.player.pos;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.r += w.speed * dt;
      if (w.r > 32) {
        this.waves.splice(i, 1);
        continue;
      }
      if (w.hit) continue;
      const d = Math.hypot(pp.x - w.x, pp.z - w.z);
      const air = pp.y - this.ground(pp.x, pp.z);
      if (Math.abs(d - w.r) < 0.9 && air < 0.75 && this.player.alive) {
        w.hit = true;
        this.player.takeHit({ base: w.dmg, kind: 'phys', source: 'contact', knock: 8 }, new THREE.Vector3(w.x, pp.y, w.z));
      }
    }
  }

  // ------------------------------------------------------------------ Creeping Death
  private async creepingDeath() {
    this.call('Creeping Death', 'Metallica');
    this.spread = 1;
    this.ctx.sfx('swarm_loop', this.player.pos, 0.9, 0.8);
    const pp = this.playerPos();
    this.swarm = { x: pp.x, z: pp.z, r: 17, gap: rnd.next() * Math.PI * 2, t: 0, dur: 5.2 - this.phase * 0.4, tick: 0 };
    // the gap is shown first: a bright lane out through it
    this.d.enemies.warn.lane(pp.x, pp.z, Math.cos(this.swarm.gap), Math.sin(this.swarm.gap), 17, 3.4, 1.0, 'tell');
    while (this.swarm) await this.waitRaw(0.1);
    this.spread = 0;
  }
  private updateSwarm(dt: number) {
    const s = this.swarm;
    if (!s) return;
    const ctx = this.ctx;
    s.t += dt;
    const k = s.t / s.dur;
    s.r = 17 * (1 - k) + 0.5;
    s.gap += dt * 0.25;
    const half = 0.42;
    // the wall: dark locust specks and a low churning cloud, all round but the gap
    for (let i = 0; i < 9; i++) {
      let a = rnd.next() * Math.PI * 2;
      let da = a - s.gap;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) < half) a += half * 2 * Math.sign(da || 1);
      const x = s.x + Math.cos(a) * s.r, z = s.z + Math.sin(a) * s.r;
      const g = this.ground(x, z);
      ctx.particles.emit({ pos: { x, y: g + 0.4 + rnd.next() * 1.6, z }, count: 2, spread: 1.2, life: [0.4, 0.8], size: [0.07, 0.07], sprite: ['fly0', 'fly1'], color: 0x2a2018, drag: 1, jitter: 0.6 });
      if (i % 3 === 0) ctx.particles.emit({ pos: { x, y: g + 0.5, z }, count: 1, spread: 0.6, up: 0.6, life: [0.6, 1.0], size: [0.8, 1.6], sprite: ['puff0', 'cloud1'], color: 0x3a3026, alpha: 0.5, drag: 1.5 });
    }
    const pp = this.player.pos;
    const d = Math.hypot(pp.x - s.x, pp.z - s.z);
    let pa = Math.atan2(pp.z - s.z, pp.x - s.x) - s.gap;
    pa = Math.atan2(Math.sin(pa), Math.cos(pa));
    s.tick -= dt;
    if (Math.abs(d - s.r) < 1.3 && Math.abs(pa) > half && s.tick <= 0 && this.player.alive) {
      s.tick = 0.4;
      this.player.takeHit({ base: 7 * this.dmgK, kind: 'magic', source: 'contact', knock: 1.5, status: [{ id: 'slow', stacks: 2, dur: 1.5 }] }, new THREE.Vector3(s.x, pp.y, s.z));
    }
    if (k >= 1) this.swarm = null;
  }

  // ------------------------------------------------------------------ Enter Sandman
  private async enterSandman() {
    this.call('Enter Sandman', 'Metallica');
    this.lift = 1.2;
    const n = 4 + this.phase;
    for (let i = 0; i < n; i++) {
      const tip = TIPS[(i * 3) % TIPS.length];
      const from = socketAt(this, tip, new THREE.Vector3());
      const pp = this.player.center(new THREE.Vector3());
      const a = Math.atan2(pp.x - from.x, pp.z - from.z) + (i - (n - 1) / 2) * 0.35;
      this.d.enemies.proj.spawn({ kind: 'sand', x: from.x, y: from.y, z: from.z, vx: Math.sin(a) * 6.5, vy: 0.4, vz: Math.cos(a) * 6.5, dmg: 7 * this.dmgK, homing: 1.4, life: 4.5, sourceId: this.id, status: [{ id: 'slow', stacks: 2, dur: 2.5 }] });
      this.pull.v += 3;
      this.ctx.sfx('sand_spray', from, 0.5, 1.3);
      await this.waitRaw(0.16);
    }
    this.lift = 0.7;
    await this.waitRaw(0.6);
  }

  // ------------------------------------------------------------------ Disposable Heroes
  private async disposableHeroes() {
    const ctx = this.ctx;
    this.call('Disposable Heroes', 'Metallica');
    this.lift = 2;
    this.pull.v -= 14;
    await this.waitRaw(0.4);
    const pp = this.playerPos();
    const list = this.puppets.filter((p) => p.e.alive).slice(0, 4);
    const marks: { p: Puppet; x: number; z: number }[] = [];
    list.forEach((p, i) => {
      const a = (i / Math.max(1, list.length)) * Math.PI * 2 + rnd.next();
      const r = i === 0 ? 0.6 : 3.2;
      const x = pp.x + Math.cos(a) * r, z = pp.z + Math.sin(a) * r;
      p.thrown = true;
      const e = p.e;
      e.state = 'leap';
      e.stateT = 0;
      e.leapFrom.copy(e.pos);
      e.leapTo.set(x, this.ground(x, z), z);
      e.leapDur = 1.1;
      this.d.enemies.warn.circle(x, z, 3, 1.1, 'heavy');
      marks.push({ p, x, z });
    });
    this.pull.v += 16;
    ctx.sfx('rope_reel', this.pos, 0.9, 1.6);
    await this.waitRaw(1.1);
    for (const m of marks) {
      const g = this.ground(m.x, m.z);
      ctx.fx.explosion({ x: m.x, y: g + 0.6, z: m.z }, 2.6, 'curse');
      ctx.sfx('explosion', { x: m.x, y: g, z: m.z }, 0.8, 1.1);
      ctx.shake(0.3);
      const pl = this.player.pos;
      if (Math.hypot(pl.x - m.x, pl.z - m.z) < 3 && pl.y < g + 2.6) this.player.takeHit({ base: 20 * this.dmgK, kind: 'magic', source: 'contact', knock: 10 }, new THREE.Vector3(m.x, g, m.z));
      if (m.p.e.alive) this.d.enemies.damage(m.p.e, { base: 99999, kind: 'true', source: 'divine', canCrit: false });
    }
    this.lift = 0.7;
  }

  // ------------------------------------------------------------------ High Voltage
  private async highVoltage() {
    this.call('High Voltage', 'AC/DC');
    const n = 3;
    const a0 = rnd.next() * Math.PI * 2;
    const len = 17;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      this.d.enemies.warn.lane(this.pos.x, this.pos.z, Math.cos(a), Math.sin(a), len, 1.6, 1.1, 'heavy');
    }
    this.spread = 1.4;
    this.stop();
    this.sweep = { a: a0, w: (rnd.chance(0.5) ? 1 : -1) * (0.75 + this.tier * 0.08), t: 0, dur: 5.5, n, len, armed: false };
    this.ctx.sfx('divine_power', this.pos, 0.8, 1.4);
    while (this.sweep) await this.waitRaw(0.1);
    this.spread = 0;
  }
  private updateSweep(dt: number) {
    const s = this.sweep;
    if (!s) return;
    s.t += dt;
    s.armed = s.t > 1.1;
    if (s.armed) s.a += s.w * dt;
    const hand = socketAt(this, 'tip_a_l', _a);
    const pp = this.player.pos;
    for (let i = 0; i < s.n; i++) {
      const a = s.a + (i / s.n) * Math.PI * 2;
      const tx = this.pos.x + Math.cos(a) * s.len, tz = this.pos.z + Math.sin(a) * s.len;
      const ty = this.ground(tx, tz) + 0.15;
      this.fx.line({ x: hand.x, y: hand.y, z: hand.z }, { x: tx, y: ty, z: tz }, { sag: 0.6, width: s.armed ? 0.07 : 0.03, color: s.armed ? BLUE : VIOLET, alpha: s.armed ? 1 : 0.5, buzz: s.armed ? 1.2 : 0.2 });
      if (s.armed && rnd.chance(dt * 6)) {
        const k = rnd.next();
        this.fx.bolt({ x: hand.x + (tx - hand.x) * k, y: hand.y + (ty - hand.y) * k, z: hand.z + (tz - hand.z) * k }, { x: hand.x + (tx - hand.x) * (k + 0.12), y: hand.y + (ty - hand.y) * (k + 0.12) + rnd.range(-0.3, 0.3), z: hand.z + (tz - hand.z) * (k + 0.12) }, { width: 0.18, life: 0.2, color: BLUE, branches: 0 });
      }
      if (!s.armed || !this.player.alive) continue;
      // where along the string the hunter is, and how high the string is there
      const dx = tx - this.pos.x, dz = tz - this.pos.z;
      const t = clamp(((pp.x - this.pos.x) * dx + (pp.z - this.pos.z) * dz) / (s.len * s.len), 0, 1);
      const qx = this.pos.x + dx * t, qz = this.pos.z + dz * t;
      const h = hand.y + (ty - hand.y) * t - Math.sin(t * Math.PI) * 0.6;
      if (Math.hypot(pp.x - qx, pp.z - qz) < 0.8 && Math.abs(pp.y + 0.8 - h) < 0.9 && t > 0.12) {
        this.player.takeHit({ base: 16 * this.dmgK, kind: 'magic', source: 'contact', knock: 6, status: [{ id: 'stun', stacks: 1, dur: 0.3 }] }, new THREE.Vector3(qx, h, qz));
        this.ctx.sfx('thunder', pp, 0.5, 1.6);
      }
    }
    if (s.t >= s.dur) this.sweep = null;
  }

  // ------------------------------------------------------------------ phases
  protected onPhase(p: number) {
    super.onPhase(p);
    if (p === 1) {
      this.fork(
        (async () => {
          await this.waitRaw(0.4);
          song(this, 'The Show Must Go On', 'Queen', '#9fd0ff');
          await this.masterOfPuppets();
        })()
      );
    } else if (p === 2) {
      const eng = this.ctx.engine;
      song(this, 'Fade to Black', 'Metallica', '#9fd0ff');
      eng.flash(0x000000, 0.85, 0.9);
      this.ctx.sfx('thunder', this.pos, 1, 0.7);
      this.hangT = 0.001;
    }
  }

  // ------------------------------------------------------------------ damage routing: shooting a hand breaks the hook
  takeDamage(hit: Parameters<Boss['takeDamage']>[0], point?: THREE.Vector3, dir?: THREE.Vector3) {
    const amt = super.takeDamage(hit, point, dir);
    const part = hit.tags?.[0];
    if (this.hook && amt > 0 && (part === 'hand_l' || part === 'hand_r')) this.breakFree(true);
    return amt;
  }

  // ------------------------------------------------------------------ death
  die() {
    if (!this.alive) return;
    this.alive = false;
    this.dying = true;
    this.stop();
    const ctx = this.ctx;
    this.hook = null;
    this.hookFly = null;
    this.swarm = null;
    this.sweep = null;
    this.setExpr('defeated');
    ctx.engine.slowMo(0.2, 30);
    ctx.engine.tweens.after(0.9, () => ctx.engine.slowMo(1, 3), true);
    ctx.sfx('boss_death', this.pos, 1, 0.8);
    ctx.shake(0.7);
    ctx.events.emit('bossShatter', this);
    ctx.events.emit('bossKilled', this);
    void this.deathSequence().catch((e) => console.error(e));
  }
  private async deathSequence() {
    const ctx = this.ctx, eng = ctx.engine, cam = this.d.cam;
    const w = (s: number) => eng.tweens.wait(s);
    eng.letterbox(true, 0.4);
    this.root.updateMatrixWorld(true);
    const c = socketAt(this, 'torso', new THREE.Vector3());
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    cam.setCine({ pos: new THREE.Vector3(c.x + fx * 6.5 + fz * 3.5, Math.max(c.y - 0.4, this.ground() + 1.4), c.z + fz * 6.5 - fx * 3.5), look: c.clone(), fov: 44 });
    song(this, 'Comfortably Numb', 'Pink Floyd', '#9fd0ff');
    // his puppets drop first
    for (const p of [...this.puppets]) {
      p.thrown = true;
      if (p.e.alive) this.d.enemies.damage(p.e, { base: 99999, kind: 'true', source: 'divine', canCrit: false });
    }
    await w(0.6);
    // then his own strings snap, one limb at a time
    for (const [k, limb] of [['tau_w_r', 'arm_r'], ['tau_w_l', 'arm_l'], ['tau_k_r', 'leg_r'], ['tau_k_l', 'leg_l']] as [string, string][]) {
      this.ownCut[k] = true;
      this.limp[limb] = 1;
      const at = socketAt(this, k, _a);
      this.fx.bolt({ x: at.x, y: at.y, z: at.z }, { x: at.x + rnd.range(-0.6, 0.6), y: at.y - 1.6, z: at.z + rnd.range(-0.6, 0.6) }, { width: 0.2, life: 0.3, color: GOLDS, branches: 0 });
      ctx.sfx('counter_clang', at, 0.6, 1.8);
      this.pull.v -= 4;
      await w(0.42);
    }
    this.ownCut['tau_head'] = true;
    this.limp.head = 1;
    ctx.sfx('rope_reel', this.pos, 0.7, 0.5);
    // he falls
    let vy = 0;
    for (let t = 0; t < 2 && this.float > 0; t += 1 / 30) {
      vy += 22 / 30;
      this.float = Math.max(0, this.float - vy / 30);
      this.hang = Math.max(0, this.hang - 1 / 20);
      await w(1 / 30);
    }
    this.float = 0;
    ctx.fx.sandBurst({ x: this.pos.x, y: this.ground(), z: this.pos.z }, 1.6);
    ctx.fx.dust({ x: this.pos.x, y: this.ground() + 0.3, z: this.pos.z }, 2, 0xd9c19a, 8);
    ctx.sfx('board_land', this.pos, 1, 0.6);
    ctx.shake(0.5);
    this.squash.kick(-6);
    await w(0.5);
    // the tau falls and plants itself in the sand beside him; the bell tolls once more
    for (let t = 0; t < 0.8; t += 1 / 30) {
      this.tauDrop = Math.min(1, this.tauDrop + 1 / 24);
      await w(1 / 30);
    }
    this.tauDrop = 1;
    this.bellSwing.v += 8;
    ctx.sfx('divine_chime', this.pos, 1, 0.38);
    ctx.fx.sandBurst({ x: this.pos.x, y: this.ground(), z: this.pos.z }, 1);
    await w(0.8);
    // he dissolves into sand
    const fxv = this.rig.material.userData.fx.value;
    for (let t = 0; t < 1.6; t += 1 / 30) {
      fxv.y = t / 1.6;
      if (rnd.chance(0.6)) ctx.particles.emit({ pos: { x: this.pos.x + rnd.range(-1, 1), y: this.pos.y + rnd.next() * 3, z: this.pos.z + rnd.range(-1, 1) }, count: 3, spread: 0.6, up: 0.4, life: [0.8, 1.4], size: [0.08, 0.04], sprite: ['grain0', 'grain1'], color: [0xe0c08a, 0x2e221d, 0xd2a63c], gravity: 3, drag: 0.8 });
      await w(1 / 30);
    }
    this.root.visible = false;
    ctx.fx.coins({ x: this.pos.x, y: this.ground() + 1, z: this.pos.z }, 40);
    cam.setCine(null);
    eng.letterbox(false, 0.5);
    this.onDefeated?.(this, false);
    this.dispose();
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    // he hangs at a float height over the sand, higher when he turns over to hang head-down
    const g = this.ground();
    if (this.hangT > 0) {
      this.hangT += dt;
      this.hang = Math.min(1, this.hangT / 1.4);
    }
    const target = g + this.float + this.hang * 0.4 + Math.sin(this.t * 1.1) * 0.18;
    this.pos.y = this.dying ? g + this.float : damp(this.pos.y, target, this.float > 5 ? 30 : 4, dt);
    this.stun = Math.max(0, this.stun - dt);
    if (this.stun > 0) this.stop();
    super.update(dt);
    if (!this.root.visible && !this.alive) return;
    this.updatePuppets(dt);
    this.updateHook(dt);
    this.updateWaves(dt);
    this.updateSwarm(dt);
    this.updateSweep(dt);
    this.drawOwnStrings();
    this.fx.update(dt, this.ctx.camera);
    // the eyes ignite (intro) and flare on a yank
    const fxv = this.rig.material.userData.fx.value;
    fxv.z = this.glowUp * (0.6 + Math.min(1, Math.abs(this.pull.v) * 0.05)) * (this.dying ? 0.3 : 1);
  }
  private drawOwnStrings() {
    if (!this.root.visible) return;
    const pairs: [string, string][] = [['tau_head', 'str_head'], ['tau_w_l', 'str_w_l'], ['tau_w_r', 'str_w_r'], ['tau_k_l', 'str_k_l'], ['tau_k_r', 'str_k_r']];
    for (const [a, b] of pairs) {
      if (this.ownCut[a]) continue;
      // hanging head-down he is tied by one foot only
      if (this.hang > 0.5 && b !== 'str_k_l' && b !== 'str_head') continue;
      const p = socketAt(this, a, _a), q = socketAt(this, b, _b);
      this.fx.line({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z }, { sag: 0.05, width: 0.022, color: GOLDS, alpha: 0.8 });
    }
    // the intro: the tau comes down on strings out of the clouds
    if (this.skyStrings > 0) {
      for (const s of ['tau_w_l', 'tau_w_r']) {
        const p = socketAt(this, s, _a);
        this.fx.line({ x: p.x, y: p.y, z: p.z }, { x: p.x * 0.9 + this.pos.x * 0.1, y: p.y + 60, z: p.z }, { sag: 0, width: 0.05, color: BLUE, alpha: 0.8, buzz: 0.3 });
      }
    }
  }
  dispose() {
    for (const p of this.puppets) {
      p.e.spdMul = p.spd;
      p.e.dmgMul = p.dmg;
    }
    this.puppets = [];
    this.fx.dispose();
    super.dispose();
  }

  // ------------------------------------------------------------------ procedural animation: a marionette
  protected animate(dt: number) {
    const n = this.rig.nodes;
    const t = this.t;
    this.liftS = damp(this.liftS, this.lift, 6, dt);
    this.spreadS = damp(this.spreadS, this.spread, 6, dt);
    const fwd = this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw);
    const side = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
    // he swings under the tau like a pendulum: velocity pushes, the strings pull back
    const sx = this.sway.x.step(-fwd * 0.05, dt), sz = this.sway.z.step(side * 0.05, dt);
    const pull = this.pull.step(0, dt);
    // jerky puppet head: snaps to a new tilt every so often
    this.headGoal.t -= dt;
    if (this.headGoal.t <= 0) {
      this.headGoal.t = 0.9 + rnd.next() * 1.6;
      this.headGoal.x = rnd.range(-0.2, 0.25);
      this.headGoal.z = rnd.range(-0.3, 0.3);
    }
    const hx = this.headTilt.x.step(this.limp.head ? 0.9 : this.headGoal.x + (this.stun > 0 ? 0.5 : 0), dt);
    const hz = this.headTilt.z.step(this.limp.head ? 0.4 : this.headGoal.z, dt);
    if (n.pelvis) {
      const hangA = this.hang * Math.PI;
      n.pelvis.rotation.set(sx + Math.sin(t * 0.9) * 0.04, Math.sin(t * 0.6) * 0.08, sz + hangA + Math.sin(t * 0.7) * 0.03);
      // hung head-down, his crotch rises to where his head was (the foot is tied to the tau)
      const p0 = this.rig.geo.parts[this.rig.geo.index['pelvis']].offset;
      n.pelvis.position.set(p0.x, p0.y + this.hang * 0.6 + Math.sin(t * 2.2) * 0.03 * (1 - this.limp.head), p0.z);
    }
    if (n.torso) n.torso.rotation.set(0.06 + Math.sin(t * 1.3) * 0.03 - pull * 0.02 + this.limp.head * 0.25, Math.sin(t * 0.8) * 0.05, -sz * 0.4);
    if (n.head) n.head.rotation.set(hx, Math.sin(t * 0.5) * 0.12, hz);
    if (n.jaw) n.jaw.rotation.x = damp(n.jaw.rotation.x, this.anim.jaw + (this.expr === 'smug' ? 0.05 : 0) + Math.max(0, Math.sin(t * 13)) * this.anim.jaw * 0.4, 18, dt);
    // arms: lift (forward / overhead), spread, the yank; limp arms hang and swing
    for (const s of [1, -1]) {
      const k = s > 0 ? 'l' : 'r';
      const arm = n['arm_' + k], fore = n['fore_' + k], hand = n['hand_' + k], ctrl = n['ctrl_' + k];
      if (!arm || !fore || !hand) continue;
      const limp = this.limp['arm_' + k];
      const off = s > 0 ? 0 : 0.7;
      const lift = this.liftS * (1 - limp);
      const ax = -1.15 * Math.min(1, lift) - Math.max(0, lift - 1) * 1.5 - pull * 0.04 + Math.sin(t * 1.4 + off) * 0.06;
      const az = s * (0.12 + this.spreadS * 0.9 * (1 - limp)) + Math.sin(t * 1.1 + off) * 0.04;
      arm.rotation.set(ax + limp * (sx * 2), 0, az);
      const fx = -0.55 * (1 - limp) - pull * 0.03 + Math.sin(t * 1.7 + off) * 0.08;
      fore.rotation.set(fx, 0, 0);
      // the hand keeps the control cross level; the cross rocks as he works the strings
      hand.rotation.set(-(ax + fx) * (1 - limp) + limp * 0.4, 0, 0);
      if (ctrl) ctrl.rotation.set(Math.sin(t * 2.3 + off) * 0.12 + pull * 0.03 * s, Math.sin(t * 1.9 + off) * 0.1, Math.sin(t * 2.9 + off) * 0.15 * (1 - limp));
    }
    // legs dangle with lag; the right leg crosses behind the left knee (the Hanged Man's figure four)
    const dl = this.dangle.l.step(-fwd * 0.06 + sx * 0.5, dt), dr = this.dangle.r.step(-fwd * 0.06 + sx * 0.5, dt);
    const limpL = this.limp.leg_l, limpR = this.limp.leg_r;
    if (n.thigh_l) n.thigh_l.rotation.set(dl * 1.2 + Math.sin(t * 1.2) * 0.05 * (1 + limpL), 0, 0.05 + sz * 0.5);
    if (n.shin_l) n.shin_l.rotation.set(Math.max(0, -dl) * 0.6 + 0.06 + Math.sin(t * 1.5) * 0.04, 0, 0);
    if (n.foot_l) n.foot_l.rotation.set(0.35 + Math.sin(t * 1.6) * 0.06, 0, 0);
    if (n.thigh_r) n.thigh_r.rotation.set(0.32 * (1 - limpR) + dr * 1.2, 0, -0.12 * (1 - limpR) + sz * 0.5);
    if (n.shin_r) n.shin_r.rotation.set(1.55 * (1 - limpR) + 0.1 + Math.sin(t * 1.3) * 0.05, 0, 0);
    if (n.foot_r) n.foot_r.rotation.set(0.4, 0, 0);
    // the tau floats above him on its own slow drift; at death it falls and plants in the sand
    if (n.tau) {
      const p0 = this.rig.geo.parts[this.rig.geo.index['tau']].offset;
      const drop = this.tauDrop;
      const fallY = -(p0.y - 1.4) * drop - this.float * drop;
      n.tau.position.set(p0.x + drop * 1.6, p0.y + Math.sin(t * 0.8) * 0.06 * (1 - drop) + fallY, p0.z + drop * 0.8);
      n.tau.rotation.set(Math.sin(t * 0.5) * 0.03 + drop * 0.18, Math.sin(t * 0.3) * 0.12 * (1 - drop), Math.sin(t * 0.7) * 0.04 + drop * 0.12);
    }
    if (n.bell) n.bell.rotation.set(0, 0, this.bellSwing.step(Math.sin(t * 0.9) * 0.05, dt));
  }
}
