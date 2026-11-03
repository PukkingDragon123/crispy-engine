// Zone-entry cutscene. The first time the hunter rides into a newly opened zone the
// letterbox closes in, time all but stops, and the camera cranes over the zone's
// landmark in a sweeping descending arc while the zone's name types itself out in
// big glowing Alagard letters above it; then everything eases back into play (~6 s).
//
// Self-driving: it watches the hunter from `engine.onAfterUpdate`, so it keeps
// running (and always hands control back) even on frames where the run scene
// returns early. The owner only constructs it and disposes it on exit.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import { Ease } from '../../engine/Tween';
import type { CameraRig, CineShot } from '../player/CameraRig';
import type { World } from '../world/World';
import { LANDMARK_INFO, type LandmarkType, type ZoneDef } from '../world/RegionGen';
import { FloatText3D } from '../fx/FloatText3D';

export interface ZoneCineDeps {
  engine: Engine;
  world: World;
  camRig: CameraRig;
  /** the run's scene (the title lives in it; the cutscene stops itself when this scene is no longer current) */
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** the hunter's position (read every frame; may be null before the player exists) */
  player: () => THREE.Vector3 | null | undefined;
  /** show / hide the HUD */
  hud?: (on: boolean) => void;
  /** false while something else owns the screen (shop, picker, trial, boss intro, pause) */
  canPlay?: () => boolean;
  /** extra beat when the title lands (music sting etc.) */
  onTitle?: (zone: ZoneDef) => void;
}

interface Mark {
  x: number;
  y: number;
  z: number;
  /** rough height of the landmark (m) */
  h: number;
  /** footprint half size (m): the orbit never passes through it */
  half: number;
}

const PRIORITY: Record<string, number> = { landmark: 10, capstone: 9, sphinx: 9, statue: 8, giantSkull: 8, stoneGate: 7, boneGate: 7, ribArch: 6, obelisk: 6, watchtower: 5, windmill: 5, waterTower: 5, hieroglyphWall: 4, column: 3, shack: 2, totem: 1 };
const HEIGHT: Record<string, number> = { landmark: 12, sphinx: 8, statue: 8, giantSkull: 6, stoneGate: 8, boneGate: 8, ribArch: 8, obelisk: 9, watchtower: 10, windmill: 12, waterTower: 11, hieroglyphWall: 5, column: 7, shack: 6, totem: 4 };
const GLOW: Record<string, string> = { A: '#ff9a3a', B: '#46d8c8', C: '#ff5a3a' };
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _p = new THREE.Vector3();
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** seconds: flyover length, title in, title out, blend back */
const DUR = 5.0;
const T_TITLE = 0.95;
const T_FADE = 4.3;
const T_BACK = 1.1;

