// Sculpted set pieces for the tarot-card dioramas (photographed in 3D by
// CardStudio) and the gilded 3D card frame itself. Everything here is shaped by
// hand-tuned curves: tapering wood, twisted rope, flame tongues, a sculpted sun
// face, a rippled banner. No primitive stand-ins (see /CLAUDE.md).
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { hash2, hash3, noise } from '../../../engine/math/rand';

interface Ramp4 {
  base: number;
  shade: number;
  hi: number;
  dark: number;
}
const R = (base: number, shade: number, hi: number, dark: number): Ramp4 => ({ base, shade, hi, dark });

export const GILT = R(0xd6a64c, 0xa5752e, 0xf8da86, 0x684414);
const IVORY = R(0xecdfc0, 0xd4c29e, 0xfaf2dc, 0xa8926c);
const LAPIS = R(0x2f58ac, 0x1f3e82, 0x5c86d8, 0x142450);
const TURQ = R(0x3bb5a4, 0x2a8b7e, 0x70dccb, 0x165a50);
const CARN = R(0xd0502e, 0x9a3420, 0xf27e56, 0x5e1a10);
const OXBLOOD = R(0x601e19, 0x481612, 0x7a2c22, 0x2c0c0a);
const PARCH = R(0xf0e2bc, 0xdac698, 0xfcf4de, 0xb39c70);
const INK = 0x26160c;

export function mixc(a: number, b: number, t: number) {
  t = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
const sstep = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ============================================================== card frame
// 80 × 130 voxels (the HUD card aspect), front relief + back emblem. Built as
// height fields and painted like hand-embossed gilt: light from the upper left
// puts a highlight on each raised edge and a shade on each lower-right edge.

const FW = 80, FH = 130;
/** the art window (inclusive voxel rect) and the typography plaques */
export const CARD = {
  W: FW,
  H: FH,
  win: { x0: 7, y0: 24, x1: 72, y1: 111 },
  numeral: { cx: 39.5, cy: 118.5, w: 20, h: 7 },
  title: { cx: 39.5, cy: 11.5, w: 54, h: 8 },
};

const MAT: (Ramp4 | null)[] = [null, GILT, IVORY, LAPIS, TURQ, CARN, R(INK, INK, 0x3a2416, INK), OXBLOOD, PARCH];
const M = { GILT: 1, IVORY: 2, LAPIS: 3, TURQ: 4, CARN: 5, INK: 6, OX: 7, PARCH: 8 } as const;

class Relief {
  h: Int8Array;
  m: Uint8Array;
  constructor(public w: number, public hh: number) {
    this.h = new Int8Array(w * hh);
    this.m = new Uint8Array(w * hh);
  }
  in(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.hh;
  }
  put(x: number, y: number, h: number, m: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.in(x, y)) return;
    const i = y * this.w + x;
    this.h[i] = h;
    this.m[i] = m;
  }
  /** raise only (keeps taller work underneath) */
  up(x: number, y: number, h: number, m: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.in(x, y)) return;
    const i = y * this.w + x;
    if (h >= this.h[i]) {
      this.h[i] = h;
      this.m[i] = m;
    }
  }
  H(x: number, y: number) {
    return this.in(x, y) ? this.h[y * this.w + x] : -9;
  }
  /** write into the model: the slab top sits at z = zTop, relief grows along dir */
  emit(vm: VoxelModel, zTop: number, dir: 1 | -1, mirror: boolean, gemFlags: number, pal: (Ramp4 | null)[] = MAT, glowIds: number[] = []) {
    for (let y = 0; y < this.hh; y++)
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const id = this.m[i];
        if (!id) continue;
        const h = this.h[i];
        const ramp = pal[id]!;
        // light from the viewer's upper left (mirrored on the back)
        const lx = mirror ? x + 1 : x - 1, rx = mirror ? x - 1 : x + 1;
        const litEdge = this.H(lx, y) < h || this.H(x, y + 1) < h;
        const darkEdge = this.H(rx, y) < h || this.H(x, y - 1) < h;
        const deep = h <= 0;
        let top = ramp.base;
        if (deep) top = ramp.dark;
        else if (litEdge && !darkEdge) top = ramp.hi;
        else if (darkEdge && !litEdge) top = ramp.shade;
        // gentle hand-rubbed wear on the gilt (worn high points shine)
        if (id === M.GILT && !deep && hash2(x * 7 + (mirror ? 999 : 0), y * 3) < 0.07) top = mixc(top, ramp.hi, 0.6);
        if ((id === M.IVORY || id === M.PARCH) && !deep) top = mixc(top, ramp.shade, sstep(0.25, 0.9, noise.fbm2(x * 0.09, y * 0.07, 3) * 0.5 + 0.5) * 0.35);
        const fl = id === M.CARN ? gemFlags : glowIds.includes(id) ? VF.SOLID | VF.EMISSIVE : id === M.GILT ? VF.SOLID | VF.METAL : VF.SOLID;
        if (h <= 0) {
          vm.set(x, y, zTop, top, fl);
          continue;
        }
        for (let k = 1; k <= h; k++) vm.set(x, y, zTop + dir * k, k === h ? top : ramp.shade, fl);
      }
  }
}

function moldingRing(rf: Relief, d: number, x: number, y: number) {
  // the outer gilt molding: a rounded bead on the edge, a groove, a bead row
  const along = d === Math.min(x, FW - 1 - x) ? y : x;
  if (d === 0) rf.put(x, y, 2, M.GILT);
  else if (d === 1 || d === 2) rf.put(x, y, 3, M.GILT);
  else if (d === 3) rf.put(x, y, 2, M.GILT);
  else if (d === 4) rf.put(x, y, 0, M.INK);
  else if (d === 5) rf.put(x, y, along % 3 === 2 ? 1 : 2, along % 3 === 2 ? M.IVORY : M.GILT);
}

function rosette(rf: Relief, cx: number, cy: number, r: number) {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > r + 0.2) continue;
      const a = Math.atan2(dy, dx);
      if (d < r * 0.42) rf.put(x, y, 4, M.CARN);
      else if (Math.cos(a * 4) > 0.1 - d * 0.04) rf.put(x, y, d < r * 0.75 ? 3 : 2, M.GILT);
      else rf.put(x, y, 2, M.LAPIS);
    }
}

function scorpionEmblem(rf: Relief, cx: number, cy: number) {
  // Serket's scorpion, head up, tail curling down and around: rounded plates
  const dome = (lx: number, ly: number, ex: number, ey: number, rx: number, ry: number, hMax: number, m: number) => {
    const d = ((lx - ex) / rx) ** 2 + ((ly - ey) / ry) ** 2;
    if (d > 1) return;
    rf.up(Math.round(lx + cx), Math.round(ly + cy), Math.max(2, Math.round(2 + (hMax - 2) * Math.sqrt(1 - d))), m);
  };
  const shapes: [number, number, number, number, number][] = [];
  shapes.push([0, 9, 5.2, 5.6, 5]); // prosoma
  for (let i = 0; i < 6; i++) shapes.push([0, 3 - i * 2.7, 5.6 - i * 0.25, 1.7, 4]); // mesosoma plates
  // tail: down, then curling to the right and up
  const tail: [number, number][] = [];
  for (let t = 0; t <= 1.0001; t += 0.2) {
    const a = -Math.PI / 2 + t * Math.PI * 1.25;
    tail.push([Math.cos(a) * 9 * t + 0, -14 - Math.sin(Math.PI * Math.min(1, t * 1.1)) * 6 + t * 3]);
  }
  for (let y = 0; y < rf.hh; y++)
    for (let x = 0; x < rf.w; x++) {
      const lx = x - cx, ly = y - cy;
      for (const [ex, ey, rx, ry, hm] of shapes) dome(lx, ly, ex, ey, rx, ry, hm, M.GILT);
      tail.forEach(([tx, ty], i) => dome(lx, ly, tx, ty, 2.5 - i * 0.12, 2.5 - i * 0.12, 4, M.GILT));
      // claws: arm then pincer, both sides
      for (const s of [-1, 1]) {
        for (let t = 0; t <= 1; t += 0.12) dome(lx, ly, s * (4 + t * 6), 11 + t * 6, 1.3, 1.3, 3, M.GILT);
        dome(lx, ly, s * 11, 20, 2.8, 4, 4, M.GILT);
        // the pincer gap
        if (Math.abs(lx - s * 11) < 0.6 && ly > 21 && ly < 25) rf.put(x, y, 1, M.LAPIS);
        // four legs per side with a knee
        for (let k = 0; k < 4; k++) {
          const y0 = 6 - k * 2.8;
          for (let t = 0; t <= 1; t += 0.1) {
            const kx = s * (5 + t * 7), ky = y0 + Math.sin(t * Math.PI) * 2.4 - t * 3;
            dome(lx, ly, kx, ky, 0.9, 0.9, 2, M.GILT);
          }
        }
      }
      // plate seams
      for (let i = 0; i < 6; i++) if (Math.abs(ly - (3 - i * 2.7 + 1.35)) < 0.5 && Math.abs(lx) < 5) if (rf.H(x, y) >= 2) rf.put(x, y, 2, M.INK);
    }
  // the stinger
  const [sx, sy] = tail[tail.length - 1];
  for (let t = 0; t < 1; t += 0.1) rf.up(cx + sx + 1 + t * 3, cy + sy + 1.5 + t * t * 2.5, 3, M.CARN);
}

