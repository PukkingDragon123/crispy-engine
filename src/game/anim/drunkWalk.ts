// Sundown's whiskey swagger: the procedural on-foot walk shared by every place he
// walks (the cold open, the intro, the hideout). Drunk, but readable as swagger.
//
// The centre of mass leads and the feet chase it:
// - his balance point wanders on its own (slow, layered noise: never the same
//   twice) and the body follows it on soft springs, so he sways, overshoots and
//   leans into the drift;
// - every step lands where the body is falling (the capture point: where the
//   centre of mass is plus where it is heading), so the feet go wide, cross over
//   or hurry to catch up; falling forward makes the steps quicker and longer;
// - weight: each landing sinks into the knee, harder on the heavy steps, and the
//   hips hike over the stance leg;
// - a stumble is just a harder shove to that balance point (the toe catches, or
//   he lurches sideways): the body pitches, the catch steps hurry under it, the
//   arms swing out to the side he is falling toward, and the springs pull him
//   back upright with a small overcorrection. No keyframes, so no pops;
// - the arms are pendulums hung from the moving shoulders and the head floats on
//   a loose neck that tries to stay level: both trail the body by a beat.
// One stride = two steps = phase 2π; the left foot lands at π/2, the right at 3π/2.
import type * as THREE from 'three';
import { SpringF } from './spring';
import { clamp01, vnoise } from './math';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

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
  /** 0..1 how far he is pitching forward out of balance */
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
  private tempoBase = 1;
  private stride = [1, 1];
  private strideTarget = [1, 1];
  private place = [0.03, 0.03];
  private placeTarget = [0.03, 0.03];
  private heavy = 1;
  private nextStumble: number;
  private weaveAmp: number;
  private every: [number, number];
  private prevWeave = 0;
  private weaveYaw = 0;
  // the centre of mass (m, rig-local, relative to the line between the feet)
  private comX = new SpringF(0, 1.05, 0.34);
  private comZ = new SpringF(0.02, 1.3, 0.42);
  /** which way the weight is shifting (the stance foot), eased */
  private stance = 0;
  // weight in the knees, upper-body inertia, the loose neck, the pendulum arms
  private sink = new SpringF(0, 2.4, 0.38);
  private chestZ = new SpringF(0, 1.5, 0.4);
  private chestX = new SpringF(0.06, 1.7, 0.45);
  private twist = new SpringF(0, 1.6, 0.5);
  private headZ = new SpringF(0, 1.15, 0.28);
  private headX = new SpringF(0.06, 1.35, 0.3);
  private headY = new SpringF(0, 0.6, 0.55);
  private swingL = new SpringF(0, 1.0, 0.2);
  private swingR = new SpringF(0, 0.9, 0.22);
  private outL = new SpringF(0.12, 1.3, 0.4);
  private outR = new SpringF(-0.11, 1.2, 0.42);
  private foreL = new SpringF(-0.25, 1.6, 0.3);
  private foreR = new SpringF(-0.3, 1.5, 0.32);
  private base = new WeakMap<THREE.Object3D, THREE.Vector3>();

  constructor(private seed = Math.random() * 97, o: DrunkOpts = {}) {
    this.weaveAmp = o.weave ?? 0.17;
    this.every = o.stumbleEvery ?? [3.6, 6.4];
    this.nextStumble = 2.2 + this.rand(0.5) * 1.8;
  }

  private n = 0;
  private rand(k = 0) {
    const s = Math.sin((this.n++ + k * 13.1) * 12.9898 + this.seed * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  /** layered noise in about [-1, 1]: never quite repeats */
  private wander(t: number, f: number, k: number) {
    const sd = this.seed + k * 7.31;
    return vnoise(t * f, sd) * 0.6 + vnoise(t * f * 2.37 + 3.1, sd + 1) * 0.28 + Math.sin(t * f * 0.71 + sd) * 0.12;
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
    const t = this.t;
    const A = amt;
    if (walking && amt > 0.5) this.nextStumble -= dt;
    // ---- the balance point wanders; the body follows it on springs
    const cx = this.comX.x, cz = this.comZ.x;
    const driftX = this.wander(t, 0.42, 1) * 0.07 + this.stance * 0.028;
    const driftZ = 0.022 + this.wander(t, 0.55, 2) * 0.022;
    this.comX.step(driftX * A, dt);
    this.comZ.step(driftZ * A, dt);
    // falling forward hurries the feet; leaning back slows them (the feet chase the body)
    const fall = clamp((cz - 0.02) * 9, -0.25, 0.75);
    const tempo = this.tempoBase * (1 + fall);
    this.tempo += (tempo - this.tempo) * (1 - Math.exp(-dt * 10));
    for (let i = 0; i < 2; i++) {
      this.stride[i] += (this.strideTarget[i] - this.stride[i]) * (1 - Math.exp(-dt * 8));
      this.place[i] += (this.placeTarget[i] - this.place[i]) * (1 - Math.exp(-dt * 7));
    }
    if (extPh === undefined) this.ph += dt * rate * this.tempo * (walking ? 1 : 0);
    else this.ph = extPh;
    // ---- a foot lands
    const idx = Math.floor((this.ph - Math.PI / 2) / Math.PI);
    if (idx !== this.stepIdx) {
      this.stepIdx = idx;
      if (walking) {
        this.stepped = true;
        this.foot = idx % 2 === 0 ? 1 : -1;
        const r = this.rand();
        // uneven steps: heavier and lighter ones, never a clean alternation
        this.heavy = 0.75 + r * 0.6 + (idx % 2 === 0 ? 0.12 : -0.08);
        this.tempoBase = (1.08 - (this.heavy - 1) * 0.35) * (0.94 + this.rand() * 0.12);
        this.sink.kick(-0.28 * this.heavy * A);
        this.headX.kick(0.35 * this.heavy * A);
        this.stance = this.foot;
        // the swinging foot will land where the body is going (capture point), a little wide or crossed
        const leg = this.foot === 1 ? 1 : 0; // the leg that swings next
        const sideOf = leg === 0 ? 1 : -1;
        const capture = (cx + this.comX.v * 0.32) * sideOf;
        this.placeTarget[leg] = clamp(0.03 + capture * 1.6 + (this.rand() - 0.5) * 0.04, -0.09, 0.13);
        this.strideTarget[leg] = clamp((0.92 + this.rand() * 0.18) * (1 + fall * 0.6), 0.75, 1.45);
        // the toe catches, or he lurches off sideways: a shove to the balance point, nothing more
        if (this.nextStumble <= 0) {
          this.nextStumble = this.every[0] + this.rand() * (this.every[1] - this.every[0]);
          if (this.rand() < 0.6) {
            this.comZ.kick(0.6 * A);
            this.comX.kick((this.rand() - 0.5) * 0.25 * A);
          } else this.comX.kick(-this.foot * (0.28 + this.rand() * 0.12) * A);
          this.headX.kick(-0.8 * A);
        }
      }
    }
    const ph = this.ph;
    const s = Math.sin(ph), c = Math.cos(ph);
    this.stance *= Math.exp(-dt * 1.5);
    const comX = this.comX.x, comZ = this.comZ.x;
    this.trip = clamp01((comZ - 0.045) / 0.07);
    this.recover = clamp01((0.0 - comZ) / 0.03);
    // ---- his line weaves; the body turns into the weave
    const weave = this.wander(t, 0.3, 3) * this.weaveAmp;
    const dW = dt > 0 ? (weave - this.prevWeave) / dt : 0;
    this.prevWeave = weave;
    this.weaveYaw += (clamp(dW / 1.25, -0.28, 0.28) - this.weaveYaw) * (1 - Math.exp(-dt * 4));
    // ---- pelvis: carried by the centre of mass, sinking into each landing, hiking over the stance leg
    const sink = this.sink.step(0, dt);
    const hike = -c * 0.07;
    this.pelvisPos.x = (weave + comX * 0.9) * A;
    this.pelvisPos.y = (Math.abs(c) * 0.03 * (0.8 + 0.3 * this.heavy) - 0.012 - this.trip * 0.04) * A + sink * 0.1;
    this.pelvisPos.z = (comZ * 0.6 + 0.012 * Math.cos(2 * ph)) * A;
    this.pelvisRot.x = (comZ * 1.2) * A;
    this.pelvisRot.y = (-s * 0.09 + this.weaveYaw) * A;
    this.pelvisRot.z = (hike - comX * 0.35) * A + sink * 0.05 * this.stance;
    // ---- chest: leans into the fall with a beat of inertia, counter-twists the hips
    const cz2 = this.chestZ.step((-comX * 1.6 - hike * 0.55) * A, dt);
    const cx2 = this.chestX.step((0.06 + comZ * 3.2 + 0.03 * Math.cos(2 * ph - 0.9)) * A, dt);
    const tw = this.twist.step((s * 0.14 + this.wander(t, 0.5, 4) * 0.06 - this.weaveYaw * 0.4) * A, dt);
    this.torsoRot.x = cx2;
    this.torsoRot.y = tw;
    this.torsoRot.z = cz2;
    // ---- the head: a loose neck trying to keep the eyes level, a beat late; lolls when he is not fighting it
    const hz = this.headZ.step((-(cz2 + this.pelvisRot.z) * 0.7 + this.wander(t, 0.4, 5) * 0.1) * A, dt);
    const hx = this.headX.step((0.06 - (cx2 - 0.06) * 0.45 + this.wander(t, 0.33, 6) * 0.05) * A, dt);
    const hy = this.headY.step((this.wander(t, 0.25, 7) * 0.16 - tw * 0.5) * A, dt);
    this.head.x = hx;
    this.head.y = hy;
    this.head.z = hz;
    // ---- arms: pendulums. They swing with the opposite leg (a beat late), fling forward as he
    // pitches over, and the arm on the high side lifts out to balance a sideways fall
    const sl = this.swingL.step((s * 0.34 - comZ * 3.5) * A, dt);
    const sr = this.swingR.step((-s * 0.3 - comZ * 3.2) * A, dt);
    const ol = this.outL.step((0.12 + Math.max(0, -comX) * 4.5 + this.trip * 0.35) * A, dt);
    const or = this.outR.step(-(0.11 + Math.max(0, comX) * 4.5 + this.trip * 0.3) * A, dt);
    this.armL.x = sl;
    this.armL.z = ol;
    this.armL.fore = this.foreL.step(-0.22 - Math.max(0, -sl) * 0.5 - this.trip * 0.3 * A, dt);
    this.armR.x = sr;
    this.armR.z = or;
    this.armR.fore = this.foreR.step(-0.28 - Math.max(0, -sr) * 0.45 - this.trip * 0.25 * A, dt);
    // ---- legs: uneven strides reaching under the falling body, feet landing wide or crossed
    const kL = this.stride[0], kR = this.stride[1];
    const swL = Math.max(0, c), swR = Math.max(0, -c);
    this.thigh.lx = (-s * 0.55 * kL - comZ * 1.3) * A;
    this.thigh.rx = (s * 0.55 * kR - comZ * 1.3) * A;
    this.thigh.lz = (0.035 + this.place[0] * (0.4 + swL)) * A;
    this.thigh.rz = -(0.035 + this.place[1] * (0.4 + swR)) * A;
    // knees: the swing tuck, plus the give of the stance knee as the weight sinks in
    this.shin.l = Math.max(0, Math.sin(ph + 1.4)) * 0.86 * kL * A - sink * 0.6 * swR;
    this.shin.r = Math.max(0, Math.sin(ph + 1.4 + Math.PI)) * 0.86 * kR * A - sink * 0.6 * swL;
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
    n['shin_l']?.rotation.set(Math.max(0, this.shin.l), 0, 0);
    n['shin_r']?.rotation.set(Math.max(0, this.shin.r), 0, 0);
    if (o.armL !== false) {
      n['arm_l']?.rotation.set(this.armL.x, 0, this.armL.z);
      n['fore_l']?.rotation.set(this.armL.fore, 0, 0);
    }
    if (o.armR) {
      n['arm_r']?.rotation.set(this.armR.x, 0, this.armR.z);
      n['fore_r']?.rotation.set(this.armR.fore, 0, 0);
    }
    if (o.head) n['head']?.rotation.set(this.head.x, this.head.y, this.head.z);
    // the duster's skirt trails the stride and flaps as he lurches
    if (n['coat']) n['coat'].rotation.set(-Math.abs(Math.sin(this.ph)) * 0.12 * this.amt - 0.04 - this.trip * 0.1, 0, -this.pelvisRot.z * 0.6);
  }
}
