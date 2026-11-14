// SEBEKHOTEP, JAW OF THE NILE — Cleopatra's crocodile-headed river champion
// (an original Sobek-flavoured design; model: models/nile/crocodile.ts). He wades
// chest-deep, swims under the river, and fights on the banks with a bronze glaive.
// Every move is a song title (Rolling Stones / Guns N' Roses / Beatles):
//   Coma                     the entrance: a wake circles the hunter, the river
//                            boils, he breaches spinning and lands in the shallows
//   Undercover of the Night  dives; a V of ripples hunts the hunter; a ring opens
//                            under him and the jaws come up through it
//   Let It Bleed             the death roll: a lunge with the jaws open; caught,
//                            he rolls with you (mash E to break free and stun him)
//   Shattered                tail sweep: a wide wedge of the river is cleared
//   Rain                     the glaive comes down, geysers march at the hunter
//   Bad Obsession            three snapping lunges, short lanes, quick reads
//   Yer Blues                a fan of river-water slugs spat from the jaws
//   All Down the Line        (66%) he calls a reed skiff of the Queen's soldiers
//   Estranged                (33%) enraged: chained moves, the sun disc burns
// Weak points: the head and snout (x1.5), and the belly while he is exposed
// after a dodged blow or a broken death roll. On land, the geysers become sand.
import * as THREE from 'three';
import { Boss, BossDeps } from './Boss';
import type { RayHit } from '../Ctx';
import type { Hit } from '../combat/Damage';
import { WaterShots } from './OasisKing';
import { buildRigGeo, RigInstance, type RigSpec } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import { clamp, damp, dampAngle, rnd } from '../../engine/math/rand';

const COL = '#8fd06a';
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const RIVER = [0xe8f6f4, 0xb8dcd4, 0x9ac8c0, 0xffffff];
const SAND = [0xf6dfb0, 0xeccb8f, 0xe0b373];

interface WaterLike {
  heightAt(x: number, z: number): number;
  isWater?(x: number, z: number, minDepth?: number): boolean;
  wake?(x: number, z: number, vx: number, vz: number, size?: number): void;
  splash?(x: number, z: number, size?: number): void;
}

export class CrocodileChampion extends Boss {
  private shots: WaterShots;
  /** 0 standing .. 1 fully under the river */
  private under = 0;
  private underT = 0;
  /** swim pose (body flat, tail driving) */
  private swim = 0;
  private swimT = 0;
  /** whole-body overrides: pitch forward (lying along the river), roll about the long axis */
  private pitchO = 0;
  private rollO = 0;
  private liftO = 0;
  private jawT = 0;
  private tailSweep = 0;
  private tailSwing = 0;
  private holding = false;
  private exposedT = 0;
  private enraged = false;
  private calledBoat = false;
  private lastCallout = '';
  private tierN: number;
  private bodyY = 0;
  dbg = '';

  constructor(d: BossDeps, tier = 1) {
    super(d, 'nile_crocodile', { name: 'Sebekhotep', title: 'Jaw of the Nile', hp: 3400 * tier, scale: 1, eyes: ['organic', 0xd8a828] });
    this.tierN = tier;
    this.radius = 1.25;
    this.flying = true; // he rides the river himself (wading, swimming, under)
    this.armor = 34;
    this.physRes = 0.12;
    this.magicRes = 0.1;
    this.statusRes = { bleed: 0.3, poison: 0.25 };
    this.bounty = 400 * tier;
    this.gold = 150 * tier;
    this.phases = [0.66, 0.33];
    this.hitSpheres = [
      { node: 'head', offset: [0, 0.42, 0.42], r: 0.72, part: 'head', weak: 1.5 },
      { node: 'head', offset: [0, 0.22, 1.1], r: 0.48, part: 'head', weak: 1.5 },
      { node: 'torso', offset: [0, 0.48, 0.22], r: 0.9, part: 'torso' },
      { node: 'pelvis', offset: [0, -0.05, 0.1], r: 0.72, part: 'pelvis' },
      { node: 'tail1', offset: [0, -0.12, -0.32], r: 0.5, part: 'tail' },
      { node: 'tail2', offset: [0, -0.12, -0.3], r: 0.4, part: 'tail' },
    ];
    this.shots = new WaterShots(d.ctx, d.player);
    this.shots.murk = 0.3;
    if (!d.enemies.qte) d.enemies.qte = d.qte;
    this.setExpr('angry');
  }

  protected hitKind() {
    return 'flesh' as any;
  }

