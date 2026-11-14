// INKWELL, the bookmark. One of Thoth's bookworm librarians (a real earthworm: ringed, moist, eyeless,
// a swollen saddle a third of the way back, a little maroon fez with a gold tassel) lives on the
// specimen sheet. It holds the top of the page with its tail and hangs down the sheet's outer edge
// like a bookmark ribbon, but it is alive:
//  - a position-based physics chain: segment lengths, a bending stiffness, gravity, and the sheet's
//    edge as a wall it rests against; a page turning or the sheet sliding in swings it about
//  - peristalsis: contraction rings travel down the body; when nothing happens it rears up and feels
//    the air, then sags back under its own weight
//  - it reads by touch: the head turns toward a pointer that comes near (sniffing), and flinches back
//    from one that comes too close
//  - grab it (mouse or finger) and it stretches after your hand; tug it down hard and let go and it
//    pulls the page over (the next entry); a quick tap makes it squirm (the hall's own bookworms hear)
// Drawn as pixel art at UI resolution: a signed distance over the chain's capsules, shaded from the
// top left, ring grooves, the saddle, wet glints and an ink outline.
//
//   const w = new PageWorm();  w.anchor(x, y, wallX)  (css px, every frame)
//   w.update(dt, S, ptr)   w.draw(ctx, S)   w.down(x, y) / w.move(x, y) / w.up(x, y) -> 'next' | 'poke' | null
const N = 13;
const PAL = {
  base: [194, 122, 106], back: [154, 82, 74], belly: [226, 171, 152], saddle: [220, 138, 98], groove: [126, 64, 58],
  glint: [246, 204, 188], ink: [46, 20, 16], fez: [138, 42, 38], fezL: [176, 66, 58], fezD: [90, 26, 24], gold: [226, 178, 74], goldL: [255, 240, 166],
} as const;

interface P {
  x: number;
  y: number;
  px: number;
  py: number;
}

export class PageWorm {
  private p: P[] = [];
  private ax = 0;
  private ay = 0;
  private wall = 0;
  private placed = false;
  private t = Math.random() * 10;
  private grab = -1;
  private gx = 0;
  private gy = 0;
  private gsx = 0;
  private gsy = 0;
  private gt = 0;
  private squirm = 0;
  private rear = 0;
  private rearIn = 4 + Math.random() * 5;
  private tassel = { x: 0, y: 0, px: 0, py: 0 };
  private cv = document.createElement('canvas');
  private cx: CanvasRenderingContext2D;
  /** where it was last drawn (css px) */
  box = { x: 0, y: 0, w: 0, h: 0 };
  /** fade (the sheet sliding away takes the worm with it) */
  alpha = 1;

  constructor() {
    this.cx = this.cv.getContext('2d')!;
  }

  /** where the tail holds the page (css px), and the sheet's outer edge (the wall it hangs against) */
  anchor(x: number, y: number, wall: number) {
    this.ax = x;
    this.ay = y;
    this.wall = wall;
    if (!this.placed) {
      this.placed = true;
      for (let i = 0; i < N; i++) this.p.push({ x: x - 4, y: y + i * 6, px: x - 4, py: y + i * 6 });
      this.tassel = { x, y: y + N * 6, px: x, py: y + N * 6 };
    }
  }
  /** a shove (a page turning beside it, the sheet arriving) */
  kick(vx: number, vy = 0) {
    for (let i = 2; i < N; i++) {
      const k = i / N;
      this.p[i].px -= vx * k * 0.016;
      this.p[i].py -= vy * k * 0.016;
    }
  }
  /** css-px hit test against the body */
  hit(x: number, y: number, S: number) {
    for (let i = 3; i < N; i++) if (Math.hypot(this.p[i].x - x, this.p[i].y - y) < 7 * S * 0.5 + 8) return i;
    return -1;
  }
  get grabbed() {
    return this.grab >= 0;
  }
  down(x: number, y: number, S: number) {
    const i = this.hit(x, y, S);
    if (i < 0) return false;
    this.grab = i;
    this.gx = this.gsx = x;
    this.gy = this.gsy = y;
    this.gt = 0;
    return true;
  }
  move(x: number, y: number) {
    if (this.grab < 0) return;
    this.gx = x;
    this.gy = y;
  }
  /** let go: a long tug down turns the page, a short tap makes it squirm */
  up(): 'next' | 'poke' | null {
    if (this.grab < 0) return null;
    const dy = this.gy - this.gsy, dx = this.gx - this.gsx;
    const moved = Math.hypot(dx, dy);
    this.grab = -1;
    if (moved < 8 && this.gt < 0.4) {
      this.squirm = 1.2;
      return 'poke';
    }
    if (dy > 46) {
      this.squirm = 0.6;
      return 'next';
    }
    return null;
  }

