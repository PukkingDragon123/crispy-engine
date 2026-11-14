// THE OBJECTIVE TRACKER: one quest is tracked at a time and always shows where it is.
// Stylized 2D pixel art on its own HUD layer (the HUD's pixel grid, authored sprites,
// Alagard type), like the trail ledger:
//  • THE WAYPOINT: a brass-rimmed blood-red pin bobbing over the tracked objective,
//    its distance under it and its name over it; off screen it rides the screen
//    edge as a brass arrow pointing the way, with the distance beside it.
//  • QUEST GIVERS: a little parchment tag with a red "!" over everyone who has a job
//    for you (landmarks, the stranded prospector, the traveler, the frog mother) once
//    they are within a couple of hundred metres; a job not open yet is greyed.
//  • ONE-KEY TRACKING: J (or tapping the plaque under the mission notes on a touch
//    screen) tracks the next quest; a new quest is tracked as it comes in, and when
//    the tracked one ends the nearest one left takes over. The tracked quest's note
//    goes to the top of the mission paper stack with its live distance on it.
// run/Progression feeds it (quests with world positions, givers) and draws nothing else.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import type { Hud } from './Hud';
import type { PaperQuest } from './MissionPaper';
import { blitObj, pixelText, pixelTextWidth } from './HudSprites';
import { sprite, nine, keycap, drawSprite, SWAP_DIM, type PixelSprite } from './PixelUI';
import { HUD_ART as ART } from './HudArt';
import { isTouchDevice } from './TouchControls';

export interface TrackQuest {
  /** the mission paper's id for it (questFromObjective: the title) */
  id: string;
  title: string;
  /** short live wording */
  text: string;
  pos: { x: number; y: number; z: number } | null;
}
export interface TrackGiver {
  pos: { x: number; y: number; z: number };
  name: string;
  open: boolean;
}

// ------------------------------------------------------------------ authored sprites (HUD palette)
const PIN: PixelSprite = { w: 11, h: 15, rows: [
  '...kkkkk...',
  '..kjiiihk..',
  '.kjiDDDChk.',
  'kjiDEEDCChk',
  'kiDEEDDCCgk',
  'kiDEDDDCBgk',
  'khDDDDCCBgk',
  '.khCCCCBgk.',
  '.kghBBBggk.',
  '..kghhhgk..',
  '...kghgk...',
  '...kghgk...',
  '....kgk....',
  '....kgk....',
  '.....k.....',
] };
const ARROW_UP: PixelSprite = { w: 9, h: 9, rows: [
  '....k....',
  '...kjk...',
  '..kjihk..',
  '.kjiihgk.',
  'kjiiihhgk',
  'kkkihgkkk',
  '..kihgk..',
  '..kihgk..',
  '..kkkkk..',
] };
const ARROW_DIAG: PixelSprite = { w: 9, h: 9, rows: [
  '...kkkkkk',
  '...kjjiik',
  '....kjihk',
  '...kjiihk',
  '..kjihkhk',
  '.kjihk.kk',
  'kjihk....',
  'kihk.....',
  'kkk......',
] };
const GIVER: PixelSprite = { w: 7, h: 12, rows: [
  '.kkkkk.',
  'kuttttk',
  'ktsDCsk',
  'ktsDCsk',
  'ktsDCsk',
  'ktsDCsk',
  'ktssssk',
  'ktsDCsk',
  'krssssk',
  '.kkrkk.',
  '...k...',
  '...k...',
] };

const _v = new THREE.Vector3();

export interface TrackerDeps {
  engine: Engine;
  hud: Hud;
  camera: THREE.Camera;
  /** what is out there right now (called every frame while shown) */
  source(): { quests: TrackQuest[]; givers: TrackGiver[]; at: { x: number; z: number } };
  /** is the run showing its HUD (no cutscene, no modal) */
  live(): boolean;
}

