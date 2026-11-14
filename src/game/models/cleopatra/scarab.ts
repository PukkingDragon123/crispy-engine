// The sun scarabs of "Golden Slumbers": small flying golden scarabs that pour
// out of Cleopatra's sleeves in glittering streams (instanced, two wing frames
// baked from the same sculpt: up-stroke and down-stroke). 1/96 m voxels, about
// 0.24 m long. Gold chitin with a blue-green sheen in the grooves, a carnelian
// sun bead on the pronotum, a toothed clypeus, raised elytra and spread amber
// hind wings with dark veins. Origin at the body centre, facing +Z.
import { KRig, VF, E, C, union, raster, rasterU, finish, pk, mixc, mulc, nS, type V3, type RigSpec, type Field } from './kit';

const VS = 1 / 96;
const GOLD = { hi: 0xfff0a0, base: 0xe8b440, shade: 0xa87a1e, sheen: 0x3a8a7a };

function build(frame: number): RigSpec {
  const rig = new KRig('cleo_scarab_' + frame, VS);
  const m = rig.part('body', undefined, [0, 0, 0]);
  const body = union(
    [
      E([0, 0.0, 0.035], [0.05, 0.028, 0.04]),
      E([0, 0.004, -0.04], [0.054, 0.03, 0.068]),
      E([0, -0.004, 0.083], [0.032, 0.016, 0.026]),
    ],
    0.012
  );
  rasterU(m, VS, body, (x, y, z, _nx, ny) => {
    if (Math.hypot(x, z - 0.035) < 0.014 && y > 0.015) return pk(0xd0402a, VF.EMISSIVE);
    if (Math.abs(x) < 0.004 && z < 0.0) return pk(GOLD.sheen, VF.METAL); // elytral suture
    const g = nS(x, y, z, 60, 3);
    return pk(ny > 0.6 ? GOLD.hi : g < -0.5 ? mixc(GOLD.base, GOLD.sheen, 0.4) : ny < -0.4 ? GOLD.shade : GOLD.base, VF.METAL);
  });
  // clypeus teeth
  for (let i = -2; i <= 2; i++) {
    const t = union([C([i * 0.011, -0.004, 0.1], [i * 0.013, -0.004, 0.112], 0.004, 0.002)], 0.002);
    rasterU(m, VS, t, () => pk(GOLD.hi, VF.METAL));
  }
  // six legs, tucked for flight
  for (const s of [1, -1])
    for (let l = 0; l < 3; l++) {
      const a: V3 = [s * 0.035, -0.02, 0.03 - l * 0.035];
      const b: V3 = [s * 0.07, -0.04, 0.02 - l * 0.05];
      const c: V3 = [s * 0.075, -0.05, -0.01 - l * 0.055];
      const f = union([C(a, b, 0.005, 0.004), C(b, c, 0.004, 0.003)], 0.002);
      rasterU(m, VS, f, () => pk(GOLD.shade, VF.METAL));
    }
  // raised elytra and spread hind wings (frame 0 = up-stroke, 1 = down-stroke)
  const lift = frame === 0 ? 0.55 : -0.25;
  for (const s of [1, -1]) {
    const hinge: V3 = [s * 0.012, 0.02, 0.02];
    const ely: Field = (x, y, z) => {
      // rotate about the hinge (z axis) by lift
      const px = (x - hinge[0]) * s, py = y - hinge[1];
      const c = Math.cos(lift + 0.5), sn = Math.sin(lift + 0.5);
      const lx = px * c + py * sn, ly = -px * sn + py * c;
      return Math.max(Math.hypot((lx - 0.035) / 0.035, (z + 0.03) / 0.065) - 1, Math.abs(ly) - 0.006) * 0.03;
    };
    raster(m, VS, [s > 0 ? 0 : -0.12, -0.04, -0.12], [s > 0 ? 0.12 : 0, 0.12, 0.06], ely, (_x, _y, _z, _nx, ny) => pk(ny > 0 ? GOLD.hi : GOLD.shade, VF.METAL));
    const wing: Field = (x, y, z) => {
      const px = (x - hinge[0]) * s, py = y - hinge[1] + 0.006;
      const c = Math.cos(lift * 0.6), sn = Math.sin(lift * 0.6);
      const lx = px * c + py * sn, ly = -px * sn + py * c;
      return Math.max(Math.hypot((lx - 0.085) / 0.09, (z + 0.035 + lx * 0.15) / 0.04) - 1, Math.abs(ly) - 0.004) * 0.03;
    };
    raster(m, VS, [s > 0 ? 0 : -0.22, -0.1, -0.12], [s > 0 ? 0.22 : 0, 0.15, 0.06], wing, (x, _y, z) => {
      const vein = Math.abs(Math.sin((Math.abs(x) * 1.2 + z) * 90)) < 0.18;
      return pk(vein ? 0x5a3a14 : mixc(0xffc860, 0xffe8b0, 0.3), vein ? VF.SOLID : VF.EMISSIVE);
    });
  }
  finish(m, 1.05, 0.88, (_c, f) => (f & VF.EMISSIVE) !== 0);
  return rig.build({ kind: 'cleo_scarab', frame });
}

const cache: (RigSpec | null)[] = [null, null];
/** a flying sun scarab, wing frame 0 (up) or 1 (down) */
export function cleoScarabRig(frame = 0): RigSpec {
  return (cache[frame] ??= build(frame));
}
void mulc;
