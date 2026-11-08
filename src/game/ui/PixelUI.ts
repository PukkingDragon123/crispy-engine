// Procedural pixel-art UI kit (wood, iron, brass, parchment, rope) drawn pixel
// by pixel into cached offscreen canvases, plus Alagard text helpers.
// Everything is integer-aligned for crisp nearest-neighbour upscaling.
import { RNG } from '../../engine/math/rand';
import { HUD_ART } from './HudArt';

export const UI = {
  wood: { o: '#24140a', d: '#4f2f15', m: '#74461f', l: '#93602f', h: '#b98244', g: '#603818' },
  iron: { o: '#121519', d: '#2b323a', m: '#465260', l: '#6d7b89', h: '#a9b6c2' },
  brass: { o: '#2e1c06', d: '#7c5214', m: '#b88426', l: '#e2b24a', h: '#fff0a6' },
  parch: { o: '#4e3218', d: '#a9844e', m: '#d6b985', l: '#efdcb0', h: '#fff4d8' },
  leather: { o: '#1e110a', d: '#3e2414', m: '#5e3820', l: '#80502c' },
  blood: { o: '#2a0604', d: '#6a120c', m: '#a8221a', l: '#dc4430', h: '#ff8a6a' },
  venom: { o: '#0e2208', d: '#2e6a18', m: '#4fa52a', l: '#8fe03a', h: '#d8ff9a' },
  sky: { o: '#0e1a22', d: '#1f5a6a', m: '#35a8b8', l: '#6fe3cf', h: '#c8fff0' },
  bone: { o: '#3a2a1a', d: '#b8a07a', m: '#e0cfa8', l: '#f6ead0', h: '#ffffff' },
  text: '#fff3d6',
  textDim: '#c9a97c',
  shadow: '#1a0e06',
};

export const FONT = 'Alagard';

type Ctx2 = CanvasRenderingContext2D;

const cache = new Map<string, HTMLCanvasElement>();
function cached(key: string, w: number, h: number, draw: (c: Ctx2) => void) {
  let cv = cache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = Math.max(1, w);
    cv.height = Math.max(1, h);
    const c = cv.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    draw(c);
    cache.set(key, cv);
    if (cache.size > 400) cache.delete(cache.keys().next().value!);
  }
  return cv;
}

