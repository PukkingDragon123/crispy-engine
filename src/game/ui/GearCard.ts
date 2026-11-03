// The NEW GEAR card: the same sculpted rarity frame as the upgrade cards
// (props/tarot skillFrame), a photograph of the real gear model in its window
// (posed on a little dune and shot through the CardStudio: sky, cel sun, ink,
// bloom, grade), Alagard plaques (the only 2D drawing) and cut gems for the
// rarity. The back carries the ledger: every stat the swap changes.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { SKILL_CARD, skillFrame, levelGem, SkillRarity, duneBed } from '../models/props/tarot';
import { RARITY, Offer, UpgradeDef } from '../run/Upgrades';
import type { StatId } from '../combat/Stats';
import { paintCardBack, canvasTex, TEXT_PPV } from './CardArt';
import { CardStudio, Shot } from './CardStudio';
import { GEAR, GEAR_RARITY_ORDER, GearId, SLOT_INFO, buildGearDisplay, gearGlassMaterial } from '../player/Equipment';

const VS = SKILL_CARD.voxelSize;
const INK = '#2a170c';
const INK_SOFT = '#6a4626';
type Rect = { x0: number; y0: number; x1: number; y1: number };

// ------------------------------------------------------------------ typography (Alagard only)
function surface(r: Rect) {
  const cv = document.createElement('canvas');
  cv.width = (r.x1 - r.x0 + 1) * TEXT_PPV;
  cv.height = (r.y1 - r.y0 + 1) * TEXT_PPV;
  return { cv, c: cv.getContext('2d')! };
}
const font = (px: number) => `${Math.round(px)}px Alagard`;
function capOf(c: CanvasRenderingContext2D) {
  c.font = font(100);
  return (c.measureText('HMX').actualBoundingBoxAscent || 70) / 100;
}
function engrave(c: CanvasRenderingContext2D, t: string, x: number, y: number, color = INK, lip = 0.5) {
  c.fillStyle = `rgba(255,246,222,${lip})`;
  c.fillText(t, x, y + Math.max(1, TEXT_PPV * 0.12));
  c.fillStyle = color;
  c.fillText(t, x, y);
}
function line(cv: HTMLCanvasElement, c: CanvasRenderingContext2D, t: string, capFrac: number, color = INK) {
  const cap = capOf(c);
  let px = (cv.height * capFrac) / cap;
  c.font = font(px);
  const w = c.measureText(t).width;
  if (w > cv.width * 0.94) {
    px *= (cv.width * 0.94) / w;
    c.font = font(px);
  }
  c.textAlign = 'center';
  engrave(c, t, cv.width / 2, cv.height / 2 + (px * cap) / 2, color);
}
function wrap(c: CanvasRenderingContext2D, t: string, maxW: number) {
  const out: string[] = [];
  let l = '';
  for (const w of t.split(/\s+/)) {
    const s = l ? l + ' ' + w : w;
    if (l && c.measureText(s).width > maxW) {
      out.push(l);
      l = w;
    } else l = s;
  }
  if (l) out.push(l);
  return out;
}

function paintFront(id: GearId, label: string) {
  const def = GEAR[id];
  const C = SKILL_CARD;
  const crest = surface(C.crest);
  line(crest.cv, crest.c, `${label} · ${RARITY[def.rarity].name.toUpperCase()}`, 0.5, INK_SOFT);
  const name = surface(C.name);
  line(name.cv, name.c, def.name.toUpperCase(), 0.56);
  const d = surface(C.desc);
  const c = d.c, W = d.cv.width, H = d.cv.height;
  const cap = capOf(c);
  const footPx = H * 0.13;
  const bodyH = H - footPx * 2.3 - H * 0.08;
  let px = H * 0.2;
  let lines: string[] = [];
  for (; px > 14; px *= 0.94) {
    c.font = font(px);
    lines = wrap(c, def.desc, W * 0.9);
    if (lines.length * px * 1.12 <= bodyH) break;
  }
  c.font = font(px);
  c.textAlign = 'center';
  const lh = px * 1.12;
  const y0 = H * 0.06 + (bodyH - lines.length * lh) / 2 + px * cap;
  lines.forEach((l, i) => engrave(c, l, W / 2, y0 + i * lh));
  c.font = font(footPx);
  const foot = `${SLOT_INFO[def.slot].name.toUpperCase()} SLOT` + (def.god ? `  ·  Gift of ${def.god}` : '');
  engrave(c, foot, W / 2, H - footPx * 0.7, INK_SOFT, 0.35);
  return { crest: crest.cv, name: name.cv, desc: d.cv };
}

/** an Offer-shaped stand-in so the upgrade card's ledger painter can draw the back */
function ledgerOffer(id: GearId): Offer {
  const g = GEAR[id];
  const def: UpgradeDef = { id: 'gear:' + id, name: g.name, cat: 'gear', rarity: g.rarity, maxLv: 1, icon: '', desc: () => g.desc, lore: g.lore };
  return { def, fromLv: 0, toLv: 1 };
}

