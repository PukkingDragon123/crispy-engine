// Things you ride up to: chests (lid swings on its hinge, loot fountain), the
// dumb scarab (rolls its dung ball around, dies hilariously when shot) and its
// dung ball (kick it with melee or ram it with the board — it bowls enemies
// over). One proximity prompt at a time: [T] + label above the target.
import * as THREE from 'three';
import type { Ctx, RayHit } from '../Ctx';
import type { Player } from '../player/Player';
import type { Enemies, ExternalTarget } from '../enemies/Enemies';
import type { Hit } from '../combat/Damage';
import * as PM from '../models/props';
import { modelEntry } from '../models/lookup';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { sharedVoxelMaterial, makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { RigEyes, emote } from '../fx/FaceFx';
import { Ease } from '../../engine/Tween';
import { clamp, damp, dampAngle, rnd } from '../../engine/math/rand';
import { ITEMS, ItemId } from '../player/Items';

export interface Interactable {
  pos: THREE.Vector3;
  radius: number;
  label: string;
  enabled: boolean;
  /** world height of the prompt above pos */
  promptY?: number;
  use(): void;
}

export class Interactions {
  list: Interactable[] = [];
  current: Interactable | null = null;
  constructor(private player: Player) {}
  add(i: Interactable) {
    this.list.push(i);
    return i;
  }
  remove(i: Interactable) {
    this.list = this.list.filter((x) => x !== i);
  }
  update(input: { hit(a: any): boolean }) {
    const p = this.player.pos;
    let best: Interactable | null = null, bd = Infinity;
    for (const i of this.list) {
      if (!i.enabled) continue;
      const d = Math.hypot(i.pos.x - p.x, i.pos.z - p.z);
      if (d < i.radius && d < bd && Math.abs(i.pos.y - p.y) < 6) {
        bd = d;
        best = i;
      }
    }
    this.current = best;
    if (best && this.player.alive && input.hit('interact')) best.use();
  }
  prompt() {
    const c = this.current;
    if (!c) return null;
    return { world: { x: c.pos.x, y: c.pos.y + (c.promptY ?? 1.6), z: c.pos.z }, key: 'T', text: c.label };
  }
}

// ======================================================================= chests
export type ChestTier = 'wood' | 'silver' | 'gold' | 'divine';
const CHEST_INFO: Record<ChestTier, { name: string; gold: [number, number]; item: number; card: number }> = {
  wood: { name: 'Supply Chest', gold: [8, 18], item: 0.45, card: 0.1 },
  silver: { name: 'Silver Strongbox', gold: [20, 40], item: 0.7, card: 0.35 },
  gold: { name: 'Gold Strongbox', gold: [45, 80], item: 0.9, card: 0.7 },
  divine: { name: "Serket's Reliquary", gold: [80, 140], item: 1, card: 1 },
};

export class Chest {
  root = new THREE.Group();
  lid = new THREE.Group();
  opened = false;
  inter: Interactable;
  constructor(private ctx: Ctx, x: number, z: number, rot: number, public tier: ChestTier, private onLoot: (c: Chest) => void) {
    const g = ctx.world.groundAt(x, z);
    this.root.position.set(x, g - 0.02, z);
    this.root.rotation.y = rot;
    let built = false;
    try {
      const c = (PM as any).chest?.(tier) as { base: any; lid: any; voxelSize: number; hinge?: [number, number, number] } | undefined;
      if (c?.base) {
        const vs = c.voxelSize;
        const b = c.base.bounds();
        const bp: [number, number, number] = [(b.minX + b.maxX + 1) / 2, b.minY, (b.minZ + b.maxZ + 1) / 2];
        const base = new THREE.Mesh(buildVoxelGeometry(c.base, { voxelSize: vs, pivot: bp }), sharedVoxelMaterial);
        const lb = c.lid.bounds();
        const hinge = c.hinge ?? [(lb.minX + lb.maxX + 1) / 2, lb.minY, lb.minZ];
        const lid = new THREE.Mesh(buildVoxelGeometry(c.lid, { voxelSize: vs, pivot: hinge }), sharedVoxelMaterial);
        this.lid.position.set((hinge[0] - bp[0]) * vs, (hinge[1] - bp[1]) * vs, (hinge[2] - bp[2]) * vs);
        this.lid.add(lid);
        for (const m of [base, lid]) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
        this.root.add(base, this.lid);
        built = true;
      }
    } catch (e) {
      console.warn('[chest] model failed', e);
    }
    if (!built) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 0.7), new THREE.MeshStandardMaterial({ color: 0x8a5a30 }));
      base.position.y = 0.3;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1, 0.25, 0.7), new THREE.MeshStandardMaterial({ color: 0xa06a38 }));
      lid.position.set(0, 0.125, 0.35);
      this.lid.position.set(0, 0.6, -0.35);
      this.lid.add(lid);
      this.root.add(base, this.lid);
    }
    ctx.scene.add(this.root);
    this.inter = { pos: this.root.position.clone(), radius: 3.2, label: `Open ${CHEST_INFO[tier].name}`, enabled: true, promptY: 1.4, use: () => this.open() };
  }

  async open() {
    if (this.opened) return;
    this.opened = true;
    this.inter.enabled = false;
    const ctx = this.ctx;
    const p = this.root.position;
    ctx.sfx('chest_unlock', p, 0.9);
    // rattle, then the lid flies open
    await ctx.engine.tweens.tween(0.35, (k) => (this.root.rotation.z = Math.sin(k * 40) * 0.04 * (1 - k)), Ease.linear);
    ctx.sfx('chest_open', p, 1);
    ctx.sfx(this.tier === 'divine' ? 'divine_chime' : 'loot_reveal', p, 0.8);
    void ctx.engine.tweens.tween(0.55, (k) => (this.lid.rotation.x = -2.0 * k), Ease.outBack);
    ctx.fx.dust({ x: p.x, y: p.y + 0.6, z: p.z }, 0.8, 0xe6cf9f, 4);
    ctx.particles.emit({ pos: { x: p.x, y: p.y + 0.7, z: p.z }, count: 18, spread: 0.6, up: 6, life: [0.6, 1.1], size: [0.08, 0.04], sprite: ['spark', 'dot3'], color: [0xffe08a, 0xfff2c0], gravity: 10 });
    this.onLoot(this);
  }

  loot(): { gold: number; item: ItemId | null; card: boolean } {
    const info = CHEST_INFO[this.tier];
    const gold = Math.round(info.gold[0] + rnd.next() * (info.gold[1] - info.gold[0]));
    const pool: ItemId[] = this.tier === 'wood' ? ['bandage', 'snakeoil', 'whiskey', 'dynamite', 'smoke'] : (Object.keys(ITEMS) as ItemId[]);
    const item = rnd.chance(info.item) ? rnd.pick(pool) : null;
    return { gold, item, card: rnd.chance(info.card) };
  }
}

