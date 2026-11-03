// Twenty-One with Mama Toad, for bank gold, at a keg table beside her rocking
// chair. Sundown sits on the milking stool across from her. Everything is on
// the table: click a stack of clay chips to bet (10, 25 or 50) and she deals;
// click her deck to take a card, click your own cards to stand. Her hole card
// turns over when you stand; she draws to seventeen. A natural pays three to
// two. She has opinions about all of it, out loud.
// The cards are real voxel cards: ivory faces with the rank set in Alagard and
// a sculpted pip, oxblood backs with a cream lattice.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import * as WS from '../../models/props/workshop';
import { loadSave, writeSave } from '../../meta/Save';
import { legIK, LegPose } from '../../anim/playerAnim';
import { damp } from '../../../engine/math/rand';
import { BuildKit, HubHost, HubStation, HeroBubble, hubStats, saveHubStats, safe, geoOf, meshOf, engrave, reach, joint, ease, clamp01, sstep } from './HubKit';
import type { Mode, Pick, View } from './HouseExtras';

const CVS = 1 / 400;
const SUITS = ['hearts', 'diamonds', 'spades', 'clubs'] as const;
type Suit = (typeof SUITS)[number];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const TABLE = new THREE.Vector3(2.2, 0, -0.74);
const SEAT = new THREE.Vector2(1.9, -0.27);

const LINES = {
  greet: ["Sit down, sugar. Mama's feeling lucky.", 'Care for a hand of Twenty-One? Pennies, not promises.', "Pull up the stool. I'll go easy on you. I won't."],
  deal: ['Cut the deck? No? Trusting soul.', 'Here we go.', 'Cards on the table, dear.'],
  natural: ['Twenty-one! Well, butter my biscuit!', 'A natural! Somebody blessed those bones.'],
  bust: ['Oh, sugar. Too greedy by a hair.', 'Over you go. Happens to the best of us.', 'Bust! Should have listened to your Mama.'],
  dealerBust: ['Dagnabbit. Mama went over.', "Well. Don't tell the toadlets."],
  win: ['You take after me, you know.', "Fine. Take it. I'll win it back by supper.", 'Lucky bones.'],
  lose: ['House wins, dear. And this is my house.', 'Better luck next hand, honey.', 'Mama needs new knitting needles.'],
  push: ["A tie. We'll call it a draw and call it supper.", 'Even-steven.'],
  broke: ['No coin, no cards, honey. Go bring home some bounty.'],
  mamaNatural: ['Twenty-one for Mama! Read it and weep.'],
};
const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

