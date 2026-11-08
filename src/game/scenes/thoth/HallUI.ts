// Thoth's Hall: the screen furniture as stylized pixel art (the PixelUI kit's way:
// sprites drawn at UI pixel size into cached canvases, blitted nearest-neighbour at an
// integer scale; small type is Alagard set at its native size over them so it stays
// crisp). Thoth's colours: night lapis, gold rope, papyrus.
//  - the hall's cartouche (top left): the studies finished and the next gift
//  - CLOSE / BACK plates (top right)
//  - the wing plaques along the bottom (found / total, a gold seal when a study is ready)
//  - Thoth's talk box: his portrait in a gold niche and a papyrus balloon that types
//  - the specimen sheet (right): name, title, lore, stats, moves, weak spot, and THOTH'S
//    STUDY with its progress bar and the COMPLETE STUDY button
//  - the page arrows, the errand slip, the gift ladder at the desk, the jar markers, the
//    STUDY COMPLETE banner, the hover tag
// Taps and clicks are tested against the drawn rects (hit()), so touch works the same.
import { UI, FONT, px, sprite } from '../../ui/PixelUI';
import { HUD_ART as ART } from '../../ui/HudArt';
import type { StudyState } from '../../meta/Research';

export interface PanelData {
  key: string;
  name: string;
  title: string;
  section: string;
  num: number;
  known: boolean;
  isNew: boolean;
  lore: string;
  stats: [string, string][];
  moves: string[];
  weak?: string;
  hint?: string;
  points: string;
  study: { state: StudyState; text: string; cur: number; need: number } | null;
}
export interface WingTab {
  name: string;
  found: number;
  total: number;
  ready: number;
  fresh: number;
}
export interface ErrandSlip {
  state: 'offer' | 'active' | 'met' | 'none';
  ask: string;
  objective: string;
  progress: string;
  reward: string;
}
export interface GiftRow {
  name: string;
  at: number;
  given: boolean;
}
export interface HallUIState {
  view: 'nave' | 'wing' | 'desk';
  studies: number;
  nextGift: { name: string; at: number } | null;
  wings: WingTab[];
  activeWing: number;
  hoverWing: number;
  page: { cur: number; total: number } | null;
  panel: PanelData | null;
  talk: string | null;
  /** where Thoth's head is on screen (the balloon hangs over him there; null: the portrait box) */
  talkAt: { x: number; y: number } | null;
  errand: ErrandSlip | null;
  gifts: GiftRow[] | null;
  satchel: string | null;
  tip: { text: string; x: number; y: number } | null;
  markers: { x: number; y: number; kind: 'ready' | 'new' }[];
  banner: { title: string; sub: string } | null;
  hint: string;
  touch: boolean;
}

type Rect = { id: string; x: number; y: number; w: number; h: number };

// ---------------------------------------------------------------- palette
const L = { o: '#0a0f24', d: '#141c3a', m: '#1f2f66', l: '#283a7a', h: '#4468c0', w: '#8ab0e8' };
const G = { o: '#3a2406', d: '#7c5214', m: '#b88426', l: '#e2b24a', h: '#fff0a6' };
const P = { o: '#5a3e1e', d: '#a8865a', m: '#d8bc88', l: '#e8d4a4', h: '#f6e8c4', f: '#c4a670' };
const INK = '#2e1c0e', RED = '#8a2a16', SEPIA = '#6a4a2a', DIM = '#8a7050';

