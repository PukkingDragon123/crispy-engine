// The gun rack: hung on the back wall over the side cabinet, between the bench
// and the futon, the heart of the gunsmith's corner (Bench3D drives it). Every
// gun you own stands in its bay with the parts you have fitted: the Coach Gun
// and the Chicago Typewriter upright in felt-lined cradles, butts in their
// pockets, the six-shooter on the green-baize pistol board between them. A
// gun you have not found is only its shape on the boards, clean wood ringed
// with settled dust, over a tarnished plate with no name on it. A brass plate
// on the shelf lip names every gun (Alagard); a manila tag on each bay says how
// it rides. The trough light has a bulb over every bay; the bay you look at
// lifts its gun a touch in the cradle under a warm spot. The upgrades you own
// stand on the shelf as live cartridges.
import * as THREE from 'three';
import type { RigSpec } from '../../../engine/voxel/Rig';
import { buildRigGeo, RigInstance } from '../../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { damp } from '../../../engine/math/rand';
import * as CH from '../../models/characters';
import * as WS from '../../models/props/workshop';
import { cartridgeTrio } from '../../models/characters/longguns';
import { Blueprints, GUNS } from '../../meta/Blueprints';
import { buildWeaponRig, explodeWeapon } from '../../player/Weapons';
import { loadSave, GunLoadout } from '../../meta/Save';
import { BuildKit, HubHost, safe, geoOf, meshOf } from './HubKit';

export type GunKey = 'revolver' | 'shotgun' | 'tommy';
/** the bays, left to right */
export const RACK_ORDER: GunKey[] = ['shotgun', 'revolver', 'tommy'];
export const REV_DEFAULT: GunLoadout = { barrel: 'standard', cylinder: 'standard', grip: 'wood', sight: 'none' };
const basis = (x: number[], y: number[], z: number[]) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z)));
/** standing in the rack: muzzle up, the top of the gun to the left, the right flank to the room */
export const Q_UP = basis([0, 0, -1], [-1, 0, 0], [0, 1, 0]);
/** lying on the turntable: on its left flank, muzzle to the right, the top toward the wall */
export const Q_FLAT = basis([0, -1, 0], [0, 0, -1], [1, 0, 0]);
/** display scale on the rack and on the bench (the six-shooter is drawn a touch big so it reads) */
export const GUN_SCALE = { rack: { revolver: 0.95, long: 1 }, bench: { revolver: 1.2, long: 1 } };
/** the six-shooter hangs canted on its pegs, muzzle up and to the left, the grip swung down to the right */
export const Q_PISTOL = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.42).multiply(Q_UP);
export const scaleOf = (g: GunKey, where: 'rack' | 'bench') => (g === 'revolver' ? GUN_SCALE[where].revolver : GUN_SCALE[where].long);

// ======================================================================= rig maths shared with the bench
/** the rest-pose transform of a part inside its rig */
export function restMatrix(spec: RigSpec, name: string): THREE.Matrix4 {
  const vs = spec.voxelSize;
  const by = new Map(spec.parts.map((p) => [p.name, p]));
  const chain: RigSpec['parts'] = [];
  for (let p = by.get(name); p; p = p.parent ? by.get(p.parent) : undefined) chain.unshift(p);
  const M = new THREE.Matrix4();
  chain.forEach((p, i) => {
    const pp = i > 0 ? chain[i - 1] : null;
    const off = pp ? new THREE.Vector3((p.attach[0] - pp.pivot[0]) * vs, (p.attach[1] - pp.pivot[1]) * vs, (p.attach[2] - pp.pivot[2]) * vs) : new THREE.Vector3(p.attach[0] * vs, p.attach[1] * vs, p.attach[2] * vs);
    M.multiply(new THREE.Matrix4().compose(off, new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rest ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1)));
  });
  return M;
}
const key3 = (x: number, y: number, z: number) => `${x},${y},${z}`;
/**
 * Where the options of one slot disagree: for each part, the voxels that differ
 * between the option rigs (missing or another colour). A separate part that
 * changes a lot (the shotgun's barrels, the Thompson's drum, a cylinder) is
 * taken whole; the root part (the frame) only ever gives up the voxels that differ.
 */
