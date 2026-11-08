// The hideout's screen furniture as stylized pixel art, built on the PixelUI kit
// (wood, iron, brass, parchment, Alagard type): the bank plaque with the
// season's tally, the station's sign hanging on its chains with a parchment
// notice of what you can do there, signpost arrows to the next stations, the
// use plate with its keycap, the controls strap, the hover tag and the
// banked-gold ribbon. Sprites are drawn at UI pixel size and blitted
// nearest-neighbour at an integer scale; small type is set at its native size
// over them so it stays crisp. Clicks are tested against the drawn rects
// (hit()), so taps on touch screens work the same way.
import { UI, FONT, woodPanel, parchment, ribbon, keycap, chain, text, measure, px } from '../../ui/PixelUI';

type Rect = { x: number; y: number; w: number; h: number };
export type UIHit = 'l' | 'r' | 'prompt' | null;

export interface HubUIState {
  /** the whole layer steps aside (the Codex, a panel) */
  hidden: boolean;
  /** the bank plaque is up */
  bank: boolean;
  /** the station you are settled at (null while the camera swings or a station owns the screen) */
  station: { id: string; title: string; sub: string; can: string[] } | null;
  /** the neighbours' names on the signposts (null: no carousel right now) */
  arrows: { left: string; right: string } | null;
  /** the use plate */
  prompt: { key: string; verb: string } | null;
  /** the controls strap ("A / D: look around   ·   E: use") */
  hint: string;
  /** the hover tag at the mouse */
  tip: { text: string; x: number; y: number } | null;
}

/** what you can do at each station, in a few words (the notice under its sign) */
export const STATION_CAN: Record<string, string[]> = {
  ride: ['Ride out into the dunes', 'Your board, guns and kit ride with you'],
  bench: ['Browse the gun rack', 'Swap the parts on your guns', 'Pick the long gun for your sling'],
  garage: ['Pick the board you ride', 'Every board you own is in the rack'],
  wardrobe: ['Try on hats, jackets and shades', 'Buy new looks with your bank'],
  range: ['Shoot bottles off the fence', 'Beat your best score'],
  trophies: ['Hear the tale of each bounty paid', 'An empty nail for every one left'],
  book: ['Your moves and cards', 'The codex of all you have met'],
  gramophone: ['Put on a record', 'Squeeze the rubber duck'],
  cards: ['Play Twenty-One with Mama', 'Bet your gold, if you dare'],
  hearth: ['Warm your bones by the fire', 'Hear what Mama has to say'],
  bounty: ['Read the long ride ahead', 'Bounties, the route and the notes'],
};

const cache = new Map<string, HTMLCanvasElement>();
function sprite(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  let cv = cache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    const c = cv.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    draw(c);
    cache.set(key, cv);
    if (cache.size > 160) cache.delete(cache.keys().next().value!);
  }
  return cv;
}
const scratch = document.createElement('canvas').getContext('2d')!;
/** width of Alagard at its native 16 px, in UI pixels */
const low = (s: string) => Math.ceil(measure(scratch, s, 16));

