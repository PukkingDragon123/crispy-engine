// Old Mother Tamsin's rug shop. When you trade, the camera arcs off the
// riding rig into a low, warm three-quarter shot of her behind her rug, with a
// little handheld drift. She heaves her pack and the wares tumble out onto the
// rug as real rigid bodies (box contacts, bounce, friction, sleep). Hovering
// lifts and slowly spins a ware while the camera eases over to frame it; a
// click buys it and it arcs into the hunter's satchel; right-click fires a shot
// that knocks the wares about (and sends her into her shell). Leaving dollies
// the camera back to the saddle. Pauses combat while you browse.
//
// Out in the world she is shy: aim at her (crosshair on her within ~25 m) or
// shoot / blow something up near her and her head, legs and tail snap into her
// shell (squash, thump, muffled grumble). 1.5-2.5 s after the threat is gone
// she peeks — eyes first — then slides back out. Her world idle lives here too
// (`animateMerchant`), driven by whoever owns her rig each frame.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Input } from '../../engine/Input';
import type { CameraRig, CineShot } from '../player/CameraRig';
import type { RigInstance } from '../../engine/voxel/Rig';
import * as PM from '../models/props';
import { modelEntry } from '../models/lookup';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { P } from '../../engine/voxel/palette';
import { ITEMS, ItemId } from '../player/Items';
import { clamp, damp, noise, rnd } from '../../engine/math/rand';
import { Ease } from '../../engine/Tween';

export interface Ware {
  id: string;
  name: string;
  desc: string;
  price: number;
  model: string;
  buy(): boolean; // false = couldn't (e.g. inventory full)
}

const TITLE = 'MOTHER TAMSIN';
const LINES = {
  hello: ['Ahh, a customer with no skin! Fewer things to sell you lotion for.', 'Welcome, bone-friend! Everything is cursed only a little.', 'My camel says you have an honest skull.'],
  poor: ['No coin, no camel milk.', 'I accept gold, not rattling.', 'Come back with heavier pockets, friend.'],
  thanks: ['A fine choice! Serket smiles.', 'Sold! No refunds, no curses. Mostly.', 'You have the eye of a falcon. Or a skull.'],
  bye: ['Ride safe! Or don\'t, more customers for Anubis.', 'Go with sand in your boots!'],
  shot: ['Not at the merchandise, dearie!', 'I am two hundred years old. Put that away.', 'Shoot the outlaws, not my wares!'],
};

// ------------------------------------------------------------------ small math helpers
const UP = new THREE.Vector3(0, 1, 0);
const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const smoother = (k: number) => {
  const x = c01(k);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const wrapPi = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
};
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _kj = new THREE.Vector3();
const _kr = new THREE.Vector3();

// ================================================================== Old Mother Tamsin, the puppet
// Drives her existing rig parts (FROZEN model: animated only). Channels are
// 0 = out, 1 = pulled into the shell; meta.retract gives each part's in-offset.
const TVS = 1 / 36;
const PEEK = 0.8; // neck channel while peeking: eyes clear the shawl, the beak stays hidden
type Mode = 'out' | 'hiding' | 'hidden' | 'peek' | 'emerging';
type Mood = 'neutral' | 'laugh' | 'squinty';
interface Channels {
  neck: number;
  limb: number;
  tail: number;
  drop: number;
  tuck: number;
}
interface Swing {
  o: THREE.Object3D;
  x: number;
  z: number;
  vx: number;
  vz: number;
  amp: number;
  ph: number;
  head: boolean;
}
const SWING_DEFAULT = ['coins', 'chain', 'scarf_tails', 'bells', 'pouch_1', 'pouch_2', 'pouch_3', 'lantern', 'beads'];

class Tamsin {
  readonly n: Record<string, THREE.Object3D | undefined> = {};
  private rest: Record<string, THREE.Vector3> = {};
  private ret: Record<string, THREE.Vector3> = {};
  private dropM = 8 * TVS;
  mode: Mode = 'out';
  private mt = 0;
  private calm = 0;
  private calmNeed = 2;
  private peekHold = 0.8;
  private from: Channels = { neck: 0, limb: 0, tail: 0, drop: 0, tuck: 0 };
  readonly ch: Channels = { neck: 0, limb: 0, tail: 0, drop: 0, tuck: 0 };
  private thumped = false;
  private sq = 0;
  private sqV = 0;
  private heave = 0;
  private heaveV = 0;
  private tremble = 0;
  private hy = 0;
  private hp = 0;
  private ey = 0;
  private ep = 0;
  private jaw = 0;
  private talkT = 0;
  private nodT = 0;
  private shakeT = 0;
  private waveT = 0;
  private waveDur = 1;
  private waveCd = 2.5;
  private t = rnd.next() * 10;
  private blinkT = 2;
  private blinkOn = 0;
  private mood: Mood = 'neutral';
  private moodT = 0;
  private grumbleCd = 0;
  private grumbleAt = -1;
  private swings: Swing[] = [];
  private lastHy = 0;
  /** world point she looks at (null: she looks about) */
  lookAt: THREE.Vector3 | null = null;
  /** the hunter is close: she waves her cane now and then */
  near = false;
  /** called once when she is fully back out of her shell */
  onOut: (() => void) | null = null;

  constructor(private ctx: Ctx, readonly rig: RigInstance | null, readonly root: THREE.Object3D, meta: any) {
    const swing: string[] = Array.isArray(meta?.swing) ? meta.swing : SWING_DEFAULT;
    const names = ['shell', 'neck', 'head', 'jaw', 'eye_l', 'eye_r', 'arm_l', 'arm_r', 'fore_l', 'fore_r', 'leg_l', 'leg_r', 'tail', 'cane', ...swing];
    for (const name of names) this.n[name] = rig?.nodes[name] ?? root.getObjectByName(name) ?? undefined;
    if (rig) for (const p of rig.geo.parts) this.rest[p.name] = p.offset.clone();
    else for (const [k, o] of Object.entries(this.n)) if (o) this.rest[k] = o.position.clone();
    const r = meta?.retract ?? {};
    for (const k of ['neck', 'arm_l', 'arm_r', 'leg_l', 'leg_r', 'tail']) {
      const v = r[k] as number[] | undefined;
      this.ret[k] = v ? new THREE.Vector3(v[0], v[1], v[2]) : new THREE.Vector3();
    }
    if (typeof meta?.shellDrop === 'number') this.dropM = meta.shellDrop;
    swing.forEach((name, i) => {
      const o = this.n[name];
      if (!o) return;
      const amp = name === 'lantern' ? 1.7 : name === 'bells' ? 1.4 : name.startsWith('pouch') ? 0.8 : name === 'coins' ? 0.7 : 1;
      this.swings.push({ o, x: 0, z: 0, vx: 0, vz: 0, amp, ph: i * 1.7, head: name === 'coins' || name === 'scarf_tails' });
    });
  }

  get hidden() {
    return this.mode === 'hiding' || this.mode === 'hidden';
  }

  /** world-space centre of her shell (aim / blast tests) */
  center(out: THREE.Vector3) {
    const s = this.n.shell;
    return s ? s.localToWorld(out.set(0, 0.4, -0.06)) : out.copy(this.root.position).add(_a.set(0, 0.75, 0));
  }
  /** world-space centre of her head (only meaningful while she is out) */
  headPos(out: THREE.Vector3) {
    const h = this.n.head;
    return h ? h.localToWorld(out.set(0, 0.13, 0.2)) : out.copy(this.root.position).add(_a.set(0, 1.35, 0.2));
  }

  /** something scary happened (aim, gunfire, blast): into the shell she goes */
  threat(level = 1) {
    this.calm = 0;
    this.calmNeed = 1.5 + rnd.next();
    if (this.hidden) {
      if (level >= 1 && this.mode === 'hidden' && this.grumbleCd <= 0) {
        this.grumble(0.05);
        this.tremble = 0.6;
      }
      return;
    }
    this.setMode('hiding');
  }

