// High-level effect recipes built on the particle system + a pooled flash-light set.
import * as THREE from 'three';
import { Particles } from './Particles';
import { rnd } from '../../engine/math/rand';
import { P } from '../../engine/voxel/palette';

type V = { x: number; y: number; z: number };

export type HitKind = 'flesh' | 'bone' | 'armor' | 'sand' | 'rock' | 'wood' | 'poison' | 'linen' | 'chitin' | 'spirit' | 'crystal';

const COMIC_WORDS = false;

export class Fx {
  lights: { l: THREE.PointLight; t: number; dur: number; i0: number }[] = [];
  private tmp = new THREE.Vector3();
  constructor(public p: Particles, scene: THREE.Scene) {
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffc070, 0, 12, 1.6);
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ l, t: 1, dur: 1, i0: 0 });
    }
  }

  light(pos: V, color: number, intensity: number, dur: number, range = 12) {
    let best = this.lights[0];
    for (const L of this.lights) if (L.t / L.dur > best.t / best.dur) best = L;
    best.l.position.set(pos.x, pos.y, pos.z);
    best.l.color.setHex(color);
    best.l.distance = range;
    best.t = 0;
    best.dur = dur;
    best.i0 = intensity;
    best.l.intensity = intensity;
  }

  update(dt: number) {
    for (const L of this.lights) {
      if (L.t >= L.dur) {
        L.l.intensity = 0;
        continue;
      }
      L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      L.l.intensity = L.i0 * (1 - k) * (1 - k);
    }
  }

  // ------------------------------------------------------------- board / sand
  sandSpray(pos: V, vel: V, amount: number, color: number = P.sand1) {
    if (amount <= 0.02) return;
    this.p.emit({
      pos,
      count: Math.ceil(amount * 3),
      vel,
      spread: 1.6,
      up: 2.5 * amount,
      jitter: 0.25,
      life: [0.35, 0.8],
      size: [0.05, 0.03],
      sprite: ['grain0', 'grain1', 'grain2', 'grain3', 'grain4', 'grain5'],
      color: [color, P.sand0, P.sand2],
      gravity: 9,
      drag: 1.5,
      ground: true,
      bounce: 0.1,
    });
    if (rnd.chance(amount * 0.5))
      this.p.emit({ pos, count: 1, vel: { x: vel.x * 0.3, y: 0.6, z: vel.z * 0.3 }, spread: 0.5, life: [0.6, 1.2], size: [0.35, 1.1], sprite: ['puff0', 'puff1', 'puff2', 'puff3'], color: [P.sand1, P.sand0], alpha: 0.75, drag: 2, rot: 6, rotSpeed: 1 });
  }

  sandBurst(pos: V, power = 1, color: number = P.sand1) {
    this.p.emit({ pos, count: 14 * power, spread: 4 * power, up: 5 * power, life: [0.5, 1.1], size: [0.06, 0.04], sprite: ['grain0', 'grain1', 'grain2', 'grain3'], color: [color, P.sand0, P.sand2, P.sand3], gravity: 12, drag: 1, ground: true, bounce: 0.15 });
    this.p.emit({ pos, count: 6 * power, spread: 2.2 * power, up: 1.5, life: [0.7, 1.6], size: [0.5 * power, 1.6 * power], sprite: ['puff0', 'puff1', 'puff2', 'puff3', 'cloud0'], color: [P.sand0, P.sand1], alpha: 0.85, drag: 2.5, rot: 6, rotSpeed: 0.8, jitter: 0.3 * power });
  }

  dust(pos: V, size = 1, color: number = P.sand0, count = 4) {
    this.p.emit({ pos, count, spread: 1.2 * size, up: 0.8, life: [0.8, 1.6], size: [0.6 * size, 2.0 * size], sprite: ['cloud0', 'cloud1', 'cloud2', 'puff1'], color: [color, P.sand1], alpha: 0.8, drag: 2, rot: 6, rotSpeed: 0.6, jitter: 0.6 * size });
  }

  // ------------------------------------------------------------------ guns
  muzzle(pos: V, dir: V, color = 0xfff2a0, big = false) {
    const s = big ? 1.6 : 1;
    this.p.emit({ pos, count: 1, life: [0.06, 0.07], size: [0.55 * s, 0.75 * s], sprite: ['flash0', 'flash1', 'flash2'], animate: true, additive: true, color, rot: 6.28 });
    this.p.emit({ pos, count: 5, vel: { x: dir.x * 9, y: dir.y * 9, z: dir.z * 9 }, spread: 3, life: [0.08, 0.2], size: [0.03, 0.01], sprite: 'spark', additive: true, color: [0xffd070, 0xfff2a0], stretch: 0.03, drag: 4 });
    this.p.emit({ pos, count: 2, vel: { x: dir.x * 2, y: 0.5, z: dir.z * 2 }, spread: 0.6, life: [0.4, 0.8], size: [0.12, 0.5], sprite: ['puff0', 'puff2'], color: [0xd8d0c4, 0xbab0a4], alpha: 0.55, drag: 3, rot: 6, rotSpeed: 1.5 });
    this.light(pos, 0xffb860, big ? 4 : 2.2, 0.06, 7);
  }

  tracer(from: V, to: V, color = 0xfff0b0, speed = 420) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    this.p.emit({ pos: from, count: 1, vel: { x: (dx / d) * speed, y: (dy / d) * speed, z: (dz / d) * speed }, life: [d / speed, d / speed], size: [0.035, 0.6], sprite: 'streak', additive: true, color, stretch: 0.012, sizeJitter: 0 });
  }

  shells(pos: V, side: V, n = 6) {
    this.p.emit({ pos, count: n, vel: { x: side.x * 1.5, y: 2, z: side.z * 1.5 }, spread: 1.4, life: [1.2, 1.8], size: [0.05, 0.05], sprite: 'bullet', color: 0xffffff, gravity: 14, ground: true, bounce: 0.4, rot: 6, rotSpeed: 12 });
  }

  hit(pos: V, normal: V, kind: HitKind, power = 1) {
    const n = normal;
    const base = { x: n.x * 3 * power, y: n.y * 3 * power + 1, z: n.z * 3 * power };
    switch (kind) {
      case 'flesh':
        this.p.emit({ pos, count: 8 * power, vel: base, spread: 3, up: 2, life: [0.4, 0.9], size: [0.07, 0.04], sprite: ['blood0', 'blood1', 'blood2'], color: 0xffffff, gravity: 16, ground: true, bounce: 0.05 });
        this.p.emit({ pos, count: 1, life: [0.12, 0.15], size: [0.35, 0.5], sprite: 'splat', color: 0xffffff, rot: 6.28 });
        break;
      case 'bone':
        this.p.emit({ pos, count: 7 * power, vel: base, spread: 3.5, up: 2, life: [0.5, 1], size: [0.06, 0.05], sprite: ['bone', 'pebble'], color: [P.bone1, P.bone0], gravity: 15, ground: true, bounce: 0.3, rot: 6, rotSpeed: 10 });
        this.p.emit({ pos, count: 2, spread: 0.6, life: [0.3, 0.6], size: [0.2, 0.55], sprite: 'puff1', color: P.bone0, alpha: 0.7, drag: 3 });
        break;
      case 'armor':
      case 'chitin':
        this.p.emit({ pos, count: 9 * power, vel: base, spread: 6, life: [0.12, 0.35], size: [0.04, 0.01], sprite: 'spark', additive: true, color: kind === 'armor' ? [0xffe080, 0xfff6c0] : [0xc8ff5a, 0xffffff], stretch: 0.025, gravity: 6 });
        this.light(pos, 0xffd080, 2.5, 0.06, 6);
        break;
      case 'sand':
        this.sandBurst(pos, 0.45 * power);
        break;
      case 'rock':
        this.p.emit({ pos, count: 7 * power, vel: base, spread: 4, up: 2, life: [0.4, 0.9], size: [0.07, 0.05], sprite: 'pebble', color: 0xffffff, gravity: 15, ground: true, bounce: 0.35, rot: 6, rotSpeed: 8 });
        this.p.emit({ pos, count: 3, vel: { x: n.x, y: n.y, z: n.z }, spread: 0.8, life: [0.5, 1], size: [0.25, 0.8], sprite: ['puff0', 'puff1'], color: [P.stone1, P.stone0], alpha: 0.8, drag: 3 });
        this.p.emit({ pos, count: 3, vel: base, spread: 5, life: [0.08, 0.2], size: [0.03, 0.01], sprite: 'spark', additive: true, color: 0xffe0a0, stretch: 0.02 });
        break;
      case 'wood':
        this.p.emit({ pos, count: 8 * power, vel: base, spread: 4, up: 2, life: [0.5, 1.1], size: [0.08, 0.06], sprite: 'woodchip', color: 0xffffff, gravity: 14, ground: true, bounce: 0.3, rot: 6, rotSpeed: 9 });
        break;
      case 'linen':
        this.p.emit({ pos, count: 6 * power, vel: base, spread: 2.5, up: 1.5, life: [0.6, 1.4], size: [0.09, 0.07], sprite: 'linen', color: [0xffffff, 0xe0d4b8], gravity: 4, drag: 2, rot: 6, rotSpeed: 6 });
        this.p.emit({ pos, count: 4, spread: 1, life: [0.5, 0.9], size: [0.2, 0.6], sprite: 'puff2', color: P.sand0, alpha: 0.7, drag: 3 });
        break;
      case 'poison':
        this.p.emit({ pos, count: 8 * power, vel: base, spread: 2.5, up: 2, life: [0.5, 1], size: [0.08, 0.04], sprite: ['ichor', 'bubble'], color: 0xffffff, gravity: 9, ground: true, bounce: 0.1 });
        this.p.emit({ pos, count: 1, life: [0.15, 0.2], size: [0.4, 0.7], sprite: 'venomSplat', color: 0xffffff, additive: true, rot: 6.28 });
        break;
      case 'spirit':
        this.p.emit({ pos, count: 10 * power, vel: base, spread: 3, life: [0.4, 0.9], size: [0.1, 0.02], sprite: ['glow8', 'star4'], additive: true, color: [P.spirit0, P.spirit1, 0xffffff], drag: 2 });
        break;
      case 'crystal':
        this.p.emit({ pos, count: 9 * power, vel: base, spread: 4, up: 2, life: [0.5, 1], size: [0.08, 0.05], sprite: 'crystal', color: 0xffffff, gravity: 12, ground: true, bounce: 0.4, rot: 6, rotSpeed: 8 });
        this.p.emit({ pos, count: 4, spread: 3, life: [0.2, 0.4], size: [0.15, 0.02], sprite: 'glow8', additive: true, color: P.alphaCrystal0 });
        break;
    }
  }

  // ------------------------------------------------------------ explosions
  explosion(pos: V, radius = 3, color: 'fire' | 'poison' | 'divine' | 'curse' = 'fire') {
    const pal =
      color === 'poison'
        ? { flash: P.poison0, fire: [P.poison0, P.poison1, P.poison2], smoke: [0x4a6a30, 0x2e4a20], light: 0x9dff3a }
        : color === 'divine'
          ? { flash: 0xfff6c0, fire: [0xffffff, P.divineGold, P.gold1], smoke: [0xf0e0b0, 0xd0b880], light: 0xffd36b }
          : color === 'curse'
            ? { flash: P.curse0, fire: [P.curse0, P.curse1, 0xffffff], smoke: [0x3a2050, 0x24123a], light: 0xb565ff }
            : { flash: 0xfff2a0, fire: [P.fire0, P.fire1, P.fire2], smoke: [0x5a4a40, 0x3a302a, 0x786050], light: 0xffa040 };
    const r = radius;
    this.p.emit({ pos, count: 1, life: [0.08, 0.1], size: [r * 0.8, r * 1.6], sprite: 'glow32', additive: true, color: pal.flash, alpha: 0.5 });
    this.p.emit({ pos, count: 1, life: [0.35, 0.4], size: [r * 0.5, r * 3.2], sprite: 'ring', additive: true, color: pal.fire[1], sizeJitter: 0 });
    this.p.emit({ pos, count: 16 + r * 4, spread: r * 3.2, up: r * 1.5, life: [0.25, 0.6], size: [r * 0.35, r * 0.08], sprite: ['flame0', 'flame1', 'flame2', 'flame3', 'glow16'], additive: true, color: pal.fire, drag: 3 });
    this.p.emit({ pos, count: 10 + r * 2, spread: r * 1.4, up: r * 0.9, life: [1.0, 2.2], size: [r * 0.4, r * 1.4], sprite: ['cloud0', 'cloud1', 'cloud2'], color: pal.smoke, alpha: 0.9, drag: 1.8, rot: 6, rotSpeed: 0.7, jitter: r * 0.3, delay: 0.05 });
    this.p.emit({ pos, count: 14 + r * 3, spread: r * 4, up: r * 2.5, life: [0.6, 1.4], size: [0.08, 0.05], sprite: ['pebble', 'grain0', 'grain2'], color: [P.sand1, P.stone2, 0xffffff], gravity: 16, ground: true, bounce: 0.3 });
    this.p.emit({ pos, count: 10, spread: r * 6, life: [0.2, 0.5], size: [0.06, 0.01], sprite: 'spark', additive: true, color: pal.fire, stretch: 0.03, gravity: 8 });
    this.light(pos, pal.light, 6 + r * 1.5, 0.3, r * 5);
  }

  poisonCloud(pos: V, radius = 2.5) {
    this.p.emit({ pos, count: 8, spread: radius * 0.6, up: 0.6, life: [1.2, 2.2], size: [radius * 0.4, radius * 1.1], sprite: ['cloud0', 'cloud1', 'cloud2'], color: [0x7fd03a, 0x5aa82a, 0x9dff3a], alpha: 0.55, drag: 1.5, rot: 6, rotSpeed: 0.5, jitter: radius * 0.5 });
    this.p.emit({ pos, count: 10, spread: radius, up: 1.5, life: [0.6, 1.4], size: [0.08, 0.03], sprite: 'bubble', color: 0xffffff, gravity: -1, jitter: radius * 0.6 });
  }

  bubbles(pos: V, n = 2) {
    this.p.emit({ pos, count: n, spread: 0.5, up: 1.2, life: [0.4, 0.9], size: [0.06, 0.02], sprite: 'bubble', color: 0xffffff, gravity: -1.5, jitter: 0.25 });
  }

  flames(pos: V, n = 2, scale = 1) {
    this.p.emit({ pos, count: n, spread: 0.4, up: 2.2, life: [0.25, 0.55], size: [0.35 * scale, 0.1 * scale], sprite: ['flame0', 'flame1', 'flame2', 'flame3'], animate: true, additive: true, color: [0xffffff], jitter: 0.25 * scale, gravity: -2 });
  }

  glyphs(pos: V, color: number = P.divineGold, n = 6, radius = 1.2) {
    this.p.emit({ pos, count: n, spread: 0.8, up: 1.5, life: [0.8, 1.6], size: [0.25, 0.05], sprite: ['glyph0', 'glyph1', 'glyph2', 'glyph3'], additive: true, color, jitter: radius, drag: 1.5, fadeIn: 0.2 });
  }

  ring(pos: V, color: number, size = 4, life = 0.45) {
    this.p.emit({ pos, count: 1, life: [life, life], size: [size * 0.2, size], sprite: 'ring', additive: true, color, sizeJitter: 0 });
  }

  coins(pos: V, n = 8) {
    this.p.emit({ pos, count: n, spread: 3, up: 6, life: [0.9, 1.4], size: [0.16, 0.16], sprite: ['coinspin0', 'coinspin1', 'coinspin2', 'coinspin3'], color: 0xffffff, gravity: 18, ground: true, bounce: 0.45, sizeJitter: 0.1 });
    this.p.emit({ pos, count: n, spread: 2.5, up: 3, life: [0.3, 0.7], size: [0.12, 0.02], sprite: 'star4', additive: true, color: P.gold0 });
  }

  sparkle(pos: V, color: number, n = 6, r = 0.6) {
    this.p.emit({ pos, count: n, spread: 1, up: 1, life: [0.3, 0.8], size: [0.14, 0.02], sprite: ['star4', 'spark'], additive: true, color, jitter: r });
  }

  /** floating damage number (screen-constant pixel digits) */
  number(pos: V, value: number | string, color = 0xffffff, scale = 1, rise = 1.6) {
    const s = typeof value === 'number' ? (value >= 10000 ? Math.round(value / 1000) + 'k' : String(Math.max(0, Math.round(value)))) : value;
    const w = 0.42 * scale;
    const x0 = (-(s.length - 1) * w) / 2;
    const vx = (rnd.next() - 0.5) * 1.2,
      vz = (rnd.next() - 0.5) * 1.2;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      this.p.emit({ pos: { x: pos.x, y: pos.y, z: pos.z }, count: 1, vel: { x: vx, y: rise * 2.2, z: vz }, gravity: rise * 3.2, drag: 1.2, life: [0.75, 0.75], size: [0.6 * scale, 0.5 * scale], sprite: 'dg_' + ch, color, screen: true, offset: [x0 + i * w, 0], sizeJitter: 0 });
    }
  }

  private lastWord = 0;
  /** comic 2D onomatopoeia popping in 3D space (rate-limited so it stays special) */
  word(pos: V, sprite: string, scale = 1, force = false) {
    if (!COMIC_WORDS) return; // no cartoon onomatopoeia (realistic direction)
    const now = performance.now();
    if (!force && now - this.lastWord < 650) return;
    this.lastWord = now;
    this.p.emit({ pos: { x: pos.x, y: pos.y + 1.2, z: pos.z }, count: 1, vel: { x: 0, y: 1.4, z: 0 }, life: [0.7, 0.7], size: [1.4 * scale, 1.15 * scale], sprite, color: 0xffffff, screen: true, sizeJitter: 0, drag: 2.5, rot: (Math.random() - 0.5) * 0.35 });
  }

  speedLines(cam: THREE.Camera, intensity: number) {
    if (intensity <= 0.05 || !rnd.chance(intensity)) return;
    const fwd = this.tmp.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    for (let k = 0; k < Math.ceil(intensity * 3); k++) {
      const a = rnd.next() * Math.PI * 2;
      const r = 2.2 + rnd.next() * 2.5;
      const p = cam.position.clone().addScaledVector(fwd, 7 + rnd.next() * 5).addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r * 0.6);
      this.p.emit({ pos: p, count: 1, vel: { x: -fwd.x * 60, y: -fwd.y * 60, z: -fwd.z * 60 }, life: [0.12, 0.2], size: [0.02, 0.02], sprite: 'speedline', additive: true, color: 0xfff6e0, alpha: 0.6 * intensity, stretch: 0.03 });
    }
  }
}
