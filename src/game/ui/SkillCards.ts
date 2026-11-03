// The physical upgrade card: the sculpted rarity frame (bronze / silver / gold /
// divine), the vignette photograph in its window, Alagard plaques front and back,
// and real cut gems in the level sockets. Lit by the world like any prop.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { SKILL_CARD, skillFrame, levelGem, SkillRarity } from '../models/props/tarot';
import { RARITY, Offer } from '../run/Upgrades';
import type { StatId } from '../combat/Stats';
import { paintCardFront, paintCardBack, canvasTex } from './CardArt';

const VS = SKILL_CARD.voxelSize;
const frames = new Map<SkillRarity, THREE.BufferGeometry>();
const gems = new Map<string, THREE.BufferGeometry>();
let frameMat: VoxelMaterial | null = null;
let gemMat: VoxelMaterial | null = null;
let backMat: THREE.MeshStandardMaterial | null = null;
let coreGeo: THREE.PlaneGeometry | null = null;

function frameGeo(r: SkillRarity) {
  let g = frames.get(r);
  if (!g) {
    const f = skillFrame(r);
    g = buildVoxelGeometry(f.model, { voxelSize: f.voxelSize, pivot: f.pivot });
    frames.set(r, g);
  }
  return g;
}

function gemGeo(color: number, lit: boolean) {
  const k = color + (lit ? ':1' : ':0');
  let g = gems.get(k);
  if (!g) {
    const m = levelGem(color, lit);
    g = buildVoxelGeometry(m.model, { voxelSize: m.voxelSize, pivot: m.pivot });
    gems.set(k, g);
  }
  return g;
}

/** frame-local metres of a voxel rect's centre and size */
function rect(r: { x0: number; y0: number; x1: number; y1: number }) {
  return {
    x: ((r.x0 + r.x1 + 1) / 2 - SKILL_CARD.W / 2) * VS,
    y: ((r.y0 + r.y1 + 1) / 2 - SKILL_CARD.H / 2) * VS,
    w: (r.x1 - r.x0 + 1) * VS,
    h: (r.y1 - r.y0 + 1) * VS,
  };
}

const ART_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ART_FS = /* glsl */ `
uniform sampler2D map;
uniform float uHas, uT, uHover;
varying vec2 vUv;
void main(){
  // the photo is graded linear light at half scale; the world's post stack tone-maps it
  vec3 c = texture2D(map, vUv).rgb * 2.0;
  // until it is developed: the frame's dark lacquer with a slow shimmer
  float sh = 0.5 + 0.5 * sin(uT * 3.0 + vUv.x * 9.0 - vUv.y * 6.0);
  vec3 wait = vec3(0.06, 0.035, 0.03) + vec3(0.05, 0.035, 0.015) * sh;
  c = mix(wait, c, uHas);
  // hover: a band of light runs over the varnish
  float band = exp(-pow((vUv.x * 0.8 + vUv.y * 0.6 - fract(uT * 0.35) * 2.6 + 0.6) * 6.0, 2.0));
  c += vec3(1.0, 0.93, 0.8) * band * 0.35 * uHover * uHas;
  gl_FragColor = vec4(c, 1.0);
}`;

export interface SkillCard3D {
  offer: Offer;
  group: THREE.Group;
  /** invisible card-sized plane for picking */
  hit: THREE.Mesh;
  hasArt: boolean;
  setArt(t: THREE.Texture | null): void;
  update(dt: number, hover: number): void;
  dispose(): void;
}

