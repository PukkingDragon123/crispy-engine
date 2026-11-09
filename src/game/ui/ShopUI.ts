// The turtle-house shop's UI as stylized 2D pixel art (the HUD kit: PixelUI's
// authored frames, HudSprites' hard-pixel Alagard), on its own canvas over the
// shop scene, on the HUD's pixel grid:
//  • PRICE TAGS: a parchment tag on a string under every ware on the stall (it
//    follows the ware's lip on screen and swings when the ware lands or is
//    lifted): the price, a red DEAL tag when it is the day's deal, red figures
//    when you are short, SOLD once bought (the tag flips over).
//  • THE WARE CARD: beside the lifted ware, a parchment card: the name, what it
//    does, what it means for you (green: a gain, red: a snag) and the price.
//  • THE PORCH CHOICES: a short parchment list of what you can say (2 or 3),
//    keycaps for the number keys; hover / tap lights a row.
//  • THE HINT STRIP: at the foot of the frame, the purse and the keys (keycaps),
//    with the restock line under it; touch wording on a touch screen.
// Shop.ts sets the state each frame; this layer only draws and hit-tests.
import * as THREE from 'three';
import type { Input } from '../../engine/Input';
import { nine, SWAP_LIT } from './PixelUI';
import { HUD_ART as ART } from './HudArt';
import { pixelText, pixelTextWidth } from './HudSprites';

export interface TagText {
  price: number;
  short: string;
  was?: number | null;
  deal?: boolean;
  sold?: boolean;
  dear?: boolean;
}

/** one price tag: pinned to a world point (the stall's lip under its ware) */
export class PixelTag {
  /** where its string is pinned (world space, Shop keeps it current) */
  readonly anchor = new THREE.Vector3();
  text: TagText = { price: 0, short: '' };
  shown = 0;
  /** 1 once its ware has landed (or it is a SOLD tag) */
  want = 0;
  private a = 0;
  private av = 0;
  private flip = 0;
  private pending: TagText | null = null;
  dead = false;
  set(t: TagText) {
    if (t.sold && !this.text.sold && this.shown > 0.5 && !this.pending) {
      this.pending = t;
      this.flip = 0.0001;
      return;
    }
    if (!this.pending) this.text = t;
  }
  kick(k = 1) {
    this.av += (Math.random() - 0.3) * 9 * k;
  }
  update(dt: number, want: number) {
    this.shown += (want - this.shown) * Math.min(1, dt * 7);
    this.av += (-40 * this.a - 3.2 * this.av) * dt;
    this.a += this.av * dt;
    if (this.flip > 0) {
      this.flip = Math.min(1, this.flip + dt * 2.6);
      if (this.flip >= 0.5 && this.pending) {
        this.text = this.pending;
        this.pending = null;
        this.kick(0.6);
      }
      if (this.flip >= 1) this.flip = 0;
    }
  }
  /** -1..1 swing, and the card's squash during the SOLD flip */
  get swing() {
    return this.a;
  }
  get squash() {
    return this.flip > 0 ? Math.abs(Math.cos(this.flip * Math.PI)) : 1;
  }
  dispose() {
    this.dead = true;
  }
}

const capCache = new Map<string, HTMLCanvasElement>();
/** a bone keycap sized to its label (the HUD's authored key frame, hard-pixel Alagard) */
function cap(label: string) {
  let cv = capCache.get(label);
  if (cv) return cv;
  const tw = Math.ceil(pixelTextWidth(label, 16));
  const w = tw + 10, h = 16;
  cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  c.drawImage(nine(ART.nine_key, w, h, 5), 0, 0);
  pixelText(c, label, w / 2, -1, { size: 16, color: '#3a200e', align: 'center' });
  capCache.set(label, cv);
  return cv;
}

export interface CardState {
  /** the ware's screen point (css px) */
  x: number;
  y: number;
  name: string;
  desc: string;
  note: { text: string; good?: boolean; bad?: boolean } | null;
  price: string;
  dear: boolean;
}
export interface HintState {
  gold?: number;
  extra?: string;
  keys: [string, string][];
  foot?: string;
}

const INK = '#3a1c0a', RED = '#8a2016', GREEN = '#2e6a18', SOFT = '#6a4a28';
const _p = new THREE.Vector3();

export class ShopUI {
  private cv = document.createElement('canvas');
  private c: CanvasRenderingContext2D;
  private s = 2;
  private w = 0;
  private h = 0;
  private t = 0;
  tags: PixelTag[] = [];
  card: CardState | null = null;
  private cardK = 0;
  private cardWas: CardState | null = null;
  /** the porch choices (null: none), which are old news (asked already) */
  talk: { opts: string[]; old: boolean[] } | null = null;
  private talkK = 0;
  /** the row under the pointer (-1: none) */
  talkHover = -1;
  private rows: { x: number; y: number; w: number; h: number }[] = [];
  hint: HintState | null = null;
  /** a sound when the pointer lands on a new row */
  onHover: (() => void) | null = null;

