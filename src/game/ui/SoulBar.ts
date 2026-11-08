// THE SOUL BAR — the ultimate's charge as Serket's soul, kept in a canopic jar of brass
// and glass that stands above the beating heart (Serket guards the canopic jars). Drawn as
// stylized pixel art from authored layers (HudArt.ts): the glass and its brass foot behind,
// the jade soul smoke filling the glass to its level (a churning pixel swirl, the meniscus
// lit), then the brass cage, shoulder band and soul-gem cartouche in front, and the
// gadrooned stopper with Pinch the scorpion standing guard on it.
// Kill streaks pour soul in (motes spiral into the mouth on every surge, the jar rocks on
// its foot); when it is full the smoke glows and pulses, wisps leak from under the lid, the
// lid rattles and Pinch snaps his claws while the 2D HUD shows "[Z] UNLEASH". Using the
// ultimate uncorks the jar: the stopper pops and spins, the soul drains and streams out
// into Sundown as 2D pixel motes.
import * as THREE from 'three';
import type { Hud } from './Hud';
import { PixelFx, TAU, uiSfx, lerp } from './HudKit';
import { blitC, blitObj, blitSquash, glint } from './HudSprites';
import { HUD_ART as ART, HUD_ART_META } from './HudArt';
import { sprite, HUD_PAL, SWAP_FLASH } from './PixelUI';

/** the old model's size factor (kept for callers); the pixel jar is one size */
export const SOUL_JAR_SCALE = 1.3;
/** particle offsets were laid out for a 36-unit mouth height: the pixel jar's mouth is 32 px up */
const JAR_K = 32 / 36;
/** the pixel jar's hit box above its foot (the touch layer): body to the shoulder, then the stopper and Pinch */
export const SOUL_JAR_HIT = { halfW: 14, body: 33, top: 54 };

export interface SoulAnchor {
  /** jar foot centre, HUD px */
  x: number;
  y: number;
  /** size factor (small screens) */
  k: number;
  frac: number;
  ready: boolean;
  /** where the soul goes when unleashed (Sundown on screen), HUD px */
  heroX: number;
  heroY: number;
}

