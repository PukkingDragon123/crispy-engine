// Realistic scarab / dung-beetle builder (STYLE v3): smooth convex pronotum and
// elytra with striae, suture and margins; toothed shovel clypeus; lamellate
// antennae; digging fore-tibiae with teeth; spined mid/hind legs with segmented
// tarsi and claws; hollow elytra that can open over the abdomen.
// Rig: body (root), head, jaw, wing_l/wing_r, leg_l1..3 / leg_r1..3, eye_l/eye_r.
import type { RigSpec } from '../../../../engine/voxel/Rig';
import { RBm, Sc, M3, VF, mix, mulRGB, hash3, noise, ell, cap, tube, paint, cut, realFinish, chitin, irid, dung, compoundEye, hollow, lumpy, ridge, tubercles, bands, rope, loopPts } from './rk';
import type { ColorFn } from './rk';

export interface RealBeetle {
  name: string;
  vs: number;
  /** body length in meters */
  len: number;
  shell: ColorFn;
  shellMetal?: boolean;
  under: number;
  leg: number;
  /** tarsus / teeth tint */
  claw: number;
  /** head horn length factor */
  horn?: number;
  /** pronotal horns (alpha) */
  pronHorns?: boolean;
  /** body width factor */
  wide?: number;
  /** scratched, battle-worn shell */
  scars?: boolean;
  /** faint embossed sun disk on the elytra */
  sunDisk?: number;
  dungCrust?: boolean;
  boss?: boolean;
  extra?: (rb: RBm, u: (k: number) => number, bodyY: number) => void;
  meta?: Record<string, unknown>;
}