// ---------------------------------------------------------------- hand-set pixel icons
function icon(rows: string[], pal: Record<string, string>) {
  return sprite('icon:' + rows.join('|'), rows[0].length, rows.length, (c) => {
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) if (pal[r[x]]) px(c, x, y, 1, 1, pal[r[x]]);
    });
  });
}
const SKULL = ['..ooooo..', '.ohhllmo.', 'ohlllllmo', 'olxxlxxmo', 'olxxlxxmo', 'ollllmmmo', '.oolxlmo.', '..olmlmo.', '..oooooo.'];
const SHOE = ['oo.....oo', 'hmo...omd', 'lmo...omd', 'lxo...oxd', 'lmo...omd', 'olmo.omdo', '.olmmmdo.', '..ooooo..'];
const FLAG = ['p........', 'pommo....', 'phllmmo..', 'plllmmmmo', 'pllmmmdo.', 'plmmdo...', 'pddo.....', 'p........', 'p........', 'pp.......'];
const TACK = ['.ooo.', 'ohlmo', 'olmdo', 'omddo', '.ooo.'];
const ICON_SKULL = () => icon(SKULL, { o: UI.bone.o, h: UI.bone.h, l: UI.bone.l, m: UI.bone.m, x: UI.shadow });
const ICON_SHOE = () => icon(SHOE, { o: UI.iron.o, h: UI.iron.h, l: UI.iron.l, m: UI.iron.m, d: UI.iron.d, x: UI.iron.o });
const ICON_FLAG = () => icon(FLAG, { p: UI.wood.l, o: UI.blood.o, h: UI.blood.h, l: UI.blood.l, m: UI.blood.m, d: UI.blood.d });
const ICON_TACK = () => icon(TACK, { o: UI.brass.o, h: UI.brass.h, l: UI.brass.l, m: UI.brass.m, d: UI.brass.d });
/** a little pile of gold coins, each a pressed disc with a rim */
function coins() {
  return sprite('coins', 15, 13, (c) => {
    const B = UI.brass;
    const coin = (x: number, y: number) => {
      for (let i = 0; i < 9; i++) {
        const h = i === 0 || i === 8 ? 1 : i === 1 || i === 7 ? 3 : 4;
        px(c, x + i, y + 2 - Math.floor(h / 2), 1, h + 2, B.o);
        px(c, x + i, y + 3 - Math.floor(h / 2), 1, h, i < 3 ? B.h : i < 6 ? B.l : B.m);
        px(c, x + i, y + 3 + Math.ceil(h / 2), 1, 1, B.d);
      }
      px(c, x + 3, y + 2, 3, 1, B.m);
    };
    coin(5, 8);
    coin(1, 6);
    coin(3, 3);
    coin(5, 0);
  });
}

// ---------------------------------------------------------------- composed sprites
/** a weathered arrow board pointing off-screen, the neighbour station burned into it */
function arrowBoard(label: string, dir: -1 | 1, hot: boolean) {
  const tw = low(label);
  const body = tw + 16, tip = 11, H = 23, W = body + tip;
  return sprite(`arrow:${label}:${dir}:${hot}`, W, H, (c) => {
    const Wd = UI.wood;
    const mid = (H - 1) / 2;
    const inside = (x: number, y: number) => {
      const fx = dir < 0 ? x : W - 1 - x; // distance from the point
      if (fx >= tip) return y >= 2 && y <= H - 3;
      return Math.abs(y - mid) <= (fx / tip) * (mid - 1) + 0.6;
    };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!inside(x, y)) continue;
        const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        const plank = y < mid ? 0 : 1;
        let col = hot ? Wd.l : plank ? Wd.m : Wd.l;
        if (!hot && (x * 7 + y * 3 + plank * 5) % 23 === 0) col = Wd.g;
        if ((x + plank * 4) % 13 === 0 && y % 4 === 1) col = Wd.d;
        if (Math.abs(y - mid) < 0.6) col = Wd.o;
        if (y === 3 || (inside(x, y - 1) && !inside(x, y - 2) && y < mid)) col = hot ? Wd.h : Wd.h;
        if (edge) col = Wd.o;
        px(c, x, y, 1, 1, col);
      }
    // a twine binding round the back end, two nails
    const bx = dir < 0 ? W - 7 : 4;
    for (let y = 2; y <= H - 3; y++) {
      px(c, bx, y, 2, 1, (y % 3 === 0) ? '#8a6a3a' : '#c8a868');
      px(c, bx + 2, y, 1, 1, '#5a4024');
    }
    for (const ny of [5, H - 6]) {
      const nx = dir < 0 ? tip + 3 : W - tip - 4;
      px(c, nx, ny, 2, 2, UI.iron.d);
      px(c, nx, ny, 1, 1, UI.iron.h);
    }
    const tx = dir < 0 ? tip + (body - 6) / 2 - 1 : (body - 6) / 2 + 1;
    text(c, label, tx, 3, hot ? '#ffe9a8' : UI.text, 16, 'center');
  });
}
/** the station's sign: a planked board with iron corners, hung on two chains */
function stationSign(title: string) {
  const w = low(title) + 30, ch = 9;
  return sprite(`sign:${title}`, w, 26 + ch, (c) => {
    for (const x of [7, w - 8]) {
      chain(c, x, 0, ch + 2);
      px(c, x - 1, ch, 3, 2, UI.brass.d);
      px(c, x, ch, 1, 1, UI.brass.h);
    }
    c.drawImage(woodPanel(w, 26, 7, { iron: true }), 0, ch);
    text(c, title, w / 2, ch + 5, UI.text, 16, 'center');
  });
}
/** the bank plaque: a dark board with iron corners, the coin pile and the sum */
function bankPlaque(gold: string) {
  const w = Math.max(84, low(gold) + 34);
  return sprite(`bank:${gold}`, w, 26, (c) => {
    c.drawImage(woodPanel(w, 26, 11, { iron: true, dark: true }), 0, 0);
    c.drawImage(coins(), 7, 6);
    text(c, gold, 25, 5, '#ffd36b', 16, 'left');
  });
}
/** the use plate: a keycap and the verb on a board */
function usePlate(key: string, verb: string, hot: boolean) {
  const kc = keycap(key);
  const w = kc.width + low(verb) + 22;
  return sprite(`use:${key}:${verb}:${hot}`, w, 25, (c) => {
    c.drawImage(woodPanel(w, 25, 5, { iron: true, dark: !hot }), 0, 0);
    c.drawImage(kc, 7, 5);
    text(c, verb, kc.width + 13, 5, hot ? '#ffe9a8' : UI.text, 16, 'left');
  });
}
/** a leather strap with stitching and brass rivets, the controls strip sits on it */
function strap(w: number) {
  return sprite(`strap:${w}`, w, 13, (c) => {
    const L = UI.leather;
    px(c, 0, 0, w, 13, L.o);
    px(c, 1, 1, w - 2, 11, L.m);
    px(c, 1, 1, w - 2, 1, L.l);
    px(c, 1, 11, w - 2, 1, L.d);
    for (let x = 4; x < w - 4; x += 3) {
      px(c, x, 2, 1, 1, '#a8885a');
      px(c, x, 10, 1, 1, '#a8885a');
    }
    for (const x of [2, w - 4]) {
      px(c, x, 5, 2, 3, UI.brass.d);
      px(c, x, 5, 1, 1, UI.brass.h);
    }
  });
}
/** a small key chip (parchment with a dark rim) sized for native type */
function chip(w: number) {
  return sprite(`chip:${w}`, w, 10, (c) => {
    const P = UI.parch;
    px(c, 0, 0, w, 10, UI.wood.o);
    px(c, 1, 1, w - 2, 7, P.l);
    px(c, 1, 8, w - 2, 1, P.d);
    px(c, 1, 1, w - 2, 1, P.h);
  });
}

