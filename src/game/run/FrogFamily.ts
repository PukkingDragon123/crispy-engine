// The rain-frog family: a fat, grumpy-mouthed mama rain frog in her big curly
// Sunday wig sits by a rain puddle and wails — her five froglets have wandered off
// into the dunes. Ride close and the little ones hop away squeaking; chase them,
// grab them [T] and they stack up on Sundown's hat. Bring them home: one by one
// they hop off the hat into mama's arms, and when the last one is back she sings
// ("Rain") under a short desert shower. While she waits she snaps moths out of
// the air with her long sticky tongue.
// Then the thanks: a slurpy lick across the hunter's face, the FROG BLESSING (the
// family rings around him, puffs and squeaks in chorus, mama's tongue boops his
// skull: every skill cast repeats once for the rest of the run) and, finally, she
// lifts off her fabulous wig with her tongue and plops it on his head.
// Reward: a strongbox, bounty, gold, a healing hug, the blessing and the wig.
//
// EVENTS (ctx.events):
//   'frogBlessing'  the blessing landed (wire to `skills.echo = true`)
//   'frogWig'       the wig landed on his head (unlock + wear `hat:wig`, model `frogWigHat()`)
//   Until the game swaps the hat itself, the wig worn here is a mesh on the player's
//   `hat` node (the old hat mesh is hidden); it steps aside as soon as the hat changes.
//
// INTEGRATION (RunScene — this module does not touch it):
//   import { FrogFamily } from '../run/FrogFamily';
//   field:     frogs: FrogFamily | null = null;
//   enter():   after this.inter / this.missions exist:
//                const at = FrogFamily.findSpot(this.ctx, this.player.pos);   // 45-80 m away, flat, inside the storm
//                if (at) this.frogs = new FrogFamily({ ctx: this.ctx, player: this.player, inter: this.inter,
//                  addBounty: (v) => this.addBounty(v), chest: (x, z, t) => this.spawnChest(x, z, t) }, at);
//              (optional) this.frogs.reveal() to announce it right away instead of when the hunter rides near.
//   update():  after this.inter.update(e.input):   this.frogs?.update(dt);
//              if (this.frogs?.finished) { this.frogs.dispose(); this.frogs = null; }
//   updateHud(): objective + marker when no landmark mission is running:
//              ...(this.missions.active ? this.missions.hud() : this.frogs?.hud() ?? this.missions.hud())
//   exit():    this.frogs?.dispose();
// Uses the T prompt through `Interactions`; nothing is shootable (the frogs are not enemy targets).
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Player } from '../player/Player';
import type { Interactions, Interactable, ChestTier } from './Interact';
import { modelEntry } from '../models/lookup';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { VoxelModel, VF, mix } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { clamp, damp, dampAngle, rnd, hash3, smoothstep, lerp } from '../../engine/math/rand';
import { SpringF } from '../anim/spring';
import { frogWigHat, FROG_WIG_VS, FROG_WIG_PIVOT } from '../models/enemies/frog';

export interface FrogFamilyDeps {
  ctx: Ctx;
  player: Player;
  inter: Interactions;
  addBounty(v: number): void;
  /** drop a loot chest (RunScene.spawnChest) */
  chest?(x: number, z: number, tier: ChestTier): unknown;
}

type FrogState = 'idle' | 'flee' | 'tired' | 'flying' | 'carried' | 'home' | 'bless' | 'return';

interface Frog {
  mama: boolean;
  idx: number;
  rig: RigInstance;
  root: THREE.Group;
  pos: THREE.Vector3;
  yaw: number;
  height: number;
  R: number;
  state: FrogState;
  t: number;
  /** current hop (world space) */
  hop: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; h: number } | null;
  pause: number;
  stamina: number;
  flees: number;
  home: THREE.Vector3;
  breath: number;
  blinkIn: number;
  blinkT: number;
  wailIn: number;
  wailT: number;
  joy: number;
  squash: SpringF;
  jiggle: SpringF;
  sway: SpringF;
  hatWob: SpringF;
  puff: number;
  /** blessing chorus: throat ballooned, mouth open, eyes blissful (0..1) */
  chorus: number;
  /** happy squint after a snack (seconds left) */
  gulp: number;
  /** smoothed lid pose (x: closure, z: grumpy/worried slant) */
  lidX: number;
  lidZ: number;
  /** mama: corkscrew ringlets bouncing (l1, l2, r1, r2) */
  rings: SpringF[];
  /** mama: stubby arms raised (reaching for her wig) */
  armsUp: number;
  inter: Interactable | null;
  rest: Record<string, THREE.Euler>;
  restP: Record<string, THREE.Vector3>;
  /** flight onto the hat (toHat: chase the live socket) or from the hat to mama */
  fly: { from: THREE.Vector3; to: THREE.Vector3; toHat: boolean; t: number; dur: number; h: number; then: () => void } | null;
  /** already scheduled to hop off the hat */
  queued: boolean;
}

/** a moth fluttering round the puddle (mama's snacks) */
interface Moth {
  rig: RigInstance;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  from: THREE.Vector3;
  c: THREE.Vector3;
  r: number;
  h: number;
  w: number;
  ph: number;
  state: 'fly' | 'stuck' | 'gone';
  wait: number;
  /** fly-in progress after a respawn (1 = on its loop) */
  inT: number;
}

/** one flick of mama's sticky tongue */
interface Shot {
  kind: 'bug' | 'lick' | 'tap' | 'wig';
  phase: 'out' | 'act' | 'in';
  t: number;
  /** live world-space target for the sticky tip (k = progress through the act phase) */
  target: (k: number) => THREE.Vector3 | null;
  /** signed total bend: + a ballistic arc up and over onto the target, - curls back over her head */
  arc: number | ((k: number) => number);
  /** fixed yaw plane (otherwise it turns to the target) */
  psi?: number;
  out: number;
  act: number;
  back: number;
  hit: boolean;
  boops: number;
  reached?: () => void;
  released?: () => void;
  done?: () => void;
}

type ThanksStage = 'approach' | 'lick' | 'gather' | 'chorus' | 'tap' | 'reach' | 'wig' | 'fly' | 'done';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);

/** Sundown's neck joint -> hat joint, for rigs without a `hat` node */
const HEAD_TO_HAT = new THREE.Vector3(0, (59 - 46) * FROG_WIG_VS, (-1 + 1.5) * FROG_WIG_VS);
let WIG_GEO: THREE.BufferGeometry | null = null;
/** the hunter-sized wig, meshed in hat-node space (pivot = the hat joint) */
function hunterWigGeo() {
  if (!WIG_GEO) {
    WIG_GEO = buildVoxelGeometry(frogWigHat(), { voxelSize: FROG_WIG_VS, pivot: FROG_WIG_PIVOT });
    WIG_GEO.computeBoundingBox();
  }
  return WIG_GEO;
}

/** a small sculpted rain puddle: irregular rim, depth gradient, sky glints, wet-sand lip, pebbles, a grass sprig */
function puddleModel(seed: number) {
  const vs = 1 / 24;
  const m = new VoxelModel('rain_puddle');
  const R = 30;
  const ph = [seed * 1.7, seed * 2.3 + 1, seed * 0.9 + 2];
  const rim = (a: number) => R * (1 + 0.16 * Math.sin(3 * a + ph[0]) + 0.09 * Math.sin(5 * a + ph[1]) + 0.05 * Math.sin(9 * a + ph[2]));
  const E = Math.ceil(R * 1.5);
  for (let x = -E; x <= E; x++)
    for (let z = -E; z <= E; z++) {
      const gx = x + 0.5, gz = z + 0.5;
      const a = Math.atan2(gz, gx), d = Math.hypot(gx, gz);
      const r = rim(a);
      const h = hash3(x, 7, z);
      if (d < r) {
        const k = d / r;
        // deep water darkens, the shallows let the sand show through, a soft streak of sky, a few glints
        let c = mix(0x2c6878, 0x68aebb, Math.pow(k, 1.5));
        const streak = Math.abs((gx * 0.55 + gz * 0.83) / r - 0.22);
        if (streak < 0.14) c = mix(c, 0xa6d6de, (1 - streak / 0.14) * 0.45);
        if (k > 0.84) c = mix(c, 0x9c8a66, ((k - 0.84) / 0.16) * 0.65);
        const glint = h > 0.986 && k < 0.82;
        if (glint) c = 0xd2eef2;
        m.set(x, 0, z, c, glint ? VF.METAL | VF.SOFTAO : VF.SOFTAO);
      } else {
        const band = 3.5 + 2.2 * (0.5 + 0.5 * Math.sin(a * 7 + ph[1]));
        if (d < r + band) {
          const k = (d - r) / band;
          m.set(x, 0, z, mix(0x7e603e, 0xb08e62, k * k), VF.SOFTAO);
          // damp sand heaped into a soft lip here and there
          if (k < 0.55 && h > 0.6) m.set(x, 1, z, mix(0x8e6e46, 0xa88456, h));
        }
      }
    }
  // pebbles along the shore
  for (let i = 0; i < 9; i++) {
    const a = hash3(i, seed, 3) * Math.PI * 2;
    const d = rim(a) + 1 + hash3(i, 5, seed) * 3;
    const px = Math.round(Math.cos(a) * d), pz = Math.round(Math.sin(a) * d);
    const col = hash3(i, 1, 1) > 0.5 ? 0x8c8276 : 0x6e665c;
    m.set(px, 1, pz, col);
    if (hash3(i, 2, 2) > 0.4) m.set(px + 1, 1, pz, mix(col, 0xb0a698, 0.4));
    if (hash3(i, 3, 2) > 0.6) m.set(px, 2, pz, mix(col, 0xc4bcae, 0.5));
  }
  // a sprig of desert grass drinking at the edge
  const ga = ph[2] * 1.3;
  const gx0 = Math.round(Math.cos(ga) * (rim(ga) + 2)), gz0 = Math.round(Math.sin(ga) * (rim(ga) + 2));
  for (let b = 0; b < 7; b++) {
    const lean = (hash3(b, 9, seed) - 0.5) * 0.7;
    const H = 6 + Math.floor(hash3(b, 4, seed) * 7);
    const bx = gx0 + (b % 3) - 1, bz = gz0 + Math.floor(b / 3) - 1;
    for (let y = 1; y <= H; y++) m.set(bx + Math.round(lean * y * 0.5), y, bz + Math.round(lean * y * 0.3), y > H - 2 ? 0xc8b46a : y > H * 0.5 ? 0x8aa04e : 0x6a8640);
  }
  return { model: m, voxelSize: vs };
}

