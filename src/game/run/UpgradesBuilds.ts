// Build cards: strong, clear effects that feed the cooldown model (attacking
// earns cooldowns back), the skills and the ultimate, so a hunt can snowball
// into an overpowered build. Each line of four songs ends in a mythic
// EVOLUTION when its two cards are maxed:
//   Ride the Lightning + Back in Black        -> THUNDERSTRUCK
//   Another One Bites the Dust + Come Together -> KILLER QUEEN
//   Wish You Were Here + Bohemian Rhapsody     -> THE DARK SIDE OF THE MOON
//   Welcome to the Jungle + The Lovers         -> NOVEMBER RAIN
// Same UpgradeDef format as Upgrades.ts; registered by UpgradesExtra and driven
// from ctx.events (BuildEffects is created by ExtraUpgradeEffects).
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../Ctx';
import type { Hit } from '../combat/Damage';
import type { Modifier } from '../combat/Stats';
import type { UpgradeDef, UpgradeManager } from './Upgrades';
import { cnt } from './Upgrades';
import { rnd } from '../../engine/math/rand';
import { zap } from '../player/Equipment';
import { Ultimate } from '../player/Ultimate';

type M = Omit<Modifier, 'source'>;
const pc = (v: number) => `${Math.round(v * 100)}%`;
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

