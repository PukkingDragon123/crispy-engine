// Cleopatra's animal-human army: the soldiers' stats, moves and lore, plus the
// river vessels and shore batteries (ai 'vessel': Enemies.spawn hands those to
// the Nile fleet, which floats the hull and spawns the crew as ordinary enemies).
// Every id here is tagged stage 'nile': the desert roster never draws them; the
// Nile wave table picks them by id. Moves are song titles (Stones / GN'R / Beatles).
import type { EnemyDef } from './EnemyDefs';

const nile = (d: Omit<EnemyDef, 'stage'>): EnemyDef => ({ ...d, stage: 'nile' });

export const NILE_ARMY: Record<string, EnemyDef> = {
  nileWolf: nile({
    id: 'nileWolf', name: 'Wolf Legionary', title: 'The Shield Wall Howls', rig: 'nile_wolf', rigAlpha: 'nile_wolf_alpha', variants: ['nile_wolf', 'nile_wolf_v1', 'nile_wolf_v2'],
    hp: 70, armor: 22, physRes: 0.08, magicRes: 0.05, statusRes: {}, speed: 6.4, radius: 0.5, height: 1.9,
    ai: 'leaper', attacks: [
      { kind: 'melee', range: 2.5, cooldown: 1.4, windup: 0.45, dmg: 13, status: [{ id: 'bleed', stacks: 1, dur: 3 }] },
      { kind: 'leap', range: 11, minRange: 4.5, cooldown: 5, windup: 0.65, dmg: 15 },
    ],
    contact: 6, bounty: 11, gold: [1, 4], hitKind: 'flesh', frontGuard: 0.3,
    weakness: 'Its cowhide shield turns shots from the front (-70%). Circle around it, or blow it off its feet.',
    firstWave: 1, weight: 4, group: [2, 4],
    lore: "Wepwawet's sons, the Openers of the Ways, sold to the Queen for river silver. They march in step and bite out of it.",
  }),
  nileJackalSpear: nile({
    id: 'nileJackalSpear', name: 'Jackal Spearman', title: 'Two Metres of Bad News', rig: 'nile_jackal_spear', rigAlpha: 'nile_jackal_spear_alpha', variants: ['nile_jackal_spear', 'nile_jackal_spear_v1'],
    hp: 55, armor: 14, physRes: 0.05, magicRes: 0.05, statusRes: {}, speed: 6.0, radius: 0.45, height: 2.08,
    ai: 'chaser', attacks: [
      { kind: 'melee', range: 3.6, cooldown: 1.6, windup: 0.5, dmg: 12 },
      { kind: 'charge', range: 16, minRange: 6, cooldown: 7, windup: 0.85, dmg: 20, qte: true },
      { kind: 'volley', range: 24, minRange: 9, cooldown: 6, windup: 0.8, dmg: 9, count: 1, spread: 0, speed: 19, proj: 'arrow' },
    ],
    contact: 5, bounty: 10, gold: [1, 4], hitKind: 'flesh',
    weakness: 'Long reach and a running lunge (dodge it). Get inside the spear, or drop him at range before he closes.',
    firstWave: 1, weight: 4, group: [2, 3],
    lore: 'The Queen dressed them in linen and gave them the longest spears on the river. Nobody told them about guns.',
  }),
  nileHippo: nile({
    id: 'nileHippo', name: 'Hippo Shieldbearer', title: 'The River Wall', rig: 'nile_hippo', rigAlpha: 'nile_hippo_alpha', variants: ['nile_hippo', 'nile_hippo_v1'],
    hp: 210, armor: 45, physRes: 0.15, magicRes: 0.1, statusRes: { bleed: 0.3 }, speed: 3.0, radius: 0.78, height: 2.45,
    ai: 'tank', attacks: [
      { kind: 'melee', range: 2.8, cooldown: 2.2, windup: 0.8, dmg: 22 },
      { kind: 'charge', range: 18, minRange: 5, cooldown: 8, windup: 1.0, dmg: 26, qte: true },
      { kind: 'aura', range: 5.5, cooldown: 6, windup: 0.9, dmg: 10, radius: 5.5, alphaOnly: true },
    ],
    contact: 10, bounty: 26, gold: [3, 8], hitKind: 'armor', frontGuard: 0.15,
    weakness: 'The tower shield turns nearly everything from the front. Flank it, break its armour, or sidestep the charge and hit its back.',
    firstWave: 4, weight: 1.6, group: [1, 1],
    lore: 'Taweret-blessed river horses who guard the Queen\'s landings. They yawn before they charge. Never mistake it for boredom.',
  }),
  nileFalcon: nile({
    id: 'nileFalcon', name: 'Falcon Archer', title: 'Eyes of the Upper River', rig: 'nile_falcon', rigAlpha: 'nile_falcon_alpha', variants: ['nile_falcon', 'nile_falcon_v1'],
    hp: 36, armor: 6, physRes: 0, magicRes: 0.05, statusRes: {}, speed: 6.2, radius: 0.42, height: 1.72,
    ai: 'ranged', attacks: [
      { kind: 'volley', range: 34, minRange: 10, cooldown: 3.4, windup: 0.75, dmg: 7, count: 5, spread: 0.4, speed: 17, proj: 'arrow' },
      { kind: 'snipe', range: 50, minRange: 16, cooldown: 6, windup: 1.3, dmg: 22, speed: 80, proj: 'arrow', alphaOnly: true },
    ],
    contact: 4, bounty: 8, gold: [1, 4], hitKind: 'flesh',
    weakness: 'Arrows arc: keep moving sideways. Light-boned and fragile up close.',
    firstWave: 2, weight: 3, group: [2, 3],
    lore: 'They see a scarab move from a mile up and a bounty hunter from two. They aim for the heart, out of habit.',
  }),
  nileBaboon: nile({
    id: 'nileBaboon', name: 'Baboon Cannoneer', title: "Lights the Queen's Fuses", rig: 'nile_baboon', rigAlpha: 'nile_baboon_alpha', variants: ['nile_baboon', 'nile_baboon_v1'],
    hp: 60, armor: 10, physRes: 0, magicRes: 0, statusRes: { burn: 0.4 }, speed: 4.6, radius: 0.48, height: 1.72,
    ai: 'lobber', attacks: [
      { kind: 'lob', range: 24, minRange: 5, cooldown: 3.6, windup: 0.8, dmg: 14, count: 1, speed: 13, proj: 'dynamite' },
    ],
    contact: 5, bounty: 10, gold: [2, 5], hitKind: 'flesh', moveTitles: { cannon: "Can't You Hear Me Knocking" },
    weakness: 'Kill the gunner and his cannon falls silent. His fire-pots burst on landing: keep moving.',
    firstWave: 3, weight: 2, group: [1, 2],
    lore: 'Thoth\'s old baboons were scribes. These ones learned gunpowder instead, and they still keep very careful notes.',
  }),
  nileRam: nile({
    id: 'nileRam', name: 'Ram War-Drummer', title: 'Sets the Pace of Pain', rig: 'nile_ram', rigAlpha: 'nile_ram_alpha', variants: ['nile_ram', 'nile_ram_v1'],
    hp: 80, armor: 12, physRes: 0.05, magicRes: 0.1, statusRes: {}, speed: 4.0, radius: 0.48, height: 1.85,
    ai: 'support', attacks: [
      { kind: 'music', range: 12, cooldown: 4, windup: 0.3, dmg: 0, radius: 12 },
      { kind: 'charge', range: 14, minRange: 4, cooldown: 7, windup: 0.8, dmg: 16 },
    ],
    contact: 6, bounty: 13, gold: [2, 6], hitKind: 'flesh', special: 'buffAura',
    weakness: 'The war drum speeds up everything near it (+30% speed, +20% damage). Silence the drummer first.',
    firstWave: 5, weight: 1.2, group: [1, 1],
    lore: 'Khnum shaped men on a potter\'s wheel. His rams shape a battle on a drum, and the whole river keeps time.',
  }),
  // ------------------------------------------------------------ vessels and batteries (run by NileFleet)
  reedBoat: nile({
    id: 'reedBoat', name: 'Reed Skiff', title: 'Papyrus and Arrows', rig: 'nile_reed_boat', rigAlpha: 'nile_reed_boat',
    hp: 260, armor: 10, physRes: 0, magicRes: 0, statusRes: { burn: -0.5 }, speed: 7.5, radius: 3, height: 2.4,
    ai: 'vessel', attacks: [], contact: 0, bounty: 14, gold: [3, 7], hitKind: 'wood',
    weakness: 'Shoot the crew off, or break the bundled hull and watch it sink. Jump aboard to fight on deck.',
    firstWave: 3, weight: 1.2, group: [1, 1], moveTitles: { volley: 'Run for Your Life', ram: 'Sway' },
    lore: 'Bundled papyrus, a bronze-shod prow and three soldiers who were promised it would not leak.',
  }),
  warBarge: nile({
    id: 'warBarge', name: 'War Barge', title: 'Cedar, Bronze and Bad Intentions', rig: 'nile_war_barge', rigAlpha: 'nile_war_barge',
    hp: 760, armor: 25, physRes: 0.1, magicRes: 0, statusRes: { burn: -0.3 }, speed: 6, radius: 6, height: 5,
    ai: 'vessel', attacks: [], contact: 0, bounty: 40, gold: [8, 16], hitKind: 'wood',
    weakness: 'Broadsides walk across the water in lanes. Break the bow, waist or stern to sink it, or board and clear the deck.',
    firstWave: 8, weight: 0.6, group: [1, 1], moveTitles: { broadside: 'Revolution', drum: 'Happy' },
    lore: 'Lebanese cedar, a bronze lion on the prow and a cannon where the god used to sit. The rowers are paid by the corpse.',
  }),
  bankCannon: nile({
    id: 'bankCannon', name: 'Bank Cannon', title: 'Bronze Thunder on the Shore', rig: 'nile_cannon', rigAlpha: 'nile_cannon',
    hp: 220, armor: 30, physRes: 0.1, magicRes: 0, statusRes: {}, speed: 0, radius: 1.6, height: 1.6,
    ai: 'vessel', attacks: [], contact: 0, bounty: 18, gold: [4, 8], hitKind: 'armor',
    weakness: 'A red ring marks where the ball lands. Kill the baboon gunners, or blow the powder jars beside the gun.',
    firstWave: 6, weight: 0.8, group: [1, 1], moveTitles: { fire: 'Shine a Light' },
    lore: 'Cast in the temple foundry from melted-down offering bowls. The priests are still upset.',
  }),
};

/** every move gets a song title (titles only), by attack index */
export const NILE_SONGS: Record<string, string[]> = {
  nileWolf: ['Out ta Get Me', 'Rocket Queen'],
  nileJackalSpear: ['Brown Sugar', 'Ticket to Ride', 'Dead Flowers'],
  nileHippo: ['Mean Mr. Mustard', 'Get in the Ring', 'Rip This Joint'],
  nileFalcon: ['And Your Bird Can Sing', 'Blackbird'],
  nileBaboon: ['Monkey Man'],
  nileRam: ['Honky Tonk Women', 'Rocks Off'],
};

/** the soldier ids (for the Nile wave table) and the vessel ids */
export const NILE_SOLDIERS = ['nileWolf', 'nileJackalSpear', 'nileHippo', 'nileFalcon', 'nileBaboon', 'nileRam'];
export const NILE_VESSELS = ['reedBoat', 'warBarge', 'bankCannon'];
