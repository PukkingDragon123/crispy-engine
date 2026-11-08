// The legacy 1/36 skeleton cowboy: the base every humanoid enemy is cut from
// (skeletonFigure), plus the shared look types (CowboyLook, HatId, OutfitId).
// The player, Sundown, is the half-dead HD build in sundown.ts.
// Built to match the user's skeleton reference EXACTLY: a big rounded-dome
// cream skull (12 wide x 17 tall), two big square sockets that are deep
// dark-brown recesses (his eyes — no 2D overlay), a small nose notch, a wide
// grin with a row of teeth, thin neck vertebrae, a clavicle bar, five separate
// rib rows with gaps + sternum, a spine, a chunky pelvis, thin bones with
// knobby elbows/knees, chunky blocky fists and long blocky feet.
//
// GRID: 1/36 m (62 voxels sole->crown = 1.72 m), origin on the ground between
// the feet, faces +Z, character LEFT = +X. EVEN-WIDTH symmetry: the mirror plane
// is geometric x = 0 (between voxel columns -1 and 0); a voxel x mirrors to
// -1 - x, a geometric pivot gx mirrors to -gx. Every part is cut from this one
// rig-space grid and pivot == attach == its joint.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, SocketSpec, V3 } from '../../../engine/voxel/Rig';
import { TOON, Ramp } from '../style';
import { defaultExpressions } from '../toon/humanoid';
import { frogWigHat, FROG_WIG_TOP } from '../enemies/frog';

export type HatId = 'stetson' | 'duck' | 'sombrero' | 'nemes' | 'tophat' | 'bandit' | 'wig';
export type OutfitId = 'bare' | 'punk' | 'duster' | 'poncho' | 'vest' | 'sheriff' | 'pharaoh';
export interface CowboyLook {
  hat: HatId;
  outfit: OutfitId;
  /** HD Sundown only: the outlaw cloth over the lower face (default true) */
  mask?: boolean;
  /** HD Sundown only: round punk sunglasses (default true) */
  shades?: boolean;
}
export const HAT_IDS: HatId[] = ['stetson', 'duck', 'sombrero', 'nemes', 'tophat', 'bandit', 'wig'];
export const OUTFIT_IDS: OutfitId[] = ['bare', 'punk', 'duster', 'poncho', 'vest', 'sheriff', 'pharaoh'];
export const SUNDOWN_EXPRESSIONS = ['neutral', 'focus', 'smug', 'surprised', 'hurt', 'angry', 'laugh', 'wink', 'dead', 'determined'] as const;
export const SUNDOWN_VS = 1 / 36;

const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });
/** warm cream bone, matched to the reference; very soft shading only */
export const BONE = ramp(0xf4ddb6, 0xe7cc9f, 0xfae8c9, 0xb8936a);
/** socket interior: lit rim -> deep recess (#6b4226 -> #3a2212) */
const SOCK = { wall: 0x7d4e2e, top: 0x6b4226, mid: 0x5a3620, low: 0x4a2c19, deep: 0x3a2212 };
// (eye wall at z=2 sits in a 4-deep carve; the skull layer behind it at z=1 is painted deep brown)

// ================================================================== GRID HELPERS
const mx = (x: number) => -1 - x;
const mg = (p: V3): V3 => [-p[0], p[1], p[2]];
/** copy every voxel with x >= 0 onto the mirrored side (author the LEFT half only) */
function symm(m: VoxelModel) {
  const add: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, rgb, flags) => {
    if (x >= 0) add.push([mx(x), y, z, rgb, flags]);
  });
  for (const [x, y, z, c, f] of add) m.set(x, y, z, c, f);
  return m;
}
/** mirrored copy of a LEFT part (right limb) */
function mirrorPart(src: VoxelModel, name: string) {
  const o = new VoxelModel(name);
  src.forEach((x, y, z, rgb, flags) => o.set(mx(x), y, z, rgb, flags));
  return o;
}
/** solid box */
function fill(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, flags?: number) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) m.set(x, y, z, c, flags);
  return m;
}
/** box with its vertical edges cut by `cut` (a clean rounded block) */
function rbox(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, cut = 1, flags?: number) {
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const dx = Math.min(x - x0, x1 - x), dz = Math.min(z - z0, z1 - z);
      if (dx + dz < cut) continue;
      for (let y = y0; y <= y1; y++) m.set(x, y, z, c, flags);
    }
  return m;
}
/** soft hand shading: undersides of `base` voxels take `shade`; optional top-rim highlight */
function soften(m: VoxelModel, r: Ramp, hi = false) {
  const todo: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, rgb, flags) => {
    if (rgb !== (r.base & 0xffffff)) return;
    if (!m.has(x, y - 1, z)) todo.push([x, y, z, r.shade, flags]);
    else if (hi && !m.has(x, y + 1, z) && (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1))) todo.push([x, y, z, r.hi, flags]);
  });
  for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f);
  return m;
}
/** distance of a voxel column from the mirror plane (0.5, 1.5, ...) */
const ax = (x: number) => Math.abs(x + 0.5);

// ================================================================== LAYOUT (voxel rows, geometric joints)
const J = {
  pelvis: [0, 26.5, -1.5] as V3,
  waist: [0, 29.5, -4.5] as V3,
  neck: [0, 46, -1.5] as V3,
  jaw: [0, 49.5, -2] as V3,
  eye: [3, 54, 6] as V3,
  brow: [3, 56.5, 5.5] as V3,
  hat: [0, 59, -1] as V3,
  shoulder: [8, 42.5, 0] as V3,
  elbow: [8, 33, 0] as V3,
  hand: [9, 21.5, 0] as V3,
  hip: [4, 24, 0] as V3,
  knee: [3.5, 15.5, 0] as V3,
};
const SKULL_TOP = 62;

// ================================================================== SKULL
interface SkullOut {
  head: VoxelModel;
  jaw: VoxelModel;
  eye_l: VoxelModel;
  eye_r: VoxelModel;
  brow_l: VoxelModel;
  brow_r: VoxelModel;
}

/** rounded dome cranium: per row [halfWidth, zBack, zFront, cornerCut] (even width: x -w..w-1) */
const CRANIUM: Record<number, [number, number, number, number]> = {
  62: [4, -5, 3, 2],
  61: [5, -6, 4, 2],
  60: [6, -7, 5, 2],
  59: [6, -7, 5, 1],
  58: [6, -7, 5, 1],
  57: [6, -7, 5, 1],
  56: [6, -7, 5, 1],
  55: [6, -7, 5, 1],
  54: [6, -7, 5, 1],
  53: [6, -7, 5, 1],
  52: [6, -7, 5, 1],
  51: [6, -7, 5, 1],
  50: [6, -6, 5, 1],
  49: [6, -6, 5, 2],
};

