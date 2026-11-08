// The Codex: Sundown's old leather field book. Every enemy, boss, critter, piece of
// loot, blueprint, place and legend of Serket's Reach has an entry. Entries are
// discovered (first sighting, first kill, finding the thing, owning the blueprint,
// riding into the place) and every discovery is worth points; points climb a rank
// ladder from Greenhorn to Legend of the Dunes.
//
// State lives in the save (`book.f`: entry key → flag bits). Points are derived
// from the flags, so they can never drift from what the book shows.
//
//   Codex.discover('bounty', 'husk', 'kill')    → points gained (0 if nothing new)
//   Codex.listen(ctx.events, () => kills)        → wires the run's events (returns an unsubscribe)
//   Codex.onDiscover((d) => ...)                 → the in-run toast hooks in here
//   Codex.rides(key) / Codex.claims(key)         → tallies Thoth's research reads (rides it was met on,
//                                                   times it was claimed: defeated, found, worn, used)
import { loadSave, writeSave, GUN_PARTS, GUN_PERKS, BOARDS, PRICES } from './Save';
import { ENEMIES, EnemyDef } from '../enemies/EnemyDefs';
import { GEAR, GEAR_IDS, GearDef } from '../player/Equipment';
import { ITEMS } from '../player/Items';
import { SUBAREAS } from '../world/RegionGen';
import { blueprintDefs, RELICS, REGION_NAMES, WEAPON_UPGRADES } from './Blueprints';
import type { EventBus } from '../Ctx';

export type CodexCat = 'bounty' | 'boss' | 'wildlife' | 'loot' | 'blueprint' | 'place' | 'legend';
/** how far an entry is known: seen it, claimed it (killed / defeated / found / owned), mastered it */
export type CodexLevel = 'sight' | 'kill' | 'master';

export const F_SEEN = 1;
export const F_CLAIM = 2;
export const F_MASTER = 4;
/** read in the book since it changed (clears the NEW mark) */
export const F_READ = 8;

/** kills of one kind for the mastery stamp */
export const MASTER_KILLS = 25;

export interface CodexEntry {
  key: string;
  cat: CodexCat;
  id: string;
  /** index inside its section (plate number) */
  n: number;
  name: string;
  title: string;
  lore: string;
  /** a live animated enemy (EnemyDefs id) */
  enemy?: string;
  /** a rig or static model from the registry (or one of the special builders, see ui/codex/Plate) */
  model?: string;
  /** place dioramas: the zone theme */
  theme?: string;
  /** typeset stats (label, value) */
  stats?: [string, string][];
  /** named moves (song titles) */
  moves?: string[];
  weak?: string;
  /** how to find it, shown while locked */
  hint: string;
  pts: { sight?: number; kill?: number; master?: number };
  /** discovering any of these keys also discovers this entry (sighting level) */
  via?: string[];
  /** the plate's print style */
  plate?: 'paint' | 'blueprint';
  /** words for the stamps: claimed / mastered */
  claimWord?: string;
}

export interface CodexSection {
  cat: CodexCat;
  name: string;
  tab: string;
  blurb: string;
  epigraph: string;
  entries: CodexEntry[];
  /** tab leather colour */
  color: number;
}

export interface Discovery {
  entry: CodexEntry;
  level: CodexLevel;
  points: number;
  /** a brand-new entry (not just a deeper level of a known one) */
  fresh: boolean;
}