  /** the shop opened: if she is in her shell, she comes out for a customer */
  coax() {
    if (!this.hidden) return;
    this.setMode('peek');
    this.peekHold = 0.25;
  }

  /** seconds until she is all the way out */
  outIn() {
    switch (this.mode) {
      case 'out':
        return 0;
      case 'emerging':
        return Math.max(0, 0.75 - this.mt);
      case 'peek':
        return Math.max(0, 0.38 + this.peekHold - this.mt) + 0.75;
      default:
        return 0.9 + this.calmNeed;
    }
  }

  say(mood: Mood, dur = 1.2) {
    this.talkT = dur;
    this.mood = mood;
    this.moodT = dur + 0.5;
  }
  nod() {
    this.nodT = 0.7;
  }
  shake() {
    this.shakeT = 0.8;
  }
  wave(d = 1.6) {
    this.waveT = this.waveDur = d;
  }
  /** she tips her pack forward (the wares spill out) */
  heaveKick() {
    this.heaveV += 1.45;
    for (const s of this.swings) s.vx -= 2.6 * s.amp;
  }

  private setMode(m: Mode) {
    this.mode = m;
    this.mt = 0;
    Object.assign(this.from, this.ch);
    this.thumped = this.ch.drop > 0.95;
    if (m === 'hiding' && this.thumped) {
      // already low (peeking): snap the head back in with a little jolt
      this.sqV += 0.9;
      this.grumble(0.08);
    }
  }

  private grumble(delay: number) {
    if (this.grumbleCd > 0) return;
    this.grumbleCd = 1.3;
    this.grumbleAt = delay;
  }

  private thump() {
    this.sqV += 1.7;
    this.tremble = 0.7;
    for (const s of this.swings) {
      s.vx += (rnd.next() - 0.5) * 5 * s.amp;
      s.vz += (rnd.next() - 0.5) * 5 * s.amp;
    }
    const p = this.root.position;
    this.ctx.sfx('board_land', p, 0.32, 1.35);
    this.ctx.fx.dust({ x: p.x, y: p.y + 0.08, z: p.z }, 0.42, P.sand0, 4);
    this.grumble(0.12);
  }

  update(dt: number) {
    if (dt <= 0) return;
    this.t += dt;
    this.mt += dt;
    this.grumbleCd -= dt;
    this.tremble = Math.max(0, this.tremble - dt * 1.2);
    if (this.grumbleAt >= 0) {
      this.grumbleAt -= dt;
      if (this.grumbleAt < 0) this.ctx.sfx('camel_grunt', this.root.position, 0.42, 0.72);
    }
    const ch = this.ch, f = this.from, mt = this.mt;
    switch (this.mode) {
      case 'hiding': {
        ch.neck = mix(f.neck, 1, Ease.outCubic(c01(mt / 0.15)));
        ch.limb = mix(f.limb, 1, Ease.outCubic(c01((mt - 0.02) / 0.15)));
        ch.tail = mix(f.tail, 1, Ease.outCubic(c01((mt - 0.04) / 0.16)));
        ch.tuck = mix(f.tuck, 1, Ease.outQuad(c01((mt - 0.06) / 0.24)));
        ch.drop = mix(f.drop, 1, Ease.inQuad(c01((mt - 0.12) / 0.11)));
        if (!this.thumped && ch.drop >= 1) {
          this.thumped = true;
          this.thump();
        }
        if (mt > 0.5) {
          this.mode = 'hidden';
          this.mt = 0;
        }
        break;
      }
      case 'hidden':
        ch.neck = ch.limb = ch.tail = ch.drop = ch.tuck = 1;
        this.calm += dt;
        if (this.calm >= this.calmNeed) {
          this.setMode('peek');
          this.peekHold = 0.55 + rnd.next() * 0.45;
        }
        break;
      case 'peek':
        // eyes first: the head rises just enough for her eyes to clear the shawl
        ch.neck = mix(f.neck, PEEK, Ease.outCubic(c01(mt / 0.38)));
        ch.tuck = mix(f.tuck, 0, Ease.outCubic(c01(mt / 0.3)));
        ch.limb = ch.tail = ch.drop = 1;
        if (mt > 0.38 + this.peekHold) this.setMode('emerging');
        break;
      case 'emerging':
        ch.neck = mix(f.neck, 0, Ease.outBack(c01(mt / 0.42)));
        ch.tuck = 0;
        ch.drop = mix(f.drop, 0, Ease.inOutQuad(c01((mt - 0.1) / 0.3)));
        ch.limb = mix(f.limb, 0, Ease.outCubic(c01((mt - 0.1) / 0.32)));
        ch.tail = mix(f.tail, 0, Ease.outCubic(c01((mt - 0.28) / 0.3)));
        if (mt > 0.75) {
          this.mode = 'out';
          this.mt = 0;
          this.sqV -= 0.6; // a little stretch as she settles back up
          const cb = this.onOut;
          this.onOut = null;
          cb?.();
        }
        break;
      default:
        ch.neck = ch.limb = ch.tail = ch.drop = ch.tuck = 0;
    }
    // springs (two substeps keep them stable at low frame rates)
    for (let s = 0; s < 2; s++) {
      const h = dt / 2;
      this.sqV += (-260 * this.sq - 13 * this.sqV) * h;
      this.sq += this.sqV * h;
      this.heaveV += (-60 * this.heave - 7 * this.heaveV) * h;
      this.heave += this.heaveV * h;
    }
    // gestures
    this.talkT -= dt;
    this.nodT -= dt;
    this.shakeT -= dt;
    this.moodT -= dt;
    if (this.moodT <= 0) this.mood = 'neutral';
    const out = 1 - ch.neck;
    if (this.near && this.mode === 'out') {
      this.waveCd -= dt;
      if (this.waveCd <= 0) {
        this.waveCd = 6 + rnd.next() * 5;
        this.wave(1.8);
        this.say('laugh', 1.6);
      }
    }
    this.waveT -= dt;
    // look target
    let ty = Math.sin(this.t * 0.37) * 0.35 + Math.sin(this.t * 0.11) * 0.2;
    let tp = Math.sin(this.t * 0.23) * 0.06;
    const S = this.n.shell;
    if (this.lookAt && S) {
      const loc = S.worldToLocal(_v.copy(this.lookAt));
      const lx = loc.x, ly = loc.y - 0.86, lz = loc.z - 0.18;
      ty = clamp(Math.atan2(lx, lz), -0.85, 0.85);
      tp = clamp(-Math.atan2(ly, Math.hypot(lx, lz)), -0.45, 0.35);
    }
    if (this.mode === 'peek') {
      // suspicious: eyes dart left, right, back
      const k = mt - 0.3;
      ty = 0;
      tp = -0.06;
      this.ey = damp(this.ey, k < 0 ? 0 : k < 0.3 ? 0.38 : k < 0.62 ? -0.38 : 0, 18, dt);
    }
    if (this.hidden) {
      ty = 0;
      tp = 0;
    }
    this.hy = damp(this.hy, ty, 4.5, dt);
    this.hp = damp(this.hp, tp, 4.5, dt);
    if (this.mode !== 'peek') this.ey = damp(this.ey, clamp((ty - this.hy) * 1.3, -0.4, 0.4), 14, dt);
    this.ep = damp(this.ep, clamp((tp - this.hp) * 1.2, -0.3, 0.3), 14, dt);
    let headYaw = this.hy, headPitch = this.hp;
    if (this.nodT > 0) headPitch += Math.sin((0.7 - this.nodT) * 15) * 0.13 * Math.min(1, this.nodT * 3);
    if (this.shakeT > 0) headYaw += Math.sin((0.8 - this.shakeT) * 17) * 0.2 * Math.min(1, this.shakeT * 3);
    const talking = this.talkT > 0 && !this.hidden;
    const jawT = talking ? 0.05 + Math.abs(Math.sin(this.t * 12.5)) * (0.15 + 0.08 * noise.n2(this.t * 3, 1.7)) : 0.015;
    this.jaw = damp(this.jaw, jawT * out, 22, dt);
    // expression (her real modelled lids: closed / squint / wide)
    if (this.rig) {
      let e: string = this.mood;
      if (this.mode === 'hiding') e = mt < 0.09 ? 'surprised' : 'laugh';
      else if (this.mode === 'hidden') e = 'laugh';
      else if (this.mode === 'peek') e = 'squinty';
      else {
        this.blinkT -= dt;
        if (this.blinkT <= 0) {
          this.blinkOn = 0.12;
          this.blinkT = 2.2 + rnd.next() * 3.8;
        }
        if (this.blinkOn > 0) {
          this.blinkOn -= dt;
          e = 'laugh';
        }
      }
      this.rig.setExpression(e);
    }
    // ---- pose
    const n = this.n, R = this.rest;
    if (S && R.shell) {
      S.position.copy(R.shell);
      S.position.y -= ch.drop * this.dropM;
      const breath = Math.sin(this.t * 1.7) * 0.007 * (1 - ch.drop * 0.6);
      S.scale.set(1 + this.sq * 0.55, 1 - this.sq + breath, 1 + this.sq * 0.55);
      S.rotation.set(this.heave + Math.sin(this.t * 0.9) * 0.012 * out, 0, Math.sin(this.t * 41) * 0.016 * this.tremble);
    }
    this.place('neck', ch.neck);
    n.neck?.rotation.set(ch.tuck * 0.22 + Math.sin(this.t * 1.7 + 0.6) * 0.025 * out, 0, 0);
    n.head?.rotation.set(headPitch + ch.tuck * 0.32, headYaw * (1 - ch.tuck), Math.sin(this.t * 0.5) * 0.03 * out);
    if (n.jaw) n.jaw.rotation.x = this.jaw;
    n.eye_l?.rotation.set(this.ep, this.ey, 0);
    n.eye_r?.rotation.set(this.ep, this.ey, 0);
    const limbOut = 1 - ch.limb;
    const w = this.waveT > 0 ? Math.min(1, this.waveT * 3, (this.waveDur - this.waveT) * 4) : 0;
    this.place('arm_l', ch.limb);
    this.place('arm_r', ch.limb);
    n.arm_l?.rotation.set((Math.sin(this.t * 1.3) * 0.04 - 0.05) * limbOut, 0, 0.05 * limbOut);
    n.arm_r?.rotation.set((-1.75 * w + Math.sin(this.t * 9) * 0.22 * w) * limbOut, 0, -0.35 * w * limbOut);
    n.fore_l?.rotation.set((-0.12 + Math.sin(this.t * 1.1) * 0.05) * limbOut, 0, 0);
    n.fore_r?.rotation.set(-0.3 * w * limbOut, 0, 0);
    this.place('leg_l', ch.limb);
    this.place('leg_r', ch.limb);
    this.place('tail', ch.tail);
    if (n.tail) n.tail.rotation.y = Math.sin(this.t * 2.1) * 0.25 * (1 - ch.tail);
    // the cane stays planted while her shell sinks
    if (n.cane && R.cane) n.cane.position.set(R.cane.x, R.cane.y + ch.drop * this.dropM * (1 - w), R.cane.z);
    // secondary motion: pouches, lantern, bells, coins, beads swing on springs
    const headVel = (headYaw - this.lastHy) / Math.max(dt, 1e-3);
    this.lastHy = headYaw;
    for (const s of this.swings) {
      const tx = Math.sin(this.t * 1.2 + s.ph) * 0.03 * s.amp;
      const tz = Math.sin(this.t * 0.9 + s.ph * 1.3) * 0.025 * s.amp;
      if (s.head) s.vz -= headVel * 0.6 * dt;
      s.vx += (-70 * (s.x - tx) - 5 * s.vx) * dt;
      s.vz += (-70 * (s.z - tz) - 5 * s.vz) * dt;
      s.x = clamp(s.x + s.vx * dt, -0.6, 0.6);
      s.z = clamp(s.z + s.vz * dt, -0.6, 0.6);
      s.o.rotation.set(s.x, 0, s.z);
    }
  }

