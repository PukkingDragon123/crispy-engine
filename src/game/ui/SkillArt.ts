// Art for the upgrade (skill) cards: every upgrade family gets a little 3D
// vignette built from the game's own models — the revolver on a whiskey barrel,
// Pinch and his brood at sunset, the gods' statues, the oasis, the rib arch —
// photographed through the CardStudio and cached. Photos are baked a step at a
// time (call step() every frame while a pick is open) so nothing freezes.
import * as THREE from 'three';
import { CardStudio, Shot } from './CardStudio';
import { Kit, neckSlicerShot } from './TarotCards';
import * as TP from '../models/props/tarot';
import { hudRound } from '../models/props/hud';
import { modelEntry } from '../models/lookup';
import { RigInstance, RigSpec } from '../../engine/voxel/Rig';
import type { UpgradeDef } from '../run/Upgrades';

type V3 = [number, number, number];

/** photo size for the 60×50-voxel art window */
export const SKILL_ART: [number, number] = [240, 200];
const ASPECT = SKILL_ART[0] / SKILL_ART[1];

const FAMILY: Record<string, string> = {
  venomRounds: 'venom', venomTank: 'venom', serketsKiss: 'venom',
  quickdraw: 'gun', hollowPoints: 'gun', grit: 'gun', steadyHand: 'gun', sixGunStorm: 'gunstorm',
  extraChamber: 'rounds', speedLoader: 'rounds', bandolier: 'rounds',
  ricochet: 'bottles', piercing: 'bottles',
  deadeye: 'horus', eyeOfHorus: 'horus',
  broodMother: 'brood', broodQueen: 'brood', pinchTraining: 'pinch',
  locustCloud: 'swarm', fireAnts: 'fire', burningPlague: 'fire',
  dungEngineer: 'dung', dungCrown: 'dungcrown', sunroller: 'sunroller',
  scarabShield: 'scarab', scarabPauldron: 'scarab',
  ironRibs: 'ribs', desertHeart: 'oasis', serketBlessing: 'serket', tumbleweedLegs: 'tumbleweed',
  horseshoe: 'coins', goldTooth: 'coins', batSpurs: 'blood',
  momentum: 'board', rodeoStar: 'board', driftKing: 'board',
  license: 'star', sheriffStar: 'star', dynamiteBelt: 'dynamite',
  sunDisk: 'ra', anubisScale: 'anubis', thothLedger: 'thoth', sekhmetClaw: 'sekhmet', moonCharm: 'moon', bastetBell: 'bastet',
};
const CAT_FALLBACK: Record<string, string> = { gun: 'gun', insect: 'swarm', passive: 'oasis', gear: 'rounds', relic: 'ra', evolution: 'venom' };

export function skillFamily(def: UpgradeDef) {
  return FAMILY[def.id] ?? CAT_FALLBACK[def.cat] ?? 'gun';
}

// ------------------------------------------------------------------ light & sky presets

type Look = Omit<Shot, 'root' | 'cam' | 'key'> & { key: Omit<Shot['key'], 'center' | 'radius'> };