function buildSkull(): SkullOut {
  const B = BONE;
  const head = new VoxelModel('head');
  for (const [ys, [w, zb, zf, cut]] of Object.entries(CRANIUM)) {
    const y = +ys;
    for (let x = 0; x < w; x++)
      for (let z = zb; z <= zf; z++) {
        const dx = w - 1 - x, dz = Math.min(z - zb, zf - z);
        if (dx + dz < cut) continue;
        head.set(x, y, z, B.base);
      }
  }
  // row 48: the upper teeth row + back of the skull base (occiput), narrower face
  for (let x = 0; x < 5; x++) for (let z = 1; z <= 5; z++) if (!(x === 4 && z === 5)) head.set(x, 48, z, B.base);
  for (let x = 0; x < 4; x++) for (let z = -5; z <= -3; z++) head.set(x, 48, z, B.base);
  symm(head);

  // ---- eye sockets: 4x4, 3 deep; the back wall is the eye part (dark brown recess)
  for (const side of [1, -1]) {
    for (let i = 1; i <= 4; i++)
      for (let y = 52; y <= 55; y++) {
        const x = side > 0 ? i : mx(i);
        head.del(x, y, 5).del(x, y, 4).del(x, y, 3).del(x, y, 2);
        head.set(x, y, 1, SOCK.deep); // solid backing behind the eye wall
      }
    // socket walls: brown from just behind the rim, darkening with depth
    // (only the bridge side: the 1-voxel outer margin is also the skull's side surface, it stays bone)
    for (let y = 52; y <= 55; y++) {
      const x = side > 0 ? 0 : mx(0);
      head.set(x, y, 4, SOCK.mid).set(x, y, 3, SOCK.low).set(x, y, 2, SOCK.deep);
    }
    for (let i = 1; i <= 4; i++) {
      const x = side > 0 ? i : mx(i);
      head.set(x, 56, 4, SOCK.mid).set(x, 56, 3, SOCK.low).set(x, 56, 2, SOCK.deep); // roof (in shadow)
      head.set(x, 51, 4, SOCK.top).set(x, 51, 3, SOCK.mid).set(x, 51, 2, SOCK.low); // floor (catches light)
    }
  }
  // ---- nose: small dark notch under the bridge
  for (const x of [-1, 0]) {
    head.del(x, 50, 5).del(x, 50, 4);
    head.set(x, 50, 3, SOCK.deep);
    head.set(x, 51, 4, B.shade); // underside of the bridge
  }
  // ---- mouth: upper teeth (row 48) in front of a dark mouth interior
  // upper teeth: cream blocks with faint seams
  for (let x = 0; x < 4; x++) {
    const c = x === 1 || x === 3 ? B.shade : B.base;
    head.set(x, 48, 5, c).set(mx(x), 48, 5, c);
  }
  // the dark mouth gap between the teeth rows (on the skull, so it stays when the jaw drops)
  for (let x = 0; x < 4; x++) for (let z = 2; z <= 5; z++) head.set(x, 47, z, z === 5 ? SOCK.low : SOCK.deep).set(mx(x), 47, z, z === 5 ? SOCK.low : SOCK.deep);
  // subtle suture line on the back of the cranium
  for (let y = 52; y <= 59; y++) head.paintAt([0, 1, 0, -1, -2, -1][y % 6], y, -7, B.shade);
  // ---- atlas joint under the skull (meets the neck vertebrae)
  fill(head, -1, 47, -3, 0, 47, -2, B.shade);

  // ---- jaw (mandible): chin + lower teeth, rami up toward the hinge
  const jaw = new VoxelModel('jaw');
  for (let x = 4; x < 5; x++) for (let z = -3; z <= 4; z++) jaw.set(x, 47, z, B.base); // jaw corners beside the mouth
  for (let x = 0; x < 5; x++) for (let z = -2; z <= 5; z++) if (!(x === 4 && z === 5)) jaw.set(x, 46, z, B.base); // lower teeth row
  for (let x = 0; x < 4; x++) for (let z = -1; z <= 5; z++) if (!(x === 3 && z === 5)) jaw.set(x, 45, z, B.base); // chin
  for (let x = 0; x < 3; x++) for (let z = 1; z <= 4; z++) jaw.set(x, 44, z, B.shade); // chin underside
  for (let z = -3; z <= -1; z++) jaw.set(4, 48, z, B.base); // rami toward the hinge (behind the cheek)
  // lower teeth: cream blocks with faint seams, tongue bed behind
  for (let x = 0; x < 4; x++) {
    jaw.set(x, 46, 5, x === 0 || x === 2 ? B.shade : B.base);
    for (let z = 1; z <= 4; z++) jaw.set(x, 46, z, SOCK.deep);
  }
  symm(jaw);

  // ---- socket back walls (on the skull): warm brown, darkening toward the bottom
  const EYE_ROW: Record<number, number> = { 55: SOCK.top, 54: SOCK.mid, 53: SOCK.low, 52: SOCK.deep };
  for (const side of [1, -1])
    for (let i = 1; i <= 4; i++)
      for (let y = 52; y <= 55; y++) {
        if ((i === 2 || i === 3) && (y === 53 || y === 54)) continue; // the eyeball sits here
        head.set(side > 0 ? i : mx(i), y, 2, (i === 1 || i === 4) && y <= 53 ? SOCK.deep : EYE_ROW[y]);
      }
  // ---- eyes: modelled eyeballs nested deep in each socket (no 2D overlay, no glow).
  // A small, dark, wet orb two voxels behind the rim, so from a distance the socket
  // still reads as the reference's big dark-brown square; up close it has a soft
  // catch-light (same screen corner in both eyes, as real light does).
  const eyeball = (name: string, side: 1 | -1) => {
    const m = new VoxelModel(name);
    for (const i of [2, 3])
      for (const y of [53, 54]) {
        const x = side > 0 ? i : mx(i);
        const glint = y === 54 && x === (side > 0 ? 2 : mx(3)); // upper corner toward the viewer's left
        m.set(x, y, 2, 0x140b07);
        m.set(x, y, 3, glint ? 0xc4a47e : y === 53 ? 0x24150c : 0x1a0f09);
      }
    return m;
  };
  const eye_l = eyeball('eye_l', 1);
  const eye_r = eyeball('eye_r', -1);

  // ---- brow ridges: the cream rim right above each socket (tilts for expressions)
  const brow_l = new VoxelModel('brow_l');
  for (let i = 1; i <= 4; i++) {
    head.del(i, 56, 5);
    brow_l.set(i, 56, 5, B.base);
  }
  for (let i = 1; i <= 4; i++) head.del(mx(i), 56, 5);
  const brow_r = mirrorPart(brow_l, 'brow_r');

  soften(head, B, true);
  soften(jaw, B);
  return { head, jaw, eye_l, eye_r, brow_l, brow_r };
}

// ================================================================== TORSO (neck, clavicles, ribs, sternum, spine)
function buildTorso() {
  const B = BONE;
  const m = new VoxelModel('torso');
  // neck vertebrae (2x2) with a darker disc between them
  for (let y = 44; y <= 45; y++) for (let z = -3; z <= -2; z++) m.set(0, y, z, y === 44 ? B.shade : B.base);
  // spine: vertebral bodies + spinous processes, seams every other row
  for (let y = 28; y <= 43; y++) {
    const seam = (y & 1) === 0;
    for (let z = -5; z <= -4; z++) m.set(0, y, z, seam ? B.shade : B.base);
    if (!seam) m.set(0, y, -6, B.base); // spinous process (only the left column -> mirrors to a 2-wide nub)
    if (y <= 31 && !seam) m.set(1, y, -4, B.base); // lumbar lateral processes
  }
  // clavicle bar across the top of the chest + shoulder cap
  for (let x = 0; x <= 6; x++) m.set(x, 43, 0, B.base).set(x, 43, 1, x <= 1 ? B.shade : B.base);
  m.set(6, 42, 0, B.base).set(6, 42, 1, B.base);
  // scapulae on the back
  for (let y = 38; y <= 42; y++) for (let x = 2; x <= 5; x++) if (!(y === 38 && (x === 2 || x === 5)) && !(y === 42 && x === 5)) m.set(x, y, -6, y === 38 ? B.shade : B.base);
  // ribs: five separate rows with gaps between them, drooping toward the front
  const RIBS: [number, number, number][] = [
    // y (at the spine), halfWidth, zFront
    [41, 7, 3],
    [39, 7, 3],
    [37, 6, 3],
    [35, 6, 2],
    [33, 5, 2],
  ];
  RIBS.forEach(([y, w, zf], i) => {
    const zb = -5;
    for (let x = 1; x < w; x++)
      for (let z = zb; z <= zf; z++) {
        const side = x === w - 1;
        const back = z === zb;
        const front = z === zf;
        if (!side && !back && !front) continue;
        if (side && (z === zb || z === zf)) continue; // rounded corners
        // the lowest two rows are floating ribs (no sternal end)
        if (front && i >= 3 && x <= 1) continue;
        m.set(x, y, z, B.base);
      }
  });
  // sternum (manubrium on top) down the front of the cage
  for (let y = 35; y <= 42; y++) m.set(0, y, 3, y === 42 ? B.base : y === 35 ? B.shade : B.base);
  m.set(1, 42, 3, B.base);
  symm(m);
  soften(m, B);
  return m;
}

