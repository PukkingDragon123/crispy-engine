// The hideout: Sundown's pine workshop-house at the edge of the dead Last Chance
// outpost. Knotty honey-pine walls under a vaulted, lapped ceiling on log beams;
// big barn doors thrown open on the left to the sunset street, where a low sun
// pours dusty god rays across the garage and the floor; a stone fireplace
// crackling in the back corner; one ragged hole in the roof.
// You don't walk it. The hideout is a cinematic carousel of stations: LEFT / RIGHT
// (A / D, the arrow keys, or the carved arrow signs at the screen's edges) swing
// the camera in a slow eased arc to the next station while Sundown walks over.
// Each stop is a close, composed shot (rule of thirds, warm practicals) with the
// station's name in gilded 3D Alagard letters, a subtitle, and an action
// (E / Enter / click):
//   the barn doors                                                   → ride out
//   the weapon bench (vise, tools, the gun stripped on an oilcloth)  → gun bench
//   the garage: the board rack and the board on the sawhorses        → boards
//   the wardrobe and the cheval mirror (a live reflection)           → hats & outfits
//   the lectern with the Book of Skills                              → skills & codex
//   the hearth, where Mama Toad knits in her rocking chair            → a chat
//   the gramophone on the coffee table (squeeze the duck)            → music
// Lighting: a warm low key sun with crisp cel shadows, volumetric shafts through
// every opening (with window-mullion shadows), firelight, lamp pools, cool
// skylight at the shaded windows, and an interior light probe baked from the
// lit room itself so every surface gets the warm bounce of the sunlit floor.
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { Engine, GameScene } from '../../engine/Engine';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { makeVoxelMaterial, sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import * as PM from '../models/props';
import * as HX from '../models/props/hideout';
import * as WS from '../models/props/workshop';
import * as CH from '../models/characters';
import { modelEntry } from '../models/lookup';
import { TOON } from '../models/style';
import { Particles } from '../fx/Particles';
import { ENEMIES } from '../enemies/EnemyDefs';
import { loadSave, writeSave, buy, owns, PRICES, HATS, OUTFITS, BOARDS, GUN_PARTS, GUN_PERKS, GunLoadout } from '../meta/Save';
import { IconFactory } from '../ui/IconFactory';
import { CardStudio } from '../ui/CardStudio';
import { TAROT, Kit } from '../ui/TarotCards';
import { TECHNIQUES, isUnlocked } from '../player/Techniques';
import { leg } from '../anim/gait';
import { legIK, LegPose, armIK } from '../anim/playerAnim';
import { DrunkGait } from '../anim/drunkWalk';
import { FloatText3D } from '../fx/FloatText3D';
import { Voice } from '../audio/Voice';
import { damp, rnd } from '../../engine/math/rand';
import { Codex } from '../meta/Codex';
import { CodexBook } from '../ui/CodexBook';
import { WantedPoster, PosterData } from './ResultsScene';
import { HouseExtras } from './hub/HouseExtras';
import type { HubHost } from './hub/HubKit';

/** how he gets home: normally he walks in from the street; after a death he wakes up on the couch */
export interface HubArrival {
  wake?: { days: number; result: PosterData };
}
/** the last WANTED poster stays nailed to the wall for the rest of the session */
let lastPoster: PosterData | null = null;
type WakeKey = { p: THREE.Vector3; q: THREE.Quaternion; j: Record<string, [number, number, number]> };
/** the wake-up: asleep on the couch → bolt upright → legs over the edge → on his feet (offsets on the rest pose) */
const W_SLEEP: Record<string, [number, number, number]> = { arm_l: [0.95, 0, 1.15], fore_l: [-0.25, 0, 0], arm_r: [-0.75, 0, 0.55], fore_r: [-1.45, 0, 0], thigh_l: [0.05, 0, 0.7], shin_l: [1.3, 0, 0], thigh_r: [-0.4, 0, -0.04], shin_r: [0.6, 0, 0], head: [-0.12, 0.55, 0.06], hat: [0.55, 0, 0.1], jaw: [0.12, 0, 0] };
const W_SIT: Record<string, [number, number, number]> = { thigh_l: [-1.5, 0, 0.1], shin_l: [0.12, 0, 0], thigh_r: [-1.42, 0, -0.06], shin_r: [0.35, 0, 0], torso: [0.18, 0, 0], head: [0.06, 0, 0], arm_l: [0.25, 0, 0.42], fore_l: [-0.15, 0, 0], arm_r: [0.25, 0, -0.42], fore_r: [-0.15, 0, 0], jaw: [0.2, 0, 0] };
const W_EDGE: Record<string, [number, number, number]> = { thigh_l: [-1.45, 0, 0.08], shin_l: [1.4, 0, 0], thigh_r: [-1.45, 0, -0.08], shin_r: [1.4, 0, 0], torso: [0.24, 0, 0], head: [0.16, 0, 0], arm_l: [-0.38, 0, 0.12], fore_l: [-0.95, 0, 0], arm_r: [-0.38, 0, -0.12], fore_r: [-0.95, 0, 0] };
const W_STAND: Record<string, [number, number, number]> = { arm_l: [0.04, 0, 0.07], arm_r: [0.04, 0, -0.07], fore_l: [-0.2, 0, 0], fore_r: [-0.2, 0, 0] };
/** a hand to the side of his skull (rubbing the dent) */
const W_SKULL: Record<string, [number, number, number]> = { arm_r: [-2.2, 0, -0.32], fore_r: [-2.05, 0, 0] };

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  /** compose on thirds: `subject` lands at screen `ndc` (the look is solved for the live aspect) */
  subject?: THREE.Vector3;
  ndc?: [number, number];
}
type HeroPose = 'door' | 'bench' | 'board' | 'mirror' | 'book' | 'hearth' | 'music' | 'range' | 'cards' | 'trophies';
interface Station {
  id: string;
  label: string;
  /** the big 3D title, the short name on the arrow signs, the subtitle, the action */
  title: string;
  short: string;
  sub: string;
  verb: string;
  /** where Sundown stands (x, z) and the way he faces */
  stand: THREE.Vector2;
  face: number;
  /** what he works on / looks at */
  at: THREE.Vector3;
  r: number;
  objs: THREE.Object3D[];
  shot: Shot;
  pose: HeroPose;
  /** the walk in from the lane (the stand itself excluded) */
  via: THREE.Vector2[];
  /** the title's corner in the frame (ndc) and the side it reads from */
  slot: [number, number, 'left' | 'right'];
  /** the camera swing's control point, when the eased arc would cut through a wall (the back door) */
  arc?: THREE.Vector3;
  /** pose data: the work surface height (m) and how far in front of him it is */
  surf?: number;
  reach?: number;
}
interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
interface Beam {
  mesh: THREE.Mesh;
  O: THREE.Vector3;
  U: THREE.Vector3;
  V: THREE.Vector3;
  L: THREE.Vector3;
  w: number;
}
type SM = { model: VoxelModel; voxelSize: number; meta?: any } | undefined | null;

const UI_CSS = "position:absolute;z-index:8;padding:16px 20px;background:#e8d4a4;border:4px solid #5a3418;box-shadow:0 6px 0 #2a1408;font-family:'Alagard';color:#2a1a10;font-size:17px;pointer-events:auto";
const BTN_CSS = "font-family:'Alagard';font-size:17px;padding:4px 12px;background:#7a4a28;color:#fff3d6;border:3px solid #2a1408;box-shadow:0 3px 0 #2a1408;cursor:pointer";

const IN = HX.CABIN_IN; // interior wall faces: left -4.8, right 4.8, back -3.3, front 3.3
/** the low western sun: light travels in from the street side (-X) and the front (+Z), going down */
const SUN_TO = new THREE.Vector3(0.78, -0.43, -0.45).normalize();
const WALK = { x0: IN.left + 0.25, x1: IN.right - 0.28, z0: IN.back + 0.32, z1: 1.15 };
const HERO_R = 0.26;

/** the carousel, left to right */
const ORDER = ['ride', 'bench', 'garage', 'bounty', 'wardrobe', 'range', 'trophies', 'book', 'gramophone', 'cards', 'hearth'];
/** the open strip of floor Sundown walks along between stations */
const LANE_Z = 0.25;
const UP = new THREE.Vector3(0, 1, 0);

const MAMA_LINES = [
  "There's my boy. Come warm your bones by the fire, sugar.",
  "Sit a spell. The kettle's nearly singing.",
  "I'm knitting you a scarf. Don't you dare peek.",
  "You're all bones, dear. I'll find you a cookie.",
  "Pinch ate three of my cookies and blamed the duck.",
  "Wipe your boots, honey. I just swept that sand.",
  "Mind the little ones. They nap wherever they flop.",
  "Pardon me. Frog in my throat. Well. Toad.",
  "That revolver of yours could use a good oiling.",
  "When the sand's done screaming, the stars come out lovely.",
  "Wear the poncho. It brings out your cheekbones.",
  "Ride careful. Come back hungry.",
];

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const backOut = (u: number) => 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, v: number) => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
/** the look point that puts `subject` at screen (nx, ny) from `pos` (thirds composition, live aspect) */
function thirdsLook(pos: THREE.Vector3, subject: THREE.Vector3, nx: number, ny: number, fov: number, aspect: number, out: THREE.Vector3) {
  const dx = subject.x - pos.x, dy = subject.y - pos.y, dz = subject.z - pos.z;
  const tH = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const yaw = Math.atan2(dx, dz) + Math.atan(nx * tH * aspect);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz)) - Math.atan(ny * tH);
  const L = Math.hypot(dx, dy, dz);
  return out.set(pos.x + Math.sin(yaw) * Math.cos(pitch) * L, pos.y + Math.sin(pitch) * L, pos.z + Math.cos(yaw) * Math.cos(pitch) * L);
}
const mixHex = (a: number, b: number, t: number) => {
  const k = clamp01(t);
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * k), g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * k), bl = (a & 255) + (((b & 255) - (a & 255)) * k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};
/**
 * Gilded 3D letters: each Alagard glyph's mask (the typography is the only
 * thing drawn) extruded into voxels: a gold-leaf face shading from bright at the
 * top to deep at the foot, a raised spine on wide strokes, a bevelled rim, carved
 * walnut sides and back. One mesh per letter so they can flip in one by one.
 */
function voxelTitle(text: string, capH: number, mat: THREE.Material) {
  const PX = 32;
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.font = `${PX}px Alagard`;
  const cap = Math.max(8, Math.round(c.measureText('H').actualBoundingBoxAscent || PX * 0.62));
  const vs = capH / cap;
  cv.width = PX * 2;
  cv.height = Math.ceil(PX * 1.6);
  const base = Math.round(PX * 1.15);
  const root = new THREE.Group();
  const letters: THREE.Mesh[] = [];
  let pen = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    c.font = `${PX}px Alagard`;
    const adv = c.measureText(text.slice(0, i + 1)).width - c.measureText(text.slice(0, i)).width;
    if (ch.trim()) {
      c.clearRect(0, 0, cv.width, cv.height);
      c.fillStyle = '#fff';
      c.textBaseline = 'alphabetic';
      c.fillText(ch, 4, base);
      const img = c.getImageData(0, 0, cv.width, cv.height).data;
      const on = (x: number, y: number) => x >= 0 && y >= 0 && x < cv.width && y < cv.height && img[(y * cv.width + x) * 4 + 3] > 120;
      const m = new VoxelModel('glyph');
      let x0 = 1e9, x1 = -1e9;
      for (let y = 0; y < cv.height; y++)
        for (let x = 0; x < cv.width; x++) {
          if (!on(x, y)) continue;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          const vy = base - 1 - y;
          const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
          const inner = !edge && on(x - 2, y) && on(x + 2, y) && on(x, y - 2) && on(x, y + 2);
          const D = inner ? 5 : edge ? 3 : 4;
          const k = clamp01((vy + 2) / (cap + 2));
          const gold = mixHex(0xa8661c, 0xffe28e, k * k * 0.6 + k * 0.4);
          for (let z = 0; z < D; z++) {
            const front = z === D - 1;
            const col = front ? (edge ? mixHex(gold, 0xfff0c0, 0.25) : inner ? mixHex(gold, 0xfff4cc, 0.18) : gold) : z === 0 ? 0x2e1a0c : 0x4e2c14;
            m.set(x, vy, z, col, front ? VF.METAL | VF.EMISSIVE : VF.EMISSIVE);
          }
        }
      if (x1 >= x0) {
        const g = bakeUILight(buildVoxelGeometry(m, { voxelSize: vs, pivot: [(x0 + x1 + 1) / 2, 0, 1.5] }));
        const mesh = new THREE.Mesh(g, mat);
        mesh.position.x = (pen - 4 + (x0 + x1 + 1) / 2) * vs;
        mesh.renderOrder = 4;
        root.add(mesh);
        letters.push(mesh);
      }
    }
    pen += adv;
  }
  return { root, letters, width: pen * vs, capH };
}
/**
 * The on-screen pieces carry their own painted light: a two-tone cel ramp from a
 * key over the left shoulder, baked into the vertex colours in the piece's own
 * (camera-facing) frame, with a hard glint on the metal. They render unlit, so a
 * practical lamp beside the lens can never blow them out, and they still get the
 * ink outlines, bloom and grade of the frame.
 */
function bakeUILight(g: THREE.BufferGeometry) {
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const n = g.getAttribute('normal'), c = g.getAttribute('color'), mx = g.getAttribute('matx');
  if (!c) return g;
  const L = new THREE.Vector3(-0.45, 0.72, 0.53).normalize();
  for (let i = 0; i < c.count; i++) {
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    const d = nx * L.x + ny * L.y + nz * L.z;
    let k = 0.56 + 0.44 * sstep(-0.08, 0.2, d) + Math.max(0, ny) * 0.06;
    if (mx && mx.getY(i) > 0.5 && d > 0.55) k *= 1.22;
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  c.needsUpdate = true;
  return g;
}

/** the tarot bar's abilities (the moves — rope, kick, neck slicer — have their own page, from player/Techniques) */
const SKILL_PAGES: [string, string, string][] = [
  ['E', 'I · The Magician', 'Scorpion toss — Serket\'s brood rides your bullets in.'],
  ['C', 'XVI · The Tower', 'Scarab swarm — they eat what you whistle at.'],
  ['G', 'XIX · The Sun', 'Dung bomb — Khepri\'s gift, bouncing and rank.'],
  ['Z', 'XIII · Death', 'The pale ride — when the deck runs out, so do they.'],
];
/** photographed tarot art for the Moves page, kept for the whole visit (data URLs, by TarotDef key) */
const MOVE_ART_SIZE: [number, number] = [168, 224];

function geoOf(sm: SM, pivot: 'bottom' | 'center' | [number, number, number] = 'bottom') {
  if (!sm?.model) return null;
  const g = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot });
  g.computeBoundingBox();
  return g;
}
function meshOf(g: THREE.BufferGeometry, mat: THREE.Material = sharedVoxelMaterial) {
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
/** guarded builder call: a missing / failing prop never breaks the hideout */
function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch (e) {
    console.warn('[hub] prop failed', e);
    return null;
  }
}

/** far mesa silhouettes for the dusk horizon */
function mesaModel(seed: number) {
  const m = new VoxelModel('mesa');
  const W = 10 + (seed % 3) * 4, H = 10 + (seed % 4) * 3;
  for (let y = 0; y < H; y++) {
    const w = W - Math.floor(y / 4);
    for (let x = -w; x <= w; x++) for (let z = -6; z <= 6; z++) m.set(x, y, z, y % 4 === 0 ? TOON.sandstone.shade : TOON.sandstone.base);
  }
  for (let x = -W + 3; x <= W - 3; x++) for (let z = -5; z <= 5; z++) m.set(x, H, z, TOON.sandstone.hi);
  return m;
}

/**
 * A volumetric sun shaft: the opening (O + a·U + b·V) swept along the sun (L).
 * Rendered as the back faces of that parallelepiped; each fragment marches the
 * view ray through it in unit space (affine, so distances stay in metres),
 * integrating soft edges, the mullion shadow of a window sash, a fade along the
 * beam and slow drifting dust.
 */
