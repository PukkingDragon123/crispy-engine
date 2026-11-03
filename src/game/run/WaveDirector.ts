// Wave director: 100 waves per region. Continuous hordes with ramping budgets,
// themed spike waves, alpha elites, a miniboss every 5th wave and the major
// boss at 50 / 75 / 100. Hands control to RunScene for intros, transformations
// and breaks.
//
// INTERMISSION: every cleared wave opens a 30 s break (phase 'break'). Whatever
// is still standing slinks off (enemies.calm()), nothing spawns, wounds knit
// slowly, and the hunter can relocate, shop, explore or heal. `timeLeft` is the
// break countdown while it runs (the HUD's wave timer shows it as is),
// `hudLabel` names what is next, `bell` is the hold progress of the early start:
// hold the interact key (T) for BELL_HOLD s to ring the bell. RunScene's usual
// `start(n + 1)` call after a clear just arms the break; the wave begins when the
// countdown runs out (or the bell is rung). Each wave opens on a short beat: the
// next horde's dust rises on the horizon (and, with `cam` set, the camera looks
// at it), and its first packs come from that side.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Enemies } from '../enemies/Enemies';
import type { CameraRig } from '../player/CameraRig';
import { ENEMIES, rosterFor, waveScale } from '../enemies/EnemyDefs';
import { rnd, clamp } from '../../engine/math/rand';

/** seconds of calm between two waves */
export const INTERMISSION = 30;
/** hold interact this long to ring the bell and start the next wave early */
export const BELL_HOLD = 1.1;
/** max hp knitted back per second during the break */
export const BREAK_REGEN = 0.006;
/** the Avatar of Khonsu's court: what the director sends on his waves */
const KHONSU_COURT = ['mummy', 'jackal', 'cursePriest', 'husk'];

/** what the director reads from the hunter (the real Player satisfies it) */
export interface DirectorHunter {
  pos: THREE.Vector3;
  hp?: number;
  maxHp?: number;
  alive?: boolean;
}

export type WavePhase = 'idle' | 'intro' | 'combat' | 'boss' | 'clear' | 'break';

export interface WaveSpec {
  n: number;
  duration: number;
  boss: 'none' | 'mini' | 'major';
  theme?: { name: string; types: string[]; mult: number };
  alphaGuaranteed?: boolean;
}

/** surge / breather cycle (s) */
const PULSE = 14;
const smooth01 = (t: number) => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k * (3 - 2 * k);
};

const THEMES = [
  { name: 'SCARAB STAMPEDE', types: ['scarab', 'bombScarab'], mult: 1.6, from: 4 },
  { name: 'BONE POSSE', types: ['gunslinger', 'sharpshooter', 'shotgunner', 'mariachi'], mult: 1.1, from: 10 },
  { name: 'TOMB BREAKERS', types: ['mummy', 'bandageWhipper', 'husk'], mult: 1.0, from: 12 },
  { name: 'OUTLAW AMBUSH', types: ['outlaw', 'lassoRider', 'tumbleweedBandit'], mult: 1.0, from: 14 },
  { name: 'JACKAL HUNT', types: ['jackal', 'jackalArcher'], mult: 1.0, from: 18 },
  { name: 'DYNAMITE DAY', types: ['bomberHusk', 'bombScarab', 'outlaw'], mult: 1.2, from: 9 },
  { name: 'STINK STORM', types: ['dungSkeleton', 'husk', 'scarab'], mult: 1.3, from: 8 },
  { name: 'WOLF PACK', types: ['sandWolf'], mult: 1.25, from: 6 },
  { name: 'THE SANDS MOVE', types: ['duneWorm', 'scarab', 'thornyLizard'], mult: 1.0, from: 11 },
  { name: 'SNAKE PIT', types: ['bellSnake', 'thornyLizard', 'sandWolf'], mult: 0.9, from: 13 },
  { name: 'BLOOD & THORNS', types: ['thornyLizard', 'cactusHusk', 'duneWorm'], mult: 1.1, from: 9 },
];