/** a suit pip as a 2D signed distance (voxel units, centred), for sculpting into the card face */
function pipD(s: Suit, x: number, y: number, r: number) {
  const c = (cx: number, cy: number, rr: number) => Math.hypot(x - cx, y - cy) - rr;
  /** a heart of size rr pointing down, centred at (0, oy) */
  const heart = (px: number, py: number, rr: number) => Math.min(Math.hypot(px + rr * 0.45, py - rr * 0.25) - rr * 0.55, Math.hypot(px - rr * 0.45, py - rr * 0.25) - rr * 0.55, Math.max(Math.abs(px) - (py + rr) / 1.3, -(py + rr), py - rr * 0.3));
  const stem = Math.max(Math.abs(x) - (r * 0.1 + Math.max(0, -r * 0.35 - y) * 0.5), y + r * 0.35, -r * 1.05 - y);
  switch (s) {
    case 'diamonds':
      return Math.abs(x) / 0.72 + Math.abs(y) - r;
    case 'hearts':
      return heart(x, y, r);
    case 'spades':
      return Math.min(heart(x, -(y - r * 0.12), r * 0.86), stem);
    case 'clubs':
      return Math.min(c(0, r * 0.45, r * 0.4), c(-r * 0.46, -r * 0.05, r * 0.4), c(r * 0.46, -r * 0.05, r * 0.4), c(0, r * 0.08, r * 0.25), stem);
  }
}
const cardCache = new Map<string, THREE.BufferGeometry>();
/** one card (face +Z), ivory with a ruled border, the rank in Alagard top-left and a big pip or court letter */
function cardGeo(rank: string, suit: Suit) {
  const k = rank + suit;
  const hit = cardCache.get(k);
  if (hit) return hit;
  const m = new VoxelModel('card');
  const W = 13, H = 18;
  const red = suit === 'hearts' || suit === 'diamonds';
  const ink = red ? 0xb02a1a : 0x1e1a16;
  for (let x = -W; x < W; x++)
    for (let y = -H; y < H; y++) {
      // rounded corners
      const cx = Math.max(0, Math.abs(x + 0.5) - (W - 2.5)), cy = Math.max(0, Math.abs(y + 0.5) - (H - 2.5));
      if (Math.hypot(cx, cy) > 2.5) continue;
      // back: oxblood with a cream lattice and a border
      const bord = Math.abs(x + 0.5) > W - 2 || Math.abs(y + 0.5) > H - 2;
      const lat = Math.abs(((x + y + 200) % 6)) < 1 || Math.abs(((x - y + 200) % 6)) < 1;
      m.set(x, y, 0, bord ? 0xe8d8b8 : lat ? 0xc8a878 : 0x6a1a14);
      // face
      const rule = Math.abs(Math.abs(x + 0.5) - (W - 2.5)) < 0.5 && Math.abs(y + 0.5) < H - 2 || Math.abs(Math.abs(y + 0.5) - (H - 2.5)) < 0.5 && Math.abs(x + 0.5) < W - 2;
      m.set(x, y, 1, rule ? 0xc8b890 : 0xf2e8d0);
    }
  const court = rank === 'J' || rank === 'Q' || rank === 'K';
  // the big pip (or a small one under the court letter)
  const pr = court ? 3.2 : rank === 'A' ? 7.5 : 5.6;
  const py = court ? -8 : -1;
  for (let x = -W + 2; x < W - 2; x++)
    for (let y = -H + 2; y < H - 2; y++) if (pipD(suit, x + 0.5, y + 0.5 - py, pr) < 0) m.set(x, y, 1, ink);
  // the rank: a big court letter in the middle, the index top-left (typography)
  try {
    if (court) engrave(m, rank, 0, 3, 1, 14, 13, ink);
    engrave(m, rank, -W + (rank === '10' ? 6 : 4.5), H - 6, 1, rank === '10' ? 8 : 5, 6, ink);
    // a little index pip under it
    for (let x = -W + 2; x < -W + 9; x++) for (let y = H - 14; y < H - 8; y++) if (pipD(suit, x + 0.5 - (-W + 5), y + 0.5 - (H - 11), 2.2) < 0) m.set(x, y, 1, ink);
  } catch {
    /* no canvas: the pip carries it */
  }
  const g = buildVoxelGeometry(m, { voxelSize: CVS, pivot: [0, 0, 1] });
  cardCache.set(k, g);
  return g;
}
const value = (r: string) => (r === 'A' ? 11 : r === 'J' || r === 'Q' || r === 'K' ? 10 : +r);
function total(hand: { rank: string }[]) {
  let t = 0, aces = 0;
  for (const c of hand) {
    t += value(c.rank);
    if (c.rank === 'A') aces++;
  }
  while (t > 21 && aces--) t -= 10;
  return t;
}

interface Card {
  rank: string;
  suit: Suit;
  grp: THREE.Group;
  flip: THREE.Group;
  up: boolean;
  /** the deal in flight */
  t: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  yaw: number;
  flipT: number;
}

export class TwentyOne implements Mode {
  id = 'cards';
  done = false;
  private st: HubStation | null = null;
  private table: THREE.Group | null = null;
  private top = 0.6;
  private deck: { rank: string; suit: Suit }[] = [];
  private deckObj = new THREE.Group();
  private chips: { obj: THREE.Mesh; bet: number }[] = [];
  private mine: Card[] = [];
  private hers: Card[] = [];
  private bet = 0;
  private phase: 'bet' | 'deal' | 'play' | 'mama' | 'done' = 'bet';
  private q: { at: number; fn: () => void }[] = [];
  private t = 0;
  private flick = 0;
  private lp: LegPose = { x: 0, z: 0, knee: 0, roll: 0 };
  private tap = 0;
  private sitK = 0;
  private result = '';
  private boardOff = false;

  constructor(private h: HubHost, private bubble: HeroBubble) {}

