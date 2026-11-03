// The dressing corner, fully 3D (it replaces the old wardrobe panel): every hat
// hangs on a Shaker peg rail on the right wall, every jacket on a wooden hanger
// on the clothes rail by the front window, the bandana mask is draped over the
// cheval mirror and the sunglasses hook on its frame. The camera glides from
// rack to rack (A / D); click a thing and Sundown walks over, takes it off the
// hook and tries it on; what he had on goes back where it hangs. Locked things
// hang chained with an Alagard price tag (click twice to buy).
import * as THREE from 'three';
import type { RigSpec, PartSpec } from '../../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import * as CH from '../../models/characters';
import * as WS from '../../models/props/workshop';
import * as HX from '../../models/props/hideout';
import { loadSave, writeSave, owns, HATS, OUTFITS, PRICES } from '../../meta/Save';
import { BuildKit, HubHost, HubStation, HeroBubble, PriceLock, safe, geoOf, meshOf, reach, joint, ease, clamp01, sstep, stepJob } from './HubKit';
import type { Mode, Pick, View } from './HouseExtras';

const IN = HX.CABIN_IN;
/** hats hang a little smaller than they sit on his big cartoon skull */
const HAT_HANG = 0.7;
type Kind = 'hat' | 'outfit' | 'mask' | 'shades';
interface Item {
  kind: Kind;
  id: string;
  /** where it lives (world) and how it sits there */
  home: THREE.Group;
  /** the display mesh(es) */
  obj: THREE.Group | null;
  lock: PriceLock | null;
  spot: THREE.Vector2;
  face: number;
  view: number;
  /** the world point his hand goes to */
  grab: THREE.Vector3;
}
const QUIPS: Record<Kind, string[]> = {
  hat: ['Now that is a hat.', 'Fits like it was made for my skull.', 'Tip of the hat to me.', 'Snug.'],
  outfit: ['Sharp.', 'Dressed to haunt.', 'The dunes will talk about this one.', 'Mama will say it brings out my cheekbones.'],
  mask: ['Outlaw business.', 'Nobody saw a thing.'],
  shades: ['Too bright out there anyhow.', 'Cool as a corpse.'],
};

/** the rest-pose world transform of a rig part (offset from the parent pivot, then its rest rotation) */
function restMatrix(spec: RigSpec, name: string): THREE.Matrix4 {
  const vs = spec.voxelSize;
  const by = new Map(spec.parts.map((p) => [p.name, p]));
  const chain: PartSpec[] = [];
  for (let p = by.get(name); p; p = p.parent ? by.get(p.parent) : undefined) chain.unshift(p);
  const M = new THREE.Matrix4();
  chain.forEach((p, i) => {
    const pp = i > 0 ? chain[i - 1] : null;
    const off = pp ? new THREE.Vector3((p.attach[0] - pp.pivot[0]) * vs, (p.attach[1] - pp.pivot[1]) * vs, (p.attach[2] - pp.pivot[2]) * vs) : new THREE.Vector3(p.attach[0] * vs, p.attach[1] * vs, p.attach[2] * vs);
    M.multiply(new THREE.Matrix4().compose(off, new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rest ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1)));
  });
  return M;
}
function partMesh(spec: RigSpec, name: string, filter?: (c: number) => boolean): THREE.Mesh | null {
  const p = spec.parts.find((q) => q.name === name);
  if (!p) return null;
  let model = p.model;
  if (filter) {
    model = new VoxelModel(name + ':cloth');
    p.model.forEach((x, y, z, c, f) => {
      if (filter(c)) model.set(x, y, z, c, f);
    });
    if (!model.count) return null;
  }
  const g = buildVoxelGeometry(model, { voxelSize: spec.voxelSize, pivot: p.pivot });
  const m = meshOf(g, sharedVoxelMaterial);
  m.applyMatrix4(restMatrix(spec, name));
  return m;
}

export class Wardrobe3D implements Mode {
  id = 'wardrobe';
  done = false;
  private st: HubStation | null = null;
  private items: Item[] = [];
  private pegs: THREE.Vector3[] = [];
  private railX: number[] = [];
  private railY = 1.6;
  private job: Generator<void, void, void> | null = null;
  private vi = 0;
  private views: View[] = [];
  private home = { stand: new THREE.Vector2(), face: 0 };
  private act: { it: Item; t: number; walked: boolean; carried: THREE.Object3D | null; swapped: boolean; spin: number; old: Item | null } | null = null;
  private flyBack: { it: Item; t: number; from: THREE.Vector3 } | null = null;
  private v = new THREE.Vector3();

  constructor(private h: HubHost, private bubble: HeroBubble) {}

