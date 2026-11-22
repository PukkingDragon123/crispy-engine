// DAYS: the hunt runs in days, WAVES_PER_DAY waves to a day. The internal wave
// numbers stay (so the bosses at 25 / 50 / 75 / 100 still land: day 5 ends on the
// wave-25 avatar). A day runs DAWN, HIGH NOON, GOLDEN HOUR, then NIGHT and the
// WITCHING HOUR. Night waves send more, tougher packs and more alphas (WaveDirector:
// Balance.setDay / dayMul, nightFactor), the fog closes in and the light turns to
// blue moonlight with warm lantern and campfire pools.
//
// The Days object (one per run, built by RunScene) owns:
//  • the DAY CLOCK: a continuous time of day driven by the director (each wave owns
//    a stretch of the day, every break carries the sky on to the next), keyed through
//    the tod* presets in world/Env.ts. It holds off while anyone else owns the sky (a
//    boss, Khonsu's LunarSky, the oasis murk, the death scene: any Env.apply that is
//    not its own) and blends back in afterwards. It also re-bakes the sky probe as
//    the light changes, so night fill is not lit by noon.
//  • the BEATS: before the first wave of a day the camera turns to the rising sun,
//    before the night to the moon coming up; RunScene stamps "DAY N" / "NIGHTFALL" in
//    big voxel letters as that wave opens (dayLabel).
//  • the HUD: the day plaque (ui/DayPlaque) and the hourglass (ui/HourglassHud), whose
//    shake hurries the break.
import * as THREE from 'three';
import { PRESETS, type EnvPreset } from '../world/Env';
import { DayPlaque, type PlaqueState } from '../ui/DayPlaque';
import { HourglassHud } from '../ui/HourglassHud';
import { HURRY } from './WaveDirector';

export const WAVES_PER_DAY = 5;
export type DayPhase = 'dawn' | 'noon' | 'golden' | 'night' | 'witching';
const PHASES: DayPhase[] = ['dawn', 'noon', 'golden', 'night', 'witching'];
export const PHASE_NAME: Record<DayPhase, string> = { dawn: 'DAWN', noon: 'HIGH NOON', golden: 'GOLDEN HOUR', night: 'NIGHT', witching: 'WITCHING HOUR' };

/** the day a wave belongs to (1-based) */
export const dayOf = (wave: number) => Math.floor((Math.max(1, wave) - 1) / WAVES_PER_DAY) + 1;
/** a wave's place in its day, 0..WAVES_PER_DAY-1 */
export const slotOf = (wave: number) => (Math.max(1, wave) - 1) % WAVES_PER_DAY;
/** the first wave of a day (?day=N starts there) */
export const firstWaveOfDay = (day: number) => (Math.max(1, Math.floor(day)) - 1) * WAVES_PER_DAY + 1;
export const phaseOf = (wave: number): DayPhase => PHASES[slotOf(wave)];
/** 0 daylight, 0.25 golden hour, 1 night and the witching hour */
export const nightOf = (wave: number) => {
  const s = slotOf(wave);
  return s >= 3 ? 1 : s === 2 ? 0.25 : 0;
};
export const isNightWave = (wave: number) => slotOf(wave) >= 3;
/** the voxel title a wave opens with (null: the usual one) */
export function dayLabel(wave: number) {
  const s = slotOf(wave);
  return s === 0 ? `DAY ${dayOf(wave)}` : s === 3 ? 'NIGHTFALL' : null;
}
/** "DAY 3, NIGHT" for the results sheet */
export function dayReached(wave: number) {
  return `Day ${dayOf(wave)}, ${PHASE_NAME[phaseOf(wave)].toLowerCase()}`;
}

// ------------------------------------------------------------------ the day clock
/** the sky keys along one day (t 0..1) */
const KEYS: [number, string][] = [
  [0, 'todDawn'], [0.12, 'todMorning'], [0.28, 'todNoon'], [0.42, 'todAfternoon'], [0.53, 'todGolden'], [0.61, 'todSunset'],
  [0.68, 'todDusk'], [0.76, 'todNight'], [0.9, 'todDeep'], [0.975, 'todPredawn'], [1, 'todDawn'],
];
/** the stretch of the day each wave of it is fought in; its break carries the clock to the next start */
const SLOT_T: [number, number][] = [[0.015, 0.12], [0.22, 0.36], [0.44, 0.56], [0.76, 0.86], [0.88, 0.965]];

