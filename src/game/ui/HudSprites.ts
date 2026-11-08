// The run HUD's sprite bank: every picture on the HUD (the revolver cylinder,
// shells, drum, soul jar, heart, tin star, tally board, wave plaque, stopwatch,
// tarot frames, guns, treasure, gear, items) is a PHOTOGRAPH of the game's own
// 3D model taken once by the IconFactory at the exact HUD-pixel size it is
// shown at, then finished as flat pixel art: posterised onto one limited warm
// palette (the pixel UI kit's ramps), with IconFactory's chunky ink outline and
// warm rim light. The pictures are blitted into the 2D HUD canvas on its integer
// pixel grid (nearest-neighbour upscale), so the whole HUD is one crisp layer,
// the same as the BOUNTY plank. Things that move are flip-books (several
// captures) or layers composited in 2D; nothing is re-photographed per frame.
//
// Captures are queued (highest priority first) and taken a few per frame from
// Hud3D.render(); a piece shows the last picture it had (any size) until the new
// one is ready, so a window resize never blinks. The cache lives for the session.
import * as THREE from 'three';
import { IconFactory } from './IconFactory';
import { UI } from './PixelUI';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';

export interface Sprite {
  cv: HTMLCanvasElement;
  w: number;
  h: number;
  /** the opaque body (ink outline excluded), sprite px */
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

/** one photograph: the object (a wrapper group: the IconFactory sets its yaw) and how to frame it */
export interface Shot {
  obj: THREE.Object3D;
  /** output size in HUD px */
  w: number;
  h: number;
  yaw?: number;
  pitch?: number;
  /** fraction of the frame the object fills (see IconFactory) */
  fill?: number;
  dy?: number;
  light?: 'studio' | 'sunset' | 'moon';
  /** supersampling (default 4) */
  ss?: number;
  /** 'hud' = the limited warm palette (default), 'art' = palette + a light ordered dither, 'none' */
  pal?: 'hud' | 'art' | 'none';
  ink?: string | null;
  rim?: string | null;
  /** trim to the opaque box (+ the ink) */
  crop?: boolean;
  /** frame the object so its box just fits the w×h canvas (inside a 1 px ink margin) instead of using `fill` */
  fit?: boolean;
  /** restore shared state after the photo */
  after?: () => void;
}

// ------------------------------------------------------------------ the palette
const HEX = [
  ...Object.values(UI.wood), ...Object.values(UI.iron), ...Object.values(UI.brass), ...Object.values(UI.parch), ...Object.values(UI.leather),
  ...Object.values(UI.blood), ...Object.values(UI.venom), ...Object.values(UI.sky), ...Object.values(UI.bone),
  // jade soul, tin, rust, gilt, blued steel / lapis, oxblood, dusk, flame
  '#0b3d2c', '#1d6a4a', '#2fbf7e', '#7cf2b4', '#eafff2',
  '#4e4a44', '#8a867c', '#bdb9ae', '#f2efe6',
  '#5a2a12', '#8a4a22', '#b8692e', '#d88a48',
  '#684414', '#a5752e', '#d6a64c', '#f8da86',
  '#141c44', '#2a3e8a', '#4a6ad0', '#8aa0c8',
  '#3a0c0a', '#6a1a14', '#3a2440', '#6a4a70', '#a87890',
  // neutral and warm greys (tin, steel, linen in shade) so they never fall to violet
  '#2e2a28', '#3e3a36', '#5a5650', '#6e6a64', '#a4a098', '#d4d0c6', '#8c7a6a', '#b8a490',
  // heart muscle and dried blood
  '#7a1c14', '#c43a2a', '#e8705a', '#4a0e0a',
  '#c86a20', '#f0a040', '#ffd070',
];
const PAL: [number, number, number][] = [...new Set(HEX)].map((h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});
const palMemo = new Map<number, number>();
/** nearest palette colour (red-mean weighted distance), memoised on a 6-bit grid */
export function palNearest(r: number, g: number, b: number): [number, number, number] {
  const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
  let i = palMemo.get(key);
  if (i === undefined) {
    let best = 1e18;
    i = 0;
    for (let k = 0; k < PAL.length; k++) {
      const [pr, pg, pb] = PAL[k];
      const rm = (r + pr) / 2;
      const dr = r - pr, dg = g - pg, db = b - pb;
      const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      if (d < best) {
        best = d;
        i = k;
      }
    }
    palMemo.set(key, i);
  }
  return PAL[i];
}

const INK = '#1a0e08';
const INK_RGB = [26, 14, 8];
const BAYER = [0, 2, 3, 1];

/** palette-map a captured canvas in place; returns the body box (ink excluded) */
function finish(cv: HTMLCanvasElement, pal: 'hud' | 'art' | 'none') {
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  const img = c.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
  for (let y = 0; y < cv.height; y++)
    for (let x = 0; x < cv.width; x++) {
      const k = (y * cv.width + x) * 4;
      if (d[k + 3] < 128) {
        d[k + 3] = 0;
        continue;
      }
      d[k + 3] = 255;
      if (d[k] === INK_RGB[0] && d[k + 1] === INK_RGB[1] && d[k + 2] === INK_RGB[2]) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (pal === 'none') continue;
      let r = d[k], g = d[k + 1], b = d[k + 2];
      if (pal === 'art') {
        const t = (BAYER[(y & 1) * 2 + (x & 1)] - 1.5) * 7;
        r = Math.max(0, Math.min(255, r + t));
        g = Math.max(0, Math.min(255, g + t));
        b = Math.max(0, Math.min(255, b + t));
      }
      const p = palNearest(r, g, b);
      d[k] = p[0];
      d[k + 1] = p[1];
      d[k + 2] = p[2];
    }
  c.putImageData(img, 0, 0);
  if (x1 < 0) return { bx: 0, by: 0, bw: 0, bh: 0 };
  return { bx: x0, by: y0, bw: x1 - x0 + 1, bh: y1 - y0 + 1 };
}

function cropTo(cv: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  const o = document.createElement('canvas');
  o.width = Math.max(1, w);
  o.height = Math.max(1, h);
  o.getContext('2d')!.drawImage(cv, -x, -y);
  return o;
}

/** a warm studio for metal to reflect (soft key up-left, warm floor bounce, cool rim) */
export function studioEnv(renderer: THREE.WebGLRenderer) {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const pos = geo.getAttribute('position');
  const col: number[] = [];
  const c = new THREE.Color(), top = new THREE.Color(0x6a5a50), mid = new THREE.Color(0x2a1c16), low = new THREE.Color(0x8a5a30);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y > 0) c.copy(mid).lerp(top, y);
    else c.copy(mid).lerp(low, Math.min(1, -y * 1.6));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mats: THREE.Material[] = [new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })];
  s.add(new THREE.Mesh(geo, mats[0]));
  const panel = (w: number, h: number, colr: number, k: number, p: [number, number, number]) => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(colr).multiplyScalar(k), side: THREE.DoubleSide });
    mats.push(m);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    pl.position.set(...p);
    pl.lookAt(0, 0, 0);
    s.add(pl);
  };
  panel(7, 5, 0xfff0d8, 3.2, [-5, 5.5, 5]);
  panel(3, 6, 0xbfd8ff, 1.6, [6.5, 2, -3]);
  panel(9, 2, 0xffc070, 1.4, [0, -6, 4]);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.03);
  pm.dispose();
  geo.dispose();
  for (const m of mats) m.dispose();
  return rt;
}