const LOOKS: Record<string, Look> = {
  day: {
    sky: { zenith: 0x1d6ccc, mid: 0x5aa6ea, horizon: 0xcde8f4, ground: 0xe8c890, sunDir: [-0.55, 0.5, -1], sunColor: 0xfff0c0, sunSize: 0.04, sunGlow: 0.35, clouds: 0.32, cloudLit: 0xffffff, cloudShade: 0xb8cce8, cloudScale: 1.3, seed: 3, gain: 0.85 },
    key: { dir: [-0.55, 0.8, 0.7], color: 0xfff4e0, intensity: 3.1 },
    hemi: { sky: 0xa8d0ff, ground: 0xc09060, intensity: 0.85 },
    rim: { dir: [0.5, 0.5, -1], color: 0xffd8a0, intensity: 2.0 },
    fog: { color: 0xd8e6ee, near: 14, far: 50 },
    grade: { sat: 1.2, contrast: 1.07 },
  },
  gold: {
    sky: { zenith: 0xe28a0c, mid: 0xf2b21a, horizon: 0xfcd65a, ground: 0xe8b060, sunDir: [0.3, 0.35, -1], sunColor: 0xfff0a8, sunSize: 0.04, sunGlow: 0.36, sunGain: 1.2, clouds: 0.22, cloudLit: 0xfff2c8, cloudShade: 0xe89a30, cloudScale: 1.3, seed: 2, gain: 0.82 },
    key: { dir: [-0.6, 0.7, 0.85], color: 0xfff0d6, intensity: 3.1 },
    hemi: { sky: 0xffe0a0, ground: 0x9a6a3a, intensity: 0.8 },
    rim: { dir: [0.4, 0.6, -1], color: 0xffd27a, intensity: 2.6 },
    fog: { color: 0xf2c870, near: 14, far: 50 },
    grade: { sat: 1.22, contrast: 1.08 },
  },
  sunset: {
    sky: { zenith: 0x24164a, mid: 0x8a3a5a, horizon: 0xf8963c, ground: 0x7a4a4a, sunDir: [0.2, 0.06, -1], sunColor: 0xffb060, sunSize: 0.06, sunGlow: 0.32, sunGain: 1.3, clouds: 0.3, cloudLit: 0xffa060, cloudShade: 0x4a2440, seed: 7, gain: 0.82 },
    key: { dir: [-0.6, 0.55, 0.75], color: 0xffcaa0, intensity: 2.4 },
    hemi: { sky: 0x7a5a9a, ground: 0x3a2028, intensity: 0.75 },
    rim: { dir: [0.2, 0.3, -1], color: 0xff8a40, intensity: 3.2 },
    fog: { color: 0x9a5a5a, near: 14, far: 55 },
    grade: { sat: 1.18, contrast: 1.1 },
  },
  night: {
    sky: { zenith: 0x050914, mid: 0x0e1834, horizon: 0x283656, ground: 0x141824, sunDir: [0.35, 0.32, -1], sunColor: 0xd8e6ff, sunSize: 0.05, sunGlow: 0.22, sunGain: 1.1, clouds: 0.25, cloudLit: 0x4a5a84, cloudShade: 0x0c1020, stars: 0.8, seed: 5, gain: 0.9 },
    key: { dir: [0.45, 0.7, 0.6], color: 0xb4c8ff, intensity: 2.0 },
    hemi: { sky: 0x2a3a66, ground: 0x141018, intensity: 0.6 },
    rim: { dir: [0.3, 0.4, -1], color: 0xa0c0ff, intensity: 2.2 },
    fog: { color: 0x141c34, near: 14, far: 60 },
    grade: { sat: 1.12, contrast: 1.1, shadowTint: 0xc8d4ff },
    env: 0.3,
  },
  venom: {
    sky: { zenith: 0x08140f, mid: 0x18382a, horizon: 0x86c85a, ground: 0x23331c, sunDir: [0.25, 0.08, -1], sunColor: 0xc8ff8a, sunSize: 0.05, sunGlow: 0.4, sunGain: 1.2, clouds: 0.3, cloudLit: 0x6aa05a, cloudShade: 0x14241a, stars: 0.35, seed: 8, gain: 0.85 },
    key: { dir: [-0.5, 0.7, 0.7], color: 0xe0ffd8, intensity: 2.2 },
    hemi: { sky: 0x3a6a4a, ground: 0x1a2a1a, intensity: 0.65 },
    rim: { dir: [0.3, 0.4, -1], color: 0x9dff3a, intensity: 2.8 },
    fog: { color: 0x1e3a26, near: 14, far: 55 },
    grade: { sat: 1.18, contrast: 1.1 },
  },
  blood: {
    sky: { zenith: 0x12060a, mid: 0x4a1018, horizon: 0xd84a28, ground: 0x3a1414, sunDir: [-0.1, 0.07, -1], sunColor: 0xff6a3a, sunSize: 0.09, sunGlow: 0.34, sunGain: 1.3, clouds: 0.28, cloudLit: 0xff7a4a, cloudShade: 0x2a0a10, seed: 11, gain: 0.85 },
    key: { dir: [-0.55, 0.6, 0.7], color: 0xffa890, intensity: 2.1 },
    hemi: { sky: 0x5a2a3a, ground: 0x2a1010, intensity: 0.6 },
    rim: { dir: [0.1, 0.3, -1], color: 0xff5a2a, intensity: 3.2 },
    fog: { color: 0x5a1a1a, near: 14, far: 55 },
    grade: { sat: 1.15, contrast: 1.12 },
  },
  fire: {
    sky: { zenith: 0x0e0608, mid: 0x3a120e, horizon: 0xe8641c, ground: 0x2a1410, sunDir: [0, 0.1, -1], sunColor: 0xff8a3a, sunSize: 0, sunGlow: 0.45, sunGain: 1.1, clouds: 0.45, cloudLit: 0xff7a3a, cloudShade: 0x1a0a0a, seed: 13, gain: 0.85 },
    key: { dir: [-0.4, 0.6, 0.8], color: 0xffc090, intensity: 2.2 },
    hemi: { sky: 0x5a2a20, ground: 0x2a1410, intensity: 0.6 },
    rim: { dir: [0.2, 0.4, -1], color: 0xff7a2a, intensity: 3.2 },
    fog: { color: 0x3a1a12, near: 14, far: 55 },
    grade: { sat: 1.18, contrast: 1.1, bloom: [0.4, 0.4, 1.3] },
  },
  divine: {
    sky: { zenith: 0xd8a848, mid: 0xf4dca0, horizon: 0xfff4dc, ground: 0xe8d0a0, sunDir: [0, 0.38, -1], sunColor: 0xfff8e0, sunSize: 0, sunGlow: 0.5, sunGain: 1.4, clouds: 0.36, cloudLit: 0xffffff, cloudShade: 0xf0c880, seed: 4, gain: 0.82 },
    key: { dir: [-0.5, 0.75, 0.8], color: 0xfff8e8, intensity: 3.0 },
    hemi: { sky: 0xfff0d0, ground: 0xc0a070, intensity: 0.95 },
    rim: { dir: [0.3, 0.5, -1], color: 0xffe0a0, intensity: 2.6 },
    fog: { color: 0xf8e8c8, near: 14, far: 50 },
    grade: { sat: 1.16, contrast: 1.06 },
  },
  saloon: {
    sky: { zenith: 0x120a0a, mid: 0x2e1a14, horizon: 0x7a4428, ground: 0x2a1a12, sunDir: [0.3, 0.25, -1], sunColor: 0xffb070, sunSize: 0, sunGlow: 0.5, sunGain: 0.8, clouds: 0, seed: 1, gain: 0.85 },
    key: { dir: [-0.5, 0.75, 0.6], color: 0xffd8a8, intensity: 2.4 },
    hemi: { sky: 0x6a4a3a, ground: 0x2a1a10, intensity: 0.6 },
    rim: { dir: [0.4, 0.4, -1], color: 0xffa860, intensity: 2.6 },
    fog: { color: 0x2a1810, near: 14, far: 50 },
    grade: { sat: 1.16, contrast: 1.1 },
  },
};

