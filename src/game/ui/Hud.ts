// dustUP HUD — hand-composed pixel art (wood, iron, brass, parchment) on a
// low-res canvas upscaled with nearest-neighbour. Everything animates:
//  • revolver cylinder rotates per shot with motion-blur ghosts, swings out on
//    reload, spits brass casings; Pinch crawls the rim loading rounds and IS
//    the active-reload marker (press R while he's inside the brass arc)
//  • bone-and-blood health with damage trail, shake + flash; boost tail bar
//  • sheriff-star rank badge, coins fly from the world into the gold purse
//  • wave sign swings on chains; boss wanted-banner; ribbon toasts slide in
import { atlas } from '../fx/PixelArt';
import { STATUS_INFO, StatusId } from '../combat/Status';
import { UI, FONT, woodPanel, ironPlate, slot, parchment, ribbon, barFrame, drawBarFill, keycap, starBadge, chain, text, measure, px } from './PixelUI';
import type { PaperQuest } from './MissionPaper';
import type { WeaponHud } from '../player/Weapons';
import type { BulletRowAnchor } from './HudBullets';
import { BossBar, type BossBarState } from './BossBar';
import { pixelText, pixelTextWidth } from './HudSprites';
import { WATCH_DROP, type OutlawAnchors } from './OutlawHud';
import { isTouchDevice } from './TouchControls';
import { SLOT, type ArsenalAnchors } from './ArsenalHud';
import { shadowOffset, variant } from './HudSprites';
import { nine, strip3, type PixelSprite } from './PixelUI';
import { HUD_ART as ART } from './HudArt';
import { text3d, text3dReveal, uiMark, T3D } from './Text3D';
import { blitObj } from './HudSprites';
import { DayPlaque } from './DayPlaque';


/** one quest note on the mission paper stack */
export type HudQuest = PaperQuest;

/** draws pictures into the HUD canvas between the HUD's own base layer and its type (Hud3D, GearHud) */
export interface HudPainter {
  paint(c: CanvasRenderingContext2D, dt: number): void;
}

export interface HudState {
  /** active gun and the carried strip (Weapons.hud) */
  weapon?: WeaponHud;
  /** off-screen markers for revealed X spots, maps and blueprints lying around */
  treasure?: { x: number; y: number; z: number; kind: 'x' | 'blueprint' | 'map' }[];
  hp: number;
  maxHp: number;
  shield: number;
  ammo: number;
  maxAmmo: number;
  venom: number;
  reload: { active: boolean; t: number; window: [number, number]; jam: number; phase: string };
  boost: number;
  speed: number;
  rank: number;
  bountyFrac: number;
  /** bounty collected this hunt (shown as a running count, not a bar) */
  bountyTotal?: number;
  gold: number;
  wave: number;
  waveTime: number;
  waveLabel: string;
  /** the boss on the field (its themed bar, ui/BossBar): phases and theme from Boss.phase / phases / barTheme */
  boss: BossBarState | null;
  /** ultimate charge 0..1 (the XIII card follows it unless `ultCard` is given) */
  ult: number;
  /** the ultimate as a tarot card with its own cooldown (COMBAT); absent: the card follows `ult` */
  ultCard?: { cd: number; max: number; ready?: boolean };
  skills: { key: string; icon: string; cd: number; max: number; charges?: number }[];
  items: { key: string; icon: string; count: number; model?: string }[];
  status: { id: StatusId; stacks: number }[];
  hitMarker: number;
  killMarker: number;
  /** crosshair bloom radius in HUD px (Player.spreadPx) */
  spreadPx?: number;
  /** Player.reticle: hit / kill / head / sticky, 0..1 */
  reticle?: { hit: number; kill: number; head: number; sticky: number };
  combo: number;
  locked: boolean;
  aiming: boolean;
  zone: string;
  /** [T] prompt over an interactable */
  prompt?: { world: { x: number; y: number; z: number }; key: string; text: string } | null;
  /** active mission objective */
  objective?: { text: string; sub: string } | null;
  /** world-space objective marker */
  marker?: { x: number; y: number; z: number } | null;
  /**
   * every quest/mission in hand, newest last (the 3D HUD pins each on the mission
   * paper stack). Without it the stack shows `objective` as a single note.
   */
  quests?: HudQuest[];
  /** seconds left in the break between waves (undefined while a wave runs) */
  intermission?: number;
  /** the break's full length (default 30) */
  intermissionTotal?: number;
  /** 0..1 hold progress of ringing the bell to start the next wave early */
  bell?: number;
  /** Sundown's chest in the world: the soul pours into him when the ultimate is unleashed */
  heroWorld?: { x: number; y: number; z: number } | null;
}

/** a place in the layout another module draws into (Hud.reserveSlot): centre and size, HUD px */
export interface HudSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** the HUD's size factor on small screens */
  k: number;
  visible: boolean;
}

/** where the 3D HUD layer (Hud3D) should place its models, in HUD pixels */
export interface HudAnchors {
  cyl: { x: number; y: number; R: number; rot: number; angVel: number; open: number; recoil: number; shown: number; n: number; venom: number; phase: string; active: boolean; hidden?: boolean };
  coin: { x: number; y: number; pop: number };
  items: { x: number; y: number; size: number; model: string; count: number }[];
  ult: { x: number; y: number; frac: number; ready: boolean };
  heart: { x: number; y: number; frac: number };
  slide: number;
  /** the big 3D rounds standing on the tarot pile (HudBullets) */
  bullets: BulletRowAnchor | null;
  /** tin star, tally board, wave plaque, stopwatch (3D layer) */
  outlaw: OutlawAnchors | null;
  /** long-gun magazines, the carried-guns strip and treasure markers (3D layer) */
  arsenal: ArsenalAnchors | null;
  /** the mission paper: the right margin it keeps and its nail height */
  paper: { right: number; y: number; k: number; compact: boolean; speed: number; heat?: number };
}

interface Toast {
  text: string;
  color: string;
  sub?: string;
  t: number;
  big: boolean;
}
interface HP {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  kind: 'casing' | 'coin' | 'chip' | 'spark' | 'smoke';
  col?: string;
  tx?: number;
  ty?: number;
  sx?: number;
  sy?: number;
  rot?: number;
}

