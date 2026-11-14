// THE SLOW REVEAL: what a new hunter can use, and how the rest of the game opens up
// over the first rides. Discoveries, Thoth's studies, bosses, bounty ranks and DEATHS
// all pay out permanently here; every unlock is saved (save.prog), announced once on
// the reveal card (ui/UnlockReveal: the death cinematic, the results, the run) and,
// for shop stock, by Ozymandias on your next visit ("New stock, fresh from the dead!").
//
// ---------------------------------------------------------------- the audit (before)
// From run 1 everything was on the table at once: all nine consumables on the turtle
// shop's shelf, all ~85 rank-up cards in the deck (gambles, evolutions, relic cards),
// every landmark job, Thoth's errands, and a 15-step Serket lesson that also covered
// the dodge ring, gun swapping, the tarot, the soul jar and digging before wave 1.
// Moves were already gated (sand kick / manual by rank, wall ride by a boss, dune surf
// by a x3 combo, the Neck Slicer by Khonsu), but learned with a toast only. Tarot
// skills are learned per run from rank-up cards; long guns and gear by blueprints.
//
// ---------------------------------------------------------------- the path (after)
// RIDE 1  (a fresh save)
//   moves  : kick-push, drift, jump + tricks, shoot / reload, kick, grapple
//   lesson : Serket's ride is ten steps (ride, drift, jump, trick, shoot, reload,
//            kick, grapple, the break, the ledger), not fifteen
//   shop   : Trail Bandage, Snake Oil, Cactus Whiskey, Dynamite, the tonic, a
//            fortune card, two gear pieces from the starter kit
//   cards  : the core deck (gun, brood, grit and gear basics, the three tarot cards), rare at most
//   jobs   : Outlaw Fort, Sheriff's WANTED, the trading post
// THEN, each opening with a short "learned" moment (Serket, during a wave break,
// shows it hands-on: run/Tutorial lesson mode, queued by run/Progression):
//   wave-2 break  : the dodge ring            first tarot card   : casting + empowering
//   first full jar: Serket's Wrath            ride 2, wave 2     : digging for treasure
//   carrying 2 guns: switching guns           each move unlock   : that move
// and permanently, from these tallies (UNLOCKS below):
//   ANUBIS' TALLY (deaths that reach the Duat; dying is never wasted)
//      1 Tin Star Shield on the shelf · the Gambler's Deck (gamble cards)
//      2 Ferryman's Coin (ware) · the Saloon's showdown opens
//      3 Serket's Charm on the shelf       5 Jackal Half-Mask plan · Relics of the Dead (cards)
//      7 Ankh of Return (ware)            10 Vulture-Bone Wings plan
//     14 Heart on the Scale (ware)        20 Bone Pauldrons plan      30 the Undertaker's top hat
//   DISCOVERIES (Thoth's Hall entries found)
//      5 Smoke Bomb on the shelf          10 the Abandoned Mine job opens
//     16 Prospector's Lantern (ware)      24 Brood Secrets (cards)
//     32 Bounty Hunter's Ink (ware)       45 Tommy-gun plans for sale
//   THOTH'S STUDIES   2 Embalmer's Linen on the shelf · 5 Ink of Thoth (ware)
//   BOSSES FELLED     1 Sacrificial Dagger · Iron Tricks (cards) · the Ranch job · coach-gun plans
//                     2 legendary cards can be dealt
//   BEST BOUNTY RANK  4 Rider's Grit (cards)
//   RIDES             1 Thoth starts handing out errands · 2 epic cards can be dealt
// Card rarity is capped through the cards worker's hook (UpgradeManager.tierCap): rare on
// the first rides, then epic, then legendary (Unlocks.cardCap(), set by run/Progression).
// Moves keep their own triggers (player/Techniques MOVE_UNLOCKS; manual now at rank 5).
//
// ---------------------------------------------------------------- gates (who asks)
//   Unlocks.itemOpen(id)      run/UnlockWares (the shelf)     Unlocks.lockedCards()  run/Progression (pre-banished)
//   Unlocks.missionOpen(t)    run/Missions (landmark jobs)    Unlocks.has('system:errands')  meta/Research
//   Unlocks.lessonSeen(id)    run/Tutorial, run/Progression
// An old save gets its past milestones granted quietly on first use (no flood of cards),
// with Anubis' tally started at its ride count. `?unlocks=all` opens everything (testing).
import { loadSave, writeSave, type ProgSave } from './Save';
import { Codex, F_CLAIM } from './Codex';
import { Research } from './Research';
import { Blueprints } from './Blueprints';
import type { ItemId } from '../player/Items';
import { isUnlocked, TECHNIQUES } from '../player/Techniques';

