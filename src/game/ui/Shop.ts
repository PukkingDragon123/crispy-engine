// The trading post shop. Its keeper is Ozymandias, an old tortoise who lives
// in a little shop-house on the back of Gobi, a giant walking turtle with an
// acacia growing from his shell (models/creatures/turtleHouse.ts). Gobi plods
// round his camp; when outlaws come near, or there is shooting or a blast
// close by, he pulls in, drops onto his plastron and digs down into the sand
// until only the shell top, the house and the tree show, the shutters banging
// shut; once it is quiet his eyes come up first and he heaves himself out.
//
// Ride slowly into his radius (or head straight for him, or press T at his
// gangplank) and a cutscene takes over: letterbox, the board brakes in a spray
// of sand, Gobi turns his porch to you while the camera cranes past the
// TRADING POST sign and down to Ozymandias, who ducked at the racket, peeks
// out and greets you in floating Alagard text. Then you talk: a few answers
// float beside him as 3D plaques (click or 1-5). "Show me your wares" lowers
// the gangplank; Ozymandias goes in ahead, and the camera follows the hunter
// (a walking copy of his rig, his board parked at the foot) up the plank and
// in at the door. Inside, from the doorway: he stands behind his counter with
// the window at his back, the wares tumble out of his basket onto a rug as
// real rigid bodies (box contacts, bounce, friction, sleep), each in its own
// soft pool of light; hovering lifts and spins a ware while the camera eases
// in and he comments; a click buys it (coins arc into his claws, the ware into
// the hunter's satchel); right-click fires a shot that knocks the wares about
// and sends him into his shell. Leaving: a farewell, the wares back in the
// basket, the hunter walks out and down to his board while Ozymandias follows
// to wave from the porch, and the camera settles back into the saddle. It
// re-arms once you have ridden off and stayed away a few seconds; never with
// enemies within 15 m or during a boss fight. The world is paused throughout.
//
// Inside, the wares are set out on his display stall (ui/ShopShelf.ts): they fly
// out of his basket and land on its two steps, each over a manila price tag
// inked with the price and what it does. Hovering (or pressing its number)
// lifts a ware and floats a card beside it in Alagard: what it is, what it
// does, what it means for you right now (your pockets, your health, the gear it
// would replace), the price. Buying counts the coins across into his claws one
// by one, hands the ware over, flips its tag to SOLD and gets a word from him.
// The stock holds for a restock period (fresh after every boss wave, StockBook):
// one ware is the day's deal, and once a period you can try to haggle on the
// porch. Out in the world, run/ShopBeacon.ts makes him easy to find (smoke
// column, lanterns, music and bell on the wind, footprint trails, a toast).
//
// Old Mother Tamsin (models/characters/tortoise.ts, frozen) is still the
// puppet here too: Ozymandias is her rig re-dressed, and she keeps her own
// rug shop (the shot from the rug, the dolly back) wherever she stands alone.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Input } from '../../engine/Input';
import { touchText } from './TouchControls';
import type { CameraRig, CineShot } from '../player/CameraRig';
import { RigInstance } from '../../engine/voxel/Rig';
import type { Collider } from '../world/Colliders';
import * as PM from '../models/props';
import { modelEntry } from '../models/lookup';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { P } from '../../engine/voxel/palette';
import { ITEMS, ItemId } from '../player/Items';
import { clamp, damp, noise, rnd } from '../../engine/math/rand';
import { Ease } from '../../engine/Tween';
import { FloatText3D } from '../fx/FloatText3D';
import { Voice } from '../audio/Voice';
import { ShopBeacon, type BeaconInfo } from '../run/ShopBeacon';
import { stallModel, stallTopAt, PriceTag, type Stall } from './ShopShelf';
import { GEAR, SLOT_INFO, type GearId } from '../player/Equipment';
import { RARITY } from '../run/Upgrades';
import { GobiAnim } from '../models/creatures/turtleHouse';

/** what the run hands her each frame so she can stage her own arrival scene */
export interface MerchantHooks {
  /** the hunter's board (braked to a stop when the arrival scene starts; parked at the gangplank for a visit) */
  board?: { vel: THREE.Vector3; pos?: THREE.Vector3; place?(x: number, y: number, z: number, heading: number): void };
  /** her wares, the same stock the T-key path uses; without it there is no arrival scene */
  stock?: () => Ware[];
  /** something else owns the screen (a mission cinematic, a notice, the hunter is dead) */
  busy?: () => boolean;
  /** the turtle house: Ozymandias's rig (he keeps the porch), and the camp Gobi walks round */
  rider?: RigInstance | null;
  home?: THREE.Vector3;
  /**
   * the hunter, for a visit inside the house: his rig (hidden while a copy of
   * it walks up the gangplank and in at the door), his revolver (holstered on
   * the walker) and the root his board pose is written to
   */
  hunter?: { rig: RigInstance; gun?: RigInstance | null; root?: THREE.Object3D };
}

const ARRIVE_R = 13; // ride inside this to be greeted
const REARM_R = 17; // ...and out past this (for REARM_T seconds) before it can happen again
const REARM_T = 4;
const CALM_R = 15; // no scene with an enemy this close to the hunter
const ARRIVE_R_T = 16; // the turtle house is big: greeted a little further out
const DIG_R = 18; // outlaws this close to the turtle and he digs in

export interface Ware {
  id: string;
  name: string;
  desc: string;
  price: number;
  model: string;
  buy(): boolean; // false = couldn't (e.g. inventory full)
  /** two or three words for the price tag: what it does */
  short?: string;
  /** what it means for you right now (your pockets, your health, the gear it would replace) */
  note?: () => WareNote | null;
}
export interface WareNote {
  text: string;
  /** an improvement for you (green) */
  good?: boolean;
  /** a snag (red): pockets full, worse than what you have */
  bad?: boolean;
}

/**
 * The shop's stock for a restock period: a fresh shelf after every boss wave
 * (periods turn at waves 5, 10, 15 ...), what has sold off it, the day's deal
 * (30% off one ware) and the porch haggle (once a period: 15% off everything,
 * or a firm no). Missions asks for wares through `stock`, so the shelf you come
 * back to is the one you left.
 */
export class StockBook {
  period = -1;
  wares: Ware[] = [];
  sold = new Set<string>();
  deal: string | null = null;
  haggle: 'none' | 'won' | 'lost' = 'none';
  /** visits this period (the first gets "fresh stock") */
  visits = 0;
  constructor(private ctx: Ctx) {}
  static periodOf(wave: number) {
    return Math.floor(Math.max(0, wave) / 5);
  }
  /** the wave whose boss brings the next fresh stock */
  get nextRestock() {
    return (this.period + 1) * 5;
  }
  /** the shelf for now: built by `make` when the period has turned, else the same one */
  stock(make: () => Ware[]): Ware[] {
    const p = StockBook.periodOf(this.ctx.run.wave);
    if (p !== this.period || !this.wares.length) {
      this.period = p;
      this.wares = make();
      this.sold.clear();
      this.haggle = 'none';
      this.visits = 0;
      const pool = this.wares.filter((w) => w.id !== 'card');
      this.deal = pool.length ? rnd.pick(pool).id : null;
    }
    return this.wares;
  }
  /** what it costs today */
  price(w: Ware) {
    let k = 1;
    if (w.id === this.deal) k *= 0.7;
    if (this.haggle === 'won') k *= 0.85;
    return Math.max(1, Math.round(w.price * k));
  }
  /** the porch haggle: once a period; a higher bounty rank talks him down more often */
  tryHaggle() {
    if (this.haggle !== 'none') return this.haggle === 'won';
    const won = rnd.chance(0.45 + Math.min(0.3, this.ctx.run.rank * 0.03));
    this.haggle = won ? 'won' : 'lost';
    return won;
  }
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

/** Ozymandias: slow, ancient, a little pompous, kind underneath */
const LINES_C: typeof LINES = {
  hello: ['Welcome to the only shop that walks.', 'Everything I own is in this house. Most of it is for sale.', 'Hrrm. Take your time. I always do.'],
  poor: ['No gold, no goods. Even a tortoise knows that.', 'Come back heavier, little bones.', 'I have patience. Not that much.'],
  thanks: ['Hrrm. A fine choice.', 'Sold. Gobi will walk a little lighter.', 'Mind how you carry it, little bones.'],
  bye: ['Safe roads, little bones.', 'We will be around. Slowly.', 'Off you go. Gobi will catch up in a century.'],
  shot: ['Hrrm! Not indoors!', 'Not at the shop, rider!', 'I have outlived better shots than you.'],
  arrive: ['Hrrm. A rider. Whoa, Gobi. We have a customer.', 'Ahh... a visitor. We have walked nine hundred years for this.', 'Slow down, slow down. The pots rattle.'],
};
/** what you can say to him on his porch (the first goes in, the last rides on; haggling once a restock) */
const TALK: { q: string; a: string[]; go?: 'enter' | 'bye'; haggle?: true }[] = [
  { q: 'Show me your wares.', a: ['Come in, come in. Wipe your bones.', 'Hrrm. Come up. Mind the step, Gobi is ticklish.', 'Inside, then. The kettle is on.'], go: 'enter' },
  { q: 'Can you do better on the price?', a: [], haggle: true },
  { q: 'Who are you?', a: ['Ozymandias, merchant of the walking road. Nine hundred years on this shell.', 'Ozymandias. I sell, Gobi walks. Since the pyramids were pointy.'] },
  { q: 'Why is a tree growing on your turtle?', a: ['Gobi swallowed an acacia seed in the old kingdom. Now it shades us both.', 'It came up through the porch one spring. We let it stay.'] },
  { q: 'Is it safe out here?', a: ['When outlaws come, Gobi digs in and I bar the shutters. Sand is a fine door.', 'Safe as sand. If Gobi starts digging, you start riding.'] },
  { q: 'Just passing through.', a: ['Then pass slowly. Safe roads, little bones.', 'Hrrm. The road will bring you back. It always does.'], go: 'bye' },
];
/** Ozymandias on prices and stock */
const OZ = {
  haggleWin: ['Hrrm. For an honest skull... fifteen off everything. Until the caravan comes.', 'You drive a hard bargain for a man with no stomach. Fifteen off.', 'Gobi likes you. Fine. Fifteen off, and not a copper more.'],
  haggleLose: ['Nine hundred years and I have never haggled. I am not starting today.', 'The price is the price. Gobi has to eat.', 'Hrrm. No. Ask me again after the next caravan.'],
  fresh: ['Fresh off the caravan. Still smells of camel.', 'New stock. Mind the dust on it.', 'The caravan came through. Look, look.'],
  same: ['Same shelf as before. The caravan comes after the next big one.', 'Nothing new yet. The caravan follows the storm.'],
};
/** what he says as he takes your coins for a particular ware */
const SOLD_LINE: Record<string, string[]> = {
  dynamite: ['Light it outside. Outside!', 'Not near the shell, please.'],
  heal: ['Drink it all at once. Do not smell it first.'],
  card: ['The cards know you now. Choose well.'],
  charm: ['Serket will be watching. Behave.'],
  whiskey: ['Not before noon. Hrrm. It is always noon here.'],
  smoke: ['Pop it, and I never saw you.'],
  dagger: ['A little of you for a lot of oomph. Mind the fingers.'],
};
const VOICE_T = { title: TITLE, lines: LINES };
const VOICE_C = { title: 'OZYMANDIAS', lines: LINES_C };

/** what she says about the ware you are looking at (a fresh line each time) */
const COMMENT: Record<string, string[]> = {
  bandage: ['Clean linen. Mostly clean.', 'Wraps a scratch, hides a hole.', 'Rolled by hand on a moving shell.'],
  goldBandage: ['Pharaoh-grade linen.', 'Wrapped a king once. He never complained.', 'Still smells of myrrh. And of king.'],
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
const _tw = new THREE.Vector3();
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
    this.root.localToWorld(out.set(0, 0.75, 0));
    return out;
  }
  /** world-space centre of her head (only meaningful while she is out) */
  headPos(out: THREE.Vector3) {
    const h = this.n.head;
    if (h) return h.localToWorld(out.set(0, 0.13, 0.2));
    this.root.localToWorld(out.set(0, 1.35, 0.2));
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
    const p = this.root.getWorldPosition(_tw); // (she may be riding on someone's back)
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
      if (this.grumbleAt < 0) this.ctx.sfx('camel_grunt', this.root.getWorldPosition(_tw), 0.42, 0.72);
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

  // ---- the merchant surface the shop talks to (shared with the turtle house)
  readonly kind = 'tamsin' as const;
  /** root -> rug centre (m) */
  readonly rugDist = 1.05;
  halt = false;
  faceYaw(_yaw: number | null) {}
  /** the top of what the shop shot must hold (her hat... her headscarf) */
  framingTop(out: THREE.Vector3) {
    return this.root.localToWorld(out.set(0, 1.59, 0));
  }
  /** the top of her pack (rolled rugs and pouches), world space */
  packPoint(out: THREE.Vector3, lateral: number) {
    return this.root.localToWorld(out.set(lateral, 47 * TVS - this.ch.drop * this.dropM, -10 * TVS));
  }
  /** where the hunter's coins land (her claws) */
  coinPoint(out: THREE.Vector3) {
    return this.root.localToWorld(out.set(0, 0.95, 0.4));
  }
  /** the arrival scene: the board skids in and she ducks */
  startle() {
    this.threat(1);
    this.hold = true;
  }
  readyToGreet() {
    return this.mode === 'out';
  }
}

// ================================================================== Gobi and Ozymandias, the walking shop
// Gobi is a colossal, gentle turtle with a shop-house and an acacia on his
// shell. He plods a slow loop round his camp (diagonal-pair gait, the house
// rocking, lanterns, chime and pots swinging on springs, the tree swaying in
// the wind, smoke curling from the stovepipe), stops and turns his porch to a
// customer, and lowers his gangplank for a visit. When outlaws come near, or
// there is shooting or a blast close by, he pulls everything in, drops onto
// his plastron and wiggles down into the sand until only the shell top, the
// house and the tree show, while the shutters bang shut one after another.
// Once it has been quiet a while his eyes come up out of the sand first, then
// he heaves himself out with the sand pouring off his shell. Ozymandias, the
// tortoise who keeps the shop, stands on the porch (his own shy puppet: he
// ducks into his shell at a pointed gun) and walks in and out of the house.
const PEEK_G = 0.66;
const LEGS: [string, number, number][] = [
  // leg, gait phase offset, side (+1 left)
  ['fl', 0, 1],
  ['br', 0, -1],
  ['fr', 0.5, -1],
  ['bl', 0.5, 1],
];
const OZ_SPEED = 1.15;

class Turtle {
  readonly kind = 'turtle' as const;
  readonly root: THREE.Object3D;
  readonly n: Record<string, THREE.Object3D | undefined> = {};
  private rest: Record<string, THREE.Vector3> = {};
  private restRot: Record<string, THREE.Euler> = {};
  private ret: Record<string, THREE.Vector3> = {};
  private dropM = 1.05;
  private digM = 0.85;
  mode: Mode = 'out';
  private mt = 0;
  private calm = 0;
  private calmNeed = 3;
  private peekHold = 1;
  private from: Channels = { neck: 0, limb: 0, tail: 0, drop: 0, tuck: 0 };
  readonly ch: Channels = { neck: 0, limb: 0, tail: 0, drop: 0, tuck: 0 };
  private dig = 0;
  private digFrom = 0;
  private wiggle = 0;
  private thumped = false;
  private sq = 0;
  private sqV = 0;
  private heave = 0;
  private heaveV = 0;
  private hy = 0;
  private hp = 0;
  private jaw = 0;
  private nodT = 0;
  private stompT = 0;
  private blinkT = 3;
  private blinkOn = 0;
  private t = rnd.next() * 10;
  private grumbleCd = 0;
  private grumbleAt = -1;
  private swings: (Swing & { name: string })[] = [];
  private burstT = 0;
  private smokeT = 0;
  // walking his rounds
  private home: THREE.Vector3;
  private wp = new THREE.Vector3();
  private wpA = rnd.next() * Math.PI * 2;
  private pauseT = 2;
  private gait = 0;
  private walk = 0;
  private yawTarget: number | null = null;
  private col: Collider | null = null;
  private colAt = new THREE.Vector3(1e9, 0, 0);
  /** seconds until a halted visit lets him walk on */
  private resumeT = -1;
  // the house: door, shutters, gangplank
  private doorK = 0;
  private doorWant = 0;
  private doorOpen = -1.65;
  private shut: { o: THREE.Object3D; open: number; k: number; want: number; delay: number }[] = [];
  private rampK = 0;
  private rampWant = 0;
  private rampTilt = 0.79;
  private rampStow = new THREE.Vector3(-3.95, -0.26, 0);
  private rampLanded = true;
  private CC = new THREE.Vector3(0, 1.45, -0.2);
  readonly meta: any;
  // Ozymandias on his porch
  readonly rider: Tamsin | null;
  private rPos = new THREE.Vector3();
  private rYaw = Math.PI / 2;
  private rTurn = Math.PI / 2;
  private rPath: THREE.Vector3[] | null = null;
  private rS = 0;
  private rDone: (() => void) | null = null;
  private rPh = 0;
  private rWalk = 0;
  /** a visit is inside the house: gunfire only scares Ozymandias, not the whole turtle */
  indoor = false;
  lookAt: THREE.Vector3 | null = null;
  near = false;
  hold = false;
  halt = false;
  onOut: (() => void) | null = null;
  armed = true;
  awayT = 0;
  dwell = 0;
  readonly lastHunter = new THREE.Vector3(NaN, 0, 0);
  readonly rugDist = 4.2;
  hooks: MerchantHooks | null = null;
  /** the remade Gobi's own joints (second neck segment, toes, tail tips, lure) */
  private gobi!: GobiAnim;