/**
 * A mesh that renders nothing but counts toward the IconFactory's framing box:
 * every frame of a flip-book carries the same one, so all frames share one
 * framing (a beating heart stays the same size it was modelled at, a lid lines
 * up with its jar).
 */
export function framingBox(min: [number, number, number], max: [number, number, number]) {
  const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  g.translate((max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ visible: false }));
  m.frustumCulled = false;
  return m;
}

const BUDGET = (() => {
  try {
    const v = new URLSearchParams(location.search).get('hudbudget');
    return v ? +v : null;
  } catch {
    return null;
  }
})();

interface Job {
  key: string;
  fam: string;
  prio: number;
  seq: number;
  make: () => Shot | null;
}

export class SpriteBank {
  private static inst: SpriteBank | null = null;
  static get() {
    if (!this.inst) {
      this.inst = new SpriteBank();
      (window as any).__hudSprites = this.inst; // diagnostics (shots, ms, pending)
    }
    return this.inst;
  }
  private ready = new Map<string, Sprite | null>();
  private latest = new Map<string, Sprite>();
  private queue = new Map<string, Job>();
  private want = new Map<string, string>();
  private seq = 0;
  private icons: IconFactory | null = null;
  private env: THREE.WebGLRenderTarget | null = null;
  private mat: VoxelMaterial | null = null;
  /** diagnostics */
  shots = 0;
  ms = 0;
  slow: string[] = [];