function mix(a: EnvPreset, b: EnvPreset, k: number): EnvPreset {
  const c = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), k).getHex();
  const n = (x: number, y: number) => x + (y - x) * k;
  return {
    zenith: c(a.zenith, b.zenith), horizon: c(a.horizon, b.horizon), ground: c(a.ground, b.ground), sunColor: c(a.sunColor, b.sunColor),
    sunIntensity: n(a.sunIntensity, b.sunIntensity), sunElev: n(a.sunElev, b.sunElev), sunAzim: n(a.sunAzim, b.sunAzim),
    hemiSky: c(a.hemiSky, b.hemiSky), hemiGround: c(a.hemiGround, b.hemiGround), hemiIntensity: n(a.hemiIntensity, b.hemiIntensity),
    fog: c(a.fog, b.fog), fogNear: n(a.fogNear, b.fogNear), fogFar: n(a.fogFar, b.fogFar), exposure: n(a.exposure, b.exposure),
    stars: n(a.stars, b.stars), clouds: n(a.clouds, b.clouds), cloudColor: c(a.cloudColor, b.cloudColor),
  };
}
const sm = (k: number) => k * k * (3 - 2 * k);
/** the sky at time of day t (wraps) */
export function skyAt(t: number): { p: EnvPreset; key: string } {
  t = ((t % 1) + 1) % 1;
  for (let i = 1; i < KEYS.length; i++)
    if (t <= KEYS[i][0]) {
      const [t0, a] = KEYS[i - 1], [t1, b] = KEYS[i];
      const k = sm((t - t0) / (t1 - t0));
      return { p: mix(PRESETS[a], PRESETS[b], k), key: k < 0.5 ? a : b };
    }
  return { p: { ...PRESETS.todDawn }, key: 'todDawn' };
}
/** Khonsu's waves (5, 35, 65): his LunarSky brings the night itself, so the day hands it a sunset */
const skyBoss = (wave: number) => wave % 30 === 5;

// ------------------------------------------------------------------ the run hook
interface Dir {
  wave: number;
  nextWave: number;
  phase: string;
  timer: number;
  spec: { duration: number; boss: string } | null;
  breakLeft: number;
  breakTotal: number;
  timeLeft: number;
  remaining: number;
  budget: number;
  hurry: number;
  day: number;
  bellBlocked?: () => boolean;
}
/** what Days needs from the run (RunScene satisfies it) */
export interface DaysHost {
  engine: { renderer: THREE.WebGLRenderer; input: { enabled: boolean }; letterbox(on: boolean, t?: number): void; audio: { loop(id: string, v: number): { setVolume(v: number, t?: number): void; stop(t?: number): void } | null } };
  ctx: { shake(a: number): void; sfx(id: string, pos?: null, v?: number, p?: number): void };
  world: { env: import('../world/Env').Env; sa: { env: string }; groundAt(x: number, z: number): number };
  director: Dir;
  hud: import('../ui/Hud').Hud;
  hud3d: { scene: THREE.Scene };
  camRig: { cine: unknown; setCine(s: { pos: THREE.Vector3; look: THREE.Vector3; fov?: number } | null): void };
  player: { pos: THREE.Vector3; alive: boolean };
  props?: { list: { kind: string; matrix: THREE.Matrix4; broken: boolean }[] };
  scene: THREE.Scene;
  opts: { stage?: string };
}

/** the HUD worker's layout slot (Hud.reserveSlot): a live centre and size in HUD px */
type HudSlot = { x: number; y: number; w: number; h: number; k: number; visible: boolean };
type Slotted = { reserveSlot?: (id: string, w?: number, h?: number) => HudSlot; releaseSlot?: (id: string) => void };

export class Days {
  private key: string;
  private saved: EnvPreset | null = null;
  private skyOn: boolean;
  private ext = -1;
  private extT = 0;
  private wasHeld = true;
  private from: EnvPreset | null = null;
  private blend = 1;
  private applyT = 0;
  private bakedKey = '';
  private bakeT = 0;
  private started = false;
  /** 0 day .. 1 night, of the sky as shown */
  night = 0;
  private lantern: THREE.PointLight;
  private torches: THREE.PointLight[] = [];
  private torchT = 0;
  private nightLoop: { setVolume(v: number, t?: number): void; stop(t?: number): void } | null = null;
  private plaque: DayPlaque;
  private glass: HourglassHud;
  private beatFor = -1;
  private beatShot: unknown = null;
  private beatOffT = -1;
  private t = 0;
  /** the hourglass's place in the HUD layout (null: the HUD has no slots, Days lays it out itself) */
  private slot: HudSlot | null = null;

