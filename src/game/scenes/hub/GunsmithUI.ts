// The gunsmith's screen when a gun is on the turntable: stylized pixel-art
// panels (the PixelUI kit) that frame the 3D gun in the middle without
// covering it.
//  - top: the gun's name on a ribbon, and how it rides;
//  - left: the component list (each slot, the part in it, what you own and
//    what is still locked), the sling switch and the exploded-view switch;
//  - under it: the blueprint schematic, a photograph of the part on its
//    schematic sheet;
//  - right: the selected component: the part's name, what it does, its stats
//    against what is fitted now (comparison bars), and every part for that slot
//    (fitted, owned, for sale with its price, or a blueprint still out there).
// Panels are low-res sprites blitted at an integer scale; type is set at its
// native size on top. hit() tells Bench3D what a click landed on.
import { UI, FONT, woodPanel, parchment, ribbon, keycap, barFrame, text, measure, px, ironPlate } from '../../ui/PixelUI';

export interface SmithSlot {
  label: string;
  part: string;
  owned: number;
  locked: number;
}
export interface SmithOption {
  name: string;
  state: 'fitted' | 'owned' | 'buy' | 'blueprint';
  price?: number;
  /** a second click buys it */
  armed?: boolean;
}
export interface SmithStat {
  label: string;
  /** fitted now, and with the shown part (same units); bars are drawn against max */
  now: number;
  then: number;
  max: number;
  text: (v: number) => string;
}
export interface SmithView {
  name: string;
  title: string;
  sling: string | null;
  slots: SmithSlot[];
  sel: number;
  options: SmithOption[];
  /** the part shown on the right (the hovered option, else the fitted one) */
  shown: { name: string; desc: string; state: string };
  stats: SmithStat[];
  notes: string[];
  schematic: HTMLCanvasElement | null;
  exploded: boolean;
  busy: boolean;
  /** the name of the component under the mouse, shown as a tag beside it */
  tag: { text: string; x: number; y: number } | null;
}
/** the card beside the rack for the gun you are looking at */
export interface RackInfo {
  name: string;
  title: string;
  status: string;
  desc: string;
  fitted: string[];
  found: boolean;
}
export type SmithHit = { kind: 'slot'; i: number } | { kind: 'opt'; i: number } | { kind: 'explode' } | { kind: 'sling' } | { kind: 'panel' } | null;

type Rect = { x: number; y: number; w: number; h: number };
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
    if (cache.size > 220) cache.delete(cache.keys().next().value!);
  }
  return cv;
}
const scratch = document.createElement('canvas').getContext('2d')!;
const low = (s: string) => Math.ceil(measure(scratch, s, 16));

/** a padlock, 7 x 8, iron with a brass keyhole */
const LOCK = ['.ooo...', 'o...o..', 'o...o..', 'ooooooo', 'ommmmmo', 'omm.mmo', 'omm.mmo', 'ooooooo'];
/** a jade gem, 7 x 7 (the fitted marker) */
const GEM = ['..ooo..', '.ohlmo.', 'ohllmmo', 'olmmmdo', '.ommdo.', '..odo..', '...o...'];
function icon(rows: string[], pal: Record<string, string>) {
  return sprite('i:' + rows.join('|') + Object.values(pal).join(''), rows[0].length, rows.length, (c) => {
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) if (pal[r[x]]) px(c, x, y, 1, 1, pal[r[x]]);
    });
  });
}
const ICON_LOCK = () => icon(LOCK, { o: UI.iron.o, m: UI.iron.m, '.': '' });
const ICON_GEM = () => icon(GEM, { o: '#0e3a2a', h: '#e8fff4', l: '#8affd0', m: '#3ad89a', d: '#1a8a5a' });

