// The MISSION PAPER: the quest you accepted is a torn, scorched, coffee-ringed
// note speared on a forged nail near the top-right corner of the HUD.
// Each note is a Verlet cloth (stretch, shear and bend springs, a soft pull back
// to its pinned pose) that flutters in the desert wind and ruffles harder the
// faster Sundown rides. The parchment is shaded procedurally (fibres, foxing,
// coffee rings, creases, a charred corner, a deckled torn edge) and lit with a
// cel ramp; the writing is Alagard set on it in ink.
//   • a new quest: the note blows in, slaps flat and the nail is driven home
//   • objective progress: an ink stroke underlines the progress and a check is ticked
//   • completed: a red DONE stamp slams down, then the wind rips the note off the
//     nail (a torn scrap stays impaled for a moment)
//   • failed: the note catches fire and burns away to embers
// Several quests stack on the same nail, fanned a little, the newest on top.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { sculpt, Surf, PixelFx, inkText, wrapInk, measureInk, fbm3, h3, mixc, mulc, clamp, clamp01, TAU, uiSfx, METAL, len2, lerp, KNZ } from './HudKit';

/** what one note says */
export interface PaperQuest {
  /** stable id (the title will do) */
  id: string;
  title: string;
  objective: string;
  /** e.g. "340 m", "3/10 outlaws · 45s" */
  progress?: string;
  /** e.g. "Reward: 120 bounty" */
  reward?: string;
}

/** rewards the quest givers promise (used when a quest does not say) */
const REWARDS: [RegExp, string][] = [
  [/^escort/i, 'Reward: bounty & snake oil'],
  [/wagon/i, 'Reward: bounty & gold'],
  [/rain frog/i, "Reward: a mother's thanks"],
  [/clear the fort/i, 'Reward: gold strongbox'],
  [/strike it rich/i, 'Reward: bounty for the ore'],
  [/camel rustlers/i, "Reward: Humphrey's swift legs"],
  [/^wanted/i, 'Reward: bounty & a strongbox'],
  [/showdown/i, 'Stakes: double or nothing'],
];

/** turn the HUD's old {text, sub} objective into a note */
export function questFromObjective(o: { text: string; sub: string }, reward?: string): PaperQuest {
  const parts = o.sub.split(' — ');
  const objective = parts[0] ?? '';
  const progress = parts.slice(1).join(' — ') || undefined;
  return { id: o.text, title: o.text, objective, progress, reward: reward ?? REWARDS.find(([r]) => r.test(o.text))?.[1] ?? 'Reward: bounty' };
}

const SUCCESS = /COMPLETE|SAFE AND SOUND|FIXED|REUNITED|CLAIMED|\bDONE\b|SUCCESS|THANKS/i;
const FAILURE = /FAIL|DIDN'T|LOST|TOOK THE|ESCAPED|\bDEAD\b|TOO LATE|GONE/i;

