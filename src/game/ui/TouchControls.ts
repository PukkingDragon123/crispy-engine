// Mobile controls without a single button: the screen is the sand under the
// board and the HUD's own 3D pieces are the switches.
//
//  LEFT THUMB, the rider's feet (anywhere on the left ~42%)
//   - hold: ride. Sundown kick-pushes on his own at a slow, steady rhythm
//     (Board auto-push) toward where the thumb points; no drag = straight ahead
//   - drag sideways: carve. Pull back (down): sit back on the heel edge, brake
//   - flick up: jump; keep it up to charge (the Neck Slicer), ease back to pop
//   - flick sideways: drift (held while the thumb stays out, ease back to sling)
//   - in the air, flick: spins (sideways) and flips (up / down)
//   - tap, then touch and hold again: boost
//   The thumb's anchor is a small swirl of pixel sand that drifts with it.
//  RIGHT THUMB, the gun hand
//   - drag: aim. The gun fires itself while the assisted reticle is on a body
//   - touch and hold still: aim down the sights (snaps onto the nearest target)
//   - tap open sand: kick-push. Between two auto kicks is ON the beat: PERFECT
//   - swipe up: throw the grapple. Swipe down: kick
//  TAP THE WORLD / THE HUD
//   - tarot cards: cast (Death: the ultimate); the soul jar or the heart: the
//     ultimate; Pinch on the jar's stopper or on Sundown's shoulder: his
//     Scorpion Toss; the floating cylinder: reload (flick it sideways: next
//     gun); a gun on the carried-guns strip: draw it; the HUD items: use them
//   - the tin star or the tally board: the ledger; the wave plaque or a
//     two-finger tap: pause; the stopwatch in a break: hold it to ring the bell
//   - the thing you rode up to (chest, NPC, dig spot): touch it (hold to dig);
//     an enemy close by: kick it; any tap while a jump is charging: FIRE
//  QTEs: tap / swipe / hold a side, as the Alagard line under the prompt says.
// A short first-time tutorial (TouchTutor) shows each gesture with Sundown's
// own spectral hand. Gameplay never sees any of this: everything lands in the
// normal Input as actions (Input.touchHold / touchTap / stick).
import * as THREE from 'three';
import type { Input, Action } from '../../engine/Input';
import type { Qte } from './Qte';
import type { Hud } from './Hud';
import { PixelFx, TAU } from './HudKit';
import { WATCH_DROP } from './OutlawHud';
import { SOUL_JAR_HIT } from './SoulBar';
import { PUSH } from '../player/Board';
import { TouchTutor, tutorSeen } from './TouchTutor';

export function isTouchDevice() {
  try {
    return new URLSearchParams(location.search).get('touch') === '1' || matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  } catch {
    return false;
  }
}

/** what the touch layer reads from the scene (RunScene / CaveScene hand it over with attach) */
export interface TouchDeps {
  hud: Hud;
  /** the 3D HUD overlay scene (pixel sand, the tutorial's ghost hand) */
  hudScene: THREE.Scene;
  player: {
    alive: boolean;
    board: { grounded: boolean; pushT: number; pushGrade: string; jumpCharge: number };
    weapons: { carried: string[]; select(id: any): boolean };
    rig: { geo: any };
  };
  /** Pinch riding Sundown's shoulder (tap him for the Scorpion Toss) */
  pinch?: THREE.Object3D | null;
  enemies?: { list: { pos: THREE.Vector3; height: number; radius: number; alive: boolean }[] } | null;
}

type HudHit =
  | { kind: 'card'; key: string }
  | { kind: 'cyl' | 'ult' | 'pinch' | 'ledger' | 'pause' | 'watch' }
  | { kind: 'item'; i: number }
  | { kind: 'gun'; id: string };

type Role = 'steer' | 'aim' | 'tap' | 'cyl' | 'watch' | 'inter' | 'qte';

interface Finger {
  id: number;
  role: Role;
  x0: number;
  y0: number;
  t0: number;
  x: number;
  y: number;
  /** steer anchor (floats after the thumb) */
  ax: number;
  ay: number;
  moved: number;
  hud: HudHit | null;
  samples: { t: number; x: number; y: number }[];
  flickAt: number;
  jump: boolean;
  jumpPeak: number;
  jumpAt: number;
  drift: boolean;
  trick: boolean;
  boost: boolean;
  ads: boolean;
  /** buffered look while a fresh vertical drag might still be a swipe */
  pend: { dx: number; dy: number } | null;
  pair: Finger | null;
  /** a paired tap waiting for its partner (two-finger tap = pause) */
  waiting: boolean;
  qteKey: string;
  /** the tap this finger made counts as a push (lead time, s) */
  done: boolean;
}

const STICK_R = 56; // css px of full deflection
const DEAD = 0.16;
const TAP_MS = 220;
const TAP_PX = 14;
const FLICK_SPEED = 1.0; // css px / ms
const FLICK_PX = 34;
const LOOK_K = 2.1;
const CARD_RATIO = 80 / 130; // tarot frame width / height (props/tarot CARD)

const SAND = [0xfff1d0, 0xf3dcaa, 0x9a6a3a, 0x6b4426];
const DUST = [0xe8d2a8, 0x7a5434];
const GOLD = [0xfff1c0, 0xffd36b, 0xffb040];
const JADE = [0xc4ffe0, 0x5cf0a8, 0x2fbf7e];

