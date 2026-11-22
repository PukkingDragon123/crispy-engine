// THE ROLLING STONE (enemy behaviour + procedural roll). A rune-carved living
// boulder on the charger AI: it rolls after you, picks up moss and sand pads as
// it goes (rig parts revealed one by one), revs in place before a charge, and
// when a charge ends it CRASHES: a shard burst you can read and slip, the
// gathered moss shaken off. Its hop lands as a slam ring. Death crumbles it into
// its real fracture chunks (the rig is split, so the ragdoll breaks it apart).
// Songs: It's Only Rock 'n Roll (charge), Trampled Under Foot (Led Zeppelin, the hop),
// Dazed and Confused (Led Zeppelin, the shard ring), Torn and Frayed (the crash),
// Let There Be Rock (AC/DC, the elite's lobbed rocks).
// Hooks: Enemies.think (stoneThink), the death specials (stoneDeath) and
// anim/enemyAnim's default branch (rollingStoneAnim).
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Enemy, Enemies, PlayerLink } from './Enemies';
import type { EnemyAnim, AnimEnv } from '../anim/enemyAnim';

interface StoneState {
  roll: number;
  spin: number;
  dist: number;
  moss: number;
  prev: string;
  revT: number;
  wob: number;
}
const S = new WeakMap<Enemy, StoneState>();
const st = (e: Enemy): StoneState => {
  let s = S.get(e);
  if (!s) S.set(e, (s = { roll: 0, spin: 0, dist: 0, moss: 0, prev: '', revT: 0, wob: 0 }));
  return s;
};
const MOSS_EVERY = 7; // metres rolled per pad gathered
const STONE = [0x8a7a68, 0x6a5f55, 0xa89a84, 0x5c5248];
const MOSSC = [0x3f6e2a, 0x55883a, 0x7aa848];
const _v = new THREE.Vector3();

/** per-frame behaviour on top of the charger AI */
export function stoneThink(ctx: Ctx, en: Enemies, pl: PlayerLink, e: Enemy, dt: number, ground: number) {
  const s = st(e);
  const sp = Math.hypot(e.vel.x, e.vel.z);
  const R = (e.batch.meta.roll?.radius ?? 0.85) * e.scale;
  const at = { x: e.pos.x, y: ground + 0.1, z: e.pos.z };
  // gathering: moss and sand stick as it rolls
  if (e.state === 'move' || e.state === 'charge') {
    s.dist += sp * dt;
    const want = Math.min(6, Math.floor(s.dist / MOSS_EVERY));
    if (want > s.moss) {
      s.moss = want;
      ctx.particles.emit({ pos: { x: at.x, y: ground + R, z: at.z }, count: 6, spread: 1.2, up: 1, life: [0.4, 0.8], size: [0.08, 0.04], sprite: ['grain0', 'grain1', 'leaf'], color: [0xeccb8f, 0x55883a, 0xd2a46c], gravity: 6, drag: 0.6, jitter: R * 0.6 });
    }
    // the tread churns sand behind it (more as it speeds up)
    if (sp > 2 && Math.random() < dt * (4 + sp * 1.4)) {
      const bx = -e.vel.x / (sp || 1), bz = -e.vel.z / (sp || 1);
      ctx.particles.emit({ pos: { x: at.x + bx * R * 0.8, y: ground + 0.15, z: at.z + bz * R * 0.8 }, count: 3, vel: { x: bx * sp * 0.3, y: 1.4 + sp * 0.12, z: bz * sp * 0.3 }, spread: 0.8, life: [0.5, 1.1], size: [0.35, 0.9], sprite: ['puff0', 'puff1'], color: 0xe6cf9f, alpha: 0.5, drag: 1.4, gravity: -0.3 });
    }
  }
  // revving: it grinds in place, spinning up before a charge (the readable tell)
  if (e.state === 'windup' && e.atk?.kind === 'charge') {
    s.revT += dt;
    if (Math.random() < dt * 16) {
      const bx = -Math.sin(e.yaw), bz = -Math.cos(e.yaw);
      ctx.particles.emit({ pos: { x: at.x + bx * R * 0.9, y: ground + 0.1, z: at.z + bz * R * 0.9 }, count: 4, vel: { x: bx * 6, y: 3, z: bz * 6 }, spread: 1.6, life: [0.4, 0.8], size: [0.1, 0.05], sprite: ['grain0', 'grain2', 'pebble'], color: [0xeccb8f, 0xcf9a5a, 0x8a7a68], gravity: 9, drag: 0.4, ground: true, bounce: 0.3 });
    }
    if (Math.floor(s.revT / 0.22) !== Math.floor((s.revT - dt) / 0.22)) ctx.sfx('rock_crumble', at, 0.35, 1.5 + s.revT * 0.5);
  } else s.revT = 0;
  // the hop lands: Trampled Under Foot
  if (s.prev === 'leap' && e.state === 'recover' && !e.dodged) {
    const r = 3.4 * e.scale;
    ctx.world.sand.ring(e.pos.x, e.pos.z, { speed: 7, height: 0.35, width: 1.2, life: 0.9 });
    ctx.fx.sandBurst(at, 1.4 * e.scale);
    ctx.fx.dust(at, r * 0.5, 0xe6cf9f, 6);
    ctx.sfx('explosion', at, 0.55, 0.7);
    ctx.shake(0.35);
    const pd = Math.hypot(pl.pos.x - e.pos.x, pl.pos.z - e.pos.z);
    if (pd < r && pl.pos.y < ground + 1.6) pl.takeHit({ base: (e.atk?.dmg ?? 18) * e.dmgMul, kind: 'phys', source: 'contact', knock: 11 }, e.pos);
  }
  // the charge ends in a crash: Torn and Frayed
  if (s.prev === 'charge' && e.state !== 'charge') crash(ctx, en, e, ground, s);
  s.prev = e.state;
}