// ------------------------------------------------------------------ the photograph
const ART: [number, number] = [240, 200];

const LOOK = {
  day: {
    sky: { zenith: 0x1d6ccc, mid: 0x5aa6ea, horizon: 0xcde8f4, ground: 0xe8c890, sunDir: [-0.55, 0.5, -1] as [number, number, number], sunColor: 0xfff0c0, sunSize: 0.04, sunGlow: 0.35, clouds: 0.32, cloudLit: 0xffffff, cloudShade: 0xb8cce8, cloudScale: 1.3, seed: 3, gain: 0.85 },
    key: { dir: [-0.55, 0.8, 0.7] as [number, number, number], color: 0xfff4e0, intensity: 3.1 },
    hemi: { sky: 0xa8d0ff, ground: 0xc09060, intensity: 0.85 },
    rim: { dir: [0.5, 0.5, -1] as [number, number, number], color: 0xffd8a0, intensity: 2.0 },
  },
  gold: {
    sky: { zenith: 0xe28a0c, mid: 0xf2b21a, horizon: 0xfcd65a, ground: 0xe8b060, sunDir: [0.3, 0.35, -1] as [number, number, number], sunColor: 0xfff0a8, sunSize: 0.04, sunGlow: 0.36, sunGain: 1.2, clouds: 0.22, cloudLit: 0xfff2c8, cloudShade: 0xe89a30, cloudScale: 1.3, seed: 2, gain: 0.82 },
    key: { dir: [-0.6, 0.7, 0.85] as [number, number, number], color: 0xfff0d6, intensity: 3.1 },
    hemi: { sky: 0xffe0a0, ground: 0x9a6a3a, intensity: 0.8 },
    rim: { dir: [0.4, 0.6, -1] as [number, number, number], color: 0xffd27a, intensity: 2.6 },
  },
  dusk: {
    sky: { zenith: 0x2a2a6a, mid: 0x8a4a8a, horizon: 0xf09a6a, ground: 0xb07a5a, sunDir: [0.4, 0.12, -1] as [number, number, number], sunColor: 0xffc890, sunSize: 0.05, sunGlow: 0.4, sunGain: 1.1, clouds: 0.3, cloudLit: 0xffc8a0, cloudShade: 0x6a4a7a, cloudScale: 1.2, seed: 5, gain: 0.8, stars: 0.4 },
    key: { dir: [-0.5, 0.6, 0.8] as [number, number, number], color: 0xffe0c8, intensity: 2.8 },
    hemi: { sky: 0x9a8ad0, ground: 0x7a5040, intensity: 0.8 },
    rim: { dir: [0.5, 0.4, -1] as [number, number, number], color: 0xff9a6a, intensity: 2.6 },
  },
};

const photos = new Map<GearId, THREE.Texture>();
let pedestalMat: VoxelMaterial | null = null;

/** photograph a gear item on a dune (cached; linear light ×0.5 for in-world cards, sample ×2) */
export function gearPhoto(renderer: THREE.WebGLRenderer, id: GearId): THREE.Texture {
  const hit = photos.get(id);
  if (hit) return hit;
  const def = GEAR[id];
  const tier = GEAR_RARITY_ORDER.indexOf(def.rarity);
  const L = tier >= 4 ? LOOK.gold : tier >= 3 ? LOOK.dusk : LOOK.day;
  pedestalMat ??= makeVoxelMaterial();
  const root = new THREE.Group();
  const bed = duneBed(3.2, 3.2, 2 + tier, 0, 0.5, 0.7);
  const bedMesh = new THREE.Mesh(buildVoxelGeometry(bed.model, { voxelSize: bed.voxelSize, pivot: bed.pivot }), pedestalMat);
  root.add(bedMesh);
  const show = buildGearDisplay(id, pedestalMat, gearGlassMaterial(), 0.62);
  const ext = show.userData.extent as THREE.Vector3;
  const gy = bed.heightAt(0, 0) + ext.y / 2 + 0.12;
  show.position.set(0, gy, 0);
  show.rotation.set(0.12, 0.55, -0.06);
  root.add(show);
  const c = new THREE.Vector3(0, gy, 0);
  const fov = 30;
  const dist = (Math.max(ext.x, ext.y, ext.z) * 1.15) / (2 * Math.tan((fov * Math.PI) / 360) * 0.7);
  const yaw = 0.25, pitch = 0.2;
  const shot: Shot = {
    root,
    cam: { pos: [c.x + Math.sin(yaw) * dist, c.y + Math.sin(pitch) * dist, c.z + Math.cos(yaw) * dist], look: [c.x, c.y - 0.03, c.z], fov },
    sky: L.sky,
    key: { ...L.key, center: [c.x, c.y, c.z], radius: 2.2 },
    hemi: L.hemi,
    rim: L.rim,
    fog: { color: 0xe6d6b8, near: dist + 3, far: dist + 30 },
    grade: { sat: 1.18, contrast: 1.07, bloom: [0.3, 0.35, 1.3] },
    display: 'scene',
  };
  const studio = new CardStudio(renderer);
  let tex: THREE.Texture;
  try {
    const cv = studio.shoot(shot, ART[0], ART[1], 2);
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
  } finally {
    studio.dispose();
    bedMesh.geometry.dispose();
  }
  photos.set(id, tex);
  return tex;
}