  constructor(private ctx: Ctx, readonly rig: RigInstance, meta: any, home: THREE.Vector3 | null, rider: RigInstance | null) {
    this.root = rig.root;
    this.meta = meta ?? {};
    for (const p of rig.geo.parts) {
      this.n[p.name] = rig.nodes[p.name];
      this.rest[p.name] = p.offset.clone();
      this.restRot[p.name] = p.rest.clone();
    }
    const r = this.meta.retract ?? {};
    for (const k of Object.keys(r)) this.ret[k] = new THREE.Vector3(r[k][0], r[k][1], r[k][2]);
    if (typeof this.meta.shellDrop === 'number') this.dropM = this.meta.shellDrop;
    if (typeof this.meta.dig === 'number') this.digM = this.meta.dig;
    const swing: string[] = Array.isArray(this.meta.swing) ? this.meta.swing : [];
    swing.forEach((name, i) => {
      const o = this.n[name];
      if (!o) return;
      const amp = name.startsWith('lantern') ? 1.5 : name === 'chime' ? 1.9 : name === 'tree' ? 0.08 : name === 'canopy' ? 0.22 : 1;
      this.swings.push({ o, x: 0, z: 0, vx: 0, vz: 0, amp, ph: i * 1.9, head: false, name });
    });
    (this.meta.shutters ?? []).forEach((name: string, i: number) => {
      const o = this.n[name];
      if (o) this.shut.push({ o, open: this.restRot[name]?.y ?? 0, k: 0, want: 0, delay: i * 0.17 });
    });
    if (typeof this.meta.door?.open === 'number') this.doorOpen = this.meta.door.open;
    if (typeof this.meta.ramp?.tilt === 'number') this.rampTilt = this.meta.ramp.tilt;
    const st = this.meta.ramp?.stow;
    if (st) this.rampStow.set(st[0], st[1], st[2]);
    this.home = (home ?? this.root.position).clone();
    this.pickWaypoint();
    this.rider = null;
    if (rider) {
      this.rider = new Tamsin(ctx, rider, rider.root, rider.geo.spec.meta ?? {});
      (this.n.shell ?? this.root).add(rider.root);
      const pp = this.meta.porch ?? [1.98, 3.0, 0.86];
      this.rPos.set(pp[0], pp[1], pp[2]);
    }
    this.poseHouse(0);
    this.gobi = new GobiAnim(rig);
    this.poseRider(0);
    this.stallObj = this.buildStall(rig);
  }