export class WaveDirector {
  wave = 0;
  phase: WavePhase = 'idle';
  timer = 0;
  spec: WaveSpec | null = null;
  private spawnAcc = 0;
  private alphaDone = false;
  /** groups spawned this wave (the opening ones come in closer, for instant action) */
  private groups = 0;
  /** enemy types already introduced this run (a new type gets the spotlight on its first wave) */
  private met = new Set<string>();
  goldenDone = false;
  paused = false;
  cap = 180;
  onWaveStart?: (spec: WaveSpec) => void;
  onWaveEnd?: (spec: WaveSpec) => void;
  /** RunScene spawns the boss; returns entity with alive flag */
  spawnBoss?: (wave: number, major: boolean) => { alive: boolean } | null;
  boss: { alive: boolean } | null = null;
  // ---- intermission
  /** seconds left in the break, its full length, the wave that follows it */
  breakLeft = 0;
  breakTotal = INTERMISSION;
  nextWave = 0;
  /** bell hold progress 0..1 (HUD: draw the fill while holding T) */
  bell = 0;
  /** RunScene asked for the next wave (it starts when the countdown ends) */
  private armed = false;
  private rung = false;
  private tick = 0;
  private bellSfx = 0;
  /** optional: the camera rig, for the wave-start look at the coming horde */
  cam?: CameraRig;
  /** optional: true while T means something else (an interact prompt, a shop) */
  bellBlocked?: () => boolean;
  /** the side the next horde comes from (radians around the hunter) and how many opening packs use it */
  private bearing = 0;
  private bearingGroups = 0;

  constructor(private ctx: Ctx, private enemies: Enemies, private getPlayer: () => DirectorHunter) {
    if (typeof window !== 'undefined') (window as any).__director = this; // dev handle: __director.ringBell()
  }

  get inBreak() {
    return this.phase === 'break';
  }
  /** what the HUD's wave sign should say */
  get hudLabel() {
    if (this.phase !== 'break') return `WAVE ${this.wave}`;
    if (this.rung) return 'THE BELL TOLLS';
    return `NEXT: WAVE ${this.nextWave}`;
  }

  specFor(n: number): WaveSpec {
    const major = n === 50 || n === 75 || n === 85 || n === 100;
    const mini = !major && n % 5 === 0;
    let theme: WaveSpec['theme'];
    if (!mini && !major && n > 3 && n % 5 === 3) {
      const opts = THEMES.filter((t) => t.from <= n);
      if (opts.length) theme = opts[(n * 7) % opts.length];
    }
    return { n, duration: mini || major ? 999 : 30 + Math.min(10, n * 0.1), boss: major ? 'major' : mini ? 'mini' : 'none', theme, alphaGuaranteed: n % 5 === 2 && n > 5 };
  }

  /**
   * Begin wave n. Called during an intermission (RunScene's usual post-clear call)
   * it only arms the break: the wave begins when the countdown or the bell ends it.
   * `now` skips the break.
   */
  start(n: number, now = false) {
    if (this.phase === 'break' && !now) {
      this.nextWave = n;
      if (!this.armed && !this.rung && this.breakLeft > 3) this.ctx.toast('INTERMISSION', '#e0b373', `${Math.ceil(this.breakLeft)} s to wave ${n} — relocate, shop, heal. Hold T to ring the bell.`);
      this.armed = true;
      return;
    }
    const fromBreak = this.phase === 'break';
    this.phase = 'idle';
    this.breakLeft = 0;
    this.bell = 0;
    this.wave = n;
    this.enemies.wave = n;
    this.spec = this.specFor(n);
    this.phase = 'intro';
    this.timer = 0;
    this.alphaDone = false;
    this.groups = 0;
    this.ctx.run.wave = n;
    this.waveBeat(this.spec, fromBreak);
    this.onWaveStart?.(this.spec);
  }

  // ------------------------------------------------------------------ the break
  private beginBreak(next: number) {
    this.phase = 'break';
    this.nextWave = next;
    this.breakTotal = INTERMISSION;
    this.breakLeft = INTERMISSION;
    this.armed = false;
    this.rung = false;
    this.bell = 0;
    this.tick = Math.ceil(INTERMISSION);
    // the field clears: the stragglers slink off into the dunes
    this.enemies.calm();
    this.ctx.events.emit('intermission', { next, total: INTERMISSION });
  }