// ------------------------------------------------------------------ vignettes

interface Vig {
  root: THREE.Object3D;
  /** objects the camera frames (default: everything) */
  focus?: THREE.Object3D[];
  /** vertical slice of the focus box to frame [from, to] (0 = bottom, 1 = top) */
  crop?: [number, number];
  yaw?: number;
  pitch?: number;
  fov?: number;
  fill?: number;
  look: string;
  lamps?: Shot['lamps'];
  /** tweaks to the look's sky (e.g. bring the moon into frame) */
  sky?: Partial<Shot['sky']>;
}

type VigFn = (k: Kit) => Generator<void, Vig, void>;

const put = (o: THREE.Object3D | null | undefined, parent: THREE.Object3D, p: V3, ry = 0, rx = 0, rz = 0) => {
  if (!o) return null;
  o.position.set(...p);
  o.rotation.set(rx, ry, rz);
  parent.add(o);
  return o;
};

function* sand(k: Kit, root: THREE.Object3D, seed: number, tint = 0, w = 12, d = 14) {
  const bed = TP.duneBed(w, d, seed, tint, 0.55, 1.4);
  put(k.mesh(bed), root, [0, 0, 0]);
  root.userData.heightAt = bed.heightAt;
  yield;
  return bed;
}

/** a brass (or venom) cartridge standing on its head, ~len metres tall */
function round(k: Kit, kind: 'brass' | 'venom', len = 0.12) {
  const r = hudRound(kind, 6);
  const m = k.mesh({ model: r.model, voxelSize: r.voxelSize, pivot: r.pivot });
  if (!m) return null;
  m.geometry.computeBoundingBox();
  const b = m.geometry.boundingBox!;
  m.scale.setScalar(len / Math.max(1e-4, b.max.z - b.min.z));
  const g = new THREE.Group();
  m.rotation.x = Math.PI / 2; // nose up, head on the ground
  g.add(m);
  return g;
}

function statue(god: string, look: string, yaw = 0.42): VigFn {
  return function* (k) {
    const root = new THREE.Group();
    yield* sand(k, root, god.length, 0, 10, 12);
    const s = put(k.mesh('statue_' + god), root, [0, -0.1, 0], -yaw * 0.6);
    yield;
    return { root, focus: s ? [s] : undefined, crop: [0.52, 1.02], yaw, pitch: 0.06, fov: 30, fill: 0.86, look };
  };
}