function crash(ctx: Ctx, en: Enemies, e: Enemy, ground: number, s: StoneState) {
  const R = (e.batch.meta.roll?.radius ?? 0.85) * e.scale;
  const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
  const at = { x: e.pos.x + fx * R * 0.6, y: ground + R * 0.6, z: e.pos.z + fz * R * 0.6 };
  en.callout('Torn and Frayed', { x: e.pos.x, y: ground + R * 2 + 0.8, z: e.pos.z }, e.alpha ? 'elite' : 'normal');
  ctx.sfx('rock_crumble', at, 0.9, 0.8);
  ctx.sfx('ore_crack', at, 0.7, 0.9);
  ctx.shake(0.4);
  ctx.world.deform(at.x, at.z, R * 0.7, 0.25);
  ctx.fx.dust(at, R * 1.2, 0xd9c19a, 8);
  ctx.particles.emit({ pos: at, count: 18, spread: 6, up: 4, life: [0.6, 1.2], size: [0.12, 0.06], sprite: ['pebble', 'chip', 'rock'], color: STONE, gravity: 14, drag: 0.3, ground: true, bounce: 0.35, rot: 6, rotSpeed: 8 });
  // the moss it gathered shakes off
  if (s.moss > 0) {
    ctx.particles.emit({ pos: { x: e.pos.x, y: ground + R, z: e.pos.z }, count: 6 + s.moss * 3, spread: 3, up: 3, life: [0.8, 1.5], size: [0.12, 0.06], sprite: ['leaf', 'twig', 'grain1'], color: [...MOSSC, 0xdcb478], gravity: 5, drag: 1, rot: 6, rotSpeed: 4 });
    s.moss = Math.floor(s.moss / 2);
    s.dist = s.moss * MOSS_EVERY;
  }
  // the crash throws a ring of rock shards, slow enough to read and slip between
  const n = e.alpha ? 14 : 9;
  const phase = Math.random() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    en.proj.spawn({ kind: 'sand', x: at.x, y: ground + 0.7, z: at.z, vx: Math.sin(a) * 9.5, vy: 0, vz: Math.cos(a) * 9.5, dmg: 7 * e.dmgMul, sourceId: e.id, life: 1.6 });
  }
}

