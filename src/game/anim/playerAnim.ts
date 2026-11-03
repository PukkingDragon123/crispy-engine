// Sundown's procedural sandboard animation.
//
// Rig frame: Sundown faces +Z, his LEFT (+X) points at the board's nose, the
// soles sit on the deck at y = 0. Everything here is allocation-free.
//
//  - legs: exact two-bone IK with hip splay, feet planted on the deck; the
//    kick-push stroke follows the board's push clock (foot off, plant by the
//    toe edge, kick back along the sand, step back on), weight over the front knee
//  - drift: counter-steered shoulders, the free hand trailing to the sand, the
//    edge dug in; board-slash tail whip; sand-kick stamp; nose-manual rock with a
//    balancing arm; wall-ride crouch
//  - hips & spine: carve lean (toe side drives the knees, heel side sits back
//    with the chest over the knees), a spine that lags the hips, inertial sway
//    from the board's acceleration, ollie pop + counter-rotation
//  - knee compression: landing spring, terrain absorb, jump-charge crouch
//  - arms: 3D two-bone IK with pole vectors; the gun arm blends carry → aim
//    with the wrist correcting the barrel onto the aim line, and a cascading
//    wrist → forearm → shoulder recoil spring chain for the follow-through
//  - reload hand choreography (open, eject flick, belt → cylinder, close snap,
//    jam slaps), fanning palm, board grabs, rope grab, hat hold at speed
//  - head look-at (travel, aim, threats, the gun while reloading, landing
//    spot) with world-up stabilisation
//  - trick anticipation (spin wind-up while charging), shoulders leading the
//    spin, tuck, pre-landing reach, and a spring settle that absorbs the
//    snap when a spin/flip lands slightly off
//  - action layer (throw, summon, lob, kick, twirl, grapple, drink, wrap, ult)
//    with anticipation → action → follow-through envelopes
import * as THREE from 'three';
import type { RigInstance } from '../../engine/voxel/Rig';
import type { Board } from '../player/Board';
import { SpringF, Spring3 } from './spring';
import { PUSH } from '../player/Board';
import { clamp, clamp01, lerp, smooth, damp, easeOutCubic, easeInCubic, easeInOutSine, easeOutBack, wobble, fbm, wrapAngle, TAU, PI } from './math';

const UP = new THREE.Vector3(0, 1, 0);

// ----------------------------------------------------------------- solvers
const _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _lz = new THREE.Vector3();
const _lm = new THREE.Matrix4();

/** rotation whose local -Y points along dir and whose local +Z leans toward hint (both in the parent frame) */
export function limbQuat(dir: THREE.Vector3, hint: THREE.Vector3, out: THREE.Quaternion) {
  _ly.copy(dir).normalize().negate();
  _lz.copy(hint).addScaledVector(_ly, -hint.dot(_ly));
  if (_lz.lengthSq() < 1e-8) {
    _lz.set(0, 0, 1).addScaledVector(_ly, -_ly.z);
    if (_lz.lengthSq() < 1e-8) _lz.set(1, 0, 0).addScaledVector(_ly, -_ly.x);
  }
  _lz.normalize();
  _lx.crossVectors(_ly, _lz);
  _lm.makeBasis(_lx, _ly, _lz);
  return out.setFromRotationMatrix(_lm);
}

/** rotation whose local +Z looks along fwd with local +Y toward up */
export function lookQuat(fwd: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion) {
  _lz.copy(fwd).normalize();
  _lx.crossVectors(up, _lz);
  if (_lx.lengthSq() < 1e-8) _lx.set(1, 0, 0);
  _lx.normalize();
  _ly.crossVectors(_lz, _lx);
  _lm.makeBasis(_lx, _ly, _lz);
  return out.setFromRotationMatrix(_lm);
}

const _ia = new THREE.Vector3(), _ib = new THREE.Vector3(), _ic = new THREE.Vector3(), _id = new THREE.Vector3();
const _iq = new THREE.Quaternion();

/**
 * 3D two-bone IK in the shoulder's parent frame. The upper bone's -Y points
 * from S to the elbow, the lower bone's -Y from the elbow to the hand; the
 * elbow bulges toward pole. lowerHint orients the lower bone's +Z (e.g. the gun
 * top). lowerOut is local to the upper bone.
 */
export function armIK(S: THREE.Vector3, T: THREE.Vector3, pole: THREE.Vector3, l1: number, l2: number, lowerHint: THREE.Vector3, upperOut: THREE.Quaternion, lowerOut: THREE.Quaternion, elbowOut?: THREE.Vector3) {
  const minD = Math.abs(l1 - l2) + 0.005, maxD = (l1 + l2) * 0.999;
  const u = _ia.subVectors(T, S);
  let D = u.length();
  if (D < 1e-5) {
    u.set(0, -1, 0);
    D = minD;
  } else u.divideScalar(D);
  D = clamp(D, minD, maxD);
  const ca = clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1);
  const sa = Math.sqrt(1 - ca * ca);
  const w = _ib.copy(pole).addScaledVector(u, -pole.dot(u));
  if (w.lengthSq() < 1e-8) w.set(0, 0, -1).addScaledVector(u, u.z);
  w.normalize();
  const E = _ic.copy(S).addScaledVector(u, l1 * ca).addScaledVector(w, l1 * sa);
  if (elbowOut) elbowOut.copy(E);
  // upper twist: the inside of the elbow faces away from the pole
  limbQuat(_id.subVectors(E, S), w.negate(), upperOut);
  limbQuat(_id.copy(S).addScaledVector(u, D).sub(E), lowerHint, _iq);
  lowerOut.copy(upperOut).invert().multiply(_iq);
}

export interface LegPose {
  /** thigh pitch (Euler X) */
  x: number;
  /** thigh splay (Euler Z, inner) */
  z: number;
  /** knee (shin Euler X) */
  knee: number;
  /** shin counter-roll (shin Euler Z) that keeps the sole flatter */
  roll: number;
}

/**
 * Exact two-bone leg IK. (dx,dy,dz): sole target relative to the hip, in the
 * hip's parent frame. Thigh = Rx(x)·Rz(z), shin = Rx(knee)·Rz(roll); the knee
 * bends forward (+Z). flat (0..1) counter-rolls the shin against the splay.
 */
export function legIK(dx: number, dy: number, dz: number, l1: number, l2: number, flat: number, out: LegPose) {
  let D = Math.hypot(dx, dy, dz);
  const maxD = (l1 + l2) * 0.9995, minD = Math.abs(l1 - l2) + 0.02;
  if (D > maxD || D < minD) {
    const s = (D > maxD ? maxD : minD) / Math.max(D, 1e-5);
    dx *= s;
    dy *= s;
    dz *= s;
    D = D > maxD ? maxD : minD;
  }
  let roll = 0, z = 0, knee = 0, px = 0, py = -l1 - l2, pz = 0;
  for (let it = 0; it < 3; it++) {
    const cr = Math.cos(roll);
    const ck = clamp((D * D - l1 * l1 - l2 * l2) / (2 * l1 * l2 * cr), -1, 1);
    knee = Math.acos(ck);
    px = l2 * Math.sin(roll);
    py = -l1 - l2 * cr * ck;
    pz = -l2 * cr * Math.sin(knee);
    // lateral: px·cos z − py·sin z = dx  →  R·cos(z + δ) = dx
    const R = Math.hypot(px, py);
    const dl = Math.atan2(py, px);
    z = -Math.acos(clamp(dx / R, -1, 1)) - dl;
    z = wrapAngle(z);
    if (it < 2) roll = -flat * z;
  }
  const yp = px * Math.sin(z) + py * Math.cos(z);
  out.x = wrapAngle(Math.atan2(dz, dy) - Math.atan2(pz, yp));
  out.z = z;
  out.knee = knee;
  out.roll = roll;
  return out;
}

// ----------------------------------------------------------------- actions
const ENV: Record<string, [number, number]> = {
  throw: [0.12, 0.74],
  summon: [0.14, 0.84],
  lob: [0.12, 0.72],
  kick: [0.1, 0.74],
  twirl: [0.12, 0.86],
  grapple: [0.1, 0.62],
  drink: [0.16, 0.84],
  wrap: [0.14, 0.86],
  ult: [0.1, 0.88],
};
/** blend weight of an action layer at progress k (smooth in, hold, smooth out) */
export function actionWeight(name: string, k: number) {
  const e = ENV[name] ?? [0.15, 0.8];
  return smooth(k / e[0]) * smooth((1 - k) / (1 - e[1]));
}

/** action contributions to the body (applied before the leg IK so the feet stay planted) */
export interface ActionBody {
  crouch: number;
  hipX: number;
  hipZ: number;
  px: number;
  tx: number;
  ty: number;
  tz: number;
  jaw: number;
}

