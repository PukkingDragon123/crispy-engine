// Ultimate: STAIRWAY TO SERKET (XIII DEATH, the card of transformation).
// Pinch is Serket in small form; the ultimate lets her grow. A burst cutscene in
// the Genshin manner: time crawls around the cast, the camera whips round
// Sundown, Pinch leaps off his hat and swells into a colossal beast scorpion
// (her own rig, scaled up) in an eruption of sand, the title slams in as cast
// voxel letters, she speaks (floating 3D words, voiced), roars, and play
// resumes with the beast fighting beside the hunter: tail strikes on the
// thickest crowds, claw sweeps, and a closing venom nova over a huge radius.
// Then she shrinks back into Pinch.
//
// Charge is a long cooldown that fills from time AND from attacking (hits,
// kills, streaks, style): run/Balance.ULT. The HUD shows it as the ultimate
// card (cardState). Voice hook for the audio worker: Ultimate.onVoice.
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../Ctx';
import type { Player } from './Player';
import type { Qte } from '../ui/Qte';
import type { CameraRig, CineShot } from './CameraRig';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import { Ease } from '../../engine/Tween';
import { P } from '../../engine/voxel/palette';
import { dampAngle, rnd } from '../../engine/math/rand';
import type { HeroUlt } from './heroes/HeroKit';
import { PinchMotion } from './PinchMotion';
import { VoxelWord } from '../cine/VoxelLetters';
import { speak3D } from '../fx/WorldSpeech';
import { ULT, ultKillGain, ultSecondsLeft } from '../run/Balance';

export type UltVariant = 'wrath' | 'detonation' | 'plague';

/** the ultimate's name: Led Zeppelin's stairway, climbed by the scorpion goddess */
export const ULT_NAME = 'Stairway to Serket';
/** the ultimate as a tarot card (the HUD deals it with the skill cards) */
export const ULT_CARD = { key: 'Z', num: 'XIII', title: 'DEATH', name: ULT_NAME, desc: 'Pinch grows into Serket the beast: tail strikes, claw sweeps and a venom nova over a huge radius.' };

export const ULT_INFO: Record<UltVariant, { name: string; desc: string }> = {
  wrath: { name: ULT_NAME, desc: ULT_CARD.desc },
  detonation: { name: `${ULT_NAME}: Venom Crown`, desc: 'The closing nova detonates every poison stack it touches.' },
  plague: { name: `${ULT_NAME}: Locust Choir`, desc: 'The closing nova lets loose a storm of locusts for 6 s.' },
};

/** the beast's numbers (damage before the magic stat; radii in metres) */
export const BEAST = {
  scale: 11,
  dur: 8,
  every: 0.78,
  reach: 26,
  strikeR: 4.8,
  strikeDmg: 150,
  sweepR: 10,
  sweepArc: 1.2,
  sweepDmg: 110,
  novaR: 26,
  novaDmg: 240,
};

/** spoken at the cast (the audio worker can voice them; the words float either way) */
export const ULT_LINES = ['Climb with me, little hunter.', 'Now you see what lives on your hat.', 'Kneel, all of you. Serket walks.'];

/** kept for older callers: the soul numbers are run/Balance.ULT now */
export const SOUL = ULT;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

type Atk = { kind: 'strike' | 'sweep' | 'nova'; t: number; at: THREE.Vector3; done: boolean };

