// Two consumable slots. Physical items found in chests, drops and shops.
// A new hunt starts with EMPTY pockets: everything is found, bought or earned.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Player } from './Player';
import { P } from '../../engine/voxel/palette';
import type { Modifier } from '../combat/Stats';
import { voxelMesh } from '../../engine/voxel/Rig';
import { startItemUse, UseEvent } from '../anim/itemUseAnim';
import { consumable } from '../models/characters/consumables';

export type ItemId = 'bandage' | 'goldBandage' | 'dagger' | 'smoke' | 'shield' | 'charm' | 'dynamite' | 'snakeoil' | 'whiskey';

export interface ItemDef {
  id: ItemId;
  name: string;
  desc: string;
  icon: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  price: number;
  stack: number;
  model: string; // props registry key for 3D item
}

export const ITEMS: Record<ItemId, ItemDef> = {
  bandage: { id: 'bandage', name: 'Trail Bandage', desc: 'Wrap up. Heals 35% max health.', icon: 'bandage', rarity: 'common', price: 25, stack: 3, model: 'item_bandage' },
  goldBandage: { id: 'goldBandage', name: "Embalmer's Linen", desc: 'Heals 70% max health and cleanses bleeding & poison.', icon: 'bandage_x2', rarity: 'rare', price: 70, stack: 2, model: 'item_linen' },
  dagger: { id: 'dagger', name: 'Sacrificial Dagger', desc: 'Lose 15% health. +40% damage for 12 s.', icon: 'dagger', rarity: 'uncommon', price: 40, stack: 2, model: 'item_dagger' },
  smoke: { id: 'smoke', name: 'Smoke Bomb', desc: 'Vanish in smoke: enemies lose you, +60% dodge for 4 s.', icon: 'smoke', rarity: 'uncommon', price: 35, stack: 2, model: 'item_smoke' },
  shield: { id: 'shield', name: 'Tin Star Shield', desc: 'Gain a shield worth 40% max health for 10 s.', icon: 'shield', rarity: 'uncommon', price: 45, stack: 2, model: 'item_star' },
  charm: { id: 'charm', name: "Serket's Charm", desc: 'Cleanse every status, 4 s invulnerable, heal 10%.', icon: 'charm', rarity: 'rare', price: 80, stack: 1, model: 'item_charm' },
  dynamite: { id: 'dynamite', name: 'Dynamite Bundle', desc: 'Throw a huge blast (6 m). Handle with care.', icon: 'bolt', rarity: 'uncommon', price: 40, stack: 2, model: 'item_dynamite' },
  snakeoil: { id: 'snakeoil', name: 'Doc Hapi\'s Snake Oil', desc: '+30% speed and +25% fire rate for 10 s. Side effects: hiccups.', icon: 'bubble', rarity: 'common', price: 30, stack: 2, model: 'item_snakeoil' },
  whiskey: { id: 'whiskey', name: 'Cactus Whiskey', desc: '+25% crit chance and regeneration for 10 s. The desert sways.', icon: 'bullet', rarity: 'common', price: 30, stack: 2, model: 'item_whiskey' },
};

export interface Slot {
  id: ItemId;
  count: number;
}

export class Inventory {
  /** new hunts start with empty pockets (no starter kit) */
  static START_EMPTY = true;
  slots: (Slot | null)[] = [null, null];
  /**
   * True until the run's first update: a hunt's opening loadout is empty, so any
   * starter kit handed over while the scene is still being built is turned away.
   * (A run carried over from another sub-area restores `slots` directly.)
   */
  private opening = Inventory.START_EMPTY;
  private buffs: { source: string; until: number }[] = [];
  drunk = 0;
  hiccup = 0;
  /** props in flight / pinned (thrown dynamite, tossed bottles, the pinned tin star, a lit fuse) */
  private flying: Flyer[] = [];
  private fuse: { prop: THREE.Object3D; until: number } | null = null;
  private star: { obj: THREE.Object3D; until: number } | null = null;

  constructor(private ctx: Ctx, private player: Player) {}

  add(id: ItemId, n = 1): boolean {
    if (this.opening) return false;
    const def = ITEMS[id];
    for (const s of this.slots) if (s && s.id === id && s.count < def.stack) {
      s.count = Math.min(def.stack, s.count + n);
      return true;
    }
    const empty = this.slots.findIndex((s) => !s);
    if (empty >= 0) {
      this.slots[empty] = { id, count: Math.min(n, def.stack) };
      return true;
    }
    return false;
  }

