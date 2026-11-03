// The cinematics' own effects stage: a private pixel particle system, voxel
// debris, voxel fire/smoke billows and flash lights that run on cinematic time
// (so an explosion keeps rolling in slow motion while the world itself is all
// but frozen), plus the recipes the cutscenes share: the big explosion, the
// shockwave through the living sand, drifting ash and embers, a burning wreck.
// One kit per scene (Cinema owns it; the choice stage borrows it).
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import { Particles } from '../fx/Particles';
import { Debris } from '../fx/Debris';
import { Billows } from './Billows';

type V = { x: number; y: number; z: number };

/** what the kit needs from the world (World and CaveWorld both fit) */
export interface KitWorld {
  groundAt(x: number, z: number): number;
  sand?: { ring(x: number, z: number, o: { speed: number; height: number; width: number; life: number; rise?: number; fall?: number; delay?: number }): unknown; update(dt: number): void };
  env?: { fog?: THREE.Fog | null };
}

/** who owns the screen right now (so cutscenes never stack) */
export const cineFlags = { choice: false, zone: false };

export const SAND = [0xf6dfb0, 0xeccb8f, 0xe0b373, 0xcf9a5a];
export const GRAIN = ['grain0', 'grain1', 'grain2', 'grain3'];
export const PUFF = ['puff0', 'puff1', 'cloud0', 'cloud1'];
const FIRE = [0xfff2c0, 0xffc050, 0xff8a2a, 0xff5a1a];
const EMBER = [0xffd080, 0xffa040, 0xff6a1a];
const ASH = [0x3a3430, 0x5a524a, 0x8a8078];
const STONE = [0x8a7a68, 0x6a5a4a, 0xb8a080];
const CHAR = [0x2a1e16, 0x4a3424, 0x6a4a2e];

interface Shock {
  x: number;
  z: number;
  speed: number;
  life: number;
  t: number;
  power: number;
}

export class CineKit {
  particles = new Particles();
  debris = new Debris();
  billows = new Billows();
  private lights: { l: THREE.PointLight; t: number; dur: number; i0: number; flicker: number }[] = [];
  private shocks: Shock[] = [];
  private timers: { t: number; fn: () => void }[] = [];
  private fires: { at: THREE.Vector3; r: number; t: number; life: number }[] = [];
  /** camera shake requests (the cinematic routes them to its camera) */
  onShake: ((a: number) => void) | null = null;
  /** sim time */
  time = 0;