export const BUILD_UPGRADES: UpgradeDef[] = [
  // ---- the cooldown engine
  { id: 'backInBlack', name: 'Back in Black', cat: 'relic', rarity: 'rare', maxLv: 3, icon: 'skull', god: 'Anubis', desc: (l) => `Every kill takes ${f1(0.4 * l)} s more off every skill cooldown.`, per: '+0.4 s cooldown refund per kill', lore: 'Forget the hearse, Anubis is driving.' },
  { id: 'rockYou', name: 'We Will Rock You', cat: 'gun', rarity: 'uncommon', maxLv: 3, icon: 'bullet', desc: (l) => `Hits and kills earn cooldowns back ${pc(0.3 * l)} faster.`, per: '+30% cooldown refunds', lore: 'Stomp, stomp, bang.' },
  { id: 'highwayToHell', name: 'Highway to Hell', cat: 'passive', rarity: 'uncommon', maxLv: 3, icon: 'speedline', desc: (l) => `Riding above 14 m/s: skills deal +${pc(0.2 * l)} damage and every cooldown runs ${pc(0.3 * l)} faster.`, lore: 'No stop signs, no speed limit, no brakes on a sandboard.' },
  // ---- statuses and executions
  { id: 'comeTogether', name: 'Come Together', cat: 'insect', rarity: 'rare', maxLv: 3, icon: 'scarab', god: 'Khepri', desc: (l) => `Hitting an enemy that carries two or more different statuses (poison, bleed, burn, curse, slow, stun) adds a divine echo: +${pc(0.25 * l)} of the hit.`, lore: 'One thing I can tell you: the venom and the thorns get along.' },
  { id: 'bitesDust', name: 'Another One Bites the Dust', cat: 'gun', rarity: 'epic', maxLv: 2, icon: 'skull', god: 'Anubis', desc: (l) => `Gun hits execute any non-boss enemy below ${Math.round(9 * l)}% health. Every execution takes 1 s off every skill cooldown.`, lore: 'And another one gone.' },
  // ---- skills and the ultimate
  { id: 'rideLightning', name: 'Ride the Lightning', cat: 'gun', rarity: 'rare', maxLv: 3, icon: 'bolt', god: 'Set', desc: (l) => `Every skill cast calls down ${1 + cnt(l)} bolt${cnt(l) ? 's' : ''} of lightning on the nearest enemies (${36 + 12 * l} damage, a short stun).`, lore: 'Flash before my eyes.' },
  { id: 'wishYouWereHere', name: 'Wish You Were Here', cat: 'insect', rarity: 'epic', maxLv: 2, icon: 'glyph0', god: 'Thoth', desc: (l) => `Every skill cast has a ${Math.round(22 * l)}% chance to cast itself again a moment later, free.`, lore: 'Two lost souls, swimming in a fishbowl. Both of them throw dung bombs.' },
  { id: 'bohemian', name: 'Bohemian Rhapsody', cat: 'relic', rarity: 'rare', maxLv: 3, icon: 'ankh', god: 'Serket', desc: (l) => `Stairway to Serket charges ${pc(0.25 * l)} faster, and the beast stays ${f1(1.5 * l)} s longer.`, lore: 'Is this the real life? Is this a scorpion the size of a house?' },
  { id: 'welcomeJungle', needs: 'learnGunsNRoses', name: 'Welcome to the Jungle', cat: 'gun', rarity: 'uncommon', maxLv: 3, icon: 'spark', god: 'Hathor', desc: (l) => `Guns N' Roses roots ${cnt(l)} more prey, fires ${pc(0.2 * l)} more rounds, and its roses bloom ${pc(0.3 * l)} harder.`, lore: 'We got fun and games. Mostly thorns.' },
  // ---- wind (player/Stamina): a deeper vessel, a quicker breath, kills that keep him going
  { id: 'fuel', name: 'Fuel', cat: 'passive', rarity: 'uncommon', maxLv: 3, icon: 'spark', god: 'Ra', mods: (l) => [{ stat: 'staminaMax', type: 'flat', value: 25 * l }], desc: (l) => `A deeper vessel: +${Math.round(25 * l)} stamina for jumps, surfing, shots and skills.`, pros: (l) => [`+${Math.round(25 * l)} max stamina`], per: '+25 max stamina', lore: 'Ra burns all day and never once stops for breath.' },
  { id: 'windOfChange', name: 'Wind of Change', cat: 'insect', rarity: 'uncommon', maxLv: 3, icon: 'star4', god: 'Shu', mods: (l) => [{ stat: 'staminaRegen', type: 'pct', value: 0.3 * l }], desc: (l) => `Shu fills his ribs with desert air: stamina refills ${pc(0.3 * l)} faster.`, pros: (l) => [`+${pc(0.3 * l)} stamina regen`], per: '+30% stamina regen', lore: 'Pinch whistles it on the long rides. The band is called Scorpions, so Serket allows it.' },
  { id: 'dontStopMeNow', name: "Don't Stop Me Now", cat: 'relic', rarity: 'rare', maxLv: 3, icon: 'speedline', god: 'Montu', desc: (l) => `Every kill pours ${Math.round(5 * l)} stamina back, and jumps, sand kicks and wall kicks cost ${Math.round(10 * l)}% less.`, pros: (l) => [`+${Math.round(5 * l)} stamina per kill`, `−${Math.round(10 * l)}% jump costs`], per: '+5 stamina per kill, −10% jump costs', lore: 'A shooting star leaping through the dunes, and he is having such a good time.' },
  // ---- evolutions
  { id: 'thunderstruck', name: 'Thunderstruck', cat: 'evolution', rarity: 'mythic', maxLv: 1, icon: 'bolt', god: 'Set', evolveFrom: ['rideLightning', 'backInBlack'], desc: () => 'EVOLUTION: every kill hurls a bolt into the next enemy and takes 1.2 s more off every cooldown. Ride the Lightning bolts chain to a second target.' },
  { id: 'killerQueen', name: 'Killer Queen', cat: 'evolution', rarity: 'mythic', maxLv: 1, icon: 'skull', god: 'Anubis', evolveFrom: ['bitesDust', 'comeTogether'], desc: () => 'EVOLUTION: executions explode (80 damage, 5 m) and hand every status the victim carried to everyone in the blast.' },
  { id: 'darkSide', name: 'The Dark Side of the Moon', cat: 'evolution', rarity: 'mythic', maxLv: 1, icon: 'star4', god: 'Khonsu', evolveFrom: ['wishYouWereHere', 'bohemian'], desc: () => 'EVOLUTION: when Stairway to Serket ends, your skills have no cooldown for 6 s.' },
  { id: 'novemberRain', name: 'November Rain', cat: 'evolution', rarity: 'mythic', maxLv: 1, icon: 'spark', god: 'Hathor', evolveFrom: ['welcomeJungle', 'learnGunsNRoses'], desc: () => "EVOLUTION: Guns N' Roses fires twice the rounds, and every bloom leaves a 4 s rain of thorns that bleeds everything under it." },
];

/** card art families (the models worker remakes the vignettes; these keys pick the current ones) */
export const BUILD_ART_FAMILY: Record<string, string> = {
  learnGunsNRoses: 'gunstorm', backInBlack: 'anubis', rockYou: 'gun', highwayToHell: 'board', comeTogether: 'swarm', bitesDust: 'bottles',
  rideLightning: 'gunstorm', wishYouWereHere: 'thoth', bohemian: 'serket', welcomeJungle: 'gunstorm',
  fuel: 'fire', windOfChange: 'serket', dontStopMeNow: 'board',
  thunderstruck: 'gunstorm', killerQueen: 'anubis', darkSide: 'moon', novemberRain: 'gunstorm',
};

const STATUSES = ['poison', 'bleed', 'burn', 'curse', 'slow', 'stun'];
type Foe = EnemyLike & { hp?: number; maxHp?: number; status?: { stacks(id: string): number; apply(id: string, st: number, dur: number, pw: number, max: number, res: object): void } };
interface SkillsLike {
  refundMul: number;
  killBonus: number;
  refund(sec: number, kill?: boolean): void;
  recast(k: string): void;
  roses?: { extraRoses: number; bulletMul: number; bloomMul: number; rain: number };
  scorpCd: number;
  swarmCd: number;
  rosesCd: number;
  bombRecharge: number;
  bombCharges: number;
}

