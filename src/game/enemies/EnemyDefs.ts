// Enemy roster: stats, AI archetype, attacks, weaknesses, wave availability.
// Rigs are resolved by registry name at runtime (see EnemyRender).
import type { StatusResist } from '../combat/Status';
import type { HitKind } from '../fx/Fx';

export type AiKind =
  | 'chaser' | 'ranged' | 'tank' | 'leaper' | 'swarm' | 'charger' | 'flyer' | 'rider'
  | 'bomber' | 'support' | 'sniper' | 'fleer' | 'ambusher' | 'whipper' | 'lobber';

export type AttackKind = 'melee' | 'burst' | 'fan' | 'ring' | 'spiral' | 'snipe' | 'lob' | 'leap' | 'charge' | 'explode' | 'aura' | 'lasso' | 'whip' | 'music' | 'volley' | 'dive' | 'vortex';

export interface AttackDef {
  kind: AttackKind;
  range: number;
  minRange?: number;
  cooldown: number;
  windup: number;
  dmg: number;
  count?: number; // projectiles
  spread?: number; // radians
  speed?: number; // projectile speed
  proj?: ProjKind;
  status?: { id: any; stacks: number; dur: number }[];
  radius?: number;
  alphaOnly?: boolean;
}

export type ProjKind = 'bullet' | 'venom' | 'curse' | 'dung' | 'arrow' | 'sand' | 'needle' | 'dynamite' | 'bone';

export interface EnemyDef {
  id: string;
  name: string;
  title: string; // wanted-poster flavour
  rig: string; // registry key
  rigAlpha: string;
  hp: number;
  armor: number;
  physRes: number;
  magicRes: number;
  statusRes: StatusResist;
  speed: number;
  radius: number;
  height: number;
  ai: AiKind;
  attacks: AttackDef[];
  contact: number; // contact damage per touch
  bounty: number;
  gold: [number, number];
  hitKind: HitKind;
  weakness: string;
  flying?: boolean;
  firstWave: number;
  weight: number;
  group?: [number, number];
  /** front shield: damage multiplier taken from the front arc */
  frontGuard?: number;
  burnMul?: number;
  thorns?: number;
  special?: string;
  lore: string;
}

