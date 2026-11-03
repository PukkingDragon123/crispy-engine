// Voxel-cast Alagard lettering that stands in the world.
//
// Every glyph is its own sculpted mesh: the Alagard outline (the only thing
// "drawn", and only as a mask) is extruded into a thick cast slab with a stepped
// bevel, a hand-painted face gradient, lit rim highlights on the upper-left
// edges, worn chips along the bevel, a glowing inlay down the middle of the thick
// strokes and an inked backing plate that reads as a black outline. One mesh per
// glyph so letters can rise out of the sand one by one, slam down from the sky,
// punch in toward the lens, sink back or crumble away.
//
// Geometry is cached per (char, style, resolution) and scaled per word, so the
// same letters are cheap to reuse at any size.
import * as THREE from 'three';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { hash3 } from '../../engine/math/rand';

export type LetterStyle = 'gold' | 'ember' | 'bone' | 'moon' | 'jade' | 'sand';

interface Pal {
  /** face gradient bottom -> top */
  f0: number;
  f1: number;
  /** cast sides, deep -> shallow */
  s0: number;
  s1: number;
  /** lit bevel edge / shadowed bevel edge */
  rimHi: number;
  rimLo: number;
  back: number;
  /** inlay (glowing core) */
  c0: number;
  c1: number;
  ink: number;
  metal: boolean;
  glowCore: boolean;
}

const PALS: Record<LetterStyle, Pal> = {
  gold: { f0: 0xb87424, f1: 0xffe39a, s0: 0x6a3c12, s1: 0xb0782a, rimHi: 0xfff4d0, rimLo: 0x7a4814, back: 0x4a2a0e, c0: 0x4fe89a, c1: 0xdcffee, ink: 0x1e0f06, metal: true, glowCore: true },
  ember: { f0: 0x5a4234, f1: 0xc4a68a, s0: 0x241812, s1: 0x4a3a30, rimHi: 0xffc890, rimLo: 0x2e1e16, back: 0x140c0a, c0: 0xff4a12, c1: 0xffe08a, ink: 0x0c0604, metal: true, glowCore: true },
  bone: { f0: 0xc9a878, f1: 0xfff1d6, s0: 0x8a6a46, s1: 0xc0a074, rimHi: 0xfffaf0, rimLo: 0x8a6a46, back: 0x4a2c1a, c0: 0x8dff4a, c1: 0xeaffd0, ink: 0x22140a, metal: false, glowCore: true },
  moon: { f0: 0x6e7a8e, f1: 0xeaf2ff, s0: 0x343c4c, s1: 0x5a6476, rimHi: 0xffffff, rimLo: 0x3a4252, back: 0x1e2430, c0: 0x46d8ff, c1: 0xe4fbff, ink: 0x0a0e16, metal: true, glowCore: true },
  jade: { f0: 0x1e6a4a, f1: 0x9af0c4, s0: 0x0e3626, s1: 0x2a7a58, rimHi: 0xeafff4, rimLo: 0x14402e, back: 0x0a2418, c0: 0xc4ff6a, c1: 0xffffff, ink: 0x06140e, metal: true, glowCore: true },
  sand: { f0: 0xc89a5e, f1: 0xf4d8a6, s0: 0x8e6436, s1: 0xb48450, rimHi: 0xfff0cc, rimLo: 0x8a6034, back: 0x6a4626, c0: 0xffc070, c1: 0xfff0c8, ink: 0x3a2412, metal: false, glowCore: false },
};

/** pick a lettering style from an old cut-in colour */
export function styleForColor(color: string | undefined): LetterStyle {
  const c = new THREE.Color(color ?? '#ffd36b');
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const h = hsl.h * 360;
  if (hsl.s < 0.2) return 'bone';
  if (h < 30 || h >= 330) return 'ember';
  if (h < 66) return 'gold';
  if (h < 160) return 'jade';
  return 'moon';
}

const mixc = (a: number, b: number, t: number) => {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
  const bb = (a & 255) * (1 - t) + (b & 255) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bb);
};

/** canvas px per voxel row of a glyph (cap height is about 0.7 of this) */
const PX = 48;
/** slab depth in voxels */
const DEPTH = 9;

interface GlyphGeo {
  geo: THREE.BufferGeometry;
  /** glyph box in voxels (relative to the pen position on the baseline) */
  x0: number;
  x1: number;
  y1: number;
}

const geoCache = new Map<string, GlyphGeo | null>();
let measureCtx: CanvasRenderingContext2D | null = null;
function measurer() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  measureCtx.font = `${PX}px Alagard`;
  return measureCtx;
}