export function px(c: Ctx2, x: number, y: number, w: number, h: number, col: string) {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// ---------------------------------------------------------------- panels
export function woodPanel(w: number, h: number, seed = 1, opts: { iron?: boolean; vertical?: boolean; dark?: boolean } = {}) {
  return cached(`wood:${w}:${h}:${seed}:${opts.iron}:${opts.vertical}:${opts.dark}`, w, h, (c) => {
    const W = UI.wood;
    const r = new RNG(seed * 97 + w * 13 + h);
    px(c, 0, 0, w, h, W.o);
    const plank = 7;
    const inner = { x: 1, y: 1, w: w - 2, h: h - 2 };
    const n = Math.ceil((opts.vertical ? inner.w : inner.h) / plank);
    for (let i = 0; i < n; i++) {
      const tint = r.range(-0.08, 0.08);
      const base = shade(opts.dark ? W.d : W.m, tint);
      const p0 = i * plank;
      if (!opts.vertical) {
        const y = inner.y + p0, hh = Math.min(plank, inner.h - p0);
        px(c, inner.x, y, inner.w, hh, base);
        px(c, inner.x, y, inner.w, 1, shade(W.l, tint));
        px(c, inner.x, y + hh - 1, inner.w, 1, W.o);
        // grain
        for (let g = 0; g < inner.w / 5; g++) {
          const gx = inner.x + r.int(1, inner.w - 6), gy = y + r.int(1, Math.max(1, hh - 3));
          px(c, gx, gy, r.int(2, 7), 1, shade(W.g, tint));
        }
        if (r.chance(0.35) && inner.w > 16) {
          const kx = inner.x + r.int(4, inner.w - 6), ky = y + Math.floor(hh / 2) - 1;
          px(c, kx, ky, 3, 2, W.d);
          px(c, kx + 1, ky, 1, 1, W.o);
        }
        // nails at ends
        px(c, inner.x + 2, y + Math.floor(hh / 2), 1, 1, UI.iron.l);
        px(c, inner.x + inner.w - 3, y + Math.floor(hh / 2), 1, 1, UI.iron.l);
      } else {
        const x = inner.x + p0, ww = Math.min(plank, inner.w - p0);
        px(c, x, inner.y, ww, inner.h, base);
        px(c, x, inner.y, 1, inner.h, shade(W.l, tint));
        px(c, x + ww - 1, inner.y, 1, inner.h, W.o);
        for (let g = 0; g < inner.h / 5; g++) px(c, x + r.int(1, Math.max(1, ww - 3)), inner.y + r.int(1, inner.h - 6), 1, r.int(2, 7), shade(W.g, tint));
        px(c, x + Math.floor(ww / 2), inner.y + 2, 1, 1, UI.iron.l);
        px(c, x + Math.floor(ww / 2), inner.y + inner.h - 3, 1, 1, UI.iron.l);
      }
    }
    // bevel
    px(c, 1, 1, w - 2, 1, W.h);
    px(c, 1, h - 2, w - 2, 1, '#1a0d05');
    if (opts.iron) for (const [x, y, fx, fy] of [[0, 0, 1, 1], [w, 0, -1, 1], [0, h, 1, -1], [w, h, -1, -1]] as number[][]) bracket(c, x, y, fx, fy);
  });
}

function bracket(c: Ctx2, x: number, y: number, fx: number, fy: number) {
  const I = UI.iron;
  const L = 7, T = 3;
  const X = (v: number) => (fx > 0 ? x + v : x - v - 1);
  const Y = (v: number) => (fy > 0 ? y + v : y - v - 1);
  for (let i = 0; i < L; i++)
    for (let j = 0; j < T; j++) {
      const col = j === 0 ? I.l : j === T - 1 ? I.d : I.m;
      px(c, X(i), Y(j), 1, 1, col);
      px(c, X(j), Y(i), 1, 1, col);
    }
  px(c, X(1), Y(1), 1, 1, I.h);
  px(c, X(L - 2), Y(1), 1, 1, I.h);
  px(c, X(1), Y(L - 2), 1, 1, I.h);
}

export function ironPlate(w: number, h: number, seed = 1) {
  return cached(`iron:${w}:${h}:${seed}`, w, h, (c) => {
    const I = UI.iron;
    const r = new RNG(seed * 31 + w);
    px(c, 0, 0, w, h, I.o);
    px(c, 1, 1, w - 2, h - 2, I.m);
    px(c, 1, 1, w - 2, 1, I.l);
    px(c, 1, 1, 1, h - 2, I.l);
    px(c, 1, h - 2, w - 2, 1, I.d);
    px(c, w - 2, 1, 1, h - 2, I.d);
    for (let k = 0; k < (w * h) / 40; k++) px(c, r.int(2, w - 3), r.int(2, h - 3), 1, 1, r.chance(0.5) ? I.d : I.l);
    for (const [x, y] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) {
      px(c, x, y, 1, 1, I.h);
    }
  });
}

export function slot(size: number, seed = 1) {
  return cached(`slot:${size}:${seed}`, size, size, (c) => {
    const I = UI.iron, L = UI.leather;
    px(c, 0, 0, size, size, I.o);
    px(c, 1, 1, size - 2, size - 2, I.m);
    px(c, 1, 1, size - 2, 1, I.h);
    px(c, 1, size - 2, size - 2, 1, I.d);
    px(c, 3, 3, size - 6, size - 6, L.o);
    px(c, 4, 4, size - 8, size - 8, L.d);
    px(c, 4, 4, size - 8, 1, L.o);
    for (const [x, y] of [[2, 2], [size - 3, 2], [2, size - 3], [size - 3, size - 3]]) px(c, x, y, 1, 1, I.h);
  });
}

export function parchment(w: number, h: number, seed = 1) {
  return cached(`parch:${w}:${h}:${seed}`, w, h, (c) => {
    const P = UI.parch;
    const r = new RNG(seed * 7 + w);
    // ragged edge mask
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
        const rag = (r.next() < 0.25 ? 1 : 0) + (x + y) % 7 === 0 ? 1 : 0;
        if (edge < rag) continue;
        let col = P.m;
        if (edge <= 1) col = P.o;
        else if (edge <= 3) col = P.d;
        else if (r.next() < 0.05) col = P.d;
        else if (r.next() < 0.08) col = P.l;
        c.fillStyle = col;
        c.fillRect(x, y, 1, 1);
      }
    // stains
    for (let k = 0; k < 4; k++) {
      const sx = r.int(4, w - 8), sy = r.int(4, h - 8), s = r.int(2, 5);
      c.fillStyle = 'rgba(120,80,40,0.18)';
      c.fillRect(sx, sy, s, s);
    }
  });
}

