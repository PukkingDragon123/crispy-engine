// Sundown's Serket kit: Pinch (shoulder companion that leaps to sting and helps
// reload), Scorpion Toss (E), Scarab Swarm (C), Dung Bomb (G, bouncing physics
// grenade with a stink cloud).
// A new hunt starts with only the pistol: the three tarot skills are SEALED until
// learned from a rank-up card (run/Upgrades.ts `learn*` cards -> Skills.learn).
// `echo` (a quest reward) makes every cast repeat once ~0.3 s later.
//
//  E  Scorpion Toss: an arcing, venom-trailing throw of Pinch's brood (rigged little
//     scorpions). They aim for the bodies under and around the reticle, bite on
//     contact, ride the host stinging (venom numbers, frothing poison stacks), and
//     when the host dies the brood bursts off the corpse onto the next one.
//  C  Scarab Swarm: two fingers to the teeth, a sharp whistle — the sand boils in
//     front of the prey and a horde of rigged jade scarabs pours out in a living
//     carpet, swarms up the bodies and eats them (they thrash, cloth and gear are
//     gnawed off, the eaten fall apart picked pale), then dives back under.
//  Every cast gets a short camera beat (CAST_CINE) and its own pose (anim/castAnim).
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
import type { EnemyRender } from '../enemies/EnemyRender';
import type { CineShot } from './CameraRig';
import { CAST_POSE } from '../anim/castAnim';
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
  C: { card: 'THE TOWER', name: 'Scarab Swarm' },
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
  swarm: { scarabs: 80, maxScarabs: 220, dur: 6, aimRadius: 10, reach: 20, maxHosts: 6, hop: 9, climbSpeed: 1.6, dpsBase: 6, dpsPerScarab: 2.4, dpsCap: 70, tick: 0.4 },
  bomb: { fuse: 1.7, radius: 4.2, dmg: 40, gravity: 20, cloudLife: 5.5, cloudTick: 0.45, coughChance: 0.6 },
};

/**
 * Cast camera beats: hard cut to an angle on the cast pose at slight slow-mo, then
 * back to play (or a beat on what was thrown / summoned). Real-time seconds.
 * enabled: master switch · slow: time scale during the beat · minGap: no two beats closer
 * than this · clearance: skip when an enemy is this close · followBomb: ride along behind the dung bomb
 */
export const CAST_CINE = { enabled: true, slow: 0.55, minGap: 2.5, clearance: 3.2, followBomb: true };
type CineKind = 'flick' | 'grenade' | 'whistle' | 'boil' | 'bomb';

/** the swarm's scarabs: the iridescent jade-and-gold beetle rig, instanced through the enemy renderer */
const SCARAB_RIG = 'scarab_v1';
const FX0: [number, number, number, number] = [0, 0, 0, 0];
const WHITE = new THREE.Color(1, 1, 1);

/** what the skills need from a body beyond EnemyLike (enemies have these; bosses may not) */
type Foe = EnemyLike & { yaw?: number; state?: string; def?: { hitKind?: string }; anim?: { hidden?: boolean } };
type EnemyVerbs = Partial<Pick<Enemies, 'cough' | 'knockdown' | 'stagger' | 'feed'>>;

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

