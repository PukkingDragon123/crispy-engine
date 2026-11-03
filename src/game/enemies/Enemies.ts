// Enemy manager: spawning, AI archetypes, telegraphed attacks, expressive
// procedural animation (anticipation, squash/stretch, recoil, jaw screams),
// damage pipeline hookup, limb loss, ragdoll death pieces, ramming + counters.
import * as THREE from 'three';
import { Gore, fluidFor } from '../fx/Gore';
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
import { EnemyAnim, animateEnemy, AnimEnv, GETUP } from '../anim/enemyAnim';

/** attacks that fire something: they wind up with a muzzle glint and share the ranged fairness cap */
const RANGED = new Set(['burst', 'fan', 'ring', 'spiral', 'snipe', 'lob', 'volley', 'stream']);
/** hit sources that are damage-over-time ticks (no flinch, no poise, no impact fx) */
const DOT = new Set(['poison', 'bleed', 'burn']);
/** multi-kill tiers: kills inside the chain window → callout */
const MULTI: [number, string, string][] = [
  [2, 'DOUBLE KILL', '#ffe28a'],
  [3, 'TRIPLE KILL', '#ffd36b'],
  [4, 'QUAD KILL', '#ffb84a'],
  [5, 'RAMPAGE', '#ff9a3a'],
  [7, 'MASSACRE', '#ff6a3a'],
  [10, 'UNSTOPPABLE', '#ff4a5a'],
];

type Skel = 'humanoid' | 'beetle' | 'scorpion' | 'bird' | 'quad' | 'worm' | 'snake' | 'lizard' | 'other';

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

/**
 * Something an enemy hunts instead of the hunter (escort NPCs). The enemy steers
 * and aims at `pos`; its melee / pounce strikes call `hurt`. Enemy projectiles
 * only collide with the hunter, so the owner checks `enemies.proj.list` itself.
 */
export interface FocusTarget {
  pos: THREE.Vector3;
  alive: boolean;
  radius: number;
  height: number;
  hurt(dmg: number, from: THREE.Vector3, kind: 'melee' | 'leap' | 'contact'): void;
}

/** a lingering ground hazard (acid pools from alpha bell snakes / alpha thorny devils) */
interface Hazard {
  x: number;
  z: number;
  r: number;
  t: number;
  dur: number;
  dps: number;
  tick: number;
  owner: number;
  hurtsEnemies: boolean;
}

/**
 * Song-title skill callouts: small Alagard pixel text that pops above an enemy
 * when it uses a move (typography only; screen-constant size at 2x pixel scale).
 */
class SkillCallouts {
  private pool: { sp: THREE.Sprite; mat: THREE.SpriteMaterial; t: number; life: number; x: number; y: number; z: number; w: number; h: number; on: boolean }[] = [];
  private tex = new Map<string, { tex: THREE.CanvasTexture; w: number; h: number; fontOk: boolean }>();
  constructor(scene: THREE.Scene, n = 7) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      sp.renderOrder = 30;
      sp.frustumCulled = false;
      scene.add(sp);
      this.pool.push({ sp, mat, t: 0, life: 1, x: 0, y: 0, z: 0, w: 1, h: 1, on: false });
    }
  }
  get active() {
    let n = 0;
    for (const c of this.pool) if (c.on) n++;
    return n;
  }
  private texture(text: string, color: string) {
    const key = text + '|' + color;
    const fontOk = typeof document !== 'undefined' && !!document.fonts?.check?.("16px 'Alagard'");
    const hit = this.tex.get(key);
    if (hit && (hit.fontOk || !fontOk)) return hit;
    hit?.tex.dispose();
    const cv = document.createElement('canvas');
    const c = cv.getContext('2d')!;
    c.font = "16px 'Alagard'";
    const w = Math.min(256, Math.ceil(c.measureText(text).width) + 8);
    const h = 22;
    cv.width = w;
    cv.height = h;
    c.font = "16px 'Alagard'";
    c.textBaseline = 'top';
    c.fillStyle = '#1a0e06';
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [2, 2], [1, 2]]) c.fillText(text, 4 + ox, 2 + oy);
    c.fillStyle = color;
    c.fillText(text, 4, 2);
    // crisp pixel edges: snap the anti-aliased type to hard alpha like the HUD's 2x pixel art
    const img = c.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0;
    c.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    const out = { tex, w, h, fontOk };
    this.tex.set(key, out);
    return out;
  }
  show(text: string, color: string, x: number, y: number, z: number) {
    let c = this.pool.find((q) => !q.on);
    if (!c) c = this.pool.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
    const tx = this.texture(text, color);
    c.mat.map = tx.tex;
    c.mat.needsUpdate = true;
    c.w = tx.w;
    c.h = tx.h;
    c.t = 0;
    c.life = 1.5 + Math.min(0.6, text.length * 0.02);
    c.x = x;
    c.y = y;
    c.z = z;
    c.on = true;
    c.sp.visible = true;
  }
  update(dt: number, cam: THREE.PerspectiveCamera, viewH: number) {
    const p11 = cam.projectionMatrix.elements[5] || 1.4;
    // one texture pixel = 2 screen pixels (the HUD's pixel scale)
    const k = (2 * 2) / (Math.max(240, viewH) * p11);
    for (const c of this.pool) {
      if (!c.on) continue;
      c.t += dt;
      if (c.t >= c.life) {
        c.on = false;
        c.sp.visible = false;
        continue;
      }
      const u = c.t / c.life;
      const pop = c.t < 0.12 ? 1.35 - (c.t / 0.12) * 0.35 : 1;
      const rise = (1 - Math.pow(1 - Math.min(1, c.t / 0.9), 3)) * 0.75;
      c.sp.position.set(c.x, c.y + rise, c.z);
      c.sp.scale.set(c.w * k * pop, c.h * k * pop, 1);
      c.mat.opacity = u > 0.78 ? 1 - (u - 0.78) / 0.22 : 1;
    }
  }
  clear() {
    for (const c of this.pool) {
      c.on = false;
      c.sp.visible = false;
    }
  }
}

let NEXT_ID = 1;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _qa = new THREE.Quaternion();
const _root = new THREE.Matrix4();
const _loc = new THREE.Matrix4();
const _eul = new THREE.Euler();
const _lv = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Vector3();

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
  state: 'spawn' | 'move' | 'windup' | 'strike' | 'recover' | 'stagger' | 'down' | 'hidden' | 'charge' | 'leap' | 'dive' | 'burrow' | 'erupt' | 'wrap' = 'spawn';
  stateT = 0;
  atk: AttackDef | null = null;
  /** the wind-up time of the current attack (its def, stretched for fairness: early waves, shots from off-screen) */
  wind = 0.5;
  /** the pre-shot muzzle glint has fired for this wind-up */
  glinted = false;
  /** stagger meter: every hit fills it by its share of max hp, it drains over time; full → stagger */
  poise = 0;
  /** knockdown: fell forward (+1) or onto its back (-1), roll side, seconds on the ground before getting up */
  downDir = -1;
  downSide = 1;
  downDur = 1;
  /** last hit for the animation: 0..1 weight (tap → heavy blow) and whether it was a headshot */
  hitHeavy = 0;
  hitHead = false;
  /** stink-cloud cough cooldown */
  coughCd = 0;
  /** poison stacks last shown as a venom count */
  venomShown = 0;
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
  /** procedural animation memory (springs, gait, death) */
  anim = new EnemyAnim();
  /** worms: time spent surfaced */
  burrowT = 0;
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
  /** Khonsu's sand-forms (wave 75): sand tint, burst into sand on death instead of a corpse. Set by KhonsuSandAvatar. */
  sandForm = false;
  lassoT = 0;
  telegraph: THREE.Line | null = null;
  quirk = rnd.next();
  /** dune worm: seconds of ground tremor left before it erupts */
  tremor = 0;
  /** escort harassers hunt this instead of the hunter (see FocusTarget) */
  focus: FocusTarget | null = null;
  /** pack wolves: flank slot (0..1 across the rear arc) and permission to commit to a bite / pounce */
  slot = 0.5;
  biteToken = false;
  /** duration of the current leap (bell snakes strike faster than wolves pounce) */
  leapDur = 0.75;
  /** snakes / worms: world-space body spheres (x, y, z, r) sampled each frame, for hits along the whole length */
  body: Float32Array | null = null;
  bodyN = 0;
  /** the rig key this one was built from (colour morphs) */
  rigKey: string;
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
    this.rigKey = alpha ? def.rigAlpha : def.variants?.length ? def.variants[Math.floor(rnd.next() * def.variants.length)] : def.rig;
    this.batch = render.get(this.rigKey, def.id === 'husk' || def.id === 'scarab' ? 200 : 96);
    const n = this.batch.nParts;
    this.rot = new Float32Array(n * 3);
    this.posOff = new Float32Array(n * 3);
    this.hidden = new Uint8Array(n);
    const pi = this.batch.partIndex;
    const lizardLegs = ('leg_fl' in pi || 'leg_l1' in pi) && 'tail1' in pi && !('leg_l3' in pi) && !('hips' in pi) && !('chest' in pi);
    this.skel =
      'pelvis' in pi ? 'humanoid'
      : 'seg1' in pi ? (def.ai === 'constrictor' || 'rattle' in pi ? 'snake' : 'worm')
      : lizardLegs ? 'lizard'
      : 'leg_fl' in pi || 'shin_fl' in pi ? 'quad'
      : 'pincer_l' in pi || ('tail1' in pi && 'leg_l4' in pi) ? 'scorpion'
      : 'leg_l3' in pi ? 'beetle'
      : 'wing_l' in pi ? 'bird'
      : 'other';
    this.anim.prevYaw = this.yaw;
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

