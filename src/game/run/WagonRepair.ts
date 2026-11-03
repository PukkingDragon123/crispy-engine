// Wagon-repair quest: Cactus Pete's covered wagon threw a wheel on the dunes.
// The broken wagon (`wagon_2`: rear wheel lying off, a crate propping the bed)
// sits in the sand with Pete beside it. Three parts are scattered nearby — a
// spare wheel, a bucket of axle grease and a coil of rope — and the desert
// has moved in on each of them (a bell snake in the wheel, thorny devils in
// the grease, a wolf pack on the rope; husks on early waves). Grab all three
// [T], ride back, and hammer the linchpin home on the timing bar: the wagon
// stands fixed (`wagon_1`), Pete dances a jig and pays out a strongbox.
//
// INTEGRATION (RunScene — this module does not touch it):
//   import { WagonRepair } from '../run/WagonRepair';
//   field:     wagon: WagonRepair | null = null;
//   enter() (or after a wave):
//                const at = WagonRepair.findSpot(this.ctx, this.player.pos);           // 50-90 m away, flat, inside the storm
//                if (at) this.wagon = new WagonRepair({ ctx: this.ctx, player: this.player, enemies: this.enemies,
//                  inter: this.inter, qte: this.qte, cloth: this.cloth, addBounty: (v) => this.addBounty(v),
//                  chest: (x, z, t) => this.spawnChest(x, z, t) }, at);
//   update():  after this.inter.update(e.input):   this.wagon?.update(dt);
//              if (this.wagon?.finished) { this.wagon.dispose(); this.wagon = null; }
//   updateHud(): ...(this.missions.active ? this.missions.hud() : this.wagon?.hud() ?? this.missions.hud())
//   exit():    this.wagon?.dispose();
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Player } from '../player/Player';
import type { Enemies } from '../enemies/Enemies';
import type { Interactions, Interactable, ChestTier } from './Interact';
import type { Qte } from '../ui/Qte';
import type { Collider } from '../world/Colliders';
import type { ClothRenderer } from '../../engine/physics/Cloth';
import { modelEntry } from '../models/lookup';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { dampAngle, rnd } from '../../engine/math/rand';
import { HumanNpc, npcLook } from './TravelerEscort';

export interface WagonDeps {
  ctx: Ctx;
  player: Player;
  enemies: Enemies;
  inter: Interactions;
  addBounty(v: number): void;
  /** timing bar for the final hammer blow (otherwise the repair just succeeds) */
  qte?: Qte;
  chest?(x: number, z: number, tier: ChestTier): unknown;
  /** RunScene.cloth: gives Pete a fluttering bandana */
  cloth?: ClothRenderer;
}

interface Part {
  key: string;
  name: string;
  mesh: THREE.Mesh | null;
  pos: THREE.Vector3;
  inter: Interactable;
  found: boolean;
  guarded: boolean;
  guards: string;
  glint: number;
}

function staticMesh(key: string): THREE.Mesh | null {
  try {
    const sm = modelEntry(key)?.() as { model: VoxelModel; voxelSize: number } | undefined;
    if (!sm?.model) return null;
    const m = new THREE.Mesh(buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: 'bottom' }), sharedVoxelMaterial);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  } catch (e) {
    console.warn('[wagon] model failed', key, e);
    return null;
  }
}

export class WagonRepair {
  /** a flat open spot inside the storm, 50-90 m from `near` */
  static findSpot(ctx: Ctx, near: THREE.Vector3, minR = 50, maxR = 90): THREE.Vector3 | null {
    const w = ctx.world;
    for (let k = 0; k < 40; k++) {
      const p = w.storm.randomPointNear(near.x, near.z, minR, maxR, 20);
      if (!p) continue;
      const g = w.groundAt(p.x, p.z);
      let flat = true;
      for (let i = 0; i < 8 && flat; i++) {
        const a = (i / 8) * Math.PI * 2;
        if (Math.abs(w.groundAt(p.x + Math.cos(a) * 3, p.z + Math.sin(a) * 3) - g) > 0.45) flat = false;
      }
      let blocked = false;
      w.colliders.query(p.x, p.z, 6, (c) => {
        if (c.solid && Math.hypot(c.x - p.x, c.z - p.z) < c.r + 4) blocked = true;
      });
      if (flat && !blocked) return new THREE.Vector3(p.x, g, p.z);
    }
    return null;
  }