export class FrogFamily {
  /** a flat, open spot inside the storm 45-80 m from `near` (or null) */
  static findSpot(ctx: Ctx, near: THREE.Vector3, minR = 45, maxR = 80): THREE.Vector3 | null {
    const w = ctx.world;
    for (let k = 0; k < 40; k++) {
      const p = w.storm.randomPointNear(near.x, near.z, minR, maxR, 18);
      if (!p) continue;
      const g = w.groundAt(p.x, p.z);
      let flat = true;
      for (let i = 0; i < 8 && flat; i++) {
        const a = (i / 8) * Math.PI * 2;
        if (Math.abs(w.groundAt(p.x + Math.cos(a) * 2.2, p.z + Math.sin(a) * 2.2) - g) > 0.3) flat = false;
      }
      if (!flat) continue;
      let blocked = false;
      w.colliders.query(p.x, p.z, 4, (c) => {
        if (c.solid && Math.hypot(c.x - p.x, c.z - p.z) < c.r + 3) blocked = true;
      });
      if (blocked) continue;
      return new THREE.Vector3(p.x, g, p.z);
    }
    return null;
  }

  mama: Frog;
  babies: Frog[] = [];
  /** the hunter knows about the family (objective + marker shown) */
  revealed = false;
  /** all five are home and the reunion played */
  done = false;
  /** the family has dug back into the sand: dispose() it */
  finished = false;
  returned = 0;
  /** the blessing landed / the wig was given (each once) */
  blessed = false;
  wigGiven = false;
  private group = new THREE.Group();
  private puddle: THREE.Mesh | null = null;
  private pond: THREE.Vector3;
  private mamaInter: Interactable;
  private t = 0;
  private finaleT = -1;
  private rainT = 0;
  private buryT = -1;
  private hintCd = 0;
  private squeakCd = 0;
  private lastPlayerVel = new THREE.Vector3();
  private acc = new THREE.Vector3();
  // ---- the tongue
  private shot: Shot | null = null;
  private tongueRest = true;
  private tongueOpen = 0;
  private tN = 12;
  private tL = 0.186;
  private reachM = 2.1;
  private snapCd = 3 + rnd.next() * 3;
  private carried: Moth | null = null;
  // ---- moths, thanks sequence, wig
  private moths: Moth[] = [];
  private thanks: { stage: ThanksStage; t: number; fired: boolean; far: boolean; mask: number } | null = null;
  private blessGlow = 0;
  private bashful = 0;
  private wigCarry: { node: THREE.Object3D; grab: THREE.Vector3 } | null = null;
  private wigGrabAt = new THREE.Vector3();
  private wigFly: { node: THREE.Object3D; t: number; dur: number; h: number; from: THREE.Vector3; q0: THREE.Quaternion; s0: number; cL: THREE.Vector3; wL: number } | null = null;
  private wigWorn: { mesh: THREE.Mesh; rig: RigInstance; hat: THREE.Mesh | null; geo: THREE.BufferGeometry | null; sq: SpringF; t: number; target: THREE.Object3D } | null = null;

  constructor(private d: FrogFamilyDeps, private at: THREE.Vector3) {
    const ctx = d.ctx;
    at.y = ctx.world.groundAt(at.x, at.z);
    ctx.scene.add(this.group);
    this.pond = new THREE.Vector3(at.x + 1.1, ctx.world.groundAt(at.x + 1.1, at.z + 0.6), at.z + 0.6);
    // the puddle she waits by
    try {
      const pm = (modelEntry('rain_puddle')?.() as { model: VoxelModel; voxelSize: number } | undefined) ?? puddleModel(Math.floor(at.x * 13 + at.z * 7));
      if (pm?.model) {
        const geo = buildVoxelGeometry(pm.model, { voxelSize: pm.voxelSize, pivot: 'bottom' });
        this.puddle = new THREE.Mesh(geo, sharedVoxelMaterial);
        this.puddle.receiveShadow = true;
        this.puddle.position.set(this.pond.x, this.pond.y - 0.035, this.pond.z);
        this.puddle.rotation.y = rnd.next() * Math.PI * 2;
        this.group.add(this.puddle);
        ctx.events.emit('groundMark', this.pond.x, this.pond.z, 1.9, 0);
      }
    } catch (e) {
      console.warn('[frogs] puddle failed', e);
    }
    this.mama = this.makeFrog('rain_frog_mama', true, 0, at.clone());
    this.mama.yaw = rnd.next() * Math.PI * 2;
    const tm = this.mama.rig.geo.spec.meta?.tongue as { segments: number; segLen: number; reach: number } | undefined;
    if (tm) {
      this.tN = tm.segments;
      this.tL = tm.segLen;
      this.reachM = tm.reach;
    }
    this.mamaInter = {
      pos: this.mama.pos,
      radius: 4.2,
      label: 'Comfort Mama Rain Frog',
      enabled: true,
      promptY: 1.3,
      use: () => this.talk(),
    };
    d.inter.add(this.mamaInter);
    // five froglets scattered over the dunes around her, each hiding in a different direction
    const keys = ['rain_frog_baby', 'rain_frog_baby_v1', 'rain_frog_baby_v2', 'rain_frog_baby_v3', 'rain_frog_baby_v4'];
    const a0 = rnd.next() * Math.PI * 2;
    for (let i = 0; i < 5; i++) {
      let p: THREE.Vector3 | null = null;
      for (let k = 0; k < 12 && !p; k++) {
        const a = a0 + (i / 5) * Math.PI * 2 + (rnd.next() - 0.5) * 0.8;
        const r = 14 + rnd.next() * 20;
        const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
        if (ctx.world.storm.sdf(x, z) > 6) p = new THREE.Vector3(x, ctx.world.groundAt(x, z), z);
      }
      if (!p) p = new THREE.Vector3(at.x + (rnd.next() - 0.5) * 16, 0, at.z + (rnd.next() - 0.5) * 16);
      p.y = ctx.world.groundAt(p.x, p.z);
      const b = this.makeFrog(keys[i], false, i, p);
      b.yaw = rnd.next() * Math.PI * 2;
      b.home.copy(p);
      const inter: Interactable = { pos: b.pos, radius: 2.6, label: 'Grab the froglet', enabled: true, promptY: 0.7, use: () => this.grab(b) };
      b.inter = inter;
      d.inter.add(inter);
      this.babies.push(b);
    }
    // three fat moths fluttering round the puddle
    for (let i = 0; i < 3; i++) {
      const mo = this.makeMoth(i);
      if (mo) this.moths.push(mo);
    }
  }

  private makeFrog(key: string, mama: boolean, idx: number, at: THREE.Vector3): Frog {
    const spec = modelEntry(key)?.() as RigSpec | undefined;
    const fallback = !spec?.parts ? (modelEntry(mama ? 'rain_frog_mama' : 'rain_frog_baby')?.() as RigSpec | undefined) : spec;
    if (!fallback?.parts) throw new Error('[frogs] missing rig ' + key);
    const rig = new RigInstance(buildRigGeo(fallback, key + ':quest'), { castShadow: true });
    const root = new THREE.Group();
    root.rotation.order = 'YXZ'; // pitch in the frog's own frame, then yaw
    root.add(rig.root);
    root.position.copy(at);
    this.group.add(root);
    // the tongue's root aims with yaw-then-pitch
    if (rig.nodes['tongue1']) rig.nodes['tongue1'].rotation.order = 'YXZ';
    const meta = fallback.meta ?? {};
    const rest: Record<string, THREE.Euler> = {};
    const restP: Record<string, THREE.Vector3> = {};
    for (const p of rig.geo.parts) {
      rest[p.name] = p.rest.clone();
      restP[p.name] = p.offset.clone();
    }
    return {
      mama, idx, rig, root, pos: at, yaw: 0, height: (meta.height as number) ?? (mama ? 0.9 : 0.19), R: (meta.radius as number) ?? (mama ? 0.48 : 0.13),
      state: 'idle', t: rnd.next() * 3, hop: null, pause: 0, stamina: 0, flees: 0, home: at.clone(),
      breath: rnd.next() * 6, blinkIn: 1 + rnd.next() * 3, blinkT: -1, wailIn: 1.5 + rnd.next() * 2, wailT: -1, joy: 0,
      squash: new SpringF(1, 3.2, 0.32), jiggle: new SpringF(1, 4.5, 0.25), sway: new SpringF(0, 2.2, 0.4), hatWob: new SpringF(0, 3, 0.3),
      puff: 0, chorus: 0, gulp: 0, lidX: 0, lidZ: 0, rings: mama ? [0, 1, 2, 3].map(() => new SpringF(0, 1.6 + rnd.next() * 0.5, 0.18)) : [], armsUp: 0,
      inter: null, rest, restP, fly: null, queued: false,
    };
  }

  private makeMoth(i: number): Moth | null {
    const spec = modelEntry('rain_frog_moth')?.() as RigSpec | undefined;
    if (!spec?.parts) return null;
    const rig = new RigInstance(buildRigGeo(spec, 'rain_frog_moth:quest'), { castShadow: false });
    rig.root.scale.setScalar(1.35);
    this.group.add(rig.root);
    const pos = this.pond.clone().add(_v.set(0, 0.8, 0));
    return {
      rig, pos, prev: pos.clone(), from: pos.clone(), c: this.pond.clone(),
      r: 0.55 + i * 0.45 + rnd.next() * 0.3, h: 0.45 + rnd.next() * 0.55, w: (0.7 + rnd.next() * 0.5) * (i % 2 ? -1 : 1), ph: rnd.next() * 6.28,
      state: 'fly', wait: 0, inT: 1,
    };
  }

  /** announce the event now (otherwise it reveals itself when the hunter rides within ~45 m) */
  reveal() {
    if (this.revealed) return;
    this.revealed = true;
    this.d.ctx.toast('MAMA RAIN FROG', '#9fd8e0', 'Her five froglets wandered off — find them and bring them home');
    this.d.ctx.sfx('squeak', this.mama.pos, 0.8, 0.55);
  }

  // ------------------------------------------------------------- verbs
  private talk() {
    const ctx = this.d.ctx;
    const carried = this.babies.filter((b) => b.state === 'carried');
    if (carried.length) return this.deliver();
    if (this.done) {
      if (!this.thanks || this.thanks.stage === 'done') ctx.toast('A HAPPY FAMILY', '#9fd8e0', 'Mama hums. The froglets snore.');
      return;
    }
    this.reveal();
    this.wail(this.mama, true);
    const left = 5 - this.returned;
    ctx.toast(left === 5 ? 'FIVE LITTLE FROGLETS' : `${left} STILL OUT THERE`, '#9fd8e0', 'They hop off when you ride close — slow down and grab them [T]');
  }