export class ZoneCine {
  active = false;
  /** zone indices whose cutscene already played (or that were never "entered") */
  readonly seen = new Set<number>();
  private t = 0;
  private zone: ZoneDef | null = null;
  private mark: Mark = { x: 0, y: 0, z: 0, h: 6, half: 4 };
  private orbit = { a0: 0, a1: 0, r0: 40, r1: 20, y0: 20, y1: 6 };
  private shot: CineShot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 52 };
  private title: FloatText3D | null = null;
  private sub: FloatText3D | null = null;
  private titleSize = 1.4;
  private titleLines = 1;
  private ending = false;
  private resolve: (() => void) | null = null;
  private disposed = false;
  private readonly tick = (_dt: number, rdt: number) => this.update(rdt);

  constructor(private d: ZoneCineDeps) {
    for (let i = 0; i <= d.world.activeZone; i++) this.seen.add(i);
    d.engine.onAfterUpdate.push(this.tick);
  }

  /** play the cutscene for a zone now (normally triggered automatically on entry) */
  play(zone: ZoneDef): Promise<void> {
    if (this.active || this.disposed) return Promise.resolve();
    const eng = this.d.engine;
    this.seen.add(zone.index);
    this.active = true;
    this.ending = false;
    this.zone = zone;
    this.t = 0;
    const L = (this.mark = this.landmark(zone));
    const p = this.d.player() ?? new THREE.Vector3(zone.cx, 0, zone.cz);
    // start on the hunter's side, high and wide; sweep ~70 degrees while craning down and in
    const a0 = Math.atan2(p.z - L.z, p.x - L.x);
    const side = (zone.index & 1) === 0 ? 1 : -1;
    const dist = Math.hypot(p.x - L.x, p.z - L.z);
    const r1 = Math.max(16 + L.h * 0.8, L.half + 9);
    this.orbit = { a0, a1: a0 + side * 1.2, r0: THREE.MathUtils.clamp(dist * 0.85, r1 + 16, 64), r1, y0: L.h + 18, y1: L.h * 0.4 + 3.5 };
    this.evalShot(0);
    this.d.camRig.setCine(this.shot);
    eng.letterbox(true, 0.55);
    eng.input.enabled = false;
    eng.slowMo(0.04, 12);
    this.d.hud?.(false);
    eng.audio.play('whoosh_big', { volume: 0.5 });
    return new Promise((res) => (this.resolve = res));
  }

  /** cut the running cutscene short and hand control back */
  skip() {
    if (this.active && !this.ending) this.t = Math.max(this.t, DUR);
  }

  private update(rdt: number) {
    if (this.disposed) return;
    const eng = this.d.engine;
    if (eng.current && eng.current.scene !== this.d.scene) {
      this.dispose();
      return;
    }
    if (this.active) {
      this.step(rdt);
      return;
    }
    const p = this.d.player();
    if (!p) return;
    const w = this.d.world;
    for (let i = 1; i <= w.unlockedZone && i < w.sa.zones.length; i++) {
      if (this.seen.has(i)) continue;
      const z = w.sa.zones[i];
      if (Math.hypot(p.x - z.cx, p.z - z.cz) > z.r - 5) continue;
      // wait for a free screen (another cinematic, a modal, a boss intro) and play then
      if ((this.d.canPlay && !this.d.canPlay()) || this.d.camRig.cine) return;
      void this.play(z);
      return;
    }
  }

  private step(rdt: number) {
    this.t += rdt;
    const t = this.t;
    if (!this.ending) this.evalShot(Math.min(1, t / DUR));
    if (t >= T_TITLE && !this.title && this.zone) this.showTitle(this.zone);
    if (t >= T_FADE) {
      this.title?.show(false);
      this.sub?.show(false);
    }
    const cam = this.d.camera;
    if (this.title) this.placeTitle(t);
    this.title?.update(rdt, cam);
    this.sub?.update(rdt, cam);
    if (t >= DUR && !this.ending) this.handBack();
    if (t >= DUR + T_BACK) this.finish();
  }

  /** the shot at progress k (0..1): a descending arc around the landmark */
  private evalShot(k: number) {
    const L = this.mark, o = this.orbit;
    const e = Ease.inOutSine(k);
    const a = o.a0 + (o.a1 - o.a0) * e;
    const r = o.r0 + (o.r1 - o.r0) * Ease.outCubic(k);
    const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
    const y = L.y + o.y0 + (o.y1 - o.y0) * Ease.inOutCubic(k);
    this.shot.pos.set(x, Math.max(y, this.d.world.groundAt(x, z) + 2.5), z);
    this.shot.look.set(L.x, L.y + L.h * 0.5 + (1 - e) * 2.5, L.z);
    this.shot.fov = 54 - 10 * e;
  }

  private showTitle(zone: ZoneDef) {
    const sa = this.d.world.sa;
    const name = zone.name.toUpperCase();
    const lines = name.length > 20 ? 2 : 1;
    const len = Math.min(20, name.length);
    // about 60% of the frame wide at the title's distance in front of the lens
    const size = THREE.MathUtils.clamp(15 / (len * 0.56), 0.9, 2.2);
    this.titleSize = size;
    this.titleLines = lines;
    const glow = GLOW[sa.key] ?? '#ffb070';
    this.title = new FloatText3D(name, { size, px: 112, cps: 15, wrap: 20, color: '#fff0cf', glow, hdr: 1.45 });
    this.sub = new FloatText3D(`ZONE ${ROMAN[zone.index] ?? zone.index + 1}  ·  ${sa.name.toUpperCase()}`, { size: size * 0.32, px: 64, cps: 0, wrap: 48, color: '#f6dcae', glow, hdr: 1.2 });
    this.placeTitle(this.t);
    for (const ft of [this.title, this.sub]) {
      (ft.mesh.material as THREE.MeshBasicMaterial).fog = false;
      this.d.scene.add(ft.mesh);
    }
    this.sub.show(true);
    this.d.engine.audio.play('divine_chime', { volume: 0.45 });
    this.d.onTitle?.(zone);
  }

  /**
   * The title floats in the air between the lens and the landmark, a little above the
   * centre of frame and drifting slowly across it, so it is always framed whatever
   * the crane does.
   */
  private placeTitle(t: number) {
    const cam = this.d.camera;
    const fwd = _f.copy(this.shot.look).sub(this.shot.pos).normalize();
    const right = _r.crossVectors(fwd, _u.set(0, 1, 0)).normalize();
    const up = _u.crossVectors(right, fwd).normalize();
    const D = 17;
    const drift = (t - T_TITLE) * 0.18 - 0.4;
    const s = this.titleSize;
    const base = _p.copy(cam.position).addScaledVector(fwd, D).addScaledVector(right, drift).addScaledVector(up, 2.0 + s * 0.3);
    this.title!.anchor.copy(base);
    this.sub!.anchor.copy(base).addScaledVector(up, -(s * this.titleLines * 0.62 + s * 0.38));
  }

  private handBack() {
    const eng = this.d.engine;
    this.ending = true;
    this.d.camRig.setCine(null);
    eng.letterbox(false, 0.7);
    eng.input.enabled = true;
    eng.slowMo(1, 5);
    this.d.hud?.(true);
  }

  private finish() {
    if (!this.ending) this.handBack();
    this.title?.dispose();
    this.sub?.dispose();
    this.title = this.sub = null;
    this.active = false;
    this.zone = null;
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }

  /** the zone's most iconic structure (or its heart when it has none) */
  private landmark(zone: ZoneDef): Mark {
    const w = this.d.world;
    let best: (typeof zone.anchors)[number] | null = null;
    let bestScore = -1;
    for (const a of zone.anchors) {
      const pr = PRIORITY[a.kind];
      if (pr === undefined) continue;
      const score = pr * 1000 - Math.hypot(a.x - zone.cx, a.z - zone.cz);
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    if (!best) return { x: zone.cx, y: w.groundAt(zone.cx, zone.cz), z: zone.cz, h: 6, half: 4 };
    const g = w.groundAt(best.x, best.z);
    let h = (HEIGHT[best.kind] ?? 6) * (best.scale ?? 1);
    let half = 4;
    if (best.kind === 'landmark') {
      const info = LANDMARK_INFO[best.data?.type as LandmarkType];
      if (info) half = Math.max(info.size[0], info.size[1]) * 0.5;
    }
    if (best.kind === 'capstone' && typeof best.data?.y === 'number') {
      h = Math.max(6, best.data.y - g);
      half = h * 0.9;
    }
    if (best.kind === 'sphinx') half = 9;
    return { x: best.x, y: g, z: best.z, h, half };
  }

  dispose() {
    if (this.disposed) return;
    if (this.active) this.finish();
    this.disposed = true;
    // may be called from inside the engine's onAfterUpdate loop: unhook after it
    setTimeout(() => {
      const list = this.d.engine.onAfterUpdate;
      const i = list.indexOf(this.tick);
      if (i >= 0) list.splice(i, 1);
    }, 0);
  }
}
