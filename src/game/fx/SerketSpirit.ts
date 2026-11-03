// Serket in the world. The scorpion-girl rig (models/characters/scorpionGirl.ts)
// wearing a spirit material: cel-lit jade light with currents rising through it,
// a fresnel aura shell, and a "forming" field that builds her out of sand from
// her core outward and then ignites the sand into light (and runs backwards when
// she leaves). A jade light rides with her. Fluid procedural animation: hover,
// breathing, gaze, blinking lids, a talking jaw, wig / back-hair / sash / apron
// waves, an 8-link tail that sways and can flick its stinger, pincer snips and
// blended arm gestures.
// Also the summoning set pieces, all real 3D (nothing drawn): rings of glowing
// voxel hieroglyphs, a light-sigil of voxel lines and glyphs traced into the
// sand (conformed to the dune), and a vortex of pixel sand that spirals up and
// gathers into her body.
import * as THREE from 'three';
import { buildRigGeo, RigInstance } from '../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { globalUniforms, makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { scorpionGirlRig } from '../models/characters/scorpionGirl';
import { SpriteBatch } from './SpriteBatch';
import type { Particles } from './Particles';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

// ------------------------------------------------------------------ materials

const SG_FORM = /* glsl */ `
float sgHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sgField(vec3 lp, float h){ return length((lp - vec3(0.0, 1.38, 0.0)) * vec3(1.0, 0.82, 1.0)) / 1.25 + h * 0.12; }`;

/** the body: the game's voxel material (cel ramp, shadows, rim) + forming, sand and spirit light */
export function spiritMaterial() {
  const m = makeVoxelMaterial();
  const u = {
    uForm: { value: 1 },
    uSpirit: { value: 1 },
    uGlowK: { value: 1 },
    uOrigin: { value: new THREE.Vector3() },
    uInvScale: { value: 1 },
    uSgTime: globalUniforms.uTime,
  };
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uForm, uSpirit, uGlowK, uInvScale, uSgTime;
uniform vec3 uOrigin;
${SG_FORM}`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
vec3 sgLp = (vWPos - uOrigin) * uInvScale;
float sgH = sgHash(floor(vWPos * 22.0));
float sgF = sgField(sgLp, sgH);
float sgEdge = 0.0;
if (uForm < 0.999) {
  float sgTh = uForm * 1.15;
  if (sgF > sgTh) discard;
  sgEdge = smoothstep(sgTh - 0.1, sgTh, sgF);
}
float sgSand = uSpirit >= 0.999 ? 0.0 : smoothstep(uSpirit * 1.3 - 0.18, uSpirit * 1.3, sgF);`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 sgSandCol = vec3(0.93, 0.72, 0.44) * (0.75 + 0.5 * sgH);
  diffuseColor.rgb = mix(diffuseColor.rgb, sgSandCol, clamp(max(sgSand, sgEdge), 0.0, 1.0));
}`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float sgLive = (1.0 - sgSand) * (1.0 - sgEdge) * uGlowK;
  vec3 sgJade = vec3(0.32, 1.0, 0.7);
  float sgBand = pow(0.5 + 0.5 * sin(sgLp.y * 7.0 - uSgTime * 2.3 + sgLp.x * 2.5 + sgLp.z * 1.5), 8.0);
  vec3 sgV = normalize(vViewPosition);
  float sgFr = pow(1.0 - clamp(abs(dot(normal, sgV)), 0.0, 1.0), 2.2);
  totalEmissiveRadiance += diffuseColor.rgb * sgLive * (0.16 + vMatx.x * 1.3);
  totalEmissiveRadiance += sgJade * sgLive * (sgBand * 0.2 + sgFr * 0.5);
  totalEmissiveRadiance += vec3(1.0, 0.7, 0.3) * sgEdge * (1.2 + 1.6 * step(0.75, sgH));
}`
      );
  };
  m.customProgramCacheKey = () => 'serket-spirit-v1';
  m.userData.spirit = u;
  return m as VoxelMaterial & { userData: { spirit: typeof u } };
}

