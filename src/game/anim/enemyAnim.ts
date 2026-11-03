// Procedural enemy animation. Every skeleton type gets weight and character:
// idle breathing / weight shifts / fidgets, locomotion with planted feet
// (two-bone IK on humanoids, gait generators for 4/6/8 legs), readable
// attacks (anticipation → snap → follow-through), spring-driven hit flinches,
// stagger + stunned wobble, low-health limp and clutch, dances and taunts,
// and per-type death collapses that hand over to the ragdoll afterwards.
//
// Output: the enemy's per-part Euler offsets (e.rot) and parent-space position
// offsets (e.posOff), plus whole-body tilt/roll/lift/sink for the renderer.
import type { Enemy } from '../enemies/Enemies';
import { SpringF, ChainFollower } from './spring';
import { leg, GAITS, cycleRate, LegSample } from './gait';
import { twoBoneIK, lookAngles } from './ik';
import { attackPhase, AttackPhase } from './envelope';
import { clamp, clamp01, lerp, smooth, smoother, easeOutCubic, easeInCubic, easeOutBack, wobble, fbm, vnoise, damp, TAU, PI } from './math';

/** particle hooks the animation fires (implemented by the enemy manager) */
export interface AnimFx {
  /** a foot hits the ground: dust puff, plus sand flicked back along (dirX, dirZ) when kick > 0 */
  step(x: number, y: number, z: number, size: number, kick: number, dirX: number, dirZ: number): void;
  /** bursts: chitin shards, bone chips, fur tufts, sand sprays, blood drops */
  burst(x: number, y: number, z: number, kind: 'sand' | 'chitin' | 'bone' | 'fur' | 'blood', power: number): void;
}

export interface AnimEnv {
  fx?: AnimFx;
  time: number;
  dt: number;
  groundAt(x: number, z: number): number;
  player: { x: number; y: number; z: number };
  playerAlive: boolean;
  /** distance from the camera (detail level: IK ground probing, fidgets) */
  camDist: number;
}

/** per-enemy animation memory */
export class EnemyAnim {
  gait = Math.random();
  wave = Math.random() * 10;
  spd = 0;
  fwd = 0;
  side = 0;
  turn = 0;
  lean = new SpringF(0, 1.7, 0.62);
  bank = new SpringF(0, 1.5, 0.7);
  flP = new SpringF(0, 3.8, 0.3);
  flR = new SpringF(0, 3.8, 0.3);
  flY = new SpringF(0, 3.2, 0.35);
  headY = new SpringF(0, 2.1, 0.8);
  headP = new SpringF(0, 2.1, 0.8);
  recoil = new SpringF(0, 5.5, 0.32);
  bounce = new SpringF(0, 4.5, 0.35);
  prevYaw = 0;
  prevHitT = 99;
  prevHp = -1;
  prevState = '';
  seed = Math.random() * 100;
  breath = Math.random() * 10;
  fidgetIn = 2 + Math.random() * 6;
  fidgetT = -1;
  fidgetKind = 0;
  tauntT = -1;
  tauntKind = 0;
  tauntCd = 4 + Math.random() * 8;
  dance = 0;
  danceKind = Math.floor(Math.random() * 3);
  low = 0;
  shots = 0;
  footG = new Float32Array(8);
  tail: ChainFollower | null = null;
  tailOut: number[] = [0, 0, 0, 0, 0, 0];
  // death
  dying = false;
  dT = 0;
  dDur = 1;
  dDir = 1;
  dSide = 1;
  impact = false;
  impactDone = false;
  // whole-body render extras
  tilt = 0;
  roll = 0;
  lift = 0;
  sink = 0;
  hidden = false;
  /** lizard inflation 0..1 (scales the whole body) */
  puff = 0;
  /** jerky lizard head: next retarget time */
  snapIn = 0;
  snapYaw = 0;
  /** per-leg planted flags (footfall detection) */
  stanceMask = 0;
  /** death burst fired */
  deathFx = false;

  /** start the procedural death; dir: +1 fall forward, -1 fall backward */
  die(dir: number, side: number, dur: number) {
    this.dying = true;
    this.dT = 0;
    this.dDir = dir;
    this.dSide = side;
    this.dDur = dur;
    this.impact = false;
    this.impactDone = false;
  }
}

// ------------------------------------------------------------- rig metrics
interface Metrics {
  thigh: number;
  shin: number;
  hipY: number;
  footX: number;
  arm: number;
  nSeg: number;
  nTail: number;
  jaws: number[];
  rearH: number;
  segLen: number;
}
const metricsCache = new WeakMap<object, Metrics>();
function metrics(e: Enemy): Metrics {
  const b = e.batch as unknown as object;
  let m = metricsCache.get(b);
  if (m) return m;
  const parts = e.batch.geo.parts;
  const idx = e.batch.partIndex;
  const len = (i: number | undefined) => (i === undefined ? 0 : parts[i].offset.length());
  const h = e.def.height;
  const ti = idx['thigh_l'], si = idx['shin_l'];
  let thigh = len(si);
  let hipY = (parts[0]?.offset.y ?? h * 0.4) + (ti !== undefined ? parts[ti].offset.y : 0);
  if (!(thigh > 0.05) || !(hipY > 0.1)) {
    thigh = h * 0.2;
    hipY = h * 0.42;
  }
  let shin = hipY - thigh;
  if (shin < thigh * 0.6) shin = thigh * 0.6;
  const footX = ti !== undefined ? Math.abs(parts[ti].offset.x) : h * 0.06;
  const arm = len(idx['fore_l']) || h * 0.17;
  let nSeg = 0;
  while (idx['seg' + (nSeg + 1)] !== undefined) nSeg++;
  let nTail = 0;
  while (idx['tail' + (nTail + 1)] !== undefined) nTail++;
  const jaws: number[] = [];
  for (const [name, i] of Object.entries(idx)) if (/^(jaw_|mandible|petal|maw)/.test(name)) jaws.push(i);
  const segLen = len(idx['seg2']) || len(idx['seg1']) || h * 0.35;
  m = { thigh, shin, hipY, footX, arm, nSeg, nTail, jaws, rearH: h * 1.2, segLen };
  metricsCache.set(b, m);
  return m;
}

// ------------------------------------------------------------- helpers
const _leg: LegSample = { sweep: 0, lift: 0, stance: true, u: 0 };
const _leg2: LegSample = { sweep: 0, lift: 0, stance: true, u: 0 };
const _ap: AttackPhase = { antic: 0, strike: 0, follow: 0, tension: 0 };

function S(e: Enemy, name: string, x: number, y = 0, z = 0) {
  const i = e.batch.partIndex[name];
  if (i === undefined) return;
  e.rot[i * 3] = x;
  e.rot[i * 3 + 1] = y;
  e.rot[i * 3 + 2] = z;
}
function A(e: Enemy, name: string, x: number, y = 0, z = 0) {
  const i = e.batch.partIndex[name];
  if (i === undefined) return;
  e.rot[i * 3] += x;
  e.rot[i * 3 + 1] += y;
  e.rot[i * 3 + 2] += z;
}
function O(e: Enemy, name: string, x: number, y: number, z: number) {
  const i = e.batch.partIndex[name];
  if (i === undefined) return;
  e.posOff[i * 3] += x;
  e.posOff[i * 3 + 1] += y;
  e.posOff[i * 3 + 2] += z;
}
function rootIndex(e: Enemy) {
  return 0;
}
function RO(e: Enemy, x: number, y: number, z: number) {
  const i = rootIndex(e) * 3;
  e.posOff[i] += x;
  e.posOff[i + 1] += y;
  e.posOff[i + 2] += z;
}
function RR(e: Enemy, x: number, y: number, z: number) {
  const i = rootIndex(e) * 3;
  e.rot[i] += x;
  e.rot[i + 1] += y;
  e.rot[i + 2] += z;
}

/** fire a footstep when a leg lands (swing → stance). fwd/side: foot offset in local metres */
function footfall(e: Enemy, a: EnemyAnim, env: AnimEnv, legIdx: number, stance: boolean, fwd: number, side: number, size: number, kick: number) {
  const bit = 1 << legIdx;
  const was = (a.stanceMask & bit) !== 0;
  if (stance) a.stanceMask |= bit;
  else a.stanceMask &= ~bit;
  if (!stance || was || !env.fx || env.camDist > 34 || a.spd < 0.9) return;
  const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
  const x = e.pos.x + (sy * fwd + cy * side) * e.scale, z = e.pos.z + (cy * fwd - sy * side) * e.scale;
  env.fx.step(x, env.groundAt(x, z), z, size * e.scale, kick, -sy, -cy);
}

/** first frame of a strike → a lunge kicks sand back from the feet */
function lungeFx(e: Enemy, env: AnimEnv, power: number) {
  if (!env.fx || env.camDist > 40 || e.state !== 'strike' || e.stateT > env.dt * 1.5) return;
  const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
  env.fx.step(e.pos.x, e.pos.y, e.pos.z, 0.5 * e.scale * power, 1.2 * power, -sy, -cy);
}

/** death bursts by material, once at the start and again on impact */
function deathFx(e: Enemy, a: EnemyAnim, env: AnimEnv, kind: 'sand' | 'chitin' | 'bone' | 'fur' | 'blood') {
  if (!env.fx || env.camDist > 50) return;
  if (!a.deathFx) {
    a.deathFx = true;
    env.fx.burst(e.pos.x, e.pos.y + e.height * 0.6, e.pos.z, kind, 0.7);
  }
  if (a.impact) {
    env.fx.burst(e.pos.x, e.pos.y + 0.1, e.pos.z, 'sand', 0.8);
    if (kind !== 'sand') env.fx.burst(e.pos.x, e.pos.y + 0.2, e.pos.z, kind, 0.5);
  }
}

/** mix a rest value toward wind-up and strike poses with overshoot follow-through */
function pose(rest: number, antic: number, strike: number, ap: AttackPhase) {
  return rest + (antic - rest) * ap.antic + (strike - rest) * ap.strike + (strike - antic) * 0.22 * ap.follow;
}

