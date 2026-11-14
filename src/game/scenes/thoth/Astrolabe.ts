// THOTH'S ASTROLABE: the gift ladder at his desk, as the instrument he reckons it on. Pixel art at UI
// resolution, built in layers:
//  - the throne (the ornate crest and hanging ring at the top), the limb (a bevelled bronze ring with a
//    scale of studies 0..80 on it, long ticks every ten) and on it one jewelled socket per gift: a gold
//    seal once given, a pulsing lapis gem for the next one, dull bronze for the rest
//  - the mater: a lapis enamel plate engraved with the projection lines of a real astrolabe
//    (almucantars, the horizon, the tropics) and a gold constellation of the ibis
//  - an ink channel round the plate: ink poured up to the studies finished (the same living ink as
//    the study cartouches; it flows on when a study is stamped)
//  - the rete: a pierced bronze star map (ecliptic ring, flame-shaped star pointers) that turns on its
//    own; drag it and it spins with real inertia and friction, ticking as its pointers pass the gifts
//  - the alidade: the sighting rule, swinging on a damped spring to the gift you pick
// Tap a socket to pick a gift (or let the alidade rest on the next one).
//
//   const a = new Astrolabe(R); a.set(gifts, studies, sel); a.update(dt); c.drawImage(a.draw(), ...)
//   a.down(x, y) / a.move(x, y) / a.up(x, y) (canvas px) -> picked socket or -1; a.events (ticks)
import { InkCircuit } from './InkCircuit';
import { GLYPH_BITMAPS } from './HallModels';