  constructor(private engine: Engine, private scene: THREE.Scene, public world: KitWorld) {
    this.particles.groundAt = (x, z) => world.groundAt(x, z);
    this.debris.groundAt = (x, z) => world.groundAt(x, z);
    this.billows.groundAt = (x, z) => world.groundAt(x, z);
    scene.add(this.particles.group, this.debris.mesh, this.billows.mesh);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 30, 1.6);
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ l, t: 1, dur: 1, i0: 0, flicker: 0 });
    }
  }

  get busy() {
    return this.billows.active || this.shocks.length > 0 || this.timers.length > 0 || this.fires.length > 0;
  }

  /** run fn after t seconds of kit time */
  after(t: number, fn: () => void) {
    this.timers.push({ t: this.time + t, fn });
  }

  sfx(id: string, pos?: V | null, volume = 1, pitch = 1) {
    this.engine.audio.play(id, { pos: pos ?? undefined, volume, pitch });
  }

  light(at: V, color: number, intensity: number, dur: number, range: number, flicker = 0) {
    let best = this.lights[0];
    for (const L of this.lights) if (L.t / L.dur > best.t / best.dur) best = L;
    best.l.position.set(at.x, at.y, at.z);
    best.l.color.setHex(color);
    best.l.distance = range;
    best.t = 0;
    best.dur = dur;
    best.i0 = intensity;
    best.flicker = flicker;
    best.l.intensity = intensity;
  }

  /**
   * The big one: white flash, voxel fireball and billowing smoke, a shock ring
   * through the living sand, flying debris, sparks, embers, sand and ash.
   */
  blast(at: V, r: number, o: { debris?: number; wood?: boolean; ring?: boolean; flash?: boolean; sound?: boolean; dust?: boolean } = {}) {
    const P = this.particles;
    const g = this.world.groundAt(at.x, at.z);
    const base = { x: at.x, y: Math.max(g, at.y), z: at.z };
    const mid = { x: at.x, y: base.y + r * 0.45, z: at.z };
    if (o.flash !== false) this.engine.flash(0xfff0d0, 0.55, 0.32);
    this.light({ x: at.x, y: base.y + r * 0.8, z: at.z }, 0xffa040, 40 + r * 14, 2.2, r * 11, 0.35);
    this.billows.fireball(base, r, { dust: o.dust ?? true });
    // pixel layer: flash, shock disc, sparks, embers, grit, pebbles, dust, ash
    P.emit({ pos: mid, count: 2, life: [0.1, 0.16], size: [r * 1.4, r * 3.4], sprite: ['glow32', 'flash0'], additive: true, color: 0xfff4d0, alpha: 0.9, sizeJitter: 0 });
    P.emit({ pos: { x: at.x, y: base.y + 0.3, z: at.z }, count: 1, life: [0.5, 0.5], size: [r * 0.5, r * 7], sprite: 'ring', additive: true, color: 0xffd8a0, sizeJitter: 0 });
    P.emit({ pos: mid, count: 70 + r * 12, spread: r * 7, up: r * 3.5, life: [0.35, 1.2], size: [0.1, 0.012], sprite: 'spark', additive: true, color: FIRE, stretch: 0.05, gravity: 10, drag: 0.6 });
    P.emit({ pos: mid, count: 40 + r * 10, spread: r * 3, up: r * 4, life: [2.2, 4.4], size: [0.07, 0.02], sprite: ['dot3', 'spark'], additive: true, color: EMBER, gravity: 1.6, drag: 1.1, jitter: r * 0.4 });
    P.emit({ pos: base, count: 120 + r * 20, spread: r * 4.5, up: r * 4, life: [0.8, 1.9], size: [0.08, 0.05], sprite: GRAIN, color: SAND, gravity: 14, ground: true, bounce: 0.3, jitter: r * 0.3 });
    P.emit({ pos: base, count: 24 + r * 4, spread: r * 5, up: r * 3.4, life: [0.9, 1.8], size: [0.12, 0.1], sprite: 'pebble', color: STONE, gravity: 18, ground: true, bounce: 0.35, rot: 6, rotSpeed: 8 });
    if (o.wood) P.emit({ pos: mid, count: 30 + r * 5, spread: r * 5, up: r * 4, life: [1.2, 2.4], size: [0.16, 0.14], sprite: 'woodchip', color: [0x8a5a30, 0x5a3a1e, 0x2a1a10], gravity: 13, ground: true, bounce: 0.3, rot: 6, rotSpeed: 10 });
    P.emit({ pos: base, count: 14 + r * 2, spread: r * 2.2, up: r * 0.9, life: [1.6, 3.2], size: [r * 0.35, r * 1.4], sprite: PUFF, color: [0xe6cf9f, 0xd8b884, 0xc8a070], alpha: 0.7, drag: 1.6, rot: 6, rotSpeed: 0.5, jitter: r * 0.4, delay: 0.05 });
    P.emit({ pos: { x: at.x, y: base.y + r * 1.6, z: at.z }, count: 40 + r * 6, spread: r * 2, up: r * 1.5, life: [3, 5.5], size: [0.06, 0.04], sprite: ['dot2', 'grain1'], color: ASH, gravity: 0.5, drag: 0.9, jitter: r, delay: 0.3 });
    // voxel debris: clods of sand, stone and charred wood
    const nd = o.debris ?? Math.round(26 + r * 6);
    if (nd > 0) {
      const cols = o.wood ? [...SAND.slice(0, 2), ...CHAR, 0x8a5a30] : [...SAND, ...STONE, CHAR[0]];
      this.debris.burst(at.x, base.y + 0.3, at.z, nd, 0.11 + r * 0.02, cols, 7 + r * 1.6, 6 + r * 1.2);
    }
    if (o.ring !== false) this.shock(at.x, at.z, { power: Math.min(1.6, 0.5 + r * 0.2) });
    if (o.sound !== false) {
      this.sfx('explosion_big', base, 1, 0.7 + Math.random() * 0.1);
      this.sfx('explosion', base, 0.8, 0.55);
      this.sfx('quake_rumble', base, 0.8, 0.8);
    }
    this.onShake?.(Math.min(1, 0.45 + r * 0.08));
  }

  /** a shock front through the living sand (the world's sand shape plus our own spray at the crest) */
  shock(x: number, z: number, o: { power?: number; speed?: number; life?: number; delay?: number } = {}) {
    const power = o.power ?? 1;
    const speed = o.speed ?? 15;
    const life = o.life ?? 2.2;
    try {
      this.world.sand?.ring(x, z, { speed, height: 0.38 + power * 0.4, width: 1.3 + power * 0.8, life, rise: 0.06, fall: 1.0, delay: o.delay ?? 0 });
    } catch (e) {
      console.warn('[cine] sand ring failed', e);
    }
    this.shocks.push({ x, z, speed, life, t: -(o.delay ?? 0), power });
  }

  /** a burning wreck that keeps smouldering (billows + flames + flickering light) */
  burn(at: V, r: number, life: number) {
    this.fires.push({ at: new THREE.Vector3(at.x, at.y, at.z), r, t: 0, life });
  }

  /** ash flakes and embers drifting across a point (for close-ups) */
  ash(around: V, n: number, wind: V = { x: 1.2, y: 0, z: 0.4 }) {
    this.particles.emit({ pos: around, count: n, vel: { x: wind.x, y: -0.15, z: wind.z }, spread: 0.6, jitter: 2.2, life: [1.5, 3], size: [0.035, 0.025], sprite: ['dot2', 'grain1'], color: ASH, gravity: 0.25, drag: 0.4 });
    this.particles.emit({ pos: around, count: Math.ceil(n / 3), vel: { x: wind.x, y: 0.4, z: wind.z }, spread: 0.6, jitter: 2.2, life: [1, 2.2], size: [0.035, 0.012], sprite: 'dot3', additive: true, color: EMBER, gravity: -0.2, drag: 0.4 });
  }

  /** a puff of sand where something breaches or lands */
  sandPop(at: V, power = 1) {
    const P = this.particles;
    P.emit({ pos: at, count: Math.round(22 * power), spread: 2.6 * power, up: 3.2 * power, life: [0.5, 1.2], size: [0.07, 0.05], sprite: GRAIN, color: SAND, gravity: 12, ground: true, bounce: 0.25, jitter: 0.25 * power });
    P.emit({ pos: at, count: Math.round(4 * power), spread: 0.9 * power, up: 0.7, life: [0.9, 1.7], size: [0.35 * power, 1.1 * power], sprite: PUFF, color: [0xe6cf9f, 0xd6b888], alpha: 0.6, drag: 1.8, rot: 6, rotSpeed: 0.6, jitter: 0.3 * power });
  }

  update(dt: number, worldDt = dt) {
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--)
      if (this.time >= this.timers[i].t) {
        const f = this.timers[i].fn;
        this.timers.splice(i, 1);
        try {
          f();
        } catch (e) {
          console.warn('[cine] timer failed', e);
        }
      }
    // the living sand keeps our pace even while the world stands still
    if (this.shocks.length && dt > worldDt + 1e-4) this.world.sand?.update(dt - worldDt);
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.t += dt;
      if (s.t >= s.life) {
        this.shocks.splice(i, 1);
        continue;
      }
      if (s.t < 0) continue;
      const R = s.speed * s.t;
      const fade = 1 - s.t / s.life;
      const n = Math.min(14, Math.round(R * 0.6 * s.power * fade + 2));
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const x = s.x + Math.cos(a) * R, z = s.z + Math.sin(a) * R;
        const y = this.world.groundAt(x, z);
        this.particles.emit({ pos: { x, y: y + 0.1, z }, count: 2, vel: { x: Math.cos(a) * 6 * fade, y: 3 + 3 * s.power * fade, z: Math.sin(a) * 6 * fade }, spread: 1.2, life: [0.4, 0.9], size: [0.07, 0.05], sprite: GRAIN, color: SAND, gravity: 10, ground: true, jitter: 0.3 });
        if (k % 4 === 0) this.particles.emit({ pos: { x, y: y + 0.3, z }, count: 1, vel: { x: Math.cos(a) * 2, y: 0.8, z: Math.sin(a) * 2 }, spread: 0.4, life: [0.7, 1.3], size: [0.5, 1.4], sprite: PUFF, color: 0xe6cf9f, alpha: 0.45, drag: 1.6, rot: 6, rotSpeed: 0.4 });
      }
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      if (f.t >= f.life) {
        this.fires.splice(i, 1);
        continue;
      }
      const k = 1 - f.t / f.life;
      this.billows.smoulder(f.at, f.r, dt, k);
      if (Math.random() < dt * 30 * k)
        this.particles.emit({ pos: { x: f.at.x + (Math.random() - 0.5) * f.r, y: f.at.y + Math.random() * f.r * 0.3, z: f.at.z + (Math.random() - 0.5) * f.r }, count: 2, spread: 0.4, up: 2.4, life: [0.3, 0.7], size: [0.4, 0.1], sprite: ['flame0', 'flame1', 'flame2', 'flame3'], animate: true, additive: true, color: [0xffffff], jitter: 0.2, gravity: -2 });
      if (Math.random() < dt * 8 * k) this.particles.emit({ pos: f.at, count: 1, spread: 1.5, up: 3, life: [1.5, 3], size: [0.05, 0.02], sprite: 'dot3', additive: true, color: EMBER, gravity: 0.8, drag: 1, jitter: f.r * 0.5 });
      // keep a warm flickering light on the wreck
      const L = this.lights[1];
      if (L.t >= L.dur * 0.6) {
        L.l.position.set(f.at.x, f.at.y + f.r * 0.6, f.at.z);
        L.l.color.setHex(0xff8a30);
        L.l.distance = f.r * 9;
        L.l.intensity = (8 + f.r * 5) * k * (0.75 + Math.random() * 0.5);
      }
    }
    for (const L of this.lights) {
      if (L.t >= L.dur) continue;
      L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      L.l.intensity = L.i0 * (1 - k) * (1 - k) * (L.flicker > 0 ? 1 - L.flicker + Math.random() * L.flicker * 2 : 1);
      if (L.t >= L.dur) L.l.intensity = 0;
    }
    this.particles.update(dt, this.world.env?.fog ?? null);
    this.debris.update(dt);
    this.billows.update(dt);
  }

  /** drop everything in flight */
  clear() {
    this.timers.length = 0;
    this.shocks.length = 0;
    this.fires.length = 0;
    this.particles.clear();
    this.debris.clear();
    this.billows.clear();
    for (const L of this.lights) {
      L.t = L.dur;
      L.l.intensity = 0;
    }
  }

  dispose() {
    this.clear();
    this.particles.group.removeFromParent();
    this.particles.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.debris.mesh.removeFromParent();
    this.debris.mesh.geometry.dispose();
    (this.debris.mesh.material as THREE.Material).dispose();
    this.billows.dispose();
    for (const L of this.lights) L.l.removeFromParent();
    void this.scene;
  }
}