  /** replace slot i with a new item (used when both full) */
  replace(i: number, id: ItemId) {
    this.slots[i] = { id, count: 1 };
  }

  private buff(source: string, mods: Omit<Modifier, 'source'>[], dur: number) {
    this.player.stats.removeSource(source);
    this.player.stats.add(mods.map((m) => ({ ...m, source })));
    this.buffs = this.buffs.filter((b) => b.source !== source);
    this.buffs.push({ source, until: this.ctx.run.time + dur });
  }

  use(i: number) {
    const s = this.slots[i];
    if (!s || !this.player.alive) return;
    const ctx = this.ctx;
    const pl = this.player;
    const c = pl.center(new THREE.Vector3());
    const id = s.id;
    // the full use animation (item in his hand); its events drive the visuals below
    const got = new Set<UseEvent>();
    const dur = startItemUse(pl.rig, id, (e, at, dir, prop) => {
      got.add(e);
      this.onUse(id, e, at, dir, prop);
    }, pl.material);
    if (dur) pl.playAction('item', dur);
    // watchdog: if the animation layer never ran, still deliver the events gameplay depends on
    const critical: Partial<Record<ItemId, UseEvent>> = { dynamite: 'release', smoke: 'smash', shield: 'pin', dagger: 'cut', charm: 'peak' };
    const must = critical[id];
    if (must) ctx.engine.tweens.after(dur + 0.4, () => {
      if (got.has(must) || !pl.alive) return;
      const at = pl.center(new THREE.Vector3()).add(new THREE.Vector3(0, 0.5, 0));
      this.onUse(id, must, at, pl.aimPoint.clone().sub(at).normalize(), null);
    });
    switch (id) {
      case 'bandage':
        pl.heal(pl.maxHp * 0.35);
        ctx.sfx('bandage', c, 0.9);
        break;
      case 'goldBandage':
        pl.heal(pl.maxHp * 0.7);
        pl.status.clear('bleed');
        pl.status.clear('poison');
        ctx.sfx('bandage', c, 0.8, 0.85);
        break;
      case 'dagger':
        this.buff('item:dagger', [{ stat: 'gunDmg', type: 'pct', value: 0.4 }, { stat: 'meleeDmg', type: 'pct', value: 0.4 }, { stat: 'magicDmg', type: 'pct', value: 0.4 }], 12);
        ctx.sfx('melee_whoosh', c, 0.6, 1.2);
        pl.express('angry', 1.5);
        break;
      case 'smoke':
        this.buff('item:smoke', [{ stat: 'dodge', type: 'flat', value: 0.6 }], 4);
        ctx.sfx('whoosh', c, 0.4, 1.2);
        break;
      case 'shield':
        pl.shield = Math.max(pl.shield, pl.maxHp * 0.4);
        ctx.engine.tweens.after(10, () => (pl.shield = 0));
        break;
      case 'charm':
        pl.status.clear();
        pl.invuln = Math.max(pl.invuln, 4);
        pl.heal(pl.maxHp * 0.1);
        ctx.sfx('divine_whisper', c, 0.6);
        break;
      case 'dynamite':
        ctx.sfx('whoosh', c, 0.3, 1.4);
        break;
      case 'snakeoil':
        this.buff('item:snakeoil', [{ stat: 'moveSpeed', type: 'pct', value: 0.3 }, { stat: 'fireRate', type: 'pct', value: 0.25 }], 10);
        this.hiccup = 10;
        break;
      case 'whiskey':
        this.buff('item:whiskey', [{ stat: 'critChance', type: 'flat', value: 0.25 }, { stat: 'regen', type: 'flat', value: 4 }], 10);
        this.drunk = 10;
        pl.express('laugh', 1.6);
        break;
    }
    if (!dur) this.onUse(id, 'done', c, new THREE.Vector3(0, 1, 0), null);
    ctx.events.emit('itemUsed', s.id);
    s.count--;
    if (s.count <= 0) this.slots[i] = null;
  }

