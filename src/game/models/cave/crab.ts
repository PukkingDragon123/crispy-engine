// Crystal crab (+ alpha "the Geode Hermit") — STYLE v3 realistic creature, 1/36 m.
// A broad armoured cave crab (~1.7 m across the legs): a wide, low carapace with a
// toothed front margin, rocky mineral crust and calcite flecks, a pale underside
// and tucked abdomen, mouthparts (maxillipeds), eyes on stalks (glossy, modelled),
// two massive chelipeds (one bigger, crusher and cutter) whose movable fingers open,
// and four pairs of jointed walking legs with spiny tips. Big glowing crystal
// clusters grow out of the back as separate parts (horn_1 … horn_n), so they can be
// shot off one by one; until then they reflect shots.
//   v0: slate-blue shell, cyan crystals. v1: rust shell, teal crystals.
//   alpha: obsidian-black shell with violet crystals, more and bigger growths, a
//          crystal-studded crusher claw.
//
// Rig (scorpion convention so the insect animator walks it with a tetrapod gait):
//   body (root) → arm_l → pincer_l (+ _r); body → leg_l1 … leg_l4 (+ _r);
//   body → horn_1 … horn_n (crystal growths).
import type { RigSpec } from '../../../engine/voxel/Rig';
import { RBm, M3, VF, mix, mulRGB, hash3, noise, ell, cap, tube, paint, realFinish, compoundEye, lumpy, hollow, tubercles, ridge } from '../enemies/real/rk';
import { CRYSTAL, crystal, crystalSpray } from './kit';

export interface CrystalCrabOpts {
  alpha?: boolean;
  variant?: number;
}

const VS = 1 / 36;

interface Pal {
  shell: number;
  light: number;
  dark: number;
  crust: number;
  under: number;
  claw: number;
  tipC: number;
  cry: keyof typeof CRYSTAL;
}
const PALS: Pal[] = [
  { shell: 0x3e4a5e, light: 0x6a7c90, dark: 0x262e3c, crust: 0xb0a080, under: 0xc8b8a0, claw: 0x4a5670, tipC: 0x1a1a22, cry: 'cyan' },
  { shell: 0x6a4434, light: 0x9a6a4e, dark: 0x40281e, crust: 0xc0a884, under: 0xd8c4a8, claw: 0x7a4c38, tipC: 0x24160e, cry: 'teal' },
];
const ALPHA: Pal = { shell: 0x1e1c24, light: 0x46424e, dark: 0x0e0c12, crust: 0x6a5a7a, under: 0x8a7e8a, claw: 0x2a2632, tipC: 0x0a080c, cry: 'violet' };

/** the crystal growths on the back (part name, root point, lean, size): exported for the game logic */
export function crabCrystalParts(alpha: boolean) {
  return alpha ? ['horn_1', 'horn_2', 'horn_3', 'horn_4', 'horn_5', 'horn_6'] : ['horn_1', 'horn_2', 'horn_3', 'horn_4'];
}

