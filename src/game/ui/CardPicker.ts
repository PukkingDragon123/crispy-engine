// Rank-up: a short cinematic (RankUpCine) freezes the run and stages Sundown,
// then physical upgrade cards burst out of the sand in an arch in front of and
// around him, each by its rarity: commons pop up, rares spin up trailing silver
// sparks, epics and better rise on a pillar of light with a gold sheen sweeping
// across (legendaries shake the ground). Hover lifts a card toward you, it
// breathes, its gems kindle and a hinged ledger swings open beside it with the
// full details; right-drag turns a card over; click (or 1–4) claims one: it
// flies into the hero and shatters into light that soaks into him while the
// rest crumble back into sand. R rerolls, B banishes, a click skips the intro.
// Then the world eases out of slow-mo and the run camera takes back over.
// Every card lands with its rarity's sting (a chime per tier, brass and choir at
// the top) and sheds motes in its rarity colour. A learned tarot skill dives into
// the sand and plays its own unlock cinematic (RankUpCine.SkillUnlock); the card
// then flies to its slot on the bar after the stage is released, and the skill
// unseals when it lands. A gamble is decided at the pick (resolveGamble) and
// played out with dice, a coin or a revolver chamber (RankUpCine.GambleShow).
// Each card is a sculpted 3D frame for its rarity carrying a photographed
// vignette of the upgrade (SkillArt, baked a slice per frame while it rises).
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Offer, UpgradeManager } from '../run/Upgrades';
import { RARITY } from '../run/Upgrades';
import { makeSkillCard, SkillCard3D, CARD_W, CARD_H, PANEL_W } from './SkillCards';
import { SkillArt } from './SkillArt';
import { Spring } from '../../engine/Tween';
import type { Input } from '../../engine/Input';
import { damp } from '../../engine/math/rand';
import { RankUpCine, CineHero, LightPillar, SkillUnlock, GambleShow } from './RankUpCine';
import { resolveGamble, GambleOutcome } from '../run/UpgradesExtra';
import { GlyphRings } from '../fx/SerketSpirit';
import type { CameraRig } from '../player/CameraRig';

type Entrance = 'pop' | 'spin' | 'pillar';

interface Card {
  i: number;
  offer: Offer;
  card: SkillCard3D;
  mesh: THREE.Group;
  /** resting spot: world, and stage-camera space (x right, y up, z depth) */
  home: THREE.Vector3;
  homeC: THREE.Vector3;
  homeQ: THREE.Quaternion;
  /** fixed hit plane at the resting spot (hover never flickers while the card lifts away) */
  homeHit: THREE.Mesh;
  start: THREE.Vector3;
  ground: THREE.Vector3;
  base: number;
  entrance: Entrance;
  /** stage time it bursts out of the sand, and how long its entrance takes */
  t0: number;
  dur: number;
  burst: boolean;
  hover: number;
  flip: number; // target flip (0 front, PI back)
  flipCur: number;
  tiltX: number;
  tiltY: number;
  ready: boolean;
  side: 1 | -1;
  panel: Spring;
  panelOpen: boolean;
  pillar: LightPillar | null;
  pillarK: number;
  /** learn-a-skill cards: a ring of 3D hieroglyphs orbits them */
  glyphs: GlyphRings | null;
  fly: { t: number; from: THREE.Vector3; ctrl: THREE.Vector3; to: THREE.Vector3; mode: 'hero' | 'dive' | 'deal' } | null;
  crumble: number;
  crumbleFrom: THREE.Vector3 | null;
}

