// THE BOSS BAR: every boss gets its own themed health bar across the top of the HUD,
// stylized pixel art on the HUD's pixel grid (no texture photos, no glow type):
//  • a bevelled, riveted frame in the boss's own materials (moon silver and lapis for
//    Khonsu, sun gold for Ra, tin and brass for the Dust Marshal, chitin, iron, scale...)
//    with diamond end caps carrying its authored glyph (HudArt glyph_*)
//  • the fill is split into segments; an emptied segment cracks and sheds pixel shards,
//    the current one splinters as it drains; a pale damage trail eases down behind hits
//  • phase markers stand on the bar at the boss's phase thresholds; crossing one shatters
//    its gem, shakes the bar hard, shifts the fill hotter and stamps PHASE II / ENRAGED
//  • every hit jolts the bar and flashes the fill head; the name types itself in with a
//    highlight sweep when the boss arrives, its title in quiet ink underneath
// A boss may set `barTheme` (a THEMES key) to choose its look; otherwise its name picks one.
import { px, sprite, type PixelSprite } from './PixelUI';
import { pixelText, pixelTextWidth } from './HudSprites';
import { HUD_ART as ART } from './HudArt';
import { uiSfx } from './HudKit';

export interface BossBarState {
  name: string;
  frac: number;
  title?: string;
  /** phases passed (Boss.phase) and their thresholds (Boss.phases, fractions of max hp) */
  phase?: number;
  phases?: number[];
  /** a THEMES key (Boss.barTheme) */
  theme?: string;
  /** a new id restarts the intro */
  id?: number;
}

interface Theme {
  /** frame ramp: outline, dark, mid, light, highlight */
  fr: [string, string, string, string, string];
  /** fill ramp: dark, mid, light, highlight; and the hotter one after the last phase */
  fill: [string, string, string, string];
  hot: [string, string, string, string];
  /** the empty track */
  track: string;
  name: string;
  glyph: string;
  /** a pale mark pattern in the frame (moon dots, sun rays, rivets...) */
  orn: 'rivet' | 'dots' | 'rays' | 'teeth' | 'scales';
}

