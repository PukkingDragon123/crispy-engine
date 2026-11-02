// Registry of props / structures / items for the model viewer and game lookups.
import type { ModelEntry } from './registryCharacters';
import * as Pr from './props';

export const PROP_MODELS: Record<string, ModelEntry> = {
  ...seeds('cactus_saguaro', 8, (i) => Pr.cactus(i, 'saguaro')),
  ...seeds('cactus_barrel', 4, (i) => Pr.cactus(i, 'barrel')),
  ...seeds('cactus_prickly', 4, (i) => Pr.cactus(i, 'prickly')),
  ...seeds('cactus_organ', 3, (i) => Pr.cactus(i, 'organ')),
  cactus_saguaro_dmg1: () => Pr.cactusDamaged(3, 'saguaro', 1),
  cactus_saguaro_dmg2: () => Pr.cactusDamaged(3, 'saguaro', 2),
  cactus_saguaro_dmg3: () => Pr.cactusDamaged(3, 'saguaro', 3),
  ...seeds('rock_small', 3, (i) => Pr.rock(i, 1)),
  ...seeds('rock', 4, (i) => Pr.rock(i, 2)),
  ...seeds('rock_large', 3, (i) => Pr.rock(i, 3)),
  ...seeds('boulder', 2, (i) => Pr.boulder(i)),
  ...seeds('tumbleweed', 2, (i) => Pr.tumbleweed(i)),
  ...seeds('palm', 3, (i) => Pr.palm(i)),
  ...seeds('dry_bush', 3, (i) => Pr.dryBush(i)),
  skull_cow: () => Pr.skull('cow'),
  skull_giant: () => Pr.skull('giant'),
  rib_arch: () => Pr.ribArch(0),
  ...seeds('bone_scatter', 2, (i) => Pr.boneScatter(i)),
  // --- Wild West props
  ...seeds('crate', 4, (i) => Pr.crate(i)),
  ...seeds('tnt_crate', 2, (i) => Pr.tntCrate(i)),
  ...seeds('barrel', 2, (i) => Pr.barrel(i)),
  ...seeds('whiskey_barrel', 2, (i) => Pr.whiskeyBarrel(i)),
  fence_4m: () => Pr.fence(4, 1),
  fence_6m: () => Pr.fence(6, 2),
  ...seeds('fence_broken', 3, (i) => Pr.fenceBroken(i, 4, i % 2 ? 1 : 2)),
  ...seeds('signpost', 4, (i) => Pr.signpost(i)),
  hitching_post: () => Pr.hitchingPost(1),
  ...seeds('wagon_wheel', 2, (i) => Pr.wagonWheel(i)),
  ...seeds('wagon', 2, (i) => Pr.wagon(i)),
  mine_cart: () => Pr.mineCart(1),
  rail_4m: () => Pr.railSegment(4, 1),
  trough: () => Pr.trough(1),
  campfire: () => Pr.campfire(1),
  ...seeds('tent', 2, (i) => Pr.tent(i)),
  outhouse: () => Pr.outhouse(1),
  gallows: () => Pr.gallows(1),
  windmill: () => { const w = Pr.windmill(1); const m = w.model.clone(); const b = w.model.bounds(); m.merge(w.rotor, Math.round((b.minX + b.maxX) / 2), b.minY + Math.round(w.rotorAt[1] / w.voxelSize), Math.round((b.minZ + b.maxZ) / 2) + Math.round(w.rotorAt[2] / w.voxelSize)); return { model: m, voxelSize: w.voxelSize }; },
  water_tower: () => Pr.waterTower(1),
  watchtower: () => Pr.watchtower(1),
  ...seeds('shack', 4, (i) => Pr.shack(i)),
  ...seeds('wanted_board', 2, (i) => Pr.wantedBoard(i)),
  well: () => Pr.well(1),
  cattle_skull_post: () => Pr.cattleSkullPost(1),
  ...seeds('pot', 3, (i) => Pr.pot(i)),
  ...seeds('rug', 2, (i) => Pr.rug(i)),
  saloon_facade: () => Pr.saloonFacade(1),
  sheriff_facade: () => Pr.sheriffFacade(1),
  general_store_facade: () => Pr.generalStoreFacade(1),
  // --- Landmark encounter sites
  outlaw_fort: () => Pr.outlawFort(1),
  trading_post: () => Pr.tradingPost(1),
  mine_headframe: () => Pr.mineHeadframe(1),
  ranch_barn: () => Pr.ranchBarn(1),
  sheriff_office: () => Pr.sheriffOffice(1),
  saloon: () => Pr.saloon(1),
  // --- Egyptian accents
  obelisk: () => Pr.obelisk(1, false),
  obelisk_broken: () => Pr.obelisk(3, true),
  column: () => Pr.column(1, false),
  column_broken: () => Pr.column(2, true),
  sphinx: () => Pr.sphinx(),
  temple_gate: () => Pr.templeGate(0),
  capstone: () => Pr.capstone(),
  ...seeds('mudbrick_ruin', 2, (i) => Pr.mudbrickRuin(i)),
  statue_ra: () => Pr.godStatue('ra'),
  statue_thoth: () => Pr.godStatue('thoth'),
  statue_bastet: () => Pr.godStatue('bastet'),
  statue_horus: () => Pr.godStatue('horus'),
  statue_sekhmet: () => Pr.godStatue('sekhmet'),
  statue_anubis: () => Pr.godStatue('anubis'),
  statue_set: () => Pr.godStatue('set'),
  statue_serket: () => Pr.godStatue('serket'),
  ...seeds('hieroglyph_wall', 2, (i) => Pr.hieroglyphWall(i)),
  scorpion_totem: () => Pr.scorpionTotem(),
  sarcophagus: () => Pr.sarcophagus(),
  // --- Loot
  chest_wood: () => chestPreview('wood'),
  chest_silver: () => chestPreview('silver'),
  chest_gold: () => chestPreview('gold'),
  chest_divine: () => chestPreview('divine'),
  ore_copper: () => Pr.oreNode('copper', 1),
  ore_silver: () => Pr.oreNode('silver', 2),
  ore_gold: () => Pr.oreNode('gold', 3),
  ore_turquoise: () => Pr.oreNode('turquoise', 4),
  ore_amethyst: () => Pr.oreNode('amethyst', 5),
  bandage: () => Pr.bandage(),
  dagger: () => Pr.dagger(),
  smoke_bomb: () => Pr.smokeBomb(),
  shield_charm: () => Pr.shieldCharm(),
  divine_charm: () => Pr.divineCharm(),
  gold_coin: () => Pr.goldCoin(),
  ankh_fragment: () => Pr.ankhFragment(),
  dynamite: () => Pr.dynamiteBundle(),
  // camelCase aliases used by ITEMS[].model (HUD / inventory)
  smokeBomb: () => Pr.smokeBomb(),
  shieldCharm: () => Pr.shieldCharm(),
  divineCharm: () => Pr.divineCharm(),
  goldCoin: () => Pr.goldCoin(),
  tntCrate: () => Pr.tntCrate(1),
  bottle: () => Pr.bottle(0),
  // --- Hideout saloon
  bar_counter: () => Pr.barCounter(),
  shelf: () => Pr.shelf(1),
  ...seeds('bottle', 4, (i) => Pr.bottle(i)),
  stool: () => Pr.stool(),
  table: () => Pr.table(1),
  piano: () => Pr.piano(),
  mirror: () => Pr.mirror(),
  wardrobe: () => Pr.wardrobe(),
  workbench: () => Pr.workbench(),
  notice_board: () => Pr.noticeBoard(1),
  book: () => Pr.book(),
  gramophone: () => Pr.gramophone(),
  dartboard: () => Pr.dartboard(),
  lantern: () => Pr.lantern(),
  floor_tile: () => Pr.floorTile(1),
  wall_segment: () => Pr.wallSegment(true, 1),
  wall_segment_plain: () => Pr.wallSegment(false, 2),
  swing_door: () => Pr.swingDoor(),
  roof_beam: () => Pr.roofBeam(),
  menu_sign: () => menuSignPreview(),
};

