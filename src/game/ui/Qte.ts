// Skill-based QTEs drawn as crisp pixel art (ink outlines, bone and gold, Alagard)
// on their own overlay canvas. One visual language for every prompt:
//   ring      a gold ring closes on a notched bone sight ring; press as they meet
//             (perfect at RING_PERFECT of the duration, so callers can sync a blow)
//   bar       a needle sweeps a gauge; press inside the gold (perfect on the bright notch)
//   mash / sequence / balance   kept for their callers, same frame and ink
// Feedback: PERFECT / GOOD / MISS slam in as Alagard stamps with a burst of pixel
// sparks and a sound; a perfect also gets a short slow-motion kiss (hit-stop).
// All QTEs run on real time (unaffected by slow motion) and resolve to
// 'perfect' | 'good' | 'fail'.
// A spec may carry `at` (a world point, or a getter for a moving threat): the
// prompt then floats over that threat on screen (clamped inside the screen)
// instead of sitting at the centre; `anchor` reports where it is drawn so the
// touch layer can put its Alagard line under it.
// QUICK prompts (`quick()`): a small optional ring that never blocks anything.
// It does not occupy `active` (dodges and other QTEs still fire), listens for an
// input ACTION (keyboard or the touch layer), or a tap on the prompt itself, and
// quietly resolves 'skip' when ignored or when a full QTE takes the screen.
import type { Input, Action } from '../../engine/Input';
import type { AudioEngine } from '../../engine/audio/AudioEngine';
import { isTouchDevice } from './TouchControls';

export type QteResult = 'perfect' | 'good' | 'fail';
export type QuickResult = QteResult | 'skip';
type P3 = { x: number; y: number; z: number };
/** where the threat is: a world point or a getter (null = fall back to the centre) */
export type QteAt = P3 | (() => P3 | null | undefined);
export type QteSpec = (
  | { kind: 'ring'; key?: string; /** other keys that also count */ alt?: string[]; label?: string; duration?: number }
  | { kind: 'mash'; key?: string; label?: string; duration?: number; target?: number }
  | { kind: 'sequence'; keys: string[]; label?: string; duration?: number }
  | { kind: 'balance'; label?: string; duration?: number; drift?: number }
  | { kind: 'bar'; key?: string; label?: string; speed?: number; width?: number; /** real seconds before it counts as a miss (default: waits) */ duration?: number; /** start phase (rad) of the sweep */ phase?: number }
) & { at?: QteAt; /** no slow-motion kiss on a perfect */ noKiss?: boolean };

export interface QuickSpec {
  /** the input action that answers it (e.g. 'skill1', 'grenade', 'interact') */
  action: Action;
  label?: string;
  /** real seconds the ring takes to close (perfect at RING_PERFECT of it) */
  duration?: number;
  at?: QteAt;
  /** ring tint: 'gold' (default) or 'jade' */
  tone?: 'gold' | 'jade';
}

interface Active {
  spec: QteSpec;
  t: number;
  resolve: (r: QteResult) => void;
  state: any;
  done?: { r: QteResult; t: number };
}
interface Quick {
  spec: QuickSpec;
  t: number;
  resolve: (r: QuickResult) => void;
  done?: { r: QuickResult; t: number };
  x: number;
  y: number;
  tapped: boolean;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  col: string;
  s: number;
}

