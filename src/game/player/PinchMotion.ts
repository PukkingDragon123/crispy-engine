// Pinch's procedural body language: a real scorpion's alternating tetrapod gait (L1 R2 L3 R4
// against R1 L2 R3 L4, with a back-to-front metachronal wave), turning on the spot, a tail that
// stays raised and sways with a lag down its five segments, claw twitches and snaps, weight shifts,
// looking around, idle grooming (a chela brought to the chelicerae, the first legs wiping the eyes),
// sting jabs, and the moods of the perch states (cling, peek, hide, sleep) and errands (leap, sting,
// reload). Writes absolute joint rotations every frame; works on any rig with Pinch's part names
// (missing parts are skipped, so the brood rig and older rigs are fine too).
import * as THREE from 'three';
import type { RigInstance } from '../../engine/voxel/Rig';

export type PinchMode = 'idle' | 'cling' | 'peek' | 'hide' | 'sleep' | 'leap' | 'sting' | 'reload';
export interface PinchDrive {
  /** ground speed in body lengths per second: drives the tetrapod gait */
  speed?: number;
  /** yaw rate (rad/s): the legs step on the spot to turn */
  turn?: number;
  mode?: PinchMode;
  /** 0..1: claws up and wide, tail cocked */
  alert?: number;
  /** idle grooming, twitches, looking around (default true) */
  fidget?: boolean;
}

