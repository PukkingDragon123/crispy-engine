// The MISSION PAPER: the quest you accepted is a torn, scorched, coffee-ringed
// note speared on a forged nail near the top-right corner of the HUD — flat
// pixel art like the rest of the HUD. The parchment is generated pixel by pixel
// (fibres, foxing, a dried coffee ring, a charred corner, a browned, deckled
// torn edge with an ink outline) on the pixel UI kit's parchment ramp; the
// writing is Alagard set on it in ink; the nail is a photograph of the sculpted
// rosehead below (HudSprites). Each note hangs from the nail and flutters as a
// 2D sprite: drawn row by row, every row swayed a little more the further it
// hangs from the nail (harder the faster Sundown rides), the fan of the stack
// a shear about the nail.
//   • a new quest: the note blows in, slaps flat and the nail is driven home
//   • objective progress: an ink stroke underlines the progress line
//   • completed: a red DONE stamp slams down, then the wind rips the note off the
//     nail (a torn scrap stays impaled for a moment)
//   • failed: the note catches fire and burns away to embers
// Several quests stack on the same nail, fanned a little, the newest on top.
import * as THREE from 'three';
import { PixelFx, wrapInk, h3, clamp, clamp01, TAU, uiSfx, KNZ } from './HudKit';
import { blitObj, blitShear, blitShearObj, shadowOffset, variant, pixelText, pixelTextWidth } from './HudSprites';
import { sprite, nine } from './PixelUI';
import { HUD_ART as ART } from './HudArt';

/** what one note says */
export interface PaperQuest {
  /** stable id (the title will do) */
  id: string;
  title: string;
  objective: string;
  /** e.g. "340 m", "3/10 outlaws · 45s" */
  progress?: string;
  /** e.g. "Reward: 120 bounty" */
  reward?: string;
  /** the quest the objective tracker follows (ui/QuestTracker): its note hangs on top */
  tracked?: boolean;
}

/** rewards the quest givers promise (used when a quest does not say) */
const REWARDS: [RegExp, string][] = [
  [/^escort/i, 'Reward: bounty & snake oil'],
  [/wagon/i, 'Reward: bounty & gold'],
  [/rain frog/i, "Reward: a mother's thanks"],
  [/clear the fort/i, 'Reward: gold strongbox'],
  [/strike it rich/i, 'Reward: bounty for the ore'],
  [/camel rustlers/i, "Reward: Humphrey's swift legs"],
  [/^wanted/i, 'Reward: bounty & a strongbox'],
  [/showdown/i, 'Stakes: double or nothing'],
];

/** turn the HUD's old {text, sub} objective into a note */
export function questFromObjective(o: { text: string; sub: string }, reward?: string): PaperQuest {
  const parts = o.sub.split(' — ');
  const objective = parts[0] ?? '';
  const progress = parts.slice(1).join(' — ') || undefined;
  return { id: o.text, title: o.text, objective, progress, reward: reward ?? REWARDS.find(([r]) => r.test(o.text))?.[1] ?? 'Reward: bounty' };
}

const SUCCESS = /COMPLETE|SAFE AND SOUND|FIXED|REUNITED|CLAIMED|\bDONE\b|SUCCESS|THANKS/i;
const FAILURE = /FAIL|DIDN'T|LOST|TOOK THE|ESCAPED|\bDEAD\b|TOO LATE|GONE/i;

/** fbm of simplex noise mapped to ~0..1 */
function fbm01(x: number, y: number, oct = 3) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * KNZ.n2(x * f, y * f);
    n += a;
    f *= 2.07;
    a *= 0.5;
  }
  return 0.5 + 0.5 * (s / n) * 1.4;
}
const sm = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** the note's paper: the authored torn-parchment frame (HudArt nine_parch) stretched to the note */
function notePaper(w: number, h: number, seed: number, coffee: [number, number, number], scorch: [number, number]) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  c.drawImage(nine(seed > 0.5 ? ART.nine_parch2 : ART.nine_parch, w, h, 8), 0, 0);
  void coffee;
  void scorch;
  return cv;
}