  constructor(parent: HTMLElement, private input: Input, private camera: THREE.Camera) {
    this.c = this.cv.getContext('2d')!;
    this.cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:7;image-rendering:pixelated';
    parent.appendChild(this.cv);
  }

  tag() {
    const t = new PixelTag();
    this.tags.push(t);
    return t;
  }

  private resize() {
    this.s = window.innerWidth > 1800 ? 3 : 2;
    const w = Math.ceil(window.innerWidth / this.s), h = Math.ceil(window.innerHeight / this.s);
    if (w === this.w && h === this.h) return;
    this.w = this.cv.width = w;
    this.h = this.cv.height = h;
    this.c.imageSmoothingEnabled = false;
  }

  /** world -> HUD px (null: behind the lens) */
  private screen(p: THREE.Vector3) {
    _p.copy(p).project(this.camera);
    if (_p.z > 1) return null;
    return { x: (_p.x * 0.5 + 0.5) * this.w, y: (-_p.y * 0.5 + 0.5) * this.h };
  }

  draw(dt: number) {
    this.t += dt;
    this.resize();
    const c = this.c;
    c.clearRect(0, 0, this.w, this.h);
    this.tags = this.tags.filter((t) => !t.dead);
    for (const t of this.tags) this.drawTag(t);
    this.drawCard(dt);
    this.drawTalk(dt);
    this.drawHint();
  }