  build(k: BuildKit) {
    // the hat rails on the right wall, between the door and the front corner
    const zc = 2.74;
    // three staggered rails, hats hung every which way (they are big hats: they hang at seven tenths)
    for (const [n, y, dz] of [[3, 1.94, 0], [2, 1.57, 0.08], [2, 1.2, -0.06]] as const) {
      const sm = safe(() => WS.hatPegRail(n, 41 + n + Math.round(y * 10)));
      const g = k.against(sm, 'right', zc + dz, y, 0.01, 1, false);
      if (g && sm) {
        g.updateMatrixWorld(true);
        for (const p of sm.meta.pegs) this.pegs.push(new THREE.Vector3(...p).applyMatrix4(g.matrixWorld));
      }
    }
    // the clothes rail along the front wall, right of the window
    const rs = safe(() => WS.clothesRail());
    const rail = k.put(rs, 3.5, IN.front - 0.32, 0, 0, 1, true);
    if (rail && rs) {
      this.railY = rs.meta.bar[0];
      for (let i = 0; i < OUTFITS.length; i++) this.railX.push(3.5 + (i - (OUTFITS.length - 1) / 2) * 0.235);
    }
    // the steamer trunk moves out of the corner to make room (to the front-left, by the terrarium)
    this.views = [
      { pos: new THREE.Vector3(2.75, 1.68, 1.3), look: new THREE.Vector3(4.75, 1.58, 2.78), fov: 46 },
      { pos: new THREE.Vector3(3.42, 1.46, 1.22), look: new THREE.Vector3(3.5, 1.18, IN.front - 0.32), fov: 50 },
    ];
    this.job = this.make();
  }

  /** build the hanging things a slice at a time: one look per frame */
  private *make(): Generator<void, void, void> {
    yield;
    const rigOf = (hat: string, outfit: string, extra: Record<string, boolean> = {}) => safe(() => (CH as any).skeletonCowboyRig({ hat, outfit, ...extra }) as RigSpec);
    // the bones (to strip out of the jackets): every colour of the bare skeleton
    const bare = rigOf('stetson', 'bare', { mask: false, shades: false });
    const bone = new Set<number>();
    if (bare) for (const p of bare.parts) if (/^(torso|arm_|fore_|pelvis)/.test(p.name)) p.model.forEach((_x, _y, _z, c) => bone.add(c & 0xffffff));
    yield;
    const n = Math.max(HATS.length, OUTFITS.length);
    for (let i = 0; i < n; i++) {
      const hat = HATS[i % HATS.length], outfit = OUTFITS[i % OUTFITS.length];
      const spec = rigOf(hat, outfit, { mask: i === 0, shades: i === 0 });
      if (!spec) continue;
      if (i < HATS.length) this.addHat(hat, spec, i);
      yield;
      if (i < OUTFITS.length) this.addOutfit(outfit, spec, i, bone);
      if (i === 0) this.addMirrorThings(spec);
      yield;
    }
  }

  private addHat(id: string, spec: RigSpec, i: number) {
    const peg = this.pegs[i];
    const m = partMesh(spec, 'hat');
    if (!peg || !m) return;
    // undo the rest offset: hang it by its own pivot (inside the crown)
    m.matrix.identity();
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    m.updateMatrix();
    const obj = new THREE.Group();
    obj.add(m);
    obj.scale.setScalar(HAT_HANG);
    const home = new THREE.Group();
    // crown up, tipped out from the wall, front to the room
    const X = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(-0.5, 0.866, 0), Z = new THREE.Vector3().crossVectors(X, Y);
    home.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    home.rotateY((i % 2 ? -1 : 1) * 0.18);
    home.position.copy(peg).add(new THREE.Vector3(-0.015, -0.03, 0));
    home.add(obj);
    this.h.scene.add(home);
    const key = 'hat:' + id;
    const lock = (PRICES[key] ?? 0) > 0 && !owns(key) ? new PriceLock(this.h, key, PRICES[key], 24, 1) : null;
    if (lock) {
      lock.grp.position.copy(peg).add(new THREE.Vector3(-0.05, -0.02, 0));
      lock.grp.rotation.y = -Math.PI / 2;
      this.h.scene.add(lock.grp);
    }
    this.items.push({ kind: 'hat', id, home, obj, lock, spot: new THREE.Vector2(4.22, 2.6 + (peg.z - 2.74) * 0.5), face: Math.PI / 2, view: 0, grab: peg.clone().add(new THREE.Vector3(-0.08, -0.02, 0)) });
  }

