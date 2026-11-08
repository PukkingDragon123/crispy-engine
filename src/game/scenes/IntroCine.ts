// Opening cinematic (NEW RUN, about 85 s; SPACE / ESC / the SKIP label skips):
//   0. COLD OPEN (cine/ColdOpen.ts, ~12.5 s) - Sundown staggers out of a saloon
//      toward the lens in slow motion while it blows up behind him (voxel
//      fireball, shattered building, burning debris raining, a shock ring through
//      the sand), the wagon goes up too, and "dustUP" bursts out of the sand in
//      voxel-cast gold. He looks up into the lens, turns side-on and shoots it:
//      a bullet hole punches through the glass (cine/LensShot.ts), time freezes,
//      and the view flies into the hole until it burns white.
//      0b. Out of the white: the blinding hot desert sun, the air boiling, the
//      signpost and its flapping sheet against the glare, and a drunk skeleton
//      silhouette staggering out of the sun toward it.
//   1. SHOW YOUR BOUNTY - his own WANTED bill nailed to the signpost snaps in the
//      golden-hour wind: DEAD OR ALIVE, SUNDOWN, NAME UNKNOWN, $1,000,000. The
//      portrait is his real rig photographed (CardStudio) in deep shadow under
//      the brim, only the glowing eyes and the bandana catching light, pressed
//      into a chunky pixel-art print (ui/WantedPrint.ts) on shader paper
//      pixelated on the same grid (Verlet cloth: it flaps, curls and tears). His
//      shadow falls across it; his bone hand rips it off its nails.
//   2. He walks the dunes at golden hour, board slung on his back, Pinch on his
//      shoulder, revolver twirling; footsteps kick up sand, pixel grit streams by.
//   3. The ground trembles. A sigil of light traces itself into the sand, sand
//      spirals up into a vortex, rings of 3D hieroglyphs assemble, and Serket's
//      spirit avatar - the scorpion girl - is built out of the sand from her core
//      outward, then ignites into jade light (bloom, flash, motes).
//   4. She talks in floating 3D words; you answer (1 / 2 / 3, click or tap);
//      she has him throw his board down, and shrinks to a guide at his side.
// He walks drunk everywhere (anim/drunkWalk.ts).
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
import { ATMO } from '../../engine/render/VoxelMaterial';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { modelEntry } from '../models/lookup';
import { FloatText3D } from '../fx/FloatText3D';
import { Voice } from '../audio/Voice';
import { mysteryPhoto, paintWantedPrint, pressPrint, PRINT_W, PRINT_H } from '../ui/WantedPrint';
import { PARCHMENT_GLSL } from '../ui/Choice';
import { GlyphRings, LightSigil, SandVortex, SerketSpirit, spiritMotes, guideSpot } from '../fx/SerketSpirit';
import { Skills } from '../player/Skills';
import * as CH from '../models/characters';
import { playColdOpen } from '../cine/ColdOpen';
import { LensShot } from '../cine/LensShot';
import { DrunkGait } from '../anim/drunkWalk';

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