export function diffZones(specs: RigSpec[]): Map<string, Set<string>> {
  const names = new Set<string>();
  for (const s of specs) for (const p of s.parts) names.add(p.name);
  const zone = new Map<string, Set<string>>();
  for (const n of names) {
    const z = new Set<string>();
    const models = specs.map((s) => s.parts.find((p) => p.name === n)?.model ?? null);
    // an unchanged component is the very same model object in every option: nothing differs there
    if (models.every((m) => m === models[0])) continue;
    const all = new Set<string>();
    for (const m of models) m?.forEach((x, y, zz) => all.add(key3(x, y, zz)));
    for (const k of all) {
      const [x, y, zz] = k.split(',').map(Number);
      let first: number | null = null;
      for (const m of models) {
        const v = m ? m.get(x, y, zz) : undefined;
        const c = v === undefined ? -1 : v & 0xffffff;
        if (first === null) first = c;
        else if (c !== first) {
          z.add(k);
          break;
        }
      }
    }
    if (z.size) {
      const counts = models.filter((m): m is VoxelModel => !!m).map((m) => m.count);
      const isRoot = specs.some((s) => s.parts[0]?.name === n);
      if (!isRoot && z.size > 0.25 * Math.min(...counts)) for (const m of models) m?.forEach((x, y, zz) => z.add(key3(x, y, zz)));
      zone.set(n, z);
    }
  }
  return zone;
}
/** each option's own voxels inside the zone, meshed in rig space (the loose parts in the tray) */
export function slotPieces(specs: RigSpec[]): THREE.Group[] {
  const zone = diffZones(specs);
  return specs.map((s) => {
    const g = new THREE.Group();
    for (const p of s.parts) {
      const z = zone.get(p.name);
      if (!z) continue;
      const m = new VoxelModel(p.name + ':piece');
      p.model.forEach((x, y, zz, c, f) => {
        if (z.has(key3(x, y, zz))) m.set(x, y, zz, c, f);
      });
      if (!m.count) continue;
      const mesh = meshOf(buildVoxelGeometry(m, { voxelSize: s.voxelSize, pivot: p.pivot }), sharedVoxelMaterial);
      mesh.applyMatrix4(restMatrix(s, p.name));
      g.add(mesh);
    }
    return g;
  });
}
/** the rig-space box, per option rig, of what changes across a slot's options */
export function slotBoxes(specs: RigSpec[], zone = diffZones(specs)): THREE.Box3[] {
  const v = new THREE.Vector3();
  return specs.map((s) => {
    const box = new THREE.Box3();
    for (const p of s.parts) {
      const z = zone.get(p.name);
      if (!z) continue;
      const M = restMatrix(s, p.name), vs = s.voxelSize;
      p.model.forEach((x, y, zz) => {
        if (!z.has(key3(x, y, zz))) return;
        box.expandByPoint(v.set((x + 0.5 - p.pivot[0]) * vs, (y + 0.5 - p.pivot[1]) * vs, (zz + 0.5 - p.pivot[2]) * vs).applyMatrix4(M));
      });
    }
    return box;
  });
}

