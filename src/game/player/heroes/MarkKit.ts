// MARK's kit (HeroId 'mark'): the moon-mummy cat replaces Sundown's revolver with
//  • MOON CRESTS (primary fire, same aim): silver crescent boomerangs. A tap throws one
//    from the hip; it flies to the reticle, ricochets to the next body (bounces grow
//    with the pierce stat), then curves home and is caught. In ADS, holding fire winds
//    up ACROSS THE UNIVERSE, a big charged crest that pierces everything on its line.
//    Three crests ride on his back (the ammo rhythm); RELOAD calls them all home at
//    once (GET BACK), cutting through whatever is in the way. Firing with none in hand
//    recalls them too.
//  • TWIN BATONS (melee): a fast four-hit string (forehand, backhand, cross, then the
//    batons couple into a staff for a full spinning sweep). Melee while holding JUMP is
//    the launcher (JUMPIN' JACK FLASH): a staff uppercut that throws the foes up and him
//    after them; in the air the string becomes an air combo that hangs him there and
//    juggles them, ending in HELTER SKELTER, a staff dive that slams a shockwave. The
//    opener of every string is the shared kick (counters, bullet deflects).
//  • the CRESCENT GLIDE BOARD: he floats a hand's width over sand and water on its
//    light, falls slower (longer airtime) and, holding JUMP in the air, glides, a long
//    floaty descent trailing pixel moonlight.
// His spells (E / C / G) and ultimate live in MarkSpells. The pose layer here runs after
// the shared riding animation: swing arcs by two-bone IK with the baton direction as the
// forearm twist, torso facing, the staff spin, throws and catches, cast poses, the glide
// spread, plus the tail, ears and eyes, always alive.
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../../Ctx';
import type { Player } from '../Player';
import type { Input } from '../../../engine/Input';
import type { BoardInput } from '../Board';
import { armIK, type PlayerAnim } from '../../anim/playerAnim';
import { RigInstance } from '../../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { moonCrestModel } from '../../models/characters/markGear';
import type { WeaponHud } from '../Weapons';
import type { HeroKit } from './HeroKit';
import { clamp, damp, rnd } from '../../../engine/math/rand';

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Mark's handling */
export const MARK = {
  crests: 3,
  throwSpeed: 38,
  bigSpeed: 32,
  range: 30,
  bigRange: 46,
  crestDmg: 15,
  bigDmg: 42,
  returnMul: 0.6,
  /** ricochets per throw before the crest turns home (+ the pierce stat) */
  bounces: 1,
  ricochet: 11,
  hitR: 0.55,
  bigR: 1.05,
  returnSpeed: 42,
  catchR: 1.1,
  throwCd: 0.2,
  /** ADS charge to full (s) */
  charge: 0.6,
  // melee
  window: 0.45,
  drawFor: 2.8,
  // board
  gravity: 16,
  glideGravity: 4.2,
  glideFall: -2.6,
  glideSpeed: 12,
  hover: 0.2,
};

/** the colours of moonlight */
export const MOONLIGHT = [0xeef7ff, 0xc9e0ff, 0xa9cdff, 0xffffff];

interface Flight {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  state: 'out' | 'back';
  t: number;
  dist: number;
  range: number;
  big: boolean;
  dmg: number;
  bounces: number;
  hits: Set<number>;
  backHits: Set<number>;
  spin: number;
  target: EnemyLike | null;
  fx: number;
}

type MoveName = 'm1' | 'm2' | 'm3' | 'm4' | 'launch' | 'a1' | 'a2' | 'a3' | 'slam';
interface MoveDef {
  dur: number;
  hitAt: number;
  dmg: number;
  reach: number;
  /** all round (spin) */
  round?: boolean;
  knock: number;
  staff?: boolean;
  /** opener: the shared kick (counter + deflect) */
  shared?: boolean;
  name?: string;
}
const MOVES: Record<MoveName, MoveDef> = {
  m1: { dur: 0.3, hitAt: 0.1, dmg: 0, reach: 2.7, knock: 2, shared: true },
  m2: { dur: 0.3, hitAt: 0.11, dmg: 16, reach: 2.7, knock: 2.5 },
  m3: { dur: 0.36, hitAt: 0.14, dmg: 20, reach: 2.9, knock: 4 },
  m4: { dur: 0.62, hitAt: 0.24, dmg: 30, reach: 3.4, knock: 9, round: true, staff: true, name: 'Moonlight Sweep' },
  launch: { dur: 0.46, hitAt: 0.13, dmg: 18, reach: 3.0, knock: 1.5, staff: true, name: "Jumpin' Jack Flash" },
  a1: { dur: 0.28, hitAt: 0.09, dmg: 0, reach: 2.9, knock: 1, shared: true },
  a2: { dur: 0.28, hitAt: 0.1, dmg: 16, reach: 2.9, knock: 1 },
  a3: { dur: 0.32, hitAt: 0.12, dmg: 20, reach: 3.0, knock: 1.5 },
  slam: { dur: 0.9, hitAt: 9, dmg: 34, reach: 3.8, knock: 10, round: true, staff: true, name: 'Helter Skelter' },
};
const NEXT: Partial<Record<MoveName, MoveName>> = { m1: 'm2', m2: 'm3', m3: 'm4', a1: 'a2', a2: 'a3', a3: 'slam' };
interface Move {
  name: MoveName;
  def: MoveDef;
  t: number;
  hit: boolean;
  dir: THREE.Vector3;
  queued: boolean;
  /** slam: diving, landed */
  phase: number;
}

type PoseName = 'throw' | 'charge' | 'catch' | 'beam' | 'dash' | 'rain' | 'ward' | 'ult' | 'land';
interface Pose {
  name: PoseName;
  t: number;
  dur: number;
  aim: THREE.Vector3;
}

export interface MarkDeps {
  ctx: Ctx;
  player: Player;
  input: Input;
}

export class MarkKit implements HeroKit {
  readonly id = 'mark';
  static current: MarkKit | null = null;
  private ctx: Ctx;
  private p: Player;
  private inp: Input;
  // crests
  crestsMax = MARK.crests;
  crestsHand = MARK.crests;
  flights: Flight[] = [];
  private crestGeo: THREE.BufferGeometry;
  private crestMat: THREE.Material;
  private backCrests: THREE.Mesh[] = [];
  private handCrest: THREE.Mesh;
  private chargeT = 0;
  charging = false;
  private throwQueued: { big: boolean; power: number } | null = null;
  private recallT = 0;
  // batons
  private batonR: RigInstance;
  private batonL: RigInstance;
  private holdR: THREE.Group;
  private holdL = new THREE.Group();
  private hipR = new THREE.Group();
  private hipL = new THREE.Group();
  private drawn = false;
  private drawT = 0;
  private staff = false;
  // melee
  move: Move | null = null;
  private lastMoveEnd = -9;
  private launchHold = false;
  private hangT = 0;
  // glide / hover
  gliding = false;
  private glideT = 0;
  private hoverY = MARK.hover;
  private hoverV = 0;
  private wasGrounded = true;
  private trailAcc = 0;
  // poses
  pose: Pose | null = null;
  private poseW = 0;
  private glideW = 0;
  private spinA = 0;
  private time = 0;
  private entrance = 0;
  // living details
  private tailPh = 0;
  private earTw = [0, 0];
  private earT = [2, 3.4];
  private earFlat = 0;
  private tailUp = 0;
  private offs: (() => void)[] = [];
  /** lunar ward (Gimme Shelter) time left: MarkSpells sets it, the pose layer and particles show it */
  wardT = 0;
  /** his spells (set by installMark); disposed with the kit */
  spells: { dispose(): void } | null = null;

