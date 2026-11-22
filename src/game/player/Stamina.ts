// STAMINA: the rider's wind. Sundown (and Mark) carry a pool of it (player.stamina / player.staminaMax,
// live numbers the HUD's poison-liquid vessel reads). Speed is not free any more:
//   - riding fast drains it (from ~9 m/s up, steeper near the cap), carving hard, drifting, dune surfing and
//     boosting drain more; every kick-push costs a sip (a perfect beat costs less, mashing costs more)
//   - jumps cost a chunk (more with charge), the SHIFT long jump costs more with its charge, the sand kick,
//     wall kick, board-slide dodge and air tricks cost some; every shot a little; skills a lot
//   - the ultimate is free (it is earned by its own charge)
//   - it refills after a short pause (the pause depends on what was spent), fastest standing or coasting
//     slowly, slowest at full speed or in the air
//   - empty: he is WINDED until the vessel is back to RECOVER: no jumps, dodges or skills, the gun's hammer
//     comes back slower, the board's cap closes in and the balance gets wobblier
// Early ranks pay less (costs ease in over the first bounty ranks); the tutorial domain shelters him (cheap
// costs, quick refill, never winded). Cards raise the staminaMax / staminaRegen stats and set the hooks below.
// Run bus events: 'staminaLow', 'staminaEmpty', 'staminaRecovered', 'staminaDenied' (kind), 'staminaSpend' (kind, amount).
// The curves below are pure functions (node-checked).
import type { Ctx } from '../Ctx';
import type { BoardInput, PushGrade } from './Board';
import type { Player } from './Player';

export type StaminaSpend = 'jump' | 'long' | 'longStart' | 'kick' | 'wall' | 'trick' | 'dodge' | 'skill';

export const STAMINA = {
  /** the low warning (share of max), re-armed above lowFrac + 0.1 */
  lowFrac: 0.3,
  /** winded until the vessel is back to this share */
  recoverFrac: 0.35,
  // ---- continuous drains (per second, at full cost)
  /** riding fast: ride * x^1.3, x = (speed - rideFrom) / rideSpan (capped at rideMax) */
  ride: 8,
  rideFrom: 8.5,
  rideSpan: 5.5,
  rideMax: 1.15,
  /** a hard carve at speed */
  carve: 4,
  drift: 6,
  /** dune surfing (tucked, downhill); the refill runs at surfRegen while he surfs */
  surf: 4,
  surfRegen: 0.4,
  boost: 6,
  /** Mark's glide (jump held in the air) */
  glide: 8,
  // ---- one-off costs
  push: 1.2,
  pushPerfect: 0.8,
  pushRushed: 2,
  /** ground jump: jump + jumpCharge * charge */
  jump: 11,
  jumpCharge: 7,
  /** the SHIFT long jump: long + longCharge * charge */
  long: 15,
  longCharge: 25,
  kick: 10,
  wall: 8,
  trick: 5,
  dodge: 12,
  shot: 1.4,
  shotFan: 1,
  shotLong: 1.3,
  shotMark: 1.8,
  skill: { E: 16, C: 20, G: 14, X: 24 } as Record<string, number>,
  /** Mark's spells cost this share of Sundown's */
  markSkill: 0.9,
  /** the ultimate: free (earned by its own charge) */
  ult: 0,
  // ---- pauses before the refill starts (s), by what was spent
  delay: { push: 0.2, shot: 0.3, jump: 0.75, long: 1, longStart: 0, kick: 0.8, wall: 0.7, trick: 0.6, dodge: 0.8, skill: 1.1, cont: 0.45, empty: 1 } as Record<string, number>,
  /** the refill eases back in over this long after a pause */
  ramp: 0.25,
  // ---- refill (per second): standing / coasting slow, at full speed, in the air
  regenStand: 30,
  regenFast: 6,
  regenAir: 6,
  regenFrom: 2,
  regenSpan: 10,
  /** winded: the refill runs this much faster (he is just breathing) */
  regenWinded: 1.3,
  // ---- winded
  /** the board's speed caps close in to this share */
  capMul: 0.72,
  /** fire rate while winded */
  fireMul: 0.6,
  /** balance disturbance: x(1 + wobble) winded, x(1 + wobble * lowWobble) as it runs low */
  wobble: 0.8,
  lowWobble: 0.4,
  // ---- early game: costs ease in over the first bounty ranks
  ease0: 0.6,
  easePerRank: 0.07,
  // ---- the tutorial domain (SerketDomain): cheap costs, quick refill, never winded
  shelterCost: 0.3,
  shelterRegen: 2.5,
  shelterFloor: 0.35,
};

