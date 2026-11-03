// Everything new in the hideout, behind one door so HubScene only needs a few
// hooks: the lived-in decor and the trophy wall, the fully 3D wardrobe, the
// gunsmith's bench and the board rack (no DOM panels: you click the real
// things), and the toys (the back-yard range, Twenty-One with Mama, the
// record crate and the dance).
//
// A "mode" owns the screen while you use a station: its own camera views (A/D
// glides between them), the things you can click (hover lifts them and names
// them in Alagard), the hero's pose, and Esc to step back to the carousel.
import * as THREE from 'three';
import { damp } from '../../../engine/math/rand';
import { BuildKit, HubHost, HubStation, HeroBubble, HUD_CSS, hubStats, saveHubStats, ease, clamp01, newFrame, resetJobs } from './HubKit';
import { HouseDecor } from './HouseDecor';
import { Wardrobe3D } from './Wardrobe3D';
import { Bench3D } from './Bench3D';
import { Garage3D } from './Garage3D';
import { ShootingRange } from './ShootingRange';
import { TwentyOne } from './TwentyOne';
import { Jukebox } from './Jukebox';

export interface View {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}
export interface Pick {
  obj: THREE.Object3D;
  tip: () => string;
  click: () => void;
  /** lift it a touch while hovered (default true) */
  lift?: boolean;
}
export interface Mode {
  id: string;
  /** the camera view to glide to (null: the station's shot) */
  view(): View | null;
  picks(): Pick[];
  /** A / D inside the mode */
  step?(d: number): void;
  update(t: number, rdt: number): void;
  poseHero?(t: number, rdt: number): void;
  /** the line of type under the shot */
  hint(): string;
  /** Esc: step back (return true when the mode is finished) */
  back(): boolean;
  /** let the camera's mouse parallax and the click go to the mode (the range aims with the mouse) */
  raw?: boolean;
  done: boolean;
}

const DUCK_JOKES = [
  'Squeak.',
  'Squeak squeak.',
  'SQUEEEAK.',
  'squeak... (it sounds tired)',
  'Pinch stirs. Pinch does not approve.',
  'The duck looks at you. You look at the duck.',
  'Mama Toad, from the hearth: "Leave that poor duck alone."',
  'Squeak. (in E flat)',
  'The duck has seen things.',
  'A toadlet squeaks back.',
  'Ten squeezes. The duck respects you now.',
];