  build(k: BuildKit) {
    const ts = safe(() => WS.cardTable());
    const yaw = Math.atan2(SEAT.x - TABLE.x, SEAT.y - TABLE.z);
    this.table = k.put(ts, TABLE.x, TABLE.z, yaw, 0, 1, true);
    if (ts) this.top = ts.meta.top;
    if (this.table && ts && this.h.engine.quality.shadows) k.lamp(0xffc070, 0.7, 1.4, 2, new THREE.Vector3(...(ts.meta.candle as number[])).applyMatrix4(this.table.matrixWorld), 0.12);
    const stool = k.put(safe(() => WS.milkStool()), SEAT.x - Math.sin(yaw) * 0.08, SEAT.y - Math.cos(yaw) * 0.08, yaw + 0.3, 0, 1, false);
    // the deck on Mama's side, a stack of backs
    const back = cardGeo('A', 'spades');
    for (let i = 0; i < 6; i++) {
      const m = meshOf(back, sharedVoxelMaterial, i === 5);
      m.rotation.set(Math.PI / 2, 0, Math.sin(i * 1.7) * 0.06);
      m.position.y = i * 0.004;
      this.deckObj.add(m);
    }
    if (this.table) {
      this.deckObj.position.copy(this.local(0.17, -0.06)).setY(this.top + 0.004);
      this.deckObj.rotation.y = yaw + 0.4;
      this.h.scene.add(this.deckObj);
      // the clay chip stacks baked into the table: invisible hit boxes over them (10, 25, 50)
      const box = new THREE.BoxGeometry(0.06, 0.07, 0.06);
      const inv = new THREE.MeshBasicMaterial({ visible: false });
      ([[-9, 8, 10], [-11.5, 4.5, 25], [-7, 11, 50]] as const).forEach(([x, z, bet]) => {
        const o = new THREE.Mesh(box, inv);
        o.position.copy(this.table!.localToWorld(new THREE.Vector3(x / 48, this.top + 0.03, z / 48)));
        this.h.scene.add(o);
        this.chips.push({ obj: o, bet });
      });
    }
    const face = Math.atan2(TABLE.x - SEAT.x, TABLE.z - SEAT.y);
    this.st = k.station({
      id: 'cards', label: 'Card Table', title: 'TWENTY-ONE', short: 'CARDS', sub: "Mama deals, and Mama doesn't lose gracefully", verb: 'Play a hand with Mama',
      stand: SEAT.clone(), face, at: new THREE.Vector3(TABLE.x, this.top, TABLE.z), r: 0.7, objs: [this.table, stool], pose: 'cards',
      via: [new THREE.Vector2(1.7, 0.25)], slot: [-0.86, 0.84, 'left'], surf: this.top,
      shot: { pos: new THREE.Vector3(3.08, 1.46, 0.24), look: new THREE.Vector3(), fov: 52, subject: new THREE.Vector3(TABLE.x + 0.05, 0.8, TABLE.z - 0.1), ndc: [0.0, -0.12] },
    });
  }
  /** a point on the table top in its own frame (+z toward Sundown) */
  private local(x: number, z: number) {
    if (!this.table) return new THREE.Vector3(TABLE.x + x, this.top, TABLE.z + z);
    this.table.updateMatrixWorld(true);
    return this.table.localToWorld(new THREE.Vector3(x, this.top, z));
  }
  greet() {
    if (this.h.mamaCd <= 3) {
      this.h.say(pick(LINES.greet));
      this.h.mamaCd = 14;
    }
  }