const CSS = `
.tc-ui{position:absolute;inset:0;pointer-events:none;z-index:7;user-select:none;-webkit-user-select:none}
.tc-say{position:absolute;left:50%;transform:translate(-50%,0);font-family:'Alagard',serif;text-align:center;white-space:nowrap;letter-spacing:1px;
  color:#fff3d6;text-shadow:0 2px 0 #2a1408,2px 0 0 #2a1408,-2px 0 0 #2a1408,0 -2px 0 #2a1408,0 4px 10px rgba(20,8,2,.55);transition:opacity .18s}
.tc-say small{display:block;font-size:.62em;color:#c4ffe0;margin:2px auto 0;white-space:normal;max-width:min(300px,42vw);line-height:1.15}
`;

export class TouchControls {
  /** the text layer (QTE lines, the tutorial's captions) */
  root: HTMLDivElement;
  visible = true;
  private d: TouchDeps | null = null;
  private attached = false;
  private fingers = new Map<number, Finger>();
  private live = false;
  private modal = false;
  private lastT = performance.now();
  private lastDiscover = 0;
  /** we opened the ledger (performance.now(), 0 = no): the next tap closes it */
  private ledgerArmed = 0;
  private lastLeftTap = { t: -9999, x: 0, y: 0 };
  private sand: PixelFx | null = null;
  private glow: PixelFx | null = null;
  private qteSay: HTMLDivElement;
  private tutor: TouchTutor | null = null;
  private tutorWait = 0;
  // the beat: auto kicks are watched so the anchor can flare on the off-beat
  private lastPushT = 9;
  private beatAt = 0;
  private lastTapAt: { x: number; y: number; t: number } | null = null;
  private prevTouchAction = '';
  /** tutorial progress counters (TouchTutor reads them) */
  stats = { ride: 0, aim: 0, push: 0, jump: 0, drift: 0, hud: 0 };
  private onStart = (e: TouchEvent) => this.start(e);
  private onMove = (e: TouchEvent) => this.move(e);
  private onEnd = (e: TouchEvent) => this.end(e);

  constructor(parent: HTMLElement, private input: Input, private qte: Qte) {
    input.touchMode = true;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'tc-ui';
    parent.appendChild(this.root);
    this.qteSay = this.say(32);
    this.qteSay.style.top = '71%';
    const o = { passive: false, capture: true } as AddEventListenerOptions;
    window.addEventListener('touchstart', this.onStart, o);
    window.addEventListener('touchmove', this.onMove, o);
    window.addEventListener('touchend', this.onEnd, o);
    window.addEventListener('touchcancel', this.onEnd, o);
    const de = document.documentElement.style;
    this.prevTouchAction = de.touchAction;
    de.touchAction = 'none';
  }

  /** hand over the scene pieces the gestures need (call once after the HUD and player exist) */
  attach(d: TouchDeps) {
    this.d = d;
    this.attached = true;
    this.buildFx();
  }

  /** an Alagard caption element */
  private say(size: number) {
    const el = document.createElement('div');
    el.className = 'tc-say';
    el.style.fontSize = size + 'px';
    el.style.opacity = '0';
    this.root.appendChild(el);
    return el;
  }

  private buildFx() {
    const d = this.d;
    if (!d || this.sand) return;
    this.sand = new PixelFx(900, false, 80);
    this.glow = new PixelFx(500, true, 81);
    d.hudScene.add(this.sand.points, this.glow.points);
    if (!tutorSeen()) this.tutor = new TouchTutor(d.hudScene, d.player.rig.geo, this.glow, this.say(26));
  }

  /** until the scene hands its pieces over, find them on the live scene (RunScene / CaveScene fields) */
  private discover() {
    if (this.attached) return;
    const now = performance.now();
    if (now - this.lastDiscover < 500) return;
    this.lastDiscover = now;
    const cur = (window as any).__engine?.current;
    if (!cur?.hud?.anchors || !cur?.hud3d?.scene || !cur?.player?.board) return;
    this.d = { hud: cur.hud, hudScene: cur.hud3d.scene, player: cur.player, pinch: cur.skills?.pinchRoot ?? null, enemies: cur.enemies ?? null };
    this.buildFx();
  }

  // ================================================================ helpers
  private get W() {
    return window.innerWidth;
  }
  private get H() {
    return window.innerHeight;
  }
  private hudS() {
    return this.d?.hud.scale ?? 2;
  }
  private grounded() {
    return this.d ? this.d.player.board.grounded : true;
  }
  private steerFinger() {
    for (const f of this.fingers.values()) if (f.role === 'steer') return f;
    return null;
  }
  private aimFinger() {
    for (const f of this.fingers.values()) if (f.role === 'aim') return f;
    return null;
  }

