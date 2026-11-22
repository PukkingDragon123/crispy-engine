// The day plaque (top centre of the HUD, stylized pixel art, crisp type, no glow):
//  • a sandstone CARTOUCHE in a brass rim, rounded at both ends with the tie bar at
//    one end, "DAY N" cut into the stone (dark carved type with a pale lip)
//  • five carved diamond PIPS, one per wave of the day: gilded once fought, the one
//    being fought an ember inlay that breathes, the night waves set in indigo
//  • a linen TAG on two cords under it: the hour and the bodies still standing on
//    this wave ("DUSK  14 LEFT"), or the countdown in the break ("NIGHT IN 12")
//  • the NIGHT WARNING: an indigo plate edged in blood red that drops in before the
//    night ("NIGHT FALLS / THE DEAD HUNT HARDER") and the witching hour; a gold one
//    before the dawn.
// Frames are built pixel by pixel from the HUD palette and cached; only type and
// pips change per frame.
import type { HudPainter } from './Hud';
import { HUD_PAL, sprite, type PixelSprite } from './PixelUI';
import { pixelText, pixelTextWidth, blitObj } from './HudSprites';

export interface PlaqueState {
  visible: boolean;
  day: number;
  /** 0..4: which wave of the day is being fought (or comes next, in a break) */
  slot: number;
  /** waves of the day already won */
  done: number;
  inBreak: boolean;
  /** the tag's text */
  tag: string;
  /** the count on the tag turns red */
  urgent: boolean;
  warn: { title: string; sub: string; kind: 'night' | 'dawn' } | null;
}