export function realBeetleRig(st: RealBeetle): RigSpec {
  const VS = st.vs;
  const L = st.len;
  const W = st.wide ?? 1;
  const u = (k: number) => k * L;
  const rb = new RBm(st.name, VS);
  const bodyY = u(0.26);
  const under = chitin(st.under, mix(st.under, 0x6a6a70, 0.35), VS, 2, { punct: 0.04 });
  const legC = chitin(st.leg, mix(st.leg, 0x8a7060, 0.3), VS, 5, { cell: 0.04 });
  const clawC = chitin(st.claw, mix(st.claw, 0xc08a5a, 0.4), VS, 6, { cell: 0.03 });
  const fl = VF.METAL; // all chitin is glossy

  // ------------------------------------------------------------ body: abdomen, thorax, pronotum
  const body = rb.pm('body', undefined, [0, bodyY, 0]);
  ell(body, [0, bodyY - u(0.03), -u(0.12)], [u(0.25) * W, u(0.1), u(0.31)], under, { keep: (_x, ly) => ly < 0.55 });
  lumpy(body.m, 5, 1, 2, 0.38);
  // abdominal sternites: overlapping plates with dark seams
  paint(body, (_x, y, z) => z < u(0.02) && y < bodyY - u(0.05) && Math.abs(((z + 10) / u(0.065)) % 1) < 0.18, mulRGB(st.under, 0.55));
  ell(body, [0, bodyY - u(0.03), u(0.07)], [u(0.19) * W, u(0.085), u(0.14)], under); // meso/metathorax
  // pronotum: broad convex shield, front notched for the head
  ell(body, [0, bodyY + u(0.035), u(0.17)], [u(0.29) * W, u(0.135), u(0.15)], st.shell, { keep: (_x, ly) => ly > -0.42, fl });
  ell(body, [0, bodyY + u(0.035), u(0.33)], [u(0.15) * W, u(0.13), u(0.07)], 0, { carve: true });
  // pronotal margin (rim) and fine median line
  paint(body, (x, y, z) => {
    const lx = x / (u(0.29) * W), ly = (y - bodyY - u(0.035)) / u(0.135), lz = (z - u(0.17)) / u(0.15);
    return z > u(0.04) && lx * lx + ly * ly + lz * lz > 0.8 && ly < 0.1;
  }, (x, y, z) => mulRGB(st.shell(x, y, z) as number, 0.7));
  paint(body, (x, y, z) => Math.abs(x) < VS && y > bodyY + u(0.1) && z > u(0.08), (x, y, z) => mulRGB(st.shell(x, y, z) as number, 0.82));
  ridge(body, (x, y, z) => {
    const lx = x / (u(0.29) * W), ly = (y - bodyY - u(0.035)) / u(0.135), lz = (z - u(0.17)) / u(0.15);
    return z > u(0.05) && lx * lx + ly * ly + lz * lz > 0.82 && ly < 0.05 && ly > -0.4;
  }, (x, y, z) => mulRGB(st.shell(x, y, z) as number, 0.8));
  if (st.pronHorns || st.boss) tubercles(body, 26, u(0.012), st.shell, (_x, y, z) => y > bodyY + u(0.1) && z > u(0.06), 3);
  if (st.pronHorns) {
    for (const sx of [-1, 1]) tube(body, [[sx * u(0.11), bodyY + u(0.13), u(0.2)], [sx * u(0.13), bodyY + u(0.2), u(0.27)], [sx * u(0.11), bodyY + u(0.23), u(0.33)]], (t) => u(0.022) * (1 - t * 0.75), st.shell, fl);
    tube(body, [[0, bodyY + u(0.15), u(0.17)], [0, bodyY + u(0.24), u(0.27)], [0, bodyY + u(0.28), u(0.4)], [0, bodyY + u(0.25), u(0.52)], [0, bodyY + u(0.2), u(0.56)]], (t) => u(0.032) * (1 - t * 0.8), st.shell, fl);
  }
  // scutellum: small triangle between the elytra bases
  for (let k = 0; k < 4; k++) body.box([-u(0.03) + k * VS * 0.5, bodyY + u(0.1), u(0.02) - k * VS], [u(0.03) - k * VS * 0.5, bodyY + u(0.12), u(0.025) - k * VS], st.shell, fl);
  if (st.dungCrust) paint(body, (_x, y) => y < bodyY - u(0.02) && noise.n3(_x * 30, y * 30, 3) > 0.15, dung(0x5a4026, VS, 7));

  // ------------------------------------------------------------ elytra: hollow convex covers hinged at the front
  const hinge: M3 = [VS, bodyY + u(0.11), u(0.04)];
  const wl = rb.pm('wing_l', 'body', hinge);
  const ec: M3 = [0, bodyY + u(0.04), -u(0.12)];
  const er: M3 = [u(0.285) * W, u(0.175), u(0.335)];
  ell(wl, ec, er, st.shell, { keep: (lx, ly) => lx >= 0 && ly > -0.4, fl });
  ell(wl, [ec[0], ec[1] - u(0.012), ec[2]], [er[0] - VS * 2, er[1] - VS * 2, er[2] - VS * 2], 0, { carve: true });
  // striae (fine longitudinal grooves following the dome), suture and epipleural margin
  // raised striae (real geometry, every 0.042L), darker grooves between them
  ridge(wl, (x, y) => y > ec[1] - u(0.03) && ((x / u(0.042)) % 1) < 0.13 && x > u(0.03));
  paint(wl, (x, y) => y > ec[1] - u(0.02) && ((x / u(0.042)) % 1) > 0.45 && ((x / u(0.042)) % 1) < 0.62 && x > u(0.02), (x, y, z) => mulRGB(st.shell(x, y, z) as number, 0.78));
  // humeral callus (shoulder bump) and apical callus near the tip
  ell(wl, [u(0.22) * W, bodyY + u(0.12), u(0.0)], [u(0.05), u(0.04), u(0.06)], st.shell, { fl });
  ell(wl, [u(0.12) * W, bodyY + u(0.07), -u(0.4)], [u(0.05), u(0.035), u(0.05)], st.shell, { fl });
  paint(wl, (x) => x < VS * 1.01, (x, y, z) => mulRGB(st.shell(x, y, z) as number, 0.62));
  paint(wl, (_x, y) => y < ec[1] - u(0.035), (x, y, z) => mulRGB(st.shell(x, y, z) as number, 0.68));
  paint(wl, (x, y, z) => y > ec[1] + er[1] * 0.72 && Math.abs(x - u(0.11) * W) < u(0.045) && z > ec[2] - er[2] * 0.6, (x, y, z) => mix(st.shell(x, y, z) as number, 0xd8dce4, 0.16), VF.METAL);
  if (st.sunDisk) {
    paint(wl, (x, y, z) => y > ec[1] + u(0.12) && Math.hypot(x, z + u(0.13)) > u(0.08) && Math.hypot(x, z + u(0.13)) < u(0.1), (x, y, z) => mix(st.shell(x, y, z) as number, 0xc89a40, st.sunDisk!), VF.METAL);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI - Math.PI / 2;
      paint(wl, (x, y, z) => y > ec[1] + u(0.1) && Math.abs(Math.atan2(x, -(z + u(0.13))) - a) < 0.08 && Math.hypot(x, z + u(0.13)) < u(0.15) && Math.hypot(x, z + u(0.13)) > u(0.11), (x, y, z) => mix(st.shell(x, y, z) as number, 0xc89a40, st.sunDisk! * 0.8), VF.METAL);
    }
  }
  if (st.scars) {
    for (let k = 0; k < 5; k++) {
      const z0 = -u(0.35) + k * u(0.12) + hash3(k, 3, 9) * u(0.05);
      paint(wl, (x, y, z) => y > ec[1] && Math.abs(z - z0 - (x - u(0.1)) * 0.7) < VS * 0.8 && x > u(0.04) && x < u(0.24), 0x8a7a70);
    }
  }

  // ------------------------------------------------------------ head: capsule, shovel clypeus with teeth, eyes, antennae
  const hp: M3 = [0, bodyY + u(0.01), u(0.3)];
  const head = rb.pm('head', 'body', hp);
  const headC = chitin(mulRGB(st.leg, 1.05), mix(st.leg, 0x7a7068, 0.4), VS, 9, { punct: 0.1 });
  ell(head, [0, bodyY - u(0.005), u(0.355)], [u(0.15) * W, u(0.065), u(0.095)], headC);
  ell(head, [0, bodyY - u(0.025), u(0.43)], [u(0.175) * W, u(0.028), u(0.085)], headC, { keep: (_x, _y, lz) => lz > -0.35 });
  // toothed front edge of the clypeus (6 teeth)
  for (let k = 0; k < 6; k++) {
    const a = -0.75 + (k / 5) * 1.5;
    const ex = Math.sin(a) * u(0.165) * W, ez = u(0.43) + Math.cos(a) * u(0.082);
    cap(head, [ex, bodyY - u(0.027), ez], [ex * 1.06, bodyY - u(0.03), ez + u(0.025)], u(0.014), VS * 0.5, clawC);
  }
  lumpy(head.m, 4, 1, 21, 0.4);
  ridge(head, (x, y, z) => y > bodyY + u(0.03) && Math.abs(Math.abs(x) - u(0.05)) < VS * 0.6 && z > u(0.33));
  // genae (cheek plates) and the eye sockets behind them
  for (const sx of [-1, 1]) ell(head, [sx * u(0.15) * W, bodyY - u(0.01), u(0.38)], [u(0.035), u(0.03), u(0.045)], headC);
  const eyeC: M3 = [u(0.152) * W, bodyY + u(0.008), u(0.335)];
  for (const sx of [-1, 1]) ell(head, [sx * eyeC[0], eyeC[1], eyeC[2]], [u(0.03), u(0.03), u(0.032)], 0, { carve: true });
  compoundEye(rb, 'eye_l', 'head', [eyeC[0] + VS * 0.3, eyeC[1], eyeC[2]], u(0.031), 1);
  // lamellate antennae: thin shaft + 3-plate fan club
  {
    const a0: M3 = [u(0.1) * W, bodyY - u(0.015), u(0.41)];
    const a1: M3 = [u(0.15) * W, bodyY + u(0.0), u(0.45)];
    const a2: M3 = [u(0.18) * W, bodyY + u(0.02), u(0.48)];
    const ant = rb.pm('antenna_l', 'head', a0); // mirrored to antenna_r
    tube(ant, [a0, a1, a2], () => VS * 0.6, clawC);
    for (let k = 0; k < 3; k++) {
      const c: M3 = [a2[0] + u(0.011) * k, a2[1] + u(0.011) * (k - 1), a2[2] + u(0.012)];
      cap(ant, c, [c[0] + u(0.004), c[1] + u(0.02), c[2] + u(0.01)], u(0.01), u(0.006), mix(st.claw, 0xb07a48, 0.5)); // lamella plate
    }
  }
  if (st.horn) tube(head, [[0, bodyY + u(0.03), u(0.38)], [0, bodyY + u(0.13) * st.horn, u(0.43)], [0, bodyY + u(0.21) * st.horn, u(0.4)], [0, bodyY + u(0.25) * st.horn, u(0.33)]], (t) => u(0.045) * (1 - t * 0.85), st.shell, fl);

  // ------------------------------------------------------------ jaw: mandibles + maxillary palps
  const jaw = rb.pm('jaw', 'head', [0, bodyY - u(0.045), u(0.42)]);
  for (const sx of [-1, 1]) {
    tube(jaw, [[sx * u(0.07), bodyY - u(0.05), u(0.42)], [sx * u(0.07), bodyY - u(0.058), u(0.47)], [sx * u(0.035), bodyY - u(0.06), u(0.5)]], (t) => u(0.016) * (1 - t * 0.6), clawC);
    tube(jaw, [[sx * u(0.09), bodyY - u(0.05), u(0.41)], [sx * u(0.12), bodyY - u(0.075), u(0.45)], [sx * u(0.13), bodyY - u(0.085), u(0.49)]], () => VS * 0.55, mix(st.claw, 0xa07a58, 0.4));
  }

  // ------------------------------------------------------------ legs: short, stout, angled like a real dung beetle
  const coxaZ = [u(0.2), u(0.04), -u(0.1)];
  const spine = mix(st.claw, 0xb8a080, 0.25);
  const hair = 0x8a6a3a;
  for (let i = 0; i < 3; i++) {
    const hip: M3 = [u(0.12) * W, bodyY - u(0.075), coxaZ[i]];
    const leg = rb.pm(`leg_l${i + 1}`, 'body', hip);
    ell(leg, hip, [u(0.045), u(0.04), u(0.05)], legC); // coxa
    if (i === 0) {
      // fossorial fore-leg: stout femur, broad flattened tibia with 4 outer teeth
      const knee: M3 = [u(0.26) * W, bodyY - u(0.085), u(0.29)];
      const tip: M3 = [u(0.335) * W, u(0.012), u(0.45)];
      tube(leg, [hip, [u(0.19) * W, bodyY - u(0.075), u(0.25)], knee], (t) => u(0.04) - t * u(0.008), legC);
      for (let k = 0; k <= 9; k++) {
        const t = k / 9;
        const p: M3 = [knee[0] + (tip[0] - knee[0]) * t, knee[1] + (tip[1] - knee[1]) * t, knee[2] + (tip[2] - knee[2]) * t];
        ell(leg, p, [u(0.03), u(0.017), u(0.026) + t * u(0.008)], legC);
        if (k >= 4 && k % 2 === 0) cap(leg, p, [p[0] + u(0.04), p[1] - u(0.004), p[2] + u(0.014)], u(0.013), VS * 0.5, clawC);
      }
      cap(leg, tip, [tip[0] + u(0.015), 0, tip[2] + u(0.04)], VS * 0.8, VS * 0.5, clawC); // reduced tarsus
      lumpy(leg.m, 3, 1, i + 1, 0.42);
    } else {
      const fwd = i === 1 ? 1 : -1;
      const knee: M3 = [u(0.3) * W, bodyY - u(0.07), coxaZ[i] + fwd * u(0.03)];
      const ankle: M3 = [u(0.42) * W, u(0.015), coxaZ[i] + fwd * (i === 2 ? u(0.2) : u(0.07))];
      const toe: M3 = [u(0.48) * W, 0, ankle[2] + fwd * u(0.08)];
      tube(leg, [hip, [u(0.22) * W, bodyY - u(0.07), (hip[2] + knee[2]) / 2], knee], (t) => u(0.036) - t * u(0.006), legC);
      // a few fine setae under the femur
      for (let k = 2; k < 5; k++) {
        const t = k / 6;
        const p: M3 = [hip[0] + (knee[0] - hip[0]) * t, hip[1] + (knee[1] - hip[1]) * t - u(0.03), hip[2] + (knee[2] - hip[2]) * t];
        leg.dot(p, hair);
      }
      const tib = i === 2 ? ([knee, [u(0.4) * W, bodyY * 0.5, (knee[2] + ankle[2]) / 2 + fwd * u(0.015)], ankle] as M3[]) : [knee, ankle];
      tube(leg, tib, (t) => u(0.026) + t * u(0.008), legC);
      // tibial spine rows and the paired apical spurs
      for (let k = 1; k <= 4; k++) {
        const t = k / 5;
        const a0 = tib[0], b0 = tib[tib.length - 1];
        const p: M3 = [a0[0] + (b0[0] - a0[0]) * t + u(0.022), a0[1] + (b0[1] - a0[1]) * t, a0[2] + (b0[2] - a0[2]) * t];
        leg.line(p, [p[0] + u(0.022), p[1] + u(0.008), p[2] - fwd * u(0.008)], spine);
      }
      for (const dz of [-1, 1]) leg.line(ankle, [ankle[0] + u(0.012), ankle[1] - u(0.008), ankle[2] + dz * u(0.03)], spine);
      // 5-segment tarsus + claws
      for (let k = 0; k < 5; k++) {
        const t0 = k / 5, t1 = (k + 0.8) / 5;
        cap(leg, [ankle[0] + (toe[0] - ankle[0]) * t0, ankle[1] * (1 - t0) + VS * 0.5, ankle[2] + (toe[2] - ankle[2]) * t0], [ankle[0] + (toe[0] - ankle[0]) * t1, ankle[1] * (1 - t1) + VS * 0.5, ankle[2] + (toe[2] - ankle[2]) * t1], u(0.012), u(0.01), clawC);
      }
      for (const dx of [-1, 1]) leg.line(toe, [toe[0] + dx * u(0.012), 0, toe[2] + fwd * u(0.022)], 0x140c08);
      lumpy(leg.m, 3, 1, i + 7, 0.45);
    }
  }
  rb.mirrorLR();
  if (!st.boss) {
    // the old design's quirk: a dung pellet stuck to a hind leg
    const lr = rb.sc('leg_r3');
    ell(lr, [-u(0.45) * W, u(0.045), -u(0.28)], [u(0.045), u(0.045), u(0.045)], dung(0x5a3e22, VS, 3));
  }
  st.extra?.(rb, u, bodyY);
  for (const p of rb.parts) if (p.model.count > 4000) hollow(p.model, 3);
  realFinish(rb, 0.9);
  rb.sockM('back', 'body', [0, bodyY + u(0.22), -u(0.1)]);
  rb.sockM('head_top', 'head', [0, bodyY + u(0.07), u(0.36)]);
  rb.sockM('mouth', 'jaw', [0, bodyY - u(0.06), u(0.5)]);
  return rb.build({ height: bodyY + u(0.24), radius: u(0.38), length: L, kind: 'beetle', headY: bodyY, ...(st.meta ?? {}) });
}