// ======================================================================= the layer
export class HubUI {
  readonly canvas = document.createElement('canvas');
  private c: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  /** css px per UI pixel */
  private S = 2;
  private t = 0;
  private bank = { gold: 0, runs: 0, best: 0, kills: 0 };
  private goldShown = -1;
  private bankK = 0;
  private sign = { k: 0, id: '', data: null as HubUIState['station'] };
  private arrowK = 0;
  private arrowHot = { l: 0, r: 0 };
  private kicks = { l: 0, r: 0 };
  private promptK = 0;
  private promptHot = 0;
  private hintK = 0;
  private hintText = '';
  private tipK = 0;
  private tipLast: HubUIState['tip'] = null;
  private toasts: { text: string; t: number }[] = [];
  private rects: { l: Rect | null; r: Rect | null; prompt: Rect | null } = { l: null, r: null, prompt: null };
  private onResize = () => this.resize();

  constructor(parent: HTMLElement) {
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:7;image-rendering:pixelated';
    parent.appendChild(this.canvas);
    this.c = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.onResize);
  }
  private resize() {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.S = this.W > 1800 ? 3 : 2;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
  }
  setBank(b: { gold: number; runs: number; best: number; kills: number }) {
    this.bank = { ...b };
    if (this.goldShown < 0) this.goldShown = b.gold;
  }
  toast(s: string) {
    this.toasts.push({ text: s, t: 0 });
    if (this.toasts.length > 3) this.toasts.shift();
  }
  /** an arrow was used (it jumps) */
  kick(dir: number) {
    if (dir < 0) this.kicks.l = 1;
    else this.kicks.r = 1;
  }
  /** what a screen point (css px) is over */
  hit(x: number, y: number): UIHit {
    const inR = (r: Rect | null) => !!r && x >= r.x - 6 && x <= r.x + r.w + 6 && y >= r.y - 6 && y <= r.y + r.h + 6;
    if (this.arrowK > 0.5 && inR(this.rects.l)) return 'l';
    if (this.arrowK > 0.5 && inR(this.rects.r)) return 'r';
    if (this.promptK > 0.5 && inR(this.rects.prompt)) return 'prompt';
    return null;
  }

  frame(rdt: number, s: HubUIState, hover: UIHit = null) {
    this.t += rdt;
    const c = this.c;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    c.imageSmoothingEnabled = false;
    const k = (v: number, want: boolean, up = 6, down = 9) => v + ((want ? 1 : 0) - v) * (1 - Math.exp(-rdt * (want ? up : down)));
    const vis = !s.hidden;
    this.bankK = k(this.bankK, vis && s.bank, 3);
    // the station's sign drops in on its chains when you settle; it swaps by lifting out first
    const sid = s.station?.id ?? '';
    if (sid !== this.sign.id) {
      if (this.sign.k < 0.05 || !this.sign.id) {
        this.sign.id = sid;
        this.sign.data = s.station;
      }
      this.sign.k = k(this.sign.k, false, 6, 10);
    } else {
      this.sign.data = s.station ?? this.sign.data;
      this.sign.k = k(this.sign.k, vis && !!s.station, 3.2, 10);
    }
    this.arrowK = k(this.arrowK, vis && !!s.arrows, 4, 10);
    this.arrowHot.l = k(this.arrowHot.l, hover === 'l', 12, 8);
    this.arrowHot.r = k(this.arrowHot.r, hover === 'r', 12, 8);
    this.kicks.l = Math.max(0, this.kicks.l - rdt * 3);
    this.kicks.r = Math.max(0, this.kicks.r - rdt * 3);
    this.promptK = k(this.promptK, vis && !!s.prompt, 5, 12);
    this.promptHot = k(this.promptHot, hover === 'prompt', 12, 8);
    if (s.hint && s.hint !== this.hintText) {
      if (this.hintK < 0.05 || !this.hintText) this.hintText = s.hint;
      this.hintK = k(this.hintK, false, 6, 14);
    } else this.hintK = k(this.hintK, vis && !!s.hint, 4, 10);
    if (!s.hint && this.hintK < 0.02) this.hintText = '';
    if (s.tip) this.tipLast = s.tip;
    this.tipK = k(this.tipK, vis && !!s.tip, 18, 14);
    this.goldShown = this.goldShown < 0 ? this.bank.gold : this.goldShown + (this.bank.gold - this.goldShown) * (1 - Math.exp(-rdt * 4));
    if (Math.abs(this.bank.gold - this.goldShown) < 0.6) this.goldShown = this.bank.gold;

    this.drawBank();
    this.drawSign();
    this.drawArrows(s.arrows);
    this.drawPrompt(s.prompt);
    this.drawHint();
    this.drawToasts(rdt);
    this.drawTip();
  }

  // ---------------------------------------------------------------- pieces
  private blit(img: HTMLCanvasElement, x: number, y: number, alpha = 1) {
    if (alpha <= 0.01) return;
    const c = this.c;
    c.globalAlpha = Math.min(1, alpha);
    c.drawImage(img, Math.round(x), Math.round(y), img.width * this.S, img.height * this.S);
    c.globalAlpha = 1;
  }
  /** native-size type (crisp at any scale) */
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
  private textW(s: string, size = 16) {
    this.c.font = `${size}px '${FONT}'`;
    return this.c.measureText(s).width;
  }

  private drawBank() {
    const a = this.bankK;
    if (a < 0.01) return;
    const S = this.S;
    const g = Math.round(this.goldShown).toLocaleString('en-US');
    const plaque = bankPlaque(g);
    const x = 14, y = 12 - (1 - a) * 40;
    this.blit(plaque, x, y, a);
    // (no run-stats tally: the user wants the corner kept to the bank alone)
  }

  private drawSign() {
    const sg = this.sign;
    const d = sg.data;
    if (!d || sg.k < 0.01) return;
    const S = this.S;
    const e = 1 - Math.pow(1 - sg.k, 3);
    const board = stationSign(d.title);
    const bw = board.width * S;
    const swing = Math.sin(this.t * 1.3) * 0.6 * S;
    const x = this.W / 2 - bw / 2 + swing, y = -board.height * S * (1 - e) - 2;
    this.blit(board, x, y, Math.min(1, sg.k * 1.6));
    // the notice: the subtitle and what you can do here, pinned under the sign
    const lines = d.can.slice(0, 3);
    const sub = d.sub;
    const tw = Math.max(this.textW(sub, 16), ...lines.map((l) => this.textW(l, 16) + 18));
    const nw = Math.ceil(tw / S) + 16, nh = Math.ceil((22 + lines.length * 20) / S) + 10;
    const note = parchment(nw, nh, 9);
    const ny = y + board.height * S + 2 * S;
    const nx = this.W / 2 - (nw * S) / 2 - swing * 0.4;
    const na = Math.min(1, Math.max(0, sg.k * 1.6 - 0.4));
    this.blit(note, nx, ny, na);
    // two brass tacks hold it up
    for (const tx of [nx + 4 * S, nx + nw * S - 9 * S]) this.blit(ICON_TACK(), tx, ny + 2 * S, na);
    let ty = ny + 5 * S;
    this.ink(sub, this.W / 2 - swing * 0.4, ty, '#7a2a16', 16, 'center', false, na);
    ty += 22;
    for (const l of lines) {
      const lx = nx + 8 * S;
      this.blit(ICON_TACK(), lx, ty + 3, na);
      this.ink(l, lx + 5 * S + 6, ty, '#2e1c0e', 16, 'left', false, na);
      ty += 20;
    }
  }

  private drawArrows(ar: HubUIState['arrows']) {
    const a = this.arrowK;
    if (a < 0.01 || !ar) {
      this.rects.l = this.rects.r = null;
      if (a < 0.01) return;
    }
    const names = ar ?? { left: '', right: '' };
    const S = this.S;
    for (const dir of [-1, 1] as const) {
      const key = dir < 0 ? 'l' : 'r';
      const label = dir < 0 ? names.left : names.right;
      if (!label) continue;
      const hot = this.arrowHot[key];
      const img = arrowBoard(label, dir, hot > 0.5);
      const w = img.width * S, h = img.height * S;
      // an idle nudge the way it points, a jump when used
      const nudge = Math.pow(Math.max(0, Math.sin(this.t * 2.2 + (dir > 0 ? 0 : 1.7))), 8) * 3 * S;
      const kick = Math.sin(Math.min(1, this.kicks[key]) * Math.PI) * 6 * S;
      const off = (1 - a) * (w + 20);
      const x = dir < 0 ? 10 - off - nudge - kick - hot * 2 * S : this.W - 10 - w + off + nudge + kick + hot * 2 * S;
      const y = this.H * 0.47 - h / 2 + Math.sin(this.t * 1.3 + dir) * 1.5;
      this.blit(img, x, y, a);
      this.rects[key] = { x, y, w, h };
    }
  }

  private drawPrompt(p: HubUIState['prompt']) {
    const a = this.promptK;
    if (a < 0.01 || !p) {
      if (!p) this.rects.prompt = null;
      if (a < 0.01 || !p) return;
    }
    const S = this.S;
    const img = usePlate(p.key, p.verb.toUpperCase(), this.promptHot > 0.5);
    const w = img.width * S, h = img.height * S;
    const bob = Math.round(Math.sin(this.t * 2.4) * 1.2);
    const x = this.W / 2 - w / 2, y = this.H - h - 52 + (1 - a) * 30 + bob;
    this.blit(img, x, y, a);
    this.rects.prompt = { x, y, w, h };
  }

  private drawHint() {
    const a = this.hintK;
    const s = this.hintText;
    if (a < 0.01 || !s) return;
    const S = this.S;
    // segments "key part: what it does", split on the middle dots
    const segs = s.split('·').map((q) => q.trim()).filter(Boolean).map((q) => {
      const m = /^([^:]{1,28}):\s*(.+)$/.exec(q);
      return m ? { key: m[1], txt: m[2] } : { key: '', txt: q };
    });
    const size = 15, gap = 16;
    const widths = segs.map((g) => (g.key ? this.textW(g.key, size) + 14 + 6 : 0) + this.textW(g.txt, size));
    const total = widths.reduce((p, w) => p + w, 0) + gap * (segs.length - 1);
    const maxW = this.W - 40;
    const k = total > maxW ? maxW / total : 1;
    const fs = Math.max(11, Math.floor(size * k));
    const ws = segs.map((g) => (g.key ? this.textW(g.key, fs) + 14 + 6 : 0) + this.textW(g.txt, fs));
    const tot = ws.reduce((p, w) => p + w, 0) + gap * (segs.length - 1);
    const sw = Math.ceil((tot + 28) / S);
    const band = strap(sw);
    const x0 = this.W / 2 - (sw * S) / 2, y0 = this.H - 13 * S - 8 + (1 - a) * 20;
    this.blit(band, x0, y0, a * 0.95);
    let x = this.W / 2 - tot / 2;
    const ty = y0 + (13 * S - fs) / 2 + 1;
    segs.forEach((g, i) => {
      if (g.key) {
        const kw = this.textW(g.key, fs) + 14;
        const cw = Math.ceil(kw / S);
        this.blit(chip(cw), x, y0 + (13 * S - 10 * S) / 2, a);
        this.ink(g.key, x + (cw * S) / 2, ty, UI.wood.o, fs, 'center', false, a);
        x += cw * S + 6;
      }
      this.ink(g.txt, x, ty, UI.text, fs, 'left', true, a);
      x += this.textW(g.txt, fs) + gap;
      void i;
    });
  }

  private drawToasts(rdt: number) {
    const S = this.S;
    let row = 0;
    for (const q of this.toasts) {
      q.t += rdt;
      const inK = Math.min(1, q.t / 0.35), outK = Math.max(0, (q.t - 2.6) / 0.6);
      const a = inK * (1 - outK);
      if (a <= 0) continue;
      const w = low(q.text) + 20;
      const img = sprite(`toast:${q.text}`, w + 16, 20, (c) => {
        c.drawImage(ribbon(w, UI.blood, 3), 0, 0);
        text(c, q.text, (w + 16) / 2, 0, '#ffd36b', 16, 'center');
      });
      const y = this.H * 0.2 + row * 24 * S - (1 - inK) * 10 * S;
      this.blit(img, this.W / 2 - (img.width * S) / 2, y, a);
      row++;
    }
    this.toasts = this.toasts.filter((q) => q.t < 3.3);
  }

  private drawTip() {
    const a = this.tipK, tp = this.tipLast;
    if (a < 0.01 || !tp) return;
    const S = this.S;
    const tw = this.textW(tp.text, 16);
    const w = Math.ceil((tw + 20) / S), h = 12;
    const img = sprite(`tip:${w}`, w, h, (c) => {
      c.drawImage(parchment(w, h, 13), 0, 0);
      for (const [x, y] of [[0, 0], [w - 2, 0], [0, h - 2], [w - 2, h - 2]]) {
        px(c, x, y, 2, 2, UI.iron.o);
        px(c, x, y, 1, 1, UI.iron.l);
      }
    });
    let x = tp.x + 18, y = tp.y + 16;
    if (x + w * S > this.W - 8) x = tp.x - w * S - 10;
    if (y + h * S > this.H - 8) y = tp.y - h * S - 10;
    this.blit(img, x, y, a);
    this.ink(tp.text, x + (w * S) / 2, y + (h * S - 16) / 2 + 1, '#2e1c0e', 16, 'center', false, a);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.canvas.remove();
  }
}