// ================================================================== PELVIS
function buildPelvis() {
  const B = BONE;
  const m = new VoxelModel('pelvis');
  // sacrum (continues the spine)
  for (let y = 24; y <= 28; y++) for (let z = -5; z <= -4; z++) m.set(0, y, z, y === 24 ? B.shade : B.base);
  // iliac wings: chunky flared bowls with a curved crest (reference: wide, blocky, with holes)
  const WING: Record<number, [number, number]> = { 29: [3, 5], 28: [2, 6], 27: [2, 6], 26: [2, 6], 25: [3, 5] };
  for (const [ys, [x0, x1]] of Object.entries(WING)) {
    const y = +ys;
    for (let x = x0; x <= x1; x++)
      for (let z = -4; z <= 1; z++) {
        const crest = y === 29 && z >= -3 && z <= 0;
        const shell = crest || (y < 29 && (x === x1 || z === -4 || (z === 1 && y <= 26) || (y === 28 && (z === 1 || x === x0))));
        if (!shell) continue;
        if (x === x1 && (z === -4 || z === 1) && y < 29) continue;
        m.set(x, y, z, B.base);
      }
  }
  // obturator holes: dark recesses on the front of the hip bowls
  m.set(4, 25, 1, SOCK.low).set(4, 26, 1, SOCK.low);
  for (let z = -3; z <= -1; z++) m.set(1, 27, z, B.base); // connects wing to sacrum
  m.set(1, 28, -4, B.base).set(1, 27, -4, B.base);
  // hip socket ring (the femur head sits inside it)
  m.set(5, 24, -1, B.shade).set(5, 24, 0, B.shade).set(5, 23, -1, B.shade);
  // pubic bar + pubic arch, obturator holes beside it
  for (let x = 0; x <= 2; x++) m.set(x, 23, 1, B.base).set(x, 24, 1, x === 2 ? B.shade : B.base);
  m.set(2, 25, 1, B.base).set(2, 25, 0, B.base);
  m.set(1, 22, 1, B.shade).set(2, 22, 1, B.shade);
  m.set(3, 23, -1, B.base).set(3, 22, -1, B.shade); // ischium
  symm(m);
  // the arch: no bone at the very centre bottom
  m.del(0, 22, 1).del(-1, 22, 1);
  soften(m, B);
  return m;
}

// ================================================================== LIMBS (LEFT side; right = mirrorPart)
function buildUpperArm() {
  const B = BONE;
  const m = new VoxelModel('arm_l');
  rbox(m, 7, 41, -1, 8, 43, 0, B.base, 0); // humerus head
  m.set(9, 42, 0, B.base).set(9, 42, -1, B.base); // greater tubercle
  for (let y = 35; y <= 40; y++) m.set(8, y, -1, B.base).set(8, y, 0, B.base); // shaft
  rbox(m, 7, 33, -1, 9, 34, 0, B.base, 0); // condyles (elbow knob, upper half)
  m.set(7, 34, 0, B.shade).set(9, 34, 0, B.shade);
  soften(m, B);
  return m;
}

/** chunky blocky fist (LEFT coords, rows 19..24) */
function fist(m: VoxelModel, open: boolean) {
  const B = BONE;
  // wrist bones
  rbox(m, 8, 25, -1, 9, 26, 0, B.base, 0);
  // palm + back of the hand
  rbox(m, 7, 21, -2, 10, 24, 1, B.base, 1);
  if (!open) {
    // curled fingers wrapped forward: four finger columns with seams, knuckles on top
    for (let x = 7; x <= 10; x++) {
      for (let y = 20; y <= 23; y++) m.set(x, y, 2, y === 23 ? B.hi : B.base);
      for (let z = -1; z <= 1; z++) m.set(x, 20, z, B.base);
    }
    for (const x of [8, 10]) for (let y = 20; y <= 22; y++) m.set(x, y, 2, B.shade);
  } else {
    // relaxed hand: fingers loosely curled, hanging a little lower
    for (let x = 7; x <= 10; x++) {
      const len = x === 7 || x === 10 ? 2 : 3;
      for (let i = 0; i < len; i++) m.set(x, 20 - i, 0, i === len - 1 ? B.shade : B.base).set(x, 20 - i, 1, B.base);
      m.set(x, 21, 2, B.base);
    }
    for (const x of [8, 10]) m.set(x, 19, 1, B.shade);
  }
  // thumb on the inner side
  rbox(m, 6, 21, 0, 6, 23, 2, B.base, 1);
  m.set(6, 22, 2, B.shade);
  return m;
}

function buildForearm(open: boolean) {
  const B = BONE;
  const m = new VoxelModel('fore_l');
  rbox(m, 7, 31, -1, 9, 32, 0, B.base, 0); // olecranon / elbow knob (lower half)
  m.set(8, 31, -2, B.base); // point of the elbow at the back
  for (let y = 27; y <= 30; y++) {
    m.set(8, y, 0, B.base); // radius
    m.set(8, y, -1, B.shade); // ulna (a hair darker so the pair reads)
  }
  fist(m, open);
  soften(m, B);
  return m;
}

function buildThigh() {
  const B = BONE;
  const m = new VoxelModel('thigh_l');
  rbox(m, 3, 23, -1, 4, 24, 0, B.base, 0); // femur head in the hip socket
  m.set(5, 23, -1, B.base).set(5, 23, 0, B.base); // greater trochanter
  for (let y = 18; y <= 22; y++) m.set(3, y, -1, B.base).set(3, y, 0, B.base); // shaft
  rbox(m, 2, 16, -1, 4, 17, 1, B.base, 1); // femoral condyles (knee knob, upper half)
  soften(m, B);
  return m;
}

/** bare skeletal foot (LEFT): long blocky foot, heel back, toes forward */
function boneFoot(m: VoxelModel) {
  const B = BONE;
  rbox(m, 2, 3, -1, 4, 4, 0, B.base, 0); // ankle (malleoli)
  rbox(m, 2, 0, -3, 5, 2, -1, B.base, 1); // heel block
  for (let z = 0; z <= 4; z++) for (let x = 2; x <= 5; x++) m.set(x, 0, z, B.base).set(x, 1, z, z <= 2 ? B.base : x === 3 || x === 5 ? B.shade : B.base);
  for (let x = 2; x <= 5; x++) m.set(x, 0, 5, x === 3 ? B.shade : B.base); // toe tips with seams
  m.set(3, 2, 0, B.base).set(4, 2, 0, B.base);
  return m;
}

function buildShin(foot: (m: VoxelModel) => void) {
  const B = BONE;
  const m = new VoxelModel('shin_l');
  rbox(m, 2, 14, -1, 4, 15, 1, B.base, 1); // tibial plateau (knee knob, lower half)
  m.set(3, 15, 2, B.hi).set(3, 14, 2, B.base); // kneecap
  for (let y = 5; y <= 13; y++) m.set(3, y, -1, B.base).set(3, y, 0, B.base); // tibia
  foot(m);
  soften(m, B);
  return m;
}

