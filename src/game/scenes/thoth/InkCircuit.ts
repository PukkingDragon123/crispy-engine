// THOTH'S INK. Every study in the Hall is written in living ink: a channel carved into a limestone
// cartouche (or round an astrolabe, or along a gauge) that ink really flows through. The channels are
// a pixel mask; a breadth-first walk from the inkwell gives every channel cell its distance and its
// parent, and the ink is a mass-conserving flow down that tree: the well pours, a full cell passes
// its excess on to its emptier children (split between the branches, so side spurs fill as the ink
// passes them and back up when they are full), so the front creeps through the glyph in an organic
// way rather than as a bar. The amount poured is the study's progress. When a study is ready the
// ink reaches the seal at the end and swirls into it; stamping it sends a wave of gold back up the
// channels to the well.
//
// Rendering is pixel art at UI resolution: a dry carved groove (top lip in shadow, bottom lip lit),
// lapis-black ink with a moving sheen, a brighter meniscus at the front, gold ink once studied,
// pale sand in the grooves of a study not yet found. Droplets splash at the front while it moves and
// where a finger taps the ink. Cost scales with the channel cells, not the canvas.
//
//   const ink = InkCircuit.glyph(key, 160, 34);   // a cartouche for an entry
//   ink.target = 0.4; ink.state = 'study';        // each frame (state: dry | study | ready | done)
//   ink.update(dt); ink.draw();  c.drawImage(ink.canvas, x, y, ink.w * S, ink.h * S)
import { GLYPH_BITMAPS } from './HallModels';

export type InkState = 'dry' | 'study' | 'ready' | 'done';

const hsh = (x: number, y: number) => {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const strHash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

// palettes (RGB)
const INK = ['#070a1a', '#0e1634', '#182a5c', '#2c4a96', '#6a90e0', '#c8dcff'].map(rgb);
const GOLDI = ['#3a2406', '#7c5214', '#b88426', '#e2b24a', '#fff0a6', '#ffffff'].map(rgb);
const GROOVE = rgb('#5e4a30'), GROOVE_D = rgb('#3e2e1a'), LIP = rgb('#fff4d8');
const SANDG = ['#b89a6a', '#cdb07e', '#9a7e52'].map(rgb);

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  gold: boolean;
}

/** what a channel plan hands the simulation: the mask (1 channel, 2 seal core), the well, the plaque */
interface Plan {
  w: number;
  h: number;
  mask: Uint8Array;
  src: number;
  /** a static backdrop under the channels (the carved plaque), drawn once */
  back?: (put: (x: number, y: number, c: [number, number, number], a?: number) => void) => void;
  /** where the seal sits (cartouches) */
  seal?: { x: number; y: number; r: number };
}

export class InkCircuit {
  readonly w: number;
  readonly h: number;
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private base: Uint8ClampedArray;
  private mask: Uint8Array;
  /** channel cells in flow order, their parents, children (CSR), distances */
  private cells: Int32Array;
  private dist: Float32Array;
  private kids: Int32Array;
  private kidStart: Int32Array;
  private vol: Float32Array;
  private need: Float32Array;
  private maxD = 1;
  private cap = 1;
  private core: Int32Array;
  private coreFill = 0;
  private drops: Drop[] = [];
  private t = 0;
  private src: number;
  /** poured fraction the ink should reach (0..1) */
  target = 0;
  state: InkState = 'study';
  /** gold wave from the seal back to the well (0..1); 1 once studied */
  gold = 0;
  private goldGo = false;
  /** seconds of a press on the seal (the hand pushes it down) */
  press = 0;
  /** a ripple (x, y, age) */
  private rip: { x: number; y: number; a: number } | null = null;
  readonly seal: Plan['seal'];
  /** the ink is still moving (for sounds) */
  flowing = false;

