// THE BULLET ROW: Sundown's rounds as big 3D voxel cartridges standing in a row on top of
// the tarot card pile (the sculpted HUD rounds of props/hud.ts: drawn brass case, lead or
// venom-glass nose, stamped head), readable at a glance. A shot kicks the last loaded round
// up off the row, tumbling away; an empty place keeps a dark spent case, leaning; a reload
// drops fresh rounds in one by one with a little bounce; the last round shivers and warms.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { hudRound, type HudRoundKind } from '../models/props/hud';

export interface BulletRowAnchor {
  /** left end (first round's centre) and the row's floor, HUD px */
  x: number;
  y: number;
  /** one round's height and the spacing, HUD px */
  h: number;
  gap: number;
  n: number;
  shown: number;
  venom: number;
  reloading: boolean;
  hidden: boolean;
}

interface Flyer {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  w: number;
  life: number;
}

export class HudBullets {
  private root = new THREE.Group();
  private geo: Partial<Record<HudRoundKind, { g: THREE.BufferGeometry; len: number }>> = {};
  private live: THREE.Mesh[] = [];
  private empty: THREE.Mesh[] = [];
  private mat: VoxelMaterial;
  private dimMat: VoxelMaterial;
  private drop: number[] = [];
  private lastShown = -1;
  private flyers: Flyer[] = [];
  private t = 0;
  private ok = true;

  constructor(private scene: THREE.Scene) {
    this.mat = makeVoxelMaterial({ fog: false });
    this.dimMat = makeVoxelMaterial({ fog: false });
    this.dimMat.userData.tint.value.setRGB(0.34, 0.3, 0.28);
    scene.add(this.root);
  }

  private round(kind: HudRoundKind) {
    let e = this.geo[kind];
    if (!e) {
      const r = hudRound(kind, 6);
      const g = buildVoxelGeometry(r.model, { voxelSize: 1, pivot: r.pivot });
      g.computeBoundingBox();
      const b = g.boundingBox!;
      e = { g, len: Math.max(1, b.max.z - b.min.z) };
      this.geo[kind] = e;
    }
    return e;
  }

  private ensure(n: number) {
    while (this.live.length < n) {
      const a = new THREE.Mesh(this.round('brass').g, this.mat);
      const b = new THREE.Mesh(this.round('spent').g, this.dimMat);
      for (const m of [a, b]) {
        m.frustumCulled = false;
        this.root.add(m);
      }
      this.live.push(a);
      this.empty.push(b);
      this.drop.push(1);
    }
  }

  update(dt: number, A: BulletRowAnchor | null, visible: boolean, s: number) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.life -= dt;
      f.vy -= 1400 * (s / 2) * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.r += f.w * dt;
      f.mesh.position.set(f.x, f.y, 60);
      f.mesh.rotation.set(Math.PI / 2 + f.r * 0.4, f.r * 0.7, f.r);
      if (f.life <= 0) {
        f.mesh.removeFromParent();
        this.flyers.splice(i, 1);
      }
    }
    const on = !!A && visible && !A.hidden && this.ok;
    this.root.visible = on;
    if (!on || !A) {
      if (A) this.lastShown = A.shown;
      return;
    }
    try {
      this.ensure(A.n);
    } catch (e) {
      console.warn('[hud] bullet row failed', e);
      this.ok = false;
      return;
    }
    const brass = this.round('brass'), venom = this.round('venom');
    const sc = (A.h * s) / brass.len;
    // shots: each round that left the row flies off, spinning
    if (this.lastShown >= 0 && A.shown < this.lastShown && !A.reloading)
      for (let i = A.shown; i < this.lastShown && i < A.n; i++) {
        const m = new THREE.Mesh(i < A.venom ? venom.g : brass.g, this.mat);
        m.scale.setScalar(sc);
        m.frustumCulled = false;
        this.scene.add(m);
        this.flyers.push({ mesh: m, x: (A.x + i * A.gap) * s, y: -(A.y - A.h * 0.5) * s, vx: (40 + Math.random() * 90) * s, vy: (260 + Math.random() * 120) * (s / 2), r: 0, w: 10 + Math.random() * 8, life: 1.1 });
      }
    if (this.lastShown >= 0 && A.shown > this.lastShown) for (let i = this.lastShown; i < A.shown && i < this.drop.length; i++) this.drop[i] = 0;
    this.lastShown = A.shown;
    const lastOne = A.shown === 1;
    for (let i = 0; i < this.live.length; i++) {
      const m = this.live[i], e = this.empty[i];
      const inRow = i < A.n;
      const loaded = inRow && i < A.shown;
      m.visible = loaded;
      e.visible = inRow && !loaded;
      if (!inRow) continue;
      const x = (A.x + i * A.gap) * s;
      this.drop[i] = Math.min(1, this.drop[i] + dt * 5);
      const d = this.drop[i];
      // drops in from above with a small bounce
      const fall = d < 1 ? (1 - easeOutBounce(d)) * 30 : 0;
      const wave = Math.sin(this.t * 1.7 - i * 0.6) * 0.8;
      const shiver = lastOne && loaded ? Math.sin(this.t * 38) * 0.6 : 0;
      m.geometry = i < A.venom ? venom.g : brass.g;
      m.scale.setScalar(sc);
      // stand it up: the round runs from its head (pivot) toward -Z, so -Z turns to +Y
      m.position.set(x + shiver * s, (wave - A.y + fall) * s, 40 + i);
      m.rotation.set(Math.PI / 2 - 0.1, 0.5 + Math.sin(this.t * 0.6 + i * 0.9) * 0.25, 0.04 * Math.sin(this.t * 1.3 + i));
      // an empty place keeps its dark spent case, leaning
      e.scale.setScalar(sc);
      e.position.set(x, -A.y * s, 38 + i);
      e.rotation.set(Math.PI / 2 - 0.15, 0.4 + i * 0.7, 0.32);
    }
    const warm = lastOne ? 1.15 + 0.15 * Math.sin(this.t * 9) : 1;
    this.mat.userData.tint.value.setRGB(warm, warm * 0.98, warm * 0.94);
  }

  dispose() {
    this.root.removeFromParent();
    for (const f of this.flyers) f.mesh.removeFromParent();
    this.flyers = [];
    for (const e of Object.values(this.geo)) e?.g.dispose();
    this.mat.dispose();
    this.dimMat.dispose();
  }
}

function easeOutBounce(t: number) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}
