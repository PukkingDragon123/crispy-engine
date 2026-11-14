// THOTH'S RESEARCH. Every entry in Thoth's Hall can be researched once it has been
// discovered: a small goal built from what the Codex already tracks (bounty kills,
// rides an entry was met on, bosses defeated, gear found or worn, items used, relics
// dug, plans learned). When the goal is met the hunter hands his notes to Thoth in the
// Hall ("complete research"); every completed study adds to the count that climbs
// THOTH'S GIFTS: consumables for the satchel, gear blueprints and cosmetics.
//
// Thoth also hands out one small ERRAND at a time ("find me a sand hippo calf!"). It is
// tracked in runs by run/ThothErrand.ts (shown as a mission note) and turned in at the
// Hall for gold and a little something.
//
// State lives in the save beside the Codex flags (`book.r`, additive), so it persists
// and resets with the rest of the book.
//
//   Research.goal(entry)        → { text, cur, need } or null (not discovered yet)
//   Research.state(key)         → 'unknown' | 'study' | 'ready' | 'done'
//   Research.complete(key)      → the gifts it unlocked (null if not ready)
//   Research.errand()           → the errand in hand (accept with Research.takeErrand())
//   Research.takeSatchel()      → consumables Thoth packed for the next ride (run start)
import { loadSave, writeSave, PRICES } from './Save';
import { Codex, CodexEntry, F_CLAIM, F_SEEN } from './Codex';
import { Blueprints, blueprint } from './Blueprints';
import { ITEMS, ItemId } from '../player/Items';
import { GEAR, GearId } from '../player/Equipment';
import { Unlocks } from './Unlocks';

export interface Goal {
  /** what Thoth wants, short: "Bring down 15 of them" */
  text: string;
  cur: number;
  need: number;
}
export type StudyState = 'unknown' | 'study' | 'ready' | 'done';

export type GiftKind = 'item' | 'blueprint' | 'cosmetic';
export interface Gift {
  /** researched studies needed */
  at: number;
  kind: GiftKind;
  /** item id, blueprint id (gear_*) or unlock key (hat:nemes, board:serket) */
  id: string;
  n?: number;
  /** a second item in the same bundle */
  plus?: { id: ItemId; n: number };
  /** Thoth's line when he hands it over */
  say: string;
}

export type ErrandKind = 'find' | 'bring' | 'calf' | 'use' | 'dig';
export interface Errand {
  id: string;
  kind: ErrandKind;
  /** the codex key it is about (find / bring / use) */
  key?: string;
  /** how many (bring / use) */
  n: number;
  /** the tally when it was taken (bring / use / dig / calf) */
  base: number;
  /** Thoth asking, in his own words */
  ask: string;
  /** the mission note: "Find a Giant Jerboa" */
  objective: string;
  reward: { gold: number; item?: ItemId };
  /** done in the field; waiting to be told */
  met?: boolean;
}

interface ResearchSave {
  done: string[];
  /** gifts handed over (index into GIFTS) */
  given: number;
  satchel: Partial<Record<ItemId, number>>;
  errand: Errand | null;
  errands: number;
  /** errand ids already done (not offered again) */
  past: string[];
}