/** the 3D card: gilded front frame (art window open) + a sculpted card back. Pivot = card centre, front faces +Z. */
export function tarotFrame() {
  const vm = new VoxelModel('tarot_frame');
  const { win } = CARD;
  // card stock slab z -2..0, ivory front face, oxblood back face
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      vm.set(x, y, -1, IVORY.shade);
      vm.set(x, y, -2, OXBLOOD.base);
      vm.set(x, y, 0, IVORY.base);
    }
  // ---------------- front relief
  const f = new Relief(FW, FH);
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      const inWin = x >= win.x0 && x <= win.x1 && y >= win.y0 && y <= win.y1;
      if (inWin) continue;
      f.put(x, y, 1, M.IVORY);
      const d = Math.min(x, FW - 1 - x, y, FH - 1 - y);
      if (d <= 5) moldingRing(f, d, x, y);
      // the gilt lip that frames the art
      const dx = x < win.x0 ? win.x0 - x : x > win.x1 ? x - win.x1 : 0;
      const dy = y < win.y0 ? win.y0 - y : y > win.y1 ? y - win.y1 : 0;
      const cd = Math.max(dx, dy);
      if (cd === 1) f.put(x, y, 3, M.GILT);
      else if (cd === 2 && d > 5) f.put(x, y, 2, M.GILT);
    }
  // ---- top: winged cartouche
  const cx = CARD.numeral.cx;
  for (let y = 114; y <= 123; y++)
    for (let x = 8; x <= 71; x++) {
      const ax = Math.abs(x - cx);
      if (ax <= 12.5) {
        // the cartouche: rope border, parchment field (the numeral sits on it)
        const ex = Math.max(0, ax - 9), ey = Math.abs(y - 118.5);
        const rr = Math.hypot(ex, Math.max(0, ey - 1.5));
        if (rr > 3.6 && ey > 3.6) continue;
        const border = ax > 11.2 || ey > 3.9 || rr > 2.7;
        if (ex > 3.6) continue;
        if (border) f.put(x, y, 3, (x + y) % 3 === 0 ? M.PARCH : M.GILT);
        else f.put(x, y, 2, M.PARCH);
        continue;
      }
      // wings: coverts (scaled lapis), secondaries (turquoise), primaries (gilt), scalloped tips
      const t = (ax - 12.5) / 19.5; // 0 at the cartouche → 1 at the tip
      const top = Math.round(123 - t * 1.5);
      const bot = Math.round(114.5 + t * t * 4.5);
      const fi = Math.floor((ax - 12.5) / 2.6);
      const inF = ((ax - 12.5) / 2.6) % 1;
      const scallop = inF < 0.22 || inF > 0.86 ? 1 : 0;
      if (y > top || y < bot + scallop) continue;
      const row = top - y;
      if (row <= 1) f.put(x, y, 2, (x + y) % 2 ? M.LAPIS : M.GILT);
      else if (row <= 3) f.put(x, y, 2, inF < 0.2 ? M.INK : M.TURQ);
      else f.put(x, y, inF < 0.18 ? 1 : 2, inF < 0.18 ? M.LAPIS : y <= bot + scallop + 1 && fi % 2 === 0 ? M.LAPIS : M.GILT);
    }
  // ---- bottom: lotus frieze + title scroll with rolled ends
  for (let x = 8; x <= 71; x++) {
    const k = (x - 8) % 8;
    if (k >= 1 && k <= 5) {
      // lotus flower: three petals fanning out of a gilt cup
      const lx = k - 3;
      for (let y = 18; y <= 21; y++) {
        const ly = y - 18;
        const petal = Math.abs(lx) <= ly * 0.7 + 0.6;
        if (!petal) continue;
        f.put(x, y, 2, ly === 0 ? M.GILT : Math.abs(lx) <= 0.5 ? M.TURQ : M.LAPIS);
      }
    } else if (k === 7) {
      for (let y = 18; y <= 20; y++) f.put(x, y, 2, M.GILT); // bud stem
      f.put(x, 21, 3, M.GILT);
    }
  }
  const plaque = { x0: 12, x1: 67, y0: 7, y1: 16 };
  for (let y = 6; y <= 17; y++)
    for (let x = 5; x <= 74; x++) {
      if (x >= plaque.x0 && x <= plaque.x1) {
        if (y < plaque.y0 || y > plaque.y1) continue;
        const edge = y === plaque.y0 || y === plaque.y1;
        f.put(x, y, edge ? 3 : 2, edge ? M.GILT : M.PARCH);
        continue;
      }
      // scroll rolls: a rolled-paper cylinder profile with a curl at each end
      const left = x < plaque.x0;
      const u = left ? (x - 5) / 6.5 : (74 - x) / 6.5; // 0 outer → 1 inner
      const hh = Math.round(2 + Math.sin(Math.min(1, u) * Math.PI) * 2.4);
      const curl = (y <= 7 || y >= 16) && u > 0.25 && u < 0.85;
      f.put(x, y, hh, curl ? M.INK : u < 0.2 ? M.GILT : M.PARCH);
    }
  // window-corner rosettes
  rosette(f, win.x0 - 0.5, win.y0 - 0.5, 3.6);
  rosette(f, win.x1 + 0.5, win.y0 - 0.5, 3.6);
  rosette(f, win.x0 - 0.5, win.y1 + 0.5, 3.6);
  rosette(f, win.x1 + 0.5, win.y1 + 0.5, 3.6);
  f.emit(vm, 0, 1, false, VF.SOLID | VF.EMISSIVE);
  // ---------------- back: oxblood lattice, Serket inside a rayed sun
  const b = new Relief(FW, FH);
  const bcx = 39.5, bcy = 64.5;
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      const d = Math.min(x, FW - 1 - x, y, FH - 1 - y);
      if (d <= 5) {
        moldingRing(b, d, x, y);
        continue;
      }
      const lattice = (x + y) % 9 === 0 || (((x - y) % 9) + 9) % 9 === 0;
      const dot = (x + y) % 9 === 4 && (((x - y) % 9) + 9) % 9 === 4;
      b.put(x, y, lattice ? 2 : dot ? 2 : 1, lattice || dot ? M.GILT : M.OX);
      if (d === 6 || d === 7) b.put(x, y, d === 6 ? 2 : 1, d === 6 ? M.GILT : M.OX);
      const r = Math.hypot(x - bcx, (y - bcy) * 0.92);
      const a = Math.atan2(y - bcy, x - bcx);
      if (r < 21) b.put(x, y, 1, M.LAPIS);
      else if (r < 23.2) b.put(x, y, 3, M.GILT);
      else if (r < 30 && Math.cos(a * 16) > 0.55 + (r - 23) * 0.06) b.put(x, y, 2, M.GILT);
    }
  scorpionEmblem(b, bcx, bcy - 1);
  b.emit(vm, -2, -1, true, VF.SOLID | VF.EMISSIVE);
  return {
    model: vm,
    voxelSize: 1,
    pivot: [FW / 2, FH / 2, 0] as [number, number, number],
    meta: { ...CARD, faceZ: 0.56, frontZ: 0.5 },
  };
}

// ============================================================== set pieces

const HEMP = R(0xc9a66b, 0xa6844e, 0xe2c68e, 0x6e5432);