  name = 'Cactus Pete';
  pete: HumanNpc;
  parts: Part[] = [];
  revealed = false;
  fixed = false;
  /** dispose() it */
  finished = false;
  private wagon = new THREE.Group();
  private broken: THREE.Mesh | null;
  private whole: THREE.Mesh | null;
  private col: Collider | null = null;
  private inter: Interactable;
  private yaw: number;
  private busy = false;
  private t = 0;
  private callCd = 0;
  private endT = 0;

  constructor(private d: WagonDeps, private at: THREE.Vector3) {
    const ctx = d.ctx;
    at.y = ctx.world.groundAt(at.x, at.z);
    this.yaw = rnd.next() * Math.PI * 2;
    // the wagon: broken now, the fixed model waits hidden for the repair
    this.broken = staticMesh('wagon_2');
    this.whole = staticMesh('wagon_1');
    if (this.broken) this.wagon.add(this.broken);
    if (this.whole) {
      this.whole.visible = false;
      this.wagon.add(this.whole);
    }
    this.wagon.position.set(at.x, at.y - 0.04, at.z);
    this.wagon.rotation.y = this.yaw;
    ctx.scene.add(this.wagon);
    // the bed blocks the board (wheels, tongue and the loose wheel are low enough to ride over)
    this.col = ctx.world.colliders.box(at.x, at.z, 1.05, 2.0, this.yaw, at.y, at.y + 2.6, { tag: 'questWagon' });
    ctx.events.emit('groundMark', at.x, at.z, 2.6, 0);
    // Pete sits in the shade of the bonnet
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const pp = at.clone().addScaledVector(side, -2.1).add(new THREE.Vector3(Math.sin(this.yaw) * -0.6, 0, Math.cos(this.yaw) * -0.6));
    pp.y = ctx.world.groundAt(pp.x, pp.z);
    this.pete = new HumanNpc(ctx, npcLook(d.player, ['cowboy_sombrero_vest', 'cowboy_bandit_vest', 'cowboy_stetson_vest']), pp, this.yaw - Math.PI * 0.5, d.cloth);
    this.pete.mode = 'sit';
    this.inter = { pos: this.pete.pos, radius: 5.5, label: `Talk to ${this.name}`, enabled: true, promptY: 1.4, use: () => void this.use() };
    d.inter.add(this.inter);
    // three parts out in the dunes, each with company
    const wave = Math.max(1, ctx.run.wave);
    const defs: [string, string, string][] = [
      ['wagon_wheel_1', 'Spare Wheel', wave >= 13 ? 'bellSnake' : wave >= 7 ? 'thornyLizard' : 'husk'],
      ['bucket_2', 'Bucket of Axle Grease', wave >= 7 ? 'thornyLizard' : 'husk'],
      ['rope_coil', 'Coil of Rope', wave >= 6 ? 'sandWolf' : 'husk'],
    ];
    const a0 = rnd.next() * Math.PI * 2;
    defs.forEach(([key, name, guards], i) => {
      let p: THREE.Vector3 | null = null;
      for (let k = 0; k < 14 && !p; k++) {
        const a = a0 + (i / 3) * Math.PI * 2 + (rnd.next() - 0.5) * 0.9;
        const r = 20 + rnd.next() * 22;
        const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
        if (ctx.world.storm.sdf(x, z) > 7) p = new THREE.Vector3(x, ctx.world.groundAt(x, z), z);
      }
      if (!p) p = new THREE.Vector3(at.x + (rnd.next() - 0.5) * 24, 0, at.z + (rnd.next() - 0.5) * 24);
      p.y = ctx.world.groundAt(p.x, p.z);
      const mesh = staticMesh(key);
      if (mesh) {
        mesh.position.set(p.x, p.y - 0.03, p.z);
        mesh.rotation.y = rnd.next() * Math.PI * 2;
        ctx.scene.add(mesh);
      }
      const part: Part = { key, name, mesh, pos: p, found: false, guarded: false, guards, glint: rnd.next() * 2, inter: null as unknown as Interactable };
      part.inter = { pos: p, radius: 3, label: `Pick up the ${name.toLowerCase()}`, enabled: true, promptY: 1.2, use: () => this.pick(part) };
      d.inter.add(part.inter);
      this.parts.push(part);
    });
  }