const P = (ch: string) => HUD_PAL[ch];
const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hsh = (x: number, y: number, s = 0) => {
  const v = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

/** a pixel frame from a per-pixel rule: returns a palette char (or null) for each pixel */
function build(w: number, h: number, rule: (x: number, y: number) => string | null) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = rule(x, y);
      if (!ch) continue;
      const [r, g, b] = hex(P(ch));
      const o = (y * w + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  c.putImageData(img, 0, 0);
  return cv;
}

/** distance (px) inside a horizontal capsule w x h (negative outside) */
function capsuleIn(x: number, y: number, w: number, h: number) {
  const r = h / 2;
  const cx = Math.min(Math.max(x + 0.5, r), w - r);
  return r - Math.hypot(x + 0.5 - cx, y + 0.5 - r);
}

const cache = new Map<string, HTMLCanvasElement>();
function cartouche(w: number, h: number) {
  const key = `c${w}x${h}`;
  let cv = cache.get(key);
  if (cv) return cv;
  cv = build(w, h, (x, y) => {
    const e = capsuleIn(x, y, w, h);
    if (e < 0) return null;
    const r = h / 2;
    // lit from the upper left
    const nx = x + 0.5 < r ? (x + 0.5 - r) / r : x + 0.5 > w - r ? (x + 0.5 - (w - r)) / r : 0;
    const ny = (y + 0.5 - r) / r;
    const lit = -nx * 0.6 - ny * 0.8;
    if (e < 1.05) return 'k'; // ink outline
    if (e < 2.1) return lit > 0.35 ? 'j' : lit > -0.2 ? 'i' : 'h'; // brass rim, bright lip
    if (e < 3.2) return lit > 0.2 ? 'h' : 'g';
    if (e < 4.1) return 'f'; // dark seat of the stone
    // sandstone face: bedding lines, a few chisel pocks, darker toward the bottom
    const bed = Math.sin(y * 0.9 + Math.sin(x * 0.11) * 1.6) > 0.82;
    const pock = hsh(x, y, 3) > 0.965;
    const low = y > h * 0.72;
    if (e < 5.1) return lit > 0 ? 'u' : 'r'; // the stone's bevelled edge
    // the carved inner border (a sunk line) and the tie bar at the right end
    if (Math.abs(e - 6.5) < 0.55) return 'q';
    if (Math.abs(e - 7.5) < 0.5 && lit < 0) return 'u';
    const tie = x > w - r - 2 && x < w - r + 1;
    if (tie && e > 6) return x === Math.floor(w - r - 1) ? 'q' : 'u';
    if (pock) return 'r';
    if (bed) return low ? 'r' : 's';
    return low ? 's' : hsh(x >> 1, y >> 1, 1) > 0.88 ? 't' : 's';
  });
  // brass studs at both ends
  const c = cv.getContext('2d')!;
  for (const sx of [5, w - 6]) {
    const sy = Math.round(h / 2) - 1;
    c.fillStyle = P('k');
    c.fillRect(sx - 1, sy - 1, 3, 3);
    c.fillStyle = P('i');
    c.fillRect(sx - 1, sy - 1, 2, 2);
    c.fillStyle = P('j');
    c.fillRect(sx - 1, sy - 1, 1, 1);
  }
  cache.set(key, cv);
  return cv;
}

function tagFrame(w: number, h: number) {
  const key = `t${w}x${h}`;
  let cv = cache.get(key);
  if (cv) return cv;
  cv = build(w, h, (x, y) => {
    // a strip of old linen: clipped corners, frayed lower edge, a stitched hem
    const cl = Math.min(x, w - 1 - x) + Math.min(y, h - 1 - y);
    if (cl < 2) return null;
    if (y === h - 1 && hsh(x, 1) > 0.6) return null;
    if (x === 0 || x === w - 1 || y === 0 || y === h - 1 || cl < 3) return 'k';
    if (y === 1) return 'O';
    if (y === h - 2) return 'M';
    if (y === h - 3 && x % 3 === 1 && x > 2 && x < w - 3) return 'L'; // the hem stitches
    return hsh(x, y, 5) > 0.93 ? 'M' : 'N';
  });
  cache.set(key, cv);
  return cv;
}

function warnFrame(w: number, h: number, kind: 'night' | 'dawn') {
  const key = `w${kind}${w}x${h}`;
  let cv = cache.get(key);
  if (cv) return cv;
  const [edge, edgeHi, face, faceLo, rivet] = kind === 'night' ? ['B', 'C', 'T', 'T', 'D'] : ['g', 'i', 'X', 'X', 'j'];
  cv = build(w, h, (x, y) => {
    // an iron-cornered plate: notched corners, a coloured edge band, a dark face with a faint ruled line
    const cl = Math.min(x, w - 1 - x) + Math.min(y, h - 1 - y);
    if (cl < 2) return null;
    if (x === 0 || x === w - 1 || y === 0 || y === h - 1 || cl < 3) return 'k';
    if (x === 1 || x === w - 2 || y === 1 || y === h - 2 || cl < 4) return y < h / 2 ? edgeHi : edge;
    if ((x === 4 || x === w - 5) && (y === 4 || y === h - 5)) return rivet;
    if (y === 2) return 'k';
    return y > h - 5 ? faceLo : face;
  });
  cache.set(key, cv);
  return cv;
}

// the wave pips (7 x 7 carved diamonds), authored
const PIP_ROWS = ['...k...', '..kAk..', '.kABCk.', 'kABCDDk', '.kCDDk.', '..kDk..', '...k...'];
const pip = (map: Record<string, string>): PixelSprite => ({ w: 7, h: 7, rows: PIP_ROWS.map((r) => r.replace(/[ABCD]/g, (m) => map[m])) });
const PIP_DONE = pip({ A: 'j', B: 'i', C: 'h', D: 'g' });
const PIP_NOW = pip({ A: 'E', B: 'D', C: 'C', D: 'B' });
const PIP_NOW2 = pip({ A: 'E', B: 'E', C: 'D', D: 'C' });
const PIP_DAY = pip({ A: 'q', B: 'L', C: 'L', D: 'K' });
const PIP_NIGHT = pip({ A: 'V', B: 'U', C: 'U', D: 'T' });

export class DayPlaque implements HudPainter {
  /** where it was drawn (HUD px), for the hourglass beside it */
  rect = { x: 0, y: 0, w: 0, h: 0, shown: false };
  private t = 0;
  private drop = 1;
  private lastDay = -1;
  private warnK = 0;
  private lastWarn: PlaqueState['warn'] = null;

  /** `slot`: where it hangs (HUD px): its top edge `y`, and either its centre `x` or its `right` edge */
  constructor(private state: () => PlaqueState, private slot?: () => { x?: number; right?: number; y: number } | null) {}

  paint(c: CanvasRenderingContext2D, dt: number) {
    this.t += dt;
    const st = this.state();
    const W = c.canvas.width, H = c.canvas.height;
    this.rect.shown = st.visible;
    if (!st.visible) {
      this.drop = 1;
      return;
    }
    const small = H < 260 || W < 420;
    const fs = small ? 16 : 32;
    const label = `DAY ${st.day}`;
    const tw = Math.ceil(pixelTextWidth(label, fs));
    const w = Math.max(small ? 64 : 92, tw + (small ? 26 : 34)), h = small ? 30 : 42;
    // a new day: the plaque drops in again
    if (st.day !== this.lastDay) {
      this.drop = this.lastDay < 0 ? 0.4 : 1;
      this.lastDay = st.day;
    }
    this.drop = Math.max(0, this.drop - dt * 2.2);
    const bounce = this.drop > 0 ? Math.round(-Math.pow(this.drop, 2) * 50 + Math.sin(this.drop * 9) * this.drop * 4) : 0;
    const at = this.slot?.() ?? { x: Math.round(W / 2), y: 4 };
    const x = Math.round(at.right !== undefined ? at.right - w : (at.x ?? W / 2) - w / 2), y = Math.round(at.y) + bounce;
    this.rect = { x, y, w, h, shown: true };
    const cv = cartouche(w, h);
    blitObj(c, cv, x + w / 2, y + h / 2, 3);
    // the day, carved into the stone
    pixelText(c, label, x + w / 2 - 1, y + (small ? 3 : 4), { size: fs, color: '#2a1406', align: 'center', lip: '#fff4d8' });
    // the waves of the day
    const py = y + h - (small ? 9 : 12);
    const gap = small ? 9 : 11;
    for (let i = 0; i < 5; i++) {
      const px = Math.round(x + w / 2 + (i - 2) * gap);
      const night = i >= 3;
      const spr = i < st.done ? PIP_DONE : i === st.slot && !st.inBreak ? (Math.sin(this.t * 3.2) > 0 ? PIP_NOW : PIP_NOW2) : night ? PIP_NIGHT : PIP_DAY;
      c.drawImage(sprite(spr), px - 3, py - 3);
    }
    // the tag on its cords
    const tfs = 16;
    const ttw = Math.ceil(pixelTextWidth(st.tag, tfs));
    const tgw = ttw + 16, tgh = 17;
    const tx = Math.round(x + w / 2 - tgw / 2), ty = y + h + 4 + Math.round(Math.sin(this.t * 1.3) * 0.6);
    c.fillStyle = P('K');
    for (const cx of [tx + 6, tx + tgw - 7]) c.fillRect(cx, y + h - 3, 1, ty - (y + h - 3) + 1);
    blitObj(c, tagFrame(tgw, tgh), tx + tgw / 2, ty + tgh / 2, 2);
    pixelText(c, st.tag, tx + tgw / 2, ty + 2, { size: tfs, color: st.urgent ? '#a8221a' : '#3a200e', align: 'center' });
    // the night (or dawn) warning drops in under the tag
    const want = st.warn ? 1 : 0;
    if (st.warn) this.lastWarn = st.warn;
    this.warnK += (want - this.warnK) * Math.min(1, dt * (want ? 6 : 9));
    const wv = this.lastWarn;
    if (this.warnK > 0.02 && wv) {
      const f1 = small ? 16 : 16;
      const w1 = Math.ceil(pixelTextWidth(wv.title, f1)), w2 = Math.ceil(pixelTextWidth(wv.sub, 16));
      const ww = Math.max(w1, w2) + 22, wh = 38;
      const wx = Math.round(x + w / 2 - ww / 2);
      const wy = Math.round(ty + tgh + 6 - (1 - this.warnK) * 24);
      c.globalAlpha = Math.min(1, this.warnK * 1.4);
      blitObj(c, warnFrame(ww, wh, wv.kind), wx + ww / 2, wy + wh / 2, 3);
      const beat = Math.sin(this.t * 4) > -0.2;
      const night = wv.kind === 'night';
      pixelText(c, wv.title, wx + ww / 2, wy + 4, { size: f1, color: night ? (beat ? '#ff8a6a' : '#dc4430') : '#fff0a6', align: 'center', outline: '#0c0806' });
      pixelText(c, wv.sub, wx + ww / 2, wy + 19, { size: 16, color: night ? '#8ab0e8' : '#efdcb0', align: 'center', outline: '#0c0806' });
      c.globalAlpha = 1;
    }
  }
}