const S = STAMINA;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth01 = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** riding drain (per second) at this speed */
export function rideDrain(spd: number) {
  const x = clamp((spd - S.rideFrom) / S.rideSpan, 0, S.rideMax);
  return x > 0 ? S.ride * Math.pow(x, 1.3) : 0;
}

/** carving drain (per second): how hard the board is turned (rad/s) at speed */
export function carveDrain(spd: number, turn: number) {
  return S.carve * clamp(turn / 2.4, 0, 1) * clamp((spd - 5) / 7, 0, 1);
}

/** refill (per second) before stats and pauses: fastest standing, slowest at speed or in the air */
export function regenRate(spd: number, grounded: boolean) {
  if (!grounded) return S.regenAir;
  return S.regenStand + (S.regenFast - S.regenStand) * smooth01((spd - S.regenFrom) / S.regenSpan);
}

/** cost scale over the first bounty ranks (0.6 at rank 0, full by rank 6) */
export function easeMul(rank: number) {
  return Math.min(1, S.ease0 + S.easePerRank * Math.max(0, rank || 0));
}

/** a one-off cost at full price (charge 0..1 for the jumps, the skill key for 'skill') */
export function spendCost(kind: StaminaSpend, charge = 0, skill = 'E', mark = false) {
  switch (kind) {
    case 'jump': return S.jump + S.jumpCharge * clamp(charge, 0, 1);
    case 'long': return S.long + S.longCharge * clamp(charge, 0, 1);
    case 'longStart': return 0;
    case 'kick': return S.kick;
    case 'wall': return S.wall;
    case 'trick': return S.trick;
    case 'dodge': return S.dodge;
    case 'skill': return (S.skill[skill] ?? S.skill.E) * (mark ? S.markSkill : 1);
  }
}

export function pushCost(g: PushGrade) {
  return g === 'perfect' || g === 'landing' ? S.pushPerfect : g === 'rushed' ? S.pushRushed : S.push;
}

/** what gets blocked while winded ('trick' is never blocked: it only costs) */
const GATED = new Set<StaminaSpend>(['jump', 'long', 'longStart', 'kick', 'wall', 'dodge', 'skill']);

export class Stamina {
  /** winded: the vessel ran dry and is not yet back to recoverFrac */
  exhausted = false;
  /** 0..1 how tired he reads (1 winded; rises as it runs low): for the HUD and the body */
  tired = 0;
  /** 0..1 a flash when something was refused for want of wind (decays) */
  denied = 0;
  /** speed-cap share now (eases toward capMul while winded) */
  capMul = 1;
  /** fire-rate share now */
  fireMul = 1;
  /** the tutorial domain's shelter (SerketDomain sets and restores it) */
  shelter = false;
  /** card hooks (run/UpgradesBuilds): stamina refilled per kill, the jump costs' scale */
  killRefill = 0;
  jumpCostMul = 1;
  private lock = 0;
  private ready = 1;
  private lowArmed = true;
  private lastPushT = 9;
  private baseCap: number;
  private baseBoostCap: number;
  private denyCd = 0;
  private toastT = -999;
  private offs: (() => void)[] = [];

  constructor(private ctx: Ctx, private p: Player) {
    this.baseCap = p.board.t.cap;
    this.baseBoostCap = p.board.t.boostCap;
    this.syncMax(true);
    p.board.spend = (kind, charge) => this.spend(kind, charge);
    const ev = ctx.events;
    this.offs.push(
      ev.on('shot', () => this.onShot()),
      ev.on('skillCast', (k: string) => this.pay('skill', spendCost('skill', 0, k, !!p.kit))),
      ev.on('enemyKilled', () => {
        if (this.killRefill > 0 && p.alive) this.add(this.killRefill);
      }),
    );
    if (typeof window !== 'undefined') (window as unknown as { __stamina?: Stamina }).__stamina = this;
  }

