// Stat system: 5 core stats + Luck, derived stats with transparent math.
// value = (base + derivedFromCore + Σflat) × (1 + Σpct) × Πmult, then clamped.
// breakdown() returns every contributing source for the ledger UI.

export type CoreStat = 'vit' | 'def' | 'phys' | 'magic' | 'mob' | 'luck';
export type DerivedStat =
  | 'maxHp' | 'regen' | 'armor' | 'physRes' | 'magicRes'
  | 'gunDmg' | 'meleeDmg' | 'magicDmg' | 'statusPower' | 'statusChance'
  | 'critChance' | 'critDmg' | 'fireRate' | 'reloadSpeed' | 'ammo' | 'spread' | 'pierce' | 'projectiles'
  | 'moveSpeed' | 'accel' | 'jump' | 'boostRegen' | 'dodge'
  | 'pickupRange' | 'bountyGain' | 'goldGain' | 'ultCharge' | 'cdr' | 'lifesteal'
  | 'poisonStacks' | 'scorpions' | 'swarmSize' | 'explosionRadius' | 'knockback' | 'thorns' | 'speedDamage'
  | 'rarity' | 'shield';
export type StatId = CoreStat | DerivedStat;

export const CORE_INFO: Record<CoreStat, { name: string; short: string; color: string; desc: string }> = {
  vit: { name: 'Vitality', short: 'VIT', color: '#e0402c', desc: 'Max health and regeneration.' },
  def: { name: 'Defense', short: 'DEF', color: '#9fd2ff', desc: 'Armor, physical resistance and magic resistance.' },
  phys: { name: 'Physical Power', short: 'PHY', color: '#f5c84a', desc: 'Gun and melee damage, knockback.' },
  magic: { name: 'Magic Power', short: 'MAG', color: '#9dff3a', desc: 'Divine abilities, status potency and chance.' },
  mob: { name: 'Mobility', short: 'MOB', color: '#6fe3cf', desc: 'Speed, acceleration, boost and jump.' },
  luck: { name: 'Luck', short: 'LCK', color: '#c77df0', desc: 'Crit chance, rarer upgrades, drops and gold.' },
};