// ======================================================================= content
const BOSSES: { id: string; name: string; title: string; model: string; lore: string; weak: string; waves: string; hp: string; names?: string[] }[] = [
  { id: 'khonsu', name: 'Avatar of Khonsu', title: 'He Who Wanders the Night', model: 'khonsu_avatar', waves: '5 · 35 · 65', hp: '2600 per tier', lore: 'A mummy three men tall, wound in moon-silver and gold, swinging a crescent scythe. When the night runs long it calls down the very hand of the moon god to crush the ground flat.', weak: 'The scythe sticks in the sand after a sweep: that is your opening. Watch the sky in the last phase.' },
  { id: 'khonsuSand', name: 'Khonsu of the Sands', title: 'Lord of the Shifting Sands', model: 'khonsu_sand', waves: '75', hp: '15600', lore: 'At the heart of the oasis Khonsu stops pretending to be a body. The desert itself stands up in his shape, and every dune is his fist.', weak: 'The sand-forms burst when struck hard enough. Keep moving: the ground is the boss.' },
  { id: 'sethos', name: 'Sethos', title: 'Hand of Set', model: 'sethos_1', waves: '50 · 85', hp: '9000 · 15000', lore: 'High priest of the Red God and keeper of the storm wall. He carried Set\'s will across the Reach and he does not like trespassers on it.', weak: 'His phases break at two thirds and one third. Interrupt the storm chant with heavy hits.' },
  { id: 'setAvatar', name: 'Avatar of Set', title: 'The Red God Walks', model: 'sethos_3', waves: '100', hp: '26000', lore: 'At the Apex of the Red Pyramid the priest burns away and the god walks in his skin. The storm is his breath. Nobody has written the rest of this page.', weak: 'Unknown. Bring everything.' },
  { id: 'bertha', name: 'Big Bertha', title: 'Mother of a Thousand Stings', model: 'big_bertha', waves: '45, then on rotation', hp: '2400 per tier', lore: 'The scorpion queen of the outer sands. Her brood rides on her back and her tail can punch through a wagon.', weak: 'Break the brood off her back first; she slows when they fall.' },
  { id: 'marshal', name: 'The Dust Marshal', title: 'Badge of Bone', model: 'dust_marshal_1', waves: '10 · 25 · 40', hp: '3200 and up', lore: 'The last lawman of the dunes, still wearing the star they buried him with. He escapes twice. The third time, he means to finish it.', weak: 'He reloads after every six. Count them.', names: ['The Dust Marshal'] },
  { id: 'sunroller', name: 'The Sunroller', title: "Khepri's Wayward Son", model: 'sunroller', waves: '55, then on rotation', hp: '2600 per tier', lore: 'A dung beetle the size of a stagecoach that rolls a burning sun across the sand. Khepri lost track of him a long, long time ago.', weak: 'Get him off his ball. Upside down he is all belly.' },
  { id: 'pharaoh', name: 'Pharaoh Nekh-Amun', title: 'He Who Refuses to Lie Down', model: 'pharaoh', waves: '20, then on rotation', hp: '3000 per tier', lore: 'A king who would not stay in his tomb, nor let his court stay in theirs. He walks with a crook and a flail and a grudge.', weak: 'His curse aura is weakest behind him.', names: ['Pharaoh Nekh-Amun'] },
  { id: 'gulp', name: 'Old Gulp', title: 'The Dune That Eats', model: 'sandworm', waves: '30, then on rotation', hp: '3400 per tier', lore: 'The great sandworm of the Reach. You do not see Old Gulp coming. You see the sand go quiet, and then you see teeth.', weak: 'Shoot into the maw while it is open. Ride sideways when the ground trembles.' },
  { id: 'ironclad', name: 'The Ironclad', title: 'Last Train Out of the Duat', model: 'ironclad', waves: '20, then on rotation', hp: '3200 per tier', lore: 'A four-metre skeleton bolted into scavenged locomotive armour: a headlamp helm, a cow-catcher shield, a six-barrel gatling for a hand and a smokestack on his back. Every plate has to be torn off him.', weak: 'Shots ring off the plates but wear them down. Dodge the charge and he is stuck and wide open; in the last phase his furnace heart is bare.' },
  { id: 'thornback', name: 'Old Thornback', title: 'Cries Blood, Forgives Nothing', model: 'thorny_lizard_boss', waves: '15, then on rotation', hp: '2600 per tier', lore: 'The thorny-devil matriarch, with a whole cactus growing out of her back. When she weeps blood, run.', weak: 'Fire burns the cactus off her back and takes her thorns with it.' },
];

const WILDLIFE: { id: string; name: string; title: string; model: string; lore: string; hint: string }[] = [
  { id: 'camel', name: 'Dromedary', title: 'Ship of the Dunes', model: 'camel', lore: 'Ranch camels are worth their weight in water. Bandits know it too. A camel never forgets a kindness, and never forgives a short ration.', hint: 'Ranches and caravans keep them.' },
  { id: 'meerkat', name: 'Desert Meerkat', title: 'Sentinels of the Warren', model: 'meerkat', lore: 'A whole town lives under the sand. One always stands guard, and the trading meerkat will swap you anything for shiny things.', hint: 'Look for warrens of little holes in the flats.' },
  { id: 'beatles', name: 'The Beatle Meerkats', title: 'Four Lads from the Warren', model: 'meerkat_beatle_lime', lore: 'Nobody knows where they learned to play. They only perform when the colony is safe, and they only know the old songs.', hint: 'Keep a meerkat colony safe through a fight.' },
  { id: 'jerboa', name: 'Giant Jerboa', title: 'Dances When Nobody Is Looking', model: 'giant_jerboa', lore: 'A jumping desert mouse the size of a calf. Startle it and it is gone in three hops. Be patient and it dances.', hint: 'Shy. Wanders the open dunes between waves.' },
  { id: 'rainFrog', name: 'Desert Rain Frog', title: 'Squeaks at Thunder', model: 'rain_frog_mama', lore: 'A round little frog that lives where no frog should, under the damp sand by old puddles. Mama keeps her babies close and her wig closer.', hint: 'After the rare desert rain, listen for squeaking.' },
  { id: 'dungScarab', name: 'Dung Scarab', title: 'Rolls With It', model: 'dumb_scarab', lore: 'Not a fighter. A worker. It pushes its ball across the whole Reach and will not be told otherwise, not even by a bullet.', hint: 'Roams the trails pushing a dung ball.' },
  { id: 'sandHippo', name: 'Sand Hippo', title: 'Wallows in Dunes, Bites in Earnest', model: 'sand_hippo', lore: 'A hippo that traded the river for the dunes and never looked back. It wallows in the warm sand, honks at the moon and bounces anything that lands on its back. It does not mind you. It minds very much if you touch the calves.', hint: 'Herds wallow near the wild spots of every stretch.' },
  { id: 'hippoCalf', name: 'Sand Hippo Calf', title: 'Squeaks When Squeezed', model: 'sand_hippo_calf', lore: 'Round, warm and about as heavy as a sack of flour. A calf will sit on your head with its little legs paddling, and if you throw it, the whole herd comes to find out why.', hint: 'Stays close to the herd. Pick one up, if you dare.' },
];