/** twisted three-strand rope hanging from the top (pivot top centre), with an ankle hitch at the bottom */
export function hangingRope(lenM = 0.9) {
  const vs = 1 / 80;
  const m = new VoxelModel('tarot_rope');
  const n = Math.round(lenM / vs);
  for (let i = 0; i <= n; i++) {
    const y = -i;
    for (let k = 0; k < 3; k++) {
      const a = i * 0.42 + (k * Math.PI * 2) / 3;
      const sx = Math.cos(a) * 1.1, sz = Math.sin(a) * 1.1;
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          if (dx * dx + dz * dz > 1.2) continue;
          const lit = Math.cos(a + dx * 0.6) > 0.3;
          m.set(Math.round(sx + dx), y, Math.round(sz + dz), k === 0 ? HEMP.hi : lit ? HEMP.base : HEMP.shade);
        }
    }
  }
  // the hitch: three wraps around the ankle, then a frayed tail
  for (let w = 0; w < 3; w++)
    for (let a = 0; a < Math.PI * 2; a += 0.12) {
      const y = -n - 2 - w * 2.6 + Math.sin(a) * 0.7;
      m.set(Math.round(Math.cos(a) * 4.2), Math.round(y), Math.round(Math.sin(a) * 3.4), Math.sin(a) > 0 ? HEMP.base : HEMP.shade);
      m.set(Math.round(Math.cos(a) * 4.6), Math.round(y - 1), Math.round(Math.sin(a) * 3.8), HEMP.shade);
    }
  for (let i = 0; i < 9; i++) m.set(5 + Math.round(i * 0.3), -n - 4 - i, 1 + (i % 2), i > 6 ? HEMP.hi : HEMP.base);
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] as [number, number, number], meta: { length: lenM, hitchY: -(n + 5) * vs } };
}

const BARK = R(0x7a5a3e, 0x5c422c, 0x9c7c58, 0x3a281a);
const LEAF = R(0x6aa03c, 0x4c7c2a, 0x92c85a, 0x30521a);

/**
 * the Hanged Man's tau tree: one gnarled living trunk and a crossbeam sprouting leaves.
 * The trunk stands `lean` voxels behind the beam and curves forward into the fork, so a
 * figure can hang from the middle of the beam in front of it. Pivot at the beam's foot line.
 */
export function tauTree(seed = 3, lean = 18) {
  const vs = 1 / 24;
  const m = new VoxelModel('tarot_tau');
  const bark = (x: number, y: number, z: number) => {
    const g = Math.sin(Math.atan2(z, x) * 7 + y * 0.08 + noise.n2(x * 0.2, y * 0.05) * 2);
    const n = hash3(x, y, z + seed);
    if (g > 0.75) return BARK.dark;
    if (n < 0.08) return BARK.hi;
    return g > 0.2 ? BARK.shade : BARK.base;
  };
  // trunk: an S-curve with a root flare, standing back and bowing forward at the top
  const H = 80;
  const trunkC = (y: number): [number, number] => {
    const t = Math.max(0, y) / H;
    return [Math.sin(t * 2.6 + seed) * 2.2, Math.cos(t * 2.1) * 1.2 - lean * (1 - sstep(0.6, 0.98, t))];
  };
  for (let y = -3; y <= H; y++) {
    const t = y / H;
    const [cx, cz] = trunkC(y);
    const r = 4.2 - t * 1.4 + (y < 8 ? (8 - y) * 0.55 : 0) + noise.n2(y * 0.15, seed) * 0.5;
    const R2 = Math.ceil(r + 1);
    for (let x = -R2; x <= R2; x++)
      for (let z = -R2; z <= R2; z++) {
        const lump = 1 + noise.n3(x * 0.4, y * 0.12, z * 0.4) * 0.16;
        if ((x * x + z * z) / (r * r * lump * lump) <= 1) m.set(Math.round(cx + x), y, Math.round(cz + z), bark);
      }
  }
  // roots
  const [bx0, bz0] = trunkC(0);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + seed;
    const pts: [number, number, number][] = [];
    for (let s = 0; s <= 4; s++) pts.push([bx0 + Math.cos(a) * (3 + s * 2.6), 3 - s * 1.1, bz0 + Math.sin(a) * (3 + s * 2.6)]);
    m.tube(pts, 2.4, 0.8, bark);
  }
  // crossbeam: slightly bowed, sawn ends, resting in a fork at the top
  const span = 30;
  const beamY = H - 1;
  for (let x = -span; x <= span; x++) {
    const bow = -((x / span) ** 2) * 1.6 + 1.6;
    const r = 3.1 - Math.abs(x / span) * 0.5;
    for (let y = -4; y <= 4; y++)
      for (let z = -4; z <= 4; z++) {
        if (y * y + z * z > r * r) continue;
        m.set(x, Math.round(beamY + bow + y), z, Math.abs(x) >= span - 1 ? (y * y + z * z < 2 ? BARK.hi : 0xb8946a) : bark(x + 100, y, z));
      }
  }
  // the fork: two short limbs cupping the beam
  for (const s of [-1, 1]) m.tube([[s * 1, beamY - 6, -1], [s * 4, beamY - 1, 0], [s * 5, beamY + 4, 0]], 2.2, 1.2, bark);
  // leaf sprigs at the beam ends and down the trunk (life from the dead wood)
  const sprig = (px: number, py: number, pz: number, dir: number, len: number) => {
    for (let i = 0; i < len; i++) {
      const sx = px + dir * i * 0.8, sy = py + i * 0.9;
      m.set(Math.round(sx), Math.round(sy), pz, BARK.shade);
      if (i % 2 === 1) {
        for (const s of [-1, 1])
          for (let l = 1; l <= 3; l++) {
            const lx = Math.round(sx + s * l * 0.9), ly = Math.round(sy + l * 0.6 - (l === 3 ? 1 : 0));
            m.set(lx, ly, pz + (l === 2 ? s : 0), l === 1 ? LEAF.shade : l === 2 ? LEAF.base : LEAF.hi);
            m.set(lx, ly + 1, pz, LEAF.base);
          }
      }
    }
  };
  sprig(-span + 2, beamY + 3, 0, -1, 6);
  sprig(span - 2, beamY + 3, 1, 1, 6);
  sprig(-span + 9, beamY + 3, -1, -0.4, 4);
  sprig(span - 10, beamY + 3, 0, 0.5, 4);
  const [s1x, s1z] = trunkC(52), [s2x, s2z] = trunkC(34);
  sprig(Math.round(s1x) + 4, 52, Math.round(s1z) + 3, 1, 4);
  sprig(Math.round(s2x) - 4, 34, Math.round(s2z) + 2, -1, 3);
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] as [number, number, number], meta: { beamY: (beamY + 1.6 - 3) * vs, span: span * vs } };
}

/** the hanged man's halo: a corona of flickering light tongues (emissive, bloomed) */
export function coronaHalo(seed = 1) {
  const vs = 1 / 64;
  const m = new VoxelModel('tarot_halo');
  for (let a = 0; a < Math.PI * 2; a += 0.025) {
    const tongue = 2 + Math.max(0, noise.n2(Math.cos(a) * 2 + seed, Math.sin(a) * 2)) * 7 + (Math.sin(a * 12) > 0.6 ? 3 : 0);
    for (let r = 15; r < 17 + tongue; r += 0.5) {
      const t = (r - 15) / (2 + tongue);
      const c = t < 0.25 ? 0xfff6d0 : t < 0.6 ? 0xffd86a : 0xf6a63a;
      m.set(Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r), 0, c, VF.SOLID | VF.EMISSIVE | VF.GLOW);
    }
  }
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] as [number, number, number] };
}

/** branching lightning bolt, top at the pivot, striking down */
export function lightningBolt(seed = 2, lenM = 4.2) {
  const vs = 1 / 24;
  const m = new VoxelModel('tarot_bolt');
  const n = Math.round(lenM / vs);
  const fl = VF.SOLID | VF.EMISSIVE | VF.GLOW;
  const channel = (x0: number, y0: number, steps: number, drift: number, w: number, s: number) => {
    let x = x0, y = y0, z = 0;
    for (let i = 0; i < steps; i++) {
      const jag = (hash2(i + s * 31, seed) - 0.5) * 5 + drift;
      const nx = x + jag, ny = y - 3 - hash2(i, s + seed) * 2;
      const seg = Math.ceil(Math.hypot(nx - x, ny - y) * 2);
      for (let k = 0; k <= seg; k++) {
        const px = x + ((nx - x) * k) / seg, py = y + ((ny - y) * k) / seg;
        m.set(Math.round(px), Math.round(py), z, 0xffffff, fl);
        if (w > 0) {
          m.set(Math.round(px) + 1, Math.round(py), z, 0xd6ecff, fl);
          m.set(Math.round(px) - 1, Math.round(py), z, 0xd6ecff, fl);
          m.set(Math.round(px), Math.round(py), z + 1, 0xbfe0ff, fl);
        }
      }
      x = nx;
      y = ny;
      if (y < -n) break;
    }
    return [x, y];
  };
  channel(0, 0, 40, 0.4, 1, 0);
  channel(-2, -14, 9, -1.6, 0, 1);
  channel(3, -38, 7, 1.8, 0, 2);
  channel(1, -60, 6, -1.2, 0, 3);
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] as [number, number, number] };
}