// ======================================================================= a gun as a display
export interface Display {
  g: GunKey;
  /** carries the pose (position, orientation, scale); the rig root sits at its origin */
  hold: THREE.Group;
  root: THREE.Object3D;
  inst: RigInstance;
  spec: RigSpec;
}
/** a gun's components (rig part name, UI label, the slot that swaps it) */
export interface GunComp {
  name: string;
  label: string;
  slot?: string;
  parent?: string;
}
export const componentsOf = (spec: RigSpec | null | undefined) => ((spec?.meta?.components ?? []) as GunComp[]);
/** a gun as configured now (the six-shooter's gold parts from the save; bare: nothing fitted) */
export function gunSpec(g: GunKey, bare = false): RigSpec | null {
  if (g === 'revolver') return buildWeaponRig('revolver', bare ? [] : undefined, bare ? { gun: REV_DEFAULT as never } : {});
  return buildWeaponRig(g, bare ? [] : undefined);
}
/** a display from a built spec (rig geometry is cached by its config name, so nothing here is disposed) */
export function displayFromSpec(g: GunKey, spec: RigSpec): Display {
  const inst = new RigInstance(buildRigGeo(spec), { material: sharedVoxelMaterial, castShadow: true });
  inst.root.userData.rig = inst;
  inst.root.userData.components = componentsOf(spec);
  inst.root.userData.explode = (t: number) => explodeWeapon(inst, t);
  const hold = new THREE.Group();
  hold.add(inst.root);
  hold.userData.gun = g;
  return { g, hold, root: inst.root, inst, spec };
}
/** build a gun with everything fitted to it */
export function buildDisplay(g: GunKey): Display | null {
  const spec = safe(() => gunSpec(g));
  return spec ? displayFromSpec(g, spec) : null;
}
/** the gun's box in its hold's frame for an orientation and scale (both rotations are axis-aligned, so it is exact) */
export function poseBox(d: Display, q: THREE.Quaternion, s: number): THREE.Box3 {
  d.root.updateWorldMatrix(true, true);
  const inv = d.root.matrixWorld.clone().invert();
  const R = new THREE.Matrix4().compose(new THREE.Vector3(), q, new THREE.Vector3(s, s, s));
  const M = new THREE.Matrix4();
  const box = new THREE.Box3();
  d.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    M.multiplyMatrices(inv, mesh.matrixWorld).premultiply(R);
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(M));
  });
  return box;
}
/** a socket's place in the hold's frame for an orientation and scale */
export function poseSocket(d: Display, name: string, q: THREE.Quaternion, s: number): THREE.Vector3 | null {
  const sk = d.root.getObjectByName('socket:' + name);
  if (!sk) return null;
  d.root.updateWorldMatrix(true, true);
  const p = sk.getWorldPosition(new THREE.Vector3()).applyMatrix4(d.root.matrixWorld.clone().invert());
  return p.multiplyScalar(s).applyQuaternion(q);
}