  /** the voxel material every HUD photograph is lit with (reflects the studio) */
  material() {
    if (!this.mat) {
      this.mat = makeVoxelMaterial({ fog: false });
      this.mat.envMapIntensity = 1.0;
    }
    if (this.env && !this.mat.envMap) {
      this.mat.envMap = this.env.texture;
      this.mat.needsUpdate = true;
    }
    return this.mat;
  }
  envTexture() {
    return this.env?.texture ?? null;
  }

  /**
   * The picture `fam` at size `size`: returns it if photographed, otherwise queues
   * it and hands back the family's last picture (another size) or null.
   * One family = one picture in use at a time (its stale sizes are dropped from the queue).
   */
  get(fam: string, size: string | number, prio: number, make: () => Shot | null): Sprite | null {
    const key = fam + '@' + size;
    this.want.set(fam, key);
    const s = this.ready.get(key);
    if (s !== undefined) return s ?? this.latest.get(fam) ?? null;
    if (!this.queue.has(key)) this.queue.set(key, { key, fam, prio, seq: this.seq++, make });
    return this.latest.get(fam) ?? null;
  }
  /** the exact picture only (no stand-in) */
  exact(fam: string, size: string | number) {
    return this.ready.get(fam + '@' + size) ?? null;
  }
  get pending() {
    return this.queue.size;
  }

  /**
   * Take queued photographs (called once per frame by the HUD render). The first
   * read-back of a frame waits for the GPU to finish that frame's work, so the
   * budget counts from after it; `?hudbudget=ms` raises it (slow software GL).
   */
  pump(renderer: THREE.WebGLRenderer, budgetMs = 4) {
    if (!this.queue.size) return;
    this.icons ??= new IconFactory(renderer);
    if (!this.env) {
      this.env = studioEnv(renderer);
      this.material();
    }
    budgetMs = BUDGET ?? budgetMs;
    let t0 = performance.now();
    const tStart = t0;
    let n = 0;
    while (this.queue.size && (n === 0 || performance.now() - t0 < budgetMs)) {
      let best: Job | null = null;
      for (const j of this.queue.values()) {
        if (this.want.get(j.fam) !== j.key) {
          this.queue.delete(j.key);
          continue;
        }
        if (!best || j.prio > best.prio || (j.prio === best.prio && j.seq < best.seq)) best = j;
      }
      if (!best) break;
      this.queue.delete(best.key);
      n++;
      let sp: Sprite | null = null;
      const tj = performance.now();
      try {
        const shot = best.make();
        const tm = performance.now();
        if (shot) sp = this.shoot(shot);
        const te = performance.now();
        if (te - tj > 150 && this.slow.length < 40) this.slow.push(`${best.key}: make ${Math.round(tm - tj)} shoot ${Math.round(te - tm)}`);
      } catch (e) {
        console.warn('[hud sprites] capture failed', best.key, e);
      }
      this.ready.set(best.key, sp);
      if (sp) this.latest.set(best.fam, sp);
      if (n === 1) t0 = performance.now();
    }
    this.ms += performance.now() - tStart;
  }

