export const TOON_KIT_READY = true;
// Shared cartoon humanoid kit (STYLE v2). Every humanoid in the game is built on
// this layout so they read as one family and animate identically.
//
// COORDINATES: all parts are authored in ONE rig-global voxel grid (1/30 m),
// origin on the ground between the feet, faces +Z, character LEFT = +X.
// Voxel index x covers [x, x+1) — the body's mirror plane is the centre of
// column 0, i.e. geometric x = 0.5. Use `mx()` to mirror an index, `mxg()` to
// mirror a geometric pivot. Each part's pivot == attach == its joint (geometric),
// so parts are simply cut from the same space.
//
// USAGE (enemies / variants):
//   const p = skeletonParts();                    // or build parts yourself with the builders below
//   p.head = ...; p.torso = clothTorso({ ramp: TOON.husk }); ...   // swap any part
//   return buildHumanoid({ name: 'husk', parts: p, extra: [{ name: 'gun', model, parent: 'fore_r', joint }],
//                          expressions: defaultExpressions([...]), meta: { ... } });
// Flesh faces: toonHead({ skin }) + joints: { eye: FACE_JOINT.eye, brow: FACE_JOINT.brow }.
// Layout (voxel rows): soles 0, knee 12, hips 20 (x=±3..4), waist 24, shoulders 32 (x=±7..9),
// elbow 25, fists 14..18, neck 34..38, head 39..51 (+ jaw 35..38). Hand socket = fist centre.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { PartSpec, RigSpec, SocketSpec, V3, ExpressionSpec } from '../../../engine/voxel/Rig';
import { TOON, Ramp, shadeRegion } from '../style';

export const TOON_VS = 1 / 30;

/** mirror a voxel index across the body plane */
export const mx = (x: number) => -x;
/** mirror a geometric (pivot) x across the body plane */
export const mxg = (x: number) => 1 - x;
export const mirrorV3 = (p: V3): V3 => [mxg(p[0]), p[1], p[2]];

/** standard joints (geometric coords, LEFT side where it matters) */
export const JOINT = {
  pelvis: [0.5, 21, 0] as V3,
  waist: [0.5, 24, -0.5] as V3,
  neck: [0.5, 38, -2] as V3,
  jaw: [0.5, 39, 0] as V3,
  eye: [4, 44, 7] as V3,
  brow: [4, 46.5, 7.5] as V3,
  hat: [0.5, 48, 0] as V3,
  shoulder: [8, 32, 0] as V3,
  elbow: [8, 25, 0] as V3,
  hand: [8.5, 16.5, 0.5] as V3,
  hip: [4, 20, 0] as V3,
  knee: [4, 12, 0] as V3,
};
export type JointName = keyof typeof JOINT;

/** mirrored copy of a model (left side -> right side) */
export function mirrored(src: VoxelModel, name?: string) {
  const out = new VoxelModel(name ?? src.name + '_r');
  src.forEach((x, y, z, rgb, flags) => out.set(-x, y, z, rgb, flags));
  return out;
}

/** box with its four vertical (Y) edges cut: a clean rounded block */
export function roundBox(m: VoxelModel, ax: number, ay: number, az: number, bx: number, by: number, bz: number, col: number, cut = 1, flags?: number) {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const dx = Math.min(x - x0, x1 - x), dz = Math.min(z - z0, z1 - z);
      if (dx + dz < cut) continue;
      for (let y = y0; y <= y1; y++) m.set(x, y, z, col, flags);
    }
  return m;
}

/** box with edges cut around the X axis (for horizontal bars seen from the front) */
export function roundBoxX(m: VoxelModel, ax: number, ay: number, az: number, bx: number, by: number, bz: number, col: number, cut = 1, flags?: number) {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++) {
      const dy = Math.min(y - y0, y1 - y), dz = Math.min(z - z0, z1 - z);
      if (dy + dz < cut) continue;
      for (let x = x0; x <= x1; x++) m.set(x, y, z, col, flags);
    }
  return m;
}

/** hand shading for every listed ramp over the whole model (top-edge highlights, underside shade) */
export function autoShade(m: VoxelModel, ramps: Ramp[], opts: { hi?: boolean; under?: boolean } = {}) {
  const b = m.bounds();
  for (const r of ramps) shadeRegion(m, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, r, opts);
  return m;
}

// ============================================================== HEAD
export interface SkullOpts {
  ramp?: Ramp;
  socket?: Ramp;
  /** 'grin' (two teeth rows), 'smile' (closed teeth), 'fangs' */
  mouth?: 'grin' | 'smile' | 'fangs';
  /** forehead crack on the left temple */
  crack?: boolean;
  /** extra wide cartoon cranium (+1 each side) */
  wide?: boolean;
}
export interface SkullParts {
  head: VoxelModel;
  jaw: VoxelModel;
  eye_l: VoxelModel;
  eye_r: VoxelModel;
  brow_l: VoxelModel;
  brow_r: VoxelModel;
}