  private get found() {
    return this.parts.filter((p) => p.found).length;
  }

  reveal() {
    if (this.revealed) return;
    this.revealed = true;
    this.d.ctx.toast('BROKEN WAGON', '#ffd36b', `${this.name} needs a spare wheel, axle grease and rope`);
  }

  // ------------------------------------------------------------- verbs
  private async use() {
    if (this.busy) return;
    const ctx = this.d.ctx;
    this.reveal();
    this.pete.talk = 1.4;
    if (this.fixed) {
      ctx.toast(this.name.toUpperCase(), '#ffd36b', '"She rolls like a dream, friend."');
      return;
    }
    if (this.found < 3) {
      ctx.sfx('merchant_greet', this.pete.pos, 0.5, 0.9);
      const missing = this.parts.filter((p) => !p.found).map((p) => p.name.toLowerCase());
      ctx.toast(this.found ? `${this.found}/3 PARTS` : 'BROKEN WAGON', '#ffd36b', `Still need: ${missing.join(', ')}`);
      return;
    }
    // everything is here: hammer the linchpin home
    this.busy = true;
    try {
      ctx.sfx('mining_hit', this.wagon.position, 0.9, 1.1);
      let q: 'perfect' | 'good' | 'fail' = 'good';
      if (this.d.qte) {
        q = await this.d.qte.run({ kind: 'bar', key: 'KeyT', label: 'HAMMER THE LINCHPIN', speed: 1.25, width: 0.17 });
        if (q === 'fail') {
          ctx.sfx('qte_fail', null, 0.6);
          ctx.sfx('rev_dry', this.wagon.position, 0.8);
          ctx.toast('BENT THE PIN', '#ff8a6a', 'Try again [T]');
          return;
        }
      }
      this.repair(q === 'perfect');
    } finally {
      this.busy = false;
    }
  }

  private pick(p: Part) {
    if (p.found) return;
    const ctx = this.d.ctx;
    this.reveal();
    p.found = true;
    p.inter.enabled = false;
    this.d.inter.remove(p.inter);
    const c = { x: p.pos.x, y: p.pos.y + 0.5, z: p.pos.z };
    ctx.fx.dust(c, 0.7, 0xe6cf9f, 3);
    ctx.sfx(p.key.startsWith('wagon') ? 'crate_break' : 'rope_reel', c, 0.7, 1.2);
    ctx.sfx('pickup_gold', c, 0.5, 0.8);
    // the part tumbles up into the hunter's arms
    const mesh = p.mesh;
    if (mesh) {
      const from = mesh.position.clone();
      const pl = this.d.player;
      void ctx.engine.tweens.tween(0.45, (k) => {
        mesh.position.lerpVectors(from, pl.pos, k);
        mesh.position.y += Math.sin(k * Math.PI) * 2 + k * 1.2;
        mesh.rotation.x = k * 6;
        mesh.scale.setScalar(1 - k * 0.9);
      }).then(() => mesh.removeFromParent());
    }
    const n = this.found;
    ctx.toast(`${p.name.toUpperCase()} (${n}/3)`, '#9dff3a', n < 3 ? 'Keep looking' : `Take everything back to ${this.name}`);
  }