  /** visuals timed to the use animation (see anim/itemUseAnim.ts) */
  private onUse(id: ItemId, e: UseEvent, at: THREE.Vector3, dir: THREE.Vector3, prop: THREE.Object3D | null) {
    const ctx = this.ctx, pl = this.player;
    const c = pl.center(new THREE.Vector3());
    switch (e) {
      case 'grab':
        ctx.sfx('paper_flutter', at, 0.35, 1.3);
        break;
      case 'pop':
        ctx.sfx('squeak', at, 0.5, 1.6);
        ctx.particles.emit({ pos: at, count: 1, vel: { x: dir.x + 1, y: 4, z: dir.z }, gravity: 14, life: [0.6, 0.6], size: [0.06, 0.06], sprite: 'woodchip', color: 0xb98a52 });
        break;
      case 'lit':
        ctx.sfx('dynamite_fuse', at, 0.8);
        if (prop) this.fuse = { prop, until: ctx.run.time + 0.6 };
        ctx.particles.emit({ pos: at, count: 10, spread: 0.25, up: 1.5, life: [0.2, 0.45], size: [0.05, 0.02], sprite: 'spark', color: [0x9dff3a, 0xffb040, 0xffffff], drag: 2 });
        break;
      case 'release': {
        this.fuse = null;
        ctx.sfx('whoosh_big', at, 0.6, 1.2);
        const aim = pl.aimPoint.clone();
        const d = Math.min(22, aim.distanceTo(c));
        const fdir = aim.sub(c).setY(0).normalize();
        const target = c.clone().addScaledVector(fdir, d);
        target.y = ctx.world.groundAt(target.x, target.z);
        const T = 0.72;
        const v = target.clone().sub(at).divideScalar(T);
        v.y += 0.5 * 18 * T;
        this.launch('item_dynamite', at, v, 18, T, (p) => {
          ctx.fx.explosion(target, 6);
          ctx.sfx('explosion_big', target, 1);
          ctx.shake(0.6);
          ctx.events.emit('explosion', target, 6, 120, 'player');
          void p;
        }, true);
        break;
      }
      case 'toss': {
        const key = id === 'whiskey' ? 'item_whiskey' : 'item_snakeoil';
        const glass = id === 'whiskey' ? [0xa8621e, 0xf0b060, 0x6a3410] : [0x86a44a, 0xd2ea9a, 0x4a6a14];
        ctx.sfx('whoosh', at, 0.3, 1.5);
        this.launch(key, at, dir.clone().multiplyScalar(5).add(new THREE.Vector3(0, 2, 0)), 16, 3, (p) => {
          ctx.sfx('glass_break', p, 0.55, 1.15);
          ctx.particles.emit({ pos: p, count: 16, spread: 0.5, up: 2.5, life: [0.4, 0.9], size: [0.08, 0.03], sprite: 'crystal', color: glass, gravity: 12, drag: 1 });
        });
        break;
      }
      case 'smash':
        ctx.sfx('smoke_bomb', at, 1);
        ctx.sfx('glass_break', at, 0.35, 0.7);
        ctx.particles.emit({ pos: at, count: 26, spread: 4, up: 1.5, life: [2.5, 4], size: [1.5, 3.5], sprite: ['cloud0', 'cloud1', 'cloud2'], color: [0x8a8478, 0x6e685e, 0xa49c8e], alpha: 0.95, drag: 1.4, rot: 6, rotSpeed: 0.4, jitter: 2 });
        ctx.particles.emit({ pos: at, count: 8, spread: 0.6, up: 2, life: [0.4, 0.8], size: [0.08, 0.04], sprite: 'pebble', color: [0x6e6878, 0x9a94a8], gravity: 12 });
        ctx.events.emit('smoke', at, 4);
        break;
      case 'pin': {
        ctx.sfx('counter_clang', at, 0.5, 1.4);
        ctx.sfx('shield_up', c, 0.9);
        ctx.fx.ring(c, 0x9fd2ff, 4);
        const torso = pl.rig.nodes['torso'];
        if (torso) {
          this.star?.obj.removeFromParent();
          const m = this.propMesh('item_star', 0.75);
          m.position.set(0.105, 0.255, 0.335);
          torso.add(m);
          this.star = { obj: m, until: ctx.run.time + 10 };
        }
        break;
      }
      case 'cut':
        pl.applyDamage(pl.hp * 0.15, 'dagger', false);
        ctx.sfx('dagger_stab', at, 0.9);
        ctx.engine.flash(0xb3201a, 0.35, 0.4);
        ctx.toast('BLOOD PACT', '#e0402c', '+40% damage');
        ctx.particles.emit({ pos: at, count: 14, spread: 0.3, up: 1.2, life: [0.4, 0.8], size: [0.07, 0.03], sprite: 'splat', color: [0xb3201a, 0x7a1010], gravity: 10 });
        break;
      case 'peak':
        ctx.sfx('charm', c, 0.9);
        ctx.fx.ring(c, P.serket, 5);
        ctx.toast("SERKET'S GRACE", '#c8ff5a');
        ctx.particles.emit({ pos: at, count: 18, spread: 0.4, up: 2, life: [0.5, 1], size: [0.1, 0.03], sprite: 'star4', color: [0x9dff3a, 0xeaffc8], drag: 1.5 });
        break;
      case 'wrapped':
        ctx.sfx('bandage', at, 0.7, 1.15);
        ctx.particles.emit({ pos: at, count: 8, spread: 0.6, up: 1.2, life: [0.4, 0.8], size: [0.08, 0.05], sprite: 'linen', color: id === 'goldBandage' ? 0xf2d27a : 0xffffff, drag: 2 });
        if (id === 'goldBandage') ctx.fx.ring(c, 0xf2c443, 3);
        break;
      case 'done':
        break;
    }
  }

