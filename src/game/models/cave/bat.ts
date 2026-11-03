// Giant cave bat (+ alpha "the Night Mother") — STYLE v3 realistic creature, 1/40 m,
// wingspan ~3.3 m. A heavy-bodied leaf-nosed bat: a dense furred body with a paler
// mantle, a short wrinkled muzzle with a ribbed nose-leaf and two dark nostrils,
// huge ribbed ears with pink-grey inner cups, small glossy modelled eyes, fangs in a
// snarl, a lower jaw with its own fangs and a pink tongue. Wings are real anatomy:
// a furred upper arm, forearm, a hooked thumb claw at the wrist, four long fingers
// (the leading-edge pair, the 4th and 5th) with knuckles, and a thin leathery
// membrane with veins stretched between them, scalloped along the trailing edge.
// Clawed feet for hanging, a calcar spur and a tail membrane.
//   v0: sooty brown with a tawny mantle. v1: ash grey with a silver mantle.
//   alpha: near-black frosted silver, blood-red eyes, torn membranes and violet
//          crystals grown through the shoulders and along the forearms.
//
// Rig (bird convention, so the flyer animator flaps it):
//   body (root) → head → jaw; body → wing_l → wing2_l (hand); body → leg_l → foot_l;
//   body → tail; head → eye_l / eye_r (modelled). Mirrored to _r.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { RBm, Sc, M3, VF, mix, mulRGB, hash3, noise, ell, cap, tube, paint, realFinish, mammalEye, fur, lumpy, cut } from '../enemies/real/rk';
import type { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { membraneC, sheetXZ, crystal, CRYSTAL } from './kit';

export interface CaveBatOpts {
  alpha?: boolean;
  variant?: number;
}

const VS = 1 / 40;

interface Pal {
  fur: number;
  furL: number;
  furD: number;
  mantle: number;
  skin: number;
  skinIn: number;
  mem: number;
  vein: number;
  bone: number;
  iris: number;
}
const PALS: Pal[] = [
  { fur: 0x3e2c24, furL: 0x6a4c38, furD: 0x231812, mantle: 0x9a7448, skin: 0x3a2a26, skinIn: 0x8a5e5a, mem: 0x2e2220, vein: 0x6a3a32, bone: 0x4a3a34, iris: 0x1a1210 },
  { fur: 0x4a4644, furL: 0x7a7470, furD: 0x2a2826, mantle: 0xb4aca0, skin: 0x3a3436, skinIn: 0x8e6a6a, mem: 0x34302e, vein: 0x6a4440, bone: 0x524a46, iris: 0x141212 },
];
const ALPHA: Pal = { fur: 0x1c1818, furL: 0x8a8a92, furD: 0x0c0a0a, mantle: 0xb8b8c4, skin: 0x221c1e, skinIn: 0x7a4a52, mem: 0x1e1818, vein: 0x5a2228, bone: 0x2e2626, iris: 0xd01a14 };

const N6: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** guard hairs: short tufts grown outward from exposed voxels (pred in voxel coords) */
function fuzz(m: VoxelModel, pred: (x: number, y: number, z: number) => boolean, col: (src: number, t: number) => number, density: number, len: number, seed: number) {
  const add: [number, number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    if (!pred(x, y, z) || hash3(x * 3.1 + seed, y * 5.3, z * 7.7) > density) return;
    const st = Math.floor(hash3(x, y + seed, z) * 6);
    for (let k = 0; k < 6; k++) {
      const [dx, dy, dz] = N6[(st + k) % 6];
      if (m.has(x + dx, y + dy, z + dz)) continue;
      const L = 1 + Math.floor(hash3(z, x + seed, y) * len);
      for (let l = 1; l <= L; l++) add.push([x + dx * l, y + dy * l, z + dz * l, col(c, l / L)]);
      break;
    }
  });
  for (const [x, y, z, c] of add) if (!m.has(x, y, z)) m.set(x, y, z, c);
}

