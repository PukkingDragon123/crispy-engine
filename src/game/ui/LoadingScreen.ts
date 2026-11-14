// The loading screen: a sculpted voxel hourglass turning in a dark void of souls, its sand falling as the
// game loads, with a pixel-art scarab track (Khepri rolling the sun along a cartouche) and a tip line underneath. It adopts the boot cover from index.html
// (#boot: plain dark CSS that shows before any script runs), so the first moment hands straight over to the
// 3D hourglass without a flash. The engine raises it again over slow scene builds (see Engine.loader).
//
// The 3D renders in a worker on an OffscreenCanvas, so it keeps turning while the main thread is blocked
// building a scene; where that is not possible it renders here on the main thread instead.
import type { LoadingCover } from '../../engine/Engine';
import type { HourglassView, ProgressMode } from './loading/HourglassView';
import { px, text, measure, UI } from './PixelUI';

const TIPS = [
  'Six chambers, no more. Count your bullets.',
  'Read the tarot before you take your card.',
  'Style pays: flashy kills fatten the bounty.',
  'Thoth trades secrets for news of new beasts.',
  'Fall in the Duat and Anubis weighs your heart.',
  'Sinkholes lead below. Something waits there.',
  'Ruins hide nests, and nests guard chests.',
  'Sand crests roll across the dunes. Ride them.',
  'Pinch fights at your side. Mind his tail.',
];