export type UnlockKind = 'item' | 'ware' | 'plan' | 'trinket' | 'cards' | 'mission' | 'system' | 'cosmetic';
export type UnlockTrack = 'tally' | 'finds' | 'studies' | 'bosses' | 'rank' | 'rides';

export interface UnlockDef {
  /** `kind:what`, e.g. item:shield, ware:ankh, plan:gun_shotgun, trinket:jackalMask, cards:gamble */
  id: string;
  kind: UnlockKind;
  track: UnlockTrack;
  at: number;
  name: string;
  /** one short line: what it gives you */
  line: string;
  /** a registry model for the reveal card's photograph */
  model?: string;
  /** how Ozymandias names it ("tin star shields") */
  ozzy?: string;
}

const U = (id: string, track: UnlockTrack, at: number, name: string, line: string, model?: string, ozzy?: string): UnlockDef => ({
  id, kind: id.split(':')[0] as UnlockKind, track, at, name, line, model, ozzy,
});

export const UNLOCKS: UnlockDef[] = [
  // ANUBIS' TALLY: every death that reaches the Duat
  U('item:shield', 'tally', 1, 'Tin Star Shield', 'Sold at the turtle shop from now on', 'item_star', 'tin star shields'),
  U('cards:gamble', 'tally', 1, "The Gambler's Deck", 'Anubis deals you in: gamble cards join the rank-up deck', 'book'),
  U('ware:ferryCoin', 'tally', 2, "Ferryman's Coin", 'A rare ware at the turtle shop: more gold all ride', 'gold_coin', "the ferryman's coin"),
  U('mission:saloon', 'tally', 2, "The Saloon's Showdown", 'The dealer will play you now: double or nothing'),
  U('item:charm', 'tally', 3, "Serket's Charm", 'Sold at the turtle shop from now on', 'item_charm', "Serket's charms"),
  U('trinket:jackalMask', 'tally', 5, 'Jackal Half-Mask', 'A trinket plan: it can drop from chests and sell now', 'gear_jackalMask'),
  U('cards:relic', 'tally', 5, 'Relics of the Dead', 'Relic cards join the rank-up deck', 'book'),
  U('ware:ankh', 'tally', 7, 'Ankh of Return', 'A rare ware at the turtle shop: more health all ride', 'ankh_fragment', 'an ankh of return'),
  U('trinket:vultureWings', 'tally', 10, 'Vulture-Bone Wings', 'A trinket plan: it can drop from chests and sell now', 'gear_vultureWings'),
  U('ware:weighedHeart', 'tally', 14, 'Heart on the Scale', "A rare ware at the turtle shop: Serket's Wrath fills faster", 'divine_charm', 'a heart from the scales'),
  U('trinket:bonePauldrons', 'tally', 20, 'Bone Pauldrons', 'A trinket plan: it can drop from chests and sell now', 'gear_bonePauldrons'),
  U('cosmetic:hat:tophat', 'tally', 30, "The Undertaker's Top Hat", 'A new hat in the hideout wardrobe'),
  // DISCOVERIES: entries found in Thoth's Hall
  U('item:smoke', 'finds', 5, 'Smoke Bomb', 'Sold at the turtle shop from now on', 'item_smoke', 'smoke bombs'),
  U('mission:mineHeadframe', 'finds', 10, 'The Abandoned Mine', 'A new job on the trail: strike the glittering veins'),
  U('ware:lantern', 'finds', 16, "Prospector's Lantern", 'A rare ware at the turtle shop: pull loot from further', 'lantern', "a prospector's lantern"),
  U('cards:brood', 'finds', 24, 'Brood Secrets', "Pinch's brood cards join the rank-up deck", 'book'),
  U('ware:ledgerInk', 'finds', 32, "Bounty Hunter's Ink", 'A rare ware at the turtle shop: more bounty all ride', 'bottle_2', "bounty hunter's ink"),
  U('plan:gun_tommy', 'finds', 45, 'Tommy-Gun Plans', 'For sale at the turtle shop until you own them', 'book', 'tommy-gun plans'),
  // THOTH'S STUDIES
  U('item:goldBandage', 'studies', 2, "Embalmer's Linen", 'Sold at the turtle shop from now on', 'item_linen', "embalmer's linen"),
  U('ware:thothInk', 'studies', 5, 'Ink of Thoth', 'A rare ware at the turtle shop: rarer cards all ride', 'bottle_3', "Thoth's own ink"),
  // BOSSES FELLED (different bosses)
  U('item:dagger', 'bosses', 1, 'Sacrificial Dagger', 'Sold at the turtle shop from now on', 'item_dagger', 'sacrificial daggers'),
  U('cards:iron', 'bosses', 1, 'Iron Tricks', 'Trick-shot gun cards join the rank-up deck', 'book'),
  U('mission:ranchBarn', 'bosses', 1, 'The Dusty Ranch', 'A new job on the trail: rustlers took a camel'),
  U('plan:gun_shotgun', 'bosses', 1, 'Coach-Gun Plans', 'For sale at the turtle shop until you own them', 'book', 'coach-gun plans'),
  // BEST BOUNTY RANK
  U('cards:grit', 'rank', 4, "Rider's Grit", 'Riding and gambling cards join the rank-up deck', 'book'),
  U('cards:legendary', 'bosses', 2, 'Legendary Cards', 'Rank-ups can deal legendary cards now', 'book'),
  // RIDES
  U('system:errands', 'rides', 1, "Thoth's Errands", 'Thoth hands out errands in his Hall now'),
  U('cards:epic', 'rides', 2, 'Epic Cards', 'Rank-ups can deal epic cards now', 'book'),
];

