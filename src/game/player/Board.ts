// Sandboard physics: push-to-ride momentum on a heightfield.
// - NO free sliding: sand has strong rolling friction, a board at rest stays at
//   rest on any slope, and dunes only nudge a board that is already rolling
// - the rider KICK-PUSHES (PUSH): plant, kick, step back on. A push timed on the
//   beat of the last one is a PERFECT push (streak builds momentum toward a
//   higher cap); mashing gives weak, rushed scuffs; a push right after a clean
//   landing is a LANDING PUSH (big pop)
// - W leans forward (holds speed), S leans back (heel brake), A / D carve
// - drift: hold PUSH through a carve (or press it into a hard carve at speed):
//   the tail slides out, charges, and slings you out when released; JUMP mid-drift
//   is a SPIN LAUNCH (the drift's charge becomes a 180 / 360)
// - charged ollies, crest launches, air control, PUSH+WASD flips/spins with
//   angular momentum, graded landings (perfect / clean / sketchy / bail)
// - unlockable moves (player/Techniques): sand kick (double jump), wall ride,
//   nose manual, dune surf (tucked dune faces feed you speed)
// - cliffs act as walls, colliders bounce / get plowed through
import * as THREE from 'three';
import { Colliders, Collider } from '../world/Colliders';
import { clamp, wrapAngle, dampAngle } from '../../engine/math/rand';

export interface BoardInput {
  /** desired horizontal direction in world space (camera relative WASD), length 0..1 */
  dirX: number;
  dirZ: number;
  /** lean: W forward (+1, holds speed) / S back (-1, heel brake) */
  throttle: number;
  jumpHeld: boolean;
  jumpPressed: boolean;
  jumpReleased: boolean;
  /** drift / trick key held (the PUSH key by default) */
  drift: boolean;
  boost: boolean;
  /** raw WASD for tricks */
  fx: number;
  fz: number;
  /** PUSH pressed this frame: a kick-push */
  push?: boolean;
  /** forward key pressed this frame (double tap = nose manual) */
  fwdTap?: boolean;
}

export interface SurfaceInfo {
  h: number;
  drag: number;
  speedMul: number;
  kind: 'sand' | 'hard' | 'water' | 'mud' | 'grass';
}

export interface BoardEnv {
  surface(x: number, z: number, out: SurfaceInfo): SurfaceInfo;
  normal(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  slope(x: number, z: number): number;
  colliders: Colliders;
}

export interface BoardTuning {
  gravity: number;
  /** pull along slopes on a ROLLING board (never starts one sliding) */
  slopeG: number;
  /** pushes taper off toward this speed (m/s; + perfect-streak bonus) */
  pushSpeed: number;
  /** speed one clean kick-push adds (m/s; scaled by the accel stat) */
  pushAccel: number;
  boostAccel: number;
  boostDrain: number;
  turnRate: number;
  driftTurnRate: number;
  grip: number;
  driftGrip: number;
  jump: number;
  jumpCharge: number;
  airControl: number;
  dragLin: number;
  dragQuad: number;
  /** rolling resistance on sand (m/s²): stops an un-pushed board in a few seconds */
  rolling: number;
  /** top speeds: normal, boosting */
  cap: number;
  boostCap: number;
}

export interface LandingInfo {
  airTime: number;
  spins: number; // half rotations
  flips: number;
  clean: boolean;
  impact: number;
  transition: number;
  trickName: string;
  score: number;
  grab: boolean;
  quality: 'none' | 'perfect' | 'clean' | 'sketchy' | 'bail';
}

export type PushGrade = 'perfect' | 'landing' | 'good' | 'normal' | 'rushed';

/** the kick-push stroke and its rhythm */
export const PUSH = {
  /** full stroke (s): foot off, plant, kick, step back on */
  dur: 0.46,
  /** foot reaches the sand */
  plant: 0.1,
  /** toe-off: the thrust lands between plant and here */
  kickEnd: 0.3,
  /** the beat: ideal gap between two pushes (s) */
  beat: 0.6,
  /** ± window around the beat for a PERFECT push, and a good one */
  perfect: 0.085,
  good: 0.18,
  /** a press this long after a clean landing is a LANDING PUSH */
  landWin: 0.55,
  /** each perfect push in a row lifts the push cap (m/s per step, max steps) */
  streakCap: 0.55,
  streakMax: 4,
};

/** drift entry */
export const DRIFT = {
  /** hold the PUSH key this long through a carve to kick the tail out */
  hold: 0.22,
  minSpeed: 4.5,
};

/** unlockable movement (player/Techniques sets these) */
export interface BoardMoves {
  sandKick: boolean;
  wallRide: boolean;
  manual: boolean;
  duneSurf: boolean;
}

/** slope pull for a tucked board once Dune Surf is learned */
const SURF_G = 8.5;
const UPV = new THREE.Vector3(0, 1, 0);

const smooth01 = (x: number) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

export class Board {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  heading = 0; // board forward yaw (atan2 x,z convention: forward = (sin, cos))
  grounded = true;
  airTime = 0;
  up = new THREE.Vector3(0, 1, 0);
  lean = 0;
  pitchVis = 0;
  drifting = false;
  driftCharge = 0;
  driftDir = 0;
  /** how long the drift key has been held (drift engages after DRIFT.hold) */
  driftHold = 0;
  boostMeter = 0.6;
  boosting = false;
  jumpCharge = 0;
  trickYaw = 0;
  trickPitch = 0;
  /** angular momentum of the trick (rad/s) — flips keep turning after you let go */
  spinYaw = 0;
  spinPitch = 0;
  /** tucked (holding Jump on the ground): less drag, more pull downhill, stiffer steering */
  tucked = false;
  grabbing = false;
  grabTime = 0;
  stumble = 0;
  compress = 0; // landing/charge crouch 0..1
  /** how hard the board is being turned (rad/s), for carve scrub */
  turnSpeed = 0;
  lastSurface: SurfaceInfo = { h: 0, drag: 0, speedMul: 1, kind: 'sand' };
  grapple: { x: number; y: number; z: number; len: number; active: boolean; target?: any } = { x: 0, y: 0, z: 0, len: 0, active: false };
  /** extra external acceleration this frame (knockback, explosions) */
  impulse = new THREE.Vector3();