/** death: the boulder bursts along its seams (the chunks themselves fly as ragdoll pieces) */
export function stoneDeath(ctx: Ctx, e: Enemy) {
  const R = (e.batch.meta.roll?.radius ?? 0.85) * e.scale;
  const c = { x: e.pos.x, y: e.pos.y + R, z: e.pos.z };
  ctx.sfx('rock_crumble', c, 1, 0.7);
  ctx.sfx('ore_crack', c, 0.9, 0.7);
  ctx.shake(e.alpha ? 0.6 : 0.35);
  ctx.fx.dust(c, R * 1.6, 0xcbb894, 10);
  ctx.particles.emit({ pos: c, count: 30, spread: 7, up: 5, life: [0.7, 1.6], size: [0.16, 0.07], sprite: ['pebble', 'chip', 'rock'], color: STONE, gravity: 14, drag: 0.25, ground: true, bounce: 0.4, rot: 6, rotSpeed: 9 });
  ctx.particles.emit({ pos: c, count: 10, spread: 2, up: 1.5, life: [1.4, 2.6], size: [1.0, 2.4], sprite: ['cloud0', 'puff1'], color: 0xbfae8e, alpha: 0.55, drag: 1.5, gravity: -0.2, jitter: R });
  // the runes die out in a last flare of embers
  ctx.particles.emit({ pos: c, count: 14, spread: 3, up: 2.5, life: [0.6, 1.2], size: [0.07, 0.02], sprite: 'ember', color: e.alpha ? 0xfff2c4 : 0xffa43a, additive: true, gravity: -1, drag: 1.2, jitter: R * 0.7 });
}

/** procedural animation: the roll (about local X), the rev, the settle that brings its face upright */
export function rollingStoneAnim(e: Enemy, a: EnemyAnim, env: AnimEnv) {
  const s = st(e);
  const dt = env.dt;
  const pi = e.batch.partIndex;
  const R = (e.batch.meta.roll?.radius ?? 0.85) * e.scale;
  const core = pi['core'];
  if (a.dying) {
    // a last shudder before it bursts
    s.wob += dt * 40;
    if (core !== undefined) {
      e.rot[core * 3] = s.roll + Math.sin(s.wob) * 0.05;
      e.rot[core * 3 + 2] = Math.sin(s.wob * 1.3) * 0.04;
    }
    return;
  }
  const revving = e.state === 'windup' && e.atk?.kind === 'charge';
  if (revving) {
    // it rocks back on its heel and spins up faster and faster
    s.spin = Math.min(22, s.spin + dt * 30);
    s.roll += s.spin * dt;
    a.tilt = -0.08 - Math.sin(env.time * 30) * 0.02;
  } else if (e.state === 'windup' && e.atk?.kind === 'leap') {
    // gathering for the hop: it sinks and squashes
    a.sink = Math.min(0.25, e.stateT * 0.4) * e.scale;
    s.spin = Math.max(0, s.spin - dt * 20);
  } else {
    // rolling: angle follows the distance travelled; idle it settles face-up toward the hunter
    s.spin = Math.max(0, s.spin - dt * 30);
    s.roll += (a.fwd / Math.max(0.3, R)) * dt + s.spin * dt;
    if (a.spd < 0.6 && s.spin < 0.5 && (e.state === 'move' || e.state === 'recover')) {
      const k = Math.round(s.roll / (Math.PI * 2)) * Math.PI * 2;
      s.roll += (k - s.roll) * (1 - Math.exp(-4 * dt));
    }
  }
  if (core !== undefined) {
    e.rot[core * 3] = s.roll;
    // a little lumpy wobble: it is not round
    e.rot[core * 3 + 2] = Math.sin(s.roll * 0.5 + a.seed) * 0.05 * Math.min(1, a.spd / 3);
  }
  // bouncing over its own facets
  a.lift = Math.abs(Math.sin(s.roll * 2.5)) * 0.035 * Math.min(1, a.spd / 4) * e.scale;
  // the eyes find you when it stops
  const eyeL = pi['eye_l'], eyeR = pi['eye_r'];
  if (eyeL !== undefined && eyeR !== undefined) {
    const dx = env.player.x - e.pos.x, dz = env.player.z - e.pos.z;
    const yawTo = Math.atan2(dx, dz) - e.yaw;
    const look = Math.max(-0.5, Math.min(0.5, Math.atan2(Math.sin(yawTo), Math.cos(yawTo))));
    e.rot[eyeL * 3 + 1] = look;
    e.rot[eyeR * 3 + 1] = look;
  }
  // moss and sand pads appear as they are gathered
  for (let k = 1; k <= 6; k++) {
    const i = pi['moss_' + k];
    if (i !== undefined) e.hidden[i] = k <= s.moss ? 0 : 1;
  }
}

/** world position helper for callers that want the stone's top (song titles, telegraphs) */
export function stoneTop(e: Enemy, out = _v) {
  const R = (e.batch.meta.roll?.radius ?? 0.85) * e.scale;
  return out.set(e.pos.x, e.pos.y + R * 2, e.pos.z);
}