// ======================================================================= Alagard on paper and brass
/** a printed face: a canvas with Alagard type (typography only), on a plane laid over a card's face */
export class TextCard {
  readonly mesh: THREE.Mesh;
  private cv = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private key = '';
  constructor(public w: number, public h: number, px = 320) {
    this.cv.width = px;
    this.cv.height = Math.max(16, Math.round((px * h) / w));
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    // unlit ink: the type keeps its exact colour and edge whatever the light on the card
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    this.mesh.renderOrder = 2;
  }
  /** lines of type, centred (size: fraction of the card's height; wrap: break long lines to the width) */
  set(lines: { t: string; size: number; color?: string; wrap?: boolean; emboss?: boolean; align?: 'center' | 'left' }[], pad = 0.06) {
    const key = JSON.stringify(lines);
    if (key === this.key) return;
    if (!fontReady()) return; // retried next frame until Alagard is in
    this.key = key;
    const c = this.cv.getContext('2d')!;
    const W = this.cv.width, H = this.cv.height;
    c.clearRect(0, 0, W, H);
    c.textBaseline = 'middle';
    const rows: { t: string; px: number; color: string; emboss: boolean; align: 'center' | 'left' }[] = [];
    for (const l of lines) {
      let px = Math.round(l.size * H);
      c.font = `${px}px Alagard`;
      const maxW = W * (1 - pad * 2);
      if (l.wrap) {
        let cur = '';
        for (const word of l.t.split(' ')) {
          const tryS = cur ? cur + ' ' + word : word;
          if (c.measureText(tryS).width > maxW && cur) {
            rows.push({ t: cur, px, color: l.color ?? '#2a1a0e', emboss: !!l.emboss, align: l.align ?? 'center' });
            cur = word;
          } else cur = tryS;
        }
        if (cur) rows.push({ t: cur, px, color: l.color ?? '#2a1a0e', emboss: !!l.emboss, align: l.align ?? 'center' });
      } else {
        const tw = c.measureText(l.t).width;
        if (tw > maxW) px = Math.floor((px * maxW) / tw);
        rows.push({ t: l.t, px, color: l.color ?? '#2a1a0e', emboss: !!l.emboss, align: l.align ?? 'center' });
      }
    }
    const total = rows.reduce((a, r) => a + r.px * 1.18, 0);
    let y = Math.max(r0(H * pad), (H - total) / 2);
    for (const r of rows) {
      c.font = `${r.px}px Alagard`;
      c.textAlign = r.align;
      const x = r.align === 'left' ? W * pad : W / 2;
      const cy = y + r.px * 0.59;
      if (r.emboss) {
        c.fillStyle = 'rgba(255,236,180,0.55)';
        c.fillText(r.t, x + 1, cy + 1.5);
      }
      c.fillStyle = r.color;
      c.fillText(r.t, x, cy);
      y += r.px * 1.18;
    }
    this.tex.needsUpdate = true;
  }
  dispose() {
    this.tex.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
const r0 = (v: number) => Math.round(v);
let fontOk = false;
export function fontReady() {
  if (fontOk) return true;
  try {
    fontOk = document.fonts.check('24px Alagard');
    if (!fontOk) void document.fonts.load('24px Alagard');
  } catch {
    fontOk = true;
  }
  return fontOk;
}

/** a manila tag on its twine (the price-tag model), its top hanging from the group's origin, with type on it */
export function hangingTag(scale = 1) {
  const ts = safe(() => WS.priceTag());
  const g = geoOf(ts);
  const grp = new THREE.Group();
  if (!ts || !g) return null;
  const top = new THREE.Vector3(...(ts.meta.top as number[]));
  const m = meshOf(g, sharedVoxelMaterial, false);
  m.position.copy(top).negate();
  grp.add(m);
  const [w, h] = ts.meta.size as [number, number];
  const card = new TextCard(w, h, 384);
  card.mesh.position.set(...(ts.meta.face as [number, number, number])).sub(top);
  // meta.face sits mid-card: half a voxel (1/96) out to the printed face, and a hair proud of it
  card.mesh.position.z += 0.5 / 96 + 0.0015;
  grp.add(card.mesh);
  grp.scale.setScalar(scale);
  return { grp, card };
}

// ======================================================================= the rack
export interface Bay {
  i: number;
  g: GunKey;
  /** world points (see WS.gunRack's meta) */
  axis: number;
  cradle: THREE.Vector3;
  centre: THREE.Vector3;
  plate: THREE.Vector3;
  bulb: THREE.Vector3;
  peg: THREE.Vector3;
  /** the gun on show (null: not found yet) and whether it is out on the bench */
  disp: Display | null;
  out: boolean;
  rest: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number } | null;
  lift: number;
  plateMesh: THREE.Group | null;
  plateCard: TextCard | null;
  dust: THREE.Mesh | null;
  tag: { grp: THREE.Group; card: TextCard } | null;
}

export class GunRack {
  grp: THREE.Group | null = null;
  box = new THREE.Box3();
  bays: Bay[] = [];
  shelfY = 1.1;
  gunZ = -3.15;
  backZ = -3.26;
  frontZ = -3.0;
  ledge = new THREE.Vector3();
  spot: THREE.SpotLight | null = null;
  /** the bay being looked at (null: nobody at the rack) */
  focus: number | null = null;
  /** the bench borrows the spot to light the turntable while a gun is on it */
  spotOverride: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private cartridges = new THREE.Group();
  private clip: THREE.Mesh | null = null;
  private spotK = 0;
  private t = 0;
  private texted = false;

  constructor(private h: HubHost) {}

