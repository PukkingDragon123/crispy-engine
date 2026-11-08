// THE WEIGHING OF THE HEART — once per run, death sends Sundown's soul down
// into the Duat, the realm of spirits.
//   1. DESCENT  the soul drifts down through darkness and falling motes onto a
//               broken terrace hanging over the abyss; the camera cranes down
//               with it and tilts up to the colossal tomb gate.
//   2. THE GATE wraiths of the dead swirl round the pylons, bony hands claw up
//               over the terrace edge, wisps rise from the abyss; the runes
//               wake and the bronze doors grind open, spilling cold light.
//   3. THE HALL the camera pushes through the doorway behind the soul: the
//               Hall of Two Truths, lotus columns rising into darkness, cold
//               blue spirit fire flaring up brazier by brazier, moonlight
//               shafts, mist, a black floor that mirrors it all.
//   4. ANUBIS   a low hero angle on his soul avatar: obsidian under a luminous
//               spirit shell, eyes igniting, the head lifting. He speaks in
//               floating 3D words, gestures at the Scales of Ma'at.
//   5. JUDGEMENT  timing only: the beam swings and its needle sweeps the gauge;
//               stop it on the feather's mark. Then the feather falls: strike as
//               the closing ring meets the sight, the moment the beam comes level
//               (each good beat sends a sign flying from the soul to the feather).
//   6. VERDICT  worthy: he raises the was-sceptre and the soul rises in a blaze
//               of light. Unworthy: the fires gutter, his eyes burn red, hands
//               rise from the floor and his open hand takes the soul.
//   0. THE FALL  (from the reaping) the god's fist drags the soul down a roaring tunnel of
//               sand, darkness and spirit motes; it opens over the abyss and lets go.
// Every death comes here. The first is weighed; after that (`final`) Anubis gives his last
// word without a weighing and takes the soul.
// HOLD SPACE / ESC / ENTER to skip the arrival (a tap never skips).
// API (RunScene): const t = new AnubisTrial(engine, qte, playerGeo); t.prepare() builds it ahead;
// await t.run({ kills, wave, final?, fromReaping? }) → worthy?
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import { Qte } from '../ui/Qte';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, clearRigCache, RigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { globalUniforms, makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { Particles } from '../fx/Particles';
import { FloatText3D, FloatTextOpts } from '../fx/FloatText3D';
import { Voice } from '../audio/Voice';
import { rnd } from '../../engine/math/rand';
import { REALM_MODELS, StaticModel, spiritNormals } from '../models/anubis/realm';
import { anubisArmRig } from '../models/anubis/arm';

// ----------------------------------------------------------------------------- layout (metres)
const GATE_Z = 28;
const LAND = new THREE.Vector3(0, 0.3, 37);
const KNEEL = new THREE.Vector3(0, 0.02, -7.6);
const SCALES_Z = -12.4;
const ANUBIS_AT = new THREE.Vector3(0, 1.2, -21);
const COL_X = 5.6;
const COL_Z = [19, 10, 1, -8];
const BRAZ: [number, number, number][] = [[3.5, 14.5, 1], [-3.5, 14.5, 1], [3.5, 5.5, 1], [-3.5, 5.5, 1], [7.4, -16.4, 1.5], [-7.4, -16.4, 1.5]];
const MOON_DIR = new THREE.Vector3(-0.3, -1, -0.32).normalize();
const FOG = { color: 0x060c16, near: 8, far: 60 };
const SLIT_X = 3.6;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const sstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mixN = (a: number, b: number, t: number) => a + (b - a) * t;

// ----------------------------------------------------------------------------- spirit shader
const SPIRIT_VS = /* glsl */ `
  attribute vec3 snormal;
  attribute vec2 matx;
  uniform float uInflate;
  varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vC; varying float vE; varying float vDepth;
  void main(){
    vec3 n = dot(snormal, snormal) > 0.01 ? snormal : normal;
    vec4 wp = modelMatrix * vec4(position + n * uInflate, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * n);
    vV = cameraPosition - wp.xyz;
    vC = color;
    vE = matx.x;
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const SPIRIT_FS = /* glsl */ `
  uniform float uTime, uFade, uGain, uPow, uCore, uLumRim, uVein, uFogNear, uFogFar;
  uniform vec3 uA, uB;
  varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vC; varying float vE; varying float vDepth;
  float hh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vn(vec3 p){
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hh(i), hh(i + vec3(1,0,0)), f.x), mix(hh(i + vec3(0,1,0)), hh(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hh(i + vec3(0,0,1)), hh(i + vec3(1,0,1)), f.x), mix(hh(i + vec3(0,1,1)), hh(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main(){
    vec3 N = normalize(vN), Vd = normalize(vV);
    float fr = pow(1.0 - abs(dot(N, Vd)), uPow);
    float lum = clamp(dot(vC, vec3(0.3, 0.55, 0.15)) * 1.6, 0.0, 1.0);
    float rimW = mix(1.0 - 0.75 * lum, 0.2 + 0.8 * lum, uLumRim);
    float n1 = vn(vW * 1.7 + vec3(0.0, -uTime * 0.8, uTime * 0.15));
    float n2 = vn(vW * 4.3 + vec3(uTime * 0.25, -uTime * 1.6, 0.0));
    float veins = smoothstep(0.58, 0.8, n1 * 0.62 + n2 * 0.38);
    float body = uCore * mix(0.25, 1.0, lum) * (0.55 + 0.45 * n1);
    vec3 col = mix(uA, uB, clamp(fr * 1.3 + veins * 0.4, 0.0, 1.0)) * (fr * 2.6 * rimW + body + veins * uVein * rimW);
    col += uB * vE * 2.2 * lum;
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(col * (1.0 - fog) * uFade * uGain, 1.0);
  }`;
export type SpiritMat = THREE.ShaderMaterial & { uniforms: Record<string, THREE.IUniform> };
/** the additive fresnel 'spirit shell' look (souls, gods, the dead); shared with the death sequence */
export function spiritMaterial(a: number, b: number, o: { inflate?: number; power?: number; core?: number; lumRim?: number; gain?: number; vein?: number } = {}): SpiritMat {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: globalUniforms.uTime,
      uA: { value: new THREE.Color(a) },
      uB: { value: new THREE.Color(b) },
      uFade: { value: 1 },
      uGain: { value: o.gain ?? 1 },
      uInflate: { value: o.inflate ?? 0.02 },
      uPow: { value: o.power ?? 2.2 },
      uCore: { value: o.core ?? 0.35 },
      uLumRim: { value: o.lumRim ?? 1 },
      uVein: { value: o.vein ?? 0.5 },
      uFogNear: { value: FOG.near },
      uFogFar: { value: FOG.far + 10 },
    },
    vertexShader: SPIRIT_VS,
    fragmentShader: SPIRIT_FS,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }) as SpiritMat;
}

// ----------------------------------------------------------------------------- volumetric moon shafts
/**
 * A shaft of cold light: the slit (O + a·U + b·V) swept along L. Rendered as the
 * back faces of that parallelepiped; each fragment marches the view ray through
 * it in unit space, integrating soft ragged edges, slat streaks, drifting dust
 * and a fade toward the floor.
 */
function shaftMaterial(O: THREE.Vector3, U: THREE.Vector3, Vv: THREE.Vector3, L: THREE.Vector3, color: number, density: number) {
  const inv = new THREE.Matrix4().makeBasis(U, Vv, L).setPosition(O).invert();
  return new THREE.ShaderMaterial({
    uniforms: { uInv: { value: inv }, uTime: globalUniforms.uTime, uDensity: { value: density }, uColor: { value: new THREE.Color(color) }, uK: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform mat4 uInv; uniform float uTime, uDensity, uK; uniform vec3 uColor;
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
        for (int i = 0; i < 8; i++) {
          float t = mix(tn, tf, (float(i) + 0.5) / 8.0);
          vec3 q = ro + rd * t;
          float rag = 0.06 * sin(q.z * 9.0 + q.y * 3.0) + 0.04 * sin(q.z * 23.0 - q.x * 5.0);
          float e = smoothstep(0.0, 0.22, q.x + rag) * smoothstep(0.0, 0.22, 1.0 - q.x + rag) * smoothstep(0.0, 0.2, q.y) * smoothstep(0.0, 0.2, 1.0 - q.y);
          float slat = 0.72 + 0.28 * sin(q.x * 31.0 + sin(q.y * 6.0) * 1.5);
          float along = smoothstep(0.0, 0.08, q.z) * (1.0 - smoothstep(0.82, 1.0, q.z));
          vec3 wp = cameraPosition + rdW * t;
          float dust = 0.65 + 0.35 * sin(wp.x * 3.1 + uTime * 0.27) * sin(wp.y * 2.3 - uTime * 0.19 + wp.z * 1.7);
          acc += e * slat * along * dust;
        }
        float a = acc / 8.0 * (tf - tn) * uDensity * uK;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
}

// ----------------------------------------------------------------------------- small types
interface Spirit {
  kind: 'wraith' | 'hand' | 'wisp';
  rig: RigInstance;
  mat: SpiritMat;
  seed: number;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vis: number;
  rise: number;
  home: THREE.Vector3;
}
interface Brazier {
  pos: THREE.Vector3;
  fire: THREE.Vector3;
  scale: number;
  light: THREE.PointLight;
  lit: number;
  target: number;
  acc: number;
  /** the flare of being lit in sequence (decays) */
  flare: number;
}
interface Shaft {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  O: THREE.Vector3;
  U: THREE.Vector3;
  V: THREE.Vector3;
  L: THREE.Vector3;
  k: number;
  target: number;
}
interface Line {
  ft: FloatText3D;
  who: 'anubis' | 'narr' | 'title';
  dying: boolean;
}
type Gest = { present: number; point: number; reach: number; grant: number; raise: number };
type ShotFn = (t: number) => { p: THREE.Vector3; l: THREE.Vector3; fov: number };
type Phase = 'build' | 'tunnel' | 'descent' | 'gate' | 'hall' | 'throne' | 'judge' | 'grant' | 'take';
/** the fall through the sand: from (0, TUN_Y0) to (0, TUN_Y1) over TUN_T seconds; the god lets go at TUN_RELEASE */
const TUN_Y0 = 64, TUN_Y1 = 30.5, TUN_T = 3.4, TUN_RELEASE = 2.1;
const TSAND = [0x9a7a54, 0xb08a5e, 0x7a5e40, 0xc8a070, 0x8a6a48];

const TEXT: Record<Line['who'], FloatTextOpts> = {
  anubis: { size: 0.4, color: '#ffe6ad', glow: '#ff9d3a', cps: 34, wrap: 30, hdr: 1.7, px: 72 },
  narr: { size: 0.32, color: '#dcfbff', glow: '#3fc6ff', cps: 30, wrap: 42, hdr: 1.4, px: 64 },
  title: { size: 1.05, color: '#f2fcff', glow: '#5fd8ff', cps: 18, wrap: 40, hdr: 2.0, px: 96 },
};

// =============================================================================
export class AnubisTrial {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  private ready = false;
  private t = 0;
  private phase: Phase = 'build';
  private phaseT = 0;
  private skipping = false;
  private waits: { at: number; res: () => void; skippable: boolean }[] = [];
  private fx = new Particles();
  private mirror = new THREE.Group();
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private rigKeys: string[] = [];
  private envRT: THREE.WebGLRenderTarget | null = null;
  private loop: { stop(t?: number): void } | null = null;
  private saved: Record<string, any> = {};
  // the set
  private gate!: RigInstance;
  private gateOpen = 0;
  private gateTarget = 0;
  private braziers: Brazier[] = [];
  private fireTint = new THREE.Color(0x5ab8ff);
  private fireTintTarget = new THREE.Color(0x5ab8ff);
  private shafts: Shaft[] = [];
  private wallMat!: VoxelMaterial;
  private spill!: THREE.PointLight;
  private aura!: THREE.PointLight;
  private backLight!: THREE.PointLight;
  private scalesLight!: THREE.PointLight;
  private hemi!: THREE.HemisphereLight;
  // the cast
  private anubis!: RigInstance;
  private anubisMirror!: RigInstance;
  private shell!: SpiritMat;
  private eyeMat!: VoxelMaterial;
  private eyes: THREE.Mesh[] = [];
  private scales!: RigInstance;
  private scalesMirror!: RigInstance;
  private soul!: RigInstance;
  private soulMirror!: RigInstance;
  private soulShell!: SpiritMat;
  private soulCore!: VoxelMaterial;
  private spirits: Spirit[] = [];
  // performance state
  private soulPos = LAND.clone();
  private soulMode: 'fall' | 'walk' | 'kneel' | 'rise' | 'dissolve' | 'held' = 'fall';
  // the fall through the sand (from the reaping)
  private building: Promise<void> | null = null;
  private arm: RigInstance | null = null;
  private armShell: SpiritMat | null = null;
  private armLet = 0;
  private armDrop = 0;
  private tunnelLight: THREE.PointLight | null = null;
  private tunnelLoop: { stop(t?: number): void } | null = null;
  private heldQ = new THREE.Quaternion();
  private heldM = new THREE.Matrix4();
  // cinematography
  private skipHold = 0;
  private rack = 0;
  private fireSeq = false;
  private final = false;
  private walkT = 0;
  private soulFade = 1;
  private wake = 0;
  private wakeTarget = 0;
  private roar = 0;
  private speak = 0;
  private anger = 0;
  private blaze = 0;
  private gw: Gest = { present: 0, point: 0, reach: 0, grant: 0, raise: 0 };
  private gwT: Gest = { present: 0, point: 0, reach: 0, grant: 0, raise: 0 };
  private grip = 0;
  private scalesK = 0;
  private tilt = 0;
  private tiltTarget = 0;
  private glyphsDone = 0;
  /** the feather's fall (the second weighing beat) is running when >= 0 */
  private featherDrop = -1;
  private wallPulse = 0;
  private shake = 0;
  // camera
  private shot: ShotFn | null = null;
  private shotT = 0;
  private blendDur = 0;
  private from = { p: V(0, 30, 45), l: V(0, 20, 37), fov: 50 };
  private camLook = V(0, 0, 0);
  private lines: Line[] = [];
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private cf = new THREE.Vector3();
  private cr = new THREE.Vector3();
  private cu = new THREE.Vector3();

  constructor(private engine: Engine, private qte: Qte, private playerGeo: RigGeo) {
    const s = this.scene;
    s.background = new THREE.Color(0x020409);
    s.fog = new THREE.Fog(FOG.color, FOG.near, FOG.far);
    this.mirror.scale.set(1, -1, 1);
    s.add(this.mirror, this.fx.group);
    this.fx.quality = Math.max(0.5, engine.quality.particles);
    (window as any).__trial = this;
  }

  // =========================================================================== building
  private tick() {
    return new Promise<void>((r) => setTimeout(r, 0));
  }
  private stat(key: string, pivot: [number, number, number] | 'bottom' | 'center' = 'bottom') {
    const sm = REALM_MODELS[key]() as StaticModel;
    const g = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot });
    this.geos.push(g);
    return { geo: g, meta: sm.meta ?? {}, vs: sm.voxelSize };
  }
  private rigGeo(key: string, spirit = false, R = 1) {
    const spec = REALM_MODELS[key]() as RigSpec;
    const ck = key + ':trial';
    clearRigCache(ck);
    const geo = buildRigGeo(spec, ck);
    this.rigKeys.push(ck);
    if (spirit) geo.parts.forEach((p) => spiritNormals(p.geo, p.model, p.pivot, spec.voxelSize, R));
    return geo;
  }
  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, at: THREE.Vector3, o: { ry?: number; sx?: number; scale?: number; shadow?: boolean; mirror?: boolean } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at);
    m.rotation.y = o.ry ?? 0;
    m.scale.setScalar(o.scale ?? 1);
    if (o.sx) m.scale.x *= o.sx;
    m.castShadow = o.shadow ?? true;
    m.receiveShadow = true;
    this.scene.add(m);
    if (o.mirror) {
      const r = new THREE.Mesh(geo, mat);
      r.position.copy(m.position);
      r.rotation.copy(m.rotation);
      r.scale.copy(m.scale);
      this.mirror.add(r);
    }
    return m;
  }

  private async build() {
    const eng = this.engine;
    const s = this.scene;
    // --- light: low cold ambience, a moon through roof slits, brazier fires, the god's glow
    this.hemi = new THREE.HemisphereLight(0x2a4a70, 0x06080c, 0.55);
    s.add(this.hemi);
    const moon = new THREE.DirectionalLight(0xa8c4ea, 1.0);
    const tgt = V(0, 0, 8);
    moon.position.copy(tgt).addScaledVector(MOON_DIR, -48);
    moon.target.position.copy(tgt);
    moon.castShadow = eng.quality.shadows;
    moon.shadow.mapSize.setScalar(Math.min(2048, eng.quality.shadowSize));
    const sc = moon.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 1;
    sc.far = 100;
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.04;
    s.add(moon, moon.target);
    this.aura = new THREE.PointLight(0x7fe0ff, 0, 24, 1.5);
    this.aura.position.set(0, 6, -15);
    this.backLight = new THREE.PointLight(0xa8f0ff, 0, 20, 1.4);
    this.backLight.position.set(0, 8.5, -22.6);
    this.spill = new THREE.PointLight(0x6ac8ff, 0, 26, 1.4);
    this.spill.position.set(0, 4.5, 21);
    this.scalesLight = new THREE.PointLight(0xffc27a, 0, 9, 1.8);
    this.scalesLight.position.set(0, 3.4, SCALES_Z + 1.6);
    s.add(this.aura, this.backLight, this.spill, this.scalesLight);
    // the roof (never drawn) only lets the moon in through the slits above the shafts
    const roof = new THREE.Group();
    const roofMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.mats.push(roofMat);
    // the slits: x from SLIT_X, over [z0, z1]; the moon comes in from +x, so the roof runs far out that side
    const slits: [number, number][] = [[16.5, 20.9], [7.5, 11.9], [-1.5, 2.9]];
    const zs = [-26, ...slits.flat(), 27];
    const roofBox = (x0: number, x1: number, z0: number, z1: number) => {
      const g = new THREE.BoxGeometry(x1 - x0, 0.6, z1 - z0);
      this.geos.push(g);
      const m = new THREE.Mesh(g, roofMat);
      m.position.set((x0 + x1) / 2, 18, (z0 + z1) / 2);
      m.castShadow = true;
      roof.add(m);
    };
    for (let i = 0; i + 1 < zs.length; i += 2) roofBox(-14, 36, zs[i], zs[i + 1]);
    for (const [z0, z1] of slits) {
      roofBox(-14, SLIT_X, z0, z1);
      roofBox(SLIT_X + 3.2, 36, z0, z1);
    }
    s.add(roof);
    // reflections environment: a dark vault with cold fire spots and one warm glow
    try {
      const env = new THREE.Scene();
      const sg = new THREE.SphereGeometry(10, 24, 12);
      const cols: number[] = [];
      const pos = sg.getAttribute('position');
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 10;
        c.setRGB(0.01, 0.025, 0.05).lerp(new THREE.Color(0.03, 0.07, 0.12), Math.max(0, y));
        cols.push(c.r, c.g, c.b);
      }
      sg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const em = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
      env.add(new THREE.Mesh(sg, em));
      const spot = new THREE.SphereGeometry(0.9, 8, 6);
      const blue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.8, 2.4) });
      const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.4, 0.5) });
      for (let k = 0; k < 6; k++) {
        const m = new THREE.Mesh(spot, blue);
        const a = (k / 6) * Math.PI * 2;
        m.position.set(Math.cos(a) * 8, 1.5, Math.sin(a) * 8);
        env.add(m);
      }
      const w = new THREE.Mesh(spot, warm);
      w.position.set(0, 5, -8);
      env.add(w);
      const pm = new THREE.PMREMGenerator(eng.renderer);
      this.envRT = pm.fromScene(env, 0.04);
      pm.dispose();
      s.environment = this.envRT.texture;
      s.environmentIntensity = 0.55;
      sg.dispose();
      spot.dispose();
      em.dispose();
      blue.dispose();
      warm.dispose();
    } catch (e) {
      console.warn('[trial] env', e);
    }
    await this.tick();

    // --- the gate and the terrace over the abyss
    const gateGeo = this.rigGeo('realm_gate');
    this.gate = new RigInstance(gateGeo, { ownMaterial: true });
    this.mats.push(this.gate.material);
    this.gate.root.position.set(0, 0, GATE_Z);
    s.add(this.gate.root);
    await this.tick();
    const stoneMat = makeVoxelMaterial();
    this.mats.push(stoneMat);
    const ter = this.stat('realm_terrace', [0.5, 1, 0]);
    this.mesh(ter.geo, stoneMat, V(0, 0, 30));
    await this.tick();

    // --- the hall: polished floor, columns, architraves, walls, dais, braziers
    const floorMat = makeVoxelMaterial({ transparent: true, opacity: 0.8 });
    this.mats.push(floorMat);
    const fl = this.stat('realm_floor', [0, 1, 0]);
    const floor = this.mesh(fl.geo, floorMat, V(0, 0, 0), { shadow: false });
    floor.renderOrder = 1;
    const colA = this.stat('realm_column_a');
    await this.tick();
    const colB = this.stat('realm_column_b');
    COL_Z.forEach((z, i) => {
      for (const sx of [1, -1]) this.mesh((i + (sx > 0 ? 0 : 1)) & 1 ? colB.geo : colA.geo, stoneMat, V(sx * COL_X, 0, z), { ry: i * 1.3 + sx, mirror: true });
    });
    const bl = this.stat('realm_beam_long', [0, 0, 0.5]);
    const bc = this.stat('realm_beam_cross', [0, 0, 0.5]);
    for (const sx of [1, -1]) for (let i = 0; i < 3; i++) this.mesh(bl.geo, stoneMat, V(sx * COL_X, 12, COL_Z[i + 1]), { ry: -Math.PI / 2 });
    for (const z of COL_Z) this.mesh(bc.geo, stoneMat, V(-COL_X, 13.2, z));
    await this.tick();
    this.wallMat = makeVoxelMaterial();
    this.mats.push(this.wallMat);
    const wa = this.stat('realm_wall_a', [0, 0, 4]);
    const wb = this.stat('realm_wall_b', [0, 0, 4]);
    await this.tick();
    for (let i = 0; i < 4; i++) {
      const z = 26 - i * 12.5;
      this.mesh(i & 1 ? wb.geo : wa.geo, this.wallMat, V(-10, 0, z), { ry: Math.PI / 2, shadow: false });
      this.mesh(i & 1 ? wa.geo : wb.geo, this.wallMat, V(10, 0, z), { ry: -Math.PI / 2, sx: -1, shadow: true });
    }
    const we = this.stat('realm_wall_end', [0, 0, 7]);
    this.mesh(we.geo, this.wallMat, V(-10, 0, -24), { shadow: false });
    await this.tick();
    const dais = this.stat('realm_dais', [0.5, 0, -30]);
    this.mesh(dais.geo, stoneMat, V(0, 0, -24), { mirror: true });
    const bz = this.stat('realm_brazier');
    const fireY = (bz.meta.fireY as number) ?? 1.7;
    for (const [x, z, k] of BRAZ) {
      this.mesh(bz.geo, stoneMat, V(x, 0, z), { scale: k, ry: x * 0.3, mirror: true });
      const light = new THREE.PointLight(0x5ab8ff, 0, k > 1 ? 20 : 15, 1.6);
      light.position.set(x, fireY * k + 0.6, z);
      s.add(light);
      this.braziers.push({ pos: V(x, 0, z), fire: V(x, fireY * k, z), scale: k, light, lit: 0, target: 0, acc: 0, flare: 0 });
    }
    await this.tick();

    // --- moonlight shafts down through the roof slits
    for (const [z0, z1] of slits) this.addShaft(V(SLIT_X, 18, z0), V(3.2, 0, 0), V(0, 0, z1 - z0), MOON_DIR.clone().multiplyScalar(18 / -MOON_DIR.y), 0x8fc0ff, 0.075);
    // the judgement shaft over the kneeling soul (wakes at the verdict)
    this.addShaft(V(-1.1, 19, KNEEL.z - 1.1), V(2.2, 0, 0), V(0, 0, 2.2), V(0.05, -19.5, 0.08), 0xfff0c8, 0.0);

    // --- the Scales of Ma'at
    const scGeo = this.rigGeo('realm_scales');
    this.scales = new RigInstance(scGeo, { ownMaterial: true });
    this.mats.push(this.scales.material);
    this.scales.root.position.set(0, 0, SCALES_Z);
    s.add(this.scales.root);
    this.scalesMirror = new RigInstance(scGeo, { material: this.scales.material });
    this.mirror.add(this.scalesMirror.root);
    await this.tick();

    // --- Anubis: obsidian core, luminous spirit shell, modelled eyes; and his reflection
    const anGeo = this.rigGeo('realm_anubis_soul', true, 2);
    this.anubis = new RigInstance(anGeo, { ownMaterial: true });
    this.mats.push(this.anubis.material);
    this.anubis.material.envMapIntensity = 1.4;
    this.anubis.root.position.copy(ANUBIS_AT);
    s.add(this.anubis.root);
    this.shell = spiritMaterial(0x0a5a8a, 0xa8f4ff, { inflate: 0.04, power: 3.2, core: 0.04, lumRim: 0, gain: 0.15, vein: 0.3 });
    this.mats.push(this.shell);
    this.anubisMirror = new RigInstance(anGeo, { material: this.anubis.material });
    this.mirror.add(this.anubisMirror.root);
    for (const r of [this.anubis, this.anubisMirror])
      anGeo.parts.forEach((p) => {
        const m = new THREE.Mesh(p.geo, this.shell);
        m.renderOrder = r === this.anubis ? 3 : 0;
        r.nodes[p.name].add(m);
      });
    const eye = this.stat('realm_anubis_eye', 'center');
    this.eyeMat = makeVoxelMaterial({ emissiveStrength: 0 });
    this.mats.push(this.eyeMat);
    for (const r of [this.anubis, this.anubisMirror])
      for (const side of ['eye_l', 'eye_r']) {
        const m = new THREE.Mesh(eye.geo, this.eyeMat);
        m.rotation.y = side === 'eye_l' ? 0.32 : -0.32;
        r.sockets[side]?.add(m);
        if (r === this.anubis) this.eyes.push(m);
      }
    await this.tick();

    // --- Sundown's soul: a faint core of his own bones inside a teal spirit shell
    this.soulCore = makeVoxelMaterial({ transparent: true, opacity: 0.32 });
    this.soulCore.userData.tint.value.setRGB(0.5, 1.2, 1.25);
    this.mats.push(this.soulCore);
    this.soulShell = spiritMaterial(0x0f6a5a, 0xb8fff0, { inflate: 0.012, power: 2.2, core: 0.5, lumRim: 1, gain: 1.1, vein: 0.6 });
    this.mats.push(this.soulShell);
    const shellGeos = soulShellGeos(this.playerGeo);
    this.soul = new RigInstance(this.playerGeo, { material: this.soulCore, castShadow: false });
    this.soulMirror = new RigInstance(this.playerGeo, { material: this.soulCore, castShadow: false });
    for (const r of [this.soul, this.soulMirror]) {
      this.playerGeo.parts.forEach((p, i) => {
        const m = new THREE.Mesh(shellGeos[i], this.soulShell);
        m.renderOrder = r === this.soul ? 4 : 0;
        r.nodes[p.name].add(m);
      });
      r.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === this.soulCore) o.renderOrder = r === this.soul ? 2 : 0;
      });
    }
    s.add(this.soul.root);
    this.mirror.add(this.soulMirror.root);
    await this.tick();

    // --- the dead: wraiths, reaching hands, wisps
    const wg = this.rigGeo('realm_wraith', true, 1);
    const hg = this.rigGeo('realm_spirit_hand', true, 1);
    const pg = this.rigGeo('realm_wisp', true, 1);
    const add = (kind: Spirit['kind'], geo: RigGeo, n: number, a: number, b: number, o: Parameters<typeof spiritMaterial>[2]) => {
      for (let i = 0; i < n; i++) {
        const mat = spiritMaterial(a, b, o);
        this.mats.push(mat);
        const rig = new RigInstance(geo, { material: mat as unknown as VoxelMaterial, castShadow: false });
        rig.root.traverse((q) => (q.renderOrder = 4));
        rig.root.scale.setScalar(kind === 'hand' ? 1.25 + rnd.next() * 0.5 : kind === 'wraith' ? 0.9 + rnd.next() * 0.35 : 1);
        s.add(rig.root);
        this.spirits.push({ kind, rig, mat, seed: i + rnd.next() * 0.5, pos: V(0, -50, 0), prev: V(0, -50, 0), vis: 0, rise: 0, home: V(0, 0, 0) });
      }
    };
    add('wraith', wg, 16, 0x0c4a70, 0xc8f4ff, { inflate: 0.01, power: 2.2, core: 0.3, gain: 0.5, vein: 0.4 });
    add('hand', hg, 8, 0x0c4a70, 0xd8f8ff, { inflate: 0.008, power: 2.2, core: 0.4, gain: 0.6, vein: 0.35 });
    add('wisp', pg, 28, 0x1a6aa0, 0xe8fcff, { inflate: 0.006, power: 1.8, core: 0.8, gain: 0.8, vein: 0.3 });
    // hands claw over the terrace edges and the gate's foot
    const homes = [V(-12.4, 0, 34), V(12.6, 0, 36.5), V(-11.8, 0, 40.5), V(12, 0, 42.5), V(-6, 0, 45.2), V(5.5, 0, 45.6), V(-9.5, 0, 30.6), V(9.2, 0, 30.6)];
    this.spirits.filter((q) => q.kind === 'hand').forEach((q, i) => q.home.copy(homes[i]));
    // reflections of the particle fire (the add layer, mirrored)
    for (const o of this.fx.group.children) {
      const src = o as THREE.Mesh;
      if (!(src.material as THREE.ShaderMaterial).blending || (src.material as THREE.ShaderMaterial).blending !== THREE.AdditiveBlending) continue;
      const r = new THREE.Mesh(src.geometry, src.material);
      r.frustumCulled = false;
      r.renderOrder = 0;
      this.mirror.add(r);
    }
    // the god's arm, for the fall through the sand (its geometry is shared with the reaping above)
    try {
      const spec = anubisArmRig();
      const ag = buildRigGeo(spec, 'anubis_arm:reap');
      for (const p of ag.parts) if (!p.geo.getAttribute('snormal')) spiritNormals(p.geo, p.model, p.pivot, spec.voxelSize, 2);
      const am = makeVoxelMaterial({ emissiveStrength: 1.6 });
      this.mats.push(am);
      this.armShell = spiritMaterial(0x0a4a7a, 0xa8f4ff, { inflate: 0.03, power: 3.6, core: 0, lumRim: 0, gain: 0.22, vein: 0.25 });
      this.mats.push(this.armShell);
      const a = new RigInstance(ag, { material: am, castShadow: false });
      ag.parts.forEach((p) => a.nodes[p.name].add(new THREE.Mesh(p.geo, this.armShell!)));
      a.root.visible = false;
      s.add(a.root);
      this.arm = a;
    } catch (e) {
      console.warn('[trial] arm', e);
    }
    this.tunnelLight = new THREE.PointLight(0x7fe8ff, 0, 11, 1.5);
    s.add(this.tunnelLight);
    // the moonlight comes in shaft by shaft as the soul enters the hall
    for (let i = 0; i < 3; i++) this.shafts[i].k = this.shafts[i].target = 0;
    this.ready = true;
  }

  /** build the realm ahead (in slices, while the reaping plays above); run() awaits the same build */
  prepare() {
    if (!this.building) {
      this.camera.aspect = this.engine.width / this.engine.height;
      this.camera.updateProjectionMatrix();
      this.building = this.build().then(() => {
        void this.engine.renderer.compileAsync?.(this.scene, this.camera)?.catch?.(() => {});
      });
    }
    return this.building;
  }

  private addShaft(O: THREE.Vector3, U: THREE.Vector3, Vv: THREE.Vector3, L: THREE.Vector3, color: number, density: number) {
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    geo.applyMatrix4(new THREE.Matrix4().makeBasis(U, Vv, L).setPosition(O));
    const mat = shaftMaterial(O, U, Vv, L, color, 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.geos.push(geo);
    this.mats.push(mat);
    this.shafts.push({ mesh, mat, O, U, V: Vv, L, k: density, target: density });
  }

  // =========================================================================== direction
  private hold(sec: number, skippable = true) {
    if (skippable && this.skipping) return Promise.resolve(true);
    return new Promise<boolean>((res) => this.waits.push({ at: this.t + sec, res: () => res(this.skipping), skippable }));
  }
  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }
  private setShot(fn: ShotFn, blend = 0) {
    this.from = { p: this.camera.position.clone(), l: this.camLook.clone(), fov: this.camera.fov };
    this.shot = fn;
    this.shotT = 0;
    this.blendDur = blend;
  }
  private sfx(id: string, volume = 0.8, pitch = 1) {
    if (!this.skipping) this.engine.audio.play(id, { volume, pitch });
  }

  /** a line floating in the world: Anubis speaks near his head, thoughts sit low, titles hang in the air */
  private async say(text: string, who: Line['who'], hold: number, skippable = true) {
    if (skippable && this.skipping) return;
    const ft = new FloatText3D(text, TEXT[who]);
    ft.anchor.copy(this.textAnchor(who));
    this.scene.add(ft.mesh);
    const line: Line = { ft, who, dying: false };
    this.lines.push(line);
    if (who === 'anubis') this.speak = 1;
    if (who !== 'title') this.sfx('divine_whisper', who === 'anubis' ? 0.65 : 0.4, who === 'anubis' ? 0.8 : 1.1);
    while (!ft.done && !(skippable && this.skipping)) await this.hold(0.1, skippable);
    if (who === 'anubis') this.speak = 0;
    await this.hold(hold, skippable);
    ft.show(false);
    line.dying = true;
  }
  private textAnchor(who: Line['who']) {
    const cam = this.camera;
    const dist = who === 'title' ? 14 : who === 'anubis' ? 7.5 : 6.5;
    const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * dist;
    const halfW = halfH * cam.aspect;
    let sx = 0, sy = who === 'title' ? 0.18 : -0.5;
    if (who === 'anubis' && this.anubis) {
      this.anubis.nodes['head'].getWorldPosition(this.v1);
      this.v1.y += 1;
      const ndc = this.v1.clone().project(cam);
      sx = ndc.z < 1 ? Math.max(-0.42, Math.min(0.42, ndc.x)) * 0.8 : 0;
      sy = 0.5;
    }
    const fwd = cam.getWorldDirection(this.v2);
    const right = V(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = V(0, 1, 0).applyQuaternion(cam.quaternion);
    return cam.position.clone().addScaledVector(fwd, dist).addScaledVector(right, sx * halfW).addScaledVector(up, sy * halfH);
  }

  /** the whole trial; resolves true when the soul is judged worthy */
  async run(stats: { kills: number; wave: number; final?: boolean; fromReaping?: boolean }): Promise<boolean> {
    const eng = this.engine;
    this.final = !!stats.final;
    await this.prepare();
    this.grade(true);
    this.loop = eng.audio.loop('underworld_loop', 0.7);
    eng.letterbox(true, 0.01);
    await this.arrival(stats);
    if (this.skipping) this.snapToJudgement();
    this.skipping = false;
    this.qte.hold = null;
    for (const l of this.lines) {
      l.ft.show(false);
      l.dying = true;
    }
    // weighed once already: no scales, only the god's last word
    if (this.final) return this.verdict(false, '"No feather this time. Lie down, cowboy. The desert keeps you."');

    // ---------------------------------------------------------------- the weighing
    this.setPhase('judge');
    this.setShot(this.shotJudge, 1.4);
    this.gwT = { present: 0, point: 1, reach: 0, grant: 0, raise: 0 };
    eng.audio.play('scales', { volume: 0.8 });
    eng.audio.play('heartbeat', { volume: 0.6 });
    await this.hold(1.0, false);
    // 1) the beam swings; its needle sweeps the gauge: stop it on the feather's mark
    const wave = stats.wave;
    const a = await this.qte.run({ kind: 'bar', label: 'WEIGH THE HEART', speed: 0.8 + Math.min(0.55, wave * 0.011), width: 0.15 - Math.min(0.04, wave * 0.0008), duration: 5, phase: -Math.PI / 2, at: () => this.needlePoint(-3.1) });
    if (a === 'fail') return this.verdict(false);
    this.weighed(a);
    this.gwT = { present: 1, point: 0, reach: 0, grant: 0, raise: 0 };
    await this.say('"Level… for now. Once more, as the feather falls."', 'anubis', 0.8, false);
    // 2) the feather drops its pan: strike as the beam comes level (the ring meets the sight)
    this.gwT = { present: 0, point: 1, reach: 0, grant: 0, raise: 0 };
    await this.hold(0.5, false);
    this.featherDrop = 0;
    const b = await this.qte.run({ kind: 'ring', key: 'Space', alt: ['Mouse0'], label: 'AS THE FEATHER FALLS', duration: 1.3 - Math.min(0.3, wave * 0.006), at: () => this.needlePoint() });
    this.featherDrop = -1;
    if (b !== 'fail') this.weighed(b);
    return this.verdict(b !== 'fail');
  }

  /** where the timing prompts float: on the needle of the scales (the gauge sits lower, under the beam it drives) */
  private needlePoint(dy = 0.4) {
    const n = this.scales?.nodes['plumb'];
    if (!n) return null;
    n.getWorldPosition(this.v2);
    return { x: this.v2.x, y: this.v2.y + dy, z: this.v2.z };
  }

  /** a good beat: the beam settles level, a sign flies from the soul's heart to the feather */
  private weighed(r: 'perfect' | 'good' | 'fail') {
    this.tiltTarget = 0;
    this.glyphsDone++;
    this.engine.audio.play('divine_chime', { volume: 0.6, pitch: r === 'perfect' ? 1.15 : 0.95 });
    this.wallPulse = r === 'perfect' ? 1.4 : 0.8;
    const from = { x: this.soulPos.x, y: this.soulPos.y + 1.1, z: this.soulPos.z };
    const to = V(-1.5, 2.8, SCALES_Z);
    for (let i = 0; i < (r === 'perfect' ? 3 : 1); i++)
      this.fx.emit({ pos: from, vel: { x: (to.x - from.x) * 1.1 + (i - 1) * 0.8, y: (to.y - from.y) * 1.1 + 1.5 + i * 0.4, z: (to.z - from.z) * 1.1 }, count: 1, life: [0.9, 0.9], size: [0.5, 0.35], sprite: 'glyph' + ((this.glyphsDone + i) % 4), color: 0xffe6a0, additive: true, gravity: 3 });
    this.fx.emit({ pos: from, count: r === 'perfect' ? 30 : 16, spread: 1.6, life: [0.4, 0.8], size: [0.12, 0.02], sprite: 'glow8', color: [0xffe6a0, 0x9ff8ff], additive: true, drag: 2 });
  }

  private async arrival(stats: { kills: number; wave: number; fromReaping?: boolean }) {
    const eng = this.engine;
    // ---------------------------------------------------------------- 0. the fall through the sand
    if (stats.fromReaping && this.arm) {
      this.setPhase('tunnel');
      this.soulMode = 'held';
      this.armLet = 0;
      this.armDrop = 0;
      this.arm.root.visible = true;
      this.setShot(this.shotTunnel, 0);
      this.tunnelLoop = eng.audio.loop('storm_loop', 0.55);
      this.sfx('sand_rise', 0.9, 0.55);
      this.sfx('whoosh_big', 0.8, 0.45);
      this.sfx('heartbeat', 0.5, 0.7);
      if (await this.hold(TUN_RELEASE)) return;
      // the fist opens over the abyss: let go
      this.armLet = 1;
      this.sfx('anubis_roar', 0.5, 0.6);
      this.sfx('divine_whisper', 0.6, 0.7);
      if (await this.hold(TUN_T - TUN_RELEASE)) return;
      this.tunnelLoop?.stop(1.2);
      this.tunnelLoop = null;
      this.sfx('thunder', 0.55, 0.55);
      this.rack = 0.8;
    }
    // ---------------------------------------------------------------- 1. descent
    this.setPhase('descent');
    this.soulMode = 'fall';
    this.setShot(this.shotDescent, stats.fromReaping ? 1.3 : 0);
    if (!stats.fromReaping) void eng.fadeIn(1.8);
    this.sfx('soul_leave', 0.6, 0.7);
    void this.say('…the sand gives way. Cold. Quiet. Falling.', 'narr', 1.4);
    if (await this.hold(5.6)) return;
    // ---------------------------------------------------------------- 2. the gate
    this.setPhase('gate');
    this.soulMode = 'walk';
    this.walkT = 0;
    this.burstLanding();
    this.setShot(this.shotGate, 1.0);
    this.sfx('jackal_howl', 0.45, 0.7);
    void this.say('The Gate of the West. The dead are watching.', 'narr', 1.2);
    if (await this.hold(2.6)) return;
    this.gateTarget = 1;
    this.sfx('quake_rumble', 0.9, 0.8);
    this.sfx('rock_crumble', 0.7, 0.7);
    this.sfx('door_creak', 0.7, 0.55);
    this.shake = 0.5;
    // down at the soul's heels, looking up the doors as they part and the cold light spills out
    this.setShot(this.shotGateHero, 0.9);
    this.rack = 1;
    if (await this.hold(1.4)) return;
    this.sfx('divine_power', 0.55, 0.45);
    this.sfx('jackal_howl', 0.35, 0.55);
    if (await this.hold(2.4)) return;
    // ---------------------------------------------------------------- 3. into the hall
    this.setPhase('hall');
    this.fireSeq = true;
    this.setShot(this.shotHallFires, 1.2);
    this.rack = 0.9;
    this.sfx('whoosh_big', 0.5, 0.6);
    // the spirit fires wake pair by pair down the hall, then the moon comes through the roof slits
    for (let i = 0; i < 2; i++) {
      if (await this.hold(i ? 0.6 : 0.8)) return;
      this.ignite(i * 2, 0.75 + i * 0.15);
      this.ignite(i * 2 + 1, 0.8 + i * 0.15);
    }
    for (let i = 0; i < 3; i++) {
      if (await this.hold(0.45)) return;
      this.shafts[i].target = 0.075;
      this.sfx('divine_chime', 0.35, 0.6 + i * 0.12);
    }
    if (await this.hold(0.5)) return;
    this.setShot(this.shotFollow, 1.4);
    if (await this.hold(2.6)) return;
    this.setShot(this.shotCrane, 0);
    this.rack = 0.7;
    this.sfx('divine_whisper', 0.4, 0.8);
    void this.say('THE HALL OF TWO TRUTHS', 'title', 1.6);
    if (await this.hold(4.6)) return;
    // ---------------------------------------------------------------- 4. Anubis wakes
    this.setPhase('throne');
    this.setShot(this.shotHero, 0);
    this.braziers[4].target = this.braziers[5].target = 1;
    this.sfx('whoosh_big', 0.7, 0.5);
    if (await this.hold(1.0)) return;
    this.wakeTarget = 1;
    this.sfx('divine_power', 0.5, 0.6);
    if (await this.hold(1.1)) return;
    this.roar = 1;
    this.sfx('anubis_roar', 0.8, 0.9);
    this.shake = 0.35;
    if (await this.hold(2.0)) return;
    this.setShot(this.shotSpeech, 1.6);
    this.rack = 0.6;
    this.gwT.present = 1;
    if (this.final) {
      await this.say('"Bones of the West. Again."', 'anubis', 1.0);
      if (this.skipping) return;
      this.gwT.present = 0;
      this.gwT.point = 1;
      await this.say('"Your heart was weighed once already. The desert keeps you."', 'anubis', 1.4);
      return;
    }
    await this.say('"Bones of the West. You died with your boots on."', 'anubis', 1.2);
    if (this.skipping) return;
    this.gwT.present = 0;
    this.gwT.point = 1;
    await this.say(`"${stats.kills} souls sent ahead of you. Let us weigh your heart against the feather."`, 'anubis', 1.4);
  }

  /** a spirit fire flares awake: a pillar of cold sparks, a flash on its light, a rising whoosh */
  private ignite(i: number, pitch: number) {
    const b = this.braziers[i];
    if (!b) return;
    b.target = 1;
    b.lit = Math.max(b.lit, 0.06);
    b.flare = 1;
    this.sfx('whoosh', 0.6, pitch);
    this.fx.emit({ pos: { x: b.fire.x, y: b.fire.y + 0.3, z: b.fire.z }, vel: { x: 0, y: 7, z: 0 }, count: 40, spread: 1.4, life: [0.5, 1.1], size: [0.14, 0.02], sprite: ['spark', 'glow8', 'dot4'], color: [0x6fd0ff, 0xd8f8ff, 0xffffff], additive: true, drag: 1.4, gravity: -1, stretch: 0.06 });
  }

  /** skipping the arrival: everything stands where the judgement expects it */
  private snapToJudgement() {
    if (this.arm) this.arm.root.visible = false;
    this.tunnelLoop?.stop(0.3);
    this.tunnelLoop = null;
    if (this.tunnelLight) this.tunnelLight.intensity = 0;
    for (let i = 0; i < 3; i++) this.shafts[i].target = this.shafts[i].k = 0.075;
    this.rack = 0;
    this.gateOpen = this.gateTarget = 1;
    for (const b of this.braziers) b.lit = b.target = 1;
    this.wake = this.wakeTarget = 1;
    this.walkT = 1;
    this.soulMode = 'kneel';
    this.soulPos.copy(KNEEL);
    this.engine.fadeIn(0.4);
    for (const l of this.lines) l.ft.skipTyping();
  }

  private async verdict(ok: boolean, line?: string) {
    const eng = this.engine;
    if (ok) {
      this.setPhase('grant');
      this.setShot(this.shotGrant, 0.6);
      this.gwT = { present: 0, point: 0, reach: 0, grant: 1, raise: 1 };
      this.tiltTarget = 0;
      eng.audio.play('divine_power', { volume: 0.9 });
      eng.audio.play('divine_chime', { volume: 0.7 });
      this.fireTintTarget.set(0xffe2a0);
      this.shafts[3].target = 0.1;
      this.shake = 0.4;
      eng.flash(0xbff8ff, 0.35, 0.8);
      void this.say('"Your heart is light as the feather. Go back. Finish your hunt."', 'anubis', 1.6, false);
      await this.hold(1.3, false);
      this.soulMode = 'rise';
      eng.audio.play('resurrect', { volume: 0.9 });
      await this.hold(2.6, false);
      eng.flash(0xffffff, 0.8, 1.0);
    } else {
      this.setPhase('take');
      this.setShot(this.shotTake, 0.6);
      this.gwT = { present: 0, point: 0, reach: 1, grant: 0, raise: 0 };
      this.anger = 1;
      this.tiltTarget = -0.34;
      eng.audio.play('sting_negative', { volume: 0.9 });
      eng.audio.play('anubis_roar', { volume: 0.7, pitch: 0.75 });
      this.fireTintTarget.set(0x5a2a8a);
      eng.flash(0xff2a1a, 0.3, 0.6);
      void this.say(line ?? '"Heavy. So heavy. Ammit is hungry tonight."', 'anubis', 0.8, false);
      await this.hold(1.6, false);
      this.soulMode = 'dissolve';
      eng.audio.play('soul_leave', { volume: 0.9, pitch: 0.7 });
      await this.hold(2.6, false);
    }
    await eng.fadeOut(0.8, ok ? '#e8fbff' : '#000');
    this.grade(false);
    eng.letterbox(false, 0.3);
    this.loop?.stop(0.6);
    return ok;
  }

  /** the grade and bloom of the realm of spirits (restored on the way out) */
  private grade(on: boolean) {
    const eng = this.engine;
    const u = eng.post.u;
    const bl = eng.post.bloom;
    if (on) {
      this.saved = {
        spirit: u.uSpirit.value, desat: u.uDesat.value, vig: u.uVignette.value, sat: u.uSaturation.value, grain: u.uGrain.value,
        tS: u.uTintShadows.value.clone(), tH: u.uTintHighlights.value.clone(), bloom: [bl.strength, bl.radius, bl.threshold], con: u.uContrast.value,
      };
      u.uSpirit.value = 0.08;
      u.uDesat.value = 0;
      u.uVignette.value = 0.55;
      u.uSaturation.value = 1.06;
      u.uGrain.value = 0.03;
      u.uTintShadows.value.set(0.94, 1.0, 1.08);
      u.uTintHighlights.value.set(1.06, 1.0, 0.93);
      u.uContrast.value = 1.14;
      bl.strength = 0.26;
      bl.radius = 0.4;
      bl.threshold = 1.05;
    } else if (this.saved.bloom) {
      u.uRadial.value = 0;
      const sv = this.saved;
      u.uSpirit.value = 0;
      u.uDesat.value = sv.desat;
      u.uVignette.value = sv.vig;
      u.uSaturation.value = sv.sat;
      u.uGrain.value = sv.grain;
      u.uContrast.value = sv.con;
      u.uTintShadows.value.copy(sv.tS);
      u.uTintHighlights.value.copy(sv.tH);
      [bl.strength, bl.radius, bl.threshold] = sv.bloom;
      this.saved = {};
    }
  }

  // =========================================================================== shots
  private soulY(t: number) {
    const k = Math.min(1, t / 5.6);
    return mixN(30, LAND.y, 1 - Math.pow(1 - k, 2.4));
  }
  // ---------------------------------------------------------------- the fall through the sand
  private tunnelY(tt: number) {
    return mixN(TUN_Y0, TUN_Y1, Math.pow(Math.min(1, tt / TUN_T), 1.15));
  }
  /** above the god's fist, looking down the forearm into the dark as the sand spirals past */
  private shotTunnel: ShotFn = (t) => {
    const c = V(0, this.tunnelY(t), LAND.z);
    const sp = t * 0.8 + 0.6;
    const r = 2.4 + sstep(1.6, TUN_T, t) * 1.6;
    return { p: c.clone().add(V(Math.cos(sp) * r, 3.6 + t * 0.3, Math.sin(sp) * r)), l: c.clone().add(V(0, -2.6 + sstep(1.8, TUN_T, t) * 1.6, 0)), fov: mixN(84, 64, sstep(0, 1.4, t)) };
  };
  /** the arm, the sand walls, the motes; after the release the fist drops away into the abyss */
  private updateTunnel(dt: number, t: number) {
    const a = this.arm;
    const L = this.tunnelLight;
    if (a?.root.visible) {
      const n = a.nodes;
      const k = this.armLet;
      if (this.phase === 'tunnel' && k === 0) {
        // carry: the fist (with the soul in it) holds the centre of the shaft, turning slowly
        a.root.position.set(0, 0, 0);
        a.root.rotation.set(0, t * 0.6, 0);
        a.root.updateMatrixWorld(true);
        a.sockets['grip'].getWorldPosition(this.v1);
        a.root.position.set(-this.v1.x, this.tunnelY(this.phaseT) - this.v1.y, LAND.z - this.v1.z);
      } else {
        // let go: the hand springs open and the arm drops away into the dark
        this.armDrop += dt;
        a.root.position.y -= (5 + this.armDrop * 34) * dt;
        if (this.armDrop > 2.5) a.root.visible = false;
      }
      const curl = k ? -0.25 : 1.12, thumb = k ? -0.2 : 0.95;
      n['palm']?.rotation.set(damp(n['palm'].rotation.x, k ? -0.45 : 0.2, 8, dt), 0, 0);
      for (let f = 1; f <= 4; f++)
        for (let j = 1; j <= 3; j++) {
          const q = n[`f${f}_${j}`];
          if (!q) continue;
          const rest = a.geo.parts[a.geo.index[`f${f}_${j}`]].rest;
          q.rotation.set(damp(q.rotation.x, rest.x + curl * (j === 1 ? 0.9 : 1.1), 10, dt), rest.y, rest.z);
        }
      for (let j = 1; j <= 3; j++) {
        const q = n[`t_${j}`];
        if (!q) continue;
        const rest = a.geo.parts[a.geo.index[`t_${j}`]].rest;
        q.rotation.set(damp(q.rotation.x, rest.x + thumb * (j === 1 ? 0.5 : 0.8), 10, dt), rest.y - thumb * (j === 1 ? 0.6 : 0), rest.z - (j === 1 ? thumb * 0.7 : 0));
      }
      if (this.armShell) this.armShell.uniforms.uGain.value = 0.22 * (1 - sstep(0.6, 2.2, this.armDrop));
    }
    if (this.phase !== 'tunnel') {
      if (L) L.intensity = damp(L.intensity, 0, 2, dt);
      return;
    }
    const tt = this.phaseT;
    const k = tt / TUN_T;
    const cy = this.camera.position.y;
    const dens = 1 - sstep(0.62, 1, k);
    if (L) {
      L.position.set(0, this.soulPos.y + 1.2, LAND.z);
      L.intensity = 9 * (0.6 + 0.4 * Math.sin(t * 7)) * (1 - sstep(0.8, 1, k) * 0.7);
    }
    // the first moments: the same buried, brown dark the reaping dived into
    if (tt < 0.5) {
      const f = this.cf;
      for (let i = 0; i < Math.floor(dt * 160 * (1 - tt * 2)) + 1; i++) {
        const q = this.v1.copy(this.camera.position).addScaledVector(f, 0.6 + rnd.next() * 1.4).addScaledVector(this.cr, (rnd.next() - 0.5) * 2).addScaledVector(this.cu, (rnd.next() - 0.5) * 1.4);
        this.fx.emit({ pos: q, vel: { x: 0, y: 8, z: 0 }, count: 1, life: [0.2, 0.45], size: [0.7, 1.5], sprite: ['puff0', 'puff1', 'puff2'], color: [0x5a4630, 0x4a3826, 0x3a2c1e], alpha: 0.85, drag: 1 });
      }
    }
    // the walls: grains spiralling up past us as we fall, widening and thinning as the shaft opens
    const n = Math.floor(dt * 1000 * dens) + (rnd.next() < (dt * 1000 * dens) % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const ang = rnd.next() * Math.PI * 2, r = 2.6 + rnd.next() * 2.2 + k * 5;
      const y = cy + 1 - rnd.next() * 16;
      const tx = -Math.sin(ang), tz = Math.cos(ang);
      this.fx.emit({ pos: { x: Math.cos(ang) * r, y, z: LAND.z + Math.sin(ang) * r }, vel: { x: tx * 6, y: 15, z: tz * 6 }, count: 1, life: [0.4, 0.9], size: [0.06, 0.13], sprite: ['streak', 'dot3', 'dot4', 'grain1'], color: TSAND, stretch: 0.05, drag: 0.3 });
    }
    // the sand walls proper: big clouds turning round the shaft
    const m = Math.floor(dt * 70 * dens) + (rnd.next() < (dt * 70 * dens) % 1 ? 1 : 0);
    for (let i = 0; i < m; i++) {
      const ang = rnd.next() * Math.PI * 2, r = 3.4 + rnd.next() * 2.4 + k * 5;
      this.fx.emit({ pos: { x: Math.cos(ang) * r, y: cy - 2 - rnd.next() * 13, z: LAND.z + Math.sin(ang) * r }, vel: { x: -Math.sin(ang) * 4, y: 12, z: Math.cos(ang) * 4 }, count: 1, life: [0.9, 1.5], size: [1.8, 3.6], sprite: ['puff0', 'puff2', 'cloud1', 'cloud2'], color: [0x5a4630, 0x6a5238, 0x7a5e40, 0x4a3826], alpha: 0.62, rot: 3, rotSpeed: 1.2 });
    }
    // spirit motes, more of them the deeper we go
    if (rnd.next() < dt * (12 + 40 * k)) {
      const ang = rnd.next() * Math.PI * 2, r = 1 + rnd.next() * 4;
      this.fx.emit({ pos: { x: Math.cos(ang) * r, y: cy - 2 - rnd.next() * 10, z: LAND.z + Math.sin(ang) * r }, vel: { x: 0, y: 6 + rnd.next() * 4, z: 0 }, count: 1, life: [0.8, 1.6], size: [0.1, 0.02], sprite: ['glow8', 'dot3'], color: [0x6fd8ff, 0xc8f8ff, 0x7ff0e0], additive: true, drag: 0.4 });
    }
    // breaking out of the sand into the open dark: the walls burst outward
    if (k > 0.7 && k - dt / TUN_T <= 0.7) {
      for (let i = 0; i < 60; i++) {
        const ang = (i / 60) * Math.PI * 2;
        this.fx.emit({ pos: { x: Math.cos(ang) * 4, y: cy - 3, z: LAND.z + Math.sin(ang) * 4 }, vel: { x: Math.cos(ang) * 9, y: 4, z: Math.sin(ang) * 9 }, count: 2, life: [0.8, 1.5], size: [0.06, 0.1], sprite: ['dot3', 'grain0'], color: TSAND, drag: 1.2, gravity: 4 });
      }
      this.shake = Math.max(this.shake, 0.3);
    }
  }

  /** at the soul's heels, low, looking up the doors as they part; a slow push in */
  private shotGateHero: ShotFn = (t) => {
    const u = sstep(0, 1, t / 4.4);
    const z = this.soulPos.z;
    return { p: V(1.05 - 0.3 * u, 0.3 + 0.12 * u, z + 2.5 - 0.7 * u), l: V(-0.2, 6.6 + 0.8 * u, GATE_Z), fov: mixN(66, 55, u) };
  };
  /** low in the aisle as the spirit fires wake down the hall, the soul walking past us into it */
  private shotHallFires: ShotFn = (t) => {
    const u = sstep(0, 1, t / 3.4);
    return { p: V(0.9, 1.0, 23.8).lerp(V(0.6, 1.3, 21.6), u), l: V(0, 2.5 + u * 0.4, -6), fov: mixN(52, 47, u) };
  };

  private shotDescent: ShotFn = (t) => {
    const k = Math.min(1, t / 5.6);
    const y = this.soulY(t);
    const up = sstep(0.62, 1, k);
    return {
      p: V(2.6 - 0.7 * k + Math.sin(t * 0.5) * 0.4, Math.max(1.1, y + 2.6 + 2.4 * (1 - k)), 42.6 + 0.6 * (1 - k)),
      l: V(0, y + 0.5, 37).lerp(V(0, 12, 28), up),
      fov: mixN(50, 44, k),
    };
  };
  private shotGate: ShotFn = (t) => {
    const u = sstep(0, 1, t / 7);
    return { p: V(3.6 - 0.8 * u, 0.95 + 0.1 * u, 45.5 - 1.2 * u), l: V(-0.4, 7.4 - 0.4 * u, GATE_Z), fov: mixN(60, 57, u) };
  };
  private shotFollow: ShotFn = () => {
    const s = this.soulPos;
    return { p: V(s.x + 1.1, s.y + 1.75, s.z + 4.8), l: V(s.x, s.y + 1.4, s.z - 10), fov: 52 };
  };
  private shotCrane: ShotFn = (t) => {
    const u = sstep(0, 1, t / 4.6);
    return { p: V(-1.9, 0.8, 9.8).lerp(V(-2.0, 8.0, 7.8), u), l: V(0, 2.4, 0).lerp(V(0, 6.6, -19), u), fov: mixN(54, 50, u) };
  };
  private shotHero: ShotFn = (t) => {
    const u = sstep(0, 1, t / 4.2);
    return { p: V(3.6, 0.5, -9.0).lerp(V(3.0, 0.7, -10.5), u), l: V(0, 7.4, -19.4), fov: mixN(44, 40, u) };
  };
  private shotSpeech: ShotFn = (t) => {
    const u = sstep(0, 1, t / 8);
    return { p: V(2.0, 2.1, -3.4).lerp(V(1.6, 2.3, -4.2), u), l: V(0.2, 6.6, -18), fov: 44 };
  };
  private shotJudge: ShotFn = (t) => {
    return { p: V(Math.sin(t * 0.3) * 0.25 + this.tilt * 1.5, 2.7, -1.6), l: V(this.tilt * 0.8, 4.5, -14), fov: 56 };
  };
  private shotGrant: ShotFn = (t) => {
    const u = sstep(0, 1, t / 4);
    const s = this.soulPos;
    return { p: V(2.7, 0.5, -4.4).lerp(V(3.8, 1.4, -2.4), u), l: V(0, s.y + 1.4, s.z), fov: mixN(44, 54, u) };
  };
  private shotTake: ShotFn = (t) => {
    const u = sstep(0, 1, t / 4);
    return { p: V(-3.9, 9.4, -15.6).lerp(V(-2.9, 7.2, -12.6), u), l: V(0, 1.1, KNEEL.z), fov: mixN(46, 40, u) };
  };

  private burstLanding() {
    if (this.skipping) return;
    const p = LAND;
    this.fx.emit({ pos: { x: p.x, y: 0.15, z: p.z }, count: 40, spread: 3.2, up: 0.4, life: [0.6, 1.4], size: [0.32, 0.05], sprite: 'glow16', color: [0x6fe8ff, 0xb8fff4], additive: true, drag: 2.2, gravity: -0.2 });
    this.fx.emit({ pos: { x: p.x, y: 0.1, z: p.z }, count: 26, spread: 2.2, up: 0.6, life: [0.8, 1.6], size: [0.1, 0.3], sprite: ['puff0', 'puff1', 'puff2'], color: 0x5a6a78, alpha: 0.45, drag: 2.5, gravity: -0.3 });
    this.sfx('sand_rise', 0.5, 0.7);
  }

  // =========================================================================== frame
  /** testing aid: plays the trial faster (headless captures) */
  timeScale = 1;

  update(rdt: number) {
    const dt = Math.min(rdt, 0.1) * this.timeScale;
    this.t += dt;
    this.phaseT += dt;
    // waits
    for (let i = this.waits.length - 1; i >= 0; i--) {
      const w = this.waits[i];
      if (this.t >= w.at || (this.skipping && w.skippable)) {
        this.waits.splice(i, 1);
        w.res();
      }
    }
    if (!this.ready) return;
    const eng = this.engine;
    const intro = this.phase === 'tunnel' || this.phase === 'descent' || this.phase === 'gate' || this.phase === 'hall' || this.phase === 'throne';
    // HOLD to skip: a stray tap never throws the arrival away
    // (touch: a finger held still on the screen)
    const held = eng.input.isDown('Space') || eng.input.isDown('Escape') || eng.input.isDown('Enter') || eng.input.touchHolding;
    this.skipHold = intro && held && !this.skipping ? this.skipHold + rdt : 0;
    this.qte.hold = this.skipHold > 0.08 ? { label: 'HOLD TO SKIP', k: Math.min(1, this.skipHold / 0.9) } : null;
    if (intro && !this.skipping && this.skipHold >= 0.9) {
      this.skipping = true;
      this.qte.hold = null;
      for (const w of this.waits.splice(0)) w.res();
    }
    // a rack-focus pull on the big cuts: the frame swims in toward its subject
    this.rack = damp(this.rack, 0, 1.5, rdt);
    eng.post.u.uRadial.value = this.rack * 0.55;
    const t = this.t;
    this.updateTunnel(dt, t);
    this.updateGate(dt);
    this.updateFire(dt, t);
    this.updateSoul(dt, t);
    this.updateAnubis(dt, t);
    this.updateScales(dt, t);
    this.updateSpirits(dt, t);
    this.updateAtmos(dt, t);
    this.updateCamera(dt, t);
    this.updateText(dt);
    this.fx.update(dt, this.scene.fog as THREE.Fog);
  }

  private updateGate(dt: number) {
    const prev = this.gateOpen;
    this.gateOpen = this.skipping ? this.gateTarget : Math.min(this.gateTarget, this.gateOpen + dt / 4.2);
    const k = this.gateOpen * this.gateOpen * (3 - 2 * this.gateOpen);
    const n = this.gate.nodes;
    if (n['door_l']) n['door_l'].rotation.y = -1.72 * k;
    if (n['door_r']) n['door_r'].rotation.y = 1.72 * k;
    this.gate.material.userData.emissiveStrength.value = 0.12 + 1.5 * k + (this.phase === 'gate' ? 0.25 * Math.sin(this.t * 3) * k : 0);
    this.spill.intensity = 70 * k;
    if (this.gateOpen > prev && this.gateOpen < 1 && !this.skipping) {
      // grinding dust off the lintel, a cold breath out of the doorway
      if (rnd.next() < dt * 30) this.fx.emit({ pos: { x: (rnd.next() - 0.5) * 6, y: 9.2, z: GATE_Z + 1.4 }, count: 2, spread: 0.3, life: [1.0, 1.8], size: [0.07, 0.05], sprite: ['grain0', 'grain1', 'grain2', 'pebble'], color: [0x8a8478, 0x5a5650], gravity: 7 });
      if (rnd.next() < dt * 12) this.fx.emit({ pos: { x: (rnd.next() - 0.5) * 5, y: 0.3, z: GATE_Z + 1.5 }, count: 2, spread: 0.8, up: 0.5, life: [1.2, 2.2], size: [0.2, 0.7], sprite: ['puff0', 'puff1', 'puff3'], color: 0x6a7884, alpha: 0.35, drag: 1.5, gravity: -0.15 });
      if (rnd.next() < dt * 40 * k) this.fx.emit({ pos: { x: (rnd.next() - 0.5) * 5, y: 0.5 + rnd.next() * 7, z: GATE_Z - 1 }, vel: { x: 0, y: 0.3, z: 6 }, count: 1, spread: 1.2, life: [0.8, 1.6], size: [0.12, 0.02], sprite: 'glow8', color: [0x6fd8ff, 0xc8f8ff], additive: true, drag: 0.6, stretch: 0.15 });
      this.shake = Math.max(this.shake, 0.12);
    }
  }

  private updateFire(dt: number, t: number) {
    // braziers light as the soul passes them
    if ((this.phase === 'hall' || this.phase === 'gate') && !this.fireSeq)
      for (let i = 0; i < 4; i++) if (this.soulPos.z < this.braziers[i].pos.z + 7.5 && this.braziers[i].target === 0) {
        this.braziers[i].target = 1;
        this.sfx('whoosh', 0.55, 0.6 + i * 0.05);
      }
    this.fireTint.lerp(this.fireTintTarget, 1 - Math.exp(-2.5 * dt));
    const tint = this.fireTint;
    const fade = this.phase === 'take' ? 0.35 : 1;
    for (const b of this.braziers) {
      const was = b.lit;
      b.lit = damp(b.lit, b.target, 3, dt);
      if (was < 0.05 && b.lit >= 0.05 && !this.skipping)
        this.fx.emit({ pos: { x: b.fire.x, y: b.fire.y + 0.2, z: b.fire.z }, count: 30, spread: 1.6 * b.scale, up: 2, life: [0.4, 0.9], size: [0.3 * b.scale, 0.04], sprite: ['dot6', 'glow16'], color: [0x6fd0ff, 0xd8f8ff], additive: true, drag: 2.4, gravity: -1.5 });
      const fl = 1 + Math.sin(t * 11 + b.pos.x * 3) * 0.08 + Math.sin(t * 23 + b.pos.z) * 0.05;
      b.light.color.copy(tint);
      b.flare = damp(b.flare, 0, 2.5, dt);
      b.light.intensity = b.lit * (b.scale > 1 ? 34 : 18) * fl * fade * (1 + this.blaze * 0.4) * (1 + b.flare * 2.5);
      if (b.lit < 0.02) continue;
      const s = b.scale;
      b.acc += dt * 34 * b.lit * s * fade;
      while (b.acc >= 1) {
        b.acc -= 1;
        const r = rnd.next() * 0.32 * s, a = rnd.next() * Math.PI * 2;
        const core = rnd.next() < 0.3;
        this.fx.emit({
          pos: { x: b.fire.x + Math.cos(a) * r, y: b.fire.y + 0.05, z: b.fire.z + Math.sin(a) * r },
          vel: { x: Math.sin(t * 3 + b.pos.x) * 0.2, y: (1.1 + rnd.next() * 0.8) * s, z: 0 },
          count: 1, spread: 0.18 * s, life: [0.3, 0.7],
          size: core ? [0.26 * s, 0.05 * s] : [0.16 * s, 0.02 * s],
          sprite: core ? 'glow16' : rnd.next() < 0.5 ? 'dot4' : 'dot6',
          color: core ? tint.clone().lerp(new THREE.Color(1, 1, 1), 0.55).getHex() : tint.getHex(),
          additive: true, drag: 1.4, gravity: -1.2,
        });
      }
      if (rnd.next() < dt * 6 * b.lit) this.fx.emit({ pos: { x: b.fire.x, y: b.fire.y + 0.3 * s, z: b.fire.z }, count: 1, spread: 0.5, up: 1.6 * s, life: [0.9, 1.8], size: [0.03, 0.012], sprite: 'spark', color: 0xbff4ff, additive: true, drag: 0.7, gravity: -0.4, stretch: 0.05 });
    }
  }

  // ---------------------------------------------------------------- the soul
  private updateSoul(dt: number, t: number) {
    const p = this.soulPos;
    switch (this.phase) {
      case 'tunnel':
        p.set(0, this.tunnelY(this.phaseT), LAND.z);
        break;
      case 'descent':
        p.set(Math.sin(t * 0.7) * 0.3, this.soulY(this.phaseT), LAND.z);
        break;
      case 'gate':
      case 'hall':
      case 'throne': {
        // drift across the terrace, through the opened gate, down the hall to kneel
        if (this.phase === 'gate') this.walkT = Math.min(0.06, this.walkT + dt * 0.012);
        else this.walkT = Math.min(1, this.walkT + dt / 10.5);
        const k = this.walkT;
        const e = k < 0.06 ? k : 0.06 + (1 - Math.pow(1 - (k - 0.06) / 0.94, 1.6)) * 0.94;
        p.lerpVectors(LAND, KNEEL, e);
        p.y = mixN(0.35 + Math.sin(t * 1.6) * 0.07, KNEEL.y, sstep(0.9, 1, k));
        if (k >= 1) this.soulMode = 'kneel';
        break;
      }
      case 'grant':
        if (this.soulMode === 'rise') p.y = damp(p.y, 6.5, 0.55, dt);
        break;
      case 'take':
        if (this.soulMode === 'dissolve') {
          this.soulFade = Math.max(0, this.soulFade - dt * 0.42);
          p.y = damp(p.y, 1.2, 1.2, dt);
          p.z = damp(p.z, KNEEL.z - 1.2, 0.6, dt);
        }
        break;
    }
    const r = this.soul.root;
    if (this.phase === 'tunnel' && this.soulMode === 'held' && this.arm) {
      // across the god's palm, head out of the thumb side
      this.arm.root.updateMatrixWorld(true);
      this.heldM.compose(V(-0.86, 0, 0.05), this.heldQ.setFromEuler(new THREE.Euler(0.15, 0.2, -Math.PI / 2)), V(1, 1, 1));
      this.heldM.premultiply(this.arm.sockets['grip'].matrixWorld);
      this.heldM.decompose(r.position, r.quaternion, this.v2);
      r.scale.setScalar(1);
      if (this.armLet > 0) this.soulMode = 'fall';
    } else if (this.phase === 'tunnel' || (this.phase === 'descent' && this.phaseT < 1.2)) {
      // let go: tumble upright into the fall (easing out of the grip, no pop)
      r.position.lerp(p, 1 - Math.exp(-6 * dt));
      this.heldQ.setFromEuler(new THREE.Euler(Math.sin(t * 0.9) * 0.15, Math.sin(t * 0.4) * 0.6, 0));
      r.quaternion.slerp(this.heldQ, 1 - Math.exp(-3 * dt));
    } else {
      r.position.copy(p);
      r.rotation.y = this.phase === 'descent' ? Math.sin(t * 0.4) * 0.6 : Math.PI;
      r.rotation.x = this.phase === 'descent' ? Math.sin(t * 0.9) * 0.15 : 0;
      r.rotation.z = 0;
    }
    const n = this.soul.nodes;
    const set = (k: string, x: number, y = 0, z = 0, l = 5) => {
      const q = n[k];
      if (!q) return;
      q.rotation.set(damp(q.rotation.x, x, l, dt), damp(q.rotation.y, y, l, dt), damp(q.rotation.z, z, l, dt));
    };
    const m = this.soulMode;
    if (m === 'held') {
      // thrashing in the grip
      const ph = t * 9;
      set('arm_l', -2.7 + Math.sin(ph) * 0.45, 0, 0.45 + Math.sin(ph * 0.7) * 0.3, 9);
      set('arm_r', -2.3 + Math.sin(ph + 1.3) * 0.45, 0, -0.65 - Math.sin(ph * 0.8) * 0.3, 9);
      set('thigh_l', -0.35 + Math.sin(ph + 2) * 0.5, 0, 0, 9);
      set('thigh_r', 0.25 - Math.sin(ph + 2.4) * 0.5, 0, 0, 9);
      set('shin_l', 0.65, 0, 0, 9);
      set('shin_r', 0.35, 0, 0, 9);
      set('head', -0.55 + Math.sin(ph * 0.6) * 0.15, 0, 0, 9);
      set('torso', -0.25, 0, 0, 9);
    } else if (m === 'fall') {
      set('arm_l', -0.4, 0, 2.3 + Math.sin(t * 2) * 0.15);
      set('arm_r', -0.4, 0, -2.3 - Math.sin(t * 2.1) * 0.15);
      set('fore_l', -0.5);
      set('fore_r', -0.5);
      set('thigh_l', -0.5 + Math.sin(t * 1.3) * 0.2);
      set('thigh_r', -0.2 - Math.sin(t * 1.3) * 0.2);
      set('shin_l', 0.9);
      set('shin_r', 0.6);
      set('head', -0.35);
      set('torso', -0.15);
    } else if (m === 'walk') {
      const ph = t * 2.2;
      set('thigh_l', -Math.sin(ph) * 0.32 - 0.1);
      set('thigh_r', Math.sin(ph) * 0.32 - 0.1);
      set('shin_l', 0.25 + Math.max(0, Math.sin(ph + 1.4)) * 0.5);
      set('shin_r', 0.25 + Math.max(0, Math.sin(ph + 1.4 + Math.PI)) * 0.5);
      set('arm_l', Math.sin(ph) * 0.2, 0, 0.28);
      set('arm_r', -Math.sin(ph) * 0.2, 0, -0.28);
      set('fore_l', -0.35);
      set('fore_r', -0.35);
      set('torso', 0.06, Math.sin(ph) * 0.05, 0);
      set('head', this.phase === 'throne' ? -0.25 : 0.05, Math.sin(t * 0.5) * 0.25);
    } else if (m === 'kneel') {
      set('thigh_l', -1.4, 0, 0, 3);
      set('shin_l', 1.6, 0, 0, 3);
      set('thigh_r', -0.2, 0, 0, 3);
      set('shin_r', 1.5, 0, 0, 3);
      set('arm_l', -0.25, 0, 0.12);
      set('arm_r', -0.25, 0, -0.12);
      set('fore_l', -0.5);
      set('fore_r', -0.5);
      set('torso', 0.12 + Math.sin(t * 1.4) * 0.02);
      set('head', this.phase === 'judge' ? -0.42 : -0.3, Math.sin(t * 0.6) * 0.06);
      r.position.y = KNEEL.y + 0.12 + Math.sin(t * 1.6) * 0.04;
    } else if (m === 'rise') {
      set('arm_l', -0.2, 0, 1.25, 2);
      set('arm_r', -0.2, 0, -1.25, 2);
      set('fore_l', -0.2, 0, 0, 2);
      set('fore_r', -0.2, 0, 0, 2);
      set('thigh_l', -0.1, 0, 0, 2);
      set('thigh_r', -0.05, 0, 0, 2);
      set('shin_l', 0.25, 0, 0, 2);
      set('shin_r', 0.2, 0, 0, 2);
      set('head', -0.55, 0, 0, 2);
      set('torso', -0.2, 0, 0, 2);
    } else if (m === 'dissolve') {
      set('arm_l', -2.4 + Math.sin(t * 9) * 0.1, 0, 0.3, 3);
      set('arm_r', -2.2 + Math.sin(t * 8) * 0.1, 0, -0.3, 3);
      set('fore_l', -0.2);
      set('fore_r', -0.3);
      set('head', -0.6 + Math.sin(t * 7) * 0.05);
      set('torso', -0.3);
      set('thigh_l', -0.3);
      set('thigh_r', 0.1);
      set('shin_l', 0.6);
      set('shin_r', 0.4);
    }
    // spirit glow: brighter in the blaze, gone when taken
    const gain = (1.05 + Math.sin(t * 3.1) * 0.08 + (this.soulMode === 'rise' ? this.blaze * 1.6 : 0)) * this.soulFade;
    this.soulShell.uniforms.uGain.value = gain;
    this.soulCore.opacity = 0.32 * this.soulFade;
    this.soul.root.visible = this.soulFade > 0.01;
    copyPose(this.soul, this.soulMirror);
    this.soulMirror.root.visible = this.soul.root.visible && this.soulPos.z < 25.5 && this.phase !== 'tunnel';
    // motes shed by the soul
    if (rnd.next() < dt * (this.soulMode === 'dissolve' ? 90 : 10)) {
      const dis = this.soulMode === 'dissolve';
      const tgt = this.v1;
      if (dis) this.anubis.sockets['palm_l']?.getWorldPosition(tgt);
      const sp = { x: p.x + (rnd.next() - 0.5) * 0.6, y: p.y + 0.4 + rnd.next() * 1.3, z: p.z + (rnd.next() - 0.5) * 0.6 };
      this.fx.emit({
        pos: sp,
        vel: dis ? { x: (tgt.x - sp.x) * 0.55, y: (tgt.y - sp.y) * 0.55, z: (tgt.z - sp.z) * 0.55 } : { x: 0, y: 0.25, z: 0 },
        count: 1, spread: dis ? 0.6 : 0.15, life: dis ? [1.4, 2] : [0.8, 1.6], size: [0.07, 0.015], sprite: dis ? ['glow8', 'dot3'] : 'dot3',
        color: [0x7ff0e0, 0xc8fff4], additive: true, drag: dis ? 0.1 : 0.8,
      });
    }
  }

  // ---------------------------------------------------------------- Anubis
  private updateAnubis(dt: number, t: number) {
    const A = this.anubis.nodes;
    this.wake = this.skipping ? this.wakeTarget : damp(this.wake, this.wakeTarget, 1.6, dt);
    this.roar = damp(this.roar, 0, 1.4, dt);
    this.blaze = damp(this.blaze, this.phase === 'grant' ? 1 : 0, 1.5, dt);
    for (const k of Object.keys(this.gw) as (keyof Gest)[]) this.gw[k] = damp(this.gw[k], this.gwT[k], 2.6, dt);
    const g = this.gw;
    const w = this.wake;
    const set = (k: string, x: number, y = 0, z = 0) => A[k]?.rotation.set(x, y, z);
    // breath, weight, a slow living sway
    const br = Math.sin(t * 0.85);
    set('pelvis', 0, Math.sin(t * 0.21) * 0.02, Math.sin(t * 0.33) * 0.008);
    set('torso', -0.03 + br * 0.014 + g.reach * 0.16 + g.present * 0.04 - g.grant * 0.06, Math.sin(t * 0.27) * 0.025 + g.reach * 0.12, 0);
    A['torso']?.position.setY(this.anubis.geo.parts[this.anubis.geo.index['torso']].offset.y + br * 0.012);
    // head: bowed asleep, then follows the soul (or the scales while weighing)
    const look = this.v1;
    if (this.phase === 'judge') look.set(this.tilt * 2, 3.2, SCALES_Z);
    else look.copy(this.soulPos).setY(this.soulPos.y + 1.2);
    A['head'].getWorldPosition(this.v2);
    const d = look.sub(this.v2);
    const yaw = Math.max(-0.6, Math.min(0.6, Math.atan2(d.x, d.z)));
    const pitch = Math.max(-0.2, Math.min(0.55, Math.atan2(-d.y, Math.hypot(d.x, d.z))));
    const hx = mixN(0.62, pitch * 0.85, w) - this.roar * 0.35 + Math.sin(t * 0.6) * 0.02;
    const hy = yaw * w + Math.sin(t * 0.37) * 0.05 * w;
    const hz = Math.sin(t * 0.29) * 0.03 + (this.phase === 'judge' ? 0.06 : 0);
    const H = A['head'].rotation;
    H.set(damp(H.x, hx, 3, dt), damp(H.y, hy, 2.5, dt), damp(H.z, hz, 2, dt));
    set('jaw', Math.max(0, this.speak * 0.16 * (0.5 + 0.5 * Math.sin(t * 15)) + this.roar * 0.5 + this.anger * 0.1));
    // ears: alert when awake, pinned back in anger, a twitch now and then
    const tw = (s: number) => Math.max(0, Math.sin(t * 0.9 + s * 2.3) - 0.94) * 4;
    set('ear_l', -0.25 * (1 - w) - 0.45 * this.anger + tw(1) * 0.3, 0, -0.06 - tw(1) * 0.12);
    set('ear_r', -0.25 * (1 - w) - 0.45 * this.anger + tw(2) * 0.3, 0, 0.06 + tw(2) * 0.12);
    set('lappet_l', -H.x * 0.55 + Math.sin(t * 0.8) * 0.02, 0, -0.05);
    set('lappet_r', -H.x * 0.55 + Math.sin(t * 0.8 + 1) * 0.02, 0, 0.05);
    set('apron', Math.sin(t * 0.7) * 0.02);
    // right arm holds the was-sceptre upright; raising it for the grant
    const rx = -0.16 - g.raise * 1.5, fx = -0.6 + g.raise * 0.45;
    set('arm_r', rx, 0, -0.07 - g.raise * 0.12);
    set('fore_r', fx);
    set('hand_r', 0.08);
    set('weapon', -(rx + fx + 0.08));
    // left arm: rest / present the open palm / point at the scales / reach to take / grant
    const ax = 0.04 - 0.8 * g.present - 1.0 * g.point - 1.45 * g.reach - 0.7 * g.grant;
    const az = 0.1 + 0.32 * g.present + 0.18 * g.point + 0.06 * g.reach + 0.95 * g.grant;
    set('arm_l', ax + Math.sin(t * 0.5) * 0.02, -0.2 * g.point, az);
    set('fore_l', -0.15 - 0.85 * g.present - 0.35 * g.point - 0.15 * g.reach - 0.5 * g.grant);
    set('lhand', 0.1 * g.reach, 1.1 * g.present + 0.4 * g.grant, 0.15 * g.point);
    this.grip = damp(this.grip, this.phase === 'take' && this.soulMode === 'dissolve' ? 1.25 : g.reach * 0.35, 2, dt);
    const curl = 0.18 + g.point * 1.1 + this.grip;
    set('lfing', 0, 0, -curl);
    set('lindex', 0, 0, -(0.15 + this.grip));
    set('lthumb', 0.3 * (g.point + this.grip), 0, -0.4 * (g.point + this.grip));
    // spirit shell, eyes, glow
    const gold = this.blaze, red = this.anger;
    this.shell.uniforms.uGain.value = (0.15 + 0.35 * w) * (0.92 + 0.08 * Math.sin(t * 2.3)) * (1 + gold * 0.45);
    (this.shell.uniforms.uA.value as THREE.Color).setRGB(0.04 + 0.5 * gold + 0.3 * red, 0.35 + 0.15 * gold - 0.3 * red, 0.54 - 0.4 * gold - 0.2 * red);
    (this.shell.uniforms.uB.value as THREE.Color).setRGB(0.66 + 0.34 * gold + 0.2 * red, 0.96 - 0.1 * gold - 0.6 * red, 1 - 0.45 * gold - 0.5 * red);
    const eyeK = sstep(0.15, 0.7, w);
    this.eyeMat.userData.emissiveStrength.value = eyeK * (1.6 + Math.sin(t * 5.3) * 0.15 + this.roar * 1.5 + gold * 2.5 + red * 1.5);
    this.eyeMat.userData.tint.value.setRGB(0.25 + 0.75 * eyeK, (0.25 + 0.75 * eyeK) * (1 - 0.75 * red), (0.25 + 0.75 * eyeK) * (1 - 0.85 * red));
    for (const e of this.eyes) {
      const base = e.parent?.name.endsWith('eye_l') ? 0.32 : -0.32;
      e.rotation.set(Math.max(-0.2, Math.min(0.25, pitch * 0.4)), base + yaw * 0.3, 0);
    }
    this.aura.intensity = (4 + 16 * w) * (1 + gold * 0.6) * (1 - red * 0.4);
    this.aura.color.setRGB(0.5 + 0.5 * gold + 0.4 * red, 0.88 - 0.5 * red, 1 - 0.5 * gold - 0.6 * red);
    this.backLight.intensity = 12 + 30 * w;
    this.wallMat.userData.emissiveStrength.value = 0.25 + 0.9 * w + this.wallPulse * 2.5 + gold * 1.2;
    this.wallPulse = damp(this.wallPulse, 0, 2, dt);
    copyPose(this.anubis, this.anubisMirror);
    // spirit vapour streaming up off his shoulders, crown and the staff head
    if (w > 0.2 && rnd.next() < dt * 26 * w) {
      const sock = ['chest', 'staff_top', 'palm_l', 'mouth'][Math.floor(rnd.next() * 4)];
      const o = this.anubis.sockets[sock];
      if (o) {
        o.getWorldPosition(this.v2);
        this.fx.emit({ pos: { x: this.v2.x + (rnd.next() - 0.5) * 1.6, y: this.v2.y + (rnd.next() - 0.5) * 0.8, z: this.v2.z }, vel: { x: 0, y: 0.9, z: 0 }, count: 1, spread: 0.35, life: [1.2, 2.4], size: [0.16, 0.03], sprite: rnd.next() < 0.5 ? 'glow8' : 'dot4', color: gold > 0.3 ? [0xffe6a0, 0xfff4d0] : red > 0.3 ? [0xa04aff, 0xff4a6a] : [0x6fd8ff, 0xc8f8ff], additive: true, drag: 0.5, gravity: -0.3 });
      }
    }
  }

  // ---------------------------------------------------------------- the scales
  private updateScales(dt: number, t: number) {
    const a = this.qte.active as any;
    const live = this.phase === 'judge' && a && !a.done;
    // the weighing: the beam IS the gauge (its needle sweeps with the prompt's), then the feather's fall
    if (live && a.spec.kind === 'bar') this.tiltTarget = (a.state.x - 0.5) * 0.74;
    else if (live && a.spec.kind === 'ring' && this.featherDrop >= 0) {
      const k = a.t / (a.spec.duration ?? 1.15);
      this.tiltTarget = 0.34 * (1 - k / Qte.RING_PERFECT);
    } else if (this.phase !== 'take' && this.phase !== 'judge') this.tiltTarget = Math.sin(t * 0.7) * 0.05;
    const swing = live && (a.spec.kind === 'bar' || a.spec.kind === 'ring');
    this.tilt = swing ? damp(this.tilt, this.tiltTarget, 14, dt) : damp(this.tilt, this.tiltTarget, this.phase === 'take' ? 1.2 : 5, dt);
    const n = this.scales.nodes;
    n['beam'].rotation.z = this.tilt;
    n['pan_l'].rotation.z = -this.tilt;
    n['pan_r'].rotation.z = -this.tilt;
    n['plumb'].rotation.z = -this.tilt;
    const beat = Math.pow(Math.max(0, Math.sin(t * 7.2)), 8) + Math.pow(Math.max(0, Math.sin(t * 7.2 - 0.6)), 8) * 0.6;
    n['heart'].scale.setScalar(1 + beat * 0.08);
    this.scales.material.userData.emissiveStrength.value = 0.6 + beat * 0.8 + (this.phase === 'take' ? 1.2 : 0);
    const warm = this.phase === 'judge' || this.phase === 'grant' || this.phase === 'take' ? 1 : 0;
    this.scalesK = damp(this.scalesK, warm, 1.5, dt);
    this.scalesLight.intensity = 5 * this.scalesK * (1 + this.blaze * 0.5);
    copyPose(this.scales, this.scalesMirror);
  }

  // ---------------------------------------------------------------- the dead
  private updateSpirits(dt: number, t: number) {
    const ph = this.phase;
    const atGate = ph === 'descent' || ph === 'gate';
    const cam = this.camera.position;
    this.camera.getWorldDirection(this.cf);
    this.cr.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.cu.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    for (const s of this.spirits) {
      const q = s.seed;
      const p = s.pos;
      s.prev.copy(p);
      let want = 1;
      if (s.kind === 'wraith') {
        const a = q * 2.1 + t * (0.2 + (q % 0.37) * 0.25) * (q & 1 ? 1 : -1);
        if (atGate) {
          const r = 8 + 6 * Math.sin(t * 0.21 + q * 5);
          if (ph === 'descent') p.set(Math.cos(a) * r, this.soulPos.y + 1 + Math.sin(t * 0.5 + q) * 5, LAND.z + Math.sin(a) * r * 0.6);
          else p.set(Math.cos(a) * r * 1.25, 2.5 + 15 * (0.5 + 0.5 * Math.sin(t * 0.13 + q * 9)), GATE_Z + 3.5 + Math.sin(a) * r * 0.45);
        } else if (ph === 'take') {
          const k = sstep(0, 2.5, this.phaseT);
          const r = mixN(7, 1.4, k);
          p.set(Math.cos(a * 3) * r, mixN(6, 1.2, k) + Math.sin(t * 2 + q) * 0.5, KNEEL.z + Math.sin(a * 3) * r);
        } else if (ph === 'grant') {
          p.set(Math.cos(a) * (8 + this.phaseT * 3), 6 + this.phaseT * 3 + q, -6 + Math.sin(a) * 10);
          want = 1 - sstep(1, 3, this.phaseT);
        } else {
          p.set(Math.cos(a) * 6.5, 8.5 + 3 * Math.sin(t * 0.3 + q * 2), (ph === 'judge' ? -14 : 4) + Math.sin(a) * (ph === 'judge' ? 9 : 15));
          want = ph === 'hall' ? sstep(0, 3, this.phaseT) : 1;
        }
        const qi = Math.floor(q);
        if ((ph === 'gate' || ph === 'hall') && qi < 3) {
          // a few of the dead sweep right past the lens, close enough to feel the cold
          const u = ((t * 0.19 + q * 0.37) % 1) * 2 - 1;
          p.copy(this.camera.position).addScaledVector(this.cf, 4.5 + qi * 1.2).addScaledVector(this.cr, u * 10 * (qi & 1 ? 1 : -1)).addScaledVector(this.cu, 0.4 + (1 - u * u) * 1.6 - qi * 0.4);
          want = 1;
        } else if (ph === 'tunnel' && qi >= 3 && qi < 10) {
          // spirits swirling down the shaft with him
          const ta = q * 2.1 + t * (1.6 + (q % 0.5));
          const tr = 3.6 + (q % 3) * 1.1;
          p.set(Math.cos(ta) * tr, this.soulPos.y + 8 - ((t * 5 + q * 4.3) % 16), LAND.z + Math.sin(ta) * tr);
          want = 1;
        }
        const n = s.rig.nodes;
        n['head']?.rotation.set(Math.sin(t * 1.3 + q) * 0.25, Math.sin(t * 0.9 + q) * 0.35, 0);
        n['jaw']?.rotation.set(0.3 + 0.25 * Math.sin(t * 2.1 + q * 3), 0, 0);
        for (const side of ['l', 'r']) {
          const sg = side === 'l' ? 1 : -1;
          n['arm_' + side]?.rotation.set(-0.3 + Math.sin(t * 1.7 + q + sg) * 0.35, 0, sg * (0.15 + Math.sin(t * 1.1 + q) * 0.15));
          n['fore_' + side]?.rotation.set(-0.25 + Math.sin(t * 2.3 + q * 2 + sg) * 0.3, 0, 0);
        }
        for (let i = 1; i <= 4; i++) n['tail' + i]?.rotation.set(Math.sin(t * 1.9 - i * 0.6 + q * 2) * 0.2, Math.sin(t * 2.6 - i * 0.75 + q) * 0.3, 0);
      } else if (s.kind === 'hand') {
        const n = s.rig.nodes;
        if (atGate || ph === 'take') {
          let base = s.home;
          if (ph === 'take') {
            const a = (q / 8) * Math.PI * 2 + 0.3;
            base = this.v2.set(Math.cos(a) * 1.9, 0, KNEEL.z + Math.sin(a) * 1.9);
          }
          const trig = ph === 'take' ? (this.phaseT > 0.8 ? 1 : 0) : ph === 'gate' ? 1 : 0;
          s.rise = damp(s.rise, trig, 1.3 + (q % 1), dt);
          p.set(base.x, base.y - 2.6 * (1 - s.rise) - 0.3 + Math.sin(t * 1.2 + q) * 0.1, base.z);
          want = s.rise;
          // lean in toward the soul and claw
          const tx = this.soulPos.x - p.x, tz = this.soulPos.z - p.z;
          s.rig.root.rotation.set(Math.sin(t * 0.9 + q) * 0.1, Math.atan2(tx, tz), 0);
          s.rig.root.rotateX(0.35 + Math.sin(t * 0.7 + q) * 0.15);
        } else {
          s.rise = 0;
          want = 0;
          p.set(0, -40, 0);
        }
        const gr = 0.5 + 0.5 * Math.sin(t * 1.5 + q * 4);
        for (let k = 1; k <= 4; k++) {
          n[`f${k}a`]?.rotation.set(0.15 + gr * 0.85 + Math.sin(t * 3 + k) * 0.05, 0, (k - 2.5) * 0.08);
          n[`f${k}b`]?.rotation.set(0.25 + gr * 1.0, 0, 0);
        }
        n['thumb_a']?.rotation.set(0, 0, -0.1 - gr * 0.55);
        n['thumb_b']?.rotation.set(0, 0, -0.2 - gr * 0.4);
        n['palm']?.rotation.set(0.1 * Math.sin(t * 1.3 + q), 0, 0);
      } else {
        // wisps: fall with the soul, rise from the abyss, drift round the fires
        const a = q * 1.7 + t * (0.5 + (q % 0.4));
        if (ph === 'descent') p.set(this.soulPos.x + Math.cos(a) * (2 + q % 3), this.soulPos.y + Math.sin(t * 0.8 + q) * 3, LAND.z + Math.sin(a) * (2 + q % 3));
        else if (ph === 'gate') {
          const side = q & 1 ? 1 : -1;
          p.set(side * (13 + (q % 4)) + Math.sin(t + q) * 1.5, -14 + ((t * 1.6 + q * 7) % 26), 32 + (q * 3.7) % 14);
        } else {
          const b = this.braziers[Math.floor(q) % this.braziers.length];
          const r = 0.9 + (q % 1) * 1.2;
          p.set(b.pos.x + Math.cos(a) * r, b.fire.y + 1 + Math.sin(t * 1.3 + q) * 1.2, b.pos.z + Math.sin(a) * r);
          want = ph === 'take' ? 0 : b.lit;
        }
        const n = s.rig.nodes;
        for (let i = 1; i <= 3; i++) n['t' + i]?.rotation.set(Math.sin(t * 3 - i * 0.8 + q) * 0.25, Math.sin(t * 3.7 - i * 0.9 + q * 2) * 0.35, 0);
      }
      // face along the flight; fade near the lens
      if (s.kind !== 'hand') {
        const vel = this.v1.subVectors(p, s.prev);
        if (vel.lengthSq() > 1e-6) s.rig.root.lookAt(this.v2.copy(p).add(vel));
      }
      s.rig.root.position.copy(p);
      s.vis = damp(s.vis, want, 2.2, dt);
      const near = sstep(1.5, 6.0, p.distanceTo(cam));
      s.mat.uniforms.uFade.value = s.vis * near * (0.85 + 0.15 * Math.sin(t * 5 + q * 7));
      s.rig.root.visible = s.vis > 0.01;
    }
  }

  // ---------------------------------------------------------------- air, light, mist
  private updateAtmos(dt: number, t: number) {
    const ph = this.phase;
    const inHall = ph !== 'descent' && ph !== 'gate';
    this.mirror.visible = inHall || this.gateOpen > 0.6;
    this.hemi.intensity = inHall ? 0.55 : 0.3;
    for (const s of this.shafts) {
      s.k = damp(s.k, s.target, 1.2, dt);
      s.mat.uniforms.uDensity.value = s.k;
      s.mesh.visible = s.k > 0.002;
    }
    // falling motes during the descent (we fall, they streak up past us)
    if (ph === 'descent' && rnd.next() < dt * 60) {
      const p = this.soulPos;
      this.fx.emit({ pos: { x: p.x + (rnd.next() - 0.5) * 12, y: p.y - 6 + rnd.next() * 4, z: p.z + (rnd.next() - 0.5) * 10 }, vel: { x: 0, y: 9, z: 0 }, count: 1, life: [0.6, 1.0], size: [0.05, 0.03], sprite: 'streak', color: [0x6fb8e8, 0xc8f0ff], additive: true, stretch: 0.06 });
    }
    // spirit lights rising out of the abyss round the terrace
    if (!inHall && rnd.next() < dt * 22) {
      const side = rnd.next() < 0.5 ? -1 : 1;
      this.fx.emit({ pos: { x: side * (14 + rnd.next() * 10), y: -16 + rnd.next() * 6, z: 26 + rnd.next() * 26 }, vel: { x: 0, y: 1.6, z: 0 }, count: 1, spread: 0.3, life: [5, 9], size: [0.16, 0.08], sprite: 'glow8', color: [0x3a9ad8, 0x8fdcff], additive: true, alpha: 0.8, fadeIn: 1 });
    }
    // dust adrift in the moon shafts
    if (inHall && rnd.next() < dt * 30) {
      const sh = this.shafts[Math.floor(rnd.next() * 3)];
      const q = this.v1.copy(sh.O).addScaledVector(sh.U, 0.1 + rnd.next() * 0.8).addScaledVector(sh.V, 0.1 + rnd.next() * 0.8).addScaledVector(sh.L, 0.25 + rnd.next() * 0.7);
      if (q.y > 0.2 && q.y < 12) this.fx.emit({ pos: q, count: 1, spread: 0.04, up: 0.03, life: [4, 8], size: [0.022, 0.022], sprite: 'dot3', color: 0xd8ecff, additive: true, alpha: 0.9, drag: 0.3, jitter: 0.05, fadeIn: 1 });
    }
    // mist drifting right in front of the lens: the foreground the focus pulls through
    if ((ph === 'gate' || ph === 'hall' || ph === 'throne') && rnd.next() < dt * 4) {
      const c = this.camera.position;
      const d = 2.4 + rnd.next() * 2.2;
      const q = this.v1.copy(c).addScaledVector(this.cf, d).addScaledVector(this.cr, (rnd.next() - 0.5) * 4).addScaledVector(this.cu, (rnd.next() - 0.7) * 1.6);
      this.fx.emit({ pos: q, vel: { x: this.cr.x * 0.35, y: 0.04, z: this.cr.z * 0.35 }, count: 1, life: [3, 5], size: [1.3, 2.4], sprite: ['cloud0', 'cloud1', 'cloud2'], color: 0x2a4a66, alpha: 0.07, additive: true, rot: 3, rotSpeed: 0.1, fadeIn: 1 });
    }
    // low cold mist creeping over the floor and the terrace
    if (rnd.next() < dt * 5) {
      const hall = inHall;
      const x = (rnd.next() - 0.5) * (hall ? 18 : 22), z = hall ? -20 + rnd.next() * 44 : 30 + rnd.next() * 14;
      this.fx.emit({ pos: { x, y: 0.15 + rnd.next() * 0.3, z }, vel: { x: (rnd.next() - 0.5) * 0.3, y: 0.01, z: hall ? 0.25 : -0.2 }, count: 1, life: [5, 8], size: [1.4, 2.6], sprite: ['cloud0', 'cloud1', 'cloud2'], color: 0x1c3c56, alpha: 0.04, additive: true, rot: 3, rotSpeed: 0.08, fadeIn: 2 });
    }
    // the blaze: a column of light round the rising soul
    if (ph === 'grant' && rnd.next() < dt * 70) {
      const p = this.soulPos;
      const a = rnd.next() * Math.PI * 2, r = rnd.next() * 1.4;
      this.fx.emit({ pos: { x: p.x + Math.cos(a) * r, y: rnd.next() * 2, z: p.z + Math.sin(a) * r }, vel: { x: 0, y: 4 + rnd.next() * 3, z: 0 }, count: 1, life: [0.8, 1.6], size: [0.09, 0.02], sprite: rnd.next() < 0.3 ? 'star4' : 'streak', color: [0xfff2c8, 0xffe08a, 0xffffff], additive: true, stretch: 0.05 });
    }
    // the gate's breath once it stands open: wisps of light streaming out
    if (ph === 'gate' && this.gateOpen > 0.3 && rnd.next() < dt * 16) {
      this.fx.emit({ pos: { x: (rnd.next() - 0.5) * 5, y: 0.5 + rnd.next() * 8, z: GATE_Z }, vel: { x: (rnd.next() - 0.5) * 1.5, y: 0.6, z: 3.5 }, count: 1, spread: 0.4, life: [1.5, 3], size: [0.1, 0.02], sprite: 'glow8', color: [0x6fd8ff, 0xd8f8ff], additive: true, drag: 0.4 });
    }
  }

  private updateCamera(dt: number, t: number) {
    if (!this.shot) return;
    this.shotT += dt;
    const s = this.shot(this.shotT);
    let p = s.p, l = s.l, fov = s.fov;
    if (this.blendDur > 0 && this.shotT < this.blendDur) {
      const k = sstep(0, 1, this.shotT / this.blendDur);
      p = this.from.p.clone().lerp(s.p, k);
      l = this.from.l.clone().lerp(s.l, k);
      fov = mixN(this.from.fov, s.fov, k);
    }
    this.shake = damp(this.shake, 0, 2.2, dt);
    const sh = this.shake * this.shake;
    const hand = V(Math.sin(t * 0.71) * 0.05 + Math.sin(t * 31) * sh * 0.25, Math.sin(t * 0.53) * 0.04 + Math.sin(t * 27 + 1) * sh * 0.25, 0);
    this.camera.position.copy(p).add(hand);
    this.camLook.copy(l);
    this.camera.lookAt(this.camLook);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  private updateText(dt: number) {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      if (!l.dying || l.who !== 'title') l.ft.anchor.lerp(this.textAnchor(l.who), 1 - Math.exp(-6 * dt));
      l.ft.update(dt, this.camera, l.who === 'anubis' ? (c, i, s) => ((this.speak = 1), Voice.syllable('anubis', c, { index: i, text: s })) : undefined);
      if (l.dying && l.ft.visibleAmount < 0.02) {
        l.ft.dispose();
        this.lines.splice(i, 1);
      }
    }
  }

  dispose() {
    this.grade(false);
    for (const l of this.lines) l.ft.dispose();
    this.lines = [];
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && this.fx.group.children.includes(m)) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const k of this.rigKeys) {
      // rig geometries built for this trial only
      clearRigCache(k);
    }
    for (const r of [this.gate, this.anubis, this.scales, ...this.spirits.map((q) => q.rig)]) r?.geo.parts.forEach((p) => p.geo.dispose());
    this.envRT?.dispose();
    this.scene.environment = null;
    this.scene.clear();
    if ((window as any).__trial === this) delete (window as any).__trial;
  }
}

/** copy every joint (and the root) of one rig instance onto its reflection */
function copyPose(src: RigInstance, dst: RigInstance) {
  dst.root.position.copy(src.root.position);
  dst.root.quaternion.copy(src.root.quaternion);
  dst.root.scale.copy(src.root.scale);
  for (const k in src.nodes) {
    const a = src.nodes[k], b = dst.nodes[k];
    b.position.copy(a.position);
    b.quaternion.copy(a.quaternion);
    b.scale.copy(a.scale);
  }
}

/**
 * Shell geometries for the hero's soul: they share the player's buffers and add
 * smooth spirit normals. Kept per rig (never disposed: the attributes belong to
 * the living player) so repeat trials reuse them.
 */
const SHELLS = new WeakMap<RigGeo, THREE.BufferGeometry[]>();
export function soulShellGeos(geo: RigGeo) {
  let out = SHELLS.get(geo);
  if (out) return out;
  out = geo.parts.map((p) => {
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color', 'matx']) {
      const a = p.geo.getAttribute(name);
      if (a) g.setAttribute(name, a);
    }
    g.setIndex(p.geo.getIndex());
    g.boundingSphere = p.geo.boundingSphere;
    g.boundingBox = p.geo.boundingBox;
    return spiritNormals(g, p.model, p.pivot, geo.spec.voxelSize, 1);
  });
  SHELLS.set(geo, out);
  return out;
}