/** ribbon banner with folded tails */
export function ribbon(w: number, col: { o: string; d: string; m: string; l: string }, seed = 1) {
  const h = 16;
  return cached(`ribbon:${w}:${col.m}:${seed}`, w + 16, h + 4, (c) => {
    // tails
    for (const side of [0, 1]) {
      const x0 = side ? w + 4 : 0;
      for (let y = 4; y < h + 4; y++)
        for (let x = 0; x < 12; x++) {
          const notch = side ? x > 8 && Math.abs(y - (h / 2 + 4)) < 12 - x : x < 4 && Math.abs(y - (h / 2 + 4)) < 4 - x;
          if (notch) continue;
          px(c, x0 + x, y, 1, 1, y === 4 || y === h + 3 ? col.o : col.d);
        }
    }
    // body
    px(c, 8, 0, w, h, col.o);
    px(c, 9, 1, w - 2, h - 2, col.m);
    px(c, 9, 1, w - 2, 1, col.l);
    px(c, 9, h - 2, w - 2, 1, col.d);
    // stitching
    for (let x = 11; x < w + 6; x += 3) {
      px(c, x, 3, 1, 1, col.l);
      px(c, x, h - 4, 1, 1, col.d);
    }
  });
}

/** framed bar with iron end caps (fill drawn live) */
export function barFrame(w: number, h: number) {
  return cached(`barframe:${w}:${h}`, w, h, (c) => {
    const W = UI.wood, I = UI.iron;
    px(c, 0, 0, w, h, W.o);
    px(c, 1, 1, w - 2, h - 2, W.d);
    px(c, 1, 1, w - 2, 1, W.l);
    px(c, 3, 3, w - 6, h - 6, '#140a04');
    // iron caps
    for (const x0 of [0, w - 7]) {
      px(c, x0, -0, 7, h, I.o);
      px(c, x0 + 1, 1, 5, h - 2, I.m);
      px(c, x0 + 1, 1, 5, 1, I.h);
      px(c, x0 + 1, h - 2, 5, 1, I.d);
      px(c, x0 + 3, Math.floor(h / 2) - 1, 1, 2, I.h);
    }
  });
}

export function drawBarFill(c: Ctx2, x: number, y: number, w: number, h: number, frac: number, pal: { o: string; d: string; m: string; l: string; h?: string }, trail = 0) {
  const ix = x + 7, iw = w - 14, iy = y + 3, ih = h - 6;
  if (trail > frac) px(c, ix + Math.round(iw * frac), iy, Math.round(iw * (trail - frac)), ih, '#f6e6c8');
  const fw = Math.round(iw * Math.max(0, Math.min(1, frac)));
  if (fw <= 0) return;
  px(c, ix, iy, fw, ih, pal.m);
  px(c, ix, iy, fw, 1, pal.h ?? pal.l);
  px(c, ix, iy + 1, fw, 1, pal.l);
  px(c, ix, iy + ih - 1, fw, 1, pal.d);
  // segment ticks
  for (let t = ix + 8; t < ix + fw; t += 8) px(c, t, iy + 1, 1, ih - 2, pal.d);
  // leading edge glint
  px(c, ix + fw - 1, iy, 1, ih, pal.h ?? '#ffffff');
}

export function keycap(label: string) {
  const w = Math.max(14, label.length * 7 + 7);
  return cached(`key:${label}`, w, 15, (c) => {
    // the authored key cap (bone face, lit top, deep bottom lip) stretched to the label
    c.drawImage(nine(HUD_ART.nine_key, w, 15, 5), 0, 0);
    c.font = `16px '${FONT}'`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillStyle = UI.wood.o;
    c.fillText(label, Math.floor(w / 2), -2);
  });
}

