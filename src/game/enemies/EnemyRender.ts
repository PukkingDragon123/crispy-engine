// Instanced rig rendering for hordes: one InstancedMesh per (rig, part, LOD).
// Live enemies push a root matrix + per-part rotations; ragdoll pieces push
// world matrices directly. LOD1 = 2x downsampled voxel models for distance.
import * as THREE from 'three';
import { buildRigGeo, RigGeo, RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { downsampleModel } from '../../engine/voxel/VoxelModel';
import { ensureInstFx, makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { modelEntry } from '../models/lookup';
import { placeholderHumanoid } from '../models/placeholder';

export function resolveRig(key: string): RigSpec {
  const e = modelEntry(key);
  if (e) {
    const r = e();
    if ((r as RigSpec).parts) return r as RigSpec;
  }
  // fall back: strip _alpha, then placeholder
  if (key.endsWith('_alpha')) return resolveRig(key.slice(0, -6));
  const ph = placeholderHumanoid(0x9c7a58);
  ph.name = 'ph_' + key;
  return ph;
}

const material = makeVoxelMaterial();

export class RigBatch {
  geo: RigGeo;
  meshes: THREE.InstancedMesh[][] = [[], []]; // [lod][part]
  fx: THREE.InstancedBufferAttribute[][] = [[], []];
  counts: number[][] = [[], []];
  cap: number;
  private world: THREE.Matrix4[] = [];
  private local = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private one = new THREE.Vector3(1, 1, 1);
  partIndex: Record<string, number>;
  nParts: number;
  meta: Record<string, any>;

  constructor(public key: string, scene: THREE.Scene, cap = 96) {
    const spec = resolveRig(key);
    this.geo = buildRigGeo(spec, 'inst:' + key);
    this.cap = cap;
    this.partIndex = this.geo.index;
    this.nParts = this.geo.parts.length;
    this.meta = spec.meta ?? {};
    for (let lod = 0; lod < 2; lod++) {
      this.geo.parts.forEach((p, i) => {
        let g: THREE.BufferGeometry;
        if (lod === 0) g = p.geo.clone();
        else {
          const ds = downsampleModel(p.model, 2);
          g = ds.count > 0 ? buildVoxelGeometry(ds, { voxelSize: spec.voxelSize * 2, pivot: [p.pivot[0] / 2, p.pivot[1] / 2, p.pivot[2] / 2] }) : p.geo.clone();
        }
        const m = new THREE.InstancedMesh(g, material, cap);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.count = 0;
        m.castShadow = lod === 0;
        m.receiveShadow = true;
        m.frustumCulled = false;
        m.setColorAt(0, new THREE.Color(1, 1, 1));
        (m.instanceColor as THREE.InstancedBufferAttribute).setUsage(THREE.DynamicDrawUsage);
        this.fx[lod][i] = ensureInstFx(m);
        this.meshes[lod][i] = m;
        this.counts[lod][i] = 0;
        scene.add(m);
      });
    }
    for (let i = 0; i < this.nParts; i++) this.world.push(new THREE.Matrix4());
  }

  begin() {
    for (let l = 0; l < 2; l++) for (let i = 0; i < this.nParts; i++) this.counts[l][i] = 0;
  }

  /**
   * push a posed rig. rot: Float32Array(nParts*3) euler xyz per part (added to rest).
   * pos: optional extra per-part position offsets (meters, parent space) Float32Array(nParts*3).
   * hidden: bitmask array of hidden parts.
   */
  push(root: THREE.Matrix4, rot: Float32Array, hidden: Uint8Array | null, lod: 0 | 1, fx: [number, number, number, number], tint: THREE.Color, posOff?: Float32Array | null) {
    const parts = this.geo.parts;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      this.e.set(p.rest.x + rot[i * 3], p.rest.y + rot[i * 3 + 1], p.rest.z + rot[i * 3 + 2]);
      this.q.setFromEuler(this.e);
      const off = p.offset;
      const px = off.x + (posOff ? posOff[i * 3] : 0), py = off.y + (posOff ? posOff[i * 3 + 1] : 0), pz = off.z + (posOff ? posOff[i * 3 + 2] : 0);
      this.local.compose(new THREE.Vector3(px, py, pz), this.q, this.one);
      const W = this.world[i];
      if (p.parent >= 0) W.multiplyMatrices(this.world[p.parent], this.local);
      else W.multiplyMatrices(root, this.local);
      if (hidden && hidden[i]) continue;
      this.write(i, W, lod, fx, tint);
    }
  }

  /** world matrix of a part from the last push (for sockets, muzzles, ragdoll seeding) */
  partWorld(i: number) {
    return this.world[i];
  }

  write(i: number, M: THREE.Matrix4, lod: 0 | 1, fx: [number, number, number, number], tint: THREE.Color) {
    const c = this.counts[lod][i];
    if (c >= this.cap) return;
    const mesh = this.meshes[lod][i];
    mesh.setMatrixAt(c, M);
    mesh.setColorAt(c, tint);
    const fa = this.fx[lod][i];
    fa.setXYZW(c, fx[0], fx[1], fx[2], fx[3]);
    this.counts[lod][i] = c + 1;
  }

  end() {
    for (let l = 0; l < 2; l++)
      for (let i = 0; i < this.nParts; i++) {
        const m = this.meshes[l][i];
        const c = this.counts[l][i];
        m.count = c;
        if (c > 0) {
          m.instanceMatrix.needsUpdate = true;
          m.instanceMatrix.clearUpdateRanges();
          m.instanceMatrix.addUpdateRange(0, c * 16);
          if (m.instanceColor) {
            m.instanceColor.needsUpdate = true;
          }
          this.fx[l][i].needsUpdate = true;
        }
      }
  }

  dispose() {
    for (let l = 0; l < 2; l++) for (const m of this.meshes[l]) {
      m.removeFromParent();
      m.geometry.dispose();
    }
  }
}

export class EnemyRender {
  batches = new Map<string, RigBatch>();
  constructor(private scene: THREE.Scene) {}
  get(key: string, cap = 96) {
    let b = this.batches.get(key);
    if (!b) {
      b = new RigBatch(key, this.scene, cap);
      this.batches.set(key, b);
    }
    return b;
  }
  begin() {
    for (const b of this.batches.values()) b.begin();
  }
  end() {
    for (const b of this.batches.values()) b.end();
  }
}
