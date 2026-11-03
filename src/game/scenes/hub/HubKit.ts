// Shared pieces for the hideout's extra stations and toys (see HouseExtras.ts):
// the slice of HubScene they talk to, the station shape they register, a small
// save of their own (best scores, the duck's count), a speech bubble for
// Sundown, and Alagard engraving into voxel models (typography only).
import * as THREE from 'three';
import type { Engine } from '../../../engine/Engine';
import type { RigInstance, RigSpec } from '../../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import type { Particles } from '../../fx/Particles';
import { Voice } from '../../audio/Voice';

export type SM = { model: VoxelModel; voxelSize: number; meta?: any } | undefined | null;
export type HubPose = 'door' | 'bench' | 'board' | 'mirror' | 'book' | 'hearth' | 'music' | 'range' | 'cards' | 'trophies';

export interface HubShot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  subject?: THREE.Vector3;
  ndc?: [number, number];
}
/** what an extra registers with the carousel (structurally the HubScene's Station) */
export interface HubStation {
  id: string;
  label: string;
  title: string;
  short: string;
  sub: string;
  verb: string;
  stand: THREE.Vector2;
  face: number;
  at: THREE.Vector3;
  r: number;
  objs: THREE.Object3D[];
  shot: HubShot;
  pose: HubPose;
  via: THREE.Vector2[];
  slot: [number, number, 'left' | 'right'];
  surf?: number;
  reach?: number;
  /** the camera swing's control point (when the straight arc would cut through a wall) */
  arc?: THREE.Vector3;
}
export type StationIn = Omit<HubStation, 'objs'> & { objs?: (THREE.Object3D | null)[] };

/** the placement helpers HubScene.build hands over */
export interface BuildKit {
  put(sm: SM, x: number, z: number, ry?: number, y?: number, scale?: number, solid?: boolean): THREE.Group | null;
  against(sm: SM, wall: 'back' | 'left' | 'right' | 'front', along: number, y?: number, gap?: number, scale?: number, solid?: boolean): THREE.Group | null;
  rig(spec: RigSpec | null, x: number, y: number, z: number, ry?: number, key?: string): RigInstance | null;
  station(o: StationIn): HubStation;
  lamp(color: number, intensity: number, dist: number, decay: number, p: THREE.Vector3, flick?: number): THREE.PointLight;
}

export interface Toadlet {
  rig: RigInstance;
  home: THREE.Vector3;
  hopT: number;
  floor: boolean;
}

/** the slice of HubScene the extras use (its fields are private there; the scene hands itself over as this) */
export interface HubHost {
  engine: Engine;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  particles: Particles;
  hero: RigInstance | null;
  heroSpec: RigSpec | null;
  heroHolder: THREE.Group;
  pinch: RigInstance | null;
  pos: THREE.Vector2;
  yaw: number;
  atK: number;
  armL1: number;
  armL2: number;
  route: THREE.Vector2[];
  stations: HubStation[];
  idx: number;
  panel: HTMLDivElement | null;
  active: HubStation | null;
  mama: RigInstance | null;
  mamaHead: THREE.Vector3;
  mamaTalk: number;
  mamaCd: number;
  knitK: number;
  gasp: number;
  toadlets: Toadlet[];
  duck: THREE.Object3D | null;
  duckSquash: number;
  entry: RigInstance | null;
  music: boolean;
  gramTop: THREE.Vector3;
  gust: number;
  readonly here: HubStation;
  readonly arrived: boolean;
  say(text: string): void;
  updateBank(): void;
  openPanel(html: HTMLElement, side: 'left' | 'right'): void;
  closePanel(): void;
}