  private updateBreak(dt: number) {
    const ctx = this.ctx;
    const pl = this.getPlayer();
    this.breakLeft = Math.max(0, this.breakLeft - dt);
    // wounds knit while the sand is quiet
    if (pl.alive !== false && pl.hp !== undefined && pl.maxHp && pl.hp < pl.maxHp) (pl as { hp: number }).hp = Math.min(pl.maxHp, pl.hp + pl.maxHp * BREAK_REGEN * dt);
    // the last seconds count down out loud
    const sec = Math.ceil(this.breakLeft);
    if (sec !== this.tick) {
      this.tick = sec;
      if (sec === 10 && !this.rung) ctx.toast('THE SANDS STIR', '#e0b373', `Wave ${this.nextWave} in 10 s`);
      if (sec <= 5 && sec > 0) ctx.sfx('rev_hammer', null, 0.35 + (5 - sec) * 0.08, 0.7 + (5 - sec) * 0.06);
    }
    // ring the bell: hold interact
    const inp = ctx.engine.input;
    const blocked = this.rung || !!this.bellBlocked?.();
    if (!blocked && inp.held('interact') && pl.alive !== false) {
      this.bell = Math.min(1, this.bell + dt / BELL_HOLD);
      this.bellSfx -= dt;
      if (this.bellSfx <= 0) {
        this.bellSfx = 0.18;
        ctx.sfx('ui_click', null, 0.3, 0.8 + this.bell * 0.7);
      }
      if (this.bell >= 1) this.ringBell();
    } else if (!this.rung) this.bell = Math.max(0, this.bell - dt * 2.5);
    if (this.breakLeft <= 0 && this.armed) this.start(this.nextWave, true);
  }

  /** start the next wave early */
  ringBell() {
    if (this.phase !== 'break' || this.rung) return;
    const ctx = this.ctx;
    this.rung = true;
    this.bell = 1;
    this.breakLeft = Math.min(this.breakLeft, 1.6);
    const p = this.getPlayer().pos;
    const at = { x: p.x, y: p.y + 0.3, z: p.z };
    ctx.sfx('counter_clang', null, 1, 0.42);
    ctx.sfx('divine_chime', null, 0.8, 0.5);
    ctx.engine.tweens.after(0.5, () => ctx.sfx('counter_clang', null, 0.6, 0.42));
    ctx.fx.ring(at, 0xffd36b, 18, 0.7);
    ctx.fx.ring(at, 0xfff2c0, 9, 0.45);
    ctx.shake(0.2);
    ctx.toast('THE BELL TOLLS', '#ffd36b', `Wave ${this.nextWave} — here they come`, true);
    ctx.events.emit('bellRung', this.nextWave);
  }