// ================================================================== CLOTHES & GEAR
interface Outfit {
  coat: Ramp;
  trim: Ramp;
  band: Ramp;
  boot: Ramp;
  belt: Ramp;
}
const OUT: Record<OutfitId, Outfit> = {
  bare: { coat: TOON.leather, trim: TOON.leatherDark, band: TOON.red, boot: TOON.leather, belt: TOON.leatherDark },
  punk: { coat: TOON.black, trim: TOON.black, band: TOON.red, boot: TOON.black, belt: TOON.black },
  duster: { coat: TOON.duster, trim: TOON.leatherDark, band: TOON.red, boot: TOON.leather, belt: TOON.leatherDark },
  poncho: { coat: TOON.poncho, trim: TOON.linen, band: TOON.turquoise, boot: TOON.leather, belt: TOON.leatherDark },
  vest: { coat: TOON.leather, trim: TOON.leatherDark, band: TOON.red, boot: ramp(0x8e3b26, 0x6c2a1b, 0xad5236, 0x4a1a10), belt: TOON.leatherDark },
  sheriff: { coat: ramp(0x3a3a48, 0x2a2a36, 0x50505e, 0x1a1a22), trim: TOON.black, band: TOON.black, boot: TOON.black, belt: TOON.black },
  pharaoh: { coat: TOON.linen, trim: TOON.gold, band: TOON.lapis, boot: TOON.gold, belt: TOON.gold },
};

/** red bandana: knotted around the neck, folded triangle hanging over the top of the sternum */
function bandana(m: VoxelModel, R: Ramp) {
  for (let y = 44; y <= 45; y++)
    for (let x = 0; x <= 2; x++)
      for (let z = -4; z <= 1; z++) {
        const ring = x === 2 || z === -4 || z === 1;
        if (!ring || (x === 2 && (z === -4 || z === 1))) continue;
        m.set(x, y, z, y === 44 ? R.shade : R.base);
      }
  // front fold: a stepped triangle over the manubrium
  const tri: [number, number][] = [[43, 3], [42, 2], [41, 1], [40, 0]];
  for (const [y, w] of tri) for (let x = 0; x <= w; x++) m.set(x, y, 4, y === 40 ? R.shade : R.base);
  for (let x = 0; x <= 2; x++) m.set(x, 44, 2, R.base).set(x, 43, 2, R.shade).set(x, 43, 3, R.base);
  // fold creases (darker 1-voxel lines, no cartoon dots)
  m.set(1, 42, 4, R.shade).set(0, 41, 4, R.dark);
  symm(m);
  // knot at the back of the neck
  fill(m, -1, 44, -6, 0, 45, -5, R.shade);
  m.set(0, 45, -7, R.base).set(-1, 44, -7, R.dark);
}

/** gun belt slung on the hip bones, brass bullet loops, Serket buckle, holster on the right hip */
function gunBelt(m: VoxelModel, L: Ramp, buckle: Ramp) {
  const ring = new VoxelModel('belt');
  for (let y = 25; y <= 26; y++)
    for (let x = 0; x <= 6; x++)
      for (let z = -6; z <= 2; z++) {
        const edge = x === 6 || z === -6 || z === 2;
        if (!edge || (x === 6 && (z === -6 || z === 2))) continue;
        ring.set(x, y, z, y === 25 ? L.shade : L.base);
      }
  symm(ring);
  ring.forEach((x, y, z, c, f) => m.set(x, y, z, c, f));
  // brass rounds in their loops (left side + back)
  for (const x of [2, 4]) m.set(x, 26, 3, TOON.brass.hi, VF.METAL).set(x, 25, 3, TOON.brass.shade, VF.METAL);
  for (const z of [0, -2, -4]) m.set(7, 26, z, TOON.brass.hi, VF.METAL);
  // the buckle (brass plate with the Serket scorpion inlay)
  rbox(m, -2, 24, 3, 1, 27, 3, buckle.base, 1, VF.METAL);
  for (const [x, y] of [[-1, 25], [0, 25], [0, 26], [-1, 26]] as [number, number][]) m.set(x, y, 4, buckle.dark, VF.METAL);
  m.set(0, 26, 4, TOON.serket.shade);
  // holster on the right hip (-X), hanging along the thigh
  rbox(m, -9, 17, -2, -8, 24, 1, L.shade, 1);
  m.set(-9, 23, 2, L.base).set(-8, 23, 2, L.base).set(-9, 22, 2, L.dark);
  for (let y = 18; y <= 22; y++) m.set(-10, y, -1, L.dark);
  m.set(-10, 20, 0, TOON.silver.hi, VF.METAL);
  // tie-down thong around the thigh
  m.set(-9, 18, -3, L.dark).set(-8, 18, -3, L.dark);
}

/** cowboy boot (LEFT): pointed toe, raised heel, stitched shaft, star spur */
function cowboyBoot(m: VoxelModel, L: Ramp, spur: boolean) {
  const So = TOON.leatherDark;
  for (let x = 2; x <= 4; x++) for (let z = -3; z <= 4; z++) m.set(x, 0, z, So.base);
  fill(m, 2, 1, -3, 4, 1, -2, So.shade); // raised heel
  rbox(m, 2, 1, -3, 4, 2, 3, L.base, 1);
  m.set(3, 1, 4, L.base).set(3, 0, 5, So.base); // pointed toe
  rbox(m, 2, 3, -2, 4, 8, 1, L.base, 1); // shaft over the shin
  for (let x = 2; x <= 4; x++) for (let z = -2; z <= 1; z++) if (m.has(x, 8, z)) m.set(x, 8, z, L.hi); // cuff
  m.set(2, 9, 0, L.shade).set(4, 9, 0, L.shade); // pull tabs
  for (const [y, x] of [[5, 3], [6, 3], [7, 3]] as [number, number][]) m.set(x, y, 2, TOON.linen.shade); // stitching
  if (spur) {
    const S = TOON.silver;
    m.set(3, 2, -4, S.shade, VF.METAL).set(3, 2, -5, S.base, VF.METAL);
    m.set(3, 3, -6, S.hi, VF.METAL).set(3, 1, -6, S.hi, VF.METAL).set(3, 2, -6, S.base, VF.METAL);
  }
}

/** gold pharaoh sandal (LEFT) over the bare bone foot */
function sandal(m: VoxelModel) {
  boneFoot(m);
  const G = TOON.gold;
  for (let x = 2; x <= 4; x++) for (let z = -3; z <= 4; z++) m.set(x, -0, z, G.shade, VF.METAL);
  for (let x = 2; x <= 4; x++) m.set(x, 2, 0, G.base, VF.METAL);
  m.set(3, 3, -2, G.hi, VF.METAL);
}

