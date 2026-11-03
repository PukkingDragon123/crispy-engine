// The tarot cards (Rider–Waite compositions) as real 3D dioramas — the bar's
// three skills + ultimate, and the two plain moves (grapple, kick):
// the player's own Sundown rig posed for each card, the game's models as set
// dressing, sculpted set pieces from props/tarot.ts, then photographed by the
// CardStudio (painted sky, cel light, ink, bloom, grade).
//   Q hook      XII  THE HANGED MAN — hung by one ankle from the living tau tree
//   E scorpions I    THE MAGICIAN   — revolver to the sky, the four suits on the table
//   C swarm     XVI  THE TOWER      — the struck watchtower, falling headfirst
//   G dung      XIX  THE SUN        — the dung-sun held overhead like Khepri
//   F kick      VIII STRENGTH       — a roundhouse kick before Sekhmet
//   Z ult       XIII DEATH          — riding the pale camel with the black banner
import * as THREE from 'three';
import { buildRigGeo, clearRigCache, RigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { modelEntry } from '../models/lookup';
import * as TP from '../models/props/tarot';
import { deadBush } from '../models/props/flora';
import type { Shot } from './CardStudio';

type V3 = [number, number, number];

/** particle theme played when the card is used / glints while it is ready */
export type TarotFx = 'rope' | 'venom' | 'storm' | 'sun' | 'kick' | 'death';

export interface TarotDef {
  key: string;
  num: string;
  title: string;
  fx: TarotFx;
  /** particle colours on use */
  burst: number[];
  scene: (k: Kit) => Generator<void, Shot, void>;
}

// ------------------------------------------------------------------ kit

type Src = string | { model: VoxelModel; voxelSize: number; pivot?: V3 | 'bottom' | 'center' };

/** builds diorama pieces from the game's registries and set pieces; owns everything it builds */
export class Kit {
  mat: VoxelMaterial;
  glow: VoxelMaterial;
  private geos: THREE.BufferGeometry[] = [];
  private rigs = new Map<string, RigGeo>();
  private mats: THREE.Material[] = [];
  constructor(public heroSpec: RigSpec | null, public heroKey: string, public gunSpec: RigSpec | null) {
    this.mat = makeVoxelMaterial({ fog: true });
    this.glow = makeVoxelMaterial({ fog: true, emissiveStrength: 2.2 });
    (this.glow.userData as any).noShadow = true;
  }

  /** a static mesh from a registry key or a set piece (scale baked into the voxel size) */
  mesh(src: Src, scale = 1, mat?: THREE.Material): THREE.Mesh | null {
    let m: { model: VoxelModel; voxelSize: number; pivot?: V3 | 'bottom' | 'center' } | null = null;
    try {
      if (typeof src === 'string') {
        const r = modelEntry(src)?.() as any;
        if (r?.model) m = r;
        else if (r?.base) m = { model: r.base, voxelSize: r.voxelSize };
      } else m = src;
    } catch (e) {
      console.warn('[tarot] model failed', src, e);
    }
    if (!m) return null;
    const geo = buildVoxelGeometry(m.model, { voxelSize: m.voxelSize * scale, pivot: m.pivot ?? 'bottom' });
    this.geos.push(geo);
    return new THREE.Mesh(geo, mat ?? this.mat);
  }

  /** a rig from the registries (geometry cached under a card key, freed in dispose) */
  rig(key: string, scale = 1, mat?: VoxelMaterial): RigInstance | null {
    try {
      const spec = modelEntry(key)?.() as RigSpec | undefined;
      if (!spec?.parts) return null;
      const ck = key + ':tarot';
      const geo = buildRigGeo(spec, ck);
      this.rigs.set(ck, geo);
      const r = new RigInstance(geo, { material: mat ?? this.mat });
      r.root.scale.setScalar(scale);
      return r;
    } catch (e) {
      console.warn('[tarot] rig failed', key, e);
      return null;
    }
  }

  /** the player's Sundown (their outfit) with their revolver in hand */
  hero(gun = true): { rig: RigInstance; pose: Poser } | null {
    if (!this.heroSpec) return null;
    const rig = new RigInstance(buildRigGeo(this.heroSpec, this.heroKey), { material: this.mat });
    if (gun && this.gunSpec) {
      const g = new RigInstance(buildRigGeo(this.gunSpec, this.gunSpec.name + ':player'), { material: this.mat });
      const holder = new THREE.Group();
      holder.rotation.x = Math.PI / 2; // barrel along the forearm, out of the fist
      holder.add(g.root);
      if (!rig.attach('hand_r', holder)) rig.nodes['fore_r']?.add(holder);
    }
    return { rig, pose: new Poser(rig) };
  }

  /** an emissive material of a given strength, no shadows (owned, freed with the diorama) */
  glowMat(strength: number) {
    const m = makeVoxelMaterial({ fog: true, emissiveStrength: strength });
    (m.userData as any).noShadow = true;
    this.mats.push(m);
    return m;
  }

  /** an extra lit material owned by the kit (freed with the diorama) */
  material(tint?: V3) {
    const m = makeVoxelMaterial({ fog: true });
    if (tint) m.userData.tint.value.setRGB(...tint);
    this.mats.push(m);
    return m;
  }

  /** free one diorama's geometry (the shared materials and their shader programs stay) */
  flush() {
    for (const g of this.geos) g.dispose();
    this.geos = [];
    for (const [k, rg] of this.rigs) {
      for (const p of rg.parts) p.geo.dispose();
      for (const set of Object.values(rg.exprGeos)) for (const g of Object.values(set)) g.dispose();
      clearRigCache(k);
    }
    this.rigs.clear();
    for (const m of this.mats) m.dispose();
    this.mats = [];
  }

  dispose() {
    this.flush();
    this.mat.dispose();
    this.glow.dispose();
  }
}

// ------------------------------------------------------------------ posing

/** bone directions at rest (part space = rig space at rest), from the joint layout */
const REST: Record<string, V3> = {
  arm_l: [0, -1, 0],
  fore_l: [1, -11.5, 0],
  arm_r: [0, -1, 0],
  fore_r: [-1, -11.5, 0],
  thigh_l: [-0.5, -8.5, 0],
  shin_l: [0, -1, 0],
  thigh_r: [0.5, -8.5, 0],
  shin_r: [0, -1, 0],
};

const _q = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _r = new THREE.Vector3();
const _h = new THREE.Vector3();

/**
 * Poses a rig by pointing bones at directions given in the rig's own frame
 * (+Z the way it faces, +X its left, +Y up) — parents first.
 */
export class Poser {
  constructor(public r: RigInstance) {}
  private chain(node: THREE.Object3D, out: THREE.Quaternion) {
    out.identity();
    const list: THREE.Object3D[] = [];
    for (let n = node.parent; n && n !== this.r.root; n = n.parent) list.push(n);
    for (let i = list.length - 1; i >= 0; i--) out.multiply(list[i].quaternion);
    return out;
  }
  /** point a limb along dir; bones more than ~100° from rest swing through `via` (default: the front) */
  aim(part: string, dir: V3, twist = 0, via: V3 = [0, 0, 1], rest = REST[part]) {
    const n = this.r.nodes[part];
    if (!n || !rest) return this;
    const inv = this.chain(n, _q).invert();
    const d = _v.set(...dir).normalize().applyQuaternion(inv);
    const r = _r.set(...rest).normalize();
    if (r.dot(d) < -0.2) {
      const h = _h.set(...via).normalize().applyQuaternion(inv);
      _q1.setFromUnitVectors(r, h);
      _q2.setFromUnitVectors(h, d);
      n.quaternion.copy(_q2.multiply(_q1));
    } else n.quaternion.setFromUnitVectors(r, d);
    if (twist) n.quaternion.multiply(_q1.setFromAxisAngle(r, twist));
    return this;
  }
  rot(part: string, x: number, y = 0, z = 0) {
    this.r.nodes[part]?.rotation.set(x, y, z);
    return this;
  }
  /** world position of a point given in a part's local frame (metres) */
  at(part: string, local: V3 = [0, 0, 0]) {
    const n = this.r.nodes[part];
    this.r.root.updateMatrixWorld(true);
    return n ? n.localToWorld(new THREE.Vector3(...local)) : this.r.root.getWorldPosition(new THREE.Vector3());
  }
  socket(name: string) {
    this.r.root.updateMatrixWorld(true);
    return this.r.sockets[name]?.getWorldPosition(new THREE.Vector3()) ?? this.at('pelvis');
  }
}

/** lowest point of the visible meshes, in world space */
function lowestY(o: THREE.Object3D) {
  o.updateMatrixWorld(true);
  const b = new THREE.Box3();
  o.traverseVisible((c) => {
    if ((c as THREE.Mesh).isMesh) b.expandByObject(c);
  });
  return b.isEmpty() ? 0 : b.min.y;
}

const place = (o: THREE.Object3D | null | undefined, parent: THREE.Object3D, p: V3, ry = 0, rx = 0, rz = 0) => {
  if (!o) return o;
  o.position.set(...p);
  o.rotation.set(rx, ry, rz);
  parent.add(o);
  return o;
};

/** the camera for a 66×88 art window: look at a point from yaw/pitch/distance */
function cam(look: V3, yaw: number, pitch: number, dist: number, fov: number, roll = 0): Shot['cam'] {
  return {
    pos: [look[0] + Math.sin(yaw) * Math.cos(pitch) * dist, look[1] + Math.sin(pitch) * dist, look[2] + Math.cos(yaw) * Math.cos(pitch) * dist],
    look,
    fov,
    roll,
  };
}

/** a sand bed with a few dead bushes and pebbles at its rim */
function* ground(k: Kit, root: THREE.Object3D, w: number, d: number, seed: number, tint = 0, bushes = 2, crest = 0): Generator<void, ReturnType<typeof TP.duneBed>, void> {
  const bed = TP.duneBed(w, d, seed, tint, crest);
  place(k.mesh(bed), root, [0, 0, 0]);
  yield;
  for (let i = 0; i < bushes; i++) {
    const b = deadBush(seed * 7 + i);
    const x = (i % 2 ? 1 : -1) * (w * 0.28 + i * 0.4), z = -d * 0.18 - i * 0.6;
    place(k.mesh(b, 1.2), root, [x, bed.heightAt(x, z) - 0.04, z], i * 1.7);
  }
  return bed;
}

// ------------------------------------------------------------------ the six dioramas

function* hangedMan(k: Kit): Generator<void, Shot, void> {
  const root = new THREE.Group();
  const bed = yield* ground(k, root, 10, 16, 3, 0xc6b0d0, 2, 0.35);
  const g0 = bed.heightAt(0, 0.3);
  // the living tau tree, trunk standing behind the beam
  const tree = TP.tauTree(3, 18);
  const ts = 0.74;
  place(k.mesh(tree, ts), root, [0, g0 - 0.05, 0]);
  const beamY = g0 - 0.05 + tree.meta.beamY * ts;
  yield;
  const h = k.hero(false);
  if (h) {
    const { rig, pose } = h;
    root.add(rig.root);
    // figure-four legs, hands bound behind the back, calm face toward us
    pose.rot('torso', 0.04, 0, 0).rot('head', -0.1, 0, 0.05);
    pose.aim('thigh_r', [0.03, -1, 0.02]).aim('shin_r', [0.02, -1, 0]);
    pose.aim('thigh_l', [0.8, -0.52, -0.22]).aim('shin_l', [-0.9, -0.1, -0.42]);
    pose.aim('arm_r', [-0.5, -0.68, -0.52]).aim('fore_r', [0.86, 0.26, -0.44]);
    pose.aim('arm_l', [0.5, -0.68, -0.52]).aim('fore_l', [-0.86, 0.26, -0.44]);
    rig.setPartVisible('hat', false);
    // hang upside down by the right ankle under the middle of the beam
    rig.root.rotation.set(0, 0.1, Math.PI);
    const ankle = pose.at('shin_r', [0, -0.35, 0.02]);
    const rope = TP.hangingRope(0.22);
    const hitch = beamY - 0.07 - Math.abs(rope.meta.hitchY) + 0.03;
    rig.root.position.set(-ankle.x, hitch - ankle.y, 0.12 - ankle.z);
    place(k.mesh(rope), root, [0, beamY - 0.07, 0.12]);
    // the corona around the skull, soft enough to keep the face
    const skull = pose.at('head', [0, 0.22, 0.02]);
    place(k.mesh(TP.coronaHalo(2), 1.3, k.glowMat(0.75)), root, [skull.x, skull.y, skull.z - 0.16]);
    // his hat fallen in the sand below
    const hi = rig.geo.index['hat'];
    if (hi !== undefined) {
      const hat = new THREE.Mesh(rig.geo.parts[hi].geo, k.mat);
      place(hat, root, [0.5, bed.heightAt(0.5, 0.75) - 0.04, 0.75], 0.6, 0.12, 2.75);
    }
  }
  yield;
  place(k.mesh('skull_cow', 0.3), root, [-0.7, bed.heightAt(-0.7, 0.9) - 0.03, 0.9], 0.7);
  return {
    root,
    cam: cam([0, 1.27, 0.1], 0.17, 0.05, 4.7, 30),
    sky: { zenith: 0x4f74b0, mid: 0x98b4d8, horizon: 0xf6c49a, ground: 0xd8b48a, sunDir: [-0.45, 0.2, -1], sunColor: 0xffcc96, sunSize: 0.05, sunGlow: 0.4, sunGain: 1.2, clouds: 0.34, cloudLit: 0xfff0e0, cloudShade: 0x8e9cc4, cloudScale: 1.1, seed: 4, gain: 0.8 },
    key: { dir: [-0.55, 0.75, 0.75], color: 0xfff0dc, intensity: 3.0, center: [0, 1.2, 0], radius: 3.5 },
    hemi: { sky: 0xb8c8e8, ground: 0x9a7a5a, intensity: 0.7 },
    rim: { dir: [0.6, 0.4, -1], color: 0xffc890, intensity: 2.2 },
    lamps: [{ pos: [0, 0.5, 0.7], color: 0xffd36b, intensity: 2.2, distance: 2 }],
    fog: { color: 0xe2c8b4, near: 10, far: 36 },
    grade: { sat: 1.2, contrast: 1.08, shadowTint: 0xdfe6ff, highTint: 0xfff0e0, vignette: 0.55 },
  };
}

function* magician(k: Kit): Generator<void, Shot, void> {
  const root = new THREE.Group();
  const bed = yield* ground(k, root, 10, 16, 5, 0xd08a40, 0, 0.35);
  const g0 = bed.heightAt(0, 0);
  const h = k.hero(true);
  if (h) {
    const { rig, pose } = h;
    root.add(rig.root);
    pose.rot('torso', -0.05, 0.1, 0.03).rot('head', 0.06, 0.08, -0.03);
    // as above: the revolver raised to the sky
    pose.aim('arm_r', [-0.22, 0.97, 0.1], 0.4).aim('fore_r', [-0.08, 1, 0.16]);
    // so below: the other hand points to the earth
    pose.aim('arm_l', [0.36, -0.88, 0.3]).aim('fore_l', [0.42, -0.8, 0.44]);
    pose.aim('thigh_l', [0.12, -1, 0.02]).aim('shin_l', [0.06, -1, 0]);
    pose.aim('thigh_r', [-0.1, -1, 0]).aim('shin_r', [-0.05, -1, 0]);
    rig.root.position.set(0, g0 - lowestY(rig.root), -0.1);
    // Pinch rides the left shoulder
    const p = k.rig('pinch', 0.86);
    if (p) {
      p.root.rotation.set(0.05, 0.55, 0);
      p.root.position.set(0.02, 0.02, 0);
      if (!rig.attach('shoulder_l', p.root)) root.add(p.root);
    }
    // the lemniscate floats over the hat
    const top = pose.at('head', [0, 0.62, 0]);
    place(k.mesh(TP.lemniscate('venom'), 1.3, k.glowMat(1.6)), root, [top.x + 0.06, top.y + 0.36, top.z + 0.05]);
  }
  yield;
  // the table of the four suits: cups, wands, swords, pentacles — as the west knows them
  const tz = 0.82;
  place(k.mesh('table', 1), root, [0, g0 - 0.02, tz]);
  const ty = g0 - 0.02 + 0.92;
  place(k.mesh('bottle', 0.55), root, [-0.48, ty, tz + 0.18], 0.4);
  place(k.mesh('dynamite', 0.52), root, [-0.18, ty, tz + 0.24], -0.3, 0, 0.14);
  place(k.mesh('dagger', 0.55), root, [0.15, ty + 0.3, tz + 0.2], 0.2, 0, Math.PI - 0.08);
  place(k.mesh('gold_coin', 0.52), root, [0.47, ty - 0.005, tz + 0.26], -0.35, 0.08);
  yield;
  // prickly-pear blossoms in the foreground (the Magician's garden)
  place(k.mesh('cactus_prickly_1', 0.52), root, [-1.05, bed.heightAt(-1.05, 1.75) - 0.04, 1.75], 0.5);
  place(k.mesh('cactus_prickly_2', 0.56), root, [1.02, bed.heightAt(1.02, 1.6) - 0.04, 1.6], -0.6);
  return {
    root,
    cam: cam([0, 1.48, 0.35], -0.08, 0.0, 5.0, 31),
    sky: { zenith: 0xe28a0c, mid: 0xf2b21a, horizon: 0xfcd65a, ground: 0xe8b060, sunDir: [0.05, 0.42, -1], sunColor: 0xfff0a8, sunSize: 0, sunGlow: 0.34, sunGain: 1.3, clouds: 0.16, cloudLit: 0xfff2c8, cloudShade: 0xe89a30, cloudScale: 1.3, seed: 2, gain: 0.82 },
    key: { dir: [-0.6, 0.7, 0.85], color: 0xfff0d6, intensity: 3.1, center: [0, 1, 0.4], radius: 3.2 },
    hemi: { sky: 0xffe0a0, ground: 0x9a6a3a, intensity: 0.8 },
    rim: { dir: [0.4, 0.6, -1], color: 0xffd27a, intensity: 2.6 },
    fog: { color: 0xf2c870, near: 10, far: 34 },
    grade: { sat: 1.22, contrast: 1.08, shadowTint: 0xe6d8ff, highTint: 0xfff2d8, vignette: 0.5 },
  };
}

function* tower(k: Kit): Generator<void, Shot, void> {
  const root = new THREE.Group();
  // a rocky crag carrying the tower
  place(k.mesh(TP.mesa(5, 10, 1.9, 1 / 10)), root, [1.4, -0.3, -11.8], 0.3);
  yield;
  place(k.mesh('rock_large_2', 1.3), root, [-1.2, 0.9, -9.8], 2.1);
  place(k.mesh('rock_large_3', 1.1), root, [3.6, 0.8, -9.6], 4.0);
  yield;
  // the watchtower: its roof blown off by the bolt, burning
  const wt = modelEntry('watchtower')?.() as { model: VoxelModel; voxelSize: number } | undefined;
  const towerY = 1.6;
  if (wt?.model) {
    const b = wt.model.bounds();
    const cut = b.maxY - Math.round(1.7 / wt.voxelSize);
    wt.model.carveWhere((x, y, z) => y > cut + Math.sin(x * 0.7 + z * 0.4) * 3 + Math.cos(z * 1.3) * 2);
    place(k.mesh(wt), root, [1.6, towerY, -12], -0.35);
    const topY = towerY + (cut - b.minY) * wt.voxelSize;
    place(k.mesh(TP.flames(4, 1.7), 1.9, k.glow), root, [1.6, topY - 0.5, -12]);
    place(k.mesh(TP.flames(9, 1.2), 1.4, k.glow), root, [2.5, topY - 0.9, -11.4]);
    place(k.mesh(TP.lightningBolt(3, 4.2), 2.3, k.glow), root, [3.0, topY + 9.4, -12.4], 0, 0, 0.08);
    place(k.mesh(TP.embers(5, 28, 6, 8), 1, k.glow), root, [0.6, topY - 3.8, -8.5]);
    yield;
  }
  // Sundown, thrown from the tower: falling headfirst toward us, arms flung wide
  const h = k.hero(true);
  if (h) {
    const { rig, pose } = h;
    root.add(rig.root);
    pose.rot('torso', -0.22, 0.1, 0.05).rot('head', -0.5, 0.2, 0);
    pose.aim('arm_r', [-0.92, 0.34, 0.18]).aim('fore_r', [-0.9, 0.36, 0.25]);
    pose.aim('arm_l', [0.92, 0.36, 0.14]).aim('fore_l', [0.86, 0.46, 0.22]);
    pose.aim('thigh_r', [-0.35, -0.82, -0.45]).aim('shin_r', [-0.16, -0.45, -0.88]);
    pose.aim('thigh_l', [0.28, -0.95, 0.12]).aim('shin_l', [0.24, -0.96, -0.12]);
    rig.setPartVisible('hat', false);
    rig.root.rotation.set(0.2, 0.3, Math.PI - 0.32);
    rig.root.position.set(-0.2, 6.05, 2.6);
    const hi = rig.geo.index['hat'];
    if (hi !== undefined) place(new THREE.Mesh(rig.geo.parts[hi].geo, k.mat), root, [0.9, 6.6, 1.9], 0.8, 0.7, 2.4);
  }
  yield;
  // the scarab swarm pours out of the burning tower around him
  const sc = k.rig('scarab', 0.3);
  if (sc) {
    const geo = sc.geo;
    for (let i = 0; i < 18; i++) {
      const r = new RigInstance(geo, { material: k.mat });
      const a = i * 2.39996;
      const rr = 0.9 + (i % 6) * 0.42;
      r.root.scale.setScalar(0.3 + (i % 3) * 0.08);
      r.nodes['wing_l']?.rotation.set(-0.35, 0, 1.05);
      r.nodes['wing_r']?.rotation.set(-0.35, 0, -1.05);
      place(r.root, root, [0.4 + Math.cos(a) * rr * 1.25, 6.2 + Math.sin(a) * rr * 0.85 + (i % 4) * 0.3, -1.2 - (i % 4) * 1.4], a + 1.2, -0.5 + (i % 2) * 0.3, Math.sin(a) * 0.4);
    }
  }
  return {
    root,
    cam: cam([0.5, 5.7, -1.8], 0.04, -0.06, 9.6, 40),
    sky: { zenith: 0x04060e, mid: 0x10142c, horizon: 0x2a1e34, ground: 0x140e16, sunDir: [0.3, 0.55, -1], sunColor: 0x9ab8ff, sunSize: 0, sunGlow: 0.25, sunGain: 0.6, clouds: 0.7, cloudLit: 0x5a5a84, cloudShade: 0x121322, cloudScale: 0.9, stars: 0.5, seed: 9, gain: 0.9 },
    key: { dir: [0.45, 0.85, 0.35], color: 0xcfe0ff, intensity: 2.2, center: [0.8, 5, -5], radius: 11 },
    hemi: { sky: 0x2c3356, ground: 0x1a1014, intensity: 0.55 },
    rim: { dir: [0.25, 0.4, -1], color: 0xff8a3a, intensity: 2.8 },
    lamps: [
      { pos: [1.6, 11.6, -11.2], color: 0xff7a2a, intensity: 90, distance: 26 },
      { pos: [0.2, 6.6, 3.6], color: 0xffa050, intensity: 7, distance: 6 },
    ],
    fog: { color: 0x151628, near: 16, far: 70 },
    grade: { sat: 1.16, contrast: 1.12, shadowTint: 0xc8d2ff, highTint: 0xffe2c0, vignette: 0.62, bloom: [0.5, 0.4, 1.2] },
    env: 0.3,
  };
}

function* sun(k: Kit): Generator<void, Shot, void> {
  const root = new THREE.Group();
  const bed = yield* ground(k, root, 12, 12, 8, 0, 1, 0);
  const g0 = bed.heightAt(0, 0.3);
  // the great sun with its face, rays alternating straight and wavy
  const sunMat = k.glowMat(0.5);
  sunMat.userData.tint.value.setRGB(0.74, 0.7, 0.62);
  place(k.mesh(TP.sunFace(), 0.78, sunMat), root, [0, 4.25, -6.5]);
  yield;
  // sunflowers looking over the mudbrick wall
  place(k.mesh(TP.mudWall(6.2, 1.15, 2)), root, [0, bed.heightAt(0, -1.9) - 0.06, -1.9]);
  yield;
  for (let i = 0; i < 6; i++) {
    const x = -2.3 + i * 0.92 + (i % 2) * 0.12;
    place(k.mesh(TP.sunflower(i + 2, 1.55 + (i % 3) * 0.22)), root, [x, bed.heightAt(x, -2.35) - 0.05, -2.35], (i - 2.5) * 0.12);
  }
  yield;
  const h = k.hero(false);
  if (h) {
    const { rig, pose } = h;
    root.add(rig.root);
    // Khepri's labour: the sun held up over the bare skull (the hat lies by his boots)
    rig.setPartVisible('hat', false);
    pose.rot('torso', -0.08, 0, 0).rot('head', -0.32, 0, 0);
    pose.aim('arm_r', [-0.2, 0.98, 0.06]).aim('fore_r', [0.26, 0.96, 0.08]);
    pose.aim('arm_l', [0.2, 0.98, 0.06]).aim('fore_l', [-0.26, 0.96, 0.08]);
    pose.aim('thigh_l', [0.26, -0.96, 0.04]).aim('shin_l', [0.12, -1, 0]);
    pose.aim('thigh_r', [-0.26, -0.96, 0.04]).aim('shin_r', [-0.12, -1, 0]);
    rig.root.position.set(0.1, 0, 0.3);
    rig.root.position.y = g0 - lowestY(rig.root);
    const hr = pose.socket('hand_r'), hl = pose.socket('hand_l');
    place(k.mesh('dung_ball', 0.74), root, [(hr.x + hl.x) / 2, Math.max(hr.y, hl.y) - 0.06, (hr.z + hl.z) / 2 - 0.02], 0.4);
    const hi = rig.geo.index['hat'];
    if (hi !== undefined) place(new THREE.Mesh(rig.geo.parts[hi].geo, k.mat), root, [0.72, bed.heightAt(0.72, 0.7) - 0.04, 0.7], -0.5, 0.1, 2.9);
  }
  yield;
  // a little dumb scarab rolling its own sun across the sand
  const ds = k.rig('dumb_scarab', 0.6);
  if (ds) {
    place(ds.root, root, [-0.78, bed.heightAt(-0.78, 1.0) - 0.02, 1.0], 1.35);
    place(k.mesh('dung_ball', 0.38), root, [-0.3, bed.heightAt(-0.3, 1.1) - 0.03, 1.1], 0.8);
  }
  return {
    root,
    cam: cam([0.05, 2.12, -0.8], 0.06, -0.1, 8.0, 36),
    sky: { zenith: 0x1764c8, mid: 0x4f9ce6, horizon: 0xbfe0f2, ground: 0xe8c890, sunDir: [0, 0.5, -1], sunColor: 0xfff0b0, sunSize: 0, sunGlow: 0.5, sunGain: 1.0, clouds: 0.18, cloudLit: 0xffffff, cloudShade: 0xb8cce8, cloudScale: 1.4, seed: 6, gain: 0.85 },
    key: { dir: [-0.45, 0.9, 0.8], color: 0xfff6e2, intensity: 3.2, center: [0, 1.2, -0.6], radius: 4.5 },
    hemi: { sky: 0xa8d0ff, ground: 0xc09060, intensity: 0.85 },
    rim: { dir: [0, 0.6, -1], color: 0xffd060, intensity: 2.6 },
    fog: { color: 0xd8e6ee, near: 12, far: 42 },
    grade: { sat: 1.2, contrast: 1.07, shadowTint: 0xe0e8ff, highTint: 0xfff4dc, vignette: 0.45 },
  };
}

function* strength(k: Kit): Generator<void, Shot, void> {
  const root = new THREE.Group();
  const bed = yield* ground(k, root, 12, 18, 11, 0xd8a050, 2, 0.45);
  // the lion goddess watches
  place(k.mesh('statue_sekhmet', 1), root, [1.35, bed.heightAt(1.35, -7.2) - 0.1, -7.2], -0.3);
  yield;
  const yaw = 1.12;
  const h = k.hero(true);
  if (h) {
    const { rig, pose } = h;
    root.add(rig.root);
    // a roundhouse: lean away, the kicking leg straight out at chest height
    pose.rot('torso', -0.3, -0.35, -0.12).rot('head', 0.12, 0.25, 0.05);
    pose.aim('thigh_r', [-0.12, 0.24, 0.96]).aim('shin_r', [-0.08, 0.3, 0.95]);
    pose.aim('thigh_l', [0.06, -0.96, -0.26]).aim('shin_l', [0.0, -0.97, 0.24]);
    pose.aim('arm_l', [0.62, 0.22, 0.75]).aim('fore_l', [0.42, 0.42, 0.8]);
    pose.aim('arm_r', [-0.62, -0.25, -0.74], 0.6).aim('fore_r', [-0.5, 0.15, -0.85]);
    rig.root.rotation.set(0, yaw, 0);
    rig.root.position.set(-0.85, 0, 0.35);
    rig.root.position.y = bed.heightAt(-0.85, 0.35) - lowestY(rig.root);
    // the husk takes the boot in the chest and is launched
    const foot = pose.at('shin_r', [0, -0.36, 0.06]);
    const hk = k.rig('husk', 0.78);
    if (hk) {
      const hp = new Poser(hk);
      hp.rot('torso', 0.4, 0, 0).rot('head', -0.6, 0.25, 0);
      hp.aim('arm_l', [0.55, 0.45, 0.7]).aim('fore_l', [0.3, 0.72, 0.62]);
      hp.aim('arm_r', [-0.55, 0.5, 0.68]).aim('fore_r', [-0.35, 0.72, 0.6]);
      hp.aim('thigh_l', [0.2, -0.5, 0.84]).aim('shin_l', [0.1, -0.88, 0.45]);
      hp.aim('thigh_r', [-0.15, -0.65, 0.74]).aim('shin_r', [-0.05, -0.94, 0.34]);
      hk.root.rotation.set(-0.85, yaw + Math.PI, 0.15, 'YXZ');
      root.add(hk.root);
      hk.root.position.set(0, 0, 0);
      const chest = hp.at('torso', [0, 0.28, 0.1]);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      hk.root.position.set(foot.x + fx * 0.22 - chest.x, foot.y + 0.05 - chest.y, foot.z + fz * 0.22 - chest.z);
    }
    const top = pose.at('head', [0, 0.66, 0]);
    place(k.mesh(TP.lemniscate('gold'), 1.3, k.glowMat(2.6)), root, [top.x + 0.05, top.y + 0.24, top.z + 0.1], -0.3);
  }
  return {
    root,
    cam: cam([-0.12, 1.95, -1.2], 0.1, -0.06, 7.6, 36),
    sky: { zenith: 0xd8801a, mid: 0xeeb024, horizon: 0xf8d46a, ground: 0xe6b070, sunDir: [0.42, 0.32, -1], sunColor: 0xfff2c0, sunSize: 0.045, sunGlow: 0.38, sunGain: 1.2, clouds: 0.24, cloudLit: 0xfff2d0, cloudShade: 0xe0a040, cloudScale: 1.2, seed: 12, gain: 0.82 },
    key: { dir: [-0.6, 0.7, 0.75], color: 0xfff0d0, intensity: 3.1, center: [0, 1.2, -1], radius: 5.5 },
    hemi: { sky: 0xffe0a0, ground: 0x9a6a3a, intensity: 0.8 },
    rim: { dir: [0.5, 0.5, -1], color: 0xffc060, intensity: 2.4 },
    fog: { color: 0xf0c880, near: 11, far: 48 },
    grade: { sat: 1.2, contrast: 1.08, shadowTint: 0xe6dcff, highTint: 0xfff0d6, vignette: 0.5 },
  };
}

function* death(k: Kit): Generator<void, Shot, void> {
  const root = new THREE.Group();
  const bed = yield* ground(k, root, 14, 14, 13, 0x8a5a7a, 2, 0);
  // two obelisks on the horizon, the sun going down between them
  place(k.mesh('obelisk', 1), root, [2.0, -0.2, -19], 0.2);
  place(k.mesh('obelisk', 0.92), root, [5.5, -0.2, -20], -0.1);
  yield;
  // the pale camel
  const camel = k.rig('camel', 1, k.material([1.28, 1.24, 1.22]));
  const cy = -1.05;
  if (camel) {
    camel.nodes['leg_fl']?.rotation.set(-0.38, 0, 0);
    camel.nodes['leg_fr']?.rotation.set(0.16, 0, 0);
    camel.nodes['leg_bl']?.rotation.set(0.22, 0, 0);
    camel.nodes['leg_br']?.rotation.set(-0.2, 0, 0);
    camel.nodes['neck']?.rotation.set(-0.08, 0.1, 0);
    camel.nodes['head']?.rotation.set(0.12, 0.15, 0);
    camel.root.rotation.set(0, cy, 0);
    root.add(camel.root);
    camel.root.position.set(-0.55, 0, 0);
    camel.root.position.y = bed.heightAt(-0.55, 0) - lowestY(camel.root) - 0.03;
  }
  yield;
  const h = k.hero(true);
  if (h && camel) {
    const { rig, pose } = h;
    // in the saddle, turned toward us, the banner in the left fist
    pose.rot('torso', 0.02, 0.72, 0).rot('head', 0.1, 0.32, -0.04);
    pose.aim('thigh_l', [0.5, -0.22, 0.84]).aim('shin_l', [0.24, -0.97, -0.06]);
    pose.aim('thigh_r', [-0.5, -0.22, 0.84]).aim('shin_r', [-0.24, -0.97, -0.06]);
    pose.aim('arm_l', [0.62, -0.5, 0.6]).aim('fore_l', [0.25, 0.25, 0.93]);
    pose.aim('arm_r', [-0.35, -0.85, 0.4], 0.3).aim('fore_r', [-0.2, -0.45, 0.87]);
    const seat = camel.sockets['saddle'];
    const holder = new THREE.Group();
    (seat ?? camel.root).add(holder);
    holder.add(rig.root);
    rig.root.position.set(0, -((h.rig.geo.spec.meta?.hipY as number) ?? 0.67) + 0.02, 0);
    root.updateMatrixWorld(true);
    // the black banner, pole upright through the fist, cloth streaming back
    const fist = pose.socket('hand_l');
    place(k.mesh(TP.deathBanner()), root, [fist.x, fist.y - 1.05, fist.z], cy + Math.PI / 2, 0, 0.04);
  }
  yield;
  // the fallen king before the hooves, his crown rolled away
  const mum = k.rig('mummy', 0.95);
  if (mum) {
    const mp = new Poser(mum);
    mp.aim('arm_l', [0.95, -0.25, 0.15]).aim('fore_l', [0.9, 0.1, 0.4]);
    mp.aim('arm_r', [-0.9, -0.4, 0.1]).aim('fore_r', [-0.6, -0.75, 0.2]);
    mp.aim('thigh_l', [0.2, -1, 0]).aim('shin_l', [0.1, -1, 0]);
    mp.aim('thigh_r', [-0.15, -1, 0.1]).aim('shin_r', [-0.1, -1, -0.1]);
    mp.rot('head', 0, 0.7, 0);
    mum.root.rotation.set(-Math.PI / 2, -1.35, 0, 'YXZ');
    root.add(mum.root);
    mum.root.position.set(-0.55, bed.heightAt(-0.55, 2.5) + 0.2, 2.5);
    place(k.mesh('att_bone_crown', 1.5), root, [1.25, bed.heightAt(1.25, 2.7) + 0.01, 2.7], 0.6, 0.35, 0.3);
  }
  return {
    root,
    cam: cam([0.15, 1.85, 0.3], 0.04, -0.02, 11.0, 33),
    sky: { zenith: 0x1c1230, mid: 0x6a2c50, horizon: 0xf38a3c, ground: 0x6a3a4a, sunDir: [0.135, 0.045, -1], sunColor: 0xffb060, sunSize: 0.07, sunGlow: 0.3, sunGain: 1.35, clouds: 0.3, cloudLit: 0xff9a5a, cloudShade: 0x40203a, cloudScale: 1.0, seed: 13, gain: 0.8 },
    key: { dir: [-0.6, 0.55, 0.7], color: 0xffc4a0, intensity: 2.2, center: [0, 1.5, 0.8], radius: 5 },
    hemi: { sky: 0x6a4a8a, ground: 0x3a2028, intensity: 0.7 },
    rim: { dir: [0.15, 0.25, -1], color: 0xff8a40, intensity: 3.6 },
    fog: { color: 0x8a4a5a, near: 12, far: 55 },
    grade: { sat: 1.16, contrast: 1.1, shadowTint: 0xd6c8ff, highTint: 0xffe2c8, vignette: 0.58 },
  };
}

/** frame a box from yaw/pitch so it fills `fill` of an `aspect` (w/h) picture */
export function fitCam(box: THREE.Box3, yaw: number, pitch: number, fov: number, aspect: number, fill: number): Shot['cam'] {
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const w = Math.abs(size.x * Math.cos(yaw)) + Math.abs(size.z * Math.sin(yaw));
  const d = Math.abs(size.x * Math.sin(yaw)) + Math.abs(size.z * Math.cos(yaw));
  const h = size.y * Math.cos(pitch) + d * Math.abs(Math.sin(pitch));
  const t = Math.tan((fov * Math.PI) / 360);
  const dist = Math.max(h / (2 * t * fill), w / (2 * t * aspect * fill)) + d / 2;
  return cam([c.x, c.y, c.z], yaw, pitch, dist, fov);
}

/**
 * THE NECK SLICER (a board move): Sundown inverted mid-backflip above a husk, the
 * sandboard's edge has carved a crescent of light round from the husk's neck, the
 * head flies off in a spray of sand and bone dust. `aspect` = picture w/h
 * (0.75 for a tarot window); 'scene' display for textures shown in the world.
 */
export function* neckSlicerShot(k: Kit, aspect = 66 / 88, display: 'screen' | 'scene' = 'screen'): Generator<void, Shot, void> {
  if (!k.heroSpec) {
    // baked outside a run (no player rig handed in): the default Sundown
    k.heroSpec = (modelEntry('cowboy_stetson_punk')?.() as RigSpec | undefined) ?? null;
    k.heroKey = 'cowboy_stetson_punk:player';
  }
  const root = new THREE.Group();
  const bed = yield* ground(k, root, 10, 14, 17, 0x9a6a6a, 2, 0.3);
  const focus: THREE.Object3D[] = [];
  // the husk, recoiling, its head taken clean off
  let N = new THREE.Vector3(0.45, 1.55, 0);
  const hk = k.rig('husk', 0.86);
  if (hk) {
    const hp = new Poser(hk);
    hp.rot('torso', -0.24, 0.12, 0.06);
    hp.aim('arm_l', [0.78, 0.5, 0.3]).aim('fore_l', [0.42, 0.88, 0.2]);
    hp.aim('arm_r', [-0.72, 0.42, 0.45]).aim('fore_r', [-0.3, 0.9, 0.3]);
    hp.aim('thigh_l', [0.18, -0.9, 0.35]).aim('shin_l', [0.12, -0.95, -0.25]);
    hp.aim('thigh_r', [-0.15, -0.95, -0.2]).aim('shin_r', [-0.1, -0.97, 0.1]);
    hk.root.rotation.set(0, -0.55, 0);
    root.add(hk.root);
    hk.root.position.set(0.45, 0, 0);
    hk.root.position.y = bed.heightAt(0.45, 0) - lowestY(hk.root);
    root.updateMatrixWorld(true);
    focus.push(hk.root);
    const head = hk.nodes['head'];
    if (head) {
      N = head.getWorldPosition(new THREE.Vector3());
      root.attach(head); // keeps its pose; now it flies on its own
      head.position.add(new THREE.Vector3(0.78, 0.6, 0.5));
      head.rotation.set(head.rotation.x + 0.8, head.rotation.y + 0.9, head.rotation.z - 1.4);
      focus.push(head);
    }
  }
  yield;
  // sand and bone dust spray out of the stump after the head
  place(k.mesh(TP.dustSpray(4, 80, [0.78, 0.6, 0.18], 0.55, 0.95)), root, [N.x, N.y - 0.02, N.z]);
  place(k.mesh(TP.dustSpray(9, 40, [-0.3, 0.9, 0.1], 0.7, 0.55)), root, [N.x, N.y - 0.04, N.z]);
  // Sundown, upside down over the top of the flip, the board on his boots
  const C = new THREE.Vector3(N.x - 0.45, N.y + 1.28, N.z + 0.28);
  let boardTip: THREE.Vector3 | null = null;
  const h = k.hero(true);
  if (h) {
    const { rig, pose } = h;
    pose.rot('torso', -0.2, 0.1, 0).rot('head', -0.42, 0.25, 0.12);
    pose.aim('arm_r', [-0.9, 0.4, -0.12]).aim('fore_r', [-0.84, 0.52, 0.14]);
    pose.aim('arm_l', [0.9, 0.36, -0.16]).aim('fore_l', [0.8, 0.56, 0.1]);
    pose.aim('thigh_l', [0.14, -0.97, 0.14]).aim('shin_l', [0.1, -0.98, -0.06]);
    pose.aim('thigh_r', [-0.14, -0.97, 0.14]).aim('shin_r', [-0.1, -0.98, -0.06]);
    // the board rides crosswise under the boots, as on the dunes
    const board = k.mesh('board_driftwood', 1);
    if (board) {
      board.rotation.y = Math.PI / 2;
      board.position.set(0, -0.06, 0.03);
      rig.root.add(board);
    }
    rig.root.rotation.set(0, 0.28, 2.75, 'ZYX');
    root.add(rig.root);
    const pel = pose.at('pelvis');
    rig.root.position.set(C.x - pel.x, C.y - pel.y, C.z - pel.z);
    root.updateMatrixWorld(true);
    boardTip = rig.root.localToWorld(new THREE.Vector3(-0.66, -0.06, 0.03));
    focus.push(rig.root);
  }
  yield;
  // the slash: a crescent of light spiralling from the cut round to the board's edge
  const a0 = Math.atan2(N.y - C.y, N.x - C.x);
  let a1 = a0 + 2.5;
  let r1 = 0.85;
  if (boardTip) {
    a1 = Math.atan2(boardTip.y - C.y, boardTip.x - C.x);
    while (a1 < a0) a1 += Math.PI * 2;
    r1 = Math.hypot(boardTip.x - C.x, boardTip.y - C.y);
  }
  const arc = k.mesh(TP.slashArc(Math.hypot(N.x - C.x, N.y - C.y) + 0.05, r1, a0 - 0.12, a1 - 0.05, 0.18), 1, k.glowMat(1.6));
  place(arc, root, [C.x, C.y, C.z]);
  if (arc) focus.push(arc);
  yield;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const o of focus)
    o.traverseVisible((c) => {
      if ((c as THREE.Mesh).isMesh) box.expandByObject(c);
    });
  box.min.y = Math.max(box.min.y, bed.heightAt(0, 0) - 0.15);
  const c = box.getCenter(new THREE.Vector3());
  return {
    root,
    cam: fitCam(box, 0.14, -0.05, 32, aspect, aspect < 1 ? 0.92 : 0.86),
    sky: { zenith: 0x170e2a, mid: 0x5e1e3e, horizon: 0xf07a36, ground: 0x5a3040, sunDir: [0.55, 0.05, -1], sunColor: 0xffa458, sunSize: 0.06, sunGlow: 0.3, sunGain: 1.3, clouds: 0.34, cloudLit: 0xff9a5a, cloudShade: 0x3a1a34, cloudScale: 1.1, seed: 17, gain: 0.82 },
    key: { dir: [-0.55, 0.65, 0.8], color: 0xffd4b0, intensity: 2.6, center: [c.x, c.y, c.z], radius: 3.5 },
    hemi: { sky: 0x6a4a8a, ground: 0x3a2028, intensity: 0.7 },
    rim: { dir: [0.4, 0.3, -1], color: 0xff8a40, intensity: 3.2 },
    lamps: [{ pos: [C.x + 0.9, C.y - 0.4, C.z + 0.8], color: 0xfff0c0, intensity: 5, distance: 3.5 }],
    fog: { color: 0x7a3a4a, near: 14, far: 55 },
    grade: { sat: 1.18, contrast: 1.1, shadowTint: 0xd6c8ff, highTint: 0xffe6cc, vignette: 0.56, bloom: [0.34, 0.35, 1.3] },
    display,
  };
}

