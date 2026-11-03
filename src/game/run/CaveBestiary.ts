// The Glass Hollow's bestiary: enemy defs registered into ENEMIES when this module
// loads (weight 0: they only live in the cave), plus the behaviour the shared horde
// AI does not cover:
//   GIANT CAVE BATS — roost upside-down on the vault (live rigs, swaying, breathing);
//     ride under the colony or fire a shot nearby and they drop one by one
//     ("I'm Only Sleeping") and join the fight as flyers that circle and stoop
//     ("Blackbird", the snatch is "Baby's in Black"). Now and then one hangs in the
//     air and SCREECHES ("Shattered"): a sonic ring that stuns the hunter if it
//     catches him close (ride out of it).
//   CRYSTAL GOBLINS — packs hide under the sand of their dens; the crystal tips
//     glint for a moment, then they burst out around and BEHIND you ("Undercover of
//     the Night"): spear goblins hunt as a pack (jab "Dust N' Bones", pounce "Get in
//     the Ring"), slingers keep their distance and lob glowing stones ("Rocks Off",
//     the alpha's fan of shards "Shine a Light").
//   CRYSTAL CRABS — burrowed in beds along the lake shore; they rise when you come
//     close. Their back crystals soak most of the damage and REFLECT shots back at
//     you ("Glass Onion"); shoot the crystals off one by one (each pops off as a
//     tumbling chunk) and the crab is soft. Claw "Hand of Fate", prism fan
//     "She's a Rainbow", charge "Locomotive".
//
// ─────────────────────────────────────────────────────────────── INTEGRATION
//   new CaveBestiary({ ctx, enemies, player }); addRoost / addDen / addCrabBed;
//   update(dt) every frame; dispose(). (CaveScene owns one.)
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import { ENEMIES, type EnemyDef } from '../enemies/EnemyDefs';
import type { Enemies, Enemy } from '../enemies/Enemies';
import type { Hit } from '../combat/Damage';
import { buildRigGeo, RigInstance } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import type { RigSpec } from '../../engine/voxel/Rig';
import { rnd, damp } from '../../engine/math/rand';
import { crabCrystalParts } from '../models/cave/crab';

