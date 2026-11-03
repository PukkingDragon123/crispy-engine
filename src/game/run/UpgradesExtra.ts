// More upgrade cards (same UpgradeDef format as Upgrades.ts) and their effects.
// registerExtraUpgrades() adds them to the shared pool (UPGRADES / UPGRADE_BY_ID)
// so UpgradeManager.roll() offers them and their evolutions like any other.
// ExtraUpgradeEffects drives them purely from ctx.events plus public player /
// skills state; no other system needs to change.
//
// Synergies: Bank Shot feeds Ricochet Rounds (the bounce can chain again);
// The Sixth Chamber scales with Dung Engineer's blast radius and stacks with
// Six-Gun Storm; Thunderhead + The Sixth Chamber → Thunderclap Chamber;
// Hellfire Trail + Grapple Slam → Hellrider; Venom Puddles + Phantom Pinches →
// Venom Brood; Trick Shot / Bullet Ballet ride on Rodeo Star; Combo Fever
// rewards streaks; Golden Lodestone pairs with Gold Tooth.
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../Ctx';
import type { Hit } from '../combat/Damage';
import type { Modifier } from '../combat/Stats';
import { UPGRADES, UPGRADE_BY_ID, UpgradeDef, UpgradeManager } from './Upgrades';
import { rnd } from '../../engine/math/rand';
import { zap, shockwave } from '../player/Equipment';

type M = Omit<Modifier, 'source'>;
const f1 = (v: number) => v.toFixed(1);

