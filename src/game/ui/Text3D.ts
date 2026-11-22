// TEXT 3D: the HUD's type as little extruded letterforms instead of ink on paper.
// Alagard on whole pixels (coverage thresholded, so it stays crisp at any HUD scale), set as
// a solid block of type: a lit bevel on the top edge of every stroke, a face that darkens
// toward its foot, a short extrusion stepping down-right in the face's own shaded tone, a
// thin dark rim round the whole silhouette, and a soft drop shadow under it so the words
// float over the desert with no plate behind them. Cached per string and style.
//
//   text3d(c, 'QUEST TAKEN', x, y, { face: T3D.brass })          // HUD canvas, HUD px
//   text3dScaled(c, q, 'Hello', x, y, { face: T3D.cream })       // a canvas at q px per HUD px (TextPlane)
//   text3dCanvas('Hello', { face: T3D.jade })                    // the cached sprite + its origin, for textures
//
// The palette (T3D) is the bright UI set: warm creams, bright brass and jade, blood and sky.
import * as THREE from 'three';
import { pixelTextWidth } from './HudSprites';

/** the bright UI type colours */
export const T3D = {
  cream: '#fff6e2',
  dim: '#ead8b4',
  brass: '#ffcf5a',
  gold: '#ffe08a',
  jade: '#62f0bc',
  sky: '#8ee6ff',
  blood: '#ff6a4c',
  venom: '#b4f25a',
  bone: '#f4ecdc',
} as const;

export interface Text3DOpts {
  /** font size in HUD px (16 is Alagard's own pixel size) */
  size?: number;
  /** face colour (any CSS colour) */
  face: string;
  align?: 'left' | 'center' | 'right';
  /** extrusion depth in HUD px (default 2 at size 16, scaled with the size) */
  depth?: number;
  /** rim colour round the silhouette (default a deep tone of the face) */
  rim?: string;
  /** drop-shadow strength 0..1 (default 0.6) */
  shadow?: number;
}

type RGB = [number, number, number];
const toRGB = (s: string): RGB => {
  const c = new THREE.Color(s);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
};
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** a darker tone that keeps the hue rich (shaded side of a coloured solid, not grey) */
const shade = (a: RGB, k: number): RGB => {
  const m = Math.max(a[0], a[1], a[2]) || 1;
  return [a[0] * k * (0.86 + 0.14 * (a[0] / m)), a[1] * k * (0.8 + 0.2 * (a[1] / m)), a[2] * k * (0.9 + 0.1 * (a[2] / m))];
};
const fontReady = (size: number) => {
  try {
    return document.fonts?.check?.(`${size}px Alagard`) ?? true;
  } catch {
    return true;
  }
};

export interface Text3DSprite {
  cv: HTMLCanvasElement;
  /** where the text origin (top-left of the first glyph) sits inside the canvas */
  ox: number;
  oy: number;
  /** advance width of the text (HUD px) */
  w: number;
}

const cache = new Map<string, Text3DSprite>();
const PAD = 6;

