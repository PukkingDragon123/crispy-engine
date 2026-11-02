// Engine cloth for Sundown: duster tails (or poncho flaps) hanging from the
// coat anchor sockets and a bandana tail from the neck — simulated with
// Verlet, colliding with hips & legs, blown by wind + riding airflow.
import * as THREE from 'three';
import { Cloth, ClothRenderer } from '../../engine/physics/Cloth';
import type { RigInstance } from '../../engine/voxel/Rig';

export class Garments {
  cloths: { cloth: Cloth; anchors: (() => void) }[] = [];
  private spheres: { c: THREE.Vector3; r: number; node: string; off: number }[] = [];
  private tmp = new THREE.Vector3();

  constructor(private rig: RigInstance, private renderer: ClothRenderer, groundAt: (x: number, z: number) => number) {
    const meta = rig.geo.spec.meta?.cloth as any;
    if (!meta) return;
    const S = rig.sockets;
    // body colliders
    for (const [node, r, off] of [['pelvis', 0.17, 0.05], ['thigh_l', 0.11, -0.12], ['thigh_r', 0.11, -0.12], ['shin_l', 0.1, -0.12], ['shin_r', 0.1, -0.12], ['torso', 0.18, 0.15]] as [string, number, number][]) {
      if (rig.nodes[node]) this.spheres.push({ c: new THREE.Vector3(), r, node, off });
    }
    const coat = meta.coat as number[] | undefined;
    if (coat && S['coat_anchor_l'] && S['coat_anchor_r']) {
      const style = meta.coatStyle as string;
      const len = meta.coatLen ?? 0.6;
      const width = meta.coatWidth ?? 0.44;
      if (style === 'tails') {
        // wide back panel wrapping from left hip around the back to right hip
        const W = 8;
        const c = new Cloth({ w: W, h: 11, width: width * 1.6, length: len, colors: coat, pattern: 'duster', fray: 0.3, stiffness: 0.92, drag: 2.2 });
        const back = S['coat_anchor_back'] ?? S['coat_anchor_l'];
        const pl = new THREE.Vector3(), pb = new THREE.Vector3(), pr = new THREE.Vector3();
        this.add(c, () => {
          S['coat_anchor_l'].getWorldPosition(pl);
          back.getWorldPosition(pb);
          S['coat_anchor_r'].getWorldPosition(pr);
          for (let i = 0; i < W; i++) {
            const t = i / (W - 1);
            // quadratic bezier l -> back(control, pushed out) -> r
            const u = 1 - t;
            c.anchors[i].set(u * u * pl.x + 2 * u * t * pb.x + t * t * pr.x, u * u * pl.y + 2 * u * t * pb.y + t * t * pr.y, u * u * pl.z + 2 * u * t * pb.z + t * t * pr.z);
          }
        }, groundAt);
      } else if (style === 'poncho') {
        for (const key of ['coat_anchor_front', 'coat_anchor_back']) {
          const sock = S[key];
          if (!sock) continue;
          const W = 7;
          const c = new Cloth({ w: W, h: 6, width, length: len, colors: coat, pattern: 'poncho', fray: 0.15, stiffness: 0.9, drag: 2 });
          const center = new THREE.Vector3(), side = new THREE.Vector3();
          this.add(c, () => {
            sock.getWorldPosition(center);
            side.set(1, 0, 0).applyQuaternion(sock.getWorldQuaternion(new THREE.Quaternion()));
            for (let i = 0; i < W; i++) c.anchors[i].copy(center).addScaledVector(side, (i / (W - 1) - 0.5) * width);
          }, groundAt);
        }
      }
    }
    const band = meta.bandana as number[] | undefined;
    if (band && S['bandana_anchor']) {
      const sock = S['bandana_anchor'];
      const W = 3;
      const c = new Cloth({ w: W, h: 6, width: 0.08, length: meta.bandanaLen ?? 0.16, colors: [band[0], band[1], band[1]], pattern: 'bandana', fray: 0.4, stiffness: 0.8, drag: 3, thickness: 0.012 });
      const p = new THREE.Vector3(), side = new THREE.Vector3();
      this.add(c, () => {
        sock.getWorldPosition(p);
        side.set(1, 0, 0).applyQuaternion(sock.getWorldQuaternion(new THREE.Quaternion()));
        for (let i = 0; i < W; i++) c.anchors[i].copy(p).addScaledVector(side, (i / (W - 1) - 0.5) * 0.08);
      }, groundAt);
    }
  }

  private add(c: Cloth, anchors: () => void, groundAt: (x: number, z: number) => number) {
    c.groundAt = groundAt;
    c.spheres = this.spheres;
    this.cloths.push({ cloth: c, anchors });
    this.renderer.add(c);
  }

  /** call after the rig is posed each frame */
  update(windX: number, windZ: number, vel: THREE.Vector3) {
    for (const s of this.spheres) {
      const n = this.rig.nodes[s.node];
      n.getWorldPosition(s.c);
      if (s.off) s.c.y += s.off;
    }
    for (const g of this.cloths) {
      g.anchors();
      // airflow: moving through still air = wind opposite to velocity
      g.cloth.wind.set(windX - vel.x * 0.9, 0.5 - vel.y * 0.3, windZ - vel.z * 0.9);
    }
  }

  setEnabled(v: boolean) {
    for (const g of this.cloths) g.cloth.enabled = v;
  }

  dispose() {
    for (const g of this.cloths) this.renderer.remove(g.cloth);
  }
}
