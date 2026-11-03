// BLUEPRINTS: permanent meta unlocks found in the world (rolled parchment
// schematics). Four kinds:
//  - gun:        the Coach Gun and the Chicago Typewriter join the revolver
//  - attachment: per-gun parts (barrels, chokes, drums, compensators, scopes, lasers…)
//  - upgrade:    passive weapon perks that are always on once learned
//  - gear:       equipment pieces; only the starter kit drops until a piece's
//                blueprint is known (GearLoot asks gearUnlocked())
// Plus the treasure collection (relics dug up per region).
//
// HIDEOUT API (all persistent, saved immediately):
//   Blueprints.list()                      every blueprint with { owned }
//   Blueprints.count()                     { found, total }
//   Blueprints.guns()                      [{ id, name, owned, carried }]  (revolver always owned)
//   Blueprints.loadout()                   { secondary, attach } (copy)
//   Blueprints.setSecondary('shotgun' | 'tommy' | null)
//   Blueprints.attachments(gun)            [{ ...AttachmentDef, owned, fitted }]
//   Blueprints.fit(gun, attId) / unfit(gun, slot)
//   Blueprints.upgrades()                  [{ ...UpgradeBp, owned }]
//   Blueprints.relics()                    per region: { region, name, found, total, list }
import { loadSave, writeSave, LongGunId, ArsenalLoadout } from './Save';
import { GEAR, GEAR_IDS, STARTER_GEAR, GearId, SLOT_INFO } from '../player/Equipment';
import { RARITY } from '../run/Upgrades';

export type GunId = 'revolver' | LongGunId;
export type BlueprintKind = 'gun' | 'attachment' | 'upgrade' | 'gear';
export type AttSlot = 'barrel' | 'muzzle' | 'optic' | 'under' | 'mag' | 'stock';
export type BpRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** numeric knobs an attachment turns on its gun (multipliers default 1, adds default 0) */
export interface WeaponTune {
  dmgMul: number;
  spreadMul: number;
  /** extra squeeze on the hip-fire cone only */
  hipSpreadMul: number;
  rangeMul: number;
  pelletsAdd: number;
  /** view climb / punch */
  recoilMul: number;
  /** reload time multiplier (< 1 = faster) */
  reloadMul: number;
  magAdd: number;
  critAdd: number;
  /** crit damage while aiming down the sights */
  adsCritDmg: number;
  zoom: boolean;
  laser: boolean;
  quiet: boolean;
}
export const TUNE_DEFAULT: WeaponTune = { dmgMul: 1, spreadMul: 1, hipSpreadMul: 1, rangeMul: 1, pelletsAdd: 0, recoilMul: 1, reloadMul: 1, magAdd: 0, critAdd: 0, adsCritDmg: 0, zoom: false, laser: false, quiet: false };

export interface GunDef {
  id: GunId;
  name: string;
  title: string;
  desc: string;
  slots: AttSlot[];
  rarity: BpRarity;
  lore?: string;
}
export const GUNS: Record<GunId, GunDef> = {
  revolver: { id: 'revolver', name: 'The Six-Shooter', title: 'Sidearm', desc: 'Six chambers, a fanning palm and Pinch on the reload. Never leaves your hip.', slots: ['under', 'mag'], rarity: 'common' },
  shotgun: {
    id: 'shotgun', name: 'Coach Gun', title: 'Double Barrel', rarity: 'rare', slots: ['barrel', 'muzzle', 'stock', 'under'],
    desc: 'Side-by-side, rabbit-ear hammers. Nine pellets a barrel: huge knockback and gore up close. Break it open, drop two shells in, snap it shut.',
    lore: 'Rode shotgun on the Tombstone stage. The stage did not make it.',
  },
  tommy: {
    id: 'tommy', name: 'Chicago Typewriter', title: 'Drum-Fed Thompson', rarity: 'epic', slots: ['mag', 'muzzle', 'optic', 'under'],
    desc: 'A 1928 Thompson on a 50-round drum. Full-auto spray that climbs as you hold it: pull down and walk it in. Drum swap reload.',
    lore: 'Somebody shipped it west in a violin case. The violin is still missing.',
  },
};