/** consumables on the shelf from the very first ride */
export const STARTER_ITEMS: ItemId[] = ['bandage', 'snakeoil', 'whiskey', 'dynamite'];

/** rank-up cards held back until their group opens (ids in run/Upgrades + run/UpgradesExtra) */
export const CARD_GROUPS: Record<string, string[]> = {
  gamble: ['rollBones', 'snakeEyes', 'coinToss', 'doubleNothing', 'russianRoulette'],
  iron: ['bankShot', 'sixthChamber', 'thunderhead', 'deadCalm', 'trickShot', 'warmGun', 'heavyIron', 'thunderChamber'],
  brood: ['venomPuddles', 'mirrorBrood', 'scorpionWhip', 'venomBrood'],
  grit: ['hellfireTrail', 'bulletBallet', 'grappleSlam', 'lodestone', 'comboFever', 'hellrider', 'glassCannon', 'taxman', 'helterSkelter', 'paradiseCity', 'gimmeShelter'],
  relic: ['paintItBlack', 'sympathyDevil', 'liveAndLetDie'],
};

/** landmark jobs that wait for an unlock (the rest are open from ride 1) */
const GATED_MISSIONS = ['saloon', 'mineHeadframe', 'ranchBarn'];

/** Serket's lessons that come later, one at a time (run/Tutorial lesson mode) */
export type LessonId = 'dodge' | 'guns' | 'tarot' | 'ult' | 'dig' | 'sand_kick' | 'wall_ride' | 'manual' | 'dune_surf' | 'neck_slicer';
export const LATER_LESSONS: LessonId[] = ['dodge', 'guns', 'tarot', 'ult', 'dig'];

export const TRACK_TITLE: Record<UnlockTrack, string> = {
  tally: "ANUBIS' TALLY",
  finds: 'DISCOVERIES',
  studies: "THOTH'S STUDIES",
  bosses: 'BOSSES FELLED',
  rank: 'BOUNTY RANK',
  rides: 'RIDES',
};

