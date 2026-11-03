// The hideout: Sundown's pine workshop-house at the edge of the dead Last Chance
// outpost. Knotty honey-pine walls under a vaulted, lapped ceiling on log beams;
// big barn doors thrown open on the left to the sunset street, where a low sun
// pours dusty god rays across the garage and the floor; a stone fireplace
// crackling in the back corner; one ragged hole in the roof.
// Stations Sundown walks up to (E / T / Enter, or click them):
//   the weapon bench (vise, tools, the gun stripped on an oilcloth)  → gun bench
//   the wardrobe and the cheval mirror (a live reflection)           → hats & outfits
//   the garage: the board rack and the board on the sawhorses        → boards
//   the lectern with the Book of Skills                              → skills & codex
//   Mama Frog rocking by the fire (she has opinions)                 → a chat
//   the gramophone on the coffee table                               → music
//   the barn doors                                                   → ride out
// Lighting: a warm low key sun with crisp cel shadows, volumetric shafts through
// every opening (with window-mullion shadows), firelight, lamp pools, cool
// skylight at the shaded windows, and an interior light probe baked from the
// lit room itself so every surface gets the warm bounce of the sunlit floor.
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { Engine, GameScene } from '../../engine/Engine';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
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
import { legIK, LegPose } from '../anim/playerAnim';
import { damp, rnd } from '../../engine/math/rand';

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}
interface Station {
  id: string;
  label: string;
  /** where Sundown stands to use it (x, z) and the way he faces */
  stand: THREE.Vector2;
  face: number;
  /** prompt anchor */
  at: THREE.Vector3;
  /** reach around the stand point */
  r: number;
  objs: THREE.Object3D[];
  shot?: Shot;
  pose?: 'bench' | 'mirror' | 'book' | 'board' | 'chat' | 'idle';
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

const MAMA_LINES = [
  "Wipe your boots, sugar. I just swept that sand.",
  "You're all bones, dear. Sit. I'll find you a cookie.",
  "Pinch ate three of my cookies and blamed the duck.",
  "Ribbit— I mean: welcome home, handsome.",
  "That revolver of yours could use a good oiling.",
  "Mind the babies, they nap wherever they flop.",
  "When the sand's done screaming, the stars come out lovely.",
  "Wear the poncho. It brings out your cheekbones.",
  "Ride careful. Come back hungry.",
];

/** the tarot bar's abilities (the moves — rope, kick, neck slicer — have their own page, from player/Techniques) */
const SKILL_PAGES: [string, string, string][] = [
  ['E', 'I · The Magician', 'Scorpion toss — Serket\'s brood rides your bullets in.'],
  ['C', 'XVI · The Tower', 'Locust swarm — a storm that eats.'],
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
  private stations: Station[] = [];
  private near: Station | null = null;
  private hovered: Station | null = null;
  private active: Station | null = null;
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
  private walkTo: { x: number; z: number; face?: number; then?: () => void } | null = null;
  private introT = 0;
  private lastStep = [0, 0];
  private headYaw = 0;
  private headPitch = 0;
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
  private babies: { rig: RigInstance; phase: number; blink: number }[] = [];
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

  constructor(private engine: Engine, private onRide: () => void, private onMenu: () => void) {
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
      station({ id: 'gramophone', label: 'Gramophone — music on / off', stand: new THREE.Vector2(0.75, -0.72), face: Math.PI, at: new THREE.Vector3(0.86, top + 0.62, -1.52), r: 0.55, objs: [gr], pose: 'idle' });
      station({ id: 'duck', label: 'Rubber Duck', stand: new THREE.Vector2(1.75, -0.72), face: Math.PI, at: new THREE.Vector3(1.86, top + 0.25, -1.36), r: 0.45, objs: [this.duck], pose: 'idle' });
    }
    void fut;
    put(B(() => WS.plaidChair()), -0.32, -1.55, Math.PI / 2 - 0.25);
    // between the bench and the futon: a cabinet with the guitar hung above
    const cab = against(B(() => WS.sideCabinet()), 'back', -0.04, 0, 0.05);
    if (cab) {
      against(B(() => WS.guitar()), 'back', -0.02, 1.2, 0.02, 1, false);
      put(B(() => HX.bottlesCraft(2)), 0.0, IN.back + 0.25, 0.3, topOf(cab), 0.7, false);
    }
    // Mama Frog in her rocking chair by the fire, knitting basket at her feet, the babies about
    const chSpec = safe(() => WS.rockingChairRig());
    const CH_AT = new THREE.Vector3(2.62, 0, -1.42), CH_YAW = -0.5;
    this.chair = rig(chSpec, CH_AT.x, 0, CH_AT.z, CH_YAW);
    if (this.chair && chSpec) {
      this.walls.push({ x0: CH_AT.x - 0.62, z0: CH_AT.z - 0.52, x1: CH_AT.x + 0.62, z1: CH_AT.z + 0.5 });
      const ms = modelEntry('rain_frog_mama')?.() as RigSpec | undefined;
      if (ms?.parts) {
        this.mama = new RigInstance(buildRigGeo(ms, ms.name + ':hub'), { material: makeVoxelMaterial(), castShadow: true });
        const seat = chSpec.meta!.seat as number[], piv = chSpec.meta!.pivot as number[];
        this.mama.root.position.set(seat[0] - piv[0], seat[1] - piv[1] - 0.03, seat[2] - piv[2] + 0.02);
        this.mama.root.scale.setScalar(0.86);
        this.chair.nodes['chair']?.add(this.mama.root);
        this.mama.setExpression?.('happy');
      }
    }
    put(B(() => WS.knittingBasket()), CH_AT.x + 0.62, CH_AT.z + 0.45, 0.6, 0, 1, false);
    lamp(0xffa860, 1.5, 2.2, 1.6, new THREE.Vector3(CH_AT.x - 0.55, 1.1, CH_AT.z + 0.75), 0.06);
    const babyAt: [number, number, number, number, number][] = [[3.95, 0.07, -2.0, -0.4, 2], [2.05, 0.46, -2.95, 0.5, 4], [-3.1, 0.0, 1.0, 2.6, 1]];
    for (const [bx, by, bz, ry, v] of babyAt) {
      const bs = modelEntry('rain_frog_baby_v' + v)?.() as RigSpec | undefined;
      if (!bs?.parts) continue;
      const bri = new RigInstance(buildRigGeo(bs, bs.name + ':hub'), { material: sharedVoxelMaterial, castShadow: true });
      bri.root.position.set(bx, by, bz);
      bri.root.rotation.y = ry;
      s.add(bri.root);
      this.babies.push({ rig: bri, phase: bx * 3.1, blink: 1 + Math.random() * 3 });
    }
    if (this.chair) {
      this.mamaHead.set(CH_AT.x, 1.35, CH_AT.z);
      station({ id: 'mama', label: 'Mama Frog', stand: new THREE.Vector2(CH_AT.x - 0.75, CH_AT.z + 1.05), face: Math.atan2(0.75, -1.05), at: new THREE.Vector3(CH_AT.x, 1.62, CH_AT.z), r: 0.8, objs: [this.chair.root], pose: 'chat', shot: { pos: new THREE.Vector3(CH_AT.x - 1.45, 1.42, CH_AT.z + 2.0), look: new THREE.Vector3(CH_AT.x + 0.1, 0.95, CH_AT.z), fov: 42 } });
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
      id: 'wardrobe',
      label: 'Wardrobe & Mirror — hats and outfits',
      stand: mirStand(mirrorAt),
      face: Math.atan2(-mn.x, -mn.z),
      at: new THREE.Vector3(MIR.x - 0.1, 1.95, MIR.z),
      r: 0.8,
      objs: [arm, mir],
      pose: 'mirror',
      shot: mirShot(mirrorAt),
    });
    put(B(() => HX.steamerTrunk(1)), 4.25, 2.55, -Math.PI / 2 - 0.2, 0, 1, false);
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
    station({ id: 'book', label: 'The Book of Skills', stand: new THREE.Vector2(LEC.x - 0.46, LEC.z + 0.5), face: Math.PI - 0.62, at: bookAt.clone().add(new THREE.Vector3(0, 0.45, 0)), r: 0.75, objs: [lec], pose: 'book', shot: { pos: new THREE.Vector3(LEC.x + 0.85, 1.9, LEC.z + 1.3), look: bookAt.clone().add(new THREE.Vector3(-0.1, -0.05, 0)), fov: 42 } });

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
      put(B(() => HX.barStool(2, 'ok')), -1.0, -2.08, 0.4);
      station({ id: 'bench', label: 'Weapon Bench — tune your revolver', stand: new THREE.Vector2(-1.78, -1.84), face: Math.PI, at: new THREE.Vector3(-1.32, 1.5, IN.back + 0.5), r: 0.75, objs: [wb], pose: 'bench', shot: { pos: new THREE.Vector3(-0.22, 1.66, -1.2), look: new THREE.Vector3(-1.42, 1.0, IN.back + 0.3), fov: 46 } });
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
    station({ id: 'garage', label: 'Garage — pick your board', stand: new THREE.Vector2(-3.42, -0.6), face: Math.PI, at: new THREE.Vector3(-3.45, 1.5, -1.6), r: 0.8, objs: [rack, this.boardBench, wxg], pose: 'board', shot: { pos: new THREE.Vector3(-2.18, 1.66, 0.62), look: new THREE.Vector3(-3.72, 0.92, -1.9), fov: 46 } });
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
    station({ id: 'ride', label: 'Barn Doors — RIDE OUT', stand: new THREE.Vector2(-4.42, 0.05), face: -Math.PI / 2, at: new THREE.Vector3(-4.75, 2.1, 0), r: 0.75, objs: this.barn.map((b) => b.root), pose: 'idle' });

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
      const reflect = glass.onBeforeRender;
      glass.onBeforeRender = function (this: Reflector, r: THREE.WebGLRenderer, ...rest: unknown[]) {
        const au = r.shadowMap.autoUpdate;
        r.shadowMap.autoUpdate = false;
        try {
          (reflect as (...a: unknown[]) => void).call(this, r, ...rest);
        } finally {
          r.shadowMap.autoUpdate = au;
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

    // ------------------------------------------------ camera + UI
    this.camera.aspect = eng.width / eng.height;
    this.camera.updateProjectionMatrix();
    this.camPos.set(-10.2, 1.7, 2.4);
    this.camLook.set(-4.6, 1.2, -0.3);
    this.camera.position.copy(this.camPos);
    this.camera.fov = 48;
    this.walkTo = { x: -3.3, z: 0.25, face: Math.PI / 2 + 0.35 };
    (window as any).__music?.setMood('hub');
    this.wind = eng.audio.loop('wind_loop', 0.16);
    eng.input.setWantLock(false);
    this.tip.style.cssText = "position:absolute;z-index:7;pointer-events:none;display:none;font-family:'Alagard';font-size:17px;color:#fff3d6;text-shadow:0 2px 0 #2a1408,0 0 10px #000";
    this.bank.style.cssText = "position:absolute;left:24px;top:20px;z-index:7;pointer-events:none;font-family:'Alagard';font-size:22px;color:#ffd36b;text-shadow:0 3px 0 #2a1408";
    this.title.style.cssText = "position:absolute;right:28px;top:22px;z-index:7;pointer-events:none;font-family:'Alagard';font-size:30px;color:#fff3d6;text-align:right;text-shadow:0 3px 0 #2a1408,0 0 14px #000;opacity:0;transition:opacity 1.2s";
    this.title.innerHTML = 'THE HIDEOUT<div style="font-size:15px;opacity:.8">home, at the edge of the Last Chance</div>';
    this.prompt.style.cssText = "position:absolute;z-index:7;pointer-events:none;display:none;transform:translate(-50%,-100%);font-family:'Alagard';font-size:18px;color:#fff3d6;text-shadow:0 2px 0 #2a1408,0 0 8px #000;white-space:nowrap";
    this.hint.style.cssText = "position:absolute;left:50%;bottom:22px;transform:translateX(-50%);z-index:7;pointer-events:none;font-family:'Alagard';font-size:16px;color:#fff3d6;opacity:0;transition:opacity 1.5s;text-shadow:0 2px 0 #2a1408,0 0 8px #000;white-space:nowrap";
    this.hint.textContent = this.touch ? 'Tap anything to walk over and use it' : 'WASD walk · Shift run · E use · click anything · Esc menu';
    this.bubble.style.cssText = "position:absolute;z-index:7;pointer-events:none;display:none;transform:translate(-50%,-100%);max-width:260px;padding:8px 12px;background:#f4e6c4;border:3px solid #5a3418;border-radius:14px;box-shadow:0 4px 0 #2a1408;font-family:'Alagard';font-size:16px;color:#2a1a10;text-align:center";
    eng.overlay.append(this.tip, this.bank, this.title, this.prompt, this.hint, this.bubble);
    setTimeout(() => (this.title.style.opacity = '1'), 1200);
    setTimeout(() => (this.title.style.opacity = '0'), 6500);
    setTimeout(() => (this.hint.style.opacity = '0.9'), 5200);
    setTimeout(() => (this.hint.style.opacity = '0'), 16000);
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
        add('rain_frog_mama', 0, 0, 0);
        add('rain_frog_baby_v1', -0.42, 0.32, 0.4);
        add('rain_frog_baby_v3', 0.4, 0.3, -0.3);
        add('rain_frog_baby_v4', 0.05, 0.48, 0.1);
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
      spec = (CH as any).skeletonCowboyRig?.({ hat: d.look.hat, outfit: d.look.outfit }) ?? null;
    } catch (e) {
      console.warn('[hub] hero', e);
    }
    spec = spec ?? ((modelEntry('cowboy_stetson_duster')?.() as RigSpec) || null);
    if (!spec?.parts) return;
    this.heroSpec = spec;
    this.hero = new RigInstance(buildRigGeo(spec, spec.name + ':hub:' + d.look.hat + d.look.outfit), { material: makeVoxelMaterial(), castShadow: true });
    this.heroHolder.add(this.hero.root);
    if (!this.heroHolder.parent) this.scene.add(this.heroHolder);
    this.hero.setExpression('smug');
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

  /** prev / next / buy row for one cosmetic slot */
  private lookRow(wrap: HTMLElement, kind: 'hat' | 'outfit' | 'board', list: string[], render: () => void) {
    const d = loadSave();
    const cur = (d.look as any)[kind] as string;
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0';
    const i = list.indexOf(cur);
    const prev = document.createElement('button');
    prev.textContent = '◀';
    prev.style.cssText = BTN_CSS;
    const next = document.createElement('button');
    next.textContent = '▶';
    next.style.cssText = BTN_CSS;
    const lab = document.createElement('div');
    lab.style.cssText = 'flex:1;text-align:center';
    const key = `${kind}:${cur}`;
    const own = owns(key);
    lab.innerHTML = `<div style="font-size:13px;opacity:.7">${kind.toUpperCase()}</div>${cur.replace('_', ' ')}${own ? '' : `<div style="color:#a02a1a;font-size:14px">${PRICES[key]} gold</div>`}`;
    const set = (v: string) => {
      (d.look as any)[kind] = v;
      writeSave(d);
      if (kind === 'board') this.buildBoards();
      else this.buildHero();
      render();
      this.engine.audio.play(kind === 'board' ? 'kick' : 'paper_flutter', { volume: 0.5, pitch: kind === 'board' ? 1.4 : 1 });
    };
    prev.onclick = () => set(list[(i - 1 + list.length) % list.length]);
    next.onclick = () => set(list[(i + 1) % list.length]);
    r.append(prev, lab, next);
    if (!own) {
      const b = document.createElement('button');
      b.textContent = 'BUY';
      b.style.cssText = BTN_CSS;
      b.onclick = () => {
        if (buy(key)) {
          this.engine.audio.play('gold_burst', { volume: 0.8 });
          this.updateBank();
          render();
        } else this.engine.audio.play('ui_error', { volume: 0.8 });
      };
      r.appendChild(b);
    }
    wrap.appendChild(r);
  }

  private wardrobe() {
    const wrap = document.createElement('div');
    const render = () => {
      wrap.innerHTML = '<div style="font-size:26px;color:#8a2a18;text-align:center;margin-bottom:8px">WARDROBE</div>';
      this.lookRow(wrap, 'hat', HATS, render);
      this.lookRow(wrap, 'outfit', OUTFITS, render);
      const note = document.createElement('div');
      note.style.cssText = 'font-size:14px;opacity:.75;text-align:center;margin-top:6px';
      note.textContent = 'Check yourself in the mirror. Locked looks are previewed; buy them to ride out in style.';
      wrap.appendChild(note);
    };
    render();
    this.openPanel(wrap, 'left');
  }

  private garage() {
    const wrap = document.createElement('div');
    const render = () => {
      wrap.innerHTML = '<div style="font-size:26px;color:#8a2a18;text-align:center;margin-bottom:8px">THE GARAGE</div>';
      this.lookRow(wrap, 'board', BOARDS, render);
      const note = document.createElement('div');
      note.style.cssText = 'font-size:14px;opacity:.75;text-align:center;margin-top:6px';
      note.textContent = 'Fresh wax on the sawhorses. Whatever sits there is what you ride.';
      wrap.appendChild(note);
    };
    render();
    this.openPanel(wrap, 'left');
  }

  /** drag a part chip onto its slot (or click it) */
  private gunBench() {
    const wrap = document.createElement('div');
    const render = () => {
      const d = loadSave();
      wrap.innerHTML = '<div style="font-size:26px;color:#8a2a18;text-align:center;margin-bottom:4px">WEAPON BENCH</div><div style="font-size:14px;text-align:center;opacity:.75;margin-bottom:8px">Drag a part onto its slot</div>';
      for (const slot of Object.keys(GUN_PARTS) as (keyof GunLoadout)[]) {
        const r = document.createElement('div');
        r.style.cssText = 'margin:8px 0';
        const target = document.createElement('div');
        target.style.cssText = 'border:3px dashed #5a3418;padding:6px 10px;margin-bottom:4px;background:#f4e4bc';
        target.innerHTML = `<span style="font-size:13px;opacity:.7">${slot.toUpperCase()}</span> · ${d.gun[slot]}<div style="font-size:13px;color:#5a3a1a">${GUN_PERKS[`${slot}:${d.gun[slot]}`] ?? ''}</div>`;
        target.ondragover = (e) => {
          e.preventDefault();
          target.style.background = '#ffe9a8';
        };
        target.ondragleave = () => (target.style.background = '#f4e4bc');
        target.ondrop = (e) => {
          e.preventDefault();
          const v = e.dataTransfer?.getData('text/plain') ?? '';
          const [sl, part] = v.split(':');
          if (sl === slot) equip(slot, part);
          else target.style.background = '#f4e4bc';
        };
        const chips = document.createElement('div');
        chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
        for (const part of GUN_PARTS[slot] as string[]) {
          const key = `gun:${slot}:${part}`;
          const own = owns(key);
          const c = document.createElement('div');
          c.draggable = true;
          c.textContent = own ? part : `${part} (${PRICES[key]}g)`;
          c.title = GUN_PERKS[`${slot}:${part}`] ?? '';
          c.style.cssText = `cursor:grab;padding:3px 8px;border:3px solid #2a1408;background:${(d.gun as any)[slot] === part ? '#c9a050' : own ? '#d8b878' : '#b8a888'};font-size:15px`;
          c.ondragstart = (e) => e.dataTransfer?.setData('text/plain', `${slot}:${part}`);
          c.onclick = () => equip(slot, part);
          chips.appendChild(c);
        }
        r.append(target, chips);
        wrap.appendChild(r);
      }
    };
    const equip = (slot: keyof GunLoadout, part: string) => {
      const key = `gun:${slot}:${part}`;
      if (!owns(key) && !buy(key)) {
        this.engine.audio.play('ui_error', { volume: 0.8 });
        return;
      }
      const d = loadSave();
      (d.gun as any)[slot] = part;
      writeSave(d);
      this.engine.audio.play(slot === 'cylinder' ? 'rev_spin' : 'rev_close', { volume: 0.8 });
      this.updateBank();
      this.buildGun();
      render();
    };
    render();
    this.openPanel(wrap, 'right');
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
    this.engine.audio.play('squeak', { volume: 0.45, pitch: 0.55 + Math.random() * 0.1 });
  }

  /** use a station (Sundown is already standing at it) */
  private use(st: Station) {
    const eng = this.engine;
    switch (st.id) {
      case 'wardrobe':
        this.active = st;
        eng.audio.play('chest_open', { volume: 0.5 });
        this.wardrobe();
        break;
      case 'bench':
        this.active = st;
        eng.audio.play('rev_open', { volume: 0.6 });
        this.gunBench();
        break;
      case 'garage':
        this.active = st;
        this.garage();
        break;
      case 'book':
        this.active = st;
        this.codex();
        break;
      case 'mama':
        this.mamaLine = (this.mamaLine + 1) % MAMA_LINES.length;
        this.say(MAMA_LINES[this.mamaLine]);
        this.mamaCd = 12;
        break;
      case 'duck':
        this.duckSquash = 1;
        eng.audio.play('duck_quack', { volume: 1, pitch: 0.9 + rnd.next() * 0.3 });
        break;
      case 'gramophone':
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

  /** walk over to a station, then use it */
  private go(st: Station) {
    this.walkTo = { x: st.stand.x, z: st.stand.y, face: st.face, then: () => this.use(st) };
  }

  exit() {
    this.panel?.remove();
    for (const el of [this.tip, this.bank, this.title, this.prompt, this.hint, this.bubble]) el.remove();
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
    if ((window as any).__hub === this) (window as any).__hub = null;
  }

  // ======================================================================= locomotion
  private collide(p: THREE.Vector2) {
    for (let it = 0; it < 3; it++)
      for (const w of this.walls) {
        const cx = Math.max(w.x0, Math.min(p.x, w.x1)), cz = Math.max(w.z0, Math.min(p.y, w.z1));
        const dx = p.x - cx, dz = p.y - cz;
        const d = Math.hypot(dx, dz);
        if (d >= HERO_R) continue;
        if (d > 1e-5) {
          p.x = cx + (dx / d) * HERO_R;
          p.y = cz + (dz / d) * HERO_R;
        } else {
          // inside: push out along the shallowest side
          const l = p.x - w.x0, r = w.x1 - p.x, b = p.y - w.z0, f = w.z1 - p.y;
          const m = Math.min(l, r, b, f);
          if (m === l) p.x = w.x0 - HERO_R;
          else if (m === r) p.x = w.x1 + HERO_R;
          else if (m === b) p.y = w.z0 - HERO_R;
          else p.y = w.z1 + HERO_R;
        }
      }
  }

  private locomote(rdt: number) {
    const inp = this.engine.input;
    const intro = this.introT < 4.2;
    const busy = !!this.panel || intro;
    // desired velocity: keys (camera-relative), or walking to a target
    const want = new THREE.Vector2();
    let ix = 0, iz = 0;
    if (!busy) {
      ix = (inp.isDown('KeyD') || inp.isDown('ArrowRight') ? 1 : 0) - (inp.isDown('KeyA') || inp.isDown('ArrowLeft') ? 1 : 0);
      iz = (inp.isDown('KeyW') || inp.isDown('ArrowUp') ? 1 : 0) - (inp.isDown('KeyS') || inp.isDown('ArrowDown') ? 1 : 0);
    }
    const run = !busy && (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight'));
    if (ix || iz) {
      this.walkTo = null;
      const f = new THREE.Vector3();
      this.camera.getWorldDirection(f);
      const fw = new THREE.Vector2(f.x, f.z).normalize();
      const rt = new THREE.Vector2(-fw.y, fw.x);
      want.addScaledVector(fw, iz).addScaledVector(rt, ix).normalize().multiplyScalar(run ? 2.9 : 1.55);
    } else if (this.walkTo) {
      const dx = this.walkTo.x - this.pos.x, dz = this.walkTo.z - this.pos.y;
      const d = Math.hypot(dx, dz);
      if (d < 0.06 || (d < 0.3 && this.vel.length() < 0.05)) {
        const w = this.walkTo;
        this.walkTo = null;
        if (w.face !== undefined) this.faceTo = w.face;
        if (w.then) this.pendingUse = { t: 0.35, f: w.then };
      } else want.set(dx, dz).multiplyScalar(Math.min(intro ? 1.3 : 1.7, d * 3) / d);
    }
    this.vel.x = damp(this.vel.x, want.x, 9, rdt);
    this.vel.y = damp(this.vel.y, want.y, 9, rdt);
    const before = this.pos.clone();
    this.pos.addScaledVector(this.vel, rdt);
    if (!intro) this.collide(this.pos);
    // keep the measured speed honest after collisions
    const moved = this.pos.clone().sub(before).length() / Math.max(rdt, 1e-4);
    const sp = Math.min(moved, this.vel.length());
    // heading
    let tgtYaw = this.yaw;
    if (sp > 0.12) tgtYaw = Math.atan2(this.vel.x, this.vel.y);
    else if (this.faceTo !== null) tgtYaw = this.faceTo;
    if (sp > 0.12) this.faceTo = null;
    let dy = tgtYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-rdt * (sp > 0.12 ? 9 : 6)));
    this.moveK = damp(this.moveK, Math.min(1, sp / 1.2), 8, rdt);
    this.runK = damp(this.runK, Math.min(1, Math.max(0, (sp - 1.6) / 1.2)), 5, rdt);
    // gait phase: a stance covers 2·amp at body speed
    const amp = 0.17 + 0.11 * this.runK;
    const duty = 0.62 - 0.14 * this.runK;
    this.phase += (Math.max(sp, 0) * duty) / (2 * amp) * rdt;
    // footsteps
    for (let k = 0; k < 2; k++) {
      const f = (this.phase + k * 0.5) % 1;
      if (this.moveK > 0.35 && f < this.lastStep[k]) this.engine.audio.play('footstep_sand', { volume: (this.pos.x < HX.CABIN_OPEN.garageX ? 0.22 : 0.14) + this.runK * 0.1, pitch: this.pos.x < HX.CABIN_OPEN.garageX ? 1.0 : 1.35 });
      this.lastStep[k] = f;
    }
    if (this.pendingUse) {
      this.pendingUse.t -= rdt;
      if (this.pendingUse.t <= 0) {
        const f = this.pendingUse.f;
        this.pendingUse = null;
        f();
      }
    }
    this.heroHolder.position.set(this.pos.x, 0, this.pos.y);
    this.heroHolder.rotation.y = this.yaw;
    return { amp, duty, sp };
  }
  private faceTo: number | null = null;
  private pendingUse: { t: number; f: () => void } | null = null;

  /** procedural walk: exact two-bone leg IK on planted feet, counter-swinging arms, hips, spine and a head that looks */
  private animateHero(g: { amp: number; duty: number }, t: number, rdt: number) {
    const h = this.hero;
    const spec = this.heroSpec;
    if (!h || !spec) return;
    const n = h.nodes;
    const mk = this.moveK, rk = this.runK;
    const hipY = (spec.meta?.hipY as number) ?? 0.67, kneeY = (spec.meta?.kneeY as number) ?? 0.36;
    const l1 = hipY - kneeY, l2 = kneeY;
    // pelvis height: settle a little into the knees, bob twice a cycle, breathe when still
    const drop = -0.022 - 0.03 * rk - 0.012 * mk;
    const bob = (0.016 + 0.02 * rk) * mk * Math.cos(this.phase * Math.PI * 4);
    const breathe = Math.sin(t * 1.5) * 0.004 * (1 - mk);
    h.root.position.y = drop + bob + breathe;
    const lift = 0.07 + 0.06 * rk;
    const legs: [string, string, number, number][] = [['thigh_l', 'shin_l', 0, 1], ['thigh_r', 'shin_r', 0.5, -1]];
    const sweeps = [0, 0];
    legs.forEach(([th, sh, off, side], i) => {
      const L = leg(this.phase + off, g.duty);
      sweeps[i] = L.sweep * mk;
      const thigh = n[th], shin = n[sh];
      if (!thigh || !shin) return;
      const hipX = thigh.position.x;
      const fx = hipX * 0.9 + side * 0.012 * (1 - mk);
      const fz = L.sweep * g.amp * mk + 0.02;
      const fy = L.lift * lift * mk;
      legIK(fx - hipX, fy - (hipY + h.root.position.y), fz, l1, l2, 0.6, this.lp);
      thigh.rotation.set(this.lp.x, 0, this.lp.z);
      shin.rotation.set(this.lp.knee, 0, this.lp.roll);
    });
    const [sL, sR] = sweeps;
    const pose = this.panel ? this.active?.pose ?? 'idle' : 'idle';
    if (n['pelvis']) n['pelvis'].rotation.set(0, -0.12 * sL, 0.035 * Math.sin(this.phase * Math.PI * 2) * mk + Math.sin(t * 0.37) * 0.012 * (1 - mk));
    let lean = 0.03 + 0.06 * mk + 0.1 * rk + Math.sin(t * 1.5) * 0.008 * (1 - mk);
    if (pose === 'bench' || pose === 'board') lean += 0.2;
    if (pose === 'book') lean += 0.12;
    if (pose === 'mirror') lean -= 0.05;
    if (n['torso']) n['torso'].rotation.set(lean, 0.17 * sL, -0.02 * Math.sin(this.phase * Math.PI * 2) * mk);
    // arms: swing against the legs, carried higher when running; reach for the work at a station
    const swing = 0.42 + 0.35 * rk;
    let al = -swing * sR + 0.04, ar = -swing * sL + 0.04, fl = -0.2 - 0.6 * rk - 0.18 * Math.max(0, -al), fr = -0.2 - 0.6 * rk - 0.18 * Math.max(0, -ar);
    let zl = 0.07 + Math.sin(t * 0.9) * 0.01, zr = -0.07 - Math.sin(t * 0.9 + 1) * 0.01;
    if (pose === 'bench' || pose === 'board') {
      al = ar = -0.62;
      fl = fr = -0.85;
      zl = 0.18;
      zr = -0.18;
    } else if (pose === 'book') {
      ar = -0.75;
      fr = -0.9;
      zr = -0.1;
    } else if (pose === 'mirror') {
      // hands on the hips, looking himself over
      al = 0.28;
      ar = 0.28;
      zl = 0.62;
      zr = -0.62;
      fl = fr = -1.45;
    }
    const set = (k: string, x: number, z: number) => {
      const o = n[k];
      if (!o) return;
      o.rotation.x = damp(o.rotation.x, x, 12, rdt);
      o.rotation.z = damp(o.rotation.z, z, 12, rdt);
    };
    set('arm_l', al, zl);
    set('arm_r', ar, zr);
    set('fore_l', fl, 0);
    set('fore_r', fr, 0);
    // the duster's skirt trails the stride
    if (n['coat']) n['coat'].rotation.set(0.05 * mk + 0.12 * rk + Math.abs(sL) * 0.05, 0, 0.03 * Math.sin(this.phase * Math.PI * 2) * mk);
    // head: look at what's interesting (the station in reach, Mama, the camera when idle)
    const look = new THREE.Vector3();
    if (this.panel && this.active) look.copy(this.active.id === 'wardrobe' && this.mirror ? this.mirror.position : this.active.at);
    else if (this.near) look.copy(this.near.at);
    else if (this.pos.distanceTo(new THREE.Vector2(this.mamaHead.x, this.mamaHead.z)) < 2.2) look.copy(this.mamaHead);
    else look.set(this.pos.x + Math.sin(this.yaw + Math.sin(t * 0.21) * 0.6) * 3, 1.55 + Math.sin(t * 0.33) * 0.15, this.pos.y + Math.cos(this.yaw + Math.sin(t * 0.21) * 0.6) * 3);
    const dx = look.x - this.pos.x, dz = look.z - this.pos.y;
    let ly = Math.atan2(dx, dz) - this.yaw;
    ly = Math.atan2(Math.sin(ly), Math.cos(ly));
    const lpch = Math.atan2(1.62 - look.y, Math.hypot(dx, dz));
    this.headYaw = damp(this.headYaw, Math.max(-0.95, Math.min(0.95, ly)) - 0.17 * sL, 5, rdt);
    this.headPitch = damp(this.headPitch, Math.max(-0.4, Math.min(0.5, lpch)) - lean * 0.6 + (pose === 'book' ? 0.25 : 0), 5, rdt);
    if (n['head']) n['head'].rotation.set(this.headPitch, this.headYaw, Math.sin(t * 0.5) * 0.02);
    h.root.updateMatrixWorld(true);
  }

  // ======================================================================= frame
  update(_dt: number, rdt: number) {
    this.t += rdt;
    this.introT += rdt;
    const t = this.t;
    const eng = this.engine;
    const inp = eng.input;
    if (inp.wasPressed('Escape')) {
      if (this.panel) this.closePanel();
      else this.onMenu();
    }
    const g = this.locomote(rdt);
    this.animateHero(g, t, rdt);

    // ------------------------------------------------ stations: what's in reach, hover, click, use
    let best: Station | null = null, bd = 1e9;
    if (!this.panel && this.introT > 4.2)
      for (const st of this.stations) {
        const d = Math.hypot(st.stand.x - this.pos.x, st.stand.y - this.pos.y);
        if (d < st.r && d < bd) {
          best = st;
          bd = d;
        }
      }
    this.near = best;
    if (!this.panel) {
      this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), this.camera);
      let h: Station | null = null;
      const objs = this.stations.flatMap((s) => s.objs);
      const hits = this.ray.intersectObjects(objs, true);
      if (hits.length) {
        let o: THREE.Object3D | null = hits[0].object;
        while (o && !h) {
          const oo = o;
          h = this.stations.find((s) => s.objs.includes(oo)) ?? null;
          o = o.parent;
        }
      }
      if (h !== this.hovered) {
        if (h) eng.audio.play('ui_hover', { volume: 0.3 });
        this.hovered = h;
        document.body.style.cursor = h ? 'pointer' : 'default';
      }
      if (h) {
        this.tip.textContent = h.label;
        this.tip.style.display = 'block';
        this.tip.style.left = `${inp.mouseX + 16}px`;
        this.tip.style.top = `${inp.mouseY + 12}px`;
      } else this.tip.style.display = 'none';
      if (inp.wasPressed('Mouse0') && this.introT > 4.2) {
        if (h) this.go(h);
        else {
          // click the floor: walk there
          const hit = new THREE.Vector3();
          if (this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) && hit.x > WALK.x0 && hit.x < WALK.x1 && hit.z > WALK.z0 && hit.z < WALK.z1 + 0.3) this.walkTo = { x: hit.x, z: Math.min(hit.z, WALK.z1) };
        }
      }
      if (this.near && (inp.hit('interact') || inp.wasPressed('KeyE'))) this.go(this.near);
    } else this.tip.style.display = 'none';
    // prompt over the station in reach
    if (this.near && !this.panel && !this.walkTo) {
      const p = this.near.at.clone().project(this.camera);
      if (p.z < 1) {
        this.prompt.style.display = 'block';
        this.prompt.style.left = `${((p.x + 1) / 2) * eng.width}px`;
        this.prompt.style.top = `${((1 - p.y) / 2) * eng.height}px`;
        const key = this.touch ? 'TAP' : 'E';
        this.prompt.innerHTML = `<span style="display:inline-block;padding:0 7px;margin-right:7px;background:#e8d4a4;color:#2a1a10;border:3px solid #2a1408;box-shadow:0 3px 0 #2a1408">${key}</span>${this.near.label.split(' — ')[0]}`;
      } else this.prompt.style.display = 'none';
    } else this.prompt.style.display = 'none';