/** cranium cross-section per row: [halfX, zBack, zFront, cornerCut] */
const CRANIUM: Record<number, [number, number, number, number]> = {
  40: [6, -6, 6, 1],
  41: [6, -6, 6, 1],
  42: [7, -7, 6, 2],
  43: [7, -7, 6, 1],
  44: [7, -7, 6, 1],
  45: [7, -7, 6, 1],
  46: [7, -7, 6, 1],
  47: [7, -7, 6, 1],
  48: [7, -7, 6, 1],
  49: [7, -7, 6, 2],
  50: [6, -6, 5, 2],
  51: [5, -5, 4, 2],
};

export function toonSkull(o: SkullOpts = {}): SkullParts {
  const B = o.ramp ?? TOON.bone;
  const S = o.socket ?? TOON.socket;
  const W = o.wide ? 1 : 0;
  const head = new VoxelModel('head');
  for (const [ys, [hx0, zb, zf, cut]] of Object.entries(CRANIUM)) {
    const y = +ys;
    const hx = hx0 + (hx0 >= 6 ? W : 0);
    for (let x = -hx; x <= hx; x++)
      for (let z = zb; z <= zf; z++) {
        const dx = hx - Math.abs(x), dzF = zf - z, dzB = z - zb;
        if (dx + Math.min(dzF, dzB) < cut) continue;
        head.set(x, y, z, B.base);
      }
  }
  // maxilla + upper teeth row (y=39)
  for (let x = -4; x <= 4; x++) for (let z = -3; z <= 6; z++) head.set(x, 39, z, B.base);
  // atlas vertebra under the skull (connects to the neck)
  roundBox(head, -1, 38, -4, 1, 39, -2, B.shade);
  // mouth interior (only seen when the jaw opens)
  for (let x = -3; x <= 3; x++) for (let z = -2; z <= 5; z++) head.set(x, 39, z, S.base);
  // upper teeth
  for (let x = -4; x <= 4; x++) head.set(x, 39, 6, Math.abs(x) % 2 === 1 ? B.shade : B.hi);
  // eye sockets 4x4, 2 deep, dark walls
  for (const side of [1, -1]) {
    for (let i = 2; i <= 5; i++)
      for (let y = 42; y <= 45; y++) {
        const x = side * i;
        head.del(x, y, 6).del(x, y, 5);
        head.set(x, y, 4, S.dark);
      }
    // socket walls one shade lighter so the hole reads with depth
    for (let i = 2; i <= 5; i++) {
      head.set(side * i, 46, 5, S.base).set(side * i, 41, 5, S.shade);
    }
    for (let y = 42; y <= 45; y++) head.set(side * 1, y, 5, S.base).set(side * 6, y, 5, S.base);
  }
  // nose: inverted triangle
  for (const [x, y] of [[0, 41], [1, 41], [-1, 41], [0, 40]] as [number, number][]) {
    head.del(x, y, 6);
    head.set(x, y, 5, S.dark);
  }
  if (o.crack) {
    for (const [x, y] of [[4, 50], [5, 49], [5, 48], [6, 47]] as [number, number][]) {
      const zf = CRANIUM[y][2];
      head.set(x, y, zf, B.dark);
    }
  }
  autoShade(head, [B]);

  // ---------------------------------------------------------- jaw (mandible)
  const jaw = new VoxelModel('jaw');
  roundBox(jaw, -4, 35, 1, 4, 35, 6, B.base, 2); // chin underside
  roundBox(jaw, -5, 36, -1, 5, 37, 6, B.base, 2);
  // rami up to the hinge
  for (const side of [1, -1]) roundBox(jaw, side * 5, 38, -1, side * 5, 38, 3, B.base, 0);
  // inside of the mouth (dark tongue bed) + lower teeth
  for (let x = -3; x <= 3; x++) for (let z = 0; z <= 5; z++) jaw.set(x, 37, z, S.base);
  for (let x = -3; x <= 3; x++) jaw.set(x, 37, 6, Math.abs(x) % 2 === 1 ? B.shade : B.hi);
  if (o.mouth === 'fangs') {
    head.set(-3, 38, 6, B.hi).set(3, 38, 6, B.hi);
  }
  autoShade(jaw, [B], { hi: false });

  // ---------------------------------------------------------- eye plugs (engine draws 2D eyes here)
  const eye_l = new VoxelModel('eye_l');
  for (let i = 2; i <= 5; i++) for (let y = 42; y <= 45; y++) eye_l.set(i, y, 5, S.dark);
  const eye_r = mirrored(eye_l, 'eye_r');

  // ---------------------------------------------------------- brow ridges (separate so they can tilt)
  const brow_l = new VoxelModel('brow_l');
  for (let i = 1; i <= 5; i++) brow_l.set(i, 46, 7, i === 1 ? B.shade : B.base);
  const brow_r = mirrored(brow_l, 'brow_r');
  return { head, jaw, eye_l, eye_r, brow_l, brow_r };
}