export const ENEMIES: Record<string, EnemyDef> = {
  husk: {
    id: 'husk', name: 'Sand Husk', title: 'Dried & Dangerous', rig: 'husk', rigAlpha: 'husk_alpha',
    hp: 30, armor: 0, physRes: 0, magicRes: 0, statusRes: { burn: -0.5 }, speed: 3.6, radius: 0.45, height: 1.75,
    ai: 'chaser', attacks: [{ kind: 'melee', range: 1.9, cooldown: 1.4, windup: 0.45, dmg: 9 }, { kind: 'vortex', range: 9, cooldown: 7, windup: 1, dmg: 6, radius: 7, alphaOnly: true }],
    contact: 5, bounty: 3, gold: [0, 2], hitKind: 'linen', weakness: 'Burns easily. Crumbles to headshots.',
    firstWave: 1, weight: 10, group: [3, 6], burnMul: 1.6, lore: 'Outlaws Set buried alive, now hungry for the living. They claw out of the dunes when the storm sings.',
  },
  gunslinger: {
    id: 'gunslinger', name: 'Skeletal Gunslinger', title: 'Quickest Draw in the Afterlife', rig: 'gunslinger', rigAlpha: 'gunslinger_alpha',
    hp: 26, armor: 5, physRes: 0, magicRes: 0.1, statusRes: { bleed: 1 }, speed: 5, radius: 0.42, height: 1.85,
    ai: 'ranged', attacks: [{ kind: 'burst', range: 30, minRange: 10, cooldown: 2.6, windup: 0.55, dmg: 7, count: 3, speed: 22, proj: 'bullet' }, { kind: 'spiral', range: 26, cooldown: 7, windup: 0.8, dmg: 6, count: 24, speed: 14, proj: 'bullet', alphaOnly: true }],
    contact: 4, bounty: 6, gold: [1, 3], hitKind: 'bone', weakness: 'Skulls shatter: headshots deal massive damage. Immune to bleeding.',
    firstWave: 2, weight: 6, group: [1, 3], lore: 'Six-shooters bound to Set by a crooked deal. They still argue about who drew first.',
  },
  mummy: {
    id: 'mummy', name: 'Cursed Mummy', title: 'Wrapped in Spite', rig: 'mummy', rigAlpha: 'mummy_alpha',
    hp: 120, armor: 45, physRes: 0.1, magicRes: 0.25, statusRes: { poison: 0.3, curse: 1, burn: -1 }, speed: 2.7, radius: 0.55, height: 1.95,
    ai: 'tank', attacks: [{ kind: 'melee', range: 2.3, cooldown: 2, windup: 0.75, dmg: 18, status: [{ id: 'curse', stacks: 2, dur: 6 }] }, { kind: 'aura', range: 5, cooldown: 3, windup: 0.4, dmg: 3, radius: 5, status: [{ id: 'curse', stacks: 1, dur: 5 }] }],
    contact: 8, bounty: 12, gold: [2, 5], hitKind: 'linen', weakness: 'Heavily armored — break armor or set the linen on fire (burn ×2). Immune to curses.',
    firstWave: 6, weight: 4, burnMul: 2, lore: 'Sekhmet\'s rage sleeps in their linen. Their hearts still beat, glowing and wrong.',
  },
  jackal: {
    id: 'jackal', name: 'Jackal Warrior', title: 'Fangs of the Weighing', rig: 'jackal', rigAlpha: 'jackal_alpha',
    hp: 60, armor: 20, physRes: 0.1, magicRes: 0.1, statusRes: {}, speed: 7.2, radius: 0.48, height: 2.05,
    ai: 'leaper', attacks: [{ kind: 'melee', range: 2.4, cooldown: 1.3, windup: 0.4, dmg: 12, status: [{ id: 'bleed', stacks: 1, dur: 3 }] }, { kind: 'leap', range: 12, minRange: 5, cooldown: 4.5, windup: 0.5, dmg: 16 }],
    contact: 6, bounty: 10, gold: [1, 4], hitKind: 'flesh', weakness: 'Round shield blocks frontal gunfire (−65%). Flank them, use scorpions or explosions.',
    firstWave: 9, weight: 4, frontGuard: 0.35, lore: 'Anubis\'s temple guard, bribed by Set with stolen gold. Their kohl never smudges.',
  },
  scarab: {
    id: 'scarab', name: 'Scarab Swarmer', title: 'Many Legs, No Manners', rig: 'scarab', rigAlpha: 'scarab_alpha',
    hp: 14, armor: 15, physRes: 0.25, magicRes: 0, statusRes: {}, speed: 9, radius: 0.35, height: 0.55,
    ai: 'swarm', attacks: [{ kind: 'melee', range: 1.3, cooldown: 1, windup: 0.25, dmg: 5 }],
    contact: 4, bounty: 1.5, gold: [0, 1], hitKind: 'chitin', weakness: 'Shells shrug off bullets; explosions flip them belly-up for big damage.',
    firstWave: 4, weight: 6, group: [6, 10], lore: 'Khepri\'s little rollers, fed on Set\'s chaos until they forgot the sun.',
  },
  giantScorpion: {
    id: 'giantScorpion', name: 'Giant Scorpion', title: 'Eight Legs of Bad News', rig: 'giant_scorpion', rigAlpha: 'giant_scorpion_alpha',
    hp: 260, armor: 30, physRes: 0.1, magicRes: 0.2, statusRes: { poison: 0.85 }, speed: 5, radius: 1.3, height: 1.6,
    ai: 'charger', attacks: [{ kind: 'lob', range: 24, minRange: 6, cooldown: 3.2, windup: 0.8, dmg: 9, count: 3, speed: 14, proj: 'venom', status: [{ id: 'poison', stacks: 3, dur: 4 }] }, { kind: 'charge', range: 20, minRange: 6, cooldown: 6, windup: 0.9, dmg: 22 }, { kind: 'melee', range: 3, cooldown: 1.6, windup: 0.5, dmg: 16 }],
    contact: 10, bounty: 30, gold: [4, 9], hitKind: 'chitin', weakness: 'Nearly immune to poison — Serket\'s own children. Use raw firepower, fire and armor break.',
    firstWave: 14, weight: 2, lore: 'Serket\'s brood, stolen and twisted. Pinch refuses to look at them.',
  },
  vulture: {
    id: 'vulture', name: 'Bone Vulture', title: 'Circling Your Wallet', rig: 'vulture', rigAlpha: 'vulture_alpha',
    hp: 22, armor: 0, physRes: 0, magicRes: 0, statusRes: {}, speed: 9, radius: 0.6, height: 0.9,
    ai: 'flyer', attacks: [{ kind: 'dive', range: 18, cooldown: 3.5, windup: 0.6, dmg: 10 }],
    contact: 6, bounty: 4, gold: [0, 2], hitKind: 'bone', weakness: 'Flimsy. Shoot them out of the sky mid-dive.',
    flying: true, firstWave: 7, weight: 3, group: [2, 4], lore: 'They follow bounty hunters, waiting for an easy payday.',
  },
  outlaw: {
    id: 'outlaw', name: 'Dune Outlaw', title: 'Wanted: For Everything', rig: 'outlaw_rider', rigAlpha: 'outlaw_rider_alpha',
    hp: 45, armor: 10, physRes: 0, magicRes: 0, statusRes: {}, speed: 15, radius: 0.5, height: 1.85,
    ai: 'rider', attacks: [{ kind: 'fan', range: 26, cooldown: 2.4, windup: 0.5, dmg: 6, count: 5, spread: 0.5, speed: 20, proj: 'bullet' }, { kind: 'lob', range: 22, cooldown: 6, windup: 0.7, dmg: 18, count: 1, speed: 13, proj: 'dynamite', alphaOnly: true }],
    contact: 8, bounty: 9, gold: [2, 6], hitKind: 'flesh', weakness: 'Fast on a board. Grapple them or ram them at speed.',
    firstWave: 11, weight: 3, lore: 'Set\'s posse. They ride sand like water and shoot like they mean it.',
  },
  // ------------------------------------------------------------ variants
  bomberHusk: {
    id: 'bomberHusk', name: 'Bomber Husk', title: 'Has a Short Fuse', rig: 'bomber_husk', rigAlpha: 'bomber_husk_alpha',
    hp: 22, armor: 0, physRes: 0, magicRes: 0, statusRes: {}, speed: 6.2, radius: 0.45, height: 1.75,
    ai: 'bomber', attacks: [{ kind: 'explode', range: 2.2, cooldown: 99, windup: 0.55, dmg: 28, radius: 4 }],
    contact: 0, bounty: 4, gold: [0, 2], hitKind: 'linen', weakness: 'Pop it early — the blast hurts its friends too.',
    firstWave: 5, weight: 3, special: 'chainExplode', lore: 'Dynamite was cheaper than loyalty. He did not read the label.',
  },
  cactusHusk: {
    id: 'cactusHusk', name: 'Cactus Husk', title: 'Prickly Personality', rig: 'cactus_husk', rigAlpha: 'cactus_husk_alpha',
    hp: 48, armor: 8, physRes: 0, magicRes: 0, statusRes: { burn: -0.5 }, speed: 3.2, radius: 0.5, height: 1.85,
    ai: 'chaser', attacks: [{ kind: 'melee', range: 2, cooldown: 1.5, windup: 0.5, dmg: 11 }, { kind: 'ring', range: 7, cooldown: 5, windup: 0.6, dmg: 5, count: 12, speed: 12, proj: 'needle' }],
    contact: 9, bounty: 5, gold: [0, 2], hitKind: 'wood', weakness: 'Thorns punish melee. Burn it.', thorns: 6,
    firstWave: 12, weight: 2, burnMul: 1.8, lore: 'Fell asleep in the shade of a saguaro for ninety years. They grew close.',
  },
  dungSkeleton: {
    id: 'dungSkeleton', name: 'Dung Skeleton', title: 'Smells Like Victory (It Is Not)', rig: 'dung_skeleton', rigAlpha: 'dung_skeleton_alpha',
    hp: 34, armor: 2, physRes: 0, magicRes: 0, statusRes: { poison: 0.5 }, speed: 4.2, radius: 0.45, height: 1.8,
    ai: 'lobber', attacks: [{ kind: 'lob', range: 20, minRange: 4, cooldown: 2.4, windup: 0.6, dmg: 6, count: 1, speed: 12, proj: 'dung', status: [{ id: 'slow', stacks: 1, dur: 2 }] }],
    contact: 4, bounty: 5, gold: [0, 3], hitKind: 'bone', weakness: 'Bursts into a stinky cloud. Do not stand in it.', special: 'stinkCloud',
    firstWave: 8, weight: 2, lore: 'A dung beetle\'s revenge given bones. Nobody stands downwind of the funeral.',
  },
  mariachi: {
    id: 'mariachi', name: 'Mariachi Bones', title: 'Plays Requests (Only Sad Ones)', rig: 'mariachi', rigAlpha: 'mariachi_alpha',
    hp: 40, armor: 4, physRes: 0, magicRes: 0.1, statusRes: { bleed: 1 }, speed: 3.8, radius: 0.45, height: 1.9,
    ai: 'support', attacks: [{ kind: 'music', range: 12, cooldown: 4, windup: 0.3, dmg: 0, radius: 12 }],
    contact: 3, bounty: 12, gold: [2, 6], hitKind: 'bone', weakness: 'Buffs nearby enemies (+30% speed, +20% damage). Shoot the band first!',
    firstWave: 10, weight: 1.5, special: 'buffAura', lore: 'He has played one song for two hundred years. The dead love it.',
  },
  sharpshooter: {
    id: 'sharpshooter', name: 'Bone Sharpshooter', title: 'Never Misses (Rarely)', rig: 'sharpshooter', rigAlpha: 'sharpshooter_alpha',
    hp: 30, armor: 4, physRes: 0, magicRes: 0, statusRes: { bleed: 1 }, speed: 4, radius: 0.42, height: 2.0,
    ai: 'sniper', attacks: [{ kind: 'snipe', range: 55, minRange: 18, cooldown: 4.5, windup: 1.3, dmg: 24, speed: 90, proj: 'bullet' }],
    contact: 3, bounty: 10, gold: [2, 5], hitKind: 'bone', weakness: 'Red laser = incoming. Break line of sight or jump.',
    firstWave: 13, weight: 1.5, lore: 'One eye, one rifle, one grudge.',
  },
  shotgunner: {
    id: 'shotgunner', name: 'Scattergun Sam', title: 'Wide Load', rig: 'shotgunner', rigAlpha: 'shotgunner_alpha',
    hp: 58, armor: 12, physRes: 0.05, magicRes: 0, statusRes: {}, speed: 4.4, radius: 0.55, height: 1.85,
    ai: 'ranged', attacks: [{ kind: 'fan', range: 16, minRange: 4, cooldown: 2.8, windup: 0.6, dmg: 6, count: 9, spread: 0.9, speed: 17, proj: 'bullet' }],
    contact: 6, bounty: 9, gold: [1, 4], hitKind: 'flesh', weakness: 'Devastating up close. Keep your distance or kick him.',
    firstWave: 16, weight: 2, lore: 'Loads nails, bolts and spite into both barrels.',
  },
  bombScarab: {
    id: 'bombScarab', name: 'Tick-Tock Scarab', title: 'Running Late', rig: 'bomb_scarab', rigAlpha: 'bomb_scarab_alpha',
    hp: 10, armor: 5, physRes: 0.1, magicRes: 0, statusRes: {}, speed: 10, radius: 0.38, height: 0.85,
    ai: 'bomber', attacks: [{ kind: 'explode', range: 1.6, cooldown: 99, windup: 0.4, dmg: 16, radius: 3 }],
    contact: 0, bounty: 2, gold: [0, 1], hitKind: 'chitin', weakness: 'Fragile. Shoot before it reaches you.', special: 'chainExplode',
    firstWave: 15, weight: 2, group: [3, 5], lore: 'Someone strapped a clock to a scarab. It took the job very seriously.',
  },
  goldenScarab: {
    id: 'goldenScarab', name: 'Golden Scarab', title: 'Worth Its Weight', rig: 'golden_scarab', rigAlpha: 'golden_scarab_alpha',
    hp: 70, armor: 25, physRes: 0.2, magicRes: 0.2, statusRes: {}, speed: 11, radius: 0.45, height: 0.6,
    ai: 'fleer', attacks: [], contact: 0, bounty: 20, gold: [25, 45], hitKind: 'armor', weakness: 'Runs away! Drops a fortune if you catch it.', special: 'treasure',
    firstWave: 3, weight: 0.4, lore: 'Khepri\'s piggy bank. Very fast. Very shiny. Very rude.',
  },
  tumbleweedBandit: {
    id: 'tumbleweedBandit', name: 'Tumbleweed Bandit', title: 'Master of Disguise (Questionable)', rig: 'tumbleweed_bandit', rigAlpha: 'tumbleweed_bandit_alpha',
    hp: 40, armor: 4, physRes: 0, magicRes: 0, statusRes: { burn: -1 }, speed: 7, radius: 0.6, height: 1.4,
    ai: 'ambusher', attacks: [{ kind: 'burst', range: 18, cooldown: 2.2, windup: 0.35, dmg: 7, count: 4, speed: 22, proj: 'bullet' }],
    contact: 5, bounty: 8, gold: [1, 5], hitKind: 'wood', weakness: 'Burns like kindling. That tumbleweed is staring at you.', burnMul: 2,
    firstWave: 9, weight: 1.5, lore: 'Nobody suspects the tumbleweed. Everybody should.',
  },
  lassoRider: {
    id: 'lassoRider', name: 'Lasso Lucy', title: 'Ropes Gods for Fun', rig: 'lasso_rider', rigAlpha: 'lasso_rider_alpha',
    hp: 50, armor: 8, physRes: 0, magicRes: 0, statusRes: {}, speed: 16, radius: 0.5, height: 1.85,
    ai: 'rider', attacks: [{ kind: 'lasso', range: 14, cooldown: 6, windup: 0.8, dmg: 4, status: [{ id: 'slow', stacks: 1, dur: 1.5 }] }],
    contact: 8, bounty: 10, gold: [2, 6], hitKind: 'flesh', weakness: 'A lasso slows and drags you — jump or boost to break free.',
    firstWave: 18, weight: 1.5, lore: 'She roped a sandworm once. Allegedly.',
  },
  jackalArcher: {
    id: 'jackalArcher', name: 'Jackal Archer', title: 'Arrows of Judgement', rig: 'jackal_archer', rigAlpha: 'jackal_archer_alpha',
    hp: 40, armor: 10, physRes: 0, magicRes: 0.1, statusRes: {}, speed: 6, radius: 0.45, height: 2.0,
    ai: 'ranged', attacks: [{ kind: 'volley', range: 32, minRange: 10, cooldown: 3.2, windup: 0.7, dmg: 7, count: 5, spread: 0.35, speed: 16, proj: 'arrow' }],
    contact: 5, bounty: 8, gold: [1, 4], hitKind: 'flesh', weakness: 'Arrows arc — keep moving laterally.',
    firstWave: 20, weight: 2, lore: 'They aim at the heart, then weigh it.',
  },
  bandageWhipper: {
    id: 'bandageWhipper', name: 'Bandage Whipper', title: 'Unravelling Menace', rig: 'bandage_whipper', rigAlpha: 'bandage_whipper_alpha',
    hp: 75, armor: 25, physRes: 0.05, magicRes: 0.2, statusRes: { curse: 1, burn: -1 }, speed: 3.4, radius: 0.5, height: 1.95,
    ai: 'whipper', attacks: [{ kind: 'whip', range: 8, minRange: 2, cooldown: 2.6, windup: 0.7, dmg: 14, status: [{ id: 'slow', stacks: 1, dur: 1.5 }] }],
    contact: 6, bounty: 10, gold: [1, 4], hitKind: 'linen', weakness: 'Whip has a long telegraph — side-step it. Burns easily.', burnMul: 2,
    firstWave: 22, weight: 2, lore: 'Unwrapped one arm to make a better weapon. Regrets nothing.',
  },
};

/** wave → spawn table weights */
export function rosterFor(wave: number) {
  return Object.values(ENEMIES).filter((d) => d.firstWave <= wave && d.weight > 0);
}

/** difficulty multipliers per wave (1..100) */
export function waveScale(wave: number) {
  const w = wave - 1;
  return {
    hp: 1 + w * 0.085 + Math.pow(w / 22, 2.2),
    dmg: 1 + w * 0.03 + Math.pow(w / 40, 2),
    speed: 1 + Math.min(0.35, w * 0.0045),
    count: 1 + w * 0.06,
    alphaChance: Math.min(0.08, 0.004 + w * 0.0011),
  };
}