  // ================================================================ hit tests
  /** the HUD piece under a screen point (css px), front-most first */
  private hudHit(x: number, y: number): HudHit | null {
    const hud = this.d?.hud;
    if (!hud || !hud.visible) return null;
    const A = hud.anchors;
    if (A.slide > 0.5) return null;
    const s = hud.scale;
    const hx = x / s, hy = y / s;
    const near = (px: number, py: number, r: number) => Math.hypot(hx - px, hy - py) < r;
    // tarot cards (the later card sits in front)
    for (let i = hud.cardAnchors.length - 1; i >= 0; i--) {
      const c = hud.cardAnchors[i];
      if (Math.abs(hx - c.x) < (c.h * CARD_RATIO) / 2 + 2 && Math.abs(hy - c.y) < c.h / 2 + 2) return { kind: 'card', key: c.key };
    }
    // the carried-guns strip, the magazine (cylinder, shells or drum)
    const ar = (A as any).arsenal as { k: number; x: number; y: number; strip: { y: number; slots: { x: number; id: string }[] } | null } | null | undefined;
    if (ar?.strip) for (const sl of ar.strip.slots) if (near(sl.x, ar.strip.y, 15 * ar.k + 3)) return { kind: 'gun', id: sl.id };
    if (near(A.cyl.x, A.cyl.y, A.cyl.R + 10) || (ar && near(ar.x, ar.y, 26 * ar.k))) return { kind: 'cyl' };
    // the soul jar with Pinch on the stopper, and the heart under it
    const so = A.soul;
    if (so) {
      // the 3D jar: its stopper with Pinch above the shoulder, the jar below
      const J = SOUL_JAR_HIT;
      const k = so.k * J.scale;
      if (Math.abs(hx - so.x) < J.pinchHalfW * k + 3 && hy < so.y - J.body * k && hy > so.y - J.top * k) return { kind: 'pinch' };
      if (Math.abs(hx - so.x) < J.halfW * k + 2 && hy <= so.y + 4 && hy >= so.y - J.body * k) return { kind: 'ult' };
    }
    if (near(A.heart.x, A.heart.y - 3, 19)) return { kind: 'ult' };
    for (let i = 0; i < A.items.length; i++) if (near(A.items[i].x, A.items[i].y, 15)) return { kind: 'item', i };
    // the outlaw readouts: tin star + tally board (the ledger), the wave plaque (pause), the break's stopwatch
    const ol = A.outlaw;
    if (ol) {
      const k = ol.k;
      if (near(ol.star.x, ol.star.y, 17 * k + 2)) return { kind: 'ledger' };
      if (Math.abs(hx - ol.tally.x) < 46 * k && Math.abs(hy - ol.tally.y) < 13 * k) return { kind: 'ledger' };
      const pq = ol.plaque;
      if (pq) {
        const py = pq.y - pq.drop;
        if (ol.watch && near(pq.x, py + 14 * k + WATCH_DROP * k, 30 * k)) return { kind: 'watch' };
        if (Math.abs(hx - pq.x) < 54 * k && Math.abs(hy - py) < 17 * k) return { kind: 'pause' };
      }
    }
    return null;
  }

  /** the interactable you rode up to (its prompt or the thing itself), css px */
  private interHit(x: number, y: number) {
    const hud = this.d?.hud;
    const pr = hud?.last?.prompt;
    if (!hud?.project || !pr) return false;
    const s = hud.scale;
    const p = hud.project(pr.world);
    if (p.visible) {
      const w = (pr.text.length * 7 + 34) * s;
      if (Math.abs(x - p.x) < w / 2 + 10 && Math.abs(y - p.y) < 16 * s) return true;
    }
    const o = hud.project({ x: pr.world.x, y: pr.world.y - 1.25, z: pr.world.z });
    return o.visible && Math.hypot(x - o.x, y - o.y) < 34 * s;
  }

  /** Pinch on Sundown's shoulder */
  private pinchHit(x: number, y: number) {
    const hud = this.d?.hud, pin = this.d?.pinch;
    if (!hud?.project || !pin || !pin.visible) return false;
    const w = pin.getWorldPosition(_v);
    const p = hud.project(w);
    return p.visible && Math.hypot(x - p.x, y - (p.y - 6)) < 30;
  }

  /** a live enemy within a kick of Sundown, under the finger */
  private enemyHit(x: number, y: number) {
    const hud = this.d?.hud, en = this.d?.enemies, pl = this.d?.player as any;
    if (!hud?.project || !en || !pl?.pos) return false;
    for (const e of en.list) {
      if (!e.alive) continue;
      if (Math.hypot(e.pos.x - pl.pos.x, e.pos.z - pl.pos.z) > 3.4 + e.radius) continue;
      const lo = hud.project(e.pos);
      const hi = hud.project({ x: e.pos.x, y: e.pos.y + e.height, z: e.pos.z });
      if (!lo.visible && !hi.visible) continue;
      const h = Math.abs(lo.y - hi.y);
      const half = Math.max(40, h * 0.5);
      if (Math.abs(x - (lo.x + hi.x) / 2) < half && y > hi.y - 24 && y < lo.y + 24) return true;
    }
    return false;
  }