const VIGS: Record<string, VigFn> = {
  *gun(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 2, 0x8a5a40);
    // a poker table in a dark saloon: the iron, live rounds, the bottle
    const table = put(k.mesh('table', 0.8), root, [0, 0, 0], 0.15);
    const top = 0.92 * 0.8;
    const gun = k.rig('revolver_standard', 1.25);
    if (gun) put(gun.root, root, [0.02, top + 0.035, 0.05], 0.9, 0, Math.PI / 2);
    for (let i = 0; i < 4; i++) put(round(k, 'brass', 0.12), root, [-0.32 + i * 0.075, top, 0.2 - (i % 2) * 0.05], i);
    put(k.mesh('bottle_2', 0.85), root, [0.3, top, -0.2], 0.3);
    put(k.mesh('gold_coin', 0.32), root, [-0.05, top, -0.22], 0.4, -Math.PI / 2 + 0.05);
    yield;
    return { root, focus: [table!, ...(gun ? [gun.root] : [])], crop: [0.62, 1.5], yaw: 0.25, pitch: 0.3, fov: 30, fill: 0.95, look: 'saloon', lamps: [{ pos: [0.6, 1.5, 0.8], color: 0xffb060, intensity: 4, distance: 3 }] };
  },
  *gunstorm(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 3, 0x5a6a8a);
    const gun = k.rig('revolver_serket_venom_scarab', 2.2);
    if (gun) put(gun.root, root, [0, 0.9, 0], 0.6, -0.5, 0.3);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      put(round(k, 'venom', 0.14), root, [Math.cos(a) * 0.62, 0.95 + Math.sin(a * 2) * 0.12, Math.sin(a) * 0.62], a, a * 0.5, Math.PI / 2 + Math.cos(a));
    }
    yield;
    return { root, focus: gun ? [gun.root] : undefined, yaw: 0.3, pitch: 0.06, fov: 32, fill: 0.5, look: 'night', lamps: [{ pos: [0, 1.0, 0.6], color: 0x9dff3a, intensity: 5, distance: 3 }] };
  },
  *rounds(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 4);
    const crate = put(k.mesh('crate_1'), root, [0, 0, 0], 0.3);
    const top = 0.9;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      put(round(k, 'brass', 0.13), root, [Math.cos(a) * 0.17, top, Math.sin(a) * 0.17 + 0.05], a);
    }
    put(k.mesh('att_locust_bandolier', 1.8), root, [0, top, 0.32], 0.2, -1.2);
    yield;
    return { root, focus: [crate!], crop: [0.62, 1.3], yaw: 0.35, pitch: 0.34, fov: 30, fill: 0.95, look: 'gold' };
  },
  *venom(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 5, 0x4a6a3a);
    const rock = put(k.mesh('rock_2', 0.7), root, [0, -0.05, 0], 0.4);
    const gun = k.rig('revolver_serket_venom_scarab', 1.5);
    if (gun) put(gun.root, root, [0, 0.34, 0.02], 0.7, 0, Math.PI / 2 - 0.15);
    for (let i = 0; i < 3; i++) put(round(k, 'venom', 0.13), root, [-0.42 + i * 0.09, 0.0, 0.42 - i * 0.04], i);
    put(k.mesh('att_venom_tank', 1.5), root, [0.5, 0, 0.1], -0.4);
    const p = k.rig('pinch', 0.75);
    if (p) put(p.root, root, [-0.55, 0, -0.1], 0.6);
    yield;
    return { root, focus: [rock!], crop: [-0.2, 1.6], yaw: 0.2, pitch: 0.16, fov: 30, fill: 0.6, look: 'venom', lamps: [{ pos: [0, 0.8, 0.7], color: 0x9dff3a, intensity: 3, distance: 2.5 }] };
  },
  *bottles(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 6);
    const crate = put(k.mesh('crate_2'), root, [0, 0, -0.3], 0.15);
    for (let i = 0; i < 3; i++) put(k.mesh('bottle_' + (i + 1), 0.8), root, [-0.25 + i * 0.25, 0.9, -0.3 + (i % 2) * 0.06], i);
    const gun = k.rig('revolver_standard', 1.4);
    if (gun) put(gun.root, root, [0.15, 0.04, 0.7], 2.2, 0, Math.PI / 2);
    yield;
    return { root, focus: [crate!, ...(gun ? [gun.root] : [])], crop: [0, 1.25], yaw: 0.3, pitch: 0.2, fov: 30, fill: 0.85, look: 'sunset' };
  },
  horus: statue('horus', 'gold'),
  serket: statue('serket', 'venom'),
  anubis: statue('anubis', 'night', -0.4),
  thoth: statue('thoth', 'sunset', 0.35),
  bastet: statue('bastet', 'gold', -0.35),
  *ra(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 9, 0, 10, 12);
    const s = put(k.mesh('statue_ra'), root, [0, -0.1, 0], -0.25);
    const sunMat = k.glowMat(0.5);
    sunMat.userData.tint.value.setRGB(0.74, 0.7, 0.62);
    put(k.mesh(TP.sunFace(), 0.62, sunMat), root, [0.2, 4.4, -4.5]);
    yield;
    return { root, focus: s ? [s] : undefined, crop: [0.5, 1.1], yaw: 0.4, pitch: 0.05, fov: 30, fill: 0.8, look: 'divine' };
  },
  *sekhmet(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 10, 0x8a4a3a, 10, 12);
    const s = put(k.mesh('statue_sekhmet'), root, [0, -0.1, 0], -0.2);
    put(k.mesh(TP.flames(3, 1.0), 1.2, k.glow), root, [-0.9, 2.2, 1.1]);
    put(k.mesh(TP.flames(8, 0.8), 1.2, k.glow), root, [0.95, 2.2, 1.05]);
    yield;
    return { root, focus: s ? [s] : undefined, crop: [0.45, 1.02], yaw: 0.35, pitch: 0.05, fov: 30, fill: 0.86, look: 'fire', lamps: [{ pos: [0, 2.8, 1.4], color: 0xff8a3a, intensity: 8, distance: 4 }] };
  },
  *brood(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 12, 0x9a6a5a);
    const focus: THREE.Object3D[] = [];
    const big = k.rig('pinch', 1.5);
    if (big) focus.push(put(big.root, root, [0, 0, 0], 0.5)!);
    for (let i = 0; i < 5; i++) {
      const p = k.rig('pinch', 0.7 + (i % 2) * 0.12);
      const a = -0.9 + i * 0.45;
      if (p) focus.push(put(p.root, root, [Math.sin(a) * 1.0, 0, Math.cos(a) * 0.75 - 0.15], a + (i % 2 ? 0.4 : -0.3))!);
    }
    yield;
    return { root, focus, yaw: 0.15, pitch: 0.2, fov: 30, fill: 0.95, look: 'sunset' };
  },
  *pinch(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 13);
    const rock = put(k.mesh('rock_2', 0.9), root, [0, -0.05, 0], 0.5);
    const p = k.rig('pinch', 1.25);
    if (p) put(p.root, root, [0, 0.36, 0.05], 0.4);
    yield;
    return { root, focus: [rock!, ...(p ? [p.root] : [])], yaw: 0.25, pitch: 0.14, fov: 30, fill: 1.0, look: 'sunset' };
  },
  *swarm(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 14);
    const sc = k.rig('scarab', 0.4);
    const focus: THREE.Object3D[] = [];
    if (sc) {
      for (let i = 0; i < 9; i++) {
        const r = new RigInstance(sc.geo, { material: k.mat });
        r.root.scale.setScalar(0.32 + (i % 3) * 0.1);
        r.nodes['wing_l']?.rotation.set(-0.35, 0, 1.05);
        r.nodes['wing_r']?.rotation.set(-0.35, 0, -1.05);
        const a = i * 2.39996;
        put(r.root, root, [Math.cos(a) * (0.4 + i * 0.12), 0.5 + (i % 4) * 0.32, Math.sin(a) * 0.5], a, -0.4, Math.sin(a) * 0.3);
        focus.push(r.root);
      }
    }
    yield;
    return { root, focus, yaw: 0.1, pitch: 0.05, fov: 32, fill: 0.95, look: 'gold' };
  },
  *fire(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 15, 0x6a3a2a);
    const sc = k.rig('scarab', 0.4);
    const focus: THREE.Object3D[] = [];
    if (sc) {
      for (let i = 0; i < 6; i++) {
        const r = new RigInstance(sc.geo, { material: k.mat });
        r.root.scale.setScalar(0.35 + (i % 3) * 0.1);
        r.nodes['wing_l']?.rotation.set(-0.35, 0, 1.05);
        r.nodes['wing_r']?.rotation.set(-0.35, 0, -1.05);
        const a = i * 2.39996;
        put(r.root, root, [Math.cos(a) * (0.35 + i * 0.12), 0.7 + (i % 3) * 0.32, Math.sin(a) * 0.4], a, -0.4, 0);
        focus.push(r.root);
      }
    }
    put(k.mesh(TP.flames(5, 0.9), 1.3, k.glow), root, [0, 0, 0.1]);
    put(k.mesh(TP.embers(2, 18, 2.4, 2.2), 1, k.glow), root, [0, 1.1, 0]);
    yield;
    return { root, focus, yaw: 0.1, pitch: 0.05, fov: 32, fill: 0.8, look: 'fire', lamps: [{ pos: [0, 0.6, 0.5], color: 0xff8a3a, intensity: 8, distance: 4 }] };
  },
  *dung(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 16);
    const ds = k.rig('dumb_scarab', 1.3);
    if (ds) put(ds.root, root, [-0.45, 0, 0.05], 1.25);
    const ball = put(k.mesh('dung_ball', 1.15), root, [0.32, 0, 0.1], 0.5);
    put(k.mesh('dung_bomb', 1.6), root, [0.95, 0, 0.45], -0.4);
    yield;
    return { root, focus: [ball!, ...(ds ? [ds.root] : [])], yaw: 0.15, pitch: 0.2, fov: 30, fill: 0.86, look: 'day' };
  },
  *dungcrown(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 17);
    const ds = k.rig('dumb_scarab', 1.2);
    if (ds) put(ds.root, root, [-0.48, 0, 0.05], 1.25);
    const ball = put(k.mesh('dung_ball', 1.15), root, [0.3, 0, 0.1], 0.5);
    put(k.mesh('att_bone_crown', 2.4), root, [0.3, 0.78, 0.1], 0.3, 0.12);
    yield;
    return { root, focus: [ball!, ...(ds ? [ds.root] : [])], crop: [0, 1.25], yaw: 0.15, pitch: 0.2, fov: 30, fill: 0.8, look: 'divine' };
  },
  *sunroller(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 18, 0, 9, 12);
    const ds = k.rig('dumb_scarab', 1.3);
    if (ds) put(ds.root, root, [-0.5, 0, 0.05], 1.25);
    const ball = put(k.mesh('dung_ball', 1.2), root, [0.3, 0, 0.1], 0.5);
    const sunMat = k.glowMat(0.5);
    sunMat.userData.tint.value.setRGB(0.74, 0.7, 0.62);
    put(k.mesh(TP.sunFace(), 0.5, sunMat), root, [0.2, 2.2, -4.5]);
    yield;
    return { root, focus: [ball!, ...(ds ? [ds.root] : [])], crop: [0, 1.6], yaw: 0.12, pitch: 0.1, fov: 34, fill: 0.62, look: 'gold' };
  },
  *scarab(k) {
    // three armoured scarabs orbit the pauldron like a shield
    const root = new THREE.Group();
    yield* sand(k, root, 19);
    const rock = put(k.mesh('rock_2', 0.6), root, [0, -0.04, 0], 0.5);
    put(k.mesh('att_scarab_pauldron', 2.0), root, [0, 0.27, 0.02], 0.4, -0.25);
    const focus: THREE.Object3D[] = rock ? [rock] : [];
    const sc = k.rig('scarab', 0.45);
    if (sc) {
      for (let i = 0; i < 3; i++) {
        const r = new RigInstance(sc.geo, { material: k.mat });
        r.root.scale.setScalar(0.42);
        r.nodes['wing_l']?.rotation.set(-0.35, 0, 1.0);
        r.nodes['wing_r']?.rotation.set(-0.35, 0, -1.0);
        const a = (i / 3) * Math.PI * 2 + 0.6;
        focus.push(put(r.root, root, [Math.cos(a) * 0.62, 0.55 + Math.sin(a * 2) * 0.16, Math.sin(a) * 0.45], -a, -0.35, Math.cos(a) * 0.35)!);
      }
    }
    yield;
    return { root, focus, yaw: 0.2, pitch: 0.12, fov: 30, fill: 0.92, look: 'gold' };
  },
  *oasis(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 20, 0, 10, 12);
    const focus: THREE.Object3D[] = [];
    focus.push(put(k.mesh('palm_1'), root, [-0.9, 0, -0.8], 0.4)!);
    focus.push(put(k.mesh('well'), root, [0.7, 0, -0.4], -0.5)!);
    const c = k.rig('camel', 0.8);
    if (c) {
      c.nodes['neck']?.rotation.set(0.5, 0, 0);
      focus.push(put(c.root, root, [0.2, 0, 0.9], -1.2)!);
    }
    yield;
    return { root, focus: focus.filter(Boolean), yaw: 0.1, pitch: 0.04, fov: 32, fill: 0.95, look: 'day' };
  },
  *ribs(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 21, 0x9a6a5a, 16, 18);
    const arch = put(k.mesh('rib_arch', 0.6), root, [0, -0.1, 0], 0.6);
    yield;
    return { root, focus: arch ? [arch] : undefined, yaw: 0.35, pitch: 0.03, fov: 32, fill: 0.98, look: 'sunset' };
  },
  *tumbleweed(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 22);
    const a = put(k.mesh('tumbleweed_1', 1.1), root, [-0.3, 0.25, 0], 0.4, 0.3);
    const b = put(k.mesh('tumbleweed_2', 0.8), root, [0.55, 0, 0.3], 1.0);
    put(k.mesh('dry_bush_1', 0.8), root, [-1.1, 0, -0.6], 0.6);
    yield;
    return { root, focus: [a!, b!], crop: [0, 1.3], yaw: 0.1, pitch: 0.12, fov: 30, fill: 0.7, look: 'day' };
  },
  *coins(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 23);
    const chest = put(k.mesh('chest_gold', 1.0), root, [0, 0, -0.1], 0.35);
    for (let i = 0; i < 7; i++) {
      const a = i * 2.39996, r = 0.45 + (i % 3) * 0.12;
      put(k.mesh('gold_coin', 0.5), root, [Math.cos(a) * r, 0, Math.sin(a) * r * 0.6 + 0.35], a, -1.2 + (i % 2) * 0.4);
    }
    put(k.mesh('skull_cow', 0.35), root, [-0.65, 0, 0.25], 0.8);
    yield;
    return { root, focus: [chest!], crop: [0, 1.2], yaw: 0.2, pitch: 0.3, fov: 30, fill: 0.62, look: 'gold' };
  },
  *board(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 24, 0, 8, 10);
    const b = put(k.mesh('board_driftwood', 1.0), root, [0, 0.62, 0], 0.4, Math.PI / 2 - 0.15, 0.12);
    put(k.mesh('tumbleweed_1', 0.6), root, [0.6, 0, 0.4], 0.4);
    put(k.mesh('cactus_saguaro_2', 0.7), root, [-1.4, 0, -1.6], 0.4);
    yield;
    return { root, focus: [b!], crop: [-0.1, 1.1], yaw: 0.3, pitch: 0.06, fov: 30, fill: 0.85, look: 'sunset' };
  },
  *star(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 25);
    const w = put(k.mesh('wanted_board_1', 0.8), root, [0, 0, -0.4], 0.15);
    put(k.mesh('att_sheriff_star', 3.4), root, [0.15, 0.06, 0.6], 0.3, -1.2);
    yield;
    return { root, focus: [w!], crop: [0, 1.0], yaw: 0.2, pitch: 0.15, fov: 30, fill: 0.86, look: 'day' };
  },
  *dynamite(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 26, 0x6a5a6a);
    const crate = put(k.mesh('tnt_crate_1', 0.8), root, [0, 0, -0.2], 0.3);
    put(k.mesh('dynamite', 1.3), root, [0.55, 0, 0.35], -0.3, 0, -0.35);
    put(k.mesh(TP.embers(4, 9, 0.4, 0.5), 0.6, k.glow), root, [0.66, 0.85, 0.3]);
    yield;
    return { root, focus: [crate!], crop: [0, 1.05], yaw: 0.3, pitch: 0.15, fov: 30, fill: 0.86, look: 'night', lamps: [{ pos: [0.7, 0.9, 0.6], color: 0xffa040, intensity: 5, distance: 3 }] };
  },
  *blood(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 27, 0x6a2a2a);
    const skull = put(k.mesh('skull_cow', 0.6), root, [0, 0, 0], 0.3);
    const v = k.rig('vulture', 0.7);
    if (v) put(v.root, root, [0, 0.25, -0.1], 0.6, 0.15);
    yield;
    return { root, focus: [skull!], crop: [0, 2.4], yaw: 0.15, pitch: 0.08, fov: 30, fill: 0.62, look: 'blood' };
  },
  *moon(k) {
    const root = new THREE.Group();
    yield* sand(k, root, 28, 0x5a6a8a, 10, 14);
    const o = put(k.mesh('obelisk', 0.55), root, [0, -0.1, -1.5], 0.3);
    put(k.mesh('tumbleweed_2', 0.7), root, [0.9, 0, 0.6], 0.4);
    yield;
    return { root, focus: [o!], crop: [0, 1.0], yaw: 0.2, pitch: 0.05, fov: 32, fill: 0.84, look: 'night', sky: { sunDir: [-0.14, 0.2, -1], sunSize: 0.07, sunGlow: 0.28 } };
  },
};

