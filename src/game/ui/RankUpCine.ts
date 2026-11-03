// The rank-up moment as a short, skippable cinematic around Sundown.
// Time freezes into a desaturated slow-mo; a gold-and-jade shockwave rolls out
// over the dunes from his board (an energy front draped on the sand, a ragged
// curtain of light and kicked-up pixel sand); the camera swings round into a low
// heroic three-quarter angle while his modelled eyes flare jade; sand lifts and
// spirals around him, Serket's scorpion sigil traces itself into the sand under
// his feet with a ring of 3D hieroglyphs, and a big voxel-cast Alagard "RANK N"
// slams in beside him with a camera kick. Then the camera pulls back to frame
// him under an arch of upgrade cards (CardPicker). On a pick the chosen card's
// light soaks into him; on release the stage melts away and the run camera and
// world time ease back in.
// Everything here runs on real time (the world is paused), with its own particle
// system so the stage's sand and light move at full speed while the world's
// dust hangs in the air.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import { Particles } from '../fx/Particles';
import { GlyphRings, LightSigil } from '../fx/SerketSpirit';
import { SpriteBatch } from '../fx/SpriteBatch';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { globalUniforms, makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { hash3 } from '../../engine/math/rand';
import { mixc, tarotFrame, CARD } from '../models/props/tarot';
import type { RigInstance } from '../../engine/voxel/Rig';
import { CastAnim, CAST_POSE, CastPose } from '../anim/castAnim';
import { TAROT } from './TarotCards';
import { TarotBar, plaqueText } from './TarotBar';
import type { GambleOutcome } from '../run/UpgradesExtra';

export interface CineHero {
  root: THREE.Object3D;
  rig: RigInstance;
  material: VoxelMaterial;
  pos: THREE.Vector3;
}

export interface Pose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  roll: number;
}

const pose = (): Pose => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60, roll: 0 });
/** a camera pose for RankUpCine.shoot() */
export const makePose = (pos: THREE.Vector3, look: THREE.Vector3, fov: number, roll = 0): Pose => ({ pos: pos.clone(), look: look.clone(), fov, roll });
const copyPose = (o: Pose, a: Pose) => (o.pos.copy(a.pos), o.look.copy(a.look), (o.fov = a.fov), (o.roll = a.roll), o);
const sm = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * k * (k * (k * 6 - 15) + 10));
const sat = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
const outCubic = (k: number) => 1 - Math.pow(1 - sat(k), 3);
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _I = new THREE.Quaternion();

/** the beats, in real seconds from the freeze */
export const BEAT = {
  shock: 0.04,
  sigil: 0.28,
  eyes: 0.6,
  stamp: 0.98,
  hit: 1.14,
  pull: 1.72,
  cards: 1.84,
  /** a card pick that is not a rank-up: no stamp, a shorter hold */
  pullReward: 0.95,
  cardsReward: 1.05,
};

const GRAIN = ['grain0', 'grain1', 'grain2', 'grain3', 'grain4', 'grain5'];
const PUFF = ['puff0', 'puff1', 'puff2', 'puff3', 'cloud0'];
const SAND = [0xf6dfb0, 0xeccb8f, 0xe0b373, 0xcf9a5a];
const GOLD = 0xffd36b;
const JADE = 0x8dffd0;

const NOISE_GLSL = /* glsl */ `
float rh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh(i), rh(i + vec2(1.0, 0.0)), f.x), mix(rh(i + vec2(0.0, 1.0)), rh(i + vec2(1.0, 1.0)), f.x), f.y); }`;

// ------------------------------------------------------------------ the shockwave

const SHOCK_R = 15;

/** an energy front rolling out over the dune: a draped band of light, a ragged curtain and kicked sand */
class ShockRing {
  private disc: THREE.Mesh;
  private curtain: THREE.Mesh;
  private cpos: THREE.BufferAttribute;
  private dmat: THREE.ShaderMaterial;
  private cmat: THREE.ShaderMaterial;
  private NS = 120;
  r = 0;
  fade = 1;

