// Variant model kit (STYLE v2): a tiny rig builder where every part is modelled
// in place in rig space (so attach == pivot), plus clean-shape helpers.
// Coordinates: voxel (x,y,z) occupies [x,x+1]. Symmetric models are centred on
// x = 0 in space, i.e. voxel x mirrors to -1 - x.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { TOON, Ramp, bevelBox, shadeRegion } from '../style';

export { VF, TOON };
export type { Ramp, V3 };

export interface VariantOpts {
  alpha?: boolean;
  variant?: number;
}

/** humanoid variants use the shared toon grid; beetles match it */
export const VS = 1 / 30;

const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });
/** extra ramps local to the variants */
export const VR = {
  shellBlue: ramp(0x3f6cc4, 0x2e5299, 0x6a94e6, 0x1d3466),
  bomb: ramp(0x34303a, 0x24212a, 0x4c4756, 0x15131a),
  cream: ramp(0xf4ead2, 0xd8c9a8, 0xfffaf0, 0xa8977a),
  pink: ramp(0xf08aa0, 0xcc6478, 0xffb4c4, 0x8a3446),
  ruby: ramp(0xd8334a, 0xa82034, 0xff6a7c, 0x6a1020),
  canvas: ramp(0xd2b98a, 0xb09668, 0xe8d4a8, 0x806a46),
  fuse: ramp(0xc9a46a, 0xa07e4a, 0xe2c48c, 0x6e5230),
  spark: ramp(0xffd24a, 0xff8a2a, 0xfff6b0, 0xd04a10),
};

/** map a left-side (+x) voxel x to the mirrored right side */
export const mx = (s: number, x: number) => (s > 0 ? x : -1 - x);

export class Part {
  m = new VoxelModel();
  constructor(public name: string, public parent: string | undefined, public pivot: V3) {}
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, f?: number) {
    this.m.box(x0, y0, z0, x1, y1, z1, c, f);
    return this;
  }
  /** box mirrored to side s (coords given for the left/+x side) */
  boxS(s: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, f?: number) {
    const a = mx(s, x0), b = mx(s, x1);
    this.m.box(Math.min(a, b), y0, z0, Math.max(a, b), y1, z1, c, f);
    return this;
  }
  bev(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, b = 1, f?: number) {
    bevelBox(this.m, x0, y0, z0, x1, y1, z1, c, b, f);
    return this;
  }
  set(x: number, y: number, z: number, c: number, f?: number) {
    this.m.set(x, y, z, c, f);
    return this;
  }
  /** set voxel on both sides (x given for the left side) */
  setM(x: number, y: number, z: number, c: number, f?: number) {
    this.m.set(x, y, z, c, f);
    this.m.set(-1 - x, y, z, c, f);
    return this;
  }
  del(x: number, y: number, z: number) {
    this.m.del(x, y, z);
    return this;
  }
  carve(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.m.del(x, y, z);
    return this;
  }
  /** recolour only existing voxels inside the box */
  paint(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, f?: number) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) if (this.m.has(x, y, z)) this.m.set(x, y, z, c, f ?? (this.m.get(x, y, z)! >>> 24));
    return this;
  }
  /** recolour voxels matching a predicate */
  paintIf(pred: (x: number, y: number, z: number, rgb: number) => boolean, c: number, f?: number) {
    const hits: [number, number, number, number][] = [];
    this.m.forEach((x, y, z, rgb, fl) => {
      if (pred(x, y, z, rgb)) hits.push([x, y, z, f ?? fl]);
    });
    for (const [x, y, z, fl] of hits) this.m.set(x, y, z, c, fl);
    return this;
  }
  /** clean voxel ball: includes voxels whose centre is within r of the (space) centre */
  ball(cx: number, cy: number, cz: number, r: number, c: number, f?: number, sy = 1) {
    const R = Math.ceil(r + 1);
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++)
      for (let y = Math.floor(cy - R * sy); y <= Math.ceil(cy + R * sy); y++)
        for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) {
          const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) / sy, dz = z + 0.5 - cz;
          if (dx * dx + dy * dy + dz * dz <= r * r) this.m.set(x, y, z, c, f);
        }
    return this;
  }
  /** hand-style shade: undersides -> shade, exposed top edges -> highlight (only base-coloured voxels) */
  shade(r: Ramp, opts: { hi?: boolean; under?: boolean } = {}) {
    const b = this.m.bounds();
    shadeRegion(this.m, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, r, opts);
    return this;
  }
  /** copy every voxel with x >= 0 onto the right side (-1 - x) */
  mirror() {
    const add: [number, number, number, number, number][] = [];
    this.m.forEach((x, y, z, rgb, fl) => {
      if (x >= 0) add.push([-1 - x, y, z, rgb, fl]);
    });
    for (const [x, y, z, c, fl] of add) this.m.set(x, y, z, c, fl);
    return this;
  }
}

export class RigB {
  parts: Part[] = [];
  sockets: NonNullable<RigSpec['sockets']> = {};
  constructor(public name: string, public vs = VS) {}
  part(name: string, parent: string | undefined, pivot: V3) {
    const p = new Part(name, parent, pivot);
    this.parts.push(p);
    return p;
  }
  get(name: string) {
    return this.parts.find((p) => p.name === name)!;
  }
  socket(name: string, part: string, at: V3, rot?: V3) {
    this.sockets[name] = { part, at, rot };
    return this;
  }
  build(meta: Record<string, any> = {}): RigSpec {
    const parts = this.parts
      .filter((p) => p.m.count > 0)
      .map((p) => ({ name: p.name, model: p.m, pivot: p.pivot, parent: p.parent, attach: p.pivot }));
    return { name: this.name, voxelSize: this.vs, parts, sockets: this.sockets, meta };
  }
}

/**
 * Eye sockets for a head facing +Z. (cx, cy) is the left eye centre in space,
 * faceZ the front face plane (space). Carves a 2-deep recess with dark inner walls
 * and adds `eye_l`/`eye_r` plug parts (pivot = socket centre at the face surface).
 */
export function eyeSockets(rb: RigB, head: Part, cx: number, cy: number, faceZ: number, w = 3, h = 3, dark: number = TOON.socket.base) {
  for (const s of [1, -1]) {
    const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
    const xa = mx(s, x0), xb = mx(s, x0 + w - 1);
    const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
    head.carve(lo, y0, faceZ - 2, hi, y0 + h - 1, faceZ - 1);
    // dark floor + dark lower half of the walls
    head.paint(lo, y0, faceZ - 3, hi, y0 + h - 1, faceZ - 3, TOON.socket.dark);
    head.paint(lo - 1, y0 - 1, faceZ - 2, hi + 1, y0 + h, faceZ - 2, dark);
    const pcx = s > 0 ? cx : -cx;
    const eye = rb.part(s > 0 ? 'eye_l' : 'eye_r', head.name, [pcx, cy, faceZ]);
    eye.box(lo, y0, faceZ - 2, hi, y0 + h - 1, faceZ - 2, dark);
  }
}

export { VoxelModel };