const T = (fr: Theme['fr'], fill: Theme['fill'], hot: Theme['hot'], track: string, name: string, glyph: string, orn: Theme['orn']): Theme => ({ fr, fill, hot, track, name, glyph, orn });
export const BOSS_THEMES: Record<string, Theme> = {
  moon: T(['#0c1022', '#283a7a', '#4468c0', '#8ab0e8', '#e8f0ff'], ['#3a5aa8', '#6a8ad8', '#a8c4f4', '#f0f6ff'], ['#5a3aa8', '#8a6ae0', '#c4a8ff', '#f4eaff'], '#0e1430', '#dce8ff', 'glyph_eye', 'dots'),
  sun: T(['#2e1c06', '#7c5214', '#b88426', '#e2b24a', '#fff0a6'], ['#c0601a', '#e88a2a', '#ffc050', '#fff0b0'], ['#a8221a', '#dc4430', '#ff8a4a', '#ffe0a0'], '#2a1408', '#ffe6a0', 'glyph_sun', 'rays'),
  set: T(['#1e0806', '#5a1a10', '#8a3018', '#c05a2a', '#f0a070'], ['#6a120c', '#a8221a', '#dc4430', '#ff9a7a'], ['#4a0a2a', '#8a1a4a', '#d03a6a', '#ffa0c0'], '#1a0806', '#ffc0a0', 'glyph_ankh', 'teeth'),
  marshal: T(['#121519', '#3e3a36', '#8a867c', '#bdb9ae', '#f2efe6'], ['#7c5214', '#b88426', '#e2b24a', '#fff0a6'], ['#a8221a', '#dc4430', '#ff8a6a', '#ffe0c0'], '#1a1410', '#f2efe6', 'glyph_feather', 'rivet'),
  chitin: T(['#1a0e06', '#4a2a10', '#7a4a1c', '#b07a34', '#e8c070'], ['#7a3a0a', '#b8641a', '#e89a3a', '#ffd690'], ['#6a120c', '#a8221a', '#dc4430', '#ff8a6a'], '#1a0c06', '#ffe0b0', 'glyph_scarab', 'scales'),
  lapis: T(['#141c3a', '#283a7a', '#4468c0', '#d6a64c', '#f8da86'], ['#1d6a4a', '#2fbf7e', '#7cf2b4', '#eafff2'], ['#a5752e', '#d6a64c', '#f8da86', '#fffbe0'], '#0c1424', '#f8da86', 'glyph_djed', 'dots'),
  flesh: T(['#2a0806', '#4a0e0a', '#7a1c14', '#c86a5a', '#f0b0a0'], ['#7a1c14', '#c43a2a', '#e8705a', '#ffc0a8'], ['#4a0e0a', '#a8221a', '#ff5a3a', '#ffd0a0'], '#1a0604', '#ffd0c0', 'glyph_water', 'teeth'),
  thorn: T(['#141008', '#3a3018', '#6a5a2a', '#a08a4a', '#d8c88a'], ['#2e6a18', '#4fa52a', '#8fe03a', '#d8ff9a'], ['#6a120c', '#a8221a', '#dc4430', '#ff8a6a'], '#100c06', '#e8f0b0', 'glyph_reed', 'teeth'),
  iron: T(['#121519', '#2b323a', '#465260', '#6d7b89', '#a9b6c2'], ['#a8221a', '#e05a1a', '#ff9a2a', '#ffe08a'], ['#ff5a1a', '#ff8a2a', '#ffc04a', '#ffffff'], '#0c0e10', '#ffd8a0', 'glyph_sun', 'rivet'),
  scale: T(['#0e1a0c', '#1e3a1a', '#3a6a2a', '#6a9a3a', '#b8d870'], ['#2e6a18', '#4fa52a', '#8fe03a', '#d8ff9a'], ['#7a5a10', '#c09a20', '#f0d040', '#fff8b0'], '#081006', '#d8f0a0', 'glyph_water', 'scales'),
  stone: T(['#2a1c10', '#6e5a40', '#a48a64', '#d6c09a', '#f6ead0'], ['#a5752e', '#d6a64c', '#f8da86', '#fffbe0'], ['#a8221a', '#dc4430', '#ff8a6a', '#ffe0c0'], '#1a120a', '#f6ead0', 'glyph_ankh', 'rays'),
  water: T(['#0e1a22', '#1f5a6a', '#35a8b8', '#6fe3cf', '#c8fff0'], ['#1f5a6a', '#35a8b8', '#6fe3cf', '#e0fff8'], ['#1d6a4a', '#2fbf7e', '#7cf2b4', '#eafff2'], '#08141a', '#c8fff0', 'glyph_water', 'dots'),
  bone: T(['#1a0e06', '#6e5a40', '#b8a07a', '#e0cfa8', '#fff6e0'], ['#6a120c', '#a8221a', '#dc4430', '#ff8a6a'], ['#4a0a2a', '#8a1a4a', '#d03a6a', '#ffa0c0'], '#140a06', '#fff3d6', 'glyph_ankh', 'rivet'),
};
const BY_NAME: [RegExp, string][] = [
  [/khonsu|moon/i, 'moon'],
  [/\bra\b|sun king|cleopatra|daughter of the sun/i, 'sun'],
  [/seth|set\b|avatar of set/i, 'set'],
  [/marshal/i, 'marshal'],
  [/bertha|sunroller|scorp|scarab|beetle/i, 'chitin'],
  [/pharaoh|nekh/i, 'lapis'],
  [/gulp|worm|dune that eats/i, 'flesh'],
  [/thornback|thorn/i, 'thorn'],
  [/ironclad|train|puppet|lightning/i, 'iron'],
  [/sebek|croc|jaw of the nile/i, 'scale'],
  [/sphinx/i, 'stone'],
  [/oasis|lake|leviathan|olm/i, 'water'],
];
export function bossTheme(st: BossBarState): Theme {
  if (st.theme && BOSS_THEMES[st.theme]) return BOSS_THEMES[st.theme];
  const s = `${st.name} ${st.title ?? ''}`;
  for (const [re, k] of BY_NAME) if (re.test(s)) return BOSS_THEMES[k];
  return BOSS_THEMES.bone;
}