/** what a build does to the skills' numbers, from card powers (pure: node-checked) */
export function buildNumbers(pw: (id: string) => number) {
  return {
    refundMul: 1 + 0.3 * pw('rockYou'),
    killBonus: 0.4 * pw('backInBlack') + (pw('thunderstruck') ? 1.2 : 0),
    chargeMul: 1 + 0.25 * pw('bohemian'),
    durBonus: 1.5 * pw('bohemian'),
    extraRoses: cnt(pw('welcomeJungle')),
    bulletMul: (1 + 0.2 * pw('welcomeJungle')) * (pw('novemberRain') ? 2 : 1),
    bloomMul: 1 + 0.3 * pw('welcomeJungle'),
    rain: pw('novemberRain') ? 4 : 0,
    executeBelow: 0.09 * pw('bitesDust'),
    recastChance: Math.min(0.9, 0.22 * pw('wishYouWereHere')),
    killStamina: 5 * pw('dontStopMeNow'),
    jumpCostMul: Math.max(0.5, 1 - 0.1 * pw('dontStopMeNow')),
  };
}

export class BuildEffects {
  private offs: (() => void)[] = [];
  private fastAcc = 0;
  private hwOn = 0;
  private freeT = 0;
  private echoT = new Map<number, number>();

  constructor(private ctx: Ctx, private up: UpgradeManager, private player: any, private skills: SkillsLike | null) {
    const ev = ctx.events;
    this.offs.push(
      ev.on('enemyHit', (e: Foe, hit: Hit, amt: number) => this.onHit(e, hit, amt)),
      ev.on('enemyKilled', (e: Foe) => this.onKill(e)),
      ev.on('skillCast', (k: string) => this.onCast(k)),
      ev.on('ultNova', () => {
        if (this.pw('darkSide')) this.ctx.engine.tweens.after(1.2, () => (this.freeT = 6));
      }),
    );
  }

  private pw(id: string) {
    return this.up.pw(id);
  }

  private onHit(e: Foe, hit: Hit, amt: number) {
    const ctx = this.ctx;
    if (!e || !hit || !e.alive) return;
    // Come Together: a divine echo on enemies with two or more statuses
    const ct = this.pw('comeTogether');
    if (ct && amt > 0 && !hit.tags?.includes('echo') && e.status) {
      let n = 0;
      for (const s of STATUSES) if (e.status.stacks(s) > 0) n++;
      const last = this.echoT.get(e.id) ?? -9;
      if (n >= 2 && ctx.run.time - last > 0.15) {
        this.echoT.set(e.id, ctx.run.time);
        ctx.enemies.damage(e, { base: amt * 0.25 * ct, kind: 'magic', source: 'divine', canCrit: false, tags: ['echo'] });
      }
    }
    // Another One Bites the Dust: gun hits execute the nearly dead
    const thr = 0.09 * this.pw('bitesDust');
    if (thr > 0 && hit.source === 'gun' && !e.isBoss && !hit.tags?.includes('execute') && e.maxHp && (e.hp ?? 0) > 0 && (e.hp ?? 0) / e.maxHp < thr) {
      const carried = e.status ? STATUSES.map((s) => [s, e.status!.stacks(s)] as [string, number]).filter((x) => x[1] > 0) : [];
      ctx.enemies.damage(e, { base: (e.hp ?? 0) * 6 + 60, kind: 'phys', source: 'gun', canCrit: false, tags: ['execute'] });
      ctx.fx.number({ x: e.pos.x, y: e.pos.y + e.height + 0.4, z: e.pos.z }, 'BITES THE DUST', 0xe8dcc0, 0.9, 1.1);
      this.skills?.refund(1, true);
      if (this.pw('killerQueen')) this.queenBlast(e, carried);
    }
  }

  private queenBlast(e: Foe, carried: [string, number][]) {
    const ctx = this.ctx;
    const p = { x: e.pos.x, y: e.pos.y + 0.6, z: e.pos.z };
    ctx.fx.explosion(p, 2.4);
    ctx.sfx('explosion', p, 0.8, 1.15);
    ctx.enemies.inRadius(new THREE.Vector3(p.x, p.y, p.z), 5, (o: Foe) => {
      ctx.enemies.damage(o, { base: 80, kind: 'phys', source: 'explosion', canCrit: true, tags: ['execute'], knock: 8 });
      for (const [s, st] of carried) o.status?.apply(s, Math.max(1, Math.round(st * 0.6)), 4, 2, 99, {});
    });
  }