export class GunsmithUI {
  readonly canvas = document.createElement('canvas');
  private c: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private S = 2;
  private k = 0;
  private t = 0;
  private rects: { slots: Rect[]; opts: Rect[]; explode: Rect | null; sling: Rect | null; panels: Rect[] } = { slots: [], opts: [], explode: null, sling: null, panels: [] };
  private hoverHit: SmithHit = null;
  private last: SmithView | null = null;
  private rackK = 0;
  private rackLast: RackInfo | null = null;
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
  /** what a screen point (css px) is over */
  hit(x: number, y: number): SmithHit {
    if (this.k < 0.6) return null;
    const inR = (r: Rect | null) => !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    const si = this.rects.slots.findIndex(inR);
    if (si >= 0) return { kind: 'slot', i: si };
    const oi = this.rects.opts.findIndex(inR);
    if (oi >= 0) return { kind: 'opt', i: oi };
    if (inR(this.rects.explode)) return { kind: 'explode' };
    if (inR(this.rects.sling)) return { kind: 'sling' };
    if (this.rects.panels.some(inR)) return { kind: 'panel' };
    return null;
  }

  frame(rdt: number, v: SmithView | null, hover: SmithHit, rack: RackInfo | null = null) {
    this.t += rdt;
    this.hoverHit = hover;
    if (v) this.last = v;
    this.k += ((v ? 1 : 0) - this.k) * (1 - Math.exp(-rdt * (v ? 5 : 9)));
    if (rack) this.rackLast = rack;
    this.rackK += ((rack ? 1 : 0) - this.rackK) * (1 - Math.exp(-rdt * (rack ? 5 : 9)));
    const c = this.c;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    c.imageSmoothingEnabled = false;
    this.rects = { slots: [], opts: [], explode: null, sling: null, panels: [] };
    if (this.rackLast && this.rackK > 0.01) this.drawRackCard(this.rackLast, this.rackK);
    const d = this.last;
    if (!d || this.k < 0.01) return;
    const a = this.k;
    const S = this.S;
    const side = Math.round(Math.min(330, Math.max(232, this.W * 0.22)));
    const slideL = (1 - a) * -(side + 30), slideR = (1 - a) * (side + 30);
    this.drawTitle(d, a);
    const lb = this.drawComponents(d, 16 + slideL, 100, side, a);
    if (this.H - lb > 150) this.drawSchematic(d, 16 + slideL, lb + 12, side, Math.min(this.H - lb - 70, Math.round(side * 0.66)), a);
    this.drawDetails(d, this.W - 16 - side - 24 + slideR, 100, side + 24, a);
    if (d.tag) this.drawTag(d.tag, a);
  }
  /** a little jade-rimmed tag with the component's name, beside the mouse */
  private drawTag(tg: { text: string; x: number; y: number }, a: number) {
    const S = this.S;
    const tw = this.tw(tg.text, 16);
    const w = Math.ceil((tw + 22) / S), h = 12;
    const img = sprite(`ctag:${w}`, w, h, (c) => {
      px(c, 0, 0, w, h, '#0e3a2a');
      px(c, 1, 1, w - 2, h - 2, '#1e4e3a');
      px(c, 1, 1, w - 2, 1, '#6affc0');
      px(c, 1, h - 2, w - 2, 1, '#0e2a1e');
      for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) px(c, x, y, 1, 1, '#ffcf5a');
    });
    let x = tg.x + 16, y = tg.y + 14;
    if (x + w * S > this.W - 8) x = tg.x - w * S - 10;
    this.blit(img, x, y, a);
    this.ink(tg.text, x + (w * S) / 2, y + (h * S - 16) / 2 + 1, '#e8fff4', 16, 'center', false, a);
  }

  // ---------------------------------------------------------------- drawing helpers
  private blit(img: HTMLCanvasElement, x: number, y: number, alpha = 1, w?: number, h?: number) {
    const c = this.c;
    c.globalAlpha = Math.max(0, Math.min(1, alpha));
    c.drawImage(img, Math.round(x), Math.round(y), w ?? img.width * this.S, h ?? img.height * this.S);
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
  private wrap(s: string, w: number, size = 16) {
    const out: string[] = [];
    let cur = '';
    for (const word of s.split(' ')) {
      const t = cur ? cur + ' ' + word : word;
      if (this.tw(t, size) > w && cur) {
        out.push(cur);
        cur = word;
      } else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  }
  private hov(kind: string, i = -1) {
    const h = this.hoverHit;
    return !!h && h.kind === kind && (i < 0 || (h as { i?: number }).i === i);
  }

  // ---------------------------------------------------------------- the title ribbon
  private drawTitle(d: SmithView, a: number) {
    const S = this.S;
    const w = low(d.name.toUpperCase()) + 26;
    const img = sprite(`smith-title:${d.name}`, w + 16, 20, (c) => {
      c.drawImage(ribbon(w, UI.blood, 5), 0, 0);
      text(c, d.name.toUpperCase(), (w + 16) / 2, 0, '#ffe9a8', 16, 'center');
    });
    const x = this.W / 2 - (img.width * S) / 2, y = 10 - (1 - a) * 50;
    this.blit(img, x, y, a);
    const sub = d.sling ? `${d.title}   ·   ${d.sling}` : d.title;
    this.ink(sub, this.W / 2, y + img.height * S + 4, UI.text, 16, 'center', true, a);
  }

  // ---------------------------------------------------------------- the component list
  private drawComponents(d: SmithView, x: number, y: number, w: number, a: number) {
    const S = this.S;
    const rowH = 44, head = 34;
    const extra = (d.sling ? 1 : 0) + 1;
    const h = head + d.slots.length * rowH + extra * 40 + 18;
    const pw = Math.ceil(w / S), ph = Math.ceil(h / S);
    this.blit(woodPanel(pw, ph, 21, { iron: true, dark: true }), x, y, a);
    this.rects.panels.push({ x, y, w: pw * S, h: ph * S });
    this.ink('COMPONENTS', x + (pw * S) / 2, y + 10, '#ffd36b', 16, 'center', true, a);
    let ry = y + head;
    d.slots.forEach((s, i) => {
      const sel = i === d.sel, hot = this.hov('slot', i);
      const rw = pw - 8, rh = Math.ceil((rowH - 4) / S);
      const plate = sprite(`row:${rw}:${rh}:${sel}:${hot}`, rw, rh, (c) => {
        const P = sel ? UI.brass : UI.wood;
        px(c, 0, 0, rw, rh, P.o);
        px(c, 1, 1, rw - 2, rh - 2, sel ? '#4a3212' : hot ? UI.wood.m : UI.wood.d);
        px(c, 1, 1, rw - 2, 1, sel ? UI.brass.l : UI.wood.l);
        px(c, 1, rh - 2, rw - 2, 1, '#140a04');
        if (sel) {
          px(c, 0, 0, 2, rh, UI.brass.l);
          px(c, rw - 2, 0, 2, rh, UI.brass.m);
        }
      });
      const rx = x + 4 * S;
      this.blit(plate, rx, ry, a);
      this.rects.slots.push({ x: rx, y: ry, w: rw * S, h: rh * S });
      // a jade gem on the selected row (it matches the glow on the gun)
      if (sel) this.blit(ICON_GEM(), rx + 5, ry + (rh * S) / 2 - 7, a);
      const tx = rx + (sel ? 22 : 10);
      this.ink(s.label, tx, ry + 4, sel ? '#ffe9a8' : UI.text, 16, 'left', true, a);
      this.ink(s.part, tx, ry + 21, sel ? '#d8f8e0' : UI.textDim, 15, 'left', false, a);
      // what you own (brass pips) and what is still locked (a padlock with a count)
      let px0 = rx + rw * S - 10;
      if (s.locked) {
        const ic = ICON_LOCK();
        px0 -= ic.width * S;
        this.blit(ic, px0, ry + 5, a);
        this.ink(String(s.locked), px0 - 4, ry + 5, UI.textDim, 15, 'right', false, a);
        px0 -= this.tw(String(s.locked), 15) + 10;
      }
      for (let k = 0; k < s.owned; k++) {
        px0 -= 8;
        this.c.globalAlpha = a;
        this.c.fillStyle = UI.brass.o;
        this.c.fillRect(px0, ry + 9, 6, 6);
        this.c.fillStyle = k === 0 ? UI.brass.h : UI.brass.l;
        this.c.fillRect(px0 + 1, ry + 10, 4, 4);
        this.c.globalAlpha = 1;
      }
      ry += rowH;
    });
    // the sling and the exploded view, as two buttons
    const button = (label: string, key: string, on: boolean, hot: boolean, kind: 'sling' | 'explode') => {
      const bw = pw - 8, bh = 17;
      const kc = keycap(key);
      const img = sprite(`btn:${label}:${key}:${on}:${hot}:${bw}`, bw, bh, (c) => {
        c.drawImage(woodPanel(bw, bh, 9, { dark: !hot }), 0, 0);
        c.drawImage(kc, 3, 1);
        text(c, label, kc.width + 7, 1, on ? '#9affd0' : '#ffe9a8', 16, 'left');
      });
      const bx = x + 4 * S;
      this.blit(img, bx, ry + 4, a);
      this.rects[kind] = { x: bx, y: ry + 4, w: bw * S, h: bh * S };
      ry += 40;
    };
    if (d.sling) button(d.sling === 'Rides with me' ? 'ON THE SLING' : 'STAYS HOME', 'C', d.sling === 'Rides with me', this.hov('sling'), 'sling');
    button(d.exploded ? 'ASSEMBLE' : 'EXPLODE', 'X', d.exploded, this.hov('explode'), 'explode');
    return y + ph * S;
  }

  // ---------------------------------------------------------------- the schematic
  private drawSchematic(d: SmithView, x: number, y: number, w: number, h: number, a: number) {
    const S = this.S;
    const pw = Math.ceil(w / S), ph = Math.ceil(h / S);
    this.blit(ironPlate(pw, ph, 31), x, y, a);
    this.rects.panels.push({ x, y, w: pw * S, h: ph * S });
    const img = d.schematic;
    const ix = x + 4 * S, iy = y + 4 * S, iw = pw * S - 8 * S, ih = ph * S - 8 * S;
    const c = this.c;
    if (img) {
      c.globalAlpha = a;
      c.imageSmoothingEnabled = true;
      const r = Math.max(iw / img.width, ih / img.height);
      const sw = iw / r, sh = ih / r;
      c.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, ix, iy, iw, ih);
      // graded to a cyanotype: the photograph's paper goes prussian blue, its ink lines stay pale
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = '#4a7ec8';
      c.fillRect(ix, iy, iw, ih);
      c.globalCompositeOperation = 'screen';
      c.fillStyle = 'rgba(20,40,90,0.35)';
      c.fillRect(ix, iy, iw, ih);
      c.globalCompositeOperation = 'source-over';
      c.imageSmoothingEnabled = false;
      c.globalAlpha = 1;
    } else {
      c.globalAlpha = a;
      c.fillStyle = '#14202c';
      c.fillRect(ix, iy, iw, ih);
      c.globalAlpha = 1;
      this.ink('the schematic is drying...', ix + iw / 2, iy + ih / 2 - 8, '#9ab8d8', 15, 'center', false, a);
    }
    // a little brass tab with the word on it
    const tab = sprite('schem-tab', low('SCHEMATIC') + 12, 14, (c2) => {
      px(c2, 0, 0, low('SCHEMATIC') + 12, 14, UI.brass.o);
      px(c2, 1, 1, low('SCHEMATIC') + 10, 12, UI.brass.m);
      px(c2, 1, 1, low('SCHEMATIC') + 10, 1, UI.brass.h);
      text(c2, 'SCHEMATIC', (low('SCHEMATIC') + 12) / 2, -1, UI.wood.o, 16, 'center', false);
    });
    this.blit(tab, x + 6 * S, y - 7 * S + 4, a);
  }

  // ---------------------------------------------------------------- the part on the right
  private drawDetails(d: SmithView, x: number, y: number, w: number, a: number) {
    const S = this.S;
    const inner = w - 30;
    // fixed-height text areas, so hovering another part never shifts the rows under the mouse
    const DESC = 3, NOTES = 2;
    const descL = this.wrap(d.shown.desc, inner, 16).slice(0, DESC);
    const noteL = d.notes.slice(0, 2).flatMap((n) => this.wrap(n, inner - 14, 15)).slice(0, NOTES);
    const statH = d.stats.length * 30;
    const optH = d.options.length * 30;
    const h = 22 + 34 + 22 + DESC * 19 + 10 + NOTES * 18 + (statH ? statH + 26 : 0) + 30 + optH + 18;
    const pw = Math.ceil(w / S), ph = Math.ceil(h / S);
    this.blit(parchment(pw, ph, 17), x, y, a);
    this.rects.panels.push({ x, y, w: pw * S, h: ph * S });
    const sel = d.slots[d.sel];
    let ty = y + 12;
    this.ink((sel?.label ?? '').toUpperCase(), x + 16, ty, '#8a2a14', 16, 'left', false, a);
    this.ink(d.shown.state, x + pw * S - 16, ty, d.shown.state === 'FITTED' ? '#1a7a4a' : '#5a4228', 15, 'right', false, a);
    ty += 22;
    // the part's name, big
    const big = this.tw(d.shown.name, 32) > inner ? 24 : 32;
    this.ink(d.shown.name, x + 16, ty + (32 - big) / 2, '#2a160a', big, 'left', false, a);
    ty += 38;
    descL.forEach((l, i) => this.ink(l, x + 16, ty + i * 19, '#3a2414', 16, 'left', false, a));
    ty += DESC * 19;
    noteL.forEach((l, i) => this.ink(l, x + 30, ty + 4 + i * 18, '#7a2a16', 15, 'left', false, a));
    ty += NOTES * 18 + 10;
    // the stats: fitted now (wood fill), the shown part's gain in jade or loss in red
    if (d.stats.length) {
      this.ink('AGAINST WHAT IS FITTED', x + 16, ty, '#6a4a2a', 15, 'left', false, a);
      ty += 22;
      const lw = 88, bw = Math.ceil((inner - lw - 46) / S), bh = 8;
      for (const st of d.stats) {
        this.ink(st.label, x + 16, ty + 1, '#3a2414', 15, 'left', false, a);
        const bx = x + 16 + lw, by = ty;
        this.blit(barFrame(bw, bh), bx, by, a);
        const ix = bx + 7 * S, iw = (bw - 14) * S, iy = by + 3 * S - 1, ih = (bh - 6) * S + 2;
        const f0 = Math.max(0, Math.min(1, st.now / st.max)), f1 = Math.max(0, Math.min(1, st.then / st.max));
        const snap = (v: number) => Math.round(v / S) * S;
        const c = this.c;
        c.globalAlpha = a;
        c.fillStyle = UI.wood.l;
        c.fillRect(ix, iy, snap(iw * Math.min(f0, f1)), ih);
        c.fillStyle = UI.wood.h;
        c.fillRect(ix, iy, snap(iw * Math.min(f0, f1)), S);
        if (f1 > f0 + 0.001) {
          const pulse = 0.75 + Math.sin(this.t * 6) * 0.25;
          c.globalAlpha = a * pulse;
          c.fillStyle = '#3ad89a';
          c.fillRect(ix + snap(iw * f0), iy, Math.max(S, snap(iw * (f1 - f0))), ih);
          c.fillStyle = '#c8ffe8';
          c.fillRect(ix + snap(iw * f0), iy, Math.max(S, snap(iw * (f1 - f0))), S);
        } else if (f1 < f0 - 0.001) {
          c.globalAlpha = a;
          c.fillStyle = '#c03a24';
          c.fillRect(ix + snap(iw * f1), iy, Math.max(S, snap(iw * (f0 - f1))), ih);
        }
        c.globalAlpha = 1;
        const dv = st.then - st.now;
        const col = Math.abs(dv) < 1e-4 ? '#3a2414' : dv > 0 ? '#1a7a4a' : '#a02a18';
        this.ink(st.text(st.then), x + pw * S - 14, ty + 1, col, 15, 'right', false, a);
        ty += 30;
      }
      ty += 4;
    }
    // every part for this slot
    this.ink('PARTS FOR THIS SLOT', x + 16, ty, '#6a4a2a', 15, 'left', false, a);
    ty += 24;
    d.options.forEach((o, i) => {
      const hot = this.hov('opt', i);
      const rw = pw - 10, rh = 13;
      const plate = sprite(`opt:${rw}:${o.state}:${hot}:${!!o.armed}`, rw, rh, (c) => {
        const fitted = o.state === 'fitted';
        px(c, 0, 0, rw, rh, fitted ? '#0e3a2a' : UI.parch.o);
        px(c, 1, 1, rw - 2, rh - 2, fitted ? '#2a6a4a' : hot ? UI.parch.h : o.state === 'blueprint' ? '#c8b088' : UI.parch.l);
        px(c, 1, rh - 2, rw - 2, 1, fitted ? '#1a4a32' : UI.parch.d);
        if (o.armed) {
          px(c, 0, 0, rw, 1, UI.blood.l);
          px(c, 0, rh - 1, rw, 1, UI.blood.l);
        }
      });
      const rx = x + 5 * S;
      this.blit(plate, rx, ty - 3, a);
      this.rects.opts.push({ x: rx, y: ty - 3, w: rw * S, h: rh * S });
      const fitted = o.state === 'fitted';
      const tcol = fitted ? '#e8fff4' : o.state === 'blueprint' ? '#7a6a52' : '#2a160a';
      let lx = rx + 8;
      if (fitted) {
        this.blit(ICON_GEM(), lx, ty + 2, a);
        lx += 18;
      }
      if (o.state === 'buy' || o.state === 'blueprint') {
        this.blit(ICON_LOCK(), lx, ty + 1, a);
        lx += 20;
      }
      this.ink(o.name, lx, ty + 1, tcol, 16, 'left', false, a);
      const right = fitted ? 'FITTED' : o.state === 'owned' ? 'FIT IT' : o.state === 'buy' ? (o.armed ? `BUY? ${o.price}` : `${o.price} GOLD`) : 'BLUEPRINT';
      this.ink(right, rx + rw * S - 8, ty + 2, fitted ? '#9affd0' : o.state === 'buy' ? '#8a5a10' : o.state === 'blueprint' ? '#7a6a52' : '#1a7a4a', 15, 'right', false, a);
      ty += 30;
    });
  }

  /** the focused gun's card beside the rack: its name, how it rides, what it is, what is fitted */
  private drawRackCard(r: RackInfo, a: number) {
    const S = this.S;
    const w = Math.round(Math.min(300, Math.max(230, this.W * 0.21)));
    const inner = w - 32;
    const desc = this.wrap(r.desc, inner, 16).slice(0, 4);
    const fit = r.fitted.length ? this.wrap('Fitted: ' + r.fitted.join(', '), inner, 15).slice(0, 3) : [];
    const h = 20 + 36 + 24 + desc.length * 19 + (fit.length ? 8 + fit.length * 18 : 0) + 50;
    const pw = Math.ceil(w / S), ph = Math.ceil(h / S);
    const x = 16 - (1 - a) * (w + 30), y = Math.round(this.H * 0.22);
    this.blit(parchment(pw, ph, 27), x, y, a);
    let ty = y + 12;
    this.ink(r.title.toUpperCase(), x + 16, ty, '#8a2a14', 15, 'left', false, a);
    ty += 20;
    const big = this.tw(r.name, 32) > inner ? 24 : 32;
    this.ink(r.name, x + 16, ty, r.found ? '#2a160a' : '#6a5a42', big, 'left', false, a);
    ty += big + 4;
    this.ink(r.status, x + 16, ty, r.found ? '#1a7a4a' : '#7a6a52', 16, 'left', false, a);
    ty += 24;
    for (const l of desc) {
      this.ink(l, x + 16, ty, '#3a2414', 16, 'left', false, a);
      ty += 19;
    }
    if (fit.length) ty += 8;
    for (const l of fit) {
      this.ink(l, x + 16, ty, '#6a4a2a', 15, 'left', false, a);
      ty += 18;
    }
    const kc = keycap(r.found ? 'CLICK' : '...');
    this.blit(kc, x + 14, y + ph * S - kc.height * S - 8, a);
    this.ink(r.found ? 'work on it' : 'find its blueprint', x + 22 + kc.width * S, y + ph * S - kc.height * S - 2, '#3a2414', 16, 'left', false, a);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.canvas.remove();
  }
}