/** the red DONE stamp: Alagard in a broken double frame, inked unevenly (HUD px) */
function stampCanvas(fs: number) {
  const tw = Math.ceil(pixelTextWidth('DONE', fs));
  const w = tw + Math.round(fs * 0.9), h = Math.round(fs * 1.55);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const red = '#b01810';
  pixelText(c, 'DONE', w / 2, Math.round(h / 2 - fs * 0.55), { size: fs, color: red, align: 'center' });
  c.fillStyle = red;
  const t = Math.max(1, Math.round(fs / 16));
  for (const [i, th] of [[0, t + 1], [t + 2, t]] as [number, number][]) {
    c.fillRect(i, i, w - i * 2, th);
    c.fillRect(i, h - i - th, w - i * 2, th);
    c.fillRect(i, i, th, h - i * 2);
    c.fillRect(w - i - th, i, th, h - i * 2);
  }
  // uneven rubber: knock some of the ink out
  const img = c.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      if (!img.data[k + 3]) continue;
      const n = fbm01(x * 0.21 + 3, y * 0.21) * 0.7 + h3(x, y, 5) * 0.3;
      if (n < 0.2) img.data[k + 3] = 0;
      else if (n < 0.3) img.data[k + 3] = 170;
    }
  c.putImageData(img, 0, 0);
  return cv;
}

// ------------------------------------------------------------------ one note
type State = 'in' | 'pinned' | 'stamp' | 'tear' | 'burn' | 'gone';

class Note {
  q: PaperQuest;
  w = 140;
  h = 80;
  fs = 16;
  state: State = 'in';
  st = 0;
  /** seconds this quest has been missing from the HUD state */
  missing = 0;
  /** fan angle (a shear about the nail) and its target */
  ang = 0;
  angT = 0;
  /** offset from the pinned pose (HUD px) and its velocity */
  ox = 0;
  oy = 0;
  vx = 0;
  vy = 0;
  /** extra lean while flying (blown in / torn off) */
  lean = 0;
  /** a slap / kick ruffle, decays */
  ruffle = 0;
  /** the parchment with the writing, and the composed picture (stroke, stamp, burn) */
  base: HTMLCanvasElement | null = null;
  pic: HTMLCanvasElement | null = null;
  private dirty = true;
  private inkKey = '';
  private inkAge = 9;
  private lastCounts: number[] = [];
  private lastObjective = '';
  progLine = -1;
  progW = 0;
  strokeT = -1;
  ending: 'done' | 'fail' | 'quiet' | null = null;
  stamped = false;
  stampSl = 0;
  stampRot = -0.22;
  burnO: [number, number] = [0, 0];
  burnP = 0;
  ripped = false;
  /** a torn scrap: the strip round the nail hole */
  scrap: { x: number; y: number; w: number; h: number } | null = null;
  seed = Math.random();
  private coffee: [number, number, number] = [0.18 + Math.random() * 0.6, 0.15 + Math.random() * 0.3, 0.1 + Math.random() * 0.05];
  private scorch: [number, number] = [Math.random() < 0.5 ? 0 : 1, Math.random() < 0.6 ? 0 : 1];

  constructor(q: PaperQuest) {
    this.q = q;
  }