  private repair(perfect: boolean) {
    const ctx = this.d.ctx;
    const pos = this.wagon.position;
    this.fixed = true;
    this.inter.label = `Talk to ${this.name}`;
    // three blows, the bed lifts off its prop crate, the new wheel goes on
    for (let i = 0; i < 3; i++)
      ctx.engine.tweens.after(i * 0.22, () => {
        ctx.sfx('mining_hit', pos, 0.9, 1 + i * 0.08);
        ctx.particles.emit({ pos: { x: pos.x, y: pos.y + 0.7, z: pos.z }, count: 6, spread: 2.5, up: 2, life: [0.2, 0.4], size: [0.04, 0.01], sprite: 'spark', additive: true, color: [0xffe080, 0xfff6c0], stretch: 0.02, gravity: 8 });
      });
    ctx.engine.tweens.after(0.7, () => {
      if (this.broken) this.broken.visible = false;
      if (this.whole) this.whole.visible = true;
      ctx.fx.sandBurst({ x: pos.x, y: pos.y + 0.2, z: pos.z }, 1.2);
      ctx.fx.dust({ x: pos.x, y: pos.y + 0.8, z: pos.z }, 1.6, 0xe6cf9f, 6);
      ctx.sfx('door_creak', pos, 0.8, 0.9);
      ctx.shake(0.15);
      void ctx.engine.tweens.tween(0.5, (k) => {
        this.wagon.position.y = pos.y + Math.sin(k * Math.PI) * 0.18;
        this.wagon.rotation.z = Math.sin(k * Math.PI * 3) * 0.03 * (1 - k);
      });
      this.pete.mode = 'cheer';
      this.pete.talk = 2;
      const wave = Math.max(1, ctx.run.wave);
      const bounty = 50 + wave * 4, gold = 30 + wave * 3;
      this.d.addBounty(bounty);
      ctx.run.gold += gold;
      ctx.run.totalGold += gold;
      ctx.toast('WAGON FIXED', '#9dff3a', `${this.name} is back on the trail · +${bounty} bounty · +${gold} gold`, true);
      ctx.sfx('sting_positive', null, 0.9);
      const back = new THREE.Vector3(-Math.sin(this.yaw) * 3.6, 0, -Math.cos(this.yaw) * 3.6);
      ctx.engine.tweens.after(1.2, () => this.d.chest?.(pos.x + back.x, pos.z + back.z, perfect ? 'gold' : 'silver'));
      if (perfect) ctx.engine.tweens.after(1.2, () => ctx.toast('PERFECT FIT', '#ffd36b', 'Pete throws in his gold strongbox'));
      ctx.engine.tweens.after(4, () => this.fixed && (this.pete.mode = 'wave'));
    });
  }