export interface BeetleOpts {
  alpha?: boolean;
  variant?: number;
}

const SCARAB_VS = 1 / 56;

/** the sacred scarab and its cousins: black, emerald-metallic and copper */
export function realScarabRig(o: BeetleOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % 3) + 3) % 3;
  if (alpha) {
    return realBeetleRig({
      name: 'scarab_alpha',
      vs: SCARAB_VS,
      len: 1.15,
      shell: chitin(0x221a1a, 0x7a3a24, SCARAB_VS, 11, { punct: 0.05 }),
      under: 0x1a1414,
      leg: 0x221a18,
      claw: 0x4a2414,
      horn: 1.45,
      pronHorns: true,
      scars: true,
      wide: 1.08,
    });
  }
  const shells = [
    { shell: chitin(0x24242c, 0x5e6a86, SCARAB_VS, 3), metal: false, under: 0x18181c, leg: 0x202026, claw: 0x4a2c1a, sun: 0.35 },
    { shell: irid([0x0c3218, 0x1f6a28, 0x5a9a2a, 0xb0a838], SCARAB_VS, 4), metal: true, under: 0x10201a, leg: 0x16241c, claw: 0x3a3418, sun: 0 },
    { shell: irid([0x30120a, 0x7a3416, 0xb8662c, 0xdaa050], SCARAB_VS, 5), metal: true, under: 0x1c1410, leg: 0x22160e, claw: 0x4a2a14, sun: 0 },
  ][v];
  return realBeetleRig({
    name: `scarab_v${v}`,
    vs: SCARAB_VS,
    len: 0.8,
    shell: shells.shell,
    shellMetal: shells.metal,
    under: shells.under,
    leg: shells.leg,
    claw: shells.claw,
    horn: v === 1 ? 0 : 0.8,
    sunDisk: shells.sun,
    dungCrust: v === 2,
  });
}