  private grab(b: Frog) {
    if (b.state === 'carried' || b.state === 'flying' || b.state === 'home') return;
    const ctx = this.d.ctx;
    const pl = this.d.player;
    this.reveal();
    b.hop = null;
    if (b.inter) b.inter.enabled = false;
    // a startled squeak, a puff of sand, and up it goes onto the hat
    ctx.sfx('squeak', b.pos, 0.6, 1.7 + rnd.next() * 0.25);
    ctx.particles.emit({ pos: { x: b.pos.x, y: b.pos.y + 0.05, z: b.pos.z }, count: 8, spread: 1.2, up: 1.5, life: [0.3, 0.6], size: [0.05, 0.03], sprite: ['dot3', 'grain0'], color: [0xe0c08a, 0xc9a06a], gravity: 12, ground: true });
    const sock = this.hatSocket();
    const from = b.root.getWorldPosition(new THREE.Vector3());
    b.state = 'flying';
    b.t = 0;
    b.fly = {
      from,
      to: new THREE.Vector3(),
      toHat: true,
      t: 0,
      dur: 0.42,
      h: 0.9,
      then: () => {
        if (sock) {
          sock.add(b.root);
          const ws = sock.getWorldScale(_v2).x || 1;
          b.root.scale.setScalar(1 / ws);
          b.root.position.set(0, (this.stackIndex(b) * b.height * 0.74) / ws, 0);
          b.root.rotation.set(0, (rnd.next() - 0.5) * 0.6, 0);
        } else {
          b.root.visible = false;
        }
        b.state = 'carried';
        b.squash.kick(-3);
        ctx.sfx('squeak', pl.pos, 0.45, 1.9);
        const n = this.babies.filter((x) => x.state === 'carried').length;
        ctx.toast(n === 1 ? 'GOT ONE!' : `${n} ON YOUR HAT`, '#9fd8e0', `${this.returned + n}/5 found — take them back to mama`);
      },
    };
  }

  /** hand the froglets on the hat back to mama, one hop at a time */
  private deliver() {
    const ctx = this.d.ctx;
    const carried = this.babies.filter((b) => b.state === 'carried' && !b.queued);
    carried.sort((a, b) => this.stackIndex(b) - this.stackIndex(a));
    carried.forEach((b, i) => {
      b.queued = true;
      ctx.engine.tweens.after(i * 0.38, () => {
        if (b.state !== 'carried') return;
        const from = b.root.getWorldPosition(new THREE.Vector3());
        this.group.attach(b.root);
        b.root.scale.setScalar(1);
        const slot = this.slotFor(b);
        b.state = 'flying';
        b.fly = {
          from,
          to: slot,
          toHat: false,
          t: 0,
          dur: 0.55,
          h: 1.1,
          then: () => {
            b.state = 'home';
            b.queued = false;
            b.pos.copy(slot);
            b.squash.kick(-4);
            b.joy = 1.6;
            this.returned++;
            this.mama.joy = 2;
            this.mama.squash.kick(3);
            ctx.sfx('squeak', this.mama.pos, 0.8, 0.75);
            ctx.sfx('squeak', b.pos, 0.5, 1.8);
            ctx.particles.emit({ pos: { x: slot.x, y: slot.y + 0.05, z: slot.z }, count: 6, spread: 1, up: 1.2, life: [0.3, 0.6], size: [0.05, 0.03], sprite: 'dot3', color: [0xe0c08a, 0xc9a06a], gravity: 12, ground: true });
            if (this.returned >= 5) this.finale();
            else ctx.toast(`FROGLET HOME (${this.returned}/5)`, '#9fd8e0', this.returned === 4 ? 'One more out there…' : 'Mama squeaks with joy');
          },
        };
      });
    });
  }

  private finale() {
    const ctx = this.d.ctx;
    const pl = this.d.player;
    this.done = true;
    this.finaleT = 0;
    this.rainT = 6;
    this.mamaInter.label = 'Say goodbye';
    ctx.toast('REUNITED', '#9fd8e0', 'Mama Rain Frog sings "Rain" to her babies', true);
    ctx.sfx('sting_positive', null, 0.9);
    ctx.sfx('divine_chime', this.mama.pos, 0.6);
    ctx.engine.tweens.after(0.6, () => ctx.sfx('thunder', this.mama.pos, 0.25, 1.4));
    // a mother's thanks
    const wave = Math.max(1, ctx.run.wave);
    const bounty = 70 + wave * 5;
    this.d.addBounty(bounty);
    ctx.run.gold += 25;
    ctx.run.totalGold += 25;
    pl.heal(pl.maxHp * 0.4);
    ctx.fx.coins({ x: this.at.x, y: this.at.y + 0.8, z: this.at.z }, 10);
    ctx.engine.tweens.after(1.6, () => {
      const a = this.mama.yaw + Math.PI * 0.5;
      this.d.chest?.(this.at.x + Math.sin(a) * 2.6, this.at.z + Math.cos(a) * 2.6, 'silver');
      ctx.toast("A MOTHER'S THANKS", '#ffd36b', `+${bounty} bounty · +25 gold · healed`);
    });
    // after the song: a lick, the frog blessing, and her wig
    this.thanks = { stage: 'approach', t: -7.2, fired: false, far: false, mask: 0 };
  }

  private hatSocket(): THREE.Object3D | null {
    const r = this.d.player.rig;
    return r.sockets['hat_top'] ?? r.sockets['head_top'] ?? r.nodes['head'] ?? null;
  }
  private stackIndex(b: Frog) {
    let i = 0;
    for (const x of this.babies) {
      if (x === b) break;
      if (x.state === 'carried' || x.state === 'flying') i++;
    }
    return i;
  }
  /** a cuddle spot around mama for a returned froglet */
  private slotFor(b: Frog) {
    const a = this.mama.yaw + (b.idx - 2) * 0.62;
    const r = this.mama.R * 1.35 + 0.18;
    const x = this.mama.pos.x + Math.sin(a) * r, z = this.mama.pos.z + Math.cos(a) * r;
    return new THREE.Vector3(x, this.d.ctx.world.groundAt(x, z), z);
  }
  /** the blessing ring: mama and her five froglets evenly round the hunter */
  private ringSlot(b: Frog) {
    const pl = this.d.player.pos;
    const a = Math.atan2(this.mama.pos.x - pl.x, this.mama.pos.z - pl.z) + ((b.idx + 1) * Math.PI * 2) / 6;
    const x = pl.x + Math.sin(a) * 1.25, z = pl.z + Math.cos(a) * 1.25;
    return new THREE.Vector3(x, this.d.ctx.world.groundAt(x, z), z);
  }

  private wail(f: Frog, loud = false) {
    f.wailT = 0;
    f.wailIn = 2.6 + rnd.next() * 2.4;
    const ctx = this.d.ctx;
    ctx.sfx('squeak', f.pos, loud ? 0.9 : 0.6, 0.5 + rnd.next() * 0.1);
  }

  // ------------------------------------------------------------- update
  update(dt: number) {
    if (this.finished) return;
    const ctx = this.d.ctx;
    const pl = this.d.player;
    this.t += dt;
    this.hintCd -= dt;
    this.squeakCd -= dt;
    const pd = Math.hypot(pl.pos.x - this.mama.pos.x, pl.pos.z - this.mama.pos.z);
    if (!this.revealed && pd < 45) this.reveal();
    // the storm swallowed the puddle: the family digs in and is gone
    if (!this.done && this.buryT < 0 && ctx.world.storm.sdf(this.mama.pos.x, this.mama.pos.z) < 2 && !this.babies.some((b) => b.state === 'carried')) {
      ctx.toast('THE STORM TOOK THE PUDDLE', '#c9a97c', 'The rain frogs dug in deep. Maybe another time.');
      this.buryT = 0;
    }
    // ride up with froglets on the hat: they hop home on their own
    const carried = this.babies.filter((b) => b.state === 'carried').length;
    if (carried > 0 && pd < 3.4 && pl.speed < 9) this.deliver();
    this.mamaInter.label = carried > 0 ? `Return ${carried === 1 ? 'the froglet' : carried + ' froglets'}` : this.done ? 'Say goodbye' : 'Comfort Mama Rain Frog';
    if (this.revealed && !this.done && carried === 0 && pd < 7 && this.hintCd <= 0) {
      this.hintCd = 14;
      ctx.toast('MAMA RAIN FROG', '#9fd8e0', `${5 - this.returned} froglets still out in the dunes`);
    }
    // board acceleration rocks the stack on the hat
    const acc = this.acc.copy(pl.board.vel).sub(this.lastPlayerVel);
    this.lastPlayerVel.copy(pl.board.vel);
    this.updateMoths(dt);
    for (const b of this.babies) this.updateBaby(b, dt, acc);
    this.updateMama(dt);
    if (this.finaleT >= 0) this.updateFinale(dt);
    this.updateThanks(dt);
    this.updateWig(dt);
    if (this.buryT >= 0) this.updateBury(dt);
  }

  /** advance a hop in progress; true while airborne */
  private stepHop(f: Frog, dt: number) {
    const h = f.hop;
    if (!h) return false;
    const ctx = this.d.ctx;
    h.t += dt;
    const k = Math.min(1, h.t / h.dur);
    f.pos.lerpVectors(h.from, h.to, k);
    const g = ctx.world.groundAt(f.pos.x, f.pos.z);
    f.pos.y = g;
    f.root.position.set(f.pos.x, g + Math.sin(k * Math.PI) * h.h, f.pos.z);
    f.root.rotation.set(-0.35 * Math.sin(k * Math.PI) + 0.2 * (k - 0.5), f.yaw, 0);
    this.animFrog(f, dt, 1, k);
    if (k >= 1) {
      f.hop = null;
      f.squash.kick(f.mama ? -3 : -4.5);
      f.jiggle.kick(-3);
      f.root.rotation.set(0, f.yaw, 0);
      if (ctx.camera.position.distanceTo(f.pos) < 45) {
        ctx.particles.emit({ pos: { x: f.pos.x, y: f.pos.y + 0.03, z: f.pos.z }, count: f.mama ? 7 : 3, spread: f.mama ? 1.1 : 0.6, up: 0.7, life: [0.3, 0.6], size: [0.045, 0.025], sprite: ['dot3', 'grain0'], color: [0xe0c08a, 0xc9a06a, 0xf0d6a2], gravity: 10, ground: true });
        ctx.particles.emit({ pos: { x: f.pos.x, y: f.pos.y + 0.05, z: f.pos.z }, count: 1, spread: 0.1, up: 0.2, life: [0.4, 0.7], size: f.mama ? [0.3, 0.7] : [0.12, 0.3], sprite: ['puff0', 'puff1'], color: 0xe6cf9f, alpha: 0.5, drag: 3 });
      }
      if (f.mama) ctx.sfx('footstep_sand', f.pos, 0.5, 0.7);
      f.pause = f.mama ? 0.18 : f.state === 'flee' ? 0.08 + rnd.next() * 0.16 : f.state === 'bless' || f.state === 'return' ? 0.03 + rnd.next() * 0.08 : 0.6 + rnd.next() * 2.5;
    }
    return true;
  }

