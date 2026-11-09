// The loading hourglass, rendered off the main thread: scene builds there can block for seconds and the
// sand keeps falling here. Messages in: init (an OffscreenCanvas), resize, run, progress. Out: ready (the
// first frame is up), p (the shown fraction, ~10 Hz), error.
import { HourglassView, type ProgressMode } from './HourglassView';

type Msg =
  | { type: 'init'; canvas: OffscreenCanvas; w: number; h: number; dpr: number }
  | { type: 'resize'; w: number; h: number; dpr: number }
  | { type: 'run'; on: boolean }
  | { type: 'progress'; mode: ProgressMode; v?: number };

const scope = self as unknown as {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent<Msg>) => void) | null;
  requestAnimationFrame?: (f: (t: number) => void) => number;
};
const raf = scope.requestAnimationFrame ? scope.requestAnimationFrame.bind(scope) : (f: (t: number) => void) => setTimeout(() => f(performance.now()), 16) as unknown as number;

let view: HourglassView | null = null;
let running = false;
let looping = false;
let last = 0;
let sentReady = false;
let lastPost = 0;

function loop(now: number) {
  if (!running || !view) {
    looping = false;
    return;
  }
  const dt = last ? (now - last) / 1000 : 1 / 60;
  last = now;
  let p = 0;
  try {
    p = view.tick(dt);
  } catch (err) {
    running = looping = false;
    scope.postMessage({ type: 'error', msg: String((err as Error)?.message ?? err) });
    return;
  }
  if (!sentReady) {
    sentReady = true;
    scope.postMessage({ type: 'ready' });
  }
  if (now - lastPost > 100) {
    lastPost = now;
    scope.postMessage({ type: 'p', v: p });
  }
  raf(loop);
}

function start() {
  if (looping) return;
  looping = true;
  last = 0;
  raf(loop);
}

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      view = new HourglassView(m.canvas, m.w, m.h, m.dpr);
    } catch (err) {
      scope.postMessage({ type: 'error', msg: String((err as Error)?.message ?? err) });
      return;
    }
    running = true;
    start();
  } else if (m.type === 'resize') view?.resize(m.w, m.h, m.dpr);
  else if (m.type === 'run') {
    running = m.on;
    if (running) start();
  } else if (m.type === 'progress') view?.progress(m.mode, m.v ?? 0);
};
