// Mark's magazine in the live 3D lower HUD (where Sundown's revolver cylinder floats):
// a moon-god medallion, a disc whose face is the full moon in relief (maria, rayed
// craters, glowing faintly) set in a lapis rim studded with silver phase beads, and
// his moon crests orbiting it. A thrown crest leaves its place on the orbit and spins
// off the edge of the screen; while it is in the air a faint ghost marks its slot,
// and the catch snaps it back in with a pixel sparkle. In ADS the next crest swells
// and the disc brightens as the charged throw winds up; a recall flashes the rim.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { VF } from '../../engine/voxel/VoxelModel';
import type { WeaponHud } from '../player/Weapons';
import { sculpt, PixelFx, fbm3, h3, len2, clamp01, TAU } from './HudKit';

/** disc radius in HUD voxels (matches the cylinder's footprint) */
const DR = 14;
const ORBIT = DR + 6.5;
const MOON = { hi: 0xf4f8ff, base: 0xd6e2f2, mare: 0xa9b9d6, crater: 0x8494b4 };
const LAPIS = { base: 0x2b50a6, shade: 0x1d3a7e, hi: 0x5079cf, fleck: 0xd9c27c };
const SILVER = { base: 0xc6cfda, shade: 0x8b97a7, hi: 0xf2f6ff, dark: 0x58627a };
const METAL = VF.SOLID | VF.METAL;

function discModel() {
  const craters: [number, number, number][] = [];
  for (let i = 0; i < 9; i++) {
    const a = h3(i, 2, 7) * TAU, r = Math.sqrt(h3(i, 5, 1)) * (DR - 4.5);
    craters.push([Math.cos(a) * r, Math.sin(a) * r, 1.1 + h3(i, 9, 3) * 1.6]);
  }
  const face = (x: number, y: number) => {
    let h = 0;
    for (const [cx, cy, cr] of craters) {
      const d = len2(x - cx, y - cy);
      if (d < cr) h -= 0.8 * (1 - (d / cr) ** 2);
      else if (d < cr * 1.35) h += 0.35;
    }
    return h;
  };
  return sculpt('hud_moon_disc', [-DR - 2, -DR - 2, -4, DR + 2, DR + 2, 4], (x, y, z) => {
    const r = len2(x, y);
    const rim = r > DR - 3.2;
    const top = rim ? 2.6 - Math.max(0, r - DR + 0.8) * 0.9 : 1.6 + face(x, y) * 0.5;
    const dz = z > 0 ? z - top : -z - 2.2;
    let d = Math.max(r - DR, dz);
    // silver phase beads on the rim
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      d = Math.min(d, Math.hypot(x - Math.cos(a) * (DR - 1.6), y - Math.sin(a) * (DR - 1.6), z - 2.8) - 1.05);
    }
    return d;
  }, (x, y, z, s) => {
    const r = len2(x, y);
    if (z > 2.3 && r > DR - 3) return [s.exp > 0.6 ? SILVER.hi : SILVER.base, METAL];
    if (r > DR - 3.2) {
      if (z < -1.5) return [SILVER.shade, METAL];
      if (r > DR - 0.9) return [SILVER.base, METAL];
      return [h3(Math.floor(x), Math.floor(y), Math.floor(z), 3) < 0.06 ? LAPIS.fleck : s.ny > 0.3 ? LAPIS.hi : LAPIS.base, VF.SOLID];
    }
    if (z < 0) return [SILVER.shade, METAL];
    // the moon's face: maria, crater floors, bright rays
    const mare = fbm3(x * 0.16 + 2, y * 0.16, 0) > 0.18;
    const c = s.exp < 0.35 ? MOON.crater : mare ? MOON.mare : s.exp > 0.7 ? MOON.hi : MOON.base;
    return [c, VF.SOLID | VF.EMISSIVE];
  });
}

/** a small crescent (horns toward +y), flat in XY, its face toward +z */
function crestModel() {
  return sculpt('hud_crest', [-7, -8, -2, 7, 8, 2], (x, y, z) => {
    const outer = len2(x, y) - 6.6;
    const inner = len2(x + 3.0, y) - 5.6;
    const c = Math.max(outer, -inner);
    const w = clamp01(-c / 1.6);
    return Math.max(c, Math.abs(z) - (0.4 + 1.1 * Math.sqrt(w)));
  }, (x, y, z, s) => {
    const outer = len2(x, y) - 6.6;
    const inner = len2(x + 3.0, y) - 5.6;
    const c = Math.max(outer, -inner);
    if (len2(x - 5.0, y) < 1.3 && Math.abs(z) > 0.6) return [0xeef7ff, VF.SOLID | VF.GLOW];
    if (c > -0.7) return [SILVER.hi, METAL];
    if (Math.abs(c + 1.6) < 0.45 && Math.abs(z) > 0.5) return [LAPIS.base, VF.SOLID];
    return [s.ny > 0.3 ? SILVER.hi : s.ny < -0.3 ? SILVER.shade : SILVER.base, METAL];
  });
}

interface Slot {
  mesh: THREE.Mesh;
  ghost: THREE.Mesh;
  /** 0 seated .. 1 gone (flying off) */
  out: number;
  pop: number;
  have: boolean;
}

export class MoonCrestHud {
  private root = new THREE.Group();
  private disc: THREE.Mesh;
  private mat: VoxelMaterial;
  private ghostMat: VoxelMaterial;
  private discMat: VoxelMaterial;
  private crestGeo: THREE.BufferGeometry;
  private slots: Slot[] = [];
  private spin = 0;
  private t = 0;
  private lastHand = -1;
  private flash = 0;
  private fx = new PixelFx(160, true, 63);

