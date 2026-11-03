// The Burrow Exchange: the meerkats' swap counter. Offers lie on the stall's
// crate counter as real 3D item models (what you give in front, the prize
// behind it), the camera leans in over the counter, hover lifts an offer (tag
// + tooltip), click swaps. Tier-ups trade one consumable for a better one; the
// two-for-one is the only way to Serket's Charm. Pauses the world while open;
// the colony drives update() and the trader's reactions.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Input } from '../../engine/Input';
import type { CameraRig } from '../player/CameraRig';
import { ITEMS, ItemId } from '../player/Items';
import { modelEntry } from '../models/lookup';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { Ease } from '../../engine/Tween';
import { damp } from '../../engine/math/rand';

export interface InventoryLike {
  slots: ({ id: ItemId; count: number } | null)[];
  add(id: ItemId, n?: number): boolean;
}
export interface TradeOffer {
  kind: 'up' | 'twoForOne';
  /** units taken from the inventory: slot index + count */
  give: { slot: number; n: number }[];
  giveIds: ItemId[];
  get: ItemId;
}
export type TradeReaction = 'greet' | 'deal' | 'nope' | 'bye' | 'hover';

// ------------------------------------------------------------------ offers
/** rarity tier used by the colony's swap rules */
export const ITEM_TIER: Record<ItemId, number> = { bandage: 0, snakeoil: 0, whiskey: 0, dagger: 1, smoke: 1, shield: 1, dynamite: 1, goldBandage: 2, charm: 2 };

function canAdd(slots: ({ id: ItemId; count: number } | null)[], id: ItemId) {
  for (const s of slots) if (s && s.id === id && s.count < ITEMS[id].stack) return true;
  return slots.some((s) => !s);
}
function after(slots: ({ id: ItemId; count: number } | null)[], give: { slot: number; n: number }[]) {
  const c = slots.map((s) => (s ? { ...s } : null));
  for (const g of give) {
    const s = c[g.slot];
    if (!s) return null;
    s.count -= g.n;
    if (s.count < 0) return null;
    if (s.count === 0) c[g.slot] = null;
  }
  return c;
}

/** the swaps the colony offers for what the player carries right now (stable for a given rng) */
export function buildOffers(items: InventoryLike, rng: () => number): TradeOffer[] {
  const out: TradeOffer[] = [];
  const seen = new Set<ItemId>();
  items.slots.forEach((s, i) => {
    if (!s || seen.has(s.id)) return;
    seen.add(s.id);
    const t = ITEM_TIER[s.id];
    if (t >= 2) return;
    let get: ItemId;
    if (s.id === 'bandage' || t === 1) get = 'goldBandage';
    else {
      const pool = (Object.keys(ITEM_TIER) as ItemId[]).filter((k) => ITEM_TIER[k] === 1);
      get = pool[Math.floor(rng() * pool.length) % pool.length];
    }
    out.push({ kind: 'up', give: [{ slot: i, n: 1 }], giveIds: [s.id], get });
  });
  // two-for-one: the two cheapest units the player holds -> Serket's Charm
  const units: { slot: number; id: ItemId }[] = [];
  items.slots.forEach((s, i) => {
    if (s && ITEM_TIER[s.id] < 2) for (let n = 0; n < s.count; n++) units.push({ slot: i, id: s.id });
  });
  units.sort((a, b) => ITEM_TIER[a.id] - ITEM_TIER[b.id]);
  if (units.length >= 2) {
    const [a, b] = units;
    const give = a.slot === b.slot ? [{ slot: a.slot, n: 2 }] : [{ slot: a.slot, n: 1 }, { slot: b.slot, n: 1 }];
    out.push({ kind: 'twoForOne', give, giveIds: [a.id, b.id], get: 'charm' });
  }
  return out.filter((o) => {
    const c = after(items.slots, o.give);
    return !!c && canAdd(c, o.get);
  }).slice(0, 3);
}