  constructor(parent: THREE.Object3D, private at: THREE.Vector3, private groundAt: (x: number, z: number) => number) {
    const NR = 46, NS = this.NS;
    const pos: number[] = [], aux: number[] = [], idx: number[] = [];
    for (let i = 0; i <= NR; i++) {
      const r = Math.pow(i / NR, 1.2) * SHOCK_R;
      for (let j = 0; j <= NS; j++) {
        const a = (j / NS) * Math.PI * 2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        pos.push(x, groundAt(at.x + x, at.z + z) - at.y + 0.06, z);
        aux.push(r, j / NS);
      }
    }
    for (let i = 0; i < NR; i++)
      for (let j = 0; j < NS; j++) {
        const a = i * (NS + 1) + j, b = a + NS + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aux', new THREE.Float32BufferAttribute(aux, 2));
    g.setIndex(idx);
    this.dmat = new THREE.ShaderMaterial({
      uniforms: { uR: { value: 0 }, uFade: { value: 1 }, uT: globalUniforms.uTime, uMax: { value: SHOCK_R } },
      vertexShader: /* glsl */ `attribute vec2 aux; varying vec2 vA; void main(){ vA = aux; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uR, uFade, uT, uMax; varying vec2 vA;
        ${NOISE_GLSL}
        void main(){
          float ang = vA.y * 6.2831853;
          vec2 dir = vec2(cos(ang), sin(ang));
          // a turbulent, breaking front (not a clean circle)
          float n = rn(dir * 3.0 + vec2(uT * 1.7, -uT)) * 0.65 + rn(dir * 9.0 - vec2(uT * 2.3, uT)) * 0.35;
          float front = uR + (n - 0.5) * 1.1 * min(1.0, uR * 0.25);
          float d = vA.x - front;
          float edge = exp(-d * d * 14.0);
          float core = exp(-d * d * 90.0);
          float wake = d < 0.0 ? exp(d * 0.75) : 0.0;
          float streak = 0.5 + 0.5 * sin(ang * 52.0 + n * 5.0);
          float grit = rh(floor(vec2(ang * 140.0, vA.x * 9.0)));
          vec3 gold = vec3(1.0, 0.76, 0.34), jade = vec3(0.4, 1.0, 0.7);
          vec3 col = gold * edge * 2.6 + vec3(1.0, 0.95, 0.8) * core * 2.4 + jade * wake * (0.25 + 0.55 * streak) * (0.6 + 0.6 * grit) * 0.9;
          float far = 1.0 - smoothstep(uMax * 0.6, uMax, vA.x);
          float a = clamp(edge + wake * 0.8, 0.0, 1.0) * uFade * far;
          if (a < 0.004) discard;
          gl_FragColor = vec4(col * far * uFade, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.disc = new THREE.Mesh(g, this.dmat);
    this.disc.position.copy(at);
    this.disc.frustumCulled = false;
    this.disc.renderOrder = 6;
    parent.add(this.disc);
    // the curtain: a ragged wall of light riding the front, its foot on the sand
    const cp = new Float32Array((NS + 1) * 2 * 3);
    const cv: number[] = [], ci: number[] = [];
    for (let j = 0; j <= NS; j++) cv.push(j / NS, 0, j / NS, 1);
    for (let j = 0; j < NS; j++) {
      const a = j * 2;
      ci.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const cg = new THREE.BufferGeometry();
    this.cpos = new THREE.BufferAttribute(cp, 3);
    this.cpos.setUsage(THREE.DynamicDrawUsage);
    cg.setAttribute('position', this.cpos);
    cg.setAttribute('aux', new THREE.Float32BufferAttribute(cv, 2));
    cg.setIndex(ci);
    this.cmat = new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 1 }, uT: globalUniforms.uTime },
      vertexShader: /* glsl */ `attribute vec2 aux; varying vec2 vA; varying float vD; void main(){ vA = aux; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform float uFade, uT; varying vec2 vA; varying float vD;
        ${NOISE_GLSL}
        void main(){
          float ang = vA.x * 6.2831853;
          vec2 dir = vec2(cos(ang), sin(ang));
          float n = rn(dir * 4.0 + vec2(0.0, uT * 2.5)) * 0.6 + rn(dir * 13.0 + vec2(uT * 3.0, 0.0)) * 0.4;
          float top = 0.3 + 0.7 * n;
          float a = (1.0 - smoothstep(top - 0.3, top, vA.y)) * (1.0 - vA.y * 0.3);
          float streak = 0.45 + 0.55 * sin(ang * 96.0 + n * 7.0 + vA.y * 3.0);
          vec3 col = mix(vec3(1.0, 0.8, 0.4), vec3(0.45, 1.0, 0.75), smoothstep(0.0, 0.8, vA.y)) * (0.7 + streak) * 1.3;
          a *= uFade * smoothstep(0.8, 2.6, vD);
          if (a < 0.004) discard;
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.curtain = new THREE.Mesh(cg, this.cmat);
    this.curtain.frustumCulled = false;
    this.curtain.renderOrder = 7;
    parent.add(this.curtain);
  }

  update(k: number, p: Particles, eye: THREE.Vector3) {
    // k: 0..1 life of the wave
    if (k >= 1) {
      this.curtain.visible = this.disc.visible = false;
      return;
    }
    const e = outCubic(k);
    this.r = 0.3 + e * SHOCK_R;
    this.fade = (1 - sm((k - 0.45) / 0.55)) * Math.min(1, k * 12);
    this.dmat.uniforms.uR.value = this.r;
    this.dmat.uniforms.uFade.value = this.fade;
    this.cmat.uniforms.uFade.value = this.fade * (1 - sm((k - 0.2) / 0.5));
    const h = 0.25 + 1.5 * Math.pow(1 - e, 0.8);
    const NS = this.NS, a0 = this.at;
    for (let j = 0; j <= NS; j++) {
      const a = (j / NS) * Math.PI * 2;
      const x = a0.x + Math.cos(a) * this.r, z = a0.z + Math.sin(a) * this.r;
      const y = this.groundAt(x, z);
      this.cpos.setXYZ(j * 2, x, y - 0.05, z);
      this.cpos.setXYZ(j * 2 + 1, x, y + h, z);
    }
    this.cpos.needsUpdate = true;
    this.curtain.visible = this.disc.visible = this.fade > 0.01;
    // the front kicks the sand up as it passes
    if (this.fade > 0.05 && this.r < 11) {
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * Math.PI * 2;
        const x = a0.x + Math.cos(a) * this.r, z = a0.z + Math.sin(a) * this.r;
        if (Math.hypot(x - eye.x, z - eye.z) < 2.2) continue;
        const out = 2 + 5 * (1 - e);
        p.emit({ pos: { x, y: this.groundAt(x, z) + 0.05, z }, count: 1, vel: { x: Math.cos(a) * out, y: 2 + Math.random() * 3, z: Math.sin(a) * out }, spread: 0.6, life: [0.5, 1.0], size: [0.06, 0.035], sprite: GRAIN, color: SAND, gravity: 9, drag: 1.2, ground: true, bounce: 0.1 });
      }
      if (Math.random() < 0.7) {
        const a = Math.random() * Math.PI * 2;
        const x = a0.x + Math.cos(a) * this.r, z = a0.z + Math.sin(a) * this.r;
        if (Math.hypot(x - eye.x, z - eye.z) > 4) p.emit({ pos: { x, y: this.groundAt(x, z) + 0.2, z }, count: 1, vel: { x: Math.cos(a) * 1.5, y: 0.6, z: Math.sin(a) * 1.5 }, life: [0.7, 1.3], size: [0.4, 1.1], sprite: PUFF, color: SAND, alpha: 0.6, drag: 2, rot: 6, rotSpeed: 0.6 });
      }
    }
  }

  dispose() {
    for (const m of [this.disc, this.curtain]) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.dmat.dispose();
    this.cmat.dispose();
  }
}

// ------------------------------------------------------------------ a pillar of light (epic+ card entrances)

let pillarGeo: THREE.LatheGeometry | null = null;

/** a flared, wavering column of light bursting out of the sand: hot core, rising striations, soft silhouette */
export class LightPillar {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  k = 0;

  constructor(parent: THREE.Object3D, base: THREE.Vector3, height: number, color: number, width = 1) {
    if (!pillarGeo) {
      // hand-shaped profile: a wide splash where it breaks the sand, a pinched waist, a soft crown
      const prof = [[1.0, 0], [0.7, 0.025], [0.48, 0.07], [0.36, 0.15], [0.3, 0.28], [0.27, 0.45], [0.28, 0.62], [0.31, 0.8], [0.36, 0.93], [0.4, 1.0]];
      pillarGeo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 48);
    }
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uK: { value: 0 }, uT: globalUniforms.uTime, uCol: { value: new THREE.Color(color) }, uSeed: { value: Math.random() * 10 } },
      vertexShader: /* glsl */ `
        uniform float uT, uSeed, uK; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){
          vUv = uv;
          vec3 p = position;
          float ang = uv.x * 6.2831853;
          float w = 1.0 + 0.09 * sin(uT * 6.0 + p.y * 9.0 + ang * 3.0 + uSeed) + 0.05 * sin(uT * 11.0 - p.y * 17.0 + ang * 5.0);
          p.xz *= w * (0.55 + 0.45 * uK);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uK, uT, uSeed; uniform vec3 uCol; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        ${NOISE_GLSL}
        void main(){
          float ndv = abs(dot(normalize(vN), normalize(vV)));
          float core = pow(ndv, 1.8);
          float ang = vUv.x * 6.2831853;
          float s1 = 0.5 + 0.5 * sin(ang * 11.0 + uSeed + sin(vUv.y * 7.0 - uT * 3.0));
          float s2 = rn(vec2(floor(vUv.x * 30.0), vUv.y * 5.0 - uT * 3.2 + uSeed));
          float streak = s1 * 0.5 + s2 * 0.8;
          float rise = smoothstep(0.0, 0.05, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
          float lvl = smoothstep(uK * 1.15 + 0.05, uK * 1.15 - 0.1, vUv.y); // it climbs as it ignites
          vec3 col = mix(uCol, vec3(1.0, 0.98, 0.9), core * 0.7) * (core * 1.5 + streak * 0.7);
          float a = (core * 0.75 + streak * 0.35) * rise * lvl * uK;
          if (a < 0.004) discard;
          gl_FragColor = vec4(col * 1.8, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(pillarGeo, this.mat);
    this.mesh.position.copy(base);
    this.mesh.scale.set(0.62 * width, height, 0.62 * width);
    this.mesh.renderOrder = 8;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
  }

  update() {
    this.mat.uniforms.uK.value = this.k;
    this.mesh.visible = this.k > 0.003;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------ RANK N, voxel-cast in Alagard

/** typography voxelised: Alagard glyph masks extruded into bevelled gold with a jade core and an inked back plate */
function rankModel(word: string, num: string) {
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  const S1 = 34, S2 = 62;
  c.font = `${S1}px Alagard`;
  const w1 = word ? c.measureText(word + ' ').width : 0;
  c.font = `${S2}px Alagard`;
  const w2 = c.measureText(num).width;
  const W = Math.ceil(w1 + w2) + 12, H = Math.ceil(S2 * 1.05) + 12;
  cv.width = W;
  cv.height = H;
  const base = H - 6 - Math.round(S2 * 0.08);
  c.fillStyle = '#fff';
  c.textBaseline = 'alphabetic';
  c.font = `${S1}px Alagard`;
  if (word) c.fillText(word, 6, base - Math.round((S2 - S1) * 0.36));
  c.font = `${S2}px Alagard`;
  c.fillText(num, 6 + w1, base);
  const img = c.getImageData(0, 0, W, H).data;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && img[(y * W + x) * 4 + 3] > 120;
  const m = new VoxelModel('rank_stamp');
  const D = 7;
  let minY = H, maxY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (on(x, y)) ((minY = Math.min(minY, y)), (maxY = Math.max(maxY, y)));
  const span = Math.max(1, maxY - minY);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const vy = H - 1 - y;
      if (on(x, y)) {
        const isNum = x >= 6 + w1 - 2;
        let e = 0;
        for (let r = 1; r <= 3; r++) {
          if (on(x - r, y) && on(x + r, y) && on(x, y - r) && on(x, y + r)) e = r;
          else break;
        }
        const ty = 1 - (y - minY) / span;
        const n = hash3(x, y, 7);
        const gold = mixc(mixc(0xc4802a, 0xffe9a8, ty), 0xffffff, n < 0.04 ? 0.5 : 0);
        const front = e >= 1 ? D : D - 1; // bevel: the stroke edges stop one voxel short
        for (let z = 0; z < front; z++) {
          const top = z === front - 1;
          let col = z < 2 ? 0x5a3410 : mixc(0x8a5418, 0xc88a30, z / D);
          let fl: number = VF.METAL;
          if (top) {
            col = gold;
            if (isNum && e >= 2) {
              col = mixc(0x6dffb0, 0xeafff4, ty * 0.6);
              fl = VF.GLOW;
            } else if (e >= 2 || (!isNum && e >= 1)) fl = VF.METAL | VF.EMISSIVE;
          }
          m.set(x, vy, z, col, fl);
        }
      } else {
        // an inked back plate one or two voxels proud of the glyphs: reads as a bold outline
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 5 && on(x + dx, y + dy)) ((near = true), 0);
        if (near) for (let z = 0; z < 3; z++) m.set(x, vy, z, z === 2 ? 0x3a1e0c : 0x1e0f06);
      }
    }
  return { model: m, w: W, h: H };
}

class RankStamp {
  mesh: THREE.Mesh;
  mat: VoxelMaterial;
  width: number;
  height: number;
  constructor(parent: THREE.Object3D, word: string, num: string, widthM: number) {
    const { model, w, h } = rankModel(word, num);
    const vs = widthM / w;
    this.width = widthM;
    this.height = h * vs;
    this.mat = makeVoxelMaterial({ fog: false, emissiveStrength: 1.4 });
    this.mesh = new THREE.Mesh(buildVoxelGeometry(model, { voxelSize: vs, pivot: 'center' }), this.mat);
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------ sand spiralling up around him

/**
 * Pixel sand lifting off the dune and spiralling up around the hero: grains,
 * a few soft puffs and glints, on a tight funnel (it never drifts into the lens).
 */
class SandSpiral {
  center = new THREE.Vector3();
  intensity = 0;
  height = 3;
  burst = 0;
  private n: number;
  private a: Float32Array;
  private h: Float32Array;
  private r: Float32Array;
  private w: Float32Array;
  private vy: Float32Array;
  private batch: SpriteBatch;
  private glow: SpriteBatch;
  private t = 0;

  constructor(parent: THREE.Object3D, n = 760) {
    this.n = n;
    this.a = new Float32Array(n);
    this.h = new Float32Array(n);
    this.r = new Float32Array(n);
    this.w = new Float32Array(n);
    this.vy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.a[i] = Math.random() * Math.PI * 2;
      this.h[i] = Math.random();
      this.r[i] = 0.55 + Math.pow(Math.random(), 0.7) * 0.9;
      this.w[i] = (2.0 + Math.random() * 2.4) * (1.25 - (this.r[i] - 0.55) * 0.4);
      this.vy[i] = 0.1 + Math.random() * 0.18;
    }
    this.batch = new SpriteBatch(n);
    this.glow = new SpriteBatch(Math.ceil(n / 5), true);
    parent.add(this.batch.mesh, this.glow.mesh);
  }

  update(dt: number, fog: THREE.Fog | null, eye: THREE.Vector3) {
    this.t += dt;
    this.batch.begin();
    this.glow.begin();
    const I = Math.max(0, Math.min(1.3, this.intensity));
    const b = this.burst;
    if (I > 0.01) {
      const c = this.center;
      for (let i = 0; i < this.n; i++) {
        this.a[i] += this.w[i] * dt * (1 - b * 0.6);
        this.h[i] += this.vy[i] * dt * (0.6 + I * 0.6);
        if (this.h[i] > 1) {
          this.h[i] -= 1;
          this.r[i] = 0.55 + Math.pow(Math.random(), 0.7) * 0.9;
        }
        const hf = this.h[i];
        const rad = this.r[i] * (0.8 + 0.35 * hf) * (1 + b * (2.5 + hf * 3));
        const x = c.x + Math.cos(this.a[i]) * rad, z = c.z + Math.sin(this.a[i]) * rad;
        const y = c.y + hf * this.height + b * hf * 1.5;
        const al = Math.min(1, I) * Math.min(1, hf * 6) * (1 - Math.max(0, hf - 0.8) * 5) * (1 - b);
        if (al < 0.03) continue;
        const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (i % 5 === 0) this.glow.push(x, y, z, i % 2 ? 'glow8' : 'star4', 0.07, 0.07, 0, i % 3 ? 0xffd890 : JADE, al * 0.9);
        else if (d2 > 2.2 && al > 0.15) {
          // opaque grains that fade by shrinking (dithered alpha up close reads as ink noise)
          const sz = (0.032 + (i % 3) * 0.013) * (0.35 + 0.65 * al);
          this.batch.push(x, y, z, GRAIN[i % GRAIN.length], sz, sz, 0, SAND[i % SAND.length], 1);
        }
      }
    }
    this.batch.end(fog);
    this.glow.end(null);
  }

  dispose() {
    for (const bt of [this.batch, this.glow]) {
      bt.mesh.removeFromParent();
      bt.mesh.geometry.dispose();
      (bt.mesh.material as THREE.Material).dispose();
    }
  }
}

// ------------------------------------------------------------------ the director

export class RankUpCine {
  /** the stage's own real-time particles */
  p = new Particles();
  /** stage fx exist (until the release has faded) */
  alive = false;
  /** the cinematic writes the camera */
  owns = false;
  /** seconds since the freeze */
  t = 0;
  /** first card may burst at */
  tCards = BEAT.cards;
  hero: CineHero | null = null;
  /** hero base (board) */
  H = new THREE.Vector3();
  heroTop = 1.9;
  /** horizontal unit vector from the hero toward the stage camera */
  dir = new THREE.Vector3(0, 0, 1);
  A = pose();
  B = pose();
  cur = pose();
  /** where the hero's head looks (null: the camera) */
  gaze: THREE.Vector3 | null = null;
  /** the hero's chest-facing direction (horizontal) */
  chestF = new THREE.Vector3(0, 0, 1);
  /** 0..1: the stage set (sigil, glyph ring, sand funnel) steps back while a card plays its own moment */
  dim = 0;
  private tPull = BEAT.pull;
  private stamped = false;
  private seg: { from: Pose; to: Pose; t0: number; dur: number; orbit: boolean } | null = null;
  private fired = new Set<string>();
  private trauma = 0;
  private fovKick = 0;
  private stamp: RankStamp | null = null;
  private stampFrom = new THREE.Vector3();
  private stampTo = new THREE.Vector3();
  private stampQ = new THREE.Quaternion();
  private shock: ShockRing | null = null;
  private sigil: LightSigil | null = null;
  private vortex: SandSpiral | null = null;
  private rings: GlyphRings | null = null;
  private lightA: THREE.PointLight;
  private lightB: THREE.PointLight;
  private auraT = -1;
  private auraCol = new THREE.Color();
  private releaseT = -1;
  private saved = { desat: 0, ca: 0, vig: 0.32, fxX: 0, fxZ: 0 };
  private headQ0: THREE.Quaternion | null = null;
  private eyesOn = 0;
  private desat = 0;
  private flashHero = 0;

  constructor(private ctx: Ctx) {
    this.p.groundAt = ctx.world.groundAt;
    ctx.scene.add(this.p.group);
    // two lights that live in the scene for good (adding lights later would recompile every material)
    this.lightA = new THREE.PointLight(0x7dff3a, 0, 3, 1.6);
    this.lightB = new THREE.PointLight(0x9dffc8, 0, 7, 1.4);
    for (const l of [this.lightA, this.lightB]) {
      l.castShadow = false;
      ctx.scene.add(l);
    }
    void (document as any).fonts?.load?.('62px Alagard');
  }

  // ---------------------------------------------------------------- staging

  private groundY(x: number, z: number) {
    return this.ctx.world.groundAt(x, z);
  }

  /** a camera spot around the hero: at radius r along d, h above his board, kept above the sand */
  private camAt(d: THREE.Vector3, r: number, h: number, out = new THREE.Vector3()) {
    out.set(this.H.x + d.x * r, this.H.y + h, this.H.z + d.z * r);
    out.y = Math.max(out.y, this.groundY(out.x, out.z) + 0.35);
    return out;
  }

  private clear(d: THREE.Vector3) {
    const head = _v3.copy(this.H).addScaledVector(UP, this.heroTop * 0.65);
    for (const [r, h] of [[2.6, 0.45], [4.6, 1.0]]) {
      const c = this.camAt(d, r, h, _v);
      if (c.y - (this.H.y + h) > 0.7) return false;
      for (let i = 1; i < 10; i++) {
        _v2.lerpVectors(c, head, i / 10);
        if (this.groundY(_v2.x, _v2.z) > _v2.y - 0.06) return false;
      }
    }
    return true;
  }

  /** pick a clear three-quarter angle on the hero's chest side, nearest the current view */
  private chooseDir(chestF: THREE.Vector3, cam0: THREE.Vector3) {
    const toCam = _v.copy(cam0).sub(this.H).setY(0).normalize().clone();
    const rot = (a: number) => chestF.clone().applyAxisAngle(UP, a);
    const pair = (a: number) => (rot(a).dot(toCam) >= rot(-a).dot(toCam) ? [a, -a] : [-a, a]);
    const cands = [...pair(0.62), ...pair(0.95), ...pair(0.3), ...pair(1.35), 0, ...pair(2.0), Math.PI];
    for (const a of cands) {
      const d = rot(a);
      if (this.clear(d)) return d;
    }
    return rot(cands[0]);
  }

  private stageShots() {
    const d = this.dir;
    const top = this.heroTop;
    // A: low heroic three-quarter, hero on the left third, a slight dutch angle
    this.camAt(d, 2.6, 0.45, this.A.pos);
    const fA = _v.copy(d).negate();
    const rA = _v2.crossVectors(fA, UP).normalize();
    this.A.look.copy(this.H).addScaledVector(UP, top * 0.62).addScaledVector(rA, 0.58);
    this.A.fov = 40;
    this.A.roll = -0.05;
    // B: pulled back and low, the hero in the lower half, room above for the arch of cards
    this.camAt(d, 4.6, 1.0, this.B.pos);
    this.B.look.copy(this.H).addScaledVector(UP, top * 1.02);
    this.B.fov = 50;
    this.B.roll = 0;
  }

  /** the camera's orientation for a pose */
  static quatOf(p: Pose, out = new THREE.Quaternion()) {
    const m = new THREE.Matrix4().lookAt(p.pos, p.look, UP);
    out.setFromRotationMatrix(m);
    if (p.roll) out.multiply(_q3.setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.roll));
    return out;
  }

  /**
   * Freeze and stage. rank: the number to stamp (null: a card reward, no stamp).
   * Returns when (stage seconds) the first card may burst.
   */
  begin(hero: CineHero | null, rank: number | null) {
    const ctx = this.ctx;
    const eng = ctx.engine;
    if (this.alive) this.teardown();
    this.alive = true;
    this.owns = true;
    this.t = 0;
    this.dim = 0;
    this.redHero = 0;
    this.fired.clear();
    this.releaseT = -1;
    this.auraT = -1;
    this.trauma = 0;
    this.fovKick = 0;
    this.eyesOn = 0;
    this.flashHero = 0;
    this.gaze = null;
    this.headLook = null;
    this.shockT0 = BEAT.shock;
    this.stamped = rank !== null;
    this.tPull = this.stamped ? BEAT.pull : BEAT.pullReward;
    this.tCards = this.stamped ? BEAT.cards : BEAT.cardsReward;
    const cam = ctx.camera;
    this.cur.pos.copy(cam.position);
    cam.getWorldDirection(_v);
    this.hero = hero;
    const u = eng.post.u;
    this.saved.desat = u.uDesat.value;
    this.saved.ca = u.uCA.value;
    this.saved.vig = u.uVignette.value;
    this.desat = this.saved.desat;
    if (hero) {
      this.H.copy(hero.pos);
      const box = new THREE.Box3().setFromObject(hero.root);
      this.heroTop = Math.max(1.4, Math.min(2.6, box.max.y - this.H.y));
      this.cur.look.copy(cam.position).addScaledVector(_v, Math.max(3, cam.position.distanceTo(this.H)));
      this.saved.fxX = hero.material.userData.fx.value.x;
      this.saved.fxZ = hero.material.userData.fx.value.z;
      const head = hero.rig.nodes['head'];
      this.headQ0 = head ? head.quaternion.clone() : null;
      // the chest faces the rig's +Z
      const torso = hero.rig.nodes['torso'] ?? hero.rig.root;
      torso.updateWorldMatrix(true, false);
      const chestF = new THREE.Vector3(0, 0, 1).transformDirection(torso.matrixWorld).setY(0);
      if (chestF.lengthSq() < 1e-4) chestF.copy(this.cur.pos).sub(this.H).setY(0);
      chestF.normalize();
      this.chestF.copy(chestF);
      this.dir.copy(this.chooseDir(chestF, cam.position));
      this.stageShots();
      this.seg = { from: copyPose(pose(), this.cur), to: this.A, t0: 0, dur: 0.95, orbit: true };
      // the stage set
      const g = this.groundY(this.H.x, this.H.z);
      const at = new THREE.Vector3(this.H.x, g, this.H.z);
      this.shock = new ShockRing(ctx.scene, at, ctx.world.groundAt);
      this.sigil = new LightSigil(ctx.scene, at, Math.atan2(this.dir.x, this.dir.z), ctx.world.groundAt, 0.56);
      this.vortex = new SandSpiral(ctx.scene);
      this.vortex.center.copy(at);
      this.rings = new GlyphRings(ctx.scene, [{ radius: 1.55, y: 0.18, count: 16, speed: 0.7 }], 2.2);
      this.rings.group.position.copy(at);
      if (rank !== null) {
        const aspect = eng.width / eng.height;
        const hw = 1.8 * Math.tan(THREE.MathUtils.degToRad(this.A.fov / 2)) * aspect;
        this.stamp = new RankStamp(ctx.scene, 'RANK', String(rank), Math.min(1.05, hw * 0.88));
      }
      this.lightB.position.copy(at).addScaledVector(UP, 0.35);
      this.lightB.color.setHex(JADE);
    } else {
      // no hero to stage: frame the cards from where we stand
      this.cur.look.copy(cam.position).addScaledVector(_v, 4);
      copyPose(this.A, this.cur);
      copyPose(this.B, this.cur);
      this.B.fov = cam.fov;
      this.A.fov = cam.fov;
      this.seg = null;
      this.tPull = 0;
      this.tCards = 0.12;
      this.headQ0 = null;
    }
    this.cur.fov = cam.fov;
    this.cur.roll = 0;
    // the freeze
    eng.flash(0xfff0c8, 0.32, 0.3);
    eng.letterbox(true, 0.35);
    ctx.sfx('time_slow', null, 0.9);
    u.uRadial.value = 0.7;
    return this.tCards;
  }

  /** a follow-up pick (queued rank-ups): a quick re-burst, no camera swing */
  again(rank: number | null) {
    this.t = Math.max(this.t, this.tCards);
    this.tCards = this.t + 0.35;
    this.fired.add('again');
    if (this.hero && this.shock) {
      this.shock.dispose();
      const g = this.groundY(this.H.x, this.H.z);
      this.shock = new ShockRing(this.ctx.scene, new THREE.Vector3(this.H.x, g, this.H.z), this.ctx.world.groundAt);
      this.fired.delete('shock');
      this.shockT0 = this.t;
    }
    if (rank !== null) this.ctx.sfx('rank_up', null, 0.6);
    return this.tCards;
  }
  private shockT0 = BEAT.shock;

  /** jump the intro to the cards (click to skip). Returns the new first-card time. */
  skip() {
    if (this.t >= this.tCards - 0.05 || this.releaseT >= 0) return this.tCards;
    this.fired.add('stamp').add('hit').add('eyes').add('sigil').add('pull');
    if (this.stamp) this.stamp.mesh.visible = false;
    this.eyesOn = 1;
    this.seg = { from: copyPose(pose(), this.cur), to: this.B, t0: this.t, dur: 0.38, orbit: false };
    this.t = Math.max(this.t, this.tPull);
    this.seg.t0 = this.t;
    this.tCards = this.t + 0.08;
    this.ctx.engine.letterbox(false, 0.3);
    return this.tCards;
  }

  /** the card-picking phase has begun (cards may be interacted with) */
  get inCards() {
    return this.t >= this.tCards;
  }

  kick(trauma: number, fov = 0) {
    this.trauma = Math.min(1, this.trauma + trauma);
    this.fovKick += fov;
  }

  heroChest(out = new THREE.Vector3()) {
    return out.copy(this.H).addScaledVector(UP, this.heroTop * 0.6);
  }

  /** a camera spot around the hero (kept above the sand): along d at radius r, h above his board */
  spot(d: THREE.Vector3, r: number, h: number, out = new THREE.Vector3()) {
    return this.camAt(d, r, h, out);
  }

  /** cut / blend the camera to a pose (it keeps following the pose object if it is changed later) */
  shoot(to: Pose, dur: number, orbit = false) {
    this.seg = { from: copyPose(pose(), this.cur), to, t0: this.t, dur: Math.max(0.01, dur), orbit };
  }

  /** the hero takes a hit on stage (a gamble gone wrong): a red flash, blood and a hard kick */
  hurtHero() {
    if (!this.hero) return;
    const c = this.heroChest();
    this.redHero = 1;
    this.kick(0.85, -6);
    this.ctx.engine.flash(0xff3a2a, 0.4, 0.25);
    this.p.emit({ pos: c, count: 26, spread: 4, up: 1, life: [0.4, 0.9], size: [0.07, 0.03], sprite: ['blood0', 'blood1', 'blood2'], color: 0xffffff, gravity: 9, ground: true, bounce: 0.1, drag: 0.6 });
    this.p.emit({ pos: c, count: 3, spread: 1.2, life: [0.4, 0.7], size: [0.2, 0.45], sprite: 'splat', color: 0xffffff, gravity: 7, ground: true, rot: 6 });
    this.ctx.sfx('hit_bone', c, 0.9);
    this.ctx.sfx('skeleton_rattle', c, 0.8);
    this.hero.rig.setExpression?.('hurt');
  }
  private redHero = 0;

  /** the chosen card's light soaks into him */
  soak(color: number) {
    if (!this.hero) return;
    const c = this.heroChest();
    this.auraT = 0;
    this.auraCol.setHex(color);
    this.flashHero = 1;
    this.lightA.color.setHex(color);
    this.lightA.distance = 5;
    const p = this.p;
    // the card bursts into shards of light ...
    p.emit({ pos: c, count: 36, spread: 7, life: [0.25, 0.6], size: [0.16, 0.03], sprite: ['spark', 'star4', 'streak'], additive: true, color: [color, 0xffffff, 0xfff0c0], drag: 3, stretch: 0.05 });
    p.emit({ pos: c, count: 1, life: [0.28, 0.28], size: [1.6, 0.2], sprite: ['flash0', 'flash1', 'flash2'], additive: true, color, sizeJitter: 0 });
    // ... that are drawn into his body
    for (let i = 0; i < 46; i++) {
      _v.set(Math.random() * 2 - 1, Math.random() * 1.4 - 0.5, Math.random() * 2 - 1).normalize();
      const r = 0.9 + Math.random() * 0.9;
      const life = 0.28 + Math.random() * 0.25;
      p.emit({ pos: { x: c.x + _v.x * r, y: c.y + _v.y * r, z: c.z + _v.z * r }, count: 1, vel: { x: (-_v.x * r) / life, y: (-_v.y * r) / life, z: (-_v.z * r) / life }, life: [life, life], size: [0.1, 0.03], sprite: ['glow8', 'star4', 'spark'], additive: true, color: [color, 0xffffff], delay: Math.random() * 0.15, stretch: 0.03 });
    }
    this.kick(0.3, -3.5);
    this.ctx.sfx('divine_power', c, 0.8);
    this.ctx.sfx('heal', c, 0.5, 1.2);
  }

  /** melt the stage away; the camera is handed back to the caller */
  release() {
    if (this.releaseT >= 0) return;
    this.releaseT = this.t;
    this.owns = false;
    this.ctx.engine.letterbox(false, 0.4);
    if (this.hero && this.headQ0) this.hero.rig.nodes['head']?.quaternion.copy(this.headQ0);
  }

  /** the camera pose this frame (for handing back) */
  pose() {
    return this.cur;
  }

  // ---------------------------------------------------------------- per frame

  private once(k: string, at: number) {
    if (this.t < at || this.fired.has(k)) return false;
    this.fired.add(k);
    return true;
  }

  update(rdt: number, paused: boolean) {
    if (!this.alive && this.p.count === 0) return;
    const ctx = this.ctx;
    const eng = ctx.engine;
    const u = eng.post.u;
    this.t += rdt;
    const t = this.t;
    const hero = this.hero;
    const fog = ctx.world.env.fog as THREE.Fog | null;
    // the world's own dust hangs in the air: it creeps at a crawl while time is frozen
    if (paused) {
      const crawl = 0.035 + 0.6 * Math.max(0, 1 - t * 4);
      // frozen dust and spray the swinging camera would pass through: pixel puffs in the lens read as ink mush
      if (this.owns) this.clearLens(ctx.particles as any, ctx.camera.position);
      ctx.particles.update(rdt * crawl, fog);
      ctx.fx.update(rdt * crawl);
    }
    if (this.alive && hero) {
      const H = this.H;
      // ---- beats
      if (this.once('shock', this.shockT0)) {
        ctx.sfx('sand_burst', H, 0.9, 0.8);
        ctx.sfx('quake_rumble', H, 0.5);
        this.kick(0.25);
      }
      if (this.shock) this.shock.update(Math.min(1, (t - this.shockT0) / 1.25), this.p, ctx.camera.position);
      if (this.once('sigil', BEAT.sigil)) ctx.sfx('sand_rise', H, 0.8);
      if (this.once('eyes', BEAT.eyes)) {
        ctx.sfx('divine_whisper', H, 0.7);
        this.eyeBurst();
      }
      if (this.stamp && this.once('stamp', BEAT.stamp)) this.placeStamp();
      if (this.stamp && this.once('hit', BEAT.hit)) this.stampHit();
      if (this.once('pull', this.tPull)) {
        this.seg = { from: copyPose(pose(), this.cur), to: this.B, t0: t, dur: 0.85, orbit: false };
        eng.letterbox(false, 0.5);
      }
      this.updateStamp(t);
      // ---- the set
      const rel = this.releaseT >= 0 ? sat((t - this.releaseT) / 0.8) : 0;
      if (this.sigil) {
        this.sigil.reveal = this.fired.has('pull') && t - BEAT.sigil > 0.2 ? 1 : outCubic((t - BEAT.sigil) / 0.75);
        this.sigil.fade = (1 - rel) * (t < this.tPull ? 1 : 0.85) * (1 - this.dim * 0.85);
        this.sigil.update();
      }
      if (this.vortex) {
        const v = this.vortex;
        const inCards = t >= this.tPull;
        v.intensity = (inCards ? 0.5 : sm((t - 0.3) / 0.8)) * (1 - rel * 0.5) * (1 - this.dim * 0.6);
        v.height = inCards ? 2.6 : 1.6 + 1.8 * sm((t - 0.3) / 1.0);
        v.burst = rel;
        v.update(rdt, fog, ctx.camera.position);
      }
      if (this.rings) {
        this.rings.appear = sat((t - 0.5) / 0.8);
        this.rings.fade = (1 - rel) * (1 - this.dim * 0.8);
        this.rings.update(rdt);
      }
      // jade motes off the sigil, glyph sparks while it traces
      if (t > BEAT.sigil && rel < 1 && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 2;
        const x = H.x + Math.cos(a) * r, z = H.z + Math.sin(a) * r;
        this.p.emit({ pos: { x, y: this.groundY(x, z) + 0.05, z }, count: 1, up: 1.2, spread: 0.3, life: [0.9, 1.8], size: [0.08, 0.18], sprite: ['glow8', 'star4', 'glyph0', 'glyph1', 'glyph2', 'glyph3'], additive: true, color: [JADE, GOLD, 0xeafff4], alpha: 0.9, drag: 0.8, fadeIn: 0.15 });
      }
      // ---- lights: the sigil blazes, the eyes burn
      const blaze = sat((t - BEAT.sigil) / 0.7) * (1 - rel);
      const hitGlow = this.fired.has('hit') ? Math.max(0, 1 - (t - BEAT.hit) * 2.5) : 0;
      this.lightB.intensity = (blaze * (t < this.tPull ? 6 : 3.2) + hitGlow * 10) * (0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 7.3));
      this.lightB.color.setHex(hitGlow > 0.3 ? GOLD : JADE);
      // ---- the hero
      this.eyesOn = this.fired.has('eyes') ? Math.min(1, this.eyesOn + rdt * 6) : 0;
      const eyes = this.eyesOn * (1 - rel);
      this.flashHero = Math.max(0, this.flashHero - rdt * 2.2);
      if (this.redHero > 0) {
        this.redHero = Math.max(0, this.redHero - rdt * 1.6);
        hero.material.userData.tint.value.setRGB(1, 1 - this.redHero * 0.7, 1 - this.redHero * 0.75);
      }
      if (this.releaseT < 0) {
        // (after the release the Player's own update decays these back)
        const fx = hero.material.userData.fx.value;
        fx.z = this.saved.fxZ + eyes * (2.2 + 1.4 * Math.sin(t * 9) * Math.sin(t * 3.3)) + (this.auraT >= 0 ? Math.max(0, 1 - this.auraT * 1.5) * 4 : 0);
        fx.x = Math.max(this.saved.fxX, this.flashHero * this.flashHero * 0.85);
      }
      this.eyes(eyes, rdt);
      if (this.releaseT < 0) this.aimHead(rdt);
      if (this.auraT >= 0) this.aura(rdt);
      // ---- post: a desaturated freeze that lets the colour back in as the cards come
      const want = this.releaseT >= 0 ? this.saved.desat : t < 0.3 ? 0.78 : t < BEAT.hit && this.stamped ? 0.72 : t < this.tPull ? 0.45 : 0.14;
      this.desat += (want - this.desat) * (1 - Math.exp(-rdt * (t < 0.3 ? 9 : 4)));
      u.uDesat.value = this.desat;
      if (this.releaseT < 0) u.uVignette.value = 0.32 + 0.22 * sat(t * 3);
      u.uCA.value = Math.max(this.saved.ca, u.uCA.value - rdt * 0.05);
      if (paused) u.uRadial.value = Math.max(0, u.uRadial.value - rdt * 1.6);
      // ---- camera
      if (this.owns) this.camera(rdt);
      if (this.releaseT >= 0 && t - this.releaseT > 1.0) this.teardown();
    } else if (this.alive && this.owns) {
      // heroless: hold the view
      if (this.releaseT >= 0 && t - this.releaseT > 0.6) this.teardown();
    } else if (this.alive && this.releaseT >= 0 && t - this.releaseT > 0.6) this.teardown();
    this.p.update(rdt, fog);
  }

  private clearLens(P: { n: number; px: Float32Array; py: Float32Array; pz: Float32Array; s0: Float32Array; s1: Float32Array; life: Float32Array; maxLife: Float32Array; flags: Uint8Array }, eye: THREE.Vector3) {
    if (!P || !P.px) return;
    for (let i = 0; i < P.n; i++) {
      if (P.flags[i] & 5) continue; // additive or screen-space sprites are fine
      const s = Math.max(P.s0[i], P.s1[i]);
      if (s < 0.12) continue;
      const dx = P.px[i] - eye.x, dy = P.py[i] - eye.y, dz = P.pz[i] - eye.z;
      const r = 1.4 + s * 1.5;
      if (dx * dx + dy * dy + dz * dz < r * r) P.life[i] = P.maxLife[i];
    }
  }

  private camera(rdt: number) {
    const cam = this.ctx.camera;
    const t = this.t;
    const out = this.cur;
    if (this.seg) {
      const s = this.seg;
      const k = sm((t - s.t0) / s.dur);
      this.blend(s.from, s.to, k, s.orbit, out);
      // the held hero shot drifts: a slow orbit and push-in
      if (s.to === this.A && t < this.tPull) {
        const dk = Math.max(0, t - s.t0 - s.dur * 0.6);
        _v.copy(out.pos).sub(this.H).applyAxisAngle(UP, dk * 0.05);
        out.pos.copy(this.H).add(_v).lerp(out.look, dk * 0.05);
      }
      // the settled card frame breathes a touch
      if (s.to === this.B && k >= 1) out.pos.y += Math.sin(t * 0.9) * 0.012;
    }
    out.pos.y = Math.max(out.pos.y, this.groundY(out.pos.x, out.pos.z) + 0.3);
    this.trauma = Math.max(0, this.trauma - rdt * 1.8);
    this.fovKick *= Math.exp(-rdt * 7);
    cam.position.copy(out.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(out.look);
    cam.rotateZ(out.roll);
    const s = this.trauma * this.trauma;
    if (s > 1e-4) {
      const q = t * 31;
      cam.rotateX((Math.sin(q * 1.3) + Math.sin(q * 2.9 + 1.1) * 0.6) * 0.035 * s);
      cam.rotateY((Math.sin(q * 1.1 + 2.0) + Math.sin(q * 3.7) * 0.5) * 0.035 * s);
      cam.rotateZ(Math.sin(q * 1.7 + 4.0) * 0.05 * s);
    }
    cam.fov = out.fov + this.fovKick;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** interpolate two poses; orbit swings round the hero instead of cutting through him */
  private blend(a: Pose, b: Pose, k: number, orbit: boolean, out: Pose) {
    if (orbit && this.hero) {
      const H = this.H;
      const ax = a.pos.x - H.x, az = a.pos.z - H.z, bx = b.pos.x - H.x, bz = b.pos.z - H.z;
      const a0 = Math.atan2(az, ax);
      let da = Math.atan2(bz, bx) - a0;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const ang = a0 + da * k;
      const r = THREE.MathUtils.lerp(Math.hypot(ax, az), Math.hypot(bx, bz), k);
      out.pos.set(H.x + Math.cos(ang) * r, THREE.MathUtils.lerp(a.pos.y, b.pos.y, k) + Math.sin(k * Math.PI) * 0.25, H.z + Math.sin(ang) * r);
    } else out.pos.lerpVectors(a.pos, b.pos, k);
    out.look.lerpVectors(a.look, b.look, k);
    out.fov = THREE.MathUtils.lerp(a.fov, b.fov, k);
    out.roll = THREE.MathUtils.lerp(a.roll, b.roll, k);
  }

  // ---------------------------------------------------------------- the stamp

  private placeStamp() {
    const st = this.stamp!;
    const A = this.A;
    const q = RankUpCine.quatOf({ ...A, roll: 0 }, this.stampQ);
    const right = _v.set(1, 0, 0).applyQuaternion(q);
    const up = _v2.set(0, 1, 0).applyQuaternion(q);
    const fwd = _v3.set(0, 0, -1).applyQuaternion(q);
    const zt = 1.8;
    const hh = zt * Math.tan(THREE.MathUtils.degToRad(A.fov / 2));
    const hw = hh * (this.ctx.engine.width / this.ctx.engine.height);
    const x = Math.min(hw - st.width / 2 - 0.04, Math.max(0.05 + st.width / 2, hw * 0.5));
    const y = -hh * 0.16;
    this.stampTo.copy(A.pos).addScaledVector(fwd, zt).addScaledVector(right, x).addScaledVector(up, y);
    this.stampFrom.copy(A.pos).addScaledVector(fwd, 0.45).addScaledVector(right, x * 0.25).addScaledVector(up, y * 0.2 + 0.05);
    st.mesh.visible = true;
    st.mesh.position.copy(this.stampFrom);
    st.mesh.quaternion.copy(q);
    this.ctx.sfx('melee_whoosh', this.stampTo, 0.8, 0.7);
  }

  private stampHit() {
    const ctx = this.ctx;
    const st = this.stamp!;
    const c = this.stampTo;
    this.kick(0.6, -5);
    ctx.engine.flash(0xfff2c0, 0.38, 0.22);
    ctx.engine.post.u.uCA.value = this.saved.ca + 0.014;
    ctx.engine.post.u.uRadial.value = 0.8;
    ctx.sfx('poster_slam', c, 1.0, 0.85);
    ctx.sfx('explosion', c, 0.35, 1.5);
    const hw = st.width / 2, hh = st.height / 2;
    const right = _v.set(1, 0, 0).applyQuaternion(this.stampQ);
    const up = _v2.set(0, 1, 0).applyQuaternion(this.stampQ);
    for (let i = 0; i < 26; i++) {
      const sx = (Math.random() * 2 - 1) * hw, sy = (Math.random() * 2 - 1) * hh;
      const p = { x: c.x + right.x * sx + up.x * sy, y: c.y + right.y * sx + up.y * sy, z: c.z + right.z * sx + up.z * sy };
      this.p.emit({ pos: p, count: 2, spread: 4, up: 1.5, life: [0.3, 0.75], size: [0.09, 0.02], sprite: ['spark', 'star4'], additive: true, color: [GOLD, 0xfff6d0, JADE], drag: 2.5, stretch: 0.04 });
    }
    this.p.emit({ pos: c, count: 1, life: [0.22, 0.22], size: [2.4, 0.4], sprite: ['flash0', 'flash1'], additive: true, color: 0xfff0c0, sizeJitter: 0 });
    this.p.emit({ pos: c, count: 5, spread: 1.0, life: [0.5, 0.9], size: [0.15, 0.4], sprite: PUFF, color: [0xf0d8a8, 0xe3bd80], alpha: 0.45, drag: 2.2, rot: 6, rotSpeed: 0.8, jitter: hw * 0.6 });
  }

  private updateStamp(t: number) {
    const st = this.stamp;
    if (!st || !st.mesh.visible) return;
    const m = st.mesh;
    if (t < BEAT.hit) {
      const k = sat((t - BEAT.stamp) / (BEAT.hit - BEAT.stamp));
      const e = k * k * k;
      m.position.lerpVectors(this.stampFrom, this.stampTo, e);
      m.quaternion.copy(this.stampQ).multiply(_q.setFromEuler(new THREE.Euler(0.12 * (1 - e), -0.55 * (1 - e), 0.3 * (1 - e))));
      m.scale.setScalar(1);
    } else {
      const k = t - BEAT.hit;
      // recoil off the impact, then a slow float
      const rec = Math.exp(-k * 9) * Math.sin(k * 30) * 0.05;
      m.position.copy(this.stampTo).addScaledVector(_v.set(0, 0, -1).applyQuaternion(this.stampQ), rec);
      m.position.y += Math.sin(k * 2.2) * 0.012;
      m.quaternion.copy(this.stampQ).multiply(_q.setFromEuler(new THREE.Euler(0, Math.sin(k * 1.3) * 0.04, Math.sin(k * 1.7) * 0.01)));
      m.scale.setScalar(1 + Math.exp(-k * 10) * 0.06);
      // it crumbles to gold dust as the camera pulls back
      const dk = sat((t - (this.tPull - 0.08)) / 0.5);
      st.mat.userData.fx.value.y = dk;
      st.mat.userData.fx.value.z = Math.exp(-k * 5) * 2;
      if (dk > 0 && dk < 1) {
        const r = _v2.set(1, 0, 0).applyQuaternion(this.stampQ);
        for (let i = 0; i < 6; i++) {
          const sx = (Math.random() * 2 - 1) * st.width * 0.5;
          this.p.emit({ pos: { x: m.position.x + r.x * sx, y: m.position.y + (Math.random() - 0.5) * st.height, z: m.position.z + r.z * sx }, count: 1, vel: { x: 0, y: 0.6, z: 0 }, spread: 0.6, life: [0.6, 1.2], size: [0.05, 0.02], sprite: ['grain0', 'grain1', 'star4'], color: [GOLD, 0xe8b860, 0xfff0c0], additive: i % 2 === 0, drag: 1.2, gravity: -0.4 });
        }
      }
      if (dk >= 1) m.visible = false;
    }
  }

  // ---------------------------------------------------------------- the hero

  private eyePositions(): THREE.Vector3[] {
    const rig = this.hero!.rig;
    const out: THREE.Vector3[] = [];
    const head = rig.nodes['head'];
    const fw = head ? _v3.set(0, 0, 1).applyQuaternion(head.getWorldQuaternion(_q2)) : _v3.set(0, 0, 0);
    for (const k of ['eye_l', 'eye_r']) {
      const n = rig.nodes[k] ?? rig.sockets[k];
      if (n) out.push(n.getWorldPosition(new THREE.Vector3()).addScaledVector(fw, 0.035));
    }
    return out;
  }

  private eyeBurst() {
    for (const e of this.eyePositions()) {
      this.p.emit({ pos: e, count: 1, life: [0.3, 0.3], size: [0.7, 0.05], sprite: ['flash0', 'flash2'], additive: true, color: 0xb8ff7a, sizeJitter: 0 });
      this.p.emit({ pos: e, count: 8, spread: 2.5, life: [0.2, 0.45], size: [0.05, 0.01], sprite: ['spark', 'star4'], additive: true, color: [0x9dff3a, 0xeaffd0], drag: 3 });
    }
  }

  private eyes(k: number, rdt: number) {
    if (k <= 0.01) {
      this.lightA.intensity = this.auraT >= 0 ? this.lightA.intensity : 0;
      return;
    }
    const ps = this.eyePositions();
    if (!ps.length) return;
    if (this.auraT < 0) {
      this.lightA.color.setHex(0x7dff3a);
      this.lightA.distance = 2.6;
      this.lightA.position.copy(ps[0]).lerp(ps[ps.length - 1], 0.5);
      this.lightA.intensity = k * (1.5 + Math.sin(this.t * 17) * 0.3);
    }
    // anime eye-fire: jade wisps streaming back off each socket
    if (Math.random() < rdt * 40)
      for (const e of ps)
        this.p.emit({ pos: e, count: 1, vel: { x: 0, y: 0.35, z: 0 }, spread: 0.25, life: [0.25, 0.5], size: [0.07 * k, 0.015], sprite: ['flame0', 'flame1', 'flame2', 'glow8'], additive: true, color: [0x9dff3a, 0xd8ffb0, 0x6aff1a], drag: 1.5, gravity: -0.6 });
  }

  /** the head turns toward the camera (or the gaze target), within what a neck can do */
  private aimHead(rdt: number) {
    const head = this.hero?.rig.nodes['head'];
    if (!head || !this.headQ0 || !head.parent) return;
    const w = 0.6 * sat((this.t - 0.35) / 0.5);
    const target = this.gaze ?? this.ctx.camera.position;
    head.quaternion.copy(this.headQ0);
    head.updateWorldMatrix(true, false);
    const hp = head.getWorldPosition(_v);
    const hq = head.getWorldQuaternion(_q);
    const fw = _v2.set(0, 0, 1).applyQuaternion(hq);
    const to = _v3.copy(target).sub(hp).normalize();
    const dq = _q2.setFromUnitVectors(fw, to);
    const ang = 2 * Math.acos(Math.min(1, Math.abs(dq.w)));
    const ww = w * Math.min(1, 0.85 / Math.max(ang, 1e-4));
    const d2 = _q3.copy(_I).slerp(dq, ww);
    const world = d2.multiply(hq);
    const pq = head.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const target2 = pq.multiply(world);
    // a little lag so the turn is fluid
    this.headLook ??= head.quaternion.clone();
    this.headLook.slerp(target2, 1 - Math.exp(-rdt * 8));
    head.quaternion.copy(this.headLook);
  }
  private headLook: THREE.Quaternion | null = null;

  /** stat aura: light rising through him after a pick */
  private aura(rdt: number) {
    this.auraT += rdt;
    const k = this.auraT;
    const col = this.auraCol.getHex();
    const c = this.heroChest(_v);
    this.lightA.position.copy(c);
    this.lightA.color.copy(this.auraCol);
    this.lightA.intensity = Math.max(0, 1 - k / 1.0) * 9;
    if (k < 0.9) {
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.35;
        this.p.emit({ pos: { x: this.H.x + Math.cos(a) * r, y: this.H.y + Math.random() * this.heroTop, z: this.H.z + Math.sin(a) * r }, count: 1, vel: { x: 0, y: 1.6, z: 0 }, spread: 0.3, life: [0.5, 0.9], size: [0.08, 0.02], sprite: ['glow8', 'star4', 'spark'], additive: true, color: [col, 0xffffff], drag: 0.6, fadeIn: 0.1 });
      }
      if (k < rdt * 1.5) this.p.emit({ pos: { x: this.H.x, y: this.H.y + 0.1, z: this.H.z }, count: 1, life: [0.5, 0.5], size: [0.4, 3.4], sprite: 'ring', additive: true, color: col, sizeJitter: 0 });
    } else if (k > 1.2) this.auraT = -1;
  }

  // ---------------------------------------------------------------- teardown

  private teardown() {
    const eng = this.ctx.engine;
    const u = eng.post.u;
    u.uDesat.value = this.saved.desat;
    u.uCA.value = this.saved.ca;
    if (this.hero) this.hero.material.userData.tint.value.setRGB(1, 1, 1);
    if (this.hero && this.releaseT < 0) {
      const fx = this.hero.material.userData.fx.value;
      fx.x = this.saved.fxX;
      fx.z = this.saved.fxZ;
      if (this.headQ0) this.hero.rig.nodes['head']?.quaternion.copy(this.headQ0);
    }
    this.shock?.dispose();
    this.sigil?.dispose();
    this.vortex?.dispose();
    this.rings?.dispose();
    this.stamp?.dispose();
    this.shock = this.sigil = this.vortex = this.rings = this.stamp = null;
    this.lightA.intensity = this.lightB.intensity = 0;
    this.headLook = null;
    this.alive = false;
    this.owns = false;
  }

  dispose() {
    if (this.alive) this.teardown();
    this.p.group.removeFromParent();
    this.lightA.removeFromParent();
    this.lightB.removeFromParent();
  }
}

// ================================================================== the card moments: skill unlocks and gambles

const smooth = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const easeOut = (k: number) => 1 - Math.pow(1 - sat(k), 3);
const W_UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ voxel-cast Alagard lines (stamps)

export type StampStyle = 'gold' | 'blood';
export interface StampLine {
  text: string;
  px: number;
  /** the glowing core (jade on gold, ember on blood) */
  core?: boolean;
}

/** typography voxelised: stacked Alagard lines extruded into bevelled metal with an inked back plate */
function stampModel(lines: StampLine[], style: StampStyle) {
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  const ms = lines.map((l) => {
    c.font = `${l.px}px Alagard`;
    const m = c.measureText(l.text);
    return { w: m.width, a: m.actualBoundingBoxAscent || l.px * 0.72, d: m.actualBoundingBoxDescent || l.px * 0.1 };
  });
  const gap = 5;
  const W = Math.ceil(Math.max(...ms.map((m) => m.w))) + 14;
  const H = Math.ceil(ms.reduce((a, m) => a + m.a + m.d, 0) + gap * (lines.length - 1)) + 14;
  cv.width = W;
  cv.height = H;
  c.textBaseline = 'alphabetic';
  c.textAlign = 'center';
  let y = 7;
  lines.forEach((l, i) => {
    c.font = `${l.px}px Alagard`;
    c.fillStyle = l.core ? '#00ff00' : '#ff0000';
    c.fillText(l.text, W / 2, y + ms[i].a);
    y += ms[i].a + ms[i].d + gap;
  });
  const img = c.getImageData(0, 0, W, H).data;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && img[(y * W + x) * 4 + 3] > 120;
  const core = (x: number, y: number) => img[(y * W + x) * 4 + 1] > img[(y * W + x) * 4];
  const P =
    style === 'gold'
      ? { lo: 0xc4802a, top: 0xffe9a8, back: 0x5a3410, s0: 0x8a5418, s1: 0xc88a30, c0: 0x6dffb0, c1: 0xeafff4, o0: 0x3a1e0c, o1: 0x1e0f06 }
      : { lo: 0x7e140a, top: 0xffa070, back: 0x380a04, s0: 0x681206, s1: 0xa8361a, c0: 0xff7a2a, c1: 0xffe8a8, o0: 0x2a0804, o1: 0x140402 };
  const m = new VoxelModel('card_stamp');
  const D = 7;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const vy = H - 1 - y;
      if (on(x, y)) {
        let e = 0;
        for (let r = 1; r <= 3; r++) {
          if (on(x - r, y) && on(x + r, y) && on(x, y - r) && on(x, y + r)) e = r;
          else break;
        }
        const ty = 1 - y / H;
        const isCore = core(x, y);
        const face = mixc(mixc(P.lo, P.top, ty), 0xffffff, hash3(x, y, 9) < 0.04 ? 0.5 : 0);
        const front = e >= 1 ? D : D - 1;
        for (let z = 0; z < front; z++) {
          const top = z === front - 1;
          let col = z < 2 ? P.back : mixc(P.s0, P.s1, z / D);
          let fl: number = VF.METAL;
          if (top) {
            col = face;
            if (isCore && e >= 2) {
              col = mixc(P.c0, P.c1, ty * 0.6);
              fl = VF.GLOW;
            } else if (e >= 2 || (!isCore && e >= 1)) fl = VF.METAL | VF.EMISSIVE;
          }
          m.set(x, vy, z, col, fl);
        }
      } else {
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 5 && on(x + dx, y + dy)) ((near = true), 0);
        if (near) for (let z = 0; z < 3; z++) m.set(x, vy, z, z === 2 ? P.o0 : P.o1);
      }
    }
  return { model: m, w: W, h: H };
}

/** a two-line voxel stamp that slams in toward the lens, recoils, floats and crumbles to dust */
export class TextStamp {
  mesh: THREE.Mesh;
  mat: VoxelMaterial;
  width: number;
  height: number;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private t0 = Infinity;
  private dur = 0.16;
  private hitDone = false;
  private crumbleT = Infinity;
  constructor(parent: THREE.Object3D, lines: StampLine[], private style: StampStyle, widthM: number) {
    const { model, w, h } = stampModel(lines, style);
    const vs = widthM / w;
    this.width = widthM;
    this.height = h * vs;
    this.mat = makeVoxelMaterial({ fog: false, emissiveStrength: 1.4 });
    this.mesh = new THREE.Mesh(buildVoxelGeometry(model, { voxelSize: vs, pivot: 'center' }), this.mat);
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  /** slam toward a spot in a camera pose's frame: fx, fy as fractions of the half-frame at depth z */
  place(p: Pose, aspect: number, fx: number, fy: number, z: number, now: number, dur = 0.16) {
    RankUpCine.quatOf({ ...p, roll: 0 }, this.q);
    const right = _v.set(1, 0, 0).applyQuaternion(this.q);
    const up = _v2.set(0, 1, 0).applyQuaternion(this.q);
    const fwd = _v3.set(0, 0, -1).applyQuaternion(this.q);
    const hh = z * Math.tan(THREE.MathUtils.degToRad(p.fov / 2));
    const hw = hh * aspect;
    const x = Math.max(-hw + this.width / 2 + 0.04, Math.min(hw - this.width / 2 - 0.04, fx * hw));
    const y = fy * hh;
    this.to.copy(p.pos).addScaledVector(fwd, z).addScaledVector(right, x).addScaledVector(up, y);
    this.from.copy(p.pos).addScaledVector(fwd, z * 0.25).addScaledVector(right, x * 0.25).addScaledVector(up, y * 0.2 + 0.04);
    this.t0 = now;
    this.dur = dur;
    this.hitDone = false;
    this.crumbleT = Infinity;
    this.mesh.visible = true;
    this.mesh.position.copy(this.from);
    this.mesh.quaternion.copy(this.q);
    this.mat.userData.fx.value.y = 0;
  }

  crumble(now: number) {
    this.crumbleT = Math.min(this.crumbleT, now);
  }

  get shown() {
    return this.mesh.visible;
  }

  /** returns true on the frame it hits */
  update(now: number, p: Particles) {
    const m = this.mesh;
    if (!m.visible) return false;
    const k = (now - this.t0) / this.dur;
    let hit = false;
    if (k < 1) {
      const e = sat(k) ** 3;
      m.position.lerpVectors(this.from, this.to, e);
      m.quaternion.copy(this.q).multiply(_q.setFromEuler(new THREE.Euler(0.12 * (1 - e), -0.55 * (1 - e), 0.3 * (1 - e))));
    } else {
      if (!this.hitDone) {
        this.hitDone = true;
        hit = true;
        this.burst(p);
      }
      const a = now - this.t0 - this.dur;
      const rec = Math.exp(-a * 9) * Math.sin(a * 30) * 0.05;
      m.position.copy(this.to).addScaledVector(_v.set(0, 0, -1).applyQuaternion(this.q), rec);
      m.position.y += Math.sin(a * 2.2) * 0.01;
      m.quaternion.copy(this.q).multiply(_q.setFromEuler(new THREE.Euler(0, Math.sin(a * 1.3) * 0.04, Math.sin(a * 1.7) * 0.01)));
      m.scale.setScalar(1 + Math.exp(-a * 10) * 0.06);
      this.mat.userData.fx.value.z = Math.exp(-a * 5) * 2;
    }
    const dk = sat((now - this.crumbleT) / 0.5);
    this.mat.userData.fx.value.y = dk;
    if (dk > 0 && dk < 1) {
      const r = _v2.set(1, 0, 0).applyQuaternion(this.q);
      const col = this.style === 'gold' ? [GOLD, 0xe8b860, 0xfff0c0] : [0xff6a3a, 0xa8301a, 0xffd0a0];
      for (let i = 0; i < 6; i++) {
        const sx = (Math.random() * 2 - 1) * this.width * 0.5;
        p.emit({ pos: { x: m.position.x + r.x * sx, y: m.position.y + (Math.random() - 0.5) * this.height, z: m.position.z + r.z * sx }, count: 1, vel: { x: 0, y: 0.6, z: 0 }, spread: 0.6, life: [0.6, 1.2], size: [0.05, 0.02], sprite: ['grain0', 'grain1', 'star4'], color: col, additive: i % 2 === 0, drag: 1.2, gravity: -0.4 });
      }
    }
    if (dk >= 1) m.visible = false;
    return hit;
  }

  private burst(p: Particles) {
    const c = this.to;
    const right = _v.set(1, 0, 0).applyQuaternion(this.q);
    const up = _v2.set(0, 1, 0).applyQuaternion(this.q);
    const hw = this.width / 2, hh = this.height / 2;
    const col = this.style === 'gold' ? [GOLD, 0xfff6d0, JADE] : [0xff5a2a, 0xffd0a0, 0xffffff];
    for (let i = 0; i < 26; i++) {
      const sx = (Math.random() * 2 - 1) * hw, sy = (Math.random() * 2 - 1) * hh;
      p.emit({ pos: { x: c.x + right.x * sx + up.x * sy, y: c.y + right.y * sx + up.y * sy, z: c.z + right.z * sx + up.z * sy }, count: 2, spread: 4, up: 1.5, life: [0.3, 0.75], size: [0.09, 0.02], sprite: ['spark', 'star4'], additive: true, color: col, drag: 2.5, stretch: 0.04 });
    }
    p.emit({ pos: c, count: 1, life: [0.22, 0.22], size: [2.2, 0.4], sprite: ['flash0', 'flash1'], additive: true, color: this.style === 'gold' ? 0xfff0c0 : 0xffa080, sizeJitter: 0 });
    p.emit({ pos: c, count: 5, spread: 1.0, life: [0.5, 0.9], size: [0.15, 0.4], sprite: PUFF, color: [0xf0d8a8, 0xe3bd80], alpha: 0.45, drag: 2.2, rot: 6, rotSpeed: 0.8, jitter: hw * 0.6 });
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------ the gamble props: bone dice, a gold coin, a revolver cylinder

/** die half-extent (voxels): 15 voxels a side */
const DIE_N = 7;
export const DIE_VS = 1 / 60;
/** pip layouts on a 3×3 grid */
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};
/** which value sits on which local face: +Y 1, −Y 6, +X 2, −X 5, +Z 3, −Z 4 (opposites sum to 7) */
const FACES: { v: number; axis: 0 | 1 | 2; sgn: 1 | -1 }[] = [
  { v: 1, axis: 1, sgn: 1 },
  { v: 6, axis: 1, sgn: -1 },
  { v: 2, axis: 0, sgn: 1 },
  { v: 5, axis: 0, sgn: -1 },
  { v: 3, axis: 2, sgn: 1 },
  { v: 4, axis: 2, sgn: -1 },
];

/** a carved die with rounded, worn edges and drilled, inked pips (the one is big and red). dark: the dead man's obsidian die */
export function diceModel(dark = false) {
  const m = new VoxelModel(dark ? 'die_black' : 'die_bone');
  const N = DIE_N, h = N + 0.5, r = 2.6;
  const base = dark ? 0x2e2632 : 0xeee0bf;
  const aged = dark ? 0x46363e : 0xcfb582;
  const ink = dark ? 0xf0e2c4 : 0x24160c;
  const pipOf = (p: number[]) => {
    for (const f of FACES) {
      const a = p[f.axis] * f.sgn;
      if (a < N - 1) continue;
      const ui = f.axis === 0 ? 1 : 0, vi = f.axis === 2 ? 1 : 2;
      for (const [pu, pv] of PIPS[f.v]) {
        const big = f.v === 1;
        const rr = big ? 2.35 : 1.6;
        const du = p[ui] - pu * 4, dv = p[vi] - pv * 4;
        if (du * du + dv * dv <= rr * rr) return { a, red: big && !dark };
      }
    }
    return null;
  };
  for (let z = -N; z <= N; z++)
    for (let y = -N; y <= N; y++)
      for (let x = -N; x <= N; x++) {
        const qx = Math.max(0, Math.abs(x) - (h - r)), qy = Math.max(0, Math.abs(y) - (h - r)), qz = Math.max(0, Math.abs(z) - (h - r));
        const sd = Math.hypot(qx, qy, qz) - r;
        if (sd > 0) continue;
        const pip = pipOf([x, y, z]);
        if (pip && pip.a >= N) continue; // drilled
        let c = base;
        if (pip) c = pip.red ? 0xa81c12 : ink;
        else {
          // yellowed toward the worn corners, a few hairline cracks (bone) or glints (obsidian)
          const corner = sat((Math.abs(x) + Math.abs(y) + Math.abs(z) - 13) / 8);
          c = mixc(base, aged, corner * 0.75 + (hash3(x, y, z) < 0.05 ? 0.25 : 0));
          if (!dark && hash3(x * 3 + 1, y, z * 7) < 0.012) c = mixc(c, 0x8a6a40, 0.5);
          if (dark && hash3(x, y * 5, z + 3) < 0.03) c = 0x6a5a70;
        }
        m.set(x, y, z, c, dark ? VF.SOLID | VF.METAL : VF.SOLID);
      }
  return { model: m, voxelSize: DIE_VS, pivot: 'center' as const };
}

/** the die's resting orientation with value v facing up, turned yaw about the vertical */
function dieUp(v: number, yaw: number, out = new THREE.Quaternion()) {
  const e = new THREE.Euler();
  if (v === 6) e.set(Math.PI, 0, 0);
  else if (v === 2) e.set(0, 0, Math.PI / 2);
  else if (v === 5) e.set(0, 0, -Math.PI / 2);
  else if (v === 3) e.set(-Math.PI / 2, 0, 0);
  else if (v === 4) e.set(Math.PI / 2, 0, 0);
  out.setFromEuler(e);
  return out.premultiply(_q3.setFromAxisAngle(W_UP, yaw));
}

const COIN_R = 18;
export const COIN_VS = 0.3 / (COIN_R * 2 + 1);
const segD = (u: number, v: number, a: number[], b: number[]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = sat(((u - a[0]) * dx + (v - a[1]) * dy) / (dx * dx + dy * dy));
  return Math.hypot(u - a[0] - dx * t, v - a[1] - dy * t);
};
const inEl = (u: number, v: number, cx: number, cy: number, rx: number, ry: number) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;

/** heads: Sundown's skull under his hat. Returns 0 (field), 1 (raised), 2 (raised, inked band) */
function coinHeads(u: number, v: number) {
  const eyes = inEl(u, v, -2.6, 0.7, 1.9, 1.7) || inEl(u, v, 2.6, 0.7, 1.9, 1.7);
  const nose = v <= -1.0 && v >= -2.9 && Math.abs(u) <= (v + 2.9) * 0.45 + 0.15;
  const mouth = (v <= -4.1 && v >= -4.9) || (v <= -4.1 && v >= -6.4 && [-3, -1, 1, 3].some((g) => Math.abs(u - g) < 0.45));
  const cran = inEl(u, v, 0, 1.6, 6.3, 5.4);
  const jaw = v >= -7.0 && v <= -1.8 && Math.abs(u) <= 4.4 - Math.max(0, -5.2 - v) * 1.1;
  const brim = Math.abs(v - (6.0 + 0.03 * u * u)) <= 0.95 && Math.abs(u) <= 9.6;
  const crown = v >= 6.4 && v <= 12.2 - Math.max(0, Math.abs(u) - 2.8) * 0.4 && Math.abs(u) <= 5.7 - (v - 6.4) * 0.14;
  const dent = Math.abs(u) <= 0.55 && v >= 10.4;
  const band = v >= 6.6 && v <= 7.7 && Math.abs(u) <= 5.6;
  if ((crown && !dent) || brim) return band ? 2 : 1;
  if ((cran || jaw) && !eyes && !nose && !mouth) return 1;
  return 0;
}

/** tails: Khepri's scarab pushing the sun */
function coinTails(u: number, v: number) {
  if (Math.abs(u) < 0.5 && v < 1.6 && v > -9.4) return 0; // the wing-case seam
  if (inEl(u, v, 0, -3.2, 5.0, 6.2) || inEl(u, v, 0, 4.0, 3.7, 2.0) || inEl(u, v, 0, 6.6, 2.3, 1.2) || inEl(u, v, 0, 10.6, 2.5, 2.5)) return 1;
  const legs = [[[3.8, 3.4], [8.2, 6.0]], [[4.6, -1.2], [9.4, -0.6]], [[4.0, -6.4], [8.0, -10.2]], [[1.6, 7.2], [2.4, 9.6]]];
  for (const [a, b] of legs) if (segD(Math.abs(u), v, a, b) < 0.72) return 1;
  // sun rays round the disc
  const d = Math.hypot(u, v - 10.6), ang = Math.atan2(v - 10.6, u);
  if (d > 3.2 && d < 4.4 && Math.cos(ang * 8) > 0.55 && v > 8.5) return 2;
  return 0;
}

/** a heavy gold coin with a reeded rim and a bead ring: Sundown's skull (heads, +Z) and Khepri's scarab (tails, −Z) */
export function coinModel() {
  const m = new VoxelModel('gamble_coin');
  const R = COIN_R;
  const G = { base: 0xe8b84a, shade: 0xb07c22, hi: 0xffe69a, field: 0xc89430, deep: 0x7a5014 };
  const relief = (f: (u: number, v: number) => number, x: number, y: number, z: number, mirror: boolean) => {
    const u = mirror ? -x : x;
    const k = f(u, y);
    if (!k) return;
    const lit = !f(u - (mirror ? -1 : 1) * 1, y) || !f(u, y + 1);
    const dark = !f(u + (mirror ? -1 : 1), y) || !f(u, y - 1);
    const c = k === 2 ? G.deep : lit && !dark ? G.hi : dark && !lit ? G.shade : G.base;
    m.set(x, y, z, c, VF.SOLID | VF.METAL);
  };
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      const r = Math.hypot(x, y);
      if (r > R + 0.35) continue;
      const ang = Math.atan2(y, x);
      for (let z = -1; z <= 1; z++) m.set(x, y, z, z === 0 ? G.shade : r > R - 2.4 ? G.base : G.field, VF.SOLID | VF.METAL);
      if (r > R - 2.4) {
        // the raised rim, reeded on its edge
        const reed = Math.cos(ang * 70) > 0;
        for (const z of [-3, -2, 2, 3]) m.set(x, y, z, r > R - 0.9 ? (reed ? G.base : G.deep) : Math.abs(z) === 3 ? (y > 0 ? G.hi : G.base) : G.shade, VF.SOLID | VF.METAL);
        continue;
      }
      if (Math.abs(r - (R - 3.9)) < 0.7 && Math.cos(ang * 22) > 0.1) {
        m.set(x, y, 2, G.hi, VF.SOLID | VF.METAL);
        m.set(x, y, -2, G.hi, VF.SOLID | VF.METAL);
        continue;
      }
      relief(coinHeads, x, y, 2, false);
      relief(coinTails, x, y, -2, true);
    }
  return { model: m, voxelSize: COIN_VS, pivot: 'center' as const };
}

const CYL_R = 14;
export const CYL_VS = 0.42 / (CYL_R * 2 + 1);
/** the angle (radians, about the cylinder axis) of chamber k at rest: k = 0 at the top */
const chamberAng = (k: number) => Math.PI / 2 + (k * Math.PI) / 3;

/** a fluted revolver cylinder in blued steel; loaded chambers show a brass case head and a copper primer at the back (−Z) */
export function cylinderModel(loaded: boolean[]) {
  const m = new VoxelModel('gamble_cylinder');
  const R = CYL_R, Z0 = -9, Z1 = 8;
  const S = { base: 0x3e4858, shade: 0x272e3a, hi: 0x8592a6, deep: 0x111419 };
  const B = { base: 0xd8a640, shade: 0x9a6e1c, hi: 0xffe08a };
  const MET = VF.SOLID | VF.METAL;
  const chC = [0, 1, 2, 3, 4, 5].map((k) => [Math.cos(chamberAng(k)) * 8.6, Math.sin(chamberAng(k)) * 8.6]);
  const flC = [0, 1, 2, 3, 4, 5].map((k) => [Math.cos(chamberAng(k) + Math.PI / 6) * (R + 1.3), Math.sin(chamberAng(k) + Math.PI / 6) * (R + 1.3)]);
  for (let z = Z0; z <= Z1; z++)
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++) {
        const r = Math.hypot(x, y);
        const end = z === Z0 || z === Z1;
        if (r > R + 0.3 - (end ? 1 : 0)) continue;
        if (z > Z0 + 2 && z < Z1 - 2 && flC.some(([fx, fy]) => Math.hypot(x - fx, y - fy) < 3.1)) continue; // flutes
        if (r < 1.3) {
          m.set(x, y, z, S.hi, MET); // the centre pin
          continue;
        }
        if (r < 2.3) continue;
        let k = -1, dch = 9;
        chC.forEach(([cx, cy], i) => {
          const d = Math.hypot(x - cx, y - cy);
          if (d < dch) ((dch = d), (k = i));
        });
        if (dch < 3.3) {
          if (!loaded[k]) {
            if (dch > 2.55) m.set(x, y, z, S.deep, MET); // the bore wall, dark
            continue;
          }
          if (z === Z0) {
            m.set(x, y, z, dch < 1.15 ? 0xc0703c : dch < 2.5 ? B.base : B.shade, MET);
            m.set(x, y, Z0 - 1, dch < 1.15 ? 0xd88a4a : dch > 2.45 ? B.hi : B.base, MET); // the case rim stands proud
          } else m.set(x, y, z, dch < 2.55 ? B.shade : S.deep, MET);
          continue;
        }
        const outer = r > R - 1.4;
        const c = outer && end ? S.hi : outer ? (hash3(x, y, z) < 0.06 ? S.hi : S.base) : end ? (r < 4.6 ? S.hi : S.base) : S.shade;
        m.set(x, y, z, c, MET);
      }
  // the ratchet star round the pin, on the back face
  for (let y = -6; y <= 6; y++)
    for (let x = -6; x <= 6; x++) {
      const r = Math.hypot(x, y);
      if (r < 2.3 || r > 5.4) continue;
      const f = (((Math.atan2(y, x) / (Math.PI / 3)) % 1) + 1) % 1;
      if (r < 2.3 + 3.1 * (1 - f)) m.set(x, y, Z0 - 1, f < 0.15 ? S.hi : S.base, MET);
    }
  return { model: m, voxelSize: CYL_VS, pivot: 'center' as const };
}

/** a revolver hammer: a blade with the firing nose at the pivot (bottom) and a checkered spur curling back (−Z) */
export function hammerModel() {
  const m = new VoxelModel('gamble_hammer');
  const S = { base: 0x3e4858, shade: 0x272e3a, hi: 0x8592a6 };
  const MET = VF.SOLID | VF.METAL;
  for (let y = 0; y <= 9; y++)
    for (let x = -2; x <= 2; x++)
      for (let z = -1; z <= 1; z++) {
        const w = y < 2 ? 1 : 2;
        if (Math.abs(x) > w) continue;
        m.set(x, y, z, Math.abs(x) === w ? S.shade : y > 7 ? S.hi : S.base, MET);
      }
  for (let y = -2; y < 0; y++) m.set(0, y, 0, S.hi, MET); // the nose
  for (let i = 0; i < 9; i++) {
    const a = (i / 8) * 1.4;
    const y = 9 + Math.sin(a) * 3.2, z = -Math.round((1 - Math.cos(a)) * 5);
    for (let x = -2; x <= 2; x++) m.set(x, Math.round(y), z, (x + i) % 2 ? S.hi : S.shade, MET); // checkering
  }
  return { model: m, voxelSize: CYL_VS, pivot: [0, 0, 0] as [number, number, number] };
}

const propGeos = new Map<string, THREE.BufferGeometry>();
function propGeo(key: string, make: () => { model: VoxelModel; voxelSize: number; pivot: [number, number, number] | 'center' }) {
  let g = propGeos.get(key);
  if (!g) {
    const p = make();
    g = buildVoxelGeometry(p.model, { voxelSize: p.voxelSize, pivot: p.pivot });
    propGeos.set(key, g);
  }
  return g;
}

// ------------------------------------------------------------------ the world tarot card (a skill being learned)

const TAROT_VS = 0.0088;
let tarotGeo: THREE.BufferGeometry | null = null;
let tarotCoreMat: THREE.MeshStandardMaterial | null = null;
const T_ART = { x: (CARD.win.x0 + CARD.win.x1 + 1) / 2 - CARD.W / 2, y: (CARD.win.y0 + CARD.win.y1 + 1) / 2 - CARD.H / 2, w: CARD.win.x1 - CARD.win.x0 + 1, h: CARD.win.y1 - CARD.win.y0 + 1 };
const T_ART_FS = /* glsl */ `
uniform sampler2D map;
uniform float uHas, uBurn, uT, uFlash, uDis;
varying vec2 vUv;
${NOISE_GLSL}
void main(){
  float g = rh(floor(vUv * vec2(66.0, 88.0)));
  if (uDis > 0.001 && g < uDis * 1.08 - 0.04) discard;
  vec3 photo = texture2D(map, vUv).rgb * 2.0;
  float sh = 0.5 + 0.5 * sin(uT * 3.0 + vUv.x * 9.0 - vUv.y * 6.0);
  vec3 c = mix(vec3(0.06, 0.035, 0.03) + vec3(0.05, 0.035, 0.015) * sh, photo, uHas);
  // the picture burns in from its heart: char ahead of a ragged ember front
  float d = length((vUv - 0.5) * vec2(0.75, 1.0)) * 1.55 + (rn(vUv * 9.0) - 0.5) * 0.24 + (rn(vUv * 31.0) - 0.5) * 0.08;
  float e = d - uBurn * 1.3;
  vec3 charc = vec3(0.045, 0.028, 0.02) + vec3(0.5, 0.16, 0.04) * step(0.985, rh(floor(vUv * 70.0) + floor(uT * 6.0))) * (1.0 - uBurn);
  c = mix(c, charc, smoothstep(-0.015, 0.02, e));
  c += vec3(1.0, 0.5, 0.12) * exp(-e * e * 700.0) * 3.2 * step(uBurn, 0.995) + vec3(1.0, 0.85, 0.5) * exp(-e * e * 4000.0) * 2.0 * step(uBurn, 0.995);
  c = mix(c, vec3(1.6, 1.5, 1.3), uFlash);
  gl_FragColor = vec4(c, 1.0);
}`;

class WorldTarot {
  group = new THREE.Group();
  mat: VoxelMaterial;
  private artMat: THREE.ShaderMaterial;
  private texts: THREE.MeshBasicMaterial[] = [];
  private owned: { dispose(): void }[] = [];
  readonly w = CARD.W * TAROT_VS;
  readonly h = CARD.H * TAROT_VS;
  constructor(parent: THREE.Object3D, num: string, title: string) {
    if (!tarotGeo) {
      const f = tarotFrame();
      tarotGeo = buildVoxelGeometry(f.model, { voxelSize: TAROT_VS, pivot: f.pivot });
    }
    this.mat = makeVoxelMaterial({ fog: false, emissiveStrength: 1.3 });
    const frame = new THREE.Mesh(tarotGeo, this.mat);
    frame.castShadow = true;
    this.group.add(frame);
    tarotCoreMat ??= new THREE.MeshStandardMaterial({ color: 0xb8a078, roughness: 0.9, side: THREE.DoubleSide });
    const coreGeo = new THREE.PlaneGeometry((CARD.W - 0.6) * TAROT_VS, (CARD.H - 0.6) * TAROT_VS);
    const core = new THREE.Mesh(coreGeo, tarotCoreMat);
    core.position.z = -0.5 * TAROT_VS;
    this.group.add(core);
    this.artMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, uHas: { value: 0 }, uBurn: { value: 0 }, uT: { value: 0 }, uFlash: { value: 0 }, uDis: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: T_ART_FS,
    });
    const artGeo = new THREE.PlaneGeometry(T_ART.w * TAROT_VS, T_ART.h * TAROT_VS);
    const art = new THREE.Mesh(artGeo, this.artMat);
    art.position.set(T_ART.x * TAROT_VS, T_ART.y * TAROT_VS, 1.02 * TAROT_VS);
    this.group.add(art);
    this.owned.push(this.mat, this.artMat, artGeo, coreGeo);
    const plaque = (text: string, cx: number, cy: number, w: number, h: number, cap: number) => {
      const tex = plaqueText(text, w, h, cap);
      const mm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
      const g = new THREE.PlaneGeometry(w * TAROT_VS, h * TAROT_VS);
      const q = new THREE.Mesh(g, mm);
      q.position.set((cx + 0.5 - CARD.W / 2) * TAROT_VS, (cy + 0.5 - CARD.H / 2) * TAROT_VS, 3.04 * TAROT_VS);
      q.renderOrder = 2;
      this.group.add(q);
      this.texts.push(mm);
      this.owned.push(tex, mm, g);
    };
    plaque(num, CARD.numeral.cx, CARD.numeral.cy, 20, 7, 0.78);
    plaque(title, CARD.title.cx, CARD.title.cy + 0.5, 54, 8, 0.7);
    parent.add(this.group);
  }
  set art(t: THREE.Texture | null) {
    this.artMat.uniforms.map.value = t;
  }
  get hasArt() {
    return !!this.artMat.uniforms.map.value;
  }
  update(t: number, burn: number, flash: number, has: number) {
    const u = this.artMat.uniforms;
    u.uT.value = t;
    u.uBurn.value = burn;
    u.uFlash.value = flash;
    u.uHas.value = has;
    this.mat.userData.fx.value.x = flash * 0.8;
  }
  dissolve(k: number) {
    this.mat.userData.fx.value.y = k;
    this.artMat.uniforms.uDis.value = k;
    for (const m of this.texts) m.opacity = 1 - Math.min(1, k * 2.2);
  }
  dispose() {
    this.group.removeFromParent();
    for (const d of this.owned) d.dispose();
  }
}

// ------------------------------------------------------------------ the god's sigil, burned into the sand

const SIG_R = 30;
const SIG_VS = 1 / 34;

/** voxel lines of light in the XZ plane: a double ring, a band of the god's signs and the god's emblem */
function godSigilModel(god: string) {
  const m = new VoxelModel('god_sigil_' + god);
  const khepri = god !== 'Serket';
  const A = khepri ? 0xffd36b : 0x9dffc8; // the god's light
  const B = khepri ? 0xffa040 : 0xd8ffb0; // accents
  const C = 0xfff6e0;
  const strokes: ((u: number, v: number) => number | null)[] = [];
  const ring = (rr: number, w: number, col: number) => strokes.push((u, v) => (Math.abs(Math.hypot(u, v) - rr) < w ? col : null));
  const seg = (a: number[], b: number[], w: number, col: number) => strokes.push((u, v) => (segD(u, v, a, b) < w ? col : null));
  const ell = (cx: number, cy: number, rx: number, ry: number, w: number, col: number) =>
    strokes.push((u, v) => {
      const k = Math.hypot((u - cx) / rx, (v - cy) / ry);
      return Math.abs(k - 1) * Math.min(rx, ry) < w ? col : null;
    });
  const disc = (cx: number, cy: number, r: number, col: number) => strokes.push((u, v) => (Math.hypot(u - cx, v - cy) < r ? col : null));
  ring(29.4, 0.55, A);
  ring(27.4, 0.5, A);
  ring(20.6, 0.55, A);
  strokes.push((u, v) => {
    const r = Math.hypot(u, v);
    if (Math.abs(r - 28.4) > 0.75) return null;
    const k = (Math.atan2(v, u) / (Math.PI * 2)) * 48;
    return Math.abs(k - Math.round(k)) < 0.16 ? C : null;
  });
  if (khepri) {
    // sixteen sun rays round the band, long and short
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, L = i % 2 ? 24.4 : 26.4;
      seg([Math.cos(a) * 21.6, Math.sin(a) * 21.6], [Math.cos(a) * L, Math.sin(a) * L], i % 2 ? 0.5 : 0.7, B);
    }
    // the scarab pushing the sun, wings spread
    ell(0, -6, 6.4, 8.2, 0.55, A);
    seg([0, -13.6], [0, 2.0], 0.45, A);
    ell(0, 4.2, 4.8, 2.6, 0.55, A);
    disc(0, 7.6, 2.0, A);
    ell(0, 12.6, 4.0, 4.0, 0.6, B);
    disc(0, 12.6, 1.6, C);
    for (const s of [-1, 1]) {
      seg([s * 5.8, -3.0], [s * 10.6, -1.0], 0.5, A);
      seg([s * 6.0, -8.0], [s * 11.0, -10.4], 0.5, A);
      seg([s * 4.0, -12.6], [s * 7.6, -16.4], 0.5, A);
      seg([s * 2.2, 6.8], [s * 3.6, 9.6], 0.45, A);
      for (let f = 0; f < 5; f++) seg([s * 4.6, 3.2], [s * (17.6 - f * 1.4), 6.6 - f * 2.6], 0.42, f % 2 ? B : A); // the wing's feathers
    }
  } else {
    // Serket: six stinger hooks round the band, the scorpion at the heart
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const r = 21.8 + 4.4 * t, a = a0 + 0.32 * t * t;
        disc(Math.cos(a) * r, Math.sin(a) * r, 0.55 + 0.25 * (1 - t), B);
      }
      const ae = a0 + 0.32;
      seg([Math.cos(ae) * 26.2, Math.sin(ae) * 26.2], [Math.cos(ae + 0.12) * 24.6, Math.sin(ae + 0.12) * 24.6], 0.5, C);
    }
    ell(0, 4.4, 4.2, 3.6, 0.55, A);
    for (const [cy, ry] of [[-0.6, 2.1], [-4.4, 2.0], [-8.0, 1.9]]) ell(0, cy, 3.7, ry, 0.5, A);
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (1.45 - i * 0.24);
      ell(5.4 + Math.cos(a) * 6.2, -9.0 + Math.sin(a) * 6.2 * 1.25, 1.5 - i * 0.08, 1.5 - i * 0.08, 0.45, A);
    }
    seg([9.6, 1.4], [8.0, -0.6], 0.55, C); // the sting
    for (const s of [-1, 1]) {
      seg([s * 3.2, 6.8], [s * 6.6, 10.4], 0.5, A);
      ell(s * 8.6, 13.0, 2.6, 2.0, 0.5, A);
      seg([s * 8.6, 15.0], [s * 6.8, 15.8], 0.45, C);
      for (let k = 0; k < 4; k++) {
        seg([s * 3.6, 3.4 - k * 2.4], [s * 7.4, 4.6 - k * 3.2], 0.45, A);
        seg([s * 7.4, 4.6 - k * 3.2], [s * 9.6, 2.2 - k * 3.6], 0.42, A);
      }
    }
  }
  for (let z = -SIG_R; z <= SIG_R; z++)
    for (let x = -SIG_R; x <= SIG_R; x++) {
      if (Math.hypot(x, z) > SIG_R + 0.5) continue;
      for (const s of strokes) {
        const c = s(x, z);
        if (c !== null) {
          m.set(x, 0, z, c, VF.GLOW);
          break;
        }
      }
    }
  return m;
}
const sigilGeos = new Map<string, THREE.BufferGeometry>();

/** the god's sign brands itself into the dune: an ember front runs in from the rim to the heart, cooling to the god's light */
class GodSigil {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  burn = 0;
  fade = 1;
  constructor(parent: THREE.Object3D, at: THREE.Vector3, yaw: number, groundAt: (x: number, z: number) => number, god: string, scale = 1) {
    let base = sigilGeos.get(god);
    if (!base) {
      base = buildVoxelGeometry(godSigilModel(god), { voxelSize: SIG_VS, pivot: [0, 0, 0] });
      sigilGeos.set(god, base);
    }
    const g = base.clone();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i) * scale, lz = pos.getZ(i) * scale;
      pos.setY(i, groundAt(at.x + lx * cs + lz * sn, at.z - lx * sn + lz * cs) - at.y + 0.03 + pos.getY(i) * 0.25);
    }
    pos.needsUpdate = true;
    g.computeBoundingSphere();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uBurn: { value: 0 }, uFade: { value: 1 }, uTime: globalUniforms.uTime, uR: { value: SIG_R * SIG_VS } },
      vertexColors: true,
      vertexShader: /* glsl */ `varying vec3 vC; varying vec2 vP; void main(){ vC = color; vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uBurn, uFade, uTime, uR; varying vec3 vC; varying vec2 vP;
        void main(){
          float r = length(vP) / uR;
          float k = fract(atan(vP.x, vP.y) / 6.2831853 + 0.5);
          float q = r + k * 0.07;
          float front = 1.12 - uBurn * 1.3;
          float lit = step(front, q);
          float edge = exp(-pow((q - front) * 20.0, 2.0)) * step(uBurn, 0.999);
          float age = clamp((q - front) * 3.0, 0.0, 1.0);
          vec3 hot = vec3(1.0, 0.55, 0.16);
          float flick = 0.86 + 0.14 * sin(uTime * 13.0 + r * 31.0) * sin(uTime * 7.0 - k * 40.0);
          vec3 col = mix(hot * 3.0, vC * 2.3, age) * lit * flick + vec3(1.0, 0.8, 0.45) * edge * 5.0;
          float a = clamp(lit + edge, 0.0, 1.0) * uFade;
          if (a < 0.003) discard;
          gl_FragColor = vec4(col * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.position.copy(at);
    this.mesh.rotation.y = yaw;
    this.mesh.scale.set(scale, 1, scale);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
  }
  update() {
    this.mat.uniforms.uBurn.value = this.burn;
    this.mat.uniforms.uFade.value = this.fade;
    this.mesh.visible = this.fade > 0.003 && this.burn > 0.001;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------ learning a tarot skill: its own short cinematic

type SkillKey3 = 'E' | 'C' | 'G';
const SKILL_LOOK: Record<SkillKey3, { name: string; god: string; pose: CastPose; slow: number; light: number }> = {
  E: { name: 'SCORPION TOSS', god: 'Serket', pose: 'flick', slow: 1.8, light: 0x9dffc8 },
  C: { name: 'SCARAB SWARM', god: 'Khepri', pose: 'whistle', slow: 1.25, light: 0xffd36b },
  G: { name: 'DUNG BOMB', god: 'Khepri', pose: 'grenade', slow: 1.7, light: 0xffc040 },
};

/**
 * The tarot card rises out of the sand on a pillar of light while the god's sigil
 * burns into the dune and the card's picture burns in; Sundown performs the
 * skill's signature cast for the first time under a cast camera; a big voxel
 * "NEW SKILL / SCARAB SWARM [C]" stamp lands. Then (once the caller releases the
 * stage) the card flies into its slot on the HUD bar and the skill unseals.
 */
export class SkillUnlock {
  /** 'show' (stage owned) → 'fly' (stage released, the card flies to the bar) → 'done' */
  stage: 'show' | 'fly' | 'done' = 'show';
  t = 0;
  /** called when the card lands in its slot */
  onLand?: () => void;
  private look: (typeof SKILL_LOOK)[SkillKey3];
  private card: WorldTarot;
  private sigil: GodSigil;
  private pillar: LightPillar;
  private stamp: TextStamp | null = null;
  private S = new THREE.Vector3();
  private base = new THREE.Vector3();
  private top = new THREE.Vector3();
  private face = new THREE.Quaternion();
  private cast = new CastAnim();
  private castOk = false;
  private snap: { n: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3 }[] = [];
  private posed = false;
  private fired = new Set<string>();
  private fast = 1;
  private R: Pose;
  private Cc: Pose;
  private W: Pose;
  private tCast = 2.15;
  private castDur: number;
  private tStamp: number;
  private tEnd: number;
  private fly: { t: number; from: THREE.Vector3; q0: THREE.Quaternion } | null = null;
  private burn = 0;
  private has = 0;
  private lightCol: number;

  constructor(private cine: RankUpCine, private ctx: Ctx, private key: SkillKey3, private art: () => THREE.Texture | null) {
    this.look = SKILL_LOOK[key];
    this.lightCol = this.look.light;
    const def = TAROT.find((d) => d.key === key);
    const H = cine.H;
    // the spot: in front of his chest, turned a little toward the lens
    const f = SkillUnlock.facing(cine, new THREE.Vector3());
    SkillUnlock.spot(cine, ctx.world.groundAt, this.S);
    const yaw = Math.atan2(f.x, f.z);
    this.sigil = new GodSigil(ctx.scene, this.S, yaw, ctx.world.groundAt, this.look.god, 1);
    this.card = new WorldTarot(ctx.scene, def?.num ?? '', def?.title ?? '');
    this.card.group.visible = false;
    this.base.copy(this.S).addScaledVector(W_UP, -this.card.h * 0.62);
    this.top.copy(this.S).addScaledVector(W_UP, this.card.h * 0.5 + 0.22);
    this.pillar = new LightPillar(ctx.scene, this.S, this.card.h + 1.2, this.lightCol, 1.15);
    // the card faces a point between the hero and the stage camera
    const towards = _v2.copy(cine.B.pos).lerp(H, 0.35);
    const m = new THREE.Matrix4().lookAt(towards, this.top, W_UP);
    this.face.setFromRotationMatrix(m);
    // shots: R the reveal (hero and card), C the cast (side-on, low), W the wide stamp shot
    const side = _v3.crossVectors(W_UP, f).normalize();
    if (side.dot(cine.dir) < 0) side.negate();
    const mid = H.clone().lerp(this.S, 0.5);
    this.R = makePose(cine.spot(_v.copy(cine.dir).lerp(side, 0.45).normalize(), 3.6, 0.75), mid.clone().addScaledVector(W_UP, 1.0), 44, 0.03);
    this.Cc = makePose(cine.spot(_v.copy(side).addScaledVector(f, -0.25).normalize(), 2.25, 0.55), H.clone().lerp(this.S, 0.32).addScaledVector(W_UP, cine.heroTop * 0.55), 36, -0.06);
    this.W = makePose(cine.spot(_v.copy(cine.dir).lerp(side, 0.25).normalize(), 4.2, 1.05), mid.clone().addScaledVector(W_UP, 1.1), 48, 0);
    this.castDur = CAST_POSE[this.look.pose].dur * this.look.slow;
    this.tStamp = this.tCast + this.castDur + 0.1;
    this.tEnd = this.tStamp + 0.16 + 1.25;
    if (cine.hero) {
      this.cast.init(cine.hero.rig);
      this.castOk = true;
      cine.hero.root.traverse((o) => {
        if (o === cine.hero!.rig.nodes['head']) return;
        this.snap.push({ n: o, q: o.quaternion.clone(), p: o.position.clone() });
      });
    }
    cine.shoot(this.R, 0.85, true);
    cine.dim = 1;
    cine.gaze = this.top;
  }

  /** the horizontal direction from the hero to where the card rises */
  static facing(cine: RankUpCine, out: THREE.Vector3) {
    return out.copy(cine.chestF).lerp(cine.dir, 0.38).setY(0).normalize();
  }

  /** where the card rises (on the sand in front of his chest, turned a little toward the lens) */
  static spot(cine: RankUpCine, groundAt: (x: number, z: number) => number, out = new THREE.Vector3()) {
    out.copy(cine.H).addScaledVector(SkillUnlock.facing(cine, _v3), 1.55);
    out.y = groundAt(out.x, out.z);
    return out;
  }

  /** click: hurry the show along */
  skip() {
    this.fast = 4;
  }

  /** the show is over: the stage may be released (the card then flies to the bar) */
  get ready() {
    return this.stage === 'show' && this.t >= this.tEnd;
  }

  private once(k: string, at: number) {
    if (this.t < at || this.fired.has(k)) return false;
    this.fired.add(k);
    return true;
  }

  private restorePose() {
    for (const s of this.snap) {
      s.n.quaternion.copy(s.q);
      s.n.position.copy(s.p);
    }
    this.cine.hero?.root.updateMatrixWorld(true);
  }

  update(rdt: number) {
    if (this.stage === 'done') return;
    if (this.stage === 'fly') return this.updateFly(rdt);
    const dt = rdt * this.fast;
    this.t += dt;
    const t = this.t;
    const ctx = this.ctx;
    const cine = this.cine;
    const p = cine.p;
    const S = this.S;
    // ---- the sigil brands the sand
    if (this.once('sigil', 0.05)) {
      ctx.sfx('sand_rise', S, 0.8);
      ctx.sfx('divine_whisper', S, 0.6);
      cine.kick(0.2);
    }
    this.sigil.burn = easeOut((t - 0.05) / 1.2);
    this.sigil.update();
    if (t > 0.05 && t < 1.3 && Math.random() < 0.8) {
      const a = Math.random() * Math.PI * 2, r = (1.12 - this.sigil.burn * 1.3) * SIG_R * SIG_VS;
      if (r > 0.05) p.emit({ pos: { x: S.x + Math.cos(a) * r, y: S.y + 0.05, z: S.z + Math.sin(a) * r }, count: 2, up: 1.4, spread: 0.4, life: [0.3, 0.7], size: [0.05, 0.015], sprite: ['spark', 'flame0', 'flame1'], additive: true, color: [0xffa040, 0xffe0a0], drag: 1.2, gravity: -1 });
    }
    // ---- the card rises out of it on a pillar of light
    const rk = (t - 0.35) / 1.45;
    this.pillar.k = rk < 0 ? 0 : rk < 1 ? Math.min(1, (t - 0.35) / 0.3) : Math.max(0, 1 - (t - 1.8) * 1.4);
    this.pillar.update();
    if (this.once('rise', 0.35)) {
      this.card.group.visible = true;
      ctx.sfx('card_erupt', S, 0.9, 0.9);
      ctx.sfx('loot_reveal', S, 0.7);
      ctx.sfx('quake_rumble', S, 0.6);
      cine.kick(0.35);
      p.emit({ pos: S, count: 30, spread: 3.5, up: 5, life: [0.5, 1.1], size: [0.07, 0.04], sprite: GRAIN, color: SAND, gravity: 11, drag: 1, ground: true, bounce: 0.15 });
      p.emit({ pos: S, count: 7, spread: 1.8, up: 1.2, life: [0.8, 1.6], size: [0.5, 1.3], sprite: PUFF, color: SAND, alpha: 0.75, drag: 2.4, rot: 6, rotSpeed: 0.7, jitter: 0.3 });
    }
    const g = this.card.group;
    if (t >= 0.35) {
      const u = smooth(sat(rk));
      g.position.lerpVectors(this.base, this.top, u);
      g.position.y += Math.sin(t * 1.6) * 0.015 * u;
      // one slow turn as it rises: it shows its sculpted back, then comes round to face him and the lens
      g.quaternion.copy(this.face).multiply(_q.setFromAxisAngle(W_UP, Math.PI * 2 * (1 - easeOut(sat(rk * 1.05)))));
      if (rk < 0.8 && Math.random() < 0.9) {
        _v.set((Math.random() - 0.5) * this.card.w, -this.card.h * 0.5, 0).applyQuaternion(g.quaternion).add(g.position);
        if (_v.y > S.y - 0.05) p.emit({ pos: _v, count: 2, vel: { x: 0, y: -0.5, z: 0 }, spread: 0.6, life: [0.5, 0.9], size: [0.05, 0.03], sprite: GRAIN, color: SAND, gravity: 9, drag: 0.6, ground: true, bounce: 0.1 });
      }
    }
    // ---- the picture burns in
    if (this.once('burn', 1.25)) {
      ctx.sfx('divine_power', S, 0.7, 1.1);
      ctx.sfx('dynamite_fuse', S, 0.35, 1.3);
    }
    const tex = this.art();
    if (tex && !this.card.hasArt) this.card.art = tex;
    this.has = this.card.hasArt ? Math.min(1, this.has + dt * 3) : 0;
    this.burn = this.has > 0.5 ? Math.min(1, this.burn + (t > 1.25 ? dt / 0.85 : 0)) : this.burn;
    if (t > 1.25 && this.burn < 1 && Math.random() < 0.7) {
      _v.set((Math.random() - 0.5) * this.card.w * 0.6, (Math.random() - 0.3) * this.card.h * 0.6, 0.03).applyQuaternion(g.quaternion).add(g.position);
      p.emit({ pos: _v, count: 1, up: 1.2, spread: 0.3, life: [0.3, 0.6], size: [0.04, 0.012], sprite: ['spark', 'flame0'], additive: true, color: [0xffa040, 0xffe0a0], drag: 1, gravity: -1.5 });
    }
    this.card.update(t, this.burn, Math.max(0, 1 - (t - 2.1) * 3) * (t > 2.1 ? 0.5 : 0), this.has);
    // ---- the first cast: his signature pose under a cast camera
    if (this.once('castCam', this.tCast - 0.25)) cine.shoot(this.Cc, 0.4);
    // the cast camera creeps in during the pose
    if (t > this.tCast - 0.25 && t < this.tStamp) this.Cc.fov = 36 - 4 * sat((t - this.tCast) / this.castDur);
    const hero = cine.hero;
    if (hero && this.castOk && t >= this.tCast && t < this.tCast + this.castDur) {
      const k = (t - this.tCast) / this.castDur;
      this.restorePose();
      this.cast.apply(hero.rig, this.look.pose, k, this.S.clone().addScaledVector(W_UP, 0.4), t);
      this.posed = true;
    } else if (this.posed) {
      this.posed = false;
      this.restorePose();
    }
    if (this.once('release', this.tCast + this.castDur * CAST_POSE[this.look.pose].release)) this.castFx();
    // ---- NEW SKILL
    if (this.once('stamp', this.tStamp)) {
      cine.shoot(this.W, 0.35);
      this.stamp = new TextStamp(ctx.scene, [{ text: 'NEW SKILL', px: 30 }, { text: `${this.look.name}  [${this.key}]`, px: 48, core: true }], 'gold', 1.15);
      const aspect = ctx.engine.width / ctx.engine.height;
      this.stamp.place(this.W, aspect, 0, 0.42, 1.9, t);
      ctx.sfx('melee_whoosh', null, 0.8, 0.7);
    }
    if (this.stamp?.update(t, p)) {
      cine.kick(0.6, -5);
      ctx.engine.flash(0xfff2c0, 0.36, 0.2);
      ctx.sfx('poster_slam', null, 1.0, 0.85);
      ctx.sfx('rank_up', null, 0.7, 1.05);
      ctx.sfx('explosion', null, 0.3, 1.5);
    }
    this.sigil.fade = 1 - sat((t - this.tEnd + 0.3) / 0.6) * 0.6;
  }

  /** the skill's own burst at the moment of release: the brood flies, the swarm boils up, the dung ball lands */
  private castFx() {
    const ctx = this.ctx;
    const cine = this.cine;
    const p = cine.p;
    const hand = cine.hero?.rig.sockets['hand_l'] ?? cine.hero?.rig.nodes['fore_l'];
    const from = hand ? hand.getWorldPosition(new THREE.Vector3()) : cine.heroChest();
    const S = this.S;
    const to = _v.copy(S).sub(from);
    const fl = 0.55;
    const vel = { x: to.x / fl, y: to.y / fl + 4.5, z: to.z / fl };
    if (this.key === 'E') {
      ctx.sfx('scorpion_throw', from, 0.9);
      ctx.sfx('spectral_scorpion', S, 0.6);
      ctx.engine.tweens.after(0.5, () => ctx.sfx('scorpion_chitter', S, 0.7), true);
      p.emit({ pos: from, count: 9, vel, spread: 1.6, life: [0.55, 0.75], size: [0.16, 0.14], sprite: 'scorp_x2', color: 0xffffff, gravity: 9, ground: true, bounce: 0.2, drag: 0.2, sizeJitter: 0.2 });
      p.emit({ pos: from, count: 26, vel, spread: 2.2, life: [0.4, 0.8], size: [0.06, 0.02], sprite: ['dot3', 'spark', 'bubble'], additive: true, color: [0x9dff3a, 0xd8ff9a], gravity: 9, drag: 0.4 });
      ctx.engine.tweens.after(0.5, () => p.emit({ pos: S, count: 3, spread: 1.4, life: [1.2, 1.8], size: [0.3, 0.5], sprite: 'venomSplat', color: 0xffffff, ground: true, gravity: 4, rot: 6 }), true);
    } else if (this.key === 'C') {
      ctx.sfx('divine_whisper', from, 0.7, 1.6);
      ctx.sfx('sand_spray', S, 0.9);
      ctx.engine.tweens.after(0.15, () => ctx.sfx('scarab_squish', S, 0.7, 0.8), true);
      p.emit({ pos: S, count: 40, spread: 3, up: 3.5, life: [0.6, 1.1], size: [0.06, 0.04], sprite: GRAIN, color: SAND, gravity: 10, ground: true, bounce: 0.15, drag: 0.6 });
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.6;
        p.emit({ pos: { x: S.x + Math.cos(a) * 0.2, y: S.y + 0.05, z: S.z + Math.sin(a) * 0.2 }, count: 1, vel: { x: Math.cos(a) * sp, y: 1.5 + Math.random() * 2, z: Math.sin(a) * sp }, life: [0.8, 1.4], size: [0.13, 0.11], sprite: 'scarab_x2', color: 0xffffff, gravity: 8, ground: true, bounce: 0.05, drag: 0.5, delay: Math.random() * 0.4, sizeJitter: 0.25 });
      }
    } else {
      ctx.sfx('dung_kick', from, 0.9);
      ctx.sfx('dynamite_fuse', from, 0.5);
      p.emit({ pos: from, count: 1, vel, life: [0.55, 0.55], size: [0.26, 0.26], sprite: 'dung_x2', color: 0xffffff, gravity: 9, sizeJitter: 0 });
      p.emit({ pos: from, count: 20, vel, spread: 0.6, life: [0.3, 0.55], size: [0.05, 0.01], sprite: 'spark', additive: true, color: [0xffd36b, 0xff8a3a], gravity: 9, delay: 0.02 });
      ctx.engine.tweens.after(0.55, () => {
        ctx.sfx('explosion', S, 0.5, 1.2);
        ctx.sfx('poison_burst', S, 0.8);
        this.cine.kick(0.4);
        p.emit({ pos: S, count: 1, life: [0.25, 0.25], size: [1.6, 0.3], sprite: ['flash0', 'flash1'], additive: true, color: 0xffd8a0, sizeJitter: 0 });
        p.emit({ pos: S, count: 12, spread: 1.6, up: 0.8, life: [1.4, 2.4], size: [0.5, 1.4], sprite: PUFF, color: [0x9dcf4a, 0x7fae3a, 0xb8e070], alpha: 0.6, drag: 1.6, rot: 6, rotSpeed: 0.5, jitter: 0.4 });
        p.emit({ pos: S, count: 30, spread: 4, up: 3, life: [0.5, 1.0], size: [0.07, 0.04], sprite: GRAIN, color: SAND, gravity: 10, ground: true, bounce: 0.15 });
      }, true);
    }
    // the god's light answers from the card
    p.emit({ pos: this.card.group.position, count: 24, spread: 3, life: [0.3, 0.7], size: [0.1, 0.02], sprite: ['spark', 'star4'], additive: true, color: [this.lightCol, 0xffffff], drag: 2.5 });
  }

  /** the stage has been released: fly into the slot on the bar */
  release() {
    if (this.stage !== 'show') return;
    if (this.posed) this.restorePose();
    this.posed = false;
    this.stage = 'fly';
    this.stamp?.crumble(this.t);
    this.fly = { t: 0, from: this.card.group.position.clone(), q0: this.card.group.quaternion.clone() };
    this.ctx.sfx('whoosh_big', this.card.group.position, 0.7, 1.1);
    this.ctx.sfx('card_flip', null, 0.6, 0.9);
  }

  private updateFly(rdt: number) {
    const f = this.fly!;
    const ctx = this.ctx;
    const cam = ctx.camera;
    this.t += rdt;
    this.stamp?.update(this.t, this.cine.p);
    this.sigil.fade = Math.max(0, this.sigil.fade - rdt * 1.5);
    this.sigil.update();
    f.t = Math.min(1, f.t + rdt / 0.85);
    const k = f.t;
    const e = k * k * (3 - 2 * k);
    // the slot on the bar (normalised screen coordinates), or the bottom-right corner
    const slot = TarotBar.current?.slot(this.key) ?? { x: 0.82, y: 0.88, h: 0.16 };
    const D = 0.9;
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const dir = _v.set(slot.x * 2 - 1, 1 - slot.y * 2, 0.5).unproject(cam).sub(cam.position).normalize();
    const target = _v2.copy(cam.position).addScaledVector(dir, D);
    const g = this.card.group;
    const mid = _v3.copy(f.from).lerp(target, 0.5).addScaledVector(W_UP, 0.6 * (1 - k));
    const a = 1 - e;
    g.position.set(a * a * f.from.x + 2 * a * e * mid.x + e * e * target.x, a * a * f.from.y + 2 * a * e * mid.y + e * e * target.y, a * a * f.from.z + 2 * a * e * mid.z + e * e * target.z);
    // shrink to the slot's height and turn to show the sculpted back (the bar card turns face up as it lands)
    const want = (slot.h * 2 * D * tanH) / this.card.h;
    g.scale.setScalar(THREE.MathUtils.lerp(1, want, e));
    const qc = _q2.copy(cam.quaternion).multiply(_q3.setFromAxisAngle(W_UP, Math.PI));
    g.quaternion.copy(f.q0).slerp(qc, e);
    g.rotateZ(Math.sin(k * Math.PI) * 0.4);
    this.card.update(this.t, 1, Math.max(0, (k - 0.75) * 4), 1);
    if (Math.random() < 0.9) this.cine.p.emit({ pos: g.position, count: 2, spread: 0.4, life: [0.15, 0.35], size: [0.04 * (1 - e * 0.7), 0.01], sprite: ['spark', 'star4', 'glow8'], additive: true, color: [this.lightCol, 0xffffff], drag: 2 });
    if (k >= 1) this.land();
  }

  private land() {
    this.stage = 'done';
    this.card.group.visible = false;
    this.ctx.sfx('divine_chime', null, 0.8, 1.1);
    this.ctx.sfx('gem_chime', null, 0.6, 1.2);
    TarotBar.current?.landFx(this.key, this.lightCol);
    this.onLand?.();
  }

  /** land now (the picker is going away) */
  finishNow() {
    if (this.stage === 'done') return;
    if (this.posed) this.restorePose();
    this.posed = false;
    this.land();
  }

  dispose() {
    if (this.posed) this.restorePose();
    this.card.dispose();
    this.sigil.dispose();
    this.pillar.dispose();
    this.stamp?.dispose();
    this.cine.dim = 0;
  }
}

// ------------------------------------------------------------------ a gamble played out: dice, a coin, the chamber

interface DieRun {
  mesh: THREE.Mesh;
  mat: VoxelMaterial;
  from: THREE.Vector3;
  land: THREE.Vector3;
  qEnd: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  delay: number;
  bounced: number;
}

const DIE_H = DIE_N + 0.5;
/** timeline of a thrown die: flight, two bounces, a short roll (seconds after the throw) */
const DIE_T = { fly: 0.55, b1: 0.28, b2: 0.16, roll: 0.26 };
const DIE_SETTLE = DIE_T.fly + DIE_T.b1 + DIE_T.b2 + DIE_T.roll;

/**
 * The picked gamble becomes its prop and the outcome (decided at the pick) plays
 * out: bone dice tumble onto the sand and settle on their faces, a gold coin
 * spins high and wobbles flat, or a revolver cylinder spins, clicks home and the
 * hammer falls. Then a verdict stamp slams in and `onReveal` commits the result.
 */
export class GambleShow {
  t = 0;
  done = false;
  /** commit the outcome (called once, at the reveal) */
  onReveal?: () => void;
  private fast = 1;
  private fired = new Set<string>();
  private dice: DieRun[] = [];
  private coin: { mesh: THREE.Mesh; mat: VoxelMaterial; q0: THREE.Quaternion; ax: THREE.Vector3; land: THREE.Vector3; spin: number } | null = null;
  private cyl: { mesh: THREE.Mesh; mat: VoxelMaterial; ham: THREE.Mesh; at: THREE.Vector3; q: THREE.Quaternion; spin: number; end: number; lastStep: number } | null = null;
  private stamp: TextStamp | null = null;
  private G = new THREE.Vector3();
  private D = new THREE.Vector3();
  private toCam = new THREE.Vector3();
  private shot: Pose;
  private tReveal: number;
  private tDone: number;
  private light: THREE.PointLight | null = null;
  private ring = 0;

  constructor(private cine: RankUpCine, private ctx: Ctx, private o: GambleOutcome, deal: THREE.Vector3) {
    const H = cine.H;
    this.D.copy(deal);
    this.toCam.copy(cine.B.pos).sub(H).setY(0).normalize();
    const f = _v.copy(cine.chestF).lerp(this.toCam, 0.6).normalize();
    this.G.copy(H).addScaledVector(f, 1.45);
    this.G.y = ctx.world.groundAt(this.G.x, this.G.z);
    const side = _v2.crossVectors(W_UP, this.toCam).normalize();
    cine.dim = 0.7;
    cine.gaze = this.G;
    if (o.prop === 'dice') {
      const n = o.dice?.length ?? 2;
      for (let i = 0; i < n; i++) {
        const dark = !!o.dark?.[i];
        const mat = makeVoxelMaterial({ fog: false });
        const mesh = new THREE.Mesh(propGeo(dark ? 'die_black' : 'die_bone', () => diceModel(dark)), mat);
        mesh.castShadow = true;
        mesh.visible = false;
        ctx.scene.add(mesh);
        const land = this.G.clone().addScaledVector(side, (i - (n - 1) / 2) * 0.34).addScaledVector(this.toCam, (Math.random() - 0.5) * 0.12);
        land.y = ctx.world.groundAt(land.x, land.z);
        const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize();
        // the face up turned so the pips square up to the lens
        const yaw = Math.atan2(this.toCam.x, this.toCam.z) + (Math.random() - 0.5) * 0.5;
        this.dice.push({ mesh, mat, from: this.D.clone().addScaledVector(side, (i - (n - 1) / 2) * 0.12), land, qEnd: dieUp(o.dice![i], yaw), axis, spin: Math.PI * (7 + Math.random() * 3), delay: i * 0.06, bounced: 0 });
      }
      this.shot = makePose(this.G.clone().addScaledVector(this.toCam, 1.25).addScaledVector(W_UP, 1.0), this.G.clone().addScaledVector(W_UP, 0.12), 38);
      this.tReveal = 0.12 + DIE_SETTLE + 0.12 + 0.06 * n;
    } else if (o.prop === 'coin') {
      const mat = makeVoxelMaterial({ fog: false, emissiveStrength: 1.2 });
      const mesh = new THREE.Mesh(propGeo('coin', coinModel), mat);
      mesh.castShadow = true;
      mesh.visible = false;
      ctx.scene.add(mesh);
      // flat (heads up) = local +Z to world up; it spins about a horizontal axis across the lens
      const q0 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), W_UP);
      const ax = side.clone();
      this.coin = { mesh, mat, q0, ax, land: this.G.clone(), spin: Math.PI * 2 * 8 + (o.heads ? 0 : Math.PI) };
      this.shot = makePose(this.G.clone().addScaledVector(this.toCam, 1.0).addScaledVector(W_UP, 0.95), this.G.clone().addScaledVector(W_UP, 0.05), 36);
      this.tReveal = 2.15;
    } else {
      const loaded = o.loaded ?? [true, false, false, false, false, false];
      const mat = makeVoxelMaterial({ fog: false, emissiveStrength: 1.4 });
      const mesh = new THREE.Mesh(buildVoxelGeometry(cylinderModel(loaded).model, { voxelSize: CYL_VS, pivot: 'center' }), mat);
      mesh.castShadow = true;
      mesh.visible = false;
      ctx.scene.add(mesh);
      const ham = new THREE.Mesh(propGeo('hammer', hammerModel), mat);
      ham.visible = false;
      ctx.scene.add(ham);
      const at = H.clone().addScaledVector(this.toCam, 1.25).addScaledVector(W_UP, cine.heroTop * 0.66);
      // the back face (−Z, the case heads) toward the stage camera
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(at, cine.B.pos, W_UP));
      const end = -(o.stop ?? 0) * (Math.PI / 3);
      this.cyl = { mesh, mat, ham, at, q, spin: Math.PI * 2 * 6, end, lastStep: 0 };
      this.shot = makePose(at.clone().addScaledVector(_v3.copy(cine.B.pos).sub(at).normalize(), 1.15).addScaledVector(W_UP, 0.06), at.clone(), 34);
      this.tReveal = 2.55;
      this.light = new THREE.PointLight(0xffd8a0, 0, 2.5, 1.5);
      this.light.castShadow = false;
    }
    this.tDone = this.tReveal + (o.jackpot ? 1.9 : 1.6);
    ctx.sfx('card_flip', this.D, 0.7, 0.8);
    ctx.sfx('gem_chime', this.D, 0.5, 0.9);
    cine.p.emit({ pos: this.D, count: 30, spread: 5, life: [0.25, 0.6], size: [0.12, 0.02], sprite: ['spark', 'star4', 'streak'], additive: true, color: [0xffd36b, 0xffffff], drag: 3, stretch: 0.04 });
    cine.p.emit({ pos: this.D, count: 1, life: [0.24, 0.24], size: [1.3, 0.2], sprite: ['flash0', 'flash1', 'flash2'], additive: true, color: 0xffe0a0, sizeJitter: 0 });
  }

  skip() {
    this.fast = 3.5;
  }

  private once(k: string, at: number) {
    if (this.t < at || this.fired.has(k)) return false;
    this.fired.add(k);
    return true;
  }

  update(rdt: number) {
    if (this.done) return;
    const dt = rdt * this.fast;
    this.t += dt;
    const t = this.t;
    const ctx = this.ctx;
    const cine = this.cine;
    if (this.once('shot', 0.1)) cine.shoot(this.shot, this.o.prop === 'chamber' ? 0.45 : 0.75);
    if (this.o.prop === 'dice') this.updateDice(t);
    else if (this.o.prop === 'coin') this.updateCoin(t);
    else this.updateChamber(t);
    // ---- the verdict
    if (this.once('reveal', this.tReveal)) this.reveal();
    if (this.stamp?.update(t, cine.p)) {
      cine.kick(this.o.win ? 0.45 : 0.6, -4);
      ctx.sfx('poster_slam', null, 0.8, this.o.win ? 1.0 : 0.8);
    }
    // the props turn to sand at the end
    const dk = sat((t - this.tDone + 0.45) / 0.45);
    if (dk > 0) {
      for (const d of this.dice) d.mat.userData.fx.value.y = dk;
      if (this.coin) this.coin.mat.userData.fx.value.y = dk;
      if (this.cyl) this.cyl.mat.userData.fx.value.y = dk;
      if (this.once('crumble', this.tDone - 0.45)) {
        this.stamp?.crumble(t);
        ctx.sfx('sand_burst', this.G, 0.4, 1.3);
      }
    }
    if (t >= this.tDone) this.done = true;
  }

  private reveal() {
    const ctx = this.ctx;
    const cine = this.cine;
    const o = this.o;
    this.onReveal?.();
    const at = o.prop === 'chamber' ? this.cyl!.at : this.G;
    if (o.win) {
      ctx.sfx('sting_positive', at, 0.9);
      ctx.sfx(o.jackpot ? 'loot_reveal' : 'gold_burst', at, 0.8);
      if (o.jackpot) {
        ctx.sfx('divine_power', at, 0.8);
        ctx.sfx('quake_rumble', at, 0.6);
      }
      cine.p.emit({ pos: at, count: o.jackpot ? 60 : 30, spread: 4.5, up: 2.5, life: [0.5, 1.1], size: [0.12, 0.04], sprite: ['coinspin0', 'coinspin1', 'coinspin2', 'star4', 'spark'], color: [0xffffff, 0xffd36b], gravity: 6, ground: true, bounce: 0.35, drag: 0.4 });
      cine.p.emit({ pos: at, count: 1, life: [0.5, 0.5], size: [0.4, 2.8], sprite: 'ring', additive: true, color: 0x9dff5a, sizeJitter: 0 });
    } else {
      ctx.sfx('sting_negative', at, 0.9);
      cine.p.emit({ pos: at, count: 10, spread: 1.4, up: 1.0, life: [0.9, 1.6], size: [0.3, 0.9], sprite: PUFF, color: [0x3a2a2a, 0x5a4040, 0x2a2020], alpha: 0.6, drag: 1.8, rot: 6, rotSpeed: 0.5 });
      cine.p.emit({ pos: at, count: 24, spread: 4, up: 1, life: [0.4, 0.8], size: [0.08, 0.02], sprite: ['spark', 'star4'], additive: true, color: [0xff4a2a, 0xffa080], drag: 2.5 });
    }
    for (const d of this.dice) d.mat.userData.fx.value.x = 0.7;
    if (this.coin) this.coin.mat.userData.fx.value.x = 0.6;
    const lines: StampLine[] = [{ text: o.title, px: 54, core: true }, { text: o.line, px: 24 }];
    this.stamp = new TextStamp(ctx.scene, lines, o.win ? 'gold' : 'blood', 0.95);
    this.stamp.place(this.shot, ctx.engine.width / ctx.engine.height, 0, 0.5, 1.5, this.t, 0.15);
  }

  // ---- dice
  private updateDice(t: number) {
    const ctx = this.ctx;
    const p = this.cine.p;
    if (this.once('throw', 0.12)) ctx.sfx('whoosh', this.D, 0.6, 1.3);
    for (const d of this.dice) {
      const m = d.mesh;
      const tt = t - 0.12 - d.delay;
      if (tt < -0.12 - d.delay + 0.001) continue;
      m.visible = true;
      if (tt < 0) {
        // conjured out of the card's light
        m.position.copy(d.from);
        m.scale.setScalar(easeOut((t + 0.0) / 0.12));
        m.quaternion.copy(d.qEnd).multiply(_q.setFromAxisAngle(d.axis, d.spin));
        continue;
      }
      m.scale.setScalar(1);
      const k = Math.min(1, tt / DIE_SETTLE);
      const left = Math.pow(1 - k, 2.2);
      m.quaternion.copy(d.qEnd).multiply(_q.setFromAxisAngle(d.axis, d.spin * left));
      // the lowest corner stays on the sand: centre height from the rotated half-extents
      m.updateMatrix();
      const e = m.matrix.elements;
      const reach = DIE_H * DIE_VS * 0.94 * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9]));
      const g = d.land.y + reach;
      let x: number, z: number, y: number;
      if (tt < DIE_T.fly) {
        const u = tt / DIE_T.fly;
        x = THREE.MathUtils.lerp(d.from.x, d.land.x, u * 0.85);
        z = THREE.MathUtils.lerp(d.from.z, d.land.z, u * 0.85);
        y = THREE.MathUtils.lerp(d.from.y, g, u) + Math.sin(u * Math.PI) * 0.45;
      } else {
        const u2 = tt - DIE_T.fly;
        const s = 0.85 + 0.15 * smooth(Math.min(1, u2 / (DIE_T.b1 + DIE_T.b2 + DIE_T.roll)));
        x = THREE.MathUtils.lerp(d.from.x, d.land.x, s);
        z = THREE.MathUtils.lerp(d.from.z, d.land.z, s);
        let hop = 0;
        if (u2 < DIE_T.b1) hop = Math.sin((u2 / DIE_T.b1) * Math.PI) * 0.2;
        else if (u2 < DIE_T.b1 + DIE_T.b2) hop = Math.sin(((u2 - DIE_T.b1) / DIE_T.b2) * Math.PI) * 0.06;
        y = g + hop;
        const nb = u2 < DIE_T.b1 ? 1 : u2 < DIE_T.b1 + DIE_T.b2 ? 2 : 3;
        if (nb > d.bounced) {
          d.bounced = nb;
          ctx.sfx('hit_bone', d.land, 0.55 / nb, 1.5 + nb * 0.1);
          p.emit({ pos: { x, y: d.land.y + 0.02, z }, count: 10 / nb, spread: 1.6, up: 1.4, life: [0.4, 0.8], size: [0.05, 0.03], sprite: GRAIN, color: SAND, gravity: 10, ground: true, bounce: 0.1 });
          if (nb === 1) p.emit({ pos: { x, y: d.land.y + 0.05, z }, count: 2, spread: 0.6, up: 0.3, life: [0.6, 1.0], size: [0.2, 0.5], sprite: PUFF, color: SAND, alpha: 0.6, drag: 2, rot: 6 });
        }
      }
      m.position.set(x, y, z);
    }
  }

