// Shared kit for the HUD pieces (SoulBar, MissionPaper, OutlawHud, ArsenalHud):
//  • sculpt()      a dense SDF voxeliser: every cell whose centre is inside the
//                  shape is filled, and its colour is painted from the surface
//                  normal, how exposed the voxel is (edges rub bright, crevices
//                  grime over) and layered noise — the same realistic material
//                  language as the HUD hero models (props/hud.ts). The HUD shows
//                  these models as photographs (HudSprites), not live 3D.
//  • inkText / wrapInk / TextPlane   Alagard typography helpers.
//  • PixelFx       square 2D pixel-art particles snapped to the HUD pixel grid
//                  (dust, embers, soul wisps, chalk), drawn over the HUD canvas.
// Coordinates: the HUD overlay scene is orthographic in CSS pixels, y up (screen
// y is negated); pieces are laid out in HUD pixels and scaled by Hud.scale.
import * as THREE from 'three';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { Noise, hash3 } from '../../engine/math/rand';

export const KNZ = new Noise(0x3a7f21);
export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const sstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const len2 = (x: number, y: number) => Math.sqrt(x * x + y * y);
export const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

/** 3-octave simplex fbm, roughly [-1, 1] */
export function fbm3(x: number, y: number, z: number, oct = 3) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * KNZ.n3(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s * 1.6;
}
export const h3 = (x: number, y: number, z: number, salt = 0) => hash3(x * 3 + salt * 7919, y * 5 - salt * 104729, z * 7 + salt * 1299709);

export function mixc(a: number, b: number, t: number) {
  t = clamp01(t);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (((ar + (br - ar) * t) | 0) << 16) | (((ag + (bg - ag) * t) | 0) << 8) | ((ab + (bb - ab) * t) | 0);
}
export function mulc(c: number, f: number) {
  const r = Math.min(255, ((c >> 16) & 255) * f), g = Math.min(255, ((c >> 8) & 255) * f), b = Math.min(255, (c & 255) * f);
  return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
}

/** what a painter gets for each surface voxel */
export interface Surf {
  /** outward normal (sdf gradient) */
  nx: number;
  ny: number;
  nz: number;
  /** 0 = buried in a crevice … 1 = a sharp exposed edge/tip (empty share of the 3×3×3 block) */
  exp: number;
}
export type Painter = (x: number, y: number, z: number, s: Surf) => number | [number, number];

/**
 * Voxelise a signed distance field (negative inside) on the integer grid of the
 * box [x0..x1]×[y0..y1]×[z0..z1] (cell centres at +0.5) and paint the surface.
 * `col(x, y)` (optional) is evaluated once per (x, y) column and handed to `sd`,
 * so expensive 2D work (outlines, height fields, noise) is not repeated per cell.
 * Surface normals and exposure come from the occupancy grid itself.
 */
export function sculpt<C = undefined>(
  name: string,
  box: [number, number, number, number, number, number],
  sd: (x: number, y: number, z: number, col: C) => number,
  paint: Painter,
  flags: number = VF.SOLID,
  col?: (x: number, y: number) => C
) {
  const [x0, y0, z0, x1, y1, z1] = box;
  const sx = x1 - x0 + 1, sy = y1 - y0 + 1, sz = z1 - z0 + 1;
  const a = new Uint8Array(sx * sy * sz);
  const id = (x: number, y: number, z: number) => x - x0 + sx * (y - y0 + sy * (z - z0));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const c = (col ? col(x + 0.5, y + 0.5) : undefined) as C;
      for (let z = z0; z <= z1; z++) if (sd(x + 0.5, y + 0.5, z + 0.5, c) < 0) a[id(x, y, z)] = 1;
    }
  const at = (x: number, y: number, z: number) => (x < x0 || y < y0 || z < z0 || x > x1 || y > y1 || z > z1 ? 0 : a[id(x, y, z)]);
  const m = new VoxelModel(name);
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!a[id(x, y, z)]) continue;
        const surface = !at(x + 1, y, z) || !at(x - 1, y, z) || !at(x, y + 1, z) || !at(x, y - 1, z) || !at(x, y, z + 1) || !at(x, y, z - 1);
        if (!surface) {
          m.set(x, y, z, 0x201810, flags);
          continue;
        }
        // exposure from the 3×3×3 block; the normal points toward the empty side of a 5×5×5 block
        let empty = 0, nx = 0, ny = 0, nz = 0;
        for (let dz = -2; dz <= 2; dz++)
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              if (at(x + dx, y + dy, z + dz)) continue;
              const w = 1 / (dx * dx + dy * dy + dz * dz);
              nx += dx * w;
              ny += dy * w;
              nz += dz * w;
              if (dx >= -1 && dx <= 1 && dy >= -1 && dy <= 1 && dz >= -1 && dz <= 1) empty++;
            }
        const l = Math.hypot(nx, ny, nz) || 1;
        const c = paint(x, y, z, { nx: nx / l, ny: ny / l, nz: nz / l, exp: clamp01((empty - 6) / 10) });
        if (Array.isArray(c)) m.set(x, y, z, c[0], c[1]);
        else m.set(x, y, z, c, flags);
      }
  return m;
}

