// Enemy humanoid helpers on top of the shared toon kit (../toon/humanoid.ts).
// Every helper authors in the kit's rig-global grid (1/30 layout: ground y=0,
// faces +Z, left = +X, mirror plane at column 0) so pieces drop straight onto
// kit parts. Bosses reuse the same layout with bigger voxels.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { TOON, Ramp } from '../style';
import { roundBox, roundBoxX, autoShade, mirrored, JOINT, mirrorV3 } from '../toon/humanoid';

export { roundBox, roundBoxX, autoShade, mirrored, JOINT, mirrorV3 };

export interface EnemyOpts {
  alpha?: boolean;
  variant?: number;
}
export const pickV = <T>(arr: T[], v: number) => arr[((v % arr.length) + arr.length) % arr.length];

// ------------------------------------------------------------------ hats (part 'hat', pivot JOINT.hat; brim sits on the skull)
export type HatStyle = 'cowboy' | 'bowler' | 'tall' | 'wide' | 'sombrero';
export function hatModel(style: HatStyle, R: Ramp, band: Ramp, o: { bullet?: boolean; feather?: Ramp; star?: Ramp; y0?: number } = {}) {
  const m = new VoxelModel('hat');
  const y = o.y0 ?? 50; // brim height: rests on the cranium top layers
  if (style === 'sombrero') {
    roundBox(m, -13, y, -12, 13, y, 12, R.base, 6);
    roundBox(m, -12, y + 1, -11, 12, y + 1, 11, R.base, 6);
    for (let x = -12; x <= 12; x++) for (let z = -11; z <= 11; z++) if (m.has(x, y + 1, z) && (Math.abs(x) >= 11 || Math.abs(z) >= 10 || Math.abs(x) + Math.abs(z) >= 16)) m.set(x, y + 2, z, R.hi); // upturned rim
    roundBox(m, -5, y + 1, -5, 5, y + 7, 5, R.base, 3);
    roundBox(m, -4, y + 8, -4, 4, y + 8, 4, R.base, 3);
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) if (m.has(x, y + 2, z) && Math.abs(x) <= 5 && Math.abs(z) <= 5) m.set(x, y + 2, z, band.base);
    for (const [x, z] of [[-5, 0], [5, 0], [0, 5], [0, -5]] as [number, number][]) m.set(x, y + 4, z, band.hi);
    autoShade(m, [R]);
    return m;
  }
  const brimR = style === 'wide' ? 12 : style === 'bowler' ? 9 : 11;
  const brimZ = style === 'wide' ? 11 : style === 'bowler' ? 8 : 10;
  roundBox(m, -brimR, y, -brimZ, brimR, y, brimZ, R.base, style === 'bowler' ? 4 : 3);
  if (style === 'cowboy' || style === 'wide') {
    // curled brim sides
    for (const s of [1, -1]) for (let z = -brimZ + 3; z <= brimZ - 3; z++) m.set(s * brimR, y + 1, z, R.base);
    const top = style === 'wide' ? 7 : 6;
    roundBox(m, -6, y + 1, -5, 6, y + top - 1, 5, R.base, 2);
    roundBox(m, -5, y + top, -4, 5, y + top, 4, R.base, 2);
    // centre crease
    for (let z = -3; z <= 3; z++) m.del(0, y + top, z);
    for (let z = -3; z <= 3; z++) m.set(0, y + top - 1, z, R.shade);
    // band
    for (let x = -6; x <= 6; x++) for (let z = -5; z <= 5; z++) if (m.has(x, y + 1, z) && (Math.abs(x) === 6 || Math.abs(z) === 5 || Math.abs(x) + Math.abs(z) >= 9)) m.set(x, y + 1, z, band.base);
  } else if (style === 'bowler') {
    roundBox(m, -6, y + 1, -6, 6, y + 4, 6, R.base, 3);
    roundBox(m, -5, y + 5, -5, 5, y + 6, 5, R.base, 3);
    roundBox(m, -3, y + 7, -3, 3, y + 7, 3, R.base, 2);
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) if (m.has(x, y + 1, z)) m.set(x, y + 1, z, band.base);
  } else if (style === 'tall') {
    roundBox(m, -6, y + 1, -5, 6, y + 10, 5, R.base, 2);
    roundBox(m, -5, y + 11, -4, 5, y + 11, 4, R.base, 2);
    for (let x = -6; x <= 6; x++) for (let z = -5; z <= 5; z++) if (m.has(x, y + 1, z)) { m.set(x, y + 1, z, band.base); m.set(x, y + 2, z, band.base); }
  }
  if (o.star) {
    m.set(0, y + 3, 6, o.star.hi, VF.METAL).set(-1, y + 3, 6, o.star.base, VF.METAL).set(1, y + 3, 6, o.star.base, VF.METAL).set(0, y + 4, 6, o.star.base, VF.METAL).set(0, y + 2, 6, o.star.base, VF.METAL);
  }
  if (o.feather) for (let i = 0; i < 5; i++) m.set(6 - (i >> 2), y + 2 + i, -2 - (i >> 1), i === 4 ? o.feather.hi : o.feather.base);
  if (o.bullet) m.del(3, y + 4, 5).del(3, y + 4, 4);
  autoShade(m, [R]);
  return m;
}