  private addOutfit(id: string, spec: RigSpec, i: number, bone: Set<number>) {
    const x = this.railX[i];
    if (x === undefined) return;
    const cloth = (c: number) => !bone.has(c & 0xffffff);
    const obj = new THREE.Group();
    for (const p of ['torso', 'arm_l', 'arm_r', 'fore_l', 'fore_r', 'coat']) {
      const m = partMesh(spec, p, cloth);
      if (m) obj.add(m);
    }
    if (!obj.children.length) return;
    // centre it under the hanger: shoulders at the hanger's bar
    const bb = new THREE.Box3().setFromObject(obj);
    const c = bb.getCenter(new THREE.Vector3());
    for (const ch of obj.children) ch.position.sub(new THREE.Vector3(c.x, bb.max.y - 0.03, c.z));
    const hs = safe(() => WS.coatHanger(43 + i));
    const hg = geoOf(hs, 'center');
    const home = new THREE.Group();
    if (hs && hg) {
      const hm = meshOf(hg);
      hm.position.y = 0.0;
      home.add(hm);
      obj.position.y = -0.0;
    }
    const hang = new THREE.Group();
    hang.add(obj);
    hang.position.y = -0.055;
    home.add(hang);
    home.position.set(x, this.railY - 0.085, IN.front - 0.32);
    home.rotation.y = Math.PI - 0.95 + Math.sin(i * 2.1) * 0.08;
    this.h.scene.add(home);
    const key = 'outfit:' + id;
    const lock = (PRICES[key] ?? 0) > 0 && !owns(key) ? new PriceLock(this.h, key, PRICES[key], 20, 1) : null;
    if (lock) {
      lock.grp.position.set(x, this.railY - 0.2, IN.front - 0.52);
      lock.grp.rotation.y = Math.PI - 0.6;
      this.h.scene.add(lock.grp);
    }
    this.items.push({ kind: 'outfit', id, home, obj: hang, lock, spot: new THREE.Vector2(x - 0.08, IN.front - 0.82), face: 0.1, view: 1, grab: new THREE.Vector3(x, this.railY - 0.25, IN.front - 0.42) });
  }

  private addMirrorThings(spec: RigSpec) {
    // the mirror's own frame (the Reflector is made after the build: find it lazily in tick)
    for (const [kind, part] of [['mask', 'mask'], ['shades', 'glasses']] as const) {
      const m = partMesh(spec, part);
      if (!m) continue;
      m.matrix.identity();
      m.position.set(0, 0, 0);
      m.rotation.set(0, 0, 0);
      const bb = new THREE.Box3().setFromObject(m);
      m.position.sub(bb.getCenter(new THREE.Vector3()));
      const obj = new THREE.Group();
      obj.add(m);
      const home = new THREE.Group();
      home.add(obj);
      home.visible = false;
      this.h.scene.add(home);
      this.items.push({ kind, id: kind, home, obj, lock: null, spot: new THREE.Vector2(), face: 0, view: -1, grab: new THREE.Vector3() });
    }
  }