/** run queued build jobs, one per call (spreads sculpting over frames) */
export class JobQueue {
  private jobs: (() => void)[] = [];
  add(fn: () => void) {
    this.jobs.push(fn);
  }
  get busy() {
    return this.jobs.length > 0;
  }
  step() {
    const j = this.jobs.shift();
    if (!j) return;
    try {
      j();
    } catch (e) {
      console.warn('[hud] build job failed', e);
    }
  }
}

// ------------------------------------------------------------------ sdf helpers
export const sdBox2 = (x: number, y: number, bx: number, by: number) => {
  const qx = Math.abs(x) - bx, qy = Math.abs(y) - by;
  return len2(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
};
export const sdRoundBox2 = (x: number, y: number, bx: number, by: number, r: number) => sdBox2(x, y, bx - r, by - r) - r;
/** extrude a 2D sdf between z=za and z=zb */
export const extrude = (d2: number, z: number, za: number, zb: number) => {
  const wz = Math.max(za - z, z - zb);
  return Math.min(Math.max(d2, wz), 0) + len2(Math.max(d2, 0), Math.max(wz, 0));
};
export const smin = (a: number, b: number, k: number) => {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return lerp(b, a, h) - k * h * (1 - h);
};
export const sdEll = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
  const k0 = len3(x / rx, y / ry, z / rz), k1 = len3(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return (k0 * (k0 - 1)) / (k1 || 1e-6);
};
/** distance to a segment (capsule core) */
export function segD(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp01(((px - ax) * bax + (py - ay) * bay + (pz - az) * baz) / (bax * bax + bay * bay + baz * baz || 1));
  return len3(px - ax - bax * h, py - ay - bay * h, pz - az - baz * h);
}

// ------------------------------------------------------------------ typography

export interface InkLine {
  text: string;
  /** font size in HUD px (16 = the HUD's text size) */
  size?: number;
  color: string;
  x: number;
  y: number;
  align?: CanvasTextAlign;
  /** 'outline' = dark pixel outline (HUD text); 'brand' = burnt into leather; 'paint' = chipped paint; 'ink' = plain ink */
  style?: 'outline' | 'brand' | 'paint' | 'ink' | 'emboss';
  /** extra colour for brand/emboss/outline effects */
  alt?: string;
  /** 'paint': how worn (0 = flaked away … 1 = intact; default 0.42) */
  chip?: number;
}

/** Alagard set at an integer multiple of its pixel size, with a few material treatments */
export function inkText(c: CanvasRenderingContext2D, q: number, l: InkLine) {
  const size = (l.size ?? 16) * q;
  c.font = `${size}px Alagard`;
  c.textAlign = l.align ?? 'left';
  c.textBaseline = 'top';
  const X = Math.round(l.x * q), Y = Math.round(l.y * q);
  const st = l.style ?? 'ink';
  const u = Math.max(1, Math.round(q));
  if (st === 'outline') {
    c.fillStyle = l.alt ?? '#1a0e06';
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [2, 2]]) c.fillText(l.text, X + dx * u, Y + dy * u);
  } else if (st === 'brand') {
    // a hot iron: a soft scorched halo, a dark seared core, a singed lighter lip
    c.save();
    c.shadowColor = l.alt ?? 'rgba(40,14,4,0.85)';
    c.shadowBlur = 3 * q;
    c.fillStyle = 'rgba(52,22,8,0.55)';
    c.fillText(l.text, X, Y);
    c.restore();
    c.fillStyle = 'rgba(214,150,90,0.35)';
    c.fillText(l.text, X, Y - u);
  } else if (st === 'emboss') {
    c.fillStyle = l.alt ?? 'rgba(255,255,255,0.45)';
    c.fillText(l.text, X - u, Y - u);
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillText(l.text, X + u, Y + u);
  } else if (st === 'paint') {
    c.fillStyle = 'rgba(20,10,4,0.45)';
    c.fillText(l.text, X + u, Y + u);
  }
  c.fillStyle = l.color;
  c.fillText(l.text, X, Y);
  if (st === 'paint') {
    // chipped, sun-faded paint: knock out flecks on a coarse pixel grid
    const w = Math.ceil(c.measureText(l.text).width);
    const x0 = c.textAlign === 'center' ? X - w / 2 : c.textAlign === 'right' ? X - w : X;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    const cell = u;
    for (let yy = Y; yy < Y + size; yy += cell)
      for (let xx = x0; xx < x0 + w; xx += cell) {
        const n = KNZ.n2(xx * 0.09 / q, yy * 0.09 / q) * 0.6 + h3(xx, yy, 7) * 0.4;
        const th = l.chip ?? 0.42;
        if (n > th) {
          c.fillStyle = `rgba(0,0,0,${n > th + 0.13 ? 0.95 : 0.5})`;
          c.fillRect(xx, yy, cell, cell);
        }
      }
    c.restore();
  }
}

