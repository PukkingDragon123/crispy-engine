// Enemy manager: spawning, AI archetypes, telegraphed attacks, expressive
// procedural animation (anticipation, squash/stretch, recoil, jaw screams),
// damage pipeline hookup, limb loss, ragdoll death pieces, ramming + counters.
import * as THREE from 'three';
import type { Ctx, EnemyApi, EnemyLike, RayHit } from '../Ctx';
import { ENEMIES, EnemyDef, AttackDef, waveScale } from './EnemyDefs';
import { EnemyRender, RigBatch } from './EnemyRender';
import { Projectiles } from './Projectiles';
import { StatusSet, STATUS_INFO, COMBO_INFO } from '../combat/Status';
import { Hit, resolveHit, doomCheck } from '../combat/Damage';
import type { StatSheet } from '../combat/Stats';
import { clamp, damp, dampAngle, rnd, wrapAngle } from '../../engine/math/rand';
import { P } from '../../engine/voxel/palette';
import { Spring } from '../../engine/Tween';
import { EyeState, EyeStyle } from '../fx/FaceFx';

/** 2D eye look per enemy type: organic (white + pupil) for critters & jackals, glowing embers for the undead */
const EYE_LOOK: Record<string, [EyeStyle, number]> = {
  scarab: ['organic', 0x1a1008],
  bombScarab: ['organic', 0x1a1008],
  goldenScarab: ['organic', 0x1a1008],
  vulture: ['organic', 0x2a1408],
  jackal: ['organic', 0xd8a020],
  jackalArcher: ['organic', 0xd8a020],
  giantScorpion: ['organic', 0x1a0808],
  mummy: ['glow', 0x7fe0ff],
  bandageWhipper: ['glow', 0x7fe0ff],
  mariachi: ['glow', 0xffc040],
};

type Skel = 'humanoid' | 'beetle' | 'scorpion' | 'bird' | 'other';

export interface PlayerLink {
  pos: THREE.Vector3;
  board: { vel: THREE.Vector3; speed: number; impulse: THREE.Vector3; grounded: boolean };
  stats: StatSheet;
  status: StatusSet;
  alive: boolean;
  center(out?: THREE.Vector3): THREE.Vector3;
  takeHit(h: Hit, from?: THREE.Vector3): number;
  speed: number;
}

export interface ExternalTarget extends EnemyLike {
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null;
  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3): number;
}

let NEXT_ID = 1;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Enemy implements EnemyLike {
  id = NEXT_ID++;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  radius: number;
  height: number;
  alive = true;
  isBoss = false;
  name: string;
  flying?: boolean;
  status = new StatusSet();
  state: 'spawn' | 'move' | 'windup' | 'strike' | 'recover' | 'stagger' | 'hidden' | 'charge' | 'leap' | 'dive' = 'spawn';
  stateT = 0;
  atk: AttackDef | null = null;
  cds: number[];
  scale: number;
  dmgMul: number;
  spdMul: number;
  armor: number;
  batch: RigBatch;
  skel: Skel;
  rot: Float32Array;
  posOff: Float32Array;
  hidden: Uint8Array;
  // anim
  phase = rnd.next() * 10;
  squash = new Spring(1, 180, 12);
  hitT = 9;
  hitX = 0;
  hitZ = 0;
  flash = 0;
  glow = 0;
  eye: EyeState | null = null;
  jaw = 0;
  lean = 0;
  spawnT = 0;
  emerge: 'sand' | 'run' | 'fly' | 'drop' = 'run';
  contactCd = 0;
  ramCd = 0;
  buffT = 0;
  targetOff = rnd.next() * Math.PI * 2;
  orbitDir = rnd.sign();
  leapFrom = new THREE.Vector3();
  leapTo = new THREE.Vector3();
  life = 0;
  flipped = 0;
  tint = new THREE.Color(1, 1, 1);
  lassoT = 0;
  telegraph: THREE.Line | null = null;
  quirk = rnd.next();
  constructor(public def: EnemyDef, public alpha: boolean, wave: number, render: EnemyRender) {
    const sc = waveScale(wave);
    this.scale = alpha ? 1.32 : 1;
    this.maxHp = this.hp = def.hp * sc.hp * (alpha ? 4.5 : 1);
    this.dmgMul = sc.dmg * (alpha ? 1.6 : 1);
    this.spdMul = sc.speed * (alpha ? 1.08 : 1) * (0.92 + rnd.next() * 0.16);
    this.radius = def.radius * this.scale;
    this.height = def.height * this.scale;
    this.armor = def.armor * (1 + wave * 0.01) * (alpha ? 1.4 : 1);
    this.name = (alpha ? 'Alpha ' : '') + def.name;
    this.flying = def.flying;
    this.cds = def.attacks.map((a) => a.cooldown * (0.4 + rnd.next() * 0.6));
    this.batch = render.get(alpha ? def.rigAlpha : def.rig, def.id === 'husk' || def.id === 'scarab' ? 200 : 96);
    const n = this.batch.nParts;
    this.rot = new Float32Array(n * 3);
    this.posOff = new Float32Array(n * 3);
    this.hidden = new Uint8Array(n);
    const pi = this.batch.partIndex;
    this.skel = 'pelvis' in pi ? 'humanoid' : 'tail1' in pi ? 'scorpion' : 'leg_l3' in pi && !('leg_l4' in pi) ? 'beetle' : 'wing_l' in pi ? 'bird' : 'other';
  }
  part(name: string) {
    return this.batch.partIndex[name] ?? -1;
  }
  setRot(name: string, x: number, y = 0, z = 0) {
    const i = this.batch.partIndex[name];
    if (i === undefined) return;
    this.rot[i * 3] = x;
    this.rot[i * 3 + 1] = y;
    this.rot[i * 3 + 2] = z;
  }
  addRot(name: string, x: number, y = 0, z = 0) {
    const i = this.batch.partIndex[name];
    if (i === undefined) return;
    this.rot[i * 3] += x;
    this.rot[i * 3 + 1] += y;
    this.rot[i * 3 + 2] += z;
  }
}

interface RagPiece {
  batch: RigBatch;
  part: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  ang: THREE.Vector3;
  life: number;
  scale: number;
  rest: boolean;
  tint: THREE.Color;
}

