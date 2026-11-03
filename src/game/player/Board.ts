// Sandboard physics: arcade-real momentum on a heightfield.
// - slope gravity in horizontal space (a = -G * grad / (1 + |grad|^2))
// - carving keeps speed (lateral velocity rotates into heading), drifting slides
//   and charges a mini-boost, boost meter, charged ollies, booster jumps
// - physically-motivated crest launches (ground falls faster than free fall)
// - air control, Shift+WASD flips/spins with angular momentum, graded landings
//   (perfect / clean / sketchy / bail) + transition bonus
// - deliberately slow on the flat: speed comes from the dunes. Tuck (hold Jump)
//   down a face to gain speed, pop at the lip for big air, carve smoothly (hard
//   turns scrub speed)
// - cliffs act as walls, colliders bounce / get plowed through
import * as THREE from 'three';
import { Colliders, Collider } from '../world/Colliders';
import { clamp, wrapAngle, dampAngle } from '../../engine/math/rand';

export interface BoardInput {
  /** desired horizontal direction in world space (camera relative WASD), length 0..1 */
  dirX: number;
  dirZ: number;
  throttle: number; // forward intent -1..1
  jumpHeld: boolean;
  jumpPressed: boolean;
  jumpReleased: boolean;
  drift: boolean;
  boost: boolean;
  /** raw WASD for tricks */
  fx: number;
  fz: number;
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
  /** pull along slopes (lower than air gravity so dunes feel weighty, not slippery) */
  slopeG: number;
  pushSpeed: number;
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
  static readonly BASE: BoardTuning = {
    gravity: 22,
    slopeG: 15,
    pushSpeed: 7.5,
    pushAccel: 5.5,
    boostAccel: 12,
    boostDrain: 0.42,
    turnRate: 3.0,
    driftTurnRate: 4.2,
    grip: 8.5,
    driftGrip: 1.4,
    jump: 7.4,
    jumpCharge: 5.2,
    airControl: 4.5,
    dragLin: 0.05,
    dragQuad: 0.0026,
    rolling: 0.55,
    cap: 30,
    boostCap: 36,
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

  private n = new THREE.Vector3();
  private surf: SurfaceInfo = { h: 0, drag: 0, speedMul: 1, kind: 'sand' };
  private res = { x: 0, z: 0, nx: 0, nz: 0, hit: null as Collider | null };

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  get forward() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }

  place(x: number, y: number, z: number, heading: number) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.heading = heading;
    this.grounded = true;
    this.airTime = 0;
  }

  step(dt: number, inp: BoardInput, env: BoardEnv) {
    // substeps for stability at high speed
    const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this.sub(h, inp, env, i === 0);
  }

  private sub(dt: number, inp: BoardInput, env: BoardEnv, first: boolean) {
    const t = this.t;
    const mob = this.mobilityMul;
    const s = env.surface(this.pos.x, this.pos.z, this.surf);
    this.lastSurface = s;
    const spd = this.speed;
    const fwd = this.forward;
    const hasDir = Math.hypot(inp.dirX, inp.dirZ) > 0.15;
    const desired = hasDir ? Math.atan2(inp.dirX, inp.dirZ) : this.heading;

    // ------------------------------------------------------------ boost
    this.boosting = inp.boost && this.boostMeter > 0.01 && this.stumble <= 0;
    if (this.boosting) this.boostMeter = Math.max(0, this.boostMeter - t.boostDrain * dt);

    // external impulses
    if (this.impulse.lengthSq() > 0 && first) {
      this.vel.add(this.impulse);
      if (this.impulse.y > 2 && this.grounded) {
        this.grounded = false;
        this.pos.y += 0.05;
      }
      this.impulse.set(0, 0, 0);
    }

    if (this.grounded) {
      env.normal(this.pos.x, this.pos.z, this.n);
      // slope gravity (horizontal space)
      const gx = -this.n.x / Math.max(0.2, this.n.y), gz = -this.n.z / Math.max(0.2, this.n.y); // = -grad h
      const s2 = gx * gx + gz * gz;
      this.tucked = inp.jumpHeld && this.stumble <= 0;
      const pull = t.slopeG * (this.tucked ? 1.18 : 1);
      this.vel.x += (pull * gx) / (1 + s2) * dt;
      this.vel.z += (pull * gz) / (1 + s2) * dt;

      // steering
      if (this.stumble <= 0) {
        const drifting = inp.drift && spd > 6;
        if (drifting && !this.drifting) this.driftDir = Math.sign(wrapAngle(desired - this.heading)) || this.driftDir || 1;
        if (!drifting && this.drifting) {
          // release drift charge as mini boost
          if (this.driftCharge > 0.25) {
            const p = Math.min(1, this.driftCharge / 2.2);
            const add = 3 + p * 8;
            this.vel.x += fwd.x * add;
            this.vel.z += fwd.z * add;
            this.boostMeter = Math.min(1, this.boostMeter + p * 0.12);
            this.onDriftBoost?.(p);
          }
          this.driftCharge = 0;
        }
        this.drifting = drifting;
        const spdK = clamp(spd / 30, 0, 1);
        const rate = (drifting ? t.driftTurnRate : t.turnRate * (1 - spdK * 0.4)) * (0.8 + 0.2 * mob) * (this.tucked ? 0.55 : 1);
        const h0 = this.heading;
        if (hasDir) this.heading = dampAngle(this.heading, desired, rate, dt * 1.0);
        this.turnSpeed = Math.abs(wrapAngle(this.heading - h0)) / Math.max(1e-4, dt);
        if (drifting) {
          this.driftCharge += dt * clamp(spd / 18, 0.3, 1.6) * (0.6 + Math.abs(wrapAngle(Math.atan2(this.vel.x, this.vel.z) - this.heading)));
        }
        // push / brake
        const along = this.vel.x * fwd.x + this.vel.z * fwd.z;
        if (inp.throttle > 0.1 || (hasDir && inp.throttle >= 0)) {
          const cap = t.pushSpeed * mob * s.speedMul;
          if (along < cap) {
            const k = 1 - clamp(along / cap, 0, 1);
            const a = t.pushAccel * mob * (0.35 + 0.65 * k);
            this.vel.x += fwd.x * a * dt;
            this.vel.z += fwd.z * a * dt;
          }
        } else if (inp.throttle < -0.1) {
          const bk = Math.min(spd, 18 * dt);
          if (spd > 0.01) {
            this.vel.x -= (this.vel.x / spd) * bk;
            this.vel.z -= (this.vel.z / spd) * bk;
          }
        }
        if (this.boosting) {
          this.vel.x += fwd.x * t.boostAccel * dt;
          this.vel.z += fwd.z * t.boostAccel * dt;
        }
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
        const eff = this.drifting ? 0.25 : 0.95 - 0.42 * clamp(this.turnSpeed / 2.6, 0, 1);
        this.vel.x = fwd.x * (along + Math.sign(along || 1) * removed * eff) + latX * keep;
        this.vel.z = fwd.z * (along + Math.sign(along || 1) * removed * eff) + latZ * keep;
        // if moving backwards relative to the board for long, flip heading (fakie -> regular)
        if (along < -2 && !hasDir) this.heading = wrapAngle(this.heading + Math.PI);
      }
      // drag + rolling resistance
      const sp = this.speed;
      if (sp > 1e-4) {
        let dec = t.dragLin * sp + t.dragQuad * sp * sp + t.rolling + s.drag * sp;
        if (this.tucked) dec *= 0.5;
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
        let jv = (t.jump + charge * t.jumpCharge) * (0.9 + 0.1 * mob) * (s.kind === 'water' ? 0.75 : 1);
        if (booster) {
          jv += 6.5;
          this.boostMeter = Math.max(0, this.boostMeter - 0.22);
        }
        this.vel.y = Math.max(this.vel.y, 0) + jv * (0.8 + 0.2 * this.n.y);
        this.vel.x += this.n.x * jv * 0.25;
        this.vel.z += this.n.z * jv * 0.25;
        this.grounded = false;
        this.pos.y += 0.05;
        this.airTime = 0;
        this.trickYaw = this.trickPitch = 0;
        this.spinYaw = this.spinPitch = 0;
        this.jumpCharge = 0;
        this.tucked = false;
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
      if (rise / dist > 1.6 && rise > 0.35) {
        // hit cliff: slide along it
        const gx2 = (env.surface(nx + 0.3, nz, this.surf).h - env.surface(nx - 0.3, nz, this.surf).h) / 0.6;
        const gz2 = (env.surface(nx, nz + 0.3, this.surf).h - env.surface(nx, nz - 0.3, this.surf).h) / 0.6;
        const gl = Math.hypot(gx2, gz2) || 1;
        const wx = gx2 / gl, wz = gz2 / gl; // uphill direction = into wall
        const into = this.vel.x * wx + this.vel.z * wz;
        if (into > 0) {
          this.vel.x -= wx * into * 1.25;
          this.vel.z -= wz * into * 1.25;
          this.vel.x *= 0.88;
          this.vel.z *= 0.88;
          if (into > 14) this.stumble = 0.45;
          this.onWall?.(into, -wx, -wz);
        }
        nx = ox + this.vel.x * dt;
        nz = oz + this.vel.z * dt;
      }
      const hn = env.surface(nx, nz, this.surf).h;
      const vyFollow = (hn - oy) / dt;
      const vyNat = this.vel.y - t.gravity * dt;
      if (vyFollow < vyNat - 0.45 && this.speed > 8) {
        // launch off crest
        this.grounded = false;
        this.airTime = 0;
        this.trickYaw = this.trickPitch = 0;
        this.spinYaw = this.spinPitch = 0;
        this.pos.set(nx, oy + this.vel.y * dt, nz);
        this.onLaunch?.();
      } else {
        this.pos.set(nx, hn, nz);
        this.vel.y = clamp(vyFollow, -40, 40);
      }
    } else {
      // ----------------------------------------------------------- airborne
      this.airTime += dt;
      this.drifting = false;
      this.driftCharge = 0;
      this.vel.y -= t.gravity * dt;
      // air control (horizontal), unless tricking
      const trick = inp.drift;
      if (!trick && hasDir) {
        this.vel.x += inp.dirX * t.airControl * dt;
        this.vel.z += inp.dirZ * t.airControl * dt;
        this.heading = dampAngle(this.heading, desired, 2.0, dt);
      }
      // flips and spins have momentum: holding a direction winds the spin up,
      // letting go it keeps turning and bleeds off — commit early, time the stop
      const spinRate = 7.2 * (0.85 + 0.15 * mob);
      const wind = 1 - Math.exp(-9 * dt), bleed = Math.exp(-3.2 * dt);
      if (trick && this.stumble <= 0) {
        const ty = inp.fx * spinRate, tp = inp.fz * spinRate * 0.95;
        this.spinYaw = Math.abs(inp.fx) > 0.1 ? this.spinYaw + (ty - this.spinYaw) * wind : this.spinYaw * bleed;
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
        // slammed into cliff face: bounce back horizontally
        this.vel.x *= -0.25;
        this.vel.z *= -0.25;
        this.onWall?.(this.speed, 0, 0);
      } else {
        this.pos.x = nx;
        this.pos.z = nz;
      }
      const g2 = env.surface(this.pos.x, this.pos.z, this.surf);
      if (ny <= g2.h && this.vel.y <= 0.5) {
        ny = g2.h;
        this.land(env, g2);
      }
      this.pos.y = ny;
      if (this.grounded) this.pos.y = g2.h;
    }

    // ------------------------------------------------------------- colliders
    const r = env.colliders.resolve(this.pos.x, this.pos.z, this.pos.y, 1.8, 0.45, this.res);
    if (r.hit) {
      const into = -(this.vel.x * r.nx + this.vel.z * r.nz);
      const plowed = into > 0 && this.onCollide ? this.onCollide(r.hit, into) : false;
      if (!plowed) {
        this.pos.x += r.x;
        this.pos.z += r.z;
        if (into > 0) {
          this.vel.x += r.nx * into * 1.2;
          this.vel.z += r.nz * into * 1.2;
          if (into > 16) this.stumble = Math.max(this.stumble, 0.5);
        }
      } else {
        this.vel.x *= 0.88;
        this.vel.z *= 0.88;
      }
    }

    // visuals
    const latSign = this.drifting ? this.driftDir : 0;
    const turnLean = clamp(wrapAngle(desired - this.heading) * (this.grounded ? 1 : 0.3), -1, 1) * clamp(this.speed / 20, 0, 1);
    this.lean += (turnLean * 0.5 + latSign * 0.35 - this.lean) * Math.min(1, dt * 8);
    if (this.grounded) {
      env.normal(this.pos.x, this.pos.z, this.n);
      this.up.lerp(this.n, Math.min(1, dt * 12)).normalize();
    } else {
      this.up.lerp(new THREE.Vector3(0, 1, 0), Math.min(1, dt * 2)).normalize();
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
      this.grounded = false;
      this.pos.y += 0.1;
      this.vel.y = Math.max(this.vel.y, 4);
    }
  }

  private land(env: BoardEnv, s: SurfaceInfo) {
    const air = this.airTime;
    env.normal(this.pos.x, this.pos.z, this.n);
    const impact = -(this.vel.x * this.n.x + this.vel.y * this.n.y + this.vel.z * this.n.z);
    // transition: downslope landing converts vertical speed into forward speed
    const slopeAlong = -(this.n.x * this.vel.x + this.n.z * this.vel.z) / Math.max(1, Math.hypot(this.vel.x, this.vel.z));
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
      if (grab) parts.push(this.grabTime > 1 ? 'Long Tail Grab' : 'Tail Grab');
      if (halfSpins > 0) parts.push(String(halfSpins * 180));
      if (flips > 0) parts.push(flips === 1 ? (this.trickPitch > 0 ? 'Frontflip' : 'Backflip') : flips === 2 ? 'Double Flip' : `${flips}x Flip`);
      if (air > 1.6 && !parts.length) parts.push('Big Air');
      name = parts.join(' ');
      score = Math.round(halfSpins * 120 + flips * 300 + (grab ? 80 + this.grabTime * 60 : 0) + Math.max(0, air - 0.6) * 90);
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
      name = 'BAIL';
    } else {
      if (transition > 0.05) {
        const add = Math.max(0, -this.vel.y) * transition * (quality === 'perfect' ? 0.9 : 0.7);
        this.vel.x += f.x * add;
        this.vel.z += f.z * add;
      }
      if (quality === 'perfect') {
        // stomped it: a kick of speed and boost
        this.vel.x += f.x * 2.6;
        this.vel.z += f.z * 2.6;
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
    }
    this.grounded = true;
    this.vel.y = 0;
    this.compress = clamp(impact / 18, 0.15, 1);
    // align heading with landed spin (half spins land fakie -> flip heading)
    if (halfSpins % 2 === 1) this.heading = wrapAngle(this.heading + Math.PI);
    this.onLand?.({ airTime: air, spins: halfSpins, flips, clean, impact, transition, trickName: name, score, grab, quality });
    this.trickYaw = this.trickPitch = 0;
    this.spinYaw = this.spinPitch = 0;
    this.grabTime = 0;
    this.airTime = 0;
  }
}
