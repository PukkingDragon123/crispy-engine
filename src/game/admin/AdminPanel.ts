// Admin testing mode: the panel itself. A pixel-art board in the HUD's kit (the wood plank board
// with iron brackets, the torn parchment sheet, bone key caps, the leather track well, hard-pixel
// Alagard), drawn on its own low-resolution canvas and upscaled by whole pixels. Seven tabs: JUMP
// (stage / hero / wave / scenes), MOVE (teleport map, free-fly), CHEAT, GIVE (cards), SPAWN
// (foes, bosses), SAVE (unlocks, reset) and BOSS (HP, phase, named attacks).
//
// Immediate mode: every frame the open tab is drawn and each control leaves a hit box with what it
// does; a pointer released over a box runs it. Lists scroll with the wheel or a drag.
import { nine, sprite, drawSprite, woodPanel, barFrame, drawBarFill, UI, HUD_PAL, SWAP_LIT, SWAP_DIM, type PixelSprite } from '../ui/PixelUI';
import { HUD_ART as ART } from '../ui/HudArt';
import { pixelText, pixelTextWidth } from '../ui/HudSprites';
import { UPGRADES, RARITY, type UpgradeDef } from '../run/Upgrades';
import { ENEMIES } from '../enemies/EnemyDefs';
import { NILE_ARMY } from '../enemies/NileArmyDefs';
import { BOSS_WAVES, BOSS_LIST, areaFor, bossLabel, isMajor, bossMoves, moveTitle } from './AdminData';
import type { AdminMode } from './AdminMode';

export type TabId = 'jump' | 'move' | 'cheat' | 'give' | 'spawn' | 'save' | 'boss';
const TABS: [TabId, string][] = [['jump', 'JUMP'], ['move', 'MOVE'], ['cheat', 'CHEAT'], ['give', 'GIVE'], ['spawn', 'SPAWN'], ['save', 'SAVE'], ['boss', 'BOSS']];

export const INK = '#3a1c0a', RED = '#8a2016', GREEN = '#2e6a18', SOFT = '#6a4a28';
const LIP = '#f6e8c4';
const PAPER = '#efdcb0';

type Tone = 'bone' | 'jade' | 'brass' | 'blood' | 'dim';
const ramp = (to: string) => ({ q: HUD_PAL[to[0]], r: HUD_PAL[to[1]], s: HUD_PAL[to[2]], t: HUD_PAL[to[3]], u: HUD_PAL[to[4]] });
const TONES: Record<Tone, { base?: Record<string, string>; lit?: Record<string, string>; ink: string }> = {
  bone: { lit: SWAP_LIT, ink: INK },
  jade: { base: ramp('FGHIJ'), lit: ramp('GHIJJ'), ink: '#0b3d2c' },
  brass: { base: ramp('fghij'), lit: ramp('ghijj'), ink: INK },
  blood: { base: ramp('ABCDE'), lit: ramp('BCDEE'), ink: '#fff4d8' },
  dim: { base: SWAP_DIM, ink: SOFT },
};

// small authored map markers (HUD palette; '.' clear)
const S = (rows: string[]): PixelSprite => ({ w: rows[0].length, h: rows.length, rows });
const MK_ARROW_N = S(['...k...', '..kJk..', '.kJJJk.', 'kJJIJJk', 'kJIkIJk', 'kIk.kIk', 'kk...kk']);
const MK_ARROW_NE = S(['..kkkkk', '..kJJJk', '...kJJk', '..kJIJk', '.kJIkIk', 'kJIk.kk', 'kkk....']);
const MK_SKULL = S(['.kkkkk.', 'kOOOOOk', 'kOkOkOk', 'kOkOkOk', 'kOOkOOk', '.kOOOk.', '.kNkNk.', '..kkk..']);
const MK_FOE = S(['.kk.', 'kDCk', 'kCBk', '.kk.']);
const MK_CAM = S(['kkkkk', 'kWVWk', 'kV.Vk', 'kWVWk', 'kkkkk']);
const MK_AIM = S(['uu...uu', 'u.....u', '.......', '...D...', '.......', 'u.....u', 'uu...uu']);

interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  fn?: () => void;
  tip?: string;
  /** a scroll region: its key and how far it can scroll */
  scroll?: string;
  max?: number;
  /** a map: clicks report the point */
  map?: (u: number, v: number) => void;
  /** what the control says (automation finds controls by it) */
  label?: string;
}

export class AdminPanel {
  readonly cv = document.createElement('canvas');
  private c: CanvasRenderingContext2D;
  readonly W = 440;
  readonly H = 282;
  s = 2;
  tab: TabId = 'jump';
  private mx = -99;
  private my = -99;
  private hits: Hit[] = [];
  private scroll: Record<string, number> = {};
  private press: { x: number; y: number; hit: Hit | null; region: Hit | null; s0: number; drag: boolean } | null = null;
  private tip = '';
  private t = 0;
  /** the wave box has the keyboard (typing replaces until the first digit) */
  waveFocus = false;
  private waveFresh = true;
  // GIVE / SPAWN filters
  private giveCat = 'all';
  private spawnBosses = false;
  private spawnAlpha = false;
  private spawnCount = 1;
  private spawnTier = 1;
  private mapNear = false;
  private bossIdx = 0;
  private resetArm = 0;
  /** input arrived since the last draw: redraw now rather than on the 30 Hz beat */
  dirty = true;