// ------------------------------------------------------------------ the scarab track (pixel art)
// The bar is a carved obsidian cartouche: a gold-rimmed oval tablet with an ankh in its left end and an
// empty sun socket in its right, a tie bar beyond it. Khepri, a gold-and-jade scarab, crawls along the
// channel rolling the sun disc ahead of him; behind him the channel fills with glowing gold sand, and each
// carved glyph above the channel wakes up in gold as he passes it (a puff of jade motes). Grains spray off
// his heels. At the end the sun drops into its socket.
const GD = { o: '#2e1c06', s: '#7c5214', m: '#b88426', l: '#e2b24a', h: '#fff0a6', w: '#fffbe8' };
const ST = { c: '#030208', o: '#05030a', d: '#110c22', m: '#1d1636', l: '#2b2250', h: '#3b2f66' };
const JD = { d: '#1d6a4a', m: '#2fbf7e', l: '#7cf2b4', h: '#eafff2' };
const SAND = ['#7c5214', '#a8741e', '#c99030', '#e2b24a', '#f2cc6a', '#fff0a6'];
const TH = 30, R = 15; // tablet height, end radius
const CH0 = 11, CH1 = 19; // sand rows of the channel
const MID = 15; // the channel's middle row
const SC: Record<string, string> = { o: '#0a0604', d: '#0b2a20', m: '#1d6a4a', l: '#2fbf7e', h: '#7cf2b4', g: '#7c5214', G: '#e2b24a', W: '#fff0a6', s: '#b88426' };
/** Khepri from above, facing right (legs are drawn per frame) */
const SCARAB = [
  '....oooooooo............',
  '..ooGGGGGGGGo...........',
  '.oGGhhhlllllGo.oooo.....',
  'oGhhlllllllmGooWWWWo....',
  'oGlllllmmmmmGoWWWWWWo...',
  'oGmmmddddmmmGoGlllGGoo..',
  'oGmmmmmmmmdmGoGlllGGoWoG',
  'ooooooooooooooGmmmGGoGGW',
  'osllllmmmmmmsoGmmmGGosoG',
  'osmmmmmmmmmdsosdddssoo..',
  'osmmmddddmmdsosssssso...',
  'osddmmmmmmddsoosssso....',
  '.ossddddddddso.oooo.....',
  '..oosssssssso...........',
  '....oooooooo............',
];
/** his six legs, two walking frames (top legs above row 0, bottom legs mirrored below row 14) */
const LEG_TOP: [number, number][][] = [
  [[4, -1], [3, -2], [2, -3], [9, -1], [9, -2], [10, -3], [16, -1], [17, -2], [19, -3]],
  [[4, -1], [4, -2], [4, -3], [9, -1], [8, -2], [7, -3], [16, -1], [16, -2], [17, -3]],
];
const ANKH = ['...ooo...', '..oWGGo..', '.oWo.oGo.', '.oGo.oso.', '.oGo.oso.', '..oGGso..', 'ooooGoooo', 'oWGGGGGso', 'ooosGsooo', '...oGo...', '...oGo...', '...oso...', '...oso...', '...ooo...'];
/** tiny carved glyphs for the band over the channel (5x5) */
const MINI = [
  ['.###.', '.#.#.', '#####', '..#..', '..#..'], // ankh
  ['.###.', '#.#.#', '.###.', '.#...', '#....'], // eye
  ['...#.', '..##.', '.###.', '.##..', '.#...'], // feather
  ['.#.#.', '#.#.#', '.....', '.#.#.', '#.#.#'], // water
  ['.###.', '#...#', '#.#.#', '#...#', '.###.'], // sun
  ['#.#.#', '.###.', '#####', '.###.', '#.#.#'], // scarab
  ['.##..', '#.#..', '..##.', '.####', '..#.#'], // ibis
  ['.#...', '###..', '.#.#.', '.#.#.', '.#.#.'], // reed
];
const h2 = (a: number, b: number) => {
  let n = (a * 374761393 + b * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
/** signed distance (px) of pixel (x, y) to the tablet's rounded outline (negative inside) */
function tabletSd(x: number, y: number, w: number) {
  const qx = Math.abs(x + 0.5 - w / 2) - w / 2 + R, qy = Math.abs(y + 0.5 - TH / 2) - TH / 2 + R;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - R;
}

const tabletCache = new Map<number, HTMLCanvasElement>();
/** the static tablet (stone, gold rim, carved channel, unlit glyphs, ankh, socket), w px wide */
function tablet(w: number) {
  let cv = tabletCache.get(w);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = w + 8;
  cv.height = TH + 8;
  const c = cv.getContext('2d')!;
  const o = 4; // margin for the tie bar
  const tw = w - 6; // the oval; the tie bar sits right of it
  for (let y = 0; y < TH; y++)
    for (let x = 0; x < tw; x++) {
      const d = -tabletSd(x, y, tw);
      if (d <= 0) continue;
      const top = y < TH / 2;
      let col: string;
      if (d < 1) col = ST.o;
      else if (d < 2) col = top ? GD.h : GD.m;
      else if (d < 3) col = top ? GD.l : GD.s;
      else if (d < 4) col = top ? GD.s : GD.o;
      else {
        // carved obsidian: speckled, a bevel light under the rim, a shadow above it
        const r = h2(x * 3 + 7, y * 5 + 1);
        col = r < 0.12 ? ST.d : r > 0.93 ? ST.l : ST.m;
        if (d < 5) col = top ? ST.h : ST.d;
      }
      px(c, x + o, y + o, 1, 1, col);
    }
  const ix = R + 2, iw = tw - 2 * R - 4;
  // the channel: a lip shadow, the deep groove, a lit lower lip
  px(c, ix + o, CH0 - 1 + o, iw, 1, ST.c);
  px(c, ix + o, CH0 + o, iw, CH1 - CH0 + 1, '#08061a');
  px(c, ix + o, CH0 + o, iw, 1, '#050312');
  px(c, ix + o, CH1 + 1 + o, iw, 1, ST.h);
  px(c, ix - 1 + o, CH0 - 1 + o, 1, CH1 - CH0 + 3, ST.c);
  px(c, ix + iw + o, CH0 - 1 + o, 1, CH1 - CH0 + 3, ST.l);
  // unlit glyphs over the channel, and a row of carved chevrons under it
  for (const g of glyphSlots(ix, iw)) MINI[g.k].forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch !== '#') return;
    px(c, g.x + i + o, 4 + j + o, 1, 1, ST.c);
    if (MINI[g.k][j + 1]?.[i] !== '#') px(c, g.x + i + o, 5 + j + o, 1, 1, ST.h);
  }));
  for (let x = ix + 1; x < ix + iw - 2; x += 4) {
    px(c, x + o, 22 + o, 3, 1, ST.c);
    px(c, x + 1 + o, 23 + o, 1, 1, ST.c);
    px(c, x + o, 23 + o, 1, 1, ST.h);
  }
  // the ankh in the left end
  ANKH.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && px(c, 6 + i + o, 8 + j + o, 1, 1, SC[ch] ?? GD.o)));
  // the empty sun socket in the right end
  const sx = ix + iw + 8, sy = MID;
  for (let dy = -8; dy <= 8; dy++)
    for (let dx = -8; dx <= 8; dx++) {
      const r = Math.hypot(dx, dy);
      if (r > 8.2) continue;
      px(c, sx + dx + o, sy + dy + o, 1, 1, r > 7.3 ? (dy < 0 ? ST.c : ST.h) : r > 6.5 ? '#08061a' : '#0c0920');
    }
  // the cartouche's tie bar
  const bx = tw + 1;
  px(c, bx + o, -3 + o, 4, TH + 6, ST.o);
  px(c, bx + 1 + o, -2 + o, 2, TH + 4, GD.l);
  px(c, bx + 1 + o, -2 + o, 1, TH + 4, GD.h);
  px(c, bx + 2 + o, Math.floor(TH / 2) + o, 1, TH / 2 + 2, GD.s);
  px(c, bx - 1 + o, 3 + o, 2, 2, GD.m);
  px(c, bx - 1 + o, TH - 5 + o, 2, 2, GD.m);
  tabletCache.set(w, cv);
  return cv;
}
function glyphSlots(ix: number, iw: number) {
  const out: { x: number; k: number }[] = [];
  for (let x = ix + 3, k = 0; x + 5 < ix + iw - 2; x += 9, k++) out.push({ x, k: (k * 5 + 3) % MINI.length });
  return out;
}

