// Upgrade pool: gun mods, insect powers, stat passives, gear (visible on
// Sundown), god relics with unique effects, and hidden EVOLUTIONS when two
// maxed upgrades meet. Effects are event-driven (see UpgradeEffects).
// A hunt starts with only the pistol: the three tarot skills are learned from
// `learn` cards, and every rank-up roll guarantees one until all three are known.
// Many cards are TRADE-OFFS (green pros, red cons) and some are GAMBLES (a dice,
// coin or revolver-chamber spin decides the outcome at the pick; UpgradesExtra).
import * as THREE from 'three';
import type { Modifier, StatSheet, StatId } from '../combat/Stats';
import { DERIVED_INFO, CORE_INFO } from '../combat/Stats';
import type { Ctx } from '../Ctx';
import { rnd } from '../../engine/math/rand';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type UpCat = 'gun' | 'insect' | 'passive' | 'gear' | 'relic' | 'evolution' | 'gamble';

export interface RarityInfo {
  name: string;
  color: string;
  hex: number;
  weight: number;
  /** 0 common … 5 mythic */
  rank: number;
  /** the banner ribbon across the card: cloth base / shade / highlight, edge thread, lettering ink */
  ribbon: { base: number; shade: number; hi: number; thread: number; ink: string };
  /** the glow around the frame and the motes it sheds (mythic cycles through the spectrum) */
  glow: number;
  /** multiplies the frame's sculpted metal: worn bronze, polished bronze, silver, rose gold, gold, white gold */
  metal: [number, number, number];
}

/** the rarity ladder, bottom to top */
export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

export const RARITY: Record<Rarity, RarityInfo> = {
  common: { name: 'Common', color: '#d8c8a8', hex: 0xd8c8a8, weight: 60, rank: 0, ribbon: { base: 0xcdbf9e, shade: 0x9a8a6a, hi: 0xece0c2, thread: 0x6e4a2a, ink: '#3a2414' }, glow: 0xe8dcc0, metal: [0.74, 0.68, 0.62] },
  uncommon: { name: 'Uncommon', color: '#8fc45a', hex: 0x8fc45a, weight: 26, rank: 1, ribbon: { base: 0x3e7c2c, shade: 0x27521b, hi: 0x6aa846, thread: 0xe0a85a, ink: '#f6efcf' }, glow: 0x8fff5a, metal: [1.1, 0.94, 0.8] },
  rare: { name: 'Rare', color: '#4fb3c9', hex: 0x4fb3c9, weight: 10, rank: 2, ribbon: { base: 0x235a9e, shade: 0x163a6a, hi: 0x4c88cc, thread: 0xe4eaf6, ink: '#f3f7ff' }, glow: 0x5ac8ff, metal: [0.98, 1.0, 1.06] },
  epic: { name: 'Epic', color: '#d0603a', hex: 0xd0603a, weight: 3.5, rank: 3, ribbon: { base: 0x9c2416, shade: 0x641208, hi: 0xcc4a36, thread: 0xf2c252, ink: '#ffeab8' }, glow: 0xff5a2e, metal: [1.1, 0.8, 0.72] },
  legendary: { name: 'Legendary', color: '#f5c84a', hex: 0xf5c84a, weight: 1, rank: 4, ribbon: { base: 0xe2aa38, shade: 0xa8761c, hi: 0xffe28c, thread: 0x4a2a6a, ink: '#3a1a06' }, glow: 0xffd040, metal: [1.14, 1.02, 0.76] },
  mythic: { name: 'Mythic', color: '#fff3d6', hex: 0xfff3d6, weight: 0, rank: 5, ribbon: { base: 0xf6efe0, shade: 0xd6c6a6, hi: 0xffffff, thread: 0x46c8b8, ink: '#6e4a08' }, glow: 0xffffff, metal: [1.08, 1.08, 1.08] },
};

type M = Omit<Modifier, 'source'>;

/** the prop a gamble is played with */
export type GambleKind = 'bones' | 'double' | 'snake' | 'deadman' | 'coin' | 'roulette';

export interface UpgradeDef {
  id: string;
  name: string;
  cat: UpCat;
  rarity: Rarity;
  maxLv: number;
  icon: string;
  desc: (lv: number) => string;
  mods?: (lv: number) => M[];
  attach?: string;
  evolveFrom?: [string, string];
  lore?: string;
  god?: string;
  /** learning card: taking it unseals this tarot skill (Skills.learn) */
  learn?: 'E' | 'C' | 'G';
  /** only offered once this upgrade has been taken (e.g. Brood Mother needs Scorpion Toss) */
  needs?: string;
  /** what you win: exact numbers at this level (green rows on the card and the ledger) */
  pros?: (lv: number) => string[];
  /** what it costs you: exact numbers at this level (red rows) */
  cons?: (lv: number) => string[];
  /** a cursed bargain (a big win, a real price) */
  curse?: boolean;
  /** a gamble: picking it plays a dice / coin / chamber spin that decides the outcome */
  gamble?: GambleKind;
  /** the odds, in words ("1 in 6 to lose") */
  odds?: (lv: number) => string;
  /** how it grows per level, when the stat modifiers alone don't say it */
  per?: string;
  /** offer weight multiplier (trade-offs default to 1.5) */
  weight?: number;
}

