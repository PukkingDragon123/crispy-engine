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
import { GlyphRings, LightSigil, SandVortex } from '../fx/SerketSpirit';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { globalUniforms, makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { hash3 } from '../../engine/math/rand';
import { mixc } from '../models/props/tarot';
import type { RigInstance } from '../../engine/voxel/Rig';

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
      vertexShader: /* glsl */ `attribute vec2 aux; varying vec2 vA; void main(){ vA = aux; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uFade, uT; varying vec2 vA;
        ${NOISE_GLSL}
        void main(){
          float ang = vA.x * 6.2831853;
          vec2 dir = vec2(cos(ang), sin(ang));
          float n = rn(dir * 4.0 + vec2(0.0, uT * 2.5)) * 0.6 + rn(dir * 13.0 + vec2(uT * 3.0, 0.0)) * 0.4;
          float top = 0.3 + 0.7 * n;
          float a = (1.0 - smoothstep(top - 0.3, top, vA.y)) * (1.0 - vA.y * 0.3);
          float streak = 0.45 + 0.55 * sin(ang * 96.0 + n * 7.0 + vA.y * 3.0);
          vec3 col = mix(vec3(1.0, 0.8, 0.4), vec3(0.45, 1.0, 0.75), smoothstep(0.0, 0.8, vA.y)) * (0.7 + streak) * 1.3;
          a *= uFade;
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

  update(k: number, p: Particles) {
    // k: 0..1 life of the wave
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
        const out = 2 + 5 * (1 - e);
        p.emit({ pos: { x, y: this.groundAt(x, z) + 0.05, z }, count: 1, vel: { x: Math.cos(a) * out, y: 2 + Math.random() * 3, z: Math.sin(a) * out }, spread: 0.6, life: [0.5, 1.0], size: [0.06, 0.035], sprite: GRAIN, color: SAND, gravity: 9, drag: 1.2, ground: true, bounce: 0.1 });
      }
      if (Math.random() < 0.7) {
        const a = Math.random() * Math.PI * 2;
        const x = a0.x + Math.cos(a) * this.r, z = a0.z + Math.sin(a) * this.r;
        p.emit({ pos: { x, y: this.groundAt(x, z) + 0.2, z }, count: 1, vel: { x: Math.cos(a) * 1.5, y: 0.6, z: Math.sin(a) * 1.5 }, life: [0.7, 1.3], size: [0.5, 1.6], sprite: PUFF, color: SAND, alpha: 0.6, drag: 2, rot: 6, rotSpeed: 0.6 });
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
  private vortex: SandVortex | null = null;
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
      this.dir.copy(this.chooseDir(chestF, cam.position));
      this.stageShots();
      this.seg = { from: copyPose(pose(), this.cur), to: this.A, t0: 0, dur: 0.95, orbit: true };
      // the stage set
      const g = this.groundY(this.H.x, this.H.z);
      const at = new THREE.Vector3(this.H.x, g, this.H.z);
      this.shock = new ShockRing(ctx.scene, at, ctx.world.groundAt);
      this.sigil = new LightSigil(ctx.scene, at, Math.atan2(this.dir.x, this.dir.z), ctx.world.groundAt, 0.56);
      this.vortex = new SandVortex(ctx.scene, 900);
      this.vortex.center.copy(at);
      this.vortex.height = 2;
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
      if (this.shock) this.shock.update(Math.min(1, (t - this.shockT0) / 1.25), this.p);
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
        this.sigil.fade = (1 - rel) * (t < this.tPull ? 1 : 0.85);
        this.sigil.update();
      }
      if (this.vortex) {
        const v = this.vortex;
        const inCards = t >= this.tPull;
        v.intensity = (inCards ? 0.42 : sm((t - 0.3) / 0.8)) * (1 - rel);
        v.height = inCards ? 2.6 : 2 + 2.4 * sm((t - 0.3) / 1.0);
        v.burst = rel;
        v.update(rdt, fog);
      }
      if (this.rings) {
        this.rings.appear = sat((t - 0.5) / 0.8);
        this.rings.fade = 1 - rel;
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
    this.p.emit({ pos: c, count: 8, spread: 1.4, life: [0.6, 1.2], size: [0.3, 0.9], sprite: PUFF, color: [0xf0d8a8, 0xe3bd80], alpha: 0.55, drag: 2.2, rot: 6, rotSpeed: 0.8, jitter: hw * 0.8 });
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
      this.lightA.intensity = k * (2.4 + Math.sin(this.t * 17) * 0.4);
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