// ============================================================== FLESH HEAD
export interface FaceHeadOpts {
  skin: Ramp;
  /** 'big' bulb nose, 'small', 'snout' (2-deep), 'none' */
  nose?: 'big' | 'small' | 'snout' | 'none';
  ears?: boolean;
  /** brow colour (bushy brows); defaults to skin.dark */
  brow?: number;
  /** eye plug colour (hidden at runtime, engine draws 2D eyes) */
  eyeCol?: number;
  /** mouth line on the jaw */
  mouth?: boolean;
  lips?: number;
}
/**
 * Cartoon flesh head (same footprint as the skull: y 36..51, x -7..7, faces +Z).
 * Returns head (cranium + upper face), jaw (chin), eye plugs (3x3 at face surface)
 * and bushy brow parts. Same joints as toonSkull (JOINT.eye / brow / jaw).
 */
export function toonHead(o: FaceHeadOpts): SkullParts {
  const K = o.skin;
  const head = new VoxelModel('head');
  for (let y = 39; y <= 51; y++) {
    const hx = y >= 51 ? 5 : y >= 50 ? 6 : 7;
    const zb = y >= 51 ? -5 : y >= 50 ? -6 : -7;
    const zf = y >= 51 ? 4 : y >= 50 ? 5 : 6;
    const cut = y >= 49 || y <= 40 ? 2 : 1;
    for (let x = -hx; x <= hx; x++)
      for (let z = zb; z <= zf; z++) {
        const dx = hx - Math.abs(x), dz = Math.min(z - zb, zf - z);
        if (dx + dz < cut) continue;
        head.set(x, y, z, K.base);
      }
  }
  roundBox(head, -1, 37, -4, 1, 38, -2, K.shade, 0); // neck stub
  // nose
  const nose = o.nose ?? 'small';
  if (nose === 'big') {
    roundBox(head, -1, 40, 7, 1, 43, 8, K.base, 1);
    head.set(0, 40, 9, K.hi).set(0, 41, 9, K.base).set(-1, 40, 8, K.shade).set(1, 40, 8, K.shade);
  } else if (nose === 'small') {
    head.set(0, 41, 7, K.base).set(0, 42, 7, K.base);
  } else if (nose === 'snout') {
    roundBox(head, -2, 39, 7, 2, 42, 9, K.base, 1);
    head.set(-1, 41, 10, K.dark).set(1, 41, 10, K.dark);
  }
  if (o.ears !== false) for (const s of [1, -1]) roundBox(head, s * 8, 41, -1, s * 8, 44, 1, K.shade, 1);
  // cheeks
  for (const s of [1, -1]) head.set(s * 5, 41, 7, K.hi === K.base ? K.base : mixHi(K));
  // jaw / chin
  const jaw = new VoxelModel('jaw');
  roundBox(jaw, -5, 35, -1, 5, 38, 6, K.base, 2);
  if (o.mouth !== false) for (let x = -2; x <= 2; x++) jaw.set(x, 38, 6, o.lips ?? K.dark);
  autoShade(head, [K], { hi: false });
  autoShade(jaw, [K], { hi: false });
  const eye_l = new VoxelModel('eye_l');
  for (let i = 2; i <= 4; i++) for (let y = 43; y <= 45; y++) eye_l.set(i, y, 7, o.eyeCol ?? 0xf6f0e4);
  const eye_r = mirrored(eye_l, 'eye_r');
  const brow_l = new VoxelModel('brow_l');
  for (let i = 1; i <= 5; i++) brow_l.set(i, 46, 7, o.brow ?? K.dark).set(i, 47, 7, i >= 2 && i <= 4 ? (o.brow ?? K.dark) : K.base);
  const brow_r = mirrored(brow_l, 'brow_r');
  return { head, jaw, eye_l, eye_r, brow_l, brow_r };
}
function mixHi(K: Ramp) {
  const a = K.base, b = 0xf08a7a;
  const r = (((a >> 16) & 255) * 0.6 + ((b >> 16) & 255) * 0.4) | 0, g = (((a >> 8) & 255) * 0.6 + ((b >> 8) & 255) * 0.4) | 0, bl = ((a & 255) * 0.6 + (b & 255) * 0.4) | 0;
  return (r << 16) | (g << 8) | bl;
}
/** flesh-head joints: eyes sit ON the face (3x3 plugs centred at x=±3.5) */
export const FACE_JOINT = { eye: [3.5, 44.5, 8] as V3, brow: [3.5, 46.5, 7.5] as V3 };

