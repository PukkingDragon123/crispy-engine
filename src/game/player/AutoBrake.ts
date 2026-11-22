// Riding up to something you can use (shop, NPC, chest, quest giver: anything in
// run/Interact's list): the board eases to a stop beside it and the camera pans to
// frame it, so stopping is easy. Only when you ride AT it (riding past at an angle
// never grabs you); a kick-push or holding W once you have slowed lets go, and it
// stays let go until you have left that one's zone.
import * as THREE from 'three';
import type { Board } from './Board';
import type { CameraRig } from './CameraRig';
import { clamp, damp, wrapAngle } from '../../engine/math/rand';

export interface BrakeTarget {
  pos: THREE.Vector3;
  radius: number;
  enabled: boolean;
  promptY?: number;
}

export const AUTO_BRAKE = {
  /** the zone reaches this far past the prompt radius (m) */
  reach: 4.5,
  /** heading at it: cos of the angle between travel and the target */
  toward: 0.6,
  /** the hardest it brakes (m/s²) and the speed above which it leaves you alone (m/s) */
  maxDecel: 15,
  maxSpeed: 17,
  /** holding W this long once slowed lets go (s) */
  goHold: 0.55,
  /** camera pan strength (1/s) while the mouse rests */
  pan: 1.8,
};

export class AutoBrake {
  target: BrakeTarget | null = null;
  /** 0..1 engagement */
  w = 0;
  private released: BrakeTarget | null = null;
  private goT = 0;

  /** the extra braking this frame (m/s²); also frames the target on the camera */
  update(dt: number, b: Board, cam: CameraRig, list: BrakeTarget[] | null | undefined, o: { alive: boolean; fz: number; push: boolean; mouseIdle: number; aiming: boolean }) {
    const A = AUTO_BRAKE;
    let best: BrakeTarget | null = null, bd = Infinity;
    if (list && o.alive && !b.offBoard)
      for (const i of list) {
        if (!i.enabled) continue;
        const d = Math.hypot(i.pos.x - b.pos.x, i.pos.z - b.pos.z);
        if (d < i.radius + A.reach && d < bd && Math.abs(i.pos.y - b.pos.y) < 6) {
          bd = d;
          best = i;
        }
      }
    // a let-go target stays let go until you have left its zone
    if (this.released && (!list || !this.released.enabled || Math.hypot(this.released.pos.x - b.pos.x, this.released.pos.z - b.pos.z) > this.released.radius + A.reach + 1)) this.released = null;
    if (best && best === this.released) best = null;
    const spd = b.speed;
    if (best) {
      const dx = best.pos.x - b.pos.x, dz = best.pos.z - b.pos.z;
      const toward = spd > 0.5 ? (b.vel.x * dx + b.vel.z * dz) / (Math.max(1e-3, bd) * spd) : 1;
      const engaged = this.target === best && this.w > 0.3;
      if (spd > A.maxSpeed || b.boosting || (!engaged && bd > best.radius && toward < A.toward)) best = null;
    }
    // he wants to go: a kick-push or W held once slowed
    this.goT = best && spd < 3 && o.fz > 0.3 ? this.goT + dt : 0;
    if (best && ((o.push && spd < 3) || this.goT > A.goHold)) {
      this.released = best;
      best = null;
    }
    this.w = damp(this.w, best ? 1 : 0, best ? 3.2 : 5, dt);
    if (best) this.target = best;
    else if (this.w < 0.02) this.target = null;
    const t = this.target;
    cam.focusW = t ? this.w : 0;
    if (!t) return 0;
    cam.focus.set(t.pos.x, t.pos.y + (t.promptY ?? 1.2) * 0.6, t.pos.z);
    // pan round to it while the mouse rests
    if (o.mouseIdle > 450 && !o.aiming && best) {
      const want = Math.atan2(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
      const k = 1 - Math.exp(-dt * A.pan * this.w);
      cam.nudge(wrapAngle(want - cam.yaw) * k * 0.7, 0);
    }
    if (!best || !b.grounded || spd < 0.15) return 0;
    // ease to a stop a little inside the prompt radius
    const rem = Math.max(0.3, bd - best.radius * 0.45);
    const need = (spd * spd) / (2 * rem);
    return clamp(need * 1.15 + (bd < best.radius ? 2.5 : 0), 0, A.maxDecel) * this.w;
  }
}