export interface AttachmentDef {
  id: string;
  gun: GunId;
  slot: AttSlot;
  name: string;
  desc: string;
  rarity: BpRarity;
  tune: Partial<WeaponTune>;
}
export const ATTACHMENTS: Record<string, AttachmentDef> = {
  rev_laser: { id: 'rev_laser', gun: 'revolver', slot: 'under', name: "Serket's Eye Laser", rarity: 'uncommon', desc: 'A brass laser under the barrel: hip-fire cone -35%, a red line to whatever you point at.', tune: { hipSpreadMul: 0.65, laser: true } },
  rev_speedloader: { id: 'rev_speedloader', gun: 'revolver', slot: 'mag', name: 'Moon-Clip Speedloader', rarity: 'uncommon', desc: 'All six rounds drop in at once: reloads 30% faster.', tune: { reloadMul: 0.7 } },
  sg_sawnoff: { id: 'sg_sawnoff', gun: 'shotgun', slot: 'barrel', name: 'Lawdog Sawn-Off', rarity: 'uncommon', desc: 'Barrels hacksawed short: +3 pellets, a cone 45% wider, 35% less reach. Faster to swing round.', tune: { pelletsAdd: 3, spreadMul: 1.45, rangeMul: 0.65, reloadMul: 0.9 } },
  sg_long: { id: 'sg_long', gun: 'shotgun', slot: 'barrel', name: 'Long Tom Barrels', rarity: 'rare', desc: '66 cm of goose gun: +60% reach, a 25% tighter cone, +10% pellet damage.', tune: { rangeMul: 1.6, spreadMul: 0.75, dmgMul: 1.1 } },
  sg_choke: { id: 'sg_choke', gun: 'shotgun', slot: 'muzzle', name: 'Full Choke', rarity: 'uncommon', desc: 'Knurled brass chokes: the cone 40% tighter, +40% reach.', tune: { spreadMul: 0.6, rangeMul: 1.4 } },
  sg_holder: { id: 'sg_holder', gun: 'shotgun', slot: 'stock', name: 'Buttstock Shell Holder', rarity: 'uncommon', desc: 'Four spare shells on the stock, right where your hand falls: reloads 40% faster.', tune: { reloadMul: 0.6 } },
  sg_laser: { id: 'sg_laser', gun: 'shotgun', slot: 'under', name: 'Hip-Fire Laser', rarity: 'rare', desc: 'A laser under the tubes: hip-fire cone -30%, +5% crit chance.', tune: { hipSpreadMul: 0.7, laser: true, critAdd: 0.05 } },
  tm_drum100: { id: 'tm_drum100', gun: 'tommy', slot: 'mag', name: 'C-Drum (100 Rounds)', rarity: 'epic', desc: 'The big hundred-round drum: +50 rounds, reloads 15% slower.', tune: { magAdd: 50, reloadMul: 1.15 } },
  tm_cutts: { id: 'tm_cutts', gun: 'tommy', slot: 'muzzle', name: 'Cutts Compensator', rarity: 'rare', desc: 'Slotted muzzle brake: the climb is 45% gentler, bloom 20% lower.', tune: { recoilMul: 0.55, spreadMul: 0.8 } },
  tm_suppressor: { id: 'tm_suppressor', gun: 'tommy', slot: 'muzzle', name: 'Whisper Can', rarity: 'rare', desc: 'A long suppressor: hushed shots, +10% crit chance, 8% less damage.', tune: { quiet: true, critAdd: 0.1, dmgMul: 0.92, recoilMul: 0.85 } },
  tm_scope: { id: 'tm_scope', gun: 'tommy', slot: 'optic', name: 'Pinkerton Scope', rarity: 'rare', desc: 'A brass-tube scope: aiming zooms further, +30% crit damage while aiming.', tune: { zoom: true, adsCritDmg: 0.3 } },
  tm_laser: { id: 'tm_laser', gun: 'tommy', slot: 'under', name: 'Hip-Fire Laser', rarity: 'rare', desc: 'A laser on the barrel: hip-fire cone -30%, a red line to the target.', tune: { hipSpreadMul: 0.7, laser: true } },
};