const rgb = (ch: string) => {
  const n = parseInt(HUD_PAL[ch].slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** the glass interior rows of the authored jar */
const MASK_ROWS = (() => {
  const r = ART.jar_mask.rows;
  let y0 = -1, y1 = -1;
  r.forEach((row, y) => {
    if (row.includes('@')) {
      if (y0 < 0) y0 = y;
      y1 = y;
    }
  });
  return { y0, y1 };
})();

export class SoulBar {
  private dust: PixelFx;
  private glow: PixelFx;
  private t = 0;
  private shown = 0;
  private lastUlt = -1;
  private ready = false;
  private readyT = 0;
  private surge = 0;
  private flash = 0;
  private jolt = 0;
  private drainT = -1;
  private drainFrom = 1;
  private tilt = 0;
  private tiltV = 0;
  private pinchHop = 0;
  private cv = document.createElement('canvas');

  constructor(private scene: THREE.Scene, private hud: Hud) {
    this.dust = new PixelFx(500, false, 30);
    this.glow = new PixelFx(500, true, 31);
    scene.add(this.dust.points, this.glow.points);
  }

  /** the particles ride above the HUD canvas: keep them running (hidden with the HUD) */
  fx(dt: number, s: number, visible: boolean) {
    this.dust.points.visible = this.glow.points.visible = visible;
    this.dust.update(dt, s);
    this.glow.update(dt, s);
  }

  /** the jar this frame: glass and foot, the soul to its level, the cage in front */
  private jar(level: number, ready: number, pulse: number) {
    const W = ART.jar_back.w, H = ART.jar_back.h;
    const cv = this.cv;
    if (cv.width !== W) {
      cv.width = W;
      cv.height = H;
    }
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    g.clearRect(0, 0, W, H);
    g.drawImage(sprite(ART.jar_back), 0, 0);
    const { y0, y1 } = MASK_ROWS;
    const top = level <= 0.002 ? H + 1 : Math.round(y1 - (y1 - y0) * level);
    if (top <= y1) {
      const img = g.getImageData(0, 0, W, H);
      const d = img.data;
      const rows = ART.jar_mask.rows;
      const boil = this.t * (2.2 + this.surge * 5);
      const pal = ready > 0 ? (pulse > 0.3 ? ['J', 'I', 'H', 'H'] : ['I', 'H', 'H', 'G']) : ['I', 'H', 'G', 'F'];
      for (let y = Math.max(top, y0); y <= y1; y++) {
        const row = rows[y];
        for (let x = 0; x < W; x++) {
          if (row[x] !== '@') continue;
          // a churning swirl of soul smoke: diagonal bands drifting, deeper is darker
          const depth = (y - top) / Math.max(1, y1 - top);
          const band = Math.floor((x * 2 + y * 3 + Math.sin(y * 0.7 + boil) * 2.5 + boil * 3) / 3) % 4;
          let ch = y === top ? pal[0] : band === 0 ? pal[1] : depth > 0.55 && band === 3 ? pal[3] : pal[2];
          if (y === top + 1 && band < 2) ch = pal[0];
          const v = rgb(ch);
          const o = (y * W + x) * 4;
          d[o] = v[0];
          d[o + 1] = v[1];
          d[o + 2] = v[2];
          d[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    }
    g.drawImage(sprite(ART.jar_front), 0, 0);
    return cv;
  }

  paint(c: CanvasRenderingContext2D, dt: number, anchor: SoulAnchor | null, s: number) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    if (!anchor) return;
    // the jar is authored at one size; its mouth stands 32 px above the foot (the motes aim there)
    const a = { ...anchor, k: JAR_K };
    const ult = Math.max(0, Math.min(1, a.frac));
    const k = a.k;
    if (this.lastUlt < 0) {
      this.lastUlt = ult;
      this.shown = ult;
    }
    // ---------------------------------------------------- events
    const gain = ult - this.lastUlt;
    if (this.lastUlt >= 0.999 && ult < 0.5) this.unleash(a);
    else if (gain > 0.003 && this.drainT < 0) this.pour(a, gain);
    const nowReady = ult >= 0.999;
    if (nowReady && !this.ready) {
      this.flash = 1;
      this.jolt = 1;
      uiSfx('ult_ready', 0.7);
      this.burst(a, 36);
    }
    this.ready = nowReady;
    this.readyT = nowReady ? this.readyT + dt : 0;
    this.lastUlt = ult;

    // ---------------------------------------------------- level
    if (this.drainT >= 0) {
      this.drainT += dt;
      const kd = Math.min(1, this.drainT / 1.05);
      this.shown = lerp(this.drainFrom, ult, kd * kd * (3 - 2 * kd));
      if (this.drainT < 0.95) this.stream(a, dt);
      if (this.drainT > 1.6) this.drainT = -1;
    } else this.shown += (ult - this.shown) * Math.min(1, dt * 3.2);
    this.surge = Math.max(0, this.surge - dt * 1.4);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.jolt = Math.max(0, this.jolt - dt * 3);
    // a damped slosh: the jar rocks on its foot with every surge
    for (let i = 0, n = Math.ceil(dt * 120); i < n; i++) {
      const h = dt / n;
      this.tiltV += (-this.tilt * 60 - this.tiltV * 7) * h;
      this.tilt += this.tiltV * h;
    }

    // ---------------------------------------------------- the jar
    const glowing = this.ready && this.drainT < 0;
    const pulse = Math.sin(this.t * 5);
    const jar = this.jar(this.shown, glowing ? 1 : 0, pulse);
    const rock = Math.round(this.tilt * 5);
    const rattle = this.ready ? (Math.sin(this.t * 47) > 0.6 ? 1 : 0) * (Math.sin(this.t * 3.1) > 0 ? 1 : 0) : 0;
    const hop = Math.round(Math.sin(this.jolt * Math.PI) * 2);
    // it stands on its foot at the anchor
    const cx = a.x + rock, cy = a.y - hop - jar.height / 2;
    blitObj(c, jar, cx, cy, 2 + hop);
    glint(jar, cx, cy, glowing ? 2.4 : 0.6, dt);
    if (this.flash > 0.02) blitC(c, sprite(ART.jar_back, SWAP_FLASH, 'flash'), cx, cy, this.flash * 0.5);
    // the stopper: rattles when full, pops and spins when uncorked; Pinch idles, snaps or dozes
    let up = 0, spin = 1;
    if (this.drainT >= 0) {
      const u = this.drainT;
      up = u < 0.12 ? (u / 0.12) * 7 : u < 1.1 ? 7 + Math.sin((u - 0.12) * 9) * 0.6 : Math.max(0, 7 * (1 - (u - 1.1) / 0.3));
      spin = Math.cos(u * 7);
      if (u > 1.4 && u - dt <= 1.4) uiSfx('rev_close', 0.45, 0.8);
    } else if (this.ready) up = Math.max(0, Math.sin(this.t * 23)) * 0.6 * (Math.sin(this.t * 2.7) > 0.3 ? 1 : 0.15);
    const pinchHop = this.pinchHop > 0 ? Math.abs(Math.sin(this.pinchHop * Math.PI * 2)) * 4 * this.pinchHop : 0;
    this.pinchHop = Math.max(0, this.pinchHop - dt * 1.6);
    const pose = this.ready || this.pinchHop > 0 ? (Math.sin(this.t * 9) > 0 ? 1 : 0) : this.shown < 0.2 ? 2 : 0;
    const lid = sprite(ART['jar_lid' + pose]);
    const lidCy = cy - jar.height / 2 + HUD_ART_META.jar_top - ART.jar_lid0.h + 1 + lid.height / 2 - Math.round(up + pinchHop);
    if (Math.abs(spin) > 0.999) blitObj(c, lid, cx + rattle, lidCy, 1 + up);
    else blitSquash(c, lid, cx + rattle, lidCy, spin < 0 ? Math.min(-0.15, spin) : Math.max(0.15, spin));
    if (this.surge > 0.25 && Math.random() < dt * 20) {
      // the soul sloshes up the glass on a big surge
      this.glow.emit({ x: a.x + (Math.random() - 0.5) * 12 * k, y: a.y - (8 + this.shown * 20) * k, vx: (Math.random() - 0.5) * 8, vy: -10 - Math.random() * 10, life: 0.4, size: 1, c0: 0xeafff2, c1: 0x2fbf7e, alpha: 0.9 });
    }
    this.ambient(dt, a);
    void s;
  }

  /** soul motes fly in from the field and spiral down the mouth */
  private pour(a: SoulAnchor, gain: number) {
    this.surge = Math.min(1.5, this.surge + gain * 14);
    if (gain > 0.025) {
      this.jolt = Math.max(this.jolt, 0.7);
      this.tiltV += 1.2;
    } else this.tiltV += gain * 20;
    const k = a.k;
    const mx = a.x, my = a.y - 36 * k;
    const n = Math.min(46, 3 + Math.round(gain * 520));
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU, r = (26 + Math.random() * 34) * k;
      const sx = mx + Math.cos(ang) * r, sy = my + Math.sin(ang) * r * 0.8 - 8 * k;
      const life = 0.45 + Math.random() * 0.45;
      const c = Math.random() < 0.25 ? 0xeafff2 : Math.random() < 0.5 ? 0x7cf2b4 : 0x35c98a;
      this.glow.emit({ x: sx, y: sy, tx: mx + (Math.random() - 0.5) * 3 * k, ty: my + 3 * k, vx: -Math.sin(ang) * 22 * k, vy: Math.cos(ang) * 22 * k - 6, life, size: Math.random() < 0.3 ? 2 : 1, size1: 1, c0: c, c1: 0x2a9a6a, alpha: 0.95, curl: 4 });
    }
  }

  private burst(a: SoulAnchor, n: number) {
    const k = a.k;
    const cx = a.x, cy = a.y - 22 * k;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU, v = (40 + Math.random() * 70) * k;
      this.glow.emit({ x: cx + Math.cos(ang) * 8 * k, y: cy + Math.sin(ang) * 12 * k, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 20, ay: -10, drag: 2.5, life: 0.5 + Math.random() * 0.6, size: Math.random() < 0.3 ? 2 : 1, c0: 0xeafff2, c1: 0x2fbf7e, alpha: 1, flick: 0.4 });
    }
  }

  /** uncork: the whole soul whirls out and streams into Sundown */
  private unleash(a: SoulAnchor) {
    this.drainT = 0;
    this.drainFrom = Math.max(this.shown, 0.98);
    this.flash = 1;
    this.jolt = 1;
    this.tiltV -= 2.2;
    this.pinchHop = 1;
    uiSfx('soul_leave', 0.8, 1.15);
    uiSfx('rev_open', 0.5, 0.7);
    this.burst(a, 50);
  }

  private stream(a: SoulAnchor, dt: number) {
    const k = a.k;
    const mx = a.x, my = a.y - 37 * k;
    const n = Math.round(dt * 260);
    for (let i = 0; i < n; i++) {
      const life = 0.5 + Math.random() * 0.35;
      const side = (Math.random() - 0.5) * 2;
      const c = Math.random() < 0.3 ? 0xeafff2 : Math.random() < 0.6 ? 0x7cf2b4 : 0x2fbf7e;
      this.glow.emit({
        x: mx + (Math.random() - 0.5) * 6 * k, y: my - Math.random() * 4 * k,
        tx: a.heroX + (Math.random() - 0.5) * 14, ty: a.heroY + (Math.random() - 0.5) * 18,
        vx: 40 + side * 50, vy: -90 - Math.random() * 60,
        life, size: Math.random() < 0.35 ? 2 : 1, size1: Math.random() < 0.5 ? 3 : 1, c0: c, c1: 0x9dff3a, alpha: 1, curl: 10,
      });
      if (Math.random() < 0.35)
        this.dust.emit({ x: mx + (Math.random() - 0.5) * 8 * k, y: my, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 30, ay: -20, drag: 1.5, life: 0.6 + Math.random() * 0.5, size: 2, size1: 4, c0: 0x2a8a62, c1: 0x0e3a28, alpha: 0.5, curl: 8 });
    }
    // the soul whirls down in the glass as it goes
    if (Math.random() < dt * 40) {
      const ang = this.t * 14;
      this.glow.emit({ x: a.x + Math.cos(ang) * 7 * k, y: a.y - (8 + this.shown * 22) * k, vx: -Math.sin(ang) * 30, vy: -40, life: 0.35, size: 1, c0: 0xb8ffd8, c1: 0x2fbf7e, alpha: 0.9 });
    }
    // arrival flare at Sundown
    if (Math.random() < dt * 30)
      for (let i = 0; i < 5; i++) {
        const ang = Math.random() * TAU, v = 30 + Math.random() * 60;
        this.glow.emit({ x: a.heroX, y: a.heroY, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, drag: 3, life: 0.35 + Math.random() * 0.3, size: 1, c0: 0xeafff2, c1: 0x9dff3a, alpha: 1 });
      }
  }

  private ambient(dt: number, a: SoulAnchor) {
    const k = a.k;
    const mx = a.x, my = a.y - 35.5 * k;
    if (this.ready) {
      // wisps leak from under the stopper and curl up
      if (Math.random() < dt * 16) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.dust.emit({ x: mx + side * (6 + Math.random() * 2) * k, y: my, vx: side * (4 + Math.random() * 6), vy: -14 - Math.random() * 10, ay: -6, drag: 0.6, life: 1.1 + Math.random() * 0.9, size: 1, size1: 3, c0: 0x6ff0b0, c1: 0x1d6a4a, alpha: 0.65, curl: 7 });
      }
      if (Math.random() < dt * 10) this.glow.emit({ x: mx + (Math.random() - 0.5) * 16 * k, y: my + Math.random() * 10 * k, vx: (Math.random() - 0.5) * 6, vy: -16 - Math.random() * 14, drag: 0.4, life: 0.8 + Math.random() * 0.8, size: 1, c0: 0xeafff2, c1: 0x2fbf7e, alpha: 0.9, flick: 0.6, curl: 5 });
    } else if (this.shown > 0.05 && Math.random() < dt * (0.6 + this.shown * 2.5)) {
      // faint motes drifting inside the glass
      const r = Math.random() * 8 * k;
      this.glow.emit({ x: mx + (Math.random() - 0.5) * r * 2, y: a.y - (6 + Math.random() * this.shown * 22) * k, vx: (Math.random() - 0.5) * 3, vy: -3 - Math.random() * 4, life: 0.7 + Math.random() * 0.6, size: 1, c0: 0xb8ffd8, c1: 0x2fbf7e, alpha: 0.55, flick: 0.5 });
    }
  }

  dispose() {
    this.dust.dispose();
    this.glow.dispose();
    void this.scene;
    void this.hud;
  }
}