  private updateBaby(b: Frog, dt: number, acc: THREE.Vector3) {
    const ctx = this.d.ctx;
    const pl = this.d.player;
    b.t += dt;
    b.joy = Math.max(0, b.joy - dt);
    if (b.state === 'flying' && b.fly) {
      const f = b.fly;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      // flying to the hat: chase the live socket position
      if (f.toHat) {
        const s = this.hatSocket();
        if (s) s.getWorldPosition(_v2);
        else _v2.copy(pl.pos).add(_v3.set(0, 2, 0));
        _v2.y += this.stackIndex(b) * b.height * 0.74;
        b.root.position.lerpVectors(f.from, _v2, k);
      } else b.root.position.lerpVectors(f.from, f.to, k);
      b.root.position.y += Math.sin(k * Math.PI) * f.h;
      b.root.rotation.set(-Math.sin(k * Math.PI) * 0.6, b.yaw, 0);
      this.animFrog(b, dt, 1, k);
      if (k >= 1) {
        b.fly = null;
        b.root.rotation.set(0, b.yaw, 0);
        f.then();
      }
      return;
    }
    if (b.state === 'carried') {
      // riding the hat: wobbling with the board, peering around, now and then a happy squeak
      b.sway.kick(-(acc.x + acc.z) * 0.04);
      b.sway.step(0, dt);
      b.rig.root.rotation.set(Math.sin(this.t * 2.1 + b.idx) * 0.04, 0, b.sway.x * 0.5 + Math.sin(this.t * 1.7 + b.idx * 2) * 0.05);
      this.animFrog(b, dt, 0, 0);
      return;
    }
    if (b.state === 'home') {
      // cuddled up against mama, bouncing with her song in the finale
      const toM = Math.atan2(this.mama.pos.x - b.pos.x, this.mama.pos.z - b.pos.z);
      b.yaw = dampAngle(b.yaw, toM, 4, dt);
      b.root.position.copy(b.pos);
      if (this.finaleT >= 0 && this.finaleT < 7) {
        const beat = Math.max(0, Math.sin(this.finaleT * 5.2 + b.idx * 0.9));
        b.root.position.y += beat * beat * 0.12;
        if (beat > 0.98 && rnd.chance(0.3)) b.squash.kick(-2);
      }
      b.root.rotation.set(0, b.yaw, 0);
      this.animFrog(b, dt, 0, 0);
      return;
    }
    if (b.state === 'bless' || b.state === 'return') {
      // hopping into the blessing ring round the hunter, or back to mama afterwards
      if (this.stepHop(b, dt)) return;
      const tgt = b.state === 'bless' ? this.ringSlot(b) : this.slotFor(b);
      const dx = tgt.x - b.pos.x, dz = tgt.z - b.pos.z, dd = Math.hypot(dx, dz);
      b.pos.y = ctx.world.groundAt(b.pos.x, b.pos.z);
      b.root.position.copy(b.pos);
      b.pause -= dt;
      if (dd > 0.28) {
        if (b.pause <= 0) {
          this.startHop(b, Math.atan2(dx, dz), Math.min(1.05, dd), 0.26 + rnd.next() * 0.08, 0.32);
          b.pause = 0.04;
        }
      } else if (b.state === 'return') {
        b.state = 'home';
        b.pos.copy(tgt);
      } else {
        b.yaw = dampAngle(b.yaw, Math.atan2(pl.pos.x - b.pos.x, pl.pos.z - b.pos.z), 6, dt);
        if (b.joy > 0) b.root.position.y += Math.abs(Math.sin(b.t * 9 + b.idx)) * 0.09 * Math.min(1, b.joy);
      }
      b.root.rotation.set(0, b.yaw, 0);
      this.animFrog(b, dt, 0, 0);
      return;
    }
    // --- loose in the dunes
    const dx = b.pos.x - pl.pos.x, dz = b.pos.z - pl.pos.z;
    const dpl = Math.hypot(dx, dz);
    if (this.stepHop(b, dt)) return;
    b.root.position.set(b.pos.x, ctx.world.groundAt(b.pos.x, b.pos.z), b.pos.z);
    b.pos.y = b.root.position.y;
    b.root.rotation.set(0, b.yaw, 0);
    b.pause -= dt;
    if (b.state === 'idle') {
      // the hunter rides close: off it goes
      if (dpl < 7.5 && (pl.speed > 1.5 || dpl < 4)) {
        b.state = 'flee';
        b.stamina = Math.max(2, 6 - b.flees * 2) + Math.floor(rnd.next() * 2);
        b.flees++;
        b.pause = 0.12;
        ctx.sfx('squeak', b.pos, 0.55, 1.75 + rnd.next() * 0.3);
        b.squash.kick(4);
      } else if (b.pause <= 0) {
        // potter about near its spot, looking around
        const a = rnd.next() * Math.PI * 2;
        const tx = b.pos.x + Math.cos(a) * 0.7, tz = b.pos.z + Math.sin(a) * 0.7;
        const back = Math.hypot(tx - b.home.x, tz - b.home.z) > 4;
        this.startHop(b, back ? Math.atan2(b.home.x - b.pos.x, b.home.z - b.pos.z) : Math.atan2(tx - b.pos.x, tz - b.pos.z), 0.5 + rnd.next() * 0.35, 0.16, 0.34);
      }
    } else if (b.state === 'flee') {
      if (b.pause <= 0) {
        if (b.stamina <= 0) {
          b.state = 'tired';
          b.t = 0;
          b.pause = 1.8 + rnd.next() * 0.8;
        } else {
          b.stamina--;
          // away from the hunter, a little zig-zag, kept near mama and inside the storm
          let a = Math.atan2(dx, dz) + (rnd.next() - 0.5) * 1.2;
          const hx = b.pos.x - this.mama.pos.x, hz = b.pos.z - this.mama.pos.z;
          if (Math.hypot(hx, hz) > 40) a = Math.atan2(-hx, -hz) + (rnd.next() - 0.5) * 0.8;
          if (ctx.world.storm.sdf(b.pos.x, b.pos.z) < 6) {
            const inw = ctx.world.storm.inward(b.pos.x, b.pos.z, { x: 0, z: 0 });
            a = Math.atan2(inw.x, inw.z) + (rnd.next() - 0.5) * 0.6;
          }
          this.startHop(b, a, 1.25 + rnd.next() * 0.55, 0.32 + rnd.next() * 0.12, 0.38);
        }
      }
    } else if (b.state === 'tired') {
      // panting, throat pumping: easy to scoop up
      if (b.pause <= 0) {
        if (dpl < 5.5 && b.flees < 4) {
          b.state = 'flee';
          b.stamina = 2 + Math.floor(rnd.next() * 2);
          b.flees++;
        } else {
          b.state = 'idle';
          b.home.copy(b.pos);
          b.pause = 1 + rnd.next() * 2;
        }
      }
      b.yaw = dampAngle(b.yaw, Math.atan2(-dx, -dz), 3, dt);
    }
    this.animFrog(b, dt, 0, 0);
  }

  private startHop(b: Frog, ang: number, dist: number, h: number, dur: number) {
    const ctx = this.d.ctx;
    b.yaw = ang;
    const to = new THREE.Vector3(b.pos.x + Math.sin(ang) * dist, 0, b.pos.z + Math.cos(ang) * dist);
    to.y = ctx.world.groundAt(to.x, to.z);
    // no hopping off cliffs or into rocks
    if (Math.abs(to.y - b.pos.y) > 1.2) return;
    let blocked = false;
    ctx.world.colliders.query(to.x, to.z, 1, (c) => {
      if (c.solid && Math.hypot(c.x - to.x, c.z - to.z) < c.r + 0.2) blocked = true;
    });
    if (blocked) {
      b.yaw += Math.PI * 0.5;
      b.pause = 0.1;
      return;
    }
    b.hop = { from: b.pos.clone(), to, t: 0, dur, h };
    b.squash.kick(3.5);
    // every little hop gets a squeak (and a tiny note when the camera is close)
    if (!b.mama && this.squeakCd <= 0) {
      const camD = ctx.camera.position.distanceTo(b.pos);
      if (camD < 28) {
        this.squeakCd = 0.09;
        ctx.sfx('squeak', b.pos, 0.18 + rnd.next() * 0.12 + (b.state === 'flee' ? 0.12 : 0), 1.95 + rnd.next() * 0.45);
        if (camD < 16 && rnd.chance(0.5))
          ctx.particles.emit({ pos: { x: b.pos.x, y: b.pos.y + b.height * 1.1, z: b.pos.z }, count: 1, vel: { x: 0, y: 0.7, z: 0 }, spread: 0.25, life: [0.5, 0.7], size: [0.07, 0.05], sprite: 'fx_note', color: [0xffffff, 0xfff0c0], gravity: -0.4, drag: 2 });
      }
    }
  }

  private updateMama(dt: number) {
    const m = this.mama;
    const ctx = this.d.ctx;
    const pl = this.d.player;
    m.t += dt;
    m.joy = Math.max(0, m.joy - dt);
    m.gulp = Math.max(0, m.gulp - dt);
    this.bashful = Math.max(0, this.bashful - dt);
    const pd = Math.hypot(pl.pos.x - m.pos.x, pl.pos.z - m.pos.z);
    // turn to the hunter when he is near, otherwise look out over the dunes for her babies
    const look = pd < 14 ? Math.atan2(pl.pos.x - m.pos.x, pl.pos.z - m.pos.z) : m.yaw + Math.sin(m.t * 0.25) * 0.02;
    if (!m.hop) m.yaw = dampAngle(m.yaw, look, pd < 14 ? 1.6 : 0.4, dt);
    // waiting: rocks side to side and wails now and then, tears dripping into the puddle
    if (!this.done) {
      m.wailIn -= dt;
      if (m.wailIn <= 0 && pd < 60 && !this.shot) this.wail(m);
      if (m.wailT >= 0 && pd < 40 && rnd.chance(dt * 6)) {
        const eye = m.rig.nodes['eye_' + (rnd.chance(0.5) ? 'l' : 'r')];
        if (eye) {
          eye.getWorldPosition(_v2);
          ctx.particles.emit({ pos: { x: _v2.x, y: _v2.y - 0.03, z: _v2.z }, count: 1, vel: { x: 0, y: -0.2, z: 0 }, spread: 0.2, life: [0.5, 0.8], size: [0.05, 0.035], sprite: 'dot3', color: [0xbfe6f0, 0x8fcfe0], gravity: 6, ground: true });
        }
      }
    }
    m.pause -= dt;
    if (this.stepHop(m, dt)) {
      this.poseTongue(dt);
      return;
    }
    const hopJoy = m.joy > 0 && this.finaleT < 0 ? Math.max(0, Math.sin(m.t * 9)) * 0.08 * Math.min(1, m.joy) : 0;
    let bob = hopJoy;
    if (this.finaleT >= 0 && this.finaleT < 7) bob += Math.max(0, Math.sin(this.finaleT * 5.2)) ** 2 * 0.06;
    m.pos.y = ctx.world.groundAt(m.pos.x, m.pos.z);
    m.root.position.set(m.pos.x, m.pos.y + bob, m.pos.z);
    m.root.rotation.set(0, m.yaw, 0);
    const rock = !this.done ? Math.sin(m.t * 1.6) * 0.06 : this.finaleT >= 0 && this.finaleT < 7 ? Math.sin(this.finaleT * 2.6) * 0.1 : Math.sin(m.t * 0.9) * 0.02;
    m.rig.root.rotation.set(0, 0, rock * (this.shot ? 0.3 : 1));
    // between sobs she still snaps a moth out of the air now and then
    const busy = this.thanks && this.thanks.stage !== 'done';
    if (!this.shot && !busy && ctx.camera.position.distanceTo(m.pos) < 40) {
      this.snapCd -= dt;
      if (this.snapCd <= 0) this.trySnap();
    }
    this.animFrog(m, dt, 0, 0);
    this.poseTongue(dt);
  }