// ---------------------------------------------------------------- speech bubbles in the same hand
let bubbleFrame = '';
/** a 9-slice pixel parchment frame (dark ink rim, stepped corners, a lit top edge) as a data URL for CSS border-image */
function bubbleFrameURL() {
  if (bubbleFrame) return bubbleFrame;
  const n = 12;
  const cv = sprite('bubble-frame', n, n, (c) => {
    const P = UI.parch;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const cx = Math.min(x, n - 1 - x), cy = Math.min(y, n - 1 - y);
        if (cx + cy < 2) continue; // stepped corner
        const rim = cx === 0 || cy === 0 || cx + cy === 2;
        let col = rim ? UI.wood.o : P.l;
        if (!rim && (y === 1 || (cy === 1 && y < n / 2))) col = P.h;
        if (!rim && y >= n - 3) col = P.m;
        if (!rim && y === n - 2) col = P.d;
        px(c, x, y, 1, 1, col);
      }
  });
  bubbleFrame = cv.toDataURL();
  return bubbleFrame;
}
/** inline style for a speech bubble drawn as pixel parchment (the hero's and Mama's) */
export function pixelBubbleStyle(extra = '') {
  return `position:absolute;z-index:7;pointer-events:none;display:none;transform:translate(-50%,-100%);max-width:280px;padding:2px 6px;border:10px solid transparent;border-image:url(${bubbleFrameURL()}) 4 fill / 10px / 0 stretch;image-rendering:pixelated;filter:drop-shadow(0 4px 0 rgba(26,12,4,.55));font-family:'${FONT}';font-size:16px;line-height:19px;color:#2a1a0e;text-align:center;${extra}`;
}