interface Scarab {
  p: THREE.Vector3;
  yaw: number;
  state: 'wait' | 'emerge' | 'run' | 'climb' | 'eat' | 'fall' | 'dive';
  t: number;
  /** wait this long under the sand before bursting out */
  delay: number;
  host: EnemyLike | null;
  /** on the host: angle around it (relative to its facing), height share now / where it is headed */
  att: number;
  h: number;
  hT: number;
  gait: number;
  sc: number;
  vy: number;
  spd: number;
  wob: number;
  rot: Float32Array | null;
  out: THREE.Vector3;
}

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
  scarabs: Scarab[] = [];
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
  // scarab swarm
  private swarmLoop: any = null;
  private boils: { p: THREE.Vector3; t: number; dur: number; r: number }[] = [];
  private onHost = new Map<EnemyLike, number>();
  private feastT = new Map<number, number>();
  private hooked = false;
  private shredSfxT = 0;
  // cast camera
  private cine: { kind: CineKind; t: number; dur: number; at: THREE.Vector3; shot: CineShot } | null = null;
  private cineLast = -99;
  private lastReal = 0;
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
    // the scarabs are drawn inside the enemy render pass (instanced rigs)
    if (!this.hooked) {
      const en = this.ctx.enemies as unknown as { drawHooks?: ((r: EnemyRender) => void)[]; render?: EnemyRender };
      if (en.drawHooks) {
        en.drawHooks.push((r) => this.drawScarabs(r));
        en.render?.get(SCARAB_RIG, 320); // build the instanced rig now, not on the first whistle
        this.hooked = true;
      }
    }
    this.updateCine();
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
    // where it was aimed when cast (the camera may cut away before the release)
    const aim = pl.aimPoint.clone();
    const under = pl.aimHit?.enemy ?? null;
    if (!echo) {
      pl.castAim = aim;
      pl.playAction('flick', CAST_POSE.flick.dur);
      pl.express('determined', 0.6);
      this.cineStart('flick', 0.5);
    }
    this.ctx.sfx('scorpion_chitter', pl.pos, 0.6, 1.1);
    // the brood leave the hand at the release of the flick
    this.ctx.engine.tweens.after(echo ? 0.02 : CAST_POSE.flick.dur * CAST_POSE.flick.release, () => this.releaseBrood(n, echo, aim, under));
  }

  private releaseBrood(n: number, echo: boolean, aim: THREE.Vector3, under: EnemyLike | null) {
    const pl = this.player;
    if (!pl.alive) return;
    const ctx = this.ctx;
    const B = SKILL_TUNE.brood;
    const o = this.handPoint('hand_l', new THREE.Vector3());
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

  // ===================================================================== SCARAB SWARM
  /**
   * Two fingers to the teeth, a sharp whistle — the sand boils in front of the
   * prey and a horde of jade scarabs bursts out, pours across the ground in a
   * living carpet, swarms up the bodies and eats them (Enemies.feed: they
   * thrash, gear and cloth are gnawed off, the eaten fall apart picked pale).
   * Then the scarabs dive back under the sand.
   */
  summonSwarm(echo = false) {
    const pl = this.player;
    const S = SKILL_TUNE.swarm;
    const count = Math.min(S.maxScarabs, Math.round(S.scarabs * this.stats.get('swarmSize')));
    const aim = pl.aimPoint.clone();
    if (echo) {
      // the echo: a second wave boils up behind the first
      this.ctx.engine.tweens.after(0.2, () => this.erupt(aim, Math.round(count * 0.5), true));
      return;
    }
    this.swarmCd = this.constants.swarmCd * (1 - this.stats.get('cdr'));
    pl.castAim = aim;
    pl.playAction('whistle', CAST_POSE.whistle.dur);
    pl.express('smug', 1.1);
    this.cineStart('whistle', 0.95);
    this.castKick(-0.008, 0, 1);
    this.ctx.engine.tweens.after(CAST_POSE.whistle.dur * CAST_POSE.whistle.release, () => this.whistle());
    this.ctx.engine.tweens.after(0.5, () => this.erupt(aim, count, false));
  }

  /**
   * A two-finger whistle, synthesized: a breathy sine that leaps up an octave,
   * holds with a little vibrato and falls off with a flick (no sample needed).
   */
  private whistle() {
    if (!this.player.alive) return;
    const au = this.ctx.audio as unknown as { ctx?: AudioContext; buses?: Record<string, AudioNode> };
    const ac = au.ctx;
    if (ac && ac.state !== 'closed') {
      try {
        const out = au.buses?.sfx ?? ac.destination;
        const t0 = ac.currentTime + 0.005;
        const env = ac.createGain();
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.exponentialRampToValueAtTime(0.2, t0 + 0.035);
        env.gain.setValueAtTime(0.2, t0 + 0.36);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
        env.connect(out);
        const osc = ac.createOscillator();
        osc.type = 'sine';
        const f = osc.frequency;
        f.setValueAtTime(1450, t0);
        f.exponentialRampToValueAtTime(2900, t0 + 0.07);
        f.linearRampToValueAtTime(3150, t0 + 0.34);
        f.exponentialRampToValueAtTime(2250, t0 + 0.52);
        const lfo = ac.createOscillator();
        lfo.frequency.value = 7.5;
        const lfoAmp = ac.createGain();
        lfoAmp.gain.value = 38;
        lfo.connect(lfoAmp).connect(f);
        const harm = ac.createOscillator();
        harm.type = 'sine';
        harm.frequency.setValueAtTime(2900, t0);
        harm.frequency.exponentialRampToValueAtTime(5800, t0 + 0.07);
        harm.frequency.linearRampToValueAtTime(6300, t0 + 0.34);
        harm.frequency.exponentialRampToValueAtTime(4500, t0 + 0.52);
        const hg = ac.createGain();
        hg.gain.value = 0.06;
        harm.connect(hg).connect(env);
        osc.connect(env);
        // the breath through the fingers
        const n = Math.floor(ac.sampleRate * 0.56);
        const buf = ac.createBuffer(1, n, ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        const noise = ac.createBufferSource();
        noise.buffer = buf;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 3000;
        bp.Q.value = 1.6;
        const ng = ac.createGain();
        ng.gain.value = 0.22;
        noise.connect(bp).connect(ng).connect(env);
        for (const o of [osc, lfo, harm]) {
          o.start(t0);
          o.stop(t0 + 0.6);
        }
        noise.start(t0);
      } catch {
        this.ctx.sfx('squeak', this.player.pos, 0.7, 1.9);
      }
    } else this.ctx.sfx('squeak', this.player.pos, 0.7, 1.9);
    this.ctx.sfx('divine_whisper', this.player.pos, 0.3, 1.25);
  }

  /** bodies the swarm goes for: around where you looked, else the nearest around you */
  private pickHosts(aim: THREE.Vector3) {
    const S = SKILL_TUNE.swarm;
    const pl = this.player;
    const ok = (e: EnemyLike) => e.alive && !e.flying && !this.hiddenFoe(e);
    const list = this.ctx.enemies.list.filter(ok);
    let near = list.filter((e) => Math.hypot(e.pos.x - aim.x, e.pos.z - aim.z) < S.aimRadius);
    near.sort((a, b) => Math.hypot(a.pos.x - aim.x, a.pos.z - aim.z) - Math.hypot(b.pos.x - aim.x, b.pos.z - aim.z));
    if (!near.length) {
      near = list.filter((e) => e.pos.distanceTo(pl.pos) < S.reach);
      near.sort((a, b) => a.pos.distanceTo(pl.pos) - b.pos.distanceTo(pl.pos));
    }
    return near.slice(0, S.maxHosts);
  }

  /** the sand boils in front of the prey and the horde bursts out */
  private erupt(aim: THREE.Vector3, count: number, echo: boolean) {
    const ctx = this.ctx;
    const S = SKILL_TUNE.swarm;
    const pl = this.player;
    if (!pl.alive) return;
    const hosts = this.pickHosts(aim);
    this.swarmT = Math.max(this.swarmT, S.dur * Math.sqrt(this.stats.get('swarmSize'))) + (echo ? 1.5 : 0);
    // boils: one a few steps in front of each victim (toward the hunter), or where you looked
    const boils: THREE.Vector3[] = [];
    const ground = (v: THREE.Vector3) => (v.y = ctx.world.groundAt(v.x, v.z), v);
    if (!hosts.length) boils.push(ground(aim.clone()));
    for (const h of hosts) {
      const dx = pl.pos.x - h.pos.x, dz = pl.pos.z - h.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const off = Math.min(2.6, d * 0.4) + h.radius;
      boils.push(ground(new THREE.Vector3(h.pos.x + (dx / d) * off + (rnd.next() - 0.5), 0, h.pos.z + (dz / d) * off + (rnd.next() - 0.5))));
    }
    for (const b of boils) {
      this.boils.push({ p: b, t: 0, dur: 1.5, r: 1.2 });
      ctx.fx.sandBurst(b, 1.2);
      ctx.events.emit('groundMark', b.x, b.z, 1.1, 1);
    }
    // the horde, split by body size (big bodies get more mouths)
    const wts = hosts.map((h) => 0.7 + h.radius * h.height * 1.5);
    const tot = wts.reduce((a, b) => a + b, 0);
    for (let i = 0; i < count && this.scarabs.length < S.maxScarabs; i++) {
      let hi = -1;
      if (hosts.length) {
        let r = rnd.next() * tot;
        hi = 0;
        while (hi < hosts.length - 1 && r > wts[hi]) r -= wts[hi++];
      }
      const b = boils[Math.max(0, hi)];
      const a = rnd.next() * TAU, rr = Math.sqrt(rnd.next()) * 1.1;
      const p = new THREE.Vector3(b.x + Math.cos(a) * rr, b.y, b.z + Math.sin(a) * rr);
      this.scarabs.push({ p, yaw: rnd.next() * TAU, state: 'wait', t: 0, delay: Math.pow(rnd.next(), 1.6) * 0.65, host: hi >= 0 ? hosts[hi] : null, att: rnd.next() * TAU, h: 0, hT: 0.12 + rnd.next() * 0.86, gait: rnd.next(), sc: 0.36 + rnd.next() * 0.14, vy: 0, spd: 6 + rnd.next() * 3, wob: rnd.next() * TAU, rot: null, out: new THREE.Vector3() });
    }
    ctx.sfx('sand_burst', boils[0], 0.95);
    ctx.sfx('quake_rumble', boils[0], 0.5, 1.5);
    ctx.sfx('scorpion_chitter', boils[0], 0.9, 0.7);
    ctx.sfx('dung_roll_loop', boils[0], 0.35, 1.6);
    if (!this.swarmLoop) this.swarmLoop = ctx.audio.loop('swarm_loop', 0.6);
    this.swarmLoop?.setRate(0.62);
    ctx.shake(0.18);
    // the camera beat: off Sundown's whistle, onto the boiling sand
    if (this.cine?.kind === 'whistle') this.cineSwitch('boil', 0.62, boils[0]);
  }

  private nextHost(p: THREE.Vector3) {
    return this.ctx.enemies.nearest(p, SKILL_TUNE.swarm.hop, (e) => !e.flying && !this.hiddenFoe(e) && !(e as Foe).isBoss);
  }

  /** a spot on the host's flank (h: share of its height) — writes out, returns the outward normal in _by */
  private flank(host: EnemyLike, att: number, h: number, out: THREE.Vector3) {
    const a = ((host as Foe).yaw ?? 0) + att;
    _by.set(Math.sin(a), 0, Math.cos(a));
    const r = host.radius * (0.95 - h * 0.25);
    return out.set(host.pos.x + _by.x * r, host.pos.y + host.height * h, host.pos.z + _by.z * r);
  }

  private updateSwarm(dt: number) {
    if (!this.scarabs.length && !this.boils.length) {
      if (this.swarmLoop) {
        this.swarmLoop.stop(0.6);
        this.swarmLoop = null;
      }
      return;
    }
    const ctx = this.ctx;
    const S = SKILL_TUNE.swarm;
    const P = ctx.particles;
    this.swarmT = Math.max(0, this.swarmT - dt);
    const ending = this.swarmT <= 0;
    const camP = ctx.camera.position;
    // ---- the boiling sand
    for (let i = this.boils.length - 1; i >= 0; i--) {
      const b = this.boils[i];
      b.t += dt;
      const f = 1 - b.t / b.dur;
      if (f <= 0) {
        this.boils.splice(i, 1);
        continue;
      }
      if (rnd.chance(Math.min(1, dt * 34 * f))) {
        const a = rnd.next() * TAU, r = Math.sqrt(rnd.next()) * b.r;
        ctx.fx.sandSpray({ x: b.p.x + Math.cos(a) * r, y: b.p.y + 0.05, z: b.p.z + Math.sin(a) * r }, { x: Math.cos(a) * 0.6, y: 2.2 + rnd.next() * 1.5, z: Math.sin(a) * 0.6 }, 1.1);
      }
      if (rnd.chance(Math.min(1, dt * 7 * f))) P.emit({ pos: { x: b.p.x, y: b.p.y + 0.2, z: b.p.z }, count: 1, spread: 0.8, up: 0.6, life: [0.6, 1.1], size: [0.35, 1], sprite: ['puff0', 'puff1'], color: [0xe6cf9f, 0xd8b98a], alpha: 0.55, drag: 2, rot: 6, rotSpeed: 0.5, jitter: b.r * 0.6 });
    }
    // ---- the horde
    const onHost = this.onHost;
    onHost.clear();
    let kicks = 0;
    for (let i = this.scarabs.length - 1; i >= 0; i--) {
      const s = this.scarabs[i];
      s.t += dt;
      const host = s.host;
      const hostOk = !!host && host.alive && !this.hiddenFoe(host) && !host.flying;
      switch (s.state) {
        case 'wait':
          if (s.t >= s.delay) {
            s.state = 'emerge';
            s.t = 0;
            if (kicks++ < 6) ctx.fx.sandSpray(s.p, { x: 0, y: 2.5, z: 0 }, 0.5);
          }
          break;
        case 'emerge': {
          const k = Math.min(1, s.t / 0.3);
          s.p.y = ctx.world.groundAt(s.p.x, s.p.z) + Math.sin(k * Math.PI) * 0.3;
          if (hostOk) s.yaw = Math.atan2(host!.pos.x - s.p.x, host!.pos.z - s.p.z);
          if (k >= 1) {
            s.state = 'run';
            s.t = 0;
          }
          break;
        }
        case 'run': {
          if (!hostOk) s.host = ending ? null : this.nextHost(s.p);
          const h = s.host;
          if (ending || (!h && s.t > 1.8)) {
            s.state = 'dive';
            s.t = 0;
            break;
          }
          let tx: number, tz: number;
          if (h) {
            const a = ((h as Foe).yaw ?? 0) + s.att;
            tx = h.pos.x + Math.sin(a) * (h.radius + 0.1);
            tz = h.pos.z + Math.cos(a) * (h.radius + 0.1);
          } else {
            tx = s.p.x + Math.sin(s.yaw + 0.8) * 2;
            tz = s.p.z + Math.cos(s.yaw + 0.8) * 2;
          }
          const dx = tx - s.p.x, dz = tz - s.p.z;
          const d = Math.hypot(dx, dz) || 1;
          // a living carpet: they stream in with a ripple running through them
          const want = Math.atan2(dx, dz) + Math.sin(this.time * 8 + s.wob) * 0.35 * Math.min(1, d / 2);
          s.yaw = dampAngle(s.yaw, want, 12, dt);
          const sp = s.spd * Math.min(1, s.t * 5 + 0.3);
          s.p.x += Math.sin(s.yaw) * sp * dt;
          s.p.z += Math.cos(s.yaw) * sp * dt;
          s.p.y = ctx.world.groundAt(s.p.x, s.p.z);
          s.gait += dt * sp * 2.6;
          if (kicks < 10 && rnd.chance(dt * 1.5) && camP.distanceTo(s.p) < 35) {
            kicks++;
            ctx.fx.sandSpray(s.p, { x: -Math.sin(s.yaw) * 0.8, y: 0.3, z: -Math.cos(s.yaw) * 0.8 }, 0.2);
          }
          if (h && d < 0.32) {
            s.state = 'climb';
            s.t = 0;
            s.att = Math.atan2(s.p.x - h.pos.x, s.p.z - h.pos.z) - ((h as Foe).yaw ?? 0);
            s.h = 0.02;
          }
          break;
        }
        case 'climb':
        case 'eat': {
          if (!hostOk || ending) {
            // the host is gone (or the swarm is done): jump off
            s.state = 'fall';
            s.t = 0;
            s.vy = 1.5 + rnd.next() * 2;
            if (host) this.flank(host, s.att, s.h, s.p);
            else _by.set(Math.sin(s.att), 0, Math.cos(s.att));
            s.out.copy(_by);
            break;
          }
          const hh = host!;
          s.att += Math.sin(this.time * 2.1 + s.wob) * dt * 0.9;
          if (s.state === 'climb') {
            s.h += (dt * S.climbSpeed) / Math.max(0.4, hh.height);
            s.gait += dt * 6;
            if (s.h >= s.hT) {
              s.state = 'eat';
              s.t = 0;
            }
          } else {
            s.h = clamp(s.h + Math.sin(this.time * 2.7 + s.wob * 3) * dt * 0.12, 0.04, 0.98);
            s.gait += dt * 1.5;
          }
          this.flank(hh, s.att, s.h, s.p);
          onHost.set(hh, (onHost.get(hh) ?? 0) + (s.state === 'eat' ? 1 : 0.5));
          break;
        }
        case 'fall': {
          s.vy -= 22 * dt;
          s.p.addScaledVector(s.out, 1.8 * dt);
          s.p.y += s.vy * dt;
          const g = ctx.world.groundAt(s.p.x, s.p.z);
          if (s.p.y <= g) {
            s.p.y = g;
            s.state = ending ? 'dive' : 'run';
            s.t = 0;
            s.host = ending ? null : this.nextHost(s.p);
            s.yaw = Math.atan2(s.out.x, s.out.z);
          }
          break;
        }
        case 'dive': {
          // a last scuttle, then nose down into the sand
          const k = s.t / 0.55;
          if (k < 0.35) {
            s.p.x += Math.sin(s.yaw) * s.spd * 0.6 * dt;
            s.p.z += Math.cos(s.yaw) * s.spd * 0.6 * dt;
            s.gait += dt * 14;
          }
          s.p.y = ctx.world.groundAt(s.p.x, s.p.z);
          if (s.t > 0.2 && s.t - dt <= 0.2 && kicks++ < 12) ctx.fx.sandSpray(s.p, { x: 0, y: 1.6, z: 0 }, 0.35);
          if (k >= 1) this.scarabs.splice(i, 1);
          break;
        }
      }
    }
    // ---- feeding: every body with scarabs on it is eaten alive
    let feeding = 0;
    for (const [host, n] of onHost) {
      if (n < 1) continue;
      feeding++;
      const tk = (this.feastT.get(host.id) ?? 0.12) - dt;
      if (tk > 0) {
        this.feastT.set(host.id, tk);
        continue;
      }
      this.feastT.set(host.id, S.tick);
      const at = new THREE.Vector3(host.pos.x, host.pos.y + host.height * 0.55, host.pos.z);
      this.foes.feed?.(host, n);
      ctx.enemies.damage(host, { base: Math.min(S.dpsCap, S.dpsBase + n * S.dpsPerScarab) * S.tick, kind: 'magic', source: 'swarm', status: [{ id: 'slow', stacks: 2, dur: 1 }, { id: 'bleed', stacks: 1, dur: 2, chance: 0.25 }], canCrit: false }, at);
      this.stripFx(host, n * 3, at);
      if (this.time - this.shredSfxT > 0.16) ctx.sfx('gore_splat', at, 0.22, 1.5 + rnd.next() * 0.2);
    }
    if (this.feastT.size > 64) this.feastT.clear();
    if (this.swarmLoop) this.swarmLoop.setVolume(0.45 + Math.min(0.5, feeding * 0.12) + (ending ? -0.3 : 0), 0.3);
  }

  /** push the horde into the jade-scarab rig batch (called inside the enemy render pass) */
  private drawScarabs(render: EnemyRender) {
    if (!this.scarabs.length) return;
    const batch = render.get(SCARAB_RIG, 320);
    const ix = batch.partIndex;
    const cam = this.ctx.camera.position;
    const t = this.time;
    for (const s of this.scarabs) {
      if (s.state === 'wait') continue;
      if (!s.rot) s.rot = new Float32Array(batch.nParts * 3);
      const rot = s.rot;
      rot.fill(0);
      const set = (name: string, x: number, y: number, z: number) => {
        const i = ix[name];
        if (i === undefined) return;
        rot[i * 3] = x;
        rot[i * 3 + 1] = y;
        rot[i * 3 + 2] = z;
      };
      const onBody = (s.state === 'climb' || s.state === 'eat') && !!s.host;
      let pos = s.p;
      if (onBody) {
        // belly to the body, head up its flank, wandering a little around the normal
        const a = ((s.host as Foe).yaw ?? 0) + s.att;
        _by.set(Math.sin(a), 0, Math.cos(a));
        _bz.set(Math.cos(a) * Math.sin(s.wob + t * 0.7) * 0.5, 1, -Math.sin(a) * Math.sin(s.wob + t * 0.7) * 0.5).normalize();
        _bx.crossVectors(_by, _bz).normalize();
        _bz.crossVectors(_bx, _by);
        _m4.makeBasis(_bx, _by, _bz);
        _q.setFromRotationMatrix(_m4);
      } else {
        _q.setFromAxisAngle(UP, s.yaw);
        if (s.state === 'emerge') _q.multiply(_qa.setFromAxisAngle(AX, -0.7 * (1 - Math.min(1, s.t / 0.3))));
        else if (s.state === 'dive') {
          const k = Math.max(0, (s.t / 0.55 - 0.3) / 0.7);
          _q.multiply(_qa.setFromAxisAngle(AX, 0.9 * Math.min(1, k * 2)));
          pos = _v3.copy(s.p);
          pos.y -= k * 0.32 * s.sc;
        } else if (s.state === 'fall') _q.multiply(_qa.setFromAxisAngle(AX, s.t * 9));
      }
      _v2.set(s.sc, s.sc, s.sc);
      _m4.compose(pos, _q, _v2);
      // legs: an alternating tripod, fast while running, a creep while climbing, kicking in the air
      const moving = s.state === 'run' || s.state === 'climb' || s.state === 'dive' ? 1 : s.state === 'eat' ? 0.35 : 0;
      const air = s.state === 'fall' || s.state === 'emerge' ? 1 : 0;
      for (let k = 1; k <= 3; k++) {
        for (const side of [1, -1]) {
          const ph = s.gait * TAU + ((k + (side > 0 ? 0 : 1)) % 2) * Math.PI;
          const sweep = Math.sin(ph) * 0.45 * moving;
          const lift = Math.max(0, Math.cos(ph)) * 0.4 * moving + air * (0.4 + Math.sin(t * 30 + k * 2 + side) * 0.3);
          set((side > 0 ? 'leg_l' : 'leg_r') + k, 0, -side * sweep, side * lift);
        }
      }
      // mandibles chewing, antennae twitching, wing cases cracking open in the air
      const chew = s.state === 'eat' ? Math.max(0, Math.sin(t * 22 + s.wob * 7)) : 0.1;
      set('jaw', chew * 0.35, 0, 0);
      set('mandible_l', 0, -chew * 0.45, 0);
      set('mandible_r', 0, chew * 0.45, 0);
      const ant = Math.sin(t * 6 + s.wob * 5) * 0.2;
      set('antenna_l', ant, 0, 0.1);
      set('antenna_r', -ant, 0, -0.1);
      const wing = air * (0.7 + Math.sin(t * 55 + s.wob) * 0.25);
      set('wing_l', 0, 0, wing);
      set('wing_r', 0, 0, -wing);
      const d = cam.distanceTo(pos);
      batch.push(_m4, rot, null, d > 34 ? 2 : d > 14 ? 1 : 0, FX0, WHITE, null);
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

  // ===================================================================== CAST CAMERA
  /**
   * Snappy camera beats on a cast: a hard cut to an angle on Sundown's pose at
   * slight slow-mo (0.4–0.65 s real), then either a hard cut back to play or a
   * beat on what the cast set loose (the boiling sand, the bomb in flight).
   * Skipped mid-air, while aiming down sights, with a body right on top of him,
   * during someone else's shot (ult, intros), and within minGap of the last one.
   */
  private cineOk() {
    const pl = this.player;
    if (!CAST_CINE.enabled || !pl.alive || !pl.board.grounded || pl.aiming) return false;
    if (pl.cam.cine) return false;
    if (this.ctx.engine.realTime - this.cineLast < CAST_CINE.minGap) return false;
    return !this.ctx.enemies.nearest(pl.pos, CAST_CINE.clearance);
  }

  private cineStart(kind: CineKind, dur: number, at?: THREE.Vector3) {
    if (!this.cineOk()) return;
    this.cine = { kind, t: 0, dur, at: (at ?? this.player.pos).clone(), shot: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 } };
    this.cineLast = this.ctx.engine.realTime;
    this.ctx.engine.slowMo(CAST_CINE.slow, 30);
    this.frameCine();
  }

  /** chain to the next beat of a running cine (no-op if the cast wasn't filmed) */
  private cineSwitch(kind: CineKind, dur: number, at?: THREE.Vector3) {
    const c = this.cine;
    if (!c) return;
    c.kind = kind;
    c.t = 0;
    c.dur = dur;
    if (at) c.at.copy(at);
    this.frameCine();
  }

  private cineEnd() {
    if (!this.cine) return;
    const shot = this.cine.shot;
    this.cine = null;
    if (this.player.cam.cine === shot) this.player.cam.setCine(null, false);
    this.ctx.engine.slowMo(1, 12);
  }

  private updateCine() {
    const now = this.ctx.engine.realTime;
    const rdt = Math.min(0.1, Math.max(0, now - this.lastReal));
    this.lastReal = now;
    const c = this.cine;
    if (!c) return;
    const pl = this.player;
    // something bigger took the camera (the ult, a cutscene): let it have it
    if (pl.cam.cine && pl.cam.cine !== c.shot) {
      this.cine = null;
      return;
    }
    c.t += rdt;
    if (c.t >= c.dur || !pl.alive || this.ctx.engine.paused) {
      this.cineEnd();
      return;
    }
    // no firing blind and no cheap hits while the view is away
    pl.fireCd = Math.max(pl.fireCd, 0.06);
    pl.invuln = Math.max(pl.invuln, 0.12);
    this.frameCine();
  }

  /** place this frame's shot relative to Sundown (he keeps riding) / the subject */
  private frameCine() {
    const c = this.cine;
    if (!c) return;
    const pl = this.player;
    const s = c.shot;
    const k = Math.min(1, c.t / c.dur);
    const ch = pl.center(_v3);
    const yaw = pl.cam.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    switch (c.kind) {
      case 'flick': {
        // low three-quarter front from his right, looking past him down the throw
        const d = 2.4 - k * 0.35;
        s.pos.set(ch.x + rx * d + fx * 1.1, ch.y + 0.05, ch.z + rz * d + fz * 1.1);
        s.look.set(ch.x + fx * 1.8, ch.y + 0.25, ch.z + fz * 1.8);
        s.fov = 52 - k * 4;
        break;
      }
      case 'grenade': {
        // over the right shoulder, high and out: the wind-up and the arc leaving
        s.pos.set(ch.x - fx * 1.25 + rx * (2 - k * 0.3), ch.y + 0.8, ch.z - fz * 1.25 + rz * (2 - k * 0.3));
        s.look.set(ch.x + fx * 4, ch.y + 0.6, ch.z + fz * 4);
        s.fov = 56;
        break;
      }
      case 'whistle': {
        // push in on the skull as he whistles
        const hx = ch.x, hy = ch.y + 0.5, hz = ch.z;
        const d = 1.45 - k * 0.3;
        s.pos.set(hx + fx * d + rx * 0.62, hy - 0.02, hz + fz * d + rz * 0.62);
        s.look.set(hx, hy + 0.04, hz);
        s.fov = 44 - k * 3;
        break;
      }
      case 'boil': {
        // the sand bursting at the prey, seen from the hunter's side, drifting
        const b = c.at;
        let dx = b.x - ch.x, dz = b.z - ch.z;
        const L = Math.hypot(dx, dz) || 1;
        dx /= L;
        dz /= L;
        const back = Math.min(6, L * 0.6);
        s.pos.set(b.x - dx * back - dz * (2 + k * 0.7), b.y + 2.3, b.z - dz * back + dx * (2 + k * 0.7));
        s.look.set(b.x, b.y + 0.45, b.z);
        s.fov = 56;
        break;
      }
      case 'bomb': {
        // ride along behind the ball
        const bomb = this.bombs[this.bombs.length - 1];
        if (!bomb) {
          this.cineEnd();
          return;
        }
        const hs = Math.hypot(bomb.vel.x, bomb.vel.z) || 1;
        const vx = bomb.vel.x / hs, vz = bomb.vel.z / hs;
        s.pos.set(bomb.pos.x - vx * 3.2 + vz * 0.8, bomb.pos.y + 1.3, bomb.pos.z - vz * 3.2 - vx * 0.8);
        s.look.set(bomb.pos.x + vx * 1.5, bomb.pos.y - 0.2, bomb.pos.z + vz * 1.5);
        s.fov = 58;
        break;
      }
    }
    // never inside a dune
    s.pos.y = Math.max(s.pos.y, this.ctx.world.groundAt(s.pos.x, s.pos.z) + 0.4);
    pl.cam.setCine(s, false);
  }

  // ===================================================================== DUNG BOMB
  throwBomb(echo = false) {
    if (!echo) {
      this.bombCharges--;
      if (this.bombRecharge <= 0) this.bombRecharge = this.constants.bombRecharge * (1 - this.stats.get('cdr'));
    }
    const pl = this.player;
    const aim = pl.aimPoint.clone();
    if (!echo) {
      pl.castAim = aim;
      pl.playAction('grenade', CAST_POSE.grenade.dur);
      pl.express('determined', 0.7);
      this.cineStart('grenade', 0.62);
      this.ctx.sfx('dung_kick', pl.pos, 0.3, 0.8);
    }
    // it leaves the hand at the top of the overhand whip
    this.ctx.engine.tweens.after(echo ? 0.02 : CAST_POSE.grenade.dur * CAST_POSE.grenade.release, () => this.launchBomb(echo, aim));
  }

  private launchBomb(echo: boolean, aim: THREE.Vector3) {
    const pl = this.player;
    if (!pl.alive) return;
    const ctx = this.ctx;
    const Bt = SKILL_TUNE.bomb;
    const o = this.handPoint('hand_l', new THREE.Vector3());
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
    pl.smear(o.clone(), 1.2);
    this.castKick(0.012, -0.008, 0.9);
    // the camera rides along behind it for a beat
    if (!echo && this.cine?.kind === 'grenade' && CAST_CINE.followBomb) this.cineSwitch('bomb', 0.5);
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