// ======================================================================= dung ball
export class DungBall {
  mesh: THREE.Object3D;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  r = 0.45;
  alive = true;
  private hitCd = new Map<number, number>();
  constructor(private ctx: Ctx, x: number, z: number, scale = 1) {
    let m: THREE.Object3D | null = null;
    const e = modelEntry('dung_ball');
    try {
      const sm = e?.() as any;
      if (sm?.model) {
        const geo = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: 'center' });
        geo.computeBoundingSphere();
        this.r = geo.boundingSphere!.radius * 0.85 * scale;
        m = new THREE.Mesh(geo, sharedVoxelMaterial);
        m.scale.setScalar(scale);
      }
    } catch {
      /* fall through */
    }
    if (!m) m = new THREE.Mesh(new THREE.IcosahedronGeometry(this.r, 0), new THREE.MeshStandardMaterial({ color: 0x6a4826, flatShading: true }));
    m.castShadow = true;
    this.mesh = new THREE.Group();
    this.mesh.add(m);
    this.pos.set(x, ctx.world.groundAt(x, z) + this.r, z);
    ctx.scene.add(this.mesh);
  }
  kick(dir: THREE.Vector3, power: number) {
    this.vel.x += dir.x * power;
    this.vel.z += dir.z * power;
    this.vel.y += power * 0.35;
    this.ctx.sfx('dung_kick', this.pos, 1);
    this.ctx.fx.word(this.pos, 'w_pow', 0.9);
    this.ctx.particles.emit({ pos: this.pos, count: 10, spread: 0.6, up: 2, life: [0.4, 0.8], size: [0.07, 0.04], sprite: 'dot3', color: [0x6a4826, 0x8a6236], gravity: 12 });
  }
  update(dt: number, enemies: Enemies) {
    const w = this.ctx.world;
    // slope gravity
    const e = 0.5;
    const gx = (w.groundAt(this.pos.x + e, this.pos.z) - w.groundAt(this.pos.x - e, this.pos.z)) / (2 * e);
    const gz = (w.groundAt(this.pos.x, this.pos.z + e) - w.groundAt(this.pos.x, this.pos.z - e)) / (2 * e);
    const g = w.groundAt(this.pos.x, this.pos.z) + this.r;
    const onGround = this.pos.y <= g + 0.05;
    this.vel.y -= 22 * dt;
    if (onGround) {
      this.vel.x -= gx * 14 * dt;
      this.vel.z -= gz * 14 * dt;
      this.vel.x = damp(this.vel.x, 0, 0.9, dt);
      this.vel.z = damp(this.vel.z, 0, 0.9, dt);
    }
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y < g) {
      this.pos.y = g;
      if (this.vel.y < -3) this.ctx.fx.dust({ x: this.pos.x, y: g - this.r, z: this.pos.z }, 0.4, 0xe6cf9f, 2);
      this.vel.y = Math.max(0, -this.vel.y * 0.35);
    }
    // bounce off solid props
    w.colliders.query(this.pos.x, this.pos.z, this.r + 1, (c) => {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz) || 1;
      if (c.kind === 'circle' && d < c.r + this.r) {
        const nx = dx / d, nz = dz / d;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) {
          this.vel.x -= 1.6 * vn * nx;
          this.vel.z -= 1.6 * vn * nz;
        }
        this.pos.x = c.x + nx * (c.r + this.r);
        this.pos.z = c.z + nz * (c.r + this.r);
      }
    });
    // roll visual
    const v = Math.hypot(this.vel.x, this.vel.z);
    if (v > 0.05) this.mesh.rotateOnWorldAxis(new THREE.Vector3(this.vel.z, 0, -this.vel.x).normalize(), (v * dt) / this.r);
    this.mesh.position.copy(this.pos);
    // bowling
    if (v > 4) {
      enemies.inRadius(this.pos, this.r + 0.8, (en) => {
        const cd = this.hitCd.get(en.id) ?? 0;
        if (performance.now() < cd) return;
        this.hitCd.set(en.id, performance.now() + 500);
        enemies.damage(en, { base: 8 + v * 2.5, kind: 'phys', source: 'board', knock: v * 0.6, dirX: this.vel.x / v, dirZ: this.vel.z / v, canCrit: true });
        this.ctx.sfx('scarab_squish', this.pos, 0.7);
        this.ctx.fx.word(this.pos, 'w_splat');
        this.vel.multiplyScalar(0.8);
      });
    }
  }
  dispose() {
    this.alive = false;
    this.mesh.removeFromParent();
  }
}