export { SCARAB_VS, Sc, cut };

// ============================================================ variants on the realistic beetle
import { VoxelModel } from '../../../../engine/voxel/VoxelModel';

/** Tick-Tock Scarab: a blue-black dung beetle with a cast-iron bomb lashed to its back (wind-up key, lit fuse) */
export function realBombScarabRig(o: BeetleOpts = {}): RigSpec {
  const a = !!o.alpha;
  const VS = SCARAB_VS;
  return realBeetleRig({
    name: a ? 'bomb_scarab_alpha' : 'bomb_scarab',
    vs: VS,
    len: a ? 0.98 : 0.8,
    shell: a ? chitin(0x2a0e0a, 0x8a2a18, VS, 21) : chitin(0x141a2a, 0x3a5a8a, VS, 20),
    under: a ? 0x1a0c0a : 0x101420,
    leg: a ? 0x1e1210 : 0x141822,
    claw: 0x3a2418,
    horn: a ? 1.1 : 0.5,
    pronHorns: a,
    scars: a,
    extra: (rb, u, bodyY) => {
      const back: M3 = [0, bodyY + u(0.22), -u(0.1)];
      const bomb = rb.pm('bomb', 'body', back);
      const iron = (x: number, y: number, z: number) => {
        const n = noise.n3(x * 0.3, y * 0.3, z * 0.3);
        let c = mix(0x24262a, 0x3e4248, n * 0.5 + 0.5);
        if (n > 0.55) c = mix(c, 0x7a4a2a, 0.6); // rust bloom
        return mulRGB(c, 0.96 + hash3(x, y, z) * 0.06);
      };
      const R = a ? u(0.2) : u(0.19);
      const bc: M3 = [0, back[1] + R * 0.8, back[2]];
      if (a) {
        // powder keg: staves + iron hoops, dynamite sticks strapped alongside
        const kc: M3 = [0, back[1] + u(0.16), back[2]];
        for (let k = 0; k < 13; k++) {
          const y = kc[1] - u(0.15) + k * u(0.024);
          const bulge = 1 + Math.sin((k / 12) * Math.PI) * 0.12;
          for (let ang = 0; ang < Math.PI * 2; ang += 0.03) {
            const stave = Math.floor((ang / (Math.PI * 2)) * 16);
            const rr = u(0.15) * bulge;
            bomb.dot([Math.sin(ang) * rr, y, kc[2] + Math.cos(ang) * rr], (k === 1 || k === 11) ? 0x3a3a3e : stave % 2 ? 0x7a5230 : 0x6a4426);
          }
        }
        for (let ry = -1; ry <= 1; ry += 2) for (let ang = 0; ang < Math.PI * 2; ang += 0.03) bomb.dot([Math.sin(ang) * u(0.152), kc[1] + ry * u(0.09), kc[2] + Math.cos(ang) * u(0.152)], 0x2e2e32, VF.METAL);
        ell(bomb, [0, kc[1] + u(0.15), kc[2]], [u(0.13), VS, u(0.13)], 0x5a3a20);
        for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) cap(bomb, [sx * u(0.19), kc[1] - u(0.1), kc[2] - u(0.05) + k * u(0.05)], [sx * u(0.19), kc[1] + u(0.12), kc[2] - u(0.05) + k * u(0.05)], u(0.022), u(0.022), k === 1 ? 0xa8281c : 0xb83424);
        cap(bomb, [0, kc[1] + u(0.15), kc[2]], [u(0.03), kc[1] + u(0.24), kc[2] - u(0.04)], VS * 0.6, VS * 0.6, 0xc8b890);
        bomb.dot([u(0.03), kc[1] + u(0.25), kc[2] - u(0.04)], 0xffd27a, VF.EMISSIVE);
      } else {
        // battered cast-iron shell: dented, slightly lopsided, strapped and riveted
        ell(bomb, bc, [R * 1.02, R * 0.96, R], iron, { fl: VF.METAL });
        lumpy(bomb.m, 4, 1, 5, 0.55);
        ridge(bomb, (x, y, z) => Math.abs(y - bc[1]) < VS * 0.7 || Math.abs(x) < VS * 0.7, 0x2a2c30);
        tubercles(bomb, 14, VS * 0.7, 0x5a5c62, (x, y) => Math.abs(y - bc[1]) < VS * 1.5, 9);
        cap(bomb, [0, bc[1] + R * 0.85, bc[2]], [0, bc[1] + R * 1.12, bc[2]], R * 0.28, R * 0.24, 0x2e3034, VF.METAL);
        // wind-up key: its own part so it can turn
        const keyP: M3 = [0, bc[1], bc[2] - R * 0.95];
        const key = rb.pm('key', 'bomb', keyP);
        cap(key, keyP, [0, bc[1], bc[2] - R * 1.3], VS * 0.8, VS * 0.8, 0xb8862a, VF.METAL);
        for (const dy of [-1, 1]) tube(key, [[0, bc[1], bc[2] - R * 1.32], [0, bc[1] + dy * R * 0.22, bc[2] - R * 1.4], [0, bc[1] + dy * R * 0.3, bc[2] - R * 1.32], [0, bc[1] + dy * R * 0.06, bc[2] - R * 1.3]], () => VS * 0.7, 0xd4a23a, VF.METAL);
        // fuse cord (frayed jute) with a tiny live spark: its own part so it can wiggle
        const fuseP: M3 = [0, bc[1] + R * 1.1, bc[2]];
        const fuse = rb.pm('fuse', 'bomb', fuseP);
        tube(fuse, [fuseP, [R * 0.2, bc[1] + R * 1.35, bc[2] + R * 0.1], [R * 0.32, bc[1] + R * 1.5, bc[2] - R * 0.05]], () => VS * 0.6, 0xb8a070);
        fuse.dot([R * 0.33, bc[1] + R * 1.56, bc[2] - R * 0.05], 0xffd27a, VF.EMISSIVE);
      }
      // rope lashing round the beetle's body holding the load (real twisted rope, knotted on top)
      const body = rb.sc('body');
      for (const [dz, sd] of [[-u(0.02), 1], [-u(0.2), 2]] as const) rope(body, loopPts([0, bodyY + u(0.02), dz], u(0.285), u(0.19), 'xy', 28, 0.05, sd), VS * 0.9, [0xa88a5a, 0x7a6040], { closed: true });
      rope(body, [[u(0.02), bodyY + u(0.22), -u(0.02)], [u(0.05), bodyY + u(0.23), -u(0.04)]], VS * 0.9, [0xa88a5a, 0x7a6040], { knot: true });
    },
    meta: { height: a ? 0.95 : 0.85 },
  });
}