// ============================================================== TORSO
export interface RibOpts {
  ramp?: Ramp;
  /** skip ribs (e.g. covered by clothing) — keeps spine/neck/clavicles */
  ribs?: boolean;
  scapula?: boolean;
}

/** rib cage + spine + neck + clavicles (torso part; pivot = JOINT.waist) */
export function ribCage(o: RibOpts = {}) {
  const B = o.ramp ?? TOON.bone;
  const m = new VoxelModel('torso');
  // spine: vertebra blocks with seams, at the back
  for (let y = 24; y <= 33; y++) {
    const seam = y % 2 === 1;
    for (let x = -1; x <= 1; x++) for (let z = -4; z <= -3; z++) if (!(seam && Math.abs(x) === 1)) m.set(x, y, z, seam ? B.shade : B.base);
  }
  // neck vertebrae
  for (let y = 34; y <= 37; y++) {
    const seam = y % 2 === 1;
    for (let x = -1; x <= 1; x++) for (let z = -4; z <= -2; z++) if (!(seam && Math.abs(x) === 1)) m.set(x, y, z, seam ? B.shade : B.base);
  }
  // clavicles + shoulder caps
  roundBoxX(m, -6, 33, -1, 6, 33, 1, B.base, 0);
  for (const side of [1, -1]) roundBox(m, side * 5, 32, -2, side * 6, 33, 1, B.base, 1);
  if (o.ribs !== false) {
    // rib rings (1 voxel shell), gaps between rows
    const rows: [number, number, number, number][] = [
      // y, halfX, zBack, zFront
      [31, 6, -4, 3],
      [29, 6, -4, 3],
      [27, 5, -4, 3],
      [25, 4, -3, 2],
    ];
    for (const [y, hx, zb, zf] of rows) {
      for (let x = -hx; x <= hx; x++)
        for (let z = zb; z <= zf; z++) {
          const edge = Math.abs(x) === hx || z === zb || z === zf;
          if (!edge) continue;
          // rounded corners
          if (Math.abs(x) === hx && (z === zb || z === zf)) continue;
          // floating rib gap in front of the lowest row
          if (y === 25 && z === zf && Math.abs(x) <= 1) continue;
          m.set(x, y, z, B.base);
        }
    }
    // sternum
    for (let y = 27; y <= 32; y++) for (let x = -1; x <= 1; x++) m.set(x, y, 3, y === 32 ? B.base : B.hi);
    m.set(0, 26, 3, B.hi);
  }
  if (o.scapula !== false) {
    for (const side of [1, -1]) roundBox(m, side * 3, 28, -5, side * 5, 31, -5, B.base, 1);
  }
  autoShade(m, [B], { hi: false });
  return m;
}

/** chunky pelvis (root part; pivot = JOINT.pelvis) */
export function toonPelvis(o: { ramp?: Ramp } = {}) {
  const B = o.ramp ?? TOON.bone;
  const m = new VoxelModel('pelvis');
  // sacrum / lumbar
  roundBox(m, -1, 19, -4, 1, 23, -2, B.base, 0);
  // iliac wings (flared bowl)
  for (const side of [1, -1]) {
    roundBox(m, side * 2, 21, -3, side * 5, 23, 0, B.base, 1);
    m.set(side * 6, 23, -2, B.base).set(side * 6, 23, -1, B.base);
  }
  // pubic bar
  roundBoxX(m, -2, 18, 0, 2, 19, 1, B.base, 1);
  autoShade(m, [B], { hi: true });
  return m;
}

// ============================================================== LIMBS
/** 4x?x4 knob with its vertical corners cut (a knuckle-like joint) */
export function knob(m: VoxelModel, cx0: number, y0: number, cz0: number, y1: number, col: number, w = 4, d = 4) {
  return roundBox(m, cx0, y0, cz0, cx0 + w - 1, y1, cz0 + d - 1, col, 1);
}

/** upper arm bone (LEFT; mirror for right). Part pivot = JOINT.shoulder */
export function boneUpperArm(o: { ramp?: Ramp } = {}) {
  const B = o.ramp ?? TOON.bone;
  const m = new VoxelModel('arm_l');
  roundBox(m, 7, 31, -1, 9, 33, 1, B.base, 1); // humerus head
  for (let y = 27; y <= 30; y++) for (let x = 7; x <= 8; x++) for (let z = -1; z <= 0; z++) m.set(x, y, z, B.base);
  knob(m, 6, 25, -2, 26, B.base); // elbow
  autoShade(m, [B], { hi: false });
  return m;
}