  private shoot(s: Shot): Sprite {
    const ss = s.ss ?? 4;
    const w = Math.max(2, Math.round(s.w)), h = Math.max(2, Math.round(s.h));
    const ff = s.fit ? fitFill(s.obj, s.yaw ?? 0, s.pitch ?? 0.12, w, h) : { fill: s.fill ?? 0.9, hc: h };
    const fill = ff.fill;
    let cv = this.icons!.capture(s.obj, {
      w,
      h: ff.hc,
      ss,
      yaw: s.yaw ?? 0,
      pitch: s.pitch ?? 0.12,
      fill,
      dy: s.dy,
      light: s.light,
      ink: s.ink === undefined ? INK : s.ink,
      rim: s.rim,
      levels: 64,
    });
    s.after?.();
    if (ff.hc !== h) cv = cropTo(cv, 0, Math.floor((ff.hc - h) / 2), w, h);
    let box = finish(cv, s.pal ?? 'hud');
    let out = cv;
    if (s.crop && box.bw > 0) {
      const m = s.ink === null ? 0 : 1;
      const x = Math.max(0, box.bx - m), y = Math.max(0, box.by - m);
      const w = Math.min(cv.width, box.bx + box.bw + m) - x, h = Math.min(cv.height, box.by + box.bh + m) - y;
      out = cropTo(cv, x, y, w, h);
      box = { bx: box.bx - x, by: box.by - y, bw: box.bw, bh: box.bh };
    }
    this.shots++;
    return { cv: out, w: out.width, h: out.height, ...box };
  }
}

const _fb = new THREE.Box3();
const TAN_H = Math.tan(THREE.MathUtils.degToRad(28) / 2); // the IconFactory's lens
/**
 * The IconFactory `fill` (and capture height) that makes the object's box, as the
 * factory frames it (turned by `yaw`, seen from `pitch`), just fit a w×h picture
 * inside a 1 px ink margin. Very wide things are shot on a taller canvas (the
 * factory backs its camera off by half the width) and cropped back to h.
 */
function fitFill(obj: THREE.Object3D, yaw: number, pitch: number, w: number, h: number) {
  const pp = obj.position.clone(), pq = obj.quaternion.clone();
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, yaw, 0);
  obj.updateMatrixWorld(true);
  _fb.makeEmpty();
  obj.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) _fb.expandByObject(o);
  });
  obj.position.copy(pp);
  obj.quaternion.copy(pq);
  obj.updateMatrixWorld(true);
  if (_fb.isEmpty()) return { fill: 0.9, hc: h };
  const sx = _fb.max.x - _fb.min.x, sy = _fb.max.y - _fb.min.y, sz = _fb.max.z - _fb.min.z;
  const syv = sy * Math.cos(pitch) + sz * Math.abs(Math.sin(pitch));
  const E = Math.max(sx, sz) * 0.5; // the factory adds this much distance on its own
  let hc = h;
  for (let it = 0; it < 12; it++) {
    // distance to the box centre at which its near face just fits (pixel terms on an hc-tall canvas)
    const D = sz / 2 + Math.max((syv * hc) / (2 * TAN_H * (h - 2.2)), (sx * 1.03 * hc) / (2 * TAN_H * (w - 2.2)));
    if (D - E > D * 0.15 || it === 11) {
      const A = Math.max(sy, Math.max(sx, sz) / (w / hc));
      return { fill: Math.max(0.02, Math.min(4, A / (Math.max(1e-3, D - E) * 2 * TAN_H))), hc };
    }
    hc = Math.ceil(hc * 1.25 + 1);
  }
  return { fill: 0.9, hc: h };
}

// ------------------------------------------------------------------ drawing on the HUD grid

/** draw a sprite centred on (cx, cy), snapped to the HUD pixel grid; `w`/`h` scale it (nearest) */
export function blitC(c: CanvasRenderingContext2D, sp: Sprite | HTMLCanvasElement, cx: number, cy: number, alpha = 1, w?: number, h?: number) {
  const cv = 'cv' in sp ? sp.cv : sp;
  const dw = Math.max(1, Math.round(w ?? cv.width)), dh = Math.max(1, Math.round(h ?? cv.height));
  if (alpha <= 0.01) return;
  const a = c.globalAlpha;
  c.globalAlpha = a * Math.min(1, alpha);
  c.drawImage(cv, Math.round(cx - dw / 2), Math.round(cy - dh / 2), dw, dh);
  c.globalAlpha = a;
}