const NSEG = 12;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const hsh = (a: number, b: number) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/** the frame: bevelled band with diamond caps, ornaments, rivets (cached per theme and width) */
const frameCache = new Map<string, HTMLCanvasElement>();
function frameArt(th: Theme, bw: number) {
  const key = th.fr.join() + bw;
  let cv = frameCache.get(key);
  if (cv) return cv;
  const CAP = 11, H = 22;
  cv = document.createElement('canvas');
  cv.width = bw + CAP * 2;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const [o, d, m, l, h] = th.fr;
  const y0 = 3, bh = 16; // band rows y0..y0+bh-1
  const x0 = CAP - 2, x1 = CAP + bw + 1;
  for (let y = y0; y < y0 + bh; y++)
    for (let x = x0; x <= x1; x++) {
      const ry = y - y0;
      let col = m;
      if (ry === 0 || ry === bh - 1 || x === x0 || x === x1) col = o;
      else if (ry === 1) col = h;
      else if (ry === 2) col = l;
      else if (ry === bh - 2) col = d;
      else if (ry === bh - 3) col = ((x + ry) & 3) === 0 ? d : m;
      // the inner well (the track sits here)
      if (ry >= 3 && ry <= bh - 4 && x > x0 + 2 && x < x1 - 2) col = ry === 3 ? o : th.track;
      px(c, x, y, 1, 1, col);
    }
  // ornaments along the upper and lower lips
  for (let x = x0 + 6; x < x1 - 4; x += 6) {
    const k = (x - x0) / 6;
    if (th.orn === 'rivet' && k % 2 === 0) {
      for (const yy of [y0 + 1, y0 + bh - 3]) {
        px(c, x, yy, 2, 2, d);
        px(c, x, yy, 1, 1, h);
      }
    } else if (th.orn === 'dots') px(c, x, y0 + 1, 1, 1, k % 2 ? l : '#ffffff');
    else if (th.orn === 'rays') {
      px(c, x, y0 + 1, 1, 1, h);
      px(c, x + 1, y0 + 2, 1, 1, h);
    } else if (th.orn === 'teeth') {
      px(c, x, y0 - 1, 1, 1, o);
      px(c, x, y0, 1, 1, l);
      px(c, x + 3, y0 + bh, 1, 1, o);
      px(c, x + 3, y0 + bh - 1, 1, 1, d);
    } else if (th.orn === 'scales') {
      px(c, x, y0 + 2, 3, 1, d);
      px(c, x + 1, y0 + 1, 1, 1, h);
    }
  }
  // diamond end caps, lit from the top left
  for (const cx of [CAP - 1, CAP + bw + 1]) {
    const cy = H / 2 - 0.5;
    for (let y = 0; y < H; y++)
      for (let x = cx - CAP; x <= cx + CAP; x++) {
        const dx = Math.abs(x - cx) / CAP, dy = Math.abs(y - cy) / (H / 2);
        const dd = dx + dy;
        if (dd > 1) continue;
        let col = m;
        if (dd > 0.86) col = o;
        else if (dd > 0.72) col = x - cx + (y - cy) < 0 ? h : d;
        else if (dd > 0.6) col = l;
        else col = x - cx + (y - cy) < -2 ? l : m;
        px(c, x, y, 1, 1, col);
      }
    const g = ART[th.glyph] as PixelSprite | undefined;
    if (g) c.drawImage(sprite(g), Math.round(cx - g.w / 2 + 0.5), Math.round(cy - g.h / 2 + 0.5));
  }
  frameCache.set(key, cv);
  if (frameCache.size > 24) frameCache.delete(frameCache.keys().next().value!);
  return cv;
}

interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  col: string;
  s: number;
}

export class BossBar {
  private id = -1;
  private name = '';
  private intro = 0;
  private shown = 0;
  private trail = 1;
  private trailHold = 0;
  private lastFrac = 1;
  private shake = 0;
  private flash = 0;
  private lastPhase = 0;
  private phaseT = 9;
  private phaseLabel = '';
  private broken = new Set<number>();
  private shards: Shard[] = [];
  private t = 0;