  /** lay the note out (HUD px, set in Alagard at fs) and redraw its writing if it changed */
  setQuest(q: PaperQuest, compact: boolean, fs: number, force = false) {
    this.q = q;
    const u = fs / 16;
    const PAD = Math.round(9 * u), LH = Math.round(14 * u), IND = Math.round(11 * u);
    const maxW = Math.round((compact ? 180 : 214) * u);
    const obj = wrapInk(q.objective, maxW - PAD * 2, fs, compact ? 1 : 2);
    const prog = q.progress ? wrapInk(q.progress, maxW - PAD * 2 - IND, fs, 1)[0] : '';
    const reward = compact || !q.reward ? '' : wrapInk(q.reward, maxW - PAD * 2, fs, 1)[0];
    const lines: { t: string; kind: 'title' | 'obj' | 'prog' | 'rew' }[] = [
      // long titles ("Find a way out of the Glass Hollow") wrap instead of running off the paper
      ...wrapInk(q.title, maxW - PAD * 2, fs, compact ? 1 : 2).map((t) => ({ t, kind: 'title' as const })),
      ...obj.map((t) => ({ t, kind: 'obj' as const })),
    ];
    if (prog) lines.push({ t: prog, kind: 'prog' });
    if (reward) lines.push({ t: reward, kind: 'rew' });
    let tw = 0;
    for (const l of lines) tw = Math.max(tw, pixelTextWidth(l.t, fs) + (l.kind === 'prog' ? IND : 0));
    const w = Math.round(clamp(tw + PAD * 2, Math.round((compact ? 104 : 128) * u), maxW));
    const h = Math.round(PAD + 4 * u + lines.length * LH + 9 * u + (reward ? 2 : 0));
    const key = `${fs}|${w}|${h}|${lines.map((l) => l.t).join('|')}`;
    // progress counts going up / a new objective: an ink stroke underlines it
    const counts = (prog.match(/(\d+)\s*\/\s*\d+/g) ?? []).map((m) => parseInt(m, 10));
    const up = counts.some((c, i) => this.lastCounts[i] !== undefined && c > this.lastCounts[i]);
    const newObj = this.lastObjective !== '' && this.lastObjective !== q.objective;
    if ((up || newObj) && this.state !== 'in') {
      this.strokeT = 0;
      this.ruffle = Math.max(this.ruffle, 0.5);
      uiSfx('page_turn', 0.35, 1.3);
    }
    this.lastCounts = counts;
    this.lastObjective = q.objective;
    if (key === this.inkKey) return;
    // continuous readouts (metres, seconds) redraw at most a few times a second
    if (!force && this.inkAge < 0.25 && w === this.w && h === this.h && !(up || newObj)) return;
    this.inkKey = key;
    this.inkAge = 0;
    const resized = w !== this.w || h !== this.h || fs !== this.fs || !this.base;
    this.w = w;
    this.h = h;
    this.fs = fs;
    const paper = resized || !this.paperCv ? (this.paperCv = notePaper(w, h, this.seed, this.coffee, this.scorch)) : this.paperCv;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d')!;
    c.drawImage(paper, 0, 0);
    let y = PAD + Math.round(3 * u);
    this.progLine = -1;
    for (const l of lines) {
      if (l.kind === 'title') pixelText(c, l.t, w / 2, y, { size: fs, color: '#5c160a', align: 'center' });
      else if (l.kind === 'obj') pixelText(c, l.t, PAD, y, { size: fs, color: '#33200e' });
      else if (l.kind === 'prog') {
        pixelText(c, l.t, PAD + IND, y, { size: fs, color: '#6e1a0a' });
        this.progLine = y;
        this.progW = pixelTextWidth(l.t, fs);
      } else pixelText(c, l.t, PAD, y + 2, { size: fs, color: '#6a5232' });
      y += LH;
      if (l.kind === 'title') y += 1;
    }
    this.base = cv;
    this.dirty = true;
  }
  private paperCv: HTMLCanvasElement | null = null;

