// DEATH, in two halves.
//
// 1. IN PLACE (every death, played by SoulReaping in the run's own world): `pickKiller` finds what
//    laid him out (bosses first) and `Ragdoll` throws his real body off the board in slow motion:
//    a rigid body with contact points, bounce and friction on the live terrain, and limp, lagging
//    joints that flail in the air and flop on every impact; the hat tumbles away on its own.
//    The camera orbits the body while the killer stands framed behind it, then the soul leaves.
//
// 2. THE WAY HOME (a lost ride: the heart was too heavy, or would not balance): this scene.
//      a. the soul, a jade spectre of him, streaks low over the dunes, the camera chasing it;
//      b. the time-lapse: the sun arcs and sets, the stars wheel, the soul drifts on across the
//         sand toward a far window, and a floating "N DAYS PASSED..." counts the sunrises;
//      c. the hideout: the soul slips in at the lamp-lit window, a warm bloom, and he wakes on
//         Mama Toad's couch (HubScene's wake: she nursed him, and she remembers; meta/ToadMemory).
//    Space / Enter / Esc / click skips straight to the hideout.
import { say3D } from '../fx/WorldSpeech';
import * as THREE from 'three';
import type { Engine, GameScene } from '../../engine/Engine';
import { Env, EnvPreset, PRESETS } from '../world/Env';
import { ATMO, ATMO_HAZE_GLSL, globalUniforms, sharedVoxelMaterial, makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { Noise, hash3 } from '../../engine/math/rand';
import { Particles } from '../fx/Particles';
import { modelEntry } from '../models/lookup';
import type { EnemyDef } from '../enemies/EnemyDefs';
import { HubScene } from './HubScene';
import { nav } from '../Nav';
import { loadSave } from '../meta/Save';
import { DEATH_LORE } from '../meta/Lore';
import { toadMemory } from '../meta/ToadMemory';
import { spiritMaterial, soulShellGeos, type SpiritMat } from './AnubisTrial';
import type { PosterData, RunResult } from './ResultsScene';

export interface DeathCineKiller {
  name: string;
  def?: EnemyDef;
  rigKey?: string;
  alpha?: boolean;
  /** bosses: their rig */
  spec?: RigSpec;
  scale?: number;
}

export interface DeathCineOpts {
  hero: RigSpec | null;
  gun: RigSpec | null;
  board: THREE.BufferGeometry | null;
  killer: DeathCineKiller | null;
  area: 'A' | 'B' | 'C';
  seed: number;
  /** sunrises until he wakes up at home */
  days: number;
  result: PosterData;
}

// ======================================================================= the killer
/** what laid him out: the live enemy (its position keeps moving), its name, boss or not, its height */
export interface KillerInfo {
  enemy: any;
  pos: THREE.Vector3;
  name: string;
  boss: boolean;
  height: number;
  at: number;
}
let lastPick: KillerInfo | null = null;

/** the nearest attacker (bosses and enemies mid-attack first); remembered for the way home */
export function pickKiller(run: any): KillerInfo | null {
  const pos: THREE.Vector3 = run.player?.pos ?? new THREE.Vector3();
  let best: any = null, bs = Infinity;
  for (const e of (run.enemies?.list ?? []) as any[]) {
    if (!e?.alive || !e.pos) continue;
    const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
    if (d > 32) continue;
    const busy = e.state === 'strike' || e.state === 'recover' || e.state === 'windup' || e.state === 'leap' || e.state === 'charge';
    const s = d - (e.isBoss ? 18 : 0) - (busy ? 6 : 0);
    if (s < bs) {
      bs = s;
      best = e;
    }
  }
  if (!best) return (lastPick = null);
  const sc = best.scale ?? best.def?.scale ?? 1;
  const height = Math.max(1.2, Math.min(9, (best.height ?? best.def?.height ?? (best.isBoss ? 3.6 : 1.8)) * (best.def?.height ? sc : 1)));
  lastPick = { enemy: best, pos: best.pos, name: String(best.name ?? best.def?.name ?? 'the desert'), boss: !!best.isBoss, height, at: performance.now() };
  return lastPick;
}

/** the ride's day (the days system), when it reports one */
function dayOf(run: any): number | null {
  const d = run?.run?.day ?? run?.days?.day ?? run?.day ?? run?.dayCycle?.day ?? null;
  return typeof d === 'number' && d > 0 ? Math.floor(d) : null;
}

/**
 * Gather what the way home needs from a run (duck-typed RunScene): the hunter's rig, gun and board,
 * and his killer (the one picked at the moment of death, else the nearest attacker). Mama Toad
 * writes the death down here (meta/ToadMemory).
 */
export function deathCineFromRun(run: any, result: RunResult): DeathCineOpts {
  const p = run.player;
  const pk = lastPick && performance.now() - lastPick.at < 240000 ? lastPick : pickKiller(run);
  const best = pk?.enemy;
  let killer: DeathCineKiller | null = null;
  if (best?.def) killer = { name: pk!.name, def: best.def, rigKey: best.rigKey, alpha: !!best.alpha };
  else if (best?.rig?.geo?.spec) killer = { name: pk!.name, spec: best.rig.geo.spec, scale: best.scale ?? 1 };
  const r = result.run;
  const seed = ((run.opts?.seed ?? 1) * 131 + r.kills * 7 + r.wave * 13) >>> 0;
  const days = 2 + (seed % 5);
  try {
    toadMemory.recordDeath({ killer: pk?.name ?? null, boss: !!pk?.boss, wave: r.wave, day: dayOf(run), kills: r.kills, deaths: (r as any).deaths ?? 1, nights: days });
  } catch (e) {
    console.warn('[death] toad memory', e);
  }
  lastPick = null;
  return {
    hero: p?.rig?.geo?.spec ?? result.hero ?? null,
    gun: p?.gun?.geo?.spec ?? null,
    board: p?.boardMesh?.geometry ?? null,
    killer,
    area: run.opts?.area ?? 'A',
    seed,
    days,
    result: { run: { ...r }, won: false, bosses: [...result.bosses], hero: result.hero ?? p?.rig?.geo?.spec ?? null, banked: result.banked },
  };
}

// ======================================================================= the ragdoll
type J3 = [number, number, number];
/** thrown: arms flung up and out, back arched, head snapped back */
const FLY: Record<string, J3> = { arm_r: [-2.4, 0, -0.8], fore_r: [-0.4, 0, 0], arm_l: [-1.6, 0, 1.1], fore_l: [-0.8, 0, 0], torso: [-0.45, 0.2, 0.05], head: [-0.7, -0.2, 0.1], jaw: [0.4, 0, 0], thigh_l: [-0.5, 0, 0.12], shin_l: [0.7, 0, 0], thigh_r: [0.3, 0, -0.1], shin_r: [0.3, 0, 0] };
/** gone limp on his back in the sand */
const LIMP: Record<string, J3> = { arm_r: [-2.75, 0, -0.45], fore_r: [-0.35, 0, 0], arm_l: [-0.35, 0, 1.3], fore_l: [-0.55, 0, 0], torso: [-0.08, 0.1, 0.05], head: [-0.12, 0.72, 0.12], jaw: [0.42, 0, 0], thigh_l: [-0.95, 0, 0.28], shin_l: [1.35, 0, 0], thigh_r: [-0.22, 0, -0.16], shin_r: [0.42, 0, 0] };
const UP = new THREE.Vector3(0, 1, 0);

interface Joint {
  node: THREE.Object3D;
  rest: THREE.Euler;
  name: string;
  /** offset angles (x, z) and their velocities; a soft spring toward the pose, lagging behind the body */
  o: THREE.Vector2;
  w: THREE.Vector2;
  fly: J3;
  limp: J3;
  /** how floppy (unknown parts: tails, pincers, hair) */
  k: number;
}

export interface RagdollOpts {
  ground: (x: number, z: number) => number;
  /** horizontal direction he is thrown (away from the killer) */
  push: THREE.Vector3;
  power?: number;
  onImpact?: (p: THREE.Vector3, k: number, what: 'body' | 'hat') => void;
}

/**
 * Sundown's real body, thrown and fallen: the rig root leaves the player and becomes a rigid body
 * (eight contact points round the skeleton, restitution and friction against the live height field,
 * a gentle roll onto his back once he slows), and every joint is a damped spring that lags behind the
 * body's turning and is kicked by each impact. `restore()` hands the rig back exactly as it was.
 */
export class Ragdoll {
  c = new THREE.Vector3();
  v = new THREE.Vector3();
  q = new THREE.Quaternion();
  w = new THREE.Vector3();
  landed = -1;
  asleep = false;
  private rest = 0;
  private comY = 0.8;
  private H = 1.6;
  private Iinv = 4;
  private pts: THREE.Vector3[] = [];
  private parent: THREE.Object3D | null;
  private saved: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 };
  private joints: Joint[] = [];
  private wPrev = new THREE.Vector3();
  private grounded = 0;
  private hat: { obj: THREE.Object3D; src: THREE.Object3D; v: THREE.Vector3; spin: THREE.Vector3; landed: number } | null = null;
  private t = 0;
  private r1 = new THREE.Vector3();
  private r2 = new THREE.Vector3();
  private r3 = new THREE.Vector3();
  private qa = new THREE.Quaternion();

  constructor(private rig: RigInstance, private o: RagdollOpts) {
    const root = rig.root;
    root.updateMatrixWorld(true);
    this.parent = root.parent;
    this.saved = { p: root.position.clone(), q: root.quaternion.clone(), s: root.scale.clone() };
    const box = new THREE.Box3().setFromObject(root);
    const rp = root.getWorldPosition(new THREE.Vector3());
    this.H = THREE.MathUtils.clamp(box.max.y - box.min.y, 0.8, 3);
    const foot = Math.min(rp.y, box.min.y);
    this.comY = THREE.MathUtils.clamp(box.getCenter(this.r1).y - rp.y, this.H * 0.3, this.H * 0.65);
    let top: THREE.Object3D = root;
    while (top.parent) top = top.parent;
    top.attach(root);
    this.q.copy(root.quaternion);
    this.c.copy(root.position).addScaledVector(UP.clone().applyQuaternion(this.q), this.comY);
    if (rp.y - foot > 0.02) this.c.y += 0; // (stands on its feet: the root is at the soles)
    const H = this.H, cy = this.comY;
    const P = (x: number, y: number, z: number) => this.pts.push(new THREE.Vector3(x, y - cy, z));
    P(0, H - 0.1, 0); // crown
    P(0, 0.05, 0.08); // toes
    P(0, 0.05, -0.06); // heels
    P(0.21, H * 0.8, -0.05); // shoulders
    P(-0.21, H * 0.8, -0.05);
    P(0, H * 0.66, 0.15); // chest
    P(0, H * 0.6, -0.17); // back
    P(0.17, H * 0.48, 0); // hips
    P(-0.17, H * 0.48, 0);
    this.Iinv = 1 / (0.1 * H * H);
    // thrown away from the killer, the top going over backward, a little twist
    const pw = o.power ?? 1;
    const push = o.push.clone().setY(0);
    if (push.lengthSq() < 1e-4) push.set(0, 0, -1).applyQuaternion(this.q).setY(0);
    push.normalize();
    this.v.copy(push).multiplyScalar(4.6 * pw).setY(3.3 * pw);
    this.w.crossVectors(UP, push).normalize().multiplyScalar(4.2 * pw).addScaledVector(UP, (Math.random() - 0.5) * 2.4);
    for (const p of rig.geo.parts) {
      const n = rig.nodes[p.name];
      if (!n || n === root || p.name === 'hat' || p.name === 'root') continue;
      const known = p.name in LIMP || p.name in FLY;
      const floppy = /tail|pinc|claw|hair|lock|curl|chel|stinger/.test(p.name);
      if (!known && !floppy) continue;
      this.joints.push({ node: n, rest: p.rest.clone(), name: p.name, o: new THREE.Vector2(), w: new THREE.Vector2(), fly: FLY[p.name] ?? [0, 0, 0], limp: LIMP[p.name] ?? [0, 0, 0], k: known ? 1 : 0.55 });
    }
  }

  /** the hat pops off and tumbles on its own (a copy: the rig's own hat hides until restore) */
  flingHat(scene: THREE.Object3D) {
    const src = this.rig.meshes['hat'] as THREE.Mesh | undefined;
    if (!src || this.hat) return;
    src.updateWorldMatrix(true, false);
    src.geometry.computeBoundingBox();
    const ctr = src.geometry.boundingBox!.getCenter(new THREE.Vector3());
    const wrap = new THREE.Group();
    wrap.position.copy(ctr).applyMatrix4(src.matrixWorld);
    src.matrixWorld.decompose(this.r1, wrap.quaternion, this.r2);
    const m = new THREE.Mesh(src.geometry, src.material);
    m.castShadow = true;
    m.scale.copy(this.r2);
    m.position.copy(ctr).multiply(this.r2).multiplyScalar(-1);
    wrap.add(m);
    scene.add(wrap);
    src.visible = false;
    const v = this.v.clone().multiplyScalar(0.55).add(new THREE.Vector3((Math.random() - 0.5) * 1.6, 2.6, (Math.random() - 0.5) * 1.6));
    this.hat = { obj: wrap, src, v, spin: new THREE.Vector3(-7 + Math.random() * 3, 3, 4), landed: -1 };
  }

  /** advance the body (call with the slow-motion clock) */
  step(dt: number) {
    if (dt <= 0) return;
    const n = Math.min(8, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.sub(h);
    this.stepJoints(dt);
    this.stepHat(dt);
  }

  private sub(dt: number) {
    this.t += dt;
    if (this.asleep) return;
    const g = this.o.ground;
    this.v.y -= 9.8 * dt;
    this.c.addScaledVector(this.v, dt);
    const wl = this.w.length();
    if (wl > 1e-5) {
      this.qa.setFromAxisAngle(this.r1.copy(this.w).divideScalar(wl), wl * dt);
      this.q.premultiply(this.qa).normalize();
    }
    let pen = 0, hits = 0, hard = 0;
    const rad = 0.06;
    for (const lp of this.pts) {
      const r = this.r1.copy(lp).applyQuaternion(this.q);
      const px = this.c.x + r.x, py = this.c.y + r.y, pz = this.c.z + r.z;
      const d = g(px, pz) + rad - py;
      if (d <= 0) continue;
      hits++;
      pen = Math.max(pen, d);
      // velocity of the contact point
      const vp = this.r2.crossVectors(this.w, r).add(this.v);
      if (vp.y < 0) {
        const rn = this.r3.set(-r.z, 0, r.x); // r × up
        const j = (-(1 + 0.22) * vp.y) / (1 + this.Iinv * rn.lengthSq());
        this.v.y += j;
        this.w.addScaledVector(this.r3.set(-r.z, 0, r.x), this.Iinv * j);
        hard = Math.max(hard, -vp.y);
        // friction against the slide
        const tl = Math.hypot(vp.x, vp.z);
        if (tl > 1e-4) {
          const jt = Math.min(0.65 * j, tl * 0.6);
          const tx = (-vp.x / tl) * jt, tz = (-vp.z / tl) * jt;
          this.v.x += tx;
          this.v.z += tz;
          // r × (tx, 0, tz)
          this.w.x += this.Iinv * (r.y * tz);
          this.w.y += this.Iinv * (r.z * tx - r.x * tz);
          this.w.z += this.Iinv * (-r.y * tx);
        }
      }
    }
    if (hits) {
      this.c.y += pen * 0.85;
      const k = Math.exp(-1.6 * dt);
      this.v.x *= k;
      this.v.z *= k;
      this.w.multiplyScalar(Math.exp(-2.4 * dt));
      // a slow roll onto his back once he is down (face to the sky)
      const f = this.r1.set(0, 0, 1).applyQuaternion(this.q);
      if (this.landed >= 0) this.w.addScaledVector(this.r2.crossVectors(f, UP), 2.2 * dt);
      if (hard > 0.6) {
        if (this.landed < 0) this.landed = this.t;
        this.kick(Math.min(1.5, hard / 3));
        this.o.onImpact?.(this.c.clone().setY(g(this.c.x, this.c.z)), Math.min(1.5, hard / 3), 'body');
      }
      this.grounded = 0.25;
      if (this.v.length() < 0.12 && this.w.length() < 0.22) this.rest += dt;
      else this.rest = 0;
      if (this.rest > 0.5) this.asleep = true;
    } else this.grounded = Math.max(0, this.grounded - dt);
  }

  private kick(k: number) {
    for (const j of this.joints) {
      j.w.x += (Math.random() - 0.5) * 14 * k * j.k + (j.name.startsWith('arm') || j.name.startsWith('fore') ? -4 * k : 0);
      j.w.y += (Math.random() - 0.5) * 12 * k * j.k;
    }
  }

  private stepJoints(dt: number) {
    // the limbs lag behind the body's turning: angular acceleration in the body's frame
    const acc = this.r1.subVectors(this.w, this.wPrev).divideScalar(Math.max(1e-4, dt)).applyQuaternion(this.qa.copy(this.q).invert());
    this.wPrev.copy(this.w);
    const limp = this.landed >= 0 ? Math.min(1, (this.t - this.landed) * 2.5) : 0;
    const K = 70, C = 7;
    for (const j of this.joints) {
      const tx = j.fly[0] + (j.limp[0] - j.fly[0]) * limp, tz = j.fly[2] + (j.limp[2] - j.fly[2]) * limp;
      j.w.x += (-K * (j.o.x - tx) - C * j.w.x - acc.x * 0.05 * j.k) * dt;
      j.w.y += (-K * (j.o.y - tz) - C * j.w.y - acc.z * 0.05 * j.k) * dt;
      j.o.x = THREE.MathUtils.clamp(j.o.x + j.w.x * dt, -3.2, 3.2);
      j.o.y = THREE.MathUtils.clamp(j.o.y + j.w.y * dt, -2, 2);
    }
  }

  private stepHat(dt: number) {
    const h = this.hat;
    if (!h) return;
    const o = h.obj;
    const gy = this.o.ground(o.position.x, o.position.z) + 0.06;
    if (h.landed >= 0) {
      o.position.y += (gy - o.position.y) * (1 - Math.exp(-dt * 6));
      o.quaternion.slerp(this.qa.setFromEuler(new THREE.Euler(0.12, o.rotation.y, -0.1)), 1 - Math.exp(-dt * 5));
      return;
    }
    h.v.y -= 9.8 * dt;
    h.v.multiplyScalar(Math.exp(-0.9 * dt)); // the brim catches the air
    o.position.addScaledVector(h.v, dt);
    const s = h.spin.length();
    if (s > 1e-4) o.quaternion.premultiply(this.qa.setFromAxisAngle(this.r2.copy(h.spin).divideScalar(s), s * dt));
    if (o.position.y < gy) {
      o.position.y = gy;
      const hard = -h.v.y;
      this.o.onImpact?.(o.position.clone(), Math.min(1, hard / 6), 'hat');
      if (hard > 1.6) {
        h.v.set(h.v.x * 0.5, hard * 0.3, h.v.z * 0.5);
        h.spin.multiplyScalar(0.4);
      } else h.landed = 0;
    }
  }

  /** write the body onto the rig (after the player's own animation each frame) */
  apply() {
    const root = this.rig.root;
    root.quaternion.copy(this.q);
    root.position.copy(this.c).addScaledVector(this.r1.copy(UP).applyQuaternion(this.q), -this.comY);
    for (const j of this.joints) j.node.rotation.set(j.rest.x + j.o.x, j.rest.y + (j.fly[1] + (j.limp[1] - j.fly[1]) * (this.landed >= 0 ? 1 : 0)), j.rest.z + j.o.y);
  }

  /** the body's centre on the ground (for staging) */
  rested(out: THREE.Vector3) {
    return out.copy(this.c).setY(this.o.ground(this.c.x, this.c.z));
  }

  /** give the rig back to the player as it was */
  restore() {
    const root = this.rig.root;
    if (this.parent) this.parent.add(root);
    root.position.copy(this.saved.p);
    root.quaternion.copy(this.saved.q);
    root.scale.copy(this.saved.s);
    for (const j of this.joints) j.node.rotation.copy(j.rest);
    if (this.hat) {
      this.hat.src.visible = true;
      this.hat.obj.removeFromParent();
      this.hat = null;
    }
  }
}

// ======================================================================= the land
const SANDS: Record<string, number[]> = {
  A: [0xe8c48a, 0xd9ad70, 0xf2d6a2, 0xc99a5e],
  B: [0xd8bf8e, 0xc9a874, 0xe6d2a4, 0xb08c5a],
  C: [0xd99a68, 0xc8834e, 0xe8b07e, 0xa86a40],
};

function heightFn(seed: number) {
  const n = new Noise(seed);
  return (x: number, z: number) => {
    const u = x * 0.8 + z * 0.6, v = -x * 0.6 + z * 0.8;
    const r = Math.hypot(x, z);
    const big = n.ridged2(u * 0.006 + 3.1, v * 0.011, 3) * 9;
    const mid = n.fbm2(x * 0.022 + 7, z * 0.022, 3) * 1.6;
    const fl = Math.min(1, Math.max(0, (r - 5) / 70));
    const flat = fl * fl * (3 - 2 * fl);
    const swell = n.fbm2(x * 0.05 + 2, z * 0.05 - 4, 2) * 0.35 * Math.min(1, r / 6);
    const ripple = Math.sin(u * 2.1 + n.n2(x * 0.18, z * 0.18) * 2.6) * 0.03;
    return (big + mid - 1.6) * flat + swell + ripple;
  };
}

/** the patch he dies on: fine voxel sand with wind ripples, pebbles and a few bleached bones */
function nearGround(h: (x: number, z: number) => number, area: string, seed: number) {
  const VS = 0.15, R = 84;
  const m = new VoxelModel('death_ground');
  const pal = SANDS[area] ?? SANDS.A;
  const hi = (i: number, j: number) => Math.round(h(i * VS, j * VS) / VS);
  for (let i = -R; i <= R; i++)
    for (let j = -R; j <= R; j++) {
      if (i * i + j * j > R * R) continue;
      const y = hi(i, j);
      const lo = Math.min(y, hi(i + 1, j), hi(i - 1, j), hi(i, j + 1), hi(i, j - 1)) - 1;
      const x = i * VS, z = j * VS;
      const rip = Math.sin((x * 0.8 + z * 0.6) * 2.1 + Math.sin(x * 0.4) * 1.3);
      const n = hash3(i, j, seed);
      let c = rip > 0.55 ? pal[2] : rip < -0.6 ? pal[1] : pal[0];
      if (n > 0.985) c = pal[3];
      if (n < 0.004) c = 0x8a7660; // a pebble
      for (let k = lo; k <= y; k++) m.set(i, k, j, k === y ? c : pal[1]);
    }
  return buildVoxelGeometry(m, { voxelSize: VS, pivot: [0.5, 1, 0.5], ao: 0.45 });
}

/** the dunes out to the horizon (smooth, sampled from the same field; sunk under the near patch) */
function farGround(h: (x: number, z: number) => number, area: string) {
  const g = new THREE.PlaneGeometry(900, 900, 220, 220);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const pal = SANDS[area] ?? SANDS.A;
  const c0 = new THREE.Color(pal[0]), c1 = new THREE.Color(pal[1]), c2 = new THREE.Color(pal[2]), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // finer near the middle, coarser far away (squash the grid toward the centre)
    const r = Math.hypot(x, z);
    const k = r < 1 ? 1 : Math.pow(r / 450, 1.6) * 450 / r;
    const X = x * k, Z = z * k;
    const R = Math.hypot(X, Z);
    const y = h(X, Z) - (R < 12.4 ? 0.35 : 0);
    pos.setXYZ(i, X, y, Z);
    const s = (h(X + 1, Z) - h(X - 1, Z)) * 0.5;
    c.copy(c0).lerp(s > 0 ? c2 : c1, Math.min(1, Math.abs(s) * 1.4));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** a low drift of sand that rises over the body as the days pass */
function driftModel(seed: number, area: string) {
  const m = new VoxelModel('drift');
  const pal = SANDS[area] ?? SANDS.A;
  for (let x = -9; x <= 9; x++)
    for (let z = -16; z <= 6; z++)
      for (let y = 0; y <= 5; y++) {
        const d = (x / 9.5) ** 2 + ((z + 5) / 11.5) ** 2 + (y / 5.2) ** 2 + (hash3(x, z, seed) - 0.5) * 0.12;
        if (d < 1) m.set(x, y, z, y >= 4 || d > 0.8 ? pal[0] : pal[1]);
      }
  return buildVoxelGeometry(m, { voxelSize: 0.06, pivot: [0.5, 0, 0.5] });
}

// ======================================================================= the sky
const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FS = /* glsl */ `
uniform vec3 uZenith, uGround, fogColor, uSunDir, uSunCol, uMoonDir;
uniform mat4 uAtmo;
uniform mat3 uStarRot;
uniform float uStars, uTime, uMoon, uNight, uSunVis;
varying vec3 vDir;
${ATMO_HAZE_GLSL}
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 hz = atmoHaze(d, fogColor);
  float t = clamp(y, 0.0, 1.0);
  float mu = max(dot(d, uSunDir), 0.0);
  float g = pow(smoothstep(0.0, 0.62, t), 0.48);
  g *= 1.0 - 0.22 * pow(mu, 4.0) * (1.0 - t);
  vec3 col = mix(hz, uZenith * 1.08, g);
  // painted bands: a warm low glow under a cooler upper sky
  col = mix(col, col * vec3(1.05, 0.97, 0.9), smoothstep(0.25, 0.0, y) * (1.0 - uNight) * 0.5);
  col += hz * 0.07 * exp(-abs(y) * 36.0);
  if (y < 0.0) col = mix(hz, uGround, smoothstep(0.0, 0.35, -y) * 0.35);
  // stars: fixed to the celestial sphere, wheeling round the pole; a faint milky way
  vec3 sd = uStarRot * d;
  if (uStars > 0.01 && y > -0.02) {
    vec3 q = floor(sd * 420.0);
    float s = h3(q);
    float tw = 0.55 + 0.45 * sin(uTime * 2.3 + s * 60.0);
    float mag = step(0.9958, s) * (0.35 + 0.65 * fract(s * 97.0));
    vec3 sc = mix(vec3(1.0, 0.86, 0.7), vec3(0.75, 0.85, 1.0), fract(s * 31.0));
    float lowFade = smoothstep(0.0, 0.25, y);
    col += sc * mag * tw * uStars * lowFade * 1.6;
    float band = exp(-pow((sd.z + 0.18 * sin(sd.x * 2.6)) * 3.4, 2.0));
    float cl = vn(sd * 9.0) * 0.6 + vn(sd * 23.0) * 0.4;
    col += vec3(0.42, 0.46, 0.7) * band * cl * 0.09 * uStars * lowFade;
  }
  // the sun: forward glow + a limb-darkened disk
  col += uSunCol * 0.05 * (pow(mu, 12.0) * 0.28 + pow(mu, 64.0) * 1.0 + pow(mu, 480.0) * 3.0) * uSunVis;
  float disk = smoothstep(0.99955, 0.99972, dot(d, uSunDir));
  col = mix(col, uSunCol * (0.72 + 0.28 * smoothstep(0.99955, 0.99993, dot(d, uSunDir))), disk * uSunVis);
  // the moon: a pale cratered disk with a soft halo, lit on the sun side
  float mm = dot(d, uMoonDir);
  col += vec3(0.62, 0.7, 0.9) * pow(max(mm, 0.0), 300.0) * 0.35 * uMoon;
  float md = smoothstep(0.99962, 0.99976, mm);
  if (md > 0.0) {
    vec3 mu2 = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 mv2 = cross(mu2, uMoonDir);
    vec2 mp = vec2(dot(d, mu2), dot(d, mv2)) / 0.0219;
    float crat = vn(vec3(mp * 3.2, 1.7)) * 0.6 + vn(vec3(mp * 7.0, 4.1)) * 0.4;
    float lit = clamp(0.35 + 0.65 * dot(normalize(vec3(mp, sqrt(max(0.0, 1.0 - dot(mp, mp))))), normalize(vec3(dot(uSunDir, mu2), dot(uSunDir, mv2), 0.6))), 0.12, 1.0);
    vec3 mc = vec3(0.95, 0.93, 0.86) * (0.78 + 0.3 * crat) * lit * 2.2;
    col = mix(col, mc, md * uMoon);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const LAT = THREE.MathUtils.degToRad(32);
const POLE = new THREE.Vector3(0, Math.sin(LAT), Math.cos(LAT));
const MER = new THREE.Vector3(0, Math.cos(LAT), -Math.sin(LAT));
const WEST = new THREE.Vector3(-1, 0, 0);
/** a body on the celestial sphere at hour angle H (0 = due south, highest) and declination dec */
function celestial(H: number, dec: number, out: THREE.Vector3) {
  return out.copy(MER).multiplyScalar(Math.cos(H)).addScaledVector(WEST, Math.sin(H)).multiplyScalar(Math.cos(dec)).addScaledVector(POLE, Math.sin(dec)).normalize();
}

const DUSK: EnvPreset = { zenith: 0x1c2452, horizon: 0xd8704a, ground: 0x5a3a3a, sunColor: 0xff7a52, sunIntensity: 0.8, sunElev: 2, sunAzim: 250, hemiSky: 0x6070a8, hemiGround: 0x4a3030, hemiIntensity: 0.75, fog: 0x6a5a7c, fogNear: 30, fogFar: 320, exposure: 1, stars: 0.55, clouds: 0.5, cloudColor: 0xb07a8a };
const DAWN: EnvPreset = { ...DUSK, horizon: 0xf0a07a, zenith: 0x2a3a6e, fog: 0x8a7a96, cloudColor: 0xe0a0a8, sunColor: 0xffa070 };

function mixPreset(a: EnvPreset, b: EnvPreset, k: number): EnvPreset {
  const c = (x: number, y: number) => _c1.setHex(x).lerp(_c2.setHex(y), k).getHex();
  const n = (x: number, y: number) => x + (y - x) * k;
  return {
    zenith: c(a.zenith, b.zenith), horizon: c(a.horizon, b.horizon), ground: c(a.ground, b.ground), sunColor: c(a.sunColor, b.sunColor),
    sunIntensity: n(a.sunIntensity, b.sunIntensity), sunElev: n(a.sunElev, b.sunElev), sunAzim: n(a.sunAzim, b.sunAzim),
    hemiSky: c(a.hemiSky, b.hemiSky), hemiGround: c(a.hemiGround, b.hemiGround), hemiIntensity: n(a.hemiIntensity, b.hemiIntensity),
    fog: c(a.fog, b.fog), fogNear: n(a.fogNear, b.fogNear), fogFar: n(a.fogFar, b.fogFar), exposure: n(a.exposure, b.exposure),
    stars: n(a.stars, b.stars), clouds: n(a.clouds, b.clouds), cloudColor: c(a.cloudColor, b.cloudColor),
  };
}
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

// ======================================================================= the way home
const ss = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, v: number) => ss(clamp01((v - a) / (b - a)));
/** the time-lapse camera: east of the dunes, looking west-south-west into the sunset, toward home */
const TL_POS = new THREE.Vector3(12, 4.6, 5.4);
const TL_DIR = new THREE.Vector3(-0.92, 0.17, -0.36).normalize();
/** the hideout on the horizon, and the soul's road to its lit window */
const HOME = new THREE.Vector3(-46, 0, -18);
const ROAD = [new THREE.Vector3(22, 1.5, 11), new THREE.Vector3(8, 1.1, 3.5), new THREE.Vector3(-6, 1.4, -2.5), new THREE.Vector3(-22, 1.9, -9), new THREE.Vector3(-36, 2.0, -14.5), new THREE.Vector3(-44.2, 1.35, -17.2)];
const JADE = [0x7ff0e0, 0xc8fff4, 0x4fd8c0];
/** the soul in flight: arms swept back, legs trailing, head up toward home */
const SOAR: Record<string, J3> = { arm_l: [0.55, 0, 0.5], arm_r: [0.55, 0, -0.5], fore_l: [-0.3, 0, 0], fore_r: [-0.3, 0, 0], torso: [-0.15, 0, 0], head: [-0.35, 0, 0], thigh_l: [0.25, 0, 0.05], thigh_r: [0.42, 0, -0.05], shin_l: [0.55, 0, 0], shin_r: [0.8, 0, 0] };

export class DeathCine implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.05, 1400);
  ready = false;
  private env!: Env;
  private sky!: THREE.Mesh;
  private skyU: Record<string, THREE.IUniform> = {};
  private h!: (x: number, z: number) => number;
  private particles = new Particles();
  private soul: RigInstance | null = null;
  private soulShell: SpiritMat | null = null;
  private soulCore: THREE.Material | null = null;
  private soulLight = new THREE.PointLight(0x7ff0e0, 0, 7, 1.6);
  private homeLight = new THREE.PointLight(0xffb060, 0, 16, 1.4);
  private road!: THREE.CatmullRomCurve3;
  private u = 0;
  private t = 0;
  /** time-lapse: day fraction (0 midnight, .25 sunrise, .5 noon, .75 sunset) */
  private tau = 0.7;
  private tlStart = -1;
  private tlOn = false;
  private tlDur = 8;
  private sunrises = 0;
  private arriveAt = -1;
  private endAt = -1;
  private leaving = false;
  private loops: { stop(t?: number): void }[] = [];
  private nightLoop: { stop(t?: number): void } | null = null;
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private sunDir = new THREE.Vector3();
  private moonDir = new THREE.Vector3();
  private lightDir = new THREE.Vector3();
  private starRot = new THREE.Matrix3();
  private m4 = new THREE.Matrix4();
  private base!: EnvPreset;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camRoll = 0;
  private fovNow = 40;
  private sand: number[];
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private own(g: THREE.BufferGeometry) {
    this.geos.push(g);
    return g;
  }

  constructor(private engine: Engine, private o: DeathCineOpts) {
    this.sand = SANDS[o.area] ?? SANDS.A;
  }

  async enter() {
    const eng = this.engine;
    const s = this.scene;
    const o = this.o;
    this.h = heightFn(o.seed);
    // ---- light and air
    this.base = { ...PRESETS[o.area === 'B' ? 'oasis' : o.area === 'C' ? 'pyramid' : 'dunes'] };
    this.env = new Env(s, o.area === 'B' ? 'oasis' : o.area === 'C' ? 'pyramid' : 'dunes', o.seed % 1000);
    this.env.sky.visible = false;
    this.env.shadowExtent = 14;
    this.env.sun.shadow.mapSize.set(2048, 2048);
    this.skyU = {
      uZenith: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, fogColor: { value: this.env.fog.color },
      uSunDir: { value: this.sunDir }, uSunCol: { value: new THREE.Color() }, uMoonDir: { value: this.moonDir }, uAtmo: { value: ATMO.u },
      uStarRot: { value: this.starRot }, uStars: { value: 0 }, uTime: { value: 0 }, uMoon: { value: 0 }, uNight: { value: 0 }, uSunVis: { value: 1 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    s.add(this.sky);
    this.applySky(this.tau);
    try {
      this.envRT = this.env.applyEnvMap(eng.renderer);
    } catch (e) {
      console.warn('[death] env', e);
    }
    // ---- the ground
    const near = new THREE.Mesh(this.own(nearGround(this.h, o.area, o.seed)), sharedVoxelMaterial);
    near.receiveShadow = near.castShadow = true;
    s.add(near);
    const far = new THREE.Mesh(this.own(farGround(this.h, o.area)), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    far.receiveShadow = true;
    s.add(far);
    // set dressing along the road home: a bleached skull, a broken cactus, a rib arch, a cattle-skull post
    const prop = (key: string, x: number, z: number, ry: number, sc = 1, sink = 0.05) => {
      try {
        const r = modelEntry(key)?.() as any;
        if (!r?.model) return null;
        const m = new THREE.Mesh(this.own(buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: 'bottom' })), sharedVoxelMaterial);
        m.castShadow = m.receiveShadow = true;
        m.position.set(x, this.h(x, z) - sink, z);
        m.rotation.y = ry;
        m.scale.setScalar(sc);
        s.add(m);
        return m;
      } catch (e) {
        console.warn('[death] prop', key, e);
        return null;
      }
    };
    prop('skull_cow', 5.2, 1.6, 2.4, 0.8);
    prop('cactus_saguaro_dmg2', -2.6, -6.2, 0.7);
    prop(o.area === 'C' ? 'obelisk_broken' : o.area === 'B' ? 'column_broken' : 'rib_arch', -17, -14, 0.5, 1.2, 0.4);
    prop('cattle_skull_post', -30, -10.5, -0.8);
    // the hideout on the horizon: walls, roof, and a lamp in the window
    const hy = this.h(HOME.x, HOME.z);
    HOME.y = hy;
    const walls = prop('cabin_walls', HOME.x - 1.6, HOME.z - 1.2, 0.9, 1, 0.1);
    if (walls) {
      const top = new THREE.Box3().setFromObject(walls).max.y;
      const roof = prop('cabin_roof', HOME.x - 1.6, HOME.z - 1.2, 0.9, 1, 0);
      if (roof) roof.position.y = top - 0.15;
    } else prop('rib_arch', HOME.x - 1.6, HOME.z - 1.2, 0.9, 1.4, 0.3);
    this.homeLight.position.set(HOME.x + 0.6, hy + 1.6, HOME.z + 0.5);
    s.add(this.homeLight);
    s.add(this.particles.group);
    this.particles.groundAt = this.h;
    // ---- the road home, hugging the dunes
    this.road = new THREE.CatmullRomCurve3(ROAD.map((p) => p.clone().setY(this.h(p.x, p.z) + p.y)), false, 'centripetal');
    // ---- the soul: a jade spectre of his own bones
    if (o.hero?.parts) {
      try {
        const geo = buildRigGeo(o.hero, o.hero.name + ':death');
        const core = makeVoxelMaterial({ transparent: true, opacity: 0.34 });
        core.userData.tint.value.setRGB(0.55, 1.25, 1.3);
        core.depthWrite = false;
        const shell = spiritMaterial(0x0f6a5a, 0xb8fff0, { inflate: 0.012, power: 2.2, core: 0.55, lumRim: 1, gain: 1.2, vein: 0.6 });
        shell.uniforms.uFogNear.value = 80;
        shell.uniforms.uFogFar.value = 500;
        this.mats.push(core, shell);
        const r = new RigInstance(geo, { material: core, castShadow: false });
        const shells = soulShellGeos(geo);
        geo.parts.forEach((p, i) => {
          const m = new THREE.Mesh(shells[i], shell);
          m.renderOrder = 5;
          r.nodes[p.name].add(m);
        });
        r.root.traverse((q) => {
          if ((q as THREE.Mesh).isMesh && (q as THREE.Mesh).material === core) q.renderOrder = 4;
        });
        s.add(r.root);
        this.soul = r;
        this.soulShell = shell;
        this.soulCore = core;
      } catch (e) {
        console.warn('[death] soul', e);
      }
    }
    s.add(this.soulLight);
    eng.letterbox(true, 0.4);
    eng.input.setWantLock(false);
    (window as any).__music?.setMood('underworld', 1.2);
    const w = eng.audio.loop('wind_loop', 0.5);
    if (w) this.loops.push(w);
    eng.audio.play('soul_leave', { volume: 0.7, pitch: 0.8 });
    eng.audio.play('whoosh_big', { volume: 0.6, pitch: 0.6 });
    this.tlDur = THREE.MathUtils.clamp(2.1 * o.days + 1.6, 6, 13);
    this.camera.aspect = eng.width / eng.height;
    this.placeSoul(0, 0);
    this.shotChase(0, true);
    this.ready = true;
    (window as any).__death = this;
  }

  // ---------------------------------------------------------------- the soul
  private placeSoul(dt: number, t: number) {
    const u = Math.min(0.999, this.u);
    const p = this.road.getPointAt(u, this.v1);
    const tan = this.road.getTangentAt(u, this.v2);
    const r = this.soul?.root;
    const bob = Math.sin(t * 1.7) * 0.12;
    this.soulLight.position.copy(p).setY(p.y + 0.6 + bob);
    this.soulLight.intensity = 6 + Math.sin(t * 3.1) * 0.8;
    if (r) {
      // flying: tipped forward along the road, banking a little into the curve
      r.position.copy(p).setY(p.y + bob);
      const yaw = Math.atan2(tan.x, tan.z);
      r.rotation.set(1.05 + Math.sin(t * 0.9) * 0.06, yaw, Math.sin(t * 0.6) * 0.12, 'YXZ');
      for (const part of this.soul!.geo.parts) {
        const n = this.soul!.nodes[part.name];
        const j = SOAR[part.name];
        if (!n || !j) continue;
        const ph = t * 2.3 + part.name.length;
        n.rotation.set(part.rest.x + j[0] + Math.sin(ph) * 0.06, part.rest.y + j[1], part.rest.z + j[2] + Math.sin(ph * 0.7) * 0.05);
      }
      if (this.soulShell) this.soulShell.uniforms.uGain.value = 1.15 + Math.sin(t * 3.1) * 0.1 + Math.sin(t * 17) * 0.05;
    }
    // a wake of motes, and sand lifting under him when he flies low
    if (dt > 0 && Math.random() < dt * 70) {
      const back = this.v3.copy(tan).multiplyScalar(-0.6);
      this.particles.emit({ pos: { x: p.x + back.x, y: p.y + 0.5 + bob, z: p.z + back.z }, vel: { x: -tan.x * 1.5, y: 0.35, z: -tan.z * 1.5 }, count: 1, spread: 0.45, life: [0.8, 1.8], size: [0.06, 0.012], sprite: Math.random() < 0.3 ? 'glow8' : 'dot3', color: JADE, additive: true, drag: 0.8, gravity: -0.3 });
    }
    if (dt > 0 && Math.random() < dt * 10) {
      const g = this.h(p.x, p.z);
      if (p.y - g < 1.8) this.particles.emit({ pos: { x: p.x, y: g + 0.05, z: p.z }, vel: { x: -tan.x * 2, y: 0.5, z: -tan.z * 2 }, count: 2, spread: 0.6, life: [1.0, 2.0], size: [0.25, 0.8], sprite: ['puff0', 'puff1'], color: this.sand, alpha: 0.3, drag: 1.6, rot: 3, rotSpeed: 0.3 });
    }
  }

  // ---------------------------------------------------------------- sky and light
  /** day fraction → sun, moon, stars, light, sky colours */
  private applySky(tau: number) {
    const H = (tau - 0.5) * Math.PI * 2;
    celestial(H, THREE.MathUtils.degToRad(15), this.sunDir);
    celestial(H - 0.42 * Math.PI * 2, THREE.MathUtils.degToRad(-6), this.moonDir);
    this.m4.makeRotationAxis(POLE, -tau * Math.PI * 2);
    this.starRot.setFromMatrix4(this.m4);
    const alt = THREE.MathUtils.radToDeg(Math.asin(this.sunDir.y));
    const rising = Math.sin(H) < 0;
    const eve = rising ? DAWN : DUSK;
    let p: EnvPreset;
    if (alt > 24) p = { ...this.base };
    else if (alt > 7) p = mixPreset(PRESETS.menu, this.base, (alt - 7) / 17);
    else if (alt > 0) p = mixPreset({ ...PRESETS.pyramid, sunIntensity: 2.2 }, PRESETS.menu, alt / 7);
    else if (alt > -7) p = mixPreset(eve, { ...PRESETS.pyramid, sunIntensity: 2.2 }, (alt + 7) / 7);
    else if (alt > -16) p = mixPreset(PRESETS.night, eve, (alt + 16) / 9);
    else p = { ...PRESETS.night };
    const night = clamp01((-alt + 2) / 14);
    const sunI = sstep(-0.05, 0.14, this.sunDir.y);
    const moonI = sstep(-0.04, 0.2, this.moonDir.y) * night;
    this.lightDir.copy(sunI >= moonI * 0.35 ? this.sunDir : this.moonDir);
    p.sunElev = THREE.MathUtils.radToDeg(Math.asin(Math.max(0.03, this.lightDir.y)));
    p.sunAzim = THREE.MathUtils.radToDeg(Math.atan2(this.lightDir.z, this.lightDir.x));
    const env = this.env;
    env.apply(p);
    env.sun.intensity = Math.max(sunI * p.sunIntensity * 1.35, moonI * 1.25, 0.12);
    if (sunI < moonI * 0.35) env.sun.color.setHex(0x9fb8ff);
    env.hemi.intensity = p.hemiIntensity * (0.34 + 0.46 * night);
    globalUniforms.uSunCol.value.copy(env.sun.color).multiplyScalar(env.sun.intensity);
    ATMO.u[3] = 0.8 - 0.55 * night;
    ATMO.u[11] = this.tlOn ? ATMO.u[11] * 0.7 : 0.12;
    ATMO.u[10] = this.tlOn ? 3.2 : 1.2;
    this.scene.environmentIntensity = 0.52 - 0.4 * night;
    const u = this.skyU;
    (u.uZenith.value as THREE.Color).setHex(p.zenith);
    (u.uGround.value as THREE.Color).setHex(p.ground);
    (u.uSunCol.value as THREE.Color).setHex(p.sunColor).multiplyScalar(7 - 4 * night);
    u.uSunVis.value = sstep(-0.035, 0.0, this.sunDir.y);
    u.uStars.value = Math.max(p.stars, night);
    u.uMoon.value = sstep(-0.02, 0.03, this.moonDir.y) * (0.35 + 0.65 * night);
    u.uNight.value = night;
    // the lamp in the hideout window burns brighter as the dark comes on
    this.homeLight.intensity = 3 + 22 * night;
    return night;
  }

  // ---------------------------------------------------------------- camera
  private setCam(pos: THREE.Vector3, look: THREE.Vector3, fov: number, roll: number, rdt: number, snap = false) {
    const k = snap ? 1 : 1 - Math.exp(-rdt * 3.2);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    if (snap) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
    }
    // never inside a dune
    const g = this.h(this.camPos.x, this.camPos.z) + 0.35;
    if (this.camPos.y < g) this.camPos.y = g;
    this.fovNow += (fov - this.fovNow) * (snap ? 1 : k);
    this.camRoll += (roll - this.camRoll) * (snap ? 1 : k);
    const c = this.camera;
    c.position.copy(this.camPos);
    c.lookAt(this.camLook);
    c.rotateZ(this.camRoll);
    c.fov = this.fovNow;
    c.aspect = this.engine.width / this.engine.height;
    c.updateProjectionMatrix();
  }

  /** low and close beside the soul as it streaks over the sand, a little dutch, leading it */
  private shotChase(rdt: number, snap = false) {
    const u = Math.min(0.999, this.u);
    const p = this.road.getPointAt(u, this.v1).clone();
    const tan = this.road.getTangentAt(u, this.v2).clone();
    const side = this.v3.set(tan.z, 0, -tan.x).normalize();
    const pos = p.clone().addScaledVector(tan, -2.4).addScaledVector(side, 1.35).add(new THREE.Vector3(0, 0.35, 0));
    const look = p.clone().addScaledVector(tan, 2.2).add(new THREE.Vector3(0, 0.45, 0));
    this.setCam(pos, look, 54, 0.06, rdt * 1.6, snap);
  }

  // ---------------------------------------------------------------- frame
  update(_dt: number, rdt: number) {
    if (!this.ready) return;
    const eng = this.engine;
    const inp = eng.input;
    this.t += rdt;
    const t = this.t;
    if (t > 0.6 && !this.leaving && (inp.wasPressed('Space') || inp.wasPressed('Escape') || inp.wasPressed('Enter') || inp.wasPressed('Mouse0'))) {
      this.finish(true);
      return;
    }
    const g = this.h(0, 0);
    const CHASE = 2.8;
    let night = 0;
    if (t < CHASE) {
      // a. the soul streaks low over the dunes at dusk
      this.u = 0.2 * ss(clamp01(t / CHASE)) * 0.9 + 0.02;
      this.placeSoul(rdt, t);
      this.shotChase(rdt);
      night = this.applySky(this.tau);
    } else if (this.arriveAt < 0) {
      // b. the time-lapse: a slow pan across the western sky, the soul drifting on toward the window
      if (!this.tlOn) {
        this.tlOn = true;
        this.tlStart = t;
        (window as any).__music?.setMood('off', 2);
        this.nightLoop = eng.audio.loop('night_loop', 0.0);
      }
      const tl = clamp01((t - this.tlStart) / this.tlDur);
      const ease = tl < 0.5 ? 2 * tl * tl : 1 - Math.pow(-2 * tl + 2, 2) / 2;
      this.tau = 0.7 + this.o.days * ease;
      const n = Math.max(0, Math.floor(this.tau - 0.27));
      if (n > this.sunrises) this.onSunrise(n);
      night = this.applySky(this.tau);
      (this.env as any).cloudSpeed = 2.2 + Math.sin(tl * Math.PI) * 140;
      this.u = 0.2 + 0.66 * ease;
      this.placeSoul(rdt, t);
      const pos = this.v1.copy(TL_POS).setY(g + TL_POS.y);
      const dir = this.v2.set(TL_DIR.x, TL_DIR.y - tl * 0.04, TL_DIR.z - tl * 0.12).normalize();
      this.setCam(pos, this.v3.copy(pos).addScaledVector(dir, 40), 62 - tl * 8, 0, rdt * (t - this.tlStart < 1.5 ? 1.2 : 2));
      if (tl >= 1) this.arriveAt = t;
    } else {
      // c. home: push in on the lamp-lit window as the soul slips inside
      const k = clamp01((t - this.arriveAt) / 2.6);
      this.u = 0.86 + 0.14 * ss(k);
      this.placeSoul(rdt, t);
      night = this.applySky(this.tau);
      const hy = HOME.y;
      const pos = this.v1.set(HOME.x + 9 - 4.5 * ss(k), hy + 2.6 - 0.8 * ss(k), HOME.z + 6.5 - 3 * ss(k));
      this.setCam(pos, this.v2.set(HOME.x - 0.6, hy + 1.3, HOME.z - 0.6), 46 - 8 * k, 0, rdt * 1.4);
      this.homeLight.intensity += 30 * sstep(0.55, 1, k);
      if (this.soul) this.soul.root.visible = k < 0.92;
      if (k >= 1 && this.endAt < 0) this.endAt = t + 0.2;
    }
    this.nightLoopVol(night);
    // drifting pixel sand, always
    if (Math.random() < rdt * 18) {
      const c = this.camera.position;
      const x = c.x + (Math.random() - 0.5) * 16 - 4, z = c.z + (Math.random() - 0.5) * 16 - 3;
      this.particles.emit({ pos: { x, y: this.h(x, z) + 0.05 + Math.random() * 0.2, z }, count: 3, vel: { x: -0.9 * (6 + Math.random() * 4), y: 0.25, z: 0.42 * (6 + Math.random() * 4) }, spread: 0.6, jitter: 1, gravity: 1.2, drag: 0.25, life: [1.4, 2.8], size: [0.04, 0.07], sprite: 'dot3', color: this.sand, ground: true });
    }
    this.skyU.uTime.value = t;
    this.env.update(this.v1.copy(this.camera.position).setY(g), rdt, t);
    this.sky.position.copy(this.camera.position);
    this.particles.update(rdt, this.scene.fog as THREE.Fog);
    if (this.endAt >= 0 && t >= this.endAt) this.finish(false);
  }

  private nightLoopVol(night: number) {
    const l = this.nightLoop as any;
    if (l?.setVolume) l.setVolume(0.35 * night);
  }

  /** "N DAYS PASSED": the count of sunrises hangs in the air in front of the camera (floating 3D type) */
  private daysLine(text: string, instant = false) {
    say3D(this.engine, text, null, { key: 'death:days', screen: [0, 0.3], depth: 2.6, fit: false, size: 0.17, px: 72, wrap: 40, cps: instant ? 0 : 40, color: '#fff1d2', glow: '#6a3a18', hdr: 1.15, hold: 30 });
  }

  private onSunrise(n: number) {
    this.sunrises = n;
    this.daysLine(`${n} ${n === 1 ? 'DAY' : 'DAYS'} PASSED...`);
    this.engine.audio.play('divine_chime', { volume: 0.35, pitch: 0.7 + n * 0.05 });
  }

  /** the window blooms warm: he wakes up at home */
  private finish(skipped: boolean) {
    if (this.leaving) return;
    this.leaving = true;
    const eng = this.engine;
    const days = this.o.days;
    if (skipped) this.daysLine(`${days} DAYS PASSED...`, true);
    // after the first ride, waking at home is how the hideout is found
    const first = loadSave().runs === 1;
    const lore = !first && !skipped ? DEATH_LORE[Math.floor(Math.random() * DEATH_LORE.length)] : null;
    if (first || lore) say3D(eng, lore ?? 'and the way home is found', null, { key: 'death:home', screen: [0, 0.12], depth: 2.6, fit: false, size: 0.07, px: 56, wrap: 40, cps: 22, color: '#ffe2a0', glow: '#5a3010', hdr: 1.1, hold: 30 });
    eng.audio.play('divine_chime', { volume: 0.4, pitch: 0.6 });
    void (async () => {
      if (first || lore) await eng.tweens.wait(lore ? 1.8 : 1.3, true);
      await eng.fadeOut(skipped ? 0.5 : 1.4, '#fff3dc');
      await eng.setScene(new HubScene(eng, () => nav.ride(false), () => nav.menu(), { wake: { days, result: this.o.result } }), 0.9, '#fff3dc');
    })();
  }

  exit() {
    for (const l of this.loops) l.stop(0.8);
    this.nightLoop?.stop(0.8);
    this.engine.letterbox(false, 0.4);
    this.env?.dispose();
    this.envRT?.dispose();
    this.sky?.geometry.dispose();
    (this.sky?.material as THREE.Material | undefined)?.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    if ((window as any).__death === this) (window as any).__death = null;
  }
}

// ======================================================================= debug
/**
 * ?debug=death           ride out, then die where you stand (the fall, the reaping, the weighing)
 * ?debug=death&deaths=3  ...as the 3rd death of the ride (a heavier heart; 4 = too heavy, the scale slams)
 * ?debug=death&stage=home  straight to the way home and Mama Toad's bedside
 */
export async function debugDeath(eng: Engine, p: URLSearchParams) {
  nav.ride(false);
  let run: any = null;
  for (let i = 0; i < 1200 && !run; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const c = eng.current as any;
    if (c?.ready && c.player?.rig && c.run && c.enemies) run = c;
  }
  if (!run) return;
  await new Promise((r) => setTimeout(r, Number(p.get('wait') ?? 2500)));
  run.run.deaths = Math.max(0, Math.min(4, Number(p.get('deaths') ?? 1)) - 1);
  if (p.get('stage') === 'home') {
    run.run.deaths++;
    const res = { run: { ...run.run }, won: false, bosses: [], hero: run.player.rig.geo.spec, banked: 0 } as unknown as RunResult;
    void eng.setScene(new DeathCine(eng, deathCineFromRun(run, res)), 0.35, '#fff3dc', { loading: false });
    return;
  }
  run.player.applyDamage(1e6, 'debug', false);
}