// ======================================================================= gifts
export const GIFTS: Gift[] = [
  { at: 1, kind: 'item', id: 'bandage', n: 2, say: 'Your first study! Here, bandages! I rolled them myself. They are a little bit crooked.' },
  { at: 3, kind: 'blueprint', id: 'gear_cactusJerkin', say: 'I drew you a jerkin! It is prickly on the outside and cosy on the inside. Like me!' },
  { at: 5, kind: 'item', id: 'snakeoil', n: 2, say: 'Doc Hapi left these here in the year two thousand and six. Do not drink them all at once!' },
  { at: 8, kind: 'cosmetic', id: 'hat:nemes', say: 'A proper headdress! Now you look like a scribe. A very bony scribe.' },
  { at: 11, kind: 'blueprint', id: 'gear_glassEye', say: 'A lucky glass eye! It winks at gold. I taught it how.' },
  { at: 15, kind: 'item', id: 'goldBandage', n: 1, plus: { id: 'charm', n: 1 }, say: 'Embalmer linen AND a charm of Serket! Do not tell her I had it in my sock drawer.' },
  { at: 20, kind: 'blueprint', id: 'gear_sunGoggles', say: 'Goggles of lightning glass! You can look right at the sun. Well. Almost right at it.' },
  { at: 25, kind: 'cosmetic', id: 'outfit:pharaoh', say: 'Pharaoh clothes! I kept them since the old days. The pharaoh does not need them. He has his bandages.' },
  { at: 30, kind: 'blueprint', id: 'gear_hourglass', say: 'Khonsu forgot his hourglass here. He forgets everything. Except birthdays.' },
  { at: 38, kind: 'cosmetic', id: 'board:scarab_gold', say: 'A golden scarab board! Khepri polished it. Every. Single. Morning.' },
  { at: 46, kind: 'blueprint', id: 'gear_thothSpecs', say: 'My very own spectacles! I have another pair. I have eleven pairs. Wear them and see everything!' },
  { at: 55, kind: 'cosmetic', id: 'board:serket', say: "Serket's own board! She said you could have it if you were good. You were SO good." },
  { at: 65, kind: 'blueprint', id: 'gear_deadMansHand', say: 'This card is very old and very spooky. Even older than me! No. Not older than me.' },
  { at: 80, kind: 'blueprint', id: 'gear_lightningReel', say: 'The lightning hook of Set! He does not know I have it. Shhh. Shhhhhh!' },
];

const ITEM_NAMES = (id: ItemId) => ITEMS[id]?.name ?? id;
const COSMETIC_NAMES: Record<string, string> = {
  'hat:nemes': 'Nemes Headdress', 'hat:duck': 'Duck Hat', 'hat:tophat': 'Top Hat', 'outfit:pharaoh': "Pharaoh's Kilt & Collar",
  'board:scarab_gold': 'Golden Scarab Board', 'board:serket': "Serket's Board", 'board:cyber': 'The Humming Board',
};
/** a gift's display name */
export function giftName(g: Gift) {
  if (g.kind === 'item') return `${ITEM_NAMES(g.id as ItemId)}${(g.n ?? 1) > 1 ? ' x' + g.n : ''}${g.plus ? ` & ${ITEM_NAMES(g.plus.id)}` : ''}`;
  if (g.kind === 'blueprint') return `${blueprint(g.id)?.name ?? GEAR[g.id.replace(/^gear_/, '') as GearId]?.name ?? g.id} (plan)`;
  return COSMETIC_NAMES[g.id] ?? g.id;
}
/** the registry key of a gift's 3D model (for the desk), when it has one */
export function giftModel(g: Gift): string | null {
  if (g.kind === 'item') return ITEMS[g.id as ItemId]?.model ?? null;
  if (g.kind === 'blueprint') return g.id.startsWith('gear_') ? 'gear_' + g.id.slice(5) : null;
  if (g.id.startsWith('board:')) return 'board_' + g.id.slice(6);
  return null;
}

// ======================================================================= state
function rs(): ResearchSave {
  const d = loadSave();
  if (!d.book?.f) d.book = { f: {} };
  const b = d.book as { f: Record<string, number>; r?: ResearchSave };
  if (!b.r) b.r = { done: [], given: 0, satchel: {}, errand: null, errands: 0, past: [] };
  const r = b.r;
  r.done ??= [];
  r.satchel ??= {};
  r.past ??= [];
  r.given ??= 0;
  r.errands ??= 0;
  return r;
}

const threatNeed: Record<string, number> = { Pest: 20, Nuisance: 15, Dangerous: 12, Deadly: 8, Dreadful: 5 };
const stat = (e: CodexEntry, label: string) => e.stats?.find((s) => s[0] === label)?.[1] ?? '';
const claimed = (key: string) => (Codex.flags(key) & F_CLAIM) !== 0;
const discoveredCount = () => {
  let n = 0;
  for (const s of Codex.sections()) n += Codex.sectionStats(s).found;
  return n;
};