  /** the picture as it stands: writing + progress stroke + DONE stamp + burn */
  picture() {
    const animating = (this.strokeT >= 0 && this.strokeT < 0.4) || (this.ending === 'done' && this.stampSl < 1 && this.state === 'stamp') || this.state === 'burn';
    if (!this.dirty && !animating && this.pic) return this.pic;
    this.dirty = false;
    const b = this.base!;
    const cv = this.pic && this.pic.width === b.width && this.pic.height === b.height ? this.pic : document.createElement('canvas');
    cv.width = b.width;
    cv.height = b.height;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.clearRect(0, 0, cv.width, cv.height);
    c.drawImage(b, 0, 0);
    const u = this.fs / 16;
    // the progress stroke: a quick brush underline (a little wobbly, thicker mid-stroke)
    if (this.strokeT >= 0 && this.progLine >= 0) {
      const rev = clamp01(this.strokeT / 0.32);
      const x0 = Math.round(9 * u + 10 * u), x1 = Math.round(x0 + (this.progW + 2 * u) * rev);
      const yb = this.progLine + Math.round(13 * u);
      c.fillStyle = '#6a120c';
      for (let x = x0; x < x1; x++) {
        const f = (x - x0) / Math.max(1, this.progW);
        const yy = yb + Math.round(Math.sin(x * 0.35 + this.seed * 9) * 0.6 + f * 1.2);
        c.fillRect(x, yy, 1, f > 0.15 && f < 0.85 && u > 0.8 ? 2 : 1);
      }
    }
    // the DONE stamp slams down: big and pale, then hard and red; slanted by a shear
    if (this.ending === 'done' && (this.state === 'stamp' || this.stamped || this.state === 'tear')) {
      const st = stampFor(Math.max(10, Math.round(32 * u)));
      const sl = this.state === 'stamp' ? clamp01(this.stampSl) : 1;
      const sc = 1.9 - 0.9 * sl;
      const sw = Math.round(st.width * sc), sh = Math.round(st.height * sc);
      const cx = cv.width * 0.6, cy = cv.height * 0.58;
      const tmp = scratch(sw, sh);
      const tc = tmp.getContext('2d')!;
      tc.clearRect(0, 0, sw, sh);
      tc.imageSmoothingEnabled = false;
      tc.drawImage(st, 0, 0, sw, sh);
      c.globalAlpha = sl < 1 ? 0.35 + 0.4 * sl : 0.95;
      blitShear(c, tmp, cx - sw / 2, cy - sh / 2, (r) => (r - sh / 2) * -Math.tan(this.stampRot));
      c.globalAlpha = 1;
    }
    // the ripped nail hole: a ragged notch where it tore free
    if (this.ripped) {
      const hx = cv.width / 2, hy = Math.round(7 * u);
      c.save();
      c.globalCompositeOperation = 'destination-out';
      for (let y = 0; y < hy + 6 * u; y++)
        for (let x = Math.floor(hx - 7 * u); x < hx + 7 * u; x++) {
          const r = Math.hypot(x - hx, (y - hy) * 1.2);
          if (r < 3.2 * u + h3(x, y, 2) * 2.4 * u || (y < hy && Math.abs(x - hx) < 2 * u + h3(x, y, 3) * 2 * u)) c.fillRect(x, y, 1, 1);
        }
      c.restore();
    }
    // burning: the paper is eaten from a corner, an ember line ahead of the char
    if (this.state === 'burn') {
      const img = c.getImageData(0, 0, cv.width, cv.height);
      const d = img.data;
      const W = cv.width, H = cv.height;
      const front = this.burnP * 1.6 * Math.max(W, H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const k = (y * W + x) * 4;
          if (!d[k + 3]) continue;
          const dd = Math.hypot(x - this.burnO[0] * W, y - this.burnO[1] * H) * 0.85 + fbm01(x * 0.09 + 3, y * 0.09) * 0.32 * Math.max(W, H);
          if (dd < front) d[k + 3] = 0;
          else if (dd < front + 2) {
            const p = h3(x, y, Math.floor(this.st * 12)) > 0.5 ? [255, 208, 112] : [240, 106, 32];
            d[k] = p[0];
            d[k + 1] = p[1];
            d[k + 2] = p[2];
          } else if (dd < front + 6) {
            d[k] = (d[k] * 0.25) | 0;
            d[k + 1] = (d[k + 1] * 0.18) | 0;
            d[k + 2] = (d[k + 2] * 0.14) | 0;
          }
        }
      c.putImageData(img, 0, 0);
    }
    this.pic = cv;
    this.ver++;
    return cv;
  }
  /** composed-picture version (the stack's shaded copies follow it) */
  ver = 0;
  private shadeCv: HTMLCanvasElement | null = null;
  private shadeKey = '';
  /** the picture sunk a little into shadow (a note further down the stack) */
  shaded(depth: number) {
    // notes further down the stack show their paper only: their writing peeking out
    // from under the top note just read as overlapping clutter
    const pic = this.paperCv ?? this.picture();
    const key = this.ver + ':' + depth + ':' + (this.paperCv ? 'paper' : 'ink');
    if (this.shadeCv && this.shadeKey === key) return this.shadeCv;
    const cv = this.shadeCv && this.shadeCv.width === pic.width && this.shadeCv.height === pic.height ? this.shadeCv : document.createElement('canvas');
    cv.width = pic.width;
    cv.height = pic.height;
    const c = cv.getContext('2d')!;
    c.clearRect(0, 0, cv.width, cv.height);
    c.drawImage(pic, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = `rgba(42,22,8,${0.16 + depth * 0.1})`;
    c.fillRect(0, 0, cv.width, cv.height);
    c.globalCompositeOperation = 'source-over';
    this.shadeCv = cv;
    this.shadeKey = key;
    return cv;
  }

  tick(dt: number) {
    this.inkAge += dt;
    if (this.strokeT >= 0) {
      this.strokeT += dt;
      if (this.strokeT >= 0.4) this.dirty = true;
    }
    this.ruffle = Math.max(0, this.ruffle - dt * 2.5);
  }
  markDirty() {
    this.dirty = true;
  }
}

const stamps = new Map<number, HTMLCanvasElement>();
const stampFor = (fs: number) => {
  let s = stamps.get(fs);
  if (!s) stamps.set(fs, (s = stampCanvas(fs)));
  return s;
};
const scratchs = new Map<string, HTMLCanvasElement>();
/** a reusable canvas of exactly w×h (the slamming stamp at its momentary size) */
function scratch(w: number, h: number) {
  const key = w + 'x' + h;
  let o = scratchs.get(key);
  if (!o) {
    o = document.createElement('canvas');
    o.width = w;
    o.height = h;
    scratchs.set(key, o);
    if (scratchs.size > 24) scratchs.delete(scratchs.keys().next().value!);
  }
  return o;
}

// ------------------------------------------------------------------ the stack
export interface PaperAnchor {
  /** the right margin the notes keep to, and the nail height, HUD px */
  right: number;
  y: number;
  /** size factor (small screens) */
  k: number;
  /** compact layout (title + progress only) */
  compact: boolean;
  /** rider speed (m/s): the wind ruffles the note harder */
  speed: number;
}


export class MissionPaper {
  private notes: Note[] = [];
  private scraps: { n: Note; t: number; ox: number; oy: number; vx: number; vy: number }[] = [];
  private nailT = 1;
  private nailShow = 0;
  private dust: PixelFx;
  private glow: PixelFx;
  private t = 0;
  private ended = new Map<string, 'done' | 'fail'>();
  /** bottom edge of the stack, HUD px (the toasts line up under it) */
  bottom = 0;
  /** the nail's x (HUD px): the top note hangs centred on it, clear of the right margin */
  private nailX = -1;