    // ------------------------------------------------ the house breathes
    this.animateLife(t, rdt);
    this.particles.update(rdt, this.scene.fog as THREE.Fog);
    this.stepMoveArt();

    // ------------------------------------------------ cinematic camera
    this.updateCamera(t, rdt);
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
    this.animateMama(t, rdt);
  }

  /** Mama Frog rocks, breathes, blinks, watches Sundown, and talks when he comes near */
  private animateMama(t: number, rdt: number) {
    if (this.chair?.nodes['chair']) this.chair.nodes['chair'].rotation.x = Math.sin(t * 1.05) * 0.055;
    const m = this.mama;
    const heroNear = Math.hypot(this.pos.x - this.mamaHead.x, this.pos.y - this.mamaHead.z) < 1.9;
    this.mamaCd -= rdt;
    if (m) {
      const n = m.nodes;
      const talk = this.mamaTalk > 0 ? 1 : 0;
      this.mamaTalk = Math.max(0, this.mamaTalk - rdt);
      // breathing: belly and throat swell slowly; the throat puffs with each phrase
      const br = Math.sin(t * 1.6);
      if (n['belly']) n['belly'].scale.setScalar(1 + br * 0.025);
      const puff = talk ? 0.12 + Math.abs(Math.sin(t * 7)) * 0.18 : Math.max(0, Math.sin(t * 0.55) - 0.85) * 1.6;
      if (n['throat']) n['throat'].scale.setScalar(1 + puff);
      if (n['body']) n['body'].scale.set(1 + br * 0.008, 1 - br * 0.006, 1 + br * 0.008);
      // blinks: lids come down as the globes sink and flatten
      this.mamaBlink -= rdt;
      if (this.mamaBlink < -0.13) this.mamaBlink = 2.2 + Math.random() * 3.5;
      const bl = this.mamaBlink < 0 ? Math.sin((-this.mamaBlink / 0.13) * Math.PI) : 0;
      for (const e of ['eye_l', 'eye_r']) if (n[e]) n[e].scale.set(1, 1 - bl * 0.8, 1 - bl * 0.25);
      // head: turn to Sundown when he's close, a fond tilt, a nod while talking
      const local = new THREE.Vector3(this.pos.x, 1.3, this.pos.y);
      m.root.parent?.updateWorldMatrix(true, false);
      const inv = new THREE.Matrix4().copy(m.root.matrixWorld).invert();
      local.applyMatrix4(inv);
      const want = heroNear ? Math.max(-0.6, Math.min(0.6, Math.atan2(local.x, local.z))) : Math.sin(t * 0.13) * 0.25;
      if (n['head']) {
        n['head'].rotation.y = damp(n['head'].rotation.y, want, 3, rdt);
        n['head'].rotation.z = damp(n['head'].rotation.z, (heroNear ? 0.14 : 0.05) + Math.sin(t * 0.4) * 0.04, 2, rdt);
        n['head'].rotation.x = talk ? Math.sin(t * 5.5) * 0.04 : damp(n['head'].rotation.x, 0, 3, rdt);
      }
      if (n['jaw']) n['jaw'].rotation.x = talk ? Math.max(0, Math.sin(t * 13)) * 0.16 + 0.02 : damp(n['jaw'].rotation.x, 0, 8, rdt);
      if (n['leg_fl']) n['leg_fl'].rotation.x = Math.sin(t * 0.8) * 0.05 - (talk ? 0.25 + Math.sin(t * 4) * 0.12 : 0);
    }
    // she pipes up when he comes over
    if (heroNear && this.mamaCd <= 0 && !this.panel && this.introT > 4.2) {
      this.mamaLine = (this.mamaLine + 1 + Math.floor(Math.random() * 2)) % MAMA_LINES.length;
      this.say(MAMA_LINES[this.mamaLine]);
      this.mamaCd = 14 + Math.random() * 6;
    }
    // the speech bubble types itself out over her head
    if (this.bubbleText && (this.mamaTalk > 0 || this.bubbleT < 2)) {
      this.bubbleT += rdt;
      const n = Math.min(this.bubbleText.length, Math.floor(this.bubbleT * 38));
      const p = this.mamaHead.clone().add(new THREE.Vector3(0, 0.3, 0)).project(this.camera);
      if (p.z < 1 && Math.abs(p.x) < 1.1) {
        this.bubble.style.display = 'block';
        this.bubble.style.left = `${((p.x + 1) / 2) * this.engine.width}px`;
        this.bubble.style.top = `${((1 - p.y) / 2) * this.engine.height}px`;
        this.bubble.textContent = this.bubbleText.slice(0, n);
      } else this.bubble.style.display = 'none';
      if (this.mamaTalk <= 0 && this.bubbleT > 2) this.bubbleText = '';
    } else this.bubble.style.display = 'none';
    // the babies breathe and blink
    for (const b of this.babies) {
      const n = b.rig.nodes;
      const br = Math.sin(t * 2.3 + b.phase);
      if (n['belly']) n['belly'].scale.setScalar(1 + br * 0.04);
      if (n['throat']) n['throat'].scale.setScalar(1 + Math.max(0, Math.sin(t * 0.9 + b.phase) - 0.8) * 2);
      b.blink -= rdt;
      if (b.blink < -0.15) b.blink = 1.8 + Math.random() * 4;
      const bl = b.blink < 0 ? Math.sin((-b.blink / 0.15) * Math.PI) : 0;
      for (const e of ['eye_l', 'eye_r']) if (n[e]) n[e].scale.set(1, 1 - bl * 0.85, 1);
      if (n['head']) n['head'].rotation.y = Math.sin(t * 0.3 + b.phase) * 0.3;
    }
  }

  private updateCamera(t: number, rdt: number) {
    const inp = this.engine.input;
    const g = this.goal;
    const hx = this.pos.x, hz = this.pos.y;
    if (this.debugCam) {
      g.pos.fromArray(this.debugCam.pos);
      g.look.fromArray(this.debugCam.look);
      g.fov = this.debugCam.fov ?? 50;
      this.camPos.copy(g.pos);
      this.camLook.copy(g.look);
    } else if (this.panel && this.active?.shot) {
      g.pos.copy(this.active.shot.pos);
      g.look.copy(this.active.shot.look);
      g.fov = this.active.shot.fov;
      // the panel covers one side: slide the frame so the subject sits in the free half
      const fwd = g.look.clone().sub(g.pos);
      const dist = fwd.length();
      const right = fwd.normalize().cross(new THREE.Vector3(0, 1, 0)).normalize();
      const halfW = Math.tan(THREE.MathUtils.degToRad(g.fov) / 2) * this.camera.aspect * dist;
      g.look.addScaledVector(right, (this.panelSide === 'right' ? 1 : -1) * halfW * 0.4);
    } else if (this.introT < 4.2) {
      // walk-in: from the street, through the barn doors, behind Sundown as he comes home
      const k = Math.min(1, this.introT / 4.2);
      g.pos.set(-9.6 + k * 6.0, 1.75 + k * 0.3, 2.3 + k * 0.2);
      g.look.set(hx + 1.2, 1.15, hz - 0.6);
      g.fov = 50;
    } else {
      // the stage camera rides along the front of the room, a little behind and above Sundown
      // a little to his left, so the room is seen on the diagonal (corner to hearth) like the reference photo
      const cx = Math.max(-3.75, Math.min(3.5, hx * 0.8 - 0.42));
      const cz = Math.max(0.55, Math.min(2.72, hz + 3.0));
      const cy = Math.min(2.1, 1.95 + Math.max(0, hz + 0.4) * 0.16); // stays under the tie beams
      g.pos.set(cx, cy, cz);
      const lead = new THREE.Vector3(this.vel.x, 0, this.vel.y).multiplyScalar(0.28);
      g.look.set(hx * 0.9 + 0.05, 0.98, hz - 0.45).add(lead);
      // near a station, frame it with him
      if (this.near) g.look.lerp(new THREE.Vector3(this.near.at.x, Math.min(this.near.at.y, 1.3), this.near.at.z), 0.32);
      g.fov = 50;
      // a slow drift and the mouse leaning the frame
      const right = new THREE.Vector3().subVectors(g.look, g.pos).cross(new THREE.Vector3(0, 1, 0)).normalize();
      g.pos.addScaledVector(right, Math.sin(t * 0.07) * 0.12 + inp.ndcX * 0.1);
      g.pos.y += Math.sin(t * 0.09) * 0.03 + inp.ndcY * 0.05;
    }
    const intro = this.introT < 4.2;
    const kp = 1 - Math.exp(-rdt * (intro ? 1.6 : this.panel ? 2.4 : 2.0));
    this.camPos.lerp(g.pos, kp);
    this.camLook.lerp(g.look, 1 - Math.exp(-rdt * (intro ? 2.2 : 3.2)));
    const sway = new THREE.Vector3(Math.sin(t * 1.3) * 0.005 + Math.sin(t * 2.9) * 0.0025, Math.sin(t * 1.7) * 0.004 + Math.sin(t * 3.7) * 0.0015, 0);
    this.camera.position.copy(this.camPos).add(sway);
    this.camera.lookAt(this.camLook.clone().add(sway.multiplyScalar(1.5)));
    this.camera.rotateZ(Math.sin(t * 0.6) * 0.004);
    this.camera.fov = damp(this.camera.fov, g.fov, 2.2, rdt);
    this.camera.updateProjectionMatrix();
    // the live mirror only renders while the camera is close enough to see it
    if (this.mirror) this.mirror.visible = this.camera.position.distanceTo(this.mirror.position) < 6.5;
  }
}