export class Ultimate {
  static current: Ultimate | null = null;
  /** where Pinch lives (Skills registers itself): hidden while she is the beast */
  static pinchHost: { pinchRoot: THREE.Object3D; pinch: RigInstance | null } | null = null;
  /** audio hook: called with a cue ('cast', 'roar', 'nova') and the spoken line, if any */
  static onVoice: ((cue: string, line?: string) => void) | null = null;
  active = false;
  avatar: RigInstance | null = null;
  variant: UltVariant = 'wrath';
  multiKill = 0;
  private multiT = -99;
  hero: HeroUlt | null = null;
  /** card hooks: charge speed and extra beast time (Bohemian Rhapsody) */
  chargeMul = 1;
  durBonus = 0;
  /** seconds of beast left (0 when not out) */
  beastLeft = 0;
  private hitSpent = 0;
  private hitWin = 0;
  private motion: PinchMotion | null = null;
  private holder = new THREE.Group();
  private yaw = 0;
  private atk: Atk | null = null;
  private atkCd = 0;
  private atkN = 0;
  private title: VoxelWord | null = null;
  private frameFn: ((dt: number, rdt: number) => void) | null = null;
  private glow = 0;
  private lineI = 0;

  constructor(private ctx: Ctx, private player: Player, private qte: Qte, private cam: CameraRig) {
    Ultimate.current = this;
    void this.qte;
    ctx.events.on('enemyHit', (_e: EnemyLike, hit: { source?: string }) => {
      if (!hit || this.active) return;
      const s = hit.source;
      if (s !== 'gun' && s !== 'melee' && s !== 'board' && s !== 'grapple' && s !== 'scorpion' && s !== 'divine') return;
      const g = Math.min(ULT.hit, ULT.hitCap - this.hitSpent);
      if (g <= 0) return;
      this.hitSpent += g;
      this.addSoul(g);
    });
  }

  get rate() {
    return this.player.stats.get('ultCharge') * this.chargeMul;
  }

  /** pour charge in (scaled by the ultCharge stat and cards); ignored while the ultimate runs */
  addSoul(v: number) {
    if (this.active || v <= 0) return;
    const run = this.ctx.run;
    const was = run.ultCharge;
    run.ultCharge = Math.min(1, run.ultCharge + v * this.rate);
    if (was < 1 && run.ultCharge >= 1) {
      this.ctx.events.emit('ultReady');
      this.ctx.sfx('divine_chime', null, 0.6, 0.8);
    }
  }

  /** time fills the charge on its own (called every frame of play) */
  tickTime(dt: number) {
    this.hitWin += dt;
    if (this.hitWin >= 1) {
      this.hitWin = 0;
      this.hitSpent = 0;
    }
    if (!this.active && dt > 0) this.addSoul(dt / ULT.time);
  }

  /** the HUD's ultimate card */
  cardState() {
    const c = Math.min(1, this.ctx.run.ultCharge);
    return { ...ULT_CARD, frac: c, ready: c >= 1 && !this.active, active: this.active, beastLeft: this.beastLeft, secsLeft: ultSecondsLeft(c, this.rate) };
  }

  /** a kill; `streak` is the kill streak including this kill (run.combo) */
  chargeKill(streak: number, alpha = false) {
    const now = this.ctx.run.time;
    this.multiKill = now - this.multiT <= ULT.multiWindow ? this.multiKill + 1 : 1;
    this.multiT = now;
    this.addSoul(ultKillGain(streak, this.multiKill, alpha));
  }

  chargeStyle(score: number) {
    this.addSoul(Math.max(0, score) * ULT.style);
  }

  chargeGraze() {
    this.addSoul(ULT.graze);
  }

  chargeBoss() {
    this.addSoul(ULT.boss);
  }

  private ensureBeast() {
    if (this.avatar) return this.avatar;
    const spec = modelEntry('pinch')?.() as RigSpec | undefined;
    if (!spec?.parts) return null;
    // Serket's own rig (Pinch's), built once, with its own material for the divine glow
    this.avatar = new RigInstance(buildRigGeo(spec, 'pinch:player'), { ownMaterial: true });
    this.avatar.material.userData.tint.value.setRGB(0.92, 1.04, 0.88);
    this.avatar.root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.holder.add(this.avatar.root);
    this.motion = new PinchMotion(this.avatar);
    return this.avatar;
  }