// ------------------------------------------------------------- main entry
export function animateEnemy(e: Enemy, env: AnimEnv) {
  const a = e.anim;
  const dt = env.dt;
  const t = env.time;
  e.rot.fill(0);
  e.posOff.fill(0);
  a.tilt = 0;
  a.roll = 0;
  a.lift = 0;
  a.sink = 0;
  a.hidden = false;
  e.squash.update(1, dt);

  // locomotion measurement in local space
  const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
  const fwd = e.vel.x * sy + e.vel.z * cy;
  const side = e.vel.x * cy - e.vel.z * sy;
  a.fwd = damp(a.fwd, fwd, 10, dt);
  a.side = damp(a.side, side, 10, dt);
  a.spd = Math.hypot(a.fwd, a.side);
  let dy = e.yaw - a.prevYaw;
  while (dy > PI) dy -= TAU;
  while (dy < -PI) dy += TAU;
  a.prevYaw = e.yaw;
  a.turn = damp(a.turn, dy / Math.max(dt, 1e-3), 6, dt);
  a.breath += dt * (a.low > 0.5 ? 2.4 : 1.25);

  // new hit → directional flinch impulse (push direction in local space)
  if (e.hitT < a.prevHitT && e.hitT < 0.05) {
    const lx = e.hitX * cy - e.hitZ * sy;
    const lz = e.hitX * sy + e.hitZ * cy;
    const lost = a.prevHp > 0 ? clamp01((a.prevHp - e.hp) / e.maxHp) : 0.1;
    const k = 4 + lost * 26;
    a.flP.kick(lz * k);
    a.flR.kick(-lx * k);
    a.flY.kick((Math.random() - 0.5) * k * 0.6);
    a.headP.kick(lz * k * 0.6);
    a.bounce.kick(-2.5 - lost * 6);
  }
  a.prevHitT = e.hitT;
  a.prevHp = e.hp;
  a.flP.step(0, dt);
  a.flR.step(0, dt);
  a.flY.step(0, dt);
  a.bounce.step(0, dt);
  a.recoil.step(0, dt);
  if (e.state === 'stagger' && a.prevState !== 'stagger') {
    a.flP.kick(-7);
    a.flR.kick((Math.random() - 0.5) * 8);
  }
  a.prevState = e.state;

  // blends
  a.low = damp(a.low, e.hp < e.maxHp * 0.3 && e.alive ? 1 : 0, 3, dt);
  const wantDance = (!env.playerAlive && env.camDist < 60) || e.def.special === 'buffAura' ? 1 : a.tauntT >= 0 ? 0 : 0;
  a.dance = damp(a.dance, wantDance, 3, dt);

  // fidgets & taunts (only when calm and close enough to be seen)
  const calm = e.state === 'move' && a.spd < 1.2 && !a.dying;
  if (calm && env.camDist < 40) {
    a.fidgetIn -= dt;
    if (a.fidgetIn <= 0 && a.fidgetT < 0) {
      a.fidgetT = 0;
      a.fidgetKind = Math.floor(Math.random() * 4);
      a.fidgetIn = 4 + Math.random() * 7;
    }
  }
  if (a.fidgetT >= 0) {
    a.fidgetT += dt;
    if (a.fidgetT > 1.4 || !calm) a.fidgetT = -1;
  }
  a.tauntCd -= dt;
  if (calm && a.tauntCd <= 0 && env.camDist < 45 && Math.random() < dt * 0.25) {
    a.tauntT = 0;
    a.tauntKind = Math.floor(Math.random() * 3);
    a.tauntCd = 9 + Math.random() * 14;
  }
  if (a.tauntT >= 0) {
    a.tauntT += dt;
    const busy = e.state === 'windup' || e.state === 'stagger' || e.state === 'charge' || e.state === 'leap' || e.state === 'dive' || e.state === 'wrap';
    if (a.tauntT > 1.6 || (busy && !a.dying)) a.tauntT = -1;
  }

  // attack envelope
  const atk = e.atk;
  const ap = attackPhase(e.state, e.stateT, atk?.windup ?? 0.5, 0.35, _ap);
  if (e.state === 'strike' && atk && (atk.kind === 'burst' || atk.kind === 'fan' || atk.kind === 'volley' || atk.kind === 'snipe' || atk.kind === 'spiral' || atk.kind === 'ring')) {
    const shots = atk.kind === 'burst' ? Math.min(atk.count ?? 1, 1 + Math.floor(e.stateT / 0.12)) : 1;
    if (shots > a.shots) {
      a.recoil.kick(atk.kind === 'snipe' ? 14 : atk.kind === 'fan' ? 11 : 8);
      a.flP.kick(-1.5);
      a.shots = shots;
    }
  } else if (e.state !== 'strike') a.shots = 0;

  switch (e.skel) {
    case 'humanoid':
      humanoid(e, a, env, ap);
      break;
    case 'quad':
      quad(e, a, env, ap);
      break;
    case 'worm':
      worm(e, a, env, ap);
      break;
    case 'snake':
      snake(e, a, env, ap);
      break;
    case 'lizard':
      lizard(e, a, env, ap);
      break;
    case 'beetle':
      insect(e, a, env, ap, 3);
      break;
    case 'scorpion':
      insect(e, a, env, ap, 4);
      break;
    case 'bird':
      bird(e, a, env, ap);
      break;
    default:
      a.lift = Math.abs(Math.sin(a.gait * TAU)) * 0.04 * clamp01(a.spd / 2);
      a.gait += dt * (1 + a.spd);
      if (a.dying) a.sink = easeInCubic(a.dT / a.dDur) * e.height;
  }
  // jaw scream / chatter shared by every skeleton with a jaw
  const scream = e.state === 'windup' ? ap.antic * 0.55 : e.hitT < 0.2 ? (1 - e.hitT / 0.2) * 0.5 : 0;
  const chatter = e.def.id === 'husk' ? Math.max(0, Math.sin(t * 7 + e.quirk * 20)) * 0.12 : 0;
  e.jaw = damp(e.jaw, scream + chatter + (a.low > 0.5 ? 0.12 : 0) + (a.dying ? 0.35 : 0), 14, dt);
  A(e, 'jaw', e.jaw);
  if (a.dying) a.dT += dt;
}