  build(k: BuildKit, x: number) {
    const sm = safe(() => WS.gunRack());
    const grp = k.against(sm, 'back', x, 1.0, 0.03, 1, false);
    if (!grp || !sm) return;
    this.grp = grp;
    grp.updateMatrixWorld(true);
    this.box.setFromObject(grp);
    const W = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(grp.matrixWorld);
    const meta = sm.meta;
    this.shelfY = W([0, meta.shelf, 0]).y;
    this.gunZ = W([0, 0, meta.gunZ]).z;
    this.backZ = W([0, 0, meta.back]).z;
    this.frontZ = W([0, 0, meta.front]).z;
    this.ledge.copy(W(meta.ledge));
    this.bays = RACK_ORDER.map((g, i) => {
      const b = meta.bays[i];
      return {
        i, g, axis: W([b.axis, 0, 0]).x, cradle: W(b.cradle), centre: W(b.centre), plate: W(b.plate), bulb: W(b.bulb), peg: W(b.peg),
        disp: null, out: false, rest: null, lift: 0, plateMesh: null, plateCard: null, dust: null, tag: null,
      };
    });
    // the warm spot that follows your eye along the rack
    const spot = new THREE.SpotLight(0xffd9a8, 0.6, 2.4, 0.62, 0.7, 1.3);
    spot.position.copy(this.bays[1].bulb);
    spot.target.position.copy(this.bays[1].centre);
    this.h.scene.add(spot, spot.target);
    this.spot = spot;
    this.h.scene.add(this.cartridges);
    for (const b of this.bays) this.refresh(b.g);
  }

  owned(g: GunKey) {
    return g === 'revolver' || Blueprints.ownsGun(g);
  }
  bayOf(g: GunKey) {
    return this.bays.find((b) => b.g === g)!;
  }

  /** where a gun stands in its bay (long guns: butt in the pocket, barrel in the cradle; the six-shooter centred on the board) */
  restPose(b: Bay, d: Display) {
    const s = scaleOf(b.g, 'rack');
    const q = b.g === 'revolver' ? Q_PISTOL : Q_UP;
    const box = poseBox(d, q, s);
    const pos = new THREE.Vector3();
    if (b.g === 'revolver') pos.copy(b.centre).sub(box.getCenter(new THREE.Vector3())).setZ(this.gunZ - (box.min.z + box.max.z) / 2);
    else {
      const mz = poseSocket(d, 'muzzle', Q_UP, s) ?? box.getCenter(new THREE.Vector3());
      pos.set(b.axis - mz.x, this.shelfY - 0.012 - box.min.y, this.gunZ - mz.z);
    }
    return { pos, quat: q.clone(), scale: s };
  }

