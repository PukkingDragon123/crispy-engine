// Rank-up: physical upgrade cards burst out of the sand in front of Sundown,
// spin into a hovering row; hover tilts them toward the cursor, right-drag
// turns a card over to inspect its ledger, click (or 1–4) claims one; it flies
// into the hero and the rest sink back into the dunes. R rerolls, B banishes.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Offer, UpgradeManager } from '../run/Upgrades';
import { RARITY } from '../run/Upgrades';
import { canvasTex, paintCardBack, paintCardFront } from './CardArt';
import { Ease } from '../../engine/Tween';
import type { Input } from '../../engine/Input';
import { damp } from '../../engine/math/rand';

interface Card {
  offer: Offer;
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  hover: number;
  flip: number; // target flip (0 front, PI back)
  flipCur: number;
  tiltX: number;
  tiltY: number;
  ready: boolean;
}

export class CardPicker {
  active = false;
  cards: Card[] = [];
  group = new THREE.Group();
  private ray = new THREE.Raycaster();
  private hovered: Card | null = null;
  private dragging: Card | null = null;
  private dragX = 0;
  private resolve: ((o: Offer | null) => void) | null = null;
  private hint: HTMLDivElement;
  private queue = 0;
  private busy = false;

  constructor(private ctx: Ctx, private up: UpgradeManager, private input: Input, private getHero: () => THREE.Vector3) {
    ctx.scene.add(this.group);
    this.hint = document.createElement('div');
    this.hint.style.cssText = "position:absolute;left:50%;bottom:9vh;transform:translateX(-50%);font-family:'Alagard';font-size:17px;color:#fff3d6;text-shadow:0 2px 0 #2a1810;z-index:7;pointer-events:none;display:none;letter-spacing:1px";
    this.hint.textContent = 'CLICK a card to claim · RIGHT-DRAG to inspect · R reroll · B banish';
    ctx.engine.overlay.appendChild(this.hint);
  }

  /** queue a pick (multiple rank-ups) */
  request() {
    this.queue++;
    if (!this.busy) this.next();
  }

  private async next() {
    if (this.queue <= 0) {
      this.busy = false;
      return;
    }
    this.queue--;
    this.busy = true;
    const n = this.ctx.run && (this.up as any).stats?.get?.('luck') >= 10 ? 4 : 3;
    const offers = this.up.roll(n);
    if (!offers.length) {
      this.busy = false;
      return;
    }
    const picked = await this.show(offers);
    if (picked) {
      const lv = this.up.apply(picked.def.id);
      this.ctx.toast(picked.def.name.toUpperCase(), RARITY[picked.def.rarity].color, lv > 1 ? `Level ${lv}` : picked.def.cat === 'evolution' ? 'EVOLVED!' : 'Acquired');
      this.ctx.events.emit('upgradePicked', picked.def.id, lv);
    }
    this.next();
  }

