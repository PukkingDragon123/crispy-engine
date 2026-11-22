// The main menu's ruined cantina: behind the camp, to the right, an adobe building the desert has
// half taken back. The back wall still stands with its window hole and roof vigas; the side walls
// are broken stubs, the front has fallen into a heap; one viga lies where the roof came down. A
// projecting beam on the corner still carries the CANTINA sign on two chains, swinging slow and calm
// in the gusts. A lantern burns on the rubble inside, loose mud bricks lie scattered toward the
// camp, and a husk (a dead zombie) sits slumped against the outer wall under the sign, head lolled,
// one knee up, where Sundown left it. Sculpted voxel pieces only; the walls and rubble are the
// hideout's adobe pieces (models/props/hideout), the sign, vigas and bricks models/props/menuRuin.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance, type RigSpec } from '../../../engine/voxel/Rig';
import type { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { makeVoxelMaterial, sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { ruinWallAdobe, rubblePile } from '../../models/props/hideout';
import { hangingSign, vigaLog, mudBrick } from '../../models/props/menuRuin';
import * as MS from '../../models/props/menuSet';
import { modelEntry } from '../../models/lookup';
import { noise } from '../../../engine/math/rand';

type Pivot = [number, number, number] | 'bottom' | 'center';
function vm(model: VoxelModel, vs: number, pivot: Pivot = 'bottom') {
  const m = new THREE.Mesh(buildVoxelGeometry(model, { voxelSize: vs, pivot }), sharedVoxelMaterial);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export interface RuinOpts {
  /** ground height, scene metres */
  gy: (x: number, z: number) => number;
  /** where it stands and which way its open front faces (+Z turned by yaw) */
  x: number;
  z: number;
  yaw: number;
}

export class MenuRuin {
  readonly group = new THREE.Group();
  private sign: { pivot: THREE.Group; a: number; va: number; b: number; vb: number } | null = null;
  private lamp: { light: THREE.PointLight; base: number } | null = null;
  corpse: RigInstance | null = null;
  /** where the corpse sits (world), for the hero's glances */
  readonly corpseAt = new THREE.Vector3();

  constructor(private o: RuinOpts) {
    const g = this.group;
    g.position.set(o.x, 0, o.z);
    g.rotation.y = o.yaw;
    g.updateMatrixWorld(true);
    // walls (1/16 m, 4 m long, 2.6 m high, front face +Z): back, two broken sides, a fallen front
    this.put(ruinWallAdobe(3), 0, -1.8, 0, 1, 1, 0.12);
    this.put(ruinWallAdobe(8), -2.05, 0.15, -Math.PI / 2, 0.85, 0.92, 0.12);
    this.put(ruinWallAdobe(13), 2.05, -0.5, Math.PI / 2, 0.62, 0.55, 0.12);
    this.put(ruinWallAdobe(21), -0.7, 2.05, 0.05, 0.42, 0.36, 0.14);
    // the fallen front and the roof, heaped
    this.put(rubblePile(1), 0.9, 2.1, 0.4, 1.1, 1, 0.06);
    this.put(rubblePile(2), 2.5, 0.9, 1.3, 0.9, 0.9, 0.06);
    this.put(rubblePile(4), -2.7, -1.3, 2.2, 0.75, 0.8, 0.06);
    this.put(rubblePile(6), -0.4, -0.9, 3.0, 0.7, 0.6, 0.06);
    // vigas: two still bedded in the back wall, one fallen in, one snapped stub out over the door
    for (const [lx, ly, len, s, snap] of [[-1.2, 2.3, 2.6, 1, true], [1.05, 2.25, 1.7, 2, true]] as [number, number, number, number, boolean][]) {
      const v = vigaLog(len, s, snap);
      const m = vm(v.model, v.voxelSize, v.pivot);
      m.position.set(lx, this.gyL(lx, -1.8) + ly, -2.0);
      m.rotation.set(0, -Math.PI / 2, -0.04 * s);
      g.add(m);
    }
    {
      const v = vigaLog(3.4, 5, true);
      const m = vm(v.model, v.voxelSize, v.pivot);
      // from the top of the back wall down into the room, its snapped end in the rubble
      const top = new THREE.Vector3(0.2, this.gyL(0.2, -1.6) + 2.25, -1.55);
      const foot = new THREE.Vector3(1.4, this.gyL(1.4, 1.3) + 0.12, 1.3);
      m.position.copy(top);
      const d = foot.clone().sub(top);
      m.rotation.set(0, Math.atan2(-d.z, d.x), Math.atan2(d.y, Math.hypot(d.x, d.z)), 'YZX');
      m.scale.x = d.length() / 3.4;
      g.add(m);
    }
    // the sign beam out of the left wall's corner, and the sign on its chains
    const beamY = this.gyL(-2.05, 1.6) + 2.12;
    {
      const v = vigaLog(1.45, 9, false);
      const m = vm(v.model, v.voxelSize, v.pivot);
      m.position.set(-1.9, beamY, 1.55);
      m.rotation.set(0, Math.PI, 0.05);
      g.add(m);
    }
    try {
      const hs = hangingSign('CANTINA', 4);
      const pivot = new THREE.Group();
      pivot.position.set(-3.08, beamY - 0.02, 1.55);
      const chainLen = 0.3;
      for (const hx of hs.hooks) {
        const ch = MS.chain(3);
        const cm = vm(ch.model, ch.voxelSize, ch.pivot);
        cm.position.set(hx, 0, 0);
        cm.scale.y = chainLen / ch.length;
        pivot.add(cm);
      }
      const sm = vm(hs.model, hs.voxelSize, hs.pivot);
      sm.position.y = -chainLen;
      pivot.add(sm);
      g.add(pivot);
      this.sign = { pivot, a: 0.1, va: 0, b: 0, vb: 0 };
    } catch (e) {
      console.warn('[menu ruin] sign', e);
    }
    // a lantern left burning on the rubble inside
    try {
      const lt = MS.hurricaneLantern();
      const lm = vm(lt.model, lt.voxelSize, lt.pivot);
      const lx = 0.35, lz = 0.9;
      lm.position.set(lx, this.gyL(lx, lz) + 0.5, lz);
      lm.rotation.z = 0.12;
      g.add(lm);
      const light = new THREE.PointLight(0xffa04a, 1.6, 6, 2);
      light.position.set(lx, this.gyL(lx, lz) + 0.62, lz);
      g.add(light);
      this.lamp = { light, base: 1.6 };
    } catch {
      /* no lantern */
    }
    // loose mud bricks spilled toward the camp
    for (let i = 0; i < 12; i++) {
      const b = mudBrick(i);
      const m = vm(b.model, b.voxelSize);
      const a = i * 2.39996, r = 1.2 + (i % 5) * 0.45;
      const lx = -0.6 + Math.cos(a) * r * 1.4, lz = 2.6 + Math.sin(a) * r * 0.55;
      m.position.set(lx, this.gyL(lx, lz) - 0.02, lz);
      m.rotation.set((i % 3) * 0.18 - 0.15, a * 3.1, (i % 4) * 0.2 - 0.3);
      g.add(m);
    }
    this.buildCorpse();
  }

  /** ground height under a point in the ruin's own frame */
  private gyL(lx: number, lz: number) {
    const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(this.group.matrixWorld);
    return this.o.gy(v.x, v.z);
  }
  private put(sm: { model: VoxelModel; voxelSize: number }, lx: number, lz: number, yaw: number, sx = 1, sy = 1, sink = 0.1) {
    const m = vm(sm.model, sm.voxelSize);
    m.position.set(lx, this.gyL(lx, lz) - sink, lz);
    m.rotation.y = yaw;
    m.scale.set(sx, sy, 1);
    this.group.add(m);
    return m;
  }

  /** the husk slumped against the outer wall under the sign: sat down, one knee up, head on its chest */
  private buildCorpse() {
    const e = modelEntry('husk') ?? modelEntry('husk_v1');
    if (!e) return;
    let spec: RigSpec;
    try {
      spec = e() as RigSpec;
    } catch {
      return;
    }
    if (!spec?.parts) return;
    const r = new RigInstance(buildRigGeo(spec, spec.name + ':menu'), { material: makeVoxelMaterial() });
    const n = r.nodes;
    const set = (k: string, x: number, y = 0, z = 0) => n[k]?.rotation.set(x, y, z);
    set('pelvis', -0.12, 0, 0.05);
    set('torso', -0.16, 0.12, 0.2);
    set('head', 0.62, -0.25, 0.45);
    set('jaw', 0.32);
    set('thigh_l', -1.5, 0.05, 0.28);
    set('shin_l', 0.32);
    set('thigh_r', -1.95, -0.1, -0.12);
    set('shin_r', 1.75);
    set('arm_l', -0.12, 0, 0.42);
    set('fore_l', -0.35);
    set('arm_r', -0.62, 0, -0.22);
    set('fore_r', -0.9, 0.3, 0);
    try {
      r.setExpression('dead');
    } catch {
      /* no such face */
    }
    // its back to the wall's outer face, turned a little toward the camp
    const g = this.group;
    g.add(r.root);
    r.root.position.set(-2.62, 0, 1.0);
    r.root.rotation.y = -Math.PI / 2 + 0.55;
    r.root.updateMatrixWorld(true);
    // sat on the sand: the lowest of the pelvis and thighs rests on the ground
    const box = new THREE.Box3();
    for (const k of ['pelvis', 'thigh_l', 'thigh_r']) if (r.meshes[k]) box.union(new THREE.Box3().setFromObject(r.meshes[k]));
    const gW = new THREE.Vector3(-2.62, 0, 1.0).applyMatrix4(g.matrixWorld);
    const ground = this.o.gy(gW.x, gW.z);
    r.root.position.y = isFinite(box.min.y) ? ground - (box.min.y - g.position.y) + 0.02 : ground - 0.5;
    r.root.updateMatrixWorld(true);
    r.root.getWorldPosition(this.corpseAt);
    this.corpseAt.y += 0.7;
    this.corpse = r;
  }

  update(dt: number, t: number, gust: number) {
    // the sign: a calm, heavily damped pendulum nudged by the gusts (no flapping)
    const s = this.sign;
    if (s) {
      const push = (noise.n2(t * 0.35, 4.2) * 0.5 + 0.2) * 0.22 * gust;
      s.va += (-6.5 * s.a - 1.9 * s.va + push) * dt;
      s.a += s.va * dt;
      s.vb += (-9 * s.b - 2.6 * s.vb + noise.n2(t * 0.5, 9.1) * 0.08 * gust) * dt;
      s.b += s.vb * dt;
      s.pivot.rotation.set(s.a, 0, s.b);
    }
    if (this.lamp) this.lamp.light.intensity = this.lamp.base * (0.88 + 0.12 * Math.sin(t * 13.1) * Math.sin(t * 7.3 + 1) + noise.n2(t * 4, 2) * 0.08);
  }

  dispose() {
    this.group.removeFromParent();
  }
}