// ------------------------------------------------------------------ the card
const frames = new Map<SkillRarity, THREE.BufferGeometry>();
const gems = new Map<string, THREE.BufferGeometry>();
let frameMat: VoxelMaterial | null = null;
let gemMat: VoxelMaterial | null = null;
let backMat: THREE.MeshStandardMaterial | null = null;

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
function rect(r: Rect) {
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
uniform float uT, uHover, uDim;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(map, vUv).rgb * 2.0 * uDim;
  float band = exp(-pow((vUv.x * 0.8 + vUv.y * 0.6 - fract(uT * 0.35) * 2.6 + 0.6) * 6.0, 2.0));
  c += vec3(1.0, 0.93, 0.8) * band * (0.12 + 0.3 * uHover);
  gl_FragColor = vec4(c, 1.0);
}`;

export interface GearCard3D {
  id: GearId;
  group: THREE.Group;
  hit: THREE.Mesh;
  update(dt: number, hover: number, dim?: number): void;
  dispose(): void;
}

/** label: 'NEW GEAR' or 'WORN' (crest); rows: the ledger on the back */
export function makeGearCard(renderer: THREE.WebGLRenderer, id: GearId, label: string, rows: { stat: StatId; before: number; after: number }[]): GearCard3D {
  frameMat ??= makeVoxelMaterial({ fog: false });
  gemMat ??= makeVoxelMaterial({ fog: false, emissiveStrength: 1.6 });
  const def = GEAR[id];
  const group = new THREE.Group();
  const frame = new THREE.Mesh(frameGeo(def.rarity as SkillRarity), frameMat);
  frame.castShadow = true;
  group.add(frame);
  backMat ??= new THREE.MeshStandardMaterial({ color: 0xa88c62, roughness: 0.95, side: THREE.DoubleSide });
  const C = SKILL_CARD;
  const core = new THREE.Mesh(new THREE.PlaneGeometry(C.W * VS - 0.006, C.H * VS - 0.006), backMat);
  core.position.z = -0.005;
  group.add(core);
  const owned: { dispose(): void }[] = [core.geometry];
  const wr = rect(C.win);
  const artMat = new THREE.ShaderMaterial({ uniforms: { map: { value: gearPhoto(renderer, id) }, uT: { value: 0 }, uHover: { value: 0 }, uDim: { value: 1 } }, vertexShader: ART_VS, fragmentShader: ART_FS });
  const artGeo = new THREE.PlaneGeometry(wr.w, wr.h);
  const art = new THREE.Mesh(artGeo, artMat);
  art.position.set(wr.x, wr.y, VS + 0.0004);
  group.add(art);
  owned.push(artMat, artGeo);
  const plaque = (cv: HTMLCanvasElement, r: Rect, z: number, back = false) => {
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
  const ft = paintFront(id, label);
  plaque(ft.crest, C.crest, 3 * VS + 0.0005);
  plaque(ft.name, C.name, 3 * VS + 0.0005);
  plaque(ft.desc, C.desc, 2 * VS + 0.0005);
  const bt = paintCardBack(ledgerOffer(id), rows);
  plaque(bt.plaque, C.back.plaque, -4 * VS - 0.0005, true);
  plaque(bt.panel, C.back.panel, -3 * VS - 0.0005, true);
  // rarity gems: one lit per tier (common 1 … legendary 5)
  const lit = GEAR_RARITY_ORDER.indexOf(def.rarity) + 1;
  const col = RARITY[def.rarity].hex;
  const gemMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const on = i < lit;
    const [gx, gy] = C.gems[i];
    const g = new THREE.Mesh(gemGeo(col, on), on ? gemMat : frameMat);
    g.position.set((gx + 0.5 - C.W / 2) * VS, (gy + 0.5 - C.H / 2) * VS, 2 * VS);
    group.add(g);
    if (on) gemMeshes.push(g);
  }
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(C.W * VS, C.H * VS), new THREE.MeshBasicMaterial({ visible: false }));
  group.add(hit);
  owned.push(hit.geometry, hit.material as THREE.Material);
  let t = Math.random() * 10;
  return {
    id,
    group,
    hit,
    update(dt, hover, dim = 1) {
      t += dt;
      artMat.uniforms.uT.value = t;
      artMat.uniforms.uHover.value = hover;
      artMat.uniforms.uDim.value = dim;
      gemMeshes.forEach((g, i) => g.scale.setScalar(1 + Math.max(0, Math.sin(t * 4 - i * 0.5)) * 0.18));
    },
    dispose() {
      group.removeFromParent();
      for (const d of owned) d.dispose();
    },
  };
}