export const EXTRA_UPGRADES: UpgradeDef[] = [
  // ------------------------------------------------------------- gun
  { id: 'bankShot', name: 'Bank Shot', cat: 'gun', rarity: 'uncommon', maxLv: 3, icon: 'spark', desc: (l) => `Missed shots skip off the sand into the nearest enemy within ${7 + 2 * l} m for ${55 + 15 * l}% damage.`, lore: 'Sundown never misses. The ground does.' },
  { id: 'sixthChamber', name: 'The Sixth Chamber', cat: 'gun', rarity: 'rare', maxLv: 2, icon: 'cylinder', desc: (l) => `The last round in the cylinder is a dynamite slug: it explodes for ${35 + 25 * l} damage in a ${f1(2.6 + 0.6 * l)} m blast.`, lore: 'Load five, pray on the sixth.' },
  { id: 'thunderhead', name: 'Thunderhead', cat: 'gun', rarity: 'rare', maxLv: 3, icon: 'bolt', god: 'Set', desc: (l) => `Crits arc lightning to ${1 + l} nearby enem${l ? 'ies' : 'y'} for 45% of the hit, jolting them stiff.` },
  { id: 'deadCalm', name: 'Dead Calm', cat: 'gun', rarity: 'rare', maxLv: 2, icon: 'eye', god: 'Horus', desc: (l) => `A perfect reload slows the world for ${f1(1.6 + 0.6 * l)} s: deadeye, +${25 * l}% crit chance.` },
  { id: 'trickShot', name: 'Trick Shot', cat: 'gun', rarity: 'uncommon', maxLv: 3, icon: 'star4', desc: (l) => `Airborne: +${12 * l}% gun damage and +${5 * l}% crit chance. Airborne kills refill ${10 * l}% boost.` },
  // ------------------------------------------------------------- insects
  { id: 'venomPuddles', name: 'Venom Puddles', cat: 'insect', rarity: 'uncommon', maxLv: 3, icon: 'bubble', god: 'Serket', desc: (l) => `Poisoned enemies burst into a venom puddle when they die (${f1(1.4 + 0.3 * l)} m, ${4 + l} s) that poisons all who wade in.` },
  { id: 'mirrorBrood', name: 'Phantom Pinches', cat: 'insect', rarity: 'rare', maxLv: 3, icon: 'scorp', god: 'Serket', desc: (l) => `Crit kills have a ${25 + 15 * l}% chance to hatch a phantom Pinch from the corpse. It hunts for ${5 + l} s.`, lore: 'Pinch insists they are cousins.' },
  { id: 'scorpionWhip', name: 'Scorpion-Tail Whip', cat: 'insect', rarity: 'rare', maxLv: 3, icon: 'scorp_x2', god: 'Serket', desc: (l) => `Melee also cracks a venomous tail-whip ${f1(5.5 + 0.5 * l)} m ahead: ${16 + 10 * l} damage, 3 poison, and it drags them in.` },
  // ------------------------------------------------------------- passives
  { id: 'hellfireTrail', name: 'Hellfire Trail', cat: 'passive', rarity: 'uncommon', maxLv: 3, icon: 'flame1', desc: (l) => `Boosting scorches the sand: the board leaves fire for ${f1(1.6 + 0.4 * l)} s that burns anything crossing it.` },
  { id: 'bulletBallet', name: 'Bullet Ballet', cat: 'passive', rarity: 'rare', maxLv: 2, icon: 'star4', desc: (l) => `Stomping a perfect trick triggers ${f1(1.4 + 0.5 * l)} s of bullet time, reloads the cylinder and +30% fire rate.` },
  { id: 'grappleSlam', name: 'Grapple Slam', cat: 'passive', rarity: 'uncommon', maxLv: 3, icon: 'twig', desc: (l) => `Grapple kicks slam the ground: a ${f1(3.5 + 0.7 * l)} m shockwave for ${20 + 14 * l} damage that stuns.` },
  { id: 'lodestone', name: 'Golden Lodestone', cat: 'passive', rarity: 'uncommon', maxLv: 3, icon: 'coin', desc: (l) => `Coins fly to you from ${2 * l} m further, and every coin heals ${f1(0.4 * l)} health.`, mods: (l) => [{ stat: 'pickupRange', type: 'flat', value: 2 * l }] },
  { id: 'comboFever', name: 'Combo Fever', cat: 'passive', rarity: 'uncommon', maxLv: 3, icon: 'flame2', desc: (l) => `+${l}% damage for every kill in your streak (max +${15 + 10 * l}%).` },
  // ------------------------------------------------------------- evolutions
  { id: 'thunderChamber', name: 'Thunderclap Chamber', cat: 'evolution', rarity: 'mythic', maxLv: 1, icon: 'bolt', god: 'Set', evolveFrom: ['thunderhead', 'sixthChamber'], desc: () => 'EVOLUTION: the sixth chamber calls down the storm: five bolts strike around the blast (40 damage, 1 s stun each).' },
  { id: 'hellrider', name: 'Hellrider', cat: 'evolution', rarity: 'mythic', maxLv: 1, icon: 'flame3', evolveFrom: ['hellfireTrail', 'grappleSlam'], desc: () => 'EVOLUTION: the fire trail burns whenever you ride above 12 m/s, and grapple slams erupt in a ring of fire.' },
  { id: 'venomBrood', name: 'Venom Brood', cat: 'evolution', rarity: 'mythic', maxLv: 1, icon: 'venomSplat', god: 'Serket', evolveFrom: ['venomPuddles', 'mirrorBrood'], desc: () => 'EVOLUTION: venom puddles hatch phantom Pinches, and phantoms leave a puddle wherever their prey falls.' },
];

/** suggested SkillArt vignette families for the new cards (SkillArt falls back by category otherwise) */
export const EXTRA_ART_FAMILY: Record<string, string> = {
  bankShot: 'bottles', sixthChamber: 'dynamite', thunderhead: 'gunstorm', deadCalm: 'horus', trickShot: 'board',
  venomPuddles: 'venom', mirrorBrood: 'brood', scorpionWhip: 'pinch',
  hellfireTrail: 'fire', bulletBallet: 'board', grappleSlam: 'tumbleweed', lodestone: 'coins', comboFever: 'blood',
  thunderChamber: 'gunstorm', hellrider: 'fire', venomBrood: 'brood',
};

/** add the extra cards to the shared pool (idempotent; call once before the first roll) */
export function registerExtraUpgrades() {
  for (const u of EXTRA_UPGRADES) {
    if (UPGRADE_BY_ID[u.id]) continue;
    UPGRADES.push(u);
    UPGRADE_BY_ID[u.id] = u;
  }
}