// ------------------------------------------------------------------ neckwear / belts / straps
/** neckerchief tied at the throat: a knot + triangle on the upper chest (torso part) */
export function bandana(torso: VoxelModel, R: Ramp) {
  roundBoxX(torso, -4, 34, -3, 4, 35, 4, R.base, 1);
  for (let i = 0; i < 4; i++) for (let x = -3 + i; x <= 3 - i; x++) torso.set(x, 33 - i, 4, i === 3 ? R.shade : R.base);
  torso.set(2, 35, 5, R.hi).set(3, 35, 5, R.base);
  return torso;
}
/** mask bandana over the lower face (head part) */
export function faceMask(head: VoxelModel, R: Ramp) {
  for (let y = 38; y <= 41; y++)
    for (let x = -7; x <= 7; x++)
      for (let z = -7; z <= 7; z++) {
        if (!head.has(x, y, z) && !(y <= 39 && Math.abs(x) <= 6 && z >= -6 && z <= 7)) continue;
        const edge = Math.abs(x) === 7 || z === 7 || z === -7 || (y <= 39 && (Math.abs(x) === 6 || z === 6 || z === 7));
        if (head.has(x, y, z) ? edge || head.has(x, y, z) : true) head.set(x, y, z, R.base);
      }
  // pointed tip hanging under the chin
  for (let i = 0; i < 3; i++) for (let x = -2 + i; x <= 2 - i; x++) head.set(x, 37 - i, 7, R.shade);
  return head;
}
/** belt around the pelvis with a buckle; optional bullet loops + holster on the right hip */
export function gunBelt(pelvis: VoxelModel, R: Ramp, buckle: Ramp, o: { loops?: boolean; holster?: boolean } = {}) {
  roundBox(pelvis, -6, 21, -4, 6, 22, 3, R.base, 1);
  roundBox(pelvis, -1, 21, 4, 1, 22, 4, buckle.base, 0, VF.METAL);
  pelvis.set(0, 21, 4, buckle.hi, VF.METAL);
  if (o.loops) for (let x = -5; x <= 5; x += 2) if (Math.abs(x) > 1) pelvis.set(x, 22, 4, TOON.brass.base, VF.METAL);
  if (o.holster) {
    roundBox(pelvis, -8, 16, -2, -7, 21, 1, R.shade, 1);
    pelvis.set(-8, 20, 2, TOON.iron.base, VF.METAL);
  }
  return pelvis;
}

// ------------------------------------------------------------------ weapons (RIGHT hand; pointing down along -Y at rest)
/** revolver held in the right fist, barrel pointing down (aims forward when the arm raises) */
export function revolverDown(m: VoxelModel, metal: Ramp, grip: Ramp, o: { long?: boolean; hand?: V3 } = {}) {
  const h = o.hand ?? mirrorV3(JOINT.hand);
  const x = Math.round(h[0] - 0.5), z = Math.round(h[2] - 0.5);
  // grip inside/behind the fist
  roundBox(m, x - 1, 12, z - 1, x, 14, z, grip.base, 0);
  // frame + cylinder block just below the fist
  roundBox(m, x - 1, 9, z - 1, x, 11, z + 1, metal.base, 0, VF.METAL);
  roundBox(m, x - 2, 9, z, x + 1, 10, z, metal.shade, 0, VF.METAL);
  // barrel
  const len = o.long ? 8 : 5;
  for (let y = 9 - len; y <= 8; y++) m.set(x - 1, y, z, metal.hi, VF.METAL).set(x, y, z, metal.base, VF.METAL);
  m.set(x - 1, 9 - len, z + 1, metal.base, VF.METAL); // front sight
  m.set(x, 12, z + 2, metal.shade, VF.METAL); // hammer
  return m;
}

/** lift a finished rig vertically (riders standing on boards) */
export function liftSpec(spec: RigSpec, dy: number, except: string[] = []) {
  for (const p of spec.parts) {
    if (except.includes(p.name)) continue;
    const src = p.model;
    const out = new VoxelModel(src.name);
    src.forEach((x, y, z, c, f) => out.set(x, y + dy, z, c, f));
    p.model = out;
    p.pivot = [p.pivot[0], p.pivot[1] + dy, p.pivot[2]];
    p.attach = [p.attach[0], p.attach[1] + dy, p.attach[2]];
  }
  for (const s of Object.values(spec.sockets ?? {})) {
    const part = spec.parts.find((q) => q.name === s.part);
    if (part && !except.includes(part.name)) s.at = [s.at[0], s.at[1] + dy, s.at[2]];
  }
  return spec;
}

/** tattered cloth flap hanging from a top edge (sawtooth bottom, deliberate pattern) */
export function flap(m: VoxelModel, x0: number, x1: number, yTop: number, len: number, z: number, R: Ramp, depth = 1) {
  for (let x = x0; x <= x1; x++) {
    const l = len - ((x - x0) % 3 === 1 ? 1 : 0);
    for (let i = 0; i < l; i++) for (let d = 0; d < depth; d++) m.set(x, yTop - i, z + d, i === l - 1 ? R.shade : R.base);
  }
  return m;
}