  /** the display stall in the middle of the shop (part of the room: it sinks with the house when he digs in) */
  readonly stallObj: THREE.Object3D | null;
  private buildStall(rig: RigInstance): THREE.Object3D | null {
    const sh = this.n.shell, off = this.rest.shell;
    if (!sh || !off) return null;
    try {
      const st = stallModel();
      const rm = this.meta.room ?? {};
      const fl = this.meta.porch?.[1] ?? 3.0;
      // in front of the counter, a step toward the side wall so his walk in round the counter's end stays clear
      const at: number[] = rm.stall ?? [rm.rug?.[0] ?? -0.25, rm.rug?.[1] ?? fl, (rm.rug?.[2] ?? -0.3) - 0.18];
      const g = new THREE.Group();
      g.name = 'ozy_stall';
      const mesh = new THREE.Mesh(st.geo, rig.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      // shell space = root space less the shell's rest offset (it has no rest rotation)
      g.position.set(at[0] - off.x, at[1] - off.y + 0.003, at[2] - off.z);
      g.rotation.y = -Math.PI / 2; // its front (-z) toward the door
      sh.add(g);
      return g;
    } catch (e) {
      console.warn('[shop] stall', e);
      return null;
    }
  }

  get hidden() {
    return this.mode === 'hiding' || this.mode === 'hidden';
  }
  /** the camp he walks round */
  get homePos() {
    return this.home;
  }
  /** the stovepipe mouth, world space (it sinks with the house when he digs in) */
  chimneyWorld(out: THREE.Vector3) {
    const c = this.toWorld(this.meta.chimney ?? [-1.35, 6.75, -1.15], out);
    c.y -= this.dig * this.digM + this.ch.drop * this.dropM;
    return c;
  }
  /** the porch lanterns' glass, world space */
  lanternWorld(out: THREE.Vector3[]) {
    let i = 0;
    for (const k of ['lantern_a', 'lantern_b']) {
      const o = this.n[k];
      if (!o || i >= out.length) continue;
      o.localToWorld(out[i].set(0, -0.28, 0));
      i++;
    }
    return i === out.length ? out : out.slice(0, i);
  }
  private get yaw() {
    return this.root.rotation.y;
  }
  /** a point in his root space (metres) to world space */
  toWorld(v: ArrayLike<number>, out: THREE.Vector3) {
    return this.root.localToWorld(out.set(v[0], v[1], v[2]));
  }
  center(out: THREE.Vector3) {
    const s = this.n.shell;
    if (s) return s.localToWorld(out.set(0, 1.0, 0));
    out.copy(this.root.position).y += 2.3;
    return out;
  }
  /** between Gobi's eyes */
  beastHead(out: THREE.Vector3) {
    const h = this.n.head;
    if (h) return h.localToWorld(out.set(0, 0.2, 0.55));
    return this.root.localToWorld(out.set(0, 2.2, 5));
  }
  /** Ozymandias's head (the one who talks) */
  headPos(out: THREE.Vector3) {
    return this.rider ? this.rider.headPos(out) : this.beastHead(out);
  }
  framingTop(out: THREE.Vector3) {
    return this.rider ? this.rider.framingTop(out) : this.beastHead(out).add(_a.set(0, 0.6, 0));
  }
  /** the basket on the counter the wares come out of (and go back into) */
  packPoint(out: THREE.Vector3, lateral: number) {
    const pk = this.meta.pack ?? [-0.88, 4.2, -0.35];
    return this.root.localToWorld(out.set(pk[0], pk[1], pk[2] + lateral));
  }
  coinPoint(out: THREE.Vector3) {
    if (this.rider) return this.rider.coinPoint(out);
    return this.packPoint(out, 0);
  }
  faceYaw(yaw: number | null) {
    this.yawTarget = yaw;
  }
  /** the yaw that turns his porch (+X) toward a point */
  porchYawTo(p: THREE.Vector3) {
    return Math.atan2(-(p.z - this.root.position.z), p.x - this.root.position.x);
  }
  readyToGreet() {
    const turned = this.yawTarget === null || Math.abs(wrapPi(this.yawTarget - this.yaw)) < 0.12;
    return this.mode === 'out' && turned && (!this.rider || this.rider.mode === 'out');
  }
  /** the arrival scene: he stops and turns his porch to the rider; Ozymandias ducks */
  startle() {
    this.halt = true;
    this.resumeT = -1;
    if (this.rider) {
      this.rider.threat(1);
      this.rider.hold = true;
    }
  }
  /** a visit is over: he lingers, then walks on */
  resume(after: number) {
    this.resumeT = after;
    this.yawTarget = null;
  }

  threat(level = 1) {
    if (this.indoor) {
      this.rider?.threat(level);
      return;
    }
    this.calm = 0;
    this.calmNeed = 3 + rnd.next() * 1.5;
    this.rider?.threat(level);
    if (this.hidden) {
      if (level >= 1 && this.mode === 'hidden' && this.grumbleCd <= 0) this.grumble(0.05);
      return;
    }
    this.setMode('hiding');
  }
  coax(peekHold = 0.4) {
    this.hold = false;
    this.rider?.coax(peekHold);
    if (!this.hidden) return;
    this.setMode('peek');
    this.peekHold = peekHold;
  }
  outIn() {
    const r = this.rider ? this.rider.outIn() : 0;
    switch (this.mode) {
      case 'out':
        return r;
      case 'emerging':
        return Math.max(r, 2.6 - this.mt);
      case 'peek':
        return Math.max(r, Math.max(0, 0.8 + this.peekHold - this.mt) + 2.6);
      default:
        return Math.max(r, 3 + this.calmNeed);
    }
  }
  say(mood: Mood, dur = 1.2) {
    this.rider?.say(mood, dur);
  }
  nod() {
    this.rider?.nod();
  }
  shake() {
    this.rider?.shake();
  }
  /** Ozymandias waves his cane; Gobi nods and lifts a forefoot */
  wave(d = 1.6) {
    if (!this.indoor) {
      this.nodT = 1.2;
      this.stompT = 1.4;
    }
    this.rider?.wave(d);
  }
  heaveKick() {
    this.rider?.heaveKick();
  }
  /** door, shutters and gangplank: what the house should be doing */
  setDoor(open: boolean) {
    if (open && this.doorWant < 0.5 && this.doorK < 0.5) this.ctx.sfx('door_creak', this.toWorld(this.meta.doorway ?? [1.75, 3, 0.1], _tw), 0.55, 1.1);
    this.doorWant = open ? 1 : 0;
  }
  setRamp(down: boolean) {
    if (down !== this.rampWant > 0.5) this.ctx.sfx('door_creak', this.rampFoot(_tw), 0.5, 0.7);
    this.rampWant = down ? 1 : 0;
    if (down) this.rampLanded = false;
  }
  get rampDown() {
    return this.rampK >= 0.999;
  }
  rampFoot(out: THREE.Vector3) {
    const f = this.meta.ramp?.foot ?? [5.35, 0.08, 0.1];
    return this.toWorld(f, out);
  }
  /** Ozymandias walks his path to the counter (in) or back out to the porch */
  riderWalk(inside: boolean, done?: () => void) {
    const pts: number[][] = (this.meta.ozPath ?? []).slice();
    if (!pts.length || !this.rider) {
      done?.();
      return;
    }
    if (!inside) pts.reverse();
    const y = this.meta.porch?.[1] ?? 3.0;
    this.rPath = [this.rPos.clone(), ...pts.map((p) => new THREE.Vector3(p[0], y, p[1]))];
    this.rS = 0;
    this.rDone = done ?? null;
  }
  /** put him straight at his place (no walk) */
  riderAt(inside: boolean) {
    const p = inside ? this.meta.counter : this.meta.porch;
    if (p) this.rPos.set(p[0], p[1], p[2]);
    this.rPath = null;
    this.rDone = null;
    this.rYaw = this.rTurn = Math.PI / 2;
    this.poseRider(0);
  }
  get riderWalking() {
    return !!this.rPath;
  }

  private setMode(m: Mode) {
    this.mode = m;
    this.mt = 0;
    Object.assign(this.from, this.ch);
    this.digFrom = this.dig;
    this.thumped = this.ch.drop > 0.95;
    if (m === 'hiding') {
      for (const s of this.shut) s.want = 1;
      this.doorWant = 0;
      this.rampWant = 0;
      if (this.thumped) this.grumble(0.08);
    }
  }
  private grumble(delay: number) {
    if (this.grumbleCd > 0) return;
    this.grumbleCd = 2.2;
    this.grumbleAt = delay;
  }
  /** the shell hits the sand: squash, the whole house rattles, a cloud of dust */
  private thump() {
    this.sqV += 0.8;
    for (const s of this.swings) {
      s.vx += (rnd.next() - 0.5) * 6 * s.amp;
      s.vz += (rnd.next() - 0.5) * 6 * s.amp;
    }
    const p = this.root.position;
    this.ctx.sfx('board_land', p, 0.8, 0.45);
    this.ctx.sfx('quake_rumble', p, 0.45, 1.2);
    this.ctx.fx.dust({ x: p.x, y: p.y + 0.3, z: p.z }, 2.4, P.sand0, 12);
    this.grumble(0.3);
  }
  /** sand bursting out round the rim as he wiggles down (or heaves up) */
  private rimBurst(power: number) {
    const a = rnd.next() * Math.PI * 2;
    const p = this.root.localToWorld(_tw.set(Math.sin(a) * 2.85, 0, this.CC.z + Math.cos(a) * 3.7));
    p.y = this.ctx.world.groundAt(p.x, p.z) + 0.1;
    this.ctx.fx.sandBurst({ x: p.x, y: p.y, z: p.z }, power);
  }
  /** grains pouring off the dome as he rises */
  private shellPour() {
    const S = this.n.shell, R = this.rest.shell;
    if (!S || !R) return;
    const a = rnd.next() * Math.PI * 2, th = 0.75 + rnd.next() * 0.6;
    const loc = _tw.set(Math.sin(th) * Math.sin(a) * 2.7, Math.cos(th) * 1.95, Math.sin(th) * Math.cos(a) * 3.5).add(this.CC).sub(R);
    const p = S.localToWorld(loc);
    this.ctx.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: 5, vel: { x: Math.sin(a) * 0.6, y: -0.2, z: Math.cos(a) * 0.6 }, spread: 0.5, life: [0.6, 1.1], size: [0.06, 0.04], sprite: ['grain0', 'grain1', 'grain2', 'grain3'], color: [P.sand0, P.sand1, P.sand2], gravity: 9, ground: true, bounce: 0.1 });
    if (rnd.chance(0.3)) this.ctx.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: 1, vel: { x: 0, y: -0.3, z: 0 }, spread: 0.3, life: [0.8, 1.5], size: [0.5, 1.4], sprite: ['puff0', 'puff1', 'cloud0'], color: [P.sand0, P.sand1], alpha: 0.55, drag: 2, rot: 6, rotSpeed: 0.6 });
  }

  private pickWaypoint() {
    this.wpA += 0.6 + rnd.next() * 0.35;
    const r = 3.6 + rnd.next() * 1.6; // inside the cleared camp (RegionGen flattens the post's disc)
    this.wp.set(this.home.x + Math.cos(this.wpA) * r, 0, this.home.z + Math.sin(this.wpA) * r);
  }

  /** a solid, bullet-stopping body that walks with him */
  private moveCollider() {
    const p = this.root.position;
    if (this.col && Math.hypot(p.x - this.colAt.x, p.z - this.colAt.z) < 0.3) return;
    const cols = this.ctx.world.colliders;
    if (this.col) cols.remove(this.col);
    const c = this.center(_v);
    this.col = cols.circle(c.x, c.z, 3.0, p.y, p.y + 6.6, { tag: 'turtle', solid: true, bullets: true });
    this.colAt.copy(p);
  }

  update(dt: number) {
    if (dt <= 0) return;
    this.t += dt;
    this.mt += dt;
    this.grumbleCd -= dt;
    if (this.grumbleAt >= 0) {
      this.grumbleAt -= dt;
      if (this.grumbleAt < 0) this.ctx.sfx('camel_grunt', this.root.position, 0.7, 0.32);
    }
    // ---- hiding: in, down onto the plastron, then wiggle down into the sand
    const ch = this.ch, f = this.from, mt = this.mt;
    let digging = 0;
    switch (this.mode) {
      case 'hiding': {
        ch.neck = mix(f.neck, 1, Ease.outCubic(c01(mt / 0.45)));
        ch.limb = mix(f.limb, 1, Ease.outCubic(c01((mt - 0.08) / 0.45)));
        ch.tail = mix(f.tail, 1, Ease.outCubic(c01((mt - 0.12) / 0.4)));
        ch.tuck = mix(f.tuck, 1, Ease.outQuad(c01((mt - 0.15) / 0.5)));
        ch.drop = mix(f.drop, 1, Ease.inQuad(c01((mt - 0.45) / 0.28)));
        if (!this.thumped && ch.drop >= 1) {
          this.thumped = true;
          this.thump();
          if (this.digFrom < 0.5) this.ctx.sfx('sand_burst', this.root.position, 0.7, 0.7);
        }
        const dk = c01((mt - 0.85) / 1.7);
        this.dig = mix(this.digFrom, 1, Ease.inOutQuad(dk));
        if (dk > 0 && dk < 1) digging = 1;
        if (mt > 2.7) {
          this.mode = 'hidden';
          this.mt = 0;
        }
        break;
      }
      case 'hidden':
        ch.neck = ch.limb = ch.tail = ch.drop = ch.tuck = 1;
        this.dig = 1;
        if (!this.hold) this.calm += dt;
        if (this.calm >= this.calmNeed) {
          this.setMode('peek');
          this.peekHold = 1.0 + rnd.next() * 0.8;
        }
        break;
      case 'peek':
        // eyes first, up out of the sand
        ch.neck = mix(f.neck, PEEK_G, Ease.outCubic(c01(mt / 0.8)));
        ch.tuck = mix(f.tuck, 0, Ease.outCubic(c01(mt / 0.6)));
        ch.limb = ch.tail = ch.drop = 1;
        this.dig = 1;
        if (mt > 0.8 + this.peekHold) {
          this.setMode('emerging');
          this.ctx.sfx('sand_rise', this.root.position, 0.8, 0.75);
          this.ctx.sfx('quake_rumble', this.root.position, 0.35, 1.4);
        }
        break;
      case 'emerging': {
        // he heaves up out of the sand, then stands
        const uk = c01(mt / 1.5);
        this.dig = mix(this.digFrom, 0, Ease.inOutQuad(uk));
        if (uk > 0 && uk < 1) digging = 0.7;
        ch.neck = mix(f.neck, 0, Ease.outBack(c01((mt - 0.2) / 0.9)));
        ch.tuck = 0;
        ch.drop = mix(f.drop, 0, Ease.inOutQuad(c01((mt - 1.35) / 0.7)));
        ch.limb = mix(f.limb, 0, Ease.outCubic(c01((mt - 1.3) / 0.7)));
        ch.tail = mix(f.tail, 0, Ease.outCubic(c01((mt - 1.7) / 0.6)));
        if (mt > 1.6 && this.shut.some((s) => s.want > 0)) for (const s of this.shut) s.want = 0;
        if (mt > 2.6) {
          this.mode = 'out';
          this.mt = 0;
          this.sqV -= 0.3;
          this.pauseT = Math.max(this.pauseT, 2.5);
          const cb = this.onOut;
          this.onOut = null;
          cb?.();
        }
        break;
      }
      default:
        ch.neck = ch.limb = ch.tail = ch.drop = ch.tuck = 0;
        this.dig = 0;
    }
    this.wiggle = damp(this.wiggle, digging, 6, dt);
    if (digging > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        this.burstT = 0.09 + rnd.next() * 0.08;
        this.rimBurst(0.55 + digging * 0.4);
        if (this.mode === 'emerging') this.shellPour();
      }
      if (this.mode === 'emerging' && rnd.chance(dt * 30)) this.shellPour();
    }
    for (let s = 0; s < 2; s++) {
      const h = dt / 2;
      this.sqV += (-120 * this.sq - 9 * this.sqV) * h;
      this.sq += this.sqV * h;
      this.heaveV += (-26 * this.heave - 5 * this.heaveV) * h;
      this.heave += this.heaveV * h;
    }
    // ---- walking his loop round the camp (or turning his porch to a customer)
    const root = this.root;
    const out = this.mode === 'out';
    if (this.resumeT >= 0) {
      this.resumeT -= dt;
      if (this.resumeT < 0) this.halt = false;
    }
    let moving = false, turning = 0;
    const hunter = this.lookAt;
    if (out && this.yawTarget !== null) {
      const d = wrapPi(this.yawTarget - root.rotation.y);
      root.rotation.y += Math.sign(d) * Math.min(Math.abs(d), 0.75 * dt);
      turning = Math.abs(d) > 0.02 ? 1 : 0;
    } else if (out && !this.halt) {
      this.pauseT -= dt;
      const blocked = hunter && Math.hypot(hunter.x - root.position.x, hunter.z - root.position.z) < 7.5 && _b.set(hunter.x - root.position.x, 0, hunter.z - root.position.z).normalize().dot(_c.set(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y))) > 0.45;
      if (blocked) this.pauseT = Math.max(this.pauseT, 0.8);
      if (this.pauseT <= 0) {
        const dx = this.wp.x - root.position.x, dz = this.wp.z - root.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.4) {
          this.pickWaypoint();
          if (rnd.chance(0.45)) this.pauseT = 3 + rnd.next() * 4;
        } else {
          const want = Math.atan2(dx, dz);
          const d = wrapPi(want - root.rotation.y);
          root.rotation.y += Math.sign(d) * Math.min(Math.abs(d), 0.32 * dt);
          const v = 0.5 * Math.max(0.2, Math.cos(Math.min(Math.abs(d), 1.4)));
          root.position.x += Math.sin(root.rotation.y) * v * dt;
          root.position.z += Math.cos(root.rotation.y) * v * dt;
          moving = true;
          this.gait += (v * dt) / 1.6;
        }
      }
    }
    if (turning) this.gait += dt * 0.42;
    root.position.y = this.ctx.world.groundAt(root.position.x, root.position.z);
    this.walk = damp(this.walk, moving ? 1 : turning ? 0.7 : 0, 2.5, dt);
    if (!moving && !turning) this.gait += (Math.round(this.gait * 2) / 2 - this.gait) * Math.min(1, dt * 1.5); // settle onto all four feet
    this.moveCollider();
    // ---- head: looking about, at the customer, nodding
    this.nodT -= dt;
    this.stompT -= dt;
    const S = this.n.shell;
    let ty = Math.sin(this.t * 0.19) * 0.35, tp = 0.04 + Math.sin(this.t * 0.15) * 0.06;
    if (hunter && S && !moving) {
      const loc = S.worldToLocal(_v.copy(hunter));
      const lx = loc.x, ly = loc.y - 0.8, lz = loc.z - 4.6;
      ty = clamp(Math.atan2(lx, lz), -0.85, 0.85);
      tp = clamp(-Math.atan2(ly, Math.hypot(lx, lz)), -0.3, 0.3);
    }
    if (this.hidden) ty = tp = 0;
    if (this.mode === 'peek') {
      ty = Math.sin(mt * 1.6) * 0.3;
      tp = -0.08;
    }
    this.hy = damp(this.hy, ty, 1.8, dt);
    this.hp = damp(this.hp, tp, 1.8, dt);
    const gp = this.gait * Math.PI * 2;
    let headYaw = this.hy, headPitch = this.hp + Math.sin(gp * 2) * 0.03 * this.walk;
    if (this.nodT > 0) headPitch += Math.sin((1.2 - this.nodT) * 7) * 0.14 * Math.min(1, this.nodT * 2);
    const outK = 1 - ch.neck;
    this.jaw = damp(this.jaw, (this.nodT > 0 ? 0.08 : 0.01) * outK, 6, dt);
    // slow, heavy blinks; shut tight while hidden, a wary squint while peeking
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blinkOn = 0.3;
      this.blinkT = 3.5 + rnd.next() * 4;
    }
    this.blinkOn -= dt;
    const lidK = this.hidden ? 1 : this.mode === 'peek' ? 0.4 : this.blinkOn > 0 ? Math.sin((this.blinkOn / 0.3) * Math.PI) : 0;
    // ---- pose
    const n = this.n, R = this.rest;
    if (S && R.shell) {
      const bob = (1 - Math.abs(Math.cos(gp * 2))) * 0.035 * this.walk;
      S.position.copy(R.shell);
      S.position.y += bob - ch.drop * this.dropM - this.dig * this.digM;
      S.scale.set(1 + this.sq * 0.3, 1 - this.sq * 0.6, 1 + this.sq * 0.3);
      const wig = this.wiggle * (0.6 + 0.4 * Math.sin(this.t * 2.3));
      S.rotation.set(this.heave * 0.4 + Math.sin(gp * 2 + 0.6) * 0.01 * this.walk + Math.sin(this.t * 7.3) * 0.012 * wig, Math.sin(this.t * 5.1) * 0.01 * wig, Math.sin(gp) * 0.018 * this.walk + Math.sin(this.t * 9.5) * 0.035 * wig);
    }
    this.place('neck', ch.neck);
    n.neck?.rotation.set(ch.tuck * 0.2 + Math.sin(this.t * 0.7) * 0.02 * outK, headYaw * 0.35 * (1 - ch.tuck), 0);
    n.head?.rotation.set(headPitch + ch.tuck * 0.25, headYaw * 0.65 * (1 - ch.tuck), 0);
    if (n.jaw) n.jaw.rotation.x = this.jaw;
    for (const [lid, eye] of [['lid_l', 'eye_l'], ['lid_r', 'eye_r']]) {
      const lo = n[lid], rr = this.restRot[lid];
      if (lo && rr) lo.rotation.set(mix(rr.x, -0.05, lidK), rr.y, rr.z);
      n[eye]?.rotation.set(0, clamp((ty - this.hy) * 1.2, -0.35, 0.35), 0);
    }
    for (const [leg, off, side] of LEGS) {
      const up = n['leg_' + leg], ft = n['foot_' + leg];
      const ph = (this.gait + off) * Math.PI * 2;
      const swingPh = Math.sin(ph) > 0 ? Math.sin(ph) : 0; // the lifting half of the cycle
      const a = this.walk * (1 - ch.limb);
      let lift = swingPh * a;
      if (leg === 'fl' && this.stompT > 0) lift = Math.max(lift, Math.sin(((1.4 - this.stompT) / 1.4) * Math.PI) * (1 - ch.limb));
      this.place('leg_' + leg, ch.limb);
      if (up) {
        up.position.y += lift * 0.16;
        up.rotation.set(Math.cos(ph) * 0.16 * a - lift * 0.1, 0, side * lift * 0.05);
      }
      ft?.rotation.set(lift * 0.3 + ch.limb * 0.45, 0, 0);
    }
    this.place('tail', ch.tail);
    if (n.tail) n.tail.rotation.set(0, Math.sin(gp) * 0.16 * this.walk + Math.sin(this.t * 0.6) * 0.05, 0);
    // ---- the swinging things: lanterns, chime, pots, and the tree in the wind
    const roll = S ? S.rotation.z : 0, pitch = S ? S.rotation.x : 0;
    for (const s of this.swings) {
      const rr = this.restRot[s.name];
      let tx = Math.sin(this.t * 0.8 + s.ph) * 0.02 * s.amp - this.heave * 0.4 - pitch * 1.5 * s.amp;
      let tz = -roll * 2.4 * s.amp;
      if (s.name === 'tree' || s.name === 'canopy') {
        // gusts: a slow sway with a quicker shiver in the leaves
        const gust = 0.5 + 0.5 * noise.n2(this.t * 0.12, s.ph);
        tx += (Math.sin(this.t * 0.55 + s.ph) * 0.6 + noise.n2(this.t * 0.9, 3.1 + s.ph) * 0.4) * 0.05 * gust;
        tz += (Math.sin(this.t * 0.43 + 1.3) * 0.6 + noise.n2(this.t * 0.8, 7.7 + s.ph) * 0.4) * 0.06 * gust;
      }
      const k = s.name === 'tree' ? 12 : s.name === 'canopy' ? 16 : 28;
      s.vx += (-k * (s.x - tx) - 2.4 * s.vx) * dt;
      s.vz += (-k * (s.z - tz) - 2.4 * s.vz) * dt;
      s.x = clamp(s.x + s.vx * dt, -0.7, 0.7);
      s.z = clamp(s.z + s.vz * dt, -0.7, 0.7);
      s.o.rotation.set((rr?.x ?? 0) + s.x, rr?.y ?? 0, (rr?.z ?? 0) + s.z);
    }
    this.poseHouse(dt);
    // smoke from the stovepipe (not while he is dug in)
    this.smokeT -= dt;
    if (this.smokeT <= 0 && this.dig < 0.3) {
      this.smokeT = 0.35 + rnd.next() * 0.3;
      const c = this.toWorld(this.meta.chimney ?? [-1.35, 6.75, -1.15], _tw);
      c.y -= this.dig * this.digM + ch.drop * this.dropM;
      this.ctx.particles.emit({ pos: { x: c.x, y: c.y, z: c.z }, count: 1, vel: { x: 0.18, y: 0.55, z: 0.06 }, spread: 0.08, life: [2.2, 3.4], size: [0.16, 0.9], sprite: ['puff0', 'puff1', 'puff2', 'cloud0'], color: [0xb8b0a4, 0x8e877c], alpha: 0.42, drag: 0.25, rot: 6, rotSpeed: 0.4, fadeIn: 0.2 });
    }
    // ---- Ozymandias
    const rd = this.rider;
    if (rd) {
      if (this.hidden && !rd.hidden) rd.threat(1);
      rd.lookAt = this.lookAt;
      rd.near = this.near && !this.hidden && !this.indoor && !this.rPath;
      this.poseRider(dt);
      rd.update(dt);
    }
    this.gobi.update(dt);
  }

  /** door, shutters, gangplank */
  private poseHouse(dt: number) {
    const n = this.n;
    this.doorK = dt > 0 ? damp(this.doorK, this.doorWant, 3.2, dt) : this.doorWant;
    if (n.door) n.door.rotation.set(0, this.doorOpen * Ease.inOutQuad(this.doorK), 0);
    for (const s of this.shut) {
      if (dt <= 0) s.k = s.want;
      else if (s.want > s.k) {
        // banged shut, one after another
        s.delay -= dt;
        if (s.delay <= 0) {
          s.k = Math.min(1, s.k + dt * 4.5);
          if (s.k >= 1) {
            this.ctx.sfx('poster_slam', s.o.getWorldPosition(_tw), 0.4, 0.9 + rnd.next() * 0.3);
            s.delay = 0.12 + rnd.next() * 0.25;
          }
        }
      } else {
        s.k = Math.max(s.want, s.k - dt * 1.6);
        if (s.k <= s.want) s.delay = 0.12 + rnd.next() * 0.25;
      }
      const e = s.want > 0 ? Ease.inQuad(s.k) : Ease.outCubic(s.k);
      s.o.rotation.set(0, mix(s.open, 0, e), 0);
    }
    // the gangplank slides out from under the porch, then tips down onto the sand
    const r = n.ramp, rest = this.rest.ramp;
    if (!r || !rest) return;
    const was = this.rampK;
    this.rampK = dt > 0 ? (this.rampWant > this.rampK ? Math.min(this.rampWant, this.rampK + dt / 2.1) : Math.max(this.rampWant, this.rampK - dt / 1.8)) : this.rampWant;
    const k = this.rampK;
    const slide = Ease.inOutQuad(c01(k / 0.5)), tip = c01((k - 0.5) / 0.5);
    const drop = this.rampWant > 0.5 ? Ease.inQuad(tip) : Ease.inOutQuad(tip);
    r.position.copy(rest).addScaledVector(this.rampStow, 1 - slide);
    r.rotation.set(0, 0, this.rampTilt * (1 - drop));
    if (dt > 0 && was < 1 && k >= 1 && !this.rampLanded) {
      this.rampLanded = true;
      const f = this.rampFoot(_tw);
      this.ctx.sfx('board_land', f, 0.7, 0.55);
      this.ctx.fx.dust({ x: f.x, y: f.y + 0.1, z: f.z }, 0.9, P.sand0, 6);
      this.ctx.fx.sandBurst({ x: f.x, y: f.y + 0.05, z: f.z }, 0.5);
    }
  }

  /** Ozymandias's place on the porch / his walk in and out of the house */
  private poseRider(dt: number) {
    const rr = this.rider?.root, R = this.rest.shell;
    if (!rr || !R) return;
    let walking = 0;
    const path = this.rPath;
    if (path && dt > 0) {
      this.rS += OZ_SPEED * dt;
      let s = this.rS, i = 0;
      for (; i < path.length - 1; i++) {
        const L = path[i].distanceTo(path[i + 1]);
        if (s <= L) break;
        s -= L;
      }
      if (i >= path.length - 1) {
        this.rPos.copy(path[path.length - 1]);
        this.rPath = null;
        this.rTurn = Math.PI / 2;
        const cb = this.rDone;
        this.rDone = null;
        cb?.();
      } else {
        const a = path[i], b = path[i + 1];
        const L = Math.max(1e-4, a.distanceTo(b));
        this.rPos.lerpVectors(a, b, s / L);
        this.rTurn = Math.atan2(b.x - a.x, b.z - a.z);
        walking = 1;
      }
    }
    if (dt > 0) {
      const d = wrapPi(this.rTurn - this.rYaw);
      this.rYaw += Math.sign(d) * Math.min(Math.abs(d), 5 * dt);
      this.rWalk = damp(this.rWalk, walking, 8, dt);
      this.rPh += dt * 8.5 * this.rWalk;
    }
    // a tortoise's waddle: rock side to side, a little bob on each step
    rr.position.copy(this.rPos).sub(R);
    rr.position.y += Math.abs(Math.sin(this.rPh)) * 0.035 * this.rWalk;
    rr.rotation.set(0.04 * this.rWalk, this.rYaw, Math.sin(this.rPh) * 0.085 * this.rWalk);
  }

  private place(name: string, k: number) {
    const o = this.n[name], r = this.rest[name], d = this.ret[name];
    if (o && r) o.position.copy(r).addScaledVector(d ?? _l.set(0, 0, 0), d ? k : 0);
  }

  restPose() {
    for (const [k, o] of Object.entries(this.n)) {
      if (!o) continue;
      o.position.copy(this.rest[k]);
      o.rotation.copy(this.restRot[k]);
      o.scale.set(1, 1, 1);
    }
    this.rider?.restPose();
  }

  /** where the customer stands to trade (the interact prompt follows him): the foot of his gangplank */
  frontPoint(out: THREE.Vector3) {
    const f = this.meta.ramp?.foot ?? [5.35, 0.08, 0.1];
    this.root.localToWorld(out.set(f[0] + 1.2, 0, f[2]));
    out.y = this.ctx.world.groundAt(out.x, out.z);
    return out;
  }

  dispose() {
    if (this.col) this.ctx.world.colliders.remove(this.col);
    this.col = null;
  }
}