/** apply a swap to the inventory (all-or-nothing) */
export function applyOffer(items: InventoryLike, o: TradeOffer): boolean {
  const c = after(items.slots, o.give);
  if (!c || !canAdd(c, o.get)) return false;
  items.slots.splice(0, items.slots.length, ...c);
  return items.add(o.get, 1);
}

// ------------------------------------------------------------------ 3D item objects
const geoCache = new Map<string, { geo: THREE.BufferGeometry; r: number } | null>();
/** an item's own 3D model (centred), scaled to the given bounding radius */
export function itemObject3D(id: ItemId, radius: number): THREE.Group {
  const key = ITEMS[id].model;
  let g = geoCache.get(key);
  if (g === undefined) {
    g = null;
    try {
      const r = modelEntry(key)?.() as { model?: any; voxelSize?: number } | undefined;
      if (r?.model) {
        const geo = buildVoxelGeometry(r.model, { voxelSize: r.voxelSize!, pivot: 'center' });
        geo.computeBoundingSphere();
        g = { geo, r: geo.boundingSphere!.radius };
      }
    } catch {
      g = null;
    }
    geoCache.set(key, g);
  }
  const grp = new THREE.Group();
  if (g) {
    const m = new THREE.Mesh(g.geo, sharedVoxelMaterial);
    m.castShadow = true;
    m.receiveShadow = true;
    m.scale.setScalar(radius / Math.max(0.02, g.r));
    grp.add(m);
  }
  return grp;
}

// ------------------------------------------------------------------ the counter UI
interface Slot {
  offer: TradeOffer;
  give: THREE.Group[];
  get: THREE.Group;
  home: THREE.Vector3[];
  getHome: THREE.Vector3;
  hover: number;
  gone: boolean;
}

export interface TradeOpen {
  /** the stall group (its local frame: counter along X, customers on +Z) */
  stall: THREE.Object3D;
  counterTop: number;
  offers: TradeOffer[];
  items: InventoryLike;
  react: (kind: TradeReaction) => void;
  /** recompute offers after a swap */
  refresh: () => TradeOffer[];
  onClose: () => void;
}

const LINES = {
  greet: ['Peep! Shiny things? We swap!', 'Mama Mim sniffs your pockets. Approves.', 'Swap-swap! Better for you, snacks for us.'],
  deal: ['Squee! A fine swap!', 'Mim stuffs it in her cheek pouch. Mostly.', 'The whole colony chirps in approval!', 'Sold to the skeleton in the hat!'],
  nope: ['Mim counts again. Nope.', 'Those pockets are full, bone-friend.'],
  bye: ['Peep peep! Mind the holes!', 'Come back! Bring snacks!', 'The band plays you out.'],
};
const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

export class MeerkatTrade {
  active = false;
  private o: TradeOpen | null = null;
  private group = new THREE.Group();
  private slots: Slot[] = [];
  private hovered: Slot | null = null;
  private tip: HTMLDivElement;
  private bar: HTMLDivElement;
  private t = 0;
  private busy = 0;

  constructor(private ctx: Ctx, private input: Input, private cam: CameraRig) {
    this.tip = document.createElement('div');
    this.tip.style.cssText = "position:absolute;z-index:7;pointer-events:none;display:none;min-width:210px;max-width:290px;padding:10px 14px;background:#e8d4a4;border:3px solid #5a3418;box-shadow:0 4px 0 #2a1408;font-family:'Alagard';color:#2a1a10;font-size:15px;line-height:1.25;image-rendering:pixelated";
    this.bar = document.createElement('div');
    this.bar.style.cssText = "position:absolute;left:50%;bottom:6vh;transform:translateX(-50%);z-index:7;pointer-events:none;display:none;font-family:'Alagard';font-size:20px;color:#fff3d6;text-shadow:0 3px 0 #2a1810,0 0 10px #000;text-align:center";
    ctx.engine.overlay.appendChild(this.tip);
    ctx.engine.overlay.appendChild(this.bar);
  }

