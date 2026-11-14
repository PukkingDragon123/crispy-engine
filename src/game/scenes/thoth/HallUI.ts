// Thoth's Hall: the screen furniture as stylized pixel art (the PixelUI kit's way: sprites drawn at
// UI pixel size into cached canvases, blitted nearest-neighbour at an integer scale; small type is
// Alagard set at its native size over them so it stays crisp). Thoth's colours: night lapis, gold
// rope, papyrus. Nothing here is a flat panel: every piece is a small living thing.
//
//  - THE SPECIMEN SHEET is a real page: when you pick another entry the old sheet lifts by its edge
//    and turns over the binding (a bending page, strip by strip, its back showing, its shadow on the
//    page under it); grab the sheet and drag sideways to turn it yourself, the page following your hand
//  - INKWELL, a bookworm librarian, is the bookmark (PageWorm): a physics earthworm holding the page
//    with its tail, swinging when pages turn, sniffing at your cursor; tug it down to turn the page,
//    tap it and it squirms (and the hall's own bookworms say something about it)
//  - THOTH'S STUDY is living ink (InkCircuit): a limestone cartouche carved with a channel from an
//    inkwell through the entry's glyph to a seal; the ink really flows in when the page opens, filled
//    as far as the study has come. Touch the ink and it ripples and splashes. When the study is ready
//    the ink swirls into the seal; press the seal to complete it and a wave of gold runs back up the
//    channels and sparks fly
//  - THE GIFTS at his desk are an astrolabe (Astrolabe): a spinning pierced rete you can fling, gift
//    sockets on the limb, ink poured round the scale up to the studies done, an alidade that swings to
//    the gift you tap
//  - THE WINGS are a row of cedar catalogue drawers: they slide out under the cursor, index cards
//    rising in them as the wing fills, a red card for something new, a gold seal for a study ready
//  - the hall's cartouche (top left) pours the studies toward the next gift into an ink gauge
//  - CLOSE / BACK plates, the errand slip, the jar markers, the STUDY COMPLETE banner, the hover tag
// (Thoth's own words are not here: he speaks in floating 3D text, see fx/WorldSpeech.)
// Taps and clicks are tested against the drawn rects (hit()); drags and presses come in through
// pointer() and leave as actions (takeActions()), so mouse and touch work the same.
import { UI, FONT, px, sprite } from '../../ui/PixelUI';
import { uiSfx } from '../../ui/HudKit';
import { HUD_ART as ART } from '../../ui/HudArt';
import { GIFTS, type StudyState } from '../../meta/Research';
import { InkCircuit, type InkState } from './InkCircuit';
import { PageWorm } from './PageWorm';
import { Astrolabe } from './Astrolabe';

export interface PanelData {
  key: string;
  name: string;
  title: string;
  section: string;
  num: number;
  /** entries in the section (for turning past the ends) */
  total?: number;
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

/** a cedar catalogue drawer front: planked grain, a bevel, a brass card frame with a papyrus card, a cup pull */
function drawerFront(w: number, h: number, seed: number, hot: boolean) {
  return spr(`dr:${w}:${h}:${seed}:${hot}`, w, h, (c) => {
    const WD = hot ? ['#24140a', '#5e3a1e', '#7e4e26', '#9c6532', '#c08a4a'] : ['#24140a', '#4f2f15', '#6a4020', '#86552a', '#a8743c'];
    px(c, 0, 0, w, h, WD[0]);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const grain = Math.sin(x * 0.35 + Math.sin(y * 0.9 + seed) * 2.2 + seed) + (h2(x >> 2, y + seed) - 0.5) * 0.8;
        let col = grain > 0.75 ? WD[3] : grain < -0.8 ? WD[1] : WD[2];
        if (y === 1 || x === 1) col = WD[4];
        if (y === h - 2 || x === w - 2) col = WD[1];
        c.fillStyle = col;
        c.fillRect(x, y, 1, 1);
      }
    // the brass card frame and its card
    const fw = Math.max(10, Math.round(w * 0.82)), fh = Math.max(6, h - 8);
    const fx = Math.round((w - fw) / 2), fy = 2;
    px(c, fx, fy, fw, fh, G.o);
    px(c, fx + 1, fy + 1, fw - 2, fh - 2, G.m);
    px(c, fx + 1, fy + 1, fw - 2, 1, G.h);
    px(c, fx + 2, fy + 2, fw - 4, fh - 4, P.l);
    for (let x = fx + 3; x < fx + fw - 3; x++) if (h2(x, seed) < 0.25) px(c, x, fy + 2 + Math.floor(h2(seed, x) * (fh - 4)), 1, 1, P.f);
    px(c, fx + 2, fy + fh - 3, fw - 4, 1, P.m);
    // rivets at the frame's ends
    px(c, fx + 1, fy + Math.floor(fh / 2), 1, 1, G.h);
    px(c, fx + fw - 2, fy + Math.floor(fh / 2), 1, 1, G.h);
    // the cup pull under it
    const pw = 7, pxx = Math.round(w / 2 - pw / 2), py = h - 5;
    px(c, pxx, py, pw, 3, G.o);
    px(c, pxx + 1, py, pw - 2, 2, G.m);
    px(c, pxx + 1, py, pw - 2, 1, G.h);
    px(c, pxx + 2, py + 1, pw - 4, 1, G.d);
  });
}

