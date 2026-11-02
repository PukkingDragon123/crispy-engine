// Sandboards — STYLE v2 chunky cartoon boards at 1/32 m (~1.45 m long along Z).
// Rounded nose + tail kicks, clean deck art per style, two foot bindings.
// Returns { model, voxelSize, meta: { length, width, feet, deckTop } } (meters, pivot = centre).
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { autoShade } from '../toon/humanoid';

export type BoardId = 'driftwood' | 'cactus' | 'cyber' | 'bone' | 'scarab_gold' | 'serket';
export const BOARD_IDS: BoardId[] = ['driftwood', 'cactus', 'cyber', 'bone', 'scarab_gold', 'serket'];
export const BOARD_VOXEL = 1 / 32;
const VS = BOARD_VOXEL;
const HL = 23; // half length (z -23..22)
const HW = 6; // half width (x -6..6)
const FEET_Z = [-5, 5];

/** board outline: rounded-rectangle plan, kicked-up ends. calls paint(x,z,y) for each deck voxel column */
function shape(m: VoxelModel, deck: (x: number, z: number, top: boolean) => number, rail: number, under: number) {
  for (let z = -HL; z <= HL - 1; z++) {
    const end = Math.min(z + HL, HL - 1 - z); // 0 at the tips
    const hw = end === 0 ? HW - 3 : end === 1 ? HW - 2 : end === 2 ? HW - 1 : HW;
    const lift = end <= 1 ? 2 : end <= 3 ? 1 : 0;
    for (let x = -hw; x <= hw; x++) {
      const isRail = Math.abs(x) === hw;
      m.set(x, lift, z, isRail ? rail : under);
      m.set(x, lift + 1, z, isRail ? rail : deck(x, z, true));
    }
  }
}

function bindings(m: VoxelModel, strap: Ramp, buckle: Ramp) {
  for (const fz of FEET_Z) {
    for (let x = -HW + 1; x <= HW - 1; x++) {
      m.set(x, 2, fz - 1, strap.base).set(x, 2, fz + 1, strap.base);
      if (Math.abs(x) === HW - 1) m.set(x, 3, fz - 1, strap.shade).set(x, 3, fz + 1, strap.shade);
    }
    // pad between the straps
    for (let x = -3; x <= 3; x++) m.set(x, 2, fz, strap.dark);
    m.set(HW - 1, 3, fz, buckle.hi, VF.METAL);
  }
}

function driftwood(m: VoxelModel) {
  const W1 = TOON.wood, W2 = TOON.woodGrey;
  shape(m, (x, z) => {
    const plank = Math.floor((x + HW + 1) / 3) & 1;
    if ((z === -14 || z === 14) && Math.abs(x) < HW) return TOON.iron.shade; // iron bands
    if (((z + 40) % 9 === 0) && (x + HW) % 3 === 1) return W1.dark; // nail heads
    return plank ? W1.base : W2.base;
  }, W1.shade, W1.dark);
  for (const z of [-14, 14]) for (let x = -HW; x <= HW; x++) if (Math.abs(x) === HW) m.set(x, 1, z, TOON.iron.base, VF.METAL);
  bindings(m, { base: 0xc8a46a, shade: 0xa8844a, hi: 0xe0c08a, dark: 0x8a6a3a }, TOON.iron); // rope
}

function cactus(m: VoxelModel) {
  const C = TOON.cactus;
  shape(m, (x, z) => (Math.abs(x) === 2 || Math.abs(x) === 5 ? C.shade : z % 6 === 0 && Math.abs(x) === 4 ? TOON.linen.hi : C.base), C.dark, C.shade);
  // spines along the rails
  for (let z = -18; z <= 18; z += 4) for (const s of [1, -1]) m.set(s * (HW + 1), 1, z, TOON.linen.base);
  // flower on the nose
  m.set(0, 4, 20, TOON.flower.base).set(1, 4, 20, TOON.flower.hi).set(-1, 4, 20, TOON.flower.base).set(0, 4, 21, TOON.flower.base).set(0, 4, 19, TOON.flower.base).set(0, 5, 20, TOON.gold.hi);
  bindings(m, TOON.leather, TOON.brass);
}