/** on touch a key cap only stays where it names a direction (swipe sequences, the balance sides) */
const TOUCH_WORD: Record<string, string> = { W: 'UP', A: 'LEFT', S: 'DOWN', D: 'RIGHT' };
const KEYNAME: Record<string, string> = { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', Space: 'SPACE', KeyZ: 'Z', KeyF: 'F', KeyE: 'E', Mouse0: 'LMB', KeyQ: 'Q', KeyR: 'R', KeyT: 'T', KeyG: 'G', KeyC: 'C', KeyX: 'X', Enter: 'ENTER' };

// ink and metal (the pixel UI palette)
const INK = '#1a0e06';
const BONE = '#f6ead0';
const BONE_D = '#c9b48a';
const GOLD = '#e2b24a';
const GOLD_H = '#fff0a6';
const GOLD_D = '#9a6a1c';
const JADE = '#6fe3cf';
const JADE_H = '#d6fff4';
const RED = '#dc4430';
const RES_COL: Record<QteResult, [string, string]> = { perfect: [GOLD_H, GOLD], good: [JADE_H, JADE], fail: ['#ff9a80', RED] };
const RES_WORD: Record<QteResult, string> = { perfect: 'PERFECT', good: 'GOOD', fail: 'MISS' };

/** ring geometry (QTE px): the closing ring starts at R0 and meets the sight ring RT at RING_PERFECT */
const R0 = 46, RT = 15;
const QR0 = 30, QRT = 10;

export class Qte {
  /** the live QTE layer of the running scene (skills and set pieces reach it here) */
  static current: Qte | null = null;
  /** fraction of a ring's duration at which the closing ring sits exactly on the sight */
  static readonly RING_PERFECT = 0.8;

  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  active: Active | null = null;
  /** the optional quick prompt (never blocks) */
  quickActive: Quick | null = null;
  private scale = 2;
  private touch = isTouchDevice();
  /** world -> screen (css px); defaults to the run HUD's projector */
  project: ((p: P3) => { x: number; y: number; visible: boolean; behind?: boolean }) | null = null;
  /** where the live prompt is drawn when it follows a threat (css px: centre and the bottom of the prompt) */
  anchor: { x: number; y: number; bottom: number } | null = null;
  private ax = 0;
  private ay = 0;
  private anchored = false;
  private sparks: Spark[] = [];
  private flashes: { x: number; y: number; t: number; col: string; r: number }[] = [];
  private sprites = new Map<string, HTMLCanvasElement>();
  private time = 0;
  private onResize = () => this.resize();
  private onTouch = (e: TouchEvent) => {
    const q = this.quickActive;
    if (!q || q.done) return;
    for (const t of Array.from(e.changedTouches)) {
      const dx = t.clientX - q.x * this.scale, dy = t.clientY - q.y * this.scale;
      if (Math.hypot(dx, dy) < QR0 * this.scale * 1.6) q.tapped = true;
    }
  };

  constructor(parent: HTMLElement, private input: Input, private audio: AudioEngine) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;image-rendering:pixelated';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('touchstart', this.onTouch, { passive: true });
    Qte.current = this;
  }
  resize() {
    this.scale = window.innerWidth > 1700 ? 3 : 2;
    this.canvas.width = Math.ceil(window.innerWidth / this.scale);
    this.canvas.height = Math.ceil(window.innerHeight / this.scale);
    this.ctx.imageSmoothingEnabled = false;
  }

  /** real seconds from the start of a ring of this duration to its perfect moment */
  static ringPerfect(duration = 1.15) {
    return duration * Qte.RING_PERFECT;
  }

  run(spec: QteSpec): Promise<QteResult> {
    this.active?.resolve('fail');
    // a full QTE owns the screen: the optional prompt bows out
    if (this.quickActive && !this.quickActive.done) this.endQuick('skip');
    return new Promise((resolve) => {
      const st: any = {};
      if (spec.kind === 'mash') st.fill = 0;
      if (spec.kind === 'sequence') st.i = 0;
      if (spec.kind === 'balance') {
        st.x = 0;
        st.v = 0;
        st.inside = 0;
      }
      if (spec.kind === 'bar') st.x = 0;
      this.active = { spec, t: 0, resolve, state: st };
      this.anchored = false;
      this.audio.play('qte_prompt', { volume: 0.6 });
    });
  }

  /**
   * Offer an optional quick ring. Never blocks: ignored (or pushed aside by a full
   * QTE) it resolves 'skip' without a sound. A newer offer replaces an older one.
   */
  quick(spec: QuickSpec): Promise<QuickResult> {
    if (this.quickActive && !this.quickActive.done) this.endQuick('skip');
    if (this.active && !this.active.done) return Promise.resolve('skip');
    return new Promise((resolve) => {
      this.quickActive = { spec, t: 0, resolve, x: -999, y: -999, tapped: false };
      this.audio.play('qte_prompt', { volume: 0.3, pitch: 1.35 });
    });
  }

  /** is a quick prompt waiting on this action right now (callers may swallow that press) */
  quickWants(action: Action) {
    const q = this.quickActive;
    return !!q && !q.done && q.spec.action === action;
  }

  private pressed(code: string) {
    return this.input.wasPressed(code);
  }

  private kiss() {
    const eng = (window as any).__engine;
    if (eng?.hitStop && !eng.paused) eng.hitStop(0.11, 0.07);
  }

  private finish(r: QteResult) {
    const a = this.active!;
    if (a.done) return;
    a.done = { r, t: 0 };
    this.audio.play(r === 'perfect' ? 'qte_perfect' : r === 'good' ? 'qte_good' : 'qte_fail', { volume: 0.7 });
    if (r === 'perfect' && !a.spec.noKiss) this.kiss();
    this.burst(this.ax, this.ay, r, 1);
    a.resolve(r);
  }

  private endQuick(r: QuickResult) {
    const q = this.quickActive!;
    if (q.done) return;
    q.done = { r, t: 0 };
    if (r !== 'skip') {
      this.audio.play(r === 'perfect' ? 'qte_perfect' : r === 'good' ? 'qte_good' : 'qte_fail', { volume: r === 'fail' ? 0.35 : 0.55, pitch: 1.12 });
      if (r === 'perfect') this.kiss();
      this.burst(q.x, q.y, r, 0.6);
    }
    q.resolve(r);
  }

  update(rdt: number) {
    const c = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    this.time += rdt;
    this.updateQuick(rdt, W, H);
    this.drawSparks(rdt);
    const a = this.active;
    if (!a) {
      this.anchor = null;
      return;
    }
    a.t += rdt;
    const [cx, cy] = this.place(a, W, H, rdt);
    if (a.done) {
      a.done.t += rdt;
      this.stamp(RES_WORD[a.done.r], cx, cy - 8, a.done.r, a.done.t, 1);
      if (a.done.t > 0.62) this.active = null;
      return;
    }
    const s = a.spec;
    if (s.label) this.text(s.label, cx, cy - (s.kind === 'ring' ? R0 + 14 : 30), BONE, 16);
    switch (s.kind) {
      case 'ring': {
        const dur = s.duration ?? 1.15;
        const key = s.key ?? 'KeyZ';
        const k = a.t / dur;
        const r = this.ringR(k, R0, RT);
        this.drawRing(cx, cy, k, r, RT, R0, 'gold', 1);
        this.keycap(KEYNAME[key] ?? key, cx, cy);
        const err = Math.abs(r - RT);
        const hit = this.pressed(key) || (key === 'KeyZ' && this.pressed('Mouse0')) || !!s.alt?.some((q) => this.pressed(q));
        if (hit) this.finish(err < 3.2 ? 'perfect' : err < 8 ? 'good' : 'fail');
        else if (a.t > dur) this.finish('fail');
        break;
      }
      case 'mash': {
        const dur = s.duration ?? 2.2;
        const key = s.key ?? 'Space';
        const target = s.target ?? 14;
        if (this.pressed(key)) {
          a.state.fill += 1;
          a.state.kick = 1;
          this.audio.play('ui_click', { volume: 0.25, pitch: 1 + a.state.fill * 0.03 });
          this.sparkle(cx + (Math.random() - 0.5) * 60, cy + 15, GOLD_H, 2);
        }
        a.state.kick = Math.max(0, (a.state.kick ?? 0) - rdt * 8);
        a.state.fill = Math.max(0, a.state.fill - rdt * 2.2);
        const f = Math.min(1, a.state.fill / target);
        this.gauge(cx - 52, cy + 12, 104, 7, f, f > 0.99 ? GOLD_H : GOLD, 1 - a.t / dur);
        this.keycap(KEYNAME[key] ?? key, cx, cy - 6, 1 + a.state.kick * 0.25);
        this.text('MASH', cx, cy + 22, BONE_D, 16);
        if (f >= 1) this.finish(a.t < dur * 0.6 ? 'perfect' : 'good');
        else if (a.t > dur) this.finish(f > 0.7 ? 'good' : 'fail');
        break;
      }
      case 'sequence': {
        const dur = s.duration ?? 2.6;
        const keys = s.keys;
        const step = 19;
        const w = keys.length * step;
        keys.forEach((k, i) => {
          const x = cx - w / 2 + i * step + step / 2;
          const doneK = i < a.state.i, cur = i === a.state.i;
          this.keycap(KEYNAME[k] ?? k, x, cy + (cur ? Math.round(Math.sin(this.time * 14)) : 0), cur ? 1.15 : 0.9, doneK ? 'done' : cur ? 'live' : 'idle');
        });
        this.gauge(cx - w / 2, cy + 13, w, 4, 1 - a.t / dur, BONE_D);
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyF', 'KeyE', 'KeyQ']) {
          if (!this.pressed(code)) continue;
          if (code === keys[a.state.i]) {
            a.state.i++;
            this.audio.play('ui_click', { volume: 0.4, pitch: 1 + a.state.i * 0.08 });
            this.sparkle(cx - w / 2 + (a.state.i - 0.5) * step, cy, JADE_H, 6);
            if (a.state.i >= keys.length) this.finish(a.t < dur * 0.55 ? 'perfect' : 'good');
          } else this.finish('fail');
          break;
        }
        if (!a.done && a.t > dur) this.finish('fail');
        break;
      }
      case 'balance': {
        const dur = s.duration ?? 3.5;
        const st = a.state;
        const drift = s.drift ?? 1.4;
        st.v += (Math.sin(a.t * 2.3) * 0.8 + Math.sin(a.t * 5.1) * 0.4) * drift * rdt;
        if (this.input.isDown('KeyA') || this.input.isDown('ArrowLeft')) st.v -= 2.6 * rdt;
        if (this.input.isDown('KeyD') || this.input.isDown('ArrowRight')) st.v += 2.6 * rdt;
        st.v *= Math.exp(-1.2 * rdt);
        st.x = Math.max(-1, Math.min(1, st.x + st.v * rdt));
        if (Math.abs(st.x) < 0.22) st.inside += rdt;
        const w = 110;
        this.track(cx, cy, w, 0.22, 0.08, (st.x + 1) / 2, Math.abs(st.x) < 0.22);
        this.keycap('A', cx - w / 2 - 15, cy);
        this.keycap('D', cx + w / 2 + 15, cy);
        this.gauge(cx - w / 2, cy + 12, w, 4, 1 - a.t / dur, BONE_D);
        if (Math.abs(st.x) >= 0.999) this.finish('fail');
        else if (a.t > dur) this.finish(st.inside / dur > 0.8 ? 'perfect' : st.inside / dur > 0.5 ? 'good' : 'fail');
        break;
      }
      case 'bar': {
        const sp = s.speed ?? 1.4;
        const width = s.width ?? 0.14;
        const key = s.key ?? 'Mouse0';
        const x = (Math.sin(a.t * sp * Math.PI + (s.phase ?? 0)) + 1) / 2;
        a.state.x = x;
        const w = 124;
        const sweet = 0.5;
        const e = Math.abs(x - sweet);
        this.track(cx, cy, w, width, width * 0.35, x, e < width);
        this.keycap(KEYNAME[key] ?? key, cx, cy + 19);
        if (s.duration) this.gauge(cx - w / 2, cy + 29, w, 3, 1 - a.t / s.duration, BONE_D);
        if (this.pressed(key) || (key === 'Mouse0' && this.pressed('Space'))) this.finish(e < width * 0.35 ? 'perfect' : e < width ? 'good' : 'fail');
        else if (s.duration && a.t > s.duration) this.finish('fail');
        break;
      }
    }
  }

  // ------------------------------------------------------------------ the quick lane
  private updateQuick(rdt: number, W: number, H: number) {
    const q = this.quickActive;
    if (!q) return;
    q.t += rdt;
    // where: over its anchor (or low right of centre), clamped on screen
    let tx = W * 0.5 + 64, ty = H * 0.58;
    const at = q.spec.at;
    if (at) {
      const w = typeof at === 'function' ? at() : at;
      const proj = this.project ?? (window as any).__engine?.current?.hud?.project;
      const p = w && proj ? proj(w) : null;
      if (p && p.visible && !p.behind) {
        tx = p.x / this.scale;
        ty = p.y / this.scale;
      }
    }
    tx = Math.max(QR0 + 8, Math.min(W - QR0 - 8, tx));
    ty = Math.max(QR0 + 24, Math.min(H - QR0 - 20, ty));
    if (q.x < -900) {
      q.x = tx;
      q.y = ty;
    } else if (!q.done) {
      const f = Math.min(1, rdt * 12);
      q.x += (tx - q.x) * f;
      q.y += (ty - q.y) * f;
    }
    const cx = Math.round(q.x), cy = Math.round(q.y);
    if (q.done) {
      q.done.t += rdt;
      if (q.done.r !== 'skip') this.stamp(q.done.r === 'perfect' ? 'EMPOWERED' : q.done.r === 'good' ? 'GOOD' : 'MISS', cx, cy - 6, q.done.r, q.done.t, 0.5);
      else {
        // ignored: the ring just thins away
        const k = 1 - q.done.t / 0.25;
        if (k > 0) this.drawRing(cx, cy, 1, QRT * 0.5, QRT, QR0, q.spec.tone ?? 'gold', k * 0.6);
      }
      if (q.done.t > (q.done.r === 'skip' ? 0.25 : 0.5)) this.quickActive = null;
      return;
    }
    const dur = q.spec.duration ?? 0.8;
    const k = q.t / dur;
    const r = this.ringR(k, QR0, QRT);
    const fadeIn = Math.min(1, q.t / 0.1);
    this.drawRing(cx, cy, k, r, QRT, QR0, q.spec.tone ?? 'gold', fadeIn);
    if (q.spec.label) {
      this.ctx.globalAlpha = fadeIn;
      this.text(q.spec.label, cx, cy - QR0 - 12, BONE, 16);
      this.ctx.globalAlpha = 1;
    }
    const hit = this.input.hit(q.spec.action) || q.tapped;
    q.tapped = false;
    if (hit) {
      const err = Math.abs(r - QRT);
      this.endQuick(err < 2.6 ? 'perfect' : err < 6.5 ? 'good' : 'fail');
    } else if (q.t > dur) this.endQuick('skip');
  }

  // ------------------------------------------------------------------ placing
  /** the prompt's centre (QTE px): over the threat when the spec has `at`, else lower-centre */
  private place(a: Active, W: number, H: number, rdt: number): [number, number] {
    const at = a.spec.at;
    let tx = W / 2, ty = H * 0.62;
    if (at) {
      const w = typeof at === 'function' ? at() : at;
      const proj = this.project ?? (window as any).__engine?.current?.hud?.project;
      const p = w && proj ? proj(w) : null;
      if (p && p.visible && !p.behind) {
        const k = a.spec.kind;
        const hw = k === 'balance' ? 80 : k === 'bar' ? 66 : k === 'sequence' ? (a.spec as { keys: string[] }).keys.length * 10 + 6 : R0 + 4;
        tx = Math.max(hw + 4, Math.min(W - hw - 4, p.x / this.scale));
        ty = Math.max(R0 + 30, Math.min(H - R0 - 10, p.y / this.scale - 18));
      }
    }
    // glide (a moving threat drags the prompt smoothly; the first frame snaps)
    if (!this.anchored) {
      this.ax = tx;
      this.ay = ty;
      this.anchored = true;
    } else if (!a.done) {
      const f = Math.min(1, rdt * 14);
      this.ax += (tx - this.ax) * f;
      this.ay += (ty - this.ay) * f;
    }
    const cx = Math.round(this.ax), cy = Math.round(this.ay);
    this.anchor = at ? { x: cx * this.scale, y: cy * this.scale, bottom: (cy + 30) * this.scale } : null;
    return [cx, cy];
  }

  // ------------------------------------------------------------------ the drawing kit
  /** the closing ring's radius at progress k: meets the sight ring at RING_PERFECT, keeps shrinking after */
  private ringR(k: number, r0: number, rt: number) {
    return Math.max(2, r0 + (rt - r0) * (k / Qte.RING_PERFECT));
  }

  /** a cached pixel ring: `w` px of colour with a 1 px ink line inside and out; `notch` cuts four sight gaps */
  private ringSprite(r: number, w: number, col: string, notch: boolean) {
    const R = Math.round(r);
    const key = `r${R}|${w}|${col}|${notch ? 1 : 0}`;
    let cv = this.sprites.get(key);
    if (cv) return cv;
    const S = R + w + 3;
    cv = document.createElement('canvas');
    cv.width = cv.height = S * 2 + 1;
    const c = cv.getContext('2d')!;
    const hw = w / 2;
    for (let y = -S; y <= S; y++)
      for (let x = -S; x <= S; x++) {
        const d = Math.hypot(x, y) - R;
        if (Math.abs(d) > hw + 1.01) continue;
        if (notch) {
          const ang = Math.atan2(y, x);
          const u = (((ang - Math.PI / 4) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
          if (Math.min(u, Math.PI / 2 - u) < 0.13) continue; // four gaps on the diagonals: a gunsight
        }
        c.fillStyle = Math.abs(d) <= hw ? (d < -hw + 1 && w > 1 ? col : d > hw - 1 && w > 2 ? shadeOf(col) : col) : INK;
        c.fillRect(x + S, y + S, 1, 1);
      }
    if (notch)
      // short ink-edged ticks pointing in at north, east, south, west
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]])
        for (let i = 0; i < 4; i++) {
          const px = S + dx * (R - hw - 1 - i), py = S + dy * (R - hw - 1 - i);
          c.fillStyle = INK;
          c.fillRect(px - (dy ? 1 : 0), py - (dx ? 1 : 0), dy ? 3 : 1, dx ? 3 : 1);
          c.fillStyle = col;
          c.fillRect(px, py, 1, 1);
        }
    this.sprites.set(key, cv);
    if (this.sprites.size > 360) this.sprites.delete(this.sprites.keys().next().value!);
    return cv;
  }

  private blitCentered(cv: HTMLCanvasElement, x: number, y: number) {
    this.ctx.drawImage(cv, Math.round(x - (cv.width - 1) / 2), Math.round(y - (cv.height - 1) / 2));
  }

  /** the timing ring: notched sight ring + the closing ring with a short afterimage trail */
  private drawRing(cx: number, cy: number, k: number, r: number, rt: number, r0: number, tone: 'gold' | 'jade', alpha: number) {
    const c = this.ctx;
    c.globalAlpha = alpha;
    const near = 1 - Math.min(1, Math.abs(r - rt) / (r0 - rt));
    const hot = tone === 'jade' ? JADE_H : GOLD_H;
    const mid = tone === 'jade' ? JADE : GOLD;
    // the sight breathes a little and glows as the ring arrives
    this.blitCentered(this.ringSprite(rt, 2, near > 0.82 ? hot : BONE, true), cx, cy);
    if (near > 0.6) {
      c.globalAlpha = alpha * (near - 0.6) * 1.6;
      this.blitCentered(this.ringSprite(rt + 3, 1, mid, false), cx, cy);
      c.globalAlpha = alpha;
    }
    // afterimages
    for (let i = 2; i >= 1; i--) {
      const rr = r + i * 2.5 * (1 - Math.min(1, k));
      if (rr <= 2) continue;
      c.globalAlpha = alpha * (0.18 / i);
      this.blitCentered(this.ringSprite(rr, 1, mid, false), cx, cy);
    }
    c.globalAlpha = alpha;
    const col = k < 0.45 ? BONE_D : k < Qte.RING_PERFECT - 0.1 ? mid : hot;
    this.blitCentered(this.ringSprite(r, 2, col, false), cx, cy);
    c.globalAlpha = 1;
  }

  /** a gauge track with a gold zone, the bright perfect notch and a sweeping needle */
  private track(cx: number, cy: number, w: number, zone: number, perfect: number, x: number, inside: boolean) {
    const c = this.ctx;
    const x0 = Math.round(cx - w / 2), y0 = cy - 5;
    // frame: ink, dark leather well, a lit top lip
    c.fillStyle = INK;
    c.fillRect(x0 - 2, y0 - 2, w + 4, 14);
    c.fillStyle = '#3e2414';
    c.fillRect(x0 - 1, y0 - 1, w + 2, 12);
    c.fillStyle = '#5e3820';
    c.fillRect(x0 - 1, y0 - 1, w + 2, 1);
    // tick marks every tenth
    c.fillStyle = '#80502c';
    for (let i = 1; i < 10; i++) c.fillRect(x0 + Math.round((w * i) / 10), y0 + 7, 1, 3);
    // the gold zone and its bright heart
    const gz0 = Math.round(x0 + (0.5 - zone) * w), gz1 = Math.round(x0 + (0.5 + zone) * w);
    c.fillStyle = GOLD_D;
    c.fillRect(gz0, y0, gz1 - gz0, 10);
    c.fillStyle = GOLD;
    c.fillRect(gz0, y0 + 1, gz1 - gz0, 7);
    const pz0 = Math.round(x0 + (0.5 - perfect) * w), pz1 = Math.max(pz0 + 2, Math.round(x0 + (0.5 + perfect) * w));
    c.fillStyle = GOLD_H;
    c.fillRect(pz0, y0, pz1 - pz0, 10);
    c.fillStyle = INK;
    c.fillRect(gz0 - 1, y0, 1, 10);
    c.fillRect(gz1, y0, 1, 10);
    // the needle: ink-edged bone blade with an arrow head over the track
    const nx = Math.round(x0 + x * w);
    c.fillStyle = INK;
    c.fillRect(nx - 2, y0 - 6, 5, 18);
    c.fillRect(nx - 4, y0 - 8, 9, 4);
    c.fillStyle = inside ? '#ffffff' : BONE;
    c.fillRect(nx - 1, y0 - 5, 3, 16);
    c.fillRect(nx - 3, y0 - 7, 7, 2);
    c.fillStyle = inside ? GOLD_H : BONE_D;
    c.fillRect(nx + 1, y0 - 5, 1, 16);
  }

  /** a thin ink-framed fill bar (timers, mash) */
  private gauge(x: number, y: number, w: number, h: number, f: number, col: string, timer = -1) {
    const c = this.ctx;
    x = Math.round(x);
    w = Math.round(w);
    c.fillStyle = INK;
    c.fillRect(x - 1, y - 1, w + 2, h + 2);
    c.fillStyle = '#3e2414';
    c.fillRect(x, y, w, h);
    const fw = Math.round(w * Math.max(0, Math.min(1, f)));
    c.fillStyle = col;
    c.fillRect(x, y, fw, h);
    if (h > 3) {
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(x, y, fw, 1);
    }
    if (timer >= 0) {
      c.fillStyle = BONE_D;
      c.fillRect(x, y + h + 2, Math.round(w * Math.max(0, Math.min(1, timer))), 1);
    }
  }

  private keycap(t: string, x: number, y: number, s = 1, mode: 'live' | 'idle' | 'done' = 'live') {
    if (this.touch) {
      // the touch layer's Alagard line says what to do; keys mean nothing on glass
      const w = TOUCH_WORD[t];
      if (!w) return;
      t = w;
    }
    const key = `k|${t}|${s.toFixed(2)}|${mode}`;
    let cv = this.sprites.get(key);
    if (!cv) {
      const w = Math.round((t.length > 1 ? 9 + t.length * 6 : 15) * s), h = Math.round(15 * s);
      cv = document.createElement('canvas');
      cv.width = w + 2;
      cv.height = h + 4;
      const c = cv.getContext('2d')!;
      const face = mode === 'done' ? '#3e8f78' : mode === 'idle' ? '#bfae88' : '#efe0bc';
      const lip = mode === 'done' ? '#22594a' : mode === 'idle' ? '#8a7656' : '#a8875a';
      // ink outline with rounded corners, a face, a lit top edge and a deep bottom lip
      c.fillStyle = INK;
      c.fillRect(1, 0, w, h + 4);
      c.fillRect(0, 1, w + 2, h + 2);
      c.fillStyle = lip;
      c.fillRect(1, 1, w, h + 2);
      c.fillStyle = face;
      c.fillRect(1, 1, w, h - 1);
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.fillRect(2, 1, w - 2, 1);
      c.font = `16px 'Alagard'`;
      c.textAlign = 'center';
      c.textBaseline = 'top';
      c.fillStyle = mode === 'done' ? JADE_H : INK;
      const tw = c.measureText(t).width;
      const sc = Math.min(1, (w - 4) / Math.max(1, tw));
      c.save();
      c.translate(Math.round((w + 2) / 2), Math.round(h / 2 - 7 * sc));
      c.scale(sc, sc);
      c.fillText(t, 0, 0);
      c.restore();
      this.sprites.set(key, cv);
    }
    this.ctx.drawImage(cv, Math.round(x - cv.width / 2), Math.round(y - cv.height / 2));
  }

  /** Alagard with a full 1 px ink outline */
  private text(t: string, x: number, y: number, col: string, size = 16) {
    const key = `t|${t}|${col}|${size}`;
    let cv = this.sprites.get(key);
    if (!cv) {
      const m = document.createElement('canvas').getContext('2d')!;
      m.font = `${size}px 'Alagard'`;
      const w = Math.ceil(m.measureText(t).width) + 4;
      cv = document.createElement('canvas');
      cv.width = w;
      cv.height = size + 6;
      const c = cv.getContext('2d')!;
      c.font = `${size}px 'Alagard'`;
      c.textAlign = 'left';
      c.textBaseline = 'top';
      c.fillStyle = INK;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [1, 2], [0, 2]]) c.fillText(t, 2 + dx, 2 + dy);
      c.fillStyle = col;
      c.fillText(t, 2, 2);
      // only cache once the face has loaded (a fallback face would stick otherwise)
      if (document.fonts?.check?.(`${size}px 'Alagard'`) !== false) this.sprites.set(key, cv);
    }
    this.ctx.drawImage(cv, Math.round(x - cv.width / 2), Math.round(y));
  }

  /** the result word slams down: double size for a beat, then settles; fades out at the end */
  private stamp(word: string, x: number, y: number, r: QteResult, t: number, size: number) {
    const [face] = RES_COL[r];
    const c = this.ctx;
    const k = t < 0.07 ? 2 : t < 0.12 ? 1.5 : 1;
    const a = t > 0.42 ? Math.max(0, 1 - (t - 0.42) / 0.2) : 1;
    const px = size >= 1 ? 32 : 16;
    const key = `t|${word}|${face}|${px}`;
    this.text(word, -9999, -9999, face, px); // warm the cache
    const cv = this.sprites.get(key);
    if (!cv) {
      this.text(word, x, y - px / 2, face, px);
      return;
    }
    c.globalAlpha = a;
    const w = cv.width * k, h = cv.height * k;
    c.drawImage(cv, Math.round(x - w / 2), Math.round(y - h / 2 + (r === 'fail' ? Math.sin(t * 60) * (1 - Math.min(1, t * 4)) * 2 : 0)), Math.round(w), Math.round(h));
    c.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ pixel sparks
  private burst(x: number, y: number, r: QteResult, k: number) {
    const [hi, mid] = RES_COL[r];
    const n = Math.round((r === 'perfect' ? 34 : r === 'good' ? 18 : 10) * k);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const sp = (r === 'perfect' ? 90 : 60) * (0.5 + Math.random() * 0.8) * (0.6 + 0.4 * k);
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, life: 0, max: 0.35 + Math.random() * 0.35, col: Math.random() < 0.4 ? hi : mid, s: Math.random() < 0.3 ? 2 : 1 });
    }
    if (r !== 'fail') this.flashes.push({ x, y, t: 0, col: hi, r: (r === 'perfect' ? RT + 4 : RT) * (k < 1 ? 0.7 : 1) });
  }
  private sparkle(x: number, y: number, col: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 20 + Math.random() * 40;
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 25, life: 0, max: 0.25 + Math.random() * 0.2, col, s: 1 });
    }
  }
  private drawSparks(rdt: number) {
    const c = this.ctx;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += rdt;
      const k = f.t / 0.3;
      if (k >= 1) {
        this.flashes.splice(i, 1);
        continue;
      }
      c.globalAlpha = 1 - k;
      this.blitCentered(this.ringSprite(f.r + k * 26, k < 0.4 ? 2 : 1, f.col, false), f.x, f.y);
    }
    c.globalAlpha = 1;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.life += rdt;
      if (p.life >= p.max) {
        this.sparks.splice(i, 1);
        continue;
      }
      p.vx *= Math.exp(-3 * rdt);
      p.vy = p.vy * Math.exp(-3 * rdt) + 160 * rdt;
      p.x += p.vx * rdt;
      p.y += p.vy * rdt;
      const fade = p.life / p.max;
      c.fillStyle = fade > 0.7 ? INK : p.col;
      c.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
  }

  dispose() {
    this.active?.resolve('fail');
    this.active = null;
    if (this.quickActive && !this.quickActive.done) this.quickActive.resolve('skip');
    this.quickActive = null;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('touchstart', this.onTouch);
    this.canvas.remove();
    if (Qte.current === this) Qte.current = null;
  }
}

/** one step darker for the outer edge of a ring band */
function shadeOf(col: string) {
  if (col === GOLD_H) return GOLD;
  if (col === GOLD) return GOLD_D;
  if (col === JADE_H) return JADE;
  if (col === BONE) return BONE_D;
  return col;
}
