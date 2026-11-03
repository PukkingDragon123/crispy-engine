// A live, animated model outside a run: the Codex plates and the death cinematic.
// Enemies are driven by the game's own procedural animation (anim/enemyAnim) through
// a real Enemy record, so the idle breathing, fidgets, taunts, wind-ups and strikes
// are exactly what the hunter meets in the dunes. Bosses, critters and folk get a
// procedural idle (breath, a head that watches the viewer, tails, segments, wings)
// and a lunge; loot and props turn slowly on a turntable.
import * as THREE from 'three';
import { Enemy } from '../../enemies/Enemies';
import { ENEMIES, EnemyDef, AttackDef } from '../../enemies/EnemyDefs';
import { resolveRig } from '../../enemies/EnemyRender';
import { animateEnemy, AnimEnv } from '../../anim/enemyAnim';
import { buildRigGeo, RigGeo, RigInstance, RigSpec } from '../../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { modelEntry } from '../../models/lookup';

const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _v = new THREE.Vector3();
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const sstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

let shared: VoxelMaterial | null = null;
const silMat = new THREE.MeshBasicMaterial({ color: 0x050302 });

type Mode = 'enemy' | 'rig' | 'spin';

/** geometry cache for static models (loot, props, boards) */
const staticGeo = new Map<string, THREE.BufferGeometry>();

export interface PuppetOpts {
  material?: VoxelMaterial;
  /** turn rigs on a turntable instead of animating them (guns) */
  spin?: boolean;
  castShadow?: boolean;
}

export class Puppet {
  /** place this: origin on the ground, faces +Z */
  root = new THREE.Group();
  /** the animated body (root transform of the rig / the turntable) */
  body = new THREE.Group();
  rig: RigInstance | null = null;
  mesh: THREE.Mesh | null = null;
  enemy: Enemy | null = null;
  mode: Mode = 'rig';
  height = 1;
  radius = 0.5;
  /** the viewer is alive (dead hunter → enemies taunt and dance) */
  viewerAlive = true;
  onStrike: (() => void) | null = null;
  private t = Math.random() * 10;
  private atk = -1;
  private atkDur = 1.2;
  private rest = new Map<THREE.Object3D, THREE.Euler>();
  private restPos = new Map<THREE.Object3D, THREE.Vector3>();
  private headYaw = 0;
  private headPitch = 0;
  private sil = false;
  private mats = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private env: AnimEnv = { time: 0, dt: 0, groundAt: () => 0, player: { x: 0, y: 0, z: 3 }, playerAlive: true, camDist: 4 };
  private nodes: Record<string, THREE.Object3D> = {};
  private chains: THREE.Object3D[][] = [];

  private constructor() {
    this.root.add(this.body);
  }

  static material() {
    return (shared ??= makeVoxelMaterial());
  }

  /** a bounty: a real Enemy record animated by the game's enemy animation */
  static enemy(def: EnemyDef | string, o: PuppetOpts & { alpha?: boolean; rigKey?: string } = {}) {
    const d = typeof def === 'string' ? ENEMIES[def] : def;
    const p = new Puppet();
    p.mode = 'enemy';
    const geos = new Map<string, RigGeo>();
    const batchOf = (key: string) => {
      const k = o.rigKey ?? key;
      let g = geos.get(k);
      if (!g) geos.set(k, (g = buildRigGeo(resolveRig(k), 'puppet:' + k)));
      return { geo: g, partIndex: g.index, nParts: g.parts.length, meta: g.spec.meta ?? {} };
    };
    const e = new Enemy(d, !!o.alpha, 1, { get: (k: string) => batchOf(k) } as any);
    e.state = 'move';
    e.stateT = 0;
    e.emerge = 'run';
    e.yaw = 0;
    e.anim.prevYaw = 0;
    p.enemy = e;
    p.rig = new RigInstance(e.batch.geo, { material: o.material ?? Puppet.material(), castShadow: o.castShadow ?? true });
    p.body.add(p.rig.root);
    p.height = e.height;
    p.radius = e.radius;
    p.index();
    return p;
  }