export function makeSkillCard(o: Offer, rows: { stat: StatId; before: number; after: number }[]): SkillCard3D {
  frameMat ??= makeVoxelMaterial({ fog: false });
  gemMat ??= makeVoxelMaterial({ fog: false, emissiveStrength: 1.6 });
  const rarity = o.def.rarity as SkillRarity;
  const group = new THREE.Group();
  const frame = new THREE.Mesh(frameGeo(rarity), frameMat);
  frame.castShadow = true;
  group.add(frame);
  // a card-stock core inside the slab: any sub-pixel crack in the voxel relief shows card, not sky
  backMat ??= new THREE.MeshStandardMaterial({ color: 0xa88c62, roughness: 0.95, side: THREE.DoubleSide });
  const core = new THREE.Mesh(coreGeo ??= new THREE.PlaneGeometry(SKILL_CARD.W * VS - 0.006, SKILL_CARD.H * VS - 0.006), backMat);
  core.position.z = -0.005;
  group.add(core);
  const owned: { dispose(): void }[] = [];
  // the photograph in the window
  const C = SKILL_CARD;
  const wr = rect(C.win);
  const artMat = new THREE.ShaderMaterial({ uniforms: { map: { value: null }, uHas: { value: 0 }, uT: { value: 0 }, uHover: { value: 0 } }, vertexShader: ART_VS, fragmentShader: ART_FS });
  const artGeo = new THREE.PlaneGeometry(wr.w, wr.h);
  const art = new THREE.Mesh(artGeo, artMat);
  art.position.set(wr.x, wr.y, VS + 0.0004);
  group.add(art);
  owned.push(artMat, artGeo);
  // typography on the plaques (front faces +Z, back plaques face −Z)
  const plaque = (cv: HTMLCanvasElement, r: { x0: number; y0: number; x1: number; y1: number }, z: number, back = false) => {
    const q = rect(r);
    const tex = canvasTex(cv);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    const geo = new THREE.PlaneGeometry(q.w, q.h);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(q.x, q.y, z);
    if (back) m.rotation.y = Math.PI;
    m.renderOrder = 2;
    group.add(m);
    owned.push(tex, mat, geo);
  };
  const ft = paintCardFront(o);
  plaque(ft.crest, C.crest, 3 * VS + 0.0005);
  plaque(ft.name, C.name, 3 * VS + 0.0005);
  plaque(ft.desc, C.desc, 2 * VS + 0.0005);
  const bt = paintCardBack(o, rows);
  plaque(bt.plaque, C.back.plaque, -4 * VS - 0.0005, true);
  plaque(bt.panel, C.back.panel, -3 * VS - 0.0005, true);
  // level gems: lit up to the new level, the new one pulses
  const gemCol = RARITY[o.def.rarity].hex;
  const gemMeshes: THREE.Mesh[] = [];
  const total = Math.min(5, o.def.maxLv);
  const first = Math.floor((5 - total) / 2);
  for (let i = 0; i < total; i++) {
    const lit = i < o.toLv;
    const [gx, gy] = C.gems[first + i];
    const g = new THREE.Mesh(gemGeo(gemCol, lit), lit ? gemMat : frameMat);
    g.position.set((gx + 0.5 - C.W / 2) * VS, (gy + 0.5 - C.H / 2) * VS, 2 * VS);
    g.userData.isNew = i === o.toLv - 1;
    group.add(g);
    gemMeshes.push(g);
  }
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(C.W * VS, C.H * VS), new THREE.MeshBasicMaterial({ visible: false }));
  group.add(hit);
  owned.push(hit.geometry, hit.material as THREE.Material);
  let t = Math.random() * 10;
  let has = 0;
  const card: SkillCard3D = {
    offer: o,
    group,
    hit,
    hasArt: false,
    setArt(tex) {
      artMat.uniforms.map.value = tex;
      card.hasArt = !!tex;
    },
    update(dt, hover) {
      t += dt;
      has = card.hasArt ? Math.min(1, has + dt * 2.5) : 0;
      artMat.uniforms.uHas.value = has * has * (3 - 2 * has);
      artMat.uniforms.uT.value = t;
      artMat.uniforms.uHover.value = hover;
      for (const g of gemMeshes) if (g.userData.isNew) g.scale.setScalar(1 + Math.max(0, Math.sin(t * 5)) * 0.25);
    },
    dispose() {
      group.removeFromParent();
      for (const d of owned) d.dispose();
    },
  };
  return card;
}