interface Puddle {
  x: number;
  z: number;
  r: number;
  t: number;
  dur: number;
  dps: number;
  tick: number;
  hatch: number;
  hatched: number;
}

const _v = new THREE.Vector3();
const any = (e: EnemyLike) => e as any;

/** event-driven effects for EXTRA_UPGRADES */
export class ExtraUpgradeEffects {
  private offs: (() => void)[] = [];
  private puddles: Puddle[] = [];
  private fire: { x: number; z: number; t: number; life: number }[] = [];
  private fireDrop = 0;
  private fireTick = 0;
  private crits = new Map<number, number>();
  private lastGold: number;
  private fever = -1;
  private air = false;
  private keys = new Set<string>();

  constructor(private ctx: Ctx, private up: UpgradeManager, private player: any, private skills: any) {
    const ev = ctx.events;
    this.lastGold = ctx.run.gold;
    this.offs.push(
      ev.on('shot', (hit: any) => this.onShot(hit)),
      ev.on('enemyHit', (e: EnemyLike, hit: Hit, amt: number, res: any) => this.onHit(e, hit, amt, res)),
      ev.on('enemyKilled', (e: EnemyLike, hit: Hit | null) => this.onKill(e, hit)),
      ev.on('perfectReload', () => this.onPerfectReload()),
      ev.on('trick', (l: any) => this.onTrick(l)),
      ev.on('grappleKick', (e: EnemyLike) => this.onGrappleKick(e)),
      ev.on('melee', () => this.onMelee()),
    );
  }

  private lv(id: string) {
    return this.up.lv(id);
  }

  private mod(key: string, mods: M[] | null) {
    const src = 'upx:' + key;
    this.player.stats.removeSource(src);
    this.keys.add(src);
    if (mods) this.player.stats.add(mods.map((m) => ({ ...m, source: src })));
  }

  // ------------------------------------------------------------------ shots
  private onShot(hit: any) {
    const ctx = this.ctx;
    const pl = this.player;
    const aim = pl.aimHit && pl.aimHit.surface !== 'none' ? (pl.aimHit.point as THREE.Vector3) : null;
    // bank shot: a miss skips off the ground into someone
    const bs = this.lv('bankShot');
    if (bs && !hit && aim && aim.distanceTo(pl.pos) < 70) {
      const e = ctx.enemies.nearest(aim, 7 + 2 * bs);
      if (e) {
        const to = { x: e.pos.x, y: e.pos.y + e.height * 0.6, z: e.pos.z };
        ctx.engine.tweens.after(0.05, () => {
          if (!e.alive) return;
          ctx.fx.bulletTracer(aim, to, 0xfff0b0, true);
          ctx.fx.hit(aim, { x: 0, y: 1, z: 0 }, 'sand', 0.7);
          ctx.sfx('ricochet', aim, 0.6, 1.1);
          ctx.enemies.damage(e, { base: (pl.baseGunDamage ?? 18) * (0.55 + 0.15 * bs), kind: 'phys', source: 'gun', canCrit: true, tags: ['bank'] }, new THREE.Vector3(to.x, to.y, to.z));
        });
      }
    }
    // the sixth chamber: the last round goes off
    const sc = this.lv('sixthChamber');
    if (sc && pl.ammo === 0) {
      const p = (hit?.point as THREE.Vector3 | undefined) ?? aim;
      if (p && p.distanceTo(pl.pos) < 70) {
        const r = (2.6 + 0.6 * sc) * pl.stats.get('explosionRadius');
        const at = { x: p.x, y: p.y, z: p.z };
        ctx.engine.tweens.after(0.04, () => {
          ctx.fx.explosion(at, r);
          ctx.sfx('explosion', at, 0.9);
          ctx.shake(0.35);
          ctx.events.emit('explosion', at, r, 35 + 25 * sc, 'player');
          if (this.lv('thunderChamber')) this.storm(at, r + 4);
        });
      }
    }
  }

