// The gunsmith's bench, fully 3D (it replaces the old drag-and-drop panel).
// The six-shooter sits on its felt cradle; the long guns you own hang on forged
// hooks over the tool wall and come down onto the oilcloth when you work on
// them (click one; click it again on the bench to sling it for the ride). Every
// part you own lies in the walnut tray at the front edge as a real 3D piece:
// click it and it flies onto the gun, Sundown sets it with a wrench in a spray
// of sparks, and the gun is rebuilt with it. Click a fitted part on the gun to
// take it off. The six-shooter's barrels, cylinders, grips and sights are parts
// too (chained with a price tag until you buy them). Blueprints you have not
// found yet are pinned to the wall over the board rack, each one a photograph
// of its own schematic; weapon upgrades you own stand on the bench as live
// cartridges with their coloured tips.
import * as THREE from 'three';
import type { RigSpec } from '../../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import * as CH from '../../models/characters';
import * as WS from '../../models/props/workshop';
import * as HX from '../../models/props/hideout';
import { revolverLaserModel, cartridgeTrio } from '../../models/characters/longguns';
import { Blueprints, GUNS, ATTACHMENTS, WEAPON_UPGRADES, blueprint } from '../../meta/Blueprints';
import { buildWeaponDisplay, buildWeaponRig } from '../../player/Weapons';
import { blueprintPhoto } from '../../ui/BlueprintReveal';
import { loadSave, writeSave, owns, PRICES, GUN_PARTS, GUN_PERKS, GunLoadout } from '../../meta/Save';
import { BuildKit, HubHost, HubStation, HeroBubble, PriceLock, safe, geoOf, meshOf, reach, ease, clamp01, sstep } from './HubKit';
import type { Mode, Pick, View } from './HouseExtras';

const IN = HX.CABIN_IN;
type GunKey = 'revolver' | 'shotgun' | 'tommy';
const FV = 1 / 48;
const REV_DEFAULT: GunLoadout = { barrel: 'standard', cylinder: 'standard', grip: 'wood', sight: 'none' };
/** guns lying on the bench: on the left flank, muzzle to the right, the top toward the wall */
const Q_BENCH = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)));
/** guns on the wall hooks: upright, muzzle to the right, the right flank to the room */
const Q_WALL = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)));
const proxyMat = new THREE.MeshBasicMaterial({ visible: false });

interface Part {
  id: string;
  gun: GunKey;
  slot: string;
  name: string;
  desc: string;
  /** the part's voxels in gun-rig space (so parenting it to the gun root puts it exactly where it fits) */
  grp: THREE.Group;
  /** centre of its content in rig space */
  c: THREE.Vector3;
  len: number;
  lock: PriceLock | null;
  /** revolver gold part: the save key, else a blueprint attachment */
  key?: string;
  proxy: THREE.Group | null;
}

