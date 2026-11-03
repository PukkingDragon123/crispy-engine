// Choices as scenes in the world (mission offers, trail encounters, the escort,
// the saloon's cards). Choice.show() keeps its old promise API, but nothing drops
// in front of the camera any more: cine/Stage.ts sets the scene a few metres
// ahead - the speaker as a rigged NPC, set dressing, an opener explosion - and
// lays the options out as physical things (notices shot to a wanted board, the
// items on offer, words scratched in the sand, cards on a crate table). The
// camera pushes in on whatever you hover; 1-N, a click or a tap picks. Callers
// may call stage(spec) right before show() to direct the scene.
// The notices are real paper in a shader: fibres, foxing, a sun-browned and
// scorched torn edge, a bullet hole where it was shot to the post, a slight
// curl in the geometry, and rubber-stamp ink with uneven pressure. Only the
// Alagard typography is drawn into a canvas.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Input } from '../../engine/Input';
import { ChoiceStage, type StageSpec } from '../cine/Stage';
import { cineFlags } from '../cine/CineKit';

export interface ChoiceOption {
  title: string;
  body: string;
  footer?: string;
  accent?: string;
  /** big rubber stamp across the card (e.g. 'WANTED', 'DEAL') */
  stamp?: string;
  /** staged choices: the item on offer (a model key: 'canteen', 'item_snakeoil', 'gold_coin'...) */
  prop?: string;
  /** staged choices: the word scratched into the sand for this option */
  mark?: string;
}

/**
 * Shared aged-paper GLSL (fragment). Needs `uniform float uSeed` (declared here).
 * paperEdge/paperTear give the torn outline, parchment() the sRGB paper colour,
 * bulletHole() returns 0 inside the hole (discard) and scorches the paper around
 * it, rubberStamp() returns the ink coverage of a framed stamp with a word map.
 */
export const PARCHMENT_GLSL = /* glsl */ `
uniform float uSeed;
float pHash(vec2 p){ p = fract(p * vec2(123.34, 456.21) + uSeed * 17.31); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float pNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), f.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float pFbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * pNoise(p); p = p * 2.07 + 1.3; a *= 0.5; } return s; }
float paperEdge(vec2 uv, float aspect){ vec2 e = min(uv, 1.0 - uv); return min(e.x * aspect, e.y); }
float paperTear(vec2 uv, float amt){ return 0.006 + pFbm(uv * 19.0) * amt; }
vec3 parchment(vec2 uv, float aspect, float edge, float tear){
  vec2 q = uv * vec2(aspect, 1.0);
  vec3 col = mix(vec3(0.93, 0.85, 0.68), vec3(0.84, 0.73, 0.53), smoothstep(0.3, 0.85, pFbm(q * 4.0)));
  col *= 0.95 + 0.05 * pFbm(q * vec2(150.0, 40.0));
  float fox = smoothstep(0.68, 0.88, pFbm(q * 8.0 + 7.0));
  col = mix(col, vec3(0.66, 0.47, 0.27), fox * 0.32);
  col *= 1.0 - 0.16 * step(0.993, pHash(floor(q * 240.0)));
  float rim = smoothstep(tear + 0.075, tear, edge);
  col = mix(col, vec3(0.55, 0.36, 0.18), rim * 0.6);
  float burn = smoothstep(tear + 0.02, tear, edge);
  return mix(col, vec3(0.2, 0.1, 0.05), burn * 0.88);
}
float bulletHole(vec2 uv, float aspect, vec2 at, float r, inout vec3 col){
  vec2 d = (uv - at) * vec2(aspect, 1.0);
  float l = length(d);
  float ang = atan(d.y, d.x);
  float jag = r * (0.42 + 0.14 * pNoise(vec2(ang * 3.0, 1.7)));
  if (l < jag) return 0.0;
  float burn = smoothstep(jag * 3.4, jag, l);
  float cracks = smoothstep(0.74, 1.0, pNoise(vec2(ang * 7.0, l * 34.0))) * smoothstep(r * 2.8, r * 0.6, l);
  col = mix(col, vec3(0.15, 0.08, 0.04), clamp(burn * 0.85 + cracks * 0.55, 0.0, 1.0));
  return 1.0;
}
float rubberStamp(vec2 uv, float aspect, vec4 rect, float ang, sampler2D word){
  vec2 sp = (uv - rect.xy) * vec2(aspect, 1.0);
  float c = cos(ang), s = sin(ang);
  vec2 q = vec2(c * sp.x + s * sp.y, -s * sp.x + c * sp.y);
  vec2 hs = rect.zw;
  vec2 dd = abs(q) - hs;
  float box = max(dd.x, dd.y);
  float th = hs.y * 0.09;
  float aa = 0.0016;
  float frame = 1.0 - smoothstep(0.0, aa, abs(box + th * 0.5) - th * 0.5);
  frame = max(frame, 1.0 - smoothstep(0.0, aa, abs(box + th * 2.4) - th * 0.22));
  vec2 suv = q / (hs * 2.0) + 0.5;
  float w = (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) ? texture2D(word, suv).a : 0.0;
  float press = smoothstep(0.28, 0.62, pFbm(q * 26.0 + 3.0)) * 0.55 + 0.45;
  float pins = step(0.2, pNoise(q * 190.0));
  return max(frame, w) * press * mix(1.0, pins, 0.6);
}
`;