  /** Thunderclap Chamber: bolts from the sky around a point */
  private storm(at: { x: number; y: number; z: number }, r: number) {
    const ctx = this.ctx;
    const targets: EnemyLike[] = [];
    ctx.enemies.inRadius(_v.set(at.x, at.y, at.z), r, (e) => targets.push(e));
    ctx.sfx('thunder', at, 0.9);
    for (let i = 0; i < 5; i++) {
      ctx.engine.tweens.after(0.08 + i * 0.09, () => {
        const e = targets.length ? targets[i % targets.length] : null;
        const a = rnd.next() * Math.PI * 2, d = rnd.next() * r;
        const p = e && e.alive ? { x: e.pos.x, y: e.pos.y, z: e.pos.z } : { x: at.x + Math.cos(a) * d, y: ctx.world.groundAt(at.x + Math.cos(a) * d, at.z + Math.sin(a) * d), z: at.z + Math.sin(a) * d };
        zap(ctx, { x: p.x + (rnd.next() - 0.5) * 2, y: p.y + 9, z: p.z + (rnd.next() - 0.5) * 2 }, p, 0xcfe8ff, 9);
        ctx.fx.light({ x: p.x, y: p.y + 2, z: p.z }, 0xbfe4ff, 6, 0.2, 12);
        if (e && e.alive) ctx.enemies.damage(e, { base: 40, kind: 'magic', source: 'divine', canCrit: true, status: [{ id: 'stun', stacks: 1, dur: 1 }], tags: ['chain'] });
        ctx.events.emit('groundMark', p.x, p.z, 0.6, 1);
      });
    }
  }

  private onHit(e: EnemyLike, hit: Hit, amt: number, res: any) {
    const ctx = this.ctx;
    if (res?.crit) this.crits.set(e.id, ctx.run.time);
    const th = this.lv('thunderhead');
    if (th && res?.crit && hit.source === 'gun' && !hit.tags?.includes('chain')) {
      let from: EnemyLike = e;
      const seen = new Set([e.id]);
      for (let i = 0; i < 1 + th; i++) {
        const next = ctx.enemies.nearest(from.pos, 9, (o) => !seen.has(o.id) && o.alive);
        if (!next) break;
        seen.add(next.id);
        zap(ctx, { x: from.pos.x, y: from.pos.y + from.height * 0.6, z: from.pos.z }, { x: next.pos.x, y: next.pos.y + next.height * 0.6, z: next.pos.z });
        ctx.enemies.damage(next, { base: amt * 0.45, kind: 'magic', source: 'divine', canCrit: false, status: [{ id: 'stun', stacks: 1, dur: 0.25 }], tags: ['chain'] });
        from = next;
      }
      if (seen.size > 1) ctx.sfx('thunder', e.pos, 0.25, 1.8);
    }
  }

  private onKill(e: EnemyLike, hit: Hit | null) {
    const ctx = this.ctx;
    const pl = this.player;
    const st = any(e).status;
    const vp = this.lv('venomPuddles');
    if (vp && st?.has?.('poison')) this.addPuddle(e.pos.x, e.pos.z, 1.4 + 0.3 * vp, 4 + vp, 10 + 6 * vp);
    // venom brood: phantoms' prey leaves a little puddle
    if (this.lv('venomBrood') && hit?.source === 'scorpion') this.addPuddle(e.pos.x, e.pos.z, 1.3, 3, 12);
    const mb = this.lv('mirrorBrood');
    const ct = this.crits.get(e.id);
    if (mb && ct !== undefined && ctx.run.time - ct < 0.3 && rnd.chance(0.25 + 0.15 * mb)) this.phantom(e.pos, 5 + mb);
    this.crits.delete(e.id);
    const ts = this.lv('trickShot');
    if (ts && !pl.board.grounded) pl.board.boostMeter = Math.min(1, pl.board.boostMeter + 0.1 * ts);
  }