function beamMaterial(O: THREE.Vector3, U: THREE.Vector3, V: THREE.Vector3, L: THREE.Vector3, o: { density: number; color: THREE.Color; mullion: number; soft: number; fade: number }) {
  const M = new THREE.Matrix4().makeBasis(U, V, L).setPosition(O);
  const inv = M.clone().invert();
  return new THREE.ShaderMaterial({
    uniforms: { uInv: { value: inv }, uTime: { value: 0 }, uDensity: { value: o.density }, uColor: { value: o.color }, uMullion: { value: o.mullion }, uSoft: { value: o.soft }, uFade: { value: o.fade }, uK: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform mat4 uInv; uniform float uTime, uDensity, uMullion, uSoft, uFade, uK; uniform vec3 uColor;
      varying vec3 vW;
      void main(){
        vec3 rdW = vW - cameraPosition;
        float tEnd = length(rdW);
        rdW /= tEnd;
        vec3 ro = (uInv * vec4(cameraPosition, 1.0)).xyz;
        vec3 rd = (uInv * vec4(rdW, 0.0)).xyz + vec3(1e-6);
        vec3 ia = 1.0 / rd;
        vec3 ta = -ro * ia, tb = (1.0 - ro) * ia;
        vec3 tmn = min(ta, tb), tmx = max(ta, tb);
        float tn = max(max(tmn.x, tmn.y), max(tmn.z, 0.0));
        float tf = min(min(min(tmx.x, tmx.y), tmx.z), tEnd);
        if (tf <= tn) discard;
        float acc = 0.0;
        for (int i = 0; i < 7; i++) {
          float t = mix(tn, tf, (float(i) + 0.5) / 7.0);
          vec3 q = ro + rd * t;
          float e = smoothstep(0.0, uSoft, q.x) * smoothstep(0.0, uSoft, 1.0 - q.x) * smoothstep(0.0, uSoft, q.y) * smoothstep(0.0, uSoft, 1.0 - q.y);
          float mull = 1.0 - uMullion * (1.0 - smoothstep(0.012, 0.045, abs(q.x - 0.5))) - uMullion * (1.0 - smoothstep(0.012, 0.045, abs(q.y - 0.5)));
          float along = smoothstep(0.0, 0.05, q.z) * (1.0 - smoothstep(uFade, 1.0, q.z));
          vec3 wp = cameraPosition + rdW * t;
          float dust = 0.7 + 0.3 * sin(wp.x * 4.1 + uTime * 0.31) * sin(wp.y * 3.3 - uTime * 0.23 + wp.z * 2.7);
          acc += e * max(mull, 0.0) * along * dust;
        }
        float a = acc / 7.0 * (tf - tn) * uDensity * uK;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    fog: false,
  });
}

/** an antique silvered mirror: the live reflection, slightly warm, with dark foxing creeping in from the rim */
const MirrorShader = {
  name: 'AntiqueMirror',
  uniforms: { color: { value: null as THREE.Color | null }, tDiffuse: { value: null as THREE.Texture | null }, textureMatrix: { value: null as THREE.Matrix4 | null } },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vP;
    void main(){ vUv = textureMatrix * vec4(position, 1.0); vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color; uniform sampler2D tDiffuse; varying vec4 vUv; varying vec2 vP;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2DProj(tDiffuse, vUv).rgb;
      float r = length(vP);
      float fox = smoothstep(0.78, 1.0, r + (h(floor(vP * 40.0)) - 0.5) * 0.12);
      c = c * color * (1.0 - fox * 0.55) + vec3(0.05, 0.04, 0.03) * fox;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export class HubScene implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
  /** read by main.ts: __ready waits for the build */
  ready = false;
  private particles = new Particles();
  private ray = new THREE.Raycaster();
  /** the carousel stations, left to right (debug: __hub.stations, __hub.use(st), __hub.step(±1), __hub.go(i)) */
  private stations: Station[] = [];
  private idx = 1;
  private hovered: Station | null = null;
  private hoverArrow = 0;
  private active: Station | null = null;
  /** the camera's swing between stations (a quadratic arc through `c`, eased) */
  private mv: { t: number; dur: number; p0: THREE.Vector3; l0: THREE.Vector3; f0: number; c: THREE.Vector3; intro: boolean } | null = null;
  private intro = true;
  /** the camera's composed pose before parallax and sway */
  private baseP = new THREE.Vector3();
  private baseL = new THREE.Vector3();
  private par = new THREE.Vector2();
  /** Sundown's walk: the waypoints still ahead, his pace, how settled into the station pose he is */
  private route: THREE.Vector2[] = [];
  private speed = 1.6;
  private atK = 0;
  private armL1 = 0.264;
  private armL2 = 0.321;
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private qc = new THREE.Quaternion();
  private eu = new THREE.Euler();
  private m4 = new THREE.Matrix4();
  // the on-screen 3D UI: carved arrow signs riding with the camera, gilded titles anchored in the shot
  private ui = new THREE.Group();
  private uiK = 0;
  private arrowScale = 1;
  private arrows: { dir: -1 | 1; grp: THREE.Group; mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; hover: number; push: number; label: HTMLDivElement }[] = [];
  private titleMat: THREE.MeshBasicMaterial | null = null;
  /** one typewriter subtitle per station (a FloatText3D keeps its first texture size) */
  private subs = new Map<string, FloatText3D>();
  private titles = new Map<string, ReturnType<typeof voxelTitle>>();
  private ttl: { st: Station; t: number; out: number; anchor: THREE.Vector3; q: THREE.Quaternion; up: THREE.Vector3; right: THREE.Vector3; set: ReturnType<typeof voxelTitle> } | null = null;
  private sub: FloatText3D | null = null;
  private gramTop = new THREE.Vector3();
  private walls: Rect[] = [];
  private hero: RigInstance | null = null;
  private heroSpec: RigSpec | null = null;
  private pinch: RigInstance | null = null;
  private heroHolder = new THREE.Group();
  private boardRackGroup = new THREE.Group();
  private boardBench = new THREE.Group();
  private gunHolder = new THREE.Group();
  private gun: RigInstance | null = null;
  private panel: HTMLDivElement | null = null;
  private panelSide: 'left' | 'right' = 'right';
  private tip: HTMLDivElement;
  private bank: HTMLDivElement;
  private title: HTMLDivElement;
  private prompt: HTMLDivElement;
  private hint: HTMLDivElement;
  private bubble: HTMLDivElement;
  private goal: Shot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private t = 0;
  private music = true;
  // hero locomotion
  private pos = new THREE.Vector2(-6.9, 0.55);
  private vel = new THREE.Vector2();
  private yaw = Math.PI / 2;
  private phase = 0;
  private moveK = 0;
  private runK = 0;
  private lastStep = [0, 0];
  private headYaw = 0;
  private headPitch = 0;
  /** the whiskey swagger layered over his walk (anim/drunkWalk.ts) */
  private drunk = new DrunkGait(5.1, { weave: 0.07, stumbleEvery: [4.5, 8] });
  private lp: LegPose = { x: 0, z: 0, knee: 0, roll: 0 };
  // life
  private fireLight!: THREE.PointLight;
  private firePos = new THREE.Vector3();
  private flick: { l: THREE.Light; base: number; k: number }[] = [];
  private beams: Beam[] = [];
  private lanterns: { rig: RigInstance; light: THREE.PointLight | null; offset: THREE.Vector3; phase: number }[] = [];
  private chandelier: RigInstance | null = null;
  private candles: { light: THREE.PointLight; offset: THREE.Vector3 }[] = [];
  private barn: RigInstance[] = [];
  private entry: RigInstance | null = null;
  private clock: RigInstance | null = null;
  private crane: RigInstance | null = null;
  private spout = new THREE.Vector3();
  private mug = new THREE.Vector3();
  private chair: RigInstance | null = null;
  private mama: RigInstance | null = null;
  private mamaSpec: RigSpec | null = null;
  private toadlets: { rig: RigInstance; spec: RigSpec; home: THREE.Vector3; yaw: number; phase: number; blink: number; hop: number; hopT: number; from: THREE.Vector3; to: THREE.Vector3; turn: number; floor: boolean }[] = [];
  private mamaBlink = 2;
  private mamaTalk = 0;
  private mamaLine = 0;
  private mamaCd = 2;
  private mamaHead = new THREE.Vector3();
  private bubbleText = '';
  private bubbleT = 0;
  private mirror: Reflector | null = null;
  private duck: THREE.Object3D | null = null;
  private duckSquash = 0;
  private wind: { stop(t?: number): void } | null = null;
  private fireLoop: { stop(t?: number): void } | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private icons: IconFactory | null = null;
  private moveArt = new Map<string, string>();
  private artJob: Generator<void, void, void> | null = null;
  private saved: { exposure: number; bloom: [number, number, number]; tintS: THREE.Color; tintH: THREE.Color; vignette: number; sat: number } | null = null;
  private gust = 0;
  private creakCd = 5;
  private touch = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
  /** debug: window.__hub.debugCam = { pos: [x,y,z], look: [x,y,z], fov } */
  debugCam: { pos: number[]; look: number[]; fov?: number } | null = null;

  // ---- the wake-up (after a death), the WANTED poster on the wall, the Codex book
  private wake: { t: number; days: number; res: PosterData; fc: THREE.Vector3; sy: number; keys: WakeKey[]; posterAt: number; posterDone: number; said: Set<string> } | null = null;
  private wakeCam: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null;
  private poster: WantedPoster | null = null;
  private posterShot: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private futon: THREE.Object3D | null = null;
  private guitar: THREE.Object3D | null = null;
  private fireBox: THREE.Box3 | null = null;
  private gasp = 0;
  private book: CodexBook | null = null;
  private bankToast: HTMLDivElement | null = null;
  /** everything new in the house (hub/HouseExtras): decor, trophies, the 3D wardrobe / bench / rack, the toys */
  private extras: HouseExtras | null = null;

  constructor(private engine: Engine, private onRide: () => void, private onMenu: () => void, private arrival: HubArrival = {}) {
    this.tip = document.createElement('div');
    this.bank = document.createElement('div');
    this.title = document.createElement('div');
    this.prompt = document.createElement('div');
    this.hint = document.createElement('div');
    this.bubble = document.createElement('div');
  }

  async enter() {
    try {
      await this.build();
    } catch (e) {
      console.error('[hub] build failed', e);
    } finally {
      this.ready = true;
    }
  }

  private async build() {
    (window as any).__hub = this;
    const s = this.scene;
    const eng = this.engine;
    const P: any = PM;
    const hiQ = eng.quality.shadows;
    const lite = this.touch || !hiQ;
    const sunDir = SUN_TO.clone().negate();
    // ------------------------------------------------ sky + atmosphere
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uSun: { value: sunDir } },
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uSun; varying vec3 vP;
          void main(){
            float y = vP.y;
            vec3 zen = vec3(0.2,0.26,0.5), mid = vec3(0.66,0.52,0.56), hor = vec3(1.0,0.7,0.42), low = vec3(0.5,0.34,0.24);
            vec3 c = y > 0.0 ? mix(hor, mix(mid, zen, smoothstep(0.2, 0.85, y)), smoothstep(0.0, 0.3, y)) : mix(hor, low, clamp(-y * 5.0, 0.0, 1.0));
            float d = max(0.0, dot(vP, uSun));
            c += vec3(1.0, 0.7, 0.4) * pow(d, 6.0) * 0.7 + vec3(1.0, 0.9, 0.7) * pow(d, 700.0) * 5.0;
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      })
    );
    s.add(sky);
    s.fog = new THREE.Fog(0xd8a070, 30, 170);
    s.add(new THREE.HemisphereLight(0x9aa8d8, 0x5a3820, 0.08));
    const sun = new THREE.DirectionalLight(0xffa860, 5.4);
    const sunAim = new THREE.Vector3(-1.4, 0.8, -0.4);
    sun.position.copy(sunAim).addScaledVector(sunDir, 32);
    sun.target.position.copy(sunAim);
    sun.castShadow = true;
    sun.shadow.mapSize.set(hiQ ? 4096 : 1024, hiQ ? 4096 : 1024);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.022;
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -10;
    sc.right = 10;
    sc.bottom = -7;
    sc.top = 7;
    sc.near = 8;
    sc.far = 60;
    s.add(sun, sun.target);
    s.add(this.particles.group);

    // ------------------------------------------------ placement helpers
    const put = (sm: SM, x: number, z: number, ry = 0, y = 0, scale = 1, solid = true) => {
      const g = geoOf(sm);
      if (!g) return null;
      const grp = new THREE.Group();
      grp.add(meshOf(g));
      grp.position.set(x, y, z);
      grp.rotation.y = ry;
      grp.scale.setScalar(scale);
      s.add(grp);
      if (solid && y < 0.6) this.block(grp);
      return grp;
    };
    /** stand an object with its back against a wall face */
    const against = (sm: SM, wall: 'back' | 'left' | 'right' | 'front', along: number, y = 0, gap = 0.05, scale = 1, solid = true) => {
      const g = geoOf(sm);
      if (!g) return null;
      const bb = g.boundingBox!;
      const grp = new THREE.Group();
      grp.add(meshOf(g));
      grp.scale.setScalar(scale);
      const back = -bb.min.z * scale + gap;
      if (wall === 'back') grp.position.set(along, y, IN.back + back);
      else if (wall === 'front') {
        grp.rotation.y = Math.PI;
        grp.position.set(along, y, IN.front - back);
      } else if (wall === 'left') {
        grp.rotation.y = Math.PI / 2;
        grp.position.set(IN.left + back, y, along);
      } else {
        grp.rotation.y = -Math.PI / 2;
        grp.position.set(IN.right - back, y, along);
      }
      s.add(grp);
      if (solid && y < 0.6) this.block(grp);
      return grp;
    };
    const B = (f: () => SM) => safe(f);
    const topOf = (o: THREE.Object3D | null) => (o ? new THREE.Box3().setFromObject(o).max.y : 0);
    const local = (o: THREE.Object3D, p: number[]) => {
      o.updateMatrixWorld(true);
      return new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(o.matrixWorld);
    };
    const rig = (spec: RigSpec | null, x: number, y: number, z: number, ry = 0, key = '') => {
      if (!spec) return null;
      const ri = new RigInstance(buildRigGeo(spec, spec.name + ':hub' + key), { material: sharedVoxelMaterial, castShadow: true });
      ri.root.position.set(x, y, z);
      ri.root.rotation.y = ry;
      s.add(ri.root);
      return ri;
    };
    const station = (o: Omit<Station, 'objs'> & { objs?: (THREE.Object3D | null)[] }) => {
      const st: Station = { ...o, objs: (o.objs ?? []).filter((q): q is THREE.Object3D => !!q) };
      this.stations.push(st);
      return st;
    };
    const lamp = (color: number, intensity: number, dist: number, decay: number, p: THREE.Vector3, flick = 0) => {
      const l = new THREE.PointLight(color, intensity, dist, decay);
      l.position.copy(p);
      s.add(l);
      if (flick) this.flick.push({ l, base: intensity, k: flick });
      return l;
    };

    // ------------------------------------------------ the cabin shell (shared frame)
    for (const f of [() => HX.cabinFloor(1), () => HX.cabinWalls(1)]) {
      const g = geoOf(B(f as () => SM), HX.CABIN_PIVOT);
      if (g) s.add(meshOf(g));
    }
    const roof = safe(() => HX.cabinRoof(1));
    const rg = geoOf(roof, HX.CABIN_PIVOT);
    if (rg) s.add(meshOf(rg));
    // room walls as colliders (the barn doorway stays open)
    const O = HX.CABIN_OPEN;
    this.walls.push({ x0: -9, z0: -9, x1: 9, z1: WALK.z0 }, { x0: -9, z0: WALK.z1, x1: 9, z1: 9 }, { x0: WALK.x1, z0: -9, x1: 9, z1: 9 });
    this.walls.push({ x0: -9, z0: -9, x1: WALK.x0, z1: O.barn.z0 + 0.3 }, { x0: -9, z0: O.barn.z1 - 0.3, x1: WALK.x0, z1: 9 });
    this.walls.push({ x0: -30, z0: -30, x1: -5.3, z1: 30 });
    // garage posts
    for (const pz of [IN.back + 0.25, IN.front - 0.25]) this.walls.push({ x0: O.garageX - 0.16, z0: pz - 0.16, x1: O.garageX + 0.16, z1: pz + 0.16 });

    // ------------------------------------------------ the hearth (back right)
    const fpSm = safe(() => HX.fireplaceCraft(1));
    const fp = against(fpSm, 'back', 3.45, 0, 0.04);
    if (fp) this.fireBox = new THREE.Box3().setFromObject(fp);
    if (fp && fpSm) {
      const fm = fpSm.meta;
      this.firePos.copy(local(fp, fm.fire));
      this.fireLight = lamp(0xff8a3a, lite ? 7 : 8.5, 7, 1.5, this.firePos.clone().add(new THREE.Vector3(0, 0.25, 0.55)));
      this.fireLight.castShadow = false;
      lamp(0xff6a28, 2.2, 3.2, 1.6, this.firePos.clone().add(new THREE.Vector3(0, -0.25, 1.0)), 0.2);
      const cr = local(fp, fm.crane);
      this.crane = rig(safe(() => WS.craneRig()), cr.x, cr.y + 0.06, cr.z, -0.18);
      const ck = local(fp, fm.clock);
      this.clock = rig(safe(() => WS.clockRig()), ck.x - 0.5 / 64, ck.y - 26.5 / 64, ck.z - 0.04);
      // the mantel: two old photographs, a bottle, the oil lamp
      const mantelY = (fp.position.y ?? 0) + fm.mantel;
      this.photo(s, fp.position.x - 0.62, mantelY, fp.position.z + 0.36, 0.12, 'mama');
      this.photo(s, fp.position.x + 0.55, mantelY, fp.position.z + 0.38, -0.16, 'hero');
      const ol = safe(() => HX.oilLamp());
      const olg = put(ol, fp.position.x + 0.12, fp.position.z + 0.4, 0.3, mantelY, 1, false);
      if (ol && olg) lamp(0xffb860, 1.4, 2.6, 1.8, local(olg, ol.meta.flame), 0.07);
    }

    // ------------------------------------------------ the living room
    // the red futon under the back window, its rug, the slab coffee table
    put(B(() => WS.braidedRug()), 1.1, -1.45, 0.04, 0.005, 1, false);
    const fut = against(B(() => WS.futon()), 'back', 1.3, 0, 0.06, 0.95);
    const ctSm = safe(() => WS.coffeeTable());
    const ct = put(ctSm, 1.25, -1.5, 0.05);
    if (ct && ctSm) {
      const top = ctSm.meta.top;
      const tc = safe(() => WS.tableClutter());
      const tcg = put(tc, 1.42, -1.48, -0.25, top, 1, false);
      if (tc && tcg) {
        this.mug.copy(local(tcg, tc.meta.mug));
        lamp(0xffc070, 0.9, 1.6, 2, local(tcg, tc.meta.candle).add(new THREE.Vector3(0, 0.04, 0)), 0.12);
      }
      // the gramophone at the table's end, the rubber duck by the mug
      const gr = put(B(() => HX.gramophoneCraft()), 0.86, -1.52, 0.5, top, 0.52, false);
      this.duck = put(modelEntry('rubber_duck')?.() as SM, 1.86, -1.36, -0.7, top, 0.85, false);
      const gb = gr ? new THREE.Box3().setFromObject(gr) : null;
      if (gb) this.gramTop.set((gb.min.x + gb.max.x) / 2, gb.min.y + (gb.max.y - gb.min.y) * 0.3, (gb.min.z + gb.max.z) / 2);
      else this.gramTop.set(0.86, top + 0.15, -1.52);
      station({
        id: 'gramophone', label: 'Gramophone', title: 'THE GRAMOPHONE', short: 'GRAMOPHONE', sub: 'a little night music', verb: 'Music on / off',
        stand: new THREE.Vector2(0.8, -0.93), face: Math.PI, at: this.gramTop.clone(), r: 0.55, objs: [gr, this.duck], pose: 'music',
        via: [new THREE.Vector2(0.86, LANE_Z)], slot: [-0.86, 0.84, 'left'],
        shot: { pos: new THREE.Vector3(-0.9, 1.25, -1.15), look: new THREE.Vector3(), fov: 46, subject: new THREE.Vector3(0.8, 1.45, -0.93), ndc: [0.3, 0.42] },
      });
    }
    this.futon = fut;
    put(B(() => WS.plaidChair()), -0.32, -1.55, Math.PI / 2 - 0.25);
    // between the bench and the futon: a cabinet with bottles (the gun rack hangs over it, see hub/GunRack.ts);
    // the guitar hangs on the front wall by the garage, over the steamer trunk
    const cab = against(B(() => WS.sideCabinet()), 'back', -0.04, 0, 0.05);
    if (cab) put(B(() => HX.bottlesCraft(2)), 0.0, IN.back + 0.25, 0.3, topOf(cab), 0.7, false);
    this.guitar = against(B(() => WS.guitar()), 'front', -2.08, 1.02, 0.02, 1, false);
    // Mama Toad in her rocking chair by the fire, knitting; her basket at her feet; the toadlets about
    const chSpec = safe(() => WS.rockingChairRig());
    const CH_AT = new THREE.Vector3(2.62, 0, -1.42), CH_YAW = -0.5;
    this.chair = rig(chSpec, CH_AT.x, 0, CH_AT.z, CH_YAW);
    const fpFront = fp ? new THREE.Box3().setFromObject(fp).max.z : IN.back + 0.6;
    const toadMat = makeVoxelMaterial();
    if (this.chair && chSpec) {
      this.walls.push({ x0: CH_AT.x - 0.62, z0: CH_AT.z - 0.52, x1: CH_AT.x + 0.62, z1: CH_AT.z + 0.5 });
      const ms = safe(() => modelEntry('mama_toad')?.() as RigSpec | undefined);
      if (ms?.parts) {
        this.mamaSpec = ms;
        this.mama = new RigInstance(buildRigGeo(ms, ms.name + ':hub'), { material: toadMat, castShadow: true });
        // her spectacle lenses are real glass
        const lens = this.mama.meshes[(ms.meta?.lensPart as string) ?? 'lenses'];
        if (lens) {
          const glass = makeVoxelMaterial({ transparent: true, opacity: 0.16 });
          glass.depthWrite = false;
          lens.material = glass;
          lens.castShadow = false;
          lens.renderOrder = 3;
        }
        const seat = chSpec.meta!.seat as number[], piv = chSpec.meta!.pivot as number[];
        this.mama.root.position.set(seat[0] - piv[0], seat[1] - piv[1] - 0.015, seat[2] - piv[2] + 0.02);
        this.mama.root.scale.setScalar(1.18);
        this.chair.nodes['chair']?.add(this.mama.root);
      }
    }
    put(B(() => WS.knittingBasket()), CH_AT.x + 0.62, CH_AT.z + 0.45, 0.6, 0, 1, false);
    lamp(0xffa860, 1.5, 2.2, 1.6, new THREE.Vector3(CH_AT.x - 0.55, 1.1, CH_AT.z + 0.75), 0.06);
    // the toadlets: one warming itself at the hearth, one on the rug, one in the corner by the fire, one up on her chair arm
    const toadlet = (key: string, x: number, y: number, z: number, ry: number, floor: boolean, parent: THREE.Object3D = s, sc = 1) => {
      const ts = safe(() => modelEntry(key)?.() as RigSpec | undefined);
      if (!ts?.parts) return;
      const tr = new RigInstance(buildRigGeo(ts, ts.name + ':hub'), { material: toadMat, castShadow: true });
      tr.root.position.set(x, y, z);
      tr.root.rotation.y = ry;
      tr.root.scale.setScalar(sc);
      parent.add(tr.root);
      this.toadlets.push({ rig: tr, spec: ts, home: new THREE.Vector3(x, y, z), yaw: ry, phase: x * 3.1 + z, blink: 1 + Math.random() * 3, hop: 4 + Math.random() * 6, hopT: -1, from: new THREE.Vector3(x, y, z), to: new THREE.Vector3(x, y, z), turn: ry, floor });
    };
    toadlet('toadlet', 3.05, 0, -0.62, -2.63, true);
    toadlet('toadlet_v2', 1.62, 0.012, -0.78, -1.75, true);
    toadlet('toadlet_v1', this.firePos.x + 0.55, 0, fpFront + 0.12, Math.PI - 0.5, true, s, 0.88);
    if (this.chair?.nodes['chair']) toadlet('toadlet_v1', -0.452, 0.8 - ((chSpec?.meta?.pivot as number[])?.[1] ?? 1.21), 0.02, 0.1, false, this.chair.nodes['chair']);
    if (this.chair) {
      const stand = new THREE.Vector2(3.55, -1.15);
      this.mamaHead.set(CH_AT.x - 0.08, 1.0, CH_AT.z + 0.14);
      station({
        id: 'hearth', label: 'Mama Toad', title: 'THE HEARTH', short: 'HEARTH', sub: 'Mama Toad keeps the kettle on', verb: 'Chat with Mama',
        stand, face: -2.35, at: this.firePos.clone(), r: 0.8, objs: [this.chair.root], pose: 'hearth',
        via: [new THREE.Vector2(stand.x - 0.08, LANE_Z)], slot: [-0.86, 0.84, 'left'],
        shot: { pos: new THREE.Vector3(1.75, 1.1, -0.12), look: new THREE.Vector3(), fov: 42, subject: new THREE.Vector3(CH_AT.x - 0.02, 0.98, CH_AT.z + 0.05), ndc: [-0.3, 0.0] },
      });
    }
    // the wardrobe and the cheval mirror (the dressing corner by the right window)
    const arm = against(B(() => HX.armoire(1)), 'right', -1.42, 0, 0.06);
    const mirSm = safe(() => WS.chevalMirror());
    const MIR = new THREE.Vector3(4.22, 0, 0.12), MIR_YAW = -0.95;
    const mir = put(mirSm, MIR.x, MIR.z, MIR_YAW, 0, 1, false);
    this.walls.push({ x0: MIR.x - 0.2, z0: MIR.z - 0.26, x1: MIR.x + 0.3, z1: MIR.z + 0.16 });
    // mirror geometry: n = the glass normal, mt = the viewer's right when facing it. Sundown stands 1 m out and a
    // little left; the camera sits 2.6 m out and 0.85 m right, so the line to his reflection lands on the glass
    // (≈0.13 m from its centre) and clears his own back by more than half a metre
    const mn = new THREE.Vector3(Math.sin(MIR_YAW), 0, Math.cos(MIR_YAW)), mt = new THREE.Vector3(Math.cos(MIR_YAW), 0, -Math.sin(MIR_YAW));
    const mirShot = (m: THREE.Vector3): Shot => ({ pos: m.clone().addScaledVector(mn, 2.6).addScaledVector(mt, 0.85).setY(1.45), look: m.clone().add(new THREE.Vector3(0, 0.04, 0)), fov: 38 });
    const mirStand = (m: THREE.Vector3) => new THREE.Vector2(m.x + mn.x - mt.x * 0.15, m.z + mn.z - mt.z * 0.15);
    let mirrorAt = new THREE.Vector3(MIR.x, 1.05, MIR.z);
    if (mir && mirSm) mirrorAt = local(mir, mirSm.meta.glass);
    station({
      id: 'wardrobe', label: 'Wardrobe & Mirror', title: 'THE MIRROR', short: 'MIRROR', sub: 'hats, jackets and swagger', verb: 'Try things on',
      stand: mirStand(mirrorAt), face: Math.atan2(-mn.x, -mn.z), at: mirrorAt.clone(), r: 0.8, objs: [arm, mir], pose: 'mirror',
      via: [new THREE.Vector2(3.0, LANE_Z)], slot: [-0.86, 0.84, 'left'], shot: mirShot(mirrorAt),
    });
    put(B(() => HX.steamerTrunk(1)), -2.12, 2.84, Math.PI / 2 + 0.15, 0, 1, false);
    put(B(() => HX.potCactus(2)), 4.35, 1.05, 0.4, 0, 1, false);
    // the front door ajar on the right wall, a landscape over the right window
    this.entry = rig(safe(() => WS.zDoorRig()), IN.right + 0.1, 0, O.door.z0 + 0.01, -Math.PI / 2 - 0.42);
    against(B(() => WS.landscapeFrame()), 'right', 0.3, 2.42, 0.02, 1, false);
    // the lectern with the Book of Skills, standing in the barn-door sun
    const lecSm = safe(() => WS.lectern());
    const LEC = new THREE.Vector3(-1.98, 0, -0.72);
    const lec = put(lecSm, LEC.x, LEC.z, 0.12);
    let bookAt = new THREE.Vector3(LEC.x, 1.1, LEC.z);
    if (lec && lecSm) {
      bookAt = local(lec, lecSm.meta.desk);
      const tg = geoOf(B(() => WS.openTome()));
      if (tg) {
        const tome = new THREE.Group();
        const tm = meshOf(tg);
        tome.add(tm);
        tome.position.copy(bookAt);
        tome.rotation.set(lecSm.meta.tilt, 0.12, 0, 'YXZ');
        s.add(tome);
      }
      lamp(0xffb860, 1.5, 2.4, 1.8, local(lec, lecSm.meta.flame).add(new THREE.Vector3(0, 0.03, 0)), 0.1);
    }
    station({
      id: 'book', label: 'The Book of Skills', title: 'THE BOOK OF SKILLS', short: 'BOOK', sub: 'moves, cards and the codex', verb: 'Read',
      stand: new THREE.Vector2(LEC.x - 0.46, LEC.z + 0.5), face: Math.PI - 0.62, at: bookAt.clone(), r: 0.75, objs: [lec], pose: 'book',
      via: [new THREE.Vector2(LEC.x - 0.34, LANE_Z)], slot: [0.86, 0.84, 'right'], surf: bookAt.y,
      shot: { pos: new THREE.Vector3(-1.05, 1.55, 0.62), look: new THREE.Vector3(), fov: 42, subject: new THREE.Vector3(LEC.x - 0.46, 1.42, LEC.z + 0.5), ndc: [-0.3, 0.12] },
    });

    // ------------------------------------------------ the weapon bench (back wall, left)
    const wbSm = safe(() => WS.weaponBench());
    const wb = against(wbSm, 'back', -1.32, 0, 0.04);
    if (wb && wbSm) {
      const gp = local(wb, wbSm.meta.gun);
      this.gunHolder.position.copy(gp);
      s.add(this.gunHolder);
      const lp = local(wb, wbSm.meta.lamp);
      const spot = new THREE.SpotLight(0xffd8a0, lite ? 3.5 : 4.2, 3.0, 0.8, 0.6, 1.6);
      spot.position.copy(lp);
      spot.target.position.copy(lp).add(new THREE.Vector3(-0.15, -1, 0.2));
      s.add(spot, spot.target);
      this.flick.push({ l: spot, base: spot.intensity, k: 0.015 });
      put(B(() => HX.barStool(2, 'ok')), -2.2, -1.92, 0.9);
      const bst = new THREE.Vector2(gp.x - 0.36, gp.z + 0.6);
      station({
        id: 'bench', label: 'Weapon Bench', title: 'THE WORKBENCH', short: 'WORKBENCH', sub: 'the gun rack and the bench', verb: 'Open the gun rack',
        stand: bst, face: Math.PI, at: gp.clone(), r: 0.75, objs: [wb], pose: 'bench',
        via: [new THREE.Vector2(-1.15, LANE_Z), new THREE.Vector2(bst.x + 0.4, bst.y + 0.75)], slot: [-0.86, 0.84, 'left'], surf: wbSm.meta.top, reach: 0.4,
        // back by the plaid chair, so the gun rack over the cabinet is in the shot with him at the bench
        shot: { pos: new THREE.Vector3(bst.x + 2.2, 1.9, bst.y + 1.42), look: new THREE.Vector3(), fov: 50, subject: new THREE.Vector3(bst.x, 1.18, bst.y), ndc: [-0.3, -0.02] },
      });
    }

    // ------------------------------------------------ the garage (left)
    const rackSm = safe(() => WS.boardRack());
    const rack = against(rackSm, 'back', -3.48, 0, 0.04);
    if (rack && rackSm) {
      this.boardRackGroup.position.copy(rack.position);
      this.boardRackGroup.userData.slots = rackSm.meta.slots;
      this.boardRackGroup.userData.lean = rackSm.meta.lean;
      s.add(this.boardRackGroup);
    }
    const sh = safe(() => WS.sawhorse());
    for (const sx of [-3.92, -2.95]) put(sh, sx, -1.32, 0.04);
    this.boardBench.position.set(-3.43, (sh?.meta.top ?? 0.7) + 0.035, -1.32);
    s.add(this.boardBench);
    const wx = safe(() => WS.waxBench());
    const wxg = against(wx, 'left', -2.25, 0, 0.05);
    if (wx && wxg) lamp(0x9ac0ff, 0.6, 1.2, 2, local(wxg, wx.meta.burner).add(new THREE.Vector3(0, 0.05, 0)), 0.25);
    station({
      id: 'garage', label: 'Garage', title: 'THE GARAGE', short: 'GARAGE', sub: 'wax a board, pick your ride', verb: 'Pick a board',
      stand: new THREE.Vector2(-3.43, -1.86), face: 0, at: this.boardBench.position.clone(), r: 0.8, objs: [rack, this.boardBench, wxg], pose: 'board',
      via: [new THREE.Vector2(-2.55, LANE_Z), new THREE.Vector2(-2.5, -1.12), new THREE.Vector2(-2.62, -1.86)], slot: [0.86, 0.84, 'right'], surf: this.boardBench.position.y + 0.035, reach: 0.52,
      shot: { pos: new THREE.Vector3(-2.38, 1.55, 0.3), look: new THREE.Vector3(), fov: 44, subject: new THREE.Vector3(-3.43, 1.38, -1.86), ndc: [-0.26, 0.12] },
    });
    this.walls.push({ x0: -4.1, z0: -1.55, x1: -2.75, z1: -1.1 });
    put(B(() => HX.woodPile(1)), -4.25, 2.3, Math.PI / 2, 0, 0.9);
    put(B(() => HX.saddleRail(1)), -3.6, 2.85, 0.05);
    put(B(() => HX.kegCraft(2)), -2.95, 2.9, 0.4);
    put(B(() => HX.crateStack(2)), -4.35, -0.1 + 2.0, Math.PI / 2, 0, 0.8, false);
    put(B(() => HX.sackCraft(1)), -2.85, -2.75, 0.6, 0, 0.9);
    put(B(() => HX.ropeCoil()), -3.5, 0.75, 0.3, 0, 1, false);
    // barn doors thrown open to the street, the board you ride hangs ready
    const hingeX = -HX.CABIN.W / 2 - 0.02;
    for (const [mirror, hz] of [[false, O.barn.z0], [true, O.barn.z1]] as const) {
      const ri = rig(safe(() => WS.barnDoorRig(mirror)), hingeX, 0, hz, mirror ? -Math.PI / 2 + 1.72 : -Math.PI / 2 - 1.72, mirror ? 'r' : 'l');
      if (ri) this.barn.push(ri);
    }
    station({
      id: 'ride', label: 'Barn Doors', title: 'RIDE OUT', short: 'RIDE OUT', sub: 'the dunes are calling', verb: 'Ride out',
      stand: new THREE.Vector2(-4.38, 0.1), face: -Math.PI / 2, at: new THREE.Vector3(-9, 1.5, 0.1), r: 0.75, objs: this.barn.map((b) => b.root), pose: 'door',
      via: [new THREE.Vector2(-3.9, LANE_Z)], slot: [-0.86, 0.84, 'left'],
      shot: { pos: new THREE.Vector3(-2.5, 1.42, 1.28), look: new THREE.Vector3(), fov: 44, subject: new THREE.Vector3(-4.38, 1.42, 0.1), ndc: [0.3, 0.1] },
    });

    // ------------------------------------------------ hanging things that swing
    const lanternAt = (x: number, top: number, z: number, chain: number, seed: number, light = true) => {
      const spec = safe(() => HX.lanternRig(chain, seed));
      const ri = rig(spec, x, top, z, 0, 'l' + seed);
      if (!ri || !spec) return;
      const l = light ? lamp(0xffc070, 3.2, 5, 1.6, new THREE.Vector3(x, top - 0.5, z)) : null;
      this.lanterns.push({ rig: ri, light: l, offset: new THREE.Vector3(...(spec.meta!.light as [number, number, number])), phase: seed * 1.7 });
    };
    lanternAt(-3.45, 2.86, -2.12, 0.42, 1);
    lanternAt(1.95, 2.86, -2.12, 0.5, 2, !lite);
    const chSp = safe(() => HX.chandelierRig());
    this.chandelier = rig(chSp, 0.55, 3.98, 0.05, 0.4);
    if (this.chandelier && chSp)
      for (const c of (chSp.meta!.candles as [number, number, number][]).slice(0, lite ? 1 : 2)) {
        const l = lamp(0xffb050, 1.3, 3.4, 1.8, new THREE.Vector3());
        this.candles.push({ light: l, offset: new THREE.Vector3(...c) });
      }
    for (const [x, y, z, ry, sd] of [[IN.left + 0.05, 2.12, IN.back + 0.05, 0, 1], [IN.right - 0.05, 2.1, IN.back + 1.25, -Math.PI / 2, 2], [IN.left + 0.05, 2.1, IN.front - 0.05, Math.PI / 2, 1]] as const) put(B(() => HX.cobweb(sd)), x, z, ry, y, 1, false);

    // ------------------------------------------------ cool skylight at the shaded windows, warm bounce off the sunlit floor
    lamp(0xa8b8e0, lite ? 0.9 : 1.1, 3.0, 1.5, new THREE.Vector3((O.backWin.x0 + O.backWin.x1) / 2, 1.8, IN.back + 0.32));
    if (!lite) lamp(0xa8b8e0, 1.0, 2.8, 1.5, new THREE.Vector3(IN.right - 0.3, 1.75, (O.rightWin.z0 + O.rightWin.z1) / 2));
    lamp(0xffb27a, lite ? 3 : 3.6, 6.5, 1.3, new THREE.Vector3(-3.0, 0.45, -0.9));
    if (!lite) lamp(0xffb27a, 1.5, 3.5, 1.4, new THREE.Vector3(1.6, 0.35, 1.7));

    // ------------------------------------------------ sun shafts through every opening
    const sunCol = new THREE.Color(1.0, 0.74, 0.46);
    const beam = (Ov: THREE.Vector3, U: THREE.Vector3, V: THREE.Vector3, len: number, density: number, mullion: number, soft = 0.12, fade = 0.55) => {
      const L = SUN_TO.clone().multiplyScalar(len);
      const geo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
      geo.applyMatrix4(new THREE.Matrix4().makeBasis(U, V, L).setPosition(Ov));
      const mesh = new THREE.Mesh(geo, beamMaterial(Ov, U, V, L, { density, color: sunCol, mullion, soft, fade }));
      mesh.renderOrder = 10;
      mesh.frustumCulled = false;
      s.add(mesh);
      this.beams.push({ mesh, O: Ov, U, V, L, w: U.length() * V.length() * len });
    };
    const lx = -HX.CABIN.W / 2;
    // barn doors (to the floor and up the back wall), the gable window over them
    beam(new THREE.Vector3(lx, 0, O.barn.z1), new THREE.Vector3(0, 0, O.barn.z0 - O.barn.z1), new THREE.Vector3(0, O.barn.y1, 0), 7.6, 0.075, 0, 0.1, 0.5);
    beam(new THREE.Vector3(lx, O.gable.y0, O.gable.z1), new THREE.Vector3(0, 0, O.gable.z0 - O.gable.z1), new THREE.Vector3(0, O.gable.y1 - O.gable.y0, 0), 7.4, 0.12, 0.6, 0.18, 0.6);
    // the two front windows
    for (const w of O.frontWin) beam(new THREE.Vector3(w.x0, O.frontWinY[0], HX.CABIN.D / 2), new THREE.Vector3(w.x1 - w.x0, 0, 0), new THREE.Vector3(0, O.frontWinY[1] - O.frontWinY[0], 0), 4.6, 0.16, 0.7, 0.14, 0.5);
    // the hole in the roof
    if (roof) {
      const h = roof.meta.hole;
      const top = HX.cabinCeil(h.z) + 0.25;
      beam(new THREE.Vector3(h.x - h.rx * 0.8, top, h.z + h.rz * 0.8), new THREE.Vector3(h.rx * 1.6, 0, 0), new THREE.Vector3(0, 0, -h.rz * 1.6), 3.6, 0.22, 0, 0.3, 0.45);
    }

    // ------------------------------------------------ the street outside the barn doors
    const gsm = B(() => HX.streetGround(16, 40));
    const gg = geoOf(gsm, [0.5, 1, 0]);
    if (gg) {
      const m = meshOf(gg);
      m.castShadow = false;
      m.position.set(lx - 0.15, -0.03, 0);
      s.add(m);
    }
    const far = new THREE.Mesh(new THREE.CircleGeometry(300, 32), new THREE.MeshStandardMaterial({ color: 0xc08a5c, roughness: 1 }));
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.2;
    s.add(far);
    for (let i = 0; i < 10; i++) {
      const g = geoOf({ model: mesaModel(i), voxelSize: 2.4 });
      if (!g) continue;
      const mm = meshOf(g);
      mm.castShadow = false;
      const a = Math.PI * 1.15 + (i - 5) * 0.27;
      mm.position.set(Math.cos(a) * (170 + (i % 3) * 30), -1, Math.sin(a) * (170 + (i % 3) * 30));
      mm.rotation.y = a;
      s.add(mm);
    }
    const facade = (sm: SM, z: number) => {
      const g = geoOf(sm);
      if (!g) return;
      const grp = new THREE.Group();
      grp.add(meshOf(g));
      grp.rotation.y = Math.PI / 2;
      grp.position.set(-17.6, 0, z);
      s.add(grp);
    };
    facade(B(() => P.generalStoreFacade?.(1)), -0.5);
    facade(B(() => P.sheriffFacade?.(2)), -9.6);
    facade(B(() => P.saloonFacade?.(3)), 9.4);
    const bw = geoOf(B(() => HX.boardwalk(30, 2)));
    if (bw) {
      const m = meshOf(bw);
      m.rotation.y = -Math.PI / 2;
      m.position.set(-12.2, 0, 0);
      s.add(m);
    }
    put(B(() => HX.hitchingRail(1)), -7.0, 2.7, Math.PI / 2, 0, 1, false);
    put(B(() => HX.noticeBoardCraft(1)), -5.65, -2.1, -Math.PI / 2 + 0.2, 0, 1, false);
    put(B(() => HX.waterPump(1)), -7.4, -2.6, 1.2, 0, 1, false);
    put(B(() => P.wagon?.(1)), -9.4, -6.0, 0.9, 0, 1, false);
    put(B(() => HX.junkPile(1)), -6.6, -4.4, 0.4, 0, 1, false);
    put(B(() => HX.holeySign(1)), -6.2, 4.2, Math.PI / 2 + 0.2, 0, 1, false);
    put(B(() => HX.kegCraft(4)), -5.7, 2.9, 0, 0, 1, false);
    for (let i = 0; i < 24; i++) {
      const x = -5.8 - Math.random() * 7, z = (Math.random() - 0.5) * 18;
      if (Math.abs(x + 12.2) < 1.4 || (x > -8 && Math.abs(z) < 1.6)) continue;
      put(B(() => HX.grassTuft((i % 3) + 1)), x, z, Math.random() * 6, 0, 1, false);
    }
    for (const [x, z, k] of [[-11.0, 6.5, 'saguaro'], [-8.5, -8.5, 'organ'], [-16, 14, 'saguaro']] as const) put(B(() => P.cactus?.(Math.round(-x * 3), k)), x, z, x, 0, 1, false);
    put(B(() => P.tumbleweed?.(1)), -8.2, 5.2, 0, 0.35, 1, false);

    // ------------------------------------------------ the extras: decor, the trophy wall, the 3D wardrobe / bench / rack, the toys
    try {
      this.extras = new HouseExtras(this as unknown as HubHost);
      this.extras.build({ put, against, rig, station, lamp });
    } catch (e) {
      console.warn('[hub] extras', e);
    }

    this.buildGun();
    this.buildBoards();
    this.buildHero();

    // ------------------------------------------------ bake the interior light probe from the lit room itself
    try {
      const hidden: THREE.Object3D[] = [this.particles.group, ...this.beams.map((b) => b.mesh)];
      for (const o of hidden) o.visible = false;
      const pm = new THREE.PMREMGenerator(eng.renderer);
      this.envRT = pm.fromScene(s, 0.035, 0.05, 60, { size: lite ? 64 : 128, position: new THREE.Vector3(0.2, 1.45, -0.6) });
      pm.dispose();
      for (const o of hidden) o.visible = true;
      s.environment = this.envRT.texture;
      s.environmentIntensity = 0.5;
    } catch (e) {
      console.warn('[hub] probe', e);
    }
    // the live mirror (made after the bake so the probe never renders it)
    if (mir && mirSm) {
      const [rx, ry] = mirSm.meta.radii as [number, number];
      const glass = new Reflector(new THREE.CircleGeometry(1, 48).scale(rx, ry, 1), { textureWidth: lite ? 256 : 512, textureHeight: lite ? 384 : 1024, clipBias: 0.002, color: 0xf2e8da, multisample: 0, shader: MirrorShader });
      glass.position.copy(mirrorAt);
      glass.rotation.set(mirSm.meta.tilt, MIR_YAW, 0, 'YXZ');
      // the reflection pass reuses this frame's shadow maps instead of re-rendering them
      // (and the on-screen UI never shows up in the glass)
      const reflect = glass.onBeforeRender;
      const ui = (): THREE.Object3D[] => [this.ui, ...[...this.subs.values()].map((q) => q.mesh), this.ttl?.set.root].filter((o) => !!o) as THREE.Object3D[];
      glass.onBeforeRender = function (this: Reflector, r: THREE.WebGLRenderer, ...rest: unknown[]) {
        const au = r.shadowMap.autoUpdate;
        r.shadowMap.autoUpdate = false;
        const hide = ui(), vis = hide.map((o) => o.visible);
        for (const o of hide) o.visible = false;
        try {
          (reflect as (...a: unknown[]) => void).call(this, r, ...rest);
        } finally {
          r.shadowMap.autoUpdate = au;
          hide.forEach((o, i) => (o.visible = vis[i]));
        }
      } as typeof glass.onBeforeRender;
      s.add(glass);
      this.mirror = glass;
    }

    // ------------------------------------------------ the hub look: warmer, softer, a little dreamier
    const u = eng.post.u;
    this.saved = { exposure: eng.renderer.toneMappingExposure, bloom: [eng.post.bloom.strength, eng.post.bloom.radius, eng.post.bloom.threshold], tintS: u.uTintShadows.value.clone(), tintH: u.uTintHighlights.value.clone(), vignette: u.uVignette.value, sat: u.uSaturation.value };
    eng.renderer.toneMappingExposure = 1.0;
    eng.post.bloom.strength = 0.2;
    eng.post.bloom.radius = 0.45;
    eng.post.bloom.threshold = 1.15;
    u.uTintShadows.value.setRGB(0.95, 0.97, 1.06);
    u.uTintHighlights.value.setRGB(1.05, 1.0, 0.93);
    u.uVignette.value = 0.4;
    u.uSaturation.value = 1.1;

    // ------------------------------------------------ the on-screen UI, the camera, the walk in
    this.stations.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    this.buildUI();
    this.camera.aspect = eng.width / eng.height;
    this.camera.fov = 48;
    this.camera.updateProjectionMatrix();
    this.baseP.set(-10.2, 1.7, 2.4);
    this.baseL.set(-5.7, 1.15, -0.05);
    this.camPos.copy(this.baseP);
    this.camLook.copy(this.baseL);
    this.camera.position.copy(this.baseP);
    this.camera.lookAt(this.baseL);
    Codex.sync();
    const wk = this.arrival.wake;
    if (wk && this.futon && this.hero) {
      lastPoster = wk.result;
      this.startWake(wk.days, wk.result);
    } else {
      if (wk) lastPoster = wk.result;
      if (lastPoster) this.nailPoster(lastPoster, true);
      this.go(Math.max(0, this.stations.findIndex((st) => st.id === 'bench')), true);
    }
    (window as any).__music?.setMood('hub');
    this.wind = eng.audio.loop('wind_loop', 0.16);
    eng.input.setWantLock(false);
    this.tip.style.cssText = "position:absolute;z-index:7;pointer-events:none;display:none;font-family:'Alagard';font-size:17px;color:#fff3d6;text-shadow:0 2px 0 #2a1408,0 0 10px #000";
    this.bank.style.cssText = "position:absolute;left:24px;top:20px;z-index:7;pointer-events:none;font-family:'Alagard';font-size:22px;color:#ffd36b;text-shadow:0 3px 0 #2a1408";
    this.title.style.cssText = "position:absolute;right:28px;top:22px;z-index:7;pointer-events:none;font-family:'Alagard';font-size:30px;color:#fff3d6;text-align:right;text-shadow:0 3px 0 #2a1408,0 0 14px #000;opacity:0;transition:opacity 1.2s";
    this.title.innerHTML = 'THE HIDEOUT<div style="font-size:15px;opacity:.8">home, at the edge of the Last Chance</div>';
    // the action: a big prompt under the shot (E / Enter, or click / tap it)
    this.prompt.style.cssText = "position:absolute;left:50%;bottom:64px;transform:translateX(-50%);z-index:8;pointer-events:auto;cursor:pointer;display:block;opacity:0;transition:opacity .35s;font-family:'Alagard';font-size:24px;color:#fff3d6;text-shadow:0 2px 0 #2a1408,0 0 10px #000;white-space:nowrap";
    this.prompt.onmousedown = (e) => e.stopPropagation();
    this.prompt.onclick = () => this.act();
    this.hint.style.cssText = "position:absolute;left:50%;bottom:24px;transform:translateX(-50%);z-index:7;pointer-events:none;font-family:'Alagard';font-size:15px;color:#fff3d6;opacity:0;transition:opacity 1.5s;text-shadow:0 2px 0 #2a1408,0 0 8px #000;white-space:nowrap";
    this.hint.textContent = this.touch ? 'Tap the arrows to look around · tap the prompt to use it' : 'A / D or the arrows: look around   ·   E: use   ·   Esc: menu';
    this.bubble.style.cssText = "position:absolute;z-index:7;pointer-events:none;display:none;transform:translate(-50%,-100%);max-width:260px;padding:8px 12px;background:#f4e6c4;border:3px solid #5a3418;border-radius:14px;box-shadow:0 4px 0 #2a1408;font-family:'Alagard';font-size:16px;color:#2a1a10;text-align:center";
    eng.overlay.append(this.tip, this.bank, this.title, this.prompt, this.hint, this.bubble);
    setTimeout(() => (this.title.style.opacity = '1'), 900);
    setTimeout(() => (this.title.style.opacity = '0'), 5200);
    setTimeout(() => (this.hint.style.opacity = '0.85'), 4600);
    this.updateBank();
    this.ready = true;
  }

  /** register a placed object's footprint as an obstacle */
  private block(o: THREE.Object3D, pad = 0) {
    const b = new THREE.Box3().setFromObject(o);
    if (b.isEmpty() || b.max.y < 0.12) return;
    this.walls.push({ x0: b.min.x - pad, z0: b.min.z - pad, x1: b.max.x + pad, z1: b.max.z + pad });
  }

  /** an old photograph on the mantel: a real 3D portrait photographed by the IconFactory, sepia-graded on card */
  private photo(s: THREE.Scene, x: number, y: number, z: number, ry: number, who: 'mama' | 'hero') {
    const fr = safe(() => WS.photoFrame(who === 'mama' ? 13 : 21));
    const g = geoOf(fr);
    if (!fr || !g) return;
    const grp = new THREE.Group();
    grp.add(meshOf(g));
    grp.position.set(x, y, z);
    grp.rotation.set(-0.16, ry, 0, 'YXZ');
    s.add(grp);
    try {
      this.icons ??= new IconFactory(this.engine.renderer);
      const subject = new THREE.Group();
      const add = (key: string, px: number, pz: number, ry2: number, sc = 1) => {
        const sp = modelEntry(key)?.() as RigSpec | undefined;
        if (!sp?.parts) return null;
        const ri = new RigInstance(buildRigGeo(sp, sp.name + ':photo'), { material: sharedVoxelMaterial });
        ri.root.position.set(px, 0, pz);
        ri.root.rotation.y = ry2;
        ri.root.scale.setScalar(sc);
        subject.add(ri.root);
        return ri;
      };
      if (who === 'mama') {
        add('mama_toad', 0, 0, 0);
        add('toadlet_v1', -0.36, 0.3, 0.4);
        add('toadlet_v2', 0.36, 0.28, -0.3);
        add('toadlet', 0.04, 0.42, 0.1);
      } else {
        const d = loadSave();
        const hs = safe(() => (CH as any).skeletonCowboyRig?.({ hat: d.look.hat, outfit: d.look.outfit }) as RigSpec);
        if (hs) {
          const ri = new RigInstance(buildRigGeo(hs, hs.name + ':photo'), { material: sharedVoxelMaterial });
          if (ri.nodes['arm_r']) ri.nodes['arm_r'].rotation.set(0.1, 0, -0.25);
          if (ri.nodes['fore_r']) ri.nodes['fore_r'].rotation.x = -0.35;
          const ps = modelEntry('pinch')?.() as RigSpec | undefined;
          if (ps?.parts) {
            const pr = new RigInstance(buildRigGeo(ps, ps.name + ':photo'), { material: sharedVoxelMaterial });
            pr.root.scale.setScalar(0.8);
            if (!ri.attach('shoulder_l', pr.root)) ri.nodes['torso']?.add(pr.root);
          }
          subject.add(ri.root);
        }
      }
      const cv = this.icons.capture(subject, { w: 56, h: 72, yaw: 0.3, pitch: 0.08, fill: who === 'mama' ? 0.62 : 0.86, dy: who === 'mama' ? 0.05 : -0.02, light: 'sunset', ink: '#2a1a10', rim: '#fff0c8', levels: 7 });
      // print it: sepia grade on warm card, vignette and a little silver fading
      const out = document.createElement('canvas');
      out.width = cv.width;
      out.height = cv.height;
      const c = out.getContext('2d')!;
      c.fillStyle = '#c9b48a';
      c.fillRect(0, 0, out.width, out.height);
      c.drawImage(cv, 0, 0);
      const img = c.getImageData(0, 0, out.width, out.height);
      for (let yy = 0; yy < out.height; yy++)
        for (let xx = 0; xx < out.width; xx++) {
          const k = (yy * out.width + xx) * 4;
          const l = (img.data[k] * 0.3 + img.data[k + 1] * 0.59 + img.data[k + 2] * 0.11) / 255;
          const dx = (xx + 0.5) / out.width - 0.5, dy = (yy + 0.5) / out.height - 0.5;
          const v = 1 - Math.min(1, (dx * dx + dy * dy) * 2.4);
          const ll = Math.pow(l, 0.9) * (0.55 + 0.45 * v) + (1 - v) * 0.04;
          img.data[k] = Math.min(255, 70 + ll * 175);
          img.data[k + 1] = Math.min(255, 48 + ll * 150);
          img.data[k + 2] = Math.min(255, 30 + ll * 110);
        }
      c.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(out);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearFilter;
      const [w, h] = fr.meta.size;
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.04, h * 1.04), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0 }));
      pl.position.set(fr.meta.photo[0], fr.meta.photo[1], fr.meta.photo[2]);
      grp.add(pl);
    } catch (e) {
      console.warn('[hub] photo', e);
    }
  }

  private updateBank() {
    const d = loadSave();
    this.bank.innerHTML = `BANK: ${d.bank} gold<div style="font-size:15px;color:#fff3d6;opacity:.8">Runs ${d.runs} · Best wave ${d.bestWave} · Outlaws ${d.kills}</div>`;
  }

  private buildHero() {
    const d = loadSave();
    this.hero?.root.removeFromParent();
    let spec: RigSpec | null = null;
    try {
      spec = (CH as any).skeletonCowboyRig?.({ hat: d.look.hat, outfit: d.look.outfit, mask: (d.look as any).mask, shades: (d.look as any).shades }) ?? null;
    } catch (e) {
      console.warn('[hub] hero', e);
    }
    spec = spec ?? ((modelEntry('cowboy_stetson_punk')?.() as RigSpec) || null);
    if (!spec?.parts) return;
    this.heroSpec = spec;
    this.hero = new RigInstance(buildRigGeo(spec, spec.name + ':hub:' + d.look.hat + d.look.outfit + ':' + (d.look as any).mask + (d.look as any).shades), { material: makeVoxelMaterial(), castShadow: true });
    this.heroHolder.add(this.hero.root);
    if (!this.heroHolder.parent) this.scene.add(this.heroHolder);
    this.hero.setExpression('smug');
    this.armL1 = this.hero.nodes['fore_r']?.position.length() || 0.264;
    this.armL2 = this.hero.geo.sockets['hand_r']?.offset.length() || 0.321;
    CH.attachBoardOnBack(this.hero, CH.sandboardModel(d.look.board as CH.BoardId), { material: this.hero.material });
    // Pinch asleep on his shoulder
    const ps = modelEntry('pinch')?.() as RigSpec | undefined;
    if (ps?.parts) {
      this.pinch = new RigInstance(buildRigGeo(ps, ps.name + ':hub'), { material: makeVoxelMaterial(), castShadow: true });
      this.pinch.root.scale.setScalar(0.8);
      if (!this.hero.attach('shoulder_l', this.pinch.root)) this.hero.nodes['torso']?.add(this.pinch.root);
      this.pinch.setExpression('sleepy');
    }
  }

  /** the board you ride on the sawhorses, the others on the rack */
  private buildBoards() {
    const d = loadSave();
    this.boardBench.clear();
    this.boardRackGroup.clear();
    const mk = (id: string) => {
      try {
        const b = (CH as any).sandboardModel?.(id);
        if (!b?.model) return null;
        const g = geoOf(b, 'center');
        return g ? { mesh: meshOf(g), len: (b.meta?.length as number) ?? 1.44 } : null;
      } catch (e) {
        console.warn('[hub] board', e);
        return null;
      }
    };
    const cur = mk(d.look.board);
    if (cur) {
      cur.mesh.rotation.y = Math.PI / 2;
      this.boardBench.add(cur.mesh);
      const kit = geoOf(safe(() => WS.waxKit()));
      if (kit) {
        const km = meshOf(kit);
        km.position.set(0.18, 0.06, 0.0);
        km.rotation.y = 0.3;
        this.boardBench.add(km);
      }
    }
    const slots = (this.boardRackGroup.userData.slots as number[][]) ?? [];
    const lean = (this.boardRackGroup.userData.lean as number) ?? 0.07;
    const others = BOARDS.filter((b) => b !== d.look.board).sort((a, b) => Number(owns('board:' + b)) - Number(owns('board:' + a)));
    others.slice(0, slots.length).forEach((id, i) => {
      const b = mk(id);
      if (!b) return;
      const sl = slots[i];
      const ln = i % 2 ? lean * 1.6 : lean;
      b.mesh.rotation.set(Math.PI / 2 - ln, 0, (i - 2) * 0.012);
      b.mesh.position.set(sl[0], sl[1] + (b.len / 2) * Math.cos(ln), sl[2] - (b.len / 2) * Math.sin(ln) + (i % 2 ? -0.03 : 0.02));
      this.boardRackGroup.add(b.mesh);
    });
  }

  private buildGun() {
    const d = loadSave();
    this.gun?.root.removeFromParent();
    let spec: RigSpec | null = null;
    try {
      spec = (CH as any).revolverRig?.(d.gun) ?? null;
    } catch (e) {
      console.warn('[hub] gun', e);
    }
    if (!spec?.parts) return;
    const key = `gun:${d.gun.barrel}:${d.gun.cylinder}:${d.gun.grip}:${d.gun.sight}`;
    this.gun = new RigInstance(buildRigGeo(spec, key), { material: makeVoxelMaterial(), castShadow: true });
    this.gun.root.scale.setScalar(1.25);
    this.gun.root.rotation.set(0, Math.PI / 2, Math.PI / 2);
    this.gunHolder.add(this.gun.root);
    // centre it on the cradle, resting on its side
    this.gunHolder.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(this.gun.root);
    const c = bb.getCenter(new THREE.Vector3());
    this.gun.root.position.x -= c.x - this.gunHolder.position.x;
    this.gun.root.position.z -= c.z - this.gunHolder.position.z;
    this.gun.root.position.y -= bb.min.y - this.gunHolder.position.y + 0.035;
  }

  // ======================================================================= panels
  private closePanel() {
    this.panel?.remove();
    this.panel = null;
    this.active = null;
  }

  private openPanel(html: HTMLElement, side: 'left' | 'right') {
    this.panel?.remove();
    this.panelSide = side;
    const p = document.createElement('div');
    p.style.cssText = UI_CSS + `;top:50%;transform:translateY(-50%);${side}:4vw;max-width:min(420px,40vw)`;
    const close = document.createElement('button');
    close.textContent = 'DONE';
    close.style.cssText = BTN_CSS + ';display:block;margin:14px auto 0';
    close.onclick = () => this.closePanel();
    p.append(html, close);
    this.engine.overlay.appendChild(p);
    this.panel = p;
  }

  /** the Book of Skills: Sundown's tarot skills up front, Thoth's codex of every soul sent ahead behind them */
  private codex() {
    this.engine.audio.play('book_open', { volume: 0.8 });
    const d = loadSave();
    const wrap = document.createElement('div');
    wrap.style.cssText = 'max-height:58vh;overflow:auto;padding-right:6px';
    wrap.innerHTML = '<div style="font-size:26px;color:#8a2a18;text-align:center">THE BOOK OF SKILLS</div><div style="font-size:14px;text-align:center;opacity:.75;margin-bottom:6px">Moves, cards, and every soul sent ahead.</div>';
    // ---- MOVES: performed with the board, the gun and timing (player/Techniques)
    const mh = document.createElement('div');
    mh.style.cssText = 'font-size:22px;color:#8a2a18;text-align:center;margin:6px 0 2px';
    mh.textContent = 'MOVES';
    wrap.appendChild(mh);
    for (const tq of TECHNIQUES) {
      const open = isUnlocked(tq.id);
      const def = TAROT.find((x) => x.key === tq.art);
      const r = document.createElement('div');
      r.style.cssText = `border-bottom:2px solid rgba(90,52,24,.35);padding:8px 0;display:flex;gap:12px;align-items:center;${open ? '' : 'opacity:.5'}`;
      if (def) {
        // the move's tarot card, photographed from its 3D diorama (baked while the book is open)
        const art = document.createElement('div');
        art.dataset.moveArt = tq.art;
        art.style.cssText = `flex:none;width:63px;height:84px;border:3px solid #2a1408;background:#3a2414;box-shadow:0 3px 0 #2a1408;display:flex;align-items:center;justify-content:center;color:#e8d4a4;font-size:15px;${open ? '' : 'filter:grayscale(1)'}`;
        art.textContent = def.num;
        this.fillMoveArt(art);
        r.appendChild(art);
      }
      const txt = document.createElement('div');
      txt.innerHTML = `<b style="color:#5a1a10">${tq.name}</b><div style="font-size:14px;opacity:.88">${tq.how}</div>` + (open ? '' : `<div style="font-size:14px;color:#8a2a18;margin-top:2px">LOCKED · ${tq.unlockHint}</div>`);
      r.appendChild(txt);
      wrap.appendChild(r);
    }
    if (!this.artJob && TECHNIQUES.some((tq) => TAROT.some((d) => d.key === tq.art) && !this.moveArt.has(tq.art))) this.artJob = this.bakeMoveArt();
    // ---- the tarot bar's cards
    const sh = document.createElement('div');
    sh.style.cssText = 'font-size:22px;color:#8a2a18;text-align:center;margin:14px 0 2px';
    sh.textContent = 'THE CARDS';
    wrap.appendChild(sh);
    for (const [k, card, text] of SKILL_PAGES) {
      const r = document.createElement('div');
      r.style.cssText = 'border-bottom:2px solid rgba(90,52,24,.35);padding:6px 0;display:flex;gap:10px;align-items:center';
      r.innerHTML = `<span style="display:inline-block;min-width:26px;text-align:center;padding:2px 4px;border:3px solid #2a1408;background:#c9a050;font-size:15px">${k}</span><div><b style="color:#5a1a10">${card}</b><div style="font-size:14px;opacity:.85">${text}</div></div>`;
      wrap.appendChild(r);
    }
    const h = document.createElement('div');
    h.style.cssText = 'font-size:22px;color:#8a2a18;text-align:center;margin:14px 0 2px';
    h.innerHTML = "THOTH'S CODEX<div style=\"font-size:14px;opacity:.75;color:#2a1a10\">Every soul you send ahead is written down.</div>";
    wrap.appendChild(h);
    for (const e of Object.values(ENEMIES) as any[]) {
      const n = d.codex[e.id] ?? 0;
      const r = document.createElement('div');
      r.style.cssText = 'border-bottom:2px solid rgba(90,52,24,.35);padding:6px 0';
      r.innerHTML = n > 0 ? `<b style="color:#5a1a10">${e.name}</b> <span style="float:right">${n} slain</span><div style="font-size:14px;opacity:.8">${e.title}</div>` : `<b style="opacity:.5">???</b><div style="font-size:14px;opacity:.5">Not yet encountered.</div>`;
      wrap.appendChild(r);
    }
    this.openPanel(wrap, 'right');
  }

  /** drop a baked move photo into its slot (if it's ready) */
  private fillMoveArt(el: HTMLElement) {
    const url = this.moveArt.get(el.dataset.moveArt ?? '');
    if (!url) return;
    el.textContent = '';
    el.style.background = `#3a2414 url(${url}) center/cover no-repeat`;
  }

  /** photograph the moves' tarot dioramas through the CardStudio, a slice at a time (like the tarot bar) */
  private *bakeMoveArt(): Generator<void, void, void> {
    const d = loadSave();
    const gunSpec = safe(() => (CH as any).revolverRig?.(d.gun) as RigSpec) ?? null;
    const studio = new CardStudio(this.engine.renderer);
    const kit = new Kit(this.heroSpec, 'hub-book:' + d.look.hat + d.look.outfit, gunSpec);
    try {
      for (const tq of TECHNIQUES) {
        const def = TAROT.find((x) => x.key === tq.art);
        if (!def || this.moveArt.has(def.key)) continue;
        try {
          const it = def.scene(kit);
          let r = it.next();
          while (!r.done) {
            yield;
            r = it.next();
          }
          yield;
          const cv = studio.shoot(r.value, MOVE_ART_SIZE[0], MOVE_ART_SIZE[1], 2);
          this.moveArt.set(def.key, cv.toDataURL());
          this.panel?.querySelectorAll<HTMLElement>(`[data-move-art="${def.key}"]`).forEach((el) => this.fillMoveArt(el));
        } catch (e) {
          console.warn('[hub] move art failed', tq.id, e);
        }
        kit.flush();
        yield;
      }
    } finally {
      kit.dispose();
      studio.dispose();
    }
  }

  private stepMoveArt() {
    if (!this.artJob) return;
    const t0 = performance.now();
    try {
      do {
        if (this.artJob.next().done) {
          this.artJob = null;
          break;
        }
      } while (performance.now() - t0 < 9);
    } catch (e) {
      console.warn('[hub] move art', e);
      this.artJob = null;
    }
  }

  private say(text: string) {
    this.bubbleText = text;
    this.bubbleT = 0;
    this.mamaTalk = 1.4 + text.length * 0.045;
    this.engine.audio.play('squeak', { volume: 0.4, pitch: 0.42 + Math.random() * 0.08 });
    Voice.say('mamaToad', text, { pos: this.mamaHead });
  }

  /** use a station (Sundown is standing at it) */
  private use(st: Station) {
    const eng = this.engine;
    switch (st.id) {
      case 'wardrobe':
      case 'bench':
      case 'garage':
      case 'range':
      case 'cards':
      case 'trophies':
        this.extras?.use(st);
        break;
      case 'book':
        this.active = st;
        this.openBook();
        break;
      case 'hearth':
      case 'mama':
        this.mamaLine = (this.mamaLine + 1) % MAMA_LINES.length;
        this.say(MAMA_LINES[this.mamaLine]);
        this.mamaCd = 14;
        break;
      case 'duck':
        if (this.extras) this.extras.squeeze();
        else {
          this.duckSquash = 1;
          eng.audio.play('duck_quack', { volume: 1, pitch: 0.9 + rnd.next() * 0.3 });
        }
        break;
      case 'gramophone':
        if (this.extras?.use(st)) break;
        this.music = !this.music;
        (window as any).__music?.setMood(this.music ? 'hub' : 'off');
        eng.audio.play('ui_click', { volume: 0.7 });
        break;
      case 'ride':
        eng.audio.play('door_creak', { volume: 0.8 });
        this.onRide();
        break;
    }
  }

  // ======================================================================= the carousel
  /** the station the camera is on */
  private get here(): Station {
    return this.stations[this.idx] ?? this.stations[0];
  }
  /** the camera has settled and Sundown is standing at the station */
  private get arrived() {
    return !this.mv && this.route.length === 0;
  }

  /** one station left (-1) or right (+1) */
  private step(d: number) {
    const n = this.stations.length;
    if (!n || this.intro) return;
    this.go((((this.idx + d) % n) + n) % n);
    const a = this.arrows.find((q) => q.dir === Math.sign(d));
    if (a) a.push = 1;
  }

  /** swing the camera over to a station on an eased arc while Sundown walks there */
  private go(i: number | Station, intro = false) {
    const st = typeof i === 'number' ? this.stations[i] : i;
    if (!st) return;
    if (this.panel) this.closePanel();
    this.extras?.cancel();
    this.idx = this.stations.indexOf(st);
    if (intro) {
      // in from the street, through the barn doors
      this.pos.set(-6.9, 0.55);
      this.yaw = Math.PI / 2;
      this.route = [new THREE.Vector2(-5.4, 0.36), new THREE.Vector2(-4.45, LANE_Z), ...st.via.map((v) => v.clone()), st.stand.clone()];
    } else this.route = this.planRoute(st);
    let len = 0;
    let prev = this.pos;
    for (const p of this.route) {
      len += p.distanceTo(prev);
      prev = p;
    }
    const shot = this.shotOf(st);
    const dist = this.baseP.distanceTo(shot.pos);
    const dur = intro ? 4.6 : THREE.MathUtils.clamp(1.25 + dist * 0.2 + len * 0.07, 1.5, 3.0);
    this.speed = THREE.MathUtils.clamp(len / Math.max(0.5, dur * 0.85), 1.05, 3.3);
    // the arc bows toward the open middle of the room and lifts a little (under the tie beams)
    const c = this.baseP.clone().lerp(shot.pos, 0.5).lerp(new THREE.Vector3(0.2, 1.7, 1.0), 0.35);
    c.y += 0.12 + dist * 0.04;
    if (intro) c.set(-5.6, 1.85, 1.05);
    c.set(THREE.MathUtils.clamp(c.x, -4.3, 4.3), Math.min(c.y, 2.12), THREE.MathUtils.clamp(c.z, -2.8, 2.9));
    const outside = (p: THREE.Vector3) => p.x > IN.right - 0.1;
    if (st.arc && !intro) c.copy(st.arc);
    else if (outside(this.baseP) && !intro) c.set(4.15, 1.68, 1.62); // back in through the door
    this.mv = { t: 0, dur, p0: this.baseP.clone(), l0: this.baseL.clone(), f0: this.camera.fov, c, intro };
    if (!intro) this.engine.audio.play('paper_flutter', { volume: 0.18, pitch: 0.7 });
  }

  /** E / Enter / the prompt: use the station he's standing at */
  private act() {
    if (this.intro || this.panel || !this.arrived) return;
    this.use(this.here);
  }

  /** back out along the walk-in he's on to the lane, along it, then in to the new stand */
  private planRoute(to: Station) {
    const P = this.pos;
    const chainOf = (s: Station) => [...s.via, s.stand];
    if (Math.abs(P.y - LANE_Z) < 0.15) return chainOf(to).map((v) => v.clone());
    let best: Station | null = null, bi = 0, bd = 1e9;
    for (const s of this.stations) {
      const ch = chainOf(s);
      for (let k = 0; k < ch.length - 1; k++) {
        const a = ch[k], b = ch[k + 1];
        const abx = b.x - a.x, aby = b.y - a.y;
        const u = clamp01(((P.x - a.x) * abx + (P.y - a.y) * aby) / (abx * abx + aby * aby || 1e-6));
        const d = Math.hypot(P.x - a.x - abx * u, P.y - a.y - aby * u);
        if (d < bd) {
          bd = d;
          best = s;
          bi = k;
        }
      }
    }
    if (!best || bd > 0.7) return [new THREE.Vector2(P.x, LANE_Z), ...chainOf(to).map((v) => v.clone())];
    const ch = chainOf(best);
    if (best === to) return ch.slice(bi + 1).map((v) => v.clone());
    return [...ch.slice(0, bi + 1).reverse(), ...chainOf(to)].map((v) => v.clone());
  }

  exit() {
    this.panel?.remove();
    for (const el of [this.tip, this.bank, this.title, this.prompt, this.hint, this.bubble, ...this.arrows.map((a) => a.label)]) el.remove();
    this.wind?.stop(0.5);
    this.fireLoop?.stop(0.3);
    document.body.style.cursor = 'default';
    const eng = this.engine;
    if (this.saved) {
      const u = eng.post.u;
      eng.renderer.toneMappingExposure = this.saved.exposure;
      [eng.post.bloom.strength, eng.post.bloom.radius, eng.post.bloom.threshold] = this.saved.bloom;
      u.uTintShadows.value.copy(this.saved.tintS);
      u.uTintHighlights.value.copy(this.saved.tintH);
      u.uVignette.value = this.saved.vignette;
      u.uSaturation.value = this.saved.sat;
    }
    this.mirror?.dispose();
    this.envRT?.dispose();
    this.icons?.dispose();
    for (const sub of this.subs.values()) sub.dispose();
    for (const set of this.titles.values()) for (const m of set.letters) m.geometry.dispose();
    this.titleMat?.dispose();
    for (const a of this.arrows) {
      a.mat.dispose();
      a.mesh.geometry.dispose();
    }
    this.book?.dispose();
    this.book = null;
    this.extras?.dispose();
    this.extras = null;
    this.poster?.dispose();
    this.bankToast?.remove();
    if ((window as any).__hub === this) (window as any).__hub = null;
  }

  // ======================================================================= locomotion (he walks the route; no free walking)
  private locomote(rdt: number) {
    const want = new THREE.Vector2();
    if (this.route.length) {
      const tgt = this.route[0];
      const dx = tgt.x - this.pos.x, dz = tgt.y - this.pos.y;
      const d = Math.hypot(dx, dz);
      const last = this.route.length === 1;
      if (d < (last ? 0.035 : 0.28)) {
        this.route.shift();
        if (!this.route.length) {
          this.faceTo = this.here.face;
          this.onArrive(this.here);
        }
      }
      if (this.route.length) {
        const sp = last ? Math.min(this.speed, d * 2.6 + 0.06) : this.speed;
        // uneven, lurching steps (a stumble surges him forward); the last stretch onto the stand stays exact
        const lurch = last ? 1 : this.drunk.tempo * (1 + 0.45 * this.drunk.trip);
        want.set(dx, dz).multiplyScalar((sp / Math.max(d, 1e-4)) * lurch);
      }
    }
    this.vel.x = damp(this.vel.x, want.x, 6, rdt);
    this.vel.y = damp(this.vel.y, want.y, 6, rdt);
    const before = this.pos.clone();
    this.pos.addScaledVector(this.vel, rdt);
    // settle exactly onto the stand
    if (!this.route.length && !this.intro) this.pos.lerp(this.here.stand, 1 - Math.exp(-rdt * 4));
    const moved = this.pos.clone().sub(before).length() / Math.max(rdt, 1e-4);
    const sp = Math.min(moved, this.vel.length() + 0.05);
    // heading
    let tgtYaw = this.yaw;
    if (sp > 0.12 && this.route.length) tgtYaw = Math.atan2(this.vel.x, this.vel.y);
    else if (this.faceTo !== null) tgtYaw = this.faceTo;
    let dy = tgtYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-rdt * (sp > 0.12 ? 9 : 5)));
    this.moveK = damp(this.moveK, Math.min(1, sp / 1.2), 8, rdt);
    this.runK = damp(this.runK, Math.min(1, Math.max(0, (sp - 1.6) / 1.2)), 5, rdt);
    this.atK = damp(this.atK, this.route.length ? 0 : 1, this.route.length ? 8 : 3, rdt);
    // gait phase: a stance covers 2·amp at body speed
    const amp = 0.17 + 0.11 * this.runK;
    const duty = 0.62 - 0.14 * this.runK;
    this.phase += ((Math.max(sp, 0) * duty) / (2 * amp)) * rdt;
    // footsteps
    for (let k = 0; k < 2; k++) {
      const f = (this.phase + k * 0.5) % 1;
      if (this.moveK > 0.35 && f < this.lastStep[k]) this.engine.audio.play('footstep_sand', { volume: (this.pos.x < HX.CABIN_OPEN.garageX ? 0.22 : 0.14) + this.runK * 0.1, pitch: this.pos.x < HX.CABIN_OPEN.garageX ? 1.0 : 1.35 });
      this.lastStep[k] = f;
    }
    this.heroHolder.position.set(this.pos.x, 0, this.pos.y);
    this.heroHolder.rotation.y = this.yaw;
    return { amp, duty, sp };
  }
  private faceTo: number | null = null;

  /** he's there: Mama greets him at the hearth */
  private onArrive(st: Station) {
    this.extras?.onArrive(st);
    if (st.id === 'hearth' && this.mamaCd <= 0) {
      this.mamaLine = this.mamaLine === 0 && !this.bubbleText ? 0 : (this.mamaLine + 1) % MAMA_LINES.length;
      this.say(MAMA_LINES[this.mamaLine]);
      this.mamaCd = 16 + Math.random() * 6;
    }
  }

  /** world-space hand targets (and elbow poles, in the torso frame) for the pose at a station */
  private poseTargets(st: Station, t: number) {
    const H = this.heroHolder;
    const n = this.hero!.nodes;
    const W = (x: number, y: number, z: number) => H.localToWorld(new THREE.Vector3(x, y, z));
    const out: { l: THREE.Vector3 | null; r: THREE.Vector3 | null; poleL?: THREE.Vector3; poleR?: THREE.Vector3 } = { l: null, r: null };
    const belt = (s: number) => W(s * 0.165, 0.77, 0.085);
    const hip = (s: number) => W(s * 0.2, 0.8, -0.01);
    const brim = () => (n['head'] ? n['head'].localToWorld(new THREE.Vector3(-0.085, 0.33, 0.21)) : W(-0.1, 1.75, 0.2));
    /** 0 → 1 → 0 once per period: up over [a, b], down over [c, d] */
    const pulse = (period: number, a: number, b: number, c: number, d: number) => {
      const p = t % period;
      return sstep(a, b, p) * (1 - sstep(c, d, p));
    };
    switch (st.pose) {
      case 'door': {
        // looking out at the dunes, one thumb in his belt; now and then he tugs his hat brim to the sunset
        const w = pulse(7.5, 1.0, 1.6, 3.4, 4.1);
        out.r = belt(-1).lerp(brim(), w);
        out.l = belt(1);
        out.poleR = new THREE.Vector3(-1, -0.4 + w * 0.3, -0.3 + w * 0.5);
        out.poleL = new THREE.Vector3(1, -0.2, -0.4);
        break;
      }
      case 'bench': {
        // leaning on the bench, hands spread on the top; every few seconds he reaches in to fiddle with the gun
        const y = (st.surf ?? 0.9) + 0.03, r = st.reach ?? 0.4;
        out.l = W(0.22, y, r);
        const w = pulse(5.2, 1.0, 1.5, 3.4, 3.9);
        out.r = W(-0.2, y, r + 0.02).lerp(W(-0.05 + Math.sin(t * 9) * 0.012, y + 0.05 + Math.abs(Math.sin(t * 4.5)) * 0.02, r + 0.18), w);
        break;
      }
      case 'board': {
        // waxing the board on the sawhorses: slow circles with the right hand, the left braced on the rail
        const y = st.surf ?? 0.75, r = st.reach ?? 0.5;
        const a = t * 3.2;
        out.r = W(-0.12 + Math.cos(a) * 0.07, y + 0.01, r - 0.04 + Math.sin(a) * 0.05);
        out.l = W(0.22, y + 0.01, r - 0.08);
        break;
      }
      case 'mirror': {
        // hands on hips, looking himself over; now and then a hat adjustment
        out.l = hip(1);
        out.r = hip(-1);
        out.poleL = new THREE.Vector3(1, 0.15, -0.25);
        out.poleR = new THREE.Vector3(-1, 0.15, -0.25);
        const w = pulse(6.5, 2.0, 2.5, 3.9, 4.4);
        if (w > 0) {
          out.r.lerp(brim(), w);
          out.poleR.set(-1, -0.2, 0.1);
        }
        break;
      }
      case 'book': {
        // a hand on the lectern, turning pages: lift from the right page, over the spine, down on the left, back
        const b = H.worldToLocal(st.at.clone());
        const p = t % 4.4;
        const e = ease(clamp01((p - 1.2) / 0.85)) * (1 - ease(clamp01((p - 2.5) / 0.7)));
        const x = -0.11 + 0.22 * e;
        out.r = W(b.x + x, b.y + 0.03 + Math.sin(Math.PI * e) * 0.1, b.z + Math.sin(Math.PI * e) * 0.03);
        out.l = W(b.x + 0.18, b.y + 0.01, b.z - 0.07);
        break;
      }
      case 'hearth': {
        // hands out to the fire, palms to the warmth; now and then he rubs them together
        const rub = pulse(5, 1.2, 1.4, 2.6, 2.8);
        const s = Math.sin(t * 15) * 0.03 * rub;
        out.l = W(0.09 - 0.05 * rub, 1.08, 0.4 + s);
        out.r = W(-0.09 + 0.05 * rub, 1.08, 0.4 - s);
        out.poleL = new THREE.Vector3(0.8, -0.6, -0.3);
        out.poleR = new THREE.Vector3(-0.8, -0.6, -0.3);
        break;
      }
      case 'range':
      case 'cards':
        out.r = belt(-1);
        out.l = belt(1);
        out.poleR = new THREE.Vector3(-1, -0.2, -0.4);
        out.poleL = new THREE.Vector3(1, -0.2, -0.4);
        break;
      case 'trophies': {
        // thumbs hooked in his belt, admiring the wall; now and then a hat tip to the fallen
        const w = pulse(9, 3.0, 3.5, 4.6, 5.1);
        out.l = belt(1);
        out.r = belt(-1).lerp(brim(), w);
        out.poleL = new THREE.Vector3(1, -0.2, -0.4);
        out.poleR = new THREE.Vector3(-1, -0.4 + w * 0.3, -0.3 + w * 0.5);
        break;
      }
      case 'music': {
        if (this.music) {
          // snapping his fingers to the record, the other thumb in his belt
          const b = Math.abs(Math.sin(t * Math.PI * 1.75));
          out.r = W(-0.26, 1.2 + b * 0.04, 0.16);
          out.l = belt(1);
          out.poleR = new THREE.Vector3(-1, -0.5, -0.2);
        } else {
          out.r = belt(-1);
          out.l = belt(1);
        }
        break;
      }
    }
    return out;
  }

  /** procedural walk (exact two-bone leg IK on planted feet), then a station pose: hands on IK targets, lean, weight shift, a head that looks */
  private animateHero(g: { amp: number; duty: number }, t: number, rdt: number) {
    const h = this.hero;
    const spec = this.heroSpec;
    if (!h || !spec) return;
    const n = h.nodes;
    const mk = this.moveK, rk = this.runK;
    const st = this.here;
    const P = this.atK;
    const pose = st.pose;
    const groove = pose === 'music' && this.music ? P : 0;
    const beat = t * Math.PI * 1.75; // ~105 bpm
    const hipY = (spec.meta?.hipY as number) ?? 0.67, kneeY = (spec.meta?.kneeY as number) ?? 0.36;
    const l1 = hipY - kneeY, l2 = kneeY;
    this.heroHolder.updateMatrixWorld(true);
    // pelvis: settle a little into the knees, bob twice a cycle, breathe when still; shift the weight (or sway to the record)
    const shiftX = P * 0.016 * Math.sin(t * 0.45) * (1 - groove) + groove * Math.sin(beat) * 0.03;
    const crouch = P * (pose === 'board' ? 0.06 : pose === 'bench' ? 0.025 : pose === 'hearth' ? 0.015 : 0) + groove * Math.abs(Math.sin(beat)) * 0.014;
    const drop = -0.022 - 0.03 * rk - 0.012 * mk - crouch;
    const bob = (0.016 + 0.02 * rk) * mk * Math.cos(this.phase * Math.PI * 4);
    const breathe = Math.sin(t * 1.5) * 0.004 * (1 - mk);
    h.root.position.set(shiftX, drop + bob + breathe, 0);
    // the whiskey swagger rides on the walk: a weaving line, swaying hips, lurches, loose arms, a lolling head
    const dw = this.drunk;
    dw.update(rdt, 0, mk * (1 - P), this.phase * Math.PI * 2 + Math.PI / 2);
    h.root.position.x += dw.pelvisPos.x;
    h.root.position.y += dw.pelvisPos.y * 0.4;
    const lift = 0.07 + 0.06 * rk;
    const legs: [string, string, number, number][] = [['thigh_l', 'shin_l', 0, 1], ['thigh_r', 'shin_r', 0.5, -1]];
    const sweeps = [0, 0];
    legs.forEach(([th, sh, off, side], i) => {
      const L = leg(this.phase + off, g.duty);
      sweeps[i] = L.sweep * mk;
      const thigh = n[th], shin = n[sh];
      if (!thigh || !shin) return;
      const hipX = thigh.position.x;
      const fx = hipX * 0.9 + side * (0.012 + 0.03 * P) * (1 - mk) - shiftX;
      const fz = L.sweep * g.amp * mk + 0.02;
      const fy = L.lift * lift * mk;
      legIK(fx - hipX, fy - (hipY + h.root.position.y), fz, l1, l2, 0.6, this.lp);
      thigh.rotation.set(this.lp.x, 0, this.lp.z);
      shin.rotation.set(this.lp.knee, 0, this.lp.roll);
    });
    const [sL, sR] = sweeps;
    if (n['pelvis']) n['pelvis'].rotation.set(dw.pelvisRot.x * 0.6, -0.12 * sL + dw.pelvisRot.y * 0.6, 0.035 * Math.sin(this.phase * Math.PI * 2) * mk + Math.sin(t * 0.37) * 0.012 * (1 - mk) - shiftX * 1.6 + dw.pelvisRot.z * 0.7);
    const LEAN: Record<HeroPose, number> = { door: -0.02, bench: 0.3, board: 0.42, mirror: -0.06, book: 0.18, hearth: 0.12, music: 0.02, range: 0, cards: 0.1, trophies: -0.04 };
    const lean = 0.03 + 0.06 * mk + 0.1 * rk + Math.sin(t * 1.5) * 0.008 * (1 - mk) + P * LEAN[pose] + groove * 0.03;
    const twist = P * (pose === 'mirror' ? Math.sin(t * 0.5) * 0.14 : pose === 'door' ? -0.08 : 0) + groove * Math.sin(beat * 0.5) * 0.1;
    if (n['torso']) n['torso'].rotation.set(lean + dw.torsoRot.x * 0.8, 0.17 * sL + twist + dw.torsoRot.y * 0.7, -0.02 * Math.sin(this.phase * Math.PI * 2) * mk + groove * Math.sin(beat * 0.5) * 0.04 + dw.torsoRot.z * 0.9);
    // arms: the walking swing, bent toward the pose's IK targets as he settles in
    const swing = 0.42 + 0.35 * rk;
    const al = -swing * sR + 0.04, ar = -swing * sL + 0.04;
    const fl = -0.2 - 0.6 * rk - 0.18 * Math.max(0, -al), fr = -0.2 - 0.6 * rk - 0.18 * Math.max(0, -ar);
    const zl = 0.07 + Math.sin(t * 0.9) * 0.01, zr = -0.07 - Math.sin(t * 0.9 + 1) * 0.01;
    h.root.updateMatrixWorld(true);
    const tg = P > 0.01 ? this.poseTargets(st, t) : null;
    const torso = n['torso'];
    if (tg && torso) this.m4.copy(torso.matrixWorld).invert();
    const k = 1 - Math.exp(-rdt * 14);
    const arm = (side: 'l' | 'r', ex: number, ez: number, fx: number) => {
      const A = n['arm_' + side], F = n['fore_' + side];
      if (!A || !F) return;
      this.qa.setFromEuler(this.eu.set(ex, 0, ez));
      this.qb.setFromEuler(this.eu.set(fx, 0, 0));
      const T = tg?.[side];
      if (T && torso) {
        const tl = T.clone().applyMatrix4(this.m4);
        const pole = (side === 'l' ? tg!.poleL : tg!.poleR) ?? new THREE.Vector3(side === 'l' ? 0.6 : -0.6, -0.2, -1);
        armIK(A.position, tl, pole, this.armL1, this.armL2, this.v3.set(0, 0.3, 1), this.qc, this.qd);
        this.qa.slerp(this.qc, P);
        this.qb.slerp(this.qd, P);
      }
      A.quaternion.slerp(this.qa, k);
      F.quaternion.slerp(this.qb, k);
    };
    // drunk, the arms hang loose and fall out of step with the legs
    const ds = 1 - 0.55 * dw.amt;
    arm('l', al * ds + dw.armL.x, zl + dw.armL.z * 0.8, fl + (dw.armL.fore + 0.22) * 0.8);
    arm('r', ar * ds + dw.armR.x, zr + dw.armR.z * 0.8, fr + (dw.armR.fore + 0.28) * 0.8);
    // the duster's skirt trails the stride
    if (n['coat']) n['coat'].rotation.set(0.05 * mk + 0.12 * rk + Math.abs(sL) * 0.05, 0, 0.03 * Math.sin(this.phase * Math.PI * 2) * mk);
    // head: down the road while walking; at a station, the work, the mirror, the dunes, the fire, Mama when she talks
    const look = this.v1.set(this.pos.x + Math.sin(this.yaw + Math.sin(t * 0.21) * 0.4) * 3, 1.5, this.pos.y + Math.cos(this.yaw + Math.sin(t * 0.21) * 0.4) * 3);
    if (P > 0.01) {
      const H = this.heroHolder;
      const pl = this.v2;
      switch (pose) {
        case 'door':
          H.localToWorld(pl.set(Math.sin(t * 0.17) * 1.6, 1.62, 7));
          break;
        case 'bench':
          this.gunHolder.getWorldPosition(pl);
          break;
        case 'board':
          pl.copy(this.boardBench.position);
          break;
        case 'mirror':
          pl.copy(st.at).add(this.v3.set(0, Math.sin(t * 0.7) * 0.05, 0));
          break;
        case 'book':
          pl.copy(st.at);
          break;
        case 'hearth':
          if (this.mamaTalk > 0.2 || Math.sin(t * 0.23) > 0.55) pl.copy(this.mamaHead).add(this.v3.set(0, -0.2, 0));
          else pl.copy(this.firePos);
          break;
        case 'range':
          pl.copy(st.at);
          break;
        case 'trophies':
          pl.set(0.9 + Math.sin(t * 0.19) * 1.1, 1.75, IN.front);
          break;
        case 'cards':
          pl.copy(this.mamaHead).add(this.v3.set(0, -0.15, 0));
          break;
        case 'music':
          if (this.music) H.localToWorld(pl.set(Math.sin(t * 0.3) * 0.8, 1.6, 3));
          else pl.copy(st.at);
          break;
      }
      look.lerp(pl, P);
    }
    const dx = look.x - this.pos.x, dz = look.z - this.pos.y;
    let ly = Math.atan2(dx, dz) - this.yaw;
    ly = Math.atan2(Math.sin(ly), Math.cos(ly));
    const lpch = Math.atan2(1.62 - look.y, Math.hypot(dx, dz));
    this.headYaw = damp(this.headYaw, Math.max(-0.95, Math.min(0.95, ly)) - 0.17 * sL - twist * 0.6, 5, rdt);
    this.headPitch = damp(this.headPitch, Math.max(-0.4, Math.min(0.62, lpch)) - lean * 0.6, 5, rdt);
    if (n['head']) n['head'].rotation.set(this.headPitch + groove * Math.sin(beat * 2) * 0.07 + dw.head.x, this.headYaw + dw.head.y * 0.6, Math.sin(t * 0.5) * 0.02 + groove * Math.sin(beat) * 0.05 + dw.head.z);
    h.root.updateMatrixWorld(true);
  }

  // ======================================================================= frame
  update(_dt: number, rdt: number) {
    this.t += rdt;
    const t = this.t;
    const eng = this.engine;
    const inp = eng.input;
    // the Codex owns the screen while it is open
    if (this.book) {
      this.book.update(rdt);
      return;
    }
    if (this.wake) {
      this.updateWake(rdt);
      this.updateCamera(t, rdt);
      this.placeUI(t, rdt);
      this.updateTitle(rdt);
      this.animateLife(t, rdt);
      this.particles.update(rdt, this.scene.fog as THREE.Fog);
      return;
    }
    if (inp.wasPressed('Escape')) {
      if (this.extras?.escape()) {
        /* the extras stepped back */
      } else if (this.panel) this.closePanel();
      else this.onMenu();
    }
    const g = this.locomote(rdt);
    this.animateHero(g, t, rdt);
    this.extras?.poseHero(t, rdt);
    // ------------------------------------------------ the camera, then the UI that rides with it
    this.updateCamera(t, rdt);
    this.placeUI(t, rdt);
    this.updateTitle(rdt);

    // ------------------------------------------------ left / right, use; the arrow signs, the stations, the duck under the mouse
    const free = !this.panel && !this.intro && !this.extras?.busy;
    if (free) {
      if (inp.wasPressed('KeyA') || inp.wasPressed('ArrowLeft')) this.step(-1);
      else if (inp.wasPressed('KeyD') || inp.wasPressed('ArrowRight')) this.step(1);
      if (inp.wasPressed('KeyE') || inp.hit('interact') || inp.wasPressed('Space')) this.act();
    }
    let arrowDir = 0;
    let hit: Station | null = null;
    let duck = false;
    if (free) {
      this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), this.camera);
      const ah = this.ray.intersectObjects(this.arrows.filter((a) => a.grp.visible).map((a) => a.mesh), false);
      if (ah.length) arrowDir = this.arrows.find((a) => a.mesh === ah[0].object)?.dir ?? 0;
      else {
        const hits = this.ray.intersectObjects(this.stations.flatMap((s) => s.objs), true);
        if (hits.length) {
          let o: THREE.Object3D | null = hits[0].object;
          while (o && !hit) {
            if (o === this.duck) duck = true;
            const oo = o;
            hit = this.stations.find((s) => s.objs.includes(oo)) ?? null;
            o = o.parent;
          }
          if (o === this.duck) duck = true;
        }
      }
    }
    const hoverKey = arrowDir ? 'a' + arrowDir : duck ? 'duck' : (hit?.id ?? '');
    if (hoverKey !== this.hoverKey) {
      if (hoverKey) eng.audio.play('ui_hover', { volume: 0.25 });
      this.hoverKey = hoverKey;
      document.body.style.cursor = hoverKey ? 'pointer' : 'default';
    }
    this.hoverArrow = arrowDir;
    const tipText = arrowDir ? '' : duck ? 'Squeeze the duck' : hit ? (hit === this.here ? hit.verb : 'Go to the ' + hit.short.toLowerCase()) : '';
    if (tipText) {
      this.tip.textContent = tipText;
      this.tip.style.display = 'block';
      this.tip.style.left = `${inp.mouseX + 16}px`;
      this.tip.style.top = `${inp.mouseY + 12}px`;
    } else this.tip.style.display = 'none';
    if (free && inp.wasPressed('Mouse0')) {
      if (arrowDir) this.step(arrowDir);
      else if (duck && this.here.id === 'gramophone') this.use({ ...this.here, id: 'duck' });
      else if (hit) {
        if (hit === this.here) this.act();
        else this.go(hit);
      }
    }
    // ------------------------------------------------ the action prompt under the shot
    const showPrompt = free && this.arrived;
    this.prompt.style.opacity = showPrompt ? '1' : '0';
    this.prompt.style.pointerEvents = showPrompt ? 'auto' : 'none';
    const st = this.here;
    const verb = this.extras?.verbFor(st) ?? (st.id === 'gramophone' ? (this.music ? 'Hush the record' : 'Play a record') : st.verb);
    const key = this.touch ? 'TAP' : 'E';
    const html = `<span style="display:inline-block;padding:1px 9px;margin-right:10px;background:#e8d4a4;color:#2a1a10;border:3px solid #2a1408;box-shadow:0 3px 0 #2a1408">${key}</span>${verb.toUpperCase()}`;
    if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;

    // ------------------------------------------------ the house breathes
    this.animateLife(t, rdt);
    this.extras?.update(t, rdt);
    this.particles.update(rdt, this.scene.fog as THREE.Fog);
    this.stepMoveArt();
  }
  private hoverKey = '';

  /** the two carved arrow signs ride at the screen's edges, a hand's breadth in front of the lens */
  private buildUI() {
    const s = this.scene;
    s.add(this.ui);
    for (const dir of [-1, 1] as const) {
      const sm = safe(() => WS.arrowSign(dir));
      const g = geoOf(sm, 'center');
      if (!sm || !g) continue;
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
      const mesh = new THREE.Mesh(bakeUILight(g), mat);
      mesh.renderOrder = 6;
      const grp = new THREE.Group();
      grp.add(mesh);
      grp.visible = false;
      this.ui.add(grp);
      this.arrowScale = 0.19 / sm.meta.length;
      const label = document.createElement('div');
      label.style.cssText = "position:absolute;z-index:7;pointer-events:auto;cursor:pointer;transform:translate(-50%,0);font-family:'Alagard';font-size:15px;color:#fff3d6;text-shadow:0 2px 0 #2a1408,0 0 8px #000;white-space:nowrap;opacity:0";
      label.onmousedown = (e) => e.stopPropagation();
      label.onclick = () => this.step(dir);
      this.engine.overlay.appendChild(label);
      this.arrows.push({ dir, grp, mesh, mat, hover: 0, push: 0, label });
    }
    this.titleMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    this.titleMat.color.setScalar(1.18);
    for (const st of this.stations) {
      this.titles.set(st.id, voxelTitle(st.title, 0.08, this.titleMat));
      const sub = new FloatText3D(st.sub, { size: 0.03, px: 48, cps: 34, wrap: 60, align: 'left', hdr: 1.15, color: '#fff3d6', glow: '#ffb070' });
      sub.show(false);
      s.add(sub.mesh);
      this.subs.set(st.id, sub);
    }
  }

  private placeUI(t: number, rdt: number) {
    const cam = this.camera;
    this.ui.position.copy(cam.position);
    this.ui.quaternion.copy(cam.quaternion);
    this.ui.updateMatrixWorld(true);
    const show = !this.panel && !this.intro && !this.extras?.busy;
    this.uiK = damp(this.uiK, show ? 1 : 0, show ? 3.5 : 9, rdt);
    const d = 0.95;
    const halfH = d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), halfW = halfH * cam.aspect;
    const n = this.stations.length;
    for (const a of this.arrows) {
      a.hover = damp(a.hover, this.hoverArrow === a.dir ? 1 : 0, 10, rdt);
      a.push = Math.max(0, a.push - rdt * 2.6);
      // an idle nudge in the way it points, a kick when used
      const nudge = Math.pow(Math.max(0, Math.sin(t * 2.2 + (a.dir > 0 ? 0 : 1.7))), 8) * 0.014;
      const kick = Math.sin(Math.min(1, a.push) * Math.PI) * 0.03;
      const len = 0.19 * (1 + a.hover * 0.1);
      const x = a.dir * (halfW - len * 0.62 - 0.03 + nudge + kick + (1 - this.uiK) * 0.35);
      a.grp.position.set(x, -halfH * 0.06 + Math.sin(t * 1.3 + a.dir) * 0.005, -d);
      a.grp.rotation.set(0.12 + Math.sin(t * 0.8 + a.dir) * 0.04, -a.dir * 0.34 + Math.sin(t * 0.6) * 0.03, Math.sin(t * 0.9 + a.dir * 2) * 0.03 - a.push * a.dir * 0.12);
      a.grp.scale.setScalar(this.arrowScale * (1 + a.hover * 0.1 + kick * 2));
      a.grp.visible = this.uiK > 0.02;
      a.mat.color.setScalar(1.12 + a.hover * 0.4 + a.push * 0.3);
      // the neighbour's name under the sign
      const nb = this.stations[(((this.idx + a.dir) % n) + n) % n];
      const txt = a.dir < 0 ? '◀ ' + nb.short : nb.short + ' ▶';
      if (a.label.textContent !== txt) a.label.textContent = txt;
      const p = this.ui.localToWorld(this.v3.set(x - a.dir * 0.01, -halfH * 0.06 - 0.075, -d)).project(cam);
      a.label.style.left = `${((p.x + 1) / 2) * this.engine.width}px`;
      a.label.style.top = `${((1 - p.y) / 2) * this.engine.height}px`;
      a.label.style.opacity = String(this.uiK * (0.75 + a.hover * 0.25));
      a.label.style.pointerEvents = this.uiK > 0.5 ? 'auto' : 'none';
    }
  }

  /** the station's name flips up in gilded letters in the shot's empty third, the subtitle types itself under it */
  private updateTitle(rdt: number) {
    const want = !this.panel && !this.intro && !this.extras?.busy && this.arrived ? this.here : null;
    const tt = this.ttl;
    if (tt) {
      if (tt.st !== want && tt.out < 0) tt.out = 0;
      tt.t += rdt;
      if (tt.out >= 0) tt.out += rdt;
      let gone = tt.out >= 0;
      tt.set.letters.forEach((m, i) => {
        if (tt.out >= 0) {
          const k = clamp01((tt.out - i * 0.018) / 0.28);
          m.rotation.set(ease(k) * 1.5, 0, 0);
          m.scale.setScalar(Math.max(0.001, 1 - ease(k)));
          if (k < 1) gone = false;
        } else {
          const k = clamp01((tt.t - 0.12 - i * 0.05) / 0.55);
          m.rotation.set(-(1 - backOut(k)) * 1.45, Math.sin(this.t * 1.1 + i * 0.6) * 0.06 * k, 0);
          m.position.y = -(1 - Math.min(1, k * 1.4)) * 0.03;
          m.scale.setScalar(Math.max(0.001, Math.min(1, k * 2.5)));
        }
      });
      if (gone) {
        tt.set.root.removeFromParent();
        this.ttl = null;
      }
    }
    if (!this.ttl && want) {
      const set = this.titles.get(want.id);
      if (set) {
        const shot = this.shotOf(want);
        const fwd = shot.look.clone().sub(shot.pos).normalize();
        const right = fwd.clone().cross(UP).normalize();
        const up = right.clone().cross(fwd).normalize();
        const D = 1.3;
        const halfH = D * Math.tan(THREE.MathUtils.degToRad(shot.fov) / 2), halfW = halfH * this.camera.aspect;
        const [sx, sy, side] = want.slot;
        const sc = Math.min(1, (halfW * 0.8) / Math.max(0.01, set.width));
        const anchor = shot.pos.clone().addScaledVector(fwd, D).addScaledVector(right, sx * halfW).addScaledVector(up, sy * halfH);
        // +X along the screen's right, +Y up, +Z back at the lens; turned in a few degrees so the carving shows
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate()));
        q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, side === 'left' ? 0.16 : -0.16));
        set.root.quaternion.copy(q);
        set.root.scale.setScalar(sc);
        set.root.position.copy(anchor).addScaledVector(up, -set.capH * sc * 1.05).addScaledVector(right, side === 'left' ? 0 : -set.width * sc);
        for (const m of set.letters) {
          m.rotation.set(-1.45, 0, 0);
          m.scale.setScalar(0.001);
        }
        this.scene.add(set.root);
        this.ttl = { st: want, t: 0, out: -1, anchor, q, up, right, set };
        const sub = this.subs.get(want.id);
        if (sub) {
          sub.setText(want.sub);
          sub.show(true);
        }
        this.sub = sub ?? null;
      }
    }
    // the subtitle types itself out under the letters (FloatText3D billboards; it is pinned here, without its bob)
    const live = this.ttl && this.ttl.out < 0 ? this.ttl : null;
    for (const [id, sub] of this.subs) {
      if (!live || live.st.id !== id) sub.show(false);
      sub.update(rdt, this.camera);
      if (live && live.st.id === id) {
        const w = sub.mesh.scale.x;
        const sc = live.set.root.scale.x;
        const p = live.set.root.position.clone().addScaledVector(live.up, -0.034);
        if (live.st.slot[2] === 'left') p.addScaledVector(live.right, w / 2 + 0.004);
        else p.addScaledVector(live.right, live.set.width * sc - w / 2);
        sub.mesh.position.copy(p);
      }
    }
  }


  private animateLife(t: number, rdt: number) {
    const eng = this.engine;
    // fire: two flickers out of phase, sparks up the flue, flames licking, a lazy curl of smoke
    if (this.fireLight) {
      const f = 1 + Math.sin(t * 11.3) * 0.09 + Math.sin(t * 5.1 + 1) * 0.07 + Math.sin(t * 23.7) * 0.04;
      this.fireLight.intensity = (this.touch ? 7 : 8.5) * f;
      const fp = this.firePos;
      if (Math.random() < rdt * 12) this.particles.emit({ pos: { x: fp.x + (Math.random() - 0.5) * 0.5, y: fp.y - 0.02, z: fp.z + 0.05 }, count: 1, spread: 0.08, up: 0.5, life: [0.35, 0.6], size: [0.2, 0.08], sprite: ['flame0', 'flame1', 'flame2', 'flame3'], color: 0xffb050, additive: true, animate: true });
      if (Math.random() < rdt * 5) this.particles.emit({ pos: { x: fp.x + (Math.random() - 0.5) * 0.4, y: fp.y + 0.1, z: fp.z }, count: 1, spread: 0.15, up: 1.2, life: [0.8, 1.6], size: [0.025, 0.01], sprite: 'spark', color: 0xffa040, additive: true, drag: 0.8 });
    }
    for (const fl of this.flick) fl.l.intensity = fl.base * (1 + Math.sin(t * (7 + fl.base) + fl.base * 3) * fl.k + Math.sin(t * 17.3 + fl.base) * fl.k * 0.5);
    for (const b of this.beams) (b.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    // dust motes adrift in the sun shafts
    if (this.beams.length && Math.random() < rdt * (this.touch ? 14 : 28)) {
      const tot = this.beams.reduce((a, b) => a + b.w, 0);
      let r = Math.random() * tot;
      let b = this.beams[0];
      for (const bb of this.beams) if ((r -= bb.w) <= 0) {
        b = bb;
        break;
      }
      const q = new THREE.Vector3(0.1 + Math.random() * 0.8, 0.1 + Math.random() * 0.8, 0.08 + Math.random() * 0.7);
      const p = b.O.clone().addScaledVector(b.U, q.x).addScaledVector(b.V, q.y).addScaledVector(b.L, q.z);
      if (p.y > 0.05) this.particles.emit({ pos: p, count: 1, spread: 0.03, up: 0.02, life: [4, 8], size: [0.016, 0.016], sprite: 'dot3', color: 0xfff0d0, drag: 0.3, jitter: 0.04, fadeIn: 1 });
    }
    // steam from the kettle and the mug
    if (this.crane && Math.random() < rdt * 2.5) {
      this.crane.nodes['kettle']?.updateWorldMatrix(true, false);
      const sp = new THREE.Vector3(0.59, 0.16, 0).applyMatrix4(this.crane.nodes['kettle']?.matrixWorld ?? this.crane.root.matrixWorld);
      this.spout.copy(sp);
      this.particles.emit({ pos: sp, count: 1, spread: 0.04, up: 0.35, life: [1.2, 2.2], size: [0.05, 0.22], sprite: ['cloud0', 'cloud1'], color: 0xe8e0d8, alpha: 0.18, drag: 0.6, rot: 3, rotSpeed: 0.4 });
    }
    if (this.mug.lengthSq() > 0 && Math.random() < rdt * 1.6) this.particles.emit({ pos: this.mug, count: 1, spread: 0.02, up: 0.18, life: [1.2, 2.0], size: [0.03, 0.12], sprite: ['cloud0', 'cloud1'], color: 0xf0e8e0, alpha: 0.14, drag: 0.7, rot: 3, rotSpeed: 0.3 });
    // the breeze through the barn doors: the leaves breathe and creak, a gust now and then
    this.gust = damp(this.gust, Math.max(0, Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1)) * 1.4, 1.5, rdt);
    this.barn.forEach((b, i) => {
      const sgn = i === 0 ? -1 : 1;
      b.root.rotation.y = -Math.PI / 2 + sgn * (1.72 - 0.035 * this.gust - Math.sin(t * 0.9 + i * 1.7) * 0.012 * (0.4 + this.gust));
    });
    this.creakCd -= rdt;
    if (this.creakCd <= 0 && this.gust > 0.8) {
      eng.audio.play('door_creak', { volume: 0.18, pitch: 0.8 + Math.random() * 0.15 });
      this.creakCd = 9 + Math.random() * 8;
    }
    if (this.entry) this.entry.root.rotation.y = -Math.PI / 2 - 0.42 - Math.sin(t * 0.7) * 0.008 * (0.5 + this.gust);
    // lanterns and the chandelier sway, their lights follow the flames
    for (const L of this.lanterns) {
      const sw = Math.sin(t * 1.1 + L.phase) * (0.025 + this.gust * 0.02);
      const ch = L.rig.nodes['chain'];
      if (ch) ch.rotation.set(sw, 0, Math.cos(t * 0.8 + L.phase) * 0.02);
      const lp = L.rig.nodes['lamp'];
      if (lp) lp.rotation.set(-sw * 0.6, Math.sin(t * 0.3 + L.phase) * 0.2, 0);
      if (L.light && lp) {
        lp.updateWorldMatrix(true, false);
        L.light.position.copy(L.offset).applyMatrix4(lp.matrixWorld);
        L.light.intensity = 3.2 * (1 + Math.sin(t * 9 + L.phase) * 0.05 + Math.sin(t * 23 + L.phase) * 0.03);
      }
    }
    if (this.chandelier) {
      const c = this.chandelier.nodes['chains'];
      if (c) c.rotation.set(Math.sin(t * 0.6) * 0.012, Math.sin(t * 0.1) * 0.1, Math.cos(t * 0.5) * 0.012);
      const w = this.chandelier.nodes['wheel'];
      if (w) {
        w.updateWorldMatrix(true, false);
        for (const cd of this.candles) {
          cd.light.position.copy(cd.offset).applyMatrix4(w.matrixWorld);
          cd.light.intensity = 1.3 * (1 + Math.sin(t * 13 + cd.offset.x * 40) * 0.08);
        }
      }
    }
    // the clock keeps time (real local time), its pendulum ticks
    if (this.clock) {
      const now = new Date();
      const hm = now.getHours() % 12 + now.getMinutes() / 60, mm = now.getMinutes() + now.getSeconds() / 60;
      const n = this.clock.nodes;
      if (n['hand_h']) n['hand_h'].rotation.z = -(hm / 12) * Math.PI * 2;
      if (n['hand_m']) n['hand_m'].rotation.z = -(mm / 60) * Math.PI * 2;
      if (n['pendulum']) n['pendulum'].rotation.z = Math.sin(t * Math.PI) * 0.16;
    }
    if (this.crane) {
      const a = this.crane.nodes['arm'], k = this.crane.nodes['kettle'];
      if (a) a.rotation.y = Math.sin(t * 0.17) * 0.04;
      if (k) k.rotation.set(Math.sin(t * 0.9) * 0.03, 0, Math.sin(t * 0.7 + 1) * 0.025);
    }
    // the gun on its cradle: the cylinder turns while you work on it
    if (this.gun?.nodes['cylinder'] && this.active?.id === 'bench') this.gun.nodes['cylinder'].rotation.z += rdt * 1.2;
    // the duck squeaks
    if (this.duck) {
      this.duckSquash = Math.max(0, this.duckSquash - rdt * 3);
      const k = Math.sin(this.duckSquash * 12) * this.duckSquash;
      this.duck.scale.set(0.85 * (1 + k * 0.25), 0.85 * (1 - k * 0.3), 0.85 * (1 + k * 0.25));
    }
    // Pinch dozes on the shoulder (breathing, the odd twitch)
    if (this.pinch) {
      const pn = this.pinch.root;
      pn.scale.setScalar(0.8 * (1 + Math.sin(t * 2.1) * 0.012));
    }
    this.animateToads(t, rdt);
  }


  /**
   * Mama Toad rocks in her chair, breathes, pumps her throat, knits, blinks with
   * her lower lids, looks up over her spectacles when he comes to the hearth, and
   * talks. The toadlets breathe, blink, watch him and now and then hop.
   */
  private animateToads(t: number, rdt: number) {
    if (this.chair?.nodes['chair']) this.chair.nodes['chair'].rotation.x = Math.sin(t * 1.05) * 0.05;
    const m = this.mama;
    const atHearth = this.here.id === 'hearth' && this.atK > 0.5;
    this.mamaCd -= rdt;
    const heroHead = this.v4.set(this.pos.x, 1.55, this.pos.y);
    if (this.wake && this.hero?.nodes['head']) this.hero.nodes['head'].getWorldPosition(heroHead).add(this.v5.set(0, 0.12, 0));
    if (m) {
      const n = m.nodes;
      const talk = this.mamaTalk > 0 ? 1 : 0;
      this.mamaTalk = Math.max(0, this.mamaTalk - rdt);
      // breathing: the flanks swell; the throat pumps quick and shallow, deeper as she speaks, a slow gulp now and then
      const br = Math.sin(t * 1.4);
      if (n['body']) n['body'].scale.set(1 + br * 0.012, 1 + br * 0.005, 1 + br * 0.008);
      if (n['belly']) n['belly'].scale.setScalar(1 + br * 0.02);
      const pump = Math.max(0, Math.sin(t * 7.5)) * 0.05 + (talk ? Math.abs(Math.sin(t * 6)) * 0.1 : 0) + Math.max(0, Math.sin(t * 0.5) - 0.92) * 2;
      if (n['throat']) n['throat'].scale.set(1 + pump * 0.6, 1 + pump, 1 + pump * 0.7);
      // the needles work in a little rhythm; she pauses when she talks or looks up at him
      this.mamaLook = damp(this.mamaLook, atHearth || (this.wake && this.wake.t > 2.2) ? 1 : 0, this.wake ? 4 : 2, rdt);
      this.knitK = damp(this.knitK, talk ? 0.15 : atHearth ? 0.55 : 1, 3, rdt);
      const kn = t * 5.2, kk = this.knitK;
      if (n['fore_r']) n['fore_r'].rotation.set(Math.sin(kn) * 0.09 * kk, Math.cos(kn) * 0.07 * kk, Math.sin(kn) * 0.04 * kk);
      if (n['fore_l']) n['fore_l'].rotation.set(-Math.sin(kn + 0.6) * 0.04 * kk, -Math.cos(kn) * 0.03 * kk, 0);
      if (n['knit']) n['knit'].rotation.set(Math.sin(t * 0.9) * 0.03 + Math.sin(kn) * 0.015 * kk, 0, 0);
      // her head lifts to look at him over her spectacles, nods along as she talks
      const ml = this.mamaLook;
      if (n['head']) n['head'].rotation.set(-0.07 * ml + (talk ? Math.sin(t * 4.2) * 0.03 : 0) + Math.sin(t * 0.3) * 0.01, Math.sin(t * 0.21) * 0.03 + ml * 0.05, ml * 0.04 + Math.sin(t * 0.4) * 0.012);
      if (n['jaw']) n['jaw'].rotation.x = talk ? Math.max(0, Math.sin(t * 11)) * 0.075 + 0.015 : damp(n['jaw'].rotation.x, 0, 8, rdt);
      this.mamaBlink -= rdt;
      if (this.mamaBlink < -0.24) this.mamaBlink = 2.5 + Math.random() * 3.5;
      const bl = this.mamaBlink < 0 ? Math.sin((-this.mamaBlink / 0.24) * Math.PI) : 0;
      let look: THREE.Vector3 | null = null;
      if (ml > 0.3) look = heroHead;
      else if (n['knit']) look = n['knit'].getWorldPosition(this.v5);
      this.toadEyes(m, this.mamaSpec?.meta ?? {}, bl, look);
      // the gasp: she jolts back, mouth open, eyes wide, the knitting forgotten in her lap
      this.gasp = Math.max(0, this.gasp - rdt * 0.32);
      const gp = this.gasp > 0 ? Math.sin(Math.min(1, (1 - this.gasp) * 6) * Math.PI * 0.5) * Math.min(1, this.gasp * 2.2) : 0;
      if (this.wake && n['head'] && this.hero?.nodes['head']) {
        const hp = this.hero.nodes['head'].getWorldPosition(this.v5);
        const loc = n['head'].parent!.worldToLocal(hp);
        const yaw = THREE.MathUtils.clamp(Math.atan2(loc.x - n['head'].position.x, loc.z - n['head'].position.z), -1.0, 1.0);
        this.mamaTurn = damp(this.mamaTurn, this.wake.t > 2.3 ? yaw : 0, 5, rdt);
        n['head'].rotation.y += this.mamaTurn;
      } else if (this.mamaTurn) {
        this.mamaTurn = Math.abs(this.mamaTurn) < 1e-3 ? 0 : damp(this.mamaTurn, 0, 3, rdt);
        n['head']?.rotation.set(n['head'].rotation.x, n['head'].rotation.y + this.mamaTurn, n['head'].rotation.z);
      }
      if (n['body']) n['body'].rotation.y = this.mamaTurn * 0.3;
      if (gp > 0.001) {
        if (n['head']) n['head'].rotation.x -= 0.28 * gp;
        if (n['jaw']) n['jaw'].rotation.x += 0.3 * gp;
        if (n['fore_r']) n['fore_r'].rotation.x -= 0.85 * gp;
        if (n['fore_l']) n['fore_l'].rotation.x -= 0.7 * gp;
        if (n['body']) n['body'].scale.y *= 1 + 0.04 * gp;
        for (const e of ['eye_l', 'eye_r']) n[e]?.scale.multiplyScalar(1 + 0.2 * gp);
        if (this.chair?.nodes['chair']) this.chair.nodes['chair'].rotation.x -= 0.06 * gp;
      }
      if (n['head']) {
        n['head'].getWorldPosition(this.mamaHead);
        this.mamaHead.y += 0.3;
      }
    }
    // she pipes up now and then while he's with her
    if (atHearth && this.mamaCd <= 0 && !this.panel) {
      this.mamaLine = (this.mamaLine + 1 + Math.floor(Math.random() * 2)) % MAMA_LINES.length;
      this.say(MAMA_LINES[this.mamaLine]);
      this.mamaCd = 15 + Math.random() * 6;
    }
    // the speech bubble types itself out over her head
    if (this.bubbleText && (this.mamaTalk > 0 || this.bubbleT < 2)) {
      this.bubbleT += rdt;
      const nn = Math.min(this.bubbleText.length, Math.floor(this.bubbleT * 38));
      const p = this.mamaHead.clone().project(this.camera);
      if (p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1) {
        this.bubble.style.display = 'block';
        this.bubble.style.left = `${((p.x + 1) / 2) * this.engine.width}px`;
        this.bubble.style.top = `${((1 - p.y) / 2) * this.engine.height}px`;
        this.bubble.textContent = this.bubbleText.slice(0, nn);
      } else this.bubble.style.display = 'none';
      if (this.mamaTalk <= 0 && this.bubbleT > 2) this.bubbleText = '';
    } else this.bubble.style.display = 'none';
    // the toadlets
    for (const b of this.toadlets) {
      const r = b.rig, n = r.nodes;
      const br = Math.sin(t * 2.2 + b.phase);
      if (n['body']) n['body'].scale.set(1 + br * 0.015, 1, 1 + br * 0.01);
      const pump = Math.max(0, Math.sin(t * 9 + b.phase)) * 0.08;
      if (n['throat']) n['throat'].scale.set(1 + pump * 0.6, 1 + pump, 1 + pump * 0.7);
      b.blink -= rdt;
      if (b.blink < -0.2) b.blink = 1.8 + Math.random() * 4;
      const bl = b.blink < 0 ? Math.sin((-b.blink / 0.2) * Math.PI) : 0;
      r.root.getWorldPosition(this.v5);
      this.toadEyes(r, b.spec.meta ?? {}, bl, this.v5.distanceTo(heroHead) < 2.6 ? heroHead : null);
      if (!b.floor) continue;
      // now and then: turn, then a little hop to a new spot near home (never under his boots)
      if (b.hopT < 0) {
        b.hop -= rdt;
        if (b.hop <= 0) {
          const a = Math.random() * Math.PI * 2, rr = Math.random() * 0.16;
          b.from.copy(r.root.position);
          b.to.set(b.home.x + Math.cos(a) * rr, b.home.y, b.home.z + Math.sin(a) * rr);
          if (Math.hypot(b.to.x - this.pos.x, b.to.z - this.pos.y) < 0.45) b.to.copy(b.home);
          b.turn = b.from.distanceTo(b.to) > 0.02 ? Math.atan2(b.to.x - b.from.x, b.to.z - b.from.z) : b.yaw + (Math.random() - 0.5) * 1.6;
          b.hopT = 0;
        }
      } else {
        b.hopT += rdt;
        let dyaw = b.turn - b.yaw;
        dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        r.root.rotation.y = b.yaw + dyaw * ease(clamp01(b.hopT / 0.4));
        const k = clamp01((b.hopT - 0.4) / 0.3);
        r.root.position.lerpVectors(b.from, b.to, ease(k));
        r.root.position.y = b.from.y + Math.sin(k * Math.PI) * 0.045;
        r.root.rotation.x = -Math.sin(k * Math.PI) * 0.3;
        if (n['body']) n['body'].scale.z *= 1 + Math.sin(k * Math.PI) * 0.12;
        if (b.hopT > 0.8) {
          b.hopT = -1;
          b.yaw = b.yaw + dyaw;
          r.root.rotation.x = 0;
          b.hop = 6 + Math.random() * 10;
        }
      }
    }
  }

  /** golden eyes roll a little toward what they watch; the lower lids sweep up to blink and the globes sink */
  private toadEyes(r: RigInstance, meta: Record<string, any>, bl: number, look: THREE.Vector3 | null) {
    const n = r.nodes;
    const B = meta.blink as { l: number[]; r: number[]; close: number } | undefined;
    const gz = (meta.eyes?.gaze as number[] | undefined) ?? [0.74, 0.3, 0.6];
    for (const side of ['l', 'r'] as const) {
      const lid = n['lid_' + side], eye = n['eye_' + side];
      if (B && lid) lid.quaternion.setFromAxisAngle(this.v3.fromArray(B[side]), bl * B.close);
      if (!eye) continue;
      let yaw = 0, pitch = 0;
      if (look && eye.parent) {
        const d = eye.parent.worldToLocal(this.v3.copy(look)).sub(eye.position);
        const gx = side === 'l' ? gz[0] : -gz[0];
        let dy = Math.atan2(d.x, d.z) - Math.atan2(gx, gz[2]);
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        yaw = THREE.MathUtils.clamp(dy, -0.28, 0.28);
        pitch = THREE.MathUtils.clamp(-(Math.atan2(d.y, Math.hypot(d.x, d.z)) - Math.asin(THREE.MathUtils.clamp(gz[1], -1, 1))), -0.22, 0.22);
      }
      eye.rotation.x = damp(eye.rotation.x, pitch, 6, 1 / 60);
      eye.rotation.y = damp(eye.rotation.y, yaw, 6, 1 / 60);
      eye.scale.setScalar(1 - bl * 0.07);
    }
  }

  /** the shot, its look solved on thirds for the live aspect */
  private shotOf(st: Station) {
    const s = st.shot;
    if (s.subject && s.ndc) thirdsLook(s.pos, s.subject, s.ndc[0], s.ndc[1], s.fov, this.camera.aspect || 16 / 9, s.look);
    return s;
  }

  private updateCamera(t: number, rdt: number) {
    const inp = this.engine.input;
    const P = this.baseP, L = this.baseL;
    let fov = this.camera.fov;
    this.slideK = damp(this.slideK, this.panel && this.active ? 1 : 0, 2.6, rdt);
    if (this.debugCam) {
      P.fromArray(this.debugCam.pos);
      L.fromArray(this.debugCam.look);
      fov = this.debugCam.fov ?? 50;
    } else if (this.extras?.cam && !this.wakeCam) {
      const c = this.extras.cam;
      P.copy(c.pos);
      L.copy(c.look);
      fov = c.fov;
    } else if (this.wakeCam) {
      P.copy(this.wakeCam.pos);
      L.copy(this.wakeCam.look);
      fov = this.wakeCam.fov;
    } else {
      const shot = this.shotOf(this.here);
      if (this.mv) {
        // the swing: a quadratic arc from where the camera was, eased in and out; the look leads a touch and leans
        // toward Sundown mid-move so he stays in the frame as he walks over; a breath of zoom on the way
        const m = this.mv;
        m.t += rdt;
        const u = clamp01(m.t / m.dur);
        const e = ease(u);
        const a = (1 - e) * (1 - e), b = 2 * e * (1 - e), c = e * e;
        P.set(m.p0.x * a + m.c.x * b + shot.pos.x * c, m.p0.y * a + m.c.y * b + shot.pos.y * c, m.p0.z * a + m.c.z * b + shot.pos.z * c);
        L.lerpVectors(m.l0, shot.look, ease(Math.min(1, u * 1.12)));
        L.lerp(this.v1.set(this.pos.x, 1.25, this.pos.y), Math.sin(Math.PI * u) * (m.intro ? 0.7 : 0.38));
        fov = m.f0 + (shot.fov - m.f0) * e + Math.sin(Math.PI * u) * (m.intro ? 0 : 3);
        if (u >= 1) {
          this.mv = null;
          if (m.intro) this.intro = false;
        }
      } else {
        P.copy(shot.pos);
        L.copy(shot.look);
        fov = shot.fov;
      }
      // with a panel open, the frame slides so the subject sits in the free half
      if (this.slideK > 0.001) {
        const fwd = this.v1.subVectors(L, P);
        const dist = fwd.length();
        const right = fwd.normalize().cross(UP).normalize();
        const halfW = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * this.camera.aspect * dist;
        L.addScaledVector(right, (this.panelSide === 'right' ? 1 : -1) * halfW * 0.4 * this.slideK);
      }
    }
    // the mouse only leans the frame a little (parallax), with a slow breathing drift
    const still = !!this.panel || !!this.extras?.busy;
    this.par.x = damp(this.par.x, still ? 0 : inp.ndcX, 2.5, rdt);
    this.par.y = damp(this.par.y, still ? 0 : inp.ndcY, 2.5, rdt);
    const fwd = this.v1.subVectors(L, P).normalize();
    const right = this.v2.crossVectors(fwd, UP).normalize();
    this.camPos.copy(P).addScaledVector(right, this.par.x * 0.07 + Math.sin(t * 0.11) * 0.02).addScaledVector(UP, this.par.y * 0.04 + Math.sin(t * 0.15) * 0.012);
    this.camLook.copy(L).addScaledVector(right, this.par.x * 0.025);
    const sway = new THREE.Vector3(Math.sin(t * 1.3) * 0.004 + Math.sin(t * 2.9) * 0.002, Math.sin(t * 1.7) * 0.003 + Math.sin(t * 3.7) * 0.0012, 0);
    this.camera.position.copy(this.camPos).add(sway);
    this.camera.lookAt(this.camLook.clone().add(sway.multiplyScalar(1.5)));
    this.camera.rotateZ(Math.sin(t * 0.6) * 0.004);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    // the live mirror only renders while the camera is close enough to see it
    if (this.mirror) this.mirror.visible = this.camera.position.distanceTo(this.mirror.position) < 6.5;
  }
  // ======================================================================= the Codex
  /** the Book of Skills opens the Codex: the old leather field book, on its own lamplit desk */
  private openBook() {
    if (this.book) return;
    this.tip.style.display = 'none';
    this.prompt.style.opacity = '0';
    document.body.style.cursor = 'default';
    // the hideout's own screen furniture steps aside while the book is open
    const els = [this.bank, this.hint, this.title, this.prompt, this.bubble, this.tip, ...this.arrows.map((a) => a.label)];
    const was = els.map((e) => e.style.visibility);
    for (const e of els) e.style.visibility = 'hidden';
    const book = new CodexBook(this.engine, {
      hero: this.heroSpec,
      back: { scene: this.scene, camera: this.camera },
      onClosed: () => {
        if (this.book === book) this.book = null;
        els.forEach((e, i) => (e.style.visibility = was[i]));
        this.updateBank();
        book.dispose();
        this.active = null;
        this.engine.input.setWantLock(false);
      },
    });
    this.book = book;
    void book.open();
  }

  // ======================================================================= the WANTED poster
  /** shot to the wall on the widest bare stretch beside the back window */
  private nailPoster(res: PosterData, complete: boolean) {
    this.poster?.dispose();
    let P: WantedPoster;
    try {
      P = new WantedPoster(this.engine, res);
    } catch (e) {
      console.warn('[hub] poster', e);
      return;
    }
    const win = HX.CABIN_OPEN.backWin;
    const rk = this.extras?.bench.rack;
    const gx = rk?.grp ? rk.box.max.x + 0.04 : -0.2;
    const fx = this.fireBox ? this.fireBox.min.x - 0.04 : 2.65;
    const L = { c: (gx + win.x0) / 2, w: win.x0 - 0.04 - gx }, R = { c: (win.x1 + fx) / 2, w: fx - win.x1 - 0.04 };
    const spot = L.w >= R.w ? L : R;
    const ar = WantedPoster.W / WantedPoster.H;
    const h = THREE.MathUtils.clamp(spot.w / ar, 0.32, 0.64);
    P.mesh.scale.setScalar(h / WantedPoster.H);
    const y = (win.y0 + win.y1) / 2 + 0.04;
    P.mesh.position.set(spot.c, y, IN.back + 0.03);
    P.mesh.rotation.z = spot === L ? 0.035 : -0.03;
    this.scene.add(P.mesh);
    if (complete) P.complete();
    this.poster = P;
    const d = h / (2 * Math.tan(THREE.MathUtils.degToRad(20))) / 0.78;
    this.posterShot = { pos: new THREE.Vector3(spot.c + 0.1, y - 0.02, IN.back + d), look: new THREE.Vector3(spot.c, y - 0.01, IN.back) };
  }

  // ======================================================================= the wake-up
  private startWake(days: number, res: PosterData) {
    const fb = new THREE.Box3().setFromObject(this.futon!);
    const fc = fb.getCenter(new THREE.Vector3());
    const sy = fb.min.y + 0.405 * this.futon!.scale.y;
    const hy = (this.heroSpec?.meta?.hipY as number) ?? 0.67;
    const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
    const keys: WakeKey[] = [
      { p: new THREE.Vector3(fc.x - 0.84, sy + 0.13, fc.z + 0.05), q: q(-Math.PI / 2, -Math.PI / 2, 0), j: W_SLEEP },
      { p: new THREE.Vector3(fc.x - 0.17, sy + 0.07 - hy, fc.z + 0.05), q: q(0, -Math.PI / 2, 0), j: W_SIT },
      { p: new THREE.Vector3(fc.x - 0.12, sy + 0.07 - hy, fc.z + 0.2), q: q(0, 0, 0), j: W_EDGE },
      { p: new THREE.Vector3(fc.x - 0.12, 0, fc.z + 0.8), q: q(0, 0, 0), j: W_STAND },
    ];
    this.wake = { t: 0, days, res, fc, sy, keys, posterAt: -1, posterDone: -1, said: new Set() };
    this.intro = true;
    this.idx = Math.max(0, this.stations.findIndex((st) => st.id === 'hearth'));
    // the board stays in the garage while he sleeps; he dozes off with his eyes shut
    for (const k of ['board_back', 'back']) this.hero?.sockets[k]?.children.forEach((c) => (c.visible = false));
    this.hero?.setExpression('laugh');
    this.nailPoster(res, false);
    this.title.style.display = 'none';
    for (const e of [this.hint, this.prompt, this.bank]) e.style.visibility = 'hidden';
    this.wakeCam = { pos: new THREE.Vector3(fc.x + 0.05, 1.74, fc.z + 2.1), look: new THREE.Vector3(fc.x + 0.25, sy + 0.2, fc.z + 0.05), fov: 44 };
    this.updateWake(0);
  }

  /** the wake-up, second by second (real time) */
  private updateWake(rdt: number) {
    const w = this.wake!;
    const eng = this.engine;
    const inp = eng.input;
    w.t += rdt;
    const t = w.t;
    if (t > 0.8 && (inp.wasPressed('Space') || inp.wasPressed('Escape') || inp.wasPressed('Enter') || inp.wasPressed('Mouse0') || inp.wasPressed('KeyE'))) {
      this.endWake();
      return;
    }
    const once = (id: string, at: number, fn: () => void) => {
      if (t >= at && !w.said.has(id)) {
        w.said.add(id);
        fn();
      }
    };
    once('twitch', 1.6, () => eng.audio.play('skeleton_rattle', { volume: 0.25, pitch: 1.3 }));
    once('gasp', 2.5, () => {
      this.gasp = 1;
      this.say('Lord have mercy!');
      this.mamaCd = 30;
      eng.audio.play('squeak', { volume: 0.7, pitch: 1.25 });
      eng.audio.play('squeak', { volume: 0.5, pitch: 1.6 });
    });
    once('up', 3.05, () => {
      this.hero?.setExpression('surprised');
      eng.audio.play('skeleton_rattle', { volume: 0.8 });
    });
    once('groggy', 4.2, () => this.hero?.setExpression('hurt'));
    once('days', 6.3, () => this.say(`${w.days} days you were gone, sugar. The sand brought you home again... like always.`));
    once('poster', 9.6, () => this.say('Somebody shot that to the wall while you slept.'));
    once('fill', 10.6, () => {
      w.posterAt = t;
      void (this.poster?.fill(() => !this.wake) ?? Promise.resolve()).then(() => {
        if (this.wake === w) w.posterDone = w.t;
      });
    });
    if (w.posterDone >= 0) {
      once('bank', w.posterDone + 0.3, () => this.showBank(w.res.banked ?? 0));
      if (t > w.posterDone + 2.4) {
        this.endWake();
        return;
      }
    }
    // ---- his pose: sleep → bolt upright → legs over the edge
    const k = t < 3.05 ? 0 : t < 3.6 ? Math.min(1, backOut((t - 3.05) / 0.55)) : t < 5.7 ? 1 : t < 6.7 ? 1 + ease((t - 5.7) / 1.0) : 2;
    this.poseWake(k, t);
    // ---- the camera: over the coffee table onto the couch, round to the side as he sits up, then the poster
    const fc = w.fc, sy = w.sy;
    let pos: THREE.Vector3, look: THREE.Vector3, fov: number;
    if (t < 2.7) {
      const u = t / 2.7;
      pos = this.v1.set(fc.x + 0.05, 1.74 - u * 0.1, fc.z + 2.1 - u * 0.22);
      look = this.v2.set(fc.x + 0.25, sy + 0.2, fc.z + 0.05);
      fov = 44;
    } else if (t < 9.2 || !this.posterShot) {
      const u = Math.min(1, (t - 2.7) / 6.5);
      pos = this.v1.set(fc.x - 1.62 + u * 0.12, 1.5 - u * 0.04, fc.z + 2.5 - u * 0.15);
      look = this.v2.set(fc.x + 0.48, sy + 0.36, fc.z + 0.62);
      fov = 47;
    } else {
      pos = this.v1.copy(this.posterShot.pos);
      look = this.v2.copy(this.posterShot.look);
      fov = 40;
    }
    const c = this.wakeCam!;
    const kk = rdt === 0 ? 1 : 1 - Math.exp(-rdt * 2.1);
    c.pos.lerp(pos, kk);
    c.look.lerp(look, kk);
    c.fov += (fov - c.fov) * kk;
  }

  /** k: 0 asleep, 1 sitting up, 2 on the edge, 3 standing (blends the wake keys), plus life on top */
  private poseWake(k: number, t: number) {
    const w = this.wake!;
    const h = this.hero;
    if (!h) return;
    const i = Math.min(w.keys.length - 2, Math.floor(k));
    const f = k - i;
    const A = w.keys[i], B = w.keys[i + 1];
    const H = this.heroHolder;
    H.position.lerpVectors(A.p, B.p, f);
    H.quaternion.slerpQuaternions(A.q, B.q, f);
    h.root.position.set(0, 0, 0);
    // the rub: a hand up to his skull while he looks around, wondering how he got here
    const rub = sstep(4.0, 4.4, t) * (1 - sstep(5.3, 5.8, t));
    const look = sstep(3.5, 3.9, t) * (1 - sstep(8.8, 9.4, t));
    for (const p of h.geo.parts) {
      const n = h.nodes[p.name];
      const a = A.j[p.name] ?? [0, 0, 0], b = B.j[p.name] ?? [0, 0, 0];
      let x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, z = a[2] + (b[2] - a[2]) * f;
      const s = W_SKULL[p.name];
      if (s && rub > 0) {
        x += (s[0] - x) * rub;
        y += (s[1] - y) * rub;
        z += (s[2] - z) * rub;
      }
      n.rotation.set(p.rest.x + x, p.rest.y + y, p.rest.z + z);
    }
    const N = h.nodes;
    // asleep: slow breaths, one twitch
    const sleep = 1 - Math.min(1, k * 3);
    if (N['torso']) N['torso'].rotation.x += Math.sin(t * 1.25) * 0.03 * sleep;
    if (N['fore_l']) N['fore_l'].rotation.x += Math.exp(-Math.pow((t - 1.65) * 7, 2)) * -0.5;
    if (N['head']) {
      N['head'].rotation.z += Math.exp(-Math.pow((t - 1.75) * 5, 2)) * 0.15 + rub * 0.2;
      N['head'].rotation.x += rub * 0.18;
      // looking round the room, then at the poster
      N['head'].rotation.y += look * (Math.sin((t - 3.6) * 1.9) * 0.55 + (t > 9.2 ? -0.5 : 0));
    }
    if (N['fore_r'] && rub > 0) N['fore_r'].rotation.x += Math.sin(t * 15) * 0.09 * rub;
    if (N['jaw']) N['jaw'].rotation.x += h.exprJaw * 0.5;
    // Mama's eyes follow his head; the toad code reads this.pos
    N['head']?.getWorldPosition(this.v3);
    this.pos.set(this.v3.x, this.v3.z);
  }

  private showBank(n: number) {
    this.updateBank();
    this.bank.style.visibility = '';
    if (!n) return;
    const el = document.createElement('div');
    el.style.cssText = "position:absolute;left:50%;top:13vh;transform:translate(-50%,8px);z-index:9;pointer-events:none;font-family:'Alagard';font-size:30px;color:#ffd36b;opacity:0;transition:opacity .5s,transform .8s cubic-bezier(.2,.7,.2,1);text-shadow:0 3px 0 #2a1408,0 0 16px rgba(255,180,80,.5);white-space:nowrap";
    el.textContent = `+${n} GOLD BANKED`;
    this.engine.overlay.appendChild(el);
    this.bankToast = el;
    this.engine.audio.play('gold_burst', { volume: 0.7 });
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translate(-50%,0)';
    });
    setTimeout(() => (el.style.opacity = '0'), 2600);
    setTimeout(() => el.remove(), 3400);
  }

  /** he's up: on his feet, the board back on his shoulders, off to warm himself by Mama's fire */
  private endWake() {
    const w = this.wake;
    if (!w) return;
    if (this.poster && this.poster.lines < 8) this.poster.complete();
    if (w.posterDone < 0) this.showBank(w.res.banked ?? 0);
    for (const k of ['board_back', 'back']) this.hero?.sockets[k]?.children.forEach((c) => (c.visible = true));
    this.hero?.setExpression('smug');
    const st = w.keys[3].p;
    this.pos.set(st.x, st.z);
    this.vel.set(0, 0);
    this.yaw = 0;
    this.heroHolder.rotation.set(0, 0, 0);
    this.heroHolder.position.set(st.x, 0, st.z);
    if (this.wakeCam) {
      this.baseP.copy(this.wakeCam.pos);
      this.baseL.copy(this.wakeCam.look);
      this.camera.fov = this.wakeCam.fov;
    }
    this.wake = null;
    this.wakeCam = null;
    this.intro = false;
    this.gasp = 0;
    this.title.style.display = '';
    for (const e of [this.hint, this.prompt, this.bank]) e.style.visibility = '';
    const hearth = this.stations.find((s) => s.id === 'hearth') ?? this.stations[0];
    this.go(hearth);
    // round behind Mama's chair (between it and the fire) rather than through the coffee table
    const fc = w.fc;
    this.route = [new THREE.Vector2(fc.x + 0.45, fc.z + 0.72), new THREE.Vector2(fc.x + 1.25, fc.z + 0.55), new THREE.Vector2(hearth.stand.x - 0.1, fc.z + 0.75), hearth.stand.clone()];
    this.speed = 1.35;
  }

  private mamaTurn = 0;
  private slideK = 0;
  private knitK = 1;
  private mamaLook = 0;
  private qd = new THREE.Quaternion();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private v5 = new THREE.Vector3();
}