export class HouseExtras {
  decor: HouseDecor;
  wardrobe: Wardrobe3D;
  bench: Bench3D;
  garage: Garage3D;
  range: ShootingRange;
  cards: TwentyOne;
  juke: Jukebox;
  bubble: HeroBubble;
  mode: Mode | null = null;
  private tip = document.createElement('div');
  private hintEl = document.createElement('div');
  private hover: Pick | null = null;
  private lifted = new Map<THREE.Object3D, number>();
  private ray = new THREE.Raycaster();
  // the camera: eased toward the mode's view, then eased back out to the station's shot
  private cp = new THREE.Vector3();
  private cl = new THREE.Vector3();
  private cf = 50;
  private camOn = false;
  private rel: { t: number; p: THREE.Vector3; l: THREE.Vector3; f: number } | null = null;
  private out: View = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };

  constructor(private h: HubHost) {
    this.bubble = new HeroBubble(h);
    this.decor = new HouseDecor(h, this.bubble);
    this.wardrobe = new Wardrobe3D(h, this.bubble);
    this.bench = new Bench3D(h, this.bubble);
    this.garage = new Garage3D(h);
    this.range = new ShootingRange(h, this.bubble);
    this.cards = new TwentyOne(h, this.bubble);
    this.juke = new Jukebox(h);
    resetJobs();
    this.tip.style.cssText = HUD_CSS + ';display:none;font-size:17px;z-index:9';
    this.hintEl.style.cssText = HUD_CSS + ';left:50%;bottom:24px;transform:translateX(-50%);font-size:16px;opacity:0;transition:opacity .4s';
    h.engine.overlay.append(this.tip, this.hintEl);
  }

  build(k: BuildKit) {
    for (const part of [this.decor, this.wardrobe, this.bench, this.garage, this.range, this.cards, this.juke] as { build(k: BuildKit): void }[]) {
      try {
        part.build(k);
      } catch (e) {
        console.warn('[hub+] build', e);
      }
    }
  }

  /** a mode owns the screen */
  get busy() {
    return !!this.mode;
  }
  /** the camera while a mode runs (and for a moment after, easing back) */
  get cam(): View | null {
    return this.camOn ? this.out : null;
  }
  /** the carousel is swinging away: drop any easing-back or push-in so the swing starts clean */
  cancel() {
    this.rel = null;
    this.decor.focus = null;
    if (!this.mode) this.camOn = false;
  }
  /** a station's E */
  use(st: HubStation): boolean {
    const m: Mode | null =
      st.id === 'wardrobe' ? this.wardrobe.enter()
      : st.id === 'bench' ? this.bench.enter()
      : st.id === 'garage' ? this.garage.enter()
      : st.id === 'range' ? this.range.enter()
      : st.id === 'cards' ? this.cards.enter()
      : st.id === 'gramophone' ? this.juke.enter()
      : null;
    if (st.id === 'trophies') {
      this.decor.yarn();
      return true;
    }
    if (!m) return false;
    this.begin(m);
    return true;
  }
  private begin(m: Mode) {
    this.mode = m;
    this.h.active = this.h.here;
    // start the camera where it is now
    const c = this.h.camera;
    this.cp.copy(c.position);
    this.cl.copy(c.position).add(c.getWorldDirection(new THREE.Vector3()).multiplyScalar(2));
    this.cf = c.fov;
    this.camOn = true;
    this.rel = null;
  }
  private end() {
    const m = this.mode;
    this.mode = null;
    this.h.active = null;
    this.setHover(null);
    this.tip.style.display = 'none';
    this.hintEl.style.opacity = '0';
    document.body.style.cursor = 'default';
    if (m) this.rel = { t: 0, p: this.cp.clone(), l: this.cl.clone(), f: this.cf };
  }
  /** Esc: true when the extras took it */
  escape(): boolean {
    if (!this.mode) return false;
    if (this.mode.back()) this.end();
    return true;
  }
  verbFor(st: HubStation): string | null {
    if (st.id === 'gramophone') return this.juke.playing ? 'Change the record' : 'Pick a record';
    if (st.id === 'range') return hubStats().rangeBest ? `Shoot bottles (best ${hubStats().rangeBest})` : 'Shoot bottles';
    return null;
  }
  onArrive(st: HubStation) {
    if (st.id === 'cards') this.cards.greet();
  }
  /** the rubber duck, with the odd joke */
  squeeze() {
    const s = hubStats();
    s.squeezes++;
    saveHubStats();
    const eng = this.h.engine;
    this.h.duckSquash = 1;
    const n = s.squeezes;
    eng.audio.play('duck_quack', { volume: 1, pitch: n % 7 === 0 ? 0.6 : n % 5 === 0 ? 1.6 : 0.9 + Math.random() * 0.3 });
    if (n % 3 === 0 || n === 1) {
      const j = DUCK_JOKES[Math.floor(n / 3) % DUCK_JOKES.length];
      if (j.startsWith('Mama')) this.h.say('Leave that poor duck alone, sugar.');
      else this.bubble.say(j, !j.startsWith('The') && !j.startsWith('A ') && !j.startsWith('Pinch') && !j.startsWith('Ten'));
    }
    if (n % 10 === 0) eng.audio.play('banjo_funny', { volume: 0.5 });
    if (n % 4 === 0) for (const b of this.h.toadlets) if (b.floor && b.hopT < 0) b.rig.root.position.y = b.home.y + 0.03;
  }

  /** after the walk/station animation: the mode's hands and feet */
  poseHero(t: number, rdt: number) {
    // the station idles that bend the whole body: dancing at the gramophone, sitting at the card table
    this.juke.poseHero(t, rdt);
    this.cards.poseHero(t, rdt);
    if (this.mode?.poseHero && this.mode !== this.cards && this.mode !== this.juke) this.mode.poseHero(t, rdt);
  }

  update(t: number, rdt: number) {
    const eng = this.h.engine;
    const inp = eng.input;
    newFrame(rdt);
    // the decor first: the trophy wall's photographs and mounts take the frame's heavy step before the rest
    this.decor.update(t, rdt);
    for (const p of [this.decor, this.range, this.cards, this.juke, this.wardrobe, this.bench, this.garage] as { update?(t: number, rdt: number): void; tick?(t: number, rdt: number): void }[]) p.tick?.(t, rdt);
    this.bubble.update(rdt);
    const m = this.mode;
    if (m) {
      m.update(t, rdt);
      if (m.done) this.end();
    }
    // ---- picking (hover lift + the name in type + click)
    let hov: Pick | null = null;
    if (this.mode && !this.mode.raw) {
      this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), this.h.camera);
      const picks = this.mode.picks();
      const hits = this.ray.intersectObjects(picks.map((p) => p.obj), true);
      if (hits.length) {
        let o: THREE.Object3D | null = hits[0].object;
        while (o && !hov) {
          const oo = o;
          hov = picks.find((p) => p.obj === oo) ?? null;
          o = o.parent;
        }
      }
      if (hov && inp.wasPressed('Mouse0')) {
        // let go of the hover lift before the mode animates the thing
        const o = hov.obj;
        if (o.userData.baseY !== undefined) {
          o.position.y = o.userData.baseY;
          delete o.userData.baseY;
        }
        this.lifted.delete(o);
        hov.click();
        hov = null;
      }
      // A / D glide between the mode's views
      if (this.mode?.step) {
        if (inp.wasPressed('KeyA') || inp.wasPressed('ArrowLeft')) this.mode.step(-1);
        else if (inp.wasPressed('KeyD') || inp.wasPressed('ArrowRight')) this.mode.step(1);
      }
    }
    this.setHover(hov);
    for (const [o, k] of this.lifted) {
      const want = this.hover?.obj === o && this.hover.lift !== false ? 1 : 0;
      const nk = damp(k, want, 12, rdt);
      const base = (o.userData.baseY as number) ?? o.position.y;
      o.userData.baseY = base;
      o.position.y = base + nk * 0.012;
      if (nk < 0.001 && !want) {
        o.position.y = base;
        delete o.userData.baseY;
        this.lifted.delete(o);
      } else this.lifted.set(o, nk);
    }
    const tipText = hov?.tip() ?? '';
    if (tipText) {
      this.tip.textContent = tipText;
      this.tip.style.display = 'block';
      this.tip.style.left = `${inp.mouseX + 18}px`;
      this.tip.style.top = `${inp.mouseY + 14}px`;
    } else this.tip.style.display = 'none';
    const hubHint = (this.h as unknown as { hint: HTMLDivElement }).hint;
    if (hubHint) hubHint.style.visibility = this.mode ? 'hidden' : '';
    const hint = this.mode?.hint() ?? '';
    if (this.hintEl.textContent !== hint) this.hintEl.textContent = hint;
    this.hintEl.style.opacity = hint ? '0.92' : '0';
    // ---- the camera
    if (this.mode) {
      const v = this.mode.view();
      if (v) {
        const k = 1 - Math.exp(-rdt * 3.2);
        this.cp.lerp(v.pos, k);
        this.cl.lerp(v.look, k);
        this.cf += (v.fov - this.cf) * k;
      }
      this.out.pos.copy(this.cp);
      this.out.look.copy(this.cl);
      this.out.fov = this.cf;
    } else if (this.rel) {
      // ease back to the station's shot
      const r = this.rel;
      r.t += rdt;
      const u = ease(clamp01(r.t / 1.1));
      const shot = (this.h as unknown as { shotOf(st: HubStation): View }).shotOf(this.h.here);
      this.out.pos.lerpVectors(r.p, shot.pos, u);
      this.out.look.lerpVectors(r.l, shot.look, u);
      this.out.fov = r.f + (shot.fov - r.f) * u;
      if (u >= 1) {
        this.rel = null;
        this.camOn = false;
      }
    } else this.camOn = false;
    if (this.decor.focus && !this.mode) {
      // the trophy push-in rides on the same camera
      const f = this.decor.focus;
      const shot = (this.h as unknown as { shotOf(st: HubStation): View }).shotOf(this.h.here);
      const u = ease(clamp01(f.t / 1.4)) * (1 - ease(clamp01((f.t - (f.dur - 1.3)) / 1.3)));
      this.out.pos.lerpVectors(shot.pos, f.pos, u);
      this.out.look.lerpVectors(shot.look, f.look, u);
      this.out.fov = shot.fov + (f.fov - shot.fov) * u;
      this.camOn = true;
    }
  }

  private setHover(p: Pick | null) {
    if (p === this.hover) return;
    this.hover = p;
    if (p) {
      this.h.engine.audio.play('ui_hover', { volume: 0.22 });
      if (p.lift !== false && !this.lifted.has(p.obj)) this.lifted.set(p.obj, 0);
    }
    document.body.style.cursor = p ? 'pointer' : this.mode ? 'default' : document.body.style.cursor;
  }

  dispose() {
    this.tip.remove();
    this.hintEl.remove();
    this.bubble.dispose();
    for (const p of [this.decor, this.wardrobe, this.bench, this.garage, this.range, this.cards, this.juke] as { dispose?(): void }[]) p.dispose?.();
  }
}
