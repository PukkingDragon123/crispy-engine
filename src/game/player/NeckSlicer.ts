// THE NECK SLICER: an unlockable board move (not a tarot skill).
// While you charge a jump (hold JUMP on the sand) with an enemy ahead, a ring
// of gold pixel sparks closes on its neck. FIRE as the ring snaps shut and the
// world drops to a crawl: Sundown springs off the dune, turns the board
// edge-first like a blade, shears the head off on a fountain, then backflips
// down onto the board, and lands it clean (it scores as a Backflip).
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import type { Ctx } from '../Ctx';
import type { Player } from './Player';
import type { Enemies, Enemy } from '../enemies/Enemies';
import type { CameraRig, CineShot } from './CameraRig';
import { isUnlocked } from './Techniques';

/** ring closing time and the FIRE window (real seconds since the ring locked on) */
const RING_T = 0.62;
const WIN0 = 0.42;
const WIN1 = 0.76;
/** the move itself (real seconds; the world runs at ~10% meanwhile) */
const MOVE_T = 1.8;
const CUT_K = 0.34;

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export interface NeckSlicerDeps {
  engine: Engine;
  ctx: Ctx;
  player: Player;
  enemies: Enemies;
  cam: CameraRig;
  cutIn: (title: string, color: string) => void;
  onStyle: (score: number) => void;
  /** hide the HUD while the move plays */
  hud: (on: boolean) => void;
}

function ease(k: number) {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}