  open(o: TradeOpen) {
    const ctx = this.ctx, eng = ctx.engine;
    this.o = o;
    this.active = true;
    eng.paused = true;
    eng.input.setWantLock(false);
    o.stall.add(this.group);
    this.layout(o.offers);
    // camera: lean in over the counter from the customer side
    o.stall.updateWorldMatrix(true, false);
    const c = o.stall.localToWorld(new THREE.Vector3(0, o.counterTop, 0.02));
    const pos = o.stall.localToWorld(new THREE.Vector3(0.12, o.counterTop + 0.44, 1.0));
    const look = o.stall.localToWorld(new THREE.Vector3(0, o.counterTop + 0.07, -0.08));
    this.cam.setCine({ pos, look, fov: 46 }, true);
    void c;
    eng.letterbox(true, 0.4);
    ctx.sfx('merchant_greet', null, 0.5, 1.9);
    ctx.toast('THE BURROW EXCHANGE', '#ffd36b', pick(LINES.greet));
    o.react('greet');
    this.bar.innerHTML = `click a swap &nbsp;·&nbsp; ESC / T to leave`;
    this.bar.style.display = 'block';
  }

  private clearSlots() {
    for (const s of this.slots) {
      for (const g of s.give) g.removeFromParent();
      s.get.removeFromParent();
    }
    this.slots = [];
    this.hovered = null;
  }

  private layout(offers: TradeOffer[]) {
    this.clearSlots();
    const top = this.o!.counterTop;
    const xs = offers.length === 1 ? [0] : offers.length === 2 ? [-0.1, 0.1] : [-0.15, 0, 0.15];
    this.slots = offers.map((offer, i) => {
      const x = xs[i];
      const give: THREE.Group[] = [];
      const home: THREE.Vector3[] = [];
      offer.giveIds.forEach((id, k) => {
        const g = itemObject3D(id, 0.042);
        const h = new THREE.Vector3(x + (offer.giveIds.length > 1 ? (k - 0.5) * 0.07 : 0), top + 0.045, 0.085);
        g.position.copy(h);
        this.group.add(g);
        give.push(g);
        home.push(h);
      });
      const get = itemObject3D(offer.get, 0.058);
      const gh = new THREE.Vector3(x, top + 0.065, -0.05);
      get.position.copy(gh);
      this.group.add(get);
      // a little pop as each offer is laid out
      get.scale.setScalar(0.01);
      this.ctx.engine.tweens.run(0.35, (k) => get.scale.setScalar(Math.max(0.01, k)), Ease.outBack, { real: true, delay: 0.1 + i * 0.12 });
      return { offer, give, get, home, getHome: gh, hover: 0, gone: false };
    });
  }

  close() {
    if (!this.o) return;
    const ctx = this.ctx, eng = ctx.engine;
    const o = this.o;
    this.o = null;
    this.clearSlots();
    this.group.removeFromParent();
    this.tip.style.display = 'none';
    this.bar.style.display = 'none';
    this.cam.setCine(null);
    eng.letterbox(false, 0.4);
    eng.paused = false;
    eng.input.setWantLock(true);
    this.active = false;
    ctx.toast('THE BURROW EXCHANGE', '#ffd36b', pick(LINES.bye));
    o.react('bye');
    o.onClose();
  }

