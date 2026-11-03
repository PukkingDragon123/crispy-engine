// THE TREASURE HUNT: things to find, dig up and keep.
//
//  - GLINTS: something brassy catching the sun in the sand. Hold T to dig it
//    up (a short dig): coins, sometimes an item or a torn treasure map.
//  - SUSPICIOUS MOUNDS: sand heaped over something, marker stones on top.
//    A longer dig: a buried chest (rises out of the hole), a prospector's bone
//    cache (gold teeth, his poke, maybe a map) or a sealed map case with a
//    BLUEPRINT inside.
//  - TREASURE MAPS: torn fragments lying in the world (and in mounds, chests,
//    on alphas). Picking one up reveals an X: crossed bones and a stake with a
//    red rag, a column of golden motes you can see from far off. The X hides a
//    RELIC of this region (the persistent collection: found / total per
//    region, each first find pays into the bank) or a blueprint cache.
//  - BLUEPRINTS: rolled schematics. Chests (ruins, outposts, quests, every
//    chest) can hold one, bosses always drop one, alphas sometimes; ride
//    through the scroll for the BLUEPRINT FOUND reveal (ui/BlueprintReveal).
//  - HEALING: medicinal aloe (ride up, T: +20 HP and the poison drawn out; it
//    regrows) and canteens hanging by the campfires (T: a long drink, 35%).
//
// While digging, the hunter really digs (player/Weapons.ts dig pose: shovel,
// scoops, sand thrown over his shoulder), the mound sinks and the hole darkens.
//
// ─────────────────────────────────────────────────────────────── INTEGRATION (RunScene)
//   import { TreasureHunt } from '../run/TreasureHunt';
//   field:   treasure: TreasureHunt | null = null;
//   enter(): right after `this.ruins = new RuinNests({...})` (before the first populateZone):
//              this.treasure = new TreasureHunt({ ctx: this.ctx, player: this.player, inter: this.inter, input: e.input,
//                area: this.opts.area, hud: this.hud, items: this.items, pickups: this.pickups,
//                chest: (x, z, t, r) => this.spawnChest(x, z, t, r) });
//   populateZone(z): at the end:   this.treasure?.populateZone(z);
//   update():  next to `this.gearLoot.update(dt, rdt);` (before the modal early return):
//              this.treasure?.update(dt, rdt);
//   modal:     add `|| !!this.treasure?.modal` to `const modal = ...` and to `const cineHud = ...`
//   exit():    this.treasure?.dispose();
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../Ctx';
import type { Player } from '../player/Player';
import type { Input } from '../../engine/Input';
import type { Interactable } from './Interact';
import type { ZoneDef } from '../world/RegionGen';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { rnd, clamp } from '../../engine/math/rand';
import { Ease } from '../../engine/Tween';
import { Blueprints, blueprint, RELICS, RelicDef, REGION_NAMES, bpHex } from '../meta/Blueprints';
import { BlueprintReveal } from '../ui/BlueprintReveal';
import * as TM from '../models/props/treasure';
import * as PM from '../models/props';

type Area = 'A' | 'B' | 'C';
type ChestTier = 'wood' | 'silver' | 'gold' | 'divine';
type V = { x: number; y: number; z: number };

export interface TreasureDeps {
  ctx: Ctx;
  player: Player;
  inter: { add(i: Interactable): Interactable; remove(i: Interactable): void };
  input: Input;
  area: Area;
  hud?: { setVisible(on: boolean): void };
  items?: { add(id: any, n?: number): boolean };
  pickups?: { drop(kind: any, value: number, at: V, n?: number): void };
  /** RunScene.spawnChest (returns the Chest so it can rise out of the hole) */
  chest?: (x: number, z: number, tier: ChestTier, rot?: number) => { root: THREE.Object3D } | void;
}

/** what a dig turns up */
type Cache = { kind: 'chest'; tier: ChestTier } | { kind: 'bones' } | { kind: 'blueprint'; id: string } | { kind: 'relic'; id: string } | { kind: 'small' } | { kind: 'gold' };

interface Site {
  kind: 'glint' | 'mound' | 'x';
  pos: THREE.Vector3;
  zone: number;
  zoneName: string;
  obj: THREE.Object3D | null;
  cache: Cache;
  need: number;
  progress: number;
  revealed: boolean;
  done: boolean;
  inter: Interactable | null;
  glint: number;
  hole: number;
}

interface Drop {
  kind: 'blueprint' | 'map';
  id: string;
  obj: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  t: number;
  settled: boolean;
  arm: number;
  glint: number;
  /** lying on the ground (world-placed maps) rather than hovering */
  ground: boolean;
}

interface Healer {
  kind: 'aloe' | 'canteen';
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  inter: Interactable;
  regrow: number;
  seed: number;
}

