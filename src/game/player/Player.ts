// Sundown, the skeleton bounty hunter of Serket. Owns the board physics, the
// procedural rig animation, the revolver (with Pinch's active-reload QTE),
// melee/counter, grapple, health/shield/status and expression changes.
import * as THREE from 'three';
import { Board, BoardInput, LandingInfo } from './Board';
import { BoardMoves } from './BoardMoves';
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
import { CastAnim } from '../anim/castAnim';
import { Weapons } from './Weapons';

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

/**
 * Aim assist. `strength` scales everything (0 = off). Mouse uses 1x, touch
 * gets `touchMul`. It helps without driving: shots that would just miss bend
 * onto the nearest body inside a small screen cone, the look slows over a
 * target, the view keeps a target it is already on while riding, and entering
 * ADS eases most of the way onto the nearest target in a wider cone.
 */
export const AIM_ASSIST = {
  strength: 1,
  /** bullet magnetism half-angle (deg) up close / at range (screen cone: far more forgiving in metres at range) */
  coneNear: 1.0,
  coneFar: 2.4,
  nearDist: 6,
  farDist: 40,
  maxRange: 95,
  /** share of look sensitivity removed while the reticle is on a body */
  friction: 0.38,
  /** share of the target's angular drift the view follows while engaged (riding past, target running) */
  tracking: 0.32,
  /** soft snap when entering ADS: cone (deg), share of the angle closed, time (s) */
  adsSnap: true,
  snapCone: 9,
  snapPull: 0.72,
  snapTime: 0.15,
  touchMul: 2.2,
};

/** revolver handling */
export const GUN_FEEL = {
  /** hold fire this long (hip) and the palm starts fanning the hammer */
  fanHold: 0.16,
  /** a click this early still fires the moment the hammer is ready */
  buffer: 0.14,
  /** held fire while aiming: thumb-cocked aimed shots */
  adsRepeat: 0.26,
  /** cones (deg): aimed hip shot, fanned shot; ADS multiplier; first shot after a rest */
  hipSpread: 0.6,
  fanSpread: 3.4,
  adsSpreadMul: 0.28,
  restedMul: 0.5,
  restTime: 0.4,
  bloomAimed: 0.5,
  bloomFan: 0.75,
  bloomMax: 3.5,
  /** view punch (rad): aimed / fanned */
  kickPitch: 0.034,
  kickPitchFan: 0.019,
  /** hit-stop on a kill (s): body / head or crit */
  killStop: 0.045,
  killStopHead: 0.075,
};

/**
 * Board-slide dodge (hold drift + tap jump): a sideways hop off the rail of
 * the board with brief i-frames, a jade afterimage trail and a lean into it.
 * Anything that would have hit inside the i-frames is a PERFECT DODGE.
 */
export const DODGE = {
  /** sideways shove (m/s) and hop (m/s up) */
  side: 11,
  hop: 4.4,
  /** invulnerable for (s) */
  iframes: 0.4,
  cooldown: 0.85,
  /** afterimages: count, spacing (s), fade time (s), start opacity */
  ghosts: 3,
  ghostGap: 0.06,
  ghostLife: 0.34,
  ghostAlpha: 0.42,
};

const DEG = Math.PI / 180;
const _o = new THREE.Vector3();