  // ------------------------------------------------------------- the sticky tongue
  private tongueRoot(out: THREE.Vector3) {
    const t1 = this.mama.rig.nodes['tongue1'];
    return t1 ? t1.getWorldPosition(out) : out.copy(this.mama.pos).setY(this.mama.pos.y + 0.3);
  }
  private fire(s: Omit<Shot, 'phase' | 't' | 'hit' | 'boops'>) {
    if (!this.mama.rig.nodes['tongue1']) {
      s.reached?.();
      s.released?.();
      s.done?.();
      return;
    }
    this.shot = { ...s, phase: 'out', t: 0, hit: false, boops: 0 };
    this.d.ctx.sfx('grapple_fire', this.mama.pos, 0.3, 2.2 + rnd.next() * 0.2);
  }

  /** pick a moth in reach and flick it out of the air */
  private trySnap() {
    const m = this.mama;
    this.snapCd = 1;
    this.tongueRoot(_v);
    const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
    let best: Moth | null = null, bd = this.reachM * 0.8;
    for (const mo of this.moths) {
      if (mo.state !== 'fly' || mo.inT < 1) continue;
      const dd = mo.pos.distanceTo(_v);
      const front = ((mo.pos.x - _v.x) * fx + (mo.pos.z - _v.z) * fz) / Math.max(0.01, Math.hypot(mo.pos.x - _v.x, mo.pos.z - _v.z));
      if (dd < bd && front > -0.1) {
        bd = dd;
        best = mo;
      }
    }
    if (!best) return;
    const mo = best;
    const ctx = this.d.ctx;
    this.snapCd = (this.done ? 3.5 : 6.5) + rnd.next() * 4;
    this.fire({
      kind: 'bug',
      out: 0.13,
      act: 0.06,
      back: 0.32,
      arc: 0.35,
      target: () => (mo.state === 'fly' ? mo.pos : null),
      reached: () => {
        mo.state = 'stuck';
        this.carried = mo;
        ctx.sfx('scarab_squish', mo.pos, 0.22, 2.2);
        ctx.particles.emit({ pos: { x: mo.pos.x, y: mo.pos.y, z: mo.pos.z }, count: 5, spread: 0.7, life: [0.2, 0.4], size: [0.03, 0.015], sprite: 'dot3', color: [0xf2e6cc, 0xffd2da], gravity: 4 });
      },
      done: () => {
        if (this.carried === mo) {
          this.carried = null;
          mo.state = 'gone';
          mo.rig.root.visible = false;
          mo.wait = 4 + rnd.next() * 5;
          // gulp: eyes squeezed happily shut, throat bulges, a contented little squeak
          m.gulp = 0.9;
          m.puff = 1;
          m.squash.kick(1.6);
          ctx.sfx('squeak', m.pos, 0.4, 0.62 + rnd.next() * 0.08);
        }
      },
    });
  }

  /** pose the tongue chain for the current shot (jaw already posed this frame) */
  private poseTongue(dt: number) {
    const m = this.mama, n = m.rig.nodes;
    const t1 = n['tongue1'], jaw = n['jaw'];
    const S = this.shot;
    if (!t1 || !jaw) return;
    if (!S) {
      this.tongueOpen = damp(this.tongueOpen, 0, 10, dt);
      if (!this.tongueRest) {
        this.tongueRest = true;
        for (let i = 1; i <= this.tN; i++) {
          const nd = n['tongue' + i];
          nd.rotation.set(0, 0, 0);
          nd.position.copy(m.restP['tongue' + i]);
        }
      }
      return;
    }
    this.tongueRest = false;
    S.t += dt;
    let flip = 1, reach = 1, curl = 0, k = 0;
    if (S.phase === 'out') {
      const p = Math.min(1, S.t / S.out);
      flip = smoothstep(0, 0.45, p);
      reach = 1 - (1 - smoothstep(0.12, 1, p)) ** 3;
      if (p >= 1) {
        S.phase = 'act';
        S.t = 0;
        if (!S.hit) {
          S.hit = true;
          S.reached?.();
        }
      }
    } else if (S.phase === 'act') {
      k = Math.min(1, S.t / Math.max(0.001, S.act));
      if (S.kind === 'tap') {
        // boop, boop: the sticky tip bounces off his skull
        reach = 1 - 0.16 * Math.abs(Math.sin(k * Math.PI * 2));
        const b = Math.floor(k * 2 + 1e-6);
        if (b > S.boops && b <= 2) {
          S.boops = b;
          this.boop(0.6);
        }
      }
      if (S.t >= S.act) {
        k = 1;
        S.phase = 'in';
        S.t = 0;
        S.released?.();
      }
    } else {
      const p = Math.min(1, S.t / S.back);
      reach = 1 - p * p * (3 - 2 * p);
      curl = Math.sin(p * Math.PI) * 1.7; // rolls back up like a party blower
      flip = 1 - smoothstep(0.55, 1, p);
      k = 1;
      if (p >= 1) {
        this.shot = null;
        S.done?.();
        this.poseTongue(0);
        return;
      }
    }
    this.tongueOpen = Math.max(this.tongueOpen, flip);
    // aim in the jaw's own frame
    const tw = S.phase === 'in' ? null : S.target(k);
    if (tw) this.aimW.copy(tw);
    else if (S.phase !== 'in') {
      S.phase = 'in';
      S.t = 0;
    }
    jaw.updateWorldMatrix(true, false);
    const loc = jaw.worldToLocal(_v.copy(this.aimW));
    const root = m.restP['tongue1'];
    const dx = loc.x - root.x, dy = loc.y - root.y, dz = loc.z - root.z;
    const psi = S.psi ?? Math.atan2(dx, dz);
    const h = dx * Math.sin(psi) + dz * Math.cos(psi);
    const phiT = Math.atan2(dy, -h);
    const dist = Math.hypot(dx, dy, dz);
    const arc = typeof S.arc === 'function' ? S.arc(k) : S.arc;
    const a = Math.abs(arc) / 2;
    const len = dist * (a > 0.02 ? a / Math.sin(a) : 1);
    const N = this.tN, L = this.tL;
    const s = clamp((len - L * 1.05) / (N - 1), 0, L * 0.95) * reach;
    t1.rotation.set(flip * (phiT - arc / 2), flip * psi, 0);
    const wob = S.phase === 'act' ? Math.sin(this.t * 30) * 0.02 : 0;
    for (let i = 2; i <= N; i++) {
      const nd = n['tongue' + i];
      const u = (i - 1) / (N - 1);
      nd.position.set(0, 0, -s);
      nd.rotation.set(flip * (arc / (N - 1)) + curl * u * u * 0.55 + wob, 0, 0);
    }
    // things stuck to the tip ride along
    const tip = n['tongue_tip'];
    if (tip && (this.carried || this.wigCarry || S.kind === 'lick')) {
      tip.getWorldPosition(_v2);
      if (this.carried) {
        this.carried.pos.copy(_v2);
        this.carried.rig.root.position.copy(_v2);
      }
      if (this.wigCarry) this.carryWig(_v2, dt);
      if (S.kind === 'lick' && S.phase === 'act' && rnd.chance(dt * 40))
        this.d.ctx.particles.emit({ pos: { x: _v2.x, y: _v2.y, z: _v2.z }, count: 1, spread: 0.5, life: [0.3, 0.6], size: [0.045, 0.02], sprite: rnd.chance(0.5) ? 'bubble' : 'dot3', color: [0xfff0f4, 0xffc8d4, 0xd8f4ff], gravity: 3, drag: 1.5 });
    }
  }
  private aimW = new THREE.Vector3();