export function caveBatRig(o: CaveBatOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % PALS.length) + PALS.length) % PALS.length;
  const pal = alpha ? ALPHA : PALS[v];
  const k = (m: number) => m * (alpha ? 1.06 : 1);
  const rb = new RBm(alpha ? 'cave_bat_alpha' : `cave_bat_v${v}`, VS);
  const furC = fur(pal.fur, pal.furL, pal.furD, VS, 3 + v, 'z');
  const mantleC = fur(pal.mantle, mix(pal.mantle, 0xffffff, 0.25), mix(pal.mantle, pal.fur, 0.5), VS, 9 + v, 'z');
  const tip = (src: number, t: number) => mix(src, alpha ? 0xd8d8e4 : pal.furL, 0.25 + t * 0.35);

  // ================================================================ body
  const by = k(0.56);
  const body = rb.pm('body', undefined, [0, by, 0]);
  ell(body, [0, by, -k(0.02)], [k(0.15), k(0.14), k(0.25)], furC);
  ell(body, [0, by + k(0.02), k(0.1)], [k(0.16), k(0.14), k(0.14)], furC); // deep chest (flight muscles)
  ell(body, [0, by + k(0.06), k(0.15)], [k(0.15), k(0.12), k(0.1)], mantleC); // the mantle / neck ruff
  ell(body, [0, by - k(0.04), -k(0.2)], [k(0.11), k(0.1), k(0.12)], furC); // rump
  lumpy(body.m, 4, 1, 5 + v, 0.42);
  // paler belly fur
  paint(body, (_x, y, z) => y < by - k(0.06) && z > -k(0.15), mix(pal.fur, pal.mantle, 0.35));
  fuzz(body.m, () => true, tip, 0.35, 2, 11 + v);
  if (alpha) {
    // violet crystals grown through the shoulders and down the spine
    crystal(body, [k(0.08), by + k(0.1), k(0.06)], [0.5, 1, -0.3], k(0.22), k(0.03), CRYSTAL.violet, { seed: 1 });
    crystal(body, [-k(0.08), by + k(0.1), k(0.06)], [-0.5, 1, -0.3], k(0.2), k(0.028), CRYSTAL.violet, { seed: 2 });
    for (let s = 0; s < 3; s++) crystal(body, [0, by + k(0.1), -k(0.04) - s * k(0.07)], [0, 1, -0.4], k(0.13 - s * 0.02), k(0.02), CRYSTAL.violet, { seed: 3 + s });
  }

  // ================================================================ head
  const head = rb.pm('head', 'body', [0, by + k(0.07), k(0.2)]);
  const hc: M3 = [0, by + k(0.1), k(0.31)];
  ell(head, hc, [k(0.1), k(0.09), k(0.1)], furC);
  // short wrinkled muzzle (bare, darker skin) and cheek fur
  const mz: M3 = [0, by + k(0.065), k(0.42)];
  ell(head, mz, [k(0.066), k(0.056), k(0.075)], pal.skin);
  ell(head, [0, by + k(0.08), k(0.37)], [k(0.09), k(0.06), k(0.06)], furC);
  for (let w = 0; w < 4; w++) paint(head, (x, y, z) => z > k(0.38) && y > by + k(0.08) && Math.abs(z - k(0.4) - w * k(0.022) + Math.abs(x) * 0.25) < VS * 0.6, mulRGB(pal.skin, 0.7)); // snout wrinkles
  // nose-leaf: a ribbed lancet standing above the nostrils
  const nl: M3 = [0, by + k(0.115), k(0.485)];
  ell(head, nl, [k(0.034), k(0.055), k(0.013)], pal.skin, { rot: [-0.2, 0, 0] });
  ell(head, [0, by + k(0.08), k(0.49)], [k(0.042), k(0.02), k(0.016)], pal.skin);
  for (let r = 0; r < 3; r++) paint(head, (x, y, z) => z > k(0.48) && Math.abs(y - (by + k(0.1) + r * k(0.018))) < VS * 0.5 && Math.abs(x) < k(0.03), mulRGB(pal.skin, 0.72));
  head.dot([k(0.014), by + k(0.07), k(0.5)], 0x0a0606).dot([-k(0.014) - VS, by + k(0.07), k(0.5)], 0x0a0606); // nostrils
  // upper lip and fangs
  ell(head, [0, by + k(0.035), k(0.445)], [k(0.06), k(0.016), k(0.05)], mulRGB(pal.skin, 0.85));
  for (const sx of [1, -1]) {
    cap(head, [sx * k(0.032), by + k(0.03), k(0.465)], [sx * k(0.03), by - k(0.02), k(0.47)], k(0.011), VS * 0.5, 0xf2ead8);
    head.dot([sx * k(0.016), by + k(0.025), k(0.48)], 0xe4dccb); // incisors
  }
  // the ears: big ribbed cups, outer fur-dark skin, inner pink-grey, tragus
  for (const sx of [1, -1]) {
    const ec: M3 = [sx * k(0.12), by + k(0.3), k(0.28)];
    const rot: M3 = [-0.15, sx * 0.45, -sx * 0.32];
    ell(head, ec, [k(0.07), k(0.16), k(0.03)], pal.skin, { rot });
    ell(head, [ec[0] + sx * k(0.004), ec[1] - k(0.01), ec[2] + k(0.02)], [k(0.056), k(0.14), k(0.022)], 0, { rot, carve: true });
    // inner cup colour + horizontal ribs
    paint(head, (x, y, z) => Math.abs(x - ec[0]) < k(0.08) && y > by + k(0.17) && z > ec[2] - k(0.005), (x, y) => (Math.abs(Math.sin((y * VS) * 95)) < 0.22 ? mulRGB(pal.skinIn, 0.78) : pal.skinIn));
    // the root of the ear is furred
    ell(head, [sx * k(0.075), by + k(0.17), k(0.29)], [k(0.04), k(0.05), k(0.04)], furC);
    // tragus
    cap(head, [sx * k(0.095), by + k(0.16), k(0.32)], [sx * k(0.1), by + k(0.24), k(0.33)], k(0.012), VS * 0.6, pal.skinIn);
    if (alpha) cut(head, (x, y, z) => Math.abs(x - ec[0] - sx * k(0.03)) < k(0.03) && y > by + k(0.36) && y < by + k(0.4) && z > ec[2] - k(0.05)); // a nick torn from the rim
  }
  fuzz(head.m, (x, y, z) => z * VS < k(0.38) && y * VS < by + k(0.18), tip, 0.32, 1, 21 + v);
  // brow tufts over the eyes
  for (const sx of [1, -1]) ell(head, [sx * k(0.06), by + k(0.135), k(0.39)], [k(0.03), k(0.014), k(0.02)], pal.furD);
  // modelled glossy eyes
  mammalEye(rb, 'eye_l', 'head', [k(0.064), by + k(0.105), k(0.405)], k(0.019), [0.55, 0.15, 1], { iris: alpha ? pal.iris : 0x2a1a12, lid: pal.skin, pupil: 0x050303 });
  if (alpha) {
    const e = rb.sc('eye_l');
    paint(e, () => true, (x, y, z) => (hash3(x, y, z) < 0.4 ? 0xff4a2a : 0xd01a14), VF.GLOW);
  }

  // ================================================================ jaw
  const jaw = rb.pm('jaw', 'head', [0, by + k(0.03), k(0.37)]);
  ell(jaw, [0, by + k(0.012), k(0.42)], [k(0.048), k(0.02), k(0.065)], mulRGB(pal.skin, 0.9));
  ell(jaw, [0, by + k(0.022), k(0.425)], [k(0.034), k(0.01), k(0.05)], 0xc06a72); // tongue
  for (const sx of [1, -1]) cap(jaw, [sx * k(0.026), by + k(0.025), k(0.465)], [sx * k(0.024), by + k(0.06), k(0.462)], k(0.008), VS * 0.5, 0xf2ead8);
  ell(jaw, [0, by - k(0.004), k(0.4)], [k(0.05), k(0.018), k(0.05)], furC); // chin fur

  // ================================================================ wings (left; mirrored)
  const mem = membraneC(pal.mem, pal.vein, VS, 7 + v);
  const boneC = (x: number, y: number, z: number) => (hash3(x, y, z) < 0.3 ? mulRGB(pal.bone, 1.15) : pal.bone);
  const sh: M3 = [k(0.12), by + k(0.04), k(0.05)];
  const elb: M3 = [k(0.42), by + k(0.07), -k(0.04)];
  const wr: M3 = [k(0.8), by + k(0.06), k(0.06)];
  const wing = rb.pm('wing_l', 'body', sh);
  ell(wing, [k(0.2), by + k(0.04), k(0.03)], [k(0.09), k(0.055), k(0.06)], furC); // furred upper arm muscle
  tube(wing, [sh, [k(0.28), by + k(0.07), 0], elb], (t) => k(0.03) - t * k(0.008), boneC);
  ell(wing, elb, [k(0.026), k(0.026), k(0.026)], mulRGB(pal.bone, 1.1));
  tube(wing, [elb, [k(0.62), by + k(0.075), k(0.0)], wr], (t) => k(0.022) - t * k(0.006), boneC);
  const memY = (x: number, z: number) => by + k(0.055) + (x - k(0.1)) * 0.03 - Math.max(0, -z - k(0.05)) * 0.12 + Math.sin(x * 9) * 0.006;
  // propatagium (front of the arm) + plagiopatagium (behind it) with a scalloped trailing edge
  const armPoly: [number, number][] = [
    [k(0.11), k(0.1)], [k(0.45), k(0.04)], [k(0.79), k(0.1)], [k(0.8), k(0.06)], [k(0.96), -k(0.5)],
    [k(0.74), -k(0.4)], [k(0.5), -k(0.42)], [k(0.3), -k(0.34)], [k(0.16), -k(0.33)], [k(0.08), -k(0.24)],
  ];
  sheetXZ(wing, armPoly, memY, mem);
  // fur reaching out onto the membrane near the body
  paint(wing, (x, _y, z) => x < k(0.2) && z > -k(0.2), furC);
  if (alpha) {
    // torn holes and violet crystals along the forearm
    for (let h = 0; h < 3; h++) ell(wing, [k(0.4 + h * 0.15), by + k(0.05), -k(0.22 - h * 0.03)], [k(0.035), k(0.05), k(0.03)], 0, { carve: true });
    for (let c = 0; c < 3; c++) crystal(wing, [k(0.5 + c * 0.1), by + k(0.09), k(0.0 + c * 0.02)], [0.2, 1, 0.3], k(0.12 - c * 0.02), k(0.018), CRYSTAL.violet, { seed: 9 + c });
  }

  const hand = rb.pm('wing2_l', 'wing_l', wr);
  ell(hand, wr, [k(0.028), k(0.024), k(0.028)], mulRGB(pal.bone, 1.1));
  // thumb with a hooked claw
  const th: M3 = [k(0.86), by + k(0.08), k(0.15)];
  tube(hand, [wr, th], () => k(0.012), boneC);
  tube(hand, [th, [k(0.885), by + k(0.07), k(0.19)], [k(0.88), by + k(0.04), k(0.205)]], (t) => k(0.011) * (1 - t * 0.7), 0x1a1412);
  // fingers: leading-edge pair (2+3), 4th, 5th, each with a knuckle
  const fingers: [M3, M3][] = [
    [[k(1.2), by + k(0.075), k(0.075)], [k(1.64), by + k(0.06), k(0.0)]],
    [[k(1.16), by + k(0.065), -k(0.15)], [k(1.42), by + k(0.045), -k(0.45)]],
    [[k(0.97), by + k(0.06), -k(0.22)], [k(1.0), by + k(0.045), -k(0.57)]],
  ];
  for (const [kn, tp] of fingers) {
    tube(hand, [wr, kn], () => k(0.012), boneC);
    ell(hand, kn, [k(0.014), k(0.014), k(0.014)], mulRGB(pal.bone, 1.15));
    tube(hand, [kn, tp], (t) => k(0.011) * (1 - t * 0.6), boneC);
  }
  // the leading edge carries a second thin digit
  tube(hand, [[k(0.84), by + k(0.07), k(0.09)], [k(1.2), by + k(0.08), k(0.1)], [k(1.48), by + k(0.07), k(0.05)]], () => k(0.008), boneC);
  const handPoly: [number, number][] = [
    [k(0.79), k(0.09)], [k(1.2), k(0.11)], [k(1.5), k(0.06)], [k(1.64), k(0.0)],
    [k(1.4), -k(0.13)], [k(1.42), -k(0.45)], [k(1.13), -k(0.35)], [k(1.0), -k(0.57)], [k(0.93), -k(0.5)], [k(0.79), k(0.04)],
  ];
  sheetXZ(hand, handPoly, (x, z) => memY(x, z) - (x - k(0.8)) * 0.035, mem);
  if (alpha) for (let h = 0; h < 2; h++) ell(hand, [k(1.15 + h * 0.15), by + k(0.04), -k(0.2 + h * 0.07)], [k(0.04), k(0.06), k(0.03)], 0, { carve: true });

  // ================================================================ legs, feet, tail
  const hip: M3 = [k(0.08), by - k(0.06), -k(0.22)];
  const leg = rb.pm('leg_l', 'body', hip);
  const ank: M3 = [k(0.12), by - k(0.16), -k(0.36)];
  tube(leg, [hip, [k(0.14), by - k(0.12), -k(0.3)], ank], (t) => k(0.026) - t * k(0.012), (x, y, z) => furC(x, y, z) as number);
  // calcar spur toward the tail
  tube(leg, [ank, [k(0.07), by - k(0.15), -k(0.43)]], (t) => k(0.006) * (1 - t * 0.5), pal.bone);
  const foot = rb.pm('foot_l', 'leg_l', ank);
  ell(foot, [ank[0], ank[1] - k(0.012), ank[2] - k(0.02)], [k(0.02), k(0.016), k(0.026)], pal.skin);
  for (let t = 0; t < 5; t++) {
    const dx = (t - 2) * k(0.009);
    tube(foot, [[ank[0] + dx, ank[1] - k(0.015), ank[2] - k(0.035)], [ank[0] + dx * 1.3, ank[1] - k(0.02), ank[2] - k(0.06)], [ank[0] + dx * 1.3, ank[1] - k(0.045), ank[2] - k(0.055)]], (q) => k(0.006) * (1 - q * 0.6), q2(t));
  }
  function q2(t: number) {
    return t % 2 ? 0x141010 : 0x1c1614;
  }
  const tail = rb.pm('tail', 'body', [0, by - k(0.04), -k(0.3)]);
  tube(tail, [[0, by - k(0.04), -k(0.3)], [0, by - k(0.06), -k(0.42)], [0, by - k(0.07), -k(0.5)]], (t) => k(0.013) * (1 - t * 0.6), pal.bone);
  sheetXZ(tail, [[-k(0.12), -k(0.3)], [k(0.12), -k(0.3)], [k(0.06), -k(0.47)], [0, -k(0.52)], [-k(0.06), -k(0.47)]], () => by - k(0.06), mem);

  rb.mirrorLR();
  realFinish(rb, 0.7);
  void noise;
  return rb.build({ height: k(0.75), radius: k(0.5), wingspan: k(3.3), kind: 'cave_bat', flying: true, headY: by + k(0.1) });
}