/** a card that pays and costs (trade-offs and curses; gambles are their own kind) */
export const isTrade = (d: UpgradeDef) => !d.gamble && (!!d.cons || !!d.curse);

/** the card's kind label: GAMBLE, CURSED, TRADE-OFF, or its category */
export function kindLabel(d: UpgradeDef) {
  if (d.learn) return 'TAROT SKILL';
  if (d.gamble) return 'GAMBLE';
  if (d.curse) return 'CURSED';
  if (d.cons) return 'TRADE-OFF';
  return ({ gun: 'IRON', insect: 'BROOD', passive: 'GRIT', gear: 'GEAR', relic: 'RELIC', evolution: 'EVOLUTION', gamble: 'GAMBLE' } as Record<string, string>)[d.cat] ?? '';
}

// ------------------------------------------------------------------ plain-words stat text

const PCT_FLAT = new Set<string>(['critChance', 'critDmg', 'physRes', 'magicRes', 'lifesteal', 'dodge', 'cdr', 'statusChance', 'speedDamage']);
const LOWER_IS_BETTER = new Set<string>(['spread']);

/** a stat's name in a sentence */
export function statName(s: StatId) {
  return ((DERIVED_INFO as any)[s]?.name ?? (CORE_INFO as any)[s]?.name ?? s) as string;
}

/** a modifier in words: "+12% Fire Rate", "+3 Defense", "−1 Cylinder Size" */
export function modText(m: { stat: StatId; type: 'flat' | 'pct' | 'mult'; value: number }) {
  const v = m.value;
  const sign = v >= 0 ? '+' : '−';
  const a = Math.abs(v);
  const nm = statName(m.stat);
  if (m.type === 'mult') return v === 0 ? `No ${nm}` : `×${+v.toFixed(2)} ${nm}`;
  if (m.type === 'pct') return `${sign}${+(a * 100).toFixed(1)}% ${nm}`;
  if (PCT_FLAT.has(m.stat)) return `${sign}${+(a * 100).toFixed(1)}% ${nm}`;
  return `${sign}${+a.toFixed(2)} ${nm}`;
}

/** does this modifier help? (spread is better smaller) */
export const modHelps = (m: { stat: StatId; type: string; value: number }) => (m.type === 'mult' ? m.value >= 1 : m.value >= 0) !== LOWER_IS_BETTER.has(m.stat);

/** "each level: +12% Fire Rate, +10% Crit Damage" (from the modifiers, or the def's own words) */
export function perLevelText(d: UpgradeDef) {
  if (d.per) return d.per;
  if (d.maxLv <= 1 || !d.mods) return '';
  const a = d.mods(1), b = d.mods(2);
  const parts: string[] = [];
  for (let i = 0; i < b.length; i++) {
    const p = a.find((m) => m.stat === b[i].stat && m.type === b[i].type);
    const dv = b[i].value - (p?.value ?? 0);
    if (Math.abs(dv) > 1e-9 && b[i].type !== 'mult') parts.push(modText({ stat: b[i].stat, type: b[i].type, value: dv }));
  }
  return parts.join(', ');
}