// ============================================================= humanoid
function humanoid(e: Enemy, a: EnemyAnim, env: AnimEnv, ap: AttackPhase) {
  const M = metrics(e);
  const t = env.time, dt = env.dt;
  const st = e.state;
  const kind = e.atk?.kind ?? '';
  const id = e.def.id;
  const ai = e.def.ai;
  const shamble = id === 'husk' || id === 'cactusHusk' || id === 'bomberHusk';
  const heavy = ai === 'tank' || id === 'bandageWhipper' || id === 'mummy';
  const rider = ai === 'rider';
  const stunned = e.status.stunned() || e.flipped > 0;
  const low = a.low;
  // ---- death collapse
  if (a.dying) return humanoidDeath(e, a, env, M);

  // ---- locomotion
  const sp = a.spd;
  const moving = clamp01(sp / 0.7);
  const run = clamp01((sp - 2.6) / 3.2) * (rider ? 0 : 1);
  const legL = M.thigh + M.shin;
  const duty = lerp(0.62, 0.36, run);
  const amp = legL * lerp(0.2, 0.44, run) * clamp01(sp / 1.3) * (shamble ? 0.75 : 1);
  const rate = sp > 0.12 && !rider ? clamp(cycleRate(sp, Math.max(amp, 0.03), duty), 0.45, 3.4) : 0;
  a.gait += rate * dt * (low > 0.5 ? 0.85 : 1);
  if (rate === 0) a.gait = damp(a.gait, Math.round(a.gait * 2) / 2, 3, dt);
  const dirF = sp > 0.05 ? a.fwd / sp : 1, dirS = sp > 0.05 ? a.side / sp : 0;
  const liftH = lerp(0.05, 0.15, run) * (legL / 0.62) * (shamble ? 0.6 : 1);
  // body bob: dips at each foot strike, deeper when heavy
  const bobAmt = lerp(0.012, 0.05, run) * moving * (heavy ? 1.6 : 1) * (legL / 0.62);
  const bob = bobAmt * (0.5 + 0.5 * Math.cos(a.gait * TAU * 2));
  // crouch: combat stance, anticipation, stunned knees, low health
  let crouch = 0.015 + low * 0.05 + (stunned ? 0.06 + Math.sin(t * 3.1) * 0.03 : 0);
  if (st === 'windup') crouch += ap.antic * (kind === 'leap' ? 0.22 : kind === 'melee' ? 0.07 : 0.03) * legL;
  if (st === 'spawn' && e.emerge !== 'sand') crouch += (1 - smooth(e.stateT / 0.3)) * 0.12;
  crouch += Math.max(0, -a.bounce.x) * 0.02;
  if (rider) crouch += 0.12 + Math.sin(t * 1.5) * 0.02;
  const hipDrop = bob + crouch;
  // ---- legs (IK, feet planted along the travel direction)
  const probe = env.camDist < 30 && !rider;
  for (let s = 0; s < 2; s++) {
    const sideSign = s === 0 ? 1 : -1;
    const l = leg(a.gait + (s === 0 ? 0 : 0.5), duty, _leg);
    let stride = 1, liftK = 1;
    if (low > 0.3 && s === 1) {
      stride = 1 - low * 0.55;
      liftK = 1 - low * 0.65; // dragging leg
    }
    if (shamble && s === 1) liftK *= 0.5;
    const sw = l.sweep * amp * stride * moving;
    const fF = sw * dirF;
    const fS = sw * dirS;
    const lift = l.lift * liftH * liftK * moving;
    // ground under this foot (keeps feet on slopes)
    let gd = 0;
    if (probe) {
      const sxl = fS + sideSign * M.footX * 1.4;
      const wx = e.pos.x + (Math.sin(e.yaw) * fF + Math.cos(e.yaw) * sxl) * e.scale;
      const wz = e.pos.z + (Math.cos(e.yaw) * fF - Math.sin(e.yaw) * sxl) * e.scale;
      gd = clamp((env.groundAt(wx, wz) - e.pos.y) / e.scale, -0.25, 0.25);
    }
    a.footG[s] = damp(a.footG[s], gd, 18, dt);
    let down = M.hipY - hipDrop - lift - a.footG[s];
    let fwdT = fF;
    if (rider) {
      // surf stance on the board: wide, knees soft
      fwdT = sideSign * 0.08;
      down = M.hipY - hipDrop;
    }
    const ik = twoBoneIK(M.thigh, M.shin, fwdT, Math.max(0.05, down), 1);
    if (!rider) footfall(e, a, env, s, l.stance && moving > 0.5, fF, fS + sideSign * M.footX, 0.45 + run * 0.4, run * 0.6);
    const abd = Math.atan2(fS, Math.max(0.1, down)) + sideSign * (0.05 + (rider ? 0.22 : 0) + low * 0.04);
    S(e, s === 0 ? 'thigh_l' : 'thigh_r', ik.upper, 0, abd);
    S(e, s === 0 ? 'shin_l' : 'shin_r', ik.lower, 0, 0);
  }
  if (rider) S(e, 'board', 0, -0.9, 0);
  // ---- pelvis + spine
  const twist = Math.sin(a.gait * TAU) * 0.13 * moving;
  const sway = Math.cos(a.gait * TAU) * 0.045 * moving + (moving < 0.3 ? fbm(t * 0.22, a.seed) * 0.05 : 0);
  RO(e, 0, -hipDrop, 0);
  RR(e, 0.04 * run, twist + (rider ? 0.9 : 0), sway + (rider ? Math.sin(t * 1.5) * 0.08 : 0));
  // accel lean + turn bank springs
  a.lean.step(clamp(sp * 0.02 + run * 0.12, -0.3, 0.4), dt);
  a.bank.step(clamp(-a.turn * sp * 0.012, -0.25, 0.25), dt);
  const breathe = Math.sin(a.breath) * (0.025 + low * 0.03);
  let tP = a.lean.x + (shamble ? 0.28 : 0) + low * 0.35 + breathe + a.flP.x * 0.6;
  let tY = -twist * 0.85 + a.flY.x * 0.5;
  let tR = a.bank.x + a.flR.x * 0.6 + (shamble ? Math.sin(t * 1.3 + e.quirk * 9) * 0.12 : 0) + (low > 0 ? Math.sin(t * 0.9 + a.seed) * 0.06 * low : 0);
  // head: stabilise against the body + look at the player with lag
  const toX = env.player.x - e.pos.x, toZ = env.player.z - e.pos.z;
  const lx = toX * Math.cos(e.yaw) - toZ * Math.sin(e.yaw);
  const lz = toX * Math.sin(e.yaw) + toZ * Math.cos(e.yaw);
  const ly = env.player.y + 1.1 - (e.pos.y + e.height * 0.85);
  const look = lookAngles(lx, ly, lz, 1.0, 0.6);
  a.headY.step(look.yaw * (st === 'spawn' ? 0 : 1) - tY * 0.5, dt);
  a.headP.step(-look.pitch * 0.7, dt);
  let hP = a.headP.x - tP * 0.45 + (shamble ? 0.22 : 0) + low * 0.25 + Math.cos(a.gait * TAU * 2) * 0.03 * moving;
  let hY = a.headY.x + (shamble ? Math.sin(t * 0.7 + e.quirk) * 0.2 : 0);
  let hR = shamble ? 0.3 * Math.sin(t * 0.6 + e.quirk) : 0;
  // ---- arms (counter-swing; elbows bend when running)
  const armSw = Math.sin(a.gait * TAU) * (0.38 + run * 0.35) * moving;
  let aLx = armSw, aLy = 0, aLz = 0.12 + low * 0.05;
  let aRx = -armSw, aRy = 0, aRz = -0.12;
  let fLx = -(0.2 + run * 0.95), fRx = -(0.2 + run * 0.95);
  if (shamble && kind !== 'explode') {
    // reaching zombie arms that drift and claw
    aLx = -1.25 + Math.sin(t * 2 + e.quirk) * 0.14;
    aRx = -1.05 + Math.sin(t * 2.4 + e.quirk) * 0.18;
    fLx = -0.35 + Math.sin(t * 3.1) * 0.12;
    fRx = -0.45 + Math.sin(t * 2.7 + 1) * 0.12;
  }
  // archetype carry poses
  const gunner = ai === 'ranged' || ai === 'sniper' || ai === 'ambusher' || rider || id === 'dungSkeleton' || ai === 'lobber';
  const twoHand = id === 'sharpshooter' || id === 'shotgunner';
  if (gunner && !shamble) {
    const ready = st === 'windup' || st === 'strike' ? 1 : 0.35;
    aRx = lerp(-armSw, -1.4 - look.pitch * 0.6, ready);
    aRy = 0.15 * ready;
    fRx = lerp(fRx, -0.12, ready);
    if (twoHand) {
      aLx = lerp(armSw, -1.25 - look.pitch * 0.6, ready);
      aLy = -0.45 * ready;
      fLx = lerp(fLx, -0.55, ready);
    }
  }
  if (id === 'jackal') {
    aLx = -0.65;
    aLy = 0.4;
    aLz = 0.3; // shield up
  }
  // low health: clutch the wound with the left arm
  if (low > 0.01 && !twoHand) {
    aLx = lerp(aLx, -0.85, low);
    aLy = lerp(aLy, -0.2, low);
    aLz = lerp(aLz, -0.45, low);
    fLx = lerp(fLx, -1.7, low);
  }
  // ---- attacks
  if (st === 'windup' || st === 'strike' || st === 'recover' || st === 'charge' || st === 'leap') {
    const tense = ap.tension * Math.sin(t * 47) * 0.035;
    switch (kind) {
      case 'melee':
        if (heavy) {
          // two-handed overhead hammer blow
          aRx = pose(aRx, -2.75, -0.45, ap);
          aLx = pose(aLx, -2.6, -0.5, ap);
          fRx = pose(fRx, -0.7, -0.15, ap);
          fLx = pose(fLx, -0.7, -0.15, ap);
          tP = pose(tP, -0.35, 0.45, ap);
        } else {
          // haymaker: coil back, step in, swing through
          aRx = pose(aRx, -2.3, -0.55, ap) + tense;
          aRy = pose(aRy, -0.5, 0.35, ap);
          aRz = pose(aRz, -0.55, 0.1, ap);
          fRx = pose(fRx, -1.25, -0.2, ap);
          aLx = pose(aLx, -0.7, 0.25, ap);
          tY = pose(tY, -0.55, 0.5, ap);
          tP = pose(tP, -0.15, 0.32, ap);
        }
        RO(e, 0, 0, 0.22 * ap.strike + 0.05 * ap.follow);
        lungeFx(e, env, heavy ? 1.2 : 0.8);
        break;
      case 'burst':
      case 'fan':
      case 'snipe':
      case 'spiral':
      case 'ring':
        // steady aim, then recoil kicks the arm up and the torso back
        aRx += -a.recoil.x * 0.035;
        fRx += -a.recoil.x * 0.02;
        if (twoHand) aLx += -a.recoil.x * 0.03;
        tP += -a.recoil.x * 0.012 - (kind === 'snipe' ? ap.antic * 0.05 : 0);
        hP += -a.recoil.x * 0.01;
        if (kind === 'snipe') {
          // breath held: sway fades as the shot lines up
          aRx += Math.sin(t * 2.3) * 0.05 * (1 - ap.antic);
        }
        break;
      case 'volley': {
        // bow: left arm extends the bow, right hand draws to the cheek
        aLx = pose(aLx, -1.5, -1.5, ap);
        aLy = pose(aLy, 0.15, 0.15, ap);
        fLx = pose(fLx, -0.05, -0.05, ap);
        aRx = pose(aRx, -1.45, -1.3, ap);
        aRy = pose(aRy, 0.85, 0.2, ap);
        fRx = pose(fRx, -2.1, -0.3, ap);
        tY = pose(tY, 0.45, 0.2, ap);
        break;
      }
      case 'lob':
        // overhand throw: cocked behind the head, whipped forward
        aRx = pose(aRx, -3.3, -1.0, ap);
        fRx = pose(fRx, -1.6, -0.2, ap);
        tP = pose(tP, -0.3, 0.4, ap);
        tY = pose(tY, -0.4, 0.35, ap);
        break;
      case 'whip': {
        const circle = ap.antic * (t * 12);
        aRx = pose(aRx, -2.8 + Math.sin(circle) * 0.25, -0.5, ap);
        aRz = pose(aRz, -0.4 + Math.cos(circle) * 0.25, 0.1, ap);
        fRx = pose(fRx, -0.6, 0, ap);
        tP = pose(tP, -0.25, 0.5, ap);
        tY = pose(tY, -0.4, 0.45, ap);
        break;
      }
      case 'lasso': {
        const c = t * 13;
        aRx = pose(aRx, -2.9 + Math.sin(c) * 0.2, -1.4, ap);
        aRy = pose(aRy, Math.cos(c) * 0.5, 0.3, ap);
        fRx = pose(fRx, -0.4, -0.1, ap);
        break;
      }
      case 'aura':
        aLx = pose(aLx, -0.9, -0.6, ap);
        aRx = pose(aRx, -0.9, -0.6, ap);
        aLz = pose(aLz, 1.2, 1.5, ap);
        aRz = pose(aRz, -1.2, -1.5, ap);
        hP = pose(hP, -0.45, -0.2, ap);
        break;
      case 'vortex': {
        const c = t * 9;
        aLx = -1.4 + Math.sin(c) * 0.5 * ap.antic;
        aRx = -1.4 + Math.sin(c + PI) * 0.5 * ap.antic;
        aLz = 0.6 * ap.antic;
        aRz = -0.6 * ap.antic;
        break;
      }
      case 'music':
        tP = pose(tP, -0.25, -0.35, ap);
        hP = pose(hP, -0.4, -0.5, ap);
        break;
      case 'explode': {
        // frantic: arms flailing at the lit fuse, head shaking
        const f = t * 26;
        aLx = -2.7 + Math.sin(f) * 0.45;
        aRx = -2.6 + Math.sin(f + 2) * 0.45;
        aLz = 0.5 + Math.cos(f) * 0.3;
        aRz = -0.5 - Math.cos(f + 1) * 0.3;
        hY += Math.sin(t * 19) * 0.35;
        RO(e, Math.sin(t * 31) * 0.02, 0, Math.cos(t * 27) * 0.02);
        break;
      }
      case 'charge':
        tP = pose(tP, 0.45, 0.6, ap);
        hP = pose(hP, 0.4, 0.2, ap);
        aLx = pose(aLx, 0.6, 0.9, ap);
        aRx = pose(aRx, 0.6, 0.9, ap);
        break;
      case 'leap':
        aRx = pose(aRx, 0.9, -2.4, ap);
        aLx = pose(aLx, 0.9, -1.2, ap);
        tP = pose(tP, 0.45, -0.1, ap);
        break;
    }
    if (st === 'leap') {
      // airborne tuck → reach → land
      const k = clamp01(e.stateT / 0.75);
      const tuck = Math.sin(k * PI);
      S(e, 'thigh_l', -1.3 * tuck - 0.2, 0, 0.12);
      S(e, 'thigh_r', -0.9 * tuck - 0.1, 0, -0.12);
      S(e, 'shin_l', 1.9 * tuck, 0, 0);
      S(e, 'shin_r', 1.6 * tuck, 0, 0);
      aRx = lerp(-2.6, -1.0, k);
      aLx = lerp(-1.4, -0.6, k);
      tP = lerp(-0.2, 0.4, k);
    }
    if (st === 'charge') {
      tP += 0.35;
      hP += 0.15;
    }
  }
  // ---- stagger / stunned
  if (st === 'stagger') {
    const k = clamp01(e.stateT / 0.45);
    aLz += 0.9 * (1 - k) + Math.sin(t * 22) * 0.25 * (1 - k);
    aRz -= 0.9 * (1 - k) + Math.sin(t * 19) * 0.25 * (1 - k);
    aLx -= 0.6 * (1 - k);
    aRx -= 0.6 * (1 - k);
  }
  if (stunned) {
    tR += Math.sin(t * 2.4) * 0.16;
    tP += Math.cos(t * 1.9) * 0.1;
    hR += Math.sin(t * 3.4) * 0.3;
    hP += Math.cos(t * 3.4) * 0.2;
    aLx = lerp(aLx, 0.15, 0.6);
    aRx = lerp(aRx, 0.15, 0.6);
    aLz += Math.sin(t * 1.7) * 0.15;
    aRz -= Math.sin(t * 1.9) * 0.15;
  }
  // ---- spawn: claw out of the sand
  if (st === 'spawn' && e.emerge === 'sand') {
    const k = clamp01(e.stateT / 1.1);
    const reach = 1 - smooth((k - 0.45) / 0.55);
    const claw = Math.sin(t * 9) * 0.35 * reach;
    aLx = lerp(aLx, -2.8 + claw, reach);
    aRx = lerp(aRx, -2.7 - claw, reach);
    fLx = lerp(fLx, -0.4, reach);
    fRx = lerp(fRx, -0.4, reach);
    hP -= 0.55 * reach;
    tY += Math.sin(t * 6) * 0.22 * reach;
    tP -= 0.2 * reach;
  }
  // ---- fidgets
  if (a.fidgetT >= 0) {
    const k = a.fidgetT / 1.4;
    const w = Math.sin(k * PI);
    switch (a.fidgetKind) {
      case 0: // look around
        hY += Math.sin(k * TAU) * 0.8 * w;
        break;
      case 1: // crack the neck
        hR += Math.sin(k * PI * 3) * 0.35 * w;
        break;
      case 2: // scratch the skull
        aRx = lerp(aRx, -2.6, w);
        fRx = lerp(fRx, -1.9 + Math.sin(t * 24) * 0.25, w);
        aRz = lerp(aRz, 0.4, w);
        break;
      case 3: // roll the shoulders / stretch
        tP -= 0.15 * w;
        aLz += 0.5 * w;
        aRz -= 0.5 * w;
        break;
    }
  }
  // ---- taunts
  if (a.tauntT >= 0) {
    const k = a.tauntT / 1.6;
    const w = Math.sin(clamp01(k) * PI);
    switch (a.tauntKind) {
      case 0: {
        // chest thumps
        const th = Math.max(0, Math.sin(a.tauntT * 11));
        aLx = lerp(aLx, -1.3 - th * 0.3, w);
        aRx = lerp(aRx, -1.3 - (1 - th) * 0.3, w);
        aLz = lerp(aLz, -0.6, w);
        aRz = lerp(aRz, 0.6, w);
        fLx = lerp(fLx, -1.5, w);
        fRx = lerp(fRx, -1.5, w);
        tP -= 0.2 * w;
        hP -= 0.3 * w;
        break;
      }
      case 1: {
        // beckon: "come here"
        aRx = lerp(aRx, -1.5, w);
        aRy = lerp(aRy, 0.2, w);
        fRx = lerp(fRx, -0.6 - Math.max(0, Math.sin(a.tauntT * 10)) * 1.1, w);
        hR += 0.2 * w;
        break;
      }
      default: {
        // laugh: head thrown back, shoulders bouncing
        hP -= 0.5 * w;
        tP -= 0.2 * w;
        RO(e, 0, Math.abs(Math.sin(a.tauntT * 14)) * 0.025 * w, 0);
        e.jaw = Math.max(e.jaw, (0.2 + Math.abs(Math.sin(a.tauntT * 20)) * 0.25) * w);
        aLx = lerp(aLx, -0.5, w);
        aRx = lerp(aRx, -0.5, w);
        fLx = lerp(fLx, -1.6, w);
        fRx = lerp(fRx, -1.6, w);
        break;
      }
    }
  }
  // ---- dance (mariachi always plays; everyone celebrates when the hunter falls)
  if (a.dance > 0.01) {
    const w = a.dance;
    const beat = t * (id === 'mariachi' ? 4.2 : 5.2) + a.seed;
    const kindD = id === 'mariachi' ? -1 : a.danceKind;
    RO(e, 0, Math.abs(Math.sin(beat)) * 0.045 * w, 0);
    RR(e, 0, Math.sin(beat * 0.5) * 0.25 * w, Math.sin(beat) * 0.16 * w);
    tR += -Math.sin(beat) * 0.12 * w;
    hP += Math.sin(beat * 2) * 0.12 * w;
    hR += Math.sin(beat) * 0.15 * w;
    if (kindD === -1) {
      // strum + fret, step-touch footwork
      aRx = lerp(aRx, -0.6 + Math.sin(t * 15) * 0.3, w);
      aRz = lerp(aRz, -0.25, w);
      fRx = lerp(fRx, -1.1, w);
      aLx = lerp(aLx, -0.85, w);
      aLy = lerp(aLy, 0.45, w);
      aLz = lerp(aLz, 0.3, w);
      fLx = lerp(fLx, -1.0, w);
      A(e, 'thigh_l', -Math.max(0, Math.sin(beat)) * 0.35 * w);
      A(e, 'shin_l', Math.max(0, Math.sin(beat)) * 0.6 * w);
      A(e, 'thigh_r', -Math.max(0, -Math.sin(beat)) * 0.35 * w);
      A(e, 'shin_r', Math.max(0, -Math.sin(beat)) * 0.6 * w);
    } else if (kindD === 0) {
      // arms up, waving: victory!
      aLx = lerp(aLx, -2.8 + Math.sin(beat * 2) * 0.25, w);
      aRx = lerp(aRx, -2.8 - Math.sin(beat * 2) * 0.25, w);
      aLz = lerp(aLz, 0.35 + Math.sin(beat) * 0.2, w);
      aRz = lerp(aRz, -0.35 + Math.sin(beat) * 0.2, w);
    } else if (kindD === 1) {
      // thumbs in the belt, hip shimmy
      aLx = lerp(aLx, -0.25, w);
      aRx = lerp(aRx, -0.25, w);
      aLz = lerp(aLz, 0.45, w);
      aRz = lerp(aRz, -0.45, w);
      fLx = lerp(fLx, -1.4, w);
      fRx = lerp(fRx, -1.4, w);
      RR(e, 0, 0, Math.sin(beat * 2) * 0.12 * w);
    } else {
      // skeleton jig: alternating high kicks
      const kk = Math.sin(beat);
      A(e, 'thigh_l', -Math.max(0, kk) * 1.1 * w);
      A(e, 'thigh_r', -Math.max(0, -kk) * 1.1 * w);
      A(e, 'shin_l', Math.max(0, kk) * 0.4 * w);
      A(e, 'shin_r', Math.max(0, -kk) * 0.4 * w);
      aLx = lerp(aLx, -1.0, w);
      aRx = lerp(aRx, -1.0, w);
      aLz = lerp(aLz, 0.9, w);
      aRz = lerp(aRz, -0.9, w);
    }
  }
  // ---- write
  S(e, 'torso', tP, tY, tR);
  S(e, 'head', hP + a.flP.x * 0.4, hY, hR + a.flR.x * 0.3);
  S(e, 'arm_l', aLx + a.flP.x * -0.3, aLy, aLz + Math.max(0, a.flR.x) * 0.4);
  S(e, 'arm_r', aRx + a.flP.x * -0.3, aRy, aRz + Math.min(0, a.flR.x) * 0.4);
  S(e, 'fore_l', fLx, 0, 0);
  S(e, 'fore_r', fRx, 0, 0);
  // accessories with secondary motion
  S(e, 'hat', -a.flP.x * 0.5 - a.lean.x * 0.3, 0, a.flR.x * 0.4);
  S(e, 'coat', 0.1 + sp * 0.03 + Math.sin(t * 6 + e.quirk) * 0.04 * moving, 0, 0);
  S(e, 'tail', Math.sin(t * 5 + e.quirk * 5) * 0.35, Math.sin(t * 3.5) * 0.45 + a.turn * -0.1, 0);
  if (e.state === 'hidden') S(e, 'weed', t * 4, 0, 0);
  if (e.def.id === 'bomberHusk' && kind !== 'explode') A(e, 'head', 0, Math.sin(t * 17) * 0.18, 0);
  // squash & stretch on impacts
  a.lift = Math.max(0, a.bounce.x) * 0.02;
}