  get frac() {
    return this.p.staminaMax > 0 ? this.p.stamina / this.p.staminaMax : 0;
  }

  /** cost scale now: the early ranks, the shelter */
  costMul() {
    return easeMul(this.ctx.run?.rank ?? 0) * (this.shelter ? S.shelterCost : 1);
  }

  /** can he do this now (winded blocks jumps, dodges and skills) */
  can(kind: StaminaSpend) {
    return !(this.exhausted && GATED.has(kind));
  }

  /** Skills.tryCast asks here first; a refusal flashes the vessel */
  canCast() {
    if (this.can('skill')) return true;
    this.deny('skill');
    return false;
  }

  /**
   * pay for a move (the board calls this through board.spend): false = refused (winded), nothing done.
   * A move he cannot quite afford still goes, and leaves him winded.
   */
  spend(kind: StaminaSpend, charge = 0) {
    if (!this.p.alive) return true;
    if (!this.can(kind)) {
      this.deny(kind);
      return false;
    }
    let c = spendCost(kind, charge, 'E', !!this.p.kit);
    if (kind === 'jump' || kind === 'long' || kind === 'kick' || kind === 'wall') c *= this.jumpCostMul;
    this.pay(kind, c);
    return true;
  }

  /** add wind back (cards, pickups, a refill) */
  add(v: number) {
    const p = this.p;
    p.stamina = Math.min(p.staminaMax, p.stamina + v);
  }

  refill() {
    this.p.stamina = this.p.staminaMax;
    if (this.exhausted) this.recover();
  }

  /** before Board.step: winded = no boost, a closing speed cap, a wobblier board, no glide */
  preBoard(dt: number, bi: BoardInput) {
    const p = this.p, b = p.board;
    this.syncMax(false);
    if (this.exhausted) {
      bi.boost = false;
      // Mark's glide is the jump held in the air
      if (p.kit && !b.grounded) bi.jumpHeld = false;
    }
    const want = this.exhausted ? S.capMul : 1;
    this.capMul += (want - this.capMul) * (1 - Math.exp(-(want < this.capMul ? 1.6 : 3) * Math.max(0, dt)));
    b.t.cap = this.baseCap * this.capMul;
    b.t.boostCap = this.baseBoostCap * this.capMul;
    const lowK = clamp((S.lowFrac - this.frac) / S.lowFrac, 0, 1);
    const tiredT = this.exhausted ? 1 : lowK * S.lowWobble;
    this.tired += (tiredT - this.tired) * (1 - Math.exp(-4 * Math.max(0, dt)));
    b.balanceAssist *= 1 + S.wobble * this.tired;
    this.fireMul = this.exhausted ? S.fireMul : 1;
  }

  /** after Board.step: the drains and the refill */
  update(dt: number) {
    if (!(dt > 0)) return;
    const p = this.p, b = p.board;
    this.denied = Math.max(0, this.denied - dt * 2.5);
    this.denyCd -= dt;
    if (!p.alive) {
      this.lastPushT = b.pushT;
      this.refill();
      return;
    }
    // a kick-push started (the stroke clock went back to 0)
    if (b.pushT < this.lastPushT && !this.exhausted) this.pay('push', pushCost(b.pushGrade));
    this.lastPushT = b.pushT;
    const spd = b.speed;
    const ground = b.grounded || b.wall.on;
    let drain = 0;
    let heavy = false;
    if (!this.exhausted && !b.offBoard) {
      if (ground) {
        drain += rideDrain(spd) + carveDrain(spd, b.turnSpeed);
        if (b.surfing) drain += S.surf;
        if (b.drifting) {
          drain += S.drift;
          heavy = true;
        }
      }
      if (b.boosting) {
        drain += S.boost;
        heavy = true;
      }
      if ((p.kit as { gliding?: boolean } | null)?.gliding && !b.grounded) {
        drain += S.glide;
        heavy = true;
      }
    }
    drain *= this.costMul();
    if (heavy) this.lock = Math.max(this.lock, S.delay.cont);
    this.lock -= dt;
    this.ready = this.lock > 0 ? 0 : Math.min(1, this.ready + dt / S.ramp);
    const regen = regenRate(spd, ground || b.offBoard) * this.regenMul() * this.ready * (this.exhausted ? S.regenWinded : b.surfing ? S.surfRegen : 1);
    p.stamina = clamp(p.stamina + (regen - drain) * dt, 0, p.staminaMax);
    this.settle();
  }