  /** hang the mask over the mirror's top and hook the shades on its frame (once the glass exists) */
  private placeMirrorThings() {
    const mir = (this.h as unknown as { mirror: THREE.Mesh | null }).mirror;
    if (!mir) return false;
    mir.geometry.computeBoundingBox();
    const b = mir.geometry.boundingBox!;
    const ry = b.max.y, rx = b.max.x;
    const q = mir.quaternion;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q), right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), nrm = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const yaw = Math.atan2(nrm.x, nrm.z);
    const flat = new THREE.Vector2(nrm.x, nrm.z).normalize();
    for (const it of this.items) {
      if (it.kind !== 'mask' && it.kind !== 'shades') continue;
      if (it.kind === 'mask') {
        it.home.position.copy(mir.position).addScaledVector(up, ry + 0.035).addScaledVector(nrm, 0.02).addScaledVector(right, -rx * 0.2);
        it.home.rotation.set(0.35, yaw, 0.15, 'YXZ');
      } else {
        it.home.position.copy(mir.position).addScaledVector(up, ry * 0.62).addScaledVector(right, rx + 0.03).addScaledVector(nrm, 0.03);
        it.home.rotation.set(0.1, yaw, -0.55, 'YXZ');
      }
      it.home.visible = true;
      it.spot.set(mir.position.x + flat.x * 0.62, mir.position.z + flat.y * 0.62);
      it.face = Math.atan2(-flat.x, -flat.y);
      it.grab.copy(it.home.position);
    }
    return true;
  }
  private placed = false;

  // ======================================================================= the mode
  enter(): Mode | null {
    this.st = this.h.here;
    this.home.stand.copy(this.st.stand);
    this.home.face = this.st.face;
    this.done = false;
    this.vi = -1;
    this.h.engine.audio.play('chest_open', { volume: 0.4 });
    return this;
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
    if (this.act) return '';
    return 'Click a hat, a jacket, the mask or the shades to try it on   ·   A / D: look around   ·   Esc: done';
  }
  back() {
    if (this.act) return false;
    // walk back to the mirror
    if (this.st) {
      this.st.stand.copy(this.home.stand);
      this.st.face = this.home.face;
      this.h.route = [this.home.stand.clone()];
    }
    this.done = true;
    return true;
  }
  picks(): Pick[] {
    if (this.act) return [];
    const d = loadSave();
    const wearing = (it: Item) => (it.kind === 'hat' ? d.look.hat === it.id : it.kind === 'outfit' ? d.look.outfit === it.id : false);
    return this.items
      .filter((it) => it.obj && it.home.visible && !wearing(it))
      .map((it) => ({
        obj: it.home,
        tip: () => {
          const name = it.id.replace('_', ' ');
          if (it.lock && !it.lock.open) return it.lock.tip(cap(name));
          if (it.kind === 'mask') return (d.look as any).mask === false ? 'Pull the outlaw mask up' : 'Take the mask off';
          if (it.kind === 'shades') return (d.look as any).shades === false ? 'Put the shades on' : 'Take the shades off';
          return `Try on the ${name}`;
        },
        click: () => this.choose(it),
      }));
  }

  private choose(it: Item) {
    if (it.lock && !it.lock.open && !it.lock.click()) return;
    const st = this.st;
    if (!st) return;
    if (it.view >= 0) this.vi = it.view;
    st.stand.copy(it.spot);
    st.face = it.face;
    this.h.route = [it.spot.clone()];
    const old = it.kind === 'hat' || it.kind === 'outfit' ? this.items.find((q) => q.kind === it.kind && q.id === (loadSave().look as any)[it.kind]) ?? null : null;
    this.act = { it, t: 0, walked: false, carried: null, swapped: false, spin: 0, old };
  }

  // ======================================================================= per frame
  tick(t: number, rdt: number) {
    this.job = stepJob(this.job, 'wardrobe');
    if (!this.placed && !this.job) this.placed = this.placeMirrorThings();
    const d = loadSave();
    for (const it of this.items) {
      it.lock?.update(rdt);
      it.lock?.show(!!it.obj);
      // the worn hat / jacket is not on its hook
      const worn = (it.kind === 'hat' && d.look.hat === it.id) || (it.kind === 'outfit' && d.look.outfit === it.id);
      if (it.obj && !(this.act?.carried && this.act.it === it) && this.flyBack?.it !== it) it.obj.visible = !worn;
    }
    // the old one flies back to its hook
    const fb = this.flyBack;
    if (fb && fb.it.obj) {
      fb.t += rdt;
      const u = clamp01(fb.t / 0.7);
      const e = ease(u);
      const o = fb.it.obj;
      o.visible = true;
      const to = fb.it.home.getWorldPosition(this.v);
      const p = fb.from.clone().lerp(to, e);
      p.y += Math.sin(Math.PI * u) * 0.35;
      fb.it.home.worldToLocal(p);
      o.position.copy(p);
      o.rotation.set(0, (1 - e) * Math.PI * 2, 0);
      if (u >= 1) {
        o.position.set(0, 0, 0);
        o.rotation.set(0, 0, 0);
        this.flyBack = null;
        this.h.engine.audio.play('paper_flutter', { volume: 0.3, pitch: 1.3 });
      }
    }
    // swing the hangers a little in the draught
    for (const it of this.items) if (it.kind === 'outfit' && it.obj && this.act?.it !== it) it.obj.rotation.z = Math.sin(t * 0.9 + it.home.position.x * 9) * 0.02 * (0.4 + this.h.gust);
  }
  update(_t: number, rdt: number) {
    const a = this.act;
    if (!a) return;
    if (!a.walked) {
      a.walked = this.h.route.length === 0 && this.h.atK > 0.6;
      return;
    }
    a.t += rdt;
    const it = a.it;
    const eng = this.h.engine;
    // grab: off the hook into his hand
    if (a.t > 0.45 && !a.carried && it.obj) {
      const sock = this.h.hero?.sockets['hand_r'] ?? this.h.hero?.nodes['fore_r'];
      if (sock) {
        sock.attach(it.obj);
        a.carried = it.obj;
        eng.audio.play(it.kind === 'outfit' ? 'paper_flutter' : 'card_pick', { volume: 0.5 });
      }
    }
    if (a.carried && it.kind === 'hat') a.carried.scale.setScalar(HAT_HANG + (1 - HAT_HANG) * sstep(0.45, 1.1, a.t));
    const swapAt = it.kind === 'outfit' ? 1.55 : 1.15;
    if (a.t > swapAt && !a.swapped) {
      a.swapped = true;
      const d = loadSave();
      const from = this.h.hero?.nodes['head']?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(this.h.pos.x, 1.7, this.h.pos.y);
      if (it.kind === 'hat') d.look.hat = it.id;
      else if (it.kind === 'outfit') d.look.outfit = it.id;
      else if (it.kind === 'mask') (d.look as any).mask = (d.look as any).mask === false;
      else (d.look as any).shades = (d.look as any).shades === false;
      writeSave(d);
      // what he wore goes back on its hook
      if (a.carried) {
        it.home.attach(a.carried);
        a.carried.position.set(0, 0, 0);
        a.carried.rotation.set(0, 0, 0);
        if (it.kind === 'hat') a.carried.scale.setScalar(HAT_HANG);
        a.carried.visible = false;
      }
      (this.h as unknown as { buildHero(): void }).buildHero();
      if (a.old && a.old !== it) this.flyBack = { it: a.old, t: 0, from: it.kind === 'outfit' ? from.clone().add(new THREE.Vector3(0, -0.45, 0)) : from };
      for (let k = 0; k < 6; k++) this.h.particles.emit({ pos: { x: from.x, y: from.y - (it.kind === 'outfit' ? 0.5 : 0.1), z: from.z }, count: 1, spread: 0.6, up: 0.4, life: [0.5, 1.0], size: [0.1, 0.3], sprite: ['puff0', 'puff1', 'puff2'], color: 0xe8d8b8, alpha: 0.5, drag: 2.5 });
      eng.audio.play(it.kind === 'outfit' ? 'whoosh' : 'rev_spin', { volume: 0.4, pitch: 1.2 });
      this.h.hero?.setExpression('smug');
      const q = QUIPS[it.kind];
      if (Math.random() < 0.7) this.bubble.say(q[Math.floor(Math.random() * q.length)]);
    }
    if (a.t > swapAt + 0.9) this.act = null;
  }

  /** the hands: reach for it, lift it on (a hat to the head, a jacket held up for a twirl) */
  poseHero(t: number, _rdt: number) {
    const a = this.act;
    if (!a || !a.walked || !this.h.hero) return;
    const it = a.it, tt = a.t;
    const head = this.h.hero.nodes['head']?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(this.h.pos.x, 1.6, this.h.pos.y);
    const H = this.h.heroHolder;
    if (it.kind === 'outfit') {
      // both hands up to the hanger, hold it against his chest, then a twirl
      const up = sstep(0, 0.45, tt) * (1 - sstep(1.9, 2.4, tt));
      const chest = H.localToWorld(new THREE.Vector3(0, 1.32, 0.28));
      const tgt = tt < 0.45 ? it.grab : chest;
      reach(this.h, 'r', tgt, new THREE.Vector3(-0.8, -0.4, -0.4), up);
      reach(this.h, 'l', tgt.clone().add(new THREE.Vector3(0.06, -0.04, 0)), new THREE.Vector3(0.8, -0.4, -0.4), up * 0.8);
      const spin = sstep(1.1, 1.9, tt);
      H.rotation.y += spin * Math.PI * 2;
      joint(this.h, 'head', -0.1, 0, 0, up * 0.6);
    } else {
      const lift = sstep(0.45, 1.1, tt);
      const w = sstep(0, 0.35, tt) * (1 - sstep(1.5, 2.0, tt));
      const top = head.clone().add(new THREE.Vector3(0, it.kind === 'hat' ? 0.3 : 0.08, 0)).add(H.localToWorld(new THREE.Vector3(0, 0, 0.12)).sub(H.position));
      const tgt = it.grab.clone().lerp(top, ease(lift));
      reach(this.h, 'r', tgt, new THREE.Vector3(-1, -0.2, -0.3), w);
      if (it.kind === 'hat' && tt > 1.15) {
        // a tug of the brim
        const tug = sstep(1.2, 1.4, tt) * (1 - sstep(1.6, 1.9, tt));
        reach(this.h, 'l', head.clone().add(H.localToWorld(new THREE.Vector3(0.12, 0.26, 0.16)).sub(H.position)), new THREE.Vector3(1, -0.2, 0.1), tug);
      }
      joint(this.h, 'head', -0.25 * (1 - lift) + 0.08 * lift, 0, 0, w * 0.5);
    }
    void t;
  }

  dispose() {
    for (const it of this.items) it.lock?.dispose();
  }
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
