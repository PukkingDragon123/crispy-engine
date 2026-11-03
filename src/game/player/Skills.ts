// Sundown's Serket kit: Pinch (shoulder companion that leaps to sting and helps
// reload), Scorpion Toss (E), Locust Swarm (C), Dung Bomb (G, bouncing physics
// grenade with a stink cloud).
// A new hunt starts with only the pistol: the three tarot skills are SEALED until
// learned from a rank-up card (run/Upgrades.ts `learn*` cards -> Skills.learn).
// `echo` (a quest reward) makes every cast repeat once ~0.3 s later.
//
//  E  Scorpion Toss: an arcing, venom-trailing throw of Pinch's brood (rigged little
//     scorpions). They aim for the bodies under and around the reticle, bite on
//     contact, ride the host stinging (venom numbers, frothing poison stacks), and
//     when the host dies the brood bursts off the corpse onto the next one.
//  C  Locust Swarm: a roaring flock (boids) of pixel locusts. Free, it hunts the
//     densest knot of enemies near you; hold C and it pours wherever you look.
//     Bodies it engulfs are shredded: flecks of linen / bone / chitin / blood
//     stripped off and whirled away.
//  G  Dung Bomb: a heavy, squashing, rolling ball with a sputtering fuse; the blast
//     throws a ground shockwave, tosses bodies off their feet and leaves a stink
//     cloud that doubles enemies over coughing.
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../Ctx';
import type { Player } from './Player';
import type { Enemies } from '../enemies/Enemies';
import { buildRigGeo, RigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { VoxelModel, vary } from '../../engine/voxel/VoxelModel';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { SpriteBatch } from '../fx/SpriteBatch';
import { modelEntry } from '../models/lookup';
import { P } from '../../engine/voxel/palette';
import { VF } from '../../engine/voxel/VoxelModel';
import { clamp, damp, dampAngle, rnd } from '../../engine/math/rand';
import { Input } from '../../engine/Input';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const TAU = Math.PI * 2;

export type SkillKey = 'E' | 'C' | 'G';
/** the three tarot skills: card title and skill name */
export const SKILL_INFO: Record<SkillKey, { card: string; name: string }> = {
  E: { card: 'THE MAGICIAN', name: 'Scorpion Toss' },
  C: { card: 'THE TOWER', name: 'Locust Swarm' },
  G: { card: 'THE SUN', name: 'Dung Bomb' },
};
/** has the running hunt learned this tarot skill? (keys that aren't sealable, like Z, always are) */
export function isSkillLearned(key: string) {
  const s = Skills.current;
  if (!s || !(key in SKILL_INFO)) return true;
  return s.learned.has(key as SkillKey);
}

/** skill tuning (damage numbers are before the magic / gun stat scaling) */
export const SKILL_TUNE = {
  brood: { scale: 0.8, max: 12, gravity: 22, seekSpeed: 10, biteDmg: 8, stingDmg: 6, stingEvery: 0.62, stingStacks: 2, life: 7, hatchLife: 4.5 },
  swarm: { bugs: 120, maxBugs: 260, dur: 8, dpsBase: 8, dpsPerBug: 1.2, dpsCap: 48, tick: 0.3, steerRange: 30, huntRange: 18 },
  bomb: { fuse: 1.7, radius: 4.2, dmg: 40, gravity: 20, cloudLife: 5.5, cloudTick: 0.45, coughChance: 0.6 },
};

/** what the skills need from a body beyond EnemyLike (enemies have these; bosses may not) */
type Foe = EnemyLike & { yaw?: number; state?: string; def?: { hitKind?: string }; anim?: { hidden?: boolean } };
type EnemyVerbs = Partial<Pick<Enemies, 'cough' | 'knockdown' | 'stagger'>>;

interface Brood {
  /** pooled rig (null when Pinch's rig is missing) */
  h: THREE.Group | null;
  rig: RigInstance | null;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  from: THREE.Vector3;
  yaw: number;
  state: 'fly' | 'seek' | 'pounce' | 'latched';
  target: EnemyLike | null;
  life: number;
  /** time in the current state */
  t: number;
  stingT: number;
  /** where it clings: angle around the host (relative to the host's facing) and height share */
  att: number;
  attH: number;
  /** tumble while thrown */
  spin: number;
  /** sting pump 0..1 (decays) */
  bite: number;
  gait: number;
}

interface Bomb {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  q: THREE.Quaternion;
  bounces: number;
  /** squash spring (world-vertical) */
  sq: number;
  sqV: number;
  sputter: number;
}

interface Cloud {
  pos: THREE.Vector3;
  r: number;
  life: number;
  t: number;
  tick: number;
}

interface Bug {
  p: THREE.Vector3;
  v: THREE.Vector3;
  /** phase on its own tilted orbit around the swarm core, speed (signed), orbit tilt, radius share */
  ph: number;
  sp: number;
  tilt: number;
  rr: number;
  tint: number;
  flap: number;
}

const BUG_TINTS = [0xffffff, 0xf2f6dc, 0xe0eab8, 0xd2dc9e, 0xfff0c8];

export class Skills {
  /** the hunt's live skill kit (HUD / cinematics read it) */
  static current: Skills | null = null;
  /** tarot skills learned this hunt (a new hunt starts with none) */
  learned = new Set<SkillKey>();
  /** quest reward: every cast repeats once ~0.3 s later */
  echo = false;
  private sealedNag = 0;
  scorpCd = 0;
  swarmCd = 0;
  bombCharges = 2;
  bombRecharge = 0;
  brood: Brood[] = [];
  bombs: Bomb[] = [];
  clouds: Cloud[] = [];
  swarmT = 0;
  swarmBugs: Bug[] = [];
  // brood rigs (Pinch's own rig, smaller) — pooled
  private broodGeo: RigGeo | null = null;
  private broodMat: VoxelMaterial;
  private broodFree: { h: THREE.Group; rig: RigInstance }[] = [];
  private deadHosts = new Map<number, { next: EnemyLike | null; hatched: boolean }>();
  // dung bombs
  private bombGeo: THREE.BufferGeometry;
  private bombFuse = new THREE.Vector3();
  private bombR = 0.16;
  private bombPool: { holder: THREE.Group; mesh: THREE.Mesh; mat: VoxelMaterial }[] = [];
  // locust swarm
  private bugBatch = new SpriteBatch(420);
  private swarmLoop: any = null;
  private swarmCore = new THREE.Vector3();
  private swarmGoal = new THREE.Vector3();
  private swarmPrey: EnemyLike | null = null;
  private swarmRetarget = 0;
  private swarmFade = 0;
  private swarmAge = 0;
  private shredT = new Map<number, number>();
  private shredSfxT = 0;
  private time = 0;
  // Pinch
  pinch: RigInstance | null = null;
  pinchRoot = new THREE.Group();
  pinchState: 'shoulder' | 'leap' | 'sting' | 'return' | 'reload' = 'shoulder';
  pinchT = 0;
  pinchCd = 2;
  pinchTarget: EnemyLike | null = null;
  private pinchFrom = new THREE.Vector3();
  private pinchPos = new THREE.Vector3();
  constants = { scorpCd: 7, swarmCd: 15, bombRecharge: 7 };

  constructor(private ctx: Ctx, private player: Player, private input: Input) {
    Skills.current = this;
    // the brood are Pinch's children: his rig, smaller, sharing one material
    const pe = modelEntry('pinch');
    const spec = pe?.() as RigSpec | undefined;
    this.broodMat = makeVoxelMaterial();
    if (spec?.parts) this.broodGeo = buildRigGeo(spec, 'pinch:player');
    // dung bomb visual
    const db = modelEntry('dung_bomb') ?? modelEntry('dungBomb');
    const r = db?.() as any;
    if (r?.model) this.bombGeo = buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: 'center' });
    else {
      const m = new VoxelModel('dungbomb');
      for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) for (let z = -4; z <= 4; z++) if (x * x + y * y * 1.1 + z * z <= 17) m.set(x, y, z, vary(0x6a4424, 0.08));
      m.box(0, 5, 0, 0, 6, 0, 0xd8c8a0);
      m.set(0, 7, 0, P.fire1, VF.EMISSIVE);
      this.bombGeo = buildVoxelGeometry(m, { voxelSize: 1 / 48, pivot: 'center' });
    }
    this.bombGeo.computeBoundingBox();
    const bb = this.bombGeo.boundingBox!;
    // the fuse tip sits at the top of the model, a little off-centre (smallItems: fuse leans +x)
    this.bombFuse.set(bb.max.x * 0.45, bb.max.y - 0.01, (bb.min.z + bb.max.z) * 0.5);
    this.bombR = Math.max(0.08, (bb.max.x - bb.min.x) * 0.5) * 1.7;
    ctx.scene.add(this.bugBatch.mesh);
    // Pinch
    if (spec?.parts) {
      this.pinch = new RigInstance(buildRigGeo(spec, 'pinch:player'));
      this.pinchRoot.add(this.pinch.root);
    }
    ctx.scene.add(this.pinchRoot);
  }

  get stats() {
    return this.player.stats;
  }

  private get foes() {
    return this.ctx.enemies as unknown as EnemyVerbs;
  }

  update(dt: number) {
    const inp = this.input;
    const cdr = 1 - this.stats.get('cdr');
    this.time += dt;
    this.scorpCd -= dt;
    this.swarmCd -= dt;
    if (this.bombCharges < 2) {
      this.bombRecharge -= dt;
      if (this.bombRecharge <= 0) {
        this.bombCharges++;
        this.bombRecharge = this.constants.bombRecharge * cdr;
      }
    }
    this.sealedNag -= dt;
    if (this.player.alive) {
      if (inp.hit('skill1')) this.tryCast('E');
      if (inp.hit('skill2')) this.tryCast('C');
      if (inp.hit('grenade')) this.tryCast('G');
    }
    this.updateBrood(dt);
    this.updateBombs(dt);
    this.updateClouds(dt);
    this.updateSwarm(dt);
    this.updatePinch(dt);
  }

  // ----------------------------------------------------------- learning, sealing, echo
  /** learn a tarot skill (from a rank-up card); `quiet` skips the fanfare (e.g. restoring a carried run) */
  learn(k: SkillKey, quiet = false) {
    if (this.learned.has(k)) return;
    this.learned.add(k);
    if (k === 'G') this.bombCharges = 2;
    if (quiet) return;
    const info = SKILL_INFO[k];
    const c = this.player.center(new THREE.Vector3());
    this.ctx.toast(`${info.card} AWAKENS`, '#c8ff5a', `${info.name}  ·  ${k}`, true);
    this.ctx.sfx('card_flip', null, 0.9);
    this.ctx.sfx('divine_chime', null, 0.7);
    this.ctx.fx.glyphs(c, 0x9dff3a, 10, 1.4);
    this.ctx.fx.sparkle(c, 0xffd36b, 12, 0.9);
    this.player.express('smug', 1.2);
  }

  private tryCast(k: SkillKey) {
    if (!this.learned.has(k)) {
      if (this.sealedNag <= 0) {
        this.sealedNag = 1.2;
        this.ctx.sfx('ui_error', null, 0.5);
        this.ctx.toast(`${SKILL_INFO[k].card} IS SEALED`, '#d8c8a8', 'Earn it at a bounty rank-up');
      }
      return;
    }
    if (k === 'E' && this.scorpCd <= 0) this.tossScorpions();
    else if (k === 'C' && this.swarmCd <= 0) this.summonSwarm();
    else if (k === 'G' && this.bombCharges > 0) this.throwBomb();
    else return;
    if (this.echo) this.ctx.engine.tweens.after(0.3, () => this.echoCast(k));
  }

  /** the echo: the same skill again, free, with a jade shimmer */
  private echoCast(k: SkillKey) {
    if (!this.player.alive) return;
    const c = this.player.center(new THREE.Vector3());
    this.ctx.fx.sparkle(c, 0x9dff3a, 10, 0.7);
    this.ctx.sfx('divine_chime', c, 0.35, 1.4);
    if (k === 'E') this.tossScorpions(true);
    else if (k === 'C') this.summonSwarm(true);
    else this.throwBomb(true);
  }

  /** cast feedback: a short camera nudge (pitch / yaw rad, fov kick deg) */
  private castKick(pitch: number, yaw: number, fov: number) {
    this.player.cam.punch(pitch, yaw, fov, yaw * 0.7);
    this.player.cam.addTrauma(0.05);
  }

  /** world point of one of Sundown's hand sockets (falls back to the chest) */
  private handPoint(name: string, out: THREE.Vector3) {
    const s = this.player.rig.sockets[name];
    if (s) return s.getWorldPosition(out);
    return this.player.center(out).add(_v3.set(0, 0.35, 0));
  }

  private hiddenFoe(e: EnemyLike) {
    const f = e as Foe;
    return f.state === 'hidden' || f.state === 'burrow' || !!f.anim?.hidden;
  }

  /** a ballistic velocity from `o` landing on `to` after T seconds under gravity g */
  private lob(o: THREE.Vector3, to: THREE.Vector3, T: number, g: number, out: THREE.Vector3) {
    return out.set((to.x - o.x) / T, (to.y - o.y + 0.5 * g * T * T) / T, (to.z - o.z) / T);
  }

  // ===================================================================== SCORPION TOSS
  tossScorpions(echo = false) {
    const n = 2 + Math.round(this.stats.get('scorpions'));
    if (!echo) this.scorpCd = this.constants.scorpCd * (1 - this.stats.get('cdr'));
    const pl = this.player;
    pl.playAction('throw', 0.5);
    pl.express('determined', 0.6);
    this.ctx.sfx('scorpion_chitter', pl.pos, 0.6, 1.1);
    // the brood leave the hand at the release of the throw
    this.ctx.engine.tweens.after(0.19, () => this.releaseBrood(n, echo));
  }

  private releaseBrood(n: number, echo: boolean) {
    const pl = this.player;
    if (!pl.alive) return;
    const ctx = this.ctx;
    const B = SKILL_TUNE.brood;
    const o = this.handPoint('hand_l', new THREE.Vector3());
    const aim = pl.aimPoint.clone();
    let dx = aim.x - o.x, dz = aim.z - o.z;
    let d = Math.hypot(dx, dz) || 1;
    if (d > 30) {
      aim.x = o.x + (dx / d) * 30;
      aim.z = o.z + (dz / d) * 30;
      d = 30;
    }
    aim.y = ctx.world.groundAt(aim.x, aim.z);
    dx /= d;
    dz /= d;
    // targets: the body under the reticle first, then the nearest bodies around the aim point
    const picks: EnemyLike[] = [];
    const under = pl.aimHit?.enemy;
    if (under && under.alive && !under.flying) picks.push(under);
    const near: { e: EnemyLike; d: number }[] = [];
    for (const e of ctx.enemies.list) {
      if (!e.alive || e.flying || e === under || this.hiddenFoe(e)) continue;
      const de = Math.hypot(e.pos.x - aim.x, e.pos.z - aim.z);
      if (de < 6.5) near.push({ e, d: de });
    }
    near.sort((a, b) => a.d - b.d);
    for (const x of near) picks.push(x.e);
    for (let i = 0; i < n; i++) {
      const host = picks.length ? picks[i % picks.length] : null;
      const T = clamp(0.36 + d / 28, 0.42, 1.2) + i * 0.035;
      const to = new THREE.Vector3();
      if (host) to.set(host.pos.x + host.vel.x * T * 0.5, host.pos.y + host.height * 0.55, host.pos.z + host.vel.z * T * 0.5);
      else {
        // nothing there: a fan of brood across the aim point, ready to hunt
        const lat = (i - (n - 1) / 2) * 1.1 + (echo ? 0.55 : 0);
        to.set(aim.x - dz * lat, 0, aim.z + dx * lat);
        to.y = ctx.world.groundAt(to.x, to.z);
      }
      const b = this.newBrood(o, B.life + this.stats.get('magic') * 0.2);
      if (!b) break;
      this.lob(o, to, T, B.gravity, b.vel);
      b.target = host;
      b.yaw = Math.atan2(b.vel.x, b.vel.z);
    }
    // the throw: whoosh + chitter, a smear off the hand, a spray of venom, a nudge of the view
    ctx.sfx('scorpion_throw', o, 0.95);
    ctx.sfx('whoosh', o, 0.55, 1.25);
    pl.smear(o.clone(), 1.3);
    ctx.particles.emit({ pos: o, count: 8, vel: { x: dx * 4, y: 2, z: dz * 4 }, spread: 2, life: [0.25, 0.5], size: [0.07, 0.03], sprite: ['dot3', 'ichor'], color: [0xc8ff5a, 0x9dff3a], gravity: 9, drag: 1.5 });
    this.castKick(0.014, 0.012, 1.1);
  }

  /** a new brood scorpion at `o` (oldest one is recycled at the cap) */
  private newBrood(o: THREE.Vector3, life: number): Brood | null {
    const B = SKILL_TUNE.brood;
    if (this.brood.length >= B.max) this.dropBrood(0, true);
    let slot = this.broodFree.pop() ?? null;
    if (!slot && this.broodGeo) {
      const rig = new RigInstance(this.broodGeo, { material: this.broodMat, castShadow: false });
      const h = new THREE.Group();
      rig.root.scale.setScalar(B.scale);
      rig.root.position.y = -0.06; // tumbles about the body, not the feet
      h.add(rig.root);
      this.ctx.scene.add(h);
      slot = { h, rig };
    }
    if (slot) slot.h.visible = true;
    const b: Brood = { h: slot?.h ?? null, rig: slot?.rig ?? null, pos: o.clone(), vel: new THREE.Vector3(), from: new THREE.Vector3(), yaw: 0, state: 'fly', target: null, life, t: 0, stingT: 0, att: 0, attH: 0.5, spin: rnd.next() * TAU, bite: 0, gait: rnd.next() };
    this.brood.push(b);
    return b;
  }

  private dropBrood(i: number, burrow: boolean) {
    const b = this.brood[i];
    if (burrow) {
      this.ctx.fx.sandBurst(b.pos, 0.25);
      this.ctx.particles.emit({ pos: b.pos, count: 4, spread: 1.4, up: 1.2, life: [0.25, 0.5], size: [0.05, 0.03], sprite: ['grain0', 'dot3'], color: [0xe0c08a, 0xc9a06a], gravity: 12, ground: true });
    }
    if (b.h && b.rig) {
      b.h.visible = false;
      this.broodFree.push({ h: b.h, rig: b.rig });
    }
    this.brood.splice(i, 1);
  }

  /** the spot on a host's flank a brood clings to (writes out; returns the outward normal in _bz-free temp) */
  private attachPoint(b: Brood, host: EnemyLike, out: THREE.Vector3) {
    const a = ((host as Foe).yaw ?? 0) + b.att;
    const r = host.radius * 0.92;
    return out.set(host.pos.x + Math.sin(a) * r, host.pos.y + host.height * b.attH, host.pos.z + Math.cos(a) * r);
  }

  /** a body this point is inside of (flying throws bite whatever they hit) */
  private bodyAt(p: THREE.Vector3, pad: number): EnemyLike | null {
    const e = this.ctx.enemies.nearest(p, 4, (x) => !x.flying);
    if (!e || this.hiddenFoe(e)) return null;
    const dh = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
    return dh < e.radius + pad && p.y > e.pos.y - 0.1 && p.y < e.pos.y + e.height + 0.15 ? e : null;
  }

  /** the bite: it clamps on, venom spurts, the host flinches */
  private latch(b: Brood, host: EnemyLike) {
    const ctx = this.ctx;
    const B = SKILL_TUNE.brood;
    b.state = 'latched';
    b.target = host;
    b.t = 0;
    b.stingT = B.stingEvery * 0.8;
    b.bite = 1;
    b.vel.set(0, 0, 0);
    const yaw = (host as Foe).yaw ?? 0;
    b.att = Math.atan2(b.pos.x - host.pos.x, b.pos.z - host.pos.z) - yaw + (rnd.next() - 0.5) * 0.6;
    b.attH = clamp((b.pos.y - host.pos.y) / Math.max(0.3, host.height), 0.3, 0.78);
    const at = this.attachPoint(b, host, new THREE.Vector3());
    b.pos.copy(at);
    const dir = new THREE.Vector3(host.pos.x - at.x, 0, host.pos.z - at.z).normalize();
    ctx.enemies.damage(host, { base: B.biteDmg, kind: 'magic', source: 'scorpion', status: [{ id: 'poison', stacks: 3, dur: 4, power: 2.2 }], canCrit: true, knock: 0.6, dirX: dir.x, dirZ: dir.z }, at.clone(), dir);
    ctx.sfx('scorpion_sting', at, 0.6, 1.1 + rnd.next() * 0.15);
    ctx.sfx('scorpion_chitter', at, 0.35, 1.3);
    ctx.particles.emit({ pos: at, count: 7, vel: { x: -dir.x * 2.5, y: 1.6, z: -dir.z * 2.5 }, spread: 2.2, life: [0.3, 0.6], size: [0.08, 0.035], sprite: ['ichor', 'dot3'], color: [0xffffff, 0xc8ff5a], gravity: 12, ground: true });
  }

  /** launch a brood on an arc at a host (or the sand near `fallback`) */
  private launchAt(b: Brood, host: EnemyLike | null, fallback: THREE.Vector3) {
    const to = new THREE.Vector3();
    if (host) to.set(host.pos.x, host.pos.y + host.height * 0.55, host.pos.z);
    else {
      const a = rnd.next() * TAU;
      to.set(fallback.x + Math.cos(a) * 2.5, 0, fallback.z + Math.sin(a) * 2.5);
      to.y = this.ctx.world.groundAt(to.x, to.z);
    }
    const d = Math.hypot(to.x - b.pos.x, to.z - b.pos.z);
    this.lob(b.pos, to, clamp(0.35 + d / 24, 0.35, 0.9), SKILL_TUNE.brood.gravity, b.vel);
    b.state = 'fly';
    b.target = host;
    b.t = 0;
    b.yaw = Math.atan2(b.vel.x, b.vel.z);
  }

  /** the host died with brood on it: the corpse bursts and they leap onto the next body (one fresh hatchling too) */
  private hostDied(b: Brood, host: EnemyLike) {
    const ctx = this.ctx;
    let entry = this.deadHosts.get(host.id);
    const c = _v.set(host.pos.x, host.pos.y + host.height * 0.55, host.pos.z);
    if (!entry) {
      const next = ctx.enemies.nearest(c, 11, (e) => e !== host && e.alive && !e.flying && !this.hiddenFoe(e));
      entry = { next, hatched: false };
      this.deadHosts.set(host.id, entry);
      ctx.particles.emit({ pos: c, count: 18, spread: 4, up: 3.5, life: [0.35, 0.8], size: [0.1, 0.04], sprite: ['ichor', 'dot3', 'bubble'], color: [0xffffff, 0xc8ff5a, 0x9dff3a], gravity: 13, ground: true });
      ctx.particles.emit({ pos: c, count: 1, life: [0.18, 0.2], size: [0.6, 1.2], sprite: 'venomSplat', color: 0xffffff, additive: true, rot: 6.28 });
      ctx.particles.emit({ pos: c, count: 3, spread: 0.8, up: 0.8, life: [0.6, 1.1], size: [0.25, 0.7], sprite: ['puff0', 'puff1'], color: [0x9dcf4a, 0x7fae3a], alpha: 0.5, drag: 2, rot: 6 });
      ctx.sfx('poison_burst', c, 0.55, 1.2);
      ctx.sfx('scorpion_chitter', c, 0.7, 1.25);
      ctx.events.emit('groundMark', c.x, c.z, 0.9, 3);
    }
    const from = c.clone();
    b.pos.copy(from);
    this.launchAt(b, entry.next, from);
    if (!entry.hatched) {
      entry.hatched = true;
      const h = this.newBrood(from, SKILL_TUNE.brood.hatchLife);
      if (h) this.launchAt(h, entry.next, from);
    }
  }

  private updateBrood(dt: number) {
    const ctx = this.ctx;
    const B = SKILL_TUNE.brood;
    const P = ctx.particles;
    const cam = ctx.camera.position;
    this.deadHosts.clear();
    for (let i = this.brood.length - 1; i >= 0; i--) {
      const b = this.brood[i];
      if (i >= this.brood.length) continue;
      b.life -= dt;
      b.t += dt;
      b.bite = Math.max(0, b.bite - dt * 4.5);
      if (b.life <= 0) {
        this.dropBrood(i, true);
        continue;
      }
      const g = ctx.world.groundAt(b.pos.x, b.pos.z);
      const near = cam.distanceTo(b.pos) < 45;
      switch (b.state) {
        case 'fly': {
          b.vel.y -= B.gravity * dt;
          b.pos.addScaledVector(b.vel, dt);
          b.spin += dt * 15;
          // the arc: venom drips and a green streak
          if (near) {
            P.emit({ pos: b.pos, count: 1, vel: { x: b.vel.x * 0.08, y: b.vel.y * 0.08, z: b.vel.z * 0.08 }, life: [0.3, 0.55], size: [0.09, 0.03], sprite: ['dot3', 'ichor'], color: [0xc8ff5a, 0x9dff3a, 0x6ec02a], gravity: 6, drag: 2 });
            if (rnd.chance(0.6)) P.emit({ pos: b.pos, count: 1, vel: { x: b.vel.x * 0.2, y: b.vel.y * 0.2, z: b.vel.z * 0.2 }, life: [0.1, 0.14], size: [0.05, 0.05], sprite: 'streak', additive: true, color: 0xb4ff52, stretch: 0.12, sizeJitter: 0 });
          }
          const hit = b.t > 0.08 ? this.bodyAt(b.pos, 0.35) : null;
          if (hit) {
            this.latch(b, hit);
            break;
          }
          if (b.pos.y <= g && b.vel.y < 0) {
            b.pos.y = g;
            b.vel.set(0, 0, 0);
            b.state = 'seek';
            b.t = 0;
            ctx.fx.sandBurst(b.pos, 0.22);
          }
          break;
        }
        case 'seek': {
          if (!b.target || !b.target.alive || this.hiddenFoe(b.target)) b.target = ctx.enemies.nearest(b.pos, 16, (e) => !e.flying && !this.hiddenFoe(e));
          const tg = b.target;
          if (tg) {
            const dx = tg.pos.x - b.pos.x, dz = tg.pos.z - b.pos.z;
            const d = Math.hypot(dx, dz) || 1;
            b.yaw = dampAngle(b.yaw, Math.atan2(dx, dz), 14, dt);
            const sp = B.seekSpeed * Math.min(1, b.t * 4);
            b.pos.x += Math.sin(b.yaw) * sp * dt;
            b.pos.z += Math.cos(b.yaw) * sp * dt;
            b.gait += dt * 5.5;
            if (d < tg.radius + 1.5) {
              // the pounce
              b.state = 'pounce';
              b.t = 0;
              b.from.copy(b.pos);
              ctx.sfx('scorpion_chitter', b.pos, 0.35, 1.45);
            }
          } else {
            b.yaw += dt * 2.4;
            b.pos.x += Math.sin(b.yaw) * 1.5 * dt;
            b.pos.z += Math.cos(b.yaw) * 1.5 * dt;
            b.gait += dt * 2;
          }
          b.pos.y = ctx.world.groundAt(b.pos.x, b.pos.z);
          if (near && rnd.chance(dt * 12)) ctx.fx.sandSpray(b.pos, { x: -Math.sin(b.yaw) * 0.6, y: 0.2, z: -Math.cos(b.yaw) * 0.6 }, 0.12);
          break;
        }
        case 'pounce': {
          const tg = b.target;
          if (!tg || !tg.alive) {
            b.state = 'seek';
            b.t = 0;
            break;
          }
          const k = Math.min(1, b.t / 0.22);
          _v2.set(tg.pos.x, tg.pos.y + tg.height * 0.5, tg.pos.z);
          b.pos.lerpVectors(b.from, _v2, k);
          b.pos.y += Math.sin(k * Math.PI) * 0.7;
          b.yaw = Math.atan2(_v2.x - b.from.x, _v2.z - b.from.z);
          if (k >= 1) this.latch(b, tg);
          break;
        }
        case 'latched': {
          const tg = b.target;
          if (!tg || !tg.alive) {
            if (tg) this.hostDied(b, tg);
            else b.state = 'seek';
            break;
          }
          if (this.hiddenFoe(tg)) {
            // it went under: shaken off into the sand
            b.state = 'seek';
            b.t = 0;
            b.target = null;
            b.pos.y = g;
            break;
          }
          this.attachPoint(b, tg, b.pos);
          b.stingT -= dt;
          if (b.stingT <= 0) {
            b.stingT = B.stingEvery * (0.9 + rnd.next() * 0.2);
            b.bite = 1;
            const dir = _v2.set(tg.pos.x - b.pos.x, 0, tg.pos.z - b.pos.z).normalize();
            ctx.enemies.damage(tg, { base: B.stingDmg, kind: 'magic', source: 'scorpion', status: [{ id: 'poison', stacks: B.stingStacks, dur: 4, power: 2.2 }], canCrit: true, dirX: dir.x, dirZ: dir.z }, b.pos.clone(), dir.clone());
            ctx.sfx('scorpion_sting', b.pos, 0.32, 1.15 + rnd.next() * 0.25);
          }
          break;
        }
      }
      this.poseBrood(b, dt);
    }
  }

  /** place and animate one brood rig: tumbling, scuttling, pouncing, or clinging and stinging */
  private poseBrood(b: Brood, dt: number) {
    const h = b.h, rig = b.rig;
    if (!h || !rig) return;
    const n = rig.nodes;
    const t = b.t + b.life * 0.37;
    if (b.state === 'latched' && b.target) {
      // belly against the body, head up the flank; the sting jabs it in
      const a = ((b.target as Foe).yaw ?? 0) + b.att;
      _by.set(Math.sin(a), 0, Math.cos(a));
      _bz.copy(UP);
      _bx.crossVectors(_by, _bz);
      _m4.makeBasis(_bx, _by, _bz);
      h.quaternion.setFromRotationMatrix(_m4);
      h.position.copy(b.pos).addScaledVector(_by, 0.05 - b.bite * 0.04);
    } else {
      _q.setFromAxisAngle(UP, b.yaw);
      if (b.state === 'fly') _q.multiply(_qa.setFromAxisAngle(AX, b.spin));
      if (b.state === 'pounce') _q.multiply(_qa.setFromAxisAngle(AX, -0.6));
      h.quaternion.copy(_q);
      h.position.copy(b.pos);
      if (b.state === 'seek') h.position.y += 0.06 + Math.abs(Math.sin(b.gait * TAU)) * 0.015;
    }
    const seek = b.state === 'seek' ? 1 : 0;
    const fly = b.state === 'fly' || b.state === 'pounce' ? 1 : 0;
    const clutch = b.state === 'latched' ? 1 : 0;
    for (let k = 1; k <= 4; k++) {
      const ph = b.gait * TAU + (k % 2 ? 0 : Math.PI);
      const sweep = Math.sin(ph) * 0.42 * seek;
      const lift = Math.max(0, Math.cos(ph)) * 0.38 * seek + fly * (0.45 + Math.sin(t * 31 + k) * 0.28) - clutch * (0.3 + Math.sin(t * 7 + k) * 0.05);
      n['leg_l' + k]?.rotation.set(0, sweep, lift);
      n['leg_r' + k]?.rotation.set(0, -sweep, -lift);
    }
    // tail: cocked high, whipping forward on each sting
    const pump = b.bite * b.bite;
    for (let k = 1; k <= 5; k++) {
      const node = n['tail' + k];
      if (node) node.rotation.x = -0.32 - fly * 0.18 + pump * (k < 3 ? 0.42 : 0.2) + Math.sin(t * 4 + k) * 0.04 * seek;
    }
    // pincers: wide in flight, snapping while running, clamped on the host
    const open = fly * 0.6 + seek * Math.max(0, Math.sin(t * 14)) * 0.45 + clutch * (1 - pump) * 0.25;
    if (n['pincer_l']) n['pincer_l'].rotation.y = -open;
    if (n['pincer_r']) n['pincer_r'].rotation.y = open;
    void dt;
  }

  // ===================================================================== LOCUST SWARM
  summonSwarm(echo = false) {
    const S = SKILL_TUNE.swarm;
    const pl = this.player;
    const count = Math.min(S.maxBugs, Math.round(S.bugs * this.stats.get('swarmSize')));
    const feet = pl.pos;
    if (echo && this.swarmT > 0) {
      // the echo thickens the cloud already circling and keeps it a little longer
      this.swarmT += 2;
      this.addBugs(Math.min(S.maxBugs - this.swarmBugs.length, Math.round(count * 0.6)), feet);
      this.ctx.sfx('divine_power', feet, 0.35, 1.2);
      this.ctx.fx.sandBurst(feet, 0.9);
      return;
    }
    if (!echo) this.swarmCd = this.constants.swarmCd * (1 - this.stats.get('cdr'));
    this.swarmT = S.dur * Math.sqrt(this.stats.get('swarmSize'));
    this.swarmFade = 0;
    this.swarmAge = 0;
    this.swarmPrey = null;
    this.swarmRetarget = 0;
    this.swarmBugs = [];
    this.shredT.clear();
    this.addBugs(count, feet);
    pl.center(this.swarmCore).y += 1.2;
    // the cast: arms up, the sand erupts locusts, a roar builds
    pl.playAction('summon', 0.9);
    pl.express('laugh', 0.9);
    const ctx = this.ctx;
    ctx.sfx('divine_power', feet, 0.6);
    ctx.sfx('whoosh_big', feet, 0.55, 0.9);
    ctx.sfx('sand_burst', feet, 0.6);
    ctx.fx.sandBurst(feet, 1.5);
    ctx.fx.dust({ x: feet.x, y: feet.y + 0.3, z: feet.z }, 1.4, P.sand0, 6);
    this.swarmLoop?.stop(0.2);
    this.swarmLoop = ctx.audio.loop('swarm_loop', 0.75);
    this.castKick(-0.016, 0, 2.2);
    ctx.toast('LOCUST SWARM', '#c8d870', 'Hold C to steer it');
  }

  /** locusts burst up out of the sand around `from` */
  private addBugs(n: number, from: THREE.Vector3) {
    for (let i = 0; i < n; i++) {
      const a = rnd.next() * TAU, r = rnd.next() * 1.6;
      const p = new THREE.Vector3(from.x + Math.cos(a) * r, from.y + 0.1, from.z + Math.sin(a) * r);
      const v = new THREE.Vector3(Math.cos(a) * (2 + rnd.next() * 3), 5 + rnd.next() * 6, Math.sin(a) * (2 + rnd.next() * 3));
      this.swarmBugs.push({ p, v, ph: rnd.next() * TAU, sp: (2.2 + rnd.next() * 2.4) * rnd.sign(), tilt: (rnd.next() - 0.5) * 2.2, rr: 0.45 + rnd.next() * 0.75, tint: BUG_TINTS[Math.floor(rnd.next() * BUG_TINTS.length)], flap: rnd.next() * 10 });
    }
  }

  /** the densest knot of enemies within reach of the hunter (the free swarm's prey) */
  private pickPrey(c: THREE.Vector3): EnemyLike | null {
    const S = SKILL_TUNE.swarm;
    const list = this.ctx.enemies.list;
    let best: EnemyLike | null = null, bestS = -Infinity;
    for (const e of list) {
      if (!e.alive || this.hiddenFoe(e)) continue;
      const dp = Math.hypot(e.pos.x - c.x, e.pos.z - c.z);
      if (dp > S.huntRange) continue;
      let nb = 0;
      for (const o of list) if (o.alive && Math.abs(o.pos.x - e.pos.x) < 4 && Math.abs(o.pos.z - e.pos.z) < 4) nb++;
      const s = nb * 2 - this.swarmCore.distanceTo(e.pos) * 0.15 - dp * 0.1 + (e === this.swarmPrey ? 1.5 : 0);
      if (s > bestS) {
        bestS = s;
        best = e;
      }
    }
    return best;
  }

  private updateSwarm(dt: number) {
    this.bugBatch.begin();
    if (this.swarmT > 0 || this.swarmFade > 0) this.stepSwarm(dt);
    this.bugBatch.end(this.ctx.world.env.fog);
  }

  private stepSwarm(dt: number) {
    const ctx = this.ctx;
    const S = SKILL_TUNE.swarm;
    const pl = this.player;
    const active = this.swarmT > 0;
    if (active) {
      this.swarmT -= dt;
      if (this.swarmT <= 0) {
        // it breaks up and scatters
        this.swarmFade = 0.9;
        this.swarmLoop?.stop(0.8);
        this.swarmLoop = null;
        ctx.sfx('whoosh', this.swarmCore, 0.4, 0.8);
      }
    } else this.swarmFade -= dt;
    this.swarmAge += dt;
    const c = pl.center(_v2);
    const core = this.swarmCore;
    // ---- where the swarm goes: held C pours it wherever you look; free, it hunts the densest knot
    let prey: EnemyLike | null = null;
    const steer = active && pl.alive && this.input.held('skill2') && this.swarmAge > 0.2;
    if (steer) {
      const ap = pl.aimPoint;
      let gx = ap.x - c.x, gz = ap.z - c.z;
      const gl = Math.hypot(gx, gz);
      if (gl > S.steerRange) {
        gx *= S.steerRange / gl;
        gz *= S.steerRange / gl;
      }
      const goal = this.swarmGoal.set(c.x + gx, 0, c.z + gz);
      goal.y = Math.max(ap.y, ctx.world.groundAt(goal.x, goal.z)) + 1.1;
      prey = ctx.enemies.nearest(goal, 3.4, (e) => !this.hiddenFoe(e));
      this.swarmPrey = prey;
      this.swarmRetarget = 1;
    } else if (active) {
      this.swarmRetarget -= dt;
      const p0 = this.swarmPrey;
      if (!p0 || !p0.alive || this.hiddenFoe(p0) || this.swarmRetarget <= 0 || p0.pos.distanceTo(c) > S.huntRange + 6) {
        this.swarmPrey = this.pickPrey(c);
        this.swarmRetarget = 1.4;
      }
      prey = this.swarmPrey;
      if (!prey) this.swarmGoal.set(c.x, c.y + 1.4, c.z);
    }
    if (prey) this.swarmGoal.set(prey.pos.x, prey.pos.y + prey.height * 0.55, prey.pos.z);
    // the core chases its goal at a flock's pace
    const tx = this.swarmGoal.x - core.x, ty = this.swarmGoal.y - core.y, tz = this.swarmGoal.z - core.z;
    const tl = Math.hypot(tx, ty, tz);
    if (tl > 1e-4 && active) {
      const step = Math.min(tl, tl * dt * 4, (steer ? 24 : 16) * dt);
      core.x += (tx / tl) * step;
      core.y += (ty / tl) * step;
      core.z += (tz / tl) * step;
    }
    // ---- the flock
    const bugs = this.swarmBugs;
    const nB = bugs.length;
    let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
    for (const b of bugs) {
      cx += b.p.x;
      cy += b.p.y;
      cz += b.p.z;
      vx += b.v.x;
      vy += b.v.y;
      vz += b.v.z;
    }
    const inv = 1 / Math.max(1, nB);
    cx *= inv;
    cy *= inv;
    cz *= inv;
    vx *= inv;
    vy *= inv;
    vz *= inv;
    const engulf = !!prey && Math.hypot(prey.pos.x - core.x, prey.pos.z - core.z) < 3;
    const R = engulf && prey ? prey.radius + 0.55 : prey ? 1.7 : 2.3;
    const fade = active ? 1 : Math.max(0, this.swarmFade / 0.9);
    const t = this.time;
    const camNear = ctx.camera.position.distanceTo(core) < 70;
    for (let i = 0; i < nB; i++) {
      const b = bugs[i];
      b.ph += b.sp * dt * (engulf ? 1.6 : 1);
      if (active) {
        // its own tilted orbit around the core (a churning ball), bobbing
        const ca = Math.cos(b.ph), sa = Math.sin(b.ph);
        const rr = R * b.rr;
        const gx = core.x + ca * rr;
        const gy = core.y + sa * rr * Math.sin(b.tilt) * 0.75 + Math.sin(t * 3.1 + b.flap) * 0.25;
        const gz = core.z + sa * rr * Math.cos(b.tilt);
        // steer: spring to its slot + cohesion + alignment + turbulence; separation from a neighbour
        let ax = (gx - b.p.x) * 9 + (cx - b.p.x) * 0.7 + (vx - b.v.x) * 0.8 + Math.sin(t * 5.3 + b.flap * 3) * 4;
        let ay = (gy - b.p.y) * 9 + (cy - b.p.y) * 0.7 + (vy - b.v.y) * 0.8 + Math.cos(t * 4.7 + b.flap * 2) * 3;
        let az = (gz - b.p.z) * 9 + (cz - b.p.z) * 0.7 + (vz - b.v.z) * 0.8 + Math.sin(t * 6.1 + b.flap * 5) * 4;
        const o = bugs[(i * 7 + 3 + Math.floor(t * 30)) % nB];
        if (o !== b) {
          const sx = b.p.x - o.p.x, sy = b.p.y - o.p.y, sz = b.p.z - o.p.z;
          const s2 = sx * sx + sy * sy + sz * sz;
          if (s2 < 0.09 && s2 > 1e-6) {
            ax += (sx / s2) * 0.8;
            ay += (sy / s2) * 0.8;
            az += (sz / s2) * 0.8;
          }
        }
        b.v.x += ax * dt;
        b.v.y += ay * dt;
        b.v.z += az * dt;
        const drag = Math.exp(-2.6 * dt);
        b.v.multiplyScalar(drag);
        const sp = b.v.length();
        if (sp > 26) b.v.multiplyScalar(26 / sp);
      } else {
        // scatter: up and away
        b.v.x += (b.p.x - cx) * dt * 6;
        b.v.z += (b.p.z - cz) * dt * 6;
        b.v.y += dt * 9;
      }
      b.p.addScaledVector(b.v, dt);
      const gy = ctx.world.groundAt(b.p.x, b.p.z) + 0.14;
      if (b.p.y < gy) {
        b.p.y = gy;
        b.v.y = Math.abs(b.v.y) * 0.5;
      }
      if (camNear) {
        // wings beating: the sprite flickers between spread and folded
        const w = 0.16 * (0.85 + (b.flap % 1) * 0.3);
        const beat = Math.abs(Math.sin(t * 42 + b.flap * 9));
        this.bugBatch.push(b.p.x, b.p.y, b.p.z, i % 7 === 0 ? (beat > 0.5 ? 'fly0' : 'fly1') : 'locust', w, w * (0.62 + 0.38 * beat), 0, b.tint, fade, b.v, 0.004);
      }
    }
    if (!active) {
      if (this.swarmFade <= 0) this.swarmBugs = [];
      return;
    }
    // ---- the haze: grit and a dusky shimmer hanging in the cloud
    if (camNear && rnd.chance(dt * 14)) ctx.particles.emit({ pos: { x: cx, y: cy, z: cz }, count: 1, spread: 1.2, life: [0.7, 1.3], size: [0.5, 1.3], sprite: ['puff0', 'puff1'], color: [0x8a8050, 0x6e6a3e, 0x9a8a5a], alpha: 0.2, drag: 2, rot: 6, rotSpeed: 0.5, jitter: R * 0.8 });
    if (camNear && rnd.chance(dt * 20)) ctx.particles.emit({ pos: { x: cx, y: cy, z: cz }, count: 2, spread: 3, life: [0.3, 0.7], size: [0.04, 0.03], sprite: ['grain0', 'grain1', 'dot3'], color: [0xd8c890, 0x8a7a4a, 0xb8c070], gravity: 3, jitter: R, drag: 1 });
    // ---- shredding whatever it engulfs
    let engaged = 0;
    ctx.enemies.inRadius(core, R + 1.4, (e) => {
      if (this.hiddenFoe(e)) return;
      const hx = e.pos.x, hy = e.pos.y + e.height * 0.55, hz = e.pos.z;
      const rr = e.radius + 0.6;
      const r2 = rr * rr;
      const hh = e.height * 0.6 + 0.3;
      let n = 0;
      for (const b of bugs) {
        const dx = b.p.x - hx, dz = b.p.z - hz;
        if (dx * dx + dz * dz < r2 && Math.abs(b.p.y - hy) < hh) n++;
      }
      if (n < 4) return;
      engaged++;
      const tk = (this.shredT.get(e.id) ?? 0) - dt;
      if (tk > 0) {
        this.shredT.set(e.id, tk);
        return;
      }
      this.shredT.set(e.id, S.tick);
      const dps = Math.min(S.dpsCap, S.dpsBase + n * S.dpsPerBug);
      const a = Math.atan2(c.x - hx, c.z - hz);
      const tdx = Math.cos(a), tdz = -Math.sin(a);
      const at = new THREE.Vector3(hx, hy, hz);
      ctx.enemies.damage(e, { base: dps * S.tick, kind: 'magic', source: 'swarm', status: [{ id: 'slow', stacks: 1, dur: 1 }, { id: 'bleed', stacks: 1, dur: 2, chance: 0.2 }], canCrit: false, knock: 0.25, dirX: tdx, dirZ: tdz }, at, new THREE.Vector3(tdx, 0, tdz));
      this.stripFx(e, n, at);
    });
    if (this.swarmLoop) {
      this.swarmLoop.setVolume(0.6 + Math.min(0.45, engaged * 0.15), 0.25);
      this.swarmLoop.setRate(1 + Math.min(0.18, engaged * 0.06));
    }
  }

  /** the swarm stripping a body: flecks of whatever it is made of, whirled off around it */
  private stripFx(e: EnemyLike, n: number, at: THREE.Vector3) {
    const ctx = this.ctx;
    if (ctx.camera.position.distanceTo(at) > 50) return;
    const hk = (e as Foe).def?.hitKind ?? 'flesh';
    const count = 3 + Math.min(8, Math.floor(n / 6));
    const PS = ctx.particles;
    for (let k = 0; k < 2; k++) {
      const th = rnd.next() * TAU;
      const r = e.radius * 0.9;
      const pos = { x: at.x + Math.sin(th) * r, y: at.y + (rnd.next() - 0.5) * e.height * 0.6, z: at.z + Math.cos(th) * r };
      // tangential whirl + a little outward and up
      const vel = { x: Math.cos(th) * 5 + Math.sin(th) * 1.2, y: 1.6, z: -Math.sin(th) * 5 + Math.cos(th) * 1.2 };
      const half = Math.ceil(count / 2);
      switch (hk) {
        case 'linen':
          PS.emit({ pos, count: half, vel, spread: 2, life: [0.5, 1.1], size: [0.09, 0.07], sprite: 'linen', color: [0xffffff, 0xe0d4b8], gravity: 3, drag: 2, rot: 6, rotSpeed: 9 });
          break;
        case 'bone':
          PS.emit({ pos, count: half, vel, spread: 2.5, life: [0.4, 0.8], size: [0.06, 0.04], sprite: ['bone', 'pebble'], color: [P.bone1, P.bone0], gravity: 12, ground: true, rot: 6, rotSpeed: 10 });
          PS.emit({ pos, count: 2, vel, spread: 4, life: [0.1, 0.22], size: [0.04, 0.01], sprite: 'spark', additive: true, color: 0xfff2c0, stretch: 0.02 });
          break;
        case 'chitin':
        case 'armor':
          PS.emit({ pos, count: half, vel, spread: 4, life: [0.12, 0.3], size: [0.05, 0.01], sprite: 'spark', additive: true, color: hk === 'armor' ? [0xffe080, 0xfff6c0] : [0xc8ff5a, 0xffffff], stretch: 0.025, gravity: 5 });
          PS.emit({ pos, count: 2, vel, spread: 2, life: [0.4, 0.8], size: [0.06, 0.04], sprite: 'twig', color: [0x2a2018, 0x3e3226], gravity: 12, ground: true, rot: 6, rotSpeed: 8 });
          break;
        case 'wood':
          PS.emit({ pos, count: half, vel, spread: 2.5, life: [0.5, 1], size: [0.07, 0.05], sprite: 'woodchip', color: 0xffffff, gravity: 12, ground: true, rot: 6, rotSpeed: 9 });
          break;
        case 'sand':
        case 'rock':
          PS.emit({ pos, count: half, vel, spread: 2.5, life: [0.4, 0.8], size: [0.06, 0.04], sprite: ['pebble', 'grain0'], color: 0xffffff, gravity: 12, ground: true });
          break;
        default:
          PS.emit({ pos, count: half, vel, spread: 2.2, life: [0.35, 0.8], size: [0.07, 0.04], sprite: ['blood0', 'blood1', 'dot3'], color: [0xffffff, 0xc02020], gravity: 13, ground: true });
      }
    }
    if (this.time - this.shredSfxT > 0.11) {
      this.shredSfxT = this.time;
      ctx.sfx(hk === 'chitin' || hk === 'armor' ? 'hit_armor' : hk === 'bone' ? 'hit_bone' : 'hit_flesh', at, 0.22, 1.35 + rnd.next() * 0.3);
    }
  }

  // ===================================================================== DUNG BOMB
  throwBomb(echo = false) {
    if (!echo) {
      this.bombCharges--;
      if (this.bombRecharge <= 0) this.bombRecharge = this.constants.bombRecharge * (1 - this.stats.get('cdr'));
    }
    const pl = this.player;
    pl.playAction('lob', 0.45);
    this.ctx.sfx('dung_kick', pl.pos, 0.3, 0.8);
    // it leaves the hand at the bottom of the underhand swing
    this.ctx.engine.tweens.after(0.2, () => this.launchBomb(echo));
  }

  private launchBomb(echo: boolean) {
    const pl = this.player;
    if (!pl.alive) return;
    const ctx = this.ctx;
    const Bt = SKILL_TUNE.bomb;
    const o = this.handPoint('hand_l', new THREE.Vector3());
    const aim = pl.aimPoint;
    const jit = echo ? 1.8 : 0;
    let dx = aim.x - o.x + (rnd.next() - 0.5) * jit, dz = aim.z - o.z + (rnd.next() - 0.5) * jit;
    let d = Math.hypot(dx, dz) || 1;
    if (d > 30) {
      dx *= 30 / d;
      dz *= 30 / d;
      d = 30;
    }
    const to = new THREE.Vector3(o.x + dx, 0, o.z + dz);
    to.y = ctx.world.groundAt(to.x, to.z) + this.bombR;
    const T = 0.55 + d / 34;
    const v = this.lob(o, to, T, Bt.gravity, new THREE.Vector3());
    v.addScaledVector(pl.board.vel, 0.5).setY(v.y + pl.board.vel.y * 0.3);
    this.bombs.push({ pos: o.clone(), vel: v, fuse: Bt.fuse, q: new THREE.Quaternion().setFromAxisAngle(UP, rnd.next() * TAU), bounces: 0, sq: 0, sqV: 0, sputter: 0 });
    ctx.sfx('whoosh', o, 0.7, 0.85);
    ctx.sfx('dynamite_fuse', o, 0.55);
    this.castKick(0.01, -0.008, 0.8);
  }

  private bombSlot(i: number) {
    while (this.bombPool.length <= i) {
      const mat = makeVoxelMaterial();
      const mesh = new THREE.Mesh(this.bombGeo, mat);
      mesh.castShadow = true;
      const holder = new THREE.Group();
      holder.add(mesh);
      this.ctx.scene.add(holder);
      this.bombPool.push({ holder, mesh, mat });
    }
    return this.bombPool[i];
  }

  private updateBombs(dt: number) {
    const ctx = this.ctx;
    const Bt = SKILL_TUNE.bomb;
    const R = this.bombR;
    for (let i = 0; i < this.bombPool.length; i++) this.bombPool[i].holder.visible = i < this.bombs.length;
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      const slot = this.bombSlot(i);
      b.fuse -= dt;
      b.vel.y -= Bt.gravity * dt;
      b.pos.addScaledVector(b.vel, dt);
      const g = ctx.world.groundAt(b.pos.x, b.pos.z) + R;
      let grounded = false;
      if (b.pos.y < g) {
        b.pos.y = g;
        grounded = true;
        const impact = -b.vel.y;
        if (impact > 2.2) {
          // a heavy, wet bounce: it squashes, thuds, sheds grit and loses most of its run
          b.vel.y = impact * (b.bounces === 0 ? 0.42 : 0.3);
          b.vel.x *= 0.7;
          b.vel.z *= 0.7;
          b.bounces++;
          b.sqV -= impact * 0.95;
          const vol = clamp(impact / 10, 0.25, 0.8);
          ctx.sfx('dung_kick', b.pos, vol, 0.78 + rnd.next() * 0.12);
          ctx.sfx('board_land', b.pos, vol * 0.4, 1.35);
          ctx.fx.sandBurst(b.pos, clamp(impact / 14, 0.2, 0.7));
          ctx.particles.emit({ pos: b.pos, count: 5, spread: 2.2, up: 2, life: [0.3, 0.6], size: [0.07, 0.05], sprite: 'pebble', color: [0x6a4a2a, 0x8a5a32, 0x4a3018], gravity: 15, ground: true });
        } else b.vel.y = 0;
        // roll downhill, grinding to a stop
        ctx.world.normal(b.pos.x, b.pos.z, _v);
        b.vel.x += _v.x * 9 * dt;
        b.vel.z += _v.z * 9 * dt;
        b.vel.x *= 1 - dt * 1.6;
        b.vel.z *= 1 - dt * 1.6;
      }
      // roll about the axis across its travel (and tumble a little in the air)
      const hs = Math.hypot(b.vel.x, b.vel.z);
      if (hs > 0.05) {
        _v.set(b.vel.z / hs, 0, -b.vel.x / hs);
        b.q.premultiply(_qa.setFromAxisAngle(_v, (hs * dt) / R * (grounded ? 1 : 0.5)));
      }
      // squash spring + the swell before it blows
      b.sqV += (-240 * b.sq - 15 * b.sqV) * dt;
      b.sq = clamp(b.sq + b.sqV * dt, -0.5, 0.5);
      const last = clamp(1 - b.fuse / 0.55, 0, 1);
      const swell = 1 + last * 0.22;
      const sy = (1 + b.sq) * swell, sxz = (1 - b.sq * 0.5) * swell;
      slot.holder.position.copy(b.pos);
      slot.holder.scale.set(sxz * 1.7, sy * 1.7, sxz * 1.7);
      slot.mesh.quaternion.copy(b.q);
      // the fuse burns faster and brighter toward the end; the ball flashes in its last half-second
      const fx = slot.mat.userData.fx.value as THREE.Vector4;
      fx.x = last > 0 ? (Math.sin(this.time * (14 + last * 40)) > 0 ? 0.75 * last : 0) : 0;
      slot.holder.updateMatrixWorld(true);
      const tip = slot.mesh.localToWorld(_v2.copy(this.bombFuse));
      this.sputter(b, tip, dt, last);
      if (b.fuse <= 0) {
        this.detonate(b);
        this.bombs.splice(i, 1);
        fx.x = 0;
      }
    }
  }

  /** the fuse: a steady fizz of sparks, irregular sputtering bursts with a puff of smoke */
  private sputter(b: Bomb, tip: THREE.Vector3, dt: number, last: number) {
    const P = this.ctx.particles;
    if (rnd.chance(Math.min(1, dt * (28 + last * 40)))) P.emit({ pos: tip, count: 1, vel: { x: 0, y: 1.2, z: 0 }, spread: 1.6, life: [0.1, 0.24], size: [0.05, 0.015], sprite: 'spark', additive: true, color: [0xffd27a, 0xffa040, 0xfff2c0], gravity: 4 });
    b.sputter -= dt;
    if (b.sputter <= 0) {
      b.sputter = (0.05 + rnd.next() * 0.16) * (1 - last * 0.6);
      P.emit({ pos: tip, count: 3 + Math.floor(rnd.next() * 5), vel: { x: 0, y: 1.6, z: 0 }, spread: 3.2, life: [0.12, 0.32], size: [0.06, 0.015], sprite: 'spark', additive: true, color: [0xffe0a0, 0xffb040, 0xff7a20], stretch: 0.02, gravity: 7 });
      P.emit({ pos: tip, count: 1, vel: { x: 0, y: 0.7, z: 0 }, spread: 0.3, life: [0.4, 0.8], size: [0.08, 0.3], sprite: ['puff0', 'puff1'], color: [0x8a8070, 0x6a6258], alpha: 0.5, drag: 2, rot: 6, rotSpeed: 0.6 });
      P.emit({ pos: tip, count: 1, life: [0.06, 0.08], size: [0.2, 0.3], sprite: 'glow8', additive: true, color: 0xffc060 });
    }
  }

  private detonate(b: Bomb) {
    const ctx = this.ctx;
    const Bt = SKILL_TUNE.bomb;
    const r = Bt.radius * this.stats.get('explosionRadius');
    const p = b.pos;
    ctx.fx.explosion(p, r * 0.7, 'fire');
    ctx.fx.explosion({ x: p.x, y: p.y + 0.35, z: p.z }, r * 0.45, 'poison');
    this.shockwave(p, r);
    ctx.fx.word(p, r > 5 ? 'w_kaboom' : 'w_boom');
    ctx.sfx('explosion', p, 1);
    ctx.sfx('explosion_big', p, 0.45, 1.15);
    ctx.sfx('poison_burst', p, 0.5, 0.9);
    const dPl = this.player.pos.distanceTo(p);
    ctx.shake(clamp(0.5 - dPl * 0.018, 0.12, 0.5));
    if (dPl < 18) {
      this.player.cam.punch(0.012, 0, 2.4 * (1 - dPl / 18), 0);
      ctx.engine.hitStop(0.035, 0.08);
    }
    // the blast tosses bodies off their feet (Enemies.explosion: heavy hit → knockdown)
    ctx.events.emit('explosion', { x: p.x, y: p.y, z: p.z }, r, Bt.dmg, 'player');
    ctx.enemies.inRadius(p, r, (e) => ctx.enemies.damage(e, { base: 0.01, kind: 'magic', source: 'poison', status: [{ id: 'poison', stacks: 5, dur: 5, power: 2.4 }, { id: 'burn', stacks: 1, dur: 3, power: 1.5 }], canCrit: false }));
    this.clouds.push({ pos: p.clone(), r: r * 0.85, life: Bt.cloudLife, t: 0, tick: 0.25 });
    ctx.fx.poisonCloud(p, r * 0.7);
  }

  /** a ring of sand thrown out along the ground, dung chunks and grit flung high */
  private shockwave(p: THREE.Vector3, r: number) {
    const ctx = this.ctx;
    const P = ctx.particles;
    const N = 40;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + rnd.next() * 0.12;
      const cx = Math.cos(a), cz = Math.sin(a);
      const x = p.x + cx * 0.6, z = p.z + cz * 0.6;
      const v = r * (3.3 + rnd.next() * 0.8);
      P.emit({ pos: { x, y: ctx.world.groundAt(x, z) + 0.15, z }, count: 1, vel: { x: cx * v, y: 0.5 + rnd.next() * 0.6, z: cz * v }, life: [0.45, 0.75], size: [0.35, 1.25], sprite: ['puff0', 'puff1', 'puff2'], color: [0xe6cf9f, 0xd8b98a, 0xc9a77a], alpha: 0.75, drag: 3.2, rot: 6, rotSpeed: 0.6 });
      if (i % 2 === 0) P.emit({ pos: { x, y: ctx.world.groundAt(x, z) + 0.1, z }, count: 2, vel: { x: cx * v * 1.2, y: 1.5, z: cz * v * 1.2 }, spread: 1.5, life: [0.3, 0.6], size: [0.05, 0.04], sprite: ['grain0', 'grain2', 'dot3'], color: [0xe0c08a, 0xc9a06a, 0xf0d6a2], gravity: 14, drag: 2.5, ground: true });
    }
    P.emit({ pos: p, count: 16, spread: 7, up: 6, life: [0.6, 1.2], size: [0.12, 0.08], sprite: 'pebble', color: [0x6a4a2a, 0x8a5a32, 0x4a3018], gravity: 18, ground: true, bounce: 0.3, rot: 6, rotSpeed: 10 });
  }

  private updateClouds(dt: number) {
    const ctx = this.ctx;
    const Bt = SKILL_TUNE.bomb;
    const P = ctx.particles;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.life -= dt;
      c.t += dt;
      c.tick -= dt;
      const fade = clamp(c.life / 1.2, 0, 1) * clamp(c.t / 0.3, 0, 1);
      const near = ctx.camera.position.distanceTo(c.pos) < 70;
      // a low, rolling, sickly-green fog with flies buzzing in it and bubbles popping out of the sand
      if (near && rnd.chance(Math.min(1, dt * 12 * fade))) {
        const a = rnd.next() * TAU, rr = Math.sqrt(rnd.next()) * c.r * 0.8;
        const x = c.pos.x + Math.cos(a) * rr, z = c.pos.z + Math.sin(a) * rr;
        P.emit({ pos: { x, y: ctx.world.groundAt(x, z) + 0.3 + rnd.next() * 0.8, z }, count: 1, vel: { x: -Math.sin(a) * 0.5, y: 0.15, z: Math.cos(a) * 0.5 }, life: [1.4, 2.4], size: [c.r * 0.25, c.r * 0.55], sprite: ['cloud0', 'cloud1', 'cloud2'], color: [0x7fae3a, 0x9dbf4a, 0x6a8a2a, 0xa8b860], alpha: 0.38 * fade, drag: 1.2, rot: 6, rotSpeed: 0.3 });
      }
      if (near && rnd.chance(Math.min(1, dt * 6 * fade))) P.emit({ pos: { x: c.pos.x, y: c.pos.y + 0.9, z: c.pos.z }, count: 2, spread: 1.4, up: 0.4, life: [0.8, 1.4], size: [0.07, 0.07], sprite: ['fly0', 'fly1'], color: 0xffffff, jitter: c.r * 0.6, drag: 1, gravity: -0.2 });
      if (near && rnd.chance(Math.min(1, dt * 5 * fade))) {
        const a = rnd.next() * TAU, rr = Math.sqrt(rnd.next()) * c.r * 0.7;
        const x = c.pos.x + Math.cos(a) * rr, z = c.pos.z + Math.sin(a) * rr;
        ctx.fx.bubbles({ x, y: ctx.world.groundAt(x, z) + 0.05, z }, 2);
      }
      if (c.tick <= 0) {
        c.tick = Bt.cloudTick;
        ctx.enemies.inRadius(c.pos, c.r, (e) => {
          ctx.enemies.damage(e, { base: 0.01, kind: 'magic', source: 'poison', status: [{ id: 'poison', stacks: 1, dur: 3, power: 2 }, { id: 'slow', stacks: 1, dur: 1 }], canCrit: false });
          // the stink doubles them over: a coughing fit breaks the wind-up
          if (rnd.chance(Bt.coughChance * fade)) this.foes.cough?.(e, 1);
        });
      }
      if (c.life <= 0) this.clouds.splice(i, 1);
    }
  }

  // ----------------------------------------------------------- Pinch
  private updatePinch(dt: number) {
    const ctx = this.ctx;
    const pl = this.player;
    const shoulder = pl.rig.sockets['shoulder_l'];
    const hand = pl.rig.sockets['hand_r'];
    const home = new THREE.Vector3();
    if (shoulder) shoulder.getWorldPosition(home);
    else pl.center(home).add(new THREE.Vector3(0, 0.5, 0));
    this.pinchT += dt;
    this.pinchCd -= dt;
    const reload = pl.reload.active;
    if (reload && (this.pinchState === 'shoulder' || this.pinchState === 'return')) {
      this.pinchState = 'reload';
      this.pinchT = 0;
      this.pinch?.setExpression('determined');
    }
    switch (this.pinchState) {
      case 'shoulder': {
        this.pinchPos.copy(home);
        this.pinchRoot.quaternion.copy(pl.root.quaternion);
        this.pinchRoot.rotateY(Math.sin(this.pinchT * 1.3) * 0.3);
        if (this.pinchCd <= 0 && pl.alive) {
          const t = ctx.enemies.nearest(pl.pos, 9, (e) => !e.flying);
          if (t) {
            this.pinchTarget = t;
            this.pinchState = 'leap';
            this.pinchT = 0;
            this.pinchFrom.copy(home);
            ctx.sfx('scorpion_chitter', home, 0.5, 1.3);
            this.pinch?.setExpression('angry');
          }
        }
        break;
      }
      case 'leap': {
        const t = this.pinchTarget;
        if (!t || !t.alive) {
          this.pinchState = 'return';
          this.pinchT = 0;
          break;
        }
        const k = clamp(this.pinchT / 0.45, 0, 1);
        const to = _v.set(t.pos.x, t.pos.y + t.height * 0.7, t.pos.z);
        this.pinchPos.lerpVectors(this.pinchFrom, to, k);
        this.pinchPos.y += Math.sin(k * Math.PI) * 2;
        this.pinchRoot.lookAt(to.x, this.pinchPos.y, to.z);
        if (k >= 1) {
          this.pinchState = 'sting';
          this.pinchT = 0;
        }
        break;
      }
      case 'sting': {
        const t = this.pinchTarget;
        if (!t || !t.alive || this.pinchT > 1.6) {
          this.pinchState = 'return';
          this.pinchT = 0;
          this.pinchFrom.copy(this.pinchPos);
          break;
        }
        this.pinchPos.set(t.pos.x, t.pos.y + t.height * 0.75, t.pos.z);
        const st = Math.floor(this.pinchT / 0.5);
        if (Math.floor((this.pinchT - dt) / 0.5) !== st || this.pinchT === dt) {
          ctx.enemies.damage(t, { base: 8, kind: 'magic', source: 'scorpion', status: [{ id: 'poison', stacks: 3, dur: 4, power: 2.4 }], canCrit: true }, this.pinchPos.clone());
          ctx.sfx('scorpion_sting', this.pinchPos, 0.5);
        }
        break;
      }
      case 'return': {
        const k = clamp(this.pinchT / 0.4, 0, 1);
        this.pinchPos.lerpVectors(this.pinchFrom, home, k);
        this.pinchPos.y += Math.sin(k * Math.PI) * 1.5;
        if (k >= 1) {
          this.pinchState = 'shoulder';
          this.pinchCd = 3.2 / (1 + this.stats.get('magic') * 0.03);
          this.pinch?.setExpression('happy');
          ctx.engine.tweens.after(1, () => this.pinch?.setExpression('neutral'));
        }
        break;
      }
      case 'reload': {
        const gun = new THREE.Vector3();
        if (hand) hand.getWorldPosition(gun);
        else gun.copy(home);
        this.pinchPos.lerp(gun.add(new THREE.Vector3(0, 0.12 + Math.abs(Math.sin(this.pinchT * 18)) * 0.05, 0)), Math.min(1, dt * 14));
        if (!reload) {
          this.pinchState = 'return';
          this.pinchT = 0;
          this.pinchFrom.copy(this.pinchPos);
        }
        break;
      }
    }
    this.pinchRoot.position.copy(this.pinchPos);
    // pinch idle animation
    if (this.pinch) {
      const n = this.pinch.nodes;
      const t = this.pinchT;
      const busy = this.pinchState === 'sting' || this.pinchState === 'reload';
      for (let k = 1; k <= 5; k++) if (n['tail' + k]) n['tail' + k].rotation.x = -0.3 - (busy ? Math.sin(t * 20) * 0.25 : Math.sin(t * 2 + k) * 0.05);
      if (n['pincer_l']) n['pincer_l'].rotation.y = -Math.max(0, Math.sin(t * (busy ? 16 : 3))) * 0.5;
      if (n['pincer_r']) n['pincer_r'].rotation.y = Math.max(0, Math.sin(t * (busy ? 16 : 3) + 1)) * 0.5;
      for (let k = 1; k <= 4; k++) {
        if (n['leg_l' + k]) n['leg_l' + k].rotation.z = Math.sin(t * 12 + k) * (this.pinchState === 'leap' ? 0.4 : 0.05);
        if (n['leg_r' + k]) n['leg_r' + k].rotation.z = -Math.sin(t * 12 + k) * (this.pinchState === 'leap' ? 0.4 : 0.05);
      }
    }
    void damp;
  }

  cooldowns() {
    return {
      scorp: Math.max(0, this.scorpCd),
      swarm: Math.max(0, this.swarmCd),
      bomb: this.bombCharges > 0 ? 0 : Math.max(0, this.bombRecharge),
      bombCharges: this.bombCharges,
    };
  }
}