const PLACE_LORE: Record<string, string> = {
  flats: 'Wide open hardpan where the dust devils dance. Every ride begins here.',
  canyon: 'Red walls, a dry riverbed and the rattle of a thousand snakes in the shade.',
  bones: 'Rib arches of things that died before the gods were born, half sunk in the sand.',
  temple: 'Thoth\'s house of records, slowly drowning in dunes. The ibis statues still watch.',
  outpost: 'A gulch of shacks and stolen wagons. The outlaws\' last hiding place.',
  glassdunes: 'Lightning turned the sand to glass here. It sings in the wind and cuts the unwary.',
  hollows: 'Hollow dunes riddled with scarab tunnels. The ground clicks at night.',
  obelisks: 'A field of needles: broken obelisks marching to the horizon in perfect rows.',
  mesas: 'Steps of flat-topped rock to climb with a grapple and a prayer.',
  arena: 'A ring of red mesas where the storm gathers its champions.',
  palmshore: 'The first green in a hundred miles: palms leaning over a shallow blue lake.',
  marsh: 'Reeds over your head, water to your knees and things in it you cannot see.',
  floodruins: 'A city that the oasis swallowed. Its columns stand in the water like drowned men.',
  lotustemple: 'Blue lotus and white stone. The water here heals, if you are brave enough to drink.',
  oasisheart: 'The spring at the centre of everything, where Khonsu sleeps beneath the sand.',
  stormapproach: 'The wall of Set\'s storm, a mile high and screaming.',
  sphinxavenue: 'A processional road guarded by sphinxes, each with a different face.',
  pyramidbase: 'The foot of the Red Pyramid, where the stones are as big as houses.',
  pyramidterraces: 'Climbing terraces of a god\'s house, each with its own guard.',
  apex: 'The top of the world, the eye of the storm, the seat of Set.',
};

const LEGENDS: { id: string; name: string; title: string; model: string; lore: string; hint: string; via?: string[] }[] = [
  { id: 'sundown', name: 'Sundown', title: 'The Bounty Hunter Who Came Back', model: '@hero', lore: 'A skeleton in a good hat with a fast gun and a faster board. He has died more times than he will admit, and woken up at home every time. Nobody knows how. He prefers not to ask.', hint: 'You.' },
  { id: 'pinch', name: 'Pinch', title: 'Small, Loyal, Mostly Asleep', model: 'pinch', lore: 'A scorpion who rides on Sundown\'s shoulder. Claims to be his partner. Is mostly his alarm clock.', hint: 'Always close by.' },
  { id: 'mamaToad', name: 'Mama Toad', title: 'Keeper of the Hearth', model: 'mama_toad', lore: 'She found the hideout before Sundown did and she let him stay. Knits, cooks, worries, and never once asks where the bodies came from.', hint: 'Home.' },
  { id: 'serket', name: 'Serket', title: 'Scorpion Goddess of the Reach', model: 'serket_avatar', lore: 'The goddess of the stinging things, who heals the poisoned and poisons the proud. She sent Sundown into the storm. She has her reasons.', hint: 'She is waiting at the start of every story.' },
  { id: 'anubis', name: 'Anubis', title: 'Weigher of Hearts', model: 'anubis', lore: 'The jackal who keeps the scales of the dead. Fall once in the Reach and you stand before him. Pass his trial and you walk back up into the sun.', hint: 'Only the dead meet him.' },
  { id: 'khonsu', name: 'Khonsu', title: 'The Moon Who Wanders', model: 'khonsu_hand', lore: 'God of the moon and of time. His hand can stop a night or stretch it into a week. Some say that is how the dead lose days.', hint: 'His avatar walks at wave 5.', via: ['boss:khonsu', 'boss:khonsuSand'] },
  { id: 'thoth', name: 'Thoth', title: 'Scribe of the Gods', model: 'statue_thoth', lore: 'The ibis-headed scribe who writes down every soul sent ahead. This book is a poor copy of his. He would not approve of the handwriting.', hint: 'His temple sinks in the Bonewind Dunes.', via: ['place:A3'] },
  { id: 'khepri', name: 'Khepri', title: 'The Scarab Who Rolls the Sun', model: 'golden_scarab', lore: 'Every morning Khepri rolls the sun up over the horizon. One of his children took the idea and ran with it.', hint: 'Meet his wayward son.', via: ['boss:sunroller', 'bounty:goldenScarab'] },
  { id: 'set', name: 'Set', title: 'The Red God of the Storm', model: 'statue_set', lore: 'Lord of the desert, the storm and everything that does not want you here. The storm wall is his, and so is the pyramid behind it.', hint: 'Behind the storm wall.', via: ['boss:sethos', 'place:C0'] },
  { id: 'ozymandias', name: 'Ozymandias', title: 'Tortoise of the Trading Post', model: 'tortoise_guy', lore: 'He keeps a shop on the back of Gobi, the giant wandering turtle. Look on his wares, ye mighty, and pay full price.', hint: 'Find the walking trading post.' },
];