// ============================================================================ defs
export const CAVE_BAT: EnemyDef = {
  id: 'caveBat', name: 'Giant Cave Bat', title: 'Hangs Around, Drops In', rig: 'cave_bat', rigAlpha: 'cave_bat_alpha',
  hp: 34, armor: 2, physRes: 0, magicRes: 0, statusRes: {}, speed: 10.5, radius: 0.75, height: 0.95,
  ai: 'flyer', attacks: [{ kind: 'dive', range: 24, cooldown: 5.2, windup: 0.95, dmg: 11, title: 'Blackbird' }],
  contact: 5, bounty: 5, gold: [0, 2], hitKind: 'flesh', flying: true, firstWave: 1, weight: 0, group: [3, 6],
  weakness: 'The scream before a stoop gives it away: shoot it out of the dive. A hovering bat about to SCREECH stuns you if you are close: ride out of the ring.',
  variants: ['cave_bat', 'cave_bat_v1'],
  moveTitles: { snatch: "Baby's in Black", screech: 'Shattered', roost: "I'm Only Sleeping" },
  lore: 'Fruit bats once, before the dark and the crystal water. Now they are the size of a mule and they have stopped eating fruit.',
};
export const CRYSTAL_GOBLIN: EnemyDef = {
  id: 'crystalGoblin', name: 'Crystal Goblin', title: 'Small, Sharp and Shining', rig: 'cave_goblin', rigAlpha: 'cave_goblin_alpha',
  hp: 28, armor: 4, physRes: 0, magicRes: 0, statusRes: {}, speed: 7.6, radius: 0.42, height: 1.2,
  ai: 'pack', attacks: [
    { kind: 'melee', range: 2.5, cooldown: 1.3, windup: 0.42, dmg: 9, title: "Dust N' Bones" },
    { kind: 'leap', range: 9, minRange: 3, cooldown: 4.6, windup: 0.55, dmg: 12, title: 'Get in the Ring' },
  ],
  contact: 3, bounty: 4, gold: [1, 3], hitKind: 'flesh', firstWave: 1, weight: 0, group: [3, 5], burnMul: 1.3,
  weakness: 'They hide under the sand of their dens: when crystal tips glint in the sand, turn around. Packs circle behind you before they strike; the big ears come off.',
  variants: ['cave_goblin', 'cave_goblin_v1'],
  moveTitles: { ambush: 'Undercover of the Night' },
  lore: 'Sand-cave goblins grow crystals the way other folk grow hair. They trade the glowing ones and eat the rest.',
};
export const GOBLIN_SLINGER: EnemyDef = {
  id: 'goblinSlinger', name: 'Goblin Slinger', title: 'Throws Rocks, Literally', rig: 'cave_goblin_slinger', rigAlpha: 'cave_goblin_slinger_alpha',
  hp: 22, armor: 2, physRes: 0, magicRes: 0, statusRes: {}, speed: 5.6, radius: 0.42, height: 1.2,
  ai: 'lobber', attacks: [
    { kind: 'lob', range: 22, minRange: 5, cooldown: 2.6, windup: 0.6, dmg: 7, count: 1, speed: 14, proj: 'sand', title: 'Rocks Off' },
    { kind: 'fan', range: 18, cooldown: 6, windup: 0.8, dmg: 5, count: 5, spread: 0.6, speed: 15, proj: 'sand', alphaOnly: true, title: 'Shine a Light' },
  ],
  contact: 2, bounty: 4, gold: [1, 3], hitKind: 'flesh', firstWave: 1, weight: 0, group: [1, 2], burnMul: 1.3,
  weakness: 'Fragile and slow to reload: rush them. The stones arc, so keep moving sideways.',
  variants: ['cave_goblin_slinger', 'cave_goblin_slinger_v1'],
  lore: 'Every slinger keeps one stone it will never throw. Nobody knows which one.',
};
export const CRYSTAL_CRAB: EnemyDef = {
  id: 'crystalCrab', name: 'Crystal Crab', title: 'Wears Its Treasure', rig: 'crystal_crab', rigAlpha: 'crystal_crab_alpha',
  hp: 95, armor: 26, physRes: 0.15, magicRes: 0.1, statusRes: { poison: 0.3 }, speed: 4.6, radius: 0.9, height: 1.1,
  ai: 'skitter', attacks: [
    { kind: 'melee', range: 2.6, cooldown: 1.6, windup: 0.55, dmg: 15, title: 'Hand of Fate' },
    { kind: 'fan', range: 16, minRange: 4, cooldown: 4.5, windup: 0.8, dmg: 6, count: 5, spread: 0.7, speed: 13, proj: 'sand', title: "She's a Rainbow" },
    { kind: 'charge', range: 18, minRange: 6, cooldown: 7, windup: 0.9, dmg: 18, title: 'Locomotive' },
  ],
  contact: 8, bounty: 14, gold: [3, 7], hitKind: 'chitin', firstWave: 1, weight: 0,
  weakness: 'The crystals on its back soak your shots and bounce them back at you. Shoot them off one by one, then it is soft.',
  variants: ['crystal_crab', 'crystal_crab_v1'],
  moveTitles: { reflect: 'Glass Onion' },
  lore: 'A shore crab that walked into the dark a thousand years ago and kept growing. The crystals on its back are worth more than your horse.',
};
for (const d of [CAVE_BAT, CRYSTAL_GOBLIN, GOBLIN_SLINGER, CRYSTAL_CRAB]) if (!ENEMIES[d.id]) ENEMIES[d.id] = d;

// ============================================================================ deps
export interface CaveBestiaryDeps {
  ctx: Ctx;
  enemies: Enemies;
  player: { pos: THREE.Vector3; alive: boolean; invuln: number; status: { apply(id: any, stacks: number, dur: number, power: number, cap: number, res: any): any }; board: { vel: THREE.Vector3 }; center(out?: THREE.Vector3): THREE.Vector3 };
}
type V3 = { x: number; y?: number; z: number };

interface Roost {
  rig: RigInstance;
  pos: THREE.Vector3;
  phase: number;
  alpha: boolean;
  drop: number; // > 0 while falling into flight
  done: boolean;
}
interface Colony {
  roosts: Roost[];
  cx: number;
  cz: number;
  awake: boolean;
}
interface Den {
  x: number;
  z: number;
  r: number;
  n: number;
  slingers: number;
  alpha: boolean;
  state: 'hidden' | 'glint' | 'done';
  t: number;
  hide: { x: number; z: number }[];
}
interface CrabBed {
  x: number;
  z: number;
  r: number;
  n: number;
  alpha: boolean;
  done: boolean;
}
interface CrabArmor {
  parts: string[];
  dmg: number;
  per: number;
  reflectT: number;
}