  private place(name: string, k: number) {
    const o = this.n[name], r = this.rest[name], d = this.ret[name];
    if (o && r && d) o.position.copy(r).addScaledVector(d, k);
  }

  /** back to the bind pose (used when her rig goes back to its own idle) */
  restPose() {
    for (const [k, o] of Object.entries(this.n)) {
      if (!o) continue;
      if (this.rest[k]) o.position.copy(this.rest[k]);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
    }
    this.rig?.setExpression('neutral');
  }
}

// ================================================================== the wares as rigid bodies
type BodyState = 'wait' | 'free' | 'held' | 'sold' | 'pack' | 'gone';
interface Body {
  ware: Ware;
  obj: THREE.Group;
  he: THREE.Vector3; // box half extents (m)
  invI: THREE.Vector3; // inverse principal inertia (mass 1)
  rad: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  q: THREE.Quaternion;
  w: THREE.Vector3;
  state: BodyState;
  t: number;
  launch: number;
  slot: THREE.Vector3;
  rest: THREE.Vector3;
  still: number;
  asleep: boolean;
  spin: number;
  landed: boolean;
  clack: number;
  arc0: THREE.Vector3;
  sound: 'metal' | 'glass' | 'soft';
}

const G = 10.5;
const RESTITUTION = 0.32;
const FRICTION = 0.6;
const CORNERS: [number, number, number][] = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) CORNERS.push([x, y, z]);

function itemObject(key: string): { obj: THREE.Group; he: THREE.Vector3 } {
  const g = new THREE.Group();
  for (const k of [key, 'bottle', 'crate']) {
    try {
      const r = modelEntry(k)?.() as any;
      if (!r?.model) continue;
      const geo = buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: 'center' });
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const s = Math.min(2.5, 0.17 / Math.max(0.05, geo.boundingSphere!.radius));
      const bb = geo.boundingBox!;
      const m = new THREE.Mesh(geo, sharedVoxelMaterial);
      m.castShadow = true;
      m.receiveShadow = true;
      m.scale.setScalar(s);
      // centre of mass at the box centre
      m.position.copy(bb.getCenter(_v)).multiplyScalar(-s);
      g.add(m);
      const he = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5 * s);
      he.set(Math.max(0.025, he.x), Math.max(0.025, he.y), Math.max(0.025, he.z));
      return { obj: g, he };
    } catch {
      /* try the next model */
    }
  }
  return { obj: g, he: new THREE.Vector3(0.08, 0.08, 0.08) };
}

