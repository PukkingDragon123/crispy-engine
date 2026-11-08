// Outlaw HUD furniture — the sheriff's-office readouts as stylized pixel-art objects
// (authored sprites, HudArt.ts), with Alagard type on top:
//  • TIN STAR: a pressed-tin six-point star with ball tips and a raised boss carrying
//    the rank; spins (a 2D turn) and rings on rank-up
//  • TALLY PLANK: two weathered, nailed planks (grain, a knot, a crack, a bent nail)
//    with the bounty painted on; it jolts and the figure counts up as money comes in
//  • WAVE PLAQUE: a stitched leather plaque with brass tacks hanging on two chains
//    from the top of the screen (laid link by link, leaning as it swings), the wave
//    burnt into it; a riveted brass tag under it carries the wave clock
//  • POCKET STOPWATCH: during the 30 s break a brass hunter-case watch drops in on
//    its chain under the plaque, lid sprung open beside it: a jade wedge on the
//    enamel is the time left, the blued hand points at the seconds, big numerals
//    underneath; brass fills round the rim while the bell is rung, and the last five
//    seconds tick red and shake it.
import * as THREE from 'three';
import { PixelFx, clamp01, TAU, uiSfx } from './HudKit';
import { blitObj, blitSquashObj, glint, pixelText, pixelTextWidth } from './HudSprites';
import { UI, px, sprite, HUD_PAL, type PixelSprite } from './PixelUI';
import { HUD_ART as ART } from './HudArt';

const WR = 19; // the old case radius (HUD px): the touch layer's watch offset is built on it
/** the stopwatch was shown a little larger than modelled */
export const WATCH_S = 1.1;
/** HUD px from the plaque's bottom edge to the watch centre (chain + bow), at k = 1 */
export const WATCH_DROP = (4 * 4.3 + WR + 9.6) * WATCH_S;
const PLQ_H = 30;
/** the plaque's chain rings (HUD px from its centre) */
const RING_X = 46, RING_Y = 16.8;

export interface OutlawAnchors {
  /** size factor (small screens) */
  k: number;
  star: { x: number; y: number; rank: number };
  tally: { x: number; y: number; amount: number };
  /** null while the boss banner owns the top centre */
  plaque: { x: number; y: number; label: string; time: string | null; drop: number } | null;
  /** the break between waves */
  watch: { left: number; total: number; bell: number } | null;
}

interface Swing {
  a: number;
  v: number;
}
/** a damped spring, sub-stepped so a long frame can never blow it up */
const swing = (s: Swing, dt: number, k = 40, c = 2.2) => {
  const n = Math.min(12, Math.ceil(dt / (1 / 120)));
  const h = Math.min(dt, 0.1) / Math.max(1, n);
  for (let i = 0; i < n; i++) {
    s.v += (-s.a * k - s.v * c) * h;
    s.a += s.v * h;
  }
  s.a = Math.max(-3, Math.min(3, s.a));
};