/** a cluster of flame tongues (emissive): white-hot core, orange body, red tips. Pivot at the base. */
export function flames(seed = 1, hM = 0.9) {
  const vs = 1 / 40;
  const m = new VoxelModel('tarot_flames');
  const H = Math.round(hM / vs);
  const fl = VF.SOLID | VF.EMISSIVE;
  for (let k = 0; k < 7; k++) {
    const ox = (hash2(k, seed) - 0.5) * 14, oz = (hash2(k + 9, seed) - 0.5) * 8;
    const th = H * (0.45 + hash2(k + 3, seed) * 0.55);
    const r0 = 3 + hash2(k + 5, seed) * 2.5;
    for (let y = 0; y < th; y++) {
      const t = y / th;
      const r = r0 * (1 - t) ** 0.8 * (1 + Math.sin(t * 9 + k) * 0.15);
      const sway = Math.sin(t * 4 + k * 1.7) * 2.2 * t;
      for (let x = -Math.ceil(r); x <= r; x++)
        for (let z = -Math.ceil(r); z <= r; z++) {
          const d = Math.hypot(x, z) / Math.max(0.5, r);
          if (d > 1) continue;
          const heat = (1 - t) * (1 - d * 0.6);
          const c = heat > 0.62 ? 0xfff2c0 : heat > 0.4 ? 0xffc44a : heat > 0.2 ? 0xf2782a : 0xc23a1c;
          m.set(Math.round(ox + x + sway), y, Math.round(oz + z), c, fl);
        }
    }
  }
  return { model: m, voxelSize: vs, pivot: 'bottom' as const };
}

/** the black banner of Death with a pale scorpion, on a gnarled pole. Pivot at the pole foot; cloth flies toward +X. */
export function deathBanner() {
  const vs = 1 / 40;
  const m = new VoxelModel('tarot_banner');
  const poleH = 104;
  for (let y = 0; y <= poleH; y++) {
    const r = y > poleH - 6 ? 1.6 : 1.1;
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++) if (x * x + z * z <= r * r + 0.4) m.set(x, y, z, hash3(x, y, z) < 0.15 ? BARK.dark : (y + x) % 7 === 0 ? BARK.shade : BARK.base);
  }
  // brass finial: a lotus bud on a collar
  for (let y = 0; y < 7; y++) {
    const r = y < 2 ? 2.2 : 2.6 * Math.sin(((y - 1) / 6) * Math.PI) + 0.4;
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (x * x + z * z <= r * r) m.set(x, poleH + 1 + y, z, y === 1 ? GILT.shade : x < 0 ? GILT.hi : GILT.base, VF.SOLID | VF.METAL);
  }
  // the cloth: 34 × 26, hung from the top, rippling in the wind, swallow-tailed
  const CW = 34, CH = 26, top = poleH - 4;
  const emblem = (u: number, v: number) => {
    // pale scorpion in a ring, in cloth space (u 0..CW, v 0..CH from the top)
    const ex = u - CW * 0.5, ey = v - CH * 0.48;
    const ring = Math.abs(Math.hypot(ex, ey * 1.05) - 9.5) < 0.8;
    const body = (ex / 3) ** 2 + ((ey - 1) / 5.5) ** 2 < 1;
    const head = (ex / 3.6) ** 2 + ((ey + 4.5) / 2.6) ** 2 < 1;
    const ta = Math.atan2(ey - 4, ex);
    const tailR = Math.hypot(ex, ey - 4);
    const tail = ey > 4 && Math.abs(tailR - 4.6) < 1.1 && ta < Math.PI * 0.95;
    const claws = [-1, 1].some((s) => ((ex - s * 5.5) / 1.7) ** 2 + ((ey + 6.8) / 2.3) ** 2 < 1 || (Math.abs(ex - s * 4) < 0.8 && ey < -3 && ey > -6));
    const legs = [-1, 1].some((s) => [0, 1, 2].some((k) => Math.abs(ey - (-1 + k * 2.2) - (Math.abs(ex) - 3) * 0.45) < 0.55 && Math.abs(ex) > 2.6 && Math.abs(ex) < 6.8 && Math.sign(ex) === s));
    return ring || body || head || tail || claws || legs;
  };
  for (let v = 0; v < CH; v++)
    for (let u = 0; u < CW; u++) {
      const swallow = u > CW - 7 && Math.abs(v - CH / 2) < (u - (CW - 7)) * 0.9;
      if (swallow) continue;
      const wave = Math.sin(u * 0.28 - v * 0.05) * 2.4 * (u / CW) + Math.sin(u * 0.6 + v * 0.2) * 0.6;
      const sag = (u / CW) ** 2 * 3;
      const x = 2 + u, y = top - v - Math.round(sag), z = Math.round(wave);
      const shade = Math.cos(u * 0.28 - v * 0.05) > 0.35 ? 1 : Math.cos(u * 0.28 - v * 0.05) < -0.45 ? -1 : 0;
      const pale = emblem(u, v);
      const c = pale ? (shade > 0 ? 0xfaf0dc : shade < 0 ? 0xc8bca4 : 0xe8dcc4) : shade > 0 ? 0x3a3038 : shade < 0 ? 0x0e0a0e : 0x1e181e;
      m.set(x, y, z, c, VF.SOLID | VF.SOFTAO);
      if (v === 0) m.set(x, y + 1, z, GILT.shade); // hem / rod
    }
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] as [number, number, number], meta: { height: (poleH + 8) * vs } };
}

/** the Rider–Waite sun: a serene sculpted face with alternating straight and wavy rays (emissive). Pivot = centre, faces +Z. */
export function sunFace() {
  const vs = 1 / 24;
  const m = new VoxelModel('tarot_sun');
  const R0 = 30;
  const fl = VF.SOLID | VF.EMISSIVE;
  const S = R(0xffc63c, 0xe8961e, 0xfff0a0, 0xb86a12);
  // height of the face relief (dome + features)
  const hgt = (x: number, y: number) => {
    const d = Math.hypot(x, y) / R0;
    if (d > 1) return -1;
    let h = Math.sqrt(1 - d * d) * 6;
    const eye = (ex: number) => {
      const dx = (x - ex) / 5.5, dy = (y - 5) / 2.2;
      return dx * dx + dy * dy;
    };
    // brows
    for (const s of [-1, 1]) {
      const bx = (x - s * 9) / 7, by = y - 9.5 - (1 - bx * bx) * 1.6;
      if (Math.abs(bx) < 1 && Math.abs(by) < 1.1) h += 1.6;
      // closed eyelids: a soft arc
      const e = eye(s * 9);
      if (e < 1) h += 0.9 - e * 0.6;
      const lid = Math.abs((y - 4.2) - (1 - ((x - s * 9) / 5.5) ** 2) * 1.6);
      if (Math.abs(x - s * 9) < 5.5 && lid < 0.55) h -= 1.4;
      // cheeks
      const cd = ((x - s * 13) / 6) ** 2 + ((y + 4) / 5) ** 2;
      if (cd < 1) h += (1 - cd) * 1.6;
    }
    // nose ridge
    if (Math.abs(x) < 2.2 && y < 6 && y > -6) h += 2.2 * (1 - Math.abs(x) / 2.2) * (1 - Math.abs(y) / 8);
    if (y < -5 && y > -7.5 && Math.abs(x) < 3.5) h += 1.2;
    // lips: gentle smile
    const lipY = -12 + (x / 8) ** 2 * 2.2;
    if (Math.abs(x) < 8 && Math.abs(y - lipY) < 1.6) h += 1.4 - Math.abs(y - lipY) * 0.5;
    if (Math.abs(x) < 7.5 && Math.abs(y - lipY) < 0.45) h -= 1.8;
    return h;
  };
  for (let y = -R0; y <= R0; y++)
    for (let x = -R0; x <= R0; x++) {
      const h = hgt(x, y);
      if (h < 0) continue;
      const hl = hgt(x - 1, y), hu = hgt(x, y + 1), hr = hgt(x + 1, y), hd = hgt(x, y - 1);
      const slope = (h - hl) + (h - hu) - (h - hr) - (h - hd);
      const rim = Math.hypot(x, y) > R0 - 1.5;
      const c = rim ? S.shade : slope > 0.9 ? S.hi : slope < -2 ? S.dark : slope < -0.9 ? S.shade : S.base;
      const top = Math.round(h);
      for (let z = 0; z <= top; z++) m.set(x, y, z, z === top ? c : S.shade, fl);
    }
  // rays: alternating straight spikes and wavy flames
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2 + Math.PI / N;
    const wavy = i % 2 === 1;
    const len = wavy ? 26 : 34;
    for (let r = R0 - 1; r < R0 + len; r += 0.5) {
      const t = (r - R0) / len;
      const w = (wavy ? 3.4 : 4.6) * (1 - t) + 0.4;
      const a = a0 + (wavy ? Math.sin(t * 9) * 0.07 : 0);
      for (let k = -w; k <= w; k += 0.5) {
        const px = Math.cos(a) * r - Math.sin(a) * k, py = Math.sin(a) * r + Math.cos(a) * k;
        const edge = Math.abs(k) > w - 0.9;
        m.set(Math.round(px), Math.round(py), 1, edge ? S.shade : t < 0.3 ? S.hi : wavy ? 0xffa93a : S.base, fl);
      }
    }
  }
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] as [number, number, number], meta: { radius: (R0 + 34) * vs } };
}

