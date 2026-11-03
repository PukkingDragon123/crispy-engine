// Attack envelopes: anticipation (wind-up that builds and trembles at the
// peak), the snap (very fast strike), follow-through (overshoot past the
// strike pose) and the settle back to neutral. Also smooth state blending.
import { clamp01, easeInOutSine, easeOutCubic, smooth, damp } from './math';

export interface AttackPhase {
  /** 0..1 wind-up pose weight (peaks at the end of the wind-up, released at the strike) */
  antic: number;
  /** 0..1 strike pose weight (snaps in within ~60 ms, holds, then decays) */
  strike: number;
  /** signed overshoot past the strike pose (peaks ~0.12 s after the snap) */
  follow: number;
  /** tremble at peak tension (0..1) */
  tension: number;
}

const _ap: AttackPhase = { antic: 0, strike: 0, follow: 0, tension: 0 };

/**
 * state: 'windup' | 'strike' | 'recover' | other; t: seconds in that state.
 * windup: wind-up duration. strikeDur: how long the strike pose lives.
 */
export function attackPhase(state: string, t: number, windup: number, strikeDur = 0.35, out: AttackPhase = _ap): AttackPhase {
  out.antic = 0;
  out.strike = 0;
  out.follow = 0;
  out.tension = 0;
  if (state === 'windup') {
    const k = clamp01(t / Math.max(0.05, windup));
    // slow start, accelerating coil, held at the top
    out.antic = easeInOutSine(Math.min(1, k * 1.15));
    out.tension = smooth((k - 0.65) / 0.35);
  } else if (state === 'strike') {
    const snap = 0.06;
    if (t < snap) {
      const k = t / snap;
      out.antic = 1 - k;
      out.strike = easeOutCubic(k);
    } else {
      const k = clamp01((t - snap) / Math.max(0.05, strikeDur - snap));
      out.strike = 1 - smooth(k);
      // overshoot bump then settle
      out.follow = Math.sin(Math.min(1, k * 2.2) * Math.PI) * (1 - k);
    }
  } else if (state === 'recover') {
    out.strike = Math.max(0, 0.35 - t) / 0.35 * 0.4;
  }
  return out;
}

/** smoothly blended weights for named states (crossfades without pops) */
export class StateBlend<K extends string> {
  w: Record<K, number>;
  constructor(keys: readonly K[], initial: K) {
    this.w = {} as Record<K, number>;
    for (const k of keys) this.w[k] = k === initial ? 1 : 0;
  }
  /** move toward the active state; rate ~ 1/fade time */
  step(active: K, rate: number, dt: number) {
    for (const k in this.w) this.w[k] = damp(this.w[k], k === active ? 1 : 0, rate, dt);
  }
}