export class Hud {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  scale = 2;
  toasts: Toast[] = [];
  visible = true;
  suppressHint = false;
  private w = 0;
  private h = 0;
  private hint: HTMLDivElement;
  private t = 0;
  private enter = 0; // slide-in transition 0..1
  // cylinder anim
  private cylRot = 0;
  private cylVel = 0;
  private lastAmmo = -1;
  private cylOpen = 0;
  private recoil = 0;
  // health anim
  private hpTrail = 1;
  private hpShake = 0;
  private hpFlash = 0;
  /** 0..1 how hot the fight is right now: notes and toasts sink back out of the way while it is */
  private heat = 0;
  private lastHp = -1;
  // purse
  private goldShown = 0;
  private bountyShown = 0;
  private bountyPop = 0;
  private goldPop = 0;
  private rankPop = 0;
  private lastRank = 1;
  private parts: HP[] = [];
  private signSwing = 0;
  private lastCombo = 0;
  private touch = isTouchDevice();
  private streakPop = 0;
  /** the 3D outlaw pieces' layout, rebuilt each frame */
  private outlawBase: OutlawAnchors = { k: 1, star: { x: 0, y: 0, rank: 1 }, tally: { x: 0, y: 0, amount: 0 }, plaque: null, watch: null };
  private lastWave = 0;
  private waveDrop = 1;
  /** 3D layer draws the cylinder, coin, item models and Pinch idol; 2D skips those */
  use3D = false;
  /** the day plaque and the hourglass (run/Days.ts) own the top centre: the old wave plaque and stopwatch stand down */
  timeHud = false;
  /** last frame's state (read by the 3D layer) */
  last: HudState | null = null;
  /** where the 3D tarot cards sit (HUD px): keycaps + cooldown numbers are drawn under them */
  cardAnchors: { key: string; x: number; y: number; h: number; cd: number }[] = [];
  /** item slots the 3D layer could fill (model exists) — 2D icon is skipped for these */
  items3D: boolean[] = [];
  anchors: HudAnchors = {
    cyl: { x: 0, y: 0, R: 19, rot: 0, angVel: 0, open: 0, recoil: 0, shown: 6, n: 6, venom: 0, phase: '', active: false },
    coin: { x: 0, y: 0, pop: 0 },
    items: [],
    ult: { x: 0, y: 0, frac: 0, ready: false },
    heart: { x: 0, y: 0, frac: 1 },
    slide: 0,
    bullets: null,
    outlaw: null,
    paper: { right: 0, y: 0, k: 1, compact: false, speed: 0 },
    arsenal: null,
  };
  /** recent toasts (the mission paper reads them to tell a finished quest from a failed one) */
  recent: { text: string; sub?: string; at: number }[] = [];
  /** explicit quest endings queued for the mission paper: id -> completed? */
  questEnds = new Map<string, boolean>();
  /** bottom of the mission paper stack (HUD px), set by the 3D layer; toasts line up below it */
  paperBottom = 0;
  /** size factor for the 3D pieces on small screens */
  uiK = 1;
  /** the picture layer (Hud3D's sprites, the gear rack): painted over the frames and bars, under the type */
  painters: HudPainter[] = [];
  /** type and markers that sit on top of the pictures, flushed after the painters */
  private late: (() => void)[] = [];
  /** the boss's themed health bar */
  private bossBar = new BossBar();
  private bossBottom = 0;
  /** bottom of the top-centre cluster (wave plaque / boss bar / hourglass), HUD px: side notes keep below it */
  topClear = 0;
  private promptKey = '';
  private promptT = 9;
  /** the magazine's spot on top of the tarot pile (HUD px) and the pile's size factor */
  private magX = 0;
  private magY = 0;
  private pileK = 1;
  private slots = new Map<string, HudSlot>();
  /**
   * Keep a clean place in the layout for a piece another module draws (TIME's hourglass:
   * `hud.reserveSlot('hourglass')`). The HUD keeps the spot free, updates its centre and size
   * factor every frame (HUD px; css px = HUD px * hud.scale) and, for the hourglass, retires
   * the break stopwatch and its bell hint.
   */
  reserveSlot(id: 'hourglass' | string, w = 44, h = 60): HudSlot {
    let sl = this.slots.get(id);
    if (!sl) this.slots.set(id, (sl = { id, x: 0, y: 0, w, h, k: 1, visible: false }));
    sl.w = w;
    sl.h = h;
    return sl;
  }
  releaseSlot(id: string) {
    this.slots.delete(id);
  }
  /** world -> screen (css px) projector, set by RunScene */
  project: ((p: { x: number; y: number; z: number }) => { x: number; y: number; visible: boolean; behind?: boolean }) | null = null;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'hud';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.hint = document.createElement('div');
    this.hint.className = 'click-hint';
    this.hint.textContent = 'Click to take the reins';
    this.hint.style.display = 'none';
    parent.appendChild(this.hint);
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  resize() {
    this.scale = window.innerWidth > 1800 ? 3 : 2;
    this.w = Math.ceil(window.innerWidth / this.scale);
    this.h = Math.ceil(window.innerHeight / this.scale);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx.imageSmoothingEnabled = false;
  }