interface Pose {
  crouch: number;
  spread: number;
  clawUp: number;
  clawOut: number;
  fold: number;
  open: number;
  tailRaise: number;
  tailCurl: number;
  tailSide: number;
  pitch: number;
}
const POSES: Record<PinchMode, Pose> = {
  idle: { crouch: 0.1, spread: 0, clawUp: 0.05, clawOut: 0, fold: 0.05, open: 0.06, tailRaise: 0, tailCurl: 0, tailSide: 0, pitch: 0 },
  cling: { crouch: 0.4, spread: 0.6, clawUp: 0, clawOut: 0.1, fold: 0.2, open: 0.04, tailRaise: -0.1, tailCurl: 0.2, tailSide: 0, pitch: 0 },
  peek: { crouch: 0.15, spread: 0.45, clawUp: 0.35, clawOut: 0.18, fold: 0.15, open: 0.18, tailRaise: 0.12, tailCurl: 0.25, tailSide: 0, pitch: -0.12 },
  hide: { crouch: 0.85, spread: 0.2, clawUp: -0.1, clawOut: -0.35, fold: 0.75, open: 0, tailRaise: -0.2, tailCurl: 0.6, tailSide: 0, pitch: 0.05 },
  sleep: { crouch: 0.95, spread: 0.55, clawUp: -0.15, clawOut: -0.25, fold: 0.55, open: 0, tailRaise: -0.4, tailCurl: 0.35, tailSide: 0.5, pitch: 0.04 },
  leap: { crouch: 0, spread: 0.95, clawUp: 0.45, clawOut: 0.6, fold: 0, open: 0.65, tailRaise: 0.25, tailCurl: -0.1, tailSide: 0, pitch: -0.2 },
  sting: { crouch: 0.3, spread: 0.75, clawUp: 0.2, clawOut: 0.4, fold: 0, open: 0.3, tailRaise: 0.2, tailCurl: 0.1, tailSide: 0, pitch: -0.1 },
  reload: { crouch: 0.3, spread: 0.55, clawUp: 0.3, clawOut: -0.08, fold: 0.25, open: 0.25, tailRaise: 0.1, tailCurl: 0.15, tailSide: 0, pitch: -0.05 },
};
const KEYS = Object.keys(POSES.idle) as (keyof Pose)[];
/** the resting tail (rotation.x per joint over the sculpted curl): raised, the sting held over the back */
const TAIL_BASE = [0.04, -0.14, -0.2, -0.2, -0.12];
/** each tail segment's dorsal normal in its joint frame (the sculpted curl: 40, 88, 136, 178, 214 deg from straight back) */
const TAIL_N = [40, 88, 136, 178, 214].map((d) => new THREE.Vector3(0, Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)));
const _X = new THREE.Vector3(1, 0, 0);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const TAU = Math.PI * 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const sm = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class PinchMotion {
  private n: Record<string, THREE.Object3D>;
  private bodyRest: THREE.Vector3;
  private unit: number;
  t = Math.random() * 10;
  private phase = 0;
  private walk = 0;
  private turnS = 0;
  private alertS = 0;
  private p: Pose = { ...POSES.idle };
  private groom = { t: -1, dur: 2.8, side: 1, kind: 0 };
  private groomCd = rnd(3, 7);
  private tw = [0, 0];
  private twCd = rnd(1, 3);
  private tap = { leg: 1, side: 1, t: -1 };
  private tapCd = rnd(2, 5);
  private look = 0;
  private lookTo = 0;
  private lookCd = 1;
  private jab = -1;
  private jabCd = 0;
  private snapT = -1;

  constructor(public rig: RigInstance) {
    this.n = rig.nodes;
    this.bodyRest = (this.n['body']?.position ?? new THREE.Vector3()).clone();
    this.unit = (rig.geo.spec.meta?.unit as number) ?? 0.011;
  }

  /** a single sting strike (the tail whips forward over the head and back) */
  sting() {
    this.jab = 0;
  }
  /** a quick double snap of both claws */
  snap() {
    this.snapT = 0;
  }
  /** start grooming now (if idle enough) */
  groomNow(kind = Math.random() < 0.55 ? 0 : 1) {
    this.groom = { t: 0, dur: kind === 0 ? 2.8 : 2.2, side: Math.random() < 0.5 ? 1 : -1, kind };
  }

  update(dt: number, d: PinchDrive = {}) {
    dt = Math.min(dt, 0.1);
    const n = this.n;
    this.t += dt;
    const t = this.t;
    const mode = d.mode ?? 'idle';
    const ex = this.rig.expression;
    const speed = d.speed ?? 0;
    const turn = d.turn ?? 0;
    const k = 1 - Math.exp(-dt * 7);
    // ---- the mood: a blend toward the mode's pose, nudged by the expression and the alert level
    let alert = d.alert ?? 0;
    if (ex === 'angry' || ex === 'determined') alert += 0.5;
    if (ex === 'surprised') alert += 0.8;
    this.alertS += (Math.min(1, alert) - this.alertS) * k;
    const target = POSES[ex === 'sleepy' && mode === 'idle' ? 'sleep' : mode];
    for (const key of KEYS) this.p[key] += (target[key] - this.p[key]) * k;
    const P = this.p, A = this.alertS;
    // ---- gait
    const wantWalk = Math.min(1, speed * 1.4);
    this.walk += (wantWalk - this.walk) * (1 - Math.exp(-dt * 10));
    this.turnS += (Math.max(-1, Math.min(1, turn * 0.6)) - this.turnS) * (1 - Math.exp(-dt * 10));
    const freq = Math.min(7.5, speed / 0.3 + Math.abs(this.turnS) * 2.2);
    this.phase = (this.phase + dt * freq) % 1;
    const W = this.walk, TU = this.turnS;
    const moving = W + Math.abs(TU) > 0.12;
    const fidget = (d.fidget ?? true) && !moving && (mode === 'idle' || mode === 'cling' || mode === 'peek');
    // ---- idle life: grooming, twitches, weight shifts, looking around
    let gArm = 0, gPat = 0, gHand = 0, gLeg1 = 0, gChew = 0, gSide = 1, gWipe = 0;
    if (this.groom.t >= 0) {
      const g = this.groom;
      g.t += dt;
      const e = sm(g.t / 0.45) * sm((g.dur - g.t) / 0.45);
      gSide = g.side;
      if (g.kind === 0) {
        // a chela comes in to the mouth and the chelicerae work it over; the first leg helps
        gArm = e;
        gPat = e;
        gHand = e * (0.6 + Math.sin(g.t * 9) * 0.25);
        gChew = e;
        gLeg1 = e * (0.5 + Math.sin(g.t * 11) * 0.3);
      } else {
        // both first legs wipe over the eyes, alternating
        gWipe = e;
      }
      if (g.t >= g.dur || !fidget) g.t = -1;
    } else if (fidget) {
      this.groomCd -= dt;
      if (this.groomCd <= 0) {
        this.groomNow();
        this.groomCd = rnd(7, 15);
      }
    }
    this.twCd -= dt;
    if (this.twCd <= 0) {
      const s = Math.random();
      if (s < 0.4) this.tw[0] = 1;
      else if (s < 0.8) this.tw[1] = 1;
      else this.tw[0] = this.tw[1] = 1;
      this.twCd = rnd(1.2, 4) * (ex === 'sleepy' ? 3 : 1);
    }
    this.tw[0] = Math.max(0, this.tw[0] - dt * 5);
    this.tw[1] = Math.max(0, this.tw[1] - dt * 5);
    let snap = 0;
    if (this.snapT >= 0) {
      this.snapT += dt;
      snap = Math.max(0, Math.sin(this.snapT * 26)) * (1 - this.snapT / 0.5);
      if (this.snapT > 0.5) this.snapT = -1;
    }
    if (mode === 'sting') {
      this.jabCd -= dt;
      if (this.jabCd <= 0) {
        this.jab = 0;
        this.jabCd = 0.5;
      }
    }
    if (fidget) {
      this.tapCd -= dt;
      if (this.tapCd <= 0) {
        this.tap = { leg: 1 + Math.floor(Math.random() * 4), side: Math.random() < 0.5 ? 1 : -1, t: 0 };
        this.tapCd = rnd(2, 6);
      }
    }
    let tapLift = 0;
    if (this.tap.t >= 0) {
      this.tap.t += dt;
      tapLift = Math.sin(Math.min(1, this.tap.t / 0.35) * Math.PI) * 0.3;
      if (this.tap.t > 0.35) this.tap.t = -1;
    }
    this.lookCd -= dt;
    if (this.lookCd <= 0) {
      const wide = mode === 'peek' ? 0.6 : 0.3;
      this.lookTo = moving ? 0 : rnd(-wide, wide);
      this.lookCd = mode === 'peek' ? rnd(0.6, 1.8) : rnd(1.5, 4);
    }
    this.look += (this.lookTo - this.look) * (1 - Math.exp(-dt * (mode === 'peek' ? 9 : 4)));
    // ---- body: crouch, gait bob and roll, breathing, look
    const u = this.unit;
    const bob = W * (0.5 - 0.5 * Math.cos(this.phase * TAU * 2)) * 0.22 * u;
    const breathe = Math.sin(t * 1.7) * 0.05 * u;
    if (n['body']) {
      n['body'].position.set(this.bodyRest.x, this.bodyRest.y - P.crouch * 1.05 * u + bob + breathe, this.bodyRest.z);
      n['body'].rotation.set(P.pitch - A * 0.1 + Math.sin(t * 0.9) * 0.012 - gWipe * 0.06, this.look, Math.sin(this.phase * TAU) * 0.035 * W);
    }
    n['meso']?.rotation.set(Math.sin(t * 1.7 + 0.6) * 0.018 + Math.sin(this.phase * TAU * 2) * 0.02 * W, Math.sin(this.phase * TAU) * 0.03 * W, 0);
    // ---- legs: alternating tetrapods
    for (let i = 1; i <= 4; i++)
      for (const s of [1, -1]) {
        const tag = s > 0 ? 'l' : 'r';
        const up = n[`leg_${tag}${i}`], lo = n[`leg_${tag}${i}b`];
        if (!up) continue;
        const groupB = (i + (s > 0 ? 0 : 1)) % 2 === 0;
        const ph = this.phase * TAU + (groupB ? Math.PI : 0) + i * 0.3;
        const swing = Math.max(0, Math.sin(ph));
        const fwd = -Math.cos(ph);
        const lift = swing * (0.34 * W + 0.26 * Math.abs(TU));
        const stride = fwd * (0.26 * W - s * 0.22 * TU);
        let gl = 0, gs = 0;
        if (i === 1 && s === gSide) gl += gLeg1 * 0.55;
        if (i === 1 && gWipe > 0) {
          gl += gWipe * (0.75 + Math.sin(this.groom.t * 10 + (s > 0 ? 0 : Math.PI)) * 0.2);
          gs += gWipe * (0.55 + Math.sin(this.groom.t * 10 + (s > 0 ? 0 : Math.PI)) * 0.3);
        }
        const tl = this.tap.t >= 0 && this.tap.leg === i && this.tap.side === s ? tapLift : 0;
        const settle = Math.sin(t * 0.7 + i * 1.7 + (s > 0 ? 0 : 2)) * 0.025 * (1 - W);
        up.rotation.set(0, -s * (stride + gs) + (i <= 2 ? -s * P.spread * 0.12 : s * P.spread * 0.12), s * (lift + tl + gl + P.crouch * 0.17 + P.spread * 0.16 + settle + A * 0.05));
        lo?.rotation.set(0, 0, s * (-lift * 0.9 - tl * 0.6 - gl * 0.5 + P.spread * 0.32 - P.crouch * 0.12));
      }
    // ---- pedipalps: carriage, grooming, twitches, snaps, the open/close of the mood
    for (const s of [1, -1]) {
      const tag = s > 0 ? 'l' : 'r';
      const gm = s === gSide ? 1 : 0;
      const twitch = this.tw[s > 0 ? 0 : 1];
      const clap = ex === 'happy' ? Math.max(0, Math.sin(t * 5 + (s > 0 ? 0 : 1.3))) * 0.25 : 0;
      const work = mode === 'reload' ? Math.max(0, Math.sin(t * 16 + (s > 0 ? 0 : 1.6))) * 0.45 : 0;
      const sway = Math.sin(t * 1.3 + (s > 0 ? 0 : 1.1)) * 0.04;
      n['arm_' + tag]?.rotation.set(-(P.clawUp + A * 0.3) * 0.6 - gArm * gm * 0.35 + sway * 0.5, s * ((P.clawOut + A * 0.3) * 0.5 - gArm * gm * 0.55 + sway), 0);
      n['patella_' + tag]?.rotation.set(0, -s * (P.fold * 0.85 + gPat * gm * 0.75 + A * 0.05), 0);
      n['hand_' + tag]?.rotation.set(-(P.clawUp + A * 0.2) * 0.2 - gHand * gm * 0.4, -s * (P.fold * 0.35 + gHand * gm * 0.6), gHand * gm * s * 0.3);
      const open = P.open + A * 0.3 + twitch * 0.7 + snap * 0.8 + clap + work + (mode === 'sting' ? Math.max(0, Math.sin(t * 13 + (s > 0 ? 0 : 1))) * 0.5 : 0);
      n['pincer_' + tag]?.rotation.set(0, -s * Math.min(0.85, open) * 0.6, 0);
      n['chelicera_' + tag]?.rotation.set(gChew * Math.sin(t * 14 + (s > 0 ? 0 : Math.PI)) * 0.35, s * gChew * Math.sin(t * 9) * 0.15, 0);
    }
    // ---- tail: raised, swaying with a lag down the chain; strikes when stinging
    let j = 0;
    if (this.jab >= 0) {
      this.jab += dt;
      const x = this.jab;
      j = x < 0.07 ? sm(x / 0.07) : Math.max(0, 1 - (x - 0.07) / 0.25);
      if (x > 0.32) this.jab = -1;
    }
    const wag = ex === 'happy' ? Math.sin(t * 6) * 0.08 : 0;
    for (let i = 1; i <= 5; i++) {
      const node = n['tail' + i];
      if (!node) continue;
      const lag = i * 0.45;
      const raise = i === 1 ? (P.tailRaise + A * 0.2) * 0.6 : i === 2 ? -(P.tailRaise + A * 0.2) * 0.2 : 0;
      const curl = i >= 3 ? (P.tailCurl - A * 0.08) * 0.32 : P.tailCurl * 0.08;
      const strike = j * [0.22, -0.2, -0.32, -0.34, -0.22][i - 1];
      const sway = Math.sin(t * 1.25 - lag) * 0.045 * (1 + W) + Math.sin(this.phase * TAU - lag) * 0.05 * W;
      // the curl about X, the sideways bend about the segment's own dorsal normal (a true lateral flex)
      _qa.setFromAxisAngle(_X, TAIL_BASE[i - 1] + raise + curl + strike + Math.sin(t * 1.05 - lag) * 0.022);
      node.quaternion.copy(_qa).multiply(_qb.setFromAxisAngle(TAIL_N[i - 1], sway * (i === 1 ? 0.6 : 1) + wag + (i === 1 ? P.tailSide * 0.5 : P.tailSide * 0.12)));
    }
    n['stinger']?.rotation.set(-j * 0.55 + Math.sin(t * 1.6) * 0.04 + A * 0.12, 0, 0);
  }
}