function cyber(m: VoxelModel) {
  const K = { base: 0x2a2c38, shade: 0x1c1d26, hi: 0x3c3f50, dark: 0x101118 };
  shape(m, (x, z) => {
    if (Math.abs(x) === 4) return 0x2fd6e0; // teal racing lines (painted, no glow)
    if (Math.abs(z) % 8 === 3 && Math.abs(x) <= 2) return 0xff3e8a; // magenta chevrons
    if (z > 16 && Math.abs(x) <= 1) return 0xffd23a;
    return K.base;
  }, K.hi, K.dark);
  // underside fins
  for (const z of [-12, 12]) for (let y = -1; y <= -1; y++) for (let zz = z - 2; zz <= z + 2; zz++) m.set(0, y, zz, TOON.silver.base, VF.METAL);
  bindings(m, K, TOON.silver);
}

function bone(m: VoxelModel) {
  const B = TOON.bone;
  // a spine down the middle with rib slats
  shape(m, (x, z) => ((z + 40) % 3 === 0 ? B.shade : Math.abs(x) <= 1 ? B.hi : B.base), B.shade, B.dark);
  // gaps between ribs at the rails
  for (let z = -20; z <= 20; z += 3) for (const s of [1, -1]) m.del(s * HW, 1, z);
  // a little skull on the nose
  for (const [x, y, z, c] of [[-1, 3, 19, B.base], [0, 3, 19, B.base], [1, 3, 19, B.base], [-1, 3, 18, TOON.socket.dark], [1, 3, 18, TOON.socket.dark], [0, 3, 18, B.base], [0, 3, 17, B.hi]] as [number, number, number, number][]) m.set(x, y, z, c);
  bindings(m, TOON.leatherDark, TOON.iron);
}

function scarabGold(m: VoxelModel) {
  const G = TOON.gold, L = TOON.lapis;
  shape(m, (x, z) => {
    // lapis scarab inlay in the middle
    const ax = Math.abs(x), az = Math.abs(z);
    if (az <= 3 && ax <= 3 && !(ax === 3 && az === 3)) return az === 0 || ax === 0 ? G.shade : L.base;
    if (az <= 5 && ax === 4 && z > -2) return L.shade; // wings
    if (ax === 4) return L.base; // stripes
    return G.base;
  }, G.shade, G.dark);
  for (let z = -HL + 2; z <= HL - 3; z++) for (const s of [1, -1]) if (m.has(s * HW, 1, z)) m.set(s * HW, 1, z, G.shade, VF.METAL);
  bindings(m, L, G);
}

function serket(m: VoxelModel) {
  const A: Ramp = { base: 0xcf6a32, shade: 0xa44e22, hi: 0xec8c50, dark: 0x5e2810 };
  // segmented chitin plates with a venom stripe, stinger tail kick
  shape(m, (x, z) => ((z + 40) % 5 === 0 ? A.dark : Math.abs(x) === 0 ? TOON.serket.base : A.base), A.shade, A.dark);
  for (let i = 0; i < 4; i++) m.set(0, 4 + i, -HL - i + 1, i === 3 ? A.dark : A.base);
  m.set(0, 7, -HL + 3, A.dark).set(0, 6, -HL + 4, TOON.serket.hi);
  bindings(m, TOON.leatherDark, TOON.brass);
}

export function sandboardModel(style: BoardId = 'driftwood'): { model: VoxelModel; voxelSize: number; meta: Record<string, unknown> } {
  const m = new VoxelModel('board_' + style);
  ({ driftwood, cactus, cyber, bone, scarab_gold: scarabGold, serket } as Record<BoardId, (m: VoxelModel) => void>)[style](m);
  autoShade(m, [TOON.wood, TOON.woodGrey, TOON.cactus, TOON.bone, TOON.gold], { hi: false });
  return {
    model: m,
    voxelSize: VS,
    meta: { length: (HL * 2) * VS, width: (HW * 2 + 1) * VS, feet: FEET_Z.map((z) => [0, 3 * VS, z * VS]), deckTop: 2 * VS },
  };
}