export const DERIVED_INFO: Partial<Record<DerivedStat, { name: string; fmt: 'int' | 'pct' | 'x' | 'f1' | 'f2'; formula: string }>> = {
  maxHp: { name: 'Max Health', fmt: 'int', formula: '80 + 14·VIT' },
  regen: { name: 'Regeneration /s', fmt: 'f2', formula: '0.15·VIT' },
  armor: { name: 'Armor', fmt: 'int', formula: '6·DEF  → phys taken × 100/(100+Armor)' },
  physRes: { name: 'Physical Resist', fmt: 'pct', formula: '0.8%·DEF (cap 60%)' },
  magicRes: { name: 'Magic Resist', fmt: 'pct', formula: '1.2%·DEF (cap 70%)' },
  gunDmg: { name: 'Gun Damage', fmt: 'x', formula: '1 + 6%·PHY' },
  meleeDmg: { name: 'Melee Damage', fmt: 'x', formula: '1 + 8%·PHY' },
  magicDmg: { name: 'Divine Damage', fmt: 'x', formula: '1 + 7%·MAG' },
  statusPower: { name: 'Status Potency', fmt: 'x', formula: '1 + 5%·MAG' },
  statusChance: { name: 'Status Chance', fmt: 'pct', formula: '+1%·MAG' },
  critChance: { name: 'Crit Chance', fmt: 'pct', formula: '5% + 1%·LCK' },
  critDmg: { name: 'Crit Damage', fmt: 'x', formula: '1.75 + 1%·LCK' },
  fireRate: { name: 'Fire Rate', fmt: 'x', formula: '1' },
  reloadSpeed: { name: 'Reload Speed', fmt: 'x', formula: '1 + 2%·MOB' },
  ammo: { name: 'Cylinder Size', fmt: 'int', formula: '6' },
  moveSpeed: { name: 'Push Speed', fmt: 'x', formula: '1 + 3%·MOB' },
  accel: { name: 'Acceleration', fmt: 'x', formula: '1 + 4%·MOB' },
  jump: { name: 'Jump Power', fmt: 'x', formula: '1 + 2%·MOB' },
  boostRegen: { name: 'Boost Regen', fmt: 'x', formula: '1 + 5%·MOB' },
  dodge: { name: 'Dodge Chance', fmt: 'pct', formula: '0.5%·MOB (cap 40%)' },
  pickupRange: { name: 'Pickup Range', fmt: 'f1', formula: '4 m' },
  bountyGain: { name: 'Bounty Gain', fmt: 'x', formula: '1' },
  goldGain: { name: 'Gold Gain', fmt: 'x', formula: '1 + 2%·LCK' },
  ultCharge: { name: 'Ultimate Charge', fmt: 'x', formula: '1' },
  cdr: { name: 'Cooldown Reduction', fmt: 'pct', formula: '0 (cap 60%)' },
  lifesteal: { name: 'Lifesteal', fmt: 'pct', formula: '0' },
  poisonStacks: { name: 'Max Poison Stacks', fmt: 'int', formula: '30' },
  scorpions: { name: 'Scorpions', fmt: 'int', formula: '1' },
  swarmSize: { name: 'Swarm Size', fmt: 'x', formula: '1 + 3%·MAG' },
  explosionRadius: { name: 'Blast Radius', fmt: 'x', formula: '1' },
  speedDamage: { name: 'Momentum Damage', fmt: 'pct', formula: '+1% per 2 m/s above 10' },
  rarity: { name: 'Rarity Luck', fmt: 'x', formula: '1 + 3%·LCK' },
  pierce: { name: 'Pierce', fmt: 'int', formula: '0' },
  projectiles: { name: 'Projectiles', fmt: 'int', formula: '1' },
  thorns: { name: 'Thorns', fmt: 'int', formula: '0' },
  knockback: { name: 'Knockback', fmt: 'x', formula: '1 + 2%·PHY' },
  spread: { name: 'Spread', fmt: 'x', formula: '1' },
  shield: { name: 'Max Shield', fmt: 'int', formula: '0' },
};

export interface Modifier {
  stat: StatId;
  type: 'flat' | 'pct' | 'mult';
  value: number;
  source: string;
}

const CAPS: Partial<Record<StatId, [number, number]>> = {
  physRes: [0, 0.6],
  magicRes: [0, 0.7],
  critChance: [0, 1],
  dodge: [0, 0.4],
  cdr: [0, 0.6],
  lifesteal: [0, 0.35],
  fireRate: [0.2, 6],
  spread: [0.05, 5],
};

export class StatSheet {
  core: Record<CoreStat, number>;
  mods: Modifier[] = [];
  private cache = new Map<StatId, number>();
  version = 0;

  constructor(core: Partial<Record<CoreStat, number>> = {}) {
    this.core = { vit: 5, def: 3, phys: 5, magic: 5, mob: 5, luck: 0, ...core };
  }

  add(m: Modifier | Modifier[]) {
    if (Array.isArray(m)) this.mods.push(...m);
    else this.mods.push(m);
    this.cache.clear();
    this.version++;
  }
  removeSource(source: string) {
    this.mods = this.mods.filter((m) => m.source !== source);
    this.cache.clear();
    this.version++;
  }

  /** core stat incl. flat/pct mods */
  coreVal(c: CoreStat) {
    let flat = 0, pct = 0, mult = 1;
    for (const m of this.mods) {
      if (m.stat !== c) continue;
      if (m.type === 'flat') flat += m.value;
      else if (m.type === 'pct') pct += m.value;
      else mult *= m.value;
    }
    return Math.max(0, (this.core[c] + flat) * (1 + pct) * mult);
  }

