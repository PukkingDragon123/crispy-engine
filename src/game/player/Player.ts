// Sundown, the skeleton bounty hunter of Serket. Owns the board physics, the
// procedural rig animation, the revolver (with Pinch's active-reload QTE),
// melee/counter, grapple, health/shield/status and expression changes.
import * as THREE from 'three';
import { Board, BoardInput, LandingInfo } from './Board';
import { CameraRig } from './CameraRig';
import { buildRigGeo, RigInstance, RigSpec, voxelMesh } from '../../engine/voxel/Rig';
import { RigEyes } from '../fx/FaceFx';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { StatSheet } from '../combat/Stats';
import { StatusSet } from '../combat/Status';
import { Hit, resolveHit } from '../combat/Damage';
import type { Ctx, EnemyLike, RayHit } from '../Ctx';
import { Spring } from '../../engine/Tween';
import { clamp, damp, rnd, wrapAngle } from '../../engine/math/rand';
import { P } from '../../engine/voxel/palette';
import { Input } from '../../engine/Input';
import { PlayerAnim } from '../anim/playerAnim';

export interface PlayerVisuals {
  rig: RigSpec;
  gun: RigSpec;
  board: { model: VoxelModel; voxelSize: number };
  pinch?: RigSpec;
}

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

export type ReloadPhase = 'none' | 'open' | 'eject' | 'insert' | 'close';

export class Player {
  board = new Board();
  stats: StatSheet;
  status = new StatusSet();
  root = new THREE.Group();
  tilt = new THREE.Group();
  stance = new THREE.Group();
  rig: RigInstance;
  gun: RigInstance;
  boardMesh: THREE.Mesh;
  material: VoxelMaterial;
  hp = 100;
  shield = 0;
  alive = true;
  invuln = 0;
  hurtFlash = 0;
  // weapon state
  ammo = 6;
  fireCd = 0;
  reload = { active: false, t: 0, dur: 1.5, phase: 'none' as ReloadPhase, window: [0.46, 0.62] as [number, number], tried: false, jam: 0, perfectFx: 0, inserted: 0 };
  venomRounds = 0;
  spreadBloom = 0;
  aimPoint = new THREE.Vector3();
  aimHit: RayHit | null = null;
  aiming = false;
  firing = false;
  fanning = false;
  gunKick = new Spring(0, 260, 18);
  cylAngle = 0;
  // melee / counter
  meleeCd = 0;
  meleeAnim = 0;
  counterWindow = 0;
  // grapple
  grappleCd = 0;
  grappleLine: THREE.Line;
  grappleTarget: EnemyLike | null = null;
  grappleT = 0;
  // anim springs
  private hatX = new Spring(0, 90, 9);
  private hatZ = new Spring(0, 90, 9);
  private coatS = new Spring(0, 60, 7);
  private landS = new Spring(0, 140, 12);
  private prevVel = new THREE.Vector3();
  private exprTimer = 0;
  private exprBase = 'determined';
  private animT = 0;
  private kickPhase = 0;
  /** procedural board animation (springs, IK, choreography) */
  private pa = new PlayerAnim();
  muzzleWorld = new THREE.Vector3();
  // tunables
  baseGunDamage = 18;
  fireInterval = 0.17;
  fanInterval = 0.085;
  // pose layer (skill / item actions)
  action: { name: string; t: number; dur: number } | null = null;
  /** 2D pixel eyes in the skull sockets (Serket-green embers) */
  eyes: RigEyes;
  // callbacks
  onShot?: (hit: RayHit | null) => void;