  // ---- coin
  private updateCoin(t: number) {
    const c = this.coin!;
    const m = c.mesh;
    const ctx = this.ctx;
    const p = this.cine.p;
    const T0 = 0.12, T1 = 1.3, T2 = 1.55, T3 = 2.1;
    m.visible = true;
    if (t < T0) {
      m.position.copy(this.D);
      m.scale.setScalar(easeOut(t / T0));
      m.quaternion.copy(c.q0).premultiply(_q.setFromAxisAngle(c.ax, c.spin + Math.PI * 12 + Math.PI / 2));
      return;
    }
    m.scale.setScalar(1);
    if (this.once('flip', T0)) {
      ctx.sfx('pickup_gold', this.D, 0.8, 1.3);
      ctx.sfx('whoosh', this.D, 0.5, 1.6);
    }
    const r = COIN_R * COIN_VS;
    if (t < T1) {
      const u = (t - T0) / (T1 - T0);
      m.position.lerpVectors(this.D, c.land, u);
      m.position.y = THREE.MathUtils.lerp(this.D.y, c.land.y + r * 0.2, u) + Math.sin(u * Math.PI) * 2.1;
      const left = 1 - easeOut(u);
      m.quaternion.copy(c.q0).premultiply(_q.setFromAxisAngle(c.ax, c.spin + left * Math.PI * 2 * 6 + Math.PI / 2 * (1 - u)));
      if (Math.random() < 0.6) p.emit({ pos: m.position, count: 1, spread: 0.3, life: [0.15, 0.3], size: [0.04, 0.01], sprite: ['spark', 'star4'], additive: true, color: [0xffd36b, 0xffffff], drag: 2 });
      return;
    }
    if (this.once('land', T1)) {
      ctx.sfx('pickup_gold', c.land, 0.9, 0.9);
      p.emit({ pos: c.land, count: 12, spread: 1.4, up: 1.2, life: [0.4, 0.8], size: [0.05, 0.03], sprite: GRAIN, color: SAND, gravity: 10, ground: true, bounce: 0.1 });
    }
    // a little hop, then it rings down like a spun plate
    const hop = t < T2 ? Math.sin(((t - T1) / (T2 - T1)) * Math.PI) * 0.07 : 0;
    const w = t < T2 ? 0.45 : 0.45 * Math.exp(-(t - T2) * 4.5) * (1 - smooth((t - T2) / (T3 - T2)));
    const prec = (t - T1) * (9 + (t - T1) * 26);
    const flat = _q2.copy(c.q0).premultiply(_q.setFromAxisAngle(c.ax, c.spin));
    _v.set(Math.cos(prec), 0, Math.sin(prec));
    m.quaternion.copy(flat).premultiply(_q.setFromAxisAngle(_v, w));
    m.position.copy(c.land);
    m.position.y += hop + Math.sin(w) * r + 0.012;
    const step = Math.floor(prec / (Math.PI * 0.9));
    if (t > T2 && t < T3 && step !== this.ring) {
      this.ring = step;
      ctx.sfx('gem_chime', c.land, 0.18, 1.6 + (t - T2) * 1.2);
    }
  }

