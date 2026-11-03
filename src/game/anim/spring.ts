// Springs for secondary motion. Parameterised by frequency (Hz) and damping
// ratio (zeta): zeta=1 critically damped (no overshoot), <1 overshoots and
// jiggles, >1 sluggish. Sub-steps large dt so slow frames never explode.

export class SpringF {
  x: number;
  v = 0;
  constructor(x = 0, public freq = 3, public zeta = 0.6) {
    this.x = x;
  }
  /** advance toward target; returns the new value */
  step(target: number, dt: number) {
    const w = this.freq * Math.PI * 2;
    let left = Math.min(dt, 0.1);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      const a = w * w * (target - this.x) - 2 * this.zeta * w * this.v;
      this.v += a * h;
      this.x += this.v * h;
      left -= h;
    }
    return this.x;
  }
  /** instant velocity impulse (hits, landings, recoil) */
  kick(v: number) {
    this.v += v;
  }
  set(x: number) {
    this.x = x;
    this.v = 0;
  }
}

/** three independent springs (angles or offsets) */
export class Spring3 {
  x: SpringF;
  y: SpringF;
  z: SpringF;
  constructor(freq = 3, zeta = 0.6) {
    this.x = new SpringF(0, freq, zeta);
    this.y = new SpringF(0, freq, zeta);
    this.z = new SpringF(0, freq, zeta);
  }
  step(tx: number, ty: number, tz: number, dt: number) {
    this.x.step(tx, dt);
    this.y.step(ty, dt);
    this.z.step(tz, dt);
  }
  kick(x: number, y: number, z: number) {
    this.x.kick(x);
    this.y.kick(y);
    this.z.kick(z);
  }
}

/**
 * Lagging follower for chains (tails, antennae, hair, scarves): each link
 * springs toward the previous link's angle, producing a whip-like wave.
 */
export class ChainFollower {
  links: SpringF[];
  constructor(n: number, freq = 4, zeta = 0.45) {
    this.links = Array.from({ length: n }, (_, i) => new SpringF(0, freq * (1 - i * 0.08), zeta));
  }
  /** drive the root angle; links inherit with lag. Returns the per-link local angle (delta from parent) */
  step(rootTarget: number, dt: number, out: number[]) {
    let prev = rootTarget;
    for (let i = 0; i < this.links.length; i++) {
      const l = this.links[i];
      l.step(prev, dt);
      out[i] = l.x;
      prev = l.x;
    }
    // convert absolute to per-link deltas
    for (let i = this.links.length - 1; i > 0; i--) out[i] = out[i] - out[i - 1];
    return out;
  }
}