/** the lemniscate of the Magician / Strength: a twisted glowing ribbon, thick at the loops, thin at the cross */
export function lemniscate(kind: 'venom' | 'gold' = 'venom') {
  const vs = 1 / 64;
  const m = new VoxelModel('tarot_inf_' + kind);
  const A = 18;
  const pal = kind === 'venom' ? [0xd8ff9a, 0x9dff3a, 0x5ac81e] : [0xfff0b0, 0xf2c443, 0xb8861e];
  const fl = VF.SOLID | VF.EMISSIVE;
  for (let s = 0; s < Math.PI * 2; s += 0.004) {
    const den = 1 + Math.sin(s) ** 2;
    const x = (A * Math.cos(s)) / den, y = (A * Math.sin(s) * Math.cos(s)) / den;
    const thick = 0.8 + Math.abs(Math.cos(s)) * 1.9;
    const tw = s * 5;
    for (let k = -thick; k <= thick; k += 0.5) {
      const ox = Math.cos(tw) * k * 0.3, oy = Math.sin(tw) * k, oz = Math.cos(tw) * k;
      const c = Math.sin(tw) > 0.4 ? pal[0] : Math.sin(tw) < -0.4 ? pal[2] : pal[1];
      m.set(Math.round(x + ox), Math.round(y + oy), Math.round(oz), c, fl);
    }
  }
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] as [number, number, number] };
}

/** a sunflower: curved stem, veined leaves, ray petals around a seed head in phyllotaxis. Pivot at the base. */
export function sunflower(seed = 1, hM = 1.25) {
  const vs = 1 / 48;
  const m = new VoxelModel('tarot_sunflower');
  const H = Math.round(hM / vs);
  const lean = (hash2(seed, 1) - 0.5) * 6;
  const stem = (y: number) => [Math.sin((y / H) * 1.6) * lean, Math.cos((y / H) * 1.3) * 1.5] as const;
  for (let y = 0; y < H; y++) {
    const [sx, sz] = stem(y);
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) if (x * x + z * z <= 1.3) m.set(Math.round(sx + x), y, Math.round(sz + z), x < 0 ? LEAF.hi : LEAF.shade);
  }
  // leaves
  for (let k = 0; k < 3; k++) {
    const ly = Math.round(H * (0.25 + k * 0.2));
    const dir = k % 2 ? 1 : -1;
    const [sx, sz] = stem(ly);
    for (let u = 0; u < 13; u++) {
      const w = Math.sin((u / 13) * Math.PI) * 3.6;
      for (let v = -w; v <= w; v += 0.5) {
        const x = sx + dir * (u + 1), y = ly + u * 0.35 - (u / 13) ** 2 * 4 + v * 0.25, z = sz + v;
        m.set(Math.round(x), Math.round(y), Math.round(z), Math.abs(v) < 0.5 ? LEAF.shade : v > 0 ? LEAF.hi : LEAF.base);
      }
    }
  }
  // head faces +Z, tilted toward the sun
  const [hx, hz] = stem(H);
  const cy = H + 2;
  const PET = [0xffd23a, 0xf4a91e, 0xfff09a];
  for (let i = 0; i < 21; i++) {
    const a = (i / 21) * Math.PI * 2 + hash2(i, seed) * 0.15;
    for (let r = 5; r < 12; r += 0.5) {
      const w = Math.sin(((r - 5) / 7) * Math.PI) * 1.7 + 0.3;
      for (let k = -w; k <= w; k += 0.5) {
        const px = Math.cos(a) * r - Math.sin(a) * k, py = Math.sin(a) * r + Math.cos(a) * k;
        const cup = ((r - 5) / 7) ** 2 * 2;
        m.set(Math.round(hx + px), Math.round(cy + py), Math.round(hz + 2 + cup), Math.abs(k) < 0.5 ? PET[1] : r > 9 ? PET[2] : PET[0]);
      }
    }
  }
  for (let i = 0; i < 140; i++) {
    const r = Math.sqrt(i) * 0.48, a = i * 2.39996;
    const px = Math.cos(a) * r, py = Math.sin(a) * r;
    m.set(Math.round(hx + px), Math.round(cy + py), Math.round(hz + 3 + (5.5 - r) * 0.25), i % 3 ? 0x5a3418 : 0x7a4a22);
    m.set(Math.round(hx + px), Math.round(cy + py), Math.round(hz + 2), 0x3a2010);
  }
  return { model: m, voxelSize: vs, pivot: 'bottom' as const };
}

const SANDR = R(0xe9c48c, 0xd3a76c, 0xf6dcac, 0xb0844e);

/** a dune bed for a diorama: rolling sand with wind ripples, pebbles and twigs. Pivot = centre of the patch at y=0. */
export function duneBed(wM: number, dM: number, seed = 1, tint = 0, crestM = 0, flatR = 0) {
  const vs = 1 / 16;
  const m = new VoxelModel('tarot_dunes');
  const W = Math.round(wM / vs), D = Math.round(dM / vs);
  const pal = tint ? { base: mixc(SANDR.base, tint, 0.25), shade: mixc(SANDR.shade, tint, 0.3), hi: mixc(SANDR.hi, tint, 0.2), dark: SANDR.dark } : SANDR;
  const hAt = (x: number, z: number) => {
    const u = x / W, v = z / D;
    const big = Math.sin(u * 5.1 + seed) * 2.2 + Math.sin(v * 3.3 + u * 2 + seed * 2) * 3 + noise.fbm2(x * 0.02 + seed, z * 0.02, 3) * 4;
    const back = Math.max(0, -v) * 10; // dunes rise behind
    // an optional dune crest along the back (and a little at the sides) hides the bed's edge
    const crest = crestM > 0 ? (crestM / vs) * (sstep(0.06, 0.48, -v) ** 1.6 + sstep(0.34, 0.5, Math.abs(u)) * 0.45) * (0.85 + noise.n2(x * 0.03 + seed, 7) * 0.15) : 0;
    // a level patch where the subjects stand (still props sit at y = 0)
    const flat = flatR > 0 ? sstep(flatR, flatR * 2.4, Math.hypot(x, z) * vs) : 1;
    return (big + back) * flat + crest;
  };
  for (let z = -D / 2; z < D / 2; z++)
    for (let x = -W / 2; x < W / 2; x++) {
      const h = hAt(x, z);
      const top = Math.round(h);
      const rip = Math.sin(x * 0.55 + z * 0.22 + noise.n2(x * 0.05, z * 0.05) * 3);
      const lo = Math.min(hAt(x + 1, z), hAt(x - 1, z), hAt(x, z + 1), hAt(x, z - 1));
      for (let y = Math.min(top, Math.round(lo) - 1); y <= top; y++) {
        let c = pal.base;
        if (y === top) {
          if (rip > 0.82) c = pal.hi;
          else if (rip < -0.6) c = pal.shade;
          const n = hash3(x, z, seed);
          if (n < 0.012) c = 0x9a8270; // pebble
          else if (n < 0.02) c = 0xc79a62;
        } else c = pal.shade;
        m.set(x, y, z, c);
      }
    }
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] as [number, number, number], heightAt: (xm: number, zm: number) => Math.round(hAt(xm / vs, zm / vs)) * vs + vs * 0.5 };
}

const STRATA = [0xc7835a, 0xd99a68, 0xb9704a, 0xe2ae7c, 0xa8603e, 0xd08c5e];