  private onKill(e: Foe) {
    if (!this.pw('thunderstruck') || !e) return;
    const ctx = this.ctx;
    const next = ctx.enemies.nearest(e.pos, 12, (o: EnemyLike) => o !== e && o.alive);
    if (!next) return;
    zap(ctx, { x: e.pos.x, y: e.pos.y + e.height * 0.6, z: e.pos.z }, { x: next.pos.x, y: next.pos.y + next.height * 0.6, z: next.pos.z });
    ctx.enemies.damage(next, { base: 30, kind: 'magic', source: 'divine', canCrit: true, tags: ['chain'], status: [{ id: 'stun', stacks: 1, dur: 0.3 }] });
  }

  private onCast(k: string) {
    const ctx = this.ctx;
    // Ride the Lightning: bolts on the nearest enemies
    const rl = this.pw('rideLightning');
    if (rl) {
      const n = 1 + cnt(rl);
      const pl = this.player;
      const list = ctx.enemies.list.filter((e) => e.alive && e.pos.distanceTo(pl.pos) < 24).sort((a, b) => a.pos.distanceTo(pl.pos) - b.pos.distanceTo(pl.pos)).slice(0, n);
      ctx.sfx('thunder', pl.pos, 0.7);
      list.forEach((e, i) =>
        ctx.engine.tweens.after(0.06 + i * 0.08, () => {
          if (!e.alive) return;
          const p = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
          zap(ctx, { x: p.x + (rnd.next() - 0.5) * 2, y: p.y + 10, z: p.z + (rnd.next() - 0.5) * 2 }, p, 0xcfe8ff, 9);
          ctx.enemies.damage(e, { base: 36 + 12 * rl, kind: 'magic', source: 'divine', canCrit: true, tags: ['chain'], status: [{ id: 'stun', stacks: 1, dur: 0.5 }] });
          if (this.pw('thunderstruck')) {
            const o = ctx.enemies.nearest(e.pos, 9, (x: EnemyLike) => x !== e && x.alive);
            if (o) {
              zap(ctx, { x: p.x, y: p.y + e.height * 0.6, z: p.z }, { x: o.pos.x, y: o.pos.y + o.height * 0.6, z: o.pos.z });
              ctx.enemies.damage(o, { base: 24 + 8 * rl, kind: 'magic', source: 'divine', canCrit: true, tags: ['chain'] });
            }
          }
        }),
      );
    }
    // Wish You Were Here: a free second cast
    const ch = Math.min(0.9, 0.22 * this.pw('wishYouWereHere'));
    if (ch > 0 && rnd.chance(ch)) ctx.engine.tweens.after(0.4, () => this.skills?.recast(k));
  }

  update(dt: number) {
    const sk = this.skills;
    if (!sk || dt <= 0) return;
    const b = buildNumbers((id) => this.pw(id));
    sk.refundMul = b.refundMul;
    sk.killBonus = b.killBonus;
    if (sk.roses) {
      sk.roses.extraRoses = b.extraRoses;
      sk.roses.bulletMul = b.bulletMul;
      sk.roses.bloomMul = b.bloomMul;
      sk.roses.rain = b.rain;
    }
    // Don't Stop Me Now: kills pour wind back, jumps cost less (player/Stamina)
    const st = this.player.staminaSys;
    if (st) {
      st.killRefill = b.killStamina;
      st.jumpCostMul = b.jumpCostMul;
    }
    const ult = Ultimate.current;
    if (ult) {
      ult.chargeMul = b.chargeMul;
      ult.durBonus = b.durBonus;
    }
    // Highway to Hell: fast riding speeds every cooldown and the skills' bite
    const hw = this.pw('highwayToHell');
    const fast = hw > 0 && (this.player.speed ?? 0) > 14;
    const want = fast ? hw : 0;
    if (want !== this.hwOn) {
      this.hwOn = want;
      this.mod('highway', fast ? [{ stat: 'magicDmg', type: 'pct', value: 0.2 * hw }] : null);
    }
    if (fast) {
      this.fastAcc += dt * 0.3 * hw;
      if (this.fastAcc >= 0.5) {
        sk.refund(this.fastAcc);
        this.fastAcc = 0;
      }
    }
    // The Dark Side of the Moon: no cooldowns for a while after the ultimate
    if (this.freeT > 0) {
      this.freeT -= dt;
      sk.scorpCd = Math.min(sk.scorpCd, 0);
      sk.swarmCd = Math.min(sk.swarmCd, 0);
      sk.rosesCd = Math.min(sk.rosesCd, 0);
      if (sk.bombCharges < 1) sk.bombCharges = 1;
    }
  }

  private mod(key: string, mods: M[] | null) {
    const src = 'upb:' + key;
    this.player.stats.removeSource(src);
    if (mods) this.player.stats.add(mods.map((m) => ({ ...m, source: src })));
  }

  dispose() {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }
}