  constructor(d: MarkDeps) {
    MarkKit.current = this;
    this.ctx = d.ctx;
    this.p = d.player;
    this.inp = d.input;
    const p = this.p;
    // the right baton is the player's "gun" rig (built from markBatonRig); the left is its twin
    this.batonR = p.gun;
    this.holdR = (p.gun.root.parent as THREE.Group) ?? new THREE.Group();
    this.batonL = new RigInstance(p.gun.geo, { material: p.material });
    this.holdL.rotation.x = Math.PI / 2;
    this.holdL.add(this.batonL.root);
    p.rig.attach('hand_l', this.holdL) || p.rig.nodes['fore_l']?.add(this.holdL);
    // holsters: hanging at the hips, tips down and back
    for (const [h, sock, s] of [[this.hipR, 'hip_r', -1], [this.hipL, 'hip_l', 1]] as [THREE.Group, string, number][]) {
      h.rotation.set(Math.PI * 0.86, 0, s * 0.16);
      p.rig.attach(sock, h) || p.rig.nodes['pelvis']?.add(h);
    }
    this.holster(true);
    // the crests: three on his back, one in the throwing hand while it winds up
    const cm = moonCrestModel();
    this.crestGeo = buildVoxelGeometry(cm.model, { voxelSize: cm.voxelSize, pivot: 'center' });
    this.crestMat = p.material;
    const back = p.rig.sockets['crest_back'] ?? p.rig.nodes['torso'];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(this.crestGeo, this.crestMat);
      m.castShadow = true;
      m.scale.setScalar(0.62);
      back?.add(m);
      this.backCrests.push(m);
    }
    this.layBackCrests();
    this.handCrest = new THREE.Mesh(this.crestGeo, this.crestMat);
    this.handCrest.scale.setScalar(0.8);
    this.handCrest.visible = false;
    p.rig.attach('hand_r', this.handCrest);
    // the grapple is a lash of temple linen
    (p.grappleLine.material as THREE.LineBasicMaterial).color.set(0xe6dcc4);
    // no revolver kit: no gun swaps, no long guns on his back
    const w = p.weapons;
    for (const g of ['shotgun', 'tommy'] as const) if (w.rigs[g]) w.rigs[g]!.root.visible = false;
    w.carried = ['revolver'];
    this.crestsMax = this.crestCap();
    this.crestsHand = this.crestsMax;
    p.ammo = this.crestsHand;
    this.entrance = 1;
    this.offs.push(
      this.ctx.events.on('playerHurt', () => {
        this.earFlat = 1;
        if (this.move && this.move.name !== 'slam') this.move = null;
      })
    );
  }

  private crestCap() {
    // the extra-chamber / bandolier upgrades raise the ammo stat: every two rounds is one more crest
    return clamp(MARK.crests + Math.floor((Math.round(this.p.stats.get('ammo')) - 6) / 2), 2, 6);
  }

  // ============================================================== board: floaty, glide
  preBoard(dt: number, bi: BoardInput) {
    const p = this.p, b = p.board;
    // a launcher eats the jump press until it is let go
    if (this.launchHold) {
      if (!this.inp.held('jump')) this.launchHold = false;
      bi.jumpHeld = bi.jumpPressed = bi.jumpReleased = false;
    }
    if (this.entrance > 0 && !b.grounded) bi.jumpHeld = bi.jumpPressed = bi.jumpReleased = false;
    this.hangT = Math.max(0, this.hangT - dt);
    const wantGlide = p.alive && !b.grounded && bi.jumpHeld && b.vel.y < 0.8 && !this.move && !b.grapple.active;
    if (wantGlide && !this.gliding) {
      this.ctx.sfx('whoosh_big', p.pos, 0.35, 1.5);
      this.burst(this.boardPoint(0, _v), 10, 0.8);
    }
    this.gliding = wantGlide || (this.entrance > 0.2 && !b.grounded);
    if (this.gliding) {
      this.glideT += dt;
      b.t.gravity = MARK.glideGravity;
      const fall = this.entrance > 0.5 ? -5.5 : MARK.glideFall;
      if (b.vel.y < fall) b.vel.y = damp(b.vel.y, fall, 6, dt);
      // the board carries its speed (a little lift turns fall into drive)
      const hs = Math.hypot(b.vel.x, b.vel.z);
      if (hs < MARK.glideSpeed && hs > 0.1) {
        const k = 1 + (MARK.glideSpeed - hs) * 0.04 * dt * 10;
        b.vel.x *= k;
        b.vel.z *= k;
      }
    } else {
      this.glideT = 0;
      b.t.gravity = this.hangT > 0 ? 2.5 : this.move?.name === 'slam' && this.move.phase === 0 ? 70 : MARK.gravity;
    }
  }

  // ============================================================== update (weapon + melee)
  update(dt: number) {
    const p = this.p, inp = this.inp;
    this.time += dt;
    this.crestsMax = this.crestCap();
    this.updateFlights(dt);
    this.recallT = Math.max(0, this.recallT - dt);
    this.wardT = Math.max(0, this.wardT - dt);
    if (!p.alive) {
      this.charging = false;
      this.move = null;
      p.ammo = this.crestsHand;
      return;
    }
    const busy = !!p.weapons.dig || this.entrance > 0.35;
    // --- crests
    const ads = p.aiming;
    if (inp.hit('reload')) this.recall();
    if (!busy && !this.move) {
      if (inp.hit('fire')) {
        if (this.crestsHand <= 0) this.recall();
        else if (ads) {
          this.charging = true;
          this.chargeT = 0;
          this.startPose('charge', 9);
        } else if (p.fireCd <= 0) this.beginThrow(false, 0);
      }
      if (this.charging) {
        this.chargeT += dt;
        const k = Math.min(1, this.chargeT / MARK.charge);
        if (Math.random() < dt * (8 + k * 24)) {
          const h = this.handPoint(_v);
          this.ctx.particles.emit({ pos: h, count: 1, vel: { x: 0, y: 0.6, z: 0 }, spread: 0.6 + k, life: [0.25, 0.5], size: [0.05 + k * 0.05, 0.01], sprite: ['moon1', 'dot3', 'star4'], color: MOONLIGHT, additive: true, drag: 3 });
        }
        if (!inp.held('fire') || !ads) {
          this.charging = false;
          this.beginThrow(k >= 0.98, k);
        }
      }
    } else if (this.charging && !inp.held('fire')) this.charging = false;
    p.firing = this.charging;
    p.fanning = false;
    p.ammo = this.crestsHand;
    // --- batons
    if (!busy && inp.hit('melee')) this.meleePress();
    this.updateMove(dt);
    if (this.drawn && !this.move && this.time - this.lastMoveEnd > MARK.drawFor) this.holster(false);
  }

  // ------------------------------------------------------------- crests
  private beginThrow(big: boolean, power: number) {
    if (this.crestsHand <= 0) return;
    if (this.drawn) this.holster(false);
    this.throwQueued = { big, power };
    this.startPose('throw', big ? 0.4 : 0.3);
    this.p.fireCd = MARK.throwCd / Math.max(0.5, this.p.stats.get('fireRate'));
    this.ctx.sfx('whoosh', this.p.pos, 0.5, big ? 0.8 : 1.35);
  }

  /** the crest leaves the hand (the throw pose calls this at its release point) */
  private release() {
    const q = this.throwQueued;
    this.throwQueued = null;
    if (!q || this.crestsHand <= 0) return;
    const p = this.p, ctx = this.ctx;
    this.crestsHand--;
    const o = this.handPoint(new THREE.Vector3());
    // aim like the revolver: the reticle's point, bent onto a body that is just missed
    let target = p.aimPoint.clone();
    const ro = p.ray.o, rd = p.ray.d;
    if (!p.aimHit?.enemy) {
      const md = p.magnetize(ro, rd);
      if (md) {
        const h = ctx.enemies.raycast(ro, md, 120);
        if (h) target = h.point.clone();
      }
    }
    const dir = target.sub(o);
    if (dir.lengthSq() < 0.01) dir.copy(rd);
    dir.normalize();
    const big = q.big;
    const pierce = Math.round(p.stats.get('pierce'));
    const f: Flight = {
      mesh: new THREE.Mesh(this.crestGeo, this.crestMat),
      pos: o,
      vel: dir.multiplyScalar(big ? MARK.bigSpeed : MARK.throwSpeed).add(_v.copy(p.board.vel).multiplyScalar(0.5)),
      state: 'out',
      t: 0,
      dist: 0,
      range: big ? MARK.bigRange : MARK.range,
      big,
      dmg: (big ? MARK.bigDmg : MARK.crestDmg) * (1 + q.power * 0.4),
      bounces: big ? 0 : MARK.bounces + pierce,
      hits: new Set(),
      backHits: new Set(),
      spin: 0,
      target: null,
      fx: 0,
    };
    f.mesh.scale.setScalar(big ? 1.8 : 1);
    f.mesh.castShadow = true;
    f.mesh.position.copy(f.pos);
    ctx.scene.add(f.mesh);
    this.flights.push(f);
    p.lastFireT = p.animTime;
    p.cam.punch(big ? 0.03 : 0.014, 0, big ? 2.2 : 0.8, 0);
    ctx.sfx('whoosh_big', o, big ? 0.9 : 0.55, big ? 0.7 : 1.4);
    if (big) {
      ctx.sfx('divine_power', o, 0.6, 1.3);
      ctx.fx.light(o, 0xbcd8ff, 5, 0.25, 10);
      ctx.toast('ACROSS THE UNIVERSE', '#cfe2ff');
    }
    this.burst(o, big ? 18 : 6, big ? 1.4 : 0.6);
    ctx.events.emit('shot', null, false);
  }

  /** GET BACK: every crest in the air turns home at once */
  recall() {
    let n = 0;
    for (const f of this.flights)
      if (f.state === 'out') {
        f.state = 'back';
        f.t = Math.max(f.t, 0.2);
        n++;
      }
    if (n > 0 && this.recallT <= 0) {
      this.recallT = 0.8;
      this.ctx.sfx('divine_whisper', this.p.pos, 0.5, 1.4);
      this.p.express('determined', 0.6);
      if (n >= 2) this.ctx.toast('GET BACK', '#cfe2ff');
      this.startPose('catch', 0.36);
    } else if (n === 0 && this.crestsHand <= 0 && this.flights.length === 0) this.ctx.sfx('rev_dry', this.p.pos, 0.4, 1.4);
  }

  private updateFlights(dt: number) {
    const ctx = this.ctx, p = this.p;
    const hand = this.handPoint(_v4);
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      const sp = f.vel.length();
      if (f.state === 'out') {
        // ricochet homing on the next body
        if (f.target && f.target.alive) {
          _v.set(f.target.pos.x, f.target.pos.y + f.target.height * 0.55, f.target.pos.z).sub(f.pos).normalize().multiplyScalar(sp);
          f.vel.lerp(_v, 1 - Math.exp(-dt * 14));
        }
        f.dist += sp * dt;
        if (f.dist > f.range || f.t > 1.6) f.state = 'back';
      } else {
        // home to the hand: steer, speed up
        const want = _v.copy(hand).sub(f.pos);
        const d = want.length();
        const speed = MARK.returnSpeed + Math.min(20, f.t * 8);
        want.multiplyScalar(speed / Math.max(d, 1e-3));
        f.vel.lerp(want, 1 - Math.exp(-dt * (4 + f.t * 3)));
        if (d < MARK.catchR + sp * dt || f.t > 6) {
          this.catchCrest(f);
          this.flights.splice(i, 1);
          continue;
        }
      }
      f.pos.addScaledVector(f.vel, dt);
      // the ground: skip off it and come home
      const g = ctx.world.groundAt(f.pos.x, f.pos.z);
      if (f.pos.y < g + 0.25) {
        f.pos.y = g + 0.25;
        if (f.vel.y < 0) f.vel.y = -f.vel.y * 0.4;
        if (f.state === 'out') {
          f.state = 'back';
          ctx.fx.sandBurst({ x: f.pos.x, y: g, z: f.pos.z }, 0.4);
          ctx.sfx('ricochet', f.pos, 0.45, 1.2);
        }
      }
      // bodies
      const r = f.big ? MARK.bigR : MARK.hitR;
      const set = f.state === 'out' ? f.hits : f.backHits;
      ctx.enemies.inRadius(f.pos, r, (e) => {
        if (set.has(e.id) || !e.alive) return;
        set.add(e.id);
        this.crestHit(f, e);
      });
      // spin, tilt along the flight, light
      f.spin += dt * (f.big ? 26 : 34);
      f.mesh.position.copy(f.pos);
      _v2.copy(f.vel).normalize();
      f.mesh.quaternion.setFromAxisAngle(UP, f.spin);
      _q.setFromUnitVectors(UP, _v3.set(-_v2.z * 0.25, 1, _v2.x * 0.25).normalize());
      f.mesh.quaternion.premultiply(_q);
      f.fx += dt * (f.big ? 60 : 30);
      while (f.fx >= 1) {
        f.fx -= 1;
        ctx.particles.emit({ pos: f.pos, count: 1, vel: { x: -f.vel.x * 0.05, y: 0.2, z: -f.vel.z * 0.05 }, spread: 0.3, jitter: f.big ? 0.4 : 0.15, life: [0.22, 0.5], size: [f.big ? 0.12 : 0.07, 0.01], sprite: ['moon1', 'moon0', 'dot3', 'star4'], color: MOONLIGHT, additive: true, drag: 2.5 });
      }
    }
    void p;
  }

  private crestHit(f: Flight, e: EnemyLike) {
    const ctx = this.ctx;
    const dir = _v.copy(f.vel).setY(0).normalize();
    const at = new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.55, e.pos.z);
    const was = e.alive;
    const back = f.state === 'back';
    ctx.enemies.damage(e, { base: f.dmg * (back ? MARK.returnMul : 1), kind: 'phys', source: 'gun', knock: f.big ? 5 : 1.6, dirX: dir.x, dirZ: dir.z, canCrit: true, status: [{ id: 'bleed', stacks: 1, dur: 3, chance: 0.35 }], tags: ['crest'] }, at, dir.clone());
    ctx.fx.hit(at, { x: -dir.x, y: 0.4, z: -dir.z }, 'armor', f.big ? 1.2 : 0.7);
    ctx.particles.emit({ pos: at, count: f.big ? 14 : 7, spread: 3.5, life: [0.15, 0.35], size: [0.07, 0.015], sprite: 'spark', color: MOONLIGHT, additive: true, stretch: 0.04, drag: 3 });
    ctx.sfx('counter_clang', at, 0.4, 1.7 + Math.random() * 0.2);
    ctx.sfx('hit_flesh', at, 0.45);
    this.p.shotFeedback({ enemy: e, t: 1, point: at, normal: new THREE.Vector3(0, 1, 0), headshot: false, part: '', surface: 'enemy' }, was && !e.alive, false, null, dir, 0.6);
    if (f.state === 'out' && !f.big) {
      if (f.bounces > 0) {
        f.bounces--;
        const next = ctx.enemies.nearest(f.pos, MARK.ricochet, (o) => o !== e && !f.hits.has(o.id));
        if (next) {
          f.target = next;
          f.dist = Math.min(f.dist, f.range - MARK.ricochet - 2);
          ctx.sfx('ricochet', at, 0.5, 1.4);
          return;
        }
      }
      f.state = 'back';
      f.target = null;
      f.vel.multiplyScalar(-0.35);
    }
  }

  private catchCrest(f: Flight) {
    f.mesh.removeFromParent();
    this.crestsHand = Math.min(this.crestsMax, this.crestsHand + 1);
    const h = this.handPoint(_v);
    this.ctx.sfx('counter_clang', h, 0.25, 2.1);
    this.ctx.particles.emit({ pos: h, count: 6, spread: 1.4, life: [0.15, 0.3], size: [0.06, 0.01], sprite: ['moon1', 'star4'], color: MOONLIGHT, additive: true, drag: 3 });
    if (!this.pose || this.pose.name !== 'throw') this.startPose('catch', 0.28);
    this.p.ammo = this.crestsHand;
  }

  // ------------------------------------------------------------- batons
  /** batons in hand (drawn) or hanging at the hips */
  private holster(force: boolean) {
    if (!this.drawn && !force) return;
    this.drawn = false;
    this.couple(false);
    this.hipR.add(this.batonR.root);
    this.hipL.add(this.batonL.root);
    this.batonR.root.position.set(0, 0, 0);
    this.batonL.root.position.set(0, 0, 0);
    this.batonR.root.quaternion.identity();
    this.batonL.root.quaternion.identity();
  }
  private draw() {
    if (this.drawn) return;
    this.drawn = true;
    this.holdR.add(this.batonR.root);
    this.holdL.add(this.batonL.root);
    this.batonR.root.position.set(0, 0, 0);
    this.batonL.root.position.set(0, 0, 0);
    this.batonR.root.quaternion.identity();
    this.batonL.root.quaternion.identity();
    this.ctx.sfx('rev_spin', this.p.pos, 0.35, 1.5);
    this.burst(this.handPoint(_v), 5, 0.4);
  }
  /** the staff: the left baton couples pommel to pommel onto the right one */
  private couple(on: boolean) {
    if (on === this.staff) return;
    this.staff = on;
    const L = this.batonL.root;
    if (on) {
      this.batonR.root.add(L);
      L.position.set(0, -0.232, 0);
      L.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
      this.ctx.sfx('rev_close', this.p.pos, 0.4, 1.4);
    } else {
      this.holdL.add(L);
      L.position.set(0, 0, 0);
      L.quaternion.identity();
    }
  }

  private meleePress() {
    const p = this.p, b = p.board;
    const mv = this.move;
    if (mv) {
      // buffer the next hit of the string
      if (NEXT[mv.name] && mv.t > mv.def.dur * 0.35) mv.queued = true;
      return;
    }
    let name: MoveName;
    const sinceEnd = this.time - this.lastMoveEnd;
    const last = this.lastName;
    if (b.grounded && this.inp.held('jump')) name = 'launch';
    else if (!b.grounded) name = sinceEnd < MARK.window && last && NEXT[last] && last.startsWith('a') ? NEXT[last]! : 'a1';
    else name = sinceEnd < MARK.window && last && NEXT[last] && last.startsWith('m') ? NEXT[last]! : 'm1';
    this.startMove(name);
  }
  private lastName: MoveName | null = null;

  private startMove(name: MoveName) {
    const p = this.p, b = p.board;
    this.draw();
    const def = MOVES[name];
    const dir = this.attackDir(new THREE.Vector3());
    this.move = { name, def, t: 0, hit: false, dir, queued: false, phase: 0 };
    this.lastName = name;
    this.couple(!!def.staff);
    p.meleeCd = 0.55; // HUD key sweep
    this.ctx.sfx('melee_whoosh', p.pos, 0.7, name === 'm4' || name === 'slam' ? 0.8 : 1.1 + Math.random() * 0.1);
    if (def.name) this.ctx.toast(def.name.toUpperCase(), '#cfe2ff');
    // a little lunge carries the string forward; in the air every hit hangs him there
    if (b.grounded) {
      b.impulse.x += dir.x * (name === 'm4' ? 0.8 : 2.0);
      b.impulse.z += dir.z * (name === 'm4' ? 0.8 : 2.0);
    } else if (name !== 'slam') {
      this.hangT = 0.34;
      if (b.vel.y < 1.5) b.vel.y = 1.5;
      b.vel.x *= 0.8;
      b.vel.z *= 0.8;
    }
    if (name === 'launch') {
      this.launchHold = true;
      b.jumpCharge = 0;
    }
    if (name === 'slam') {
      b.vel.y = Math.max(b.vel.y, 5);
      this.hangT = 0.18;
    }
    p.express(name === 'm4' || name === 'slam' ? 'angry' : 'determined', 0.6);
  }

  private updateMove(dt: number) {
    const mv = this.move;
    if (!mv) return;
    const p = this.p, b = p.board, ctx = this.ctx;
    mv.t += dt;
    // the slam dives once its wind-up is over, and lands where it lands
    if (mv.name === 'slam') {
      if (mv.phase === 0 && mv.t > 0.18) {
        b.vel.y = Math.min(b.vel.y, -26);
        if (b.grounded || mv.t > 1.4) {
          mv.phase = 1;
          mv.t = Math.max(mv.t, 0.6);
          this.slamImpact();
        }
      }
      if (mv.phase === 0 && b.grounded && mv.t > 0.2) {
        mv.phase = 1;
        mv.t = 0.6;
        this.slamImpact();
      }
    } else if (!mv.hit && mv.t >= mv.def.hitAt) {
      mv.hit = true;
      this.strike(mv);
    }
    const dur = mv.name === 'slam' ? (mv.phase ? mv.def.dur : 9) : mv.def.dur;
    if (mv.t >= dur) {
      this.move = null;
      this.lastMoveEnd = this.time;
      this.couple(false);
      if (mv.queued && NEXT[mv.name] && p.alive) {
        const nx = NEXT[mv.name]!;
        // a grounded string that took off continues in the air, and the other way round
        const air = !b.grounded;
        this.startMove(nx.startsWith('a') === air ? nx : air ? 'a1' : 'm1');
      }
    }
    void ctx;
  }

  private strike(mv: Move) {
    const p = this.p, ctx = this.ctx, def = mv.def;
    const c = p.center(new THREE.Vector3());
    if (def.shared) {
      // the shared opener: Enemies' kick resolve (damage, counters, deflected bullets)
      ctx.events.emit('melee', p);
      this.swingFx(mv, c);
      return;
    }
    const verbs = ctx.enemies as unknown as { knockdown?: (e: EnemyLike, dx: number, dz: number, src?: string) => void; stagger?: (e: EnemyLike, d?: number) => void };
    const front = def.round ? c : _v.copy(c).addScaledVector(mv.dir, 1.1);
    let hits = 0;
    ctx.enemies.inRadius(front, def.reach, (e) => {
      const dx = e.pos.x - c.x, dz = e.pos.z - c.z;
      const dl = Math.hypot(dx, dz) || 1;
      if (!def.round && (dx * mv.dir.x + dz * mv.dir.z) / dl < -0.1 && dl > 1.2) return;
      const at = new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.6, e.pos.z);
      ctx.enemies.damage(e, { base: def.dmg, kind: 'phys', source: 'melee', knock: def.knock, dirX: dx / dl, dirZ: dz / dl, canCrit: true, status: [{ id: 'stun', stacks: 1, dur: 0.3, chance: 0.4 }] }, at, new THREE.Vector3(dx / dl, 0, dz / dl));
      const en = e as EnemyLike & { vel?: THREE.Vector3; state?: string; stateT?: number };
      if (mv.name === 'launch' || mv.name === 'm4') {
        if (e.alive && !e.isBoss) {
          verbs.knockdown?.(e, dx / dl, dz / dl, 'melee');
          if (mv.name === 'launch' && en.vel) en.vel.y = Math.max(en.vel.y, 9.5);
        }
      } else if (mv.name.startsWith('a') && en.vel && e.alive && !e.isBoss && en.state === 'down') {
        // juggle: keep it up there
        en.vel.y = Math.max(en.vel.y, 4.2);
        if (en.stateT !== undefined) en.stateT = Math.min(en.stateT, 0.1);
      } else if (e.alive) verbs.stagger?.(e, 0.35);
      ctx.fx.hit(at, { x: -dx / dl, y: 0.5, z: -dz / dl }, 'flesh', 0.8);
      ctx.particles.emit({ pos: at, count: 8, spread: 4, life: [0.12, 0.3], size: [0.06, 0.012], sprite: 'spark', color: MOONLIGHT, additive: true, stretch: 0.03, drag: 3 });
      hits++;
    });
    this.swingFx(mv, c);
    if (hits > 0) {
      ctx.sfx(def.knock > 6 ? 'kick' : 'punch', c, 0.8, 1 + Math.random() * 0.1);
      ctx.sfx('counter_clang', c, 0.3, 1.5);
      ctx.engine.hitStop(def.knock > 6 ? 0.07 : 0.035);
      ctx.shake(def.knock > 6 ? 0.3 : 0.14);
      p.reticle.hit = 1;
    }
    if (mv.name === 'launch') {
      // he goes up after them
      const b = p.board;
      b.vel.y = 10.2;
      b.grounded = false;
      b.pos.y += 0.06;
      b.airTime = 0;
      this.hangT = 0;
      ctx.sfx('board_jump', p.pos, 0.9, 1.2);
      ctx.fx.sandBurst(p.pos, 0.9);
    }
  }

  private slamImpact() {
    const p = this.p, ctx = this.ctx;
    const g = ctx.world.groundAt(p.pos.x, p.pos.z);
    const at = new THREE.Vector3(p.pos.x, g + 0.3, p.pos.z);
    const verbs = ctx.enemies as unknown as { knockdown?: (e: EnemyLike, dx: number, dz: number, src?: string) => void };
    ctx.enemies.inRadius(at, MOVES.slam.reach, (e) => {
      const dx = e.pos.x - at.x, dz = e.pos.z - at.z;
      const dl = Math.hypot(dx, dz) || 1;
      ctx.enemies.damage(e, { base: MOVES.slam.dmg, kind: 'phys', source: 'melee', knock: 10, dirX: dx / dl, dirZ: dz / dl, canCrit: true, status: [{ id: 'stun', stacks: 1, dur: 0.8 }] }, undefined, new THREE.Vector3(dx / dl, 0, dz / dl));
      if (e.alive && !e.isBoss) verbs.knockdown?.(e, dx / dl, dz / dl, 'explosion');
    });
    ctx.fx.ring({ x: at.x, y: at.y, z: at.z }, 0xcfe2ff, 7, 0.5);
    ctx.fx.sandBurst(at, 1.8);
    ctx.fx.light(at, 0xbcd8ff, 7, 0.3, 12);
    ctx.particles.emit({ pos: at, count: 40, vel: { x: 0, y: 3, z: 0 }, spread: 9, life: [0.3, 0.8], size: [0.1, 0.02], sprite: ['moon0', 'moon1', 'spark', 'dot3'], color: MOONLIGHT, additive: true, drag: 2.2, gravity: 4 });
    ctx.events.emit('groundMark', at.x, at.z, 3.5, 2);
    ctx.sfx('explosion', at, 0.7, 1.3);
    ctx.sfx('kick', at, 1, 0.75);
    ctx.shake(0.5);
    ctx.engine.hitStop(0.08);
    p.cam.punch(0.04, 0, -3, 0);
  }

  /** a pixel smear and moonlight along the swing */
  private swingFx(mv: Move, c: THREE.Vector3) {
    const at = _v2.copy(c).addScaledVector(mv.dir, 1.0);
    this.p.smear(at, mv.def.round ? 2.2 : 1.4);
    this.ctx.particles.emit({ pos: at, count: 6, vel: { x: mv.dir.x * 3, y: 0.5, z: mv.dir.z * 3 }, spread: 2, life: [0.15, 0.35], size: [0.06, 0.01], sprite: ['moon1', 'dot3'], color: MOONLIGHT, additive: true, drag: 3 });
  }

  /** where an attack goes: the view, eased onto the nearest foe in front within reach */
  private attackDir(out: THREE.Vector3) {
    const p = this.p;
    const cf = p.cam.forward();
    out.set(cf.x, 0, cf.z).normalize();
    const e = this.ctx.enemies.nearest(p.pos, 4.5, (o) => {
      const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      return (dx * out.x + dz * out.z) / dl > 0.35;
    });
    if (e) out.set(e.pos.x - p.pos.x, 0, e.pos.z - p.pos.z).normalize();
    return out;
  }

  // ============================================================== HUD
  hud(): WeaponHud {
    return {
      id: 'revolver',
      name: 'Moon Crests',
      ammo: this.crestsHand,
      mag: this.crestsMax,
      kind: 'crest',
      reloading: false,
      swap: 0,
      carried: [],
      crest: {
        hand: this.crestsHand,
        max: this.crestsMax,
        out: this.flights.map((f) => (f.state === 'out' ? 1 : 2)),
        charge: this.charging ? Math.min(1, this.chargeT / MARK.charge) : 0,
        recall: this.recallT,
      },
    };
  }

  // ============================================================== pose layer
  startPose(name: PoseName, dur: number, aim?: THREE.Vector3) {
    this.pose = { name, t: 0, dur, aim: (aim ?? this.p.aimPoint).clone() };
  }

  post(dt: number, pa: PlayerAnim) {
    const p = this.p;
    const b = p.board;
    const t = this.time;
    // the shared animation turns the "gun" (his right baton) like a revolver: he holds it his own way
    this.batonR.root.quaternion.identity();
    // --- the entrance: he drops out of the sky onto the board in a burst of moonlight
    if (this.entrance === 1) {
      this.entrance = 0.999;
      b.pos.y += 7;
      b.vel.set(0, -1.5, 0);
      b.grounded = false;
      b.airTime = 0;
      p.invuln = Math.max(p.invuln, 2);
      this.burst(_v.copy(b.pos).add(_v2.set(0, 1, 0)), 30, 2);
      this.ctx.fx.light(b.pos, 0xbcd8ff, 6, 0.6, 14);
      this.ctx.sfx('divine_whisper', b.pos, 0.6, 1.2);
    }
    if (this.entrance > 0) {
      if (b.grounded && this.entrance > 0.5) {
        this.entrance = 0.5;
        this.startPose('land', 1.1);
        this.ctx.fx.ring({ x: b.pos.x, y: b.pos.y + 0.1, z: b.pos.z }, 0xcfe2ff, 6, 0.6);
        this.burst(b.pos, 24, 2.5);
        this.ctx.sfx('divine_power', b.pos, 0.5, 1.3);
        p.express('smug', 1.4);
      } else if (this.entrance <= 0.5) this.entrance = Math.max(0, this.entrance - dt * 0.45);
    }
    // --- hover over the sand / water on the board's light (a soft spring, dips on landings)
    const target = MARK.hover + Math.sin(t * 2.3) * 0.025 + Math.min(0.08, b.speed * 0.004);
    if (b.grounded && !this.wasGrounded) this.hoverV -= 1.6;
    this.wasGrounded = b.grounded;
    this.hoverV += ((target - this.hoverY) * 90 - this.hoverV * 11) * dt;
    this.hoverY += this.hoverV * dt;
    p.root.position.y += this.hoverY;
    this.trail(dt);
    // --- weights
    const pz = this.pose;
    if (pz) {
      pz.t += dt;
      if (pz.name === 'throw' && this.throwQueued && pz.t >= pz.dur * 0.42) this.release();
      if ((pz.t >= pz.dur && !(pz.name === 'charge' && this.charging)) || (pz.name === 'charge' && !this.charging)) this.pose = null;
    }
    this.poseW = damp(this.poseW, this.pose ? 1 : 0, this.pose ? 22 : 8, dt);
    this.glideW = damp(this.glideW, this.gliding && !this.move ? 1 : 0, this.gliding ? 7 : 5, dt);
    // --- the staff spin turns the whole body on the board
    const mv = this.move;
    let spin = 0;
    if (mv && mv.name === 'm4') spin = smoothK(mv.t / mv.def.dur, 0.1, 0.8) * TAU;
    if (mv && mv.name === 'slam' && mv.phase === 0) spin = 0;
    this.spinA = spin;
    p.stance.rotation.y = -Math.PI / 2 + spin;
    if (spin) p.stance.updateMatrixWorld(true);
    if (!p.alive) {
      this.living(dt, pa);
      return;
    }
    // --- move / pose / glide arm targets
    if (mv) this.poseMove(mv, pa);
    else if (pz) this.posePose(pz, pa);
    if (this.glideW > 0.01) this.poseGlide(pa, this.glideW * (1 - (pz ? this.poseW : 0)));
    if (this.wardT > 0) this.wardFx(dt);
    this.living(dt, pa);
    // the hand crest shows while a throw winds up
    this.handCrest.visible = !!pz && (pz.name === 'charge' || (pz.name === 'throw' && !!this.throwQueued));
    if (this.handCrest.visible) {
      const k = pz!.name === 'charge' ? Math.min(1, this.chargeT / MARK.charge) : 0;
      this.handCrest.scale.setScalar(0.8 + k * 0.5);
      this.handCrest.rotation.set(Math.PI / 2, t * (2 + k * 12), 0.3);
    }
    this.layBackCrests();
    // the grapple lash leaves from the right hand
    this.handPoint(p.muzzleWorld);
  }

  /** the three crests fanned on his back like a halo, as many as are in hand */
  private layBackCrests() {
    const n = this.crestsMax;
    const showing = this.crestsHand - (this.handCrest?.visible ? 1 : 0);
    for (let i = 0; i < this.backCrests.length; i++) {
      const m = this.backCrests[i];
      m.visible = i < Math.min(n, showing);
      if (!m.visible) continue;
      const a = (n === 1 ? 0 : (i / (n - 1) - 0.5)) * 1.5;
      m.position.set(Math.sin(a) * 0.14, Math.cos(a) * 0.14 - 0.04, -0.03 - Math.abs(a) * 0.015);
      // stand each crescent up (plane facing back), horns pointing out from the boss
      m.rotation.set(-Math.PI / 2, 0, 0);
      m.rotateOnWorldAxis(_v.set(0, 0, 1), 0);
      m.rotateY(-a + Math.PI / 2);
    }
  }

  // ------------------------------------------------------------- arm IK helpers
  /** world target -> the arm's IK, blended in by w (pole and baton direction in world) */
  private armTo(side: 1 | -1, pa: PlayerAnim, target: THREE.Vector3, pole: THREE.Vector3, bat: THREE.Vector3, w: number) {
    if (w <= 0.002) return;
    const n = this.p.rig.nodes;
    const arm = n[side > 0 ? 'arm_l' : 'arm_r'], fore = n[side > 0 ? 'fore_l' : 'fore_r'], torso = n['torso'];
    if (!arm || !fore || !torso) return;
    torso.updateWorldMatrix(true, false);
    _m.copy(torso.matrixWorld).invert();
    const T = _a.copy(target).applyMatrix4(_m);
    const P = _b.copy(pole).transformDirection(_m);
    const H = _c.copy(bat).transformDirection(_m);
    armIK(side > 0 ? pa.shL : pa.shR, T, P, pa.l1Arm, pa.l2Arm, H, _qa, _qb);
    arm.quaternion.slerp(_qa, w);
    fore.quaternion.slerp(_qb, w);
  }
  /** turn the chest to face a world direction (pitch: lean in, roll: tilt) */
  private faceTorso(dir: THREE.Vector3, pitch: number, roll: number, w: number) {
    const torso = this.p.rig.nodes['torso'];
    if (!torso?.parent || w <= 0.002) return;
    _q.setFromEuler(_e.set(pitch, Math.atan2(dir.x, dir.z), roll, 'YXZ'));
    torso.parent.getWorldQuaternion(_q2).invert();
    _q.premultiply(_q2);
    torso.quaternion.slerp(_q, w);
    torso.updateWorldMatrix(true, true);
  }
  /** a point in the attack frame (fwd, up, left from the chest) -> world */
  private framePt(c: THREE.Vector3, f: THREE.Vector3, fwd: number, up: number, left: number, out: THREE.Vector3) {
    const lx = f.z, lz = -f.x; // left = up x fwd
    return out.set(c.x + f.x * fwd + lx * left, c.y + up, c.z + f.z * fwd + lz * left);
  }

  private chest(out: THREE.Vector3) {
    const torso = this.p.rig.nodes['torso'];
    if (torso) return torso.getWorldPosition(out).add(_v3.set(0, 0.36, 0));
    return this.p.center(out).add(_v3.set(0, 0.25, 0));
  }

  private poseMove(mv: Move, pa: PlayerAnim) {
    const k = clamp(mv.t / mv.def.dur, 0, 1);
    const w = smoothK(k, 0, 0.1) * (1 - smoothK(k, 0.82, 1)) * 0.95 + 0.05;
    const f = _v.copy(mv.dir);
    if (this.spinA) f.applyAxisAngle(UP, this.spinA);
    const c = this.chest(new THREE.Vector3());
    const tR = new THREE.Vector3(), tL = new THREE.Vector3();
    const poleR = new THREE.Vector3(), poleL = new THREE.Vector3();
    const batR = new THREE.Vector3(), batL = new THREE.Vector3();
    const left = _v2.set(f.z, 0, -f.x);
    const right = new THREE.Vector3(-left.x, 0, -left.z);
    const e = easeOut(clamp((k - 0.05) / 0.5, 0, 1));
    let lean = 0.15, roll = 0, wl = w, wr = w;
    const arc = (out: THREE.Vector3, a: [number, number, number], m: [number, number, number], b: [number, number, number], u: number) => {
      const iu = 1 - u;
      return this.framePt(c, f, iu * iu * a[0] + 2 * iu * u * m[0] + u * u * b[0], iu * iu * a[1] + 2 * iu * u * m[1] + u * u * b[1], iu * iu * a[2] + 2 * iu * u * m[2] + u * u * b[2], out);
    };
    const radial = (out: THREE.Vector3, hand: THREE.Vector3, tilt: number) => out.copy(hand).sub(_v3.copy(c).addScaledVector(f, -0.25)).setY((hand.y - c.y) + tilt).normalize();
    switch (mv.name) {
      case 'm1':
      case 'a1':
        arc(tR, [0.05, 0.42, -0.48], [0.62, 0.22, -0.12], [0.4, -0.22, 0.34], e);
        radial(batR, tR, 0.2);
        this.framePt(c, f, 0.1, -0.15, 0.4, tL);
        batL.copy(f);
        roll = -0.25 * (1 - e) + 0.2 * e;
        break;
      case 'm2':
      case 'a2':
        arc(tL, [0.05, 0.38, 0.5], [0.64, 0.18, 0.1], [0.38, -0.12, -0.38], e);
        radial(batL, tL, 0.2);
        this.framePt(c, f, 0.15, -0.1, -0.4, tR);
        batR.copy(f);
        roll = 0.25 * (1 - e) - 0.2 * e;
        break;
      case 'm3':
      case 'a3':
        arc(tR, [0.0, 0.56, -0.3], [0.55, 0.3, 0.0], [0.45, -0.25, 0.3], e);
        arc(tL, [0.0, 0.56, 0.3], [0.55, 0.3, 0.0], [0.45, -0.25, -0.3], e);
        radial(batR, tR, 0.3);
        radial(batL, tL, 0.3);
        lean = 0.35 * e;
        break;
      case 'm4': {
        // the staff held level across the chest while the body spins
        this.framePt(c, f, 0.42, 0.0, -0.12, tR);
        this.framePt(c, f, 0.42, 0.02, 0.26, tL);
        batR.copy(left);
        batL.copy(f);
        lean = 0.25;
        break;
      }
      case 'launch':
        arc(tR, [0.1, -0.45, -0.3], [0.45, 0.0, -0.05], [0.25, 0.75, 0.05], e);
        this.framePt(c, f, 0.2 + 0.1 * e, -0.3 + 0.8 * e, 0.12, tL);
        batR.copy(f).multiplyScalar(0.4).add(UP).normalize();
        batL.copy(f);
        lean = -0.25 * e + 0.2;
        break;
      case 'slam': {
        const dive = mv.phase === 0;
        const u = dive ? clamp(mv.t / 0.18, 0, 1) : 1;
        if (dive) {
          this.framePt(c, f, 0.05, 0.62 * u + 0.1, -0.05, tR);
          this.framePt(c, f, 0.05, 0.5 * u, 0.2, tL);
          batR.copy(f).multiplyScalar(-0.5).add(UP).normalize();
          lean = -0.2;
        } else {
          this.framePt(c, f, 0.6, -0.55, -0.05, tR);
          this.framePt(c, f, 0.45, -0.3, 0.2, tL);
          batR.copy(f).multiplyScalar(0.3).sub(UP).normalize();
          lean = 0.6;
        }
        batL.copy(f);
        break;
      }
    }
    poleR.copy(right).multiplyScalar(0.8).addScaledVector(f, -0.6).add(_v3.set(0, -0.4, 0));
    poleL.copy(left).multiplyScalar(0.8).addScaledVector(f, -0.6).add(_v3.set(0, -0.4, 0));
    this.faceTorso(f, lean, roll, w * 0.85);
    this.armTo(-1, pa, tR, poleR, batR, wr);
    if (this.staff) {
      // the left hand on the staff, a forearm below the right one
      const tip = this.batonR.root;
      tip.updateWorldMatrix(true, false);
      tL.set(0, -0.3, 0).applyMatrix4(tip.matrixWorld);
      batL.set(0, -1, 0).transformDirection(tip.matrixWorld).negate();
    }
    this.armTo(1, pa, tL, poleL, batL, wl);
  }

  private posePose(pz: Pose, pa: PlayerAnim) {
    const p = this.p;
    const k = clamp(pz.t / pz.dur, 0, 1);
    const w = this.poseW;
    const c = this.chest(new THREE.Vector3());
    const f = _v.copy(pz.aim).sub(c).setY(0);
    if (f.lengthSq() < 1e-4) {
      const cf = p.cam.forward();
      f.set(cf.x, 0, cf.z);
    }
    f.normalize();
    const left = _v2.set(f.z, 0, -f.x);
    const tR = new THREE.Vector3(), tL = new THREE.Vector3(), batR = new THREE.Vector3(), batL = new THREE.Vector3();
    const poleR = new THREE.Vector3(-left.x, -0.5, -left.z).addScaledVector(f, -0.5);
    const poleL = new THREE.Vector3(left.x, -0.5, left.z).addScaledVector(f, -0.5);
    let lean = 0.1, roll = 0, wl = 0, wr = w;
    switch (pz.name) {
      case 'charge': {
        // crest drawn back past the ear, the other hand sighting along the line
        const q = Math.min(1, this.chargeT / MARK.charge);
        this.framePt(c, f, -0.28 - q * 0.08, 0.32 + q * 0.06, -0.42, tR);
        this.framePt(c, f, 0.48, 0.12, 0.08, tL);
        batR.copy(f);
        batL.copy(f);
        wl = w;
        roll = 0.15;
        break;
      }
      case 'throw': {
        // wind back, whip through the release, follow across the body
        const u = easeOut(k);
        const a: [number, number, number] = [-0.3, 0.3, -0.42], m: [number, number, number] = [0.62, 0.2, -0.18], e: [number, number, number] = [0.42, -0.2, 0.32];
        const iu = 1 - u;
        this.framePt(c, f, iu * iu * a[0] + 2 * iu * u * m[0] + u * u * e[0], iu * iu * a[1] + 2 * iu * u * m[1] + u * u * e[1], iu * iu * a[2] + 2 * iu * u * m[2] + u * u * e[2], tR);
        batR.copy(f);
        roll = -0.3 + u * 0.5;
        lean = 0.1 + u * 0.2;
        break;
      }
      case 'catch': {
        const u = Math.sin(k * Math.PI);
        this.framePt(c, f, 0.35 + u * 0.15, 0.25 + u * 0.2, -0.3, tR);
        batR.copy(f);
        wr = w * (0.6 + 0.4 * u);
        break;
      }
      case 'beam': {
        // one hand to the sky, then both drive down at the mark
        const up = k < 0.45;
        this.framePt(c, f, up ? 0.1 : 0.55, up ? 0.85 : 0.1, -0.25, tR);
        this.framePt(c, f, up ? 0.05 : 0.5, up ? 0.75 : 0.05, 0.25, tL);
        batR.copy(up ? UP : f);
        batL.copy(up ? UP : f);
        wl = w;
        lean = up ? -0.2 : 0.3;
        break;
      }
      case 'dash':
        this.framePt(c, f, -0.45, -0.05, -0.35, tR);
        this.framePt(c, f, -0.45, -0.05, 0.35, tL);
        batR.copy(f).negate();
        batL.copy(f).negate();
        wl = w;
        lean = 0.55;
        break;
      case 'rain':
        this.framePt(c, f, 0.2, 0.9 - k * 0.2, -0.15, tR);
        this.framePt(c, f, 0.25, 0.05, 0.15, tL);
        batR.copy(UP);
        batL.copy(f);
        wl = w * 0.8;
        lean = -0.15;
        break;
      case 'ward':
        this.framePt(c, f, 0.32, 0.22, 0.12, tR);
        this.framePt(c, f, 0.32, 0.24, -0.12, tL);
        batR.copy(UP);
        batL.copy(UP);
        wl = w;
        lean = 0.2;
        break;
      case 'ult':
        this.framePt(c, f, 0.1, 0.85, -0.3, tR);
        this.framePt(c, f, 0.1, 0.85, 0.3, tL);
        batR.copy(UP);
        batL.copy(UP);
        wl = w;
        lean = -0.35;
        break;
      case 'land': {
        // the drop-in: one hand to the deck, then up with the batons crossed
        const down = k < 0.45;
        const g = p.board.pos.y + 0.25;
        if (down) {
          tR.copy(c).addScaledVector(f, 0.35).addScaledVector(left, -0.15).setY(g + 0.1);
          this.framePt(c, f, -0.2, 0.1, 0.6, tL);
          batR.copy(f);
          batL.copy(left);
          lean = 0.7;
        } else {
          this.framePt(c, f, 0.3, 0.32, 0.1, tR);
          this.framePt(c, f, 0.3, 0.3, -0.1, tL);
          batR.copy(UP).addScaledVector(left, 0.6).normalize();
          batL.copy(UP).addScaledVector(left, -0.6).normalize();
          if (!this.drawn) this.draw();
          this.lastMoveEnd = this.time;
          lean = 0.05;
        }
        wl = w;
        break;
      }
    }
    this.faceTorso(f, lean, roll, w * 0.8);
    this.armTo(-1, pa, tR, poleR, batR, wr);
    this.armTo(1, pa, tL, poleL, batL, wl);
  }

  /** gliding: arms spread back like wings, chest forward, head up */
  private poseGlide(pa: PlayerAnim, w: number) {
    const p = this.p;
    const c = this.chest(new THREE.Vector3());
    const v = _v.copy(p.board.vel).setY(0);
    if (v.lengthSq() < 0.5) {
      const cf = p.cam.forward();
      v.set(cf.x, 0, cf.z);
    }
    v.normalize();
    const left = _v2.set(v.z, 0, -v.x);
    const flap = Math.sin(this.time * 3.1) * 0.04;
    const tR = this.framePt(c, v, -0.22, 0.02 + flap, -0.62, new THREE.Vector3());
    const tL = this.framePt(c, v, -0.22, 0.02 - flap, 0.62, new THREE.Vector3());
    this.faceTorso(v, 0.32, 0, w * 0.7);
    this.armTo(-1, pa, tR, new THREE.Vector3(-left.x, 0.6, -left.z), v.clone().negate(), w);
    this.armTo(1, pa, tL, new THREE.Vector3(left.x, 0.6, left.z), v.clone().negate(), w);
  }

  // ------------------------------------------------------------- tail, ears, eyes
  private living(dt: number, pa: PlayerAnim) {
    const p = this.p, n = p.rig.nodes, b = p.board, t = this.time;
    const alive = p.alive;
    const sp = clamp(b.speed / 20, 0, 1.2);
    const angry = p.rig.expression === 'angry' || p.rig.expression === 'determined' || !!this.move;
    this.tailUp = damp(this.tailUp, !alive ? -0.6 : b.grounded ? 0.15 + sp * 0.35 : 0.65, 4, dt);
    this.tailPh += dt * (angry ? 6.5 : 2.1 + sp * 3);
    for (let i = 1; i <= 6; i++) {
      const s = n['tail' + i];
      if (!s) continue;
      const amp = (angry ? 0.28 : 0.16) * (0.5 + i * 0.12);
      s.rotation.set(
        (i === 1 ? this.tailUp * 0.8 : this.tailUp * 0.12) + Math.sin(this.tailPh * 0.7 - i * 0.5) * 0.05,
        Math.sin(this.tailPh - i * 0.62) * amp * (alive ? 1 : 0.1) - (this.spinA ? 0.4 : 0),
        Math.sin(this.tailPh * 0.5 - i * 0.4) * 0.06
      );
    }
    // ears: perk at a target, flatten when hurt or fighting, idle twitches
    this.earFlat = Math.max(0, this.earFlat - dt * 1.4);
    const flat = Math.max(this.earFlat, this.move ? 0.45 : 0, !alive ? 0.8 : 0) - (p.aiming ? 0.3 : 0);
    for (let s = 0; s < 2; s++) {
      this.earT[s] -= dt;
      if (this.earT[s] <= 0) {
        this.earT[s] = 1.5 + Math.random() * 4;
        this.earTw[s] = 1;
      }
      this.earTw[s] = Math.max(0, this.earTw[s] - dt * 7);
      const e = n[s ? 'ear_r' : 'ear_l'];
      if (!e) continue;
      const side = s ? -1 : 1;
      const tw = Math.sin(this.earTw[s] * Math.PI * 3) * this.earTw[s] * 0.35;
      e.rotation.set(-flat * 0.75 - sp * 0.25, side * (flat * 0.4 + tw * 0.5), -side * (flat * 0.55 + tw));
    }
    // eyes follow the aim a little
    const head = n['head'];
    if (head && alive) {
      head.updateWorldMatrix(true, false);
      const lp = _v.copy(p.aimPoint);
      head.worldToLocal(lp);
      const yaw = clamp(Math.atan2(lp.x, lp.z), -0.35, 0.35), pitch = clamp(-Math.atan2(lp.y - 0.12, Math.hypot(lp.x, lp.z)), -0.2, 0.2);
      for (const nm of ['eye_l', 'eye_r']) n[nm]?.rotation.set(pitch * 0.6, yaw * 0.6, 0);
    }
    void pa;
  }

  // ------------------------------------------------------------- moonlight
  private boardPoint(along: number, out: THREE.Vector3) {
    const b = this.p.board;
    return out.set(b.pos.x + Math.sin(b.heading) * along, b.pos.y + this.hoverY + 0.02, b.pos.z + Math.cos(b.heading) * along);
  }
  /** pixel moonlight shed by the board: a thin wake on the ground, streams from both horns while gliding */
  private trail(dt: number) {
    const p = this.p, b = p.board, P = this.ctx.particles;
    const sp = b.speed;
    this.trailAcc += dt * (this.gliding ? 46 : sp > 2 ? 6 + sp * 1.2 : 2);
    while (this.trailAcc >= 1) {
      this.trailAcc -= 1;
      if (this.gliding) {
        const s = Math.random() < 0.5 ? 1 : -1;
        const pt = this.boardPoint(0.72 * s, _v);
        P.emit({ pos: pt, count: 1, vel: { x: -b.vel.x * 0.1, y: -0.1, z: -b.vel.z * 0.1 }, spread: 0.15, life: [0.5, 1.1], size: [0.07, 0.02], sprite: ['moon1', 'dot3', 'dot2', 'star4'], color: MOONLIGHT, additive: true, drag: 1.4 });
      } else {
        const pt = this.boardPoint(-0.6 + Math.random() * 1.2, _v);
        pt.y -= this.hoverY * 0.7;
        P.emit({ pos: pt, count: 1, vel: { x: 0, y: 0.25, z: 0 }, spread: 0.3, jitter: 0.12, life: [0.4, 0.9], size: [0.05, 0.01], sprite: ['dot3', 'dot2', 'moon1'], color: MOONLIGHT, additive: true, drag: 2, alpha: 0.85 });
      }
    }
    // the glow under the board lights the sand
    if (b.grounded && Math.random() < dt * 3) {
      const pt = this.boardPoint((Math.random() - 0.5) * 1.2, _v);
      pt.y -= this.hoverY;
      P.emit({ pos: pt, count: 1, life: [0.6, 1], size: [0.5, 0.9], sprite: 'glow16', color: 0xa9cdff, additive: true, alpha: 0.18 });
    }
  }
  burst(at: THREE.Vector3 | { x: number; y: number; z: number }, n: number, spread: number) {
    this.ctx.particles.emit({ pos: at, count: n, spread: spread * 3, up: 0.6, life: [0.25, 0.7], size: [0.08, 0.015], sprite: ['moon0', 'moon1', 'star4', 'dot3'], color: MOONLIGHT, additive: true, drag: 2.6 });
  }
  private wardFx(dt: number) {
    const c = this.p.center(_v);
    if (Math.random() < dt * 30) {
      const a = Math.random() * TAU, r = 0.85;
      this.ctx.particles.emit({ pos: { x: c.x + Math.cos(a) * r, y: c.y - 0.6 + Math.random() * 1.6, z: c.z + Math.sin(a) * r }, count: 1, vel: { x: -Math.sin(a) * 1.5, y: 0.3, z: Math.cos(a) * 1.5 }, life: [0.3, 0.6], size: [0.07, 0.02], sprite: ['moon1', 'star4', 'dot3'], color: MOONLIGHT, additive: true, drag: 1 });
    }
  }

  /** the right hand's grip point (world) */
  handPoint(out: THREE.Vector3) {
    const s = this.p.rig.sockets['hand_r'];
    if (s) return s.getWorldPosition(out);
    return this.p.center(out);
  }

  dispose() {
    this.spells?.dispose();
    this.spells = null;
    for (const o of this.offs) o();
    this.offs = [];
    for (const f of this.flights) f.mesh.removeFromParent();
    this.flights = [];
    if (MarkKit.current === this) MarkKit.current = null;
  }
}

function smoothK(k: number, a: number, b: number) {
  const t = clamp((k - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function easeOut(k: number) {
  return 1 - (1 - k) * (1 - k) * (1 - k);
}
void rnd;