export interface UpgradeBp {
  id: string;
  name: string;
  desc: string;
  rarity: BpRarity;
  gun?: GunId;
  /** cartridge tip colour on the schematic */
  tip: number;
  mods?: { stat: 'lifesteal' | 'gunDmg' | 'reloadSpeed' | 'critChance'; type: 'flat' | 'pct'; value: number }[];
}
export const WEAPON_UPGRADES: Record<string, UpgradeBp> = {
  up_bloodmoon: { id: 'up_bloodmoon', name: 'Blood Moon Rounds', rarity: 'epic', tip: 0xb0202a, desc: 'Every gun drinks: +4% lifesteal on gun hits, and a kill while you are below 35% health knits 4 HP back.', mods: [{ stat: 'lifesteal', type: 'flat', value: 0.04 }] },
  up_hotloads: { id: 'up_hotloads', name: 'Hot Loads', rarity: 'rare', tip: 0xf08a30, desc: 'Hand-loaded with extra powder: +8% gun damage on every gun.', mods: [{ stat: 'gunDmg', type: 'pct', value: 0.08 }] },
  up_quickdraw: { id: 'up_quickdraw', name: 'Quick-Draw Rig', rarity: 'uncommon', tip: 0xd8c070, desc: 'Weapon swaps are twice as fast, and a holstered gun reloads itself after 2.5 s.' },
  up_dragonsbreath: { id: 'up_dragonsbreath', name: "Dragon's Breath Shells", rarity: 'epic', gun: 'shotgun', tip: 0xff5a1a, desc: 'Coach Gun pellets burn: every pellet that lands sets the target alight.' },
  up_drumfire: { id: 'up_drumfire', name: 'Drum Fire', rarity: 'rare', gun: 'tommy', tip: 0x9dff3a, desc: 'Every 5th Thompson round is a venom tracer (+2 poison stacks).' },
};

// ------------------------------------------------------------------ the treasure collection
export type RegionKey = 'A' | 'B' | 'C';
export interface RelicDef {
  id: string;
  region: RegionKey;
  name: string;
  /** prop model key shown when it is dug up (models/props builders) */
  model: 'goldCoin' | 'ankhFragment' | 'divineCharm' | 'dagger' | 'bottle' | 'lantern' | 'skull' | 'bandage';
  /** bank gold the first find pays */
  value: number;
}
export const REGION_NAMES: Record<RegionKey, string> = { A: 'The Bonewind Dunes', B: 'The Mirage Oasis', C: 'The Red Pyramid' };
export const RELICS: RelicDef[] = [
  { id: 'a_tooth', region: 'A', name: "Black Bart's Gold Tooth", model: 'goldCoin', value: 40 },
  { id: 'a_skull', region: 'A', name: "Ol' Blue's Longhorn Skull", model: 'skull', value: 45 },
  { id: 'a_lamp', region: 'A', name: "Lost Pete's Miner Lamp", model: 'lantern', value: 50 },
  { id: 'a_tonic', region: 'A', name: "Dr. Ramses' Snake-Oil", model: 'bottle', value: 40 },
  { id: 'a_ankh', region: 'A', name: 'Shard of the Scorpion Ankh', model: 'ankhFragment', value: 60 },
  { id: 'a_knife', region: 'A', name: 'The Gravedigger\'s Knife', model: 'dagger', value: 50 },
  { id: 'a_eye', region: 'A', name: 'Glass Eye of Horus', model: 'divineCharm', value: 70 },
  { id: 'a_shroud', region: 'A', name: 'Linen of the First Mummy', model: 'bandage', value: 55 },
  { id: 'b_coin', region: 'B', name: 'Doubloon of the Drowned King', model: 'goldCoin', value: 60 },
  { id: 'b_flask', region: 'B', name: 'Mirage in a Bottle', model: 'bottle', value: 60 },
  { id: 'b_ankh', region: 'B', name: 'Lotus Ankh', model: 'ankhFragment', value: 75 },
  { id: 'b_lamp', region: 'B', name: 'Lamp of the Reed Ferryman', model: 'lantern', value: 65 },
  { id: 'b_charm', region: 'B', name: 'Eye of the Oasis', model: 'divineCharm', value: 80 },
  { id: 'b_knife', region: 'B', name: 'Crocodile-Tooth Dagger', model: 'dagger', value: 70 },
  { id: 'c_coin', region: 'C', name: 'Coin of Set', model: 'goldCoin', value: 80 },
  { id: 'c_skull', region: 'C', name: 'Skull of the Storm Herald', model: 'skull', value: 90 },
  { id: 'c_ankh', region: 'C', name: 'Ankh of the Red Pyramid', model: 'ankhFragment', value: 100 },
  { id: 'c_charm', region: 'C', name: "Sethos' Signet", model: 'divineCharm', value: 110 },
  { id: 'c_wrap', region: 'C', name: 'Burial Wrap of Khonsu', model: 'bandage', value: 90 },
  { id: 'c_knife', region: 'C', name: 'The Obsidian Khopesh Tip', model: 'dagger', value: 100 },
];