type Merchant = Tamsin | Turtle;

// ================================================================== the wares as rigid bodies
type BodyState = 'wait' | 'fly' | 'shelf' | 'free' | 'held' | 'sold' | 'pack' | 'gone';
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
  /** the stall: it flies to its slot and stands there until it is knocked off (rest = the slot) */
  onShelf: boolean;
  flyT: number;
  /** upright on its slot, turned a little */
  q0: THREE.Quaternion;
  /** landing squash 0..1 */
  land: number;
  /** its price tag on the stall (null on the rug) */
  tag: PriceTag | null;
  /** the order it stands in (number keys) */
  idx: number;
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

/** a visit to the turtle house: talk on the porch, walk in, the shop inside, walk out */
interface Visit {
  g: Turtle;
  hooks: MerchantHooks;
  phase: 'talk' | 'enter' | 'shop' | 'exit' | 'bye';
  t: number;
  // the porch talk
  asked: Set<number>;
  /** what is on offer to say right now (haggling drops out once tried) */
  opts: typeof TALK;
  plaques: FloatText3D[];
  plaqueT: number;
  showAt: number;
  hover: number;
  go: 'enter' | 'bye' | null;
  goAt: number;
  // the hunter on foot (a copy of his rig), along a path in Gobi's root space
  actor: RigInstance | null;
  path: THREE.Vector3[];
  wp: THREE.Vector3[];
  cum: number[];
  s: number;
  walkPh: number;
  walkAmt: number;
  lastStep: number;
  yaw: number;
  standYaw: number;
  heading: number;
  breath: number;
  // the camera
  base: { pos: THREE.Vector3; look: THREE.Vector3; fov: number };
  cp: THREE.Vector3;
  cl: THREE.Vector3;
  doorAt: number;
  from: { pos: THREE.Vector3; look: THREE.Vector3; fov: number };
  outAt: number;
  ozGo: boolean;
  skip: boolean;
}
const _ndc = new THREE.Vector2();

/** a walk cycle for the hunter's rig (legs, arm swing, a little twist), or breathing while he stands */
function strideVisitor(r: RigInstance, ph: number, amt: number, t: number) {
  const n = r.nodes;
  const s = Math.sin(ph);
  const set = (k: string, x: number, y = 0, z = 0) => n[k]?.rotation.set(x, y, z);
  set('thigh_l', -s * 0.55 * amt);
  set('thigh_r', s * 0.55 * amt);
  set('shin_l', Math.max(0, Math.sin(ph + 1.4)) * 0.85 * amt);
  set('shin_r', Math.max(0, Math.sin(ph + 1.4 + Math.PI)) * 0.85 * amt);
  set('arm_l', s * 0.42 * amt + Math.sin(t * 1.6) * 0.02, 0, 0.08);
  set('fore_l', -0.25 - Math.max(0, s) * 0.3 * amt);
  set('arm_r', 0.08 - s * 0.4 * amt + Math.sin(t * 1.6 + 0.5) * 0.02, 0, -0.14);
  set('fore_r', -0.3 - Math.max(0, -s) * 0.3 * amt);
  set('torso', 0.05 * amt + Math.sin(t * 1.6) * 0.015 * (1 - amt), Math.sin(ph) * 0.09 * amt, Math.cos(ph) * 0.03 * amt);
  set('head', -0.04 + Math.sin(t * 0.7) * 0.03 * (1 - amt), Math.sin(t * 0.45) * 0.12 * (1 - amt), 0);
  if (n['pelvis']) n['pelvis'].rotation.y = -Math.sin(ph) * 0.06 * amt;
}

