// The worn-gear rack in the run HUD: little riveted bronze sockets beside the
// consumable slots (above the health bar), one per gear slot, each showing the
// slot's pixel icon (hat, vest, glove, boot, tool, charm, booster, wings, blades) lit
// when a piece is worn there, and a cut gem in that piece's rarity colour. Authored
// pixel sprites (HudArt.ts) painted into the HUD canvas (Hud.painters) on its pixel
// grid; it follows the HUD's own anchors, so it slides away with the rest of the HUD.
import * as THREE from 'three';
import type { Hud, HudPainter } from './Hud';
import { Equipment, GEAR_SLOTS, GearId, GearSlot, gearHex } from '../player/Equipment';
import { blitC, blitObj, glint } from './HudSprites';
import { sprite, SWAP_DIM, SWAP_FLASH } from './PixelUI';
import { HUD_ART as ART } from './HudArt';

const PW = 16, PH = 18; // socket size in HUD pixels (1 voxel = 1 HUD pixel)

interface Slot {
  slot: GearSlot;
  id: GearId | null;
  pop: number;
}

/** a rarity colour as a gem palette swap (the authored gem is 'a' shade, 'b' body, 'c' glint) */
function gemSwap(hex: number) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const h = (v: number[]) => '#' + v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  return { a: h([r * 0.55, g * 0.55, b * 0.55]), b: h([r, g, b]), c: h([r + (255 - r) * 0.6, g + (255 - g) * 0.6, b + (255 - b) * 0.6]) };
}

export class GearHud implements HudPainter {
  private slots: Slot[] = [];
  private t = 0;

  constructor(scene: THREE.Scene, private hud: Hud, private eq: Equipment) {
    GEAR_SLOTS.forEach((slot) => this.slots.push({ slot, id: null, pop: 0 }));
    hud.painters.push(this);
    void scene;
  }

  /** RunScene still ticks it; the rack itself is painted with the HUD (paint) */
  update(dt: number) {
    void dt;
  }

  paint(c: CanvasRenderingContext2D, dt: number) {
    this.t += dt;
    const hud = this.hud;
    const A = hud.anchors;
    if (!hud.visible || A.slide >= 0.98) return;
    // sit right of the consumable slots (or above the heart if there are none)
    const last = A.items[A.items.length - 1];
    const x0 = last ? last.x + last.size / 2 + 6 + PW / 2 : A.heart.x + 30;
    const y0 = last ? last.y : A.heart.y - 23;
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i];
      const id = this.eq.get(sl.slot);
      if (id !== sl.id) {
        sl.pop = sl.id === null && id === null ? 0 : 1;
        sl.id = id;
      }
      sl.pop = Math.max(0, sl.pop - dt * 2.5);
      const cx = x0 + i * (PW + 2), cy = y0 + Math.round(Math.sin(this.t * 1.7 + i) * 0.4);
      // a riveted bronze socket; the slot's own icon in it, lit when something is worn there
      blitObj(c, id ? sprite(ART.gear_socket) : sprite(ART.gear_socket, SWAP_DIM, 'dim'), cx, cy, 1);
      const icon = ART['slot_' + sl.slot];
      const hop = Math.round(Math.sin(Math.min(1, sl.pop) * Math.PI) * 4);
      if (icon) {
        const ic = id ? sprite(icon) : sprite(icon, SWAP_DIM, 'dim');
        blitObj(c, ic, cx, cy - 1 - hop, id ? 1 + hop : 0, id ? 1 : 0.55);
        if (id && sl.pop > 0.4) blitC(c, sprite(icon, SWAP_FLASH, 'flash'), cx, cy - 1 - hop, (sl.pop - 0.4) * 1.4);
      }
      // the gem in its seat, in the piece's rarity colour
      const hex = id ? gearHex(id) : 0x6a5440;
      const gem = sprite(ART.gem, gemSwap(hex), 'g' + hex);
      const gp = Math.round(Math.sin(Math.min(1, sl.pop) * Math.PI) * 1.5);
      blitC(c, gem, cx, cy + PH / 2 - 2 - gp);
      if (id) glint(gem, cx, cy + PH / 2 - 2 - gp, 0.25, dt);
    }
  }

  dispose() {
    const i = this.hud.painters.indexOf(this);
    if (i >= 0) this.hud.painters.splice(i, 1);
  }
}