  /** a phantom Pinch: joins the brood (Skills.brood) and hunts */
  private phantom(at: THREE.Vector3, life: number) {
    const brood = this.skills?.brood as any[] | undefined;
    if (!Array.isArray(brood)) return;
    const ctx = this.ctx;
    const a = rnd.next() * Math.PI * 2;
    brood.push({ pos: new THREE.Vector3(at.x, at.y + 0.4, at.z), vel: new THREE.Vector3(Math.sin(a) * 2, 6, Math.cos(a) * 2), yaw: a, state: 'fly', target: null, life, stingT: 0, off: new THREE.Vector3((rnd.next() - 0.5) * 0.5, 0, (rnd.next() - 0.5) * 0.5) });
    ctx.sfx('spectral_scorpion', at, 0.5);
    ctx.particles.emit({ pos: { x: at.x, y: at.y + 0.5, z: at.z }, count: 12, spread: 1.6, up: 2, life: [0.4, 0.8], size: [0.1, 0.02], sprite: ['star4', 'dot3'], additive: true, color: [0xc8ff5a, 0x9dff3a, 0xffffff], drag: 2 });
  }

  private addPuddle(x: number, z: number, r: number, dur: number, dps: number) {
    if (this.puddles.length >= 16) this.puddles.shift();
    this.puddles.push({ x, z, r, t: 0, dur, dps, tick: 0.2, hatch: this.lv('venomBrood') ? 0 : 1e9, hatched: 0 });
    this.ctx.events.emit('groundMark', x, z, r, 3);
    this.ctx.sfx('poison_burst', { x, y: this.ctx.world.groundAt(x, z), z }, 0.5);
  }

  // ------------------------------------------------------------------ slow-mo moments
  private slow(scale: number, dur: number, mods: M[], key: string) {
    const eng = this.ctx.engine;
    eng.slowMo(scale, 20);
    this.mod(key, mods);
    this.ctx.sfx('time_slow', null, 0.5);
    eng.tweens.after(dur, () => {
      eng.slowMo(1, 6);
      this.mod(key, null);
    }, true);
  }

  private onPerfectReload() {
    const l = this.lv('deadCalm');
    if (!l) return;
    this.slow(0.4, 1.6 + 0.6 * l, [{ stat: 'critChance', type: 'flat', value: 0.25 * l }], 'deadCalm');
    this.ctx.toast('DEAD CALM', '#9fd2ff');
  }

  private onTrick(t: any) {
    const l = this.lv('bulletBallet');
    if (!l || t?.quality !== 'perfect' || !(t.score > 0)) return;
    const pl = this.player;
    pl.reload.active = false;
    pl.reload.phase = 'none';
    pl.ammo = pl.maxAmmo;
    this.slow(0.35, 1.4 + 0.5 * l, [{ stat: 'fireRate', type: 'pct', value: 0.3 }], 'ballet');
    this.ctx.toast('BULLET BALLET', '#ffd36b', 'Cylinder full');
  }