  // ------------------------------------------------------------------ the river
  private get water(): WaterLike | null {
    const w = (this.ctx.world as unknown as { water?: WaterLike | null }).water;
    return w && typeof w.heightAt === 'function' ? w : null;
  }
  private bed(x: number, z: number) {
    return this.ctx.world.field.heightAt(x, z);
  }
  /** water surface where there is river here, else null */
  private riverY(x: number, z: number): number | null {
    const w = this.water;
    if (!w) return null;
    const h = w.heightAt(x, z);
    return h > this.bed(x, z) + 0.15 ? h : null;
  }
  private deep(x: number, z: number, d = 1.2) {
    const w = this.water;
    if (!w) return false;
    return w.isWater ? w.isWater(x, z, d) : w.heightAt(x, z) - this.bed(x, z) > d;
  }
  private surfaceAt(x: number, z: number) {
    return Math.max(this.riverY(x, z) ?? -1e9, this.ctx.world.groundAt(x, z));
  }
  /** spray where it is wet, sand where it is not */
  private burst(x: number, z: number, power = 1) {
    const ry = this.riverY(x, z);
    if (ry !== null) {
      this.water?.splash?.(x, z, power);
      this.shots.splash(x, ry, z, power);
    } else {
      const g = this.ctx.world.groundAt(x, z);
      this.ctx.fx.sandBurst({ x, y: g, z }, power);
      this.ctx.fx.dust({ x, y: g + 0.2, z }, power, 0xe6cf9f, 4);
    }
  }

  // ------------------------------------------------------------------ helpers
  private get warn() {
    return this.d.enemies.warn;
  }
  private get haste() {
    return (1 - this.phase * 0.12) * (1 - (this.tierN - 1) * 0.07) * (this.enraged ? 0.85 : 1);
  }
  private callout(song: string, big = true) {
    this.dbg = song;
    const pos = { x: this.pos.x, y: this.pos.y + this.height + 0.8, z: this.pos.z };
    this.d.enemies.callout(song, pos, 'boss');
    this.ctx.events.emit('enemySkill', { title: song, enemy: this, pos, tier: 'boss' });
    if (big && song !== this.lastCallout) {
      this.lastCallout = song;
      this.ctx.toast(`« ${song} »`, COL, 'Sebekhotep');
      this.ctx.engine.tweens.after(2, () => (this.lastCallout = ''));
    }
  }
  private sock(name: string, out: THREE.Vector3) {
    const s = this.rig.sockets[name];
    this.root.updateMatrixWorld(true);
    if (s) s.getWorldPosition(out);
    else out.set(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z);
    return out;
  }
  private predicted(t: number) {
    const v = this.player.board.vel;
    return this.playerPos().clone().addScaledVector(_w.set(v.x, 0, v.z), t);
  }
  private openUp(dur = 2.6) {
    this.exposedT = dur;
    const top = { x: this.pos.x, y: this.pos.y + this.height + 0.6, z: this.pos.z };
    this.d.enemies.callout('OPENING!', top, 'elite');
    this.ctx.sfx('counter_clang', this.pos, 0.8, 0.6);
    this.ctx.fx.sparkle(top, 0xffd36b, 18, 1.6);
    this.setExpr('stunned');
  }
  private roar(pitch = 0.7) {
    this.jawT = 1;
    this.ctx.sfx('boss_roar', this.pos, 1, pitch);
    this.ctx.shake(0.35);
    const m = this.sock('mouth', new THREE.Vector3());
    this.ctx.particles.emit({ pos: m, count: 12, vel: { x: Math.sin(this.yaw) * 4, y: 1.4, z: Math.cos(this.yaw) * 4 }, spread: 2, gravity: 9, life: [0.4, 0.9], size: [0.12, 0.05], sprite: ['dot3', 'dot4', 'bubble'], color: RIVER, drag: 0.6 });
  }
  private async dodge(from: { x: number; z: number }, inZone: () => boolean, up = false) {
    const dg = this.d.enemies.dodge;
    if (!dg.qte) dg.qte = this.d.qte;
    if (!inZone() || !dg.ready()) return false;
    const r = await dg.offer({ from, up });
    this.check();
    return r === 'good' || r === 'perfect';
  }
  /** a telegraph: most of the wind-up, a QTE dodge offer if the hunter stands in the danger, the rest */
  private async windup(W: number, from: { x: number; z: number }, inZone: () => boolean, up = false) {
    await this.wait(W * 0.65);
    const dodged = await this.dodge(from, inZone, up);
    if (!dodged) await this.wait(W * 0.35);
    return dodged;
  }
  /** a point near the hunter that is still inside the storm */
  private safe(x: number, z: number, margin = 6) {
    const st = this.ctx.world.storm;
    if (st.sdf(x, z) > margin) return { x, z };
    const p = this.playerPos();
    return { x: (x + p.x) / 2, z: (z + p.z) / 2 };
  }