/** sheriff star badge (rasterized polygon with shading + ball tips) */
export function starBadge(r: number) {
  const S = r * 2 + 4;
  return cached(`star:${r}`, S, S, (c) => {
    const B = UI.brass;
    const cx = S / 2, cy = S / 2;
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.48;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    const inside = (x: number, y: number) => {
      let o = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o;
      }
      return o;
    };
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        if (!inside(x + 0.5, y + 0.5)) continue;
        const edge = !inside(x - 0.5, y + 0.5) || !inside(x + 1.5, y + 0.5) || !inside(x + 0.5, y - 0.5) || !inside(x + 0.5, y + 1.5);
        const lit = (cx - x) * 0.6 + (cy - y) * 0.8;
        px(c, x, y, 1, 1, edge ? B.o : lit > r * 0.25 ? B.l : lit > -r * 0.3 ? B.m : B.d);
      }
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const bx = Math.round(cx + Math.cos(a) * r), by = Math.round(cy + Math.sin(a) * r);
      px(c, bx - 1, by - 1, 3, 3, B.o);
      px(c, bx, by - 1, 1, 1, B.h);
      px(c, bx - 1, by, 2, 1, B.l);
    }
    // inner ring
    const ir = r * 0.36;
    for (let a = 0; a < Math.PI * 2; a += 0.12) px(c, Math.round(cx + Math.cos(a) * ir), Math.round(cy + Math.sin(a) * ir), 1, 1, B.d);
    px(c, Math.round(cx - r * 0.5), Math.round(cy - r * 0.55), 2, 1, B.h);
  });
}

export function chain(c: Ctx2, x: number, y0: number, y1: number) {
  const I = UI.iron;
  for (let y = y0, k = 0; y < y1; y += 3, k++) {
    if (k % 2 === 0) {
      px(c, x - 1, y, 3, 3, I.o);
      px(c, x, y + 1, 1, 1, I.l);
    } else {
      px(c, x, y, 1, 3, I.m);
    }
  }
}

// ---------------------------------------------------------------- authored pixel sprites
// The HUD's hand-authored pixel art (HudArt.ts) is palette-indexed data: one char per
// pixel on this palette, '.' transparent. sprite() turns a sprite into a cached canvas,
// optionally with a palette swap (a dimmed piece, a white hit flash, a rarity colour);
// nine() / strip3() stretch authored frames to any size by tiling their edges.
export interface PixelSprite {
  w: number;
  h: number;
  rows: string[];
}