/** the aura: an additive fresnel shell riding on every part, flickering like a flame */
export function spiritShell() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSgTime: globalUniforms.uTime,
      uFade: { value: 0 },
      uForm: { value: 1 },
      uOrigin: { value: new THREE.Vector3() },
      uInvScale: { value: 1 },
      uA: { value: new THREE.Color(0x2cff9c) },
      uB: { value: new THREE.Color(0xeafff6) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        vec4 wp = modelMatrix * vec4(position + normal * 0.006, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uSgTime, uFade, uForm, uInvScale; uniform vec3 uOrigin, uA, uB;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      ${SG_FORM}
      void main(){
        float h = sgHash(floor(vW * 22.0));
        if (uForm < 0.999 && sgField((vW - uOrigin) * uInvScale, h) > uForm * 1.15) discard;
        float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
        float flick = 0.82 + 0.18 * sin(uSgTime * 9.0 + vW.y * 5.0 + vW.x * 2.0);
        vec3 col = mix(uA, uB, fr) * (0.12 + fr * 1.9) * flick;
        float a = clamp(0.03 + fr * 0.62, 0.0, 1.0) * uFade;
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------------------------ the goddess

export type SpiritPose = 'idle' | 'raise' | 'beckon' | 'point' | 'open' | 'present';
type JointPose = Record<string, [number, number, number]>;
const IDLE: JointPose = {
  arm_l: [0.08, 0.05, 0.28], fore_l: [-0.42, 0, 0.06], hand_l: [-0.15, 0, 0.12],
  arm_r: [0.02, -0.05, -0.24], fore_r: [-0.6, 0, -0.1], hand_r: [-0.25, 0, -0.1],
};
const POSES: Record<SpiritPose, JointPose> = {
  idle: IDLE,
  raise: { arm_l: [-0.2, 0, 1.7], fore_l: [-0.3, 0, 0.35], hand_l: [0.15, 0, 0.35], arm_r: [-0.2, 0, -1.7], fore_r: [-0.3, 0, -0.35], hand_r: [0.15, 0, -0.35] },
  beckon: { ...IDLE, arm_r: [-0.9, 0.15, -0.3], fore_r: [-0.75, 0.2, 0], hand_r: [0.4, 0, 0] },
  point: { ...IDLE, arm_r: [-1.45, 0.2, -0.1], fore_r: [-0.12, 0, 0], hand_r: [0.05, 0, 0] },
  open: { arm_l: [-0.35, 0, 0.8], fore_l: [-0.55, 0, 0.1], hand_l: [0.25, 0, 0.2], arm_r: [-0.35, 0, -0.8], fore_r: [-0.55, 0, -0.1], hand_r: [0.25, 0, -0.2] },
  present: { ...IDLE, arm_r: [-0.65, 0.25, -0.45], fore_r: [-0.85, 0.3, 0], hand_r: [0.5, 0.2, 0] },
};

export class SerketSpirit {
  /** place and orient this (she faces its +Z) */
  root = new THREE.Group();
  rig: RigInstance;
  mat: ReturnType<typeof spiritMaterial>;
  light: THREE.PointLight;
  /** figure height (m) at scale 1 */
  readonly height: number;
  scale = 1;
  /** 0..1: how much of her has been built out of the sand (from the core outward) */
  form = 1;
  /** 0..1: how much of that sand has become light */
  spirit = 1;
  /** overall light / aura strength */
  glow = 1;
  talking = false;
  pose: SpiritPose = 'idle';
  /** world point she looks at (null: straight ahead) */
  look: THREE.Vector3 | null = null;
  /** hover height above the root (m, before scale) */
  hover = 0.12;
  private shell = spiritShell();
  private t = Math.random() * 10;
  private talkK = 0;
  private blinkT = 2.5;
  private flickT = 0;
  private snipT = 0;
  private cur: Record<string, THREE.Vector3> = {};

  constructor(parent: THREE.Object3D, o: { scale?: number; shadow?: boolean } = {}) {
    const spec = scorpionGirlRig();
    this.height = (spec.meta?.height as number) ?? 2.4;
    this.scale = o.scale ?? 1;
    this.mat = spiritMaterial();
    this.rig = new RigInstance(buildRigGeo(spec, 'serket_girl:spirit'), { material: this.mat, castShadow: o.shadow ?? true });
    for (const m of Object.values(this.rig.meshes)) {
      const s = new THREE.Mesh(m.geometry, this.shell);
      s.renderOrder = 6;
      s.castShadow = false;
      s.receiveShadow = false;
      m.add(s);
    }
    this.rig.setPartVisible('lid_l', false);
    this.rig.setPartVisible('lid_r', false);
    this.root.add(this.rig.root);
    this.light = new THREE.PointLight(0x6affc4, 0, 6, 2);
    this.root.add(this.light);
    parent.add(this.root);
    for (const [k, v] of Object.entries(IDLE)) this.cur[k] = new THREE.Vector3(...v);
  }

  /** the stinger flicks forward (a strike / flourish) */
  flick() {
    this.flickT = 1;
  }
  /** both pincers snap */
  snip() {
    this.snipT = 1;
  }
  setExpression(name: string) {
    this.rig.setExpression(name);
  }
  /** world position of a socket (hand_l, hand_r, stinger_tip, head_top, chest, core ...) */
  socket(name: string, out = new THREE.Vector3()) {
    const s = this.rig.sockets[name];
    if (!s) return this.root.getWorldPosition(out);
    return s.getWorldPosition(out);
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    const n = this.rig.nodes;
    const sc = this.scale;
    const r = this.rig.root;
    r.scale.setScalar(sc);
    r.position.set(0, (this.hover + Math.sin(t * 1.15) * 0.045) * sc, 0);
    r.rotation.set(Math.sin(t * 0.7) * 0.015, 0, Math.sin(t * 0.55) * 0.02);
    // body
    if (n.pelvis) n.pelvis.rotation.set(0, Math.sin(t * 0.5) * 0.05, Math.sin(t * 0.8) * 0.025);
    if (n.torso) n.torso.rotation.set(Math.sin(t * 1.6) * 0.018 - 0.02, Math.sin(t * 0.5 + 1) * -0.04, Math.sin(t * 0.8 + 0.4) * -0.02);
    // arms: blend toward the gesture, with a living sway on top
    const target = POSES[this.pose] ?? IDLE;
    const k = 1 - Math.exp(-dt * 5);
    for (const [j, v] of Object.entries(target)) {
      const c = (this.cur[j] ??= new THREE.Vector3(...v));
      c.x += (v[0] - c.x) * k;
      c.y += (v[1] - c.y) * k;
      c.z += (v[2] - c.z) * k;
      const side = j.endsWith('_l') ? 1 : -1;
      const sway = Math.sin(t * 0.9 + (side > 0 ? 0 : 1.3)) * 0.035;
      n[j]?.rotation.set(c.x + sway, c.y, c.z + sway * side * 0.6);
    }
    // pincers: a slow idle breath of the jaws, a sharp snap on demand
    this.snipT = Math.max(0, this.snipT - dt * 3.2);
    const snap = this.snipT > 0 ? Math.sin((1 - this.snipT) * Math.PI) * 0.5 : 0;
    const open = 0.12 + Math.max(0, Math.sin(t * 0.8 + 1)) * 0.16 + snap * 0.6 - (this.snipT > 0 && this.snipT < 0.4 ? 0.3 : 0);
    n.claw_l?.rotation.set(-Math.max(0, open), 0, 0);
    n.claw_r?.rotation.set(-Math.max(0, open), 0, 0);
    // tail: a slow sinuous wave travelling to the tip; the stinger flicks forward on demand
    this.flickT = Math.max(0, this.flickT - dt * 1.8);
    const fl = this.flickT > 0 ? Math.sin((1 - this.flickT) * Math.PI) : 0;
    for (let i = 1; i <= 8; i++) {
      const s = n['tail' + i];
      if (!s) continue;
      s.rotation.set(Math.sin(t * 1.15 - i * 0.5) * 0.04 + (i > 4 ? fl * 0.09 : 0), Math.sin(t * 0.7 - i * 0.35) * 0.03, Math.sin(t * 0.9 - i * 0.42) * 0.028);
    }
    n.stinger?.rotation.set(Math.sin(t * 1.7) * 0.07 + fl * 0.5, 0, Math.sin(t * 1.1) * 0.05);
    // hair, locks, sashes, apron: waves that travel down each chain (a spirit wind from below and behind)
    const w = t * 1.45;
    n.hair1?.rotation.set(0.06 + Math.sin(w) * 0.045, Math.sin(w * 0.6) * 0.04, Math.sin(w * 0.8) * 0.03);
    n.hair2?.rotation.set(0.05 + Math.sin(w - 0.7) * 0.07, 0, Math.sin(w * 0.8 - 0.6) * 0.05);
    n.hair3?.rotation.set(0.06 + Math.sin(w - 1.4) * 0.1, 0, Math.sin(w * 0.8 - 1.2) * 0.07);
    n.lock_l?.rotation.set(-0.04 + Math.sin(w + 0.5) * 0.04, 0, Math.sin(w * 0.7) * 0.03);
    n.lock_r?.rotation.set(-0.04 + Math.sin(w + 1.1) * 0.04, 0, -Math.sin(w * 0.7 + 0.4) * 0.03);
    for (let i = 1; i <= 3; i++) {
      const a = 0.08 + i * 0.06;
      n['sash_l' + i]?.rotation.set(Math.sin(t * 1.9 - i * 0.8) * a, Math.sin(t * 1.3 - i * 0.6) * a * 0.6, 0.06 + Math.sin(t * 1.6 - i * 0.7) * a * 0.7);
      n['sash_r' + i]?.rotation.set(Math.sin(t * 1.9 - i * 0.8 + 1.1) * a, -Math.sin(t * 1.3 - i * 0.6 + 0.9) * a * 0.6, -0.06 - Math.sin(t * 1.6 - i * 0.7 + 1.0) * a * 0.7);
      n['apron' + i]?.rotation.set(Math.sin(t * 1.5 - i * 0.6) * (0.03 + i * 0.025) - 0.02 * i, 0, Math.sin(t * 1.1 - i * 0.5) * 0.03 * i);
    }
    // face: gaze, talking, brows, blinking
    let yaw = 0, pitch = 0;
    if (this.look && n.head && n.torso) {
      n.torso.updateWorldMatrix(true, false);
      const hp = n.head.getWorldPosition(_v);
      const d = _v2.copy(this.look).sub(hp);
      n.torso.getWorldQuaternion(_q).invert();
      d.applyQuaternion(_q);
      yaw = THREE.MathUtils.clamp(Math.atan2(d.x, d.z), -0.7, 0.7);
      pitch = THREE.MathUtils.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.4, 0.4);
    }
    const tilt = Math.sin(t * 0.45) * 0.05 + (this.pose === 'present' ? 0.07 : 0);
    if (n.head) {
      const h = n.head.rotation;
      const kk = 1 - Math.exp(-dt * 4);
      h.x += (pitch * 0.8 + Math.sin(t * 0.7) * 0.02 - h.x) * kk;
      h.y += (yaw * 0.75 - h.y) * kk;
      h.z += (tilt - h.z) * kk;
    }
    n.eye_l?.rotation.set(pitch * 0.15, yaw * 0.2, 0);
    n.eye_r?.rotation.set(pitch * 0.15, yaw * 0.2, 0);
    this.talkK += ((this.talking ? 1 : 0) - this.talkK) * Math.min(1, dt * 10);
    const flap = this.talkK * (0.03 + 0.09 * Math.max(0, Math.sin(t * 17) * (0.6 + 0.4 * Math.sin(t * 5.3))));
    n.jaw?.rotation.set(this.rig.exprJaw + flap, 0, 0);
    n.brow_l?.rotation.set(0, 0, this.rig.exprBrow[0] + this.talkK * Math.sin(t * 3.1) * 0.05);
    n.brow_r?.rotation.set(0, 0, this.rig.exprBrow[1] - this.talkK * Math.sin(t * 3.1) * 0.05);
    this.blinkT -= dt;
    if (this.blinkT < -0.13) this.blinkT = 2.2 + Math.random() * 3.2;
    const shut = this.blinkT < 0 && this.form > 0.9;
    this.rig.setPartVisible('lid_l', shut);
    this.rig.setPartVisible('lid_r', shut);
    // light, forming field, aura
    r.updateMatrixWorld(true);
    const o = r.getWorldPosition(_v);
    const su = this.mat.userData.spirit;
    su.uOrigin.value.copy(o);
    su.uInvScale.value = 1 / Math.max(1e-3, sc * this.root.scale.x);
    su.uForm.value = this.form;
    su.uSpirit.value = this.spirit;
    su.uGlowK.value = this.glow;
    const sh = this.shell.uniforms;
    sh.uOrigin.value.copy(o);
    sh.uInvScale.value = su.uInvScale.value;
    sh.uForm.value = this.form;
    sh.uFade.value = this.spirit * this.glow * Math.min(1, this.form * 1.3);
    // a soft jade spill on the sand and on whoever she faces (held out in front so it doesn't burn her own face)
    this.light.position.set(0, 0.8 * sc, 1.3 * sc);
    this.light.intensity = 3.2 * this.spirit * this.glow * Math.min(1, this.form * 1.4) * sc * sc * (0.92 + 0.08 * Math.sin(t * 7));
    this.light.distance = 6 * sc;
    this.root.visible = this.form > 0.005;
  }

  dispose() {
    this.root.removeFromParent();
    this.mat.dispose();
    this.shell.dispose();
    this.light.dispose();
  }
}

// ------------------------------------------------------------------ hieroglyphs (3D voxel tiles of light)

/** 11×13 glyph cut-outs, '#' = carved; extruded into bevelled voxel tiles */
const GLYPHS: string[][] = [
  // ankh
  ['....###....', '...#...#...', '..#.....#..', '..#.....#..', '..#.....#..', '...#...#...', '....#.#....', '###########', '###########', '....###....', '....###....', '....###....', '...#####...'],
  // wedjat, the eye of Horus
  ['...........', '#########..', '...........', '..#######..', '.#...#...#.', '#...###...#', '.#...#...#.', '..#######..', '....#..#...', '....#...#..', '...##....#.', '..........#', '...........'],
  // scarab
  ['....#.#....', '.....#.....', '...#####...', '..#######..', '#.#######.#', '.#.#####.#.', '..#######..', '#.###.###.#', '.####.####.', '..###.###..', '#.###.###.#', '...##.##...', '...........'],
  // feather of Maat
  ['.....##....', '....###....', '...####....', '...####....', '..#####....', '..####.....', '..#####....', '..####.....', '...###.....', '...##......', '....#......', '....#......', '....#......'],
  // scorpion, Serket's sign
  ['.....###...', '....#...#..', '........#..', '.......#...', '......#....', '.....#.....', '.....#.....', '....###....', '.#.#####.#.', '#.#.###.#.#', '...#####...', '..#..#..#..', '.#.......#.'],
  // djed
  ['###########', '.#########.', '###########', '.#########.', '###########', '.#########.', '....###....', '....###....', '....###....', '....###....', '....###....', '...#####...', '..#######..'],
  // sun disc with horns
  ['#.........#', '.#.......#.', '..#.###.#..', '...#####...', '..#######..', '..###.###..', '..##...##..', '..###.###..', '..#######..', '...#####...', '....###....', '.....#.....', '...........'],
  // water
  ['...........', '...........', '#.#.#.#.#.#', '.#.#.#.#.#.', '...........', '#.#.#.#.#.#', '.#.#.#.#.#.', '...........', '#.#.#.#.#.#', '.#.#.#.#.#.', '...........', '...........', '...........'],
  // reed leaf
  ['......#....', '.....##....', '.....###...', '....####...', '....###....', '...####....', '...###.....', '..####.....', '..###......', '..##.......', '..#........', '..#........', '.##........'],
];
const GLYPH_COL = [0x8dffd0, 0xffd36b, 0xffd36b, 0xfff0b0, 0x8dffd0, 0xffd36b, 0xffc04a, 0x9fe8ff, 0xb8ffa0];
const glyphOn = (g: string[], row: number, col: number) => row >= 0 && row < g.length && col >= 0 && col < g[row].length && g[row][col] === '#';

function glyphModel(i: number) {
  const g = GLYPHS[i];
  const m = new VoxelModel('glyph' + i);
  const base = new THREE.Color(GLYPH_COL[i]);
  const hi = base.clone().lerp(new THREE.Color(0xffffff), 0.45);
  for (let row = 0; row < g.length; row++)
    for (let col = 0; col < g[row].length; col++) {
      if (!glyphOn(g, row, col)) continue;
      const inner = glyphOn(g, row - 1, col) && glyphOn(g, row + 1, col) && glyphOn(g, row, col - 1) && glyphOn(g, row, col + 1);
      const x = col - 5, y = 12 - row;
      const c = (inner ? hi : base).getHex();
      for (let z = inner ? -1 : 0; z <= (inner ? 1 : 0); z++) m.set(x, y, z, c, VF.GLOW);
    }
  return m;
}
let glyphGeos: THREE.BufferGeometry[] | null = null;
/** shared glyph tile geometries (1/28 m voxels, centred) */
export function glyphGeometries() {
  return (glyphGeos ??= GLYPHS.map((_, i) => buildVoxelGeometry(glyphModel(i), { voxelSize: 1 / 28, pivot: 'center' })));
}

interface Ring {
  group: THREE.Group;
  tiles: THREE.Mesh[];
  radius: number;
  y: number;
  speed: number;
  tilt: THREE.Euler;
}

/** rings of glowing hieroglyph tiles that orbit a centre, assemble (spiralling in) and fade */
export class GlyphRings {
  group = new THREE.Group();
  private rings: Ring[] = [];
  private mat: THREE.MeshBasicMaterial;
  /** 0..1 assemble (tiles fly in, spin upright) */
  appear = 0;
  fade = 1;
  /** scales every ring radius (halo vs. summoning circle) */
  spread = 1;
  private t = 0;

  constructor(parent: THREE.Object3D, defs: { radius: number; y: number; count: number; speed: number; tilt?: [number, number] }[], hdr = 2.4) {
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.mat.color.setScalar(hdr);
    const geos = glyphGeometries();
    defs.forEach((d, ri) => {
      const g = new THREE.Group();
      const tiles: THREE.Mesh[] = [];
      for (let i = 0; i < d.count; i++) {
        const m = new THREE.Mesh(geos[(i * 4 + ri * 3) % geos.length], this.mat);
        m.frustumCulled = false;
        m.renderOrder = 7;
        g.add(m);
        tiles.push(m);
      }
      this.group.add(g);
      this.rings.push({ group: g, tiles, radius: d.radius, y: d.y, speed: d.speed, tilt: new THREE.Euler(d.tilt?.[0] ?? 0, 0, d.tilt?.[1] ?? 0) });
    });
    parent.add(this.group);
  }

  update(dt: number) {
    this.t += dt;
    const a = Math.max(0, Math.min(1, this.appear));
    const e = a * a * (3 - 2 * a);
    this.mat.opacity = Math.min(1, a * 1.6) * this.fade;
    this.group.visible = this.mat.opacity > 0.005;
    this.rings.forEach((r, ri) => {
      r.group.rotation.set(r.tilt.x, r.group.rotation.y + r.speed * dt * (1 + (1 - e) * 3), r.tilt.z);
      r.group.position.y = r.y;
      const R = r.radius * this.spread * (0.25 + 0.75 * e);
      const n = r.tiles.length;
      r.tiles.forEach((m, i) => {
        const ang = (i / n) * Math.PI * 2 + (1 - e) * (2.2 + ri);
        m.position.set(Math.sin(ang) * R, Math.sin(this.t * 1.7 + i * 1.3 + ri) * 0.06 + (1 - e) * (i % 2 ? 0.8 : -0.8), Math.cos(ang) * R);
        m.rotation.set(0, ang, (1 - e) * Math.PI * (i % 2 ? 1 : -1));
        m.scale.setScalar(0.6 + 0.4 * e);
      });
    });
  }

  dispose() {
    this.group.removeFromParent();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------ the light-sigil traced into the sand

const SIGIL_VS = 1 / 16;
function sigilModel() {
  const m = new VoxelModel('sigil');
  const R = 66;
  const GOLD = 0xffd36b, JADE = 0x8dffd0, WHITE = 0xeafff4;
  const band = GLYPHS;
  for (let x = -R - 2; x <= R + 1; x++)
    for (let z = -R - 2; z <= R + 1; z++) {
      const px = x + 0.5, pz = z + 0.5;
      const r = Math.hypot(px, pz);
      if (r > R + 1) continue;
      const th = Math.atan2(px, pz);
      let c: number | null = null;
      // circles: an outer double ring, a ring of beads, the band's borders, an inner ring
      for (const [rr, w] of [[62.5, 0.55], [59.5, 0.55], [42.5, 0.5], [40, 0.6], [14, 0.6]] as [number, number][]) if (Math.abs(r - rr) < w) c = GOLD;
      if (Math.abs(r - 65) < 0.8) {
        const k = (th / (Math.PI * 2)) * 72;
        if (Math.abs(k - Math.round(k)) < 0.18) c = GOLD;
      }
      // the band of hieroglyphs between 44 and 58, 18 of them, upright toward the centre
      if (r > 44.5 && r < 58.5) {
        const slots = 18;
        const slot = Math.round((th / (Math.PI * 2)) * slots);
        const a = (slot / slots) * Math.PI * 2;
        const tang = px * Math.cos(a) - pz * Math.sin(a);
        const col = Math.round(tang + 5);
        const row = 12 - Math.round(r - 45.5);
        if (glyphOn(band[((slot % band.length) + band.length) % band.length], row, col)) c = JADE;
      }
      // twelve spokes between the inner ring and the band
      if (r > 15 && r < 40) {
        const a = Math.round((th / (Math.PI * 2)) * 12) * ((Math.PI * 2) / 12);
        const off = Math.abs(px * Math.cos(a) - pz * Math.sin(a));
        if (off < 0.55 && (r < 22 || r > 26)) c = GOLD;
        // small diamonds on the spokes
        if (Math.abs(r - 24) + off < 2.2 && Math.abs(r - 24) + off > 1.2) c = JADE;
      }
      // Serket's scorpion in the middle, twice size
      if (r < 13) {
        const col = Math.floor(px / 2 + 5.5), row = 12 - Math.floor(pz / 2 + 6.5);
        if (glyphOn(band[4], row, col)) c = WHITE;
      }
      if (c !== null) m.set(x, 0, z, c, VF.GLOW);
    }
  return m;
}
let sigilGeo: THREE.BufferGeometry | null = null;

/** the summoning circle: voxel lines of light that trace themselves around, conformed to the dune */
export class LightSigil {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  /** 0..1 traced */
  reveal = 0;
  fade = 1;

  constructor(parent: THREE.Object3D, at: THREE.Vector3, yaw: number, groundAt: (x: number, z: number) => number, scale = 1) {
    sigilGeo ??= buildVoxelGeometry(sigilModel(), { voxelSize: SIGIL_VS, pivot: [0, 0, 0] });
    const g = sigilGeo.clone();
    // drape it over the sand
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i) * scale, lz = pos.getZ(i) * scale;
      const wx = at.x + lx * cs + lz * sn, wz = at.z - lx * sn + lz * cs;
      pos.setY(i, groundAt(wx, wz) - at.y + 0.035 + pos.getY(i) * 0.25);
    }
    pos.needsUpdate = true;
    g.computeBoundingSphere();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uReveal: { value: 0 }, uFade: { value: 1 }, uTime: globalUniforms.uTime, uR: { value: 66 * SIGIL_VS } },
      vertexColors: true,
      vertexShader: /* glsl */ `
        varying vec3 vC; varying vec2 vP;
        void main(){ vC = color; vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uReveal, uFade, uTime, uR;
        varying vec3 vC; varying vec2 vP;
        void main(){
          float r = length(vP) / uR;
          float k = fract(atan(vP.x, vP.y) / 6.2831853 + 0.5);
          // the outer rings are traced first, the band and spokes next, the scorpion last
          float stage = r > 0.92 ? 0.0 : r > 0.62 ? 0.18 : r > 0.22 ? 0.36 : 0.55;
          float th = (uReveal - stage) / (1.0 - stage) * 1.04;
          float vis = smoothstep(k - 0.012, k, th);
          float pen = exp(-pow((k - th) * 70.0, 2.0)) * step(0.0, th) * step(th, 1.0);
          float pulse = 0.82 + 0.18 * sin(uTime * 3.0 - r * 9.0);
          vec3 col = vC * (vis * pulse * 2.1 + pen * 5.0);
          float a = clamp(vis + pen, 0.0, 1.0) * uFade;
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
    this.mat.uniforms.uReveal.value = this.reveal;
    this.mat.uniforms.uFade.value = this.fade;
    this.mesh.visible = this.fade > 0.003 && this.reveal > 0.001;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------ the sand vortex

const GRAIN = ['grain0', 'grain1', 'grain2', 'grain3', 'grain4', 'grain5'];
const PUFF = ['puff0', 'puff1', 'puff2', 'puff3', 'cloud0', 'cloud1'];
const SANDC = [0xf6dfb0, 0xeccb8f, 0xe0b373, 0xcf9a5a, 0xfff0d0];

/** pixel sand spiralling up a funnel; `gather` pulls it into a figure, `burst` throws it outward */
export class SandVortex {
  center = new THREE.Vector3();
  height = 7;
  intensity = 0;
  gather = 0;
  burst = 0;
  /** figure the sand gathers into (m) */
  bodyH = 2.4;
  bodyR = 0.45;
  private n: number;
  private a: Float32Array;
  private h: Float32Array;
  private r0: Float32Array;
  private w: Float32Array;
  private vy: Float32Array;
  private kind: Uint8Array;
  private batch: SpriteBatch;
  private glow: SpriteBatch;
  private t = 0;

  constructor(parent: THREE.Object3D, n = 1100) {
    this.n = n;
    this.a = new Float32Array(n);
    this.h = new Float32Array(n);
    this.r0 = new Float32Array(n);
    this.w = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.kind = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.a[i] = Math.random() * Math.PI * 2;
      this.h[i] = Math.random();
      this.r0[i] = Math.random() * Math.random() * 1.6;
      this.w[i] = 2.2 + Math.random() * 2.6;
      this.vy[i] = 0.08 + Math.random() * 0.16;
      this.kind[i] = i % 11 === 0 ? 1 : i % 7 === 0 ? 2 : 0; // 1 puff, 2 glint
    }
    this.batch = new SpriteBatch(n);
    this.glow = new SpriteBatch(Math.ceil(n / 6), true);
    parent.add(this.batch.mesh, this.glow.mesh);
  }

  update(dt: number, fog?: THREE.Fog | null) {
    this.t += dt;
    this.batch.begin();
    this.glow.begin();
    const I = Math.max(0, Math.min(1.5, this.intensity));
    if (I > 0.01 || this.burst > 0.01) {
      const g = Math.max(0, Math.min(1, this.gather));
      const b = this.burst;
      const c = this.center;
      for (let i = 0; i < this.n; i++) {
        this.a[i] += this.w[i] * dt * (1 + g * 1.4) * (1 - b * 0.7);
        this.h[i] += this.vy[i] * dt * (0.7 + I * 0.6) * (1 - g * 0.6);
        if (this.h[i] > 1) {
          this.h[i] -= 1;
          this.r0[i] = Math.random() * Math.random() * 1.6;
        }
        const hf = this.h[i];
        // the funnel widens with height; gathered, it hugs a figure; bursting, it flies apart
        const hy = hf * (this.height * (1 - g) + this.bodyH * g);
        const funnel = 0.35 + hf * this.height * 0.3 + this.r0[i];
        const body = this.bodyR * (0.55 + 0.45 * Math.sin(hf * Math.PI)) + this.r0[i] * 0.15;
        const rad = (funnel * (1 - g) + body * g) * (1 + b * (3 + hf * 4));
        const x = c.x + Math.cos(this.a[i]) * rad, z = c.z + Math.sin(this.a[i]) * rad;
        const y = c.y + hy + b * (hf * 2.5 - b * 3 * (1 - hf));
        const fadeIn = Math.min(1, hf * 6) * (1 - Math.max(0, hf - 0.85) * 5);
        const al = Math.min(1, I) * fadeIn * (1 - b);
        if (al < 0.03) continue;
        const k = this.kind[i];
        const col = SANDC[i % SANDC.length];
        if (k === 1) this.batch.push(x, y, z, PUFF[i % PUFF.length], 0.5 + hf * 1.4, 0.5 + hf * 1.4, this.a[i] + this.t * 0.4, col, al * 0.55);
        else if (k === 2) this.glow.push(x, y, z, i % 2 ? 'glow8' : 'star4', 0.09, 0.09, 0, 0xffd890, al * 0.9);
        else this.batch.push(x, y, z, GRAIN[i % GRAIN.length], 0.07 + (i % 3) * 0.025, 0.07 + (i % 3) * 0.025, 0, col, al);
      }
    }
    this.batch.end(fog);
    this.glow.end(null);
  }

  dispose() {
    for (const b of [this.batch, this.glow]) {
      b.mesh.removeFromParent();
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
    }
  }
}

/** jade motes drifting up off a point (spirit light) */
export function spiritMotes(p: Particles, at: { x: number; y: number; z: number }, n: number, r = 1, up = 1.2) {
  p.emit({ pos: at, count: n, jitter: r, up, spread: 0.4, life: [0.9, 2.0], size: [0.07, 0.18], sprite: ['glow8', 'star4', 'spark'], additive: true, color: [0x9dffc8, 0xe6fff4, 0xffe6a0], alpha: 0.9, drag: 0.9, fadeIn: 0.15 });
}

/** the guide's size beside a rider (the summoned goddess is ~1.35) */
export const GUIDE_SCALE = 0.6;
/** where Serket floats as a guide: ahead of and left of the camera's view of the rider, hovering over the sand */
export function guideSpot(pos: THREE.Vector3, camYaw: number, groundAt: (x: number, z: number) => number, out = { pos: new THREE.Vector3(), yaw: 0, scale: GUIDE_SCALE }) {
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const lx = Math.cos(camYaw), lz = -Math.sin(camYaw); // camera-left
  out.pos.set(pos.x + lx * 2.5 + fx * 3.3, 0, pos.z + lz * 2.5 + fz * 3.3);
  out.pos.y = Math.max(groundAt(out.pos.x, out.pos.z), pos.y - 0.4) + 0.4;
  out.yaw = Math.atan2(pos.x - out.pos.x, pos.z - out.pos.z);
  out.scale = GUIDE_SCALE;
  return out;
}
