// THE DUST GAZETTE: the pause screen is a big broadsheet newspaper, and the paper is the menu.
// Stylized 2D pixel art on the HUD palette (an aged newsprint sheet, ink rules, authored ornaments),
// set with Alagard at its own size so the type stays crisp at any scale:
//  - THE FRONT PAGE: a headline written from the run (wave, kills, gold, bounty rank, time on the
//    trail), a photograph from the run itself (the paused scene, shot through the run camera and
//    printed as a sepia halftone plate) and a short article under it
//  - THE TINKER'S COLUMN: the settings as the column's own sliders (an ink rail and a brass knob)
//  - CLASSIFIEDS: the on/off settings as small ads with a box to tick
//  - COUPONS: RESUME is a coupon you clip (the dashes march under the scissors, a click snips it
//    out); GIVE UP THE HUNT is an obituary; the rest are small coupons
//  - ADS: Ozymandias's trading post and the gunsmith, with plates photographed from the game's own
//    models (IconFactory), and a coffee-gum ad
// The sheet drops in and settles calmly (one soft spring, no flapping), and slides away when done.
// Used by the run and the cave (Hud3D.showPause) and by the menu's SETTINGS sign.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import { IconFactory } from './IconFactory';
import { buildRigGeo, RigInstance, type RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { modelEntry } from '../models/lookup';
import { sprite, type PixelSprite } from './PixelUI';
import { getSettings, setSetting, type GameSettings } from './Settings';
import { loadSave } from '../meta/Save';
import { resetTutor } from './TouchTutor';

export interface GazetteAction {
  label: string;
  fn: () => void;
}

const PW = 420, PH = 300;
const INK = '#21140b', INK2 = '#4a3320', RED = '#8a2016', FADE = '#6e5a40';
const FONT = 'Alagard';

const S = (rows: string[]): PixelSprite => ({ w: rows[0].length, h: rows.length, rows });
// ink ornaments ('k' is printed in the sheet's ink)
const SUN_WINGS = S([
  '..........kkkkk..........',
  'kkkkk....kkkkkkk....kkkkk',
  '.kk.kkk.kkkkkkkkk.kkk.kk.',
  '..kkk.kkkkk.k.kkkkk.kkk..',
  '....kkk.kkk.k.kkk.kkk....',
  '.......kk.kkkkk.kk.......',
  '..........k...k..........',
]);
const SCISSORS = S([
  '.kkk.........',
  'k...k.....kkk',
  'k...kk..kk...',
  '.kkk..kk.....',
  '......kk.....',
  '.kkk..kk.....',
  'k...kk..kk...',
  'k...k.....kkk',
  '.kkk.........',
]);
const SKULL = S([
  '..kkkkk..',
  '.k.....k.',
  'k.......k',
  'k.kk.kk.k',
  'k.kk.kk.k',
  '.k..k..k.',
  '..k...k..',
  '..k.k.k..',
  '...kkk...',
]);
const FLEURON = S(['..k...k..', '.k.k.k.k.', 'kk..k..kk', '.k.k.k.k.', '..k...k..']);
const KNOB = S(['..kkk..', '.kijik.', 'kijjihk', 'kiiihgk', 'khihggk', '.kgggk.', '..kkk..']);
const INK_SWAP = { k: INK };

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const hash = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
  fn?: () => void;
  /** a slider: the rail's x and width */
  rail?: [number, number];
}

interface Slider {
  key: 'master' | 'music' | 'sfx' | 'voice' | 'sens';
  label: string;
  min: number;
  max: number;
  show: (v: number) => string;
}
const SLIDERS: Slider[] = [
  { key: 'master', label: 'ALL SOUND', min: 0, max: 1, show: (v) => `${Math.round(v * 100)}` },
  { key: 'music', label: 'MUSIC', min: 0, max: 1, show: (v) => `${Math.round(v * 100)}` },
  { key: 'sfx', label: 'GUNS & DUST', min: 0, max: 1, show: (v) => `${Math.round(v * 100)}` },
  { key: 'voice', label: 'VOICES', min: 0, max: 1, show: (v) => `${Math.round(v * 100)}` },
  { key: 'sens', label: 'MOUSE SPEED', min: 0.2, max: 3, show: (v) => `x${v.toFixed(1)}` },
];

export class PauseGazette {
  private static inst: PauseGazette | null = null;
  /** the one newspaper (built on first use) */
  static get(): PauseGazette {
    return (this.inst ??= new PauseGazette());
  }