  private swap(s: Slot) {
    const o = this.o!;
    const ctx = this.ctx;
    if (!applyOffer(o.items, s.offer)) {
      ctx.sfx('ui_error', null, 0.8);
      ctx.toast('MAMA MIM', '#ffd36b', pick(LINES.nope));
      o.react('nope');
      return;
    }
    s.gone = true;
    this.busy = 1.1;
    ctx.sfx('scales', null, 0.8);
    ctx.sfx('loot_reveal', null, 0.6, 1.25);
    ctx.toast(ITEMS[s.offer.get].name.toUpperCase(), '#9dff3a', pick(LINES.deal));
    o.react('deal');
    const tw = ctx.engine.tweens;
    // your goods slide across to the trader, the prize hops up to you
    s.give.forEach((g) => {
      const from = g.position.clone();
      tw.run(0.45, (k) => {
        g.position.lerpVectors(from, new THREE.Vector3(from.x * 0.4, from.y + 0.05 * Math.sin(k * Math.PI), -0.3), k);
        g.scale.setScalar(1 - k * 0.6);
      }, Ease.inOutQuad, { real: true, done: () => g.removeFromParent() });
    });
    const from = s.get.position.clone();
    tw.run(0.6, (k) => {
      s.get.position.set(from.x, from.y + Math.sin(k * Math.PI) * 0.22 + k * 0.1, from.z + k * 0.45);
      s.get.rotation.y += 0.25;
      s.get.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.35);
    }, Ease.outQuad, { real: true, delay: 0.25, done: () => s.get.removeFromParent() });
    ctx.engine.tweens.after(1.0, () => {
      if (!this.o) return;
      const next = this.o.refresh();
      if (!next.length) {
        ctx.toast('MAMA MIM', '#ffd36b', 'All swapped out! Peep!');
        this.close();
      } else this.layout(next);
    }, true);
  }

  update(rdt: number) {
    if (!this.active || !this.o) return;
    this.t += rdt;
    this.busy = Math.max(0, this.busy - rdt);
    const inp = this.input;
    if (inp.wasPressed('Escape') || inp.wasPressed('KeyT')) return this.close();
    // pick the offer nearest the cursor on screen
    let best: Slot | null = null, bd = Infinity;
    const wp = new THREE.Vector3();
    const W = this.ctx.engine.width, H = this.ctx.engine.height;
    for (const s of this.slots) {
      if (s.gone) continue;
      s.get.getWorldPosition(wp).project(this.ctx.camera);
      const d = Math.hypot((wp.x * 0.5 + 0.5) * W - inp.mouseX, (-wp.y * 0.5 + 0.5) * H - inp.mouseY);
      if (d < Math.max(70, W * 0.07) && d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best !== this.hovered) {
      if (best) {
        this.ctx.sfx('card_hover', null, 0.5);
        this.o.react('hover');
      }
      this.hovered = best;
    }
    for (const s of this.slots) {
      if (s.gone) continue;
      s.hover = damp(s.hover, s === best ? 1 : 0, 12, rdt);
      s.get.position.set(s.getHome.x, s.getHome.y + s.hover * 0.07 + Math.sin(this.t * 2.2 + s.getHome.x * 9) * 0.006, s.getHome.z);
      s.get.rotation.y += rdt * (0.5 + s.hover * 2.4);
      s.give.forEach((g, k) => {
        g.position.set(s.home[k].x, s.home[k].y + s.hover * 0.03, s.home[k].z);
        g.rotation.y = Math.sin(this.t * 1.3 + k) * 0.3;
      });
    }
    if (best && !best.gone) {
      const of = best.offer;
      const giveNames = of.giveIds.map((id) => ITEMS[id].name);
      const giveTxt = giveNames.length > 1 && giveNames[0] === giveNames[1] ? `2 × ${giveNames[0]}` : giveNames.join(' + ');
      const head = of.kind === 'twoForOne' ? 'Two-for-one!' : 'Tier-up swap';
      this.tip.innerHTML = `<div style="font-size:19px;color:#8a2a18">${head}</div><div style="margin:4px 0 2px">Give: <span style="color:#6a3a14">${giveTxt}</span></div><div style="margin:0 0 6px">Get: <span style="color:#2a6a18">${ITEMS[of.get].name}</span></div><div style="font-size:13px;color:#5a3a1a">${ITEMS[of.get].desc}</div>`;
      this.tip.style.display = 'block';
      this.tip.style.left = `${inp.mouseX + 18}px`;
      this.tip.style.top = `${inp.mouseY - 10}px`;
      if (inp.wasPressed('Mouse0') && this.busy <= 0) this.swap(best);
    } else this.tip.style.display = 'none';
  }

  dispose() {
    if (this.active) this.close();
    this.tip.remove();
    this.bar.remove();
  }
}