/** what each legend's study asks for */
function legendGoal(id: string): Goal {
  const d = loadSave();
  switch (id) {
    case 'sundown': return { text: 'Ride out ten times', cur: d.runs, need: 10 };
    case 'pinch': return { text: 'Fill 25 jars in the Hall', cur: discoveredCount(), need: 25 };
    case 'mamaToad': return { text: 'Come home safe three times', cur: d.runs, need: 3 };
    case 'serket': return { text: 'Reach wave 25', cur: d.bestWave, need: 25 };
    case 'anubis': return { text: 'Stand before him twice', cur: Codex.rides('legend:anubis'), need: 2 };
    case 'khonsu': return { text: 'Defeat the Avatar of Khonsu', cur: claimed('boss:khonsu') ? 1 : 0, need: 1 };
    case 'thoth': return { text: 'Finish ten other studies', cur: rs().done.filter((k) => k !== 'legend:thoth').length, need: 10 };
    case 'khepri': return { text: 'Knock the Sunroller off his ball', cur: claimed('boss:sunroller') ? 1 : 0, need: 1 };
    case 'set': return { text: 'Defeat Sethos, Hand of Set', cur: claimed('boss:sethos') ? 1 : 0, need: 1 };
    case 'ozymandias': return { text: 'Find the walking trading post three times', cur: Codex.rides('legend:ozymandias'), need: 3 };
  }
  return { text: 'Meet them again', cur: Codex.rides('legend:' + id), need: 2 };
}