  constructor(private scene: THREE.Scene) {
    this.dust = new PixelFx(300, false, 9);
    this.glow = new PixelFx(300, true, 9);
    scene.add(this.dust.points, this.glow.points);
  }

  /** a quest ended for sure: stamp it DONE (ok) or burn it (failed) */
  end(id: string, ok: boolean) {
    this.ended.set(id, ok ? 'done' : 'fail');
  }

  fx(dt: number, s: number, visible: boolean) {
    this.dust.points.visible = this.glow.points.visible = visible;
    this.dust.update(dt, s);
    this.glow.update(dt, s);
  }

  private nailSprite() {
    return sprite(ART.nail);
  }


  paint(c: CanvasRenderingContext2D, dt: number, quests: PaperQuest[], pa: PaperAnchor, s: number, recent: { text: string; age: number }[]) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const k = pa.k;
    // Alagard stays on whole pixels: full size from k 0.85 up, a hard-edged smaller cut on a phone
    const fs = k >= 0.85 ? 16 : Math.max(10, Math.round(16 * k * 1.1));
    const topW = this.notes.find((n) => !n.ending)?.w ?? 150 * (fs / 16);
    const want = pa.right - (topW / 2 + 2 * k);
    this.nailX = this.nailX < 0 ? want : this.nailX + (want - this.nailX) * Math.min(1, dt * 5);
    const ax = Math.round(this.nailX), ay = Math.round(pa.y);
    // ---------------------------------------------------- sync with the quest list
    for (const q of quests) {
      let n = this.notes.find((x) => x.q.id === q.id && !x.ending);
      if (!n) {
        n = new Note(q);
        n.setQuest(q, pa.compact, fs, true);
        // blown in from off the right edge, tumbling
        n.ox = 90 + Math.random() * 40;
        n.oy = 20 + Math.random() * 30;
        n.vx = -60;
        n.vy = -40;
        n.lean = 0.7 + Math.random() * 0.4;
        n.state = 'in';
        n.st = 0;
        this.notes.unshift(n);
        this.ended.delete(q.id);
        uiSfx('paper_flutter', 0.6, 1.1);
      } else {
        n.missing = 0;
        n.setQuest(q, pa.compact, fs);
      }
    }
    // the tracked quest's note goes to the top of the stack (J / the plaque cycles it)
    const tq = quests.find((q) => q.tracked);
    if (tq) {
      const i = this.notes.findIndex((x) => x.q.id === tq.id && !x.ending);
      const top = this.notes.findIndex((x) => !x.ending);
      if (i > 0 && i !== top) {
        const [n] = this.notes.splice(i, 1);
        this.notes.splice(Math.max(0, top), 0, n);
        n.ruffle = Math.max(n.ruffle, 0.6);
        uiSfx('paper_flutter', 0.35, 1.25);
      }
    }
    for (const n of this.notes) {
      if (n.ending) continue;
      if (quests.some((q) => q.id === n.q.id)) continue;
      n.missing += dt;
      const ex = this.ended.get(n.q.id);
      const hit = recent.find((r) => r.age < 2.5 && (SUCCESS.test(r.text) || FAILURE.test(r.text)));
      const verdict = ex ?? (hit ? (FAILURE.test(hit.text) && !SUCCESS.test(hit.text) ? 'fail' : 'done') : null);
      if (verdict && n.missing > 0.05) this.finish(n, verdict);
      else if (n.missing > 2.5) this.finish(n, 'quiet');
    }
    // ---------------------------------------------------- notes, back to front
    const wind = 0.22 + clamp((pa.speed - 5) / 22, 0, 1) * 1.25;
    let order = 0;
    let bottom = ay;
    const draw: { n: Note; idx: number }[] = [];
    for (const n of this.notes) {
      n.st += dt;
      n.tick(dt);
      const idx = n.ending ? -1 : order++;
      n.angT = idx <= 0 ? -0.03 : idx === 1 ? 0.1 : idx === 2 ? -0.13 : 0.16;
      n.ang += (n.angT - n.ang) * Math.min(1, dt * 5);
      this.advance(n, dt, ax, ay, k);
      if (idx > 2) continue;
      draw.push({ n, idx });
      if (!n.ending) bottom = Math.max(bottom, ay + n.h - 7 * (fs / 16) + 6);
    }
    // back to front: the deepest of the stack first, the newest, then a note being stamped / torn off on top
    draw.sort((a, b) => b.idx - a.idx);
    for (const { n, idx } of draw) if (n.state !== 'gone') this.drawNote(c, n, ax, ay, wind, idx);
    for (let i = this.notes.length - 1; i >= 0; i--) if (this.notes[i].state === 'gone') this.notes.splice(i, 1);
    // ---------------------------------------------------- scraps left on the nail
    for (let i = this.scraps.length - 1; i >= 0; i--) {
      const sc = this.scraps[i];
      sc.t += dt;
      if (sc.t > 2.6) {
        // the wind takes the scrap too
        sc.vx -= 500 * dt;
        sc.vy -= 200 * dt;
        sc.ox += sc.vx * dt;
        sc.oy += sc.vy * dt;
      }
      this.drawScrap(c, sc, ax, ay, wind);
      if (sc.t > 4.5) this.scraps.splice(i, 1);
    }
    // ---------------------------------------------------- the nail, driven through the top note
    const anyPinned = this.notes.some((n) => n.state === 'pinned' || n.state === 'stamp' || n.state === 'burn');
    this.nailShow += ((anyPinned || this.scraps.length ? 1 : 0) - this.nailShow) * Math.min(1, dt * 8);
    this.nailT = Math.min(1, this.nailT + dt / 0.11);
    const nl = { cv: this.nailSprite(), w: this.nailSprite().width };
    if (nl && this.nailShow > 0.05) {
      const drive = this.nailT < 1 ? 1 - this.nailT : 0;
      const sz = nl.w * Math.max(0.2, this.nailShow) * (1 + drive * 0.7);
      blitObj(c, nl.cv, ax, ay - Math.round(drive * 3), 1 + drive * 4, 1, sz, sz);
    }
    this.bottom = bottom;
    void s;
  }