  // ------------------------------------------------------------------ API
  toast(t: string, color = UI.text, sub?: string, big = false) {
    this.recent.push({ text: t, sub, at: this.t });
    if (this.recent.length > 12) this.recent.shift();
    // the same message never stacks twice: refresh the live one instead
    const ex = this.toasts.find((x) => x.text === t);
    if (ex) {
      ex.t = Math.min(ex.t, 0.05);
      if (sub) ex.sub = sub;
      return;
    }
    // a new title card replaces the previous one instead of stacking on it
    if (big) this.toasts = this.toasts.filter((x) => !x.big);
    this.toasts.push({ text: t, color, sub, t: 0, big });
    // keep the right-hand column short: at most 3 small toasts at once
    while (this.toasts.filter((x) => !x.big).length > 3) {
      const i = this.toasts.findIndex((x) => !x.big);
      this.toasts.splice(i, 1);
    }
  }
  onShot() {
    this.cylVel = 14;
    this.recoil = 1;
    const cx = Math.round(this.w / 2), cy = this.h - 30;
    for (let i = 0; i < 3; i++) this.parts.push({ kind: 'smoke', x: cx + (Math.random() - 0.5) * 6, y: cy - 22, vx: (Math.random() - 0.5) * 12, vy: -12 - Math.random() * 10, t: 0, life: 0.5 });
  }
  onHurt(amount: number) {
    this.hpShake = Math.min(1, 0.3 + amount / 40);
    this.hpFlash = 1;
  }
  /** a coin/chip flies from a world position into the purse/bounty bar */
  fly(kind: 'coin' | 'chip', world: { x: number; y: number; z: number }) {
    if (!this.project || this.parts.length > 160) return;
    const s = this.project(world);
    if (!s.visible) return;
    const x = s.x / this.scale, y = s.y / this.scale;
    const tx = kind === 'coin' ? 46 : 98, ty = kind === 'coin' ? 33 : 15;
    this.parts.push({ kind, x, y, sx: x, sy: y, tx, ty, vx: (Math.random() - 0.5) * 60, vy: -40 - Math.random() * 40, t: 0, life: 0.55 + Math.random() * 0.2 });
  }
  /** (removed in dispose: the listener would keep the whole finished run alive) */
  private onResize = () => this.resize();
  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.canvas.remove();
    this.hint.remove();
  }
  /** a burst of 2D pixel sparks at a HUD-pixel position (skill cards, pickups) */
  burst(x: number, y: number, cols: string[], n = 24, speed = 90) {
    for (let i = 0; i < n && this.parts.length < 400; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      this.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, t: 0, life: 0.5 + Math.random() * 0.5, col: cols[i % cols.length] });
    }
  }
  setVisible(v: boolean) {
    this.visible = v;
  }
  /** the lowest HUD px of the top-centre cluster (day plaque with its tag and warning, hourglass, boss bar) */
  topCentreBottom() {
    const dp = this.painters.find((p): p is DayPlaque => p instanceof DayPlaque);
    return Math.max(this.topClear, dp?.bottom ?? 0);
  }
  /** a big title card is up (side notes such as the ledger's first-time tips step back for it) */
  get bigToast() {
    return this.toasts.some((t) => t.big);
  }
  /** toasts of the last few seconds with their age (s) */
  recentToasts() {
    return this.recent.map((r) => ({ text: r.text + (r.sub ? ' ' + r.sub : ''), age: this.t - r.at }));
  }
  /** a quest ended: the mission paper stamps it DONE (ok) or burns it (failed) */
  questEnd(id: string, ok = true) {
    this.questEnds.set(id, ok);
  }

  private spr(name: string, x: number, y: number, s = 1, alpha = 1, rot = 0) {
    const f = atlas().get(name);
    const img = atlas().canvas;
    const c = this.ctx;
    const sx = Math.round(f.u0 * img.width - 0.5), sy = Math.round((1 - f.v1) * img.height - 0.5);
    c.globalAlpha = alpha;
    if (rot) {
      c.save();
      c.translate(Math.round(x), Math.round(y));
      c.rotate(rot);
      c.drawImage(img, sx, sy, f.w, f.h, Math.round((-f.w * s) / 2), Math.round((-f.h * s) / 2), f.w * s, f.h * s);
      c.restore();
    } else c.drawImage(img, sx, sy, f.w, f.h, Math.round(x), Math.round(y), f.w * s, f.h * s);
    c.globalAlpha = 1;
  }
  /** a frame, plate, plank or key cap: a physical piece, so it casts a little shadow down-right */
  private blit(cv: HTMLCanvasElement, x: number, y: number, lift = 2) {
    const c = this.ctx;
    if (lift > 0 && this.use3D) {
      const a = c.globalAlpha;
      const [dx, dy] = shadowOffset(lift);
      c.globalAlpha = a * 0.3;
      c.drawImage(variant(cv, 'shadow'), Math.round(x + dx), Math.round(y + dy));
      c.globalAlpha = a;
    }
    c.drawImage(cv, Math.round(x), Math.round(y));
  }
  /** type drawn after the picture layer (so a card, jar or cylinder never covers it) */
  private tl(...a: Parameters<typeof text>) {
    this.late.push(() => text(...a));
  }
  /** a deferred blit / sprite / any draw, after the picture layer */
  private lt(fn: () => void) {
    this.late.push(fn);
  }

  // ------------------------------------------------------------------ cylinder
  private cylCache = new Map<string, HTMLCanvasElement>();
  private cylinderImage(n: number, loaded: boolean[], venom: boolean[], R: number) {
    const key = `${n}:${loaded.map((b) => (b ? 1 : 0)).join('')}:${venom.map((b) => (b ? 1 : 0)).join('')}`;
    let cv = this.cylCache.get(key);
    if (cv) return cv;
    const S = R * 2 + 4;
    cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d')!;
    const cx = S / 2 - 0.5, cy = S / 2 - 0.5;
    const I = UI.iron, B = UI.brass;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = x - cx, dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d > R) continue;
        // flutes between chambers
        const a = Math.atan2(dy, dx) + Math.PI / 2;
        const seg = ((a / (Math.PI * 2)) * n + n + 0.5) % 1;
        const flute = d > R * 0.62 && Math.abs(seg - 0.5) < 0.09;
        const lit = (-dx * 0.6 - dy * 0.8) / R;
        let col = lit > 0.35 ? I.l : lit > -0.2 ? I.m : I.d;
        if (d > R - 1.2) col = I.o;
        else if (d > R - 2.2) col = lit > 0 ? I.h : I.d;
        if (flute) col = d > R - 2 ? I.o : I.d;
        px(c, x, y, 1, 1, col);
      }
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const hx = cx + Math.cos(a) * R * 0.55, hy = cy + Math.sin(a) * R * 0.55;
      const hr = R * 0.24;
      for (let y = -4; y <= 4; y++)
        for (let x = -4; x <= 4; x++) {
          const d = Math.hypot(x, y);
          if (d > hr + 0.3) continue;
          let col = '#0c0a08';
          if (loaded[i]) {
            const ven = venom[i];
            col = d > hr - 1 ? (ven ? UI.venom.d : B.d) : d > hr - 2 ? (ven ? UI.venom.l : B.l) : d < 1.3 ? (ven ? UI.venom.h : B.h) : ven ? UI.venom.m : B.m;
          } else if (d > hr - 1) col = I.o;
          px(c, Math.round(hx + x), Math.round(hy + y), 1, 1, col);
        }
    }
    // center pin
    px(c, Math.round(cx) - 1, Math.round(cy) - 1, 3, 3, I.o);
    px(c, Math.round(cx), Math.round(cy), 1, 1, I.h);
    this.cylCache.set(key, cv);
    if (this.cylCache.size > 64) this.cylCache.delete(this.cylCache.keys().next().value!);
    return cv;
  }

  private drawCylinder(dt: number, s: HudState, cx: number, cy: number) {
    const c = this.ctx;
    const wk = s.weapon?.kind ?? 'cylinder';
    if (wk !== 'cylinder') {
      // a long gun is in hand: the 3D layer shows its shells / drum here instead of the cylinder
      this.anchors.cyl.hidden = true;
      this.anchors.cyl.x = cx;
      this.anchors.cyl.y = cy;
      const w = s.weapon!;
      const lift = Math.round(Math.sin(Math.min(1, w.swap) * Math.PI) * 23);
      if (wk === 'drum') {
        const low = w.ammo <= Math.max(5, w.mag * 0.15);
        this.tl(c, String(w.ammo), cx - 25, cy - 17 + lift, w.reloading ? UI.textDim : low && Math.sin(this.t * 10) > 0 ? UI.blood.h : UI.text, 32, 'right');
        this.tl(c, `/${w.mag}`, cx - 25, cy + 7 + lift, UI.textDim, 16, 'right');
      } else if (!this.use3D) this.tl(c, `${w.ammo}/${w.mag}`, cx, cy - 8, UI.text, 16, 'center');
      if (w.reloading) this.tl(c, 'RELOADING', cx, cy - 46, UI.brass.h, 16, 'center');
      if (!this.use3D) {
        this.tl(c, `${Math.round(s.speed)}`, cx + 38, cy - 6, s.speed > 20 ? UI.brass.h : UI.textDim, 16, 'left');
        this.tl(c, 'm/s', cx + 38, cy + 6, UI.textDim, 16, 'left');
      }
      if (this.anchors.bullets) this.anchors.bullets.hidden = true;
      return;
    }
    this.anchors.cyl.hidden = false;
    const R = this.use3D ? 17 : 19;
    const n = Math.min(9, Math.max(6, s.maxAmmo));
    const rel = s.reload;
    // shot rotation: when ammo drops, rotate one chamber
    if (this.lastAmmo >= 0 && s.ammo < this.lastAmmo) this.cylRot -= ((Math.PI * 2) / n) * (this.lastAmmo - s.ammo);
    this.lastAmmo = s.ammo;
    // spring rotation back to rest with velocity -> motion blur
    const prev = this.cylRot;
    this.cylRot += (0 - this.cylRot) * Math.min(1, dt * 16);
    if (rel.active && (rel.phase === 'close' || rel.phase === 'open')) this.cylRot += dt * 30;
    const angVel = Math.abs(this.cylRot - prev) / Math.max(dt, 1e-3);
    this.cylOpen += ((rel.active ? 1 : 0) - this.cylOpen) * Math.min(1, dt * 10);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    // loaded chambers
    const loaded: boolean[] = [], venom: boolean[] = [];
    let showAmmo = s.ammo;
    if (rel.active) {
      const k = rel.t;
      showAmmo = rel.phase === 'open' ? s.ammo : rel.phase === 'eject' ? 0 : rel.phase === 'insert' ? Math.floor(((k - 0.3) / 0.56) * n) : n;
    }
    for (let i = 0; i < n; i++) {
      loaded.push(i < showAmmo);
      venom.push(i < s.venom);
    }
    const img = this.cylinderImage(n, loaded, venom, R);
    const ox = cx - this.cylOpen * 16, oy = cy - this.cylOpen * 6 + this.recoil * 2;
    // backing plaque
    if (!this.use3D) {
      const plaque = woodPanel(64, 56, 3, { iron: true, dark: true });
      this.blit(plaque, cx - 32, cy - 28);
    }
    // motion blur ghosts
    const signedVel = (this.cylRot - prev) / Math.max(dt, 1e-3);
    this.anchors.cyl = { x: ox, y: oy, R, rot: this.cylRot, angVel: signedVel, open: this.cylOpen, recoil: this.recoil, shown: showAmmo, n, venom: s.venom, phase: rel.active ? rel.phase : '', active: rel.active };
    // the big rounds stand in a row beside the cylinder, on the card pile
    if (this.use3D) {
      const pk = this.pileK;
      this.anchors.bullets = { x: cx + R + 12 * pk, y: cy + R + 2, h: 26 * pk, gap: Math.min(12, 66 / Math.max(1, n - 1)) * pk, n, shown: showAmmo, venom: s.venom, reloading: rel.active, hidden: false };
    } else this.anchors.bullets = null;
    const ghosts = this.use3D ? 0 : Math.min(4, Math.floor(angVel / 4));
    for (let g = ghosts; g >= 1; g--) {
      c.save();
      c.globalAlpha = 0.22;
      c.translate(Math.round(ox), Math.round(oy));
      c.rotate(this.cylRot + g * 0.09 * Math.sign(angVel));
      c.drawImage(img, -img.width / 2, -img.height / 2);
      c.restore();
    }
    if (!this.use3D) {
      c.save();
      c.translate(Math.round(ox), Math.round(oy));
      c.rotate(this.cylRot);
      // fake swing-out: squash horizontally when open
      c.scale(1 - this.cylOpen * 0.18, 1);
      c.drawImage(img, -img.width / 2, -img.height / 2);
      c.restore();
    }
    // reload: brass sweet-spot arc + Pinch crawling the rim (over the cylinder picture)
    if (rel.active) {
      const rr = R + 4;
      const w0 = rel.window[0], w1 = rel.window[1];
      const t = this.t, touch = this.touch, jam = rel.jam, rt = rel.t;
      this.lt(() => {
        for (let i = 0; i <= 60; i++) {
          const f = i / 60;
          const a = -Math.PI / 2 + f * Math.PI * 2;
          const inWin = f >= w0 && f <= w1;
          if (!inWin && i % 3) continue;
          px(this.ctx, Math.round(ox + Math.cos(a) * rr), Math.round(oy + Math.sin(a) * rr), inWin ? 2 : 1, inWin ? 2 : 1, inWin ? (Math.sin(t * 14) > 0 ? UI.brass.h : UI.brass.l) : 'rgba(255,240,200,0.35)');
        }
        const pa = -Math.PI / 2 + rt * Math.PI * 2;
        const pxp = ox + Math.cos(pa) * (rr + 3), pyp = oy + Math.sin(pa) * (rr + 3);
        const frame = Math.floor(t * 14) % 2 ? 'pinchA' : 'pinchB';
        this.spr(frame, pxp, pyp, 1, jam > 0 ? 0.5 + 0.5 * Math.sin(t * 40) : 1, pa + Math.PI / 2);
        const inside = rt >= w0 && rt <= w1;
        // on touch the cylinder itself is the switch: say so instead of showing a key
        if (inside || jam > 0) {
          const bob = inside ? Math.sin(t * 20) : 0;
          if (touch) text(c, 'TAP', ox, oy + R + 7 + bob, UI.brass.h, 16, 'center');
          else {
            const kc = keycap('R');
            this.blit(kc, ox - kc.width / 2, oy + R + 8 + bob);
          }
        }
        if (jam > 0) text(c, 'JAMMED', ox, oy - R - 22, UI.blood.h, 16, 'center');
      });
      // casings eject at start of eject phase
      if (!this.use3D && rel.phase === 'eject' && Math.random() < dt * 30) this.parts.push({ kind: 'casing', x: ox + (Math.random() - 0.5) * 10, y: oy, vx: (Math.random() - 0.5) * 50, vy: -30 - Math.random() * 30, t: 0, life: 1.2, rot: Math.random() * 6 });
    }
    // speed plaque (the 3D HUD sets it by the boost bar)
    if (!this.use3D) {
      this.tl(c, `${Math.round(s.speed)}`, cx + 38, cy - 6, s.speed > 20 ? UI.brass.h : UI.textDim, 16, 'left');
      this.tl(c, 'm/s', cx + 38, cy + 6, UI.textDim, 16, 'left');
    }
  }

  // ------------------------------------------------------------------ frame
  update(dt: number, s: HudState) {
    this.last = s;
    this.t += dt;
    const c = this.ctx;
    const W = this.w, H = this.h;
    c.clearRect(0, 0, W, H);
    this.late.length = 0;
    this.hint.style.display = s.locked || !this.visible || this.suppressHint ? 'none' : 'block';
    this.enter += ((this.visible ? 1 : 0) - this.enter) * Math.min(1, dt * 6);
    if (this.enter < 0.01) return;
    const e = this.enter;
    const slide = (1 - e) * (1 - e);
    this.anchors.slide = slide;
    const cx = Math.round(W / 2);
    // the 3D pieces shrink a little on small screens (phones), never below 60%
    const k = (this.uiK = Math.max(0.6, Math.min(1, W / 560, H / 300)));

    // ---------------------------------------------------------- crosshair
    {
      const cy = Math.round(H / 2);
      const hm = s.hitMarker, km = s.killMarker;
      const rt = s.reticle;
      const head = (rt?.head ?? 0) > 0.05;
      const sticky = rt?.sticky ?? 0;
      // ticks sit on the edge of the real shot cone, with a small punch on hit
      const gap = Math.round(Math.min(22, (s.aiming ? 2 : 3) + (s.spreadPx ?? 0) + (rt?.hit ?? 0) * 2));
      const len = s.aiming ? 3 : 4;
      const col = km > 0 ? UI.blood.h : head ? '#ffffff' : hm > 0 ? UI.brass.h : sticky > 0.5 ? '#ffd9a0' : 'rgba(255,244,216,0.95)';
      for (const [dx, dy, w, h] of [[-gap - len, 0, len, 1], [gap + 1, 0, len, 1], [0, -gap - len, 1, len], [0, gap + 1, 1, len]]) {
        px(c, cx + dx + 1, cy + dy + 1, w, h, 'rgba(20,10,4,0.6)');
        px(c, cx + dx, cy + dy, w, h, col);
      }
      px(c, cx, cy, 1, 1, col);
      if (hm > 0 || km > 0 || head) {
        const k1 = km > 0 ? 8 : head ? 7 : 5;
        const mc = km > 0 ? UI.blood.h : head ? '#ffffff' : UI.brass.h;
        for (let i = 3; i < k1; i++) for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) px(c, cx + sx * i, cy + sy * i, 1, 1, mc);
      }
    }

    // ---------------------------------------------------------- cylinder + rounds
    // the 3D HUD stands the revolver and its rounds on top of the tarot pile (TarotBar's fan,
    // bottom right), keeping the middle of the screen clear for the fight
    const pk = (this.pileK = Math.max(0.48, Math.min(1, W / 620, H / 340)));
    if (this.use3D) {
      this.magX = Math.round(W - 205 * pk + 21) + slide * 200;
      this.magY = Math.round(H - 92 * pk - 19);
      this.drawCylinder(dt, s, this.magX, this.magY);
    } else this.drawCylinder(dt, s, cx, H - 32 + slide * 70);

    // ---------------------------------------------------------- health (bottom left)
    {
      // the 3D beating heart sits left of the bar, so the bar moves over for it
      const x = (this.use3D ? 40 : 8) - slide * 200, y = H - 28;
      if (this.lastHp >= 0 && s.hp < this.lastHp - 0.5) this.onHurt(this.lastHp - s.hp);
      this.lastHp = s.hp;
      const frac = Math.max(0, s.hp / s.maxHp);
      this.hpTrail = this.hpTrail > frac ? Math.max(frac, this.hpTrail - dt * 0.5) : frac;
      this.hpShake = Math.max(0, this.hpShake - dt * 3);
      this.hpFlash = Math.max(0, this.hpFlash - dt * 5);
      const sx = Math.round((Math.random() - 0.5) * 6 * this.hpShake), sy = Math.round((Math.random() - 0.5) * 4 * this.hpShake);
      const bw = 156, bh = 16;
      this.blit(barFrame(bw, bh), x + 18 + sx, y + sy);
      const low = frac < 0.3;
      drawBarFill(c, x + 18 + sx, y + sy, bw, bh, frac, this.hpFlash > 0.5 ? { o: '#fff', d: '#fff', m: '#ffe0d0', l: '#fff', h: '#fff' } : low && Math.sin(this.t * 9) > 0 ? { ...UI.blood, m: '#ff5a3a' } : UI.blood, this.hpTrail);
      if (s.shield > 0) drawBarFill(c, x + 18 + sx, y - 6 + sy, bw, 9, Math.min(1, s.shield / s.maxHp), UI.sky);
      this.anchors.heart = { x: x - (this.use3D ? 16 : 12), y: y + (this.use3D ? 3 : 4), frac };
      if (this.use3D && s.combo > 1) {
        // the kill streak sits above the consumables, crisp and quiet until it climbs
        const col = s.combo >= 25 ? '#ffffff' : s.combo >= 10 ? UI.brass.h : UI.parch.l;
        const bump = Math.round(this.streakPop * 3);
        const sx0 = x + 18, sy0 = y - 60;
        this.lt(() => {
          const w0 = pixelText(c, `x${s.combo}`, sx0, sy0 - bump, { size: 16, color: col, outline: UI.shadow });
          pixelText(c, 'STREAK', sx0 + w0 + 4, sy0, { size: 16, color: UI.textDim, outline: UI.shadow });
        });
      }
      if (s.combo > this.lastCombo) this.streakPop = 1;
      this.lastCombo = s.combo;
      this.streakPop = Math.max(0, this.streakPop - dt * 5);
      if (!this.use3D) this.spr('skullIcon', x - 2 + sx, y - 1 + sy + (low ? Math.round(Math.sin(this.t * 9)) : 0));
      this.tl(c, `${Math.ceil(s.hp)}`, x + 26 + sx, y + 1 + sy, UI.text, 16);
      this.tl(c, `/${Math.round(s.maxHp)}`, x + 26 + measure(c, `${Math.ceil(s.hp)}`) + sx, y + 1 + sy, UI.textDim, 16);
      // boost tail
      const by = y + 18;
      this.blit(barFrame(110, 10), x + 18, by);
      drawBarFill(c, x + 18, by, 110, 10, s.boost, UI.sky);
      this.spr('scorp', x + 130, by + 1);
      if (this.use3D) this.tl(c, `${Math.round(s.speed)} m/s`, x + 146, by - 3, s.speed > 20 ? UI.brass.h : UI.textDim, 16, 'left');
      // statuses
      let stx = x + 182;
      for (const st of s.status) {
        if (st.stacks <= 0) continue;
        const info = STATUS_INFO[st.id];
        this.blit(slot(18, 2), stx, y - 2);
        this.spr(info.icon, stx + 5, y + 3);
        this.tl(c, String(Math.round(st.stacks)), stx + 15, y + 6, info.css, 16);
        stx += 30;
      }
      // consumables above
      let ix = x + 18;
      this.anchors.items.length = 0;
      for (let ii = 0; ii < s.items.length; ii++) {
        const it = s.items[ii];
        this.blit(slot(22, 5), ix, y - 30);
        this.anchors.items.push({ x: ix + 11, y: y - 19, size: 22, model: it.count > 0 ? it.model ?? '' : '', count: it.count });
        if (it.icon && !(this.use3D && this.items3D[ii])) this.spr(it.icon, ix + 7, y - 24);
        if (!this.touch) this.blit(keycap(it.key), ix + 3, y - 42);
        if (it.count > 1) this.tl(c, 'x' + it.count, ix + 14, y - 20, UI.text, 16);
        ix += 28;
      }
    }

    // ---------------------------------------------------------- rank + purse (top left)
    {
      const x = 6 - slide * 160, y = 6;
      if (s.rank !== this.lastRank) {
        this.rankPop = 1;
        this.lastRank = s.rank;
      }
      this.rankPop = Math.max(0, this.rankPop - dt * 2.5);
      if (this.use3D) {
        // the tin star and the nailed tally board (3D layer) — this side only lays them out
        const bt = Math.round(s.bountyTotal ?? 0);
        this.outlawBase.star = { x: x + 16 * k, y: y + 16 * k, rank: s.rank };
        this.outlawBase.tally = { x: x + (37 + BOARD_HALF) * k, y: y + 15 * k, amount: bt, frac: Math.max(0, Math.min(1, s.bountyFrac || 0)) };
      } else {
        const star = starBadge(15);
        const bounce = Math.round(Math.sin(this.rankPop * Math.PI) * 4);
        this.blit(star, x, y - bounce);
        this.tl(c, String(s.rank), x + star.width / 2, y + 8 - bounce, UI.wood.o, 16, 'center', false);
        // the bounty is a purse of reward money, counted up like a wanted poster's figure
        const bt = Math.round(s.bountyTotal ?? 0);
        if (bt > this.bountyShown + 0.5) this.bountyPop = 1;
        this.bountyShown += (bt - this.bountyShown) * Math.min(1, dt * 7);
        if (Math.abs(bt - this.bountyShown) < 0.5) this.bountyShown = bt;
        this.bountyPop = Math.max(0, this.bountyPop - dt * 3);
        this.tl(c, 'BOUNTY', x + 38, y + 1, UI.textDim, 16);
        const lift = Math.round(this.bountyPop * 3);
        this.tl(c, '$' + Math.round(this.bountyShown).toLocaleString('en-US'), x + 38, y + 14 - lift, this.bountyPop > 0.2 ? '#fff3d6' : UI.brass.h, 16);
      }
      // gold purse
      this.goldShown += (s.gold - this.goldShown) * Math.min(1, dt * 8);
      if (Math.abs(s.gold - this.goldShown) < 0.5) this.goldShown = s.gold;
      this.goldPop = Math.max(0, this.goldPop - dt * 4);
      if (this.use3D) {
        const gy = Math.round(y + 38 * k);
        this.anchors.coin = { x: x + 12, y: gy + 6, pop: this.goldPop };
        this.tl(c, String(Math.round(this.goldShown)), x + 22, gy - 1, UI.brass.l, 16);
      } else {
        const gy = y + 30;
        this.anchors.coin = { x: x + 44, y: gy + 6, pop: this.goldPop };
        this.spr('coinBig', x + 38, gy - Math.round(this.goldPop * 3));
        this.tl(c, String(Math.round(this.goldShown)), x + 54, gy - 1, UI.brass.l, 16);
        if (s.combo > 2) this.tl(c, `${s.combo} KILL STREAK`, x + 2, gy + 16, s.combo > 25 ? UI.blood.h : UI.brass.h, 16);
      }
    }

    // ---------------------------------------------------------- wave sign / boss banner (top center)
    if (this.use3D) {
      this.outlawBase.plaque = null;
      this.outlawBase.watch = null;
    }
    if (!s.boss && this.use3D) {
      // the branded leather plaque on its chains (3D layer); the stopwatch hangs under it in the break
      if (s.wave !== this.lastWave) {
        this.lastWave = s.wave;
        this.waveDrop = 0;
      }
      this.waveDrop = Math.min(1, this.waveDrop + dt * 2);
      const drop = (1 - easeOutBounce(this.waveDrop)) * 40 + slide * 70;
      const tl = Math.ceil(s.waveTime);
      const brk = s.intermission !== undefined && s.intermission > 0;
      const py = 8 + 15 * k;
      // (with the day system on, the day plaque (run/Days.ts, ui/DayPlaque) replaces the leather plaque)
      this.outlawBase.plaque = this.timeHud ? null : { x: cx, y: py, label: s.waveLabel, time: tl < 900 ? `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}` : null, drop };
      const glass = this.slots.get('hourglass');
      if (glass) {
        glass.x = cx;
        glass.y = Math.round(py + 14 * k + 8 * k + (glass.h / 2) * k) - drop;
        glass.k = k;
        glass.visible = true;
      }
      this.topClear = glass ? glass.y + Math.round((glass.h / 2) * k) : Math.round(py + 44 * k);
      this.outlawBase.watch = brk && !glass ? { left: s.intermission!, total: s.intermissionTotal ?? 30, bell: s.bell ?? 0 } : null;
      if (brk && !glass) {
        // beside the watch: how to cut the break short
        const wy = Math.round(py + 14 * k + WATCH_DROP * k) - drop;
        const ringing = (s.bell ?? 0) > 0.02;
        // (one line on a phone, where the left side is crowded)
        const small = H < 250;
        const l1 = ringing ? 'RINGING' : this.touch ? 'HOLD THE WATCH' : 'HOLD TO RING', l2 = small && this.touch ? '' : this.touch && !ringing ? 'TO RING THE BELL' : 'THE BELL';
        const ex = Math.round(cx - 28 * k);
        const col = ringing ? UI.brass.h : 'rgba(240,220,180,0.92)';
        if (!this.touch) {
          const kc = keycap('T');
          const kx = ex - Math.ceil(measure(c, l1, 16)) - kc.width - 4;
          this.lt(() => this.blit(kc, kx, wy - 15));
        }
        this.tl(c, l1, ex, wy - 13, col, 16, 'right');
        if (l2) this.tl(c, l2, ex, wy + 1, col, 16, 'right');
      } else if (!glass) this.tl(c, s.zone, cx, Math.round(py + 15 * k + (tl < 900 ? 14 : 3) * k) + 4 - drop, 'rgba(240,220,180,0.85)', 16, 'center');
    } else if (!s.boss) {
      if (s.wave !== this.lastWave) {
        this.lastWave = s.wave;
        this.waveDrop = 0;
        this.signSwing = 0.6;
      }
      this.waveDrop = Math.min(1, this.waveDrop + dt * 2);
      this.signSwing *= Math.exp(-dt * 1.5);
      const drop = Math.round((1 - easeOutBounce(this.waveDrop)) * -40) - slide * 60;
      const sw = Math.round(Math.sin(this.t * 3) * this.signSwing * 4);
      const sgW = 116, sgH = 26;
      const sx = cx - sgW / 2 + sw, sy = 8 + drop;
      chain(c, sx + 12, -2, sy + 1);
      chain(c, sx + sgW - 12, -2, sy + 1);
      this.blit(woodPanel(sgW, sgH, 11, { iron: true }), sx, sy);
      this.tl(c, s.waveLabel, cx + sw, sy + 5, UI.text, 16, 'center');
      const tl = Math.ceil(s.waveTime);
      if (tl < 900) {
        const pw = 84;
        this.blit(parchment(pw, 16, 4), cx - pw / 2 + sw, sy + sgH + 1);
        this.tl(c, `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`, cx + sw, sy + sgH + 2, UI.wood.o, 16, 'center', false);
      }
      this.tl(c, s.zone, cx, sy + sgH + 20, 'rgba(240,220,180,0.85)', 16, 'center');
      this.topClear = sy + sgH + 36;
    } else {
      // the boss's own themed bar (ui/BossBar): segments that crack, phase gems, hit jolts
      this.bossBottom = this.bossBar.paint(c, dt, s.boss, cx, 4 - slide * 60, W);
      const glass = this.slots.get('hourglass');
      if (glass) {
        glass.x = cx;
        glass.y = Math.round(this.bossBottom + 6 + (glass.h / 2) * k);
        glass.k = k;
        glass.visible = true;
      }
      this.topClear = glass ? glass.y + Math.round((glass.h / 2) * k) : this.bossBottom;
    }
    for (const sl of this.slots.values())
      if (sl.id !== 'hourglass') {
        // other reservations stack under the purse on the left
        sl.x = Math.round(8 + sl.w / 2);
        sl.y = Math.round(6 + 60 * k + sl.h / 2);
        sl.k = k;
        sl.visible = true;
      }

    // ---------------------------------------------------------- skills + ultimate (bottom right)
    if (this.use3D) {
      // key caps under the 3D tarot cards and their cooldown figures (cards: TarotBar)
      const ultReady = s.ultCard ? (s.ultCard.ready ?? s.ultCard.cd <= 0) : s.ult >= 1;
      for (const a of this.cardAnchors) {
        if (!this.touch) {
          const kc = keycap(a.key);
          this.lt(() => this.blit(kc, a.x - kc.width / 2, a.y + a.h / 2 + 2, 1));
        }
        if (a.key === 'Z' && ultReady) {
          const bob = Math.round(Math.sin(this.t * 5) * 1.5);
          const col = Math.sin(this.t * 6) > 0 ? '#ffffff' : UI.venom.h;
          const lab = this.touch ? 'TAP' : 'UNLEASH';
          this.lt(() => pixelText(c, lab, a.x, a.y - a.h / 2 - 16 + bob, { size: 16, color: col, align: 'center', outline: UI.shadow }));
        }
        if (a.cd > 0.05 && a.cd < 99) this.tl(c, a.cd < 1 ? a.cd.toFixed(1) : String(Math.ceil(a.cd)), a.x, a.y - 8, UI.text, 16, 'center');
      }
    } else {
      const ux = W - 26 + slide * 200, uy = H - 30;
      // ultimate ring
      const R = 19;
      this.blit(ironPlate(46, 46, 7), ux - 23, uy - 23);
      const ready = s.ult >= 1;
      for (let i = 0; i < 64; i++) {
        const t = i / 64;
        if (t > s.ult) break;
        const a = -Math.PI / 2 + t * Math.PI * 2;
        px(c, Math.round(ux + Math.cos(a) * (R - 2)), Math.round(uy + Math.sin(a) * (R - 2)), 2, 2, ready ? (Math.sin(this.t * 8 + i * 0.3) > 0 ? UI.brass.h : UI.brass.l) : UI.brass.m);
      }
      this.anchors.ult = { x: ux, y: uy, frac: s.ult, ready };
      if (!this.use3D) this.spr('scorp_x2', ux - 8, uy - 8, 1, ready ? 1 : 0.5);
      if (!this.touch) this.blit(keycap('Z'), ux - 7, uy + 20);
      let kx = ux - 52;
      for (let i = s.skills.length - 1; i >= 0; i--) {
        const sk = s.skills[i];
        const sz = 24;
        const x = kx - sz / 2, y = uy - 14;
        this.blit(slot(sz, i + 1), x, y);
        this.spr(sk.icon, x + 8, y + 8, 1, sk.cd > 0 ? 0.45 : 1);
        if (sk.cd > 0) {
          const f = Math.max(0, Math.min(1, sk.cd / sk.max));
          // clockwise sweep
          c.save();
          c.beginPath();
          c.moveTo(x + sz / 2, y + sz / 2);
          c.arc(x + sz / 2, y + sz / 2, sz, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
          c.closePath();
          c.clip();
          px(c, x + 3, y + 3, sz - 6, sz - 6, 'rgba(10,6,3,0.6)');
          c.restore();
          if (sk.cd < 9.5) this.tl(c, sk.cd < 1 ? sk.cd.toFixed(1) : String(Math.ceil(sk.cd)), x + sz / 2, y + 4, UI.text, 16, 'center');
        } else if (Math.sin(this.t * 3 + i) > 0.97) px(c, x + 4, y + 4, 2, 2, UI.brass.h);
        const kc = keycap(sk.key);
        if (!this.touch) this.blit(kc, x + sz / 2 - kc.width / 2, y + sz + 1);
        if (sk.charges !== undefined && sk.charges > 1) this.tl(c, String(sk.charges), x + sz - 4, y - 6, UI.text, 16);
        kx -= 30;
      }
    }

    // ---------------------------------------------------------- objective + marker
    // ---------------------------------------------------------- arsenal: carried guns + treasure (3D layer)
    if (this.use3D) {
      const ar: ArsenalAnchors = { k: 1, x: this.magX, y: this.magY, weapon: s.weapon ?? null, strip: null, markers: [] };
      const car = s.weapon?.carried ?? [];
      if (car.length > 1) {
        const sy = this.magY - 40;
        const slots = car.map((g, i) => ({ x: this.magX + i * SLOT, id: g.id, active: g.id === s.weapon!.id }));
        ar.strip = { x: this.magX + ((car.length - 1) * SLOT) / 2, y: sy, slots };
        if (!this.touch)
          this.lt(() =>
            car.forEach((g, i) => {
              const kc = keycap(g.key);
              this.blit(kc, slots[i].x - kc.width / 2, sy - 23 + (slots[i].active ? -2 : 0));
            })
          );
      }
      if (s.treasure?.length && this.project) {
        const hw = s.heroWorld;
        const list = s.treasure
          .map((t) => ({ t, d: hw ? Math.hypot(t.x - hw.x, t.z - hw.z) : 0 }))
          .sort((a, b) => a.d - b.d)
          .slice(0, 4);
        for (const { t, d } of list) {
          const p = this.project(t);
          let mx = p.x / this.scale, my = p.y / this.scale;
          // the edge frame keeps clear of the trail ledger (left), the bounty bar (top) and the bottom HUD
          const L = 104, R = W - 24, T = 44, Bt = H - 78;
          let edge = !p.visible || mx < L || mx > R || my < T || my > Bt;
          let ang = 0;
          if (edge) {
            let dx = mx - W / 2, dy = my - H / 2;
            if (p.behind) {
              dx = -dx;
              dy = Math.abs(dy) + H;
            }
            ang = Math.atan2(dy, dx);
            const kk = Math.min(dx < 0 ? (L - W / 2) / dx : dx > 0 ? (R - W / 2) / dx : 1e9, dy < 0 ? (T - H / 2) / dy : dy > 0 ? (Bt - H / 2) / dy : 1e9);
            mx = W / 2 + dx * kk;
            my = H / 2 + dy * kk;
            edge = true;
          }
          // never on the day plaque and the hourglass
          if (Math.abs(mx - W / 2) < 170) my = Math.max(my, this.topCentreBottom() + 10);
          ar.markers.push({ x: mx, y: my, kind: t.kind, edge, ang });
          if (hw) this.tl(c, `${Math.round(d)} m`, mx - (edge ? Math.cos(ang) * 8 : 0), my + 14, 'rgba(255,236,190,0.95)', 16, 'center');
        }
      }
      this.anchors.arsenal = ar;
    } else this.anchors.arsenal = null;
    // combat heat: shots flying, a boss up, aiming or a fresh wound
    const hot = s.hitMarker > 0 || s.killMarker > 0 || !!s.boss || s.aiming || this.hpFlash > 0;
    this.heat += ((hot ? 1 : 0) - this.heat) * Math.min(1, dt * (hot ? 6 : 0.7));
    this.anchors.paper = { right: W - 8 + slide * 220, y: 10 * k, k, compact: H < 250 || W < 520, speed: s.speed, heat: this.heat };
    if (s.objective && !this.use3D) {
      const ow = Math.max(150, Math.ceil(Math.max(measure(c, s.objective.text, 16), measure(c, s.objective.sub, 16))) + 20);
      const ox = W - ow - 8 + slide * 200, oy = 8;
      this.blit(parchment(ow, 38, 7), ox, oy);
      this.tl(c, s.objective.text.toUpperCase(), ox + 8, oy + 3, UI.blood.d, 16, 'left', false);
      this.tl(c, s.objective.sub, ox + 8, oy + 19, UI.wood.d, 16, 'left', false);
    }
    // ---------------------------------------------------------- the picture layer, then the type over it
    for (const p of this.painters) p.paint(c, dt);
    for (const f of this.late) f();
    this.late.length = 0;
    // ---------------------------------------------------------- HUD particles
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.kind === 'coin' || p.kind === 'chip') {
        const k = Math.min(1, p.t / p.life);
        const e2 = k * k * (3 - 2 * k);
        // curved path: start -> control (raised) -> target
        const mx = (p.sx! + p.tx!) / 2 + p.vx * 0.3, my = Math.min(p.sy!, p.ty!) - 30 + p.vy * 0.2;
        const x = (1 - e2) * (1 - e2) * p.sx! + 2 * (1 - e2) * e2 * mx + e2 * e2 * p.tx!;
        const y = (1 - e2) * (1 - e2) * p.sy! + 2 * (1 - e2) * e2 * my + e2 * e2 * p.ty!;
        this.spr(p.kind === 'coin' ? 'coinspin' + (Math.floor(p.t * 16) % 4) : 'chip', x - 4, y - 4);
        if (k >= 1) {
          if (p.kind === 'coin') this.goldPop = 1;
          this.parts.splice(i, 1);
        }
        continue;
      }
      p.vy += (p.kind === 'smoke' ? -10 : p.kind === 'spark' ? 120 : 260) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'casing') {
        if (p.y > H - 4) {
          p.y = H - 4;
          p.vy *= -0.35;
          p.vx *= 0.6;
        }
        p.rot! += dt * 14;
        px(c, p.x, p.y, 2, 3, UI.brass.l);
        px(c, p.x, p.y, 2, 1, UI.brass.h);
      } else if (p.kind === 'spark') {
        const a = Math.max(0, 1 - p.t / p.life);
        c.globalAlpha = a;
        px(c, p.x, p.y, 2, 2, p.col ?? UI.brass.h);
        c.globalAlpha = 1;
      } else if (p.kind === 'smoke') {
        const a = 1 - p.t / p.life;
        px(c, p.x, p.y, 3, 3, `rgba(220,210,190,${a * 0.6})`);
      }
      if (p.t > p.life) this.parts.splice(i, 1);
    }

    // ---------------------------------------------------------- interaction prompt
    if (s.prompt && this.project) {
      const p = this.project(s.prompt.world);
      if (p.visible) {
        const x = Math.round(p.x / this.scale), y = Math.round(p.y / this.scale) + Math.round(Math.sin(this.t * 4) * 2);
        // a new prompt pops in with a sweep of light; then it sits still and readable
        const pk = s.prompt.key + s.prompt.text;
        if (pk !== this.promptKey) {
          this.promptKey = pk;
          this.promptT = 0;
        }
        this.promptT += dt;
        const pop = Math.round((1 - Math.min(1, this.promptT / 0.18)) * 4);
        // floating 3D type with its keycap, no plate: it fades in and sits still and readable
        c.globalAlpha = Math.min(1, this.promptT / 0.16);
        if (this.touch) {
          // touch: no key, just the verb (the thing itself is what you touch)
          text3d(c, s.prompt.text || 'TOUCH IT', x, y - 8 - pop, { face: T3D.cream, align: 'center' });
        } else {
          const kc = keycap(s.prompt.key);
          const bw = Math.ceil(pixelTextWidth(s.prompt.text, 16)) + kc.width + 6;
          // the keycap gives a little press now and then, asking to be pressed
          const press = this.promptT % 1.4 < 0.12 ? 1 : 0;
          this.blit(kc, x - bw / 2, y - 9 - pop + press, 1 - press);
          text3d(c, s.prompt.text, x - bw / 2 + kc.width + 6, y - 8 - pop, { face: T3D.cream });
        }
        c.globalAlpha = 1;
      }
    }
    if (s.marker && this.project) {
      const p = this.project(s.marker);
      let mx = p.x / this.scale, my = p.y / this.scale;
      const off = !p.visible;
      if (off) {
        // clamp to the screen edge, pointing toward the target
        const dx = mx - W / 2, dy = my - H / 2;
        const k = Math.min((W / 2 - 16) / Math.max(1, Math.abs(dx)), (H / 2 - 16) / Math.max(1, Math.abs(dy)));
        mx = W / 2 + dx * Math.min(1, k);
        my = H / 2 + dy * Math.min(1, k);
      }
      const bob = Math.round(Math.sin(this.t * 5) * 2);
      const col = Math.sin(this.t * 6) > 0 ? UI.brass.h : UI.brass.l;
      for (let i = 0; i < 6; i++) px(c, Math.round(mx) - 5 + i, Math.round(my) - 10 + bob + i, 11 - i * 2, 1, i === 0 ? UI.wood.o : col);
      px(c, Math.round(mx) - 1, Math.round(my) - 18 + bob, 3, 7, col);
      px(c, Math.round(mx) - 1, Math.round(my) - 8 + bob, 3, 2, col);
    }

    // ---------------------------------------------------------- toasts: floating 3D type, no plates
    // they keep to the right margin under the mission note, live briefly and sink back while the fight is hot
    const heatA = 1 - this.heat * 0.3; // (still easy to read mid-fight)
    let ty = Math.round(Math.max(H * 0.2, this.use3D ? this.paperBottom + 6 : 0));
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const tt = this.toasts[i];
      tt.t += dt;
      // (long enough to read a two-line hint once)
      const life = tt.big ? 2.1 : tt.sub ? 2.6 : 1.5;
      if (tt.t > life) {
        this.toasts.splice(i, 1);
        continue;
      }
      if (tt.big) {
        // big title: drops in high over the action, clear of the rider, as bold 3D type
        const k = Math.min(1, tt.t / 0.4);
        const out = tt.t > life - 0.35 ? (life - tt.t) / 0.35 : 1;
        // below the day plaque (its tag and warning too) and the hourglass, above the rider
        const yy = Math.round(Math.max(H * 0.27, this.topCentreBottom() + 8) + (1 - easeOutBack(k)) * -16);
        c.globalAlpha = out * Math.min(1, k * 2.5) * heatA;
        // the letters pop in one by one; a brass lotus blooms up off the title's left shoulder, a scarab gem
        // hangs off its right foot (an asymmetric pair), both breathing gently while it stays
        const tw2 = pixelTextWidth(tt.text, 32) / 2;
        text3dReveal(c, tt.text, cx, yy, { size: 32, face: T3D.cream, align: 'center', depth: 3 }, tt.t / 0.45);
        const bloom = easeOutBack(Math.min(1, Math.max(0, (tt.t - 0.3) / 0.3)));
        if (bloom > 0) {
          blitObj(c, uiMark('lotus'), cx - tw2 - 12, yy + 2 - bloom * 6 + Math.sin(this.t * 2.2) * 1.2, 2, Math.min(1, bloom));
          blitObj(c, uiMark('gem'), cx + tw2 + 9, yy + 26 + Math.round(Math.sin(this.t * 2.2 + 1.6)), 1, Math.min(1, bloom));
        }
        if (tt.sub && k > 0.6) text3dReveal(c, tt.sub, cx, yy + 34, { face: T3D.gold, align: 'center' }, (tt.t - 0.35) / 0.35);
        c.globalAlpha = 1;
        continue;
      }
      const inK = Math.min(1, tt.t / 0.22);
      const out = tt.t > life - 0.3 ? (life - tt.t) / 0.3 : 1;
      const xr = W - 12 + Math.round((1 - easeOutBack(inK)) * 50);
      c.globalAlpha = out * Math.min(1, inK * 1.6) * heatA;
      // whole words slide in from the right margin (a letter-by-letter reveal read as clipped labels);
      // a little scarab gem ticks it off at the left, winking when it lands
      const tw = text3d(c, tt.text, xr, ty, { face: inkFor(tt.color), align: 'right' });
      const wink = tt.t < 0.45 ? 1 + Math.round(Math.sin(tt.t * 40) * 0.5) : 1;
      blitObj(c, uiMark('gem'), xr - tw - 8, ty + 6 + Math.round(Math.sin(this.t * 3 + i * 1.3) * 0.8), wink, 1);
      // the hint under it keeps to the right margin: a sentence a line, at most three, never across the middle
      const subs = tt.sub ? wrapLines(tt.sub, Math.min(270, Math.round(W * 0.42)), 3) : [];
      subs.forEach((ln, j) => text3d(c, ln, xr - 6, ty + 15 + j * 14, { face: T3D.dim, align: 'right', depth: 1 }));
      c.globalAlpha = 1;
      ty += 18 + subs.length * 14 + 1;
    }
    this.outlawBase.k = k;
    this.anchors.outlaw = this.use3D ? this.outlawBase : null;
    void FONT;
  }
}

/** half the tally board's width (HUD px) — OutlawHud's BOARD_W / 2 */
const BOARD_HALF = 44;

function easeOutBack(t: number) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function easeOutBounce(t: number) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}
/** word wrap to `maxW` HUD px (Alagard 16), each sentence on its own line(s), at most `max` lines (the rest is cut) */
function wrapLines(str: string, maxW: number, max: number) {
  const out: string[] = [];
  for (const sen of str.split(/(?<=[.!?])\s+/)) {
    let cur = '';
    for (const wd of sen.split(/\s+/)) {
      const nx = cur ? cur + ' ' + wd : wd;
      if (cur && pixelTextWidth(nx, 16) > maxW) {
        out.push(cur);
        cur = wd;
      } else cur = nx;
    }
    if (cur) out.push(cur);
  }
  return out.slice(0, max);
}
/** toast type: the toast's own colour, lifted toward the bright UI ramp if it is too dark to read over the sand */
function inkFor(css: string) {
  if (!css.startsWith('#') || css.length < 7) return UI.text;
  const n = parseInt(css.slice(1, 7), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  if (l > 165) return css;
  const k = 190 / Math.max(1, l);
  return `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`;
}