  constructor(private ctx: Ctx, vis: PlayerVisuals, public cam: CameraRig, private input: Input) {
    this.stats = new StatSheet({ vit: 5, def: 3, phys: 5, magic: 6, mob: 5, luck: 1 });
    this.material = makeVoxelMaterial();
    this.rig = new RigInstance(buildRigGeo(vis.rig, vis.rig.name + ':player'), { material: this.material });
    this.gun = new RigInstance(buildRigGeo(vis.gun, vis.gun.name + ':player'), { material: this.material });
    this.boardMesh = voxelMesh(vis.board.model, vis.board.voxelSize, 'center', this.material);
    this.boardMesh.position.y = 0.06;
    this.root.add(this.tilt);
    this.tilt.add(this.boardMesh, this.stance);
    this.stance.rotation.y = -Math.PI / 2;
    this.stance.position.y = 0.1;
    this.stance.add(this.rig.root);
    // gun into right hand: gun +Z along forearm (down = -Y)
    const holder = new THREE.Group();
    holder.rotation.x = Math.PI / 2;
    holder.add(this.gun.root);
    if (!this.rig.attach('hand_r', holder)) this.rig.nodes['fore_r']?.add(holder);
    this.eyes = new RigEyes(this.rig, 'glow', 0x6aff1a);
    ctx.scene.add(this.root);
    // grapple rope
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.grappleLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x9dff3a }));
    this.grappleLine.visible = false;
    this.grappleLine.frustumCulled = false;
    ctx.scene.add(this.grappleLine);
    this.hp = this.maxHp;
    this.ammo = Math.round(this.stats.get('ammo'));
    this.wireBoardEvents();
  }

  get maxHp() {
    return this.stats.get('maxHp');
  }
  get pos() {
    return this.board.pos;
  }
  get speed() {
    return this.board.speed;
  }
  get maxAmmo() {
    return Math.round(this.stats.get('ammo'));
  }
  /** chest height world point (enemy targeting) */
  center(out = new THREE.Vector3()) {
    return out.set(this.board.pos.x, this.board.pos.y + 1.1, this.board.pos.z);
  }

  private wireBoardEvents() {
    const b = this.board;
    b.onJump = (charge, booster) => {
      this.ctx.sfx('board_jump', this.pos, 0.8 + charge * 0.4);
      if (booster) {
        this.ctx.sfx('boost', this.pos, 1);
        this.ctx.fx.ring({ x: this.pos.x, y: this.pos.y + 0.2, z: this.pos.z }, P.serket, 5);
        this.ctx.shake(0.25);
      }
      this.ctx.fx.sandBurst(this.pos, 0.5 + charge * 0.6);
    };
    b.onLaunch = () => {
      if (this.speed > 22) this.express('surprised', 0.6);
    };
    b.onLand = (l: LandingInfo) => this.onLand(l);
    b.onWall = (spd) => {
      if (spd > 10) {
        this.ctx.sfx('hit_bone', this.pos, 0.6);
        this.ctx.shake(0.3);
        this.ctx.fx.hit({ x: this.pos.x, y: this.pos.y + 0.8, z: this.pos.z }, { x: 0, y: 1, z: 0 }, 'rock', 1);
        this.express('hurt', 0.5);
      }
    };
    b.onDriftBoost = (p) => {
      this.ctx.sfx('boost', this.pos, 0.5 + p * 0.5, 1.2);
      this.ctx.fx.ring({ x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z }, P.sand0, 3 + p * 3);
      this.ctx.events.emit('driftBoost', p);
    };
    b.onCollide = (c, spd) => {
      if (c.data?.destructible && spd > 7) {
        this.ctx.events.emit('plow', c, spd);
        return true;
      }
      if (spd > 8) {
        this.ctx.sfx('hit_bone', this.pos, 0.4);
        this.ctx.shake(0.2);
      }
      return false;
    };
  }

  private onLand(l: LandingInfo) {
    this.landS.kick(-Math.min(6, l.impact * 0.25));
    const vol = clamp(l.impact / 20, 0.3, 1.2);
    this.ctx.sfx('board_land', this.pos, vol);
    this.ctx.fx.sandBurst(this.pos, clamp(l.impact / 14, 0.4, 1.6));
    if (l.impact > 16) this.ctx.shake(clamp(l.impact / 60, 0.1, 0.45));
    if (l.quality === 'bail') {
      this.ctx.toast('BAIL!', '#ff7a5a');
      this.express('hurt', 0.8);
      this.ctx.sfx('banjo_funny', null, 0.5);
    } else if (l.quality === 'sketchy' && l.score <= 0) {
      this.ctx.toast('Sketchy!', '#e0b373');
      this.express('surprised', 0.6);
    } else if (l.quality === 'perfect' && l.score <= 0) {
      this.ctx.toast('Stomped it!', '#ffd36b');
      this.ctx.fx.sandBurst(this.pos, 1.2);
    }
    if (l.quality !== 'bail' && l.score > 0) {
      if (l.quality === 'perfect') this.ctx.fx.sandBurst(this.pos, 1.6);
      this.ctx.events.emit('trick', l);
      this.express(l.score > 500 ? 'laugh' : 'smug', 1.2);
    }
  }

  /** play a full-body pose action layered over the riding animation */
  playAction(name: string, dur: number) {
    this.action = { name, t: 0, dur };
  }

  /** 2D pixel smear at a world point (mixes comic 2D beats into 3D motion) */
  smear(at: THREE.Vector3, size = 0.9, rot = 0) {
    this.ctx.particles.emit({ pos: at, count: 1, life: [0.12, 0.14], size: [size, size * 1.15], sprite: ['smear0', 'smear1', 'smear2'], animate: true, color: 0xfff6e0, rot: 0, sizeJitter: 0 });
    void rot;
  }

  express(name: string, dur = 1) {
    this.rig.setExpression(name);
    this.exprTimer = dur;
  }

  // ---------------------------------------------------------------- update
  update(dt: number) {
    const inp = this.input;
    const t = dt;
    this.animT += dt;
    // camera look
    if (inp.locked && this.alive) {
      const m = inp.consumeMouse();
      this.cam.mouse(m.dx, m.dy);
    } else inp.consumeMouse();

    // stats → board tuning
    this.board.mobilityMul = this.stats.get('moveSpeed');
    this.board.t.pushAccel = Board.BASE.pushAccel * this.stats.get('accel');
    this.board.t.jump = Board.BASE.jump * this.stats.get('jump');
    this.board.boostMeter = Math.min(1, this.board.boostMeter + 0.03 * this.stats.get('boostRegen') * dt);

    // input → board
    const fx = inp.axis('left', 'right');
    const fz = inp.axis('back', 'forward');
    const cf = this.cam.forward();
    const rx = -cf.z, rz = cf.x; // right vector for yaw convention
    let dx = cf.x * fz + -rx * fx * -1, dz = cf.z * fz + -rz * fx * -1;
    // right = (-cos y, sin y) = (-cf.z, cf.x)
    dx = cf.x * fz + -cf.z * fx;
    dz = cf.z * fz + cf.x * fx;
    void rx;
    void rz;
    const dl = Math.hypot(dx, dz);
    if (dl > 1) {
      dx /= dl;
      dz /= dl;
    }
    const stunned = this.status.stunned();
    const bi: BoardInput = {
      dirX: stunned ? 0 : dx,
      dirZ: stunned ? 0 : dz,
      throttle: stunned ? 0 : fz,
      jumpHeld: !stunned && inp.held('jump'),
      jumpPressed: !stunned && inp.hit('jump'),
      jumpReleased: !stunned && inp.up('jump'),
      drift: !stunned && inp.held('drift'),
      boost: !stunned && inp.held('boost'),
      fx,
      fz,
    };
    if (!this.alive) {
      bi.dirX = bi.dirZ = bi.throttle = 0;
      bi.jumpHeld = bi.jumpPressed = bi.jumpReleased = bi.drift = bi.boost = false;
    }
    const wasBoost = this.board.boosting;
    this.board.step(dt * this.status.slowMul(), bi, { surface: this.ctx.world.surface, normal: this.ctx.world.normal, slope: this.ctx.world.slope, colliders: this.ctx.world.colliders });
    if (this.board.boosting && !wasBoost) {
      this.ctx.sfx('boost', this.pos, 0.9);
      this.ctx.fx.ring({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z }, P.turq0, 4);
    }

    // timers
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
    this.fireCd -= dt;
    this.meleeCd -= dt;
    this.grappleCd -= dt;
    this.counterWindow = Math.max(0, this.counterWindow - dt);
    this.spreadBloom = Math.max(0, this.spreadBloom - dt * 3);
    // regen
    if (this.alive) this.hp = Math.min(this.maxHp, this.hp + this.stats.get('regen') * dt);
    // statuses on the player
    const tick = this.status.tick(dt, this.maxHp, this.speed > 1, false);
    if (tick && this.alive) {
      const d = tick.poison + tick.bleed + tick.burn;
      if (d > 0) this.applyDamage(d, 'status', true);
    }

    // aim
    this.aiming = inp.held('aim');
    this.cam.aim = damp(this.cam.aim, this.aiming ? 1 : 0, 10, dt);
    this.updateAim();
    if (this.alive) {
      this.updateGun(dt);
      this.updateMelee(dt);
      this.updateGrapple(dt);
    }
    this.animate(dt);
    if (this.ctx.faces) {
      this.eyes.lookAt(this.aimPoint);
      this.eyes.draw(this.ctx.faces, dt);
    }
    // board fx
    this.boardFx(dt);
    // expressions
    if (this.exprTimer > 0) {
      this.exprTimer -= dt;
      if (this.exprTimer <= 0) this.rig.setExpression(this.aiming ? 'focus' : this.exprBase);
    } else if (this.aiming && this.rig.expression !== 'focus') this.rig.setExpression('focus');
    else if (!this.aiming && this.rig.expression === 'focus') this.rig.setExpression(this.exprBase);
    void t;
  }

  private boardFx(dt: number) {
    const b = this.board;
    const sp = b.speed;
    if (b.grounded && sp > 3) {
      const back = { x: -Math.sin(b.heading), z: -Math.cos(b.heading) };
      const tail = { x: b.pos.x + back.x * 0.7, y: b.pos.y + 0.05, z: b.pos.z + back.z * 0.7 };
      const kind = b.lastSurface.kind;
      const amt = clamp(sp / 26, 0, 1.2) * (b.drifting ? 2.2 : 1) * (kind === 'hard' ? 0.25 : 1);
      if (kind === 'water') {
        this.ctx.particles.emit({ pos: tail, count: Math.ceil(amt * 3), vel: { x: back.x * 2, y: 2.5, z: back.z * 2 }, spread: 1.5, life: [0.3, 0.6], size: [0.08, 0.05], sprite: ['dot3', 'dot4'], color: [0xe8fbff, 0x9fe6f0], gravity: 10, drag: 1 });
      } else this.ctx.fx.sandSpray(tail, { x: back.x * sp * 0.15 - Math.cos(b.heading) * b.lean * 4, y: 0, z: back.z * sp * 0.15 + Math.sin(b.heading) * b.lean * 4 }, amt * dt * 60 * 0.35);
    }
    // speed lines at very high speed
    this.ctx.fx.speedLines(this.ctx.camera, clamp((sp - 26) / 18, 0, 1) + (b.boosting ? 0.4 : 0));
  }

  // -------------------------------------------------------------------- aim
  private ray = { o: new THREE.Vector3(), d: new THREE.Vector3() };
  private updateAim() {
    const { o, d } = this.ray;
    this.cam.aimRay(o, d);
    // start ray from near the player to avoid hitting stuff between camera and player
    const toP = _v.copy(this.center()).sub(o);
    const along = Math.max(0, toP.dot(d));
    o.addScaledVector(d, along * 0.9);
    const hit = this.ctx.enemies.raycast(o, d, 160);
    const tt = this.ctx.world.field.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 160);
    let best: RayHit | null = hit;
    if (tt >= 0 && (!best || tt < best.t)) best = { enemy: null, t: tt, point: o.clone().addScaledVector(d, tt), normal: new THREE.Vector3(0, 1, 0), headshot: false, part: '', surface: 'terrain' };
    this.aimHit = best;
    if (best) this.aimPoint.copy(best.point);
    else this.aimPoint.copy(o).addScaledVector(d, 120);
  }

  // --------------------------------------------------------------- revolver
  private updateGun(dt: number) {
    const inp = this.input;
    const R = this.reload;
    // reload state machine
    if (R.active) {
      if (R.jam > 0) {
        R.jam -= dt;
      } else {
        const spd = this.stats.get('reloadSpeed');
        const prev = R.t;
        R.t += (dt * spd) / R.dur;
        const k = R.t;
        const phase: ReloadPhase = k < 0.14 ? 'open' : k < 0.3 ? 'eject' : k < 0.86 ? 'insert' : 'close';
        if (phase !== R.phase) {
          R.phase = phase;
          if (phase === 'open') this.ctx.sfx('rev_open', this.pos, 0.8);
          if (phase === 'eject') {
            this.ctx.sfx('rev_eject', this.pos, 0.8);
            this.ctx.fx.shells(this.muzzleWorld, { x: Math.cos(this.board.heading), y: 0, z: -Math.sin(this.board.heading) }, this.maxAmmo - this.ammo);
            this.ctx.sfx('shell_casing', this.pos, 0.6);
          }
          if (phase === 'close') this.ctx.sfx('rev_close', this.pos, 0.8);
        }
        if (phase === 'insert') {
          const n = Math.floor(((k - 0.3) / 0.56) * this.maxAmmo);
          if (n > R.inserted) {
            R.inserted = n;
            this.ctx.sfx('rev_insert', this.pos, 0.55, 0.95 + n * 0.02);
          }
        }
        void prev;
        if (R.t >= 1) this.finishReload(false);
      }
      // active reload attempt
      if (inp.hit('reload') && !R.tried && R.t > 0.05) {
        R.tried = true;
        if (R.t >= R.window[0] && R.t <= R.window[1]) {
          this.finishReload(true);
        } else {
          R.jam = 0.55;
          this.ctx.sfx('qte_fail', null, 0.6);
          this.ctx.toast('JAMMED', '#ff9a6a');
          this.express('hurt', 0.4);
        }
      }
    } else if (inp.hit('reload') && this.ammo < this.maxAmmo) this.startReload();

    const want = inp.held('fire');
    this.firing = want;
    if (want && !R.active) {
      const pressed = inp.hit('fire');
      if (this.ammo <= 0) {
        if (pressed) {
          this.ctx.sfx('rev_dry', this.pos, 0.8);
          this.startReload();
        }
      } else if (this.fireCd <= 0) {
        this.fanning = !pressed && this.fireCd < -0.0;
        const interval = (pressed ? this.fireInterval : this.fanInterval * 1.6) / this.stats.get('fireRate');
        this.fireCd = interval;
        this.shoot(!pressed);
      }
    } else this.fanning = false;
    if (this.ammo <= 0 && !R.active && this.fireCd < -0.25) this.startReload();
    // cylinder spin animation
    const cyl = this.gun.nodes['cylinder'];
    if (cyl) {
      const target = ((this.maxAmmo - this.ammo) * Math.PI) / 3;
      this.cylAngle = damp(this.cylAngle, target, 18, dt);
      cyl.rotation.z = this.cylAngle + (R.active && R.phase === 'close' ? R.t * 30 : 0);
      cyl.position.x = R.active && (R.phase === 'eject' || R.phase === 'insert') ? -0.04 : 0;
    }
    const ham = this.gun.nodes['hammer'];
    if (ham) ham.rotation.x = -this.gunKick.x * 0.8;
  }

  startReload() {
    const R = this.reload;
    if (R.active || this.ammo >= this.maxAmmo) return;
    R.active = true;
    R.t = 0;
    R.phase = 'none';
    R.tried = false;
    R.jam = 0;
    R.inserted = 0;
    const w = 0.16 - (this.ctx.run.rank > 10 ? 0.02 : 0);
    const s = 0.42 + rnd.next() * 0.16;
    R.window = [s, s + w];
    this.ctx.events.emit('reloadStart');
  }

  private finishReload(perfect: boolean) {
    const R = this.reload;
    R.active = false;
    R.phase = 'none';
    this.ammo = this.maxAmmo;
    if (perfect) {
      this.venomRounds = this.maxAmmo;
      R.perfectFx = 1;
      this.ctx.sfx('qte_perfect', null, 0.8);
      this.ctx.sfx('rev_spin', this.pos, 0.9);
      this.ctx.toast('PERFECT RELOAD', '#9dff3a', 'Venom rounds +35% dmg');
      this.ctx.fx.sparkle(this.muzzleWorld, P.serket, 10, 0.3);
      this.express('smug', 0.9);
      this.playAction('twirl', 0.55);
      this.ctx.events.emit('perfectReload');
    } else this.ctx.sfx('rev_spin', this.pos, 0.5);
  }

  private shoot(fanned: boolean) {
    const ctx = this.ctx;
    this.ammo--;
    const venom = this.venomRounds > 0;
    if (venom) this.venomRounds--;
    // spread
    const base = (fanned ? 2.6 : 0.55) * this.stats.get('spread');
    const moveSpread = clamp(this.speed / 30, 0, 1) * 0.6 + (this.board.grounded ? 0 : 0.5);
    const spreadDeg = (base + moveSpread + this.spreadBloom) * (1 - this.cam.aim * 0.65);
    this.spreadBloom = Math.min(3, this.spreadBloom + (fanned ? 0.9 : 0.45));
    const o = this.ray.o.clone();
    let d = this.ray.d.clone();
    const sr = THREE.MathUtils.degToRad(spreadDeg) * Math.sqrt(rnd.next());
    const sa = rnd.next() * Math.PI * 2;
    const perp1 = _v.set(0, 1, 0).cross(d).normalize();
    const perp2 = _v2.copy(d).cross(perp1).normalize();
    d.addScaledVector(perp1, Math.cos(sa) * Math.tan(sr)).addScaledVector(perp2, Math.sin(sa) * Math.tan(sr)).normalize();
    // aim magnetism
    let hit = ctx.enemies.raycast(o, d, 160);
    if (!hit) {
      let bestE: EnemyLike | null = null, bestAng = THREE.MathUtils.degToRad(2.6 + this.cam.aim * 0.8);
      for (const e of ctx.enemies.list) {
        if (!e.alive) continue;
        const c = _v.set(e.pos.x, e.pos.y + e.height * 0.55, e.pos.z).sub(o);
        const dist = c.length();
        if (dist > 120) continue;
        const ang = c.angleTo(d);
        const tol = bestAng * (1 + e.radius / Math.max(4, dist));
        if (ang < tol) {
          bestAng = ang;
          bestE = e;
        }
      }
      if (bestE) {
        d = _v.set(bestE.pos.x, bestE.pos.y + bestE.height * 0.55, bestE.pos.z).sub(o).normalize().clone();
        hit = ctx.enemies.raycast(o, d, 160);
      }
    }
    const tt = ctx.world.field.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 160);
    const colHit = { t: -1, c: null as any, nx: 0, nz: 0 };
    ctx.world.colliders.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 160, colHit);
    let endT = 160;
    let surface: 'terrain' | 'prop' | 'none' = 'none';
    if (tt >= 0) {
      endT = tt;
      surface = 'terrain';
    }
    if (colHit.t >= 0 && colHit.t < endT) {
      endT = colHit.t;
      surface = 'prop';
    }
    // muzzle
    const muzzle = this.muzzleWorld;
    // pierce through multiple enemies
    const pierce = Math.round(this.stats.get('pierce'));
    const skip = new Set<number>();
    let lastPoint = o.clone().addScaledVector(d, endT);
    let hits = 0;
    let firstHit: RayHit | null = null;
    while (hit && hit.t < endT && hits <= pierce) {
      if (!firstHit) firstHit = hit;
      const e = hit.enemy!;
      const h: Hit = {
        base: this.baseGunDamage * (venom ? 1.35 : 1),
        kind: 'phys',
        source: 'gun',
        headshot: hit.headshot,
        status: [{ id: 'poison', stacks: venom ? 3 : 1, dur: 4, power: 2.2 }],
        knock: 2.5 * this.stats.get('knockback'),
        dirX: d.x,
        dirZ: d.z,
        tags: [hit.part],
      };
      ctx.enemies.damage(e, h, hit.point, d);
      lastPoint = hit.point.clone();
      skip.add(e.id);
      hits++;
      hit = ctx.enemies.raycast(o, d, 160, skip);
    }
    if (!firstHit) {
      // impact on world
      const p = o.clone().addScaledVector(d, endT);
      lastPoint = p;
      if (surface === 'terrain') {
        const n = new THREE.Vector3();
        ctx.world.normal(p.x, p.z, n);
        const mat = ctx.world.field.matAt(p.x, p.z);
        ctx.fx.hit(p, n, mat === 3 || mat === 4 || mat === 5 ? 'rock' : 'sand', 0.8);
        ctx.sfx(mat === 3 || mat === 4 || mat === 5 ? 'bullet_impact_rock' : 'bullet_impact_sand', p, 0.7);
      } else if (surface === 'prop') {
        ctx.fx.hit(p, { x: colHit.nx, y: 0.3, z: colHit.nz }, colHit.c?.data?.material ?? 'rock', 0.8);
        ctx.sfx('bullet_impact_rock', p, 0.6);
        ctx.events.emit('propShot', colHit.c, p, d);
      }
    }
    ctx.fx.tracer(muzzle, lastPoint, venom ? 0xc8ff5a : 0xfff0b0);
    ctx.fx.muzzle(muzzle, d, venom ? 0xc8ff5a : 0xfff2a0);
    ctx.sfx('rev_shot', muzzle, 1, fanned ? 1.06 : 1);
    if (rnd.chance(0.5)) ctx.sfx('rev_hammer', muzzle, 0.25);
    this.gunKick.kick(fanned ? 9 : 14);
    this.cam.kick(fanned ? 0.012 : 0.022);
    this.cam.addTrauma(0.09);
    this.onShot?.(firstHit);
    ctx.events.emit('shot', firstHit, venom);
  }

  // ------------------------------------------------------------- melee
  private updateMelee(dt: number) {
    const inp = this.input;
    this.meleeAnim = Math.max(0, this.meleeAnim - dt * 3.2);
    if (inp.hit('melee') && this.meleeCd <= 0) {
      this.meleeCd = 0.55;
      this.meleeAnim = 1;
      this.playAction('kick', 0.42);
      const f = this.ctx.camera.getWorldDirection(new THREE.Vector3());
      this.ctx.engine.tweens.after(0.08, () => this.smear(this.center(new THREE.Vector3()).addScaledVector(f.setY(0).normalize(), 1.1), 1.4));
      this.ctx.events.emit('melee', this);
    }
  }

  // ------------------------------------------------------------- grapple
  private updateGrapple(dt: number) {
    const g = this.board.grapple;
    const inp = this.input;
    if (inp.hit('grapple')) {
      if (g.active) this.releaseGrapple();
      else if (this.grappleCd <= 0) this.fireGrapple();
    }
    if (g.active) {
      this.grappleT += dt;
      if (this.grappleTarget) {
        const e = this.grappleTarget;
        if (!e.alive) this.releaseGrapple();
        else {
          g.x = e.pos.x;
          g.y = e.pos.y + e.height * 0.5;
          g.z = e.pos.z;
          if (_v.set(g.x - this.pos.x, g.y - this.pos.y - 1, g.z - this.pos.z).length() < 2.6) {
            this.ctx.events.emit('grappleKick', e);
            this.releaseGrapple();
            this.board.vel.y = Math.max(this.board.vel.y, 6);
          }
        }
      } else if (_v.set(g.x - this.pos.x, g.y - this.pos.y - 1.2, g.z - this.pos.z).length() < 3.2 || this.grappleT > 2.4) this.releaseGrapple();
      const pts = [this.muzzleWorld.clone(), new THREE.Vector3(g.x, g.y, g.z)];
      (this.grappleLine.geometry as THREE.BufferGeometry).setFromPoints(pts);
      this.grappleLine.visible = g.active;
    }
  }

  fireGrapple() {
    const ctx = this.ctx;
    const o = this.ray.o, d = this.ray.d;
    // grapple points (totems) have priority within a forgiving cone
    let best: { x: number; y: number; z: number } | null = null;
    let bestAng = 0.16;
    ctx.world.colliders.query(this.pos.x, this.pos.z, 55, (c) => {
      if (c.tag !== 'grapple') return;
      const p = _v.set(c.x, c.y1, c.z);
      const dir = p.clone().sub(o);
      const ang = dir.angleTo(d);
      if (ang < bestAng && dir.length() < 60) {
        bestAng = ang;
        best = { x: c.x, y: c.y1, z: c.z };
      }
    });
    this.grappleTarget = null;
    if (!best) {
      const h = this.aimHit;
      if (h && h.t < 48) {
        if (h.enemy) this.grappleTarget = h.enemy;
        best = { x: h.point.x, y: h.point.y, z: h.point.z };
      }
    }
    if (!best) {
      ctx.sfx('rev_dry', this.pos, 0.6);
      return;
    }
    const b = best as { x: number; y: number; z: number };
    const g = this.board.grapple;
    g.active = true;
    g.x = b.x;
    g.y = b.y;
    g.z = b.z;
    g.len = Math.hypot(b.x - this.pos.x, b.y - this.pos.y, b.z - this.pos.z);
    this.grappleT = 0;
    this.grappleCd = 2.2 * (1 - this.stats.get('cdr'));
    ctx.sfx('grapple_fire', this.pos, 0.9);
    this.playAction('grapple', 0.5);
    ctx.sfx('grapple_hit', b, 0.8);
    ctx.fx.hit(b, { x: 0, y: 1, z: 0 }, 'chitin', 0.6);
    this.express('determined', 0.5);
  }

  releaseGrapple() {
    this.board.grapple.active = false;
    this.grappleTarget = null;
    this.grappleLine.visible = false;
  }

  // ------------------------------------------------------------- damage
  /** returns damage dealt */
  takeHit(hit: Hit, from?: THREE.Vector3): number {
    if (!this.alive || this.invuln > 0) return 0;
    // dodge (board style): mobility-based
    if (rnd.next() < this.stats.get('dodge')) {
      this.ctx.fx.number({ x: this.pos.x, y: this.pos.y + 2.1, z: this.pos.z }, 'x', 0x6fe3cf, 0.8);
      this.ctx.toast('DODGE', '#6fe3cf');
      return 0;
    }
    const res = resolveHit(null, hit, {
      hp: this.hp,
      maxHp: this.maxHp,
      armor: this.stats.get('armor'),
      physRes: this.stats.get('physRes'),
      magicRes: this.stats.get('magicRes'),
      statusRes: {},
      status: this.status,
    });
    const dealt = this.applyDamage(res.amount, hit.source, false);
    if (hit.knock && from) {
      const dir = _v.copy(this.pos).sub(from).setY(0).normalize();
      this.board.impulse.addScaledVector(dir, hit.knock).add(new THREE.Vector3(0, hit.knock * 0.35, 0));
    }
    this.invuln = 0.32;
    return dealt;
  }

  applyDamage(amount: number, source: string, isTick: boolean) {
    let a = amount;
    if (this.shield > 0) {
      const s = Math.min(this.shield, a);
      this.shield -= s;
      a -= s;
      if (s > 0 && !isTick) this.ctx.sfx('shield_up', this.pos, 0.4, 1.4);
    }
    this.hp -= a;
    if (!isTick) {
      this.hurtFlash = 1;
      this.material.userData.fx.value.x = 0.6;
      this.ctx.shake(clamp(a / 40, 0.12, 0.6));
      this.ctx.sfx('skeleton_rattle', this.pos, 0.7);
      this.ctx.sfx('hit_bone', this.pos, 0.5);
      this.express('hurt', 0.5);
      this.ctx.events.emit('playerHurt', a, source);
    }
    if (this.hp <= 0 && this.alive) {
      this.hp = 0;
      this.alive = false;
      this.rig.setExpression('dead');
      this.ctx.events.emit('playerDeath');
    }
    return a;
  }

  heal(n: number) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    const d = this.hp - before;
    if (d > 0.5) this.ctx.fx.number({ x: this.pos.x, y: this.pos.y + 2.2, z: this.pos.z }, '+' + Math.round(d), 0x9dff3a, 0.9);
    return d;
  }

  revive() {
    this.alive = true;
    this.hp = this.maxHp;
    this.invuln = 3;
    this.status.clear();
    this.rig.setExpression('determined');
  }

  // ------------------------------------------------------------ animation
  private animate(dt: number) {
    const A = this.pa;
    const I = A.in;
    const b = this.board;
    this.landS.update(0, dt);
    I.dt = dt;
    I.time = this.animT;
    I.rig = this.rig;
    I.gun = this.gun;
    I.root = this.root;
    I.tilt = this.tilt;
    I.board = b;
    I.alive = this.alive;
    I.aiming = this.aiming;
    I.firing = this.firing;
    I.fanning = this.fanning;
    I.aimPoint = this.aimPoint;
    I.reload = this.reload;
    I.hp01 = this.hp / Math.max(1, this.maxHp);
    I.stunned = this.status.stunned();
    I.wrapped = !!(this.ctx.enemies as unknown as { wrapping?: unknown }).wrapping;
    I.hurtFlash = this.hurtFlash;
    I.gunKick = this.gunKick;
    I.landX = this.landS.x;
    I.forwardHeld = this.input.held('forward');
    I.spinInput = this.input.axis('left', 'right');
    I.action = this.action;
    I.expression = this.rig.expression;
    I.exprJaw = this.rig.exprJaw;
    I.exprBrow = this.rig.exprBrow;
    I.heightAboveGround = b.grounded ? 0 : b.pos.y - this.ctx.world.groundAt(b.pos.x, b.pos.z);
    I.camForward = this.ctx.camera.getWorldDirection(_v2);
    A.update(I);
    // answers to the animation's requests
    if (A.wantGlanceQuery) A.setGlance(this.ctx.enemies.nearest(b.pos, 18));
    if (A.wantFidgetTwirl && !this.action) this.playAction('twirl', 0.9);
    if (A.dustNow) this.ctx.fx.sandBurst(A.dust, 0.18);
    this.applyAction(dt);
    A.finish(I);
    // hurt flash decay
    const fxu = this.material.userData.fx.value;
    fxu.x = damp(fxu.x, 0, 12, dt);
    fxu.z = this.board.boosting ? 0.8 : damp(fxu.z, 0, 4, dt);
    // muzzle world position
    const mz = this.gun.geo.spec.meta?.muzzle as [number, number, number] | undefined;
    const frame = this.gun.nodes['frame'];
    if (frame && mz) {
      const vs = this.gun.geo.spec.voxelSize;
      const piv = this.gun.geo.spec.parts[0].pivot;
      frame.localToWorld(this.muzzleWorld.set((mz[0] - piv[0]) * vs, (mz[1] - piv[1]) * vs, (mz[2] - piv[2]) * vs));
    } else this.muzzleWorld.copy(this.center());
  }

  /** advance the action layer; poses come from the animation module (envelopes per action) */
  private applyAction(dt: number) {
    const a = this.action;
    if (!a) return;
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    if (k >= 1) {
      this.action = null;
      return;
    }
    this.pa.actionPose(a.name, k, a.dur, this.pa.in);
  }

  dispose() {
    this.root.removeFromParent();
    this.grappleLine.removeFromParent();
  }
}

export function wrapA(a: number) {
  return wrapAngle(a);
}