  /** a note hanging from (ax, ay): each row swayed more the further it hangs, the fan a shear about the nail */
  private drawNote(c: CanvasRenderingContext2D, n: Note, ax: number, ay: number, wind: number, idx: number) {
    if (!n.base) return;
    const pic = idx > 0 ? n.shaded(idx) : n.picture();
    const u = n.fs / 16;
    const top = ay - Math.round(7 * u) + Math.round(n.oy);
    const left = ax - n.w / 2 + Math.round(n.ox);
    const flying = n.state === 'in' || n.state === 'tear';
    const amp = (n.state === 'in' ? 1.5 : wind) * 1.6 + n.ruffle * 3 + (n.state === 'tear' ? 5 : 0);
    const tilt = Math.tan(n.ang + n.lean);
    const t = this.t + n.seed * 10;
    const alpha = n.state === 'tear' ? clamp01(1.6 - n.st * 0.8) : 1;
    const sway = (r: number) => {
      const hang = clamp01((r - 7 * u) / Math.max(1, n.h));
      return -(r - 7 * u) * tilt + Math.sin(t * 5.3 + r * 0.16) * amp * Math.pow(hang, 1.3) * (flying ? 1.4 : 1) + Math.sin(t * 8.7 - r * 0.3) * amp * 0.35 * hang * hang;
    };
    // worn paper off the board: its shadow sways with it, further off while it flies (and gone with what burnt)
    const rise = flying ? 9 : 2 + n.ruffle * 3;
    if (n.state === 'burn') {
      const [ox, oy] = shadowOffset(rise);
      blitShear(c, variant(n.base, 'shadow'), left + ox, top + oy, sway, 0.34 * (1 - n.burnP));
      blitShear(c, pic, left, top, sway, alpha);
    } else blitShearObj(c, pic, left, top, sway, alpha, rise, n.base);
  }