const BOARD_LORE: Record<string, string> = {
  driftwood: 'Old ship planks from a sea that dried up before the pyramids. Honest, slow to wax, quick to forgive.',
  cactus: 'Saguaro ribs lashed with rawhide. Light, springy and only slightly prickly.',
  bone: 'A single rib from something in the Bone Garden. Rides like it remembers running.',
  scarab_gold: 'Gold-leafed scarab shell on an oak core. Fast, loud, and a target for every bandit.',
  cyber: 'Nobody knows where this one came from. It hums. It is warm to the touch. Do not ask.',
  serket: 'Serket\'s own design, lacquered black and green, with a stinger fin. Rides like venom.',
};

const PART_NAMES: Record<string, string> = {
  'barrel:standard': 'Standard Barrel', 'barrel:long': 'Long Barrel', 'barrel:snub': 'Snub-Nose Barrel', 'barrel:serket': 'Serket Barrel',
  'cylinder:standard': 'Standard Cylinder', 'cylinder:venom': 'Venom Cylinder', 'cylinder:gold': 'Gold Cylinder', 'cylinder:bone': 'Bone Cylinder',
  'grip:wood': 'Walnut Grip', 'grip:bone': 'Bone Grip', 'grip:ivory': 'Ivory Grip', 'grip:scarab': 'Scarab Grip',
  'sight:none': 'Bare Sight', 'sight:iron': 'Iron Sight', 'sight:scope': 'Brass Scope',
};

const GEAR_PTS: Record<string, number> = { common: 6, uncommon: 9, rare: 14, epic: 20, legendary: 30 };
const RARITY_WORD: Record<string, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function threat(d: EnemyDef) {
  const v = d.hp * 0.6 + d.attacks.reduce((a, b) => a + b.dmg * (b.count ?? 1), 0) * 2 + d.armor;
  return v < 30 ? 'Pest' : v < 55 ? 'Nuisance' : v < 90 ? 'Dangerous' : v < 150 ? 'Deadly' : 'Dreadful';
}

function bountyEntries(): CodexEntry[] {
  return Object.values(ENEMIES).map((d, i) => {
    const moves = [...d.attacks.map((a) => a.title).filter((x): x is string => !!x), ...Object.values(d.moveTitles ?? {})];
    return {
      key: 'bounty:' + d.id, cat: 'bounty', id: d.id, n: i + 1, name: d.name, title: d.title, lore: d.lore, enemy: d.id,
      stats: [
        ['Threat', threat(d)],
        ['Health', String(d.hp)],
        ['Armor', String(d.armor)],
        ['Speed', d.speed >= 6 ? 'Swift' : d.speed >= 4 ? 'Quick' : d.speed >= 2.5 ? 'Steady' : 'Slow'],
        ['Bounty', `$${d.bounty}`],
        ['First rides at', `wave ${d.firstWave}`],
      ],
      moves: [...new Set(moves)],
      weak: d.weakness,
      hint: `Rides out from wave ${d.firstWave}.`,
      pts: { sight: 5, kill: 10, master: 15 },
      claimWord: 'SLAIN',
    } as CodexEntry;
  });
}

function bossEntries(): CodexEntry[] {
  return BOSSES.map((b, i) => ({
    key: 'boss:' + b.id, cat: 'boss', id: b.id, n: i + 1, name: b.name, title: b.title, lore: b.lore, model: b.model,
    stats: [['Health', b.hp], ['Waves', b.waves]],
    weak: b.weak,
    hint: `Waits at wave ${b.waves.split(/[ ,·]/)[0]}.`,
    pts: { sight: 15, kill: 40 },
    claimWord: 'DEFEATED',
  }));
}