function humanoidDeath(e: Enemy, a: EnemyAnim, env: AnimEnv, M: Metrics) {
  const t = a.dT;
  deathFx(e, a, env, e.def.hitKind === 'bone' ? 'bone' : e.def.hitKind === 'flesh' ? 'blood' : 'sand');
  const dt = env.dt;
  const recoilK = 1 - smooth(t / 0.2);
  const buckle = smooth((t - 0.12) / 0.38);
  const fall = easeInCubic(clamp01((t - 0.42) / 0.45));
  if (fall >= 1 && !a.impactDone) {
    a.impact = true;
    a.impactDone = true;
    a.bounce.kick(-5);
  }
  const settle = a.impactDone ? wobble(t - 0.87, 2.2, 5) : 0;
  // knees buckle (IK pulls the hips down toward the heels)
  const drop = buckle * M.hipY * (0.42 + 0.1 * a.dDir);
  for (let s = 0; s < 2; s++) {
    const ik = twoBoneIK(M.thigh, M.shin, 0.02 * (s ? 1 : -1), Math.max(0.05, M.hipY - drop), 1);
    S(e, s ? 'thigh_r' : 'thigh_l', ik.upper * (1 - fall * 0.4), 0, (s ? -1 : 1) * (0.08 + buckle * 0.12));
    S(e, s ? 'shin_r' : 'shin_l', ik.lower * (1 - fall * 0.5), 0, 0);
  }
  RO(e, 0, -drop * (1 - fall * 0.6), 0);
  // torso: snap in the push direction, then slump
  const slump = a.dDir > 0 ? 0.55 : -0.35;
  S(e, 'torso', -0.4 * a.dDir * recoilK + slump * buckle, a.dSide * 0.3 * buckle, a.dSide * 0.18 * buckle);
  S(e, 'head', 0.6 * buckle * (a.dDir > 0 ? 1 : -0.6) + settle * 0.3, a.dSide * 0.4 * buckle, 0.2 * buckle);
  const fling = recoilK;
  S(e, 'arm_l', -1.2 * fling - 0.3 * buckle - fall * (a.dDir > 0 ? 1.8 : -0.4), 0, 0.5 * fling + 0.25);
  S(e, 'arm_r', -1.0 * fling - 0.3 * buckle - fall * (a.dDir > 0 ? 1.6 : -0.5), 0, -0.5 * fling - 0.25);
  S(e, 'fore_l', -0.3 - buckle * 0.4, 0, 0);
  S(e, 'fore_r', -0.4 - buckle * 0.4, 0, 0);
  S(e, 'hat', -0.8 * fall, 0, 0.6 * fall);
  // the whole body topples about the feet
  a.tilt = a.dDir * (fall * 1.42 + settle * -0.06);
  a.roll = a.dSide * fall * 0.15;
  // last twitches
  if (t > 1) {
    const tw = Math.exp(-(t - 1) * 5) * vnoise(t * 14, a.seed);
    A(e, 'fore_r', tw * 0.4);
    A(e, 'shin_l', tw * 0.3);
  }
  void dt;
}