  // ======================================================================= the mode
  enter(): Mode | null {
    if (!this.h.arrived) return null;
    this.st = this.h.here;
    this.done = false;
    if (this.phase === 'done' || this.phase === 'bet') this.phase = 'bet';
    this.h.engine.audio.play('card_flip', { volume: 0.5 });
    return this;
  }
  view(): View | null {
    // a two-shot from the side: Sundown on the left, Mama on the right, the cards between them
    const c = this.local(0.0, 0.0);
    return { pos: new THREE.Vector3(2.92, 1.36, -0.08), look: c.add(new THREE.Vector3(0, 0.16, -0.04)), fov: 50 };
  }
  hint() {
    if (this.phase === 'bet' || this.phase === 'done') return `${this.result ? this.result + '   ·   ' : ''}Click a chip stack to bet: red 10 · white 25 · blue 50   ·   Esc: leave the table`;
    if (this.phase === 'play') return `You ${total(this.mine)}   ·   click Mama's deck (H) for a card   ·   click your cards (S) to stand`;
    return `You ${total(this.mine)}`;
  }
  back() {
    if (this.phase === 'deal' || this.phase === 'mama') return false;
    if (this.phase === 'play') {
      // she plays her hand out first
      this.stand();
      return false;
    }
    this.done = true;
    return true;
  }
  picks(): Pick[] {
    const out: Pick[] = [];
    if (this.phase === 'bet' || this.phase === 'done') {
      for (const c of this.chips) out.push({ obj: c.obj, lift: false, tip: () => `Bet ${c.bet} gold (bank ${loadSave().bank})`, click: () => this.start(c.bet) });
    }
    if (this.phase === 'play') {
      out.push({ obj: this.deckObj, lift: false, tip: () => 'Hit me', click: () => this.hit() });
      for (const c of this.mine) out.push({ obj: c.grp, lift: false, tip: () => `Stand on ${total(this.mine)}`, click: () => this.stand() });
    }
    return out;
  }

