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
//
// Arrival: ride slowly into ~13 m of her (or head straight for her) and a short
// cutscene takes over — letterbox, the board brakes to a stop in a spray of
// sand, the camera cranes up past the TRADING POST sign and swings down to her;
// startled by the board she has ducked into her shell, so she peeks out, eyes
// first, then greets you in floating Alagard text and the shop opens. Leaving
// gets a farewell beat (she waves her cane) before the dolly back. It re-arms
// once you have ridden off and stayed away a few seconds; never with enemies
// within 15 m or during a boss fight. In the shop each ware sits in its own
// soft pool of light, she has something to say about whatever you hover, and a
// purchase pays her in a spray of coins.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Input } from '../../engine/Input';
import type { CameraRig, CineShot } from '../player/CameraRig';
import type { RigInstance } from '../../engine/voxel/Rig';
import * as PM from '../models/props';
import { modelEntry } from '../models/lookup';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { P } from '../../engine/voxel/palette';
import { ITEMS, ItemId } from '../player/Items';
import { clamp, damp, noise, rnd } from '../../engine/math/rand';
import { Ease } from '../../engine/Tween';
import { FloatText3D } from '../fx/FloatText3D';

/** what the run hands her each frame so she can stage her own arrival scene */
export interface MerchantHooks {
  /** the hunter's board (braked to a stop when the arrival scene starts) */
  board?: { vel: THREE.Vector3 };
  /** her wares, the same stock the T-key path uses; without it there is no arrival scene */
  stock?: () => Ware[];
  /** something else owns the screen (a mission cinematic, a notice, the hunter is dead) */
  busy?: () => boolean;
}

const ARRIVE_R = 13; // ride inside this to be greeted
const REARM_R = 17; // ...and out past this (for REARM_T seconds) before it can happen again
const REARM_T = 4;
const CALM_R = 15; // no scene with an enemy this close to the hunter

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
  bye: ['Ride safe! Or don\'t, more customers for Anubis.', 'Go with sand in your boots!', 'Off you clatter, dearie. Come back richer.'],
  shot: ['Not at the merchandise, dearie!', 'I am two hundred years old. Put that away.', 'Shoot the outlaws, not my wares!'],
  // after the board has skidded in and she has peeked out of her shell
  arrive: ['Oh! Only you, bone-friend. Come, come, look at my things.', 'Such a racket! Ah, a customer. Then it was worth it.', 'You nearly scraped my shell, dearie. Buy something.'],
};

/** what she says about the ware you are looking at (a fresh line each time) */
const COMMENT: Record<string, string[]> = {
  bandage: ['Clean linen. Mostly clean.', 'Wraps a scratch, hides a hole.', 'My third husband swore by these.'],
  goldBandage: ['Pharaoh-grade linen, dearie.', 'Wrapped a king once. He never complained.', 'Still smells of myrrh. And of king.'],
  dagger: ['Sharp end goes away from you.', 'A little of you for a lot of oomph.', 'Cursed? Only on Tuesdays.'],
  smoke: ['Pop it and you were never here.', 'Smells of burnt sage and debts.', 'For leaving parties early.'],
  shield: ['Tin, but very confident tin.', 'Stops a bullet. Probably two.', 'A sheriff swapped it for soup.'],
  charm: ['Serket blessed it. I watched.', 'Do not lick the scorpion.', 'Pricey. Gods are greedy.'],
  dynamite: ['Not near my shell, please.', 'Light it, throw it, run.', 'Hold it like a grandchild.'],
  snakeoil: ['Doc Hapi swears it works.', 'Quick feet. Loud hiccups.', 'Tastes of a snake\'s regrets.'],
  whiskey: ['Cactus-aged. Most spines out.', 'Steadies the aim. Then it does not.', 'One sip and you see two of me.'],
  heal: ['Fresh from my camel. Do not ask.', 'Heals everything but pride.', 'It is warm. That is not a good sign.'],
  card: ['Your fortune, sealed in wax.', 'Pick one, regret the other two.', 'The cards like you. Mostly.'],
  _: ['A fine thing, that.', 'Old, but so am I.', 'Lovely, isn\'t it?'],
};

/**
 * Theatre lighting for the shop without adding a single scene light (no shader
 * recompiles): the rug's voxel shader gets up to six soft pools of warm light
 * under the wares, and each ware's shader a light from straight above. Both are
 * computed per fragment in view space; the shop writes the uniforms just before
 * each draw (onBeforeRender), so they never lag the moving camera.
 */