const rgb = (ch: string) => {
  const n = parseInt(HUD_PAL[ch].slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export class OutlawHud {
  // star
  private starSpin = 0;
  private lastRank = -1;
  // tally
  private shown = -1;
  private boardKick: Swing = { a: 0, v: 0 };
  private chalkAcc = 0;
  // plaque
  private sw: Swing = { a: 0, v: 0 };
  private lastLabel = '';
  private dropY = 0;
  private tagShow = 0;
  // watch
  private watchShow = 0;
  private watchSw: Swing = { a: 0, v: 0 };
  private lastSec = -1;
  private watchCv = document.createElement('canvas');
  private dust = new PixelFx(240, false, 8);
  private glow = new PixelFx(160, true, 8);
  private t = 0;

  constructor(private scene: THREE.Scene) {
    scene.add(this.dust.points, this.glow.points);
  }

  fx(dt: number, s: number, visible: boolean) {
    this.dust.points.visible = this.glow.points.visible = visible;
    this.dust.update(dt, s);
    this.glow.update(dt, s);
  }

  private pick(full: PixelSprite, small: PixelSprite, k: number) {
    return sprite(k < 0.85 ? small : full);
  }

  /** a chain of authored links from (x0, y0) down to (x1, y1), HUD px */
  private chain(c: CanvasRenderingContext2D, k: number, x0: number, y0: number, x1: number, y1: number) {
    const fa = sprite(ART.link_f), ed = sprite(ART.link_e);
    const L = Math.hypot(x1 - x0, y1 - y0);
    const step = Math.max(3, 4.3 * k);
    const n = Math.max(1, Math.round(L / step));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      blitObj(c, i % 2 ? ed : fa, x1 + (x0 - x1) * f, y1 + (y0 - y1) * f, 2);
    }
  }

  /** the stopwatch this frame: the case, the time-left wedge on the enamel, the blued hand */
  private watchFace(small: boolean, frac: number, red: number) {
    const body = small ? ART.watch_s : ART.watch;
    const dial = small ? ART.watch_dial_s : ART.watch_dial;
    const cv = this.watchCv;
    if (cv.width !== body.w || cv.height !== body.h) {
      cv.width = body.w;
      cv.height = body.h;
    }
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(sprite(body), 0, 0);
    const img = g.getImageData(0, 0, cv.width, cv.height);
    const d = img.data;
    const cx = (body.w - 1) / 2, cy = cx + 10;
    const elapsed = (1 - frac) * TAU;
    const wedge = rgb(red > 0.5 ? 'E' : 'I'), wedgeD = rgb(red > 0.5 ? 'D' : 'H');
    let rMax = 0;
    for (let y = 0; y < dial.h; y++)
      for (let x = 0; x < dial.w; x++) {
        if (dial.rows[y][x] !== 'u') continue;
        const dx = x - cx, dy = y - cy;
        rMax = Math.max(rMax, Math.hypot(dx, dy));
        const a = (Math.atan2(dy, dx) + Math.PI / 2 + TAU) % TAU;
        if (frac > 0.001 && a >= elapsed) {
          const v = (x + y) % 2 === 0 ? wedge : wedgeD;
          const o = (y * cv.width + x) * 4;
          d[o] = v[0];
          d[o + 1] = v[1];
          d[o + 2] = v[2];
        }
      }
    g.putImageData(img, 0, 0);
    // the blued hand on its cannon pinion
    const hand = HUD_PAL.U;
    for (let r = 0; r <= rMax; r += 0.5) {
      const x = Math.round(cx + Math.sin(elapsed) * r), y = Math.round(cy - Math.cos(elapsed) * r);
      px(g, x, y, 1, 1, r > rMax - 1.5 ? HUD_PAL.T : hand);
    }
    px(g, Math.round(cx), Math.round(cy), 1, 1, HUD_PAL.i);
    return { cv, cx, cy };
  }

  paint(c: CanvasRenderingContext2D, dt: number, A: OutlawAnchors, s: number) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const k = A.k;
    const small = k < 0.85;
    // ---------------------------------------------------- tin star
    {
      const st = A.star;
      if (this.lastRank >= 0 && st.rank !== this.lastRank) {
        this.starSpin = 1;
        uiSfx('counter_clang', 0.35, 1.5);
        for (let i = 0; i < 26; i++) {
          const ang = Math.random() * TAU, v = 40 + Math.random() * 70;
          this.glow.emit({ x: st.x, y: st.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, drag: 3, life: 0.4 + Math.random() * 0.5, size: Math.random() < 0.3 ? 2 : 1, c0: 0xffffff, c1: 0xffd36b, alpha: 1, flick: 0.4 });
        }
      }
      this.lastRank = st.rank;
      this.starSpin = Math.max(0, this.starSpin - dt * 1.4);
      const sp = this.pick(ART.star, ART.star_s, k);
      {
        // a rank-up spins it twice and bounces it; otherwise it breathes on its pin
        const u = 1 - this.starSpin;
        const spin = this.starSpin > 0 ? (1 - Math.pow(u, 3)) * TAU * 2 : 0;
        const bounce = Math.round(Math.sin(this.starSpin * Math.PI) * 4);
        const sx = this.starSpin > 0 ? Math.cos(spin) : 1;
        const y = st.y - bounce + Math.round(Math.sin(this.t * 0.9) * 0.6);
        // pinned to the coat: a hard little shadow; light catches the tin points
        blitSquashObj(c, sp, st.x, y, Math.abs(sx) < 0.12 ? 0.12 * Math.sign(sx || 1) : sx, 1, 1, 2 + bounce);
        glint(sp, st.x, y, this.starSpin > 0 ? 8 : 0.45, dt);
        if (Math.abs(sx) > 0.7) pixelText(c, String(st.rank), st.x, y - (small ? 5 : 8), { size: small ? Math.round(16 * k * 1.1) : 16, color: '#1a0e06', align: 'center', lip: '#fff6dc' });
      }
    }

    // ---------------------------------------------------- tally board
    {
      const tb = A.tally;
      if (this.shown < 0) this.shown = tb.amount;
      const before = Math.round(this.shown);
      this.shown += (tb.amount - this.shown) * Math.min(1, dt * 6);
      if (Math.abs(tb.amount - this.shown) < 0.5) this.shown = tb.amount;
      const now = Math.round(this.shown);
      if (now > before) {
        this.boardKick.v += Math.min(1.2, 0.15 + (now - before) * 0.02);
        this.chalkAcc += dt * 30;
      }
      swing(this.boardKick, dt, 260, 9);
      while (this.chalkAcc > 1) {
        this.chalkAcc -= 1;
        this.dust.emit({ x: tb.x + (Math.random() - 0.3) * 50 * k, y: tb.y + 4 * k, vx: (Math.random() - 0.5) * 20, vy: -10 - Math.random() * 20, ay: 60, drag: 1.5, life: 0.4 + Math.random() * 0.4, size: 1, c0: 0xfff3d6, c1: 0xc9a97c, alpha: 0.8 });
      }
      const sp = this.pick(ART.plank, ART.plank_s, k);
      {
        const jx = Math.round(this.boardKick.a * 2), jy = Math.round(-Math.abs(this.boardKick.a) * 2);
        const x = tb.x + jx, y = tb.y + jy;
        // nailed planks a hair off the screen; they rock on their nails when money comes in
        blitObj(c, sp, x, y, 2 + Math.abs(jy));
        const amt = '$' + now.toLocaleString('en-US');
        const fs = small ? Math.max(10, Math.round(16 * k * 1.15)) : 16;
        // painted on the planks, in the HUD's own outlined type
        pixelText(c, 'BOUNTY', x - 1, y - 14 * k + (small ? 0 : 1), { size: fs, color: '#e2c48c', align: 'center', outline: '#1a0e06' });
        pixelText(c, amt, x + 1, y + (small ? 0 : 0.5) * k, { size: fs, color: '#fff2cc', align: 'center', outline: '#1a0e06' });
      }
    }

    // ---------------------------------------------------- plaque on its chains
    const pq = A.plaque;
    let watchTop = 0;
    if (pq) {
      if (pq.label !== this.lastLabel) {
        if (this.lastLabel) {
          this.sw.v += 1.4;
          this.dropY = -34;
          uiSfx('counter_clang', 0.25, 0.7);
        }
        this.lastLabel = pq.label;
      }
      this.dropY += (0 - this.dropY) * Math.min(1, dt * 7);
      swing(this.sw, dt, 18, 1.4);
      const lean = this.sw.a * 0.08 + Math.sin(this.t * 0.8) * 0.012;
      const py = pq.y - pq.drop + this.dropY;
      // it hangs from the top of the screen: swaying, the chains lean with it
      const sway = Math.round(Math.sin(lean) * 30 * k);
      const X = pq.x + sway;
      for (const sd of [-1, 1]) this.chain(c, k, pq.x + sd * RING_X * k, -5, X + sd * RING_X * k, py - RING_Y * k - 2 * k);
      const pl = k < 0.85 ? ART.plaque_s : ART.plaque;
      const sp = sprite(pl);
      {
        // the plate's centre sits at py (its D-rings stand 8 px above the plate)
        blitObj(c, sp, X, py - (8 + (pl.h - 8) / 2) + sp.height / 2, 4);
        const roomy = pixelTextWidth(pq.label, 32) <= pl.w - 26;
        const fs = roomy ? 32 : small ? Math.max(10, Math.round(16 * k * 1.15)) : 16;
        // burnt into the leather: dark seared type with a singed pale lip
        pixelText(c, pq.label, X, py - (roomy ? 15 : fs * 0.55), { size: fs, color: '#2a0e04', align: 'center', lip: '#c88a5a' });
      }
      // the clock tag (the wave timer) hangs under it while no break runs
      const wantTag = !!pq.time && !A.watch;
      this.tagShow += ((wantTag ? 1 : 0) - this.tagShow) * Math.min(1, dt * 8);
      if (this.tagShow > 0.05 && pq.time) {
        const tg = this.pick(ART.tag, ART.tag_s, k);
        {
          const ty = py + ((k < 0.85 ? ART.plaque_s.h - 8 : ART.plaque.h - 8) / 2) + tg.height / 2 - 4 - Math.round((1 - this.tagShow) * 10 * k);
          const tx = X + Math.round(Math.sin(this.t * 1.3) * 0.6);
          blitObj(c, tg, tx, ty, 4, Math.min(1, this.tagShow * 1.5));
          glint(tg, tx, ty, 0.3, dt);
          if (this.tagShow > 0.6) pixelText(c, pq.time, X, ty - (small ? 3 : 6), { size: small ? Math.max(10, Math.round(16 * k * 1.15)) : 16, color: '#3a2208', align: 'center', lip: '#fff0be' });
        }
      }
      watchTop = py + (PLQ_H / 2 - 1) * k;
    }

    // ---------------------------------------------------- pocket stopwatch
    const w = A.watch;
    const want = w && pq ? 1 : 0;
    this.watchShow += (want - this.watchShow) * Math.min(1, dt * (want ? 4 : 7));
    if (this.watchShow > 0.01 && pq) {
      const left = w ? Math.max(0, w.left) : 0;
      const sec = Math.ceil(left);
      const last = left <= 5.0 && left > 0;
      if (sec !== this.lastSec && w) {
        if (this.lastSec >= 0 && last) {
          this.watchSw.v += 1.2;
          uiSfx('ui_click', 0.35, 1.6);
        }
        this.lastSec = sec;
      }
      swing(this.watchSw, dt, 30, 2);
      const bell = w?.bell ?? 0;
      const ang = Math.sin(this.t * 1.1) * 0.05 + this.watchSw.a * 0.12;
      const top = watchTop + (1 - this.watchShow) * -80 * k;
      const drop = (4 * 4.3 + WR + 9.6) * WATCH_S * k;
      const cx = pq.x - Math.sin(ang) * drop + (bell > 0 ? Math.round((Math.random() - 0.5) * bell * 2) : 0), cy = top + Math.cos(ang) * drop;
      const total = w?.total || 30;
      const wf = this.watchFace(small, clamp01(left / total), last ? 1 : 0);
      const sp = wf.cv;
      {
        // the case centre at (cx, cy); the lid sprung open beside it
        const scx = cx - wf.cx + sp.width / 2, scy = cy - wf.cy + sp.height / 2;
        // its chain runs from the plaque down to the bow
        this.chain(c, k, pq.x, top, Math.round(cx), Math.round(scy - sp.height / 2 + 2));
        const lid = sprite(small ? ART.watch_lid_s : ART.watch_lid);
        blitObj(c, lid, cx + (sp.width - 2), cy, 4);
        blitObj(c, sp, scx, scy, 5);
        glint(sp, scx, scy, 0.6 + bell * 5, dt);
        // the bell being rung: brass fills round the rim
        if (bell > 0.01) {
          const R = (sp.width - 4) / 2 - 1;
          for (let i = 0; i <= 72 * bell; i++) {
            const a = -Math.PI / 2 + (i / 72) * TAU;
            px(c, Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * R), 1, 1, Math.sin(this.t * 14 + i) > 0 ? UI.brass.h : UI.brass.l);
          }
        }
        const red = last && Math.sin(this.t * 12) > -0.3;
        const num = String(Math.max(0, sec));
        pixelText(c, num, cx, cy + (small ? 0 : 1), { size: small ? Math.max(10, Math.round(16 * k * 1.15)) : 16, color: red ? '#b01a10' : '#2a1608', align: 'center', lip: '#fff4e0' });
      }
      if (bell > 0.05 && Math.random() < dt * 20 * bell)
        this.glow.emit({ x: cx + (Math.random() - 0.5) * 30 * k, y: cy + (Math.random() - 0.5) * 30 * k, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 30, drag: 2, life: 0.4 + Math.random() * 0.3, size: 1, c0: 0xfff0b0, c1: 0xffb030, alpha: 1 });
    } else this.lastSec = -1;
    void s;
  }

  dispose() {
    this.dust.dispose();
    this.glow.dispose();
    void this.scene;
  }
}