/** a distant layered sandstone mesa (strata bands, talus skirt). Pivot at the base centre. */
export function mesa(seed = 1, wM = 30, hM = 12, vs = 1 / 3) {
  const m = new VoxelModel('tarot_mesa');
  const W = Math.round(wM / vs), Hh = Math.round(hM / vs), D = Math.round(W * 0.45);
  const hAt = (x: number, z: number) => {
    const u = x / (W / 2), v = z / (D / 2);
    const r = Math.sqrt(u * u + v * v * 1.4) + noise.fbm2(x * 0.05 + seed, z * 0.05, 3) * 0.25;
    if (r > 1.35) return -1;
    if (r < 0.78) return Hh + noise.n2(x * 0.1, z * 0.1 + seed) * 1.2;
    const t = (r - 0.78) / 0.57;
    return Hh * (1 - t) ** 1.6 * 0.9 + noise.n2(x * 0.3, z * 0.3) * 1.5;
  };
  for (let z = -D / 2; z < D / 2; z++)
    for (let x = -W / 2; x < W / 2; x++) {
      const h = hAt(x, z);
      if (h < 0) continue;
      const top = Math.round(h);
      const lo = Math.max(0, Math.round(Math.min(hAt(x + 1, z), hAt(x - 1, z), hAt(x, z + 1), hAt(x, z - 1))) - 1);
      for (let y = Math.min(lo, top); y <= top; y++) {
        const bi = Math.floor((y + noise.n2(x * 0.08, seed) * 1.2) / 3.2) % STRATA.length;
        const band = STRATA[(bi + STRATA.length) % STRATA.length];
        m.set(x, y, z, y === top ? mixc(band, 0xf0c090, 0.25) : band);
      }
    }
  return { model: m, voxelSize: vs, pivot: 'bottom' as const };
}

/** a storm-cloud bank: lumpy cauliflower puffs, lit from above */
export function stormCloud(seed = 1, wM = 14) {
  const vs = 1 / 4;
  const m = new VoxelModel('tarot_cloud');
  const W = Math.round(wM / vs);
  for (let k = 0; k < 14; k++) {
    const cx = (hash2(k, seed) - 0.5) * W, cy = hash2(k + 4, seed) * 6, cz = (hash2(k + 8, seed) - 0.5) * 8;
    const r = 3 + hash2(k + 2, seed) * 5;
    for (let x = -r; x <= r; x++)
      for (let y = -r; y <= r; y++)
        for (let z = -r; z <= r; z++) {
          const lump = 1 + noise.n3((cx + x) * 0.25, (cy + y) * 0.25, (cz + z) * 0.25) * 0.3;
          if (x * x + y * y * 1.4 + z * z > r * r * lump) continue;
          const up = (y + r) / (2 * r);
          m.set(Math.round(cx + x), Math.round(cy + y), Math.round(cz + z), up > 0.7 ? 0x7c7a94 : up > 0.4 ? 0x55546e : 0x34334a);
        }
  }
  return { model: m, voxelSize: vs, pivot: 'center' as const };
}

const ADOBE = R(0xc98d5a, 0xa9703f, 0xe2aa76, 0x7a4c28);
const PLASTER = R(0xe8cfa2, 0xceb282, 0xf6e4bf, 0xa88c60);

/** a low mudbrick garden wall: coursed bricks, worn plaster, a rounded coping, chipped ends. Pivot at the base centre, faces +Z. */
export function mudWall(lenM = 5, hM = 1.1, seed = 1) {
  const vs = 1 / 16;
  const m = new VoxelModel('tarot_wall');
  const L = Math.round(lenM / vs), Hh = Math.round(hM / vs), D = 6;
  for (let x = -L / 2; x < L / 2; x++) {
    const u = (x + L / 2) / L;
    // the ends are broken down, the top line wanders
    const endDrop = Math.max(0, 1 - Math.min(u, 1 - u) * 9) * Hh * 0.55;
    const top = Math.round(Hh - endDrop + noise.n2(x * 0.08, seed) * 1.6);
    for (let y = 0; y <= top + 1; y++)
      for (let z = -D / 2; z < D / 2; z++) {
        const course = Math.floor(y / 3);
        const bx = Math.floor((x + (course % 2) * 3 + 64) / 6);
        const mortar = y % 3 === 0 || (x + (course % 2) * 3 + 64) % 6 === 0;
        const front = z === D / 2 - 1, back = z === -D / 2;
        // coping: a rounded plaster cap
        if (y >= top) {
          if (y === top + 1 && (front || back)) continue;
          m.set(x, y, z, hash3(x, y, z + seed) < 0.12 ? PLASTER.hi : PLASTER.base);
          continue;
        }
        // plaster skin survives in patches; elsewhere the bricks show
        const pl = noise.fbm2(x * 0.06 + seed, y * 0.09, 3) > 0.12 && (front || back);
        let c: number;
        if (pl) c = hash3(x, y, z) < 0.1 ? PLASTER.shade : y < 3 ? PLASTER.shade : PLASTER.base;
        else if (mortar) c = ADOBE.dark;
        else {
          const h = hash2(bx * 7 + seed, course * 13);
          c = h < 0.25 ? ADOBE.shade : h > 0.85 ? ADOBE.hi : ADOBE.base;
          if (hash3(x, y, z) < 0.05) c = ADOBE.shade;
        }
        // chipped bricks: knock a few out of the face
        if (front && !pl && hash2(bx * 3 + seed, course * 5) > 0.93 && !mortar) continue;
        m.set(x, y, z, c);
      }
  }
  return { model: m, voxelSize: vs, pivot: 'bottom' as const };
}

/** the Tower's falling flames (Rider–Waite "yods"): little flame droplets scattered through the air. Pivot = centre. */
export function embers(seed = 1, count = 22, wM = 3, hM = 4) {
  const vs = 1 / 40;
  const m = new VoxelModel('tarot_embers');
  const fl = VF.SOLID | VF.EMISSIVE | VF.GLOW;
  const W = wM / vs, H = hM / vs;
  for (let k = 0; k < count; k++) {
    const cx = (hash2(k, seed) - 0.5) * W, cy = (hash2(k + 31, seed) - 0.5) * H, cz = (hash2(k + 77, seed) - 0.5) * 12;
    const len = 4 + Math.round(hash2(k + 5, seed) * 4);
    const tilt = (hash2(k + 9, seed) - 0.5) * 0.8;
    // a teardrop falling head-first: hot round head below, flickering tail above
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const r = (1 - t) * 1.6 + 0.3;
      const y = cy + i, x = cx + tilt * i + Math.sin(i * 1.3 + k) * 0.5 * t;
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          if (dx * dx + dz * dz * 2 > r * r) continue;
          const c = t < 0.25 ? 0xfff4c8 : t < 0.55 ? 0xffc24a : 0xf26a22;
          m.set(Math.round(x + dx), Math.round(y), Math.round(cz + dz), c, fl);
        }
    }
  }
  return { model: m, voxelSize: vs, pivot: 'center' as const };
}

// ============================================================== skill (upgrade) cards
// 72 × 108 voxels at 1 cm: a sculpted frame per rarity tier — bronze (common /
// uncommon), silver (rare), gold (epic / legendary), divine white-gold (mythic).
// Front: art window, name plaque, recessed description panel, five level-gem
// sockets on a rail, tier ornaments. Back: lacquer lattice, ledger plaque and a
// big recessed parchment panel for the stat rows.

export type SkillRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
const SW = 72, SH = 108;
export const SKILL_CARD = {
  W: SW,
  H: SH,
  voxelSize: 0.01,
  win: { x0: 6, y0: 51, x1: 65, y1: 100 },
  name: { x0: 7, y0: 40, x1: 64, y1: 47 },
  desc: { x0: 8, y0: 11, x1: 63, y1: 36 },
  crest: { x0: 24, y0: 102, x1: 47, y1: 106 },
  gems: [20, 28, 36, 44, 52].map((x) => [x, 4.5] as [number, number]),
  back: { plaque: { x0: 13, y0: 94, x1: 58, y1: 101 }, panel: { x0: 8, y0: 11, x1: 63, y1: 87 } },
};

const BRONZE = R(0xbf8446, 0x8e5a2c, 0xe8b070, 0x4e2c12);
const SILVER = R(0xc6cad6, 0x8e94a6, 0xf4f6fc, 0x4a5066);
const WGOLD = R(0xf2e2b6, 0xd2b880, 0xfffaea, 0x8e7a50);
const WALNUT = R(0x5a3a22, 0x452a18, 0x6e4a2e, 0x2a180c);
const ENAMEL_BLUE = R(0x22346a, 0x182650, 0x34508e, 0x0e1630);
const ENAMEL_GREEN = R(0x23472c, 0x183420, 0x356a40, 0x0c1c10);
const ROYAL = R(0x3a2458, 0x2a1840, 0x543680, 0x160c24);
const MALACHITE = R(0x4aa868, 0x2e7a48, 0x7ad69a, 0x1a4a2a);
const LEATHER = R(0x8a5a36, 0x6a4226, 0xa8764a, 0x3a2414);