  // ------------------------------------------------------------------ the wave-start beat
  /**
   * A short cinematic beat as a wave opens: the horde's dust wall rises on one
   * horizon (where its first packs will come from), a rumble rolls in and, if
   * the camera rig is hooked up, the view turns to look at it for a moment.
   */
  private waveBeat(spec: WaveSpec, fromBreak: boolean) {
    const ctx = this.ctx;
    const pl = this.getPlayer().pos;
    const p = this.spawnPoint(30, 40);
    this.bearing = p ? Math.atan2(p.z - pl.z, p.x - pl.x) : rnd.next() * Math.PI * 2;
    this.bearingGroups = spec.boss === 'none' ? 3 : 0;
    const bx = Math.cos(this.bearing), bz = Math.sin(this.bearing);
    const R = 34;
    const cx = pl.x + bx * R, cz = pl.z + bz * R;
    ctx.sfx('quake_rumble', { x: cx, y: pl.y, z: cz }, 0.9, 0.7);
    if (spec.boss !== 'none') ctx.sfx('boss_roar', { x: cx, y: pl.y, z: cz }, 0.5, 0.55);
    // the dust wall: plumes along an arc, rising in waves
    for (let k = 0; k < 4; k++)
      ctx.engine.tweens.after(k * 0.28, () => {
        for (let i = -4; i <= 4; i++) {
          const a = this.bearing + i * 0.09 + (rnd.next() - 0.5) * 0.05;
          const r = R + (rnd.next() - 0.5) * 6;
          const x = pl.x + Math.cos(a) * r, z = pl.z + Math.sin(a) * r;
          const y = ctx.world.groundAt(x, z);
          ctx.particles.emit({ pos: { x, y: y + 1 + k * 1.4, z }, count: 2, vel: { x: 0, y: 2.6, z: 0 }, spread: 1.5, up: 1.5, life: [2.2, 3.6], size: [2.5, 6.5], sprite: ['cloud0', 'cloud1', 'cloud2'], color: [0xe6c590, 0xd8b078, 0xc8a06a], alpha: 0.75, drag: 0.8, rot: 6, rotSpeed: 0.25, jitter: 2 });
          if (k === 0 && i % 2 === 0) ctx.fx.sandBurst({ x, y, z }, 2);
        }
      });
    if (spec.boss === 'none') ctx.engine.letterbox(true, 0.35);
    const cam = this.cam;
    const look = fromBreak && cam && spec.boss === 'none' && !cam.cine;
    if (look && cam) {
      // over the shoulder, turned toward the dust
      const back = new THREE.Vector3(pl.x - bx * 4.5, 0, pl.z - bz * 4.5);
      back.y = Math.max(pl.y, ctx.world.groundAt(back.x, back.z)) + 3.2;
      cam.setCine({ pos: back, look: new THREE.Vector3(cx, ctx.world.groundAt(cx, cz) + 4, cz), fov: 52 });
    }
    if (spec.boss === 'none')
      ctx.engine.tweens.after(look ? 1.5 : 1.0, () => {
        if (look && cam && cam.cine) cam.setCine(null);
        ctx.engine.letterbox(false, 0.4);
      }, true);
  }

  /** a spawn point on the side the horde is coming from */
  private spawnToward(minR: number, maxR: number) {
    const pl = this.getPlayer().pos;
    const storm = this.ctx.world.storm;
    for (let k = 0; k < 12; k++) {
      const a = this.bearing + (rnd.next() - 0.5) * 1.1;
      const r = minR + rnd.next() * (maxR - minR);
      const x = pl.x + Math.cos(a) * r, z = pl.z + Math.sin(a) * r;
      if (storm.sdf(x, z) > 5) return { x, z };
    }
    return this.spawnPoint(minR, maxR);
  }

  /** called by RunScene after the intro cinematic */
  beginCombat() {
    if (!this.spec) return;
    this.phase = this.spec.boss !== 'none' ? 'boss' : 'combat';
    this.timer = 0;
    // open hot: the first pack is already on its way
    if (this.spec.boss === 'none') this.spawnAcc = Math.max(this.spawnAcc, 1.6);
    if (this.spec.boss !== 'none') this.boss = this.spawnBoss?.(this.wave, this.spec.boss === 'major') ?? null;
  }

  /** seconds left in the wave — or in the intermission while it runs */
  get timeLeft() {
    if (this.phase === 'break') return this.breakLeft;
    return this.spec ? Math.max(0, this.spec.duration - this.timer) : 0;
  }

