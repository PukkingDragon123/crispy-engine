// Hand-designed + procedural pixel-art sprite atlas (particles, pickups, glyphs,
// damage digits, HUD icons). Drawn once into a canvas at boot.
import * as THREE from 'three';
import { RNG } from '../../engine/math/rand';

export interface SpriteFrame {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  w: number;
  h: number;
}

const ATLAS = 1024;
const CELL = 32;

/** ASCII pixel art: each char maps to a palette color, '.' = transparent */
type Art = { rows: string[]; pal: Record<string, string> };

const ART: Record<string, Art> = {
  coin: {
    rows: [
      '...hhhh...',
      '..hGGGGh..',
      '.hGgggGGh.',
      'hGgGGGgGGh',
      'hGgGddgGGh',
      'hGgGGGgGGh',
      'hGgGddgGGh',
      'hGgGGGgGGh',
      '.hGgggGGh.',
      '..hGGGGd..',
      '...dddd...',
    ],
    pal: { h: '#fff6b0', G: '#f5c84a', g: '#d49a24', d: '#8c5a12' },
  },
  chip: {
    rows: [
      '...wwwww...',
      '..wGGwGGw..',
      '.wGgggggGw.',
      'wGgg.k.ggGw',
      'wwgkkkkkgww',
      'wGgk.k.kgGw',
      'wwgkkkkkgww',
      'wGgg.k.ggGw',
      '.wGgggggGw.',
      '..wGGwGGw..',
      '...wwwww...',
    ],
    pal: { w: '#f3fff0', G: '#7ff03a', g: '#3fb52a', k: '#183a10' },
  },
  skull: {
    rows: ['.wwwww.', 'wwwwwww', 'w..w..w', 'w..w..w', 'wwwkwww', '.wwwww.', '.w.w.w.'],
    pal: { w: '#fff6e2', k: '#4a3a2a' },
  },
  ankh: {
    rows: ['..ggg..', '.g...g.', '.g...g.', '..g.g..', 'ggggggg', '...g...', '...g...', '...g...', '..ggg..'],
    pal: { g: '#ffd36b' },
  },
  eye: {
    rows: ['..ggggg..', '.g.....g.', 'g..kkk..g', 'g..kgk..g', '.g.kkk.g.', '..ggggg..', '....g.g..', '...g...g.'],
    pal: { g: '#9ff6ff', k: '#1c6f9e' },
  },
  scarab: {
    rows: ['.l.....l.', '..l.g.l..', '...ggg...', '.lgGGGgl.', 'l.gGgGg.l', '..gGgGg..', '.lgGgGgl.', 'l..ggg..l', '....g....'],
    pal: { g: '#35b9a8', G: '#6fe3cf', l: '#2c1a10' },
  },
  heart: {
    rows: ['.rr.rr.', 'rRRrRRr', 'rRRRRRr', 'rRRRRRr', '.rRRRr.', '..rRr..', '...r...'],
    pal: { r: '#7e1410', R: '#e0402c' },
  },
  shield: {
    rows: ['sssssss', 'sSSSSSs', 'sSSsSSs', 'sSsssSs', 'sSSsSSs', '.sSSSs.', '..sSs..', '...s...'],
    pal: { s: '#3a4a60', S: '#9fd2ff' },
  },
  bolt: {
    rows: ['...yy', '..yy.', '.yy..', 'yyyyy', '..yy.', '.yy..', 'yy...'],
    pal: { y: '#fff2a0' },
  },
  feather: {
    rows: ['....w', '...ww', '..wwk', '.wwk.', 'wwk..', 'wk...', 'k....'],
    pal: { w: '#e9e2d0', k: '#5a4a3a' },
  },
  fly0: { rows: ['w.w', '.k.', '.k.'], pal: { w: '#cfe6ff', k: '#1a1412' } },
  fly1: { rows: ['...', 'wkw', '.k.'], pal: { w: '#cfe6ff', k: '#1a1412' } },
  locust: { rows: ['ww...', '.wgg.', '.gGgg', '..g.g'], pal: { w: '#e8f0d0', g: '#6b8a2a', G: '#a8c040' } },
  bone: { rows: ['w...w', 'ww.ww', '.www.', 'ww.ww', 'w...w'], pal: { w: '#f1e2c2' } },
  bullet: { rows: ['.b.', 'bBb', 'bBb', 'cCc', 'cCc'], pal: { b: '#8c5a12', B: '#f5c84a', c: '#b5683a', C: '#e0a070' } },
  bandage: { rows: ['.wwwww.', 'wWWWWWw', 'wWrWrWw', 'wWWWWWw', '.wwwww.'], pal: { w: '#bfae88', W: '#f1e6cc', r: '#b0392a' } },
  dagger: { rows: ['......s', '.....sS', '....sS.', '...sS..', 'g.sS...', '.gg....', 'gkg....', 'k......'], pal: { s: '#7f878e', S: '#e9edf0', g: '#f5c84a', k: '#4d2c17' } },
  smoke: { rows: ['..kk..', '.kKKk.', 'kKwKKk', 'kKKKKk', '.kKKk.', '..ff..'], pal: { k: '#2e2c2b', K: '#4a4744', w: '#857b6f', f: '#ffb233' } },
  charm: { rows: ['..ggg..', '.g...g.', '..ggg..', '.gTTTg.', 'gTTtTTg', '.gTTTg.', '..ggg..'], pal: { g: '#d49a24', T: '#35b9a8', t: '#6fe3cf' } },
  dung: { rows: ['.bbb.', 'bBbBb', 'bbBbb', 'bBbbb', '.bbb.'], pal: { b: '#5a3a1e', B: '#8a5a32' } },
  scorp: {
    rows: ['....tt..', '.....t..', '.....t..', 'c..tt...', 'cc.bb...', '.cbbbb.c', 'l.bbbbcc', '.l.ll.l.'],
    pal: { t: '#9dff3a', b: '#c47a28', c: '#8a4a18', l: '#4a2a10' },
  },
  cylinder: {
    rows: ['..kkk..', '.k.k.k.', 'k.kkk.k', 'kkk.kkk', 'k.kkk.k', '.k.k.k.', '..kkk..'],
    pal: { k: '#b8c0c6' },
  },
  star4: { rows: ['...w...', '...w...', '..www..', 'wwwWwww', '..www..', '...w...', '...w...'], pal: { w: '#ffffff', W: '#ffffff' } },
  // moonlight (Mark): crescents with a soft pale rim, tinted by the particle colour
  moon0: { rows: ['..www..', '.wWWw..', 'wWWw...', 'wWW....', 'wWWw...', '.wWWw..', '..www..'], pal: { w: '#c8d8ee', W: '#ffffff' } },
  moon1: { rows: ['.ww..', 'wWw..', 'wW...', 'wWw..', '.ww..'], pal: { w: '#c8d8ee', W: '#ffffff' } },
  pinchA: {
    rows: [
      '......oo........',
      '.....oTTo.......',
      '......oTo.......',
      '..o....oTo......',
      '.oCo....oTo.....',
      'oCCo.oooooTo..o.',
      '.oCooAAAAAoo.oCo',
      '..oAAaAaAAAoooCCo',
      '.ooAAAAAAAAAoCo.',
      'o.lo.lo.lo.l.o..',
      '.l..l..l..l.....',
    ],
    pal: { o: '#2a1206', T: '#c47a28', C: '#d8892c', A: '#e09a3a', a: '#14100c', l: '#5a3010' },
  },
  pinchB: {
    rows: [
      '......oo........',
      '.....oTTo.......',
      '......oTo.......',
      '..o....oTo......',
      '.oCo....oTo.....',
      'oCCo.oooooTo..o.',
      '.oCooAAAAAoo.oCo',
      '..oAAaAaAAAoooCCo',
      '.ooAAAAAAAAAoCo.',
      '.lo.lo.lo.lo.o..',
      'l..l..l..l......',
    ],
    pal: { o: '#2a1206', T: '#c47a28', C: '#d8892c', A: '#e09a3a', a: '#14100c', l: '#5a3010' },
  },
  skullIcon: {
    rows: [
      '...oooooooo...',
      '..oWWWWWWWWo..',
      '.oWWWWWWWWWWo.',
      '.oWWWWWWWWWWo.',
      'oWWooWWWWooWWo',
      'oWoGGoWWoGGoWo',
      'oWoGGoWWoGGoWo',
      'oWWooWooWooWWo',
      '.oWWWWooWWWWo.',
      '..oWWWWWWWWo..',
      '..oWoWoWoWWo..',
      '...oWoWoWoo...',
      '....ooooo.....',
    ],
    pal: { o: '#2a1a0e', W: '#efe0bf', G: '#8fe03a' },
  },
  coinBig: {
    rows: [
      '...oooooo...',
      '..oHHHHHHo..',
      '.oHLLLLLLMo.',
      'oHLLMMMMLLMo',
      'oHLMLLLLMLMo',
      'oHLMLHHLMLMo',
      'oHLMLHHLMLMo',
      'oHLMLLLLMLMo',
      'oHLLMMMMLLMo',
      '.oLLLLLLLMo.',
      '..oMMMMMMo..',
      '...oooooo...',
    ],
    pal: { o: '#3a2408', H: '#fff0a6', L: '#e2b24a', M: '#b88426' },
  },
  // ---- 2D eyes (tintable glow eyes: W = core, w = halo) -------------------
  e_round: { rows: ['.www.', 'wWWWw', 'wWWWw', 'wWWWw', '.www.'], pal: { W: '#ffffff', w: '#9a9a9a' } },
  e_half: { rows: ['.....', '.....', 'wWWWw', 'wWWWw', '.www.'], pal: { W: '#ffffff', w: '#9a9a9a' } },
  e_slit: { rows: ['.....', '.....', 'wWWWw', '.....', '.....'], pal: { W: '#ffffff', w: '#9a9a9a' } },
  e_closed: { rows: ['.....', '.....', '.....', 'wwwww', '.....'], pal: { w: '#bdbdbd' } },
  e_angry: { rows: ['W....', 'wW...', 'wWWw.', 'wWWWw', '.www.'], pal: { W: '#ffffff', w: '#9a9a9a' } },
  e_sad: { rows: ['....W', '...Ww', '.wWWw', 'wWWWw', '.www.'], pal: { W: '#ffffff', w: '#9a9a9a' } },
  e_happy: { rows: ['.....', '.www.', 'wW.Ww', 'W...W', '.....'], pal: { W: '#ffffff', w: '#9a9a9a' } },
  e_wide: { rows: ['.www.', 'w...w', 'w.W.w', 'w...w', '.www.'], pal: { W: '#ffffff', w: '#d0d0d0' } },
  e_x: { rows: ['W...W', '.W.W.', '..W..', '.W.W.', 'W...W'], pal: { W: '#ffffff' } },
  e_spiral: { rows: ['wwww.', '...w.', '.W.w.', '.WWw.', '.....'], pal: { W: '#ffffff', w: '#c8c8c8' } },
  e_heart: { rows: ['ww.ww', 'WWWWW', 'WWWWW', '.WWW.', '..W..'], pal: { W: '#ffffff', w: '#d0d0d0' } },
  // organic eyes (sclera + pupil), pupil drawn separately for gaze
  o_open: { rows: ['.oooo.', 'oSSSSo', 'oSSSSo', 'oSSSSo', '.oooo.'], pal: { o: '#2a1810', S: '#f4ecd8' } },
  o_half: { rows: ['.oooo.', 'oooooo', 'oSSSSo', 'oSSSSo', '.oooo.'], pal: { o: '#2a1810', S: '#f4ecd8' } },
  o_closed: { rows: ['......', '......', 'oooooo', '.oooo.', '......'], pal: { o: '#2a1810' } },
  o_angry: { rows: ['oo....', 'oSoo..', 'oSSSoo', 'oSSSSo', '.oooo.'], pal: { o: '#2a1810', S: '#f4ecd8' } },
  o_pupil: { rows: ['kk', 'kk'], pal: { k: '#140c08' } },
  o_glint: { rows: ['w'], pal: { w: '#ffffff' } },
  // ---- 2D emotes over heads ----------------------------------------------------
  fx_anger: { rows: ['.r.r.', 'rr.rr', '.....', 'rr.rr', '.r.r.'], pal: { r: '#e0402c' } },
  fx_sweat: { rows: ['..b.', '.bB.', 'bBBb', 'bBwb', '.bb.'], pal: { b: '#4f9fd9', B: '#9fd8ff', w: '#ffffff' } },
  fx_q: { rows: ['.www.', 'w...w', '...w.', '..w..', '.....', '..w..'], pal: { w: '#fff3d6' } },
  fx_heart: { rows: ['.r.r.', 'rRrRr', 'rRRRr', '.rRr.', '..r..'], pal: { r: '#9a1a10', R: '#e0402c' } },
  fx_zzz: { rows: ['wwww', '..w.', '.w..', 'wwww'], pal: { w: '#e8f0ff' } },
  fx_note: { rows: ['..ww', '..ww', '..w.', 'ww..', 'ww..'], pal: { w: '#ffd36b' } },
  fx_star: { rows: ['..y..', '.yYy.', 'yYYYy', '.yYy.', '..y..'], pal: { y: '#e2b24a', Y: '#fff0a6' } },
  fx_drop: { rows: ['.g.', 'gGg', 'gGg', '.g.'], pal: { g: '#4fa52a', G: '#c8ff7a' } },
  sheriff: {
    rows: ['....g....', '...gGg...', 'gggGGGggg', '.gGGkGGg.', '..gGGGg..', '.gGg.gGg.', 'gg.....gg'],
    pal: { g: '#9c6812', G: '#f5c84a', k: '#fff0a0' },
  },
};

