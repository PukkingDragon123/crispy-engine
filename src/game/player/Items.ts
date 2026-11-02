// Two consumable slots. Physical items found in chests, drops and shops.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Player } from './Player';
import { P } from '../../engine/voxel/palette';
import type { Modifier } from '../combat/Stats';

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
  bandage: { id: 'bandage', name: 'Trail Bandage', desc: 'Wrap up. Heals 35% max health.', icon: 'bandage', rarity: 'common', price: 25, stack: 3, model: 'bandage' },
  goldBandage: { id: 'goldBandage', name: "Embalmer's Linen", desc: 'Heals 70% max health and cleanses bleeding & poison.', icon: 'bandage_x2', rarity: 'rare', price: 70, stack: 2, model: 'bandage' },
  dagger: { id: 'dagger', name: 'Sacrificial Dagger', desc: 'Lose 15% health. +40% damage for 12 s.', icon: 'dagger', rarity: 'uncommon', price: 40, stack: 2, model: 'dagger' },
  smoke: { id: 'smoke', name: 'Smoke Bomb', desc: 'Vanish in smoke: enemies lose you, +60% dodge for 4 s.', icon: 'smoke', rarity: 'uncommon', price: 35, stack: 2, model: 'smokeBomb' },
  shield: { id: 'shield', name: 'Tin Star Shield', desc: 'Gain a shield worth 40% max health for 10 s.', icon: 'shield', rarity: 'uncommon', price: 45, stack: 2, model: 'shieldCharm' },
  charm: { id: 'charm', name: "Serket's Charm", desc: 'Cleanse every status, 4 s invulnerable, heal 10%.', icon: 'charm', rarity: 'rare', price: 80, stack: 1, model: 'divineCharm' },
  dynamite: { id: 'dynamite', name: 'Dynamite Bundle', desc: 'Throw a huge blast (6 m). Handle with care.', icon: 'bolt', rarity: 'uncommon', price: 40, stack: 2, model: 'tntCrate' },
  snakeoil: { id: 'snakeoil', name: 'Doc Hapi\'s Snake Oil', desc: '+30% speed and +25% fire rate for 10 s. Side effects: hiccups.', icon: 'bubble', rarity: 'common', price: 30, stack: 2, model: 'bottle' },
  whiskey: { id: 'whiskey', name: 'Cactus Whiskey', desc: '+25% crit chance and regeneration for 10 s. The desert sways.', icon: 'bullet', rarity: 'common', price: 30, stack: 2, model: 'bottle' },
};

export interface Slot {
  id: ItemId;
  count: number;
}

export class Inventory {
  slots: (Slot | null)[] = [null, null];
  private buffs: { source: string; until: number }[] = [];
  drunk = 0;
  hiccup = 0;

  constructor(private ctx: Ctx, private player: Player) {}

  add(id: ItemId, n = 1): boolean {
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
    switch (s.id) {
      case 'bandage':
        pl.heal(pl.maxHp * 0.35);
        pl.playAction('wrap', 0.7);
        ctx.sfx('bandage', c, 0.9);
        ctx.particles.emit({ pos: c, count: 10, spread: 1.5, up: 1.5, life: [0.5, 1], size: [0.1, 0.06], sprite: 'linen', color: 0xffffff, drag: 2 });
        break;
      case 'goldBandage':
        pl.heal(pl.maxHp * 0.7);
        pl.status.clear('bleed');
        pl.status.clear('poison');
        ctx.sfx('heal', c, 0.9);
        break;
      case 'dagger':
        pl.applyDamage(pl.hp * 0.15, 'dagger', false);
        this.buff('item:dagger', [{ stat: 'gunDmg', type: 'pct', value: 0.4 }, { stat: 'meleeDmg', type: 'pct', value: 0.4 }, { stat: 'magicDmg', type: 'pct', value: 0.4 }], 12);
        ctx.sfx('dagger_stab', c, 0.9);
        ctx.engine.flash(0xb3201a, 0.35, 0.4);
        ctx.toast('BLOOD PACT', '#e0402c', '+40% damage');
        pl.express('angry', 1.5);
        break;
      case 'smoke':
        ctx.sfx('smoke_bomb', c, 1);
        ctx.particles.emit({ pos: c, count: 26, spread: 4, up: 1.5, life: [2.5, 4], size: [1.5, 3.5], sprite: ['cloud0', 'cloud1', 'cloud2'], color: [0x8a8478, 0x6e685e, 0xa49c8e], alpha: 0.95, drag: 1.4, rot: 6, rotSpeed: 0.4, jitter: 2 });
        this.buff('item:smoke', [{ stat: 'dodge', type: 'flat', value: 0.6 }], 4);
        ctx.events.emit('smoke', c, 4);
        break;
      case 'shield':
        pl.shield = Math.max(pl.shield, pl.maxHp * 0.4);
        ctx.sfx('shield_up', c, 0.9);
        ctx.fx.ring(c, 0x9fd2ff, 4);
        ctx.engine.tweens.after(10, () => (pl.shield = 0));
        break;
      case 'charm':
        pl.status.clear();
        pl.invuln = Math.max(pl.invuln, 4);
        pl.heal(pl.maxHp * 0.1);
        ctx.sfx('charm', c, 0.9);
        ctx.fx.ring(c, P.serket, 5);
        ctx.toast("SERKET'S GRACE", '#c8ff5a');
        break;
      case 'dynamite': {
        const aim = pl.aimPoint.clone();
        const d = Math.min(22, aim.distanceTo(c));
        const dir = aim.sub(c).normalize();
        const target = c.clone().addScaledVector(dir, d);
        target.y = ctx.world.groundAt(target.x, target.z);
        ctx.sfx('dynamite_fuse', c, 0.8);
        ctx.particles.emit({ pos: c, count: 1, vel: { x: dir.x * d, y: 9, z: dir.z * d }, gravity: 18, life: [1, 1], size: [0.4, 0.4], sprite: 'bullet', color: 0xff5040 });
        ctx.engine.tweens.after(1.05, () => {
          ctx.fx.explosion(target, 6);
          ctx.sfx('explosion_big', target, 1);
          ctx.shake(0.6);
          ctx.events.emit('explosion', target, 6, 120, 'player');
        });
        break;
      }
      case 'snakeoil':
        this.buff('item:snakeoil', [{ stat: 'moveSpeed', type: 'pct', value: 0.3 }, { stat: 'fireRate', type: 'pct', value: 0.25 }], 10);
        ctx.sfx('heal', c, 0.6, 1.4);
        this.hiccup = 10;
        break;
      case 'whiskey':
        this.buff('item:whiskey', [{ stat: 'critChance', type: 'flat', value: 0.25 }, { stat: 'regen', type: 'flat', value: 4 }], 10);
        this.drunk = 10;
        pl.playAction('drink', 0.8);
        ctx.sfx('glass_break', c, 0.4, 1.3);
        pl.express('laugh', 1.2);
        break;
    }
    ctx.events.emit('itemUsed', s.id);
    s.count--;
    if (s.count <= 0) this.slots[i] = null;
  }

  update(dt: number, input: { hit(a: any): boolean }) {
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
}