  update(dt: number) {
    if (this.paused || !this.spec) return;
    if (this.phase === 'break') {
      this.updateBreak(dt);
      return;
    }
    if (this.phase !== 'combat' && this.phase !== 'boss') return;
    this.timer += dt;
    const n = this.wave;
    const sc = waveScale(n);
    // budget: alive target + spawn rate
    const bossWave = this.phase === 'boss';
    // pacing: surges and breathers (~14 s cycle) instead of a flat trickle
    const ph = (this.timer % PULSE) / PULSE;
    const pulse = bossWave ? 0.5 : ph < 0.45 ? Math.sin((ph / 0.45) * Math.PI * 0.5) : 1 - smooth01((ph - 0.45) / 0.55);
    const target = Math.min(this.cap, Math.round((10 + n * 1.7) * (this.spec.theme?.mult ?? 1) * (bossWave ? 0.45 : 1) * (0.78 + 0.34 * pulse)));
    const rate = (0.9 + n * 0.09) * (bossWave ? 0.4 : 1) * (0.45 + 1.1 * pulse);
    if (this.enemies.alive < target) this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      this.spawnGroup(sc.alphaChance);
    }
    // guaranteed alpha mid-wave
    if (this.spec.alphaGuaranteed && !this.alphaDone && this.timer > 10) {
      this.alphaDone = true;
      const roster = rosterFor(n).filter((d) => d.id !== 'goldenScarab' && d.id !== 'bombScarab');
      const d = rnd.pick(roster);
      const p = this.spawnPoint(30, 44);
      if (p) {
        this.enemies.spawn(d.id, p.x, p.z, { alpha: true });
        this.ctx.toast(`ALPHA ${d.name.toUpperCase()}`, '#ff8a4a', 'A mutated elite has appeared');
      }
    }
    // golden scarab cameo
    if (!this.goldenDone && n >= 3 && this.timer > 14 && rnd.chance(dt * 0.02)) {
      this.goldenDone = true;
      const p = this.spawnPoint(16, 26);
      if (p) {
        this.enemies.spawn('goldenScarab', p.x, p.z);
        this.ctx.toast('GOLDEN SCARAB!', '#f5c84a', 'Catch it before it escapes');
        this.ctx.sfx('gem_chime', null, 0.8);
      }
    }
    // end conditions
    if (this.phase === 'combat' && this.timer >= this.spec.duration) this.endWave();
    if (this.phase === 'boss' && this.boss && !this.boss.alive && this.timer > 2) this.endWave();
  }

  private endWave() {
    if (!this.spec) return;
    this.phase = 'clear';
    // the intermission opens at once (RunScene's start(n + 1) arms it; travel / the run's end never do)
    this.beginBreak(this.spec.n + 1);
    this.onWaveEnd?.(this.spec);
  }

  spawnPoint(minR: number, maxR: number) {
    const pl = this.getPlayer().pos;
    const storm = this.ctx.world.storm;
    // prefer points not directly in front of the camera so hordes come from around
    for (let k = 0; k < 12; k++) {
      const p = storm.randomPointNear(pl.x, pl.z, minR, maxR, 5);
      if (!p) continue;
      return p;
    }
    return storm.randomPointNear(pl.x, pl.z, 10, maxR, 2);
  }

  private spawnGroup(alphaChance: number) {
    const n = this.wave;
    let roster = rosterFor(n).filter((d) => d.id !== 'goldenScarab');
    // the Avatar of Khonsu's waves: his court answers instead of the usual mob
    if (this.phase === 'boss' && (n === 5 || n === 35 || n === 65)) roster = KHONSU_COURT.map((id) => ENEMIES[id]).filter((d) => !!d && (d.id !== 'cursePriest' || n > 5));
    if (this.spec?.theme && rnd.chance(0.7)) {
      const t = roster.filter((d) => this.spec!.theme!.types.includes(d.id));
      if (t.length) roster = t;
    }
    if (!roster.length) return;
    // weights fade early types slightly as waves progress; a type new this wave gets the spotlight
    const def = rnd.weighted(roster, (d) => d.weight * (d.firstWave === 1 ? clamp(1.4 - n * 0.008, 0.6, 1.4) : 1) * (d.firstWave === n && d.id !== 'goldenScarab' ? 4 : 1));
    const [g0, g1] = def.group ?? [1, 2];
    const count = Math.round(rnd.range(g0, g1) * (1 + n * 0.012));
    const open = this.groups++ < 2 && def.ai !== 'sniper';
    const minR = def.ai === 'sniper' ? 34 : open ? 17 : 24, maxR = def.ai === 'sniper' ? 52 : open ? 28 : 46;
    const p = this.bearingGroups-- > 0 ? this.spawnToward(minR, maxR) : this.spawnPoint(minR, maxR);
    if (!p) return;
    if (!this.met.has(def.id)) {
      this.met.add(def.id);
      if (def.firstWave > 1 && def.firstWave >= n - 1) this.ctx.toast(`NEW BOUNTY: ${def.name.toUpperCase()}`, '#e0b373', def.weakness);
    }
    const alphaRoll = rnd.next() < alphaChance && n >= 4;
    for (let i = 0; i < count; i++) {
      if (this.enemies.alive >= this.cap) break;
      const a = rnd.next() * Math.PI * 2, r = rnd.next() * (1.5 + count * 0.35);
      this.enemies.spawn(def.id, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, { alpha: alphaRoll && i === 0 });
    }
    void ENEMIES;
  }
}