  readonly root = document.createElement('div');
  private cv = document.createElement('canvas');
  private c: CanvasRenderingContext2D;
  private paper: HTMLCanvasElement | null = null;
  private photo: HTMLCanvasElement | null = null;
  private ads: (HTMLCanvasElement | null)[] = [null, null];
  private icons: IconFactory | null = null;
  shown = false;
  private actions: GazetteAction[] = [];
  private mode: 'run' | 'menu' = 'run';
  private hits: Hit[] = [];
  private mx = -99;
  private my = -99;
  private hot = '';
  private drag: Hit | null = null;
  private stamp: Record<string, number> = {};
  private snip: { id: string; t: number; fn: () => void } | null = null;
  private s = 2;
  private dpr = 1;
  private t = 0;
  /** the drop-in spring: position 0 (above the screen) .. 1 (settled) */
  private k = 0;
  private kv = 0;
  private leaving = false;
  private raf = 0;
  private last = 0;
  private story = { head: [''], sub: '', body: '', caption: '', dateline: '', issue: '' };

  private constructor() {
    this.root.style.cssText = 'position:fixed;inset:0;z-index:30;display:none;background:rgba(14,8,4,0);transition:background .35s;touch-action:none';
    this.cv.style.cssText = 'position:absolute;left:50%;top:50%;image-rendering:pixelated;touch-action:none;filter:drop-shadow(0 10px 0 rgba(18,10,4,.45))';
    this.root.appendChild(this.cv);
    this.c = this.cv.getContext('2d')!;
    const pos = (e: PointerEvent) => {
      const r = this.cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * PW, y: ((e.clientY - r.top) / r.height) * PH };
    };
    this.cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const p = pos(e);
      this.mx = p.x;
      this.my = p.y;
      const h = this.hitAt(p.x, p.y);
      if (!h || this.leaving || this.snip) return;
      if (h.rail) {
        this.drag = h;
        this.slide(h, p.x);
        try {
          this.cv.setPointerCapture(e.pointerId);
        } catch {
          /* not capturable */
        }
      } else if (h.fn) h.fn();
    });
    this.cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      this.mx = p.x;
      this.my = p.y;
      if (this.drag) this.slide(this.drag, p.x);
    });
    const up = () => {
      if (this.drag) this.sfx('ui_click', 0.25, 1.3);
      this.drag = null;
    };
    this.cv.addEventListener('pointerup', up);
    this.cv.addEventListener('pointercancel', up);
    this.cv.addEventListener('pointerleave', () => {
      if (!this.drag) this.mx = this.my = -99;
    });
    // a click on the table around the sheet: from the menu it folds the paper away
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root && this.mode === 'menu' && this.shown && !this.leaving) this.actions[0]?.fn();
    });
    for (const ev of ['mousedown', 'mouseup', 'click', 'wheel', 'contextmenu'])
      this.root.addEventListener(ev, (e) => {
        e.stopPropagation();
        if (ev === 'contextmenu') e.preventDefault();
      });
    window.addEventListener('resize', () => this.shown && this.fit());
  }

  private get eng(): Engine | null {
    return ((window as unknown as { __engine?: Engine }).__engine ?? null) as Engine | null;
  }
  private sfx(name: string, volume = 0.5, pitch = 1) {
    try {
      this.eng?.audio.play(name, { volume, pitch });
    } catch {
      /* no audio */
    }
  }

  /** open (with the actions printed as coupons) or fold it away; true when it took the pause screen */
  show(open: boolean, actions?: GazetteAction[], mode: 'run' | 'menu' = 'run'): boolean {
    if (!open) {
      if (this.shown && !this.leaving) {
        this.leaving = true;
        this.root.style.background = 'rgba(14,8,4,0)';
        this.sfx('paper_flutter', 0.45, 1.15);
      }
      return true;
    }
    this.mode = mode;
    this.actions = actions ?? [];
    this.leaving = false;
    this.snip = null;
    this.drag = null;
    this.stamp = {};
    if (!this.root.isConnected) document.body.appendChild(this.root);
    if (!this.shown) {
      this.k = 0;
      this.kv = 0;
    }
    this.shown = true;
    this.root.style.display = 'block';
    requestAnimationFrame(() => (this.root.style.background = 'rgba(14,8,4,0.5)'));
    try {
      this.writeStory();
      this.shoot();
    } catch (e) {
      console.warn('[gazette] story / photo', e);
    }
    this.fit();
    if (!this.raf) {
      this.last = performance.now();
      const loop = () => {
        this.raf = 0;
        if (!this.shown) return;
        const now = performance.now();
        const dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.frame(dt);
        if (this.shown) this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }
    return true;
  }

  private fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const f = Math.min((vw * 0.96) / PW, (vh * 0.95) / PH);
    // whole steps where there is room (crisp ornaments), a fraction on small screens
    this.s = f >= 2 ? Math.floor(f * 2) / 2 : Math.max(0.75, f);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(PW * this.s), h = Math.round(PH * this.s);
    this.cv.width = Math.round(w * this.dpr);
    this.cv.height = Math.round(h * this.dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
  }

  // ------------------------------------------------------------------ the news
  private writeStory() {
    const cur = this.eng?.current as unknown as { run?: { wave: number; kills: number; gold: number; rank: number; time: number; totalGold: number }; director?: { wave: number }; opts?: { seed?: number } } | null;
    const sv = loadSave();
    const issue = `VOL. XI  .  NO. ${sv.runs + 1}`;
    if (this.mode === 'menu' || !cur?.run) {
      this.story = {
        issue,
        dateline: `SPECIAL EDITION  .  ${sv.runs} RIDES ON RECORD  .  BEST WAVE ${sv.bestWave}  .  ${sv.bank} GOLD IN THE BANK`,
        head: ['SCORPION-MAN SEEN', 'CLEANING HIS IRON', 'AT THE OLD RUINS'],
        sub: 'Four arms, one cloth, no hurry',
        caption: 'Our plate of the hunter at his camp, taken at dusk.',
        body: 'The four-armed bounty hunter the camps call Sundown was found at the ruined cantina, polishing his revolver and blowing the sand from its cylinder. Asked about the dunes, he spun the cylinder and said nothing. A little scorpion on his shoulder appeared to answer for him. Readers are advised to set their dials below before riding out.',
      };
      return;
    }
    const r = cur.run;
    const w = Math.max(1, cur.director?.wave ?? r.wave ?? 1);
    const mins = Math.floor(r.time / 60), secs = Math.floor(r.time % 60);
    const seed = (cur.opts?.seed ?? 7) + w;
    const pick = <T,>(a: T[]) => a[Math.abs(Math.floor(seed * 7.31)) % a.length];
    let head: string[];
    if (r.kills >= 150) head = ['UNDERTAKERS STRIKE', `AS ${r.kills} FALL TO`, 'FOUR-ARMED GUNMAN'];
    else if (w >= 25) head = [`STILL RIDING AT`, `WAVE ${w}: THE SAND`, 'FILES A COMPLAINT'];
    else if (r.gold >= 400) head = ['BANKERS FAINT AS', `HUNTER HOARDS ${Math.round(r.gold)}`, 'GOLD IN HIS BOOTS'];
    else
      head = pick([
        [`${r.kills} OUTLAWS`, 'PAINTED BLACK BY', 'MYSTERY RIDER'],
        ['SCORPION-MAN', `TEARS UP WAVE ${w}`, 'ON A SANDBOARD'],
        ['DUNES GIVE NO', 'SATISFACTION TO', 'THE DEAD TONIGHT'],
        ['WHO RIDES THE', 'STORM? NOBODY', 'BUT THIS MAN'],
      ]);
    this.story = {
      issue,
      dateline: `EXTRA!  .  WAVE ${w}  .  ${Math.round(r.gold)} GOLD  .  BOUNTY RANK ${r.rank}  .  ${mins}:${String(secs).padStart(2, '0')} ON THE TRAIL`,
      head,
      sub: `"${r.kills} down and the day is young," says the hunter`,
      caption: `Our correspondent's plate, wave ${w}, taken from behind a dune.`,
      body: `The four-armed hunter was sighted at wave ${w}, ${mins} minutes out on the trail, with ${r.kills} kills to his name and a bounty rank of ${r.rank}. ${Math.round(r.totalGold)} gold has passed through his saddlebags so far. Witnesses describe a little scorpion on his shoulder whispering to him between the volleys. The editors advise readers to keep their heads down until he rides on.`,
    };
  }

  /** the photograph: the paused scene through its own camera, printed as a sepia halftone plate */
  private shoot() {
    const eng = this.eng;
    const cur = eng?.current as { scene?: THREE.Scene; camera?: THREE.Camera } | null;
    if (!eng || !cur?.scene || !cur.camera) return;
    const R = eng.renderer;
    const W = 288, H = 168;
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
    const cam = cur.camera as THREE.PerspectiveCamera;
    const keepAspect = cam.aspect;
    const prev = R.getRenderTarget();
    try {
      if (cam.isPerspectiveCamera) {
        cam.aspect = W / H;
        cam.updateProjectionMatrix();
      }
      R.setRenderTarget(rt);
      R.clear();
      R.render(cur.scene, cam);
      const px = new Uint8Array(W * H * 4);
      R.readRenderTargetPixels(rt, 0, 0, W, H, px);
      this.photo = halftone(px, W, H, 2);
    } catch (e) {
      console.warn('[gazette] photo failed', e);
    } finally {
      R.setRenderTarget(prev);
      if (cam.isPerspectiveCamera) {
        cam.aspect = keepAspect;
        cam.updateProjectionMatrix();
      }
      rt.dispose();
    }
    // the ad plates: the game's own models in the IconFactory studio, printed in ink
    if (!this.ads[0] || !this.ads[1]) {
      this.icons ??= new IconFactory(R);
      const plate = (keys: string[], w: number, h: number, yaw: number) => {
        for (const k of keys) {
          try {
            const e = modelEntry(k)?.();
            if (!e) continue;
            const obj = toObject(e);
            if (!obj) continue;
            const cvs = this.icons!.capture(obj, { w, h, yaw, pitch: 0.25, fill: 0.86, ink: '#1a0e08', levels: 5, light: 'studio' });
            return inkPrint(cvs);
          } catch {
            /* next */
          }
        }
        return null;
      };
      this.ads[0] ??= plate(['revolver_standard', 'item_dagger'], 56, 34, -1.35);
      this.ads[1] ??= plate(['item_whiskey', 'bottle', 'item_snakeoil'], 30, 38, 0.5);
    }
  }

  // ------------------------------------------------------------------ per frame
  private frame(dt: number) {
    this.t += dt;
    // one calm spring in, a slide out
    if (this.leaving) {
      this.kv -= dt * 7;
      this.k += this.kv * dt;
      if (this.k < -0.15) {
        this.shown = false;
        this.leaving = false;
        this.root.style.display = 'none';
        return;
      }
    } else {
      const w = 8.5, z = 0.82;
      const a = -2 * z * w * this.kv - w * w * (this.k - 1);
      this.kv += a * dt;
      this.k += this.kv * dt;
    }
    if (this.snip) {
      this.snip.t += dt;
      if (this.snip.t > 0.32) {
        const fn = this.snip.fn;
        this.snip = null;
        fn();
      }
    }
    const lift = (1 - this.k) * (PH * this.s * 0.9 + 60);
    const rot = (1 - clamp(this.k, 0, 1.2)) * -2.2;
    this.cv.style.transform = `translate(-50%, -50%) translateY(${-lift.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`;
    this.draw();
  }

  private hitAt(x: number, y: number) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h;
    }
    return null;
  }
  private over(x: number, y: number, w: number, h: number) {
    return this.mx >= x && this.mx < x + w && this.my >= y && this.my < y + h;
  }

  private slide(h: Hit, x: number) {
    const sl = SLIDERS.find((s) => 's:' + s.key === h.id);
    const eng = this.eng;
    if (!sl || !eng || !h.rail) return;
    const f = clamp((x - h.rail[0]) / h.rail[1], 0, 1);
    const v = Math.round((sl.min + (sl.max - sl.min) * f) * 100) / 100;
    setSetting(eng, sl.key, v);
  }

  // ------------------------------------------------------------------ drawing
  private font(size: number) {
    this.c.font = `${size}px ${FONT}`;
  }
  private text(s: string, x: number, y: number, size: number, col = INK, align: CanvasTextAlign = 'left') {
    const c = this.c;
    this.font(size);
    c.textAlign = align;
    c.textBaseline = 'top';
    c.fillStyle = col;
    c.fillText(s, x, y);
  }
  private tw(s: string, size: number) {
    this.font(size);
    return this.c.measureText(s).width;
  }
  private wrap(s: string, w: number, size: number) {
    const out: string[] = [];
    let line = '';
    for (const word of s.split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (this.tw(next, size) > w && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  }
  private rule(x: number, y: number, w: number, h = 1, col = INK) {
    this.c.fillStyle = col;
    this.c.fillRect(x, y, w, h);
  }
  private vrule(x: number, y: number, h: number) {
    this.c.fillStyle = INK2;
    this.c.fillRect(x, y, 1, h);
  }
  private spr(d: PixelSprite, x: number, y: number, swap: Record<string, string> | undefined = INK_SWAP, key = 'ink') {
    this.c.drawImage(sprite(d, swap, swap ? key : undefined), Math.round(x), Math.round(y));
  }
  /** a dashed coupon border; the dashes march while it is hovered */
  private dashes(x: number, y: number, w: number, h: number, march: number) {
    const c = this.c;
    c.fillStyle = INK;
    const per = 4, on = 2;
    const off = Math.floor(march) % per;
    const run = (len: number, put: (i: number) => void) => {
      for (let i = -off; i < len; i += per) for (let j = 0; j < on; j++) if (i + j >= 0 && i + j < len) put(i + j);
    };
    run(w, (i) => c.fillRect(x + i, y, 1, 1));
    run(w, (i) => c.fillRect(x + w - 1 - i, y + h - 1, 1, 1));
    run(h, (i) => c.fillRect(x + w - 1, y + i, 1, 1));
    run(h, (i) => c.fillRect(x, y + h - 1 - i, 1, 1));
  }

  private draw() {
    const c = this.c;
    const k = this.s * this.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    c.setTransform(k, 0, 0, k, 0, 0);
    c.imageSmoothingEnabled = false;
    this.paper ??= newsprint();
    c.drawImage(this.paper, 0, 0);
    this.hits = [];
    const st = this.story;
    // ---- masthead
    this.text(st.issue, 10, 5, 7, INK2);
    this.text("SERKET'S REACH", PW / 2, 5, 7, INK2, 'center');
    this.text('PRICE: ONE BULLET', PW - 10, 5, 7, INK2, 'right');
    this.rule(8, 14, PW - 16);
    this.text('The Dust Gazette', PW / 2, 16, 26, INK, 'center');
    const mw = this.tw('The Dust Gazette', 26);
    this.spr(SUN_WINGS, PW / 2 - mw / 2 - 34, 25);
    this.spr(SUN_WINGS, PW / 2 + mw / 2 + 9, 25);
    this.rule(8, 44, PW - 16, 2);
    this.rule(8, 47, PW - 16);
    this.text(st.dateline, PW / 2, 50, 7, INK, 'center');
    this.rule(8, 59, PW - 16);
    // ---- column A: the lead story
    const ax = 10, aw = 142;
    let y = 63;
    for (const l of st.head) {
      this.text(l, ax + aw / 2, y, 13, INK, 'center');
      y += 14;
    }
    y += 1;
    for (const l of this.wrap(st.sub, aw, 7)) {
      this.text(l, ax + aw / 2, y, 7, RED, 'center');
      y += 9;
    }
    y += 2;
    const ph = 84;
    if (this.photo) {
      c.drawImage(this.photo, ax, y, aw, ph);
    } else {
      c.fillStyle = '#cdb88d';
      c.fillRect(ax, y, aw, ph);
    }
    c.strokeStyle = INK;
    c.lineWidth = 1;
    c.strokeRect(ax - 0.5, y - 0.5, aw + 1, ph + 1);
    y += ph + 3;
    for (const l of this.wrap(st.caption, aw, 6)) {
      this.text(l, ax, y, 6, FADE);
      y += 8;
    }
    y += 2;
    const bodyLines = this.wrap(st.body, aw, 7);
    const room = Math.floor((PH - 8 - y) / 9);
    bodyLines.slice(0, room).forEach((l, i) => {
      if (i === 0) {
        // a drop cap
        this.text(l[0], ax, y - 1, 16, RED);
        this.text(l.slice(1), ax + this.tw(l[0], 16) + 1, y, 7, INK);
      } else this.text(l, ax, y, 7, INK);
      y += 9;
    });
    this.vrule(157, 63, PH - 72);
    // ---- column B: settings
    this.drawSettings(163, 126);
    this.vrule(295, 63, PH - 72);
    // ---- column C: coupons and ads
    this.drawCoupons(300, 112);
    // pointer
    const h = this.hitAt(this.mx, this.my);
    const id = h?.id ?? '';
    if (id !== this.hot) {
      if (id) this.sfx('ui_hover', 0.25, 1.2);
      this.hot = id;
    }
    this.cv.style.cursor = this.drag ? 'grabbing' : h ? (h.rail ? 'grab' : 'pointer') : 'default';
  }

  private drawSettings(x: number, w: number) {
    const eng = this.eng;
    const st = getSettings();
    let y = 63;
    this.text("THE TINKER'S COLUMN", x + w / 2, y, 10, INK, 'center');
    y += 12;
    this.text('Set your iron right before you ride.', x + w / 2, y, 6, FADE, 'center');
    y += 10;
    this.rule(x, y, w);
    y += 5;
    for (const sl of SLIDERS) {
      const v = st[sl.key] as number;
      const f = clamp((v - sl.min) / (sl.max - sl.min), 0, 1);
      const rx = x + 4, rw = w - 8;
      const hov = this.over(x, y, w, 21) || this.drag?.id === 's:' + sl.key;
      this.text(sl.label, x + 2, y, 8, hov ? RED : INK);
      this.text(sl.show(v), x + w - 2, y + 1, 7, INK2, 'right');
      const ry = y + 13;
      // the rail: an ink groove with tick marks, inked up to the knob
      this.rule(rx, ry, rw, 1, INK2);
      this.rule(rx, ry + 2, rw, 1, INK2);
      this.rule(rx, ry + 1, Math.round(rw * f), 1, INK);
      for (let i = 0; i <= 10; i++) this.rule(rx + Math.round((rw * i) / 10), ry + (i % 5 ? 3 : 3), 1, i % 5 ? 1 : 2, INK2);
      this.spr(KNOB, rx + Math.round(rw * f) - 3, ry - 2 - (hov ? 1 : 0), undefined);
      this.hits.push({ x: x, y: y + 8, w, h: 13, id: 's:' + sl.key, rail: [rx, rw] });
      y += 22;
    }
    y += 1;
    this.rule(x, y, w);
    this.rule(x, y + 2, w);
    y += 6;
    this.text('CLASSIFIEDS', x + w / 2, y, 10, INK, 'center');
    y += 13;
    const touch = !!eng?.input.touchDevice;
    const full = !!document.fullscreenElement;
    const rows: { id: keyof GameSettings | 'full' | 'lesson'; on: boolean; a: string; b: string; fn: () => void }[] = [
      { id: 'invertY', on: st.invertY, a: 'WANTED: THE SKY UPSIDE DOWN', b: 'Invert the mouse. Inquire within.', fn: () => eng && setSetting(eng, 'invertY', !st.invertY) },
      touch
        ? { id: 'lesson', on: false, a: 'LESSONS IN THUMB-RIDING', b: 'Show the touch lesson again.', fn: () => resetTutor() }
        : { id: 'autoPush', on: !!eng?.input.autoPushDesktop, a: 'BOARD KICKS ITSELF ALONG', b: 'Auto push. No feet required.', fn: () => eng && setSetting(eng, 'autoPush', !eng.input.autoPushDesktop) },
      { id: 'high', on: st.high, a: 'FINE PRINT, FULL SHADOWS', b: 'High quality. Untick to ride fast.', fn: () => eng && setSetting(eng, 'high', !st.high) },
      {
        id: 'full', on: full, a: 'WIDE SKIES, NO FRAME', b: 'Full screen. The whole desert.',
        fn: () => {
          try {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen();
          } catch {
            /* not allowed here */
          }
        },
      },
    ];
    for (const r of rows) {
      const hov = this.over(x, y - 1, w, 19);
      const st0 = this.stamp[r.id] ?? 0;
      // the tick box, an ink X stamped in
      this.rule(x + 1, y + 1, 9, 9, hov ? '#d9c79c' : '#e6d6ae');
      this.c.strokeStyle = INK;
      this.c.strokeRect(x + 1.5, y + 1.5, 8, 8);
      if (r.on) {
        const sc = 1 + Math.max(0, 0.18 - (this.t - st0)) * 4;
        const cx = x + 6, cy = y + 6;
        this.c.save();
        this.c.translate(cx, cy);
        this.c.scale(sc, sc);
        this.c.fillStyle = RED;
        for (let i = -3; i <= 3; i++) {
          this.c.fillRect(i - 0.5, i - 0.5, 1.5, 1.5);
          this.c.fillRect(i - 0.5, -i - 0.5, 1.5, 1.5);
        }
        this.c.restore();
      }
      this.text(r.a, x + 13, y, 6, hov ? RED : INK);
      this.text(r.b, x + 13, y + 8, 6, FADE);
      this.hits.push({
        x, y: y - 1, w, h: 19, id: 'c:' + r.id,
        fn: () => {
          r.fn();
          this.stamp[r.id] = this.t;
          this.sfx('ui_click', 0.5, r.on ? 0.9 : 1.15);
        },
      });
      y += 21;
    }
  }

  private drawCoupons(x: number, w: number) {
    const c = this.c;
    let y = 63;
    this.actions.forEach((a, i) => {
      const obit = /GIVE UP/i.test(a.label);
      const big = i === 0;
      const h = big ? 46 : obit ? 34 : 28;
      const id = 'a:' + i;
      const hov = this.over(x, y, w, h) && !this.snip;
      const sn = this.snip?.id === id ? this.snip.t / 0.32 : 0;
      c.save();
      if (sn > 0) {
        // snipped out: it lifts off the sheet and tips away
        c.translate(x + w / 2, y + h / 2);
        c.rotate(sn * 0.35);
        c.translate(-(x + w / 2) + sn * 10, -(y + h / 2) - sn * 14);
        c.globalAlpha = 1 - sn * 0.6;
      }
      const dy = hov ? -1 : 0;
      if (obit) {
        // the obituary: a black-bordered notice
        this.rule(x, y + dy, w, h, '#e2d1a6');
        c.strokeStyle = INK;
        c.lineWidth = 2;
        c.strokeRect(x + 1, y + 1 + dy, w - 2, h - 2);
        c.lineWidth = 1;
        this.spr(SKULL, x + 5, y + 6 + dy);
        this.text('OBITUARY', x + w / 2 + 6, y + 4 + dy, 6, FADE, 'center');
        this.text(a.label, x + w / 2 + 6, y + 13 + dy, 8, hov ? RED : INK, 'center');
        this.text('Ends the ride here.', x + w / 2 + 6, y + 23 + dy, 6, FADE, 'center');
      } else {
        if (hov) this.rule(x + 2, y + 2, w, h, 'rgba(33,20,11,0.25)');
        this.rule(x, y + dy, w, h, hov ? '#f3e6c4' : '#eadbb4');
        this.dashes(x, y + dy, w, h, hov ? this.t * 10 : 0);
        this.spr(SCISSORS, x - 6, y - 4 + dy);
        if (big) {
          this.text('CLIP THIS COUPON', x + w / 2, y + 5 + dy, 6, FADE, 'center');
          this.text(a.label, x + w / 2, y + 14 + dy, 15, hov ? RED : INK, 'center');
          this.text(this.mode === 'menu' ? 'Back to the camp.' : 'Good for one more ride.', x + w / 2, y + 33 + dy, 6, INK2, 'center');
          this.spr(FLEURON, x + 6, y + 35 + dy);
          this.spr(FLEURON, x + w - 15, y + 35 + dy);
        } else {
          this.text(a.label, x + w / 2, y + 7 + dy, 9, hov ? RED : INK, 'center');
          this.text(/MENU/i.test(a.label) ? 'Ride back to camp.' : 'Redeem at once.', x + w / 2, y + 18 + dy, 6, FADE, 'center');
        }
      }
      c.restore();
      this.hits.push({
        x, y, w, h, id,
        fn: () => {
          if (this.snip) return;
          this.sfx('ui_click', 0.6, 1.35);
          this.sfx('paper_flutter', 0.3, 1.5);
          this.snip = { id, t: 0, fn: a.fn };
        },
      });
      y += h + 6;
    });
    // ---- the ads
    y += 1;
    this.rule(x, y, w, 2);
    y += 5;
    const ad1 = this.ads[0], ad2 = this.ads[1];
    // the gunsmith, with a plate of the revolver
    this.text('IRON & BONE', x + w / 2, y, 9, INK, 'center');
    y += 10;
    if (ad1) c.drawImage(ad1, x + 2, y);
    const tx = x + (ad1 ? ad1.width + 5 : 2);
    let ty = y;
    for (const l of this.wrap('Fine six-guns re-blued, cylinders trued. Ask for Seth.', x + w - tx, 6)) {
      this.text(l, tx, ty, 6, INK);
      ty += 8;
    }
    y = Math.max(ty, y + (ad1?.height ?? 0)) + 3;
    this.rule(x + 20, y, w - 40, 1, INK2);
    y += 4;
    // the trading post
    if (ad2) c.drawImage(ad2, x + w - ad2.width - 2, y);
    const tw2 = w - (ad2 ? ad2.width + 6 : 0);
    this.text("OZYMANDIAS'", x + 2, y, 8, INK);
    y += 9;
    let ly = y;
    for (const l of this.wrap('Trading post on the back of a walking turtle. Tonics, linen, dynamite. Fair prices, slow service.', tw2 - 2, 6)) {
      this.text(l, x + 2, ly, 6, INK);
      ly += 8;
    }
    y = Math.max(ly, y + (ad2?.height ?? 0) - 9) + 3;
    if (y < PH - 30) {
      this.rule(x + 20, y, w - 40, 1, INK2);
      y += 4;
      this.text('COFFEE GUM', x + w / 2, y, 9, RED, 'center');
      y += 10;
      for (const l of this.wrap('Chew the grit away. Loved by dogs and wanderers. Five cents.', w - 4, 6).slice(0, Math.floor((PH - 8 - y) / 8))) {
        this.text(l, x + w / 2, y, 6, INK, 'center');
        y += 8;
      }
    }
  }
}

// ------------------------------------------------------------------ the sheet and the plates
/** the newsprint sheet itself (UI pixels): fibres, foxing, the fold, a browned deckled edge */
function newsprint(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = PW;
  cv.height = PH;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(PW, PH);
  const tones = [[239, 228, 198], [233, 220, 188], [226, 211, 177], [214, 196, 158], [196, 174, 132], [150, 118, 78]];
  const fold = Math.round(PH * 0.52);
  for (let y = 0; y < PH; y++)
    for (let x = 0; x < PW; x++) {
      const i = (y * PW + x) * 4;
      // the deckled edge: a few pixels nibbled off, browned toward the rim
      const edge = Math.min(x, y, PW - 1 - x, PH - 1 - y);
      const nib = hash(Math.floor(x / 3), Math.floor(y / 3), 9) < 0.35 ? 1 : 0;
      if (edge < nib) continue;
      const big = hash(x >> 4, y >> 4, 3) * 0.5 + hash(x >> 3, y >> 3, 4) * 0.3 + hash(x >> 2, y >> 2, 5) * 0.2;
      let t = big < 0.3 ? 1 : big > 0.72 ? 2 : 0;
      // long fibres along the sheet
      if (hash(x >> 3, y, 6) > 0.93) t = Math.min(5, t + 1);
      // foxing spots
      if (hash(x >> 3, y >> 3, 7) > 0.975 && hash(x, y, 8) > 0.35) t = 3;
      if (edge < 4) t = Math.max(t, 3 - Math.floor(edge / 2));
      if (edge < 2) t = 4;
      if (edge === nib) t = 5;
      // the fold across the middle
      if (y === fold) t = 3;
      if (y === fold + 1) t = 0;
      const col = tones[t];
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  c.putImageData(img, 0, 0);
  return cv;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const SEPIA = [[33, 20, 11], [78, 52, 30], [128, 94, 60], [180, 148, 106], [226, 211, 177]];
/** linear render pixels (bottom row first) to a printed sepia halftone plate, `down` x smaller */
function halftone(px: Uint8Array, W: number, H: number, down: number): HTMLCanvasElement {
  const w = Math.floor(W / down), h = Math.floor(H / down);
  const lum = new Float32Array(w * h);
  let lo = 1, hi = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = 0; j < down; j++)
        for (let i = 0; i < down; i++) {
          const k = ((H - 1 - (y * down + j)) * W + x * down + i) * 4;
          s += (px[k] * 0.3 + px[k + 1] * 0.55 + px[k + 2] * 0.15) / 255;
        }
      const v = Math.pow(s / (down * down), 1 / 2.2);
      lum[y * w + x] = v;
    }
  // auto levels on the middle of the histogram
  const sorted = Array.from(lum).sort((a, b) => a - b);
  lo = sorted[Math.floor(sorted.length * 0.03)];
  hi = sorted[Math.floor(sorted.length * 0.97)];
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = clamp((lum[y * w + x] - lo) / Math.max(0.05, hi - lo), 0, 1);
      // a little vignette, like an old plate
      const dx = x / w - 0.5, dy = y / h - 0.5;
      v *= 1 - (dx * dx + dy * dy) * 0.9;
      const lv = v * (SEPIA.length - 1) + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 0.9;
      const col = SEPIA[clamp(Math.round(lv), 0, SEPIA.length - 1)];
      const k = (y * w + x) * 4;
      img.data[k] = col[0];
      img.data[k + 1] = col[1];
      img.data[k + 2] = col[2];
      img.data[k + 3] = 255;
    }
  c.putImageData(img, 0, 0);
  return cv;
}

/** an IconFactory plate reprinted in the sheet's ink: sepia steps, the paper showing through */
function inkPrint(src: HTMLCanvasElement): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(src, 0, 0);
  const img = c.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) {
      d[i + 3] = 0;
      continue;
    }
    const x = (i / 4) % cv.width, y = Math.floor(i / 4 / cv.width);
    const v = (d[i] * 0.3 + d[i + 1] * 0.55 + d[i + 2] * 0.15) / 255;
    const lv = v * 3.2 + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 0.7;
    const col = SEPIA[clamp(Math.round(lv), 0, 3)];
    d[i] = col[0];
    d[i + 1] = col[1];
    d[i + 2] = col[2];
    d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return cv;
}

/** a registry entry (a rig or a static voxel model) as an object for the studio */
function toObject(e: unknown): THREE.Object3D | null {
  const r = e as RigSpec & { model?: VoxelModel; voxelSize?: number };
  if (r?.parts) return new RigInstance(buildRigGeo(r, r.name + ':gazette'), { material: makeVoxelMaterial() }).root;
  if (r?.model && r.voxelSize) return new THREE.Mesh(buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: 'center' }), makeVoxelMaterial());
  return null;
}