  /** any rig spec (bosses, critters, folk, the hunter himself) */
  static rig(spec: RigSpec, o: PuppetOpts & { key?: string } = {}) {
    const p = new Puppet();
    p.mode = o.spin ? 'spin' : 'rig';
    p.rig = new RigInstance(buildRigGeo(spec, o.key ?? 'puppet:' + spec.name), { material: o.material ?? Puppet.material(), castShadow: o.castShadow ?? true });
    p.body.add(p.rig.root);
    p.rig.root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(p.rig.root);
    p.height = (spec.meta?.height as number) ?? Math.max(0.1, bb.max.y - bb.min.y);
    p.radius = (spec.meta?.radius as number) ?? Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
    p.index();
    return p;
  }

  /** a static voxel model (loot, props, boards): turns on a turntable */
  static model(model: { model: any; voxelSize: number }, key: string, o: PuppetOpts = {}) {
    const p = new Puppet();
    p.mode = 'spin';
    let g = staticGeo.get(key);
    if (!g) staticGeo.set(key, (g = buildVoxelGeometry(model.model, { voxelSize: model.voxelSize, pivot: 'bottom' })));
    p.mesh = new THREE.Mesh(g, o.material ?? Puppet.material());
    p.mesh.castShadow = o.castShadow ?? true;
    p.mesh.receiveShadow = true;
    p.body.add(p.mesh);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    p.height = Math.max(0.02, bb.max.y - bb.min.y);
    p.radius = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
    return p;
  }

  /** a registry key: rig or static model, or null */
  static fromKey(key: string, o: PuppetOpts = {}): Puppet | null {
    try {
      const r = modelEntry(key)?.() as any;
      if (!r) return null;
      if (r.parts) return Puppet.rig(r as RigSpec, { ...o, key: 'puppet:' + key });
      if (r.model) return Puppet.model(r, key, o);
    } catch (e) {
      console.warn('[puppet] model failed', key, e);
    }
    return null;
  }

  private index() {
    const r = this.rig;
    if (!r) return;
    for (const p of r.geo.parts) {
      const n = r.nodes[p.name];
      this.nodes[p.name] = n;
      this.rest.set(n, p.rest.clone());
      this.restPos.set(n, p.offset.clone());
    }
    const chain = (prefix: string, from = 1) => {
      const out: THREE.Object3D[] = [];
      for (let i = from; this.nodes[prefix + i]; i++) out.push(this.nodes[prefix + i]);
      return out;
    };
    for (const c of [chain('seg'), chain('tail'), chain('tail_'), chain('neck')]) if (c.length > 1) this.chains.push(c);
  }

  /** busy with an attack */
  get busy() {
    if (this.enemy) return this.enemy.state !== 'move';
    return this.atk >= 0;
  }

  /** wind up and strike (hover in the book, the killing blow in the death cinematic) */
  attack(pref?: AttackDef['kind']) {
    if (this.busy) return;
    const e = this.enemy;
    if (e) {
      const list = e.def.attacks.filter((a) => !a.alphaOnly || e.alpha);
      const a = (pref && list.find((x) => x.kind === pref)) || list.find((x) => x.kind === 'melee') || list[0] || e.def.attacks[0];
      if (!a) return;
      e.atk = a;
      e.wind = Math.max(0.35, a.windup);
      e.state = 'windup';
      e.stateT = 0;
      return;
    }
    this.atk = 0;
    this.atkDur = this.mode === 'spin' ? 0.9 : 1.35;
  }