export function measureInk(s: string, size = 16) {
  const c = measureCtx();
  c.font = `${size}px Alagard`;
  // before the web font has loaded the canvas measures a narrower fallback face: pad it so layouts never come up short
  let ready = true;
  try {
    ready = document.fonts?.check?.(`${size}px Alagard`) ?? true;
  } catch {
    /* no font API: trust the measure */
  }
  return c.measureText(s).width * (ready ? 1 : 1.3);
}
let _mc: CanvasRenderingContext2D | null = null;
function measureCtx() {
  if (!_mc) _mc = document.createElement('canvas').getContext('2d')!;
  return _mc;
}

/** word-wrap to a width in HUD px */
export function wrapInk(s: string, maxW: number, size = 16, maxLines = 2) {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (measureInk(t, size) <= maxW || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    let last = keep[maxLines - 1];
    while (last.length > 1 && measureInk(last + '…', size) > maxW) last = last.slice(0, -1);
    keep[maxLines - 1] = last + '…';
    return keep;
  }
  return lines;
}

/**
 * A quad carrying Alagard text: w×h HUD px, drawn at q canvas px per HUD px.
 * Redraws only when the key changes.
 */
export class TextPlane {
  mesh: THREE.Mesh;
  private cv = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private key = '';
  private q = 0;
  constructor(public w: number, public h: number, order = 0, depthTest = true) {
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    this.mesh.renderOrder = order;
    this.mesh.frustumCulled = false;
  }
  /** returns true if redrawn */
  draw(key: string, q: number, fn: (c: CanvasRenderingContext2D, q: number) => void) {
    q = Math.max(1, Math.round(q));
    if (key === this.key && q === this.q) return false;
    this.key = key;
    this.q = q;
    const W = Math.ceil(this.w * q), H = Math.ceil(this.h * q);
    if (this.cv.width !== W || this.cv.height !== H) {
      this.cv.width = W;
      this.cv.height = H;
      this.tex.dispose();
    }
    const c = this.cv.getContext('2d')!;
    c.clearRect(0, 0, W, H);
    c.imageSmoothingEnabled = false;
    fn(c, q);
    this.tex.needsUpdate = true;
    return true;
  }
  set opacity(v: number) {
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = v;
  }
  dispose() {
    this.tex.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}

// ------------------------------------------------------------------ 2D pixel particles

export interface PxOpts {
  /** HUD px, screen space (y down) */
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  /** gravity (HUD px/s², +down) */
  ay?: number;
  drag?: number;
  life: number;
  /** square size in HUD px */
  size?: number;
  /** grows to this size by the end */
  size1?: number;
  c0: number;
  c1?: number;
  alpha?: number;
  /** sideways sine curl (HUD px/s amplitude) */
  curl?: number;
  /** homing: steer to (tx, ty) along a curved path; life = flight time */
  tx?: number;
  ty?: number;
  /** flicker amount 0..1 */
  flick?: number;
}

interface Pt extends PxOpts {
  t: number;
  sx: number;
  sy: number;
  ph: number;
  ca: THREE.Color;
  cb: THREE.Color;
}

const PXV = /* glsl */ `
attribute float size;
attribute vec4 tint;
uniform float uSnap, uPR;
varying vec4 vC;
void main(){
  vC = tint;
  vec3 p = position;
  p.xy = floor(p.xy / uSnap + 0.5) * uSnap;
  gl_PointSize = size * uPR;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const PXF = /* glsl */ `varying vec4 vC; void main(){ if (vC.a < 0.02) discard; gl_FragColor = vC; }`;

/** square HUD-pixel particles in the HUD overlay scene */
export class PixelFx {
  points: THREE.Points;
  private list: Pt[] = [];
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
      uniforms: { uSnap: { value: 2 }, uPR: { value: 1 } },
      vertexShader: PXV,
      fragmentShader: PXF,
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
  emit(o: PxOpts) {
    if (this.list.length >= this.max) return;
    this.list.push({ ...o, t: 0, sx: o.x, sy: o.y, ph: Math.random() * TAU, ca: new THREE.Color(o.c0), cb: new THREE.Color(o.c1 ?? o.c0) });
  }
  clear() {
    this.list.length = 0;
  }
  /** s = css px per HUD px */
  update(dt: number, s: number, z = 2000) {
    this.mat.uniforms.uSnap.value = s;
    this.mat.uniforms.uPR.value = (window as any).__engine?.renderer?.getPixelRatio?.() ?? 1;
    const L = this.list;
    let n = 0;
    const c = new THREE.Color();
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.t += dt;
      if (p.t >= p.life) {
        L[i] = L[L.length - 1];
        L.pop();
        continue;
      }
      const k = p.t / p.life;
      let x: number, y: number;
      if (p.tx !== undefined && p.ty !== undefined) {
        // curved homing flight (quadratic bezier through a swirl control point)
        const e = k * k * (3 - 2 * k);
        const mx = (p.sx + p.tx) / 2 + (p.vx ?? 0), my = (p.sy + p.ty) / 2 + (p.vy ?? 0);
        x = (1 - e) * (1 - e) * p.sx + 2 * (1 - e) * e * mx + e * e * p.tx;
        y = (1 - e) * (1 - e) * p.sy + 2 * (1 - e) * e * my + e * e * p.ty;
        if (p.curl) x += Math.sin(p.ph + p.t * 9) * p.curl * (1 - e);
        p.x = x;
        p.y = y;
      } else {
        const dr = Math.exp(-(p.drag ?? 0) * dt);
        p.vx = (p.vx ?? 0) * dr;
        p.vy = ((p.vy ?? 0) + (p.ay ?? 0) * dt) * dr;
        p.x += (p.vx + (p.curl ? Math.sin(p.ph + p.t * 4) * p.curl : 0)) * dt;
        p.y += p.vy * dt;
        x = p.x;
        y = p.y;
      }
      c.copy(p.ca).lerp(p.cb, k);
      const fl = p.flick ? 1 - p.flick * (0.5 + 0.5 * Math.sin(p.ph + p.t * 30)) : 1;
      const a = (p.alpha ?? 1) * Math.min(1, (1 - k) * 3) * Math.min(1, p.t * 12 + 0.3) * fl;
      const sz = (p.size ?? 1) + ((p.size1 ?? p.size ?? 1) - (p.size ?? 1)) * k;
      this.pos[n * 3] = x * s;
      this.pos[n * 3 + 1] = -y * s;
      this.pos[n * 3 + 2] = z;
      this.col[n * 4] = c.r;
      this.col[n * 4 + 1] = c.g;
      this.col[n * 4 + 2] = c.b;
      this.col[n * 4 + 3] = a;
      this.siz[n] = Math.max(1, Math.round(sz)) * s;
      n++;
    }
    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.tint as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** play a UI sound if the engine is up */
export function uiSfx(name: string, volume = 0.6, pitch = 1) {
  (window as any).__engine?.audio?.play(name, { volume, pitch });
}

/** a shared metal voxel material for the HUD pieces */
export const METAL = VF.SOLID | VF.METAL;