  /** base contribution of a derived stat from core stats */
  private derivedBase(s: DerivedStat): number {
    const V = (c: CoreStat) => this.coreVal(c);
    switch (s) {
      case 'maxHp': return 80 + 14 * V('vit');
      case 'regen': return 0.15 * V('vit');
      case 'armor': return 6 * V('def');
      case 'physRes': return 0.008 * V('def');
      case 'magicRes': return 0.012 * V('def');
      case 'gunDmg': return 1 + 0.06 * V('phys');
      case 'meleeDmg': return 1 + 0.08 * V('phys');
      case 'magicDmg': return 1 + 0.07 * V('magic');
      case 'statusPower': return 1 + 0.05 * V('magic');
      case 'statusChance': return 0.01 * V('magic');
      case 'critChance': return 0.05 + 0.01 * V('luck');
      case 'critDmg': return 1.75 + 0.01 * V('luck');
      case 'fireRate': return 1;
      case 'reloadSpeed': return 1 + 0.02 * V('mob');
      case 'ammo': return 6;
      case 'moveSpeed': return 1 + 0.03 * V('mob');
      case 'accel': return 1 + 0.04 * V('mob');
      case 'jump': return 1 + 0.02 * V('mob');
      case 'boostRegen': return 1 + 0.05 * V('mob');
      case 'dodge': return 0.005 * V('mob');
      case 'pickupRange': return 4;
      case 'bountyGain': return 1;
      case 'goldGain': return 1 + 0.02 * V('luck');
      case 'ultCharge': return 1;
      case 'cdr': return 0;
      case 'lifesteal': return 0;
      case 'poisonStacks': return 30;
      case 'scorpions': return 1;
      case 'swarmSize': return 1 + 0.03 * V('magic');
      case 'explosionRadius': return 1;
      case 'speedDamage': return 0.005;
      case 'rarity': return 1 + 0.03 * V('luck');
      case 'pierce': return 0;
      case 'projectiles': return 1;
      case 'thorns': return 0;
      case 'knockback': return 1 + 0.02 * V('phys');
      case 'spread': return 1;
      case 'shield': return 0;
    }
  }

  get(s: StatId): number {
    const hit = this.cache.get(s);
    if (hit !== undefined) return hit;
    let v: number;
    if (s in this.core) v = this.coreVal(s as CoreStat);
    else {
      let flat = 0, pct = 0, mult = 1;
      for (const m of this.mods) {
        if (m.stat !== s) continue;
        if (m.type === 'flat') flat += m.value;
        else if (m.type === 'pct') pct += m.value;
        else mult *= m.value;
      }
      v = (this.derivedBase(s as DerivedStat) + flat) * (1 + pct) * mult;
      const cap = CAPS[s];
      if (cap) v = Math.max(cap[0], Math.min(cap[1], v));
    }
    this.cache.set(s, v);
    return v;
  }

  breakdown(s: StatId) {
    const isCore = s in this.core;
    const base = isCore ? this.core[s as CoreStat] : this.derivedBase(s as DerivedStat);
    const rows = this.mods.filter((m) => m.stat === s);
    return {
      stat: s,
      base,
      formula: isCore ? 'base' : DERIVED_INFO[s as DerivedStat]?.formula ?? '',
      flats: rows.filter((r) => r.type === 'flat'),
      pcts: rows.filter((r) => r.type === 'pct'),
      mults: rows.filter((r) => r.type === 'mult'),
      total: this.get(s),
      cap: CAPS[s],
    };
  }

  clone() {
    const c = new StatSheet({ ...this.core });
    c.mods = this.mods.slice();
    return c;
  }
}

export function fmtStat(s: StatId, v: number) {
  const f = (DERIVED_INFO as any)[s]?.fmt ?? 'int';
  if (f === 'pct') return `${(v * 100).toFixed(1)}%`;
  if (f === 'x') return `×${v.toFixed(2)}`;
  if (f === 'f1') return v.toFixed(1);
  if (f === 'f2') return v.toFixed(2);
  return String(Math.round(v));
}