export const Research = {
  /** the study for an entry (null while it is still under the sheet) */
  goal(e: CodexEntry): Goal | null {
    if (!(Codex.flags(e.key) & (F_SEEN | F_CLAIM))) return null;
    switch (e.cat) {
      case 'bounty': {
        const need = threatNeed[stat(e, 'Threat')] ?? 12;
        return { text: `Bring down ${need} of them`, cur: Codex.kills(e.id), need };
      }
      case 'boss':
        return { text: 'Defeat it and bring back a piece', cur: claimed(e.key) ? 1 : 0, need: 1 };
      case 'wildlife':
        if (e.id === 'hippoCalf') return { text: 'Pick one up and give it a hug', cur: Math.min(1, Codex.claims(e.key)), need: 1 };
        return { text: 'Spot it on three different rides', cur: Codex.rides(e.key), need: 3 };
      case 'loot':
        if (e.id.startsWith('relic_')) return { text: 'Dig it up', cur: claimed(e.key) ? 1 : 0, need: 1 };
        if (e.id.startsWith('item_')) return { text: 'Use five of them on the trail', cur: Codex.claims(e.key), need: 5 };
        return { text: 'Find it or wear it on two rides', cur: Codex.claims(e.key), need: 2 };
      case 'blueprint':
        return { text: e.id.startsWith('gun_') || e.id.startsWith('board_') ? 'Own it' : 'Learn the plan', cur: claimed(e.key) ? 1 : 0, need: 1 };
      case 'place':
        return { text: 'Ride through it on three different rides', cur: Codex.rides(e.key), need: 3 };
      case 'legend':
        return legendGoal(e.id);
    }
    return null;
  },
  done(key: string) {
    return rs().done.includes(key);
  },
  state(key: string): StudyState {
    if (Research.done(key)) return 'done';
    const e = Codex.entry(key);
    const g = e && Research.goal(e);
    if (!g) return 'unknown';
    return g.cur >= g.need ? 'ready' : 'study';
  },
  /** studies finished */
  count() {
    return rs().done.length;
  },
  /** studies waiting to be handed in (per section, or everywhere) */
  readyCount(cat?: string) {
    let n = 0;
    for (const s of Codex.sections()) {
      if (cat && s.cat !== cat) continue;
      for (const e of s.entries) if (Research.state(e.key) === 'ready') n++;
    }
    return n;
  },
  doneIn(cat: string) {
    return rs().done.filter((k) => k.startsWith(cat + ':')).length;
  },
  /** hand in the notes: the study is done; returns the gifts it unlocked (null when not ready) */
  complete(key: string): Gift[] | null {
    if (Research.state(key) !== 'ready') return null;
    const r = rs();
    r.done.push(key);
    const out: Gift[] = [];
    while (r.given < GIFTS.length && r.done.length >= GIFTS[r.given].at) {
      const g = GIFTS[r.given++];
      Research.grant(g);
      out.push(g);
    }
    writeSave();
    // studies are a progression track too (new shop stock: meta/Unlocks)
    Unlocks.evaluate();
    return out;
  },
  /** give a gift: items into the satchel, plans learned, cosmetics unlocked (already owned → its worth in gold) */
  grant(g: Gift) {
    const d = loadSave();
    const r = rs();
    if (g.kind === 'item') {
      r.satchel[g.id as ItemId] = (r.satchel[g.id as ItemId] ?? 0) + (g.n ?? 1);
      if (g.plus) r.satchel[g.plus.id] = (r.satchel[g.plus.id] ?? 0) + g.plus.n;
    } else if (g.kind === 'blueprint') {
      if (!Blueprints.learn(g.id)) d.bank += GEAR[g.id.replace(/^gear_/, '') as GearId]?.price ?? 120;
      else Codex.discover('loot', g.id.replace(/^gear_/, ''), 'sight', true);
    } else if (!d.unlocked.includes(g.id)) d.unlocked.push(g.id);
    else d.bank += PRICES[g.id] ?? 150;
    writeSave(d);
  },
  /** the next gift on the ladder (null when all are given) */
  nextGift(): Gift | null {
    return GIFTS[rs().given] ?? null;
  },
  given() {
    return rs().given;
  },
  // ===================================================================== the satchel
  satchel(): { id: ItemId; n: number }[] {
    return Object.entries(rs().satchel)
      .filter(([, n]) => (n ?? 0) > 0)
      .map(([id, n]) => ({ id: id as ItemId, n: n! }));
  },
  /** hand the satchel over for a ride: `give` returns false when the pockets are full (the rest stays packed) */
  takeSatchel(give: (id: ItemId) => boolean) {
    const r = rs();
    const got: ItemId[] = [];
    for (const [id, n] of Object.entries(r.satchel) as [ItemId, number][]) {
      let left = n;
      while (left > 0 && give(id)) {
        left--;
        got.push(id);
      }
      r.satchel[id] = left;
      if (!left) delete r.satchel[id];
    }
    if (got.length) writeSave();
    return got;
  },
  // ===================================================================== errands
  /** the errand in hand (null: none taken) */
  errand(): Errand | null {
    return rs().errand;
  },
  /** progress on an errand (live tallies; `runKills` adds kills not banked yet) */
  errandProgress(e: Errand, runKills?: Record<string, number>): { cur: number; need: number } {
    const d = loadSave();
    switch (e.kind) {
      case 'find':
        return { cur: e.key && Codex.known(e.key) ? 1 : 0, need: 1 };
      case 'bring': {
        const id = e.key!.split(':')[1];
        return { cur: Math.min(e.n, Codex.kills(id) + (runKills?.[id] ?? 0) - e.base), need: e.n };
      }
      case 'calf':
        return { cur: Codex.claims('wildlife:hippoCalf') > e.base ? 1 : 0, need: 1 };
      case 'use':
        return { cur: Math.min(e.n, Codex.claims(e.key!) - e.base), need: e.n };
      case 'dig':
        return { cur: (d.relics?.length ?? 0) > e.base ? 1 : 0, need: 1 };
    }
  },
  errandMet(e: Errand, runKills?: Record<string, number>) {
    const p = Research.errandProgress(e, runKills);
    return p.cur >= p.need;
  },
  /** what Thoth would ask for next (not taken yet); `skip` asks for another one */
  proposeErrand(skip = 0): Errand | null {
    // Thoth starts handing out errands once the hunter has ridden out once (meta/Unlocks)
    if (!Unlocks.has('system:errands')) return null;
    const r = rs();
    const d = loadSave();
    const past = new Set(r.past);
    const cands: Errand[] = [];
    // the very first: the calf (he has wanted to hear one squeak for a thousand years)
    if (!past.has('calf'))
      cands.push({
        id: 'calf', kind: 'calf', n: 1, base: Codex.claims('wildlife:hippoCalf'),
        ask: 'Find me a sand hippo calf! Pick it up and give it a hug! I want to know if they squeak. I think they squeak!',
        objective: 'Pick up a sand hippo calf', reward: { gold: 60, item: 'bandage' },
      });
    for (const s of Codex.sections()) {
      for (const e of s.entries) {
        if (past.has('find:' + e.key)) continue;
        const known = Codex.known(e.key);
        if (!known && (s.cat === 'wildlife' || (s.cat === 'bounty' && parseInt(stat(e, 'First rides at').replace(/\D/g, '') || '1') <= d.bestWave + 8) || (s.cat === 'place' && e.id.startsWith('A'))))
          cands.push({
            id: 'find:' + e.key, kind: 'find', key: e.key, n: 1, base: 0,
            ask: s.cat === 'wildlife' ? `Find me a ${e.name.toLowerCase()}! I only have a drawing, and the drawing is not very good.` : s.cat === 'place' ? `Somebody said there is a place called ${e.name}. Go and look! Tell me if it is real!` : `I heard about a ${e.name.toLowerCase()}! Go see one! Not too close. Okay, a bit close.`,
            objective: `Find: ${e.name}`, reward: { gold: s.cat === 'bounty' ? 50 : 40 },
          });
      }
    }
    for (const id of ['scarab', 'husk', 'gunslinger', 'jackal', 'vulture', 'sandWolf', 'mummy', 'outlaw']) {
      const key = 'bounty:' + id;
      const e = Codex.entry(key);
      if (!e || !Codex.known(key) || past.has('bring:' + key)) continue;
      const n = id === 'scarab' ? 15 : id === 'husk' ? 12 : 8;
      cands.push({
        id: 'bring:' + key, kind: 'bring', key, n, base: Codex.kills(id),
        ask: `Bring me ${n} ${e.name.toLowerCase()}s! Well. Not the whole ${e.name.toLowerCase()}s. Just bring them down and tell me how they fall over.`,
        objective: `Bring down ${n} ${e.name}s`, reward: { gold: 40 + n * 4, item: n >= 12 ? 'snakeoil' : undefined },
      });
    }
    if (d.runs > 0 && !past.has('use:bandage'))
      cands.push({ id: 'use:bandage', kind: 'use', key: 'loot:item_bandage', n: 3, base: Codex.claims('loot:item_bandage'), ask: 'Use three bandages! Then I can see how you wrap. I wrap like THIS. Very tight.', objective: 'Use 3 Trail Bandages', reward: { gold: 45, item: 'bandage' } });
    if (d.runs > 1 && !past.has('dig:' + (d.relics?.length ?? 0)))
      cands.push({ id: 'dig:' + (d.relics?.length ?? 0), kind: 'dig', n: 1, base: d.relics?.length ?? 0, ask: 'Dig something up for me! Anything old. Older than you. Not older than me, that is impossible.', objective: 'Dig up a buried relic', reward: { gold: 70 } });
    if (!cands.length) return null;
    // calf first, then a gentle mix (deterministic per errand count so the offer does not flicker)
    if (cands[0].id === 'calf' && skip % (cands.length || 1) === 0) return cands[0];
    const k = (r.errands * 7 + 3 + skip) % cands.length;
    return cands[k];
  },
  /** take the proposed errand */
  takeErrand(e: Errand) {
    const r = rs();
    r.errand = e;
    writeSave();
  },
  /** tell Thoth: the reward is paid (gold to the bank, an item in the satchel) */
  turnInErrand(): Errand | null {
    const r = rs();
    const e = r.errand;
    if (!e || !Research.errandMet(e)) return null;
    const d = loadSave();
    d.bank += e.reward.gold;
    if (e.reward.item) r.satchel[e.reward.item] = (r.satchel[e.reward.item] ?? 0) + 1;
    r.errand = null;
    r.errands++;
    r.past.push(e.id);
    writeSave(d);
    return e;
  },
  /** drop the errand (Thoth pouts but understands) */
  dropErrand() {
    const r = rs();
    if (r.errand) r.past.push(r.errand.id);
    r.errand = null;
    writeSave();
  },
  /** in-run: the errand was met out there (remembered so the note can say "go tell Thoth") */
  markMet() {
    const r = rs();
    if (r.errand && !r.errand.met) {
      r.errand.met = true;
      writeSave();
    }
  },
  rewardText(e: Errand) {
    return `${e.reward.gold} gold${e.reward.item ? ' & ' + ITEM_NAMES(e.reward.item) : ''}`;
  },
};