  // ======================================================================= the game
  private shuffle() {
    this.deck = [];
    for (const s of SUITS) for (const r of RANKS) this.deck.push({ rank: r, suit: s });
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
    this.h.engine.audio.play('card_erupt', { volume: 0.35 });
  }
  private clearTable() {
    for (const c of [...this.mine, ...this.hers]) c.grp.removeFromParent();
    this.mine = [];
    this.hers = [];
  }
  private start(bet: number) {
    const d = loadSave();
    if (d.bank < bet) {
      this.h.say(pick(LINES.broke));
      this.h.engine.audio.play('ui_error', { volume: 0.6 });
      return;
    }
    this.bet = bet;
    d.bank -= bet;
    writeSave(d);
    this.h.updateBank();
    this.h.engine.audio.play('pickup_gold', { volume: 0.6 });
    this.clearTable();
    if (this.deck.length < 15) this.shuffle();
    this.result = '';
    this.phase = 'deal';
    this.t = 0;
    if (Math.random() < 0.5) this.h.say(pick(LINES.deal));
    this.q = [
      { at: 0.3, fn: () => this.deal(true, true) },
      { at: 0.75, fn: () => this.deal(false, true) },
      { at: 1.2, fn: () => this.deal(true, true) },
      { at: 1.65, fn: () => this.deal(false, false) },
      { at: 2.2, fn: () => this.afterDeal() },
    ];
  }
  /** a card off the deck, skimmed from her hand to its spot */
  private deal(toMe: boolean, up: boolean) {
    const c = this.deck.pop()!;
    const flip = new THREE.Group();
    const mesh = meshOf(cardGeo(c.rank, c.suit), sharedVoxelMaterial, false);
    mesh.rotation.x = -Math.PI / 2;
    flip.add(mesh);
    flip.rotation.z = Math.PI; // face down as it leaves the deck
    const grp = new THREE.Group();
    grp.add(flip);
    this.h.scene.add(grp);
    const hand = toMe ? this.mine : this.hers;
    const n = hand.length;
    const to = this.local(-0.08 + n * 0.05, toMe ? 0.13 : -0.13);
    to.y = this.top + 0.004 + n * 0.0025;
    const from = this.deckObj.position.clone().add(new THREE.Vector3(0, 0.04, 0));
    const card: Card = { ...c, grp, flip, up, t: 0, from, to, yaw: (this.table?.rotation.y ?? 0) + (toMe ? 0 : Math.PI) + (Math.random() - 0.5) * 0.16, flipT: up ? 0 : -1 };
    grp.position.copy(from);
    hand.push(card);
    this.flick = 1;
    this.h.engine.audio.play('card_flip', { volume: 0.55, pitch: 0.9 + Math.random() * 0.2 });
  }
  private afterDeal() {
    const me = total(this.mine), her = total(this.hers);
    if (me === 21 || her === 21) {
      this.reveal();
      this.q.push({ at: this.t + 0.8, fn: () => this.settle() });
      this.phase = 'mama';
      return;
    }
    this.phase = 'play';
  }
  private hit() {
    if (this.phase !== 'play') return;
    this.tap = 1;
    this.bubble.say(pick(['Hit me.', 'Another.', 'One more.']));
    this.deal(true, true);
    this.phase = 'deal';
    this.q.push({ at: this.t + 0.55, fn: () => {
      const me = total(this.mine);
      if (me > 21) {
        this.reveal();
        this.phase = 'mama';
        this.q.push({ at: this.t + 0.7, fn: () => this.settle() });
      } else if (me === 21) this.stand();
      else this.phase = 'play';
    } });
  }
  private stand() {
    if (this.phase !== 'play' && this.phase !== 'deal') return;
    this.phase = 'mama';
    if (Math.random() < 0.6) this.bubble.say(pick(['I\'ll stand.', 'Stay.', 'That\'ll do.']));
    this.reveal();
    let at = this.t + 0.8;
    const drawTo = () => {
      if (total(this.hers) < 17) {
        this.deal(false, true);
        at += 0.65;
        this.q.push({ at, fn: drawTo });
      } else this.q.push({ at: at + 0.3, fn: () => this.settle() });
    };
    this.q.push({ at, fn: drawTo });
  }
  private reveal() {
    const hole = this.hers[1];
    if (hole && !hole.up) {
      hole.up = true;
      hole.flipT = 0;
      this.h.engine.audio.play('card_flip', { volume: 0.6, pitch: 0.8 });
    }
  }
  private settle() {
    const me = total(this.mine), her = total(this.hers);
    const myNat = me === 21 && this.mine.length === 2, herNat = her === 21 && this.hers.length === 2;
    let pay = 0;
    let line: string[];
    if (me > 21) {
      line = LINES.bust;
      this.result = `Bust with ${me}`;
    } else if (myNat && !herNat) {
      pay = Math.round(this.bet * 2.5);
      line = LINES.natural;
      this.h.gasp = 1;
      this.result = 'Twenty-one!';
    } else if (herNat && !myNat) {
      line = LINES.mamaNatural;
      this.result = 'Mama has twenty-one';
    } else if (her > 21) {
      pay = this.bet * 2;
      line = LINES.dealerBust;
      this.result = `Mama busts with ${her}`;
    } else if (me > her) {
      pay = this.bet * 2;
      line = LINES.win;
      this.result = `${me} beats ${her}`;
    } else if (me < her) {
      line = LINES.lose;
      this.result = `${her} beats ${me}`;
    } else {
      pay = this.bet;
      line = LINES.push;
      this.result = `Push at ${me}`;
    }
    const net = pay - this.bet;
    if (pay) {
      const d = loadSave();
      d.bank += pay;
      writeSave(d);
      this.h.updateBank();
      this.h.engine.audio.play(net > 0 ? 'gold_burst' : 'pickup_gold', { volume: 0.7 });
    } else this.h.engine.audio.play('sting_negative', { volume: 0.3 });
    this.result += net > 0 ? `   +${net} gold` : net < 0 ? `   ${net} gold` : '';
    const st = hubStats();
    if (net > 0) st.cardsWon++;
    else if (net < 0) st.cardsLost++;
    st.cardsNet += net;
    saveHubStats();
    this.h.say(pick(line));
    this.h.mamaCd = 10;
    this.phase = 'done';
    if (net > 0) this.h.hero?.setExpression('smug');
  }