// ----------------------------------------------------------------- inputs
export interface PlayerAnimIn {
  dt: number;
  time: number;
  rig: RigInstance;
  gun: RigInstance;
  root: THREE.Object3D;
  tilt: THREE.Object3D;
  board: Board;
  alive: boolean;
  aiming: boolean;
  firing: boolean;
  fanning: boolean;
  aimPoint: THREE.Vector3;
  reload: { active: boolean; t: number; phase: string; inserted: number; jam: number };
  hp01: number;
  stunned: boolean;
  wrapped: boolean;
  hurtFlash: number;
  /** the gun's kick spring (velocity impulses mark shots) */
  gunKick: { x: number; v: number; update(target: number, dt: number): number };
  /** landing spring value (negative = compressed) */
  landX: number;
  forwardHeld: boolean;
  /** lateral stick (-1..1): spin direction while charging a jump */
  spinInput: number;
  action: { name: string; t: number; dur: number } | null;
  expression: string;
  exprJaw: number;
  exprBrow: [number, number];
  /** height of the board above the terrain (air only) */
  heightAboveGround: number;
  camForward: THREE.Vector3;
}

/** something the head can glance at */
export interface GlanceTarget {
  pos: THREE.Vector3;
  height: number;
  alive: boolean;
}

// ----------------------------------------------------------------- state
export class PlayerAnim {
  ready = false;
  /** reused input struct (filled by the player every frame) */
  in = {} as PlayerAnimIn;
  // rig metrics (meters, from the part offsets)
  l1Leg = 0.236;
  l2Leg = 0.431;
  l1Arm = 0.264;
  l2Arm = 0.321;
  scale = 1;
  stanceHalf = 0.24;
  footZ = -0.01;
  shoulderH = 1.18;
  pelvisRest = new THREE.Vector3(0, 0.736, -0.042);
  hipL = new THREE.Vector3(0.111, -0.069, 0.042);
  hipR = new THREE.Vector3(-0.111, -0.069, 0.042);
  shL = new THREE.Vector3(0.222, 0.361, 0.125);
  shR = new THREE.Vector3(-0.222, 0.361, 0.125);
  neck = new THREE.Vector3(0, 0.458, 0.083);

  // body springs
  crouch = new SpringF(0.12, 3.2, 0.7);
  lean = new SpringF(0, 2.6, 0.55);
  lag = new SpringF(0, 1.5, 0.5);
  accX = new SpringF(0, 2.2, 0.45);
  accZ = new SpringF(0, 2.2, 0.45);
  absorb = new SpringF(0, 3.5, 0.6);
  yaw = new SpringF(0.38, 5, 0.85);
  spinLead = new SpringF(0, 3, 0.6);
  ollie = new SpringF(0, 4.2, 0.42);
  yawOff = new SpringF(0, 5.5, 1);
  pitchOff = new SpringF(0, 5.5, 1);
  flinch = new SpringF(0, 5.5, 0.4);
  // head
  headYaw = new SpringF(0.9, 4.2, 0.85);
  headPitch = new SpringF(0, 4.2, 0.85);
  nod = new SpringF(0, 5, 0.35);
  // gun arm: cascading recoil chain + reload wrist
  recWrist = new SpringF(0, 11, 0.32);
  recFore = new SpringF(0, 6.5, 0.4);
  recUpper = new SpringF(0, 4.2, 0.5);
  recBody = new SpringF(0, 3.6, 0.5);
  wristP = new SpringF(0, 8, 0.5);
  wristR = new SpringF(0, 8, 0.55);
  gunSway = new Spring3(2.2, 0.5);
  // free hand
  handL = new Spring3(1.7, 0.45);
  // accessories
  hatX = new SpringF(0, 2.4, 0.35);
  hatZ = new SpringF(0, 2.4, 0.35);
  coatX = new SpringF(0, 1.6, 0.45);
  coatZ = new SpringF(0, 1.6, 0.45);

  // blend weights
  aimW = 0;
  relW = 0;
  airW = 0;
  grabW = 0;
  driftW = 0;
  deadW = 0;
  wrapW = 0;
  stunW = 0;
  lowW = 0;
  boostW = 0;
  fanW = 0;
  pushW = 0;
  idleW = 0;
  hatW = 0;
  glanceW = 0;
  fidgetW = 0;

  // memory
  wasGrounded = true;
  prevVel = new THREE.Vector3();
  prevKickV = 0;
  prevHurt = 0;
  lastShotT = -9;
  prevHeading = 0;
  prevTrickYaw = 0;
  prevTrickPitch = 0;
  behind = false;
  /** board-driven stroke bookkeeping: push dust, sand-kick / slash triggers */
  prevPushT = 9;
  prevSandKick = 9;
  prevSlash = 9;
  /** stroke body envelope (crouch over the front knee), foot yaw and the springy foot target */
  pushBody = 0;
  pushYaw = 0;
  pushFoot = new THREE.Vector3(-0.25, 0, 0);
  manualW = 0;
  wallW = 0;
  idleT = 0;
  fidgetT = 5;
  fidget = 0;
  fidgetK = 0;
  glanceT = 1.5;
  glanceHold = 0;
  glance: GlanceTarget | null = null;
  lastAction: object | null = null;
  kickSide = 0;
  lastPhase = 'none';
  lastInserted = 0;
  twirl = 0;
  armActR = 0;
  wristPitch = 0;
  wristRoll = 0;
  /** request flags the player answers (keeps this module engine-agnostic) */
  wantGlanceQuery = false;
  wantFidgetTwirl = false;
  /** world position of a push-off footfall this frame (for a dust puff) */
  dust = new THREE.Vector3();
  dustNow = false;

  ab: ActionBody = { crouch: 0, hipX: 0, hipZ: 0, px: 0, tx: 0, ty: 0, tz: 0, jaw: 0 };
  private lp: LegPose = { x: 0, z: 0, knee: 0, roll: 0 };
  // frames
  private mRig = new THREE.Matrix4();
  private mT = new THREE.Matrix4();
  private qInvP = new THREE.Quaternion();
  qCorr = new THREE.Quaternion();
  // scratch
  private v0 = new THREE.Vector3();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private v5 = new THREE.Vector3();
  private v6 = new THREE.Vector3();
  private aimWorld = new THREE.Vector3();
  private aimT = new THREE.Vector3();
  private upT = new THREE.Vector3();
  private dAimR = new THREE.Vector3();
  private tR = new THREE.Vector3();
  private pR = new THREE.Vector3();
  private hR = new THREE.Vector3();
  private tL = new THREE.Vector3();
  private pL = new THREE.Vector3();
  private hL = new THREE.Vector3();
  private hp = new THREE.Vector3();
  private look = new THREE.Vector3();
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private qc = new THREE.Quaternion();
  private e0 = new THREE.Euler();

  init(rig: RigInstance) {
    const off = (name: string) => rig.geo.parts.find((p) => p.name === name)?.offset;
    const pel = off('pelvis'), th = off('thigh_l'), thr = off('thigh_r'), sh = off('shin_l');
    if (pel) this.pelvisRest.copy(pel);
    if (th) this.hipL.copy(th);
    if (thr) this.hipR.copy(thr);
    else this.hipR.set(-this.hipL.x, this.hipL.y, this.hipL.z);
    if (sh) {
      this.l1Leg = sh.length();
      this.l2Leg = Math.max(0.1, this.pelvisRest.y + this.hipL.y + sh.y);
    }
    const al = off('arm_l'), ar = off('arm_r'), fo = off('fore_l'), hd = off('head'), to = off('torso');
    if (al) this.shL.copy(al);
    if (ar) this.shR.copy(ar);
    else this.shR.set(-this.shL.x, this.shL.y, this.shL.z);
    if (fo) this.l1Arm = fo.length();
    const hs = rig.geo.sockets['hand_l'];
    if (hs) this.l2Arm = hs.offset.length();
    if (hd) this.neck.copy(hd);
    this.shoulderH = this.pelvisRest.y + (to?.y ?? 0.08) + this.shL.y;
    this.scale = (this.l1Leg + this.l2Leg) / 0.667;
    this.stanceHalf = Math.abs(this.hipL.x) + 0.13 * this.scale;
    this.ready = true;
  }

  /** ask for a nearby threat to glance at (answered via setGlance) */
  setGlance(g: GlanceTarget | null) {
    this.glance = g;
    if (g) this.glanceHold = 1.1 + Math.random() * 0.6;
  }