// ------------------------------------------------------------------ the extras' own little save
const KEY = 'dustup-hub-v1';
export interface HubStats {
  rangeBest: number;
  rangeRounds: number;
  cardsWon: number;
  cardsLost: number;
  cardsNet: number;
  squeezes: number;
  record: string;
}
let stats: HubStats | null = null;
export function hubStats(): HubStats {
  if (stats) return stats;
  const d: HubStats = { rangeBest: 0, rangeRounds: 0, cardsWon: 0, cardsLost: 0, cardsNet: 0, squeezes: 0, record: '' };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(d, JSON.parse(raw));
  } catch {
    /* storage blocked */
  }
  stats = d;
  return d;
}
export function saveHubStats() {
  try {
    localStorage.setItem(KEY, JSON.stringify(hubStats()));
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ small helpers
export function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch (e) {
    console.warn('[hub+] failed', e);
    return null;
  }
}
export function geoOf(sm: SM, pivot: 'bottom' | 'center' | [number, number, number] = 'bottom') {
  if (!sm?.model) return null;
  const g = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot });
  g.computeBoundingBox();
  return g;
}
export function meshOf(g: THREE.BufferGeometry, mat: THREE.Material = sharedVoxelMaterial, shadow = true) {
  const m = new THREE.Mesh(g, mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
export const sstep = (a: number, b: number, v: number) => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
export const UI_CSS = "position:absolute;z-index:8;padding:16px 20px;background:#e8d4a4;border:4px solid #5a3418;box-shadow:0 6px 0 #2a1408;font-family:'Alagard';color:#2a1a10;font-size:17px;pointer-events:auto";
export const BTN_CSS = "font-family:'Alagard';font-size:17px;padding:4px 12px;background:#7a4a28;color:#fff3d6;border:3px solid #2a1408;box-shadow:0 3px 0 #2a1408;cursor:pointer";
export const HUD_CSS = "position:absolute;z-index:8;pointer-events:none;font-family:'Alagard';color:#fff3d6;text-shadow:0 2px 0 #2a1408,0 0 10px #000;white-space:nowrap";

export function button(label: string, onClick: () => void, extra = '') {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = BTN_CSS + ';' + extra;
  b.onmousedown = (e) => e.stopPropagation();
  b.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return b;
}

/**
 * Engrave Alagard type into a voxel model: the glyph mask (typography is the
 * only thing drawn) recolours the voxels of a face it lands on. `face` is the
 * plane z = const facing +Z; the text is centred on (cx, cy) within maxW voxels.
 */
export function engrave(m: VoxelModel, text: string, cx: number, cy: number, z: number, maxW: number, maxH: number, color: number, flags = 0) {
  const PX = 24;
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.font = `${PX}px Alagard`;
  const tw = Math.ceil(c.measureText(text).width) + 4;
  cv.width = tw;
  cv.height = PX + 8;
  c.font = `${PX}px Alagard`;
  c.fillStyle = '#fff';
  c.textBaseline = 'alphabetic';
  c.fillText(text, 2, PX);
  const img = c.getImageData(0, 0, cv.width, cv.height).data;
  // tight bounds of the ink
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < cv.height; y++)
    for (let x = 0; x < cv.width; x++)
      if (img[(y * cv.width + x) * 4 + 3] > 100) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return;
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  const k = Math.min(maxW / sw, maxH / sh);
  const W = Math.max(1, Math.round(sw * k)), H = Math.max(1, Math.round(sh * k));
  for (let vy = 0; vy < H; vy++)
    for (let vx = 0; vx < W; vx++) {
      // sample the mask under this voxel (any covered texel inks it)
      const sx0 = x0 + Math.floor(vx / k), sx1 = x0 + Math.floor((vx + 1) / k - 1e-6);
      const sy0 = y0 + Math.floor(vy / k), sy1 = y0 + Math.floor((vy + 1) / k - 1e-6);
      let cov = 0, n = 0;
      for (let sy = sy0; sy <= Math.max(sy0, sy1); sy++)
        for (let sx = sx0; sx <= Math.max(sx0, sx1); sx++) {
          n++;
          if (img[(sy * cv.width + sx) * 4 + 3] > 100) cov++;
        }
      if (cov / n < 0.34) continue;
      const x = Math.round(cx - W / 2 + vx), y = Math.round(cy + H / 2 - 1 - vy);
      if (m.has(x, y, z)) m.paintAt(x, y, z, color, flags || undefined);
      else m.set(x, y, z, color, flags || VF.SOLID);
    }
}

/** Sundown's own speech bubble (Mama's lives in HubScene): types itself over his hat, voiced */
export class HeroBubble {
  el = document.createElement('div');
  private text = '';
  private t = 0;
  private life = 0;
  constructor(private host: HubHost) {
    this.el.style.cssText = "position:absolute;z-index:7;pointer-events:none;display:none;transform:translate(-50%,-100%);max-width:280px;padding:8px 12px;background:#efe2c8;border:3px solid #3a2414;border-radius:14px;box-shadow:0 4px 0 #1a0c04;font-family:'Alagard';font-size:16px;color:#1e140c;text-align:center";
    host.engine.overlay.appendChild(this.el);
  }
  say(text: string, voice = true) {
    this.text = text;
    this.t = 0;
    this.life = 1.6 + text.length * 0.05;
    const head = this.head(new THREE.Vector3());
    if (voice) Voice.say('sundown', text, { pos: head, key: 'hub-sundown' });
    const h = this.host.hero;
    if (h?.nodes['jaw']) this.jawT = this.life;
  }
  jawT = 0;
  private jawWas = false;
  private head(out: THREE.Vector3) {
    const n = this.host.hero?.nodes['head'];
    if (n) n.getWorldPosition(out);
    else out.set(this.host.pos.x, 1.6, this.host.pos.y);
    return out.add(new THREE.Vector3(0, 0.42, 0));
  }
  update(rdt: number) {
    const h = this.host.hero, jaw = h?.nodes['jaw'];
    if (h && jaw && (this.jawT > 0 || this.jawWas)) {
      const rest = h.geo.parts[h.geo.index['jaw']]?.rest.x ?? 0;
      jaw.rotation.x = rest + h.exprJaw * 0.5 + (this.jawT > 0 ? Math.max(0, Math.sin(this.t * 13)) * 0.14 : 0);
    }
    this.jawWas = this.jawT > 0;
    this.jawT = Math.max(0, this.jawT - rdt);
    if (!this.text) {
      this.el.style.display = 'none';
      return;
    }
    this.t += rdt;
    const n = Math.min(this.text.length, Math.floor(this.t * 34));
    const p = this.head(new THREE.Vector3()).project(this.host.camera);
    if (p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 && this.host.engine.overlay) {
      this.el.style.display = 'block';
      this.el.style.left = `${((p.x + 1) / 2) * this.host.engine.width}px`;
      this.el.style.top = `${((1 - p.y) / 2) * this.host.engine.height}px`;
      if (this.el.textContent !== this.text.slice(0, n)) this.el.textContent = this.text.slice(0, n);
    } else this.el.style.display = 'none';
    if (this.t > this.life + 1.2) this.text = '';
  }
  hide() {
    this.text = '';
    this.el.style.display = 'none';
  }
  dispose() {
    this.el.remove();
  }
}