  constructor(p: Plan) {
    this.w = p.w;
    this.h = p.h;
    this.mask = p.mask;
    this.src = p.src;
    this.seal = p.seal;
    this.canvas.width = p.w;
    this.canvas.height = p.h;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(p.w, p.h);
    this.base = new Uint8ClampedArray(p.w * p.h * 4);
    // ---- the static plaque
    if (p.back) {
      const b = this.base;
      p.back((x, y, c, a = 255) => {
        if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
        const i = (y * p.w + x) * 4;
        b[i] = c[0];
        b[i + 1] = c[1];
        b[i + 2] = c[2];
        b[i + 3] = a;
      });
    }
    // ---- the walk: 8-connected BFS from the well over the channels; islands join their nearest reached cell
    const N = p.w * p.h;
    const dist = new Float32Array(N).fill(-1);
    const par = new Int32Array(N).fill(-1);
    const order: number[] = [];
    const isCh = (i: number) => p.mask[i] === 1;
    dist[p.src] = 0;
    const q = [p.src];
    const walk = () => {
      while (q.length) {
        const i = q.shift()!;
        order.push(i);
        const x = i % p.w, y = (i / p.w) | 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= p.w || ny >= p.h) continue;
            const j = ny * p.w + nx;
            if (!isCh(j) || dist[j] >= 0) continue;
            dist[j] = dist[i] + (dx && dy ? 1.41 : 1);
            par[j] = i;
            q.push(j);
          }
      }
    };
    walk();
    for (;;) {
      let best = -1, bestFrom = -1, bd = 1e9;
      for (let j = 0; j < N; j++) {
        if (!isCh(j) || dist[j] >= 0) continue;
        const jx = j % p.w, jy = (j / p.w) | 0;
        for (const i of order) {
          const d = Math.hypot((i % p.w) - jx, ((i / p.w) | 0) - jy);
          if (d < bd) (bd = d), (best = j), (bestFrom = i);
        }
        break;
      }
      if (best < 0) break;
      dist[best] = dist[bestFrom] + bd;
      par[best] = bestFrom;
      q.push(best);
      walk();
    }
    this.cells = Int32Array.from(order);
    this.dist = dist;
    for (const i of order) this.maxD = Math.max(this.maxD, dist[i]);
    this.cap = order.length;
    // children lists (CSR) in flow order
    const kidsOf = new Map<number, number[]>();
    for (const i of order) if (par[i] >= 0) (kidsOf.get(par[i]) ?? kidsOf.set(par[i], []).get(par[i])!).push(i);
    this.kidStart = new Int32Array(N + 1);
    const flat: number[] = [];
    for (let i = 0; i < N; i++) {
      this.kidStart[i] = flat.length;
      const k = kidsOf.get(i);
      if (k) flat.push(...k);
    }
    this.kidStart[N] = flat.length;
    this.kids = Int32Array.from(flat);
    this.vol = new Float32Array(N);
    this.need = new Float32Array(N);
    const core: number[] = [];
    for (let i = 0; i < N; i++) if (p.mask[i] === 2) core.push(i);
    this.core = Int32Array.from(core);
  }

  /** pour again from an empty well (a page opened) */
  reset() {
    this.vol.fill(0);
    this.coreFill = 0;
    this.drops.length = 0;
    this.gold = this.state === 'done' ? 1 : 0;
    this.goldGo = false;
  }
  /** the study was just completed: the gold wave runs back from the seal */
  stamp() {
    this.gold = 0;
    this.goldGo = true;
    this.coreFill = 1;
    const s = this.seal;
    if (s) for (let k = 0; k < 26; k++) this.splash(s.x, s.y, true, 1.8);
  }
  /** a finger in the ink: a ripple and a splash at the nearest wet cell */
  touch(x: number, y: number) {
    this.rip = { x, y, a: 0 };
    let best = -1, bd = 1e9;
    for (const i of this.cells) {
      if (this.vol[i] < 0.3) continue;
      const d = Math.hypot((i % this.w) - x, ((i / this.w) | 0) - y);
      if (d < bd) (bd = d), (best = i);
    }
    if (best >= 0 && bd < 10) for (let k = 0; k < 7; k++) this.splash(best % this.w, (best / this.w) | 0, this.gold > 0.5, 1);
    return best >= 0 && bd < 10;
  }
  /** is a point (canvas px) on the seal */
  onSeal(x: number, y: number) {
    const s = this.seal;
    return !!s && Math.hypot(x - s.x, y - s.y) <= s.r + 2;
  }
  private splash(x: number, y: number, gold: boolean, power: number) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const sp = (14 + Math.random() * 26) * power;
    this.drops.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.5, gold });
  }

  get poured() {
    let v = 0;
    for (const i of this.cells) v += Math.min(1, this.vol[i]);
    return v / this.cap;
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const vol = this.vol;
    // the well pours while the ink is short of its mark (fast enough to fill a whole cartouche in about a second)
    const want = Math.max(0, Math.min(1, this.target)) * this.cap;
    let have = 0;
    for (const i of this.cells) have += vol[i];
    const rate = Math.max(30, this.cap * 0.85);
    const pour = Math.max(0, Math.min(rate * dt, want - have));
    vol[this.src] += pour;
    this.flowing = pour > 0.01;
    // the flow: a full cell hands its excess down the tree, to each child in proportion to how much
    // its whole branch still wants (worked out leaf-first each step), a limited amount per step
    const need = this.need;
    const cs = this.cells;
    for (let n = cs.length - 1; n >= 0; n--) {
      const i = cs[n];
      let nd = Math.max(0, 1 - vol[i]);
      for (let k = this.kidStart[i]; k < this.kidStart[i + 1]; k++) nd += need[this.kids[k]];
      need[i] = nd;
    }
    const step = Math.max(1.2, rate * dt * 0.75);
    for (const i of cs) {
      const ex = vol[i] - 1;
      if (ex <= 0) continue;
      const a = this.kidStart[i], b = this.kidStart[i + 1];
      let kn = 0;
      for (let k = a; k < b; k++) kn += need[this.kids[k]];
      if (kn <= 1e-4) {
        // a brimming dead end: what it cannot hold runs back to the well
        if (b === a && i !== this.src) {
          vol[this.src] += ex;
          vol[i] = 1;
        }
        continue;
      }
      const give = Math.min(ex, step, kn);
      for (let k = a; k < b; k++) vol[this.kids[k]] += (give * need[this.kids[k]]) / kn;
      vol[i] -= give;
    }
    // drops at a moving front
    if (this.flowing && Math.random() < dt * 14) {
      let fi = -1;
      for (const i of this.cells) if (vol[i] > 0.05 && vol[i] < 0.9) (fi = i);
      if (fi >= 0) this.splash(fi % this.w, (fi / this.w) | 0, this.gold > 0.5, 0.6);
    }
    // the seal: ink swirls in once the channels are full and the study is ready
    const full = have >= this.cap * 0.985;
    const coreWant = this.state === 'done' ? 1 : this.state === 'ready' && full ? 1 : 0;
    this.coreFill += (coreWant - this.coreFill) * Math.min(1, dt * (coreWant ? 1.6 : 6));
    if (this.goldGo) {
      this.gold = Math.min(1, this.gold + dt * 0.9);
      if (this.gold >= 1) this.goldGo = false;
      if (Math.random() < dt * 30) {
        const i = this.cells[Math.floor(Math.random() * this.cells.length)];
        if (Math.abs(1 - this.dist[i] / this.maxD - this.gold) < 0.08) this.splash(i % this.w, (i / this.w) | 0, true, 0.7);
      }
    } else if (this.state === 'done') this.gold = 1;
    else this.gold = Math.max(0, this.gold - dt * 2);
    this.press = Math.max(0, this.press - dt * 3);
    if (this.rip) {
      this.rip.a += dt;
      if (this.rip.a > 0.9) this.rip = null;
    }
    for (const d of this.drops) {
      d.vy += 90 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life -= dt;
    }
    this.drops = this.drops.filter((d) => d.life > 0 && d.y < this.h + 2);
  }

  draw() {
    const W = this.w;
    const o = this.img.data;
    o.set(this.base);
    const t = this.t;
    const put = (i: number, c: [number, number, number]) => {
      o[i * 4] = c[0];
      o[i * 4 + 1] = c[1];
      o[i * 4 + 2] = c[2];
      o[i * 4 + 3] = 255;
    };
    const ramp = (P: [number, number, number][], k: number) => P[Math.max(0, Math.min(P.length - 1, Math.round(k)))];
    const dry = this.state === 'dry';
    const rip = this.rip;
    for (const i of this.cells) {
      const x = i % W, y = (i / W) | 0;
      const v = Math.min(1, this.vol[i]);
      const up = y > 0 && this.mask[i - W] !== 0;
      const down = y < this.h - 1 && this.mask[i + W] !== 0;
      // the carved lips: shadow above the groove, light under it
      if (!up && y > 0 && this.mask[i - W] === 0) {
        const j = i - W;
        o[j * 4] = (o[j * 4] * 0.55) | 0;
        o[j * 4 + 1] = (o[j * 4 + 1] * 0.5) | 0;
        o[j * 4 + 2] = (o[j * 4 + 2] * 0.45) | 0;
        o[j * 4 + 3] = Math.max(o[j * 4 + 3], 255);
      }
      if (!down && y < this.h - 1 && this.mask[i + W] === 0) put(i + W, LIP);
      if (dry) {
        put(i, hsh(x, y) < 0.3 ? SANDG[2] : hsh(y, x) < 0.5 ? SANDG[0] : SANDG[1]);
        continue;
      }
      if (v < 0.06) {
        put(i, up ? GROOVE : GROOVE_D);
        continue;
      }
      const d = this.dist[i] / this.maxD;
      const isGold = this.gold > 0 && d >= 1 - this.gold - 0.001;
      // the sheen: slow bands running down the flow, a glint along the top of each channel
      const s = Math.sin(this.dist[i] * 0.55 - t * 4.2 + y * 0.3) * 0.5 + Math.sin(this.dist[i] * 0.21 - t * 1.7) * 0.5;
      let k = 1.4 + s * 0.9 + (!up ? 0.9 : 0) - (!down ? 0.5 : 0);
      if (rip) {
        const rr = Math.hypot(x - rip.x, y - rip.y);
        const ring = Math.abs(rr - rip.a * 34);
        if (ring < 1.5) k += 1.6 * (1 - rip.a);
      }
      // the meniscus: the front of the ink catches the light
      if (v < 0.95) k = 3 + v;
      if (isGold) {
        const front = Math.abs(d - (1 - this.gold)) < 0.03 && this.gold < 1;
        put(i, front ? GOLDI[5] : ramp(GOLDI, k + 0.8 + (hsh(x, (t * 6) | 0) < 0.02 ? 2 : 0)));
      } else put(i, ramp(INK, k));
    }
    // the seal's core: dry wax-dark, ink swirling in, a gold disc once studied
    const sl = this.seal;
    if (sl) {
      const f = this.coreFill;
      for (const i of this.core) {
        const x = i % W, y = (i / W) | 0;
        const dx = x - sl.x, dy = y - sl.y;
        const r = Math.hypot(dx, dy) / Math.max(1, sl.r - 2);
        const a = Math.atan2(dy, dx);
        const sw = Math.sin(a * 3 + r * 6 - t * 5);
        const wet = r > 1 - f;
        const lit = -dx * 0.6 - dy * 0.8 > 0;
        if (this.state === 'done' || (this.gold > 0.95)) put(i, ramp(GOLDI, (lit ? 3.2 : 2.2) + sw * 0.6 - this.press * 2));
        else if (wet) put(i, ramp(INK, 1.5 + sw * 1.2 + (this.state === 'ready' ? 1 + Math.sin(t * 5) * 0.8 : 0) - this.press * 2));
        else put(i, r > 0.7 ? GROOVE : GROOVE_D);
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
    // droplets on top (drawn after the put: they may leave the channels)
    for (const d of this.drops) {
      const c = d.gold ? (d.life > 0.4 ? '#fff0a6' : '#e2b24a') : d.life > 0.4 ? '#4468c0' : '#182a5c';
      this.ctx.fillStyle = c;
      this.ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 1);
    }
  }

  // ======================================================================= plans
  /** a study cartouche: an inkwell, a Greek-key channel into the entry's glyph, out to a seal */
  static glyph(key: string, w: number, h: number): InkCircuit {
    const mask = new Uint8Array(w * h);
    const set = (x: number, y: number, v = 1) => {
      if (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] !== 2) mask[y * w + x] = v;
    };
    const hs = strHash(key);
    const g = GLYPH_BITMAPS[hs % GLYPH_BITMAPS.length];
    const my = Math.floor(h / 2);
    // the glyph, each cell a 2x2 carving
    const gw = 14, gh = 18;
    const gx0 = Math.round(w * 0.47 - gw / 2), gy0 = Math.round(h / 2 - gh / 2);
    const glyphCells: [number, number][] = [];
    g.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch !== '#') return;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) set(gx0 + i * 2 + a, gy0 + j * 2 + b);
      glyphCells.push([gx0 + i * 2, gy0 + j * 2]);
    }));
    // a 2-wide channel from (x0,y) to (x1,y), stepping up and down like a Greek key
    const meander = (x0: number, x1: number, y: number, amp: number, period: number, ph: number) => {
      let yy = y;
      let k = 0;
      for (let x = x0; x <= x1; x++) {
        const want = y + (Math.floor((x - x0) / period + ph) % 2 === 0 ? 0 : amp);
        while (yy !== want) {
          set(x, yy);
          set(x + 1, yy);
          yy += Math.sign(want - yy);
        }
        set(x, yy);
        set(x, yy + 1);
        k++;
      }
      void k;
      return yy;
    };
    // a straight run to a point
    const run = (x0: number, y0: number, x1: number, y1: number) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let s = 0; s <= n; s++) {
        const x = Math.round(x0 + ((x1 - x0) * s) / Math.max(1, n)), y = Math.round(y0 + ((y1 - y0) * s) / Math.max(1, n));
        set(x, y);
        set(x, y + 1);
        set(x + 1, y);
      }
    };
    // the inkwell sits at the left end; its spout is the source
    const wellX = 8, src = my * w + wellX + 6;
    const near = (x: number, y: number) => glyphCells.reduce((b, c) => (Math.hypot(c[0] - x, c[1] - y) < Math.hypot(b[0] - x, b[1] - y) ? c : b), glyphCells[0]);
    const enter = near(gx0 - 4, my);
    const ly = meander(wellX + 6, gx0 - 9, my - 1, (hs >> 3) % 2 ? 4 : -4, 6, 0);
    run(gx0 - 8, ly, enter[0], enter[1]);
    // spurs: little lotus pools hung off the channels (they fill as the ink passes)
    const spur = (x: number, y: number, dir: number) => {
      for (let k = 1; k <= 4; k++) set(x, y + dir * k);
      for (let a = -1; a <= 1; a++) for (let b = 0; b <= 1; b++) set(x + a, y + dir * (5 + b));
    };
    spur(wellX + 16, my + (((hs >> 3) % 2 ? 4 : -4) > 0 ? -1 : 2), ((hs >> 3) % 2 ? -1 : 1));
    // the seal ring at the right end
    const sr = Math.min(8, Math.floor(h / 2) - 3);
    const sx = w - sr - 7, sy = my;
    const exit = near(gx0 + gw + 4, my);
    const ry = meander(gx0 + gw + 6, sx - sr - 6, my - 1, (hs >> 5) % 2 ? 4 : -4, 5, 1);
    run(exit[0] + 1, exit[1], gx0 + gw + 6, my - 1);
    run(sx - sr - 6, ry, sx - sr, sy);
    spur(Math.round((gx0 + gw + sx - sr) / 2), my + (((hs >> 5) % 2 ? 4 : -4) > 0 ? -1 : 2), ((hs >> 5) % 2 ? -1 : 1));
    for (let y = sy - sr - 1; y <= sy + sr + 1; y++)
      for (let x = sx - sr - 1; x <= sx + sr + 1; x++) {
        const r = Math.hypot(x - sx, y - sy);
        if (r <= sr - 2.2) mask[y * w + x] = 2;
        else if (r <= sr) set(x, y);
      }
    // ---- the plaque: a limestone cartouche, rounded ends, a rope border, the tie bar at the seal end
    const back: Plan['back'] = (put) => {
      const STONE = ['#e6d6b4', '#dccaa4', '#efe2c4', '#cfbb92'].map(rgb);
      const ROPE = ['#7c5214', '#e2b24a', '#b88426', '#3a2406'].map(rgb);
      const rx = w / 2 - 1, ry = h / 2 - 1, rr = ry;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          // a stadium (pill) shape: the cartouche
          const cx = Math.max(rr, Math.min(w - 1 - rr, x + 0.5));
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - (ry + 1)) - rr;
          void rx;
          if (d > 0.5) continue;
          if (d > -1) put(x, y, ROPE[3]);
          else if (d > -3) {
            // the twisted rope: diagonal strands
            const k = (x + y + (y < h / 2 ? 0 : 2)) % 4;
            put(x, y, ROPE[k]);
          } else if (d > -4) put(x, y, ROPE[3]);
          else {
            let c = STONE[hsh(x >> 1, y >> 1) < 0.5 ? 0 : 1];
            if (hsh(x, y) < 0.04) c = STONE[3];
            if (hsh(x * 3, y * 7) < 0.02) c = STONE[2];
            // light from the top left: the inner bevel
            if (d > -5.5 && y < h / 2) c = STONE[2];
            if (d > -5.5 && y > h / 2) c = STONE[3];
            put(x, y, c);
          }
        }
      // the tie bar across the seal end
      for (let y = 3; y < h - 3; y++) for (let x = w - 5; x < w - 3; x++) put(x, y, ROPE[(y + x) % 4]);
      // the inkwell: a faience pot (turquoise glaze, dark mouth) with a reed pen standing in it
      const FA = ['#0b3d2c', '#1d6a4a', '#2fbf7e', '#7cf2b4'].map(rgb);
      for (let y = -6; y <= 5; y++)
        for (let x = -5; x <= 5; x++) {
          const body = Math.hypot(x / 5, (y - 0.5) / 4.6);
          const neck = Math.abs(x) <= 2 && y <= -3 && y >= -5;
          if (body > 1 && !neck) continue;
          const edge = body > 0.84 || (neck && (Math.abs(x) === 2 || y === -5));
          const lit = -x * 0.6 - y * 0.8;
          let c = edge ? FA[0] : lit > 2.5 ? FA[3] : lit > -1 ? FA[2] : FA[1];
          if (neck && y === -5 && Math.abs(x) < 2) c = rgb('#070a1a');
          if (!edge && Math.abs(y - 1) < 0.5 && x % 2 === 0) c = rgb('#e2b24a'); // a gold band
          put(wellX + x, my + y, c);
        }
      for (let k = 0; k < 8; k++) put(wellX + 1 + (k >> 2), my - 6 - k, k > 5 ? rgb('#3a200e') : rgb('#d6b985')); // the reed pen
    };
    return new InkCircuit({ w, h, mask, src, back, seal: { x: sx, y: sy, r: sr } });
  }

  /** a straight gauge channel with a pool at every notch (the hall's title: studies toward the next gift) */
  static gauge(w: number, h: number, notches: number): InkCircuit {
    const mask = new Uint8Array(w * h);
    const my = Math.floor(h / 2);
    for (let x = 2; x < w - 2; x++) for (let y = my - 1; y <= my + 1; y++) mask[y * w + x] = 1;
    // a pool at every study between the gifts, a bigger one at the end (the gift)
    for (let n = 1; n <= notches; n++) {
      const x = Math.round(2 + ((w - 6) * n) / notches);
      const r = n === notches ? 2 : 1;
      for (let y = my - 1 - r; y <= my + 1 + r; y++) for (let xx = x - r; xx <= x + r; xx++) if (xx < w - 1 && y >= 0 && y < h) mask[y * w + xx] = 1;
    }
    const back: Plan['back'] = (put) => {
      const B = ['#3a2406', '#7c5214', '#b88426', '#e2b24a'].map(rgb);
      // a gold rule the channel is cut into
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, y === 0 || y === h - 1 || x === 0 || x === w - 1 ? B[0] : y === 1 ? B[3] : y === h - 2 ? B[1] : B[2]);
    };
    return new InkCircuit({ w, h, mask, src: my * w + 2, back });
  }

  /** a ring channel (the astrolabe's scale): from `a0` clockwise through `sweep` radians, radius r, width 3 */
  static ring(size: number, r: number, a0: number, sweep: number): InkCircuit {
    const mask = new Uint8Array(size * size);
    const c = (size - 1) / 2;
    let src = -1, bestA = 1e9;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const dx = x - c, dy = y - c;
        const rr = Math.hypot(dx, dy);
        if (Math.abs(rr - r) > 1.5) continue;
        let a = Math.atan2(dx, -dy) - a0; // 0 at the top, clockwise
        while (a < 0) a += Math.PI * 2;
        while (a >= Math.PI * 2) a -= Math.PI * 2;
        if (a > sweep) continue;
        mask[y * size + x] = 1;
        if (a < bestA) (bestA = a), (src = y * size + x);
      }
    return new InkCircuit({ w: size, h: size, mask, src });
  }
}