// ------------------------------------------------------------------ framing & baking

const _b = new THREE.Box3();
function frameShot(v: Vig, aspect = ASPECT, display: 'screen' | 'scene' = 'scene'): Shot {
  v.root.updateMatrixWorld(true);
  _b.makeEmpty();
  for (const o of v.focus ?? [v.root])
    o.traverseVisible((c) => {
      if ((c as THREE.Mesh).isMesh) _b.expandByObject(c);
    });
  if (_b.isEmpty()) _b.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  if (v.crop) {
    const y0 = _b.min.y, h = _b.max.y - _b.min.y;
    _b.min.y = y0 + h * v.crop[0];
    _b.max.y = y0 + h * v.crop[1];
  }
  const size = _b.getSize(new THREE.Vector3()), c = _b.getCenter(new THREE.Vector3());
  const yaw = v.yaw ?? 0.2, pitch = v.pitch ?? 0.1, fov = v.fov ?? 30, fill = v.fill ?? 0.85;
  const w = Math.abs(size.x * Math.cos(yaw)) + Math.abs(size.z * Math.sin(yaw));
  const d = Math.abs(size.x * Math.sin(yaw)) + Math.abs(size.z * Math.cos(yaw));
  const h = size.y * Math.cos(pitch) + d * Math.abs(Math.sin(pitch));
  const t = Math.tan((fov * Math.PI) / 360);
  const dist = Math.max(h / (2 * t * fill), w / (2 * t * aspect * fill)) + d / 2;
  const L = LOOKS[v.look] ?? LOOKS.day;
  const r = Math.max(size.x, size.y, size.z) * 0.8 + 1.5;
  const pos: V3 = [c.x + Math.sin(yaw) * Math.cos(pitch) * dist, c.y + Math.sin(pitch) * dist, c.z + Math.cos(yaw) * Math.cos(pitch) * dist];
  // never put the lens inside a dune
  const hAt = v.root.userData.heightAt as ((x: number, z: number) => number) | undefined;
  if (hAt) pos[1] = Math.max(pos[1], hAt(pos[0], pos[2]) + 0.3);
  return {
    ...L,
    sky: { ...L.sky, ...v.sky },
    root: v.root,
    cam: { pos, look: [c.x, c.y, c.z], fov },
    key: { ...L.key, center: [c.x, c.y, c.z], radius: r },
    lamps: v.lamps,
    fog: L.fog ? { ...L.fog, near: Math.max(L.fog.near, dist + 4), far: Math.max(L.fog.far, dist + 40) } : undefined,
    display,
  };
}