// 3x5 pixel digits for damage numbers
const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
  '-': ['000', '000', '111', '000', '000'],
  '!': ['010', '010', '010', '000', '010'],
  '%': ['101', '001', '010', '100', '101'],
  x: ['000', '101', '010', '101', '000'],
  k: ['100', '101', '110', '101', '101'],
};

export class PixelAtlas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  frames = new Map<string, SpriteFrame>();
  private slot = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = ATLAS;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.build();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  get(name: string) {
    return this.frames.get(name) ?? this.frames.get('dot2')!;
  }

  private alloc(name: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, x: number, y: number) => void) {
    const per = ATLAS / CELL;
    const cw = Math.ceil(w / CELL),
      ch = Math.ceil(h / CELL);
    // simple row packing: find slot where cw fits in row
    let col = this.slot % per;
    let row = Math.floor(this.slot / per);
    if (col + cw > per) {
      row++;
      col = 0;
    }
    const x = col * CELL,
      y = row * CELL;
    this.slot = row * per + col + cw;
    this.ctx.save();
    draw(this.ctx, x, y);
    this.ctx.restore();
    // half-texel inset avoids bleeding
    this.frames.set(name, { u0: (x + 0.5) / ATLAS, v0: 1 - (y + h - 0.5) / ATLAS, u1: (x + w - 0.5) / ATLAS, v1: 1 - (y + 0.5) / ATLAS, w, h });
  }

  private art(name: string, a: Art, scale = 1) {
    const h = a.rows.length,
      w = Math.max(...a.rows.map((r) => r.length));
    this.alloc(name, w * scale, h * scale, (c, x, y) => {
      for (let j = 0; j < h; j++)
        for (let i = 0; i < a.rows[j].length; i++) {
          const ch = a.rows[j][i];
          if (ch === '.' || !a.pal[ch]) continue;
          c.fillStyle = a.pal[ch];
          c.fillRect(x + i * scale, y + j * scale, scale, scale);
        }
    });
  }

  private blob(name: string, size: number, seed: number, cols: string[], rough = 0.35, outline?: string) {
    const rng = new RNG(seed);
    this.alloc(name, size, size, (c, x, y) => {
      const r = size / 2 - 1;
      const cx = size / 2 - 0.5,
        cy = size / 2 - 0.5;
      const bumps = Array.from({ length: 7 }, () => rng.range(-rough, rough));
      for (let j = 0; j < size; j++)
        for (let i = 0; i < size; i++) {
          const dx = i - cx,
            dy = j - cy;
          const a = Math.atan2(dy, dx);
          const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 7) % 7;
          const rr = r * (1 + bumps[k] * 0.5);
          const d = Math.hypot(dx, dy) / rr;
          if (d > 1) continue;
          // light from top-left: shade bands
          const lit = (-dx * 0.6 - dy * 0.8) / rr;
          const t = Math.min(cols.length - 1, Math.max(0, Math.floor((1 - (lit * 0.5 + 0.5)) * cols.length + (d > 0.85 ? 1 : 0))));
          c.fillStyle = outline && d > 0.88 ? outline : cols[t];
          c.fillRect(x + i, y + j, 1, 1);
        }
    });
  }

  private build() {
    const c = this.ctx;
    c.clearRect(0, 0, ATLAS, ATLAS);
    // soft dots (white, tintable)
    for (const s of [2, 3, 4, 6, 8]) {
      this.alloc('dot' + s, s, s, (cx, x, y) => {
        for (let j = 0; j < s; j++)
          for (let i = 0; i < s; i++) {
            const d = Math.hypot(i - (s - 1) / 2, j - (s - 1) / 2) / (s / 2);
            if (d > 1.05) continue;
            cx.fillStyle = d > 0.7 && s > 3 ? '#d8d8d8' : '#ffffff';
            cx.fillRect(x + i, y + j, 1, 1);
          }
      });
    }
    // glow dot (radial falloff, for additive)
    for (const s of [8, 16, 32]) {
      this.alloc('glow' + s, s, s, (cx, x, y) => {
        for (let j = 0; j < s; j++)
          for (let i = 0; i < s; i++) {
            const d = Math.hypot(i - (s - 1) / 2, j - (s - 1) / 2) / (s / 2);
            if (d > 1) continue;
            const a = Math.pow(1 - d, 2);
            const q = Math.round(a * 4) / 4; // posterized glow = pixel feel
            cx.fillStyle = `rgba(255,255,255,${q})`;
            cx.fillRect(x + i, y + j, 1, 1);
          }
      });
    }
    // sand grain clusters (white-ish, tinted by particle)
    for (let v = 0; v < 6; v++) {
      const rng = new RNG(100 + v);
      this.alloc('grain' + v, 4, 4, (cx, x, y) => {
        for (let k = 0; k < 6; k++) {
          const i = rng.int(0, 3),
            j = rng.int(0, 3);
          cx.fillStyle = rng.chance(0.4) ? '#e6e6e6' : '#ffffff';
          cx.fillRect(x + i, y + j, 1, 1);
        }
      });
    }
    // dust / smoke puffs (greyscale, tinted)
    for (let v = 0; v < 4; v++) this.blob('puff' + v, 16, 200 + v, ['#ffffff', '#ececec', '#d4d4d4', '#b8b8b8'], 0.4);
    for (let v = 0; v < 3; v++) this.blob('cloud' + v, 32, 300 + v, ['#ffffff', '#f0f0f0', '#dcdcdc', '#c4c4c4', '#a8a8a8'], 0.5);
    // poison bubble
    this.alloc('bubble', 8, 8, (cx, x, y) => {
      const px = (i: number, j: number, col: string) => {
        cx.fillStyle = col;
        cx.fillRect(x + i, y + j, 1, 1);
      };
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) {
          const d = Math.hypot(i - 3.5, j - 3.5);
          if (d > 3.6) continue;
          px(i, j, d > 2.7 ? '#3fb52a' : '#7ff03a');
        }
      px(2, 2, '#f0ffd0');
      px(3, 2, '#c8ff5a');
      px(2, 3, '#c8ff5a');
    });
    // sparks / stars
    this.art('star4', ART.star4);
    this.alloc('spark', 3, 3, (cx, x, y) => {
      cx.fillStyle = '#fff';
      cx.fillRect(x + 1, y, 1, 3);
      cx.fillRect(x, y + 1, 3, 1);
    });
    this.alloc('streak', 2, 16, (cx, x, y) => {
      for (let j = 0; j < 16; j++) {
        cx.fillStyle = `rgba(255,255,255,${Math.round((1 - j / 16) * 4) / 4})`;
        cx.fillRect(x, y + j, 2, 1);
      }
    });
    // muzzle flash (3 frames)
    for (let f = 0; f < 3; f++) {
      const rng = new RNG(500 + f);
      this.alloc('flash' + f, 32, 32, (cx, x, y) => {
        const rays = 7 + f;
        for (let j = 0; j < 32; j++)
          for (let i = 0; i < 32; i++) {
            const dx = i - 15.5,
              dy = j - 15.5;
            const d = Math.hypot(dx, dy);
            const a = Math.atan2(dy, dx);
            const ray = Math.pow(Math.max(0, Math.cos(a * rays + f)), 6) * (12 + rng.range(-2, 2));
            const R = 5 + ray;
            if (d > R) continue;
            const t = d / R;
            cx.fillStyle = t < 0.35 ? '#ffffff' : t < 0.6 ? '#fff2a0' : t < 0.85 ? '#ffb233' : '#f0621f';
            cx.fillRect(x + i, y + j, 1, 1);
          }
      });
    }
    // shockwave ring
    this.alloc('ring', 32, 32, (cx, x, y) => {
      for (let j = 0; j < 32; j++)
        for (let i = 0; i < 32; i++) {
          const d = Math.hypot(i - 15.5, j - 15.5);
          if (d > 15.5 || d < 12.5) continue;
          cx.fillStyle = d > 14.5 ? 'rgba(255,255,255,0.6)' : '#ffffff';
          cx.fillRect(x + i, y + j, 1, 1);
        }
    });
    // flames (4 frames)
    for (let f = 0; f < 4; f++) {
      const rng = new RNG(700 + f);
      this.alloc('flame' + f, 12, 16, (cx, x, y) => {
        for (let j = 0; j < 16; j++)
          for (let i = 0; i < 12; i++) {
            const t = j / 15;
            const w = (1 - Math.pow(1 - t, 2)) * 5 * (0.8 + 0.2 * Math.sin(f * 1.7 + j * 0.9));
            const off = Math.sin(j * 0.6 + f * 1.3) * (1 - t) * 1.5;
            const d = Math.abs(i - 5.5 - off) / Math.max(0.5, w);
            if (d > 1 || rng.chance(0.04)) continue;
            cx.fillStyle = d < 0.35 && t > 0.4 ? '#fff2a0' : d < 0.7 ? '#ffb233' : '#f0621f';
            cx.fillRect(x + i, y + j, 1, 1);
          }
      });
    }
    // blood droplets / splat
    for (let v = 0; v < 3; v++) this.blob('blood' + v, 6, 900 + v, ['#d0302a', '#b3201a', '#7e1410'], 0.5);
    this.blob('splat', 16, 950, ['#b3201a', '#9a1a14', '#7e1410'], 0.8);
    this.blob('ichor', 6, 960, ['#c8ff5a', '#7ff03a', '#3fb52a'], 0.5);
    this.blob('venomSplat', 16, 961, ['#9dff3a', '#7ff03a', '#3fb52a', '#1f6e1e'], 0.8);
    this.blob('pebble', 5, 970, ['#d2a77a', '#b98a60', '#7a5137'], 0.3);
    this.blob('woodchip', 5, 971, ['#c49563', '#a67447', '#613d22'], 0.6);
    // crafted art
    for (const [k, a] of Object.entries(ART)) this.art(k, a, 1);
    for (const k of ['coin', 'chip', 'skull', 'ankh', 'eye', 'scarab', 'heart', 'shield', 'bolt', 'bullet', 'bandage', 'dagger', 'smoke', 'charm', 'scorp', 'sheriff', 'cylinder', 'dung'])
      this.art(k + '_x2', ART[k], 2);
    // coin spin frames (squash horizontally)
    for (let f = 0; f < 4; f++) {
      const sx = [1, 0.66, 0.25, 0.66][f];
      const a = ART.coin;
      this.alloc('coinspin' + f, 10, 11, (cx, x, y) => {
        for (let j = 0; j < a.rows.length; j++)
          for (let i = 0; i < 10; i++) {
            const src = Math.round(4.5 + (i - 4.5) / Math.max(0.2, sx));
            if (src < 0 || src >= a.rows[j].length) continue;
            const ch = a.rows[j][src];
            if (ch === '.') continue;
            cx.fillStyle = f === 2 ? (j < 5 ? '#fff6b0' : '#d49a24') : a.pal[ch];
            cx.fillRect(x + i, y + j, 1, 1);
          }
      });
    }
    // digits
    for (const [ch, rows] of Object.entries(DIGITS)) {
      this.alloc('dg_' + ch, 5, 7, (cx, x, y) => {
        // 1px dark outline around glyph for readability
        for (let j = 0; j < 5; j++)
          for (let i = 0; i < 3; i++)
            if (rows[j][i] === '1') {
              cx.fillStyle = '#1a0f08';
              cx.fillRect(x + i, y + j, 3, 3);
            }
        for (let j = 0; j < 5; j++)
          for (let i = 0; i < 3; i++)
            if (rows[j][i] === '1') {
              cx.fillStyle = '#ffffff';
              cx.fillRect(x + 1 + i, y + 1 + j, 1, 1);
            }
      });
    }
    // hieroglyph glyphs for divine fx (white, tinted)
    const glyphs = ['ankh', 'eye', 'scarab', 'feather'];
    glyphs.forEach((g, i) => {
      const a = ART[g];
      const white: Art = { rows: a.rows, pal: Object.fromEntries(Object.keys(a.pal).map((k) => [k, '#ffffff'])) };
      this.art('glyph' + i, white, 2);
    });
    // speed line
    this.alloc('speedline', 1, 24, (cx, x, y) => {
      for (let j = 0; j < 24; j++) {
        cx.fillStyle = `rgba(255,255,255,${Math.round(Math.sin((j / 23) * Math.PI) * 3) / 3})`;
        cx.fillRect(x, y + j, 1, 1);
      }
    });
    // tumbleweed twig bits / leaves
    this.alloc('twig', 5, 5, (cx, x, y) => {
      cx.fillStyle = '#b89a52';
      cx.fillRect(x, y + 2, 5, 1);
      cx.fillRect(x + 1, y + 1, 1, 1);
      cx.fillRect(x + 3, y + 3, 1, 1);
    });
    this.alloc('linen', 6, 3, (cx, x, y) => {
      cx.fillStyle = '#f1e6cc';
      cx.fillRect(x, y, 6, 2);
      cx.fillStyle = '#bfae88';
      cx.fillRect(x + 1, y + 2, 4, 1);
    });
    // pixel smear arcs (fast motion), drawn white for tinting
    for (let f = 0; f < 3; f++) {
      this.alloc('smear' + f, 32, 32, (cx, x, y) => {
        for (let j = 0; j < 32; j++)
          for (let i = 0; i < 32; i++) {
            const dx = i - 16, dy = j - 22;
            const d = Math.hypot(dx, dy);
            const a = Math.atan2(dy, dx);
            const inArc = a < -0.3 - f * 0.25 && a > -Math.PI + 0.3;
            const thick = 2.5 + Math.sin(-a) * 3;
            if (!inArc || Math.abs(d - 13) > thick) continue;
            cx.fillStyle = Math.abs(d - 13) < thick * 0.45 ? '#ffffff' : 'rgba(255,255,255,0.55)';
            cx.fillRect(x + i, y + j, 1, 1);
          }
      });
    }
    // western onomatopoeia (Alagard, outlined) — mixes 2D comic beats into the 3D action
    const words: [string, string, string][] = [['w_bang', 'BANG!', '#ffd36b'], ['w_boom', 'BOOM!', '#ff8a3a'], ['w_pow', 'POW!', '#fff3d6'], ['w_crack', 'CRACK!', '#f1e2c2'], ['w_splat', 'SPLAT!', '#8fe03a'], ['w_yeehaw', 'YEEHAW!', '#ffd36b'], ['w_headshot', 'HEADSHOT', '#ff5a3a'], ['w_kaboom', 'KA-BOOM!', '#ff6a2a']];
    for (const [k, t, col] of words) {
      const c2 = this.ctx;
      c2.font = "16px 'Alagard'";
      const w = Math.min(96, Math.ceil(c2.measureText(t).width) + 6);
      this.alloc(k, w, 20, (cx, x, y) => {
        cx.font = "16px 'Alagard'";
        cx.textBaseline = 'top';
        cx.fillStyle = '#1a0e06';
        for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [2, 2], [1, 2]]) cx.fillText(t, x + 3 + ox, y + 1 + oy);
        cx.fillStyle = col;
        cx.fillText(t, x + 3, y + 1);
      });
    }
    this.alloc('crystal', 5, 8, (cx, x, y) => {
      const rows = ['..w..', '.wPw.', '.PpP.', 'wPpPp', 'PpPpP', '.pPp.', '.pPp.', '..p..'];
      const pal: Record<string, string> = { w: '#ffd0fa', P: '#c63fdc', p: '#6d1c8f' };
      rows.forEach((r, j) => [...r].forEach((ch, i) => {
        if (ch === '.') return;
        cx.fillStyle = pal[ch];
        cx.fillRect(x + i, y + j, 1, 1);
      }));
    });
  }
}

let _atlas: PixelAtlas | null = null;
export function atlas() {
  if (!_atlas) _atlas = new PixelAtlas();
  return _atlas;
}