const PRE = 0.32; // pillar ignites before the card rises
const JADE = 0x8dffd0;
const SAND = [0xf6dfb0, 0xeccb8f, 0xe0b373, 0xcf9a5a];
const GRAIN = ['grain0', 'grain1', 'grain2', 'grain3', 'grain4', 'grain5'];
const PUFF = ['puff0', 'puff1', 'puff2', 'puff3', 'cloud0'];
const sat = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
const sm = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const outCubic = (k: number) => 1 - Math.pow(1 - sat(k), 3);
const outBack = (k: number) => {
  const c1 = 1.9, c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const hintCards = (rerolls: number) => `HOVER for details · CLICK or 1–4 to claim · RIGHT-DRAG to turn · R reroll (${rerolls}) · B banish`;
/** a chime per rarity tier, up a major arpeggio */
const STING = [1, 1.26, 1.5, 2, 2.52, 3];
const PRISM = [0xff8a8a, 0xffe08a, 0x9aff9a, 0x8ad8ff, 0xd8a0ff];
const WIN_COL = 0x8fff6a;
const LOSE_COL = 0xff4a3a;

export interface PickerOpts {
  /** the run camera rig (smooth hand-back after the pick) */
  cam?: CameraRig;
  /** the hunter to stage (root, rig, material, pos) */
  hero?: () => CineHero | null;
}

export class CardPicker {
  active = false;
  cards: Card[] = [];
  group = new THREE.Group();
  private dying: Card[] = [];
  private hitGroup = new THREE.Group();
  private ray = new THREE.Raycaster();
  private hovered: Card | null = null;
  private dragging: Card | null = null;
  private dragX = 0;
  private hint: HTMLDivElement;
  private queue = 0;
  private busy = false;
  private phase: 'idle' | 'show' | 'resolve' = 'idle';
  /** rank numbers announced by 'rankUp' (a request without one is a card reward) */
  private ranks: number[] = [];
  /** vignette photos per upgrade family (cached across picks) */
  private art = new SkillArt();
  private cine: RankUpCine;
  private hero: CineHero | null = null;
  private stageQ = new THREE.Quaternion();
  private stageP = new THREE.Vector3();
  private sx = new THREE.Vector3();
  private sy = new THREE.Vector3();
  private sz = new THREE.Vector3();
  private tanH = 0.466;
  private resolveAt = -1;
  private chosen: Card | null = null;
  private late: (dt: number, rdt: number) => void;
  private offRank: () => void;
  private time = 0;
  /** a tarot skill being learned (its cinematic, then its flight to the bar) */
  private unlock: SkillUnlock | null = null;
  /** a gamble playing out, and its decided outcome */
  private show: GambleShow | null = null;
  private outcome: GambleOutcome | null = null;
  /** real-time delayed calls (rarity stings) */
  private timers: { t: number; fn: () => void }[] = [];
  private heroArt = false;

  constructor(private ctx: Ctx, private up: UpgradeManager, private input: Input, private getHero: () => THREE.Vector3, private opts: PickerOpts = {}) {
    ctx.scene.add(this.group, this.hitGroup);
    this.hint = document.createElement('div');
    this.hint.style.cssText =
      "position:absolute;left:50%;bottom:6vh;transform:translateX(-50%);font-family:'Alagard';font-size:clamp(12px,1.6vw,18px);color:#fff3d6;text-shadow:0 2px 0 #2a1810,0 0 8px rgba(0,0,0,.6);z-index:7;pointer-events:none;display:none;letter-spacing:1px;white-space:nowrap;max-width:96vw;overflow:hidden;text-overflow:ellipsis";
    ctx.engine.overlay.appendChild(this.hint);
    this.cine = new RankUpCine(ctx);
    this.offRank = ctx.events.on('rankUp', (r: number) => this.ranks.push(r));
    // the stage runs after the scene's update (camera, the hero's visibility, the stage's own particles)
    this.late = (_dt, rdt) => this.lateUpdate(rdt);
    ctx.engine.onAfterUpdate.push(this.late);
  }

  dispose() {
    this.hint.remove();
    // a skill still in flight unseals now
    if (this.unlock) {
      this.unlock.finishNow();
      this.unlock.dispose();
      this.unlock = null;
    }
    this.up.deferLearn.clear();
    this.show?.dispose();
    this.show = null;
    for (const c of [...this.cards, ...this.dying]) this.kill(c);
    this.cards = [];
    this.dying = [];
    this.art.dispose();
    this.cine.dispose();
    this.offRank();
    const l = this.ctx.engine.onAfterUpdate;
    const i = l.indexOf(this.late);
    if (i >= 0) l.splice(i, 1);
    this.group.removeFromParent();
    this.hitGroup.removeFromParent();
  }

  /** queue a pick (multiple rank-ups) */
  request() {
    this.queue++;
  }

  private heroNow(): CineHero | null {
    const h = this.opts.hero?.() ?? ((this.ctx.engine.current as any)?.player as CineHero | undefined) ?? null;
    return h && h.root && h.rig && h.material && h.pos ? h : null;
  }

  private camRig(): CameraRig | null {
    return this.opts.cam ?? ((this.ctx.engine.current as any)?.camRig as CameraRig | undefined) ?? null;
  }

  // ---------------------------------------------------------------- flow

  private begin() {
    this.queue--;
    const rank = this.ranks.length ? this.ranks.shift()! : null;
    const n = this.ctx.run && (this.up as any).stats?.get?.('luck') >= 10 ? 4 : 3;
    const offers = this.up.roll(n);
    if (!offers.length) {
      if (this.active) this.release();
      return;
    }
    this.busy = true;
    const eng = this.ctx.engine;
    let tCards: number;
    if (!this.active) {
      this.active = true;
      eng.paused = true;
      eng.audio.setMuffle(0.4);
      eng.input.setWantLock(false);
      this.hero = this.heroNow();
      if (this.hero && !this.heroArt) {
        // the tarot dioramas show the player's own Sundown and revolver
        this.heroArt = true;
        const spec = this.hero.rig.geo.spec;
        this.art.setHero(spec, spec.name + ':player');
        this.art.setGun(((this.hero as any).gun?.geo?.spec as any) ?? null);
      }
      tCards = this.cine.begin(this.hero, rank);
      this.stage();
    } else tCards = this.cine.again(rank);
    this.spawn(offers, tCards);
    this.phase = 'show';
    this.hint.textContent = 'CLICK to skip';
    this.hint.style.display = 'block';
  }

  /** the card frame: the stage camera's basis */
  private stage() {
    const B = this.cine.B;
    RankUpCine.quatOf(B, this.stageQ);
    this.stageP.copy(B.pos);
    this.sx.set(1, 0, 0).applyQuaternion(this.stageQ);
    this.sy.set(0, 1, 0).applyQuaternion(this.stageQ);
    this.sz.set(0, 0, -1).applyQuaternion(this.stageQ);
    this.tanH = Math.tan(THREE.MathUtils.degToRad(B.fov / 2));
  }

  private toWorld(c: THREE.Vector3, out = new THREE.Vector3()) {
    return out.copy(this.stageP).addScaledVector(this.sx, c.x).addScaledVector(this.sy, c.y).addScaledVector(this.sz, c.z);
  }

  /** an arch of cards over the hero's head, wrapping toward the viewer at the ends */
  private layout(n: number) {
    const eng = this.ctx.engine;
    const asp = eng.width / eng.height;
    const tanH = this.tanH;
    const sx = CARD_W * 1.38;
    let depth = 2.75, sc = 1;
    const need = ((n - 1) / 2) * sx + CARD_W / 2 + 0.12;
    if (need > depth * tanH * asp) depth = Math.min(3.5, need / (tanH * asp));
    const hw = depth * tanH * asp;
    if (need > hw) sc = hw / need;
    const hh = depth * tanH;
    const staged = !!this.hero;
    const out: { c: THREE.Vector3; roll: number; yaw: number }[] = [];
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
      const z = depth - 0.22 * u * u;
      let y = staged ? hh * (0.53 - 0.11 * u * u) : -hh * 0.02;
      y = Math.min(y, hh * 0.97 - (CARD_H * sc) / 2);
      out.push({ c: new THREE.Vector3((i - (n - 1) / 2) * sx * sc, y, z), roll: staged ? -u * 0.08 : 0, yaw: -u * 0.15 });
    }
    return { cards: out, sc };
  }

  private spawn(offers: Offer[], tCards: number) {
    const ctx = this.ctx;
    const L = this.layout(offers.length);
    this.art.request(offers.map((o) => o.def));
    // a skill card's tarot is photographed now so it can burn in if it is chosen
    if (this.hero) this.art.requestKeys(offers.filter((o) => o.def.learn).map((o) => 'tarot:' + o.def.learn));
    this.cards = offers.map((o, i) => {
      const rows = this.up.preview(o);
      const card3 = makeSkillCard(o, rows, { rows, lv: (id) => this.up.lv(id) });
      const mesh = card3.group;
      const S = L.cards[i];
      const home = this.toWorld(S.c);
      const homeQ = this.stageQ.clone().multiply(_q.setFromEuler(_e.set(0, S.yaw, S.roll)));
      const gy = ctx.world.groundAt(home.x, home.z);
      const ground = new THREE.Vector3(home.x, gy, home.z);
      const start = home.clone();
      start.y = Math.min(gy - 0.75, home.y - 1.8);
      mesh.position.copy(start);
      mesh.quaternion.copy(homeQ);
      mesh.scale.setScalar(L.sc);
      mesh.visible = false;
      this.group.add(mesh);
      const homeHit = new THREE.Mesh(card3.hit.geometry, card3.hit.material);
      homeHit.position.copy(home);
      homeHit.quaternion.copy(homeQ);
      homeHit.scale.setScalar(L.sc * 1.04);
      this.hitGroup.add(homeHit);
      homeHit.updateMatrixWorld(true);
      const r = o.def.rarity;
      const learn = !!o.def.learn;
      // a new skill is a big moment: it always rises on Serket's jade light
      const entrance: Entrance = learn ? 'pillar' : r === 'common' || r === 'uncommon' ? 'pop' : r === 'rare' ? 'spin' : 'pillar';
      const dur = entrance === 'pop' ? 0.55 : entrance === 'spin' ? 0.85 : PRE + 1.0;
      const card: Card = {
        i,
        offer: o,
        card: card3,
        mesh,
        home,
        homeC: S.c.clone(),
        homeQ,
        homeHit,
        start,
        ground,
        base: L.sc,
        entrance,
        t0: tCards + i * 0.16 - (entrance === 'pillar' ? PRE * 0.5 : 0),
        dur,
        burst: false,
        hover: 0,
        flip: 0,
        flipCur: 0,
        tiltX: 0,
        tiltY: 0,
        ready: false,
        side: S.c.x < -0.02 ? -1 : 1,
        panel: new Spring(0, 170, 17),
        panelOpen: false,
        pillar: entrance === 'pillar' ? new LightPillar(this.group, ground, home.y - gy + 1.4, learn ? JADE : RARITY[r].hex, 1.25 * L.sc) : null,
        pillarK: 0,
        glyphs: learn ? new GlyphRings(this.group, [{ radius: 0.6 * L.sc, y: 0, count: 12, speed: 1.1, tilt: [0.32, 0.06] }], 2.0) : null,
        fly: null,
        crumble: -1,
        crumbleFrom: null,
      };
      card3.onPip = (at, k) => {
        this.cine.p.emit({ pos: at, count: 12, spread: 1.4, life: [0.25, 0.6], size: [0.07, 0.015], sprite: ['spark', 'star4'], additive: true, color: [RARITY[r].hex, 0xffffff], drag: 3 });
        ctx.sfx('gem_chime', at, 0.45, 1 + k * 0.08);
      };
      return card;
    });
  }

  private kill(c: Card) {
    c.card.dispose();
    c.pillar?.dispose();
    c.glyphs?.dispose();
    c.homeHit.removeFromParent();
  }

  /** claim a card: it flies into the hero; the rest crumble back into sand */
  private pick(card: Card) {
    if (this.phase !== 'show') return;
    this.phase = 'resolve';
    this.hint.style.display = 'none';
    this.hovered = null;
    this.chosen = card;
    const def = card.offer.def;
    const cine = this.cine;
    let to: THREE.Vector3;
    let mode: 'hero' | 'dive' | 'deal' = 'hero';
    if (def.gamble) {
      // decided now; the props will play exactly this (with no hero on stage it simply resolves)
      this.outcome = resolveGamble(card.offer, this.up, this.ctx, this.heroNow() ?? (this.ctx.engine.current as any)?.player);
    }
    if (def.gamble && this.hero) {
      mode = 'deal';
      to = cine.H.clone().addScaledVector(_v.copy(cine.B.pos).sub(cine.H).setY(0).normalize(), 1.0).add(new THREE.Vector3(0, cine.heroTop * 0.75, 0));
    } else if (def.learn && this.hero) {
      // a new skill: the card dives into the sand where its tarot will rise
      mode = 'dive';
      to = SkillUnlock.spot(cine, this.ctx.world.groundAt).add(new THREE.Vector3(0, -0.35, 0));
    } else to = this.hero ? cine.heroChest() : this.getHero().clone().add(new THREE.Vector3(0, 1.1, 0));
    const from = card.mesh.position.clone();
    const ctrl = from.clone().lerp(to, 0.4).addScaledVector(this.sy, mode === 'dive' ? 0.6 : 0.9);
    card.fly = { t: 0, from, ctrl, to, mode };
    card.card.setPanel(0, card.side);
    this.ctx.sfx('card_pick', from, 0.9);
    if (mode === 'deal') this.ctx.sfx('rev_spin', from, 0.35, 1.4);
    this.cine.gaze = card.mesh.position;
    for (const c of this.cards) if (c !== card) this.crumble(c);
    this.cards = [card];
    for (const c of this.dying) c.homeHit.removeFromParent();
  }

  private crumble(c: Card) {
    c.crumble = 0;
    c.crumbleFrom = c.mesh.position.clone();
    c.card.setPanel(0, c.side);
    c.homeHit.removeFromParent();
    this.dying.push(c);
    this.ctx.sfx('sand_burst', c.mesh.position, 0.4, 1.3);
  }

  /** the flight is over and the light is in him: apply, then the next pick or back to the run */
  private finish(card: Card) {
    this.kill(card);
    this.cards = [];
    this.chosen = null;
    this.cine.gaze = null;
    const more = this.queue > 0;
    if (!more) this.release();
    const picked = card.offer;
    const lv = this.up.apply(picked.def.id);
    const o = this.outcome;
    if (o) this.ctx.toast(o.title, o.win ? '#9dff5a' : '#ff6a4a', o.line);
    else this.ctx.toast(picked.def.name.toUpperCase(), RARITY[picked.def.rarity].color, lv > 1 ? `Level ${lv}` : picked.def.cat === 'evolution' ? 'EVOLVED!' : 'Acquired');
    this.ctx.events.emit('upgradePicked', picked.def.id, lv);
    this.show?.dispose();
    this.show = null;
    this.outcome = null;
    this.busy = false;
    if (more) this.begin();
  }

  /** the unlock show is over: learn (deferred until the card lands), release the stage, send the card to the bar */
  private finishUnlock(card: Card) {
    const u = this.unlock!;
    this.kill(card);
    this.cards = [];
    this.chosen = null;
    this.cine.gaze = null;
    const id = card.offer.def.id;
    this.up.deferLearn.add(id);
    const lv = this.up.apply(id);
    this.ctx.events.emit('upgradePicked', id, lv);
    this.release();
    u.onLand = () => {
      // the card is in its slot: the skill unseals (UpgradeEffects learns it next frame) and the bar card turns face up
      this.up.deferLearn.delete(id);
      this.busy = false;
    };
    u.release();
  }

  /** a card has landed: its rarity's sting and a burst of its light */
  private sting(c: Card) {
    const def = c.offer.def;
    const R = RARITY[def.rarity];
    const at = c.mesh.position.clone();
    const ctx = this.ctx;
    const n = R.rank + 1;
    const low = def.curse ? 0.84 : 1;
    for (let i = 0; i < n; i++) this.later(i * 0.075, () => ctx.sfx('gem_chime', at, 0.3 + 0.05 * R.rank, STING[i] * low));
    if (R.rank >= 3) ctx.sfx(def.curse ? 'sting_negative' : 'sting_positive', at, 0.3 + 0.12 * (R.rank - 3), R.rank >= 5 ? 1.12 : 1);
    if (R.rank >= 4) this.later(0.12, () => ctx.sfx('loot_reveal', at, 0.45 + 0.1 * (R.rank - 4)));
    if (R.rank >= 5) this.later(0.2, () => ctx.sfx('divine_whisper', at, 0.6, 1.1));
    if (def.gamble) this.later(0.05, () => ctx.sfx(def.gamble === 'roulette' ? 'rev_spin' : 'pickup_gold', at, 0.4, 1.25));
    const col = R.rank >= 5 ? PRISM : [R.glow, 0xffffff];
    this.cine.p.emit({ pos: at, count: 6 + R.rank * 7, spread: 1.4 + R.rank * 0.45, life: [0.3, 0.75], size: [0.07, 0.015], sprite: ['spark', 'star4'], additive: true, color: col, drag: 3 });
  }

  private later(t: number, fn: () => void) {
    if (t <= 0) fn();
    else this.timers.push({ t, fn });
  }

  /** world time eases back in and the run camera blends home from the last stage shot */
  private release() {
    const eng = this.ctx.engine;
    this.active = false;
    this.phase = 'idle';
    this.hint.style.display = 'none';
    eng.paused = false;
    eng.timeScale = 0.1;
    eng.slowMo(1, 2.4);
    eng.audio.setMuffle(0);
    eng.input.setWantLock(true);
    const rig = this.camRig();
    if (rig && this.cine.alive && this.hero) {
      const p = this.cine.pose();
      rig.fov = p.fov;
      rig.setCine({ pos: p.pos.clone(), look: p.look.clone(), fov: p.fov }, false);
      rig.setCine(null);
    }
    this.cine.release();
  }

  // ---------------------------------------------------------------- per frame

  update(rdt: number) {
    if (!this.busy && this.queue > 0) this.begin();
    if (!this.active) return;
    this.time += rdt;
    const ctx = this.ctx;
    const inp = this.input;
    const cine = this.cine;
    const T = cine.t;
    // develop the vignette photos a slice per frame; each card fades its art in when ready
    this.art.step(ctx.engine.renderer, 9);
    for (const c of [...this.cards, ...this.dying]) {
      if (!c.card.hasArt) c.card.setArt(this.art.texture(c.offer.def));
      c.card.update(rdt, c.hover);
    }
    this.animateDying(rdt);
    if (this.phase === 'resolve') {
      if (inp.wasPressed('Mouse0') || inp.wasPressed('Space') || inp.wasPressed('Enter')) {
        this.unlock?.skip();
        this.show?.skip();
      }
      this.animateFly(rdt);
      return;
    }
    // ---- skipping: a click (or space / enter) cuts the intro, a second one lands the cards
    const skipKey = inp.wasPressed('Mouse0') || inp.wasPressed('Space') || inp.wasPressed('Enter');
    if (skipKey && !cine.inCards) {
      const t1 = cine.skip();
      this.cards.forEach((c, i) => (c.t0 = t1 + i * 0.08));
      return;
    }
    const allReady = this.cards.every((c) => c.ready);
    if (skipKey && !allReady && this.cards.some((c) => c.burst)) {
      for (const c of this.cards) c.t0 = Math.min(c.t0, T - c.dur - 0.01);
      return;
    }
    if (cine.inCards) {
      const ht = hintCards(this.up.rerolls);
      if (this.hint.textContent !== ht) this.hint.textContent = ht;
    }
    // keyboard picks
    for (let i = 0; i < this.cards.length; i++) if (inp.wasPressed('Digit' + (i + 1)) && allReady) return this.pick(this.cards[i]);
    if (inp.wasPressed('KeyR') && this.up.rerolls > 0 && allReady) {
      this.up.rerolls--;
      ctx.toast('REROLL', '#c9a97c', `${this.up.rerolls} left`);
      const n = this.cards.length;
      for (const c of this.cards) this.crumble(c);
      this.cards = [];
      this.hovered = null;
      const offers = this.up.roll(n);
      if (offers.length) this.spawn(offers, T + 0.3);
      else this.release();
      return;
    }
    // ---- hover: by each card's fixed resting spot, so a card lifting toward you (and its open
    // ledger, which may cover a neighbour) never steals or flickers the hover
    this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), ctx.camera);
    const targets: THREE.Object3D[] = [];
    for (const c of this.cards) if (c.ready) targets.push(c.homeHit);
    const hits = this.ray.intersectObjects(targets, false);
    const top = hits[0]?.object;
    const h = top ? (this.cards.find((c) => c.homeHit === top) ?? null) : null;
    if (h !== this.hovered) {
      if (h) ctx.sfx('card_hover', null, 0.5);
      this.hovered = h;
    }
    if (inp.wasPressed('KeyB') && this.hovered) {
      this.up.banished.add(this.hovered.offer.def.id);
      ctx.toast('BANISHED', '#ff8a6a', this.hovered.offer.def.name);
    }
    if (inp.wasPressed('Mouse2') && h) {
      this.dragging = h;
      this.dragX = inp.mouseX;
      h.flip = h.flip > Math.PI / 2 ? 0 : Math.PI;
      ctx.sfx('card_flip', null, 0.6);
    }
    if (!inp.isDown('Mouse2')) this.dragging = null;
    if (this.dragging) {
      const dx = inp.mouseX - this.dragX;
      this.dragging.flipCur += dx * 0.012;
      this.dragging.flip = this.dragging.flipCur;
      this.dragX = inp.mouseX;
    }
    if (inp.wasPressed('Mouse0') && h && h.ready) return this.pick(h);
    // the head follows the hovered card
    cine.gaze = this.hovered ? this.hovered.mesh.position : null;
    this.animate(rdt, hits[0] && h ? hits[0].point : null);
  }

  /** where the hovered card (and its open ledger) comes to rest: closer, readable, inside the frame */
  private focusC(c: Card, out: THREE.Vector3) {
    const eng = this.ctx.engine;
    const asp = eng.width / eng.height;
    const tanH = this.tanH;
    const s = c.base * 1.06;
    // close enough that the ledger's body text is ~15 px tall, never so close the card leaves the frame
    const dText = (eng.height * 0.036) / (2 * 15 * tanH);
    const dMin = (CARD_H * s) / (0.92 * 2 * tanH);
    let d = Math.max(dMin, Math.min(c.homeC.z - 0.4, dText));
    const pairW = (CARD_W + 0.03 + PANEL_W) * s;
    if (pairW / 2 + 0.05 > d * tanH * asp) d = (pairW / 2 + 0.05) / (tanH * asp);
    const hw = d * tanH * asp, hh = d * tanH;
    let x = (c.homeC.x * d) / c.homeC.z, y = (c.homeC.y * d) / c.homeC.z;
    const cw2 = (CARD_W * s) / 2, pw = (0.03 + PANEL_W) * s, m = 0.04;
    const hi = x + cw2 + (c.side > 0 ? pw : 0);
    if (hi > hw - m) x -= hi - (hw - m);
    const lo = x - cw2 - (c.side < 0 ? pw : 0);
    if (lo < -hw + m) x += -hw + m - lo;
    const ch2 = (CARD_H * s) / 2;
    if (y + ch2 > hh - m) y = hh - m - ch2;
    if (y - ch2 < -hh + m) y = -hh + m + ch2;
    return out.set(x, y, d);
  }

  private animate(rdt: number, hitPoint: THREE.Vector3 | null) {
    const ctx = this.ctx;
    const cine = this.cine;
    const T = cine.t;
    const p = cine.p;
    for (const c of this.cards) {
      const m = c.mesh;
      const lt = T - c.t0;
      if (!c.ready) {
        if (lt < 0) continue;
        const r = c.offer.def.rarity;
        if (!c.burst) {
          c.burst = true;
          m.visible = true;
          const g = c.ground;
          p.emit({ pos: g, count: 22, spread: 3.5, up: 5, life: [0.5, 1.1], size: [0.07, 0.04], sprite: GRAIN, color: SAND, gravity: 11, drag: 1, ground: true, bounce: 0.15 });
          p.emit({ pos: g, count: 5, spread: 1.8, up: 1.2, life: [0.8, 1.6], size: [0.5, 1.3], sprite: PUFF, color: SAND, alpha: 0.75, drag: 2.4, rot: 6, rotSpeed: 0.7, jitter: 0.3 });
          ctx.sfx('card_erupt', g, 0.8, 0.95 + c.i * 0.05);
          if (c.entrance === 'spin') ctx.sfx('trick_spin', g, 0.5, 1.1);
          if (c.entrance === 'pillar') {
            ctx.sfx('divine_chime', g, 0.8);
            ctx.sfx('loot_reveal', g, 0.7);
          }
          if (c.offer.def.learn) ctx.sfx('divine_power', g, 0.7, 1.1);
          if (r === 'legendary' || r === 'mythic') {
            cine.kick(0.5);
            ctx.sfx('quake_rumble', g, 0.8);
            p.emit({ pos: g, count: 1, life: [0.55, 0.55], size: [0.5, 4.2], sprite: 'ring', additive: true, color: RARITY[r].hex, sizeJitter: 0 });
            for (let k = 0; k < 18; k++) {
              const a = (k / 18) * Math.PI * 2;
              p.emit({ pos: { x: g.x + Math.cos(a) * 0.6, y: g.y + 0.1, z: g.z + Math.sin(a) * 0.6 }, count: 1, vel: { x: Math.cos(a) * 4, y: 1.5, z: Math.sin(a) * 4 }, spread: 0.8, life: [0.6, 1.2], size: [0.4, 1.3], sprite: PUFF, color: SAND, alpha: 0.7, drag: 2.2, rot: 6, rotSpeed: 0.6 });
            }
          }
        }
        const pre = c.entrance === 'pillar' ? PRE : 0;
        const u = sat((lt - pre) / (c.dur - pre));
        let flipCur = 0;
        if (c.entrance === 'pop') {
          m.position.lerpVectors(c.start, c.home, outBack(u));
          flipCur = Math.PI * 2 * (1 - outCubic(u));
        } else if (c.entrance === 'spin') {
          m.position.lerpVectors(c.start, c.home, outCubic(u));
          m.position.addScaledVector(this.sy, Math.sin(u * Math.PI) * 0.25);
          flipCur = Math.PI * 4 * Math.pow(1 - u, 2.4);
          // silver sparks fly off the spinning edges
          if (u < 0.95)
            for (let k = 0; k < 3; k++) {
              _v.set((Math.random() < 0.5 ? -0.5 : 0.5) * CARD_W, (Math.random() - 0.5) * CARD_H, 0);
              m.localToWorld(_v);
              p.emit({ pos: _v, count: 1, spread: 2.2, life: [0.2, 0.5], size: [0.06, 0.01], sprite: ['spark', 'star4'], additive: true, color: [0xe6eeff, 0xffffff, 0xb8c8e8], drag: 3, gravity: 2 });
            }
          if (u > 0.55 && u < 1) c.card.setSheen(-0.9 + 1.8 * sat((u - 0.55) / 0.45));
        } else {
          // the pillar ignites first, then the card rises slowly through it
          c.pillarK = Math.min(1, lt / PRE);
          m.position.lerpVectors(c.start, c.home, sm(u));
          flipCur = Math.sin(u * Math.PI) * 0.25;
          c.card.setSheen(u < 0.4 ? -9 : -0.95 + 1.9 * sat((u - 0.4) / 0.6));
          if (Math.random() < 0.7) {
            const a = Math.random() * Math.PI * 2;
            p.emit({ pos: { x: c.ground.x + Math.cos(a) * 0.25, y: c.ground.y + 0.1, z: c.ground.z + Math.sin(a) * 0.25 }, count: 1, vel: { x: 0, y: 3 + Math.random() * 2, z: 0 }, spread: 0.3, life: [0.6, 1.1], size: [0.08, 0.02], sprite: ['star4', 'spark', 'glow8'], additive: true, color: [RARITY[r].hex, 0xfff6d0], drag: 0.5 });
          }
        }
        // sand pours off the card as it breaks the surface
        if (u < 0.6 && Math.random() < 0.9) {
          _v.set((Math.random() - 0.5) * CARD_W, -CARD_H * 0.5, 0);
          m.localToWorld(_v);
          p.emit({ pos: _v, count: 2, vel: { x: 0, y: -0.5, z: 0 }, spread: 0.6, life: [0.5, 0.9], size: [0.05, 0.03], sprite: GRAIN, color: SAND, gravity: 9, drag: 0.6, ground: true, bounce: 0.1 });
        }
        c.flipCur = flipCur;
        m.quaternion.copy(c.homeQ);
        m.rotateY(c.flipCur);
        if (u >= 1) {
          c.ready = true;
          c.flipCur = 0;
          c.card.setSheen(-9);
          c.card.fillPips();
          this.sting(c);
          if (c.entrance === 'spin') ctx.sfx('gem_chime', m.position, 0.5, 1.2);
        }
        continue;
      }
      // the pillar dies down once the card is home
      if (c.pillar) c.pillarK = Math.max(0, c.pillarK - rdt * 1.6);
      // it sheds motes of its rarity's light off the frame (more the rarer it is)
      {
        const R = RARITY[c.offer.def.rarity];
        if (Math.random() < [0.7, 1.8, 3.2, 5, 8, 12][R.rank] * (1 + c.hover) * rdt) {
          const e = Math.random() * 4;
          _v.set(e < 2 ? (e < 1 ? -0.5 : 0.5) * CARD_W : (Math.random() - 0.5) * CARD_W, e >= 2 ? (e < 3 ? -0.5 : 0.5) * CARD_H : (Math.random() - 0.5) * CARD_H, 0.01);
          m.localToWorld(_v);
          p.emit({ pos: _v, count: 1, vel: { x: 0, y: 0.22, z: 0 }, spread: 0.12, life: [0.7, 1.3], size: [0.035 + R.rank * 0.006, 0.01], sprite: ['star4', 'spark', 'glow8'], additive: true, color: R.rank >= 5 ? PRISM : [R.glow, 0xffffff], drag: 1, fadeIn: 0.2 });
        }
      }
      // ---- resting / hovered
      c.hover = damp(c.hover, c === this.hovered ? 1 : 0, 9, rdt);
      const hs = c.hover * c.hover * (3 - 2 * c.hover);
      if (!this.dragging || this.dragging !== c) c.flipCur = damp(c.flipCur, c.flip, 9, rdt);
      const local = c === this.hovered && hitPoint ? _v2.copy(hitPoint).sub(c.home) : _v2.set(0, 0, 0);
      c.tiltY = damp(c.tiltY, local.dot(this.sx) * 0.5 * c.hover, 10, rdt);
      c.tiltX = damp(c.tiltX, -local.dot(this.sy) * 0.4 * c.hover, 10, rdt);
      const fc = this.focusC(c, _v);
      _v.lerpVectors(c.homeC, fc, hs);
      this.toWorld(_v, m.position);
      const bob = Math.sin(this.time * 1.6 + c.i * 1.7);
      m.position.addScaledVector(this.sy, bob * 0.014 * (1 - hs * 0.5));
      m.quaternion.copy(c.homeQ).slerp(this.stageQ, hs);
      m.rotateY(c.flipCur + c.tiltY);
      m.rotateX(c.tiltX);
      // hovered: it breathes
      m.rotateZ(Math.sin(this.time * 2.1 + c.i) * 0.012 * hs + bob * 0.006 * (1 - hs));
      m.scale.setScalar(c.base * (1 + hs * 0.06 + hs * 0.014 * Math.sin(this.time * 2.6)));
      // the ledger swings open beside the hovered card (front side up only)
      const want = c === this.hovered && Math.abs(c.flipCur) < 0.5 && c.flip < 0.5 ? 1 : 0;
      if (want && !c.panelOpen) {
        ctx.sfx('page_turn', m.position, 0.45, 1.1);
        // a flourish of gold dust along the hinge
        for (let k = 0; k < 10; k++) {
          _v.set(c.side * CARD_W * 0.5, (Math.random() - 0.5) * CARD_H, 0);
          m.localToWorld(_v);
          p.emit({ pos: _v, count: 1, spread: 0.9, life: [0.3, 0.6], size: [0.05, 0.01], sprite: ['star4', 'spark'], additive: true, color: [0xffe6a0, 0xffffff], drag: 2.5 });
        }
      }
      c.panelOpen = !!want;
      c.panel.update(want, Math.min(rdt, 1 / 30));
      c.card.setPanel(c.panel.x, c.side);
    }
    for (const c of this.cards) {
      if (c.pillar) {
        c.pillar.k = c.pillarK;
        c.pillar.update();
      }
      this.orbit(c, rdt, c.ready ? 1 : 0);
    }
  }

  /** the hieroglyph ring around a learn card follows it (assembles once it is home) */
  private orbit(c: Card, rdt: number, want: number) {
    const g = c.glyphs;
    if (!g) return;
    g.group.position.copy(c.mesh.position);
    g.appear = Math.max(0, Math.min(1, g.appear + (want ? rdt * 1.4 : -rdt * 3)));
    g.fade = c.crumble >= 0 ? Math.max(0, 1 - c.crumble * 2) : c.fly ? Math.max(0, 1 - c.fly.t * 3) : 1;
    g.update(rdt);
  }

  private animateFly(rdt: number) {
    const c = this.chosen;
    if (!c || !c.fly) return;
    const f = c.fly;
    const m = c.mesh;
    const col = RARITY[c.offer.def.rarity].hex;
    if (f.t < 1) {
      f.t = Math.min(1, f.t + rdt / (f.mode === 'dive' ? 0.42 : f.mode === 'deal' ? 0.36 : 0.5));
      const k = f.t * f.t;
      // a curved flight into his chest (or down into the sand, or to the dealing spot), spinning, shrinking, going white-hot
      const a = 1 - k;
      m.position.set(a * a * f.from.x + 2 * a * k * f.ctrl.x + k * k * f.to.x, a * a * f.from.y + 2 * a * k * f.ctrl.y + k * k * f.to.y, a * a * f.from.z + 2 * a * k * f.ctrl.z + k * k * f.to.z);
      m.rotateY(rdt * 14 * (0.3 + k));
      m.scale.setScalar(c.base * (1 - k * (f.mode === 'dive' ? 0.45 : 0.78)));
      c.card.setFlash(Math.min(1, k * (f.mode === 'dive' ? 0.9 : 1.4)));
      this.cine.p.emit({ pos: m.position, count: 3, spread: 0.8, life: [0.2, 0.45], size: [0.08, 0.01], sprite: ['spark', 'star4', 'glow8'], additive: true, color: [col, 0xffffff], drag: 2 });
      if (f.t >= 1) {
        m.visible = false;
        if (f.mode === 'hero') {
          this.outcome?.apply();
          this.cine.soak(this.outcome ? (this.outcome.win ? WIN_COL : LOSE_COL) : col);
          this.resolveAt = this.cine.t + 0.22;
        } else if (f.mode === 'dive') {
          const g = f.to.clone().add(new THREE.Vector3(0, 0.35, 0));
          const p = this.cine.p;
          p.emit({ pos: g, count: 28, spread: 3.5, up: 4.5, life: [0.5, 1.0], size: [0.07, 0.04], sprite: GRAIN, color: SAND, gravity: 11, drag: 1, ground: true, bounce: 0.15 });
          p.emit({ pos: g, count: 6, spread: 1.6, up: 1, life: [0.8, 1.4], size: [0.4, 1.1], sprite: PUFF, color: SAND, alpha: 0.7, drag: 2.4, rot: 6, rotSpeed: 0.7, jitter: 0.3 });
          this.ctx.sfx('sand_burst', g, 0.9, 0.85);
          this.cine.kick(0.3);
          const key = c.offer.def.learn!;
          this.unlock = new SkillUnlock(this.cine, this.ctx, key, () => this.art.textureKey('tarot:' + key));
        } else if (this.outcome) {
          const o = this.outcome;
          this.show = new GambleShow(this.cine, this.ctx, o, f.to);
          this.show.onReveal = () => o.apply();
        }
      }
      if (c.pillar) {
        c.pillarK = Math.max(0, c.pillarK - rdt * 3);
        c.pillar.k = c.pillarK;
        c.pillar.update();
      }
      this.orbit(c, rdt, 0);
    } else if (this.unlock && this.unlock.stage === 'show') {
      if (this.unlock.ready) this.finishUnlock(c);
    } else if (this.show && this.resolveAt < 0) {
      if (this.show.done) {
        // the result's light soaks into him (green for a win, red for a loss), the camera goes back to the arch
        this.cine.soak(this.outcome?.win ? WIN_COL : LOSE_COL);
        this.cine.shoot(this.cine.B, 0.55);
        this.resolveAt = this.cine.t + 0.3;
      }
    } else if (this.resolveAt >= 0 && this.cine.t >= this.resolveAt) {
      this.resolveAt = -1;
      this.finish(c);
    }
  }

  private animateDying(rdt: number) {
    const p = this.cine.p;
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const c = this.dying[i];
      const m = c.mesh;
      c.crumble = Math.min(1, c.crumble + rdt / 0.85);
      const k = c.crumble;
      c.card.setDissolve(Math.min(1, k * 1.15));
      // it slumps and sinks as it pours away
      if (c.crumbleFrom) m.position.copy(c.crumbleFrom).addScaledVector(this.sy, -0.5 * k * k);
      m.rotateZ(rdt * 0.25 * (c.side || 1));
      if (k < 0.95) {
        for (let n = 0; n < 4; n++) {
          _v.set((Math.random() - 0.5) * CARD_W, (Math.random() - 0.5) * CARD_H * (1 - k * 0.6), 0);
          m.localToWorld(_v);
          p.emit({ pos: _v, count: 1, vel: { x: 0, y: -0.3, z: 0 }, spread: 0.5, life: [0.6, 1.1], size: [0.05, 0.03], sprite: GRAIN, color: SAND, gravity: 9, drag: 0.4, ground: true, bounce: 0.08 });
        }
        if (Math.random() < 0.12) p.emit({ pos: m.position, count: 1, spread: 0.4, life: [0.6, 1.0], size: [0.25, 0.6], sprite: PUFF, color: SAND, alpha: 0.8, drag: 2, rot: 6, rotSpeed: 0.5, jitter: 0.3 });
      }
      if (c.pillar) {
        c.pillarK = Math.max(0, c.pillarK - rdt * 2.5);
        c.pillar.k = c.pillarK;
        c.pillar.update();
      }
      this.orbit(c, rdt, 0);
      if (k >= 1) {
        this.kill(c);
        this.dying.splice(i, 1);
      }
    }
  }

  private lateUpdate(rdt: number) {
    const cine = this.cine;
    if (cine.alive || cine.p.count > 0) cine.update(rdt, this.active);
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= rdt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        tm.fn();
      }
    }
    // the unlock show poses the hero after the stage has aimed his head; its card keeps flying after the release
    if (this.unlock) {
      this.unlock.update(rdt);
      if (this.unlock.stage === 'done') {
        this.unlock.dispose();
        this.unlock = null;
      }
    }
    this.show?.update(rdt);
    // the hunter stays on stage while the picker is open (RunScene hides him for the old flat picker)
    if (this.active && this.hero) {
      this.hero.root.visible = true;
      (this.ctx.engine.current as any)?.garments?.setEnabled?.(true);
    }
    // cards still crumbling after the run resumed
    if (!this.active && this.dying.length) this.animateDying(rdt);
  }
}