  // ---------------------------------------------------------------- tags
  private drawTag(t: PixelTag) {
    if (t.shown < 0.03) return;
    const p = this.screen(t.anchor);
    if (!p) return;
    const c = this.c, T = t.text;
    const label = T.sold ? 'SOLD' : T.deal ? `DEAL ${T.price}` : `${T.price}`;
    const tw = Math.ceil(pixelTextWidth(label, 16));
    const W = tw + 14, H = 17;
    const drop = Math.round(6 + 3 * t.shown);
    const sx = Math.round(t.swing * 3);
    const x = Math.round(p.x + sx - W / 2), y = Math.round(p.y + drop);
    c.globalAlpha = Math.min(1, t.shown * 1.4);
    // the string from the pin to the tag's hole
    c.fillStyle = '#2a1a0c';
    const steps = drop;
    for (let i = 0; i <= steps; i++) c.fillRect(Math.round(p.x + (sx * i) / steps), Math.round(p.y + i), 1, 1);
    c.fillStyle = '#b88426';
    c.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
    const sq = t.squash;
    const card = nine(ART.nine_parch, W, H, 8);
    const dw = Math.max(2, Math.round(W * sq));
    c.drawImage(card, x + Math.round((W - dw) / 2), y, dw, H);
    if (sq > 0.6) {
      const col = T.sold || T.deal || T.dear ? RED : INK;
      pixelText(c, label, x + W / 2, y + 1, { size: 16, color: col, align: 'center', lip: '#f6e8c4' });
      // a coin mark: the figure is gold
      if (!T.sold) {
        c.fillStyle = '#b88426';
        c.fillRect(x + W - 5, y + 6, 2, 2);
      }
    }
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- the ware card
  private wrap(s: string, max: number) {
    const out: string[] = [];
    let line = '';
    for (const w of s.split(' ')) {
      const tryS = line ? line + ' ' + w : w;
      if (pixelTextWidth(tryS, 16) > max && line) {
        out.push(line);
        line = w;
      } else line = tryS;
    }
    if (line) out.push(line);
    return out;
  }
  private drawCard(dt: number) {
    const want = this.card ? 1 : 0;
    if (this.card) this.cardWas = this.card;
    this.cardK += (want - this.cardK) * Math.min(1, dt * 10);
    const C = this.cardWas;
    if (!C || this.cardK < 0.03) return;
    const c = this.c;
    const maxW = 150;
    const lines: [string, string][] = [[C.name, RED]];
    for (const l of this.wrap(C.desc, maxW)) lines.push([l, INK]);
    if (C.note) for (const l of this.wrap(C.note.text, maxW)) lines.push([l, C.note.good ? GREEN : C.note.bad ? RED : SOFT]);
    lines.push([C.price, C.dear ? RED : '#7a5214']);
    const W = Math.min(maxW, Math.max(...lines.map(([l]) => pixelTextWidth(l, 16)))) + 18;
    const H = lines.length * 12 + 12;
    const px = C.x / this.s, py = C.y / this.s;
    // on the open side of the ware, kept on screen
    let x = px > this.w * 0.55 ? px - 24 - W : px + 24;
    x = Math.max(4, Math.min(this.w - W - 4, x));
    let y = Math.round(py - H * 0.6);
    y = Math.max(28, Math.min(this.h - H - 44, y));
    const k = this.cardK;
    const slide = Math.round((1 - k) * 10);
    c.globalAlpha = this.card ? 1 : Math.min(1, k * 1.3);
    // a hard pixel shadow, the parchment, the type
    c.fillStyle = 'rgba(26,14,6,0.45)';
    c.fillRect(Math.round(x) + 3, y + 3 + slide, W, H);
    c.drawImage(nine(ART.nine_parch, W, H, 8), Math.round(x), y + slide);
    lines.forEach(([l, col], i) => pixelText(c, l, Math.round(x) + 9, y + 5 + slide + i * 12, { size: 16, color: col, lip: i === 0 ? '#f6e8c4' : null }));
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- the porch choices
  private drawTalk(dt: number) {
    const on = !!this.talk;
    this.talkK += ((on ? 1 : 0) - this.talkK) * Math.min(1, dt * 9);
    this.rows = [];
    const T = this.talk;
    if (!T || this.talkK < 0.03) {
      this.talkHover = -1;
      return;
    }
    const c = this.c;
    const rowH = 20;
    const tw = Math.max(...T.opts.map((o) => pixelTextWidth(o, 16)));
    const W = Math.round(tw + 44), H = T.opts.length * rowH + 14;
    const x = Math.round(Math.max(8, this.w * 0.08) - (1 - this.talkK) * 40), y = Math.round(this.h * 0.5 - H / 2);
    c.globalAlpha = Math.min(1, this.talkK * 1.3);
    c.fillStyle = 'rgba(26,14,6,0.45)';
    c.fillRect(x + 3, y + 3, W, H);
    c.drawImage(nine(ART.nine_parch, W, H, 8), x, y);
    const mx = this.input.mouseX / this.s, my = this.input.mouseY / this.s;
    let hov = -1;
    T.opts.forEach((o, i) => {
      const ry = y + 7 + i * rowH;
      const r = { x: x + 4, y: ry, w: W - 8, h: rowH - 2 };
      this.rows.push(r);
      const over = mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h;
      if (over) hov = i;
      if (over) c.drawImage(nine(ART.nine_parch, r.w, r.h, 8, SWAP_LIT), r.x, r.y);
      if (!this.input.touchDevice) c.drawImage(cap(String(i + 1)), x + 7, ry + 1);
      pixelText(c, o, x + (this.input.touchDevice ? 12 : 30), ry + 1, { size: 16, color: T.old[i] ? SOFT : over ? RED : INK, lip: '#f6e8c4' });
    });
    if (hov !== this.talkHover && hov >= 0) this.onHover?.();
    this.talkHover = hov;
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- the hint strip
  private drawHint() {
    const H0 = this.hint;
    if (!H0) return;
    const c = this.c;
    const parts: { cap?: HTMLCanvasElement; text: string; col: string }[] = [];
    if (H0.gold !== undefined) parts.push({ text: `${H0.gold} gold`, col: '#7a5214' });
    if (H0.extra) parts.push({ text: H0.extra, col: GREEN });
    for (const [k, l] of H0.keys) parts.push({ cap: cap(k), text: l, col: INK });
    const gap = 10;
    const widths = parts.map((p) => (p.cap ? p.cap.width + 3 : 0) + pixelTextWidth(p.text, 16));
    const W = Math.round(widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1) + 22);
    const footW = H0.foot ? pixelTextWidth(H0.foot, 16) + 22 : 0;
    const PW = Math.max(W, footW), PH = H0.foot ? 34 : 21;
    // in the letterbox's lower bar, clear of the shop
    const bar = this.h * 0.11;
    const x0 = Math.round(this.w / 2 - PW / 2), y0 = Math.round(this.h - Math.max(bar, PH + 4) / 2 - PH / 2);
    c.fillStyle = 'rgba(26,14,6,0.45)';
    c.fillRect(x0 + 3, y0 + 3, PW, PH);
    c.drawImage(nine(ART.nine_parch, PW, PH, 8), x0, y0);
    let x = Math.round(this.w / 2 - W / 2) + 11;
    parts.forEach((p, i) => {
      if (p.cap) {
        c.drawImage(p.cap, x, y0 + 3);
        x += p.cap.width + 3;
      }
      pixelText(c, p.text, x, y0 + 3, { size: 16, color: p.col, lip: '#f6e8c4' });
      x += pixelTextWidth(p.text, 16) + (i < parts.length - 1 ? gap : 0);
    });
    if (H0.foot) pixelText(c, H0.foot, this.w / 2, y0 + 18, { size: 16, color: SOFT, align: 'center' });
  }

  dispose() {
    this.cv.remove();
  }
}
