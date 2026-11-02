// World props: turns zone anchors into instanced scatter (cacti, rocks, crates,
// fences...), unique structures and landmark buildings. Colliders for big
// structures are derived from their voxels (1 m occupancy cells merged into
// oriented boxes). Destructibles shatter into their own voxel chunks; TNT
// chain-explodes; tumbleweeds roll with the wind; windmills spin; temple
// pieces rise from the sand when their zone unlocks.
import * as THREE from 'three';
import * as PM from '../models/props';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { sharedFoliageMaterial, sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import type { World } from './World';
import type { Anchor, ZoneDef } from './RegionGen';
import type { Collider } from './Colliders';
import { RNG, rnd, hash2i } from '../../engine/math/rand';
import { unkey, downsampleModel } from '../../engine/voxel/VoxelModel';

type SM = { model: VoxelModel; voxelSize: number; meta?: any; anchor?: [number, number, number]; rotor?: VoxelModel; rotorPivot?: any; rotorAt?: any };

interface KindDef {
  variants: number;
  build: (v: number, a: Anchor) => SM | null;
  solid?: 'circle' | 'box' | 'voxel' | 'none';
  radius?: number; // circle radius multiplier of footprint
  destructible?: { hp: number; material: 'wood' | 'cactus' | 'pottery' | 'bone' | 'rock'; explode?: number };
  foliage?: boolean;
  grapple?: boolean;
  unique?: boolean; // individual mesh (big structure)
}

const P: any = PM;
const cactusKind = (v: number) => (['saguaro', 'saguaro', 'saguaro', 'barrel', 'prickly', 'organ', 'saguaro', 'barrel', 'prickly', 'organ'] as const)[v % 10];

const KINDS: Record<string, KindDef> = {
  cactus: { variants: 10, build: (v) => P.cactus(v * 7 + 1, cactusKind(v)), solid: 'circle', radius: 0.35, destructible: { hp: 40, material: 'cactus' } },
  rock: { variants: 6, build: (v) => P.rock(v + 3, ((v % 3) + 1) as 1 | 2 | 3), solid: 'circle', radius: 0.8, destructible: undefined },
  boulder: { variants: 3, build: (v) => P.boulder(v), solid: 'circle', radius: 0.9 },
  bush: { variants: 4, build: (v) => P.dryBush(v), solid: 'none', foliage: true },
  reeds: { variants: 3, build: (v) => P.dryBush(v + 10), solid: 'none', foliage: true },
  palm: { variants: 4, build: (v) => P.palm(v), solid: 'circle', radius: 0.12, foliage: true },
  skull: { variants: 1, build: () => P.skull('cow'), solid: 'none' },
  giantSkull: { variants: 1, build: () => P.skull('giant'), solid: 'voxel' },
  boneScatter: { variants: 3, build: (v) => P.boneScatter(v), solid: 'none' },
  ribArch: { variants: 2, build: (v) => P.ribArch(v), solid: 'voxel', unique: true },
  boneGate: { variants: 1, build: () => P.ribArch(9), solid: 'voxel', unique: true },
  crate: { variants: 3, build: (v) => P.crate(v), solid: 'circle', radius: 0.7, destructible: { hp: 25, material: 'wood' } },
  tntCrate: { variants: 2, build: (v) => P.tntCrate(v), solid: 'circle', radius: 0.7, destructible: { hp: 12, material: 'wood', explode: 4.5 } },
  barrel: { variants: 2, build: (v) => P.barrel(v), solid: 'circle', radius: 0.8, destructible: { hp: 30, material: 'wood' } },
  whiskeyBarrel: { variants: 2, build: (v) => P.whiskeyBarrel(v), solid: 'circle', radius: 0.8, destructible: { hp: 30, material: 'wood' } },
  pot: { variants: 3, build: (v) => P.pot(v), solid: 'circle', radius: 0.7, destructible: { hp: 8, material: 'pottery' } },
  fence: { variants: 2, build: (v) => P.fence(3, v), solid: 'box', destructible: { hp: 30, material: 'wood' } },
  fenceBroken: { variants: 3, build: (v) => P.fenceBroken(v, 3, ((v % 2) + 1) as 1 | 2), solid: 'box', destructible: { hp: 20, material: 'wood' } },
  signpost: { variants: 4, build: (v) => P.signpost(v), solid: 'circle', radius: 0.25, destructible: { hp: 20, material: 'wood' } },
  hitchingPost: { variants: 2, build: (v) => P.hitchingPost(v), solid: 'box', destructible: { hp: 30, material: 'wood' } },
  wagonWheel: { variants: 2, build: (v) => P.wagonWheel(v), solid: 'circle', radius: 0.4, destructible: { hp: 15, material: 'wood' } },
  cattleSkullPost: { variants: 2, build: (v) => P.cattleSkullPost(v), solid: 'circle', radius: 0.3, destructible: { hp: 15, material: 'bone' } },
  mineCart: { variants: 2, build: (v) => P.mineCart(v), solid: 'circle', radius: 0.6 },
  mineEntrance: { variants: 1, build: () => P.railSegment(6, 2), solid: 'none' },
  wagon: { variants: 2, build: (v) => P.wagon(v), solid: 'voxel', unique: true },
  tent: { variants: 3, build: (v) => P.tent(v), solid: 'voxel' },
  campfire: { variants: 1, build: () => P.campfire(1), solid: 'circle', radius: 0.5 },
  wantedBoard: { variants: 2, build: (v) => P.wantedBoard(v), solid: 'voxel' },
  well: { variants: 1, build: () => P.well(0), solid: 'circle', radius: 0.6 },
  trough: { variants: 1, build: () => P.trough(0), solid: 'box' },
  shack: { variants: 4, build: (v) => P.shack(v), solid: 'voxel', unique: true },
  watchtower: { variants: 1, build: () => P.watchtower(0), solid: 'voxel', unique: true },
  windmill: { variants: 1, build: () => P.windmill(0), solid: 'voxel', unique: true },
  waterTower: { variants: 1, build: () => P.waterTower(0), solid: 'voxel', unique: true },
  outhouse: { variants: 1, build: () => P.outhouse(0), solid: 'voxel', unique: true, destructible: { hp: 60, material: 'wood' } },
  gallows: { variants: 1, build: () => P.gallows(0), solid: 'voxel', unique: true },
  saloonFacade: { variants: 1, build: () => P.saloonFacade(0), solid: 'voxel', unique: true },
  sheriffFacade: { variants: 1, build: () => P.sheriffFacade(0), solid: 'voxel', unique: true },
  storeFacade: { variants: 1, build: () => P.generalStoreFacade(0), solid: 'voxel', unique: true },
  obelisk: { variants: 2, build: (v) => P.obelisk(v, false), solid: 'circle', radius: 0.5, unique: true },
  obeliskBroken: { variants: 2, build: (v) => P.obelisk(v + 4, true), solid: 'circle', radius: 0.5, unique: true },
  column: { variants: 2, build: (v, a) => P.column(v, !!a.data?.broken), solid: 'circle', radius: 0.45, unique: true },
  sphinx: { variants: 1, build: () => P.sphinx(), solid: 'voxel', unique: true },
  statue: { variants: 1, build: (_v, a) => P.godStatue(a.data?.god ?? 'thoth'), solid: 'circle', radius: 0.5, unique: true },
  hieroglyphWall: { variants: 2, build: (v) => P.hieroglyphWall(v), solid: 'voxel', unique: true },
  ruinWall: { variants: 3, build: (v) => P.mudbrickRuin(v), solid: 'voxel', unique: true },
  sarcophagus: { variants: 1, build: () => P.sarcophagus(), solid: 'box', unique: true },
  totem: { variants: 1, build: () => P.scorpionTotem(), solid: 'circle', radius: 0.35, grapple: true, unique: true },
  capstone: { variants: 1, build: () => P.capstone(), solid: 'none', unique: true },
  stoneGate: { variants: 1, build: () => P.templeGate(0), solid: 'voxel', unique: true },
  ore: { variants: 5, build: (v, a) => P.oreNode(a.data?.type ?? (['copper', 'silver', 'gold', 'turquoise', 'amethyst'] as const)[v % 5], v), solid: 'circle', radius: 0.5, unique: true },
  tumbleweed: { variants: 3, build: (v) => P.tumbleweed(v), solid: 'none' },
};

const LANDMARKS: Record<string, () => SM> = {
  tradingPost: () => P.tradingPost(1),
  outlawFort: () => P.outlawFort(2),
  mineHeadframe: () => P.mineHeadframe(3),
  ranchBarn: () => P.ranchBarn(4),
  sheriffOffice: () => P.sheriffOffice(5),
  saloon: () => P.saloon(6),
};

interface Variant {
  sm: SM;
  geo: THREE.BufferGeometry;
  lodGeo?: THREE.BufferGeometry;
  mesh: THREE.InstancedMesh | null;
  count: number;
  cap: number;
  height: number;
  halfX: number;
  halfZ: number;
}

interface Batch {
  v: Variant;
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
  insts: PropInst[];
  foliage: boolean;
}

export interface PropInst {
  kind: string;
  batch?: Batch;
  anchor: Anchor;
  zone: number;
  variant: Variant;
  index: number; // instance index or -1 for unique
  mesh: THREE.Mesh | null;
  matrix: THREE.Matrix4;
  colliders: Collider[];
  hp: number;
  broken: boolean;
  baseY: number;
  rise?: string;
  extra?: any;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Props {
  group = new THREE.Group();
  variants = new Map<string, Variant>();
  list: PropInst[] = [];
  built = new Set<number>();
  tumbleweeds: { inst: PropInst; vel: THREE.Vector3; spin: number }[] = [];
  rotors: { mesh: THREE.Mesh; speed: number }[] = [];
  landmarks: PropInst[] = [];
  batches: Batch[] = [];
  onBreak?: (p: PropInst, spd: number, dir?: THREE.Vector3) => void;
  private rng = new RNG(1234);
  private lastLodPos = new THREE.Vector3(1e9, 0, 0);
  lodNear = 55;

  private lod(v: Variant) {
    if (!v.lodGeo) {
      const ds = downsampleModel(v.sm.model, 2);
      v.lodGeo = ds.count > 0 ? buildVoxelGeometry(ds, { voxelSize: v.sm.voxelSize * 2, pivot: 'bottom' }) : v.geo;
    }
    return v.lodGeo;
  }

  /** unique mesh with automatic distance LOD */
  private lodMesh(v: Variant, foliage: boolean, nearDist = 60) {
    const lod = new THREE.LOD();
    const mat = foliage ? sharedFoliageMaterial : sharedVoxelMaterial;
    const a = new THREE.Mesh(v.geo, mat);
    a.castShadow = true;
    a.receiveShadow = true;
    const b = new THREE.Mesh(this.lod(v), mat);
    b.castShadow = true;
    b.receiveShadow = true;
    lod.addLevel(a, 0);
    lod.addLevel(b, nearDist);
    return lod;
  }

  constructor(private world: World) {
    this.group.name = 'props';
    world.group.add(this.group);
  }

  private variant(kind: string, v: number, a: Anchor): Variant | null {
    const def = KINDS[kind];
    const key = def.unique && (kind === 'statue' || kind === 'ore' || kind === 'column') ? `${kind}:${v}:${a.data?.god ?? a.data?.type ?? (a.data?.broken ? 'b' : 'w')}` : `${kind}:${v}`;
    let vr = this.variants.get(key);
    if (vr) return vr;
    let sm: SM | null = null;
    try {
      sm = def.build(v, a);
    } catch (e) {
      console.warn('[props] build failed', kind, e);
    }
    if (!sm || !sm.model) return null;
    const geo = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: 'bottom' });
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    vr = { sm, geo, mesh: null, count: 0, cap: 0, height: bb.max.y - bb.min.y, halfX: (bb.max.x - bb.min.x) / 2, halfZ: (bb.max.z - bb.min.z) / 2 };
    this.variants.set(key, vr);
    return vr;
  }

  /** instantiate everything for a zone (call for zones the player may reach soon) */
  buildZone(z: ZoneDef) {
    if (this.built.has(z.index)) return;
    this.built.add(z.index);
    const t0 = performance.now();
    // gather per variant counts first for instanced capacity
    const plan: { a: Anchor; kind: string; v: Variant }[] = [];
    const zoneBatches = new Map<string, Batch>();
    for (const a of z.anchors) {
      if (a.kind === 'landmark') {
        this.addLandmark(z, a);
        continue;
      }
      const def = KINDS[a.kind];
      if (!def) continue;
      const v = hash2i(Math.round(a.x * 10), Math.round(a.z * 10)) % def.variants;
      const vr = this.variant(a.kind, v, a);
      if (!vr) continue;
      plan.push({ a, kind: a.kind, v: vr });
    }
    for (const { a, kind, v } of plan) {
      const def = KINDS[kind];
      const g = this.world.groundAt(a.x, a.z);
      const sc = (a.scale ?? 1) * (kind === 'rock' ? 1 : 1);
      const rot = a.rot ?? this.rng.range(0, Math.PI * 2);
      let y = g - 0.05;
      if (kind === 'capstone') y = a.data?.y ?? g;
      _q.setFromAxisAngle(UP, rot);
      _s.setScalar(sc);
      const riseDepth = a.rise ? v.height * sc + 0.5 : 0;
      _p.set(a.x, y - riseDepth, a.z);
      const matrix = new THREE.Matrix4().compose(_p, _q, _s);
      const inst: PropInst = { kind, anchor: a, zone: z.index, variant: v, index: -1, mesh: null, matrix, colliders: [], hp: def.destructible?.hp ?? 0, broken: false, baseY: y, rise: a.rise };
      if (def.unique || kind === 'tumbleweed') {
        const mesh = kind === 'tumbleweed' ? new THREE.Mesh(v.geo, sharedVoxelMaterial) : (this.lodMesh(v, !!def.foliage) as unknown as THREE.Mesh);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(matrix);
        mesh.matrixWorldNeedsUpdate = true;
        this.group.add(mesh);
        inst.mesh = mesh;
        if (v.sm.rotor) {
          const rg = buildVoxelGeometry(v.sm.rotor, { voxelSize: v.sm.voxelSize, pivot: v.sm.rotorPivot ?? 'center' });
          const rm = new THREE.Mesh(rg, sharedVoxelMaterial);
          rm.castShadow = true;
          const at = v.sm.rotorAt ?? [0, v.height * 0.8, 0.5];
          rm.position.set(at[0], at[1], at[2]);
          mesh.matrixAutoUpdate = false;
          const holder = new THREE.Group();
          holder.matrixAutoUpdate = false;
          holder.matrix.copy(matrix);
          holder.add(rm);
          this.group.add(holder);
          this.rotors.push({ mesh: rm, speed: 1.2 + this.rng.next() });
        }
      } else {
        const bkey = z.index + ':' + kind + ':' + this.variantKey(v);
        let b = zoneBatches.get(bkey);
        if (!b) {
          const mat = def.foliage ? sharedFoliageMaterial : sharedVoxelMaterial;
          const cap = plan.filter((q) => q.v === v).length + 1;
          const near = new THREE.InstancedMesh(v.geo, mat, cap);
          const far = new THREE.InstancedMesh(this.lod(v), mat, cap);
          for (const im of [near, far]) {
            im.castShadow = true;
            im.receiveShadow = true;
            im.count = 0;
            this.group.add(im);
          }
          b = { v, near, far, insts: [], foliage: !!def.foliage };
          zoneBatches.set(bkey, b);
          this.batches.push(b);
        }
        inst.batch = b;
        inst.index = b.insts.length;
        b.insts.push(inst);
      }
      if (kind === 'tumbleweed') this.tumbleweeds.push({ inst, vel: new THREE.Vector3(), spin: 0 });
      else this.addColliders(inst, def, sc, rot, g, riseDepth > 0);
      if (kind === 'totem' && v.sm.anchor) {
        const an = v.sm.anchor;
        const c = this.world.colliders.circle(a.x + an[0], a.z + an[2], 0.8, y + an[1] - 1, y + an[1] + 1, { tag: 'grapple', solid: false, bullets: false });
        inst.colliders.push(c);
      }
      this.list.push(inst);
    }
    for (const b of zoneBatches.values()) this.layoutBatch(b, this.lastLodPos);
    console.log(`[props] zone ${z.index}: ${plan.length} props in ${(performance.now() - t0).toFixed(0)}ms`);
  }

  private vkeys = new Map<Variant, number>();
  private variantKey(v: Variant) {
    let k = this.vkeys.get(v);
    if (k === undefined) this.vkeys.set(v, (k = this.vkeys.size));
    return k;
  }

  /** split a batch's live instances into near / far instanced meshes and refresh bounds */
  private layoutBatch(b: Batch, focus: THREE.Vector3) {
    let n = 0, f = 0;
    const p = new THREE.Vector3();
    for (const inst of b.insts) {
      if (inst.broken) continue;
      p.setFromMatrixPosition(inst.matrix);
      const near = p.distanceTo(focus) < this.lodNear;
      if (near) b.near.setMatrixAt(n++, inst.matrix);
      else b.far.setMatrixAt(f++, inst.matrix);
    }
    b.near.count = n;
    b.far.count = f;
    b.near.instanceMatrix.needsUpdate = true;
    b.far.instanceMatrix.needsUpdate = true;
    b.near.computeBoundingSphere();
    b.far.computeBoundingSphere();
  }

  private addColliders(inst: PropInst, def: KindDef, sc: number, rot: number, g: number, buried: boolean) {
    const a = inst.anchor;
    const v = inst.variant;
    const cols = this.world.colliders;
    const data = def.destructible ? { destructible: true, hp: def.destructible.hp, material: def.destructible.material, prop: inst, onBreak: (spd: number, dir?: THREE.Vector3) => this.breakProp(inst, spd, dir) } : { material: (def as any).material ?? 'rock', prop: inst };
    const y0 = buried ? -1000 : g - 0.5, y1 = buried ? -999 : g + v.height * sc;
    if (def.solid === 'circle') {
      const r = Math.max(0.2, Math.min(v.halfX, v.halfZ) * sc * (def.radius ?? 0.6) * 1.4);
      inst.colliders.push(cols.circle(a.x, a.z, r, y0, y1, { data }));
    } else if (def.solid === 'box') {
      inst.colliders.push(cols.box(a.x, a.z, v.halfX * sc, v.halfZ * sc, -rot, y0, y1, { data }));
    } else if (def.solid === 'voxel') {
      for (const c of this.voxelColliders(v, a.x, a.z, rot, sc, y0, g)) {
        c.data = data;
        inst.colliders.push(c);
      }
    }
  }

  /** occupancy-cell colliders derived from the model's voxels */
  private voxelColliders(v: Variant, x: number, z: number, rot: number, sc: number, y0: number, g: number) {
    const vs = v.sm.voxelSize * sc;
    const b = v.sm.model.bounds();
    const cx = (b.minX + b.maxX + 1) / 2, cz = (b.minZ + b.maxZ + 1) / 2, by = b.minY;
    const cell = 1.0;
    const occ = new Map<string, number>(); // key -> top height
    for (const [k] of v.sm.model.map) {
      const [vx, vy, vz] = unkey(k);
      const ly = (vy - by) * vs;
      if (ly < 0.15 || ly > 2.6) continue;
      const lx = (vx + 0.5 - cx) * vs, lz = (vz + 0.5 - cz) * vs;
      const ix = Math.floor(lx / cell), iz = Math.floor(lz / cell);
      const key = ix + ',' + iz;
      const top = (vy - by + 1) * vs;
      occ.set(key, Math.max(occ.get(key) ?? 0, top));
    }
    // merge runs along x per row
    const rows = new Map<number, number[]>();
    for (const key of occ.keys()) {
      const [ix, iz] = key.split(',').map(Number);
      let r = rows.get(iz);
      if (!r) rows.set(iz, (r = []));
      r.push(ix);
    }
    const out: Collider[] = [];
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (const [iz, xs] of rows) {
      xs.sort((a, b) => a - b);
      let start = xs[0], prev = xs[0];
      const flush = (s: number, e: number) => {
        let top = 0;
        for (let i = s; i <= e; i++) top = Math.max(top, occ.get(i + ',' + iz) ?? 0);
        const lx = ((s + e + 1) / 2) * cell, lz = (iz + 0.5) * cell;
        const wx = x + lx * cs + lz * sn, wz = z - lx * sn + lz * cs;
        out.push(this.world.colliders.box(wx, wz, ((e - s + 1) * cell) / 2, cell / 2, -rot, y0, g + Math.max(1, top)));
      };
      for (let i = 1; i < xs.length; i++) {
        if (xs[i] !== prev + 1) {
          flush(start, prev);
          start = xs[i];
        }
        prev = xs[i];
      }
      flush(start, prev);
    }
    return out;
  }

  private addLandmark(z: ZoneDef, a: Anchor) {
    const type = a.data?.type as string;
    const mk = LANDMARKS[type];
    if (!mk) return;
    const t0 = performance.now();
    let sm: SM;
    try {
      sm = mk();
    } catch (e) {
      console.warn('[props] landmark failed', type, e);
      return;
    }
    const geo = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: 'bottom' });
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const v: Variant = { sm, geo, mesh: null, count: 1, cap: 1, height: bb.max.y - bb.min.y, halfX: (bb.max.x - bb.min.x) / 2, halfZ: (bb.max.z - bb.min.z) / 2 };
    const g = this.world.groundAt(a.x, a.z);
    // entrance faces zone center: model fronts face +Z -> rotate so +Z points along anchor rot
    const rot = Math.PI / 2 - (a.rot ?? 0);
    _q.setFromAxisAngle(UP, rot);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(a.x, g - 0.1, a.z), _q, new THREE.Vector3(1, 1, 1));
    const mesh = this.lodMesh(v, false, 70) as unknown as THREE.Mesh;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrix);
    mesh.matrixWorldNeedsUpdate = true;
    this.group.add(mesh);
    const inst: PropInst = { kind: 'landmark', anchor: a, zone: z.index, variant: v, index: -1, mesh, matrix, colliders: [], hp: 0, broken: false, baseY: g, extra: { type, meta: sm.meta, rot } };
    inst.colliders = this.voxelColliders(v, a.x, a.z, rot, 1, g - 0.5, g);
    this.list.push(inst);
    this.landmarks.push(inst);
    console.log(`[props] landmark ${type} built in ${(performance.now() - t0).toFixed(0)}ms`);
  }

  /** world position of a landmark-local point (meta.entrance etc.) */
  landmarkPoint(inst: PropInst, lx: number, lz: number) {
    const rot = inst.extra.rot;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    return new THREE.Vector3(inst.anchor.x + lx * cs + lz * sn, inst.baseY, inst.anchor.z - lx * sn + lz * cs);
  }

  breakProp(inst: PropInst, spd = 8, dir?: THREE.Vector3) {
    if (inst.broken) return;
    inst.broken = true;
    for (const c of inst.colliders) this.world.colliders.remove(c);
    if (inst.mesh) inst.mesh.visible = false;
    else if (inst.batch) this.layoutBatch(inst.batch, this.lastLodPos);
    this.onBreak?.(inst, spd, dir);
  }

  private dirtyBatches = new Set<Batch>();
  riseFor(stamp: string, k: number) {
    for (const p of this.list) {
      if (p.rise !== stamp) continue;
      const depth = (p.variant.height + 0.5) * (1 - k);
      const e = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      p.matrix.decompose(e, q, s);
      e.y = p.baseY - depth;
      p.matrix.compose(e, q, s);
      if (p.mesh) {
        p.mesh.matrix.copy(p.matrix);
        p.mesh.matrixWorldNeedsUpdate = true;
      } else if (p.batch) this.dirtyBatches.add(p.batch);
      if (k > 0.98 && !p.colliders.length) this.addColliders(p, KINDS[p.kind], s.x, Math.atan2(2 * (q.w * q.y), 1 - 2 * q.y * q.y), p.baseY, false);
    }
  }

  update(dt: number, focus: THREE.Vector3, wind: { x: number; z: number }, fx?: any) {
    if (focus.distanceTo(this.lastLodPos) > 8) {
      this.lastLodPos.copy(focus);
      for (const b of this.batches) this.layoutBatch(b, focus);
      this.dirtyBatches.clear();
    } else if (this.dirtyBatches.size) {
      for (const b of this.dirtyBatches) this.layoutBatch(b, this.lastLodPos);
      this.dirtyBatches.clear();
    }
    for (const r of this.rotors) r.mesh.rotation.z += r.speed * dt;
    // tumbleweeds roll with the wind and bounce over dunes
    for (const t of this.tumbleweeds) {
      const p = t.inst;
      if (p.broken || !p.mesh) continue;
      const pos = _p.setFromMatrixPosition(p.matrix);
      if (pos.distanceTo(focus) > 90) continue;
      t.vel.x += (wind.x * 4 - t.vel.x) * dt * 0.8 + (rnd.next() - 0.5) * dt * 2;
      t.vel.z += (wind.z * 4 - t.vel.z) * dt * 0.8 + (rnd.next() - 0.5) * dt * 2;
      t.vel.y -= 14 * dt;
      pos.addScaledVector(t.vel, dt);
      const g = this.world.groundAt(pos.x, pos.z) + 0.02;
      if (pos.y < g) {
        pos.y = g;
        t.vel.y = 1.5 + rnd.next() * 2.5;
      }
      if (this.world.storm.sdf(pos.x, pos.z) < 1) {
        t.vel.x *= -1;
        t.vel.z *= -1;
      }
      t.spin += Math.hypot(t.vel.x, t.vel.z) * dt * 1.6;
      _q.setFromEuler(new THREE.Euler(t.spin, Math.atan2(t.vel.x, t.vel.z), 0, 'YXZ'));
      p.matrix.compose(pos, _q, _s.setScalar(1));
      p.mesh.matrix.copy(p.matrix);
      if (fx && rnd.chance(dt * 3) && pos.y <= g + 0.05) fx.sandSpray(pos, { x: 0, y: 0, z: 0 }, 0.3);
    }
  }

  /** nearest tumbleweed to a point (for ram/shoot interactions) */
  tumbleweedAt(p: THREE.Vector3, r: number) {
    for (const t of this.tumbleweeds) {
      if (t.inst.broken) continue;
      const q = _p.setFromMatrixPosition(t.inst.matrix);
      if (q.distanceTo(p) < r) return t.inst;
    }
    return null;
  }
}