  private show(offers: Offer[]): Promise<Offer | null> {
    const ctx = this.ctx;
    const eng = ctx.engine;
    this.active = true;
    eng.paused = true;
    eng.audio.setMuffle(0.5);
    eng.input.setWantLock(false);
    this.hint.style.display = 'block';
    const cam = ctx.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const center = cam.position.clone().addScaledVector(fwd, 2.05).addScaledVector(up, -0.02);
    const spacing = offers.length > 3 ? 0.78 : 0.95;
    this.cards = offers.map((o, i) => {
      const front = canvasTex(paintCardFront(o));
      const back = canvasTex(paintCardBack(o, this.up.preview(o)));
      const edge = new THREE.MeshBasicMaterial({ color: RARITY[o.def.rarity].hex, toneMapped: false });
      const face = (t: THREE.Texture) => new THREE.MeshBasicMaterial({ map: t, toneMapped: false, transparent: true, depthTest: false, depthWrite: false, fog: false });
      edge.transparent = true;
      edge.depthTest = false;
      edge.depthWrite = false;
      const mats = [edge, edge, edge, edge, face(front), face(back)];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.08, 0.02), mats);
      mesh.renderOrder = 999;
      mesh.castShadow = true;
      const home = center.clone().addScaledVector(right, (i - (offers.length - 1) / 2) * spacing);
      // erupt from the sand below the home spot
      const start = home.clone().addScaledVector(fwd, 0.6);
      start.y = Math.min(home.y - 1.6, ctx.world.groundAt(start.x, start.z) - 0.2);
      mesh.position.copy(start);
      mesh.quaternion.copy(cam.quaternion);
      this.group.add(mesh);
      const card: Card = { offer: o, mesh, home, hover: 0, flip: 0, flipCur: Math.PI * 4, tiltX: 0, tiltY: 0, ready: false };
      const delay = 0.12 + i * 0.16;
      eng.tweens.after(delay, () => {
        ctx.fx.sandBurst({ x: start.x, y: start.y + 0.6, z: start.z }, 1.3);
        ctx.sfx('card_erupt', start, 0.8, 0.95 + i * 0.05);
        if (o.def.rarity === 'legendary' || o.def.rarity === 'mythic') {
          ctx.sfx('loot_reveal', start, 0.8);
          ctx.fx.sparkle({ x: start.x, y: start.y + 1, z: start.z }, RARITY[o.def.rarity].hex, 14, 0.6);
        }
      }, true);
      eng.tweens.run(0.85, (k) => {
        mesh.position.lerpVectors(start, home, k);
        mesh.position.y += Math.sin(k * Math.PI) * 0.6;
        card.flipCur = Math.PI * 4 * (1 - k);
      }, Ease.outBack, { real: true, delay, done: () => (card.ready = true) });
      return card;
    });
    return new Promise((res) => (this.resolve = res));
  }

  private pick(card: Card | null) {
    if (!this.resolve) return;
    const ctx = this.ctx;
    const eng = ctx.engine;
    const res = this.resolve;
    this.resolve = null;
    this.hint.style.display = 'none';
    const hero = this.getHero().clone().add(new THREE.Vector3(0, 1.1, 0));
    for (const c of this.cards) {
      const m = c.mesh;
      if (c === card) {
        ctx.sfx('card_pick', m.position, 0.9);
        const from = m.position.clone();
        eng.tweens.run(0.45, (k) => {
          m.position.lerpVectors(from, hero, k);
          m.scale.setScalar(1 - k * 0.85);
          m.rotateY(0.4);
        }, Ease.inQuad, {
          real: true,
          done: () => {
            ctx.fx.sandBurst(hero, 0.8);
            ctx.fx.sparkle(hero, RARITY[c.offer.def.rarity].hex, 16, 0.5);
            this.group.remove(m);
          },
        });
      } else {
        const from = m.position.clone();
        const to = from.clone().add(new THREE.Vector3(0, -2.5, 0));
        eng.tweens.run(0.5, (k) => {
          m.position.lerpVectors(from, to, k);
          m.rotateZ(0.05);
        }, Ease.inBack, { real: true, done: () => this.group.remove(m) });
        ctx.fx.dust(from, 0.5, 0xe6cf9f, 2);
      }
    }
    eng.tweens.after(0.5, () => {
      this.active = false;
      eng.paused = false;
      eng.audio.setMuffle(0);
      eng.input.setWantLock(true);
      this.cards = [];
      res(card?.offer ?? null);
    }, true);
  }

  update(rdt: number) {
    if (!this.active) return;
    const inp = this.input;
    const cam = this.ctx.camera;
    // keyboard picks
    for (let i = 0; i < this.cards.length; i++) if (inp.wasPressed('Digit' + (i + 1)) && this.cards.every((c) => c.ready)) return this.pick(this.cards[i]);
    if (inp.wasPressed('KeyR') && this.up.rerolls > 0 && this.resolve && this.cards.every((c) => c.ready)) {
      this.up.rerolls--;
      this.ctx.toast('REROLL', '#c9a97c', `${this.up.rerolls} left`);
      const res = this.resolve;
      this.resolve = null;
      for (const c of this.cards) this.group.remove(c.mesh);
      this.show(this.up.roll(this.cards.length)).then((o) => res(o));
      return;
    }
    // raycast hover
    this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), cam);
    const hits = this.ray.intersectObjects(this.cards.map((c) => c.mesh), false);
    const h = hits.length ? this.cards.find((c) => c.mesh === hits[0].object) ?? null : null;
    if (h !== this.hovered) {
      if (h) this.ctx.sfx('card_hover', null, 0.5);
      this.hovered = h;
    }
    if (inp.wasPressed('KeyB') && this.hovered && this.resolve) {
      this.up.banished.add(this.hovered.offer.def.id);
      this.ctx.toast('BANISHED', '#ff8a6a', this.hovered.offer.def.name);
    }
    if (inp.wasPressed('Mouse2') && h) {
      this.dragging = h;
      this.dragX = inp.mouseX;
      h.flip = h.flip > Math.PI / 2 ? 0 : Math.PI;
      this.ctx.sfx('card_flip', null, 0.6);
    }
    if (!inp.isDown('Mouse2')) this.dragging = null;
    if (this.dragging) {
      const dx = inp.mouseX - this.dragX;
      this.dragging.flipCur += dx * 0.012;
      this.dragging.flip = this.dragging.flipCur;
      this.dragX = inp.mouseX;
    }
    if (inp.wasPressed('Mouse0') && h && h.ready) return this.pick(h);
    // animate
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    for (const c of this.cards) {
      if (!c.ready) {
        c.mesh.quaternion.copy(cam.quaternion);
        c.mesh.rotateY(c.flipCur);
        continue;
      }
      c.hover = damp(c.hover, c === this.hovered ? 1 : 0, 12, rdt);
      if (!this.dragging || this.dragging !== c) c.flipCur = damp(c.flipCur, c.flip, 9, rdt);
      const local = c === this.hovered && hits.length ? hits[0].point.clone().sub(c.mesh.position) : new THREE.Vector3();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      c.tiltY = damp(c.tiltY, local.dot(right) * 0.5 * c.hover, 10, rdt);
      c.tiltX = damp(c.tiltX, -local.dot(upv) * 0.4 * c.hover, 10, rdt);
      c.mesh.position.copy(c.home).addScaledVector(fwd, -0.35 * c.hover).addScaledVector(upv, 0.08 * c.hover + Math.sin(performance.now() / 600 + c.home.x) * 0.015);
      c.mesh.quaternion.copy(cam.quaternion);
      c.mesh.rotateY(c.flipCur + c.tiltY);
      c.mesh.rotateX(c.tiltX);
      const s = 1 + c.hover * 0.08;
      c.mesh.scale.setScalar(s);
    }
  }
}