/** one glyph, voxel-cast. Origin: the pen position on the baseline, at the back of the slab. */
function glyphGeo(ch: string, style: LetterStyle): GlyphGeo | null {
  const key = ch + '|' + style;
  if (geoCache.has(key)) return geoCache.get(key)!;
  const P = PALS[style];
  const pad = 6;
  const m0 = measurer();
  const mt = m0.measureText(ch);
  const asc = Math.ceil(mt.actualBoundingBoxAscent || PX * 0.75);
  const desc = Math.ceil(mt.actualBoundingBoxDescent || PX * 0.1);
  const left = Math.ceil(mt.actualBoundingBoxLeft || 0);
  const W = Math.ceil(Math.max(mt.width, (mt.actualBoundingBoxRight || mt.width) + left)) + pad * 2 + left;
  const H = asc + desc + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = Math.max(4, W);
  cv.height = Math.max(4, H);
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.font = `${PX}px Alagard`;
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#ffffff';
  const penX = pad + left;
  const baseY = pad + asc;
  c.fillText(ch, penX, baseY);
  const img = c.getImageData(0, 0, cv.width, cv.height).data;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < cv.width && y < cv.height && img[(y * cv.width + x) * 4 + 3] > 110;
  const m = new VoxelModel('glyph_' + ch);
  let any = false;
  let gx0 = 1e9, gx1 = -1e9, gy1 = -1e9;
  // erosion depth (how far inside the stroke a pixel is) for the bevel and the inlay
  const depthAt = (x: number, y: number) => {
    let e = 0;
    for (let r = 1; r <= 4; r++) {
      if (on(x - r, y) && on(x + r, y) && on(x, y - r) && on(x, y + r) && on(x - r + 1, y - r + 1) && on(x + r - 1, y + r - 1)) e = r;
      else break;
    }
    return e;
  };
  for (let y = 0; y < cv.height; y++)
    for (let x = 0; x < cv.width; x++) {
      const vx = x - penX;
      const vy = baseY - y;
      if (on(x, y)) {
        any = true;
        gx0 = Math.min(gx0, vx);
        gx1 = Math.max(gx1, vx);
        gy1 = Math.max(gy1, vy);
        const e = depthAt(x, y);
        // stepped bevel: the outermost ring sits two voxels back, the next one voxel back
        const front = DEPTH - 1 + (e >= 2 ? 1 : e === 1 ? 0 : -1);
        const ty = (vy + 4) / (PX * 0.8);
        const litEdge = !on(x - 1, y - 1) || !on(x, y - 1);
        const darkEdge = !on(x + 1, y + 1) || !on(x, y + 1);
        const h = hash3(x, y, 7);
        const chip = e <= 1 && h < 0.07; // worn chips along the bevel
        let face = mixc(P.f0, P.f1, ty);
        if (e <= 1) face = litEdge ? P.rimHi : darkEdge ? P.rimLo : mixc(face, P.rimHi, 0.25);
        if (chip) face = P.s0;
        const top = chip ? front - 1 : front;
        const core = P.glowCore && e >= 3;
        for (let z = 0; z <= top; z++) {
          let col: number;
          let fl: number = P.metal ? VF.METAL : 0;
          if (z === top) {
            col = core ? mixc(P.c0, P.c1, ty * 0.7) : face;
            if (core) fl = VF.GLOW;
            else if (P.metal && e <= 1 && litEdge) fl = VF.METAL | VF.EMISSIVE;
          } else if (z < 2) col = P.back;
          else col = mixc(P.s0, P.s1, z / DEPTH) ;
          // cast ring lines down the sides (one darker groove)
          if (z !== top && z === Math.floor(DEPTH * 0.55)) col = mixc(col, P.s0, 0.5);
          m.set(vx, vy, z, col, fl);
        }
      } else {
        // the inked backing plate: a thick dark rim just behind the outline
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 5 && on(x + dx, y + dy)) ((near = true), 0);
        if (near) for (let z = 0; z < 3; z++) m.set(vx, vy, z, z === 2 ? mixc(P.ink, P.back, 0.4) : P.ink);
      }
    }
  if (!any) {
    geoCache.set(key, null);
    return null;
  }
  const geo = buildVoxelGeometry(m, { voxelSize: 1, pivot: [0, 0, 0] });
  const g: GlyphGeo = { geo, x0: gx0, x1: gx1 + 1, y1: gy1 + 1 };
  geoCache.set(key, g);
  return g;
}

export type LetterIn = 'rise' | 'slam' | 'stamp' | 'none';
export type LetterOut = 'crumble' | 'sink';

export interface Letter {
  /** pivot group at the glyph's bottom centre (so it can tilt as it rises) */
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  ch: string;
  /** resting local position of the pivot inside the word group */
  home: THREE.Vector3;
  /** glyph width / height (m) */
  w: number;
  h: number;
  delay: number;
  t: number;
  landed: boolean;
  /** world-space ground correction applied on placement (local y) */
  lift: number;
}

