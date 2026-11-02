// The old merchant's rug shop: wares lie on a rug in the world, the camera
// leans in over his shoulder, hover lifts an item (tag + tooltip), click buys.
// Pauses combat while you browse.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Input } from '../../engine/Input';
import type { CameraRig } from '../player/CameraRig';
import * as PM from '../models/props';
import { modelEntry } from '../models/lookup';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { ITEMS, ItemId } from '../player/Items';
import { damp, rnd } from '../../engine/math/rand';
import { Ease } from '../../engine/Tween';

export interface Ware {
  id: string;
  name: string;
  desc: string;
  price: number;
  model: string;
  buy(): boolean; // false = couldn't (e.g. inventory full)
}

interface Slot {
  ware: Ware;
  obj: THREE.Group;
  home: THREE.Vector3;
  hover: number;
  sold: boolean;
  size: number;
}

const LINES = {
  hello: ['Ahh, a customer with no skin! Fewer things to sell you lotion for.', 'Welcome, bone-friend! Everything is cursed only a little.', 'My camel says you have an honest skull.'],
  poor: ['No coin, no camel milk.', 'I accept gold, not rattling.', 'Come back with heavier pockets, friend.'],
  thanks: ['A fine choice! Serket smiles.', 'Sold! No refunds, no curses. Mostly.', 'You have the eye of a falcon. Or a skull.'],
  bye: ['Ride safe! Or don\'t, more customers for Anubis.', 'Go with sand in your boots!'],
};

function itemObject(key: string): { obj: THREE.Group; size: number } {
  const g = new THREE.Group();
  let size = 0.5;
  try {
    const r = modelEntry(key)?.() as any;
    const sm = r?.model ? r : null;
    if (sm) {
      const geo = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: 'center' });
      geo.computeBoundingSphere();
      size = geo.boundingSphere!.radius;
      const m = new THREE.Mesh(geo, sharedVoxelMaterial);
      m.castShadow = true;
      g.add(m);
      const s = 0.17 / Math.max(0.05, size);
      g.scale.setScalar(Math.min(2.5, s));
      return { obj: g, size: 0.17 };
    }
  } catch {
    /* fallback below */
  }
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshStandardMaterial({ color: 0xc9a050 }));
  g.add(m);
  return { obj: g, size: 0.2 };
}

export class Shop {
  active = false;
  private group = new THREE.Group();
  private rug: THREE.Object3D | null = null;
  private slots: Slot[] = [];
  private ray = new THREE.Raycaster();
  private hovered: Slot | null = null;
  private tip: HTMLDivElement;
  private bar: HTMLDivElement;
  private done: (() => void) | null = null;
  private t = 0;

  constructor(private ctx: Ctx, private input: Input, private cam: CameraRig) {
    ctx.scene.add(this.group);
    this.tip = document.createElement('div');
    this.tip.style.cssText = "position:absolute;z-index:7;pointer-events:none;display:none;min-width:200px;max-width:280px;padding:10px 14px;background:#e8d4a4;border:3px solid #5a3418;box-shadow:0 4px 0 #2a1408;font-family:'Alagard';color:#2a1a10;font-size:15px;line-height:1.25;image-rendering:pixelated";
    this.bar = document.createElement('div');
    this.bar.style.cssText = "position:absolute;left:50%;bottom:6vh;transform:translateX(-50%);z-index:7;pointer-events:none;display:none;font-family:'Alagard';font-size:20px;color:#fff3d6;text-shadow:0 3px 0 #2a1810,0 0 10px #000;text-align:center";
    ctx.engine.overlay.appendChild(this.tip);
    ctx.engine.overlay.appendChild(this.bar);
  }