/** the gun's kick spring, substepped: a slow frame (under ~12 fps) can't make it diverge */
class KickSpring extends Spring {
  update(target: number, dt: number) {
    const n = Math.max(1, Math.ceil(dt / 0.016));
    for (let i = 0; i < n; i++) super.update(target, dt / n);
    if (!Number.isFinite(this.x + this.v)) this.x = this.v = 0;
    return this.x;
  }
}
const _pt = new THREE.Vector3();

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
  gunKick = new KickSpring(0, 260, 18);
  cylAngle = 0;
  // melee / counter
  meleeCd = 0;
  meleeAnim = 0;
  counterWindow = 0;
  // board-slide dodge
  dodgeCd = 0;
  /** i-frame time left from a dodge (a hit landing inside it is a perfect dodge) */
  dodgeT = 0;
  private dodgeSide = 1;
  private dodgeHold = false;
  private perfectDodged = false;
  private ghostQueue: number[] = [];
  private ghosts: { g: THREE.Group; mat: THREE.MeshBasicMaterial; t: number }[] = [];
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
  /** skill cast poses (grenade / flick / whistle) layered over the riding pose */
  private cast = new CastAnim();
  private castReady = false;
  muzzleWorld = new THREE.Vector3();
  /** the arsenal: revolver + long guns, switching, the two-hand hold, the dig (player/Weapons.ts) */
  weapons!: Weapons;
  // tunables
  baseGunDamage = 18;
  fireInterval = 0.17;
  fanInterval = 0.075;
  /** current shot cone (deg), for the crosshair bloom */
  spreadDeg = 0;
  /**
   * crosshair feedback, all 0..1 and decaying: hit tick, kill confirm,
   * headshot, reticle resting on a body (aim assist friction)
   */
  reticle = { hit: 0, kill: 0, head: 0, sticky: 0 };
  // gun feel state
  private holdT = 0;
  private shotBuffer = 0;
  private fanCount = 0;
  /** barrel heat (smoke wisps); every gun adds to it */
  heat = 0;
  private smokeAcc = 0;
  lastFireT = -9;
  private killStopAt = -9;
  shotCrit = false;
  private lookMag = 0;
  // aim assist state
  private stickE: EnemyLike | null = null;
  private stickYaw = 0;
  private stickPitch = 0;
  private snap: { e: EnemyLike; t: number } | null = null;
  // pose layer (skill / item actions)
  action: { name: string; t: number; dur: number } | null = null;
  /** where a skill cast throws / points (held from the cast, the view may cut away mid-throw) */
  castAim: THREE.Vector3 | null = null;
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
    this.weapons = new Weapons(ctx, this, input, holder);
    this.wireBoardEvents();
    // crits are rolled inside the enemy damage resolve: listen so the shot can feel them
    ctx.events.on('enemyHit', (_e: EnemyLike, hit: Hit, _amt: number, res: { crit?: boolean }) => {
      if (hit?.source === 'gun' && res?.crit) this.shotCrit = true;
    });
    // a landed counter: safe for a beat, the view punches in on the impact
    ctx.events.on('counter', () => {
      this.invuln = Math.max(this.invuln, 0.55);
      this.cam.punch(-0.03, 0, -3.4, 0);
      this.cam.addTrauma(0.22);
      this.meleeCd = Math.min(this.meleeCd, 0.2);
      this.express('smug', 1);
    });
  }

  /** the shot cone in HUD pixels for a view `viewH` pixels tall (crosshair bloom) */
  spreadPx(viewH: number) {
    const half = Math.tan((this.ctx.camera.fov * DEG) / 2);
    return (Math.tan(this.spreadDeg * DEG) / Math.max(1e-3, half)) * viewH * 0.5;
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
  /** magazine of the gun in hand */
  get maxAmmo() {
    return this.weapons ? this.weapons.mag() : Math.round(this.stats.get('ammo'));
  }
  /** the animation clock (seconds) */
  get animTime() {
    return this.animT;
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
      if (this.speed > 17) this.express('surprised', 0.6);
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
      this.lookMag = Math.abs(m.dx) + Math.abs(m.dy);
    } else {
      inp.consumeMouse();
      this.lookMag = 0;
    }

    // stats → board tuning
    this.board.mobilityMul = this.stats.get('moveSpeed');
    this.board.t.pushAccel = Board.BASE.pushAccel * this.stats.get('accel');
    this.board.t.jump = Board.BASE.jump * this.stats.get('jump');
    this.board.boostMeter = Math.min(1, this.board.boostMeter + 0.03 * this.stats.get('boostRegen') * dt);

    // input → board
    let fx = inp.axis('left', 'right');
    let fz = inp.axis('back', 'forward');
    // touch: the gesture layer steers with an analog left thumb (game/ui/TouchControls)
    const st = inp.stick;
    if (st.active) {
      fx = clamp(fx + st.x, -1, 1);
      fz = clamp(fz + st.y, -1, 1);
    }
    const cf = this.cam.forward();
    // W rides where you look and A / D carve across it (right = (-cf.z, cf.x)); S only
    // sits back on the heel edge to brake, it never swings the board around
    const fzDir = Math.max(0, fz);
    let dx = cf.x * fzDir + -cf.z * fx;
    let dz = cf.z * fzDir + cf.x * fx;
    if (st.active && Math.abs(st.x) > 0.06) {
      // the thumb steers the board itself (left / right of where it points now), so holding it
      // over keeps carving round in a circle instead of stalling side-on to the camera
      const h = this.board.heading - st.x * 1.15;
      const m = Math.max(Math.abs(st.x), fzDir, 0.35);
      dx = Math.sin(h) * m;
      dz = Math.cos(h) * m;
    }
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
      push: !stunned && inp.hit('push'),
      pushLead: inp.pushLead,
      fwdTap: !stunned && inp.hit('forward'),
      // auto-push (touch, or the desktop opt-in): kick on his own while a direction is held, never while braking
      autoPush: !stunned && !this.weapons?.dig && inp.autoPush && (st.active ? fz > -0.25 : fz > 0 || fx !== 0),
      fx,
      fz,
    };
    if (!this.alive) {
      bi.dirX = bi.dirZ = bi.throttle = 0;
      bi.jumpHeld = bi.jumpPressed = bi.jumpReleased = bi.drift = bi.boost = bi.push = bi.fwdTap = bi.autoPush = false;
    }
    // mid power-slide, JUMP is a spin launch (Board), not the dodge below
    const sliding = this.board.drifting;
    if (sliding) bi.drift = false;
    // board-slide dodge: hold drift, tap jump (the press is spent on the dodge, not a charged jump)
    this.dodgeCd -= dt;
    this.dodgeT = Math.max(0, this.dodgeT - dt);
    if (this.alive && !stunned && bi.jumpPressed && bi.drift && this.dodgeCd <= 0) this.dodge(fx, fz, cf);
    if (this.dodgeHold) {
      if (!inp.held('jump')) this.dodgeHold = false;
      bi.jumpHeld = bi.jumpPressed = bi.jumpReleased = false;
    }
    if (sliding) bi.drift = this.alive && !stunned && inp.held('drift');
    const wasBoost = this.board.boosting;
    this.board.step(dt * this.status.slowMul(), bi, { surface: this.ctx.world.surface, normal: this.ctx.world.normal, slope: this.ctx.world.slope, colliders: this.ctx.world.colliders });
    if (this.board.boosting && !wasBoost) {
      this.ctx.sfx('boost', this.pos, 0.9);
      this.ctx.fx.ring({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z }, P.turq0, 4);
    }
    // push rhythm feedback, drift spray + board slash, move unlocks, the style combo
    (this.moves ??= new BoardMoves(this.ctx, this)).update(dt);

    // timers
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
    this.fireCd -= dt;
    this.meleeCd -= dt;
    this.grappleCd -= dt;
    this.counterWindow = Math.max(0, this.counterWindow - dt);
    this.spreadBloom = Math.max(0, this.spreadBloom - dt * (3.2 + this.cam.aim * 2));
    const rk = this.reticle;
    rk.hit = Math.max(0, rk.hit - dt * 8);
    rk.kill = Math.max(0, rk.kill - dt * 4);
    rk.head = Math.max(0, rk.head - dt * 3.5);
    // regen
    if (this.alive) this.hp = Math.min(this.maxHp, this.hp + this.stats.get('regen') * dt);
    // statuses on the player
    const tick = this.status.tick(dt, this.maxHp, this.speed > 1, false);
    if (tick && this.alive) {
      const d = tick.poison + tick.bleed + tick.burn;
      if (d > 0) this.applyDamage(d, 'status', true);
    }

    // aim (ADS on right mouse): zoom in fast, settle out a touch slower
    const wasAiming = this.aiming;
    this.aiming = inp.held('aim') && this.alive;
    this.cam.aim = damp(this.cam.aim, this.aiming ? 1 : 0, this.aiming ? 14 : 9, dt);
    this.updateAim();
    this.updateAssist(dt, this.aiming && !wasAiming);
    if (inp.touchMode) this.touchAssist(dt);
    else this.followCarve(dt, fx);
    if (this.alive) {
      this.weapons.preUpdate(dt);
      // a dig (treasure hunt) puts the gun away: no shooting with a shovel in hand
      if (this.weapons.dig) this.firing = this.fanning = false;
      else if (this.weapons.isLong) this.weapons.updateLong(dt);
      else this.updateGun(dt);
      this.updateMelee(dt);
      this.updateGrapple(dt);
    }
    this.weapons.scopeFor(dt);
    this.spreadDeg = this.weapons.isLong ? this.weapons.coneDeg() : this.coneDeg(this.fanning);
    // a frozen frame (engine paused: the pause menu) keeps the last pose — the procedural
    // anim's springs divide by dt and would go NaN (the whole body vanishes on resume)
    if (dt > 1e-6) {
      this.animate(dt);
      this.dodgeVisuals(dt);
    }
    this.barrelSmoke(dt);
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

  /** push / drift / trick feel, unlockable moves and the style combo (player/BoardMoves) */
  moves: BoardMoves | null = null;

  private boardFx(dt: number) {
    const b = this.board;
    const sp = b.speed;
    if (b.grounded && sp > 3) {
      const back = { x: -Math.sin(b.heading), z: -Math.cos(b.heading) };
      const tail = { x: b.pos.x + back.x * 0.7, y: b.pos.y + 0.05, z: b.pos.z + back.z * 0.7 };
      const kind = b.lastSurface.kind;
      const amt = clamp(sp / 20, 0, 1.2) * (b.drifting ? 2.2 : 1) * (kind === 'hard' ? 0.25 : 1);
      if (kind === 'water') {
        this.ctx.particles.emit({ pos: tail, count: Math.ceil(amt * 3), vel: { x: back.x * 2, y: 2.5, z: back.z * 2 }, spread: 1.5, life: [0.3, 0.6], size: [0.08, 0.05], sprite: ['dot3', 'dot4'], color: [0xe8fbff, 0x9fe6f0], gravity: 10, drag: 1 });
      } else this.ctx.fx.sandSpray(tail, { x: back.x * sp * 0.15 - Math.cos(b.heading) * b.lean * 4, y: 0, z: back.z * sp * 0.15 + Math.sin(b.heading) * b.lean * 4 }, amt * dt * 60 * 0.35);
    }
    // speed lines near the top of the (gun-range) speed band
    this.ctx.fx.speedLines(this.ctx.camera, clamp((sp - 11) / 7, 0, 1) * (1 - this.cam.aim * 0.7) + (b.boosting ? 0.4 : 0));
  }

  // -------------------------------------------------------------------- aim
  /** the aim ray this frame (origin pulled up to the hunter, unit direction) */
  ray = { o: new THREE.Vector3(), d: new THREE.Vector3() };
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

  /** can the assist consider this enemy at all (alive, above ground, not mid-burrow) */
  private targetable(e: EnemyLike) {
    if (!e.alive) return false;
    const x = e as unknown as { state?: string; anim?: { hidden?: boolean } };
    return x.state !== 'hidden' && x.state !== 'burrow' && !x.anim?.hidden;
  }

  /**
   * The point of an enemy's body closest to the ray (o, d), written to `out`.
   * Upright bodies use their axis (ankle to brow); long bodies their spine
   * spheres. Returns the angle off the ray (rad), the body's angular radius
   * there and its distance, or null if it is behind / out of range.
   */
  private bodyNear(e: EnemyLike, o: THREE.Vector3, d: THREE.Vector3, out: THREE.Vector3) {
    const long = e as unknown as { body?: Float32Array | null; bodyN?: number };
    let r = e.radius;
    if (long.body && long.bodyN) {
      let best = Infinity;
      const b = long.body;
      for (let k = 0; k < long.bodyN; k++) {
        const cx = b[k * 4], cy = b[k * 4 + 1], cz = b[k * 4 + 2];
        const t = (cx - o.x) * d.x + (cy - o.y) * d.y + (cz - o.z) * d.z;
        if (t <= 0) continue;
        const qx = o.x + d.x * t - cx, qy = o.y + d.y * t - cy, qz = o.z + d.z * t - cz;
        const m = (qx * qx + qy * qy + qz * qz) / (t * t);
        if (m < best) {
          best = m;
          out.set(cx, cy, cz);
          r = b[k * 4 + 3];
        }
      }
      if (best === Infinity) return null;
    } else {
      const hz = d.x * d.x + d.z * d.z;
      const t = hz > 1e-6 ? ((e.pos.x - o.x) * d.x + (e.pos.z - o.z) * d.z) / hz : 1;
      if (t <= 0) return null;
      const y = clamp(o.y + d.y * t, e.pos.y + e.height * 0.18, e.pos.y + e.height * 0.88);
      out.set(e.pos.x, y, e.pos.z);
    }
    const vx = out.x - o.x, vy = out.y - o.y, vz = out.z - o.z;
    const dist = Math.hypot(vx, vy, vz);
    if (dist < 1.2 || dist > AIM_ASSIST.maxRange) return null;
    const cos = (vx * d.x + vy * d.y + vz * d.z) / dist;
    if (cos <= 0.5) return null;
    return { ang: Math.acos(Math.min(1, cos)), angR: Math.atan(r / dist), dist, r };
  }

  private assistMul() {
    return AIM_ASSIST.strength * (this.input.touchMode ? AIM_ASSIST.touchMul : 1);
  }

  /**
   * Touch play: the gun fires itself (aimed shots, as fast as the hammer comes back)
   * while the assisted reticle is on a body in sight, and the view eases round
   * behind the ride whenever the aiming thumb rests.
   */
  private touchAssist(dt: number) {
    const inp = this.input;
    const w = this.weapons;
    const can = this.alive && inp.enabled && !w.dig && !w.swap && !this.reload.active && this.ammo > 0;
    const on = can && this.autoTarget();
    const hold = on && w.current === 'tommy';
    if (hold || this.autoHold) inp.touchHold('fire', hold);
    this.autoHold = hold;
    if (on && !hold && this.fireCd <= 0.02 && !inp.held('fire')) inp.touchTap('fire');
    const b = this.board;
    const idle = performance.now() - inp.touchAimAt;
    if (this.alive && idle > 650 && !this.aiming && !this.stickE && (b.speed > 0.6 || Math.abs(this.input.stick.x) > 0.06) && !b.wall.on) {
      const want = b.drifting || !b.grounded ? Math.atan2(b.vel.x, b.vel.z) : b.heading;
      const k = 1 - Math.exp(-dt * (b.grounded ? 1.7 : 0.7) * clamp((idle - 650) / 700, 0, 1));
      this.cam.nudge(wrapAngle(want - this.cam.yaw) * k, 0);
    }
  }
  private autoHold = false;

  /** desktop: when the mouse rests, the camera swings round behind a carving board, so A / D alone
   *  can turn you all the way round (steering is camera-relative, so a still camera would stall
   *  the carve side-on) */
  private followCarve(dt: number, fx: number) {
    const b = this.board;
    const idle = performance.now() - this.input.mouseMovedAt;
    if (!this.alive || this.aiming || fx === 0 || idle < 350 || b.wall.on || this.cam.cine) return;
    const want = b.drifting || !b.grounded ? Math.atan2(b.vel.x, b.vel.z) : b.heading;
    const k = 1 - Math.exp(-dt * 2.4 * clamp((idle - 350) / 300, 0, 1));
    this.cam.nudge(wrapAngle(want - this.cam.yaw) * k, 0);
  }

  /** touch auto-fire: a body inside the bullet-magnetism cone, in range and in clear sight */
  private autoTarget() {
    const A = AIM_ASSIST;
    const S = this.assistMul();
    if (S <= 0) return false;
    const o = _o.copy(this.ctx.camera.position);
    const d = this.ray.d;
    for (const e of this.ctx.enemies.list) {
      if (!this.targetable(e)) continue;
      const q = this.bodyNear(e, o, d, _pt);
      if (!q || q.dist > 60) continue;
      const far = clamp((q.dist - A.nearDist) / (A.farDist - A.nearDist), 0, 1);
      const cone = (A.coneNear + (A.coneFar - A.coneNear) * far * far * (3 - 2 * far)) * DEG * S;
      if (q.ang - q.angR > cone) continue;
      _v2.copy(_pt).sub(o);
      const L = _v2.length();
      _v2.divideScalar(L);
      if (this.ctx.world.field.raycast(o.x, o.y, o.z, _v2.x, _v2.y, _v2.z, L - 0.6) >= 0) continue;
      return true;
    }
    return false;
  }

  /** look friction over a body, keeping a target you are already on, and the ADS ease-in */
  private updateAssist(dt: number, adsEnter: boolean) {
    const A = AIM_ASSIST;
    const S = this.assistMul();
    const rk = this.reticle;
    if (S <= 0 || !this.alive) {
      this.cam.assistSens = 1;
      rk.sticky = 0;
      this.stickE = null;
      this.snap = null;
      return;
    }
    const o = _o.copy(this.ctx.camera.position);
    const d = this.ray.d;
    const list = this.ctx.enemies.list;
    // the body the reticle is on (or brushing)
    let on: EnemyLike | null = null;
    let onEdge = 0.6 * DEG;
    let onX = 0, onY = 0, onZ = 0;
    for (const e of list) {
      if (!this.targetable(e)) continue;
      const q = this.bodyNear(e, o, d, _pt);
      if (!q) continue;
      const edge = q.ang - q.angR;
      if (edge < onEdge) {
        onEdge = edge;
        on = e;
        onX = _pt.x;
        onY = _pt.y;
        onZ = _pt.z;
      }
    }
    rk.sticky = damp(rk.sticky, on ? 1 : 0, on ? 14 : 8, dt);
    this.cam.assistSens = 1 - Math.min(0.6, A.friction * S) * rk.sticky;
    // tracking: follow a fraction of the target's angular drift (riding past it, it running)
    const engaged = this.aiming || this.firing || this.animT - this.lastFireT < 0.6;
    if (on) {
      const vx = onX - o.x, vy = onY - o.y, vz = onZ - o.z;
      const yaw = Math.atan2(vx, vz), pitch = Math.atan2(vy, Math.hypot(vx, vz));
      if (on === this.stickE && engaged && this.lookMag < 40) {
        const dy = wrapAngle(yaw - this.stickYaw), dp = pitch - this.stickPitch;
        const k = Math.min(0.6, A.tracking * S);
        if (Math.abs(dy) < 0.05 && Math.abs(dp) < 0.05) this.cam.nudge(dy * k, dp * k);
      }
      this.stickYaw = yaw;
      this.stickPitch = pitch;
    }
    this.stickE = on;
    // soft snap entering ADS: nearest visible target inside a wider cone
    if (adsEnter && A.adsSnap) {
      let best: EnemyLike | null = null;
      let bestEdge = A.snapCone * DEG * Math.min(1.4, S);
      for (const e of list) {
        if (!this.targetable(e)) continue;
        const q = this.bodyNear(e, o, d, _pt);
        if (!q) continue;
        const edge = q.ang - q.angR;
        if (edge < 0 || edge >= bestEdge) continue; // already on it: nothing to do
        _v.set(e.pos.x, e.pos.y + e.height * 0.62, e.pos.z).sub(o);
        const L = _v.length();
        _v.divideScalar(L);
        if (this.ctx.world.field.raycast(o.x, o.y, o.z, _v.x, _v.y, _v.z, L - e.radius) >= 0) continue;
        bestEdge = edge;
        best = e;
      }
      this.snap = best ? { e: best, t: 0 } : null;
    }
    const sn = this.snap;
    if (sn) {
      sn.t += dt;
      if (!this.aiming || !sn.e.alive || sn.t > A.snapTime * 1.5 || this.lookMag > 14) this.snap = null;
      else {
        const e = sn.e;
        const vx = e.pos.x - o.x, vy = e.pos.y + e.height * 0.62 - o.y, vz = e.pos.z - o.z;
        const ey = wrapAngle(Math.atan2(vx, vz) - Math.atan2(d.x, d.z));
        const ep = Math.atan2(vy, Math.hypot(vx, vz)) - Math.asin(clamp(d.y, -1, 1));
        const rate = -Math.log(1 - A.snapPull) / A.snapTime;
        const k = 1 - Math.exp(-rate * dt);
        this.cam.nudge(ey * k, ep * k);
      }
    }
  }

  /**
   * Bullet magnetism: a shot that would just miss bends onto the nearest body
   * inside a small screen cone (wider at range, tighter up close), landing on
   * the side of the body the reticle was on. Null = leave the shot alone.
   */
  magnetize(o: THREE.Vector3, d: THREE.Vector3): THREE.Vector3 | null {
    const A = AIM_ASSIST;
    const S = this.assistMul();
    if (S <= 0) return null;
    let best: EnemyLike | null = null;
    let bestEdge = Infinity;
    let bx = 0, by = 0, bz = 0, br = 0;
    for (const e of this.ctx.enemies.list) {
      if (!this.targetable(e)) continue;
      const q = this.bodyNear(e, o, d, _pt);
      if (!q) continue;
      const far = clamp((q.dist - A.nearDist) / (A.farDist - A.nearDist), 0, 1);
      const cone = (A.coneNear + (A.coneFar - A.coneNear) * far * far * (3 - 2 * far)) * DEG * S;
      const edge = q.ang - q.angR;
      if (edge > cone || edge >= bestEdge) continue;
      bestEdge = edge;
      best = e;
      bx = _pt.x;
      by = _pt.y;
      bz = _pt.z;
      br = q.r;
    }
    if (!best) return null;
    // land on the near side of the body, not dead centre
    const t = Math.max(0, (bx - o.x) * d.x + (by - o.y) * d.y + (bz - o.z) * d.z);
    let lx = o.x + d.x * t - bx, lz = o.z + d.z * t - bz;
    const ll = Math.hypot(lx, lz);
    if (ll > 1e-4) {
      lx = (lx / ll) * Math.min(ll, br * 0.5);
      lz = (lz / ll) * Math.min(ll, br * 0.5);
    } else lx = lz = 0;
    return new THREE.Vector3(bx + lx - o.x, by - o.y, bz + lz - o.z).normalize();
  }

  /** current shot cone (deg): base × rested-first-shot + movement + bloom, squeezed by ADS */
  coneDeg(fanned: boolean) {
    const G = GUN_FEEL;
    const ads = this.cam.aim;
    const rested = !fanned && this.animT - this.lastFireT > G.restTime ? G.restedMul : 1;
    const laser = this.weapons ? this.weapons.tune('revolver').hipSpreadMul : 1;
    const base = (fanned ? G.fanSpread : G.hipSpread) * this.stats.get('spread') * rested * (1 - (1 - laser) * (1 - ads));
    const move = (clamp(this.speed / this.board.t.cap, 0, 1) * 0.55 + (this.board.grounded ? 0 : 0.45)) * (1 - ads * 0.6);
    return (base + move + this.spreadBloom) * (1 - ads * (1 - G.adsSpreadMul));
  }

  /** wisps curling off a hot barrel (heat builds per shot, fanning cooks it) */
  private barrelSmoke(dt: number) {
    this.heat = Math.max(0, this.heat - dt * 0.5);
    if (this.heat < 0.06 || this.animT - this.lastFireT < 0.05 || this.reload.active) {
      this.smokeAcc = 0;
      return;
    }
    this.smokeAcc += dt * (5 + this.heat * 20);
    let n = 0;
    while (this.smokeAcc >= 1 && n < 3) {
      this.smokeAcc -= 1;
      n++;
      this.ctx.fx.barrelSmoke(this.muzzleWorld, this.board.vel, this.heat);
    }
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
        const spd = this.stats.get('reloadSpeed') / (this.weapons?.tune('revolver').reloadMul ?? 1);
        const prev = R.t;
        R.t += (dt * spd) / R.dur;
        const k = R.t;
        const phase: ReloadPhase = k < 0.14 ? 'open' : k < 0.3 ? 'eject' : k < 0.86 ? 'insert' : 'close';
        if (phase !== R.phase) {
          R.phase = phase;
          if (phase === 'open') this.ctx.sfx('rev_open', this.pos, 0.8);
          if (phase === 'eject') {
            this.ctx.sfx('rev_eject', this.pos, 0.8);
            // spent brass drops out of the swung cylinder, off to the gun side
            const spent = this.maxAmmo - this.ammo;
            const cf = this.cam.forward();
            this.ctx.fx.shells(this.muzzleWorld, { x: -cf.z * 0.8 - cf.x * 0.4, y: 0, z: cf.x * 0.8 - cf.z * 0.4 }, spent, this.board.vel);
            this.ctx.sfx('shell_casing', this.pos, 0.6);
            if (spent > 2) this.ctx.engine.tweens.after(0.45, () => this.ctx.sfx('shell_casing', this.pos, 0.35, 1.12));
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

    // trigger: a click fires an aimed shot (buffered if the hammer is still
    // coming back); holding from the hip fans the hammer, holding in ADS
    // thumb-cocks steady aimed shots
    const G = GUN_FEEL;
    const want = inp.held('fire');
    const pressed = inp.hit('fire');
    this.firing = want;
    this.holdT = want ? this.holdT + dt : 0;
    if (pressed) this.shotBuffer = G.buffer;
    else this.shotBuffer -= dt;
    const rate = this.stats.get('fireRate');
    if (!R.active) {
      if (this.ammo <= 0) {
        if (pressed) {
          this.ctx.sfx('rev_dry', this.pos, 0.8);
          if (this.fanning) this.ctx.sfx('rev_hammer', this.pos, 0.5, 1.1);
          this.startReload();
        }
        this.fanning = false;
      } else if (this.fireCd <= 0) {
        if (this.shotBuffer > 0) {
          this.shotBuffer = 0;
          this.fanning = false;
          this.fanCount = 0;
          this.fireCd = this.fireInterval / rate;
          this.shoot(false);
        } else if (want && this.holdT > G.fanHold) {
          if (this.aiming) {
            this.fanning = false;
            this.fireCd = G.adsRepeat / rate;
            this.shoot(false);
          } else {
            this.fanning = true;
            this.fanCount++;
            this.fireCd = this.fanInterval / rate;
            this.shoot(true);
          }
        }
      }
    }
    if (!want || R.active || this.aiming) {
      this.fanning = false;
      if (!want) this.fanCount = 0;
    }
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
    if (this.weapons?.isLong) return this.weapons.startReload();
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
    const G = GUN_FEEL;
    this.ammo--;
    const venom = this.venomRounds > 0;
    if (venom) this.venomRounds--;
    const ads = this.cam.aim;
    // spread: a rested first shot is near pin-point; fanning sprays a sideways sweep
    const spreadDeg = this.coneDeg(fanned);
    this.lastFireT = this.animT;
    this.spreadBloom = Math.min(G.bloomMax, this.spreadBloom + (fanned ? G.bloomFan : G.bloomAimed * (1 - ads * 0.4)));
    const o = this.ray.o.clone();
    let d = this.ray.d.clone();
    const sr = spreadDeg * DEG * (fanned ? 0.45 + 0.55 * rnd.next() : Math.sqrt(rnd.next()));
    const sa = fanned ? (this.fanCount % 2 ? 0 : Math.PI) + (rnd.next() - 0.5) * 1.1 : rnd.next() * Math.PI * 2;
    const perp1 = _v.set(0, 1, 0).cross(d).normalize();
    const perp2 = _v2.copy(d).cross(perp1).normalize();
    d.addScaledVector(perp1, Math.cos(sa) * Math.tan(sr)).addScaledVector(perp2, Math.sin(sa) * Math.tan(sr)).normalize();
    // aim assist: a near miss bends onto the closest body in the cone
    let hit = ctx.enemies.raycast(o, d, 160);
    if (!hit) {
      const md = this.magnetize(o, d);
      if (md) {
        const h2 = ctx.enemies.raycast(o, md, 160);
        if (h2) {
          d = md;
          hit = h2;
        }
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
    const muzzle = this.muzzleWorld;
    // pierce through multiple enemies
    const pierce = Math.round(this.stats.get('pierce'));
    const skip = new Set<number>();
    let lastPoint = o.clone().addScaledVector(d, endT);
    let hits = 0;
    let firstHit: RayHit | null = null;
    let killed = false, head = false;
    let headAt: THREE.Vector3 | null = null;
    this.shotCrit = false;
    while (hit && hit.t < endT && hits <= pierce) {
      if (!firstHit) firstHit = hit;
      const e = hit.enemy!;
      const h: Hit = {
        base: this.baseGunDamage * (venom ? 1.35 : 1),
        kind: 'phys',
        source: 'gun',
        headshot: hit.headshot,
        status: [{ id: 'poison', stacks: venom ? 3 : 1, dur: 4, power: 2.2 }],
        knock: 2.5 * this.stats.get('knockback') * (fanned ? 1.25 : 1),
        dirX: d.x,
        dirZ: d.z,
        tags: [hit.part],
      };
      const was = e.alive;
      ctx.enemies.damage(e, h, hit.point, d);
      if (was && !e.alive) killed = true;
      if (hit.headshot && !headAt) {
        head = true;
        headAt = hit.point.clone();
      }
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
        const rock = mat === 3 || mat === 4 || mat === 5;
        ctx.fx.hit(p, n, rock ? 'rock' : 'sand', 0.9);
        ctx.sfx(rock ? 'bullet_impact_rock' : 'bullet_impact_sand', p, 0.7);
        if (rock && rnd.chance(0.22)) ctx.sfx('ricochet', p, 0.45);
      } else if (surface === 'prop') {
        ctx.fx.hit(p, { x: colHit.nx, y: 0.3, z: colHit.nz }, colHit.c?.data?.material ?? 'rock', 0.9);
        ctx.sfx('bullet_impact_rock', p, 0.6);
        ctx.events.emit('propShot', colHit.c, p, d);
      }
    }
    // the shot: flash, smoke, readable tracer, sound
    const col = venom ? 0xc8ff5a : 0xfff2a0;
    const bv = this.board.vel;
    ctx.fx.revolverMuzzle(muzzle, d, col, fanned, bv);
    ctx.fx.bulletTracer(muzzle, lastPoint, venom ? 0xc8ff5a : 0xffe2a0, !!firstHit);
    ctx.sfx('rev_shot', muzzle, 1, fanned ? 1.03 + Math.min(6, this.fanCount) * 0.008 : 1);
    if (fanned) ctx.sfx('rev_hammer', muzzle, 0.45, 1.05 + rnd.next() * 0.08); // the palm slapping the hammer
    else if (rnd.chance(0.5)) ctx.sfx('rev_hammer', muzzle, 0.25);
    this.heat = Math.min(1.6, this.heat + (fanned ? 0.2 : 0.14));
    // recoil: gun snaps in the hand, the view punches up (fans alternate side to side) and recovers
    this.gunKick.kick(fanned ? 13 : 19);
    const side = fanned ? (this.fanCount % 2 ? 1 : -1) : rnd.next() - 0.5;
    this.cam.punch((fanned ? G.kickPitchFan : G.kickPitch) * (1 - ads * 0.35), side * (fanned ? 0.013 : 0.008), fanned ? 0.8 : 1.5, fanned ? side * 0.012 : 0);
    this.cam.addTrauma(fanned ? 0.05 : 0.08);
    this.shotFeedback(firstHit, killed, head, headAt, d);
    this.onShot?.(firstHit);
    ctx.events.emit('shot', firstHit, venom);
  }

  /** feedback for any gun: hit tick, headshot ping, kill confirm with a short hit-stop (stopMul scales it) */
  shotFeedback(firstHit: RayHit | null, killed: boolean, head: boolean, headAt: THREE.Vector3 | null, d: THREE.Vector3, stopMul = 1) {
    const ctx = this.ctx;
    const G = GUN_FEEL;
    const rk = this.reticle;
    if (!firstHit) return;
    rk.hit = 1;
    ctx.sfx('ui_click', null, 0.3, 1.8 + rnd.next() * 0.15);
    if (head && headAt) {
      rk.head = 1;
      ctx.sfx('counter_clang', null, 0.2, 1.9);
      ctx.fx.headPop(headAt, d);
    }
    if (killed) {
      rk.kill = 1;
      ctx.sfx('qte_good', null, 0.38, head ? 0.9 : 0.8);
      const strong = head || this.shotCrit;
      this.cam.punch(0, 0, strong ? -2.4 : -1.4);
      const now = performance.now();
      if (now - this.killStopAt > 180) {
        this.killStopAt = now;
        ctx.engine.hitStop((strong ? G.killStopHead : G.killStop) * stopMul, 0.05);
      }
    }
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

  // ------------------------------------------------------------- dodge
  private dodgeLean = 1;
  /** a sideways hop off the board's rail: shove + hop, i-frames, afterimages, sand flung off the edge */
  private dodge(fx: number, fz: number, cf: { x: number; z: number }) {
    const b = this.board;
    const gy = this.ctx.world.groundAt(this.pos.x, this.pos.z);
    if (!b.grounded && this.pos.y - gy > 0.7) return;
    // sideways from the view: the held strafe key, else away from the last dodge
    const side = fx !== 0 ? Math.sign(fx) : -this.dodgeSide;
    this.dodgeSide = side;
    let dx = -cf.z * side + cf.x * fz * 0.35, dz = cf.x * side + cf.z * fz * 0.35;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    // kill any drift the wrong way, then the shove
    const along = b.vel.x * dx + b.vel.z * dz;
    if (along < 0) {
      b.vel.x -= dx * along;
      b.vel.z -= dz * along;
    }
    b.impulse.x += dx * DODGE.side;
    b.impulse.z += dz * DODGE.side;
    b.impulse.y += DODGE.hop;
    this.dodgeLean = dx * -Math.cos(b.heading) + dz * Math.sin(b.heading) >= 0 ? 1 : -1;
    this.dodgeCd = DODGE.cooldown;
    this.dodgeT = DODGE.iframes;
    this.invuln = Math.max(this.invuln, DODGE.iframes);
    this.perfectDodged = false;
    this.dodgeHold = true;
    this.ghostQueue = [];
    for (let i = 0; i < DODGE.ghosts; i++) this.ghostQueue.push(i * DODGE.ghostGap);
    const ctx = this.ctx;
    ctx.sfx('whoosh_big', this.pos, 0.55, 1.3);
    ctx.sfx('sand_spray', this.pos, 0.6, 1.1);
    ctx.sfx('board_jump', this.pos, 0.6, 1.15);
    ctx.fx.sandSpray({ x: this.pos.x, y: gy + 0.05, z: this.pos.z }, { x: -dx * 5, y: 1.5, z: -dz * 5 }, 1.6);
    ctx.particles.emit({ pos: { x: this.pos.x, y: gy + 0.15, z: this.pos.z }, count: 5, vel: { x: -dx * 2.5, y: 0.6, z: -dz * 2.5 }, spread: 1.2, life: [0.4, 0.8], size: [0.3, 0.8], sprite: ['puff0', 'puff1'], color: [0xe6cf9f, 0xd8b98a], alpha: 0.6, drag: 2.5, rot: 6 });
    this.cam.punch(0, 0, 1.3, side * 0.025);
    this.express('determined', 0.5);
  }

  /** something would have hit inside the dodge's i-frames: reward it */
  private perfectDodge() {
    if (this.perfectDodged) return;
    this.perfectDodged = true;
    const ctx = this.ctx;
    const c = this.center(new THREE.Vector3());
    this.dodgeT = Math.max(this.dodgeT, 0.15);
    this.invuln = Math.max(this.invuln, 0.3);
    ctx.toast('PERFECT DODGE', '#6fe3cf');
    ctx.sfx('qte_good', null, 0.5, 1.25);
    ctx.sfx('bullet_whiz', c, 0.6);
    ctx.fx.sparkle(c, 0x6fe3cf, 10, 0.7);
    ctx.engine.slowMo(0.35, 30);
    ctx.engine.tweens.after(0.22, () => ctx.engine.slowMo(1, 6), true);
    this.board.boostMeter = Math.min(1, this.board.boostMeter + 0.2);
    ctx.run.ultCharge = Math.min(1, ctx.run.ultCharge + 0.01);
    this.express('smug', 0.8);
    ctx.events.emit('perfectDodge');
  }

  /** the lean into the dodge, and the jade afterimages left along its path */
  private dodgeVisuals(dt: number) {
    if (this.dodgeT > 0) {
      const k = 1 - this.dodgeT / DODGE.iframes;
      this.tilt.rotateZ(this.dodgeLean * 0.62 * Math.sin(Math.max(0, k) * Math.PI));
    }
    for (let i = this.ghostQueue.length - 1; i >= 0; i--) {
      this.ghostQueue[i] -= dt;
      if (this.ghostQueue[i] <= 0) {
        this.ghostQueue.splice(i, 1);
        this.spawnGhost();
      }
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const gh = this.ghosts[i];
      gh.t += dt;
      const k = gh.t / DODGE.ghostLife;
      if (k >= 1) {
        gh.g.removeFromParent();
        gh.mat.dispose();
        this.ghosts.splice(i, 1);
        continue;
      }
      gh.mat.opacity = DODGE.ghostAlpha * (1 - k) * (1 - k);
    }
  }

  /** freeze Sundown's current pose (rig, gun, board) into a fading jade afterimage */
  private spawnGhost() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x8dffb8, vertexColors: true, transparent: true, opacity: DODGE.ghostAlpha, blending: THREE.AdditiveBlending, depthWrite: false });
    const g = new THREE.Group();
    this.root.updateMatrixWorld(true);
    this.root.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !(m.geometry as THREE.BufferGeometry).getAttribute('color')) return;
      const c = new THREE.Mesh(m.geometry, mat);
      c.matrixAutoUpdate = false;
      c.matrix.copy(m.matrixWorld);
      c.frustumCulled = false;
      c.renderOrder = 2;
      g.add(c);
    });
    this.ctx.scene.add(g);
    this.ghosts.push({ g, mat, t: 0 });
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
    if (!this.alive) return 0;
    if (this.dodgeT > 0 && hit.source !== 'thorns') {
      this.perfectDodge();
      return 0;
    }
    if (this.invuln > 0) return 0;
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
    if (this.action && CastAnim.owns(this.action.name)) {
      if (!this.castReady) {
        this.cast.init(this.rig);
        this.castReady = true;
      }
      this.cast.apply(this.rig, this.action.name, Math.min(1, this.action.t / this.action.dur), this.castAim ?? this.aimPoint, this.animT);
    }
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
    // long guns: the two-hand hold, swap reach, reload hands and the dig, over the riding pose
    this.weapons.pose(dt, this.pa);
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
    this.weapons?.dispose();
    this.root.removeFromParent();
    this.grappleLine.removeFromParent();
  }
}

export function wrapA(a: number) {
  return wrapAngle(a);
}