/** extra vignettes that are not upgrades (board moves) */
export const NECK_SLICER = { key: 'neck_slicer', title: 'THE NECK SLICER' } as const;

/** the Shot for a vignette key (a family from skillFamily(), or 'neck_slicer'), framed for a w/h aspect */
export function* vignetteShot(key: string, k: Kit, aspect = ASPECT, display: 'screen' | 'scene' = 'scene'): Generator<void, Shot, void> {
  if (key === NECK_SLICER.key) return yield* neckSlicerShot(k, aspect, display);
  const it = (VIGS[key] ?? VIGS.gun)(k);
  let r = it.next();
  while (!r.done) {
    yield;
    r = it.next();
  }
  return frameShot(r.value, aspect, display);
}

/**
 * Photograph one vignette right now (blocking: model building + one studio shot).
 * For a texture in the world use display 'scene' and sample it ×2; for UI/HUD use 'screen'.
 */
export function bakeVignette(renderer: THREE.WebGLRenderer, key: string, w: number, h: number, o: { hero?: RigSpec | null; heroKey?: string; gun?: RigSpec | null; display?: 'screen' | 'scene' } = {}) {
  const studio = new CardStudio(renderer);
  const kit = new Kit(o.hero ?? null, o.heroKey ?? '', o.gun ?? ((modelEntry('revolver_standard')?.() as RigSpec | undefined) ?? null));
  try {
    const it = vignetteShot(key, kit, w / h, o.display ?? 'screen');
    let r = it.next();
    while (!r.done) r = it.next();
    return studio.shoot(r.value, w, h, 2);
  } finally {
    kit.dispose();
    studio.dispose();
  }
}