interface SkillTier {
  metal: Ramp4;
  body: Ramp4;
  inlay: Ramp4;
  inlay2: Ramp4;
  gem: Ramp4;
  lacquer: Ramp4;
  level: 0 | 1 | 2 | 3;
  glow: boolean;
}
const SKILL_TIERS: Record<SkillRarity, SkillTier> = {
  common: { metal: BRONZE, body: WALNUT, inlay: LEATHER, inlay2: BRONZE, gem: R(0xe0d2b0, 0xb8a888, 0xfff6e0, 0x7a6a50), lacquer: WALNUT, level: 0, glow: false },
  uncommon: { metal: BRONZE, body: ENAMEL_GREEN, inlay: MALACHITE, inlay2: TURQ, gem: R(0x8fc45a, 0x5e9a32, 0xc8f08a, 0x2e5418), lacquer: ENAMEL_GREEN, level: 0, glow: false },
  rare: { metal: SILVER, body: ENAMEL_BLUE, inlay: LAPIS, inlay2: TURQ, gem: R(0x4fb3c9, 0x2e7e98, 0x9ae6f6, 0x164a5a), lacquer: ENAMEL_BLUE, level: 1, glow: false },
  epic: { metal: GILT, body: OXBLOOD, inlay: CARN, inlay2: LAPIS, gem: R(0xe0603a, 0xa8401e, 0xff9a70, 0x5a1a0a), lacquer: OXBLOOD, level: 2, glow: false },
  legendary: { metal: GILT, body: ROYAL, inlay: TURQ, inlay2: CARN, gem: R(0xf5c84a, 0xc8962a, 0xfff0a0, 0x6a4a10), lacquer: ROYAL, level: 2, glow: false },
  mythic: { metal: WGOLD, body: IVORY, inlay: TURQ, inlay2: GILT, gem: R(0xfff3d6, 0xe8d4a8, 0xffffff, 0xa89070), lacquer: R(0xe8dcc0, 0xd0c09c, 0xfaf2de, 0x9a8a68), level: 3, glow: true },
};

function skillMolding(rf: Relief, d: number, x: number, y: number) {
  const along = d === Math.min(x, SW - 1 - x) ? y : x;
  if (d === 0) rf.put(x, y, 2, M.GILT);
  else if (d === 1 || d === 2) rf.put(x, y, 3, M.GILT);
  else if (d === 3) rf.put(x, y, along % 3 === 1 ? 1 : 2, along % 3 === 1 ? M.INK : M.GILT);
}

function stud(rf: Relief, cx: number, cy: number, r: number, h: number, m: number) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d <= 1) rf.up(x, y, Math.max(1, Math.round(h * Math.sqrt(1 - d * d) + 1)), m);
    }
}

/** a little filigree scroll: an Archimedean spiral of raised wire */
function filigree(rf: Relief, cx: number, cy: number, sx: number, sy: number) {
  for (let t = 0; t < Math.PI * 3.2; t += 0.12) {
    const r = 0.5 + t * 0.55;
    rf.up(cx + sx * Math.cos(t) * r, cy + sy * Math.sin(t) * r, 3, M.GILT);
  }
}

/** the 3D upgrade card for a rarity. Pivot = card centre, front faces +Z; 1 voxel = 1 cm. */
export function skillFrame(rarity: SkillRarity) {
  const T = SKILL_TIERS[rarity];
  const pal: (Ramp4 | null)[] = [null, T.metal, T.body, T.inlay, T.inlay2, T.gem, R(INK, INK, 0x3a2416, INK), T.lacquer, PARCH];
  const vm = new VoxelModel('skill_frame_' + rarity);
  const C = SKILL_CARD;
  for (let y = 0; y < SH; y++)
    for (let x = 0; x < SW; x++) {
      vm.set(x, y, -1, T.body.shade);
      vm.set(x, y, -2, T.lacquer.base);
      vm.set(x, y, 0, T.body.base);
    }
  const inR = (x: number, y: number, r: { x0: number; y0: number; x1: number; y1: number }) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  const ringD = (x: number, y: number, r: { x0: number; y0: number; x1: number; y1: number }) => Math.max(x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0, y < r.y0 ? r.y0 - y : y > r.y1 ? y - r.y1 : 0);
  // ---------------- front
  const f = new Relief(SW, SH);
  for (let y = 0; y < SH; y++)
    for (let x = 0; x < SW; x++) {
      if (inR(x, y, C.win)) continue;
      f.put(x, y, 1, M.IVORY);
      const d = Math.min(x, SW - 1 - x, y, SH - 1 - y);
      if (d <= 3) {
        skillMolding(f, d, x, y);
        continue;
      }
      // inlay band just inside the molding (silver and up)
      if (d === 4 && T.level >= 1) f.put(x, y, 1, (x + y) % 4 === 0 ? M.GILT : M.LAPIS);
      // the window lip
      const cd = ringD(x, y, C.win);
      if (cd === 1) f.put(x, y, 3, M.GILT);
      else if (cd === 2) f.put(x, y, 2, M.GILT);
      // name plaque: parchment, metal rim
      const nd = ringD(x, y, C.name);
      if (nd === 0) f.put(x, y, 2, M.PARCH);
      else if (nd === 1) f.put(x, y, 3, M.GILT);
      // description panel: recessed parchment in a thin metal frame
      const dd = ringD(x, y, C.desc);
      if (dd === 0) f.put(x, y, 1, M.PARCH);
      else if (dd === 1) f.put(x, y, 2, M.GILT);
      else if (dd === 2 && T.level >= 2) f.put(x, y, 1, M.TURQ);
    }
  // crest plaque for the category label, with rolled ends
  for (let y = C.crest.y0 - 1; y <= C.crest.y1 + 1; y++)
    for (let x = C.crest.x0 - 5; x <= C.crest.x1 + 5; x++) {
      const inside = inR(x, y, C.crest);
      const rim = ringD(x, y, C.crest) === 1;
      if (inside) f.put(x, y, 2, M.PARCH);
      else if (rim) f.put(x, y, 3, M.GILT);
      else {
        const u = x < C.crest.x0 ? (C.crest.x0 - 1 - x) / 4 : (x - C.crest.x1 - 1) / 4;
        if (u >= 0 && u <= 1) f.put(x, y, Math.round(2 + Math.sin(u * Math.PI) * 1.6), (y === C.crest.y0 - 1 || y === C.crest.y1 + 1) && u > 0.2 && u < 0.8 ? M.INK : M.PARCH);
      }
    }
  // gem rail with five sockets
  for (let y = 1; y <= 8; y++)
    for (let x = 14; x <= 57; x++) {
      let best = 99;
      for (const [gx, gy] of C.gems) best = Math.min(best, Math.hypot(x - gx, y - gy));
      if (best <= 1.9) f.put(x, y, 1, M.INK);
      else if (best <= 3.1) f.put(x, y, 3, M.GILT);
      else if (y >= 2 && y <= 7) f.put(x, y, 2, (x + y) % 2 ? M.LAPIS : M.GILT);
    }
  // corner ornaments by tier
  const corners: [number, number, number, number][] = [[5.5, 5.5, 1, 1], [SW - 6.5, 5.5, -1, 1], [5.5, SH - 6.5, 1, -1], [SW - 6.5, SH - 6.5, -1, -1]];
  for (const [cx, cy] of corners) stud(f, cx, cy, 2.2, 2.6, M.GILT);
  if (T.level >= 1) for (const [cx, cy, sx, sy] of [[9, 49.5, 1, -1], [SW - 10, 49.5, -1, -1], [9, 38.5, 1, 1], [SW - 10, 38.5, -1, 1]] as [number, number, number, number][]) filigree(f, cx, cy, sx * 0.9, sy * 0.6);
  if (T.level >= 2) {
    for (const [cx, cy] of [[C.win.x0 - 0.5, C.win.y0 - 0.5], [C.win.x1 + 0.5, C.win.y0 - 0.5], [C.win.x0 - 0.5, C.win.y1 + 0.5], [C.win.x1 + 0.5, C.win.y1 + 0.5]]) {
      for (let y = Math.floor(cy - 4); y <= cy + 4; y++)
        for (let x = Math.floor(cx - 4); x <= cx + 4; x++) {
          const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
          if (d > 3.4) continue;
          const a = Math.atan2(dy, dx);
          if (d < 1.4) f.put(x, y, 4, M.CARN);
          else if (Math.cos(a * 4) > 0.1 - d * 0.04) f.put(x, y, d < 2.6 ? 3 : 2, M.GILT);
          else f.put(x, y, 2, M.LAPIS);
        }
    }
  }
  if (T.level >= 3) {
    // a sunburst crown rising behind the crest
    const cx = 35.5, cy = 100;
    for (let i = 0; i < 13; i++) {
      const a = Math.PI * (0.12 + (i / 12) * 0.76);
      for (let r = 7; r < 11 + (i % 2 ? 0 : 3); r += 0.5) f.up(cx + Math.cos(a) * r * 1.6, cy + Math.sin(a) * r * 0.45, 2, i % 2 ? M.TURQ : M.GILT);
    }
  }
  f.emit(vm, 0, 1, false, VF.SOLID | VF.EMISSIVE, pal, T.glow ? [M.TURQ] : []);
  // ---------------- back
  const b = new Relief(SW, SH);
  for (let y = 0; y < SH; y++)
    for (let x = 0; x < SW; x++) {
      const d = Math.min(x, SW - 1 - x, y, SH - 1 - y);
      if (d <= 3) {
        skillMolding(b, d, x, y);
        continue;
      }
      const lattice = (x + y) % 8 === 0 || (((x - y) % 8) + 8) % 8 === 0;
      b.put(x, y, lattice ? 2 : 1, lattice ? M.GILT : M.OX);
      const pd = ringD(x, y, C.back.plaque);
      if (pd === 0) b.put(x, y, 2, M.PARCH);
      else if (pd === 1) b.put(x, y, 3, M.GILT);
      const qd = ringD(x, y, C.back.panel);
      if (qd === 0) b.put(x, y, 1, M.PARCH);
      else if (qd === 1) b.put(x, y, 2, M.GILT);
      else if (qd === 2) b.put(x, y, 1, M.INK);
    }
  for (const [cx, cy] of corners) stud(b, cx, cy, 2.2, 2.6, M.GILT);
  b.emit(vm, -2, -1, true, VF.SOLID | VF.EMISSIVE, pal);
  return { model: vm, voxelSize: C.voxelSize, pivot: [SW / 2, SH / 2, 0] as [number, number, number] };
}