/** the classic 2D card / coin turn: squash horizontally by |sx| (sx < 0 = mirrored) */
export function blitSquash(c: CanvasRenderingContext2D, cv: HTMLCanvasElement, cx: number, cy: number, sx: number, alpha = 1, sy = 1) {
  const dw = Math.max(1, Math.round(cv.width * Math.abs(sx))), dh = Math.max(1, Math.round(cv.height * sy));
  const a = c.globalAlpha;
  c.globalAlpha = a * alpha;
  const x = Math.round(cx - dw / 2), y = Math.round(cy - dh / 2);
  if (sx < 0) {
    c.save();
    c.translate(x + dw, y);
    c.scale(-1, 1);
    c.drawImage(cv, 0, 0, dw, dh);
    c.restore();
  } else c.drawImage(cv, x, y, dw, dh);
  c.globalAlpha = a;
}

/** draw row by row with a horizontal offset per row (a hanging note swaying, a fanned card), crisp */
export function blitShear(c: CanvasRenderingContext2D, cv: HTMLCanvasElement, x: number, y: number, dx: (row: number) => number, alpha = 1) {
  const a = c.globalAlpha;
  c.globalAlpha = a * alpha;
  const X = Math.round(x), Y = Math.round(y);
  let r0 = 0, off = Math.round(dx(0));
  for (let r = 1; r <= cv.height; r++) {
    const o = r < cv.height ? Math.round(dx(r)) : NaN;
    if (o === off) continue;
    c.drawImage(cv, 0, r0, cv.width, r - r0, X + off, Y + r0, cv.width, r - r0);
    r0 = r;
    off = o;
  }
  c.globalAlpha = a;
}

const variants = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
/**
 * A post-processed copy of a picture (cached): 'flash' white-hot, 'dim' sunk in
 * shade, 'ember' red-hot, 'jade' soul-lit, 'grey' sealed / drained.
 */
export function variant(src: Sprite | HTMLCanvasElement, kind: 'flash' | 'dim' | 'ember' | 'jade' | 'grey'): HTMLCanvasElement {
  const cv = 'cv' in src ? src.cv : src;
  let m = variants.get(cv);
  if (!m) variants.set(cv, (m = new Map()));
  let o = m.get(kind);
  if (o) return o;
  o = document.createElement('canvas');
  o.width = cv.width;
  o.height = cv.height;
  const c = o.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(cv, 0, 0);
  const img = c.getImageData(0, 0, o.width, o.height);
  const d = img.data;
  for (let k = 0; k < d.length; k += 4) {
    if (!d[k + 3]) continue;
    const r = d[k], g = d[k + 1], b = d[k + 2];
    const l = r * 0.3 + g * 0.59 + b * 0.11;
    let p: [number, number, number];
    if (kind === 'flash') p = l < 40 ? [255, 214, 160] : [255, 248, 228];
    else if (kind === 'dim') p = palNearest(r * 0.5 + 6, g * 0.48 + 4, b * 0.5 + 8);
    else if (kind === 'ember') p = palNearest(Math.min(255, r * 1.1 + 40), g * 0.62, b * 0.5);
    else if (kind === 'jade') p = palNearest(r * 0.6, Math.min(255, g * 0.9 + 46), Math.min(255, b * 0.75 + 24));
    else p = palNearest(l * 0.62 + 10, l * 0.58 + 8, l * 0.6 + 12);
    d[k] = p[0];
    d[k + 1] = p[1];
    d[k + 2] = p[2];
  }
  c.putImageData(img, 0, 0);
  m.set(kind, o);
  return o;
}

/** a wrapper group (the IconFactory turns the wrapper; the content keeps its own pose) */
export function wrap(...o: THREE.Object3D[]) {
  const g = new THREE.Group();
  g.add(...o);
  return g;
}

