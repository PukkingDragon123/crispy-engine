// Opening cinematic (NEW RUN, about 70 s; SPACE / ESC / the SKIP label skips):
//   1. SHOW YOUR BOUNTY - a weathered WANTED poster nailed to a signpost snaps in
//      the golden-hour wind: SETHOS, THE HAND OF SET, $1,000,000. The portrait is
//      the real Sethos rig photographed (IconFactory) and printed in sepia on a
//      shader-paper cloth sheet (Verlet: it flaps, curls and tears). A long
//      shadow falls across it; Sundown's bone hand rips it off its nails.
//   2. He walks the dunes at golden hour, board slung on his back, Pinch on his
//      shoulder, revolver twirling; footsteps kick up sand, pixel grit streams by.
//   3. The ground trembles. A sigil of light traces itself into the sand, sand
//      spirals up into a vortex, rings of 3D hieroglyphs assemble, and Serket's
//      spirit avatar - the scorpion girl - is built out of the sand from her core
//      outward, then ignites into jade light (bloom, flash, motes).
//   4. She talks in floating 3D words; you answer (1 / 2 / 3, click or tap);
//      she has him throw his board down, and shrinks to a guide at his side.
// Returns { skipped }. Unless skipped, the run's interactive tutorial
// (run/Tutorial.ts) takes over from here; skipping the intro skips it too.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import type { CameraRig } from '../player/CameraRig';
import type { Player } from '../player/Player';
import type { Fx } from '../fx/Fx';
import type { Particles } from '../fx/Particles';
import type { World } from '../world/World';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { modelEntry } from '../models/lookup';
import { FloatText3D } from '../fx/FloatText3D';
import { Voice } from '../audio/Voice';
import { IconFactory } from '../ui/IconFactory';
import { PARCHMENT_GLSL } from '../ui/Choice';
import { GlyphRings, LightSigil, SandVortex, SerketSpirit, spiritMotes, guideSpot } from '../fx/SerketSpirit';
import { Skills } from '../player/Skills';
import * as CH from '../models/characters';

export interface IntroDeps {
  engine: Engine;
  cam: CameraRig;
  player: Player;
  fx: Fx;
  particles: Particles;
  world: World;
  scene: THREE.Scene;
  cutIn(title: string, color: string, expr: string): void;
}

export interface IntroResult {
  /** true when the player skipped (the tutorial is skipped with it) */
  skipped: boolean;
}

const JADE = '#c4ffe0';
const JADE_GLOW = '#3cff9a';
const UP = new THREE.Vector3(0, 1, 0);

// ================================================================== the WANTED poster

const PW = 0.6, PH = PW * (1040 / 720);
const NX = 10, NY = 14;
const INK = '#2a1a10', RED = '#8e1c12', SEPIA = '#4a2a14';

/** Sethos (form 1) photographed from his own rig, waist up, printed in sepia */
function sethosPortrait(renderer: THREE.WebGLRenderer): HTMLCanvasElement | null {
  const spec = modelEntry('sethos_1')?.() as RigSpec | undefined;
  if (!spec?.parts) return null;
  const mat = makeVoxelMaterial({ fog: false });
  const f = new IconFactory(renderer);
  try {
    const r = new RigInstance(buildRigGeo(spec, spec.name + ':wanted'), { material: mat, castShadow: false });
    for (const p of ['thigh_l', 'thigh_r', 'shin_l', 'shin_r']) r.setPartVisible(p, false);
    r.setExpression('smug');
    const n = r.nodes;
    if (n.jaw) n.jaw.rotation.x = r.exprJaw;
    n.brow_l?.rotation.set(0, 0, r.exprBrow[0]);
    n.brow_r?.rotation.set(0, 0, r.exprBrow[1]);
    n.arm_r?.rotation.set(-0.5, 0, -0.35);
    n.fore_r?.rotation.set(-1.3, 0, 0);
    n.arm_l?.rotation.set(0.05, 0, 0.18);
    n.head?.rotation.set(0.1, -0.18, 0.05);
    r.root.updateMatrixWorld(true);
    const shot = f.capture(r.root, { w: 140, h: 120, ss: 4, yaw: -0.38, pitch: 0.06, fill: 0.97, dy: 0.03, light: 'sunset', levels: 12, ink: '#2a160a', rim: '#ffe2a8' });
    const c = shot.getContext('2d')!;
    const id = c.getImageData(0, 0, shot.width, shot.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
      const k = Math.min(1, Math.max(0, (l - 0.04) * 1.12));
      d[i] = Math.min(255, 66 + k * 180);
      d[i + 1] = Math.min(255, 38 + k * 152);
      d[i + 2] = Math.min(255, 20 + k * 104);
    }
    c.putImageData(id, 0, 0);
    return shot;
  } catch (e) {
    console.warn('[intro] wanted portrait failed', e);
    return null;
  } finally {
    f.dispose();
    mat.dispose();
  }
}

/** the poster's ink: Alagard typography + the photographed portrait (the paper itself is the shader) */
function paintWanted(portrait: HTMLCanvasElement | null) {
  const W = 720, H = 1040;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.textAlign = 'center';
  c.textBaseline = 'top';
  const t = (s: string, size: number, y: number, col = INK) => {
    c.font = `${size}px Alagard`;
    c.fillStyle = col;
    const w = c.measureText(s).width;
    const sx = Math.min(1, (W - 70) / Math.max(1, w));
    c.save();
    c.translate(W / 2, y);
    c.scale(sx, 1);
    c.fillText(s, 0, 0);
    c.restore();
  };
  t('WANTED', 124, 30);
  t('DEAD  OR  ALIVE', 40, 162, RED);
  if (portrait) {
    const pw = portrait.width * 3, ph = portrait.height * 3;
    c.globalAlpha = 0.95;
    c.drawImage(portrait, Math.round(W / 2 - pw / 2), 214, pw, ph);
    c.globalAlpha = 1;
  }
  t('SETHOS', 96, 590);
  t('- THE HAND OF SET -', 34, 694);
  t('for the theft of the desert,', 27, 748, SEPIA);
  t('a hundred stolen souls & one stolen name', 27, 782, SEPIA);
  t('REWARD', 46, 836);
  t('$ 1,000,000', 88, 886, RED);
  t("claim at the eye of the storm  -  Serket's Reach", 22, 994, SEPIA);
  return cv;
}

const POSTER_PAPER = /* glsl */ `
{
  vec2 pUv = vMapUv;
  float pEdge = paperEdge(pUv, uAspect);
  float pTear = paperTear(pUv, 0.02);
  if (pEdge < pTear) discard;
  float pH1 = tornHole(pUv, uNails.xy), pH2 = tornHole(pUv, uNails.zw);
  float pHh = min(pH1, pH2);
  if (uScrap > 0.5) { if (pHh > 0.0) discard; }
  else if (uTorn > 0.5 && pHh < 0.0) discard;
  vec3 pCol = parchment(pUv, uAspect, pEdge, pTear);
  // rust from the nails bleeding into the paper; pale torn fibres along a rip
  for (int i = 0; i < 2; i++) {
    vec2 nl = i == 0 ? uNails.xy : uNails.zw;
    float d = length((pUv - nl) * vec2(uAspect, 1.0));
    pCol = mix(pCol, vec3(0.42, 0.2, 0.09), smoothstep(0.045, 0.0, d) * 0.55 * (0.5 + 0.5 * pNoise(pUv * 90.0)));
    if (uTorn < 0.5 && uScrap < 0.5) pCol = mix(pCol, vec3(0.12, 0.1, 0.09), smoothstep(0.009, 0.004, d));
  }
  if (uTorn > 0.5 || uScrap > 0.5) pCol = mix(pCol, vec3(0.98, 0.93, 0.8), smoothstep(0.012, 0.0, abs(pHh)) * 0.8);
  vec3 pLin = pow(pCol, vec3(2.2));
  vec4 pInk = texture2D(map, pUv);
  float pPress = 0.8 + 0.2 * smoothstep(0.2, 0.6, pNoise(pUv * vec2(uAspect, 1.0) * 260.0));
  if (gl_FrontFacing) pLin = mix(pLin, pInk.rgb * mix(vec3(1.0), pLin * 1.1, 0.2), pInk.a * pPress);
  else pLin = mix(pLin, pLin * 0.78, pInk.a * 0.3);
  diffuseColor.rgb *= pLin;
}
`;

