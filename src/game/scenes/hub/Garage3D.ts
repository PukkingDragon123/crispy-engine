// The board rack, fully 3D (it replaces the old board panel): the board you
// ride sits on the sawhorses under fresh wax, the others stand nose-up in the
// rack. Click one and the two swap places through the air; locked boards stand
// chained with their price on a tag (click twice to buy).
import * as THREE from 'three';
import { loadSave, writeSave, owns, BOARDS, PRICES } from '../../meta/Save';
import { BuildKit, HubHost, HubStation, PriceLock, ease, clamp01 } from './HubKit';
import type { Mode, Pick, View } from './HouseExtras';

export class Garage3D implements Mode {
  id = 'garage';
  done = false;
  private st: HubStation | null = null;
  private locks = new Map<string, PriceLock>();
  private vi = -1;
  private views: View[] = [];
  private swap: { id: string; t: number; a: THREE.Object3D; b: THREE.Object3D | null; aFrom: THREE.Matrix4; aTo: THREE.Matrix4; bFrom: THREE.Matrix4 | null; bTo: THREE.Matrix4 | null } | null = null;

  constructor(private h: HubHost) {}

  private get rack() {
    return (this.h as unknown as { boardRackGroup: THREE.Group }).boardRackGroup;
  }
  private get bench() {
    return (this.h as unknown as { boardBench: THREE.Group }).boardBench;
  }
  /** the boards in the rack, in the order HubScene stood them there */
  private rackIds() {
    const d = loadSave();
    const slots = (this.rack.userData.slots as number[][]) ?? [];
    return BOARDS.filter((b) => b !== d.look.board)
      .sort((a, b) => Number(owns('board:' + b)) - Number(owns('board:' + a)))
      .slice(0, slots.length);
  }

  build(_k: BuildKit) {
    const r = this.rack.position;
    this.views = [{ pos: new THREE.Vector3(r.x + 0.15, 1.35, r.z + 1.95), look: new THREE.Vector3(r.x, 0.95, r.z + 0.1), fov: 50 }];
    for (const id of BOARDS) {
      const key = 'board:' + id;
      if ((PRICES[key] ?? 0) <= 0) continue;
      const L = new PriceLock(this.h, key, PRICES[key], 18, 0.9);
      L.grp.visible = false;
      this.h.scene.add(L.grp);
      this.locks.set(id, L);
    }
  }

  enter(): Mode | null {
    this.st = this.h.here;
    this.done = false;
    this.vi = 0;
    return this;
  }
  view(): View | null {
    if (this.vi < 0 && this.st) return (this.h as unknown as { shotOf(st: HubStation): View }).shotOf(this.st);
    return this.views[this.vi] ?? null;
  }
  step(d: number) {
    const n = this.views.length + 1;
    this.vi = ((((this.vi + 1 + d) % n) + n) % n) - 1;
  }
  hint() {
    return this.swap ? '' : 'Click a board in the rack to ride it   ·   A / D: look around   ·   Esc: done';
  }
  back() {
    if (this.swap) return false;
    this.done = true;
    return true;
  }
  picks(): Pick[] {
    if (this.swap) return [];
    const ids = this.rackIds();
    return this.rack.children.map((o, i) => {
      const id = ids[i];
      const lock = this.locks.get(id);
      return {
        obj: o,
        lift: false,
        tip: () => (lock && !lock.open ? lock.tip(cap(id)) : `Ride the ${id.replace('_', ' ')} board`),
        click: () => this.choose(id, o),
      };
    });
  }
  private choose(id: string, o: THREE.Object3D) {
    const lock = this.locks.get(id);
    if (lock && !lock.open && !lock.click()) return;
    const cur = this.bench.children.find((c) => (c as THREE.Mesh).isMesh && c.rotation.y !== 0.3) ?? this.bench.children[0] ?? null;
    o.updateMatrixWorld(true);
    cur?.updateMatrixWorld(true);
    const aFrom = o.matrixWorld.clone();
    const aTo = cur ? cur.matrixWorld.clone() : new THREE.Matrix4().setPosition(this.bench.position);
    // fly copies: the meshes stay where HubScene keeps them until the rebuild
    const a = o.clone();
    const b = cur ? cur.clone() : null;
    for (const m of [a, b]) if (m) {
      m.matrixAutoUpdate = true;
      this.h.scene.add(m);
    }
    o.visible = false;
    if (cur) cur.visible = false;
    this.swap = { id, t: 0, a, b, aFrom, aTo, bFrom: cur ? aTo.clone() : null, bTo: cur ? aFrom.clone() : null };
    this.h.engine.audio.play('whoosh', { volume: 0.4, pitch: 0.8 });
  }
  tick(_t: number, rdt: number) {
    const ids = this.rackIds();
    const slots = (this.rack.userData.slots as number[][]) ?? [];
    for (const [id, L] of this.locks) {
      L.update(rdt);
      const i = ids.indexOf(id);
      L.show(i >= 0 && !!slots[i]);
      if (i < 0 || !slots[i]) continue;
      const s = slots[i];
      L.grp.position.set(this.rack.position.x + s[0], this.rack.position.y + s[1] + 0.62, this.rack.position.z + s[2] + 0.18);
    }
  }
  update(_t: number, rdt: number) {
    const s = this.swap;
    if (!s) return;
    s.t += rdt;
    const u = clamp01(s.t / 0.9), e = ease(u);
    const go = (o: THREE.Object3D, A: THREE.Matrix4, B: THREE.Matrix4, lift: number) => {
      const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3();
      const pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
      A.decompose(pa, qa, sa);
      B.decompose(pb, qb, sb);
      o.position.lerpVectors(pa, pb, e);
      o.position.y += Math.sin(Math.PI * u) * lift;
      o.quaternion.slerpQuaternions(qa, qb, e);
      o.scale.lerpVectors(sa, sb, e);
    };
    go(s.a, s.aFrom, s.aTo, 0.45);
    if (s.b && s.bFrom && s.bTo) go(s.b, s.bFrom, s.bTo, 0.3);
    if (u >= 1) {
      s.a.removeFromParent();
      s.b?.removeFromParent();
      this.swap = null;
      const d = loadSave();
      d.look.board = s.id;
      writeSave(d);
      const host = this.h as unknown as { buildBoards(): void; buildHero(): void };
      host.buildBoards();
      host.buildHero();
      this.h.engine.audio.play('kick', { volume: 0.5, pitch: 1.4 });
      const bp = this.bench.position;
      this.h.particles.emit({ pos: { x: bp.x, y: bp.y + 0.05, z: bp.z }, count: 8, spread: 0.7, up: 0.3, life: [0.6, 1.2], size: [0.08, 0.25], sprite: ['puff0', 'puff1'], color: 0xe2c8a0, alpha: 0.45, drag: 2.5 });
    }
  }
  dispose() {
    for (const L of this.locks.values()) L.dispose();
  }
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ');
}