interface Arrival {
  her: Merchant;
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
  /** touch: the ware the first tap picked (a second tap on it buys) */
  private touchPick: Body | null = null;
  private hoverLock = 0;
  private tip: HTMLDivElement;
  private bar: HTMLDivElement;
  private done: (() => void) | null = null;
  private t = 0;
  private phase: 'off' | 'arrive' | 'browse' | 'leave' | 'visit' = 'off';
  private pt = 0;
  private puppets = new Map<object, Merchant>();
  private her: Merchant | null = null;
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
  // a visit to the turtle house
  private visit: Visit | null = null;
  private visitWares: Ware[] | null = null;
  /** the shop is set up inside the house */
  private indoor = false;
  /** where the warm fill light hangs (null: in front of the merchant) */
  private lightAt: THREE.Vector3 | null = null;
  /** force his lines to one side of his head (1 / -1; 0 = the open side) */
  private speechForce = 0;
  // the rug's light pools
  private rugSpot: { m: VoxelMaterial; u: SpotUniforms } | null = null;
  private bosses = new Set<{ alive?: boolean }>();
  /** the beacons that lead you to each turtle house (smoke column, lanterns, music, prints) */
  private beacons = new Map<Turtle, ShopBeacon>();
  /** the stock this restock period (Missions fills it through book.stock) */
  readonly book: StockBook;
  /** gear worn per slot (the "replaces your ..." line) */
  private worn = new Map<string, string>();
  /** the stall the wares stand on (indoors), and their price tags */
  private stall: Stall | null = null;
  private tags: PriceTag[] = [];
  /** the hovered ware's card: name, what it does, what it means for you, the price */
  private card: FloatText3D[] = [];
  private cardFor: Body | null = null;
  /** a number key picked the ware: the mouse leaves it be until it moves */
  private kbHold = false;
  private kbMouse = [0, 0];

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
    this.book = new StockBook(ctx);
    this.unsub.push(ctx.events.on('gearChanged', (slot: string, id: string | null) => (id ? this.worn.set(slot, id) : this.worn.delete(slot))));
    (window as unknown as { __shop?: Shop }).__shop = this; // dev handle
    // no arrival scene while a boss is up
    this.unsub.push(ctx.events.on('bossIntro', (b: { alive?: boolean }) => b && this.bosses.add(b)));
    for (const ev of ['bossKilled', 'bossDefeated'])
      this.unsub.push(ctx.events.on(ev, (b: { alive?: boolean }) => this.bosses.delete(b)));
  }

  /** the open shop (or its arrival scene) is driving this puppet */
  private owns(p: Merchant) {
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
      const meta = rig.geo.spec.meta ?? {};
      p = meta.turtleHouse ? new Turtle(this.ctx, rig, meta, hooks?.home ?? null, hooks?.rider ?? null) : new Tamsin(this.ctx, rig, rig.root, meta);
      this.puppets.set(rig, p);
      if (p instanceof Turtle) {
        const t = p;
        this.beacons.set(t, new ShopBeacon(this.ctx, { root: t.root, home: t.homePos, chimney: (o) => t.chimneyWorld(o), lanterns: (o) => t.lanternWorld(o) }));
      }
    }
    if (p instanceof Turtle && hooks) p.hooks = hooks;
    const h = Math.min(dt, 1 / 20);
    if (p instanceof Turtle) this.beacons.get(p)?.update(h, hunter ?? null, p.hidden);
    if (this.owns(p)) return; // the shop / its arrival scene drives her
    if (h <= 0) return;
    const d = hunter ? hunter.distanceTo(rig.root.position) : 99;
    if (p instanceof Turtle) {
      // a gun pointed at Ozymandias sends him into his shell; outlaws near and Gobi digs in
      if (d < 25 && p.rider && !p.hidden && this.aimedAt(p)) p.rider.threat(0.5);
      if (this.danger(p.root.position, DIG_R)) p.threat(0.6);
    } else if (d < 25 && this.aimedAt(p)) p.threat(0.5);
    p.near = d < 12;
    p.lookAt = hunter && d < 14 ? _w.copy(hunter).add(_a.set(0, 1.45, 0)) : null;
    p.update(h);
    if (hunter && hooks?.stock) this.watchArrival(p, hunter, hooks, h);
  }

  /**
   * Ride into her radius slowly, or head straight for her, and the arrival
   * scene plays. Riding past at speed, or anything going on, and it does not.
   */
  private watchArrival(p: Merchant, hunter: THREE.Vector3, hooks: MerchantHooks, h: number) {
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
    if (d > (p instanceof Turtle ? ARRIVE_R_T : ARRIVE_R) || (p instanceof Turtle && p.hidden) || this.active || this.arrival || !p.root.parent) {
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

  /** a boss is up, or an outlaw is within r of the point */
  private danger(at: THREE.Vector3, r = CALM_R) {
    for (const b of this.bosses) if (b.alive === false) this.bosses.delete(b);
    if (this.bosses.size) return true;
    for (const e of this.ctx.enemies.list) {
      if (!e.alive) continue;
      if (e.isBoss) return true;
      if (Math.hypot(e.pos.x - at.x, e.pos.z - at.z) <= r) return true;
    }
    return false;
  }

  /** the nearest walking shop (the HUD compass): where, how far, dug in, visited */
  nearestShop(): BeaconInfo | null {
    let best: BeaconInfo | null = null;
    for (const [t, b] of this.beacons) {
      if (!t.root.parent) continue;
      if (!best || b.info.dist < best.dist) best = b.info;
    }
    return best;
  }
  /** an arrival scene or a visit is on */
  get visiting() {
    return !!this.visit || !!this.arrival;
  }

  /** where the customer stands to trade with a walking merchant (null: a standing one) */
  merchantFront(rig: RigInstance, out: THREE.Vector3) {
    const p = this.puppets.get(rig);
    return p instanceof Turtle ? p.frontPoint(out) : null;
  }

  /** her (his) lines and name */
  private get voice() {
    return this.her?.kind === 'turtle' ? VOICE_C : VOICE_T;
  }

  // ---------------------------------------------------------------- the arrival scene
  private startArrival(her: Merchant, hooks: MerchantHooks) {
    const ctx = this.ctx, eng = ctx.engine;
    her.armed = false;
    her.awayT = 0;
    her.dwell = 0;
    this.her = her;
    this.borrowed = false;
    const H = her.root.position;
    const cam = this.cam.camera;
    const p0 = cam.position.clone();
    cam.getWorldDirection(_v);
    const l0 = p0.clone().addScaledVector(_v, 6);
    let keys: { P: THREE.Vector3[]; L: THREE.Vector3[]; F: number[] };
    if (her instanceof Turtle) {
      // Gobi stops and turns his porch to the rider; the camera cranes past the
      // TRADING POST sign over his head, then down to a low shot of Ozymandias on his porch
      const hp = this.hunter ?? p0;
      const a = her.porchYawTo(hp);
      her.faceYaw(a);
      const X = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), Z = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const at = (x: number, y: number, z: number) => H.clone().addScaledVector(X, x).addScaledVector(Z, z).add(_a.set(0, y, 0));
      const ground = (q: THREE.Vector3, lift: number) => {
        q.y = Math.max(q.y, ctx.world.groundAt(q.x, q.z) + lift);
        return q;
      };
      const pSign = ground(at(3.6, 5.9, 7.4), 1), lSign = at(-0.15, 4.4, 1.2);
      // low on the sand looking up at the porch; over the hunter's shoulder when he stands close
      const hx = (hp.x - H.x) * X.x + (hp.z - H.z) * X.z, hz = (hp.x - H.x) * Z.x + (hp.z - H.z) * Z.z;
      const pNear = ground(hx < 9 ? at(hx + 3.2, 2.9, hz + 1.6) : at(9.4, 3.05, 3.5), 0.6), lNear = at(1.98, 4.2, 1.1);
      this.pivot.copy(H);
      this.fwdAng = Math.atan2(X.x, X.z);
      this.lightAt = at(3.0, 4.6, 1.0);
      keys = { P: [p0, pSign, pNear], L: [l0, lSign, lNear], F: [cam.fov, 50, 40] };
    } else {
      const a = her.root.rotation.y;
      const F = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), L = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      this.pivot.copy(H);
      this.fwdAng = a;
      // the post's door is 1.6 m to her right (Missions' layout); the big
      // TRADING POST sign hangs on the false front above it
      const door = H.clone().addScaledVector(L, -1.6);
      const sign = door.clone().addScaledVector(F, -2.33);
      sign.y = H.y + 6.3;
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
      keys = { P: [p0, pSign, pNear], L: [l0, sign, look], F: [cam.fov, 50, 38] };
    }
    this.arrival = { her, hooks, t: 0, modal: false, ...keys, coaxed: false, outAt: -1 };
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
    // the board skids in; startled, she ducks into her shell (on his back, if he is the shop)
    her.startle();
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
    const T = her instanceof Turtle ? 3.2 : 2.7;
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
    if (!A.coaxed && A.t > T - 0.25) {
      A.coaxed = true;
      her.coax(0.85);
    }
    her.lookAt = this.hunter ? _w.copy(this.hunter).add(_a.set(0, 1.4, 0)) : null;
    her.near = false;
    her.update(h);
    if (A.coaxed && A.outAt < 0 && her.readyToGreet()) {
      A.outAt = A.t;
      this.greeted = true;
      this.speak(rnd.pick(this.voice.lines.arrive), 'laugh');
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
    if (A.her instanceof Turtle) return this.startTalk(A.her, A.hooks);
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
    A.her.halt = false;
    A.her.faceYaw(null);
    if (A.her instanceof Turtle) A.her.resume(0.5);
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
    this.visitWares = null;
    this.lightAt = null;
    const d = this.done;
    this.done = null;
    d?.();
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
      this.ctx.toast(this.voice.title, '#ffd36b', text);
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
        if (this.speechForce) this.speechSide = this.speechForce;
        else if (nx > 0.3) this.speechSide = -1;
        else if (nx < -0.1) this.speechSide = 1;
        const right = _a.set(1, 0, 0).applyQuaternion(cam.quaternion);
        this.speech.anchor.copy(head).addScaledVector(right, this.speechSide * (0.24 + this.speech.mesh.scale.x * 0.5));
        this.speech.anchor.y += 0.16;
        this.speech.update(h, cam, (c, i, s) => Voice.syllable(her.kind === 'turtle' ? 'ozymandias' : 'tamsin', c, { index: i, text: s, pos: head }));
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

  private aimedAt(p: Merchant) {
    const o = _b, d = _c;
    this.cam.aimRay(o, d);
    const hit = (c: THREE.Vector3, r: number) => {
      const t = _a.copy(c).sub(o).dot(d);
      if (t < 0 || t > 30) return false;
      return _a.copy(o).addScaledVector(d, t).distanceTo(c) < r;
    };
    if (p instanceof Turtle) return !!p.rider && !p.rider.hidden && (hit(p.rider.center(_v), 0.6) || hit(p.rider.headPos(_v), 0.26));
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
      const big = p instanceof Turtle;
      if ((close && (!big || this.hunter!.distanceTo(c) < 12)) || miss < (big ? 4 : 2.2)) p.threat(1);
    }
  }

  /** r < 0: a bullet impact (radius |r|), otherwise an explosion radius */
  private onBlast(pos: { x: number; y: number; z: number }, r: number) {
    for (const p of this.puppets.values()) {
      if (!p.root.parent || this.owns(p)) continue;
      const c = p.center(_v);
      const reach = r < 0 ? -r + (p instanceof Turtle ? 3 : 0) : r + (p instanceof Turtle ? 10 : 7);
      if (c.distanceTo(_a.set(pos.x, pos.y, pos.z)) < reach) p.threat(1.5);
    }
  }

  // ---------------------------------------------------------------- the turtle house: a visit
  // Talk to Ozymandias on his porch (3D Alagard answers to pick), then walk up
  // the gangplank and in at the door behind him; the shop happens inside, and
  // leaving walks you back out and down to your board.

  /** after the arrival greeting: his porch, and a few things to say to him */
  private startTalk(g: Turtle, hooks: MerchantHooks) {
    const eng = this.ctx.engine;
    this.her = g;
    this.active = true;
    eng.paused = true;
    eng.input.setWantLock(false);
    this.visit = {
      g, hooks, phase: 'talk', t: 0, asked: new Set(), opts: this.talkOptions(), plaques: [], plaqueT: 0, showAt: 0.4, hover: -1, go: null, goAt: 0,
      actor: null, path: [], wp: [], cum: [0], s: 0, walkPh: 0, walkAmt: 0, lastStep: 0, yaw: 0, standYaw: 0, heading: 0, breath: 0,
      base: { pos: this.shot.pos.clone(), look: this.shot.look.clone(), fov: this.shot.fov },
      cp: new THREE.Vector3(), cl: new THREE.Vector3(), doorAt: -1, from: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 }, outAt: -1, ozGo: false, skip: false,
    };
    this.phase = 'visit';
    this.speechForce = 1;
    this.beacons.get(g)?.visited();
    this.talkBar(this.visit!);
    this.bar.style.display = 'block';
  }

  /** what he can be asked right now (the haggle once a restock period) */
  private talkOptions() {
    return TALK.filter((c) => !c.haggle || this.book.haggle === 'none');
  }
  private talkBar(v: Visit) {
    this.bar.innerHTML = touchText(`click or press 1-${v.opts.length} to answer &nbsp;·&nbsp; ESC to ride on`);
  }

  private updateVisit(h: number) {
    const v = this.visit!;
    const inp = this.input;
    v.t += h;
    if ((v.phase === 'enter' || v.phase === 'exit') && v.t > 0.6 && (inp.wasPressed('Space') || inp.wasPressed('Enter') || inp.wasPressed('Mouse0') || inp.wasPressed('Escape'))) v.skip = true;
    switch (v.phase) {
      case 'talk':
        this.updateTalk(v, h);
        break;
      case 'enter':
        this.updateEnter(v, h);
        break;
      case 'exit':
        this.updateExit(v, h);
        break;
      case 'bye':
        this.updateBye(v, h);
        break;
    }
    if (!this.visit) return; // it ended this frame
    v.g.near = false;
    v.g.update(h);
    this.updateSpeech(h);
    this.warmUp(h, v.phase === 'bye' || (v.phase === 'exit' && v.outAt >= 0) ? 0 : 1);
  }

  // ---- talk
  private updateTalk(v: Visit, h: number) {
    const inp = this.input, g = v.g;
    // the camera holds on him, breathing
    this.shot.pos.copy(v.base.pos);
    this.shot.look.copy(v.base.look);
    this.shot.fov = v.base.fov;
    this.handheld(1);
    g.lookAt = this.hunter ? _w.copy(this.hunter).add(_a.set(0, 1.5, 0)) : null;
    // the answers come up once he has said his piece
    if (!v.plaques.length && !v.go && v.t >= v.showAt && (!this.speech || this.speech.done) && !this.pendingLine) this.showChoices(v);
    this.placeChoices(v, h);
    let pick = -1;
    if (v.plaques.length && v.t - v.plaqueT > 0.3) {
      for (let k = 0; k < v.opts.length; k++) if (inp.wasPressed('Digit' + (k + 1)) || inp.wasPressed('Numpad' + (k + 1))) pick = k;
      if (v.hover >= 0 && inp.wasPressed('Mouse0')) pick = v.hover;
    }
    if (inp.wasPressed('Escape') || inp.wasPressed('KeyT')) pick = v.opts.length - 1;
    if (pick >= 0) this.choose(v, pick);
    if (v.go && v.t >= v.goAt) {
      if (v.go === 'enter') this.startEnter(v);
      else this.startBye(v);
    }
  }

  private showChoices(v: Visit) {
    v.plaqueT = v.t;
    v.opts = this.talkOptions();
    this.talkBar(v);
    const halfH = 1.4 * Math.tan((this.shot.fov * Math.PI) / 360);
    v.plaques = v.opts.map((c, i) => {
      const old = v.asked.has(TALK.indexOf(c)) && !c.go;
      const ft = new FloatText3D(`${i + 1}.  ${c.q}`, { size: halfH * 0.085, px: 44, cps: 70, wrap: 60, align: 'left', hdr: old ? 0.8 : 1.2, color: old ? '#cdbb98' : '#fff3d6', glow: old ? '#6a4a28' : '#ffb070' });
      ft.mesh.renderOrder = 991;
      this.ctx.scene.add(ft.mesh);
      return ft;
    });
    this.ctx.sfx('card_flip', null, 0.25, 0.9);
  }

  /** the answers float in a column on the open side of the frame, a little in front of the lens */
  private placeChoices(v: Visit, h: number) {
    if (!v.plaques.length) return;
    const cam = this.ctx.camera;
    const pos = this.shot.pos;
    const fwd = _a.subVectors(this.shot.look, pos).normalize();
    const right = _b.crossVectors(fwd, UP).normalize();
    const up = _c.crossVectors(right, fwd);
    const D = 1.4, halfH = D * Math.tan((this.shot.fov * Math.PI) / 360);
    const halfW = halfH * (this.ctx.engine.width / Math.max(1, this.ctx.engine.height));
    // hover: the plaque under the cursor
    this.ray.setFromCamera(_ndc.set(this.input.ndcX, this.input.ndcY), cam);
    let hov = -1;
    v.plaques.forEach((ft, i) => {
      ft.mesh.updateMatrixWorld();
      if (ft.visibleAmount > 0.5 && this.ray.intersectObject(ft.mesh, false).length) hov = i;
    });
    if (hov >= 0 && hov !== v.hover) this.ctx.sfx('ui_hover', null, 0.3, 1.1);
    v.hover = hov;
    v.plaques.forEach((ft, i) => {
      ft.hover = damp(ft.hover, i === hov ? 1 : 0, 12, h);
      const w = ft.mesh.scale.x / Math.max(0.5, (1 + ft.hover * 0.12) * (0.92 + 0.08 * ft.visibleAmount));
      ft.anchor.copy(pos).addScaledVector(fwd, D).addScaledVector(right, -0.9 * halfW + w * 0.5 + ft.hover * 0.025).addScaledVector(up, (0.26 - i * 0.18) * halfH);
      ft.update(h, cam);
      // pinned in their column (no float bob: the rows would touch), just a breath of drift
      ft.mesh.position.copy(ft.anchor).addScaledVector(up, Math.sin(v.t * 1.3 + i) * 0.004);
    });
  }

  private choose(v: Visit, i: number) {
    if (v.go) return;
    const c = v.opts[i];
    if (!c) return;
    v.asked.add(TALK.indexOf(c));
    for (const ft of v.plaques) {
      ft.show(false);
      this.fading.push(ft);
    }
    v.plaques = [];
    v.hover = -1;
    this.ctx.sfx('ui_click', null, 0.45);
    if (c.haggle) {
      // once a restock: he knocks fifteen off everything, or he will not budge
      const won = this.book.tryHaggle();
      this.speak(rnd.pick(won ? OZ.haggleWin : OZ.haggleLose), won ? 'laugh' : 'squinty');
      if (won) {
        v.g.nod();
        this.ctx.sfx('gold_burst', null, 0.35, 1.3);
      } else v.g.shake();
      v.showAt = v.t + 1.4;
      return;
    }
    this.speak(rnd.pick(c.a), c.go === 'bye' ? 'neutral' : 'laugh');
    v.g.nod();
    if (c.go) {
      v.go = c.go;
      v.goAt = v.t + (c.go === 'enter' ? 1.3 : 0.5);
    } else v.showAt = v.t + 1.1;
  }

  // ---- walking in
  private startEnter(v: Visit) {
    const g = v.g;
    v.phase = 'enter';
    v.t = 0;
    v.go = null;
    v.doorAt = -1;
    v.ozGo = false;
    v.skip = false;
    this.bar.style.display = 'none';
    g.setRamp(true);
    g.lookAt = null;
    this.speechForce = 0;
    const F = g.meta.ramp?.foot ?? [5.35, 0.08, 0.1], T = g.meta.ramp?.top ?? [2.4, 3, 0.1];
    const fl = g.meta.porch?.[1] ?? 3.0, st = g.meta.room?.stand ?? [0.85, fl, -0.95];
    this.dismount(v, [[8.3, 0, 1.3], [F[0] + 0.75, 0, F[2] + 0.15], [F[0], F[1] + 0.03, F[2]], [T[0], T[1], T[2]], [1.55, fl, 0.1], [0.92, fl, 0.1], st]);
    // looking back up the shop at Ozymandias from where he stands
    v.standYaw = Math.atan2(-Math.cos(g.root.rotation.y), Math.sin(g.root.rotation.y));
    this.followTarget(v, v.cp, v.cl);
  }

  /** he parks his board beside the gangplank, steps off, and a walking copy of his rig takes over */
  private dismount(v: Visit, path: number[][]) {
    const g = v.g, hk = v.hooks.hunter, ctx = this.ctx;
    const a = g.root.rotation.y;
    v.heading = Math.atan2(Math.cos(a), -Math.sin(a)); // pointing away from the porch
    const bp = g.toWorld([8.1, 0, 2.4], new THREE.Vector3());
    bp.y = ctx.world.groundAt(bp.x, bp.z);
    const b = v.hooks.board;
    if (b?.place) b.place(bp.x, bp.y, bp.z, v.heading);
    if (hk?.root) {
      hk.root.position.copy(b?.pos ?? bp);
      hk.root.quaternion.setFromAxisAngle(UP, v.heading);
    }
    this.setPath(v, path);
    if (!hk) return;
    hk.rig.root.visible = false;
    const actor = new RigInstance(hk.rig.geo, { material: hk.rig.material });
    if (hk.gun) {
      const gun = new RigInstance(hk.gun.geo, { material: hk.gun.material });
      const holder = new THREE.Group();
      holder.rotation.x = Math.PI / 2;
      holder.add(gun.root);
      if (!actor.attach('hip_r', holder)) actor.nodes['pelvis']?.add(holder);
    }
    actor.setExpression('determined');
    ctx.scene.add(actor.root);
    v.actor = actor;
    v.yaw = Math.atan2(v.wp[1].x - v.wp[0].x, v.wp[1].z - v.wp[0].z);
    this.walkActor(v, 0, false);
  }

  /** the hunter's walk (turtle root space; points near y 0 follow the sand) */
  private setPath(v: Visit, path: number[][]) {
    v.path = path.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    v.wp = v.path.map((p) => {
      const w = v.g.toWorld([p.x, p.y, p.z], new THREE.Vector3());
      if (p.y < 0.2) w.y = this.ctx.world.groundAt(w.x, w.z);
      return w;
    });
    v.cum = [0];
    for (let i = 1; i < v.wp.length; i++) v.cum.push(v.cum[i - 1] + v.wp[i].distanceTo(v.wp[i - 1]));
    v.s = 0;
  }

  /** walk (or stand and breathe); true once he is at the end of his path */
  private walkActor(v: Visit, h: number, go: boolean) {
    const a = v.actor, W = v.wp;
    if (!W.length) return true;
    const total = v.cum[v.cum.length - 1];
    let i = 0;
    for (; i < W.length - 2 && v.s > v.cum[i + 1]; i++);
    const ramp = v.path[i].y > 0.2 !== v.path[i + 1].y > 0.2 || (v.path[i].y > 0.2 && Math.abs(v.path[i].y - v.path[i + 1].y) > 0.3);
    const moving = go && v.s < total - 1e-4;
    if (moving) v.s = Math.min(total, v.s + h * (ramp ? 1.15 : 1.5));
    for (i = 0; i < W.length - 2 && v.s > v.cum[i + 1]; i++);
    const L = Math.max(1e-4, v.cum[i + 1] - v.cum[i]);
    const k = c01((v.s - v.cum[i]) / L);
    const p = _tw.lerpVectors(W[i], W[i + 1], k);
    if (v.path[i].y < 0.2 && v.path[i + 1].y < 0.2) p.y = this.ctx.world.groundAt(p.x, p.z);
    const want = moving ? Math.atan2(W[i + 1].x - W[i].x, W[i + 1].z - W[i].z) : v.s >= total - 1e-4 ? v.standYaw : v.yaw;
    const dy = wrapPi(want - v.yaw);
    v.yaw += Math.sign(dy) * Math.min(Math.abs(dy), 7 * h);
    v.walkAmt = damp(v.walkAmt, moving ? 1 : 0, 6, h);
    v.walkPh += h * 7.2 * v.walkAmt;
    v.breath += h;
    if (!a) return v.s >= total - 1e-4;
    strideVisitor(a, v.walkPh, v.walkAmt, v.breath);
    a.root.position.copy(p);
    a.root.position.y += Math.abs(Math.cos(v.walkPh)) * 0.03 * v.walkAmt;
    a.root.rotation.set(0, v.yaw, 0);
    // footfalls: sand, then hollow planks
    if (v.walkAmt > 0.3 && Math.floor(v.walkPh / Math.PI) !== v.lastStep) {
      v.lastStep = Math.floor(v.walkPh / Math.PI);
      if (v.path[i].y < 0.2 && v.path[i + 1].y < 0.2) {
        this.ctx.sfx('footstep_sand', p, 0.3, 0.9 + rnd.next() * 0.2);
        this.ctx.particles.emit({ pos: { x: p.x, y: p.y + 0.04, z: p.z }, count: 4, spread: 1.0, up: 1.0, life: [0.4, 0.8], size: [0.05, 0.03], sprite: ['grain0', 'grain1', 'grain2'], color: [P.sand0, P.sand1], gravity: 9, ground: true });
      } else this.ctx.sfx('board_land', p, 0.09, 1.9 + rnd.next() * 0.2);
    }
    return v.s >= total - 1e-4;
  }

  /** the follow camera's target while he walks up: behind his shoulder, squaring up on the door */
  private followTarget(v: Visit, pos: THREE.Vector3, look: THREE.Vector3) {
    const g = v.g;
    const sTop = v.cum[3] ?? 0, sI = v.cum[5] ?? 1;
    const k = smoother((v.s - (sTop - 1.2)) / Math.max(0.1, sI - sTop + 1.2));
    const ap = v.actor ? g.root.worldToLocal(_l.copy(v.actor.root.position)) : g.root.worldToLocal(_l.copy(v.wp[0] ?? g.root.position));
    pos.set(mix(3.0, 1.85, k), mix(1.75, 1.6, k), mix(2.2, 0, k)).add(ap);
    look.set(mix(-1.8, -1.6, k), mix(1.15, 1.3, k), mix(-0.3, 0, k)).add(ap);
    g.root.localToWorld(pos);
    g.root.localToWorld(look);
    pos.y = Math.max(pos.y, this.ctx.world.groundAt(pos.x, pos.z) + 0.6);
  }

  private updateEnter(v: Visit, h: number) {
    const g = v.g, rm = g.meta.room ?? {};
    // Ozymandias goes in ahead and opens up
    if (!v.ozGo && v.t > 0.45) {
      v.ozGo = true;
      g.setDoor(true);
      g.riderWalk(true);
    }
    const arrived = this.walkActor(v, h, g.rampDown && v.t > 1.0);
    if (v.skip) return this.enterShop(v);
    const sI = v.cum[5] ?? 0;
    if (v.doorAt < 0 && v.s >= sI - 0.05) {
      v.doorAt = v.t;
      v.from.pos.copy(this.shot.pos);
      v.from.look.copy(this.shot.look);
      v.from.fov = this.shot.fov;
    }
    if (v.doorAt < 0) {
      // over his shoulder up the gangplank, settling in from the porch shot
      this.followTarget(v, _a, _b);
      v.cp.lerp(_a, 1 - Math.exp(-3.2 * h));
      v.cl.lerp(_b, 1 - Math.exp(-4 * h));
      const e = smoother(v.t / 1.8);
      this.shot.pos.lerpVectors(v.base.pos, v.cp, e);
      this.shot.look.lerpVectors(v.base.look, v.cl, e);
      this.shot.fov = mix(v.base.fov, 52, e);
    } else {
      // through the door after him, to the doorway shot of the shop
      const k = smoother((v.t - v.doorAt) / 1.7);
      const pts = [v.from.pos, g.toWorld([2.15, 4.48, 0.1], new THREE.Vector3()), g.toWorld(rm.cam ?? [1.3, 4.38, 0.1], new THREE.Vector3())];
      catmull(pts, k * 2, this.shot.pos);
      this.shot.look.lerpVectors(v.from.look, g.toWorld(rm.look ?? [-0.8, 3.75, -0.35], _c), smoother(k * 1.15));
      this.shot.fov = mix(v.from.fov, 50, k);
      if (k >= 1 && arrived) this.enterShop(v);
    }
    this.handheld(0.6);
  }

  /** in the house: the shop opens (the wares tumble out of his basket onto the rug) */
  private enterShop(v: Visit) {
    const g = v.g, rm = g.meta.room ?? {};
    v.phase = 'shop';
    v.s = v.cum[v.cum.length - 1];
    this.walkActor(v, 0.5, false);
    if (g.riderWalking || !v.ozGo) g.riderAt(true);
    g.setDoor(true);
    if (!g.rampDown) g.setRamp(true);
    g.indoor = true;
    this.indoor = true;
    this.lightAt = g.toWorld(rm.lamp ?? [-0.85, 4.6, 0.15], new THREE.Vector3());
    if (v.skip) {
      // skipped the walk: cut straight to the doorway shot
      g.toWorld(rm.cam ?? [1.3, 4.38, 0.1], this.shot.pos);
      g.toWorld(rm.look ?? [-0.8, 3.75, -0.35], this.shot.look);
      this.shot.fov = 50;
    }
    v.skip = false;
    const wares = this.visitWares ?? v.hooks.stock?.() ?? [];
    this.visitWares = null;
    this.greeted = false; // he says hello again behind his counter
    void this.begin(g.root.position.clone(), 0, wares, g.root.position, g);
  }

  // ---- walking out
  /** the wares are back in his basket: walk out of the door, down the gangplank and onto the board */
  private startExit() {
    const v = this.visit;
    if (!v) return this.finish();
    const g = v.g;
    this.clearWares();
    this.phase = 'visit';
    this.indoor = false;
    g.indoor = false;
    v.phase = 'exit';
    v.t = 0;
    v.outAt = -1;
    v.ozGo = false;
    v.skip = false;
    v.from.pos.copy(this.shot.pos);
    v.from.look.copy(this.shot.look);
    v.from.fov = this.shot.fov;
    const F = g.meta.ramp?.foot ?? [5.35, 0.08, 0.1], T = g.meta.ramp?.top ?? [2.4, 3, 0.1];
    const fl = g.meta.porch?.[1] ?? 3.0, st = g.meta.room?.stand ?? [0.85, fl, -0.95];
    this.setPath(v, [st, [0.92, fl, 0.1], [1.55, fl, 0.1], [T[0], T[1], T[2]], [F[0], F[1] + 0.03, F[2]], [F[0] + 0.75, 0, F[2] + 0.15], [8.1, 0, 2.4]]);
    v.standYaw = v.heading;
    v.cp.copy(this.shot.pos);
    v.cl.copy(this.shot.look);
  }

  private updateExit(v: Visit, h: number) {
    const g = v.g, eng = this.ctx.engine;
    const arrived = this.walkActor(v, h, v.t > 0.45 && v.outAt < 0);
    // Ozymandias follows him out to see him off from the porch
    if (!v.ozGo && v.s > (v.cum[2] ?? 0) + 0.4) {
      v.ozGo = true;
      g.riderWalk(false, () => {
        g.setDoor(false);
        g.wave(2.2);
      });
    }
    if (v.skip && v.outAt < 0) {
      v.s = v.cum[v.cum.length - 1];
      this.walkActor(v, 0.5, false);
      if (g.riderWalking) {
        g.riderAt(false);
        g.setDoor(false);
      }
    }
    if (v.outAt < 0 && (arrived || v.skip)) {
      // back on his board: the camera returns to the saddle
      v.outAt = v.t;
      v.skip = false;
      if (v.actor) {
        v.actor.root.removeFromParent();
        v.actor = null;
      }
      if (v.hooks.hunter) v.hooks.hunter.rig.root.visible = true;
      this.ctx.sfx('board_land', this.hunter ?? g.root.position, 0.4, 1.2);
      this.cam.yaw = v.heading;
      this.ridingPose(this.camHome);
      v.from.pos.copy(this.shot.pos);
      v.from.look.copy(this.shot.look);
      v.from.fov = this.shot.fov;
      eng.letterbox(false, 0.9);
      g.setRamp(false);
    }
    if (v.outAt >= 0) {
      const k = smoother((v.t - v.outAt) / 1.4);
      this.shot.pos.lerpVectors(v.from.pos, this.camHome.pos, k);
      this.shot.look.lerpVectors(v.from.look, this.camHome.look, smoother(k * 1.15));
      this.shot.fov = mix(v.from.fov, this.camHome.fov, k);
      this.handheld(1 - k);
      if (k >= 1) this.endVisit();
      return;
    }
    // out through the door ahead of him, then watch him come out and down the gangplank
    const A = g.toWorld([3.7, 4.4, 1.9], _a);
    const B = g.toWorld([8.9, 2.3, 4.4], _b);
    const ka = smoother(v.t / 1.3);
    const sD = v.cum[2] ?? 0, total = v.cum[v.cum.length - 1];
    const kb = smoother((v.s - sD) / Math.max(0.1, total - sD));
    if (ka < 1) catmull([v.from.pos, g.toWorld([2.2, 4.5, 0.1], new THREE.Vector3()), A.clone()], ka * 2, this.shot.pos);
    else this.shot.pos.lerpVectors(A, B, kb);
    const head = v.actor ? _c.copy(v.actor.root.position).add(_l.set(0, 1.25, 0)) : g.toWorld([1.5, 4.2, 0.1], _c);
    v.cl.lerp(head, 1 - Math.exp(-4 * h));
    this.shot.look.lerpVectors(v.from.look, v.cl, smoother(v.t / 0.9));
    this.shot.fov = mix(v.from.fov, 50, ka);
    this.handheld(0.7);
  }

  // ---- riding on from the porch
  private startBye(v: Visit) {
    v.phase = 'bye';
    v.t = 0;
    v.go = null;
    this.bar.style.display = 'none';
    v.g.wave(2.0);
    this.ridingPose(this.camHome);
    v.from.pos.copy(this.shot.pos);
    v.from.look.copy(this.shot.look);
    v.from.fov = this.shot.fov;
    this.ctx.engine.letterbox(false, 1.2);
  }

  private updateBye(v: Visit, h: number) {
    void h;
    const k = smoother((v.t - 0.7) / 1.6);
    this.orbit(v.from.pos, this.camHome.pos, k, this.shot.pos);
    this.shot.look.copy(v.from.look).lerp(this.camHome.look, smoother(k * 1.2));
    this.shot.fov = mix(v.from.fov, this.camHome.fov, k);
    this.handheld(1 - k);
    if (k >= 1) this.endVisit();
  }

  /** the visit is over (or called off): everything back, the camera in the saddle */
  private endVisit() {
    const v = this.visit;
    if (!v) return;
    this.visit = null;
    const eng = this.ctx.engine, g = v.g;
    if (v.actor) v.actor.root.removeFromParent();
    if (v.hooks.hunter) v.hooks.hunter.rig.root.visible = true;
    for (const ft of v.plaques) ft.dispose();
    if (this.bodies.length) this.clearWares();
    this.clearShelf();
    g.indoor = false;
    g.lookAt = null;
    if (!g.riderWalking) g.setDoor(false);
    g.setRamp(false);
    g.resume(3.5);
    g.armed = false;
    g.awayT = 0;
    this.indoor = false;
    this.lightAt = null;
    this.speechForce = 0;
    this.cam.setCine(null);
    eng.letterbox(false, 0.5);
    this.restoreGrade();
    this.holdLight(0);
    this.clearSpeech();
    this.tip.style.display = 'none';
    this.bar.style.display = 'none';
    eng.input.enabled = true;
    eng.input.setWantLock(true);
    eng.paused = false;
    this.active = false;
    this.her = null;
    this.phase = 'off';
    const d = this.done;
    this.done = null;
    d?.();
  }

  /** pressed T at his gangplank: the same scene as riding up (he turns, Ozymandias greets you, you talk) */
  private visitByKey(g: Turtle, wares: Ware[]) {
    if (g.hidden) {
      this.ctx.toast(VOICE_C.title, '#ffd36b', 'Gobi is dug in. Come back when it is quiet.');
      return Promise.resolve();
    }
    this.visitWares = wares;
    return new Promise<void>((res) => {
      this.done = res;
      this.startArrival(g, { ...(g.hooks ?? {}), stock: () => wares });
    });
  }

  /** where the hunter stands right now (the walking copy of him during a visit) */
  private hunterAt(): THREE.Vector3 | null {
    const a = this.visit?.actor;
    if (a && a.root.parent) return a.root.position;
    return this.hunter;
  }

  /** take the wares and the rug away (the shop is done with them) */
  private clearWares() {
    for (const b of this.bodies) {
      this.group.remove(b.obj);
      (b.obj.children[0] as THREE.Mesh | undefined)?.geometry.dispose();
      b.spot.m.dispose();
    }
    this.bodies = [];
    if (this.rug) this.group.remove(this.rug);
    this.clearShelf();
    this.tip.style.display = 'none';
    this.bar.style.display = 'none';
    this.hovered = null;
  }

  /** the price tags and the hovered ware's card go */
  private clearShelf() {
    for (const t of this.tags) t.dispose();
    this.tags = [];
    this.clearCard();
    this.stall = null;
    this.kbHold = false;
  }

  /** a ware's price tag: today's price, what it does, deal / sold / too dear */
  private inkTag(tag: PriceTag, w: Ware) {
    const price = this.book.price(w);
    tag.set({ price, short: this.shortOf(w), was: price !== w.price ? w.price : null, deal: w.id === this.book.deal, sold: this.book.sold.has(w.id), dear: this.ctx.run.gold < price });
  }

  /** the two or three words on the tag */
  private shortOf(w: Ware) {
    if (w.short) return w.short;
    const g = w.id.startsWith('gear_') ? GEAR[w.id.slice(5) as GearId] : null;
    if (g) return `${SLOT_INFO[g.slot].name} gear`;
    return '';
  }

  /** what a ware means for you now: gear against what you wear, the rest from the ware itself */
  private noteOf(w: Ware): WareNote | null {
    if (w.note) return w.note();
    const g = w.id.startsWith('gear_') ? GEAR[w.id.slice(5) as GearId] : null;
    if (!g) return null;
    const curId = this.worn.get(g.slot) as GearId | undefined;
    const cur = curId ? GEAR[curId] : null;
    if (!cur) return { text: `Your ${SLOT_INFO[g.slot].name.toLowerCase()} slot is empty: a straight gain.`, good: true };
    if (cur.id === g.id) return { text: 'You are already wearing one of these.', bad: true };
    const up = RARITY[g.rarity].rank - RARITY[cur.rarity].rank;
    return { text: `Replaces your ${cur.name} (${RARITY[cur.rarity].name}).`, good: up > 0, bad: up < 0 };
  }

  // ---------------------------------------------------------------- the shop
  /** open at a rug position in front of the merchant; resolves when the player leaves */
  open(rugAt: THREE.Vector3, facing: number, wares: Ware[], merchantPos: THREE.Vector3, _opts?: unknown): Promise<void> {
    const o = _opts as { her?: unknown } | undefined;
    const viaArrival = o && o.her instanceof Tamsin ? o.her : null;
    if (!viaArrival && !this.active && !this.arrival && !this.visit) {
      // the turtle house: you talk to Ozymandias first, then go inside
      const her = this.findHer(rugAt, merchantPos);
      if (her instanceof Turtle) return this.visitByKey(her, wares);
    }
    return this.begin(rugAt, facing, wares, merchantPos, viaArrival);
  }

  private begin(rugAt: THREE.Vector3, facing: number, wares: Ware[], merchantPos: THREE.Vector3, arrivedHer: Merchant | null): Promise<void> {
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
    // ---- where everything goes: rug in front of her, the camera on the customer side
    const C = new THREE.Vector3();
    let yaw: number;
    if (her) {
      const H = her.root.position;
      const a = her.root.rotation.y;
      C.copy(H).add(_a.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(her.rugDist));
      yaw = a + Math.PI;
      this.pivot.copy(H);
      this.fwdAng = a;
    } else {
      C.copy(rugAt);
      yaw = facing;
      this.pivot.copy(merchantPos);
      this.fwdAng = facing + Math.PI;
    }
    const g = this.group;
    this.clearShelf(); // (a visit's tags never outlive it)
    const stallObj = this.indoor && her instanceof Turtle ? her.stallObj : null;
    this.stall = stallObj ? stallModel() : null;
    if (stallObj) {
      // the stall's own frame: its steps are the shelves the wares land on
      stallObj.updateMatrixWorld(true);
      stallObj.getWorldPosition(g.position);
      stallObj.getWorldQuaternion(g.quaternion);
    } else if (this.indoor && her instanceof Turtle) {
      // on the floor of the house, the rug's long side across the doorway view,
      // unrolling from his counter toward the door
      her.toWorld(her.meta.room?.rug ?? [-0.25, 3, -0.3], C);
      g.position.copy(C);
      g.position.y += 0.004;
      g.quaternion.copy(her.root.quaternion).multiply(_q.setFromAxisAngle(UP, -Math.PI / 2));
    } else {
      C.y = ctx.world.groundAt(C.x, C.z);
      g.position.copy(C);
      g.position.y += 0.004;
      const nrm = new THREE.Vector3();
      ctx.world.normal(C.x, C.z, nrm);
      if (nrm.lengthSq() < 0.5 || nrm.y < 0.95) nrm.lerp(UP, 0.6).normalize();
      g.quaternion.setFromUnitVectors(UP, nrm).multiply(_q.setFromAxisAngle(UP, yaw));
    }
    g.updateMatrixWorld(true);
    this.gq.copy(g.quaternion).invert();
    // ---- rug (not under the stall)
    if (!this.rug && !this.stall) {
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
    if (this.rug && !this.stall) {
      g.add(this.rug);
      this.rug.scale.set(1, 1, 0.02); // rolled up; it unrolls toward the customer
      this.ctx.sfx('bandage', C, 0.5, 0.8);
    } else this.rugTop = 0;
    if (her) {
      her.halt = true; // a walking merchant stays put while you shop
      her.faceYaw(null);
    }
    // ---- the wares wait inside her pack
    if (her) {
      her.coax();
      her.lookAt = null;
    }
    this.tumbleAt = Math.max((her ? her.outIn() : 0) + 0.45, 1.0);
    // the stall: up to four wares on each step, the cheap things on the front step; a tag for every
    // slot (a sold ware leaves its SOLD tag behind)
    const S = this.stall;
    const shelf = S ? wares.slice(0, S.slotX.length * 2) : wares;
    const lower = S ? Math.min(S.slotX.length, Math.ceil(shelf.length / 2)) : 0;
    const slotOf = (i: number) => {
      const top = i >= lower;
      const n = top ? shelf.length - lower : lower, k = top ? i - lower : i;
      return { tier: S!.tiers[top ? 1 : 0], x: (k - (n - 1) / 2) * S!.slotStep };
    };
    if (S) {
      const tagMat = (her as Turtle).rig.material;
      shelf.forEach((w, i) => {
        const { tier, x } = slotOf(i);
        const tag = new PriceTag(tagMat);
        tag.root.position.set(x, tier.tackY, tier.tackZ - 0.012); // clear of the lip and the kilim's fold
        g.add(tag.root);
        this.tags.push(tag);
        this.inkTag(tag, w);
        if (this.book.sold.has(w.id)) tag.shown = tag.want = 1;
      });
    }
    const nW = shelf.length;
    let order = 0;
    this.bodies = shelf.flatMap((w, i) => {
      if (S && this.book.sold.has(w.id)) return [];
      const spot = spotMaterial();
      const { obj, he } = itemObject(w.model, spot.m);
      obj.visible = false;
      g.add(obj);
      let slot: THREE.Vector3;
      if (S) {
        const { tier, x } = slotOf(i);
        slot = new THREE.Vector3(x, tier.top + he.y, tier.slotZ);
      } else {
        // indoors: two staggered rows a little toward his counter (they skid toward the door as they land)
        const x = (i - (nW - 1) / 2) * (this.indoor ? Math.min(0.36, 2.0 / Math.max(1, nW - 1)) : 0.42) + (rnd.next() - 0.5) * 0.06;
        const z = (this.indoor ? (i % 2 ? 0.34 : 0.08) : i % 2 ? 0.12 : -0.1) + (rnd.next() - 0.5) * 0.06;
        slot = new THREE.Vector3(x, this.rugTop + he.y, z);
      }
      const I = new THREE.Vector3((he.y * he.y + he.z * he.z) / 3, (he.x * he.x + he.z * he.z) / 3, (he.x * he.x + he.y * he.y) / 3);
      const key = w.model;
      const sound: Body['sound'] = /dagger|shield|charm|coin|dynamite/i.test(key) ? 'metal' : /bottle/i.test(key) ? 'glass' : 'soft';
      const b: Body = {
        ware: w, obj, he, invI: new THREE.Vector3(1 / I.x, 1 / I.y, 1 / I.z), rad: Math.max(he.x, he.y, he.z) * 0.8,
        p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(),
        state: 'wait' as BodyState, t: 0, launch: this.tumbleAt + 0.14 + order * 0.16, slot, rest: slot.clone(),
        still: 0, asleep: false, spin: rnd.next() * 6, landed: false, clack: 0, arc0: new THREE.Vector3(), sound,
        lit: 0, spot, gaze: 0,
        onShelf: false, flyT: 0.7, q0: new THREE.Quaternion().setFromAxisAngle(UP, Math.PI + (rnd.next() - 0.5) * 0.7), land: 0,
        tag: S ? this.tags[i] : null, idx: order++,
      };
      return [b];
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
      // behind his counter: fresh stock the first time this restock, the same shelf after
      const bk = this.book;
      if (this.stall) bk.visits++;
      const line = this.stall && bk.visits === 1 ? rnd.pick(OZ.fresh) : this.stall && bk.sold.size ? rnd.pick(OZ.same) : rnd.pick(this.voice.lines.hello);
      this.pendingLine = { text: line, mood: 'laugh', at: (her ? her.outIn() : 0) + 0.15 };
    }
    if (this.indoor) return Promise.resolve(); // the visit resolves when he is back on his board
    return new Promise((res) => (this.done = res));
  }

  /** her puppet nearest the rug (or, with no hook installed, her rig found in the scene) */
  private findHer(rugAt: THREE.Vector3, merchantPos: THREE.Vector3): Merchant | null {
    this.borrowed = false;
    let best: Merchant | null = null, bd = 10;
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
    if (this.indoor && this.her instanceof Turtle) {
      // inside: from the doorway, him behind his counter, the rug of wares between
      const t = this.her, rm = t.meta.room ?? {};
      t.root.updateMatrixWorld(true); // he may have just been put behind his counter
      t.toWorld(rm.cam ?? [1.3, 4.38, 0.1], this.camMain.pos);
      t.toWorld(rm.look ?? [-0.8, 3.75, -0.35], this.camMain.look);
      const g = this.group, wx = Math.min(this.rugHalf.x, 0.95);
      const S = this.stall;
      const subject = S
        ? [
            // him over the counter, the stall's top step and its wares, the tags under the front lip
            t.framingTop(new THREE.Vector3()).add(_a.set(0, 0.14, 0)),
            g.localToWorld(new THREE.Vector3(-S.halfX, S.tiers[1].top + 0.3, S.tiers[1].slotZ)),
            g.localToWorld(new THREE.Vector3(S.halfX, S.tiers[1].top + 0.3, S.tiers[1].slotZ)),
            // (with room under the tags for the line of type at the foot of the frame)
            g.localToWorld(new THREE.Vector3(-S.halfX * 0.92, S.tiers[0].tackY - 0.22, S.tiers[0].tackZ)),
            g.localToWorld(new THREE.Vector3(S.halfX * 0.92, S.tiers[0].tackY - 0.22, S.tiers[0].tackZ)),
          ]
        : [
            t.framingTop(new THREE.Vector3()).add(_a.set(0, 0.18, 0)),
            g.localToWorld(new THREE.Vector3(-wx, this.rugTop, 0.3)),
            g.localToWorld(new THREE.Vector3(wx, this.rugTop, 0.3)),
            g.localToWorld(new THREE.Vector3(-wx, this.rugTop, -0.12)),
            g.localToWorld(new THREE.Vector3(wx, this.rugTop, -0.12)),
          ];
      this.camMain.fov = this.fitShot(this.camMain.pos, subject, this.camMain.look);
      this.focus.copy(this.camMain.look);
      return;
    }
    const H = this.pivot, a = this.fwdAng;
    const F = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const L = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const rd = this.her ? this.her.rugDist : 1.05;
    const spot = (s: number, k: number, lift: number) => {
      const p = H.clone().addScaledVector(F, rd + 2.4 * k).addScaledVector(L, 2.0 * k * s);
      p.y = Math.max(this.ctx.world.groundAt(p.x, p.z), H.y) + lift;
      return p;
    };
    let pref = 1;
    if (this.hunter) pref = spot(1, 1, 1).distanceToSquared(this.hunter) >= spot(-1, 1, 1).distanceToSquared(this.hunter) ? 1 : -1;
    const head = this.her ? this.her.headPos(new THREE.Vector3()) : H.clone().add(_a.set(0, 1.2, 0));
    head.y = H.y + 1.2;
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
    this.camMain.look.copy(H).addScaledVector(F, rd * 0.45).addScaledVector(L, 0.1 * side);
    this.camMain.look.y = H.y + 0.66;
    // fit her (hat to toes) and the rug inside the letterboxed frame
    // (where the wares land: across the rug, a little toward the customer)
    const g = this.group, wx = Math.min(this.rugHalf.x, 1.05);
    const subject = [
      this.her ? this.her.framingTop(new THREE.Vector3()) : H.clone().add(_a.set(0, 1.65, 0)),
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
    const bk = this.book, n = this.bodies.length;
    const keys = n > 1 ? `click a ware or 1-${n} &nbsp;·&nbsp; click / Enter buys` : 'click to buy';
    const off = bk.haggle === 'won' ? ' &nbsp;<span style="color:#b8f07a">fifteen off today</span>' : '';
    const restock = this.stall ? `<div style="font-size:15px;color:#c9a97c;margin-top:4px">fresh stock after the wave ${bk.nextRestock} boss &nbsp;·&nbsp; right-click shoots</div>` : '<div style="font-size:15px;color:#c9a97c;margin-top:4px">right-click shoots</div>';
    this.bar.innerHTML = touchText(`<span style="color:#ffd36b">${Math.floor(this.ctx.run.gold)} gold</span>${off} &nbsp;·&nbsp; ${keys} &nbsp;·&nbsp; ESC leaves${restock}`);
  }

  dispose() {
    if (this.visit) this.endVisit();
    if (this.arrival) this.abortArrival();
    if (this.active) this.finish();
    for (const b of this.beacons.values()) b.dispose();
    this.beacons.clear();
    for (const u of this.unsub) u();
    this.unsub = [];
    this.tip.remove();
    this.bar.remove();
    this.rugSpot?.m.dispose();
    for (const p of this.puppets.values()) if (p instanceof Turtle) p.dispose();
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
      this.speak(rnd.pick(this.voice.lines.bye), 'laugh');
      this.her.wave(2.0);
    } else this.ctx.toast(this.voice.title, '#ffd36b', rnd.pick(this.voice.lines.bye));
    let i = 0;
    for (const b of this.bodies) {
      if (b.state === 'wait') {
        b.state = 'gone';
        continue;
      }
      if (b.state !== 'free' && b.state !== 'held' && b.state !== 'shelf' && b.state !== 'fly') continue;
      b.obj.scale.setScalar(1);
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
    this.clearShelf();
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
      this.her.halt = false;
      this.her.faceYaw(null);
      // the arrival scene only comes back once he has ridden off and stayed away
      this.her.armed = false;
      this.her.awayT = 0;
    }
    this.her = null;
    this.borrowed = false;
    this.hovered = null;
    this.warm = 0;
    this.indoor = false;
    this.lightAt = null;
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
    if (b.state !== 'held' && b.state !== 'free' && b.state !== 'shelf') return;
    const price = this.book.price(b.ware);
    if (ctx.run.gold < price) {
      ctx.sfx('ui_error', null, 0.8);
      this.speak(rnd.pick(this.voice.lines.poor), 'squinty');
      if (b.onShelf) {
        // it hops on its slot; the tag swings
        b.land = 1;
        b.tag?.kick(1.2);
      } else this.kick(b, _v.set(0, 1.6, 0), null);
      this.her?.shake();
      return;
    }
    if (!b.ware.buy()) {
      ctx.sfx('ui_error', null, 0.8);
      this.speak('Your pockets are full, little bones. Use something first.', 'squinty');
      this.her?.shake();
      return;
    }
    ctx.run.gold -= price;
    this.book.sold.add(b.ware.id);
    if (b.tag) this.inkTag(b.tag, b.ware);
    ctx.sfx('gold_burst', null, 0.8);
    ctx.toast(b.ware.name.toUpperCase(), '#9dff3a', `-${price} gold · into your satchel`);
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
      // the coins are counted across one at a time from his purse into Ozymandias's claws, each with a clink
      const from = this.satchel(new THREE.Vector3());
      const to = her.coinPoint(new THREE.Vector3());
      const T = 0.55, g = 14;
      const vel = to.clone().sub(from).multiplyScalar(1 / T);
      vel.y += 0.5 * g * T;
      const n = Math.min(12, 3 + Math.round(price / 18));
      for (let i = 0; i < n; i++) {
        ctx.particles.emit({ pos: from, count: 1, vel, spread: 0.12, life: [T, T + 0.04], size: [0.11, 0.11], sprite: ['coinspin0', 'coinspin1', 'coinspin2', 'coinspin3'], color: 0xffffff, gravity: g, sizeJitter: 0.1, delay: i * 0.075 });
        ctx.audio.play('pickup_gold', { pos: to, volume: 0.32, pitch: 1.0 + i * 0.035, delay: T + i * 0.075 });
      }
      this.coinsAt = T + n * 0.075;
      this.coinsTo.copy(to);
    }
    const sl = SOLD_LINE[b.ware.id];
    this.speak(rnd.pick(sl && rnd.chance(0.7) ? sl : this.voice.lines.thanks), 'laugh');
    her?.nod();
    for (const o of this.bodies) if (o.tag && o !== b && o.state !== 'sold' && o.state !== 'gone') this.inkTag(o.tag, o.ware); // what you can still afford
    this.updateBar();
  }
  private coinsAt = -1;
  private coinsTo = new THREE.Vector3();

  /** where the hunter keeps his loot (his hip), or just below the lens */
  private satchel(out: THREE.Vector3) {
    const hp = this.hunterAt();
    if (hp) return out.copy(hp).add(_a.set(0, 0.95, 0));
    const cam = this.ctx.camera;
    cam.getWorldDirection(_a);
    return out.copy(cam.position).addScaledVector(_a, 0.7).add(_b.set(0, -0.55, 0));
  }

  /** the top of the merchant's pack, world space */
  private packPoint(out: THREE.Vector3, lateral: number) {
    if (this.her) return this.her.packPoint(out, lateral);
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
    if (this.visit && this.phase === 'visit') return this.updateVisit(h);
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
    this.unrollRug();
    // ---- hover / buy / shoot
    this.hoverLock -= h;
    this.shotCd -= h;
    if (this.phase === 'browse') {
      // a number key picks a ware off the shelf (Enter buys it), the mouse hovers and clicks
      for (let k = 0; k < 9; k++) if (inp.wasPressed('Digit' + (k + 1)) || inp.wasPressed('Numpad' + (k + 1))) this.focusWare(k);
      this.pick();
      if (inp.wasPressed('Mouse2') && this.shotCd <= 0) this.shoot();
      if (this.hovered && inp.wasPressed('Enter')) this.buy(this.hovered);
      else if (this.hovered && inp.wasPressed('Mouse0')) {
        // touch: nothing hovers before the finger lands, so the first tap shows the ware's card, a second buys it
        if (!inp.touchDevice || this.touchPick === this.hovered) this.buy(this.hovered);
        else this.touchPick = this.hovered;
      }
    }
    this.updateCard(h);
    const tagsDown = this.phase === 'leave' && this.pt > 0.55;
    for (const tg of this.tags) tg.update(h, tagsDown ? 0 : tg.want);
    // ---- spotlights, dust in the beams, her commentary
    const hb = this.hovered;
    for (const b of this.bodies) {
      const up = b.state === 'held' || b.state === 'shelf' || (b.state === 'free' && b.landed);
      b.lit = damp(b.lit, up ? (b === hb ? 1 : 0.55) : 0, 3.5, h);
      b.gaze = b === hb && b.state === 'held' ? b.gaze + h : 0;
      if (b.lit > 0.3 && rnd.chance(h * (1.2 + b.lit * 1.6))) {
        const base = b.onShelf ? b.rest.y - b.he.y : this.rugTop;
        const c = this.group.localToWorld(_v.set(b.rest.x + (rnd.next() - 0.5) * 0.24, base + 0.06 + rnd.next() * 0.45, b.rest.z + (rnd.next() - 0.5) * 0.24));
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
    if (this.visit?.actor) this.walkActor(this.visit, h, false); // the hunter, waiting by the rug
    if (this.phase === 'leave' && this.pt > (this.indoor ? 1.5 : 2.0) && (this.bodies.every((b) => b.state === 'gone') || this.pt > 2.6)) {
      if (this.indoor && this.visit) this.startExit();
      else this.finish();
    }
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
      if (this.pt > 0.9 && !this.indoor) {
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
    if (this.indoor) this.shot.pos.lerpVectors(this.camFrom.pos, P1, e);
    else this.orbit(this.camFrom.pos, P1, e, this.shot.pos);
    const el = smoother(this.camK * 1.25);
    this.shot.look.copy(this.camFrom.look).lerp(L1, el);
    this.shot.fov = mix(this.camFrom.fov, fov1, e) - 2.5 * this.punch * this.punch;
    this.handheld(e);
  }

  /** the rug unrolls from the merchant's side toward you, and rolls back up when you leave */
  private unrollRug() {
    const rug = this.rug;
    if (!rug) return;
    const k = this.phase === 'leave' ? 1 - c01((this.pt - 0.75) / 0.5) : c01((this.pt - 0.1) / 0.75);
    const e = Math.max(0.02, Ease.inOutQuad(k));
    const half = this.rugHalf.y + 0.04;
    rug.scale.z = e;
    rug.position.z = half * (1 - e);
    if (e > 0.03 && e < 0.98 && rnd.chance(0.5)) {
      const w = this.group.localToWorld(_v.set((rnd.next() - 0.5) * this.rugHalf.x * 2, 0.05, half * (1 - 2 * e)));
      this.ctx.particles.emit({ pos: { x: w.x, y: w.y, z: w.z }, count: 1, vel: { x: 0, y: 0.3, z: 0 }, spread: 0.4, life: [0.5, 1.0], size: [0.12, 0.35], sprite: ['puff0', 'puff1'], color: [P.sand0, P.sand1], alpha: 0.6, drag: 3, rot: 6, rotSpeed: 1 });
    }
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
    if (this.kbHold) {
      // a number key chose: the mouse takes over again once it moves
      if (Math.hypot(inp.mouseX - this.kbMouse[0], inp.mouseY - this.kbMouse[1]) < 6) return;
      this.kbHold = false;
    }
    let best: Body | null = null, bd = Infinity, curD = Infinity;
    if (this.hoverLock <= 0)
      for (const b of this.bodies) {
        if (!(b.state === 'held' || b.state === 'shelf' || (b.state === 'free' && b.landed))) continue;
        // anchor on where it rests, so lifting it never steals the hover
        _v.set(b.rest.x, b.onShelf ? b.rest.y : this.rugTop + b.he.y, b.rest.z);
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
        } else if (best.state === 'shelf') {
          best.state = 'held';
          best.tag?.kick(0.5);
        }
      }
      this.hovered = best;
    }
  }

  /** number key k: lift the k-th ware on the shelf (the mouse leaves it be until it moves) */
  private focusWare(k: number) {
    const live = this.bodies.filter((b) => b.state === 'shelf' || b.state === 'held' || (b.state === 'free' && b.landed)).sort((a, b) => a.idx - b.idx);
    const b = live[k];
    if (!b) return;
    if (this.hovered && this.hovered !== b && this.hovered.state === 'held') this.drop(this.hovered);
    if (b.state === 'free') {
      b.asleep = false;
      b.rest.copy(b.p);
    }
    b.state = 'held';
    b.tag?.kick(0.5);
    this.hovered = b;
    this.kbHold = true;
    this.kbMouse = [this.input.mouseX, this.input.mouseY];
    this.ctx.sfx('card_hover', null, 0.5);
  }

  private clearCard() {
    for (const f of this.card) {
      f.show(false);
      this.fading.push(f);
    }
    this.card = [];
    this.cardFor = null;
  }

  /**
   * The hovered ware's card, floating beside it in Alagard: its name, what it
   * does, what it means for you (green: a gain; red: a snag), and the price
   * (the deal and the haggle shown, red when you are short).
   */
  private updateCard(h: number) {
    const hb = this.hovered;
    const b = hb && hb.state === 'held' && this.phase === 'browse' ? hb : null;
    if (b !== this.cardFor) {
      this.clearCard();
      this.cardFor = b;
      if (b) this.makeCard(b);
    }
    if (!b || !this.card.length) {
      this.tip.style.display = 'none';
      return;
    }
    const cam = this.ctx.camera;
    const at = this.group.localToWorld(_l.copy(b.rest));
    at.y += 0.12;
    const dist = at.distanceTo(cam.position);
    // on the open side of the ware, a hand's breadth in front of it (toward the lens)
    const nx = _b.copy(at).project(cam).x;
    const side = nx > 0.05 ? -1 : 1;
    const right = _a.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = _c.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const fwd = _w.subVectors(cam.position, at).normalize();
    const wMax = Math.max(...this.card.map((f) => f.mesh.scale.x));
    const totalH = this.card.reduce((a, f) => a + f.mesh.scale.y, 0);
    let y = totalH * 0.5 + 0.02;
    for (const f of this.card) {
      const fh = f.mesh.scale.y;
      f.anchor.copy(at).addScaledVector(fwd, dist * 0.12).addScaledVector(right, side * (0.16 + wMax * 0.5)).addScaledVector(up, y - fh * 0.5);
      y -= fh * 0.92;
      f.update(h, cam);
      f.mesh.position.copy(f.anchor); // pinned in their column (no float bob)
    }
  }

  private makeCard(b: Body) {
    const w = b.ware;
    const cam = this.ctx.camera;
    const at = this.group.localToWorld(_l.copy(b.rest));
    const sz = clamp(at.distanceTo(cam.position) * 0.043, 0.05, 0.12);
    const price = this.book.price(w), gold = Math.floor(this.ctx.run.gold);
    const note = this.noteOf(w);
    let pl = `${price} gold`;
    if (price !== w.price) pl += w.id === this.book.deal ? `  (today's deal, was ${w.price})` : `  (haggled, was ${w.price})`;
    if (gold < price) pl += `  · you have ${gold}`;
    const mk = (text: string, size: number, color: string, glow: string, wrap = 34) => {
      const f = new FloatText3D(text, { size, px: 44, cps: 140, wrap, hdr: 1.15, color, glow });
      f.mesh.renderOrder = 992;
      this.ctx.scene.add(f.mesh);
      return f;
    };
    this.card = [mk(w.name, sz * 1.3, '#ffd36b', '#ff9a40', 26), mk(w.desc, sz, '#fff3d6', '#b07040')];
    if (note) this.card.push(mk(note.text, sz * 0.95, note.good ? '#b8f07a' : note.bad ? '#ff9a7a' : '#e8d6b0', note.good ? '#3a7a20' : note.bad ? '#8a2a18' : '#7a5a30'));
    this.card.push(mk(pl, sz * 1.05, gold < price ? '#ff8a6a' : '#ffd36b', '#a05a20', 44));
  }

  // ---------------------------------------------------------------- rigid bodies
  private launch(b: Body) {
    b.state = this.stall ? 'fly' : 'free';
    b.obj.visible = true;
    const start = this.packPoint(_v, (rnd.next() - 0.5) * 0.3);
    if (this.stall) this.ctx.particles.emit({ pos: { x: start.x, y: start.y, z: start.z }, count: 4, spread: 0.6, up: 0.6, life: [0.3, 0.6], size: [0.012, 0.008], sprite: ['grain0', 'grain1', 'grain2'], color: [P.sand0, P.sand1], gravity: 9 });
    else this.ctx.fx.dust({ x: start.x, y: start.y, z: start.z }, 0.22, P.sand1, 2);
    this.group.worldToLocal(start);
    b.p.copy(start);
    b.arc0.copy(start);
    b.t = 0;
    const T = (this.her instanceof Turtle ? 0.72 : 0.64) + rnd.next() * 0.14; // out of his basket on the counter
    b.flyT = T;
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
    if (this.stall) return stallTopAt(this.stall, x, z) ?? 0; // the stall's steps, else the floorboards
    if (Math.abs(x) <= this.rugHalf.x && Math.abs(z) <= this.rugHalf.y) return this.rugTop;
    if (this.indoor) return 0; // the floorboards
    // off the rug: the real sand, measured from the rug's plane
    const w = this.group.localToWorld(_f.set(x, 0, z));
    return clamp(this.ctx.world.groundAt(w.x, w.z) - w.y, -0.3, 0.4);
  }

  /** an impulse j (m/s, local) at local point at (null: the centre) */
  private kick(b: Body, jIn: THREE.Vector3, at: THREE.Vector3 | null) {
    const j = _kj.copy(jIn);
    if (b.state === 'held' || b.state === 'shelf') {
      if (b.onShelf) b.tag?.kick(1.4);
      b.onShelf = false; // knocked off the stall: it is a loose thing now
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
    if (b.onShelf) {
      b.state = 'shelf';
      b.land = 0.5;
      b.tag?.kick(0.4);
      return;
    }
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
      let sink = 0;
      if (b.state === 'held') {
        // lifted off its slot (or off the rug) and turned slowly in the light
        b.spin += h * 1.25;
        if (b.onShelf) _v.set(b.rest.x, b.rest.y + 0.15 + Math.sin(this.t * 2.3 + b.spin) * 0.01, b.rest.z - 0.05);
        else _v.set(b.rest.x, this.rugTop + 0.36 + Math.sin(this.t * 2.3 + b.spin) * 0.012, b.rest.z);
        b.p.lerp(_v, 1 - Math.exp(-8 * h));
        _q.setFromAxisAngle(UP, b.spin);
        b.q.slerp(_q, 1 - Math.exp(-6 * h));
        b.obj.scale.setScalar(1);
      } else if (b.state === 'fly') {
        // out of his basket on a ballistic arc, tumbling, righting itself over the last stretch to land on its slot
        b.t += h;
        const t = Math.min(b.t, b.flyT);
        b.p.copy(b.arc0).addScaledVector(b.v, t);
        b.p.y -= 0.5 * G * t * t;
        _q.set(b.w.x * h * 0.5, b.w.y * h * 0.5, b.w.z * h * 0.5, 0).multiply(b.q);
        b.q.set(b.q.x + _q.x, b.q.y + _q.y, b.q.z + _q.z, b.q.w + _q.w).normalize();
        const k = smoother((b.t - b.flyT * 0.5) / (b.flyT * 0.5));
        if (k > 0) b.q.slerp(b.q0, k * 0.45);
        if (b.t >= b.flyT) this.land(b);
      } else if (b.state === 'shelf') {
        // standing on its slot; a landing (or a hop when you cannot pay) squashes it into the wood
        b.land = Math.max(0, b.land - h * 3.2);
        b.p.lerp(b.rest, 1 - Math.exp(-14 * h));
        b.q.slerp(b.q0, 1 - Math.exp(-12 * h));
        const sq = Math.sin(b.land * Math.PI) * Math.min(1, b.land * 1.6);
        b.obj.scale.set(1 + 0.13 * sq, 1 - 0.18 * sq, 1 + 0.13 * sq);
        sink = b.he.y * 0.18 * sq;
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
      b.obj.position.y -= sink;
      b.obj.quaternion.copy(b.q);
    }
  }

  /** a ware lands on its slot on the stall: a clack, a puff of dust, its tag drops down and swings */
  private land(b: Body) {
    b.state = 'shelf';
    b.onShelf = true;
    b.landed = true;
    b.land = 1;
    b.p.copy(b.rest);
    b.v.set(0, 0, 0);
    b.w.set(0, 0, 0);
    b.asleep = true;
    if (b.tag) {
      this.inkTag(b.tag, b.ware);
      b.tag.want = 1;
      b.tag.kick(1);
    }
    const wp = this.group.localToWorld(_v.set(b.rest.x, b.rest.y - b.he.y, b.rest.z));
    if (b.sound === 'metal') this.ctx.sfx('shell_casing', wp, 0.32, 0.8);
    else if (b.sound === 'glass') this.ctx.sfx('shell_casing', wp, 0.26, 1.3);
    else this.ctx.sfx('board_land', wp, 0.2, 1.6);
    // a few grains of desert jump off the boards
    this.ctx.particles.emit({ pos: { x: wp.x, y: wp.y + 0.02, z: wp.z }, count: 5, spread: 0.7, up: 0.8, life: [0.3, 0.6], size: [0.012, 0.008], sprite: ['grain0', 'grain1', 'grain2'], color: [P.sand0, P.sand1], gravity: 9 });
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
          const jt = Math.min(vt / kt, (this.indoor ? 0.95 : FRICTION) * jn); // a woven rug on floorboards grips
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
    if (this.stall && b.landed) {
      // knocked off the stall: the room's floor (kept in front of his counter and in shot)
      if (Math.abs(b.p.x) > 0.95) {
        b.p.x = Math.sign(b.p.x) * 0.95;
        b.v.x *= -0.3;
      }
      if (b.p.z < -0.9 || b.p.z > 0.42) {
        b.p.z = clamp(b.p.z, -0.9, 0.42);
        b.v.z *= -0.3;
      }
    } else if (b.landed && b.p.y < this.rugTop + 0.5) {
      const lx = this.rugHalf.x + 0.12, lz = this.rugHalf.y + 0.1;
      if (Math.abs(b.p.x) > lx) {
        b.p.x = Math.sign(b.p.x) * lx;
        b.v.x *= -0.3;
      }
      // (indoors the lens is low in the doorway: keep them back from its near edge, in shot)
      const zMin = this.indoor ? -0.05 : -lz;
      if (b.p.z > lz || b.p.z < zMin) {
        b.p.z = clamp(b.p.z, zMin, lz);
        b.v.z *= -0.3;
      }
    }
  }

  /** wares bump each other (sphere proxies) */
  private collide() {
    const B = this.bodies;
    for (let i = 0; i < B.length; i++) {
      const a = B[i];
      if (a.state !== 'free' && a.state !== 'held' && a.state !== 'shelf') continue;
      for (let j = i + 1; j < B.length; j++) {
        const b = B[j];
        if (b.state !== 'free' && b.state !== 'held' && b.state !== 'shelf') continue;
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
    const live = this.bodies.filter((b) => b.state === 'free' || b.state === 'held' || b.state === 'shelf');
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
    const hp = this.hunterAt();
    if (hp) {
      muzzle.copy(hp).y += 1.25;
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
        const who = her instanceof Turtle && her.rider ? her.rider : her; // indoors only he ducks
        who.onOut = () => {
          if (!this.active || this.her !== her) return;
          this.speak(rnd.pick(this.voice.lines.shot), 'squinty');
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
    if (this.lightAt) L.l.position.copy(this.lightAt);
    else L.l.position.set(H.x + Math.sin(a) * 0.85, H.y + 1.3, H.z + Math.cos(a) * 0.85);
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

/** what the stock can ask about you (for the "what it means for you" line on a ware's card) */
export interface StockYou {
  /** how many of an item you carry, and whether one more fits */
  pockets?(id: ItemId): { have: number; room: boolean };
  /** your health now and at most */
  hp?(): [number, number];
}
/** the words on each consumable's price tag */
const SHORT: Record<string, string> = {
  bandage: 'heals 35%', goldBandage: 'heals 70%, cleanses', dagger: '+40% damage', smoke: 'vanish, +dodge', shield: 'tin shield',
  charm: 'cleanse, untouchable', dynamite: 'six-metre blast', snakeoil: 'speed, fire rate', whiskey: '+25% crit',
};

/** standard stock for the trading post */
export function merchantStock(ctx: Ctx, add: (id: ItemId) => boolean, heal: () => void, card: () => void, you: StockYou = {}): Ware[] {
  const w = ctx.run.wave;
  const scale = 1 + w * 0.03;
  const pool = (Object.keys(ITEMS) as ItemId[]).filter((id) => id !== 'charm' || w > 10);
  const picks: ItemId[] = [];
  while (picks.length < 3) {
    const id = rnd.pick(pool);
    if (!picks.includes(id)) picks.push(id);
  }
  const wares: Ware[] = picks.map((id) => ({
    id, name: ITEMS[id].name, desc: ITEMS[id].desc, price: Math.round(ITEMS[id].price * scale), model: ITEMS[id].model, buy: () => add(id), short: SHORT[id],
    note: () => {
      const p = you.pockets?.(id);
      if (!p) return null;
      if (!p.room) return { text: 'Your pockets are full: use one first.', bad: true };
      return p.have ? { text: `You carry ${p.have}. One more fits.` } : { text: 'Fits in an empty pocket.', good: true };
    },
  }));
  wares.push({
    id: 'heal', name: 'Camel-Milk Tonic', desc: 'Drink it all. Heals to full. Tastes like regret.', price: Math.round(45 * scale), model: 'bottle', buy: () => (heal(), true), short: 'heals to full',
    note: () => {
      const hp = you.hp?.();
      if (!hp) return null;
      const [h, m] = hp;
      return h < m * 0.75 ? { text: `Your health: ${Math.round(h)} of ${Math.round(m)}.`, good: true } : { text: `Your health: ${Math.round(h)} of ${Math.round(m)}. Nearly whole.` };
    },
  });
  wares.push({
    id: 'card', name: 'Fortune Card', desc: 'A sealed upgrade card from the merchant\'s deck. Pick 1 of 3.', price: Math.round(90 * scale), model: 'book', buy: () => (card(), true), short: 'upgrade card',
    note: () => ({ text: 'Three upgrade cards are dealt: keep one, like a rank-up.', good: true }),
  });
  return wares;
}