// ============================================================= quadruped (sand wolf)
function quad(e: Enemy, a: EnemyAnim, env: AnimEnv, ap: AttackPhase) {
  const t = env.time, dt = env.dt;
  const st = e.state;
  const kind = e.atk?.kind ?? '';
  const sp = a.spd;
  const moving = clamp01(sp / 0.5);
  const gallop = clamp01((sp - 4.5) / 2.5);
  if (!a.tail) a.tail = new ChainFollower(3, 3.2, 0.42);
  if (a.dying) return quadDeath(e, a, env);
  // gait: walk → trot → gallop
  const duty = lerp(sp < 1.6 ? 0.68 : 0.5, 0.36, gallop);
  const legLen = e.def.height * 0.55;
  const amp = legLen * lerp(0.3, 0.55, gallop) * clamp01(sp / 1.2);
  const rate = sp > 0.15 ? clamp(gallop > 0.5 ? 1.7 + sp * 0.06 : cycleRate(sp, Math.max(0.05, amp), duty), 0.6, 3.4) : 0;
  a.gait += rate * dt;
  const G = gallop > 0.5 ? GAITS.gallop : sp < 1.6 ? GAITS.walk4 : GAITS.trot;
  const swingF = lerp(0.42, 0.85, gallop) * moving;
  const swingB = lerp(0.38, 0.75, gallop) * moving;
  const legs: [string, number, boolean][] = [
    ['fl', G.fl, true],
    ['fr', G.fr, true],
    ['bl', G.bl, false],
    ['br', G.br, false],
  ];
  let crouch = 0;
  if (st === 'windup') crouch = ap.antic * (kind === 'leap' ? 1 : 0.4);
  let li = 0;
  for (const [k, off, front] of legs) {
    const l = leg(a.gait + off, duty, _leg);
    const sw = l.sweep * (front ? swingF : swingB);
    const lift = l.lift * moving;
    footfall(e, a, env, li++, l.stance && moving > 0.5, (front ? 0.35 : -0.3) * e.def.height + l.sweep * amp, (k[1] === 'l' ? 1 : -1) * 0.15, 0.4 + gallop * 0.3, 0.3 + gallop * 1.1);
    if (front) {
      S(e, 'leg_' + k, -sw - crouch * 0.3, 0, 0);
      S(e, 'shin_' + k, lift * 1.0 + crouch * 0.7, 0, 0);
      S(e, 'paw_' + k, lift * 0.8 - (l.stance ? l.sweep * 0.2 * moving : 0) - crouch * 0.3, 0, 0);
    } else {
      S(e, 'leg_' + k, -sw - crouch * 0.55, 0, 0);
      S(e, 'shin_' + k, -lift * 0.9 + crouch * -0.6 - 0.05, 0, 0);
      S(e, 'paw_' + k, lift * 0.9 + crouch * 0.5, 0, 0);
    }
  }
  // spine: gallop flexes and extends the back; trot keeps it level
  const flex = Math.sin(a.gait * TAU) * 0.16 * gallop;
  const bob = Math.abs(Math.sin(a.gait * TAU * (gallop > 0.5 ? 1 : 2))) * lerp(0.02, 0.07, gallop) * moving;
  a.lean.step(clamp(sp * 0.008, 0, 0.12), dt);
  a.bank.step(clamp(-a.turn * sp * 0.01, -0.3, 0.3), dt);
  RO(e, 0, bob - crouch * 0.14 - Math.max(0, -a.bounce.x) * 0.02, 0);
  RR(e, -flex * 0.6 + crouch * 0.12 + a.flP.x * 0.4, 0, a.bank.x + a.flR.x * 0.5);
  S(e, 'chest', flex + Math.sin(a.breath) * 0.02, -a.turn * 0.05, 0);
  // head: stabilised, looks at the prey; snarls when winding up
  const toX = env.player.x - e.pos.x, toZ = env.player.z - e.pos.z;
  const lx = toX * Math.cos(e.yaw) - toZ * Math.sin(e.yaw);
  const lz = toX * Math.sin(e.yaw) + toZ * Math.cos(e.yaw);
  const look = lookAngles(lx, env.player.y + 0.6 - (e.pos.y + e.height), lz, 0.9, 0.5);
  a.headY.step(look.yaw, dt);
  a.headP.step(-look.pitch * 0.6, dt);
  let nP = -flex * 0.8 + 0.05 + crouch * 0.25;
  let hP = a.headP.x + Math.sin(a.gait * TAU * 2) * 0.05 * moving;
  let hY = a.headY.x;
  let jaw = sp > 3 ? 0.12 + Math.sin(t * 14) * 0.05 : 0.02; // panting
  if (st === 'windup') jaw = Math.max(jaw, 0.3 * ap.antic); // snarl
  // bite: neck thrust + snap
  if (kind === 'melee' && (st === 'windup' || st === 'strike')) {
    nP = pose(nP, -0.3, 0.45, ap);
    hP = pose(hP, -0.2, 0.25, ap);
    jaw = st === 'strike' ? (e.stateT < 0.08 ? 0.65 : Math.max(0, 0.65 - (e.stateT - 0.08) * 6)) : 0.55 * ap.antic;
    RO(e, 0, 0, 0.3 * ap.strike);
    lungeFx(e, env, 0.9);
  }
  // pounce: coil → stretch out in flight → absorb the landing
  if (st === 'leap') {
    const k = clamp01(e.stateT / 0.75);
    const ext = Math.sin(k * PI);
    if (env.fx && e.stateT <= env.dt * 1.5 && env.camDist < 40) env.fx.burst(e.pos.x, e.pos.y + 0.1, e.pos.z, 'sand', 0.9);
    S(e, 'leg_fl', -1.2 * ext, 0, 0);
    S(e, 'leg_fr', -1.1 * ext, 0, 0);
    S(e, 'shin_fl', 0.2 * ext, 0, 0);
    S(e, 'shin_fr', 0.25 * ext, 0, 0);
    S(e, 'leg_bl', 0.9 * ext, 0, 0);
    S(e, 'leg_br', 1.0 * ext, 0, 0);
    S(e, 'shin_bl', -0.2 * ext, 0, 0);
    S(e, 'shin_br', -0.2 * ext, 0, 0);
    RR(e, lerp(-0.2, 0.25, k), 0, 0);
    jaw = 0.6;
  }
  // taunt: sit back and howl
  if (a.tauntT >= 0) {
    const w = Math.sin(clamp01(a.tauntT / 1.6) * PI);
    A(e, 'leg_bl', -0.9 * w);
    A(e, 'leg_br', -0.9 * w);
    A(e, 'shin_bl', -1.1 * w);
    A(e, 'shin_br', -1.1 * w);
    RO(e, 0, -0.12 * w, 0);
    RR(e, -0.35 * w, 0, 0);
    nP -= 0.85 * w;
    hP -= 0.35 * w;
    jaw = Math.max(jaw, (0.45 + Math.sin(a.tauntT * 6) * 0.08) * w);
  }
  // celebrate: play-bow + wagging
  if (a.dance > 0.01) {
    const w = a.dance;
    const b = Math.sin(t * 6 + a.seed);
    RR(e, 0.28 * w, 0, 0);
    A(e, 'leg_fl', -0.4 * w);
    A(e, 'leg_fr', -0.4 * w);
    RO(e, 0, Math.abs(b) * 0.05 * w, 0);
    hY += b * 0.25 * w;
  }
  const stunned = e.status.stunned();
  if (stunned) {
    hP += Math.sin(t * 3) * 0.2;
    hY += Math.cos(t * 3) * 0.3;
    RR(e, 0, 0, Math.sin(t * 2.2) * 0.12);
  }
  S(e, 'neck', nP + a.flP.x * 0.5, hY * 0.4, 0);
  S(e, 'head', hP, hY * 0.6, a.flR.x * 0.3);
  S(e, 'jaw', jaw);
  // tail chain: whips with turns, droops when hurt, wags when celebrating
  const wag = a.dance > 0.2 || a.tauntT >= 0 ? Math.sin(t * 11) * 0.5 : Math.sin(t * 2.3 + a.seed) * 0.08;
  a.tail.step(-a.turn * 0.25 + wag, dt, a.tailOut);
  const tailUp = st === 'windup' ? 0.35 : -0.15 + gallop * 0.25 - a.low * 0.4;
  for (let i = 0; i < 3; i++) S(e, 'tail' + (i + 1), -tailUp * (i === 0 ? 1 : 0.4), a.tailOut[i], 0);
  // ears: pinned back when attacking, twitching when idle
  const pin = st === 'windup' || st === 'strike' || st === 'leap' ? 0.7 : 0;
  const twitch = vnoise(t * 0.7, a.seed) > 0.75 ? Math.sin(t * 30) * 0.2 : 0;
  S(e, 'ear_l', pin, 0, twitch);
  S(e, 'ear_r', pin, 0, -twitch);
}

