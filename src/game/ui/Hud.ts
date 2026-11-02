// Minimal pixel-art HUD drawn on a half-resolution canvas scaled up with
// nearest-neighbour: revolver cylinder ammo, active-reload arc, bone health,
// boost tail, bounty star, wave tally, boss poster bar, skill icons, toasts.
import { atlas } from '../fx/PixelArt';
import { STATUS_INFO, StatusId } from '../combat/Status';

export interface HudState {
  hp: number;
  maxHp: number;
  shield: number;
  ammo: number;
  maxAmmo: number;
  venom: number;
  reload: { active: boolean; t: number; window: [number, number]; jam: number };
  boost: number;
  speed: number;
  rank: number;
  bountyFrac: number;
  gold: number;
  wave: number;
  waveTime: number;
  waveLabel: string;
  boss: { name: string; frac: number; title?: string } | null;
  ult: number;
  skills: { key: string; icon: string; cd: number; max: number; charges?: number }[];
  items: { key: string; icon: string; count: number }[];
  status: { id: StatusId; stacks: number }[];
  hitMarker: number;
  killMarker: number;
  combo: number;
  locked: boolean;
  aiming: boolean;
  zone: string;
}

interface Toast {
  text: string;
  color: string;
  sub?: string;
  t: number;
  big: boolean;
}