  /** the densest crowd within `maxD` of `from` (bosses weigh more) */
  private bestCluster(from: THREE.Vector3, maxD: number, r = 6): { at: THREE.Vector3; n: number } | null {
    const list = this.ctx.enemies.list.filter((e) => e.alive && Math.hypot(e.pos.x - from.x, e.pos.z - from.z) < maxD);
    let best: EnemyLike | null = null, bestN = 0;
    for (const e of list) {
      let n = 0;
      for (const o of list) if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < r) n += o.isBoss ? 5 : 1;
      if (n > bestN) {
        bestN = n;
        best = e;
      }
    }
    return best ? { at: best.pos.clone(), n: bestN } : null;
  }

  private voice(cue: string, line?: string, at?: THREE.Object3D) {
    Ultimate.onVoice?.(cue, line);
    if (!line || !at) return;
    try {
      speak3D(this.ctx.engine, 'serket', line, at, { key: 'ult:serket', lift: 1.4, size: 0.24, px: 64, wrap: 30, color: '#e9ffe9', glow: '#2f7a4a', hdr: 1.1, hold: 2.4 });
    } catch {
      /* the words are a garnish */
    }
  }

  async trigger() {
    if (this.active) return;
    const ctx = this.ctx;
    const eng = ctx.engine;
    if (this.hero) {
      this.active = true;
      ctx.run.ultCharge = 0;
      this.player.invuln = 999;
      eng.input.enabled = false;
      eng.letterbox(true, 0.4);
      eng.slowMo(0.08, 20);
      ctx.sfx('ult_activate', null, 1);
      ctx.events.emit('cutin', this.hero.name.toUpperCase(), '#cfe2ff', 'angry');
      await this.hero.run();
      eng.slowMo(1, 5);
      eng.letterbox(false, 0.5);
      this.cam.setCine(null);
      eng.input.enabled = true;
      this.player.invuln = 1.2;
      this.active = false;
      return;
    }
    const av = this.ensureBeast();
    if (!av) return;
    this.active = true;
    ctx.run.ultCharge = 0;
    try {
      await this.cinematic(av);
      await this.rampage(av);
    } finally {
      this.cleanup();
    }
  }

  // ------------------------------------------------------------------ the burst cutscene (real time)
  private async cinematic(av: RigInstance) {
    const ctx = this.ctx;
    const eng = ctx.engine;
    const pl = this.player;
    pl.invuln = 999;
    eng.input.enabled = false;
    eng.letterbox(true, 0.25);
    eng.slowMo(0.1, 30);
    ctx.sfx('ult_activate', null, 1);
    ctx.sfx('time_slow', null, 0.6, 0.8);
    pl.express('smug', 4);
    pl.playAction('ult', 1.6);
    this.voice('cast');
    const host = Ultimate.pinchHost;
    const from = new THREE.Vector3();
    if (host?.pinch) host.pinch.root.getWorldPosition(from);
    else pl.center(from).add(_v.set(0, 0.9, 0));
    if (host) host.pinchRoot.visible = false;
    // where the beast will stand: beside and a little behind the hunter
    const fwd = new THREE.Vector3(Math.sin(this.cam.yaw), 0, Math.cos(this.cam.yaw)).multiplyScalar(-1);
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const base = pl.pos.clone().addScaledVector(side, 5).addScaledVector(fwd, -2.5);
    base.y = ctx.world.groundAt(base.x, base.z);
    this.yaw = Math.atan2(-fwd.x, -fwd.z);
    this.holder.position.copy(from);
    this.holder.rotation.set(0, this.yaw, 0);
    this.holder.scale.setScalar(0.15);
    ctx.scene.add(this.holder);
    this.holder.visible = false;
    let last = eng.realTime;
    this.frameFn = (_dt, rdt) => this.frame(rdt);
    eng.onAfterUpdate.push(this.frameFn);
    const chest = pl.center(new THREE.Vector3());
    const shot: CineShot = { pos: chest.clone(), look: chest.clone(), fov: 46 };
    this.cam.setCine(shot, false);
    // 1. the whip-pan orbit round Sundown; Pinch glows on his hat and leaps
    const a0 = this.cam.yaw + 0.5;
    await eng.tweens.tween(1.05, (k) => {
      const a = a0 + k * Math.PI * 1.2;
      const R = 2.6 + k * 1.2;
      pl.center(chest);
      shot.pos.set(chest.x + Math.sin(a) * R, chest.y + 0.2 + k * 0.6, chest.z + Math.cos(a) * R);
      shot.look.copy(chest).add(_v.set(0, 0.25, 0));
      shot.fov = 46 - k * 6;
      const now = eng.realTime;
      if (now - last > 0.12) {
        last = now;
        ctx.fx.sparkle(from, 0x9dff3a, 4, 0.5);
      }
      if (k > 0.6 && !this.holder.visible) {
        this.holder.visible = true;
        ctx.fx.sparkle(from, 0xd8ffb0, 18, 1.1);
        ctx.sfx('scorpion_chitter', from, 0.8, 0.7);
      }
    }, Ease.inOutCubic, true);
    // 2. she swells into the beast in an eruption of sand
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      ctx.fx.sandBurst({ x: base.x + Math.cos(a) * 5, y: base.y, z: base.z + Math.sin(a) * 5 }, 1.4);
    }
    ctx.fx.dust({ x: base.x, y: base.y + 1, z: base.z }, 5, P.sand0, 12);
    ctx.events.emit('groundMark', base.x, base.z, 6, 1);
    ctx.sfx('quake_rumble', base, 1);
    ctx.sfx('spectral_scorpion', base, 1, 0.8);
    this.glow = 3;
    const camFrom = shot.pos.clone();
    const low = pl.pos.clone().addScaledVector(side, -4.5).addScaledVector(fwd, -5);
    low.y = ctx.world.groundAt(low.x, low.z) + 1.1;
    await eng.tweens.tween(1.0, (k) => {
      const e = Ease.outBack(k);
      this.holder.scale.setScalar(0.15 + (BEAST.scale - 0.15) * e);
      this.holder.position.lerpVectors(from, base, Math.min(1, k * 1.6));
      shot.pos.lerpVectors(camFrom, low, Ease.outCubic(k));
      shot.look.copy(this.holder.position).add(_v.set(0, 2.2 + k * 2.6, 0));
      shot.fov = 40 + k * 30;
      ctx.shake(0.15 + k * 0.25);
      if (k > 0.2 && !this.title) this.showTitle();
    }, Ease.linear, true);
    // 3. she speaks, then roars
    const head = av.sockets['head_top'] ?? this.holder;
    this.voice('line', ULT_LINES[this.lineI++ % ULT_LINES.length], head);
    this.motion?.snap();
    ctx.sfx('boss_roar', base, 0.9, 0.75);
    this.voice('roar');
    ctx.shake(0.9);
    await eng.tweens.wait(0.75, true);
    this.title?.leave('crumble');
    // 4. back to play
    eng.slowMo(1, 6);
    eng.letterbox(false, 0.4);
    this.cam.setCine(null);
    eng.input.enabled = true;
    pl.invuln = 1.5;
  }

  /** the title card: cast voxel letters slammed in front of the lens */
  private showTitle() {
    const cam = this.ctx.camera;
    const w = new VoxelWord('STAIRWAY\nTO SERKET', { height: 0.34, style: 'jade', fog: false, castShadow: false, glow: 0.6, track: 0.08 });
    cam.getWorldDirection(_v);
    w.group.position.copy(cam.position).addScaledVector(_v, 5.2).add(_w.set(0, -0.55, 0));
    w.group.quaternion.copy(cam.quaternion);
    w.group.renderOrder = 980;
    this.ctx.scene.add(w.group);
    w.enter('slam', 0.035);
    this.title = w;
  }

  /** per real frame: the title card, the beast's glow */
  private frame(rdt: number) {
    const t = this.title;
    if (t) {
      t.update(rdt);
      if (t.done) {
        t.group.removeFromParent();
        t.dispose();
        this.title = null;
      }
    }
    if (this.avatar) {
      this.glow = Math.max(0.6, this.glow - rdt * 2.5);
      const fx = this.avatar.material.userData.fx?.value as THREE.Vector4 | undefined;
      if (fx) fx.z = this.glow;
    }
  }

  // ------------------------------------------------------------------ the beast fights (game time)
  private async rampage(av: RigInstance) {
    const eng = this.ctx.engine;
    const dur = BEAST.dur + this.durBonus;
    this.beastLeft = dur;
    this.atk = null;
    this.atkCd = 0.2;
    this.atkN = 0;
    let lastT = 0;
    await eng.tweens.tween(dur, (k) => {
      const t = k * dur;
      const dt = Math.min(0.1, t - lastT);
      lastT = t;
      this.beastLeft = dur - t;
      if (dt > 0) this.beastStep(av, dt, dur - t);
    }, Ease.linear, false);
    // the closing venom nova
    await this.nova(av);
    // she shrinks back into Pinch
    const from = this.holder.position.clone();
    const s0 = this.holder.scale.x;
    this.ctx.fx.sparkle(this.player.center(_v).clone(), 0x9dff3a, 14, 1);
    await eng.tweens.tween(0.55, (k) => {
      this.holder.scale.setScalar(s0 + (0.15 - s0) * Ease.inCubic(k));
      this.holder.position.lerpVectors(from, this.player.center(_v).add(_w.set(0, 0.9, 0)), Ease.inCubic(k));
    }, Ease.linear, true);
  }

  private beastStep(av: RigInstance, dt: number, left: number) {
    const ctx = this.ctx;
    const pl = this.player;
    const h = this.holder;
    // pick the next blow
    this.atkCd -= dt;
    if (!this.atk && this.atkCd <= 0 && left > 0.5) {
      const near = this.bestCluster(h.position, BEAST.sweepR * 0.9, 5);
      const far = this.bestCluster(pl.pos, BEAST.reach);
      if (near && near.n >= 2 && this.atkN % 3 === 2) this.atk = { kind: 'sweep', t: 0, at: near.at, done: false };
      else if (far) this.atk = { kind: 'strike', t: 0, at: far.at, done: false };
      if (this.atk) {
        this.atkN++;
        this.atkCd = BEAST.every;
      }
    }
    // where to stand: within striking reach of the blow, else at the hunter's side
    const want = _v;
    if (this.atk) {
      want.copy(this.atk.at);
      const dx = h.position.x - want.x, dz = h.position.z - want.z;
      const d = Math.hypot(dx, dz) || 1;
      const keep = this.atk.kind === 'sweep' ? 4 : 5.5;
      want.x += (dx / d) * keep;
      want.z += (dz / d) * keep;
    } else {
      const fx = Math.sin(this.cam.yaw), fz = Math.cos(this.cam.yaw);
      want.set(pl.pos.x - fz * 5 + fx * 2, 0, pl.pos.z + fx * 5 + fz * 2);
    }
    const ox = h.position.x, oz = h.position.z;
    const lunge = this.atk ? 14 : 9;
    const mx = want.x - ox, mz = want.z - oz;
    const md = Math.hypot(mx, mz);
    const step = Math.min(md, lunge * dt);
    if (md > 0.05) {
      h.position.x += (mx / md) * step;
      h.position.z += (mz / md) * step;
    }
    h.position.y = ctx.world.groundAt(h.position.x, h.position.z);
    const look = this.atk ? this.atk.at : md > 0.5 ? want : pl.aimPoint;
    const ty = Math.atan2(look.x - h.position.x, look.z - h.position.z);
    const prevYaw = this.yaw;
    this.yaw = dampAngle(this.yaw, ty, this.atk ? 9 : 4, dt);
    h.rotation.y = this.yaw;
    const len = 0.65 * h.scale.x;
    this.motion?.update(dt, { speed: step / dt / len, turn: (this.yaw - prevYaw) / Math.max(1e-3, dt), mode: this.atk ? 'sting' : 'leap', alert: 1, fidget: false });
    if (step > 0.02 && Math.random() < dt * 6) ctx.fx.dust({ x: h.position.x, y: h.position.y + 0.3, z: h.position.z }, 2.2, P.sand0, 3);
    // the blow itself, posed on top of the gait
    const a = this.atk;
    if (!a) return;
    a.t += dt;
    const n = av.nodes;
    if (a.kind === 'strike') {
      // the tail cocks back, then whips over the head into the crowd
      const cock = Math.min(1, a.t / 0.22), hit = Math.max(0, Math.min(1, (a.t - 0.22) / 0.1)), back = Math.max(0, (a.t - 0.45) / 0.3);
      const k = (cock * 0.6 - hit * 1.6) * (1 - Math.min(1, back));
      [0.25, -0.15, -0.25, -0.3, -0.2].forEach((m, i) => n['tail' + (i + 1)]?.rotateX(m * k));
      n['body']?.rotateX(hit * 0.12 * (1 - Math.min(1, back)));
      if (!a.done && a.t >= 0.3) {
        a.done = true;
        this.strike(a.at);
      }
      if (a.t > 0.75) this.atk = null;
    } else if (a.kind === 'sweep') {
      // both claws swing out wide, then scythe across the front
      const wind = Math.min(1, a.t / 0.25), swing = Math.max(0, Math.min(1, (a.t - 0.25) / 0.14)), back = Math.max(0, Math.min(1, (a.t - 0.5) / 0.3));
      const k = (wind * 0.9 - swing * 1.9) * (1 - back);
      n['arm_l']?.rotateY(k * 0.5);
      n['arm_r']?.rotateY(-k * 0.5);
      n['pincer_l']?.rotateY(-wind * 0.4 * (1 - back));
      n['pincer_r']?.rotateY(wind * 0.4 * (1 - back));
      if (!a.done && a.t >= 0.32) {
        a.done = true;
        this.sweep();
      }
      if (a.t > 0.8) this.atk = null;
    }
  }

  private strike(at: THREE.Vector3) {
    const ctx = this.ctx;
    const y = ctx.world.groundAt(at.x, at.z);
    const p = { x: at.x, y: y + 0.4, z: at.z };
    this.glow = 2.4;
    ctx.fx.explosion(p, BEAST.strikeR * 0.55, 'poison');
    ctx.fx.sandBurst(p, 1.6);
    ctx.sfx('scorpion_sting', p, 1, 0.55);
    ctx.sfx('explosion', p, 0.7, 0.8);
    ctx.shake(0.45);
    ctx.engine.hitStop(0.04);
    ctx.world.deform(at.x, at.z, BEAST.strikeR * 0.4, 0.9);
    ctx.events.emit('groundMark', at.x, at.z, BEAST.strikeR, 3);
    ctx.enemies.inRadius(_w.set(at.x, y, at.z), BEAST.strikeR, (e) =>
      ctx.enemies.damage(e, { base: BEAST.strikeDmg, kind: 'magic', source: 'ult', knock: 12, canCrit: true, tags: ['beast'], status: [{ id: 'poison', stacks: 6, dur: 6, power: 2.5 }, { id: 'stun', stacks: 1, dur: 0.6 }] }),
    );
  }

  private sweep() {
    const ctx = this.ctx;
    const h = this.holder.position;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.glow = 2;
    ctx.sfx('whoosh_big', h, 1, 0.6);
    ctx.shake(0.35);
    for (let i = -3; i <= 3; i++) {
      const a = this.yaw + (i / 3) * BEAST.sweepArc;
      const d = BEAST.sweepR * 0.75;
      ctx.fx.sandSpray({ x: h.x + Math.sin(a) * d, y: h.y + 0.1, z: h.z + Math.cos(a) * d }, { x: Math.cos(a) * 6 * Math.sign(-i || 1), y: 2, z: -Math.sin(a) * 6 * Math.sign(-i || 1) }, 1.4);
    }
    ctx.enemies.inRadius(h, BEAST.sweepR, (e) => {
      const dx = e.pos.x - h.x, dz = e.pos.z - h.z;
      const d = Math.hypot(dx, dz) || 1;
      if ((dx * fx + dz * fz) / d < Math.cos(BEAST.sweepArc)) return;
      ctx.enemies.damage(e, { base: BEAST.sweepDmg, kind: 'phys', source: 'ult', knock: 18, dirX: dx / d, dirZ: dz / d, canCrit: true, tags: ['beast'], status: [{ id: 'stun', stacks: 1, dur: 0.8 }, { id: 'bleed', stacks: 2, dur: 4 }] });
    });
  }

  private async nova(av: RigInstance) {
    const ctx = this.ctx;
    const eng = ctx.engine;
    const h = this.holder.position.clone();
    // she rears up, tail to the sky, and the venom gathers
    ctx.sfx('spectral_scorpion', h, 0.9, 0.7);
    await eng.tweens.tween(0.45, (k) => {
      av.nodes['body']?.rotateX(-0.35 * k);
      for (let i = 1; i <= 5; i++) av.nodes['tail' + i]?.rotateX(-0.12 * k);
      this.glow = 1 + k * 3;
      if (Math.random() < 0.5) ctx.fx.sparkle(_v.copy(h).add(_w.set((Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6)), 0x9dff3a, 3, 0.6);
    }, Ease.inQuad, false);
    this.voice('nova');
    const p = { x: h.x, y: h.y + 0.5, z: h.z };
    ctx.fx.explosion(p, 6, 'poison');
    ctx.fx.ring({ x: h.x, y: h.y + 0.3, z: h.z }, P.serket, BEAST.novaR * 2, 0.9);
    ctx.fx.dust(p, 8, P.sand0, 14);
    ctx.sfx('explosion_big', p, 1);
    ctx.sfx('poison_burst', p, 1, 0.7);
    ctx.shake(1);
    eng.hitStop(0.08);
    ctx.world.deform(h.x, h.z, 4, 1.2);
    ctx.events.emit('groundMark', h.x, h.z, 8, 3);
    const det = this.variant === 'detonation';
    ctx.enemies.inRadius(h, BEAST.novaR, (e) => {
      const st = det ? ((e as unknown as { status?: { stacks(id: string): number } }).status?.stacks('poison') ?? 0) : 0;
      ctx.enemies.damage(e, { base: BEAST.novaDmg + st * 10, kind: 'magic', source: 'ult', knock: 16, canCrit: true, tags: ['beast', 'nova'], status: [{ id: 'poison', stacks: 10, dur: 7, power: 2.6 }] });
    });
    if (this.variant === 'plague') ctx.events.emit('plague', 6);
    ctx.events.emit('ultNova', h, BEAST.novaR);
    await eng.tweens.wait(0.35, false);
  }

  private cleanup() {
    const eng = this.ctx.engine;
    this.holder.removeFromParent();
    this.beastLeft = 0;
    this.atk = null;
    const host = Ultimate.pinchHost;
    if (host) host.pinchRoot.visible = true;
    if (!eng.input.enabled) {
      eng.slowMo(1, 6);
      eng.letterbox(false, 0.4);
      this.cam.setCine(null);
      eng.input.enabled = true;
    }
    if (this.player.invuln > 50) this.player.invuln = 1.2;
    // let the title finish crumbling before the frame hook goes
    const fn = this.frameFn;
    if (fn) {
      eng.tweens.after(1.5, () => {
        const i = eng.onAfterUpdate.indexOf(fn);
        if (i >= 0) eng.onAfterUpdate.splice(i, 1);
        if (this.title) {
          this.title.group.removeFromParent();
          this.title.dispose();
          this.title = null;
        }
      }, true);
      this.frameFn = null;
    }
    this.active = false;
    void rnd;
  }
}
