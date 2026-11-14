// More upgrade cards (same UpgradeDef format as Upgrades.ts) and their effects.
// registerExtraUpgrades() adds them to the shared pool (UPGRADES / UPGRADE_BY_ID)
// so UpgradeManager.roll() offers them and their evolutions like any other.
// ExtraUpgradeEffects drives them purely from ctx.events plus public player /
// skills state; no other system needs to change.
//
// RISK_UPGRADES are the trade-offs, cursed bargains and gambles: every one
// lists exact green pros and red cons; a gamble's outcome is decided at the pick
// (resolveGamble) and played out with a 3D dice / coin / revolver-chamber spin.
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
import { UPGRADES, UPGRADE_BY_ID, UpgradeDef, UpgradeManager, Offer, Rarity, GambleKind, RARITY, RARITY_ORDER, TIER_MULT, cnt, rd, tierMult, tierDown, dealtRarity } from './Upgrades';
import { rnd } from '../../engine/math/rand';
import { zap, shockwave } from '../player/Equipment';

type M = Omit<Modifier, 'source'>;
const f1 = (v: number) => v.toFixed(1);

export const EXTRA_UPGRADES: UpgradeDef[] = [
  // ------------------------------------------------------------- gun
  { id: 'bankShot', name: 'Bank Shot', cat: 'gun', rarity: 'uncommon', maxLv: 3, icon: 'spark', desc: (l) => `Missed shots skip off the sand into the nearest enemy within ${7 + 2 * l} m for ${55 + 15 * l}% damage.`, lore: 'Sundown never misses. The ground does.' },
  { id: 'sixthChamber', name: 'The Sixth Chamber', cat: 'gun', rarity: 'rare', maxLv: 2, icon: 'cylinder', desc: (l) => `The last round in the cylinder is a dynamite slug: it explodes for ${35 + 25 * l} damage in a ${f1(2.6 + 0.6 * l)} m blast.`, lore: 'Load five, pray on the sixth.' },
  { id: 'thunderhead', name: 'Thunderhead', cat: 'gun', rarity: 'rare', maxLv: 3, icon: 'bolt', god: 'Set', desc: (l) => `Crits arc lightning to ${1 + cnt(l)} nearby enemies for 45% of the hit, jolting them stiff.` },
  { id: 'deadCalm', name: 'Dead Calm', cat: 'gun', rarity: 'rare', maxLv: 2, icon: 'eye', god: 'Horus', desc: (l) => `A perfect reload slows the world for ${f1(1.6 + 0.6 * l)} s: deadeye, +${25 * l}% crit chance.` },
  { id: 'trickShot', name: 'Trick Shot', cat: 'gun', rarity: 'uncommon', maxLv: 3, icon: 'star4', desc: (l) => `Airborne: +${12 * l}% gun damage and +${5 * l}% crit chance. Airborne kills refill ${10 * l}% boost.` },
  // ------------------------------------------------------------- insects
  { id: 'venomPuddles', name: 'Venom Puddles', cat: 'insect', rarity: 'uncommon', maxLv: 3, icon: 'bubble', god: 'Serket', desc: (l) => `Poisoned enemies burst into a venom puddle when they die (${f1(1.4 + 0.3 * l)} m, ${4 + l} s) that poisons all who wade in.` },
  { id: 'mirrorBrood', name: 'Phantom Pinches', cat: 'insect', rarity: 'rare', maxLv: 3, icon: 'scorp', god: 'Serket', desc: (l) => `Crit kills have a ${Math.min(100, 25 + 15 * l)}% chance to hatch a phantom Pinch from the corpse. It hunts for ${5 + l} s.`, lore: 'Pinch insists they are cousins.' },
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

// ------------------------------------------------------------------ trade-offs, curses and gambles

const s_ = (n: number) => (n === 1 ? '' : 's');
const dmg3 = (v: number): M[] => [{ stat: 'gunDmg', type: 'pct', value: v }, { stat: 'meleeDmg', type: 'pct', value: v }, { stat: 'magicDmg', type: 'pct', value: v }];

export const RISK_UPGRADES: UpgradeDef[] = [
  // ---- trade-offs: a clear win, a clear price
  {
    id: 'glassCannon', name: 'Glass Cannon', cat: 'passive', rarity: 'rare', maxLv: 3, icon: 'bolt',
    mods: (l) => [...dmg3(0.25 * l), { stat: 'maxHp', type: 'pct', value: -0.12 * l }],
    desc: (l, d = l) => `Every shot, slash and sting hits ${25 * l}% harder, but your bones carry ${12 * d}% less health.`,
    pros: (l) => [`+${25 * l}% gun, melee and divine damage`], cons: (l) => [`−${12 * l}% max health`],
    lore: 'Hits like a cannon. Breaks like the bottle it came in.',
  },
  {
    id: 'warmGun', name: 'Happiness Is a Warm Gun', cat: 'gun', rarity: 'uncommon', maxLv: 3, icon: 'cylinder',
    mods: (l) => [{ stat: 'fireRate', type: 'pct', value: 0.22 * l }, { stat: 'ammo', type: 'flat', value: l }, { stat: 'spread', type: 'pct', value: 0.3 * l }],
    desc: (l, d = l) => `The iron runs hot: it fires ${22 * l}% faster and holds ${cnt(l)} more round${s_(cnt(l))}, but every shot kicks ${30 * d}% wider.`,
    pros: (l) => [`+${22 * l}% fire rate`, `+${cnt(l)} round${s_(cnt(l))} in the cylinder`], cons: (l) => [`+${30 * l}% spread`],
    lore: 'Bang bang, shoot shoot.',
  },
  {
    id: 'heavyIron', name: 'Heavy Iron', cat: 'gun', rarity: 'uncommon', maxLv: 3, icon: 'bullet',
    mods: (l) => [{ stat: 'gunDmg', type: 'pct', value: 0.3 * l }, { stat: 'knockback', type: 'pct', value: 0.25 * l }, { stat: 'fireRate', type: 'pct', value: -0.12 * l }, { stat: 'reloadSpeed', type: 'pct', value: -0.12 * l }],
    desc: (l, d = l) => `Lead slugs in a bored-out barrel: ${30 * l}% more gun damage and ${25 * l}% more knockback, but the hammer and the reload both drag ${12 * d}%.`,
    pros: (l) => [`+${30 * l}% gun damage`, `+${25 * l}% knockback`], cons: (l) => [`−${12 * l}% fire rate`, `−${12 * l}% reload speed`],
    lore: 'Every shot lands like a mule kick. So does every reload.',
  },
  {
    id: 'taxman', name: 'Taxman', cat: 'passive', rarity: 'uncommon', maxLv: 3, icon: 'coin',
    mods: (l) => [{ stat: 'goldGain', type: 'pct', value: 0.4 * l }, { stat: 'bountyGain', type: 'pct', value: 0.2 * l }, ...dmg3(-0.06 * l)],
    desc: (l, d = l) => `Skim off the top: ${40 * l}% more gold and ${20 * l}% more bounty, but counting coins slows the trigger finger (${6 * d}% less damage).`,
    pros: (l) => [`+${40 * l}% gold`, `+${20 * l}% bounty`], cons: (l) => [`−${6 * l}% gun, melee and divine damage`],
    lore: "There's one for you, nineteen for me.",
  },
  {
    id: 'gimmeShelter', name: 'Gimme Shelter', cat: 'gear', rarity: 'common', maxLv: 3, icon: 'shield',
    mods: (l) => [{ stat: 'def', type: 'flat', value: 4 * l }, { stat: 'maxHp', type: 'pct', value: 0.08 * l }, { stat: 'moveSpeed', type: 'pct', value: -0.07 * l }, { stat: 'accel', type: 'pct', value: -0.07 * l }],
    desc: (l, d = l) => `Iron plates sewn into the coat: +${rd(4 * l)} Defense and ${8 * l}% more max health, but the board pushes and picks up ${7 * d}% slower.`,
    pros: (l) => [`+${rd(4 * l)} Defense`, `+${8 * l}% max health`], cons: (l) => [`−${7 * l}% push speed and acceleration`],
    lore: "War, children, it's just a shot away.",
  },
  {
    id: 'helterSkelter', name: 'Helter Skelter', cat: 'passive', rarity: 'rare', maxLv: 3, icon: 'speedline',
    mods: (l) => [{ stat: 'moveSpeed', type: 'pct', value: 0.12 * l }, { stat: 'boostRegen', type: 'pct', value: 0.2 * l }, { stat: 'speedDamage', type: 'flat', value: 0.004 * l }, { stat: 'armor', type: 'pct', value: -0.15 * l }],
    desc: (l, d = l) => `Ride reckless: ${12 * l}% faster pushes, ${20 * l}% faster boost regen and +${(0.4 * l).toFixed(2)}% damage per 2 m/s of speed, but ${15 * d}% less armor.`,
    pros: (l) => [`+${12 * l}% push speed`, `+${20 * l}% boost regen`, `+${(0.4 * l).toFixed(2)}% momentum damage`], cons: (l) => [`−${15 * l}% armor`],
    lore: 'When I get to the bottom I go back to the top of the slide.',
  },
  {
    id: 'paradiseCity', name: 'Paradise City', cat: 'passive', rarity: 'uncommon', maxLv: 3, icon: 'coin',
    mods: (l) => [{ stat: 'luck', type: 'flat', value: 4 * l }, { stat: 'goldGain', type: 'pct', value: 0.1 * l }, { stat: 'critDmg', type: 'flat', value: -0.15 * l }],
    desc: (l, d = l) => `Lady Luck rides along: +${rd(4 * l)} Luck (crits, rarer cards, better gambles) and ${10 * l}% more gold, but crits hit ${15 * d}% softer.`,
    pros: (l) => [`+${rd(4 * l)} Luck`, `+${10 * l}% gold`], cons: (l) => [`−${15 * l}% crit damage`],
    lore: 'Take me down to the Paradise City. It is further than it looks.',
  },
  {
    id: 'jumpinJack', name: "Jumpin' Jack Flash", cat: 'gun', rarity: 'uncommon', maxLv: 3, icon: 'cylinder',
    mods: (l) => [{ stat: 'reloadSpeed', type: 'pct', value: 0.3 * l }, { stat: 'fireRate', type: 'pct', value: 0.12 * l }, { stat: 'ammo', type: 'flat', value: -l }],
    desc: (l, d = l) => `A hair-trigger rig: reloads ${30 * l}% faster and fires ${12 * l}% faster, but ${cnt(d)} chamber${s_(cnt(d))} of the cylinder ${cnt(d) === 1 ? 'is' : 'are'} welded shut.`,
    pros: (l) => [`+${30 * l}% reload speed`, `+${12 * l}% fire rate`], cons: (l) => [`−${cnt(l)} round${s_(cnt(l))} in the cylinder`],
    lore: "It's a gas, gas, gas.",
  },
  // ---- cursed bargains: a big win, a real price
  {
    id: 'paintItBlack', name: 'Paint It Black', cat: 'relic', rarity: 'rare', maxLv: 2, icon: 'eye', curse: true,
    mods: (l) => [{ stat: 'critChance', type: 'flat', value: 0.1 * l }, { stat: 'critDmg', type: 'flat', value: 0.4 * l }],
    desc: (l, d = l) => `Your eye goes dark and sure: +${10 * l}% crit chance and +${40 * l}% crit damage. Every crit you land with gun or melee costs you ${d} health (never below 1).`,
    pros: (l) => [`+${10 * l}% crit chance`, `+${40 * l}% crit damage`], cons: (l) => [`Every crit costs you ${l} health`],
    lore: 'I see a red door and I want it painted black.',
  },
  {
    id: 'sympathyDevil', name: 'Sympathy for the Devil', cat: 'relic', rarity: 'epic', maxLv: 1, icon: 'flame2', curse: true,
    mods: (l) => [...dmg3(0.5 * l), { stat: 'critChance', type: 'flat', value: 0.05 * l }, { stat: 'maxHp', type: 'pct', value: -0.3 * l }, { stat: 'regen', type: 'mult', value: 0 }],
    desc: (l, d = l) => `Shake the stranger's hand: +${50 * l}% gun, melee and divine damage and +${5 * l}% crit chance. He keeps ${d > 1.01 ? `${30 * d}%` : 'a third'} of your health and all of your natural regeneration.`,
    pros: (l) => [`+${50 * l}% gun, melee and divine damage`, `+${5 * l}% crit chance`], cons: (l) => [`−${30 * l}% max health`, 'No natural regeneration'],
    lore: 'Pleased to meet you. Hope you guessed my name.',
  },
  {
    id: 'heavensDoor', name: "Knockin' on Heaven's Door", cat: 'relic', rarity: 'epic', maxLv: 1, icon: 'ankh', curse: true,
    mods: (l) => [{ stat: 'lifesteal', type: 'flat', value: 0.06 * l }, { stat: 'regen', type: 'pct', value: 1.0 * l }, { stat: 'maxHp', type: 'pct', value: -0.25 * l }],
    desc: (l, d = l) => `One foot through the door: ${6 * l}% of all gun and melee damage heals you and regeneration ${l > 1.01 ? `climbs ${100 * l}%` : 'doubles'}, but you carry ${d > 1.01 ? `${25 * d}%` : 'a quarter'} less max health.`,
    pros: (l) => [`+${6 * l}% lifesteal`, `+${100 * l}% regeneration`], cons: (l) => [`−${25 * l}% max health`],
    lore: 'Mama, put my guns in the ground.',
  },
  {
    id: 'liveAndLetDie', name: 'Live and Let Die', cat: 'gear', rarity: 'rare', maxLv: 2, icon: 'bolt', curse: true,
    mods: (l) => [{ stat: 'explosionRadius', type: 'pct', value: 0.3 * l }, { stat: 'magicDmg', type: 'pct', value: 0.15 * l }],
    desc: (l, d = l) => `Packed with black powder: blasts reach ${30 * l}% wider and divine damage is up ${15 * l}%, but standing in your own blast singes you for ${4 * d}% of your max health.`,
    pros: (l) => [`+${30 * l}% blast radius`, `+${15 * l}% divine damage`], cons: (l) => [`Your own blasts singe you (−${4 * l}% max health)`],
    lore: 'When you got a job to do, you got to do it well.',
  },
  // ---- gambles: the pick plays the game. A game dealt above its own rarity plays for
  // more: `l` is this deal's upside multiplier, `d` its downside's (half as steep).
  {
    id: 'rollBones', name: 'Roll the Bones', cat: 'gamble', rarity: 'rare', maxLv: 9, icon: 'skull', gamble: 'bones',
    desc: (l) => `Roll two bone dice for a free upgrade: the higher the roll, the rarer it is. 3–5 Common or Uncommon, 6–8 Uncommon or Rare, 9–10 Rare or Epic, 11 Epic or Legendary.${richer(l)} Boxcars (6–6) pays a MYTHIC evolution; snake eyes (1–1) deals you a cursed card.`,
    pros: (l) => [`High roll: a rarer free upgrade${tiersUp(l)}`, '6–6: a MYTHIC evolution'], cons: () => ['1–1: a cursed card, like it or not'],
    odds: () => 'Mythic 1 in 36  ·  Cursed 1 in 36', per: 'A game, not a level: deal it again any time.',
    lore: 'The desert keeps its dice in the bones of men who lost.',
  },
  {
    id: 'snakeEyes', name: 'Snake Eyes', cat: 'gamble', rarity: 'uncommon', maxLv: 9, icon: 'dot4', gamble: 'snake',
    desc: (l, d = l) => `Roll two bone dice. Any doubles: +${rd(5 * l)} Luck and +${rd(8 * l)}% crit chance for the rest of the hunt. Snake eyes (1–1): a free Legendary as well. Anything else: −${rd(2 * d)} Luck.`,
    pros: (l) => [`Doubles: +${rd(5 * l)} Luck, +${rd(8 * l)}% crit chance`, '1–1: a free Legendary too'], cons: (l) => [`No doubles: −${rd(2 * l)} Luck`],
    odds: () => 'Doubles 1 in 6  ·  Snake eyes 1 in 36  ·  Luck loads the dice', per: 'A game, not a level: deal it again any time.',
    lore: 'Two little eyes, staring up at you from the sand.',
  },
  {
    id: 'deadMansDraw', name: "Dead Man's Draw", cat: 'gamble', rarity: 'rare', maxLv: 9, icon: 'skull', gamble: 'deadman',
    desc: (l, d = l) => `Roll against a dead gunslinger, one die each: yours bone, his black. Match or beat him: a random ${winTier(l)} upgrade and +${rd(60 * l)} gold. Roll lower: he draws first, and you lose ${deadHp(d)}% of your current health and ${rd(30 * d)} gold.`,
    pros: (l) => [`Win: ${aWin(l)} upgrade and +${rd(60 * l)} gold`], cons: (l) => [`Lose: −${deadHp(l)}% health, −${rd(30 * l)} gold`],
    odds: () => 'You win 7 in 12 (ties go to the living)', per: 'A game, not a level: deal it again any time.',
    lore: 'Aces and eights. He is still holding them.',
  },
  {
    id: 'coinToss', name: 'Coin Toss', cat: 'gamble', rarity: 'common', maxLv: 9, icon: 'coin', gamble: 'coin',
    desc: (l, d = l) => `Call it in the air. Heads: ${l > 1.01 ? `win ${rd(100 * l)}% of your gold on top` : 'double your gold'} (at least +${rd(40 * l)}, at most +${rd(400 * l)}). Tails: lose ${tailsLoss(d) === 50 ? 'half' : tailsLoss(d) + '%'} of it.`,
    pros: (l) => [`Heads: +${rd(100 * l)}% of your gold (+${rd(40 * l)} to +${rd(400 * l)})`], cons: (l) => [`Tails: lose ${tailsLoss(l) === 50 ? 'half' : tailsLoss(l) + '%'} of your gold`],
    odds: () => 'Heads 50% (+1% per Luck, up to 65%)', per: 'A game, not a level: deal it again any time.',
    lore: 'Heads you win. Tails the desert wins. It usually does.',
  },
  {
    id: 'doubleNothing', name: 'Double or Nothing', cat: 'gamble', rarity: 'epic', maxLv: 9, icon: 'coin', gamble: 'double',
    desc: (l) => `Flip a gold coin over one of your upgrades, chosen at random. Heads: its level doubles (up to its max)${l > 1.01 ? `, every new level dealt ${stepsOfMult(l)} tier${s_(stepsOfMult(l))} richer` : ''}. Tails: it loses a level, and at level 1 it is gone.`,
    pros: (l) => [`Heads: a random upgrade's level ×2${tiersUp(l)}`], cons: () => ['Tails: that upgrade loses a level'],
    odds: () => 'Heads 50% (+1% per Luck, up to 65%)', per: 'A game, not a level: deal it again any time.',
    lore: 'Every gambler dies broke. Not every gambler dies today.',
  },
  {
    id: 'russianRoulette', name: 'Russian Roulette', cat: 'gamble', rarity: 'epic', maxLv: 3, icon: 'cylinder', gamble: 'roulette',
    mods: (l) => dmg3(0.3 * l),
    desc: (l, d = l) => `+${30 * l}% gun, melee and divine damage, kept whatever happens. Spin the cylinder with ${live(d)} live round${s_(live(d))} in six and pull the hammer on yourself: a live round costs 40% of your max health (never fatal).`,
    pros: (l) => [`+${30 * l}% gun, melee and divine damage`], cons: (l) => [`${live(l)} in 6: shoot yourself, −40% max health`],
    odds: (l) => `${6 - live(l)} in 6 you walk away clean`, per: '+30% damage and one more live round per level',
    lore: 'Six chambers, one prayer.',
  },
];

// ------------------------------------------------------------------ a game's stakes at its dealt rarity

/** tiers climbed, from a deal's upside multiplier */
function stepsOfMult(m: number) {
  let best = 0;
  for (let i = 0; i < TIER_MULT.length; i++) if (Math.abs(TIER_MULT[i] - m) < Math.abs(TIER_MULT[best] - m)) best = i;
  return best;
}
const tiersUp = (l: number) => (stepsOfMult(l) > 0 ? ` (+${stepsOfMult(l)} tier${s_(stepsOfMult(l))})` : '');
const richer = (l: number) => (stepsOfMult(l) > 0 ? ` Dealt rich: every free card climbs ${stepsOfMult(l)} more tier${s_(stepsOfMult(l))}.` : '');
const winTier = (l: number) => `${RARITY[RARITY_ORDER[Math.min(4, 2 + stepsOfMult(l))]].name}-or-better`;
/** "a Rare-or-better", "an Epic-or-better" */
const aWin = (l: number) => (/^[AEIOU]/.test(winTier(l)) ? 'an ' : 'a ') + winTier(l);
/** Dead Man's Draw: share of current health lost */
const deadHp = (d: number) => Math.min(60, rd(30 * d));
/** Coin Toss: share of gold lost on tails */
const tailsLoss = (d: number) => Math.min(75, rd(50 * d));
/** Russian Roulette: live rounds in the cylinder */
const live = (d: number) => Math.min(5, cnt(d));

// ------------------------------------------------------------------ playing a gamble

export type GambleProp = 'dice' | 'coin' | 'chamber';

/** a gamble decided at the pick: what the 3D props must show, and the outcome to commit */
export interface GambleOutcome {
  kind: GambleKind;
  prop: GambleProp;
  win: boolean;
  /** a big win (boxcars, snake eyes on Snake Eyes, mythic) */
  jackpot: boolean;
  /** dice faces 1..6 */
  dice?: number[];
  /** which dice are the dead man's (black) */
  dark?: boolean[];
  heads?: boolean;
  /** chamber: six chambers, which are loaded, and which one stops under the hammer */
  loaded?: boolean[];
  stop?: number;
  /** the verdict, big, and the line under it */
  title: string;
  line: string;
  /** commit the outcome (call once, at the reveal) */
  apply(): void;
}

const d6 = () => 1 + Math.floor(rnd.next() * 6);
const pick = <T,>(a: T[]) => (a.length ? a[Math.floor(rnd.next() * a.length)] : null);

/** a free card of one of these rarities that can still be taken (no skills, games, curses or evolutions) */
function freeCard(up: UpgradeManager, rarities: Rarity[]) {
  const ok = (u: UpgradeDef) => !u.learn && !u.gamble && !u.curse && u.cat !== 'evolution' && up.lv(u.id) < u.maxLv && (!u.needs || up.lv(u.needs) > 0);
  return pick(UPGRADES.filter((u) => ok(u) && rarities.includes(u.rarity))) ?? pick(UPGRADES.filter(ok));
}

/** tiers to deal a free card at so it lands on `rank` (never below its own rarity) */
const stepsTo = (d: UpgradeDef | null, rank: number) => (d ? Math.max(0, Math.min(4, rank) - RARITY[d.rarity].rank) : 0);

/**
 * Decide a gamble now (the props then play this exact result). `player` is the
 * hunter (hp / maxHp); gold is the run's. Nothing changes until apply().
 * A game dealt above its own rarity (o.steps) plays for more: its winnings ×
 * tierMult, its losses × tierDown, its free cards dealt that many tiers richer.
 */
export function resolveGamble(o: Offer, up: UpgradeManager, ctx: Ctx, player: any): GambleOutcome {
  const def = o.def;
  const kind = def.gamble!;
  const k = Math.max(0, Math.min(4, o.steps ?? 0));
  const m = tierMult(k), dn = tierDown(k);
  const luck = up.sheet.get('luck');
  const n = up.history.length;
  const stat = (mm: M) => up.sheet.add({ ...mm, source: `gamble:${def.id}:${n}` });
  const grant = (d: UpgradeDef | null, steps = 0) => {
    if (!d) return;
    const lv = up.apply(d.id, steps);
    ctx.events.emit('upgradePicked', d.id, lv);
  };
  const hurt = (frac: number, ofMax: boolean) => {
    if (!player) return;
    const loss = Math.max(0, Math.min(player.hp - 1, (ofMax ? player.maxHp : player.hp) * frac));
    player.hp -= loss;
    player.hurtFlash = 1;
  };
  const gold = (dg: number) => {
    const r = ctx.run;
    const d = Math.max(-r.gold, Math.round(dg));
    r.gold += d;
    if (d > 0) r.totalGold += d;
    return d;
  };
  const name = (d: UpgradeDef | null) => (d ? d.name.toUpperCase() : 'NOTHING');
  /** "MOMENTUM  ·  EPIC  LV 2" */
  const named = (d: UpgradeDef | null, steps: number) => {
    if (!d) return 'NOTHING';
    const lvAfter = up.lv(d.id) + 1;
    return `${name(d)}  ·  ${RARITY[dealtRarity(d, steps)].name.toUpperCase()}${lvAfter > 1 ? '  LV ' + lvAfter : ''}`;
  };
  if (kind === 'bones') {
    const dice = [d6(), d6()];
    const sum = dice[0] + dice[1];
    let card: UpgradeDef | null;
    let steps = 0;
    let title: string;
    let win = true, jackpot = false;
    if (sum === 2) {
      card = pick(UPGRADES.filter((u) => u.curse && up.lv(u.id) < u.maxLv)) ?? freeCard(up, ['common']);
      title = 'SNAKE EYES';
      win = false;
    } else if (sum === 12) {
      card = pick(UPGRADES.filter((u) => u.cat === 'evolution' && !up.lv(u.id))) ?? freeCard(up, ['legendary']);
      if (card && card.cat !== 'evolution') steps = stepsTo(card, 4);
      title = 'BOXCARS!';
      jackpot = true;
    } else {
      const tier: Rarity[] = sum <= 5 ? ['common', 'uncommon'] : sum <= 8 ? ['uncommon', 'rare'] : sum <= 10 ? ['rare', 'epic'] : ['epic', 'legendary'];
      card = freeCard(up, tier);
      // the roll names the rarity it lands on; a rich deal climbs k tiers more
      const at = RARITY[tier[rnd.next() < 0.5 ? 0 : 1]].rank + k;
      steps = stepsTo(card, at);
      title = `ROLLED ${sum}`;
    }
    return { kind, prop: 'dice', win, jackpot, dice, title, line: card ? `${win ? '' : 'CURSED: '}${card.cat === 'evolution' ? name(card) : named(card, steps)}` : 'THE BONES ARE SILENT', apply: () => grant(card, steps) };
  }
  if (kind === 'snake') {
    const dice = [d6(), d6()];
    if (dice[0] !== dice[1] && rnd.next() < Math.min(0.25, luck * 0.01)) dice[1] = dice[0]; // Luck loads the dice
    const dbl = dice[0] === dice[1];
    const snake = dbl && dice[0] === 1;
    const card = snake ? freeCard(up, ['legendary']) : null;
    const cs = stepsTo(card, 4);
    const lk = rd(5 * m), cc = rd(8 * m), lose = rd(2 * dn);
    return {
      kind, prop: 'dice', win: dbl, jackpot: snake, dice,
      title: snake ? 'SNAKE EYES!' : dbl ? 'DOUBLES!' : 'NO DICE',
      line: snake ? `+${lk} LUCK  +${cc}% CRIT  ·  ${named(card, cs)}` : dbl ? `+${lk} LUCK  ·  +${cc}% CRIT CHANCE` : `−${lose} LUCK`,
      apply: () => {
        if (dbl) {
          stat({ stat: 'luck', type: 'flat', value: lk });
          stat({ stat: 'critChance', type: 'flat', value: cc / 100 });
          if (card) grant(card, cs);
        } else stat({ stat: 'luck', type: 'flat', value: -lose });
      },
    };
  }
  if (kind === 'deadman') {
    const dice = [d6(), d6()];
    if (dice[0] < dice[1] && rnd.next() < Math.min(0.3, luck * 0.015)) dice[0] = d6();
    const win = dice[0] >= dice[1];
    const card = win ? freeCard(up, ['rare', 'epic', 'legendary']) : null;
    // Rare-or-better (k tiers more on a rich deal): at least that, and at least k above its own
    const cs = card ? Math.max(stepsTo(card, 2 + k), Math.min(k, 4 - RARITY[card.rarity].rank)) : 0;
    const g = rd(60 * m), lg = rd(30 * dn), hp = deadHp(dn);
    return {
      kind, prop: 'dice', win, jackpot: win && dice[0] === 6, dice, dark: [false, true],
      title: win ? (dice[0] === dice[1] ? 'A DEAD HEAT' : 'YOU DREW FIRST') : 'HE DREW FIRST',
      line: win ? `${named(card, cs)}  ·  +${g} GOLD` : `−${hp}% HEALTH  ·  −${lg} GOLD`,
      apply: () => {
        if (win) {
          grant(card, cs);
          gold(g);
        } else {
          hurt(hp / 100, false);
          gold(-lg);
        }
      },
    };
  }
  if (kind === 'coin' || kind === 'double') {
    const heads = rnd.next() < 0.5 + Math.min(0.15, luck * 0.01);
    if (kind === 'coin') {
      const g = ctx.run.gold;
      const win = heads ? Math.round(Math.max(40 * m, Math.min(400 * m, g * m))) : -Math.floor((g * tailsLoss(dn)) / 100);
      return { kind, prop: 'coin', win: heads, jackpot: heads && win >= 200, heads, title: heads ? 'HEADS!' : 'TAILS', line: heads ? `+${win} GOLD` : win < 0 ? `${win} GOLD` : 'NOTHING TO LOSE', apply: () => void gold(win) };
    }
    const stakes = up.stakes();
    const target = pick(stakes.filter((d) => up.lv(d.id) < d.maxLv)) ?? pick(stakes);
    const lv = target ? up.lv(target.id) : 0;
    const to = target ? (heads ? Math.min(target.maxLv, lv * 2) : lv - 1) : 0;
    return {
      kind, prop: 'coin', win: heads, jackpot: heads && to - lv >= 2, heads,
      title: heads ? 'DOUBLE!' : 'NOTHING',
      line: target ? `${name(target)}  LV ${lv} → ${to > 0 ? to : 'GONE'}${heads && k > 0 && to > lv ? '  ·  ' + RARITY[dealtRarity(target, k)].name.toUpperCase() : ''}` : 'NOTHING ON THE TABLE',
      apply: () => {
        if (target) up.setLevel(target.id, to, k);
      },
    };
  }
  // russian roulette: the live rounds follow the downside's power, the damage the upside's (Offer.pw)
  const nLive = live(o.pwDn ?? o.toLv);
  const loaded = [false, false, false, false, false, false];
  const order = [0, 1, 2, 3, 4, 5].sort(() => rnd.next() - 0.5);
  for (let i = 0; i < nLive; i++) loaded[order[i]] = true;
  const stop = Math.floor(rnd.next() * 6);
  const bang = loaded[stop];
  return {
    kind, prop: 'chamber', win: !bang, jackpot: false, loaded, stop,
    title: bang ? 'BANG!' : 'CLICK.',
    line: bang ? '−40% MAX HEALTH  ·  THE DAMAGE STAYS' : `YOU LIVE  ·  +${+(30 * (o.pw ?? o.toLv)).toFixed(1)}% DAMAGE`,
    apply: () => {
      if (bang) hurt(0.4, true);
    },
  };
}

/** suggested SkillArt vignette families for the new cards (SkillArt falls back by category otherwise) */
export const EXTRA_ART_FAMILY: Record<string, string> = {
  bankShot: 'bottles', sixthChamber: 'dynamite', thunderhead: 'gunstorm', deadCalm: 'horus', trickShot: 'board',
  venomPuddles: 'venom', mirrorBrood: 'brood', scorpionWhip: 'pinch',
  hellfireTrail: 'fire', bulletBallet: 'board', grappleSlam: 'tumbleweed', lodestone: 'coins', comboFever: 'blood',
  thunderChamber: 'gunstorm', hellrider: 'fire', venomBrood: 'brood',
  glassCannon: 'bottles', warmGun: 'gun', heavyIron: 'gunstorm', taxman: 'coins', gimmeShelter: 'scarab', helterSkelter: 'board',
  paradiseCity: 'oasis', jumpinJack: 'rounds', paintItBlack: 'anubis', sympathyDevil: 'sekhmet', heavensDoor: 'moon', liveAndLetDie: 'dynamite',
  rollBones: 'dice', snakeEyes: 'dice', deadMansDraw: 'deadman', coinToss: 'coins', doubleNothing: 'coins', russianRoulette: 'roulette',
};

/** add the extra cards to the shared pool (idempotent; call once before the first roll) */
export function registerExtraUpgrades() {
  for (const u of [...EXTRA_UPGRADES, ...RISK_UPGRADES]) {
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
  /** curses' bite throttles (real hunt seconds) */
  private blackT = 0;
  private singeT = 0;

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
      ev.on('explosion', (at: { x: number; y: number; z: number }, r: number, _d: number, owner: string) => this.onBlast(at, r, owner)),
    );
  }

  /** an upgrade's power: levels × dealt-tier multipliers (0 when not taken) */
  private lv(id: string) {
    return this.up.pw(id);
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

  /** Live and Let Die: your own blasts singe you */
  private onBlast(at: { x: number; y: number; z: number }, r: number, owner: string) {
    const pl = this.player;
    if (!this.lv('liveAndLetDie') || owner !== 'player' || !pl.alive) return;
    if (Math.hypot(pl.pos.x - at.x, pl.pos.y - at.y, pl.pos.z - at.z) > r || this.ctx.run.time - this.singeT < 0.3) return;
    this.singeT = this.ctx.run.time;
    pl.hp = Math.max(1, pl.hp - pl.maxHp * 0.04 * Math.max(1, this.up.pwDn('liveAndLetDie')));
    pl.hurtFlash = 1;
    this.ctx.fx.flames({ x: pl.pos.x, y: pl.pos.y + 0.6, z: pl.pos.z }, 4, 0.7);
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
    // Paint It Black: every crit you land draws a little of your own blood
    const pb = this.up.pwDn('paintItBlack');
    if (pb && res?.crit && (hit.source === 'gun' || hit.source === 'melee') && ctx.run.time - this.blackT > 0.12 && this.player.alive) {
      this.blackT = ctx.run.time;
      this.player.hp = Math.max(1, this.player.hp - pb);
      if (rnd.chance(0.35)) ctx.particles.emit({ pos: this.player.center(new THREE.Vector3()), count: 3, spread: 1.2, life: [0.3, 0.5], size: [0.06, 0.02], sprite: ['blood0', 'blood1'], color: 0xffffff, gravity: 6 });
    }
    const th = this.lv('thunderhead');
    if (th && res?.crit && hit.source === 'gun' && !hit.tags?.includes('chain')) {
      let from: EnemyLike = e;
      const seen = new Set([e.id]);
      for (let i = 0; i < 1 + cnt(th); i++) {
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
    if (mb && ct !== undefined && ctx.run.time - ct < 0.3 && rnd.chance(Math.min(1, 0.25 + 0.15 * mb))) this.phantom(e.pos, 5 + mb);
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