function wildlifeEntries(): CodexEntry[] {
  return WILDLIFE.map((w, i) => ({ key: 'wildlife:' + w.id, cat: 'wildlife', id: w.id, n: i + 1, name: w.name, title: w.title, lore: w.lore, model: w.model, hint: w.hint, pts: { sight: 12 } }));
}

function lootEntries(): CodexEntry[] {
  const out: CodexEntry[] = [];
  let n = 0;
  for (const id of GEAR_IDS) {
    const g = GEAR[id] as GearDef;
    out.push({
      key: 'loot:' + id, cat: 'loot', id, n: ++n, name: g.name, title: `${RARITY_WORD[g.rarity]} · ${cap(g.slot)}${g.god ? ' · blessed by ' + g.god : ''}`,
      lore: g.lore ? `${g.desc}\n${g.lore}` : g.desc, model: 'gear_' + id,
      stats: [['Rarity', RARITY_WORD[g.rarity]], ['Worn on', cap(g.slot)], ['Trading post', `${g.price} gold`]],
      hint: 'Chests, alphas, bosses and the trading post.', pts: { kill: GEAR_PTS[g.rarity] ?? 8 }, claimWord: 'FOUND',
    });
  }
  for (const r of RELICS) {
    out.push({
      key: 'loot:relic_' + r.id, cat: 'loot', id: 'relic_' + r.id, n: ++n, name: r.name, title: `Treasure · ${REGION_NAMES[r.region]}`,
      lore: `Dug up from under the sand of ${REGION_NAMES[r.region]}. Worth ${r.value} gold to the right collector, and more to the wrong one.`,
      model: ({ goldCoin: 'gold_coin', ankhFragment: 'ankh_fragment', divineCharm: 'divine_charm', dagger: 'dagger', bottle: 'bottle', lantern: 'lantern', skull: 'skull_cow', bandage: 'bandage' } as Record<string, string>)[r.model] ?? 'gold_coin',
      stats: [['Region', REGION_NAMES[r.region]], ['First find pays', `${r.value} gold`]],
      hint: `Follow a treasure map in ${REGION_NAMES[r.region]} and dig.`, pts: { kill: 12 }, claimWord: 'DUG UP',
    });
  }
  for (const it of Object.values(ITEMS)) {
    out.push({
      key: 'loot:item_' + it.id, cat: 'loot', id: 'item_' + it.id, n: ++n, name: it.name, title: `${RARITY_WORD[it.rarity] ?? 'Common'} · Consumable`, lore: it.desc, model: it.model,
      stats: [['Rarity', RARITY_WORD[it.rarity] ?? 'Common'], ['Carry', `up to ${it.stack}`], ['Price', `${it.price} gold`]],
      hint: 'Use one in a run.', pts: { kill: 5 }, claimWord: 'USED',
    });
  }
  return out;
}

function blueprintEntries(): CodexEntry[] {
  const out: CodexEntry[] = [];
  let n = 0;
  for (const b of blueprintDefs()) {
    if (b.kind === 'gear') continue; // gear plans enrich the Loot & Gear pages instead
    const model = b.kind === 'gun' ? '@long:' + b.gun : b.kind === 'upgrade' ? '@cart:' + (WEAPON_UPGRADES[b.id]?.tip ?? 0xd8c070) : b.gun === 'revolver' ? (b.slot === 'under' ? '@revlaser' : '@gun:sight:iron') : '@long:' + b.gun;
    out.push({
      key: 'blueprint:' + b.id, cat: 'blueprint', id: b.id, n: ++n, name: b.name, title: cap(b.line.toLowerCase()), lore: b.desc, model,
      stats: [['Rarity', RARITY_WORD[b.rarity] ?? 'Common'], ['Kind', cap(b.kind)]],
      hint: 'Rolled up in chests and buried with the treasure on the trail.', pts: { kill: GEAR_PTS[b.rarity] ?? 8 }, plate: 'blueprint', claimWord: 'LEARNED',
    });
  }
  for (const slot of Object.keys(GUN_PARTS) as (keyof typeof GUN_PARTS)[])
    for (const part of GUN_PARTS[slot] as string[]) {
      const k = `${slot}:${part}`;
      out.push({
        key: 'blueprint:gun_' + slot + '_' + part, cat: 'blueprint', id: 'gun_' + slot + '_' + part, n: ++n, name: PART_NAMES[k] ?? cap(part), title: `Revolver · ${cap(slot)}`,
        lore: GUN_PERKS[k] ?? '', model: '@gun:' + k, stats: [['Fits', `the ${slot}`], ['Bench price', `${PRICES['gun:' + k] ?? 0} gold`]],
        hint: 'Buy it at the weapon bench.', pts: { kill: 8 }, plate: 'blueprint', claimWord: 'OWNED',
      });
    }
  for (const b of BOARDS) {
    out.push({
      key: 'blueprint:board_' + b, cat: 'blueprint', id: 'board_' + b, n: ++n, name: `${b.split('_').map(cap).join(' ')} Board`, title: 'Sandboard',
      lore: BOARD_LORE[b] ?? '', model: 'board_' + b, stats: [['Garage price', `${PRICES['board:' + b] ?? 0} gold`]],
      hint: 'Buy it in the garage.', pts: { kill: 8 }, plate: 'blueprint', claimWord: 'OWNED',
    });
  }
  return out;
}

