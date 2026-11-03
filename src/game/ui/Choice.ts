// Parchment notices that drop in front of the camera (mission offers, outlaw
// encounters, choice events). Hover tilts toward the cursor, click or 1-4 picks.
// Pauses the world while open.
// The sheet is real paper in a shader: fibres, foxing, a sun-browned and
// scorched torn edge, a bullet hole where it was shot to the post, a slight
// curl in the geometry, and rubber-stamp ink with uneven pressure. Only the
// Alagard typography is drawn into a canvas.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Input } from '../../engine/Input';
import { Ease } from '../../engine/Tween';
import { damp } from '../../engine/math/rand';

export interface ChoiceOption {
  title: string;
  body: string;
  footer?: string;
  accent?: string;
  /** big rubber stamp across the card (e.g. 'WANTED', 'DEAL') */
  stamp?: string;
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
    depthTest: false,
    // the sheet writes its depth so the ink-outline pass outlines the paper,
    // not the world behind it
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

interface Card {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  hover: number;
  ready: boolean;
  tx: number;
  ty: number;
}

export class Choice {
  active = false;
  private group = new THREE.Group();
  private cards: Card[] = [];
  private ray = new THREE.Raycaster();
  private hovered: Card | null = null;
  private resolve: ((i: number) => void) | null = null;
  private hint: HTMLDivElement;

  constructor(private ctx: Ctx, private input: Input) {
    ctx.scene.add(this.group);
    this.hint = document.createElement('div');
    this.hint.style.cssText = "position:absolute;left:50%;top:7vh;transform:translateX(-50%);font-family:'Alagard';font-size:26px;color:#fff3d6;text-shadow:0 3px 0 #2a1810,0 0 12px #000;z-index:7;pointer-events:none;display:none;letter-spacing:1px;text-align:center";
    ctx.engine.overlay.appendChild(this.hint);
  }

  show(heading: string, options: ChoiceOption[], canCancel = true): Promise<number> {
    const ctx = this.ctx;
    const eng = ctx.engine;
    this.active = true;
    this.cancelable = canCancel;
    eng.paused = true;
    eng.audio.setMuffle(0.45);
    eng.input.setWantLock(false);
    this.hint.innerHTML = `${heading}<div style="font-size:15px;opacity:.8;margin-top:6px">click or press 1-${options.length}${canCancel ? ' · ESC to walk away' : ''}</div>`;
    this.hint.style.display = 'block';
    ctx.sfx('paper_flutter', null, 0.8);
    const cam = ctx.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const center = cam.position.clone().addScaledVector(fwd, 2.1).addScaledVector(up, -0.05);
    const spacing = options.length > 2 ? 0.86 : 0.95;
    this.cards = options.map((o, i) => {
      const mesh = new THREE.Mesh(noticeGeometry(), noticeMaterial(o));
      mesh.renderOrder = 999;
      const home = center.clone().addScaledVector(right, (i - (options.length - 1) / 2) * spacing);
      const start = home.clone().addScaledVector(up, 1.6).addScaledVector(right, (i - 1) * 0.4);
      mesh.position.copy(start);
      mesh.quaternion.copy(cam.quaternion);
      this.group.add(mesh);
      const card: Card = { mesh, home, hover: 0, ready: false, tx: 0, ty: 0 };
      eng.tweens.run(0.6, (k) => {
        mesh.position.lerpVectors(start, home, k);
        mesh.quaternion.copy(cam.quaternion);
        mesh.rotateZ((1 - k) * (i % 2 ? 0.6 : -0.6));
      }, Ease.outBack, { real: true, delay: 0.08 + i * 0.12, done: () => (card.ready = true) });
      eng.tweens.after(0.08 + i * 0.12, () => ctx.sfx('card_flip', null, 0.5, 0.9 + i * 0.08), true);
      return card;
    });
    return new Promise((res) => (this.resolve = res));
  }
  private cancelable = true;

  private pick(i: number) {
    if (!this.resolve) return;
    const ctx = this.ctx;
    const eng = ctx.engine;
    const res = this.resolve;
    this.resolve = null;
    this.hint.style.display = 'none';
    ctx.sfx(i >= 0 ? 'poster_slam' : 'paper_flutter', null, 0.8);
    this.cards.forEach((c, k) => {
      const from = c.mesh.position.clone();
      const to = from.clone().add(new THREE.Vector3(0, k === i ? 0.4 : -2.2, 0));
      const u = (c.mesh.material as THREE.ShaderMaterial).uniforms;
      eng.tweens.run(k === i ? 0.35 : 0.45, (t) => {
        c.mesh.position.lerpVectors(from, to, t);
        if (k === i) c.mesh.scale.setScalar(1 + t * 0.15);
        u.uOpacity.value = k === i ? 1 - t : 1;
      }, Ease.inQuad, {
        real: true,
        done: () => {
          this.group.remove(c.mesh);
          disposeCard(c.mesh);
        },
      });
    });
    eng.tweens.after(0.45, () => {
      this.active = false;
      eng.paused = false;
      eng.audio.setMuffle(0);
      eng.input.setWantLock(true);
      this.cards = [];
      res(i);
    }, true);
  }

  dispose() {
    this.hint.remove();
  }

  update(rdt: number) {
    if (!this.active || !this.resolve) return;
    const inp = this.input;
    const cam = this.ctx.camera;
    const ready = this.cards.every((c) => c.ready);
    for (let i = 0; i < this.cards.length; i++) if (ready && inp.wasPressed('Digit' + (i + 1))) return this.pick(i);
    if (this.cancelable && ready && inp.wasPressed('Escape')) return this.pick(-1);
    this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), cam);
    const hits = this.ray.intersectObjects(this.cards.map((c) => c.mesh), false);
    const h = hits.length ? this.cards.find((c) => c.mesh === hits[0].object) ?? null : null;
    if (h !== this.hovered) {
      if (h) this.ctx.sfx('card_hover', null, 0.5);
      this.hovered = h;
    }
    if (inp.wasPressed('Mouse0') && h && ready) return this.pick(this.cards.indexOf(h));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    for (const c of this.cards) {
      if (!c.ready) continue;
      c.hover = damp(c.hover, c === h ? 1 : 0, 12, rdt);
      const local = c === h && hits.length ? hits[0].point.clone().sub(c.mesh.position) : new THREE.Vector3();
      c.ty = damp(c.ty, local.dot(right) * 0.6 * c.hover, 10, rdt);
      c.tx = damp(c.tx, -local.dot(upv) * 0.5 * c.hover, 10, rdt);
      c.mesh.position.copy(c.home).addScaledVector(fwd, -0.3 * c.hover).addScaledVector(upv, 0.06 * c.hover + Math.sin(performance.now() / 700 + c.home.x * 3) * 0.012);
      c.mesh.quaternion.copy(cam.quaternion);
      c.mesh.rotateY(c.ty);
      c.mesh.rotateX(c.tx);
      c.mesh.rotateZ(Math.sin(performance.now() / 900 + c.home.y) * 0.02);
    }
  }
}