  // ------------------------------------------------------------------ intro: "Coma"
  async intro() {
    const ctx = this.ctx, cam = this.d.cam;
    ctx.engine.letterbox(true, 0.5);
    this.invulnerable = true;
    this.under = 1;
    this.underT = 1;
    this.swim = 1;
    this.swimT = 1;
    const pp = this.playerPos().clone();
    const toB = new THREE.Vector3(this.pos.x - pp.x, 0, this.pos.z - pp.z);
    const dist = Math.max(8, toB.length());
    toB.normalize();
    const side = new THREE.Vector3(toB.z, 0, -toB.x);
    // a low shot over the water, the hunter in the foreground
    const camAt = pp.clone().addScaledVector(toB, -4.5).addScaledVector(side, 2.6);
    camAt.y = this.surfaceAt(camAt.x, camAt.z) + 1.6;
    cam.setCine({ pos: camAt, look: pp.clone().addScaledVector(toB, dist * 0.6).setY(this.surfaceAt(pp.x, pp.z) + 0.8), fov: 52 });
    ctx.sfx('quake_rumble', pp, 0.8, 0.5);
    // the wake circles the hunter twice, closing in
    const R0 = Math.min(16, dist), a0 = Math.atan2(toB.x, toB.z);
    for (let t = 0; t < 2.6; t += 0.05) {
      const k = t / 2.6;
      const a = a0 + k * Math.PI * 2.2;
      const R = R0 * (1 - k * 0.35);
      const x = pp.x + Math.sin(a) * R, z = pp.z + Math.cos(a) * R;
      const vx = (x - this.pos.x) / 0.05, vz = (z - this.pos.z) / 0.05;
      this.pos.x = x;
      this.pos.z = z;
      this.yaw = Math.atan2(vx, vz);
      this.water?.wake?.(x, z, vx, vz, 2.2);
      if (rnd.chance(0.5)) ctx.fx.bubbles({ x, y: this.surfaceAt(x, z) + 0.05, z }, 2);
      if (rnd.chance(0.25)) ctx.particles.emit({ pos: { x, y: this.surfaceAt(x, z) + 0.1, z }, count: 2, vel: { x: 0, y: 1.2, z: 0 }, spread: 1.2, gravity: 8, life: [0.3, 0.6], size: [0.1, 0.05], sprite: ['dot3', 'bubble'], color: RIVER });
      await this.wait(0.05);
    }
    // the river boils in front of the hunter
    const at = pp.clone().addScaledVector(toB, 10);
    const sp = this.safe(at.x, at.z);
    this.pos.set(sp.x, this.pos.y, sp.z);
    this.faceTarget(pp);
    for (let t = 0; t < 1.0; t += 0.1) {
      ctx.fx.bubbles({ x: sp.x + (rnd.next() - 0.5) * 4, y: this.surfaceAt(sp.x, sp.z), z: sp.z + (rnd.next() - 0.5) * 4 }, 4);
      if (rnd.chance(0.4)) this.burst(sp.x + (rnd.next() - 0.5) * 3, sp.z + (rnd.next() - 0.5) * 3, 0.6);
      await this.wait(0.1);
    }
    // BREACH: up out of the river in a spinning roll, then down into the shallows
    this.callout('Coma');
    ctx.sfx('explosion_big', this.pos, 0.8, 0.5);
    this.burst(this.pos.x, this.pos.z, 2.6);
    ctx.shake(0.6);
    const T = 1.3;
    this.swimT = 0;
    for (let t = 0; t <= T; t += 0.035) {
      const k = t / T;
      this.underT = 0;
      this.under = Math.max(0, 1 - k * 2.2);
      this.liftO = Math.sin(k * Math.PI) * 5.5;
      this.pitchO = (1 - k) * 0.9;
      this.rollO = k * Math.PI * 2;
      this.jawT = 1;
      if (k > 0.25 && k < 0.65) cam.setCine({ pos: camAt, look: new THREE.Vector3(this.pos.x, this.pos.y + this.liftO + 2, this.pos.z), fov: 46 });
      if (rnd.chance(0.6)) ctx.particles.emit({ pos: { x: this.pos.x, y: this.pos.y + this.liftO + 1, z: this.pos.z }, count: 3, vel: { x: 0, y: -1, z: 0 }, spread: 2.2, gravity: 14, life: [0.4, 0.8], size: [0.12, 0.05], sprite: ['dot3', 'dot4'], color: RIVER, ground: true });
      await this.wait(0.035);
    }
    this.liftO = 0;
    this.pitchO = 0;
    this.rollO = 0;
    this.burst(this.pos.x, this.pos.z, 2.4);
    ctx.sfx('explosion', this.pos, 1, 0.5);
    ctx.shake(0.9);
    if (this.distToPlayer() < 7) this.player.board.impulse.add(_w.set(this.player.pos.x - this.pos.x, 0, this.player.pos.z - this.pos.z).normalize().multiplyScalar(11).setY(5));
    // the close-up: the roar, the glaive slammed into the river
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const face = this.sock('mouth', new THREE.Vector3());
    const close = face.clone().addScaledVector(fwd, 6.5).addScaledVector(side, 2.6);
    close.y = Math.max(face.y + 0.6, this.surfaceAt(close.x, close.z) + 1.2);
    cam.setCine({ pos: close, look: face.clone().add(new THREE.Vector3(0, 0.4, 0)), fov: 44 });
    this.roar(0.62);
    this.anim.wind = 1;
    this.taunt('The Queen fed me her enemies for a thousand floods. You are a snack.', COL);
    ctx.events.emit('bossIntro', this);
    await this.wait(1.0);
    this.anim.wind = 0;
    this.anim.strike = 1;
    this.burst(this.pos.x + fwd.x * 3, this.pos.z + fwd.z * 3, 1.6);
    ctx.shake(0.5);
    await this.wait(1.4);
    cam.setCine(null);
    ctx.engine.letterbox(false, 0.5);
    this.invulnerable = false;
    this.jawT = 0;
    ctx.toast('SEBEKHOTEP', COL, 'Aim for the head. Dodge the bite, then hit him while he is open.', true);
  }

