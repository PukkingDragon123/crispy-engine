// The turtle shop's shelf, filtered and filled by the slow reveal (meta/Unlocks):
//  - consumables: only the ones unlocked so far (the starter four, then smoke bombs,
//    tin stars, daggers, linen, charms as discoveries, studies, bosses and deaths open them)
//  - one RARE WARE spot: a ride-long boon (Ferryman's Coin, Ankh of Return, ...) or a
//    gun's plans, once unlocked; a freshly unlocked ware always gets the spot first
// Missions.wares() runs the shop's own stock through unlockShelf(); the StockBook keeps
// the result for the restock period like any other shelf.
import type { Ctx } from '../Ctx';
import type { Player } from '../player/Player';
import type { Ware } from '../ui/Shop';
import { ITEMS, type ItemId } from '../player/Items';
import { Unlocks } from '../meta/Unlocks';
import { Blueprints, GUNS } from '../meta/Blueprints';
import type { LongGunId } from '../meta/Save';
import { rnd } from '../../engine/math/rand';
import type { StatId } from '../combat/Stats';

export interface ShelfDeps {
  ctx: Ctx;
  player: Player;
  /** add a consumable to the pockets (false: full) */
  add(id: ItemId): boolean;
  pockets?(id: ItemId): { have: number; room: boolean };
}

/** the words on each consumable's price tag (mirrors the shop's own) */
const SHORT: Partial<Record<ItemId, string>> = {
  bandage: 'heals 35%', goldBandage: 'heals 70%, cleanses', dagger: '+40% damage', smoke: 'vanish, +dodge', shield: 'tin shield',
  charm: 'cleanse, untouchable', dynamite: 'six-metre blast', snakeoil: 'speed, fire rate', whiskey: '+25% crit',
};

interface Rare {
  name: string;
  desc: string;
  short: string;
  price: number;
  model: string;
  mods: [StatId, 'flat' | 'pct', number][];
  /** extra effect on purchase */
  extra?: (d: ShelfDeps) => void;
}

/** the rare wares (unlock id `ware:<key>`): boons that last the whole ride */
const RARES: Record<string, Rare> = {
  ferryCoin: {
    name: "Ferryman's Coin", short: '+20% gold, all ride', price: 70, model: 'gold_coin',
    desc: 'The coin for the boat across. Anubis waved it off: keep it, spend it twice. +20% gold for the rest of the ride.',
    mods: [['goldGain', 'pct', 0.2]],
  },
  ankh: {
    name: 'Ankh of Return', short: '+12% health, regen', price: 120, model: 'ankh_fragment',
    desc: 'A shard of the key of life, warm to the touch. +12% max health and a little regeneration for the rest of the ride.',
    mods: [['maxHp', 'pct', 0.12], ['regen', 'flat', 0.5]],
    extra: (d) => (d.player.hp = Math.min(d.player.maxHp, d.player.hp + d.player.maxHp * 0.12)),
  },
  weighedHeart: {
    name: 'Heart on the Scale', short: 'wrath fills faster', price: 140, model: 'divine_charm',
    desc: "A heart that was weighed and found light. Serket's Wrath charges 30% faster all ride, and the jar fills a quarter now.",
    mods: [['ultCharge', 'pct', 0.3]],
    extra: (d) => (d.ctx.run.ultCharge = Math.min(1, d.ctx.run.ultCharge + 0.25)),
  },
  lantern: {
    name: "Prospector's Lantern", short: 'pull loot from afar', price: 60, model: 'lantern',
    desc: 'Lost Pete swore by it. Coins and pickups come to you from half again as far, and finds run a little rarer, all ride.',
    mods: [['pickupRange', 'pct', 0.5], ['rarity', 'pct', 0.08]],
  },
  ledgerInk: {
    name: "Bounty Hunter's Ink", short: '+20% bounty, all ride', price: 90, model: 'bottle_2',
    desc: 'Write your kills in this and the posters pay more. +20% bounty for the rest of the ride.',
    mods: [['bountyGain', 'pct', 0.2]],
  },
  thothInk: {
    name: 'Ink of Thoth', short: 'rarer cards, all ride', price: 100, model: 'bottle_3',
    desc: 'Thoth mixed it himself and spilled most of it. Rank-up cards come up rarer for the rest of the ride.',
    mods: [['rarity', 'pct', 0.2]],
  },
};

function itemWare(id: ItemId, scale: number, d: ShelfDeps): Ware {
  const it = ITEMS[id];
  return {
    id, name: it.name, desc: it.desc, price: Math.round(it.price * scale), model: it.model, buy: () => d.add(id), short: SHORT[id],
    note: () => {
      const p = d.pockets?.(id);
      if (!p) return null;
      if (!p.room) return { text: 'Your pockets are full: use one first.', bad: true };
      return p.have ? { text: `You carry ${p.have}. One more fits.` } : { text: 'Fits in an empty pocket.', good: true };
    },
  };
}