const _v = new THREE.Vector3();

export class CaveBestiary {
  colonies: Colony[] = [];
  dens: Den[] = [];
  beds: CrabBed[] = [];
  private armor = new Map<Enemy, CrabArmor>();
  private screechCd = new Map<Enemy, number>();
  private group = new THREE.Group();
  private unsub: (() => void)[] = [];
  private t = 0;
  /** the screech's radial-blur pulse (the scene adds it to the post blur) */
  pulse = 0;
  /** encounters started so far (the scene paces the Olm off it) */
  triggered = 0;
  onEncounter?: (kind: 'bats' | 'goblins' | 'crabs') => void;

  constructor(private d: CaveBestiaryDeps) {
    this.group.name = 'cave-bestiary';
    d.ctx.scene.add(this.group);
    const ev = d.ctx.events;
    this.unsub.push(ev.on('enemyHit', (e: Enemy, hit: Hit, amt: number) => this.onHit(e, hit, amt)));
    this.unsub.push(ev.on('shot', () => this.noise(this.d.player.pos, 30)));
    this.unsub.push(ev.on('explosion', (p: V3) => this.noise(p, 40)));
  }

  // ---------------------------------------------------------------- set-up
  addRoost(spots: { x: number; z: number; y?: number; rot?: number }[], alphaIdx = 0) {
    const spec = (k: string) => modelEntry(k)!() as RigSpec;
    const col: Colony = { roosts: [], cx: 0, cz: 0, awake: false };
    spots.forEach((s, i) => {
      const alpha = i === alphaIdx;
      const key = alpha ? 'cave_bat_alpha' : i % 2 ? 'cave_bat_v1' : 'cave_bat';
      const rig = new RigInstance(buildRigGeo(spec(key), 'roost:' + key), { castShadow: false });
      const pos = new THREE.Vector3(s.x, (s.y ?? 30) + 0.4 * (alpha ? 1.32 : 1), s.z);
      rig.root.position.copy(pos);
      rig.root.rotation.set(0, s.rot ?? 0, Math.PI);
      rig.root.scale.setScalar(alpha ? 1.32 : 1);
      this.group.add(rig.root);
      col.roosts.push({ rig, pos, phase: rnd.next() * 10, alpha, drop: 0, done: false });
      col.cx += s.x / spots.length;
      col.cz += s.z / spots.length;
    });
    this.colonies.push(col);
    return col;
  }
  addDen(x: number, z: number, r: number, n: number, slingers: number, alpha = false) {
    const hide: { x: number; z: number }[] = [];
    for (let i = 0; i < n + slingers; i++) {
      const a = rnd.next() * Math.PI * 2, d = r * (0.3 + rnd.next() * 0.7);
      hide.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d });
    }
    this.dens.push({ x, z, r, n, slingers, alpha, state: 'hidden', t: 0, hide });
  }
  addCrabBed(x: number, z: number, r: number, n: number, alpha = false) {
    this.beds.push({ x, z, r, n, alpha, done: false });
  }

  // ---------------------------------------------------------------- triggers
  /** a loud noise at p: roosting bats within `r` wake up */
  noise(p: V3, r: number) {
    for (const c of this.colonies) if (!c.awake && Math.hypot(c.cx - p.x, c.cz - p.z) < r) this.wake(c);
  }
  private wake(c: Colony) {
    if (c.awake) return;
    c.awake = true;
    this.triggered++;
    this.onEncounter?.('bats');
    const ctx = this.d.ctx;
    ctx.sfx('vulture_screech', { x: c.cx, y: c.roosts[0]?.pos.y ?? 20, z: c.cz }, 1, 1.7);
    c.roosts.forEach((r, i) => ctx.engine.tweens.after(0.15 + i * 0.22 + rnd.next() * 0.2, () => (r.drop = 0.001)));
  }
  private ambush(den: Den) {
    den.state = 'done';
    this.triggered++;
    this.onEncounter?.('goblins');
    const { ctx, enemies, player } = this.d;
    const p = player.pos;
    const v = player.board.vel;
    const vl = Math.hypot(v.x, v.z);
    // the pack comes up BEHIND the hunter and on his flanks; slingers keep to the den
    const back = vl > 1 ? Math.atan2(-v.x, -v.z) : rnd.next() * Math.PI * 2;
    let first: Enemy | null = null;
    for (let i = 0; i < den.n; i++) {
      const a = back + (i - (den.n - 1) / 2) * 0.55;
      const d = 6 + rnd.next() * 3;
      const e = enemies.spawn('crystalGoblin', p.x + Math.sin(a) * d, p.z + Math.cos(a) * d, { emerge: 'sand', alpha: den.alpha && i === 0 });
      if (e && !first) first = e;
    }
    for (let i = 0; i < den.slingers; i++) {
      const h = den.hide[den.n + i] ?? den.hide[0];
      enemies.spawn('goblinSlinger', h.x, h.z, { emerge: 'sand' });
    }
    if (first) enemies.skill(first, CRYSTAL_GOBLIN.moveTitles!.ambush, undefined, true);
    ctx.sfx('gunslinger_laugh', p, 0.7, 1.55);
    ctx.engine.tweens.after(0.4, () => ctx.sfx('gunslinger_laugh', p, 0.5, 1.75));
    ctx.shake(0.2);
  }
  private rise(bed: CrabBed) {
    bed.done = true;
    this.triggered++;
    this.onEncounter?.('crabs');
    const { ctx, enemies } = this.d;
    for (let i = 0; i < bed.n; i++) {
      const a = (i / bed.n) * Math.PI * 2 + rnd.next();
      const e = enemies.spawn('crystalCrab', bed.x + Math.cos(a) * bed.r * 0.5, bed.z + Math.sin(a) * bed.r * 0.5, { emerge: 'sand', alpha: bed.alpha && i === 0 });
      if (e) this.armorFor(e);
    }
    ctx.sfx('sand_rise', { x: bed.x, y: 0, z: bed.z }, 1, 0.8);
    ctx.sfx('giant_scorpion_hiss', { x: bed.x, y: 0, z: bed.z }, 0.8, 1.3);
  }

  // ---------------------------------------------------------------- crab crystals
  private armorFor(e: Enemy) {
    let a = this.armor.get(e);
    if (!a) {
      const parts = crabCrystalParts(e.alpha).filter((p) => e.part(p) >= 0);
      a = { parts, dmg: 0, per: Math.max(14, e.maxHp * (e.alpha ? 0.12 : 0.17)), reflectT: 0 };
      this.armor.set(e, a);
    }
    return a;
  }
  private onHit(e: Enemy, hit: Hit, amt: number) {
    if (!(e as any)?.def || e.def.id !== 'crystalCrab') return;
    const src = hit.source;
    if (src === 'poison' || src === 'bleed' || src === 'burn') return;
    const a = this.armorFor(e);
    if (!a.parts.length) return;
    const { ctx, enemies, player } = this.d;
    // the crystals soak most of it (blasts and blades crack them twice as fast)
    const heavy = src === 'explosion' || src === 'melee' || src === 'counter' || src === 'ult';
    const top = hit.tags?.[0] === 'head';
    e.hp = Math.min(e.maxHp, e.hp + amt * (heavy ? 0.55 : 0.8));
    a.dmg += amt * (heavy ? 2 : top ? 1.4 : 1);
    const at = new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.85, e.pos.z);
    ctx.fx.sparkle(at, 0x8af4ff, 4, 0.6);
    // gunfire comes back off the crystal faces
    if ((src === 'gun' || src === 'projectile') && a.reflectT <= 0 && player.alive && rnd.chance(top ? 0.85 : 0.5)) {
      a.reflectT = 0.18;
      const c = player.center(_v);
      const dx = c.x - at.x, dy = c.y - at.y, dz = c.z - at.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      const sp = 30;
      const j = 0.06;
      enemies.proj.spawn({ kind: 'bullet', x: at.x, y: at.y, z: at.z, vx: (dx / l + (rnd.next() - 0.5) * j) * sp, vy: (dy / l + (rnd.next() - 0.5) * j) * sp, vz: (dz / l + (rnd.next() - 0.5) * j) * sp, dmg: Math.min(14, 4 + amt * 0.35), sourceId: e.id });
      ctx.sfx('ricochet', at, 0.7, 1.2 + rnd.next() * 0.2);
      ctx.fx.ring(at, 0x8af4ff, 1.6, 0.25);
      enemies.skill(e, CRYSTAL_CRAB.moveTitles!.reflect);
    }
    while (a.dmg >= a.per && a.parts.length) {
      a.dmg -= a.per;
      const part = a.parts.shift()!;
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      enemies.detach(e, part, dx / l, dz / l);
      ctx.sfx('glass_break', at, 0.9, 0.85 + rnd.next() * 0.3);
      ctx.sfx('gem_chime', at, 0.5, 1.1);
      ctx.particles.emit({ pos: at, count: 18, spread: 4, up: 3, gravity: 12, life: [0.5, 1.1], size: [0.08, 0.05], sprite: ['crystal', 'dot3'], color: [0x8af4ff, 0xd8fcff, 0x5ad0f0, 0xc8a0ff], ground: true, rot: 6, rotSpeed: 6 });
      ctx.particles.emit({ pos: at, count: 6, spread: 1.5, life: [0.15, 0.3], size: [0.4, 0.9], sprite: 'glow', color: 0x8af4ff, additive: true });
      ctx.shake(0.12);
      if (!a.parts.length) {
        ctx.toast('CRYSTALS SHATTERED', '#8af4ff', 'The crab is soft now!');
        e.buffT = Math.max(e.buffT, 6);
      }
    }
  }

  // ---------------------------------------------------------------- bat screech
  private screech(e: Enemy) {
    const { ctx, enemies, player } = this.d;
    enemies.skill(e, CAVE_BAT.moveTitles!.screech, undefined, true);
    ctx.sfx('vulture_screech', e.pos, 1, 1.75);
    ctx.sfx('vulture_screech', e.pos, 0.6, 2.1);
    const p = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
    for (let k = 0; k < 4; k++) ctx.engine.tweens.after(k * 0.09, () => ctx.fx.ring(p, k % 2 ? 0xc8a0ff : 0xe8e0ff, 4 + k * 5, 0.5));
    ctx.particles.emit({ pos: p, count: 24, spread: 9, life: [0.3, 0.6], size: [0.12, 0.05], sprite: 'dot3', color: [0xe8e0ff, 0xc8a0ff], additive: true, drag: 1 });
    const d = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z, (player.pos.y - e.pos.y) * 0.6);
    if (player.alive && d < 12 && player.invuln <= 0) {
      player.status.apply('stun', 1, 0.85, 0, 1, {});
      ctx.shake(0.45);
      this.pulse = 0.7;
      ctx.toast('SHATTERED', '#c8a0ff', 'The screech rattles your skull. Stay away from hovering bats!');
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number) {
    if (dt <= 0) return;
    this.t += dt;
    const { ctx, enemies, player } = this.d;
    const pp = player.pos;
    // ---- roosts: hang, breathe, sway; wake when ridden under
    for (const c of this.colonies) {
      if (!c.awake && player.alive && Math.hypot(c.cx - pp.x, c.cz - pp.z) < 17) this.wake(c);
      for (const r of c.roosts) {
        if (r.done) continue;
        const n = r.rig.nodes;
        const t = this.t + r.phase;
        if (r.drop > 0) {
          // let go: fall, unfurl, then the horde takes over
          r.drop += dt;
          const k = Math.min(1, r.drop / 0.45);
          r.rig.root.position.y = r.pos.y - k * k * 2.2;
          r.rig.root.rotation.z = Math.PI * (1 - k);
          if (n['wing_l']) n['wing_l'].rotation.set(0, 0, 1.2 * (1 - k) + Math.sin(t * 30) * 0.6 * k);
          if (n['wing_r']) n['wing_r'].rotation.set(0, 0, -1.2 * (1 - k) - Math.sin(t * 30) * 0.6 * k);
          if (k >= 1) {
            r.done = true;
            r.rig.root.removeFromParent();
            const e = enemies.spawn('caveBat', r.rig.root.position.x, r.rig.root.position.z, { emerge: 'fly', alpha: r.alpha });
            if (e) {
              e.pos.y = r.pos.y - 2.2;
              if (r.alpha) enemies.skill(e, CAVE_BAT.moveTitles!.roost, undefined, true);
            }
            ctx.sfx('whoosh', r.pos, 0.4, 0.8);
          }
          continue;
        }
        // asleep: wings wrapped, a slow breath, a twitch of the ears now and then
        r.rig.root.position.y = r.pos.y;
        r.rig.root.rotation.x = Math.sin(t * 0.6) * 0.05;
        if (n['wing_l']) n['wing_l'].rotation.set(0.15, 0.55, 1.25 + Math.sin(t * 1.3) * 0.03);
        if (n['wing_r']) n['wing_r'].rotation.set(0.15, -0.55, -1.25 - Math.sin(t * 1.3) * 0.03);
        if (n['wing2_l']) n['wing2_l'].rotation.set(0, 2.3, -0.4);
        if (n['wing2_r']) n['wing2_r'].rotation.set(0, -2.3, 0.4);
        if (n['leg_l']) n['leg_l'].rotation.set(-1.2, 0, 0.1);
        if (n['leg_r']) n['leg_r'].rotation.set(-1.2, 0, -0.1);
        if (n['head']) n['head'].rotation.set(-0.5 + Math.sin(t * 0.4) * 0.08, Math.sin(t * 0.23) * 0.3, 0);
        const br = 1 + Math.sin(t * 1.3) * 0.015;
        if (n['body']) n['body'].scale.set(br, br, 1);
      }
    }
    // ---- dens: glint, then the ambush
    for (const den of this.dens) {
      if (den.state === 'done' || !player.alive) continue;
      const d = Math.hypot(den.x - pp.x, den.z - pp.z);
      if (den.state === 'hidden' && d < den.r + 16) {
        den.state = 'glint';
        den.t = 0;
      }
      if (den.state === 'glint') {
        den.t += dt;
        if (Math.random() < dt * 16) {
          const h = den.hide[Math.floor(Math.random() * den.hide.length)];
          const g = ctx.world.groundAt(h.x, h.z);
          ctx.fx.sparkle({ x: h.x, y: g + 0.08, z: h.z }, Math.random() < 0.5 ? 0x8af4ff : 0xc8a0ff, 2, 0.25);
          ctx.particles.emit({ pos: { x: h.x, y: g + 0.05, z: h.z }, count: 2, spread: 0.4, up: 0.6, gravity: 6, life: [0.4, 0.7], size: [0.05, 0.04], sprite: 'dot3', color: [0xd9b27a, 0xc89c64], ground: true });
        }
        if (den.t > 1.6 || d < den.r) this.ambush(den);
      }
    }
    // ---- crab beds
    for (const b of this.beds) if (!b.done && player.alive && Math.hypot(b.x - pp.x, b.z - pp.z) < b.r + 9) this.rise(b);
    // ---- bats: the screech
    for (const e of enemies.list) {
      if (!e.alive || e.def.id !== 'caveBat') continue;
      let cd = this.screechCd.get(e);
      if (cd === undefined) cd = 4 + rnd.next() * 5;
      cd -= dt;
      if (cd <= 0 && e.state === 'move' && e.life > 2) {
        const d = Math.hypot(pp.x - e.pos.x, pp.z - e.pos.z);
        if (d < 16) {
          cd = 8 + rnd.next() * 5;
          // brake and hover for a beat, then scream
          e.vel.multiplyScalar(0.2);
          ctx.engine.tweens.after(0.45, () => e.alive && this.screech(e));
          ctx.particles.emit({ pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z }, count: 6, spread: 1.4, life: [0.3, 0.5], size: [0.3, 0.1], sprite: 'glow', color: 0xc8a0ff, additive: true });
        } else cd = 1;
      }
      this.screechCd.set(e, cd);
    }
    for (const [e, a] of this.armor) {
      a.reflectT -= dt;
      if (!e.alive) this.armor.delete(e);
    }
    for (const e of this.screechCd.keys()) if (!e.alive) this.screechCd.delete(e);
    this.pulse = damp(this.pulse, 0, 3, dt);
  }

  /** everything left in the cave slinks away (the boss arena clears) */
  pending() {
    return this.colonies.some((c) => !c.awake) || this.dens.some((d) => d.state !== 'done') || this.beds.some((b) => !b.done);
  }

  dispose() {
    for (const u of this.unsub) u();
    this.group.removeFromParent();
    this.armor.clear();
    this.screechCd.clear();
  }
}