// ------------------------------------------------------------------ geometry cache (shared across runs)
const GEO = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => { model: any; voxelSize: number; pivot?: any }, pivot: 'bottom' | 'center' | null = null) {
  let g = GEO.get(key);
  if (!g) {
    const m = make();
    g = buildVoxelGeometry(m.model, { voxelSize: m.voxelSize, pivot: pivot ?? m.pivot ?? 'bottom' });
    g.computeBoundingBox();
    GEO.set(key, g);
  }
  return g;
}
function mesh(g: THREE.BufferGeometry) {
  const m = new THREE.Mesh(g, sharedVoxelMaterial);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const RELIC_MODEL: Record<RelicDef['model'], () => { model: any; voxelSize: number }> = {
  goldCoin: () => (PM as any).goldCoin(),
  ankhFragment: () => (PM as any).ankhFragment(),
  divineCharm: () => (PM as any).divineCharm(),
  dagger: () => (PM as any).dagger(),
  bottle: () => (PM as any).bottle(2),
  lantern: () => (PM as any).lantern(),
  skull: () => (PM as any).skull('cow'),
  bandage: () => (PM as any).bandage(),
};

const _v = new THREE.Vector3();

export class TreasureHunt {
  sites: Site[] = [];
  drops: Drop[] = [];
  healers: Healer[] = [];
  reveal: BlueprintReveal;
  private group = new THREE.Group();
  private digging: Site | null = null;
  private relicPool: string[];
  private offs: (() => void)[] = [];
  private zones = new Map<number, ZoneDef>();
  private t = 0;
  private drinkT = 0;

  constructor(private d: TreasureDeps) {
    const ctx = d.ctx;
    ctx.scene.add(this.group);
    this.reveal = new BlueprintReveal(ctx, d.input, d.hud, () => d.player.center(new THREE.Vector3()));
    // the relics of this region still out there (each X gets one)
    this.relicPool = RELICS.filter((r) => r.region === d.area && !Blueprints.hasRelic(r.id)).map((r) => r.id);
    for (let i = this.relicPool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd.next() * (i + 1));
      [this.relicPool[i], this.relicPool[j]] = [this.relicPool[j], this.relicPool[i]];
    }
    const ev = ctx.events;
    // every chest can hide a schematic (ruins, outposts, quests, dug-up chests)
    this.offs.push(ev.on('chestLooted', (tier: ChestTier, at: V) => {
      const p = { wood: 0.12, silver: 0.3, gold: 0.55, divine: 0.9 }[tier] ?? 0.12;
      if (rnd.chance(p)) {
        const id = this.rollBlueprint(tier === 'divine' || tier === 'gold' ? 1.6 : 1);
        if (id) ctx.engine.tweens.after(0.7, () => this.dropBlueprint(id, at, 6));
      } else if (rnd.chance(0.16)) ctx.engine.tweens.after(0.8, () => this.dropMap(at, 5));
    }));
    // bosses always leave a schematic; alphas now and then (or a map)
    this.offs.push(ev.on('bossDefeated', (b: EnemyLike, escaped: boolean) => {
      if (escaped) return;
      const id = this.rollBlueprint(2.5);
      if (id) ctx.engine.tweens.after(1.8, () => this.dropBlueprint(id, { x: b.pos.x, y: b.pos.y + 1.5, z: b.pos.z }, 8));
    }));
    this.offs.push(ev.on('enemyKilled', (e: EnemyLike) => {
      if (!(e as { alpha?: boolean }).alpha) return;
      const at = { x: e.pos.x, y: e.pos.y + 1, z: e.pos.z };
      if (rnd.chance(0.16)) {
        const id = this.rollBlueprint(1.3);
        if (id) this.dropBlueprint(id, at, 6);
      } else if (rnd.chance(0.25)) this.dropMap(at, 5);
    }));
    // each scoop of sand: the mound visibly gives way
    this.offs.push(ev.on('digScoop', () => {
      const s = this.digging;
      if (!s?.obj) return;
      ctx.events.emit('groundMark', s.pos.x + (rnd.next() - 0.5) * 0.6, s.pos.z + (rnd.next() - 0.5) * 0.6, 0.5 + s.progress / s.need, 0);
    }));
  }

  /** true while a reveal owns the screen (add to RunScene's modal check) */
  get modal() {
    return this.reveal.active;
  }

  /** world points worth a HUD marker: revealed X spots and scrolls lying around */
  waypoints(): { x: number; y: number; z: number; kind: 'x' | 'blueprint' | 'map' }[] {
    const out: { x: number; y: number; z: number; kind: 'x' | 'blueprint' | 'map' }[] = [];
    for (const s of this.sites) if (s.kind === 'x' && s.revealed && !s.done) out.push({ x: s.pos.x, y: s.pos.y + 1.5, z: s.pos.z, kind: 'x' });
    for (const dd of this.drops) out.push({ x: dd.pos.x, y: dd.pos.y, z: dd.pos.z, kind: dd.kind });
    return out;
  }

  /** collection progress for this region (found / total), for HUD toasts */
  collection() {
    return Blueprints.relics().find((r) => r.region === this.d.area)!;
  }

  // ------------------------------------------------------------------ placement
  /** an open, dry, gentle spot in the zone, clear of solids and of other finds (claimed in the world) */
  private spot(z: ZoneDef, clear = 3, rMin = 0.2, rMax = 0.85): THREE.Vector3 | null {
    const ctx = this.d.ctx;
    const w = ctx.world as unknown as {
      findOpenSpot?: (zone: ZoneDef, radius: number, opts?: { minDist?: number; maxDist?: number; maxSlope?: number; strict?: boolean; tries?: number }) => { x: number; y: number; z: number } | null;
      claimSpot?: (zone: ZoneDef, x: number, z: number, r: number, owner?: string) => unknown;
      sa?: { waterLevel?: number; field?: { heightAt(x: number, z: number): number } };
    };
    const free = (x: number, zz: number) => !this.sites.some((s) => Math.hypot(s.pos.x - x, s.pos.z - zz) < 9) && !this.healers.some((h) => Math.hypot(h.pos.x - x, h.pos.z - zz) < 6);
    if (w.findOpenSpot) {
      for (let i = 0; i < 5; i++) {
        const p = w.findOpenSpot(z, clear, { minDist: z.r * rMin, maxDist: z.r * rMax, maxSlope: 0.45, strict: true, tries: 40 });
        if (!p) break;
        if (!free(p.x, p.z)) continue;
        w.claimSpot?.(z, p.x, p.z, clear, 'treasure');
        return new THREE.Vector3(p.x, ctx.world.groundAt(p.x, p.z), p.z);
      }
    }
    for (let tries = 0; tries < 40; tries++) {
      const a = rnd.next() * Math.PI * 2, r = z.r * (rMin + rnd.next() * (rMax - rMin));
      const x = z.cx + Math.cos(a) * r, zz = z.cz + Math.sin(a) * r;
      let blocked = false;
      ctx.world.colliders.query(x, zz, clear + 3, (c) => {
        if (c.enabled && c.solid && Math.hypot(c.x - x, c.z - zz) < c.r + clear) blocked = true;
      });
      if (blocked || !free(x, zz)) continue;
      let lo = 1e9, hi = -1e9, wet = false;
      for (const [ox, oz] of [[0, 0], [1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]]) {
        const g = ctx.world.groundAt(x + ox, zz + oz);
        lo = Math.min(lo, g);
        hi = Math.max(hi, g);
        if (w.sa?.field && w.sa.waterLevel !== undefined && w.sa.field.heightAt(x + ox, zz + oz) < w.sa.waterLevel + 0.1) wet = true;
      }
      if (hi - lo > 0.9 || wet) continue;
      return new THREE.Vector3(x, ctx.world.groundAt(x, zz), zz);
    }
    return null;
  }

  /** the world's reserved dig spots in this zone (RegionGen digSpot anchors), near sights first */
  private digSpots(z: ZoneDef): { p: THREE.Vector3; near?: string }[] {
    const ground = this.d.ctx.world.groundAt;
    return z.anchors
      .filter((a) => a.kind === 'digSpot')
      .sort((a, b) => (b.data?.near ? 1 : 0) - (a.data?.near ? 1 : 0))
      .map((a) => ({ p: new THREE.Vector3(a.x, ground(a.x, a.z), a.z), near: a.data?.near as string | undefined }));
  }

  populateZone(z: ZoneDef) {
    if (this.zones.has(z.index)) return;
    this.zones.set(z.index, z);
    // reserved dig spots first (the X takes one by a sight), open spots after that
    const reserved = this.digSpots(z);
    const take = (clear: number, rMin?: number, rMax?: number) => {
      const r = reserved.shift();
      return r ? r : (() => {
        const p = this.spot(z, clear, rMin, rMax);
        return p ? { p, near: undefined as string | undefined } : null;
      })();
    };
    // the X (hidden until a map shows it): a relic of this region, else a schematic
    {
      const at = take(3, 0.35, 0.9);
      if (at) {
        const relic = this.relicPool.shift();
        const bp = relic ? null : this.rollBlueprint(1.4);
        const s = this.addSite('x', at.p, z, relic ? { kind: 'relic', id: relic } : bp ? { kind: 'blueprint', id: bp } : { kind: 'chest', tier: 'gold' });
        if (at.near) s.zoneName = `${z.name}, by the ${at.near}`;
      }
    }
    // suspicious mounds: the very first one of a fresh hunter hides a schematic
    const nMounds = 1 + (rnd.chance(0.4) ? 1 : 0);
    for (let i = 0; i < nMounds; i++) {
      const at = take(3.2);
      if (!at) continue;
      let cache: Cache;
      const first = z.index === 0 && i === 0 && Blueprints.count().found === 0;
      const r = rnd.next();
      const bp = first || r > 0.78 ? this.rollBlueprint(1) : null;
      if (bp) cache = { kind: 'blueprint', id: bp };
      else if (r < 0.45) cache = { kind: 'bones' };
      else cache = { kind: 'chest', tier: z.index >= 3 && rnd.chance(0.4) ? 'silver' : 'wood' };
      this.addSite('mound', at.p, z, cache);
    }
    // glints
    for (let i = 0; i < 2; i++) {
      const at = take(2);
      if (at) this.addSite('glint', at.p, z, rnd.chance(0.2) ? { kind: 'small' } : { kind: 'gold' });
    }
    // a torn map fragment lying in the sand (always one in the first zone)
    if (z.index === 0 || rnd.chance(0.45)) {
      const p = this.spot(z, 2);
      if (p) this.dropMap(p, 0, true);
    }
    // healing: aloe in the open, canteens by the campfires
    const nAloe = this.d.area === 'B' ? 2 + (rnd.chance(0.5) ? 1 : 0) : 1 + (rnd.chance(0.5) ? 1 : 0);
    for (let i = 0; i < nAloe; i++) {
      const p = this.spot(z, 1.6, 0.15, 0.9);
      if (p) this.addAloe(p);
    }
    let cans = 0;
    for (const a of z.anchors) {
      if (a.kind !== 'campfire' || cans >= 2) continue;
      const ang = rnd.next() * Math.PI * 2;
      const x = a.x + Math.cos(ang) * 2.2, zz = a.z + Math.sin(ang) * 2.2;
      this.addCanteen(new THREE.Vector3(x, this.d.ctx.world.groundAt(x, zz), zz), ang);
      cans++;
    }
  }

  private addSite(kind: Site['kind'], p: THREE.Vector3, z: ZoneDef, cache: Cache) {
    const s: Site = { kind, pos: p, zone: z.index, zoneName: z.name, obj: null, cache, need: kind === 'glint' ? 1.3 : kind === 'mound' ? 2.6 : 3.0, progress: 0, revealed: kind !== 'x', done: false, inter: null, glint: rnd.next(), hole: 0 };
    if (s.revealed) this.showSite(s);
    this.sites.push(s);
    return s;
  }

  /** build the site's model and its dig prompt */
  private showSite(s: Site) {
    const seed = Math.floor(rnd.next() * 3);
    const g = s.kind === 'glint' ? geo('glint', () => TM.glintSpot(4)) : s.kind === 'mound' ? geo('mound' + seed, () => TM.digMound(seed + 1)) : geo('xmark', () => TM.xMarker(2));
    const m = mesh(g);
    const o = new THREE.Group();
    o.add(m);
    o.position.copy(s.pos).add(_v.set(0, s.kind === 'mound' ? -0.08 : -0.02, 0));
    o.rotation.y = rnd.next() * Math.PI * 2;
    this.group.add(o);
    s.obj = o;
    const label = s.kind === 'glint' ? 'Hold to dig up the glint' : s.kind === 'mound' ? 'Hold to dig the mound' : 'Hold to dig: X marks the spot';
    s.inter = this.d.inter.add({ pos: s.pos.clone(), radius: s.kind === 'glint' ? 2.4 : 3.2, label, enabled: true, promptY: s.kind === 'x' ? 2.2 : 1.4, use: () => this.startDig(s) });
  }

  // ------------------------------------------------------------------ digging
  private startDig(s: Site) {
    const P = this.d.player;
    if (s.done || this.digging || !P.alive) return;
    if (P.speed > 7) {
      this.d.ctx.toast('TOO FAST TO DIG', '#e0b373', 'Slow down over the spot');
      return;
    }
    this.digging = s;
    this.d.ctx.sfx('sand_spray', s.pos, 0.6, 0.8);
  }

  private stopDig() {
    this.digging = null;
    this.d.player.weapons.dig = null;
  }

  private updateDig(dt: number) {
    const s = this.digging;
    const P = this.d.player;
    if (!s) return;
    const dist = Math.hypot(P.pos.x - s.pos.x, P.pos.z - s.pos.z);
    if (!P.alive || !this.d.input.held('interact') || dist > (s.kind === 'glint' ? 3 : 3.8) || P.speed > 7.5) return this.stopDig();
    // plant the board and dig in front of you
    const bv = P.board.vel;
    const k = Math.exp(-7 * dt);
    bv.x *= k;
    bv.z *= k;
    if (!P.weapons.dig) {
      const fwd = P.rig.root.localToWorld(new THREE.Vector3(0, 0, 0.56));
      fwd.y = this.d.ctx.world.groundAt(fwd.x, fwd.z) - 0.04;
      P.weapons.dig = { at: fwd, t: 0 };
    } else {
      const fwd = P.rig.root.localToWorld(_v.set(0, 0, 0.56));
      P.weapons.dig.at.set(fwd.x, this.d.ctx.world.groundAt(fwd.x, fwd.z) - 0.04, fwd.z);
    }
    s.progress += dt;
    const u = clamp(s.progress / s.need, 0, 1);
    // the heap gives way as you dig
    if (s.obj) {
      s.obj.scale.set(1 + u * 0.12, Math.max(0.12, 1 - u * 0.85), 1 + u * 0.12);
      s.obj.position.y = s.pos.y - (s.kind === 'mound' ? 0.08 : 0.02) - u * 0.12;
    }
    if (rnd.chance(dt * 6)) this.d.ctx.particles.emit({ pos: { x: s.pos.x, y: s.pos.y + 0.15, z: s.pos.z }, count: 2, spread: 0.8, up: 1.4, life: [0.3, 0.7], size: [0.04, 0.08], sprite: 'dot3', color: [0xf0d29a, 0xe3bd80, 0xd6a968], gravity: 9, ground: true });
    if (u >= 1) this.unearth(s);
  }

  private unearth(s: Site) {
    const ctx = this.d.ctx;
    const P = this.d.player;
    this.stopDig();
    s.done = true;
    if (s.inter) this.d.inter.remove(s.inter);
    s.inter = null;
    const at = { x: s.pos.x, y: s.pos.y + 0.4, z: s.pos.z };
    ctx.events.emit('groundMark', s.pos.x, s.pos.z, 1.3, 0);
    ctx.fx.sandBurst(s.pos, 1.1);
    ctx.sfx('sand_burst', s.pos, 0.8);
    // the marker sinks away into the hole
    if (s.obj) {
      const o = s.obj;
      const y0 = o.position.y;
      ctx.engine.tweens.run(0.6, (k) => (o.position.y = y0 - k * 0.6), Ease.inQuad, { done: () => o.removeFromParent() });
    }
    P.express('smug', 1);
    const c = s.cache;
    switch (c.kind) {
      case 'gold': {
        const n = 4 + Math.floor(rnd.next() * 8);
        this.d.pickups?.drop('gold', 1, at, n);
        ctx.sfx('pickup_gold', s.pos, 0.6);
        if (rnd.chance(0.2)) ctx.engine.tweens.after(0.4, () => this.dropMap(at, 4));
        break;
      }
      case 'small': {
        this.d.pickups?.drop('gold', 1, at, 3 + Math.floor(rnd.next() * 4));
        const item = rnd.pick(['bandage', 'whiskey', 'snakeoil'] as const);
        if (this.d.items?.add(item)) ctx.toast('DUG UP: ' + item.toUpperCase(), '#9dff3a');
        if (rnd.chance(0.25)) ctx.engine.tweens.after(0.4, () => this.dropMap(at, 4));
        break;
      }
      case 'chest': {
        ctx.sfx('sand_rise', s.pos, 0.8);
        const ch = this.d.chest?.(s.pos.x, s.pos.z, c.tier, rnd.next() * 6.28);
        if (ch && ch.root) {
          const r = ch.root;
          const y1 = r.position.y;
          r.position.y = y1 - 0.9;
          ctx.engine.tweens.run(0.9, (k) => (r.position.y = y1 - 0.9 * (1 - k)), Ease.outBack);
          ctx.engine.tweens.after(0.5, () => ctx.sfx('chest_unlock', s.pos, 0.6));
        } else this.d.pickups?.drop('gold', 1, at, 12);
        ctx.toast('BURIED CHEST', '#ffd36b');
        break;
      }
      case 'bones': {
        const bm = mesh(geo('bonecache', () => TM.boneCache(5)));
        bm.position.copy(s.pos).add(_v.set(0, -0.35, 0));
        bm.rotation.y = rnd.next() * 6.28;
        this.group.add(bm);
        ctx.engine.tweens.run(0.8, (k) => (bm.position.y = s.pos.y - 0.35 + k * 0.33), Ease.outCubic);
        ctx.engine.tweens.after(45, () => bm.removeFromParent());
        ctx.sfx('skeleton_rattle', s.pos, 0.6, 0.85);
        this.d.pickups?.drop('gold', 1, at, 8 + Math.floor(rnd.next() * 8));
        ctx.toast("A PROSPECTOR'S BONES", '#e0b373', 'He kept his gold teeth. Not any more.');
        if (rnd.chance(0.35)) ctx.engine.tweens.after(0.6, () => this.dropMap(at, 4));
        else if (rnd.chance(0.25) && this.d.items?.add('goldBandage' as any)) ctx.toast("EMBALMER'S LINEN", '#9dff3a', 'Found on the bones');
        break;
      }
      case 'blueprint': {
        this.raiseCase(s, c.id);
        break;
      }
      case 'relic':
        this.raiseRelic(s, c.id);
        break;
    }
  }

  /** a sealed map case rises, its cap pops and a schematic flies out */
  private raiseCase(s: Site, id: string) {
    const ctx = this.d.ctx;
    const cm = mesh(geo('mapcase', () => TM.mapCase(), 'center'));
    const o = new THREE.Group();
    o.add(cm);
    o.position.set(s.pos.x, s.pos.y - 0.3, s.pos.z);
    o.rotation.z = 0.35;
    this.group.add(o);
    ctx.sfx('sand_rise', s.pos, 0.7);
    ctx.engine.tweens.run(0.7, (k) => {
      o.position.y = s.pos.y - 0.3 + k * 0.55;
      o.rotation.y += 0.08;
    }, Ease.outBack, {
      done: () => {
        ctx.sfx('chest_unlock', o.position, 0.7, 1.3);
        ctx.particles.emit({ pos: o.position, count: 12, spread: 1.4, up: 2.5, life: [0.4, 0.8], size: [0.08, 0.02], sprite: ['spark', 'star4'], additive: true, color: [bpHex(id), 0xffffff], drag: 2 });
        this.dropBlueprint(id, { x: o.position.x, y: o.position.y + 0.3, z: o.position.z }, 5);
        ctx.engine.tweens.after(20, () => o.removeFromParent());
      },
    });
  }

  /** a relic rises out of the X, turns in the light, then flies to the hunter: collection +1 */
  private raiseRelic(s: Site, id: string) {
    const ctx = this.d.ctx;
    const r = RELICS.find((x) => x.id === id);
    if (!r) return;
    const m = mesh(geo('relic_' + r.model, RELIC_MODEL[r.model], 'center'));
    const o = new THREE.Group();
    o.add(m);
    const box = m.geometry.boundingBox!;
    const sz = box.getSize(new THREE.Vector3());
    o.scale.setScalar(Math.min(2.2, 0.45 / Math.max(0.05, sz.x, sz.y, sz.z)));
    o.position.set(s.pos.x, s.pos.y, s.pos.z);
    this.group.add(o);
    ctx.sfx('divine_chime', s.pos, 0.7);
    ctx.sfx('sand_rise', s.pos, 0.6);
    const y0 = s.pos.y;
    ctx.engine.tweens.run(1.6, (k) => {
      o.position.y = y0 + Ease.outCubic(Math.min(1, k * 1.6)) * 1.6;
      o.rotation.y += 0.09;
      if (Math.random() < 0.35) ctx.particles.emit({ pos: o.position, count: 1, spread: 0.6, life: [0.3, 0.5], size: [0.3, 0.05], sprite: 'star4', additive: true, color: 0xffe08a, sizeJitter: 0 });
    }, Ease.linear, {
      done: () => {
        const from = o.position.clone();
        ctx.engine.tweens.run(0.45, (k) => {
          o.position.lerpVectors(from, this.d.player.center(_v), k);
          o.scale.multiplyScalar(0.985);
        }, Ease.inQuad, {
          done: () => {
            o.removeFromParent();
            const paid = Blueprints.addRelic(id);
            const col = this.collection();
            ctx.fx.sparkle(this.d.player.center(_v), 0xffd36b, 18, 0.6);
            ctx.sfx('gold_burst', null, 0.7);
            ctx.sfx('sting_positive', null, 0.5);
            ctx.toast(`RELIC ${col.found} / ${col.total}: ${r.name.toUpperCase()}`, '#ffd36b', paid ? `${REGION_NAMES[r.region]} collection · +${paid} gold to the bank` : 'Already in the collection', true);
            ctx.events.emit('relicFound', id, col.found, col.total);
          },
        });
      },
    });
  }

  // ------------------------------------------------------------------ world drops
  private rollBlueprint(luck = 1) {
    const lying = this.drops.filter((x) => x.kind === 'blueprint').map((x) => x.id);
    const cached = this.sites.filter((s) => !s.done && s.cache.kind === 'blueprint').map((s) => (s.cache as { id: string }).id);
    return Blueprints.roll(() => rnd.next(), { luck: luck * this.d.player.stats.get('rarity'), exclude: [...lying, ...cached] });
  }

  /** a rolled schematic pops out at `at` (arcs out, hovers, glints) */
  dropBlueprint(id: string, at: V, pop = 6) {
    const def = blueprint(id);
    if (!def) return;
    const obj = new THREE.Group();
    const m = mesh(geo('scroll_' + def.kind, () => TM.blueprintScroll(def.kind), 'center'));
    m.scale.setScalar(1.25);
    obj.add(m);
    this.addDrop('blueprint', id, obj, at, pop, false);
    this.d.ctx.sfx('loot_reveal', at, 0.6, 1.1);
  }

  /** a torn map fragment: lying in the sand (world-placed) or popped out of a find */
  dropMap(at: V, pop = 4, lying = false) {
    const obj = new THREE.Group();
    const m = mesh(geo('mapfrag', () => TM.mapFragment(3), 'bottom'));
    m.scale.setScalar(1.3);
    obj.add(m);
    this.addDrop('map', 'map', obj, at, pop, lying);
  }

  private addDrop(kind: Drop['kind'], id: string, obj: THREE.Group, at: V, pop: number, lying: boolean) {
    const a = rnd.next() * Math.PI * 2;
    const ground = this.d.ctx.world.groundAt(at.x, at.z);
    const dd: Drop = { kind, id, obj, pos: new THREE.Vector3(at.x, lying ? ground + 0.02 : at.y, at.z), vel: new THREE.Vector3(Math.sin(a) * pop * 0.3, pop, Math.cos(a) * pop * 0.3), t: rnd.next() * 6, settled: lying, arm: lying ? 0 : 0.8, glint: rnd.next(), ground: lying };
    if (lying) obj.rotation.y = a;
    obj.position.copy(dd.pos);
    this.group.add(obj);
    this.drops.push(dd);
    if (!lying) this.d.ctx.particles.emit({ pos: at, count: 12, spread: 2.5, up: 3, life: [0.4, 0.8], size: [0.1, 0.03], sprite: ['star4', 'spark'], additive: true, color: [kind === 'blueprint' ? bpHex(id) : 0xffe08a, 0xffffff], drag: 2 });
  }

  private updateDrops(dt: number) {
    const ctx = this.d.ctx;
    const P = this.d.player;
    for (const dd of [...this.drops]) {
      dd.t += dt;
      dd.arm -= dt;
      const g = ctx.world.groundAt(dd.pos.x, dd.pos.z);
      if (dd.ground) {
        // a scrap lying in the sand: the wind lifts its corner now and then
        dd.obj.rotation.z = Math.max(0, Math.sin(dd.t * 1.7)) * 0.08;
        dd.pos.y = g + 0.02;
      } else {
        const hover = g + 0.85;
        if (!dd.settled) {
          dd.vel.y -= 15 * dt;
          dd.pos.addScaledVector(dd.vel, dt);
          dd.obj.rotation.x += dt * 5;
          if (dd.vel.y < 0 && dd.pos.y <= hover) {
            dd.settled = true;
            ctx.fx.dust({ x: dd.pos.x, y: g, z: dd.pos.z }, 0.4, 0xe6cf9f, 2);
          }
        } else {
          dd.pos.y += (hover + Math.sin(dd.t * 2.1) * 0.1 - dd.pos.y) * Math.min(1, dt * 6);
          dd.obj.rotation.x *= 1 - Math.min(1, dt * 5);
          dd.obj.rotation.z = Math.sin(dd.t * 1.2) * 0.15;
        }
        dd.obj.rotation.y += dt * 1.1;
      }
      dd.obj.position.copy(dd.pos);
      dd.glint -= dt;
      if (dd.glint <= 0) {
        dd.glint = dd.ground ? 1.6 + rnd.next() : 0.5 + rnd.next() * 0.6;
        const col = dd.kind === 'blueprint' ? bpHex(dd.id) : 0xffe8a8;
        ctx.particles.emit({ pos: { x: dd.pos.x + (rnd.next() - 0.5) * 0.4, y: dd.pos.y + 0.15, z: dd.pos.z + (rnd.next() - 0.5) * 0.4 }, count: 1, life: [0.35, 0.45], size: [0.42, 0.06], sprite: 'star4', additive: true, color: 0xffffff, sizeJitter: 0 });
        if (!dd.ground) ctx.particles.emit({ pos: dd.pos, count: 1, life: [0.4, 0.4], size: [1.0, 1.2], sprite: 'glow16', additive: true, color: col, alpha: 0.2, sizeJitter: 0 });
      }
      // ride through it
      if (dd.arm <= 0 && P.alive && !ctx.engine.paused && !this.reveal.active && Math.hypot(P.pos.x - dd.pos.x, P.pos.z - dd.pos.z) < (dd.ground ? 1.6 : 1.9) && Math.abs(P.pos.y + 0.8 - dd.pos.y) < 2.6) {
        this.drops = this.drops.filter((x) => x !== dd);
        dd.obj.removeFromParent();
        if (dd.kind === 'blueprint') this.collectBlueprint(dd.id, dd.pos);
        else this.collectMap(dd.pos);
        break;
      }
    }
  }

  private collectBlueprint(id: string, at: THREE.Vector3) {
    const ctx = this.d.ctx;
    if (!Blueprints.learn(id)) {
      // already known (learned elsewhere): the paper is worth something to a collector
      this.d.pickups?.drop('gold', 1, at, 6);
      ctx.toast('A COPY YOU ALREADY HAVE', '#e0b373', 'Sold for scrap paper');
      return;
    }
    void this.reveal.show(id, at).then(() => this.d.player.weapons.onLearn(id));
    ctx.events.emit('blueprintFound', id);
  }

  /** a map fragment shows the nearest hidden X */
  private collectMap(at: THREE.Vector3) {
    const ctx = this.d.ctx;
    ctx.sfx('paper_flutter', at, 0.8);
    const active = (ctx.world as unknown as { activeZone?: number }).activeZone ?? 99;
    const hidden = this.sites.filter((s) => s.kind === 'x' && !s.revealed && !s.done);
    hidden.sort((a, b) => (a.zone <= active + 1 ? 0 : 1000) + a.pos.distanceTo(at) - ((b.zone <= active + 1 ? 0 : 1000) + b.pos.distanceTo(at)));
    const s = hidden[0];
    if (!s) {
      this.d.pickups?.drop('gold', 1, at, 5);
      ctx.toast('AN OLD MAP', '#e0b373', 'Every X on it is already dug up');
      return;
    }
    s.revealed = true;
    this.showSite(s);
    ctx.sfx('sting_positive', null, 0.5);
    ctx.sfx('page_turn', null, 0.6);
    ctx.toast('TREASURE MAP', '#ffd36b', `X marks the spot in ${s.zoneName}`, true);
    ctx.events.emit('treasureMap', s.pos.clone());
  }

  // ------------------------------------------------------------------ healing
  private addAloe(p: THREE.Vector3) {
    const seed = Math.floor(rnd.next() * 2);
    const m = mesh(geo('aloe' + seed, () => TM.aloe(seed + 1, false)));
    m.position.copy(p);
    m.rotation.y = rnd.next() * 6.28;
    this.group.add(m);
    const h: Healer = {
      kind: 'aloe',
      pos: p,
      mesh: m,
      regrow: 0,
      seed,
      inter: this.d.inter.add({ pos: p.clone(), radius: 2.6, label: 'Cut aloe  +20 HP, draws out poison', enabled: true, promptY: 1.0, use: () => this.useAloe(h) }),
    };
    this.healers.push(h);
  }

  private useAloe(h: Healer) {
    const ctx = this.d.ctx;
    const P = this.d.player;
    if (h.regrow > 0 || !P.alive) return;
    const healed = P.heal(20);
    P.status.clear('poison');
    h.regrow = 75;
    h.inter.enabled = false;
    h.mesh.geometry = geo('aloe_cut' + h.seed, () => TM.aloe(h.seed + 1, true));
    ctx.sfx('bandage', h.pos, 0.7, 1.2);
    ctx.sfx('heal', P.pos, 0.6);
    ctx.particles.emit({ pos: { x: h.pos.x, y: h.pos.y + 0.4, z: h.pos.z }, count: 14, spread: 1.4, up: 2, life: [0.4, 0.8], size: [0.06, 0.03], sprite: 'dot3', color: [0xd8f0b8, 0x9ad070, 0xe8f8d0], gravity: 8 });
    ctx.particles.emit({ pos: P.center(_v), count: 8, spread: 0.8, up: 1.2, life: [0.5, 0.9], size: [0.12, 0.04], sprite: ['star4', 'dot3'], additive: true, color: [0x9dff3a, 0xd8ffb0], drag: 2 });
    ctx.toast('ALOE', '#9dff3a', healed > 0.5 ? `+${Math.round(healed)} HP · poison drawn out` : 'Poison drawn out');
  }

  private addCanteen(p: THREE.Vector3, rot: number) {
    const m = mesh(geo('canteen', () => TM.canteen()));
    m.position.copy(p);
    m.rotation.y = rot;
    this.group.add(m);
    const h: Healer = {
      kind: 'canteen',
      pos: p,
      mesh: m,
      regrow: 0,
      seed: 0,
      inter: this.d.inter.add({ pos: p.clone(), radius: 2.6, label: 'Drink from the canteen  +35% HP', enabled: true, promptY: 1.1, use: () => this.useCanteen(h) }),
    };
    this.healers.push(h);
  }

  private useCanteen(h: Healer) {
    const ctx = this.d.ctx;
    const P = this.d.player;
    if (h.regrow > 0 || !P.alive || P.action) return;
    h.regrow = 1e9; // one long drink per canteen per run
    h.inter.enabled = false;
    P.playAction('drink', 1.1);
    ctx.sfx('heal', P.pos, 0.5, 0.9);
    this.drinkT = 1.1;
    // healed over the gulps
    const total = P.maxHp * 0.35;
    for (let i = 0; i < 4; i++)
      ctx.engine.tweens.after(0.3 + i * 0.16, () => {
        P.heal(total / 4);
        ctx.particles.emit({ pos: P.center(_v), count: 3, spread: 0.5, up: 1, life: [0.4, 0.7], size: [0.1, 0.04], sprite: ['dot3', 'star4'], additive: true, color: [0x9fe6f0, 0x9dff3a], drag: 2 });
      });
    ctx.engine.tweens.after(1.0, () => ctx.toast('CANTEEN', '#9fe6f0', `+${Math.round(total)} HP · the canteen is dry`));
    // the empty canteen sways on its stick
    const m = h.mesh;
    ctx.engine.tweens.run(1.4, (k) => (m.rotation.z = Math.sin(k * 14) * 0.08 * (1 - k)), Ease.linear);
  }

  private updateHealers(dt: number) {
    for (const h of this.healers) {
      if (h.kind !== 'aloe' || h.regrow <= 0) continue;
      h.regrow -= dt;
      if (h.regrow <= 0) {
        h.mesh.geometry = geo('aloe' + h.seed, () => TM.aloe(h.seed + 1, false));
        h.inter.enabled = true;
      }
    }
  }

  // ------------------------------------------------------------------ frame
  /** call every frame before RunScene's modal early return (dt = game time, rdt = real time) */
  update(dt: number, rdt = dt) {
    this.reveal.update(rdt);
    if (dt <= 0) return;
    this.t += dt;
    this.drinkT = Math.max(0, this.drinkT - dt);
    this.updateDig(dt);
    this.updateDrops(dt);
    this.updateHealers(dt);
    const ctx = this.d.ctx;
    const P = this.d.player;
    for (const s of this.sites) {
      if (s.done || !s.revealed) continue;
      s.glint -= dt;
      if (s.glint > 0) continue;
      const far = Math.hypot(P.pos.x - s.pos.x, P.pos.z - s.pos.z);
      if (s.kind === 'x') {
        // a column of golden motes over the X, visible from far off
        s.glint = 0.12;
        if (far < 140) {
          const h = rnd.next() * 10;
          ctx.particles.emit({ pos: { x: s.pos.x + (rnd.next() - 0.5) * 0.7, y: s.pos.y + 0.5 + h, z: s.pos.z + (rnd.next() - 0.5) * 0.7 }, count: 1, vel: { x: 0, y: 1.4, z: 0 }, life: [0.9, 1.4], size: [0.16 + Math.min(0.3, far * 0.004), 0.04], sprite: 'star4', additive: true, color: [0xffe08a, 0xffd36b], sizeJitter: 0.2 });
          if (rnd.chance(0.3)) ctx.particles.emit({ pos: { x: s.pos.x, y: s.pos.y + 0.6, z: s.pos.z }, count: 1, life: [0.4, 0.4], size: [1.6, 1.8], sprite: 'glow16', additive: true, color: 0xffd36b, alpha: 0.14, sizeJitter: 0 });
        }
      } else if (s.kind === 'glint') {
        // the sun catches something in the sand
        s.glint = 1.1 + rnd.next() * 1.4;
        if (far < 70) ctx.particles.emit({ pos: { x: s.pos.x + (rnd.next() - 0.5) * 0.3, y: s.pos.y + 0.12, z: s.pos.z + (rnd.next() - 0.5) * 0.3 }, count: 1, life: [0.4, 0.5], size: [0.6, 0.08], sprite: 'star4', additive: true, color: 0xffffff, sizeJitter: 0 });
      } else {
        // a mound: grit trickles off its flanks in the wind
        s.glint = 1.8 + rnd.next() * 2;
        if (far < 50) ctx.particles.emit({ pos: { x: s.pos.x + (rnd.next() - 0.5) * 1.6, y: s.pos.y + 0.5, z: s.pos.z + (rnd.next() - 0.5) * 1.6 }, count: 3, spread: 0.4, vel: { x: 0.6, y: 0.2, z: 0.3 }, life: [0.5, 0.9], size: [0.03, 0.05], sprite: 'dot3', color: [0xf0d29a, 0xe3bd80], gravity: 4, ground: true });
      }
    }
  }

  dispose() {
    for (const o of this.offs) o();
    this.reveal.dispose();
    this.group.removeFromParent();
    if (this.digging) this.stopDig();
    for (const s of this.sites) if (s.inter) this.d.inter.remove(s.inter);
    for (const h of this.healers) this.d.inter.remove(h.inter);
  }
}