export class Enemies implements EnemyApi {
  list: Enemy[] = [];
  externals: ExternalTarget[] = [];
  render: EnemyRender;
  proj: Projectiles;
  rag: RagPiece[] = [];
  wave = 1;
  private grid = new Map<number, Enemy[]>();
  private laserMat = new THREE.LineBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.85 });

  constructor(private ctx: Ctx, private player: PlayerLink) {
    this.render = new EnemyRender(ctx.scene);
    this.proj = new Projectiles(ctx, () => player as any);
    ctx.events.on('melee', () => this.playerMelee());
    ctx.events.on('grappleKick', (e: Enemy) => this.grappleKick(e));
    ctx.events.on('explosion', (pos: { x: number; y: number; z: number }, r: number, dmg: number, owner: string) => this.explosion(pos, r, dmg, owner));
  }

  get alive() {
    return this.list.length;
  }

  // ------------------------------------------------------------- spawning
  spawn(defId: string, x: number, z: number, opts: { alpha?: boolean; emerge?: Enemy['emerge'] } = {}) {
    const def = ENEMIES[defId];
    if (!def) return null;
    const e = new Enemy(def, !!opts.alpha, this.wave, this.render);
    const g = this.ctx.world.groundAt(x, z);
    e.pos.set(x, g, z);
    e.yaw = Math.atan2(this.player.pos.x - x, this.player.pos.z - z);
    e.emerge = opts.emerge ?? (def.flying ? 'fly' : def.id.includes('husk') || def.id === 'mummy' || def.id === 'dungSkeleton' ? 'sand' : 'run');
    e.state = 'spawn';
    e.spawnT = 0;
    if (e.emerge === 'fly') e.pos.y = g + 18;
    if (def.ai === 'ambusher') e.state = 'hidden';
    this.list.push(e);
    if (e.emerge === 'sand') {
      this.ctx.fx.sandBurst({ x, y: g, z }, 0.8);
      this.ctx.sfx('sand_rise', { x, y: g, z }, 0.6);
    }
    if (opts.alpha) this.ctx.events.emit('alphaSpawn', e);
    return e;
  }

  registerExternal(t: ExternalTarget) {
    this.externals.push(t);
  }
  unregisterExternal(t: ExternalTarget) {
    this.externals = this.externals.filter((x) => x !== t);
  }

  // ------------------------------------------------------------- queries
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxT: number, skip?: Set<number>): RayHit | null {
    let best: RayHit | null = null;
    let bestT = maxT;
    for (const e of this.list) {
      if (!e.alive || (skip && skip.has(e.id)) || e.state === 'hidden') continue;
      // vertical capsule test
      const cx = e.pos.x, cz = e.pos.z;
      const ox = o.x - cx, oz = o.z - cz;
      const a = d.x * d.x + d.z * d.z, b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - e.radius * e.radius;
      const disc = b * b - 4 * a * c;
      if (disc < 0 || a < 1e-9) continue;
      const sq = Math.sqrt(disc);
      let t = (-b - sq) / (2 * a);
      if (t < 0) t = (-b + sq) / (2 * a);
      if (t < 0 || t > bestT) continue;
      const y = o.y + d.y * t;
      const yb = e.pos.y - 0.1, yt = e.pos.y + e.height;
      if (y < yb || y > yt) {
        // check head sphere for shots from above
        continue;
      }
      const rel = (y - e.pos.y) / e.height;
      const lateral = (o.x + d.x * t - cx) * Math.cos(e.yaw) - (o.z + d.z * t - cz) * Math.sin(e.yaw);
      let part = 'torso';
      let head = false;
      if (e.skel === 'humanoid') {
        // cartoon proportions: the big skull starts at ~70% of the height
        if (rel > 0.7) {
          part = 'head';
          head = true;
        } else if (rel < 0.38) part = lateral > 0 ? 'thigh_l' : 'thigh_r';
        else if (Math.abs(lateral) > e.radius * 0.55) part = lateral > 0 ? 'arm_l' : 'arm_r';
      } else if (rel > 0.6 && e.skel !== 'bird') {
        part = 'head';
        head = e.skel !== 'beetle';
      }
      bestT = t;
      const point = new THREE.Vector3(o.x + d.x * t, y, o.z + d.z * t);
      const normal = new THREE.Vector3(point.x - cx, 0, point.z - cz).normalize();
      best = { enemy: e, t, point, normal, headshot: head, part, surface: 'enemy' };
    }
    for (const x of this.externals) {
      if (!x.alive || (skip && skip.has(x.id))) continue;
      const h = x.hitTest(o, d, bestT);
      if (h && h.t < bestT) {
        bestT = h.t;
        best = h;
      }
    }
    return best;
  }

  nearest(p: THREE.Vector3, maxD: number, filter?: (e: EnemyLike) => boolean): EnemyLike | null {
    let best: EnemyLike | null = null, bd = maxD;
    for (const e of [...this.list, ...this.externals]) {
      if (!e.alive || (e as Enemy).state === 'hidden') continue;
      if (filter && !filter(e)) continue;
      const d = e.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  inRadius(p: THREE.Vector3, r: number, fn: (e: EnemyLike, d: number) => void) {
    for (const e of this.list) {
      if (!e.alive || e.state === 'hidden') continue;
      const d = Math.hypot(e.pos.x - p.x, e.pos.y + e.height * 0.5 - p.y, e.pos.z - p.z);
      if (d < r + e.radius) fn(e, d);
    }
    for (const x of this.externals) {
      if (!x.alive) continue;
      const d = Math.hypot(x.pos.x - p.x, x.pos.y + x.height * 0.5 - p.y, x.pos.z - p.z);
      if (d < r + x.radius) fn(x, d);
    }
  }

  // ------------------------------------------------------------- damage
  damage(target: EnemyLike, hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3): number {
    if (!target.alive) return 0;
    if (!(target instanceof Enemy)) return (target as ExternalTarget).takeDamage(hit, point, dir);
    const e = target as Enemy;
    const ctx = this.ctx;
    let mult = 1;
    // front guard (jackal shields)
    if (e.def.frontGuard && dir && (hit.source === 'gun' || hit.source === 'projectile')) {
      const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
      if (fx * dir.x + fz * dir.z < -0.35 && e.state !== 'stagger' && !e.status.stunned()) {
        mult *= e.def.frontGuard;
        const pp = point ?? e.pos;
        ctx.fx.hit(pp, { x: -dir.x, y: 0.3, z: -dir.z }, 'armor', 1);
        ctx.sfx('counter_clang', pp, 0.5, 1.3);
        if (rnd.chance(0.3)) ctx.fx.number({ x: pp.x, y: pp.y + 0.4, z: pp.z }, 'x', 0xaaaaaa, 0.7);
      }
    }
    // flipped scarabs take bonus
    if (e.flipped > 0) mult *= 2;
    // mariachi buff makes allies tougher? no — buff = speed/damage only
    const pl = this.player;
    const res = resolveHit(pl.stats, { ...hit, mult: (hit.mult ?? 1) * mult }, {
      hp: e.hp,
      maxHp: e.maxHp,
      armor: e.armor,
      physRes: e.def.physRes,
      magicRes: e.def.magicRes,
      statusRes: e.def.statusRes,
      status: e.status,
      isBoss: false,
    }, pl.speed);
    let amt = res.amount;
    if (hit.headshot && e.def.id === 'gunslinger') amt *= 1.5;
    e.hp -= amt;
    e.flash = 1;
    e.hitT = 0;
    const dx = dir?.x ?? e.pos.x - pl.pos.x, dz = dir?.z ?? e.pos.z - pl.pos.z;
    const dl = Math.hypot(dx, dz) || 1;
    e.hitX = dx / dl;
    e.hitZ = dz / dl;
    e.squash.kick(-4);
    // knockback
    if (hit.knock) {
      const k = (hit.knock * (e.def.ai === 'tank' ? 0.3 : 1)) / e.scale;
      e.vel.x += e.hitX * k * 2.2;
      e.vel.z += e.hitZ * k * 2.2;
    }
    // stagger on big hits
    if (amt > e.maxHp * 0.25 && e.def.ai !== 'tank' && e.state !== 'charge' && e.state !== 'leap') {
      e.state = 'stagger';
      e.stateT = 0;
      this.clearTelegraph(e);
    }
    // feedback
    const pp = point ?? new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.6, e.pos.z);
    const kind = hit.source === 'poison' ? 'poison' : hit.headshot && e.def.hitKind !== 'chitin' ? 'bone' : e.def.hitKind;
    if (hit.source !== 'poison' && hit.source !== 'bleed' && hit.source !== 'burn') {
      ctx.fx.hit(pp, { x: -e.hitX, y: 0.4, z: -e.hitZ }, kind, res.crit ? 1.5 : 1);
      ctx.sfx(e.def.hitKind === 'chitin' || e.def.hitKind === 'armor' ? 'hit_armor' : e.def.hitKind === 'bone' ? 'hit_bone' : 'hit_flesh', pp, 0.7);
      if (hit.headshot) ctx.sfx('headshot', pp, 0.8);
      if (res.crit) ctx.sfx('hit_crit', pp, 0.6);
      if (hit.status?.some((s) => s.id === 'poison')) ctx.events.emit('groundMark', pp.x, pp.z, 0.35, 3);
      else if (e.def.hitKind === 'flesh') ctx.events.emit('groundMark', pp.x + e.hitX * 0.8, pp.z + e.hitZ * 0.8, 0.4, 2);
    }
    const col = res.superCrit ? 0xff4a2a : res.crit ? 0xffd040 : hit.source === 'poison' ? 0x9dff3a : hit.source === 'burn' ? 0xffa040 : hit.source === 'bleed' ? 0xe04040 : 0xffffff;
    ctx.fx.number({ x: pp.x, y: pp.y + 0.3, z: pp.z }, amt, col, res.crit ? 1.3 : hit.source === 'poison' ? 0.75 : 1);
    if (res.superCrit) ctx.toast('SHATTER!', '#ff6a3a');
    for (const c of res.combos) this.combo(e, c);
    // DOOM
    if (doomCheck({ hp: e.hp, maxHp: e.maxHp, armor: 0, physRes: 0, magicRes: 0, statusRes: {}, status: e.status }) && e.hp < e.maxHp * 0.2) {
      e.hp = 0;
      ctx.toast('DOOM', '#b565ff');
      ctx.fx.explosion(pp, 2, 'curse');
    }
    ctx.events.emit('enemyHit', e, hit, amt, res);
    // limb loss
    const part = hit.tags?.[0];
    const limbs = ['arm_l', 'arm_r', 'head', 'thigh_l', 'thigh_r', 'fore_l', 'fore_r'];
    if (part && limbs.includes(part) && (amt > e.maxHp * 0.4 || (e.hp <= 0 && rnd.chance(0.7)))) this.detach(e, part, e.hitX, e.hitZ);
    if (e.hp <= 0) this.kill(e, hit, e.hitX, e.hitZ, res.crit);
    return amt;
  }

  private combo(e: Enemy, c: string) {
    const ctx = this.ctx;
    const info = (COMBO_INFO as any)[c];
    if (c === 'toxicBlaze') {
      const p = { x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z };
      ctx.fx.explosion(p, 3, 'poison');
      ctx.sfx('poison_burst', p, 1);
      this.inRadius(new THREE.Vector3(p.x, p.y, p.z), 4, (o) => {
        if (o !== e) this.damage(o, { base: 22, kind: 'magic', source: 'poison', status: [{ id: 'poison', stacks: 4, dur: 4, power: 2 }] });
      });
    }
    if (c === 'plague') return; // handled on death
    if (info) {
      ctx.events.emit('combo', c, e);
      if (c !== 'shatter' || rnd.chance(0.5)) ctx.fx.number({ x: e.pos.x, y: e.pos.y + e.height + 0.6, z: e.pos.z }, '!', STATUS_INFO.mark.color, 1.1);
    }
  }

  /** knock a limb off and send it flying (gore / bone pop) */
  detach(e: Enemy, partName: string, dx: number, dz: number) {
    const i = e.part(partName);
    if (i < 0 || e.hidden[i]) return;
    // hide this part and its children
    const parts = e.batch.geo.parts;
    const hideRec = (k: number) => {
      e.hidden[k] = 1;
      parts.forEach((p, j) => {
        if (p.parent === k) hideRec(j);
      });
    };
    // spawn ragdoll pieces for each hidden part using last world matrices
    const before = new Set<number>();
    parts.forEach((_, j) => e.hidden[j] && before.add(j));
    hideRec(i);
    parts.forEach((_, j) => {
      if (!e.hidden[j] || before.has(j)) return;
      this.spawnPiece(e, j, dx * 6 + (rnd.next() - 0.5) * 3, 4 + rnd.next() * 3 + (partName === 'head' ? 4 : 0), dz * 6 + (rnd.next() - 0.5) * 3);
    });
    const p = { x: e.pos.x, y: e.pos.y + e.height * (partName === 'head' ? 0.9 : 0.6), z: e.pos.z };
    this.ctx.fx.hit(p, { x: dx, y: 0.6, z: dz }, e.def.hitKind === 'flesh' ? 'flesh' : 'bone', 1.4);
    this.ctx.sfx('limb_off', p, 0.7);
    if (partName === 'head') this.ctx.events.emit('decap', e);
  }

  private spawnPiece(e: Enemy, part: number, vx: number, vy: number, vz: number) {
    const W = e.batch.partWorld(part);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), sc = new THREE.Vector3();
    W.decompose(pos, quat, sc);
    this.rag.push({ batch: e.batch, part, pos, quat, vel: new THREE.Vector3(vx, vy, vz), ang: new THREE.Vector3((rnd.next() - 0.5) * 16, (rnd.next() - 0.5) * 16, (rnd.next() - 0.5) * 16), life: 3.2 + rnd.next(), scale: sc.x, rest: false, tint: e.tint.clone() });
  }

  kill(e: Enemy, hit: Hit | null, dx: number, dz: number, crit = false) {
    if (!e.alive) return;
    e.alive = false;
    const ctx = this.ctx;
    this.clearTelegraph(e);
    const c = { x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z };
    // ragdoll: every visible part becomes a tumbling piece
    const force = 5 + (hit?.knock ?? 2) * 1.5 + (crit ? 3 : 0);
    e.batch.geo.parts.forEach((p, j) => {
      if (e.hidden[j]) return;
      const up = 2 + rnd.next() * 4 + (p.name === 'head' || p.name === 'hat' ? 3.5 : 0);
      this.spawnPiece(e, j, dx * force * (0.5 + rnd.next() * 0.8) + e.vel.x * 0.5 + (rnd.next() - 0.5) * 3, up, dz * force * (0.5 + rnd.next() * 0.8) + e.vel.z * 0.5 + (rnd.next() - 0.5) * 3);
    });
    ctx.fx.hit(c, { x: dx, y: 0.5, z: dz }, e.def.hitKind, 1.8);
    ctx.fx.dust({ x: e.pos.x, y: e.pos.y + 0.2, z: e.pos.z }, 0.8 * e.scale, P.sand0, 3);
    const deathSfx: Record<string, string> = { husk: 'husk_death', mummy: 'mummy_death', jackal: 'jackal_growl', giantScorpion: 'giant_scorpion_death', vulture: 'vulture_screech', gunslinger: 'skeleton_rattle' };
    ctx.sfx(deathSfx[e.def.id] ?? (e.def.hitKind === 'bone' ? 'skeleton_rattle' : 'gore_splat'), c, 0.8);
    // specials
    switch (e.def.special) {
      case 'chainExplode':
        ctx.engine.tweens.after(0.08, () => {
          const r = (e.def.attacks[0]?.radius ?? 3.5) * e.scale;
          ctx.fx.explosion(c, r * 0.8);
          ctx.sfx('explosion', c, 1);
          ctx.events.emit('explosion', c, r, (e.def.attacks[0]?.dmg ?? 20) * e.dmgMul, 'chain');
        });
        break;
      case 'stinkCloud':
        ctx.fx.poisonCloud(c, 3);
        ctx.particles.emit({ pos: c, count: 14, spread: 2, up: 1.5, life: [1, 2], size: [0.06, 0.06], sprite: ['fly0', 'fly1'], color: 0xffffff, drag: 1, jitter: 1.2 });
        ctx.sfx('banjo_funny', c, 0.5);
        ctx.events.emit('stink', c);
        break;
      case 'treasure':
        ctx.fx.coins(c, 30);
        ctx.sfx('gold_burst', c, 1);
        ctx.toast('JACKPOT!', '#f5c84a');
        break;
      case 'buffAura':
        ctx.sfx('banjo_funny', c, 0.6, 0.8);
        break;
    }
    if (e.def.id === 'cactusHusk') this.proj.pattern('ring', new THREE.Vector3(c.x, c.y, c.z), this.player.pos, { count: 10, speed: 11, dmg: 4 * e.dmgMul, proj: 'needle' });
    // plague spread
    if (e.status.stacks('poison') > 0 && e.status.stacks('curse') > 0) {
      this.inRadius(new THREE.Vector3(c.x, c.y, c.z), 5, (o) => {
        if (o instanceof Enemy && o !== e) {
          o.status.apply('poison', e.status.stacks('poison') * 0.5, 4, 2, 60, o.def.statusRes);
          o.status.apply('curse', 3, 5, 1, 15, o.def.statusRes);
        }
      });
      ctx.fx.poisonCloud(c, 2.5);
    }
    if (e.alpha) {
      ctx.engine.slowMo(0.25, 30);
      ctx.engine.tweens.after(0.35, () => ctx.engine.slowMo(1, 4), true);
      ctx.shake(0.5);
    }
    ctx.events.emit('enemyKilled', e, hit);
  }

  // ------------------------------------------------------------- player verbs
  private playerMelee() {
    const ctx = this.ctx;
    const pl = this.player;
    const cam = ctx.camera;
    const f = _v.set(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
    const origin = pl.center(new THREE.Vector3());
    let countered = false;
    let hits = 0;
    // deflect bullets
    const deflected = this.proj.deflect(origin, 2.6, f.x, f.z);
    if (deflected > 0) {
      ctx.toast(deflected > 3 ? `DEFLECT x${deflected}` : 'DEFLECT', '#9dff3a');
      ctx.sfx('counter_clang', origin, 0.9, 1.2);
      ctx.engine.hitStop(0.06);
    }
    const targets = [...this.list, ...this.externals] as EnemyLike[];
    for (const e of targets) {
      if (!e.alive) continue;
      const dx = e.pos.x - origin.x, dz = e.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.9 + e.radius || Math.abs(e.pos.y + e.height * 0.5 - origin.y) > 2.2) continue;
      if ((dx * f.x + dz * f.z) / (d || 1) < 0.2 && d > 1.2) continue;
      const en = e instanceof Enemy ? e : null;
      const counter = !!en && en.state === 'windup' && en.atk?.kind === 'melee' && en.stateT > en.atk.windup * 0.3;
      const hit: Hit = {
        base: counter ? 60 : 22,
        kind: 'phys',
        source: counter ? 'counter' : 'melee',
        knock: counter ? 12 : 7,
        dirX: dx / (d || 1),
        dirZ: dz / (d || 1),
        forceCrit: counter,
        status: counter ? [{ id: 'stun', stacks: 1, dur: 1.2 }, { id: 'armorBreak', stacks: 1, dur: 4 }] : [{ id: 'stun', stacks: 1, dur: 0.25, chance: 0.5 }],
      };
      if (counter && en) {
        countered = true;
        en.state = 'stagger';
        en.stateT = -0.6;
        this.clearTelegraph(en);
      }
      this.damage(e, hit, new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.6, e.pos.z), new THREE.Vector3(dx, 0, dz).normalize());
      hits++;
    }
    if (countered) {
      ctx.toast('COUNTER!', '#ffd040');
      ctx.sfx('counter_clang', origin, 1);
      ctx.sfx('qte_perfect', null, 0.5);
      ctx.engine.slowMo(0.2, 40);
      ctx.engine.tweens.after(0.3, () => ctx.engine.slowMo(1, 6), true);
      ctx.shake(0.4);
      ctx.events.emit('counter');
    } else if (hits > 0) {
      ctx.sfx('kick', origin, 0.9);
      ctx.engine.hitStop(0.05);
      ctx.shake(0.2);
    } else ctx.sfx('melee_whoosh', origin, 0.6);
  }

  private grappleKick(e: EnemyLike) {
    const pl = this.player;
    const dir = new THREE.Vector3(e.pos.x - pl.pos.x, 0, e.pos.z - pl.pos.z).normalize();
    this.damage(e, { base: 40, kind: 'phys', source: 'grapple', knock: 14, forceCrit: true, dirX: dir.x, dirZ: dir.z, status: [{ id: 'stun', stacks: 1, dur: 0.8 }] }, undefined, dir);
    this.ctx.toast('GRAPPLE KICK', '#ffd040');
    this.ctx.sfx('kick', e.pos, 1);
    this.ctx.engine.hitStop(0.08);
    this.ctx.shake(0.35);
  }

  explosion(pos: { x: number; y: number; z: number }, r: number, dmg: number, owner: string) {
    const p = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.inRadius(p, r, (e, d) => {
      const fall = 1 - clamp(d / (r + e.radius), 0, 1) * 0.6;
      const dir = new THREE.Vector3(e.pos.x - p.x, 0, e.pos.z - p.z).normalize();
      if (e instanceof Enemy && e.def.ai === 'swarm') e.flipped = 3;
      this.damage(e, { base: dmg * fall, kind: 'phys', source: 'explosion', knock: 10, dirX: dir.x, dirZ: dir.z, canCrit: owner === 'player' }, undefined, dir);
    });
    const pl = this.player;
    const dpl = pl.center(_v2).distanceTo(p);
    if (owner !== 'player' && dpl < r + 0.4) pl.takeHit({ base: dmg * (1 - (dpl / (r + 0.4)) * 0.5), kind: 'phys', source: 'explosion', knock: 9 }, p);
    this.ctx.world.deform(pos.x, pos.z, r * 0.55, Math.min(1.2, r * 0.22));
    this.ctx.events.emit('groundMark', pos.x, pos.z, r * 0.8, 1);
  }

  // ------------------------------------------------------------- update
  update(dt: number, time: number) {
    const ctx = this.ctx;
    const pl = this.player;
    const ppos = pl.pos;
    // spatial grid for separation
    this.grid.clear();
    for (const e of this.list) {
      const k = Math.floor(e.pos.x / 3) * 100003 + Math.floor(e.pos.z / 3);
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(e);
    }
    // mariachi buff sources
    const bands = this.list.filter((e) => e.alive && e.def.special === 'buffAura' && e.state !== 'spawn');
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.alive) {
        this.list.splice(i, 1);
        continue;
      }
      e.life += dt;
      e.stateT += dt;
      e.hitT += dt;
      e.flash = Math.max(0, e.flash - dt * 7);
      e.contactCd -= dt;
      e.ramCd -= dt;
      e.flipped = Math.max(0, e.flipped - dt);
      for (let k = 0; k < e.cds.length; k++) e.cds[k] -= dt;
      e.buffT = Math.max(0, e.buffT - dt);
      for (const b of bands) if (b !== e && b.pos.distanceTo(e.pos) < 12) e.buffT = Math.max(e.buffT, 0.5);
      // statuses
      const tick = e.status.tick(dt, e.maxHp, e.vel.lengthSq() > 1, false, e.def.burnMul ?? 1);
      if (tick) {
        if (tick.poison > 0) this.damage(e, { base: tick.poison, kind: 'magic', source: 'poison', canCrit: false });
        if (e.alive && tick.bleed > 0) this.damage(e, { base: tick.bleed, kind: 'phys', source: 'bleed', canCrit: e.status.stacks('curse') > 0 });
        if (e.alive && tick.burn > 0) this.damage(e, { base: tick.burn, kind: 'magic', source: 'burn', canCrit: false });
        if (!e.alive) continue;
        if (e.status.has('poison') && rnd.chance(0.5)) ctx.fx.bubbles({ x: e.pos.x, y: e.pos.y + e.height * 0.7, z: e.pos.z }, 1);
        if (e.status.has('burn')) ctx.fx.flames({ x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z }, 1, e.scale);
      }
      // tint by status (subtle)
      const tr = e.status.has('poison') ? [0.82, 1.0, 0.78] : e.status.has('burn') ? [1, 0.8, 0.65] : e.status.has('curse') ? [0.9, 0.82, 1] : [1, 1, 1];
      e.tint.setRGB(damp(e.tint.r, tr[0], 6, dt), damp(e.tint.g, tr[1], 6, dt), damp(e.tint.b, tr[2], 6, dt));
      this.think(e, dt, time, ppos);
      if (!e.alive) continue;
      // separation
      let sx = 0, sz = 0;
      const gx = Math.floor(e.pos.x / 3), gz = Math.floor(e.pos.z / 3);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          const l = this.grid.get((gx + a) * 100003 + gz + b);
          if (!l) continue;
          for (const o of l) {
            if (o === e) continue;
            const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z;
            const d2 = dx * dx + dz * dz;
            const rr = e.radius + o.radius;
            if (d2 < rr * rr && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              sx += (dx / d) * (rr - d);
              sz += (dz / d) * (rr - d);
            }
          }
        }
      e.pos.x += sx * 0.5;
      e.pos.z += sz * 0.5;
      // world colliders + ground
      if (!e.flying || e.state === 'spawn') {
        const r = ctx.world.colliders.resolve(e.pos.x, e.pos.z, e.pos.y, e.height, e.radius, { x: 0, z: 0, nx: 0, nz: 0, hit: null });
        e.pos.x += r.x;
        e.pos.z += r.z;
      }
      // ram / contact with player
      if (pl.alive && e.state !== 'hidden' && e.state !== 'spawn') {
        const dx = e.pos.x - ppos.x, dz = e.pos.z - ppos.z;
        const d = Math.hypot(dx, dz);
        const dy = Math.abs(e.pos.y - ppos.y);
        if (d < e.radius + 0.55 && dy < e.height) {
          const ps = pl.speed;
          if (ps > 12 && e.ramCd <= 0) {
            e.ramCd = 0.6;
            const v = pl.board.vel;
            const vl = Math.hypot(v.x, v.z) || 1;
            this.damage(e, { base: ps * 1.4, kind: 'phys', source: 'board', knock: ps * 0.5, dirX: v.x / vl, dirZ: v.z / vl, canCrit: true }, undefined, new THREE.Vector3(v.x / vl, 0, v.z / vl));
            e.vel.y += 6;
            v.x *= 0.92;
            v.z *= 0.92;
            ctx.sfx('punch', e.pos, 0.9);
            ctx.engine.hitStop(0.04);
            ctx.shake(0.15);
            ctx.events.emit('ram', e);
          } else if (e.contactCd <= 0 && e.def.contact > 0) {
            e.contactCd = 0.9;
            pl.takeHit({ base: e.def.contact * e.dmgMul, kind: 'phys', source: 'contact', knock: 3 }, e.pos);
            if (e.def.thorns) pl.takeHit({ base: e.def.thorns, kind: 'phys', source: 'thorns' }, e.pos);
          }
        }
      }
      this.animate(e, dt, time);
    }
    this.proj.update(dt);
    this.updateRag(dt);
    // render
    this.render.begin();
    const faces = ctx.faces;
    const cam = ctx.camera.position;
    for (const e of this.list) {
      if (!e.alive) continue;
      const cd = cam.distanceTo(e.pos);
      const lod: 0 | 1 | 2 = cd > 58 ? 2 : cd > 26 ? 1 : 0;
      const sq = e.squash.x;
      _q.setFromAxisAngle(UP, e.yaw);
      let tilt = 0;
      if (e.flipped > 0) tilt = Math.PI;
      if (tilt) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt));
      const spawnSink = e.state === 'spawn' && e.emerge === 'sand' ? (1 - clamp(e.stateT / 1.1, 0, 1)) * e.height : 0;
      _s.set(e.scale * (2 - sq) ** 0.5, e.scale * sq, e.scale * (2 - sq) ** 0.5);
      _m.compose(_v.set(e.pos.x, e.pos.y - spawnSink + (tilt ? e.height * 0.4 : 0), e.pos.z), _q, _s);
      const fx: [number, number, number, number] = [e.flash * 0.85, 0, e.glow, 0];
      e.batch.push(_m, e.rot, e.hidden, lod, fx, e.tint, e.posOff);
      const be = e.batch.eyes;
      if (faces && be && lod < 2 && cd < 48 && !e.hidden[be.head]) {
        if (!e.eye) {
          const look = EYE_LOOK[e.def.id] ?? ['glow', e.alpha ? 0xff2a0a : 0xff5a14];
          e.eye = new EyeState(look[0], look[1], be.size);
        }
        e.eye.tick(dt);
        const st = e.state;
        const expr = e.status.stunned() || st === 'stagger' ? 'stunned' : e.flash > 0.35 ? 'hurt' : st === 'windup' || st === 'charge' || st === 'leap' || st === 'dive' ? 'angry' : st === 'spawn' ? 'surprised' : 'neutral';
        e.eye.draw(faces, e.batch.partWorld(be.l), be.r >= 0 ? e.batch.partWorld(be.r) : null, expr, 0, 0, 1.15);
      }
    }
    for (const r of this.rag) {
      _s.set(r.scale, r.scale, r.scale);
      _m.compose(r.pos, r.quat, _s);
      const diss = r.life < 1 ? 1 - r.life : 0;
      r.batch.write(r.part, _m, 0, [0, diss, 0, 0], r.tint);
    }
    this.render.end();
  }

  private updateRag(dt: number) {
    const g = this.ctx.world;
    for (let i = this.rag.length - 1; i >= 0; i--) {
      const r = this.rag[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.rag.splice(i, 1);
        continue;
      }
      if (!r.rest) {
        r.vel.y -= 20 * dt;
        r.pos.addScaledVector(r.vel, dt);
        const w = r.ang;
        const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(w.x * dt, w.y * dt, w.z * dt));
        r.quat.premultiply(dq);
        const gy = g.groundAt(r.pos.x, r.pos.z) + 0.08;
        if (r.pos.y < gy) {
          r.pos.y = gy;
          if (r.vel.y < -2) {
            r.vel.y *= -0.3;
            r.vel.x *= 0.55;
            r.vel.z *= 0.55;
            r.ang.multiplyScalar(0.5);
            if (rnd.chance(0.3)) this.ctx.fx.sandSpray(r.pos, { x: r.vel.x * 0.2, y: 0, z: r.vel.z * 0.2 }, 0.6);
          } else {
            r.vel.set(r.vel.x * 0.85, 0, r.vel.z * 0.85);
            r.ang.multiplyScalar(0.8);
            if (r.vel.lengthSq() < 0.05) r.rest = true;
          }
        }
      } else if (r.life < 1.2) r.pos.y -= dt * 0.3;
    }
    if (this.rag.length > 900) this.rag.splice(0, this.rag.length - 900);
  }

  // ------------------------------------------------------------- AI
  private think(e: Enemy, dt: number, time: number, ppos: THREE.Vector3) {
    const ctx = this.ctx;
    const d = e.def;
    const toX = ppos.x - e.pos.x, toZ = ppos.z - e.pos.z;
    const dist = Math.hypot(toX, toZ) || 1e-3;
    const buff = e.buffT > 0 ? 1.3 : 1;
    const stunned = e.status.stunned() || e.flipped > 0;
    let spd = d.speed * e.spdMul * e.status.slowMul() * buff;
    let wantX = 0, wantZ = 0, face = Math.atan2(toX, toZ);
    const ground = ctx.world.groundAt(e.pos.x, e.pos.z);

    if (e.state === 'spawn') {
      const dur = e.emerge === 'sand' ? 1.1 : e.emerge === 'fly' ? 1.6 : 0.3;
      if (e.emerge === 'sand' && rnd.chance(0.5)) ctx.fx.sandSpray({ x: e.pos.x, y: ground, z: e.pos.z }, { x: 0, y: 1, z: 0 }, 1.2);
      if (e.emerge === 'fly') e.pos.y = damp(e.pos.y, ground + 7, 2, dt);
      if (e.stateT > dur) {
        e.state = 'move';
        e.stateT = 0;
        if (d.id === 'husk' && rnd.chance(0.4)) ctx.sfx('husk_groan', e.pos, 0.5);
        if (d.id === 'jackal' && rnd.chance(0.5)) ctx.sfx('jackal_howl', e.pos, 0.6);
      }
      e.yaw = dampAngle(e.yaw, face, 4, dt);
      return;
    }
    if (stunned) {
      e.vel.multiplyScalar(Math.exp(-6 * dt));
      e.pos.addScaledVector(e.vel, dt);
      if (!e.flying) e.pos.y = ground;
      if (rnd.chance(dt * 3)) ctx.particles.emit({ pos: { x: e.pos.x, y: e.pos.y + e.height + 0.3, z: e.pos.z }, count: 1, vel: { x: 0, y: 0.5, z: 0 }, life: [0.5, 0.6], size: [0.18, 0.12], sprite: 'star4', color: 0xfff2a0, additive: false });
      return;
    }
    if (e.state === 'hidden') {
      // tumbleweed bandit: roll with the wind, pop out when close
      const w = ctx.world.sa.wind;
      wantX = w.x * 3.5;
      wantZ = w.z * 3.5;
      e.posOff[0] = 0;
      if (dist < 13) {
        e.state = 'move';
        e.stateT = 0;
        e.squash.kick(8);
        ctx.sfx('gunslinger_laugh', e.pos, 0.7);
        ctx.fx.dust({ x: e.pos.x, y: e.pos.y + 0.5, z: e.pos.z }, 0.6, P.dryGrass0, 3);
      }
      this.move(e, wantX, wantZ, dt, ground, Math.atan2(w.x, w.z));
      return;
    }
    if (e.state === 'stagger') {
      e.vel.multiplyScalar(Math.exp(-5 * dt));
      e.pos.addScaledVector(e.vel, dt);
      if (!e.flying) e.pos.y = ground;
      if (e.stateT > 0.45) {
        e.state = 'move';
        e.stateT = 0;
      }
      return;
    }
    // ---- attacks in progress
    if (e.state === 'windup' && e.atk) {
      const a = e.atk;
      e.glow = clamp(e.stateT / a.windup, 0, 1) * 1.5;
      e.yaw = dampAngle(e.yaw, face, a.kind === 'snipe' ? 6 : 10, dt);
      e.vel.multiplyScalar(Math.exp(-8 * dt));
      if (a.kind === 'snipe') this.drawLaser(e, ppos, e.stateT / a.windup);
      if (a.kind === 'explode') e.flash = Math.sin(e.stateT * 40) > 0 ? 0.8 : 0;
      if (e.stateT >= a.windup * (a.kind === 'melee' ? 1 / buff : 1)) this.strike(e, a, ppos, dist);
      if (!e.flying) e.pos.y = ground;
      return;
    }
    e.glow = damp(e.glow, 0, 6, dt);
    if (e.state === 'strike' || e.state === 'recover') {
      if (e.stateT > 0.35) {
        e.state = 'move';
        e.stateT = 0;
      }
    }
    if (e.state === 'charge') {
      const sp = d.speed * 3.2 * e.spdMul;
      wantX = Math.sin(e.yaw) * sp;
      wantZ = Math.cos(e.yaw) * sp;
      e.vel.x = wantX;
      e.vel.z = wantZ;
      e.pos.x += wantX * dt;
      e.pos.z += wantZ * dt;
      e.pos.y = ground;
      if (rnd.chance(0.8)) ctx.fx.sandSpray({ x: e.pos.x, y: ground, z: e.pos.z }, { x: -wantX * 0.1, y: 0, z: -wantZ * 0.1 }, 1.5);
      if (dist < e.radius + 0.8 && e.contactCd <= 0) {
        e.contactCd = 1;
        this.player.takeHit({ base: (e.atk?.dmg ?? 20) * e.dmgMul, kind: 'phys', source: 'contact', knock: 12 }, e.pos);
        ctx.shake(0.4);
      }
      if (e.stateT > 1.2 || ctx.world.storm.sdf(e.pos.x, e.pos.z) < 2) {
        e.state = 'recover';
        e.stateT = 0;
        e.squash.kick(-5);
      }
      return;
    }
    if (e.state === 'leap' || e.state === 'dive') {
      const T = e.state === 'leap' ? 0.75 : 1.1;
      const k = clamp(e.stateT / T, 0, 1);
      e.pos.lerpVectors(e.leapFrom, e.leapTo, k);
      e.pos.y = (e.state === 'leap' ? Math.max(ground, e.leapFrom.y + (e.leapTo.y - e.leapFrom.y) * k) + Math.sin(k * Math.PI) * 4.5 : e.leapFrom.y + (e.leapTo.y - e.leapFrom.y) * k + Math.sin(k * Math.PI) * -1.5);
      if (k >= 1) {
        e.state = 'recover';
        e.stateT = 0;
        e.squash.kick(-9);
        const p = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
        if (e.state === 'recover' && d.ai === 'leaper') {
          ctx.fx.sandBurst(p, 1);
          ctx.sfx('board_land', p, 0.6);
          if (this.player.pos.distanceTo(e.pos) < 3.2) this.player.takeHit({ base: (e.atk?.dmg ?? 15) * e.dmgMul, kind: 'phys', source: 'contact', knock: 8, status: [{ id: 'bleed', stacks: 2, dur: 3 }] }, e.pos);
        }
      }
      return;
    }

    // ---- choose movement per archetype
    const range = (a: AttackDef) => a.range;
    let prefer = 0; // preferred distance band center
    switch (d.ai) {
      case 'chaser':
      case 'tank':
      case 'swarm':
      case 'bomber':
      case 'leaper': {
        // lead target a bit; swarm orbits a little
        const lead = 0.35;
        const tx = ppos.x + this.player.board.vel.x * lead + (d.ai === 'swarm' ? Math.cos(time * 2 + e.targetOff) * 2 : 0);
        const tz = ppos.z + this.player.board.vel.z * lead + (d.ai === 'swarm' ? Math.sin(time * 2 + e.targetOff) * 2 : 0);
        const dx = tx - e.pos.x, dz = tz - e.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        wantX = (dx / l) * spd;
        wantZ = (dz / l) * spd;
        if (d.ai === 'chaser' && d.id === 'husk') {
          // shambling lurches: speed pulses
          const pulse = 0.55 + 0.75 * Math.max(0, Math.sin(time * 3.1 + e.quirk * 10));
          wantX *= pulse;
          wantZ *= pulse;
        }
        break;
      }
      case 'ranged':
      case 'sniper':
      case 'lobber':
      case 'support':
      case 'whipper': {
        const a0 = d.attacks[0];
        prefer = d.ai === 'sniper' ? 32 : d.ai === 'whipper' ? 6 : d.ai === 'support' ? 10 : clamp((a0?.range ?? 20) * 0.6, 8, 22);
        const radial = (dist - prefer) / Math.max(prefer, 1);
        const ux = toX / dist, uz = toZ / dist;
        const orbit = e.orbitDir * (d.ai === 'support' ? 0.4 : 0.85);
        wantX = (ux * clamp(radial * 2, -1, 1) + -uz * orbit) * spd;
        wantZ = (uz * clamp(radial * 2, -1, 1) + ux * orbit) * spd;
        if (rnd.chance(dt * 0.25)) e.orbitDir *= -1;
        break;
      }
      case 'charger': {
        const ux = toX / dist, uz = toZ / dist;
        wantX = ux * spd * (dist > 14 ? 1 : 0.4) - uz * spd * 0.4 * e.orbitDir;
        wantZ = uz * spd * (dist > 14 ? 1 : 0.4) + ux * spd * 0.4 * e.orbitDir;
        break;
      }
      case 'flyer': {
        const ang = time * 0.8 * e.orbitDir + e.targetOff;
        const tx = ppos.x + Math.cos(ang) * 9, tz = ppos.z + Math.sin(ang) * 9;
        const dx = tx - e.pos.x, dz = tz - e.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        wantX = (dx / l) * spd;
        wantZ = (dz / l) * spd;
        e.pos.y = damp(e.pos.y, Math.max(ground, ppos.y) + 7 + Math.sin(time * 2 + e.quirk * 6) * 1.2, 2, dt);
        face = Math.atan2(wantX, wantZ);
        break;
      }
      case 'rider': {
        const ang = Math.atan2(e.pos.z - ppos.z, e.pos.x - ppos.x) + 0.6 * e.orbitDir;
        const R = 15 + Math.sin(time * 0.5 + e.quirk * 9) * 4;
        const tx = ppos.x + Math.cos(ang) * R, tz = ppos.z + Math.sin(ang) * R;
        const dx = tx - e.pos.x, dz = tz - e.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        wantX = (dx / l) * spd;
        wantZ = (dz / l) * spd;
        face = Math.atan2(wantX, wantZ);
        if (rnd.chance(0.6)) ctx.fx.sandSpray({ x: e.pos.x, y: ground + 0.05, z: e.pos.z }, { x: -wantX * 0.1, y: 0, z: -wantZ * 0.1 }, 0.8);
        if (rnd.chance(dt * 0.2)) e.orbitDir *= -1;
        break;
      }
      case 'fleer': {
        const ux = -toX / dist, uz = -toZ / dist;
        const zig = Math.sin(time * 4 + e.quirk * 10) * 0.7;
        wantX = (ux - uz * zig) * spd * (dist < 25 ? 1 : 0.4);
        wantZ = (uz + ux * zig) * spd * (dist < 25 ? 1 : 0.4);
        face = Math.atan2(wantX, wantZ);
        if (e.life > 18) {
          ctx.fx.sandBurst(e.pos, 0.8);
          ctx.toast('The Golden Scarab escaped!', '#c9a97c');
          e.alive = false;
          return;
        }
        if (rnd.chance(dt * 3)) ctx.fx.sparkle({ x: e.pos.x, y: e.pos.y + 0.5, z: e.pos.z }, P.gold1, 1);
        break;
      }
      default:
        wantX = (toX / dist) * spd;
        wantZ = (toZ / dist) * spd;
    }
    // storm: stay inside safety
    const sd = ctx.world.storm.sdf(e.pos.x, e.pos.z);
    if (sd < 4) {
      const inw = ctx.world.storm.inward(e.pos.x, e.pos.z, { x: 0, z: 0 });
      wantX += inw.x * spd * clamp((4 - sd) / 4, 0, 1.5);
      wantZ += inw.z * spd * clamp((4 - sd) / 4, 0, 1.5);
    }
    this.move(e, wantX, wantZ, dt, ground, face);
    // ---- pick an attack
    if (e.state === 'move' && e.stateT > 0.25) {
      for (let k = 0; k < d.attacks.length; k++) {
        const a = d.attacks[k];
        if (e.cds[k] > 0) continue;
        if (a.alphaOnly && !e.alpha) continue;
        if (dist > range(a) || dist < (a.minRange ?? 0)) continue;
        if (a.kind !== 'melee' && a.kind !== 'explode' && a.kind !== 'aura' && a.kind !== 'music' && !this.lineOfSight(e, ppos)) continue;
        e.cds[k] = a.cooldown * (0.85 + rnd.next() * 0.3);
        e.atk = a;
        e.state = 'windup';
        e.stateT = 0;
        e.squash.kick(a.kind === 'melee' ? 5 : 3);
        if (a.kind === 'melee' || a.kind === 'explode' || a.kind === 'charge' || a.kind === 'leap') {
          ctx.particles.emit({ pos: { x: e.pos.x, y: e.pos.y + e.height + 0.45, z: e.pos.z }, count: 1, vel: { x: 0, y: 0.8, z: 0 }, life: [a.windup, a.windup], size: [0.5, 0.5], sprite: 'dg_!', color: a.kind === 'explode' ? 0xff4020 : 0xffd040, screen: true, sizeJitter: 0 });
        }
        if (a.kind === 'explode') ctx.sfx('dynamite_fuse', e.pos, 0.8);
        if (d.id === 'jackal' && a.kind === 'leap') ctx.sfx('jackal_attack', e.pos, 0.7);
        if (d.id === 'giantScorpion') ctx.sfx('giant_scorpion_hiss', e.pos, 0.7);
        if (d.id === 'mummy' && rnd.chance(0.5)) ctx.sfx('mummy_groan', e.pos, 0.6);
        break;
      }
    }
  }

  private move(e: Enemy, wantX: number, wantZ: number, dt: number, ground: number, face: number) {
    const accel = e.def.ai === 'rider' ? 3 : e.def.ai === 'tank' ? 4 : 8;
    e.vel.x = damp(e.vel.x, wantX, accel, dt);
    e.vel.z = damp(e.vel.z, wantZ, accel, dt);
    e.pos.x += e.vel.x * dt;
    e.pos.z += e.vel.z * dt;
    if (!e.flying) {
      // small hop physics for knock-ups
      if (e.vel.y > 0 || e.pos.y > ground + 0.05) {
        e.vel.y -= 22 * dt;
        e.pos.y += e.vel.y * dt;
        if (e.pos.y <= ground) {
          e.pos.y = ground;
          if (e.vel.y < -6) e.squash.kick(-6);
          e.vel.y = 0;
        }
      } else e.pos.y = ground;
    }
    const sp = Math.hypot(e.vel.x, e.vel.z);
    if (sp > 0.3 || e.def.ai === 'ranged' || e.def.ai === 'sniper') e.yaw = dampAngle(e.yaw, e.def.ai === 'ranged' || e.def.ai === 'sniper' || e.def.ai === 'lobber' || e.def.ai === 'support' || e.def.ai === 'whipper' ? Math.atan2(this.player.pos.x - e.pos.x, this.player.pos.z - e.pos.z) : face, 8, dt);
  }

  private lineOfSight(e: Enemy, p: THREE.Vector3) {
    const f = this.ctx.world.field;
    const ox = e.pos.x, oy = e.pos.y + e.height * 0.8, oz = e.pos.z;
    const dx = p.x - ox, dy = p.y + 1.2 - oy, dz = p.z - oz;
    const L = Math.hypot(dx, dy, dz) || 1;
    return f.raycast(ox, oy, oz, dx / L, dy / L, dz / L, L - 0.5, 1.5) < 0;
  }

  private drawLaser(e: Enemy, p: THREE.Vector3, k: number) {
    if (!e.telegraph) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      e.telegraph = new THREE.Line(g, this.laserMat);
      e.telegraph.frustumCulled = false;
      this.ctx.scene.add(e.telegraph);
    }
    const from = new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.8, e.pos.z);
    const to = new THREE.Vector3(p.x, p.y + 1.1, p.z);
    (e.telegraph.geometry as THREE.BufferGeometry).setFromPoints([from, to]);
    (e.telegraph.material as THREE.LineBasicMaterial).opacity = 0.35 + 0.6 * k;
    e.telegraph.visible = Math.sin(k * k * 60) > -0.2 || k < 0.6;
  }
  private clearTelegraph(e: Enemy) {
    if (e.telegraph) {
      e.telegraph.removeFromParent();
      e.telegraph.geometry.dispose();
      e.telegraph = null;
    }
  }

  private strike(e: Enemy, a: AttackDef, ppos: THREE.Vector3, dist: number) {
    const ctx = this.ctx;
    e.state = 'strike';
    e.stateT = 0;
    e.glow = 0;
    this.clearTelegraph(e);
    const dmg = a.dmg * e.dmgMul * (e.buffT > 0 ? 1.2 : 1);
    const from = new THREE.Vector3(e.pos.x + Math.sin(e.yaw) * e.radius, e.pos.y + e.height * 0.7, e.pos.z + Math.cos(e.yaw) * e.radius);
    const target = this.player.center(new THREE.Vector3());
    e.squash.kick(-6);
    switch (a.kind) {
      case 'melee':
        ctx.sfx('melee_whoosh', e.pos, 0.6);
        if (dist < a.range + 0.7 && Math.abs(ppos.y - e.pos.y) < 2) {
          this.player.takeHit({ base: dmg, kind: 'phys', source: 'contact', knock: 5, status: a.status as any }, e.pos);
        }
        break;
      case 'burst':
      case 'fan':
      case 'ring':
      case 'spiral':
      case 'volley':
      case 'lob':
      case 'snipe':
        this.proj.pattern(a.kind, from, target, { count: a.count, spread: a.spread, speed: a.speed, dmg, proj: a.proj, status: a.status as any, sourceId: e.id });
        ctx.fx.muzzle(from, { x: Math.sin(e.yaw), y: 0, z: Math.cos(e.yaw) }, 0xffd090);
        ctx.sfx(a.proj === 'bullet' ? (a.kind === 'fan' && (a.count ?? 1) > 6 ? 'shotgun_shot' : a.kind === 'snipe' ? 'rifle_shot' : 'enemy_shot') : a.proj === 'arrow' ? 'whoosh' : 'whoosh', from, 0.7);
        break;
      case 'leap':
        e.state = 'leap';
        e.leapFrom.copy(e.pos);
        e.leapTo.set(ppos.x + this.player.board.vel.x * 0.4, 0, ppos.z + this.player.board.vel.z * 0.4);
        e.leapTo.y = ctx.world.groundAt(e.leapTo.x, e.leapTo.z);
        ctx.sfx('jackal_attack', e.pos, 0.8);
        break;
      case 'charge':
        e.state = 'charge';
        e.yaw = Math.atan2(ppos.x - e.pos.x, ppos.z - e.pos.z);
        ctx.sfx('giant_scorpion_hiss', e.pos, 0.9);
        break;
      case 'dive':
        e.state = 'dive';
        e.leapFrom.copy(e.pos);
        e.leapTo.set(ppos.x, ppos.y + 0.8, ppos.z);
        ctx.sfx('vulture_screech', e.pos, 0.8);
        ctx.engine.tweens.after(0.55, () => {
          if (e.alive && this.player.pos.distanceTo(e.pos) < 2.6) this.player.takeHit({ base: dmg, kind: 'phys', source: 'contact', knock: 4 }, e.pos);
        });
        break;
      case 'explode': {
        const r = (a.radius ?? 3.5) * e.scale;
        e.hp = 0;
        this.kill(e, null, 0, 0);
        void r;
        break;
      }
      case 'aura': {
        const r = a.radius ?? 5;
        ctx.fx.ring({ x: e.pos.x, y: e.pos.y + 0.2, z: e.pos.z }, 0x8a5aa0, r * 2, 0.6);
        if (dist < r) this.player.takeHit({ base: dmg, kind: 'magic', source: 'curse', status: a.status as any }, e.pos);
        break;
      }
      case 'music': {
        ctx.sfx('banjo_funny', e.pos, 0.5, 1 + rnd.next() * 0.2);
        for (const o of this.list) if (o !== e && o.pos.distanceTo(e.pos) < (a.radius ?? 12)) o.buffT = 4;
        ctx.particles.emit({ pos: { x: e.pos.x, y: e.pos.y + e.height, z: e.pos.z }, count: 8, spread: 2, up: 2, life: [0.8, 1.4], size: [0.25, 0.2], sprite: ['dg_+', 'star4'], color: [0xffd040, 0xff7a5a, 0x9fe0ff], drag: 1 });
        break;
      }
      case 'whip': {
        const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
        for (let s = 1; s <= 8; s++) ctx.fx.dust({ x: e.pos.x + fx * s, y: e.pos.y + 0.2, z: e.pos.z + fz * s }, 0.3, P.linen1, 1);
        ctx.sfx('whoosh', e.pos, 0.8, 0.8);
        const px = ppos.x - e.pos.x, pz = ppos.z - e.pos.z;
        const along = px * fx + pz * fz, lat = Math.abs(-px * fz + pz * fx);
        if (along > 0 && along < a.range + 0.5 && lat < 1.3) this.player.takeHit({ base: dmg, kind: 'phys', source: 'contact', knock: 6, status: a.status as any }, e.pos);
        break;
      }
      case 'lasso': {
        ctx.sfx('whoosh', e.pos, 0.7);
        if (dist < a.range && this.lineOfSight(e, ppos)) {
          this.player.status.apply('slow', 1, 1.5, 0, 1, {});
          const pull = new THREE.Vector3(e.pos.x - ppos.x, 0, e.pos.z - ppos.z).normalize().multiplyScalar(9);
          this.player.board.impulse.add(pull);
          this.player.takeHit({ base: dmg, kind: 'phys', source: 'contact' }, e.pos);
          ctx.toast('LASSOED!', '#e0a060');
        }
        break;
      }
      case 'vortex': {
        ctx.fx.dust({ x: e.pos.x, y: e.pos.y + 0.5, z: e.pos.z }, 2, P.sand1, 8);
        if (dist < (a.radius ?? 7)) {
          const pull = new THREE.Vector3(e.pos.x - ppos.x, 0, e.pos.z - ppos.z).normalize().multiplyScalar(7);
          this.player.board.impulse.add(pull);
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------- animation
  private animate(e: Enemy, dt: number, time: number) {
    const sp = Math.hypot(e.vel.x, e.vel.z);
    e.squash.update(1, dt);
    const stride = clamp(sp / Math.max(1, e.def.speed), 0, 1.6);
    e.phase += dt * (2 + sp * 1.3);
    const ph = e.phase;
    const r = e.rot;
    r.fill(0);
    e.posOff.fill(0);
    const hitK = Math.max(0, 1 - e.hitT / 0.3);
    // local hit direction relative to facing
    const hx = e.hitX * Math.cos(e.yaw) - e.hitZ * Math.sin(e.yaw);
    const hz = e.hitX * Math.sin(e.yaw) + e.hitZ * Math.cos(e.yaw);
    const wind = e.state === 'windup' && e.atk ? clamp(e.stateT / e.atk.windup, 0, 1) : 0;
    const strike = e.state === 'strike' ? Math.max(0, 1 - e.stateT / 0.3) : 0;
    const scream = e.state === 'windup' ? wind : e.hitT < 0.2 ? 1 - e.hitT / 0.2 : 0;
    e.jaw = damp(e.jaw, scream * 0.6 + (e.def.id === 'husk' ? Math.max(0, Math.sin(time * 7 + e.quirk * 20)) * 0.15 : 0), 14, dt);
    if (e.skel === 'humanoid') {
      const sw = Math.sin(ph) * 0.65 * Math.min(1, stride);
      const shamble = e.def.id === 'husk' || e.def.id === 'cactusHusk';
      const heavy = e.def.ai === 'tank' || e.def.id === 'bandageWhipper';
      // legs
      e.setRot('thigh_l', -sw, 0, 0);
      e.setRot('thigh_r', sw * (shamble ? 0.6 : 1), 0, 0);
      e.setRot('shin_l', Math.max(0, Math.sin(ph + 1.4)) * 0.9 * stride, 0, 0);
      e.setRot('shin_r', Math.max(0, Math.sin(ph + 1.4 + Math.PI)) * 0.9 * stride * (shamble ? 0.5 : 1), 0, 0);
      // body bob + lean into run
      const bob = Math.abs(Math.cos(ph)) * 0.06 * stride * (heavy ? 1.8 : 1);
      const pi = e.part('pelvis');
      if (pi >= 0) e.posOff[pi * 3 + 1] = bob - (heavy ? 0.04 : 0);
      e.setRot('pelvis', 0, Math.sin(ph) * 0.12 * stride, 0);
      e.setRot('torso', 0.12 * stride + (shamble ? 0.3 : 0) - wind * 0.45 + strike * 0.7 - hz * hitK * 0.6, -Math.sin(ph) * 0.18 * stride + hx * hitK * 0.3, (shamble ? Math.sin(time * 1.3 + e.quirk * 9) * 0.15 : 0) + hx * hitK * 0.4);
      e.setRot('head', (shamble ? 0.25 : 0) - wind * 0.2 + hitK * 0.5, Math.sin(time * 0.9 + e.quirk * 7) * 0.3, shamble ? 0.35 * Math.sin(time * 0.6 + e.quirk) : 0);
      e.setRot('jaw', e.jaw, 0, 0);
      // arms by archetype
      const armSw = -sw * 0.8;
      if (shamble) {
        e.setRot('arm_l', -1.3 + Math.sin(time * 2 + e.quirk) * 0.15 - wind * 1.2 + strike * 1.6, 0, 0.1);
        e.setRot('arm_r', -1.1 + Math.sin(time * 2.4 + e.quirk) * 0.2 - wind * 1.4 + strike * 1.9, 0, -0.1);
        e.setRot('fore_l', -0.4, 0, 0);
        e.setRot('fore_r', -0.5, 0, 0);
      } else if (e.def.id === 'bomberHusk') {
        e.setRot('arm_l', -0.9, 0, 0.5);
        e.setRot('arm_r', -0.9, 0, -0.5);
        e.setRot('fore_l', -1.2, 0, 0);
        e.setRot('fore_r', -1.2, 0, 0);
        e.addRot('head', 0, Math.sin(time * 18) * 0.25, 0); // panicked head shakes
      } else if (e.def.id === 'mariachi') {
        const strum = Math.sin(time * 14) * 0.35;
        e.setRot('arm_r', -0.6 + strum, 0, -0.2);
        e.setRot('fore_r', -1.1, 0, 0);
        e.setRot('arm_l', -0.8, 0.4, 0.3);
        e.setRot('fore_l', -1.0, 0, 0);
        e.addRot('pelvis', 0, 0, Math.sin(time * 4) * 0.15); // dance sway
        e.addRot('torso', 0, Math.sin(time * 4) * 0.2, 0);
      } else if (e.def.ai === 'ranged' || e.def.ai === 'sniper' || e.def.ai === 'ambusher' || e.def.ai === 'rider' || e.def.id === 'dungSkeleton') {
        const aimUp = e.state === 'windup' || e.state === 'strike' ? 1 : 0.25;
        e.setRot('arm_r', -1.45 * aimUp + armSw * (1 - aimUp) - strike * 0.5, 0.2, -0.1);
        e.setRot('fore_r', -0.15, 0, 0);
        e.setRot('arm_l', e.def.id === 'sharpshooter' || e.def.id === 'shotgunner' ? -1.3 * aimUp : -armSw, 0, 0.15);
        e.setRot('fore_l', -0.3 - (e.def.id === 'shotgunner' ? 0.6 * aimUp : 0), 0, 0);
        if (e.def.id === 'dungSkeleton') e.setRot('arm_r', 2.2 * wind - 1.8 * strike, 0, -0.2); // overhand throw
      } else {
        // melee brawlers: wind back arm, slam forward
        e.setRot('arm_r', armSw + wind * 2.1 - strike * 2.4, 0, -0.1 - wind * 0.3);
        e.setRot('fore_r', -0.5 - wind * 0.8, 0, 0);
        e.setRot('arm_l', -armSw + (heavy ? -0.9 - wind * 0.8 + strike * 1.6 : 0), 0, 0.1);
        e.setRot('fore_l', -0.4, 0, 0);
        if (e.def.id === 'jackal') e.setRot('arm_l', -0.6, 0.4, 0.3); // shield up
      }
      if (e.state === 'leap') {
        e.setRot('thigh_l', -1.2, 0, 0);
        e.setRot('thigh_r', -0.9, 0, 0);
        e.setRot('shin_l', 1.8, 0, 0);
        e.setRot('shin_r', 1.6, 0, 0);
        e.setRot('arm_r', 2.6, 0, 0);
      }
      e.setRot('tail', Math.sin(time * 6 + e.quirk * 5) * 0.4, Math.sin(time * 4) * 0.5, 0);
      e.setRot('hat', hitK * -0.4, 0, hitK * 0.3);
      if (e.state === 'hidden') {
        e.setRot('weed', time * 4, 0, 0);
      } else e.setRot('weed', 0, 0, 0);
      if (e.def.ai === 'rider') {
        // surf stance
        e.setRot('pelvis', 0, 0.9, Math.sin(time * 1.5) * 0.08);
        e.setRot('thigh_l', -0.5, 0, 0.25);
        e.setRot('thigh_r', -0.5, 0, -0.25);
        e.setRot('shin_l', 0.9, 0, 0);
        e.setRot('shin_r', 0.9, 0, 0);
        e.setRot('board', 0, -0.9, 0);
      }
    } else if (e.skel === 'beetle') {
      for (let k = 1; k <= 3; k++) {
        const o = k * 2.1;
        e.setRot('leg_l' + k, Math.sin(ph * 2 + o) * 0.5 * stride, Math.cos(ph * 2 + o) * 0.3 * stride, 0);
        e.setRot('leg_r' + k, Math.sin(ph * 2 + o + Math.PI) * 0.5 * stride, -Math.cos(ph * 2 + o + Math.PI) * 0.3 * stride, 0);
      }
      const bi = e.part('body');
      if (bi >= 0) e.posOff[bi * 3 + 1] = Math.abs(Math.sin(ph * 2)) * 0.02 * stride;
      e.setRot('head', -wind * 0.4 + strike * 0.5, Math.sin(time * 3 + e.quirk * 4) * 0.2, 0);
      const wings = e.flipped > 0 ? 0.9 : e.state === 'windup' ? 0.35 : 0;
      e.setRot('wing_l', 0, 0, wings);
      e.setRot('wing_r', 0, 0, -wings);
    } else if (e.skel === 'scorpion') {
      for (let k = 1; k <= 4; k++) {
        const o = k * 1.6;
        e.setRot('leg_l' + k, 0, Math.sin(ph * 2 + o) * 0.35 * stride, Math.cos(ph * 2 + o) * 0.25 * stride);
        e.setRot('leg_r' + k, 0, -Math.sin(ph * 2 + o + 1) * 0.35 * stride, Math.cos(ph * 2 + o + 1) * 0.25 * stride);
      }
      const curl = 0.25 + wind * 0.35 - strike * 0.6;
      for (let k = 1; k <= 5; k++) e.setRot('tail' + k, -curl - Math.sin(time * 2 + k) * 0.05, Math.sin(time * 1.3 + k * 0.4) * 0.06, 0);
      e.setRot('stinger', -curl * 1.2, 0, 0);
      const snap = Math.max(0, Math.sin(time * 5 + e.quirk * 3)) * 0.3 + wind * 0.5;
      e.setRot('arm_l', 0, -0.2 - wind * 0.4 + strike * 0.6, 0);
      e.setRot('arm_r', 0, 0.2 + wind * 0.4 - strike * 0.6, 0);
      e.setRot('pincer_l', 0, -snap, 0);
      e.setRot('pincer_r', 0, snap, 0);
    } else if (e.skel === 'bird') {
      const flap = e.state === 'dive' ? 0.2 : Math.sin(time * 9 + e.quirk * 6) * 0.7;
      e.setRot('wing_l', 0, 0, flap + 0.2);
      e.setRot('wing_r', 0, 0, -flap - 0.2);
      e.setRot('head', -0.3 + (e.state === 'dive' ? 0.5 : 0), Math.sin(time * 2) * 0.3, 0);
      e.setRot('tail', Math.sin(time * 3) * 0.1, 0, 0);
      e.setRot('body', e.state === 'dive' ? 0.9 : 0.1, 0, Math.sin(time * 1.5) * 0.2);
    }
    // jaw scream for every skeleton
    e.setRot('jaw', e.jaw, 0, 0);
  }

  clear() {
    for (const e of this.list) this.clearTelegraph(e);
    this.list.length = 0;
    this.rag.length = 0;
    this.proj.clear();
  }
}