export interface HandOpts {
  ramp?: Ramp;
  /** 'fist' (gripping, gun hand) or 'open' (relaxed with fingers) */
  pose?: 'fist' | 'open';
  /** extra knuckle ridge colour */
  knuckle?: number;
}
/** chunky cartoon hand (LEFT side coords: x 5..10, y 14..18 by default). */
export function toonHand(m: VoxelModel, o: HandOpts & { y0?: number } = {}) {
  const B = o.ramp ?? TOON.bone;
  const pose = o.pose ?? 'fist';
  const b = (o.y0 ?? 14) - 12; // offset from the authoring layout (y 12..17)
  const s = (x: number, y: number, z: number, c: number) => m.set(x, y + b, z, c);
  // wrist
  roundBox(m, 7, 17 + b, -1, 8, 17 + b, 0, B.shade, 0);
  // palm block
  roundBox(m, 6, 13 + b, -2, 10, 16 + b, 2, B.base, 1);
  if (pose === 'fist') {
    // curled fingers: knuckle row on top-front, finger seams, curled tips underneath
    for (let y = 12; y <= 15; y++) for (let x = 7; x <= 10; x++) s(x, y, 3, y === 15 ? (o.knuckle ?? B.hi) : B.base);
    for (let x = 7; x <= 10; x++) for (let z = -1; z <= 2; z++) s(x, 12, z, B.base);
    for (const y of [13, 14]) s(8, y, 3, B.shade), s(10, y, 3, B.shade);
    // thumb on the inner side wrapping the front
    roundBox(m, 5, 13 + b, 0, 5, 15 + b, 3, B.base, 1);
    s(5, 14, 3, B.hi);
  } else {
    // open hand: four chunky fingers hanging down
    for (const [x, len] of [[7, 3], [8, 4], [9, 4], [10, 3]] as [number, number][])
      for (let i = 0; i < len; i++) for (let z = 0; z <= 1; z++) s(x, 12 - i, z, i === len - 1 ? B.shade : B.base);
    roundBox(m, 5, 13 + b, 0, 5, 15 + b, 2, B.base, 0);
  }
  return m;
}

/** forearm bones + hand (LEFT). Part pivot = JOINT.elbow */
export function boneForearm(o: HandOpts = {}) {
  const B = o.ramp ?? TOON.bone;
  const m = new VoxelModel('fore_l');
  knob(m, 6, 23, -2, 24, B.base);
  // radius + ulna: two slim bones with a gap between
  for (let y = 20; y <= 22; y++) {
    m.set(7, y, -1, B.base).set(7, y, 0, B.base);
    m.set(9, y, -1, B.shade).set(9, y, 0, B.base);
  }
  toonHand(m, o);
  autoShade(m, [B], { hi: false });
  return m;
}

/** femur (LEFT). Part pivot = JOINT.hip */
export function boneThigh(o: { ramp?: Ramp } = {}) {
  const B = o.ramp ?? TOON.bone;
  const m = new VoxelModel('thigh_l');
  roundBox(m, 3, 19, -1, 4, 20, 0, B.base, 0); // femur head
  m.set(2, 20, -1, B.base).set(2, 20, 0, B.base);
  for (let y = 14; y <= 18; y++) for (let x = 3; x <= 4; x++) for (let z = -1; z <= 0; z++) m.set(x, y, z, B.base);
  knob(m, 2, 12, -2, 13, B.base); // knee condyles
  m.set(3, 13, 2, B.hi).set(4, 13, 2, B.hi); // kneecap
  m.set(3, 12, 2, B.base).set(4, 12, 2, B.base);
  autoShade(m, [B], { hi: false });
  return m;
}

/** bare skeletal foot (LEFT): x 2..5, y 0..2, toes forward */
export function boneFoot(m: VoxelModel, o: { ramp?: Ramp } = {}) {
  const B = o.ramp ?? TOON.bone;
  roundBox(m, 2, 2, -2, 5, 3, 1, B.base, 1); // ankle / heel block
  roundBox(m, 2, 0, -2, 5, 1, 3, B.base, 1);
  // toes
  for (let x = 2; x <= 5; x++) m.set(x, 0, 4, x % 2 === 0 ? B.base : B.shade).set(x, 1, 4, B.hi);
  return m;
}

/** shin + foot (LEFT). Part pivot = JOINT.knee. `foot` builds the foot/boot (default bare bone) */
export function boneShin(o: { ramp?: Ramp; foot?: (m: VoxelModel) => void } = {}) {
  const B = o.ramp ?? TOON.bone;
  const m = new VoxelModel('shin_l');
  knob(m, 2, 10, -2, 11, B.base);
  for (let y = 4; y <= 9; y++) for (let x = 3; x <= 4; x++) for (let z = -1; z <= 0; z++) m.set(x, y, z, B.base);
  if (o.foot) o.foot(m);
  else boneFoot(m, o);
  autoShade(m, [B], { hi: false });
  return m;
}