/** the HUD's limited warm palette (ramps dark to light) */
export const HUD_PAL: Record<string, string> = { 'k': '#1a0e08', 'K': '#3a2414', '0': '#0c0806', 'a': '#22262c', 'b': '#3a424c', 'c': '#56616e', 'd': '#7c8a98', 'e': '#b4c0ca', 'f': '#4a300c', 'g': '#7c5214', 'h': '#b88426', 'i': '#e2b24a', 'j': '#fff0a6', 'l': '#3a200e', 'm': '#5a3418', 'n': '#7a4a22', 'o': '#9a6430', 'p': '#c08848', 'q': '#7a5430', 'r': '#a9844e', 's': '#d6b985', 't': '#efdcb0', 'u': '#fff4d8', 'v': '#2e180c', 'w': '#4e2a16', 'x': '#6e3c20', 'y': '#8e5430', 'z': '#b07040', 'A': '#3a0806', 'B': '#6a120c', 'C': '#a8221a', 'D': '#dc4430', 'E': '#ff8a6a', 'F': '#0b3d2c', 'G': '#1d6a4a', 'H': '#2fbf7e', 'I': '#7cf2b4', 'J': '#eafff2', 'L': '#6e5a40', 'M': '#b8a07a', 'N': '#e0cfa8', 'O': '#f6ead0', 'P': '#4e4a44', 'Q': '#8a867c', 'R': '#bdb9ae', 'S': '#f2efe6', 'T': '#141c3a', 'U': '#283a7a', 'V': '#4468c0', 'W': '#8ab0e8', 'X': '#5a2a12', 'Y': '#8a4a22', 'Z': '#c06a2e', '#': '#ffffff', '@': '#d4ebe0', '%': '#a2c8b8', '&': '#6e9a8a', '1': '#2a0806', '2': '#4a0e0a', '3': '#6a1a14', '4': '#c8a070', '5': '#e8c890' };
/** the palette's ramps, darkest first (palette swaps step along them) */
export const HUD_RAMPS: Record<string, string> = {
  iron: 'abcde', brass: 'fghij', wood: 'lmnop', parch: 'qrstu', leather: 'vwxyz', blood: 'ABCDE', jade: 'FGHIJ',
  linen: 'LMNO', tin: 'PQRS', blue: 'TUVW', rust: 'XYZ', glass: '&%@', ox: '123',
};
const STEP: Record<string, [string, string]> = {};
for (const r of Object.values(HUD_RAMPS)) for (let i = 0; i < r.length; i++) STEP[r[i]] = [r[Math.max(0, i - 1)], r[Math.min(r.length - 1, i + 1)]];
/** a palette swap one step darker along every ramp (the darkest step falls to the soft ink) */
export const SWAP_DIM: Record<string, string> = Object.fromEntries(Object.keys(HUD_PAL).map((c) => [c, HUD_PAL[STEP[c] ? (STEP[c][0] === c ? 'K' : STEP[c][0]) : c]]));
/** a palette swap one step lighter (lit, hovered, ready) */
export const SWAP_LIT: Record<string, string> = Object.fromEntries(Object.keys(HUD_PAL).map((c) => [c, HUD_PAL[STEP[c]?.[1] ?? c]]));
/** the hit flash: every colour to bone white, the ink to warm brown */
export const SWAP_FLASH: Record<string, string> = Object.fromEntries(Object.keys(HUD_PAL).map((c) => [c, c === 'k' || c === 'K' ? '#7a4a22' : '#fff8e8']));

const spriteCache = new WeakMap<PixelSprite, Map<string, HTMLCanvasElement>>();
/**
 * An authored sprite as a canvas (cached per sprite and swap). `swap` maps palette chars
 * to colours (a palette swap); `key` names the swap for the cache (default: its JSON).
 */