function quadDeath(e: Enemy, a: EnemyAnim, env: AnimEnv) {
  const t = a.dT;
  deathFx(e, a, env, 'fur');
  const buckle = smooth(t / 0.4);
  const flop = easeInCubic(clamp01((t - 0.25) / 0.45));
  if (flop >= 1 && !a.impactDone) {
    a.impact = true;
    a.impactDone = true;
  }
  const paddle = t > 0.7 ? Math.exp(-(t - 0.7) * 3) * Math.sin(t * 16) : 0;
  for (const k of ['fl', 'fr', 'bl', 'br']) {
    S(e, 'leg_' + k, -0.4 * buckle + paddle * 0.4, 0, 0);
    S(e, 'shin_' + k, (k[0] === 'f' ? 0.8 : -0.7) * buckle, 0, 0);
  }
  RO(e, 0, -e.def.height * 0.25 * buckle, 0);
  S(e, 'neck', 0.4 * buckle, 0, 0);
  S(e, 'head', 0.3 * buckle, 0, 0.3 * flop);
  S(e, 'jaw', 0.4);
  for (let i = 1; i <= 3; i++) S(e, 'tail' + i, 0.3, 0, 0);
  a.roll = a.dSide * flop * 1.45;
  a.lift = flop * e.def.radius * 0.5;
  void env;
}

// ============================================================= worm
function worm(e: Enemy, a: EnemyAnim, env: AnimEnv, ap: AttackPhase) {
  const M = metrics(e);
  const t = env.time, dt = env.dt;
  const st = e.state;
  const kind = e.atk?.kind ?? '';
  const n = M.nSeg;
  const sp = a.spd;
  a.wave += dt * (1.1 + sp * 0.55 + (a.dying ? 2.5 : 0));
  // rear (cobra) weight: up when erupting / attacking
  let rear = 0;
  if (st === 'windup' || st === 'strike') rear = Math.max(ap.antic, ap.strike * 0.8) * (kind === 'melee' ? 1 : 0.85);
  if (st === 'erupt') {
    const k = clamp01(e.stateT / 0.9);
    rear = Math.sin(Math.min(1, k * 1.4) * PI * 0.5) * (1 - smooth((k - 0.7) / 0.3) * 0.5);
    a.sink = (1 - easeOutCubic(k * 1.6)) * e.height * 1.6;
  } else if (st === 'move' && !a.dying) rear = Math.max(rear, 0.35 + Math.sin(t * 1.3 + a.seed) * 0.08);
  if (st === 'burrow') {
    const k = clamp01(e.stateT / 0.6);
    rear = 0;
    a.sink = easeInCubic(k) * e.height * 1.8;
    if (k >= 1) a.hidden = true;
  }
  if (st === 'spawn') a.hidden = e.stateT < 0.05;
  // travelling wave along the body (lateral S-curve + small vertical ripple)
  const waveAmp = (0.09 + 0.07 * clamp01(sp / 6)) * (a.dying ? 2.2 * Math.max(0, 1 - a.dT / a.dDur) + 0.3 : 1);
  for (let i = 1; i <= n; i++) {
    const k = i / Math.max(1, n);
    const lat = waveAmp * (0.55 + k * 0.6) * Math.sin(a.wave * TAU - i * 0.72);
    const ver = 0.035 * Math.sin(a.wave * TAU * 0.5 - i * 0.55) + (i <= 4 ? (rear * 0.27) : 0);
    S(e, 'seg' + i, ver, lat, 0);
  }
  // head: looks at the prey, rears up, lunges to bite or spit
  const toX = env.player.x - e.pos.x, toZ = env.player.z - e.pos.z;
  const lx = toX * Math.cos(e.yaw) - toZ * Math.sin(e.yaw);
  const lz = toX * Math.sin(e.yaw) + toZ * Math.cos(e.yaw);
  const look = lookAngles(lx, env.player.y + 1 - (e.pos.y + M.rearH * rear), lz, 0.8, 0.6);
  a.headY.step(look.yaw * 0.6, dt);
  let pitch = -rear * 1.05 + a.headP.x;
  a.headP.step(-look.pitch * 0.4, dt);
  let lunge = 0;
  if (kind === 'melee' && (st === 'windup' || st === 'strike')) {
    pitch += pose(0, -0.35, 0.55, ap);
    lunge = 0.9 * ap.strike;
  }
  if (kind === 'lob' && (st === 'windup' || st === 'strike')) pitch += pose(0, -0.45, 0.25, ap);
  RR(e, pitch, a.headY.x, Math.sin(a.wave * TAU - 0.3) * 0.08);
  RO(e, 0, rear * M.rearH - a.sink * 0, lunge);
  // maw: open when rearing, snap on bite, flutter when spitting
  let open = 0.15 + rear * 0.35;
  if (kind === 'melee' && st === 'strike') open = e.stateT < 0.07 ? 1 : Math.max(0, 1 - (e.stateT - 0.07) * 7);
  if (kind === 'lob' && st === 'strike') open = 0.9;
  if (a.dying) open = 0.8 + Math.sin(t * 9) * 0.2;
  if (env.fx && env.camDist < 34 && !a.hidden && st !== 'burrow' && Math.random() < env.dt * (2 + sp * 1.5)) {
    const back = (0.4 + Math.random() * n * 0.35) * M.segLen * e.scale;
    const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
    const x = e.pos.x - sy * back, z = e.pos.z - cy * back;
    env.fx.step(x, env.groundAt(x, z), z, 0.6 * e.scale, 0.8 + rear, Math.cos(e.yaw) * (Math.random() < 0.5 ? 1 : -1), -Math.sin(e.yaw));
  }
  if (a.dying) deathFx(e, a, env, 'sand');
  for (let j = 0; j < M.jaws.length; j++) {
    const i = M.jaws[j];
    const sgn = j % 2 === 0 ? 1 : -1;
    e.rot[i * 3] += -open * 0.55 * sgn;
    e.rot[i * 3 + 1] += open * 0.25 * (j % 4 < 2 ? 1 : -1);
  }
  S(e, 'jaw', open * 0.6);
  if (a.dying) {
    const k = a.dT / a.dDur;
    a.sink = Math.max(a.sink, easeInCubic(clamp01((k - 0.35) / 0.65)) * e.height * 2);
    if (k > 0.5 && !a.impactDone) {
      a.impact = true;
      a.impactDone = true;
    }
  }
}