  // ===================================================================== update
  update(I: PlayerAnimIn) {
    const dt = I.dt;
    if (!this.ready) this.init(I.rig);
    this.dustNow = false;
    // a frozen frame (pause, zero-time hit-stop): hold the pose. Velocities are
    // differences over dt, so stepping here would only feed the springs garbage.
    if (!(dt > 0)) {
      this.wantGlanceQuery = this.wantFidgetTwirl = false;
      return;
    }
    const b = I.board, n = I.rig.nodes, R = I.reload, t = I.time;
    const grounded = b.grounded, spd = b.speed, alive = I.alive;
    const sc = this.scale;
    const idt = 1 / Math.max(dt, 1e-4);

    // --------------------------------------------------------- derived input
    const acc = this.v0.copy(b.vel).sub(this.prevVel).multiplyScalar(idt);
    this.prevVel.copy(b.vel);
    if (!Number.isFinite(acc.x + acc.y + acc.z)) {
      acc.set(0, 0, 0);
      if (!Number.isFinite(this.prevVel.x + this.prevVel.y + this.prevVel.z)) this.prevVel.set(0, 0, 0);
    }
    if (acc.lengthSq() > 4900) acc.setLength(70);
    const f = b.forward;
    const accX = acc.x * f.x + acc.z * f.z; // along the board (toward the nose = rider's left)
    const accZ = -acc.x * f.z + acc.z * f.x; // toward the board's right (rider's front)
    const takeoff = this.wasGrounded && !grounded;
    const landed = !this.wasGrounded && grounded;
    this.wasGrounded = grounded;

    // shots: the gun kick spring receives a velocity impulse per shot
    const dv = I.gunKick.v - this.prevKickV;
    I.gunKick.update(0, dt);
    this.prevKickV = I.gunKick.v;
    if (dv > 3) {
      const s = clamp(dv / 14, 0.4, 1.4) * (0.85 + Math.random() * 0.3);
      this.recWrist.kick(-26 * s);
      this.recFore.kick(-10 * s);
      this.recUpper.kick(-4.5 * s);
      this.recBody.kick(3 * s);
      this.lastShotT = t;
    }
    // hurt flinch
    if (I.hurtFlash > this.prevHurt + 0.4) {
      this.flinch.kick(-7);
      this.nod.kick(-6);
      this.handL.kick(0.4, 0.9, -0.6);
      this.gunSway.kick(-0.3, 0.6, -0.4);
    }
    this.prevHurt = I.hurtFlash;

    // ----------------------------------------------------------------- weights
    const g = b.grapple;
    const act = I.action;
    const aimOn = alive && !I.wrapped && (I.aiming || I.firing || g.active || t - this.lastShotT < 0.9);
    this.aimW = damp(this.aimW, aimOn ? 1 : 0, aimOn ? 16 : 3.2, dt);
    const rel = alive && R.active;
    this.relW = damp(this.relW, rel ? 1 : 0, rel ? 12 : 5.5, dt);
    this.airW = damp(this.airW, grounded ? 0 : 1, grounded ? 9 : 5, dt);
    this.grabW = damp(this.grabW, b.grabbing && !grounded ? 1 : 0, 9, dt);
    this.driftW = damp(this.driftW, b.drifting ? 1 : 0, 6, dt);
    this.deadW = damp(this.deadW, alive ? 0 : 1, alive ? 4 : 2.2, dt);
    this.wrapW = damp(this.wrapW, I.wrapped ? 1 : 0, 9, dt);
    this.stunW = damp(this.stunW, I.stunned && alive ? 1 : 0, 6, dt);
    this.lowW = damp(this.lowW, alive && I.hp01 < 0.3 ? 1 : 0, 2, dt);
    this.boostW = damp(this.boostW, b.boosting ? 1 : 0, 5, dt);
    this.fanW = damp(this.fanW, I.fanning && alive && !rel ? 1 : 0, I.fanning ? 18 : 6, dt);
    const idle = alive && grounded && spd < 1.2 && !I.forwardHeld && !aimOn && !rel && !act && !I.wrapped;
    this.idleT = idle ? this.idleT + dt : 0;
    this.idleW = damp(this.idleW, idle && this.idleT > 0.6 ? 1 : 0, 1.6, dt);
    const hatHold = alive && grounded && spd > 11.5 && !aimOn && !rel && !act;
    this.hatW = damp(this.hatW, hatHold ? 1 : 0, 4, dt);
    // the kick-push stroke runs on the board's push clock (works while aiming / shooting too)
    const stroking = alive && grounded && b.pushT < PUSH.dur && !I.wrapped && !I.stunned && b.stumble <= 0 && !b.drifting && !b.manual;
    this.pushW = damp(this.pushW, stroking ? 1 : 0, stroking ? 30 : 12, dt);
    {
      const u = clamp01(b.pushT / PUSH.dur);
      this.pushBody = this.pushW * smooth(u / 0.22) * smooth((1 - u) / 0.32) * (b.pushGrade === 'rushed' ? 0.6 : 1);
    }
    this.manualW = damp(this.manualW, b.manual && grounded ? 1 : 0, 10, dt);
    this.wallW = damp(this.wallW, b.wall.on ? 1 : 0, 12, dt);
    // one-shot moves: the sand-kick stamp, the board-slash tail whip
    if (b.sandKickT < this.prevSandKick) {
      this.crouch.kick(-4.5);
      this.ollie.kick(-7);
      this.handL.kick(0.2, 1.8, 0.4);
    }
    this.prevSandKick = b.sandKickT;
    if (b.slashT < this.prevSlash) {
      this.yawOff.kick(b.driftDir * 16);
      this.spinLead.kick(-b.driftDir * 5);
      this.handL.kick(0.3, 0.6, -b.driftDir * 0.6);
    }
    this.prevSlash = b.slashT;
    // idle fidgets: hat adjust, glance over the shoulder, a casual twirl
    this.wantFidgetTwirl = false;
    if (this.idleW > 0.8) {
      this.fidgetT -= dt;
      if (this.fidgetT <= 0 && this.fidget === 0) {
        const r = Math.random();
        if (r < 0.34) this.wantFidgetTwirl = true;
        else this.fidget = r < 0.67 ? 1 : 2;
        this.fidgetK = 0;
        this.fidgetT = 5 + Math.random() * 5;
      }
    }
    if (this.fidget) {
      this.fidgetK += dt / (this.fidget === 1 ? 1.4 : 1.8);
      if (this.fidgetK >= 1 || this.idleW < 0.5) this.fidget = 0;
    }
    this.fidgetW = this.fidget ? smooth(this.fidgetK / 0.2) * smooth((1 - this.fidgetK) / 0.25) : 0;
    // threat glances
    this.wantGlanceQuery = false;
    this.glanceT -= dt;
    this.glanceHold -= dt;
    if (this.glanceT <= 0) {
      this.glanceT = 2.4 + Math.random() * 2.2;
      this.wantGlanceQuery = true;
    }
    const glanceOk = !!this.glance && this.glance.alive && this.glanceHold > 0;
    this.glanceW = damp(this.glanceW, glanceOk ? 1 : 0, 5, dt);

    // action start hooks + body offsets
    if (act !== this.lastAction) {
      this.lastAction = act;
      if (act) this.onActionStart(act.name, I);
    }
    this.actionBody(act, this.ab);
    const ab = this.ab;

    // ------------------------------------------------ board: yaw, roll, ollie
    I.root.position.copy(b.pos);
    this.qa.setFromAxisAngle(UP, b.heading);
    this.qb.setFromUnitVectors(UP, b.up);
    I.root.quaternion.copy(this.qb).multiply(this.qa);
    const spinRate = grounded ? 0 : (b.trickYaw - this.prevTrickYaw) * idt;
    const flipRate = grounded ? 0 : (b.trickPitch - this.prevTrickPitch) * idt;
    if (landed) {
      // a spin/flip that lands a little off snaps the board: absorb it into a settle spring
      this.yawOff.x += wrapAngle(this.prevHeading + this.prevTrickYaw - b.heading - b.trickYaw);
      this.pitchOff.x += wrapAngle(this.prevTrickPitch - b.trickPitch);
    }
    this.prevHeading = b.heading;
    this.prevTrickYaw = b.trickYaw;
    this.prevTrickPitch = b.trickPitch;
    this.yawOff.step(0, dt);
    this.pitchOff.step(0, dt);
    if (takeoff) this.ollie.kick(-11 * clamp(0.6 + b.vel.y / 12, 0.5, 1.3));
    if (landed) this.ollie.kick(5);
    this.ollie.step(0, dt);
    this.lean.step(b.lean, dt);
    this.lag.step(this.lean.x, dt);
    // the board banks INTO the carve (positive lean = left turn = heel side for this stance)
    const roll = -this.lean.x * 0.42 * (1 - this.airW * 0.7) - b.driftDir * this.driftW * 0.1;
    I.tilt.rotation.set(0, 0, 0);
    I.tilt.rotateY(b.trickYaw + this.yawOff.x);
    I.tilt.rotateZ(-(b.trickPitch + this.pitchOff.x) + roll);
    I.tilt.rotateX(this.ollie.x);
    // nose manual: the board rocks onto its nose (pivot at the nose, the tail lifts) and wobbles with the balance
    if (this.manualW > 0.001) {
      const mp = (0.17 + clamp(b.manualBal, -1, 1) * 0.1 + Math.sin(t * 9) * 0.008) * this.manualW;
      I.tilt.rotateX(mp);
      I.tilt.position.set(0, Math.sin(mp) * 0.6, 0);
    } else I.tilt.position.set(0, 0, 0);

    // ------------------------------------------------------------ aim (rig frame)
    I.rig.root.updateWorldMatrix(true, false);
    this.mRig.copy(I.rig.root.matrixWorld).invert();
    if (g.active) this.aimWorld.set(g.x, g.y, g.z);
    else this.aimWorld.copy(I.aimPoint);
    const al = this.v1.copy(this.aimWorld).applyMatrix4(this.mRig);
    let yawAim = Math.atan2(al.x, al.z);
    // targets behind: twist right so the gun arm extends to its own side
    if (yawAim > 2.5 || (yawAim > 2.0 && this.behind)) {
      yawAim -= TAU;
      this.behind = true;
    } else this.behind = false;
    const aimPitch = Math.atan2(al.y - this.shoulderH, Math.max(0.5, Math.hypot(al.x, al.z)));

    // ---------------------------------------------------------- spine targets
    const heel = Math.max(0, this.lean.x), toe = Math.max(0, -this.lean.x);
    const charge = grounded ? b.jumpCharge : 0;
    let yawT = lerp(0.38, clamp(yawAim * 0.62, -1.3, 1.3), this.aimW);
    yawT = lerp(yawT, 0.12, this.relW * 0.8);
    yawT += I.spinInput * charge * 0.6 * (1 - this.aimW); // spin wind-up (coils against the spin D / A will throw)
    // drifting: the shoulders stay on the travel line while the tail slides out; a charging spin launch coils against it
    if (this.driftW > 0.01) {
      const slide = grounded ? wrapAngle(Math.atan2(b.vel.x, b.vel.z) - b.heading) : 0;
      yawT += (clamp(slide, -0.9, 0.9) * 0.45 - b.driftDir * charge * 0.5) * this.driftW * (1 - this.aimW * 0.7);
    }
    this.spinLead.step(clamp(spinRate * 0.045, -0.6, 0.6), dt); // shoulders lead the spin
    yawT += this.spinLead.x + ab.ty + this.idleW * fbm(t * 0.13, 3) * 0.3;
    this.yaw.step(yawT, dt);

    // ----------------------------------------------------- knee compression
    const flipTuck = clamp(Math.abs(flipRate) / 8, 0, 1);
    const falling = !grounded && b.vel.y < -3 && I.heightAboveGround < 3.2 ? 1 : 0;
    let cT = 0.12 + clamp(spd / 40, 0, 0.18) + b.compress * 0.5 + this.driftW * 0.25 + heel * 0.2 + toe * 0.1 + this.boostW * 0.14 + this.stunW * 0.15 + this.lowW * 0.08 - this.idleW * 0.05 + this.pushBody * 0.34 + this.wrapW * 0.15 + this.manualW * 0.06 + this.wallW * 0.32;
    cT += this.airW * (0.36 + this.grabW * 0.5 + flipTuck * 0.3 - falling * 0.3);
    cT += this.deadW * 0.8 + ab.crouch;
    if (takeoff) this.crouch.kick(-3.5); // legs extend: the pop
    this.crouch.step(cT, dt);
    const crouch = this.crouch.x;
    this.accX.step(clamp(accX * 0.012, -0.5, 0.5), dt);
    this.accZ.step(clamp(accZ * 0.012, -0.5, 0.5), dt);
    this.absorb.step(grounded ? clamp(acc.y * 0.0035, -0.05, 0.08) : 0, dt);

    // --------------------------------------------------- kick-push (back foot)
    // the stroke follows the board's push clock: the back foot lifts off the deck, plants
    // beside the toe edge by the front foot, kicks back along the sand (as far as the leg
    // reaches at this speed), then swings round and sets back down on the deck
    let pbob = 0;
    if (this.pushW > 0.01) {
      const T = b.pushT;
      const big = b.pushGrade === 'perfect' || b.pushGrade === 'landing' ? 1.15 : b.pushGrade === 'rushed' ? 0.6 : 1;
      const gy = -0.095 * sc;
      const deckX = -this.stanceHalf, deckZ = this.footZ;
      const plantX = 0.03 * sc, plantZ = 0.21 * sc;
      const L = clamp(spd * 0.2, 0.16, 0.56) * sc * big;
      const pf = this.v2;
      if (T < PUSH.plant) {
        // up off the deck, reach forward and down to the sand
        bez(deckX, 0, deckZ, -0.1 * sc, 0.17 * sc * big, 0.12 * sc, plantX, gy, plantZ, easeInOutSine(T / PUSH.plant), pf);
      } else if (T < PUSH.kickEnd) {
        // planted: the foot stays with the ground while the board runs on, so it sweeps back
        const k = (T - PUSH.plant) / (PUSH.kickEnd - PUSH.plant);
        const sw = k * k * (3 - 2 * k) * 0.35 + k * 0.65;
        pf.set(plantX - L * sw, gy, plantZ + 0.02 * sc * Math.sin(k * PI));
      } else {
        // toe-off: the heel flicks up behind, the foot swings round and sets back down
        bez(plantX - L, gy, plantZ, -0.42 * sc, 0.2 * sc * big, 0.1 * sc, deckX, 0, deckZ, easeInOutSine((T - PUSH.kickEnd) / (PUSH.dur - PUSH.kickEnd)), pf);
      }
      // springy follow so a queued (mashed) stroke never pops the foot
      const fk = 1 - Math.exp(-40 * dt);
      this.pushFoot.x += (pf.x - this.pushFoot.x) * fk;
      this.pushFoot.y += (pf.y - this.pushFoot.y) * fk;
      this.pushFoot.z += (pf.z - this.pushFoot.z) * fk;
      // the foot turns to point down the line while it is on the sand
      this.pushYaw = 0.9 * this.pushW * smooth(T / PUSH.plant) * (1 - smooth((T - PUSH.kickEnd) / (PUSH.dur - PUSH.kickEnd)));
      // the toe-off flicks sand back
      if (this.prevPushT < PUSH.kickEnd && T >= PUSH.kickEnd && this.pushW > 0.5) {
        this.dustNow = true;
        this.dust.set(plantX - L, gy, plantZ);
        I.rig.root.localToWorld(this.dust);
      }
      // weight bobs over the front knee: dips into the plant, drives up through the kick
      pbob = (Math.sin(clamp01((T - PUSH.plant * 0.5) / PUSH.kickEnd) * PI) * 0.035 - Math.sin(clamp01(T / PUSH.dur) * PI) * 0.01) * this.pushW * big;
    } else {
      this.pushFoot.set(-this.stanceHalf, 0, this.footZ);
      this.pushYaw = 0;
    }
    this.prevPushT = b.pushT;

    // ------------------------------------------------------------------ pelvis
    const land = I.landX;
    const drop = (0.025 + crouch * 0.2 + Math.max(0, -land) * 0.3 + this.absorb.x + pbob) * sc;
    const ext = Math.max(0, land) * 0.08 * sc;
    const hz = (-0.015 - crouch * 0.06 - heel * 0.06 + toe * 0.035 + this.pushBody * 0.06 - this.deadW * 0.04 + ab.hipZ) * sc;
    const hx = (-this.accX.x * 0.08 + fbm(t * 0.35, 1) * 0.03 * this.idleW + this.pushBody * 0.07 + this.manualW * (0.08 + clamp(b.manualBal, -1, 1) * 0.03) + ab.hipX) * sc;
    const stw = b.stumble > 0 ? Math.sin(t * 19) * Math.min(1, b.stumble * 2.5) : 0;
    const px = 0.05 + crouch * 0.3 + toe * 0.1 - heel * 0.03 + this.deadW * 0.3 + ab.px;
    const py = 0.16 + (this.yaw.x - 0.38) * 0.28 + this.pushBody * 0.14;
    const pz = -hx * 1.6 + this.ollie.x * 0.85 + stw * 0.12;
    const pelvis = n['pelvis'];
    if (pelvis) {
      pelvis.position.set(this.pelvisRest.x + hx, this.pelvisRest.y - drop + ext, this.pelvisRest.z + hz);
      pelvis.rotation.set(px, py, pz);
      // -------------------------------------------------------------- legs
      this.qInvP.copy(pelvis.quaternion).invert();
      const fl = this.v3.set(this.stanceHalf, 0, this.footZ);
      const fr = this.v4.set(-this.stanceHalf, 0, this.footZ);
      if (this.pushW > 0.01) fr.lerp(this.pushFoot, this.pushW);
      this.solveLeg(n['thigh_l'], n['shin_l'], fl, this.hipL, pelvis, 0.26 - py);
      this.solveLeg(n['thigh_r'], n['shin_r'], fr, this.hipR, pelvis, -0.16 - py + this.pushYaw);
    }

    // ------------------------------------------------------------------ torso
    this.flinch.step(0, dt);
    this.recBody.step(0, dt);
    const breathe = Math.sin(t * (1.5 + this.lowW * 1.6)) * (0.016 + this.lowW * 0.03 + this.idleW * 0.012);
    const tx = crouch * 0.2 + heel * 0.28 + toe * 0.05 - this.recBody.x * 0.1 + this.flinch.x * 0.12 + breathe - this.accZ.x * 0.15 + this.deadW * 0.75 + this.boostW * 0.2 + this.lowW * 0.12 - aimPitch * 0.14 * this.aimW + ab.tx + this.airW * this.grabW * 0.55 + (this.lag.x - this.lean.x) * 0.25 + this.pushBody * 0.16 + charge * 0.14 + this.manualW * 0.06 + this.wallW * 0.15;
    const ty = this.yaw.x - py;
    const tz = this.accX.x * 0.14 - pz * 0.55 + stw * 0.25 + this.stunW * Math.sin(t * 1.7) * 0.1 + ab.tz + this.recBody.x * 0.04;
    const torso = n['torso'];
    if (!torso) return;
    torso.rotation.set(tx, ty, tz);
    I.root.updateMatrixWorld(true);
    this.mT.copy(torso.matrixWorld).invert();
    this.upT.copy(UP).transformDirection(this.mT);
    this.aimT.copy(this.aimWorld).applyMatrix4(this.mT);

    this.solveGunArm(I, heel, toe, land);
    this.solveFreeArm(I, heel, toe, charge, spinRate, takeoff, landed, stw);
    this.solveHead(I, f);
    this.accessories(I, accX, accZ);
  }