  constructor(scene: THREE.Scene) {
    this.mat = makeVoxelMaterial({ fog: false });
    this.discMat = makeVoxelMaterial({ fog: false });
    this.ghostMat = makeVoxelMaterial({ fog: false, transparent: true, opacity: 0.22 });
    this.ghostMat.depthWrite = false;
    this.disc = new THREE.Mesh(buildVoxelGeometry(discModel(), { voxelSize: 1, pivot: [0, 0, 0] }), this.discMat);
    this.crestGeo = buildVoxelGeometry(crestModel(), { voxelSize: 1, pivot: [0, 0, 0] });
    this.root.add(this.disc);
    this.root.visible = false;
    scene.add(this.root, this.fx.points);
  }

  private ensure(n: number) {
    while (this.slots.length < n) {
      const mesh = new THREE.Mesh(this.crestGeo, this.mat);
      const ghost = new THREE.Mesh(this.crestGeo, this.ghostMat);
      this.root.add(mesh, ghost);
      this.slots.push({ mesh, ghost, out: 0, pop: 0, have: true });
    }
  }

  /**
   * @param cy the cylinder's anchor (HUD px; R = its radius) — the medallion floats in its place
   * @param w the weapon readout (kind 'crest')
   */
  update(dt: number, cy: { x: number; y: number; R: number }, w: WeaponHud | null | undefined, visible: boolean, s: number) {
    const on = visible && w?.kind === 'crest' && !!w.crest;
    this.root.visible = on;
    this.fx.points.visible = visible;
    this.fx.update(dt, s);
    if (!on || !w?.crest) return;
    this.t += dt;
    const C = w.crest;
    const n = Math.max(1, C.max);
    this.ensure(n);
    const vox = (cy.R * s) / (DR + 0.5);
    const hx = cy.x * s, hy = -cy.y * s;
    this.root.position.set(hx, hy + Math.sin(this.t * 1.5) * 2 * s, 0);
    this.root.scale.setScalar(vox * 0.92);
    this.root.rotation.set(-0.16 + Math.sin(this.t * 0.8) * 0.05, 0.28 + Math.sin(this.t * 0.6) * 0.06, 0);
    // throws and catches
    if (this.lastHand >= 0 && C.hand < this.lastHand) for (let i = C.hand; i < this.lastHand && i < n; i++) this.slots[i].out = Math.max(this.slots[i].out, 0.001);
    if (this.lastHand >= 0 && C.hand > this.lastHand)
      for (let i = this.lastHand; i < C.hand && i < n; i++) {
        this.slots[i].out = 0;
        this.slots[i].pop = 1;
        const a = this.slotAngle(i, n);
        const px = cy.x + Math.cos(a) * ORBIT * vox * 0.92 / s, py = cy.y - Math.sin(a) * ORBIT * vox * 0.92 / s;
        for (let k = 0; k < 7; k++) this.fx.emit({ x: px, y: py, vx: (Math.random() - 0.5) * 70, vy: (Math.random() - 0.5) * 70, drag: 4, life: 0.3 + Math.random() * 0.25, size: 1, c0: 0xffffff, c1: 0xa9cdff, alpha: 1, flick: 0.4 });
      }
    this.lastHand = C.hand;
    if (C.recall > 0.75) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.spin += dt * (0.5 + C.charge * 3);
    const tint = this.discMat.userData.tint?.value as THREE.Color | undefined;
    if (tint) {
      const g = 1 + C.charge * 0.35 + this.flash * 0.5 + Math.sin(this.t * 2) * 0.03;
      tint.setRGB(g, g, g * 1.04);
    }
    this.disc.rotation.z = Math.sin(this.t * 0.4) * 0.08;
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i];
      const live = i < n;
      sl.have = i < C.hand;
      if (!live) {
        sl.mesh.visible = sl.ghost.visible = false;
        continue;
      }
      if (sl.out > 0 && !sl.have) sl.out = Math.min(1, sl.out + dt * 3.2);
      sl.pop = Math.max(0, sl.pop - dt * 4);
      const a = this.slotAngle(i, n);
      const k = sl.out;
      const r = ORBIT + k * k * 40;
      const next = sl.have && i === C.hand - 1 && C.charge > 0;
      sl.mesh.visible = sl.have || (k > 0 && k < 1);
      sl.mesh.position.set(Math.cos(a) * r, Math.sin(a) * r, 3 + k * 6);
      sl.mesh.rotation.set(0, 0, a - Math.PI / 2 + k * 10);
      sl.mesh.scale.setScalar((1 + sl.pop * 0.45 + (next ? C.charge * 0.35 : 0)) * (1 - k * 0.5));
      // the slot of a crest in the air keeps a ghost (brighter while it is coming home)
      sl.ghost.visible = !sl.have && k >= 1;
      sl.ghost.position.set(Math.cos(a) * ORBIT, Math.sin(a) * ORBIT, 2);
      sl.ghost.rotation.set(0, 0, a - Math.PI / 2);
      sl.ghost.scale.setScalar(0.85);
    }
    this.ghostMat.opacity = 0.18 + 0.12 * Math.sin(this.t * 6) * (C.out.some((o) => o === 2) ? 1 : 0.3);
  }

  private slotAngle(i: number, n: number) {
    return Math.PI / 2 + (i / n) * TAU + this.spin;
  }

  dispose() {
    this.root.removeFromParent();
    this.fx.dispose();
    this.disc.geometry.dispose();
    this.crestGeo.dispose();
  }
}