// ---------------------------------------------------------------- torso garments (all keep the ribs/skull visible)
function dusterTorso(m: VoxelModel, C: Ramp, T: Ramp) {
  // open long coat shell around the cage, wide open front showing ribs + sternum
  const g = new VoxelModel('g');
  for (let y = 30; y <= 43; y++)
    for (let x = 0; x <= 8; x++)
      for (let z = -7; z <= 4; z++) {
        const shell = x === 8 || z === -7;
        const front = z === 4 && x >= 5;
        if (!shell && !front) continue;
        if (x === 8 && (z === -7 || z === 4)) continue;
        if (y >= 42 && x === 8) continue; // armhole / shoulder slope
        g.set(x, y, z, C.base);
      }
  for (let x = 4; x <= 7; x++) for (let z = -6; z <= 3; z++) g.set(x, 44, z, C.base); // shoulder yoke
  for (let x = 0; x <= 3; x++) for (let z = -6; z <= -4; z++) g.set(x, 44, z, C.base);
  // turned-down lapels
  for (let y = 36; y <= 43; y++) g.set(5, y, 5, T.base);
  for (let y = 40; y <= 43; y++) g.set(6, y, 5, T.base);
  g.set(7, 43, 5, T.base);
  // stand-up collar behind the neck
  for (let x = 0; x <= 5; x++) g.set(x, 45, -7, T.base).set(x, 46, -7, T.shade);
  g.set(6, 45, -6, T.base);
  // yoke stitching + back seam + half-belt
  for (let x = 0; x <= 7; x++) g.set(x, 42, -8, C.dark);
  for (let y = 30; y <= 41; y++) g.set(0, y, -8, C.shade);
  for (let x = 0; x <= 4; x++) g.set(x, 31, -8, T.base);
  g.set(3, 31, -9, TOON.brass.hi, VF.METAL);
  // patch pocket on the left chest
  rbox(g, 6, 33, 5, 7, 35, 5, C.shade, 0);
  g.set(6, 35, 6, T.base).set(7, 35, 6, T.base);
  symm(g);
  g.forEach((x, y, z, c, f) => m.set(x, y, z, c, f));
}

function ponchoTorso(m: VoxelModel, C: Ramp) {
  const g = new VoxelModel('g');
  for (let y = 33; y <= 45; y++) {
    const w = y >= 45 ? 4 : y >= 44 ? 6 : y >= 42 ? 8 : y >= 38 ? 10 : 11; // half width, flaring
    const zb = y >= 45 ? -4 : y >= 43 ? -6 : -7;
    const zf = y >= 45 ? 2 : y >= 43 ? 4 : 5;
    for (let x = 0; x < w; x++)
      for (let z = zb; z <= zf; z++) {
        const outer = x === w - 1 || z === zb || z === zf || y === 45 || (y >= 42 && x >= w - 2);
        if (!outer) continue;
        if (x === w - 1 && (z === zb || z === zf)) continue;
        if (y === 45 && x <= 1 && z >= -2 && z <= 1) continue; // neck hole
        const stripe = y === 37 || y === 41 ? TOON.linen.base : y === 38 || y === 40 ? TOON.red.base : y === 33 ? C.shade : C.base;
        g.set(x, y, z, stripe);
      }
  }
  // stepped zig-zag woven into the cream stripes
  for (let x = 0; x < 11; x++) {
    if ((x & 1) === 0) for (const z of [5, -7]) if (g.has(x, 37, z)) g.set(x, 37, z, TOON.turquoise.base);
    if ((x & 1) === 1) for (const z of [5, -7]) if (g.has(x, 41, z)) g.set(x, 41, z, TOON.turquoise.base);
  }
  // fringe along the hem
  for (let x = 0; x < 11; x += 2) for (const z of [5, -7]) g.set(x, 32, z, TOON.linen.shade);
  symm(g);
  g.forEach((x, y, z, c, f) => m.set(x, y, z, c, f));
}

function vestTorso(m: VoxelModel, C: Ramp, T: Ramp, star: boolean) {
  const g = new VoxelModel('g');
  for (let y = 31; y <= 43; y++)
    for (let x = 0; x <= 7; x++)
      for (let z = -6; z <= 4; z++) {
        const shell = x === 7 || z === -6 || (z === 4 && x >= 3);
        if (!shell) continue;
        if (x === 7 && (z === -6 || z === 4)) continue;
        if (y >= 39 && x === 7) continue; // armholes
        if (y === 43 && x <= 3) continue; // neckline
        g.set(x, y, z, C.base);
      }
  for (let x = 4; x <= 6; x++) for (let z = -5; z <= 3; z++) g.set(x, 44, z, C.base);
  for (let y = 31; y <= 43; y++) g.set(3, y, 5, T.base); // edging
  symm(g);
  g.forEach((x, y, z, c, f) => m.set(x, y, z, c, f));
  for (const y of [33, 36, 39]) m.set(-4, y, 5, TOON.brass.hi, VF.METAL); // buttons
  for (let x = 1; x <= 3; x++) m.set(x, 33 - (x === 2 ? 1 : 0), 5, TOON.gold.base, VF.METAL); // watch chain
  if (star) sheriffStar(m, 6, 38, 6);
}

function sheriffStar(m: VoxelModel, cx: number, cy: number, z: number) {
  const SV = TOON.gold;
  for (const [x, y, c] of [[0, 2, SV.hi], [-1, 1, SV.base], [0, 1, SV.base], [1, 1, SV.base], [-2, 1, SV.shade], [2, 1, SV.shade], [0, 0, SV.base], [-1, -1, SV.base], [1, -1, SV.base]] as [number, number, number][])
    m.set(cx + x, cy + y, z, c, VF.METAL);
}

function pharaohTorso(m: VoxelModel) {
  // broad usekh collar: stepped rings of gold / lapis / turquoise resting on the clavicles
  const g = new VoxelModel('g');
  const rows: [number, number, number][] = [[44, 4, TOON.gold.base], [43, 6, TOON.lapis.base], [42, 7, TOON.gold.hi], [41, 7, TOON.turquoise.base], [40, 6, TOON.gold.base]];
  for (const [y, w, c] of rows)
    for (let x = 0; x < w; x++)
      for (let z = -6; z <= 4; z++) {
        const edge = x === w - 1 || z === -6 || z === 4;
        if (!edge) continue;
        if (y === 44 && x <= 1 && z > -5 && z < 3) continue;
        g.set(x, y, z, c, c === TOON.gold.base || c === TOON.gold.hi ? VF.METAL : VF.SOLID);
      }
  symm(g);
  g.forEach((x, y, z, c, f) => m.set(x, y, z, c, f));
  // scarab pectoral on the sternum
  rbox(m, -1, 36, 4, 0, 38, 4, TOON.lapis.base, 0);
  m.set(0, 38, 5, TOON.turquoise.hi).set(-2, 37, 4, TOON.gold.base, VF.METAL).set(1, 37, 4, TOON.gold.base, VF.METAL);
}

/** short stiff coat skirt (long tails are engine cloth): hangs from the waist, open at the front */
function dusterSkirt(C: Ramp, T: Ramp) {
  const g = new VoxelModel('coat');
  for (let y = 19; y <= 29; y++) {
    const w = y <= 22 ? 10 : 9, zb = y <= 22 ? -8 : -7;
    for (let x = 0; x < w; x++)
      for (let z = zb; z <= 3; z++) {
        const shell = x === w - 1 || z === zb;
        if (!shell) continue;
        if (x === w - 1 && z === zb) continue;
        if (x === w - 1 && z > 1) continue;
        g.set(x, y, z, y === 19 ? C.shade : C.base);
      }
  }
  for (let z = -3; z <= 0; z++) g.set(9, 25, z, T.base); // pocket flaps
  // back vent
  for (let y = 19; y <= 23; y++) g.del(0, y, -8).del(0, y, -7);
  symm(g);
  for (let y = 19; y <= 24; y++) g.set(0, y, -6, T.dark).set(-1, y, -6, T.dark);
  return g;
}