  // ------------------------------------------------------------------ fight loop
  protected async fight() {
    let last = '';
    while (true) {
      this.check();
      if (this.phase >= 1 && !this.calledBoat) {
        this.calledBoat = true;
        await this.allDownTheLine();
      }
      const d = this.distToPlayer();
      const wet = this.deep(this.pos.x, this.pos.z, 1.0) || this.deep(this.player.pos.x, this.player.pos.z, 1.0);
      const pool: [string, number][] = [
        ['undercover', wet ? 3 : 1.4],
        ['roll', d < 16 ? 2.4 : 1],
        ['tail', d < 8 ? 3 : 0.4],
        ['rain', 1.6],
        ['bite', d < 12 ? 2 : 0.8],
        ['spit', d > 8 ? 1.6 : 0.6],
      ];
      const opts = pool.filter(([k]) => k !== last);
      const k = rnd.weighted(opts, (o) => o[1])[0];
      last = k;
      if (k === 'undercover') await this.undercover();
      else if (k === 'roll') await this.letItBleed();
      else if (k === 'tail') await this.shattered();
      else if (k === 'rain') await this.rain();
      else if (k === 'bite') await this.badObsession();
      else await this.yerBlues();
      if (!this.enraged) await this.stalk(1.0 * this.haste);
      else await this.wait(0.3);
    }
  }

  /** wade toward a flank of the hunter */
  private async stalk(t: number) {
    const pp = this.playerPos();
    const a = Math.atan2(this.pos.x - pp.x, this.pos.z - pp.z) + (rnd.next() - 0.5) * 1.6;
    const R = 7 + rnd.next() * 4;
    const p = this.safe(pp.x + Math.sin(a) * R, pp.z + Math.cos(a) * R);
    await this.moveTo(p.x, p.z, this.deep(this.pos.x, this.pos.z) ? 9 : 7, t + 0.6);
    this.stop();
    this.faceTarget(this.playerPos());
    await this.wait(0.25 * this.haste);
  }