  setSilhouette(on: boolean) {
    if (on === this.sil) return;
    this.sil = on;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (on) {
        this.mats.set(m, m.material);
        m.material = silMat;
      } else {
        const was = this.mats.get(m);
        if (was) m.material = was;
      }
    });
  }

  /** viewer: world position the creature looks at (the camera, the hunter) */
  update(dt: number, viewer?: THREE.Vector3) {
    this.t += dt;
    if (this.enemy) this.updateEnemy(dt, viewer);
    else if (this.mode === 'spin') this.updateSpin(dt);
    else this.updateRig(dt, viewer);
  }

  private viewerLocal(viewer: THREE.Vector3 | undefined, out: THREE.Vector3) {
    if (!viewer) return out.set(0, this.height * 0.8, 3);
    this.root.updateWorldMatrix(true, false);
    return this.root.worldToLocal(out.copy(viewer));
  }

  private updateEnemy(dt: number, viewer?: THREE.Vector3) {
    const e = this.enemy!;
    const r = this.rig!;
    e.stateT += dt;
    if (e.state === 'windup' && e.stateT >= e.wind) {
      e.state = 'strike';
      e.stateT = 0;
      this.onStrike?.();
    } else if (e.state === 'strike' && e.stateT > 0.35) {
      e.state = 'recover';
      e.stateT = 0;
    } else if (e.state === 'recover' && e.stateT > 0.3) {
      e.state = 'move';
      e.stateT = 0;
    }
    e.vel.set(0, 0, 0);
    e.hp = e.maxHp;
    const env = this.env;
    env.time = this.t;
    env.dt = Math.min(dt, 0.05);
    const v = this.viewerLocal(viewer, _v);
    env.player.x = v.x;
    env.player.y = v.y - 1.2;
    env.player.z = v.z;
    env.playerAlive = this.viewerAlive;
    env.camDist = Math.min(30, Math.hypot(v.x, v.z));
    animateEnemy(e, env);
    const parts = r.geo.parts;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const n = r.nodes[p.name];
      n.rotation.set(p.rest.x + e.rot[i * 3], p.rest.y + e.rot[i * 3 + 1], p.rest.z + e.rot[i * 3 + 2]);
      n.position.set(p.offset.x + e.posOff[i * 3], p.offset.y + e.posOff[i * 3 + 1], p.offset.z + e.posOff[i * 3 + 2]);
      n.visible = !e.hidden[i];
    }
    const a = e.anim;
    _q.setFromAxisAngle(UP, e.yaw);
    if (a.tilt) _q.multiply(_qa.setFromAxisAngle(AX, a.tilt));
    if (a.roll) _q.multiply(_qa.setFromAxisAngle(AZ, a.roll));
    const sq = e.squash.x;
    const puff = 1 + ((a as any).puff ?? 0) * 0.24;
    this.body.quaternion.copy(_q);
    this.body.scale.set(e.scale * Math.sqrt(2 - sq) * puff, e.scale * sq * puff, e.scale * Math.sqrt(2 - sq) * puff);
    this.body.position.set(0, -a.sink + a.lift, 0);
    this.body.visible = !a.hidden;
  }

  private updateSpin(dt: number) {
    const t = this.t;
    let hop = 0, spin = 0.45;
    if (this.atk >= 0) {
      this.atk += dt;
      const k = this.atk / this.atkDur;
      hop = Math.sin(Math.min(1, k) * Math.PI) * 0.18 * this.height;
      spin = 0.45 + Math.sin(Math.min(1, k) * Math.PI) * 9;
      if (k >= 1) this.atk = -1;
    }
    this.body.rotation.y += dt * spin;
    this.body.position.y = hop + Math.sin(t * 1.3) * 0.015 * this.height;
  }

  /** procedural life for a non-enemy rig */
  private updateRig(dt: number, viewer?: THREE.Vector3) {
    const t = this.t;
    const N = this.nodes;
    // attack envelope: anticipation → snap → follow-through
    let antic = 0, snap = 0;
    if (this.atk >= 0) {
      this.atk += dt;
      const k = this.atk / this.atkDur;
      antic = sstep(0, 0.42, k) * (1 - sstep(0.42, 0.5, k));
      snap = sstep(0.42, 0.52, k) * (1 - sstep(0.62, 1, k));
      if (this.atk >= this.atkDur * 0.47 && this.atk - dt < this.atkDur * 0.47) this.onStrike?.();
      if (k >= 1) this.atk = -1;
    }
    for (const [n, r] of this.rest) n.rotation.copy(r);
    for (const [n, p] of this.restPos) n.position.copy(p);
    const br = Math.sin(t * 1.5);
    const add = (name: string, x: number, y = 0, z = 0) => {
      const n = N[name];
      if (n) {
        n.rotation.x += x;
        n.rotation.y += y;
        n.rotation.z += z;
      }
    };
    // breathe, lean into the strike
    const chest = N['torso'] ? 'torso' : N['chest'] ? 'chest' : N['thorax'] ? 'thorax' : null;
    if (chest) add(chest, br * 0.025 - antic * 0.28 + snap * 0.45, Math.sin(t * 0.37) * 0.04, Math.sin(t * 0.5) * 0.015);
    this.body.position.set(0, Math.max(0, br) * 0.006 * this.height, snap * this.radius * 0.5 - antic * this.radius * 0.15);
    this.body.rotation.set(-antic * 0.06 + snap * 0.1, Math.sin(t * 0.23) * 0.05, Math.sin(t * 0.31) * 0.012);
    // the head watches the viewer
    const head = N['head'];
    if (head) {
      const v = this.viewerLocal(viewer, _v);
      const hp = this.height * 0.85;
      const yaw = clamp(Math.atan2(v.x, v.z), -0.7, 0.7);
      const pitch = clamp(-Math.atan2(v.y - hp, Math.hypot(v.x, v.z)), -0.35, 0.35);
      this.headYaw = damp(this.headYaw, yaw + Math.sin(t * 0.41) * 0.12, 3, dt);
      this.headPitch = damp(this.headPitch, pitch * 0.6 + Math.sin(t * 0.53) * 0.04, 3, dt);
      add('head', this.headPitch - antic * 0.25 + snap * 0.3, this.headYaw, Math.sin(t * 0.7) * 0.03);
    }
    add('jaw', antic * 0.45 + snap * 0.3 + Math.max(0, Math.sin(t * 0.9)) * 0.03);
    // arms: hang and sway; up in the wind-up, down hard on the snap
    for (const [s, sg] of [['l', 1], ['r', -1]] as const) {
      add('arm_' + s, Math.sin(t * 0.9 + sg) * 0.05 - antic * 1.6 + snap * 0.9, 0, sg * (0.06 + antic * 0.3));
      add('fore_' + s, -0.12 - antic * 0.6 + snap * 0.2);
      add('wing_' + s, 0, 0, sg * (Math.sin(t * 1.1) * 0.08 - antic * 0.5 + snap * 0.6));
      add('pincer_' + s, 0, sg * (Math.max(0, Math.sin(t * 2.3 + sg)) * 0.25 + antic * 0.5), 0);
    }
    // tails, worm bodies, necks: a travelling wave
    for (const c of this.chains)
      c.forEach((n, i) => {
        const k = (i + 1) / c.length;
        n.rotation.y += Math.sin(t * 1.8 - i * 0.7) * 0.12 * (0.4 + k);
        n.rotation.x += Math.sin(t * 1.2 - i * 0.5) * 0.04 - antic * 0.08 + snap * 0.12;
      });
    add('tail', Math.sin(t * 1.4) * 0.1, Math.sin(t * 2.1) * 0.25);
    for (const s of ['l', 'r']) add('ear_' + s, Math.sin(t * 0.8 + (s === 'l' ? 0 : 2)) * 0.06);
  }

  dispose() {
    this.setSilhouette(false);
    this.root.removeFromParent();
  }
}
