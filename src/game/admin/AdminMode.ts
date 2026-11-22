// THE ADMIN TESTING MODE. A brass ADMIN tag hangs in the top-right corner; F1 or ` (or a tap on the
// tag) opens the panel (game/admin/AdminPanel): jump to any stage / hero / wave / scene, teleport
// on a map of the run, free-fly the camera, cheat, give cards, spawn foes and bosses, unlock or wipe
// the save, drive a boss's phases and named attacks, and a perf overlay. While the panel is open the
// game hears no keys or clicks (and can be frozen).
//
// Loaded only in admin mode (main.ts: a VITE_ADMIN=1 build, ?admin=1, or the desktop app's --admin
// flag, which opens the page with ?admin=1). A normal game never loads this chunk; the only traces
// it leaves in shared code are the CHEATS switches, Engine.adminScale and RunScene.hudOff.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import type { StageId, HeroId } from '../meta/Stage';
import { RunScene, rankCost } from '../scenes/RunScene';
import { MenuScene } from '../scenes/MenuScene';
import { HubScene } from '../scenes/HubScene';
import { ThothHall } from '../scenes/ThothHall';
import { nav } from '../Nav';
import { loadSave, writeSave, PRICES } from '../meta/Save';
import { Unlocks, UNLOCKS } from '../meta/Unlocks';
import { NILE_UNLOCK, MARK_UNLOCK, nileOpen, markOpen } from '../meta/StageUnlocks';
import { hideoutOpen } from '../meta/HideoutGate';
import { Blueprints, blueprintDefs } from '../meta/Blueprints';
import { TECHNIQUES, unlock as unlockMove } from '../player/Techniques';
import { UnlockReveal } from '../ui/UnlockReveal';
import { makeBoss } from '../bosses/BossRoster';
import { nilePrewarm } from '../bosses/NileRoster';
import type { Boss, BossDeps } from '../bosses/Boss';
import { ENEMIES } from '../enemies/EnemyDefs';
import { RARITY, type UpgradeDef } from '../run/Upgrades';
import { nine, sprite, ironPlate, SWAP_LIT, type PixelSprite } from '../ui/PixelUI';
import { HUD_ART as ART } from '../ui/HudArt';
import { pixelText, pixelTextWidth } from '../ui/HudSprites';
import { CHEATS } from './Cheats';
import { forgetAdmin } from './AdminGate';
import { AdminPanel, INK } from './AdminPanel';
import { AdminMap } from './AdminMap';
import { areaFor, prewarmBoss, moveTitle, type BossEntry } from './AdminData';

const ONE_HIT = 'admin:onehit';
const FLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'KeyE', 'KeyQ', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const STOP_EVENTS = ['mousedown', 'mousemove', 'wheel', 'touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick', 'contextmenu'];