const cache = new Map<string, HTMLCanvasElement>();
function spr(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  let cv = cache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    const c = cv.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    draw(c);
    cache.set(key, cv);
    if (cache.size > 220) cache.delete(cache.keys().next().value!);
  }
  return cv;
}
const h2 = (x: number, y: number) => {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/** a gold rope edge: twisted strands, light on the top-left of each twist */
function rope(c: CanvasRenderingContext2D, x: number, y: number, len: number, vertical: boolean) {
  for (let i = 0; i < len; i++) {
    const k = i % 4;
    const a = k === 0 ? G.o : k === 1 ? G.h : k === 2 ? G.l : G.d;
    const b = k === 0 ? G.d : k === 1 ? G.l : k === 2 ? G.m : G.o;
    if (vertical) {
      px(c, x, y + i, 1, 1, a);
      px(c, x + 1, y + i, 1, 1, b);
    } else {
      px(c, x + i, y, 1, 1, a);
      px(c, x + i, y + 1, 1, 1, b);
    }
  }
}

/** a lapis plate with a gold rope border and gold corner studs (hot: one step brighter) */
function lapisPlate(w: number, h: number, hot = false, seed = 1) {
  return spr(`lp:${w}:${h}:${hot}:${seed}`, w, h, (c) => {
    px(c, 0, 0, w, h, L.o);
    for (let y = 2; y < h - 2; y++) {
      const t = y / h;
      px(c, 2, y, w - 4, 1, hot ? (t < 0.3 ? L.h : L.l) : t < 0.25 ? L.l : t > 0.8 ? L.d : L.m);
    }
    // a sprinkle of tiny gold stars in the lapis
    for (let k = 0; k < (w * h) / 90; k++) {
      const sx = 4 + Math.floor(h2(k, seed) * (w - 8)), sy = 4 + Math.floor(h2(seed, k + 9) * (h - 8));
      px(c, sx, sy, 1, 1, h2(k, k) > 0.5 ? G.l : L.w);
    }
    rope(c, 0, 0, w, false);
    rope(c, 0, h - 2, w, false);
    rope(c, 0, 0, h, true);
    rope(c, w - 2, 0, h, true);
    for (const [x, y] of [[0, 0], [w - 3, 0], [0, h - 3], [w - 3, h - 3]]) {
      px(c, x, y, 3, 3, G.o);
      px(c, x + 1, y + 1, 1, 1, G.h);
    }
  });
}

/** a papyrus sheet: crossed fibres, a darker deckled edge, a lapis-and-gold border band */
function papyrus(w: number, h: number, seed = 1, border = true) {
  return spr(`pp:${w}:${h}:${seed}:${border}`, w, h, (c) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const e = Math.min(x, y, w - 1 - x, h - 1 - y);
        const rag = h2(x + seed * 13, y) < 0.3 ? 1 : 0;
        if (e < rag) continue;
        let col = P.m;
        const fh = h2(Math.floor(x / 9) + seed, y) < 0.22, fv = h2(x, Math.floor(y / 11) + seed * 7) < 0.12;
        if (fh) col = h2(x >> 2, y) > 0.5 ? P.l : P.f;
        else if (fv) col = P.f;
        if (h2(x * 3 + 1, y * 7 + seed) < 0.02) col = P.d;
        if (e <= 1) col = P.o;
        else if (e <= 2) col = P.d;
        c.fillStyle = col;
        c.fillRect(x, y, 1, 1);
      }
    if (!border) return;
    // the border band: gold rule, lapis, gold rule
    const b = 4;
    px(c, b, b, w - b * 2, 1, G.m);
    px(c, b, h - b - 1, w - b * 2, 1, G.m);
    px(c, b, b, 1, h - b * 2, G.m);
    px(c, w - b - 1, b, 1, h - b * 2, G.m);
    px(c, b + 1, b + 1, w - b * 2 - 2, 2, L.l);
    px(c, b + 1, h - b - 3, w - b * 2 - 2, 2, L.l);
    px(c, b + 1, b + 1, 2, h - b * 2 - 2, L.l);
    px(c, w - b - 3, b + 1, 2, h - b * 2 - 2, L.l);
    for (let x = b + 4; x < w - b - 4; x += 6) {
      px(c, x, b + 1, 1, 1, G.l);
      px(c, x + 3, h - b - 2, 1, 1, G.l);
    }
    px(c, b + 3, b + 3, w - b * 2 - 6, 1, G.d);
    px(c, b + 3, h - b - 4, w - b * 2 - 6, 1, G.d);
    // corner rosettes
    for (const [x, y] of [[b - 1, b - 1], [w - b - 4, b - 1], [b - 1, h - b - 4], [w - b - 4, h - b - 4]]) {
      px(c, x, y, 5, 5, G.o);
      px(c, x + 1, y + 1, 3, 3, G.l);
      px(c, x + 2, y + 2, 1, 1, G.h);
    }
  });
}

/** a gold button: bevelled bar, dark ink outline (state: 0 idle, 1 hot, 2 glowing call to action) */
function goldButton(w: number, h: number, state: number, dim = false) {
  return spr(`gb:${w}:${h}:${state}:${dim}`, w, h, (c) => {
    const pal = dim ? { o: '#2a2016', d: '#5a4a34', m: '#7a6a50', l: '#9a8a6a', h: '#b8a888' } : G;
    px(c, 0, 1, w, h - 2, pal.o);
    px(c, 1, 0, w - 2, h, pal.o);
    px(c, 1, 1, w - 2, h - 2, state ? pal.l : pal.m);
    px(c, 2, 1, w - 4, 1, pal.h);
    px(c, 1, 2, 1, h - 4, state ? pal.h : pal.l);
    px(c, 2, h - 2, w - 4, 1, pal.d);
    px(c, w - 2, 2, 1, h - 4, pal.d);
    if (state === 2) for (let x = 4; x < w - 4; x += 5) px(c, x, 2, 2, 1, '#ffffff');
  });
}