// ======================================================================= dumb scarab
let SCARAB_ID = 800000;
const _v = new THREE.Vector3();

/** "the dumbest beetle in Egypt": pushes its ball around, bonks into things, dies when shot */
export class DumbScarab implements ExternalTarget {
  id = SCARAB_ID++;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  radius = 0.4;
  height = 0.5;
  alive = true;
  isBoss = false;
  hp = 1;
  maxHp = 1;
  name = 'Dumb Scarab';
  rig: RigInstance | null = null;
  root = new THREE.Group();
  eyes: RigEyes | null = null;
  ball: DungBall;
  private heading = rnd.next() * Math.PI * 2;
  private t = 0;
  private bonk = 0;
  private deadT = 0;
  constructor(private ctx: Ctx, private enemies: Enemies, private home: THREE.Vector3) {
    this.pos.set(home.x, ctx.world.groundAt(home.x, home.z), home.z);
    const spec = modelEntry('dumb_scarab')?.() as RigSpec | undefined;
    if (spec?.parts) {
      this.rig = new RigInstance(buildRigGeo(spec, 'dumb_scarab'), { material: makeVoxelMaterial() });
      this.root.add(this.rig.root);
      this.eyes = new RigEyes(this.rig, 'organic', 0x101010);
      this.height = spec.meta?.height ?? 0.5;
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.8), new THREE.MeshStandardMaterial({ color: 0x2a3a6a }));
      m.position.y = 0.2;
      this.root.add(m);
    }
    ctx.scene.add(this.root);
    this.ball = new DungBall(ctx, home.x + 1, home.z + 1, 1.3);
    enemies.registerExternal(this);
  }

  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (!this.alive) return null;
    const c = _v.set(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z);
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const disc = b * b - (ox * ox + oy * oy + oz * oz - 0.55 * 0.55);
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > maxT) return null;
    const point = o.clone().addScaledVector(d, t);
    return { enemy: this, t, point, normal: point.clone().sub(c).normalize(), headshot: false, part: 'body', surface: 'enemy' };
  }

  takeDamage(_hit: Hit, point?: THREE.Vector3) {
    if (!this.alive) return 0;
    this.alive = false;
    const ctx = this.ctx;
    const p = point ?? this.pos;
    ctx.sfx('squeak', this.pos, 1);
    ctx.sfx('scarab_squish', this.pos, 0.6, 1.4);
    ctx.fx.word(this.pos, 'w_splat', 1, true);
    emote(ctx.particles, { x: this.pos.x, y: this.pos.y + 0.9, z: this.pos.z }, 'q');
    ctx.particles.emit({ pos: p, count: 12, spread: 0.5, up: 3, life: [0.4, 0.8], size: [0.06, 0.03], sprite: 'dot3', color: [0x2a3a6a, 0x9dff3a], gravity: 12 });
    this.rig?.setExpression('dead');
    ctx.toast('YOU MONSTER', '#9dff3a', 'The dung remains. Kick it.');
    this.enemies.unregisterExternal(this);
    return 1;
  }

  update(dt: number, player: Player) {
    this.t += dt;
    const ctx = this.ctx;
    if (!this.alive) {
      // belly up, legs twitching, then sink into the sand
      this.deadT += dt;
      this.root.rotation.z = damp(this.root.rotation.z, Math.PI, 10, dt);
      if (this.rig) for (const k of ['leg_l1', 'leg_l2', 'leg_l3', 'leg_r1', 'leg_r2', 'leg_r3']) {
        const n = this.rig.nodes[k];
        if (n) n.rotation.x = Math.sin(this.t * 30 + k.length) * 0.4 * Math.max(0, 1 - this.deadT / 3);
      }
      if (this.deadT > 6) this.root.position.y -= dt * 0.2;
      this.root.position.set(this.pos.x, this.root.position.y || this.pos.y + 0.3, this.pos.z);
      if (this.deadT < 6) this.root.position.y = this.pos.y + 0.3;
    } else {
      // push the ball: walk to the far side of it and shove it along the heading
      const b = this.ball;
      const behind = _v.set(b.pos.x - Math.sin(this.heading) * (b.r + 0.4), 0, b.pos.z - Math.cos(this.heading) * (b.r + 0.4));
      const dx = behind.x - this.pos.x, dz = behind.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const want = d > 0.3 ? Math.atan2(dx, dz) : this.heading;
      this.root.rotation.y = dampAngle(this.root.rotation.y, want, 6, dt);
      const sp = this.bonk > 0 ? -0.6 : 1.4;
      this.pos.x += Math.sin(this.root.rotation.y) * sp * dt;
      this.pos.z += Math.cos(this.root.rotation.y) * sp * dt;
      if (d < 0.5 && b.alive) {
        b.vel.x += Math.sin(this.heading) * 1.8 * dt;
        b.vel.z += Math.cos(this.heading) * 1.8 * dt;
      }
      // wander, bonk into things, return home if too far
      if (rnd.chance(dt * 0.25)) this.heading += (rnd.next() - 0.5) * 2;
      if (Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z) > 18) this.heading = Math.atan2(this.home.x - this.pos.x, this.home.z - this.pos.z);
      this.bonk = Math.max(0, this.bonk - dt);
      if (rnd.chance(dt * 0.08) && this.bonk <= 0) {
        this.bonk = 0.6;
        ctx.sfx('squeak', this.pos, 0.4, 1.3);
        emote(ctx.particles, { x: this.pos.x, y: this.pos.y + 0.8, z: this.pos.z }, rnd.chance(0.5) ? 'q' : 'star', 0.7);
      }
      this.pos.y = ctx.world.groundAt(this.pos.x, this.pos.z);
      this.root.position.copy(this.pos);
      if (this.rig) {
        const n = this.rig.nodes;
        for (let i = 1; i <= 3; i++) {
          const l = n['leg_l' + i], r = n['leg_r' + i];
          if (l) l.rotation.x = Math.sin(this.t * 14 + i * 2) * 0.5;
          if (r) r.rotation.x = Math.sin(this.t * 14 + i * 2 + Math.PI) * 0.5;
        }
        if (n['head']) n['head'].rotation.z = Math.sin(this.t * 3) * 0.12;
        this.rig.setExpression(this.bonk > 0 ? 'surprised' : 'happy');
      }
    }
    // googly eyes: pupils wobble around
    if (this.eyes && ctx.faces) {
      this.root.updateMatrixWorld(true);
      this.eyes.gaze.set(Math.sin(this.t * 7.3) * 0.9, Math.cos(this.t * 5.1) * 0.9);
      this.eyes.draw(ctx.faces, dt);
    }
    // the ball: kicked with melee, rammed with the board
    const b = this.ball;
    if (b.alive) {
      b.update(dt, this.enemies);
      const pd = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z);
      const sp = Math.hypot(player.board.vel.x, player.board.vel.z);
      if (pd < b.r + 0.7 && sp > 3) {
        const dir = new THREE.Vector3(player.board.vel.x, 0, player.board.vel.z).normalize();
        if (Math.hypot(b.vel.x, b.vel.z) < sp * 0.9) b.kick(dir, sp * 1.1);
      }
    }
    void clamp;
  }

  /** melee near the ball = a proper kick */
  onMelee(player: Player) {
    const b = this.ball;
    if (!b.alive) return;
    const d = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z);
    if (d > 2.8) return;
    const fwd = new THREE.Vector3(Math.sin(player.cam.yaw), 0, Math.cos(player.cam.yaw));
    b.kick(fwd, 16);
    this.ctx.shake(0.12);
  }

  dispose() {
    this.root.removeFromParent();
    this.ball.dispose();
    this.enemies.unregisterExternal(this);
  }
}