function paperMaterial(ink: THREE.Texture, u: Record<string, { value: unknown }>, scrap: boolean) {
  const m = new THREE.MeshStandardMaterial({ map: ink, roughness: 0.93, metalness: 0, side: THREE.DoubleSide });
  const own = { ...u, uScrap: { value: scrap ? 1 : 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, own);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uAspect, uTorn, uScrap;
uniform vec4 uNails;
${PARCHMENT_GLSL}
float tornHole(vec2 uv, vec2 at){
  vec2 d = (uv - at) * vec2(uAspect, 1.0);
  float a = atan(d.y, d.x);
  return length(d) - (0.05 + 0.03 * pNoise(vec2(a * 3.0, at.x * 40.0)) + 0.014 * pNoise(vec2(a * 9.0, 3.0)));
}`
      )
      .replace('#include <map_fragment>', POSTER_PAPER);
  };
  m.customProgramCacheKey = () => 'dustup-intro-wanted';
  return m;
}

interface ClothPt {
  p: THREE.Vector3;
  o: THREE.Vector3;
  rest: THREE.Vector3;
  pin: -1 | 0 | 1 | 2;
  off: THREE.Vector3;
}

/** a sheet of paper nailed to the post: Verlet cloth with wind pressure, gusts and a tear */
class WantedPoster {
  mesh: THREE.Mesh;
  private geo = new THREE.PlaneGeometry(1, 1, NX - 1, NY - 1);
  private mat: THREE.MeshStandardMaterial;
  private scrapMat: THREE.MeshStandardMaterial;
  private scraps: THREE.Mesh[] = [];
  private ink: THREE.CanvasTexture;
  private u = { uAspect: { value: PW / PH }, uSeed: { value: Math.random() }, uTorn: { value: 0 }, uNails: { value: new THREE.Vector4(4 / 9, 0.975, 5 / 9, 0.975) } };
  pts: ClothPt[] = [];
  private springs: [number, number, number, number][] = [];
  private nails: THREE.Vector3[] = [];
  private lat: THREE.Vector3;
  hand: THREE.Vector3 | null = null;
  torn = false;
  /** 0..1: folded away into a coat */
  fold = 0;

  constructor(scene: THREE.Scene, portrait: HTMLCanvasElement | null, private top: THREE.Vector3, private n: THREE.Vector3, private postAxis: THREE.Vector3, private ground: (x: number, z: number) => number) {
    this.lat = new THREE.Vector3().crossVectors(UP, n).normalize();
    this.ink = new THREE.CanvasTexture(paintWanted(portrait));
    this.ink.colorSpace = THREE.SRGBColorSpace;
    this.ink.anisotropy = 4;
    this.mat = paperMaterial(this.ink, this.u, false);
    this.scrapMat = paperMaterial(this.ink, this.u, true);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const p = top.clone().addScaledVector(this.lat, (i / (NX - 1) - 0.5) * PW).addScaledVector(UP, -(j / (NY - 1)) * PH).addScaledVector(n, 0.004);
        const pin = j === 0 && (i === 4 || i === 5) ? ((i - 4) as 0 | 1) : -1;
        this.pts.push({ p, o: p.clone(), rest: p.clone(), pin, off: new THREE.Vector3() });
        if (pin >= 0) this.nails.push(p.clone());
      }
    const idx = (i: number, j: number) => j * NX + i;
    const link = (a: number, b: number, k: number) => this.springs.push([a, b, this.pts[a].p.distanceTo(this.pts[b].p), k]);
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        if (i < NX - 1) link(idx(i, j), idx(i + 1, j), 1);
        if (j < NY - 1) link(idx(i, j), idx(i, j + 1), 1);
        if (i < NX - 1 && j < NY - 1) {
          link(idx(i, j), idx(i + 1, j + 1), 0.6);
          link(idx(i + 1, j), idx(i, j + 1), 0.6);
        }
        if (i < NX - 2) link(idx(i, j), idx(i + 2, j), 0.32);
        if (j < NY - 2) link(idx(i, j), idx(i, j + 2), 0.32);
      }
    // the scraps the nails keep when it is ripped away
    for (let k = 0; k < 2; k++) {
      const g = new THREE.PlaneGeometry(0.075, 0.075);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      const cu = k === 0 ? 4 / 9 : 5 / 9;
      for (let v = 0; v < uv.count; v++) uv.setXY(v, cu + (uv.getX(v) - 0.5) * (0.075 / PW), 0.975 + (uv.getY(v) - 0.5) * (0.075 / PH));
      const s = new THREE.Mesh(g, this.scrapMat);
      s.position.copy(this.nails[k]).addScaledVector(n, 0.002);
      s.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(this.lat, UP, n));
      s.visible = false;
      s.castShadow = true;
      scene.add(s);
      this.scraps.push(s);
    }
    this.writeMesh();
  }

  /** the hand closes on the middle of the sheet: nearby points are bunched into the fist */
  grab(hand: THREE.Vector3) {
    this.hand = hand;
    const gi = 4.5, gj = 6.5;
    const c = this.pts[Math.round(gj) * NX + Math.round(gi)].p.clone();
    this.pts.forEach((q, k) => {
      const i = k % NX, j = Math.floor(k / NX);
      if (Math.hypot(i - gi, (j - gj) * 1.1) <= 1.7) {
        q.pin = 2;
        q.off.copy(q.p).sub(c).multiplyScalar(0.35);
      }
    });
  }

  /** ripped off the nails: the corners stay behind as scraps */
  tear() {
    if (this.torn) return;
    this.torn = true;
    this.u.uTorn.value = 1;
    for (const q of this.pts) if (q.pin === 0 || q.pin === 1) q.pin = -1;
    for (const s of this.scraps) s.visible = true;
    // the rip yanks the top edge free
    for (let i = 0; i < NX; i++) this.pts[i].o.addScaledVector(this.n, -0.02).addScaledVector(UP, -0.015);
  }

  update(dt: number, time: number) {
    const h = Math.min(dt, 1 / 30) / 4;
    const lat = this.lat, n = this.n;
    const gust = 0.55 + 0.45 * Math.sin(time * 0.9) + 0.3 * Math.sin(time * 2.3 + 1);
    const nrm = this.geo.getAttribute('normal') as THREE.BufferAttribute;
    const wind = new THREE.Vector3().addScaledVector(lat, 3.4 * gust).addScaledVector(n, 1.1 * gust).addScaledVector(UP, 0.6 * Math.sin(time * 1.7));
    const tmp = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let s = 0; s < 4; s++) {
      for (let k = 0; k < this.pts.length; k++) {
        const q = this.pts[k];
        if (q.pin === 0 || q.pin === 1) {
          q.p.copy(this.nails[q.pin]);
          q.o.copy(q.p);
          continue;
        }
        if (q.pin === 2 && this.hand) {
          q.p.copy(this.hand).add(q.off);
          if (this.fold > 0) q.p.lerp(this.hand, this.fold);
          q.o.copy(q.p);
          continue;
        }
        const i = k % NX, j = Math.floor(k / NX);
        nn.set(nrm.getX(k), nrm.getY(k), nrm.getZ(k));
        const turb = Math.sin(time * 6.1 + i * 0.8 + j * 0.5) * 0.6 + Math.sin(time * 9.3 - i * 1.1 + j * 0.7) * 0.4;
        const press = nn.dot(wind) * (1 + turb * 0.5);
        const ax = nn.x * press * 2.2 + wind.x * 0.25, ay = nn.y * press * 2.2 + wind.y * 0.25 - 3.6, az = nn.z * press * 2.2 + wind.z * 0.25;
        tmp.copy(q.p).sub(q.o).multiplyScalar(0.982);
        q.o.copy(q.p);
        q.p.add(tmp);
        q.p.x += ax * h * h;
        q.p.y += ay * h * h;
        q.p.z += az * h * h;
        if (this.fold > 0 && this.hand) q.p.lerp(this.hand, this.fold * 0.35);
      }
      for (let it = 0; it < 3; it++)
        for (const [a, b, rest, k] of this.springs) {
          const A = this.pts[a], B = this.pts[b];
          tmp.copy(B.p).sub(A.p);
          const d = tmp.length() || 1e-6;
          const wa = A.pin >= 0 ? 0 : 1, wb = B.pin >= 0 ? 0 : 1;
          const sw = wa + wb;
          if (!sw) continue;
          const diff = ((d - rest * (1 - this.fold * 0.85)) / d) * k;
          A.p.addScaledVector(tmp, (diff * wa) / sw);
          B.p.addScaledVector(tmp, (-diff * wb) / sw);
        }
      // the post: paper can't pass through its face (the edges may curl round the sides)
      if (!this.torn)
        for (const q of this.pts) {
          if (q.pin >= 0) continue;
          tmp.copy(q.p).sub(this.postAxis);
          const dl = tmp.dot(lat), dn = tmp.dot(n) - 0.08;
          const lim = Math.abs(dl) < 0.085 ? 0.003 : -0.16;
          if (dn < lim) q.p.addScaledVector(n, lim - dn);
        }
      for (const q of this.pts) {
        const g = this.ground(q.p.x, q.p.z) + 0.02;
        if (q.p.y < g) q.p.y = g;
      }
    }
    this.writeMesh();
  }

  private writeMesh() {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < this.pts.length; k++) pos.setXYZ(k, this.pts[k].p.x, this.pts[k].p.y, this.pts[k].p.z);
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }

  centre(out = new THREE.Vector3()) {
    out.set(0, 0, 0);
    for (const q of this.pts) out.add(q.p);
    return out.multiplyScalar(1 / this.pts.length);
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.scrapMat.dispose();
    this.ink.dispose();
    for (const s of this.scraps) {
      s.removeFromParent();
      s.geometry.dispose();
    }
  }
}

// ================================================================== Sundown on foot

type Pose3 = [number, number, number];
const ARM = {
  gun: { arm_r: [-0.35, 0, -0.25], fore_r: [-1.05, 0, 0] },
  relax: { arm_r: [0.08, 0, -0.14], fore_r: [-0.3, 0, 0] },
  reach: { arm_r: [-1.38, 0.05, -0.08], fore_r: [-0.14, 0, 0] },
  yank: { arm_r: [-0.62, 0, -0.32], fore_r: [-0.75, 0, 0] },
  read: { arm_r: [-1.25, 0.32, -0.15], fore_r: [-1.15, 0, 0] },
  tuck: { arm_r: [-0.3, 0.2, 0.05], fore_r: [-1.75, 0, 0] },
  throw: { arm_r: [-2.4, 0, -0.3], fore_r: [-0.3, 0, 0] },
} as Record<string, Record<'arm_r' | 'fore_r', Pose3>>;

function walkPose(r: RigInstance, ph: number, amt: number) {
  const n = r.nodes;
  const s = Math.sin(ph);
  const set = (k: string, x: number, y = 0, z = 0) => n[k]?.rotation.set(x, y, z);
  set('thigh_l', -s * 0.55 * amt);
  set('thigh_r', s * 0.55 * amt);
  set('shin_l', Math.max(0, Math.sin(ph + 1.4)) * 0.85 * amt);
  set('shin_r', Math.max(0, Math.sin(ph + 1.4 + Math.PI)) * 0.85 * amt);
  set('arm_l', s * 0.45 * amt, 0, 0.08);
  set('fore_l', -0.25 - Math.max(0, s) * 0.3 * amt);
  set('torso', 0.05 * amt, Math.sin(ph) * 0.09 * amt, Math.cos(ph) * 0.03 * amt);
  if (n['pelvis']) n['pelvis'].rotation.y = -Math.sin(ph) * 0.06 * amt;
}

// ================================================================== the cinematic

export async function playIntro(d: IntroDeps): Promise<IntroResult> {
  const { engine: eng, cam, player, world } = d;
  const camera = cam.camera;
  let skipped = false;
  const skip = document.createElement('div');
  skip.style.cssText = "position:absolute;right:3vw;bottom:4vh;font-family:'Alagard';font-size:18px;color:#fff3d6;opacity:.75;z-index:9;pointer-events:auto;cursor:pointer;padding:8px 12px;text-shadow:0 2px 0 #2a1408";
  skip.textContent = 'SKIP >';
  skip.onpointerdown = (e) => {
    e.stopPropagation();
    skipped = true;
  };
  eng.overlay.append(skip);
  // response picking (keys, mouse, touch)
  let pick = -1;
  const mouse = new THREE.Vector2(-9, -9);
  let clicked = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'Escape') skipped = true;
    const k = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (k >= 0) pick = k;
    if (e.code === 'Enter' || e.code === 'KeyE') clicked = true;
  };
  const onMove = (e: PointerEvent) => {
    const r = eng.renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  const onDown = (e: PointerEvent) => {
    onMove(e);
    clicked = true;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerdown', onDown);
  document.exitPointerLock?.();

  // ------------------------------------------------------------------ the set
  const p = player.pos.clone();
  const fwd = new THREE.Vector3(Math.sin(cam.yaw), 0, Math.cos(cam.yaw));
  const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const gy = (v: THREE.Vector3) => world.groundAt(v.x, v.z);
  const ground = (x: number, z: number) => world.groundAt(x, z);
  const texts: FloatText3D[] = [];
  const text = (s: string, at: THREE.Vector3, o: ConstructorParameters<typeof FloatText3D>[1] = {}) => {
    const t = new FloatText3D(s, o);
    t.anchor.copy(at);
    d.scene.add(t.mesh);
    texts.push(t);
    return t;
  };
  const own: THREE.Object3D[] = [];
  const disposers: (() => void)[] = [];

  // golden hour: a low warm sun off the trail's right shoulder (restored at the end)
  const env = world.env as unknown as { preset?: any; apply?: (p: any) => void; lerpPreset?: (a: any, b: any, k: number) => void };
  const basePreset = env.preset ? { ...env.preset } : null;
  const sunH = side.clone().multiplyScalar(0.9).addScaledVector(fwd, -0.45).normalize();
  const golden = basePreset
    ? { ...basePreset, sunElev: 10, sunAzim: THREE.MathUtils.radToDeg(Math.atan2(sunH.z, sunH.x)), sunColor: 0xffb46a, sunIntensity: (basePreset.sunIntensity ?? 3.2) * 0.95, horizon: 0xffb877, zenith: 0x3562aa, ground: 0xc98c55, hemiSky: 0xb8c4e0, hemiGround: 0xc88850, fog: 0xf0bc8a, clouds: Math.max(0.45, basePreset.clouds ?? 0.5), cloudColor: 0xffd2b0 }
    : null;
  if (golden) env.apply?.(golden);

  // the post and its poster: the poster faces the sun, so a man walking out of the sunset throws his shadow on it
  const nP = sunH.clone();
  const Q = p.clone().addScaledVector(fwd, -11).addScaledVector(side, 1.0);
  Q.y = gy(Q);
  let postMesh: THREE.Mesh | null = null;
  {
    let best: { model: VoxelModel; voxelSize: number } | null = null, bestY = -1;
    for (let s = 0; s < 4; s++) {
      const e = modelEntry('signpost_' + s)?.() as { model: VoxelModel; voxelSize: number } | undefined;
      if (!e?.model) continue;
      let low = 1e9;
      e.model.forEach((x, y) => {
        if (Math.abs(x) >= 3) low = Math.min(low, y);
      });
      if (low > bestY) {
        bestY = low;
        best = e;
      }
    }
    const e = best ?? (modelEntry('hitching_post')?.() as { model: VoxelModel; voxelSize: number } | undefined) ?? null;
    if (e?.model) {
      const b = e.model.bounds();
      postMesh = new THREE.Mesh(buildVoxelGeometry(e.model, { voxelSize: e.voxelSize, pivot: [0.5, b.minY, 0.5] }), player.material);
      postMesh.castShadow = true;
      postMesh.receiveShadow = true;
      postMesh.position.copy(Q).add(new THREE.Vector3(0, -0.06, 0));
      postMesh.rotation.y = Math.atan2(-nP.x, -nP.z);
      d.scene.add(postMesh);
      own.push(postMesh);
      disposers.push(() => postMesh?.geometry.dispose());
    }
  }
  // Sundown on foot: his own rig, revolver, board on his back, Pinch on his shoulder
  const actor = new RigInstance(player.rig.geo, { material: player.material });
  const meta = player.rig.geo.spec.meta ?? {};
  const shoulderY = (meta.shoulderY as number) ?? 1.45;
  const gunA = new RigInstance(player.gun.geo, { material: player.material });
  const holder = new THREE.Group();
  holder.rotation.x = Math.PI / 2;
  holder.add(gunA.root);
  const holster = () => (actor.sockets['hip_r'] ? actor.attach('hip_r', holder) : actor.nodes['pelvis']?.add(holder));
  const draw = () => (actor.attach('hand_r', holder) ? true : actor.nodes['fore_r']?.add(holder));
  holster();
  const boardOnBack = new THREE.Mesh(player.boardMesh.geometry, player.material);
  boardOnBack.castShadow = true;
  // the board slung on his back: the rig's own `board_back` mount when it has one, else across the `back` socket
  const mount = (CH as unknown as { attachBoardOnBack?: (r: RigInstance, b: THREE.Object3D, o?: { material?: THREE.Material }) => THREE.Group | null }).attachBoardOnBack;
  const backBoard = mount && actor.sockets['board_back'] ? mount(actor, boardOnBack, { material: player.material }) : null;
  if (!backBoard) {
    const sling = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.rotation.x = -Math.PI / 2;
    tilt.position.set(0, -0.05, -0.07);
    tilt.add(boardOnBack);
    sling.rotation.z = 0.36;
    sling.add(tilt);
    if (!actor.attach('back', sling)) actor.nodes['torso']?.add(sling);
  }
  let pinch: RigInstance | null = null;
  {
    const ps = modelEntry('pinch')?.() as RigSpec | undefined;
    if (ps?.parts) {
      pinch = new RigInstance(buildRigGeo(ps, 'pinch:intro'), { material: player.material });
      if (!actor.attach('shoulder_l', pinch.root)) actor.nodes['torso']?.add(pinch.root);
    }
  }
  const skills = Skills.current;
  const pinchWasVisible = skills?.pinchRoot.visible ?? true;
  if (skills) skills.pinchRoot.visible = false;
  const S0 = Q.clone().addScaledVector(nP, 0.56);
  const actorPos = S0.clone().addScaledVector(nP, 7);
  actorPos.y = gy(actorPos);
  actor.root.position.copy(actorPos);
  actor.root.rotation.y = Math.atan2(-nP.x, -nP.z);
  d.scene.add(actor.root);
  own.push(actor.root);
  actor.setExpression('determined');
  let walkPh = 0, walkAmt = 0, spin = 0, spinRate = 0, lastStep = 0;
  let armPose = 'relax';
  const armCur: Record<string, THREE.Vector3> = { arm_r: new THREE.Vector3(...ARM.relax.arm_r), fore_r: new THREE.Vector3(...ARM.relax.fore_r) };
  let armSpeed = 6;
  let headLook = 0; // 0 ahead, 1 down at the poster in hand, -1 up at her
  // the poster (top centre on the post's face, a little above shoulder height)
  const topY = Q.y + THREE.MathUtils.clamp(shoulderY + 0.4, 1.55, 1.95);
  const lat = new THREE.Vector3().crossVectors(UP, nP).normalize();
  const posterTop = new THREE.Vector3(Q.x, topY, Q.z).addScaledVector(nP, 0.08);
  let poster: WantedPoster | null = new WantedPoster(d.scene, sethosPortrait(eng.renderer), posterTop, nP, new THREE.Vector3(Q.x, 0, Q.z), ground);
  const handW = new THREE.Vector3();
  // Serket
  const soulAt = p.clone().addScaledVector(fwd, 8.5).addScaledVector(side, -0.4);
  soulAt.y = gy(soulAt);
  const SOUL_SCALE = 1.35;
  const spirit = new SerketSpirit(d.scene, { scale: SOUL_SCALE });
  spirit.root.position.copy(soulAt);
  spirit.root.rotation.y = Math.atan2(-fwd.x, -fwd.z);
  spirit.form = 0;
  spirit.spirit = 0;
  spirit.glow = 0;
  const soulH = spirit.height * SOUL_SCALE;
  const rings = new GlyphRings(d.scene, [
    { radius: 3.1, y: 0.5, count: 18, speed: 0.55, tilt: [0.05, -0.04] },
    { radius: 2.5, y: 1.9, count: 14, speed: -0.8, tilt: [-0.08, 0.06] },
    { radius: 1.9, y: 3.3, count: 11, speed: 1.1, tilt: [0.1, 0.05] },
  ]);
  rings.group.position.copy(soulAt);
  rings.appear = 0;
  const sigil = new LightSigil(d.scene, soulAt, Math.atan2(-fwd.x, -fwd.z), ground, 1.0);
  const vortex = new SandVortex(d.scene);
  vortex.center.copy(soulAt);
  vortex.bodyH = soulH * 0.92;
  vortex.bodyR = 0.5 * SOUL_SCALE;
  let windSand = 0.6;
  let T = 0;

  const tick = (dt: number) => {
    T += dt;
    // ---- Sundown
    walkPh += dt * 6.2 * walkAmt;
    walkPose(actor, walkPh, walkAmt);
    actor.root.position.y = gy(actor.root.position) + Math.abs(Math.cos(walkPh)) * 0.035 * walkAmt;
    if (walkAmt > 0.3 && Math.floor(walkPh / Math.PI) !== lastStep) {
      lastStep = Math.floor(walkPh / Math.PI);
      eng.audio.play('footstep_sand', { volume: 0.35, pitch: 0.9 + Math.random() * 0.2 });
      const fp = actor.root.position;
      d.fx.dust({ x: fp.x, y: fp.y + 0.05, z: fp.z }, 0.25, 0xe6cf9f, 2);
      d.particles.emit({ pos: { x: fp.x, y: fp.y + 0.04, z: fp.z }, count: 5, spread: 1.2, up: 1.2, life: [0.4, 0.8], size: [0.05, 0.03], sprite: ['grain0', 'grain1', 'grain2'], color: [0xf6dfb0, 0xe0b373], gravity: 9, ground: true });
    }
    spin += spinRate * dt;
    holder.rotation.x = Math.PI / 2 + spin;
    const target = ARM[armPose] ?? ARM.relax;
    const kk = 1 - Math.exp(-dt * armSpeed);
    for (const j of ['arm_r', 'fore_r'] as const) {
      armCur[j].lerp(new THREE.Vector3(...target[j]), kk);
      actor.nodes[j]?.rotation.set(armCur[j].x, armCur[j].y, armCur[j].z);
    }
    const n = actor.nodes;
    if (n['head']) n['head'].rotation.x += ((headLook > 0 ? 0.32 * headLook : headLook < 0 ? -0.3 : -0.04 * (1 - walkAmt)) - n['head'].rotation.x) * Math.min(1, dt * 5);
    if (n['jaw']) n['jaw'].rotation.x = actor.exprJaw;
    n['brow_l']?.rotation.set(0, 0, actor.exprBrow[0]);
    n['brow_r']?.rotation.set(0, 0, actor.exprBrow[1]);
    if (pinch) {
      const pn = pinch.nodes;
      for (let k = 1; k <= 5; k++) pn['tail' + k]?.rotation.set(-0.3 - Math.sin(T * 2 + k) * 0.06, 0, 0);
      pn['pincer_l']?.rotation.set(0, -Math.max(0, Math.sin(T * 3)) * 0.5, 0);
      pn['pincer_r']?.rotation.set(0, Math.max(0, Math.sin(T * 3 + 1)) * 0.5, 0);
      for (let k = 1; k <= 4; k++) {
        pn['leg_l' + k]?.rotation.set(0, 0, Math.sin(T * 9 + k) * 0.06 * (0.3 + walkAmt));
        pn['leg_r' + k]?.rotation.set(0, 0, -Math.sin(T * 9 + k) * 0.06 * (0.3 + walkAmt));
      }
      pinch.root.rotation.y = Math.sin(T * 1.3) * 0.3;
    }
    actor.root.updateMatrixWorld(true);
    // ---- the poster
    if (poster) {
      if (poster.hand) {
        const s = actor.sockets['hand_r'];
        if (s) s.getWorldPosition(handW);
        else actor.root.getWorldPosition(handW).add(new THREE.Vector3(0, 1.2, 0));
        poster.hand.copy(handW);
      }
      poster.update(dt, T);
    }
    // ---- grit on the wind: pixel sand streaming past
    if (windSand > 0 && Math.random() < dt * 40 * windSand) {
      const c = camera.position;
      const wf = camera.getWorldDirection(new THREE.Vector3());
      const at = c.clone().addScaledVector(wf, 3 + Math.random() * 9).add(new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8));
      at.y = gy(at) + Math.random() * 1.6;
      const wv = lat.clone().multiplyScalar(-(4 + Math.random() * 4));
      d.particles.emit({ pos: at, count: 2, vel: { x: wv.x, y: 0.3, z: wv.z }, spread: 0.8, life: [0.7, 1.4], size: [0.04, 0.025], sprite: ['grain0', 'grain1', 'grain2', 'grain3'], color: [0xf6dfb0, 0xeccb8f, 0xe0b373], gravity: 1.5, drag: 0.3 });
    }
    // ---- Serket and her magic
    spirit.update(dt);
    rings.update(dt);
    sigil.update();
    vortex.update(dt, world.env.fog);
    // ---- floating words
    let hoverIdx = -1;
    if (choices.length) {
      const rc = new THREE.Raycaster();
      rc.setFromCamera(mouse, camera);
      const hit = rc.intersectObjects(choices.map((c) => c.mesh), false)[0];
      hoverIdx = hit ? choices.findIndex((c) => c.mesh === hit.object) : -1;
      choices.forEach((c, i) => (c.hover += ((i === hoverIdx ? 1 : 0) - c.hover) * Math.min(1, dt * 10)));
      if (clicked && hoverIdx >= 0) pick = hoverIdx;
    }
    clicked = false;
    for (const t of texts) {
      const w = nearLens.get(t);
      if (w) t.anchor.copy(camera.position).addScaledVector(w.clone().sub(camera.position).normalize(), 3.4);
      t.update(dt, camera, t === speaking ? (c, i, s) => Voice.syllable(speakingAs, c, { index: i, text: s }) : undefined);
    }
  };
  let choices: FloatText3D[] = [];
  let speaking: FloatText3D | null = null;
  let speakingAs: 'serket' | 'sundown' | 'pinch' = 'serket';
  const nearLens = new Map<FloatText3D, THREE.Vector3>();
  let last = performance.now();
  // ?cinedt=0.5 lets slow headless test machines get through the scene
  const dtCap = +(new URLSearchParams(location.search).get('cinedt') ?? 0.05);
  const frame = async () => {
    await eng.tweens.wait(0.016, true);
    const now = performance.now();
    const dt = Math.min(dtCap, (now - last) / 1000);
    last = now;
    tick(dt);
    return dt;
  };
  const runFor = async (dur: number, fn: (k: number, t: number, dt: number) => void) => {
    let t = 0;
    while (!skipped && t < dur) {
      const dt = await frame();
      t += dt;
      fn(Math.min(1, t / dur), t, dt);
    }
  };
  const ease = (k: number) => k * k * (3 - 2 * k);
  const lerpV = (a: THREE.Vector3, b: THREE.Vector3, k: number) => a.clone().lerp(b, k);
  const shot = (pos: THREE.Vector3, look: THREE.Vector3, fov: number, blend = true) => {
    const c = pos.clone();
    c.y = Math.max(c.y, world.groundAt(c.x, c.z) + 0.35);
    cam.setCine({ pos: c, look, fov }, blend);
  };

  /** someone speaks: typed words floating beside them */
  const say = async (who: 'serket' | 'sundown' | 'pinch', line: string, hold = 1.4) => {
    if (skipped) return;
    const ap = actor.root.position;
    // spoken lines float beside the speaker's head, held at a fixed distance from the lens so
    // they read the same in a close-up and a wide shot
    const at =
      who === 'serket'
        ? spirit.root.position.clone().add(new THREE.Vector3(0, soulH * 0.86 * (spirit.scale / SOUL_SCALE), 0)).addScaledVector(side, -1.2 * (spirit.scale / SOUL_SCALE))
        : ap.clone().add(new THREE.Vector3(0, 2.2, 0)).addScaledVector(side, who === 'pinch' ? 0.5 : -0.35);
    const t = text(line, at, who === 'serket' ? { size: 0.135, color: JADE, glow: JADE_GLOW, cps: 36, wrap: 28, hdr: 1.7 } : { size: 0.11, color: who === 'pinch' ? '#c8ff8a' : '#fff3d6', glow: who === 'pinch' ? '#6aff1a' : '#ffb070', cps: 40, wrap: 28, hdr: 1.3 });
    nearLens.set(t, at.clone());
    speaking = t;
    speakingAs = who;
    if (who === 'serket') {
      spirit.talking = true;
      eng.audio.play('divine_whisper', { volume: 0.5 });
    }
    while (!skipped && !t.done) {
      await frame();
      if (clicked) t.skipTyping();
    }
    spirit.talking = false;
    await runFor(hold + line.length * 0.012, () => {});
    t.show(false);
    speaking = null;
    await runFor(0.25, () => {});
  };
  /** three floating answers beside Sundown; resolves with the chosen index */
  const ask = async (opts: string[]) => {
    if (skipped) return 0;
    pick = -1;
    const base = actor.root.position.clone().add(new THREE.Vector3(0, 1.75, 0)).addScaledVector(side, 1.55);
    choices = opts.map((o, i) => text(`${i + 1} · ${o}`, base.clone().add(new THREE.Vector3(0, -i * 0.36, 0)).addScaledVector(fwd, 0.2 * i), { size: 0.17, color: '#fff3d6', glow: '#ffb070', cps: 70, wrap: 40, align: 'left', hdr: 1.2 }));
    eng.audio.play('card_hover', { volume: 0.5 });
    let t = 0;
    while (!skipped && pick < 0 && t < 14) t += await frame();
    const k = pick < 0 ? 0 : pick;
    eng.audio.play('ui_click', { volume: 0.8 });
    choices.forEach((c, i) => (i === k ? (c.hover = 1) : c.show(false)));
    await runFor(0.5, () => {});
    choices.forEach((c) => c.show(false));
    choices = [];
    return k;
  };

  // dev handle for headless checks: window.__introPhase
  const phase = (n: string) => ((window as any).__introPhase = n);
  player.rig.root.visible = false;
  player.boardMesh.visible = false;
  eng.input.enabled = false;
  eng.letterbox(true, 0.01);
  (window as any).__music?.setMood('intro');
  try {
    // ================================================================ 1. SHOW YOUR BOUNTY
    phase('poster');
    const pc = posterTop.clone().addScaledVector(UP, -PH * 0.5);
    shot(pc.clone().addScaledVector(nP, 1.05).addScaledVector(lat, -0.22).add(new THREE.Vector3(0, 0.05, 0)), pc, 38, false);
    void eng.fadeIn(1.6);
    eng.audio.play('paper_flutter', { volume: 0.7 });
    eng.audio.play('whoosh_big', { volume: 0.35, pitch: 0.5 });
    // a slow push-in on the flapping sheet while he walks up out of the sun (his shadow climbs the paper)
    // (he stops a couple of metres out, behind the camera: only his shadow is on the paper yet)
    walkAmt = 0.85;
    const from = actor.root.position.clone();
    const stop = Q.clone().addScaledVector(nP, 2.4);
    stop.y = gy(stop);
    await runFor(4.6, (k, t) => {
      const e = ease(k);
      shot(pc.clone().addScaledVector(nP, 1.05 - e * 0.32).addScaledVector(lat, -0.22 + e * 0.08).add(new THREE.Vector3(0, 0.05 - e * 0.12, 0)), pc.clone().add(new THREE.Vector3(0, -0.06 * e, 0)), 38 - e * 4, true);
      actor.root.position.lerpVectors(from, stop, Math.min(1, t / 4.4));
      if (t > 2.0 && t < 2.05) eng.audio.play('paper_flutter', { volume: 0.5, pitch: 1.2 });
    });
    walkAmt = 0;
    // the reward line, then up to the face
    await runFor(1.8, (k) => {
      const e = ease(k);
      const lookAt = pc.clone().add(new THREE.Vector3(0, -PH * 0.36 + e * PH * 0.5, 0));
      shot(pc.clone().addScaledVector(nP, 0.68).addScaledVector(lat, -0.12).add(new THREE.Vector3(0, -0.2 + e * 0.32, 0)), lookAt, 34, true);
    });
    // over his right shoulder: he steps up, the bone hand reaches in and closes on the sheet
    const ap0 = S0.clone();
    ap0.y = gy(ap0);
    shot(ap0.clone().addScaledVector(nP, 0.72).addScaledVector(lat, 0.8).add(new THREE.Vector3(0, shoulderY + 0.12, 0)), pc.clone().addScaledVector(lat, 0.05), 44, false);
    walkAmt = 0.7;
    await runFor(0.8, (k) => actor.root.position.lerpVectors(stop, ap0, ease(k)));
    walkAmt = 0;
    armPose = 'reach';
    armSpeed = 4;
    actor.setExpression('focus');
    eng.audio.play('skeleton_rattle', { volume: 0.4 });
    await runFor(1.0, () => {});
    if (poster && !skipped) {
      poster.grab(handW.clone());
      eng.audio.play('paper_flutter', { volume: 0.8, pitch: 0.8 });
    }
    await runFor(0.45, () => {});
    // RIP
    armPose = 'yank';
    armSpeed = 14;
    await runFor(0.12, () => {});
    poster?.tear();
    eng.audio.play('page_turn', { volume: 1, pitch: 0.55 });
    eng.audio.play('whoosh', { volume: 0.7, pitch: 1.4 });
    d.particles.emit({ pos: posterTop.clone().addScaledVector(nP, 0.05), count: 14, spread: 1.4, up: 0.8, life: [0.6, 1.3], size: [0.04, 0.025], sprite: ['linen', 'grain0'], color: [0xf2e2bc, 0xd8c08e], gravity: 3, drag: 1.5 });
    cam.addTrauma(0.18);
    await runFor(0.7, () => {});
    // he reads it, then folds it into his coat; Pinch has opinions
    armPose = 'read';
    armSpeed = 4;
    headLook = 1;
    const ap1 = actor.root.position.clone();
    shot(ap1.clone().addScaledVector(lat, 1.9).addScaledVector(nP, -1.1).add(new THREE.Vector3(0, 1.45, 0)), ap1.clone().add(new THREE.Vector3(0, 1.35, 0)).addScaledVector(nP, -0.25), 40, false);
    await runFor(1.6, () => {});
    actor.setExpression('smug');
    eng.audio.play('scorpion_chitter', { volume: 0.8 });
    await say('pinch', '*click click*  (a million!)', 0.4);
    await say('sundown', "A million, and my name back. Reckon that's a fair price.", 0.5);
    armPose = 'tuck';
    eng.audio.play('page_turn', { volume: 0.6 });
    await runFor(0.8, (k) => poster && (poster.fold = ease(k)));
    if (poster) poster.visible = false;
    headLook = 0;

    // ================================================================ 2. WALK THE DUNES AT GOLDEN HOUR
    phase('walk');
    draw();
    armPose = 'gun';
    actor.setExpression('determined');
    const walkFrom = p.clone().addScaledVector(fwd, -10).addScaledVector(side, 0.6);
    const walkTo = p.clone().addScaledVector(fwd, -1.1);
    walkFrom.y = gy(walkFrom);
    actor.root.position.copy(walkFrom);
    actor.root.rotation.y = Math.atan2(fwd.x, fwd.z);
    walkAmt = 1;
    windSand = 1;
    // wide: into the low sun, a silhouette on the crest; the place name floats in the sky
    const mid = walkFrom.clone().lerp(walkTo, 0.35);
    const title = text("SERKET'S REACH", mid.clone().addScaledVector(sunH, 34).add(new THREE.Vector3(0, 13, 0)), { size: 2.6, color: '#ffe8b8', glow: '#ff9a3a', cps: 18, wrap: 40, hdr: 1.6 });
    const sub = text('where the sand remembers every bone', mid.clone().addScaledVector(sunH, 34).add(new THREE.Vector3(0, 10.4, 0)), { size: 0.85, color: '#fff3d6', glow: '#ffb070', cps: 40, wrap: 60, hdr: 1.3 });
    sub.show(false);
    eng.audio.play('whoosh_big', { volume: 0.5, pitch: 0.6 });
    await runFor(4.4, (k, t) => {
      actor.root.position.lerpVectors(walkFrom, walkTo, k * 0.42);
      if (t > 1.4) sub.show(true);
      const cpos = mid.clone().addScaledVector(sunH, -9.5 + k * 1.2).addScaledVector(fwd, 4 - k * 2).add(new THREE.Vector3(0, 0.7, 0));
      shot(cpos, actor.root.position.clone().add(new THREE.Vector3(0, 1.4 + (1 - k) * 2.5, 0)).addScaledVector(sunH, 6), 36, true);
    });
    title.show(false);
    sub.show(false);
    // tracking alongside, low: the gun spins, boots kick sand, Pinch rides
    await runFor(4.2, (k, t) => {
      actor.root.position.lerpVectors(walkFrom, walkTo, 0.42 + k * 0.58);
      spinRate = (t > 0.6 && t < 2.2) || (t > 2.9 && t < 3.9) ? 16 : 0;
      if (t > 0.6 && t < 0.65) eng.audio.play('rev_spin', { volume: 0.7 });
      if (t > 2.9 && t < 2.95) eng.audio.play('rev_spin', { volume: 0.7, pitch: 1.1 });
      if (spinRate === 0) spin += (Math.round(spin / (Math.PI * 2)) * Math.PI * 2 - spin) * 0.25;
      const ap = actor.root.position;
      const cp = ap.clone().addScaledVector(fwd, 3.4 - k * 0.6).addScaledVector(sunH, 1.9).add(new THREE.Vector3(0, 0.85, 0));
      shot(cp, ap.clone().add(new THREE.Vector3(0, 1.15, 0)), 42, true);
    });
    walkAmt = 0;
    spinRate = 0;
    spin = Math.round(spin / (Math.PI * 2)) * Math.PI * 2;
    windSand = 0.5;

    // ================================================================ 3. THE SCORPION GIRL RISES
    phase('rise');
    const ap = actor.root.position.clone();
    eng.audio.play('quake_rumble', { volume: 0.9 });
    actor.setExpression('surprised');
    cam.addTrauma(0.35);
    eng.audio.play('scorpion_chitter', { volume: 0.7, pitch: 1.3 });
    const behind = ap.clone().addScaledVector(fwd, -2.8).addScaledVector(side, 1.2).add(new THREE.Vector3(0, 1.6, 0));
    shot(behind, soulAt.clone().add(new THREE.Vector3(0, 0.6, 0)), 50, true);
    // the sigil traces itself into the sand; the first grains lift
    eng.audio.play('divine_chime', { volume: 0.7 });
    eng.audio.play('sand_rise', { volume: 0.9 });
    await runFor(2.6, (k) => {
      sigil.reveal = ease(k);
      vortex.intensity = k * 0.5;
      vortex.height = 2 + k * 2;
      if (Math.random() < 0.35) {
        const a = Math.random() * Math.PI * 2, r = 3.6 + Math.random() * 0.6;
        d.fx.sandBurst({ x: soulAt.x + Math.cos(a) * r, y: soulAt.y, z: soulAt.z + Math.sin(a) * r }, 0.6);
      }
    });
    // the vortex climbs, the hieroglyph rings assemble out of the whirl
    eng.audio.play('whoosh_big', { volume: 0.8 });
    eng.audio.play('spectral_scorpion', { volume: 0.5, pitch: 0.7 });
    actor.setExpression('focus');
    headLook = -1;
    await runFor(2.6, (k) => {
      vortex.intensity = 0.5 + k * 0.7;
      vortex.height = 4 + k * 4;
      rings.appear = ease(Math.min(1, k * 1.3));
      const a = k * 0.7;
      const cp = soulAt.clone().addScaledVector(fwd, -9 + k * 1.5).addScaledVector(side, Math.sin(a) * 5 - 1).add(new THREE.Vector3(0, 1.3 + k * 2.2, 0));
      shot(cp, soulAt.clone().add(new THREE.Vector3(0, 1.6 + k * 1.2, 0)), 48, true);
      if (Math.random() < 0.3) spiritMotes(d.particles, { x: soulAt.x, y: soulAt.y + Math.random() * 4, z: soulAt.z }, 2, 2.4, 1.5);
    });
    // her body forms out of the sand, from the heart outward
    eng.audio.play('divine_power', { volume: 0.7 });
    eng.audio.play('sand_rise', { volume: 0.8, pitch: 1.2 });
    await runFor(3.4, (k) => {
      const e = ease(k);
      vortex.gather = e;
      spirit.form = Math.min(1, e * 1.05);
      spirit.glow = 0.4 * e;
      spirit.spirit = 0;
      rings.spread = 1 - e * 0.25;
      const a = 0.4 - k * 0.9;
      const cp = soulAt.clone().addScaledVector(fwd, -6.5).addScaledVector(side, Math.sin(a) * 3.2).add(new THREE.Vector3(0, 0.6 + k * 0.5, 0));
      shot(cp, soulAt.clone().add(new THREE.Vector3(0, soulH * (0.45 + 0.2 * k), 0)), 46 - k * 6, true);
      if (Math.random() < 0.2) d.fx.dust({ x: soulAt.x + (Math.random() - 0.5) * 3, y: soulAt.y + 0.1, z: soulAt.z + (Math.random() - 0.5) * 3 }, 0.4, 0xe6cf9f, 1);
    });
    // ...and ignites
    spirit.form = 1;
    eng.flash(0x9dffc8, 0.7, 0.6);
    eng.audio.play('resurrect', { volume: 0.8 });
    eng.audio.play('spectral_scorpion', { volume: 1 });
    cam.addTrauma(0.3);
    d.fx.sandBurst({ x: soulAt.x, y: soulAt.y + 0.1, z: soulAt.z }, 1.1);
    d.particles.emit({ pos: { x: soulAt.x, y: soulAt.y + soulH * 0.4, z: soulAt.z }, count: 90, spread: 9, up: 3, life: [0.6, 1.4], size: [0.07, 0.04], sprite: ['grain0', 'grain1', 'grain2', 'grain3'], color: [0xf6dfb0, 0xeccb8f, 0xe0b373], gravity: 9, drag: 0.6, ground: true });
    d.fx.ring({ x: soulAt.x, y: soulAt.y + 0.15, z: soulAt.z }, 0x9dffc8, 9, 0.8);
    spiritMotes(d.particles, { x: soulAt.x, y: soulAt.y + soulH * 0.5, z: soulAt.z }, 40, 1.6, 2.4);
    spirit.setExpression('happy');
    spirit.flick();
    spirit.snip();
    const low = soulAt.clone().addScaledVector(fwd, -7.2).addScaledVector(side, -2.6);
    low.y = world.groundAt(low.x, low.z) + 0.75;
    await runFor(1.8, (k) => {
      const e = ease(k);
      spirit.spirit = e;
      spirit.glow = 0.4 + e * 0.6;
      vortex.gather = 1 - e * 0.3;
      vortex.burst = e;
      vortex.intensity = 1.2 * (1 - e);
      rings.spread = 0.75 - e * 0.12;
      sigil.fade = 1 - e * 0.5;
      shot(low.clone().add(new THREE.Vector3(0, e * 0.3, 0)), soulAt.clone().add(new THREE.Vector3(0, soulH * 0.62, 0)), 40, true);
    });
    vortex.intensity = 0;
    vortex.burst = 0;
    spirit.look = actor.root.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    spirit.pose = 'open';

    // ================================================================ 4. SHE SPEAKS
    phase('talk');
    actor.setExpression('surprised');
    const shoulder = ap.clone().addScaledVector(fwd, -2.4).addScaledVector(side, 1.1).add(new THREE.Vector3(0, 1.75, 0));
    // her close-up: from his side of the circle, a little below her eyes
    const herClose = soulAt.clone().addScaledVector(fwd, -4.4).addScaledVector(side, 1.3).add(new THREE.Vector3(0, soulH * 0.5, 0));
    const herShot = (wide = false) => (wide ? shot(shoulder, soulAt.clone().add(new THREE.Vector3(0, soulH * 0.62, 0)), 46, true) : shot(herClose, soulAt.clone().add(new THREE.Vector3(0, soulH * 0.66, 0)).addScaledVector(side, 0.25), 40, true));
    const hisShot = () => shot(ap.clone().addScaledVector(fwd, 3.0).addScaledVector(side, 1.5).add(new THREE.Vector3(0, 1.45, 0)), ap.clone().add(new THREE.Vector3(0, 1.45, 0)).addScaledVector(side, 0.8), 44, true);
    herShot(true);
    await say('serket', 'Easy, bone-rider. Holster that glare. I am the one who stitched you back together.', 1.0);
    spirit.pose = 'present';
    hisShot();
    actor.setExpression('determined');
    const a1 = await ask(['Who in tarnation are you?', "Evenin', ma'am.  *tips hat*", "Lady, I'm on the clock."]);
    phase('reply');
    if (a1 === 1) {
      armPose = 'read';
      eng.audio.play('skeleton_rattle', { volume: 0.4 });
    }
    herShot();
    spirit.setExpression(a1 === 2 ? 'smug' : 'happy');
    await say(
      'serket',
      [
        'Serket. Goddess of scorpions, healer of stings, patron saint of hopeless causes. Hello, cause.',
        'Manners! On a skeleton! Pinch, you have raised him well.',
        'I see. Sethos, a million dollars, one pistol, no plan. My favourite kind of fool.',
      ][a1],
      1.0
    );
    armPose = 'gun';
    spirit.pose = 'open';
    spirit.setExpression('stern');
    await say('serket', 'Set has swallowed my desert in his storm. Sethos rides at its eye, and a hundred waves of his dead ride before him.', 1.1);
    hisShot();
    spirit.setExpression('neutral');
    const a2 = await ask(["And you want him gone.", "What's in it for me?", "Pinch, you hearin' this?"]);
    herShot();
    if (a2 === 2) {
      eng.audio.play('scorpion_chitter', { volume: 0.8 });
      await say('pinch', '*click click click*', 0.5);
      spirit.setExpression('laugh');
    } else spirit.setExpression('smug');
    spirit.pose = 'present';
    await say(
      'serket',
      [
        'I want my sands back. You want your name back. Funny how the stars line up.',
        'Your name, bone-rider. Every bounty you bring down, I carve one letter of it back onto your soul.',
        'He says you are rusty, reckless and you snore. He adores you.',
      ][a2],
      1.0
    );
    spirit.pose = 'beckon';
    spirit.setExpression('happy');
    spirit.snip();
    await say('serket', 'But the dunes are cruel, and you are rusty. Throw that board down. Let me see what those bones remember.', 0.8);

    // ================================================================ 5. BOARD DOWN
    phase('board');
    hisShot();
    armPose = 'throw';
    armSpeed = 9;
    actor.setExpression('smug');
    await runFor(0.35, () => {});
    // the board comes off his back and slaps flat on the sand where his ride begins
    const bw = new THREE.Vector3();
    boardOnBack.getWorldPosition(bw);
    const bq = new THREE.Quaternion();
    boardOnBack.getWorldQuaternion(bq);
    boardOnBack.removeFromParent();
    d.scene.add(boardOnBack);
    boardOnBack.position.copy(bw);
    boardOnBack.quaternion.copy(bq);
    const bTo = p.clone().add(new THREE.Vector3(0, 0.08, 0));
    const qTo = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, player.board.heading, 0));
    eng.audio.play('whoosh', { volume: 0.7 });
    await runFor(0.5, (k) => {
      boardOnBack.position.lerpVectors(bw, bTo, k);
      boardOnBack.position.y += Math.sin(k * Math.PI) * 0.8;
      boardOnBack.quaternion.slerpQuaternions(bq, qTo, ease(k));
    });
    eng.audio.play('board_land', { volume: 0.9 });
    d.fx.sandBurst({ x: p.x, y: p.y, z: p.z }, 1.0);
    armPose = 'gun';
    // hop on
    const hopFrom = actor.root.position.clone();
    eng.audio.play('board_jump', { volume: 0.8 });
    await runFor(0.45, (k) => {
      actor.root.position.lerpVectors(hopFrom, p, k);
      actor.root.position.y = gy(actor.root.position) + Math.sin(k * Math.PI) * 0.7;
    });
    actor.root.visible = false;
    boardOnBack.visible = false;
    if (backBoard) backBoard.visible = false;
    player.rig.root.visible = true;
    player.boardMesh.visible = true;
    if (skills) skills.pinchRoot.visible = pinchWasVisible;
    eng.audio.play('board_land', { volume: 0.9 });
    d.fx.sandBurst({ x: p.x, y: p.y, z: p.z }, 1.2);
    // she shrinks to a guide's size and settles at his side; the circle goes dark
    const gs = guideSpot(p, cam.yaw, world.groundAt);
    const sFrom = spirit.root.position.clone();
    const behindP = p.clone().addScaledVector(fwd, -5).addScaledVector(side, 1.2).add(new THREE.Vector3(0, 2.2, 0));
    spirit.pose = 'idle';
    spirit.look = p.clone().add(new THREE.Vector3(0, 1.2, 0));
    eng.audio.play('soul_leave', { volume: 0.6, pitch: 1.3 });
    await runFor(1.5, (k, _t, dt) => {
      const e = ease(k);
      spirit.root.position.lerpVectors(sFrom, gs.pos, e);
      spirit.root.position.y += Math.sin(k * Math.PI) * 1.2;
      spirit.root.rotation.y = gs.yaw;
      spirit.scale = SOUL_SCALE + (gs.scale - SOUL_SCALE) * e;
      rings.fade = 1 - e;
      sigil.fade = 0.5 * (1 - e);
      if (Math.random() < dt * 30) spiritMotes(d.particles, spirit.root.position.clone().add(new THREE.Vector3(0, 1, 0)), 1, 0.6, 0.6);
      shot(behindP, p.clone().add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(fwd, 2), 58, true);
      if (basePreset && golden) env.lerpPreset?.(golden, basePreset, e);
    });
  } finally {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    skip.remove();
    for (const t of texts) t.dispose();
    poster?.dispose();
    poster = null;
    for (const o of own) o.removeFromParent();
    boardOnBack.removeFromParent();
    for (const f of disposers) f();
    spirit.dispose();
    rings.dispose();
    sigil.dispose();
    vortex.dispose();
    if (basePreset) env.apply?.(basePreset);
    if (skills) skills.pinchRoot.visible = pinchWasVisible;
    player.rig.root.visible = true;
    player.boardMesh.visible = true;
    cam.setCine(null);
    eng.letterbox(false, 0.5);
    eng.input.enabled = true;
    if (skipped) void eng.fadeIn(0.3);
    (window as any).__music?.setMood('explore');
    phase('done');
  }
  return { skipped };
}
