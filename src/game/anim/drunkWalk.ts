// Sundown's whiskey swagger: the procedural on-foot walk shared by every place he
// walks (the cold open, the intro, the hideout). Drunk, but readable as swagger:
// - uneven steps: a heavy long step, then a quick short one, each a little random;
// - now and then the toe catches: he pitches forward, arms fly out, a quick catch
//   step, then he rights himself with a small lean back;
// - hips roll and shift onto each landing foot, the shoulders sway the other way
//   on a slower, lagging rhythm;
// - the head is on loose springs: it lolls and bobs late;
// - the arms hang like pendulums from swaying shoulders, out of step with the legs;
// - his line weaves gently from side to side, the body turning into the weave.
// One stride = two steps = phase 2π; the left foot lands at π/2, the right at 3π/2.
import type * as THREE from 'three';
import { SpringF } from './spring';
import { clamp01, vnoise } from './math';

const smooth = (k: number) => {
  k = clamp01(k);
  return k * k * (3 - 2 * k);
};

export interface DrunkOpts {
  /** metres either side of the walking line (0.17 open desert, less indoors) */
  weave?: number;
  /** seconds between stumbles (min, max) */
  stumbleEvery?: [number, number];
}

export class DrunkGait {
  /** stride phase (radians) */
  ph = 0;
  /** walking time (s) */
  t = 0;
  /** true on the frame a foot lands */
  stepped = false;
  /** the foot that just landed: 1 left, -1 right */
  foot: 1 | -1 = 1;
  /** phase-rate multiplier of the current step (callers that drive their own phase use it) */
  tempo = 1;
  /** 0..1 the stumble's forward pitch */
  trip = 0;
  /** 0..1 the lean back as he rights himself */
  recover = 0;
  /** walk amount the layer was last evaluated with */
  amt = 0;

  // ---- the layer, already scaled by amt (radians / metres, rig-local)
  pelvisPos = { x: 0, y: 0, z: 0 };
  pelvisRot = { x: 0, y: 0, z: 0 };
  torsoRot = { x: 0, y: 0, z: 0 };
  head = { x: 0, y: 0, z: 0 };
  armL = { x: 0, z: 0, fore: 0 };
  armR = { x: 0, z: 0, fore: 0 };
  thigh = { lx: 0, lz: 0, rx: 0, rz: 0 };
  shin = { l: 0, r: 0 };

  private stepIdx = 0;
  private tempoTarget = 1;
  private stride = [1, 1];
  private strideTarget = [1, 1];
  private place = [0, 0];
  private placeTarget = [0.03, 0.03];
  private st = -1;
  private nextStumble: number;
  private rush = 0;
  private weaveAmp: number;
  private every: [number, number];
  private prevWeave = 0;
  private weaveYaw = 0;
  private lurch = new SpringF(0, 1.5, 0.32);
  private headZ = new SpringF(0, 1.25, 0.24);
  private headX = new SpringF(0, 1.55, 0.3);
  private headY = new SpringF(0, 0.7, 0.55);
  private swingL = new SpringF(0, 1.05, 0.16);
  private swingR = new SpringF(0, 0.92, 0.18);
  private foreL = new SpringF(-0.25, 1.9, 0.2);
  private foreR = new SpringF(-0.3, 1.7, 0.22);
  private base = new WeakMap<THREE.Object3D, THREE.Vector3>();

  constructor(private seed = Math.random() * 97, o: DrunkOpts = {}) {
    this.weaveAmp = o.weave ?? 0.17;
    this.every = o.stumbleEvery ?? [3.4, 6.2];
    this.nextStumble = 1.6 + this.rand(0.5) * 1.6;
  }

