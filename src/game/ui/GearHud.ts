// The worn-gear rack in the run HUD: little sculpted bronze sockets beside the
// consumable slots (above the health bar), each holding the piece worn in that
// slot and a cut gem in its rarity colour — flat pixel art: the socket, the gem
// and each gear piece are photographs of their 3D models (HudSprites), painted
// into the HUD canvas (Hud.painters) on its pixel grid. It follows the HUD's own
// anchors, so it slides away with the rest of the HUD.
import * as THREE from 'three';
import type { Hud, HudPainter } from './Hud';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { Equipment, GEAR_SLOTS, GearId, GearSlot, buildGearDisplay, gearGlassMaterial, gearHex } from '../player/Equipment';
import { SpriteBank, Shot, blitC, variant, wrap, framingBox } from './HudSprites';

const BRONZE = { base: 0xbf8446, shade: 0x8e5a2c, hi: 0xe8b070, dark: 0x4e2c12 };
const WALNUT = { base: 0x3a2618, shade: 0x2a1a10, hi: 0x4e3422 };
const PW = 16, PH = 18; // socket size in HUD pixels (1 voxel = 1 HUD pixel)

/** a little riveted bronze cartouche with a dark walnut well and a gem seat */
function socketModel() {
  const m = new VoxelModel('hud_gear_socket');
  const hx = PW / 2, hy = PH / 2;
  for (let x = -hx; x < hx; x++)
    for (let y = -hy; y < hy + 1; y++) {
      const cx = x + 0.5;
      const top = hy - 1 + (Math.abs(cx) < 3 ? 1 : 0); // a small arch on the top edge
      if (y > top) continue;
      const dx = Math.min(x + hx, hx - 1 - x), dy = Math.min(y + hy, top - y);
      if (dx + dy < 2) continue; // cut corners
      const rim = dx < 2 || dy < 2;
      if (rim) {
        const lit = x - y < -4 ? BRONZE.hi : x - y > 6 ? BRONZE.shade : BRONZE.base;
        m.set(x, y, 0, BRONZE.shade).set(x, y, 1, BRONZE.base).set(x, y, 2, dx === 0 || dy === 0 ? BRONZE.dark : lit, VF.METAL);
      } else m.set(x, y, 0, (x + y) % 5 === 0 ? WALNUT.hi : WALNUT.base);
    }
  for (const [x, y] of [[-hx + 2, -hy + 2], [hx - 3, -hy + 2], [-hx + 2, hy - 3], [hx - 3, hy - 3]] as [number, number][]) m.set(x, y, 3, BRONZE.hi, VF.METAL);
  // gem seat at the bottom
  for (let x = -2; x <= 1; x++) m.set(x, -hy + 1, 3, BRONZE.dark, VF.METAL);
  return m;
}

function gemModel(color: number) {
  // a little cut cabochon: rarity colour with a lighter facet, glowing softly
  const m = new VoxelModel('hud_gear_gem');
  const hi = (((color >> 16) & 255) * 0.6 + 102) << 16 | (((color >> 8) & 255) * 0.6 + 102) << 8 | ((color & 255) * 0.6 + 102);
  for (const [x, y] of [[-1, 0], [0, 0], [-1, 1], [0, 1]] as [number, number][]) m.set(x, y, 0, color, VF.EMISSIVE);
  m.set(-1, 1, 1, hi, VF.EMISSIVE).set(0, 0, 1, color, VF.EMISSIVE);
  return m;
}

interface Slot {
  slot: GearSlot;
  id: GearId | null;
  pop: number;
}

let socketRig: THREE.Group | null = null;
const gemRigs = new Map<number, THREE.Group>();
let gemMat: THREE.Material | null = null;

export class GearHud implements HudPainter {
  private slots: Slot[] = [];
  private bank = SpriteBank.get();
  private t = 0;

  constructor(scene: THREE.Scene, private hud: Hud, private eq: Equipment) {
    GEAR_SLOTS.forEach((slot) => this.slots.push({ slot, id: null, pop: 0 }));
    hud.painters.push(this);
    void scene;
  }

  private socket() {
    return this.bank.get('gear:socket', 18, 46, (): Shot => {
      socketRig ??= wrap(new THREE.Mesh(buildVoxelGeometry(socketModel(), { voxelSize: 1, pivot: [0, 0, 0] }), SpriteBank.get().material()), framingBox([-PW / 2 - 0.5, -PH / 2 - 0.5, -0.5], [PW / 2 + 0.5, PH / 2 + 1.5, 4]));
      return { obj: socketRig, w: PW + 2, h: PH + 3, yaw: 0.06, pitch: 0.12, fit: true };
    });
  }
  private gem(color: number) {
    return this.bank.get('gear:gem:' + color.toString(16), 6, 44, (): Shot => {
      let g = gemRigs.get(color);
      if (!g) {
        gemMat ??= (() => {
          const m = makeVoxelMaterial({ fog: false, emissiveStrength: 1.8 });
          m.envMap = SpriteBank.get().envTexture();
          return m;
        })();
        g = wrap(new THREE.Mesh(buildVoxelGeometry(gemModel(color), { voxelSize: 1, pivot: [0, 0, 0] }), gemMat), framingBox([-1.6, -0.6, -0.5], [1.6, 2.6, 2]));
        gemRigs.set(color, g);
      }
      return { obj: g, w: 6, h: 5, yaw: 0, pitch: 0.2, fit: true };
    });
  }
  private piece(id: GearId) {
    return this.bank.get('gear:item:' + id, 15, 45, (): Shot | null => {
      const m = buildGearDisplay(id, SpriteBank.get().material(), gearGlassMaterial(true), 1);
      if (!m) return null;
      return { obj: wrap(m), w: 15, h: 15, yaw: 0.6, pitch: 0.35, fit: true };
    });
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
    const sock = this.socket();
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i];
      const id = this.eq.get(sl.slot);
      if (id !== sl.id) {
        sl.pop = sl.id === null && id === null ? 0 : 1;
        sl.id = id;
      }
      sl.pop = Math.max(0, sl.pop - dt * 2.5);
      const cx = x0 + i * (PW + 2), cy = y0 + Math.round(Math.sin(this.t * 1.7 + i) * 0.4);
      if (sock) blitC(c, id ? sock : variant(sock, 'dim'), cx, cy);
      const gem = this.gem(id ? gearHex(id) : 0x6a5440);
      const gp = Math.round(Math.sin(Math.min(1, sl.pop) * Math.PI) * 1.5);
      if (gem) blitC(c, gem, cx - 0.5, cy + PH / 2 - 2 - gp);
      if (id) {
        const pc = this.piece(id);
        if (pc) {
          const hop = Math.round(Math.sin(Math.min(1, sl.pop) * Math.PI) * 4);
          blitC(c, pc, cx, cy - 1 - hop);
          if (sl.pop > 0.4) blitC(c, variant(pc, 'flash'), cx, cy - 1 - hop, (sl.pop - 0.4) * 1.4);
        }
      }
    }
  }

  dispose() {
    const i = this.hud.painters.indexOf(this);
    if (i >= 0) this.hud.painters.splice(i, 1);
  }
}
