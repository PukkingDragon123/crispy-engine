// Sundown's revolver — STYLE v2 chunky cartoon six-shooter at 1/48 m.
// Parts: frame (root, pivot = grip centre), cylinder (pivot = axis centre, spins on Z),
// hammer (pivot = hinge), optional scope. Gun points along +Z, top is +Y.
// meta.muzzle / meta.ejector / meta.cylinderCenter are in the frame's voxel space.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, V3 } from '../../../engine/voxel/Rig';
import { TOON, Ramp } from '../style';
import { roundBox, autoShade } from '../toon/humanoid';

export interface GunParts {
  barrel: 'standard' | 'long' | 'snub' | 'serket';
  cylinder: 'standard' | 'venom' | 'gold' | 'bone';
  grip: 'wood' | 'bone' | 'ivory' | 'scarab';
  sight: 'none' | 'iron' | 'scope';
}
export const DEFAULT_GUN: GunParts = { barrel: 'standard', cylinder: 'standard', grip: 'wood', sight: 'iron' };
export const REVOLVER_VOXEL = 1 / 48;
const VS = REVOLVER_VOXEL;

const STEEL: Ramp = { base: 0x8f96a6, shade: 0x6c7282, hi: 0xbcc2ce, dark: 0x383c46 };
const M = VF.METAL;
const BARREL_END: Record<GunParts['barrel'], number> = { standard: 15, long: 21, snub: 10, serket: 16 };

/** box with its 4 edges parallel to Z cut (round-ish barrel / cylinder cross-section) */
function roundBoxZ(m: VoxelModel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: number, cut = 1, flags?: number) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const dx = Math.min(x - x0, x1 - x), dy = Math.min(y - y0, y1 - y);
      if (dx + dy < cut) continue;
      for (let z = z0; z <= z1; z++) m.set(x, y, z, col, flags);
    }
  return m;
}

function gripRamp(g: GunParts['grip']): Ramp {
  switch (g) {
    case 'bone':
      return TOON.bone;
    case 'ivory':
      return { base: 0xf4ecd8, shade: 0xd8ccb0, hi: 0xffffff, dark: 0xb0a284 };
    case 'scarab':
      return TOON.lapis;
    default:
      return { base: 0x9a5a32, shade: 0x7a4424, hi: 0xb87444, dark: 0x52280f };
  }
}

function frame(g: GunParts) {
  const m = new VoxelModel('frame');
  const end = BARREL_END[g.barrel];
  const G = gripRamp(g.grip);
  // grip: sloping back, side panels with checkering
  // big curved cartoon grip: sloping back, flaring at the butt
  const rows: [number, number, number][] = [[-1, -3, 3], [-2, -3, 3], [-3, -4, 3], [-4, -4, 3], [-5, -5, 3], [-6, -5, 3], [-7, -6, 4], [-8, -6, 4]];
  for (const [y, zb, d] of rows)
    for (let z = zb; z <= zb + d - 1; z++)
      for (let x = -1; x <= 1; x++) {
        const panel = Math.abs(x) === 1 && z > zb - 0 && y <= -2 && y >= -5;
        let c = G.base;
        if (panel) c = (y + z) & 1 ? G.base : G.shade;
        if (z === zb) c = G.shade;
        m.set(x, y, z, c);
      }
  // brass butt cap + grip screw
  for (let z = -6; z <= -3; z++) for (let x = -1; x <= 1; x++) m.set(x, -9, z, TOON.brass.base, M);
  m.set(1, -3, -3, TOON.brass.hi, M).set(-1, -3, -3, TOON.brass.hi, M);
  if (g.grip === 'scarab') for (const [y, z] of [[-3, -3], [-4, -3], [-3, -2]] as [number, number][]) m.set(1, y, z, TOON.gold.hi, M).set(-1, y, z, TOON.gold.hi, M);
  if (g.grip === 'ivory') m.set(1, -4, -3, TOON.gold.base, M).set(-1, -4, -3, TOON.gold.base, M);
  // frame: rear shield, bottom strap, top strap, front lug around the cylinder window (z 0..4)
  roundBox(m, -1, 0, -3, 1, 4, -1, STEEL.base, 0, M);
  for (let z = -3; z <= 6; z++) for (let x = -1; x <= 1; x++) m.set(x, -1, z, STEEL.shade, M);
  for (let z = -2; z <= 6; z++) m.set(0, 5, z, STEEL.hi, M).set(-1, 5, z, STEEL.base, M).set(1, 5, z, STEEL.base, M);
  roundBox(m, -1, 0, 5, 1, 4, 6, STEEL.base, 0, M);
  // trigger guard + trigger
  for (let z = -1; z <= 3; z++) m.set(0, -3, z, STEEL.base, M);
  m.set(0, -2, 3, STEEL.base, M).set(0, -2, -1, STEEL.base, M);
  m.set(0, -2, 1, TOON.brass.base, M);
  // barrel (square with cut edges) + ejector housing + muzzle hole
  roundBoxZ(m, -1, 2, 7, 1, 4, end, STEEL.base, 1, M);
  for (let z = 7; z <= end; z++) m.set(0, 4, z, STEEL.hi, M);
  for (let z = 7; z <= Math.max(7, end - 4); z++) m.set(0, 1, z, STEEL.shade, M);
  m.set(0, 3, end, STEEL.dark, M);
  if (g.sight !== 'none') {
    m.set(0, 5, end - 1, STEEL.hi, M); // front blade
    m.set(1, 6, -2, STEEL.base, M).set(-1, 6, -2, STEEL.base, M); // rear notch
  }
  if (g.barrel === 'serket') {
    // scorpion-tail rib along the barrel top, venom-green inlay
    for (let z = 8; z <= end - 1; z += 2) m.set(0, 5, z, 0xd27a34).set(0, 5, z + 1, 0xa65a22);
    m.set(0, 6, end - 1, 0x6a3214).set(0, 5, end + 1, 0x6a3214);
    for (let z = 8; z <= end - 2; z++) m.set(1, 3, z, TOON.serket.base).set(-1, 3, z, TOON.serket.base);
  }
  if (g.barrel === 'long') for (const z of [10, 16]) for (let x = -1; x <= 1; x++) m.set(x, 2, z, TOON.brass.base, M); // barrel bands
  autoShade(m, [STEEL, G], { hi: false });
  return { m, end };
}