export class Hud {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  scale = 2;
  toasts: Toast[] = [];
  visible = true;
  private w = 0;
  private h = 0;
  private hint: HTMLDivElement;
  private t = 0;
  private shownHp = 1;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'hud';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.hint = document.createElement('div');
    this.hint.className = 'click-hint';
    this.hint.textContent = 'Click to take the reins';
    this.hint.style.display = 'none';
    parent.appendChild(this.hint);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.scale = window.innerWidth > 1700 ? 3 : 2;
    this.w = Math.ceil(window.innerWidth / this.scale);
    this.h = Math.ceil(window.innerHeight / this.scale);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx.imageSmoothingEnabled = false;
  }

  toast(text: string, color = '#fff3d6', sub?: string, big = false) {
    // merge duplicates
    const ex = this.toasts.find((t) => t.text === text && t.t < 0.4);
    if (ex) {
      ex.t = 0;
      return;
    }
    this.toasts.push({ text, color, sub, t: 0, big });
    if (this.toasts.length > 5) this.toasts.shift();
  }

  private spr(name: string, x: number, y: number, s = 1, alpha = 1) {
    const f = atlas().get(name);
    const c = this.ctx;
    const img = atlas().canvas;
    const sx = f.u0 * img.width - 0.5, sy = (1 - f.v1) * img.height - 0.5;
    c.globalAlpha = alpha;
    c.drawImage(img, Math.round(sx), Math.round(sy), f.w, f.h, Math.round(x), Math.round(y), f.w * s, f.h * s);
    c.globalAlpha = 1;
  }

  private text(s: string, x: number, y: number, color = '#fff3d6', size = 8, align: CanvasTextAlign = 'left', font = 'Pixelify Sans', shadow = '#2a1810') {
    const c = this.ctx;
    c.font = `${size}px '${font}'`;
    c.textAlign = align;
    c.textBaseline = 'top';
    c.fillStyle = shadow;
    c.fillText(s, Math.round(x) + 1, Math.round(y) + 1);
    c.fillStyle = color;
    c.fillText(s, Math.round(x), Math.round(y));
  }

  update(dt: number, s: HudState) {
    this.t += dt;
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    this.hint.style.display = s.locked || !this.visible ? 'none' : 'block';
    if (!this.visible) return;
    const W = this.w, H = this.h;
    const cx = Math.round(W / 2), cy = Math.round(H / 2);

    // ---------------------------------------------------- crosshair + reload arc
    const hm = s.hitMarker, km = s.killMarker;
    const gap = s.aiming ? 2 : 3;
    c.fillStyle = km > 0 ? '#ff5a3a' : hm > 0 ? '#fff2a0' : 'rgba(255,246,226,0.9)';
    c.fillRect(cx - gap - 3, cy, 3, 1);
    c.fillRect(cx + gap + 1, cy, 3, 1);
    c.fillRect(cx, cy - gap - 3, 1, 3);
    c.fillRect(cx, cy + gap + 1, 1, 3);
    c.fillRect(cx, cy, 1, 1);
    if (hm > 0 || km > 0) {
      const k = 4 + (km > 0 ? 2 : 0);
      c.fillStyle = km > 0 ? '#ff5a3a' : '#ffffff';
      for (let i = 2; i < k; i++) {
        c.fillRect(cx - i - 1, cy - i - 1, 1, 1);
        c.fillRect(cx + i + 1, cy - i - 1, 1, 1);
        c.fillRect(cx - i - 1, cy + i + 1, 1, 1);
        c.fillRect(cx + i + 1, cy + i + 1, 1, 1);
      }
    }
    if (s.reload.active) {
      const R = 14;
      const seg = 40;
      for (let i = 0; i < seg; i++) {
        const t = i / seg;
        const a = -Math.PI / 2 + t * Math.PI * 2;
        const inWin = t >= s.reload.window[0] && t <= s.reload.window[1];
        const done = t <= s.reload.t;
        c.fillStyle = inWin ? (done ? '#c8ff5a' : '#7ff03a') : done ? '#f1e2c2' : 'rgba(40,24,16,0.6)';
        c.fillRect(Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * R), inWin ? 2 : 1, inWin ? 2 : 1);
      }
      const a = -Math.PI / 2 + s.reload.t * Math.PI * 2;
      c.fillStyle = s.reload.jam > 0 ? '#ff5a3a' : '#ffffff';
      c.fillRect(Math.round(cx + Math.cos(a) * (R + 2)) - 1, Math.round(cy + Math.sin(a) * (R + 2)) - 1, 3, 3);
      this.text(s.reload.jam > 0 ? 'JAMMED' : 'R', cx, cy + R + 5, s.reload.jam > 0 ? '#ff7a5a' : '#c8ff5a', 8, 'center');
    }

    // ------------------------------------------------------------ cylinder
    const cylX = cx, cylY = H - 26;
    c.fillStyle = 'rgba(30,20,14,0.55)';
    c.beginPath();
    c.arc(cylX, cylY, 15, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < s.maxAmmo; i++) {
      const a = -Math.PI / 2 + (i / s.maxAmmo) * Math.PI * 2;
      const x = cylX + Math.cos(a) * 9, y = cylY + Math.sin(a) * 9;
      const loaded = i < s.ammo;
      c.fillStyle = '#1a1210';
      c.fillRect(Math.round(x) - 3, Math.round(y) - 3, 6, 6);
      if (loaded) {
        c.fillStyle = i < s.venom ? '#7ff03a' : '#e0a050';
        c.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
        c.fillStyle = i < s.venom ? '#e0ffb0' : '#fff0a0';
        c.fillRect(Math.round(x) - 2, Math.round(y) - 2, 2, 2);
      }
    }
    c.fillStyle = '#b8c0c6';
    c.fillRect(cylX - 1, cylY - 1, 3, 3);
    this.text(`${Math.round(s.speed)} m/s`, cylX + 22, cylY - 4, s.speed > 30 ? '#ffd36b' : '#c9b79a', 8);

    // ---------------------------------------------------------- health bones
    const hx = 10, hy = H - 22;
    this.shownHp += (s.hp / s.maxHp - this.shownHp) * Math.min(1, dt * 3);
    const segs = 12;
    const frac = s.hp / s.maxHp;
    for (let i = 0; i < segs; i++) {
      const x = hx + i * 9;
      const f0 = i / segs, f1 = (i + 1) / segs;
      const fill = Math.max(0, Math.min(1, (frac - f0) / (f1 - f0)));
      const lag = Math.max(0, Math.min(1, (this.shownHp - f0) / (f1 - f0)));
      c.fillStyle = '#2a1810';
      c.fillRect(x - 1, hy - 1, 9, 7);
      c.fillStyle = '#7e1410';
      c.fillRect(x, hy, Math.round(7 * lag), 5);
      c.fillStyle = frac < 0.3 && Math.sin(this.t * 10) > 0 ? '#ff5a3a' : '#f1e2c2';
      c.fillRect(x, hy, Math.round(7 * fill), 5);
      if (fill > 0.5) {
        c.fillStyle = '#fff6e2';
        c.fillRect(x, hy, Math.round(7 * fill), 1);
      }
    }
    if (s.shield > 0) {
      c.fillStyle = '#9fd2ff';
      c.fillRect(hx, hy - 4, Math.min(segs * 9 - 2, Math.round((s.shield / s.maxHp) * segs * 9)), 2);
    }
    this.text(`${Math.ceil(s.hp)}/${Math.round(s.maxHp)}`, hx, hy - 13, '#f1e2c2', 8);
    // boost meter (scorpion tail)
    const bw = 70;
    c.fillStyle = '#2a1810';
    c.fillRect(hx - 1, hy + 8, bw + 2, 4);
    c.fillStyle = s.boost > 0.25 ? '#6fe3cf' : '#3a8a80';
    c.fillRect(hx, hy + 9, Math.round(bw * s.boost), 2);
    this.spr('scorp', hx + bw + 4, hy + 6);
    // statuses
    let sx = hx + 120;
    for (const st of s.status) {
      if (st.stacks <= 0) continue;
      const info = STATUS_INFO[st.id];
      this.spr(info.icon, sx, hy - 2);
      this.text(String(Math.round(st.stacks)), sx + 9, hy, info.css, 8);
      sx += 22;
    }

    // ---------------------------------------------------------- bounty + gold
    this.spr('sheriff_x2', 8, 8);
    this.text(String(s.rank), 17, 13, '#2a1810', 8, 'center', 'Pixelify Sans', 'transparent');
    c.fillStyle = '#2a1810';
    c.fillRect(30, 12, 82, 5);
    c.fillStyle = '#7ff03a';
    c.fillRect(31, 13, Math.round(80 * s.bountyFrac), 3);
    this.text('BOUNTY RANK', 30, 19, '#c9b79a', 7);
    this.spr('coin', 30, 29);
    this.text(String(s.gold), 43, 29, '#f5c84a', 8);
    if (s.combo > 2) this.text(`${s.combo} KILL STREAK`, 30, 41, '#ffd36b', 8);

    // ---------------------------------------------------------- wave tally
    if (!s.boss) {
      this.text(s.waveLabel, cx, 7, '#fff3d6', 16, 'center', 'Rye');
      const tl = Math.ceil(s.waveTime);
      if (tl < 900) this.text(`${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`, cx, 26, '#c9b79a', 8, 'center');
      this.text(s.zone, cx, 36, 'rgba(240,220,180,0.7)', 7, 'center');
    } else {
      const bw2 = Math.min(260, W * 0.5);
      const bx = cx - bw2 / 2;
      this.text(s.boss.name.toUpperCase(), cx, 6, '#fff3d6', 13, 'center', 'Rye');
      if (s.boss.title) this.text(s.boss.title, cx, 21, '#c9a97c', 7, 'center');
      c.fillStyle = '#2a1810';
      c.fillRect(bx - 2, 30, bw2 + 4, 8);
      c.fillStyle = '#5a1410';
      c.fillRect(bx, 32, bw2, 4);
      c.fillStyle = '#d0402c';
      c.fillRect(bx, 32, Math.round(bw2 * Math.max(0, s.boss.frac)), 4);
      c.fillStyle = '#ff8a6a';
      c.fillRect(bx, 32, Math.round(bw2 * Math.max(0, s.boss.frac)), 1);
    }

    // ---------------------------------------------------------- skills
    let kx = W - 12;
    const ky = H - 26;
    // ultimate sun dial
    const ur = 12;
    const ux = W - 24, uy = H - 46;
    c.fillStyle = 'rgba(30,20,14,0.6)';
    c.beginPath();
    c.arc(ux, uy, ur + 2, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = s.ult >= 1 ? (Math.sin(this.t * 8) > 0 ? '#ffd36b' : '#fff6c0') : '#d49a24';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(ux, uy, ur, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, s.ult));
    c.stroke();
    this.spr('scorp', ux - 4, uy - 4);
    this.text('Z', ux, uy + ur + 3, s.ult >= 1 ? '#ffd36b' : '#8a7a60', 8, 'center');
    kx = W - 48;
    for (let i = s.skills.length - 1; i >= 0; i--) {
      const sk = s.skills[i];
      const x = kx - 20, y = ky - 2;
      c.fillStyle = 'rgba(30,20,14,0.6)';
      c.fillRect(x - 1, y - 1, 18, 18);
      this.spr(sk.icon, x + 4, y + 3, 1, sk.cd > 0 ? 0.45 : 1);
      if (sk.cd > 0) {
        c.fillStyle = 'rgba(10,6,4,0.55)';
        const hh = Math.round(16 * (sk.cd / sk.max));
        c.fillRect(x, y + 16 - hh, 16, hh);
      }
      this.text(sk.key, x + 8, y + 18, '#c9b79a', 7, 'center');
      if (sk.charges !== undefined && sk.charges > 1) this.text(String(sk.charges), x + 13, y - 2, '#fff3d6', 7);
      kx -= 21;
    }
    // consumables
    let ix = 10;
    for (const it of s.items) {
      const y = H - 52;
      c.fillStyle = 'rgba(30,20,14,0.6)';
      c.fillRect(ix - 1, y - 1, 18, 18);
      if (it.icon) this.spr(it.icon, ix + 2, y + 3);
      this.text(it.key, ix + 1, y + 10, '#c9b79a', 7);
      if (it.count > 1) this.text('x' + it.count, ix + 10, y + 10, '#fff3d6', 7);
      ix += 21;
    }

    // ---------------------------------------------------------- toasts
    let ty = Math.round(H * 0.3);
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const tt = this.toasts[i];
      tt.t += dt;
      const life = tt.big ? 2.6 : 1.5;
      if (tt.t > life) {
        this.toasts.splice(i, 1);
        continue;
      }
      const pop = tt.t < 0.12 ? 1 + (0.12 - tt.t) * 4 : 1;
      const a = tt.t > life - 0.4 ? (life - tt.t) / 0.4 : 1;
      c.globalAlpha = a;
      const size = Math.round((tt.big ? 16 : 10) * pop);
      this.text(tt.text, cx + Math.round(W * 0.14), ty - tt.t * 6, tt.color, size, 'left', tt.big ? 'Rye' : 'Pixelify Sans');
      if (tt.sub) this.text(tt.sub, cx + Math.round(W * 0.14), ty + size + 1 - tt.t * 6, '#c9b79a', 7);
      c.globalAlpha = 1;
      ty += size + (tt.sub ? 12 : 4);
    }
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.canvas.style.opacity = v ? '1' : '0';
  }
}