  /** "Undercover of the Night": dive, a V of ripples hunts the hunter, the jaws come up through a ring */
  private async undercover() {
    const ctx = this.ctx;
    this.callout('Undercover of the Night');
    this.stop();
    this.roar(0.9);
    this.swimT = 1;
    this.underT = 1;
    this.burst(this.pos.x, this.pos.z, 1.6);
    await this.wait(0.6);
    const hunt = 2.4 + rnd.next() * 1.2;
    for (let t = 0; t < hunt; t += 0.05) {
      const p = this.predicted(0.5);
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const sp = Math.min(d, (13 + this.phase * 2) * 0.05);
      const vx = (dx / d) * sp / 0.05, vz = (dz / d) * sp / 0.05;
      this.pos.x += (dx / d) * sp;
      this.pos.z += (dz / d) * sp;
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 8, 0.05);
      this.water?.wake?.(this.pos.x, this.pos.z, vx, vz, 2);
      if (rnd.chance(0.6)) ctx.fx.bubbles({ x: this.pos.x, y: this.surfaceAt(this.pos.x, this.pos.z) + 0.05, z: this.pos.z }, 2);
      if (this.riverY(this.pos.x, this.pos.z) === null && rnd.chance(0.5)) ctx.fx.sandSpray({ x: this.pos.x, y: ctx.world.groundAt(this.pos.x, this.pos.z), z: this.pos.z }, { x: 0, y: 1, z: 0 }, 1.2);
      if (d < 2.5) break;
      await this.wait(0.05);
    }
    // the ring opens under the hunter
    const at = this.player.pos.clone();
    const W = 0.85 * this.haste;
    this.warn.circle(at.x, at.z, 3.2, W, 'grab');
    ctx.sfx('quake_rumble', at, 0.7, 0.9);
    const dodged = await this.windup(W, at, () => Math.hypot(this.player.pos.x - at.x, this.player.pos.z - at.z) < 3.4, true);
    this.pos.set(at.x, this.pos.y, at.z);
    this.underT = 0;
    this.swimT = 0;
    this.under = 0.2;
    this.liftO = 2.6;
    this.jawT = 1;
    this.burst(at.x, at.z, 2.6);
    ctx.sfx('explosion', at, 0.9, 0.6);
    ctx.shake(0.6);
    const pd = Math.hypot(this.player.pos.x - at.x, this.player.pos.z - at.z);
    if (!dodged && pd < 3.4 && this.player.pos.y < this.surfaceAt(at.x, at.z) + 3) {
      this.player.takeHit({ base: 34, kind: 'phys', source: 'contact', knock: 12, status: [{ id: 'bleed', stacks: 2, dur: 4 }] }, at);
      this.player.board.impulse.add(_w.set(0, 9, 0));
    }
    for (let t = 0; t < 0.6; t += 0.05) {
      this.liftO = damp(this.liftO, 0, 6, 0.05);
      await this.wait(0.05);
    }
    this.liftO = 0;
    this.jawT = 0;
    if (dodged) this.openUp(2.4);
    await this.wait(0.5 * this.haste);
  }

  /** "Let It Bleed": the death roll */
  private async letItBleed() {
    const ctx = this.ctx;
    this.callout('Let It Bleed');
    this.faceTarget(this.playerPos());
    this.stop();
    this.setExpr('enraged');
    this.jawT = 1;
    this.anim.wind = 0.6;
    const W = 0.9 * this.haste;
    const pp = this.playerPos();
    const dir = new THREE.Vector3(pp.x - this.pos.x, 0, pp.z - this.pos.z);
    const len = Math.min(16, dir.length() + 3);
    dir.normalize();
    this.warn.lane(this.pos.x, this.pos.z, dir.x, dir.z, len, 2.6, W, 'grab');
    ctx.sfx('giant_scorpion_hiss', this.pos, 0.8, 0.5);
    const inLane = () => {
      const px = this.player.pos.x - this.pos.x, pz = this.player.pos.z - this.pos.z;
      const along = px * dir.x + pz * dir.z, across = Math.abs(px * dir.z - pz * dir.x);
      return along > 0 && along < len && across < 1.6;
    };
    const dodged = await this.windup(W, this.pos, inLane);
    this.anim.wind = 0;
    // the lunge: flat along the river, jaws first
    const from = this.pos.clone();
    let caught = false;
    for (let t = 0; t < 0.45; t += 0.03) {
      const k = t / 0.45;
      this.pos.x = from.x + dir.x * len * k;
      this.pos.z = from.z + dir.z * len * k;
      this.pitchO = Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) * 1.35;
      if (rnd.chance(0.5)) this.burst(this.pos.x, this.pos.z, 0.6);
      if (!dodged && !caught && this.player.alive) {
        const m = this.sock('mouth', _v);
        if (Math.hypot(this.player.pos.x - m.x, this.player.pos.z - m.z) < 2.0 && Math.abs(this.player.pos.y - m.y) < 2.6) caught = true;
      }
      await this.wait(0.03);
    }
    if (!caught) {
      this.pitchO = 1.35;
      this.burst(this.pos.x, this.pos.z, 1.4);
      await this.wait(0.35);
      this.pitchO = 0;
      this.jawT = 0;
      if (dodged) this.openUp(2.8);
      await this.wait(0.6 * this.haste);
      return;
    }
    // caught: he rolls with the hunter in his jaws
    this.holding = true;
    ctx.toast('DEATH ROLL!', '#ff6a3a', 'Mash E to break his grip', true);
    ctx.sfx('hit_flesh', this.player.pos, 1, 0.7);
    let broke = false;
    let spin = true;
    void (async () => {
      while (spin && this.alive) {
        this.rollO += 0.55;
        if (rnd.chance(0.5)) this.burst(this.pos.x + (rnd.next() - 0.5) * 2, this.pos.z + (rnd.next() - 0.5) * 2, 0.9);
        if (Math.floor(this.rollO / Math.PI) !== Math.floor((this.rollO - 0.55) / Math.PI)) {
          this.player.takeHit({ base: 7, kind: 'phys', source: 'contact', knock: 0, status: [{ id: 'bleed', stacks: 1, dur: 3 }] }, this.pos);
          ctx.shake(0.2);
        }
        await ctx.engine.tweens.wait(0.04);
      }
    })();
    try {
      const r = await this.qte({ kind: 'mash', key: 'KeyE', label: 'BREAK FREE', duration: 2.2, target: 12 + this.phase * 2 });
      broke = r !== 'fail';
    } finally {
      spin = false;
      this.holding = false;
    }
    this.rollO = 0;
    this.pitchO = 0;
    this.jawT = 0;
    const away = _w.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.player.board.impulse.add(away.clone().multiplyScalar(broke ? 9 : 14).setY(broke ? 5 : 7));
    if (broke) {
      ctx.toast('BROKE FREE', '#ffd36b', 'He is reeling: hit him now', true);
      this.takeDamage({ base: this.maxHp * 0.04, kind: 'phys', source: 'counter', canCrit: false });
      this.openUp(3.2);
    } else this.player.takeHit({ base: 18, kind: 'phys', source: 'contact', knock: 6 }, this.pos);
    await this.wait(0.8 * this.haste);
  }

  /** "Shattered": the tail sweeps a wide wedge */
  private async shattered() {
    const ctx = this.ctx;
    this.callout('Shattered');
    this.stop();
    const pp = this.playerPos();
    const to = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
    const W = 0.85 * this.haste;
    this.warn.wedge(this.pos.x, this.pos.z, to, 6.5, 2.2, W, 'heavy');
    this.tailSweep = 0.6;
    ctx.sfx('whoosh_big', this.pos, 0.8, 0.6);
    const dodged = await this.windup(W, this.pos, () => this.distToPlayer() < 6.8, true);
    // one full turn, the tail out flat
    const y0 = this.yaw;
    let hit = false;
    for (let t = 0; t <= 0.55; t += 0.03) {
      const k = t / 0.55;
      this.yaw = y0 + Math.PI + k * Math.PI * 2;
      this.tailSweep = 1;
      this.burst(this.pos.x - Math.sin(this.yaw) * 4, this.pos.z - Math.cos(this.yaw) * 4, 0.5);
      if (!hit && !dodged && this.distToPlayer() < 6.6 && this.player.pos.y < this.pos.y + 2.5) {
        hit = true;
        const out = _w.set(this.player.pos.x - this.pos.x, 0, this.player.pos.z - this.pos.z).normalize();
        this.player.takeHit({ base: 24, kind: 'phys', source: 'contact', knock: 14 }, this.pos);
        this.player.board.impulse.add(out.multiplyScalar(13).setY(4));
        ctx.shake(0.45);
      }
      await this.wait(0.03);
    }
    this.yaw = y0;
    this.tailSweep = 0;
    if (dodged) this.openUp(2.2);
    await this.wait(0.5 * this.haste);
  }

  /** "Rain": the glaive comes down, geysers march at the hunter */
  private async rain() {
    const ctx = this.ctx;
    this.callout('Rain');
    this.stop();
    this.faceTarget(this.playerPos());
    this.anim.wind = 1;
    await this.wait(0.55 * this.haste);
    this.anim.wind = 0;
    this.anim.strike = 1;
    const tip = this.sock('blade_tip', new THREE.Vector3());
    this.burst(tip.x, tip.z, 1.6);
    ctx.shake(0.4);
    ctx.sfx('explosion', tip, 0.7, 0.7);
    const n = 6 + this.phase * 2 + (this.enraged ? 2 : 0);
    const from = this.pos.clone();
    for (let i = 0; i < n; i++) {
      const p = this.predicted(0.9);
      const k = (i + 1) / n;
      const x = from.x + (p.x - from.x) * Math.min(1, k * 1.15) + (rnd.next() - 0.5) * 2;
      const z = from.z + (p.z - from.z) * Math.min(1, k * 1.15) + (rnd.next() - 0.5) * 2;
      const W = 0.8;
      this.warn.circle(x, z, 2.4, W, 'heavy');
      ctx.engine.tweens.after(W, () => {
        if (!this.alive) return;
        this.geyser(x, z);
      });
      await this.wait(0.24 * this.haste);
    }
    await this.wait(0.8 * this.haste);
  }
  private geyser(x: number, z: number) {
    const ctx = this.ctx;
    const y = this.surfaceAt(x, z);
    const wet = this.riverY(x, z) !== null;
    ctx.particles.emit({ pos: { x, y: y + 0.2, z }, count: 34, vel: { x: 0, y: 11, z: 0 }, spread: 1.0, gravity: 16, drag: 0.2, life: [0.8, 1.3], size: [0.18, 0.07], sprite: ['dot3', 'dot4', wet ? 'bubble' : 'pebble'], color: wet ? RIVER : SAND, ground: true, jitter: 0.4 });
    ctx.particles.emit({ pos: { x, y: y + 1.5, z }, count: 6, spread: 0.8, up: 4, life: [0.8, 1.4], size: [0.8, 1.8], sprite: ['puff0', 'puff1', 'puff2'], color: wet ? [0xf0fbff, 0xd0eef0] : [0xe8d0a0, 0xd8b880], alpha: 0.55, drag: 1.4, rot: 6, rotSpeed: 0.5 });
    this.burst(x, z, 1.2);
    ctx.sfx('sand_burst', { x, y, z }, 0.6, 0.7);
    const pl = this.player;
    if (Math.hypot(pl.pos.x - x, pl.pos.z - z) < 2.5 && pl.pos.y < y + 3) {
      pl.takeHit({ base: 16, kind: 'phys', source: 'contact', knock: 4 }, new THREE.Vector3(x, y, z));
      pl.board.impulse.add(_w.set(0, 11, 0));
    }
  }

  /** "Bad Obsession": three snapping lunges */
  private async badObsession() {
    const ctx = this.ctx;
    this.callout('Bad Obsession');
    this.stop();
    for (let i = 0; i < 3; i++) {
      this.faceTarget(this.playerPos());
      const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const W = (i === 0 ? 0.6 : 0.42) * this.haste;
      this.warn.lane(this.pos.x, this.pos.z, dir.x, dir.z, 6.5, 2.4, W, 'tell');
      this.jawT = 0.4;
      await this.wait(W);
      this.jawT = 1;
      const from = this.pos.clone();
      let bit = false;
      for (let t = 0; t <= 0.2; t += 0.03) {
        const k = t / 0.2;
        this.pos.x = from.x + dir.x * 4 * k;
        this.pos.z = from.z + dir.z * 4 * k;
        this.pitchO = Math.sin(k * Math.PI) * 0.45;
        if (!bit) {
          const m = this.sock('mouth', _v);
          if (Math.hypot(this.player.pos.x - m.x, this.player.pos.z - m.z) < 1.9 && Math.abs(this.player.pos.y - m.y) < 2.4) {
            bit = true;
            this.player.takeHit({ base: 14, kind: 'phys', source: 'contact', knock: 7, status: [{ id: 'bleed', stacks: 1, dur: 3 }] }, this.pos);
          }
        }
        await this.wait(0.03);
      }
      ctx.sfx('punch', this.pos, 0.9, 0.55);
      this.jawT = 0;
      this.pitchO = 0;
      this.burst(this.pos.x + dir.x * 2.5, this.pos.z + dir.z * 2.5, 0.8);
    }
    await this.wait(0.6 * this.haste);
  }

  /** "Yer Blues": a fan of river-water slugs */
  private async yerBlues() {
    this.callout('Yer Blues');
    this.stop();
    this.faceTarget(this.playerPos());
    this.jawT = 0.5;
    this.ctx.sfx('giant_scorpion_hiss', this.pos, 0.7, 0.7);
    await this.wait(0.5 * this.haste);
    const waves = 2 + (this.phase >= 2 ? 1 : 0);
    for (let w = 0; w < waves; w++) {
      this.jawT = 1;
      const m = this.sock('mouth', new THREE.Vector3());
      const target = this.playerPos().clone().setY(this.player.pos.y + 0.8);
      this.shots.fan(m, target, 5 + this.phase, 0.9, { speed: 17, dmg: 9, knock: 7, r: 0.34 });
      this.ctx.sfx('poison_burst', m, 0.6, 0.7);
      await this.wait(0.45);
      this.jawT = 0.3;
    }
    this.jawT = 0;
    await this.wait(0.5 * this.haste);
  }

  /** "All Down the Line": he calls a reed skiff of the Queen's soldiers */
  private async allDownTheLine() {
    this.callout('All Down the Line');
    this.roar(0.8);
    this.anim.wind = 1;
    await this.wait(0.6);
    this.anim.wind = 0;
    const pp = this.playerPos();
    for (let i = 0; i < 2; i++) {
      const a = rnd.next() * Math.PI * 2;
      const x = pp.x + Math.sin(a) * 26, z = pp.z + Math.cos(a) * 26;
      const got = this.d.enemies.spawn(i === 0 ? 'reedBoat' : 'nileWolf', x, z);
      if (!got && i === 0) for (let k = 0; k < 3; k++) this.d.enemies.spawn('nileWolf', x + k * 1.5, z);
    }
    await this.wait(0.8);
  }

  // ------------------------------------------------------------------ damage, phases
  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    if (this.under > 0.6 && hit.source !== 'poison' && hit.source !== 'bleed' && hit.source !== 'burn') return 0;
    const mult = this.exposedT > 0 ? 1.5 : 1;
    return super.takeDamage({ ...hit, mult: (hit.mult ?? 1) * mult }, point, dir);
  }
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (this.under > 0.6) return null;
    return super.hitTest(o, d, maxT);
  }
  protected onPhase(p: number) {
    super.onPhase(p);
    if (p >= 2 && !this.enraged) {
      this.enraged = true;
      this.callout('Estranged');
      this.taunt('You made me remember the drought. Now the river runs red.', '#ff7a3a');
      // the enraged eyes and burning sun disc
      const e = modelEntry('nile_crocodile_enraged')?.() as RigSpec | undefined;
      if (e?.parts) this.swapRig(e);
    }
  }
  private swapRig(spec: RigSpec) {
    const old = this.rig;
    const geo = buildRigGeo(spec, 'boss:nile_crocodile_enraged');
    const rig = new RigInstance(geo, { ownMaterial: true });
    this.root.remove(old.root);
    old.material.dispose();
    this.rig = rig;
    this.root.add(rig.root);
    this.rig.setExpression('enraged');
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    if (!this.root.visible && !this.alive) return;
    this.exposedT = Math.max(0, this.exposedT - dt);
    this.under = damp(this.under, this.underT, 3.2, dt);
    this.swim = damp(this.swim, this.swimT || (this.deep(this.pos.x, this.pos.z, 1.9) ? 0.6 : 0), 3, dt);
    this.tailSwing += dt * (2 + this.swim * 4 + Math.hypot(this.vel.x, this.vel.z) * 0.4);
    // stand on the bed, wade in the shallows, float chest-deep where it is deep, sink when he dives
    const bed = this.ctx.world.groundAt(this.pos.x, this.pos.z);
    const ry = this.riverY(this.pos.x, this.pos.z);
    let y = bed;
    if (ry !== null) y = Math.max(bed, ry - Math.min(1.5, ry - this.bed(this.pos.x, this.pos.z)));
    y -= this.under * (this.height * 0.9 + (ry !== null ? 0.6 : 1.2));
    this.bodyY = damp(this.bodyY || y, y, 8, dt);
    this.pos.y = this.bodyY + this.liftO;
    super.update(dt);
    if (!this.root.visible) return;
    // whole-body overrides: lying along the river, rolling about the long axis
    const pitch = this.pitchO + this.swim * 1.15;
    if (pitch || this.rollO) {
      _e.set(pitch, this.rollO, 0, 'XYZ');
      _q.setFromEuler(_e);
      this.root.quaternion.multiply(_q);
    }
    // the river streams off him while he is half under
    if (this.under > 0.15 && this.under < 0.85 && rnd.chance(dt * 10) && ry !== null) this.ctx.fx.bubbles({ x: this.pos.x, y: ry + 0.05, z: this.pos.z }, 2);
    if (this.under > 0.5) this.water?.wake?.(this.pos.x, this.pos.z, this.vel.x, this.vel.z, 1.6);
    // a hunter caught in the death roll rides in the jaws
    if (this.holding && this.player.alive) {
      const m = this.sock('mouth', _v);
      const b = this.player.board;
      b.pos.x = m.x;
      b.pos.z = m.z;
      b.pos.y = Math.max(this.surfaceAt(m.x, m.z), m.y - 0.6);
      b.vel.set(0, 0, 0);
    }
    this.shots.update(dt);
  }

  protected animate(dt: number) {
    this.anim.jaw = damp(this.anim.jaw, this.jawT * 0.75, 12, dt);
    super.animate(dt);
    const n = this.rig.nodes;
    const t = this.tailSwing;
    // the tail: a lazy S that drives harder when swimming; out flat and stiff for the sweep
    for (let i = 1; i <= 4; i++) {
      const tl = n['tail' + i];
      if (!tl) continue;
      const amp = (0.1 + this.swim * 0.3) * (1 + i * 0.25) * (1 - this.tailSweep * 0.8);
      tl.rotation.y = Math.sin(t - i * 0.8) * amp + this.tailSweep * 0.12 * i;
      tl.rotation.x = -0.06 * i * (1 - this.swim) * (1 - this.tailSweep) + this.tailSweep * (i === 1 ? -0.5 : 0.05) + this.swim * 0.1;
    }
    // swimming: arms trail, legs kick
    if (this.swim > 0.02) {
      const s = this.swim;
      if (n['arm_l']) n['arm_l'].rotation.x = n['arm_l'].rotation.x * (1 - s) + 0.5 * s;
      if (n['arm_r']) n['arm_r'].rotation.x = n['arm_r'].rotation.x * (1 - s) + 0.4 * s;
      if (n['thigh_l']) n['thigh_l'].rotation.x = n['thigh_l'].rotation.x * (1 - s) + Math.sin(t * 1.3) * 0.35 * s;
      if (n['thigh_r']) n['thigh_r'].rotation.x = n['thigh_r'].rotation.x * (1 - s) - Math.sin(t * 1.3) * 0.35 * s;
      if (n['head']) n['head'].rotation.x -= 0.9 * s; // looks forward along the river
    }
    // stunned / exposed: sagging, the glaive dragging
    if (this.exposedT > 0 && n['torso']) {
      n['torso'].rotation.x += 0.35;
      if (n['head']) n['head'].rotation.z = Math.sin(this.t * 3) * 0.2;
    }
  }

  die() {
    if (!this.alive) return;
    this.holding = false;
    this.taunt('The river... remembers...', COL);
    this.underT = 1;
    this.swimT = 0;
    super.die();
  }

  dispose() {
    this.shots.clear();
    super.dispose();
  }
}

void clamp;