function cylinder(kind: GunParts['cylinder']) {
  const m = new VoxelModel('cylinder');
  const R: Ramp = kind === 'gold' ? TOON.gold : kind === 'bone' ? TOON.bone : STEEL;
  const flags = kind === 'bone' ? undefined : M;
  roundBoxZ(m, -2, 0, 0, 2, 4, 4, R.base, 1, flags);
  // flutes: dark grooves between the chambers
  for (let z = 1; z <= 3; z++) {
    m.set(-2, 2, z, R.shade, flags).set(2, 2, z, R.shade, flags);
    m.set(0, 0, z, R.shade, flags).set(0, 4, z, R.hi, flags);
  }
  // chamber mouths on the front and back faces
  const chamber = kind === 'venom' ? TOON.serket.base : 0x24201c;
  for (const [x, y] of [[0, 4], [0, 0], [2, 3], [2, 1], [-2, 3], [-2, 1]] as [number, number][]) {
    if (!m.has(x, y, 4)) continue;
    m.set(x, y, 4, kind === 'venom' ? chamber : TOON.brass.base, kind === 'venom' ? undefined : M);
  }
  m.set(0, 2, 4, R.dark, flags).set(0, 2, 0, R.dark, flags);
  if (kind === 'bone') for (let z = 0; z <= 4; z += 2) m.set(-2, 2, z, TOON.bone.dark);
  return m;
}

function hammer() {
  const m = new VoxelModel('hammer');
  m.set(0, 4, -4, STEEL.base, M).set(0, 5, -4, STEEL.base, M).set(0, 6, -4, STEEL.base, M);
  m.set(0, 6, -5, STEEL.hi, M).set(0, 7, -5, STEEL.hi, M).set(0, 7, -6, STEEL.base, M);
  return m;
}

function scope(end: number) {
  const m = new VoxelModel('scope');
  const z1 = Math.min(end - 1, 12);
  roundBoxZ(m, -1, 7, -3, 1, 9, z1, TOON.brass.base, 1, M);
  for (let z = -3; z <= z1; z++) m.set(0, 9, z, TOON.brass.hi, M);
  for (const z of [-3, z1]) m.set(0, 8, z, 0x9fd6e8);
  for (const z of [-1, 6]) m.set(0, 6, z, STEEL.dark, M);
  // eye-cup + adjustment knob
  roundBoxZ(m, -1, 7, -4, 1, 9, -4, TOON.brass.shade, 1, M);
  m.set(0, 10, 3, TOON.brass.shade, M);
  return m;
}

export function revolverRig(g: GunParts = DEFAULT_GUN): RigSpec {
  const { m: fr, end } = frame(g);
  const GRIP: V3 = [0.5, -4, -3];
  const CYL: V3 = [0.5, 2.5, 2.5];
  const parts: PartSpec[] = [
    { name: 'frame', model: fr, pivot: GRIP, attach: [0, 0, 0] },
    { name: 'cylinder', model: cylinder(g.cylinder), pivot: CYL, attach: CYL, parent: 'frame' },
    { name: 'hammer', model: hammer(), pivot: [0.5, 4, -3.5], attach: [0.5, 4, -3.5], parent: 'frame' },
  ];
  if (g.sight === 'scope') parts.push({ name: 'scope', model: scope(end), pivot: [0.5, 7, 0.5], attach: [0.5, 7, 0.5], parent: 'frame' });
  const muzzle: V3 = [0.5, 3.5, end + 1];
  return {
    name: `revolver_${g.barrel}_${g.cylinder}_${g.grip}_${g.sight}`,
    voxelSize: VS,
    parts,
    sockets: { muzzle: { part: 'frame', at: muzzle }, ejector: { part: 'cylinder', at: [-2, 2.5, 2.5] } },
    meta: {
      muzzle,
      ejector: [-2, 2.5, 2.5] as V3,
      cylinderCenter: CYL,
      chambers: 6,
      length: (end + 7) * VS,
      parts: g,
      gripOffset: [0, 0, 0],
    },
  };
}