export class Shop {
  active = false;
  private group = new THREE.Group();
  private rug: THREE.Mesh | null = null;
  private rugHalf = new THREE.Vector2(1.17, 0.72);
  private rugTop = 0.05;
  private bodies: Body[] = [];
  private ray = new THREE.Raycaster();
  private hovered: Body | null = null;
  private hoverLock = 0;
  private tip: HTMLDivElement;
  private bar: HTMLDivElement;
  private done: (() => void) | null = null;
  private t = 0;
  private phase: 'off' | 'browse' | 'leave' = 'off';
  private pt = 0;
  private puppets = new Map<object, Tamsin>();
  private her: Tamsin | null = null;
  private borrowed = false;
  private hunter: THREE.Vector3 | null = null;
  private shot: CineShot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 46, roll: 0 };
  private camFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 72 };
  private camMain = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 46 };
  private pivot = new THREE.Vector3();
  private fwdAng = 0;
  private camK = 0;
  private focusK = 0;
  private focus = new THREE.Vector3();
  private tumbleAt = 0.4;
  private heaved = false;
  private shotCd = 0;
  private grade: { s: THREE.Color; h: THREE.Color; sat: number; vig: number } | null = null;
  private lightHeld = false;
  private scolded = false;
  private unsub: (() => void)[] = [];
  private gq = new THREE.Quaternion();

  constructor(private ctx: Ctx, private input: Input, private cam: CameraRig) {
    ctx.scene.add(this.group);
    this.tip = document.createElement('div');
    this.tip.style.cssText = "position:absolute;z-index:7;pointer-events:none;display:none;min-width:200px;max-width:280px;padding:10px 14px;background:#e8d4a4;border:3px solid #5a3418;box-shadow:0 4px 0 #2a1408;font-family:'Alagard';color:#2a1a10;font-size:15px;line-height:1.25;image-rendering:pixelated";
    this.bar = document.createElement('div');
    this.bar.style.cssText = "position:absolute;left:50%;bottom:6vh;transform:translateX(-50%);z-index:7;pointer-events:none;display:none;font-family:'Alagard';font-size:20px;color:#fff3d6;text-shadow:0 3px 0 #2a1810,0 0 10px #000;text-align:center";
    ctx.engine.overlay.appendChild(this.tip);
    ctx.engine.overlay.appendChild(this.bar);
    this.unsub.push(ctx.events.on('shot', () => this.onGunfire()));
    this.unsub.push(ctx.events.on('explosion', (p: { x: number; y: number; z: number }, r: number) => this.onBlast(p, r ?? 3)));
    this.unsub.push(ctx.events.on('propShot', (_c: unknown, p: THREE.Vector3) => p && this.onBlast(p, -4)));
  }

  // ---------------------------------------------------------------- Tamsin in the world
  /**
   * World idle + shyness for a merchant rig. Call every frame for her rig
   * (game dt) from wherever she lives; `hunter` is the player's live position.
   */
  animateMerchant(rig: RigInstance, dt: number, hunter?: THREE.Vector3) {
    if (hunter) this.hunter = hunter;
    let p = this.puppets.get(rig);
    if (!p) {
      p = new Tamsin(this.ctx, rig, rig.root, rig.geo.spec.meta ?? {});
      this.puppets.set(rig, p);
    }
    if (this.active && this.her === p) return; // the open shop drives her
    const h = Math.min(dt, 1 / 20);
    if (h <= 0) return;
    const d = hunter ? hunter.distanceTo(rig.root.position) : 99;
    if (d < 25 && this.aimedAt(p)) p.threat(0.5);
    p.near = d < 12;
    p.lookAt = hunter && d < 14 ? _w.copy(hunter).add(_a.set(0, 1.45, 0)) : null;
    p.update(h);
  }

  private aimedAt(p: Tamsin) {
    const o = _b, d = _c;
    this.cam.aimRay(o, d);
    const hit = (c: THREE.Vector3, r: number) => {
      const t = _a.copy(c).sub(o).dot(d);
      if (t < 0 || t > 30) return false;
      return _a.copy(o).addScaledVector(d, t).distanceTo(c) < r;
    };
    if (hit(p.center(_v), 0.6)) return true;
    return !p.hidden && hit(p.headPos(_v), 0.26);
  }

  private onGunfire() {
    const o = _b, d = _c;
    this.cam.aimRay(o, d);
    for (const p of this.puppets.values()) {
      if (!p.root.parent || (this.active && p === this.her)) continue;
      const c = p.center(_v);
      const close = this.hunter ? this.hunter.distanceTo(c) < 7 : false;
      const t = _a.copy(c).sub(o).dot(d);
      const miss = t > 0 && t < 40 ? _a.copy(o).addScaledVector(d, t).distanceTo(c) : 99;
      if (close || miss < 2.2) p.threat(1);
    }
  }

  /** r < 0: a bullet impact (radius |r|), otherwise an explosion radius */
  private onBlast(pos: { x: number; y: number; z: number }, r: number) {
    for (const p of this.puppets.values()) {
      if (!p.root.parent || (this.active && p === this.her)) continue;
      const c = p.center(_v);
      const reach = r < 0 ? -r : r + 7;
      if (c.distanceTo(_a.set(pos.x, pos.y, pos.z)) < reach) p.threat(1.5);
    }
  }

  // ---------------------------------------------------------------- the shop
  /** open at a rug position in front of the merchant; resolves when the player leaves */
  open(rugAt: THREE.Vector3, facing: number, wares: Ware[], merchantPos: THREE.Vector3): Promise<void> {
    const ctx = this.ctx;
    const eng = ctx.engine;
    if (this.active) this.finish();
    this.active = true;
    eng.paused = true;
    eng.input.setWantLock(false);
    ctx.sfx('merchant_greet', merchantPos, 1);
    ctx.toast(TITLE, '#ffd36b', rnd.pick(LINES.hello));
    this.t = 0;
    this.pt = 0;
    this.camK = 0;
    this.focusK = 0;
    this.heaved = false;
    this.scolded = false;
    this.hovered = null;
    this.shotCd = 0;
    this.her = this.findHer(rugAt, merchantPos);
    const her = this.her;
    // ---- where everything goes: rug in front of her, the camera on the customer side
    const C = new THREE.Vector3();
    let yaw: number;
    if (her) {
      const H = her.root.position;
      const a = her.root.rotation.y;
      C.copy(H).add(_a.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(1.05));
      yaw = a + Math.PI;
      this.pivot.copy(H);
      this.fwdAng = a;
    } else {
      C.copy(rugAt);
      yaw = facing;
      this.pivot.copy(merchantPos);
      this.fwdAng = facing + Math.PI;
    }
    C.y = ctx.world.groundAt(C.x, C.z);
    const g = this.group;
    g.position.copy(C);
    g.position.y += 0.004;
    const nrm = new THREE.Vector3();
    ctx.world.normal(C.x, C.z, nrm);
    if (nrm.lengthSq() < 0.5 || nrm.y < 0.95) nrm.lerp(UP, 0.6).normalize();
    g.quaternion.setFromUnitVectors(UP, nrm).multiply(_q.setFromAxisAngle(UP, yaw));
    g.updateMatrixWorld(true);
    this.gq.copy(g.quaternion).invert();
    // ---- rug
    if (!this.rug) {
      try {
        const r = (PM as any).rug?.(1) as { model: any; voxelSize: number } | undefined;
        if (r?.model) {
          const geo = buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: 'bottom' });
          geo.computeBoundingBox();
          const bb = geo.boundingBox!;
          this.rugHalf.set(Math.max(-bb.min.x, bb.max.x) - 0.06, Math.max(-bb.min.z, bb.max.z) - 0.04);
          this.rugTop = bb.max.y;
          const m = new THREE.Mesh(geo, sharedVoxelMaterial);
          m.receiveShadow = true;
          this.rug = m;
        }
      } catch {
        /* no rug: wares go on the sand */
      }
    }
    if (this.rug) g.add(this.rug);
    else this.rugTop = 0;
    // ---- the wares wait inside her pack
    if (her) {
      her.coax();
      her.lookAt = null;
    }
    this.tumbleAt = (her ? her.outIn() : 0) + 0.45;
    const nW = wares.length;
    this.bodies = wares.map((w, i) => {
      const { obj, he } = itemObject(w.model);
      obj.visible = false;
      g.add(obj);
      const x = (i - (nW - 1) / 2) * 0.42 + (rnd.next() - 0.5) * 0.06;
      const z = (i % 2 ? 0.12 : -0.1) + (rnd.next() - 0.5) * 0.06;
      const slot = new THREE.Vector3(x, this.rugTop + he.y, z);
      const I = new THREE.Vector3((he.y * he.y + he.z * he.z) / 3, (he.x * he.x + he.z * he.z) / 3, (he.x * he.x + he.y * he.y) / 3);
      const key = w.model;
      const sound: Body['sound'] = /dagger|shield|charm|coin|dynamite/i.test(key) ? 'metal' : /bottle/i.test(key) ? 'glass' : 'soft';
      return {
        ware: w, obj, he, invI: new THREE.Vector3(1 / I.x, 1 / I.y, 1 / I.z), rad: Math.max(he.x, he.y, he.z) * 0.8,
        p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(),
        state: 'wait' as BodyState, t: 0, launch: this.tumbleAt + 0.14 + i * 0.13, slot, rest: slot.clone(),
        still: 0, asleep: false, spin: rnd.next() * 6, landed: false, clack: 0, arc0: new THREE.Vector3(), sound,
      };
    });
    // ---- camera: arc off the riding rig into the three-quarter shot
    const cam = this.cam.camera;
    this.camFrom.pos.copy(cam.position);
    cam.getWorldDirection(_v);
    this.camFrom.look.copy(cam.position).addScaledVector(_v, 6);
    this.camFrom.fov = cam.fov;
    this.planShot();
    this.shot.pos.copy(this.camFrom.pos);
    this.shot.look.copy(this.camFrom.look);
    this.shot.fov = this.camFrom.fov;
    this.shot.roll = 0;
    this.cam.setCine(this.shot, false);
    eng.letterbox(true, 0.4);
    this.updateBar();
    this.bar.style.display = 'block';
    this.phase = 'browse';
    if (her) her.say('neutral', 1.6);
    return new Promise((res) => (this.done = res));
  }

  /** her puppet nearest the rug (or, with no hook installed, her rig found in the scene) */
  private findHer(rugAt: THREE.Vector3, merchantPos: THREE.Vector3): Tamsin | null {
    this.borrowed = false;
    let best: Tamsin | null = null, bd = 10;
    for (const p of this.puppets.values()) {
      if (!p.root.parent) continue;
      const d = p.root.position === merchantPos ? 0 : p.root.position.distanceTo(rugAt);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) return best;
    for (const o of this.ctx.scene.children) {
      if (o.position.distanceTo(rugAt) > 10) continue;
      if (!o.getObjectByName('shell') || !o.getObjectByName('neck') || !o.getObjectByName('pouch_1')) continue;
      this.borrowed = true;
      let meta: any = {};
      try {
        meta = (modelEntry('merchant')?.() as any)?.meta ?? {};
      } catch {
        /* defaults */
      }
      return new Tamsin(this.ctx, null, o, meta);
    }
    return null;
  }

  /** the low, warm three-quarter shot of her behind the rug */
  private planShot() {
    const H = this.pivot, a = this.fwdAng;
    const F = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const L = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const at = (s: number) => H.clone().addScaledVector(F, 2.95).addScaledVector(L, 1.65 * s);
    let side = 1;
    if (this.hunter) {
      // keep the hunter out of the lens: the side whose camera spot is farther from him
      side = at(1).distanceToSquared(this.hunter) >= at(-1).distanceToSquared(this.hunter) ? 1 : -1;
    }
    const pos = at(side);
    pos.y = Math.max(this.ctx.world.groundAt(pos.x, pos.z), H.y) + 1.0;
    this.camMain.pos.copy(pos);
    this.camMain.look.copy(H).addScaledVector(F, 0.47).addScaledVector(L, 0.1 * side);
    this.camMain.look.y = H.y + 0.66;
    this.camMain.fov = 46;
    this.focus.copy(this.camMain.look);
  }

  /** orbit around her from a to b (never through the building behind her) */
  private orbit(a: THREE.Vector3, b: THREE.Vector3, k: number, out: THREE.Vector3) {
    const H = this.pivot, f = this.fwdAng;
    const ang = (p: THREE.Vector3) => wrapPi(Math.atan2(p.x - H.x, p.z - H.z) - f);
    const ra = Math.hypot(a.x - H.x, a.z - H.z), rb = Math.hypot(b.x - H.x, b.z - H.z);
    const th = f + mix(ang(a), ang(b), k);
    const r = mix(ra, rb, k);
    out.set(H.x + Math.sin(th) * r, mix(a.y, b.y, k) + Math.sin(Math.PI * k) * 0.25, H.z + Math.cos(th) * r);
    const gy = this.ctx.world.groundAt(out.x, out.z) + 0.5;
    if (out.y < gy) out.y = gy;
    return out;
  }

  private updateBar() {
    this.bar.innerHTML = `<span style="color:#ffd36b">${Math.floor(this.ctx.run.gold)} gold</span> &nbsp;·&nbsp; click to buy &nbsp;·&nbsp; right-click to shoot &nbsp;·&nbsp; ESC / T to leave`;
  }

  dispose() {
    if (this.active) this.finish();
    for (const u of this.unsub) u();
    this.unsub = [];
    this.tip.remove();
    this.bar.remove();
  }

  /** start leaving: wares go back in her pack, the camera dollies back to the saddle */
  close() {
    if (!this.active || this.phase === 'leave') return;
    const ctx = this.ctx;
    ctx.toast(TITLE, '#ffd36b', rnd.pick(LINES.bye));
    this.phase = 'leave';
    this.pt = 0;
    this.hovered = null;
    this.tip.style.display = 'none';
    this.bar.style.display = 'none';
    ctx.engine.letterbox(false, 0.5);
    if (this.her) {
      this.her.say('laugh', 1.1);
      this.her.wave(1.4);
    }
    let i = 0;
    for (const b of this.bodies) {
      if (b.state === 'wait') {
        b.state = 'gone';
        continue;
      }
      if (b.state !== 'free' && b.state !== 'held') continue;
      b.state = 'pack';
      b.t = -0.06 * i++;
      b.arc0.copy(b.p);
    }
  }

  /** tear down and hand control back */
  private finish() {
    const ctx = this.ctx;
    const eng = ctx.engine;
    for (const b of this.bodies) {
      this.group.remove(b.obj);
      (b.obj.children[0] as THREE.Mesh | undefined)?.geometry.dispose();
    }
    this.bodies = [];
    if (this.rug) this.group.remove(this.rug);
    this.tip.style.display = 'none';
    this.bar.style.display = 'none';
    this.cam.setCine(null);
    eng.letterbox(false, 0.4);
    this.restoreGrade();
    this.holdLight(0);
    if (this.her && this.borrowed) this.her.restPose();
    if (this.her) this.her.lookAt = null;
    this.her = null;
    this.borrowed = false;
    this.hovered = null;
    eng.paused = false;
    eng.input.setWantLock(true);
    this.active = false;
    this.phase = 'off';
    const d = this.done;
    this.done = null;
    d?.();
  }

  private buy(b: Body) {
    const ctx = this.ctx;
    if (b.state !== 'held' && b.state !== 'free') return;
    if (ctx.run.gold < b.ware.price) {
      ctx.sfx('ui_error', null, 0.8);
      ctx.toast(TITLE, '#ffd36b', rnd.pick(LINES.poor));
      this.kick(b, _v.set(0, 1.6, 0), null);
      this.her?.shake();
      this.her?.say('squinty', 0.9);
      return;
    }
    if (!b.ware.buy()) {
      ctx.sfx('ui_error', null, 0.8);
      ctx.toast('POCKETS FULL', '#ff8a6a', 'Use or drop a consumable first');
      return;
    }
    ctx.run.gold -= b.ware.price;
    ctx.sfx('gold_burst', null, 0.8);
    ctx.sfx('pickup_gold', null, 0.7);
    ctx.toast(b.ware.name.toUpperCase(), '#9dff3a', rnd.pick(LINES.thanks));
    b.state = 'sold';
    b.t = 0;
    b.arc0.copy(b.p);
    b.asleep = false;
    if (this.hovered === b) this.hovered = null;
    ctx.sfx('whoosh', this.group.localToWorld(_v.copy(b.p)), 0.35, 1.3);
    this.her?.say('laugh', 1.3);
    this.her?.nod();
    this.updateBar();
  }

  /** where the hunter keeps his loot (his hip), or just below the lens */
  private satchel(out: THREE.Vector3) {
    if (this.hunter) return out.copy(this.hunter).add(_a.set(0, 0.95, 0));
    const cam = this.ctx.camera;
    cam.getWorldDirection(_a);
    return out.copy(cam.position).addScaledVector(_a, 0.7).add(_b.set(0, -0.55, 0));
  }

  /** the top of her pack (rolled rugs and pouches), world space */
  private packPoint(out: THREE.Vector3, lateral: number) {
    const her = this.her;
    if (her) return her.root.localToWorld(out.set(lateral, 47 * TVS - her.ch.drop * 8 * TVS, -10 * TVS));
    return out.copy(this.pivot).add(_a.set(lateral, 1.2, 0));
  }

  // ---------------------------------------------------------------- per frame
  update(rdt: number) {
    if (!this.active) return;
    const h = Math.min(rdt, 0.05);
    this.t += h;
    this.pt += h;
    const ctx = this.ctx;
    const inp = this.input;
    if (this.phase !== 'leave' && (inp.wasPressed('Escape') || inp.wasPressed('KeyT'))) this.close();
    // the world is paused: keep the dust and flashes alive for the shop
    ctx.fx.update(h);
    ctx.particles.update(h, ctx.world.env.fog);
    const her = this.her;
    // ---- her pack spills
    if (this.phase === 'browse' && !this.heaved && this.pt >= this.tumbleAt) {
      this.heaved = true;
      her?.heaveKick();
      ctx.sfx('book_open', this.packPoint(_v, 0), 0.5, 0.8);
    }
    for (const b of this.bodies) if (b.state === 'wait' && this.phase === 'browse' && this.pt >= b.launch) this.launch(b);
    this.simulate(h);
    // ---- hover / buy / shoot
    this.hoverLock -= h;
    this.shotCd -= h;
    if (this.phase === 'browse') {
      this.pick();
      if (inp.wasPressed('Mouse2') && this.shotCd <= 0) this.shoot();
      if (this.hovered && inp.wasPressed('Mouse0')) this.buy(this.hovered);
    }
    this.updateTip();
    // ---- Tamsin
    if (her) {
      her.near = false;
      const hb = this.hovered;
      her.lookAt = hb ? this.group.localToWorld(_w.copy(hb.p)) : _w.copy(this.ctx.camera.position);
      her.update(h);
    }
    // ---- camera, light, grade
    if (this.phase === 'leave') this.camK = Math.max(0, this.camK - h / 0.95);
    else this.camK = Math.min(1, this.camK + h / 1.6);
    this.updateCamera(h);
    const warm = smoother(this.camK);
    this.applyGrade(warm);
    this.holdLight(warm);
    if (this.phase === 'leave' && ((this.camK <= 0 && this.bodies.every((b) => b.state === 'gone')) || this.pt > 1.6)) this.finish();
  }

  private updateCamera(h: number) {
    const hb = this.hovered && this.hovered.state === 'held' ? this.hovered : null;
    if (hb) {
      this.group.localToWorld(_v.copy(hb.p));
      if (this.focusK < 0.02) this.focus.copy(_v);
      else this.focus.lerp(_v, 1 - Math.exp(-5 * h));
    }
    this.focusK = damp(this.focusK, hb && this.phase !== 'leave' ? 1 : 0, 2.4, h);
    const f = this.focusK * this.focusK * (3 - 2 * this.focusK);
    const P1 = _a.copy(this.camMain.pos).lerp(this.focus, 0.3 * f);
    const L1 = _b.copy(this.camMain.look).lerp(this.focus, 0.6 * f);
    const fov1 = this.camMain.fov - 8 * f;
    const e = smoother(this.camK);
    this.orbit(this.camFrom.pos, P1, e, this.shot.pos);
    const el = smoother(this.camK * 1.25);
    this.shot.look.copy(this.camFrom.look).lerp(L1, el);
    this.shot.fov = mix(this.camFrom.fov, fov1, e);
    // handheld: a slow, breathing drift (never a shake)
    const t = this.t, hh = 0.3 + 0.7 * e;
    this.shot.pos.x += noise.n2(t * 0.35, 1.3) * 0.016 * hh;
    this.shot.pos.y += noise.n2(t * 0.3, 7.7) * 0.011 * hh;
    this.shot.pos.z += noise.n2(t * 0.33, 4.1) * 0.016 * hh;
    this.shot.look.x += noise.n2(t * 0.27, 9.2) * 0.012 * hh;
    this.shot.look.y += noise.n2(t * 0.25, 2.9) * 0.009 * hh;
    this.shot.look.z += noise.n2(t * 0.29, 6.6) * 0.012 * hh;
    this.shot.roll = noise.n2(t * 0.21, 5.5) * 0.007 * hh;
  }

  // ---------------------------------------------------------------- picking & tooltip
  private pick() {
    const inp = this.input;
    const W = this.ctx.engine.width, H = this.ctx.engine.height;
    const base = Math.max(55, W * 0.055);
    let best: Body | null = null, bd = Infinity, curD = Infinity;
    if (this.hoverLock <= 0)
      for (const b of this.bodies) {
        if (!(b.state === 'held' || (b.state === 'free' && b.landed))) continue;
        // anchor on where it rests, so lifting it never steals the hover
        _v.set(b.rest.x, this.rugTop + b.he.y, b.rest.z);
        if (b.state === 'free') _v.copy(b.p);
        this.group.localToWorld(_v).project(this.ctx.camera);
        if (_v.z > 1) continue;
        const d = Math.hypot((_v.x * 0.5 + 0.5) * W - inp.mouseX, (-_v.y * 0.5 + 0.5) * H - inp.mouseY);
        const r = b === this.hovered ? base * 1.6 : base;
        if (b === this.hovered && d < r) curD = d;
        if (d < r && d < bd) {
          bd = d;
          best = b;
        }
      }
    // hysteresis: only switch when the new ware is clearly nearer the cursor
    if (this.hovered && curD < Infinity && best !== this.hovered && bd > curD * 0.7) best = this.hovered;
    if (best !== this.hovered) {
      if (this.hovered && this.hovered.state === 'held') this.drop(this.hovered);
      if (best) {
        this.ctx.sfx('card_hover', null, 0.5);
        if (best.state === 'free') {
          best.state = 'held';
          best.asleep = false;
          best.rest.copy(best.p);
        }
      }
      this.hovered = best;
    }
  }

  private updateTip() {
    const b = this.hovered;
    if (!b || this.phase !== 'browse') {
      this.tip.style.display = 'none';
      return;
    }
    const w = b.ware, inp = this.input;
    const afford = this.ctx.run.gold >= w.price;
    this.tip.innerHTML = `<div style="font-size:20px;color:#8a2a18">${w.name}</div><div style="margin:4px 0 6px">${w.desc}</div><div style="color:${afford ? '#7a5a10' : '#a02a1a'}">${w.price} gold</div>`;
    this.tip.style.display = 'block';
    this.tip.style.left = `${inp.mouseX + 18}px`;
    this.tip.style.top = `${inp.mouseY - 10}px`;
  }

  // ---------------------------------------------------------------- rigid bodies
  private launch(b: Body) {
    b.state = 'free';
    b.obj.visible = true;
    const start = this.packPoint(_v, (rnd.next() - 0.5) * 0.3);
    this.ctx.fx.dust({ x: start.x, y: start.y, z: start.z }, 0.22, P.sand1, 2);
    this.group.worldToLocal(start);
    b.p.copy(start);
    const T = 0.64 + rnd.next() * 0.14;
    b.v.copy(b.slot).sub(b.p).multiplyScalar(1 / T);
    b.v.y += 0.5 * G * T;
    b.q.setFromEuler(new THREE.Euler(rnd.next() * 6.28, rnd.next() * 6.28, rnd.next() * 6.28));
    b.w.set(rnd.range(-9, 9), rnd.range(-6, 6), rnd.range(-9, 9));
    b.asleep = false;
    this.ctx.sfx('whoosh', this.group.localToWorld(_w.copy(b.p)), 0.12, 1.7);
  }

  /** inverse world inertia applied to x (mass 1, box inertia) */
  private invI(b: Body, x: THREE.Vector3, out: THREE.Vector3) {
    _q2.copy(b.q).invert();
    return out.copy(x).applyQuaternion(_q2).multiply(b.invI).applyQuaternion(b.q);
  }

  private floorAt(x: number, z: number) {
    return Math.abs(x) <= this.rugHalf.x && Math.abs(z) <= this.rugHalf.y ? this.rugTop : 0;
  }

  /** an impulse j (m/s, local) at local point at (null: the centre) */
  private kick(b: Body, jIn: THREE.Vector3, at: THREE.Vector3 | null) {
    const j = _kj.copy(jIn);
    if (b.state === 'held') {
      b.state = 'free';
      if (this.hovered === b) {
        this.hovered = null;
        this.hoverLock = 0.45;
      }
    }
    if (b.state !== 'free') return;
    b.asleep = false;
    b.still = 0;
    b.v.add(j);
    if (at) {
      const r = _kr.copy(at).sub(b.p);
      this.invI(b, _b.crossVectors(r, j), _c);
      b.w.add(_c);
    } else b.w.add(_a.set(rnd.range(-3, 3), rnd.range(-2, 2), rnd.range(-3, 3)));
  }

  private drop(b: Body) {
    b.state = 'free';
    b.asleep = false;
    b.still = 0;
    b.v.set(0, 0, 0);
    b.w.set(rnd.range(-1.5, 1.5), rnd.range(-0.5, 0.5), rnd.range(-1.5, 1.5));
  }

  private simulate(h: number) {
    const sub = Math.max(1, Math.ceil(h / (1 / 240)));
    const hs = h / sub;
    for (let s = 0; s < sub; s++) {
      for (const b of this.bodies) if (b.state === 'free' && !b.asleep) this.step(b, hs);
      this.collide();
    }
    for (const b of this.bodies) {
      b.clack -= h;
      if (b.state === 'held') {
        b.spin += h * 1.25;
        _v.set(b.rest.x, this.rugTop + 0.36 + Math.sin(this.t * 2.3 + b.spin) * 0.012, b.rest.z);
        b.p.lerp(_v, 1 - Math.exp(-8 * h));
        _q.setFromAxisAngle(UP, b.spin);
        b.q.slerp(_q, 1 - Math.exp(-6 * h));
      } else if (b.state === 'sold' || b.state === 'pack') {
        b.t += h;
        const sold = b.state === 'sold';
        const dur = sold ? 0.62 : 0.42;
        if (b.t < 0) continue;
        const k = c01(b.t / dur);
        const to = sold ? this.satchel(_w) : this.packPoint(_w, 0);
        this.group.worldToLocal(to);
        const ctrl = _c.copy(b.arc0).add(to).multiplyScalar(0.5);
        ctrl.y = Math.max(b.arc0.y, to.y) + 0.55 + b.arc0.distanceTo(to) * 0.12;
        const e = sold ? Ease.inOutQuad(k) : Ease.inQuad(k);
        const u = 1 - e;
        b.p.set(0, 0, 0).addScaledVector(b.arc0, u * u).addScaledVector(ctrl, 2 * u * e).addScaledVector(to, e * e);
        b.q.multiply(_q.setFromAxisAngle(_a.set(0.6, 1, 0.3).normalize(), h * 11));
        b.obj.scale.setScalar(1 - 0.55 * smoother((k - 0.55) / 0.45));
        if (k >= 1) {
          b.state = 'gone';
          b.obj.visible = false;
          const wp = this.group.localToWorld(_v.copy(to));
          if (sold) {
            this.ctx.sfx('book_close', wp, 0.45, 1.25);
            this.ctx.fx.sparkle({ x: wp.x, y: wp.y, z: wp.z }, 0xffd36b, 5, 0.25);
          }
        }
      }
      b.obj.position.copy(b.p);
      b.obj.quaternion.copy(b.q);
    }
  }

  private step(b: Body, h: number) {
    b.v.y -= G * h;
    b.p.addScaledVector(b.v, h);
    _q.set(b.w.x * h * 0.5, b.w.y * h * 0.5, b.w.z * h * 0.5, 0).multiply(b.q);
    b.q.set(b.q.x + _q.x, b.q.y + _q.y, b.q.z + _q.z, b.q.w + _q.w).normalize();
    const floor = this.floorAt(b.p.x, b.p.z);
    let pen = 0, contacts = 0, impact = 0;
    const r = _a, vc = _b, rn = _c, t1 = _v, t2 = _w;
    for (const c of CORNERS) {
      r.set(c[0] * b.he.x, c[1] * b.he.y, c[2] * b.he.z).applyQuaternion(b.q);
      const py = b.p.y + r.y;
      if (py >= floor) continue;
      contacts++;
      pen = Math.max(pen, floor - py);
      vc.crossVectors(b.w, r).add(b.v);
      if (vc.y >= 0) continue;
      impact = Math.max(impact, -vc.y);
      // normal impulse
      rn.crossVectors(r, UP);
      this.invI(b, rn, t1);
      const kn = 1 + t2.crossVectors(t1, r).y;
      const e = vc.y < -0.9 ? RESTITUTION : 0;
      const jn = (-(1 + e) * vc.y) / kn;
      b.v.y += jn;
      b.w.addScaledVector(t1, jn);
      // Coulomb friction against the sliding direction
      vc.crossVectors(b.w, r).add(b.v);
      vc.y = 0;
      const vt = vc.length();
      if (vt > 1e-5) {
        vc.multiplyScalar(1 / vt);
        rn.crossVectors(r, vc);
        this.invI(b, rn, t1);
        const kt = 1 + vc.dot(t2.crossVectors(t1, r));
        const jt = Math.min(vt / kt, FRICTION * jn);
        b.v.addScaledVector(vc, -jt);
        b.w.addScaledVector(t1, -jt);
      }
    }
    if (contacts) {
      b.p.y += pen * 0.8;
      b.v.multiplyScalar(1 - Math.min(1, 1.6 * h));
      b.w.multiplyScalar(1 - Math.min(1, 2.6 * h));
      if (impact > 1.1 && b.clack <= 0) {
        b.clack = 0.12;
        const wp = this.group.localToWorld(_v.set(b.p.x, floor, b.p.z));
        const vol = Math.min(0.5, 0.1 + impact * 0.07);
        if (b.sound === 'metal') this.ctx.sfx('shell_casing', wp, vol, 0.8);
        else if (b.sound === 'glass') this.ctx.sfx('shell_casing', wp, vol * 0.8, 1.3);
        else this.ctx.sfx('board_land', wp, vol * 0.6, 1.6);
        if (!b.landed || impact > 2.4) this.ctx.fx.dust({ x: wp.x, y: wp.y + 0.03, z: wp.z }, 0.2 + Math.min(0.2, impact * 0.04), P.sand0, 2);
      }
      b.landed = true;
      if (contacts >= 3 && b.v.lengthSq() < 0.004 && b.w.lengthSq() < 0.12) {
        b.still += h;
        if (b.still > 0.3) {
          b.asleep = true;
          b.v.set(0, 0, 0);
          b.w.set(0, 0, 0);
          b.rest.copy(b.p);
        }
      } else b.still = 0;
    } else b.still = 0;
    // a soft lip around the rug keeps knocked wares within reach
    const lx = this.rugHalf.x + 0.3, lz = this.rugHalf.y + 0.25;
    if (Math.abs(b.p.x) > lx) {
      b.p.x = Math.sign(b.p.x) * lx;
      b.v.x *= -0.3;
    }
    if (Math.abs(b.p.z) > lz) {
      b.p.z = Math.sign(b.p.z) * lz;
      b.v.z *= -0.3;
    }
  }

  /** wares bump each other (sphere proxies) */
  private collide() {
    const B = this.bodies;
    for (let i = 0; i < B.length; i++) {
      const a = B[i];
      if (a.state !== 'free' && a.state !== 'held') continue;
      for (let j = i + 1; j < B.length; j++) {
        const b = B[j];
        if (b.state !== 'free' && b.state !== 'held') continue;
        const n = _v.copy(b.p).sub(a.p);
        const d = n.length(), r = a.rad + b.rad;
        if (d >= r || d < 1e-5) continue;
        n.multiplyScalar(1 / d);
        const ma = a.state === 'free' ? 1 : 0, mb = b.state === 'free' ? 1 : 0;
        if (ma + mb === 0) continue;
        const push = (r - d) / (ma + mb);
        a.p.addScaledVector(n, -push * ma);
        b.p.addScaledVector(n, push * mb);
        const rel = _w.copy(b.v).sub(a.v).dot(n);
        if (rel < 0) {
          const j2 = (-(1 + 0.2) * rel) / (ma + mb);
          a.v.addScaledVector(n, -j2 * ma);
          b.v.addScaledVector(n, j2 * mb);
        }
        if (ma) a.asleep = false;
        if (mb) b.asleep = false;
      }
    }
  }

  // ---------------------------------------------------------------- warning shots
  private shoot() {
    this.shotCd = 0.32;
    const ctx = this.ctx, inp = this.input;
    this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), ctx.camera);
    const o = this.ray.ray.origin.clone(), d = this.ray.ray.direction.clone();
    const hitP = new THREE.Vector3();
    let hitB: Body | null = null;
    const live = this.bodies.filter((b) => b.state === 'free' || b.state === 'held');
    const hits = this.ray.intersectObjects(live.map((b) => b.obj), true);
    if (hits.length) {
      hitP.copy(hits[0].point);
      hitB = live.find((b) => b.obj === hits[0].object.parent) ?? null;
    }
    if (!hitB) {
      // the rug / the sand under it
      const n = new THREE.Vector3(0, 1, 0).applyQuaternion(this.group.quaternion);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, this.group.position);
      if (!this.ray.ray.intersectPlane(plane, hitP)) hitP.copy(o).addScaledVector(d, 20);
    }
    // from the hunter's gun hand when we know where he stands
    const muzzle = new THREE.Vector3();
    if (this.hunter) {
      muzzle.copy(this.hunter).y += 1.25;
      muzzle.addScaledVector(new THREE.Vector3().subVectors(hitP, muzzle).normalize(), 0.45);
    } else muzzle.copy(o).addScaledVector(d, 0.8).y -= 0.3;
    const dir = new THREE.Vector3().subVectors(hitP, muzzle).normalize();
    ctx.fx.muzzle(muzzle, dir);
    ctx.fx.tracer(muzzle, hitP);
    ctx.sfx('rev_shot', muzzle, 0.9);
    if (rnd.chance(0.5)) ctx.sfx('rev_hammer', muzzle, 0.25);
    this.cam.addTrauma(0.14);
    const dl = dir.clone().applyQuaternion(this.gq);
    const at = this.group.worldToLocal(hitP.clone());
    if (hitB) {
      ctx.fx.hit(hitP, { x: -dir.x, y: -dir.y, z: -dir.z }, hitB.sound === 'metal' ? 'armor' : 'wood', 0.6);
      ctx.sfx(hitB.sound === 'metal' ? 'ricochet' : 'bullet_impact_rock', hitP, 0.7);
      this.kick(hitB, dl.multiplyScalar(3.2).add(new THREE.Vector3(0, 1.5, 0)), at);
    } else {
      ctx.fx.hit(hitP, UP, 'sand', 0.7);
      ctx.sfx('bullet_impact_sand', hitP, 0.7);
      for (const b of live) {
        const dd = Math.hypot(b.p.x - at.x, b.p.z - at.z);
        if (dd > 0.5) continue;
        const k = 1 - dd / 0.5;
        const j = new THREE.Vector3(b.p.x - at.x, 0, b.p.z - at.z).normalize().multiplyScalar(1.3 * k);
        j.y = 1.8 * k;
        this.kick(b, j, null);
      }
    }
    // a gunshot on her own rug: into the shell, and a word when she comes back out
    const her = this.her;
    if (her) {
      her.threat(1);
      if (!this.scolded) {
        this.scolded = true;
        her.onOut = () => {
          if (!this.active || this.her !== her) return;
          ctx.toast(TITLE, '#ffd36b', rnd.pick(LINES.shot));
          her.say('squinty', 1.4);
          her.shake();
        };
      }
    }
  }

  // ---------------------------------------------------------------- warm light + grade
  private holdLight(k: number) {
    const L = this.ctx.fx.lights[this.ctx.fx.lights.length - 1];
    if (!L) return;
    if (k <= 0.001) {
      if (this.lightHeld) {
        L.t = L.dur = 1;
        L.l.intensity = 0;
        this.lightHeld = false;
      }
      return;
    }
    this.lightHeld = true;
    const H = this.pivot, a = this.fwdAng;
    L.t = 0;
    L.dur = 1e9;
    L.l.position.set(H.x + Math.sin(a) * 0.85, H.y + 1.3, H.z + Math.cos(a) * 0.85);
    L.l.color.setHex(0xffb064);
    L.l.distance = 6;
    const I = 2.4 * k * (0.93 + 0.07 * noise.n2(this.t * 3.1, 0.7));
    L.i0 = I;
    L.l.intensity = I;
  }

  private applyGrade(k: number) {
    const u = this.ctx.engine.post?.u;
    if (!u) return;
    if (!this.grade) this.grade = { s: u.uTintShadows.value.clone(), h: u.uTintHighlights.value.clone(), sat: u.uSaturation.value, vig: u.uVignette.value };
    const g = this.grade;
    u.uTintHighlights.value.setRGB(mix(g.h.r, 1.075, k), mix(g.h.g, 1.0, k), mix(g.h.b, 0.885, k));
    u.uTintShadows.value.setRGB(mix(g.s.r, 0.99, k), mix(g.s.g, 0.97, k), mix(g.s.b, 1.03, k));
    u.uSaturation.value = mix(g.sat, g.sat + 0.06, k);
    u.uVignette.value = mix(g.vig, Math.max(g.vig, 0.48), k);
  }

  private restoreGrade() {
    const u = this.ctx.engine.post?.u;
    const g = this.grade;
    this.grade = null;
    if (!u || !g) return;
    u.uTintShadows.value.copy(g.s);
    u.uTintHighlights.value.copy(g.h);
    u.uSaturation.value = g.sat;
    u.uVignette.value = g.vig;
  }
}

/** standard stock for the trading post */
export function merchantStock(ctx: Ctx, add: (id: ItemId) => boolean, heal: () => void, card: () => void): Ware[] {
  const w = ctx.run.wave;
  const scale = 1 + w * 0.03;
  const pool = (Object.keys(ITEMS) as ItemId[]).filter((id) => id !== 'charm' || w > 10);
  const picks: ItemId[] = [];
  while (picks.length < 3) {
    const id = rnd.pick(pool);
    if (!picks.includes(id)) picks.push(id);
  }
  const wares: Ware[] = picks.map((id) => ({ id, name: ITEMS[id].name, desc: ITEMS[id].desc, price: Math.round(ITEMS[id].price * scale), model: ITEMS[id].model, buy: () => add(id) }));
  wares.push({ id: 'heal', name: 'Camel-Milk Tonic', desc: 'Drink it all. Heals to full. Tastes like regret.', price: Math.round(45 * scale), model: 'bottle', buy: () => (heal(), true) });
  wares.push({ id: 'card', name: 'Fortune Card', desc: 'A sealed upgrade card from the merchant\'s deck. Pick 1 of 3.', price: Math.round(90 * scale), model: 'book', buy: () => (card(), true) });
  return wares;
}