/** parts that can come off */
const SEVERABLE = /^(arm|fore|hand|thigh|shin|leg|head|tail|claw|pincer|wing|ear|jaw|horn|stinger|mandible|antenna|paw|foot)/;
/** the upper body a blast tears off the hips */
const TORSO = /^(torso|chest|spine|belly|thorax|abdomen)/;
/** ragdoll pieces alive at once before old ones are hurried into the sand */
const RAG_SOFT = 700;
const RAG_HARD = 1000;

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
  gore: Gore;
  /** enemies playing their procedural death before turning into ragdoll pieces */
  dying: Enemy[] = [];
  /** the bell snake currently coiled around the hunter */
  wrapping: Enemy | null = null;
  /** longest a wrap holds before the snake lets go on its own (s). A mash QTE should resolve inside it. */
  wrapMaxT = 4.2;
  private wrapTick = 0;
  private wrapStruggle = 0;
  private lastTitleT = -99;
  /** song-title callouts above enemies using a move */
  callouts: SkillCallouts;
  /** also ribbon-toast alpha moves (the world callout always shows) */
  skillToasts = true;
  private recentTitles = new Map<string, { t: number; x: number; z: number }>();
  private lastCalloutT = -99;
  private now = 0;
  /** lingering acid pools */
  hazards: Hazard[] = [];
  wave = 1;
  /** fairness: melee / ranged wind-ups in flight this frame (capped so a crowd can't all swing at once) */
  private busyMelee = 0;
  private busyRanged = 0;
  /** camera forward on the ground plane (shots from outside the view wind up longer) */
  private camFX = 0;
  private camFZ = 1;
  /** multi-kill chain: count, time of the last kill, best tier announced, settle timer */
  private mk = { n: 0, t: -99, shown: 0, pending: 0 };
  private coughSfxT = 0;
  private grid = new Map<number, Enemy[]>();
  private laserMat = new THREE.LineBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.85 });

  constructor(private ctx: Ctx, private player: PlayerLink) {
    this.render = new EnemyRender(ctx.scene);
    this.gore = new Gore(ctx);
    this.gore.partWorld = (e: Enemy, part: number, out: THREE.Matrix4) => {
      if (!e.alive && !this.dying.includes(e)) return false;
      if (e.hidden[part]) return false;
      out.copy(this.poseWorld(e)[part]);
      return true;
    };
    this.proj = new Projectiles(ctx, () => player as any);
    this.callouts = new SkillCallouts(ctx.scene);
    // alpha thorny-devil acid drops sometimes leave a small fizzing puddle
    this.proj.onAcid = (x, _y, z, dmg, src) => {
      if (rnd.chance(0.3)) this.addHazard(x, z, 0.85, 2.6, Math.max(4, dmg * 1.2), src, false);
    };
    ctx.events.on('melee', () => this.playerMelee());
    // bell-snake wrap, driven by the coordinator's mash QTE:
    //   'snakeWrapBreak' (snake?, mult?) → the hunter tears free; the snake takes 12% max hp × mult and is dazed
    //   'snakeWrapCrush' (snake?, mult?) → the QTE failed: one brutal squeeze, then the snake lets go
    ctx.events.on('snakeWrapBreak', (en?: Enemy, mult?: number) => {
      const w = en ?? this.wrapping;
      if (w) this.releaseWrap(w, true, mult ?? 1);
    });
    ctx.events.on('snakeWrapCrush', (en?: Enemy, mult?: number) => {
      const w = en ?? this.wrapping;
      if (w) this.wrapCrush(w, mult ?? 1);
    });
    ctx.events.on('grappleKick', (e: Enemy) => this.grappleKick(e));
    ctx.events.on('explosion', (pos: { x: number; y: number; z: number }, r: number, dmg: number, owner: string) => this.explosion(pos, r, dmg, owner));
  }

  get alive() {
    return this.list.length;
  }

  // ------------------------------------------------------------- spawning
  spawn(defId: string, x: number, z: number, opts: { alpha?: boolean; emerge?: Enemy['emerge']; focus?: FocusTarget | null } = {}) {
    const def = ENEMIES[defId];
    if (!def) return null;
    const e = new Enemy(def, !!opts.alpha, this.wave, this.render);
    e.focus = opts.focus ?? null;
    const g = this.ctx.world.groundAt(x, z);
    e.pos.set(x, g, z);
    e.yaw = Math.atan2(this.player.pos.x - x, this.player.pos.z - z);
    e.emerge = opts.emerge ?? (def.flying ? 'fly' : def.id.includes('husk') || def.id === 'mummy' || def.id === 'dungSkeleton' || def.id === 'bellSnake' ? 'sand' : 'run');
    e.state = 'spawn';
    e.spawnT = 0;
    if (e.emerge === 'fly') e.pos.y = g + 18;
    if (def.ai === 'ambusher') e.state = 'hidden';
    if (def.ai === 'burrower') {
      e.state = 'burrow';
      e.stateT = 0.6;
    }
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
      if (!e.alive || (skip && skip.has(e.id)) || e.state === 'hidden' || e.state === 'burrow') continue;
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
      // knocked flat: the body lies low along the sand
      const hgt = e.state === 'down' ? e.height * 0.45 : e.height;
      const yb = e.pos.y - 0.1, yt = e.pos.y + hgt;
      if (y < yb || y > yt) {
        // check head sphere for shots from above
        continue;
      }
      const rel = (y - e.pos.y) / hgt;
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
    // long bodies (bell snakes, dune worms): spheres along the spine, so the whole length can be shot
    for (const e of this.list) {
      if (!e.alive || !e.bodyN || !e.body || (skip && skip.has(e.id)) || e.state === 'hidden' || e.state === 'burrow' || e.anim.hidden) continue;
      const b = e.body;
      for (let k = 0; k < e.bodyN; k++) {
        const cx = b[k * 4], cy = b[k * 4 + 1], cz = b[k * 4 + 2], r = b[k * 4 + 3];
        const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
        const bb = ox * d.x + oy * d.y + oz * d.z;
        const disc = bb * bb - (ox * ox + oy * oy + oz * oz - r * r);
        if (disc < 0) continue;
        let t = -bb - Math.sqrt(disc);
        if (t < 0) t = -bb + Math.sqrt(disc);
        if (t < 0 || t > bestT) continue;
        bestT = t;
        const point = new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
        best = { enemy: e, t, point, normal: new THREE.Vector3(point.x - cx, point.y - cy, point.z - cz).normalize(), headshot: false, part: 'body', surface: 'enemy' };
      }
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
      if (!e.alive || (e as Enemy).state === 'hidden' || (e as Enemy).state === 'burrow') continue;
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
      if (!e.alive || e.state === 'hidden' || e.state === 'burrow') continue;
      const d = this.reach(e, p);
      if (d < r + e.radius) fn(e, d);
    }
    for (const x of this.externals) {
      if (!x.alive) continue;
      const d = Math.hypot(x.pos.x - p.x, x.pos.y + x.height * 0.5 - p.y, x.pos.z - p.z);
      if (d < r + x.radius) fn(x, d);
    }
  }

  /** distance from p to an enemy's body, offset so `d < r + e.radius` tests keep working for long bodies */
  private reach(e: Enemy, p: { x: number; y: number; z: number }) {
    let d = Math.hypot(e.pos.x - p.x, e.pos.y + e.height * 0.5 - p.y, e.pos.z - p.z);
    const b = e.body;
    if (b && e.bodyN) {
      for (let k = 0; k < e.bodyN; k++) {
        const dd = Math.hypot(b[k * 4] - p.x, b[k * 4 + 1] - p.y, b[k * 4 + 2] - p.z) - b[k * 4 + 3] + e.radius;
        if (dd < d) d = dd;
      }
    }
    return d;
  }
  /** nearest point of a long body to p on the ground plane (writes out, returns the flat distance) */
  private bodyPoint(e: Enemy, p: { x: number; z: number }, out: THREE.Vector3) {
    out.set(e.pos.x, e.pos.y, e.pos.z);
    let best = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
    const b = e.body;
    if (b && e.bodyN) {
      for (let k = 0; k < e.bodyN; k++) {
        const dd = Math.hypot(b[k * 4] - p.x, b[k * 4 + 2] - p.z) - b[k * 4 + 3] + e.radius;
        if (dd < best) {
          best = dd;
          out.set(b[k * 4], b[k * 4 + 1] - b[k * 4 + 3], b[k * 4 + 2]);
        }
      }
    }
    return best;
  }

  /** sample the spine of a snake / worm from the pose just pushed to its batch */
  private sampleBody(e: Enemy) {
    const idx = e.batch.partIndex;
    const meta = e.batch.meta;
    const segR = meta.segRadius as number[] | undefined;
    const baseR = (meta.radius as number) ?? e.def.radius * 0.5;
    let nSeg = 0;
    while (idx['seg' + (nSeg + 1)] !== undefined) nSeg++;
    if (!e.body) e.body = new Float32Array(4 * 12);
    let n = 0;
    for (let k = 2; k <= nSeg && n < 12; k += 2) {
      const W = e.batch.partWorld(idx['seg' + k]).elements;
      const r = (segR?.[k - 1] ?? baseR * (1 - (k / nSeg) * 0.7)) * e.scale * 1.3 + 0.08;
      e.body[n * 4] = W[12];
      e.body[n * 4 + 1] = W[13];
      e.body[n * 4 + 2] = W[14];
      e.body[n * 4 + 3] = r;
      n++;
    }
    e.bodyN = n;
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
    // flipped scarabs take bonus; anything knocked flat takes a little more (ground and pound)
    if (e.flipped > 0) mult *= 2;
    if (e.state === 'down' && !DOT.has(hit.source)) mult *= 1.25;
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
    e.squash.kick(DOT.has(hit.source) ? -1.5 : -4);
    e.hitHead = !!hit.headshot;
    // knockback
    if (hit.knock) {
      const k = (hit.knock * (e.def.ai === 'tank' ? 0.3 : 1)) / e.scale;
      e.vel.x += e.hitX * k * 2.2;
      e.vel.z += e.hitZ * k * 2.2;
    }
    // flinch weight, poise break → stagger, heavy blows → knockdown
    this.react(e, hit, amt);
    // feedback
    const pp = point ?? new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.6, e.pos.z);
    const kind = hit.source === 'poison' ? 'poison' : hit.headshot && e.def.hitKind !== 'chitin' ? 'bone' : e.def.hitKind;
    if (hit.source !== 'poison' && hit.source !== 'bleed' && hit.source !== 'burn') {
      ctx.fx.hit(pp, { x: -e.hitX, y: 0.4, z: -e.hitZ }, kind, res.crit ? 1.5 : 1);
      // a round goes through: the exit spray leaves out the back along the shot
      if (dir && (hit.source === 'gun' || hit.source === 'projectile') && !e.sandForm) {
        const ex = { x: pp.x + dir.x * e.radius * 0.8, y: pp.y + (dir.y ?? 0) * e.radius * 0.8, z: pp.z + dir.z * e.radius * 0.8 };
        this.gore.exitWound(ex, dir, fluidFor(e.def.id, e.def.hitKind, e.alpha), res.crit ? 1.45 : hit.headshot ? 1.25 : 1);
      }
      ctx.sfx(e.def.hitKind === 'chitin' || e.def.hitKind === 'armor' ? 'hit_armor' : e.def.hitKind === 'bone' ? 'hit_bone' : 'hit_flesh', pp, 0.7);
      if (hit.headshot) ctx.sfx('headshot', pp, 0.8);
      if (res.crit) ctx.sfx('hit_crit', pp, 0.6);
      if (hit.status?.some((s) => s.id === 'poison')) ctx.events.emit('groundMark', pp.x, pp.z, 0.35, 3);
      else if (e.def.hitKind === 'flesh') ctx.events.emit('groundMark', pp.x + e.hitX * 0.8, pp.z + e.hitZ * 0.8, 0.4, 2);
    }
    const venom = hit.source === 'scorpion';
    const col = res.superCrit ? 0xff4a2a : res.crit ? 0xffd040 : venom ? 0xb4ff52 : hit.source === 'swarm' ? 0xd8e070 : hit.source === 'poison' ? 0x9dff3a : hit.source === 'burn' ? 0xffa040 : hit.source === 'bleed' ? 0xe04040 : 0xffffff;
    ctx.fx.number({ x: pp.x, y: pp.y + 0.3, z: pp.z }, amt, col, res.crit ? 1.3 : hit.headshot ? 1.2 : venom ? 1.1 : hit.source === 'poison' ? 0.75 : hit.source === 'swarm' ? 0.8 : 1);
    // venom: a sting froths green bubbles (more the deeper the poison), and every 5th stack pops the count
    if (venom && e.hp > 0) {
      const st = e.status.stacks('poison');
      ctx.fx.bubbles({ x: pp.x, y: pp.y + 0.1, z: pp.z }, Math.min(9, 2 + Math.floor(st / 3)));
      ctx.particles.emit({ pos: pp, count: 1, life: [0.13, 0.16], size: [0.32, 0.6], sprite: 'venomSplat', color: 0xffffff, additive: true, rot: 6.28 });
      if (Math.floor(st / 5) > Math.floor(e.venomShown / 5)) ctx.fx.number({ x: e.pos.x, y: e.pos.y + e.height + 0.5, z: e.pos.z }, 'x' + Math.floor(st), 0x9dff3a, 0.95, 1.1);
      e.venomShown = st;
    }
    if (res.superCrit) ctx.toast('SHATTER!', '#ff6a3a');
    for (const c of res.combos) this.combo(e, c);
    // DOOM
    if (doomCheck({ hp: e.hp, maxHp: e.maxHp, armor: 0, physRes: 0, magicRes: 0, statusRes: {}, status: e.status }) && e.hp < e.maxHp * 0.2) {
      e.hp = 0;
      ctx.toast('DOOM', '#b565ff');
      ctx.fx.explosion(pp, 2, 'curse');
    }
    ctx.events.emit('enemyHit', e, hit, amt, res);
    // harassers chasing an escort turn on the hunter who shoots them
    if (e.focus && hit.source !== 'poison' && hit.source !== 'bleed' && hit.source !== 'burn' && rnd.chance(0.45)) e.focus = null;
    // limb loss: killing blows always take the limb they hit, big hits usually do,
    // crits sometimes; a headshot kill takes the head clean off
    const dot = hit.source === 'poison' || hit.source === 'bleed' || hit.source === 'burn';
    let part = hit.tags?.[0];
    if (hit.headshot && e.hp <= 0) part = 'head';
    const pi = part ? e.part(part) : -1;
    // a crit headshot kill (and now and then a plain one) bursts the skull instead of popping the head off
    let burst = false;
    if (!dot && hit.headshot && e.hp <= 0 && !e.sandForm && (res.crit || rnd.chance(0.3))) burst = this.burstHead(e, e.hitX, e.hitZ);
    if (!burst && !dot && part && pi >= 0 && e.batch.geo.parts[pi].parent >= 0 && SEVERABLE.test(part)) {
      const chance = e.hp <= 0 ? 1 : amt >= e.maxHp * 0.25 ? 0.85 : res.crit ? 0.4 : 0;
      if (chance > 0 && rnd.chance(chance)) {
        this.detach(e, part, e.hitX, e.hitZ);
        // a biped that loses a leg goes down
        if (e.hp > 0 && e.skel === 'humanoid' && /^(thigh|shin|leg)/.test(part)) e.hp = 0;
      }
    }
    if (e.hp <= 0) this.kill(e, hit, e.hitX, e.hitZ, res.crit, burst);
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

  // ------------------------------------------------------------- hit reactions
  /**
   * How a living enemy answers a hit. Every hit flinches it (the animation reads
   * hitX/hitZ/hitHeavy/hitHead). Hits fill its poise; a full meter staggers it
   * out of whatever it was winding up. Heavy blows (blasts, counters, grapple
   * kicks, rams, the ult) knock light and medium bodies flat; a plain kick
   * bowls over anything small.
   */
  private react(e: Enemy, hit: Hit, amt: number) {
    const src = hit.source;
    if (DOT.has(src) || e.hp <= 0) return;
    const knock = hit.knock ?? 0;
    const heavy = src === 'explosion' || src === 'counter' || src === 'grapple' || src === 'board' || src === 'ult' || knock >= 9;
    const share = amt / Math.max(1, e.maxHp);
    e.hitHeavy = heavy ? 1 : clamp(0.22 + share * 2.6, 0.22, 0.85);
    e.poise += share * (src === 'swarm' ? 0.45 : 1) + (heavy ? 0.45 : src === 'melee' ? 0.25 : 0.04);
    const s = e.state;
    if (s === 'down') return;
    // committed moves ride through hits, except a counter or a blast swatting a pounce / charge
    if (s === 'charge' || s === 'leap' || s === 'dive' || s === 'wrap' || s === 'burrow' || s === 'hidden' || s === 'spawn' || s === 'erupt') {
      if (!((s === 'leap' || s === 'charge') && (src === 'counter' || src === 'explosion' || src === 'grapple'))) return;
    }
    const small = e.def.hp <= 60 && e.def.ai !== 'tank';
    if ((heavy || (src === 'melee' && small)) && this.canFall(e, src)) {
      this.knockdown(e, e.hitX, e.hitZ, src);
      return;
    }
    if (e.poise >= this.poiseCap(e) || (heavy && s !== 'stagger')) this.stagger(e, heavy ? 0.7 : 0.45);
  }

  private poiseCap(e: Enemy) {
    const ai = e.def.ai;
    const tough = ai === 'tank' || ai === 'charger' || ai === 'constrictor' || ai === 'burrower';
    return (tough ? 0.75 : 0.4) * (e.alpha ? 1.6 : 1);
  }

  /** can this body be knocked flat? (long bodies, flyers and bosses can't; heavies only by a counter / the ult) */
  private canFall(e: Enemy, src: string) {
    if (e.flying || e.isBoss || e.focus) return src === 'counter' && !e.flying && !e.isBoss;
    const sk = e.skel;
    if (sk === 'snake' || sk === 'worm' || sk === 'bird' || sk === 'other') return false;
    if (e.def.ai === 'tank' || e.def.ai === 'charger' || e.alpha) return src === 'counter' || src === 'ult' || (src === 'explosion' && !e.alpha && e.def.ai !== 'charger');
    return true;
  }

  /** stagger for `dur` seconds: interrupts the wind-up, drops the telegraph */
  stagger(target: EnemyLike, dur = 0.45) {
    if (!(target instanceof Enemy) || !target.alive) return;
    const e = target;
    if (e.state === 'down' || e.state === 'wrap' || e.state === 'burrow' || e.state === 'hidden' || e.state === 'spawn') return;
    // stagger ends at stateT 0.45: keep whichever leaves the longer stagger
    const was = e.state === 'stagger' ? e.stateT : 0.45;
    e.state = 'stagger';
    e.stateT = Math.min(was, 0.45 - dur);
    e.poise = 0;
    e.glow = 0;
    this.clearTelegraph(e);
  }

  /** knocked flat: tossed along the push, lies a beat, then gets back up (animation: enemyAnim downPose) */
  knockdown(target: EnemyLike, dx: number, dz: number, src = 'explosion') {
    if (!(target instanceof Enemy) || !target.alive) return;
    const e = target;
    const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
    const lz = dx * sy + dz * cy;
    const lx = dx * cy - dz * sy;
    if (this.wrapping === e) this.releaseWrap(e, true, 0.5);
    e.state = 'down';
    e.stateT = 0;
    e.poise = 0;
    e.glow = 0;
    e.downDir = lz >= 0 ? 1 : -1;
    e.downSide = lx >= 0 ? -1 : 1;
    e.downDur = (src === 'counter' ? 1.45 : src === 'explosion' ? 1.15 : src === 'melee' ? 0.75 : 0.95) + rnd.next() * 0.3;
    const toss = src === 'explosion' ? 6.5 : src === 'counter' ? 5.5 : src === 'board' || src === 'ult' ? 5.2 : src === 'grapple' ? 4.6 : 3.4;
    e.vel.y = Math.max(e.vel.y, toss / Math.sqrt(e.scale));
    e.squash.kick(6);
    e.anim.downImp = false;
    this.clearTelegraph(e);
  }

  /**
   * Stink: a coughing fit doubles it over and breaks its wind-up. Cooldown
   * inside, so a cloud can call it every tick.
   */
  cough(target: EnemyLike, power = 1) {
    if (!(target instanceof Enemy) || !target.alive) return false;
    const e = target;
    const s = e.state;
    if (e.coughCd > 0 || e.flying || s === 'down' || s === 'spawn' || s === 'burrow' || s === 'hidden' || s === 'wrap' || s === 'charge' || s === 'leap' || s === 'erupt') return false;
    if (e.skel === 'worm') return false;
    e.coughCd = 1.5 + rnd.next() * 1.1;
    e.anim.coughT = 0;
    if (s === 'windup' || s === 'move' || s === 'recover' || s === 'strike') this.stagger(e, 0.5 * power);
    const ctx = this.ctx;
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    const mouth = { x: e.pos.x + fx * e.radius * 0.7, y: e.pos.y + e.height * (e.skel === 'humanoid' ? 0.8 : 0.6), z: e.pos.z + fz * e.radius * 0.7 };
    ctx.particles.emit({ pos: mouth, count: 3, vel: { x: fx * 1.6, y: 0.4, z: fz * 1.6 }, spread: 0.6, life: [0.5, 1], size: [0.14, 0.5], sprite: ['puff0', 'puff1'], color: [0x9dbf4a, 0x7fae3a, 0xb8d070], alpha: 0.55, drag: 2.5, rot: 6, rotSpeed: 0.8 });
    ctx.particles.emit({ pos: mouth, count: 5, vel: { x: fx * 3, y: 0.8, z: fz * 3 }, spread: 1.2, life: [0.25, 0.5], size: [0.05, 0.03], sprite: 'dot3', color: [0xc8e070, 0x8a7a3a, 0x9dff3a], gravity: 12, ground: true });
    if (this.now - this.coughSfxT > 0.22) {
      this.coughSfxT = this.now;
      const hk = e.def.hitKind;
      if (hk === 'bone') ctx.sfx('skeleton_rattle', mouth, 0.4, 1.35 + rnd.next() * 0.2);
      else if (e.skel === 'humanoid') ctx.sfx('husk_groan', mouth, 0.38, 1.45 + rnd.next() * 0.25);
      else if (e.skel === 'quad') ctx.sfx('jackal_growl', mouth, 0.35, 1.5);
      else ctx.sfx('scarab_squish', mouth, 0.3, 1.3);
    }
    return true;
  }

  /** multi-kill chain: callouts settle a beat after the last kill so a blast reads as one big number */
  private countKill() {
    const mk = this.mk;
    if (this.now - mk.t > 1.25) {
      mk.n = 0;
      mk.shown = 0;
    }
    mk.n++;
    mk.t = this.now;
    if (mk.n >= 2) mk.pending = 0.16;
  }

  private announceMulti() {
    const mk = this.mk;
    let tier = -1;
    for (let i = 0; i < MULTI.length; i++) if (mk.n >= MULTI[i][0]) tier = i;
    if (tier < 0 || tier < mk.shown) return;
    mk.shown = tier + 1;
    const [, name, color] = MULTI[tier];
    const ctx = this.ctx;
    const n = mk.n;
    ctx.toast(name, color, n >= 5 ? `${n} in one breath` : undefined, n >= 7);
    ctx.sfx('sting_positive', null, Math.min(0.75, 0.36 + n * 0.05), 0.9 + Math.min(10, n) * 0.06);
    ctx.sfx('qte_good', null, 0.32, 1.05 + Math.min(10, n) * 0.05);
    if (n >= 4) ctx.sfx('gold_burst', null, 0.4, 1.1);
    if (n >= 5) ctx.sfx('divine_chime', null, 0.45, 1.2);
    if (n >= 7) {
      ctx.engine.slowMo(0.45, 30);
      ctx.engine.tweens.after(0.3, () => ctx.engine.slowMo(1, 6), true);
    }
    ctx.events.emit('multiKill', n, name);
  }

  // ------------------------------------------------------------- telegraphs
  /**
   * Readable tells while an attack winds up: a glinting red wedge on the sand
   * where a melee lunge will land, a landing circle for pounces, a lane for
   * charges, the blast circle of a fuse, and a muzzle glint (+ hammer click)
   * a fixed beat before anything fires.
   */
  private telegraphFx(e: Enemy, a: AttackDef, W: number, ppos: THREE.Vector3, pvel: THREE.Vector3, dt: number) {
    const ctx = this.ctx;
    const k = clamp(e.stateT / W, 0, 1);
    if (RANGED.has(a.kind)) {
      const lead = Math.min(0.34, W * 0.55);
      if (!e.glinted && e.stateT >= W - lead) {
        e.glinted = true;
        this.glint(e, a);
      }
      return;
    }
    if (e.focus) return;
    const camD = ctx.camera.position.distanceTo(e.pos);
    if (camD > 60) return;
    const P = ctx.particles;
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    const heat = k > 0.7 ? [0xff3a1a, 0xff6a2a, 0xffd0a0] : [0xffb040, 0xff8a2a, 0xffe0a0];
    const dot = (x: number, z: number, edge: boolean) => {
      const y = ctx.world.groundAt(x, z) + 0.06;
      P.emit({ pos: { x, y, z }, count: 1, vel: { x: 0, y: edge ? 0.15 : 0.35, z: 0 }, life: edge ? [0.14, 0.2] : [0.18, 0.3], size: edge ? [0.11, 0.07] : [0.08, 0.03], sprite: edge ? 'dot3' : 'grain0', additive: edge, color: heat, sizeJitter: 0.2 });
    };
    const rate = dt * (40 + 80 * k);
    let n = Math.floor(rate) + (rnd.chance(rate % 1) ? 1 : 0);
    if (a.kind === 'melee') {
      // the lunge wedge: a crisp arc at full reach, sparks filling in as it coils
      const L = (a.range + 0.6) * Math.max(1, e.scale * 0.9) + e.radius;
      const half = 0.55;
      while (n-- > 0) {
        const edge = rnd.chance(0.55);
        const th = (rnd.next() * 2 - 1) * half;
        const r = edge ? L : e.radius + Math.sqrt(rnd.next()) * (L - e.radius) * (0.4 + 0.6 * k);
        const lx = Math.sin(th) * r, lz = Math.cos(th) * r;
        dot(e.pos.x + fx * lz + fz * lx, e.pos.z + fz * lz - fx * lx, edge);
      }
    } else if (a.kind === 'leap' && e.def.ai !== 'constrictor') {
      // where the pounce lands (follows the hunter's lead, like the strike does)
      const cx = ppos.x + pvel.x * 0.4, cz = ppos.z + pvel.z * 0.4;
      const R = 1.5 + e.radius;
      while (n-- > 0) {
        const th = rnd.next() * Math.PI * 2;
        const edge = rnd.chance(0.75);
        const r = edge ? R : Math.sqrt(rnd.next()) * R * k;
        dot(cx + Math.cos(th) * r, cz + Math.sin(th) * r, edge);
      }
    } else if (a.kind === 'charge') {
      // the lane it will tear down
      const L = 14;
      const wdt = e.radius + 0.5;
      while (n-- > 0) {
        const s = rnd.next() * L * (0.3 + 0.7 * k);
        const side = rnd.sign() * wdt;
        dot(e.pos.x + fx * s + fz * side, e.pos.z + fz * s - fx * side, true);
      }
    } else if (a.kind === 'explode') {
      const R = (a.radius ?? 3.5) * e.scale;
      while (n-- > 0) {
        const th = rnd.next() * Math.PI * 2;
        dot(e.pos.x + Math.cos(th) * R, e.pos.z + Math.sin(th) * R, true);
      }
    }
  }

  /** the beat before a shot: a hard star glint at the muzzle and a hammer click for guns */
  private glint(e: Enemy, a: AttackDef) {
    const ctx = this.ctx;
    const at = new THREE.Vector3();
    const ok = this.socketWorld(e, 'muzzle', at) ?? this.socketWorld(e, 'mouth', at) ?? (e.skel === 'lizard' ? this.socketWorld(e, 'eye_tip_l', at) : null) ?? this.socketWorld(e, 'hand_r', at);
    if (!ok) at.set(e.pos.x + Math.sin(e.yaw) * e.radius, e.pos.y + e.height * 0.7, e.pos.z + Math.cos(e.yaw) * e.radius);
    const col = a.proj === 'venom' ? 0xc8ff5a : a.proj === 'blood' ? 0xff6a5a : a.proj === 'curse' ? 0xd8b0ff : 0xfff2c0;
    const P = ctx.particles;
    P.emit({ pos: at, count: 1, life: [0.24, 0.24], size: [0.75, 0.15], sprite: 'star4', additive: true, color: col, screen: true, sizeJitter: 0, rot: 0.4 });
    P.emit({ pos: at, count: 1, life: [0.16, 0.16], size: [0.55, 0.1], sprite: 'glow16', additive: true, color: col, alpha: 0.8, screen: true, sizeJitter: 0 });
    ctx.fx.light(at, col, 2.5, 0.14, 5);
    if (a.proj === 'bullet' || a.proj === 'dynamite' || !a.proj) ctx.sfx('rev_hammer', at, 0.5, a.kind === 'snipe' ? 0.7 : 0.82 + rnd.next() * 0.08);
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
    const W = this.poseWorld(e);
    hideRec(i);
    let limbPiece: RagPiece | null = null;
    parts.forEach((_, j) => {
      if (!e.hidden[j] || before.has(j)) return;
      const r = this.spawnPiece(e, j, dx * 6 + (rnd.next() - 0.5) * 3, 4 + rnd.next() * 3 + (partName === 'head' ? 4 : 0), dz * 6 + (rnd.next() - 0.5) * 3, W);
      r.life += 5; // severed limbs linger, tumbling and bleeding into the sand
      if (j === i) limbPiece = r;
    });
    this.goreCut(e, i, W, limbPiece, partName === 'head', null);
    const p = { x: e.pos.x, y: e.pos.y + e.height * (partName === 'head' ? 0.9 : 0.6), z: e.pos.z };
    this.ctx.fx.hit(p, { x: dx, y: 0.6, z: dz }, e.def.hitKind === 'flesh' ? 'flesh' : 'bone', 1.4);
    this.ctx.sfx('limb_off', p, 0.7);
    if (partName === 'head') this.ctx.events.emit('decap', e);
  }

  /** wound caps, arterial jets, the splash: the satisfying part of losing a limb */
  private goreCut(e: Enemy, j: number, W: THREE.Matrix4[], limbPiece: RagPiece | null, head: boolean, pieces: Map<number, RagPiece> | null, fountain = 1) {
    const parts = e.batch.geo.parts;
    const p = parts[j];
    const g = p.geo;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox!;
    const joint = new THREE.Vector3().setFromMatrixPosition(W[j]);
    const dir = bb.getCenter(new THREE.Vector3()).applyMatrix4(W[j]).sub(joint);
    if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
    dir.normalize();
    const ext = bb.getSize(new THREE.Vector3());
    const sc = new THREE.Vector3().setFromMatrixScale(W[j]).x;
    const e3 = [ext.x, ext.y, ext.z].sort((a, b) => a - b);
    const size = (head ? e3[0] * 0.55 : (e3[0] + e3[1]) * 0.4) * sc;
    const holder = p.parent;
    const fluid = fluidFor(e.def.id, e.def.hitKind, e.alpha);
    this.gore.sever({
      e,
      holder,
      holderW: holder >= 0 && !e.hidden[holder] ? W[holder] : null,
      joint,
      dir,
      size,
      fluid,
      head,
      piece: limbPiece,
      pieceW: limbPiece ? W[j] : null,
      fountain,
    });
    if (pieces && holder >= 0) {
      const hp = pieces.get(holder);
      if (hp) this.gore.rehome(e, holder, hp);
    }
    this.ctx.sfx(fluid === 'blood' || fluid === 'ichor' || fluid === 'acid' ? 'gore_splat' : 'hit_bone', joint, head ? 0.9 : 0.6, head ? 0.85 : 1);
    this.ctx.engine.hitStop(head ? 0.085 : 0.045);
    if (head) this.ctx.shake(0.25);
  }

  /** the Neck Slicer (and anything else that wants a head): off it comes, the body stands a beat, then drops */
  decapitate(e: Enemy, dx: number, dz: number) {
    if (!e.alive || e.part('head') < 0 || e.hidden[e.part('head')]) return false;
    this.detach(e, 'head', dx, dz);
    e.hp = 0;
    this.kill(e, null, dx * 0.3, dz * 0.3, true, true);
    return true;
  }

  /**
   * A crit headshot pops the skull: bone chips, voxel gibs and a cloud of
   * mist blown out along the shot, whatever it wore flies off whole, and the
   * neck stump pumps a fountain while the body stands a beat and drops.
   */
  burstHead(e: Enemy, dx: number, dz: number) {
    const i = e.part('head');
    const parts = e.batch.geo.parts;
    if (i < 0 || e.hidden[i] || parts[i].parent < 0) return false;
    const W = this.poseWorld(e);
    const g = parts[i].geo;
    if (!g.boundingBox) g.computeBoundingBox();
    const at = g.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(W[i]);
    const size = g.boundingBox!.getSize(new THREE.Vector3()).length() * new THREE.Vector3().setFromMatrixScale(W[i]).x;
    const before = new Set<number>();
    parts.forEach((_, j) => e.hidden[j] && before.add(j));
    const hideRec = (k: number) => {
      e.hidden[k] = 1;
      parts.forEach((p, j) => {
        if (p.parent === k) hideRec(j);
      });
    };
    hideRec(i);
    parts.forEach((_, j) => {
      if (j === i || !e.hidden[j] || before.has(j)) return;
      const r = this.spawnPiece(e, j, dx * 3 + (rnd.next() - 0.5) * 3, 5 + rnd.next() * 3, dz * 3 + (rnd.next() - 0.5) * 3, W);
      r.life += 4;
    });
    const fluid = fluidFor(e.def.id, e.def.hitKind, e.alpha);
    this.gore.skullBurst(at, { x: dx, z: dz }, fluid, clamp(size / 0.45, 0.7, 1.8));
    this.goreCut(e, i, W, null, true, null, 1.7);
    this.ctx.sfx('headshot', at, 1, 0.92);
    this.ctx.sfx('gore_splat', at, 0.9, 0.8);
    this.ctx.engine.hitStop(0.1);
    this.ctx.shake(0.32);
    this.ctx.events.emit('decap', e);
    this.ctx.events.emit('skullBurst', e);
    return true;
  }

  /** how long a ragdoll piece lingers before sinking (shorter when the field is crowded) */
  private pieceLife() {
    const n = this.rag.length;
    return (6.5 + rnd.next() * 2.5) * (n > RAG_SOFT ? 0.45 : n > RAG_SOFT * 0.6 ? 0.75 : 1);
  }

  private spawnPiece(e: Enemy, part: number, vx: number, vy: number, vz: number, pose?: THREE.Matrix4[]) {
    const W = pose ? pose[part] : this.poseWorld(e)[part];
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), sc = new THREE.Vector3();
    W.decompose(pos, quat, sc);
    const r: RagPiece = { batch: e.batch, part, pos, quat, vel: new THREE.Vector3(vx, vy, vz), ang: new THREE.Vector3((rnd.next() - 0.5) * 16, (rnd.next() - 0.5) * 16, (rnd.next() - 0.5) * 16), life: this.pieceLife(), scale: sc.x, rest: false, tint: e.tint.clone() };
    this.rag.push(r);
    this.gore.rehome(e, part, r);
    return r;
  }

  kill(e: Enemy, hit: Hit | null, dx: number, dz: number, crit = false, collapse = false) {
    if (!e.alive) return;
    e.alive = false;
    const ctx = this.ctx;
    this.clearTelegraph(e);
    const c = { x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z };
    const fluid = fluidFor(e.def.id, e.def.hitKind, e.alpha);
    // violent deaths send the bones flying; everything else collapses procedurally first
    const headI = e.part('head');
    const violent = !collapse && (!hit || (hit.knock ?? 0) >= 9 || hit.source === 'explosion' || hit.source === 'board' || (crit && rnd.chance(0.35)) || (headI >= 0 && e.hidden[headI] === 1));
    if (e.sandForm) {
      // a sand-form just falls apart into the dune
      ctx.fx.sandBurst(c, 1.3 * e.scale);
      ctx.fx.dust({ x: e.pos.x, y: e.pos.y + 0.3, z: e.pos.z }, 1.1 * e.scale, P.sand1, 5);
      ctx.sfx('sand_burst', c, 0.7);
    } else if (violent) {
      const blast = hit?.source === 'explosion' || hit?.source === 'board';
      const force = 5 + (hit?.knock ?? 2) * 1.5 + (crit ? 3 : 0) + (blast ? 2 : 0);
      const W = this.poseWorld(e);
      const pieces = new Map<number, RagPiece>();
      const parts = e.batch.geo.parts;
      // a blast or a ram tears the body at the waist: the upper half is thrown up and
      // back, the hips and legs skid off low
      const torso = blast ? parts.findIndex((p, j) => TORSO.test(p.name) && p.parent >= 0 && !e.hidden[j]) : -1;
      const upper = new Set<number>();
      if (torso >= 0) {
        const mark = (k: number) => {
          upper.add(k);
          parts.forEach((p, j) => p.parent === k && mark(j));
        };
        mark(torso);
      }
      parts.forEach((p, j) => {
        if (e.hidden[j]) return;
        let up = 2 + rnd.next() * 4 + (p.name === 'head' || p.name === 'hat' ? 3.5 : 0);
        let f = force;
        if (torso >= 0) {
          if (upper.has(j)) {
            up += 2.5;
            f *= 1.15;
          } else {
            up *= 0.45;
            f *= 0.65;
          }
        }
        const r = this.spawnPiece(e, j, dx * f * (0.5 + rnd.next() * 0.8) + e.vel.x * 0.5 + (rnd.next() - 0.5) * 3, up, dz * f * (0.5 + rnd.next() * 0.8) + e.vel.z * 0.5 + (rnd.next() - 0.5) * 3, W);
        r.life += blast ? 2.5 : 1.5; // what is left of a violent death lies there a while
        pieces.set(j, r);
      });
      // torn apart at several joints (many for blasts), plus voxel gibs
      if (torso >= 0) {
        this.goreCut(e, torso, W, pieces.get(torso) ?? null, false, pieces);
        this.gore.split(new THREE.Vector3().setFromMatrixPosition(W[torso]), { x: dx, z: dz }, fluid, e.scale);
      }
      const cuts = parts.map((p, j) => j).filter((j) => parts[j].parent >= 0 && !e.hidden[j] && SEVERABLE.test(parts[j].name));
      for (let k = cuts.length - 1; k > 0; k--) {
        const r = Math.floor(rnd.next() * (k + 1));
        [cuts[k], cuts[r]] = [cuts[r], cuts[k]];
      }
      for (const j of cuts.slice(0, blast ? 5 : crit ? 3 : 2)) this.goreCut(e, j, W, pieces.get(j) ?? null, parts[j].name === 'head', pieces);
      this.gore.gibs(c, fluid, blast ? 18 : 8, blast ? 1.6 : 1.1);
    } else {
      this.gore.pool(e.pos.x, e.pos.z, 0.6 + e.radius * 1.2, fluid);
      // fall away from the shot (local push direction), sideways at random
      const lz = dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw);
      const dur = e.skel === 'humanoid' ? 1.35 : e.skel === 'quad' ? 1.4 : e.skel === 'worm' ? 1.6 : e.skel === 'snake' ? 1.7 : e.skel === 'lizard' ? 1.15 : e.skel === 'bird' ? 1.3 : e.skel === 'beetle' ? 1.1 : e.skel === 'scorpion' ? 1.2 : 0.6;
      e.anim.die(lz >= 0 ? -1 : 1, rnd.chance(0.5) ? 1 : -1, dur);
      // finished off while lying in the sand: it just goes still where it fell
      if (e.state === 'down') e.anim.dieWhereLying(e.downDir, e.downSide);
      e.vel.x += dx * 2;
      e.vel.z += dz * 2;
      this.dying.push(e);
    }
    ctx.fx.hit(c, { x: dx, y: 0.5, z: dz }, e.def.hitKind, 1.8);
    ctx.fx.dust({ x: e.pos.x, y: e.pos.y + 0.2, z: e.pos.z }, 0.8 * e.scale, P.sand0, 3);
    const deathSfx: Record<string, string> = { husk: 'husk_death', mummy: 'mummy_death', jackal: 'jackal_growl', giantScorpion: 'giant_scorpion_death', vulture: 'vulture_screech', gunslinger: 'skeleton_rattle', sandWolf: 'jackal_growl', bellSnake: 'giant_scorpion_hiss', duneWorm: 'sand_burst' };
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
      case 'acidBurst':
        if (e.alpha) {
          ctx.engine.tweens.after(0.35, () => {
            // the venom sac ruptures: acid globs arc out and splat, droplets rain, fumes roll
            for (let i = 0; i < 14; i++) {
              const a = (i / 14) * Math.PI * 2 + Math.random() * 0.35;
              const sp = 4.5 + Math.random() * 4.5;
              this.proj.spawn({ kind: 'venom', x: c.x, y: c.y + 0.35, z: c.z, vx: Math.sin(a) * sp, vy: 3.5 + Math.random() * 4.5, vz: Math.cos(a) * sp, dmg: 6 * e.dmgMul, status: [{ id: 'poison', stacks: 2, dur: 4, power: 2 }], sourceId: e.id });
            }
            ctx.particles.emit({ pos: c, count: 28, spread: 0.5, up: 5.5, jitter: 5, life: [0.45, 1.1], size: [0.13, 0.05], sprite: ['ichor', 'dot4', 'dot3'], color: [0xc8ff5a, 0x9dff3a, 0x5aa82a], gravity: 16, ground: true });
            ctx.fx.poisonCloud(c, 4);
            ctx.sfx('poison_burst', c, 1);
            ctx.events.emit('groundMark', c.x, c.z, 4, 3);
            ctx.events.emit('explosion', c, 4.2, 26 * e.dmgMul, 'acid');
            const pd = this.player.center(_v2).distanceTo(_v.set(c.x, c.y, c.z));
            if (pd < 4.6) this.player.status.apply('poison', 6, 5, 2, 30, {});
            // what is left boils on the sand: a lingering acid pool that burns hunter and horde alike
            this.addHazard(c.x, c.z, 3.4, 7, 15 * e.dmgMul, e.id, true);
            const t = e.def.moveTitles?.burst;
            if (t) this.callout(t, { x: c.x, y: c.y + 1.4, z: c.z }, 'alpha');
          });
        }
        break;
    }
    if (this.wrapping === e) {
      this.wrapping = null;
      ctx.events.emit('snakeWrapEnd', e, true);
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
    // a bomber blowing itself up is not the hunter's kill
    if (!(e.state === 'strike' && e.atk?.kind === 'explode')) this.countKill();
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
    // a wrapped hunter kicks and claws at the coils: enough struggling breaks the hold
    if (this.wrapping && this.wrapping.state === 'wrap') {
      this.wrapStruggle++;
      this.wrapping.squash.kick(-3);
      ctx.sfx('punch', this.wrapping.pos, 0.6, 1.2);
      if (this.wrapStruggle >= 4) this.releaseWrap(this.wrapping, true, 0.6);
    }
    for (const e of targets) {
      if (!e.alive) continue;
      let ex = e.pos.x, ez = e.pos.z;
      if (e instanceof Enemy && e.bodyN) {
        this.bodyPoint(e, origin, _v2);
        ex = _v2.x;
        ez = _v2.z;
      }
      const dx = ex - origin.x, dz = ez - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.9 + e.radius || Math.abs(e.pos.y + e.height * 0.5 - origin.y) > 2.2) continue;
      if ((dx * f.x + dz * f.z) / (d || 1) < 0.2 && d > 1.2) continue;
      const en = e instanceof Enemy ? e : null;
      // the counter window: most of a melee / whip / pounce / charge wind-up, and a pounce or charge already in flight
      const k = en?.atk?.kind;
      const counter = !!en && ((en.state === 'windup' && (k === 'melee' || k === 'whip' || k === 'leap' || k === 'charge') && en.stateT > en.wind * 0.18) || en.state === 'leap' || en.state === 'charge');
      const hit: Hit = {
        base: counter ? 60 : 22,
        kind: 'phys',
        source: counter ? 'counter' : 'melee',
        knock: counter ? 14 : 7,
        dirX: dx / (d || 1),
        dirZ: dz / (d || 1),
        forceCrit: counter,
        status: counter ? [{ id: 'stun', stacks: 1, dur: 1.2 }, { id: 'armorBreak', stacks: 1, dur: 4 }] : [{ id: 'stun', stacks: 1, dur: 0.25, chance: 0.5 }],
      };
      const at = new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.6, e.pos.z);
      this.damage(e, hit, at, new THREE.Vector3(dx, 0, dz).normalize());
      if (counter && en) {
        countered = true;
        // a big counter can't be shrugged off: if it didn't go down, it reels
        if (en.alive && en.state !== 'down') this.stagger(en, 1.05);
        this.counterFx(at, dx / (d || 1), dz / (d || 1));
      } else {
        // a boot connecting: dust off the body, a little smear of grit
        ctx.particles.emit({ pos: at, count: 6, vel: { x: (dx / (d || 1)) * 4, y: 1.2, z: (dz / (d || 1)) * 4 }, spread: 2.5, life: [0.25, 0.5], size: [0.2, 0.5], sprite: ['puff0', 'puff1'], color: [0xe6cf9f, 0xd8b98a], alpha: 0.6, drag: 3, rot: 6 });
      }
      hits++;
    }
    if (countered) {
      ctx.toast('COUNTER!', '#ffd040');
      ctx.sfx('counter_clang', origin, 1);
      ctx.sfx('kick', origin, 1, 0.85);
      ctx.sfx('qte_perfect', null, 0.5);
      ctx.sfx('time_slow', null, 0.45);
      ctx.engine.hitStop(0.09, 0.02);
      ctx.engine.slowMo(0.15, 40);
      ctx.engine.tweens.after(0.5, () => ctx.engine.slowMo(1, 5), true);
      ctx.engine.flash(0xfff0c0, 0.3, 0.22);
      ctx.shake(0.45);
      ctx.events.emit('counter');
    } else if (hits > 0) {
      ctx.sfx('kick', origin, 0.9);
      ctx.sfx('punch', origin, 0.45, 1.1);
      ctx.engine.hitStop(0.06);
      ctx.shake(0.22);
    } else ctx.sfx('melee_whoosh', origin, 0.6);
  }

  /** the counter's impact: a ring of gold sparks blown out along the kick, grit and a flash */
  private counterFx(at: THREE.Vector3, dx: number, dz: number) {
    const P = this.ctx.particles;
    P.emit({ pos: at, count: 26, vel: { x: dx * 7, y: 1.5, z: dz * 7 }, spread: 9, life: [0.16, 0.4], size: [0.07, 0.015], sprite: 'spark', additive: true, color: [0xffe080, 0xfff6c0, 0xffb040], stretch: 0.035, gravity: 5 });
    P.emit({ pos: at, count: 5, spread: 3, life: [0.25, 0.45], size: [0.35, 0.05], sprite: 'star4', additive: true, color: [0xfff2c0, 0xffd36b], drag: 2 });
    P.emit({ pos: at, count: 1, life: [0.1, 0.12], size: [1.2, 2.2], sprite: 'glow32', additive: true, color: 0xfff0c0, alpha: 0.55 });
    P.emit({ pos: at, count: 10, vel: { x: dx * 6, y: 1, z: dz * 6 }, spread: 3, life: [0.35, 0.7], size: [0.3, 0.8], sprite: ['puff0', 'puff1'], color: [0xe6cf9f, 0xd8b98a], alpha: 0.6, drag: 3, rot: 6 });
    this.ctx.fx.light(at, 0xffd080, 5, 0.18, 8);
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
    this.now = time;
    this.organisePacks(ppos);
    // spatial grid for separation
    this.grid.clear();
    for (const e of this.list) {
      const k = Math.floor(e.pos.x / 3) * 100003 + Math.floor(e.pos.z / 3);
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(e);
    }
    // fairness bookkeeping: who is already swinging / aiming right now
    let bm = 0, br = 0;
    for (const e of this.list) {
      if (!e.alive || !e.atk || (e.state !== 'windup' && e.state !== 'strike')) continue;
      if (e.atk.kind === 'melee') bm++;
      else if (RANGED.has(e.atk.kind)) br++;
    }
    this.busyMelee = bm;
    this.busyRanged = br;
    const cq = ctx.camera.quaternion;
    _v.set(0, 0, -1).applyQuaternion(cq);
    const cfl = Math.hypot(_v.x, _v.z) || 1;
    this.camFX = _v.x / cfl;
    this.camFZ = _v.z / cfl;
    // multi-kill callouts settle a beat after the last kill
    if (this.mk.pending > 0) {
      this.mk.pending -= dt;
      if (this.mk.pending <= 0) this.announceMulti();
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
      e.poise = Math.max(0, e.poise - dt * 0.4);
      e.coughCd -= dt;
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
        if (e.status.has('poison')) {
          // the deeper the venom, the harder it froths
          const st = e.status.stacks('poison');
          if (rnd.chance(0.4 + Math.min(0.55, st * 0.03))) ctx.fx.bubbles({ x: e.pos.x, y: e.pos.y + e.height * 0.7, z: e.pos.z }, st >= 14 ? 3 : st >= 6 ? 2 : 1);
        }
        if (e.status.has('burn')) ctx.fx.flames({ x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z }, 1, e.scale);
      }
      // tint by status (subtle)
      const tr = e.sandForm ? [1.0, 0.8, 0.52] : e.status.has('poison') ? [0.82, 1.0, 0.78] : e.status.has('burn') ? [1, 0.8, 0.65] : e.status.has('curse') ? [0.9, 0.82, 1] : [1, 1, 1];
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
      if (pl.alive && e.state !== 'hidden' && e.state !== 'spawn' && e.state !== 'burrow' && e.state !== 'wrap') {
        const dx = e.pos.x - ppos.x, dz = e.pos.z - ppos.z;
        const d = e.bodyN ? this.bodyPoint(e, ppos, _v2) : Math.hypot(dx, dz);
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
    this.proj.speedMul = clamp(0.78 + this.wave * 0.022, 0.78, 1);
    this.proj.update(dt);
    this.updateHazards(dt);
    this.updateDying(dt, time);
    this.updateRag(dt);
    this.gore.update(dt);
    this.callouts.update(dt, ctx.camera, ctx.engine.height);
    // render
    this.render.begin();
    const cam = ctx.camera.position;
    const drawE = (e: Enemy) => {
      if (e.anim.hidden) return;
      const cd = cam.distanceTo(e.pos);
      const lod: 0 | 1 | 2 = cd > 58 ? 2 : cd > 26 ? 1 : 0;
      this.rootMatrix(e, _m);
      const fx: [number, number, number, number] = [e.flash * 0.85, 0, e.glow, 0];
      e.batch.push(_m, e.rot, e.hidden, lod, fx, e.tint, e.posOff);
      if (e.alive && (e.skel === 'snake' || e.skel === 'worm')) this.sampleBody(e);
    };
    for (const e of this.list) if (e.alive) drawE(e);
    for (const e of this.dying) drawE(e);
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
      } else if (r.life < 1.8) r.pos.y -= dt * 0.22; // sink into the sand before dissolving
    }
    // crowded field: hurry the oldest pieces into the sand instead of popping them
    if (this.rag.length > RAG_SOFT) for (let i = 0; i < this.rag.length - RAG_SOFT; i++) this.rag[i].life = Math.min(this.rag[i].life, 1.6);
    if (this.rag.length > RAG_HARD) this.rag.splice(0, this.rag.length - RAG_HARD);
  }

  // ------------------------------------------------------------- snake wrap
  /**
   * WRAP CONTRACT (bell snakes)
   *  - on wrap: `enemies.wrapping = snake`, event `snakeWrap` (snake). The coil squeezes every 0.55 s
   *    and pins the board; it lets go by itself after `wrapMaxT` seconds (event `snakeWrapEnd` (snake, false)).
   *  - QTE success: emit `snakeWrapBreak` (snake?, mult = 1) or call `releaseWrap(snake, true, mult)`:
   *    the snake is flung off, takes 12% of its max hp × mult and is stunned 1.2 s × mult (clamped 0.5–2).
   *  - QTE fail: emit `snakeWrapCrush` (snake?, mult = 1) or call `wrapCrush(snake, mult)`: one heavy squeeze
   *    (≈ 2.6 bites × mult), then it lets go.
   *  - always ends with `snakeWrapEnd` (snake, broke) — also when the snake dies mid-wrap (broke = true).
   *  - fallback without a QTE: each melee press while wrapped is a struggle; 4 of them break free (mult 0.6).
   */
  private startWrap(e: Enemy, time = this.now) {
    const ctx = this.ctx;
    e.state = 'wrap';
    e.stateT = 0;
    this.wrapping = e;
    this.wrapTick = 0.25;
    this.wrapStruggle = 0;
    e.anim.tauntT = -1;
    ctx.sfx('giant_scorpion_hiss', e.pos, 1, 0.8);
    ctx.sfx('skeleton_rattle', e.pos, 0.9, 1.5);
    ctx.shake(0.35);
    const title = e.def.moveTitles?.wrap ?? 'I Want to Hold Your Hand';
    this.skill(e, title, time, true);
    ctx.toast(title.toUpperCase(), '#c84a2a', 'Wrapped! Mash to break free');
    ctx.events.emit('snakeWrap', e);
  }

  /** end a wrap. broke = the hunter fought free (the snake is flung off, hurt by 12% max hp × mult and dazed) */
  releaseWrap(e: Enemy, broke: boolean, mult = 1) {
    if (this.wrapping === e) this.wrapping = null;
    if (e.state !== 'wrap') return;
    const ctx = this.ctx;
    const pp = this.player.pos;
    const dx = e.pos.x - pp.x, dz = e.pos.z - pp.z;
    const dl = Math.hypot(dx, dz) || 1;
    const m = clamp(mult, 0, 3);
    e.state = broke ? 'stagger' : 'recover';
    e.stateT = broke ? -0.5 : 0;
    e.vel.set((dx / dl) * (broke ? 9 : 4), broke ? 5 : 2, (dz / dl) * (broke ? 9 : 4));
    if (broke && e.alive) {
      ctx.toast(m >= 1.5 ? 'TORE FREE!' : 'BROKE FREE', '#ffd36b');
      ctx.sfx('punch', e.pos, 0.9);
      ctx.shake(0.25 + m * 0.1);
      if (m >= 1.5) ctx.engine.hitStop(0.08);
      this.damage(e, { base: e.maxHp * 0.12 * m, kind: 'phys', source: 'melee', knock: 10, dirX: dx / dl, dirZ: dz / dl, canCrit: false, status: m > 0 ? [{ id: 'stun', stacks: 1, dur: 1.2 * clamp(m, 0.5, 2) }] : undefined });
    }
    ctx.events.emit('snakeWrapEnd', e, broke);
  }

  /** QTE failed: the coil crushes once, hard, then the snake lets go */
  wrapCrush(e: Enemy, mult = 1) {
    if (e.state !== 'wrap') return;
    const ctx = this.ctx;
    const bite = e.def.attacks[1]?.dmg ?? 12;
    this.player.takeHit({ base: bite * 2.6 * e.dmgMul * clamp(mult, 0, 3), kind: 'phys', source: 'contact', knock: 7, status: [{ id: 'poison', stacks: 2, dur: 4 }] }, e.pos);
    ctx.sfx('hit_bone', e.pos, 1, 0.7);
    ctx.sfx('skeleton_rattle', e.pos, 1, 0.8);
    ctx.shake(0.55);
    e.squash.kick(-7);
    this.releaseWrap(e, false);
  }

  private updateWrap(e: Enemy, dt: number, ppos: THREE.Vector3) {
    const pl = this.player;
    if (!pl.alive || e.stateT > this.wrapMaxT || e.status.stunned()) {
      this.releaseWrap(e, false);
      return;
    }
    // orbit the coil around the hunter: the head sits one coil-radius out along its local +X
    e.yaw += dt * 0.9;
    const R = 0.42 * e.scale;
    e.pos.x = ppos.x + Math.cos(e.yaw) * R;
    e.pos.z = ppos.z - Math.sin(e.yaw) * R;
    e.pos.y = ppos.y;
    e.vel.set(0, 0, 0);
    // the squeeze: pinned in place, crushed over time
    pl.board.vel.multiplyScalar(Math.exp(-10 * dt));
    this.wrapTick -= dt;
    if (this.wrapTick <= 0) {
      this.wrapTick = 0.55;
      pl.takeHit({ base: (e.def.attacks[1]?.dmg ?? 12) * 0.45 * e.dmgMul, kind: 'phys', source: 'contact', knock: 0 }, e.pos);
      pl.status.apply('slow', 1, 0.6, 0, 1, {});
      this.ctx.sfx('hit_bone', e.pos, 0.35, 0.8);
      e.squash.kick(-2.5);
    }
  }

  // ------------------------------------------------------------- skills, sockets, hazards
  /**
   * A move was used: song-title callout above the enemy + event `enemySkill` ({ title, enemy, pos, tier }).
   * Busy packs are de-duplicated (same title nearby within 2.2 s); alphas always call it and ribbon-toast it.
   */
  skill(e: Enemy, title: string, time = this.now, force = false) {
    const ctx = this.ctx;
    const camD = ctx.camera.position.distanceTo(e.pos);
    const tier: 'normal' | 'elite' | 'alpha' = e.alpha ? 'alpha' : e.def.hp >= 120 ? 'elite' : 'normal';
    const pos = { x: e.pos.x, y: e.pos.y + e.height * e.scale * 0.5 + 0.35 + (e.skel === 'snake' ? 0.6 : 0), z: e.pos.z };
    ctx.events.emit('enemySkill', { title, enemy: e, pos, tier });
    if (camD > (tier === 'normal' ? 32 : 42) && !force) return;
    const prev = this.recentTitles.get(title);
    if (!force && tier === 'normal' && prev && time - prev.t < 2.4 && Math.hypot(prev.x - e.pos.x, prev.z - e.pos.z) < 14) return;
    if (!force && tier === 'normal' && (this.callouts.active >= 4 || time - this.lastCalloutT < 0.3)) return;
    this.lastCalloutT = time;
    this.recentTitles.set(title, { t: time, x: e.pos.x, z: e.pos.z });
    this.callout(title, pos, tier);
    if (this.skillToasts && e.alpha && time - this.lastTitleT > 2.6) {
      this.lastTitleT = time;
      ctx.toast(title.toUpperCase(), '#ff8a4a', e.name);
    }
  }

  /** show a song-title callout at a world point (bosses use this too: tier 'boss') */
  callout(title: string, pos: { x: number; y: number; z: number }, tier: 'normal' | 'elite' | 'alpha' | 'boss' = 'normal') {
    const col = tier === 'boss' ? '#ff5a3a' : tier === 'alpha' ? '#ff8a4a' : tier === 'elite' ? '#ffb070' : '#ffd36b';
    this.callouts.show(title.toUpperCase(), col, pos.x, pos.y, pos.z);
  }

  /** world position of a rig socket in the enemy's current pose */
  socketWorld(e: Enemy, name: string, out: THREE.Vector3): THREE.Vector3 | null {
    const s = e.batch.geo.sockets[name];
    if (!s) return null;
    const W = this.poseWorld(e);
    return out.copy(s.offset).applyMatrix4(W[s.part]);
  }

  /** thorny devil: twin squirts of blood from the corners of both eyes (acid blood for alphas) */
  private squirt(e: Enemy, a: AttackDef, dmg: number, target: THREE.Vector3) {
    const ctx = this.ctx;
    const n = a.count ?? 10;
    const per = Math.max(1, Math.ceil(n / 2));
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    const W = this.poseWorld(e);
    const socks = e.batch.geo.sockets;
    let i = 0;
    for (const side of [1, -1]) {
      const s = socks[side > 0 ? 'eye_tip_l' : 'eye_tip_r'];
      const from = new THREE.Vector3();
      if (s) from.copy(s.offset).applyMatrix4(W[s.part]);
      else from.set(e.pos.x + fx * e.radius + fz * 0.12 * side, e.pos.y + e.height * 0.85, e.pos.z + fz * e.radius - fx * 0.12 * side);
      this.proj.pattern('stream', from, target, { count: per, speed: a.speed, spread: 0.1 * side, dmg, proj: 'blood', status: a.status as any, sourceId: e.id, acid: e.alpha, delay: i * 0.03 });
      // the eye spurts: a fine red mist and fat droplets right at the socket
      ctx.particles.emit({ pos: from, count: 6, vel: { x: fx * 2.4, y: 1.3, z: fz * 2.4 }, spread: 1.2, life: [0.15, 0.45], size: [0.07, 0.03], sprite: ['dot3', 'blood0', 'blood1'], color: e.alpha ? [0xc81e1e, 0x9dff3a, 0xb8f05c] : [0xc81e1e, 0x9a1010, 0xe03a2a], gravity: 9, drag: 2 });
      i++;
    }
    ctx.sfx('gore_splat', e.pos, 0.55, 1.45);
    if (e.alpha) ctx.sfx('poison_burst', e.pos, 0.35, 1.4);
  }

  /** the rattle: dust shivers off the tail tip while a bell snake coils */
  private rattleDust(e: Enemy) {
    const p = this.socketWorld(e, 'rattle_tip', _v);
    if (!p) return;
    this.ctx.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: 2, spread: 1.4, up: 0.8, life: [0.2, 0.45], size: [0.05, 0.025], sprite: ['dot3', 'grain0'], color: [0xe0c08a, 0xc9a06a, 0xf0d6a2], gravity: 8, drag: 1.5, jitter: 0.12 });
  }

  /** a lingering pool of acid: damages the hunter standing in it (and enemies, if hurtsEnemies) */
  addHazard(x: number, z: number, r: number, dur: number, dps: number, owner = 0, hurtsEnemies = false) {
    if (this.hazards.length >= 24) this.hazards.shift();
    this.hazards.push({ x, z, r, t: 0, dur, dps, tick: 0.2, owner, hurtsEnemies });
    this.ctx.events.emit('groundMark', x, z, r, 3);
  }

  private updateHazards(dt: number) {
    const ctx = this.ctx;
    const pl = this.player;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.t += dt;
      if (h.t >= h.dur) {
        this.hazards.splice(i, 1);
        continue;
      }
      const fade = Math.min(1, (h.dur - h.t) / 0.8);
      // fizz: bubbles pop all over the surface, droplets spit, sickly fumes curl up
      if (rnd.chance(Math.min(1, dt * (5 + h.r * h.r * 3) * fade))) {
        const a = rnd.next() * Math.PI * 2, rr = Math.sqrt(rnd.next()) * h.r * 0.9;
        const x = h.x + Math.cos(a) * rr, z = h.z + Math.sin(a) * rr;
        const p = { x, y: ctx.world.groundAt(x, z) + 0.06, z };
        ctx.particles.emit({ pos: p, count: 1, spread: 0.15, up: 0.5, life: [0.3, 0.6], size: [0.07, 0.02], sprite: 'bubble', color: 0xffffff, gravity: -0.6 });
        if (rnd.chance(0.3)) ctx.particles.emit({ pos: p, count: 1, vel: { x: 0, y: 0.45, z: 0 }, spread: 0.2, life: [0.8, 1.5], size: [0.16, 0.6], sprite: ['puff0', 'puff1'], color: [0x9dcf4a, 0x7fae3a, 0xb8e070], alpha: 0.35, drag: 1.5, rot: 6, rotSpeed: 0.4 });
        if (rnd.chance(0.25)) ctx.particles.emit({ pos: p, count: 2, spread: 0.7, up: 1.3, life: [0.25, 0.5], size: [0.05, 0.02], sprite: 'dot3', color: [0xc8ff5a, 0x9dff3a, 0x6ec02a], gravity: 12, ground: true });
      }
      h.tick -= dt;
      if (h.tick > 0) continue;
      h.tick = 0.4;
      const gy = ctx.world.groundAt(h.x, h.z);
      if (pl.alive && Math.hypot(pl.pos.x - h.x, pl.pos.z - h.z) < h.r && pl.pos.y < gy + 1.3) {
        const dealt = pl.takeHit({ base: h.dps * 0.4, kind: 'magic', source: 'poison' }, new THREE.Vector3(h.x, gy, h.z));
        if (dealt > 0) pl.status.apply('poison', 1, 3, 2, 30, {});
        if (rnd.chance(0.5)) ctx.sfx('poison_tick', pl.pos, 0.5);
      }
      if (h.hurtsEnemies)
        for (const o of this.list) {
          if (!o.alive || o.id === h.owner || o.flying || o.state === 'burrow' || o.state === 'hidden') continue;
          if (Math.hypot(o.pos.x - h.x, o.pos.z - h.z) < h.r + o.radius * 0.5) this.damage(o, { base: h.dps * 0.24, kind: 'magic', source: 'poison', canCrit: false });
        }
    }
  }

  /** pack bookkeeping: evenly spaced flank slots + a couple of bite tokens for the closest ready wolves */
  private organisePacks(ppos: THREE.Vector3) {
    const wolves: Enemy[] = [];
    for (const e of this.list) if (e.alive && e.def.ai === 'pack' && e.state !== 'spawn' && !e.focus) wolves.push(e);
    if (!wolves.length) return;
    wolves.sort((a, b) => a.id - b.id);
    const n = wolves.length;
    wolves.forEach((w, i) => (w.slot = n === 1 ? 0.5 : i / (n - 1)));
    const tokens = n >= 5 ? 3 : 2;
    const busy = (w: Enemy) => w.state === 'windup' || w.state === 'strike' || w.state === 'leap';
    const ready = wolves.filter((w) => w.state === 'move' && Math.min(w.cds[0] ?? 9, w.cds[1] ?? 9) <= 0.15);
    ready.sort((a, b) => a.pos.distanceToSquared(ppos) - b.pos.distanceToSquared(ppos));
    for (const w of wolves) w.biteToken = false;
    // wolves already mid-attack keep theirs; the rest go to the nearest ready ones
    let used = 0;
    for (const w of wolves) if (busy(w)) {
      w.biteToken = true;
      used++;
    }
    for (const w of ready) {
      if (used >= tokens) break;
      if (w.biteToken) continue;
      w.biteToken = true;
      used++;
    }
    for (const e of this.list) if (e.def.ai === 'pack' && e.focus) e.biteToken = true;
  }

  // ------------------------------------------------------------- AI
  private think(e: Enemy, dt: number, time: number, hunter: THREE.Vector3) {
    const ctx = this.ctx;
    const d = e.def;
    // escort harassers go for their focus (an NPC) instead of the hunter
    if (e.focus && !e.focus.alive) e.focus = null;
    const foc = e.focus;
    const ppos = foc ? foc.pos : hunter;
    const pvel = foc ? ZERO : this.player.board.vel;
    const toX = ppos.x - e.pos.x, toZ = ppos.z - e.pos.z;
    const dist = Math.hypot(toX, toZ) || 1e-3;
    const buff = e.buffT > 0 ? 1.3 : 1;
    const stunned = e.status.stunned() || e.flipped > 0;
    let spd = d.speed * e.spdMul * e.status.slowMul() * buff * (e.hp < e.maxHp * 0.3 ? 0.8 : 1);
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
    // ---- knocked flat: tumble along the push, thud into the sand, lie there, get back up
    if (e.state === 'down') {
      e.vel.x *= Math.exp(-2.4 * dt);
      e.vel.z *= Math.exp(-2.4 * dt);
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      if (e.vel.y > 0 || e.pos.y > ground + 0.02) {
        e.vel.y -= 24 * dt;
        e.pos.y += e.vel.y * dt;
        if (e.pos.y <= ground) {
          e.pos.y = ground;
          if (e.vel.y < -2.5 && ctx.camera.position.distanceTo(e.pos) < 50) {
            const p = { x: e.pos.x, y: ground + 0.1, z: e.pos.z };
            ctx.fx.dust(p, 0.75 * e.scale, P.sand0, 4);
            ctx.fx.sandBurst(p, 0.55 * e.scale);
            ctx.sfx('board_land', p, 0.45, 0.72 + rnd.next() * 0.12);
            e.squash.kick(-5);
          }
          e.vel.y = 0;
        }
      } else e.pos.y = ground;
      // skidding on its back ploughs a furrow of sand
      const sk = Math.hypot(e.vel.x, e.vel.z);
      if (sk > 1.8 && e.pos.y <= ground + 0.05 && rnd.chance(dt * 24)) ctx.fx.sandSpray({ x: e.pos.x, y: ground + 0.05, z: e.pos.z }, { x: e.vel.x * 0.15, y: 0.6, z: e.vel.z * 0.15 }, 0.8);
      if (e.stateT > e.downDur + GETUP) {
        e.state = 'move';
        e.stateT = -0.35; // a breath before it can swing again
        e.vel.set(0, 0, 0);
      }
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
    // the hunter is down: everyone stops to gloat (the animation layer dances)
    if (!this.player.alive && e.state !== 'leap' && e.state !== 'dive' && e.state !== 'burrow' && e.state !== 'erupt') {
      if (e.state !== 'move') {
        e.state = 'move';
        e.stateT = 0;
        this.clearTelegraph(e);
      }
      this.move(e, 0, 0, dt, ground, dist < 25 ? face : e.yaw);
      return;
    }
    // ---- dune worms: tunnel under the sand, erupt beneath the prey
    if (e.state === 'burrow') {
      if (e.tremor > 0) {
        // the sand boils in a ring right before it bursts: last chance to swerve away
        e.tremor -= dt;
        e.vel.multiplyScalar(Math.exp(-10 * dt));
        e.pos.x += e.vel.x * dt;
        e.pos.z += e.vel.z * dt;
        const R = 1.2 + (0.55 - Math.max(0, e.tremor)) * 2.2;
        if (rnd.chance(dt * 30)) {
          const a = rnd.next() * Math.PI * 2;
          ctx.fx.sandSpray({ x: e.pos.x + Math.cos(a) * R, y: ground + 0.05, z: e.pos.z + Math.sin(a) * R }, { x: Math.cos(a) * 0.8, y: 1.6, z: Math.sin(a) * 0.8 }, 1.3);
        }
        if (rnd.chance(dt * 6)) ctx.events.emit('groundMark', e.pos.x, e.pos.z, R * 0.6, 1);
        if (e.tremor <= 0) {
          e.tremor = 0;
          e.state = 'erupt';
          e.stateT = 0;
          ctx.fx.sandBurst({ x: e.pos.x, y: ground, z: e.pos.z }, 1.6);
          ctx.sfx('sand_burst', e.pos, 0.9);
          if (dist < 9) ctx.shake(0.22);
          const t = d.moveTitles?.erupt;
          if (t) this.skill(e, t, time);
        }
        e.pos.y = ground;
        return;
      }
      if (e.stateT > 0.6) {
        const s = d.speed * 1.5 * e.spdMul;
        this.move(e, (toX / dist) * s, (toZ / dist) * s, dt, ground, face);
        if (rnd.chance(dt * 16)) ctx.fx.sandSpray({ x: e.pos.x, y: ground + 0.05, z: e.pos.z }, { x: -e.vel.x * 0.06, y: 0.9, z: -e.vel.z * 0.06 }, 1.1);
        if (rnd.chance(dt * 5)) ctx.events.emit('groundMark', e.pos.x, e.pos.z, 0.55, 1);
        if ((dist < 3.6 && e.stateT > 1.4) || e.stateT > 7) {
          e.tremor = 0.55;
          ctx.sfx('quake_rumble', e.pos, 0.55, 1.4);
          if (dist < 12) ctx.shake(0.1);
        }
      } else {
        e.vel.multiplyScalar(Math.exp(-5 * dt));
        if (rnd.chance(dt * 10)) ctx.fx.sandSpray({ x: e.pos.x, y: ground, z: e.pos.z }, { x: 0, y: 1.4, z: 0 }, 1.4);
      }
      e.pos.y = ground;
      return;
    }
    if (e.state === 'erupt') {
      e.vel.multiplyScalar(Math.exp(-6 * dt));
      e.yaw = dampAngle(e.yaw, face, 6, dt);
      e.pos.y = ground;
      if (e.stateT >= 0.3 && e.stateT - dt < 0.3) {
        ctx.fx.sandBurst({ x: e.pos.x, y: ground, z: e.pos.z }, 1.2);
        const hd = Math.hypot(hunter.x - e.pos.x, hunter.z - e.pos.z);
        if (hd < 2.8 + e.radius && Math.abs(hunter.y - e.pos.y) < 2.5) {
          const dealt = this.player.takeHit({ base: (d.attacks[0]?.dmg ?? 14) * e.dmgMul * 1.25, kind: 'phys', source: 'contact', knock: 9, status: [{ id: 'bleed', stacks: 2, dur: 3 }] }, e.pos);
          if (dealt > 0) this.player.board.impulse.y += 6;
        }
        if (foc && Math.hypot(foc.pos.x - e.pos.x, foc.pos.z - e.pos.z) < 2.8 + e.radius + foc.radius) foc.hurt((d.attacks[0]?.dmg ?? 14) * e.dmgMul * 1.25, e.pos, 'contact');
        if (e.alpha) this.proj.pattern('ring', _v.set(e.pos.x, ground + 0.8, e.pos.z), hunter, { count: 14, speed: 10, dmg: 6 * e.dmgMul, proj: 'sand', sourceId: e.id });
      }
      if (e.stateT > 0.9) {
        e.state = 'move';
        e.stateT = 0;
        e.burrowT = 0;
      }
      return;
    }
    // ---- bell snake: coiled around the hunter, squeezing
    if (e.state === 'wrap') {
      this.updateWrap(e, dt, ppos);
      return;
    }
    // ---- attacks in progress
    if (e.state === 'windup' && e.atk) {
      const a = e.atk;
      const W = e.wind;
      if (d.ai === 'constrictor' && Math.floor(e.stateT / 0.2) !== Math.floor((e.stateT - dt) / 0.2)) ctx.sfx('skeleton_rattle', e.pos, 0.55, 1.7 + rnd.next() * 0.2);
      e.glow = clamp(e.stateT / W, 0, 1) * 1.5;
      e.yaw = dampAngle(e.yaw, face, a.kind === 'snipe' ? 6 : 10, dt);
      e.vel.multiplyScalar(Math.exp(-8 * dt));
      if (a.kind === 'snipe') this.drawLaser(e, ppos, e.stateT / W);
      if (a.kind === 'explode') e.flash = Math.sin(e.stateT * 40) > 0 ? 0.8 : 0;
      if (d.ai === 'constrictor' && rnd.chance(dt * 18)) this.rattleDust(e);
      this.telegraphFx(e, a, W, ppos, pvel, dt);
      if (e.stateT >= W * (a.kind === 'melee' ? 1 / buff : 1)) this.strike(e, a, ppos, dist);
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
      const T = e.state === 'leap' ? e.leapDur : 1.1;
      const k = clamp(e.stateT / T, 0, 1);
      e.pos.lerpVectors(e.leapFrom, e.leapTo, k);
      const arcH = d.ai === 'leaper' ? 4.5 : d.ai === 'constrictor' ? 1.5 : 1.8;
      e.pos.y = (e.state === 'leap' ? Math.max(ground, e.leapFrom.y + (e.leapTo.y - e.leapFrom.y) * k) + Math.sin(k * Math.PI) * arcH : e.leapFrom.y + (e.leapTo.y - e.leapFrom.y) * k + Math.sin(k * Math.PI) * -1.5);
      if (k >= 1) {
        e.state = 'recover';
        e.stateT = 0;
        e.squash.kick(-9);
        const p = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
        if (e.state === 'recover' && (d.ai === 'leaper' || d.ai === 'pack')) {
          ctx.fx.sandBurst(p, 1);
          ctx.sfx('board_land', p, 0.6);
          if (this.player.pos.distanceTo(e.pos) < 3.2) this.player.takeHit({ base: (e.atk?.dmg ?? 15) * e.dmgMul, kind: 'phys', source: 'contact', knock: 8, status: [{ id: 'bleed', stacks: 2, dur: 3 }] }, e.pos);
        }
        if (e.state === 'recover' && d.ai === 'constrictor') {
          ctx.fx.sandBurst(p, 1.1);
          ctx.shake(Math.max(0, 0.3 - this.player.pos.distanceTo(e.pos) * 0.02));
          const pd = this.player.pos.distanceTo(e.pos);
          if (pd < 2.6 && this.player.alive && !this.wrapping && !foc) this.startWrap(e, time);
          else if (pd < 3.2) this.player.takeHit({ base: (e.atk?.dmg ?? 15) * e.dmgMul, kind: 'phys', source: 'contact', knock: 6, status: [{ id: 'poison', stacks: 3, dur: 4 }] }, e.pos);
        }
        if (e.state === 'recover' && foc && foc.pos.distanceTo(e.pos) < 2.4 + foc.radius) foc.hurt((e.atk?.dmg ?? 15) * e.dmgMul, e.pos, 'leap');
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
        const tx = ppos.x + pvel.x * lead + (d.ai === 'swarm' ? Math.cos(time * 2 + e.targetOff) * 2 : 0);
        const tz = ppos.z + pvel.z * lead + (d.ai === 'swarm' ? Math.sin(time * 2 + e.targetOff) * 2 : 0);
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
      case 'pack': {
        // flank: the pack spreads over the rear arc of where the prey is heading (evenly spaced
        // slots), circles at a distance, and only the wolves holding a bite token dart in
        const pv = pvel;
        const pvl = Math.hypot(pv.x, pv.z);
        const heading = pvl > 2 ? Math.atan2(pv.x, pv.z) : Math.atan2(-toX, -toZ);
        const slot = (e.slot - 0.5) * 2.6;
        const ang = heading + Math.PI + slot + Math.sin(time * 0.6 + e.quirk * 7) * 0.25;
        const biteReady = e.cds[0] <= 0 && e.biteToken;
        const R = biteReady ? 1.5 : 7 + Math.sin(time * 0.9 + e.quirk * 5) * 1.5;
        const tx = ppos.x + Math.sin(ang) * R + pv.x * 0.35, tz = ppos.z + Math.cos(ang) * R + pv.z * 0.35;
        const dx = tx - e.pos.x, dz = tz - e.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        const sprint = l > 12 ? 1.25 : 1;
        const ease = clamp(l / 2, 0.3, 1);
        wantX = (dx / l) * spd * sprint * ease;
        wantZ = (dz / l) * spd * sprint * ease;
        face = l > 1.5 ? Math.atan2(wantX, wantZ) : Math.atan2(toX, toZ);
        if (rnd.chance(dt * 0.05)) ctx.sfx('jackal_growl', e.pos, 0.35, 1.25);
        break;
      }
      case 'burrower': {
        // surfaced: weave around the prey, then dive and tunnel again
        e.burrowT += dt;
        const ux = toX / dist, uz = toZ / dist;
        const want = dist > 9 ? 1 : dist < 4 ? -0.4 : 0.15;
        wantX = (ux * want - uz * 0.5 * e.orbitDir) * spd * 0.6;
        wantZ = (uz * want + ux * 0.5 * e.orbitDir) * spd * 0.6;
        face = Math.atan2(toX, toZ);
        if (e.burrowT > 4.5 + e.quirk * 2.5 && e.state === 'move') {
          e.state = 'burrow';
          e.stateT = 0;
          ctx.sfx('sand_rise', e.pos, 0.7);
          ctx.fx.sandBurst({ x: e.pos.x, y: ground, z: e.pos.z }, 1);
          return;
        }
        break;
      }
      case 'skitter': {
        // stop-and-go darts around a preferred range (lizard freeze, then a burst)
        const cyc = (time * 1.1 + e.quirk * 7) % 1;
        const dash = cyc < 0.38;
        const ux = toX / dist, uz = toZ / dist;
        const radial = clamp((dist - 7) / 7, -1, 1);
        const dx = ux * radial - uz * e.orbitDir * 0.9, dz = uz * radial + ux * e.orbitDir * 0.9;
        const l = Math.hypot(dx, dz) || 1;
        const s2 = dash ? spd * 2.1 : 0;
        wantX = (dx / l) * s2;
        wantZ = (dz / l) * s2;
        face = dash ? Math.atan2(wantX, wantZ) : Math.atan2(toX, toZ);
        if (rnd.chance(dt * 0.3)) e.orbitDir *= -1;
        break;
      }
      case 'constrictor': {
        // slither in a wide S toward strike range
        const ux = toX / dist, uz = toZ / dist;
        const radial = clamp((dist - 5.5) / 4, -0.6, 1);
        const weave = Math.sin(time * 1.3 + e.quirk * 9) * 0.6;
        wantX = (ux * radial - uz * weave) * spd;
        wantZ = (uz * radial + ux * weave) * spd;
        face = dist < 8 ? Math.atan2(toX, toZ) : Math.atan2(wantX, wantZ);
        if (rnd.chance(dt * 0.08)) ctx.sfx('skeleton_rattle', e.pos, 0.3, 1.8);
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
        // the pack takes turns: only token holders commit to a bite or a pounce
        if (d.ai === 'pack' && a.kind !== 'howl' && !e.biteToken) continue;
        if (foc && a.kind === 'leap' && d.ai === 'constrictor') continue; // snakes only coil around the hunter
        if (a.kind !== 'melee' && a.kind !== 'explode' && a.kind !== 'aura' && a.kind !== 'music' && a.kind !== 'howl' && !this.lineOfSight(e, ppos)) continue;
        // fairness: only so many swings / shots wind up at once, and nobody fires the moment it arrives
        const ranged = RANGED.has(a.kind);
        if (!foc && a.kind === 'melee' && this.busyMelee >= Math.min(6, 2 + Math.floor(this.wave / 7))) continue;
        if (!foc && ranged && (this.busyRanged >= Math.min(9, 3 + Math.floor(this.wave / 5)) || e.life < 1.3)) continue;
        if (a.kind === 'melee') this.busyMelee++;
        else if (ranged) this.busyRanged++;
        // wind-up: early waves telegraph a little longer while the tells are learned; shots, pounces and
        // charges from outside the view wind up longer still (the glint / click / marker give time to react)
        let W = a.windup * (1 + Math.max(0, 6 - this.wave) * 0.04);
        if (ranged || a.kind === 'leap' || a.kind === 'charge') {
          const cx = e.pos.x - ctx.camera.position.x, cz = e.pos.z - ctx.camera.position.z;
          if ((cx * this.camFX + cz * this.camFZ) / (Math.hypot(cx, cz) || 1) < 0.55) W *= 1.4;
        }
        e.wind = W;
        e.glinted = false;
        e.cds[k] = a.cooldown * (0.85 + rnd.next() * 0.3);
        e.atk = a;
        e.state = 'windup';
        e.stateT = 0;
        if (a.title) this.skill(e, a.title, time);
        if (d.ai === 'constrictor' && a.kind === 'leap') {
          // the rattle: a red warning ring where it means to land, dust shaking off the tail
          const gy = ctx.world.groundAt(ppos.x, ppos.z);
          ctx.fx.ring({ x: ppos.x + pvel.x * 0.4, y: gy + 0.15, z: ppos.z + pvel.z * 0.4 }, 0xff4a2a, 5.5, W);
          ctx.sfx('giant_scorpion_hiss', e.pos, 0.55, 1.5);
        }
        e.squash.kick(a.kind === 'melee' ? 5 : 3);
        if (a.kind === 'melee' || a.kind === 'explode' || a.kind === 'charge' || a.kind === 'leap') {
          ctx.particles.emit({ pos: { x: e.pos.x, y: e.pos.y + e.height + 0.45, z: e.pos.z }, count: 1, vel: { x: 0, y: 0.8, z: 0 }, life: [W, W], size: [0.5, 0.5], sprite: 'dg_!', color: a.kind === 'explode' ? 0xff4020 : 0xffd040, screen: true, sizeJitter: 0 });
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
    const accel = e.def.ai === 'rider' ? 3 : e.def.ai === 'tank' ? 4 : e.def.ai === 'skitter' ? 20 : 8;
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
    const foc = e.focus;
    e.state = 'strike';
    e.stateT = 0;
    e.glow = 0;
    this.clearTelegraph(e);
    const dmg = a.dmg * e.dmgMul * (e.buffT > 0 ? 1.2 : 1);
    const from = new THREE.Vector3(e.pos.x + Math.sin(e.yaw) * e.radius, e.pos.y + e.height * 0.7, e.pos.z + Math.cos(e.yaw) * e.radius);
    // snakes and worms spit from the mouth
    if ((e.skel === 'snake' || e.skel === 'worm') && e.batch.geo.sockets['mouth']) this.socketWorld(e, 'mouth', from);
    const target = foc ? new THREE.Vector3(foc.pos.x, foc.pos.y + foc.height * 0.6, foc.pos.z) : this.player.center(new THREE.Vector3());
    const pvel = foc ? ZERO : this.player.board.vel;
    // alpha thorny devils and alpha bell snakes carry acid in everything they throw
    const acid = e.alpha && (e.def.id === 'thornyLizard' || e.def.id === 'bellSnake');
    e.squash.kick(-6);
    switch (a.kind) {
      case 'melee':
        ctx.sfx('melee_whoosh', e.pos, 0.6);
        if (foc) {
          if (dist < a.range + 0.7 + foc.radius) foc.hurt(dmg, e.pos, 'melee');
        } else if (dist < a.range + 0.7 && Math.abs(ppos.y - e.pos.y) < 2) {
          const dealt = this.player.takeHit({ base: dmg, kind: 'phys', source: 'contact', knock: 5, status: a.status as any }, e.pos);
          if (dealt > 0 && rnd.chance(0.3)) {
            e.anim.tauntT = 0;
            e.anim.tauntKind = rnd.chance(0.5) ? 2 : 0;
          }
        }
        if (acid) {
          // the bite sprays acid in a short fan in front of the jaws
          const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
          const bx = e.pos.x + fx * (e.radius + 0.7), bz = e.pos.z + fz * (e.radius + 0.7);
          this.proj.acidSplash(bx, ctx.world.groundAt(bx, bz) + 0.1, bz, dmg * 0.8, false, e.id);
        }
        break;
      case 'burst':
      case 'fan':
      case 'ring':
      case 'spiral':
      case 'volley':
      case 'lob':
      case 'snipe':
      case 'stream':
        if (a.kind === 'stream' && e.skel === 'lizard') {
          this.squirt(e, a, dmg, target);
          break;
        }
        if (a.kind === 'stream') ctx.sfx('gore_splat', from, 0.5, 1.4);
        this.proj.pattern(a.kind, from, target, { count: a.count, spread: a.spread, speed: a.speed, dmg, proj: a.proj, status: a.status as any, sourceId: e.id, acid });
        if (e.skel === 'snake' && a.kind === 'lob') ctx.sfx('giant_scorpion_hiss', from, 0.7, 1.35);
        if (a.kind !== 'stream') ctx.fx.muzzle(from, { x: Math.sin(e.yaw), y: 0, z: Math.cos(e.yaw) }, 0xffd090);
        if (a.kind !== 'stream') ctx.sfx(a.proj === 'bullet' ? (a.kind === 'fan' && (a.count ?? 1) > 6 ? 'shotgun_shot' : a.kind === 'snipe' ? 'rifle_shot' : 'enemy_shot') : a.proj === 'arrow' ? 'whoosh' : 'whoosh', from, 0.7);
        break;
      case 'leap':
        e.state = 'leap';
        e.leapDur = e.def.ai === 'constrictor' ? 0.6 : 0.75;
        e.leapFrom.copy(e.pos);
        e.leapTo.set(ppos.x + pvel.x * 0.4, 0, ppos.z + pvel.z * 0.4);
        e.leapTo.y = ctx.world.groundAt(e.leapTo.x, e.leapTo.z);
        ctx.sfx(e.def.ai === 'constrictor' ? 'giant_scorpion_hiss' : 'jackal_attack', e.pos, 0.8, e.def.ai === 'constrictor' ? 1.3 : 1);
        if (e.def.ai === 'constrictor') ctx.sfx('whoosh_big', e.pos, 0.7, 1.2);
        break;
      case 'howl': {
        // the alpha throws its head back: the pack answers, faster and hungrier, and pounces at once
        ctx.sfx('jackal_howl', e.pos, 1, 0.82);
        ctx.fx.dust({ x: e.pos.x, y: e.pos.y + 0.3, z: e.pos.z }, 1.2, P.sand0, 4);
        ctx.shake(0.1);
        e.buffT = Math.max(e.buffT, 5);
        let answered = 0;
        for (const o of this.list) {
          if (o === e || !o.alive || o.def.ai !== 'pack' || o.pos.distanceTo(e.pos) > (a.radius ?? 20)) continue;
          o.buffT = Math.max(o.buffT, 5);
          for (let k = 0; k < o.cds.length; k++) o.cds[k] = Math.min(o.cds[k], 0.4 + rnd.next() * 0.8);
          if (answered++ < 3) ctx.engine.tweens.after(0.25 + rnd.next() * 0.6, () => o.alive && ctx.sfx('jackal_howl', o.pos, 0.5, 1.05 + rnd.next() * 0.2));
        }
        break;
      }
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
  private animEnv: AnimEnv = {
    time: 0,
    dt: 0,
    groundAt: () => 0,
    player: { x: 0, y: 0, z: 0 },
    playerAlive: true,
    camDist: 0,
    fx: {
      step: (x, y, z, size, kick, dirX, dirZ) => {
        const P = this.ctx.particles;
        P.emit({ pos: { x, y: y + 0.05, z }, count: kick > 0.6 ? 3 : 2, spread: 0.35 * size, up: 0.35 + kick * 0.4, life: [0.35, 0.75], size: [0.22 * size, 0.36 * size], sprite: ['puff0', 'puff1'], color: [0xe6cf9f, 0xd8b98a, 0xc9a77a], alpha: 0.6, drag: 2.6, rot: 3, rotSpeed: 0.5 });
        if (kick > 0.15)
          P.emit({ pos: { x, y: y + 0.08, z }, count: Math.ceil(2 + kick * 4), vel: { x: dirX * 2.4 * kick, y: 1.3 + kick * 0.8, z: dirZ * 2.4 * kick }, spread: 0.5, life: [0.3, 0.65], size: [0.06, 0.035], sprite: ['dot3', 'dot4'], color: [0xe0c08a, 0xc9a06a, 0xf0d6a2], gravity: 13, ground: true, jitter: 0.8 });
      },
      burst: (x, y, z, kind, power) => {
        const P = this.ctx.particles;
        const pos = { x, y, z };
        if (kind === 'sand') {
          P.emit({ pos, count: Math.round(6 * power), spread: 0.8, up: 0.9, life: [0.5, 1.1], size: [0.35, 0.6], sprite: ['puff0', 'puff1'], color: [0xe6cf9f, 0xd8b98a], alpha: 0.65, drag: 2.2, rot: 3, rotSpeed: 0.4 });
          P.emit({ pos, count: Math.round(10 * power), spread: 0.9, up: 3, life: [0.4, 0.8], size: [0.06, 0.035], sprite: ['dot3', 'dot4'], color: [0xe0c08a, 0xc9a06a], gravity: 13, ground: true, jitter: 1.2 });
        } else {
          const col = kind === 'chitin' ? [0x2a2018, 0x3e3226, 0x5a4630, 0x1c1610] : kind === 'bone' ? [0xf2dcb4, 0xd6b78a, 0xfff1d6] : kind === 'fur' ? [0xc9a06a, 0xa8804a, 0xe0c08a] : [0x9a1010, 0x6e0a0a, 0xc02020];
          P.emit({ pos, count: Math.round(12 * power), spread: 0.7, up: kind === 'fur' ? 1.5 : 3.2, life: [0.5, 1.1], size: kind === 'fur' ? [0.09, 0.05] : [0.08, 0.045], sprite: kind === 'chitin' || kind === 'bone' ? ['twig', 'dot3'] : ['dot3', 'dot4'], color: col, gravity: kind === 'fur' ? 3 : 14, ground: true, drag: kind === 'fur' ? 2 : 0.5, jitter: 1 });
        }
      },
    },
  };
  private animate(e: Enemy, dt: number, time: number) {
    const env = this.animEnv;
    env.time = time;
    env.dt = dt;
    env.groundAt = this.ctx.world.groundAt;
    const pp = this.player.pos;
    env.player.x = pp.x;
    env.player.y = pp.y;
    env.player.z = pp.z;
    env.playerAlive = this.player.alive;
    env.camDist = this.ctx.camera.position.distanceTo(e.pos);
    animateEnemy(e, env);
  }

  /** root transform of an enemy (yaw, flip, death tilt/roll, squash, sinks) */
  private rootMatrix(e: Enemy, out: THREE.Matrix4) {
    const a = e.anim;
    const sq = e.squash.x;
    _q.setFromAxisAngle(UP, e.yaw);
    const flip = e.flipped > 0 && !a.dying ? Math.PI : 0;
    if (flip) _q.multiply(_qa.setFromAxisAngle(AZ, flip));
    if (a.tilt) _q.multiply(_qa.setFromAxisAngle(AX, a.tilt));
    if (a.roll) _q.multiply(_qa.setFromAxisAngle(AZ, a.roll));
    const spawnSink = e.state === 'spawn' && e.emerge === 'sand' ? (1 - clamp(e.stateT / 1.1, 0, 1)) * e.height : 0;
    _s.set(e.scale * (2 - sq) ** 0.5, e.scale * sq, e.scale * (2 - sq) ** 0.5).multiplyScalar(1 + a.puff * 0.24);
    out.compose(_v.set(e.pos.x, e.pos.y - spawnSink - a.sink + a.lift + (flip ? e.height * 0.4 : 0), e.pos.z), _q, _s);
    return out;
  }

  /** world matrices of every part for this enemy's current pose (ragdoll seeding) */
  private poseWorld(e: Enemy): THREE.Matrix4[] {
    const parts = e.batch.geo.parts;
    while (this.fk.length < parts.length) this.fk.push(new THREE.Matrix4());
    const W = this.fk;
    this.rootMatrix(e, _root);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      _eul.set(p.rest.x + e.rot[i * 3], p.rest.y + e.rot[i * 3 + 1], p.rest.z + e.rot[i * 3 + 2]);
      _qa.setFromEuler(_eul);
      _lv.set(p.offset.x + e.posOff[i * 3], p.offset.y + e.posOff[i * 3 + 1], p.offset.z + e.posOff[i * 3 + 2]);
      _loc.compose(_lv, _qa, _one);
      W[i].multiplyMatrices(p.parent >= 0 ? W[p.parent] : _root, _loc);
    }
    return W;
  }
  private fk: THREE.Matrix4[] = [];

  /** advance procedural death collapses; hand over to the ragdoll when they finish */
  private updateDying(dt: number, time: number) {
    const ctx = this.ctx;
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const e = this.dying[i];
      const a = e.anim;
      const g = ctx.world.groundAt(e.pos.x, e.pos.z);
      // corpses keep their momentum briefly and fall out of the sky
      e.vel.x *= Math.exp(-4 * dt);
      e.vel.z *= Math.exp(-4 * dt);
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      if (e.pos.y > g + 0.01 || e.vel.y > 0) {
        e.vel.y -= 22 * dt;
        e.pos.y += e.vel.y * dt;
        if (e.pos.y <= g) {
          e.pos.y = g;
          e.vel.y = 0;
        }
      } else e.pos.y = g;
      this.animate(e, dt, time);
      if (a.impact) {
        a.impact = false;
        const p = { x: e.pos.x, y: g + 0.1, z: e.pos.z };
        ctx.fx.dust(p, 0.7 * e.scale, P.sand0, 4);
        ctx.sfx('board_land', p, 0.35, 0.7 + rnd.next() * 0.2);
      }
      if (a.dT >= a.dDur) {
        const W = this.poseWorld(e);
        e.batch.geo.parts.forEach((pp, j) => {
          if (e.hidden[j]) return;
          this.spawnPiece(e, j, (rnd.next() - 0.5) * 1.4, 0.4 + rnd.next() * 1.2 + (pp.name === 'head' ? 1 : 0), (rnd.next() - 0.5) * 1.4, W);
        });
        this.dying.splice(i, 1);
      }
    }
  }

  clear() {
    for (const e of this.list) this.clearTelegraph(e);
    this.list.length = 0;
    this.dying.length = 0;
    this.wrapping = null;
    this.rag.length = 0;
    this.gore.clear();
    this.hazards.length = 0;
    this.callouts.clear();
    this.proj.clear();
  }
}
