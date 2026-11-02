// Damage pipeline (same math for player → enemy and enemy → player).
// final = base × attackerScale × momentum × headshot × crit × curse × vulnerability
//         × mitigation(phys: 100/(100+armor·armorMul) × (1−physRes) | magic: 1−magicRes)
import { StatSheet } from './Stats';
import { StatusSet, StatusId, StatusResist, ComboId } from './Status';
import { rnd } from '../../engine/math/rand';

export type DamageSource =
  | 'gun' | 'melee' | 'scorpion' | 'swarm' | 'explosion' | 'poison' | 'bleed' | 'burn' | 'ult' | 'board'
  | 'thorns' | 'contact' | 'projectile' | 'storm' | 'divine' | 'curse' | 'fall' | 'grapple' | 'counter';

export interface StatusApply {
  id: StatusId;
  stacks: number;
  dur: number;
  chance?: number; // 0..1 (plus attacker statusChance)
  power?: number; // per-stack dps base (scaled by statusPower)
}

export interface Hit {
  base: number;
  kind: 'phys' | 'magic' | 'true';
  source: DamageSource;
  canCrit?: boolean;
  critBonus?: number; // added crit chance
  forceCrit?: boolean;
  mult?: number; // extra multiplier from the attack itself
  status?: StatusApply[];
  knock?: number;
  dirX?: number;
  dirZ?: number;
  headshot?: boolean;
  armorPen?: number; // flat armor ignored
  tags?: string[];
}

export interface Defender {
  hp: number;
  maxHp: number;
  armor: number;
  physRes: number;
  magicRes: number;
  statusRes: StatusResist;
  status: StatusSet;
  isBoss?: boolean;
  vulnerable?: number; // extra damage taken multiplier
}

export interface HitResult {
  amount: number;
  crit: boolean;
  superCrit: boolean;
  applied: StatusId[];
  combos: ComboId[];
  steps: { label: string; value: string }[];
}

export function resolveHit(att: StatSheet | null, hit: Hit, def: Defender, attackerSpeed = 0, verbose = false): HitResult {
  const steps: { label: string; value: string }[] = [];
  let dmg = hit.base;
  if (verbose) steps.push({ label: 'Base', value: dmg.toFixed(1) });
  if (att) {
    const scale =
      hit.source === 'gun' || hit.source === 'projectile'
        ? att.get('gunDmg')
        : hit.source === 'melee' || hit.source === 'board' || hit.source === 'counter' || hit.source === 'grapple'
          ? att.get('meleeDmg')
          : hit.source === 'scorpion' || hit.source === 'swarm' || hit.source === 'divine' || hit.source === 'ult' || hit.source === 'poison' || hit.source === 'curse'
            ? att.get('magicDmg')
            : hit.source === 'explosion'
              ? (att.get('gunDmg') + att.get('magicDmg')) / 2
              : 1;
    dmg *= scale;
    if (verbose) steps.push({ label: 'Power scaling', value: `×${scale.toFixed(2)}` });
    // momentum: speed turns into damage
    if (attackerSpeed > 10 && hit.source !== 'poison' && hit.source !== 'bleed' && hit.source !== 'burn') {
      const m = 1 + ((attackerSpeed - 10) / 2) * att.get('speedDamage');
      dmg *= m;
      if (verbose) steps.push({ label: `Momentum (${attackerSpeed.toFixed(0)} m/s)`, value: `×${m.toFixed(2)}` });
    }
  }
  if (hit.mult && hit.mult !== 1) {
    dmg *= hit.mult;
    if (verbose) steps.push({ label: 'Attack modifier', value: `×${hit.mult.toFixed(2)}` });
  }
  if (hit.headshot) {
    dmg *= 1.6;
    if (verbose) steps.push({ label: 'Headshot', value: '×1.60' });
  }
  // crit
  let crit = false, superCrit = false;
  if (hit.canCrit !== false && att && (hit.kind !== 'true' || hit.forceCrit)) {
    const cc = att.get('critChance') + (hit.critBonus ?? 0);
    crit = hit.forceCrit || rnd.next() < cc;
    if (def.status.shatterReady && (hit.source === 'gun' || hit.source === 'melee' || hit.source === 'counter')) {
      crit = true;
      superCrit = true;
      def.status.shatterReady = false;
    }
    if (crit) {
      const cd = att.get('critDmg') + (superCrit ? 1 : 0);
      dmg *= cd;
      if (verbose) steps.push({ label: superCrit ? 'SHATTER crit' : 'Critical', value: `×${cd.toFixed(2)}` });
    }
  }
  // curse + vulnerability
  const cm = def.status.curseMul() * (def.vulnerable ?? 1);
  if (cm !== 1) {
    dmg *= cm;
    if (verbose) steps.push({ label: 'Curse / vulnerable', value: `×${cm.toFixed(2)}` });
  }
  // mitigation
  if (hit.kind === 'phys') {
    const armor = Math.max(0, def.armor * def.status.armorMul() - (hit.armorPen ?? 0));
    const am = 100 / (100 + armor);
    dmg *= am * (1 - def.physRes);
    if (verbose) steps.push({ label: `Armor ${armor.toFixed(0)} / resist`, value: `×${(am * (1 - def.physRes)).toFixed(2)}` });
  } else if (hit.kind === 'magic') {
    dmg *= 1 - def.magicRes;
    if (verbose) steps.push({ label: 'Magic resist', value: `×${(1 - def.magicRes).toFixed(2)}` });
  }
  dmg = Math.max(hit.base > 0 ? 1 : 0, dmg);
  // statuses
  const applied: StatusId[] = [];
  const combos: ComboId[] = [];
  if (hit.status) {
    const sc = att ? att.get('statusChance') : 0;
    const pot = att ? att.get('statusPower') : 1;
    for (const s of hit.status) {
      const ch = (s.chance ?? 1) + sc;
      if (rnd.next() > ch) continue;
      const cap = s.id === 'poison' && att ? att.get('poisonStacks') : s.id === 'curse' ? 15 : s.id === 'bleed' ? 12 : 99;
      const combo = def.status.apply(s.id, s.stacks, s.dur * (s.id === 'stun' ? 1 : Math.sqrt(pot)), (s.power ?? 1) * pot, cap, def.statusRes);
      applied.push(s.id);
      if (combo) combos.push(combo);
    }
    if (def.status.stacks('poison') > 0 && def.status.stacks('curse') > 0) combos.push('plague');
  }
  return { amount: dmg, crit, superCrit, applied, combos, steps };
}

/** DOOM threshold check for curse */
export function doomCheck(def: Defender) {
  return def.status.stacks('curse') >= 15;
}