/** Golden Scarab: a jewel beetle of real metallic gold (Chrysina-like); the alpha drags a sack of coins */
export function realGoldenScarabRig(o: BeetleOpts = {}): RigSpec {
  const a = !!o.alpha;
  const VS = SCARAB_VS;
  return realBeetleRig({
    name: a ? 'golden_scarab_alpha' : 'golden_scarab',
    vs: VS,
    len: a ? 0.95 : 0.78,
    shell: irid([0x6a4208, 0xb88a1c, 0xe8c050, 0xfff0a8], VS, 31),
    shellMetal: true,
    under: 0x5a4210,
    leg: 0x7a5a18,
    claw: 0x4a3410,
    wide: 1.06,
    horn: a ? 0.9 : 0,
    extra: a
      ? (rb, u, bodyY) => {
          const sack = rb.pm('sack', 'body', [0, bodyY + u(0.2), -u(0.3)]);
          const burlap = (x: number, y: number, z: number) => mulRGB(((x + y) & 1) ^ (z & 1) ? 0xa88a5a : 0x96784a, 0.94 + hash3(x, y, z) * 0.08);
          // a slumped, lumpy burlap sack (pear-shaped, folds, coin bulges)
          ell(sack, [0, bodyY + u(0.3), -u(0.34)], [u(0.21), u(0.17), u(0.18)], burlap);
          ell(sack, [u(0.02), bodyY + u(0.44), -u(0.35)], [u(0.13), u(0.1), u(0.12)], burlap);
          lumpy(sack.m, 3, 2, 4, 0.3);
          ridge(sack, (x, y) => Math.abs(((x + y * 0.6) / u(0.06)) % 1) < 0.12, 0x86683c);
          cap(sack, [0, bodyY + u(0.52), -u(0.35)], [0, bodyY + u(0.6), -u(0.37)], u(0.055), u(0.085), burlap);
          rope(sack, loopPts([0, bodyY + u(0.53), -u(0.35)], u(0.07), u(0.07), 'xz', 16, 0.08, 3), VS * 0.8, [0x8a6a3a, 0x5a4226], { closed: true });
          rope(sack, [[u(0.06), bodyY + u(0.53), -u(0.3)], [u(0.07), bodyY + u(0.52), -u(0.29)]], VS * 0.8, [0x8a6a3a, 0x5a4226], { knot: true });
          // coins spilling from a tear
          for (let k = 0; k < 9; k++) ell(sack, [u(0.12) + hash3(k, 1, 2) * u(0.08), bodyY + u(0.2) - k * u(0.02), -u(0.25) + hash3(k, 3, 4) * u(0.1)], [u(0.025), VS * 0.6, u(0.025)], 0xe8c050, { fl: VF.METAL });
        }
      : undefined,
    meta: { height: 0.6 },
  });
}