  // ---- kick-push
  /** time since the current / last push stroke started (s) */
  pushT = 9;
  pushGrade: PushGrade = 'normal';
  /** stroke strength (rushed ≈ 0.3, normal 1, perfect 1.2–1.6, landing push ~1.8) */
  pushPow = 1;
  /** perfect pushes in a row (0..PUSH.streakMax) */
  pushStreak = 0;
  private pushDv = 0;
  private pushAt = -9;
  private pushQueue: PushGrade | null = null;
  private rushes = 0;
  /** open window after a clean landing for a LANDING PUSH */
  private landWin = 0;
  // ---- unlockable moves
  moves: BoardMoves = { sandKick: false, wallRide: false, manual: false, duneSurf: false };
  /** sand kicks left this air */
  airJumps = 1;
  /** time since the last sand kick / board slash (animation) */
  sandKickT = 9;
  slashT = 9;
  /** this air started as a spin launch out of a drift */
  launchSpin = false;
  /** the carve key held through a spin launch doesn't wind the spin until it is let go */
  private spinLock = false;
  /** wall ride state (normal points out of the wall) */
  wall = { on: false, nx: 0, nz: 0, t: 0, c: null as Collider | null };
  private wallCd = 0;
  /** nose manual: balance -1 (tail) .. +1 (nose catches) */
  manual = false;
  manualBal = 0;
  manualT = 0;
  /** riding a dune face tucked with Dune Surf */
  surfing = false;
  /** every landing bumps this (observers poll it instead of wrapping onLand) */
  landSeq = 0;
  lastLand: LandingInfo | null = null;
  private clock = 0;
  private lastFwdTap = -9;
  /** the last drift's charge and when it ended (a jump right after still spin-launches) */
  private driftEndAt = -9;
  private driftEndCharge = 0;
  private driftEndDir = 1;
  private desired = 0;

  // Push-to-ride tune: a board never slides on its own and rolls to a stop in a
  // few seconds; steady pushing cruises ~8 m/s, perfect rhythm ~11, slopes and
  // boost / drift slings / landing pushes top it up toward the caps.
  static readonly BASE: BoardTuning = {
    gravity: 22,
    slopeG: 3.2, // was 12: dunes only nudge a rolling board
    pushSpeed: 11.5,
    pushAccel: 2.9, // now: m/s per clean kick (was the old W-throttle accel)
    boostAccel: 7,
    boostDrain: 0.42,
    turnRate: 3.0,
    driftTurnRate: 4.0,
    grip: 8.5,
    driftGrip: 1.5,
    jump: 7.4,
    jumpCharge: 5.2,
    airControl: 3.2,
    dragLin: 0.12,
    dragQuad: 0.008,
    rolling: 1.6, // was 0.55: sand grabs the board
    cap: 14, // was 22
    boostCap: 17, // was 27
  };
  t: BoardTuning = { ...Board.BASE };
  mobilityMul = 1;
  // events
  onLand?: (l: LandingInfo) => void;
  onJump?: (charged: number, booster: boolean) => void;
  onWall?: (speed: number, nx: number, nz: number) => void;
  onCollide?: (c: Collider, speed: number) => boolean; // return true = plowed through
  onDriftBoost?: (power: number) => void;
  onLaunch?: () => void;
  /** a kick-push started (grade, strength, perfect streak) */
  onPush?: (grade: PushGrade, pow: number, streak: number) => void;
  /** drift-to-jump: half spins it will carry (1 = 180, 2 = 360) */
  onSpinLaunch?: (halfSpins: number, charge: number) => void;
  onSandKick?: () => void;
  /** wall ride start (on) / end (kicked = jumped off it) */
  onWallRide?: (on: boolean, kicked: boolean, time: number) => void;
  /** manual start / end ('clean' | 'pop' | 'scrub' | 'air') */
  onManual?: (on: boolean, how: string, time: number) => void;

  private n = new THREE.Vector3();
  private surf: SurfaceInfo = { h: 0, drag: 0, speedMul: 1, kind: 'sand' };
  private res = { x: 0, z: 0, nx: 0, nz: 0, hit: null as Collider | null };

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  get forward() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }
  /** pushing stroke in progress */
  get pushing() {
    return this.pushT < PUSH.dur;
  }