  private drawScrap(c: CanvasRenderingContext2D, sc: { n: Note; t: number; ox: number; oy: number }, ax: number, ay: number, wind: number) {
    const n = sc.n;
    const r = n.scrap;
    if (!r || !n.base) return;
    const cv = scrapCanvas(n);
    const u = n.fs / 16;
    blitShearObj(c, cv, ax - r.w / 2 + Math.round(sc.ox), ay - Math.round(7 * u) + Math.round(sc.oy), (row) => Math.sin(this.t * 6 + row * 0.5) * wind * 0.8 * (row / r.h), clamp01(4.5 - sc.t), sc.t > 2.6 ? 8 : 2);
  }

  private advance(n: Note, dt: number, ax: number, ay: number, k: number) {
    const u = n.fs / 16;
    if (n.state === 'in') {
      // springs home to the nail, the lean settling
      n.vx += (-n.ox * 90 - n.vx * 9) * dt;
      n.vy += (-n.oy * 90 - n.vy * 9) * dt;
      n.ox += n.vx * dt;
      n.oy += n.vy * dt;
      n.lean += (0 - n.lean) * Math.min(1, dt * 6);
      if (n.st > 0.5 || (n.st > 0.25 && Math.hypot(n.ox, n.oy) < 6)) {
        // slap! the nail is driven through it
        n.state = 'pinned';
        n.st = 0;
        n.ox = n.oy = n.vx = n.vy = 0;
        n.lean = 0;
        n.ruffle = 1;
        this.nailT = 0;
        uiSfx('poster_slam', 0.55, 1.15);
        uiSfx('rev_hammer', 0.5, 0.6);
        for (let i = 0; i < 14; i++) {
          const ang = Math.random() * TAU, v = 20 + Math.random() * 50;
          this.dust.emit({ x: ax + Math.cos(ang) * 3 * k, y: ay + Math.sin(ang) * 3 * k, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v * 0.6 - 10, ay: 90, drag: 2.5, life: 0.4 + Math.random() * 0.4, size: Math.random() < 0.3 ? 2 : 1, c0: 0xd8c09a, c1: 0x8a7050, alpha: 0.85 });
        }
        for (let i = 0; i < 4; i++) this.glow.emit({ x: ax, y: ay, vx: (Math.random() - 0.5) * 80, vy: -Math.random() * 60, ay: 200, drag: 1, life: 0.25 + Math.random() * 0.15, size: 1, c0: 0xffe8b0, c1: 0xff8a3a, alpha: 1 });
      }
    } else if (n.state === 'stamp') {
      n.stampSl = clamp01(n.st / 0.13);
      if (n.stampSl >= 1 && !n.stamped) {
        n.stamped = true;
        n.ruffle = 1;
        n.markDirty();
        uiSfx('poster_slam', 0.7, 1.35);
        uiSfx('counter_clang', 0.25, 1.6);
        const cx = ax - n.w / 2 + n.w * 0.6, cy = ay - 7 * u + n.h * 0.58;
        for (let i = 0; i < 18; i++) {
          const ang = Math.random() * TAU, v = 30 + Math.random() * 60;
          this.dust.emit({ x: cx + Math.cos(ang) * 14 * k, y: cy + Math.sin(ang) * 6 * k, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v * 0.5, ay: 140, drag: 2, life: 0.35 + Math.random() * 0.3, size: 1, c0: 0xc42a1a, c1: 0x6a0e08, alpha: 0.9 });
        }
      }
      if (n.st > 1.35) this.rip(n);
    } else if (n.state === 'burn') {
      n.burnP = clamp01(n.st / 1.7);
      // embers and smoke off the burning front
      const front = n.burnP * 1.6 * Math.max(n.w, n.h);
      for (let i = 0; i < 3; i++) {
        const ang = Math.random() * TAU;
        const x = n.burnO[0] * n.w + Math.cos(ang) * front, y = n.burnO[1] * n.h + Math.sin(ang) * front;
        if (x < 2 || x > n.w - 2 || y < 2 || y > n.h - 2) continue;
        const sx = ax - n.w / 2 + x, sy = ay - 7 * u + y;
        this.glow.emit({ x: sx, y: sy, vx: (Math.random() - 0.5) * 20 - 10, vy: -25 - Math.random() * 30, ay: -20, drag: 0.8, life: 0.4 + Math.random() * 0.6, size: 1, c0: 0xffd070, c1: 0xff4a10, alpha: 1, flick: 0.6 });
        if (Math.random() < 0.4) this.dust.emit({ x: sx, y: sy, vx: -6 + (Math.random() - 0.5) * 10, vy: -16 - Math.random() * 10, drag: 0.6, life: 0.8 + Math.random() * 0.6, size: 1, size1: 3, c0: 0x4a3a30, c1: 0x2a2420, alpha: 0.45, curl: 5 });
      }
      if (n.st > 1.75) n.state = 'gone';
    } else if (n.state === 'tear') {
      // ripped loose: the wind takes it up and away to the left
      n.vx -= 620 * dt;
      n.vy -= 260 * dt;
      n.ox += n.vx * dt;
      n.oy += n.vy * dt;
      n.lean += dt * 1.6;
      if (n.st > 2.2 || ax + n.ox + n.w < 0 || ay + n.oy + n.h < 0) n.state = 'gone';
    }
  }