/** bakes and caches the vignette photos; textures are linear-light ×0.5 (sample ×2) */
export class SkillArt {
  private cache = new Map<string, THREE.Texture>();
  private queue: string[] = [];
  private job: Generator<void, void, void> | null = null;
  private gun: RigSpec | null = null;
  private hero: RigSpec | null = null;
  private heroKey = '';

  /** the cached photo for an upgrade (null until baked) */
  texture(def: UpgradeDef) {
    return this.cache.get(skillFamily(def)) ?? null;
  }

  /** the cached photo for a vignette key ('neck_slicer', a family), null until baked */
  textureKey(key: string) {
    return this.cache.get(key) ?? null;
  }

  /** queue vignettes by key (e.g. NECK_SLICER.key) */
  requestKeys(keys: string[]) {
    for (const f of keys) if (!this.cache.has(f) && !this.queue.includes(f)) this.queue.push(f);
  }

  /** the player's rig for vignettes that show Sundown (default: the stock look) */
  setHero(spec: RigSpec | null, key: string) {
    this.hero = spec;
    this.heroKey = key;
  }

  request(defs: UpgradeDef[]) {
    for (const d of defs) {
      const f = skillFamily(d);
      if (!this.cache.has(f) && !this.queue.includes(f)) this.queue.push(f);
    }
  }

