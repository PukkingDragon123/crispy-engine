// Skill-based QTEs drawn as crisp pixel art on their own overlay canvas.
// All QTEs run on real time (unaffected by slow motion) and resolve to
// 'perfect' | 'good' | 'fail'.
// A spec may carry `at` (a world point, or a getter for a moving threat): the
// prompt then floats over that threat on screen (clamped inside the screen)
// instead of sitting at the centre; `anchor` reports where it is drawn so the
// touch layer can put its Alagard line under it.
import type { Input } from '../../engine/Input';
import type { AudioEngine } from '../../engine/audio/AudioEngine';

export type QteResult = 'perfect' | 'good' | 'fail';
type P3 = { x: number; y: number; z: number };
/** where the threat is: a world point or a getter (null = fall back to the centre) */
export type QteAt = P3 | (() => P3 | null | undefined);
export type QteSpec = (
  | { kind: 'ring'; key?: string; label?: string; duration?: number }
  | { kind: 'mash'; key?: string; label?: string; duration?: number; target?: number }
  | { kind: 'sequence'; keys: string[]; label?: string; duration?: number }
  | { kind: 'balance'; label?: string; duration?: number; drift?: number }
  | { kind: 'bar'; key?: string; label?: string; speed?: number; width?: number }
) & { at?: QteAt };

interface Active {
  spec: QteSpec;
  t: number;
  resolve: (r: QteResult) => void;
  state: any;
  done?: { r: QteResult; t: number };
}