export function crystalCrabRig(o: CrystalCrabOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % PALS.length) + PALS.length) % PALS.length;
  const pal = alpha ? ALPHA : PALS[v];
  const k = (m: number) => m;
  const rb = new RBm(alpha ? 'crystal_crab_alpha' : `crystal_crab_v${v}`, VS);
  const seed = alpha ? 61 : 17 + v * 9;
  const shellC = (x: number, y: number, z: number) => {
    const n = noise.n3(x * 0.16 + seed, y * 0.16, z * 0.16);
    const n2 = noise.n3(x * 0.42, y * 0.42 + seed, z * 0.42);
    let c = n > 0.3 ? mix(pal.shell, pal.light, 0.55) : n < -0.35 ? mix(pal.shell, pal.dark, 0.6) : pal.shell;
    if (n2 > 0.48) c = mix(c, pal.crust, 0.55); // mineral crust
    if (hash3(x + seed, y, z) < 0.018) c = 0xe0d8c8; // calcite fleck
    return c;
  };
  const cry = CRYSTAL[pal.cry];
  const by = 0.44;

  // ================================================================ body: carapace + underside
  const body = rb.pm('body', undefined, [0, by, 0]);
  ell(body, [0, by + 0.06, -0.02], [0.52, 0.17, 0.42], shellC, { keep: (lx, ly, lz) => ly > -0.35 && !(lz > 0.85 && Math.abs(lx) < 0.25) });
  ell(body, [0, by - 0.02, 0.0], [0.44, 0.1, 0.36], pal.under); // sternum / underside
  ell(body, [0, by - 0.06, -0.22], [0.22, 0.05, 0.16], mix(pal.under, pal.shell, 0.3)); // tucked abdomen
  // regions of the carapace: raised gastric region, branchial bulges, grooves
  ell(body, [0, by + 0.17, 0.05], [0.18, 0.08, 0.16], shellC);
  for (const sx of [1, -1]) ell(body, [sx * 0.28, by + 0.13, -0.08], [0.18, 0.08, 0.2], shellC);
  paint(body, (x, y, z) => y > by + 0.12 && Math.abs(Math.abs(x) - 0.16 - z * 0.15) < VS * 0.9, (x, y, z) => mulRGB(shellC(x, y, z), 0.7));
  // toothed front margin and lateral spines
  for (let t = -4; t <= 4; t++) {
    const a = t * 0.17;
    const p: M3 = [Math.sin(a) * 0.5, by + 0.08, Math.cos(a) * 0.38];
    cap(body, p, [Math.sin(a) * 0.58, by + 0.1, Math.cos(a) * 0.45], 0.03, VS * 0.6, shellC);
  }
  for (const sx of [1, -1]) for (let t = 0; t < 3; t++) cap(body, [sx * 0.5, by + 0.07, -0.05 - t * 0.1], [sx * 0.58, by + 0.08, -0.06 - t * 0.11], 0.025, VS * 0.6, shellC);
  lumpy(body.m, 4, 1, seed, 0.4);
  tubercles(body, 26, 0.02, (x, y, z) => mix(shellC(x, y, z), pal.crust, 0.4), (_x, y) => y > by + 0.1, seed);
  ridge(body, (x, y, z) => y > by + 0.2 && Math.abs(x) < 0.02 && z > -0.2 && z < 0.2, pal.light);
  // mouthparts: layered maxillipeds under the front edge
  for (let m = 0; m < 3; m++) ell(body, [0, by - 0.01 - m * 0.02, 0.36 - m * 0.015], [0.09 - m * 0.012, 0.025, 0.03], m % 2 ? pal.under : mix(pal.under, pal.claw, 0.4));
  // eye stalks with glossy compound eyes
  for (const sx of [1, -1]) cap(body, [sx * 0.09, by + 0.1, 0.33], [sx * 0.11, by + 0.2, 0.39], 0.024, 0.018, pal.claw);
  compoundEye(rb, 'eye_l', 'body', [0.112, by + 0.215, 0.395], 0.034, 1);
  compoundEye(rb, 'eye_r', 'body', [-0.112 - VS, by + 0.215, 0.395], 0.034, -1);
  if (body.m.count > 9000) hollow(body.m, 3);

  // ================================================================ crystal growths (separate, shootable parts)
  const spots: [M3, M3, number, number][] = alpha
    ? [[[0.0, by + 0.22, -0.02], [0, 1, -0.15], 0.85, 0], [[0.22, by + 0.18, 0.08], [0.6, 1, 0.2], 0.6, 1], [[-0.22, by + 0.18, 0.06], [-0.6, 1, 0.15], 0.62, 2], [[0.2, by + 0.16, -0.24], [0.4, 1, -0.6], 0.55, 3], [[-0.18, by + 0.17, -0.25], [-0.45, 1, -0.55], 0.5, 4], [[0.0, by + 0.2, 0.2], [0, 1, 0.5], 0.42, 5]]
    : [[[0.04, by + 0.22, -0.04], [0.1, 1, -0.2], 0.62, 0], [[0.24, by + 0.17, 0.02], [0.6, 1, 0.1], 0.42, 1], [[-0.22, by + 0.18, -0.02], [-0.55, 1, 0.0], 0.46, 2], [[-0.06, by + 0.18, -0.26], [-0.2, 1, -0.6], 0.36, 3]];
  spots.forEach(([root, dir, size, i]) => {
    const h = rb.pm(`horn_${i + 1}`, 'body', root);
    // a crusted socket of shell around the root
    ell(h, root, [size * 0.22, size * 0.1, size * 0.22], shellC);
    crystalSpray(h, root, dir, size, i % 2 && !alpha ? CRYSTAL[pal.cry === 'cyan' ? 'teal' : 'cyan'] : cry, seed + i * 7, 4 + (i % 2));
  });

  // ================================================================ chelipeds (left; mirrored, the right is bigger)
  for (const side of [1, -1] as const) {
    const big = side === -1 ? 1.45 : 1.22;
    const nm = side === 1 ? 'l' : 'r';
    const s = side;
    const base: M3 = [s * 0.36, by + 0.02, 0.28];
    const arm = rb.pm(`arm_${nm}`, 'body', base);
    const elbow: M3 = [s * 0.55, by + 0.1, 0.42];
    const wrist: M3 = [s * 0.6, by + 0.08, 0.62];
    tube(arm, [base, [s * 0.46, by + 0.08, 0.34], elbow], (t) => 0.07 * big - t * 0.01, shellC); // merus
    ell(arm, elbow, [0.065 * big, 0.06 * big, 0.065 * big], shellC);
    tube(arm, [elbow, wrist], (t) => 0.065 * big - t * 0.005, shellC); // carpus
    for (let sp = 0; sp < 4; sp++) cap(arm, [s * (0.5 + sp * 0.03), by + 0.13, 0.36 + sp * 0.07], [s * (0.53 + sp * 0.03), by + 0.19, 0.38 + sp * 0.07], 0.016, VS * 0.6, pal.light);
    // the propodus (palm) with the fixed finger
    const palm: M3 = [s * 0.63, by + 0.07, 0.8];
    ell(arm, palm, [0.12 * big, 0.11 * big, 0.17 * big], (x, y, z) => mix(shellC(x, y, z), pal.claw, 0.5));
    const fixTip: M3 = [s * 0.6, by - 0.02, 1.08 + (big - 1) * 0.2];
    tube(arm, [[s * 0.62, by + 0.0, 0.92], [s * 0.62, by - 0.02, 1.0], fixTip], (t) => 0.06 * big * (1 - t * 0.7), pal.claw);
    tube(arm, [fixTip, [s * 0.59, by + 0.0, fixTip[2] + 0.04]], () => 0.016, pal.tipC);
    for (let t = 0; t < 5; t++) arm.dot([s * 0.6, by + 0.025, 0.95 + t * 0.025], 0xe8e0d0); // teeth on the cutting edge
    if (alpha && side === -1) for (let c = 0; c < 3; c++) crystal(arm, [s * (0.6 + c * 0.02), by + 0.15, 0.72 + c * 0.07], [s * 0.4, 1, 0.2], 0.18 - c * 0.03, 0.03, cry, { seed: seed + 30 + c });
    // the movable finger (dactyl)
    const hinge: M3 = [s * 0.66, by + 0.12, 0.9];
    const dac = rb.pm(`pincer_${nm}`, `arm_${nm}`, hinge);
    const dTip: M3 = [s * 0.62, by + 0.08, 1.1 + (big - 1) * 0.2];
    tube(dac, [hinge, [s * 0.66, by + 0.15, 0.99], dTip], (t) => 0.05 * big * (1 - t * 0.7), pal.claw);
    tube(dac, [dTip, [s * 0.6, by + 0.05, dTip[2] + 0.03]], () => 0.015, pal.tipC);
    for (let t = 0; t < 4; t++) dac.dot([s * 0.63, by + 0.1, 0.97 + t * 0.03], 0xe8e0d0);
  }

  // ================================================================ walking legs (left; mirrored)
  const ANG = [0.55, 0.15, -0.25, -0.65];
  for (let i = 0; i < 4; i++) {
    const a = ANG[i];
    const dx = Math.cos(a), dz = Math.sin(a);
    const hip: M3 = [0.36 + Math.cos(a) * 0.04, by - 0.01, 0.08 - i * 0.1];
    const P = (t: number, y: number): M3 => [hip[0] + dx * 0.56 * t, y, hip[2] + dz * 0.56 * t];
    const knee = P(0.42, by + 0.24);
    const ank = P(0.78, 0.12);
    const toe = P(1.0, 0.0);
    const leg = rb.pm(`leg_l${i + 1}`, 'body', hip);
    tube(leg, [hip, P(0.2, by + 0.14), knee], (t) => 0.06 - t * 0.01, shellC); // merus rising
    ell(leg, knee, [0.055, 0.05, 0.055], pal.light);
    tube(leg, [knee, P(0.6, 0.24), ank], (t) => 0.05 - t * 0.01, shellC); // carpus + propodus
    tube(leg, [ank, toe], (t) => 0.034 * (1 - t * 0.75), pal.claw); // dactyl
    for (let sp = 0; sp < 3; sp++) leg.dot(P(0.55 + sp * 0.08, 0.3 - sp * 0.05 + 0.03), pal.light);
  }

  rb.mirrorLR();
  realFinish(rb, 0.8);
  void VF;
  return rb.build({ height: alpha ? 1.25 : 1.0, radius: 0.85, kind: 'crystal_crab', crystals: crabCrystalParts(alpha) });
}