export function sprite(def: PixelSprite, swap?: Record<string, string>, key?: string): HTMLCanvasElement {
  let m = spriteCache.get(def);
  if (!m) spriteCache.set(def, (m = new Map()));
  const k = swap ? key ?? JSON.stringify(swap) : '';
  let cv = m.get(k);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = def.w;
  cv.height = def.h;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(def.w, def.h);
  const rgb = new Map<string, number[]>();
  const col = (ch: string) => {
    let v = rgb.get(ch);
    if (!v) {
      const hex = swap?.[ch] ?? HUD_PAL[ch] ?? '#ff00ff';
      const n = parseInt(hex.slice(1), 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      rgb.set(ch, v);
    }
    return v;
  };
  for (let y = 0; y < def.h; y++) {
    const row = def.rows[y] ?? '';
    for (let x = 0; x < def.w; x++) {
      const ch = row[x];
      if (!ch || ch === '.') continue;
      const v = col(ch);
      const o = (y * def.w + x) * 4;
      img.data[o] = v[0];
      img.data[o + 1] = v[1];
      img.data[o + 2] = v[2];
      img.data[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  m.set(k, cv);
  return cv;
}

/** draw a sprite canvas on whole pixels: centred on (cx, cy), optionally mirrored / quarter-turned */
export function drawSprite(c: Ctx2, cv: HTMLCanvasElement, cx: number, cy: number, o: { flipX?: boolean; flipY?: boolean; turns?: number; alpha?: number } = {}) {
  const turns = (((o.turns ?? 0) % 4) + 4) % 4;
  const w = turns % 2 ? cv.height : cv.width, h = turns % 2 ? cv.width : cv.height;
  const x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
  const a = c.globalAlpha;
  if (o.alpha !== undefined) c.globalAlpha = a * o.alpha;
  if (!turns && !o.flipX && !o.flipY) c.drawImage(cv, x, y);
  else {
    c.save();
    c.translate(x + w / 2, y + h / 2);
    c.rotate((turns * Math.PI) / 2);
    c.scale(o.flipX ? -1 : 1, o.flipY ? -1 : 1);
    c.drawImage(cv, -cv.width / 2, -cv.height / 2);
    c.restore();
  }
  c.globalAlpha = a;
}

const nineCache = new WeakMap<PixelSprite, Map<string, HTMLCanvasElement>>();
/** a frame sprite stretched to w×h: corners kept, edges and centre tiled (`m` = corner size) */
export function nine(def: PixelSprite, w: number, h: number, m: number, swap?: Record<string, string>): HTMLCanvasElement {
  w = Math.max(m * 2 + 1, Math.round(w));
  h = Math.max(m * 2 + 1, Math.round(h));
  let mc = nineCache.get(def);
  if (!mc) nineCache.set(def, (mc = new Map()));
  const key = `${w}x${h}:${m}:${swap ? JSON.stringify(swap) : ''}`;
  let cv = mc.get(key);
  if (cv) return cv;
  const src = sprite(def, swap);
  cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const sw = def.w, sh = def.h, cw = sw - m * 2, chh = sh - m * 2;
  const tile = (sx: number, sy: number, tw: number, th: number, dx: number, dy: number, dw: number, dh: number) => {
    for (let y = 0; y < dh; y += th)
      for (let x = 0; x < dw; x += tw) {
        const ww = Math.min(tw, dw - x), hh = Math.min(th, dh - y);
        c.drawImage(src, sx, sy, ww, hh, dx + x, dy + y, ww, hh);
      }
  };
  tile(m, m, cw, chh, m, m, w - m * 2, h - m * 2);
  tile(m, 0, cw, m, m, 0, w - m * 2, m);
  tile(m, sh - m, cw, m, m, h - m, w - m * 2, m);
  tile(0, m, m, chh, 0, m, m, h - m * 2);
  tile(sw - m, m, m, chh, w - m, m, m, h - m * 2);
  c.drawImage(src, 0, 0, m, m, 0, 0, m, m);
  c.drawImage(src, sw - m, 0, m, m, w - m, 0, m, m);
  c.drawImage(src, 0, sh - m, m, m, 0, h - m, m, m);
  c.drawImage(src, sw - m, sh - m, m, m, w - m, h - m, m, m);
  mc.set(key, cv);
  if (mc.size > 60) mc.delete(mc.keys().next().value!);
  return cv;
}

const stripCache = new Map<string, HTMLCanvasElement>();
/** a horizontal strip: left cap, middle tile repeated, right cap, `w` wide */
export function strip3(l: PixelSprite, mid: PixelSprite, r: PixelSprite, w: number, key: string, swap?: Record<string, string>): HTMLCanvasElement {
  w = Math.max(l.w + r.w, Math.round(w));
  const k = `${key}:${w}:${swap ? JSON.stringify(swap) : ''}`;
  let cv = stripCache.get(k);
  if (cv) return cv;
  const h = Math.max(l.h, mid.h, r.h);
  cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const L = sprite(l, swap), M = sprite(mid, swap), R = sprite(r, swap);
  for (let x = l.w; x < w - r.w; x += mid.w) c.drawImage(M, 0, 0, Math.min(mid.w, w - r.w - x), mid.h, x, 0, Math.min(mid.w, w - r.w - x), mid.h);
  c.drawImage(L, 0, 0);
  c.drawImage(R, w - r.w, 0);
  stripCache.set(k, cv);
  if (stripCache.size > 80) stripCache.delete(stripCache.keys().next().value!);
  return cv;
}

// ---------------------------------------------------------------- text
export function text(c: Ctx2, s: string, x: number, y: number, col = UI.text, size = 16, align: CanvasTextAlign = 'left', outline = true) {
  c.font = `${size}px '${FONT}'`;
  c.textAlign = align;
  c.textBaseline = 'top';
  const X = Math.round(x), Y = Math.round(y);
  if (outline) {
    c.fillStyle = UI.shadow;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [2, 2]]) c.fillText(s, X + dx, Y + dy);
  }
  c.fillStyle = col;
  c.fillText(s, X, Y);
}

export function measure(c: Ctx2, s: string, size = 16) {
  c.font = `${size}px '${FONT}'`;
  return c.measureText(s).width;
}

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const k = 1 + f;
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * k)));
  return `rgb(${r},${g},${b})`;
}
