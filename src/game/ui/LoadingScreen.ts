// The loading screen: a sculpted voxel hourglass turning in a dark void of souls, its sand falling as the
// game loads, with a pixel-art soul bar and a tip line underneath. It adopts the boot cover from index.html
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

// pixel palette: obsidian bar body, jade soul fill, gold caps
const OB = { o: '#05030a', d: '#1d1636', l: '#3b2f66', s: '#120d24', ch: '#030208' };
const JD = { d: '#1d6a4a', m: '#2fbf7e', l: '#7cf2b4', h: '#eafff2' };
const CAP: Record<string, string> = { o: '#2e1c06', h: '#fff0a6', l: '#e2b24a', m: '#b88426', s: '#7c5214', J: '#2fbf7e', I: '#eafff2' };
const CAP_ROWS = ['..ooooo..', '.ohhllmo.', 'ohllmmmso', 'olmJJJmso', 'olmJIJmso', 'olmJJJmso', 'ommmmmsso', '.ossssso.', '..ooooo..'];

function drawCap(c: CanvasRenderingContext2D, x: number, y: number, flip: boolean) {
  CAP_ROWS.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = flip ? row[row.length - 1 - i] : row[i];
      if (ch !== '.') px(c, x + i, y + j, 1, 1, CAP[ch]);
    }
  });
}

/** the soul bar: an obsidian channel between two gold bezels, filled with segmented jade */
function drawSoulBar(c: CanvasRenderingContext2D, x: number, y: number, w: number, f: number, t: number) {
  const h = 11;
  px(c, x + 3, y, w - 6, h, OB.o);
  px(c, x + 4, y + 1, w - 8, h - 2, OB.d);
  px(c, x + 4, y + 1, w - 8, 1, OB.l);
  px(c, x + 4, y + h - 2, w - 8, 1, OB.s);
  const ix = x + 10, iw = w - 20, iy = y + 3, ih = h - 6;
  px(c, ix - 1, iy - 1, iw + 2, ih + 2, OB.ch);
  const fw = Math.round(iw * Math.max(0, Math.min(1, f)));
  if (fw > 0) {
    px(c, ix, iy, fw, ih, JD.m);
    px(c, ix, iy, fw, 1, JD.l);
    px(c, ix, iy + ih - 1, fw, 1, JD.d);
    for (let k = ix + 6; k < ix + fw - 1; k += 6) px(c, k, iy + 1, 1, ih - 2, JD.d);
    // a glint running along the souls
    const sx = ix + (Math.floor(t * 42) % Math.max(1, fw + 12)) - 6;
    if (sx >= ix && sx < ix + fw - 1) px(c, sx, iy, 2, ih - 1, JD.l);
    px(c, ix + fw - 1, iy, 1, ih, JD.h);
  }
  drawCap(c, x, y + 1, false);
  drawCap(c, x + w - 9, y + 1, true);
}

export class LoadingScreen implements LoadingCover {
  shown = true;
  private gl: HTMLCanvasElement;
  private ui: HTMLCanvasElement;
  private title: HTMLElement | null;
  private worker: Worker | null = null;
  private local: HourglassView | null = null;
  private localRaf = 0;
  private fellBack = false;
  private ready = false;
  private running = true;
  private value = 0;
  private label = 'Gathering souls';
  private tip = Math.floor(Math.random() * TIPS.length);
  private last: { mode: ProgressMode; v: number }[] = [];
  private gen = 0;
  private fontReady = false;

  constructor(private el: HTMLElement, private quality: { dpr?: number } = {}) {
    this.title = el.querySelector('.boot-title');
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
            this.title?.remove();
            this.title = null;
          }
          res();
        }, 470);
      }, 280);
    });
  }

  // ------------------------------------------------------------------ pixel UI: label, soul bar, tip
  private drawUi() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const S = Math.max(1, Math.min(4, Math.round(Math.min(vw / 560, vh / 330))));
    const W = Math.ceil(vw / S), H = 72;
    const cv = this.ui;
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
      cv.style.width = W * S + 'px';
      cv.style.height = H * S + 'px';
    }
    const c = cv.getContext('2d');
    if (!c) return;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, W, H);
    if (!this.fontReady) return;
    const cx = Math.floor(W / 2);
    text(c, this.label, cx, 4, JD.l, 16, 'center');
    const bw = Math.min(200, W - 20);
    drawSoulBar(c, cx - Math.floor(bw / 2), 26, bw, this.value, performance.now() / 1000);
    // a tip that fits the width
    let tip = TIPS[this.tip];
    for (let k = 0; k < TIPS.length && measure(c, tip, 16) > W - 10; k++) tip = TIPS[(this.tip + k + 1) % TIPS.length];
    if (measure(c, tip, 16) <= W - 10) text(c, tip, cx, 46, UI.textDim, 16, 'center');
  }
}