const BOSS_VS = 1 / 36;
/** the Sunroller: a battle-scarred giant dung beetle (boss) */
export function realSunrollerRig(): RigSpec {
  return realBeetleRig({
    name: 'sunroller',
    vs: BOSS_VS,
    len: 2.7,
    shell: chitin(0x1c1612, 0x6a4a2a, BOSS_VS, 41, { punct: 0.05, cell: 0.25 }),
    under: 0x18120e,
    leg: 0x1e1814,
    claw: 0x4a2c18,
    horn: 1.3,
    pronHorns: true,
    scars: true,
    sunDisk: 0.5,
    boss: true,
    dungCrust: true,
    wide: 1.05,
    extra: (rb, u, bodyY) => {
      // a battered cowboy hat speared on its horn (old design quirk)
      const hc: M3 = [0, bodyY + u(0.2), u(0.42)];
      const head = rb.pm('hat', 'head', hc); // its own part: it bounces
      const felt = (x: number, y: number, z: number) => mulRGB(0x6a4a30, 0.9 + hash3(x, y, z) * 0.12);
      for (let k = 0; k < 3; k++) ell(head, [hc[0], hc[1] + k * VS_SUN, hc[2]], [u(0.13), VS_SUN, u(0.11)], felt);
      ell(head, [hc[0], hc[1] + u(0.045), hc[2]], [u(0.065), u(0.04), u(0.055)], felt);
      lumpy(head.m, 3, 1, 8, 0.4); // crumpled felt
      paint(head, (_x, y) => Math.abs(y - (hc[1] + u(0.02))) < VS_SUN * 0.8, 0x3a2416);
      cut(head, (x, y, z) => Math.hypot(x - u(0.08), z - hc[2]) < u(0.03) && Math.abs(y - hc[1]) < VS_SUN * 3); // a bullet hole
    },
    meta: { height: 2.0 },
  });
}
const VS_SUN = BOSS_VS;