// ============================================================== CLOTHING / FLESH HELPERS
/**
 * Boot (LEFT): toe forward, heel block, shaft up to `shaftTop`. Classic cowboy
 * boot silhouette: pointed toe step, raised heel, pull tab, stitched shaft.
 */
export function cowboyBoot(m: VoxelModel, o: { ramp?: Ramp; sole?: Ramp; stitch?: number; shaftTop?: number; spur?: Ramp | null } = {}) {
  const L = o.ramp ?? TOON.leather;
  const So = o.sole ?? TOON.leatherDark;
  const top = o.shaftTop ?? 7;
  // sole + heel
  for (let x = 2; x <= 5; x++) for (let z = -3; z <= 4; z++) m.set(x, 0, z, So.base);
  roundBox(m, 2, 0, -3, 5, 1, -2, So.base, 0); // heel
  // foot
  roundBox(m, 2, 1, -3, 5, 2, 3, L.base, 1);
  for (let x = 3; x <= 4; x++) m.set(x, 1, 4, L.base); // pointed toe
  m.set(3, 0, 5, So.base).set(4, 0, 5, So.base);
  // shaft
  roundBox(m, 2, 3, -2, 5, top, 1, L.base, 1);
  // cuff band + pull tabs
  for (let x = 2; x <= 5; x++) for (let z = -2; z <= 1; z++) if (m.has(x, top, z)) m.set(x, top, z, L.hi);
  m.set(2, top + 1, -0, L.shade).set(5, top + 1, 0, L.shade);
  // decorative stitch on the shaft (front + outer side)
  const st = o.stitch ?? TOON.linen.shade;
  for (const [x, y, z] of [[3, 5, 2], [4, 6, 2], [4, 5, 2], [3, 6, 2]] as [number, number, number][]) if (y < top) m.set(x, y, z, st);
  // spur
  if (o.spur !== null) {
    const S = o.spur ?? TOON.silver;
    m.set(3, 2, -4, S.shade).set(4, 2, -4, S.shade);
    m.set(3, 2, -5, S.base).set(4, 2, -5, S.base);
    m.set(3, 3, -6, S.hi).set(4, 1, -6, S.hi).set(3, 1, -6, S.base).set(4, 3, -6, S.base); // star rowel
  }
  autoShade(m, [L, So]);
  return m;
}

/** cloth/flesh torso block (pivot waist): a clean rounded box with optional open front */
export function clothTorso(o: { ramp: Ramp; y0?: number; y1?: number; halfX?: number; zBack?: number; zFront?: number; openFront?: number; collar?: Ramp; belly?: number }) {
  const R = o.ramp;
  const m = new VoxelModel('torso');
  const y0 = o.y0 ?? 24, y1 = o.y1 ?? 33, hx = o.halfX ?? 6, zb = o.zBack ?? -4, zf = o.zFront ?? 3;
  roundBox(m, -hx, y0, zb, hx, y1, zf, R.base, 1);
  // shoulder slope
  for (let z = zb; z <= zf; z++) m.del(-hx, y1, z).del(hx, y1, z);
  if (o.belly) roundBox(m, -hx + 1, y0, zf + 1, hx - 1, y0 + o.belly, zf + 1, R.base, 1);
  if (o.openFront) for (let y = y0; y <= y1; y++) for (let x = -o.openFront + 1; x <= o.openFront - 1; x++) m.del(x, y, zf);
  if (o.collar) roundBoxX(m, -hx + 2, y1 + 1, zb + 1, hx - 2, y1 + 1, zf - 1, o.collar.base, 1);
  autoShade(m, [R]);
  return m;
}

/** sleeve / limb sheath around a vertical segment (LEFT coords), e.g. upper arm x 6..9 */
export function sleeve(m: VoxelModel, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, R: Ramp, cuff?: Ramp) {
  roundBox(m, x0, y0, z0, x1, y1 - 1, z1, R.base, 1);
  roundBox(m, x0, y1, z0 + 1, x1 - 1, y1, z1 - 1, R.base, 1); // rounded shoulder cap
  if (cuff) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (m.has(x, y0, z)) m.set(x, y0, z, cuff.base);
  return m;
}

/** trouser leg segments (LEFT): thigh covers y 12..20, shin y 3..11 */
export function pantLeg(seg: 'thigh' | 'shin', R: Ramp, o: { hem?: Ramp; patch?: Ramp } = {}) {
  const m = new VoxelModel(seg === 'thigh' ? 'thigh_l' : 'shin_l');
  if (seg === 'thigh') {
    roundBox(m, 2, 12, -2, 5, 20, 1, R.base, 1);
    if (o.patch) for (let y = 14; y <= 16; y++) for (let x = 3; x <= 4; x++) m.set(x, y, 2, o.patch.base);
  } else {
    roundBox(m, 2, 3, -2, 5, 11, 1, R.base, 1);
    if (o.hem) for (let x = 2; x <= 5; x++) for (let z = -2; z <= 1; z++) if (m.has(x, 3, z)) m.set(x, 3, z, o.hem.base);
  }
  autoShade(m, [R]);
  return m;
}