const SPOT_N = 6;
interface SpotUniforms {
  uSpots: { value: THREE.Vector4[] };
  uSpotR: { value: number };
  uSpotCol: { value: THREE.Color };
  uTop: { value: THREE.Vector4 };
}
function spotMaterial(): { m: VoxelMaterial; u: SpotUniforms } {
  const m = makeVoxelMaterial();
  const u: SpotUniforms = {
    uSpots: { value: Array.from({ length: SPOT_N }, () => new THREE.Vector4()) },
    uSpotR: { value: 0.3 },
    uSpotCol: { value: new THREE.Color(1.0, 0.82, 0.56) },
    uTop: { value: new THREE.Vector4(0, 1, 0, 0) },
  };
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec4 uSpots[${SPOT_N}];\nuniform float uSpotR;\nuniform vec3 uSpotCol;\nuniform vec4 uTop;`)
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 vp = -vViewPosition;
          float pool = 0.0;
          for (int i = 0; i < ${SPOT_N}; i++) {
            float d = length(vp - uSpots[i].xyz);
            // a theatre spot: soft rim, a little hotter in the middle
            pool += uSpots[i].w * smoothstep(uSpotR, uSpotR * 0.45, d) * (0.65 + 0.35 * smoothstep(uSpotR * 0.8, 0.0, d));
          }
          float top = uTop.w * max(dot(normal, uTop.xyz), 0.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSpotCol * (pool + top);
        }`
      );
  };
  m.customProgramCacheKey = () => 'shop-spot-v1';
  return { m, u };
}

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
const _l = new THREE.Vector3();
/** uniform Catmull-Rom through pts (clamped ends), u in [0, pts.length - 1] */
function catmull(pts: THREE.Vector3[], u: number, out: THREE.Vector3) {
  const n = pts.length - 1;
  const i = Math.min(n - 1, Math.max(0, Math.floor(u)));
  const t = clamp(u - i, 0, 1);
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return out.set(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}
const _f = new THREE.Vector3();
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
  /** a cutscene holds her in her shell (she only peeks when coaxed) */
  hold = false;
  // arrival-scene trigger state (per merchant)
  armed = true;
  awayT = 0;
  dwell = 0;
  readonly lastHunter = new THREE.Vector3(NaN, 0, 0);

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
    if (s) return s.localToWorld(out.set(0, 0.4, -0.06));
    out.copy(this.root.position).y += 0.75;
    return out;
  }
  /** world-space centre of her head (only meaningful while she is out) */
  headPos(out: THREE.Vector3) {
    const h = this.n.head;
    if (h) return h.localToWorld(out.set(0, 0.13, 0.2));
    out.copy(this.root.position).y += 1.35;
    return out;
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

  /** a customer: if she is in her shell she peeks (holding `peekHold` s), then comes out */
  coax(peekHold = 0.25) {
    this.hold = false;
    if (!this.hidden) return;
    this.setMode('peek');
    this.peekHold = peekHold;
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
        if (!this.hold) this.calm += dt;
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
  /** its spotlight (0 dark .. 1 hovered) and the shader uniforms it drives */
  lit: number;
  spot: { m: VoxelMaterial; u: SpotUniforms };
  /** time spent hovered (she comments after a beat) */
  gaze: number;
}

const G = 10.5;
const RESTITUTION = 0.32;
const FRICTION = 0.6;
const SLOP = 0.004;
const CORNERS: [number, number, number][] = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) CORNERS.push([x, y, z]);