/** the rest-pose transform of a part inside its rig */
function restMatrix(spec: RigSpec, name: string): THREE.Matrix4 {
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
 * The pieces that change between the options of one slot: for each part, the
 * voxels where the option rigs disagree (missing or a different colour). Each
 * option's piece is its own voxels inside that zone, meshed in rig space.
 */
function slotPieces(specs: RigSpec[]): THREE.Group[] {
  const names = new Set<string>();
  for (const s of specs) for (const p of s.parts) names.add(p.name);
  const zone = new Map<string, Set<string>>();
  for (const n of names) {
    const z = new Set<string>();
    const models = specs.map((s) => s.parts.find((p) => p.name === n)?.model ?? null);
    const all = new Set<string>();
    for (const m of models) m?.forEach((x, y, zz) => all.add(key3(x, y, zz)));
    for (const k of all) {
      const [x, y, zz] = k.split(',').map(Number);
      let first: number | undefined | null = null;
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
    if (z.size) zone.set(n, z);
  }
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

export class Bench3D implements Mode {
  id = 'bench';
  done = false;
  private st: HubStation | null = null;
  private top = 0.958;
  private bx = -1.32;
  private zBack = -3.26;
  private zFront = -2.55;
  private sel: GunKey = 'revolver';
  private longs: Partial<Record<GunKey, { root: THREE.Object3D; hook: THREE.Vector3 }>> = {};
  private parts: Part[] = [];
  private pieceJob: Generator<void, void, void> | null = null;
  private built = new Set<GunKey>();
  private trayY = 0;
  private papers: { id: string; mesh: THREE.Mesh; at: THREE.Vector3; ready: boolean }[] = [];
  private paperJob: Generator<void, void, void> | null = null;
  private paperDelay = 7;
  private cartridges = new THREE.Group();
  private laser: THREE.Mesh | null = null;
  private clip: THREE.Object3D | null = null;
  private wrench: THREE.Mesh | null = null;
  private vi = -1;
  private views: View[] = [];
  private fly: { p: Part; t: number; on: boolean; from: THREE.Matrix4; to: THREE.Object3D; done: boolean } | null = null;
  private v = new THREE.Vector3();

  constructor(private h: HubHost, private bubble: HeroBubble) {}

  build(k: BuildKit) {
    const wb = this.h.stations.find((s) => s.id === 'bench')?.objs[0];
    if (wb) {
      const bb = new THREE.Box3().setFromObject(wb);
      this.bx = wb.position.x;
      this.zBack = bb.min.z;
      this.zFront = bb.min.z + 35 * FV;
      this.top = wb.position.y + 46 * FV;
    }
    // the tray along the front edge, right of the vise
    const ts = safe(() => WS.partsTray(66, 3.5));
    const tray = k.put(ts, this.bx + 10 * FV, this.zFront - 4.5 * FV, 0, this.top, 1, false);
    this.trayY = this.top + (ts?.meta.top ?? 0.04) + 0.003;
    void tray;
    // the long guns' hooks over the tool wall
    for (const [g, y] of [['shotgun', 2.0], ['tommy', 2.28]] as const) {
      for (const dx of [-0.34, 0.3]) k.against(safe(() => WS.gunHook(46 + (y > 2.1 ? 1 : 0))), 'back', this.bx + dx, y - 0.1, 0.01, 1, false);
      this.longs[g] = { root: new THREE.Group(), hook: new THREE.Vector3(this.bx - 0.02, y + 0.03, IN.back + 0.15) };
    }
    this.h.scene.add(this.cartridges);
    this.views = [
      { pos: new THREE.Vector3(this.bx + 0.12, this.top + 0.72, this.zFront + 0.62), look: new THREE.Vector3(this.bx - 0.02, this.top + 0.02, this.zBack + 0.42), fov: 50 },
      { pos: new THREE.Vector3(-3.3, 1.72, -1.2), look: new THREE.Vector3(-3.45, 2.12, IN.back), fov: 50 },
    ];
    const wm = geoOf(safe(() => WS.benchWrench()), 'center');
    if (wm) {
      this.wrench = meshOf(wm);
      this.wrench.visible = false;
      this.h.scene.add(this.wrench);
    }
    this.refreshLongs();
    this.refreshUpgrades();
    this.paperJob = this.makePapers();
  }

  // ======================================================================= what's on the bench
  /** owned long guns: on their hooks, or (the one being worked on) lying on the oilcloth */
  private refreshLongs() {
    for (const g of ['shotgun', 'tommy'] as GunKey[]) {
      const L = this.longs[g];
      if (!L) continue;
      L.root.removeFromParent();
      if (!Blueprints.ownsGun(g as 'shotgun')) continue;
      const root = safe(() => buildWeaponDisplay(g as 'shotgun')) ?? null;
      if (!root) continue;
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
      const hold = new THREE.Group();
      hold.add(root);
      root.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(root);
      const c = bb.getCenter(new THREE.Vector3());
      root.position.sub(c);
      if (this.sel === g) {
        hold.quaternion.copy(Q_BENCH);
        hold.position.set(this.bx - 0.3, this.top + 0.04, this.zBack + 0.3);
        root.position.add(new THREE.Vector3(0, 0, 0));
        hold.updateMatrixWorld(true);
        const b2 = new THREE.Box3().setFromObject(hold);
        hold.position.y += this.top + 0.012 - b2.min.y;
      } else {
        hold.quaternion.copy(Q_WALL);
        hold.position.copy(L.hook);
      }
      this.h.scene.add(hold);
      L.root = hold;
      (hold.userData as { gun: GunKey }).gun = g;
    }
  }
  private gunRoot(g: GunKey): THREE.Object3D | null {
    if (g === 'revolver') return (this.h as unknown as { gun: { root: THREE.Object3D } | null }).gun?.root ?? null;
    const hold = this.longs[g]?.root;
    return hold?.children[0] ?? null;
  }
  /** owned upgrades: live cartridges standing on the bench by the oil can (tips in the upgrade's colour) */
  private refreshUpgrades() {
    this.cartridges.clear();
    let i = 0;
    for (const u of Blueprints.upgrades()) {
      if (!u.owned) continue;
      const sm = safe(() => cartridgeTrio(u.tip));
      const g = sm ? buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: sm.pivot }) : null;
      if (!g) continue;
      const m = meshOf(g);
      m.rotation.set(0, Math.PI / 2 + Math.sin(i) * 0.3, 0);
      m.position.set(this.bx + 0.62 + (i % 3) * 0.06, this.top + 0.012, this.zBack + 0.32 + Math.floor(i / 3) * 0.08);
      m.userData.upgrade = u.id;
      this.cartridges.add(m);
      i++;
    }
  }
  /** the six-shooter's fitted blueprint parts, physically on it: the laser under the barrel, the moon clip by the cradle */
  private dressRevolver() {
    const gun = (this.h as unknown as { gun: { nodes: Record<string, THREE.Object3D>; geo: { spec: RigSpec } } | null }).gun;
    this.laser?.removeFromParent();
    this.clip?.removeFromParent();
    this.laser = null;
    this.clip = null;
    if (!gun) return;
    const fitted = Blueprints.fitted('revolver').map((a) => a.id);
    const frame = gun.nodes['frame'];
    if (fitted.includes('rev_laser') && frame) {
      const sm = revolverLaserModel();
      const spec = gun.geo.spec;
      const vs = spec.voxelSize, piv = spec.parts[0].pivot;
      this.laser = meshOf(buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: sm.pivot }));
      this.laser.position.set((0.5 - piv[0]) * vs, (0.6 - piv[1]) * vs, (10.5 - piv[2]) * vs);
      frame.add(this.laser);
    }
    if (fitted.includes('rev_speedloader')) {
      const g = geoOf(safe(() => WS.moonClip()));
      if (g) {
        const m = meshOf(g);
        const hp = (this.h as unknown as { gunHolder: THREE.Object3D }).gunHolder.position;
        m.position.set(hp.x + 0.2, this.top + 0.01, hp.z + 0.1);
        m.scale.setScalar(1.2);
        this.h.scene.add(m);
        this.clip = m;
      }
    }
  }

  // ======================================================================= the parts tray
  /** build (a slice at a time) every part of the selected gun as a 3D piece */
  private *makePieces(g: GunKey): Generator<void, void, void> {
    if (g === 'revolver') {
      // the gold parts: one rig per option, the pieces where they differ
      for (const slot of Object.keys(GUN_PARTS) as (keyof GunLoadout)[]) {
        const opts = GUN_PARTS[slot] as string[];
        const specs = opts.map((o) => (CH as any).revolverRig({ ...REV_DEFAULT, [slot]: o }) as RigSpec);
        yield;
        const pieces = slotPieces(specs);
        opts.forEach((o, i) => {
          if (o === 'none' || o === 'standard' || o === 'wood') return;
          const key = `gun:${slot}:${o}`;
          this.addPart({ id: `${slot}:${o}`, gun: 'revolver', slot, name: `${cap(o)} ${slot}`, desc: GUN_PERKS[`${slot}:${o}`] ?? '', key, grp: pieces[i] });
        });
        yield;
      }
      for (const a of Blueprints.attachments('revolver')) {
        if (!a.owned) continue;
        const sm = a.id === 'rev_laser' ? revolverLaserModel() : null;
        const grp = new THREE.Group();
        if (sm) {
          // clamped under the barrel, just ahead of the cylinder (where Weapons puts it in a run)
          const rs = (CH as any).revolverRig(REV_DEFAULT) as RigSpec;
          const vs = rs.voxelSize, piv = rs.parts[0].pivot;
          const lm = meshOf(buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: sm.pivot }));
          lm.position.set((0.5 - piv[0]) * vs, (0.6 - piv[1]) * vs, (10.5 - piv[2]) * vs);
          grp.add(lm);
        }
        else {
          const cg = geoOf(safe(() => WS.moonClip()));
          if (cg) grp.add(meshOf(cg));
        }
        this.addPart({ id: a.id, gun: 'revolver', slot: a.slot, name: a.name, desc: a.desc, grp });
      }
      return;
    }
    // a long gun: per slot, the gun bare and with each option
    const atts = Blueprints.attachments(g as 'shotgun');
    const slots = [...new Set(atts.map((a) => a.slot))];
    for (const slot of slots) {
      const opts = atts.filter((a) => a.slot === slot);
      const specs = [buildWeaponRig(g as 'shotgun', []), ...opts.map((a) => buildWeaponRig(g as 'shotgun', [ATTACHMENTS[a.id]]))].filter((s): s is RigSpec => !!s);
      yield;
      const pieces = slotPieces(specs);
      opts.forEach((a, i) => {
        if (!a.owned) return;
        this.addPart({ id: a.id, gun: g, slot, name: a.name, desc: a.desc, grp: pieces[i + 1] });
      });
      yield;
    }
  }
  private addPart(p: Omit<Part, 'c' | 'len' | 'lock' | 'proxy'>) {
    const bb = new THREE.Box3().setFromObject(p.grp);
    if (bb.isEmpty()) return;
    const c = bb.getCenter(new THREE.Vector3());
    const part: Part = { ...p, c, len: Math.max(bb.max.z - bb.min.z, 0.03), lock: null, proxy: null };
    if (p.key && !owns(p.key)) part.lock = new PriceLock(this.h, p.key, PRICES[p.key] ?? 0, 16, 0.75);
    if (part.lock) this.h.scene.add(part.lock.grp);
    this.h.scene.add(p.grp);
    this.parts.push(part);
    this.layout();
  }
  private fittedNow(p: Part) {
    if (p.key) {
      const [slot, o] = p.id.split(':');
      return (loadSave().gun as unknown as Record<string, string>)[slot] === o;
    }
    return Blueprints.fitted(p.gun as 'revolver').some((a) => a.id === p.id);
  }
  /** lay the selected gun's loose parts out along the tray; fitted ones ride on the gun (with a hidden hit proxy) */
  private layout() {
    const loose = this.parts.filter((p) => p.gun === this.sel && !this.fittedNow(p) && this.fly?.p !== p);
    const gunQ = this.gunQuat(this.sel);
    const sc = this.sel === 'revolver' ? 1.25 : 1;
    const tot = loose.reduce((a, p) => a + p.len * sc + 0.035, 0);
    const span = 66 * FV - 0.08;
    const k = tot > span ? span / tot : 1;
    let x = this.bx + 10 * FV - Math.min(tot * k, span) / 2;
    for (const p of this.parts) {
      p.grp.visible = p.gun === this.sel && this.fly?.p !== p && !this.fittedNow(p);
      p.lock?.show(p.grp.visible);
    }
    for (const p of loose) {
      const L = p.len * sc * k;
      const at = new THREE.Vector3(x + L / 2, this.trayY, this.zFront - 4.5 * FV);
      x += L + 0.035 * k;
      p.grp.quaternion.copy(gunQ);
      p.grp.scale.setScalar(sc * k);
      p.grp.position.copy(at).sub(p.c.clone().multiplyScalar(sc * k).applyQuaternion(gunQ));
      p.grp.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(p.grp);
      p.grp.position.y += this.trayY - bb.min.y;
      if (p.lock) {
        p.lock.grp.position.set(at.x, this.trayY + Math.max(0.05, bb.max.y - bb.min.y) + 0.02, at.z + 0.02);
        p.lock.grp.rotation.y = 0;
      }
    }
    this.refreshProxies();
  }
  private gunQuat(g: GunKey) {
    const r = this.gunRoot(g);
    return r ? r.getWorldQuaternion(new THREE.Quaternion()) : Q_BENCH.clone();
  }
  /** invisible copies of the fitted parts on the gun, so you can click a part to take it off */
  private refreshProxies() {
    for (const p of this.parts) {
      p.proxy?.removeFromParent();
      p.proxy = null;
      if (p.gun !== this.sel || !this.fittedNow(p)) continue;
      const root = this.gunRoot(p.gun);
      if (!root) continue;
      const px = p.grp.clone();
      // a hair proud of the gun so a click finds the part before the gun under it
      px.quaternion.identity();
      px.scale.setScalar(1.04);
      px.position.copy(p.c).multiplyScalar(-0.04);
      px.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = proxyMat;
      });
      px.visible = true;
      root.add(px);
      p.proxy = px;
    }
  }

  // ======================================================================= blueprints you haven't found: pinned over the board rack
  private *makePapers(): Generator<void, void, void> {
    while (this.paperDelay > 0) yield;
    const locked = Blueprints.list().filter((b) => !b.owned && b.kind !== 'gear');
    const nailG = new THREE.BoxGeometry(0.012, 0.012, 0.02);
    const nailM = new THREE.MeshStandardMaterial({ color: 0x3a3430, metalness: 0.5, roughness: 0.5 });
    let slot = 0;
    for (const b of locked) {
      let at: THREE.Vector3;
      let w = 0.27;
      if (b.kind === 'gun' && this.longs[b.gun as GunKey]) {
        at = this.longs[b.gun as GunKey]!.hook.clone().setZ(IN.back + 0.012);
        w = 0.36;
      } else {
        if (slot >= 18) continue;
        const col = slot % 6, row = Math.floor(slot / 6);
        at = new THREE.Vector3(-4.42 + col * 0.36 + (row % 2) * 0.1, 2.36 - row * 0.21, IN.back + 0.01 + slot * 0.0006);
        slot++;
      }
      const tex = safe(() => blueprintPhoto(this.h.engine.renderer, b.id));
      if (tex) {
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
        mat.color.setScalar(2);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 1.6), mat);
        mesh.position.copy(at);
        mesh.rotation.z = Math.sin(slot * 2.3 + b.id.length) * 0.05;
        mesh.receiveShadow = true;
        mesh.userData.bp = b.id;
        const nail = new THREE.Mesh(nailG, nailM);
        nail.position.set(0, w / 3.2 - 0.012, 0.008);
        mesh.add(nail);
        this.h.scene.add(mesh);
        this.papers.push({ id: b.id, mesh, at, ready: true });
      }
      yield;
      for (let k = 0; k < 8; k++) yield; // a breath between photographs
    }
  }

  // ======================================================================= the mode
  enter(): Mode | null {
    this.st = this.h.here;
    this.done = false;
    this.vi = 0;
    this.paperDelay = 0;
    this.select(this.sel);
    this.h.engine.audio.play('rev_open', { volume: 0.5 });
    return this;
  }
  private select(g: GunKey) {
    const prev = this.sel;
    this.sel = g;
    if (prev !== g) {
      this.refreshLongs();
      this.h.engine.audio.play(g === 'revolver' ? 'rev_spin' : 'shotgun_pump', { volume: 0.4 });
    }
    if (!this.built.has(g)) {
      this.built.add(g);
      const job = this.makePieces(g);
      const prevJob = this.pieceJob;
      this.pieceJob = (function* () {
        if (prevJob) yield* prevJob;
        yield* job;
      })();
    }
    this.dressRevolver();
    this.layout();
  }
  view(): View | null {
    if (this.vi < 0 && this.st) return (this.h as unknown as { shotOf(st: HubStation): View }).shotOf(this.st);
    return this.views[this.vi] ?? null;
  }
  step(d: number) {
    const n = this.views.length + 1;
    this.vi = ((((this.vi + 1 + d) % n) + n) % n) - 1;
    this.h.engine.audio.play('paper_flutter', { volume: 0.15, pitch: 0.8 });
  }
  hint() {
    if (this.fly) return '';
    return 'Click a gun to work on it   ·   click a part to fit it, a fitted part to take it off   ·   A / D: look around   ·   Esc: done';
  }
  back() {
    if (this.fly) return false;
    this.done = true;
    return true;
  }
  picks(): Pick[] {
    if (this.fly) return [];
    const out: Pick[] = [];
    const rev = this.gunRoot('revolver');
    if (rev) out.push({ obj: rev, lift: false, tip: () => (this.sel === 'revolver' ? 'The Six-Shooter (on the cradle)' : 'Work on the Six-Shooter'), click: () => this.select('revolver') });
    for (const g of ['shotgun', 'tommy'] as GunKey[]) {
      const hold = this.longs[g]?.root;
      if (!hold?.parent || !hold.children.length) continue;
      out.push({
        obj: hold,
        lift: false,
        tip: () => {
          const carried = Blueprints.guns().find((q) => q.id === g)?.carried;
          if (this.sel !== g) return `Take down the ${GUNS[g].name}`;
          return carried ? `${GUNS[g].name}: on your sling (click to leave it home)` : `${GUNS[g].name}: click to sling it for the ride`;
        },
        click: () => {
          if (this.sel !== g) {
            this.select(g);
            this.vi = 0;
            return;
          }
          const carried = Blueprints.guns().find((q) => q.id === g)?.carried;
          Blueprints.setSecondary(carried ? null : (g as 'shotgun'));
          this.h.engine.audio.play(carried ? 'rev_close' : 'shotgun_pump', { volume: 0.6 });
          this.bubble.say(carried ? 'Stays home today.' : `${GUNS[g].name} rides with me.`);
        },
      });
    }
    for (const p of this.parts) {
      if (p.gun !== this.sel) continue;
      if (p.proxy) out.push({ obj: p.proxy, lift: false, tip: () => `${p.name}: click to take it off`, click: () => this.unfit(p) });
      else if (p.grp.visible) out.push({ obj: p.grp, tip: () => (p.lock && !p.lock.open ? p.lock.tip(p.name) : `${p.name}: ${p.desc}`), click: () => this.fit(p) });
    }
    for (const pp of this.papers) {
      const b = blueprint(pp.id);
      out.push({ obj: pp.mesh, lift: false, tip: () => `Blueprint not found yet: ${b?.name ?? pp.id}`, click: () => this.bubble.say(['Still out there somewhere.', 'Haven\'t found that one yet.', 'One day.'][pp.id.length % 3]) });
    }
    for (const c of this.cartridges.children) {
      const u = WEAPON_UPGRADES[c.userData.upgrade as string];
      if (u) out.push({ obj: c, tip: () => `${u.name}: ${u.desc}`, click: () => this.h.engine.audio.play('shell_casing', { volume: 0.6 }) });
    }
    return out;
  }

  private fit(p: Part) {
    if (p.lock && !p.lock.open && !p.lock.click()) return;
    const root = this.gunRoot(p.gun);
    if (!root) return;
    p.grp.updateMatrixWorld(true);
    this.fly = { p, t: 0, on: true, from: p.grp.matrixWorld.clone(), to: root, done: false };
    this.vi = 0;
  }
  private unfit(p: Part) {
    const root = this.gunRoot(p.gun);
    if (!root) return;
    root.updateMatrixWorld(true);
    // take it off now; it flies from where it sat on the gun back into the tray
    this.apply(p, false);
    this.layout();
    const to = p.grp.matrixWorld.clone();
    p.grp.matrixAutoUpdate = true;
    this.fly = { p, t: 0, on: false, from: root.matrixWorld.clone(), to: root, done: false };
    (this.fly as unknown as { back: THREE.Matrix4 }).back = to;
  }
  /** the save: fit or remove (revolver gold parts change the loadout and rebuild the gun) */
  private apply(p: Part, on: boolean) {
    if (p.key) {
      const [slot, o] = p.id.split(':') as [keyof GunLoadout, string];
      const d = loadSave();
      (d.gun as unknown as Record<string, string>)[slot] = on ? o : (REV_DEFAULT as unknown as Record<string, string>)[slot];
      writeSave(d);
      (this.h as unknown as { buildGun(): void }).buildGun();
    } else if (on) Blueprints.fit(p.gun as 'revolver', p.id);
    else Blueprints.unfit(p.gun as 'revolver', p.slot as 'under');
    if (p.gun === 'revolver') this.dressRevolver();
    else this.refreshLongs();
  }

  // ======================================================================= per frame
  tick(_t: number, rdt: number) {
    this.paperDelay -= rdt;
    for (const job of ['pieceJob', 'paperJob'] as const) {
      const j = this[job];
      if (!j) continue;
      const t0 = performance.now();
      try {
        while (performance.now() - t0 < 9) if (j.next().done) {
          this[job] = null;
          break;
        }
      } catch (e) {
        console.warn('[hub+] bench', e);
        this[job] = null;
      }
    }
    for (const p of this.parts) {
      p.lock?.update(rdt);
      p.lock?.show(p.grp.visible);
    }
    // the six-shooter is rebuilt by the hub at times: keep its fitted parts on it
    const gr = this.gunRoot('revolver');
    if (gr !== this.lastGun) {
      this.lastGun = gr;
      this.dressRevolver();
      if (this.sel === 'revolver') this.refreshProxies();
    }
  }
  private lastGun: THREE.Object3D | null = null;
  update(t: number, rdt: number) {
    const f = this.fly;
    if (!f) return;
    f.t += rdt;
    const p = f.p, eng = this.h.engine;
    const target = f.to.matrixWorld;
    const back = (f as unknown as { back?: THREE.Matrix4 }).back;
    const A = f.on ? f.from : f.from, B = f.on ? target : back ?? f.from;
    const u = clamp01(f.t / 0.75);
    const e = ease(u);
    const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3();
    const pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
    A.decompose(pa, qa, sa);
    B.decompose(pb, qb, sb);
    p.grp.visible = true;
    p.grp.position.lerpVectors(pa, pb, e);
    p.grp.position.y += Math.sin(Math.PI * u) * 0.16;
    p.grp.quaternion.slerpQuaternions(qa, qb, e);
    p.grp.scale.lerpVectors(sa, sb, e);
    // the wrench and the sparks while it seats
    const joint = this.v.copy(p.c).applyMatrix4(target);
    if (f.on && u >= 1 && f.t < 1.75) {
      if (this.wrench) {
        this.wrench.visible = true;
        this.wrench.position.copy(joint).add(new THREE.Vector3(0.06, 0.05, 0.06));
        this.wrench.rotation.set(-Math.PI / 2, 0, Math.sin(f.t * 14) * 0.5 + 0.4);
      }
      if (Math.random() < rdt * 24) this.h.particles.emit({ pos: joint, count: 2, spread: 0.9, up: 0.6, life: [0.2, 0.45], size: [0.03, 0.006], sprite: 'spark', color: 0xffc860, additive: true, gravity: -6, stretch: 0.03 });
      if (Math.floor(f.t * 7) !== Math.floor((f.t - rdt) * 7)) eng.audio.play(Math.random() < 0.5 ? 'rev_close' : 'counter_clang', { volume: 0.35, pitch: 1.2 + Math.random() * 0.3 });
    }
    const end = f.on ? 1.8 : 0.8;
    if (f.t >= end) {
      if (this.wrench) this.wrench.visible = false;
      this.fly = null;
      if (f.on) {
        this.apply(p, true);
        eng.audio.play('rev_spin', { volume: 0.5 });
        this.h.particles.emit({ pos: joint, count: 10, spread: 1.4, up: 0.8, life: [0.3, 0.6], size: [0.04, 0.008], sprite: 'spark', color: 0xffe0a0, additive: true, gravity: -6 });
        if (Math.random() < 0.6) this.bubble.say(['That\'ll do.', 'Snug as a tick.', 'Now we\'re talking.', 'Purrs like a cat.'][Math.floor(Math.random() * 4)]);
      } else eng.audio.play('shell_casing', { volume: 0.5 });
      this.layout();
    }
    void t;
  }
  /** his hand on the wrench while a part seats */
  poseHero(_t: number, _rdt: number) {
    const f = this.fly;
    if (!f || !f.on || f.t < 0.6) return;
    const w = sstep(0.6, 0.9, f.t) * (1 - sstep(1.6, 1.8, f.t));
    if (this.wrench?.visible) reach(this.h, 'r', this.wrench.position.clone().add(new THREE.Vector3(0.05, 0, 0.05)), new THREE.Vector3(-1, -0.4, -0.2), w);
  }

  dispose() {
    for (const p of this.parts) p.lock?.dispose();
    for (const pp of this.papers) (pp.mesh.material as THREE.Material).dispose();
  }
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