// ------------------------------------------------------------------ the catalogue
export interface BlueprintDef {
  id: string;
  kind: BlueprintKind;
  name: string;
  desc: string;
  rarity: BpRarity;
  /** guns / attachments / gun-specific upgrades */
  gun?: GunId;
  slot?: AttSlot;
  gear?: GearId;
  /** one line for the reveal: "GUN", "ATTACHMENT · COACH GUN · MUZZLE", … */
  line: string;
}

let CATALOG: BlueprintDef[] | null = null;
/** every blueprint (built lazily: gear data lives in player/Equipment) */
export function blueprintDefs(): BlueprintDef[] {
  if (CATALOG) return CATALOG;
  const out: BlueprintDef[] = [];
  for (const g of ['shotgun', 'tommy'] as LongGunId[]) {
    const d = GUNS[g];
    out.push({ id: 'gun_' + g, kind: 'gun', name: d.name, desc: d.desc, rarity: d.rarity, gun: g, line: `GUN · ${d.title.toUpperCase()}` });
  }
  for (const a of Object.values(ATTACHMENTS)) out.push({ id: a.id, kind: 'attachment', name: a.name, desc: a.desc, rarity: a.rarity, gun: a.gun, slot: a.slot, line: `ATTACHMENT · ${GUNS[a.gun].name.toUpperCase()} · ${a.slot.toUpperCase()}` });
  for (const u of Object.values(WEAPON_UPGRADES)) out.push({ id: u.id, kind: 'upgrade', name: u.name, desc: u.desc, rarity: u.rarity, gun: u.gun, line: `WEAPON UPGRADE${u.gun ? ' · ' + GUNS[u.gun].name.toUpperCase() : ' · EVERY GUN'}` });
  for (const id of GEAR_IDS) {
    if (STARTER_GEAR.includes(id)) continue;
    const g = GEAR[id];
    out.push({ id: 'gear_' + id, kind: 'gear', name: g.name, desc: g.desc, rarity: g.rarity as BpRarity, gear: id, line: `EQUIPMENT · ${SLOT_INFO[g.slot].name.toUpperCase()}` });
  }
  CATALOG = out;
  return out;
}
export function blueprint(id: string): BlueprintDef | undefined {
  return blueprintDefs().find((b) => b.id === id);
}
export const bpColor = (id: string) => RARITY[(blueprint(id)?.rarity ?? 'common') as keyof typeof RARITY]?.color ?? '#fff3d6';
export const bpHex = (id: string) => RARITY[(blueprint(id)?.rarity ?? 'common') as keyof typeof RARITY]?.hex ?? 0xfff3d6;

