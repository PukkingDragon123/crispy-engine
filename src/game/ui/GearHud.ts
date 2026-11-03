// The worn-gear rack in the run HUD: six little sculpted bronze sockets beside
// the consumable slots (above the health bar), each holding a real, lit,
// slowly turning miniature of the piece in that slot and a cut gem in its
// rarity colour. Lives in Hud3D's overlay scene (orthographic, CSS pixels,
// y down = negative) and follows the HUD's own anchors, so it slides away with
// the rest of the HUD.
import * as THREE from 'three';
import type { Hud } from './Hud';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { Equipment, GEAR_SLOTS, GearId, GearSlot, buildGearDisplay, gearGlassMaterial, gearHex } from '../player/Equipment';

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
  const m = new VoxelModel('hud_gear_gem');
  for (const [x, y, z] of [[0, 0, 0], [-1, 0, 0], [0, 1, 0], [-1, 1, 0], [0, 0, 1], [-1, 1, 1]] as [number, number, number][]) m.set(x, y, z, z ? 0xffffff : color, VF.EMISSIVE);
  m.set(0, 1, 1, color, VF.EMISSIVE);
  return m;
}

interface Slot {
  slot: GearSlot;
  socket: THREE.Mesh;
  gem: THREE.Mesh;
  model: THREE.Group | null;
  id: GearId | null;
  pop: number;
  spin: number;
}

export class GearHud {
  private root = new THREE.Group();
  private mat: VoxelMaterial;
  private gemMat: VoxelMaterial;
  /** empty sockets sit a little darker */
  private dimMat: VoxelMaterial;
  private slots: Slot[] = [];
  private t = 0;
  private socketGeo: THREE.BufferGeometry;
  private gems = new Map<number, THREE.BufferGeometry>();

  constructor(scene: THREE.Scene, private hud: Hud, private eq: Equipment) {
    this.mat = makeVoxelMaterial({ fog: false });
    this.gemMat = makeVoxelMaterial({ fog: false, emissiveStrength: 1.8 });
    this.dimMat = makeVoxelMaterial({ fog: false });
    this.dimMat.userData.tint?.value.setRGB(0.62, 0.56, 0.52);
    this.socketGeo = buildVoxelGeometry(socketModel(), { voxelSize: 1, pivot: [0, 0, 0] });
    scene.add(this.root);
    GEAR_SLOTS.forEach((slot, i) => {
      const socket = new THREE.Mesh(this.socketGeo, this.mat);
      const gem = new THREE.Mesh(this.gemGeo(0x6a5440), this.gemMat);
      this.root.add(socket, gem);
      this.slots.push({ slot, socket, gem, model: null, id: null, pop: 0, spin: i * 1.1 });
    });
  }

  private gemGeo(color: number) {
    let g = this.gems.get(color);
    if (!g) {
      g = buildVoxelGeometry(gemModel(color), { voxelSize: 1, pivot: [0, 0, 0] });
      this.gems.set(color, g);
    }
    return g;
  }

  update(dt: number) {
    this.t += dt;
    const hud = this.hud;
    const s = hud.scale;
    const A = hud.anchors;
    const visible = hud.visible && A.slide < 0.98;
    this.root.visible = visible;
    if (!visible) return;
    // sit right of the consumable slots (or above the heart if there are none)
    const last = A.items[A.items.length - 1];
    const x0 = last ? last.x + last.size / 2 + 6 + PW / 2 : A.heart.x + 30;
    const y0 = last ? last.y : A.heart.y - 23;
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i];
      const id = this.eq.get(sl.slot);
      if (id !== sl.id) {
        sl.model?.removeFromParent();
        sl.model = id ? buildGearDisplay(id, this.mat, gearGlassMaterial(true), 1) : null;
        if (sl.model) this.root.add(sl.model);
        sl.gem.geometry = this.gemGeo(id ? gearHex(id) : 0x6a5440);
        sl.pop = sl.id === null && id === null ? 0 : 1;
        sl.id = id;
      }
      sl.pop = Math.max(0, sl.pop - dt * 2.5);
      const cx = (x0 + i * (PW + 2)) * s, cy = -y0 * s;
      const bob = Math.sin(this.t * 1.7 + i) * 0.4 * s;
      sl.socket.position.set(cx, cy + bob, -6 * s);
      sl.socket.scale.setScalar(s);
      sl.socket.rotation.set(0.12, Math.sin(this.t * 0.5 + i) * 0.08, 0);
      sl.gem.position.set(cx - 0.5 * s, cy + bob + (-PH / 2 + 1.2) * s, -2 * s);
      sl.gem.scale.setScalar(s * (1 + sl.pop * 0.6));
      sl.socket.material = id ? this.mat : this.dimMat;
      if (sl.model) {
        const k = (13 * s) * (1 + Math.sin(Math.min(1, sl.pop) * Math.PI) * 0.45);
        sl.spin += dt * (0.8 + sl.pop * 14);
        sl.model.position.set(cx, cy + bob + 1 * s, 10 * s);
        sl.model.scale.setScalar(k);
        sl.model.rotation.set(0.35, sl.spin, 0.08);
      }
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.socketGeo.dispose();
    for (const g of this.gems.values()) g.dispose();
  }
}