  // ------------------------------------------------------------------ grapple / melee
  private onGrappleKick(e: EnemyLike) {
    const l = this.lv('grappleSlam');
    if (!l) return;
    const ctx = this.ctx;
    const at = { x: e.pos.x, y: ctx.world.groundAt(e.pos.x, e.pos.z), z: e.pos.z };
    const r = 3.5 + 0.7 * l;
    shockwave(ctx, at, r);
    ctx.sfx('explosion', at, 0.5, 0.7);
    ctx.sfx('quake_rumble', at, 0.5);
    ctx.shake(0.5);
    (ctx.world as any).deform?.(at.x, at.z, r * 0.4, 0.25);
    ctx.enemies.inRadius(_v.set(at.x, at.y, at.z), r, (o) => {
      const dir = new THREE.Vector3(o.pos.x - at.x, 0, o.pos.z - at.z).normalize();
      ctx.enemies.damage(o, { base: 20 + 14 * l, kind: 'phys', source: 'grapple', knock: 12, dirX: dir.x, dirZ: dir.z, status: [{ id: 'stun', stacks: 1, dur: 0.6 }], canCrit: true }, undefined, dir);
    });
    if (this.lv('hellrider')) for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.fire.push({ x: at.x + Math.cos(a) * r * 0.75, z: at.z + Math.sin(a) * r * 0.75, t: 0, life: 3 });
    }
  }

  private onMelee() {
    const l = this.lv('scorpionWhip');
    if (!l) return;
    const ctx = this.ctx;
    ctx.engine.tweens.after(0.06, () => {
      const pl = this.player;
      const o = pl.center(new THREE.Vector3());
      const f = ctx.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
      const side = new THREE.Vector3(f.z, 0, -f.x);
      const reach = 5.5 + 0.5 * l;
      // the lash: a curling arc of venom and chitin flecks, then the crack at the tip
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const p = o.clone().addScaledVector(f, reach * t).addScaledVector(side, Math.sin(t * Math.PI) * 0.9).add(_v.set(0, Math.sin(t * Math.PI) * 0.45 - t * 0.3, 0));
        ctx.particles.emit({ pos: p, count: 1, life: [0.16, 0.22], size: [0.13 - t * 0.05, 0.03], sprite: i % 3 ? 'dot3' : 'spark', color: i % 2 ? 0xb0682e : 0xc8ff5a, additive: i % 2 === 0, delay: t * 0.08, sizeJitter: 0 });
      }
      const tip = o.clone().addScaledVector(f, reach);
      ctx.particles.emit({ pos: tip, count: 6, spread: 3, life: [0.1, 0.2], size: [0.18, 0.03], sprite: ['star4', 'spark'], additive: true, color: [0xffffff, 0xc8ff5a], delay: 0.08 });
      ctx.sfx('whoosh', o, 0.7, 1.3);
      ctx.engine.tweens.after(0.08, () => ctx.sfx('scorpion_sting', tip, 0.7, 0.9));
      ctx.enemies.inRadius(o, reach + 0.5, (e) => {
        const dx = e.pos.x - o.x, dz = e.pos.z - o.z;
        const d = Math.hypot(dx, dz) || 1;
        if ((dx * f.x + dz * f.z) / d < 0.74 || Math.abs(e.pos.y + e.height * 0.5 - o.y) > 2.5) return;
        const toMe = new THREE.Vector3(-dx / d, 0, -dz / d);
        ctx.enemies.damage(e, { base: 16 + 10 * l, kind: 'phys', source: 'melee', knock: Math.min(6, d * 0.8), canCrit: true, tags: ['whip'], status: [{ id: 'poison', stacks: 3, dur: 4, power: 2.2 }] }, undefined, toMe);
      });
    });
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    if (dt <= 0) return;
    const ctx = this.ctx;
    const pl = this.player;
    const run = ctx.run;
    // hellfire trail
    const hf = this.lv('hellfireTrail');
    const b = pl.board;
    if (hf && pl.alive && b.grounded && (b.boosting || (this.lv('hellrider') && pl.speed > 12))) {
      this.fireDrop -= dt;
      if (this.fireDrop <= 0) {
        this.fireDrop = 0.09;
        this.fire.push({ x: pl.pos.x, z: pl.pos.z, t: 0, life: 1.6 + 0.4 * hf });
        if (this.fire.length > 60) this.fire.shift();
        ctx.fx.flames({ x: pl.pos.x, y: pl.pos.y + 0.1, z: pl.pos.z }, 2, 0.8);
        if (rnd.chance(0.3)) ctx.events.emit('groundMark', pl.pos.x, pl.pos.z, 0.45, 1);
      }
    }
    if (this.fire.length) {
      for (let i = this.fire.length - 1; i >= 0; i--) {
        const f = this.fire[i];
        f.t += dt;
        if (f.t >= f.life) {
          this.fire.splice(i, 1);
          continue;
        }
        if (rnd.chance(dt * 5)) ctx.fx.flames({ x: f.x, y: ctx.world.groundAt(f.x, f.z) + 0.05, z: f.z }, 1, 0.55 * (1 - f.t / f.life) + 0.25);
      }
      this.fireTick -= dt;
      if (this.fireTick <= 0) {
        this.fireTick = 0.3;
        const pow = 1.5 + 0.5 * Math.max(1, hf);
        for (const e of ctx.enemies.list) {
          if (!e.alive || e.flying) continue;
          for (const f of this.fire)
            if (Math.hypot(e.pos.x - f.x, e.pos.z - f.z) < 1.25 + e.radius * 0.5) {
              ctx.enemies.damage(e, { base: 4 + 2 * Math.max(1, hf), kind: 'magic', source: 'burn', canCrit: false, status: [{ id: 'burn', stacks: 1, dur: 3, power: pow }] });
              break;
            }
        }
      }
    }
    // venom puddles
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const p = this.puddles[i];
      p.t += dt;
      if (p.t >= p.dur) {
        this.puddles.splice(i, 1);
        continue;
      }
      const gy = ctx.world.groundAt(p.x, p.z);
      if (rnd.chance(dt * (4 + p.r * p.r * 2))) {
        const a = rnd.next() * Math.PI * 2, rr = Math.sqrt(rnd.next()) * p.r * 0.9;
        const q = { x: p.x + Math.cos(a) * rr, y: gy + 0.06, z: p.z + Math.sin(a) * rr };
        ctx.particles.emit({ pos: q, count: 1, spread: 0.15, up: 0.5, life: [0.3, 0.6], size: [0.07, 0.02], sprite: 'bubble', color: 0xffffff, gravity: -0.6 });
        if (rnd.chance(0.3)) ctx.particles.emit({ pos: q, count: 1, vel: { x: 0, y: 0.45, z: 0 }, spread: 0.2, life: [0.8, 1.5], size: [0.16, 0.6], sprite: ['puff0', 'puff1'], color: [0x9dcf4a, 0x7fae3a, 0xb8e070], alpha: 0.35, drag: 1.5 });
      }
      p.tick -= dt;
      if (p.tick <= 0) {
        p.tick = 0.4;
        for (const e of ctx.enemies.list) {
          if (!e.alive || e.flying) continue;
          if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < p.r + e.radius * 0.5) ctx.enemies.damage(e, { base: p.dps * 0.4, kind: 'magic', source: 'poison', canCrit: false, status: [{ id: 'poison', stacks: 1, dur: 3, power: 2 }] });
        }
      }
      p.hatch -= dt;
      if (p.hatch <= 0 && p.hatched < 2) {
        p.hatch = 1.5;
        p.hatched++;
        this.phantom(_v.set(p.x, gy, p.z).clone(), 5);
      }
    }
    // golden lodestone: coins heal
    const ls = this.lv('lodestone');
    const dg = run.gold - this.lastGold;
    if (ls && dg > 0 && pl.alive) pl.heal(Math.min(dg, 15) * 0.4 * ls);
    this.lastGold = run.gold;
    // combo fever
    const cf = this.lv('comboFever');
    const want = cf ? Math.round(Math.min(0.15 + 0.1 * cf, run.combo * 0.01 * cf) * 100) / 100 : 0;
    if (want !== this.fever) {
      this.fever = want;
      this.mod('fever', want > 0 ? [{ stat: 'gunDmg', type: 'pct', value: want }, { stat: 'meleeDmg', type: 'pct', value: want }, { stat: 'magicDmg', type: 'pct', value: want }] : null);
    }
    if (cf && want >= 0.15 + 0.1 * cf - 1e-6 && rnd.chance(dt * 8)) ctx.particles.emit({ pos: pl.muzzleWorld, count: 1, spread: 0.6, up: 1.2, life: [0.3, 0.5], size: [0.12, 0.03], sprite: ['flame0', 'flame1'], additive: true, color: 0xffffff });
    // trick shot: airborne bonus
    const ts = this.lv('trickShot');
    const air = !!ts && !b.grounded;
    if (air !== this.air) {
      this.air = air;
      this.mod('trickShot', air ? [{ stat: 'gunDmg', type: 'pct', value: 0.12 * ts }, { stat: 'critChance', type: 'flat', value: 0.05 * ts }] : null);
    }
  }

  dispose() {
    for (const o of this.offs) o();
    this.offs = [];
    for (const k of this.keys) this.player.stats.removeSource(k);
    this.puddles = [];
    this.fire = [];
  }
}