/** the gold seal stamped on a studied entry: a rayed disc with the ibis */
function seal(r: number) {
  const S = r * 2 + 3;
  return spr(`seal:${r}`, S, S, (c) => {
    const cx = S / 2, cy = S / 2;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const a = Math.atan2(y - cy, x - cx);
        const rr = r + Math.cos(a * 12) * 1.2;
        if (d > rr + 0.5) continue;
        const lit = (cx - x) * 0.6 + (cy - y) * 0.8;
        px(c, x, y, 1, 1, d > rr - 0.6 ? G.o : d > r - 2.2 ? G.d : lit > 0 ? G.l : G.m);
      }
    const ib = sprite(ART.glyph_ibis);
    c.drawImage(ib, Math.round(cx - ib.width / 2), Math.round(cy - ib.height / 2));
  });
}

/** an arrow plate (dir -1 left, 1 right) */
function arrowPlate(dir: -1 | 1, hot: boolean) {
  return spr(`ar:${dir}:${hot}`, 17, 17, (c) => {
    c.drawImage(lapisPlate(17, 17, hot, 3), 0, 0);
    for (let i = 0; i < 5; i++) {
      const x = dir > 0 ? 6 + i : 10 - i;
      px(c, x, 8 - (4 - i), 1, (4 - i) * 2 + 1, i === 0 ? G.h : G.l);
    }
  });
}

/** the portrait niche: Thoth (the HUD's authored pixel portrait) in a gold-rimmed lapis niche */
function niche() {
  return spr('niche', 40, 46, (c) => {
    c.drawImage(lapisPlate(40, 46, false, 7), 0, 0);
    px(c, 4, 4, 32, 38, L.o);
    for (let y = 5; y < 41; y++) px(c, 5, y, 30, 1, y < 16 ? L.d : L.m);
    c.drawImage(sprite(ART.thoth), 6, 6);
  });
}

/** a speech balloon of papyrus, its tail pointing left at the portrait */
function balloon(w: number, h: number) {
  return spr(`bl:${w}:${h}`, w + 6, h, (c) => {
    c.drawImage(papyrus(w, h, 5, false), 6, 0);
    for (let i = 0; i < 6; i++) {
      px(c, 6 - i, 12 + i, i + 1, 1, i === 5 ? P.o : P.m);
      px(c, 6 - i, 12 + i, 1, 1, P.o);
    }
    px(c, 0, 18, 7, 1, P.o);
  });
}

/** a progress bar: a lapis well with a gold fill and ticks */
function bar(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, done: boolean) {
  px(c, x, y, w, h, L.o);
  px(c, x + 1, y + 1, w - 2, h - 2, L.d);
  const fw = Math.round((w - 2) * Math.max(0, Math.min(1, k)));
  if (fw > 0) {
    px(c, x + 1, y + 1, fw, h - 2, done ? '#5fc48a' : G.m);
    px(c, x + 1, y + 1, fw, 1, done ? '#a8f0c0' : G.h);
    px(c, x + 1, y + h - 2, fw, 1, done ? '#2a7a4a' : G.d);
  }
  for (let t = x + 8; t < x + w - 2; t += 8) px(c, t, y + 1, 1, h - 2, 'rgba(0,0,0,0.25)');
}

// ======================================================================= the layer
export class HallUI {
  readonly canvas = document.createElement('canvas');
  private c: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  /** css px per UI pixel */
  S = 2;
  private t = 0;
  private rects: Rect[] = [];
  private panelK = 0;
  private panelKey = '';
  private talkText = '';
  private talkT = 0;
  private talkK = 0;
  private bannerT = -1;
  private bannerLast: HallUIState['banner'] = null;
  private onResize = () => this.resize();
  hover = '';

