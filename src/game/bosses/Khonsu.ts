// The Avatar of Khonsu — the first boss (wave 5). A towering moon-mummy with a
// crescent scythe. Every attack is named after a song (Stones / GnR / Beatles).
//   Phase 1 (100–66%)  Moonlight Mile (scythe sweep + crescent fan), Midnight
//                      Rambler (melts into moonlight, reappears beside you),
//                      Time Is on My Side (clock-ring slow + spirals)
//   Phase 2 (66–33%)   + Paint It Black (night falls, moon blades rain),
//                      Mr. Moonlight (crown spirals, the dead rise)
//   Phase 3 (33–0%)    enraged form; the giant Hand of Khonsu descends from the
//                      sky: Under My Thumb (palm slam), You Could Be Mine
//                      (grab → mash to break free, the stunned hand is a weak
//                      point), Night Train (ground sweep — jump it), Knockin'
//                      on Heaven's Door (three knuckle knocks, shock rings)
// SUPER HARD pass: denser and faster patterns, chained moves and almost no
// downtime; his court rises throughout — Dead Flowers (a quick rite: mummies,
// jackals) and Across the Universe (the big summon cinematic on every phase
// change: three glyph circles, moon pillars, the dead climbing out). Curse
// Priests chant a moon-thread into him: while any priest lives he takes far
// less damage (kill the priests first). Phase 3 adds Out of Time — crescent
// barrages from the crown WHILE the hand attacks. Everything is telegraphed in
// the shared warning language ("!" glyphs, wedges, tracking rings that lock,
// lanes), and the big hand blows offer a QTE DODGE / JUMP: a dodged blow
// leaves him wide open (+50% damage, the hand pinned longer).
import * as THREE from 'three';
import { Boss, BossDeps, HitSphere } from './Boss';
import type { RayHit } from '../Ctx';
import { modelEntry } from '../models/lookup';
import { buildRigGeo, RigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { RigEyes } from '../fx/FaceFx';
import { PRESETS, EnvPreset } from '../world/Env';
import { rnd, damp, clamp, dampAngle } from '../../engine/math/rand';
import type { Hit } from '../combat/Damage';
import type { Enemy } from '../enemies/Enemies';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const MOON = '#cfe8ff';
const HAND_SCALE = 0.62;

type HandPose = { pos: THREE.Vector3; yaw: number; pitch: number; roll: number; curl: number; thumb: number };

export class KhonsuAvatar extends Boss {
  private handGeo: RigGeo | null = null;
  private enragedGeo: RigGeo | null = null;
  private hand: RigInstance | null = null;
  private handRoot = new THREE.Group();
  /** where the hand is heading; update() glides it there (speed = handRate) */
  private handT: HandPose = { pos: new THREE.Vector3(), yaw: 0, pitch: Math.PI / 2, roll: 0, curl: 0.25, thumb: 0.2 };
  private handNow: HandPose = { pos: new THREE.Vector3(), yaw: 0, pitch: Math.PI / 2, roll: 0, curl: 0.25, thumb: 0.2 };
  private handRate = 3;
  /** the hand can be shot while it is low / stunned */
  private handOpen = 0;
  private caught = false;
  private night = 0;
  private nightTarget = 0;
  private nightApplied = 0;
  private baseEnv: EnvPreset | null = null;
  private moonLight: THREE.PointLight;
  private sweepK = 0;
  private swingNames: string[] = [];
  private lastCallout = '';
  /** the court: minions he summoned (capped), seconds until the next rite */
  private court: Enemy[] = [];
  private riteCd = 9;
  /** priests' moon-threads: ward strength (damage taken multiplier) and the tether fx clock */
  private ward = 1;
  private tetherT = 0;
  /** a dodged blow leaves him open */
  private exposedT = 0;
  private barrage = false;
  private pendingRite = false;
  private wardToastT = -99;

  constructor(d: BossDeps, private tier = 1) {
    super(d, 'khonsu_avatar', { name: 'Avatar of Khonsu', title: 'He Who Wanders the Night', hp: 3000 * tier, scale: 1, eyes: ['glow', 0xcfe8ff] });
    this.hitSpheres = [
      { node: 'head', r: 0.42, part: 'head', weak: 1.8, offset: [0, 0.3, 0] },
      { node: 'torso', r: 0.72, part: 'torso', offset: [0, 0.35, 0] },
      { node: 'pelvis', r: 0.6, part: 'torso', offset: [0, 0, 0] },
      // the hand of Khonsu (tested separately, see hitTest)
      { node: '__hand', r: 0.001, part: 'hand', weak: 1.5 } as HitSphere,
    ];
    this.armor = 25;
    this.bounty = 260 * tier;
    this.phases = [0.66, 0.33];
    this.swingNames = (this.rig.geo.spec.meta?.swing as string[] | undefined) ?? [];
    this.moonLight = new THREE.PointLight(0xbfe0ff, 0, 9, 1.8);
    (this.rig.sockets['blade_tip'] ?? this.root).add(this.moonLight);
    this.handRoot.visible = false;
    this.ctx.scene.add(this.handRoot);
    this.baseEnv = { ...this.ctx.world.env.preset };
    // the dodge QTE needs the overlay even if the scene never handed it to the horde
    if (!d.enemies.qte) d.enemies.qte = d.qte;
  }

  private get warn() {
    return this.d.enemies.warn;
  }
  /** offer the QTE dodge if the hunter is in the blow's way; true = dodged */
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
    const top = { x: this.pos.x, y: this.pos.y + this.height + 0.6, z: this.pos.z };
    this.d.enemies.callout('OPENING!', top, 'elite');
    this.ctx.sfx('counter_clang', this.pos, 0.8, 0.7);
    this.ctx.fx.sparkle(top, 0xffd36b, 16, 1.2);
  }
  /** speed factor for wind-ups and gaps: faster per phase and per return */
  private get haste() {
    return (1 - this.phase * 0.12) * (1 - (this.tier - 1) * 0.08);
  }

  protected hitKind() {
    return 'linen' as any;
  }

  // ------------------------------------------------------------------ helpers
  private callout(song: string) {
    if (song === this.lastCallout) return;
    this.lastCallout = song;
    this.ctx.toast(`« ${song} »`, MOON, 'Avatar of Khonsu');
    this.ctx.engine.tweens.after(2, () => (this.lastCallout = ''));
  }
  private socketWorld(name: string, out: THREE.Vector3) {
    const s = this.rig.sockets[name];
    if (s) s.getWorldPosition(out);
    else out.set(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z);
    return out;
  }
  private inFront(maxD: number, cosMin = 0.2) {
    const dx = this.player.pos.x - this.pos.x, dz = this.player.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return d < maxD && (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / d > cosMin;
  }
  private predicted(t: number) {
    const v = this.player.board.vel;
    return this.playerPos().clone().addScaledVector(_w.set(v.x, 0, v.z), t);
  }
  private ground(x: number, z: number) {
    return this.ctx.world.groundAt(x, z);
  }

  /** pre-build the heavy meshes (enraged form + the 12 m hand) so phase 3 never hitches */
  private prebuild() {
    try {
      if (!this.enragedGeo) {
        const s = modelEntry('khonsu_avatar_enraged')?.() as RigSpec | undefined;
        if (s?.parts) this.enragedGeo = buildRigGeo(s, 'boss:khonsu_avatar_enraged');
      }
      if (!this.handGeo) {
        const s = modelEntry('khonsu_hand')?.() as RigSpec | undefined;
        if (s?.parts) this.handGeo = buildRigGeo(s, 'boss:khonsu_hand');
      }
    } catch (e) {
      console.warn('[khonsu] prebuild failed', e);
    }
  }

  // ------------------------------------------------------------------ intro
  async intro() {
    const ctx = this.ctx;
    const cam = this.d.cam;
    ctx.engine.letterbox(true, 0.5);
    this.invulnerable = true;
    // he rises out of the sand under a moon that comes up too early
    this.flying = true;
    const g = this.ground(this.pos.x, this.pos.z);
    this.pos.y = g - this.height * 0.9;
    this.nightTarget = 0.45;
    const look = new THREE.Vector3(this.pos.x, g + this.height * 0.55, this.pos.z);
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const low = look.clone().addScaledVector(dir, 7.5).addScaledVector(side, 2.5);
    low.y = Math.max(g + 0.7, this.ground(low.x, low.z) + 0.7);
    cam.setCine({ pos: low, look, fov: 52 });
    await this.wait(0.15);
    // heavy meshes are built under the letterbox while the camera holds still
    this.prebuild();
    ctx.sfx('quake_rumble', this.pos, 1);
    ctx.shake(0.4);
    const rise = 2.2;
    for (let t = 0; t < rise; t += 0.05) {
      this.pos.y = g - this.height * 0.9 * (1 - t / rise) ** 2;
      if (rnd.chance(0.5)) ctx.fx.sandBurst({ x: this.pos.x + (rnd.next() - 0.5) * 2, y: g, z: this.pos.z + (rnd.next() - 0.5) * 2 }, 0.8);
      await this.wait(0.05);
    }
    this.pos.y = g;
    this.flying = false;
    // slow push-in on the crown while he speaks
    const close = look.clone().addScaledVector(dir, 4.2).addScaledVector(side, -1.2);
    close.y = g + this.height * 0.85;
    cam.setCine({ pos: close, look: new THREE.Vector3(this.pos.x, g + this.height * 0.82, this.pos.z), fov: 40 });
    this.setExpr('smug');
    this.taunt('The moon remembers every grave you robbed, little bones.', MOON);
    ctx.sfx('boss_roar', this.pos, 1, 0.85);
    ctx.events.emit('bossIntro', this);
    await this.wait(2.6);
    cam.setCine(null);
    ctx.engine.letterbox(false, 0.5);
    this.nightTarget = 0;
    this.invulnerable = false;
    this.setExpr('angry');
  }

  // ------------------------------------------------------------------ fight loop
  protected async fight() {
    while (true) {
      this.check();
      const p = this.phase;
      if (this.pendingRite) {
        this.pendingRite = false;
        await this.acrossTheUniverse();
        continue;
      }
      // the court rises throughout the fight
      if (this.riteCd <= 0 && this.courtAlive() < 4 + p * 2 + this.tier) {
        await this.deadFlowers();
        continue;
      }
      const r = rnd.next();
      if (p === 0) {
        if (r < 0.34) await this.moonlightMile();
        else if (r < 0.58) await this.midnightRambler();
        else if (r < 0.8) await this.timeIsOnMySide();
        else await this.stalk();
        // chained: the sweep flows straight into a blink-slash
        if (r < 0.34 && rnd.chance(0.4)) await this.midnightRambler();
      } else if (p === 1) {
        if (r < 0.22) await this.paintItBlack();
        else if (r < 0.42) await this.moonlightMile();
        else if (r < 0.58) await this.mrMoonlight();
        else if (r < 0.8) await this.midnightRambler();
        else await this.timeIsOnMySide();
        if (r >= 0.58 && r < 0.8 && rnd.chance(0.5)) await this.moonlightMile();
      } else {
        if (!this.hand) await this.wait(0.3);
        else if (r < 0.26) {
          await this.underMyThumb();
          if (rnd.chance(0.45)) await this.underMyThumb();
        } else if (r < 0.44) await this.youCouldBeMine();
        else if (r < 0.6) await this.nightTrain();
        else if (r < 0.74 || this.frac < 0.12) await this.knockin();
        else if (r < 0.88) await this.moonlightMile();
        else await this.midnightRambler();
      }
      await this.wait((p >= 2 ? 0.12 : p === 1 ? 0.25 : 0.38) * this.haste);
    }
  }

  private async stalk() {
    const pp = this.playerPos();
    await this.moveTo(pp.x, pp.z, 4.6 + this.phase * 1, 1.2);
  }

  /** scythe sweep: deadly up close, throws fans of moon crescents */
  private async moonlightMile() {
    this.callout('Moonlight Mile');
    this.stop();
    this.faceTarget(this.playerPos());
    this.anim.wind = 1;
    this.ctx.sfx('divine_whisper', this.pos, 0.8, 1.25);
    this.moonLight.intensity = 6;
    const W = Math.max(0.38, (0.6 - this.phase * 0.08) * this.haste);
    this.warn.bang(this, { tier: 'tell', life: W, y: this.height + 0.5 });
    this.warn.wedge(this.pos.x, this.pos.z, this.yaw, 5.2, 1.0, W, 'heavy');
    await this.wait(W);
    this.faceTarget(this.predicted(0.3));
    this.anim.wind = 0;
    this.anim.strike = 1;
    this.sweepK = 1;
    this.ctx.sfx('whoosh_big', this.pos, 1, 0.8);
    const from = this.socketWorld('blade_tip', new THREE.Vector3());
    from.y = Math.max(from.y, this.pos.y + 1.2);
    const tierN = (this.tier - 1) * 2;
    this.fire('fan', { count: 9 + this.phase * 3 + tierN, spread: 1.8, speed: 13 + this.phase * 2, dmg: 10, proj: 'curse' }, from);
    if (this.phase >= 1) this.ctx.engine.tweens.after(0.22, () => this.alive && this.fire('fan', { count: 8 + this.phase * 3 + tierN, spread: 1.4, speed: 10, dmg: 9, proj: 'curse' }, from));
    if (this.phase >= 2) this.ctx.engine.tweens.after(0.44, () => this.alive && this.fire('fan', { count: 12 + tierN, spread: 2.2, speed: 8, dmg: 9, proj: 'curse' }, from));
    if (this.inFront(4.8)) this.player.takeHit({ base: 24 + this.phase * 4, kind: 'phys', source: 'contact', knock: 13 }, this.pos);
    await this.wait(0.35 * this.haste);
    this.moonLight.intensity = 0;
  }

  /** melts into moonlight and reappears at your side, slashing (the spot is marked first) */
  private async midnightRambler() {
    this.callout('Midnight Rambler');
    this.stop();
    const fx = this.rig.material.userData.fx.value;
    this.ctx.sfx('time_slow', this.pos, 0.6, 1.4);
    for (let t = 0; t < 0.3; t += 0.05) {
      fx.y = t / 0.3;
      await this.wait(0.05);
    }
    this.ctx.particles.emit({ pos: { x: this.pos.x, y: this.pos.y + 1.5, z: this.pos.z }, count: 26, spread: 1.2, up: 2, life: [0.5, 1], size: [0.15, 0.35], sprite: ['spark'], color: [0xcfe8ff, 0xffffff], alpha: 0.9, jitter: 1.2 });
    this.root.visible = false;
    // where he will step out of the dark: a silver ring and a "!" a beat before
    const pp = this.predicted(0.55);
    const a = rnd.next() * Math.PI * 2;
    let x = pp.x + Math.cos(a) * 3.4, z = pp.z + Math.sin(a) * 3.4;
    if (this.ctx.world.storm.sdf(x, z) <= 4) {
      x = this.pos.x;
      z = this.pos.z;
    }
    const lead = Math.max(0.32, 0.45 * this.haste);
    this.warn.circle(x, z, 2.2, lead + 0.15, 'heavy');
    this.warn.bang({ x, y: this.ground(x, z), z }, { tier: 'tell', life: lead, y: this.height * 0.9 });
    await this.wait(lead);
    this.place(x, z, Math.atan2(this.player.pos.x - x, this.player.pos.z - z));
    this.root.visible = true;
    for (let t = 0; t < 0.2; t += 0.05) {
      fx.y = 1 - t / 0.2;
      await this.wait(0.05);
    }
    fx.y = 0;
    this.faceTarget(this.playerPos());
    this.anim.strike = 1;
    this.sweepK = 1;
    this.ctx.sfx('whoosh_big', this.pos, 1, 1.1);
    if (this.inFront(4.2, -0.2)) this.player.takeHit({ base: 20 + this.phase * 4, kind: 'phys', source: 'contact', knock: 11 }, this.pos);
    this.fire('ring', { count: 14 + this.phase * 5 + (this.tier - 1) * 4, speed: 10, dmg: 8, proj: 'curse' }, _v.set(this.pos.x, this.pos.y + 1.2, this.pos.z));
    if (this.phase >= 1) this.ctx.engine.tweens.after(0.3, () => this.alive && this.fire('ring', { count: 12 + this.phase * 4, speed: 7.5, dmg: 8, proj: 'curse', phase: 0.5 }, new THREE.Vector3(this.pos.x, this.pos.y + 1.2, this.pos.z)));
    await this.wait(0.4 * this.haste);
  }

  /** a clock-ring shockwave slows time around him, then spirals */
  private async timeIsOnMySide() {
    this.callout('Time Is on My Side');
    this.stop();
    this.anim.aimL = 1;
    this.setExpr('smug');
    const c = { x: this.pos.x, y: this.pos.y + 0.2, z: this.pos.z };
    const W = 0.84 * this.haste;
    this.warn.bang(this, { tier: 'heavy', life: W, y: this.height + 0.5 });
    this.warn.circle(c.x, c.z, 10, W, 'heavy');
    for (let i = 0; i < 3; i++) {
      this.ctx.fx.ring(c, 0xcfe8ff, 18, 0.3);
      await this.wait(W / 3);
    }
    this.ctx.sfx('time_slow', this.pos, 1, 0.8);
    this.ctx.fx.ring(c, 0xffffff, 20, 0.6);
    if (this.distToPlayer() < 10) this.player.takeHit({ base: 4, kind: 'magic', source: 'contact', knock: 0, status: [{ id: 'slow', stacks: 3, dur: 3 }] }, this.pos);
    const from = this.socketWorld('head_top', new THREE.Vector3());
    for (let k = 0; k < 3 + this.phase; k++) {
      this.fire('spiral', { count: 24 + this.phase * 6 + (this.tier - 1) * 6, speed: 8.5 + k, dmg: 8, proj: 'curse', phase: k * 0.35 }, from);
      await this.wait(0.36 * this.haste);
    }
    this.anim.aimL = 0;
  }

  /** night falls; moon blades rain down around you */
  private async paintItBlack() {
    this.callout('Paint It Black');
    this.stop();
    this.taunt(rnd.pick(['Night falls when I say it falls.', 'Close your eyes. It is easier.', 'Every star is a grave.']), MOON);
    this.nightTarget = 1;
    this.anim.aimL = this.anim.aimR = 1;
    this.ctx.sfx('divine_whisper', this.pos, 1, 0.7);
    this.warn.bang(this, { tier: 'heavy', life: 0.9, y: this.height + 0.5 });
    await this.wait(0.9 * this.haste);
    const n = 9 + this.phase * 3 + (this.tier - 1) * 3;
    const hits: Promise<void>[] = [];
    for (let i = 0; i < n; i++) {
      const at = this.predicted(0.5 + rnd.next() * 0.4).add(_w.set((rnd.next() - 0.5) * 7, 0, (rnd.next() - 0.5) * 7));
      hits.push(this.slam(at, 2.6, 18, 0.7, 'curse'));
      await this.wait(0.17 * this.haste);
    }
    await Promise.all(hits);
    this.anim.aimL = this.anim.aimR = 0;
    await this.wait(0.8 * this.haste);
    if (this.phase < 2) this.nightTarget = 0;
  }

  /** the crown pours lunar spirals while the dead climb out of the sand */
  private async mrMoonlight() {
    this.callout('Mr. Moonlight');
    this.stop();
    this.taunt(rnd.pick(['Rise. The moon is watching.', 'Sleep is over, servants.', 'Bring me his bones.']), MOON);
    this.warn.bang(this, { tier: 'tell', life: 0.5, y: this.height + 0.5 });
    if (this.courtAlive() < 6 + this.phase * 2) this.raise(this.phase >= 2 ? 'bandageWhipper' : 'mummy', 2 + this.phase, 7);
    const from = this.socketWorld('head_top', new THREE.Vector3());
    for (let k = 0; k < 3 + this.phase; k++) {
      this.fire('spiral', { count: 18 + this.phase * 5, speed: 9.5, dmg: 8, proj: 'curse', phase: k * 0.3 }, from);
      await this.wait(0.42 * this.haste);
    }
  }

  // ------------------------------------------------------------------ the court
  private courtAlive() {
    this.court = this.court.filter((e) => e.alive);
    return this.court.length;
  }
  /** spawn minions round a point (they climb out of the sand) and enlist them in the court */
  private raise(type: string, n: number, r = 6, at?: { x: number; z: number }) {
    const c = at ?? this.pos;
    for (let i = 0; i < n; i++) {
      const a = rnd.next() * Math.PI * 2;
      const x = c.x + Math.cos(a) * r * (0.4 + rnd.next() * 0.6), z = c.z + Math.sin(a) * r * (0.4 + rnd.next() * 0.6);
      if (this.ctx.world.storm.sdf(x, z) < 3) continue;
      const e = this.d.enemies.spawn(type, x, z, { emerge: 'sand' });
      if (e) this.court.push(e);
    }
  }
  /** the court for this phase: who answers a rite */
  private courtFor(big: boolean): [string, number][] {
    const p = this.phase;
    const t = this.tier - 1;
    if (p === 0) return big ? [['mummy', 2], ['jackal', 2]] : rnd.chance(0.5) ? [['mummy', 2 + t]] : [['jackal', 2 + t]];
    if (p === 1) return big ? [['cursePriest', 2], ['mummy', 2], ['jackal', 2 + t]] : [[rnd.pick(['mummy', 'jackal', 'cursePriest']), 2 + t], ['jackal', 1]];
    return big ? [['cursePriest', 2], ['bandageWhipper', 2], ['jackalArcher', 2]] : [[rnd.pick(['jackalArcher', 'bandageWhipper', 'cursePriest']), 2 + t]];
  }
  /** glyph circles on the sand, a pillar of moonlight each, then the dead climb out */
  private async ritual(sites: { x: number; z: number }[], lead: number, groups: [string, number][]) {
    const ctx = this.ctx;
    for (const s of sites) {
      const g = this.ground(s.x, s.z);
      this.warn.circle(s.x, s.z, 2.2, lead + 0.2, 'heavy');
      ctx.fx.glyphs({ x: s.x, y: g + 0.3, z: s.z }, 0xcfe8ff, 10, 1.8);
    }
    ctx.sfx('divine_whisper', this.pos, 1, 0.6);
    await this.wait(lead);
    let gi = 0;
    for (const s of sites) {
      const g = this.ground(s.x, s.z);
      // the pillar: a column of moonlight pouring onto the circle
      for (let h = 0; h < 14; h += 1.4) ctx.particles.emit({ pos: { x: s.x, y: g + h, z: s.z }, count: 2, spread: 0.6, up: -1.5, life: [0.4, 0.8], size: [0.5, 0.1], sprite: ['glow16', 'spark'], additive: true, color: [0xcfe8ff, 0xffffff], jitter: 0.5 });
      ctx.fx.ring({ x: s.x, y: g + 0.2, z: s.z }, 0xcfe8ff, 6, 0.5);
      ctx.fx.light({ x: s.x, y: g + 2, z: s.z }, 0xcfe8ff, 6, 0.6, 14);
      ctx.fx.sandBurst({ x: s.x, y: g, z: s.z }, 1.4);
      ctx.sfx('sand_rise', { x: s.x, y: g, z: s.z }, 0.9);
      const [type, n] = groups[gi++ % groups.length];
      this.raise(type, n, 2.2, s);
    }
    ctx.shake(0.35);
  }
  private riteSites(n: number, r0: number, r1: number) {
    const pp = this.playerPos();
    const out: { x: number; z: number }[] = [];
    const a0 = rnd.next() * Math.PI * 2;
    for (let i = 0; i < n * 3 && out.length < n; i++) {
      const a = a0 + (out.length / n) * Math.PI * 2 + (rnd.next() - 0.5) * 0.5;
      const r = r0 + rnd.next() * (r1 - r0);
      const x = pp.x + Math.cos(a) * r, z = pp.z + Math.sin(a) * r;
      if (this.ctx.world.storm.sdf(x, z) > 4) out.push({ x, z });
    }
    return out;
  }

  /** a quick rite mid-fight: the scythe raised, two circles, the dead answer */
  private async deadFlowers() {
    this.callout('Dead Flowers');
    this.stop();
    this.anim.aimL = this.anim.aimR = 1;
    this.setExpr('smug');
    this.warn.bang(this, { tier: 'tell', life: 0.9, y: this.height + 0.5 });
    this.moonLight.intensity = 8;
    this.taunt(rnd.pick(['Wake, my faithful.', 'The moon calls the roll.', 'Rise and serve.']), MOON);
    await this.ritual(this.riteSites(2, 7, 11), 1.0 * this.haste, this.courtFor(false));
    this.riteCd = (this.phase >= 2 ? 10 : 13) + rnd.next() * 3;
    this.moonLight.intensity = 0;
    this.anim.aimL = this.anim.aimR = 0;
    this.setExpr(this.phase >= 2 ? 'enraged' : 'angry');
  }

  /** the big summon on a phase change: letterbox, a low camera on the circles, three pillars of moonlight */
  private async acrossTheUniverse() {
    const ctx = this.ctx;
    const cam = this.d.cam;
    this.callout('Across the Universe');
    this.stop();
    this.invulnerable = true;
    ctx.engine.letterbox(true, 0.4);
    ctx.engine.slowMo(0.55, 10);
    this.anim.aimL = this.anim.aimR = 1;
    this.moonLight.intensity = 10;
    this.nightTarget = Math.max(this.nightTarget, 0.6);
    const sites = this.riteSites(3, 8, 12);
    if (sites.length) {
      const s = sites[0];
      const g = this.ground(s.x, s.z);
      const dx = s.x - this.pos.x, dz = s.z - this.pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      const camPos = new THREE.Vector3(s.x + (dx / dl) * 5 + (dz / dl) * 2, 0, s.z + (dz / dl) * 5 - (dx / dl) * 2);
      camPos.y = this.ground(camPos.x, camPos.z) + 1.2;
      cam.setCine({ pos: camPos, look: new THREE.Vector3((s.x + this.pos.x) / 2, g + 2.2, (s.z + this.pos.z) / 2), fov: 50 });
    }
    this.taunt(rnd.pick(['ACROSS THE SKY, MY CHILDREN — COME!', 'The night has many hands. Here are more.', 'Kneel, little bones. My court is in session.']), MOON);
    ctx.sfx('boss_roar', this.pos, 1, 0.75);
    await this.ritual(sites, 1.0, this.courtFor(true));
    await this.wait(0.7);
    cam.setCine(null);
    ctx.engine.letterbox(false, 0.4);
    ctx.engine.slowMo(1, 6);
    this.anim.aimL = this.anim.aimR = 0;
    this.moonLight.intensity = 0;
    if (this.phase < 2) this.nightTarget = 0.35;
    this.invulnerable = false;
    this.riteCd = 12;
    if (this.courtAlive() && this.court.some((e) => e.def.id === 'cursePriest')) ctx.toast('CURSE PRIESTS', MOON, 'Their moon-thread wards him — kill the priests first!', true);
  }

  /** phase 3: crescent barrages from the crown while the hand fights */
  private async outOfTime() {
    if (this.barrage) return;
    this.barrage = true;
    try {
      let k = 0;
      while (true) {
        await this.wait((2.6 - (this.tier - 1) * 0.3) * (this.frac < 0.15 ? 0.75 : 1));
        if (this.invulnerable) continue;
        this.warn.bang(this, { tier: 'tell', life: 0.4, y: this.height + 0.5 });
        const from = this.socketWorld('head_top', new THREE.Vector3());
        this.ctx.particles.emit({ pos: from, count: 1, life: [0.24, 0.24], size: [0.75, 0.15], sprite: 'star4', additive: true, color: 0xd8b0ff, screen: true, sizeJitter: 0, rot: 0.4 });
        await this.wait(0.4);
        if (k++ % 2 === 0) this.fire('fan', { count: 11 + this.tier * 2, spread: 2.0, speed: 10, dmg: 8, proj: 'curse' }, from);
        else this.fire('ring', { count: 16 + this.tier * 4, speed: 8, dmg: 8, proj: 'curse', phase: rnd.next() }, from);
        if (k === 1) this.callout('Out of Time');
      }
    } catch {
      // cancelled with the fight
    }
  }

  // ------------------------------------------------------------------ phase 3: the hand
  protected onPhase(p: number) {
    super.onPhase(p);
    if (p === 1) {
      this.taunt('You have seen my face. Now see my sky.', MOON);
      this.nightTarget = 0.35;
      this.pendingRite = true;
    }
    if (p === 2) void this.descend();
  }

  private enrage() {
    this.prebuild();
    if (!this.enragedGeo) return;
    const old = this.rig;
    const r = new RigInstance(this.enragedGeo, { ownMaterial: true });
    this.root.remove(old.root);
    this.root.add(r.root);
    this.rig = r;
    this.eyes = new RigEyes(r, 'glow', 0xcfe8ff);
    this.swingNames = (r.geo.spec.meta?.swing as string[] | undefined) ?? [];
    (r.sockets['blade_tip'] ?? this.root).add(this.moonLight);
    this.setExpr('enraged');
    old.material.dispose();
  }

  /** cinematic: the moon cracks and the Hand of Khonsu comes down through the clouds */
  private async descend() {
    const ctx = this.ctx;
    const cam = this.d.cam;
    this.invulnerable = true;
    this.stop();
    this.nightTarget = 1;
    ctx.engine.letterbox(true, 0.4);
    ctx.engine.flash(0xcfe8ff, 0.5, 0.5);
    this.enrage();
    this.taunt('BEHOLD THE HAND THAT TURNS THE NIGHT!', MOON);
    ctx.sfx('boss_roar', this.pos, 1, 0.7);
    this.prebuild();
    if (this.handGeo && !this.hand) {
      this.hand = new RigInstance(this.handGeo, { ownMaterial: true });
      this.handRoot.add(this.hand.root);
      this.handRoot.scale.setScalar(HAND_SCALE);
    }
    const g = this.ground(this.pos.x, this.pos.z);
    const above = new THREE.Vector3(this.pos.x, g + 70, this.pos.z);
    this.handNow.pos.copy(above);
    this.handT.pos.copy(above);
    this.handRoot.visible = !!this.hand;
    // camera looks up past him into the sky
    const look = new THREE.Vector3(this.pos.x, g + 16, this.pos.z);
    const cp = new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * 10, g + 1.6, this.pos.z + Math.cos(this.yaw) * 10);
    cam.setCine({ pos: cp, look, fov: 62 });
    this.handRate = 0.9;
    this.handT.pos.set(this.pos.x, g + 13, this.pos.z);
    this.handT.pitch = Math.PI / 2;
    this.handT.curl = 0.35;
    ctx.sfx('quake_rumble', this.pos, 1, 0.6);
    for (let t = 0; t < 3; t += 0.25) {
      ctx.shake(0.15 + t * 0.08);
      await this.wait(0.25);
    }
    ctx.sfx('explosion_big', this.pos, 0.7, 0.6);
    this.handRate = 3;
    cam.setCine(null);
    ctx.engine.letterbox(false, 0.4);
    ctx.toast('THE HAND OF KHONSU', MOON, 'Shoot the hand while it is down — jump its sweep!', true);
    this.invulnerable = false;
    // his last court climbs out under the hand, and the crown never stops firing now
    this.callout('Across the Universe');
    void this.ritual(this.riteSites(3, 9, 13), 0.9, this.courtFor(true)).catch(() => {});
    this.riteCd = 11;
    void this.outOfTime();
  }

  private hover() {
    const pp = this.playerPos();
    this.handRate = 2.2;
    this.handT.pos.set((this.pos.x + pp.x) / 2, this.ground(pp.x, pp.z) + 11, (this.pos.z + pp.z) / 2);
    this.handT.pitch = Math.PI / 2;
    this.handT.roll = 0;
    this.handT.curl = 0.35;
    this.handT.thumb = 0.2;
  }

  /** the palm comes down on you */
  private async underMyThumb() {
    if (!this.hand) return;
    this.callout('Under My Thumb');
    this.stop();
    this.anim.aimR = 1;
    const at = this.predicted(1.0);
    const g = this.ground(at.x, at.z);
    this.handRate = 3.6;
    this.handT.pos.set(at.x, g + 11, at.z);
    this.handT.yaw = Math.atan2(at.x - this.pos.x, at.z - this.pos.z);
    this.handT.pitch = Math.PI / 2;
    this.handT.curl = 0.05;
    this.handT.thumb = 0.05;
    this.warn.bang({ x: at.x, y: g, z: at.z }, { tier: 'heavy', life: 1.3 * this.haste + 0.2, y: 6 });
    await this.wait(0.5 * this.haste);
    const slam = this.slam(at, 4.8, 34, 0.95, 'curse');
    await this.wait(0.72);
    this.handRate = 14;
    this.handT.pos.y = g + 0.6;
    const pl = this.player;
    const dodged = await this.dodge(at, () => Math.hypot(pl.pos.x - at.x, pl.pos.z - at.z) < 5 && pl.pos.y < g + 3);
    await slam;
    this.ctx.shake(0.8);
    this.ctx.world.deform(at.x, at.z, 3.2, 0.9);
    this.ctx.fx.dust({ x: at.x, y: g + 0.3, z: at.z }, 4, 0xe6cf9f, 10);
    // pinned and open: shoot it (pinned longer after a dodge)
    this.handOpen = 1;
    if (dodged) this.openUp(2.6);
    await this.wait(dodged ? 2.4 : 1.1);
    this.handOpen = 0;
    this.hover();
    this.anim.aimR = 0;
  }

  /** an open hand lunges along the ground and closes; if it catches you, mash to break free */
  private async youCouldBeMine() {
    if (!this.hand) return;
    this.callout('You Could Be Mine');
    this.stop();
    const pp = this.playerPos();
    const g = this.ground(pp.x, pp.z);
    const yaw = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
    // start behind him, palm toward the player, fingers up and spread
    const start = new THREE.Vector3(this.pos.x - Math.sin(yaw) * 2, this.ground(this.pos.x, this.pos.z) + 2.2, this.pos.z - Math.cos(yaw) * 2);
    this.handRate = 4;
    this.handT.pos.copy(start);
    this.handT.yaw = yaw;
    this.handT.pitch = 0.25;
    this.handT.curl = -0.25;
    this.handT.thumb = -0.3;
    this.warn.bang({ x: start.x, y: start.y, z: start.z }, { tier: 'grab', life: 1.2, y: 2.6 });
    await this.wait(0.7 * this.haste);
    const target = this.predicted(0.8);
    this.warn.lane(start.x, start.z, target.x - start.x, target.z - start.z, Math.hypot(target.x - start.x, target.z - start.z) + 2, 4.4, 0.85, 'grab');
    this.handRate = 5.5;
    this.handT.pos.set(target.x, g + 1.8, target.z);
    this.ctx.sfx('whoosh_big', this.pos, 1, 0.6);
    await this.wait(0.62);
    const pl = this.player;
    const dodged = await this.dodge(start, () => Math.hypot(pl.pos.x - target.x, pl.pos.z - target.z) < 4);
    await this.wait(0.13);
    this.handT.curl = 1.35;
    this.handT.thumb = 1.1;
    await this.wait(0.12);
    const palm = this.handPalm(_v);
    const d = Math.hypot(this.player.pos.x - palm.x, this.player.pos.z - palm.z);
    if (dodged) {
      // it closed on an afterimage: the open hand hangs in the sand
      this.handT.curl = -0.2;
      this.handOpen = 1;
      this.openUp(2.4);
      await this.wait(2.2);
      this.handOpen = 0;
    } else if (d < 3.4 && this.player.pos.y < palm.y + 2.5) {
      this.caught = true;
      this.taunt(rnd.pick(['Mine.', 'Struggle. It amuses the moon.', 'Your bones belong to the night.']), MOON);
      const r = await this.qte({ kind: 'mash', key: 'KeyE', label: 'BREAK FREE', duration: 2.4, target: 15 + this.phase * 2 });
      this.caught = false;
      if (r !== 'fail') {
        this.handT.curl = -0.3;
        this.ctx.toast('BROKE FREE!', '#9dff3a');
        this.player.board.impulse.set(Math.sin(yaw) * 14, 7, Math.cos(yaw) * 14);
        this.handOpen = 1;
        this.ctx.sfx('counter_clang', this.pos, 0.8, 0.8);
        await this.wait(1.8);
        this.handOpen = 0;
      } else {
        this.player.takeHit({ base: 32, kind: 'phys', source: 'contact', knock: 0 }, palm);
        this.ctx.shake(0.6);
        this.player.board.impulse.set(Math.sin(yaw) * 18, 9, Math.cos(yaw) * 18);
        this.handT.curl = -0.2;
        await this.wait(0.6);
      }
    } else {
      await this.wait(0.5);
      this.handT.curl = 0.35;
    }
    this.hover();
  }

  /** the hand sweeps the sand at ankle height across your path — jump it */
  private async nightTrain() {
    if (!this.hand) return;
    this.callout('Night Train');
    this.stop();
    const pp = this.playerPos();
    const g = this.ground(pp.x, pp.z);
    const yaw = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const a = pp.clone().addScaledVector(side, -14);
    const b = pp.clone().addScaledVector(side, 14);
    this.handRate = 4;
    this.handT.pos.set(a.x, g + 1.1, a.z);
    this.handT.yaw = yaw + Math.PI / 2;
    this.handT.pitch = Math.PI / 2;
    this.handT.roll = Math.PI / 2;
    this.handT.curl = 0.2;
    // telegraph along the line
    this.warn.lane(a.x, a.z, b.x - a.x, b.z - a.z, 28, 3.6, 1.0 * this.haste + 0.6, 'heavy');
    this.warn.bang({ x: pp.x, y: g, z: pp.z }, { tier: 'heavy', life: 1.0 * this.haste, y: 3.2 });
    this.ctx.toast('JUMP!', '#ffffff');
    await this.wait(1.0 * this.haste);
    this.ctx.sfx('quake_rumble', this.pos, 1, 1.3);
    const dur = 1.25 * (1 - this.phase * 0.05);
    let hit = false, jumped = false, offered = false;
    for (let t = 0; t < dur; t += 0.05) {
      const k = t / dur;
      const x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
      if (!offered && Math.hypot(this.player.pos.x - x, this.player.pos.z - z) < 5.5) {
        offered = true;
        jumped = await this.dodge({ x, z }, () => this.player.pos.y < this.ground(this.player.pos.x, this.player.pos.z) + 1.2, true);
        if (jumped) this.exposedT = 1.8;
      }
      this.handNow.pos.set(x, this.ground(x, z) + 1.1, z);
      this.handT.pos.copy(this.handNow.pos);
      if (rnd.chance(0.6)) this.ctx.fx.sandBurst({ x, y: this.ground(x, z), z }, 1);
      const pd = Math.hypot(this.player.pos.x - x, this.player.pos.z - z);
      if (!hit && !jumped && pd < 2.6 && this.player.pos.y < this.ground(x, z) + 1.5) {
        hit = true;
        this.player.takeHit({ base: 28, kind: 'phys', source: 'contact', knock: 16 }, new THREE.Vector3(x, this.player.pos.y, z));
      }
      await this.wait(0.05);
    }
    this.handT.roll = 0;
    this.hover();
  }

  /** a fist knocks the ground three times; each knock rings out a shockwave */
  private async knockin() {
    if (!this.hand) return;
    this.callout("Knockin' on Heaven's Door");
    this.stop();
    const at = this.predicted(0.6);
    const g = this.ground(at.x, at.z);
    this.handRate = 4;
    this.handT.pos.set(at.x, g + 7, at.z);
    this.handT.pitch = Math.PI / 2 + 0.5;
    this.handT.curl = 1.5;
    this.handT.thumb = 1.2;
    this.warn.circle(at.x, at.z, 3.6, 0.8 * this.haste + 2.4, 'heavy');
    this.warn.bang({ x: at.x, y: g, z: at.z }, { tier: 'heavy', life: 0.8 * this.haste, y: 8.5 });
    await this.wait(0.8 * this.haste);
    for (let i = 0; i < 3; i++) {
      this.handRate = 12;
      this.handT.pos.y = g + 1.2;
      await this.wait(0.22);
      this.ctx.shake(0.55);
      this.ctx.sfx('explosion', at, 0.9, 0.7 - i * 0.05);
      this.ctx.fx.sandBurst({ x: at.x, y: g, z: at.z }, 2.2);
      this.fire('ring', { count: 30 + i * 6 + (this.tier - 1) * 6, speed: 9 + i * 1.5, dmg: 10, proj: 'curse' }, _w.set(at.x, g + 0.6, at.z));
      if (Math.hypot(this.player.pos.x - at.x, this.player.pos.z - at.z) < 3.5 && this.player.pos.y < g + 2) this.player.takeHit({ base: 26, kind: 'phys', source: 'contact', knock: 14 }, at);
      this.handRate = 6;
      this.handT.pos.y = g + 5;
      await this.wait(0.42 * this.haste);
    }
    this.handOpen = 1;
    this.handT.pos.y = g + 2;
    await this.wait(1.0);
    this.handOpen = 0;
    this.hover();
  }

  private handPalm(out: THREE.Vector3) {
    const pc = (this.handGeo?.spec.meta?.palmCenter as [number, number, number] | undefined) ?? [0, 2.1, 0.45];
    out.set(pc[0], pc[1], pc[2]);
    this.handRoot.updateMatrixWorld(true);
    return this.handRoot.localToWorld(out);
  }

  // ------------------------------------------------------------------ targeting: the hand is a weak point
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    const best = super.hitTest(o, d, maxT);
    if (!this.hand || !this.handRoot.visible || !this.alive) return best;
    const c = this.handPalm(_v);
    const r = (this.handOpen > 0 ? 2.6 : 1.7) * HAND_SCALE * 2;
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return best;
    let t = -b - Math.sqrt(disc);
    if (t < 0) t = -b + Math.sqrt(disc);
    if (t < 0 || t > (best?.t ?? maxT)) return best;
    const point = o.clone().addScaledVector(d, t);
    return { enemy: this, t, point, normal: point.clone().sub(c).normalize(), headshot: this.handOpen > 0, part: 'hand', surface: 'enemy' } as RayHit;
  }

  // ------------------------------------------------------------------ damage: the priests' ward, the opening after a dodge
  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    if (!this.alive || this.invulnerable) return super.takeDamage(hit, point, dir);
    const m = this.ward * (this.exposedT > 0 ? 1.5 : 1);
    const amt = super.takeDamage({ ...hit, mult: (hit.mult ?? 1) * m }, point, dir);
    if (this.ward < 1 && point && amt > 0 && hit.source !== 'poison' && hit.source !== 'bleed' && hit.source !== 'burn') {
      // the moon-thread drinks the blow: a pale shimmer where it lands
      this.ctx.particles.emit({ pos: point, count: 3, spread: 1.2, up: 0.6, life: [0.25, 0.45], size: [0.45, 0.1], sprite: ['glow16', 'spark'], additive: true, color: [0xcfe8ff, 0x9fd0ff] });
      if (this.t - this.wardToastT > 7) {
        this.wardToastT = this.t;
        this.ctx.toast('WARDED BY THE MOON', MOON, 'Kill the Curse Priests to cut the thread');
      }
    }
    return amt;
  }

  /** priests within reach thread moonlight into him: each one alive takes a bite out of the damage he takes */
  private updateWard(dt: number) {
    const priests: Enemy[] = [];
    for (const e of this.d.enemies.list) if (e.alive && e.def.id === 'cursePriest' && e.state !== 'spawn' && e.retreat <= 0 && Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < 40) priests.push(e);
    const want = priests.length ? Math.max(0.3, 0.55 - (priests.length - 1) * 0.1) : 1;
    this.ward = damp(this.ward, want, 6, dt);
    if (!priests.length || !this.root.visible) return;
    // the threads: beads of moonlight running from each staff into his chest
    this.tetherT -= dt;
    if (this.tetherT > 0) return;
    this.tetherT = 0.05;
    const to = this.socketWorld('head_top', _w).clone();
    to.y -= this.height * 0.35;
    const P = this.ctx.particles;
    for (const e of priests) {
      const from = this.d.enemies.socketWorld(e, 'orb', _v) ?? _v.set(e.pos.x, e.pos.y + 2, e.pos.z);
      for (let i = 0; i < 3; i++) {
        const k = rnd.next();
        const sag = Math.sin(k * Math.PI) * 0.8;
        P.emit({ pos: { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k - sag, z: from.z + (to.z - from.z) * k }, count: 1, vel: { x: (to.x - from.x) * 0.4, y: (to.y - from.y) * 0.4, z: (to.z - from.z) * 0.4 }, life: [0.18, 0.3], size: [0.12, 0.04], sprite: 'dot3', additive: true, color: [0xcfe8ff, 0x9fd0ff, 0xffffff], sizeJitter: 0.2 });
      }
      if (rnd.chance(0.25)) {
        const t = e.def.moveTitles?.ward;
        if (t && rnd.chance(0.02)) this.d.enemies.skill(e, t);
      }
    }
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number) {
    super.update(dt);
    if (this.alive) {
      this.riteCd -= dt;
      this.exposedT = Math.max(0, this.exposedT - dt);
      this.updateWard(dt);
      if (this.exposedT > 0 && rnd.chance(dt * 10)) this.ctx.particles.emit({ pos: { x: this.pos.x + (rnd.next() - 0.5) * 1.6, y: this.pos.y + this.height * (0.3 + rnd.next() * 0.6), z: this.pos.z + (rnd.next() - 0.5) * 1.6 }, count: 1, vel: { x: 0, y: 0.7, z: 0 }, life: [0.3, 0.5], size: [0.45, 0.06], sprite: 'star4', additive: true, color: [0xffd36b, 0xffffff] });
    }
    // night
    this.night = damp(this.night, this.nightTarget, 1.1, dt);
    if (this.baseEnv && Math.abs(this.night - this.nightApplied) > 0.004) {
      this.nightApplied = this.night;
      this.ctx.world.env.lerpPreset(this.baseEnv, PRESETS.night, this.night * 0.85);
    }
    // the hand glides toward its pose
    if (this.hand && this.handRoot.visible) {
      const k = 1 - Math.exp(-this.handRate * dt);
      const H = this.handNow, T = this.handT;
      H.pos.lerp(T.pos, k);
      H.yaw = dampAngle(H.yaw, T.yaw, this.handRate, dt);
      H.pitch = damp(H.pitch, T.pitch, this.handRate, dt);
      H.roll = damp(H.roll, T.roll, this.handRate, dt);
      H.curl = damp(H.curl, T.curl, 9, dt);
      H.thumb = damp(H.thumb, T.thumb, 9, dt);
      const bob = Math.sin(this.t * 1.3) * 0.25 * (this.handOpen ? 0 : 1);
      this.handRoot.position.set(H.pos.x, H.pos.y + bob, H.pos.z);
      this.handRoot.rotation.set(0, 0, 0);
      this.handRoot.rotateY(H.yaw);
      this.handRoot.rotateX(H.pitch);
      this.handRoot.rotateY(H.roll);
      const n = this.hand.nodes;
      for (let f = 1; f <= 4; f++)
        for (let j = 1; j <= 3; j++) {
          const node = n[`f${f}_${j}`];
          if (node) node.rotation.x = H.curl * (j === 1 ? 0.8 : 1.05) + Math.sin(this.t * 2 + f + j) * 0.03;
        }
      for (let j = 1; j <= 3; j++) if (n[`t_${j}`]) n[`t_${j}`].rotation.x = H.thumb * 0.8;
      const sw = (this.hand.geo.spec.meta?.swing as string[] | undefined) ?? [];
      sw.forEach((nm, i) => {
        const node = n[nm];
        if (node) node.rotation.z = Math.sin(this.t * 1.7 + i * 0.9) * 0.25;
      });
      const hfx = this.hand.material.userData.fx.value;
      hfx.z = this.handOpen > 0 ? 1.2 + Math.sin(this.t * 10) * 0.6 : 0.2;
      // while caught, the player rides inside the closing fist
      if (this.caught) {
        const pc = this.handPalm(_v);
        const b = this.player.board;
        b.pos.set(pc.x, Math.max(this.ground(pc.x, pc.z), pc.y - 1), pc.z);
        b.vel.set(0, 0, 0);
      }
    }
  }

  protected animate(dt: number) {
    super.animate(dt);
    const n = this.rig.nodes;
    // the scythe sweep twists the whole upper body through the arc
    this.sweepK = Math.max(0, this.sweepK - dt * 2.4);
    const s = this.sweepK;
    if (n['torso']) n['torso'].rotation.y += Math.sin((1 - s) * Math.PI) * 0.9 * (s > 0 ? 1 : 0) - this.anim.wind * 0.6;
    if (n['weapon']) n['weapon'].rotation.z = damp(n['weapon'].rotation.z, this.anim.wind * 0.6 - s * 0.9, 10, dt);
    // ribbons, crown charms, scythe charms swing with motion
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.swingNames.forEach((nm, i) => {
      const node = n[nm];
      if (!node) return;
      node.rotation.x = Math.sin(this.t * 2.2 + i * 0.7) * 0.12 + clamp(sp * 0.05, 0, 0.5) + s * 0.4;
      node.rotation.z = Math.sin(this.t * 1.6 + i * 1.3) * 0.1;
    });
  }

  die() {
    if (!this.alive) return;
    this.taunt('The moon… will rise… again…', MOON);
    super.die();
    this.nightTarget = 0;
    if (this.hand) {
      this.handOpen = 0;
      this.handRate = 0.8;
      this.handT.pos.y += 80;
      this.handT.curl = -0.3;
    }
  }

  dispose() {
    super.dispose();
    // the night lifts and the hand rises away before everything is cleaned up
    void (async () => {
      const tw = this.ctx.engine.tweens;
      for (let t = 0; t < 4; t += 0.05) {
        await tw.wait(0.05);
        this.night = damp(this.night, 0, 1.4, 0.05);
        if (this.baseEnv) this.ctx.world.env.lerpPreset(this.baseEnv, PRESETS.night, this.night * 0.85);
        if (this.hand && this.handRoot.parent) {
          this.handNow.pos.lerp(this.handT.pos, 1 - Math.exp(-0.8 * 0.05));
          this.handRoot.position.copy(this.handNow.pos);
        }
      }
      if (this.baseEnv) this.ctx.world.env.apply(this.baseEnv);
      this.handRoot.removeFromParent();
      this.hand?.material.dispose();
      this.moonLight.removeFromParent();
    })();
  }
}