function shendyt() {
  const g = new VoxelModel('coat');
  const L = TOON.linen;
  for (let y = 17; y <= 27; y++) {
    const w = y <= 22 ? 9 : 8;
    for (let x = 0; x < w; x++)
      for (let z = -6; z <= 3; z++) {
        const shell = x === w - 1 || z === -6 || z === 3;
        if (!shell) continue;
        g.set(x, y, z, (x & 1) ? L.base : L.shade); // pleats
      }
  }
  for (let x = 0; x < 8; x++) for (let z = -6; z <= 3; z++) if (x === 7 || z === -6 || z === 3) g.set(x, 28, z, TOON.gold.base, VF.METAL);
  symm(g);
  rbox(g, -2, 18, 4, 1, 27, 4, TOON.gold.base, 0, VF.METAL); // front apron
  for (let y = 19; y <= 26; y += 2) g.set(0, y, 5, TOON.lapis.base).set(-1, y, 5, TOON.lapis.base);
  return g;
}

/** sleeve over the upper arm (LEFT) */
function sleeve(m: VoxelModel, C: Ramp, T: Ramp) {
  rbox(m, 6, 34, -2, 10, 43, 2, C.base, 1);
  for (let z = -1; z <= 1; z++) for (let x = 7; x <= 9; x++) m.set(x, 44, z, C.base);
  for (let x = 6; x <= 10; x++) for (let z = -2; z <= 2; z++) if (m.has(x, 34, z) && (x === 6 || x === 10 || z === -2 || z === 2)) m.set(x, 34, z, T.base);
}

// ================================================================== HATS (fit the 12-wide dome, crown top at row 62)
function stetson(felt: Ramp, band: Ramp, concho = true) {
  const m = new VoxelModel('hat');
  const B0 = 59; // brim sits just above the brows
  // brim: oval, sides curl up, back and front dip
  for (let x = -14; x < 14; x++)
    for (let z = -13; z <= 11; z++) {
      const dx = ax(x) / 14.2, dz = (z + 1) / 12.4;
      const e = dx * dx + dz * dz;
      if (e > 1) continue;
      const a = ax(x);
      const y = a >= 12 ? B0 + 2 : a >= 10 ? B0 + 1 : B0;
      m.set(x, y, z, e > 0.82 && y === B0 ? felt.shade : felt.base);
      if (y > B0) m.set(x, y - 1, z, felt.shade);
    }
  // crown: covers the dome, creased top with front pinches
  for (let y = B0 + 1; y <= B0 + 7; y++) {
    const top = y === B0 + 7;
    const w = top ? 6 : 7, zb = top ? -7 : -8, zf = top ? 5 : 6, cut = top ? 4 : 3;
    for (let x = -w; x < w; x++)
      for (let z = zb; z <= zf; z++) {
        const dx = w - ax(x) - 0.5, dz = Math.min(z - zb, zf - z);
        if (dx + dz < cut) continue;
        if (top && ax(x) < 1 && z > zb + 1) continue; // centre crease
        m.set(x, y, z, felt.base);
      }
  }
  for (const s of [1, -1]) for (const [x, y, z] of [[3, B0 + 7, 4], [4, B0 + 7, 3], [4, B0 + 6, 5], [5, B0 + 6, 4]] as [number, number, number][]) m.del(s > 0 ? x : mx(x), y, z);
  // band: two rows around the crown wall
  for (let y = B0 + 1; y <= B0 + 2; y++)
    for (let x = -7; x < 7; x++)
      for (let z = -8; z <= 6; z++) {
        if (!m.has(x, y, z)) continue;
        const outer = !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1) || ax(x) > 6;
        if (outer) m.set(x, y, z, y === B0 + 1 ? band.shade : band.base);
      }
  if (concho) {
    // brass Serket concho on the front of the band
    for (const [x, y, c] of [[-1, B0 + 1, TOON.brass.shade], [0, B0 + 1, TOON.brass.shade], [-1, B0 + 2, TOON.brass.hi], [0, B0 + 2, TOON.brass.base]] as [number, number, number][]) m.set(x, y, 7, c, VF.METAL);
    m.set(0, B0 + 2, 8, TOON.serket.shade);
  }
  // a couple of bullet holes and wear on the crown (story, not noise)
  m.del(4, B0 + 5, 6);
  m.set(4, B0 + 5, 5, felt.dark);
  m.forEach((x, y, z, c) => {
    if (c !== (felt.base & 0xffffff)) return;
    if (y === B0 + 7 && (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1))) m.set(x, y, z, felt.hi);
  });
  return m;
}

function hatDuck() {
  const yel = ramp(0xffd23a, 0xe8a91c, 0xffeb8a, 0xb07a10);
  const org = ramp(0xff8a2a, 0xd8661a, 0xffac5a, 0x9a4410);
  const m = new VoxelModel('hat');
  rbox(m, -7, 60, -8, 6, 65, 5, yel.base, 3); // body sitting on the dome
  rbox(m, -6, 66, -7, 5, 67, 3, yel.base, 3);
  rbox(m, -2, 66, -10, 1, 69, -8, yel.base, 1); // tail flick
  for (const x of [7, mx(7)]) rbox(m, Math.min(x, x), 62, -5, Math.min(x, x), 65, 1, yel.shade, 1); // wings
  rbox(m, -4, 68, 0, 3, 75, 7, yel.base, 2); // head
  rbox(m, -3, 69, 8, 2, 71, 11, org.base, 1); // beak
  for (let x = -2; x <= 1; x++) m.set(x, 69, 11, org.shade);
  // painted eyes on the toy (glossy black + highlight)
  for (const x of [2, mx(2)]) m.set(x, 73, 8, 0x14100c).set(x, 72, 8, 0x14100c);
  m.set(2, 73, 9, 0xffffff).set(mx(2), 73, 9, 0xffffff);
  soften(m, yel);
  soften(m, org);
  return m;
}

function sombrero() {
  const straw = ramp(0xe8c47a, 0xc9a25a, 0xf8dc9c, 0x9a7a3a);
  const m = new VoxelModel('hat');
  for (let x = -18; x < 18; x++)
    for (let z = -18; z <= 17; z++) {
      const r = Math.hypot(ax(x), z + 0.5);
      if (r > 18) continue;
      const y = r > 15.5 ? 61 : 59;
      m.set(x, y, z, r > 16.2 ? TOON.red.base : (Math.floor(r) & 1) ? straw.base : straw.shade);
      if (y === 61) m.set(x, 60, z, straw.shade);
    }
  for (let y = 60; y <= 71; y++) {
    const rr = y <= 62 ? 8.4 : 8.4 - (y - 62) * 0.62;
    for (let x = -9; x < 9; x++) for (let z = -9; z <= 8; z++) if (ax(x) * ax(x) + (z + 0.5) * (z + 0.5) <= rr * rr) m.set(x, y, z, y % 3 === 0 ? straw.shade : straw.base);
  }
  // embroidered band
  for (let x = -9; x < 9; x++)
    for (let z = -9; z <= 8; z++)
      for (let y = 61; y <= 62; y++) {
        if (!m.has(x, y, z)) continue;
        const edge = !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
        if (edge) m.set(x, y, z, ((x + z) & 3) === 0 ? TOON.green.base : y === 61 ? TOON.red.base : TOON.gold.base);
      }
  return m;
}