  private solveLeg(thigh: THREE.Object3D | undefined, shin: THREE.Object3D | undefined, footRig: THREE.Vector3, hip: THREE.Vector3, pelvis: THREE.Object3D, footYaw: number) {
    if (!thigh || !shin) return;
    const d = this.v5.copy(footRig).sub(pelvis.position).applyQuaternion(this.qInvP).sub(hip);
    legIK(d.x, d.y, d.z, this.l1Leg, this.l2Leg, 0.5, this.lp);
    thigh.rotation.set(this.lp.x, 0, this.lp.z);
    shin.rotation.set(this.lp.knee, footYaw, this.lp.roll);
  }

  // ------------------------------------------------------------- gun arm
  private solveGunArm(I: PlayerAnimIn, heel: number, toe: number, land: number) {
    const n = I.rig.nodes, R = I.reload, t = I.time, dt = I.dt, sc = this.scale;
    const armR = n['arm_r'], foreR = n['fore_r'];
    if (!armR || !foreR) return;
    const S = this.shR, reach = this.l1Arm + this.l2Arm;
    const aimW = this.aimW, relW = this.relW;
    // carry: low ready, gun hand in front of the hip, swaying with the ride
    this.gunSway.step(
      -this.accX.x * 0.08 - this.airW * 0.1,
      this.airW * 0.14 - Math.max(0, -land) * 0.05 + this.boostW * 0.04,
      heel * 0.07 - toe * 0.05 + Math.sin(clamp01(I.board.pushT / PUSH.dur) * TAU) * 0.1 * this.pushBody - this.boostW * 0.12,
      dt
    );
    const T = this.tR.set(S.x + (0.02 + this.gunSway.x.x) * sc, S.y + (-0.37 + this.gunSway.y.x) * sc, S.z + (0.2 + this.gunSway.z.x) * sc);
    const pole = this.pR.set(-0.35, -0.3, -1);
    const hint = this.hR.set(0, 1, 0.1);
    // aim: nearly straight arm toward the target; the wrist finishes the job
    const dA = this.dAimR.copy(this.aimT).sub(S).normalize();
    if (aimW > 0.001) {
      T.lerp(this.v6.copy(S).addScaledVector(dA, reach * 0.965), aimW);
      pole.lerp(this.v6.set(-0.5, -0.85, -0.2), aimW);
      hint.lerp(this.upT, aimW).normalize();
    }
    // reload choreography (gun hand + wrist)
    let wp = 0, wr = 0;
    if (relW > 0.003) {
      const ph = R.phase;
      if (ph !== this.lastPhase) {
        if (ph === 'eject') this.wristP.kick(-9);
        if (ph === 'close') this.wristR.kick(14);
        if (ph === 'open') this.wristR.kick(-4);
        this.lastPhase = ph;
      }
      if (R.inserted !== this.lastInserted) {
        if (R.inserted > this.lastInserted) this.wristR.kick(-3.5);
        this.lastInserted = R.inserted;
      }
      let rx = -0.05, ry = 0.17, rz = 0.44;
      if (ph === 'open' || ph === 'none') {
        wr = -1.25;
        wp = -0.15;
      } else if (ph === 'eject') {
        wr = -1.2;
        wp = -1.35;
        ry += 0.05;
        const u = clamp01((R.t - 0.14) / 0.16);
        ry += Math.sin(u * PI * 6) * 0.025 * (1 - u); // shake the shells out
      } else if (ph === 'insert') {
        wr = -1.45;
        wp = 0.35;
        ry -= 0.05;
      } else if (ph === 'close') {
        wr = 0.1;
        wp = -0.2;
        rz += 0.04;
      }
      if (R.jam > 0) {
        rx += Math.sin(t * 41) * 0.018;
        ry += Math.sin(t * 33) * 0.018;
        wp += Math.sin(t * 27) * 0.25;
      }
      T.lerp(this.v6.set(rx * sc + S.x * (1 - sc), ry * sc + S.y * (1 - sc), rz * sc + S.z * (1 - sc)), relW);
      pole.lerp(this.v6.set(-0.9, -0.5, -0.1), relW);
      hint.lerp(this.v6.set(0, 1, 0), relW).normalize();
    } else {
      this.lastPhase = 'none';
      this.lastInserted = 0;
    }
    this.wristP.step(wp, dt);
    this.wristR.step(wr, dt);
    // states that take the gun arm away
    if (this.wrapW > 0.01) {
      T.lerp(this.v6.set(S.x + 0.14 * sc, S.y - 0.32 * sc, S.z + 0.16 * sc), this.wrapW);
      pole.lerp(this.v6.set(-1, -0.1, -0.3), this.wrapW);
    }
    if (this.stunW > 0.01) T.lerp(this.v6.set(S.x + Math.sin(t * 2.1) * 0.05, S.y - 0.52 * sc, S.z + 0.1 * sc), this.stunW * (1 - aimW));
    if (this.deadW > 0.01) {
      T.lerp(this.v6.set(S.x + 0.02, S.y - 0.56 * sc, S.z + 0.08 * sc), this.deadW);
      pole.lerp(this.v6.set(-0.3, 0, -1), this.deadW);
    }
    armIK(S, T, pole, this.l1Arm, this.l2Arm, hint, armR.quaternion, foreR.quaternion);
    // wrist: put the barrel on the line from the hand to the target
    armR.updateMatrixWorld(true);
    this.qCorr.identity();
    const corrW = aimW * (1 - relW) * (1 - this.wrapW) * (1 - this.deadW);
    const holder = I.gun.root.parent;
    const hand = I.rig.sockets['hand_r'];
    if (corrW > 0.01 && holder && hand) {
      hand.getWorldPosition(this.v6);
      const d = this.v6.subVectors(this.aimWorld, this.v6);
      if (d.lengthSq() > 0.25) {
        this.qa.copy(holder.getWorldQuaternion(this.qb)).invert();
        d.normalize().applyQuaternion(this.qa);
        this.qa.setFromUnitVectors(this.v5.set(0, 0, 1), d);
        // keep the correction a wrist, not a broken arm
        const ang = 2 * Math.acos(clamp(Math.abs(this.qa.w), 0, 1));
        const lim = ang > 0.9 ? 0.9 / ang : 1;
        this.qCorr.slerp(this.qa, corrW * lim);
      }
    }
    // recoil follow-through: wrist snaps first, the forearm and the shoulder follow
    this.recWrist.step(0, dt);
    this.recFore.step(0, dt);
    this.recUpper.step(0, dt);
    const rk = 1 - relW;
    armR.rotateX(this.recUpper.x * rk);
    foreR.rotateX(this.recFore.x * rk);
    this.wristPitch = this.wristP.x * relW + this.recWrist.x * rk;
    this.wristRoll = this.wristR.x * relW;
    I.gun.root.quaternion.setFromEuler(this.e0.set(this.wristPitch, 0, this.wristRoll)).premultiply(this.qCorr);
    armR.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------- free hand
  private solveFreeArm(I: PlayerAnimIn, heel: number, toe: number, charge: number, spinRate: number, takeoff: boolean, landed: boolean, stw: number) {
    const n = I.rig.nodes, R = I.reload, t = I.time, dt = I.dt, sc = this.scale, b = I.board;
    const armL = n['arm_l'], foreL = n['fore_l'];
    if (!armL || !foreL) return;
    const S = this.shL;
    // balance: the front arm counters the carve, flies out in the air, trails in drifts
    const push = -Math.sin(clamp01(b.pushT / PUSH.dur) * TAU) * 0.16 * this.pushBody;
    const ltx = (0.17 + toe * 0.1 + this.airW * 0.26 + this.driftW * 0.28 - this.accX.x * 0.1 + this.boostW * 0.03) * sc;
    const lty = (-0.42 + heel * 0.12 + toe * 0.07 + this.airW * 0.32 - this.driftW * 0.06 - charge * 0.05) * sc;
    const ltz = (0.14 + heel * 0.2 - toe * 0.14 + this.airW * 0.04 + this.driftW * 0.12 - charge * 0.26 - this.boostW * 0.24 + push) * sc;
    if (takeoff) this.handL.kick(0.3, 2.6, 0.6);
    if (landed) this.handL.kick(0.6, -1.2, 0.3);
    this.handL.step(ltx, lty, ltz, dt);
    const T = this.tL.set(S.x + this.handL.x.x, S.y + this.handL.y.x, S.z + this.handL.z.x);
    const pole = this.pL.set(0.6, -0.7, -0.4);
    const hint = this.hL.set(0, 0.4, 1);
    // fast spins pull the arm in
    const tuck = clamp((Math.abs(spinRate) - 2) / 6, 0, 1) * this.airW;
    if (tuck > 0) T.lerp(this.v6.set(0.1 * sc, 0.2 * sc, 0.32 * sc), tuck * 0.7);
    // stumble: windmill
    if (stw !== 0) T.add(this.v6.set(0, Math.cos(t * 15) * 0.16, Math.sin(t * 15) * 0.16).multiplyScalar(Math.min(1, b.stumble * 3)));
    // hat hold at high speed
    const head = n['head'];
    if (this.hatW > 0.01 && head) {
      head.localToWorld(this.v6.set(0.03 * sc, 0.2 * sc, 0.17 * sc)).applyMatrix4(this.mT);
      T.lerp(this.v6, this.hatW);
      pole.lerp(this.v5.set(0.9, -0.2, -0.3), this.hatW);
    }
    // idle fidgets: hat adjust (1)
    if (this.fidget === 1 && head) {
      head.localToWorld(this.v6.set(0.05 * sc, 0.21 * sc + Math.sin(this.fidgetK * PI * 3) * 0.015, 0.15 * sc)).applyMatrix4(this.mT);
      T.lerp(this.v6, this.fidgetW);
      pole.lerp(this.v5.set(0.9, -0.2, -0.3), this.fidgetW);
    }
    // low health: clutch the ribs
    if (this.lowW > 0.01) T.lerp(this.v6.set(-0.06 * sc, 0.12 * sc, 0.28 * sc), this.lowW * 0.6 * (1 - this.airW) * (1 - this.relW) * (1 - this.fanW) * (1 - this.aimW * 0.5));
    // fanning: the palm sweeps over the hammer, once per shot
    if (this.fanW > 0.01) {
      const hm = I.gun.nodes['hammer'] ?? I.gun.nodes['frame'];
      if (hm) {
        hm.getWorldPosition(this.v6).applyMatrix4(this.mT);
        const sw = Math.sin(((t * 11.5) % 1) * TAU);
        this.v6.addScaledVector(this.upT, 0.05 + Math.abs(sw) * 0.03).addScaledVector(this.dAimR, sw * 0.07);
        T.lerp(this.v6, this.fanW);
        pole.lerp(this.v5.set(0.4, -0.9, 0.1), this.fanW);
      }
    }
    // reload: cradle, eject, belt → cylinder, spin it shut; slap it when it jams
    if (this.relW > 0.01) {
      const cyl = I.gun.nodes['cylinder'] ?? I.gun.nodes['frame'];
      if (cyl) {
        cyl.getWorldPosition(this.v6).applyMatrix4(this.mT);
        const ph = R.phase;
        if (R.jam > 0) this.v6.add(this.v5.set(0.0, 0.07 + Math.abs(Math.sin(t * 14)) * 0.08, 0.03));
        else if (ph === 'open' || ph === 'none') this.v6.add(this.v5.set(0.02, -0.06, 0.02));
        else if (ph === 'eject') {
          const u = clamp01((R.t - 0.14) / 0.16);
          this.v6.add(this.v5.set(0.04, 0.05 - Math.sin(u * PI) * 0.05, 0.04));
        } else if (ph === 'insert') {
          const u = clamp01((R.t - 0.3) / 0.56);
          // dip to the belt for a fistful, then thumb each round home
          const belt = smooth(u / 0.1) * (1 - smooth((u - 0.12) / 0.1));
          const per = (u * 6) % 1;
          this.v6.add(this.v5.set(0.03, 0.05 + Math.sin(per * PI) * 0.03, 0.01));
          const pel = n['pelvis'];
          if (pel && belt > 0.001) {
            pel.localToWorld(this.v5.set(0.17 * sc, -0.04 * sc, 0.11 * sc)).applyMatrix4(this.mT);
            this.v6.lerp(this.v5, belt);
          }
        } else if (ph === 'close') {
          const u = clamp01((R.t - 0.86) / 0.14);
          this.v6.add(this.v5.set(lerp(-0.06, 0.1, easeOutCubic(u)), 0.04, 0.03));
        }
        T.lerp(this.v6, this.relW);
        pole.lerp(this.v5.set(0.7, -0.65, 0.1), this.relW);
      }
    }
    // drift: the free hand trails down to the sand on the inside of the slide (heel side behind, toe side in front)
    const drag = this.driftW * (1 - this.aimW * 0.4) * (1 - this.relW);
    if (drag > 0.01) {
      const heelSide = b.driftDir > 0;
      I.rig.root.localToWorld(this.v6.set(0.16 * sc, 0.22 * sc + Math.sin(t * 13) * 0.01, (heelSide ? -0.4 : 0.44) * sc)).applyMatrix4(this.mT);
      T.lerp(this.v6, drag * 0.85);
      pole.lerp(this.v5.set(0.8, 0.2, heelSide ? 0.4 : -0.6), drag);
    }
    // manual: the arm flies out over the nose to balance, bobbing with the wobble
    if (this.manualW > 0.01) T.lerp(this.v6.set(S.x + 0.4 * sc, S.y - 0.05 * sc + clamp(b.manualBal, -1, 1) * 0.12 * sc, S.z + 0.06 * sc), this.manualW * (1 - this.aimW * 0.5));
    // board grab
    if (this.grabW > 0.01) {
      I.rig.root.localToWorld(this.v6.set(0.03 * sc, 0.06, 0.2 * sc)).applyMatrix4(this.mT);
      T.lerp(this.v6, this.grabW);
      pole.lerp(this.v5.set(0.8, 0.1, -0.6), this.grabW);
    }
    // grapple: grab the rope ahead of the gun hand
    const g = b.grapple;
    const hand = I.rig.sockets['hand_r'];
    if (g.active && hand && I.alive) {
      hand.getWorldPosition(this.v6);
      this.v5.set(g.x, g.y, g.z).sub(this.v6);
      const len = this.v5.length();
      if (len > 0.5) {
        this.v6.addScaledVector(this.v5, Math.min(0.42, len * 0.5) / len).applyMatrix4(this.mT);
        T.lerp(this.v6, 0.85);
      }
    }
    if (this.wrapW > 0.01) {
      T.lerp(this.v6.set(S.x - 0.14 * sc, S.y - 0.3 * sc, S.z + 0.17 * sc), this.wrapW);
      pole.lerp(this.v5.set(1, -0.1, -0.3), this.wrapW);
    }
    if (this.stunW > 0.01) T.lerp(this.v6.set(S.x + Math.sin(t * 1.9) * 0.06, S.y - 0.5 * sc, S.z + 0.08 * sc), this.stunW);
    if (this.deadW > 0.01) T.lerp(this.v6.set(S.x - 0.02, S.y - 0.56 * sc, S.z + 0.06 * sc), this.deadW);
    armIK(S, T, pole, this.l1Arm, this.l2Arm, hint, armL.quaternion, foreL.quaternion);
  }

  // ------------------------------------------------------------------ head
  private solveHead(I: PlayerAnimIn, f: { x: number; z: number }) {
    const n = I.rig.nodes, b = I.board, t = I.time, dt = I.dt;
    const head = n['head'];
    if (!head) return;
    head.getWorldPosition(this.hp);
    this.hp.y += 0.12;
    // where he's going
    const vx = b.vel.x, vz = b.vel.z, vl = Math.hypot(vx, vz);
    const d = this.look;
    if (vl > 2) d.set(vx / vl, -0.12, vz / vl);
    else d.set(f.x, -0.12, f.z);
    d.normalize();
    // idle: look around the dunes (fidget 2: over the shoulder)
    if (this.idleW > 0.01) {
      const ang = b.heading - PI / 2 + fbm(t * 0.17, 9) * 1.5 + (this.fidget === 2 ? Math.sin(this.fidgetK * PI) * -2.2 : 0);
      d.lerp(this.v6.set(Math.sin(ang), -0.05 + fbm(t * 0.29, 5) * 0.18, Math.cos(ang)), this.idleW).normalize();
    }
    // threats
    const gl = this.glance;
    if (this.glanceW > 0.01 && gl) {
      this.v6.set(gl.pos.x, gl.pos.y + gl.height * 0.7, gl.pos.z).sub(this.hp).normalize();
      d.lerp(this.v6, this.glanceW * (1 - this.aimW) * (1 - this.relW)).normalize();
    }
    // the target
    if (this.aimW > 0.01) d.lerp(this.v6.copy(this.aimWorld).sub(this.hp).normalize(), this.aimW).normalize();
    // the gun while reloading
    const hand = I.rig.sockets['hand_r'];
    if (this.relW > 0.01 && hand) d.lerp(hand.getWorldPosition(this.v6).sub(this.hp).normalize(), this.relW * 0.85).normalize();
    // spot the landing
    if (this.airW > 0.01) d.lerp(this.v6.set(vx * 0.4, -Math.max(2, -b.vel.y), vz * 0.4).normalize(), this.airW * 0.3 * (1 - this.aimW)).normalize();
    if (this.deadW > 0.01) d.lerp(this.v6.set(f.x * 0.3, -1, f.z * 0.3).normalize(), this.deadW * 0.85).normalize();
    // into the torso frame, clamp, spring
    const dl = this.v5.copy(d).transformDirection(this.mT);
    const yaw = clamp(Math.atan2(dl.x, dl.z), -1.35, 1.35);
    const pitch = clamp(Math.atan2(dl.y, Math.hypot(dl.x, dl.z)), -0.95, 0.6);
    this.headYaw.step(yaw, dt);
    this.headPitch.step(pitch, dt);
    const cy = Math.cos(this.headPitch.x);
    this.v6.set(Math.sin(this.headYaw.x) * cy, Math.sin(this.headPitch.x), Math.cos(this.headYaw.x) * cy);
    // stabilise: eyes stay level with the horizon while carving over the dunes
    const stab = 0.6 * (1 - this.airW) * (1 - this.deadW);
    this.v5.set(0, 1, 0).lerp(this.upT, stab).normalize();
    lookQuat(this.v6, this.v5, head.quaternion);
    this.nod.step(0, dt);
    let nod = this.nod.x + this.deadW * 0.35;
    if (I.expression === 'laugh') nod += Math.abs(Math.sin(t * 11)) * 0.12;
    head.rotateX(nod);
    if (this.stunW > 0.01) head.rotateZ(Math.sin(t * 2.3) * 0.25 * this.stunW);
    if (this.wrapW > 0.01) head.rotateY(Math.sin(t * 7) * 0.4 * this.wrapW);
  }

  // ------------------------------------------------------------- accessories
  private accessories(I: PlayerAnimIn, accX: number, accZ: number) {
    const n = I.rig.nodes, t = I.time, dt = I.dt, b = I.board;
    const jaw = n['jaw'];
    if (jaw) jaw.rotation.x = damp(jaw.rotation.x, I.exprJaw + (I.expression === 'laugh' ? Math.abs(Math.sin(t * 22)) * 0.25 : 0) + this.wrapW * Math.abs(Math.sin(t * 9)) * 0.2 + this.ab.jaw, 18, dt);
    if (n['brow_l']) n['brow_l'].rotation.z = damp(n['brow_l'].rotation.z, I.exprBrow[0], 14, dt);
    if (n['brow_r']) n['brow_r'].rotation.z = damp(n['brow_r'].rotation.z, I.exprBrow[1], 14, dt);
    // hat: wind from the nose pushes the brim toward the tail, inertia rocks it
    const hat = n['hat'];
    if (hat) {
      this.hatZ.step(clamp(accX * 0.004 + b.speed * 0.004, -0.3, 0.35), dt);
      this.hatX.step(clamp(-accZ * 0.004 + this.airW * -0.08, -0.3, 0.3), dt);
      hat.rotation.set(this.hatX.x, 0, this.hatZ.x);
    }
    // coat tails: blown toward the tail, flared behind
    const coat = n['coat'];
    if (coat) {
      const sp = clamp(b.speed / 30, 0, 1.2);
      this.coatZ.step(-sp * 0.55 - (b.grounded ? 0 : 0.2), dt);
      this.coatX.step(sp * 0.35 + (b.grounded ? 0 : 0.25), dt);
      coat.rotation.set(this.coatX.x + Math.sin(t * (6 + b.speed * 0.3)) * 0.05 * clamp(b.speed / 20, 0.2, 1), 0, this.coatZ.x);
    }
  }

  // ================================================================ actions
  private onActionStart(name: string, I: PlayerAnimIn) {
    if (name === 'kick') {
      // kick toward where the camera looks: the nose (front leg), the tail (back leg) or ahead (back leg front kick)
      this.v6.copy(I.camForward).transformDirection(this.mRig);
      const y = Math.atan2(this.v6.x, this.v6.z);
      this.kickSide = y > 0.7 ? 1 : y < -0.7 ? -1 : 0;
    } else if (name === 'grapple') {
      this.recWrist.kick(-20);
      this.recFore.kick(-8);
    } else if (name === 'throw' || name === 'lob') this.handL.kick(0, 0.5, -0.8);
  }

  private actionBody(a: { name: string; t: number; dur: number } | null, o: ActionBody) {
    o.crouch = o.hipX = o.hipZ = o.px = o.tx = o.ty = o.tz = o.jaw = 0;
    if (!a) return;
    const k = clamp01(a.t / a.dur);
    const w = actionWeight(a.name, k);
    switch (a.name) {
      case 'throw': {
        // coil away, uncoil hard through the release, follow through
        const coil = k < 0.38 ? easeInOutSine(k / 0.38) : 1 - easeOutCubic((k - 0.38) / 0.14);
        const rel = k < 0.38 ? 0 : easeOutCubic((k - 0.38) / 0.14);
        o.ty = -0.38 * coil + 0.45 * rel;
        o.tx = -0.06 * coil + 0.24 * rel;
        o.crouch = 0.06 * rel;
        break;
      }
      case 'summon': {
        const gather = k < 0.22 ? smooth(k / 0.22) : 1 - smooth((k - 0.22) / 0.12);
        const up = smooth((k - 0.22) / 0.16);
        o.crouch = 0.28 * gather - 0.08 * up;
        o.tx = 0.25 * gather - 0.32 * up + (k > 0.4 ? Math.sin(a.t * 37) * 0.015 : 0);
        o.jaw = 0.3 * up;
        break;
      }
      case 'lob': {
        const back = k < 0.4 ? easeInOutSine(k / 0.4) : 1 - smooth((k - 0.4) / 0.2);
        o.crouch = 0.18 * back;
        o.tx = 0.12 * back - 0.05 * smooth((k - 0.45) / 0.2);
        o.ty = -0.2 * back + 0.2 * smooth((k - 0.4) / 0.2);
        break;
      }
      case 'kick': {
        o.crouch = 0.12;
        if (this.kickSide === 0) o.tx = -0.3;
        else o.tz = 0.35 * this.kickSide; // lean away from the kicking side
        o.hipX = -0.04 * this.kickSide;
        break;
      }
      case 'twirl':
        o.ty = -0.15;
        o.tx = -0.05;
        break;
      case 'grapple':
        o.tx = -0.15;
        o.crouch = 0.1;
        break;
      case 'drink': {
        const hold = smooth((k - 0.15) / 0.12) * (1 - smooth((k - 0.7) / 0.1));
        o.tx = -0.14 * hold;
        o.jaw = 0.38 * hold;
        break;
      }
      case 'wrap':
        o.tx = 0.15;
        o.crouch = 0.06;
        break;
      case 'ult': {
        const raise = smooth(k / 0.25);
        const slam = smooth((k - 0.62) / 0.14);
        o.tx = -0.25 * raise * (1 - slam) + 0.5 * slam + (k > 0.3 && k < 0.62 ? Math.sin(a.t * 41) * 0.02 : 0);
        o.crouch = -0.05 * raise + 0.45 * slam;
        o.jaw = 0.35 * raise * (1 - slam);
        break;
      }
    }
    o.crouch *= w;
    o.hipX *= w;
    o.hipZ *= w;
    o.px *= w;
    o.tx *= w;
    o.ty *= w;
    o.tz *= w;
    o.jaw *= w;
  }

  /** limb overrides for the action layer (after the procedural pose) */
  actionPose(name: string, k: number, dur: number, I: PlayerAnimIn) {
    const n = I.rig.nodes, sc = this.scale;
    const w = actionWeight(name, k);
    const SL = this.shL, SR = this.shR;
    const armL = n['arm_l'], foreL = n['fore_l'], armR = n['arm_r'], foreR = n['fore_r'], head = n['head'];
    this.armActR = 0;
    const dirL = this.v4.copy(this.aimT).sub(SL).normalize();
    switch (name) {
      case 'throw': {
        const low = this.v1.set(SL.x + 0.17 * sc, SL.y - 0.38 * sc, SL.z + 0.12 * sc);
        const cock = this.v2.set(SL.x + 0.06 * sc, SL.y + 0.17 * sc, SL.z - 0.22 * sc);
        const relP = this.v3.copy(SL).addScaledVector(dirL, 0.52 * sc);
        relP.y += 0.06 * sc;
        const fol = this.v5.set(SL.x - 0.3 * sc, SL.y - 0.36 * sc, SL.z + 0.24 * sc);
        const T = this.tL;
        if (k < 0.38) T.lerpVectors(low, cock, easeInOutSine(k / 0.38));
        else if (k < 0.5) T.lerpVectors(cock, relP, easeInCubic((k - 0.38) / 0.12));
        else if (k < 0.75) T.lerpVectors(relP, fol, easeOutCubic((k - 0.5) / 0.25));
        else T.copy(fol);
        const pole = this.pL.set(0.7, k < 0.45 ? 0.2 : -0.7, k < 0.45 ? -0.7 : -0.3);
        this.blendArm(armL, foreL, SL, T, pole, w);
        break;
      }
      case 'summon': {
        const up = easeOutBack(clamp01((k - 0.22) / 0.2), 1.4);
        const trem = k > 0.42 ? Math.sin(k * dur * 40) * 0.012 : 0;
        const TLp = this.tL.set(SL.x + lerp(0.06, 0.14, up) * sc, SL.y + lerp(-0.42, 0.52, up) * sc + trem, SL.z + lerp(0.2, 0.12, up) * sc);
        this.blendArm(armL, foreL, SL, TLp, this.pL.set(1, -0.2 + up * 0.2, -0.3), w);
        const TRp = this.tR.set(SR.x - lerp(0.06, 0.14, up) * sc, SR.y + lerp(-0.42, 0.52, up) * sc - trem, SR.z + lerp(0.2, 0.12, up) * sc);
        this.blendArm(armR, foreR, SR, TRp, this.pR.set(-1, -0.2 + up * 0.2, -0.3), w);
        this.armActR = w;
        if (head) head.rotateX(-0.5 * up * w);
        break;
      }
      case 'lob': {
        const low = this.v1.set(SL.x + 0.15 * sc, SL.y - 0.42 * sc, SL.z + 0.1 * sc);
        const back = this.v2.set(SL.x + 0.1 * sc, SL.y - 0.44 * sc, SL.z - 0.24 * sc);
        const relP = this.v3.copy(SL).addScaledVector(dirL, 0.4 * sc);
        const fol = this.v5.copy(SL).addScaledVector(dirL, 0.3 * sc);
        fol.y += 0.3 * sc;
        const T = this.tL;
        if (k < 0.4) T.lerpVectors(low, back, easeInOutSine(k / 0.4));
        else if (k < 0.6) {
          const u = (k - 0.4) / 0.2;
          T.lerpVectors(back, relP, easeInCubic(u));
          T.y -= Math.sin(u * PI) * 0.1 * sc; // underhand arc
        } else if (k < 0.85) T.lerpVectors(relP, fol, easeOutCubic((k - 0.6) / 0.25));
        else T.copy(fol);
        this.blendArm(armL, foreL, SL, T, this.pL.set(0.6, -0.6, -0.4), w);
        break;
      }
      case 'kick': {
        const side = this.kickSide;
        const thigh = n[side === 1 ? 'thigh_l' : 'thigh_r'], shin = n[side === 1 ? 'shin_l' : 'shin_r'];
        // chamber → snap → hold → retract
        const ch = easeOutCubic(k / 0.28);
        const snap = easeOutBack(clamp01((k - 0.28) / 0.14), 2);
        const ret = smooth((k - 0.62) / 0.2);
        const fold = lerp(lerp(0, 1.85, ch), 0.12, snap);
        const knee = lerp(fold, 1.5, ret);
        let tx: number, tz: number;
        if (side === 0) {
          tx = lerp(lerp(0, -1.55, ch), -1.45, snap);
          tx = lerp(tx, -0.9, ret);
          tz = -0.05;
        } else {
          const lift = lerp(lerp(0, 1.0, ch), 1.45, snap);
          tz = lerp(lift, 0.8, ret) * side;
          tx = lerp(-0.4 * ch, -0.15, snap);
        }
        this.blendRot(thigh, tx, 0, tz, w);
        this.blendRot(shin, knee, 0, 0, w);
        // the free arm swings out for balance
        this.blendArm(armL, foreL, SL, this.tL.set(SL.x + 0.38 * sc, SL.y - 0.08 * sc, SL.z - 0.12 * sc), this.pL.set(0.3, -1, -0.2), w * 0.8);
        break;
      }
      case 'twirl': {
        // gun hand out front, the gun spins twice round the trigger finger and is caught
        const TRp = this.tR.set(SR.x - 0.1 * sc, SR.y - 0.2 * sc, SR.z + 0.42 * sc);
        this.blendArm(armR, foreR, SR, TRp, this.pR.set(-0.6, -0.8, -0.1), w);
        this.armActR = w;
        const sp = Math.min(1, k / 0.82);
        this.twirl = -easeOutCubic(sp) * 4 * PI + (k > 0.82 ? wobble((k - 0.82) * dur, 3.5, 7) * 0.25 : 0);
        if (head) {
          lookQuat(this.v6.copy(TRp).sub(this.neck).normalize(), this.v5.set(0, 1, 0), this.qa);
          head.quaternion.slerp(this.qa, w * 0.55);
        }
        break;
      }
      case 'grapple':
        // procedural pose already aims at the hook and grabs the rope; just brace
        break;
      case 'drink': {
        const tilt = smooth((k - 0.15) / 0.15) * (1 - smooth((k - 0.7) / 0.1));
        if (head) {
          head.rotateX(-0.55 * tilt * w);
          head.updateMatrixWorld(true);
        }
        const mouth = I.rig.sockets['mouth'] ?? head;
        if (mouth) {
          mouth.getWorldPosition(this.v6).applyMatrix4(this.mT);
          const T = this.tL;
          if (k < 0.72) T.set(this.v6.x + 0.02, this.v6.y - 0.03, this.v6.z + lerp(0.12, 0.07, smooth((k - 0.1) / 0.12)));
          else {
            const u = clamp01((k - 0.72) / 0.18);
            T.set(this.v6.x + lerp(-0.1, 0.14, easeInOutSine(u)), this.v6.y - 0.03 - u * 0.05, this.v6.z + 0.06);
          }
          this.blendArm(armL, foreL, SL, T, this.pL.set(0.6, -0.8, -0.2), w);
        }
        break;
      }
      case 'wrap': {
        const TRp = this.tR.set(SR.x + 0.12 * sc, SR.y - 0.3 * sc, SR.z + 0.3 * sc);
        this.blendArm(armR, foreR, SR, TRp, this.pR.set(-0.8, -0.6, -0.2), w);
        this.armActR = w;
        // the free hand winds the bandage round the gun forearm
        const fa = this.v1.set(0.6, 0.15, 0.3).normalize();
        const c = this.v2.copy(TRp).addScaledVector(fa, -0.1 * sc);
        const e1 = this.v3.set(0, 1, 0).addScaledVector(fa, -fa.y).normalize();
        const e2 = this.v5.crossVectors(fa, e1);
        const ph = k * TAU * 2.5;
        const T = this.tL.copy(c).addScaledVector(e1, Math.cos(ph) * 0.085 * sc).addScaledVector(e2, Math.sin(ph) * 0.085 * sc);
        this.blendArm(armL, foreL, SL, T, this.pL.set(0.8, -0.5, -0.2), w);
        if (head) head.rotateX(0.4 * w);
        break;
      }
      case 'ult': {
        const raise = easeOutCubic(k / 0.3);
        const slam = easeInCubic(clamp01((k - 0.62) / 0.16));
        const trem = k > 0.3 && k < 0.62 ? Math.sin(k * dur * 45) * 0.012 : 0;
        const TRp = this.tR.set(SR.x + lerp(0, 0.02, slam) * sc, SR.y + lerp(lerp(-0.3, 0.55, raise), -0.22, slam) * sc + trem, SR.z + lerp(lerp(0.2, 0.12, raise), 0.5, slam) * sc);
        this.blendArm(armR, foreR, SR, TRp, this.pR.set(-0.8, lerp(0.2, -0.8, slam), -0.5), w);
        this.armActR = w;
        const TLp = this.tL.set(SL.x + lerp(0.5, 0.3, slam) * sc, SL.y + lerp(0.05, -0.3, slam) * sc - trem, SL.z + lerp(0.05, 0.2, slam) * sc);
        this.blendArm(armL, foreL, SL, TLp, this.pL.set(0.4, -1, -0.3), w);
        if (head) head.rotateX((-0.6 * raise * (1 - slam) + 0.35 * slam) * w);
        break;
      }
    }
  }

  /** gun root (the wrist): reload roll/pitch, recoil snap, the twirl, barrel correction */
  finish(I: PlayerAnimIn) {
    (I.rig as unknown as { itemUse?: (i: PlayerAnimIn, a: unknown) => void }).itemUse?.(I, this); // consumable use overlay (anim/itemUseAnim.ts)
    const g = I.gun.root;
    this.e0.set(this.wristPitch * (1 - this.armActR) + this.twirl, 0, this.wristRoll * (1 - this.armActR));
    g.quaternion.setFromEuler(this.e0);
    if (this.armActR < 0.999) g.quaternion.premultiply(this.qc.identity().slerp(this.qCorr, 1 - this.armActR));
    this.twirl = 0;
    this.armActR = 0;
    I.rig.nodes['arm_r']?.updateMatrixWorld(true);
  }

  private blendArm(arm: THREE.Object3D | undefined, fore: THREE.Object3D | undefined, S: THREE.Vector3, T: THREE.Vector3, pole: THREE.Vector3, w: number) {
    if (!arm || !fore || w <= 0.001) return;
    armIK(S, T, pole, this.l1Arm, this.l2Arm, this.v6.set(0, 0.4, 1), this.qa, this.qb);
    arm.quaternion.slerp(this.qa, w);
    fore.quaternion.slerp(this.qb, w);
  }

  private blendRot(node: THREE.Object3D | undefined, x: number, y: number, z: number, w: number) {
    if (!node || w <= 0.001) return;
    this.qc.setFromEuler(this.e0.set(x, y, z));
    node.quaternion.slerp(this.qc, w);
  }
}

/** quadratic Bézier a → c → b at k, into out */
function bez(ax: number, ay: number, az: number, cx: number, cy: number, cz: number, bx: number, by: number, bz: number, k: number, out: THREE.Vector3) {
  const u = 1 - k;
  return out.set(u * u * ax + 2 * u * k * cx + k * k * bx, u * u * ay + 2 * u * k * cy + k * k * by, u * u * az + 2 * u * k * cz + k * k * bz);
}