const listeners: ((d: UnlockDef) => void)[] = [];
/** unlocks granted since the current run began (the results / death reveal lists them) */
let session: UnlockDef[] = [];

function debugAll() {
  try {
    return new URLSearchParams(location.search).get('unlocks') === 'all';
  } catch {
    return false;
  }
}

let migrating = false;
function prog(): ProgSave {
  const d = loadSave();
  if (!d.prog) {
    // an old save: Anubis has seen it roughly once a ride; the lessons it sat through count as given
    const veteran = d.runs > 0;
    d.prog = { deaths: d.runs, got: [], reveal: [], news: [], shelved: [], bestRank: veteran ? Math.min(6, 1 + d.runs) : 0, lessons: [] };
    if (veteran) {
      d.prog.lessons.push(...LATER_LESSONS);
      for (const t of TECHNIQUES) if (!t.base && isUnlocked(t.id)) d.prog.lessons.push(t.id);
    }
    migrating = true;
    try {
      Unlocks.evaluate(true);
    } finally {
      migrating = false;
    }
    writeSave(d);
  }
  const p = d.prog;
  p.got ??= [];
  p.reveal ??= [];
  p.news ??= [];
  p.shelved ??= [];
  p.lessons ??= [];
  p.deaths ??= 0;
  p.bestRank ??= 0;
  return p;
}

function discovered() {
  let n = 0;
  for (const s of Codex.sections()) n += Codex.sectionStats(s).found;
  return n;
}
function bossesFelled() {
  let n = 0;
  for (const s of Codex.sections()) if (s.cat === 'boss') for (const e of s.entries) if (Codex.flags(e.key) & F_CLAIM) n++;
  return n;
}

