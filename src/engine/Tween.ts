// Tweens, easing and a simple coroutine-style Timeline used by every cinematic.

export const Ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outSine: (t: number) => Math.sin((t * Math.PI) / 2),
  outExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: (t: number) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  inBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  outElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  outBounce: (t: number) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};
export type EaseFn = (t: number) => number;

interface TweenItem {
  t: number;
  dur: number;
  fn: (k: number) => void;
  ease: EaseFn;
  done?: () => void;
  real: boolean;
  delay: number;
  dead?: boolean;
}

/** Tween manager. update(dt, realDt) must be called per frame. */
export class Tweens {
  private items: TweenItem[] = [];
  /** animate a function from 0..1 over duration */
  run(dur: number, fn: (k: number) => void, ease: EaseFn = Ease.outCubic, opts: { real?: boolean; delay?: number; done?: () => void } = {}) {
    const it: TweenItem = { t: 0, dur: Math.max(1e-4, dur), fn, ease, done: opts.done, real: opts.real ?? false, delay: opts.delay ?? 0 };
    this.items.push(it);
    return {
      cancel: () => {
        it.dead = true;
      },
    };
  }
  /** wait (game time unless real) then call */
  after(delay: number, fn: () => void, real = false) {
    return this.run(1e-4, () => {}, Ease.linear, { delay, done: fn, real });
  }
  /** promise version */
  wait(dur: number, real = false) {
    return new Promise<void>((res) => this.after(dur, res, real));
  }
  tween(dur: number, fn: (k: number) => void, ease: EaseFn = Ease.outCubic, real = false) {
    return new Promise<void>((res) => this.run(dur, fn, ease, { real, done: res }));
  }
  update(dt: number, realDt: number) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.dead) continue;
      const step = it.real ? realDt : dt;
      if (it.delay > 0) {
        it.delay -= step;
        if (it.delay > 0) continue;
      }
      it.t += step;
      const k = Math.min(1, it.t / it.dur);
      it.fn(it.ease(k));
      if (k >= 1) {
        it.dead = true;
        it.done?.();
      }
    }
    if (this.items.length > 64) this.items = this.items.filter((x) => !x.dead);
    else {
      let w = 0;
      for (let i = 0; i < this.items.length; i++) if (!this.items[i].dead) this.items[w++] = this.items[i];
      this.items.length = w;
    }
  }
  clear() {
    this.items.length = 0;
  }
}

/** spring-damper helper for juicy secondary motion */
export class Spring {
  v = 0;
  constructor(public x = 0, public k = 120, public d = 14) {}
  update(target: number, dt: number) {
    const a = (target - this.x) * this.k - this.v * this.d;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
  kick(v: number) {
    this.v += v;
  }
}