  constructor(private a: AdminMode) {
    // a small board redrawn often: rasterised on the CPU, uploaded once per redraw
    this.c = this.cv.getContext('2d', { willReadFrequently: true })!;
    this.cv.width = this.W;
    this.cv.height = this.H;
    this.cv.style.cssText = 'position:absolute;pointer-events:auto;image-rendering:pixelated;display:none;touch-action:none;cursor:default';
    const pos = (e: { clientX: number; clientY: number }) => {
      const r = this.cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * this.W, y: ((e.clientY - r.top) / r.height) * this.H };
    };
    this.cv.addEventListener('pointerdown', (e) => {
      this.dirty = true;
      const p = pos(e);
      this.mx = p.x;
      this.my = p.y;
      const region = this.regionAt(p.x, p.y);
      this.press = { x: p.x, y: p.y, hit: this.hitAt(p.x, p.y), region, s0: region ? this.scroll[region.scroll!] ?? 0 : 0, drag: false };
      try {
        this.cv.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable */
      }
      e.preventDefault();
    });
    this.cv.addEventListener('pointermove', (e) => {
      this.dirty = true;
      const p = pos(e);
      this.mx = p.x;
      this.my = p.y;
      const pr = this.press;
      if (pr?.region && Math.abs(p.y - pr.y) > 3) pr.drag = true;
      if (pr?.drag && pr.region) this.scroll[pr.region.scroll!] = clamp(pr.s0 - (p.y - pr.y), 0, pr.region.max ?? 0);
    });
    this.cv.addEventListener('pointerup', (e) => {
      this.dirty = true;
      const p = pos(e);
      const pr = this.press;
      this.press = null;
      if (!pr || pr.drag) return;
      const h = this.hitAt(p.x, p.y);
      if (!h || h !== pr.hit) return;
      if (h.map) h.map(p.x - h.x, p.y - h.y);
      else if (h.fn) {
        this.a.click();
        h.fn();
      }
    });
    this.cv.addEventListener('pointerleave', () => {
      if (!this.press) this.mx = this.my = -99;
    });
    this.cv.addEventListener('wheel', (e) => {
      this.dirty = true;
      const p = pos(e);
      const r = this.regionAt(p.x, p.y);
      if (r) this.scroll[r.scroll!] = clamp((this.scroll[r.scroll!] ?? 0) + e.deltaY * 0.35, 0, r.max ?? 0);
      e.preventDefault();
    }, { passive: false });
  }

  private hitAt(x: number, y: number) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (!h.scroll && x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h;
    }
    return null;
  }
  private regionAt(x: number, y: number) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (h.scroll && x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h;
    }
    return null;
  }
  private over(x: number, y: number, w: number, h: number) {
    return this.mx >= x && this.mx < x + w && this.my >= y && this.my < y + h;
  }

  /** place the board: a whole-pixel scale that fits, right of centre */
  private fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    this.s = Math.max(1, Math.min(3, Math.floor(Math.min((vw - 16) / this.W, (vh - 16) / this.H))));
    const w = this.W * this.s, h = this.H * this.s;
    const key = `${w}:${h}:${vw}:${vh}`;
    if (key === this.fitKey) return;
    this.fitKey = key;
    const st = this.cv.style;
    st.width = w + 'px';
    st.height = h + 'px';
    st.left = Math.round(vw - w > 340 ? vw - w - 16 : (vw - w) / 2) + 'px';
    st.top = Math.round((vh - h) / 2) + 'px';
  }
  private fitKey = '';

  show(on: boolean) {
    this.cv.style.display = on ? 'block' : 'none';
    if (!on) {
      this.waveFocus = false;
      this.press = null;
    }
  }

  // ------------------------------------------------------------------ keyboard (the wave box)
  /** a key while the panel is open; true when the panel used it */
  key(e: KeyboardEvent): boolean {
    this.dirty = true;
    if (this.tab !== 'jump') return false;
    const sel = this.a.sel;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      this.waveFocus = false;
      this.a.go();
      return true;
    }
    if (!this.waveFocus) return false;
    const d = /^(Digit|Numpad)(\d)$/.exec(e.code);
    if (d) {
      const t = this.waveFresh ? d[2] : (String(sel.wave) + d[2]).slice(-3);
      this.waveFresh = false;
      this.a.setWave(+t || 1);
      return true;
    }
    if (e.code === 'Backspace') {
      const t = String(sel.wave).slice(0, -1);
      this.waveFresh = false;
      this.a.setWave(+t || 1);
      return true;
    }
    if (e.code === 'ArrowUp') return this.a.setWave(sel.wave + 1), true;
    if (e.code === 'ArrowDown') return this.a.setWave(sel.wave - 1), true;
    return false;
  }

  // ------------------------------------------------------------------ widgets
  /** a bone key cap button; returns its right edge */
  private btn(x: number, y: number, label: string, fn: (() => void) | null, o: { w?: number; h?: number; tone?: Tone; on?: boolean; tip?: string; disabled?: boolean } = {}) {
    const c = this.c;
    const w = Math.round(o.w ?? pixelTextWidth(label, 16) + 12);
    const h = o.h ?? 16;
    const tone: Tone = o.disabled ? 'dim' : o.on ? 'jade' : o.tone ?? 'bone';
    const T = TONES[tone];
    const hov = !o.disabled && this.over(x, y, w, h);
    const down = hov && !!this.press && !this.press.drag && this.press.hit?.x === x && this.press.hit?.y === y;
    const swap = hov && T.lit ? T.lit : T.base;
    c.drawImage(nine(ART.nine_key, w, h, 5, swap), x, y + (down ? 1 : 0));
    pixelText(c, label, x + w / 2, y - 1 + (down ? 1 : 0) + Math.floor((h - 16) / 2), { size: 16, color: T.ink, align: 'center' });
    if (fn && !o.disabled) this.hits.push({ x, y, w, h, fn, tip: o.tip, label });
    else if (o.tip) this.hits.push({ x, y, w, h, tip: o.tip, label });
    if (hov && o.tip) this.tip = o.tip;
    return x + w;
  }

  private label(s: string, x: number, y: number, col = SOFT, align: 'left' | 'center' | 'right' = 'left') {
    pixelText(this.c, s, x, y, { size: 16, color: col, align, lip: LIP });
    return x + pixelTextWidth(s, 16);
  }

  /** a string cut to fit `w` pixels */
  private fitText(s: string, w: number) {
    if (pixelTextWidth(s, 16) <= w) return s;
    let t = s;
    while (t.length > 1 && pixelTextWidth(t + '..', 16) > w) t = t.slice(0, -1);
    return t + '..';
  }

  /**
   * A scrolling list of `n` rows in `cols` columns. `row` draws one row (hover flag given);
   * `pick` runs on a click; `tip` names the row in the footer.
   */
  private list(key: string, x: number, y: number, w: number, h: number, rowH: number, cols: number, n: number, row: (i: number, rx: number, ry: number, rw: number, hov: boolean) => void, pick: (i: number) => void, tip?: (i: number) => string) {
    const c = this.c;
    const rows = Math.ceil(n / cols);
    const max = Math.max(0, rows * rowH - h);
    const sc = (this.scroll[key] = clamp(this.scroll[key] ?? 0, 0, max));
    this.hits.push({ x, y, w, h, scroll: key, max });
    const cw = Math.floor(w / cols);
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    const r0 = Math.floor(sc / rowH), r1 = Math.min(rows - 1, Math.ceil((sc + h) / rowH));
    for (let r = r0; r <= r1; r++)
      for (let k = 0; k < cols; k++) {
        const i = r * cols + k;
        if (i >= n) break;
        const rx = x + k * cw, ry = Math.round(y + r * rowH - sc);
        const y0 = Math.max(y, ry), y1 = Math.min(y + h, ry + rowH);
        if (y1 <= y0) continue;
        const hov = this.over(rx, y0, cw, y1 - y0);
        row(i, rx, ry, cw, hov);
        this.hits.push({ x: rx, y: y0, w: cw, h: y1 - y0, fn: () => pick(i) });
        if (hov && tip) this.tip = tip(i);
      }
    c.restore();
    // the scroll rail: a leather track and a brass thumb
    if (max > 0) {
      const tx = x + w + 3;
      c.drawImage(nine(ART.nine_track, 7, h, 3), tx, y);
      const th = Math.max(12, Math.round((h * h) / (rows * rowH)));
      const ty = y + Math.round(((h - th) * sc) / max);
      c.fillStyle = HUD_PAL.g;
      c.fillRect(tx + 1, ty, 5, th);
      c.fillStyle = HUD_PAL.i;
      c.fillRect(tx + 1, ty, 5, 1);
      c.fillRect(tx + 1, ty, 1, th);
      c.fillStyle = HUD_PAL.f;
      c.fillRect(tx + 1, ty + th - 1, 5, 1);
    }
  }

  /** a row's hover plate (a lifted slip of fresh paper) */
  private rowPlate(x: number, y: number, w: number, h: number) {
    const c = this.c;
    c.fillStyle = '#fff4d8';
    c.fillRect(x, y, w, h);
    c.fillStyle = '#d6b985';
    c.fillRect(x, y + h - 1, w, 1);
    c.fillRect(x, y, 1, h);
  }

  // ------------------------------------------------------------------ the board
  draw(dt: number) {
    this.dirty = false;
    this.t += dt;
    this.fit();
    const c = this.c, W = this.W, H = this.H;
    this.hits = [];
    this.tip = '';
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, W, H);
    c.drawImage(woodPanel(W, H, 23, { iron: true }), 0, 0);
    // the header: the board's name burned in, the corner switches
    pixelText(c, 'ADMIN', 12, 3, { size: 16, color: '#ffe08a', outline: '#24140a' });
    pixelText(c, 'TESTING MODE', 12 + pixelTextWidth('ADMIN', 16) + 8, 3, { size: 16, color: '#c9a97c', outline: '#24140a' });
    let rx = W - 10;
    rx -= 18;
    this.btn(rx, 4, 'X', () => this.a.close(), { w: 18, tip: 'Close the panel (F1, ` or Esc)' });
    rx -= 4 + pixelTextWidth('FREEZE', 16) + 12;
    this.btn(rx, 4, 'FREEZE', () => (this.a.freeze = !this.a.freeze), { on: this.a.freeze, tip: 'Freeze the game while the panel is open' });
    rx -= 4 + pixelTextWidth('PERF', 16) + 12;
    this.btn(rx, 4, 'PERF', () => this.a.setPerf(!this.a.perfOn), { on: this.a.perfOn, tip: 'Frame rate, draw calls, triangles, render scale and heap (F3)' });
    // the tabs and the sheet
    const tabs: { id: TabId; x: number; w: number; label: string }[] = [];
    let tx = 8;
    for (const [id, label] of TABS) {
      const w = Math.round(pixelTextWidth(label, 16) + 14);
      tabs.push({ id, x: tx, w, label });
      tx += w + 2;
    }
    for (const t of tabs) {
      if (t.id === this.tab) continue;
      const hov = this.over(t.x, 23, t.w, 15);
      c.drawImage(nine(ART.nine_key, t.w, 15, 5, hov ? undefined : SWAP_DIM), t.x, 23);
      pixelText(c, t.label, t.x + t.w / 2, 21, { size: 16, color: hov ? INK : SOFT, align: 'center' });
      this.hits.push({ x: t.x, y: 22, w: t.w, h: 16, fn: () => this.setTab(t.id), label: 'tab:' + t.label });
    }
    c.drawImage(nine(ART.nine_parch, W - 12, H - 58, 8), 6, 38);
    const at = tabs.find((t) => t.id === this.tab)!;
    c.save();
    c.beginPath();
    c.rect(at.x, 20, at.w, 20);
    c.clip();
    c.drawImage(nine(ART.nine_parch, at.w, 22, 8), at.x, 20);
    c.restore();
    c.fillStyle = PAPER;
    c.fillRect(at.x + 2, 38, at.w - 4, 4);
    pixelText(c, at.label, at.x + at.w / 2, 20, { size: 16, color: RED, align: 'center', lip: LIP });
    // the open tab
    switch (this.tab) {
      case 'jump': this.tabJump(); break;
      case 'move': this.tabMove(dt); break;
      case 'cheat': this.tabCheat(); break;
      case 'give': this.tabGive(); break;
      case 'spawn': this.tabSpawn(); break;
      case 'save': this.tabSave(); break;
      case 'boss': this.tabBoss(); break;
    }
    // the footer: the last thing done, else what is under the pointer, else the keys
    const m = this.a.msg;
    const fresh = m.text && this.t - m.at < 3.5;
    const foot = fresh ? m.text : this.tip || 'F1 or ` opens and closes  .  Esc closes  .  F2 free-fly  .  F3 perf';
    c.save();
    c.beginPath();
    c.rect(8, H - 19, W - 16, 18);
    c.clip();
    pixelText(c, this.fitText(foot, W - 22), 11, H - 18, { size: 16, color: fresh ? (m.bad ? '#ff8a6a' : '#9dff5a') : '#fff3d6', outline: '#1a0e06' });
    c.restore();
  }

  setTab(t: TabId) {
    this.tab = t;
    this.waveFocus = false;
  }

  // ------------------------------------------------------------------ JUMP
  private tabJump() {
    const a = this.a, sel = a.sel, W = this.W;
    let y = 46;
    this.label('STAGE', 14, y);
    let x = 62;
    x = this.btn(x, y, 'DUNES', () => (sel.stage = 'desert'), { on: sel.stage === 'desert' }) + 3;
    x = this.btn(x, y, 'NILE', () => (sel.stage = 'nile'), { on: sel.stage === 'nile' }) + 16;
    x = this.label('HERO', x, y) + 6;
    x = this.btn(x, y, 'SUNDOWN', () => (sel.hero = 'sundown'), { on: sel.hero === 'sundown' }) + 3;
    this.btn(x, y, 'MARK', () => (sel.hero = 'mark'), { on: sel.hero === 'mark', tip: 'Mark, the moon-mummy cat' });
    y = 67;
    this.label('WAVE', 14, y);
    x = 62;
    x = this.btn(x, y, '-10', () => a.setWave(sel.wave - 10)) + 2;
    x = this.btn(x, y, '-1', () => a.setWave(sel.wave - 1)) + 3;
    // the wave box: click to type
    const fw = 40;
    const hov = this.over(x, y, fw, 16);
    this.c.drawImage(nine(ART.nine_track, fw, 16, 5, this.waveFocus || hov ? SWAP_LIT : undefined), x, y);
    const caret = this.waveFocus && Math.floor(this.t * 2.5) % 2 === 0 ? '_' : '';
    pixelText(this.c, String(sel.wave) + caret, x + fw / 2 + (caret ? 3 : 0), y - 1, { size: 16, color: '#fff0a6', align: 'center' });
    this.hits.push({ x, y, w: fw, h: 16, fn: () => ((this.waveFocus = !this.waveFocus), (this.waveFresh = true)), tip: 'Click, then type a wave (1 to 100); Enter goes' });
    if (hov) this.tip = 'Click, then type a wave (1 to 100); Enter goes';
    x += fw + 3;
    x = this.btn(x, y, '+1', () => a.setWave(sel.wave + 1)) + 2;
    x = this.btn(x, y, '+10', () => a.setWave(sel.wave + 10)) + 10;
    this.label(`AREA ${areaFor(sel.wave)}`, x, y, INK);
    this.btn(W - 14 - 64, y - 1, 'GO', () => a.go(), { w: 64, h: 18, tone: 'blood', tip: 'Restart the run at this stage, hero and wave' });
    // every boss wave on both stages
    const cw = Math.floor((W - 28 - 18) / 10);
    const grid = (stage: 'desert' | 'nile', y0: number) => {
      BOSS_WAVES.forEach((w, i) => {
        const gx = 14 + (i % 10) * (cw + 2), gy = y0 + Math.floor(i / 10) * 18;
        const on = sel.stage === stage && sel.wave === w;
        const name = bossLabel(stage, w) ?? '';
        this.btn(gx, gy, String(w), () => {
          sel.stage = stage;
          a.setWave(w);
        }, { w: cw, on, tone: isMajor(stage, w) ? 'brass' : 'bone', tip: `${stage === 'nile' ? 'NILE' : 'DUNES'} WAVE ${w}: ${name}${isMajor(stage, w) ? '  (gate boss)' : ''}` });
      });
    };
    this.label('DUNES BOSS WAVES', 14, 88);
    grid('desert', 101);
    this.label('NILE BOSS WAVES', 14, 139);
    grid('nile', 152);
    this.label('SCENES', 14, 191);
    x = 14;
    y = 204;
    x = this.btn(x, y, 'MENU', () => a.scene('menu')) + 3;
    x = this.btn(x, y, 'HIDEOUT', () => a.scene('hub')) + 3;
    x = this.btn(x, y, "THOTH'S HALL", () => a.scene('hall')) + 3;
    x = this.btn(x, y, 'CAVE', () => a.scene('cave'), { tip: 'The Glass Hollow cave stage on its own' }) + 3;
    this.btn(x, y, 'INTRO', () => a.scene('intro'), { tip: 'The opening cinematic and Serket\'s first ride' });
    const lbl = bossLabel(sel.stage, sel.wave);
    this.label(lbl ? `WAVE ${sel.wave}: ${this.fitText(lbl, 250)}` : `WAVE ${sel.wave}: no boss`, 14, 228, lbl ? RED : SOFT);
  }

  // ------------------------------------------------------------------ MOVE
  private tabMove(dt: number) {
    const a = this.a, c = this.c;
    const r = a.run();
    if (!r) {
      this.label('Teleporting works during a run.', this.W / 2, 110, SOFT, 'center');
      this.btn(this.W / 2 - 60, 132, 'RIDE NOW', () => a.go(), { w: 120, tone: 'blood' });
      return;
    }
    const map = a.map;
    const pp = r.player.pos;
    map.update(r.world, pp, this.mapNear, dt);
    const MX = 16, MY = 48, N = map.N;
    c.drawImage(nine(ART.nine_track, N + 8, N + 8, 5), MX - 4, MY - 4);
    c.drawImage(map.cv, MX, MY);
    c.save();
    c.beginPath();
    c.rect(MX, MY, N, N);
    c.clip();
    const on = (x: number, z: number) => {
      const p = map.toMap(x, z);
      return { x: MX + p.u, y: MY + p.v };
    };
    for (const e of r.enemies.list) {
      if (!e.alive) continue;
      const p = on(e.pos.x, e.pos.z);
      drawSprite(c, sprite(MK_FOE), p.x, p.y);
    }
    const shop = r.shop?.nearestShop?.();
    if (shop) {
      const p = on(shop.pos.x, shop.pos.z);
      drawSprite(c, sprite(ART.turtle_house), p.x, p.y);
    }
    for (const b of r.bosses) {
      if (!b.alive || b.escaped) continue;
      const p = on(b.pos.x, b.pos.z);
      if (Math.floor(this.t * 4) % 4 !== 0) drawSprite(c, sprite(MK_SKULL), p.x, p.y);
    }
    if (a.fly.on) {
      const p = on(a.fly.pos.x, a.fly.pos.z);
      drawSprite(c, sprite(MK_CAM), p.x, p.y);
    }
    // the hunter: an arrow on one of eight bearings
    const h = r.player.board.heading;
    const ang = Math.atan2(Math.sin(h), -Math.cos(h));
    const oct = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
    const pm = on(pp.x, pp.z);
    drawSprite(c, sprite(oct % 2 ? MK_ARROW_NE : MK_ARROW_N), pm.x, pm.y, { turns: Math.floor(oct / 2) });
    const hov = this.over(MX, MY, N, N);
    if (hov) drawSprite(c, sprite(MK_AIM), Math.round(this.mx), Math.round(this.my));
    c.restore();
    this.hits.push({ x: MX, y: MY, w: N, h: N, label: 'map', map: (u, v) => {
      const w = map.toWorld(u, v);
      this.a.click();
      a.teleport(w.x, w.z);
    } });
    // the right column
    const X = 192, CW = this.W - 14 - X;
    let y = 46;
    const anyBoss = r.bosses.some((b) => b.alive && !b.escaped);
    this.btn(X, y, 'TO THE BOSS', () => a.tpBoss(), { w: CW, disabled: !anyBoss });
    y += 18;
    this.btn(X, y, 'NEAREST FOE', () => a.tpFoe(), { w: CW, disabled: !r.enemies.list.some((e) => e.alive) });
    y += 18;
    this.btn(X, y, 'TO THE SHOP', () => a.tpShop(), { w: CW, disabled: !shop, tip: 'Gobi the turtle house' });
    y += 18;
    this.btn(X, y, 'ARENA CENTER', () => a.tpArena(), { w: CW, tip: 'The middle of the zone the waves are fought in' });
    y += 22;
    this.btn(X, y, 'FREE-FLY CAMERA', () => a.setFly(!a.fly.on), { w: CW, on: a.fly.on, tip: 'WASD fly, Space / C up and down, Shift fast, drag to look, wheel speed, F2' });
    y += 22;
    const half = Math.floor((CW - 3) / 2);
    this.btn(X, y, 'WHOLE AREA', () => (this.mapNear = false), { w: half, on: !this.mapNear });
    this.btn(X + half + 3, y, 'NEAR', () => (this.mapNear = true), { w: CW - half - 3, on: this.mapNear, tip: '240 m around the hunter' });
    y += 24;
    this.label(`YOU  ${Math.round(pp.x)}, ${Math.round(pp.z)}`, X, y, INK);
    y += 12;
    this.label(this.fitText(r.world.zone.name, CW), X, y, SOFT);
    y += 14;
    if (hov) {
      const w = map.toWorld(this.mx - MX, this.my - MY);
      this.label(`CLICK: GO TO ${Math.round(w.x)}, ${Math.round(w.z)}`, X, y, GREEN);
      y += 12;
      if (r.world.storm.sdf(w.x, w.z) < 0) this.label('INSIDE THE STORM', X, y, RED);
    }
    // the key under the map
    let lx = 16;
    const ly = MY + N + 9;
    const key = (sp: PixelSprite, t: string) => {
      drawSprite(c, sprite(sp), lx + sp.w / 2, ly);
      lx += sp.w + 3;
      lx = this.label(t, lx, ly - 7, SOFT) + 8;
    };
    key(MK_ARROW_N, 'YOU');
    key(MK_FOE, 'FOE');
    key(MK_SKULL, 'BOSS');
    key(ART.turtle_house, 'SHOP');
  }

  // ------------------------------------------------------------------ CHEAT
  private tabCheat() {
    const a = this.a, ch = a.cheats;
    const r = a.run();
    const row = (label: string, y: number) => this.label(label, 14, y);
    let y = 46, x = 74;
    row('HUNTER', y);
    x = this.btn(x, y, 'GOD MODE', () => (ch.god = !ch.god), { on: ch.god, tip: 'No damage of any kind' }) + 3;
    x = this.btn(x, y, 'INFINITE AMMO', () => (ch.infAmmo = !ch.infAmmo), { on: ch.infAmmo }) + 3;
    this.btn(x, y, 'ONE-HIT KILLS', () => a.setOneHit(!a.oneHit), { on: a.oneHit, tip: 'Every shot, swing and skill hits a thousand times harder' });
    y = 64;
    x = 74;
    x = this.btn(x, y, 'HEAL', () => a.heal(), { disabled: !r }) + 3;
    x = this.btn(x, y, '+100 GOLD', () => a.gold(100), { disabled: !r }) + 3;
    x = this.btn(x, y, '+1000 GOLD', () => a.gold(1000), { disabled: !r }) + 3;
    this.btn(x, y, 'FULL ULT', () => a.fullUlt(), { disabled: !r, tip: "Fill Serket's Wrath" });
    y = 88;
    row('RANK', y);
    x = 74;
    x = this.btn(x, y, 'RANK UP', () => a.rankUp(), { disabled: !r, tip: 'One rank: the card picker opens' }) + 3;
    x = this.btn(x, y, 'MAX RANK', () => a.maxRank(), { disabled: !r, tip: 'Straight to rank 50 (no cards dealt)' }) + 3;
    this.btn(x, y, 'CARD PICKER', () => a.cardPicker(), { disabled: !r });
    y = 110;
    row('WAVE', y);
    x = 74;
    x = this.btn(x, y, 'KILL ALL', () => a.killAll(), { disabled: !r, tip: 'Every foe on the field (not the boss)' }) + 3;
    x = this.btn(x, y, 'SKIP WAVE', () => a.skipWave(), { disabled: !r, tip: 'End this wave now (a boss falls too); in the break, start the next' }) + 3;
    this.btn(x, y, 'RING BELL', () => a.ringBell(), { disabled: !r, tip: 'End the intermission early' });
    y = 134;
    row('TIME', y);
    x = 74;
    for (const v of [0.25, 0.5, 1, 2]) x = this.btn(x, y, `${v}x`, () => a.setSpeed(v), { on: a.speed === v, w: 44 }) + 3;
    y = 156;
    row('SCREEN', y);
    x = 74;
    x = this.btn(x, y, 'HIDE HUD', () => a.setHud(!a.hudHidden), { on: a.hudHidden, tip: 'For screenshots: every HUD piece, 2D and 3D' }) + 3;
    x = this.btn(x, y, 'PERF', () => a.setPerf(!a.perfOn), { on: a.perfOn }) + 3;
    this.btn(x, y, 'FREEZE WHILE OPEN', () => (a.freeze = !a.freeze), { on: a.freeze });
    if (!r) {
      this.label('Most of these work during a run.', 14, 186, SOFT);
      return;
    }
    const p = r.player, run = r.run;
    y = 184;
    this.label(`RANK ${run.rank}   GOLD ${Math.round(run.gold)}   WAVE ${r.director.wave}   FOES ${r.enemies.list.filter((e) => e.alive).length}`, 14, y, INK);
    y += 13;
    this.label(`HP ${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}   AMMO ${p.ammo} / ${p.maxAmmo}   ULT ${Math.round(run.ultCharge * 100)}%`, 14, y, INK);
    y += 13;
    this.label(`${r.opts.stage === 'nile' ? 'THE NILE' : 'THE DUNES'}  .  AREA ${r.opts.area}  .  ${r.opts.hero === 'mark' ? 'MARK' : 'SUNDOWN'}  .  SEED ${r.opts.seed}`, 14, y, SOFT);
  }

  // ------------------------------------------------------------------ GIVE
  private giveList(): UpgradeDef[] {
    const cat = this.giveCat;
    return UPGRADES.filter((u) => !u.gamble && (cat === 'all' || (cat === 'tarot' ? !!u.learn : u.cat === cat && !u.learn)));
  }
  private tabGive() {
    const a = this.a, r = a.run();
    const cats: [string, string][] = [['all', 'ALL'], ['tarot', 'TAROT'], ['gun', 'GUN'], ['insect', 'BROOD'], ['passive', 'PASSIVE'], ['gear', 'GEAR'], ['relic', 'RELIC'], ['evolution', 'EVOLVE']];
    let x = 14;
    for (const [id, l] of cats) x = this.btn(x, 45, l, () => ((this.giveCat = id), (this.scroll.give = 0)), { on: this.giveCat === id, w: pixelTextWidth(l, 16) + 8 }) + 2;
    if (!r) {
      this.label('Cards are given during a run.', this.W / 2, 120, SOFT, 'center');
      return;
    }
    const list = this.giveList();
    const up = r.upgrades;
    this.list('give', 14, 66, this.W - 42, 150, 15, 2, list.length, (i, rx, ry, rw, hov) => {
      const d = list[i];
      const lv = up.lv(d.id);
      if (hov) this.rowPlate(rx, ry, rw - 3, 14);
      const c = this.c;
      c.fillStyle = INK;
      c.fillRect(rx + 2, ry + 3, 5, 9);
      c.fillStyle = RARITY[d.rarity].color;
      c.fillRect(rx + 3, ry + 4, 3, 7);
      const lvT = `${lv}/${d.maxLv}`;
      const lw = pixelTextWidth(lvT, 16);
      pixelText(c, this.fitText(d.name, rw - lw - 18), rx + 10, ry - 1, { size: 16, color: lv >= d.maxLv ? SOFT : lv > 0 ? GREEN : INK, lip: LIP });
      pixelText(c, lvT, rx + rw - 6, ry - 1, { size: 16, color: SOFT, align: 'right' });
    }, (i) => a.give(list[i]), (i) => {
      const d = list[i];
      const lv = Math.min(d.maxLv, up.lv(d.id) + 1);
      return `${d.name.toUpperCase()}: ${stripText(d.desc(lv))}`;
    });
    this.label(`${list.length} cards  .  click one to give it a level  .  gambles are left out`, 14, 222, SOFT);
  }

  // ------------------------------------------------------------------ SPAWN
  private foes = Object.values(ENEMIES).sort((p, q) => Number(p.id in NILE_ARMY) - Number(q.id in NILE_ARMY));
  private tabSpawn() {
    const a = this.a, r = a.run();
    let x = 14;
    x = this.btn(x, 45, 'FOES', () => ((this.spawnBosses = false), (this.scroll.spawn = 0)), { on: !this.spawnBosses }) + 2;
    x = this.btn(x, 45, 'BOSSES', () => ((this.spawnBosses = true), (this.scroll.spawn = 0)), { on: this.spawnBosses }) + 12;
    if (!this.spawnBosses) {
      x = this.btn(x, 45, 'ALPHA', () => (this.spawnAlpha = !this.spawnAlpha), { on: this.spawnAlpha, tip: 'Mutated elites' }) + 8;
      for (const n of [1, 3, 10]) x = this.btn(x, 45, `x${n}`, () => (this.spawnCount = n), { on: this.spawnCount === n, w: 30 }) + 2;
    } else for (const t of [1, 2, 3]) x = this.btn(x, 45, `TIER ${t}`, () => (this.spawnTier = t), { on: this.spawnTier === t }) + 2;
    if (!r) {
      this.label('Spawning works during a run.', this.W / 2, 120, SOFT, 'center');
      return;
    }
    if (!this.spawnBosses) {
      const list = this.foes;
      this.list('spawn', 14, 66, this.W - 42, 150, 15, 2, list.length, (i, rx, ry, rw, hov) => {
        const d = list[i];
        if (hov) this.rowPlate(rx, ry, rw - 3, 14);
        const nile = d.id in NILE_ARMY;
        const tag = nile ? 'NILE' : '';
        pixelText(this.c, this.fitText(d.name, rw - 44), rx + 4, ry - 1, { size: 16, color: INK, lip: LIP });
        if (tag) pixelText(this.c, tag, rx + rw - 6, ry - 1, { size: 16, color: '#1f5a6a', align: 'right' });
      }, (i) => a.spawnFoe(list[i].id, this.spawnCount, this.spawnAlpha), (i) => `${list[i].name.toUpperCase()}: ${list[i].title ?? ''}`);
      this.label('Foes land a dozen metres ahead of the camera', 14, 222, SOFT);
    } else {
      const list = BOSS_LIST;
      this.list('spawn', 14, 66, this.W - 42, 150, 15, 2, list.length, (i, rx, ry, rw, hov) => {
        const e = list[i];
        if (hov) this.rowPlate(rx, ry, rw - 3, 14);
        pixelText(this.c, this.fitText(e.label, rw - 44), rx + 4, ry - 1, { size: 16, color: INK, lip: LIP });
        if (e.stage === 'nile') pixelText(this.c, 'NILE', rx + rw - 6, ry - 1, { size: 16, color: '#1f5a6a', align: 'right' });
      }, (i) => a.spawnBoss(list[i], this.spawnTier), (i) => `${list[i].label.toUpperCase()}${list[i].stage === 'nile' ? ': built for the river; best on the Nile stage' : ''}`);
      this.label('The boss walks in with its intro, a few metres ahead', 14, 222, SOFT);
    }
  }

  // ------------------------------------------------------------------ SAVE
  private tabSave() {
    const a = this.a;
    const X = 14, BW = 200;
    let y = 46;
    this.btn(X, y, 'UNLOCK EVERYTHING', () => a.unlockAll(), { w: BW, tone: 'brass', tip: 'The Nile, Mark, the hideout, Thoth\'s Hall, every look, move and plan' });
    y += 20;
    this.btn(X, y, '+5000 BANK', () => a.bank(5000), { w: BW, tip: 'Gold in the bank for the wardrobe and gunsmith' });
    y += 26;
    this.btn(X, y, 'REPLAY NILE + MARK', () => a.replayCards(true), { w: BW, tip: 'The unlock cards for the Nile and Mark drop in again' });
    y += 20;
    this.btn(X, y, 'REPLAY ALL CARDS', () => a.replayCards(false), { w: BW, tip: 'Every unlock card earned so far drops in again, one after another' });
    y += 20;
    this.btn(X, y, 'REPLAY HIDEOUT + HALL', () => a.replayMenuReveals(), { w: BW, tip: 'Back to the menu: the hideout chains fall and Thoth\'s door wakes again' });
    y += 20;
    this.btn(X, y, "REPLAY KHONSU'S FALL", () => a.replayKhonsu(), { w: BW, tip: 'Dunes wave 75 with one-hit kills: his fall plays the Nile and Mark reveal' });
    y += 30;
    const armed = this.t - this.resetArm < 3;
    this.btn(X, y, armed ? 'CLICK AGAIN TO WIPE' : 'RESET SAVE', () => {
      if (armed) a.resetSave();
      else this.resetArm = this.t;
    }, { w: BW, tone: 'blood', tip: 'Wipes every saved thing and reloads the game' });
    y += 20;
    this.btn(X, y, 'FORGET ADMIN HERE', () => a.forget(), { w: BW, tip: 'Typed ADMIN is remembered on this device: this turns that off (the address and admin builds still work)' });
    // what the save holds now
    const st = a.saveStatus();
    let sy = 46;
    const SX = 236;
    for (const [k, v, good] of st) {
      this.label(k, SX, sy, SOFT);
      this.label(v, this.W - 16, sy, good === undefined ? INK : good ? GREEN : RED, 'right');
      sy += 13;
    }
  }

  // ------------------------------------------------------------------ BOSS
  private tabBoss() {
    const a = this.a, r = a.run();
    if (!r) {
      this.label('Boss tools work during a run.', this.W / 2, 120, SOFT, 'center');
      return;
    }
    const bosses = r.bosses.filter((b) => b.alive && !b.escaped);
    if (!bosses.length) {
      this.label('NO BOSS ON THE FIELD', this.W / 2, 92, RED, 'center');
      const w = r.director.wave;
      const lbl = bossLabel(r.opts.stage ?? 'desert', w - (w % 5) || 5);
      this.btn(this.W / 2 - 90, 114, "SPAWN THIS WAVE'S BOSS", () => a.spawnWaveBoss(), { w: 180, tone: 'brass', tip: lbl ? `Calls up ${lbl}` : '' });
      this.label('or call one up from the SPAWN tab', this.W / 2, 140, SOFT, 'center');
      return;
    }
    this.bossIdx = ((this.bossIdx % bosses.length) + bosses.length) % bosses.length;
    const b = bosses[this.bossIdx];
    let y = 45;
    let nx = 14;
    if (bosses.length > 1) {
      nx = this.btn(14, y, '<', () => this.bossIdx--, { w: 16 }) + 3;
      this.btn(this.W - 30, y, '>', () => this.bossIdx++, { w: 16 });
    }
    this.label(this.fitText(b.name.toUpperCase(), 300), nx, y, RED);
    y += 13;
    this.label(this.fitText(b.title, 340), 14, y, SOFT);
    y += 17;
    const c = this.c;
    const BW = this.W - 28;
    c.drawImage(barFrame(BW, 14), 14, y);
    drawBarFill(c, 14, y, BW, 14, Math.max(0, b.frac), UI.blood);
    // the phase thresholds as brass pins on the bar
    for (const th of b.phases) {
      const px = 14 + 7 + Math.round((BW - 14) * th);
      c.fillStyle = HUD_PAL.i;
      c.fillRect(px, y + 1, 1, 12);
      c.fillStyle = HUD_PAL.f;
      c.fillRect(px + 1, y + 1, 1, 12);
    }
    y += 17;
    const nPh = b.phases.length + 1;
    this.label(`HP ${Math.max(0, Math.ceil(b.hp))} / ${Math.round(b.maxHp)}  (${Math.round(Math.max(0, b.frac) * 100)}%)`, 14, y, INK);
    this.label(`PHASE ${b.phase + 1} OF ${nPh}${b.invulnerable ? '  .  SHIELDED' : ''}`, this.W - 16, y, INK, 'right');
    y += 16;
    let x = 14;
    for (let p = 0; p < nPh; p++) x = this.btn(x, y, `PHASE ${p + 1}`, () => a.bossPhase(b, p), { on: b.phase === p }) + 3;
    y += 19;
    x = this.label('HEALTH', 14, y) + 8;
    x = this.btn(x, y, 'FULL', () => a.bossHp(b, 1)) + 2;
    x = this.btn(x, y, '50%', () => a.bossHp(b, 0.5)) + 2;
    x = this.btn(x, y, '10%', () => a.bossHp(b, 0.1)) + 4;
    this.btn(x, y, 'KILL', () => a.bossKill(b), { tone: 'blood' });
    y += 22;
    const moves = bossMoves(b);
    if (moves === null) {
      this.label('This boss has no attack hooks.', 14, y, SOFT);
      this.label('HP and phases still work.', 14, y + 13, SOFT);
      return;
    }
    this.label('ATTACKS', 14, y, INK);
    this.label('queued as its next move', this.W - 16, y, SOFT, 'right');
    y += 14;
    this.list('moves', 14, y, this.W - 40, this.H - 28 - y, 18, 2, moves.length, (i, rx, ry, rw, hov) => {
      const T = TONES.brass;
      this.c.drawImage(nine(ART.nine_key, rw - 4, 16, 5, hov ? T.lit : T.base), rx, ry);
      pixelText(this.c, this.fitText(moveTitle(moves[i]), rw - 14), rx + (rw - 4) / 2, ry - 1, { size: 16, color: INK, align: 'center' });
    }, (i) => a.bossMove(b, moves[i]), (i) => `${moveTitle(moves[i])}  (${moves[i]})`);
  }
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
/** a card line without its markup */
function stripText(s: string) {
  return s.replace(/\s+/g, ' ').trim();
}