const TAU = Math.PI * 2;
const hsh = (x: number, y: number) => {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const BR = ['#2e1c06', '#5a3a10', '#7c5214', '#a8742a', '#d09a4a', '#f0c878', '#fff0c0'].map(rgb);
const LAP = ['#060a1c', '#0c1430', '#142050', '#1f2f66', '#2c4490'].map(rgb);
const GOLD = ['#7c5214', '#e2b24a', '#fff0a6'].map(rgb);
const MAX_AT = 80;
const A0 = 0.36;
const SWEEP = TAU - A0 * 2;

/** a gift's place on the scale (0 at the top, clockwise) */
export const giftAngle = (at: number) => A0 + SWEEP * Math.sqrt(Math.max(0, Math.min(1, at / MAX_AT)));

export interface AstroGift {
  at: number;
  given: boolean;
}

export class Astrolabe {
  readonly R: number;
  /** canvas size (the throne sits above the disc) */
  readonly W: number;
  readonly H: number;
  readonly T: number;
  readonly canvas = document.createElement('canvas');
  private c: CanvasRenderingContext2D;
  private stat: HTMLCanvasElement;
  private rete: HTMLCanvasElement;
  private alid: HTMLCanvasElement;
  private ink: InkCircuit;
  private t = 0;
  private gifts: AstroGift[] = [];
  private studies = 0;
  sel = -1;
  hover = -1;
  /** the rete's turn and spin */
  private ra = 0;
  private rv = 0.05;
  private drag: { a: number; last: number; t: number; moved: number; x: number; y: number } | null = null;
  private al = 0;
  private alv = 0;
  private lastTick = 0;
  /** what happened this frame ('tick' as a pointer passes a gift, 'swing' as the alidade settles) */
  events: string[] = [];

  constructor(R: number) {
    this.R = R;
    this.T = Math.round(R * 0.2);
    this.W = R * 2 + 1;
    this.H = R * 2 + 1 + this.T;
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.c = this.canvas.getContext('2d')!;
    this.c.imageSmoothingEnabled = false;
    this.stat = this.buildStatic();
    this.rete = this.buildRete();
    this.alid = this.buildAlidade();
    this.ink = InkCircuit.ring(this.W, R * 0.79, A0, SWEEP);
  }

  /** the centre of the disc in canvas px */
  get cx() {
    return this.R;
  }
  get cy() {
    return this.T + this.R;
  }

  set(gifts: AstroGift[], studies: number, sel: number) {
    this.gifts = gifts;
    this.studies = studies;
    this.sel = sel;
    this.ink.target = Math.sqrt(Math.min(1, studies / MAX_AT));
    this.ink.state = 'study';
  }
  /** pour the ink again (the desk was opened) */
  pour() {
    this.ink.reset();
  }

  /** which socket is near a canvas point (-1 none) */
  socketAt(x: number, y: number) {
    const R = this.R;
    let best = -1, bd = 1e9;
    this.gifts.forEach((g, i) => {
      const a = giftAngle(g.at);
      const sx = this.cx + Math.sin(a) * R * 0.93, sy = this.cy - Math.cos(a) * R * 0.93;
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) (bd = d), (best = i);
    });
    return bd < Math.max(6, R * 0.09) ? best : -1;
  }
  inside(x: number, y: number) {
    return Math.hypot(x - this.cx, y - this.cy) <= this.R + 2;
  }
  down(x: number, y: number) {
    if (!this.inside(x, y)) return false;
    const a = Math.atan2(x - this.cx, -(y - this.cy));
    this.drag = { a, last: a, t: 0, moved: 0, x, y };
    return true;
  }
  move(x: number, y: number) {
    this.hover = this.socketAt(x, y);
    const d = this.drag;
    if (!d) return;
    const a = Math.atan2(x - this.cx, -(y - this.cy));
    let da = a - d.last;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    // only the ring of the rete grips (a drag through the middle turns it too, a little slower)
    const r = Math.hypot(x - this.cx, y - this.cy) / this.R;
    const grip = r > 0.25 ? 1 : 0.4;
    this.ra += da * grip;
    this.rv = this.rv * 0.5 + (da * grip / Math.max(1 / 120, 1 / 60)) * 0.5;
    d.last = a;
    d.moved += Math.hypot(x - d.x, y - d.y);
    d.x = x;
    d.y = y;
  }
  /** let go: a tap picks the socket under it; a drag leaves the rete spinning */
  up(x: number, y: number) {
    const d = this.drag;
    this.drag = null;
    if (!d) return -1;
    if (d.moved < 6) {
      const s = this.socketAt(x, y);
      if (s >= 0) {
        this.sel = s;
        return s;
      }
      // a tap on the plate gives the rete a nudge
      this.rv += 1.2;
    }
    return -1;
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    this.events.length = 0;
    // the rete: friction toward a slow sidereal drift
    if (!this.drag) {
      this.rv += (0.06 - this.rv) * (1 - Math.exp(-dt * 0.9));
      this.ra += this.rv * dt;
    }
    const step = TAU / 8;
    const k = Math.floor(this.ra / step);
    if (k !== this.lastTick) {
      this.lastTick = k;
      if (Math.abs(this.rv) > 0.6 || this.drag) this.events.push('tick');
    }
    // the alidade swings to the picked gift (or the next one, or the studies mark)
    const g = this.gifts[this.sel];
    const want = g ? giftAngle(g.at) : A0 + SWEEP * Math.sqrt(Math.min(1, this.studies / MAX_AT));
    let da = want - this.al;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    const before = Math.abs(this.alv);
    this.alv += (da * 40 - this.alv * 7) * dt;
    this.al += this.alv * dt;
    if (before > 0.8 && Math.abs(this.alv) < 0.8 && Math.abs(da) < 0.05) this.events.push('swing');
    this.ink.update(dt);
  }

  draw() {
    const c = this.c;
    const R = this.R, cx = this.cx, cy = this.cy;
    c.clearRect(0, 0, this.W, this.H);
    c.drawImage(this.stat, 0, 0);
    // the ink round the plate
    this.ink.draw();
    c.drawImage(this.ink.canvas, 0, this.T);
    // the sockets
    const next = this.gifts.findIndex((g) => !g.given);
    this.gifts.forEach((g, i) => {
      const a = giftAngle(g.at);
      const sx = Math.round(cx + Math.sin(a) * R * 0.93), sy = Math.round(cy - Math.cos(a) * R * 0.93);
      const r = Math.max(2, Math.round(R * 0.05));
      const hot = i === this.hover || i === this.sel;
      for (let y = -r - 1; y <= r + 1; y++)
        for (let x = -r - 1; x <= r + 1; x++) {
          const d = Math.hypot(x, y);
          if (d > r + 0.9) continue;
          let col: [number, number, number];
          const lit = -x * 0.6 - y * 0.8;
          if (d > r - 0.2) col = hot ? GOLD[2] : BR[0];
          else if (g.given) col = lit > 0.5 ? GOLD[2] : lit > -0.8 ? GOLD[1] : GOLD[0];
          else if (i === next) {
            const p = 0.5 + 0.5 * Math.sin(this.t * 4);
            col = lit > 0.8 ? rgb('#c8dcff') : lit > -0.5 ? (p > 0.5 ? LAP[4] : LAP[3]) : LAP[1];
          } else col = lit > 0.5 ? BR[3] : BR[1];
          c.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
          c.fillRect(sx + x, sy + y, 1, 1);
        }
      // the next gift's gem breathes a ring of light
      if (i === next) {
        const rr = r + 2 + ((this.t * 6) % 4);
        c.fillStyle = 'rgba(160,200,255,0.55)';
        for (let k = 0; k < 16; k++) {
          const q = (k / 16) * TAU;
          c.fillRect(Math.round(sx + Math.cos(q) * rr), Math.round(sy + Math.sin(q) * rr), 1, 1);
        }
      }
    });
    // the rete, turned (nearest neighbour: it keeps its pixels)
    c.save();
    c.translate(cx + 0.5, cy + 0.5);
    c.rotate(this.ra);
    c.drawImage(this.rete, -this.rete.width / 2, -this.rete.height / 2);
    c.restore();
    // the alidade
    c.save();
    c.translate(cx + 0.5, cy + 0.5);
    c.rotate(this.al);
    c.drawImage(this.alid, -this.alid.width / 2, -this.alid.height / 2);
    c.restore();
    // the pin and its wedge at the centre
    const pr = Math.max(2, Math.round(R * 0.05));
    for (let y = -pr; y <= pr; y++)
      for (let x = -pr; x <= pr; x++) {
        const d = Math.hypot(x, y);
        if (d > pr + 0.4) continue;
        const col = d > pr - 0.6 ? BR[0] : -x - y > 0 ? BR[6] : BR[4];
        c.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        c.fillRect(cx + x, cy + y, 1, 1);
      }
    return this.canvas;
  }

  // ======================================================================= the parts, drawn once
  private buildStatic() {
    const cv = document.createElement('canvas');
    cv.width = this.W;
    cv.height = this.H;
    const c = cv.getContext('2d')!;
    const img = c.createImageData(this.W, this.H);
    const o = img.data;
    const R = this.R, cx = this.cx, cy = this.cy;
    const put = (x: number, y: number, col: [number, number, number]) => {
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
      const j = (y * this.W + x) * 4;
      o[j] = col[0];
      o[j + 1] = col[1];
      o[j + 2] = col[2];
      o[j + 3] = 255;
    };
    const tick = (a: number) => {
      // the scale: is this angle on a tick (studies 1, 5, 10 ...)
      for (let s = 0; s <= MAX_AT; s++) {
        const ga = giftAngle(s);
        if (Math.abs(ga - a) < (s % 10 === 0 ? 0.012 : 0.006)) return s % 10 === 0 ? 2 : s % 5 === 0 ? 1 : 0.5;
      }
      return 0;
    };
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const r = Math.hypot(dx, dy) / R;
        const a = Math.atan2(dx, -dy);
        const aa = a < 0 ? a + TAU : a;
        const lit = (-dx * 0.6 - dy * 0.8) / (R * r || 1);
        if (r <= 1.0) {
          if (r > 0.985) put(x, y, BR[0]);
          else if (r > 0.86) {
            // the limb: a bevelled bronze ring with the scale cut into it
            const bev = r > 0.95 ? lit : r < 0.875 ? -lit : lit * 0.3;
            let col = BR[3 + Math.round(bev * 1.6)] ?? BR[3];
            if (hsh(x, y) < 0.06) col = BR[2];
            const tk = aa > A0 - 0.01 && aa < A0 + SWEEP + 0.01 ? tick(aa) : 0;
            if (tk && r < 0.86 + 0.045 * tk + 0.02) col = BR[0];
            put(x, y, col);
          } else if (r > 0.83) put(x, y, r > 0.845 ? BR[1] : BR[0]);
          else if (r > 0.75) {
            // the gutter the ink runs in: dark bronze
            put(x, y, r > 0.81 || r < 0.77 ? BR[1] : BR[0]);
          } else if (r > 0.735) put(x, y, BR[4]);
          else {
            // the mater: lapis enamel, engraved lines in gold
            let col = LAP[1 + (hsh(x >> 1, y >> 1) < 0.4 ? 1 : 0)];
            if (hsh(x, y) < 0.015) col = LAP[3];
            const ny = dy / R, nx = dx / R;
            // almucantars: circles stacked toward the zenith (off-centre, as projected)
            for (const k of [0.1, 0.22, 0.34, 0.46]) {
              const zr = 0.62 - k * 0.9, zc = -0.08 - k * 0.55;
              if (Math.abs(Math.hypot(nx, ny - zc) - zr) < 0.009) col = GOLD[0];
            }
            // the tropics and equator (centred circles), the meridian and horizon line
            for (const tr of [0.28, 0.45, 0.62]) if (Math.abs(r - tr) < 0.008) col = GOLD[0];
            if (Math.abs(nx) < 0.007 && r < 0.72) col = GOLD[0];
            if (Math.abs(ny - 0.18) < 0.007 && r < 0.7) col = GOLD[0];
            put(x, y, col);
          }
        }
      }
    // the ibis constellation: gold stars on the glyph's cells, faint links between them
    const ib = GLYPH_BITMAPS[0];
    const cell = Math.max(2, Math.round(R * 0.055));
    const ox = Math.round(cx - (7 * cell) / 2), oy = Math.round(cy - (9 * cell) / 2 + R * 0.06);
    ib.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        if (ch !== '#') return;
        const sx = ox + i * cell, sy = oy + j * cell;
        const big = hsh(i, j) < 0.3;
        put(sx, sy, GOLD[big ? 2 : 1]);
        if (big) {
          put(sx - 1, sy, GOLD[0]);
          put(sx + 1, sy, GOLD[0]);
          put(sx, sy - 1, GOLD[0]);
          put(sx, sy + 1, GOLD[0]);
        }
      })
    );
    // scattered stars
    for (let k = 0; k < R * 1.2; k++) {
      const a = hsh(k, 3) * TAU, r = Math.sqrt(hsh(5, k)) * R * 0.7;
      put(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), hsh(k, k) < 0.5 ? rgb('#8ab0e8') : GOLD[1]);
    }
    // the throne: a crest of scrolls with the shackle and ring above the disc
    const T = this.T;
    const tw = Math.round(R * 0.32);
    for (let y = 0; y < T + Math.round(R * 0.12); y++)
      for (let x = -tw; x <= tw; x++) {
        const yy = y / (T + R * 0.12);
        const half = tw * (0.35 + 0.65 * Math.pow(yy, 0.7));
        // two scrolls curling out at the bottom, the crest rising to the ring
        const scroll = Math.hypot(Math.abs(x) - tw * 0.7, y - T * 0.85) < T * 0.3;
        const ring = Math.abs(Math.hypot(x, y - T * 0.3) - T * 0.26) < 1.1;
        if (!(Math.abs(x) <= half && y > T * 0.45) && !scroll && !ring) continue;
        const X = cx + x, Y = y;
        if (Y >= cy - R * 0.98 && Math.hypot(x, Y - cy) < R * 0.985 && !ring) continue;
        const edge = Math.abs(x) > half - 1 || ring;
        const lit = -x / tw - (y - T * 0.6) / T;
        put(X, Y, ring ? (x < 0 ? BR[5] : BR[2]) : edge ? BR[0] : lit > 0.4 ? BR[5] : lit > -0.2 ? BR[4] : BR[2]);
      }
    c.putImageData(img, 0, 0);
    return cv;
  }

  /** the pierced star map: ecliptic ring, an inner ring, arms, and flame-shaped star pointers */
  private buildRete() {
    const R = this.R;
    const S = Math.round(R * 1.5) | 1;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const c = cv.getContext('2d')!;
    const img = c.createImageData(S, S);
    const o = img.data;
    const h = (S - 1) / 2;
    const seg = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
      const ex = bx - ax, ey = by - ay;
      const l2 = ex * ex + ey * ey || 1;
      const s = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2));
      return Math.hypot(x - ax - ex * s, y - ay - ey * s);
    };
    const stars = Array.from({ length: 8 }, (_, k) => {
      const a = (k / 8) * TAU + 0.2 + hsh(k, 7) * 0.3;
      const r = R * (0.5 + hsh(k, 2) * 0.2);
      return { a, r, x: Math.sin(a) * r, y: -Math.cos(a) * r };
    });
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const X = x - h, Y = y - h;
        // the ecliptic: an off-centre ring with a band
        const ec = Math.abs(Math.hypot(X, Y + R * 0.17) - R * 0.47);
        const inner = Math.abs(Math.hypot(X, Y) - R * 0.2);
        let d = Math.min(ec - 1.4, inner - 0.9);
        for (const st of stars) {
          // the arm out to each star, then the flame-shaped pointer
          const ax = Math.sin(st.a) * R * 0.2, ay = -Math.cos(st.a) * R * 0.2;
          const bend = 0.25;
          const mx = Math.sin(st.a + bend) * st.r * 0.6, my = -Math.cos(st.a + bend) * st.r * 0.6;
          d = Math.min(d, seg(X, Y, ax, ay, mx, my) - 0.7, seg(X, Y, mx, my, st.x, st.y) - 0.7);
          // the pointer: a teardrop tapering to the star
          const px = st.x * 1.12, py = st.y * 1.12;
          const s2 = seg(X, Y, st.x * 0.96, st.y * 0.96, px, py);
          const tt = Math.max(0, Math.min(1, Math.hypot(X - st.x, Y - st.y) / (st.r * 0.16)));
          d = Math.min(d, s2 - (1.8 * (1 - tt) + 0.3));
          // a bead where arm meets pointer
          d = Math.min(d, Math.hypot(X - st.x, Y - st.y) - 1.6);
        }
        if (d > 0.6) continue;
        const j = (y * S + x) * 4;
        const lit = (-X * 0.6 - Y * 0.8) / (Math.hypot(X, Y) || 1);
        const col = d > -0.3 ? BR[0] : lit > 0.3 ? BR[5] : lit > -0.4 ? BR[4] : BR[3];
        o[j] = col[0];
        o[j + 1] = col[1];
        o[j + 2] = col[2];
        o[j + 3] = 255;
      }
    // the star pointers' tips: a gold point each
    for (const st of stars) {
      const x = Math.round(h + st.x * 1.12), y = Math.round(h + st.y * 1.12);
      const j = (y * S + x) * 4;
      if (x >= 0 && y >= 0 && x < S && y < S) {
        o[j] = 255;
        o[j + 1] = 240;
        o[j + 2] = 166;
        o[j + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  /** the sighting rule: a long bronze bar with vanes, pointed at its tip */
  private buildAlidade() {
    const R = this.R;
    const L = Math.round(R * 1.92) | 1, Hh = 9;
    const cv = document.createElement('canvas');
    cv.width = Hh;
    cv.height = L;
    const c = cv.getContext('2d')!;
    const mid = (L - 1) / 2;
    for (let y = 0; y < L; y++) {
      const u = (y - mid) / mid; // -1 tip (up) .. 1 tail
      let half = 1.2;
      if (u < -0.82) half = 1.2 * Math.max(0, (u + 1) / 0.18); // the pointed tip
      const vane = Math.abs(Math.abs(u) - 0.55) < 0.05;
      if (vane) half = 3.5;
      if (Math.abs(u) < 0.1) half = 2.5;
      for (let x = 0; x < Hh; x++) {
        const X = x - (Hh - 1) / 2;
        if (Math.abs(X) > half + 0.3) continue;
        const edge = Math.abs(X) > half - 0.7;
        const col = edge ? BR[0] : X < 0 ? (u < -0.5 ? GOLD[2] : BR[5]) : BR[3];
        c.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        c.fillRect(x, y, 1, 1);
      }
    }
    return cv;
  }
}