  // ------------------------------------------------------------- update
  update(dt: number) {
    if (this.finished) return;
    const ctx = this.d.ctx;
    const pl = this.d.player;
    this.t += dt;
    this.callCd -= dt;
    const pd = Math.hypot(pl.pos.x - this.at.x, pl.pos.z - this.at.z);
    if (!this.revealed && pd < 40) this.reveal();
    // Pete: sits fanning himself, gets up and hails the hunter, jigs when it's fixed
    const ped = Math.hypot(pl.pos.x - this.pete.pos.x, pl.pos.z - this.pete.pos.z);
    if (!this.fixed) {
      this.pete.mode = ped < 16 ? (this.found === 3 ? 'wave' : 'idle') : ped < 34 ? 'wave' : 'sit';
      if (ped < 34 && this.callCd <= 0) {
        this.callCd = 11;
        this.pete.talk = 1.2;
        ctx.sfx('merchant_greet', this.pete.pos, 0.45, 0.9);
      }
    }
    this.pete.look = pl.pos;
    if (this.pete.mode !== 'sit') this.pete.yaw = dampAngle(this.pete.yaw, Math.atan2(pl.pos.x - this.pete.pos.x, pl.pos.z - this.pete.pos.z), 2.5, dt);
    this.inter.label = this.fixed ? `Talk to ${this.name}` : this.found === 3 ? 'Fix the wagon' : `Talk to ${this.name}`;
    this.pete.update(dt);
    // parts glint in the sun; riding close stirs up whatever made a home in them
    for (const p of this.parts) {
      if (p.found) continue;
      p.glint -= dt;
      const dd = Math.hypot(pl.pos.x - p.pos.x, pl.pos.z - p.pos.z);
      if (p.glint <= 0 && this.revealed) {
        p.glint = 1.2 + rnd.next() * 1.2;
        ctx.fx.sparkle({ x: p.pos.x, y: p.pos.y + 0.6, z: p.pos.z }, 0xfff2c0, 3, 0.5);
      }
      if (!p.guarded && dd < 28) this.wake(p);
    }
    if (this.fixed) {
      this.endT += dt;
      if (this.endT > 40 && pd > 60) this.finished = true;
    }
  }

  /** the critters living in a part come out to fight for it */
  private wake(p: Part) {
    const ctx = this.d.ctx;
    p.guarded = true;
    const kind = p.guards;
    const n = kind === 'bellSnake' ? 1 : kind === 'sandWolf' ? 3 : kind === 'thornyLizard' ? 3 : 4;
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      const a = rnd.next() * Math.PI * 2, r = kind === 'bellSnake' ? 2.5 : 3 + rnd.next() * 4;
      const x = p.pos.x + Math.cos(a) * r, z = p.pos.z + Math.sin(a) * r;
      if (ctx.world.storm.sdf(x, z) < 3) continue;
      if (this.d.enemies.spawn(kind, x, z, { emerge: kind === 'husk' || kind === 'bellSnake' ? 'sand' : 'run' })) spawned++;
    }
    if (!spawned) return;
    const lines: Record<string, string> = {
      bellSnake: 'A bell snake has coiled up in the spare wheel!',
      thornyLizard: 'Thorny devils have been licking the grease',
      sandWolf: 'A wolf pack is chewing on the rope',
      husk: 'Husks crawl out of the sand around it',
    };
    ctx.toast(p.name.toUpperCase(), '#ff8a4a', lines[kind] ?? 'Something lives in there');
  }

  // ------------------------------------------------------------- hud
  hud(): { objective: { text: string; sub: string } | null; marker: THREE.Vector3 | null } | null {
    if (!this.revealed || this.fixed) return null;
    const pl = this.d.player;
    const left = this.parts.filter((p) => !p.found);
    let marker: THREE.Vector3;
    if (!left.length) marker = this.at.clone().setY(this.at.y + 3.2);
    else {
      let best = left[0], bd = Infinity;
      for (const p of left) {
        const dd = p.pos.distanceToSquared(pl.pos);
        if (dd < bd) {
          bd = dd;
          best = p;
        }
      }
      marker = best.pos.clone().setY(best.pos.y + 1.6);
    }
    return {
      objective: { text: `Fix ${this.name}'s Wagon`, sub: left.length ? `Find the wagon parts — ${this.found}/3 (${left.map((p) => p.name.toLowerCase()).join(', ')})` : 'Bring the parts back and fix the wagon [T]' },
      marker,
    };
  }

  dispose() {
    const ctx = this.d.ctx;
    for (const p of this.parts) {
      this.d.inter.remove(p.inter);
      p.mesh?.removeFromParent();
    }
    this.d.inter.remove(this.inter);
    if (this.col) ctx.world.colliders.remove(this.col);
    this.wagon.removeFromParent();
    this.pete.dispose();
    this.finished = true;
  }
}
