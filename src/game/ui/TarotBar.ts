// The ability bar: tarot cards floating at the bottom right of the HUD — the
// three active skills (I Magician, XVI Tower, XIX Sun) and the big XIII Death ultimate.
// Each card is a real 3D object in the HUD scene — the sculpted gilded relief
// frame (props/tarot.ts) lit by the HUD lights and a little jeweller's studio
// reflection, the art window carrying a CardStudio photograph of the card's
// diorama, the numeral and title in Alagard on the frame's plaques. Faces are
// photographed progressively (time-sliced, the cards are dealt face-down and
// flip as their art is ready). On use a card pops, spins to show its sculpted
// back and throws skill-themed 2D pixel-art particles.
// A hunt starts with the three skill cards SEALED: they lie face down, dimmed,
// with no key cap, until the skill is learned from a rank-up card; then the
// card leaps, turns over in a full flourish and bursts with its own particles.
import * as THREE from 'three';
import type { Hud } from './Hud';
import type { RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { CardStudio } from './CardStudio';
import { Kit, TAROT_BAR, TarotDef, TarotFx } from './TarotCards';
import { CARD, tarotFrame } from '../models/props/tarot';
import { isSkillLearned } from '../player/Skills';

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

// ------------------------------------------------------------------ the art window shader

const ART_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ART_FS = /* glsl */ `
uniform sampler2D map;
uniform float uHas, uCd, uReady, uFlash, uT, uSeed;
varying vec2 vUv;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec3 c = texture2D(map, vUv).rgb;
  // still being photographed: the deck's oxblood undercoat
  c = mix(vec3(0.24, 0.07, 0.06), c, uHas);
  // cooldown: sand pours back in from the bottom; the unrecovered part sleeps
  float fill = 1.0 - uCd;
  float wave = sin(vUv.x * 38.0 + uT * 3.0) * 0.004 + sin(vUv.x * 91.0 - uT * 5.0) * 0.002;
  float e = vUv.y - fill - wave;
  float on = step(0.0005, uCd);
  float sleep = smoothstep(-0.006, 0.006, e) * on;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 dim = mix(vec3(l), c, 0.22) * vec3(0.36, 0.33, 0.38);
  vec3 col = mix(c, dim, sleep);
  // the glowing sand line, grainy
  float g = h21(floor(vUv * vec2(66.0, 88.0)) + floor(uT * 12.0));
  col += vec3(1.0, 0.78, 0.42) * exp(-abs(e) * 160.0) * on * (0.55 + 0.45 * g);
  // ready: a slow sheen of light sweeps across the varnish
  float sw = fract(uT * 0.18 + uSeed);
  float band = exp(-pow((vUv.x * 0.8 + vUv.y * 0.5 - sw * 2.4 + 0.5) * 7.0, 2.0));
  col += vec3(1.0, 0.93, 0.78) * band * 0.2 * uReady;
  col = mix(col, vec3(1.0, 0.97, 0.88), uFlash * 0.75);
  gl_FragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------ typography (the only thing drawn in 2D)

const PPV = 12; // canvas pixels per voxel for the plaque text

function plaqueText(text: string, wVox: number, hVox: number, capFrac: number, color = '#2a170c') {
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

/** a warm jeweller's studio for the gilt to reflect (soft key up-left, warm bounce, cool rim) */
function giltEnv(renderer: THREE.WebGLRenderer) {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const pos = geo.getAttribute('position');
  const col: number[] = [];
  const c = new THREE.Color(), top = new THREE.Color(0x6a5a50), mid = new THREE.Color(0x2a1c16), low = new THREE.Color(0x8a5a30);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y > 0) c.copy(mid).lerp(top, y);
    else c.copy(mid).lerp(low, Math.min(1, -y * 1.6));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const panel = (w: number, h: number, colr: number, k: number, p: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(colr).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...p);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(7, 5, 0xfff0d8, 3.2, [-5, 5.5, 5]);
  panel(3, 6, 0xbfd8ff, 1.6, [6.5, 2, -3]);
  panel(9, 2, 0xffc070, 1.4, [0, -6, 4]);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.03);
  pm.dispose();
  geo.dispose();
  return rt;
}

// ------------------------------------------------------------------ cards

interface CardObj {
  def: TarotDef;
  group: THREE.Group;
  tilt: THREE.Group;
  frame: THREE.Mesh;
  frameMat: VoxelMaterial;
  art: THREE.Mesh;
  artMat: THREE.ShaderMaterial;
  texts: THREE.Mesh[];
  pop: number;
  flip: number; // 1 = face down (dealing), eases to 0 when the art lands
  hasArt: boolean;
  lastCd: number;
  lastCharges: number;
  ready: number;
  wasReady: boolean;
  flash: number;
  seed: number;
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
/** art window in frame-local voxel units (pivot at the card centre) */
const ART_RECT = { x: (WIN.x0 + WIN.x1 + 1) / 2 - FW / 2, y: (WIN.y0 + WIN.y1 + 1) / 2 - FH / 2, w: WIN.x1 - WIN.x0 + 1, h: WIN.y1 - WIN.y0 + 1 };

export class TarotBar {
  private cards: CardObj[] = [];
  private job: Generator<void, void, void> | null = null;
  private started = false;
  private frameGeo: THREE.BufferGeometry | null = null;
  private coreMat: THREE.MeshStandardMaterial | null = null;
  private coreGeo: THREE.PlaneGeometry | null = null;
  private env: THREE.WebGLRenderTarget | null = null;
  private add = new PixelSparks(700, true, 61);
  private norm = new PixelSparks(500, false, 60);
  private t = 0;
  private lastUlt = 0;
  private pr = 1;
  /** diagnostics: total ms spent building, the longest single step, frames used */
  buildMs = 0;
  maxStepMs = 0;
  slices = 0;
  done = false;

  constructor(private scene: THREE.Scene, private hud: Hud) {
    scene.add(this.norm.points, this.add.points);
  }

  /** start / continue the time-sliced build; call once per frame from the HUD render */
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
    const fr = tarotFrame();
    yield;
    this.frameGeo = buildVoxelGeometry(fr.model, { voxelSize: 1, pivot: fr.pivot });
    yield;
    this.env = giltEnv(renderer);
    TAROT_BAR.forEach((d, i) => this.cards.push(this.makeCard(d, i)));
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
          const cv = studio.shoot(r.value, TAROT_ART[0], TAROT_ART[1], 2);
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.NoColorSpace; // display values, written straight out
          tex.anisotropy = 4;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          c.artMat.uniforms.map.value = tex;
          c.hasArt = true;
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

  private makeCard(def: TarotDef, i: number): CardObj {
    const group = new THREE.Group();
    const tilt = new THREE.Group();
    group.add(tilt);
    const frameMat = makeVoxelMaterial({ fog: false });
    frameMat.envMap = this.env?.texture ?? null;
    frameMat.envMapIntensity = 1.15;
    const frame = new THREE.Mesh(this.frameGeo!, frameMat);
    tilt.add(frame);
    // card-stock core inside the slab so sub-pixel cracks in the relief never show the game behind
    this.coreMat ??= new THREE.MeshStandardMaterial({ color: 0xb8a078, roughness: 0.9, side: THREE.DoubleSide });
    const core = new THREE.Mesh((this.coreGeo ??= new THREE.PlaneGeometry(FW - 0.6, FH - 0.6)), this.coreMat);
    core.position.z = -0.5;
    tilt.add(core);
    const artMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, uHas: { value: 0 }, uCd: { value: 0 }, uReady: { value: 0 }, uFlash: { value: 0 }, uT: { value: 0 }, uSeed: { value: i * 0.37 } },
      vertexShader: ART_VS,
      fragmentShader: ART_FS,
    });
    const art = new THREE.Mesh(new THREE.PlaneGeometry(ART_RECT.w, ART_RECT.h), artMat);
    art.position.set(ART_RECT.x, ART_RECT.y, 1.02);
    tilt.add(art);
    const texts: THREE.Mesh[] = [];
    const plaque = (text: string, cx: number, cy: number, w: number, h: number, cap: number) => {
      const tex = plaqueText(text, w, h, cap);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
      m.position.set(cx + 0.5 - FW / 2, cy + 0.5 - FH / 2, 3.04);
      tilt.add(m);
      texts.push(m);
    };
    plaque(def.num, CARD.numeral.cx, CARD.numeral.cy, 20, 7, 0.78);
    plaque(def.title, CARD.title.cx, CARD.title.cy + 0.5, 54, 8, 0.7);
    for (const o of [frame, art, ...texts]) o.frustumCulled = false;
    this.scene.add(group);
    return { def, group, tilt, frame, frameMat, art, artMat, texts, pop: 0, flip: 1, hasArt: false, lastCd: 0, lastCharges: -1, ready: 0, wasReady: true, flash: 0, seed: i * 1.7, sx: 0, sy: 0, sk: 1, glint: Math.random(), trickle: 0, locked: !isSkillLearned(def.key), unlock: 0 };
  }

  update(dt: number, W: number, H: number) {
    this.t += dt;
    const hud = this.hud;
    const s = hud.scale;
    const st = hud.last;
    this.add.update(dt, s, this.pr);
    this.norm.update(dt, s, this.pr);
    if (!st || !this.cards.length) return;
    const visible = hud.visible && hud.anchors.slide < 0.98;
    const cw = 46 * s, ch = 74.75 * s;
    const n = this.cards.length;
    hud.cardAnchors.length = 0;
    this.cards.forEach((c, i) => {
      const ult = c.def.key === 'Z';
      const sk = st.skills.find((k) => k.key === c.def.key);
      const frac = ult ? 1 - Math.min(1, st.ult) : sk && sk.max > 0 ? Math.min(1, sk.cd / sk.max) : 0;
      const cdNow = ult ? (st.ult >= 1 ? 0 : 99) : sk?.cd ?? 0;
      // used? cooldown jumped up, a charge was spent, or the ultimate fired
      const charges = sk?.charges ?? -1;
      const used = ult ? this.lastUlt >= 1 && st.ult < 0.5 : cdNow > c.lastCd + 0.4 || (charges >= 0 && c.lastCharges >= 0 && charges < c.lastCharges);
      c.lastCd = cdNow;
      c.lastCharges = charges;
      // sealed until learned; learning it turns the card over with a flourish
      const locked = !isSkillLearned(c.def.key);
      if (c.locked && !locked) {
        c.unlock = 1;
        c.pop = 1;
        c.flash = 1;
        if (visible) {
          this.useFx(c);
          this.readyFx(c);
        }
      }
      c.locked = locked;
      c.unlock = Math.max(0, c.unlock - dt * 0.8);
      const readyNow = frac <= 0.001 && !locked;
      if (used && visible && !locked) {
        c.pop = 1;
        c.flash = 1;
      }
      if (readyNow && !c.wasReady && !used && visible) {
        c.flash = Math.max(c.flash, 0.6);
        this.readyFx(c);
      }
      c.wasReady = readyNow;
      c.pop = Math.max(0, c.pop - dt * 1.15);
      c.flash = Math.max(0, c.flash - dt * 3.2);
      c.ready = readyNow ? Math.min(1, c.ready + dt * 3) : 0;
      if (c.locked) c.flip = Math.min(1, c.flip + dt * 3);
      else if (c.hasArt) c.flip = Math.max(0, c.flip - dt * (c.unlock > 0 ? 1.15 : 2.2));
      // fan along the bottom-right, the ultimate largest at the end
      const big = ult ? 1.22 : 1;
      const slot = n - 1 - i;
      const x = W - (16 + 22) * s - slot * cw * 0.98 - (ult ? 0 : cw * 0.2);
      const fan = (slot - (n - 1) / 2) * 0.045;
      const bob = Math.sin(this.t * 1.4 + i * 1.3) * 2.2 * s;
      // pop: a quick lift and swell, one full turn showing the sculpted back, settle with a bounce
      const k = c.pop;
      const u = 1 - k;
      const lift = k > 0 ? Math.sin(Math.min(1, u * 1.25) * Math.PI) : 0;
      const swell = k > 0 ? Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.55 + Math.max(0, Math.sin(u * Math.PI * 3)) * 0.04 * k : 0;
      const spin = k > 0 ? smooth(Math.min(1, Math.max(0, (u - 0.12) / 0.62))) * Math.PI * 2 : 0;
      const y = H - 14 * s - (ch * big) / 2 - bob - lift * 46 * s - Math.sin(c.unlock * Math.PI) * 30 * s + (c.locked ? 6 * s : 0);
      const sc = ((ch * big) / FH) * (1 + swell);
      c.group.visible = visible;
      c.group.position.set(x, -y, 700 + i * 40 + (k > 0 ? 500 : 0));
      c.group.scale.setScalar(sc);
      // a slow float in 3D so the relief catches the light; dealt face down until the photo lands
      const deal = smooth(c.flip) * Math.PI;
      c.tilt.rotation.set(-0.1 + Math.sin(this.t * 0.8 + c.seed) * 0.07, Math.sin(this.t * 0.6 + c.seed * 1.3) * 0.16 + spin + deal, fan + Math.sin(this.t * 0.9 + i) * 0.02);
      // the art window: cooldown sand, ready sheen, flash
      const am = c.artMat.uniforms;
      am.uHas.value = c.hasArt ? 1 : 0;
      am.uCd.value = frac;
      am.uReady.value = c.ready;
      am.uFlash.value = c.flash;
      am.uT.value = this.t;
      // the gilt breathes when ready; the gems glow for the ultimate
      const breathe = c.ready * (ult ? 0.5 + 0.5 * Math.sin(this.t * 5) : 0.5 + 0.5 * Math.sin(this.t * 2.2 + i));
      const tint = c.frameMat.userData.tint.value;
      const lvl = c.locked ? 0.5 : readyNow ? 1 + breathe * 0.06 + c.flash * 0.3 : 0.74 + c.flash * 0.3;
      tint.setRGB(lvl, lvl, lvl * (readyNow ? 1 : 1.04));
      c.frameMat.userData.fx.value.z = breathe * (ult ? 2.5 : 1.2) + c.flash * 2;
      for (const m of c.texts) (m.material as THREE.MeshBasicMaterial).color.setScalar(readyNow ? 1 : 0.8);
      c.sx = x;
      c.sy = y;
      c.sk = sc;
      if (used && visible) this.useFx(c);
      if (visible && !c.locked) this.ambientFx(c, dt, frac, readyNow, ult);
      if (!c.locked) hud.cardAnchors.push({ key: c.def.key, x: x / s, y: y / s, h: (ch * big) / s, cd: ult ? 0 : cdNow });
    });
    this.lastUlt = st.ult;
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
    const s = this.hud.scale;
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
    void s;
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
    for (const c of this.cards) {
      c.group.removeFromParent();
      c.frameMat.dispose();
      (c.artMat.uniforms.map.value as THREE.Texture | null)?.dispose();
      c.artMat.dispose();
      c.art.geometry.dispose();
      for (const m of c.texts) {
        const mm = m.material as THREE.MeshBasicMaterial;
        mm.map?.dispose();
        mm.dispose();
        m.geometry.dispose();
      }
    }
    this.cards = [];
    this.frameGeo?.dispose();
    this.coreGeo?.dispose();
    this.coreMat?.dispose();
    this.env?.dispose();
    this.add.points.removeFromParent();
    this.norm.points.removeFromParent();
    this.add.dispose();
    this.norm.dispose();
  }
}

function smooth(x: number) {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
}