function nemes() {
  const G = TOON.gold, L = TOON.lapis;
  const m = new VoxelModel('hat');
  for (let y = 50; y <= 63; y++) {
    const w = y >= 62 ? 6 : 7;
    const zb = y >= 62 ? -7 : -8;
    const zf = y >= 62 ? 5 : y >= 57 ? 6 : 0;
    for (let x = 0; x < w; x++)
      for (let z = zb; z <= zf; z++) {
        const dx = w - 1 - x, dz = Math.min(z - zb, zf - z);
        if (dx + dz < 2) continue;
        const inner = x < w - 1 && z > zb + 1 && z < zf && y < 62;
        if (inner) continue;
        m.set(x, y, z, (y & 1) ? L.base : G.base, (y & 1) ? VF.SOLID : VF.METAL);
      }
  }
  for (let x = 0; x < 7; x++) m.set(x, 57, 7, G.hi, VF.METAL); // forehead band
  // lappets falling in front of the shoulders
  for (let y = 38; y <= 50; y++) for (let x = 7; x <= 9; x++) for (let z = -1; z <= 1; z++) m.set(x, y, z, (y & 1) ? L.base : G.base, (y & 1) ? VF.SOLID : VF.METAL);
  // back tail
  for (let y = 42; y <= 50; y++) for (let x = 0; x <= 3; x++) m.set(x, y, -8, (y & 1) ? L.base : G.base);
  symm(m);
  // uraeus cobra
  rbox(m, -1, 57, 7, 0, 60, 8, G.base, 1, VF.METAL);
  m.set(0, 61, 8, G.hi, VF.METAL).set(-1, 59, 9, TOON.red.base).set(0, 59, 9, TOON.red.base);
  return m;
}

function tophat() {
  const K = TOON.black;
  const m = new VoxelModel('hat');
  for (let x = -11; x < 11; x++) for (let z = -10; z <= 9; z++) if ((ax(x) * ax(x)) / 121 + ((z + 0.5) * (z + 0.5)) / 100 <= 1) m.set(x, ax(x) >= 9.5 ? 60 : 59, z, K.base);
  for (let y = 60; y <= 74; y++) {
    const w = y <= 62 ? 8 : 7;
    for (let x = -w; x < w; x++)
      for (let z = -w; z < w - 1; z++) {
        const dx = w - ax(x) - 0.5, dz = Math.min(z + w, w - 2 - z);
        if (dx + dz < 2.5) continue;
        m.set(x, y, z, y >= 63 && y <= 65 ? TOON.red.base : y === 74 ? K.hi : K.base);
      }
  }
  rbox(m, 3, 64, 6, 5, 68, 6, TOON.white.base, 0); // a playing card in the band
  m.set(4, 66, 7, TOON.red.base);
  return m;
}

function banditHat() {
  const K = ramp(0x34302e, 0x242120, 0x4a4542, 0x141212);
  const m = stetson(K, TOON.silver, false);
  for (let x = -6; x < 6; x++) for (let z = -7; z <= 5; z++) m.del(x, 66, z); // flat-top gambler
  for (const [x, z] of [[0, 7], [-1, 7], [5, 6], [mx(5), 6], [7, 0], [mx(7), 0]] as [number, number][]) m.set(x, 61, z, TOON.silver.hi, VF.METAL);
  for (let i = 0; i < 7; i++) m.set(-8 - (i >> 2), 62 + i, -3 - (i >> 1), i > 4 ? TOON.white.base : TOON.red.base); // feather
  return m;
}

function buildHat(id: HatId, o: OutfitId) {
  switch (id) {
    case 'duck':
      return hatDuck();
    case 'sombrero':
      return sombrero();
    case 'nemes':
      return nemes();
    case 'tophat':
      return tophat();
    case 'bandit':
      return banditHat();
    case 'wig':
      return frogWigHat(36); // Mama Frog's fabulous wig
    default:
      return stetson(o === 'sheriff' ? ramp(0x5a4a3c, 0x45382c, 0x726050, 0x2c2218) : TOON.hat, o === 'sheriff' ? TOON.black : TOON.red);
  }
}
const HAT_TOP: Record<HatId, number> = { stetson: 67, duck: 76, sombrero: 72, nemes: 64, tophat: 75, bandit: 66, wig: FROG_WIG_TOP };

// ================================================================== RIG
/**
 * The LEGACY 1/36 build. It is no longer Sundown (the player is the HD build in
 * sundown.ts); it stays only as the base every humanoid enemy is cut from
 * (referenceSkeletonRig -> skeletonFigure). Do not change its proportions.
 */
