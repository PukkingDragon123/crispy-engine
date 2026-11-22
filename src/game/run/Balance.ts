// Combat balance in one dependency-free place (node-checkable): the cooldown
// model (skills recharge from time AND from attacking), the ultimate's charge,
// the day / night difficulty ramp, boss toughness, the fire-rate ceiling and
// the readability budget that keeps fights legible.
//
// Hooks for other systems:
//  - the day system (TIME worker) calls setDay(day, night) whenever the day or
//    the night changes; waveScale() and the bosses read dayMul();
//  - the HUD reads skill cooldowns from Skills.cooldowns() and the ultimate card
//    from Ultimate.cardState(); refunds and readiness arrive as the events
//    'cdRefund' (key, seconds) and 'skillReady' (key, fromAttack: boolean).

// ------------------------------------------------------------------ cooldowns
/**
 * Every skill cooldown runs down with time (1 s per s) and with attacking:
 * each hit you land refunds `hit` seconds (capped at `hitCap` seconds of refund
 * per second of play so a shotgun of DOT ticks cannot drain it), each kill
 * refunds `kill` seconds (`alpha` for an alpha), a boss hit `boss`.
 * Cards raise these through Skills.refundMul / Skills.killBonus.
 */
export const CD = {
  hit: 0.1,
  hitCap: 0.8,
  kill: 0.55,
  alpha: 2,
  boss: 0.22,
  /** base cooldowns (s): longer than before, attacking earns them back */
  scorp: 9,
  swarm: 18,
  bomb: 9,
  roses: 16,
};

/** the hit sources that count as "you attacked" (DOT ticks and pets count half) */
export const ATTACK_SOURCES: Record<string, number> = { gun: 1, melee: 1, board: 1, grapple: 1, projectile: 1, roses: 0.6, scorpion: 0.5, swarm: 0.25, bomb: 0.6, divine: 0.5 };

/** a cooldown after `dt` seconds of time plus `refund` seconds earned by attacking (never below 0) */
export function cdStep(cd: number, dt: number, refund = 0) {
  return Math.max(0, cd - dt - refund);
}

/** a hit's refund in seconds, given the refund already earned this second (`spent`) and the card multiplier */
export function hitRefund(source: string, spent: number, mul = 1, bossHit = false) {
  const w = ATTACK_SOURCES[source] ?? 0;
  if (w <= 0) return 0;
  const want = (bossHit ? CD.boss : CD.hit) * w * mul;
  return Math.max(0, Math.min(want, CD.hitCap * mul - spent));
}

/** a kill's refund in seconds */
export function killRefund(alpha: boolean, mul = 1, bonus = 0) {
  return (alpha ? CD.alpha : CD.kill) * mul + bonus;
}

// ------------------------------------------------------------------ the ultimate
/**
 * The ultimate is a long cooldown that fills from time and from attacking:
 * `time` seconds of nothing charges it alone; hits, kills, streaks and style
 * pour more in. All gains scale with the ultCharge stat and card multipliers.
 */
export const ULT = {
  time: 95,
  hit: 0.0015,
  /** hit charge per second cap */
  hitCap: 0.02,
  kill: 0.006,
  streakStep: 0.0003,
  streakCap: 40,
  multiWindow: 0.45,
  multiSurge: 0.006,
  multiCap: 8,
  milestone: 0.04,
  alpha: 3,
  boss: 0.2,
  style: 1 / 30000,
  graze: 0.0008,
};

/** charge gained by one kill */
export function ultKillGain(streak: number, multi: number, alpha: boolean) {
  let g = ULT.kill + ULT.streakStep * Math.min(Math.max(0, streak - 1), ULT.streakCap);
  if (multi > 1) g += ULT.multiSurge * Math.min(multi - 1, ULT.multiCap);
  if (streak === 10 || streak === 25 || (streak >= 50 && streak % 50 === 0)) g += ULT.milestone;
  return alpha ? g * ULT.alpha : g;
}

/** seconds of plain time left until the ultimate is ready (for the card's countdown) */
export function ultSecondsLeft(charge: number, rate = 1) {
  return Math.max(0, (1 - Math.min(1, charge)) * ULT.time) / Math.max(0.05, rate);
}

// ------------------------------------------------------------------ difficulty
/** the day system's state (TIME worker: call setDay); day 1 and daylight until told otherwise */
export const DIFFICULTY = { day: 1, night: false };

export function setDay(day: number, night: boolean) {
  DIFFICULTY.day = Math.max(1, Math.floor(day || 1));
  DIFFICULTY.night = !!night;
}

/** extra multipliers from the day ramp and the night (stack on top of waveScale) */
export function dayMul(day = DIFFICULTY.day, night = DIFFICULTY.night) {
  const d = Math.max(0, day - 1);
  return {
    hp: (1 + d * 0.14 + Math.pow(d / 6, 1.6) * 0.5) * (night ? 1.15 : 1),
    dmg: (1 + d * 0.08) * (night ? 1.22 : 1),
    count: (1 + d * 0.06) * (night ? 1.25 : 1),
    speed: Math.min(1.25, 1 + d * 0.015 + (night ? 0.05 : 0)),
  };
}

/** enemy blows (was 0.72: the game was too easy) */
export const ENEMY_DMG = 1;

/** the wave ramp itself (steeper than before) */
export function waveRamp(wave: number) {
  const w = Math.max(0, wave - 1);
  return {
    hp: 1 + w * 0.09 + Math.pow(w / 22, 2.2),
    dmg: ENEMY_DMG * (1 + w * 0.03 + Math.pow(w / 40, 2)) * (wave <= 3 ? 0.8 + wave * 0.05 : 1),
    speed: 1 + Math.min(0.3, w * 0.004),
    count: 1 + w * 0.05,
    alphaChance: Math.min(0.08, 0.004 + w * 0.001),
  };
}

/** bosses: much more health, tighter patterns (waits between moves ×BOSS.tempo), telegraphs untouched */
export const BOSS = { hp: 1.8, tempo: 0.8 };
export function bossHp(base: number) {
  return Math.round(base * BOSS.hp * dayMul().hp);
}

/** enemy rosters: fewer bullets per volley (readable) that each hit harder; a little more aggressive */
export const ROSTER = { bulletCut: 0.6, bulletDmg: 1.35, cooldown: 0.85, minBullets: 3 };

// ------------------------------------------------------------------ the gun (less spammable)
/** fire-rate stat ceiling and the fanning interval floor */
export const GUN = { maxRate: 1.9, fanInterval: 0.095 };
export const fireRateCap = (rate: number) => Math.min(GUN.maxRate, Math.max(0.2, rate));

// ------------------------------------------------------------------ readability
/** hard caps on how many hit effects / damage numbers spawn per second */
export const READ = { hitFx: 26, numbers: 18, dotNumbers: 5 };
const gates = new Map<string, { t: number; n: number }>();
/** a rate limiter: true when another `key` effect may spawn now (`now` in seconds) */
export function fxGate(key: string, perSec: number, now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000) {
  let g = gates.get(key);
  if (!g) gates.set(key, (g = { t: now, n: 0 }));
  if (now - g.t >= 1) {
    g.t = now;
    g.n = 0;
  }
  if (g.n >= perSec) return false;
  g.n++;
  return true;
}