// ============================================================= insects (beetle / scorpion)
function insect(e: Enemy, a: EnemyAnim, env: AnimEnv, ap: AttackPhase, pairs: 3 | 4) {
  const M = metrics(e);
  const t = env.time, dt = env.dt;
  const st = e.state;
  const kind = e.atk?.kind ?? '';
  const sp = a.spd;
  const moving = clamp01(sp / 0.5);
  const scorp = pairs === 4;
  const flipped = e.flipped > 0;
  const dead = a.dying;
  const frantic = kind === 'explode' && st === 'windup';
  const legLen = e.def.height * (scorp ? 0.6 : 0.8);
  const duty = scorp ? 0.6 : 0.55;
  const amp = legLen * 0.3;
  let rate = sp > 0.1 ? clamp(cycleRate(sp, amp, duty), 1, 6) : 0;
  if (frantic || flipped) rate = 7;
  a.gait += rate * dt;
  const G = scorp ? GAITS.tetrapod : GAITS.tripod;
  const sweepAmp = (scorp ? 0.34 : 0.42) * (moving || frantic || flipped ? 1 : 0);
  const liftAmp = scorp ? 0.32 : 0.38;
  // death: beetles flip legs-up; scorpions curl
  let curl = 0, flail = 0;
  if (dead) {
    const k = a.dT;
    if (!scorp) {
      const flip = easeOutBack(clamp01(k / 0.35), 1.2);
      a.roll = flip * PI;
      a.lift = Math.sin(clamp01(k / 0.35) * PI) * 0.35 * e.scale + flip * e.def.height * 0.85;
      flail = Math.exp(-k * 2.2);
      curl = smooth((k - 0.4) / 0.6);
      if (k > 0.35 && !a.impactDone) {
        a.impact = true;
        a.impactDone = true;
      }
    } else {
      curl = smooth(k / 0.7);
      a.roll = a.dSide * smooth((k - 0.2) / 0.6) * 0.5;
      flail = Math.exp(-k * 3) * 0.6;
      if (k > 0.6 && !a.impactDone) {
        a.impact = true;
        a.impactDone = true;
      }
    }
  }
  for (let i = 1; i <= pairs; i++) {
    for (const sideName of ['l', 'r'] as const) {
      const off = (G as Record<string, number>)[sideName + i] ?? 0;
      const l = leg(a.gait + off, duty, sideName === 'l' ? _leg : _leg2);
      const sgn = sideName === 'l' ? 1 : -1;
      // sweep about Y (fore/aft), lift about Z (tip up)
      let yaw = -sgn * l.sweep * sweepAmp;
      let lift = sgn * l.lift * liftAmp * (moving || frantic || flipped ? 1 : 0);
      // idle: subtle shifting and tapping
      if (!moving && !frantic && !flipped) {
        yaw += sgn * vnoise(t * 0.8 + i * 3.1 + (sideName === 'l' ? 0 : 7), a.seed) * 0.05;
        lift += sgn * Math.max(0, vnoise(t * 1.3 + i * 5.7, a.seed) - 0.6) * 0.5;
      }
      if (flipped || dead) {
        yaw += Math.sin(t * 24 + i * 1.7 + sgn) * 0.45 * (flipped ? 1 : flail);
        lift += sgn * (0.35 + Math.sin(t * 19 + i * 2.3) * 0.4) * (flipped ? 1 : flail);
      }
      // death curl: legs fold in toward the body
      lift += sgn * curl * (scorp ? -0.7 : 0.9);
      yaw += -sgn * curl * 0.25 * (i - (pairs + 1) / 2);
      S(e, 'leg_' + sideName + i, 0, yaw, lift);
    }
  }
  if (env.fx && env.camDist < 28 && moving > 0.5 && !dead && Math.random() < env.dt * sp * 0.6) env.fx.step(e.pos.x, e.pos.y, e.pos.z, 0.35 * e.scale, 0.4, -Math.sin(e.yaw), -Math.cos(e.yaw));
  if (dead) deathFx(e, a, env, 'chitin');
  if (kind === 'melee' || kind === 'charge') lungeFx(e, env, scorp ? 1.1 : 0.6);
  // body: bob with the gait, align with the ground slope, flinch
  const bob = Math.abs(Math.sin(a.gait * TAU * 2)) * 0.012 * moving;
  let bodyP = a.flP.x * 0.35;
  let bodyR = a.flR.x * 0.35;
  if (env.camDist < 35 && !dead) {
    const f = e.def.radius * 1.2;
    const gf = env.groundAt(e.pos.x + Math.sin(e.yaw) * f, e.pos.z + Math.cos(e.yaw) * f);
    const gb = env.groundAt(e.pos.x - Math.sin(e.yaw) * f, e.pos.z - Math.cos(e.yaw) * f);
    bodyP += clamp(Math.atan2(gb - gf, 2 * f), -0.5, 0.5);
  }
  // melee: rear up, then snap down onto the target
  if (kind === 'melee' && (st === 'windup' || st === 'strike')) bodyP += pose(0, -0.45, 0.28, ap);
  if (frantic) {
    bodyP += Math.sin(t * 33) * 0.05;
    bodyR += Math.cos(t * 29) * 0.06;
  }
  if (a.tauntT >= 0 && !scorp) {
    // beetle taunt: rear up on the back legs and wiggle
    const w = Math.sin(clamp01(a.tauntT / 1.6) * PI);
    bodyP -= 0.5 * w;
    bodyR += Math.sin(a.tauntT * 14) * 0.15 * w;
  }
  if (a.dance > 0.01) {
    bodyR += Math.sin(t * 7 + a.seed) * 0.15 * a.dance;
    RO(e, 0, Math.abs(Math.sin(t * 7)) * 0.03 * a.dance, 0);
  }
  RO(e, 0, bob - Math.max(0, -a.bounce.x) * 0.015 - (dead && scorp ? curl * e.def.height * 0.2 : 0), 0);
  RR(e, bodyP, 0, bodyR);
  // head / antennae / mandibles
  const twitch = vnoise(t * 2.2, a.seed) * 0.12;
  S(e, 'head', -ap.antic * 0.3 + ap.strike * 0.4 + twitch * 0.5, twitch, 0);
  const ant = Math.sin(t * 5 + a.seed) * 0.15 + vnoise(t * 3, a.seed + 2) * 0.2;
  S(e, 'antenna_l', ant, 0, 0.1);
  S(e, 'antenna_r', -ant * 0.8, 0, -0.1);
  const snapM = st === 'windup' ? ap.antic * 0.5 : st === 'strike' ? Math.max(0, 0.5 - e.stateT * 4) : Math.max(0, Math.sin(t * 4 + a.seed)) * 0.12;
  S(e, 'mandible_l', 0, -snapM, 0);
  S(e, 'mandible_r', 0, snapM, 0);
  // elytra: flutter when agitated / flipped / bomb ticking
  const wings = flipped ? 0.8 + Math.sin(t * 40) * 0.2 : frantic ? 0.4 + Math.sin(t * 55) * 0.25 : st === 'windup' ? 0.3 * ap.antic : 0;
  S(e, 'wing_l', 0, 0, wings);
  S(e, 'wing_r', 0, 0, -wings);
  if (scorp) {
    if (!a.tail) a.tail = new ChainFollower(Math.max(1, M.nTail), 2.6, 0.5);
    // tail: sways, cocks back in the wind-up, strikes forward, curls when dying
    let cock = 0.28 + Math.sin(t * 1.6 + a.seed) * 0.04;
    if (st === 'windup') cock += ap.antic * 0.45 + ap.tension * Math.sin(t * 40) * 0.03;
    if (st === 'strike') cock -= ap.strike * 0.7 - ap.follow * 0.15;
    if (st === 'charge') cock += 0.25;
    cock += curl * 0.6;
    a.tail.step(-a.turn * 0.15 + Math.sin(t * 1.1 + a.seed) * 0.08, dt, a.tailOut);
    for (let i = 1; i <= M.nTail; i++) S(e, 'tail' + i, -cock - (i > 3 ? 0.05 : 0), a.tailOut[i - 1] ?? 0, 0);
    S(e, 'stinger', -cock * 1.1, 0, 0);
    // pincers: idle clacking, open wide in the wind-up / charge
    const clack = Math.max(0, Math.sin(t * 5 + e.quirk * 3)) * 0.25;
    const open = st === 'windup' ? ap.antic * 0.6 : st === 'charge' ? 0.55 : clack;
    const reach = st === 'charge' ? 0.35 : st === 'strike' && kind === 'melee' ? ap.strike * 0.5 : 0;
    S(e, 'arm_l', -reach * 0.3, -0.18 - open * 0.35 + reach + curl * 0.6, -curl * 0.3);
    S(e, 'arm_r', -reach * 0.3, 0.18 + open * 0.35 - reach - curl * 0.6, curl * 0.3);
    S(e, 'pincer_l', 0, -open, 0);
    S(e, 'pincer_r', 0, open, 0);
  }
}

// ============================================================= bird
function bird(e: Enemy, a: EnemyAnim, env: AnimEnv, ap: AttackPhase) {
  const t = env.time, dt = env.dt;
  const st = e.state;
  const diving = st === 'dive';
  a.wave += dt * (diving ? 0.5 : 2.4 + (e.vel.y > 0 ? 1.2 : 0));
  // asymmetric flap: powerful fast downstroke, slower recovery
  const p = a.wave - Math.floor(a.wave);
  const flap = p < 0.4 ? 1 - 2 * smoother(p / 0.4) : -1 + 2 * smoother((p - 0.4) / 0.6);
  const glide = clamp01(-e.vel.y / 4);
  let w = flap * lerp(0.75, 0.15, glide) + 0.15;
  if (diving) w = -0.55 + Math.sin(t * 30) * 0.04;
  if (a.dying) {
    const k = a.dT;
    w = Math.sin(t * 17) * 0.8 * Math.exp(-k * 2);
    a.tilt = k * 3.5;
    a.roll = Math.sin(k * 6) * 0.8;
    if (!a.impactDone && e.pos.y <= env.groundAt(e.pos.x, e.pos.z) + 0.2) {
      a.impact = true;
      a.impactDone = true;
    }
  }
  S(e, 'wing_l', 0, 0, w);
  S(e, 'wing_r', 0, 0, -w);
  const toX = env.player.x - e.pos.x, toZ = env.player.z - e.pos.z;
  const lx = toX * Math.cos(e.yaw) - toZ * Math.sin(e.yaw);
  const lz = toX * Math.sin(e.yaw) + toZ * Math.cos(e.yaw);
  const look = lookAngles(lx, env.player.y - e.pos.y, lz, 1.2, 0.9);
  a.headY.step(look.yaw, dt);
  a.headP.step(-look.pitch * 0.6, dt);
  S(e, 'head', a.headP.x - 0.25 + (diving ? 0.5 : 0) + flap * 0.06, a.headY.x, 0);
  S(e, 'tail', Math.sin(t * 3) * 0.1 + flap * 0.08, a.turn * -0.2, 0);
  a.bank.step(clamp(-a.turn * 0.35, -0.6, 0.6), dt);
  RR(e, (diving ? 0.9 : 0.1 - glide * 0.1) + a.flP.x * 0.4, 0, a.bank.x + a.flR.x * 0.4);
  RO(e, 0, -flap * 0.05, 0);
  void ap;
}

