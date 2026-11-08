// The ability bar: tarot cards fanned at the bottom right of the HUD — the
// three active skills (I Magician, XVI Tower, XIX Sun) and the big XIII Death
// ultimate — as flat pixel art on the HUD grid. Each card is the sculpted
// gilded relief frame (props/tarot.ts) photographed face and back by the sprite
// bank (HudSprites), with the art window carrying the CardStudio photograph of
// the card's diorama, shrunk to the window's pixels and posterised onto the HUD
// palette. Faces are photographed progressively (time-sliced; the cards are dealt
// face-down and turn over as their art is ready). Cooldown is sand pouring back
// into the art from the bottom (the sleeping part greyed, a glowing sand line);
// a ready card shines; the mouse lifts the card under it; on use a card pops,
// turns over to show its sculpted back (a 2D squash turn) and throws
// skill-themed 2D pixel-art particles.
// A hunt starts with the three skill cards SEALED: they lie face down, dimmed,
// with no key cap, until the skill is learned from a rank-up card; then the
// card leaps, turns over in a full flourish and bursts with its own particles.
// The rank-up's skill-unlock cinematic (RankUpCine.SkillUnlock) flies its world
// card into the slot (TarotBar.current.slot) and lands with landFx.
import * as THREE from 'three';
import type { Hud } from './Hud';
import type { RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { CardStudio } from './CardStudio';
import { Kit, TAROT_BAR, TarotDef, TarotFx } from './TarotCards';
import { CARD, tarotFrame } from '../models/props/tarot';
import { isSkillLearned } from '../player/Skills';
import { SpriteBank, Shot, Sprite, blitC, blitSquash, blitShear, shadowOffset, variant, wrap, palNearest } from './HudSprites';
import { UI, keycap, text, px } from './PixelUI';
import { isTouchDevice } from './TouchControls';

/** photo size of the 66×88-voxel art window */
export const TAROT_ART: [number, number] = [168, 224];

// ------------------------------------------------------------------ 2D pixel particles (above the cards)

interface Px {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ay: number;
  drag: number;
  t: number;
  life: number;
  size: number;
  c0: THREE.Color;
  c1: THREE.Color;
  a: number;
  flick: number;
  /** orbit: angular speed around (ox, oy) */
  spin?: number;
  ox?: number;
  oy?: number;
}

const PX_VS = /* glsl */ `
attribute float size;
attribute vec4 tint;
varying vec4 vC;
uniform float uPR;
void main(){ vC = tint; gl_PointSize = size * uPR; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PX_FS = /* glsl */ `varying vec4 vC; void main(){ if (vC.a < 0.02) discard; gl_FragColor = vC; }`;

/** square HUD-pixel sparks snapped to the HUD grid; one additive and one normal layer */
class PixelSparks {
  points: THREE.Points;
  private list: Px[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private siz: Float32Array;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  constructor(private max: number, additive: boolean, order: number) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.siz = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('tint', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uPR: { value: 1 } },
      vertexShader: PX_VS,
      fragmentShader: PX_FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = order;
  }
  get count() {
    return this.list.length;
  }
  add(p: Partial<Px> & { x: number; y: number }, c0: number, c1 = c0) {
    if (this.list.length >= this.max) return;
    this.list.push({ vx: 0, vy: 0, ay: 0, drag: 0, t: 0, life: 0.6, size: 1, a: 1, flick: 0, ...p, c0: new THREE.Color(c0), c1: new THREE.Color(c1) });
  }
  update(dt: number, s: number, pr: number) {
    this.mat.uniforms.uPR.value = pr;
    let n = 0;
    const tmp = new THREE.Color();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      if (p.t >= p.life) {
        this.list[i] = this.list[this.list.length - 1];
        this.list.pop();
        continue;
      }
      if (p.spin) {
        // swirl around a centre while drifting out (swarms)
        const dx = p.x - p.ox!, dy = p.y - p.oy!;
        const a = p.spin * dt;
        p.x = p.ox! + dx * Math.cos(a) - dy * Math.sin(a);
        p.y = p.oy! + dx * Math.sin(a) + dy * Math.cos(a);
      }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vy = p.vy * dr + p.ay * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (const p of this.list) {
      const k = p.t / p.life;
      const size = Math.max(1, Math.round(p.size * (k > 0.7 && p.size > 1 ? 0.5 + (1 - k) : 1))) * s;
      // snap to the HUD pixel grid
      const half = (Math.round(size / s) % 2) * 0.5;
      const x = (Math.floor(p.x / s) + half) * s, y = (Math.floor(p.y / s) + half) * s;
      this.pos[n * 3] = x;
      this.pos[n * 3 + 1] = -y;
      this.pos[n * 3 + 2] = 1500;
      tmp.copy(p.c0).lerp(p.c1, k);
      let a = p.a * (k < 0.08 ? k / 0.08 : 1 - Math.max(0, (k - 0.55) / 0.45));
      if (p.flick) a *= 1 - p.flick * (Math.sin(p.t * 47 + p.x) > 0.3 ? 0.75 : 0);
      this.col[n * 4] = tmp.r;
      this.col[n * 4 + 1] = tmp.g;
      this.col[n * 4 + 2] = tmp.b;
      this.col[n * 4 + 3] = a;
      this.siz[n] = size;
      n++;
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'tint', 'size']) (this.geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------ typography (the only thing drawn in 2D)

const PPV = 12; // canvas pixels per voxel for the plaque text

/** engraved Alagard on a transparent canvas sized to a plaque (voxels), as a texture */
export function plaqueText(text: string, wVox: number, hVox: number, capFrac: number, color = '#2a170c') {
  const cv = document.createElement('canvas');
  cv.width = Math.round(wVox * PPV);
  cv.height = Math.round(hVox * PPV);
  const c = cv.getContext('2d')!;
  let size = 64;
  c.font = `${size}px Alagard`;
  let m = c.measureText(text);
  const cap = (m.actualBoundingBoxAscent || size * 0.7) / size;
  size = Math.floor((cv.height * capFrac) / cap);
  c.font = `${size}px Alagard`;
  m = c.measureText(text);
  const sx = Math.min(1, (cv.width * 0.94) / m.width);
  c.save();
  c.translate(cv.width / 2, cv.height / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  c.scale(sx, 1);
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  // engraved: a pale lip under the stroke, then the ink
  c.fillStyle = 'rgba(255,246,222,0.55)';
  c.fillText(text, 0, PPV * 0.12);
  c.fillStyle = color;
  c.fillText(text, 0, 0);
  c.restore();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

// ------------------------------------------------------------------ cards

interface CardObj {
  def: TarotDef;
  /** the CardStudio photograph of the card's diorama (null while it is being taken) */
  art: HTMLCanvasElement | null;
  /** the face composed at the current size: frame photograph + art; the art also slept (cooldown) */
  face: { key: string; cv: HTMLCanvasElement; art: HTMLCanvasElement; dim: HTMLCanvasElement; win: [number, number, number, number] } | null;
  /** the face as drawn this frame (cooldown sand, sheen) */
  live: HTMLCanvasElement;
  pop: number;
  flip: number; // 1 = face down (dealing), eases to 0 when the art lands
  lastCd: number;
  lastCharges: number;
  ready: number;
  wasReady: boolean;
  flash: number;
  seed: number;
  hover: number;
  // screen placement (css px, y down) for effects
  sx: number;
  sy: number;
  sk: number;
  glint: number;
  trickle: number;
  /** sealed: the skill isn't learned yet (face down) */
  locked: boolean;
  /** 1 -> 0 while the just-learned card turns face up */
  unlock: number;
}

const FW = CARD.W, FH = CARD.H;
const WIN = CARD.win;
/** art window in frame-local voxel units (pivot at the card centre, y up) */
const ART_RECT = { x: (WIN.x0 + WIN.x1 + 1) / 2 - FW / 2, y: (WIN.y0 + WIN.y1 + 1) / 2 - FH / 2, w: WIN.x1 - WIN.x0 + 1, h: WIN.y1 - WIN.y0 + 1 };

/** the sculpted frame, built once and only ever photographed */
let frameRig: THREE.Group | null = null;
function frame() {
  if (frameRig) return frameRig;
  const fr = tarotFrame();
  const g = new THREE.Group();
  // a tenth scale: the IconFactory's lens only reaches 200 units
  const V = 0.1;
  g.add(new THREE.Mesh(buildVoxelGeometry(fr.model, { voxelSize: V, pivot: fr.pivot }), SpriteBank.get().material()));
  // card-stock core inside the slab so a crack in the relief never shows through
  const core = new THREE.Mesh(new THREE.PlaneGeometry((FW - 0.6) * V, (FH - 0.6) * V), new THREE.MeshStandardMaterial({ color: 0xb8a078, roughness: 0.9, side: THREE.DoubleSide }));
  core.position.z = -0.5 * V;
  g.add(core);
  frameRig = wrap(g);
  return frameRig;
}

/** area-average a photograph down to w×h, then posterise it onto the HUD palette */
function shrinkArt(src: HTMLCanvasElement, w: number, h: number) {
  const sc = src.getContext('2d', { willReadFrequently: true })!;
  const sd = sc.getImageData(0, 0, src.width, src.height).data;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(w, h);
  const d = img.data;
  const fx = src.width / w, fy = src.height / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx)), y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const k = (yy * src.width + xx) * 4;
          r += sd[k];
          g += sd[k + 1];
          b += sd[k + 2];
          n++;
        }
      // a light ordered dither keeps the painted skies from banding
      const t = ([0, 2, 3, 1][(y & 1) * 2 + (x & 1)] - 1.5) * 6;
      const p = palNearest(Math.max(0, Math.min(255, r / n + t)), Math.max(0, Math.min(255, g / n + t)), Math.max(0, Math.min(255, b / n + t)));
      const k = (y * w + x) * 4;
      d[k] = p[0];
      d[k + 1] = p[1];
      d[k + 2] = p[2];
      d[k + 3] = 255;
    }
  c.putImageData(img, 0, 0);
  return cv;
}

export class TarotBar {
  /** the live bar (the unlock cinematic flies cards into it) */
  static current: TarotBar | null = null;
  private cards: CardObj[] = [];
  private vw = 1;
  private vh = 1;
  /** the fan's size factor (1 on desktop, down to ~0.5 on a landscape phone) */
  cardK = 1;
  private job: Generator<void, void, void> | null = null;
  private started = false;
  private add = new PixelSparks(700, true, 61);
  private norm = new PixelSparks(500, false, 60);
  private bank = SpriteBank.get();
  private t = 0;
  private lastUlt = 0;
  private pr = 1;
  private touch = isTouchDevice();
  private mouse = { x: -1, y: -1 };
  private onMouse = (e: MouseEvent) => {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
  };
  /** diagnostics: total ms spent building, the longest single step, frames used */
  buildMs = 0;
  maxStepMs = 0;
  slices = 0;
  done = false;

  constructor(private scene: THREE.Scene, private hud: Hud) {
    scene.add(this.norm.points, this.add.points);
    TarotBar.current = this;
    this.cards = TAROT_BAR.map((def, i) => ({
      def, art: null, face: null, live: document.createElement('canvas'), pop: 0, flip: 1, lastCd: 0, lastCharges: -1, ready: 0, wasReady: true, flash: 0, seed: i * 1.7, hover: 0,
      sx: 0, sy: 0, sk: 1, glint: Math.random(), trickle: 0, locked: !isSkillLearned(def.key), unlock: 0,
    }));
    window.addEventListener('mousemove', this.onMouse);
  }

  /** where a card sits on screen, normalised (x, y from the top-left; h its height), null if the bar isn't dealt yet */
  slot(key: string) {
    const c = this.cards.find((k) => k.def.key === key);
    if (!c || c.sk <= 0 || c.sx <= 0) return null;
    return { x: c.sx / this.vw, y: c.sy / this.vh, h: (FH * c.sk) / this.vh };
  }

  /** a flown-in card lands in its slot: a ring of pixel light and a shower of sparks in the god's colour */
  landFx(key: string, color: number) {
    const c = this.cards.find((k) => k.def.key === key);
    if (!c) return;
    const w = FW * c.sk, h = FH * c.sk;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2, v = 150 + Math.random() * 90;
      this.add.add({ x: c.sx + Math.cos(a) * w * 0.3, y: c.sy + Math.sin(a) * h * 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8, drag: 4, life: 0.5 + Math.random() * 0.3, size: i % 6 ? 1 : 2 }, 0xffffff, color);
    }
    for (let i = 0; i < 30; i++) this.add.add({ x: c.sx + (Math.random() - 0.5) * w, y: c.sy - h * 0.5, vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 80, ay: 60, drag: 1, life: 0.8 + Math.random() * 0.6, size: 1, flick: 0.4 }, color, 0xffd36b);
  }

  /** start / continue the time-sliced art photography; call once per frame from the HUD render */
  build(renderer: THREE.WebGLRenderer, hero: RigSpec | null, heroKey: string, gun: RigSpec | null, budgetMs = 7) {
    this.pr = renderer.getPixelRatio();
    if (!this.started) {
      if (!hero) return;
      this.started = true;
      this.job = this.makeJob(renderer, hero, heroKey, gun);
    }
    if (!this.job) return;
    const t0 = performance.now();
    this.slices++;
    try {
      do {
        const ts = performance.now();
        const r = this.job.next();
        this.maxStepMs = Math.max(this.maxStepMs, performance.now() - ts);
        if (r.done) {
          this.job = null;
          this.done = true;
          break;
        }
      } while (performance.now() - t0 < budgetMs);
    } catch (e) {
      console.warn('[tarot] build failed', e);
      this.job = null;
      this.done = true;
    }
    this.buildMs += performance.now() - t0;
  }

  private *makeJob(renderer: THREE.WebGLRenderer, hero: RigSpec, heroKey: string, gun: RigSpec | null): Generator<void, void, void> {
    yield;
    const studio = new CardStudio(renderer);
    const kit = new Kit(hero, heroKey, gun);
    try {
      for (const c of this.cards) {
        try {
          const it = c.def.scene(kit);
          let r = it.next();
          while (!r.done) {
            yield;
            r = it.next();
          }
          yield;
          c.art = studio.shoot(r.value, TAROT_ART[0], TAROT_ART[1], 2);
          c.face = null;
        } catch (e) {
          console.warn('[tarot] card art failed', c.def.title, e);
        }
        kit.flush();
        yield;
      }
    } finally {
      kit.dispose();
      studio.dispose();
    }
  }

  // ---------------------------------------------------------------- pictures
  private frameSprite(back: boolean, big: boolean, ck: number) {
    const w = Math.round(46 * ck * (big ? 1.22 : 1)) + 2, h = Math.round(74.75 * ck * (big ? 1.22 : 1)) + 2;
    return this.bank.get(`tarot:${back ? 'back' : 'face'}:${big ? 'z' : 'n'}`, `${w}x${h}`, back ? 63 : 59, (): Shot => ({ obj: frame(), w, h, yaw: back ? Math.PI : 0, pitch: 0.04, fit: true }));
  }

  /** the face at this size: the frame photograph with the shrunk diorama in its window */
  private faceOf(c: CardObj, fr: Sprite) {
    if (!c.art) return null;
    const key = `${fr.w}x${fr.h}`;
    if (c.face?.key === key) return c.face;
    const wx = Math.round(fr.bx + (WIN.x0 / FW) * fr.bw), wx1 = Math.round(fr.bx + ((WIN.x1 + 1) / FW) * fr.bw);
    const wy = Math.round(fr.by + ((FH - 1 - WIN.y1) / FH) * fr.bh), wy1 = Math.round(fr.by + ((FH - WIN.y0) / FH) * fr.bh);
    const ww = Math.max(2, wx1 - wx), wh = Math.max(2, wy1 - wy);
    const art = shrinkArt(c.art, ww, wh);
    const dim = variant(variant(art, 'grey'), 'dim');
    const cv = document.createElement('canvas');
    cv.width = fr.w;
    cv.height = fr.h;
    const g = cv.getContext('2d')!;
    g.drawImage(fr.cv, 0, 0);
    g.drawImage(art, wx, wy);
    c.face = { key, cv, art, dim, win: [wx, wy, ww, wh] };
    return c.face;
  }

  /** this frame's face: the sleeping part of the art greyed, the glowing sand line, the ready sheen */
  private liveFace(c: CardObj, f: NonNullable<CardObj['face']>, frac: number) {
    const cv = c.live;
    if (cv.width !== f.cv.width || cv.height !== f.cv.height) {
      cv.width = f.cv.width;
      cv.height = f.cv.height;
    }
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(f.cv, 0, 0);
    const [wx, wy, ww, wh] = f.win;
    if (frac > 0.001) {
      // cooldown: sand pours back in from the bottom; the unrecovered part sleeps
      const line = Math.round(wh * frac);
      if (line > 0) g.drawImage(f.dim, 0, 0, ww, line, wx, wy, ww, line);
      if (frac < 0.999) {
        for (let x = 0; x < ww; x++) {
          const wave = Math.round(Math.sin(x * 0.7 + this.t * 3) * 0.6);
          const grain = Math.sin(x * 12.9898 + Math.floor(this.t * 12) * 78.233) * 43758.5453;
          const lit = grain - Math.floor(grain) > 0.45;
          px(g, wx + x, wy + line - 1 + wave, 1, 1, lit ? '#ffe6a8' : UI.brass.l);
          if (lit) px(g, wx + x, wy + line + wave, 1, 1, UI.brass.m);
        }
      }
    } else if (c.ready > 0) {
      // ready: a slow sheen of light sweeps across the varnish
      const sw = (this.t * 0.18 + c.seed * 0.21) % 1;
      const band = sw * 2.4 - 0.5;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(255,236,200,${0.22 * c.ready})`;
      for (let y = 0; y < wh; y++) {
        const cx = ((band - (y / wh) * 0.5) / 0.8) * ww;
        g.fillRect(wx + Math.max(0, Math.round(cx - 3)), wy + y, Math.max(0, Math.min(ww, Math.round(cx + 3)) - Math.max(0, Math.round(cx - 3))), 1);
      }
      g.restore();
    }
    return cv;
  }

  fx(dt: number, W: number, H: number, visible: boolean) {
    const s = this.hud.scale;
    this.vw = Math.max(1, W);
    this.vh = Math.max(1, H);
    this.add.points.visible = this.norm.points.visible = visible;
    this.add.update(dt, s, this.pr);
    this.norm.update(dt, s, this.pr);
  }

  paint(c: CanvasRenderingContext2D, dt: number) {
    this.t += dt;
    const hud = this.hud;
    const s = hud.scale;
    const st = hud.last;
    const W = window.innerWidth / s, H = window.innerHeight / s;
    hud.cardAnchors.length = 0;
    if (!st || !this.cards.length) return;
    // on small screens (a landscape phone) the whole fan shrinks so it stays out of the way;
    // the cardAnchors below follow, so the touch layer's hit-tests stay in sync
    const ck = Math.max(0.48, Math.min(1, W / 620, H / 340));
    this.cardK = ck;
    const cw = 46 * ck, ch = 74.75 * ck;
    const n = this.cards.length;
    const locked = !!document.pointerLockElement;
    const draws: (() => void)[] = [];
    this.cards.forEach((card, i) => {
      const ult = card.def.key === 'Z';
      const sk = st.skills.find((k) => k.key === card.def.key);
      const frac = ult ? 1 - Math.min(1, st.ult) : sk && sk.max > 0 ? Math.min(1, sk.cd / sk.max) : 0;
      const cdNow = ult ? (st.ult >= 1 ? 0 : 99) : sk?.cd ?? 0;
      // used? cooldown jumped up, a charge was spent, or the ultimate fired
      const charges = sk?.charges ?? -1;
      const used = ult ? this.lastUlt >= 1 && st.ult < 0.5 : cdNow > card.lastCd + 0.4 || (charges >= 0 && card.lastCharges >= 0 && charges < card.lastCharges);
      card.lastCd = cdNow;
      card.lastCharges = charges;
      // sealed until learned; learning it turns the card over with a flourish
      const sealed = !isSkillLearned(card.def.key);
      const big = ult ? 1.22 : 1;
      const front = this.frameSprite(false, ult, ck);
      const back = this.frameSprite(true, ult, ck);
      const face = front ? this.faceOf(card, front) : null;
      if (card.locked && !sealed) {
        card.unlock = 1;
        card.pop = 1;
        card.flash = 1;
        this.useFx(card);
        this.readyFx(card);
      }
      card.locked = sealed;
      card.unlock = Math.max(0, card.unlock - dt * 0.8);
      const readyNow = frac <= 0.001 && !sealed;
      if (used && !sealed) {
        card.pop = 1;
        card.flash = 1;
      }
      if (readyNow && !card.wasReady && !used) {
        card.flash = Math.max(card.flash, 0.6);
        this.readyFx(card);
      }
      card.wasReady = readyNow;
      card.pop = Math.max(0, card.pop - dt * 1.15);
      card.flash = Math.max(0, card.flash - dt * 3.2);
      card.ready = readyNow ? Math.min(1, card.ready + dt * 3) : 0;
      if (card.locked) card.flip = Math.min(1, card.flip + dt * 3);
      else if (face) card.flip = Math.max(0, card.flip - dt * (card.unlock > 0 ? 1.15 : 2.2));
      // fan along the bottom-right, the ultimate largest at the end
      const slot = n - 1 - i;
      const x = W - (16 + 22) * ck - slot * cw * 0.98 - (ult ? 0 : cw * 0.2);
      const fan = (slot - (n - 1) / 2) * 0.045;
      const bob = Math.sin(this.t * 1.4 + i * 1.3) * 2.2 * ck;
      // the mouse lifts the card under it (when the pointer is free)
      const mx = this.mouse.x / s, my = this.mouse.y / s;
      const over = !locked && Math.abs(mx - x) < (cw * big) / 2 && Math.abs(my - (H - 14 * ck - (ch * big) / 2)) < (ch * big) / 2;
      card.hover += ((over ? 1 : 0) - card.hover) * Math.min(1, dt * 12);
      // pop: a quick lift and swell, one full turn showing the sculpted back, settle with a bounce
      const k = card.pop;
      const u = 1 - k;
      const lift = k > 0 ? Math.sin(Math.min(1, u * 1.25) * Math.PI) : 0;
      const swell = k > 0 ? Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.55 + Math.max(0, Math.sin(u * Math.PI * 3)) * 0.04 * k : 0;
      const spin = k > 0 ? smooth(Math.min(1, Math.max(0, (u - 0.12) / 0.62))) * Math.PI * 2 : 0;
      const y = H - 14 * ck - (ch * big) / 2 - bob - (lift * 46 + Math.sin(card.unlock * Math.PI) * 30 - (card.locked ? 6 : 0) + card.hover * 7) * ck;
      const sc = ((ch * big * s) / FH) * (1 + swell);
      card.sx = x * s;
      card.sy = y * s;
      card.sk = sc;
      if (used) this.useFx(card);
      if (!card.locked) this.ambientFx(card, dt, frac, readyNow, ult);
      if (!card.locked) hud.cardAnchors.push({ key: card.def.key, x, y, h: ch * big, cd: ult ? 0 : cdNow });
      // the side up: dealt face down until the photo lands, a full turn on use
      const turn = smooth(card.flip) * Math.PI + spin;
      const cs = Math.cos(turn);
      const showFace = cs >= 0 && !!face && !card.locked;
      draws.push(() => {
        let pic: HTMLCanvasElement | null = null;
        if (showFace && face) pic = this.liveFace(card, face, frac);
        else if (back) pic = card.locked ? variant(back, 'dim') : back.cv;
        if (!pic) return;
        const sx = Math.max(0.08, Math.abs(cs)) * (1 + swell);
        const tilt = fan + Math.sin(this.t * 0.9 + i) * 0.02;
        // real card stock: a shadow that falls further the higher the card rises, and its edge (thickness)
        const solid = showFace && face ? face.cv : back ? back.cv : pic;
        const rise = 3 + lift * 14 + card.hover * 6 + Math.sin(card.unlock * Math.PI) * 9;
        const [ox, oy] = shadowOffset(rise);
        const sh = variant(solid, 'shadow'), stock = variant(solid, 'stock');
        if (Math.abs(cs) > 0.995 && swell < 0.01) {
          // at rest: the fan is a shear about the card's centre (crisp rows)
          const left = x - pic.width / 2, top = y - pic.height / 2;
          const shear = (r: number) => (r - pic!.height / 2) * -Math.tan(tilt);
          blitShear(c, sh, left + ox + 1, top + oy + 1, shear, 0.14);
          blitShear(c, sh, left + ox, top + oy, shear, 0.34);
          blitShear(c, stock, left + 1, top + 1, shear);
          blitShear(c, pic, left, top, shear);
          if (!showFace && card.locked) return;
          if (showFace && !readyNow) blitShear(c, variant(pic === card.live ? face!.cv : pic, 'dim'), left, top, shear, 0.22);
        } else {
          blitSquash(c, sh, x + ox + 1, y + oy + 1, sx, 0.14, 1 + swell);
          blitSquash(c, sh, x + ox, y + oy, sx, 0.34, 1 + swell);
          // mid-turn the card's edge shows as its thickness
          blitSquash(c, stock, x + (cs >= 0 ? 1 : -1), y + 1, sx, 1, 1 + swell);
          blitSquash(c, pic, x, y, sx, 1, 1 + swell);
        }
        if (card.flash > 0.02) blitSquash(c, variant(showFace && face ? face.cv : pic, 'flash'), x, y, sx, card.flash * 0.75, 1 + swell);
      });
    });
    // the later card sits in front
    for (const d of draws) d();
    // key caps under the cards, cooldown figures over the art
    for (const a of hud.cardAnchors) {
      if (!this.touch) {
        const kc = keycap(a.key);
        const kx = Math.round(a.x - kc.width / 2), ky = Math.round(a.y + a.h / 2 + 2);
        c.globalAlpha = 0.3;
        c.drawImage(variant(kc, 'shadow'), kx + 1, ky + 2);
        c.globalAlpha = 1;
        c.drawImage(kc, kx, ky);
      }
      if (a.cd > 0.05 && a.cd < 99) text(c, a.cd < 1 ? a.cd.toFixed(1) : String(Math.ceil(a.cd)), a.x, a.y - 8, UI.text, 16, 'center');
    }
    this.lastUlt = st.ult;
    void blitC;
  }

  // ---------------------------------------------------------------- particles

  /** a random point on the gilt border (screen px) */
  private onFrame(c: CardObj) {
    const w = FW * c.sk, h = FH * c.sk;
    const side = Math.random() * 4;
    const t = Math.random();
    const inset = 2 * c.sk;
    if (side < 1) return [c.sx - w / 2 + inset + t * (w - inset * 2), c.sy - h / 2 + inset];
    if (side < 2) return [c.sx - w / 2 + inset + t * (w - inset * 2), c.sy + h / 2 - inset];
    if (side < 3) return [c.sx - w / 2 + inset, c.sy - h / 2 + t * h];
    return [c.sx + w / 2 - inset, c.sy - h / 2 + t * h];
  }

  private ambientFx(c: CardObj, dt: number, frac: number, ready: boolean, ult: boolean) {
    if (ready) {
      // glints run around the gilt
      c.glint += dt * (ult ? 5 : 1.6);
      while (c.glint > 1) {
        c.glint -= 1;
        const [x, y] = this.onFrame(c);
        this.add.add({ x, y, vy: -6, life: 0.35 + Math.random() * 0.3, size: Math.random() < 0.25 ? 2 : 1, flick: 0.5 }, 0xfff6d0, 0xffc040);
      }
      if (ult && Math.random() < dt * 9) {
        const x = c.sx + (Math.random() - 0.5) * FW * c.sk * 0.8, y = c.sy - FH * c.sk * 0.45;
        this.add.add({ x, y, vx: (Math.random() - 0.5) * 10, vy: -22 - Math.random() * 26, ay: -8, drag: 0.6, life: 0.9 + Math.random() * 0.7, size: 1, flick: 0.35 }, 0xd8ff9a, 0x3a8a1a);
      }
    } else if (frac > 0.001 && frac < 0.999) {
      // grains of sand trickle off the recovering line
      c.trickle += dt * 7;
      while (c.trickle > 1) {
        c.trickle -= 1;
        const lineY = c.sy - (ART_RECT.y - ART_RECT.h / 2 + ART_RECT.h * (1 - frac)) * c.sk;
        const x = c.sx + (ART_RECT.x + (Math.random() - 0.5) * ART_RECT.w * 0.95) * c.sk;
        this.norm.add({ x, y: lineY, vy: 6, ay: 90, life: 0.25 + Math.random() * 0.25, size: 1 }, Math.random() < 0.5 ? 0xf6dcac : 0xe0b070, 0xb0844e);
      }
    }
  }

  private readyFx(c: CardObj) {
    for (let i = 0; i < 22; i++) {
      const [x, y] = this.onFrame(c);
      const a = Math.atan2(y - c.sy, x - c.sx);
      this.add.add({ x, y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40 - 10, drag: 3, life: 0.45 + Math.random() * 0.3, size: i % 4 ? 1 : 2, flick: 0.3 }, 0xfffbe8, c.def.key === 'Z' ? 0x9dff3a : 0xffc040);
    }
  }
  private useFx(c: CardObj) {
    const cx = c.sx, cy = c.sy, k = c.sk;
    const w = FW * k, h = FH * k;
    const R = (a: number, b: number) => a + Math.random() * (b - a);
    const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];
    const A = this.add, N = this.norm;
    // every card: a ring of gilt sparks thrown off the frame
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + R(-0.1, 0.1), v = R(110, 190);
      A.add({ x: cx + Math.cos(a) * w * 0.35, y: cy + Math.sin(a) * h * 0.35, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 4.5, life: R(0.35, 0.6), size: i % 5 ? 1 : 2 }, 0xfff6d0, 0xd89a30);
    }
    const fx: TarotFx = c.def.fx;
    if (fx === 'rope') {
      // the halo bursts; hemp fibres drift down
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2, v = R(70, 120);
        A.add({ x: cx, y: cy + h * 0.25, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 2.6, life: R(0.6, 0.9), size: 1, flick: 0.25 }, pick([0xfff3c0, 0xffd36b]), 0xf6a63a);
      }
      for (let i = 0; i < 18; i++) N.add({ x: cx + R(-w, w) * 0.45, y: cy - h * 0.5, vx: R(-20, 20), vy: R(-30, 10), ay: 70, drag: 1.5, life: R(0.9, 1.4), size: 1 }, pick([0xc9a66b, 0xe2c68e, 0x8a6a3a]), 0x6e5432);
      for (let i = 0; i < 8; i++) A.add({ x: cx + R(-w, w) * 0.3, y: cy + h * 0.3, vy: R(-60, -30), drag: 0.8, life: R(1, 1.5), size: 1, flick: 0.4 }, 0xfff3d6, 0xffd36b);
    } else if (fx === 'venom') {
      // venom sprayed up and raining down; the lemniscate traced in light
      for (let i = 0; i < 36; i++) {
        const a = -Math.PI / 2 + R(-0.9, 0.9), v = R(120, 260);
        (i % 2 ? A : N).add({ x: cx + R(-w, w) * 0.2, y: cy - h * 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 520, drag: 1.2, life: R(0.7, 1.1), size: i % 6 ? 1 : 2 }, pick([0xd8ff9a, 0x9dff3a]), 0x3a8a1a);
      }
      for (let i = 0; i < 40; i++) {
        const t = (i / 40) * Math.PI * 2, den = 1 + Math.sin(t) ** 2;
        const lx = (Math.cos(t) / den) * w * 0.55, ly = ((Math.sin(t) * Math.cos(t)) / den) * w * 0.55;
        A.add({ x: cx + lx, y: cy - h * 0.62 + ly, vx: lx * 1.4, vy: ly * 1.4 - 12, drag: 2, life: R(0.6, 0.9), size: 1, flick: 0.2 }, 0xfffbe8, 0x9dff3a);
      }
    } else if (fx === 'storm') {
      // forked lightning down onto the card, embers up, the swarm boils out
      for (let f = 0; f < 3; f++) {
        let x = cx + R(-w, w) * 0.4, y = cy - h * 1.05;
        for (let j = 0; j < 16; j++) {
          A.add({ x, y, life: R(0.12, 0.28), size: j % 3 ? 1 : 2 }, 0xffffff, 0xbfe0ff);
          x += R(-2.5, 2.5) * this.hud.scale;
          y += R(1.5, 3) * this.hud.scale;
        }
      }
      for (let i = 0; i < 24; i++) A.add({ x: cx + R(-w, w) * 0.45, y: cy - h * R(0.1, 0.45), vx: R(-20, 20), vy: R(-90, -40), ay: -20, drag: 0.8, life: R(0.8, 1.3), size: 1, flick: 0.5 }, pick([0xffe08a, 0xffb040]), 0xc23a1c);
      for (let i = 0; i < 20; i++) {
        const a = R(0, Math.PI * 2), r = R(0.15, 0.4) * h;
        N.add({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, ox: cx, oy: cy, spin: R(3, 6) * (i % 2 ? 1 : -1), vx: Math.cos(a) * R(40, 80), vy: Math.sin(a) * R(40, 80) - 20, drag: 0.5, life: R(0.9, 1.4), size: i % 3 ? 1 : 2 }, pick([0x2a2030, 0x3a2a1a]), 0x8a6a3a);
      }
    } else if (fx === 'sun') {
      // a sunburst of rays, dung chunks tumbling
      for (let r = 0; r < 16; r++) {
        const a = (r / 16) * Math.PI * 2;
        for (let j = 0; j < 5; j++) {
          const v = 90 + j * 38;
          A.add({ x: cx + Math.cos(a) * w * 0.2, y: cy + Math.sin(a) * w * 0.2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3.2, life: 0.45 + j * 0.06, size: j < 2 ? 2 : 1 }, j < 2 ? 0xfff6d0 : 0xffe08a, 0xffa020);
        }
      }
      for (let i = 0; i < 14; i++) N.add({ x: cx + R(-w, w) * 0.3, y: cy, vx: R(-110, 110), vy: R(-200, -90), ay: 600, drag: 0.5, life: R(0.7, 1.0), size: i % 2 ? 2 : 1 }, pick([0x7a5530, 0x5a3a1a]), 0x3a2410);
    } else if (fx === 'kick') {
      // a shock ring and a blast of sand
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        A.add({ x: cx, y: cy, vx: Math.cos(a) * 230, vy: Math.sin(a) * 90, drag: 4, life: 0.4, size: 1 }, 0xfffbe8, 0xffd36b);
      }
      for (let i = 0; i < 30; i++) {
        const a = R(-Math.PI, 0), v = R(40, 150);
        N.add({ x: cx + R(-w, w) * 0.3, y: cy + h * 0.3, vx: Math.cos(a) * v * 1.6, vy: Math.sin(a) * v * 0.6, ay: 40, drag: 2.2, life: R(0.7, 1.2), size: pick([1, 2, 3]), a: 0.85 }, pick([0xf6dcac, 0xe9c48c, 0xd3a76c]), 0xb0844e);
      }
    } else if (fx === 'death') {
      // souls rise green, smoke curls, bone flecks fly
      for (let i = 0; i < 34; i++) A.add({ x: cx + R(-w, w) * 0.45, y: cy + R(-h, h) * 0.4, vx: R(-15, 15), vy: R(-70, -25), ay: -25, drag: 0.6, life: R(1.0, 1.7), size: i % 5 ? 1 : 2, flick: 0.45 }, pick([0xd8ff9a, 0x9dff3a]), 0x2a6a1a);
      for (let i = 0; i < 26; i++) N.add({ x: cx + R(-w, w) * 0.4, y: cy + R(-h, h) * 0.3, vx: R(-30, 30), vy: R(-50, -15), drag: 1.2, life: R(1.0, 1.6), size: pick([2, 3]), a: 0.7 }, 0x1a1418, 0x3a3040);
      for (let i = 0; i < 18; i++) {
        const a = R(0, Math.PI * 2), v = R(90, 170);
        N.add({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, ay: 380, drag: 1, life: R(0.6, 1.0), size: 1 }, pick([0xfff3d6, 0xd8ccb0]), 0xa89878);
      }
    }
  }

  dispose() {
    this.job = null;
    window.removeEventListener('mousemove', this.onMouse);
    if (TarotBar.current === this) TarotBar.current = null;
    this.cards = [];
    this.add.points.removeFromParent();
    this.norm.points.removeFromParent();
    this.add.dispose();
    this.norm.dispose();
    void this.scene;
  }
}

function smooth(x: number) {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
}