  constructor(private r: DaysHost) {
    this.key = r.world.sa.env;
    this.skyOn = r.opts.stage !== 'nile' && !!PRESETS[this.key];
    if (this.skyOn) this.saved = { ...PRESETS[this.key] };
    // a lantern pool round the hunter and two campfire pools, dark by day (made once: no shader rebuilds later)
    this.lantern = new THREE.PointLight(0xffb066, 0, 13, 1.7);
    r.scene.add(this.lantern);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xff9448, 0, 20, 1.6);
      this.torches.push(l);
      r.scene.add(l);
    }
    this.nightLoop = r.engine.audio.loop('night_loop', 0);
    const hud = r.hud as typeof r.hud & Slotted & { timeHud?: boolean };
    hud.timeHud = true;
    // the HUD keeps the hourglass a spot at the top centre (and retires the stopwatch); the plaque hangs to its left
    this.slot = hud.reserveSlot?.('hourglass', 32, 50) ?? null;
    this.plaque = new DayPlaque(() => this.plaqueState(), () => {
      const sl = this.slot;
      if (!sl || !sl.visible) return null;
      return { right: Math.round(sl.x - (sl.w / 2) * sl.k - 8), y: Math.max(4, Math.round(sl.y - (sl.h / 2) * sl.k)) };
    });
    hud.painters.push(this.plaque);
    this.glass = new HourglassHud(r.hud3d.scene, r.hud);
    this.glass.onShake = (a) => r.ctx.shake(a);
    if (typeof window !== 'undefined') (window as any).__days = this; // dev handle: __days.skip(t)
  }

  // ---------------------------------------------------------------- the clock
  /** the time of day now (0..1, may run past 1 in the night-to-dawn break) */
  clock() {
    const d = this.r.director;
    if (d.wave <= 0) return SLOT_T[slotOf(Math.max(1, d.nextWave || 1))][0];
    const s = slotOf(d.wave);
    const [a, b] = SLOT_T[s];
    if (d.phase === 'break') {
      const n = slotOf(d.nextWave);
      let to = SLOT_T[n][0];
      if (to < b) to += 1;
      const k = d.breakTotal > 0 ? 1 - d.breakLeft / d.breakTotal : 1;
      return b + (to - b) * sm(Math.min(1, Math.max(0, k)));
    }
    const dur = d.spec && d.spec.boss === 'none' ? d.spec.duration : 120;
    return a + (b - a) * Math.min(1, d.timer / Math.max(1, dur));
  }

  /** the sky the clock wants now */
  private target(): { p: EnvPreset; key: string } {
    const d = this.r.director;
    const sky = skyAt(this.clock());
    // Khonsu's waves: the day hands his LunarSky a sunset to work from, and takes the night back after
    if (d.phase === 'break' && skyBoss(d.nextWave)) {
      const k = d.breakTotal > 0 ? sm(Math.min(1, 1 - d.breakLeft / d.breakTotal)) : 1;
      return { p: mix(skyAt(SLOT_T[slotOf(d.wave)][1]).p, PRESETS.todSunset, k), key: 'todSunset' };
    }
    if (d.phase !== 'break' && skyBoss(d.wave)) return { p: { ...PRESETS.todSunset }, key: 'todSunset' };
    return sky;
  }

  private updateSky(dt: number) {
    const r = this.r, env = r.world.env, d = r.director;
    if (env.extApplies !== this.ext) {
      if (this.ext >= 0) this.extT = 0;
      this.ext = env.extApplies;
    } else this.extT += dt;
    if (d.wave > 0) this.started = true;
    const oasis = typeof window !== 'undefined' ? (window as any).__oasis : null;
    const held = !this.skyOn || !this.started || d.phase === 'boss' || this.extT < 2.5 || (!!oasis && oasis.envApplied > 0.004);
    if (held) {
      this.wasHeld = true;
      return;
    }
    const tg = this.target();
    if (this.wasHeld) {
      // someone else had the sky: blend back from wherever they left it
      this.wasHeld = false;
      this.from = { ...env.preset };
      this.blend = 0;
      this.bakedKey = '';
    }
    let p = tg.p;
    if (this.blend < 1 && this.from) {
      this.blend = Math.min(1, this.blend + dt / 3);
      p = mix(this.from, tg.p, sm(this.blend));
    }
    this.applyT -= dt;
    if (this.applyT <= 0 || this.blend < 1) {
      this.applyT = 1 / 15;
      // the run's base preset follows the hour, so everyone who restores "the base" restores the hour
      const base = PRESETS[this.key];
      Object.assign(base, p);
      env.applyTod(base);
    }
    this.night = Math.min(1, Math.max(0, (p.stars - 0.25) / 0.6));
    // re-bake the sky probe as the light settles into a new hour (never during someone else's sky)
    this.bakeT -= dt;
    if (tg.key !== this.bakedKey && this.bakeT <= 0 && this.blend >= 1) {
      this.bakedKey = tg.key;
      this.bakeT = 6;
      try {
        env.applyEnvMap(r.engine.renderer);
        r.hud3d.scene.environment = r.scene.environment;
        r.scene.environmentIntensity *= 1 - 0.45 * this.night;
      } catch (e) {
        console.warn('[days] sky probe', e);
      }
    }
  }

  // ---------------------------------------------------------------- night light
  private updateLights(dt: number) {
    const r = this.r, n = this.night, p = r.player.pos;
    const fl = (k: number) => 0.86 + 0.1 * Math.sin(this.t * 9.3 + k) + 0.05 * Math.sin(this.t * 23.1 + k * 2);
    this.lantern.intensity = n * 7.5 * fl(0);
    this.lantern.visible = n > 0.01;
    this.lantern.position.set(p.x, p.y + 2.4, p.z);
    this.torchT -= dt;
    if (this.torchT <= 0) {
      this.torchT = 1;
      const fires: { d: number; v: THREE.Vector3 }[] = [];
      for (const pr of r.props?.list ?? []) {
        if (pr.broken || !/campfire|torch|lantern|brazier/i.test(pr.kind)) continue;
        const v = new THREE.Vector3().setFromMatrixPosition(pr.matrix);
        const d = v.distanceTo(p);
        if (d < 80) fires.push({ d, v });
      }
      fires.sort((a, b) => a.d - b.d);
      this.torches.forEach((l, i) => {
        const f = fires[i];
        l.userData.on = !!f;
        if (f) l.position.set(f.v.x, f.v.y + 1.3, f.v.z);
      });
    }
    this.torches.forEach((l, i) => {
      l.intensity = l.userData.on ? n * 34 * fl(i * 3 + 1) : 0;
      l.visible = l.intensity > 0.05;
    });
    this.nightLoop?.setVolume(n * 0.45, 0.5);
  }

  // ---------------------------------------------------------------- the dawn / nightfall beats
  private updateBeats(dt: number) {
    const r = this.r, d = r.director;
    if (d.phase === 'break' && d.breakLeft <= 4.6 && this.beatFor !== d.nextWave) {
      const s = slotOf(d.nextWave);
      if ((s === 0 || s === 3) && d.nextWave > 1) {
        this.beatFor = d.nextWave;
        this.beat(s === 0 ? 'dawn' : 'night');
      }
    }
    if (this.beatShot && d.phase !== 'break' && this.beatOffT < 0) this.beatOffT = 2.3;
    if (this.beatOffT >= 0) {
      this.beatOffT -= dt;
      if (this.beatOffT < 0) {
        if (r.camRig.cine === this.beatShot) r.camRig.setCine(null);
        r.engine.letterbox(false, 0.5);
        this.beatShot = null;
      }
    }
  }

  private beat(kind: 'dawn' | 'night') {
    const r = this.r;
    const p = kind === 'dawn' ? PRESETS.todDawn : PRESETS.todNight;
    if (kind === 'dawn') {
      r.ctx.sfx('divine_chime', null, 0.75, 0.7);
      r.ctx.sfx('wave_start', null, 0.4, 0.8);
    } else {
      r.ctx.sfx('jackal_howl', null, 0.7, 0.78);
      r.ctx.sfx('quake_rumble', null, 0.4, 0.6);
    }
    if (r.camRig.cine || !r.engine.input.enabled || !r.player.alive) return;
    // over the hunter's shoulder toward the rising sun / the moon coming up
    const az = THREE.MathUtils.degToRad(p.sunAzim), el = THREE.MathUtils.degToRad(Math.min(25, p.sunElev));
    const fx = Math.cos(az), fz = Math.sin(az);
    const pl = r.player.pos;
    const pos = new THREE.Vector3(pl.x - fx * 5.5, 0, pl.z - fz * 5.5);
    pos.y = Math.max(pl.y, r.world.groundAt(pos.x, pos.z)) + 2.3;
    const look = new THREE.Vector3(pl.x + fx * 40, pl.y + 2 + Math.tan(el) * 40 * 0.6, pl.z + fz * 40);
    const shot = { pos, look, fov: 50 };
    r.camRig.setCine(shot);
    this.beatShot = r.camRig.cine ?? shot;
    this.beatOffT = -1;
    r.engine.letterbox(true, 0.6);
  }

  // ---------------------------------------------------------------- the HUD
  private plaqueState(): PlaqueState {
    const d = this.r.director;
    const boss = !!this.r.hud.last?.boss;
    const brk = d.phase === 'break';
    const w = brk ? d.nextWave : Math.max(1, d.wave);
    const slot = slotOf(w);
    const done = slot;
    let tag: string;
    let urgent = false;
    if (brk) {
      const sec = Math.max(0, Math.ceil(d.breakLeft));
      const nxt = slotOf(d.nextWave);
      tag = `${nxt === 0 ? 'DAWN' : nxt === 3 ? 'NIGHT' : nxt === 4 ? 'MIDNIGHT' : 'NEXT WAVE'} IN ${sec}`;
      urgent = sec <= 5;
    } else if (d.phase === 'combat' && d.budget > 0) {
      const left = d.remaining;
      tag = `${PHASE_NAME[phaseOf(w)]}  ${left} LEFT`;
      urgent = left <= 3;
    } else tag = PHASE_NAME[phaseOf(w)];
    let warn: PlaqueState['warn'] = null;
    const ns = slotOf(d.nextWave);
    if (brk && ns === 3) warn = { title: 'NIGHT FALLS', sub: 'THE DEAD HUNT HARDER', kind: 'night' };
    else if (brk && ns === 4) warn = { title: 'THE WITCHING HOUR', sub: 'DARKEST BEFORE THE DAWN', kind: 'night' };
    else if (brk && ns === 0 && d.nextWave > 1) warn = { title: 'DAWN BREAKS', sub: `DAY ${dayOf(d.nextWave)} RISES`, kind: 'dawn' };
    else if (!brk && slot >= 3 && d.timer < 5 && d.phase !== 'idle') warn = { title: slot === 3 ? 'NIGHT FALLS' : 'THE WITCHING HOUR', sub: 'MORE OF THEM, AND MEANER', kind: 'night' };
    return { visible: d.wave > 0 && !boss && this.r.hud.visible, day: dayOf(w), slot, done, inBreak: brk, tag, urgent, warn };
  }

  private glassState() {
    const r = this.r, d = r.director, hud = r.hud as typeof r.hud & Slotted;
    const sl = this.slot;
    const k = sl?.k ?? hud.uiK ?? 1;
    const h = Math.round((sl?.h ?? 48) * Math.min(1, k));
    const pr = this.plaque.rect;
    const W = Math.ceil(window.innerWidth / hud.scale);
    let at: { x: number; y: number } | null = sl && sl.visible ? { x: sl.x, y: sl.y } : null;
    if (!at) at = pr.shown ? { x: pr.x + pr.w + Math.round(h * 0.42) + 4, y: pr.y + Math.round(h / 2) + 2 } : { x: Math.round(W / 2 + Math.min(150, W * 0.275) + 26), y: Math.round(h / 2) + 6 };
    let frac = 1, flowing = false;
    const boss = r.hud.last?.boss;
    if (d.phase === 'break') {
      frac = d.breakTotal > 0 ? d.breakLeft / d.breakTotal : 0;
      flowing = d.breakLeft > 0;
    } else if (d.phase === 'combat' && d.spec) {
      frac = d.timeLeft / Math.max(1, d.spec.duration);
      flowing = true;
    } else if (d.phase === 'boss') {
      frac = boss ? Math.max(0, boss.frac) : 1;
      flowing = true;
    }
    return {
      frac, flowing,
      phaseKey: d.wave <= 0 ? 'idle' : `${d.phase === 'break' ? 'b' : 'w'}${d.wave}`,
      canHurry: d.phase === 'break' && d.breakLeft > 0.6 && r.player.alive,
      blocked: !!d.bellBlocked?.(),
      x: at.x, y: at.y, h,
      visible: r.hud.visible && d.wave > 0 && (r.hud.anchors?.slide ?? 0) < 0.98,
    };
  }

  update(dt: number, rdt = dt) {
    this.t += rdt;
    this.updateSky(rdt);
    this.updateLights(rdt);
    this.updateBeats(rdt);
    this.glass.update(rdt, this.glassState());
    this.r.director.hurry = this.glass.hurrying ? HURRY : 1;
  }

  dispose() {
    if (this.saved) Object.assign(PRESETS[this.key], this.saved);
    this.lantern.removeFromParent();
    for (const l of this.torches) l.removeFromParent();
    this.nightLoop?.stop(0.5);
    const hud = this.r.hud as typeof this.r.hud & { timeHud?: boolean };
    hud.timeHud = false;
    (hud as typeof hud & Slotted).releaseSlot?.('hourglass');
    const i = hud.painters.indexOf(this.plaque);
    if (i >= 0) hud.painters.splice(i, 1);
    this.glass.dispose();
    if (typeof window !== 'undefined' && (window as any).__days === this) (window as any).__days = null;
  }
}