/** every tarot card with a diorama: the bar's skills and ultimate, and the plain moves (the hideout book's Moves page looks moves up here by key) */
export const TAROT: TarotDef[] = [
  { key: 'Q', num: 'XII', title: 'THE HANGED MAN', fx: 'rope', burst: [0xffd36b, 0xfff3d6, 0xc9a66b, 0x8a6a3a], scene: hangedMan },
  { key: 'E', num: 'I', title: 'THE MAGICIAN', fx: 'venom', burst: [0x9dff3a, 0xd8ff9a, 0xfff3d6, 0x3a8a1a], scene: magician },
  { key: 'C', num: 'XVI', title: 'THE TOWER', fx: 'storm', burst: [0xffffff, 0xbfe0ff, 0xffb040, 0x2a2030], scene: tower },
  { key: 'G', num: 'XIX', title: 'THE SUN', fx: 'sun', burst: [0xffe08a, 0xffc63c, 0xfff6d0, 0x7a5530], scene: sun },
  { key: 'F', num: 'VIII', title: 'STRENGTH', fx: 'kick', burst: [0xf6dcac, 0xe9c48c, 0xffd36b, 0xfff3d6], scene: strength },
  { key: 'Z', num: 'XIII', title: 'DEATH', fx: 'death', burst: [0x9dff3a, 0xfff3d6, 0x1a1418, 0xd8ccb0], scene: death },
  { key: 'neck_slicer', num: '0', title: 'THE NECK SLICER', fx: 'kick', burst: [0xfff6d0, 0xffd36b, 0xe9c48c, 0xd8ccb0], scene: (k) => neckSlicerShot(k) },
];

const byKey = (k: string) => TAROT.find((d) => d.key === k)!;
/** the HUD ability bar: the three active skills (Magician, Tower, Sun), then the big Death ultimate */
export const TAROT_BAR: TarotDef[] = ['E', 'C', 'G', 'Z'].map(byKey);
/** plain moves (grapple XII, kick VIII, the Neck Slicer): their cards live on the hideout skills book's Moves page */
export const TAROT_MOVES: TarotDef[] = ['Q', 'F', 'neck_slicer'].map(byKey);