  private finish(n: Note, kind: 'done' | 'fail' | 'quiet') {
    n.ending = kind;
    n.st = 0;
    this.ended.delete(n.q.id);
    n.markDirty();
    if (kind === 'done') {
      // the stamp hits the paper's lower right; the pending stroke completes
      n.state = 'stamp';
      n.stampRot = -0.2 - Math.random() * 0.12;
      if (n.strokeT < 0 && n.progLine >= 0) n.strokeT = 0;
    } else if (kind === 'fail') {
      n.state = 'burn';
      n.burnO = [Math.random() < 0.5 ? 0.05 : 0.95, 0.96];
      uiSfx('dynamite_fuse', 0.35, 0.8);
    } else this.rip(n);
  }

  /** the wind rips the note off the nail; a torn scrap stays behind */
  private rip(n: Note) {
    n.state = 'tear';
    n.st = 0;
    n.vx = -40;
    n.vy = -60;
    n.ripped = true;
    n.ruffle = 1;
    n.markDirty();
    uiSfx('paper_flutter', 0.8, 0.95);
    const u = n.fs / 16;
    const sw = Math.max(6, Math.round(n.w * 0.16)), shh = Math.max(6, Math.round(16 * u));
    const sn = new Note(n.q);
    Object.assign(sn, { base: n.base, w: n.w, h: n.h, fs: n.fs, seed: n.seed });
    sn.scrap = { x: Math.round(n.w / 2 - sw / 2), y: 0, w: sw, h: shh };
    this.scraps.push({ n: sn, t: 0, ox: 0, oy: 0, vx: 0, vy: 0 });
  }

  dispose() {
    this.notes = [];
    this.scraps = [];
    this.dust.dispose();
    this.glow.dispose();
    void this.scene;
  }
}

/** the strip of paper left round the nail hole, torn ragged all round */
const scraps = new WeakMap<Note, HTMLCanvasElement>();
function scrapCanvas(n: Note) {
  let cv = scraps.get(n);
  if (cv) return cv;
  const r = n.scrap!;
  cv = document.createElement('canvas');
  cv.width = r.w;
  cv.height = r.h;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(n.base!, -r.x, -r.y);
  const img = c.getImageData(0, 0, r.w, r.h);
  const d = img.data;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const e = Math.min(x, r.w - 1 - x, r.h - 1 - y);
      const k = (y * r.w + x) * 4;
      if (e < 1 + h3(x, y, 7) * 2.2) d[k + 3] = 0;
      else if (e < 2.2 + h3(x, y, 7) * 2.2) {
        d[k] = 42;
        d[k + 1] = 22;
        d[k + 2] = 10;
      }
    }
  c.putImageData(img, 0, 0);
  scraps.set(n, cv);
  return cv;
}