  /** open at a rug position in front of the merchant; resolves when the player leaves */
  open(rugAt: THREE.Vector3, facing: number, wares: Ware[], merchantPos: THREE.Vector3): Promise<void> {
    const ctx = this.ctx;
    const eng = ctx.engine;
    this.active = true;
    eng.paused = true;
    eng.input.setWantLock(false);
    ctx.sfx('merchant_greet', merchantPos, 1);
    ctx.toast('THE MERCHANT', '#ffd36b', rnd.pick(LINES.hello));
    const g = ctx.world.groundAt(rugAt.x, rugAt.z);
    this.group.position.set(rugAt.x, g + 0.02, rugAt.z);
    this.group.rotation.y = facing;
    // rug
    if (!this.rug) {
      try {
        const r = (PM as any).rug?.(1) as { model: any; voxelSize: number } | undefined;
        if (r?.model) {
          const m = new THREE.Mesh(buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: 'bottom' }), sharedVoxelMaterial);
          m.receiveShadow = true;
          this.rug = m;
        }
      } catch {
        /* fallback */
      }
      if (!this.rug) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.04, 1.7), new THREE.MeshStandardMaterial({ color: 0xa83a2a }));
        m.position.y = 0.02;
        this.rug = m;
      }
    }
    this.group.add(this.rug);
    // wares in a row on the rug
    this.slots = wares.map((w, i) => {
      const { obj, size } = itemObject(w.model);
      const home = new THREE.Vector3((i - (wares.length - 1) / 2) * 0.5, 0.25, (i % 2) * 0.18 - 0.05);
      obj.position.copy(home);
      this.group.add(obj);
      return { ware: w, obj, home, hover: 0, sold: false, size };
    });
    // camera: over the merchant's rug, looking down at the wares
    const fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    const center = new THREE.Vector3(rugAt.x, g + 0.25, rugAt.z);
    const camPos = center.clone().addScaledVector(fwd, -1.9).add(new THREE.Vector3(0, 1.45, 0));
    this.cam.setCine({ pos: camPos, look: center.clone().addScaledVector(fwd, 0.15), fov: 52 }, true);
    eng.letterbox(true, 0.4);
    this.updateBar();
    this.bar.style.display = 'block';
    return new Promise((res) => (this.done = res));
  }

  private updateBar() {
    this.bar.innerHTML = `<span style="color:#ffd36b">${Math.floor(this.ctx.run.gold)} gold</span> &nbsp;·&nbsp; click to buy &nbsp;·&nbsp; ESC / T to leave`;
  }

  dispose() {
    this.tip.remove();
    this.bar.remove();
  }

  close() {
    if (!this.active) return;
    const ctx = this.ctx;
    const eng = ctx.engine;
    ctx.toast('THE MERCHANT', '#ffd36b', rnd.pick(LINES.bye));
    for (const s of this.slots) this.group.remove(s.obj);
    if (this.rug) this.group.remove(this.rug);
    this.slots = [];
    this.tip.style.display = 'none';
    this.bar.style.display = 'none';
    this.cam.setCine(null);
    eng.letterbox(false, 0.4);
    eng.paused = false;
    eng.input.setWantLock(true);
    this.active = false;
    const d = this.done;
    this.done = null;
    d?.();
  }

  private buy(s: Slot) {
    const ctx = this.ctx;
    if (s.sold) return;
    if (ctx.run.gold < s.ware.price) {
      ctx.sfx('ui_error', null, 0.8);
      ctx.toast('THE MERCHANT', '#ffd36b', rnd.pick(LINES.poor));
      ctx.engine.tweens.run(0.3, (k) => (s.obj.rotation.z = Math.sin(k * 30) * 0.2 * (1 - k)), Ease.linear, { real: true });
      return;
    }
    if (!s.ware.buy()) {
      ctx.sfx('ui_error', null, 0.8);
      ctx.toast('POCKETS FULL', '#ff8a6a', 'Use or drop a consumable first');
      return;
    }
    ctx.run.gold -= s.ware.price;
    s.sold = true;
    ctx.sfx('gold_burst', null, 0.8);
    ctx.sfx('pickup_gold', null, 0.7);
    ctx.toast(s.ware.name.toUpperCase(), '#9dff3a', rnd.pick(LINES.thanks));
    const from = s.obj.position.clone();
    ctx.engine.tweens.run(0.4, (k) => {
      s.obj.position.lerpVectors(from, from.clone().add(new THREE.Vector3(0, 1.2, -0.6)), k);
      s.obj.scale.multiplyScalar(0.94);
    }, Ease.inQuad, { real: true, done: () => this.group.remove(s.obj) });
    this.updateBar();
  }

  update(rdt: number) {
    if (!this.active) return;
    this.t += rdt;
    const inp = this.input;
    if (inp.wasPressed('Escape') || inp.wasPressed('KeyT')) return this.close();
    // pick the ware nearest the cursor on screen
    let best: Slot | null = null, bd = Infinity;
    const wp = new THREE.Vector3();
    const W = this.ctx.engine.width, H = this.ctx.engine.height;
    for (const s of this.slots) {
      if (s.sold) continue;
      s.obj.getWorldPosition(wp).project(this.ctx.camera);
      const d = Math.hypot((wp.x * 0.5 + 0.5) * W - inp.mouseX, (-wp.y * 0.5 + 0.5) * H - inp.mouseY);
      if (d < Math.max(50, W * 0.05) && d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best !== this.hovered) {
      if (best) this.ctx.sfx('card_hover', null, 0.5);
      this.hovered = best;
    }
    for (const s of this.slots) {
      if (s.sold) continue;
      s.hover = damp(s.hover, s === best ? 1 : 0, 12, rdt);
      s.obj.position.set(s.home.x, s.home.y + s.hover * 0.22 + Math.sin(this.t * 2 + s.home.x * 5) * 0.02, s.home.z);
      s.obj.rotation.y += rdt * (0.6 + s.hover * 2.5);
    }
    if (best) {
      const w = best.ware;
      const afford = this.ctx.run.gold >= w.price;
      this.tip.innerHTML = `<div style="font-size:20px;color:#8a2a18">${w.name}</div><div style="margin:4px 0 6px">${w.desc}</div><div style="color:${afford ? '#7a5a10' : '#a02a1a'}">${w.price} gold</div>`;
      this.tip.style.display = 'block';
      this.tip.style.left = `${inp.mouseX + 18}px`;
      this.tip.style.top = `${inp.mouseY - 10}px`;
      if (inp.wasPressed('Mouse0')) this.buy(best);
    } else this.tip.style.display = 'none';
  }
}

/** standard stock for the trading post */
export function merchantStock(ctx: Ctx, add: (id: ItemId) => boolean, heal: () => void, card: () => void): Ware[] {
  const w = ctx.run.wave;
  const scale = 1 + w * 0.03;
  const pool = (Object.keys(ITEMS) as ItemId[]).filter((id) => id !== 'charm' || w > 10);
  const picks: ItemId[] = [];
  while (picks.length < 3) {
    const id = rnd.pick(pool);
    if (!picks.includes(id)) picks.push(id);
  }
  const wares: Ware[] = picks.map((id) => ({ id, name: ITEMS[id].name, desc: ITEMS[id].desc, price: Math.round(ITEMS[id].price * scale), model: ITEMS[id].model, buy: () => add(id) }));
  wares.push({ id: 'heal', name: 'Camel-Milk Tonic', desc: 'Drink it all. Heals to full. Tastes like regret.', price: Math.round(45 * scale), model: 'bottle', buy: () => (heal(), true) });
  wares.push({ id: 'card', name: 'Fortune Card', desc: 'A sealed upgrade card from the merchant\'s deck. Pick 1 of 3.', price: Math.round(90 * scale), model: 'book', buy: () => (card(), true) });
  return wares;
}