const NOTICE_VS = /* glsl */ `
varying vec2 vUv; varying vec3 vN;
void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const NOTICE_FS = /* glsl */ `
uniform sampler2D map, uStampMap;
uniform float uAspect, uOpacity, uHasStamp, uStampAng;
uniform vec4 uStampRect;
uniform vec3 uStampCol;
varying vec2 vUv; varying vec3 vN;
${PARCHMENT_GLSL}
void main(){
  float edge = paperEdge(vUv, uAspect);
  float tear = paperTear(vUv, 0.03);
  if (edge < tear) discard;
  vec3 col = parchment(vUv, uAspect, edge, tear);
  if (bulletHole(vUv, uAspect, vec2(0.5, 0.955), 0.024, col) < 0.5) discard;
  vec3 lin = pow(col, vec3(2.2));
  vec4 ink = texture2D(map, vUv);
  float press = 0.82 + 0.18 * smoothstep(0.2, 0.6, pNoise(vUv * vec2(uAspect, 1.0) * 220.0));
  lin = mix(lin, ink.rgb * mix(vec3(1.0), lin * 1.1, 0.2), ink.a * press);
  if (uHasStamp > 0.5) {
    float st = rubberStamp(vUv, uAspect, uStampRect, uStampAng, uStampMap);
    lin = mix(lin, uStampCol * mix(vec3(1.0), lin, 0.25), st * 0.82);
  }
  // the curl catches the light
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  float l = 0.8 + 0.2 * clamp(dot(n, normalize(vec3(-0.3, 0.5, 1.0))), 0.0, 1.0);
  gl_FragColor = vec4(lin * l, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const NW = 0.74, NH = 1.02;

function wrap(c: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (c.measureText(t).width > maxW && line) {
        out.push(line);
        line = w;
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

function canvasTexture(cv: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** the notice's typography (transparent canvas; the paper is the shader) */
export function paintNotice(o: ChoiceOption, W = 512, H = 704) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  const ink = '#2a1a10';
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.fillStyle = o.accent ?? '#8a2a18';
  c.font = '64px Alagard';
  let y = 72;
  for (const l of wrap(c, o.title.toUpperCase(), W - 72)) {
    c.fillText(l, W / 2, y);
    y += 60;
  }
  // the rule under the title, set in type
  c.fillStyle = ink;
  c.font = '32px Alagard';
  c.fillText('~  *  ~', W / 2, y + 2);
  y += 46;
  for (const l of wrap(c, o.body, W - 80)) {
    c.fillText(l, W / 2, y);
    y += 38;
  }
  if (o.footer) {
    c.fillStyle = '#5a3a1a';
    const fl = wrap(c, o.footer, W - 80);
    let fy = H - 64 - (fl.length - 1) * 36;
    for (const l of fl) {
      c.fillText(l, W / 2, fy);
      fy += 36;
    }
  }
  return canvasTexture(cv);
}

/** the stamp's word (white glyphs; the shader inks, frames and presses it) */
function paintStampWord(word: string) {
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = '64px Alagard';
  const tw = Math.ceil(m.measureText(word).width);
  const cv = document.createElement('canvas');
  cv.width = tw + 48;
  cv.height = 88;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.font = '64px Alagard';
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(word, cv.width / 2, cv.height / 2 + 3);
  return { tex: canvasTexture(cv), w: cv.width, h: cv.height };
}

let blankTex: THREE.DataTexture | null = null;
function blank() {
  if (!blankTex) {
    blankTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    blankTex.needsUpdate = true;
  }
  return blankTex;
}

function noticeMaterial(o: ChoiceOption, W = 512, H = 704) {
  const stamp = o.stamp ? paintStampWord(o.stamp) : null;
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: paintNotice(o, W, H) },
      uStampMap: { value: stamp?.tex ?? blank() },
      uHasStamp: { value: stamp ? 1 : 0 },
      // centre (uv), half size (in sheet heights) and tilt, as the old stamp sat
      uStampRect: { value: new THREE.Vector4(0.5, 0.38, stamp ? stamp.w / 2 / H : 0.1, stamp ? stamp.h / 2 / H : 0.05) },
      uStampAng: { value: 0.22 },
      uStampCol: { value: new THREE.Color('#b02a1a') },
      uAspect: { value: NW / NH },
      uOpacity: { value: 1 },
      uSeed: { value: Math.random() },
    },
    vertexShader: NOTICE_VS,
    fragmentShader: NOTICE_FS,
    transparent: true,
    // a sheet in the world: hidden behind whatever stands in front of it, and
    // writing its depth so the ink-outline pass outlines the paper
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

/** a sheet hanging from its bullet hole: the sides bow back, the bottom corners lift */
function noticeGeometry() {
  const g = new THREE.PlaneGeometry(NW, NH, 8, 12);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const bow = 0.008 + Math.random() * 0.008, lift = 0.02 + Math.random() * 0.02, twist = (Math.random() - 0.5) * 0.02;
  for (let i = 0; i < pos.count; i++) {
    const xn = pos.getX(i) / (NW / 2), yn = pos.getY(i) / (NH / 2);
    const low = Math.pow((1 - yn) / 2, 2.5);
    pos.setZ(i, -bow * xn * xn + lift * low * (0.55 + 0.45 * xn * xn) + twist * xn * low);
  }
  g.computeVertexNormals();
  return g;
}

function disposeCard(m: THREE.Mesh) {
  const mat = m.material as THREE.ShaderMaterial;
  (mat.uniforms.map.value as THREE.Texture | null)?.dispose();
  if (mat.uniforms.uStampMap.value !== blankTex) (mat.uniforms.uStampMap.value as THREE.Texture | null)?.dispose();
  mat.dispose();
  m.geometry.dispose();
}

/** a paper notice as a mesh (the stage nails it to a board or lays it on a table) */
export function noticeMesh(o: ChoiceOption) {
  const m = new THREE.Mesh(noticeGeometry(), noticeMaterial(o));
  m.castShadow = true;
  return m;
}
void disposeCard;

export class Choice {
  /** a choice is on screen (the world is paused) */
  active = false;
  private pending: StageSpec | null = null;
  private current: ChoiceStage | null = null;
  private lingering: ChoiceStage[] = [];
  private last: ChoiceStage | null = null;

  constructor(private ctx: Ctx, private input: Input) {}

  /** direct the next show(): who speaks, what stands around, how the options are laid out */
  stage(spec: StageSpec) {
    this.pending = spec;
    return this;
  }

  show(heading: string, options: ChoiceOption[], canCancel = true): Promise<number> {
    const ctx = this.ctx;
    const eng = ctx.engine;
    const spec = this.pending ?? {};
    this.pending = null;
    this.current?.dispose();
    this.active = true;
    cineFlags.choice = true;
    eng.paused = true;
    eng.input.setWantLock(false);
    return new Promise((res) => {
      const done = (i: number) => {
        this.active = false;
        cineFlags.choice = false;
        eng.paused = false;
        eng.input.setWantLock(true);
        if (this.current) {
          this.lingering.push(this.current);
          this.last = this.current;
        }
        this.current = null;
        res(i);
      };
      try {
        this.current = new ChoiceStage(ctx, this.input, spec, heading, options, canCancel, noticeMesh, done);
      } catch (e) {
        console.error('[choice] stage failed', e);
        this.current = null;
        done(canCancel ? -1 : 0);
      }
    });
  }

  /** where the last scene's actors stand (to swap staged outlaws for real ones) */
  stageActors(): THREE.Vector3[] {
    return this.last?.actorSpots() ?? [];
  }
  /** the last scene's actors vanish in a puff of dust */
  dismissActors() {
    this.last?.dismissActors();
  }

  dispose() {
    this.current?.dispose();
    for (const s of this.lingering) s.dispose();
    this.lingering = [];
    this.current = null;
    cineFlags.choice = false;
  }

  update(rdt: number) {
    const c = this.current;
    if (c) {
      try {
        c.update(rdt);
      } catch (e) {
        console.error('[choice] stage update failed', e);
        c.dispose();
        if (this.current === c) {
          this.current = null;
          this.active = false;
          cineFlags.choice = false;
          this.ctx.engine.paused = false;
          this.ctx.engine.input.setWantLock(true);
        }
      }
    }
    for (let i = this.lingering.length - 1; i >= 0; i--) {
      const s = this.lingering[i];
      s.update(rdt);
      if (s.phase === 'gone') this.lingering.splice(i, 1);
    }
  }
}