/** green and red rows for a card at a level (explicit pros/cons, else the stat modifiers split by sign) */
export function prosCons(d: UpgradeDef, lv: number) {
  const l = Math.max(1, lv);
  if (d.pros || d.cons) return { pros: d.pros?.(l) ?? [], cons: d.cons?.(l) ?? [] };
  const pros: string[] = [], cons: string[] = [];
  for (const m of d.mods?.(l) ?? []) (modHelps(m) ? pros : cons).push(modText(m));
  return { pros, cons };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const UPGRADES: UpgradeDef[] = [
  // ------------------------------------------------------------- the tarot skills (sealed at the start of a hunt)
  { id: 'learnScorpionToss', name: 'The Magician', cat: 'insect', rarity: 'rare', maxLv: 1, icon: 'scorp', god: 'Serket', learn: 'E', desc: () => 'LEARN SCORPION TOSS  [E]: hurl a brood of venomous scorpions that hunt down and sting whatever they land near.', lore: 'Serket keeps a few spare scorpions up her sleeve. Now so do you.' },
  { id: 'learnLocustSwarm', name: 'The Tower', cat: 'insect', rarity: 'rare', maxLv: 1, icon: 'scarab', god: 'Khepri', learn: 'C', desc: () => 'LEARN SCARAB SWARM  [C]: whistle, and a carpet of scarabs boils out of the sand and eats whatever you were looking at.', lore: 'Khepri rolls the sun. His children roll everything else.' },
  { id: 'learnDungBomb', name: 'The Sun', cat: 'insect', rarity: 'rare', maxLv: 1, icon: 'dung', god: 'Khepri', learn: 'G', desc: () => 'LEARN DUNG BOMB  [G]: lob a bouncing ball of sacred dung that bursts into a poison stink cloud. Two charges.', lore: 'Khepri rolls the sun across the sky. You roll something else.' },
  // ------------------------------------------------------------- gun
  { id: 'venomRounds', name: 'Venom Rounds', cat: 'gun', rarity: 'common', maxLv: 5, icon: 'bubble', god: 'Serket', desc: (l) => `Bullets apply +${l} extra poison stack${l > 1 ? 's' : ''}. Poison +${l * 8}% potency.`, mods: (l) => [{ stat: 'statusPower', type: 'pct', value: l * 0.08 }], lore: 'Pinch milks the venom himself. Do not ask how.' },
  { id: 'quickdraw', name: 'Quickdraw', cat: 'gun', rarity: 'common', maxLv: 5, icon: 'bullet', desc: (l) => `Fire rate +${l * 12}%.`, mods: (l) => [{ stat: 'fireRate', type: 'pct', value: l * 0.12 }] },
  { id: 'extraChamber', name: 'Extra Chamber', cat: 'gun', rarity: 'uncommon', maxLv: 4, icon: 'cylinder', desc: (l) => `Cylinder holds ${6 + l} rounds.`, mods: (l) => [{ stat: 'ammo', type: 'flat', value: l }] },
  { id: 'hollowPoints', name: 'Hollow Points', cat: 'gun', rarity: 'common', maxLv: 5, icon: 'bullet', desc: (l) => `Gun damage +${l * 14}%, crit damage +${l * 10}%.`, mods: (l) => [{ stat: 'gunDmg', type: 'pct', value: l * 0.14 }, { stat: 'critDmg', type: 'flat', value: l * 0.1 }] },
  { id: 'ricochet', name: 'Ricochet Rounds', cat: 'gun', rarity: 'rare', maxLv: 3, icon: 'spark', desc: (l) => `Hits bounce to ${l} nearby enem${l > 1 ? 'ies' : 'y'} for 60% damage.` },
  { id: 'piercing', name: 'Piercing Lead', cat: 'gun', rarity: 'uncommon', maxLv: 3, icon: 'streak', desc: (l) => `Bullets pierce ${l} extra target${l > 1 ? 's' : ''}.`, mods: (l) => [{ stat: 'pierce', type: 'flat', value: l }] },
  { id: 'deadeye', name: 'Deadeye', cat: 'gun', rarity: 'rare', maxLv: 3, icon: 'eye', god: 'Horus', desc: (l) => `Headshots +${l * 25}% damage. Aiming mid-air slows time.` },
  { id: 'speedLoader', name: 'Speed Loader', cat: 'gun', rarity: 'common', maxLv: 4, icon: 'cylinder', desc: (l) => `Reload speed +${l * 20}%.`, mods: (l) => [{ stat: 'reloadSpeed', type: 'pct', value: l * 0.2 }] },
  { id: 'steadyHand', name: 'Steady Hand', cat: 'gun', rarity: 'common', maxLv: 3, icon: 'dot4', desc: (l) => `Spread −${l * 18}%, crit chance +${l * 3}%.`, mods: (l) => [{ stat: 'spread', type: 'pct', value: -l * 0.18 }, { stat: 'critChance', type: 'flat', value: l * 0.03 }] },
  // ------------------------------------------------------------- insects
  { id: 'broodMother', needs: 'learnScorpionToss', name: 'Brood Mother', cat: 'insect', rarity: 'uncommon', maxLv: 4, icon: 'scorp', god: 'Serket', desc: (l) => `Scorpion Toss throws ${l} more scorpion${l > 1 ? 's' : ''}; they sting harder.`, mods: (l) => [{ stat: 'scorpions', type: 'flat', value: l }, { stat: 'magicDmg', type: 'pct', value: l * 0.05 }] },
  { id: 'locustCloud', needs: 'learnLocustSwarm', name: 'Scarab Horde', cat: 'insect', rarity: 'uncommon', maxLv: 4, icon: 'scarab', god: 'Khepri', desc: (l) => `Scarab swarm +${l * 25}% bigger and feeds longer.`, mods: (l) => [{ stat: 'swarmSize', type: 'pct', value: l * 0.25 }] },
  { id: 'dungEngineer', needs: 'learnDungBomb', name: 'Dung Engineer', cat: 'insect', rarity: 'common', maxLv: 4, icon: 'dung', god: 'Khepri', desc: (l) => `Dung Bomb radius +${l * 18}%, damage +${l * 15}%.`, mods: (l) => [{ stat: 'explosionRadius', type: 'pct', value: l * 0.18 }] },
  { id: 'pinchTraining', name: "Pinch's Training", cat: 'insect', rarity: 'uncommon', maxLv: 4, icon: 'scorp_x2', desc: (l) => `Pinch attacks ${l * 20}% faster and stings for more poison.`, mods: (l) => [{ stat: 'magic', type: 'flat', value: l }] },
  { id: 'scarabShield', name: 'Scarab Shield', cat: 'insect', rarity: 'rare', maxLv: 3, icon: 'scarab', god: 'Khepri', desc: (l) => `${l + 1} armored scarabs orbit you and block bullets.`, attach: 'scarab_pauldron' },
  { id: 'fireAnts', name: 'Fire Ants', cat: 'insect', rarity: 'rare', maxLv: 2, icon: 'flame1', desc: (l) => `Insect attacks have ${l * 30}% chance to ignite (burn).` },
  // ------------------------------------------------------------- passives
  { id: 'ironRibs', name: 'Iron Ribs', cat: 'passive', rarity: 'common', maxLv: 5, icon: 'shield', desc: (l) => `+${l * 3} Defense.`, mods: (l) => [{ stat: 'def', type: 'flat', value: l * 3 }] },
  { id: 'desertHeart', name: 'Desert Heart', cat: 'passive', rarity: 'common', maxLv: 5, icon: 'heart', desc: (l) => `+${l * 3} Vitality.`, mods: (l) => [{ stat: 'vit', type: 'flat', value: l * 3 }] },
  { id: 'grit', name: "Gunslinger's Grit", cat: 'passive', rarity: 'common', maxLv: 5, icon: 'bullet', desc: (l) => `+${l * 3} Physical Power.`, mods: (l) => [{ stat: 'phys', type: 'flat', value: l * 3 }] },
  { id: 'serketBlessing', name: "Serket's Blessing", cat: 'passive', rarity: 'common', maxLv: 5, icon: 'ankh', god: 'Serket', desc: (l) => `+${l * 3} Magic Power.`, mods: (l) => [{ stat: 'magic', type: 'flat', value: l * 3 }] },
  { id: 'tumbleweedLegs', name: 'Tumbleweed Legs', cat: 'passive', rarity: 'common', maxLv: 5, icon: 'twig', desc: (l) => `+${l * 3} Mobility.`, mods: (l) => [{ stat: 'mob', type: 'flat', value: l * 3 }] },
  { id: 'horseshoe', name: 'Lucky Horseshoe', cat: 'passive', rarity: 'uncommon', maxLv: 5, icon: 'coin', desc: (l) => `+${l * 3} Luck.`, mods: (l) => [{ stat: 'luck', type: 'flat', value: l * 3 }] },
  { id: 'batSpurs', name: 'Vampire Bat Spurs', cat: 'passive', rarity: 'rare', maxLv: 3, icon: 'blood0', desc: (l) => `Lifesteal ${l * 2}%.`, mods: (l) => [{ stat: 'lifesteal', type: 'flat', value: l * 0.02 }] },
  { id: 'momentum', name: 'Momentum', cat: 'passive', rarity: 'uncommon', maxLv: 4, icon: 'speedline', desc: (l) => `+${l * 0.5}% damage per 2 m/s above 10 m/s.`, mods: (l) => [{ stat: 'speedDamage', type: 'flat', value: l * 0.005 }] },
  { id: 'license', name: "Bounty Hunter's License", cat: 'passive', rarity: 'uncommon', maxLv: 3, icon: 'sheriff', desc: (l) => `Bounty gained +${l * 15}%.`, mods: (l) => [{ stat: 'bountyGain', type: 'pct', value: l * 0.15 }] },
  { id: 'goldTooth', name: 'Gold Tooth', cat: 'passive', rarity: 'uncommon', maxLv: 3, icon: 'coin', desc: (l) => `Gold +${l * 20}%. Shiny smile.`, mods: (l) => [{ stat: 'goldGain', type: 'pct', value: l * 0.2 }] },
  { id: 'rodeoStar', name: 'Rodeo Star', cat: 'passive', rarity: 'uncommon', maxLv: 3, icon: 'star4', desc: (l) => `Tricks charge ultimate & boost ${l * 40}% more. Airborne shots +${l * 10}% damage.` },
  { id: 'driftKing', name: 'Drift King', cat: 'passive', rarity: 'uncommon', maxLv: 3, icon: 'puff0', desc: (l) => `Drift boosts are ${l * 30}% stronger and blast sand at enemies.` },
  // ------------------------------------------------------------- gear (visible)
  { id: 'scarabPauldron', name: 'Scarab Pauldron', cat: 'gear', rarity: 'uncommon', maxLv: 3, icon: 'scarab', desc: (l) => `Armor +${l * 15}, physical resist +${l * 3}%.`, mods: (l) => [{ stat: 'armor', type: 'flat', value: l * 15 }, { stat: 'physRes', type: 'flat', value: l * 0.03 }], attach: 'scarab_pauldron' },
  { id: 'bandolier', name: 'Locust Bandolier', cat: 'gear', rarity: 'uncommon', maxLv: 3, icon: 'bullet', desc: (l) => `+${l} ammo, reload +${l * 10}%.`, mods: (l) => [{ stat: 'ammo', type: 'flat', value: l }, { stat: 'reloadSpeed', type: 'pct', value: l * 0.1 }], attach: 'locust_bandolier' },
  { id: 'venomTank', name: 'Venom Tank', cat: 'gear', rarity: 'rare', maxLv: 3, icon: 'bubble', god: 'Serket', desc: (l) => `Max poison stacks +${l * 15}.`, mods: (l) => [{ stat: 'poisonStacks', type: 'flat', value: l * 15 }], attach: 'venom_tank' },
  { id: 'sheriffStar', name: "Dead Sheriff's Star", cat: 'gear', rarity: 'rare', maxLv: 2, icon: 'sheriff', desc: (l) => `Counters heal ${l * 6}% and reflect bullets ×${1 + l}.`, attach: 'sheriff_star' },
  { id: 'dynamiteBelt', name: 'Dynamite Belt', cat: 'gear', rarity: 'uncommon', maxLv: 3, icon: 'bolt', desc: (l) => `Taking a hit has ${l * 10}% chance to drop a lit stick of dynamite.`, attach: 'dynamite_belt' },
  // ------------------------------------------------------------- relics (gods)
  { id: 'eyeOfHorus', name: 'Eye of Horus', cat: 'relic', rarity: 'epic', maxLv: 1, icon: 'eye', god: 'Horus', desc: () => 'Crits mark enemies: marked targets take +25% damage.' },
  { id: 'sunDisk', name: "Ra's Sun Disk", cat: 'relic', rarity: 'legendary', maxLv: 1, icon: 'coin', god: 'Ra', desc: () => 'Every 8th shot fires a searing sun beam that burns everything in a line.', attach: 'sun_disk' },
  { id: 'anubisScale', name: "Anubis' Scale", cat: 'relic', rarity: 'epic', maxLv: 1, icon: 'ankh', god: 'Anubis', desc: () => 'Kills heal 1% health; at full health they grant shield instead.' },
  { id: 'thothLedger', name: "Thoth's Ledger", cat: 'relic', rarity: 'epic', maxLv: 1, icon: 'glyph0', god: 'Thoth', desc: () => '+30% bounty. Weak points crit more (+15% crit chance on headshots).', mods: () => [{ stat: 'bountyGain', type: 'pct', value: 0.3 }] },
  { id: 'sekhmetClaw', name: "Sekhmet's Claw", cat: 'relic', rarity: 'epic', maxLv: 1, icon: 'flame2', god: 'Sekhmet', desc: () => 'Burning enemies spread fire on death. Melee ignites.' },
  { id: 'dungCrown', needs: 'learnDungBomb', name: "Khepri's Dung Crown", cat: 'relic', rarity: 'legendary', maxLv: 1, icon: 'dung', god: 'Khepri', desc: () => 'Dung Bombs split into 3 smaller bombs on explosion. Glorious.' },
  { id: 'moonCharm', name: "Khonsu's Moon Charm", cat: 'relic', rarity: 'epic', maxLv: 1, icon: 'star4', god: 'Khonsu', desc: () => 'Big air (1 s+) slows time while airborne. +10% crit while airborne.' },
  { id: 'bastetBell', name: "Bastet's Bell", cat: 'relic', rarity: 'epic', maxLv: 1, icon: 'charm', god: 'Bastet', desc: () => 'Counters are easier and heal 8%. Pinch purrs. (He is a scorpion.)' },
  // ------------------------------------------------------------- evolutions
  { id: 'serketsKiss', name: "Serket's Kiss", cat: 'evolution', rarity: 'mythic', maxLv: 1, icon: 'venomSplat', god: 'Serket', evolveFrom: ['venomRounds', 'serketBlessing'], desc: () => 'EVOLUTION: enemies reaching 25 poison stacks erupt in a venom nova (stacks ×12 damage).' },
  { id: 'broodQueen', name: 'Queen of the Brood', cat: 'evolution', rarity: 'mythic', maxLv: 1, icon: 'scorp_x2', evolveFrom: ['broodMother', 'pinchTraining'], desc: () => 'EVOLUTION: Pinch grows huge, scorpion tosses become a living tide (double count, double damage).', mods: () => [{ stat: 'scorpions', type: 'mult', value: 2 }] },
  { id: 'sunroller', name: 'Sunroller', cat: 'evolution', rarity: 'mythic', maxLv: 1, icon: 'flame3', evolveFrom: ['dungEngineer', 'dungCrown'], desc: () => 'EVOLUTION: Dung Bombs become rolling suns that burn a trail and explode twice.' },
  { id: 'sixGunStorm', name: 'Six-Gun Storm', cat: 'evolution', rarity: 'mythic', maxLv: 1, icon: 'cylinder_x2', evolveFrom: ['quickdraw', 'hollowPoints'], desc: () => 'EVOLUTION: emptying the cylinder fires a free spiral of 12 venom bullets.' },
  { id: 'burningPlague', name: 'Burning Plague', cat: 'evolution', rarity: 'mythic', maxLv: 1, icon: 'flame1', evolveFrom: ['locustCloud', 'fireAnts'], desc: () => 'EVOLUTION: the swarm is permanently aflame and never fully disperses.' },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
/** the three cards that unseal the tarot skills */
export const LEARN_CARDS = UPGRADES.filter((u): u is UpgradeDef & { learn: 'E' | 'C' | 'G' } => !!u.learn);

export interface Offer {
  def: UpgradeDef;
  fromLv: number;
  toLv: number;
}

export class UpgradeManager {
  levels = new Map<string, number>();
  history: string[] = [];
  banished = new Set<string>();
  rerolls = 2;
  /** learn cards picked whose skill unseals later (a cinematic carries the card to the bar first) */
  deferLearn = new Set<string>();
  onChange?: (id: string, lv: number) => void;

  constructor(private stats: StatSheet) {}

  /** the hunter's stat sheet (luck, gold, the gambles' stakes) */
  get sheet() {
    return this.stats;
  }

  lv(id: string) {
    return this.levels.get(id) ?? 0;
  }

  /** owned upgrades a gamble could double or cost a level */
  stakes() {
    return UPGRADES.filter((u) => this.lv(u.id) > 0 && u.maxLv > 1 && !u.learn && !u.gamble && u.cat !== 'evolution');
  }

  /** can this gamble be dealt right now? */
  private gambleOk(u: UpgradeDef) {
    if (u.gamble === 'double') return this.stakes().some((d) => this.lv(d.id) < d.maxLv);
    return true;
  }

  /**
   * Roll n offers weighted by rarity (luck), with a guaranteed evolution if eligible
   * and a sealed tarot skill until all three are learned. Trade-offs come up half
   * again as often as plain cards, and the house deals a gamble into about a third
   * of the hands (more with Luck), never two at once.
   */
  roll(n: number): Offer[] {
    const out: Offer[] = [];
    const evo = UPGRADES.filter((u) => u.cat === 'evolution' && !this.lv(u.id) && u.evolveFrom && u.evolveFrom.every((id) => this.lv(id) >= Math.min(UPGRADE_BY_ID[id].maxLv, 3)));
    if (evo.length) out.push({ def: evo[0], fromLv: 0, toLv: 1 });
    // a sealed tarot skill is always on offer until all three are learned
    const sealed = UPGRADES.filter((u) => u.learn && !this.lv(u.id) && !this.banished.has(u.id));
    if (sealed.length && out.length < n) out.push({ def: sealed[Math.floor(rnd.next() * sealed.length)], fromLv: 0, toLv: 1 });
    const rarityLuck = this.stats.get('rarity');
    const luck = this.stats.get('luck');
    const pool = UPGRADES.filter((u) => u.cat !== 'evolution' && !u.learn && (!u.needs || this.lv(u.needs) > 0) && !this.banished.has(u.id) && this.lv(u.id) < u.maxLv && (!u.gamble || this.gambleOk(u)));
    const chosen = new Set(out.map((o) => o.def.id));
    const weight = (u: UpgradeDef) => {
      let w = RARITY[u.rarity].weight * (u.weight ?? (isTrade(u) ? 1.5 : 1));
      if (u.rarity === 'rare' || u.rarity === 'epic' || u.rarity === 'legendary') w *= rarityLuck;
      if (this.lv(u.id) > 0 && !u.gamble) w *= 1.6; // favour building on what you have
      return w;
    };
    // the house deals a game
    const games = pool.filter((u) => u.gamble && !chosen.has(u.id));
    if (games.length && out.length < n && rnd.next() < Math.min(0.6, 0.34 + luck * 0.01)) {
      const g = rnd.weighted(games, weight);
      if (g) {
        chosen.add(g.id);
        out.push({ def: g, fromLv: this.lv(g.id), toLv: this.lv(g.id) + 1 });
      }
    }
    let guard = 0;
    while (out.length < n && guard++ < 200) {
      const hasGame = out.some((o) => o.def.gamble);
      const u = rnd.weighted(pool, (u) => (chosen.has(u.id) || (u.gamble && hasGame) ? 0 : weight(u)));
      if (!u || chosen.has(u.id)) continue;
      chosen.add(u.id);
      out.push({ def: u, fromLv: this.lv(u.id), toLv: this.lv(u.id) + 1 });
    }
    return out;
  }

  apply(id: string) {
    const def = UPGRADE_BY_ID[id];
    const lv = Math.min(def.maxLv, this.lv(id) + 1);
    this.levels.set(id, lv);
    this.history.push(id);
    const src = 'up:' + id;
    this.stats.removeSource(src);
    if (def.mods) this.stats.add(def.mods(lv).map((m) => ({ ...m, source: src })));
    this.onChange?.(id, lv);
    return lv;
  }

  /** force a level (gambles: Double or Nothing); 0 removes it. History is rewritten so carried runs rebuild it. */
  setLevel(id: string, lv: number) {
    const def = UPGRADE_BY_ID[id];
    if (!def) return 0;
    const l = Math.max(0, Math.min(def.maxLv, Math.round(lv)));
    const src = 'up:' + id;
    this.stats.removeSource(src);
    this.history = this.history.filter((h) => h !== id);
    if (l > 0) {
      this.levels.set(id, l);
      for (let i = 0; i < l; i++) this.history.push(id);
      if (def.mods) this.stats.add(def.mods(l).map((m) => ({ ...m, source: src })));
    } else this.levels.delete(id);
    this.onChange?.(id, l);
    return l;
  }

  /** preview: stat values before/after taking an offer (for card backs) */
  preview(o: Offer) {
    const mods = o.def.mods?.(o.toLv) ?? [];
    const before = this.stats;
    const after = before.clone();
    after.removeSource('up:' + o.def.id);
    after.add(mods.map((m) => ({ ...m, source: 'up:' + o.def.id })));
    const keys = [...new Set(mods.map((m) => m.stat))];
    return keys.map((k) => ({ stat: k, before: before.get(k), after: after.get(k) }));
  }
}

/** Event-driven upgrade effects (ricochet, relics, evolutions...). */
export class UpgradeEffects {
  private shotCount = 0;
  scarabs: { a: number; hp: number }[] = [];
  private scarabMesh: THREE.InstancedMesh | null = null;

  constructor(private ctx: Ctx, private up: UpgradeManager, private player: any, private skills: any) {
    const ev = ctx.events;
    // a learning card unseals its tarot skill (with fanfare when picked)
    ev.on('upgradePicked', (id: string) => {
      const k = UPGRADE_BY_ID[id]?.learn;
      if (k && !this.up.deferLearn.has(id)) this.skills?.learn?.(k, false);
    });
    ev.on('enemyHit', (e: any, hit: any, amt: number, res: any) => this.onHit(e, hit, amt, res));
    ev.on('enemyKilled', (e: any, hit: any) => this.onKill(e, hit));
    ev.on('shot', (hit: any) => this.onShot(hit));
    ev.on('playerHurt', () => this.onHurt());
    ev.on('counter', () => {
      const l = this.up.lv('sheriffStar') + (this.up.lv('bastetBell') ? 1.3 : 0);
      if (l > 0) this.player.heal(this.player.maxHp * (0.06 * this.up.lv('sheriffStar') + (this.up.lv('bastetBell') ? 0.08 : 0)));
    });
    ev.on('trick', (l: any) => {
      const r = this.up.lv('rodeoStar');
      if (r > 0) {
        ctx.run.ultCharge = Math.min(1, ctx.run.ultCharge + (l.score / 6000) * r * 0.4);
        this.player.board.boostMeter = Math.min(1, this.player.board.boostMeter + 0.05 * r);
      }
    });
    ev.on('driftBoost', (p: number) => {
      const l = this.up.lv('driftKing');
      if (!l) return;
      this.player.board.vel.multiplyScalar(1 + 0.1 * l * p);
      ctx.fx.sandBurst(this.player.pos, 1 + l * 0.4);
      ctx.enemies.inRadius(this.player.pos, 4 + l, (e: any) => ctx.enemies.damage(e, { base: 10 * l * p + 5, kind: 'phys', source: 'board', knock: 8, status: [{ id: 'slow', stacks: 1, dur: 1.5 }] }));
    });
  }

  private onShot(hit: any) {
    this.shotCount++;
    if (this.up.lv('sunDisk') && this.shotCount % 8 === 0) {
      const o = this.player.muzzleWorld.clone();
      const d = this.player.aimPoint.clone().sub(o).normalize();
      for (let s = 1; s < 40; s += 1.5) {
        const p = o.clone().addScaledVector(d, s);
        this.ctx.particles.emit({ pos: p, count: 1, life: [0.25, 0.35], size: [0.5, 0.1], sprite: 'glow16', additive: true, color: 0xffd36b, alpha: 0.6 });
        this.ctx.enemies.inRadius(p, 1.2, (e: any) => this.ctx.enemies.damage(e, { base: 14, kind: 'magic', source: 'divine', status: [{ id: 'burn', stacks: 1, dur: 3, power: 1.5 }], canCrit: true }));
      }
      this.ctx.sfx('divine_power', o, 0.6);
    }
    if (this.up.lv('sixGunStorm') && this.player.ammo === 0) {
      const o = this.player.center(new THREE.Vector3());
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        this.ctx.engine.tweens.after(i * 0.03, () => {
          const d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
          const hit2 = this.ctx.enemies.raycast(o, d, 30);
          if (hit2?.enemy) this.ctx.enemies.damage(hit2.enemy, { base: 14, kind: 'phys', source: 'gun', status: [{ id: 'poison', stacks: 2, dur: 4, power: 2.2 }] });
          this.ctx.fx.tracer(o, o.clone().addScaledVector(d, hit2?.t ?? 30), 0xc8ff5a);
        });
      }
      this.ctx.sfx('rev_shot', o, 0.8, 1.2);
    }
    void hit;
  }

  private onHit(e: any, hit: any, amt: number, res: any) {
    const ctx = this.ctx;
    // extra venom stacks from Venom Rounds
    const vr = this.up.lv('venomRounds');
    if (vr && hit.source === 'gun' && e.status) e.status.apply('poison', vr, 4, 2.2 * this.player.stats.get('statusPower'), this.player.stats.get('poisonStacks'), e.def?.statusRes ?? {});
    // lifesteal
    const ls = this.player.stats.get('lifesteal');
    if (ls > 0 && (hit.source === 'gun' || hit.source === 'melee')) this.player.heal(amt * ls);
    // ricochet
    const rc = this.up.lv('ricochet');
    if (rc && hit.source === 'gun' && !hit.tags?.includes('ricochet')) {
      let from = e;
      const hitSet = new Set([e.id]);
      for (let i = 0; i < rc; i++) {
        const next = ctx.enemies.nearest(from.pos, 9, (o: any) => !hitSet.has(o.id));
        if (!next) break;
        hitSet.add(next.id);
        ctx.fx.tracer({ x: from.pos.x, y: from.pos.y + from.height * 0.6, z: from.pos.z }, { x: next.pos.x, y: next.pos.y + next.height * 0.6, z: next.pos.z }, 0xfff0b0, 160);
        ctx.enemies.damage(next, { ...hit, base: hit.base * 0.6, tags: ['ricochet'] });
        from = next;
      }
      ctx.sfx('ricochet', e.pos, 0.5);
    }
    // eye of horus marks
    if (this.up.lv('eyeOfHorus') && res?.crit && e.status) e.status.apply('mark', 1, 6, 0, 1, {});
    if (e.status?.has?.('mark')) e.vulnerable = 1.25;
    // fire ants
    const fa = this.up.lv('fireAnts');
    if (fa && (hit.source === 'scorpion' || hit.source === 'swarm') && Math.random() < 0.3 * fa && e.status) e.status.apply('burn', 1, 3, 1.5, 99, e.def?.statusRes ?? {});
    if (this.up.lv('sekhmetClaw') && hit.source === 'melee' && e.status) e.status.apply('burn', 1, 3, 2, 99, e.def?.statusRes ?? {});
    // serket's kiss
    if (this.up.lv('serketsKiss') && e.status?.stacks('poison') >= 25 && e.alive) {
      const st = e.status.stacks('poison');
      e.status.clear('poison');
      ctx.fx.explosion({ x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z }, 2.6, 'poison');
      ctx.sfx('poison_burst', e.pos, 0.9);
      ctx.enemies.inRadius(e.pos, 4, (o: any) => ctx.enemies.damage(o, { base: st * 12, kind: 'magic', source: 'poison', status: [{ id: 'poison', stacks: 6, dur: 4, power: 2.2 }], canCrit: true }));
    }
  }

  private onKill(e: any, hit: any) {
    if (this.up.lv('anubisScale')) {
      if (this.player.hp >= this.player.maxHp - 0.5) this.player.shield = Math.min(this.player.maxHp * 0.5, this.player.shield + this.player.maxHp * 0.02);
      else this.player.heal(this.player.maxHp * 0.01);
    }
    if (this.up.lv('sekhmetClaw') && e.status?.has('burn')) {
      this.ctx.enemies.inRadius(e.pos, 4, (o: any) => o.status?.apply('burn', 1, 3, 2, 99, o.def?.statusRes ?? {}));
      this.ctx.fx.flames({ x: e.pos.x, y: e.pos.y + 0.5, z: e.pos.z }, 6, 1.4);
    }
    void hit;
  }

  private onHurt() {
    const l = this.up.lv('dynamiteBelt');
    if (l && Math.random() < l * 0.1) {
      const p = this.player.pos.clone();
      this.ctx.toast('DYNAMITE DROPPED', '#ff8a4a');
      this.ctx.sfx('dynamite_fuse', p, 0.8);
      this.ctx.engine.tweens.after(1.2, () => {
        this.ctx.fx.explosion(p, 3.5);
        this.ctx.sfx('explosion', p, 1);
        this.ctx.events.emit('explosion', p, 4, 50, 'player');
      });
    }
  }

  update(dt: number) {
    // skills learned on an earlier leg of the hunt (carried runs re-apply their history quietly)
    // (a card still flying to the bar in its unlock cinematic unseals when it lands)
    for (const u of LEARN_CARDS) if (this.up.lv(u.id) > 0 && !this.up.deferLearn.has(u.id)) this.skills?.learn?.(u.learn, true);
    // scarab shield orbiters block projectiles
    const l = this.up.lv('scarabShield');
    if (!l) return;
    const n = l + 1;
    while (this.scarabs.length < n) this.scarabs.push({ a: Math.random() * 6.28, hp: 3 });
    const c = this.player.center(new THREE.Vector3());
    const proj = (this.ctx.enemies as any).proj?.list as any[] | undefined;
    for (let i = 0; i < this.scarabs.length; i++) {
      const s = this.scarabs[i];
      s.a += dt * 2.4;
      const x = c.x + Math.cos(s.a + (i / n) * 6.28) * 1.6, z = c.z + Math.sin(s.a + (i / n) * 6.28) * 1.6;
      this.ctx.particles.emit({ pos: { x, y: c.y, z }, count: 1, life: [0.05, 0.05], size: [0.32, 0.32], sprite: 'scarab_x2', color: 0xffffff, sizeJitter: 0 });
      if (proj) for (const q of proj) if (q.owner === 'enemy' && Math.hypot(q.x - x, q.z - z) < 0.6 && Math.abs(q.y - c.y) < 1) {
        q.life = 0;
        this.ctx.fx.hit({ x, y: c.y, z }, { x: 0, y: 1, z: 0 }, 'chitin', 0.6);
      }
    }
  }
}
