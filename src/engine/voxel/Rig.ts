// Part-based voxel rigs. Each part is its own VoxelModel with a pivot; parts are
// parented so procedural animation is just rotating joint nodes.
//
// CONVENTIONS (all modelers follow these):
//  - Rig origin is on the ground between the feet. Y up. Character FACES +Z.
//  - Character's LEFT side is +X, RIGHT side is -X.
//  - pivot: the joint rotation center in the part's own voxel coordinates.
//  - attach: where the pivot sits in the PARENT part's voxel coordinates
//    (for the root part: in rig space voxel coordinates, origin at ground).

import * as THREE from 'three';
import { VoxelModel } from './VoxelModel';
import { buildVoxelGeometry } from './Mesher';
import { makeVoxelMaterial, sharedVoxelMaterial, VoxelMaterial } from '../render/VoxelMaterial';

export type V3 = [number, number, number];

export interface PartSpec {
  name: string;
  model: VoxelModel;
  pivot: V3;
  parent?: string;
  attach: V3;
  /** default rest rotation (radians) */
  rest?: V3;
}

export interface SocketSpec {
  part: string;
  /** position in that part's voxel coords */
  at: V3;
  /** optional rotation of socket */
  rot?: V3;
}

export interface RigSpec {
  name: string;
  voxelSize: number;
  parts: PartSpec[];
  sockets?: Record<string, SocketSpec>;
  /** free-form metadata (height in meters, hit radius, etc.) */
  meta?: Record<string, any>;
}

export interface RigPartGeo {
  name: string;
  geo: THREE.BufferGeometry;
  parent: number;
  /** offset from parent pivot to this pivot, meters, in parent space */
  offset: THREE.Vector3;
  rest: THREE.Euler;
  model: VoxelModel;
  pivot: V3;
}

export interface RigGeo {
  spec: RigSpec;
  parts: RigPartGeo[];
  index: Record<string, number>;
  /** socket local offsets (meters) relative to part pivot */
  sockets: Record<string, { part: number; offset: THREE.Vector3; rot: THREE.Euler }>;
}

const rigCache = new Map<string, RigGeo>();

export function buildRigGeo(spec: RigSpec, cacheKey?: string): RigGeo {
  const ck = cacheKey ?? spec.name;
  const hit = rigCache.get(ck);
  if (hit) return hit;
  const vs = spec.voxelSize;
  const index: Record<string, number> = {};
  spec.parts.forEach((p, i) => (index[p.name] = i));
  const parts: RigPartGeo[] = spec.parts.map((p) => {
    const geo = buildVoxelGeometry(p.model, { voxelSize: vs, pivot: p.pivot });
    const parentIdx = p.parent ? index[p.parent] : -1;
    let offset: THREE.Vector3;
    if (parentIdx >= 0) {
      const pp = spec.parts[parentIdx];
      offset = new THREE.Vector3((p.attach[0] - pp.pivot[0]) * vs, (p.attach[1] - pp.pivot[1]) * vs, (p.attach[2] - pp.pivot[2]) * vs);
    } else {
      offset = new THREE.Vector3(p.attach[0] * vs, p.attach[1] * vs, p.attach[2] * vs);
    }
    return {
      name: p.name,
      geo,
      parent: parentIdx,
      offset,
      rest: new THREE.Euler(...(p.rest ?? [0, 0, 0])),
      model: p.model,
      pivot: p.pivot,
    };
  });
  const sockets: RigGeo['sockets'] = {};
  for (const [k, s] of Object.entries(spec.sockets ?? {})) {
    const pi = index[s.part];
    if (pi === undefined) continue;
    const pp = spec.parts[pi];
    sockets[k] = {
      part: pi,
      offset: new THREE.Vector3((s.at[0] - pp.pivot[0]) * vs, (s.at[1] - pp.pivot[1]) * vs, (s.at[2] - pp.pivot[2]) * vs),
      rot: new THREE.Euler(...(s.rot ?? [0, 0, 0])),
    };
  }
  const rg: RigGeo = { spec, parts, index, sockets };
  rigCache.set(ck, rg);
  return rg;
}

export function clearRigCache(name?: string) {
  if (name) rigCache.delete(name);
  else rigCache.clear();
}

/** A live (non-instanced) rig made of meshes: used for player, bosses, NPCs, cinematics. */
export class RigInstance {
  root = new THREE.Group();
  nodes: Record<string, THREE.Group> = {};
  meshes: Record<string, THREE.Mesh> = {};
  sockets: Record<string, THREE.Group> = {};
  material: VoxelMaterial;
  constructor(public geo: RigGeo, opts: { ownMaterial?: boolean; castShadow?: boolean; material?: VoxelMaterial } = {}) {
    this.material = opts.material ?? (opts.ownMaterial ? makeVoxelMaterial() : (sharedVoxelMaterial as VoxelMaterial));
    const groups: THREE.Group[] = [];
    geo.parts.forEach((p, i) => {
      const g = new THREE.Group();
      g.name = p.name;
      g.position.copy(p.offset);
      g.rotation.copy(p.rest);
      const mesh = new THREE.Mesh(p.geo, this.material);
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = true;
      g.add(mesh);
      groups.push(g);
      this.nodes[p.name] = g;
      this.meshes[p.name] = mesh;
      if (p.parent >= 0) groups[p.parent].add(g);
      else this.root.add(g);
    });
    for (const [k, s] of Object.entries(geo.sockets)) {
      const sg = new THREE.Group();
      sg.name = 'socket:' + k;
      sg.position.copy(s.offset);
      sg.rotation.copy(s.rot);
      groups[s.part].add(sg);
      this.sockets[k] = sg;
    }
  }
  /** reset all joints to rest pose */
  resetPose() {
    this.geo.parts.forEach((p) => {
      const n = this.nodes[p.name];
      n.rotation.copy(p.rest);
      n.position.copy(p.offset);
    });
  }
  /** hide/show a part (limb loss) */
  setPartVisible(name: string, v: boolean) {
    const m = this.meshes[name];
    if (m) m.visible = v;
  }
  /** attach an object to a socket */
  attach(socket: string, obj: THREE.Object3D) {
    const s = this.sockets[socket];
    if (s) s.add(obj);
    return !!s;
  }
  dispose() {
    this.root.removeFromParent();
  }
}

/** Build a simple static mesh from a model */
export function voxelMesh(model: VoxelModel, voxelSize: number, pivot: V3 | 'bottom' | 'center' = 'bottom', material?: THREE.Material) {
  const geo = buildVoxelGeometry(model, { voxelSize, pivot });
  const mesh = new THREE.Mesh(geo, material ?? sharedVoxelMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