/** viewer preview: chest base + closed lid merged */
function chestPreview(t: Pr.ChestTier) {
  const c = Pr.chest(t);
  const m = c.base.clone();
  m.merge(c.lid);
  return { model: m, voxelSize: c.voxelSize };
}
/** viewer preview: post with planks placed at their rest positions (no tilt) */
function menuSignPreview() {
  const s = Pr.menuSign();
  const m = s.post.model.clone();
  const b = m.bounds();
  const px = (b.minX + b.maxX + 1) / 2, pz = (b.minZ + b.maxZ + 1) / 2;
  for (const p of s.planks) {
    const ox = Math.round(px + p.at[0] / p.voxelSize - p.pivot[0]);
    const oy = Math.round(b.minY + p.at[1] / p.voxelSize - p.pivot[1]);
    const oz = Math.round(pz + p.at[2] / p.voxelSize - p.pivot[2]);
    p.model.forEach((x, y, z, c, f) => m.set(x + ox, y + oy, z + oz, c, f));
  }
  return { model: m, voxelSize: s.post.voxelSize };
}

function seeds(prefix: string, n: number, f: (i: number) => ReturnType<ModelEntry>): Record<string, ModelEntry> {
  const o: Record<string, ModelEntry> = {};
  for (let i = 1; i <= n; i++) o[`${prefix}_${i}`] = () => f(i);
  return o;
}