  update(dt: number, S: number, ptr: { x: number; y: number; has: boolean }) {
    if (!this.placed) return;
    dt = Math.min(dt, 1 / 30);
    this.t += dt;
    const t = this.t;
    this.gt += dt;
    this.squirm = Math.max(0, this.squirm - dt);
    // rearing up to feel the air now and then
    this.rearIn -= dt;
    if (this.rearIn <= 0 && this.rear <= 0) {
      this.rear = 1.6 + Math.random();
      this.rearIn = 6 + Math.random() * 8;
    }
    this.rear = Math.max(0, this.rear - dt);
    const L = 3.1 * S;
    const g = 260 * S;
    const head = this.p[N - 1];
    // verlet
    for (let i = 1; i < N; i++) {
      const q = this.p[i];
      const vx = (q.x - q.px) * 0.982, vy = (q.y - q.py) * 0.982;
      q.px = q.x;
      q.py = q.y;
      q.x += vx;
      q.y += vy + g * dt * dt;
    }
    // muscles: the head sniffs toward a pointer that comes near and shies from one too close
    if (this.grab < 0 && ptr.has) {
      const dx = ptr.x - head.x, dy = ptr.y - head.y;
      const d = Math.hypot(dx, dy);
      if (d < 150 && d > 1) {
        const f = d < 22 ? -1.4 : 0.5 * (1 - d / 150);
        for (let i = N - 4; i < N; i++) {
          const k = (i - (N - 5)) / 4;
          this.p[i].x += (dx / d) * f * k * S * 0.9;
          this.p[i].y += (dy / d) * f * k * S * 0.9 - (d < 22 ? 0 : 0.3 * S * k);
        }
      }
    }
    if (this.grab < 0) {
      // muscle tone: the front curls up and out into a curious J, breathing a little
      for (let i = N - 4; i < N; i++) {
        const w = (i - (N - 5)) / 4;
        this.p[i].y -= w * w * (0.34 + Math.sin(t * 1.3) * 0.08) * S;
        this.p[i].x -= w * 0.12 * S;
      }
    }
    if (this.rear > 0 && this.grab < 0) {
      // rear: the front third lifts and sways, feeling about
      const k = Math.sin(Math.min(1, this.rear / 1.6) * Math.PI);
      for (let i = N - 5; i < N; i++) {
        const w = (i - (N - 6)) / 5;
        this.p[i].y -= k * w * 0.9 * S;
        this.p[i].x += Math.sin(t * 3.1) * k * w * 0.35 * S - k * w * 0.25 * S;
      }
    }
    if (this.squirm > 0) {
      for (let i = 3; i < N; i++) this.p[i].x += Math.sin(t * 26 + i * 1.3) * this.squirm * 0.9 * S;
    }
    if (this.grab >= 0) {
      const q = this.p[this.grab];
      q.x += (this.gx - q.x) * 0.6;
      q.y += (this.gy - q.y) * 0.6;
    }
    // constraints: peristaltic segment lengths, a little bending stiffness, the wall, the anchor
    for (let it = 0; it < 6; it++) {
      const a = this.p[0];
      a.x = this.ax;
      a.y = this.ay;
      for (let i = 1; i < N; i++) {
        const A = this.p[i - 1], B = this.p[i];
        const ring = 1 + 0.16 * Math.sin(t * 4.2 - i * 0.85) * (0.4 + this.squirm);
        const want = L * ring * (this.grab >= 0 ? 1.12 : 1);
        const dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.hypot(dx, dy) || 1e-4;
        const k = (d - want) / d;
        if (i === 1) {
          B.x -= dx * k;
          B.y -= dy * k;
        } else {
          A.x += dx * k * 0.5;
          A.y += dy * k * 0.5;
          B.x -= dx * k * 0.5;
          B.y -= dy * k * 0.5;
        }
      }
      for (let i = 2; i < N; i++) {
        const A = this.p[i - 2], B = this.p[i];
        const dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.hypot(dx, dy) || 1e-4;
        const min = L * 1.55;
        if (d < min) {
          const k = ((d - min) / d) * 0.25;
          B.x -= dx * k;
          B.y -= dy * k;
          if (i > 2) {
            A.x += dx * k;
            A.y += dy * k;
          }
        }
      }
      for (let i = 2; i < N; i++) {
        const q = this.p[i];
        const lim = this.wall - 3.2 * S;
        if (q.x > lim && this.grab !== i) q.x = lim;
      }
      if (this.grab >= 0) {
        const q = this.p[this.grab];
        q.x = this.gx + (q.x - this.gx) * 0.5;
        q.y = this.gy + (q.y - this.gy) * 0.5;
      }
    }
    // the fez's tassel swings on a short cord
    const hd = this.headFrame(S);
    const tx = hd.tip.x, ty = hd.tip.y;
    const T = this.tassel;
    const vx = (T.x - T.px) * 0.94, vy = (T.y - T.py) * 0.94;
    T.px = T.x;
    T.py = T.y;
    T.x += vx;
    T.y += vy + g * dt * dt;
    const d = Math.hypot(T.x - tx, T.y - ty) || 1e-4;
    const len = 3.2 * S;
    T.x = tx + ((T.x - tx) / d) * len;
    T.y = ty + ((T.y - ty) / d) * len;
  }