interface Mote { x: number; y: number; vx: number; vy: number; life: number; max: number; col: string; g: number }

export class LoadingScreen implements LoadingCover {
  shown = true;
  private gl: HTMLCanvasElement;
  private ui: HTMLCanvasElement;
  private worker: Worker | null = null;
  private local: HourglassView | null = null;
  private localRaf = 0;
  private fellBack = false;
  private ready = false;
  private running = true;
  private value = 0;
  /** the shown fraction (eases after the glass) and the scarab's walk */
  private shownV = 0;
  private walk = 0;
  private motes: Mote[] = [];
  private litGlyphs = 0;
  private lastDraw = 0;
  private uiRaf = 0;
  private label = 'Gathering souls';
  private tip = Math.floor(Math.random() * TIPS.length);
  private last: { mode: ProgressMode; v: number }[] = [];
  private gen = 0;
  private fontReady = false;

  constructor(private el: HTMLElement, private quality: { dpr?: number } = {}) {
    el.querySelector('.boot-title')?.remove();
    this.gl = document.createElement('canvas');
    this.gl.id = 'boot-gl';
    el.prepend(this.gl);
    this.ui = document.createElement('canvas');
    this.ui.id = 'boot-ui';
    el.append(this.ui);
    if (!this.startWorker()) void this.fallback();
    window.addEventListener('resize', () => this.resize());
    setInterval(() => {
      if (!this.shown) return;
      this.tip = (this.tip + 1) % TIPS.length;
      this.drawUi();
    }, 5200);
    void document.fonts
      ?.load("16px 'Alagard'")
      .then(() => {
        this.fontReady = true;
        this.drawUi();
      })
      .catch(() => {});
    this.drawUi();
    this.loopUi();
  }

  /** the scarab keeps crawling between the glass's progress messages while the main thread is free */
  private loopUi() {
    if (this.uiRaf) return;
    const f = () => {
      this.uiRaf = 0;
      if (this.el.style.display === 'none') return;
      this.drawUi();
      this.uiRaf = requestAnimationFrame(f);
    };
    this.uiRaf = requestAnimationFrame(f);
  }