  /** (re)build a bay: its gun, plate, dust shadow and tag */
  refresh(g: GunKey) {
    const b = this.bayOf(g);
    if (!b) return;
    const own = this.owned(g);
    // ---- the gun (only when it is home on the rack)
    if (!b.out) {
      b.disp?.hold.removeFromParent();
      b.disp = own ? buildDisplay(g) : null;
      if (b.disp) this.seat(b);
    }
    // ---- the dust shadow where a gun you have not found would hang
    b.dust?.removeFromParent();
    b.dust?.geometry.dispose();
    b.dust = own ? null : this.dustOf(b);
    // ---- the nameplate (name hidden until you find it)
    const key = own ? 'own' : 'lost';
    if (b.plateMesh?.userData.key !== key) {
      b.plateMesh?.removeFromParent();
      b.plateCard?.dispose();
      b.plateMesh = null;
      b.plateCard = null;
      const ps = safe(() => WS.brassPlate(66, 15, !own, 52 + b.i));
      const pg = geoOf(ps, 'center');
      if (pg) {
        const grp = new THREE.Group();
        grp.add(meshOf(pg, sharedVoxelMaterial, false));
        const bb = pg.boundingBox!;
        const card = new TextCard((bb.max.x - bb.min.x) * 0.84, (bb.max.y - bb.min.y) * 0.8, 512);
        card.mesh.position.z = bb.max.z + 0.0012;
        grp.add(card.mesh);
        grp.position.copy(b.plate).setZ(b.plate.z - bb.min.z + 0.0005);
        grp.userData.key = key;
        this.h.scene.add(grp);
        b.plateMesh = grp;
        b.plateCard = card;
      }
    }
    this.plateText(b);
    // ---- the tag on the bay: what it is and how it rides
    if (own && !b.tag) {
      const t = hangingTag(0.95);
      if (t) {
        t.grp.position.copy(b.peg);
        this.h.scene.add(t.grp);
        b.tag = t;
      }
    } else if (!own && b.tag) {
      b.tag.grp.removeFromParent();
      b.tag.card.dispose();
      b.tag = null;
    }
    this.refreshTags();
    if (g === 'revolver') this.refreshLedge();
  }
  private plateText(b: Bay) {
    const own = this.owned(b.g);
    b.plateCard?.set([{ t: own ? GUNS[b.g].name.replace(/^The /, '').toUpperCase() : '?   ?   ?', size: 0.72, color: own ? '#24160a' : '#22221a', emboss: true }], 0.03);
  }
  /** the tags' words (call after the sling changes) */
  refreshTags() {
    for (const b of this.bays) {
      if (!b.tag) continue;
      const carried = b.g === 'revolver' || Blueprints.guns().find((q) => q.id === b.g)?.carried;
      b.tag.card.set([
        { t: GUNS[b.g].title.toUpperCase(), size: 0.34, color: '#7a2a16' },
        { t: b.g === 'revolver' ? 'on my hip' : carried ? 'on the sling' : 'stays home', size: 0.36 },
      ], 0.05);
    }
  }
  /** the owned upgrades as live cartridges on the shelf, the moon clip beside them when it is fitted */
  refreshLedge() {
    this.cartridges.clear();
    let i = 0;
    for (const u of Blueprints.upgrades()) {
      if (!u.owned) continue;
      const sm = safe(() => cartridgeTrio(u.tip));
      const g = sm ? buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: sm.pivot }) : null;
      if (!g) continue;
      const m = meshOf(g);
      m.rotation.set(0, Math.PI / 2 + Math.sin(i * 1.7) * 0.4, 0);
      m.position.set(this.ledge.x - 0.1 + i * 0.05, this.shelfY + 0.002, this.ledge.z + Math.sin(i * 2.3) * 0.012);
      m.userData.upgrade = u.id;
      this.cartridges.add(m);
      i++;
    }
    this.clip?.removeFromParent();
    this.clip = null;
    const rev = this.bayOf('revolver');
    if (Blueprints.fitted('revolver').some((a) => a.id === 'rev_speedloader') && !rev.out) {
      const cg = geoOf(safe(() => WS.moonClip()));
      if (cg) {
        this.clip = meshOf(cg);
        this.clip.position.set(this.ledge.x + 0.1, this.shelfY + 0.002, this.ledge.z - 0.01);
        this.clip.scale.setScalar(1.1);
        this.h.scene.add(this.clip);
      }
    }
  }
  /** a gun goes up on its bay (its hold straight under the scene, at the rest pose) */
  seat(b: Bay) {
    const d = b.disp;
    if (!d) return;
    b.rest = this.restPose(b, d);
    this.h.scene.add(d.hold);
    d.hold.position.copy(b.rest.pos);
    d.hold.quaternion.copy(b.rest.quat);
    d.hold.scale.setScalar(b.rest.scale);
    b.out = false;
    b.lift = 0;
  }
  /** the shadow a gun you have not found would leave on the boards */
  private dustOf(b: Bay): THREE.Mesh | null {
    const spec = safe(() => gunSpec(b.g, true));
    if (!spec) return null;
    const s = scaleOf(b.g, 'rack');
    const cell = 1 / 128;
    const pts: number[] = [];
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    const v = new THREE.Vector3();
    const half = (spec.voxelSize * s) / 2;
    for (const p of spec.parts) {
      const M = restMatrix(spec, p.name), vs = spec.voxelSize;
      p.model.forEach((x, y, z) => {
        v.set((x + 0.5 - p.pivot[0]) * vs, (y + 0.5 - p.pivot[1]) * vs, (z + 0.5 - p.pivot[2]) * vs).applyMatrix4(M).multiplyScalar(s).applyQuaternion(b.g === 'revolver' ? Q_PISTOL : Q_UP);
        pts.push(v.x, v.y);
        minX = Math.min(minX, v.x - half);
        maxX = Math.max(maxX, v.x + half);
        minY = Math.min(minY, v.y - half);
        maxY = Math.max(maxY, v.y + half);
      });
    }
    // where the gun would stand: the same rule as a real one (butt on the shelf, barrel in the cradle)
    let ox: number, oy: number;
    if (b.g === 'revolver') {
      ox = b.centre.x - (minX + maxX) / 2;
      oy = b.centre.y - (minY + maxY) / 2;
    } else {
      const sk = spec.sockets?.muzzle;
      const part = spec.parts.find((q) => q.name === sk?.part);
      let mx = (minX + maxX) / 2;
      if (sk && part) mx = v.set((sk.at[0] - part.pivot[0]) * spec.voxelSize, (sk.at[1] - part.pivot[1]) * spec.voxelSize, (sk.at[2] - part.pivot[2]) * spec.voxelSize).applyMatrix4(restMatrix(spec, part.name)).multiplyScalar(s).applyQuaternion(Q_UP).x;
      ox = b.axis - mx;
      oy = this.shelfY - 0.012 - minY;
    }
    const c0 = Math.floor(minX / cell), r0 = Math.floor(minY / cell);
    const w = Math.ceil(maxX / cell) - c0 + 1, hh = Math.ceil(maxY / cell) - r0 + 1;
    const mask = new Uint8Array(w * hh);
    const reach = Math.max(0, Math.ceil(half / cell - 0.5));
    for (let i = 0; i < pts.length; i += 2) {
      const cx = Math.floor(pts[i] / cell) - c0, cy = Math.floor(pts[i + 1] / cell) - r0;
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < w && y < hh) mask[y * w + x] = 1;
      }
    }
    const sm = safe(() => WS.dustOutline(mask, w, hh, cell, 54 + b.i));
    const g = sm ? buildVoxelGeometry(sm.model, { voxelSize: cell, pivot: [0, 0, 0] }) : null;
    if (!g) return null;
    const m = meshOf(g, sharedVoxelMaterial, false);
    m.position.set(ox + c0 * cell, oy + r0 * cell, this.backZ + 0.0008);
    this.h.scene.add(m);
    return m;
  }

  /** every frame: the looked-at gun lifts in its cradle, the spot glides to its bay, the tags sway */
  tick(rdt: number) {
    this.t += rdt;
    if (!this.texted && fontReady()) {
      this.texted = true;
      for (const b of this.bays) this.plateText(b);
      this.refreshTags();
    }
    for (const b of this.bays) {
      const want = this.focus === b.i ? 1 : 0;
      b.lift = damp(b.lift, want, 6, rdt);
      if (b.disp && !b.out && b.rest) {
        const e = b.lift;
        b.disp.hold.position.set(b.rest.pos.x, b.rest.pos.y + e * 0.024 + Math.sin(this.t * 1.7) * 0.0015 * e, b.rest.pos.z + e * 0.016);
        b.disp.hold.quaternion.copy(b.rest.quat).premultiply(_q.setFromAxisAngle(_up, e * 0.12 * (b.g === 'revolver' ? -1 : 1)));
      }
      if (b.tag) b.tag.grp.rotation.z = Math.sin(this.t * 1.3 + b.i * 2) * 0.05 + (b.i === this.focus ? Math.sin(this.t * 3.1) * 0.03 : 0);
    }
    const sp = this.spot;
    if (sp) {
      const f = this.focus !== null ? this.bays[this.focus] : null;
      const o = this.spotOverride;
      this.spotK = damp(this.spotK, f || o ? 1 : 0, 3, rdt);
      const k = 1 - Math.exp(-rdt * 4);
      if (o) {
        sp.position.lerp(o.pos, k);
        sp.target.position.lerp(o.target, k);
      } else if (f) {
        sp.position.lerp(_v.copy(f.bulb).add(_off), k);
        sp.target.position.lerp(f.centre, k);
      }
      sp.distance = o ? 3.2 : 2.4;
      sp.intensity = 0.6 + this.spotK * (o ? 5 : 3.4);
    }
  }

  dispose() {
    for (const b of this.bays) {
      b.plateCard?.dispose();
      b.tag?.card.dispose();
      b.dust?.geometry.dispose();
    }
  }
}
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3(), _off = new THREE.Vector3(0, -0.02, 0.06);
