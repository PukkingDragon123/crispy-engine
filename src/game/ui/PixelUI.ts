// Procedural pixel-art UI kit (wood, iron, brass, parchment, rope) drawn pixel
// by pixel into cached offscreen canvases, plus Alagard text helpers.
// Everything is integer-aligned for crisp nearest-neighbour upscaling.
import { RNG } from '../../engine/math/rand';

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
    const P = UI.parch;
    px(c, 0, 0, w, 15, UI.wood.o);
    px(c, 1, 1, w - 2, 12, P.l);
    px(c, 1, 12, w - 2, 2, P.d);
    px(c, 1, 1, w - 2, 1, P.h);
    c.font = `16px '${FONT}'`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillStyle = UI.wood.o;
    c.fillText(label, Math.floor(w / 2), -1);
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