// ------------------------------------------------------------------ shader
const VS = /* glsl */ `
varying vec2 vUv; varying vec3 vN;
void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS = /* glsl */ `
uniform sampler2D baseMap, map, stampMap;
uniform vec4 uRect;
uniform float uAspect, uSeed, uShade, uLocalAsp;
uniform vec4 uStampXf;   // centre uv, rotation, height (uv)
uniform vec2 uStamp;     // slam 0..1, opacity
uniform float uStampAsp;
uniform vec4 uStroke;    // x0, x1, y (uv, y up), reveal
uniform vec3 uCheck;     // x, y (uv), reveal
uniform vec2 uHole;      // nail hole (uv)
uniform vec3 uBurn;      // origin uv, progress
uniform float uRip;      // 1 = this note was ripped off the nail (a ragged notch at the hole)
varying vec2 vUv; varying vec3 vN;
float h(vec2 p){ p = fract(p * vec2(123.34, 456.21) + uSeed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ return n2(p) * 0.57 + n2(p * 2.07 + 1.3) * 0.29 + n2(p * 4.3 + 3.1) * 0.14; }
float segD(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * t); }
float sdRB(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main(){
  vec2 uv = uRect.xy + vUv * uRect.zw;
  vec2 A = vec2(uAspect, 1.0);
  // the parchment (fibres, foxing, coffee rings, charred corner, torn deckle) is baked per note
  vec4 base = texture2D(baseMap, uv);
  if (base.a < 0.5) discard;
  if (uRect.z < 0.999) {
    // a scrap: torn all the way round
    vec2 e = min(vUv, 1.0 - vUv);
    if (min(e.x * uLocalAsp, e.y) * uRect.w < 0.008 + n2(uv * 40.0) * 0.02) discard;
  }
  if (uRip > 0.5 && length((uv - uHole) * A) < 0.05 + n2(uv * 30.0) * 0.05) discard;
  float bd = 0.0, bth = 0.0;
  if (uBurn.z > 0.0) {
    bd = length((uv - uBurn.xy) * A) * 0.85 + fbm(uv * 6.0 + 3.0) * 0.32;
    bth = uBurn.z * 1.6;
    if (bd < bth) discard;
  }
  vec3 col = base.rgb;
  // ink
  vec4 ink = texture2D(map, uv);
  col = mix(col, ink.rgb * mix(vec3(1.0), col * 1.08, 0.3), ink.a * 0.92);
  vec3 inkRed = vec3(0.42, 0.07, 0.04);
  // the progress stroke: a quick brush underline
  if (uStroke.w > 0.0) {
    float x0 = uStroke.x, x1 = mix(uStroke.x, uStroke.y, uStroke.w);
    float yy = uStroke.z + 0.012 * sin(uv.x * 40.0) + (uv.x - uStroke.x) * 0.03;
    float th = 0.010 * (0.6 + 0.6 * sin(clamp((uv.x - x0) / max(0.001, uStroke.y - x0), 0.0, 1.0) * 3.14159)) * (0.75 + 0.5 * n2(uv * 80.0));
    float on = step(x0, uv.x) * step(uv.x, x1) * smoothstep(th, th * 0.4, abs(uv.y - yy));
    col = mix(col, inkRed, on * 0.85);
  }
  // the check mark: two strokes, drawn in order
  if (uCheck.z > 0.0) {
    vec2 p = (uv - uCheck.xy) * A / 0.05;
    vec2 a = vec2(-0.55, 0.05), b = vec2(-0.12, -0.45), c = vec2(0.75, 0.75);
    float l1 = length(b - a), l2 = length(c - b), L = (l1 + l2) * uCheck.z;
    float d1 = segD(p, a, a + (b - a) * clamp(L / l1, 0.0, 1.0));
    float d2 = L > l1 ? segD(p, b, b + (c - b) * clamp((L - l1) / l2, 0.0, 1.0)) : 9.0;
    float w = 0.16 + 0.06 * n2(p * 6.0);
    col = mix(col, inkRed, smoothstep(w, w * 0.5, min(d1, d2 + 0.02 * p.x)) * 0.9);
  }
  // the DONE stamp: slams down from above, red ink with a broken double frame
  if (uStamp.y > 0.0) {
    float sl = uStamp.x;
    float sz = uStampXf.w * mix(1.9, 1.0, sl);
    vec2 q = (uv - uStampXf.xy) * A;
    float cr = cos(-uStampXf.z), sr = sin(-uStampXf.z);
    q = mat2(cr, -sr, sr, cr) * q / sz;
    vec2 hb = vec2(uStampAsp * 0.5, 0.5);
    float frame = abs(sdRB(q, hb - 0.06, 0.12)) - 0.035;
    float frame2 = abs(sdRB(q, hb - 0.15, 0.08)) - 0.016;
    float word = 0.0;
    vec2 tq = q / (hb * 2.0) + 0.5;
    if (tq.x > 0.0 && tq.x < 1.0 && tq.y > 0.0 && tq.y < 1.0) word = texture2D(stampMap, tq).a;
    float m = max(max(smoothstep(0.012, 0.0, frame), smoothstep(0.012, 0.0, frame2)), word);
    float grain = smoothstep(0.14, 0.36, fbm(uv * 55.0 + 4.0)) * (0.72 + 0.28 * smoothstep(0.3, 0.7, fbm(uv * 9.0)));
    col = mix(col, vec3(0.74, 0.07, 0.04), m * grain * uStamp.y * smoothstep(0.75, 1.0, sl));
  }
  // nail puncture: crushed fibres round the hole
  col = mix(col, vec3(0.30, 0.18, 0.08), smoothstep(0.05, 0.02, length((uv - uHole) * A)) * 0.6);
  // burning edge: char, then a glowing ember line
  if (uBurn.z > 0.0) {
    col = mix(col, vec3(0.06, 0.03, 0.02), smoothstep(bth + 0.11, bth + 0.02, bd));
    col = mix(col, vec3(1.0, 0.55, 0.15), smoothstep(bth + 0.028, bth, bd));
  }
  // light: the cloth's folds and the paper's creases catch a cel-stepped key light
  float c1 = uv.y - 0.5 - 0.015 * sin(uv.x * 7.0 + uSeed * 6.0);
  float c2 = (uv.x - uv.y * 0.6) - 0.62;
  float fold = smoothstep(0.012, 0.0, abs(c1)) * (c1 > 0.0 ? 0.08 : -0.06) + smoothstep(0.01, 0.0, abs(c2)) * (c2 > 0.0 ? 0.05 : -0.04);
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  float l = dot(n, normalize(vec3(-0.35, 0.55, 1.0))) + fold;
  float ramp = 0.66 + 0.24 * smoothstep(0.45, 0.52, l) + 0.10 * smoothstep(0.86, 0.9, l);
  if (!gl_FrontFacing) ramp *= 0.82;
  gl_FragColor = vec4(col * ramp * uShade, 1.0);
  #include <colorspace_fragment>
}`;

/** fbm of simplex noise mapped to ~0..1 */
function fbm01(x: number, y: number, oct = 3) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * KNZ.n2(x * f, y * f);
    n += a;
    f *= 2.07;
    a *= 0.5;
  }
  return 0.5 + 0.5 * (s / n) * 1.4;
}
const sm = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/**
 * bake a note's parchment: aged colour, fibres, foxing, a dried coffee ring,
 * a charred corner, the browned rim and the deckled torn edge (alpha)
 */
function paperBase(w: number, h: number, seed: number, coffee: [number, number, number], scorch: [number, number]) {
  const R = 1.5;
  const W = Math.max(8, Math.round(w * R)), H = Math.max(8, Math.round(h * R));
  const data = new Uint8Array(W * H * 4);
  const asp = w / h;
  const o = seed * 97.3;
  const mixv = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W, v = (j + 0.5) / H;
      const edge = Math.min(Math.min(u, 1 - u) * asp, Math.min(v, 1 - v));
      const tear = 0.012 + fbm01(u * 19 + o, v * 19) * 0.026;
      const k = (j * W + i) * 4;
      if (edge < tear - 0.004) {
        data[k + 3] = 0;
        continue;
      }
      let c = mixv([0.94, 0.86, 0.69], [0.8, 0.66, 0.46], sm(0.25, 0.85, fbm01(u * 4 + o, v * 3)));
      const fib = 0.94 + 0.06 * (0.5 + 0.5 * KNZ.n2(u * 150 + o, v * 34));
      c = [c[0] * fib, c[1] * fib, c[2] * fib];
      c = mixv(c, [0.64, 0.43, 0.24], sm(0.66, 0.84, fbm01(u * 12 + 7 + o, v * 12 + 7)) * 0.4);
      // coffee: a dried ring with a darker lip, a faint pool and a second partial ring
      const cd = Math.hypot((u - coffee[0]) * asp, v - coffee[1]);
      const wob = (fbm01(u * 9 + o, v * 9) - 0.5) * 0.02;
      const ring = Math.exp(-(((cd - coffee[2] - wob) / 0.01) ** 2));
      const pool = sm(coffee[2] + wob, coffee[2] - 0.03, cd) * 0.16;
      const cd2 = Math.hypot((u - coffee[0] - 0.05) * asp, v - coffee[1] + 0.07);
      const ring2 = Math.exp(-(((cd2 - coffee[2] * 0.9 - wob) / 0.008) ** 2)) * (u > coffee[0] + 0.02 ? 1 : 0);
      c = mixv(c, [0.42, 0.24, 0.1], clamp01(Math.min(0.65, ring * 0.5 + ring2 * 0.32 + pool)));
      // browned rim and a charred corner
      const rim = sm(tear + 0.05, tear, edge);
      c = mixv(c, [0.4, 0.23, 0.1], rim * 0.65);
      const sc = sm(0.55, 0, Math.hypot((u - scorch[0]) * asp, v - scorch[1]) + (fbm01(u * 7 + o, v * 7) - 0.5) * 0.35);
      c = mixv(c, [0.3, 0.15, 0.06], sc * 0.55);
      c = mixv(c, [0.08, 0.04, 0.02], sc * sm(tear + 0.09, tear + 0.01, edge));
      data[k] = Math.round(clamp01(c[0]) * 255);
      data[k + 1] = Math.round(clamp01(c[1]) * 255);
      data[k + 2] = Math.round(clamp01(c[2]) * 255);
      data[k + 3] = Math.round(sm(tear - 0.004, tear + 0.004, edge) * 255);
    }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ the nail
/** a hand-forged rosehead nail head, hammered facets, rust (4 voxels per HUD px, head faces +z) */
function nailModel() {
  const V = 4;
  const facets: [number, number, number][] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + 0.3, st = 0.62;
    facets.push([Math.cos(a) * st, Math.sin(a) * st, Math.cos(Math.asin(st))]);
  }
  const sd = (x: number, y: number, z: number) => {
    const X = x / V, Y = y / V, Z = z / V;
    if (Z < 0) return 1;
    // the domed rosehead: a 5-facet pyramid on a short neck
    let d = -9;
    const dent = 0.25 * fbm3(X * 1.3, Y * 1.3, 0.5);
    for (const [nx, ny, nz] of facets) d = Math.max(d, X * nx + Y * ny + Z * nz - 2.05 + dent);
    d = Math.max(d, len2(X, Y) - 3.3, -Z);
    return d * V;
  };
  const IRON = { base: 0x5a5250, shade: 0x3a3232, hi: 0x9a948c, rust: 0x8a4a22, rustL: 0xb8692e, dark: 0x22180f };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const n = fbm3(x * 0.12, y * 0.12, z * 0.12 + 3);
    const lit = s.nx * -0.4 + s.ny * 0.55 + s.nz * 0.73;
    let c = lit > 0.82 ? IRON.hi : lit > 0.5 ? IRON.base : IRON.shade;
    if (n > 0.05) c = mixc(c, n > 0.4 ? IRON.rustL : IRON.rust, clamp01((n - 0.05) * 1.6));
    if (s.exp < 0.3) c = mixc(c, IRON.dark, 0.5);
    if (s.exp > 0.55) c = mixc(c, IRON.hi, 0.4);
    return [mulc(c, 0.92 + h3(x, y, z, 9) * 0.14), METAL];
  };
  return { model: sculpt('mission_nail', [-14, -14, 0, 14, 14, 10], sd, paint), vs: 1 / V };
}

// ------------------------------------------------------------------ one note
const LH = 14; // line height (HUD px)
const PAD = 9;

interface Pt {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  pin: boolean;
}

type State = 'in' | 'pinned' | 'stamp' | 'tear' | 'burn' | 'gone';

let stampTex: THREE.CanvasTexture | null = null;
let stampAsp = 2.4;
function stampTexture() {
  if (stampTex) return stampTex;
  const cv = document.createElement('canvas');
  const fs = 64;
  const c = cv.getContext('2d')!;
  c.font = `${fs}px Alagard`;
  const w = Math.ceil(c.measureText('DONE').width) + 40;
  cv.width = w;
  cv.height = fs + 30;
  const c2 = cv.getContext('2d')!;
  c2.font = `${fs}px Alagard`;
  c2.textAlign = 'center';
  c2.textBaseline = 'middle';
  c2.fillStyle = '#b01810';
  c2.strokeStyle = '#b01810';
  c2.lineWidth = 5;
  c2.lineJoin = 'round';
  c2.strokeText('DONE', w / 2, cv.height / 2 + 4);
  c2.fillText('DONE', w / 2, cv.height / 2 + 4);
  stampAsp = w / cv.height;
  stampTex = new THREE.CanvasTexture(cv);
  stampTex.colorSpace = THREE.SRGBColorSpace;
  return stampTex;
}

class Note {
  q: PaperQuest;
  w = 140;
  h = 80;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  geo: THREE.PlaneGeometry;
  pts: Pt[] = [];
  springs: [number, number, number, number][] = [];
  state: State = 'in';
  st = 0;
  /** simulated seconds in this state (the cloth runs at most 1/30 s per frame) */
  simT = 0;
  /** seconds this quest has been missing from the HUD state */
  missing = 0;
  /** fan angle (rest pose rotation) and its target */
  ang = 0;
  angT = 0;
  /** ink */
  private cv = document.createElement('canvas');
  tex: THREE.CanvasTexture;
  private inkKey = '';
  private inkAge = 9;
  private lastCounts: number[] = [];
  private lastObjective = '';
  private progLine = -1;
  private progW = 0;
  strokeT = -1;
  checkT = -1;
  checked = false;
  ending: 'done' | 'fail' | 'quiet' | null = null;
  stamped = false;
  private compact = false;
  private seed = Math.random();
  private ownsTex: boolean;

  /** the baked parchment */
  base: THREE.DataTexture | null = null;
  private coffee: [number, number, number] = [0.18 + Math.random() * 0.6, 0.15 + Math.random() * 0.3, 0.1 + Math.random() * 0.05];
  private scorch: [number, number] = [Math.random() < 0.5 ? 0 : 1, Math.random() < 0.6 ? 0 : 1];

  constructor(q: PaperQuest, private nx: number, private ny: number, private rect = new THREE.Vector4(0, 0, 1, 1), ink?: { tex: THREE.CanvasTexture; base: THREE.DataTexture | null; w: number; h: number }) {
    this.q = q;
    this.ownsTex = !ink;
    this.tex = ink?.tex ?? new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter;
    if (ink) {
      this.w = ink.w * rect.z;
      this.h = ink.h * rect.w;
    }
    this.geo = new THREE.PlaneGeometry(1, 1, nx - 1, ny - 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        baseMap: { value: ink?.base ?? null },
        map: { value: this.tex },
        stampMap: { value: stampTexture() },
        uRect: { value: rect },
        uAspect: { value: 1.6 },
        uLocalAsp: { value: 1.6 },
        uSeed: { value: this.seed },
        uShade: { value: 1 },
        uStampXf: { value: new THREE.Vector4(0.6, 0.42, -0.22, 0.34) },
        uStamp: { value: new THREE.Vector2(0, 0) },
        uStampAsp: { value: stampAsp },
        uStroke: { value: new THREE.Vector4(0, 0, 0, 0) },
        uCheck: { value: new THREE.Vector3(0, 0, 0) },
        uHole: { value: new THREE.Vector2(0.5, 0.92) },
        uBurn: { value: new THREE.Vector3(0, 0, 0) },
        uRip: { value: 0 },
      },
      vertexShader: VS,
      fragmentShader: FS,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
  }

  // ---------------------------------------------------- ink
  /** lay the note out (HUD px) and rebuild its cloth if the size changed */
  setQuest(q: PaperQuest, compact: boolean, q2: number, force = false) {
    this.q = q;
    const title = q.title;
    const maxW = compact ? 180 : 214;
    const obj = wrapInk(q.objective, maxW - PAD * 2, 16, compact ? 1 : 2);
    const prog = q.progress ? wrapInk(q.progress, maxW - PAD * 2 - 11, 16, 1)[0] : '';
    const reward = compact || !q.reward ? '' : wrapInk(q.reward, maxW - PAD * 2, 16, 1)[0];
    const lines: { t: string; kind: 'title' | 'obj' | 'prog' | 'rew' }[] = [{ t: title, kind: 'title' }, ...obj.map((t) => ({ t, kind: 'obj' as const }))];
    if (prog) lines.push({ t: prog, kind: 'prog' });
    if (reward) lines.push({ t: reward, kind: 'rew' });
    let tw = 0;
    for (const l of lines) tw = Math.max(tw, measureInk(l.t, 16) + (l.kind === 'prog' ? 11 : 0));
    const w = Math.round(clamp(tw + PAD * 2, compact ? 104 : 128, maxW));
    const h = Math.round(PAD + 4 + lines.length * LH + 9 + (reward ? 2 : 0));
    const key = `${q2}|${w}|${h}|${lines.map((l) => l.t).join('|')}`;
    // progress counts going up / a new objective → stroke + check
    const counts = (prog.match(/(\d+)\s*\/\s*\d+/g) ?? []).map((m) => parseInt(m, 10));
    const up = counts.some((c, i) => this.lastCounts[i] !== undefined && c > this.lastCounts[i]);
    const newObj = this.lastObjective !== '' && this.lastObjective !== q.objective;
    if ((up || newObj) && this.state !== 'in') {
      this.strokeT = 0;
      this.checkT = -0.3;
      uiSfx('page_turn', 0.35, 1.3);
    }
    this.lastCounts = counts;
    this.lastObjective = q.objective;
    if (key === this.inkKey) return;
    // continuous readouts (metres, seconds) redraw at most a few times a second
    if (!force && this.inkAge < 0.25 && w === this.w && h === this.h && !(up || newObj)) return;
    this.inkKey = key;
    this.inkAge = 0;
    this.compact = compact;
    const resized = w !== this.w || h !== this.h || !this.pts.length;
    this.w = w;
    this.h = h;
    const W = w * q2, H = h * q2;
    if (this.cv.width !== W || this.cv.height !== H) {
      this.cv.width = W;
      this.cv.height = H;
      this.tex.dispose();
    }
    const c = this.cv.getContext('2d')!;
    c.clearRect(0, 0, W, H);
    let y = PAD + 4;
    this.progLine = -1;
    for (const l of lines) {
      if (l.kind === 'title') inkText(c, q2, { text: l.t, x: w / 2, y, color: '#5c160a', align: 'center', style: 'ink' });
      else if (l.kind === 'obj') inkText(c, q2, { text: l.t, x: PAD, y, color: '#33200e' });
      else if (l.kind === 'prog') {
        inkText(c, q2, { text: l.t, x: PAD + 11, y, color: '#6e1a0a' });
        this.progLine = y;
        this.progW = measureInk(l.t, 16);
      } else inkText(c, q2, { text: l.t, x: PAD, y: y + 2, color: '#6a5232' });
      y += LH;
      if (l.kind === 'title') y += 1;
    }
    this.tex.needsUpdate = true;
    const u = this.mat.uniforms;
    u.uAspect.value = w / h;
    u.uLocalAsp.value = (w * this.rect.z) / (h * this.rect.w);
    u.uHole.value.set(0.5, 1 - 7 / h);
    if (this.progLine >= 0) {
      const yv = 1 - (this.progLine + 13) / h;
      u.uStroke.value.set((PAD + 10) / w, (PAD + 12 + this.progW) / w, yv, u.uStroke.value.w);
      u.uCheck.value.set((PAD + 4) / w, 1 - (this.progLine + 6) / h, u.uCheck.value.z);
    }
    if (resized) {
      this.buildCloth();
      this.base?.dispose();
      this.base = paperBase(w, h, this.seed, this.coffee, this.scorch);
      u.baseMap.value = this.base;
    }
  }

  // ---------------------------------------------------- cloth
  buildCloth(start?: { x: number; y: number; rot: number }) {
    const NX = this.nx, NY = this.ny;
    const old = this.pts;
    this.pts = [];
    this.springs = [];
    const r = this.rect;
    // the full note's top sits 7 px above the nail; a scrap keeps its place in the note
    const fullW = this.w / r.z, fullH = this.h / r.w;
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const u = r.x + (i / (NX - 1)) * r.z, v = r.y + r.w - (j / (NY - 1)) * r.w;
        const rx = (u - 0.5) * fullW, ry = 7 - (1 - v) * fullH;
        let x = rx, y = ry;
        if (start) {
          const c = Math.cos(start.rot), s = Math.sin(start.rot);
          x = start.x + rx * c - ry * s;
          y = start.y + rx * s + ry * c;
        } else if (old.length === NX * NY) {
          const o = old[j * NX + i];
          x = o.x;
          y = o.y;
        }
        this.pts.push({ x, y, z: 0, px: x, py: y, pz: 0, rx, ry, pin: false });
      }
    const idx = (i: number, j: number) => j * NX + i;
    const link = (a: number, b: number, k: number) => {
      const A = this.pts[a], B = this.pts[b];
      this.springs.push([a, b, Math.hypot(A.rx - B.rx, A.ry - B.ry), k]);
    };
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        if (i < NX - 1) link(idx(i, j), idx(i + 1, j), 1);
        if (j < NY - 1) link(idx(i, j), idx(i, j + 1), 1);
        if (i < NX - 1 && j < NY - 1) {
          link(idx(i, j), idx(i + 1, j + 1), 0.6);
          link(idx(i + 1, j), idx(i, j + 1), 0.6);
        }
        if (i < NX - 2) link(idx(i, j), idx(i + 2, j), 0.3);
        if (j < NY - 2) link(idx(i, j), idx(i, j + 2), 0.3);
      }
  }

  /** pin the two points nearest the nail */
  pinToNail(on: boolean) {
    const byD = this.pts.map((p, i) => [Math.hypot(p.rx, p.ry), i]).sort((a, b) => a[0] - b[0]);
    for (const p of this.pts) p.pin = false;
    if (on) for (let k = 0; k < 2; k++) this.pts[byD[k][1]].pin = true;
  }

  centroid() {
    let x = 0, y = 0;
    for (const p of this.pts) {
      x += p.x;
      y += p.y;
    }
    return { x: x / this.pts.length, y: y / this.pts.length };
  }

  /** z offset this note keeps from the board (stacking) */
  step(dt: number, t: number, wind: number, zBase: number) {
    const sub = 3, h = Math.min(dt, 1 / 30) / sub;
    this.simT += h * sub;
    const c = Math.cos(this.ang), s = Math.sin(this.ang);
    const st = this.state;
    const free = st === 'tear' || st === 'gone';
    const homing = st === 'in' ? 140 : st === 'burn' ? 22 : 26;
    for (let it = 0; it < sub; it++) {
      for (let k = 0; k < this.pts.length; k++) {
        const p = this.pts[k];
        const tx = p.rx * c - p.ry * s, ty = p.rx * s + p.ry * c;
        if (p.pin) {
          p.x = p.px = tx;
          p.y = p.py = ty;
          p.z = p.pz = zBase;
          continue;
        }
        const i = k % this.nx, j = Math.floor(k / this.nx);
        const far = Math.min(1, Math.hypot(p.rx, p.ry) / 60);
        const turb = Math.sin(t * 5.3 + i * 0.8 + j * 0.55) * 0.6 + Math.sin(t * 8.7 - i * 0.9 + j * 0.4) * 0.4;
        let ax = 0, ay = 0, az = 0;
        if (free) {
          // ripped loose: the wind takes it up and away to the left
          ax = -900 + turb * 500;
          ay = 380 + Math.sin(t * 3 + j) * 300;
          az = turb * 160;
        } else {
          ax = (tx - p.x) * homing + turb * 40 * wind * far;
          ay = (ty - p.y) * homing - 40 + Math.cos(t * 4.4 + i * 0.6) * 25 * wind * far;
          az = (zBase - p.z) * 30 + turb * 260 * wind * far;
        }
        const vmax = free ? 14 : 6;
        const vx = clamp((p.x - p.px) * 0.97, -vmax, vmax), vy = clamp((p.y - p.py) * 0.97, -vmax, vmax), vz = clamp((p.z - p.pz) * 0.9, -vmax, vmax);
        p.px = p.x;
        p.py = p.y;
        p.pz = p.z;
        p.x += vx + ax * h * h;
        p.y += vy + ay * h * h;
        p.z += vz + az * h * h;
        if (!free && p.z < zBase - 2) p.z = zBase - 2; // the board is behind it
      }
      for (let r = 0; r < 3; r++)
        for (const [a, b, rest, k] of this.springs) {
          const A = this.pts[a], B = this.pts[b];
          const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
          const d = Math.hypot(dx, dy, dz) || 1e-6;
          const diff = ((d - rest) / d) * 0.5 * k;
          const wa = A.pin ? 0 : 1, wb = B.pin ? 0 : 1;
          const sw = wa + wb || 1;
          A.x += dx * diff * (wa / sw) * 2;
          A.y += dy * diff * (wa / sw) * 2;
          A.z += dz * diff * (wa / sw) * 2;
          B.x -= dx * diff * (wb / sw) * 2;
          B.y -= dy * diff * (wb / sw) * 2;
          B.z -= dz * diff * (wb / sw) * 2;
        }
    }
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < this.pts.length; k++) pos.setXYZ(k, this.pts[k].x, this.pts[k].y, this.pts[k].z);
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  /** a shove out of the board (the slap of a stamp, a nail blow) */
  kick(z: number) {
    for (const p of this.pts) if (!p.pin) p.pz -= z * 0.12 * (0.5 + Math.random() * 0.5) * Math.min(1, Math.hypot(p.rx, p.ry) / 40);
  }

  tickAnims(dt: number) {
    this.inkAge += dt;
    const u = this.mat.uniforms;
    if (this.strokeT >= 0) {
      this.strokeT += dt;
      u.uStroke.value.w = clamp01(this.strokeT / 0.32);
    }
    if (this.checkT > -1) {
      this.checkT += dt;
      if (this.checkT > 0) {
        u.uCheck.value.z = clamp01(this.checkT / 0.25);
        this.checked = true;
      }
      if (this.checkT > 0.25) this.checkT = -1;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    if (this.ownsTex) {
      this.tex.dispose();
      this.base?.dispose();
    }
  }
}

// ------------------------------------------------------------------ the stack
export interface PaperAnchor {
  /** the right margin the notes keep to, and the nail height, HUD px */
  right: number;
  y: number;
  /** size factor (small screens) */
  k: number;
  /** compact layout (title + progress only) */
  compact: boolean;
  /** rider speed (m/s): the wind ruffles the note harder */
  speed: number;
}

export class MissionPaper {
  private group = new THREE.Group();
  private notes: Note[] = [];
  private scraps: { n: Note; t: number }[] = [];
  private nail: THREE.Mesh | null = null;
  private nailMat: VoxelMaterial;
  private nailT = 1;
  private nailShow = 0;
  private fx: PixelFx;
  private glow: PixelFx;
  private t = 0;
  private ended = new Map<string, 'done' | 'fail'>();
  /** bottom edge of the stack, HUD px (the toasts line up under it) */
  bottom = 0;
  /** the nail's x (HUD px): the top note hangs centred on it, clear of the right margin */
  private nailX = -1;

  constructor(private scene: THREE.Scene) {
    this.nailMat = makeVoxelMaterial({ fog: false });
    scene.add(this.group);
    this.fx = new PixelFx(300, false, 9);
    this.glow = new PixelFx(300, true, 9);
    scene.add(this.fx.points, this.glow.points);
  }

  /** a quest ended for sure: stamp it DONE (ok) or burn it (failed) */
  end(id: string, ok: boolean) {
    this.ended.set(id, ok ? 'done' : 'fail');
  }

  private ensureNail() {
    if (this.nail) return;
    try {
      const n = nailModel();
      this.nail = new THREE.Mesh(buildVoxelGeometry(n.model, { voxelSize: n.vs, pivot: [0, 0, 0] }), this.nailMat);
      this.nail.renderOrder = 6;
      this.group.add(this.nail);
    } catch (e) {
      console.warn('[paper] nail failed', e);
    }
  }

  update(dt: number, quests: PaperQuest[], pa: PaperAnchor, visible: boolean, s: number, recent: { text: string; age: number }[]) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const k = pa.k;
    const topW = this.notes.find((n) => !n.ending)?.w ?? 150;
    const want = pa.right - (topW / 2 + 2) * k;
    this.nailX = this.nailX < 0 ? want : this.nailX + (want - this.nailX) * Math.min(1, dt * 5);
    const a = { ...pa, x: this.nailX };
    const q2 = Math.max(1, Math.round(s * k));
    // ---------------------------------------------------- sync with the quest list
    for (const q of quests) {
      let n = this.notes.find((x) => x.q.id === q.id && !x.ending);
      if (!n) {
        n = new Note(q, 11, 9);
        n.setQuest(q, a.compact, q2, true);
        // blown in from off the right edge, tumbling
        n.buildCloth({ x: 90 + Math.random() * 40, y: -20 - Math.random() * 30, rot: 0.7 + Math.random() * 0.4 });
        n.state = 'in';
        n.st = 0;
        this.notes.unshift(n);
        this.group.add(n.mesh);
        this.ended.delete(q.id);
        uiSfx('paper_flutter', 0.6, 1.1);
      } else {
        n.missing = 0;
        n.setQuest(q, a.compact, q2);
      }
    }
    for (const n of this.notes) {
      if (n.ending) continue;
      const present = quests.some((q) => q.id === n.q.id);
      if (present) continue;
      n.missing += dt;
      const ex = this.ended.get(n.q.id);
      const hit = recent.find((r) => r.age < 2.5 && (SUCCESS.test(r.text) || FAILURE.test(r.text)));
      const verdict = ex ?? (hit ? (FAILURE.test(hit.text) && !SUCCESS.test(hit.text) ? 'fail' : 'done') : null);
      if (verdict && n.missing > 0.05) this.finish(n, verdict);
      else if (n.missing > 2.5) this.finish(n, 'quiet');
    }
    // ---------------------------------------------------- the nail
    const live = this.notes.filter((n) => n.state !== 'gone');
    const anyPinned = live.some((n) => n.state !== 'tear');
    this.nailShow += ((anyPinned || this.scraps.length ? 1 : 0) - this.nailShow) * Math.min(1, dt * 8);
    this.nailT = Math.min(1, this.nailT + dt / 0.11);
    this.group.visible = visible;
    this.group.position.set(a.x * s, -a.y * s, 0);
    this.group.scale.set(s * k, s * k, s * k);
    if (anyPinned || this.scraps.length) this.ensureNail();
    if (this.nail) {
      const drive = this.nailT < 1 ? 1 - this.nailT : 0;
      const bounce = this.nailT >= 1 ? 0 : Math.sin(this.nailT * Math.PI) * 0.15;
      this.nail.visible = this.nailShow > 0.05;
      this.nail.position.set(0, 0, 14 + drive * 18);
      this.nail.scale.setScalar(Math.max(0.01, this.nailShow) * (1 + drive * 0.7 + bounce));
      this.nail.rotation.set(0.25, -0.3, 0.4 + drive * 1.2);
    }
    // ---------------------------------------------------- notes
    const wind = 0.22 + clamp((a.speed - 5) / 22, 0, 1) * 1.25;
    let order = 0;
    let bottom = a.y;
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      n.st += dt;
      n.tickAnims(dt);
      const idx = n.ending ? 0 : order++;
      n.angT = idx === 0 ? -0.03 : idx === 1 ? 0.1 : idx === 2 ? -0.13 : 0.16;
      n.ang += (n.angT - n.ang) * Math.min(1, dt * 5);
      const hidden = idx > 2 && !n.ending;
      n.mesh.visible = !hidden;
      n.mesh.renderOrder = n.ending ? 5 : 4 - Math.min(3, idx) * 0.5;
      n.mat.uniforms.uShade.value = n.ending ? 1 : 1 - Math.min(2, idx) * 0.1;
      const zBase = n.ending ? 6 : 4 - idx * 2;
      this.advance(n, dt, a);
      if (!hidden) n.step(dt, this.t + i * 1.7, n.state === 'in' ? 1.5 : wind, zBase);
      if (!n.ending && idx < 3) bottom = Math.max(bottom, a.y + (n.h - 7) * k + 6);
    }
    for (let i = this.notes.length - 1; i >= 0; i--)
      if (this.notes[i].state === 'gone') {
        this.notes[i].dispose();
        this.notes.splice(i, 1);
      }
    // ---------------------------------------------------- scraps left on the nail
    for (let i = this.scraps.length - 1; i >= 0; i--) {
      const sc = this.scraps[i];
      sc.t += dt;
      if (sc.t > 2.6 && sc.n.state !== 'tear') {
        sc.n.state = 'tear';
        sc.n.pinToNail(false);
      }
      sc.n.step(dt, this.t, wind * 1.5, 7);
      if (sc.t > 4.5) {
        sc.n.dispose();
        this.scraps.splice(i, 1);
      }
    }
    this.bottom = bottom;
    this.fx.update(dt, s);
    this.glow.update(dt, s);
  }

  private advance(n: Note, dt: number, a: PaperAnchor & { x: number }) {
    const k = a.k;
    if (n.state === 'in') {
      const c = n.centroid();
      const restY = 7 - n.h / 2;
      if (n.simT > 0.5 || (n.simT > 0.25 && Math.hypot(c.x, c.y - restY) < 6)) {
        // slap! the nail is driven through it
        n.state = 'pinned';
        n.st = 0;
        n.simT = 0;
        n.pinToNail(true);
        n.kick(10);
        this.nailT = 0;
        uiSfx('poster_slam', 0.55, 1.15);
        uiSfx('rev_hammer', 0.5, 0.6);
        for (let i = 0; i < 14; i++) {
          const ang = Math.random() * TAU, v = 20 + Math.random() * 50;
          this.fx.emit({ x: a.x + Math.cos(ang) * 3 * k, y: a.y + Math.sin(ang) * 3 * k, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v * 0.6 - 10, ay: 90, drag: 2.5, life: 0.4 + Math.random() * 0.4, size: Math.random() < 0.3 ? 2 : 1, c0: 0xd8c09a, c1: 0x8a7050, alpha: 0.85 });
        }
        for (let i = 0; i < 4; i++) this.glow.emit({ x: a.x, y: a.y, vx: (Math.random() - 0.5) * 80, vy: -Math.random() * 60, ay: 200, drag: 1, life: 0.25 + Math.random() * 0.15, size: 1, c0: 0xffe8b0, c1: 0xff8a3a, alpha: 1 });
      }
    } else if (n.state === 'stamp') {
      const u = n.mat.uniforms;
      const sl = clamp01(n.simT / 0.13);
      u.uStamp.value.set(sl, 1);
      if (sl >= 1 && !n.stamped) {
        n.stamped = true;
        n.kick(7);
        uiSfx('poster_slam', 0.7, 1.35);
        uiSfx('counter_clang', 0.25, 1.6);
        const c = this.noteScreen(n, a, u.uStampXf.value.x, u.uStampXf.value.y);
        for (let i = 0; i < 18; i++) {
          const ang = Math.random() * TAU, v = 30 + Math.random() * 60;
          this.fx.emit({ x: c.x + Math.cos(ang) * 14 * k, y: c.y + Math.sin(ang) * 6 * k, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v * 0.5, ay: 140, drag: 2, life: 0.35 + Math.random() * 0.3, size: 1, c0: 0xc42a1a, c1: 0x6a0e08, alpha: 0.9 });
        }
      }
      if (n.simT > 1.35) this.rip(n, a);
    } else if (n.state === 'burn') {
      const u = n.mat.uniforms;
      const b = clamp01(n.simT / 1.7);
      u.uBurn.value.z = b;
      // embers and smoke off the burning front
      const ox = u.uBurn.value.x, oy = u.uBurn.value.y;
      const front = (b * 1.6 - 0.16) / 0.85;
      for (let i = 0; i < 3; i++) {
        const ang = Math.random() * TAU;
        const uu = ox + Math.cos(ang) * front / (n.w / n.h), vv = oy + Math.sin(ang) * front;
        if (uu < 0.03 || uu > 0.97 || vv < 0.03 || vv > 0.97) continue;
        const c = this.noteScreen(n, a, uu, vv);
        this.glow.emit({ x: c.x, y: c.y, vx: (Math.random() - 0.5) * 20 - 10, vy: -25 - Math.random() * 30, ay: -20, drag: 0.8, life: 0.4 + Math.random() * 0.6, size: 1, c0: 0xffd070, c1: 0xff4a10, alpha: 1, flick: 0.6 });
        if (Math.random() < 0.4) this.fx.emit({ x: c.x, y: c.y, vx: -6 + (Math.random() - 0.5) * 10, vy: -16 - Math.random() * 10, drag: 0.6, life: 0.8 + Math.random() * 0.6, size: 1, size1: 3, c0: 0x4a3a30, c1: 0x2a2420, alpha: 0.45, curl: 5 });
      }
      if (n.simT > 1.75) n.state = 'gone';
    } else if (n.state === 'tear') {
      const c = n.centroid();
      if (n.simT > 2.2 || c.x < -a.x / a.k - n.w || c.y > 40 + a.y / a.k) n.state = 'gone';
    }
  }

  /** a point of a pinned note in HUD px (approximate: uses its current cloth) */
  private noteScreen(n: Note, a: PaperAnchor & { x: number }, u: number, v: number) {
    const NX = 11, NY = 9;
    const i = Math.round(clamp01(u) * (NX - 1)), j = Math.round((1 - clamp01(v)) * (NY - 1));
    const p = n.pts[j * NX + i] ?? { x: 0, y: 0 };
    return { x: a.x + p.x * a.k, y: a.y - p.y * a.k };
  }

  private finish(n: Note, kind: 'done' | 'fail' | 'quiet') {
    n.ending = kind;
    n.st = 0;
    this.ended.delete(n.q.id);
    if (kind === 'done') {
      // the stamp hits the paper's lower-right; finish the pending check
      n.state = 'stamp';
      n.simT = 0;
      const u = n.mat.uniforms;
      u.uStampXf.value.set(0.6, 0.38, -0.2 - Math.random() * 0.12, Math.min(0.56, 44 / n.h));
      if (n.mat.uniforms.uCheck.value.z <= 0 && n.mat.uniforms.uStroke.value.x > 0) {
        n.strokeT = 0;
        n.checkT = 0;
      }
    } else if (kind === 'fail') {
      n.state = 'burn';
      n.simT = 0;
      n.mat.uniforms.uBurn.value.set(Math.random() < 0.5 ? 0.05 : 0.95, 0.04, 0.001);
      uiSfx('dynamite_fuse', 0.35, 0.8);
    } else this.rip(n, null);
  }

  /** the wind rips the note off the nail; a torn scrap stays behind */
  private rip(n: Note, a: (PaperAnchor & { x: number }) | null) {
    n.state = 'tear';
    n.st = 0;
    n.simT = 0;
    n.pinToNail(false);
    n.kick(-12);
    n.mat.uniforms.uRip.value = 1;
    uiSfx('paper_flutter', 0.8, 0.95);
    // the scrap: the strip of paper round the nail hole
    const hv = n.mat.uniforms.uHole.value.y;
    const rect = new THREE.Vector4(0.42, hv - 0.09, 0.16, Math.min(1 - (hv - 0.09), 0.2));
    const sc = new Note(n.q, 4, 3, rect, { tex: n.tex, base: n.base, w: n.w, h: n.h });
    sc.mat.uniforms.uAspect.value = n.w / n.h;
    sc.mat.uniforms.uLocalAsp.value = (n.w * rect.z) / (n.h * rect.w);
    sc.mat.uniforms.uSeed.value = Math.random();
    sc.mat.uniforms.uHole.value.copy(n.mat.uniforms.uHole.value);
    sc.buildCloth();
    sc.ang = n.ang;
    sc.pinToNail(true);
    sc.state = 'pinned';
    sc.mesh.renderOrder = 5.5;
    this.group.add(sc.mesh);
    this.scraps.push({ n: sc, t: 0 });
    void a;
  }

  dispose() {
    for (const n of this.notes) n.dispose();
    for (const s of this.scraps) s.n.dispose();
    this.group.removeFromParent();
    this.fx.dispose();
    this.glow.dispose();
    void this.scene;
    void lerp;
  }
}