export interface WordOpts {
  /** cap height of a letter in metres */
  height: number;
  style: LetterStyle;
  /** extra letter spacing (fraction of height) */
  track?: number;
  /** line gap (fraction of height) */
  leading?: number;
  castShadow?: boolean;
  /** world fog on the letters (false: always crisp) */
  fog?: boolean;
  /** resting inlay / edge glow (0 = only the flare as letters land) */
  glow?: number;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const sat = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);

/**
 * A word (or a few lines) of voxel letters. Place `group` in the world (its
 * origin is the bottom centre of the block of text, letters face +Z), then
 * call `enter()` and `update()` every frame.
 */
export class VoxelWord {
  group = new THREE.Group();
  letters: Letter[] = [];
  mat: VoxelMaterial;
  width = 0;
  height = 0;
  private mode: LetterIn = 'none';
  private outMode: LetterOut | null = null;
  private outT = 0;
  private t = 0;
  /** called once per letter as it lands / breaches (world position of its foot) */
  onLand: ((l: Letter, at: THREE.Vector3, index: number) => void) | null = null;
  /** called while crumbling (world position of a random spot on a letter) */
  onCrumble: ((at: THREE.Vector3, l: Letter) => void) | null = null;
  done = false;

  constructor(text: string, private o: WordOpts) {
    this.mat = makeVoxelMaterial({ fog: o.fog ?? true, emissiveStrength: 1.5, roughness: 0.75 });
    const lines = text.split('\n');
    const cap = PX * 0.72; // Alagard cap height in canvas px
    const vs = o.height / cap;
    const lead = (o.leading ?? 0.42) * o.height;
    const track = (o.track ?? 0.06) * o.height;
    const m = measurer();
    let blockW = 0;
    const rows: { items: { ch: string; g: GlyphGeo; x: number }[]; w: number }[] = [];
    for (const line of lines) {
      const items: { ch: string; g: GlyphGeo; x: number }[] = [];
      let pen = 0;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const adv = m.measureText(ch).width * vs;
        if (ch !== ' ') {
          const g = glyphGeo(ch, o.style);
          if (g) items.push({ ch, g, x: pen });
        }
        pen += adv + (ch === ' ' ? track * 1.5 : track);
      }
      const w = Math.max(0, pen - track);
      rows.push({ items, w });
      blockW = Math.max(blockW, w);
    }
    const rowH = o.height + lead;
    this.width = blockW;
    this.height = rows.length * o.height + (rows.length - 1) * lead;
    rows.forEach((r, ri) => {
      const y0 = (rows.length - 1 - ri) * rowH;
      for (const it of r.items) {
        const gw = (it.g.x1 - it.g.x0) * vs;
        const cx = it.x + ((it.g.x0 + it.g.x1) / 2) * vs - r.w / 2;
        const mesh = new THREE.Mesh(it.g.geo, this.mat);
        mesh.scale.setScalar(vs);
        // centre the glyph on its pivot (x), slab centred on z
        mesh.position.set(-((it.g.x0 + it.g.x1) / 2) * vs, 0, -(DEPTH / 2) * vs);
        mesh.castShadow = o.castShadow ?? true;
        mesh.receiveShadow = true;
        const pivot = new THREE.Group();
        pivot.add(mesh);
        const home = new THREE.Vector3(cx, y0, 0);
        pivot.position.copy(home);
        this.group.add(pivot);
        this.letters.push({ pivot, mesh, ch: it.ch, home, w: gw, h: it.g.y1 * vs, delay: 0, t: 0, landed: false, lift: 0 });
      }
    });
  }

  /** stand every letter of the bottom row on the terrain (call after placing the group) */
  plant(groundAt: (x: number, z: number) => number, sink = 0.04) {
    this.group.updateMatrixWorld(true);
    const baseY = this.group.position.y;
    for (const l of this.letters) {
      if (l.home.y > 0.001) continue;
      _v.copy(l.home);
      this.group.localToWorld(_v);
      // the lowest ground under the glyph's width so no corner floats
      const r = this.group.quaternion;
      _w.set(1, 0, 0).applyQuaternion(r);
      let g = Infinity;
      for (const s of [-0.45, 0, 0.45]) g = Math.min(g, groundAt(_v.x + _w.x * l.w * s, _v.z + _w.z * l.w * s));
      l.lift = g - baseY - sink;
    }
    // upper lines ride on the average of the line below
    const bottom = this.letters.filter((l) => l.home.y <= 0.001);
    const avg = bottom.length ? bottom.reduce((a, l) => a + l.lift, 0) / bottom.length : 0;
    for (const l of this.letters) if (l.home.y > 0.001) l.lift = avg;
  }

  /** start the entrance; stagger in seconds between letters */
  enter(mode: LetterIn, stagger = 0.07, delay = 0) {
    this.mode = mode;
    this.t = 0;
    this.letters.forEach((l, i) => {
      l.delay = delay + i * stagger;
      l.t = 0;
      l.landed = mode === 'none';
      l.pivot.visible = mode === 'none';
    });
    this.applyIdle(0);
  }

  leave(mode: LetterOut) {
    if (this.outMode) return;
    this.outMode = mode;
    this.outT = 0;
  }

  get leaving() {
    return !!this.outMode;
  }

  update(dt: number) {
    if (this.done) return;
    this.t += dt;
    const n = this.letters.length;
    for (let i = 0; i < n; i++) {
      const l = this.letters[i];
      l.t += dt;
      const lt = l.t - l.delay;
      const p = l.pivot;
      if (lt < 0) {
        p.visible = false;
        continue;
      }
      p.visible = true;
      const H = this.o.height;
      let y = 0, rx = 0, rz = 0, s = 1, sy = 1, z = 0;
      if (this.mode === 'rise') {
        // bursts up out of the sand, overshoots, rocks and settles
        const k = sat(lt / 0.5);
        const e = 1 - Math.pow(1 - k, 3);
        y = -l.h * 1.15 * (1 - e) + Math.sin(k * Math.PI) * H * 0.18;
        const a = lt - 0.5;
        rx = k < 1 ? -0.55 * (1 - e) : Math.exp(-a * 5) * Math.sin(a * 16) * 0.09;
        rz = k < 1 ? (i % 2 ? 0.2 : -0.2) * (1 - e) : Math.exp(-a * 5) * Math.sin(a * 13 + i) * 0.05;
        if (!l.landed && k > 0.18) this.land(l, i);
      } else if (this.mode === 'slam') {
        const k = sat(lt / 0.22);
        y = H * 3.2 * (1 - k * k);
        rx = (1 - k) * 0.35;
        if (k >= 1) {
          if (!l.landed) this.land(l, i);
          const a = lt - 0.22;
          sy = 1 - Math.exp(-a * 9) * Math.cos(a * 22) * 0.16;
          s = 1 + Math.exp(-a * 9) * Math.cos(a * 22) * 0.08;
        }
      } else if (this.mode === 'stamp') {
        const k = sat(lt / 0.15);
        const e = k * k * k;
        s = 2.6 - 1.6 * e;
        z = (1 - e) * H * 3;
        rz = (1 - e) * (i % 2 ? 0.3 : -0.3);
        if (k >= 1) {
          if (!l.landed) this.land(l, i);
          const a = lt - 0.15;
          s = 1 + Math.exp(-a * 10) * Math.sin(a * 30) * 0.08;
        }
      }
      // out: sink back into the sand, or crumble (the material dissolves)
      if (this.outMode === 'sink') {
        const k = sat((this.outT - i * 0.04) / 0.55);
        y -= l.h * 1.2 * k * k;
        rx -= k * 0.3;
      }
      p.position.set(l.home.x, l.home.y + l.lift + y, l.home.z + z);
      p.rotation.set(rx, 0, rz);
      p.scale.set(s, s * sy, s);
    }
    if (this.outMode) {
      this.outT += dt;
      if (this.outMode === 'crumble') {
        const k = sat(this.outT / 0.75);
        this.mat.userData.fx.value.y = k;
        if (this.onCrumble && k < 0.95)
          for (let j = 0; j < 3; j++) {
            const l = this.letters[Math.floor(Math.random() * n)];
            if (!l) break;
            _v.set((Math.random() - 0.5) * l.w, l.h * Math.random(), 0);
            l.pivot.localToWorld(_v);
            this.onCrumble(_v, l);
          }
        if (k >= 1) this.done = true;
      } else if (this.outT > 0.6 + n * 0.04) this.done = true;
    }
    // the inlay flares as letters land, then breathes
    const fx = this.mat.userData.fx.value;
    fx.z = Math.max(this.o.glow ?? 0, fx.z - dt * 2.2);
  }

  private land(l: Letter, i: number) {
    l.landed = true;
    this.mat.userData.fx.value.z = Math.min(2.5, this.mat.userData.fx.value.z + 0.9);
    if (this.onLand) {
      this.group.updateMatrixWorld(true);
      this.onLand(l, this.footOf(l), i);
    }
  }

  private applyIdle(_dt: number) {
    for (const l of this.letters) l.pivot.position.copy(l.home).setY(l.home.y + l.lift);
  }

  /** world position of a letter's foot */
  footOf(l: Letter, out = new THREE.Vector3()) {
    out.set(l.home.x, l.home.y + l.lift, l.home.z);
    return this.group.localToWorld(out);
  }

  dispose() {
    this.group.removeFromParent();
    this.mat.dispose();
  }
}

/** make sure Alagard is decoded before the first word is cast */
export function warmLetters() {
  void (document as any).fonts?.load?.(`${PX}px Alagard`);
}
