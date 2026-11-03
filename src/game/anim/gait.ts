// Gait generators. A leg cycle splits into stance (foot planted, sliding back
// relative to the hip at exactly body speed, so it never skates) and swing
// (foot lifts and arcs forward). Patterns give each leg a phase offset.
import { PI, TAU } from './math';

export interface LegSample {
  /** foot fore/aft position relative to the hip, -1 (behind) .. +1 (ahead) */
  sweep: number;
  /** 0 on the ground, 1 at the top of the swing arc */
  lift: number;
  /** true while the foot is planted */
  stance: boolean;
  /** progress within the current stance or swing, 0..1 */
  u: number;
}

const _s: LegSample = { sweep: 0, lift: 0, stance: true, u: 0 };

/** evaluate a leg at cycle phase p (any real number, 1 = one full cycle) with duty factor (fraction planted) */
export function leg(p: number, duty = 0.6, out: LegSample = _s): LegSample {
  let f = p - Math.floor(p);
  if (f < duty) {
    const u = f / duty;
    out.stance = true;
    out.u = u;
    out.sweep = 1 - 2 * u;
    out.lift = 0;
  } else {
    const u = (f - duty) / (1 - duty);
    out.stance = false;
    out.u = u;
    // eased return: fast through the middle, soft at the ends
    out.sweep = -Math.cos(u * PI);
    // asymmetric lift: snaps up early, lowers gently
    out.lift = Math.sin(Math.pow(u, 0.8) * PI);
  }
  void f;
  return out;
}

/** phase offsets (fraction of a cycle) for common gaits */
export const GAITS = {
  biped: { l: 0, r: 0.5 },
  /** diagonal pairs */
  trot: { fl: 0, br: 0.02, fr: 0.5, bl: 0.52 },
  /** rotary gallop: back pair then front pair, each slightly split */
  gallop: { bl: 0, br: 0.12, fl: 0.48, fr: 0.6 },
  /** lateral-sequence walk */
  walk4: { bl: 0, fl: 0.25, br: 0.5, fr: 0.75 },
  /** insect alternating tripod */
  tripod: { l1: 0, r2: 0, l3: 0, r1: 0.5, l2: 0.5, r3: 0.5 },
  /** arachnid alternating tetrapod with a metachronal ripple */
  tetrapod: { l1: 0, r2: 0.04, l3: 0.08, r4: 0.12, r1: 0.5, l2: 0.54, r3: 0.58, l4: 0.62 },
} as const;

/** cycle frequency (cycles/s) so that a stance of `duty` covers 2*amp meters at `speed` m/s */
export function cycleRate(speed: number, amp: number, duty: number) {
  if (amp < 1e-4) return 0;
  return (speed * duty) / (2 * amp);
}

/** body vertical bob for a biped: two dips per cycle (each foot strike) */
export function bipedBob(p: number) {
  return Math.cos(p * TAU * 2);
}