  get busy() {
    return this.queue.length > 0 || !!this.job;
  }

  /** time-sliced baking; call once a frame */
  step(renderer: THREE.WebGLRenderer, budgetMs = 8) {
    if (!this.job && this.queue.length) this.job = this.bake(renderer);
    if (!this.job) return;
    const t0 = performance.now();
    try {
      do {
        if (this.job.next().done) {
          this.job = null;
          break;
        }
      } while (performance.now() - t0 < budgetMs);
    } catch (e) {
      console.warn('[skill art] bake failed', e);
      this.job = null;
      this.queue.length = 0;
    }
  }

  private *bake(renderer: THREE.WebGLRenderer): Generator<void, void, void> {
    this.gun ??= (modelEntry('revolver_standard')?.() as RigSpec | undefined) ?? null;
    const studio = new CardStudio(renderer);
    const kit = new Kit(this.hero, this.heroKey, this.gun);
    try {
      while (this.queue.length) {
        const fam = this.queue[0];
        try {
          const it = vignetteShot(fam, kit);
          let r = it.next();
          while (!r.done) {
            yield;
            r = it.next();
          }
          yield;
          const cv = studio.shoot(r.value, SKILL_ART[0], SKILL_ART[1], 2);
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          this.cache.set(fam, tex);
        } catch (e) {
          console.warn('[skill art] vignette failed', fam, e);
        }
        this.queue.shift();
        kit.flush();
        yield;
      }
    } finally {
      kit.dispose();
      studio.dispose();
    }
  }

  dispose() {
    this.job = null;
    this.queue.length = 0;
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
  }
}

/** every vignette key (for previews / prebaking) */
export const SKILL_FAMILIES = [...Object.keys(VIGS), NECK_SLICER.key];
