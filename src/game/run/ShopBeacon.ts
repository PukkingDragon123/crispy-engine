// How you find the walking shop. Gobi the turtle house wanders his camp, and
// everything about him is meant to be noticed from far off:
//  • a tall column of stove smoke from the stovepipe, leaning with the wind
//    (pixel-art puffs, a dark core and a sunlit fringe), visible from across
//    the zone; it gutters out while he is dug in
//  • the porch lanterns: a warm halo up close, and a steady screen-sized
//    twinkle from far away so the eye finds it against the dunes
//  • the shop's music carried on the wind (louder downwind, in gusts), the
//    porch wind chime, and the shop bell tolling through the break between
//    waves ("the shop is open")
//  • giant footprints pressed into the sand on long wandering trails that all
//    lead in to his camp (one from where the ride starts), re-pressed as you
//    ride near them so the wind never quite fills them in
//  • a short toast the first time you come within sight of him (and another if
//    he is dug in when you arrive); the bell and the toast come back with every
//    fresh stock (after each boss wave)
// Shop.ts makes one per turtle house and drives it from animateMerchant; the
// HUD compass (ui/ProgressLadder) reads `info`.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import { noise, rnd } from '../../engine/math/rand';

export interface BeaconInfo {
  /** where the shop is (the turtle's root) */
  pos: THREE.Vector3;
  /** dug in: no trade until the outlaws are gone */
  hidden: boolean;
  /** metres from the hunter (ground plane) */
  dist: number;
  /** the hunter has been inside this run */
  visited: boolean;
}

export interface BeaconSource {
  /** the turtle's root (he walks; the beacon follows) */
  root: THREE.Object3D;
  /** the camp he walks round */
  home: THREE.Vector3;
  /** the stovepipe mouth, world space (null: no smoke) */
  chimney(out: THREE.Vector3): THREE.Vector3 | null;
  /** the lantern glass, world space */
  lanterns(out: THREE.Vector3[]): THREE.Vector3[];
}

interface Print {
  x: number;
  z: number;
  /** heading, radians (atan2 of the walk direction: toward the camp) */
  a: number;
  /** 0..1 how deep (old prints, far out on a trail, are shallower) */
  d: number;
  /** clock of the last pressing (-1: never) */
  at: number;
}

const SMOKE = [0x8e877c, 0x9d958a, 0x7a736a, 0xb2aa9c];
const SMOKE_LIT = [0xd8c6a6, 0xcdb894, 0xe6d6b8];