  /** the staminaRegen stat, the early ranks (a little quicker), the shelter */
  regenMul() {
    const ease = easeMul(this.ctx.run?.rank ?? 0);
    return Math.max(0.2, this.p.stats.get('staminaRegen')) * (1 + (1 - ease) * 0.5) * (this.shelter ? S.shelterRegen : 1);
  }

  dispose() {
    for (const o of this.offs) o();
    this.offs.length = 0;
    if (this.p.board.spend) this.p.board.spend = undefined;
  }

  // ---------------------------------------------------------------- internals
  private onShot() {
    const p = this.p;
    if (!p.alive) return;
    // winded: the hammer comes back slower (every gun sets fireCd right before it fires)
    this.fireMul = this.exhausted ? S.fireMul : 1;
    if (this.fireMul < 1 && p.fireCd > 0) p.fireCd /= this.fireMul;
    if (this.exhausted) return;
    const c = p.kit ? S.shotMark : p.weapons?.isLong ? S.shotLong : p.fanning ? S.shotFan : S.shot;
    this.pay('shot', c * this.costMul(), true);
  }

  /** take `amount` (already scaled when `scaled`), pause the refill by the kind's delay */
  private pay(kind: string, amount: number, scaled = false) {
    const p = this.p;
    if (!p.alive || this.exhausted) return;
    const c = scaled ? amount : amount * this.costMul();
    if (c <= 0) return;
    p.stamina = Math.max(0, p.stamina - c);
    this.lock = Math.max(this.lock, S.delay[kind] ?? 0.5);
    this.ready = 0;
    this.ctx.events.emit('staminaSpend', kind, c);
    this.settle();
  }

  /** floors, thresholds and the winded state */
  private settle() {
    const p = this.p, max = p.staminaMax;
    if (this.shelter) p.stamina = Math.max(p.stamina, max * S.shelterFloor);
    const f = this.frac;
    if (this.exhausted) {
      if (f >= S.recoverFrac) this.recover();
      return;
    }
    if (p.stamina <= 0.001) {
      this.exhaust();
      return;
    }
    if (this.lowArmed && f < S.lowFrac) {
      this.lowArmed = false;
      this.ctx.events.emit('staminaLow', f);
    } else if (!this.lowArmed && f > S.lowFrac + 0.1) this.lowArmed = true;
  }

  private exhaust() {
    const p = this.p, ctx = this.ctx;
    this.exhausted = true;
    this.lowArmed = false;
    p.stamina = 0;
    this.lock = Math.max(this.lock, S.delay.empty);
    this.ready = 0;
    ctx.events.emit('staminaEmpty');
    ctx.sfx('heartbeat', null, 0.55, 1.15);
    p.express('hurt', 0.7);
    const now = ctx.run?.time ?? 0;
    if (now - this.toastT > 75) {
      this.toastT = now;
      ctx.toast('WINDED', '#b7f24a', 'Coast or stand still to catch your breath', false);
    }
  }

  private recover() {
    this.exhausted = false;
    this.ctx.events.emit('staminaRecovered');
  }

  private deny(kind: StaminaSpend) {
    this.denied = 1;
    this.ctx.events.emit('staminaDenied', kind);
    if (this.denyCd <= 0) {
      this.denyCd = 0.6;
      this.ctx.sfx('ui_error', null, 0.3, 0.8);
    }
  }

  /** the max follows the staminaMax stat; a raised max fills the new room */
  private syncMax(first: boolean) {
    const p = this.p;
    const max = Math.max(20, Math.round(p.stats.get('staminaMax')));
    if (first) {
      p.staminaMax = max;
      p.stamina = max;
      return;
    }
    if (max !== p.staminaMax) {
      if (max > p.staminaMax) p.stamina += max - p.staminaMax;
      p.staminaMax = max;
      p.stamina = clamp(p.stamina, 0, max);
    }
  }
}