  // ================================================================ touch events
  private start(e: TouchEvent) {
    if (!this.live) {
      // menus own the screen; a tap closes the ledger we opened
      if (this.modal && this.ledgerArmed && e.touches.length === 1) {
        this.ledgerArmed = 0;
        this.input.touchTap('stats');
      }
      return;
    }
    const tg = e.target as HTMLElement | null;
    if (tg?.closest?.('button,input,select,a,[data-touch-pass]')) return;
    e.preventDefault();
    const now = performance.now();
    for (const t of Array.from(e.changedTouches)) {
      const f: Finger = {
        id: t.identifier, role: 'tap', x0: t.clientX, y0: t.clientY, t0: now, x: t.clientX, y: t.clientY, ax: t.clientX, ay: t.clientY, moved: 0, hud: null,
        samples: [{ t: now, x: t.clientX, y: t.clientY }], flickAt: 0, jump: false, jumpPeak: 0, jumpAt: 0, drift: false, trick: false, boost: false, ads: false,
        pend: null, pair: null, waiting: false, qteKey: '', done: false,
      };
      this.fingers.set(f.id, f);
      if (this.qte.active) {
        this.qteStart(f);
        continue;
      }
      // two fingers down together: a two-finger tap (pause) if both lift as taps
      for (const o of this.fingers.values()) {
        if (o === f || o.pair || o.role === 'qte' || now - o.t0 > 160 || o.moved > TAP_PX) continue;
        o.pair = f;
        f.pair = o;
        break;
      }
      const hh = this.hudHit(f.x, f.y);
      if (hh?.kind === 'cyl') f.role = 'cyl';
      else if (hh?.kind === 'watch') {
        f.role = 'watch';
        this.input.touchHold('interact', true);
      } else if (this.interHit(f.x, f.y)) {
        f.role = 'inter';
        this.input.touchHold('interact', true);
        this.puff(f.x, f.y, GOLD, 10, true);
      } else {
        f.hud = hh;
        this.assignZone(f, now);
      }
    }
  }

  /** a fresh touch (or one that slid off an interactable) takes its side's job */
  private assignZone(f: Finger, now: number) {
    const left = f.x < this.W * 0.42;
    if (left && !this.steerFinger()) {
      f.role = 'steer';
      f.ax = f.x;
      f.ay = f.y;
      // tap, then touch and hold again: boost
      const lt = this.lastLeftTap;
      if (now - lt.t < 320 && Math.hypot(f.x - lt.x, f.y - lt.y) < 90) {
        f.boost = true;
        this.input.touchHold('boost', true);
        this.puff(f.x, f.y, [0x9fe8ff, 0xfff6e0], 14, true);
      }
    } else if (!left && !this.aimFinger()) f.role = 'aim';
    else f.role = 'tap';
    if (f.role !== 'steer') this.puff(f.x, f.y, DUST, 4, false, 0.5);
  }

  private move(e: TouchEvent) {
    if (!this.live) return;
    let mine = false;
    const now = performance.now();
    for (const t of Array.from(e.changedTouches)) {
      const f = this.fingers.get(t.identifier);
      if (!f) continue;
      mine = true;
      const px = f.x, py = f.y;
      f.x = t.clientX;
      f.y = t.clientY;
      f.moved = Math.max(f.moved, Math.hypot(f.x - f.x0, f.y - f.y0));
      f.samples.push({ t: now, x: f.x, y: f.y });
      while (f.samples.length > 2 && now - f.samples[0].t > 140) f.samples.shift();
      if (f.role === 'inter' && f.moved > 34) {
        // slid off the chest: it was a ride / aim after all
        this.input.touchHold('interact', false);
        f.x0 = f.x;
        f.y0 = f.y;
        f.moved = 0;
        this.assignZone(f, now);
        continue;
      }
      if (f.role === 'steer') this.steerMove(f, now);
      else if (f.role === 'aim') this.aimMove(f, f.x - px, f.y - py, now);
    }
    if (mine) e.preventDefault();
  }

  private end(e: TouchEvent) {
    const now = performance.now();
    for (const t of Array.from(e.changedTouches)) {
      const f = this.fingers.get(t.identifier);
      if (!f) continue;
      this.fingers.delete(f.id);
      if (!this.live) continue;
      e.preventDefault();
      f.x = t.clientX;
      f.y = t.clientY;
      this.finish(f, now, e.type === 'touchcancel');
    }
  }