function placeEntries(): CodexEntry[] {
  const out: CodexEntry[] = [];
  let n = 0;
  for (const k of ['A', 'B', 'C'] as const) {
    const sa = SUBAREAS[k];
    sa.zones.forEach((z, i) =>
      out.push({
        key: `place:${k}${i}`, cat: 'place', id: `${k}${i}`, n: ++n, name: z.name, title: sa.name, lore: PLACE_LORE[z.theme] ?? '', theme: z.theme,
        stats: [['Region', sa.name], ['Stretch', `${i + 1} of ${sa.zones.length}`]],
        hint: `Somewhere in ${sa.name}.`, pts: { sight: 10 },
      })
    );
  }
  return out;
}

function legendEntries(): CodexEntry[] {
  return LEGENDS.map((l, i) => ({ key: 'legend:' + l.id, cat: 'legend', id: l.id, n: i + 1, name: l.name, title: l.title, lore: l.lore, model: l.model, hint: l.hint, pts: { sight: 25 }, via: l.via }));
}

let SECTIONS: CodexSection[] | null = null;
let BY_KEY: Map<string, CodexEntry> | null = null;

function build() {
  if (SECTIONS) return;
  SECTIONS = [
    { cat: 'bounty', name: 'Bounties', tab: 'BOUNTIES', color: 0x7a2418, blurb: 'Every outlaw, husk and horror with a price on its head.', epigraph: '"Dead or alive. Mostly dead."', entries: bountyEntries() },
    { cat: 'boss', name: 'Bosses', tab: 'BOSSES', color: 0x3a2a5a, blurb: 'The great powers of the Reach, and the wave they wait at.', epigraph: '"Big hat, big gun, big trouble."', entries: bossEntries() },
    { cat: 'wildlife', name: 'Wildlife', tab: 'WILDLIFE', color: 0x4a6a2a, blurb: 'The harmless, the shy, and the ones that sing.', epigraph: '"Not everything out here wants you dead."', entries: wildlifeEntries() },
    { cat: 'loot', name: 'Loot & Gear', tab: 'LOOT', color: 0x9a6a1a, blurb: 'What a hunter wears, carries, drinks and throws, and the treasure he digs up.', epigraph: '"Finders keepers."', entries: lootEntries() },
    { cat: 'blueprint', name: 'Blueprints', tab: 'PLANS', color: 0x1e4a6e, blurb: 'Plans found on the trail, gun parts for the bench and boards for the garage, drawn to scale.', epigraph: '"Measure twice. Shoot once."', entries: blueprintEntries() },
    { cat: 'place', name: 'Places', tab: 'PLACES', color: 0x8a4a2a, blurb: 'Every stretch of Serket\'s Reach you have ridden.', epigraph: '"The map is not the desert."', entries: placeEntries() },
    { cat: 'legend', name: 'Legends', tab: 'LEGENDS', color: 0x2a5a5a, blurb: 'Gods, friends and the odd tortoise.', epigraph: '"Some stories walk on their own."', entries: legendEntries() },
  ];
  BY_KEY = new Map();
  for (const s of SECTIONS) for (const e of s.entries) BY_KEY.set(e.key, e);
}

// ======================================================================= state
const listeners: ((d: Discovery) => void)[] = [];

/** the save's book: the flags, plus the tallies Thoth's research reads (additive, kept beside the flags) */
interface BookTallies {
  f: Record<string, number>;
  /** rides (runs) on which the entry was met (discovered at any level at least once that ride) */
  n?: Record<string, number>;
  /** times the entry was claimed outside bounties: bosses defeated, gear found or worn, items used, relics dug */
  c?: Record<string, number>;
}
function bookSave() {
  const d = loadSave();
  if (!d.book?.f) d.book = { f: {} };
  return d.book as BookTallies;
}
function flags() {
  return bookSave().f;
}
/** entries met so far this ride (Codex.listen starts a ride) */
const rideSeen = new Set<string>();
let tallyTimer: ReturnType<typeof setTimeout> | null = null;
/** tallies change many times a fight: write them out in one go a moment later */
function queueWrite() {
  if (tallyTimer) return;
  tallyTimer = setTimeout(() => {
    tallyTimer = null;
    writeSave();
  }, 1500);
}
function tally(e: CodexEntry, level: CodexLevel) {
  const b = bookSave();
  let dirty = false;
  if (!rideSeen.has(e.key)) {
    rideSeen.add(e.key);
    (b.n ??= {})[e.key] = (b.n[e.key] ?? 0) + 1;
    dirty = true;
  }
  if (level !== 'sight' && e.cat !== 'bounty') {
    (b.c ??= {})[e.key] = (b.c[e.key] ?? 0) + 1;
    dirty = true;
  }
  if (dirty) queueWrite();
}