  private n = 0;
  private rand(k = 0) {
    const s = Math.sin((this.n++ + k * 13.1) * 12.9898 + this.seed * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  /**
   * Advance the gait. `rate` is the stride phase speed (rad/s) at a steady walk,
   * `amt` 0..1 how much he is walking. Pass `extPh` when the caller owns the phase
   * (it should then multiply its own phase rate by `tempo`).
   */
  update(dt: number, rate: number, amt: number, extPh?: number) {
    dt = Math.min(dt, 0.1);
    this.amt = amt;
    this.stepped = false;
    const walking = amt > 0.05;
    if (walking) this.t += dt;
    const t = this.t, sd = this.seed;
    // ---- the stumble clock
    if (this.st >= 0) {
      this.st += dt;
      if (this.st > 1.0) this.st = -1;
    } else if (walking && amt > 0.5) this.nextStumble -= dt;
    const a = this.st >= 0 ? this.st / 1.0 : -1;
    this.trip = a < 0 ? 0 : a < 0.2 ? smooth(a / 0.2) : 1 - smooth((a - 0.2) / 0.45);
    this.rush = a < 0 ? 0 : Math.sin(clamp01((a - 0.06) / 0.42) * Math.PI);
    this.recover = a < 0 ? 0 : Math.sin(clamp01((a - 0.42) / 0.58) * Math.PI);
    // ---- uneven tempo: heavy long steps and quick short ones
    this.tempo += (this.tempoTarget - this.tempo) * (1 - Math.exp(-dt * 9));
    for (let i = 0; i < 2; i++) {
      this.stride[i] += (this.strideTarget[i] - this.stride[i]) * (1 - Math.exp(-dt * 7));
      this.place[i] += (this.placeTarget[i] - this.place[i]) * (1 - Math.exp(-dt * 6));
    }
    if (extPh === undefined) this.ph += dt * rate * this.tempo * (1 + 0.85 * this.rush) * (walking ? 1 : 0);
    else this.ph = extPh;
    const idx = Math.floor((this.ph - Math.PI / 2) / Math.PI);
    if (idx !== this.stepIdx) {
      this.stepIdx = idx;
      if (walking) {
        this.stepped = true;
        this.foot = idx % 2 === 0 ? 1 : -1;
        const heavy = idx % 2 === 0;
        this.tempoTarget = (heavy ? 0.84 : 1.2) * (0.9 + this.rand() * 0.22);
        const leg = this.foot === 1 ? 1 : 0; // the leg that swings next
        this.strideTarget[leg] = (heavy ? 0.86 : 1.16) * (0.88 + this.rand() * 0.26);
        // where the swinging foot lands: wide for balance, or crossing over the line
        this.placeTarget[leg] = this.rand() < 0.3 ? -0.05 - this.rand() * 0.04 : 0.02 + this.rand() * 0.07;
        // the weight drops onto the landing foot (harder some steps than others)
        this.lurch.kick(this.foot * (0.9 + this.rand() * 1.4));
        if (this.nextStumble <= 0 && this.st < 0) {
          this.st = 0;
          this.nextStumble = this.every[0] + this.rand() * (this.every[1] - this.every[0]);
          this.lurch.kick(-this.foot * 2.4);
          this.headX.kick(-1.6);
          this.headZ.kick(this.foot * 1.2);
        }
      }
    }
    const ph = this.ph;
    const s = Math.sin(ph), c = Math.cos(ph);
    const lurch = this.lurch.step(0, dt);
    // ---- the slow sway of a man three whiskeys in, and the weave of his line
    const sway = Math.sin(t * 1.21 + sd) * 0.62 + vnoise(t * 0.55, sd + 1) * 0.38;
    const swayLag = Math.sin((t - 0.45) * 1.21 + sd) * 0.62 + vnoise((t - 0.45) * 0.55, sd + 1) * 0.38;
    const weave = (vnoise(t * 0.32, sd + 2) * 0.72 + Math.sin(t * 0.83 + sd * 3) * 0.28) * this.weaveAmp;
    const dW = dt > 0 ? (weave - this.prevWeave) / dt : 0;
    this.prevWeave = weave;
    this.weaveYaw += (Math.max(-0.28, Math.min(0.28, dW / 1.25)) - this.weaveYaw) * (1 - Math.exp(-dt * 4));
    const A = amt;
    const tr = this.trip, rc = this.recover;
    // ---- pelvis: onto the stance foot, rolling (swagger), bobbing, surging on the lurch
    const roll = -c * 0.075 + sway * 0.04 - lurch * 0.035;
    this.pelvisPos.x = (weave + sway * 0.03 + lurch * 0.032) * A;
    this.pelvisPos.y = (Math.abs(c) * 0.034 * (0.75 + 0.35 * this.stride[c < 0 ? 1 : 0]) - 0.012 - tr * 0.05) * A;
    this.pelvisPos.z = (0.035 * Math.cos(2 * ph) * (this.tempo - 0.85) + tr * 0.07) * A;
    this.pelvisRot.x = (tr * 0.12 - rc * 0.03) * A;
    this.pelvisRot.y = (-s * 0.1 + this.weaveYaw) * A;
    this.pelvisRot.z = roll * A;
    // ---- shoulders: counter-twist, a lagging sway the other way, a slouch; the stumble pitches him over
    this.torsoRot.x = (0.06 + 0.035 * Math.cos(2 * ph - 0.9) + tr * 0.4 - rc * 0.13) * A;
    this.torsoRot.y = (s * 0.15 + vnoise(t * 0.5, sd + 4) * 0.07 - this.weaveYaw * 0.4) * A;
    this.torsoRot.z = (-roll * 0.65 + swayLag * 0.075) * A;
    // ---- the head: loose, late, lolling
    const hz = this.headZ.step((-(this.torsoRot.z + this.pelvisRot.z) * 0.75 + lurch * 0.1 + vnoise(t * 0.42, sd + 5) * 0.13) * A, dt);
    const hx = this.headX.step((0.07 + 0.055 * Math.cos(2 * ph) - tr * 0.22 + rc * 0.1) * A, dt);
    const hy = this.headY.step((vnoise(t * 0.27, sd + 6) * 0.16 - this.torsoRot.y * 0.5) * A, dt);
    this.head.x = hx;
    this.head.y = hy;
    this.head.z = hz;
    // ---- arms: pendulums hung from the swaying shoulders, out of step with the legs, flung out on a stumble
    const dl = 0.55 * Math.sin(t * 0.37 + sd), dr = 0.6 * Math.sin(t * 0.29 + sd * 2);
    const sl = this.swingL.step((Math.sin(ph + 0.45 + dl) * 0.36 - lurch * 0.06) * A, dt);
    const sr = this.swingR.step((-Math.sin(ph + 0.8 + dr) * 0.3 + lurch * 0.06) * A, dt);
    this.armL.x = sl - tr * 0.55 * A;
    this.armL.z = (0.13 + Math.abs(sway) * 0.05 + Math.max(0, lurch) * 0.05 + tr * 0.85) * A;
    this.armL.fore = this.foreL.step(-0.22 - Math.max(0, -sl) * 0.55 - tr * 0.4 * A, dt);
    this.armR.x = sr - tr * 0.45 * A;
    this.armR.z = -(0.11 + Math.abs(sway) * 0.05 + Math.max(0, -lurch) * 0.05 + tr * 0.75) * A;
    this.armR.fore = this.foreR.step(-0.28 - Math.max(0, -sr) * 0.5 - tr * 0.35 * A, dt);
    // ---- legs: uneven strides, feet landing wide or crossing over; the toe catches on a stumble
    const kL = this.stride[0], kR = this.stride[1];
    const drag = 1 - tr * 0.6;
    this.thigh.lx = -s * 0.56 * kL * A - tr * 0.18 * A;
    this.thigh.rx = s * 0.56 * kR * A - tr * 0.18 * A;
    const swL = Math.max(0, c), swR = Math.max(0, -c);
    this.thigh.lz = (0.035 + this.place[0] * (0.4 + swL)) * A;
    this.thigh.rz = -(0.035 + this.place[1] * (0.4 + swR)) * A;
    this.shin.l = Math.max(0, Math.sin(ph + 1.4)) * 0.88 * kL * drag * A + tr * 0.25 * A;
    this.shin.r = Math.max(0, Math.sin(ph + 1.4 + Math.PI)) * 0.88 * kR * drag * A + tr * 0.25 * A;
  }

  /**
   * Pose a standard humanoid rig (FK) with the walk. Arms/head can be left to the
   * caller (they can still add `armR` / `head` on top of their own pose).
   */
  pose(n: Record<string, THREE.Object3D | undefined>, o: { armL?: boolean; armR?: boolean; head?: boolean } = {}) {
    const p = n['pelvis'];
    if (p) {
      let b = this.base.get(p);
      if (!b) this.base.set(p, (b = p.position.clone()));
      p.position.set(b.x + this.pelvisPos.x, b.y + this.pelvisPos.y, b.z + this.pelvisPos.z);
      p.rotation.set(this.pelvisRot.x, this.pelvisRot.y, this.pelvisRot.z);
    }
    n['torso']?.rotation.set(this.torsoRot.x, this.torsoRot.y, this.torsoRot.z);
    n['thigh_l']?.rotation.set(this.thigh.lx, 0, this.thigh.lz);
    n['thigh_r']?.rotation.set(this.thigh.rx, 0, this.thigh.rz);
    n['shin_l']?.rotation.set(this.shin.l, 0, 0);
    n['shin_r']?.rotation.set(this.shin.r, 0, 0);
    if (o.armL !== false) {
      n['arm_l']?.rotation.set(this.armL.x, 0, this.armL.z);
      n['fore_l']?.rotation.set(this.armL.fore, 0, 0);
    }
    if (o.armR) {
      n['arm_r']?.rotation.set(this.armR.x, 0, this.armR.z);
      n['fore_r']?.rotation.set(this.armR.fore, 0, 0);
    }
    if (o.head) n['head']?.rotation.set(this.head.x, this.head.y, this.head.z);
    // the duster's skirt trails the stride and flaps on the lurch
    if (n['coat']) n['coat'].rotation.set(-Math.abs(Math.sin(this.ph)) * 0.12 * this.amt - 0.04 - this.trip * 0.1, 0, -this.pelvisRot.z * 0.6);
  }
}