const KEYNAME: Record<string, string> = { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', Space: 'SPACE', KeyZ: 'Z', KeyF: 'F', KeyE: 'E', Mouse0: 'LMB', KeyQ: 'Q', KeyR: 'R' };

export class Qte {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  active: Active | null = null;
  private scale = 2;
  /** world -> screen (css px); defaults to the run HUD's projector */
  project: ((p: P3) => { x: number; y: number; visible: boolean; behind?: boolean }) | null = null;
  /** where the live prompt is drawn when it follows a threat (css px: centre and the bottom of the prompt) */
  anchor: { x: number; y: number; bottom: number } | null = null;
  private ax = 0;
  private ay = 0;
  private anchored = false;

  constructor(parent: HTMLElement, private input: Input, private audio: AudioEngine) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;image-rendering:pixelated';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    this.scale = window.innerWidth > 1700 ? 3 : 2;
    this.canvas.width = Math.ceil(window.innerWidth / this.scale);
    this.canvas.height = Math.ceil(window.innerHeight / this.scale);
    this.ctx.imageSmoothingEnabled = false;
  }

  run(spec: QteSpec): Promise<QteResult> {
    this.active?.resolve('fail');
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

  private pressed(code: string) {
    return this.input.wasPressed(code);
  }

  private finish(r: QteResult) {
    const a = this.active!;
    if (a.done) return;
    a.done = { r, t: 0 };
    this.audio.play(r === 'perfect' ? 'qte_perfect' : r === 'good' ? 'qte_good' : 'qte_fail', { volume: 0.7 });
    a.resolve(r);
  }

  update(rdt: number) {
    const c = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    const a = this.active;
    if (!a) {
      this.anchor = null;
      return;
    }
    a.t += rdt;
    const [cx, cy] = this.place(a, W, H, rdt);
    if (a.done) {
      a.done.t += rdt;
      const col = a.done.r === 'perfect' ? '#ffd36b' : a.done.r === 'good' ? '#c8ff5a' : '#ff6a4a';
      const k = 1 + Math.max(0, 0.2 - a.done.t) * 3;
      this.label(a.done.r.toUpperCase() + '!', cx, cy - 6, col, Math.round(14 * k), 'Alagard');
      if (a.done.t > 0.55) this.active = null;
      return;
    }
    const s = a.spec;
    const lab = s.label;
    if (lab) this.label(lab, cx, cy - 44, '#fff3d6', 9);
    switch (s.kind) {
      case 'ring': {
        const dur = s.duration ?? 1.15;
        const key = s.key ?? 'KeyZ';
        const k = a.t / dur;
        const R0 = 46, Rt = 14;
        const r = R0 + (Rt * 0.45 - R0) * k;
        this.circle(cx, cy, Rt, '#fff3d6', 2);
        this.circle(cx, cy, Rt + 3, 'rgba(255,211,107,0.5)', 1);
        this.circle(cx, cy, Math.max(1, r), k > 0.6 ? '#ffd36b' : '#c9a97c', 2);
        this.keycap(KEYNAME[key] ?? key, cx, cy);
        const err = Math.abs(r - Rt);
        if (this.pressed(key) || (key === 'KeyZ' && this.pressed('Mouse0'))) this.finish(err < 3.2 ? 'perfect' : err < 8 ? 'good' : 'fail');
        else if (a.t > dur) this.finish('fail');
        break;
      }
      case 'mash': {
        const dur = s.duration ?? 2.2;
        const key = s.key ?? 'Space';
        const target = s.target ?? 14;
        if (this.pressed(key)) {
          a.state.fill += 1;
          this.audio.play('ui_click', { volume: 0.25, pitch: 1 + a.state.fill * 0.03 });
        }
        a.state.fill = Math.max(0, a.state.fill - rdt * 2.2);
        const f = Math.min(1, a.state.fill / target);
        this.bar(cx - 50, cy + 14, 100, f, f > 0.99 ? '#ffd36b' : '#c8ff5a');
        this.keycap(KEYNAME[key] ?? key, cx, cy - 4, Math.sin(a.t * 30) > 0 ? 1 : 0.85);
        this.label('MASH!', cx, cy + 22, '#fff3d6', 8);
        if (f >= 1) this.finish(a.t < dur * 0.6 ? 'perfect' : 'good');
        else if (a.t > dur) this.finish(f > 0.7 ? 'good' : 'fail');
        break;
      }
      case 'sequence': {
        const dur = s.duration ?? 2.6;
        const keys = s.keys;
        const w = keys.length * 18;
        keys.forEach((k, i) => this.keycap(KEYNAME[k] ?? k, cx - w / 2 + i * 18 + 9, cy, i < a.state.i ? 0.4 : i === a.state.i ? 1.15 : 0.85, i < a.state.i ? '#7ff03a' : undefined));
        this.bar(cx - w / 2, cy + 14, w, 1 - a.t / dur, '#c9a97c');
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyF', 'KeyE', 'KeyQ']) {
          if (!this.pressed(code)) continue;
          if (code === keys[a.state.i]) {
            a.state.i++;
            this.audio.play('ui_click', { volume: 0.4, pitch: 1 + a.state.i * 0.08 });
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
        c.fillStyle = 'rgba(30,20,14,0.75)';
        c.fillRect(cx - w / 2 - 2, cy - 6, w + 4, 12);
        c.fillStyle = 'rgba(255,211,107,0.35)';
        c.fillRect(cx - w * 0.11, cy - 5, w * 0.22, 10);
        c.fillStyle = Math.abs(st.x) < 0.22 ? '#ffd36b' : '#ff6a4a';
        c.fillRect(Math.round(cx + st.x * (w / 2)) - 1, cy - 8, 3, 16);
        this.keycap('A', cx - w / 2 - 14, cy);
        this.keycap('D', cx + w / 2 + 14, cy);
        this.bar(cx - w / 2, cy + 12, w, 1 - a.t / dur, '#c9a97c');
        if (Math.abs(st.x) >= 0.999) this.finish('fail');
        else if (a.t > dur) this.finish(st.inside / dur > 0.8 ? 'perfect' : st.inside / dur > 0.5 ? 'good' : 'fail');
        break;
      }
      case 'bar': {
        const sp = s.speed ?? 1.4;
        const width = s.width ?? 0.14;
        const key = s.key ?? 'Mouse0';
        const x = (Math.sin(a.t * sp * Math.PI) + 1) / 2;
        const w = 120;
        const sweet = 0.5;
        c.fillStyle = 'rgba(30,20,14,0.75)';
        c.fillRect(cx - w / 2 - 2, cy - 6, w + 4, 12);
        c.fillStyle = '#c9a97c';
        c.fillRect(Math.round(cx - w / 2 + (sweet - width) * w), cy - 5, Math.round(width * 2 * w), 10);
        c.fillStyle = '#ffd36b';
        c.fillRect(Math.round(cx - w / 2 + (sweet - width * 0.35) * w), cy - 5, Math.round(width * 0.7 * w), 10);
        c.fillStyle = '#ffffff';
        c.fillRect(Math.round(cx - w / 2 + x * w) - 1, cy - 8, 3, 16);
        this.keycap(KEYNAME[key] ?? key, cx, cy + 18);
        if (this.pressed(key) || (key === 'Mouse0' && this.pressed('Space'))) {
          const e = Math.abs(x - sweet);
          this.finish(e < width * 0.35 ? 'perfect' : e < width ? 'good' : 'fail');
        }
        break;
      }
    }
  }

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
        const hw = k === 'balance' ? 74 : k === 'bar' ? 64 : k === 'sequence' ? (a.spec as { keys: string[] }).keys.length * 9 + 6 : 52;
        tx = Math.max(hw + 4, Math.min(W - hw - 4, p.x / this.scale));
        ty = Math.max(66, Math.min(H - 46, p.y / this.scale - 18));
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

  private circle(x: number, y: number, r: number, col: string, w = 1) {
    const c = this.ctx;
    const n = Math.max(16, Math.round(r * 5));
    c.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      c.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), w, w);
    }
  }
  private bar(x: number, y: number, w: number, f: number, col: string) {
    const c = this.ctx;
    c.fillStyle = '#2a1810';
    c.fillRect(Math.round(x) - 1, y - 1, Math.round(w) + 2, 5);
    c.fillStyle = col;
    c.fillRect(Math.round(x), y, Math.round(w * Math.max(0, Math.min(1, f))), 3);
  }
  private keycap(t: string, x: number, y: number, s = 1, col = '#fff3d6') {
    const c = this.ctx;
    const w = Math.round((t.length > 1 ? 8 + t.length * 5 : 13) * s), h = Math.round(13 * s);
    c.fillStyle = '#2a1810';
    c.fillRect(Math.round(x - w / 2) - 1, Math.round(y - h / 2) - 1, w + 2, h + 3);
    c.fillStyle = '#e8d2a8';
    c.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
    c.fillStyle = '#b89a6a';
    c.fillRect(Math.round(x - w / 2), Math.round(y + h / 2) - 2, w, 2);
    this.label(t, x, y - 4, '#2a1810', 8, 'Alagard', 'transparent');
    void col;
  }
  private label(t: string, x: number, y: number, col: string, size = 16, font = 'Alagard', shadow = '#2a1810') {
    const c = this.ctx;
    c.font = `${Math.max(16, Math.round(size / 8) * 8)}px '${font}'`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    if (shadow !== 'transparent') {
      c.fillStyle = shadow;
      c.fillText(t, Math.round(x) + 1, Math.round(y) + 1);
    }
    c.fillStyle = col;
    c.fillText(t, Math.round(x), Math.round(y));
  }

  dispose() {
    this.canvas.remove();
  }
}