// ------------------------------------------------------------------ type set on the HUD grid
const ptCache = new Map<string, HTMLCanvasElement>();
const fontReady = (size: number) => {
  try {
    return document.fonts?.check?.(`${size}px Alagard`) ?? true;
  } catch {
    return true;
  }
};
export interface PixelTextOpts {
  /** font size in HUD px (16 is Alagard's own pixel size; others are snapped to hard pixels) */
  size?: number;
  color: string;
  align?: 'left' | 'center' | 'right';
  /** dark outline colour (null: none) */
  outline?: string | null;
  /** a pale 1 px lip under the strokes (engraved / embossed type) */
  lip?: string | null;
  /** chipped paint: share of the letter pixels knocked out (0..0.3) */
  chip?: number;
}
/**
 * Alagard at any size as hard-edged pixel type (coverage thresholded, so even a
 * shrunken label on a phone stays crisp), with an optional outline, lip or chips. Cached.
 */
export function pixelText(c: CanvasRenderingContext2D, str: string, x: number, y: number, o: PixelTextOpts) {
  const size = Math.max(6, Math.round(o.size ?? 16));
  const key = `${str}|${size}|${o.color}|${o.outline ?? ''}|${o.lip ?? ''}|${o.chip ?? 0}`;
  let cv = ptCache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    const m = cv.getContext('2d', { willReadFrequently: true })!;
    m.font = `${size}px Alagard`;
    const w = Math.ceil(m.measureText(str).width) + 6;
    const h = Math.ceil(size * 1.25) + 5;
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    g.font = `${size}px Alagard`;
    g.textBaseline = 'top';
    g.fillStyle = '#ffffff';
    g.fillText(str, 2, 1);
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    const on = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) on[i] = d[i * 4 + 3] >= 110 ? 1 : 0;
    const hex = (s: string) => {
      const t = new THREE.Color(s);
      return [Math.round(t.r * 255), Math.round(t.g * 255), Math.round(t.b * 255)];
    };
    const col = hex(o.color);
    const ol = o.outline ? hex(o.outline) : null;
    const lip = o.lip ? hex(o.lip) : null;
    d.fill(0);
    const set = (i: number, rgb: number[]) => {
      d[i * 4] = rgb[0];
      d[i * 4 + 1] = rgb[1];
      d[i * 4 + 2] = rgb[2];
      d[i * 4 + 3] = 255;
    };
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && on[y * w + x] === 1;
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const i = yy * w + xx;
        if (on[i]) continue;
        if (ol && (at(xx - 1, yy) || at(xx + 1, yy) || at(xx, yy - 1) || at(xx, yy + 1) || at(xx - 1, yy - 1) || at(xx - 2, yy - 2))) set(i, ol);
        else if (lip && at(xx, yy - 1)) set(i, lip);
      }
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const i = yy * w + xx;
        if (!on[i]) continue;
        const hsh = Math.abs(Math.sin(xx * 12.9898 + yy * 78.233 + str.length) * 43758.5453) % 1;
        if (o.chip && hsh < o.chip) {
          if (ol) set(i, ol);
          continue;
        }
        set(i, col);
      }
    g.putImageData(img, 0, 0);
    if (fontReady(size)) {
      ptCache.set(key, cv);
      if (ptCache.size > 300) ptCache.delete(ptCache.keys().next().value!);
    }
  }
  const al = o.align ?? 'left';
  const tw = cv.width - 6;
  const X = al === 'center' ? x - tw / 2 : al === 'right' ? x - tw : x;
  c.drawImage(cv, Math.round(X) - 2, Math.round(y) - 1);
  return tw;
}
export function pixelTextWidth(str: string, size = 16) {
  const m = (pixelTextWidth as any).ctx ?? ((pixelTextWidth as any).ctx = document.createElement('canvas').getContext('2d'));
  m.font = `${Math.max(6, Math.round(size))}px Alagard`;
  return m.measureText(str).width * (fontReady(size) ? 1 : 1.3);
}