  /** a finger lifted: let go of what it held, resolve taps and swipes */
  private finish(f: Finger, now: number, cancel: boolean) {
    const I = this.input;
    if (f.jump) I.touchHold('jump', false);
    if (f.drift || f.trick) I.touchHold('drift', false);
    if (f.boost) I.touchHold('boost', false);
    if (f.ads) I.touchHold('aim', false);
    if (f.role === 'steer') {
      I.stick.active = false;
      I.stick.x = I.stick.y = 0;
    }
    if (f.role === 'watch' || f.role === 'inter') I.touchHold('interact', false);
    if (f.role === 'qte') return this.qteEnd(f);
    if (cancel) return;
    const dur = now - f.t0;
    const tap = dur < TAP_MS && f.moved < TAP_PX;
    if (f.role === 'cyl') {
      const dx = f.x - f.x0, dy = f.y - f.y0;
      const carried = this.d?.player.weapons.carried.length ?? 1;
      if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.3 && carried > 1) {
        I.wheel += Math.sign(dx);
        this.streak(f.x0, f.y0, f.x, f.y, GOLD);
      } else if (f.moved < 24 && dur < 450) {
        I.touchTap('reload');
        this.hudFx(f.x, f.y, GOLD);
      }
      this.stats.hud++;
      return;
    }
    if (f.role === 'aim' && !tap && f.pend && dur < 300) {
      // a quick vertical swipe: up throws the grapple, down kicks
      const dx = f.x - f.x0, dy = f.y - f.y0;
      if (Math.abs(dy) > 48 && Math.abs(dy) > Math.abs(dx) * 1.4) {
        I.touchTap(dy < 0 ? 'grapple' : 'melee');
        this.streak(f.x0, f.y0, f.x, f.y, dy < 0 ? GOLD : SAND);
        return;
      }
    }
    if (f.pend) this.flushLook(f);
    if (!tap) return;
    if (f.pair) {
      const o = f.pair;
      if (o.waiting) {
        // both lifted as taps: two-finger tap
        o.waiting = false;
        o.done = true;
        f.pair = o.pair = null;
        I.touchTap('pause');
        return;
      }
      if (this.fingers.has(o.id)) {
        f.waiting = true;
        this.waitTap = f;
        return;
      }
      f.pair = null;
    }
    this.tap(f, now);
  }
  /** a paired tap held back until its partner decides */
  private waitTap: Finger | null = null;

  /** what a tap means, front-most first */
  private tap(f: Finger, now: number) {
    const I = this.input;
    let h = f.hud;
    if (f.role === 'steer') this.lastLeftTap = { t: now, x: f.x, y: f.y };
    // a sleeping jar, or Pinch before his card is learned: that tap was just a push
    const hud = this.d?.hud;
    if (h?.kind === 'ult' && !((hud?.last?.ult ?? 0) >= 1)) h = null;
    if (h?.kind === 'pinch' && !hud?.cardAnchors.some((c) => c.key === 'E')) h = null;
    if (h) {
      this.stats.hud++;
      const map: Record<string, Action> = { E: 'skill1', C: 'skill2', G: 'grenade', Z: 'ultimate' };
      switch (h.kind) {
        case 'card':
          if (map[h.key]) I.touchTap(map[h.key]);
          break;
        case 'ult':
          I.touchTap('ultimate');
          break;
        case 'pinch':
          I.touchTap('skill1');
          break;
        case 'item':
          I.touchTap(h.i === 0 ? 'item1' : 'item2');
          break;
        case 'ledger':
          I.touchTap('stats');
          this.ledgerArmed = now;
          break;
        case 'pause':
          I.touchTap('pause');
          break;
        case 'gun':
          this.d?.player.weapons.select(h.id);
          break;
      }
      this.hudFx(f.x, f.y, h.kind === 'ult' || h.kind === 'pinch' ? JADE : GOLD);
      return;
    }
    if (hud?.cardAnchors.some((c) => c.key === 'E') && this.pinchHit(f.x, f.y)) {
      I.touchTap('skill1');
      this.hudFx(f.x, f.y, JADE);
      return;
    }
    if (this.enemyHit(f.x, f.y)) {
      I.touchTap('melee');
      this.puff(f.x, f.y, SAND, 12, false, 1.4);
      return;
    }
    // a jump is charging: any tap is the trigger (the Neck Slicer's gold ring)
    if (this.d?.player.board.jumpCharge && this.d.player.board.jumpCharge > 0.04) {
      I.touchTap('fire');
      this.puff(f.x, f.y, GOLD, 10, true);
      return;
    }
    // open sand: a kick-push, timed from the moment the finger went down
    I.touchTap('push');
    I.pushLead = Math.min(0.3, (now - f.t0) / 1000);
    this.lastTapAt = { x: f.x, y: f.y, t: now };
    this.stats.push++;
    this.puff(f.x, f.y, SAND, 9, false, 1);
  }

  // ---------------------------------------------------------------- steer
  /** fling speed over the last ~80 ms (css px / ms) */
  private flick(f: Finger, now: number) {
    if (now - f.flickAt < 300) return null;
    let s0 = f.samples[0];
    for (const s of f.samples) if (now - s.t >= 45) s0 = s;
    const dt = now - s0.t;
    if (dt < 16) return null;
    const dx = f.x - s0.x, dy = f.y - s0.y;
    const d = Math.hypot(dx, dy);
    if (d < FLICK_PX || d / dt < FLICK_SPEED) return null;
    f.flickAt = now;
    if (dy < -Math.abs(dx) * 1.1) return 'up';
    if (dy > Math.abs(dx) * 1.1) return 'down';
    return dx > 0 ? 'right' : 'left';
  }

  private steerMove(f: Finger, now: number) {
    // the anchor floats after a thumb that slides past full deflection
    let vx = f.x - f.ax, vy = f.y - f.ay;
    const d = Math.hypot(vx, vy);
    if (d > STICK_R) {
      f.ax += vx * (1 - STICK_R / d);
      f.ay += vy * (1 - STICK_R / d);
      vx = f.x - f.ax;
      vy = f.y - f.ay;
    }
    const I = this.input;
    const fl = this.flick(f, now);
    const ground = this.grounded();
    if (fl) {
      if (fl === 'up' && ground && !f.jump) {
        f.jump = true;
        f.jumpPeak = f.y;
        f.jumpAt = now;
        I.touchHold('jump', true);
        this.stats.jump++;
        this.spray(f.x, f.y, 0, -1, SAND, 16);
      } else if (!ground) {
        // in the air: flicks wind spins and flips (an upward one also sand-kicks, once learned)
        if (fl === 'up') I.touchTap('jump');
        if (!f.trick) {
          f.trick = true;
          I.touchHold('drift', true);
        }
        this.spray(f.x, f.y, fl === 'left' ? -1 : fl === 'right' ? 1 : 0, fl === 'up' ? -1 : fl === 'down' ? 1 : 0, GOLD, 10, true);
      } else if ((fl === 'left' || fl === 'right') && !f.drift) {
        f.drift = true;
        I.touchHold('drift', true);
        this.stats.drift++;
        this.spray(f.x, f.y, fl === 'left' ? -1 : 1, 0, SAND, 18);
      }
    }
    if (f.jump) {
      f.jumpPeak = Math.min(f.jumpPeak, f.y);
      // ease the thumb back down to pop the ollie
      if (f.y > f.jumpPeak + 26) {
        f.jump = false;
        I.touchHold('jump', false);
      }
    }
    if (f.drift && Math.abs(vx) / STICK_R < 0.3) {
      f.drift = false;
      I.touchHold('drift', false);
    }
    if (f.trick && Math.hypot(vx, vy) / STICK_R < 0.35) {
      f.trick = false;
      I.touchHold('drift', false);
    }
  }

  /** the left thumb's vector as the board's lean / carve (Input.stick) */
  private stickOut(f: Finger | null) {
    const st = this.input.stick;
    if (!f || !this.live) {
      st.active = false;
      st.x = st.y = 0;
      return;
    }
    const nx0 = (f.x - f.ax) / STICK_R, ny0 = -(f.y - f.ay) / STICK_R;
    const len = Math.min(1, Math.hypot(nx0, ny0));
    const k = len < DEAD ? 0 : (len - DEAD) / (1 - DEAD) / Math.max(1e-6, Math.hypot(nx0, ny0));
    const nx = nx0 * k, ny = ny0 * k;
    st.active = true;
    if (f.trick) {
      // tricks read the raw flick: sideways spins, up / down flips
      st.x = Math.abs(nx) > 0.35 ? Math.sign(nx) : 0;
      st.y = Math.abs(ny) > 0.35 ? Math.sign(ny) : 0;
    } else if (ny < -0.38) {
      // pulled back: sit on the heel edge
      st.x = nx * 0.6;
      st.y = Math.max(-1, (ny + 0.2) / 0.8);
    } else {
      // ride: no drag rolls straight on, sideways carves round
      st.x = nx;
      st.y = Math.min(1, Math.max(0, ny, 1 - Math.abs(nx)));
    }
  }

  // ---------------------------------------------------------------- aim
  private aimMove(f: Finger, dx: number, dy: number, now: number) {
    const I = this.input;
    I.touchAimAt = now;
    const age = now - f.t0;
    const tx = f.x - f.x0, ty = f.y - f.y0;
    // a fresh, mostly vertical drag might be a swipe: hold the look back a moment
    if (age < 230 && Math.abs(ty) > Math.abs(tx) * 1.3 && !f.ads) {
      f.pend ??= { dx: 0, dy: 0 };
      f.pend.dx += dx;
      f.pend.dy += dy;
      return;
    }
    if (f.pend) this.flushLook(f);
    I.mouseDX += dx * LOOK_K;
    I.mouseDY += dy * LOOK_K;
    this.stats.aim += Math.hypot(dx, dy);
  }
  private flushLook(f: Finger) {
    const p = f.pend;
    f.pend = null;
    if (!p) return;
    this.input.mouseDX += p.dx * LOOK_K;
    this.input.mouseDY += p.dy * LOOK_K;
  }

  // ---------------------------------------------------------------- QTEs
  private qteStart(f: Finger) {
    f.role = 'qte';
    const a = this.qte.active as any;
    const s = a?.spec;
    if (!s) return;
    if (s.kind === 'balance') f.qteKey = f.x < this.W / 2 ? 'KeyA' : 'KeyD';
    else if (s.kind === 'ring') f.qteKey = s.key ?? 'KeyZ';
    else if (s.kind === 'mash') f.qteKey = s.key ?? 'Space';
    else if (s.kind === 'bar') f.qteKey = s.key ?? 'Mouse0';
    if (f.qteKey) {
      this.input.press(f.qteKey);
      this.puff(f.x, f.y, GOLD, 10, true);
    }
  }
  private qteEnd(f: Finger) {
    const I = this.input;
    if (f.qteKey) {
      I.release(f.qteKey);
      return;
    }
    const a = this.qte.active as any;
    const s = a?.spec;
    if (s?.kind !== 'sequence') return;
    const want: string = s.keys[a.state.i] ?? '';
    const dx = f.x - f.x0, dy = f.y - f.y0;
    let code = '';
    if (Math.hypot(dx, dy) > 36) code = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'KeyD' : 'KeyA') : dy > 0 ? 'KeyS' : 'KeyW';
    else if (!DIRS[want]) code = want;
    if (!code) return;
    I.press(code);
    I.release(code);
    this.streak(f.x0, f.y0, f.x, f.y, GOLD);
  }
  /** the Alagard line under the QTE prompt: what to do with a finger */
  private qteLine() {
    const a = this.qte.active as any;
    const s = a?.spec;
    let t = '';
    if (s && !a.done) {
      if (s.kind === 'ring') t = 'TAP AS THE RING CLOSES';
      else if (s.kind === 'mash') t = 'TAP TAP TAP';
      else if (s.kind === 'bar') t = 'TAP IN THE GOLD';
      else if (s.kind === 'balance') t = 'HOLD LEFT OR RIGHT';
      else if (s.kind === 'sequence') {
        const k: string = s.keys[a.state.i] ?? '';
        t = DIRS[k] ? `SWIPE ${DIRS[k]}` : 'TAP';
      }
    }
    if (this.qteSay.textContent !== t) this.qteSay.textContent = t;
    this.qteSay.style.opacity = t ? '1' : '0';
    // the prompt may float over the threat (Qte.anchor): keep the line right under it
    const an = this.qte.anchor;
    const left = an ? `${Math.max(130, Math.min(window.innerWidth - 130, an.x))}px` : '50%';
    const top = an ? `${Math.min(window.innerHeight - 40, an.bottom)}px` : '71%';
    if (this.qteSay.style.left !== left) this.qteSay.style.left = left;
    if (this.qteSay.style.top !== top) this.qteSay.style.top = top;
  }

  // ================================================================ per frame
  /** call every frame; `modal` = a menu / card / shop owns the screen (taps reach the 3D UI) */
  update(modal: boolean) {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    this.discover();
    const qteOn = !!this.qte.active;
    const live = this.visible && (!modal || qteOn);
    if (this.live && !live) this.releaseAll();
    this.live = live;
    this.modal = modal;
    if (!modal && now - this.ledgerArmed > 400) this.ledgerArmed = 0;
    this.root.style.display = this.visible ? 'block' : 'none';
    this.qteLine();
    const I = this.input;
    // held fingers: ADS on a still press, the jump charge's safety release, landing ends a trick
    for (const f of this.fingers.values()) {
      const age = now - f.t0;
      if (f.role === 'aim' && !f.ads && age > 320 && f.moved < 12 && !f.hud) {
        f.ads = true;
        I.touchHold('aim', true);
        I.touchAimAt = now;
      }
      if (f.role === 'aim' && f.pend && age >= 230) this.flushLook(f);
      if (f.jump && now - f.jumpAt > 3000) {
        f.jump = false;
        I.touchHold('jump', false);
      }
      if (f.trick && this.grounded() && now - f.flickAt > 120) {
        f.trick = false;
        I.touchHold('drift', false);
      }
    }
    // a paired tap whose partner turned out to be a hold / drag: it was just a tap
    const w = this.waitTap;
    if (w && (!w.pair || !this.fingers.has(w.pair.id) || now - w.pair.t0 > TAP_MS || w.pair.moved > TAP_PX)) {
      this.waitTap = null;
      w.waiting = false;
      if (w.pair) w.pair.pair = null;
      w.pair = null;
      if (!w.done && live) this.tap(w, now);
    }
    const sf = live ? this.steerFinger() : null;
    this.stickOut(sf);
    if (sf) this.stats.ride += dt;
    this.drawFx(dt, now, sf);
    this.tutorFrame(dt, modal);
  }

  private releaseAll() {
    for (const f of this.fingers.values()) if (f.role === 'qte' && f.qteKey) this.input.release(f.qteKey);
    this.fingers.clear();
    this.waitTap = null;
    this.input.touchReset();
  }

  // ================================================================ pixel sand
  private s() {
    return this.hudS();
  }
  /** a little radial puff at a screen point (css px) */
  private puff(x: number, y: number, cols: number[], n: number, add = false, speed = 1) {
    const fx = add ? this.glow : this.sand;
    if (!fx) return;
    const s = this.s();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = (12 + Math.random() * 30) * speed;
      fx.emit({ x: x / s, y: y / s, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6, ay: 30, drag: 3.5, life: 0.35 + Math.random() * 0.35, size: Math.random() < 0.2 ? 2 : 1, c0: cols[i % cols.length], c1: cols[(i + 1) % cols.length], alpha: add ? 0.9 : 0.85, flick: add ? 0.4 : 0 });
    }
  }
  /** a directional spray (flicks) */
  private spray(x: number, y: number, dx: number, dy: number, cols: number[], n: number, add = false) {
    const fx = add ? this.glow : this.sand;
    if (!fx) return;
    const s = this.s();
    const l = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dy / l, dx / l) + (Math.random() - 0.5) * 1.1;
      const v = 40 + Math.random() * 70;
      fx.emit({ x: x / s + (Math.random() - 0.5) * 4, y: y / s + (Math.random() - 0.5) * 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 50, drag: 3, life: 0.35 + Math.random() * 0.3, size: Math.random() < 0.25 ? 2 : 1, c0: cols[i % cols.length], c1: DUST[i % 2], flick: add ? 0.4 : 0 });
    }
  }
  /** grains streaked along a swipe */
  private streak(x0: number, y0: number, x1: number, y1: number, cols: number[]) {
    const fx = this.sand;
    if (!fx) return;
    const s = this.s();
    for (let i = 0; i < 16; i++) {
      const k = i / 15;
      fx.emit({ x: (x0 + (x1 - x0) * k) / s, y: (y0 + (y1 - y0) * k) / s, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 14, drag: 3, ay: 20, life: 0.2 + k * 0.35, size: 1, c0: cols[i % cols.length], c1: DUST[i % 2] });
    }
  }
  /** a tapped HUD piece answers with a ring of light */
  private hudFx(x: number, y: number, cols: number[]) {
    const fx = this.glow;
    if (!fx) return;
    const s = this.s();
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      fx.emit({ x: x / s + Math.cos(a) * 3, y: y / s + Math.sin(a) * 3, vx: Math.cos(a) * 42, vy: Math.sin(a) * 42, drag: 5, life: 0.3 + Math.random() * 0.2, size: i % 4 ? 1 : 2, c0: cols[0], c1: cols[cols.length - 1], flick: 0.3 });
    }
  }

  private drawFx(dt: number, now: number, sf: Finger | null) {
    const sand = this.sand, glow = this.glow;
    if (!sand || !glow) return;
    const s = this.s();
    const b = this.d?.player.board;
    // auto kicks and pushes: the anchor pulses, the off-beat flares gold (tap now for a PERFECT push)
    if (b) {
      if (b.pushT < this.lastPushT) {
        this.beatAt = now + PUSH.beat * 1000;
        if (sf) this.ring(sf.ax, sf.ay, SAND, 14, 26, false);
        const lt = this.lastTapAt;
        if (b.pushGrade === 'perfect' && lt && now - lt.t < 400) {
          this.puff(lt.x, lt.y, GOLD, 22, true, 1.6);
          this.ring(lt.x, lt.y, GOLD, 16, 40, true);
        }
      }
      this.lastPushT = b.pushT;
      if (this.beatAt && now >= this.beatAt) {
        this.beatAt = 0;
        if (sf && b.grounded) this.ring(sf.ax, sf.ay, GOLD, 12, 18, true);
      }
    }
    if (sf) {
      // the anchor: a small swirl of sand grains orbiting under the thumb
      const ax = sf.ax / s, ay = sf.ay / s;
      const vx = sf.x - sf.ax, vy = sf.y - sf.ay;
      const dl = Math.hypot(vx, vy) / STICK_R;
      const brake = -vy / STICK_R < -0.38;
      const n = Math.min(12, Math.floor(dt * 150 + Math.random()));
      for (let i = 0; i < n; i++) {
        const th = Math.random() * TAU, r = 8 + Math.random() * 9, dth = 1.6 + Math.random() * 1.4;
        const ex = ax + Math.cos(th + dth) * r * 0.55, ey = ay + Math.sin(th + dth) * r * 0.55;
        const sx = ax + Math.cos(th) * r, sy = ay + Math.sin(th) * r;
        const mx = ax + Math.cos(th + dth / 2) * r * 1.35, my = ay + Math.sin(th + dth / 2) * r * 1.35;
        const cols = brake ? [0xd9935a, 0xb86a3a] : SAND;
        sand.emit({ x: sx, y: sy, tx: ex, ty: ey, vx: mx - (sx + ex) / 2, vy: my - (sy + ey) / 2, life: 0.6 + Math.random() * 0.4, size: Math.random() < 0.3 ? 2 : 1, c0: cols[(i + (Math.random() * 4) | 0) % cols.length], c1: DUST[i % 2], alpha: 0.95 });
      }
      if (Math.random() < dt * 6) sand.emit({ x: ax + (Math.random() - 0.5) * 10, y: ay + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 6, vy: -4, life: 0.9, size: 2, size1: 4, c0: DUST[0], c1: DUST[1], alpha: 0.28, curl: 4 });
      // grains run from the anchor out to the thumb: the lean you are holding
      if (dl > DEAD) {
        const m = Math.min(4, Math.floor(dt * 40 * dl + Math.random()));
        for (let i = 0; i < m; i++)
          sand.emit({ x: ax + (Math.random() - 0.5) * 4, y: ay + (Math.random() - 0.5) * 4, tx: sf.x / s + (Math.random() - 0.5) * 5, ty: sf.y / s + (Math.random() - 0.5) * 5, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8, life: 0.28 + Math.random() * 0.15, size: 1, c0: brake ? 0xd9935a : SAND[i % 4], c1: DUST[0], alpha: 0.75 });
      }
      if (sf.boost && Math.random() < dt * 30) glow.emit({ x: sf.x / s, y: sf.y / s, vx: (Math.random() - 0.5) * 30, vy: 20 + Math.random() * 20, drag: 2, life: 0.35, size: 1, c0: 0x9fe8ff, c1: 0x3fa8ff, flick: 0.5 });
    }
    sand.update(dt, s, 2400);
    glow.update(dt, s, 2410);
  }
  /** a ring of grains bursting out from a point */
  private ring(x: number, y: number, cols: number[], n: number, v: number, add: boolean) {
    const fx = add ? this.glow : this.sand;
    if (!fx) return;
    const s = this.s();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.3;
      fx.emit({ x: x / s + Math.cos(a) * 6, y: y / s + Math.sin(a) * 6, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 4, life: 0.32 + Math.random() * 0.16, size: 1, c0: cols[i % cols.length], c1: cols[(i + 1) % cols.length], flick: add ? 0.35 : 0 });
    }
  }

  // ================================================================ tutorial
  private tutorFrame(dt: number, modal: boolean) {
    const t = this.tutor;
    if (!t || !this.d) return;
    const hud = this.d.hud;
    const ready = !modal && this.live && this.input.enabled && hud.visible && hud.anchors.slide < 0.2 && this.d.player.alive && !this.qte.active;
    this.tutorWait = ready ? this.tutorWait + dt : 0;
    t.update(dt, this.hudS(), this.stats, hud, ready && (t.running || this.tutorWait > 2.5));
    if (t.finished) this.tutor = null;
  }

  dispose() {
    this.releaseAll();
    const o = { capture: true } as EventListenerOptions;
    window.removeEventListener('touchstart', this.onStart, o);
    window.removeEventListener('touchmove', this.onMove, o);
    window.removeEventListener('touchend', this.onEnd, o);
    window.removeEventListener('touchcancel', this.onEnd, o);
    document.documentElement.style.touchAction = this.prevTouchAction;
    this.sand?.dispose();
    this.glow?.dispose();
    this.tutor?.dispose();
    this.root.remove();
    this.input.touchMode = false;
  }
}

const DIRS: Record<string, string> = { KeyW: 'UP', KeyS: 'DOWN', KeyA: 'LEFT', KeyD: 'RIGHT' };
const _v = new THREE.Vector3();
