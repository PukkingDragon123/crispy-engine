// Gear loot: drops from chests (by tier), elites / alphas (rare) and bosses
// (guaranteed rare+), a few pieces on the tortoise's rug. A drop is the real
// gear model hovering over the sand: it pops out on an arc, bobs and turns,
// glints in its rarity colour. Ride through it and the world pauses for the
// NEW GEAR reveal: the 3D card (photo of the piece, Alagard plaques) rises in
// front of the camera next to the piece you're wearing in that slot; equip it
// or keep what you have (the spurned piece is scrapped for gold).
//
// Listens to 'enemyKilled' and 'bossDefeated' on ctx.events by itself; chests
// and the shop call onChest() / shopWares().
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../Ctx';
import type { Player } from '../player/Player';
import type { Input } from '../../engine/Input';
import type { Ware } from '../ui/Shop';
import { RARITY } from './Upgrades';
import { Ease } from '../../engine/Tween';
import { rnd } from '../../engine/math/rand';
import { sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { Equipment, GEAR, GEAR_IDS, GEAR_RARITY_ORDER, GearId, GearRarity, SLOT_INFO, buildGearDisplay, gearGlassMaterial, gearHex, gearPreview } from '../player/Equipment';
import { makeGearCard, GearCard3D } from '../ui/GearCard';

type ChestTier = 'wood' | 'silver' | 'gold' | 'divine';

/** per-item weight by rarity (there are few commons, many uncommons/rares) */
const GEAR_W: Record<GearRarity, number> = { common: 30, uncommon: 30, rare: 18, epic: 7, legendary: 2.5 };
const CHEST: Record<ChestTier, { chance: number; min: GearRarity; max: GearRarity; bias: number }> = {
  wood: { chance: 0.12, min: 'common', max: 'rare', bias: 1 },
  silver: { chance: 0.32, min: 'uncommon', max: 'epic', bias: 1.2 },
  gold: { chance: 0.65, min: 'uncommon', max: 'legendary', bias: 1.6 },
  divine: { chance: 1, min: 'rare', max: 'legendary', bias: 2.2 },
};
const SCRAP = (id: GearId) => Math.round(GEAR[id].price * 0.3);

interface Drop {
  id: GearId;
  obj: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  t: number;
  settled: boolean;
  glint: number;
  halo: number;
  /** can't be picked up until the arc lands */
  arm: number;
}

interface Card {
  card: GearCard3D;
  home: THREE.Vector3;
  hover: number;
  flip: number;
  flipCur: number;
  tiltX: number;
  tiltY: number;
  ready: boolean;
  role: 'new' | 'worn';
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class GearPickups {
  /** true while the reveal owns the screen (world paused; add to RunScene's modal check) */
  active = false;
  drops: Drop[] = [];
  private group = new THREE.Group();
  private queue: GearId[] = [];
  private cards: Card[] = [];
  private hovered: Card | null = null;
  private ray = new THREE.Raycaster();
  private ui: HTMLDivElement;
  private resolving = false;
  private pending: GearId | null = null;
  private offs: (() => void)[] = [];

  constructor(private ctx: Ctx, private player: Player, public equipment: Equipment, private input: Input) {
    ctx.scene.add(this.group);
    this.ui = document.createElement('div');
    this.ui.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:7;display:none;font-family:'Alagard';color:#fff3d6;text-shadow:0 2px 0 #2a1810,0 0 12px rgba(0,0,0,0.5);letter-spacing:1px;text-align:center";
    ctx.engine.overlay.appendChild(this.ui);
    this.offs.push(ctx.events.on('enemyKilled', (e: EnemyLike) => this.onKill(e)));
    this.offs.push(ctx.events.on('bossDefeated', (b: EnemyLike, escaped: boolean) => this.onBoss(b, escaped)));
  }

  // ------------------------------------------------------------------ loot tables
  /** pick a piece by rarity band (luck tilts it toward the rare end), never one you wear or one lying around */
  roll(min: GearRarity = 'common', max: GearRarity = 'legendary', bias = 1): GearId | null {
    const lo = GEAR_RARITY_ORDER.indexOf(min), hi = GEAR_RARITY_ORDER.indexOf(max);
    const luck = this.player.stats.get('rarity') * bias;
    const pool = GEAR_IDS.filter((id) => {
      const r = GEAR_RARITY_ORDER.indexOf(GEAR[id].rarity);
      return r >= lo && r <= hi && !this.equipment.has(id) && !this.drops.some((d) => d.id === id) && !this.queue.includes(id);
    });
    if (!pool.length) return null;
    return rnd.weighted(pool, (id) => {
      const r = GEAR[id].rarity;
      return GEAR_W[r] * (GEAR_RARITY_ORDER.indexOf(r) >= 2 ? luck : 1);
    });
  }

  /** a chest just opened (call from the chest's loot callback) */
  onChest(tier: ChestTier, at: { x: number; y: number; z: number }) {
    const c = CHEST[tier];
    if (!rnd.chance(c.chance)) return null;
    const id = this.roll(c.min, c.max, c.bias);
    if (id) this.ctx.engine.tweens.after(0.35, () => this.dropAt(id, at, { pop: 7 }));
    return id;
  }

  private onKill(e: EnemyLike) {
    const en = e as any;
    const alpha = !!en.alpha, elite = (en.def?.hp ?? 0) >= 120;
    const p = alpha ? 0.3 : elite ? 0.03 : 0.003;
    if (!rnd.chance(p)) return;
    const id = alpha ? this.roll('uncommon', 'legendary', 1.4) : this.roll();
    if (id) this.dropAt(id, { x: e.pos.x, y: e.pos.y + 1, z: e.pos.z }, { pop: 6 });
  }

  private onBoss(b: EnemyLike, escaped: boolean) {
    if (escaped) return;
    const id = this.roll('rare', 'legendary', 2.5);
    if (id) this.ctx.engine.tweens.after(1.2, () => this.dropAt(id, { x: b.pos.x, y: b.pos.y + 1.5, z: b.pos.z }, { pop: 9 }));
  }

  /** trading-post wares (Shop's Ware shape): buying drops the piece at your feet */
  shopWares(n = 1): Ware[] {
    const scale = 1 + this.ctx.run.wave * 0.03;
    const out: Ware[] = [];
    for (let i = 0; i < n; i++) {
      const id = this.roll('uncommon', rnd.chance(0.25) ? 'legendary' : 'epic', 1.3);
      if (!id) break;
      this.queue.push(id); // reserve it so a second ware can't be the same piece
      const def = GEAR[id];
      out.push({
        id: 'gear_' + id,
        name: def.name,
        desc: `${SLOT_INFO[def.slot].name} gear · ${RARITY[def.rarity].name}. ${def.desc}`,
        price: Math.round(def.price * scale),
        model: 'gear_' + id,
        buy: () => {
          this.queue = this.queue.filter((q) => q !== id);
          const p = this.player.pos, a = this.player.cam.yaw;
          this.dropAt(id, { x: p.x + Math.sin(a) * 1.4, y: p.y + 1.2, z: p.z + Math.cos(a) * 1.4 }, { pop: 2, arm: 0.2 });
          return true;
        },
      });
    }
    this.ctx.engine.tweens.after(0.5, () => (this.queue = []), true);
    return out;
  }

  // ------------------------------------------------------------------ world drops
  dropAt(id: GearId, at: { x: number; y: number; z: number }, o: { pop?: number; arm?: number } = {}) {
    const obj = new THREE.Group();
    const show = buildGearDisplay(id, sharedVoxelMaterial, gearGlassMaterial(), 0.5);
    obj.add(show);
    this.group.add(obj);
    const pop = o.pop ?? 6;
    const a = rnd.next() * Math.PI * 2;
    const d: Drop = { id, obj, pos: new THREE.Vector3(at.x, at.y, at.z), vel: new THREE.Vector3(Math.sin(a) * pop * 0.35, pop, Math.cos(a) * pop * 0.35), t: rnd.next() * 6, settled: false, glint: 0.3, halo: 0, arm: o.arm ?? 0.8 };
    obj.position.copy(d.pos);
    this.drops.push(d);
    const col = gearHex(id);
    this.ctx.sfx(GEAR_RARITY_ORDER.indexOf(GEAR[id].rarity) >= 3 ? 'divine_chime' : 'loot_reveal', at, 0.7);
    this.ctx.particles.emit({ pos: at, count: 16, spread: 3, up: 3, life: [0.4, 0.9], size: [0.12, 0.03], sprite: ['star4', 'spark'], additive: true, color: [col, 0xffffff], drag: 2 });
    if (this.drops.length > 14) this.removeDrop(this.drops[0]);
    return d;
  }

  private removeDrop(d: Drop) {
    d.obj.removeFromParent();
    this.drops = this.drops.filter((x) => x !== d);
  }

  private updateDrops(dt: number) {
    const ctx = this.ctx;
    const pl = this.player;
    for (const d of [...this.drops]) {
      d.t += dt;
      d.arm -= dt;
      const g = ctx.world.groundAt(d.pos.x, d.pos.z);
      const hover = g + 0.95;
      if (!d.settled) {
        d.vel.y -= 16 * dt;
        d.pos.addScaledVector(d.vel, dt);
        if (d.vel.y < 0 && d.pos.y <= hover) {
          d.settled = true;
          ctx.fx.dust({ x: d.pos.x, y: g, z: d.pos.z }, 0.5, 0xe6cf9f, 2);
          ctx.sfx('sand_burst', d.pos, 0.35, 1.4);
        }
        d.obj.rotation.x += dt * 6;
      } else {
        d.pos.y += (hover + Math.sin(d.t * 2.2) * 0.1 - d.pos.y) * Math.min(1, dt * 6);
        d.obj.rotation.x *= 1 - Math.min(1, dt * 5);
        d.obj.rotation.z = Math.sin(d.t * 1.3) * 0.12;
      }
      d.obj.rotation.y += dt * 1.25;
      d.obj.position.copy(d.pos);
      // glints: a star catches the light on the piece, a soft halo, rising motes for the rare stuff
      const col = gearHex(d.id);
      const tier = GEAR_RARITY_ORDER.indexOf(GEAR[d.id].rarity);
      d.glint -= dt;
      if (d.glint <= 0) {
        d.glint = 0.7 + rnd.next() * 0.9;
        const r = 0.22;
        ctx.particles.emit({ pos: { x: d.pos.x + (rnd.next() - 0.5) * r * 2, y: d.pos.y + (rnd.next() - 0.3) * r * 2, z: d.pos.z + (rnd.next() - 0.5) * r * 2 }, count: 1, life: [0.35, 0.45], size: [0.42, 0.06], sprite: 'star4', additive: true, color: 0xffffff, sizeJitter: 0 });
      }
      d.halo -= dt;
      if (d.halo <= 0) {
        d.halo = 0.12;
        ctx.particles.emit({ pos: d.pos, count: 1, life: [0.3, 0.3], size: [1.1, 1.3], sprite: 'glow16', additive: true, color: col, alpha: 0.16 + tier * 0.03, sizeJitter: 0 });
        if (tier >= 2 && d.settled) ctx.particles.emit({ pos: { x: d.pos.x, y: g + 0.1, z: d.pos.z }, count: 1, vel: { x: 0, y: 1.2 + tier * 0.2, z: 0 }, jitter: 0.35, life: [0.8, 1.2], size: [0.06, 0.02], sprite: 'dot3', additive: true, color: [col, 0xffffff], gravity: -0.3 });
      }
      // pick up: ride through it
      if (d.arm <= 0 && pl.alive && !ctx.engine.paused && !this.active && Math.hypot(pl.pos.x - d.pos.x, pl.pos.z - d.pos.z) < 1.8 && Math.abs(pl.pos.y + 1 - d.pos.y) < 2.6) {
        this.removeDrop(d);
        this.open(d.id, d.pos.clone());
        break;
      }
    }
  }

  // ------------------------------------------------------------------ the reveal
  /** show the NEW GEAR reveal for a piece right now (also used by debug / quest rewards) */
  open(id: GearId, from?: THREE.Vector3) {
    if (this.active) return;
    const ctx = this.ctx;
    const eng = ctx.engine;
    const worn = this.equipment.wouldReplace(id);
    this.active = true;
    this.resolving = false;
    this.pending = id;
    eng.paused = true;
    this.input.enabled = false;
    eng.audio.setMuffle(0.5);
    this.input.setWantLock(false);
    ctx.sfx('loot_reveal', null, 0.8);
    const def = GEAR[id];
    const color = RARITY[def.rarity].color;
    this.ui.innerHTML = `<div style="position:absolute;left:0;right:0;top:7vh;font-size:44px;color:${color}">NEW GEAR</div>` +
      `<div style="position:absolute;left:0;right:0;top:calc(7vh + 52px);font-size:18px;opacity:0.9">${SLOT_INFO[def.slot].name.toUpperCase()} SLOT${worn ? ` · replaces ${GEAR[worn].name}` : ''}</div>` +
      (worn
        ? `<div style="position:absolute;left:30%;top:20vh;transform:translateX(-50%);font-size:20px;color:${color}">EQUIP</div><div style="position:absolute;left:70%;top:20vh;transform:translateX(-50%);font-size:20px;opacity:0.8">KEEP CURRENT</div>`
        : '') +
      `<div style="position:absolute;left:0;right:0;bottom:8vh;font-size:17px">${worn ? `CLICK a card · E equip new · K keep current (+${SCRAP(id)} gold)` : `CLICK or E to equip · K leave it (+${SCRAP(id)} gold)`} · RIGHT-DRAG to turn</div>`;
    this.ui.style.display = 'block';
    const cam = ctx.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const center = cam.position.clone().addScaledVector(fwd, 2.05).addScaledVector(up, -0.06);
    const r = eng.renderer;
    const mk = (gid: GearId, role: Card['role'], dx: number, delay: number, start: THREE.Vector3) => {
      const rows = role === 'new' ? gearPreview(this.player.stats, gid, worn) : [];
      const card = makeGearCard(r, gid, role === 'new' ? 'NEW GEAR' : 'WORN', rows);
      const home = center.clone().addScaledVector(right, dx);
      card.group.position.copy(start);
      card.group.quaternion.copy(cam.quaternion);
      card.group.scale.setScalar(0.2);
      this.group.add(card.group);
      const c: Card = { card, home, hover: 0, flip: 0, flipCur: Math.PI * 4, tiltX: 0, tiltY: 0, ready: false, role };
      eng.tweens.run(0.8, (k) => {
        card.group.position.lerpVectors(start, home, k);
        card.group.position.addScaledVector(up, Math.sin(Math.min(1, k) * Math.PI) * 0.35);
        card.group.scale.setScalar(0.2 + 0.8 * Math.min(1, k));
        c.flipCur = Math.PI * 4 * (1 - k);
      }, Ease.outBack, { real: true, delay, done: () => (c.ready = true) });
      eng.tweens.after(delay, () => ctx.sfx('card_erupt', home, 0.7, role === 'new' ? 1.05 : 0.9), true);
      return c;
    };
    const src = from ?? center.clone().addScaledVector(up, -1.2);
    this.cards = [mk(id, 'new', worn ? -0.5 : 0, 0.05, src)];
    if (worn) this.cards.push(mk(worn, 'worn', 0.5, 0.2, this.player.center(new THREE.Vector3())));
    if (GEAR_RARITY_ORDER.indexOf(def.rarity) >= 3) {
      ctx.sfx('divine_chime', null, 0.6);
      ctx.fx.sparkle(center, RARITY[def.rarity].hex, 16, 0.8);
    }
  }

  private resolve(equip: boolean) {
    if (!this.active || this.resolving || this.pending === null) return;
    this.resolving = true;
    const ctx = this.ctx;
    const eng = ctx.engine;
    const id = this.pending;
    const hero = this.player.center(new THREE.Vector3());
    let scrap = 0;
    if (equip) {
      const prev = this.equipment.equip(id);
      ctx.sfx('card_pick', null, 0.9);
      ctx.sfx('gem_chime', null, 0.5);
      ctx.toast(GEAR[id].name.toUpperCase(), RARITY[GEAR[id].rarity].color, prev ? `Equipped · ${GEAR[prev].name} scrapped` : 'Equipped');
      if (prev) scrap = SCRAP(prev);
    } else {
      scrap = SCRAP(id);
      ctx.sfx('ui_back', null, 0.6);
      ctx.toast('SCRAPPED', '#e0b373', `${GEAR[id].name}`);
    }
    if (scrap > 0) {
      ctx.run.gold += scrap;
      ctx.run.totalGold += scrap;
      eng.tweens.after(0.4, () => {
        ctx.fx.coins(this.player.center(new THREE.Vector3()), 8);
        ctx.sfx('pickup_gold', null, 0.7);
        ctx.toast(`+${scrap} GOLD`, '#ffd36b');
      }, true);
    }
    for (const c of this.cards) {
      const g = c.card.group;
      const from = g.position.clone();
      const keepIt = (c.role === 'new') === equip;
      if (keepIt) {
        // into the hero
        eng.tweens.run(0.45, (k) => {
          g.position.lerpVectors(from, hero, k);
          g.scale.setScalar(1 - k * 0.85);
          g.rotateY(0.35);
        }, Ease.inQuad, {
          real: true,
          done: () => {
            ctx.fx.sparkle(hero, gearHex(c.card.id), 16, 0.5);
            c.card.dispose();
          },
        });
      } else {
        // the spurned piece burns away to coin dust
        const to = from.clone().add(new THREE.Vector3(0, -1.6, 0));
        eng.tweens.run(0.55, (k) => {
          g.position.lerpVectors(from, to, k);
          g.rotateZ(0.06);
          g.scale.setScalar(1 - k * 0.4);
        }, Ease.inBack, { real: true, done: () => c.card.dispose() });
        ctx.particles.emit({ pos: from, count: 14, spread: 1.6, up: 1, life: [0.4, 0.8], size: [0.1, 0.02], sprite: ['spark', 'dot3'], additive: true, color: [0xffd36b, 0xff9a4a], drag: 2 });
      }
    }
    this.ui.style.display = 'none';
    eng.tweens.after(0.55, () => {
      this.cards = [];
      this.hovered = null;
      this.active = false;
      this.pending = null;
      eng.paused = false;
      this.input.enabled = true;
      eng.audio.setMuffle(0);
      this.input.setWantLock(true);
    }, true);
  }

  private updateReveal(rdt: number) {
    const inp = this.input;
    const cam = this.ctx.camera;
    for (const c of this.cards) c.card.update(rdt, c.hover, c.role === 'worn' ? 0.82 : 1);
    if (this.resolving) return;
    const ready = this.cards.every((c) => c.ready);
    this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), cam);
    const hits = this.ray.intersectObjects(this.cards.map((c) => c.card.hit), false);
    const h = hits.length ? this.cards.find((c) => c.card.hit === hits[0].object) ?? null : null;
    if (h !== this.hovered) {
      if (h) this.ctx.sfx('card_hover', null, 0.5);
      this.hovered = h;
    }
    if (ready) {
      if (inp.wasPressed('KeyE') || inp.wasPressed('Enter')) return this.resolve(true);
      if (inp.wasPressed('KeyK') || inp.wasPressed('Backspace')) return this.resolve(false);
      if (inp.clicked(0) && h) return this.resolve(h.role === 'new');
    }
    if (inp.wasPressed('Mouse2') && h) {
      h.flip = h.flip > Math.PI / 2 ? 0 : Math.PI;
      this.ctx.sfx('card_flip', null, 0.6);
    }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const now = performance.now() / 600;
    for (const c of this.cards) {
      const g = c.card.group;
      if (!c.ready) {
        g.quaternion.copy(cam.quaternion);
        g.rotateY(c.flipCur);
        continue;
      }
      c.hover += ((c === this.hovered ? 1 : 0) - c.hover) * Math.min(1, rdt * 12);
      c.flipCur += (c.flip - c.flipCur) * Math.min(1, rdt * 9);
      const local = c === this.hovered && hits.length ? hits[0].point.clone().sub(g.position) : _v.set(0, 0, 0);
      c.tiltY += (local.dot(right) * 0.5 * c.hover - c.tiltY) * Math.min(1, rdt * 10);
      c.tiltX += (-local.dot(upv) * 0.4 * c.hover - c.tiltX) * Math.min(1, rdt * 10);
      g.position.copy(c.home).addScaledVector(fwd, -0.3 * c.hover).addScaledVector(upv, 0.06 * c.hover + Math.sin(now + c.home.x) * 0.015);
      g.quaternion.copy(cam.quaternion);
      g.rotateY(c.flipCur + c.tiltY);
      g.rotateX(c.tiltX);
      g.scale.setScalar(1 + c.hover * 0.07);
    }
    void _q;
  }

  /** call every frame, before RunScene's modal early-return (dt = game time, rdt = real time) */
  update(dt: number, rdt = dt) {
    if (this.active) this.updateReveal(rdt);
    if (dt > 0) this.updateDrops(dt);
  }

  dispose() {
    for (const o of this.offs) o();
    for (const c of this.cards) c.card.dispose();
    this.cards = [];
    this.group.removeFromParent();
    this.ui.remove();
    if (this.active) {
      this.ctx.engine.paused = false;
      this.input.enabled = true;
    }
  }
}