  place(x: number, y: number, z: number, heading: number) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.heading = heading;
    this.grounded = true;
    this.airTime = 0;
    this.wall.on = false;
    this.manual = false;
  }

  step(dt: number, inp: BoardInput, env: BoardEnv) {
    // a frozen frame (pause): nothing to integrate (the ground-follow divides by dt)
    if (!(dt > 0)) return;
    this.clock += dt;
    this.landWin = Math.max(0, this.landWin - dt);
    this.wallCd = Math.max(0, this.wallCd - dt);
    this.sandKickT += dt;
    this.slashT += dt;
    const hasDir = Math.hypot(inp.dirX, inp.dirZ) > 0.15;
    this.desired = hasDir ? Math.atan2(inp.dirX, inp.dirZ) : this.heading;
    if (inp.push) this.pressPush(inp);
    if (inp.fwdTap) {
      if (this.clock - this.lastFwdTap < 0.3) this.tryManual();
      this.lastFwdTap = this.clock;
    }
    // substeps for stability at high speed
    const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this.sub(h, inp, env, i === 0);
  }

  // ---------------------------------------------------------------- pushing
  private pressPush(inp: BoardInput) {
    if (!this.grounded || this.stumble > 0 || this.wall.on) return;
    const spd = this.speed;
    // pressed into a hard carve at speed: straight into a drift, no kick
    const err = Math.abs(wrapAngle(this.desired - this.heading));
    if (inp.drift && spd >= 6 && err > 0.55 && Math.abs(inp.fx) > 0.1) {
      this.driftHold = DRIFT.hold;
      return;
    }
    if (this.manual) this.endManual('clean');
    const gap = this.clock - this.pushAt;
    let grade: PushGrade;
    if (this.landWin > 0 && this.landWin < PUSH.landWin - 0.04) grade = 'landing';
    else if (gap < PUSH.kickEnd + 0.12) grade = 'rushed';
    else if (Math.abs(gap - PUSH.beat) <= PUSH.perfect) grade = 'perfect';
    else if (Math.abs(gap - PUSH.beat) <= PUSH.good) grade = 'good';
    else grade = 'normal';
    // mid-kick presses wait for the toe-off (mashing just queues weak scuffs)
    if (this.pushT < PUSH.kickEnd) this.pushQueue = grade;
    else this.startPush(grade);
  }

  private startPush(grade: PushGrade) {
    const t = this.t;
    this.landWin = 0;
    let pow = 1;
    if (grade === 'perfect' || grade === 'landing') {
      this.pushStreak = Math.min(PUSH.streakMax, this.pushStreak + 1);
      pow = grade === 'landing' ? 1.65 + 0.08 * this.pushStreak : 1.18 + 0.1 * this.pushStreak;
      this.rushes = 0;
    } else if (grade === 'good') {
      pow = 1.06;
      this.rushes = 0;
    } else if (grade === 'normal') {
      this.pushStreak = 0;
      this.rushes = 0;
    } else {
      this.pushStreak = 0;
      pow = Math.max(0.26, 0.44 - 0.06 * this.rushes);
      this.rushes++;
    }
    const f = this.forward;
    const along = this.vel.x * f.x + this.vel.z * f.z;
    const vcap = (t.pushSpeed + this.pushStreak * PUSH.streakCap + (grade === 'landing' ? 1.2 : 0)) * this.mobilityMul * this.lastSurface.speedMul;
    const taper = clamp((vcap - Math.max(0, along)) / (vcap * 0.45), 0, 1);
    this.pushDv = t.pushAccel * pow * taper + (grade === 'landing' ? 0.8 : 0);
    this.pushPow = pow;
    this.pushGrade = grade;
    this.pushAt = this.clock;
    this.pushT = 0;
    this.pushQueue = null;
    this.onPush?.(grade, pow, this.pushStreak);
  }

  // ------------------------------------------------------------- nose manual
  private tryManual() {
    if (this.manual) {
      this.endManual('clean');
      return;
    }
    if (!this.moves.manual || !this.grounded || this.stumble > 0 || this.drifting || this.wall.on || this.speed < 3.5) return;
    this.manual = true;
    this.manualT = 0;
    this.manualBal = 0.12;
    this.pushT = Math.max(this.pushT, PUSH.dur);
    this.pushQueue = null;
    this.onManual?.(true, 'start', 0);
  }
  private endManual(how: 'clean' | 'pop' | 'scrub' | 'air') {
    if (!this.manual) return;
    this.manual = false;
    if (how === 'scrub') {
      this.stumble = Math.max(this.stumble, 0.25);
      this.vel.x *= 0.85;
      this.vel.z *= 0.85;
    }
    this.onManual?.(false, how, this.manualT);
  }

  // -------------------------------------------------------------- wall ride
  /** try to stick to a wall whose outward normal is (nx, nz) */
  private startWall(nx: number, nz: number, c: Collider | null) {
    if (!this.moves.wallRide || this.wall.on || this.wallCd > 0 || this.stumble > 0) return false;
    const vn = this.vel.x * nx + this.vel.z * nz;
    const tx = this.vel.x - nx * vn, tz = this.vel.z - nz * vn;
    const ts = Math.hypot(tx, tz);
    if (ts < 4.5) return false; // head-on: no ride, just a wall
    const ns = Math.min(ts + Math.abs(Math.min(0, vn)) * 0.45, this.t.cap);
    this.vel.x = (tx / ts) * ns;
    this.vel.z = (tz / ts) * ns;
    this.vel.y = Math.max(this.vel.y, 2.8);
    if (this.manual) this.endManual('air');
    this.grounded = false;
    this.drifting = false;
    this.driftCharge = 0;
    this.wall.on = true;
    this.wall.nx = nx;
    this.wall.nz = nz;
    this.wall.t = 0;
    this.wall.c = c;
    this.heading = Math.atan2(tx, tz);
    this.trickYaw = this.trickPitch = 0;
    this.spinYaw = this.spinPitch = 0;
    this.onWallRide?.(true, false, 0);
    return true;
  }

  private endWall(kicked: boolean) {
    const w = this.wall;
    if (!w.on) return;
    w.on = false;
    this.wallCd = 0.4;
    if (kicked) {
      this.vel.x += w.nx * 6.2;
      this.vel.z += w.nz * 6.2;
      this.vel.y = Math.max(this.vel.y, 0) + 7.4;
      this.airJumps = 1;
      this.airTime = 0;
      this.launchSpin = false;
    } else {
      this.vel.x += w.nx * 1.6;
      this.vel.z += w.nz * 1.6;
      this.airTime = 0;
    }
    this.onWallRide?.(false, kicked, w.t);
  }

  /** a wall is still beside the board */
  private wallThere(env: BoardEnv) {
    const w = this.wall;
    const px = this.pos.x - w.nx * 0.9, pz = this.pos.z - w.nz * 0.9;
    if (env.surface(px, pz, this.surf).h > this.pos.y + 0.6) return true;
    if (w.c) {
      const r = env.colliders.resolve(this.pos.x - w.nx * 0.45, this.pos.z - w.nz * 0.45, this.pos.y, 1.8, 0.45, this.res);
      if (r.hit && r.hit.y1 > this.pos.y + 0.5) return true;
    }
    return false;
  }

  private wallStep(dt: number, inp: BoardInput, env: BoardEnv, first: boolean) {
    const t = this.t, w = this.wall;
    w.t += dt;
    this.airTime += dt;
    if (inp.jumpPressed && first) {
      this.endWall(true);
      return;
    }
    // hug the wall: kill the outward drift, lean gently into it
    const vn = this.vel.x * w.nx + this.vel.z * w.nz;
    this.vel.x -= w.nx * (vn + 0.6);
    this.vel.z -= w.nz * (vn + 0.6);
    const sp = this.speed;
    if (sp > 1e-3) {
      const ns = Math.max(0, sp - (0.7 + t.dragQuad * sp * sp) * dt);
      this.vel.x *= ns / sp;
      this.vel.z *= ns / sp;
    }
    // weightless at first, then the wall lets go
    this.vel.y -= t.gravity * (w.t < 0.75 ? 0.22 : 0.22 + (w.t - 0.75) * 2.2) * dt;
    this.heading = dampAngle(this.heading, Math.atan2(this.vel.x, this.vel.z), 10, dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    // never inside the rock: step back out along the normal
    for (let k = 0; k < 8 && env.surface(this.pos.x, this.pos.z, this.surf).h > this.pos.y + 0.08; k++) {
      this.pos.x += w.nx * 0.08;
      this.pos.z += w.nz * 0.08;
    }
    if (w.c) {
      const r = env.colliders.resolve(this.pos.x, this.pos.z, this.pos.y, 1.8, 0.45, this.res);
      if (r.hit) {
        this.pos.x += r.x;
        this.pos.z += r.z;
      }
    }
    // board stands on the wall face
    this.up.lerp(this.n.set(w.nx * 0.9, 0.55, w.nz * 0.9).normalize(), Math.min(1, dt * 14)).normalize();
    this.lean += (0 - this.lean) * Math.min(1, dt * 8);
    const g = env.surface(this.pos.x, this.pos.z, this.surf);
    if (this.pos.y <= g.h && this.vel.y <= 0.5) {
      this.endWall(false);
      this.pos.y = g.h;
      this.land(env, g);
      return;
    }
    if (!this.wallThere(env) || w.t > 1.3 || this.speed < 3.2) this.endWall(false);
  }

  // ------------------------------------------------------------------ step
  private sub(dt: number, inp: BoardInput, env: BoardEnv, first: boolean) {
    const t = this.t;
    const mob = this.mobilityMul;
    const s = env.surface(this.pos.x, this.pos.z, this.surf);
    this.lastSurface = s;
    const spd = this.speed;
    const fwd = this.forward;
    const hasDir = Math.hypot(inp.dirX, inp.dirZ) > 0.15;
    const desired = this.desired;

    // ------------------------------------------------------------ boost
    this.boosting = inp.boost && this.boostMeter > 0.01 && this.stumble <= 0;
    if (this.boosting) this.boostMeter = Math.max(0, this.boostMeter - t.boostDrain * dt);

    // ------------------------------------------------------------ push stroke clock
    const pt0 = this.pushT;
    this.pushT += dt;
    if (this.pushQueue && this.pushT >= PUSH.kickEnd && this.grounded) this.startPush(this.pushQueue);

    // external impulses
    if (this.impulse.lengthSq() > 0 && first) {
      this.vel.add(this.impulse);
      if (this.impulse.y > 2 && (this.grounded || this.wall.on)) {
        if (this.wall.on) this.endWall(false);
        this.grounded = false;
        this.pos.y += 0.05;
        this.airJumps = 1;
      }
      this.impulse.set(0, 0, 0);
    }

    if (this.wall.on) {
      this.wallStep(dt, inp, env, first);
    } else if (this.grounded) {
      env.normal(this.pos.x, this.pos.z, this.n);
      if (this.n.y < 0.5) {
        // standing on a sheer face (crept into a cliff): it's a wall, step back off it
        const hl = Math.hypot(this.n.x, this.n.z) || 1;
        const wx = this.n.x / hl, wz = this.n.z / hl;
        const into = -(this.vel.x * wx + this.vel.z * wz);
        if (into > 0) {
          this.vel.x += wx * into * 1.2;
          this.vel.z += wz * into * 1.2;
        }
        this.pos.x += wx * 0.04;
        this.pos.z += wz * 0.04;
      }
      // slope gravity (horizontal space): only on a board that is already rolling
      // the world normal is (-hx, 1, -hz)/l, so downhill (-grad h) is (n.x, n.z) / n.y
      const gx = this.n.x / Math.max(0.2, this.n.y), gz = this.n.z / Math.max(0.2, this.n.y);
      const s2 = gx * gx + gz * gz;
      this.tucked = inp.jumpHeld && this.stumble <= 0 && !this.manual;
      const rollK = smooth01((spd - 0.6) / 1.9);
      const surf = this.tucked && this.moves.duneSurf;
      const pull = (surf ? SURF_G : t.slopeG * (this.tucked ? 1.25 : 1)) * rollK;
      this.vel.x += ((pull * gx) / (1 + s2)) * dt;
      this.vel.z += ((pull * gz) / (1 + s2)) * dt;
      const downhill = spd > 1e-3 ? (gx * this.vel.x + gz * this.vel.z) / spd : 0;
      this.surfing = surf && downhill > 0.12 && spd > 4;

      // push thrust: lands through the kick (cancelled if the board leaves the sand)
      if (pt0 < PUSH.kickEnd && this.pushT > PUSH.plant && this.pushDv > 0) {
        const span = PUSH.kickEnd - PUSH.plant;
        const k = smooth01((this.pushT - PUSH.plant) / span) - smooth01((pt0 - PUSH.plant) / span);
        this.vel.x += fwd.x * this.pushDv * k;
        this.vel.z += fwd.z * this.pushDv * k;
      }

      // steering
      if (this.stumble <= 0) {
        const errA = wrapAngle(desired - this.heading);
        const carving = Math.abs(inp.fx) > 0.1 || Math.abs(errA) > 0.35;
        this.driftHold = inp.drift ? this.driftHold + dt : 0;
        const canStart = this.driftHold >= DRIFT.hold && this.pushT >= PUSH.kickEnd && carving && spd > DRIFT.minSpeed && !this.manual;
        const drifting = inp.drift && (this.drifting ? spd > 2.5 : canStart);
        if (drifting && !this.drifting) this.driftDir = Math.sign(errA) || this.driftDir || 1;
        if (!drifting && this.drifting) {
          this.driftEndAt = this.clock;
          this.driftEndCharge = this.driftCharge;
          this.driftEndDir = this.driftDir || 1;
          // release drift charge as a sling
          if (this.driftCharge > 0.25) {
            const p = Math.min(1, this.driftCharge / 2.2);
            const add = 0.9 + p * 2.6;
            this.vel.x += fwd.x * add;
            this.vel.z += fwd.z * add;
            this.boostMeter = Math.min(1, this.boostMeter + p * 0.12);
            this.onDriftBoost?.(p);
          }
          this.driftCharge = 0;
        }
        this.drifting = drifting;
        const spdK = clamp(spd / t.cap, 0, 1);
        const rate = (drifting ? t.driftTurnRate : t.turnRate * (1 - spdK * 0.4) * (this.tucked ? 0.55 : 1)) * (0.8 + 0.2 * mob) * (this.manual ? 0.7 : 1);
        const h0 = this.heading;
        if (hasDir) this.heading = dampAngle(this.heading, desired, rate, dt * 1.0);
        this.turnSpeed = Math.abs(wrapAngle(this.heading - h0)) / Math.max(1e-4, dt);
        if (drifting) {
          this.driftCharge += dt * clamp(spd / 12, 0.35, 1.4) * (0.6 + Math.abs(wrapAngle(Math.atan2(this.vel.x, this.vel.z) - this.heading)));
        }
        if (this.boosting) {
          this.vel.x += fwd.x * t.boostAccel * dt;
          this.vel.z += fwd.z * t.boostAccel * dt;
        }
      } else {
        this.drifting = false;
        this.driftCharge = 0;
      }
      // nose manual: an unstable balance you keep with W / S
      if (this.manual) {
        this.manualT += dt;
        const ctl = inp.throttle > 0.1 ? 1 : inp.throttle < -0.1 ? -1 : 0;
        const c = this.clock;
        const wob = Math.sin(c * 2.3) * 0.5 + Math.sin(c * 5.7 + 1.3) * 0.28 + Math.sin(c * 11.1 + 0.4) * 0.12;
        this.manualBal += (1.35 * this.manualBal + 0.5 * wob + 1.9 * ctl + this.turnSpeed * 0.12 * Math.sign(this.manualBal || 1)) * dt;
        if (Math.abs(this.manualBal) > 1) this.endManual('scrub');
        else if (spd < 2) this.endManual('clean');
      }
      // carving: rotate lateral velocity into heading (keeps momentum)
      {
        const along = this.vel.x * fwd.x + this.vel.z * fwd.z;
        const latX = this.vel.x - fwd.x * along, latZ = this.vel.z - fwd.z * along;
        const lat = Math.hypot(latX, latZ);
        const grip = (this.drifting ? t.driftGrip : t.grip) * (s.kind === 'water' ? 0.5 : 1);
        const keep = Math.exp(-grip * dt);
        const removed = lat * (1 - keep);
        // smooth carves keep their momentum; yanking the board around scrubs it
        const eff = this.drifting ? 0.62 : 0.95 - 0.42 * clamp(this.turnSpeed / 2.6, 0, 1);
        const before = Math.hypot(this.vel.x, this.vel.z);
        this.vel.x = fwd.x * (along + Math.sign(along || 1) * removed * eff) + latX * keep;
        this.vel.z = fwd.z * (along + Math.sign(along || 1) * removed * eff) + latZ * keep;
        // a carve redirects momentum, it never creates it (sideways shoves are not free speed)
        const after = Math.hypot(this.vel.x, this.vel.z);
        if (after > before && after > 1e-6) {
          this.vel.x *= before / after;
          this.vel.z *= before / after;
        }
        // if moving backwards relative to the board for long, flip heading (fakie -> regular)
        if (along < -2 && !hasDir) this.heading = wrapAngle(this.heading + Math.PI);
      }
      // rolling resistance + drag: sand grabs the board; W leans forward (rolls on),
      // S sits back on the heel edge (brakes), a tuck or a manual glides
      const sp = this.speed;
      if (sp > 1e-4) {
        const lean = this.manual ? 0 : clamp(inp.throttle, -1, 1);
        const kindK = s.kind === 'hard' ? 0.55 : s.kind === 'grass' ? 1.2 : s.kind === 'mud' ? 1.8 : s.kind === 'water' ? 1.3 : 1;
        let roll = t.rolling * kindK * (lean > 0 ? 1 - 0.42 * lean : 1);
        if (this.tucked) roll *= this.surfing ? 0.45 : 0.7;
        if (this.manual) roll *= 0.12;
        let dec = roll + t.dragLin * sp * (this.manual ? 0.4 : 1) + t.dragQuad * sp * sp * (this.tucked || this.manual ? 0.5 : 1) + s.drag * sp;
        if (lean < 0) dec += 6.5 * -lean * clamp(sp / 3, 0.4, 1);
        if (this.boosting) dec *= 0.5;
        const ns = Math.max(0, sp - dec * dt);
        this.vel.x *= ns / sp;
        this.vel.z *= ns / sp;
      }
      // jump charge / release
      if (inp.jumpHeld) this.jumpCharge = Math.min(1, this.jumpCharge + dt / 0.5);
      this.compress = Math.max(this.compress * Math.exp(-6 * dt), this.jumpCharge * 0.8);
      if (inp.jumpReleased && first && this.stumble <= 0) {
        const charge = this.jumpCharge;
        const booster = this.boosting && this.boostMeter > 0.2;
        const coyote = !this.drifting && this.clock - this.driftEndAt < 0.14;
        const dCharge = this.drifting ? this.driftCharge : coyote ? this.driftEndCharge : 0;
        const dDir = this.drifting ? this.driftDir || 1 : this.driftEndDir;
        const launch = dCharge > 0.12;
        this.driftEndAt = -9;
        let jv = (t.jump + charge * t.jumpCharge) * (0.9 + 0.1 * mob) * (s.kind === 'water' ? 0.75 : 1);
        if (this.manual) {
          jv *= 1.12; // nollie pop off the nose
          this.endManual('pop');
        }
        if (booster) {
          jv += 6.5;
          this.boostMeter = Math.max(0, this.boostMeter - 0.22);
        }
        if (launch) jv += 1.2;
        this.vel.y = Math.max(this.vel.y, 0) + jv * (0.8 + 0.2 * this.n.y);
        this.vel.x += this.n.x * jv * 0.25;
        this.vel.z += this.n.z * jv * 0.25;
        this.grounded = false;
        this.pos.y += 0.05;
        this.airTime = 0;
        this.airJumps = 1;
        this.trickYaw = this.trickPitch = 0;
        this.spinYaw = this.spinPitch = 0;
        this.jumpCharge = 0;
        this.tucked = false;
        this.drifting = false;
        this.driftCharge = 0;
        this.launchSpin = launch;
        if (launch) {
          // drift-to-jump: the slide's momentum whips the board round — sized so an
          // untouched launch lands a clean 180 (a long drift: 360) on flat sand
          const half = dCharge > 1.1 ? 2 : 1;
          const T = Math.max(0.35, (2 * this.vel.y) / t.gravity);
          const k = 3.2;
          this.spinYaw = ((dDir * half * Math.PI * k) / (1 - Math.exp(-k * T))) * 1.02;
          this.spinLock = Math.abs(inp.fx) > 0.1;
          this.onSpinLaunch?.(half, dCharge);
        }
        this.onJump?.(charge, booster);
        this.applyGrapple(dt);
        return;
      }
      if (!inp.jumpHeld) this.jumpCharge = 0;

      this.applyGrapple(dt);
      // integrate horizontal and follow ground (launch if ground falls away faster than free fall)
      const ox = this.pos.x, oz = this.pos.z, oy = this.pos.y;
      let nx = ox + this.vel.x * dt, nz = oz + this.vel.z * dt;
      // walls (steep rock ahead)
      const hNew = env.surface(nx, nz, this.surf).h;
      const rise = hNew - oy;
      const dist = Math.hypot(nx - ox, nz - oz) || 1e-6;
      if (rise / dist > 1.6 && rise > 0.015) {
        // hit cliff: slide along it
        const gx2 = (env.surface(nx + 0.3, nz, this.surf).h - env.surface(nx - 0.3, nz, this.surf).h) / 0.6;
        const gz2 = (env.surface(nx, nz + 0.3, this.surf).h - env.surface(nx, nz - 0.3, this.surf).h) / 0.6;
        const gl = Math.hypot(gx2, gz2) || 1;
        const wx = gx2 / gl, wz = gz2 / gl; // uphill direction = into wall
        const into = this.vel.x * wx + this.vel.z * wz;
        if (into > 0) {
          // crouched into it at speed: pop up onto the wall
          if (inp.jumpHeld && this.speed >= 7 && this.startWall(-wx, -wz, null)) {
            this.pos.y += 0.25;
            this.jumpCharge = 0;
            return;
          }
          this.vel.x -= wx * into * 1.25;
          this.vel.z -= wz * into * 1.25;
          this.vel.x *= 0.88;
          this.vel.z *= 0.88;
          if (into > 10) this.stumble = 0.45;
          this.onWall?.(into, -wx, -wz);
        }
        nx = ox + this.vel.x * dt;
        nz = oz + this.vel.z * dt;
      }
      const hn = env.surface(nx, nz, this.surf).h;
      const vyFollow = (hn - oy) / dt;
      const vyNat = this.vel.y - t.gravity * dt;
      if (vyFollow < vyNat - 0.45 && this.speed > 6) {
        // launch off crest
        this.grounded = false;
        this.airTime = 0;
        this.airJumps = 1;
        this.launchSpin = false;
        this.trickYaw = this.trickPitch = 0;
        this.spinYaw = this.spinPitch = 0;
        this.drifting = false;
        this.driftCharge = 0;
        if (this.manual) this.endManual('air');
        this.pos.set(nx, oy + this.vel.y * dt, nz);
        this.onLaunch?.();
      } else {
        this.pos.set(nx, hn, nz);
        this.vel.y = clamp(vyFollow, -40, 16);
      }
    } else {
      // ----------------------------------------------------------- airborne
      this.airTime += dt;
      this.drifting = false;
      this.driftCharge = 0;
      this.surfing = false;
      this.vel.y -= t.gravity * dt;
      // sand kick: a second hop off a burst of sand (unlockable)
      if (inp.jumpPressed && first && this.moves.sandKick && this.airJumps > 0 && this.airTime > 0.08 && this.stumble <= 0) {
        this.airJumps = 0;
        this.vel.y = Math.max(this.vel.y * 0.3, 0) + 6.4 * (0.9 + 0.1 * mob);
        const kx = hasDir ? inp.dirX : fwd.x, kz = hasDir ? inp.dirZ : fwd.z;
        this.vel.x += kx * 1.6;
        this.vel.z += kz * 1.6;
        this.sandKickT = 0;
        this.onSandKick?.();
      }
      // air control (horizontal), unless tricking
      const trick = inp.drift;
      if (!trick && hasDir) {
        this.vel.x += inp.dirX * t.airControl * dt;
        this.vel.z += inp.dirZ * t.airControl * dt;
        this.heading = dampAngle(this.heading, desired, 2.0, dt);
      }
      // flips and spins have momentum: holding a direction winds the spin up,
      // letting go it keeps turning and bleeds off — commit early, time the stop.
      // D spins clockwise (to the right), A counter-clockwise.
      const spinRate = 7.2 * (0.85 + 0.15 * mob);
      const wind = 1 - Math.exp(-9 * dt), bleed = Math.exp(-3.2 * dt);
      if (this.spinLock && Math.abs(inp.fx) < 0.1) this.spinLock = false;
      const sfx = this.spinLock ? 0 : inp.fx;
      if (trick && this.stumble <= 0) {
        const ty = -sfx * spinRate, tp = inp.fz * spinRate * 0.95;
        this.spinYaw = Math.abs(sfx) > 0.1 ? this.spinYaw + (ty - this.spinYaw) * wind : this.spinYaw * bleed;
        this.spinPitch = Math.abs(inp.fz) > 0.1 ? this.spinPitch + (tp - this.spinPitch) * wind : this.spinPitch * bleed;
        this.grabbing = Math.abs(inp.fx) < 0.1 && Math.abs(inp.fz) < 0.1;
        if (this.grabbing) this.grabTime += dt;
      } else {
        this.spinYaw *= bleed;
        this.spinPitch *= bleed;
        this.grabbing = false;
      }
      this.trickYaw += this.spinYaw * dt;
      this.trickPitch += this.spinPitch * dt;
      if (this.boosting) {
        const f = this.forward;
        this.vel.x += f.x * t.boostAccel * 0.4 * dt;
        this.vel.z += f.z * t.boostAccel * 0.4 * dt;
        this.vel.y += 3 * dt;
      }
      // light air drag
      const sp = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
      const k = Math.exp(-(0.02 + 0.0009 * sp) * dt);
      this.vel.multiplyScalar(k);
      this.applyGrapple(dt);
      const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
      let ny = this.pos.y + this.vel.y * dt;
      const gh = env.surface(nx, nz, this.surf).h;
      // wall check in air
      const gh0 = env.surface(this.pos.x, this.pos.z, this.surf).h;
      if (gh - this.pos.y > 1.2 && gh - gh0 > 1.2) {
        // a cliff face: ride it (Wall Ride), else slam and bounce back
        const ex = (env.surface(nx + 0.5, nz, this.surf).h - env.surface(nx - 0.5, nz, this.surf).h) / 1.0;
        const ez = (env.surface(nx, nz + 0.5, this.surf).h - env.surface(nx, nz - 0.5, this.surf).h) / 1.0;
        const el = Math.hypot(ex, ez) || 1;
        if (!this.startWall(-ex / el, -ez / el, null)) {
          this.vel.x *= -0.25;
          this.vel.z *= -0.25;
          this.onWall?.(this.speed, 0, 0);
        }
      } else {
        this.pos.x = nx;
        this.pos.z = nz;
      }
      if (!this.wall.on) {
        const g2 = env.surface(this.pos.x, this.pos.z, this.surf);
        if (ny <= g2.h) {
          // a near-vertical face is a wall to ride, not a floor to land on
          if (env.normal(this.pos.x, this.pos.z, this.n).y < 0.5) {
            const hl = Math.hypot(this.n.x, this.n.z) || 1;
            const wx = this.n.x / hl, wz = this.n.z / hl;
            if (!this.startWall(wx, wz, null)) {
              // a sheer face is never a floor: bounce off it and keep falling
              const into = -(this.vel.x * wx + this.vel.z * wz);
              if (into > 0) {
                this.vel.x += wx * into * 1.25;
                this.vel.z += wz * into * 1.25;
              }
              this.pos.x += wx * 0.06;
              this.pos.z += wz * 0.06;
              ny = Math.max(ny, this.pos.y);
            }
          } else if (this.vel.y <= 0.5) {
            ny = g2.h;
            this.land(env, g2);
          }
        }
        if (!this.wall.on) {
          this.pos.y = ny;
          if (this.grounded) this.pos.y = g2.h;
        }
      }
    }

    // ------------------------------------------------------------- colliders
    if (!this.wall.on) {
      const r = env.colliders.resolve(this.pos.x, this.pos.z, this.pos.y, 1.8, 0.45, this.res);
      if (r.hit) {
        const into = -(this.vel.x * r.nx + this.vel.z * r.nz);
        const plowed = into > 0 && this.onCollide ? this.onCollide(r.hit, into) : false;
        if (!plowed) {
          this.pos.x += r.x;
          this.pos.z += r.z;
          const tall = r.hit.y1 - this.pos.y > 1.0;
          if (into > 0 && tall && (!this.grounded || inp.jumpHeld) && this.speed >= 6.5 && this.startWall(r.nx, r.nz, r.hit)) {
            if (this.grounded) this.pos.y += 0.25;
            this.jumpCharge = 0;
          } else if (into > 0) {
            this.vel.x += r.nx * into * 1.2;
            this.vel.z += r.nz * into * 1.2;
            if (into > 11) this.stumble = Math.max(this.stumble, 0.5);
          }
        } else {
          this.vel.x *= 0.88;
          this.vel.z *= 0.88;
        }
      }
    }

    // visuals
    if (!this.wall.on) {
      const latSign = this.drifting ? this.driftDir : 0;
      const turnLean = clamp(wrapAngle(desired - this.heading) * (this.grounded ? 1 : 0.3), -1, 1) * clamp(this.speed / 12, 0, 1);
      this.lean += (turnLean * 0.5 + latSign * 0.35 - this.lean) * Math.min(1, dt * 8);
      if (this.grounded) {
        env.normal(this.pos.x, this.pos.z, this.n);
        this.up.lerp(this.n, Math.min(1, dt * 12)).normalize();
      } else {
        this.up.lerp(UPV, Math.min(1, dt * 2)).normalize();
      }
    }
    if (this.stumble > 0) this.stumble -= dt;
    // cap absurd speeds
    const cap = (this.boosting ? t.boostCap : t.cap) * (0.85 + 0.15 * mob);
    const sp2 = this.speed;
    if (sp2 > cap) {
      this.vel.x *= cap / sp2;
      this.vel.z *= cap / sp2;
    }
  }

  private applyGrapple(dt: number) {
    const g = this.grapple;
    if (!g.active) return;
    const dx = g.x - this.pos.x, dy = g.y - (this.pos.y + 1.2), dz = g.z - this.pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return;
    const ux = dx / d, uy = dy / d, uz = dz / d;
    g.len = Math.max(2.5, g.len - 16 * dt);
    // pull acceleration + rope constraint
    const pull = 30;
    this.vel.x += ux * pull * dt;
    this.vel.y += uy * pull * dt + (this.grounded ? 0 : 6 * dt);
    this.vel.z += uz * pull * dt;
    if (d > g.len) {
      const outward = -(this.vel.x * ux + this.vel.y * uy + this.vel.z * uz);
      if (outward > 0) {
        this.vel.x += ux * outward;
        this.vel.y += uy * outward;
        this.vel.z += uz * outward;
      }
    }
    if (this.grounded && uy > 0.25) {
      if (this.manual) this.endManual('air');
      this.grounded = false;
      this.pos.y += 0.1;
      this.vel.y = Math.max(this.vel.y, 4);
    }
  }

  private land(env: BoardEnv, s: SurfaceInfo) {
    void s;
    const air = this.airTime;
    env.normal(this.pos.x, this.pos.z, this.n);
    const impact = -(this.vel.x * this.n.x + this.vel.y * this.n.y + this.vel.z * this.n.z);
    // transition: downslope landing converts vertical speed into forward speed
    const slopeAlong = (this.n.x * this.vel.x + this.n.z * this.vel.z) / Math.max(1, Math.hypot(this.vel.x, this.vel.z));
    const transition = clamp(slopeAlong * 2.5, 0, 1);
    const halfSpins = Math.round(Math.abs(this.trickYaw) / Math.PI);
    const flips = Math.round(Math.abs(this.trickPitch) / (Math.PI * 2));
    const yawErr = Math.abs(wrapAngle(this.trickYaw - halfSpins * Math.PI * Math.sign(this.trickYaw || 1)));
    const pitchErr = Math.abs(wrapAngle(this.trickPitch));
    // still spinning hard at touchdown makes it worse
    const spinErr = (Math.abs(this.spinPitch) + Math.abs(this.spinYaw)) * 0.035;
    const err = Math.max(pitchErr / 0.85, yawErr / 0.8) + spinErr;
    const tried = halfSpins > 0 || flips > 0 || Math.abs(this.trickYaw) > 0.9 || pitchErr > 0.6;
    let quality: LandingInfo['quality'] = 'none';
    if (this.stumble > 0) quality = tried ? 'bail' : 'none';
    else if (err < 0.36) quality = tried || air > 1.2 ? 'perfect' : 'none';
    else if (err < 0.78) quality = 'clean';
    else if (err < 1.12) quality = 'sketchy';
    else quality = tried ? 'bail' : 'sketchy';
    const clean = quality === 'perfect' || quality === 'clean' || (quality === 'none' && !tried);
    const grab = this.grabTime > 0.35;
    let score = 0;
    let name = '';
    const f = this.forward;
    if (clean || quality === 'sketchy') {
      const parts: string[] = [];
      if (this.launchSpin && halfSpins > 0) parts.push('Spin Launch');
      if (grab) parts.push(this.grabTime > 1 ? 'Long Tail Grab' : 'Tail Grab');
      if (halfSpins > 0) parts.push(String(halfSpins * 180));
      if (flips > 0) parts.push(flips === 1 ? (this.trickPitch > 0 ? 'Frontflip' : 'Backflip') : flips === 2 ? 'Double Flip' : `${flips}x Flip`);
      if (air > 1.6 && !parts.length) parts.push('Big Air');
      name = parts.join(' ');
      score = Math.round(halfSpins * 120 + flips * 300 + (grab ? 80 + this.grabTime * 60 : 0) + Math.max(0, air - 0.6) * 90 + (this.launchSpin && halfSpins > 0 ? 60 : 0));
      if (quality === 'perfect' && name) {
        name = 'PERFECT ' + name;
        score = Math.round(score * 1.5);
      } else if (quality === 'sketchy' && name) {
        name = 'Sketchy ' + name;
        score = Math.round(score * 0.5);
      }
    }
    if (quality === 'bail') {
      this.stumble = 0.8;
      this.vel.x *= 0.45;
      this.vel.z *= 0.45;
      this.pushStreak = 0;
      name = 'BAIL';
    } else {
      if (transition > 0.05) {
        const add = Math.max(0, -this.vel.y) * transition * (quality === 'perfect' ? 0.6 : 0.45);
        this.vel.x += f.x * add;
        this.vel.z += f.z * add;
      }
      if (quality === 'perfect') {
        // stomped it: a kick of speed and boost
        this.vel.x += f.x * 1.4;
        this.vel.z += f.z * 1.4;
      } else if (quality === 'sketchy') {
        this.vel.x *= 0.8;
        this.vel.z *= 0.8;
        this.stumble = Math.max(this.stumble, 0.22);
      }
      if (impact > 24 && transition < 0.3) {
        this.stumble = Math.max(this.stumble, 0.35);
        this.vel.x *= 0.8;
        this.vel.z *= 0.8;
      }
      if (score > 0) this.boostMeter = Math.min(1, this.boostMeter + Math.min(0.5, score / 1200));
      // a clean landing opens the LANDING PUSH window
      if (quality !== 'sketchy' && (score > 0 || quality === 'perfect' || air > 0.55)) this.landWin = PUSH.landWin;
    }
    this.grounded = true;
    this.vel.y = 0;
    this.compress = clamp(impact / 18, 0.15, 1);
    this.airJumps = 1;
    // align heading with landed spin (half spins land fakie -> flip heading)
    if (halfSpins % 2 === 1) this.heading = wrapAngle(this.heading + Math.PI);
    const info: LandingInfo = { airTime: air, spins: halfSpins, flips, clean, impact, transition, trickName: name, score, grab, quality };
    this.lastLand = info;
    this.landSeq++;
    this.onLand?.(info);
    this.trickYaw = this.trickPitch = 0;
    this.spinYaw = this.spinPitch = 0;
    this.grabTime = 0;
    this.airTime = 0;
    this.launchSpin = false;
    this.spinLock = false;
  }
}