const W: Record<BpRarity, number> = { common: 30, uncommon: 24, rare: 14, epic: 6, legendary: 2.5 };

function save() {
  return loadSave();
}

export const Blueprints = {
  list() {
    const s = save();
    return blueprintDefs().map((b) => ({ ...b, owned: s.blueprints.includes(b.id) }));
  },
  known(id: string) {
    return save().blueprints.includes(id);
  },
  count() {
    const s = save();
    const all = blueprintDefs();
    return { found: all.filter((b) => s.blueprints.includes(b.id)).length, total: all.length };
  },
  /** learn a blueprint for good; returns true if it was new. A first gun goes straight onto the sling. */
  learn(id: string) {
    const s = save();
    if (!blueprint(id) || s.blueprints.includes(id)) return false;
    s.blueprints.push(id);
    const b = blueprint(id)!;
    if (b.kind === 'gun' && !s.arsenal.secondary) s.arsenal.secondary = b.gun as LongGunId;
    if (b.kind === 'attachment' && b.gun) {
      // fit it straight away if that slot on the gun is empty
      const fitted = (s.arsenal.attach[b.gun] ??= []);
      if (!fitted.some((x) => ATTACHMENTS[x]?.slot === b.slot)) fitted.push(id);
    }
    writeSave(s);
    return true;
  },

  /**
   * Roll a blueprint the player does not know yet (null when everything is known).
   * Rarity-weighted; luck tilts toward the rare end; the first gun comes early;
   * attachments for guns you don't own yet are rarer.
   */
  roll(rand: () => number = Math.random, o: { luck?: number; kinds?: BlueprintKind[]; exclude?: string[] } = {}): string | null {
    const s = save();
    const luck = o.luck ?? 1;
    const ownsGun = (g?: GunId) => !g || g === 'revolver' || s.blueprints.includes('gun_' + g);
    const anyGun = s.blueprints.some((b) => b.startsWith('gun_'));
    const pool = blueprintDefs().filter((b) => !s.blueprints.includes(b.id) && (!o.kinds || o.kinds.includes(b.kind)) && !o.exclude?.includes(b.id));
    if (!pool.length) return null;
    const weight = (b: BlueprintDef) => {
      let w = W[b.rarity] * (b.rarity === 'rare' || b.rarity === 'epic' || b.rarity === 'legendary' ? luck : 1);
      if (b.kind === 'gun') w *= anyGun ? 1.6 : 6;
      if ((b.kind === 'attachment' || b.kind === 'upgrade') && !ownsGun(b.gun)) w *= 0.3;
      if (b.kind === 'gear') w *= 0.7;
      return w;
    };
    let tot = 0;
    for (const b of pool) tot += weight(b);
    let r = rand() * tot;
    for (const b of pool) {
      r -= weight(b);
      if (r <= 0) return b.id;
    }
    return pool[pool.length - 1].id;
  },

  // ---------------------------------------------------------------- guns
  ownsGun(g: GunId) {
    return g === 'revolver' || save().blueprints.includes('gun_' + g);
  },
  guns() {
    const s = save();
    return (Object.keys(GUNS) as GunId[]).map((id) => ({ id, name: GUNS[id].name, title: GUNS[id].title, owned: this.ownsGun(id), carried: id === 'revolver' || s.arsenal.secondary === id }));
  },
  loadout(): ArsenalLoadout {
    const a = save().arsenal;
    return { secondary: a.secondary, attach: Object.fromEntries(Object.entries(a.attach).map(([k, v]) => [k, [...v]])) };
  },
  /** the long gun carried on the sling (must be owned) */
  setSecondary(g: LongGunId | null) {
    const s = save();
    if (g && !this.ownsGun(g)) return false;
    s.arsenal.secondary = g;
    writeSave(s);
    return true;
  },
  attachments(g: GunId) {
    const s = save();
    const fitted = s.arsenal.attach[g] ?? [];
    return Object.values(ATTACHMENTS)
      .filter((a) => a.gun === g)
      .map((a) => ({ ...a, owned: s.blueprints.includes(a.id), fitted: fitted.includes(a.id) }));
  },
  /** fit an owned attachment (replaces whatever sat in that slot) */
  fit(g: GunId, attId: string) {
    const a = ATTACHMENTS[attId];
    const s = save();
    if (!a || a.gun !== g || !s.blueprints.includes(attId)) return false;
    const list = (s.arsenal.attach[g] ?? []).filter((x) => ATTACHMENTS[x]?.slot !== a.slot);
    list.push(attId);
    s.arsenal.attach[g] = list;
    writeSave(s);
    return true;
  },
  unfit(g: GunId, slot: AttSlot) {
    const s = save();
    s.arsenal.attach[g] = (s.arsenal.attach[g] ?? []).filter((x) => ATTACHMENTS[x]?.slot !== slot);
    writeSave(s);
  },
  /** the attachments fitted to a gun (owned ones only) */
  fitted(g: GunId): AttachmentDef[] {
    const s = save();
    return (s.arsenal.attach[g] ?? []).filter((x) => s.blueprints.includes(x) && ATTACHMENTS[x]?.gun === g).map((x) => ATTACHMENTS[x]);
  },
  upgrades() {
    const s = save();
    return Object.values(WEAPON_UPGRADES).map((u) => ({ ...u, owned: s.blueprints.includes(u.id) }));
  },
  hasUpgrade(id: string) {
    return save().blueprints.includes(id);
  },

  // ---------------------------------------------------------------- gear
  /** may this gear piece drop / be sold? (starter kit, or its blueprint is known) */
  gearUnlocked(id: GearId) {
    return STARTER_GEAR.includes(id) || save().blueprints.includes('gear_' + id);
  },

  // ---------------------------------------------------------------- treasure
  relics() {
    const s = save();
    return (['A', 'B', 'C'] as RegionKey[]).map((region) => {
      const list = RELICS.filter((r) => r.region === region).map((r) => ({ id: r.id, name: r.name, found: s.relics.includes(r.id) }));
      return { region, name: REGION_NAMES[region], found: list.filter((r) => r.found).length, total: list.length, list };
    });
  },
  hasRelic(id: string) {
    return save().relics.includes(id);
  },
  /** record a relic; returns the bank gold paid (0 if it was already in the collection) */
  addRelic(id: string) {
    const s = save();
    const r = RELICS.find((x) => x.id === id);
    if (!r || s.relics.includes(id)) return 0;
    s.relics.push(id);
    s.bank += r.value;
    writeSave(s);
    return r.value;
  },
};

/** the tuning a gun gets from its fitted attachments */
export function gunTune(g: GunId, fitted: AttachmentDef[] = Blueprints.fitted(g)): WeaponTune {
  const t: WeaponTune = { ...TUNE_DEFAULT };
  for (const a of fitted) {
    const u = a.tune;
    if (u.dmgMul) t.dmgMul *= u.dmgMul;
    if (u.spreadMul) t.spreadMul *= u.spreadMul;
    if (u.hipSpreadMul) t.hipSpreadMul *= u.hipSpreadMul;
    if (u.rangeMul) t.rangeMul *= u.rangeMul;
    if (u.recoilMul) t.recoilMul *= u.recoilMul;
    if (u.reloadMul) t.reloadMul *= u.reloadMul;
    t.pelletsAdd += u.pelletsAdd ?? 0;
    t.magAdd += u.magAdd ?? 0;
    t.critAdd += u.critAdd ?? 0;
    t.adsCritDmg += u.adsCritDmg ?? 0;
    t.zoom ||= !!u.zoom;
    t.laser ||= !!u.laser;
    t.quiet ||= !!u.quiet;
  }
  return t;
}