/** the burning sun-ball: an irregular packed-dung mass with straw, pebbles, a bone and glowing ember fissures */
function sunBallParts(): RBm {
  const VS = 1 / 28;
  const R = 1.55;
  const rb = new RBm('sun_ball', VS);
  const dc = dung(0x5a3e22, VS, 9);
  const fiss = (x: number, y: number, z: number) => {
    const n = noise.n3(x * VS * 2.2, y * VS * 2.2, z * VS * 2.2);
    if (Math.abs(n) < 0.04) return mix(0xff8a2a, 0xffc860, hash3(x, y, z));
    if (Math.abs(n) < 0.075) return 0x2a140a;
    return dc(x, y, z);
  };
  const C: M3 = [0, R, 0];
  const core = rb.pm('core', undefined, C);
  // not a sphere: several overlapping packed clods of different sizes
  const clods: [number, number, number, number][] = [[0, 0, 0, 1.25], [0.45, 0.25, 0.2, 0.95], [-0.4, -0.15, 0.35, 0.9], [0.1, 0.45, -0.4, 0.85], [-0.25, 0.35, -0.2, 0.8], [0.3, -0.4, -0.25, 0.85]];
  for (const [x, y, z, r] of clods) ell(core, [C[0] + x, C[1] + y, C[2] + z], [r, r * 0.92, r * 1.04], fiss, { keep: (lx, ly, lz) => lx * lx + ly * ly + lz * lz > 0.7 });
  lumpy(core.m, 6, 2, 3, 0.28);
  lumpy(core.m, 3, 1, 9, 0.4);
  // protruding lumps that wobble as it rolls (their own parts)
  const lumps: M3[] = [[0.95, 0.5, 0.6], [-1.05, 0.3, -0.4], [0.2, 1.3, 0.5], [-0.3, -0.2, 1.2], [0.6, -0.6, -1.0]];
  lumps.forEach((o, i) => {
    const p: M3 = [C[0] + o[0], C[1] + o[1], C[2] + o[2]];
    const l = rb.pm(`lump_${i + 1}`, 'core', p);
    ell(l, p, [0.32, 0.26, 0.3], fiss);
    lumpy(l.m, 3, 2, 20 + i, 0.3);
  });
  // a bleached cattle bone and straw tufts stuck in the dung (parts)
  const bp: M3 = [C[0] + 0.9, C[1] + 0.95, C[2] - 0.2];
  const bone = rb.pm('bone', 'core', bp);
  tube(bone, [[bp[0] - 0.2, bp[1] - 0.2, bp[2]], bp, [bp[0] + 0.35, bp[1] + 0.32, bp[2] + 0.05]], () => 0.07, 0xe8dcc0);
  for (const e of [[bp[0] + 0.38, bp[1] + 0.36, bp[2] + 0.07], [bp[0] + 0.32, bp[1] + 0.4, bp[2] + 0.02]] as M3[]) ell(bone, e, [0.09, 0.07, 0.08], 0xf0e6cc);
  lumpy(bone.m, 2, 1, 4, 0.5);
  for (let k = 0; k < 4; k++) {
    const a = hash3(k, 4, 1) * Math.PI * 2, e = (hash3(k, 5, 1) - 0.5) * 2.2;
    const n: M3 = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
    const sp: M3 = [C[0] + n[0] * R * 1.02, C[1] + n[1] * R * 1.02, C[2] + n[2] * R * 1.02];
    const st = rb.pm(`straw_${k + 1}`, 'core', sp);
    for (let f = 0; f < 6; f++) st.line(sp, [sp[0] + n[0] * 0.35 + (hash3(k, f, 2) - 0.5) * 0.3, sp[1] + n[1] * 0.35 + (hash3(k, f, 3) - 0.5) * 0.3, sp[2] + n[2] * 0.35 + (hash3(k, f, 4) - 0.5) * 0.3], f & 1 ? 0xd8c080 : 0xb8a060);
  }
  // pebbles
  tubercles(core, 18, 0.05, 0x8a8478, () => true, 11);
  // embers glow a little
  for (const p of rb.parts) {
    const glow: [number, number, number, number][] = [];
    p.model.forEach((x, y, z, c) => {
      if ((c >> 16) > 0xe0 && ((c >> 8) & 255) > 0x70) glow.push([x, y, z, c]);
    });
    for (const [x, y, z, c] of glow) p.model.set(x, y, z, c, VF.EMISSIVE);
  }
  return rb;
}

/** rigged sun-ball (core + wobbling lumps, bone and straw parts) */
export function realSunBallRig(): RigSpec {
  const rb = sunBallParts();
  return rb.build({ height: 3.1, radius: 1.6, kind: 'ball' });
}

/** static sun-ball (all parts merged) for code that wants a single model */
export function realSunBallModel(): { model: VoxelModel; voxelSize: number; radius: number } {
  const rb = sunBallParts();
  const m = new VoxelModel('sun_ball');
  for (const p of rb.parts) p.model.forEach((x, y, z, c, f) => m.set(x, y, z, c, f));
  return { model: m, voxelSize: rb.voxelSize, radius: 1.55 };
}