export const Unlocks = {
  /** the tally a track stands at */
  metric(track: UnlockTrack): number {
    const p = migrating ? loadSave().prog! : prog();
    switch (track) {
      case 'tally': return p.deaths;
      case 'finds': return discovered();
      case 'studies': return Research.count();
      case 'bosses': return bossesFelled();
      case 'rank': return p.bestRank;
      case 'rides': return loadSave().runs;
    }
  },
  has(id: string) {
    if (debugAll()) return true;
    return prog().got.includes(id);
  },
  def(id: string) {
    return UNLOCKS.find((u) => u.id === id) ?? null;
  },
  /** may this consumable stand on Ozymandias' shelf? */
  itemOpen(id: ItemId) {
    return STARTER_ITEMS.includes(id) || Unlocks.has('item:' + id);
  },
  /** rank-up cards still held back (pre-banished in a run) */
  lockedCards(): string[] {
    const out: string[] = [];
    for (const [g, ids] of Object.entries(CARD_GROUPS)) if (!Unlocks.has('cards:' + g)) out.push(...ids);
    return out;
  },
  /** the rarest a rank-up card may be dealt (UpgradeManager.tierCap): rare at first, epic after two rides, legendary after two bosses */
  cardCap(): 'rare' | 'epic' | 'legendary' {
    if (Unlocks.has('cards:legendary')) return 'legendary';
    return Unlocks.has('cards:epic') ? 'epic' : 'rare';
  },
  missionOpen(type: string) {
    return !GATED_MISSIONS.includes(type) || Unlocks.has('mission:' + type);
  },
  /** what opens a locked job: "Opens at Anubis' tally 2 (you: 0)" */
  missionHint(type: string) {
    const u = Unlocks.def('mission:' + type);
    if (!u) return '';
    return `Opens at ${TRACK_TITLE[u.track].toLowerCase().replace("anubis'", "Anubis'").replace("thoth's", "Thoth's")} ${u.at} (now ${Unlocks.metric(u.track)})`;
  },
  /** the next milestone on a track (null when the track is done) */
  next(track: UnlockTrack): UnlockDef | null {
    const p = prog();
    return UNLOCKS.filter((u) => u.track === track && !p.got.includes(u.id)).sort((a, b) => a.at - b.at)[0] ?? null;
  },
  /** Anubis' tally */
  tally() {
    return prog().deaths;
  },
  /**
   * Grant every milestone reached. `quiet` grants without announcing (old saves). Returns
   * what was newly unlocked; listeners (the run's toasts) hear each one.
   */
  evaluate(quiet = false): UnlockDef[] {
    const d = loadSave();
    const p = migrating ? d.prog! : prog();
    const out: UnlockDef[] = [];
    const cache: Partial<Record<UnlockTrack, number>> = {};
    for (const u of UNLOCKS) {
      if (p.got.includes(u.id)) continue;
      const m = (cache[u.track] ??= Unlocks.metric(u.track));
      if (m < u.at) continue;
      p.got.push(u.id);
      // what it does to the save right away
      if (u.kind === 'trinket') Blueprints.learn('gear_' + u.id.slice(8)) && Codex.discover('loot', u.id.slice(8), 'sight', true);
      else if (u.kind === 'cosmetic') {
        const key = u.id.slice(9);
        if (!d.unlocked.includes(key)) d.unlocked.push(key);
      }
      if (quiet) {
        p.shelved.push(u.id);
        continue;
      }
      p.reveal.push(u.id);
      if (u.ozzy) p.news.push(u.id);
      out.push(u);
      session.push(u);
    }
    if (out.length || quiet) writeSave(d);
    for (const u of out) for (const l of listeners.slice()) l(u);
    return out;
  },
  onUnlock(fn: (d: UnlockDef) => void) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
  /** a death reached the Duat: Anubis' tally goes up. Returns what it unlocked */
  death(): UnlockDef[] {
    const p = prog();
    p.deaths++;
    writeSave();
    return Unlocks.evaluate();
  },
  /** a bounty rank reached in a run */
  noteRank(rank: number) {
    const p = prog();
    if (rank <= p.bestRank) return [];
    p.bestRank = rank;
    writeSave();
    return Unlocks.evaluate();
  },
  // ---------------------------------------------------------------- the reveal card and the run's list
  /** a new run: the session list starts empty */
  beginRun() {
    session = [];
    prog();
  },
  /** unlocks granted this run so far */
  sessionList() {
    return session.slice();
  },
  /** unlocks waiting for the reveal card (taken: they will not show again) */
  takeReveal(): UnlockDef[] {
    const p = prog();
    if (!p.reveal.length) return [];
    const out = p.reveal.map((id) => Unlocks.def(id)).filter((u): u is UnlockDef => !!u);
    p.reveal = [];
    writeSave();
    return out;
  },
  pendingReveal() {
    return prog().reveal.length;
  },
  // ---------------------------------------------------------------- the shop
  /** Ozymandias' greeting about stock that came in since your last visit (null: nothing new) */
  takeNews(): string | null {
    const p = prog();
    if (!p.news.length) return null;
    const names = p.news.map((id) => Unlocks.def(id)?.ozzy).filter((s): s is string => !!s);
    p.news = [];
    writeSave();
    if (!names.length) return null;
    if (names.length === 1) return `New stock, fresh from the dead! ${cap(names[0])}. Hrrm, have a look.`;
    return `New stock, fresh from the dead! ${cap(names[0])}, and ${names.length - 1 === 1 ? names[1] : 'more besides'}.`;
  },
  /** shop unlocks never put on a shelf yet (they get a guaranteed spot) */
  freshShop(): string[] {
    const p = prog();
    return p.got.filter((id) => !p.shelved.includes(id) && /^(item|ware|plan):/.test(id));
  },
  /** rare wares and gun plans unlocked so far (ids) */
  shopRares(): string[] {
    if (debugAll()) return UNLOCKS.filter((u) => u.kind === 'ware' || u.kind === 'plan').map((u) => u.id);
    return prog().got.filter((id) => id.startsWith('ware:') || id.startsWith('plan:'));
  },
  markShelved(id: string) {
    const p = prog();
    if (!p.shelved.includes(id)) {
      p.shelved.push(id);
      writeSave();
    }
  },
  // ---------------------------------------------------------------- Serket's lessons
  lessonSeen(id: LessonId) {
    return prog().lessons.includes(id);
  },
  markLesson(id: LessonId) {
    const p = prog();
    if (!p.lessons.includes(id)) {
      p.lessons.push(id);
      writeSave();
    }
  },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