/** the cached sprite of a line of 3D type */
export function text3dCanvas(str: string, o: Text3DOpts): Text3DSprite {
  const size = Math.max(6, Math.round(o.size ?? 16));
  const depth = Math.max(1, Math.round(o.depth ?? Math.max(1, (size / 16) * 2)));
  const sh = o.shadow ?? 0.6;
  const key = `${str}|${size}|${o.face}|${depth}|${o.rim ?? ''}|${sh}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // the glyph mask on whole pixels
  const m = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  m.font = `${size}px Alagard`;
  const tw = Math.ceil(m.measureText(str).width);
  const W = tw + PAD * 2 + depth + 2, H = Math.ceil(size * 1.25) + PAD * 2 + depth + 2;
  const mc = document.createElement('canvas');
  mc.width = W;
  mc.height = H;
  const g = mc.getContext('2d', { willReadFrequently: true })!;
  g.font = `${size}px Alagard`;
  g.textBaseline = 'top';
  g.fillStyle = '#fff';
  g.fillText(str, PAD, PAD);
  const src = g.getImageData(0, 0, W, H).data;
  const face = new Uint8Array(W * H);
  let top = H, bot = 0;
  for (let i = 0; i < W * H; i++)
    if (src[i * 4 + 3] >= 110) {
      face[i] = 1;
      const y = (i / W) | 0;
      if (y < top) top = y;
      if (y > bot) bot = y;
    }
  const at = (a: Uint8Array, x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && a[y * W + x] === 1;
  // the extrusion: the face stepped down-right, layer by layer
  const ext = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (face[y * W + x]) continue;
      for (let d = 1; d <= depth; d++)
        if (at(face, x - d, y - d)) {
          ext[y * W + x] = d;
          break;
        }
    }
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && (face[y * W + x] === 1 || ext[y * W + x] > 0);
  const F = toRGB(o.face);
  const white: RGB = [255, 255, 255];
  const lit = mixRGB(F, white, 0.55);
  const foot = shade(F, 0.8);
  const bevel = shade(F, 0.66);
  const side0 = shade(F, 0.5), side1 = shade(F, 0.3);
  const rim = o.rim ? toRGB(o.rim) : shade(F, 0.12);
  const img = g.createImageData(W, H);
  const d = img.data;
  const set = (i: number, c: RGB, a = 255) => {
    d[i * 4] = c[0];
    d[i * 4 + 1] = c[1];
    d[i * 4 + 2] = c[2];
    d[i * 4 + 3] = a;
  };
  const span = Math.max(1, bot - top);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (face[i]) {
        // lit bevel on top edges, a shaded bevel on the lower-right edges, the face darkening to its foot
        if (!at(face, x, y - 1) || (!at(face, x - 1, y) && !at(face, x - 1, y - 1))) set(i, lit);
        else if (!at(face, x + 1, y + 1) && (!at(face, x, y + 1) || !at(face, x + 1, y))) set(i, bevel);
        else set(i, mixRGB(F, foot, Math.min(1, Math.max(0, (y - top) / span - 0.35) * 1.6)));
      } else if (ext[i]) set(i, ext[i] === 1 ? side0 : mixRGB(side0, side1, (ext[i] - 1) / Math.max(1, depth - 1)));
      else if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) set(i, rim);
    }
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const oc = out.getContext('2d')!;
  // the soft drop shadow: the silhouette blurred and dropped under the letters
  if (sh > 0) {
    const sc = document.createElement('canvas');
    sc.width = W;
    sc.height = H;
    const sg = sc.getContext('2d')!;
    const si = sg.createImageData(W, H);
    for (let i = 0; i < W * H; i++) if (d[i * 4 + 3]) si.data[i * 4 + 3] = 255;
    sg.putImageData(si, 0, 0);
    oc.save();
    oc.shadowColor = `rgba(16,8,4,${0.75 * sh})`;
    oc.shadowBlur = 3 + size / 16;
    oc.shadowOffsetX = 1 + W * 4;
    oc.shadowOffsetY = 2;
    oc.drawImage(sc, -W * 4, 0);
    oc.restore();
  }
  g.putImageData(img, 0, 0);
  oc.drawImage(mc, 0, 0);
  const res: Text3DSprite = { cv: out, ox: PAD, oy: PAD, w: tw };
  if (fontReady(size)) {
    cache.set(key, res);
    if (cache.size > 320) cache.delete(cache.keys().next().value!);
  }
  return res;
}

/** draw a line of 3D type on a HUD canvas (HUD px); returns its advance width */
export function text3d(c: CanvasRenderingContext2D, str: string, x: number, y: number, o: Text3DOpts) {
  if (!str) return 0;
  const s = text3dCanvas(str, o);
  const al = o.align ?? 'left';
  const X = al === 'center' ? x - s.w / 2 : al === 'right' ? x - s.w : x;
  c.drawImage(s.cv, Math.round(X) - s.ox, Math.round(y) - s.oy);
  return s.w;
}

/** the same on a canvas drawn at q canvas px per HUD px (TextPlane / FloatText textures), nearest-neighbour */
export function text3dScaled(c: CanvasRenderingContext2D, q: number, str: string, x: number, y: number, o: Text3DOpts) {
  if (!str) return 0;
  const s = text3dCanvas(str, o);
  const al = o.align ?? 'left';
  const X = al === 'center' ? x - s.w / 2 : al === 'right' ? x - s.w : x;
  const prev = c.imageSmoothingEnabled;
  c.imageSmoothingEnabled = false;
  c.drawImage(s.cv, Math.round((X - s.ox) * q), Math.round((y - s.oy) * q), s.cv.width * q, s.cv.height * q);
  c.imageSmoothingEnabled = prev;
  return s.w;
}

/** advance width of a line of 3D type (HUD px) */
export function text3dWidth(str: string, size = 16) {
  return pixelTextWidth(str, size);
}