export class ShopBeacon {
  private t = rnd.next() * 10;
  private smokeT = 0;
  private glowT = 0;
  private chimeT = 3 + rnd.next() * 4;
  private bellT = 2;
  private music: ReturnType<Ctx['audio']['loop']> = null;
  private musicVol = 0;
  private prints: Print[] = [];
  private cursor = 0;
  private toastArmed = true;
  private hiddenToast = true;
  private v = new THREE.Vector3();
  private lamps: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()];
  /** seconds of the break between waves left (the bell only calls during it) */
  private breakLeft = 0;
  private breakWave = 0;
  private unsub: (() => void)[] = [];
  readonly info: BeaconInfo;

  constructor(private ctx: Ctx, private src: BeaconSource) {
    this.info = { pos: src.root.position.clone(), hidden: false, dist: 1e9, visited: false };
    this.layTrails();
    this.unsub.push(
      ctx.events.on('intermission', (b: { total?: number }) => {
        this.breakLeft = b?.total ?? 30;
        this.breakWave = ctx.run.wave;
        this.bellT = 1.5;
      })
    );
  }

  /** the hunter went inside: no more "nearby" toasts and the bell stops calling, until the next fresh stock (every boss wave) */
  visited() {
    this.visitedAt = Math.floor(Math.max(0, this.ctx.run.wave) / 5);
    this.info.visited = true;
  }
  private visitedAt = -1;

  // ------------------------------------------------------------------ the trails
  /**
   * Three wandering trails of prints leading in to the camp: one from where the
   * ride starts (when that is within a few hundred metres), two from out in the
   * open. Each is walked from its far end toward the camp, so every print points
   * the way to the shop.
   */
  private layTrails() {
    const ctx = this.ctx, H = this.src.home;
    const st = ctx.world.sa?.start;
    const heads: number[] = [];
    if (st) {
      const d = Math.hypot(st.x - H.x, st.z - H.z);
      if (d > 30 && d < 420) heads.push(Math.atan2(st.z - H.z, st.x - H.x));
    }
    const base = heads.length ? heads[0] : rnd.next() * Math.PI * 2;
    heads.push(base + 2.1 + rnd.range(-0.4, 0.4), base - 2.2 + rnd.range(-0.4, 0.4));
    heads.forEach((a0, ti) => {
      const len = ti === 0 && st ? Math.min(Math.hypot(st.x - H.x, st.z - H.z) - 14, 260) : 110 + rnd.next() * 50;
      const seed = rnd.next() * 100;
      // walk out from the camp, bending with a slow noise, then lay the prints back toward it
      const pts: { x: number; z: number }[] = [];
      let x = H.x + Math.cos(a0) * 7, z = H.z + Math.sin(a0) * 7, a = a0;
      for (let s = 0; s < len; s += 1.0) {
        a = a0 + noise.n2(s * 0.012, seed) * 0.75;
        x += Math.cos(a);
        z += Math.sin(a);
        pts.push({ x, z });
      }
      // a left/right/left stride (fore and hind feet nearly overprint), 2.6 m between steps
      for (let i = pts.length - 1, k = 0; i > 2; i -= 2.6, k++) {
        const p = pts[Math.floor(i)], q = pts[Math.max(0, Math.floor(i) - 2)];
        const dir = Math.atan2(q.z - p.z, q.x - p.x); // toward the camp
        const side = k % 2 ? 1 : -1;
        const nx = -Math.sin(dir), nz = Math.cos(dir);
        const far = i / pts.length;
        this.prints.push({ x: p.x + nx * side * 1.85, z: p.z + nz * side * 1.85, a: dir + side * 0.12, d: 1 - far * 0.45, at: -1 });
      }
    });
  }

  /** press a few prints near the hunter (each is five round dents: two pad lobes, three claws) */
  private pressPrints(hx: number, hz: number) {
    const P = this.prints, n = P.length;
    if (!n) return;
    const clock = this.t;
    let done = 0;
    for (let tries = 0; tries < 48 && done < 5; tries++) {
      const p = P[this.cursor];
      this.cursor = (this.cursor + 1) % n;
      if (Math.abs(p.x - hx) > 95 || Math.abs(p.z - hz) > 95) continue;
      if (p.at >= 0 && clock - p.at < 18) continue;
      p.at = clock;
      done++;
      const ca = Math.cos(p.a), sa = Math.sin(p.a);
      const at = (f: number, l: number) => [p.x + ca * f - sa * l, p.z + sa * f + ca * l];
      const r = 0.36 + p.d * 0.12;
      for (const [f, l, rr] of [[-0.34, 0, r * 0.92], [0.12, 0.04, r * 1.05], [0.5, -0.02, r * 0.86], [0.92, -0.32, 0.13], [1.0, 0.0, 0.14], [0.92, 0.32, 0.13]]) {
        const [x, z] = at(f, l);
        this.ctx.events.emit('groundMark', x, z, rr, 0);
      }
    }
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number, hunter: THREE.Vector3 | null, hidden: boolean) {
    if (dt <= 0) return;
    this.t += dt;
    const ctx = this.ctx, root = this.src.root;
    const I = this.info;
    I.pos.copy(root.position);
    I.hidden = hidden;
    I.visited = this.visitedAt === Math.floor(Math.max(0, ctx.run.wave) / 5);
    I.dist = hunter ? Math.hypot(hunter.x - root.position.x, hunter.z - root.position.z) : 1e9;
    const d = I.dist;
    const wind = ctx.world.sa?.wind ?? { x: 1, z: 0 };
    const wl = Math.hypot(wind.x, wind.z) || 1;
    const gust = 0.55 + 0.45 * (0.5 + 0.5 * noise.n2(this.t * 0.11, 41.3));

    // ---- the smoke column: thick and tall while the stove is lit, a thin wisp while he is dug in
    this.smokeT -= dt;
    const ch = this.src.chimney(this.v);
    if (ch && this.smokeT <= 0) {
      this.smokeT = hidden ? 0.9 : 0.16 + rnd.next() * 0.08;
      const lean = 0.9 + gust * 1.3;
      const vy = hidden ? 0.8 : 2.7 + rnd.next() * 0.8;
      ctx.particles.emit({
        pos: { x: ch.x, y: ch.y + 0.25, z: ch.z }, count: 1,
        vel: { x: (wind.x / wl) * lean, y: vy, z: (wind.z / wl) * lean },
        spread: 0.25, jitter: 0.15, gravity: -0.05, drag: 0.08,
        life: hidden ? [1.6, 2.4] : [7.5, 10.5], size: hidden ? [0.3, 1.1] : [0.7, 5.6], sizeJitter: 0.25,
        sprite: ['puff0', 'puff1', 'puff2', 'puff3', 'cloud0', 'cloud1'], color: SMOKE, alpha: hidden ? 0.3 : 0.5, rot: 6, rotSpeed: 0.25, fadeIn: 0.35,
      });
      // the sunlit fringe on the upwind side
      if (!hidden && rnd.chance(0.45))
        ctx.particles.emit({
          pos: { x: ch.x - (wind.x / wl) * 0.3, y: ch.y + 0.6, z: ch.z - (wind.z / wl) * 0.3 }, count: 1,
          vel: { x: (wind.x / wl) * lean * 0.9, y: vy * 0.95, z: (wind.z / wl) * lean * 0.9 },
          spread: 0.3, gravity: -0.04, drag: 0.08, life: [6, 8.5], size: [0.5, 3.8], sprite: ['puff0', 'puff1', 'cloud2'], color: SMOKE_LIT, alpha: 0.32, rot: 6, rotSpeed: 0.3, fadeIn: 0.4,
        });
      // sparks from the stovepipe now and then
      if (!hidden && rnd.chance(0.12))
        ctx.particles.emit({ pos: { x: ch.x, y: ch.y + 0.15, z: ch.z }, count: 2, vel: { x: (wind.x / wl) * 0.8, y: 2.2, z: (wind.z / wl) * 0.8 }, spread: 0.6, gravity: 1.2, drag: 0.4, life: [0.7, 1.3], size: [0.06, 0.02], sprite: 'dot3', color: [0xffc060, 0xff8a30], additive: true, alpha: 0.9 });
    }

    // ---- the lanterns: a warm halo up close, a twinkle you can spot from far away
    this.glowT -= dt;
    if (this.glowT <= 0) {
      this.glowT = 0.09;
      const L = this.src.lanterns(this.lamps);
      const flick = 0.82 + 0.18 * noise.n2(this.t * 5.3, 7.1);
      for (const p of L) {
        if (hidden) break;
        ctx.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: 1, life: [0.16, 0.2], size: [0.95, 0.95], sprite: 'glow8', additive: true, color: 0xffb860, alpha: 0.5 * flick });
        if (d > 32) {
          const far = Math.min(1, (d - 32) / 50);
          ctx.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: 1, life: [0.16, 0.2], size: [0.22, 0.22], screen: true, sprite: 'glow8', additive: true, color: 0xffc470, alpha: 0.75 * far * flick });
        }
      }
    }

    // ---- sound on the wind: the shop's music, the porch chime, the bell during the break
    const toYou = hunter ? Math.max(0, ((hunter.x - root.position.x) * wind.x + (hunter.z - root.position.z) * wind.z) / (wl * Math.max(1, d))) : 0;
    const carry = Math.max(0, 1 - Math.max(0, d - 25) / 230) * (0.6 + 0.4 * toYou) * gust;
    const want = hidden ? 0 : carry * 0.75;
    this.musicVol += (want - this.musicVol) * Math.min(1, dt * 1.5);
    if (!this.music && this.musicVol > 0.02) this.music = ctx.audio.loop('saloon_loop', 0.01, { x: root.position.x, y: root.position.y + 4, z: root.position.z });
    if (this.music) {
      this.music.setPosition({ x: root.position.x, y: root.position.y + 4, z: root.position.z });
      this.music.setVolume(this.musicVol, 0.25);
    }
    this.chimeT -= dt;
    if (this.chimeT <= 0) {
      this.chimeT = 3.5 + rnd.next() * 5 / gust;
      if (!hidden && d < 170) ctx.sfx('divine_chime', { x: root.position.x, y: root.position.y + 4.5, z: root.position.z }, 0.35 + 0.4 * carry, 0.85 + rnd.next() * 0.2);
    }
    if (ctx.run.wave !== this.breakWave) this.breakLeft = 0; // the next wave began (the bell was rung early)
    this.breakLeft = Math.max(0, this.breakLeft - dt);
    this.bellT -= dt;
    if (this.bellT <= 0) {
      this.bellT = 8 + rnd.next() * 3;
      // the shop is open: during the break the porch bell calls you in (three strokes)
      if (this.breakLeft > 2 && !hidden && !I.visited && d > 20 && d < 260)
        for (let i = 0; i < 3; i++) ctx.audio.play('qte_prompt', { pos: { x: root.position.x, y: root.position.y + 4.6, z: root.position.z }, volume: 0.6 + 0.3 * carry, pitch: 0.42 + i * 0.015, delay: i * 0.55, reverb: 0.35 });
    }

    // ---- prints in the sand near the hunter, the "nearby" toast
    if (hunter) this.pressPrints(hunter.x, hunter.z);
    if (d > 140) {
      this.toastArmed = true;
      this.hiddenToast = true;
    }
    if (hunter && d < 75 && this.toastArmed && !I.visited) {
      this.toastArmed = false;
      if (hidden) {
        this.hiddenToast = false;
        ctx.toast('THE WALKING SHOP', '#ffd36b', 'Gobi is dug in. Clear the outlaws and he will surface.');
      } else ctx.toast('THE WALKING SHOP', '#ffd36b', 'Ozymandias trades from Gobi\'s back. Ride up slowly to stop him.');
    } else if (hunter && d < 40 && hidden && this.hiddenToast) {
      this.hiddenToast = false;
      ctx.toast('GOBI IS DUG IN', '#e0b373', 'Clear the outlaws and the shop comes back up.');
    }
  }

  dispose() {
    this.music?.stop(0.4);
    this.music = null;
    for (const u of this.unsub) u();
    this.unsub = [];
  }
}