  /** draws the bar centred at cx with its top at y; returns the bottom edge (HUD px) */
  paint(c: CanvasRenderingContext2D, dt: number, st: BossBarState, cx: number, y: number, W: number): number {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const th = bossTheme(st);
    const id = st.id ?? 0;
    if (id !== this.id || st.name !== this.name) {
      this.id = id;
      this.name = st.name;
      this.intro = 0;
      this.shown = 0;
      this.trail = 1;
      this.lastFrac = st.frac;
      this.lastPhase = st.phase ?? 0;
      this.phaseT = 9;
      this.broken.clear();
      this.shards.length = 0;
    }
    const frac = Math.max(0, Math.min(1, st.frac));
    this.intro = Math.min(1, this.intro + dt / 1.4);
    // the fill sweeps in on arrival, then follows the real value
    const target = this.intro < 1 ? Math.min(frac, ease(this.intro / 0.9)) : frac;
    this.shown = target;
    if (frac < this.lastFrac - 0.0005) {
      const dmg = this.lastFrac - frac;
      this.shake = Math.min(1.2, this.shake + 0.18 + dmg * 14);
      this.flash = 1;
      this.trailHold = 0.35;
    }
    this.lastFrac = frac;
    this.trailHold -= dt;
    if (this.trailHold <= 0) this.trail = Math.max(this.shown, this.trail - dt * 0.6);
    if (this.trail < this.shown) this.trail = this.shown;
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.flash = Math.max(0, this.flash - dt * 9);
    const ph = st.phase ?? 0;
    if (ph > this.lastPhase) {
      this.lastPhase = ph;
      this.phaseT = 0;
      const last = ph >= (st.phases?.length ?? 2);
      this.phaseLabel = last ? 'ENRAGED' : 'PHASE ' + (ROMAN[ph] ?? String(ph + 1));
      this.shake = 2;
      uiSfx('counter_clang', 0.45, 0.6);
    }
    this.phaseT += dt;

    const bw = Math.round(Math.max(180, Math.min(340, W * 0.5)) / 2) * 2;
    const drop = (1 - ease(Math.min(1, this.intro * 2.2))) * -40;
    const sx = Math.round((Math.random() - 0.5) * 4 * this.shake), sy = Math.round((Math.random() - 0.5) * 3 * this.shake);
    const x0 = Math.round(cx - bw / 2) + sx;
    const top = Math.round(y + 14 + drop) + sy;
    // ------------------------------------------ name, typed in with a highlight sweep
    const nLen = Math.ceil(Math.min(1, this.intro * 1.8) * st.name.length);
    const nm = st.name.toUpperCase().slice(0, nLen);
    if (nm) {
      pixelText(c, nm, cx + sx, top - 15, { size: 16, color: th.name, align: 'center', outline: th.fr[0] });
      const sweep = this.intro * 2.2 - 0.6;
      if (sweep > 0 && sweep < 1) {
        const tw = pixelTextWidth(st.name.toUpperCase(), 16);
        const hx = cx - tw / 2 + sweep * tw;
        c.save();
        c.globalAlpha = 0.55;
        px(c, Math.round(hx), top - 14, 2, 13, '#ffffff');
        px(c, Math.round(hx) - 3, top - 14, 2, 13, th.fr[4]);
        c.restore();
      }
    }
    // ------------------------------------------ frame
    const fr = frameArt(th, bw);
    c.drawImage(fr, x0 - 11, top - 3);
    // ------------------------------------------ fill, trail, segments, cracks
    const ix = x0 + 2, iy = top + 4, iw = bw - 2, ih = 8;
    const hot = (st.phases?.length ?? 0) > 0 && ph >= (st.phases?.length ?? 2);
    const F = hot ? th.hot : th.fill;
    const fw = Math.round(iw * this.shown);
    const tw2 = Math.round(iw * this.trail);
    const low = this.shown < 0.2;
    const pulse = low ? 0.5 + 0.5 * Math.sin(this.t * 9) : 0;
    for (let x = 0; x < fw; x++) {
      for (let r = 0; r < ih; r++) {
        let col = r === 0 ? F[3] : r <= 2 ? F[2] : r >= ih - 2 ? F[0] : F[1];
        // a woven grain so the fill reads as material, not a flat block
        if (r > 2 && r < ih - 2 && ((x + r * 2) % 7 === 0)) col = F[0];
        if (low && r <= 2 && pulse > 0.6) col = F[3];
        px(c, ix + x, iy + r, 1, 1, col);
      }
    }
    // a slow sheen running along the fill
    const shx = Math.round(((this.t * 0.35) % 1.4) * iw);
    if (shx < fw) for (let r = 1; r < ih - 1; r++) px(c, ix + Math.min(fw - 1, shx + Math.round(r * 0.5)), iy + r, 1, 1, F[3]);
    // the damage trail (pale just after the hit, then a dark bruise colour)
    if (tw2 > fw) px(c, ix + fw, iy, tw2 - fw, ih, this.trailHold > 0.2 ? '#fff4e0' : F[0]);
    // the fill head flashes on a hit
    if (this.flash > 0 && fw > 0) px(c, ix + fw - 2, iy, 2, ih, '#ffffff');
    // segments: dividers, emptied ones cracked, the draining one splintering
    const segW = iw / NSEG;
    for (let i = 0; i < NSEG; i++) {
      const sx0 = Math.round(ix + i * segW), sx1 = Math.round(ix + (i + 1) * segW);
      if (i > 0) {
        px(c, sx0, iy, 1, ih, th.fr[0]);
        px(c, sx0 + 1, iy, 1, 1, th.fr[3]);
      }
      const segFrac = (this.shown * iw - (sx0 - ix)) / Math.max(1, sx1 - sx0);
      const empty = segFrac <= 0;
      if (empty && !this.broken.has(i) && this.intro >= 1) {
        this.broken.add(i);
        for (let k = 0; k < 9; k++) this.shards.push({ x: sx0 + Math.random() * (sx1 - sx0), y: iy + Math.random() * ih, vx: (Math.random() - 0.5) * 50, vy: -30 - Math.random() * 50, t: 0, life: 0.7 + Math.random() * 0.5, col: F[k % 4], s: k % 3 ? 1 : 2 });
      }
      if (!empty) this.broken.delete(i);
      // cracks: a jagged line through every emptied segment, a growing one through the draining one
      const amount = empty ? 1 : segFrac < 1 ? 1 - segFrac : 0;
      if (amount > 0.15) {
        let cy2 = iy + 1 + Math.floor(hsh(i, 1) * (ih - 2));
        const n = Math.round((sx1 - sx0 - 1) * Math.min(1, amount));
        for (let k = 0; k < n; k++) {
          const xx = empty ? sx1 - 1 - k : sx0 + Math.round(segFrac * (sx1 - sx0)) + k;
          if (xx >= sx1 || xx <= sx0) continue;
          if (hsh(i, k + 7) > 0.55) cy2 += hsh(i, k + 3) > 0.5 ? 1 : -1;
          cy2 = Math.max(iy, Math.min(iy + ih - 1, cy2));
          if (empty && k > n * 0.7) continue;
          px(c, xx, cy2, 1, 1, empty ? th.fr[1] : th.fr[0]);
        }
      }
    }
    // phase markers: a spike through the bar with a gem; crossed ones are shattered
    const phs = st.phases ?? [];
    phs.forEach((f, i) => {
      const mx = Math.round(ix + iw * f);
      const passed = ph > i;
      const pop = passed && ph === i + 1 && this.phaseT < 0.6 ? 1 - this.phaseT / 0.6 : 0;
      px(c, mx - 1, top - 1, 3, 18, th.fr[0]);
      px(c, mx, top, 1, 16, passed ? th.fr[1] : th.fr[3]);
      const gy = top - 5 - Math.round(pop * 4);
      const gem = passed ? th.fr[1] : F[3];
      px(c, mx - 2, gy, 5, 5, th.fr[0]);
      px(c, mx - 1, gy + 1, 3, 3, gem);
      if (!passed) px(c, mx - 1, gy + 1, 1, 1, '#ffffff');
      else px(c, mx, gy + 1, 1, 3, th.fr[0]);
      if (pop > 0.9 && this.phaseT < 0.05) for (let k = 0; k < 16; k++) this.shards.push({ x: mx, y: gy + 2, vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 60, t: 0, life: 0.9, col: k % 2 ? F[3] : th.fr[4], s: 1 });
    });
    // embers off the fill head when it is nearly gone
    if (low && fw > 0 && Math.random() < dt * 14) this.shards.push({ x: ix + fw - 1, y: iy + ih / 2, vx: (Math.random() - 0.3) * 20, vy: -20 - Math.random() * 25, t: 0, life: 0.6, col: F[2], s: 1 });
    // shards
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.t += dt;
      s.vy += 160 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.t > s.life) {
        this.shards.splice(i, 1);
        continue;
      }
      c.globalAlpha = Math.min(1, (s.life - s.t) * 3);
      px(c, Math.round(s.x), Math.round(s.y), s.s, s.s, s.col);
      c.globalAlpha = 1;
    }
    // ------------------------------------------ title in quiet ink, phase stamp
    let bottom = top + 19;
    if (st.title && this.intro > 0.6) {
      pixelText(c, st.title, cx, top + 17, { size: 16, color: '#d8c8a8', align: 'center', outline: '#1a0e06' });
      bottom = top + 33;
    }
    if (this.phaseT < 1.8) {
      const k = this.phaseT;
      const pop = k < 0.15 ? k / 0.15 : 1;
      const out = k > 1.4 ? (1.8 - k) / 0.4 : 1;
      c.globalAlpha = out;
      const lx = x0 + bw + 18;
      const ly = top + 1 - Math.round((1 - pop) * 10);
      pixelText(c, this.phaseLabel, lx, ly, { size: 16, color: k < 0.3 && Math.sin(k * 60) > 0 ? '#ffffff' : th.hot[2], align: 'left', outline: '#1a0604' });
      c.globalAlpha = 1;
    }
    return bottom;
  }
}

function ease(x: number) {
  x = Math.max(0, Math.min(1, x));
  return 1 - Math.pow(1 - x, 3);
}