// ============================================================= snake (bell snake)
function snake(e: Enemy, a: EnemyAnim, env: AnimEnv, ap: AttackPhase) {
  const M = metrics(e);
  const t = env.time, dt = env.dt;
  const st = e.state;
  const n = M.nSeg;
  const sp = a.spd;
  const L = Math.max(0.05, M.segLen);
  // serpenoid curve: sinusoidal curvature travelling back along the body at body speed
  const lambda = 6 * L;
  const rate = sp > 0.1 ? sp / lambda : 0.12;
  a.wave += rate * dt * (a.dying ? 3 : 1);
  const coil = st === 'windup' ? ap.antic : 0;
  const striking = st === 'leap';
  const wrap = st === 'wrap';
  let amp = (0.24 + coil * 0.26) * (striking ? 0.15 : 1);
  if (a.dying) amp = 0.5 * Math.max(0.1, 1 - a.dT / a.dDur) + 0.1;
  const kSeg = (TAU / 6) * (1 + coil * 0.5);
  let rearLift = 0.1 * clamp01(sp / 1.5) + 0.06;
  let rearPitch = -0.12;
  if (coil > 0) {
    rearLift = lerp(rearLift, M.rearH * 0.55, coil);
    rearPitch = lerp(rearPitch, -0.65, coil);
  }
  if (striking) {
    const k = clamp01(e.stateT / 0.75);
    rearLift = 0.4 * Math.sin(k * PI);
    rearPitch = lerp(-0.3, 0.25, k);
  }
  if (a.dance > 0.01) {
    // charmed-cobra sway over the fallen hunter
    rearLift = lerp(rearLift, M.rearH * 0.7, a.dance);
    rearPitch = lerp(rearPitch, -0.8, a.dance);
  }
  const tension = ap.tension * Math.sin(t * 50) * 0.03;
  if (wrap) {
    // coil around the hunter: constant turn per joint + steady descent = helix
    const R = 0.42;
    const turn = Math.min(1.25, 2 * Math.asin(Math.min(0.99, L / (2 * R)))) * (1 + Math.sin(t * 6) * 0.04);
    const drop = Math.min(0.12, 1.45 / Math.max(1, n));
    for (let i = 1; i <= n; i++) {
      S(e, 'seg' + i, 0.02, turn, 0);
      O(e, 'seg' + i, 0, -drop, 0);
    }
    RO(e, 0, 1.45, 0);
    RR(e, 0.25 + Math.sin(t * 6) * 0.04, 0.5, 0);
  } else {
    for (let i = 1; i <= n; i++) {
      const taper = Math.min(1, 0.3 + i * 0.18);
      const lat = amp * taper * Math.sin(a.wave * TAU - i * kSeg) + tension;
      // the first segments carry the reared neck back down to the sand
      const pitch = i <= 3 ? -rearPitch * 0.33 : 0;
      S(e, 'seg' + i, pitch, lat, 0);
    }
    // head held steady (counter the wave) and aimed at the prey
    const toX = env.player.x - e.pos.x, toZ = env.player.z - e.pos.z;
    const lx = toX * Math.cos(e.yaw) - toZ * Math.sin(e.yaw);
    const lz = toX * Math.sin(e.yaw) + toZ * Math.cos(e.yaw);
    const look = lookAngles(lx, env.player.y + 1 - (e.pos.y + rearLift), lz, 0.7, 0.5);
    a.headY.step(look.yaw * 0.7, dt);
    const sway = a.dance > 0.01 ? Math.sin(t * 2.1) * 0.45 * a.dance : 0;
    RR(e, rearPitch + a.flP.x * 0.3, -amp * 0.4 * Math.sin(a.wave * TAU) + a.headY.x + sway, a.flR.x * 0.3);
    RO(e, 0, rearLift, striking ? 0.3 : 0);
  }
  if (env.fx && env.camDist < 34 && !wrap && sp > 0.8 && Math.random() < env.dt * 3) {
    const back = Math.random() * n * L * e.scale;
    const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
    const x = e.pos.x - sy * back, z = e.pos.z - cy * back;
    env.fx.step(x, env.groundAt(x, z), z, 0.45 * e.scale, 0.5, Math.cos(e.yaw) * (Math.random() < 0.5 ? 1 : -1), -Math.sin(e.yaw));
  }
  if (striking && env.fx && e.stateT <= dt * 1.5 && env.camDist < 40) env.fx.burst(e.pos.x, e.pos.y + 0.1, e.pos.z, 'sand', 1);
  if (a.dying) deathFx(e, a, env, 'blood');
  // rattle: warning shake before strikes, nervous buzz now and then
  const buzz = coil > 0 ? 1 : wrap ? 0.6 : vnoise(t * 0.4, a.seed) > 0.55 ? 0.7 : 0;
  S(e, 'rattle', Math.sin(t * 47) * 0.12 * buzz, Math.sin(t * 61) * 0.55 * buzz, 0);
  // fangs out at full coil, wide on the strike, hissing while wrapped
  let jaw = 0.05;
  if (coil > 0.6) jaw = (coil - 0.6) * 1.6;
  if (striking || (st === 'strike' && e.atk?.kind === 'melee')) jaw = 0.75;
  if (st === 'windup' && e.atk?.kind === 'melee') jaw = ap.antic * 0.6;
  if (wrap) jaw = 0.25 + Math.abs(Math.sin(t * 3)) * 0.2;
  if (a.dying) jaw = 0.6;
  S(e, 'jaw', jaw);
  if (a.dying) {
    a.roll = smooth(a.dT / 0.9) * PI * 0.85 * a.dSide;
    if (a.dT > 0.5 && !a.impactDone) {
      a.impact = true;
      a.impactDone = true;
    }
  }
}

// ============================================================= lizard (thorny devil)
function lizard(e: Enemy, a: EnemyAnim, env: AnimEnv, ap: AttackPhase) {
  const t = env.time, dt = env.dt;
  const st = e.state;
  const kind = e.atk?.kind ?? '';
  const sp = a.spd;
  const moving = clamp01(sp / 0.4);
  const dead = a.dying;
  const rate = sp > 0.15 ? clamp(cycleRate(sp, 0.12, 0.5), 2, 7.5) : 0;
  a.gait += rate * dt;
  // territorial push-ups: the squirt wind-up and the taunt
  const display = (st === 'windup' && kind === 'stream' ? ap.antic : 0) + (a.tauntT >= 0 ? Math.sin(clamp01(a.tauntT / 1.6) * PI) : 0);
  const push = display > 0 ? (0.5 + 0.5 * Math.sin(t * 8.5)) * Math.min(1, display) : 0;
  // inflate while displaying; deflate with the squirt
  const puffT = st === 'windup' && kind === 'stream' ? ap.antic : st === 'strike' && kind === 'stream' ? 0.2 : display * 0.5;
  a.puff = damp(a.puff, dead ? 0 : puffT, 8, dt);
  const G = GAITS.trot;
  const legs: [string, string, number, number, boolean][] = [
    ['fl', 'l1', G.fl, 1, true],
    ['fr', 'r1', G.fr, -1, true],
    ['bl', 'l2', G.bl, 1, false],
    ['br', 'r2', G.br, -1, false],
  ];
  let flipK = 0;
  if (dead) {
    flipK = easeOutBack(clamp01(a.dT / 0.35), 1.2);
    a.roll = flipK * PI;
    a.lift = Math.sin(clamp01(a.dT / 0.35) * PI) * 0.3 + flipK * e.def.height * 0.8;
    if (a.dT > 0.35 && !a.impactDone) {
      a.impact = true;
      a.impactDone = true;
    }
  }
  for (const [k, alt, off, sgn, front] of legs) {
    const l = leg(a.gait + off, 0.5, _leg);
    // sprawled legs: sweep fore/aft about Y, lift the knee about Z
    let yaw = -sgn * l.sweep * 0.55 * moving;
    let lift = sgn * l.lift * 0.45 * moving;
    if (front) lift += sgn * push * 0.55; // straighten the front legs: body rises
    if (dead) {
      yaw += Math.sin(t * 22 + off * 9) * 0.5 * Math.exp(-a.dT * 2);
      lift += sgn * (0.4 + smooth((a.dT - 0.4) / 0.6) * 0.6);
    }
    footfall(e, a, env, front ? (sgn > 0 ? 0 : 1) : sgn > 0 ? 2 : 3, l.stance && moving > 0.5, front ? 0.18 : -0.15, sgn * 0.18, 0.28, 0.5);
    S(e, 'leg_' + k, 0, yaw, lift);
    S(e, 'leg_' + alt, 0, yaw, lift);
    S(e, 'foot_' + k, 0, -yaw * 0.5, -lift * 0.8);
    S(e, 'foot_' + alt, 0, -yaw * 0.5, -lift * 0.8);
  }
  if (dead) deathFx(e, a, env, 'chitin');
  if (kind === 'melee') lungeFx(e, env, 0.5);
  // spine wave + tail swish, phased with the stride
  const spine = Math.sin(a.gait * TAU) * 0.2 * moving;
  if (!a.tail) a.tail = new ChainFollower(3, 4.5, 0.4);
  a.tail.step(-a.turn * 0.2 - spine * 0.8, dt, a.tailOut);
  for (let i = 1; i <= 3; i++) S(e, 'tail' + i, display > 0 ? -0.2 * display : 0.02, a.tailOut[i - 1] - Math.sin(a.gait * TAU - i * 0.9) * 0.25 * moving, 0);
  RR(e, -push * 0.28 - ap.strike * 0.15 + a.flP.x * 0.3, spine, a.flR.x * 0.3);
  RO(e, 0, push * 0.07, 0);
  // jerky head: snaps to new look targets, bobs when displaying, jerks up to squirt
  a.snapIn -= dt;
  if (a.snapIn <= 0) {
    const toX = env.player.x - e.pos.x, toZ = env.player.z - e.pos.z;
    const lx = toX * Math.cos(e.yaw) - toZ * Math.sin(e.yaw);
    const lz = toX * Math.sin(e.yaw) + toZ * Math.cos(e.yaw);
    a.snapYaw = clamp(Math.atan2(lx, Math.max(0.1, lz)), -0.8, 0.8) + (Math.random() - 0.5) * 0.3;
    a.snapIn = 0.35 + Math.random() * 0.9;
  }
  a.headY.freq = 7;
  a.headY.zeta = 0.75;
  a.headY.step(a.snapYaw, dt);
  const bobH = display > 0 ? Math.sin(t * 17) * 0.12 * display : 0;
  S(e, 'head', bobH - ap.strike * 0.45 + a.flP.x * 0.3, a.headY.x, 0);
  S(e, 'jaw', kind === 'stream' && st === 'strike' ? 0.35 : kind === 'melee' && st === 'strike' ? 0.6 : 0.03);
}