// ============================================================== ASSEMBLY
export interface HumanoidParts {
  pelvis: VoxelModel;
  torso: VoxelModel;
  head: VoxelModel;
  jaw?: VoxelModel;
  eye_l?: VoxelModel;
  eye_r?: VoxelModel;
  brow_l?: VoxelModel;
  brow_r?: VoxelModel;
  hat?: VoxelModel;
  arm_l: VoxelModel;
  fore_l: VoxelModel;
  arm_r: VoxelModel;
  fore_r: VoxelModel;
  thigh_l: VoxelModel;
  shin_l: VoxelModel;
  thigh_r: VoxelModel;
  shin_r: VoxelModel;
}
export interface ExtraPart {
  name: string;
  model: VoxelModel;
  parent: string;
  joint: V3;
  rest?: V3;
}
export interface HumanoidSpec {
  name: string;
  parts: HumanoidParts;
  extra?: ExtraPart[];
  /** joint overrides (geometric, left side); right side is mirrored */
  joints?: Partial<Record<JointName, V3>>;
  sockets?: Record<string, SocketSpec>;
  meta?: Record<string, unknown>;
  expressions?: Record<string, ExpressionSpec>;
  voxelSize?: number;
  /** top of the head / hat (voxels) for meta.height */
  topY?: number;
  /** extra uniform scale applied to every coordinate (bosses): pass e.g. 2 to double size */
  radius?: number;
}

/** default expression set (jaw + brows; eyes are engine-drawn 2D) */
export function defaultExpressions(names: string[]): Record<string, ExpressionSpec> {
  const jaw: Record<string, number> = { neutral: 0, focus: 0, smug: 0.05, surprised: 0.42, hurt: 0.2, angry: 0.08, laugh: 0.3, wink: 0.04, dead: 0.4, determined: 0, enraged: 0.25, stunned: 0.3, defeated: 0.35, happy: 0.18, sad: 0.05, scared: 0.3, snarl: 0.18, bored: 0.02, squinty: 0.02, sleepy: 0.06, sing: 0.3, judging: 0 };
  const brow: Record<string, [number, number]> = {
    neutral: [0, 0],
    focus: [0.16, -0.16],
    smug: [0.05, -0.3],
    surprised: [-0.32, 0.32],
    hurt: [-0.34, 0.34],
    angry: [0.45, -0.45],
    laugh: [-0.14, 0.14],
    wink: [0.22, 0],
    dead: [-0.1, 0.2],
    determined: [0.26, -0.26],
    enraged: [0.55, -0.55],
    stunned: [-0.2, 0.3],
    defeated: [-0.3, 0.3],
    happy: [-0.18, 0.18],
    sad: [-0.36, 0.36],
    scared: [-0.38, 0.38],
    snarl: [0.4, -0.4],
    bored: [0.1, -0.1],
    squinty: [0.2, -0.2],
    sleepy: [0.1, -0.1],
    sing: [-0.2, 0.2],
    judging: [0.25, -0.05],
  };
  const out: Record<string, ExpressionSpec> = {};
  for (const n of names) out[n] = { jaw: jaw[n] ?? 0, brow: brow[n] ?? [0, 0] };
  return out;
}