  /** the head's direction and the fez's top (css px) */
  private headFrame(S = 2) {
    const h = this.p[N - 1], n = this.p[N - 2];
    const dx = h.x - n.x, dy = h.y - n.y;
    const d = Math.hypot(dx, dy) || 1;
    const fx = dx / d, fy = dy / d;
    // "up" for the head: the side away from gravity
    let ux = -fy, uy = fx;
    if (uy > 0) (ux = -ux), (uy = -uy);
    // the fez's crown: 6.2 UI px up off the head's centre
    return { fx, fy, ux, uy, tip: { x: h.x + ux * 6.2 * S, y: h.y + uy * 6.2 * S } };
  }

  /** rasterise the worm at UI resolution and blit it at S */
  draw(c: CanvasRenderingContext2D, S: number) {
    if (!this.placed || this.alpha <= 0.01) return;
    // work in UI pixels
    const pts = this.p.map((q) => ({ x: q.x / S, y: q.y / S }));
    const rad = (i: number) => {
      // i = 0 tail (anchor) .. N-1 head: a blunt head, the swollen saddle a third back, a tapering tail
      const u = 1 - i / (N - 1);
      const saddle = Math.exp(-((u - 0.3) ** 2) / 0.006) * 0.55;
      return 1.35 + 1.95 * Math.min(1, (1 - u) * 3.2) * (u > 0.05 ? 1 : 0.9) + saddle - (u < 0.04 ? 0.3 : 0);
    };
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const q of pts) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
    const tl = { x: this.tassel.x / S, y: this.tassel.y / S };
    x0 = Math.floor(Math.min(x0, tl.x) - 7);
    y0 = Math.floor(Math.min(y0, tl.y) - 9);
    x1 = Math.ceil(Math.max(x1, tl.x) + 7);
    y1 = Math.ceil(Math.max(y1, tl.y) + 7);
    const W = x1 - x0, H = y1 - y0;
    if (W <= 0 || H <= 0 || W > 400 || H > 400) return;
    if (this.cv.width !== W || this.cv.height !== H) {
      this.cv.width = W;
      this.cv.height = H;
    }
    const img = this.cx.createImageData(W, H);
    const o = img.data;
    // cumulative length along the body (head = 0) for the ring grooves
    const acc: number[] = new Array(N).fill(0);
    for (let i = N - 2; i >= 0; i--) acc[i] = acc[i + 1] + Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    const total = acc[0] || 1;
    const put = (x: number, y: number, col: readonly number[]) => {
      const j = (y * W + x) * 4;
      o[j] = col[0];
      o[j + 1] = col[1];
      o[j + 2] = col[2];
      o[j + 3] = 255;
    };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const X = x + x0 + 0.5, Y = y + y0 + 0.5;
        let best = 1e9, bs = 0, bi = 0, bnx = 0, bny = 0;
        for (let i = 0; i < N - 1; i++) {
          const A = pts[i], B = pts[i + 1];
          const ex = B.x - A.x, ey = B.y - A.y;
          const l2 = ex * ex + ey * ey || 1e-4;
          const s = Math.max(0, Math.min(1, ((X - A.x) * ex + (Y - A.y) * ey) / l2));
          const cx = A.x + ex * s, cy = A.y + ey * s;
          const r = rad(i) + (rad(i + 1) - rad(i)) * s;
          const dd = Math.hypot(X - cx, Y - cy) - r;
          if (dd < best) {
            best = dd;
            bs = s;
            bi = i;
            bnx = (X - cx) / (r || 1);
            bny = (Y - cy) / (r || 1);
          }
        }
        if (best > 0.5) {
          // a soft drop shadow down and to the right, so it reads against the hall behind it
          let sh = 1e9;
          for (let i = 0; i < N - 1 && sh > 0; i++) {
            const A = pts[i], B = pts[i + 1];
            const ex = B.x - A.x, ey = B.y - A.y;
            const l2 = ex * ex + ey * ey || 1e-4;
            const s2 = Math.max(0, Math.min(1, ((X - 1.5 - A.x) * ex + (Y - 2 - A.y) * ey) / l2));
            sh = Math.min(sh, Math.hypot(X - 1.5 - A.x - ex * s2, Y - 2 - A.y - ey * s2) - rad(i));
          }
          if (sh < 0) {
            const j = (y * W + x) * 4;
            o[j] = 20;
            o[j + 1] = 8;
            o[j + 2] = 4;
            o[j + 3] = 110;
          }
          continue;
        }
        if (best > -0.75) {
          put(x, y, PAL.ink);
          continue;
        }
        const along = acc[bi] + (acc[bi + 1] - acc[bi]) * bs; // 0 at the head
        const u = along / total;
        const lit = -bnx * 0.62 - bny * 0.78;
        let col: readonly number[] = lit > 0.35 ? PAL.base : lit > -0.25 ? PAL.back : PAL.groove;
        if (lit < -0.55) col = PAL.belly; // the paler belly catches the bounce on the far side
        const inSaddle = u > 0.22 && u < 0.36;
        if (inSaddle) col = lit > 0 ? PAL.saddle : PAL.back;
        else if (u > 0.06 && Math.floor(along * 0.85) % 3 === 0 && lit < 0.8) col = PAL.groove; // the annuli
        if (lit > 0.7 && ((x + y + Math.floor(this.t * 2)) & 3) === 0) col = PAL.glint; // a wet glint
        put(x, y, col);
      }
    // the head: a dark mouth slit under the lobe (no eyes: it reads by touch)
    const hf = this.headFrame(S);
    const hp = pts[N - 1];
    const mx = Math.round(hp.x - hf.ux * 1.6 + hf.fx * 1.4) - x0, my = Math.round(hp.y - hf.uy * 1.6 + hf.fy * 1.4) - y0;
    if (mx >= 0 && my >= 0 && mx < W && my < H) put(mx, my, PAL.ink);
    // the fez: a little truncated cone on the head's top, the tassel hanging off its crown
    const fx0 = hp.x + hf.ux * 2.2, fy0 = hp.y + hf.uy * 2.2;
    for (let a = -2.5; a <= 2.5; a += 0.5)
      for (let b = 0; b <= 4; b += 0.5) {
        const half = 2.4 - b * 0.28;
        if (Math.abs(a) > half) continue;
        const X = Math.round(fx0 + hf.fx * a + hf.ux * b) - x0, Y = Math.round(fy0 + hf.fy * a + hf.uy * b) - y0;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const edge = Math.abs(a) > half - 0.6 || b > 3.6 || b < 0.5;
        put(X, Y, edge ? PAL.fezD : a * hf.fx < 0 ? PAL.fezL : PAL.fez);
      }
    const top = { x: hf.tip.x / S, y: hf.tip.y / S };
    const n = 5;
    for (let k = 0; k <= n; k++) {
      const X = Math.round(top.x + (tl.x - top.x) * (k / n)) - x0, Y = Math.round(top.y + (tl.y - top.y) * (k / n)) - y0;
      if (X >= 0 && Y >= 0 && X < W && Y < H) put(X, Y, k === n ? PAL.goldL : PAL.gold);
    }
    const TX = Math.round(tl.x) - x0, TY = Math.round(tl.y) - y0;
    for (const [dx, dy] of [[0, 1], [-1, 1], [1, 1], [0, 2]]) if (TX + dx >= 0 && TY + dy >= 0 && TX + dx < W && TY + dy < H) put(TX + dx, TY + dy, PAL.gold);
    this.cx.putImageData(img, 0, 0);
    this.box = { x: x0 * S, y: y0 * S, w: W * S, h: H * S };
    c.globalAlpha = this.alpha;
    c.imageSmoothingEnabled = false;
    c.drawImage(this.cv, x0 * S, y0 * S, W * S, H * S);
    c.globalAlpha = 1;
  }
}