// the paper is printed on the same pixel grid as the ink: snapped UVs, a few dithered tones
const POSTER_PAPER = /* glsl */ `
{
  vec2 pPix = floor(vMapUv * uGrid);
  vec2 pUv = (pPix + 0.5) / uGrid;
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
  pCol = floor(pCol * 10.0 + bayer4(pPix)) / 10.0;
  vec3 pLin = pow(pCol, vec3(2.2));
  vec4 pInk = texture2D(map, pUv);
  // a cheap press: here and there a pixel takes the ink thin
  float pPress = 0.78 + 0.22 * step(0.3, pHash(pPix * 0.0731 + 3.1));
  if (gl_FrontFacing) {
    pLin = mix(pLin, pInk.rgb * mix(vec3(1.0), pLin * 1.1, 0.2), pInk.a * pPress);
    // the eyes are printed in a luminous ink
    float pEye = pInk.a * step(0.7, pInk.g) * step(pInk.r, 0.75) * step(pInk.b, 0.5);
    totalEmissiveRadiance += vec3(0.32, 1.0, 0.18) * pEye * 0.7;
  } else {
    pLin = mix(pLin, pLin * 0.78, pInk.a * 0.3);
    // the low sun shines through the sheet from behind
    totalEmissiveRadiance += pLin * uBack * (1.0 - pInk.a * 0.75);
  }
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
uniform float uAspect, uTorn, uScrap, uBack;
uniform vec2 uGrid;
uniform vec4 uNails;
${PARCHMENT_GLSL}
float bayerB2(vec2 p){ return mod(2.0 * p.x + 3.0 * p.y, 4.0); }
float bayer4(vec2 p){ vec2 q = mod(p, 4.0); return (4.0 * bayerB2(mod(q, 2.0)) + bayerB2(floor(q / 2.0)) + 0.5) / 16.0; }
float tornHole(vec2 uv, vec2 at){
  vec2 d = (uv - at) * vec2(uAspect, 1.0);
  float a = atan(d.y, d.x);
  return length(d) - (0.05 + 0.03 * pNoise(vec2(a * 3.0, at.x * 40.0)) + 0.014 * pNoise(vec2(a * 9.0, 3.0)));
}`
      )
      .replace('#include <map_fragment>', POSTER_PAPER);
  };
  m.customProgramCacheKey = () => 'dustup-intro-wanted-px';
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
  private u = { uAspect: { value: PW / PH }, uSeed: { value: Math.random() }, uTorn: { value: 0 }, uNails: { value: new THREE.Vector4(4 / 9, 0.975, 5 / 9, 0.975) }, uGrid: { value: new THREE.Vector2(PRINT_W, PRINT_H) }, uBack: { value: 0.3 } };
  pts: ClothPt[] = [];
  private springs: [number, number, number, number][] = [];
  private nails: THREE.Vector3[] = [];
  private lat: THREE.Vector3;
  hand: THREE.Vector3 | null = null;
  torn = false;
  /** 0..1: folded away into a coat */
  fold = 0;
  /** the post's front face (m from its axis, along the sheet's normal) and half width */
  face = 0.08;
  halfW = 0.085;
  /** how much the low sun shines through the back of the sheet */
  set backlight(v: number) {
    this.u.uBack.value = v;
  }

  constructor(scene: THREE.Scene, ink: HTMLCanvasElement, private top: THREE.Vector3, private n: THREE.Vector3, private postAxis: THREE.Vector3, private ground: (x: number, z: number) => number) {
    this.lat = new THREE.Vector3().crossVectors(UP, n).normalize();
    this.ink = new THREE.CanvasTexture(ink);
    this.ink.colorSpace = THREE.SRGBColorSpace;
    this.ink.magFilter = THREE.NearestFilter;
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
          const dl = tmp.dot(lat), dn = tmp.dot(n) - this.face;
          const lim = Math.abs(dl) < this.halfW ? 0.003 : -0.16;
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

  /** hang it flat again (on a cut) */
  reset() {
    for (const q of this.pts) {
      q.p.copy(q.rest);
      q.o.copy(q.rest);
    }
    this.writeMesh();
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
  // how far the post's face stands proud of its axis where the sheet hangs (the hewn post is not a slim pole)
  let postFace = 0.08, postHalf = 0.085;
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
      // the post's -Z side faces the sun (and the sheet): measure it over the sheet's height band
      const y0 = b.minY + Math.floor(0.85 / e.voxelSize), y1 = b.minY + Math.floor(1.85 / e.voxelSize);
      let zMin = 0, xMax = 0;
      e.model.forEach((x, y, z) => {
        if (y < y0 || y > y1 || Math.abs(x) > 8 || Math.abs(z) > 8) return;
        zMin = Math.min(zMin, z);
        xMax = Math.max(xMax, Math.abs(x));
      });
      postFace = Math.max(0.08, (0.5 - zMin) * e.voxelSize);
      postHalf = Math.max(0.085, (xMax + 0.5) * e.voxelSize + 0.01);
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
  let walkAmt = 0, spin = 0, spinRate = 0, headPitch = 0;
  const gait = new DrunkGait(11.3);
  let armPose = 'relax';
  const armCur: Record<string, THREE.Vector3> = { arm_r: new THREE.Vector3(...ARM.relax.arm_r), fore_r: new THREE.Vector3(...ARM.relax.fore_r) };
  let armSpeed = 6;
  let headLook = 0; // 0 ahead, 1 down at the poster in hand, -1 up at her
  // the poster (top centre on the post's face, a little above shoulder height)
  const topY = Q.y + THREE.MathUtils.clamp(shoulderY + 0.4, 1.55, 1.95);
  const lat = new THREE.Vector3().crossVectors(UP, nP).normalize();
  const posterTop = new THREE.Vector3(Q.x, topY, Q.z).addScaledVector(nP, postFace);
  // his own bill: his rig photographed in shadow under the brim, pressed into a pixel-art print
  const photo = mysteryPhoto(eng.renderer, player.rig.geo);
  const wantedInk = paintWantedPrint(photo ? pressPrint(photo) : null);
  Object.assign(window as any, { __wantedInk: wantedInk, __wantedPhoto: photo }); // dev: inspect the print
  let poster: WantedPoster | null = new WantedPoster(d.scene, wantedInk, posterTop, nP, new THREE.Vector3(Q.x, 0, Q.z), ground);
  poster.face = postFace;
  poster.halfW = postHalf;
  // the lens he shoots at the end of the cold open (then the heat shimmer and the sun's glare)
  const lens = new LensShot(eng);
  let lensLive = false;
  disposers.push(() => lens.dispose());
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
    (window as any).__phaseT = T - phaseAt;
    // ---- Sundown (three whiskeys deep)
    gait.update(dt, 6.2, walkAmt);
    gait.pose(actor.nodes, { armL: true, armR: false, head: false });
    actor.root.position.y = gy(actor.root.position);
    if (walkAmt > 0.3 && gait.stepped) {
      eng.audio.play('footstep_sand', { volume: 0.35, pitch: 0.9 + Math.random() * 0.2 });
      const fp = actor.nodes[gait.foot === 1 ? 'shin_l' : 'shin_r']?.getWorldPosition(new THREE.Vector3()).setY(actor.root.position.y) ?? actor.root.position;
      d.fx.dust({ x: fp.x, y: fp.y + 0.05, z: fp.z }, 0.25, 0xe6cf9f, 2);
      d.particles.emit({ pos: { x: fp.x, y: fp.y + 0.04, z: fp.z }, count: 5, spread: 1.2, up: 1.2, life: [0.4, 0.8], size: [0.05, 0.03], sprite: ['grain0', 'grain1', 'grain2'], color: [0xf6dfb0, 0xe0b373], gravity: 9, ground: true });
    }
    spin += spinRate * dt;
    holder.rotation.x = Math.PI / 2 + spin;
    const target = ARM[armPose] ?? ARM.relax;
    const kk = 1 - Math.exp(-dt * armSpeed);
    for (const j of ['arm_r', 'fore_r'] as const) armCur[j].lerp(new THREE.Vector3(...target[j]), kk);
    // the gun arm keeps its pose but hangs loose on the stagger
    actor.nodes['arm_r']?.rotation.set(armCur.arm_r.x + gait.armR.x * 0.3, armCur.arm_r.y, armCur.arm_r.z + gait.armR.z * 0.3);
    actor.nodes['fore_r']?.rotation.set(armCur.fore_r.x + (gait.armR.fore + 0.28 * gait.amt) * 0.25, armCur.fore_r.y, armCur.fore_r.z);
    const n = actor.nodes;
    headPitch += ((headLook > 0 ? 0.32 * headLook : headLook < 0 ? -0.3 : -0.04 * (1 - walkAmt)) - headPitch) * Math.min(1, dt * 5);
    n['head']?.rotation.set(headPitch + gait.head.x, gait.head.y, gait.head.z);
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
    if (lensLive) {
      lens.track(camera, ATMO.sunDir);
      lens.sync();
    }
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
    while ((window as any).__cineHold && !skipped) await eng.tweens.wait(0.016, true); // dev: freeze for a screenshot
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
  let phaseAt = 0;
  const phase = (n: string) => {
    (window as any).__introPhase = n;
    phaseAt = T;
  };
  player.rig.root.visible = false;
  player.boardMesh.visible = false;
  eng.input.enabled = false;
  eng.letterbox(true, 0.01);
  (window as any).__music?.setMood('intro');
  try {
    // ================================================================ 0. COLD OPEN
    phase('coldopen');
    await playColdOpen({ engine: eng, cam, world, scene: d.scene, player, skipped: () => skipped, dtCap, lens });
    last = performance.now();
    // ================================================================ 0b. THROUGH THE HOLE: THE HOT DESERT SUN
    // out of the white, into the glare: the sign and its sheet against the sun, the air boiling,
    // and a lone skeleton staggering out of the light toward it
    phase('sun');
    lensLive = true;
    const hot = golden ? { ...golden, sunColor: 0xfff0d0, sunIntensity: golden.sunIntensity * 1.2, horizon: 0xffd29a, clouds: 0.3 } : null;
    if (!skipped) {
      if (hot) env.apply?.(hot);
      Object.assign(lens, { on: 0, push: 0, crack: 0, burn: 0, light: 0, white: 1, blaze: 1, glare: 0.9, shimmer: 1 });
      if (poster) poster.backlight = 1.1;
      const far = S0.clone().addScaledVector(nP, 10.5);
      far.y = gy(far);
      actor.root.position.copy(far);
      walkAmt = 0.85;
      // low behind the post: the sun hangs just above the walker's hat, the post and its sheet to one side
      const sunCam = Q.clone().addScaledVector(nP, -2.7).addScaledVector(lat, 0.75);
      sunCam.y = gy(sunCam) + 0.5;
      const sunLook = Q.clone().addScaledVector(nP, 6.5);
      sunLook.y = gy(sunLook) + 1.5;
      eng.audio.play('whoosh_big', { volume: 0.5, pitch: 0.4 });
      eng.audio.play('sand_spray', { volume: 0.4, pitch: 0.7 });
      let cut = true;
      await runFor(2.9, (k, t) => {
        actor.root.position.lerpVectors(far, actorPos, k);
        lens.white = 1 - (1 - Math.pow(1 - Math.min(1, t / 1.0), 3));
        lens.glare = 0.9 - 0.25 * k;
        lens.blaze = Math.max(1 - t * 1.5, 0.14 - 0.06 * k);
        const cp = sunCam.clone().addScaledVector(nP, k * 0.45).add(new THREE.Vector3(0, k * 0.08, 0));
        shot(cp, sunLook.clone().add(new THREE.Vector3(0, -0.35 * ease(k), 0)), 40 - k * 3, !cut);
        cut = false;
      });
      // cut to the sheet through a hot flash (the eye adjusts)
      eng.flash(0xfff2d8, 0.65, 0.55);
      if (poster) {
        poster.backlight = 0.3;
        poster.reset();
      }
    }
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
      // the heat haze and the glare settle as the eye adjusts
      lens.white = 0;
      lens.shimmer = 1 - ease(Math.min(1, t / 1.9));
      lens.glare = Math.max(0, 0.6 - t * 0.5);
      lens.blaze = Math.max(0, 0.15 - t * 0.12);
      if (hot && golden && t < 2.2) env.lerpPreset?.(hot, golden, ease(t / 2.2));
      shot(pc.clone().addScaledVector(nP, 1.05 - e * 0.32).addScaledVector(lat, -0.22 + e * 0.08).add(new THREE.Vector3(0, 0.05 - e * 0.12, 0)), pc.clone().add(new THREE.Vector3(0, -0.06 * e, 0)), 38 - e * 4, true);
      actor.root.position.lerpVectors(from, stop, Math.min(1, t / 4.4));
      if (t > 2.0 && t < 2.05) eng.audio.play('paper_flutter', { volume: 0.5, pitch: 1.2 });
    });
    if (hot && golden) env.apply?.(golden);
    Object.assign(lens, { shimmer: 0, glare: 0, blaze: 0, white: 0 });
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
    await say('sundown', "A million on my skull, and Sethos signed it himself. Reckon I'll deliver it personal.", 0.5);
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
