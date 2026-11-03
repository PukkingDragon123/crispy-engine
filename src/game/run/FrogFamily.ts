// The rain-frog family: a fat, grumpy-mouthed mama rain frog in her Sunday hat
// sits by a rain puddle and wails — her five froglets have wandered off into
// the dunes. Ride close and the little ones hop away squeaking; chase them,
// grab them [T] and they stack up on Sundown's hat. Bring them home: one by one
// they hop off the hat into mama's arms, and when the last one is back she
// sings ("Rain") under a short desert shower. Reward: a strongbox, bounty,
// gold and a healing hug.
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
import { clamp, damp, dampAngle, rnd, hash3 } from '../../engine/math/rand';
import { SpringF } from '../anim/spring';

export interface FrogFamilyDeps {
  ctx: Ctx;
  player: Player;
  inter: Interactions;
  addBounty(v: number): void;
  /** drop a loot chest (RunScene.spawnChest) */
  chest?(x: number, z: number, tier: ChestTier): unknown;
}

type FrogState = 'idle' | 'flee' | 'tired' | 'flying' | 'carried' | 'home';

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
  inter: Interactable | null;
  rest: Record<string, THREE.Euler>;
  restP: Record<string, THREE.Vector3>;
  /** flight onto the hat (toHat: chase the live socket) or from the hat to mama */
  fly: { from: THREE.Vector3; to: THREE.Vector3; toHat: boolean; t: number; dur: number; h: number; then: () => void } | null;
  /** already scheduled to hop off the hat */
  queued: boolean;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

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
  private group = new THREE.Group();
  private puddle: THREE.Mesh | null = null;
  private mamaInter: Interactable;
  private t = 0;
  private finaleT = -1;
  private rainT = 0;
  private buryT = -1;
  private hintCd = 0;
  private lastPlayerVel = new THREE.Vector3();
  private acc = new THREE.Vector3();

  constructor(private d: FrogFamilyDeps, private at: THREE.Vector3) {
    const ctx = d.ctx;
    at.y = ctx.world.groundAt(at.x, at.z);
    ctx.scene.add(this.group);
    // the puddle she waits by
    try {
      const pm = (modelEntry('rain_puddle')?.() as { model: VoxelModel; voxelSize: number } | undefined) ?? puddleModel(Math.floor(at.x * 13 + at.z * 7));
      if (pm?.model) {
        const geo = buildVoxelGeometry(pm.model, { voxelSize: pm.voxelSize, pivot: 'bottom' });
        this.puddle = new THREE.Mesh(geo, sharedVoxelMaterial);
        this.puddle.receiveShadow = true;
        this.puddle.position.set(at.x + 1.1, ctx.world.groundAt(at.x + 1.1, at.z + 0.6) - 0.035, at.z + 0.6);
        this.puddle.rotation.y = rnd.next() * Math.PI * 2;
        this.group.add(this.puddle);
        ctx.events.emit('groundMark', at.x + 1.1, at.z + 0.6, 1.9, 0);
      }
    } catch (e) {
      console.warn('[frogs] puddle failed', e);
    }
    this.mama = this.makeFrog('rain_frog_mama', true, 0, at.clone());
    this.mama.yaw = rnd.next() * Math.PI * 2;
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
    const meta = fallback.meta ?? {};
    const rest: Record<string, THREE.Euler> = {};
    const restP: Record<string, THREE.Vector3> = {};
    for (const p of rig.geo.parts) {
      rest[p.name] = p.rest.clone();
      restP[p.name] = p.offset.clone();
    }
    return {
      mama, idx, rig, root, pos: at, yaw: 0, height: (meta.height as number) ?? (mama ? 0.95 : 0.22), R: (meta.radius as number) ?? (mama ? 0.5 : 0.13),
      state: 'idle', t: rnd.next() * 3, hop: null, pause: 0, stamina: 0, flees: 0, home: at.clone(),
      breath: rnd.next() * 6, blinkIn: 1 + rnd.next() * 3, blinkT: -1, wailIn: 1.5 + rnd.next() * 2, wailT: -1, joy: 0,
      squash: new SpringF(1, 3.2, 0.32), jiggle: new SpringF(1, 4.5, 0.25), sway: new SpringF(0, 2.2, 0.4), hatWob: new SpringF(0, 3, 0.3),
      puff: 0, inter: null, rest, restP, fly: null, queued: false,
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
      ctx.toast('A HAPPY FAMILY', '#9fd8e0', 'Mama hums. The froglets snore.');
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
    for (const b of this.babies) this.updateBaby(b, dt, acc);
    this.updateMama(dt);
    if (this.finaleT >= 0) this.updateFinale(dt);
    if (this.buryT >= 0) this.updateBury(dt);
  }

  private updateBaby(b: Frog, dt: number, acc: THREE.Vector3) {
    const ctx = this.d.ctx;
    const pl = this.d.player;
    b.t += dt;
    const camD = ctx.camera.position.distanceTo(b.pos);
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
    // --- loose in the dunes
    const dx = b.pos.x - pl.pos.x, dz = b.pos.z - pl.pos.z;
    const dpl = Math.hypot(dx, dz);
    if (b.hop) {
      const h = b.hop;
      h.t += dt;
      const k = Math.min(1, h.t / h.dur);
      b.pos.lerpVectors(h.from, h.to, k);
      const g = ctx.world.groundAt(b.pos.x, b.pos.z);
      b.pos.y = g;
      b.root.position.set(b.pos.x, g + Math.sin(k * Math.PI) * h.h, b.pos.z);
      b.root.rotation.set(-0.35 * Math.sin(k * Math.PI) + 0.2 * (k - 0.5), b.yaw, 0);
      this.animFrog(b, dt, 1, k);
      if (k >= 1) {
        b.hop = null;
        b.squash.kick(-4.5);
        b.jiggle.kick(-3);
        b.root.rotation.set(0, b.yaw, 0);
        if (camD < 45) {
          ctx.particles.emit({ pos: { x: b.pos.x, y: b.pos.y + 0.03, z: b.pos.z }, count: 3, spread: 0.6, up: 0.7, life: [0.3, 0.6], size: [0.045, 0.025], sprite: ['dot3', 'grain0'], color: [0xe0c08a, 0xc9a06a, 0xf0d6a2], gravity: 10, ground: true });
          ctx.particles.emit({ pos: { x: b.pos.x, y: b.pos.y + 0.05, z: b.pos.z }, count: 1, spread: 0.1, up: 0.2, life: [0.4, 0.7], size: [0.12, 0.3], sprite: ['puff0', 'puff1'], color: 0xe6cf9f, alpha: 0.5, drag: 3 });
        }
        b.pause = b.state === 'flee' ? 0.08 + rnd.next() * 0.16 : 0.6 + rnd.next() * 2.5;
      }
      return;
    }
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
          if (rnd.chance(0.35)) ctx.sfx('squeak', b.pos, 0.35, 1.8 + rnd.next() * 0.3);
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
  }

  private updateMama(dt: number) {
    const m = this.mama;
    const ctx = this.d.ctx;
    const pl = this.d.player;
    m.t += dt;
    m.joy = Math.max(0, m.joy - dt);
    const pd = Math.hypot(pl.pos.x - m.pos.x, pl.pos.z - m.pos.z);
    // turn to the hunter when he is near, otherwise look out over the dunes for her babies
    const look = pd < 14 ? Math.atan2(pl.pos.x - m.pos.x, pl.pos.z - m.pos.z) : m.yaw + Math.sin(m.t * 0.25) * 0.02;
    m.yaw = dampAngle(m.yaw, look, pd < 14 ? 1.6 : 0.4, dt);
    // waiting: rocks side to side and wails now and then, tears dripping into the puddle
    if (!this.done) {
      m.wailIn -= dt;
      if (m.wailIn <= 0 && pd < 60) this.wail(m);
      if (m.wailT >= 0 && pd < 40 && rnd.chance(dt * 6)) {
        const eye = m.rig.nodes['eye_' + (rnd.chance(0.5) ? 'l' : 'r')];
        if (eye) {
          eye.getWorldPosition(_v2);
          ctx.particles.emit({ pos: { x: _v2.x, y: _v2.y - 0.03, z: _v2.z }, count: 1, vel: { x: 0, y: -0.2, z: 0 }, spread: 0.2, life: [0.5, 0.8], size: [0.05, 0.035], sprite: 'dot3', color: [0xbfe6f0, 0x8fcfe0], gravity: 6, ground: true });
        }
      }
    }
    const hopJoy = m.joy > 0 && this.finaleT < 0 ? Math.max(0, Math.sin(m.t * 9)) * 0.08 * Math.min(1, m.joy) : 0;
    let bob = hopJoy;
    if (this.finaleT >= 0 && this.finaleT < 7) bob += Math.max(0, Math.sin(this.finaleT * 5.2)) ** 2 * 0.06;
    m.root.position.set(m.pos.x, ctx.world.groundAt(m.pos.x, m.pos.z) + bob, m.pos.z);
    m.root.rotation.set(0, m.yaw, 0);
    const rock = !this.done ? Math.sin(m.t * 1.6) * 0.06 : this.finaleT >= 0 && this.finaleT < 7 ? Math.sin(this.finaleT * 2.6) * 0.1 : Math.sin(m.t * 0.9) * 0.02;
    m.rig.root.rotation.set(0, 0, rock);
    this.animFrog(m, dt, 0, 0);
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
    // long after, once the hunter has ridden on: they dig in under the sand
    if (this.finaleT > 25 && this.buryT < 0 && Math.hypot(this.d.player.pos.x - this.at.x, this.d.player.pos.z - this.at.z) > 30) this.buryT = 0;
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
    if (k >= 1) {
      this.finished = true;
      this.dispose();
    }
  }

  // ------------------------------------------------------------- the frog body
  /** procedural frog: breathing, blinks (eyes sink), throat puffs, squash & jiggle, hop poses, wails, song */
  private animFrog(f: Frog, dt: number, air: number, k: number) {
    const ctx = this.d.ctx;
    if (f.state !== 'carried' && ctx.camera.position.distanceTo(f.root.getWorldPosition(_v)) > 80) return;
    const n = f.rig.nodes;
    f.breath += dt * (f.state === 'tired' ? 7 : f.mama && !this.done ? 1.6 : 2.2);
    f.squash.step(1, dt);
    f.jiggle.step(1, dt);
    f.hatWob.step(0, dt);
    // blinking: rain frogs pull their eyeballs down into the head
    f.blinkIn -= dt;
    if (f.blinkIn <= 0) {
      f.blinkT = 0;
      f.blinkIn = 1.8 + rnd.next() * 4;
    }
    let blink = 0;
    if (f.blinkT >= 0) {
      f.blinkT += dt;
      blink = Math.sin(Math.min(1, f.blinkT / 0.16) * Math.PI);
      if (f.blinkT > 0.16) f.blinkT = -1;
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
    const puffT = Math.max(wail * 0.9, song * 0.75, tired * 0.5, (0.5 + 0.5 * Math.sin(f.breath)) * 0.12);
    f.puff = damp(f.puff, puffT, 10, dt);
    // expression
    const expr = singing ? 'sing' : f.state === 'flee' || f.state === 'flying' ? 'surprised' : f.state === 'tired' ? 'sleepy' : f.joy > 0 || this.done ? 'happy' : f.mama ? (wail > 0.2 ? 'hurt' : 'scared') : 'neutral';
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
    set('leg_fl', -0.7 * reach + paddle + (singing ? -0.25 * song : 0), 0, 0.15 * reach);
    set('leg_fr', -0.7 * reach - paddle + (singing ? -0.25 * song : 0), 0, -0.15 * reach);
    set('foot_fl', 0.4 * reach);
    set('foot_fr', 0.4 * reach);
    // head: little looks around, tilts while singing
    const lookY = Math.sin(f.t * 0.7 + f.idx) * 0.18 + (singing ? Math.sin(this.finaleT * 2.6) * 0.12 : 0);
    set('head', -wail * 0.12 + Math.sin(f.t * 0.5) * 0.03, lookY, singing ? Math.sin(this.finaleT * 2.6) * 0.08 : 0);
    // jaw from the expression + the wail / song
    if (n['jaw']) n['jaw'].rotation.x = damp(n['jaw'].rotation.x, f.rig.exprJaw + wail * 0.25 + song * 0.12 + tired * 0.08, 16, dt);
    n['throat']?.scale.setScalar(1 + f.puff * 0.6);
    n['belly']?.scale.set(1 + (f.jiggle.x - 1) * 0.6, f.jiggle.x, 1 + (f.jiggle.x - 1) * 0.6);
    // eyes sink for the blink
    for (const e of ['eye_l', 'eye_r']) {
      const node = n[e];
      const p0 = f.restP[e];
      if (node && p0) node.position.set(p0.x, p0.y - blink * f.R * 0.28, p0.z - blink * f.R * 0.08);
    }
    // the mama's Sunday best wobbles: hat on landings and wails, purse swinging from her wrist
    if (f.mama) {
      f.hatWob.kick((f.squash.v || 0) * -0.02 + wail * 0.02);
      set('hat', f.hatWob.x * 0.25, 0, Math.sin(f.t * 1.6) * 0.03 + f.hatWob.x * 0.2);
      set('purse', Math.sin(f.t * 1.6 + 0.6) * 0.12, 0, Math.sin(f.t * 1.6) * 0.06);
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
    this.d.inter.remove(this.mamaInter);
    this.mama.root.removeFromParent();
    this.group.removeFromParent();
    this.puddle?.geometry.dispose();
  }
}