export function legacyCowboyRig(look: CowboyLook = { hat: 'stetson', outfit: 'bare' }): RigSpec {
  const o = look.outfit;
  const OF = OUT[o];
  const sk = buildSkull();

  // ---- torso + garments
  const torso = buildTorso();
  if (o === 'duster' || o === 'sheriff') dusterTorso(torso, OF.coat, OF.trim);
  else if (o === 'poncho') ponchoTorso(torso, OF.coat);
  else if (o === 'vest') vestTorso(torso, OF.coat, OF.trim, false);
  else if (o === 'pharaoh') pharaohTorso(torso);
  if (o === 'sheriff') {
    sheriffStar(torso, 6, 38, 6);
    for (let y = 38; y <= 44; y++) torso.set(0, y, 4, TOON.black.base);
    torso.set(0, 44, 4, TOON.silver.hi, VF.METAL);
  }
  if (o !== 'sheriff' && o !== 'pharaoh') {
    const band = new VoxelModel('band');
    bandana(band, OF.band);
    band.forEach((x, y, z, c, f) => torso.set(x, y, z, c, f));
  }
  soften(torso, OF.coat);

  // ---- pelvis + belt
  const pelvis = buildPelvis();
  gunBelt(pelvis, OF.belt, o === 'pharaoh' ? TOON.gold : TOON.brass);

  // ---- arms
  const armL = buildUpperArm();
  if (o === 'duster' || o === 'sheriff') sleeve(armL, OF.coat, OF.trim);
  else if (o === 'pharaoh') for (let x = 7; x <= 9; x++) for (let z = -2; z <= 1; z++) if (x === 7 || x === 9 || z === -2 || z === 1) armL.set(x, 37, z, TOON.gold.base, VF.METAL).set(x, 38, z, TOON.gold.hi, VF.METAL);
  const foreL = buildForearm(true);
  const foreR = mirrorPart(buildForearm(false), 'fore_r');
  if (o === 'pharaoh')
    for (let x = 7; x <= 9; x++) for (let z = -2; z <= 1; z++) if (x === 7 || x === 9 || z === -2 || z === 1) {
      foreL.set(x, 28, z, TOON.gold.base, VF.METAL);
      foreR.set(mx(x), 28, z, TOON.gold.base, VF.METAL);
    }

  // ---- legs: bare bone feet for the reference look, boots/sandals with the outfits
  const thighL = buildThigh();
  const foot = o === 'bare' ? boneFoot : o === 'pharaoh' ? sandal : (m: VoxelModel) => cowboyBoot(m, OF.boot, true);
  const shinL = buildShin(foot);

  const hat = buildHat(look.hat, o);
  const topY = HAT_TOP[look.hat];

  const parts: PartSpec[] = [];
  const P = (name: string, model: VoxelModel, joint: V3, parent?: string) => {
    if (model.count > 0) parts.push({ name, model, pivot: joint, attach: joint, parent });
  };
  P('pelvis', pelvis, J.pelvis);
  P('torso', torso, J.waist, 'pelvis');
  P('head', sk.head, J.neck, 'torso');
  P('jaw', sk.jaw, J.jaw, 'head');
  P('eye_l', sk.eye_l, J.eye, 'head');
  P('eye_r', sk.eye_r, mg(J.eye), 'head');
  P('brow_l', sk.brow_l, J.brow, 'head');
  P('brow_r', sk.brow_r, mg(J.brow), 'head');
  P('hat', hat, J.hat, 'head');
  P('arm_l', armL, J.shoulder, 'torso');
  P('fore_l', foreL, J.elbow, 'arm_l');
  P('arm_r', mirrorPart(armL, 'arm_r'), mg(J.shoulder), 'torso');
  P('fore_r', foreR, mg(J.elbow), 'arm_r');
  P('thigh_l', thighL, J.hip, 'pelvis');
  P('shin_l', shinL, J.knee, 'thigh_l');
  P('thigh_r', mirrorPart(thighL, 'thigh_r'), mg(J.hip), 'pelvis');
  P('shin_r', mirrorPart(shinL, 'shin_r'), mg(J.knee), 'thigh_r');
  const coatPart = o === 'duster' || o === 'sheriff';
  if (coatPart) P('coat', dusterSkirt(OF.coat, OF.trim), [0, 29.5, -6.5], 'pelvis');
  if (o === 'pharaoh') P('coat', shendyt(), [0, 28.5, -5.5], 'pelvis');

  const poncho = o === 'poncho';
  const sock = (part: string, at: V3): SocketSpec => ({ part, at });
  const sockets: Record<string, SocketSpec> = {
    // identity rotation: gameplay adds its own holder for the gun
    hand_r: sock('fore_r', mg(J.hand)),
    hand_l: sock('fore_l', J.hand),
    head_top: sock('head', [0, 63, -1]),
    back: sock('torso', [0, 37, -7]),
    // Pinch perches on the left shoulder (on the humerus head / clavicle end)
    shoulder_l: sock('torso', [8, 44.5, -0.5]),
    shoulder_r: sock('torso', [-8, 44.5, -0.5]),
    hip_r: sock('pelvis', [-7.5, 25, 0.5]),
    chest: sock('torso', [0, 38, 4.5]),
    eye_l: sock('head', J.eye),
    eye_r: sock('head', mg(J.eye)),
    mouth: sock('jaw', [0, 47.5, 6]),
    hat_top: sock('hat', [0, topY, -1]),
    bandana_anchor: sock('torso', [0, 44.5, -7.5]),
    ...(poncho
      ? {
          coat_anchor_l: sock('torso', [11, 33, 0]),
          coat_anchor_r: sock('torso', [-11, 33, 0]),
          coat_anchor_back: sock('torso', [0, 33, -8]),
          coat_anchor_front: sock('torso', [0, 33, 6]),
        }
      : {
          coat_anchor_l: sock(coatPart ? 'coat' : 'pelvis', [10, 19.5, -2]),
          coat_anchor_r: sock(coatPart ? 'coat' : 'pelvis', [-10, 19.5, -2]),
          coat_anchor_back: sock(coatPart ? 'coat' : 'pelvis', [0, 19.5, -9]),
          coat_anchor_front: sock('pelvis', [0, 22, 3]),
        }),
  };
  const vs = SUNDOWN_VS;
  const mm = (p: V3) => [p[0] * vs, p[1] * vs, p[2] * vs];
  const clothCoat = coatPart || poncho;
  return {
    name: `cowboy_${look.hat}_${look.outfit}`,
    voxelSize: vs,
    parts,
    sockets,
    meta: {
      look,
      height: topY * vs,
      skullTop: (SKULL_TOP + 1) * vs,
      hatTop: topY * vs,
      radius: 0.32,
      hipY: J.hip[1] * vs,
      kneeY: J.knee[1] * vs,
      shoulderY: J.shoulder[1] * vs,
      elbowY: J.elbow[1] * vs,
      handY: J.hand[1] * vs,
      upperArmLen: (J.shoulder[1] - J.elbow[1]) * vs,
      foreArmLen: (J.elbow[1] - J.hand[1]) * vs,
      legLen: J.hip[1] * vs,
      facePivots: { eye_l: mm(J.eye), eye_r: mm(mg(J.eye)), brow_l: mm(J.brow), brow_r: mm(mg(J.brow)), jaw: mm(J.jaw) },
      // modelled eyeballs nested deep in dark warm-brown sockets (no 2D overlay)
      eyeColor: SOCK.top,
      eyes: 'voxel',
      expressions: defaultExpressions([...SUNDOWN_EXPRESSIONS]),
      cloth: {
        coat: clothCoat ? [OF.coat.base, OF.coat.shade, OF.trim.base] : undefined,
        coatStyle: poncho ? 'poncho' : clothCoat ? 'tails' : undefined,
        coatLen: o === 'sheriff' ? 0.56 : o === 'duster' ? 0.5 : poncho ? 0.3 : 0,
        coatWidth: poncho ? 0.6 : 0.5,
        bandana: o !== 'sheriff' && o !== 'pharaoh' ? [OF.band.base, OF.band.shade] : undefined,
        bandanaLen: 0.16,
      },
    },
  };
}

/** the bare reference skeleton (no hat, no gear) — used by previews / style checks */
export function referenceSkeletonRig(): RigSpec {
  const rig = legacyCowboyRig({ hat: 'stetson', outfit: 'bare' });
  const { hat_top: _hatTop, ...sockets } = rig.sockets ?? {};
  const skullTop = (SKULL_TOP + 1) * SUNDOWN_VS;
  return {
    ...rig,
    name: 'sundown_reference',
    parts: rig.parts.filter((p) => p.name !== 'hat').map((p) => (p.name === 'pelvis' ? { ...p, model: buildPelvis() } : p.name === 'torso' ? { ...p, model: buildTorso() } : p)),
    sockets,
    meta: { ...rig.meta, look: undefined, height: skullTop, hatTop: skullTop, cloth: undefined },
  };
}

// ================================================================== BASE FIGURE (every humanoid is built on Sundown's bones)
/** one bone part of the base figure, in shared rig space (pivot == attach, geometric voxel coords) */
export interface FigurePart {
  model: VoxelModel;
  pivot: V3;
  parent?: string;
}
/** the bare skeleton figure, ready to be dressed (husk, gunslinger, mummy, jackal, ...) */
export interface SkeletonFigure {
  /** metres per voxel for every model below (1/36) */
  voxelSize: number;
  /** named joints, geometric voxel coords; LEFT = +X, `_r` entries are the mirrored right side */
  joints: Record<string, V3>;
  /** bare bone parts: pelvis, torso, head, jaw, eye_l/r, brow_l/r, arm_l/r, fore_l/r, thigh_l/r, shin_l/r */
  parts: Record<string, FigurePart>;
  sockets: Record<string, SocketSpec>;
  meta: Record<string, any>;
}

/**
 * Sundown's bare figure as fresh, mutable per-part models + joints (no hat, belt,
 * bandana, boots or coat; bone feet). Paint/extend the models, add parts, then
 * call figureRig(). Part names, pivots, hierarchy and the 1/36 grid are stable.
 */
export function skeletonFigure(): SkeletonFigure {
  const rig = referenceSkeletonRig(); // builds new models on every call
  const parts: Record<string, FigurePart> = {};
  for (const p of rig.parts) parts[p.name] = { model: p.model, pivot: [...p.pivot] as V3, parent: p.parent };
  const joints: Record<string, V3> = {};
  for (const [k, v] of Object.entries(J)) {
    joints[k] = [...v] as V3;
    if (v[0] !== 0) joints[k + '_r'] = mg(v);
  }
  return { voxelSize: SUNDOWN_VS, joints, parts, sockets: { ...(rig.sockets ?? {}) }, meta: { ...rig.meta } };
}

/** assemble a (dressed) figure back into a RigSpec; parents are listed before their children */
export function figureRig(fig: SkeletonFigure, name: string, meta: Record<string, any> = {}): RigSpec {
  const out: PartSpec[] = [];
  const done = new Set<string>();
  const add = (n: string) => {
    if (done.has(n) || !fig.parts[n]) return;
    const p = fig.parts[n];
    if (p.parent) add(p.parent);
    done.add(n);
    if (p.model.count > 0) out.push({ name: n, model: p.model, pivot: p.pivot, attach: p.pivot, parent: p.parent });
  };
  for (const n of Object.keys(fig.parts)) add(n);
  return { name, voxelSize: fig.voxelSize, parts: out, sockets: fig.sockets, meta: { ...fig.meta, ...meta } };
}