export class QuestTracker {
  private cv = document.createElement('canvas');
  private c: CanvasRenderingContext2D;
  private s = 2;
  private w = 0;
  private h = 0;
  private t = 0;
  private show = 0;
  /** the tracked quest's id */
  tracked: string | null = null;
  private known = new Set<string>();
  private list: TrackQuest[] = [];
  private bob = { ang: 0, x: 0, y: 0, on: false };
  private plaque = { x: 0, y: 0, w: 0, h: 0, pulse: 0 };
  private touch = isTouchDevice();
  private btn: HTMLDivElement | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyJ' && !e.repeat && this.show > 0.5) this.cycle();
  };

  constructor(private d: TrackerDeps) {
    this.c = this.cv.getContext('2d')!;
    this.cv.id = 'quest-tracker';
    this.cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;image-rendering:pixelated';
    d.engine.overlay.appendChild(this.cv);
    window.addEventListener('keydown', this.onKey);
    if (this.touch) {
      this.btn = document.createElement('div');
      this.btn.style.cssText = 'position:absolute;z-index:9;pointer-events:auto;display:none;touch-action:none';
      this.btn.onpointerdown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.cycle();
      };
      d.engine.overlay.appendChild(this.btn);
    }
    d.engine.onAfterUpdate.push(this.tick);
  }
  private tick = (_dt: number, rdt: number) => this.update(rdt);

  /** track the next quest in the list */
  cycle() {
    const L = this.list;
    if (L.length < 2) return;
    const i = L.findIndex((q) => q.id === this.tracked);
    this.tracked = L[(i + 1) % L.length].id;
    this.plaque.pulse = 1;
    this.d.engine.audio.play('page_turn', { volume: 0.4, pitch: 1.2 });
  }

  /** the mission paper's notes with the tracked one flagged (it goes on top) and its live distance on it */
  decorate(papers: PaperQuest[]): PaperQuest[] {
    const tq = this.list.find((q) => q.id === this.tracked);
    const at = this.d.source().at;
    return papers.map((p) => {
      if (p.id !== this.tracked) return p;
      const dist = tq?.pos ? Math.round(Math.hypot(tq.pos.x - at.x, tq.pos.z - at.z)) : -1;
      const hasDist = /\d+\s*m\b/.test(p.progress ?? '');
      const progress = dist >= 0 && !hasDist ? (p.progress ? `${p.progress} · ${dist} m` : `${dist} m away`) : p.progress;
      return { ...p, progress, tracked: true };
    });
  }

  private resize() {
    this.s = this.d.hud.scale || (window.innerWidth > 1800 ? 3 : 2);
    const w = Math.ceil(window.innerWidth / this.s), h = Math.ceil(window.innerHeight / this.s);
    if (w === this.w && h === this.h) return;
    this.w = this.cv.width = w;
    this.h = this.cv.height = h;
    this.c.imageSmoothingEnabled = false;
  }

  private pick(src: ReturnType<TrackerDeps['source']>) {
    const L = src.quests;
    // a quest that just came in is tracked (the newest wins)
    let fresh: TrackQuest | null = null;
    for (const q of L) if (!this.known.has(q.id)) fresh = q;
    for (const q of L) this.known.add(q.id);
    for (const id of [...this.known]) if (!L.some((q) => q.id === id)) this.known.delete(id);
    if (fresh) this.tracked = fresh.id;
    // the tracked one ended: the nearest left takes over
    if (!L.some((q) => q.id === this.tracked)) {
      let best: TrackQuest | null = null, bd = Infinity;
      for (const q of L) {
        const dd = q.pos ? Math.hypot(q.pos.x - src.at.x, q.pos.z - src.at.z) : 1e6;
        if (dd < bd) {
          bd = dd;
          best = q;
        }
      }
      this.tracked = best?.id ?? null;
    }
    this.list = L;
  }

  update(rdt: number) {
    const dt = Math.min(0.1, rdt);
    this.t += dt;
    const eng = this.d.engine;
    const vis = this.d.hud.visible && !eng.paused && this.d.live();
    this.show += ((vis ? 1 : 0) - this.show) * Math.min(1, dt * 6);
    this.resize();
    const c = this.c;
    c.clearRect(0, 0, this.w, this.h);
    if (this.btn) this.btn.style.display = 'none';
    if (this.show < 0.02) return;
    const src = this.d.source();
    this.pick(src);
    c.globalAlpha = this.show;
    for (const g of src.givers) this.paintGiver(g, src.at);
    const tq = this.list.find((q) => q.id === this.tracked) ?? null;
    if (tq?.pos) this.paintWaypoint(tq, src.at, dt);
    this.paintPlaque(tq, dt);
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- the waypoint
  private paintWaypoint(q: TrackQuest, at: { x: number; z: number }, dt: number) {
    const p = this.d.hud.project?.(q.pos!);
    if (!p) return;
    const c = this.c, s = this.s, W = this.w, H = this.h;
    const dist = Math.round(Math.hypot(q.pos!.x - at.x, q.pos!.z - at.z));
    const dtext = `${dist} m`;
    let x = p.x / s, y = p.y / s;
    const topEdge = 26;
    const onScreen = p.visible && !p.behind && x > 14 && x < W - 14 && y > topEdge && y < H - 40;
    const pin = sprite(PIN);
    if (onScreen) {
      const bob = Math.round(Math.sin(this.t * 3.4) * 2);
      // a soft pulse ring on the ground under the pin: pixel dots round it
      const r = 5 + ((this.t * 9) % 7);
      c.fillStyle = '#ffd36b';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        c.globalAlpha = this.show * (1 - (r - 5) / 7) * 0.8;
        c.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + 6 + Math.sin(a) * r * 0.4), 1, 1);
      }
      c.globalAlpha = this.show;
      blitObj(c, pin, x, y - 8 + bob, 2, this.show);
      pixelText(c, dtext, x, y + 2 + bob, { size: 16, color: '#ffd36b', align: 'center', outline: '#1a0e06' });
      if (dist > 12) pixelText(c, q.title, x, y - 30 + bob, { size: 16, color: '#fff3d6', align: 'center', outline: '#1a0e06' });
      this.bob.on = false;
      return;
    }
    // off screen: the arrow on a frame inside the screen edge, pointing the way (ahead = up)
    const v = _v.set(q.pos!.x, q.pos!.y, q.pos!.z).applyMatrix4((this.d.camera as THREE.Camera).matrixWorldInverse);
    const ang = Math.atan2(v.x, -v.z);
    const B = this.bob;
    if (!B.on) B.ang = ang;
    B.on = true;
    B.ang += Math.atan2(Math.sin(ang - B.ang), Math.cos(ang - B.ang)) * Math.min(1, dt * 8);
    const sx = Math.sin(B.ang), sy = -Math.cos(B.ang);
    const cx = W / 2, cy = H / 2;
    // the frame keeps clear of the trail ledger (left), the wave plaque (top) and the bottom HUD bar
    const L = 104, R = W - 22, T = 44, Bt = H - 78;
    const k = Math.min(sx < 0 ? (L - cx) / sx : sx > 0 ? (R - cx) / sx : 1e9, sy < 0 ? (T - cy) / sy : sy > 0 ? (Bt - cy) / sy : 1e9);
    x = cx + sx * k;
    y = cy + sy * k;
    const oct = ((Math.round((B.ang / (Math.PI * 2)) * 8) % 8) + 8) % 8;
    const diag = oct % 2 === 1;
    const push = Math.round(Math.sin(this.t * 6) * 1.5);
    drawSprite(c, sprite(diag ? ARROW_DIAG : ARROW_UP), x + sx * push, y + sy * push, { turns: Math.floor(oct / 2), alpha: 1 });
    // the pin and the distance on the inner side
    const ix = x - sx * 18, iy = y - sy * 16;
    blitObj(c, pin, ix, iy - 6, 1, this.show * 0.95);
    pixelText(c, dtext, ix, iy + 4, { size: 16, color: '#ffd36b', align: 'center', outline: '#1a0e06' });
  }

  // ---------------------------------------------------------------- quest givers
  private paintGiver(g: TrackGiver, at: { x: number; z: number }) {
    const dist = Math.hypot(g.pos.x - at.x, g.pos.z - at.z);
    if (dist > 220 || dist < 5) return;
    const p = this.d.hud.project?.(g.pos);
    if (!p || !p.visible || p.behind) return;
    const c = this.c, s = this.s;
    const x = p.x / s, y = p.y / s;
    if (x < 10 || x > this.w - 10 || y < 20 || y > this.h - 30) return;
    const near = dist < 60;
    const bob = Math.round(Math.sin(this.t * 2.6 + g.pos.x) * 1.5);
    const spr = g.open ? sprite(GIVER) : sprite(GIVER, SWAP_DIM, 'dim');
    blitObj(c, spr, x, y - 6 + bob, 2, this.show * (near ? 1 : 0.85));
    const label = near ? g.name : `${Math.round(dist)} m`;
    pixelText(c, label, x, y + 2 + bob, { size: 16, color: g.open ? '#fff3d6' : '#c9a97c', align: 'center', outline: '#1a0e06' });
  }

  // ---------------------------------------------------------------- the plaque under the notes
  private paintPlaque(tq: TrackQuest | null, dt: number) {
    const n = this.list.length;
    const P = this.plaque;
    P.pulse = Math.max(0, P.pulse - dt * 2.5);
    if (n < 2 || !tq) return;
    const c = this.c, s = this.s;
    const hp = this.d.hud as unknown as { paperBottom?: number; scale?: number };
    const bottom = ((hp.paperBottom ?? 30) * (hp.scale ?? s)) / s;
    const label = `${this.touch ? 'TAP: ' : ''}NEXT QUEST  ${Math.max(1, this.list.indexOf(tq) + 1)}/${n}`;
    const kc = this.touch ? null : keycap('J');
    const tw = Math.ceil(pixelTextWidth(label, 16)) + 12 + (kc ? kc.width + 4 : 0);
    const w = tw, h = 20;
    const x = Math.round(this.w - 10 - w), y = Math.round(bottom + 4 + P.pulse * -2);
    blitObj(c, nine(ART.nine_toast, w, h, 6), x + w / 2, y + h / 2, 2, this.show);
    let tx = x + 6;
    if (kc) {
      c.drawImage(kc, tx, y + 3);
      tx += kc.width + 4;
    }
    pixelText(c, label, tx, y + 3, { size: 16, color: '#3a1c0a' });
    P.x = x;
    P.y = y;
    P.w = w;
    P.h = h;
    if (this.btn) {
      const b = this.btn.style;
      b.display = 'block';
      b.left = `${x * s - 6}px`;
      b.top = `${y * s - 6}px`;
      b.width = `${w * s + 12}px`;
      b.height = `${h * s + 12}px`;
    }
  }

  dispose() {
    const L = this.d.engine.onAfterUpdate, i = L.indexOf(this.tick);
    if (i >= 0) L.splice(i, 1);
    window.removeEventListener('keydown', this.onKey);
    this.btn?.remove();
    this.cv.remove();
  }
}