// the ADMIN tag: the HUD's brass tag on its leather strap, widened for the word
const slice = (d: PixelSprite, x0: number, x1: number): PixelSprite => ({ w: x1 - x0, h: d.h, rows: d.rows.map((r) => r.slice(x0, x1)) });
const hstack = (parts: PixelSprite[]): PixelSprite => {
  const h = Math.max(...parts.map((p) => p.h));
  const rows: string[] = [];
  for (let y = 0; y < h; y++) rows.push(parts.map((p) => (p.rows[y] ?? '').padEnd(p.w, '.')).join(''));
  return { w: rows[0].length, h, rows };
};
const TAG_MID = slice(ART.tag, 10, 11);
const TAG: PixelSprite = hstack([slice(ART.tag, 0, 16), ...Array(9).fill(TAG_MID), slice(ART.tag, 16, 23), ...Array(9).fill(TAG_MID), slice(ART.tag, 23, 38)]);

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AdminMode {
  open = false;
  /** freeze the game while the panel is open */
  freeze = false;
  /** the admin time scale (Engine.adminScale) */
  speed = 1;
  hudHidden = false;
  perfOn = false;
  oneHit = false;
  readonly cheats = CHEATS;
  readonly map = new AdminMap(160);
  readonly sel: { stage: StageId; hero: HeroId; wave: number } = { stage: 'desert', hero: 'sundown', wave: 1 };
  readonly fly = { on: false, pos: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 18, keys: new Set<string>(), drag: null as { x: number; y: number } | null };
  msg = { text: '', at: -99, bad: false };
  private root = document.createElement('div');
  private scrim = document.createElement('div');
  private tagCv = document.createElement('canvas');
  private hudCv = document.createElement('canvas');
  private panel: AdminPanel;
  private t = 0;
  private hs = 2;
  private hudT = 0;
  /** time since the panel was last drawn (it redraws at 30 Hz, or at once after input) */
  private panelT0 = 1;
  private tagHover = false;
  private tagKey = '';
  private hudWasHidden = false;
  private synced: unknown = null;
  private perf = { calls: 0, tris: 0, t: 0, frames: 0, fps: 0 };

  constructor(readonly engine: Engine) {
    this.panel = new AdminPanel(this);
    const r = this.root;
    r.id = 'admin';
    r.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:50';
    this.scrim.style.cssText = 'position:absolute;inset:0;pointer-events:none;touch-action:none';
    this.hudCv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;image-rendering:pixelated';
    this.tagCv.style.cssText = 'position:absolute;top:0;pointer-events:auto;image-rendering:pixelated;cursor:pointer;touch-action:none';
    this.tagCv.width = TAG.w;
    this.tagCv.height = TAG.h;
    r.append(this.scrim, this.hudCv, this.tagCv, this.panel.cv);
    document.body.appendChild(r);
    // nothing on the admin layer reaches the game underneath (its window listeners included)
    for (const ev of STOP_EVENTS)
      r.addEventListener(ev, (e) => {
        e.stopPropagation();
        if (ev === 'contextmenu') e.preventDefault();
      });
    this.tagCv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.toggle();
    });
    this.tagCv.addEventListener('pointerenter', () => (this.tagHover = true));
    this.tagCv.addEventListener('pointerleave', () => (this.tagHover = false));
    // free-fly look: drag anywhere off the panel; the wheel sets the speed
    this.scrim.addEventListener('pointerdown', (e) => {
      if (!this.fly.on) return;
      this.fly.drag = { x: e.clientX, y: e.clientY };
      try {
        this.scrim.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable */
      }
    });
    this.scrim.addEventListener('pointermove', (e) => {
      const d = this.fly.drag;
      if (!d || !this.fly.on) return;
      this.fly.yaw -= (e.clientX - d.x) * 0.0045;
      this.fly.pitch = clamp(this.fly.pitch - (e.clientY - d.y) * 0.0045, -1.5, 1.5);
      d.x = e.clientX;
      d.y = e.clientY;
    });
    this.scrim.addEventListener('pointerup', () => (this.fly.drag = null));
    this.scrim.addEventListener('wheel', (e) => {
      if (this.fly.on) this.fly.speed = clamp(this.fly.speed * (e.deltaY > 0 ? 1 / 1.2 : 1.2), 2, 200);
    }, { passive: true });
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('keyup', (e) => this.fly.keys.delete(e.code), true);
    window.addEventListener('blur', () => this.fly.keys.clear());
    engine.onAfterUpdate.push((dt, rdt) => this.tick(dt, rdt));
    (window as unknown as { __admin: AdminMode }).__admin = this; // dev handle: __admin.go(), __admin.teleport(x, z)
    console.log('[admin] testing mode on: F1 or ` opens the panel');
  }

  // ------------------------------------------------------------------ the current scene
  run(): RunScene | null {
    const c = this.engine.current;
    return c instanceof RunScene && c.ready ? c : null;
  }
  private player() {
    return ((this.engine.current as { player?: RunScene['player'] } | null)?.player ?? null) as RunScene['player'] | null;
  }

  say(text: string, bad = false) {
    this.msg = { text, at: this.panelT(), bad };
  }
  private panelT() {
    return (this.panel as unknown as { t: number }).t;
  }
  click() {
    this.engine.audio.play('ui_click', { volume: 0.35, pitch: 1.1 });
  }

  // ------------------------------------------------------------------ open / close / keys
  toggle() {
    if (this.open) this.close();
    else this.show();
  }
  show() {
    if (this.open) return;
    this.open = true;
    this.syncSel();
    this.panel.show(true);
    // the game lets go of the mouse while the board is up
    try {
      if (document.pointerLockElement) document.exitPointerLock();
    } catch {
      /* no pointer lock */
    }
    this.engine.audio.play('paper_flutter', { volume: 0.5, pitch: 1.2 });
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.panel.show(false);
    this.engine.audio.play('ui_close', { volume: 0.5 });
  }

  /** take the stage / hero / wave of the run on screen (once per scene) */
  private syncSel() {
    const cur = this.engine.current;
    if (this.synced === cur) return;
    this.synced = cur;
    const r = this.run();
    const sv = loadSave();
    this.sel.stage = r?.opts.stage ?? sv.stage ?? 'desert';
    this.sel.hero = r?.opts.hero ?? sv.hero ?? 'sundown';
    this.sel.wave = Math.max(1, r?.director.wave || this.sel.wave || 1);
  }

  private onKey(e: KeyboardEvent) {
    const stop = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    // F1 / ` / F10 / Ctrl+Shift+A (laptops without F-keys, keyboards without a backquote key)
    if (e.code === 'F1' || e.code === 'Backquote' || e.code === 'F10' || (e.code === 'KeyA' && e.ctrlKey && e.shiftKey)) {
      stop();
      if (!e.repeat) this.toggle();
      return;
    }
    if (e.code === 'F2') {
      stop();
      if (!e.repeat) this.setFly(!this.fly.on);
      return;
    }
    if (e.code === 'F3') {
      stop();
      if (!e.repeat) this.setPerf(!this.perfOn);
      return;
    }
    if (this.open) {
      if (e.code === 'Escape') {
        stop();
        this.close();
        return;
      }
      this.panel.key(e);
      // the game hears nothing while the panel is up (key releases still pass, so nothing sticks)
      stop();
      return;
    }
    if (this.fly.on) {
      if (e.code === 'Escape') {
        stop();
        this.setFly(false);
        return;
      }
      if (FLY_KEYS.has(e.code)) {
        this.fly.keys.add(e.code);
        stop();
      }
    }
  }

  // ------------------------------------------------------------------ per frame
  private tick(dt: number, rdt: number) {
    this.t += rdt;
    const eng = this.engine;
    eng.adminScale = this.open && this.freeze ? 0 : this.speed;
    this.applyOneHit();
    this.applyHud();
    this.scrim.style.pointerEvents = this.open || this.fly.on ? 'auto' : 'none';
    this.scrim.style.cursor = this.fly.on ? (this.fly.drag ? 'grabbing' : 'grab') : 'default';
    if (this.fly.on) this.tickFly(rdt);
    this.panelT0 += rdt;
    if (this.open && (this.panelT0 >= 1 / 30 || this.panel.dirty)) {
      this.panel.draw(this.panelT0);
      this.panelT0 = 0;
    }
    this.drawTag();
    // perf counters: last frame's totals (every pass: the scene, the post stack, the 3D HUD), then reset
    const info = eng.renderer.info;
    if (this.perfOn) {
      this.perf.calls = info.render.calls;
      this.perf.tris = info.render.triangles;
      info.reset();
    }
    this.perf.frames++;
    this.perf.t += rdt;
    if (this.perf.t >= 0.5) {
      this.perf.fps = this.perf.frames / this.perf.t;
      this.perf.t = this.perf.frames = 0;
    }
    this.hudT -= rdt;
    if (this.hudT <= 0) {
      this.hudT = 0.2;
      this.drawHud();
    }
  }

  private applyOneHit() {
    const p = this.player();
    if (!p?.stats) return;
    const has = p.stats.mods.some((m) => m.source === ONE_HIT);
    if (this.oneHit && !has)
      p.stats.add((['gunDmg', 'meleeDmg', 'magicDmg'] as const).map((stat) => ({ stat, type: 'mult' as const, value: 1000, source: ONE_HIT })));
    else if (!this.oneHit && has) p.stats.removeSource(ONE_HIT);
  }

  /** hide (or bring back) every HUD piece: the 3D lower HUD through RunScene, the 2D layers here */
  private applyHud() {
    const r = this.run();
    if (r) r.hudOff = this.hudHidden;
    if (!this.hudHidden && !this.hudWasHidden) return;
    this.hudWasHidden = this.hudHidden;
    for (const el of Array.from(this.engine.overlay.children) as HTMLElement[]) {
      if (el.classList.contains('fade') || el.classList.contains('bar')) continue;
      if (this.hudHidden) {
        if (el.style.visibility !== 'hidden') {
          el.style.visibility = 'hidden';
          el.dataset.adminHid = '1';
        }
      } else if (el.dataset.adminHid) {
        el.style.visibility = '';
        delete el.dataset.adminHid;
      }
    }
  }

  // ------------------------------------------------------------------ the corner tag and the overlay
  private hudScale() {
    return window.innerWidth > 1800 ? 3 : 2;
  }
  private drawTag() {
    const s = this.hudScale();
    const hide = this.hudHidden && !this.open && !this.engine.input.touchDevice;
    const key = `${s}:${this.open || this.tagHover}:${hide}`;
    if (key === this.tagKey) return;
    this.tagKey = key;
    const cv = this.tagCv;
    cv.style.display = hide ? 'none' : 'block';
    cv.style.width = TAG.w * s + 'px';
    cv.style.height = TAG.h * s + 'px';
    cv.style.right = 10 * s + 'px';
    const c = cv.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, TAG.w, TAG.h);
    const lit = this.open || this.tagHover;
    c.drawImage(sprite(TAG, lit ? SWAP_LIT : undefined, lit ? 'lit' : undefined), 0, 0);
    pixelText(c, 'ADMIN', TAG.w / 2, 5, { size: 16, color: lit ? '#6a1408' : INK, align: 'center', lip: '#fff0a6' });
  }

  /** the perf plate (under the tag) and the free-fly key strip (bottom centre), redrawn 5x a second */
  private drawHud() {
    const s = (this.hs = this.hudScale());
    const w = Math.ceil(window.innerWidth / s), h = Math.ceil(window.innerHeight / s);
    const cv = this.hudCv;
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    cv.style.display = this.perfOn || this.fly.on ? 'block' : 'none';
    if (!this.perfOn && !this.fly.on) return;
    const c = cv.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, w, h);
    if (this.perfOn) {
      const eng = this.engine;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      const lines: [string, string][] = [
        ['FPS', `${Math.round(this.perf.fps)}  (${(1000 / Math.max(1, this.perf.fps)).toFixed(1)} ms)`],
        ['CALLS', String(this.perf.calls)],
        ['TRIS', this.perf.tris >= 1e6 ? (this.perf.tris / 1e6).toFixed(2) + ' M' : (this.perf.tris / 1e3).toFixed(1) + ' K'],
        ['SCALE', `${eng.renderScale.toFixed(2)} x ${eng.quality.pixelRatio.toFixed(2)}${eng.adaptive ? '' : ' fixed'}`],
        ['HEAP', mem ? `${Math.round(mem.usedJSHeapSize / 1048576)} MB` : 'n/a'],
      ];
      if (this.speed !== 1) lines.push(['TIME', `${this.speed}x`]);
      const PW = 128, PH = lines.length * 12 + 8;
      const x = w - PW - 6, y = TAG.h + 6;
      c.drawImage(ironPlate(PW, PH, 5), x, y);
      lines.forEach(([k, v], i) => {
        pixelText(c, k, x + 6, y + 2 + i * 12, { size: 16, color: '#a9b6c2', outline: '#121519' });
        pixelText(c, v, x + PW - 6, y + 2 + i * 12, { size: 16, color: i === 0 && this.perf.fps < 45 ? '#ff8a6a' : '#fff0a6', outline: '#121519', align: 'right' });
      });
    }
    if (this.fly.on) {
      const t = `FREE-FLY   WASD MOVE   SPACE / C UP, DOWN   SHIFT FAST   DRAG TO LOOK   WHEEL SPEED ${Math.round(this.fly.speed)}   F2 LANDS`;
      const tw = Math.ceil(pixelTextWidth(t, 16)) + 20;
      const x = Math.round(w / 2 - tw / 2), y = h - 30;
      c.fillStyle = 'rgba(26,14,6,0.45)';
      c.fillRect(x + 3, y + 3, tw, 20);
      c.drawImage(nine(ART.nine_parch, tw, 20, 8), x, y);
      pixelText(c, t, w / 2, y + 1, { size: 16, color: INK, align: 'center', lip: '#f6e8c4' });
    }
  }

  // ------------------------------------------------------------------ free-fly
  setFly(on: boolean) {
    const cam = this.engine.current?.camera;
    if (on && !cam) return;
    this.fly.on = on;
    this.fly.keys.clear();
    this.fly.drag = null;
    if (on && cam) {
      this.fly.pos.copy(cam.position);
      const d = cam.getWorldDirection(new THREE.Vector3());
      this.fly.yaw = Math.atan2(d.x, d.z);
      this.fly.pitch = Math.asin(clamp(d.y, -1, 1));
      try {
        if (document.pointerLockElement) document.exitPointerLock();
      } catch {
        /* no pointer lock */
      }
    }
    this.say(on ? 'Free-fly camera: WASD, Space / C, drag to look' : 'Camera back on the hunter');
    this.hudT = 0;
  }
  private tickFly(rdt: number) {
    const cam = this.engine.current?.camera;
    if (!cam) return;
    const F = this.fly, k = F.keys;
    const cy = Math.cos(F.yaw), sy = Math.sin(F.yaw), cp = Math.cos(F.pitch);
    const fwd = new THREE.Vector3(sy * cp, Math.sin(F.pitch), cy * cp);
    const right = new THREE.Vector3(-cy, 0, sy);
    const mv = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) mv.add(fwd);
    if (k.has('KeyS') || k.has('ArrowDown')) mv.sub(fwd);
    if (k.has('KeyD') || k.has('ArrowRight')) mv.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) mv.sub(right);
    if (k.has('Space') || k.has('KeyE')) mv.y += 1;
    if (k.has('KeyC') || k.has('KeyQ')) mv.y -= 1;
    if (mv.lengthSq() > 0) {
      const sp = F.speed * (k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1) * (k.has('ControlLeft') || k.has('ControlRight') ? 0.25 : 1);
      F.pos.addScaledVector(mv.normalize(), sp * rdt);
    }
    cam.position.copy(F.pos);
    cam.lookAt(F.pos.x + fwd.x, F.pos.y + fwd.y, F.pos.z + fwd.z);
    cam.fov = 70;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  setPerf(on: boolean) {
    this.perfOn = on;
    this.engine.renderer.info.autoReset = !on;
    this.hudT = 0;
  }
  setOneHit(on: boolean) {
    this.oneHit = on;
    this.say(on ? 'One-hit kills on' : 'One-hit kills off');
  }
  setSpeed(v: number) {
    this.speed = v;
    this.say(`Time ${v}x`);
  }
  setHud(hidden: boolean) {
    this.hudHidden = hidden;
    this.tagKey = '';
    this.say(hidden ? 'HUD hidden (close the panel for a clean shot)' : 'HUD back');
  }

  // ------------------------------------------------------------------ JUMP
  setWave(w: number) {
    this.sel.wave = clamp(Math.round(w), 1, 100);
  }
  /** restart the run at the chosen stage, hero and wave */
  go() {
    const { stage, hero, wave } = this.sel;
    const area = areaFor(wave);
    const sv = loadSave();
    this.close();
    if (this.fly.on) this.setFly(false);
    (window as unknown as { __music?: { setMood(m: string): void } }).__music?.setMood('explore');
    const eng = this.engine;
    void eng.setScene(
      new RunScene(eng, { area, seed: Math.floor(Math.random() * 99999), startWave: wave, stage, hero, intro: false, look: sv.look, gun: sv.gun }),
      0.5,
      '#000',
      { loading: stage === 'nile' ? 'Down to the river' : 'Riding into the dunes' }
    );
    this.say(`${stage === 'nile' ? 'Nile' : 'Dunes'} wave ${wave}, area ${area}, ${hero === 'mark' ? 'Mark' : 'Sundown'}`);
  }

  scene(kind: 'menu' | 'hub' | 'hall' | 'cave' | 'intro') {
    const eng = this.engine;
    this.close();
    if (this.fly.on) this.setFly(false);
    const sv = loadSave();
    switch (kind) {
      case 'menu':
        nav.menu();
        break;
      case 'hub':
        void eng.setScene(new HubScene(eng, () => nav.ride(false), () => nav.menu()), 0.5, '#000', { loading: 'Back to the hideout' });
        break;
      case 'hall':
        void this.openHall();
        break;
      case 'cave':
        void import('../scenes/CaveScene').then((m) => m.debugCave(eng, {}));
        break;
      case 'intro':
        void eng.setScene(new RunScene(eng, { area: 'A', seed: Math.floor(Math.random() * 99999), startWave: 1, stage: 'desert', hero: 'sundown', intro: true, look: sv.look, gun: sv.gun }), 0.6, '#fff4e0', { loading: 'Riding into the dunes' });
        break;
    }
  }

  /** the menu, then Thoth's Hall over it (the seal on the door is skipped) */
  private async openHall() {
    const eng = this.engine;
    if (!(eng.current instanceof MenuScene)) nav.menu();
    const t0 = performance.now();
    while (performance.now() - t0 < 60000) {
      await sleep(200);
      const m = eng.current;
      if (m instanceof MenuScene && m.ready && !eng.loader?.shown) break;
    }
    await sleep(500);
    const m = eng.current as unknown as { hall: ThothHall | null; hero: { geo: { spec: unknown } } | null; scene: THREE.Scene; camera: THREE.Camera };
    if (!(eng.current instanceof MenuScene) || m.hall) return;
    const hall = new ThothHall(eng, {
      hero: (m.hero?.geo.spec ?? null) as never,
      back: { scene: m.scene, camera: m.camera },
      from: 'menu',
      onClosed: () => {
        if (m.hall === hall) m.hall = null;
        hall.dispose();
        eng.input.setWantLock(false);
      },
    });
    m.hall = hall;
    void hall.open();
  }

  // ------------------------------------------------------------------ MOVE
  private safeNear(r: RunScene, x: number, z: number, margin = 3) {
    const st = r.world.storm;
    if (st.sdf(x, z) > margin) return { x, z };
    for (let k = 1; k <= 40; k++) {
      const a = k * 2.39996, d = k * 2.5;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (st.sdf(px, pz) > margin) return { x: px, z: pz };
    }
    return { x, z };
  }

  /** put the hunter at (x, z), optionally facing a point */
  teleport(x: number, z: number, face?: { x: number; z: number }) {
    const r = this.run();
    if (!r) return this.say('Teleporting works during a run', true);
    const size = r.world.sa.field.size;
    x = clamp(x, 2, size - 2);
    z = clamp(z, 2, size - 2);
    const p = r.player;
    const heading = face ? Math.atan2(face.x - x, face.z - z) : p.board.heading;
    p.releaseGrapple();
    p.board.place(x, r.world.groundAt(x, z) + 0.05, z, heading);
    if (face) r.camRig.yaw = heading;
    // the camera snaps instead of sweeping across the map; no board track is carved across it
    (r.camRig as unknown as { first: boolean }).first = true;
    (r as unknown as { hasTrack: boolean }).hasTrack = false;
    r.world.terrain.update(p.pos, 60);
    const storm = r.world.storm.sdf(x, z) < 0;
    this.say(`Teleported to ${Math.round(x)}, ${Math.round(z)}${storm ? '  (inside the storm)' : ''}`, storm);
  }
  /** a spot `gap` metres from a target, on the hunter's side of it, facing it */
  private near(r: RunScene, t: { x: number; z: number }, gap: number) {
    const p = r.player.pos;
    let dx = p.x - t.x, dz = p.z - t.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const s = this.safeNear(r, t.x + dx * gap, t.z + dz * gap);
    this.teleport(s.x, s.z, t);
  }
  tpBoss() {
    const r = this.run();
    const b = r?.bosses.find((x) => x.alive && !x.escaped);
    if (!r || !b) return this.say('No boss on the field', true);
    this.near(r, b.pos, b.radius + 12);
  }
  tpFoe() {
    const r = this.run();
    const e = r?.enemies.nearest(r.player.pos, 1e5, (x) => x.alive);
    if (!r || !e) return this.say('No foes on the field', true);
    this.near(r, e.pos, e.radius + 5);
  }
  tpShop() {
    const r = this.run();
    const s = r?.shop.nearestShop();
    if (!r || !s) return this.say('No shop in this area', true);
    this.near(r, s.pos, 7);
  }
  tpArena() {
    const r = this.run();
    if (!r) return;
    const z = r.world.sa.zones[r.world.activeZone] ?? r.world.sa.zones[0];
    const s = this.safeNear(r, z.cx, z.cz);
    this.teleport(s.x, s.z);
  }

  // ------------------------------------------------------------------ CHEAT
  heal() {
    const p = this.run()?.player;
    if (!p?.alive) return;
    p.heal(p.maxHp);
    p.status.clear();
    this.say('Healed');
  }
  gold(n: number) {
    const r = this.run();
    if (!r) return;
    r.run.gold += n;
    r.run.totalGold += n;
    this.say(`+${n} gold`);
  }
  fullUlt() {
    const r = this.run();
    if (!r) return;
    r.run.ultCharge = 1;
    this.say("Serket's Wrath is full");
  }
  rankUp() {
    const r = this.run();
    if (!r) return;
    r.addBounty(r.run.bountyToNext - r.run.bounty + 0.01);
    this.close();
  }
  maxRank() {
    const r = this.run();
    if (!r) return;
    r.run.rank = Math.max(r.run.rank, 50);
    r.run.bounty = 0;
    r.run.bountyToNext = rankCost(r.run.rank);
    r.hud.toast(`BOUNTY RANK ${r.run.rank}`, '#9dff3a', 'Admin');
    this.say(`Rank ${r.run.rank}`);
  }
  cardPicker() {
    const r = this.run();
    if (!r) return;
    r.picker.request();
    this.close();
  }
  killAll() {
    const r = this.run();
    if (!r) return;
    let n = 0;
    for (const e of r.enemies.list.slice()) {
      if (!e.alive) continue;
      r.enemies.damage(e, { base: e.hp * 10 + 1e5, kind: 'true', source: 'divine', canCrit: false });
      n++;
    }
    this.say(`${n} foes struck down`);
  }
  skipWave() {
    const r = this.run();
    if (!r) return;
    const d = r.director as unknown as { phase: string; nextWave: number; wave: number; start(n: number, now?: boolean): void; endWave(): void };
    if (d.phase === 'intro') {
      // the wave is still rising (its boss walks in on beginCombat): skip once it has
      this.say('The wave is rising: skipping in a moment');
      this.engine.tweens.after(1.4, () => this.skipWave());
      return;
    }
    if (d.phase === 'break') {
      d.start(d.nextWave, true);
      return this.say(`Wave ${d.nextWave} now`);
    }
    for (const b of r.bosses) if (b.alive && !b.escaped) this.bossKill(b);
    this.killAll();
    if (d.phase === 'combat' || d.phase === 'boss') d.endWave();
    this.say(`Wave ${d.wave} skipped`);
  }
  ringBell() {
    const r = this.run();
    if (!r) return;
    if (!r.director.inBreak) return this.say('The bell rings in the break between waves', true);
    r.director.ringBell();
  }

  // ------------------------------------------------------------------ GIVE / SPAWN
  give(d: UpgradeDef) {
    const r = this.run();
    if (!r) return;
    const lv = r.upgrades.apply(d.id);
    r.hud.toast(d.name.toUpperCase(), RARITY[d.rarity].color, d.learn ? 'Tarot card (admin)' : `Level ${lv} (admin)`);
    r.events.emit('upgradePicked', d.id, lv);
    this.say(`${d.name}: level ${lv} of ${d.maxLv}`);
  }
  private ahead(r: RunScene, dist: number, spread = 0) {
    const p = r.player.pos, a = r.camRig.yaw + spread;
    let x = p.x + Math.sin(a) * dist, z = p.z + Math.cos(a) * dist;
    if (r.world.storm.sdf(x, z) < 2) {
      const sp = r.director.spawnPoint(Math.min(8, dist), dist + 6);
      if (sp) {
        x = sp.x;
        z = sp.z;
      }
    }
    return { x, z };
  }
  spawnFoe(id: string, n: number, alpha: boolean) {
    const r = this.run();
    if (!r) return;
    const def = ENEMIES[id];
    if (def?.ai === 'vessel' && !r.enemies.vesselSpawner) return this.say('Boats only sail on the Nile stage', true);
    let made = 0;
    for (let i = 0; i < n; i++) {
      const p = this.ahead(r, 12 + Math.random() * 5, n > 1 ? (i / (n - 1) - 0.5) * 1.3 : 0);
      if (r.enemies.spawn(id, p.x, p.z, { alpha })) made++;
    }
    this.say(made ? `${made} x ${def?.name ?? id}${alpha ? ' (alpha)' : ''}` : `Could not place ${def?.name ?? id}`, !made);
  }
  private deps(r: RunScene): BossDeps {
    return { ctx: r.ctx, player: r.player, enemies: r.enemies, qte: r.qte, cam: r.camRig, cloth: r.cloth, stage: r.opts.stage ?? 'desert' };
  }
  private adopt(r: RunScene, b: Boss) {
    const p = this.ahead(r, 24);
    const pp = r.player.pos;
    b.place(p.x, p.z, Math.atan2(pp.x - p.x, pp.z - p.z));
    r.adoptBoss(b);
    this.say(`${b.name} called up`);
  }
  spawnBoss(e: BossEntry, tier: number) {
    const r = this.run();
    if (!r) return;
    try {
      prewarmBoss(e, r.ctx);
      this.adopt(r, e.make(this.deps(r), tier));
      this.close();
    } catch (err) {
      console.warn('[admin] boss spawn failed', err);
      this.say(`${e.label} could not be built here`, true);
    }
  }
  spawnWaveBoss() {
    const r = this.run();
    if (!r) return;
    const w = r.director.wave;
    const bw = w % 5 === 0 ? w : Math.max(5, w - (w % 5));
    try {
      if (r.opts.stage === 'nile') nilePrewarm(r.ctx, bw);
      this.adopt(r, makeBoss(this.deps(r), bw));
      this.close();
    } catch (err) {
      console.warn('[admin] boss spawn failed', err);
      this.say('That boss could not be built here', true);
    }
  }

  // ------------------------------------------------------------------ BOSS
  bossPhase(b: Boss, p: number) {
    const on = b as unknown as { onPhase(p: number): void };
    b.hp = p === 0 ? b.maxHp : Math.max(1, b.maxHp * (b.phases[p - 1] - 0.015));
    if (p > b.phase)
      while (b.phase < p) {
        b.phase++;
        on.onPhase(b.phase);
      }
    else b.phase = p;
    this.say(`${b.name}: phase ${p + 1}`);
  }
  bossHp(b: Boss, f: number) {
    const on = b as unknown as { onPhase(p: number): void };
    b.hp = Math.max(1, b.maxHp * f);
    while (b.phase < b.phases.length && b.frac <= b.phases[b.phase]) {
      b.phase++;
      on.onPhase(b.phase);
    }
    this.say(`${b.name}: ${Math.round(f * 100)}% health`);
  }
  bossKill(b: Boss) {
    b.invulnerable = false;
    b.takeDamage({ base: b.hp * 4 + 1e6, kind: 'true', source: 'divine', canCrit: false });
    if (b.alive && !b.escaped) {
      b.hp = 0;
      b.die();
    }
    this.say(`${b.name} falls`);
  }
  bossMove(b: Boss, name: string) {
    (b as unknown as { debug(n: string): void }).debug(name);
    this.say(`${b.name}: ${moveTitle(name)} next`);
  }

  // ------------------------------------------------------------------ SAVE
  /** open everything: the Nile, Mark, the hideout and Thoth's Hall, every look, move, plan and unlock */
  unlockAll() {
    Unlocks.tally(); // makes sure the save carries its progression block
    const d = loadSave();
    d.runs = Math.max(1, d.runs);
    for (const k of Object.keys(PRICES)) if (!d.unlocked.includes(k)) d.unlocked.push(k);
    const p = d.prog!;
    for (const u of UNLOCKS) {
      if (p.got.includes(u.id)) continue;
      p.got.push(u.id);
      p.shelved.push(u.id);
      if (u.kind === 'cosmetic' && !d.unlocked.includes(u.id.slice(9))) d.unlocked.push(u.id.slice(9));
    }
    writeSave(d);
    for (const t of TECHNIQUES) unlockMove(t.id);
    for (const b of blueprintDefs()) Blueprints.learn(b.id);
    this.say('Everything unlocked: the Nile, Mark, the hideout, the Hall, every look and plan');
  }
  bank(n: number) {
    const d = loadSave();
    d.bank += n;
    writeSave(d);
    this.say(`Bank: ${d.bank} gold`);
  }
  replayCards(featsOnly: boolean) {
    const got = loadSave().prog?.got ?? [];
    const list = featsOnly ? [Unlocks.def(NILE_UNLOCK)!, Unlocks.def(MARK_UNLOCK)!] : UNLOCKS.filter((u) => got.includes(u.id));
    if (!list.length) return this.say('Nothing unlocked yet: UNLOCK EVERYTHING first', true);
    UnlockReveal.ensure(this.engine);
    UnlockReveal.show(list);
    this.close();
    this.say(`${list.length} unlock card${list.length > 1 ? 's' : ''} queued`);
  }
  replayMenuReveals() {
    if (!hideoutOpen()) return this.say('The hideout opens after the first ride: UNLOCK EVERYTHING first', true);
    try {
      localStorage.removeItem('dustup-hideout-revealed');
      localStorage.removeItem('dustup-hall-awake');
    } catch {
      /* storage blocked */
    }
    this.scene('menu');
  }
  replayKhonsu() {
    // KhonsuSand plays the Nile / Mark reveal on its fall when ?reveal=1 is in the address
    try {
      const u = new URL(location.href);
      u.searchParams.set('reveal', '1');
      history.replaceState(history.state, '', u.toString());
    } catch {
      /* no history */
    }
    this.oneHit = true;
    this.sel.stage = 'desert';
    this.sel.wave = 75;
    this.go();
  }
  resetSave() {
    try {
      for (const k of Object.keys(localStorage)) if ((k.startsWith('dustup') || k.startsWith('sundown-')) && k !== 'dustup-admin') localStorage.removeItem(k);
    } catch {
      /* storage blocked */
    }
    location.reload();
  }
  /** stop remembering the typed ADMIN code on this device (from the next load) */
  forget() {
    forgetAdmin();
    this.say('Admin forgotten on this device: gone after a reload (unless the address or the build turns it on)');
  }
  /** what the save holds: [label, value, good?] */
  saveStatus(): [string, string, boolean?][] {
    const d = loadSave();
    const got = d.prog?.got.length ?? 0;
    const looks = Object.keys(PRICES).filter((k) => !k.startsWith('gun:'));
    const bp = Blueprints.count();
    return [
      ['RIDES', String(d.runs)],
      ['BANK', String(d.bank)],
      ['BEST WAVE', String(d.bestWave)],
      ['THE NILE', nileOpen() ? 'OPEN' : 'SEALED', nileOpen()],
      ['MARK', markOpen() ? 'FREED' : 'LOCKED', markOpen()],
      ['HIDEOUT', hideoutOpen() ? 'OPEN' : 'SHUT', hideoutOpen()],
      ['UNLOCKS', `${got} / ${UNLOCKS.length}`],
      ['LOOKS', `${looks.filter((k) => d.unlocked.includes(k)).length} / ${looks.length}`],
      ['PLANS', `${bp.found} / ${bp.total}`],
      ["ANUBIS' TALLY", String(Unlocks.tally())],
    ];
  }
}

let inst: AdminMode | null = null;
/** turn the admin testing mode on (once) */
export function installAdmin(engine: Engine) {
  inst ??= new AdminMode(engine);
  return inst;
}
