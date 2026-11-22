// Waking on Mama Toad's couch after a lost ride (HubScene's wake-up, DEATH worker).
// She has pulled her rocking chair up to the head of the couch and sat there knitting
// by lamplight the whole time; she murmurs over him while he sleeps, then talks him
// back onto his feet: the nights she counted, what killed him, how far he rode, an old
// memory of him (meta/ToadMemory decides what, and remembers what she has told).
// HubScene drives the clock and her voice; this owns the staging and the script.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { lantern } from '../../models/props/hub';
import { toadMemory } from '../../meta/ToadMemory';

/** seconds of the bedside vigil before the wake-up proper begins */
export const WAKE_LEAD = 2.8;

export class ToadWake {
  readonly lines = toadMemory.wakeLines();
  /** her head beside the couch (for the two-shot) and his on the pillow */
  readonly mamaAt = new THREE.Vector3();
  readonly headAt = new THREE.Vector3();
  private chairSaved: { p: THREE.Vector3; ry: number } | null = null;
  private lamp: THREE.Mesh | null = null;
  private home = true;

  /** fc: the couch's centre; sy: its seat height; his head lies toward +x */
  constructor(private scene: THREE.Scene, private chair: THREE.Object3D | null, fc: THREE.Vector3, sy: number) {
    this.headAt.set(fc.x + 0.72, sy + 0.32, fc.z + 0.05);
    const cx = fc.x + 1.32, cz = fc.z + 0.62;
    this.mamaAt.set(cx - 0.05, 1.0, cz - 0.08);
    if (chair) {
      this.chairSaved = { p: chair.position.clone(), ry: chair.rotation.y };
      chair.position.set(cx, chair.position.y, cz);
      chair.rotation.y = Math.atan2(this.headAt.x - cx, this.headAt.z - cz);
      this.home = false;
    }
    // the lamp she kept lit by the couch
    try {
      const sm = lantern();
      const g = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: 'bottom' });
      const m = new THREE.Mesh(g, sharedVoxelMaterial);
      m.castShadow = m.receiveShadow = true;
      m.position.set(fc.x + 0.98, 0, fc.z + 0.36);
      m.rotation.y = 0.4;
      scene.add(m);
      this.lamp = m;
    } catch (e) {
      console.warn('[wake] lamp', e);
    }
  }

  /** the chair goes back to the hearth (off camera: the poster shot, or the end of the wake) */
  chairHome() {
    if (this.home || !this.chair || !this.chairSaved) return;
    this.home = true;
    this.chair.position.copy(this.chairSaved.p);
    this.chair.rotation.y = this.chairSaved.ry;
  }

  /** the wake is over: everything back; returns what she still has to say */
  end() {
    this.chairHome();
    if (this.lamp) {
      this.lamp.removeFromParent();
      this.lamp.geometry.dispose();
      this.lamp = null;
    }
    return [...this.lines.after];
  }
}