  // ---- revolver chamber
  private updateChamber(t: number) {
    const c = this.cyl!;
    const m = c.mesh;
    const ctx = this.ctx;
    const p = this.cine.p;
    const T0 = 0.12, Ts = 0.4, Te = 1.95, Th = 2.45;
    m.visible = c.ham.visible = true;
    const pop = easeOut(t / T0);
    m.scale.setScalar(pop);
    c.ham.scale.setScalar(pop);
    if (this.once('open', 0.02)) ctx.sfx('rev_open', c.at, 0.8);
    if (this.once('spin', Ts)) {
      ctx.sfx('rev_spin', c.at, 1.0);
      this.cine.kick(0.15);
    }
    let ang = c.end + c.spin;
    if (t >= Ts) {
      const u = sat((t - Ts) / (Te - Ts));
      ang = c.end + c.spin * Math.pow(1 - u, 2.6);
      // the pawl clicks over each chamber as it slows
      const st = Math.floor((ang - c.end) / (Math.PI / 3));
      if (st !== c.lastStep && u > 0.55) ctx.sfx('ui_click', c.at, 0.35, 0.8 + u * 0.3);
      c.lastStep = st;
    }
    if (this.once('lock', Te)) {
      ctx.sfx('rev_close', c.at, 0.9);
      this.cine.kick(0.2);
    }
    m.position.copy(c.at);
    m.quaternion.copy(c.q).multiply(_q.setFromAxisAngle(_v.set(0, 0, 1), ang));
    m.position.y += Math.sin(t * 2.2) * 0.008;
    // the hammer above the top chamber, cocked back toward the lens, then it falls
    const fall = t < Th ? 0 : easeOut((t - Th) / 0.06);
    const topCh = _v2.set(0, 8.6 * CYL_VS, -10 * CYL_VS).applyQuaternion(c.q).add(c.at);
    c.ham.position.copy(topCh).addScaledVector(_v3.set(0, 1, 0).applyQuaternion(c.q), 2.2 * CYL_VS);
    c.ham.quaternion.copy(c.q).multiply(_q.setFromAxisAngle(_v.set(1, 0, 0), -0.75 * (1 - fall)));
    if (t > Te && t < Th + 0.1 && this.light) {
      if (!this.light.parent) ctx.scene.add(this.light);
      this.light.position.copy(topCh);
      this.light.intensity = 1.5 + Math.sin(t * 30) * 0.3;
    }
    if (this.once('hammer', Th)) ctx.sfx('rev_hammer', c.at, 1.0);
    if (this.once('fire', Th + 0.07)) {
      if (this.light) this.light.intensity = 0;
      if (!this.o.win) {
        ctx.sfx('rev_shot', c.at, 1.0);
        p.emit({ pos: topCh, count: 1, life: [0.12, 0.12], size: [1.0, 0.3], sprite: ['flash0', 'flash1', 'flash2'], additive: true, color: 0xffd8a0, sizeJitter: 0 });
        p.emit({ pos: topCh, count: 18, spread: 5, life: [0.15, 0.4], size: [0.06, 0.01], sprite: ['spark', 'streak'], additive: true, color: [0xffe0a0, 0xff8a3a], drag: 3, stretch: 0.05 });
        p.emit({ pos: topCh, count: 5, spread: 0.6, up: 0.6, life: [0.8, 1.4], size: [0.12, 0.45], sprite: PUFF, color: [0xb8b0a0, 0x8a8478], alpha: 0.5, drag: 1.5, rot: 6 });
        this.cine.hurtHero();
        this.cine.shoot(this.cine.A, 0.18);
      } else {
        ctx.sfx('rev_dry', c.at, 1.0);
        this.cine.kick(0.12);
        p.emit({ pos: topCh, count: 14, spread: 2, life: [0.4, 0.8], size: [0.06, 0.015], sprite: ['star4', 'glow8'], additive: true, color: [0x9dffc8, 0xffffff], drag: 2 });
      }
    }
  }

  dispose() {
    for (const d of this.dice) {
      d.mesh.removeFromParent();
      d.mat.dispose();
    }
    if (this.coin) {
      this.coin.mesh.removeFromParent();
      this.coin.mat.dispose();
    }
    if (this.cyl) {
      this.cyl.mesh.removeFromParent();
      this.cyl.mesh.geometry.dispose();
      this.cyl.ham.removeFromParent();
      this.cyl.mat.dispose();
    }
    this.light?.removeFromParent();
    this.stamp?.dispose();
    this.cine.dim = 0;
  }
}