  /** a sparkly boop on the hunter's skull */
  private boop(vol: number) {
    const p = this.facePts().brow;
    const ctx = this.d.ctx;
    ctx.sfx('gem_chime', p, vol * 0.6, 1.5 + rnd.next() * 0.2);
    ctx.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: 7, spread: 1.4, life: [0.3, 0.6], size: [0.09, 0.03], sprite: 'star4', color: [0xffffff, 0xfff0a6, 0xb8ffd8], additive: true, drag: 3 });
  }

  // ------------------------------------------------------------- the moths
  private updateMoths(dt: number) {
    const ctx = this.d.ctx;
    const camD = ctx.camera.position.distanceTo(this.pond);
    for (const mo of this.moths) {
      const n = mo.rig.nodes;
      if (mo.state === 'gone') {
        mo.wait -= dt;
        if (mo.wait <= 0 && !this.finished) {
          // a new one flutters in from the dunes
          const a = rnd.next() * Math.PI * 2;
          mo.from.set(this.pond.x + Math.cos(a) * 7, this.pond.y + 1.6 + rnd.next(), this.pond.z + Math.sin(a) * 7);
          mo.pos.copy(mo.from);
          mo.prev.copy(mo.from);
          mo.inT = 0;
          mo.state = 'fly';
          mo.rig.root.visible = true;
        }
        continue;
      }
      if (mo.state === 'stuck') {
        // flailing on the sticky tip
        if (n['wing_l'] && n['wing_r']) {
          const f = Math.sin(this.t * 55) * 0.5;
          n['wing_l'].rotation.z = 0.6 + f;
          n['wing_r'].rotation.z = -0.6 - f;
        }
        continue;
      }
      mo.ph += dt * mo.w;
      const g = ctx.world.groundAt(mo.c.x, mo.c.z);
      const wob = 1 + 0.25 * Math.sin(mo.ph * 2.3 + mo.r * 5);
      _v.set(mo.c.x + Math.cos(mo.ph) * mo.r * wob, g + mo.h + Math.sin(mo.ph * 2.7) * 0.18 + Math.sin(this.t * 4.1 + mo.r * 9) * 0.06, mo.c.z + Math.sin(mo.ph) * mo.r * wob);
      if (mo.inT < 1) {
        mo.inT = Math.min(1, mo.inT + dt / 2.4);
        mo.pos.lerpVectors(mo.from, _v, smoothstep(0, 1, mo.inT));
      } else mo.pos.copy(_v);
      mo.pos.y += Math.sin(this.t * 23 + mo.r * 10) * 0.015; // the flutter
      const vx = mo.pos.x - mo.prev.x, vz = mo.pos.z - mo.prev.z;
      const yaw = vx * vx + vz * vz > 1e-8 ? Math.atan2(vx, vz) : mo.rig.root.rotation.y;
      mo.rig.root.position.copy(mo.pos);
      mo.rig.root.rotation.set(-0.2, yaw, Math.sin(mo.ph * 3) * 0.25);
      mo.prev.copy(mo.pos);
      if (camD < 40 && n['wing_l'] && n['wing_r']) {
        const f = Math.sin(this.t * 36 + mo.r * 7);
        n['wing_l'].rotation.z = 0.2 + f * 0.9;
        n['wing_r'].rotation.z = -0.2 - f * 0.9;
      }
      // a few pixel scales drifting off the wings
      if (camD < 22 && rnd.chance(dt * 1.2)) ctx.particles.emit({ pos: { x: mo.pos.x, y: mo.pos.y, z: mo.pos.z }, count: 1, spread: 0.2, life: [0.5, 0.9], size: [0.02, 0.01], sprite: 'dot3', color: [0xf0e2c0, 0xe2b4a4], gravity: 0.6, drag: 2 });
    }
  }

  // ------------------------------------------------------------- the thanks: lick, blessing, wig
  /** points on the hunter's face (world): chin/mouth, between the eyes, the brow, the skull top */
  private facePts() {
    const r = this.d.player.rig;
    const pl = this.d.player;
    const head = r.nodes['head'];
    const get = (s: string) => {
      const o = r.sockets[s];
      return o ? o.getWorldPosition(new THREE.Vector3()) : null;
    };
    const up = head ? new THREE.Vector3(0, 1, 0).applyQuaternion(head.getWorldQuaternion(_q)) : new THREE.Vector3(0, 1, 0);
    // the side of his face she can reach: his facing, leaned toward mama (he rides side-on)
    const face = head ? head.getWorldDirection(new THREE.Vector3()) : new THREE.Vector3(0, 0, 1);
    const toM = new THREE.Vector3(this.mama.pos.x - pl.pos.x, 0, this.mama.pos.z - pl.pos.z).normalize();
    const fwd = face.multiplyScalar(0.45).add(toM).normalize();
    const mouth = get('mouth') ?? pl.pos.clone().add(_v3.set(0, 1.45, 0));
    const el = get('eye_l'), er = get('eye_r');
    const eyes = el && er ? el.add(er).multiplyScalar(0.5) : mouth.clone().addScaledVector(up, 0.22);
    const top = get('head_top') ?? eyes.clone().addScaledVector(up, 0.25);
    return {
      mouth: mouth.addScaledVector(fwd, 0.05),
      eyes: eyes.clone().addScaledVector(fwd, 0.07),
      brow: eyes.addScaledVector(up, 0.08).addScaledVector(fwd, 0.05),
      top,
      fwd,
    };
  }
  /** the lick: from his chin, up over his teeth and between the sockets to the brow */
  private lickPoint(k: number) {
    const f = this.facePts();
    const u = smoothstep(0, 1, k);
    const a = f.mouth.clone().lerp(f.eyes, u), b = f.eyes.clone().lerp(f.brow, u);
    return a.lerp(b, u);
  }
  private tipDist(p: THREE.Vector3) {
    return this.tongueRoot(_v3).distanceTo(p);
  }
  private goThanks(stage: ThanksStage, delay = 0) {
    const T = this.thanks;
    if (!T) return;
    T.stage = stage;
    T.t = -delay;
    T.fired = false;
    T.mask = 0;
  }

  private updateThanks(dt: number) {
    const T = this.thanks;
    if (!T || T.stage === 'done') return;
    const ctx = this.d.ctx, pl = this.d.player, m = this.mama;
    T.t += dt;
    if (this.blessGlow > 0) {
      // motes of the blessing drifting up round the hunter
      this.blessGlow -= dt;
      if (rnd.chance(dt * 26)) {
        const a = rnd.next() * Math.PI * 2, r = 0.3 + rnd.next() * 0.5;
        ctx.particles.emit({ pos: { x: pl.pos.x + Math.cos(a) * r, y: pl.pos.y + 0.2 + rnd.next() * 1.4, z: pl.pos.z + Math.sin(a) * r }, count: 1, vel: { x: 0, y: 0.6, z: 0 }, spread: 0.15, life: [0.6, 1.1], size: [0.06, 0.02], sprite: rnd.chance(0.3) ? 'star4' : 'spark', color: [0xb8ffd8, 0xfff0a6, 0xffffff], additive: true, drag: 1 });
      }
    }
    if (T.t < 0) return;
    const pd = Math.hypot(pl.pos.x - m.pos.x, pl.pos.z - m.pos.z);
    switch (T.stage) {
      case 'approach': {
        // waddle-hop up to him so her tongue can reach
        if (pd > 14) {
          T.far = true;
          this.goThanks('chorus');
        } else if (pd > 1.4 && T.t < 7) {
          if (!m.hop && m.pause <= 0) this.startHop(m, Math.atan2(pl.pos.x - m.pos.x, pl.pos.z - m.pos.z), Math.min(0.7, pd - 1.15), 0.16, 0.42);
        } else if (!m.hop) this.goThanks(this.tipDist(this.facePts().brow) < this.reachM * 0.93 ? 'lick' : 'gather');
        break;
      }
      case 'lick': {
        if (T.fired) break;
        T.fired = true;
        pl.express('surprised', 1.2);
        this.fire({
          kind: 'lick',
          out: 0.16,
          act: 0.75,
          back: 0.4,
          arc: 0.45,
          target: (k) => this.lickPoint(k),
          reached: () => {
            ctx.sfx('scarab_squish', pl.pos, 0.35, 1.6);
            ctx.sfx('squeak', m.pos, 0.5, 1.15);
          },
          done: () => {
            pl.express('laugh', 1.8);
            ctx.particles.emit({ pos: { x: pl.pos.x, y: pl.pos.y + 1.9, z: pl.pos.z }, count: 2, spread: 0.6, up: 0.6, life: [0.7, 1], size: [0.1, 0.08], sprite: 'fx_heart', color: 0xffffff, gravity: -0.3, drag: 1.5 });
            this.goThanks('gather', 0.35);
          },
        });
        break;
      }
      case 'gather': {
        if (!T.fired) {
          T.fired = true;
          for (const b of this.babies)
            if (b.state === 'home') {
              b.state = 'bless';
              b.pause = b.idx * 0.1;
            }
          ctx.sfx('squeak', m.pos, 0.6, 1.3);
        }
        const there = this.babies.every((b) => b.state !== 'bless' || (!b.hop && b.pos.distanceTo(this.ringSlot(b)) < 0.45));
        if ((there && T.t > 0.8) || T.t > 4.5) this.goThanks('chorus');
        break;
      }
      case 'chorus': {
        // one after another they balloon their throats and squeak, rising sparkles, then mama joins in
        const singers = [...this.babies, m];
        singers.forEach((f, i) => {
          const k = (T.t - i * 0.2) / 0.85;
          f.chorus = k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0;
          if (k > 0 && !(T.mask & (1 << i))) {
            T.mask |= 1 << i;
            ctx.sfx('squeak', f.pos, f.mama ? 0.7 : 0.45, f.mama ? 0.9 : 1.45 + i * 0.12);
            f.squash.kick(2);
            ctx.particles.emit({ pos: { x: f.pos.x, y: f.pos.y + f.height * 0.8, z: f.pos.z }, count: f.mama ? 10 : 5, vel: { x: 0, y: 1.1, z: 0 }, spread: 0.5, life: [0.6, 1.0], size: [0.08, 0.02], sprite: ['star4', 'spark'], color: [0xb8ffd8, 0xfff0a6, 0xffffff], additive: true, drag: 1.2 });
          }
        });
        if (T.t > singers.length * 0.2 + 0.9) {
          for (const f of singers) f.chorus = 0;
          this.goThanks('tap');
        }
        break;
      }
      case 'tap': {
        if (T.fired) break;
        T.fired = true;
        if (!T.far && this.tipDist(this.facePts().brow) < this.reachM * 0.95) {
          this.fire({
            kind: 'tap',
            out: 0.16,
            act: 0.6,
            back: 0.36,
            arc: 0.95,
            target: () => this.facePts().brow,
            reached: () => this.bless(),
            done: () => this.goThanks('reach', 0.8),
          });
        } else {
          this.bless();
          this.goThanks('reach', 1.2);
        }
        break;
      }
      case 'reach': {
        // she tries to lift her wig off with her stubby little arms… they don't reach
        m.armsUp = Math.min(1, T.t / 0.25);
        if (!T.fired) {
          T.fired = true;
          ctx.sfx('squeak', m.pos, 0.5, 0.8);
        }
        if (T.t > 1.15) {
          m.armsUp = 0;
          this.goThanks('wig');
        }
        break;
      }
      case 'wig': {
        if (T.fired) break;
        T.fired = true;
        const wig = m.rig.nodes['wig'];
        const sock = m.rig.sockets['wig_top'];
        if (!wig || !sock) {
          this.landWig();
          break;
        }
        // …so she uses her tongue: stick to the top, lift it off, swing it over to him
        const p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
        this.fire({
          kind: 'wig',
          out: 0.2,
          act: 0.95,
          back: 0.42,
          psi: 0,
          arc: (k) => lerp(-1.7, 0.5, smoothstep(0.1, 0.85, k)),
          target: (k) => {
            if (!this.wigCarry) return sock.getWorldPosition(this.wigGrabAt);
            m.root.localToWorld(p1.set(0, 1.3, 0.3));
            m.root.localToWorld(p2.set(0, 1.15, 0.95));
            const u = smoothstep(0, 1, k);
            return _v2.copy(this.wigGrabAt).lerp(p1, u).lerp(_v3.copy(p1).lerp(p2, u), u);
          },
          reached: () => {
            // the wig lifts off her bald little head
            this.group.attach(wig);
            this.wigCarry = { node: wig, grab: sock.position.clone() };
            ctx.sfx('scarab_squish', this.wigGrabAt, 0.3, 1.3);
            ctx.sfx('paper_flutter', this.wigGrabAt, 0.5, 1.2);
            m.squash.kick(2);
          },
          released: () => this.launchWig(),
        });
        break;
      }
      default:
        break;
    }
  }

  private bless() {
    if (this.blessed) return;
    this.blessed = true;
    const ctx = this.d.ctx, pl = this.d.player;
    const p = this.facePts().brow;
    ctx.events.emit('frogBlessing');
    ctx.toast('FROG BLESSING', '#a8f0c8', 'Your skills cast twice for the rest of the run', true);
    ctx.sfx('divine_chime', p, 0.8, 1.25);
    ctx.sfx('squeak', p, 0.55, 1.6);
    this.boop(1);
    ctx.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: 24, spread: 2.6, life: [0.4, 0.9], size: [0.11, 0.03], sprite: ['star4', 'spark'], color: [0xb8ffd8, 0xfff0a6, 0xffffff], additive: true, drag: 2.5 });
    ctx.particles.emit({ pos: { x: pl.pos.x, y: pl.pos.y + 0.1, z: pl.pos.z }, count: 1, life: [0.5, 0.5], size: [0.3, 2.6], sprite: 'ring', color: 0xb8ffd8, additive: true, alpha: 0.7 });
    this.blessGlow = 2.4;
    pl.express('surprised', 0.6);
    ctx.engine.tweens.after(0.6, () => pl.express('laugh', 1.6));
    for (const b of this.babies) {
      b.joy = 1.4;
      b.squash.kick(4);
    }
    // the little ones hop back to mama
    ctx.engine.tweens.after(1.5, () => {
      for (const b of this.babies) if (b.state === 'bless') b.state = 'return';
    });
  }

  /** while on the tongue: the wig hangs from the sticky tip, staying upright and swinging */
  private carryWig(tip: THREE.Vector3, dt: number) {
    const c = this.wigCarry!;
    const node = c.node;
    node.quaternion.slerp(_q.setFromAxisAngle(_y, this.mama.yaw), Math.min(1, dt * 6));
    node.position.copy(tip).sub(_v3.copy(c.grab).multiplyScalar(node.scale.x).applyQuaternion(node.quaternion));
  }

  private hatHolder() {
    const r = this.d.player.rig;
    return { node: r.nodes['hat'] ?? r.nodes['head'] ?? null, offset: r.nodes['hat'] ? null : HEAD_TO_HAT };
  }

  /** the tongue lets go: the wig sails over in a twirl, shrinking to fit his head */
  private launchWig() {
    const c = this.wigCarry;
    this.wigCarry = null;
    const mesh = this.mama.rig.meshes['wig'];
    if (!c || !mesh) return this.landWig();
    const g = mesh.geometry;
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const cL = bb.getCenter(new THREE.Vector3());
    const pd = this.d.player.pos.distanceTo(this.mama.pos);
    this.wigFly = { node: c.node, t: 0, dur: clamp(0.55 + pd * 0.05, 0.6, 1.6), h: 0.5 + pd * 0.12, from: c.node.localToWorld(cL.clone()), q0: c.node.quaternion.clone(), s0: c.node.scale.x, cL, wL: bb.max.x - bb.min.x };
    this.d.ctx.sfx('whoosh', this.mama.pos, 0.35, 1.6);
    this.bashful = 2.2;
    this.mama.joy = 2;
  }

  private updateWig(dt: number) {
    const F = this.wigFly;
    if (F) {
      F.t += dt;
      const k = Math.min(1, F.t / F.dur);
      const e = k * k * (3 - 2 * k);
      const H = this.hatHolder();
      if (!H.node) {
        this.wigFly = null;
        F.node.removeFromParent();
        this.landWig();
        return;
      }
      const hg = hunterWigGeo();
      const cH = hg.boundingBox!.getCenter(_v3);
      if (H.offset) cH.add(H.offset);
      const to = H.node.localToWorld(cH);
      const hq = H.node.getWorldQuaternion(new THREE.Quaternion());
      const hs = H.node.getWorldScale(_v2).x;
      const wH = hg.boundingBox!.max.x - hg.boundingBox!.min.x;
      const P = F.from.clone().lerp(to, k);
      P.y += Math.sin(k * Math.PI) * F.h;
      const s = lerp(F.s0 * F.wL, wH * hs, e) / F.wL;
      const q = F.q0.clone().slerp(hq, e).multiply(_q.setFromAxisAngle(_y, (1 - e) * Math.PI * 2)); // a fabulous twirl
      F.node.scale.setScalar(s);
      F.node.quaternion.copy(q);
      F.node.position.copy(P).sub(F.cL.clone().multiplyScalar(s).applyQuaternion(q));
      if (k >= 1) {
        this.wigFly = null;
        F.node.removeFromParent();
        this.landWig();
      }
    }
    // the worn wig: plop squash, and step aside once the game has put the real hat on
    const W = this.wigWorn;
    if (W) {
      const pl = this.d.player;
      if (W.mesh.parent && (pl.rig !== W.rig || (W.hat && W.hat.geometry !== W.geo))) {
        W.mesh.removeFromParent();
        if (W.hat && pl.rig === W.rig) {
          W.hat.visible = true;
          W.target = W.hat;
        }
      }
      if (W.t < 2) {
        W.t += dt;
        const sq = W.sq.step(1, dt);
        const tgt = W.target;
        if (W.t >= 2) tgt.scale.set(1, 1, 1);
        else tgt.scale.set(1 + (1 - sq) * 0.5, sq, 1 + (1 - sq) * 0.5);
      }
    }
  }

  /** plop! the wig is on his head */
  private landWig() {
    const T = this.thanks;
    if (T) this.goThanks('done');
    if (this.wigGiven) return;
    this.wigGiven = true;
    const ctx = this.d.ctx, pl = this.d.player;
    const r = pl.rig;
    const H = this.hatHolder();
    const hat = r.meshes['hat'] ?? null;
    const geo = hat?.geometry ?? null;
    let mesh: THREE.Mesh | null = null;
    if (H.node) {
      mesh = new THREE.Mesh(hunterWigGeo(), r.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (H.offset) mesh.position.copy(H.offset);
      H.node.add(mesh);
    }
    ctx.events.emit('frogWig');
    // did the game put the wig on right away? if not, wear ours over a hidden old hat
    const swapped = pl.rig !== r || (!!hat && hat.geometry !== geo);
    if (mesh) {
      if (swapped) mesh.removeFromParent();
      else if (hat) hat.visible = false;
      const sq = new SpringF(0.62, 3.4, 0.22);
      this.wigWorn = { mesh, rig: r, hat, geo, sq, t: 0, target: swapped && hat ? hat : mesh };
    }
    const p = this.facePts().top;
    ctx.sfx('board_land', p, 0.25, 1.7);
    ctx.sfx('paper_flutter', p, 0.6, 1.05);
    ctx.sfx('squeak', this.mama.pos, 0.7, 1.05);
    ctx.particles.emit({ pos: { x: p.x, y: p.y + 0.05, z: p.z }, count: 4, spread: 0.6, up: 0.4, life: [0.4, 0.7], size: [0.25, 0.5], sprite: ['puff0', 'puff1', 'puff2'], color: 0xeee2fa, alpha: 0.55, drag: 3 });
    ctx.particles.emit({ pos: { x: p.x, y: p.y + 0.1, z: p.z }, count: 16, spread: 2.2, life: [0.4, 0.8], size: [0.1, 0.03], sprite: ['star4', 'spark'], color: [0xd7c8f1, 0xf794bc, 0xffffff], additive: true, drag: 2.5 });
    ctx.particles.emit({ pos: { x: p.x, y: p.y + 0.3, z: p.z }, count: 3, spread: 0.7, up: 0.8, life: [0.8, 1.2], size: [0.1, 0.08], sprite: 'fx_heart', color: 0xffffff, gravity: -0.3, drag: 1.5 });
    ctx.toast("MAMA'S WIG", '#e6b8ff', 'She insists. It is yours now. Fabulous.');
    pl.express('smug', 1.6);
  }

  private updateFinale(dt: number) {
    const ctx = this.d.ctx;
    this.finaleT += dt;
    // a short, soft desert shower over the reunion: pixel rain streaks, little splashes in the puddle
    if (this.rainT > 0) {
      this.rainT -= dt;
      const k = Math.min(1, this.rainT / 1.5);
      const n = Math.floor(dt * 70 * k + rnd.next());
      for (let i = 0; i < n; i++) {
        const a = rnd.next() * Math.PI * 2, r = Math.sqrt(rnd.next()) * 6.5;
        const x = this.at.x + Math.cos(a) * r, z = this.at.z + Math.sin(a) * r;
        const g = ctx.world.groundAt(x, z);
        ctx.particles.emit({ pos: { x, y: g + 5 + rnd.next() * 2, z }, count: 1, vel: { x: 0.6, y: -15, z: 0.3 }, life: [0.38, 0.45], size: [0.03, 0.45], sprite: 'streak', color: 0xd8eef4, alpha: 0.75, stretch: 0.02 });
        if (rnd.chance(0.35)) ctx.engine.tweens.after(0.36, () => ctx.particles.emit({ pos: { x, y: g + 0.04, z }, count: 2, spread: 0.6, up: 0.9, life: [0.15, 0.3], size: [0.04, 0.02], sprite: 'dot3', color: 0xd8eef4, gravity: 9 }));
      }
    }
    if (this.finaleT > 1.2 && this.finaleT < 6.5 && rnd.chance(dt * 1.6)) ctx.sfx('squeak', this.mama.pos, 0.55, 0.85 + Math.floor(rnd.next() * 4) * 0.12);
    // long after, once the thanks are done and the hunter has ridden on: they dig in under the sand
    const thanked = !this.thanks || this.thanks.stage === 'done';
    if (this.finaleT > 25 && thanked && !this.wigFly && this.buryT < 0 && Math.hypot(this.d.player.pos.x - this.at.x, this.d.player.pos.z - this.at.z) > 30) this.buryT = 0;
  }

  private updateBury(dt: number) {
    const ctx = this.d.ctx;
    this.buryT += dt;
    const k = Math.min(1, this.buryT / 1.6);
    for (const f of [this.mama, ...this.babies]) {
      if (f.state === 'carried' || f.state === 'flying') continue;
      f.root.position.y -= dt * f.height * 0.9;
      if (rnd.chance(dt * 8)) ctx.fx.sandSpray({ x: f.pos.x, y: f.pos.y + 0.02, z: f.pos.z }, { x: 0, y: 0.6, z: 0 }, 0.6);
    }
    for (const mo of this.moths) if (mo.state === 'fly') mo.rig.root.position.y += dt * 1.5;
    if (k >= 1) {
      this.finished = true;
      this.dispose();
    }
  }

  // ------------------------------------------------------------- the frog body
  /** procedural frog: breathing, lid blinks and moods, eye contact, throat puffs, squash & jiggle, hop poses, wails, song, chorus */
  private animFrog(f: Frog, dt: number, air: number, k: number) {
    const ctx = this.d.ctx;
    if (f.state !== 'carried' && ctx.camera.position.distanceTo(f.root.getWorldPosition(_v)) > 80) return;
    const n = f.rig.nodes;
    const pl = this.d.player;
    f.breath += dt * (f.state === 'tired' ? 7 : f.mama && !this.done ? 1.6 : 2.2);
    f.squash.step(1, dt);
    f.jiggle.step(1, dt);
    f.hatWob.step(0, dt);
    // blinking: the soft lids roll down over the globes
    f.blinkIn -= dt;
    if (f.blinkIn <= 0) {
      f.blinkT = 0;
      f.blinkIn = 1.8 + rnd.next() * 4;
    }
    let blink = 0;
    if (f.blinkT >= 0) {
      f.blinkT += dt;
      blink = Math.sin(Math.min(1, f.blinkT / 0.18) * Math.PI);
      if (f.blinkT > 0.18) f.blinkT = -1;
    }
    // wail: mouth opens wide and the throat balloons
    let wail = 0;
    if (f.wailT >= 0) {
      f.wailT += dt;
      wail = Math.sin(Math.min(1, f.wailT / 1.1) * Math.PI);
      if (f.wailT > 1.1) f.wailT = -1;
    }
    const singing = f.mama && this.finaleT >= 0 && this.finaleT < 7;
    const song = singing ? 0.5 + 0.5 * Math.sin(this.finaleT * 5.2) : 0;
    const tired = f.state === 'tired' ? 0.5 + 0.5 * Math.sin(f.breath) : 0;
    const puffT = Math.max(wail * 0.9, song * 0.75, tired * 0.5, f.chorus * 0.95, (0.5 + 0.5 * Math.sin(f.breath)) * 0.12);
    f.puff = damp(f.puff, puffT, 10, dt);
    // expression
    const expr = singing || f.chorus > 0.3 ? 'sing' : f.state === 'flee' || f.state === 'flying' ? 'surprised' : f.state === 'tired' ? 'sleepy' : f.joy > 0 || this.done ? 'happy' : f.mama ? (wail > 0.2 ? 'hurt' : 'scared') : 'neutral';
    f.rig.setExpression(expr);
    // whole body: squash and stretch around the hops, a breathing swell
    const sq = f.squash.x * (1 + Math.sin(f.breath) * 0.018);
    const stretch = air > 0 ? 1 + Math.sin(k * Math.PI) * 0.12 : 1;
    const sy = sq * stretch;
    f.rig.root.scale.set(1 / Math.sqrt(Math.max(0.5, sy)), sy, 1 / Math.sqrt(Math.max(0.5, sy)));
    const set = (name: string, x: number, y = 0, z = 0) => {
      const node = n[name];
      const r = f.rest[name];
      if (node && r) node.rotation.set(r.x + x, r.y + y, r.z + z);
    };
    // legs: tucked at rest, hind legs kick back and fore legs reach forward in the air
    const kick = air > 0 ? Math.sin(Math.min(1, k * 1.3) * Math.PI) : 0;
    const reach = air > 0 ? Math.sin(k * Math.PI) : 0;
    const crouch = f.hop && f.hop.t < 0.06 ? 1 : 0;
    set('leg_bl', 0.9 * kick - 0.15 * crouch, 0, -0.1 * kick);
    set('leg_br', 0.9 * kick - 0.15 * crouch, 0, 0.1 * kick);
    set('foot_bl', -0.6 * kick);
    set('foot_br', -0.6 * kick);
    const paddle = f.state === 'carried' ? Math.sin(this.t * 3 + f.idx) * 0.15 : 0;
    // mama: arms up for her wig (they don't reach), or hands to her cheeks, bashful and bald
    const up = f.mama ? f.armsUp : 0;
    const shy = f.mama ? Math.min(1, this.bashful * 2) : 0;
    const wig = up > 0 ? Math.sin(f.t * 16) * 0.18 * up : 0;
    set('leg_fl', -0.7 * reach + paddle + (singing ? -0.25 * song : 0) - 2.0 * up + wig - 1.35 * shy, 0, 0.15 * reach + 0.25 * up - 0.32 * shy);
    set('leg_fr', -0.7 * reach - paddle + (singing ? -0.25 * song : 0) - 2.0 * up - wig - 1.35 * shy, 0, -0.15 * reach - 0.25 * up + 0.32 * shy);
    set('foot_fl', 0.4 * reach + 0.5 * shy);
    set('foot_fr', 0.4 * reach + 0.5 * shy);
    // head: little looks around, tilts while singing (and a shy tilt)
    const lookY = Math.sin(f.t * 0.7 + f.idx) * 0.18 + (singing ? Math.sin(this.finaleT * 2.6) * 0.12 : 0);
    set('head', -wail * 0.12 + Math.sin(f.t * 0.5) * 0.03 - f.chorus * 0.12 - up * 0.1, lookY * (1 - up), (singing ? Math.sin(this.finaleT * 2.6) * 0.08 : 0) + shy * 0.18);
    // jaw from the expression + the wail / song / chorus, and wide open for the tongue
    if (n['jaw']) {
      const want = f.rig.exprJaw + wail * 0.25 + song * 0.12 + tired * 0.08 + f.chorus * 0.22;
      n['jaw'].rotation.x = damp(n['jaw'].rotation.x, want, 16, dt);
      if (f.mama && this.tongueOpen > 0.01) n['jaw'].rotation.x = Math.max(n['jaw'].rotation.x, 0.62 * this.tongueOpen);
    }
    n['throat']?.scale.setScalar(1 + f.puff * 0.6);
    n['belly']?.scale.set(1 + (f.jiggle.x - 1) * 0.6, f.jiggle.x, 1 + (f.jiggle.x - 1) * 0.6);
    // lids: moods (grumpy-cute froglets, a worried mama, wide when startled, blissful in song, squeezed after a snack)
    let lx = f.mama ? 0.12 : 0.05, lz = f.mama ? -0.2 : 0.16;
    if (f.state === 'flee' || f.state === 'flying') (lx = -0.45), (lz = 0);
    else if (f.state === 'tired') (lx = 0.55), (lz = 0.05);
    else if (f.joy > 0 || this.done) (lx = -0.12), (lz = -0.06);
    if (singing || f.chorus > 0.3) lx = 0.55;
    if (f.gulp > 0) lx = 1.25;
    if (f.mama && up > 0) (lx = -0.4), (lz = 0.12);
    f.lidX = damp(f.lidX, lx, 12, dt);
    f.lidZ = damp(f.lidZ, lz, 8, dt);
    const close = Math.min(1.95, f.lidX + blink * 1.95);
    set('lid_l', close, 0, f.lidZ);
    set('lid_r', close, 0, -f.lidZ);
    // eye contact: the glossy globes roll toward the hunter when he is close
    const camD = ctx.camera.position.distanceTo(f.pos);
    if (camD < 30 && n['eye_l'] && n['eye_r']) {
      f.root.updateWorldMatrix(true, false);
      const loc = f.root.worldToLocal(_v2.set(pl.pos.x, pl.pos.y + 1.55, pl.pos.z));
      const near = Math.hypot(loc.x, loc.z) < 12 && f.state !== 'carried';
      const ey = near ? clamp(Math.atan2(loc.x, loc.z) - lookY, -0.45, 0.45) : 0;
      const ep = near ? clamp(-Math.atan2(loc.y - f.height * 0.7, Math.hypot(loc.x, loc.z)), -0.35, 0.25) : 0;
      for (const e of ['eye_l', 'eye_r']) {
        const node = n[e];
        node.rotation.x = damp(node.rotation.x, ep, 8, dt);
        node.rotation.y = damp(node.rotation.y, ey, 8, dt);
      }
    }
    // mama's finery: the wig bounces on landings and wails, ringlets swing, the purse swings from her wrist
    if (f.mama) {
      f.hatWob.kick((f.squash.v || 0) * -0.02 + wail * 0.02);
      const onHead = n['wig']?.parent === n['head'];
      if (onHead) set('wig', f.hatWob.x * 0.2, 0, Math.sin(f.t * 1.6) * 0.02 + f.hatWob.x * 0.15);
      const names = ['ringlet_l1', 'ringlet_l2', 'ringlet_r1', 'ringlet_r2'];
      f.rings.forEach((s, i) => {
        s.kick((f.squash.v || 0) * 0.05 + (this.wigFly ? Math.sin(this.t * 20 + i) * 0.4 : 0));
        s.step(0, dt);
        const side = i < 2 ? 1 : -1;
        set(names[i], s.x * 0.5 + Math.sin(f.t * 1.3 + i) * 0.04, 0, side * (s.x * 0.3 + Math.sin(f.t * 1.1 + i * 2) * 0.05));
      });
      set('purse', Math.sin(f.t * 1.6 + 0.6) * 0.12, 0, Math.sin(f.t * 1.6) * 0.06);
      // blushing, bald and delighted
      if (shy > 0 && rnd.chance(dt * 3)) {
        n['head']?.getWorldPosition(_v2);
        ctx.particles.emit({ pos: { x: _v2.x, y: _v2.y + 0.35, z: _v2.z }, count: 1, vel: { x: 0, y: 0.5, z: 0 }, spread: 0.4, life: [0.7, 1.0], size: [0.09, 0.07], sprite: 'fx_heart', color: 0xffffff, gravity: -0.2, drag: 1.5 });
      }
    }
  }

  // ------------------------------------------------------------- hud
  hud(): { objective: { text: string; sub: string } | null; marker: THREE.Vector3 | null } | null {
    if (!this.revealed || this.done || this.finished || this.buryT >= 0) return null;
    const pl = this.d.player;
    const carried = this.babies.filter((b) => b.state === 'carried' || b.state === 'flying').length;
    const loose = this.babies.filter((b) => b.state === 'idle' || b.state === 'flee' || b.state === 'tired');
    let marker: THREE.Vector3 | null = null;
    if (carried > 0 || !loose.length) marker = this.mama.pos.clone().setY(this.mama.pos.y + 1.6);
    else {
      let best = loose[0], bd = Infinity;
      for (const b of loose) {
        const dd = b.pos.distanceToSquared(pl.pos);
        if (dd < bd) {
          bd = dd;
          best = b;
        }
      }
      marker = best.pos.clone().setY(best.pos.y + 0.9);
    }
    return {
      objective: { text: 'Mama Rain Frog', sub: `Bring her froglets home — ${this.returned}/5 home${carried ? ` · ${carried} on your hat` : ''}` },
      marker,
    };
  }

  dispose() {
    for (const b of this.babies) {
      if (b.inter) this.d.inter.remove(b.inter);
      b.root.removeFromParent();
    }
    for (const mo of this.moths) mo.rig.root.removeFromParent();
    this.d.inter.remove(this.mamaInter);
    this.mama.root.removeFromParent();
    this.wigFly?.node.removeFromParent();
    this.wigCarry?.node.removeFromParent();
    // the worn wig stays on his head (it is his now); only the squash settles
    if (this.wigWorn) this.wigWorn.target.scale.set(1, 1, 1);
    this.group.removeFromParent();
    this.puddle?.geometry.dispose();
  }
}