/** assemble a humanoid RigSpec from parts authored in the shared rig space */
export function buildHumanoid(h: HumanoidSpec): RigSpec {
  const J = { ...JOINT, ...(h.joints ?? {}) } as Record<JointName, V3>;
  const R = (p: V3) => mirrorV3(p);
  const P = h.parts;
  const part = (name: string, model: VoxelModel, joint: V3, parent?: string, rest?: V3): PartSpec => ({ name, model, pivot: joint, attach: joint, parent, rest });
  const eyeR: V3 = R(J.eye);
  const browR: V3 = R(J.brow);
  const parts: PartSpec[] = [
    part('pelvis', P.pelvis, J.pelvis),
    part('torso', P.torso, J.waist, 'pelvis'),
    part('head', P.head, J.neck, 'torso'),
  ];
  if (P.jaw) parts.push(part('jaw', P.jaw, J.jaw, 'head'));
  if (P.eye_l) parts.push(part('eye_l', P.eye_l, J.eye, 'head'));
  if (P.eye_r) parts.push(part('eye_r', P.eye_r, eyeR, 'head'));
  if (P.brow_l) parts.push(part('brow_l', P.brow_l, J.brow, 'head'));
  if (P.brow_r) parts.push(part('brow_r', P.brow_r, browR, 'head'));
  if (P.hat) parts.push(part('hat', P.hat, J.hat, 'head'));
  parts.push(
    part('arm_l', P.arm_l, J.shoulder, 'torso'),
    part('fore_l', P.fore_l, J.elbow, 'arm_l'),
    part('arm_r', P.arm_r, R(J.shoulder), 'torso'),
    part('fore_r', P.fore_r, R(J.elbow), 'arm_r'),
    part('thigh_l', P.thigh_l, J.hip, 'pelvis'),
    part('shin_l', P.shin_l, J.knee, 'thigh_l'),
    part('thigh_r', P.thigh_r, R(J.hip), 'pelvis'),
    part('shin_r', P.shin_r, R(J.knee), 'thigh_r'),
  );
  for (const e of h.extra ?? []) parts.push(part(e.name, e.model, e.joint, e.parent, e.rest));
  // empty models break the mesher bounds: drop them
  const valid = parts.filter((p) => p.model.count > 0);
  const vs = h.voxelSize ?? TOON_VS;
  const top = h.topY ?? 52;
  const hand = J.hand;
  const sockets: Record<string, SocketSpec> = {
    // identity rotation: gameplay adds its own holder for guns
    hand_r: { part: 'fore_r', at: R(hand) },
    hand_l: { part: 'fore_l', at: hand },
    head_top: { part: 'head', at: [0.5, 52, 0] },
    back: { part: 'torso', at: [0.5, 29, -5] },
    shoulder_l: { part: 'torso', at: [7.5, 34.5, -0.5] },
    shoulder_r: { part: 'torso', at: [-6.5, 34.5, -0.5] },
    hip_r: { part: 'pelvis', at: [-5.5, 21, 0.5] },
    chest: { part: 'torso', at: [0.5, 29, 4.5] },
    eye_l: { part: 'head', at: J.eye },
    eye_r: { part: 'head', at: eyeR },
    mouth: { part: P.jaw ? 'jaw' : 'head', at: [0.5, 38, 7] },
    ...(h.sockets ?? {}),
  };
  const m = (p: V3) => [p[0] * vs, p[1] * vs, p[2] * vs];
  return {
    name: h.name,
    voxelSize: vs,
    parts: valid,
    sockets,
    meta: {
      height: top * vs,
      radius: h.radius ?? 0.3,
      hipY: J.hip[1] * vs,
      kneeY: J.knee[1] * vs,
      shoulderY: J.shoulder[1] * vs,
      elbowY: J.elbow[1] * vs,
      handY: hand[1] * vs,
      upperArmLen: (J.shoulder[1] - J.elbow[1]) * vs,
      foreArmLen: (J.elbow[1] - hand[1]) * vs,
      legLen: J.hip[1] * vs,
      facePivots: { eye_l: m(J.eye), eye_r: m(eyeR), brow_l: m(J.brow), brow_r: m(browR), jaw: m(J.jaw) },
      expressions: h.expressions ?? defaultExpressions(['neutral', 'angry', 'hurt', 'surprised', 'laugh', 'dead']),
      ...(h.meta ?? {}),
    },
  };
}

/** a complete bare toon skeleton (useful base for enemies): returns parts to customise before buildHumanoid */
export function skeletonParts(o: { ramp?: Ramp; socket?: Ramp; skull?: SkullOpts; handL?: HandOpts; handR?: HandOpts } = {}): HumanoidParts {
  const sk = toonSkull({ ramp: o.ramp, socket: o.socket, ...(o.skull ?? {}) });
  const arm = boneUpperArm({ ramp: o.ramp });
  const thigh = boneThigh({ ramp: o.ramp });
  const shin = boneShin({ ramp: o.ramp });
  const foreL = boneForearm({ ramp: o.ramp, ...(o.handL ?? {}) });
  const foreR = mirrored(boneForearm({ ramp: o.ramp, ...(o.handR ?? {}) }), 'fore_r');
  return {
    pelvis: toonPelvis({ ramp: o.ramp }),
    torso: ribCage({ ramp: o.ramp }),
    head: sk.head,
    jaw: sk.jaw,
    eye_l: sk.eye_l,
    eye_r: sk.eye_r,
    brow_l: sk.brow_l,
    brow_r: sk.brow_r,
    arm_l: arm,
    fore_l: foreL,
    arm_r: mirrored(arm, 'arm_r'),
    fore_r: foreR,
    thigh_l: thigh,
    shin_l: shin,
    thigh_r: mirrored(thigh, 'thigh_r'),
    shin_r: mirrored(shin, 'shin_r'),
  };
}

/** convenience: plain bone skeleton rig */
export function toonSkeletonRig(name = 'toon_skeleton'): RigSpec {
  return buildHumanoid({ name, parts: skeletonParts() });
}

void VF;