/** the back of a sheet: plain papyrus, the ink of the other side faintly showing through, mirrored */
function pageBack(front: HTMLCanvasElement, w: number, h: number, dpr: number, S: number) {
  const cv = document.createElement('canvas');
  cv.width = front.width;
  cv.height = front.height;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.drawImage(papyrus(Math.ceil(w / S), Math.ceil(h / S), 17, false), 0, 0, Math.ceil(w / S) * S * dpr, Math.ceil(h / S) * S * dpr);
  c.globalAlpha = 0.13;
  c.translate(cv.width, 0);
  c.scale(-1, 1);
  c.drawImage(front, 0, 0);
  return cv;
}

interface Page {
  key: string;
  sig: string;
  num: number;
  section: string;
  cv: HTMLCanvasElement;
  back: HTMLCanvasElement | null;
  w: number;
  h: number;
  /** the study cartouche on the page (page px) */
  ink: { x: number; y: number; w: number; h: number; c: InkCircuit } | null;
  study: StudyState | null;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  col: string;
}
type Gesture =
  | { kind: 'page'; x0: number; y0: number; dir: 0 | 1 | -1; lastX: number; vx: number }
  | { kind: 'worm' }
  | { kind: 'seal'; x: number; y: number }
  | { kind: 'ink' }
  | { kind: 'astro' };

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
  private bannerT = -1;
  private bannerLast: HallUIState['banner'] = null;
  private onResize = () => this.resize();
  hover = '';
  // the living pieces
  private worm = new PageWorm();
  private wormAt = { x: 0, y: 0 };
  private inks = new Map<string, InkCircuit>();
  private gauge: { c: InkCircuit; key: string } | null = null;
  private astro: Astrolabe | null = null;
  private astroAt = { x: 0, y: 0 };
  private astroSel = -1;
  private page: Page | null = null;
  private old: Page | null = null;
  private turn: { dir: 1 | -1; k: number; v: number; held: boolean } | null = null;
  private pend: { dir: 1 | -1; k: number; held: boolean; t: number } | null = null;
  private rubber = 0;
  private rubberDir = 0;
  private sheet = { x: 0, y: 0, w: 0, h: 0 };
  private gest: Gesture | null = null;
  private actions: string[] = [];
  private ptr = { x: -1, y: -1, has: false };
  private sparks: Spark[] = [];
  private drawer: { o: number; v: number }[] = [];
  private lastView = '';
  private lastStudy = { key: '', state: '' as StudyState | '' };
  private sealPress = 0;

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
    this.page = null;
    this.old = null;
    this.turn = null;
    this.astro = null;
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
  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.canvas.remove();
    this.inks.clear();
    this.page = this.old = null;
    this.astro = null;
  }
  /** what the hand did on the living pieces (act ids for the hall) */
  takeActions() {
    return this.actions.splice(0);
  }

  // ======================================================================= pointer (drags and presses)
  /** a pointer event; true when the UI takes the gesture (the hall then ignores it as a click or swipe) */
  pointer(type: 'down' | 'move' | 'up', x: number, y: number): boolean {
    const S = this.S;
    this.ptr.x = x;
    this.ptr.y = y;
    this.ptr.has = true;
    if (this.astro) this.astro.move((x - this.astroAt.x) / S, (y - this.astroAt.y) / S);
    if (type === 'down') {
      this.gest = null;
      // the bookmark worm
      if (this.worm.alpha > 0.5 && this.worm.down(x, y, S)) {
        this.gest = { kind: 'worm' };
        uiSfx('squeak', 0.12, 1.8);
        return true;
      }
      // the astrolabe
      if (this.astro && this.astro.down((x - this.astroAt.x) / S, (y - this.astroAt.y) / S)) {
        this.gest = { kind: 'astro' };
        return true;
      }
      // the study cartouche: the seal, or the ink
      const ink = this.inkScreen();
      if (ink && x >= ink.x && x <= ink.x + ink.w && y >= ink.y && y <= ink.y + ink.h) {
        const u = (x - ink.x) / S, v = (y - ink.y) / S;
        if (ink.c.onSeal(u, v) && this.page?.study === 'ready') {
          this.gest = { kind: 'seal', x, y };
          this.sealPress = 0.001;
          uiSfx('card_pick', 0.4, 0.7);
          return true;
        }
        if (ink.c.touch(u, v)) uiSfx('ui_hover', 0.18, 0.55);
        this.gest = { kind: 'ink' };
        return true;
      }
      // the sheet itself: drag it sideways to turn it
      const sh = this.sheet;
      if (this.page && !this.turn && sh.w > 0 && x >= sh.x && x <= sh.x + sh.w && y >= sh.y && y <= sh.y + sh.h) {
        this.gest = { kind: 'page', x0: x, y0: y, dir: 0, lastX: x, vx: 0 };
        return true;
      }
      return false;
    }
    const g = this.gest;
    if (!g) return false;
    if (type === 'move') {
      if (g.kind === 'worm') this.worm.move(x, y);
      else if (g.kind === 'page') this.dragPage(g, x, y);
      return true;
    }
    // up
    this.gest = null;
    if (g.kind === 'worm') {
      const r = this.worm.up();
      if (r === 'poke') this.actions.push('worm');
      else if (r === 'next' && this.page) {
        if (this.canTurn(1)) {
          this.actions.push('sel:1');
          this.pend = { dir: 1, k: 0, held: false, t: 0 };
        } else this.bump(1);
      }
    } else if (g.kind === 'astro' && this.astro) {
      const i = this.astro.up((x - this.astroAt.x) / S, (y - this.astroAt.y) / S);
      if (i >= 0) {
        this.astroSel = i;
        this.actions.push('gift:' + i);
        uiSfx('gem_chime', 0.35, 1.1 + i * 0.03);
      }
    } else if (g.kind === 'seal') {
      // the press completes as the seal goes down (update); a release before that still counts
      if (this.sealPress > 0 && this.sealPress < 1) this.sealPress = 1;
    } else if (g.kind === 'page') {
      const held = this.turn?.held ? this.turn : this.pend?.held ? this.pend : null;
      if (held) {
        held.held = false;
        if ('v' in held) held.v = Math.max(2.5, Math.abs(g.vx) / Math.max(1, this.sheet.w) * 1.2);
      }
    }
    return true;
  }

  private canTurn(dir: 1 | -1) {
    const p = this.page;
    if (!p) return false;
    const n = p.num + dir;
    const total = this.lastTotal || 9999;
    return n >= 1 && n <= total;
  }
  private lastTotal = 0;
  /** the page cannot turn (the first or last entry): it lifts a little and drops back */
  private bump(dir: number) {
    this.rubber = 1;
    this.rubberDir = dir;
    uiSfx('paper_flutter', 0.3, 1.3);
  }
  private dragPage(g: Extract<Gesture, { kind: 'page' }>, x: number, y: number) {
    g.vx = (x - g.lastX) * 60;
    g.lastX = x;
    const dx = x - g.x0;
    if (g.dir === 0) {
      if (Math.abs(dx) > 22 && Math.abs(dx) > Math.abs(y - g.y0) * 1.2) {
        const dir: 1 | -1 = dx < 0 ? 1 : -1;
        if (this.canTurn(dir)) {
          g.dir = dir;
          this.actions.push('sel:' + dir);
          this.pend = { dir, k: 0, held: true, t: 0 };
          uiSfx('paper_flutter', 0.35, 1.1);
        } else {
          this.bump(dir);
          this.gest = null;
        }
      }
      return;
    }
    const k = Math.max(0, Math.min(1, (Math.abs(dx) - 22) / Math.max(80, this.sheet.w * 0.85)));
    if (this.turn?.held) this.turn.k = k;
    else if (this.pend) this.pend.k = k;
  }

  private inkScreen() {
    const p = this.page;
    if (!p?.ink || this.turn || this.panelK < 0.9) return null;
    return { x: this.sheet.x + p.ink.x, y: this.sheet.y + p.ink.y, w: p.ink.w, h: p.ink.h, c: p.ink.c };
  }

  // ======================================================================= frame
  frame(rdt: number, s: HallUIState) {
    this.t += rdt;
    const c = this.c;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    c.imageSmoothingEnabled = false;
    this.rects = [];
    const k = (v: number, want: boolean, up = 6, down = 9) => v + ((want ? 1 : 0) - v) * (1 - Math.exp(-rdt * (want ? up : down)));
    const pk = s.panel ? s.panel.key : s.gifts ? 'gifts' : '';
    const sameSection = !!s.panel && !!this.page && this.panelKey !== 'gifts' && s.panel.section === this.page.section;
    if (pk !== this.panelKey) {
      if (sameSection && pk && this.panelK > 0.5) {
        // another entry in the same wing: the page turns instead of the sheet sliding away
        this.panelKey = pk;
      } else {
        if (this.panelK < 0.05 || !this.panelKey) this.panelKey = pk;
        this.panelK = k(this.panelK, false, 8, 14);
      }
    } else this.panelK = k(this.panelK, !!pk, 6, 12);
    if (s.view !== this.lastView) {
      if (s.view === 'desk') this.astro?.pour();
      if (s.view === 'nave') this.gauge = null;
      this.lastView = s.view;
    }

    this.drawMarkers(s);
    this.drawTitle(s, rdt);
    this.drawButtons(s);
    this.drawTabs(s, rdt);
    if (s.view === 'wing') this.drawPager(s);
    if (s.view === 'nave') this.drawErrand(s.errand, s.satchel);
    let wormAnchor: { x: number; y: number; wall: number } | null = null;
    if (this.panelKey && this.panelKey !== 'gifts' && s.panel && s.panel.key === this.panelKey) wormAnchor = this.drawPanel(s.panel, rdt);
    else if (this.panelKey === 'gifts' && s.gifts) wormAnchor = this.drawAstrolabe(s, rdt);
    else {
      this.sheet.w = 0;
      if (s.view === 'nave' && this.errandBox) wormAnchor = { x: this.errandBox.x + 3, y: this.errandBox.y + 10, wall: this.errandBox.x };
    }
    this.drawWorm(rdt, wormAnchor);
    this.drawSparks(rdt);
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
  private spark(x: number, y: number, n: number, cols: string[], power = 1) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
      const sp = (60 + Math.random() * 160) * power;
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.7, col: cols[i % cols.length] });
    }
  }
  private drawSparks(rdt: number) {
    const S = this.S;
    for (const p of this.sparks) {
      p.vy += 420 * rdt;
      p.vx *= 1 - rdt * 1.5;
      p.x += p.vx * rdt;
      p.y += p.vy * rdt;
      p.life -= rdt;
      this.c.globalAlpha = Math.min(1, p.life * 3);
      px(this.c, Math.round(p.x / S) * S, Math.round(p.y / S) * S, S, S, p.life > 0.35 ? p.col : G.d);
    }
    this.c.globalAlpha = 1;
    this.sparks = this.sparks.filter((p) => p.life > 0);
  }

  // ---------------------------------------------------------------- pieces
  private drawTitle(s: HallUIState, rdt: number) {
    const S = this.S;
    const t1 = "THOTH'S HALL";
    const sub = s.nextGift ? `Studies ${s.studies}  ·  next gift at ${s.nextGift.at}` : `Studies ${s.studies}  ·  every gift given`;
    const wPx = Math.ceil((Math.max(this.tw(t1, 24), this.tw(sub, 14)) + 26) / S);
    const gh = 9;
    const hPx = Math.ceil(60 / S) + gh + 2;
    const x = 14, y = 12;
    this.blit(lapisPlate(wPx, hPx, false, 11), x, y);
    this.ink(t1, x + (wPx * S) / 2, y + 8, '#ffd36b', 24, 'center', true);
    this.ink(sub, x + (wPx * S) / 2, y + 36, '#cfdcf6', 14, 'center');
    // the gauge: ink poured toward the next gift, a pool at every study between
    const gw = wPx - 10;
    const prev = s.nextGift ? (GIFTS[GIFTS.findIndex((g) => g.at === s.nextGift!.at) - 1]?.at ?? 0) : 0;
    const span = s.nextGift ? Math.max(1, s.nextGift.at - prev) : 1;
    const key = `${gw}:${span}`;
    if (!this.gauge || this.gauge.key !== key) {
      this.gauge = { c: InkCircuit.gauge(gw, gh, Math.min(span, Math.floor(gw / 6))), key };
      this.gauge.c.reset();
    }
    const gc = this.gauge.c;
    gc.target = s.nextGift ? (s.studies - prev) / span : 1;
    gc.state = s.nextGift ? 'study' : 'done';
    gc.update(rdt);
    gc.draw();
    this.blit(gc.canvas, x + 5 * S, y + (hPx - gh - 3) * S);
  }

  private drawButtons(s: HallUIState) {
    let x = this.W - 16;
    const w = this.button('close', 'CLOSE', x, 14, { align: 'right' });
    x -= w + 10;
    if (s.view !== 'nave') this.button('back', s.touch ? 'BACK' : 'BACK  (Esc)', x, 14, { align: 'right' });
    else this.button('desk', "THOTH'S DESK", x, 14, { align: 'right' });
  }

  /** the wings: a row of cedar catalogue drawers that slide out, index cards rising as the wing fills */
  private drawTabs(s: HallUIState, rdt: number) {
    const S = this.S;
    const n = s.wings.length;
    const size = this.narrow ? 13 : 15;
    const gap = 6;
    const maxW = this.W - 32;
    const names = s.wings.map((w) => w.name);
    const each = Math.min(Math.ceil((Math.max(...names.map((nm) => this.tw(nm, size))) + 26) / S), Math.floor((maxW - gap * (n - 1)) / n / S));
    const hPx = Math.ceil((size * 2 + 22) / S);
    const total = n * each * S + (n - 1) * gap;
    let x = Math.round(this.W / 2 - total / 2);
    const baseY = this.H - hPx * S - (s.touch ? 12 : 30);
    while (this.drawer.length < n) this.drawer.push({ o: 0, v: 0 });
    s.wings.forEach((w, i) => {
      const act = i === s.activeWing, hot = this.hover === 'wing:' + i || s.hoverWing === i;
      const d = this.drawer[i];
      const want = act ? 1 : hot ? 0.5 : 0;
      // a spring: the drawer runs out on its slides and settles with a little bounce
      d.v += ((want - d.o) * 160 - d.v * 13) * rdt;
      d.o += d.v * rdt;
      if (hot && !d.v && Math.abs(want - d.o) < 0.01) d.o = want;
      const lift = Math.round(d.o * 5) * S;
      const y = baseY - lift;
      // index cards standing up in the drawer: more as the wing fills; a red one for something new
      const cards = Math.max(w.found ? 1 : 0, Math.round((w.found / Math.max(1, w.total)) * 6));
      const rise = Math.round(d.o * 7);
      for (let k = 0; k < cards; k++) {
        const cw = Math.max(5, Math.round(each * 0.22)), cx = x + (3 + ((k * 7 + i * 3) % Math.max(1, each - cw - 6))) * S;
        const ch = 4 + rise + (k % 2);
        const cy = y - ch * S + 2 * S;
        px(this.c, cx, cy, cw * S, ch * S, P.o);
        px(this.c, cx + S, cy + S, (cw - 2) * S, ch * S, k % 3 === 0 ? P.h : P.l);
        px(this.c, cx + S, cy + 2 * S, (cw - 2) * S, S, P.f);
      }
      if (w.fresh > 0) {
        const cx = x + (each - 8) * S, ch = 6 + rise;
        px(this.c, cx, y - ch * S + 2 * S, 5 * S, ch * S, '#5a1408');
        px(this.c, cx + S, y - ch * S + 3 * S, 3 * S, ch * S, RED);
      }
      // the drawer's shadow on the cabinet as it comes out
      if (d.o > 0.05) {
        this.c.globalAlpha = Math.min(0.5, d.o * 0.5);
        px(this.c, x + S, baseY + hPx * S - S, each * S, S * 2, '#000');
        this.c.globalAlpha = 1;
      }
      this.blit(drawerFront(each, hPx, 20 + i, act || hot), x, y);
      const cardMid = y + (2 + (hPx - 8) / 2) * S;
      this.ink(w.name, x + (each * S) / 2, cardMid - size + 1, act ? RED : INK, size, 'center');
      this.ink(`${w.found} / ${w.total}`, x + (each * S) / 2, cardMid + 1, SEPIA, size - 2, 'center');
      if (w.ready > 0) this.blit(seal(5), x + each * S - 9 * (S / 2) - 6, y - 6, 1, Math.max(1, S - 1));
      this.rect('wing:' + i, x, y, each * S, hPx * S);
      x += each * S + gap;
    });
  }

  private drawPager(s: HallUIState) {
    if (!s.page || s.page.total <= 1) return;
    const S = this.S;
    const size = this.narrow ? 13 : 15;
    const y = this.H - (s.touch ? 12 : 30) - Math.ceil((size * 2 + 22) / S) * S - 17 * S - 22;
    const label = `SHELF ${s.page.cur + 1} / ${s.page.total}`;
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

  // ---------------------------------------------------------------- the bookmark worm
  private drawWorm(rdt: number, a: { x: number; y: number; wall: number } | null) {
    const w = this.worm;
    if (!a) {
      w.alpha = Math.max(0, w.alpha - rdt * 5);
      return;
    }
    // a jump (another view's furniture): it lets go and climbs on there instead
    if (Math.hypot(a.x - this.wormAt.x, a.y - this.wormAt.y) > 90) {
      if (w.alpha > 0.05) {
        w.alpha = Math.max(0, w.alpha - rdt * 6);
        w.draw(this.c, this.S);
        return;
      }
      this.wormAt = { x: a.x, y: a.y };
      this.worm = new PageWorm();
      this.worm.alpha = 0;
    }
    const W = this.worm;
    // the sheet carries it (a slide swings it on its tail)
    const dx = a.x - this.wormAt.x;
    if (Math.abs(dx) > 0.5) W.kick(dx * 18);
    this.wormAt = { x: a.x, y: a.y };
    W.anchor(a.x, a.y, a.wall);
    W.alpha = Math.min(1, W.alpha + rdt * 3);
    W.update(rdt, this.S, this.ptr);
    W.draw(this.c, this.S);
    if (W.alpha > 0.5) {
      const b = W.box;
      if (b.w) this.rect('worm', b.x + b.w * 0.2, b.y + b.h * 0.25, b.w * 0.6, b.h * 0.75);
    }
  }

  // ---------------------------------------------------------------- the specimen sheet
  /** the sheet as a page canvas (redrawn only when its words change) */
  private renderPage(p: PanelData, W: number, maxH: number): Page {
    const S = this.S;
    const pad = 22;
    const inner = W - pad * 2;
    const small = this.narrow ? 13 : 15;
    const ops: ((c: CanvasRenderingContext2D) => void)[] = [];
    let y = 18;
    const line = (s: string, size: number, col: string, align: CanvasTextAlign = 'left', gap = 4) => {
      const yy = y;
      ops.push(() => this.ink(s, align === 'center' ? W / 2 : pad, yy, col, size, align));
      y += size + gap;
    };
    const rule = () => {
      const yy = y + 2;
      ops.push((c) => {
        px(c, pad + 10, yy, inner - 20, 2, G.m);
        px(c, W / 2 - 3, yy - 2, 6, 6, G.d);
        px(c, W / 2 - 1, yy, 2, 2, G.h);
      });
      y += 12;
    };
    // the cartouche's size in UI px
    const cw = Math.max(90, Math.min(200, Math.floor(inner / S) - 4));
    const ch = Math.max(26, Math.min(34, Math.floor(cw * 0.2)));
    const inkH = ch * S + 6;
    const nameSize = this.tw(p.name, 26) > inner || maxH < 300 ? 20 : 26;
    line(p.known ? p.name : 'Under the dust sheet', nameSize, p.known ? RED : SEPIA, 'center', 2);
    line(p.known ? p.title : `${p.section}  ·  jar ${p.num}`, small, SEPIA, 'center', 6);
    if (p.known) line(`${p.section}  ·  jar ${p.num}${p.isNew ? '  ·  NEW' : ''}`, small - 1, DIM, 'center', 4);
    rule();
    // the study block at the foot is always kept whole; the story above it gives way on a short screen
    const studyH = 12 + 22 + (small + 4) + inkH + (small + 2) + 14;
    const avail = maxH - y - studyH;
    if (p.known) {
      const loreLines = this.wrap(p.lore, inner, small);
      const short = maxH < 420;
      if (short) p = { ...p, moves: [], weak: undefined };
      // stats rows that fit (keeping a line for the points), the rest of the room for the lore
      const rows = Math.max(0, Math.min(Math.ceil(Math.min(6, p.stats.length) / 2), Math.floor((avail - (small + 7) - 8) / (small + 3))));
      p = { ...p, stats: p.stats.slice(0, rows * 2) };
      const rest = (rows ? rows * (small + 3) + 8 : 0) + (p.moves.length ? 40 : 0) + (p.weak ? 44 : 0) + small + 7;
      const room = Math.max(0, Math.floor((avail - rest) / (small + 3)));
      const shown = loreLines.slice(0, room);
      if (loreLines.length > room && room > 0) shown[room - 1] = shown[room - 1].replace(/[ ,.;:]*\S*$/, '') + '...';
      for (const l of shown) line(l, small, INK, 'left', 3);
      if (p.stats.length) {
        y += 4;
        const col = inner / 2;
        let ci = 0;
        for (const [lab, val] of p.stats.slice(0, 6)) {
          const wide = this.tw(lab, small - 1) + this.tw(val, small - 1) + 22 > col;
          if (wide && ci === 1) {
            ci = 0;
            y += small + 3;
          }
          const yy = y, xx = pad + ci * col, cwid = wide ? inner : col;
          ops.push(() => {
            this.ink(lab, xx, yy, SEPIA, small - 1);
            this.ink(val, xx + cwid - 10, yy, INK, small - 1, 'right');
          });
          if (wide || ci === 1) {
            ci = 0;
            y += small + 3;
          } else ci = 1;
        }
        if (ci === 1) y += small + 3;
        y += 4;
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
      const lines = Math.max(1, Math.floor(avail / (small + 3)));
      const hint = p.hint ? this.wrap('Hint: ' + p.hint, inner, small).slice(0, Math.max(0, Math.min(2, lines - 1))) : [];
      for (const l of this.wrap('Nobody has found this one yet. Thoth keeps a sheet over the jar until somebody does.', inner, small).slice(0, Math.max(0, lines - hint.length))) line(l, small, INK, 'left', 3);
      for (const l of hint) line(l, small, RED, 'left', 3);
    }
    rule();
    // THOTH'S STUDY: the ink cartouche
    line("THOTH'S STUDY", 18, '#1f2f66', 'center', 4);
    const st = p.study;
    const hold: { ink: Page['ink'] } = { ink: null };
    const placeInk = () => {
      const ix = Math.round((W - cw * S) / 2), iy = y;
      let c = this.inks.get(p.key + ':' + cw);
      if (!c) {
        c = InkCircuit.glyph(p.key, cw, ch);
        this.inks.set(p.key + ':' + cw, c);
        if (this.inks.size > 40) this.inks.delete(this.inks.keys().next().value!);
      }
      hold.ink = { x: ix, y: iy, w: cw * S, h: ch * S, c };
      y += ch * S + 6;
    };
    if (!st) {
      placeInk();
      for (const l of this.wrap('The channels are dry. Find it first, then Thoth can study it.', inner, small - 1).slice(0, 2)) line(l, small - 1, SEPIA, 'center', 3);
    } else {
      line(st.text, small, INK, 'center', 4);
      placeInk();
      const words = st.state === 'done' ? 'STUDIED: the seal is stamped in gold' : st.state === 'ready' ? 'The ink is in the seal. Press the seal!' : `${Math.min(st.cur, st.need)} of ${st.need}: the ink has come this far`;
      line(words, small - 1, st.state === 'ready' ? RED : st.state === 'done' ? '#7c5214' : SEPIA, 'center', 3);
    }
    const h = Math.min(maxH, y + 14);
    // draw it all into the page canvas
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(W * this.dpr);
    cv.height = Math.ceil(h * this.dpr);
    const pc = cv.getContext('2d')!;
    pc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    pc.imageSmoothingEnabled = false;
    const keep = this.c;
    this.c = pc;
    this.blit(papyrus(Math.ceil(W / S), Math.ceil(h / S), 3), 0, 0);
    for (const op of ops) op(pc);
    this.c = keep;
    return { key: p.key, sig: '', num: p.num, section: p.section, cv, back: null, w: W, h, ink: hold.ink, study: st?.state ?? null };
  }

  /** returns where the bookmark worm holds on */
  private drawPanel(p: PanelData, rdt: number) {
    const S = this.S;
    const a = this.panelK;
    this.lastTotal = p.total ?? 0;
    const W = this.panelWidth();
    const x = this.W - W - 16 + (1 - a) * (W + 30);
    const top = 64;
    const size = this.narrow ? 13 : 15;
    const maxH = this.H - top - Math.ceil((size * 2 + 22) / S) * S - 56;
    const sig = JSON.stringify(p) + W + ':' + maxH + ':' + S;
    if (!this.page || this.page.sig !== sig) {
      const np = this.renderPage(p, W, maxH);
      np.sig = sig;
      const prev = this.page;
      if (prev && prev.key !== np.key && prev.section === np.section && a > 0.5) {
        // a new entry in the same wing: the page turns
        const dir: 1 | -1 = this.pend ? this.pend.dir : np.num > prev.num ? 1 : -1;
        this.old = prev;
        this.turn = { dir, k: this.pend?.k ?? 0, v: 0, held: this.pend?.held ?? false };
        this.pend = null;
        uiSfx('page_turn', 0.55, 0.95 + Math.random() * 0.1);
        this.worm.kick(dir * -260, -60);
        np.ink?.c.reset();
      } else if (!prev || prev.key !== np.key) np.ink?.c.reset();
      this.page = np;
    }
    if (this.pend) {
      this.pend.t += rdt;
      if (this.pend.t > 0.6) this.pend = null;
    }
    const pg = this.page;
    // the study's ink: pour toward its mark; a stamp sends the gold back up
    if (pg.ink) {
      const st = p.study;
      const ic = pg.ink.c;
      const state: InkState = !st ? 'dry' : st.state === 'done' ? 'done' : st.state === 'ready' ? 'ready' : 'study';
      if (this.lastStudy.key === p.key && this.lastStudy.state === 'ready' && st?.state === 'done') {
        ic.state = 'done';
        ic.stamp();
        const sx = x + pg.ink.x + (ic.seal ? ic.seal.x * S : pg.ink.w / 2), sy = top + pg.ink.y + (ic.seal ? ic.seal.y * S : 0);
        this.spark(sx, sy, 46, [G.h, G.l, '#ffffff', G.m], 1.3);
        uiSfx('divine_chime', 0.5, 1.2);
      }
      this.lastStudy = { key: p.key, state: st?.state ?? '' };
      ic.state = state;
      ic.target = !st ? 0 : st.state === 'done' || st.state === 'ready' ? 1 : st.need ? Math.min(1, st.cur / st.need) : 0;
      ic.press = Math.max(ic.press, this.sealPress > 0 ? 1 : 0);
      ic.update(rdt);
      if (ic.flowing && Math.random() < rdt * 3) uiSfx('paper_flutter', 0.05, 2.2);
    }
    // a press on the seal goes down, then the study completes
    if (this.sealPress > 0) {
      this.sealPress += rdt * 3.2;
      if (this.sealPress >= 1) {
        this.sealPress = 0;
        this.actions.push('study');
      }
    }
    // ---- the turn: a spring that carries the page over (or the hand holding it)
    const tr = this.turn;
    if (tr && !tr.held) {
      tr.v += ((1.02 - tr.k) * 70 - tr.v * 9) * rdt;
      tr.k = Math.min(1, tr.k + tr.v * rdt);
      if (tr.k >= 0.999) {
        this.turn = null;
        this.old = null;
      }
    }
    this.rubber = Math.max(0, this.rubber - rdt * 2.4);
    const flat = (pg2: Page, alpha: number) => {
      this.c.globalAlpha = alpha;
      this.c.drawImage(pg2.cv, Math.round(x), top, pg2.w, pg2.h);
      this.c.globalAlpha = 1;
    };
    this.sheet = { x: Math.round(x), y: top, w: W, h: pg.h };
    if (a < 0.01) return { x: x + 3, y: top + 10, wall: x };
    if (this.turn && this.old) {
      const T = this.turn;
      if (T.dir === 1) {
        flat(pg, a);
        this.drawInk(pg, x, top, a);
        this.curl(this.old, x, top, T.k * Math.PI);
      } else {
        flat(this.old, a);
        this.drawInk(this.old, x, top, a);
        this.curl(pg, x, top, (1 - T.k) * Math.PI);
      }
    } else if (this.rubber > 0) {
      // the page will not turn past the end: it lifts at the edge and drops back
      this.curl(pg, x, top, Math.sin(this.rubber * Math.PI) * 0.35, true);
    } else {
      flat(pg, a);
      this.drawInk(pg, x, top, a);
    }
    this.rect('panel', x, top, W, pg.h);
    const ins = this.inkScreen();
    if (ins) {
      this.rect('ink', ins.x, ins.y, ins.w, ins.h);
      if (pg.study === 'ready' && ins.c.seal) {
        const sl = ins.c.seal;
        this.rect('study', ins.x + (sl.x - sl.r) * S, ins.y + (sl.y - sl.r) * S, sl.r * 2 * S, sl.r * 2 * S);
      }
    }
    return { x: x + 3, y: top + 10, wall: x };
  }

  /** the cartouche's living ink over a flat page (and the seal's glow, the stamped ibis) */
  private drawInk(pg: Page, x: number, top: number, a: number) {
    if (!pg.ink) return;
    const S = this.S;
    const I = pg.ink;
    I.c.draw();
    const ix = Math.round(x + I.x), iy = top + I.y;
    const press = this.sealPress > 0 && pg === this.page ? Math.min(1, this.sealPress) : 0;
    this.blit(I.c.canvas, ix, iy, a);
    const sl = I.c.seal;
    if (!sl) return;
    const sx = ix + sl.x * S, sy = iy + sl.y * S;
    if (pg.study === 'ready') {
      // the seal breathes: a ring of gold light, pushed down while pressed
      const r = (sl.r + 2 + Math.sin(this.t * 4) * 1.2) * S;
      this.c.globalAlpha = 0.5 * a;
      for (let k = 0; k < 24; k++) {
        const q = (k / 24) * Math.PI * 2 + this.t * 0.8;
        px(this.c, Math.round((sx + Math.cos(q) * r) / S) * S, Math.round((sy + Math.sin(q) * r) / S) * S, S, S, k % 2 ? G.h : G.l);
      }
      this.c.globalAlpha = 1;
      if (press > 0) {
        this.c.globalAlpha = 0.35 * press;
        px(this.c, sx - sl.r * S, sy - sl.r * S, sl.r * 2 * S, sl.r * 2 * S, '#000');
        this.c.globalAlpha = 1;
      }
    } else if (pg.study === 'done' && I.c.gold > 0.9) {
      // the ibis stamped into the gold
      const ib = sprite(ART.glyph_ibis);
      this.blit(ib, sx - (ib.width * S) / 2, sy - (ib.height * S) / 2 + S * 0.5, a * Math.min(1, (I.c.gold - 0.9) * 10));
    }
  }

  /**
   * a page bending over its binding (the sheet's left edge): theta 0 lies flat, PI has turned over.
   * Drawn in strips, each tilted by the page's own bend (the free edge leads), with perspective, the
   * back of the page past the vertical, shading by how much each strip faces away from the light.
   */
  private curl(pg: Page, x0: number, y0: number, theta: number, edgeOnly = false) {
    const S = this.S;
    const w = pg.w, h = pg.h;
    if (!pg.back) pg.back = pageBack(pg.cv, w, h, this.dpr, S);
    const sw = 2 * S;
    const n = Math.ceil(w / sw);
    const c = this.c;
    // the shadow it throws on the page under it
    if (!edgeOnly) {
      c.globalAlpha = 0.28 * Math.sin(theta);
      px(c, x0, y0, w, h, '#1a0e06');
      c.globalAlpha = 1;
    }
    let X = x0, Z = 0;
    const strips: { x0: number; x1: number; u: number; th: number; z: number }[] = [];
    for (let i = 0; i < n; i++) {
      const u = i * sw;
      const f = u / w;
      const th = Math.min(Math.PI, theta + (edgeOnly ? theta * 1.2 * f * f : 0.85 * Math.sin(theta) * Math.pow(f, 1.4)));
      const dx = Math.cos(th) * sw, dz = Math.sin(th) * sw;
      strips.push({ x0: X, x1: X + dx, u, th, z: Z });
      X += dx;
      Z += dz;
    }
    // far strips first (the ones nearest the binding are lowest)
    for (const s of strips) {
      const a = Math.min(s.x0, s.x1), b = Math.max(s.x0, s.x1);
      const wpx = Math.max(1, Math.ceil(b - a + 0.6));
      const sc = 1 + s.z * 0.0011;
      const hh = h * sc, top = y0 - (hh - h) / 2;
      const back = Math.cos(s.th) < 0;
      const src = back ? pg.back! : pg.cv;
      const su = back ? w - s.u - sw : s.u;
      c.drawImage(src, Math.max(0, su) * this.dpr, 0, sw * this.dpr, h * this.dpr, Math.round(a), Math.round(top), wpx, Math.round(hh));
      const shade = back ? 0.18 + 0.25 * (1 - Math.abs(Math.cos(s.th))) : 0.5 * (1 - Math.abs(Math.cos(s.th))) * 0.8;
      if (shade > 0.02) {
        c.globalAlpha = shade;
        px(c, a, top, wpx, hh, '#1a0e06');
        c.globalAlpha = 1;
      }
      // the lit lip where the page rolls over
      if (Math.abs(Math.cos(s.th)) < 0.25) {
        c.globalAlpha = 0.35;
        px(c, a, top, Math.max(1, S), hh, '#fff4d8');
        c.globalAlpha = 1;
      }
    }
  }

  // ---------------------------------------------------------------- the errand slip
  private errandBox: { x: number; y: number } | null = null;
  private drawErrand(e: ErrandSlip | null, satchel: string | null) {
    const S = this.S;
    const W = Math.min(this.narrow ? this.W * 0.46 : 330, 360);
    // the slip hangs on its pin and swings a little in the hall's draught
    const sway = Math.sin(this.t * 0.9) * 1.5;
    const x = this.W - W - 16 + sway, top = 64;
    this.errandBox = { x, y: top };
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

  // ---------------------------------------------------------------- the astrolabe (desk)
  private drawAstrolabe(s: HallUIState, rdt: number) {
    const S = this.S;
    const a = this.panelK;
    const PW = this.panelWidth();
    const x0 = this.W - PW - 16 + (1 - a) * (PW + 30), top = 64;
    const size = this.narrow ? 13 : 15;
    const plateH = Math.ceil((size * 3 + 34) / S);
    const room = this.H - top - Math.ceil((size * 2 + 22) / S) * S - 50 - plateH * S;
    const R = Math.max(30, Math.min(110, Math.floor(Math.min(PW * 0.92, room / 1.1) / (2 * S))));
    if (!this.astro || this.astro.R !== R) {
      this.astro = new Astrolabe(R);
      this.astro.pour();
    }
    const A = this.astro;
    const rows = s.gifts ?? [];
    const next = rows.findIndex((g) => !g.given);
    if (this.astroSel < 0 || this.astroSel >= rows.length) this.astroSel = next >= 0 ? next : rows.length - 1;
    A.set(rows.map((g) => ({ at: g.at, given: g.given })), s.studies, this.astroSel);
    A.update(rdt);
    for (const e of A.events) if (e === 'tick') uiSfx('ui_hover', 0.1, 2.4);
    const img = A.draw();
    const ax = Math.round(x0 + PW / 2 - (img.width * S) / 2), ay = top;
    this.astroAt = { x: ax, y: ay };
    // a soft shadow under the instrument
    this.c.globalAlpha = 0.35 * a;
    px(this.c, ax + 3 * S, ay + 4 * S + A.T * S, img.width * S, img.width * S, '#000');
    this.c.globalAlpha = 1;
    this.blit(img, ax, ay, a);
    this.rect('astro', ax, ay + A.T * S, img.width * S, img.width * S);
    // the hovered socket's mark
    const hv = A.hover >= 0 ? A.hover : -1;
    if (hv >= 0 && rows[hv]) {
      const tx = this.ptr.x, ty = this.ptr.y;
      this.ink(`${rows[hv].at}`, tx + 14, ty - 22, '#ffd36b', 16, 'left', true);
    }
    // the plate under it: the picked gift
    const g = rows[this.astroSel];
    const py = ay + img.height * S + 8;
    const pw = Math.ceil(PW / S);
    this.blit(lapisPlate(pw, plateH, false, 41), x0, py, a);
    if (g) {
      const left = g.at - s.studies;
      const status = g.given ? 'GIVEN: it is yours' : this.astroSel === next ? (left > 0 ? `NEXT: ${left} more stud${left > 1 ? 'ies' : 'y'}` : 'NEXT: finish a study') : `at ${g.at} studies`;
      const nm = this.tw(g.name, 20) > PW - 30 ? 16 : 20;
      this.ink(g.name, x0 + PW / 2, py + 8, g.given ? '#ffd36b' : '#fff3d6', nm, 'center', true, a);
      this.ink(status, x0 + PW / 2, py + 12 + nm, g.given ? '#a8f0c0' : this.astroSel === next ? '#ffd36b' : '#cfdcf6', size, 'center', false, a);
      this.ink(`${s.studies} studies finished  ·  tap a jewel, spin the stars`, x0 + PW / 2, py + 16 + nm + size, '#8ab0e8', size - 2, 'center', false, a);
    }
    this.rect('panel', x0, py, PW, plateH * S);
    this.sheet.w = 0;
    return { x: x0 + 3, y: py + 8, wall: x0 };
  }
}