  constructor(parent: HTMLElement) {
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:9;image-rendering:pixelated';
    parent.appendChild(this.canvas);
    this.c = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.onResize);
  }
  private resize() {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.S = Math.max(1, Math.min(3, Math.round(Math.min(this.W / 640, this.H / 360))));
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
  }
  /** narrow screens: the panel takes more of the width, small type */
  private get narrow() {
    return this.W < 900;
  }
  /** what a screen point (css px) is over */
  hit(x: number, y: number): string | null {
    for (let i = this.rects.length - 1; i >= 0; i--) {
      const r = this.rects[i];
      if (x >= r.x - 4 && x <= r.x + r.w + 4 && y >= r.y - 4 && y <= r.y + r.h + 4) return r.id;
    }
    return null;
  }
  /** the panel's left edge (css px): the 3D framing keeps clear of it */
  panelLeft() {
    return this.W - this.panelWidth() - 16;
  }
  private panelWidth() {
    return Math.round(Math.min(this.narrow ? this.W * 0.5 : this.W * 0.34, 470));
  }
  showBanner() {
    this.bannerT = 0;
  }

  frame(rdt: number, s: HallUIState) {
    this.t += rdt;
    const c = this.c;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    c.imageSmoothingEnabled = false;
    this.rects = [];
    const k = (v: number, want: boolean, up = 6, down = 9) => v + ((want ? 1 : 0) - v) * (1 - Math.exp(-rdt * (want ? up : down)));
    const pk = s.panel ? s.panel.key : s.gifts ? 'gifts' : '';
    if (pk !== this.panelKey) {
      if (this.panelK < 0.05 || !this.panelKey) this.panelKey = pk;
      this.panelK = k(this.panelK, false, 8, 14);
    } else this.panelK = k(this.panelK, !!pk, 6, 12);
    if (s.talk && s.talk !== this.talkText) {
      this.talkText = s.talk;
      this.talkT = 0;
    }
    this.talkT += rdt;
    this.talkK = k(this.talkK, !!s.talk, 7, 5);

    this.drawMarkers(s);
    this.drawTitle(s);
    this.drawButtons(s);
    this.drawTabs(s);
    if (s.view === 'wing') this.drawPager(s);
    if (s.view === 'nave') this.drawErrand(s.errand, s.satchel);
    if (this.panelKey && this.panelKey !== 'gifts' && s.panel && s.panel.key === this.panelKey) this.drawPanel(s.panel);
    else if (this.panelKey === 'gifts' && s.gifts) this.drawGifts(s);
    this.drawTalk(s);
    this.drawHint(s);
    this.drawBanner(rdt, s.banner);
    this.drawTip(s.tip);
  }

  // ---------------------------------------------------------------- helpers
  private blit(img: HTMLCanvasElement, x: number, y: number, alpha = 1, scale = this.S) {
    if (alpha <= 0.01) return;
    const c = this.c;
    c.globalAlpha = Math.min(1, alpha);
    c.drawImage(img, Math.round(x), Math.round(y), img.width * scale, img.height * scale);
    c.globalAlpha = 1;
  }
  private ink(s: string, x: number, y: number, col: string, size = 16, align: CanvasTextAlign = 'left', outline = false, alpha = 1) {
    const c = this.c;
    c.globalAlpha = alpha;
    c.font = `${size}px '${FONT}'`;
    c.textAlign = align;
    c.textBaseline = 'top';
    const X = Math.round(x), Y = Math.round(y);
    if (outline) {
      c.fillStyle = UI.shadow;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [2, 2]]) c.fillText(s, X + dx, Y + dy);
    }
    c.fillStyle = col;
    c.fillText(s, X, Y);
    c.globalAlpha = 1;
  }
  private tw(s: string, size = 16) {
    this.c.font = `${size}px '${FONT}'`;
    return this.c.measureText(s).width;
  }
  private wrap(s: string, maxW: number, size = 16) {
    const out: string[] = [];
    for (const para of s.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        if (!word) continue;
        const next = line ? line + ' ' + word : word;
        if (this.tw(next, size) > maxW && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      if (line) out.push(line);
    }
    return out;
  }
  private rect(id: string, x: number, y: number, w: number, h: number) {
    this.rects.push({ id, x, y, w, h });
  }
  /** a gold text button sized to its label; returns its width (css px) */
  private button(id: string, label: string, x: number, y: number, o: { state?: number; dim?: boolean; size?: number; align?: 'left' | 'right' | 'center' } = {}) {
    const S = this.S;
    const size = o.size ?? 16;
    const hot = this.hover === id;
    const wPx = Math.ceil((this.tw(label, size) + 18) / S);
    const hPx = Math.ceil((size + 8) / S);
    const img = goldButton(wPx, hPx, o.state ?? (hot ? 1 : 0), o.dim);
    let bx = x;
    if (o.align === 'right') bx = x - wPx * S;
    else if (o.align === 'center') bx = x - (wPx * S) / 2;
    const pulse = o.state === 2 ? Math.sin(this.t * 5) * 1.5 : 0;
    this.blit(img, bx, y - pulse);
    this.ink(label, bx + (wPx * S) / 2, y - pulse + (hPx * S - size) / 2 + 1, o.dim ? '#d8cbb0' : INK, size, 'center');
    this.rect(id, bx, y, wPx * S, hPx * S);
    return wPx * S;
  }

  // ---------------------------------------------------------------- pieces
  private drawTitle(s: HallUIState) {
    const S = this.S;
    const t1 = "THOTH'S HALL";
    const sub = s.nextGift ? `Studies ${s.studies}  ·  next gift at ${s.nextGift.at}` : `Studies ${s.studies}  ·  every gift given`;
    const wPx = Math.ceil((Math.max(this.tw(t1, 24), this.tw(sub, 14)) + 26) / S);
    const hPx = Math.ceil(60 / S);
    const x = 14, y = 12;
    this.blit(lapisPlate(wPx, hPx, false, 11), x, y);
    this.ink(t1, x + (wPx * S) / 2, y + 8, '#ffd36b', 24, 'center', true);
    this.ink(sub, x + (wPx * S) / 2, y + 36, '#cfdcf6', 14, 'center');
  }

  private drawButtons(s: HallUIState) {
    let x = this.W - 16;
    const w = this.button('close', 'CLOSE', x, 14, { align: 'right' });
    x -= w + 10;
    if (s.view !== 'nave') this.button('back', s.touch ? 'BACK' : 'BACK  (Esc)', x, 14, { align: 'right' });
    else this.button('desk', "THOTH'S DESK", x, 14, { align: 'right' });
  }

  private drawTabs(s: HallUIState) {
    const S = this.S;
    const n = s.wings.length;
    const size = this.narrow ? 13 : 15;
    const gap = 6;
    const maxW = this.W - 32;
    const names = s.wings.map((w) => w.name);
    const each = Math.min(Math.ceil((Math.max(...names.map((nm) => this.tw(nm, size))) + 22) / S), Math.floor((maxW - gap * (n - 1)) / n / S));
    const hPx = Math.ceil((size * 2 + 14) / S);
    const total = n * each * S + (n - 1) * gap;
    let x = Math.round(this.W / 2 - total / 2);
    const baseY = this.H - hPx * S - (s.touch ? 12 : 30);
    s.wings.forEach((w, i) => {
      const act = i === s.activeWing, hot = this.hover === 'wing:' + i || s.hoverWing === i;
      const y = baseY - (act ? 6 : hot ? 3 : 0);
      this.blit(lapisPlate(each, hPx + (act ? 2 : 0), act || hot, 20 + i), x, y);
      this.ink(w.name, x + (each * S) / 2, y + 5, act ? '#ffd36b' : '#fff3d6', size, 'center', true);
      this.ink(`${w.found} / ${w.total}`, x + (each * S) / 2, y + size + 8, '#cfdcf6', size - 2, 'center');
      if (w.ready > 0) this.blit(seal(5), x + each * S - 9 * (S / 2) - 6, y - 6, 1, Math.max(1, S - 1));
      else if (w.fresh > 0) this.ink('NEW', x + each * S - 4, y - 10, '#ffd36b', 12, 'right', true);
      this.rect('wing:' + i, x, y, each * S, hPx * S);
      x += each * S + gap;
    });
  }

  private drawPager(s: HallUIState) {
    if (!s.page || s.page.total <= 1) return;
    const S = this.S;
    const y = this.H - (s.touch ? 12 : 30) - Math.ceil((15 * 2 + 14) / S) * S - 17 * S - 14;
    const label = `PAGE ${s.page.cur + 1} / ${s.page.total}`;
    const lw = this.tw(label, 16);
    const cx = Math.min(this.W / 2, this.panelLeft() - lw / 2 - 17 * S - 20);
    this.blit(arrowPlate(-1, this.hover === 'page:-1'), cx - lw / 2 - 17 * S - 8, y);
    this.rect('page:-1', cx - lw / 2 - 17 * S - 8, y, 17 * S, 17 * S);
    this.blit(arrowPlate(1, this.hover === 'page:1'), cx + lw / 2 + 8, y);
    this.rect('page:1', cx + lw / 2 + 8, y, 17 * S, 17 * S);
    this.ink(label, cx, y + (17 * S - 16) / 2, '#fff3d6', 16, 'center', true);
  }

  private drawMarkers(s: HallUIState) {
    for (const m of s.markers) {
      const bob = Math.sin(this.t * 3 + m.x * 0.01) * 3;
      if (m.kind === 'ready') this.blit(seal(5), m.x - 6.5 * this.S, m.y - 14 * this.S + bob);
      else this.ink('NEW', m.x, m.y - 22 + bob, '#ffd36b', 14, 'center', true);
    }
  }

  private drawTalk(s: HallUIState) {
    const a = this.talkK;
    if (a < 0.02 || !this.talkText) return;
    const S = this.S;
    const size = this.narrow ? 14 : 16;
    const shown = this.talkText.slice(0, Math.floor(this.talkT * 46));
    const tabsTop = this.H - Math.ceil((15 * 2 + 14) / S) * S - 40;
    const right = this.panelKey ? this.panelLeft() - 12 : this.W - 12;
    const at = s.talkAt;
    // over Thoth's head when he is on screen and clear of the sheet and the plaques
    if (at && at.y > 90 && at.y < tabsTop + 20 && at.x > 30 && at.x < right - 20) {
      const maxBW = Math.min(this.narrow ? this.W * 0.6 : 380, right - 20);
      const lines = this.wrap(this.talkText, maxBW - 24, size);
      const bwPx = Math.ceil((Math.max(...lines.map((l) => this.tw(l, size))) + 24) / S);
      const bhPx = Math.ceil((lines.length * (size + 4) + 16) / S);
      const bw = bwPx * S, bh = bhPx * S;
      const bx = Math.max(10, Math.min(right - bw, at.x - bw * 0.3));
      const by = Math.max(70, at.y - bh - 14 - 4 * S) + (1 - a) * 16;
      this.blit(papyrus(bwPx, bhPx, 5, false), bx, by, a);
      // the tail: a stepped wedge of papyrus from the balloon down to the top of his head
      const c = this.c;
      c.globalAlpha = a;
      const tx = Math.max(bx + 12, Math.min(bx + bw - 16, at.x));
      const ty0 = by + bh - S, ty1 = Math.max(ty0 + 4 * S, at.y - 4);
      const steps = Math.max(3, Math.round((ty1 - ty0) / S));
      for (let i = 0; i < steps; i++) {
        const k = i / steps;
        const w = Math.max(S, Math.round(((1 - k) * 7 * S) / S) * S);
        const cx = tx + (at.x - tx) * k;
        const yy = ty0 + i * S;
        px(c, cx - w / 2 - S, yy, w + 2 * S, S, P.o);
        if (w > S) px(c, cx - w / 2, yy, w, S, i === 0 ? P.m : P.l);
      }
      c.globalAlpha = 1;
      let left = shown.length;
      lines.forEach((l, i) => {
        if (left <= 0) return;
        this.ink(l.slice(0, left), bx + 12, by + 8 + i * (size + 4), INK, size, 'left', false, a);
        left -= l.length + 1;
      });
      this.rect('talk', bx, by, bw, bh);
      return;
    }
    const nich = niche();
    const x = 14, maxBW = Math.min(this.narrow ? this.W - 40 * S - 60 : 420, this.panelKey ? this.panelLeft() - 40 * S - 50 : 9999);
    const lines = this.wrap(this.talkText, maxBW - 26, size);
    const bwPx = Math.ceil((Math.max(...lines.map((l) => this.tw(l, size))) + 26) / S);
    const bhPx = Math.ceil((lines.length * (size + 4) + 18) / S);
    const y = tabsTop - Math.max(46 * S, bhPx * S) - 12 + (1 - a) * 30;
    const bob = Math.sin(this.t * 2.2) * 1.2;
    this.blit(nich, x, y + bob, a);
    this.blit(balloon(bwPx, bhPx), x + 40 * S + 4, y, a);
    // type it out line by line
    let left = shown.length;
    lines.forEach((l, i) => {
      if (left <= 0) return;
      const part = l.slice(0, left);
      left -= l.length + 1;
      this.ink(part, x + 40 * S + 4 + 6 * S + 10, y + 9 + i * (size + 4), INK, size, 'left', false, a);
    });
    this.rect('talk', x, y, 40 * S + 4 + bwPx * S, Math.max(46 * S, bhPx * S));
  }

  private drawHint(s: HallUIState) {
    if (s.touch || !s.hint) return;
    this.ink(s.hint, this.W / 2, this.H - 22, '#e8dcc0', 14, 'center', true, 0.85);
  }

  private drawTip(tip: HallUIState['tip']) {
    if (!tip) return;
    const S = this.S;
    const w = Math.ceil((this.tw(tip.text, 16) + 16) / S), h = Math.ceil(26 / S);
    const x = Math.min(this.W - w * S - 6, tip.x + 16), y = tip.y + 14;
    this.blit(lapisPlate(w, h, false, 5), x, y);
    this.ink(tip.text, x + (w * S) / 2, y + (h * S - 16) / 2, '#fff3d6', 16, 'center');
  }

  private drawBanner(rdt: number, b: HallUIState['banner']) {
    if (b) this.bannerLast = b;
    if (this.bannerT < 0 || !this.bannerLast) return;
    this.bannerT += rdt;
    const t = this.bannerT;
    if (t > 4.2) {
      this.bannerT = -1;
      return;
    }
    const a = Math.min(1, t * 4) * (1 - Math.max(0, (t - 3.6) / 0.6));
    const S = this.S;
    const ti = this.bannerLast.title, sub = this.bannerLast.sub;
    const w = Math.ceil(Math.max(this.tw(ti, 32), this.tw(sub, 16)) / S) + 40;
    const h = Math.ceil(72 / S);
    const pop = 1 + Math.max(0, 0.25 - t) * 1.2;
    const x = this.W / 2 - (w * S * pop) / 2, y = this.H * 0.22;
    this.blit(lapisPlate(w, h, true, 31), x, y, a, S * pop);
    this.ink(ti, this.W / 2, y + 10, '#ffd36b', 32, 'center', true, a);
    this.ink(sub, this.W / 2, y + 48, '#fff3d6', 16, 'center', true, a);
  }

  // ---------------------------------------------------------------- the specimen sheet
  private drawPanel(p: PanelData) {
    const S = this.S;
    const a = this.panelK;
    if (a < 0.01) return;
    const W = this.panelWidth();
    const x = this.W - W - 16 + (1 - a) * (W + 30);
    const top = 64;
    const maxH = this.H - top - Math.ceil((15 * 2 + 14) / S) * S - 50;
    const pad = 22;
    const inner = W - pad * 2;
    const small = this.narrow ? 13 : 15;
    // lay it out first (so the sheet fits its words)
    const ops: ((y0: number) => void)[] = [];
    let y = 18;
    const line = (s: string, size: number, col: string, align: CanvasTextAlign = 'left', gap = 4) => {
      const yy = y;
      ops.push((y0) => this.ink(s, align === 'center' ? x + W / 2 : x + pad, y0 + yy, col, size, align));
      y += size + gap;
    };
    const rule = () => {
      const yy = y + 2;
      ops.push((y0) => {
        const c = this.c;
        c.globalAlpha = a;
        px(c, x + pad + 10, y0 + yy, inner - 20, 2, G.m);
        px(c, x + W / 2 - 3, y0 + yy - 2, 6, 6, G.d);
        px(c, x + W / 2 - 1, y0 + yy, 2, 2, G.h);
        c.globalAlpha = 1;
      });
      y += 12;
    };
    const nameSize = this.tw(p.name, 26) > inner ? 20 : 26;
    line(p.known ? p.name : 'Under the dust sheet', nameSize, p.known ? RED : SEPIA, 'center', 2);
    line(p.known ? p.title : `${p.section}  ·  jar ${p.num}`, small, SEPIA, 'center', 6);
    if (p.known) line(`${p.section}  ·  jar ${p.num}${p.isNew ? '  ·  NEW' : ''}`, small - 1, DIM, 'center', 4);
    rule();
    const budget = maxH - 40;
    if (p.known) {
      const loreLines = this.wrap(p.lore, inner, small);
      const rest = (p.stats.length ? Math.ceil(Math.min(6, p.stats.length) / 2) * (small + 3) + 8 : 0) + (p.moves.length ? 40 : 0) + (p.weak ? 44 : 0) + small + 160;
      const room = Math.max(2, Math.floor((budget - y - rest) / (small + 3)));
      const shown = loreLines.slice(0, room);
      if (loreLines.length > room) shown[room - 1] = shown[room - 1].replace(/[ ,.;:]*\S*$/, '') + '...';
      for (const l of shown) line(l, small, INK, 'left', 3);
      if (p.stats.length) {
        y += 4;
        const col = inner / 2;
        p.stats.slice(0, 6).forEach(([lab, val], i) => {
          const yy = y + Math.floor(i / 2) * (small + 3);
          const xx = x + pad + (i % 2) * col;
          ops.push((y0) => {
            this.ink(lab, xx, y0 + yy, SEPIA, small - 1);
            this.ink(val, xx + col - 10, y0 + yy, INK, small - 1, 'right');
          });
        });
        y += Math.ceil(Math.min(6, p.stats.length) / 2) * (small + 3) + 4;
      }
      if (p.moves.length) {
        const mv = this.wrap(p.moves.slice(0, 4).map((m) => `"${m}"`).join('   '), inner, small - 1).slice(0, 2);
        for (const l of mv) line(l, small - 1, RED, 'left', 3);
      }
      if (p.weak) {
        const wl = this.wrap('Weak spot: ' + p.weak, inner, small - 1).slice(0, 2);
        for (const l of wl) line(l, small - 1, SEPIA, 'left', 3);
      }
      line(p.points, small - 1, DIM, 'left', 6);
    } else {
      for (const l of this.wrap('Nobody has found this one yet. Thoth keeps a sheet over the jar until somebody does.', inner, small)) line(l, small, INK, 'left', 3);
      if (p.hint) {
        y += 6;
        for (const l of this.wrap('Hint: ' + p.hint, inner, small)) line(l, small, RED, 'left', 3);
      }
    }
    rule();
    // THOTH'S STUDY
    line("THOTH'S STUDY", 18, '#1f2f66', 'center', 4);
    const st = p.study;
    if (!st) {
      for (const l of this.wrap('Find it first. Then Thoth can study it.', inner, small)) line(l, small, SEPIA, 'center', 3);
    } else {
      line(st.text, small, INK, 'center', 6);
      const by = y;
      const k = st.need ? st.cur / st.need : 1;
      const done = st.state === 'done' || st.state === 'ready';
      ops.push((y0) => {
        const c = this.c;
        c.globalAlpha = a;
        bar(c, x + pad + 6, y0 + by, inner - 60, 14, k, done);
        c.globalAlpha = 1;
        this.ink(`${Math.min(st.cur, st.need)} / ${st.need}`, x + W - pad - 6, y0 + by - 1, INK, small, 'right');
      });
      y += 24;
      if (st.state === 'ready') {
        const yy = y;
        ops.push((y0) => this.button('study', 'COMPLETE STUDY', x + W / 2, y0 + yy, { state: 2, align: 'center' }));
        y += 36;
      } else if (st.state === 'done') {
        const yy = y;
        ops.push((y0) => {
          this.blit(seal(9), x + W / 2 - 10.5 * S - 50, y0 + yy - 4, a);
          this.ink('STUDIED', x + W / 2 + 14, y0 + yy + 4, '#7c5214', 20, 'center');
        });
        y += 30;
      } else y += 4;
    }
    const h = Math.min(maxH, y + 14);
    const hPx = Math.ceil(h / S), wPx = Math.ceil(W / S);
    this.blit(papyrus(wPx, hPx, 3), x, top, a);
    this.rect('panel', x, top, W, h);
    for (const op of ops) op(top);
  }

  // ---------------------------------------------------------------- the errand slip
  private drawErrand(e: ErrandSlip | null, satchel: string | null) {
    const S = this.S;
    const W = Math.min(this.narrow ? this.W * 0.46 : 330, 360);
    const x = this.W - W - 16, top = 64;
    const pad = 18, size = this.narrow ? 13 : 15;
    let y = 16;
    const ops: ((y0: number) => void)[] = [];
    const line = (s: string, sz: number, col: string, gap = 3, align: CanvasTextAlign = 'left') => {
      const yy = y;
      ops.push((y0) => this.ink(s, align === 'center' ? x + W / 2 : x + pad, y0 + yy, col, sz, align));
      y += sz + gap;
    };
    line("THOTH'S ERRAND", 18, '#1f2f66', 6, 'center');
    if (!e || e.state === 'none') {
      for (const l of this.wrap('No errands right now. Thoth is thinking of one. He thinks very slowly.', W - pad * 2, size)) line(l, size, SEPIA);
    } else {
      if (e.state === 'offer') for (const l of this.wrap(`"${e.ask}"`, W - pad * 2, size)) line(l, size, INK);
      else line(e.objective, size, INK, 4);
      if (e.state !== 'offer' && e.progress) line(e.progress, size, RED, 4);
      line(e.reward, size - 1, SEPIA, 8);
      const yy = y;
      if (e.state === 'offer') {
        ops.push((y0) => {
          const w1 = this.button('errand:take', 'TAKE IT', x + pad, y0 + yy, { state: this.hover === 'errand:take' ? 1 : 0 });
          this.button('errand:skip', 'ANOTHER', x + pad + w1 + 8, y0 + yy, { dim: true });
        });
        y += 34;
      } else if (e.state === 'met') {
        ops.push((y0) => this.button('errand:turnin', 'TELL THOTH', x + pad, y0 + yy, { state: 2 }));
        y += 36;
      } else {
        ops.push((y0) => this.button('errand:drop', 'GIVE UP', x + W - pad, y0 + yy, { dim: true, align: 'right', size: 14 }));
        y += 30;
      }
    }
    if (satchel) {
      y += 2;
      for (const l of this.wrap('Packed for your next ride: ' + satchel, W - pad * 2, size - 1)) line(l, size - 1, '#2a6a3a');
    }
    const h = y + 10;
    this.blit(papyrus(Math.ceil(W / S), Math.ceil(h / S), 9), x, top);
    // a gold pin
    px(this.c, x + W / 2 - 3, top - 4, 6, 6, G.o);
    px(this.c, x + W / 2 - 2, top - 3, 4, 4, G.l);
    px(this.c, x + W / 2 - 1, top - 2, 1, 1, G.h);
    for (const op of ops) op(top);
  }

  // ---------------------------------------------------------------- the gift ladder (desk)
  private drawGifts(s: HallUIState) {
    const S = this.S;
    const a = this.panelK;
    const W = this.panelWidth();
    const x = this.W - W - 16 + (1 - a) * (W + 30), top = 64;
    const pad = 22, size = this.narrow ? 13 : 15;
    const rows = s.gifts ?? [];
    const maxH = this.H - top - 120;
    const rowH = Math.min(size + 8, Math.floor((maxH - 80) / Math.max(1, rows.length)));
    const h = 64 + rows.length * rowH + 16;
    this.blit(papyrus(Math.ceil(W / S), Math.ceil(h / S), 13), x, top, a);
    this.ink("THOTH'S GIFTS", x + W / 2, top + 16, RED, 22, 'center', false, a);
    this.ink(`${s.studies} studies finished`, x + W / 2, top + 42, SEPIA, size, 'center', false, a);
    rows.forEach((g, i) => {
      const yy = top + 64 + i * rowH;
      const next = !g.given && (i === 0 || rows[i - 1].given);
      const col = g.given ? '#2a6a3a' : next ? INK : DIM;
      this.ink(String(g.at), x + pad + 18, yy, col, size, 'right', false, a);
      this.ink(g.name, x + pad + 30, yy, col, size, 'left', false, a);
      if (g.given) this.blit(seal(4), x + W - pad - 14, yy - 2, a, Math.max(1, S - 1));
      else if (next) this.ink('next', x + W - pad, yy, RED, size - 2, 'right', false, a);
    });
    this.rect('panel', x, top, W, h);
  }
}