/** a cut level gem (cabochon with facets) for the card's sockets; lit gems glow. Pivot = base centre. */
export function levelGem(color: number, lit: boolean) {
  const m = new VoxelModel('level_gem');
  const base = lit ? color : mixc(color, 0x1a120c, 0.72);
  const hi = lit ? mixc(color, 0xffffff, 0.55) : mixc(color, 0x3a2a20, 0.55);
  const sh = mixc(base, 0x000000, 0.35);
  const fl = lit ? VF.SOLID | VF.EMISSIVE : VF.SOLID | VF.METAL;
  for (let y = -3; y <= 3; y++)
    for (let x = -3; x <= 3; x++) {
      const d = Math.hypot(x, y) / 3.3;
      if (d > 1) continue;
      const h = Math.max(1, Math.round(Math.sqrt(1 - d * d) * 3));
      for (let z = 0; z < h; z++) {
        const top = z === h - 1;
        let c = base;
        if (top && x <= 0 && y >= 0) c = hi;
        else if (top && x > 0 && y < 0) c = sh;
        if (top && x === -1 && y === 1) c = 0xffffff;
        m.set(x, y, z, c, fl);
      }
    }
  return { model: m, voxelSize: 0.0055, pivot: [0, 0, 0] as [number, number, number] };
}

/**
 * a slash of light: a crescent ribbon spiralling from radius r0 at angle a0 to r1 at a1
 * (radians, in the XY plane, facing +Z). Thin at the tail, full near the head, a hot
 * white inner edge fading to gold, with a few speed streaks. Pivot = the arc centre.
 */
export function slashArc(r0M: number, r1M: number, a0: number, a1: number, widthM = 0.18) {
  const vs = 1 / 48;
  const m = new VoxelModel('tarot_slash');
  const glow = VF.SOLID | VF.EMISSIVE | VF.GLOW, emit = VF.SOLID | VF.EMISSIVE;
  const steps = Math.ceil((Math.abs(a1 - a0) * Math.max(r0M, r1M)) / vs) * 3;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + (a1 - a0) * t;
    const r = (r0M + (r1M - r0M) * t) / vs;
    // crescent profile: hair-thin at the cut, fullest at ~70 %, a sharp tip at the board
    const w = (widthM / vs) * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.8) + 0.6;
    for (let k = 0; k <= w; k += 0.5) {
      const e = k / Math.max(1, w); // 0 inner (hot) → 1 outer
      const rr = r - w * 0.35 + k;
      const c = e < 0.3 ? 0xffffff : e < 0.62 ? 0xfff2c0 : e < 0.85 ? 0xffd070 : 0xf2a040;
      const x = Math.round(Math.cos(a) * rr), y = Math.round(Math.sin(a) * rr);
      m.set(x, y, 0, c, e < 0.62 ? glow : emit);
      if (e < 0.5) m.set(x, y, 1, c, glow);
    }
  }
  // speed streaks trailing inside the arc
  for (let s = 0; s < 3; s++) {
    const off = (0.12 + s * 0.07) / vs;
    const t0 = 0.25 + s * 0.12, t1 = 0.75 + s * 0.06;
    for (let t = t0; t <= t1; t += 0.004) {
      const a = a0 + (a1 - a0) * t;
      const r = (r0M + (r1M - r0M) * t) / vs - off;
      m.set(Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r), 0, s === 0 ? 0xfff6d8 : 0xffe0a0, emit);
    }
  }
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] as [number, number, number] };
}

/**
 * a frozen spray of sand grains, bone shards and soft dust puffs bursting from the
 * origin along `dir` within a cone (`spread`), drooping a little under gravity.
 */
export function dustSpray(seed = 1, count = 60, dir: [number, number, number] = [1, 0.6, 0], spread = 0.5, lenM = 0.9) {
  const vs = 1 / 48;
  const m = new VoxelModel('tarot_spray');
  const dl = Math.hypot(...dir) || 1;
  const d = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
  // an orthonormal basis around the spray axis
  const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u[0] /= ul;
  u[1] /= ul;
  u[2] /= ul;
  const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const SAND = [0xf0d2a0, 0xe2b880, 0xcfa068], BONE = [0xf4ead4, 0xe2d6bc, 0xc8b898];
  for (let k = 0; k < count; k++) {
    const t = Math.pow(hash2(k, seed), 0.75);
    const r = (t * lenM) / vs;
    const th = hash2(k + 50, seed) * Math.PI * 2;
    const cr = spread * r * Math.sqrt(hash2(k + 90, seed));
    const p = [0, 1, 2].map((i) => d[i] * r + (u[i] * Math.cos(th) + v[i] * Math.sin(th)) * cr);
    p[1] -= t * t * (lenM / vs) * 0.22; // the heavier bits fall away
    const kind = hash2(k + 7, seed);
    if (kind < 0.3) {
      // a bone shard: a short splinter along the flight
      const len = 2 + Math.round(hash2(k + 3, seed) * 2);
      for (let i = 0; i < len; i++) m.set(Math.round(p[0] + d[0] * i), Math.round(p[1] + d[1] * i), Math.round(p[2] + d[2] * i), BONE[(k + i) % 3]);
    } else if (kind < 0.78 || t > 0.55) {
      // a sand grain or two
      m.set(Math.round(p[0]), Math.round(p[1]), Math.round(p[2]), SAND[k % 3]);
      if (kind > 0.6) m.set(Math.round(p[0] + 1), Math.round(p[1]), Math.round(p[2]), SAND[(k + 1) % 3]);
    } else {
      // a soft dust puff near the cut
      const pr = 1.4 + hash2(k + 11, seed) * 1.6;
      for (let x = -2; x <= 2; x++)
        for (let y = -2; y <= 2; y++)
          for (let z = -2; z <= 2; z++) {
            const q = (x * x + y * y + z * z) / (pr * pr);
            if (q > 1 || hash3(x + k, y, z + seed) < q * 0.5) continue;
            m.set(Math.round(p[0] + x), Math.round(p[1] + y), Math.round(p[2] + z), y > 0 ? 0xf6e2c0 : 0xe0c49a, VF.SOLID | VF.SOFTAO);
          }
    }
  }
  return { model: m, voxelSize: vs, pivot: [0, 0, 0] as [number, number, number] };
}
