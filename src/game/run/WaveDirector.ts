// Wave director: 100 waves per region. Continuous hordes with ramping budgets,
// themed spike waves, alpha elites, a miniboss every 5th wave and the major
// boss at 50 / 75 / 100. Hands control to RunScene for intros, transformations
// and breaks.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Enemies } from '../enemies/Enemies';
import { ENEMIES, rosterFor, waveScale } from '../enemies/EnemyDefs';
import { rnd, clamp } from '../../engine/math/rand';

export type WavePhase = 'idle' | 'intro' | 'combat' | 'boss' | 'clear' | 'break';

export interface WaveSpec {
  n: number;
  duration: number;
  boss: 'none' | 'mini' | 'major';
  theme?: { name: string; types: string[]; mult: number };
  alphaGuaranteed?: boolean;
}

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
  goldenDone = false;
  paused = false;
  cap = 180;
  onWaveStart?: (spec: WaveSpec) => void;
  onWaveEnd?: (spec: WaveSpec) => void;
  /** RunScene spawns the boss; returns entity with alive flag */
  spawnBoss?: (wave: number, major: boolean) => { alive: boolean } | null;
  boss: { alive: boolean } | null = null;

  constructor(private ctx: Ctx, private enemies: Enemies, private getPlayer: () => { pos: THREE.Vector3 }) {}

  specFor(n: number): WaveSpec {
    const major = n === 50 || n === 75 || n === 100;
    const mini = !major && n % 5 === 0;
    let theme: WaveSpec['theme'];
    if (!mini && !major && n > 3 && n % 5 === 3) {
      const opts = THEMES.filter((t) => t.from <= n);
      if (opts.length) theme = opts[(n * 7) % opts.length];
    }
    return { n, duration: mini || major ? 999 : 30 + Math.min(10, n * 0.1), boss: major ? 'major' : mini ? 'mini' : 'none', theme, alphaGuaranteed: n % 5 === 2 && n > 5 };
  }

  start(n: number) {
    this.wave = n;
    this.enemies.wave = n;
    this.spec = this.specFor(n);
    this.phase = 'intro';
    this.timer = 0;
    this.alphaDone = false;
    this.ctx.run.wave = n;
    this.onWaveStart?.(this.spec);
  }

  /** called by RunScene after the intro cinematic */
  beginCombat() {
    if (!this.spec) return;
    this.phase = this.spec.boss !== 'none' ? 'boss' : 'combat';
    this.timer = 0;
    if (this.spec.boss !== 'none') this.boss = this.spawnBoss?.(this.wave, this.spec.boss === 'major') ?? null;
  }

  get timeLeft() {
    return this.spec ? Math.max(0, this.spec.duration - this.timer) : 0;
  }

  update(dt: number) {
    if (this.paused || !this.spec) return;
    if (this.phase !== 'combat' && this.phase !== 'boss') return;
    this.timer += dt;
    const n = this.wave;
    const sc = waveScale(n);
    // budget: alive target + spawn rate
    const bossWave = this.phase === 'boss';
    const target = Math.min(this.cap, Math.round((10 + n * 1.7) * (this.spec.theme?.mult ?? 1) * (bossWave ? 0.45 : 1)));
    const rate = (0.9 + n * 0.09) * (bossWave ? 0.4 : 1);
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
    if (this.spec?.theme && rnd.chance(0.7)) {
      const t = roster.filter((d) => this.spec!.theme!.types.includes(d.id));
      if (t.length) roster = t;
    }
    if (!roster.length) return;
    // weights fade early types slightly as waves progress
    const def = rnd.weighted(roster, (d) => d.weight * (d.firstWave === 1 ? clamp(1.4 - n * 0.008, 0.6, 1.4) : 1));
    const [g0, g1] = def.group ?? [1, 2];
    const count = Math.round(rnd.range(g0, g1) * (1 + n * 0.012));
    const p = this.spawnPoint(def.ai === 'sniper' ? 34 : 24, def.ai === 'sniper' ? 52 : 46);
    if (!p) return;
    const alphaRoll = rnd.next() < alphaChance && n >= 4;
    for (let i = 0; i < count; i++) {
      if (this.enemies.alive >= this.cap) break;
      const a = rnd.next() * Math.PI * 2, r = rnd.next() * (1.5 + count * 0.35);
      this.enemies.spawn(def.id, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, { alpha: alphaRoll && i === 0 });
    }
    void ENEMIES;
  }
}