  /** a consumable's HD model as a mesh, centred */
  private propMesh(key: string, scale = 1) {
    const cm = consumable(key);
    const mesh = cm ? voxelMesh(cm.model, cm.voxelSize, 'center', this.player.material) : new THREE.Mesh();
    mesh.scale.setScalar(scale);
    return mesh;
  }

  /** throw a prop on a ballistic arc; onLand fires when it lands (or after maxT seconds) */
  private launch(key: string, at: THREE.Vector3, vel: THREE.Vector3, g: number, maxT: number, onLand: (p: THREE.Vector3) => void, fuse = false) {
    const mesh = this.propMesh(key);
    mesh.position.copy(at);
    this.ctx.scene.add(mesh);
    const spin = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    this.flying.push({ mesh, vel: vel.clone(), g, t: 0, maxT, spin, rate: 9 + Math.random() * 5, onLand, fuse });
  }

  update(dt: number, input: { hit(a: any): boolean }) {
    this.opening = false;
    this.updateProps(dt);
    if (input.hit('item1')) this.use(0);
    if (input.hit('item2')) this.use(1);
    const now = this.ctx.run.time;
    for (let i = this.buffs.length - 1; i >= 0; i--) {
      if (now >= this.buffs[i].until) {
        this.player.stats.removeSource(this.buffs[i].source);
        this.buffs.splice(i, 1);
      }
    }
    if (this.drunk > 0) this.drunk -= dt;
    if (this.hiccup > 0) {
      this.hiccup -= dt;
      if (Math.random() < dt * 0.6) {
        this.ctx.particles.emit({ pos: this.player.center(new THREE.Vector3()).add(new THREE.Vector3(0, 0.8, 0)), count: 3, spread: 0.6, up: 1, life: [0.6, 1], size: [0.1, 0.04], sprite: 'bubble', color: 0xffffff, gravity: -1 });
        this.player.board.impulse.y += 2.5;
      }
    }
  }

  private updateProps(dt: number) {
    const ctx = this.ctx;
    const now = ctx.run.time;
    if (this.fuse) {
      if (now > this.fuse.until) this.fuse = null;
      else if (Math.random() < 0.7) {
        const p = this.fuse.prop.localToWorld(new THREE.Vector3(0.025, 0.1, 0));
        ctx.particles.emit({ pos: p, count: 1, spread: 0.05, up: 1.2, life: [0.15, 0.35], size: [0.04, 0.015], sprite: 'spark', color: [0xffd04a, 0xff7a20, 0x9dff3a], drag: 2 });
      }
    }
    if (this.star && now > this.star.until) {
      this.star.obj.removeFromParent();
      this.star = null;
    }
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt;
      f.vel.y -= f.g * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.rotateOnAxis(f.spin, f.rate * dt);
      if (f.fuse && Math.random() < 0.8) ctx.particles.emit({ pos: f.mesh.localToWorld(new THREE.Vector3(0.025, 0.1, 0)), count: 1, spread: 0.05, up: 0.5, life: [0.12, 0.3], size: [0.04, 0.015], sprite: 'spark', color: [0xffd04a, 0xff7a20], drag: 2 });
      const gy = ctx.world.groundAt(f.mesh.position.x, f.mesh.position.z);
      if (f.t >= f.maxT || (f.vel.y < 0 && f.mesh.position.y <= gy + 0.06)) {
        f.mesh.removeFromParent();
        this.flying.splice(i, 1);
        f.onLand(f.mesh.position.clone());
      }
    }
  }
}

interface Flyer {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  g: number;
  t: number;
  maxT: number;
  spin: THREE.Vector3;
  rate: number;
  onLand: (p: THREE.Vector3) => void;
  fuse: boolean;
}