  // ------------------------------------------------------------------ renderer (worker, or here)
  private size() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.dpr ?? 1.25);
    return { w: window.innerWidth, h: window.innerHeight, dpr };
  }

  private startWorker(): boolean {
    const cv = this.gl as HTMLCanvasElement & { transferControlToOffscreen?: () => OffscreenCanvas };
    if (typeof OffscreenCanvas === 'undefined' || typeof cv.transferControlToOffscreen !== 'function') return false;
    try {
      const off = cv.transferControlToOffscreen();
      const w = new Worker(new URL('./loading/hourglass.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onMessage(e.data);
      w.onerror = (e) => {
        console.warn('[loading] hourglass worker failed, drawing on the main thread', e.message);
        void this.fallback();
      };
      w.postMessage({ type: 'init', canvas: off, ...this.size() }, [off]);
      // no WebGL in workers here: the worker answers with an error and the hourglass draws on this thread
      this.worker = w;
      return true;
    } catch (e) {
      console.warn('[loading] no offscreen hourglass', e);
      return false;
    }
  }

  private onMessage(m: { type: string; v?: number; msg?: string }) {
    if (m.type === 'ready') this.onReady();
    else if (m.type === 'p') {
      this.value = m.v ?? 0;
      if (this.shown) this.drawUi();
    } else if (m.type === 'error') {
      console.warn('[loading] hourglass worker:', m.msg);
      void this.fallback();
    }
  }

  private onReady() {
    if (this.ready) return;
    this.ready = true;
    this.gl.classList.add('on');
  }

  private async fallback() {
    if (this.fellBack) return;
    this.fellBack = true;
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    const fresh = document.createElement('canvas');
    fresh.id = 'boot-gl';
    this.gl.replaceWith(fresh);
    this.gl = fresh;
    try {
      const { HourglassView } = await import('./loading/HourglassView');
      const s = this.size();
      this.local = new HourglassView(fresh, s.w, s.h, s.dpr);
      for (const p of this.last) this.local.progress(p.mode, p.v);
      if (this.running) this.runLocal();
    } catch (e) {
      // the dark cover still stands; only the hourglass is missing
      console.warn('[loading] hourglass unavailable', e);
    }
  }

  private runLocal() {
    if (!this.local || this.localRaf) return;
    let last = performance.now();
    const f = (now: number) => {
      if (!this.local || !this.running) {
        this.localRaf = 0;
        return;
      }
      this.value = this.local.tick(Math.max(0, now - last) / 1000);
      last = Math.max(last, now);
      this.onReady();
      this.drawUi();
      this.localRaf = requestAnimationFrame(f);
    };
    this.localRaf = requestAnimationFrame(f);
  }

  private run(on: boolean) {
    this.running = on;
    this.worker?.postMessage({ type: 'run', on });
    if (on) this.runLocal();
  }

  private send(mode: ProgressMode, v = 0) {
    if (mode === 'reset') this.last = [];
    this.last.push({ mode, v });
    if (this.last.length > 8) this.last.splice(0, this.last.length - 8);
    this.worker?.postMessage({ type: 'progress', mode, v });
    this.local?.progress(mode, v);
  }

  private resize() {
    const s = this.size();
    this.worker?.postMessage({ type: 'resize', ...s });
    this.local?.resize(s.w, s.h, s.dpr);
    this.drawUi();
  }

  // ------------------------------------------------------------------ the cover
  /** a known fraction of the boot load (assets) */
  setProgress(f: number) {
    this.send('set', f);
  }

  show(label = 'Turning the glass'): Promise<void> {
    this.label = label;
    ++this.gen;
    if (this.shown) {
      // already up (the boot): carry on from where the sand is
      this.send('pace');
      this.drawUi();
      return Promise.resolve();
    }
    this.shown = true;
    this.send('reset');
    this.send('pace');
    this.value = 0;
    this.run(true);
    this.drawUi();
    const el = this.el;
    el.style.display = 'block';
    this.shownV = 0;
    this.motes.length = 0;
    this.litGlyphs = 0;
    this.loopUi();
    void el.offsetWidth;
    el.style.opacity = '1';
    return new Promise((res) => setTimeout(res, 420));
  }

  hide(): Promise<void> {
    if (!this.shown) return Promise.resolve();
    this.shown = false;
    const gen = ++this.gen;
    this.send('finish');
    return new Promise((res) => {
      // let the last grains fall, then fade away
      setTimeout(() => {
        if (gen !== this.gen) return res();
        this.value = 1;
        this.drawUi();
        this.el.style.opacity = '0';
        setTimeout(() => {
          if (gen === this.gen && !this.shown) {
            this.el.style.display = 'none';
            this.run(false);
          }
          res();
        }, 470);
      }, 280);
    });
  }

  // ------------------------------------------------------------------ pixel UI: label, scarab track, tip
  private drawUi() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const S = Math.max(1, Math.min(4, Math.round(Math.min(vw / 560, vh / 330))));
    const W = Math.ceil(vw / S), H = 82;
    const cv = this.ui;
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
      cv.style.width = W * S + 'px';
      cv.style.height = H * S + 'px';
    }
    const c = cv.getContext('2d');
    if (!c) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - (this.lastDraw || now)) / 1000));
    this.lastDraw = now;
    const t = now / 1000;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, W, H);
    if (!this.fontReady) return;
    const cx = Math.floor(W / 2);
    text(c, this.label, cx, 2, JD.l, 16, 'center');
    const bw = Math.min(300, W - 16);
    this.drawTrack(c, cx - Math.floor(bw / 2), 24, bw, t, dt);
    // a tip that fits the width
    let tip = TIPS[this.tip];
    for (let k = 0; k < TIPS.length && measure(c, tip, 16) > W - 10; k++) tip = TIPS[(this.tip + k + 1) % TIPS.length];
    if (measure(c, tip, 16) <= W - 10) text(c, tip, cx, 64, UI.textDim, 16, 'center');
  }

  /** the cartouche, its sand, the glyphs, Khepri and his sun, and the grains in the air */
  private drawTrack(c: CanvasRenderingContext2D, x0: number, y0: number, w: number, t: number, dt: number) {
    const target = Math.max(0, Math.min(1, this.value));
    const prev = this.shownV;
    this.shownV = target < prev ? target : prev + (target - prev) * (1 - Math.exp(-dt * 5));
    const f = this.shownV;
    const moving = Math.min(1, Math.abs(this.shownV - prev) / Math.max(dt, 1e-3) * 6);
    this.walk += dt * (2.5 + moving * 9);
    c.drawImage(tablet(w), x0 - 4, y0 - 4);
    const tw = w - 6;
    const ix = x0 + R + 2, iw = tw - 2 * R - 4;
    const fx = ix + Math.round(iw * f); // the sand reaches here; the scarab's nose
    // ---- the gold sand: a slow flowing dither, brighter on top, a heap at the front
    const flow = Math.floor(t * 9);
    for (let x = ix; x < fx; x++) {
      const back = fx - x;
      const crest = back < 5 ? 5 - back : 0;
      const bump = h2((x - flow) >> 1, 77) < 0.18 ? 1 : 0;
      for (let y = CH0 + Math.max(crest, bump); y <= CH1; y++) {
        const depth = y - CH0;
        let k = 3 - (depth > 4 ? 1 : 0) - (depth > 5 ? 1 : 0);
        const r = h2((x - flow - (y & 1) * 2) >> 1, y * 31);
        if (r < 0.2) k--;
        else if (r > 0.86) k++;
        if (y === CH0 + Math.max(crest, bump)) k = Math.max(k, 4);
        // a slow glow wave rolls through the sand
        const wave = Math.sin((x - ix) * 0.11 - t * 2.4);
        if (wave > 0.85 && depth < 4) k++;
        px(c, x, y0 + y, 1, 1, SAND[Math.max(0, Math.min(5, k))]);
      }
    }
    // ---- glyphs over the channel wake up as he passes
    let lit = 0;
    for (const g of glyphSlots(R + 2, iw)) {
      const gx = x0 + g.x;
      if (gx + 2 >= fx) break;
      lit++;
      const fresh = fx - (gx + 2);
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + gx * 0.3);
      MINI[g.k].forEach((row, j) => [...row].forEach((ch, i) => {
        if (ch !== '#') return;
        const top = MINI[g.k][j - 1]?.[i] !== '#';
        px(c, gx + i, y0 + 4 + j, 1, 1, fresh < 6 ? GD.w : top ? GD.h : pulse > 0.7 && j === 2 ? GD.h : GD.l);
      }));
    }
    if (lit > this.litGlyphs) {
      for (let k = 0; k < 6; k++) {
        const gx = x0 + glyphSlots(R + 2, iw)[lit - 1].x + 2;
        this.motes.push({ x: gx, y: y0 + 6, vx: (Math.random() - 0.5) * 16, vy: -14 - Math.random() * 18, life: 0, max: 0.7 + Math.random() * 0.5, col: Math.random() < 0.5 ? JD.l : JD.h, g: -6 });
      }
    }
    this.litGlyphs = lit;
    // chevrons under the channel take a jade light behind him
    for (let x = ix + 1; x < Math.min(fx, ix + iw - 2); x += 4) px(c, x, y0 + 22, 3, 1, JD.m), px(c, x + 1, y0 + 23, 1, 1, JD.d);
    // ---- the sun disc rolls ahead; at the end it drops into its socket
    const end = ix + iw + 8;
    // he waits at the start of the channel until the sand has caught up behind him
    const nose = Math.max(fx, ix + 24);
    const sx = Math.min(end, nose + 8), sy = y0 + MID;
    const home = Math.max(0, 1 - (end - sx) / 8);
    const roll = (sx - ix) / 5;
    c.save();
    for (let r = 12; r >= 8; r--) {
      c.globalAlpha = (0.05 + home * 0.05) * (13 - r) * (0.8 + 0.2 * Math.sin(t * 3));
      for (let a = 0; a < 56; a++) {
        const th = (a / 56) * Math.PI * 2;
        px(c, sx + Math.round(Math.cos(th) * r), sy + Math.round(Math.sin(th) * r), 1, 1, GD.h);
      }
    }
    // turning rays
    c.globalAlpha = 0.55 + home * 0.4;
    for (let k = 0; k < 8; k++) {
      const th = (k / 8) * Math.PI * 2 + t * 0.6;
      const len = k % 2 ? 2 : 3 + Math.round(home * 3);
      for (let q = 0; q < len; q++) px(c, sx + Math.round(Math.cos(th) * (9 + q)), sy + Math.round(Math.sin(th) * (9 + q)), 1, 1, q ? GD.l : GD.h);
    }
    c.restore();
    for (let dy = -7; dy <= 7; dy++)
      for (let dx = -7; dx <= 7; dx++) {
        const r = Math.hypot(dx, dy);
        if (r > 7.3) continue;
        let col = r > 6.5 ? GD.o : r > 5.5 ? (dx + dy < 0 ? GD.l : GD.s) : r > 4.4 ? (dx + dy < -2 ? GD.h : GD.l) : r > 2.6 ? GD.h : GD.w;
        // the carved uraeus band on the disc shows it rolling
        const th = Math.atan2(dy, dx) - roll;
        if (r > 4.4 && r < 5.5 && Math.cos(th * 3) > 0.9) col = GD.m;
        px(c, sx + dx, sy + dy, 1, 1, col);
      }
    // ---- Khepri pushing it
    const sxL = Math.min(nose, end - 8) - 23, syT = y0 + MID - 7;
    const fr = Math.floor(this.walk) & 1;
    const bob = fr && moving > 0.2 ? 1 : 0;
    // legs: dark outline under, gold on top; the bottom row walks out of phase with the top
    LEG_TOP[fr].forEach(([lx, ly]) => px(c, sxL + lx, syT + ly + bob, 1, 1, ly === -3 ? GD.l : GD.s));
    LEG_TOP[fr ^ 1].forEach(([lx, ly]) => px(c, sxL + lx, syT + 14 - ly + bob, 1, 1, ly === -3 ? GD.m : GD.s));
    SCARAB.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && px(c, sxL + i, syT + j + bob, 1, 1, SC[ch])));
    // ---- grains kicked off his heels, sparks off the sun
    if (moving > 0.05 && Math.random() < dt * (6 + moving * 30))
      this.motes.push({ x: sxL + 1, y: syT + 5 + Math.random() * 5, vx: -8 - Math.random() * 22, vy: -18 - Math.random() * 22, life: 0, max: 0.5 + Math.random() * 0.4, col: SAND[2 + Math.floor(Math.random() * 4)], g: 90 });
    if (Math.random() < dt * (3 + home * 10))
      this.motes.push({ x: sx + (Math.random() - 0.5) * 14, y: sy + (Math.random() - 0.5) * 14, vx: (Math.random() - 0.5) * 8, vy: -6 - Math.random() * 10, life: 0, max: 0.6 + Math.random() * 0.6, col: Math.random() < 0.5 ? GD.h : GD.w, g: -4 });
    for (let k = this.motes.length - 1; k >= 0; k--) {
      const m = this.motes[k];
      m.life += dt;
      m.vy += m.g * dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.life > m.max || (m.g > 0 && m.y > y0 + CH1 + 1)) {
        this.motes.splice(k, 1);
        continue;
      }
      const a = 1 - m.life / m.max;
      c.globalAlpha = Math.min(1, a * 1.6);
      px(c, Math.round(m.x), Math.round(m.y), 1, 1, m.col);
      // the brightest motes twinkle as tiny crosses
      if (m.col === GD.w && a > 0.5 && (Math.floor(t * 8 + k) & 3) === 0) {
        px(c, Math.round(m.x) - 1, Math.round(m.y), 3, 1, m.col);
        px(c, Math.round(m.x), Math.round(m.y) - 1, 1, 3, m.col);
      }
    }
    c.globalAlpha = 1;
    if (this.motes.length > 140) this.motes.splice(0, this.motes.length - 140);
  }
}