function itemObject(key: string, mat: THREE.Material): { obj: THREE.Group; he: THREE.Vector3 } {
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
      const m = new THREE.Mesh(geo, mat);
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

interface Arrival {
  her: Tamsin;
  hooks: MerchantHooks;
  t: number;
  /** the board has stopped and the world is held */
  modal: boolean;
  /** camera keys: riding rig, the sign beat, the close-up on her (+ looks, fovs) */
  P: THREE.Vector3[];
  L: THREE.Vector3[];
  F: number[];
  coaxed: boolean;
  /** scene time she was all the way out (-1: not yet) */
  outAt: number;
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
  private phase: 'off' | 'arrive' | 'browse' | 'leave' = 'off';
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
  private herHeight = 1.53;
  // arrival cutscene
  private arrival: Arrival | null = null;
  private inputWas = true;
  // where the leaving dolly lands (the riding camera) and where it starts
  private camHome = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 72 };
  private leaveFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 46 };
  private leaveSplit = false;
  private warm = 0;
  private punch = 0;
  // her floating Alagard lines
  private speech: FloatText3D | null = null;
  private fading: FloatText3D[] = [];
  private speechT = 0;
  private speechSide = 1;
  private pendingLine: { text: string; mood: 'neutral' | 'laugh' | 'squinty'; at: number } | null = null;
  private lastComment = new Map<string, number>();
  private commented = new Set<Body>();
  private greeted = false;
  // the rug's light pools
  private rugSpot: { m: VoxelMaterial; u: SpotUniforms } | null = null;
  private bosses = new Set<{ alive?: boolean }>();

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
    // no arrival scene while a boss is up
    this.unsub.push(ctx.events.on('bossIntro', (b: { alive?: boolean }) => b && this.bosses.add(b)));
    for (const ev of ['bossKilled', 'bossDefeated'])
      this.unsub.push(ctx.events.on(ev, (b: { alive?: boolean }) => this.bosses.delete(b)));
  }

  /** the open shop (or its arrival scene) is driving this puppet */
  private owns(p: Tamsin) {
    return (this.active || !!this.arrival) && this.her === p;
  }

  // ---------------------------------------------------------------- Tamsin in the world
  /**
   * World idle + shyness for a merchant rig. Call every frame for her rig
   * (game dt) from wherever she lives; `hunter` is the player's live position.
   */
  animateMerchant(rig: RigInstance, dt: number, hunter?: THREE.Vector3, hooks?: MerchantHooks) {
    if (hunter) this.hunter = hunter;
    let p = this.puppets.get(rig);
    if (!p) {
      p = new Tamsin(this.ctx, rig, rig.root, rig.geo.spec.meta ?? {});
      this.puppets.set(rig, p);
    }
    if (this.owns(p)) return; // the shop / its arrival scene drives her
    const h = Math.min(dt, 1 / 20);
    if (h <= 0) return;
    const d = hunter ? hunter.distanceTo(rig.root.position) : 99;
    if (d < 25 && this.aimedAt(p)) p.threat(0.5);
    p.near = d < 12;
    p.lookAt = hunter && d < 14 ? _w.copy(hunter).add(_a.set(0, 1.45, 0)) : null;
    p.update(h);
    if (hunter && hooks?.stock) this.watchArrival(p, hunter, hooks, h);
  }

  /**
   * Ride into her radius slowly, or head straight for her, and the arrival
   * scene plays. Riding past at speed, or anything going on, and it does not.
   */
  private watchArrival(p: Tamsin, hunter: THREE.Vector3, hooks: MerchantHooks, h: number) {
    const H = p.root.position;
    const d = Math.hypot(hunter.x - H.x, hunter.z - H.z);
    // velocity: the board's own, else from his last position
    const vel = _b.set(0, 0, 0);
    if (hooks.board) vel.copy(hooks.board.vel);
    else if (Number.isFinite(p.lastHunter.x)) vel.subVectors(hunter, p.lastHunter).multiplyScalar(1 / h);
    p.lastHunter.copy(hunter);
    if (!p.armed) {
      p.dwell = 0;
      p.awayT = d > REARM_R ? p.awayT + h : 0;
      if (p.awayT > REARM_T) p.armed = true;
      return;
    }
    if (d > ARRIVE_R || this.active || this.arrival || !p.root.parent) {
      p.dwell = 0;
      return;
    }
    const speed = Math.hypot(vel.x, vel.z);
    const toHer = _c.set(H.x - hunter.x, 0, H.z - hunter.z).normalize();
    const heading = speed > 0.5 ? (vel.x * toHer.x + vel.z * toHer.z) / speed : 1;
    const willing = (speed < 6.5 || (heading > 0.8 && speed < 20)) && Math.abs(vel.y) < 4;
    if (!willing || this.sceneBlocked(hunter, hooks)) {
      p.dwell = 0;
      return;
    }
    p.dwell += h;
    if (p.dwell > 0.2) this.startArrival(p, hooks);
  }

  private sceneBlocked(hunter: THREE.Vector3, hooks: MerchantHooks) {
    if (this.ctx.engine.paused || this.cam.cine || hooks.busy?.()) return true;
    return this.danger(hunter);
  }

  /** a boss is up, or an outlaw is within CALM_R of the hunter */
  private danger(hunter: THREE.Vector3) {
    for (const b of this.bosses) if (b.alive === false) this.bosses.delete(b);
    if (this.bosses.size) return true;
    for (const e of this.ctx.enemies.list) {
      if (!e.alive) continue;
      if (e.isBoss) return true;
      if (Math.hypot(e.pos.x - hunter.x, e.pos.z - hunter.z) <= CALM_R) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- the arrival scene
  private startArrival(her: Tamsin, hooks: MerchantHooks) {
    const ctx = this.ctx, eng = ctx.engine;
    her.armed = false;
    her.awayT = 0;
    her.dwell = 0;
    this.her = her;
    this.borrowed = false;
    this.herHeight = (her.rig?.geo.spec.meta?.height as number | undefined) ?? 1.53;
    const H = her.root.position, a = her.root.rotation.y;
    const F = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), L = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    this.pivot.copy(H);
    this.fwdAng = a;
    // the post's door is 1.6 m to her right (Missions' layout); the big
    // TRADING POST sign hangs on the false front above it
    const door = H.clone().addScaledVector(L, -1.6);
    const sign = door.clone().addScaledVector(F, -2.33);
    sign.y = H.y + 6.3;
    const cam = this.cam.camera;
    const p0 = cam.position.clone();
    cam.getWorldDirection(_v);
    const l0 = p0.clone().addScaledVector(_v, 6);
    // a high beat in front of the porch, looking up at the sign...
    const pSign = door.clone().addScaledVector(F, 5).addScaledVector(L, -2);
    pSign.y = Math.max(H.y, this.ctx.world.groundAt(pSign.x, pSign.z)) + 4.6;
    // ...then down and across to a low close-up on her
    const look = H.clone().addScaledVector(F, 0.15);
    look.y = H.y + 0.72;
    let pNear: THREE.Vector3 | null = null;
    for (const k of [1, 0.8])
      for (const s of [1, -1]) {
        if (pNear) break;
        const q = H.clone().addScaledVector(F, 2.1 * k).addScaledVector(L, 0.9 * k * s);
        q.y = Math.max(H.y, ctx.world.groundAt(q.x, q.z)) + 0.78;
        if (this.clearView(q, look)) pNear = q;
      }
    if (!pNear) {
      pNear = H.clone().addScaledVector(F, 1.9).addScaledVector(L, 0.6);
      pNear.y = H.y + 1.1;
    }
    this.arrival = { her, hooks, t: 0, modal: false, P: [p0, pSign, pNear], L: [l0, sign, look], F: [cam.fov, 50, 38], coaxed: false, outAt: -1 };
    this.shot.pos.copy(p0);
    this.shot.look.copy(l0);
    this.shot.fov = cam.fov;
    this.shot.roll = 0;
    this.cam.setCine(this.shot, false);
    eng.letterbox(true, 0.5);
    this.inputWas = eng.input.enabled;
    eng.input.enabled = false; // the hunter lets go of the reins
    this.phase = 'arrive';
    this.pt = 0;
    this.greeted = false;
    this.pendingLine = null;
    this.warm = 0;
    // the board skids in; startled, she ducks into her shell
    her.threat(1);
    her.hold = true;
    ctx.sfx('sand_spray', this.hunter ?? H, 0.7, 0.9);
  }

  private updateArrival(h: number) {
    const A = this.arrival!;
    const ctx = this.ctx, eng = ctx.engine, inp = this.input, her = A.her;
    if (!A.modal && eng.paused) return; // the player paused the game mid-approach
    A.t += h;
    // ---- brake the board (the world still runs until it has stopped)
    if (!A.modal) {
      const b = A.hooks.board;
      let sp = 0;
      if (b) {
        const k = Math.exp(-7 * h);
        b.vel.x *= k;
        b.vel.z *= k;
        sp = Math.hypot(b.vel.x, b.vel.z);
        const hp = this.hunter;
        if (hp && sp > 1.2 && rnd.chance(0.75)) ctx.fx.sandSpray({ x: hp.x, y: hp.y + 0.05, z: hp.z }, { x: -b.vel.x * 0.25, y: 1.4, z: -b.vel.z * 0.25 }, Math.min(1.3, sp * 0.14));
      }
      if (this.hunter && this.danger(this.hunter)) return this.abortArrival(); // trouble rode in too
      if (A.t > 0.8 || (A.t > 0.35 && sp < 0.4)) {
        if (b) {
          b.vel.x = 0;
          b.vel.z = 0;
        }
        A.modal = true;
        this.active = true; // modal from here: the world holds still
        eng.paused = true;
      }
    } else if (inp.wasPressed('Escape')) return this.abortArrival();
    else if (A.t > 0.9 && (inp.wasPressed('Mouse0') || inp.wasPressed('Space') || inp.wasPressed('KeyT') || inp.wasPressed('Enter'))) return this.openFromArrival();
    // ---- the camera: riding rig -> up past the sign -> down to her
    const T = 2.7;
    const u = smoother(A.t / T) * 2;
    catmull(A.P, u, this.shot.pos);
    catmull(A.L, u, this.shot.look);
    const i = Math.min(1, Math.floor(u)), f = u - i;
    this.shot.fov = mix(A.F[i], A.F[i + 1], f);
    const gy = ctx.world.groundAt(this.shot.pos.x, this.shot.pos.z) + 0.4;
    if (this.shot.pos.y < gy) this.shot.pos.y = gy;
    if (A.t > T) {
      // a slow push-in while she peeks and talks
      const k = Math.min(1, (A.t - T) / 4);
      this.shot.pos.lerp(this.shot.look, 0.1 * k);
    }
    this.handheld(Math.min(1, A.t / 1.5));
    // ---- her: in the shell until the camera finds her, then eyes first, then out
    if (!A.coaxed && A.t > 2.45) {
      A.coaxed = true;
      her.coax(0.85);
    }
    her.lookAt = this.hunter ? _w.copy(this.hunter).add(_a.set(0, 1.4, 0)) : null;
    her.near = false;
    her.update(h);
    if (A.coaxed && A.outAt < 0 && her.mode === 'out') {
      A.outAt = A.t;
      this.greeted = true;
      this.speak(rnd.pick(LINES.arrive), 'laugh');
      her.wave(1.7);
      ctx.sfx('merchant_greet', her.root.position, 1);
    }
    this.updateSpeech(h);
    this.warmUp(h, 1);
    if (A.outAt >= 0 && A.t > A.outAt + 1.8) this.openFromArrival();
  }

  /** the scene hands over to the shop (the wares tumble out, the camera arcs to the shop view) */
  private openFromArrival() {
    const A = this.arrival;
    if (!A) return;
    this.arrival = null;
    const wares = A.hooks.stock?.() ?? [];
    void this.open(A.her.root.position.clone(), 0, wares, A.her.root.position, { her: A.her });
  }

  /** called off (outlaws, ESC): hand the camera and the reins straight back */
  private abortArrival() {
    const A = this.arrival;
    if (!A) return;
    this.arrival = null;
    const eng = this.ctx.engine;
    A.her.coax(0.5);
    A.her.lookAt = null;
    this.cam.setCine(null);
    eng.letterbox(false, 0.4);
    eng.input.enabled = this.inputWas;
    if (this.active) {
      this.active = false;
      eng.paused = false;
    }
    this.restoreGrade();
    this.holdLight(0);
    this.clearSpeech();
    this.her = null;
    this.phase = 'off';
  }

  /** where the riding rig would put the camera right now (the leaving dolly lands here) */
  private ridingPose(out: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }) {
    const c = this.cam, T = this.hunter ?? this.pivot;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -Math.cos(c.yaw), rz = Math.sin(c.yaw);
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const hx = T.x + rx * c.shoulder, hy = T.y + c.height, hz = T.z + rz * c.shoulder;
    out.pos.set(hx - fx * cp * c.dist, hy - sp * c.dist, hz - fz * cp * c.dist);
    out.pos.y = Math.max(out.pos.y, this.ctx.world.groundAt(out.pos.x, out.pos.z) + 0.45);
    out.look.set(hx + fx * cp * 30, hy + sp * 30 + 0.2, hz + fz * cp * 30);
    out.fov = 72;
    return out;
  }

  private handheld(amt: number) {
    const t = this.t, hh = 0.3 + 0.7 * amt;
    this.shot.pos.x += noise.n2(t * 0.35, 1.3) * 0.016 * hh;
    this.shot.pos.y += noise.n2(t * 0.3, 7.7) * 0.011 * hh;
    this.shot.pos.z += noise.n2(t * 0.33, 4.1) * 0.016 * hh;
    this.shot.look.x += noise.n2(t * 0.27, 9.2) * 0.012 * hh;
    this.shot.look.y += noise.n2(t * 0.25, 2.9) * 0.009 * hh;
    this.shot.look.z += noise.n2(t * 0.29, 6.6) * 0.012 * hh;
    this.shot.roll = noise.n2(t * 0.21, 5.5) * 0.007 * hh;
  }

  /** warm grade + the warm fill light, eased toward k */
  private warmUp(h: number, k: number) {
    this.warm = damp(this.warm, k, 3, h);
    this.applyGrade(this.warm);
    this.holdLight(this.warm);
  }

  // ---------------------------------------------------------------- her floating lines
  /** she says something: one line of Alagard floating beside her head, typed out */
  private speak(text: string, mood: 'neutral' | 'laugh' | 'squinty' = 'neutral') {
    const her = this.her;
    if (!her) {
      this.ctx.toast(TITLE, '#ffd36b', text);
      return;
    }
    if (this.speech) {
      this.speech.show(false);
      this.fading.push(this.speech);
    }
    const cam = this.ctx.camera;
    const dist = her.headPos(_v).distanceTo(cam.position);
    const ft = new FloatText3D(text, { size: clamp(dist * 0.034, 0.07, 0.17), px: 48, cps: 40, wrap: 28, hdr: 1.3 });
    ft.anchor.copy(_v);
    this.ctx.scene.add(ft.mesh);
    this.speech = ft;
    this.speechT = 1.7 + text.length / 40;
    her.say(mood, text.length / 40 + 0.3);
  }

  private updateSpeech(h: number) {
    const her = this.her, cam = this.ctx.camera;
    const pl = this.pendingLine;
    if (pl && her && her.mode === 'out' && this.pt >= pl.at) {
      this.pendingLine = null;
      this.speak(pl.text, pl.mood);
    }
    if (this.speech) {
      this.speechT -= h;
      if (this.speechT <= 0 || !her) {
        this.speech.show(false);
        this.fading.push(this.speech);
        this.speech = null;
      } else {
        // beside her head, on the open side of the frame
        const head = her.headPos(_v);
        const nx = _b.copy(head).project(cam).x;
        if (nx > 0.3) this.speechSide = -1;
        else if (nx < -0.1) this.speechSide = 1;
        const right = _a.set(1, 0, 0).applyQuaternion(cam.quaternion);
        this.speech.anchor.copy(head).addScaledVector(right, this.speechSide * (0.24 + this.speech.mesh.scale.x * 0.5));
        this.speech.anchor.y += 0.16;
        this.speech.update(h, cam, () => this.ctx.engine.audio.play('ui_hover', { volume: 0.05, pitch: 0.65 + Math.random() * 0.35 }));
      }
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i];
      f.update(h, cam);
      if (f.visibleAmount < 0.02) {
        f.dispose();
        this.fading.splice(i, 1);
      }
    }
  }

  private clearSpeech() {
    this.speech?.dispose();
    this.speech = null;
    for (const f of this.fading) f.dispose();
    this.fading = [];
    this.pendingLine = null;
    this.speechT = 0;
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
      if (!p.root.parent || this.owns(p)) continue;
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
      if (!p.root.parent || this.owns(p)) continue;
      const c = p.center(_v);
      const reach = r < 0 ? -r : r + 7;
      if (c.distanceTo(_a.set(pos.x, pos.y, pos.z)) < reach) p.threat(1.5);
    }
  }

  // ---------------------------------------------------------------- the shop
  /** open at a rug position in front of the merchant; resolves when the player leaves */
  open(rugAt: THREE.Vector3, facing: number, wares: Ware[], merchantPos: THREE.Vector3, _opts?: unknown): Promise<void> {
    const viaArrival = !!_opts && typeof _opts === 'object' && (_opts as { her?: Tamsin }).her instanceof Tamsin ? (_opts as { her: Tamsin }).her : null;
    return this.begin(rugAt, facing, wares, merchantPos, viaArrival);
  }

  private begin(rugAt: THREE.Vector3, facing: number, wares: Ware[], merchantPos: THREE.Vector3, arrivedHer: Tamsin | null): Promise<void> {
    const ctx = this.ctx;
    const eng = ctx.engine;
    if (this.arrival) this.abortArrival();
    if (this.active && !arrivedHer) this.finish();
    this.active = true;
    eng.paused = true;
    eng.input.setWantLock(false);
    if (arrivedHer) eng.input.enabled = this.inputWas; // the arrival scene borrowed the reins
    else {
      // walked up and pressed T: she greets you once she is out of her shell
      ctx.sfx('merchant_greet', merchantPos, 1);
      this.greeted = false;
      this.t = 0;
    }
    this.pt = 0;
    if (!arrivedHer) this.clearSpeech(); // (her arrival greeting is allowed to finish)
    this.commented.clear();
    this.leaveSplit = false;
    this.coinsAt = -1;
    this.punch = 0;
    this.camK = 0;
    this.focusK = 0;
    this.heaved = false;
    this.scolded = false;
    this.hovered = null;
    this.shotCd = 0;
    this.her = arrivedHer ?? this.findHer(rugAt, merchantPos);
    const her = this.her;
    this.herHeight = (her?.rig?.geo.spec.meta?.height as number | undefined) ?? 1.53;
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
          this.rugSpot = spotMaterial();
          const m = new THREE.Mesh(geo, this.rugSpot.m);
          m.receiveShadow = true;
          m.onBeforeRender = (_r, _s, camera) => this.lightRug(camera);
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
      const spot = spotMaterial();
      const { obj, he } = itemObject(w.model, spot.m);
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
        lit: 0, spot, gaze: 0,
      };
    });
    // each ware's light from above (written just before it draws)
    for (const b of this.bodies) {
      const mesh = b.obj.children[0] as THREE.Mesh | undefined;
      if (mesh)
        mesh.onBeforeRender = (_r, _s, camera) => {
          const d = _l.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
          b.spot.u.uTop.value.set(d.x, d.y, d.z, b.lit * 0.34);
        };
    }
    // ---- camera: arc off the riding rig into the three-quarter shot
    const cam = this.cam.camera;
    if (arrivedHer) {
      // straight on from the arrival close-up
      this.camFrom.pos.copy(this.shot.pos);
      this.camFrom.look.copy(this.shot.look);
      this.camFrom.fov = this.shot.fov;
    } else {
      this.camFrom.pos.copy(cam.position);
      cam.getWorldDirection(_v);
      this.camFrom.look.copy(cam.position).addScaledVector(_v, 6);
      this.camFrom.fov = cam.fov;
    }
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
    if (!this.greeted) {
      this.greeted = true;
      this.pendingLine = { text: rnd.pick(LINES.hello), mood: 'laugh', at: (her ? her.outIn() : 0) + 0.15 };
    }
    return new Promise((res) => (this.done = res));
  }

  /** her puppet nearest the rug (or, with no hook installed, her rig found in the scene) */
  private findHer(rugAt: THREE.Vector3, merchantPos: THREE.Vector3): Tamsin | null {
    this.borrowed = false;
    let best: Tamsin | null = null, bd = 10;
    for (const p of this.puppets.values()) {
      if (!p.root.parent) continue;
      // nearest to this rug wins (the caller's merchantPos may belong to another post)
      const d = p.root.position.distanceTo(rugAt) - (p.root.position === merchantPos ? 0.5 : 0);
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

  /**
   * The low, warm three-quarter shot of her behind the rug: about 30° off her
   * nose, four metres out, a metre up. Tries both sides, then closer and a little higher, and
   * keeps the first spot with a clear view of her head and the rug (no post,
   * wall or hunter in the lens).
   */
  private planShot() {
    const H = this.pivot, a = this.fwdAng;
    const F = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const L = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const spot = (s: number, k: number, lift: number) => {
      const p = H.clone().addScaledVector(F, 1.05 + 2.4 * k).addScaledVector(L, 2.0 * k * s);
      p.y = Math.max(this.ctx.world.groundAt(p.x, p.z), H.y) + lift;
      return p;
    };
    let pref = 1;
    if (this.hunter) pref = spot(1, 1, 1).distanceToSquared(this.hunter) >= spot(-1, 1, 1).distanceToSquared(this.hunter) ? 1 : -1;
    const head = H.clone();
    head.y += 1.2;
    const rug = this.group.position.clone();
    rug.y += 0.2;
    let pos: THREE.Vector3 | null = null, side = pref;
    search: for (const kk of [1, 0.8, 0.62])
      for (const s of [pref, -pref])
        for (const lift of [1.0, 1.35]) {
          const p = spot(s, kk, lift);
          if (this.clearView(p, head) && this.clearView(p, rug)) {
            pos = p;
            side = s;
            break search;
          }
        }
    if (!pos) pos = spot(pref, 0.62, 1.7); // crowded: look down over whatever is in the way
    this.camMain.pos.copy(pos);
    this.camMain.look.copy(H).addScaledVector(F, 0.47).addScaledVector(L, 0.1 * side);
    this.camMain.look.y = H.y + 0.66;
    // fit her (hat to toes) and the rug inside the letterboxed frame
    // (where the wares land: across the rug, a little toward the customer)
    const g = this.group, wx = Math.min(this.rugHalf.x, 1.05);
    const subject = [
      H.clone().add(_a.set(0, this.herHeight + 0.06, 0)),
      H.clone().addScaledVector(F, 0.3),
      g.localToWorld(new THREE.Vector3(-wx, this.rugTop, 0.3)),
      g.localToWorld(new THREE.Vector3(wx, this.rugTop, 0.3)),
      g.localToWorld(new THREE.Vector3(-wx, this.rugTop, -0.62)),
      g.localToWorld(new THREE.Vector3(wx, this.rugTop, -0.62)),
    ];
    this.camMain.fov = this.fitShot(pos, subject, this.camMain.look);
    this.focus.copy(this.camMain.look);
  }

  /**
   * Re-aim `look` (in place) at the middle of the subject points as seen from
   * `pos`, and return the vertical fov (deg) that holds them all inside the
   * letterbox band with a little air.
   */
  private fitShot(pos: THREE.Vector3, pts: THREE.Vector3[], look: THREE.Vector3) {
    const aspect = this.ctx.engine.width / Math.max(1, this.ctx.engine.height);
    const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), d = new THREE.Vector3();
    let hx = 0, hy = 0;
    for (let pass = 0; pass < 4; pass++) {
      fwd.subVectors(look, pos).normalize();
      right.crossVectors(fwd, UP).normalize();
      up.crossVectors(right, fwd);
      let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
      for (const p of pts) {
        d.subVectors(p, pos);
        const z = Math.max(0.25, d.dot(fwd));
        const ty = d.dot(up) / z, tx = d.dot(right) / z;
        y0 = Math.min(y0, ty);
        y1 = Math.max(y1, ty);
        x0 = Math.min(x0, tx);
        x1 = Math.max(x1, tx);
      }
      hx = (x1 - x0) / 2;
      hy = (y1 - y0) / 2;
      const dist = look.distanceTo(pos);
      look.copy(pos).addScaledVector(fwd, dist).addScaledVector(up, ((y0 + y1) / 2) * dist).addScaledVector(right, ((x0 + x1) / 2) * dist);
    }
    // the letterbox leaves the middle 78% of the height
    const t = Math.max(hy / 0.78, hx / aspect) * 1.1;
    return clamp((2 * Math.atan(t) * 180) / Math.PI, 36, 58);
  }

  /** no prop, wall, dune or hunter between the lens and a point */
  private clearView(from: THREE.Vector3, to: THREE.Vector3) {
    const d = _a.copy(to).sub(from);
    const len = d.length();
    if (len < 0.1) return true;
    d.multiplyScalar(1 / len);
    const hit = { t: -1, c: null as unknown as null, nx: 0, nz: 0 };
    this.ctx.world.colliders.raycast(from.x, from.y, from.z, d.x, d.y, d.z, Math.max(0.1, len - 0.3), hit);
    if (hit.t >= 0) return false;
    const g = this.ctx.world.field.raycast(from.x, from.y, from.z, d.x, d.y, d.z, len - 0.2);
    if (g >= 0) return false;
    if (this.hunter) {
      // the hunter's body (a capsule from his boots to his hat)
      const c = _b.copy(this.hunter);
      c.y += 0.9;
      const t = clamp(_c.copy(c).sub(from).dot(d), 0, len);
      if (_c.copy(from).addScaledVector(d, t).distanceTo(c) < 0.6) return false;
    }
    return true;
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
    if (this.arrival) this.abortArrival();
    if (this.active) this.finish();
    for (const u of this.unsub) u();
    this.unsub = [];
    this.tip.remove();
    this.bar.remove();
    this.rugSpot?.m.dispose();
  }

  /** start leaving: a farewell beat (she waves her cane), wares back in her pack, then the dolly back to the saddle */
  close() {
    if (!this.active || this.phase === 'leave') return;
    this.phase = 'leave';
    this.pt = 0;
    this.leaveSplit = false;
    this.hovered = null;
    this.tip.style.display = 'none';
    this.bar.style.display = 'none';
    this.pendingLine = null;
    this.ridingPose(this.camHome);
    if (this.her && !this.her.hidden) {
      this.speak(rnd.pick(LINES.bye), 'laugh');
      this.her.wave(2.0);
    } else this.ctx.toast(TITLE, '#ffd36b', rnd.pick(LINES.bye));
    let i = 0;
    for (const b of this.bodies) {
      if (b.state === 'wait') {
        b.state = 'gone';
        continue;
      }
      if (b.state !== 'free' && b.state !== 'held') continue;
      b.state = 'pack';
      b.t = -(0.3 + 0.06 * i++); // once she has started waving
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
      b.spot.m.dispose();
    }
    this.bodies = [];
    if (this.rug) this.group.remove(this.rug);
    this.tip.style.display = 'none';
    this.bar.style.display = 'none';
    this.cam.setCine(null);
    eng.letterbox(false, 0.4);
    this.restoreGrade();
    this.holdLight(0);
    this.clearSpeech();
    if (this.her) {
      if (this.borrowed) this.her.restPose();
      this.her.lookAt = null;
      // the arrival scene only comes back once he has ridden off and stayed away
      this.her.armed = false;
      this.her.awayT = 0;
    }
    this.her = null;
    this.borrowed = false;
    this.hovered = null;
    this.warm = 0;
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
      this.speak(rnd.pick(LINES.poor), 'squinty');
      this.kick(b, _v.set(0, 1.6, 0), null);
      this.her?.shake();
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
    ctx.toast(b.ware.name.toUpperCase(), '#9dff3a', `-${b.ware.price} gold · into your satchel`);
    b.state = 'sold';
    b.t = 0;
    b.arc0.copy(b.p);
    b.asleep = false;
    if (this.hovered === b) this.hovered = null;
    const wp = this.group.localToWorld(_v.copy(b.p));
    ctx.sfx('whoosh', wp, 0.35, 1.3);
    // the flourish: a warm flash on the rug, the lens leans in, his coins arc into her claws
    ctx.fx.light(wp, 0xffd27a, 1.8, 0.35, 4);
    ctx.fx.sparkle({ x: wp.x, y: wp.y + 0.1, z: wp.z }, P.gold0, 8, 0.15);
    this.punch = 1;
    const her = this.her;
    if (her && this.hunter) {
      const from = this.satchel(new THREE.Vector3());
      const to = her.center(new THREE.Vector3()).add(_a.set(Math.sin(this.fwdAng) * 0.38, 0.2, Math.cos(this.fwdAng) * 0.38));
      const T = 0.6, g = 14;
      const vel = to.clone().sub(from).multiplyScalar(1 / T);
      vel.y += 0.5 * g * T;
      ctx.particles.emit({ pos: from, count: Math.min(14, 4 + Math.round(b.ware.price / 12)), vel, spread: 0.45, life: [T, T + 0.06], size: [0.11, 0.11], sprite: ['coinspin0', 'coinspin1', 'coinspin2', 'coinspin3'], color: 0xffffff, gravity: g, sizeJitter: 0.1 });
      this.coinsAt = T;
      this.coinsTo.copy(to);
    }
    this.speak(rnd.pick(LINES.thanks), 'laugh');
    her?.nod();
    this.updateBar();
  }
  private coinsAt = -1;
  private coinsTo = new THREE.Vector3();

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
    if (!this.active && !this.arrival) return;
    const h = Math.min(rdt, 0.05);
    const ctx = this.ctx;
    this.t += h;
    this.pt += h;
    // the world is paused: keep the dust and flashes alive for the scene
    // (only once we were already modal, so nothing ticks twice)
    if (this.active) {
      ctx.fx.update(h);
      ctx.particles.update(h, ctx.world.env.fog);
    }
    if (this.arrival) return this.updateArrival(h);
    const inp = this.input;
    if (this.phase !== 'leave' && (inp.wasPressed('Escape') || inp.wasPressed('KeyT'))) this.close();
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
    // ---- spotlights, dust in the beams, her commentary
    const hb = this.hovered;
    for (const b of this.bodies) {
      const up = b.state === 'held' || (b.state === 'free' && b.landed);
      b.lit = damp(b.lit, up ? (b === hb ? 1 : 0.55) : 0, 3.5, h);
      b.gaze = b === hb && b.state === 'held' ? b.gaze + h : 0;
      if (b.lit > 0.3 && rnd.chance(h * (1.2 + b.lit * 1.6))) {
        const c = this.group.localToWorld(_v.set(b.rest.x + (rnd.next() - 0.5) * 0.24, this.rugTop + 0.06 + rnd.next() * 0.45, b.rest.z + (rnd.next() - 0.5) * 0.24));
        ctx.particles.emit({ pos: { x: c.x, y: c.y, z: c.z }, count: 1, vel: { x: 0, y: 0.05, z: 0 }, spread: 0.04, life: [1.4, 2.4], size: [0.026, 0.012], sprite: 'glow8', additive: true, color: 0xffe2a8, alpha: 0.5, drag: 0.6, fadeIn: 0.3 });
      }
    }
    if (hb && hb.gaze > 0.35 && !this.commented.has(hb) && this.speechT < 0.8 && !this.pendingLine && her && her.mode === 'out') {
      this.commented.add(hb);
      const pool = COMMENT[hb.ware.id] ?? COMMENT._;
      let i = Math.floor(rnd.next() * pool.length);
      if (i === this.lastComment.get(hb.ware.id)) i = (i + 1) % pool.length;
      this.lastComment.set(hb.ware.id, i);
      this.speak(pool[i]);
    }
    // the coins land in her claws
    if (this.coinsAt >= 0) {
      this.coinsAt -= h;
      if (this.coinsAt < 0) {
        ctx.sfx('pickup_gold', this.coinsTo, 0.6, 1.15);
        ctx.fx.sparkle({ x: this.coinsTo.x, y: this.coinsTo.y, z: this.coinsTo.z }, P.gold0, 6, 0.18);
        her?.nod();
      }
    }
    // ---- Tamsin
    if (her) {
      her.near = false;
      her.lookAt = hb ? this.group.localToWorld(_w.copy(hb.p)) : _w.copy(this.ctx.camera.position);
      her.update(h);
    }
    this.updateSpeech(h);
    // ---- camera, light, grade
    this.camK = Math.min(1, this.camK + h / 1.6);
    this.punch = Math.max(0, this.punch - h * 3);
    this.updateCamera(h);
    this.warmUp(h, this.phase === 'leave' && this.leaveSplit ? 0 : 1);
    if (this.phase === 'leave' && this.pt > 2.0 && (this.bodies.every((b) => b.state === 'gone') || this.pt > 2.6)) this.finish();
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
    // ease in on the hovered ware, but keep her in the shot behind it
    const P1 = _a.copy(this.camMain.pos).lerp(this.focus, 0.22 * f);
    const L1 = _b.copy(this.camMain.look).lerp(this.focus, 0.42 * f);
    let fov1 = this.camMain.fov - 6 * f;
    if (this.phase === 'leave' && this.her) {
      // farewell: lean in on her while she waves her cane...
      const k = smoother(this.pt / 0.7);
      const head = this.her.headPos(_c);
      P1.lerp(head, 0.18 * k);
      L1.lerp(head, 0.45 * k);
      fov1 -= 5 * k;
      if (this.pt > 0.9) {
        // ...then the dolly back to the saddle
        if (!this.leaveSplit) {
          this.leaveSplit = true;
          this.leaveFrom.pos.copy(this.shot.pos);
          this.leaveFrom.look.copy(this.shot.look);
          this.leaveFrom.fov = this.shot.fov;
          this.ctx.engine.letterbox(false, 0.7);
        }
        const kb = smoother((this.pt - 0.9) / 1.1);
        this.orbit(this.leaveFrom.pos, this.camHome.pos, kb, this.shot.pos);
        this.shot.look.copy(this.leaveFrom.look).lerp(this.camHome.look, smoother(kb * 1.2));
        this.shot.fov = mix(this.leaveFrom.fov, this.camHome.fov, kb);
        this.handheld(1 - kb);
        return;
      }
    }
    const e = smoother(this.camK);
    this.orbit(this.camFrom.pos, P1, e, this.shot.pos);
    const el = smoother(this.camK * 1.25);
    this.shot.look.copy(this.camFrom.look).lerp(L1, el);
    this.shot.fov = mix(this.camFrom.fov, fov1, e) - 2.5 * this.punch * this.punch;
    this.handheld(e);
  }

  /** the rug's light pools, in view space, just before it draws */
  private lightRug(camera: THREE.Camera) {
    const S = this.rugSpot?.u.uSpots.value;
    if (!S) return;
    let i = 0;
    for (const b of this.bodies) {
      if (i >= SPOT_N) break;
      const s = S[i++];
      if (b.lit < 0.01) {
        s.w = 0;
        continue;
      }
      const x = b.state === 'held' ? b.rest.x : b.p.x, z = b.state === 'held' ? b.rest.z : b.p.z;
      this.group.localToWorld(_l.set(x, this.rugTop, z)).applyMatrix4(camera.matrixWorldInverse);
      s.set(_l.x, _l.y, _l.z, b.lit * 0.45);
    }
    for (; i < SPOT_N; i++) S[i].w = 0;
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
    b.w.set(rnd.range(-5, 5), rnd.range(-3, 3), rnd.range(-5, 5));
    b.asleep = false;
    this.ctx.sfx('whoosh', this.group.localToWorld(_w.copy(b.p)), 0.12, 1.7);
  }

  /** inverse world inertia applied to x (mass 1, box inertia) */
  private invI(b: Body, x: THREE.Vector3, out: THREE.Vector3) {
    _q2.copy(b.q).invert();
    return out.copy(x).applyQuaternion(_q2).multiply(b.invI).applyQuaternion(b.q);
  }

  private floorAt(x: number, z: number) {
    if (Math.abs(x) <= this.rugHalf.x && Math.abs(z) <= this.rugHalf.y) return this.rugTop;
    // off the rug: the real sand, measured from the rug's plane
    const w = this.group.localToWorld(_f.set(x, 0, z));
    return clamp(this.ctx.world.groundAt(w.x, w.z) - w.y, -0.3, 0.4);
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
        if (sold && rnd.chance(0.8)) {
          // a glittering wake behind the sold ware
          const tp = this.group.localToWorld(_l.copy(b.p));
          this.ctx.particles.emit({ pos: { x: tp.x, y: tp.y, z: tp.z }, count: 1, spread: 0.25, life: [0.25, 0.5], size: [0.09, 0.01], sprite: ['star4', 'spark'], additive: true, color: [P.gold0, 0xfff2c0] });
        }
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
    const r = _a.set(0, 0, 0), vc = _b, rn = _c, t1 = _v, t2 = _w;
    // one contact at the mean of the corners under the floor: a face rests
    // without spurious torque, an edge or a corner still tips and tumbles
    for (const c of CORNERS) {
      t1.set(c[0] * b.he.x, c[1] * b.he.y, c[2] * b.he.z).applyQuaternion(b.q);
      const d = floor - (b.p.y + t1.y);
      if (d <= -SLOP) continue; // corners a hair above the floor still share the load
      contacts++;
      pen = Math.max(pen, d);
      r.add(t1);
    }
    if (contacts) {
      r.multiplyScalar(1 / contacts);
      vc.crossVectors(b.w, r).add(b.v);
      if (vc.y < 0) {
        impact = -vc.y;
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
      b.p.y += pen * 0.8;
      // rolling resistance; a ware lying on a face settles quickly instead of rocking
      const flat = contacts >= 3;
      b.v.x *= 1 - Math.min(1, (flat ? 4 : 1.6) * h);
      b.v.z *= 1 - Math.min(1, (flat ? 4 : 1.6) * h);
      b.w.multiplyScalar(1 - Math.min(1, (flat ? 9 : 3.5) * h));
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
      if (flat && b.v.lengthSq() < 0.01 && b.w.lengthSq() < 0.3) {
        b.still += h;
        if (b.still > 0.25) {
          b.asleep = true;
          b.v.set(0, 0, 0);
          b.w.set(0, 0, 0);
          b.rest.copy(b.p);
        }
      } else b.still = 0;
    } else b.still = 0;
    // a soft lip around the rug keeps knocked wares within reach (only once
    // they are down: her pack is outside it and they fly in over the lip)
    if (b.landed && b.p.y < this.rugTop + 0.5) {
      const lx = this.rugHalf.x + 0.12, lz = this.rugHalf.y + 0.1;
      if (Math.abs(b.p.x) > lx) {
        b.p.x = Math.sign(b.p.x) * lx;
        b.v.x *= -0.3;
      }
      if (Math.abs(b.p.z) > lz) {
        b.p.z = Math.sign(b.p.z) * lz;
        b.v.z *= -0.3;
      }
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
          this.speak(rnd.pick(LINES.shot), 'squinty');
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