function entryPoints(e: CodexEntry, f: number) {
  return (f & F_SEEN ? e.pts.sight ?? 0 : 0) + (f & F_CLAIM ? e.pts.kill ?? 0 : 0) + (f & F_MASTER ? e.pts.master ?? 0 : 0);
}
function entryMax(e: CodexEntry) {
  return (e.pts.sight ?? 0) + (e.pts.kill ?? 0) + (e.pts.master ?? 0);
}

export const RANKS: { title: string; at: number }[] = [
  { title: 'Greenhorn', at: 0 },
  { title: 'Tenderfoot', at: 0.03 },
  { title: 'Drifter', at: 0.08 },
  { title: 'Trail Hand', at: 0.15 },
  { title: 'Tracker', at: 0.24 },
  { title: 'Bounty Hunter', at: 0.35 },
  { title: 'Gunslinger', at: 0.48 },
  { title: 'Desert Ranger', at: 0.62 },
  { title: 'Dune Marshal', at: 0.77 },
  { title: 'Legend of the Dunes', at: 0.9 },
];

export const Codex = {
  sections(): CodexSection[] {
    build();
    return SECTIONS!;
  },
  entry(key: string) {
    build();
    return BY_KEY!.get(key) ?? null;
  },
  flags(key: string) {
    return flags()[key] ?? 0;
  },
  known(key: string) {
    return (Codex.flags(key) & (F_SEEN | F_CLAIM)) !== 0;
  },
  /** saved kills for a bounty (all runs) */
  kills(id: string) {
    return loadSave().codex[id] ?? 0;
  },
  /** rides on which the entry was met */
  rides(key: string) {
    return bookSave().n?.[key] ?? 0;
  },
  /** times the entry was claimed (bosses defeated, gear found or worn, items used, relics dug; not bounty kills) */
  claims(key: string) {
    return bookSave().c?.[key] ?? 0;
  },
  points() {
    build();
    const f = flags();
    let p = 0;
    for (const e of BY_KEY!.values()) if (f[e.key]) p += entryPoints(e, f[e.key]);
    return p;
  },
  maxPoints() {
    build();
    let p = 0;
    for (const e of BY_KEY!.values()) p += entryMax(e);
    return p;
  },
  sectionStats(s: CodexSection) {
    const f = flags();
    let found = 0, pts = 0, max = 0, fresh = 0;
    for (const e of s.entries) {
      const v = f[e.key] ?? 0;
      if (v & (F_SEEN | F_CLAIM)) found++;
      if (v && !(v & F_READ)) fresh++;
      pts += entryPoints(e, v);
      max += entryMax(e);
    }
    return { found, total: s.entries.length, pts, max, fresh };
  },
  entryPoints(e: CodexEntry) {
    return entryPoints(e, Codex.flags(e.key));
  },
  entryMax,
  /** the rank title for a points total, and the next one */
  rank(points = Codex.points()) {
    const max = Codex.maxPoints();
    let i = 0;
    for (let k = 0; k < RANKS.length; k++) if (points >= Math.round(RANKS[k].at * max)) i = k;
    const next = RANKS[i + 1];
    return { index: i, title: RANKS[i].title, next: next ? { title: next.title, at: Math.round(next.at * max) } : null };
  },
  /** mark an entry read in the book (clears its NEW mark) */
  markRead(key: string) {
    const f = flags();
    if (f[key] && !(f[key] & F_READ)) {
      f[key] |= F_READ;
      writeSave();
    }
  },
  onDiscover(fn: (d: Discovery) => void) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
  /**
   * Discover an entry. `level`: 'sight' (seen it), 'kill' (killed / defeated / found / owned / used),
   * 'master' (25 kills). A deeper level implies the shallower ones. Returns the points gained.
   */
  discover(cat: CodexCat, id: string, level: CodexLevel = 'sight', quiet = false): number {
    build();
    const e = BY_KEY!.get(`${cat}:${id}`);
    if (!e) return 0;
    const f = flags();
    const was = f[e.key] ?? 0;
    if (!quiet) tally(e, level);
    let want = was | F_SEEN;
    if (level === 'kill' || level === 'master') want |= F_CLAIM;
    if (level === 'master') want |= F_MASTER;
    if (want === was) return 0;
    // anything new re-opens the NEW mark
    f[e.key] = want & ~F_READ;
    const gained = entryPoints(e, want) - entryPoints(e, was);
    writeSave();
    const d: Discovery = { entry: e, level, points: gained, fresh: !(was & (F_SEEN | F_CLAIM)) };
    if (!quiet && gained > 0) for (const l of listeners.slice()) l(d);
    // linked legends (Khonsu's avatar reveals Khonsu, ...)
    for (const o of BY_KEY!.values()) if (o.via?.includes(e.key) && !(f[o.key] & F_SEEN)) Codex.discover(o.cat, o.id, 'sight', quiet);
    return gained;
  },
  /** quietly fold in what the save already knows (old kill counts, owned unlocks, home) */
  sync() {
    build();
    const d = loadSave();
    for (const [id, n] of Object.entries(d.codex)) if (n > 0 && ENEMIES[id]) Codex.discover('bounty', id, n >= MASTER_KILLS ? 'master' : 'kill', true);
    for (const u of d.unlocked) {
      const [k, a, b] = u.split(':');
      if (k === 'gun') Codex.discover('blueprint', `gun_${a}_${b}`, 'kill', true);
      else if (k === 'board') Codex.discover('blueprint', 'board_' + a, 'kill', true);
    }
    // the gear on the bench and board in the garage were always his
    Codex.discover('blueprint', `gun_barrel_${d.gun.barrel}`, 'kill', true);
    Codex.discover('blueprint', 'board_' + d.look.board, 'kill', true);
    for (const id of ['sundown', 'pinch', 'mamaToad']) Codex.discover('legend', id, 'sight', true);
    for (const b of d.blueprints ?? []) {
      if (b.startsWith('gear_')) Codex.discover('loot', b.slice(5), 'sight', true);
      else Codex.discover('blueprint', b, 'kill', true);
    }
    for (const r of d.relics ?? []) Codex.discover('loot', 'relic_' + r, 'kill', true);
    if (d.seenIntro || d.runs > 0) Codex.discover('legend', 'serket', 'sight', true);
  },
  /** boss id from a live Boss (by name and title) */
  bossId(name: string, title = ''): string | null {
    if (/shifting sands/i.test(title)) return 'khonsuSand';
    for (const b of BOSSES) if (b.name === name || b.names?.includes(name)) return b.id;
    if (/^avatar of set/i.test(name)) return 'setAvatar';
    if (/khonsu/i.test(name)) return 'khonsu';
    if (/sethos/i.test(name)) return 'sethos';
    if (/marshal/i.test(name)) return 'marshal';
    if (/gulp|worm/i.test(name)) return 'gulp';
    return null;
  },
  /**
   * Wire a run's events into the book: kills, alphas, bosses, gear, items. `runKills` returns the
   * kills banked so far this run (per enemy id) for the mastery check. Returns an unsubscribe.
   */
  listen(events: EventBus, runKills?: () => Record<string, number>) {
    // a new ride: everything met from here on counts toward its ride tally again
    rideSeen.clear();
    const offs: (() => void)[] = [];
    const on = (ev: string, fn: (...a: any[]) => void) => offs.push(events.on(ev, fn));
    on('enemyKilled', (en: any) => {
      const id = en?.def?.id as string | undefined;
      if (!id) return;
      const n = Codex.kills(id) + (runKills?.()[id] ?? 0);
      Codex.discover('bounty', id, n >= MASTER_KILLS ? 'master' : 'kill');
    });
    on('alphaSpawn', (en: any) => en?.def?.id && Codex.discover('bounty', en.def.id, 'sight'));
    on('enemySkill', (s: any) => {
      const en = s?.enemy;
      if (en?.def?.id) Codex.discover('bounty', en.def.id, 'sight');
    });
    on('bossIntro', (b: any) => {
      const id = b && Codex.bossId(b.name, b.title);
      if (id) Codex.discover('boss', id, 'sight');
    });
    on('bossDefeated', (b: any, escaped: boolean) => {
      const id = b && Codex.bossId(b.name, b.title);
      if (id) Codex.discover('boss', id, escaped ? 'sight' : 'kill');
    });
    on('gearChanged', (_slot: string, id: string | null) => id && Codex.discover('loot', id, 'kill'));
    on('itemUsed', (id: string) => id && Codex.discover('loot', 'item_' + id, 'kill'));
    on('blueprintFound', (id: string) => {
      if (!id) return;
      if (id.startsWith('gear_')) Codex.discover('loot', id.slice(5), 'sight');
      else Codex.discover('blueprint', id, 'kill');
    });
    on('relicFound', (id: string) => id && Codex.discover('loot', 'relic_' + id, 'kill'));
    return () => offs.forEach((o) => o());
  },
};