export class NeckSlicer {
  active = false;
  private target: Enemy | null = null;
  private ringT = 0;
  private spin = 0;
  private cool = 0;
  private winFx = false;
  private told = false;
  // cutscene state
  private t = 0;
  private cut = false;
  private slain = false;
  private victim: Enemy | null = null;
  private start = new THREE.Vector3();
  private end = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private side = new THREE.Vector3();
  private neck = new THREE.Vector3();
  private tgt = new THREE.Vector3();
  private apexH = 2;
  private speed0 = 12;
  private shot: CineShot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 48, roll: 0.05 };

  constructor(private d: NeckSlicerDeps) {}

  /**
   * Before player.update. Watches the charge, draws the closing ring and
   * starts the move. Returns true while the move owns the hunter.
   */
  update(rdt: number): boolean {
    if (this.active) return true;
    this.cool -= rdt;
    const p = this.d.player;
    const b = p.board;
    const charging = p.alive && b.grounded && b.jumpCharge > 0.04 && this.cool <= 0 && isUnlocked('neck_slicer');
    if (!charging) {
      this.target = null;
      this.ringT = 0;
      this.winFx = false;
      return false;
    }
    if (!this.target || !this.valid(this.target)) {
      this.target = this.pick();
      this.ringT = 0;
      this.winFx = false;
      if (this.target && !this.told) {
        this.told = true;
        this.d.ctx.toast('THE NECK SLICER', '#ffd36b', 'FIRE when the gold ring snaps shut');
      }
    }
    const e = this.target;
    if (!e) return false;
    this.ringT += rdt;
    this.spin += rdt * 5;
    this.neckOf(e, this.neck);
    const inWin = this.ringT >= WIN0 && this.ringT <= WIN1;
    this.drawRing(e, inWin);
    if (inWin && !this.winFx) {
      this.winFx = true;
      this.d.ctx.sfx('qte_prompt', null, 0.55, 1.25);
      this.d.ctx.particles.emit({ pos: this.neck, count: 10, spread: 2.2, life: [0.18, 0.32], size: [0.12, 0.04], sprite: ['star4', 'spark'], color: [0xfff3d6, 0xffd36b], additive: true, drag: 3 });
    }
    if (this.ringT > WIN1 + 0.18) {
      // missed it: the ring opens and tries again
      this.ringT = 0;
      this.winFx = false;
    }
    if (inWin && this.d.engine.input.hit('fire')) {
      this.begin(e);
      return true;
    }
    return false;
  }

  private valid(e: Enemy) {
    if (!e.alive || (e as any).isBoss || e.height > 3.4) return false;
    const hi = e.part('head');
    if (hi < 0 || e.hidden[hi]) return false;
    const st = (e as any).state;
    if (st === 'hidden' || st === 'burrow' || st === 'spawn') return false;
    const p = this.d.player.pos;
    const dx = e.pos.x - p.x,
      dz = e.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.2 || d > 16) return false;
    const f = this.d.player.board.forward;
    return (dx * f.x + dz * f.z) / d > 0.62;
  }

  private pick(): Enemy | null {
    let best: Enemy | null = null,
      bd = 1e9;
    const p = this.d.player.pos;
    for (const e of this.d.enemies.list) {
      if (!this.valid(e)) continue;
      const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private neckOf(e: Enemy, out: THREE.Vector3) {
    return out.set(e.pos.x, e.pos.y + e.height * 0.8, e.pos.z);
  }

  /** a reticle of gold pixel sparks around the neck, closing with the charge */
  private drawRing(e: Enemy, inWin: boolean) {
    const ctx = this.d.ctx;
    const k = Math.min(1, this.ringT / RING_T);
    const r = (1.5 - 1.2 * (1 - Math.pow(1 - k, 2))) * Math.max(0.7, e.scale);
    const cam = ctx.camera;
    // ring plane faces the camera
    _a.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _b.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const n = inWin ? 18 : 12;
    for (let i = 0; i < n; i++) {
      const a = this.spin * (i % 2 ? 1 : -0.6) + (i / n) * Math.PI * 2;
      _v.copy(this.neck).addScaledVector(_a, Math.cos(a) * r).addScaledVector(_b, Math.sin(a) * r);
      ctx.particles.emit({ pos: _v, count: 1, life: [0.05, 0.07], size: [inWin ? 0.085 : 0.06, 0.04], sprite: i % 3 ? 'dot3' : 'spark', color: inWin ? 0xfff3d6 : 0xffc04a, additive: true, alpha: inWin ? 1 : 0.7 });
    }
  }

  private begin(e: Enemy) {
    const { engine: eng, ctx, player: p } = this.d;
    const b = p.board;
    this.active = true;
    this.victim = e;
    this.t = 0;
    this.cut = false;
    this.target = null;
    eng.input.enabled = false;
    this.d.hud(false);
    this.slain = false;
    p.invuln = Math.max(p.invuln, 30);
    this.speed0 = Math.max(10, p.speed);
    this.start.copy(b.pos);
    this.neckOf(e, this.neck);
    this.fwd.set(e.pos.x - this.start.x, 0, e.pos.z - this.start.z);
    const dist = this.fwd.length();
    this.fwd.multiplyScalar(1 / Math.max(0.001, dist));
    this.side.set(-this.fwd.z, 0, this.fwd.x);
    // film from whichever side has the clearer line of sight
    if (this.blocked(1) > this.blocked(-1)) this.side.negate();
    this.end.copy(e.pos).addScaledVector(this.fwd, 5);
    this.end.y = ctx.world.groundAt(this.end.x, this.end.z);
    // the board edge passes right through the neck at the cut
    this.tgt.set(this.neck.x, this.neck.y + 0.05, this.neck.z);
    this.apexH = 1.3;
    b.heading = Math.atan2(this.fwd.x, this.fwd.z);
    b.trickYaw = b.trickPitch = 0;
    b.spinYaw = b.spinPitch = 0;
    eng.slowMo(0.1, 40);
    eng.letterbox(true, 0.18);
    ctx.sfx('qte_perfect', null, 0.8);
    ctx.sfx('whoosh_big', p.pos, 0.8, 1.2);
    ctx.fx.sandBurst(p.pos, 1.2);
    this.placeShot(0);
    this.d.cam.setCine(this.shot, false);
  }

  private placeShot(k: number) {
    // a low tracking side shot that drifts along the leap, then rises over the landing
    const s = this.shot;
    const mid = _v.copy(this.start).lerp(this.neck, 0.6);
    s.pos.copy(mid).addScaledVector(this.side, 4.4 - k * 1.0).addScaledVector(this.fwd, -1.2 + k * 4.2);
    s.pos.y = Math.max(mid.y, this.neck.y) + 0.4 + k * 1.6;
    s.look.copy(this.neck).lerp(this.end, Math.max(0, k - 0.45) * 1.2);
    s.look.y = this.neck.y - 0.2 + k * 0.3;
    // punch in on the cut
    const punch = Math.exp(-Math.pow((k - CUT_K) / 0.06, 2));
    s.fov = 46 + k * 10 - punch * 9;
    s.roll = 0.06 - k * 0.1;
  }

  /** how much solid stuff stands between a side camera and the neck */
  private blocked(sign: number) {
    const ctx = this.d.ctx;
    const mid = _a.copy(this.start).lerp(this.neck, 0.6);
    let n = 0;
    for (let i = 0; i <= 4; i++) {
      const f = i / 4;
      const x = mid.x + this.side.x * sign * 4.4 * (1 - f) + (this.neck.x - mid.x) * f;
      const z = mid.z + this.side.z * sign * 4.4 * (1 - f) + (this.neck.z - mid.z) * f;
      ctx.world.colliders.query(x, z, 1.1, () => {
        n++;
      });
    }
    return n;
  }

  /** after player.update: the scripted leap, the cut, the flip */
  post(rdt: number) {
    if (!this.active) return;
    const { engine: eng, ctx, player: p, enemies } = this.d;
    const b = p.board;
    this.t += rdt;
    const k = Math.min(1, this.t / MOVE_T);
    // the arc: spring up onto the neck (accelerating), then a high backflip down to the sand
    if (k <= CUT_K) {
      const s1 = k / CUT_K;
      const h = s1 * s1 * 0.35 + s1 * 0.65;
      b.pos.copy(this.start).lerp(this.tgt, h);
      b.pos.y = this.start.y + (this.tgt.y - this.start.y) * Math.sin(s1 * Math.PI * 0.5);
    } else {
      const s2 = (k - CUT_K) / (1 - CUT_K);
      const h = 1 - (1 - s2) * (1 - s2);
      b.pos.copy(this.tgt).lerp(this.end, h);
      b.pos.y = this.end.y + (this.tgt.y - this.end.y) * (1 - s2 * s2) + this.apexH * Math.sin(Math.PI * s2);
    }
    const g = ctx.world.groundAt(b.pos.x, b.pos.z);
    b.pos.y = Math.max(g + 0.06, b.pos.y);
    // velocity for the animation (world units / game second) and the landing
    b.vel.copy(this.fwd).multiplyScalar(this.speed0);
    b.vel.y = k < 0.5 ? 4 : -6;
    b.heading = Math.atan2(this.fwd.x, this.fwd.z);
    // board turns edge-first into the neck, then a full backflip after the cut
    const pre = Math.min(1, k / CUT_K);
    const post = Math.max(0, Math.min(1, (k - CUT_K) / (0.9 - CUT_K)));
    b.trickYaw = (Math.PI / 2) * Math.sin(pre * Math.PI * 0.5) * (1 - ease(post));
    b.trickPitch = -Math.PI * 2 * ease(post);
    b.spinYaw = b.spinPitch = 0;
    this.placeShot(k);
    // edge trail: a crescent of light along the board's sweep
    if (k > CUT_K - 0.12 && k < CUT_K + 0.1) {
      const a = (k - (CUT_K - 0.12)) / 0.22;
      for (let i = 0; i < 4; i++) {
        const ang = (a + i * 0.02) * Math.PI * 1.2 - 0.6;
        _v.copy(this.neck).addScaledVector(this.side, Math.cos(ang) * 0.75).addScaledVector(this.fwd, Math.sin(ang) * 0.3);
        _v.y += Math.sin(ang) * 0.35;
        ctx.particles.emit({ pos: _v, count: 1, life: [0.25, 0.4], size: [0.16, 0.05], sprite: ['smear0', 'smear1', 'smear2'], animate: true, color: 0xfff6e0, additive: true });
      }
    }
    // THE CUT
    if (!this.cut && k >= CUT_K) {
      this.cut = true;
      const e = this.victim;
      if (e && e.alive) {
        enemies.decapitate(e, this.fwd.x * 0.9 + this.side.x * 0.4, this.fwd.z * 0.9 + this.side.z * 0.4);
        ctx.sfx('limb_off', this.neck, 1, 0.9);
        ctx.sfx('headshot', this.neck, 0.9, 0.8);
        ctx.sfx('melee_whoosh', this.neck, 0.9, 0.7);
        eng.hitStop(0.16, 0.02);
        ctx.shake(0.45);
        ctx.particles.emit({ pos: this.neck, count: 18, spread: 4, life: [0.2, 0.45], size: [0.14, 0.04], sprite: ['star4', 'spark'], color: [0xffffff, 0xfff3d6, 0xffd36b], additive: true, drag: 4 });
        this.slain = true;
        this.d.onStyle(650);
        ctx.events.emit('neckSlicer', e);
      }
    }
    if (k >= 1) this.finish();
  }

  private finish() {
    const { engine: eng, player: p } = this.d;
    const b = p.board;
    this.active = false;
    this.d.hud(true);
    if (this.slain) this.d.cutIn('NECK SLICER', '#ffd36b');
    this.slain = false;
    this.victim = null;
    this.cool = 1.4;
    b.trickYaw = 0;
    b.trickPitch = -Math.PI * 2; // lands as a clean Backflip
    b.vel.copy(this.fwd).multiplyScalar(this.speed0 * 1.05);
    b.vel.y = -3;
    eng.slowMo(1, 9);
    eng.letterbox(false, 0.3);
    eng.input.enabled = true;
    p.invuln = 0.7;
    this.d.cam.setCine(null);
  }

  /** abort cleanly (scene exit, death) */
  cancel() {
    if (!this.active) return;
    this.finish();
  }
}