function rareWare(key: string, scale: number, d: ShelfDeps): Ware | null {
  const r = RARES[key];
  if (!r) return null;
  return {
    id: 'ware:' + key, name: r.name, desc: r.desc, price: Math.round(r.price * scale), model: r.model, short: r.short,
    buy: () => {
      d.player.stats.add(r.mods.map(([stat, type, value]) => ({ stat, type, value, source: 'ware:' + key })));
      r.extra?.(d);
      d.ctx.toast(r.name.toUpperCase(), '#ffd36b', r.short, false);
      return true;
    },
    note: () => ({ text: 'A rare ware: it lasts the whole ride.', good: true }),
  };
}

function planWare(bp: string, scale: number, d: ShelfDeps): Ware | null {
  if (Blueprints.known(bp)) return null;
  const g = GUNS[bp.replace(/^gun_/, '') as LongGunId];
  if (!g) return null;
  return {
    id: 'plan:' + bp, name: `${g.name} Plans`, desc: `${g.desc} Learn it for good: it rides on your back from now on.`, price: Math.round((bp === 'gun_tommy' ? 320 : 220) * scale), model: 'book', short: 'a gun, kept forever',
    buy: () => {
      if (!Blueprints.learn(bp)) return false;
      d.player.weapons?.onLearn?.(bp);
      d.ctx.events.emit('blueprintFound', bp);
      return true;
    },
    note: () => ({ text: 'Kept forever, like a found blueprint.', good: true }),
  };
}

/**
 * The shelf for a restock period: the shop's stock with locked consumables swapped for
 * unlocked ones (three in all) and the rare-ware spot filled. Fresh unlocks come first.
 */
export function unlockShelf(base: Ware[], d: ShelfDeps): Ware[] {
  const scale = 1 + Math.max(0, d.ctx.run.wave) * 0.03;
  const isItem = (w: Ware) => w.id in ITEMS;
  const fresh = Unlocks.freshShop();
  const open = (Object.keys(ITEMS) as ItemId[]).filter((id) => Unlocks.itemOpen(id));
  const items = base.filter((w) => isItem(w) && Unlocks.itemOpen(w.id as ItemId));
  const want = Math.max(3, base.filter(isItem).length);
  // a freshly unlocked consumable always makes the shelf
  for (const f of fresh) {
    const id = f.slice(5) as ItemId;
    if (!f.startsWith('item:') || !(id in ITEMS) || items.some((w) => w.id === id)) continue;
    if (items.length >= want) items.pop();
    items.unshift(itemWare(id, scale, d));
  }
  const left = open.filter((id) => !items.some((w) => w.id === id));
  while (items.length < want && left.length) items.push(itemWare(left.splice(Math.floor(rnd.next() * left.length), 1)[0], scale, d));
  // the rare-ware spot
  const rares = Unlocks.shopRares();
  let rare: Ware | null = null;
  const make = (u: string) => (u.startsWith('ware:') ? rareWare(u.slice(5), scale, d) : u.startsWith('plan:') ? planWare(u.slice(5), scale, d) : null);
  for (const f of fresh) if (!rare && /^(ware|plan):/.test(f)) rare = make(f);
  if (!rare && rares.length) {
    const pool = rares.slice();
    while (!rare && pool.length) rare = make(pool.splice(Math.floor(rnd.next() * pool.length), 1)[0]);
  }
  for (const w of items) if (fresh.includes('item:' + w.id)) Unlocks.markShelved('item:' + w.id);
  if (rare) Unlocks.markShelved(rare.id);
  const rest = base.filter((w) => !isItem(w));
  const heal = rest.filter((w) => w.id === 'heal');
  const others = rest.filter((w) => w.id !== 'heal');
  return [...items, ...heal, ...(rare ? [rare] : []), ...others];
}

/**
 * Something unlocked after this period's shelf was built (a death, a discovery): it goes
 * onto the shelf now, in place of an unsold consumable or the rare-ware spot, so what
 * Ozymandias announces is really there.
 */
export function refreshShelf(wares: Ware[], sold: Set<string>, d: ShelfDeps) {
  const scale = 1 + Math.max(0, d.ctx.run.wave) * 0.03;
  for (const f of Unlocks.freshShop()) {
    const [kind, key] = [f.slice(0, f.indexOf(':')), f.slice(f.indexOf(':') + 1)];
    if (wares.some((w) => w.id === (kind === 'item' ? key : f))) {
      Unlocks.markShelved(f);
      continue;
    }
    if (kind === 'item' && key in ITEMS) {
      const i = wares.map((w, k) => (w.id in ITEMS && !sold.has(w.id) ? k : -1)).filter((k) => k >= 0).pop();
      const nw = itemWare(key as ItemId, scale, d);
      if (i !== undefined) wares[i] = nw;
      else wares.unshift(nw);
    } else {
      const nw = kind === 'ware' ? rareWare(key, scale, d) : kind === 'plan' ? planWare(key, scale, d) : null;
      if (!nw) {
        Unlocks.markShelved(f);
        continue;
      }
      const i = wares.findIndex((w) => /^(ware|plan):/.test(w.id) && !sold.has(w.id));
      if (i >= 0) wares[i] = nw;
      else {
        const at = wares.findIndex((w) => w.id === 'card');
        wares.splice(at >= 0 ? at : wares.length, 0, nw);
        if (wares.length > 8) wares.splice(wares.findIndex((w, k) => k > at && w.id.startsWith('gear_') && !sold.has(w.id)), 1);
      }
    }
    Unlocks.markShelved(f);
  }
  return wares;
}