  // ======================================================================= per frame
  tick(t: number, rdt: number) {
    this.t += rdt;
    // the queue of beats
    this.q.sort((a, b) => a.at - b.at);
    while (this.q.length && this.q[0].at <= this.t) this.q.shift()!.fn();
    // cards in flight, cards turning
    for (const c of [...this.mine, ...this.hers]) {
      if (c.t < 1) {
        c.t = Math.min(1, c.t + rdt / 0.38);
        const e = ease(c.t);
        c.grp.position.lerpVectors(c.from, c.to, e);
        c.grp.position.y += Math.sin(Math.PI * c.t) * 0.12;
        c.grp.rotation.y = c.yaw + (1 - e) * 2.4;
      } else if (c.up && c.flipT >= 0 && c.flipT < 1) {
        c.flipT = Math.min(1, c.flipT + rdt / 0.22);
        c.flip.rotation.z = Math.PI * (1 - ease(c.flipT));
        c.flip.position.y = Math.sin(Math.PI * c.flipT) * 0.03;
      }
      if (c.up && c.t >= 1 && c.flipT < 0) c.flipT = 0;
    }
    // Mama sets her knitting down while she plays, flicks the cards out, and watches the table
    const here = this.h.here.id === 'cards' && this.h.atK > 0.5;
    this.flick = Math.max(0, this.flick - rdt * 4);
    const m = this.h.mama;
    if (m && here) {
      this.h.knitK = Math.min(this.h.knitK, 0.12);
      const n = m.nodes;
      n['fore_r']?.rotateX(-Math.sin(this.flick * Math.PI) * 0.5);
      n['fore_r']?.rotateY(this.flick * 0.3);
      n['head']?.rotateX(0.12);
      n['head']?.rotateY(-0.25);
    }
    this.sitK = damp(this.sitK, here ? 1 : 0, 4, rdt);
    // nobody sits on a stool with a sandboard on his back: it leans on the table leg while he plays
    const seated = this.sitK > 0.4;
    if (seated !== this.boardOff && this.h.hero) {
      this.boardOff = seated;
      for (const k of ['board_back', 'back']) this.h.hero.sockets[k]?.children.forEach((c) => (c.visible = !seated));
    }
    void t;
  }
  update(_t: number, _rdt: number) {
    const inp = this.h.engine.input;
    if (this.phase === 'play') {
      if (inp.wasPressed('KeyH')) this.hit();
      else if (inp.wasPressed('KeyS')) this.stand();
    } else if (this.phase === 'bet' || this.phase === 'done') {
      if (inp.wasPressed('Digit1')) this.start(10);
      else if (inp.wasPressed('Digit2')) this.start(25);
      else if (inp.wasPressed('Digit3')) this.start(50);
    }
  }

  /** seated on the stool: knees up, elbows on the table, a tap of the knuckles to ask for a card */
  poseHero(t: number, _rdt: number) {
    const hero = this.h.hero, spec = this.h.heroSpec;
    const k = Math.min(this.sitK, this.h.atK);
    if (!hero || !spec || k < 0.01) return;
    const n = hero.nodes;
    const hipY = (spec.meta?.hipY as number) ?? 0.67, kneeY = (spec.meta?.kneeY as number) ?? 0.36;
    const seat = 0.43;
    const rootY = (seat - hipY + 0.02) * k + hero.root.position.y * (1 - k);
    hero.root.position.y = rootY;
    hero.root.position.z = -0.04 * k;
    for (const [th, sh, side] of [['thigh_l', 'shin_l', 1], ['thigh_r', 'shin_r', -1]] as const) {
      const T = n[th], S = n[sh];
      if (!T || !S) continue;
      legIK(side * 0.04, -(hipY + rootY) + 0.0, 0.36 + 0.04, hipY - kneeY, kneeY, 0.6, this.lp);
      const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lp.x, 0, this.lp.z));
      const q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lp.knee, 0, this.lp.roll));
      T.quaternion.slerp(q1, k);
      S.quaternion.slerp(q2, k);
    }
    joint(this.h, 'torso', 0.22, 0, 0, k);
    const tbl = this.local(0, 0.2);
    this.tap = Math.max(0, this.tap - 1 / 60 * 3);
    const tapY = Math.abs(Math.sin(this.tap * Math.PI * 3)) * 0.05 * (this.tap > 0 ? 1 : 0);
    reach(this.h, 'r', this.local(-0.12, 0.24).add(new THREE.Vector3(0, 0.02 + tapY, 0)), new THREE.Vector3(-1, -0.6, -0.2), k);
    reach(this.h, 'l', this.local(0.1, 0.27).add(new THREE.Vector3(0, 0.02, 0)), new THREE.Vector3(1, -0.6, -0.2), k);
    const look = this.phase === 'done' || Math.sin(t * 0.4) > 0.6 ? this.h.mamaHead : tbl;
    void look;
    joint(this.h, 'head', 0.25 + Math.sin(t * 0.7) * 0.02, 0, 0, k * 0.6);
    void sstep;
    void clamp01;
  }

  dispose() {
    this.clearTable();
    this.deckObj.removeFromParent();
  }
}

export { geoOf };
