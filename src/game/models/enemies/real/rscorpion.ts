// Realistic giant scorpion (STYLE v3): domed carapace with an ocular tubercle
// (glossy median eyes) and lateral eye clusters, 7 keeled mesosoma tergites
// with seams, granular keeled metasoma segments arcing over the back, bulbous
// telson with a curved aculeus, pedipalps with heavy chelae (movable finger is
// its own part), 4 pairs of segmented spiny legs with tarsal claws.
// Rig (scorpion convention): body (root), jaw, tail1..5 → stinger, arm_l/r → pincer_l/r, leg_l1..4/r, eye_l/r.
import type { RigSpec } from '../../../../engine/voxel/Rig';
import { RBm, M3, VF, mix, mulRGB, hash3, noise, ell, cap, tube, paint, realFinish, chitin, compoundEye, hollow, lumpy, ridge, tubercles } from './rk';
import type { ColorFn } from './rk';

export interface RealScorpion {
  name: string;
  vs: number;
  /** overall size multiplier (1 = giant scorpion, body ~1.5 m) */
  k: number;
  shell: ColorFn;
  shellLight: number;
  dark: number;
  tailTip: number;
  telson: number;
  matriarch?: boolean;
  scars?: boolean;
  arrows?: boolean;
  trap?: boolean;
}

export function realScorpionRig(st: RealScorpion): RigSpec {
  const VS = st.vs;
  const k = (m: number) => m * st.k;
  const rb = new RBm(st.name, VS);
  const bodyY = k(0.42);
  const sh = st.shell;
  const darkC = chitin(st.dark, mix(st.dark, 0x6a5a4a, 0.3), VS, 4, { cell: 0.05 });
  const legC = chitin(mix(st.shellLight, st.dark, 0.25), st.shellLight, VS, 7, { cell: 0.06 });
  const fl = VF.METAL;

  // ------------------------------------------------------------ body: prosoma (carapace) + 7-tergite mesosoma
  const body = rb.pm('body', undefined, [0, bodyY, 0]);
  // carapace: broad, low dome, slightly narrower at the front
  ell(body, [0, bodyY + k(0.03), k(0.5)], [k(0.31), k(0.1), k(0.27)], sh, { keep: (lx, ly, lz) => ly > -0.6 && Math.abs(lx) < 1 - Math.max(0, lz) * 0.25, fl });
  // carapace furrows + front notch
  paint(body, (x, y, z) => z > k(0.28) && y > bodyY + k(0.06) && Math.abs(Math.abs(x) - k(0.1) - (z - k(0.5)) * 0.25) < VS * 0.7, mulRGB(st.dark, 1.1), fl);
  ell(body, [0, bodyY + k(0.04), k(0.78)], [k(0.06), k(0.08), k(0.04)], 0, { carve: true });
  lumpy(body.m, 5, 1, 2, 0.4);
  tubercles(body, 60, k(0.012), (x, y, z) => mix(sh(x, y, z) as number, st.shellLight, 0.3), (_x, y, z) => z > k(0.25) && y > bodyY + k(0.05), 5);
  // ocular tubercle with the two median eyes (eye_l / eye_r parts)
  ell(body, [0, bodyY + k(0.12), k(0.56)], [k(0.06), k(0.035), k(0.05)], sh, { fl });
  compoundEye(rb, 'eye_l', 'body', [k(0.028), bodyY + k(0.145), k(0.575)], k(0.02), 1);
  // lateral eye clusters at the front corners (3 small glossy eyes each side, painted later after mirroring)
  // mesosoma: 7 overlapping tergites, each with 3 keels and a darker trailing edge
  for (let t = 0; t < 7; t++) {
    const z0 = k(0.26) - t * k(0.15);
    const w = k(0.36) - Math.abs(t - 2.5) * k(0.025) - (t > 4 ? (t - 4) * k(0.04) : 0);
    ell(body, [0, bodyY + k(0.02), z0 - k(0.07)], [w, k(0.11) - t * k(0.004), k(0.09)], sh, { keep: (_lx, ly) => ly > -0.55, fl });
    paint(body, (x, y, z) => Math.abs(z - (z0 - k(0.145))) < VS * 0.8 && y > bodyY - k(0.04), mulRGB(st.dark, 0.85), fl);
    for (const kx of [0, 0.4, -0.4]) ridge(body, (x, y, z) => Math.abs(x - kx * w) < VS * 0.6 && z < z0 - VS && z > z0 - k(0.13) && y > bodyY + k(0.08), (x, y, z) => mix(sh(x, y, z) as number, st.shellLight, 0.35));
  }
  // underside: sternites, coxae plate, pectines (comb organs)
  ell(body, [0, bodyY - k(0.05), k(0.05)], [k(0.27), k(0.07), k(0.62)], darkC, { keep: (_lx, ly) => ly < 0.2 });
  for (const sx of [-1, 1]) for (let t = 0; t < 8; t++) body.line([sx * (k(0.03) + t * k(0.022)), bodyY - k(0.1), k(0.1)], [sx * (k(0.03) + t * k(0.022)), bodyY - k(0.125), k(0.07)], mix(st.shellLight, 0xc8b080, 0.4));
  if (st.scars) for (let s = 0; s < 6; s++) {
    const z0 = k(0.2) - s * k(0.16) + hash3(s, 2, 3) * k(0.05);
    paint(body, (x, y, z) => y > bodyY + k(0.07) && Math.abs(z - z0 - x * 0.6) < VS * 0.7 && Math.abs(x) < k(0.25), 0x9a8a76, fl);
  }
  // chelicerae (jaw): small pincer jaws under the carapace front
  const jaw = rb.pm('jaw', 'body', [0, bodyY - k(0.01), k(0.74)]);
  for (const sx of [-1, 1]) {
    ell(jaw, [sx * k(0.035), bodyY - k(0.01), k(0.8)], [k(0.03), k(0.025), k(0.045)], sh, { fl });
    tube(jaw, [[sx * k(0.04), bodyY - k(0.015), k(0.83)], [sx * k(0.02), bodyY - k(0.02), k(0.88)], [sx * k(0.005), bodyY - k(0.025), k(0.89)]], () => VS * 0.6, st.dark);
  }

  // ------------------------------------------------------------ metasoma: 5 keeled, granular segments arcing over the back
  const P: M3[] = [
    [0, bodyY + k(0.04), -k(0.78)],
    [0, bodyY + k(0.2), -k(0.98)],
    [0, bodyY + k(0.46), -k(1.08)],
    [0, bodyY + k(0.72), -k(1.02)],
    [0, bodyY + k(0.92), -k(0.84)],
    [0, bodyY + k(1.02), -k(0.6)],
  ];
  const rad = [0.095, 0.09, 0.087, 0.084, 0.082];
  let parent = 'body';
  for (let i = 0; i < 5; i++) {
    const a = P[i], b = P[i + 1];
    const seg = rb.pm(`tail${i + 1}`, parent, a);
    const tc = i >= 3 ? ((x: number, y: number, z: number) => mix(sh(x, y, z) as number, st.tailTip, i === 3 ? 0.5 : 0.85)) : sh;
    const d: M3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    const a2: M3 = [a[0] + (d[0] / L) * k(0.025), a[1] + (d[1] / L) * k(0.025), a[2] + (d[2] / L) * k(0.025)];
    cap(seg, a, a2, k(rad[i] * 0.6), k(rad[i] * 0.7), st.dark); // articulation membrane
    cap(seg, a2, b, k(rad[i]), k(rad[i] * 0.92), tc, fl);
    // keels: dorsal pair + lateral, with granules
    const nx = 0, ny = -d[2] / L, nz = d[1] / L; // outward normal of the arc (away from the body)
    for (const off of [-0.55, 0.55]) {
      for (let g = 1; g < 9; g++) {
        const t = g / 9;
        const p: M3 = [off * k(rad[i]) * 0.9, a2[1] + (b[1] - a2[1]) * t + ny * k(rad[i]) * 0.85, a2[2] + (b[2] - a2[2]) * t + nz * k(rad[i]) * 0.85];
        seg.dot(p, hash3(g, i, 3) > 0.4 ? mix(st.shellLight, 0xe0c890, 0.3) : st.dark, fl);
      }
    }
    void nx;
    parent = `tail${i + 1}`;
  }
  // telson: bulbous venom vesicle + curved aculeus
  const tb = P[5];
  const sting = rb.pm('stinger', 'tail5', tb);
  ell(sting, [0, tb[1] - k(0.01), tb[2] + k(0.1)], [k(0.085), k(0.075), k(0.12)], (x, y, z) => mix(st.telson, mulRGB(st.telson, 1.3), noise.n3(x * 0.3, y * 0.3, z * 0.3) * 0.5 + 0.5), { fl });
  lumpy(sting.m, 3, 1, 4, 0.38);
  ridge(sting, (x, y, z) => Math.abs(x) < VS * 0.6 && y < tb[1] - k(0.03), mulRGB(st.telson, 0.8));
  tube(sting, [[0, tb[1] - k(0.02), tb[2] + k(0.2)], [0, tb[1] - k(0.05), tb[2] + k(0.27)], [0, tb[1] - k(0.11), tb[2] + k(0.3)], [0, tb[1] - k(0.16), tb[2] + k(0.28)]], (t) => k(0.032) * (1 - t * 0.9), 0x120c08, fl);

  // ------------------------------------------------------------ pedipalps + chelae (left; mirrored)
  const shp: M3 = [k(0.25), bodyY, k(0.72)];
  const arm = rb.pm('arm_l', 'body', shp);
  const knee1: M3 = [k(0.46), bodyY + k(0.07), k(0.84)];
  const knee2: M3 = [k(0.53), bodyY + k(0.06), k(1.08)];
  tube(arm, [shp, [k(0.35), bodyY + k(0.05), k(0.78)], knee1], (t) => k(0.055) - t * k(0.008), sh, fl); // trochanter + femur
  ell(arm, knee1, [k(0.06), k(0.055), k(0.06)], darkC);
  tube(arm, [knee1, [k(0.52), bodyY + k(0.08), k(0.96)], knee2], (t) => k(0.06) + t * k(0.01), sh, fl); // patella
  // chela hand (manus): heavy, bulbous, keeled, with a granular ridge
  const hc: M3 = [k(0.52), bodyY + k(0.045), k(1.26)];
  ell(arm, hc, [k(0.12), k(0.1), k(0.17)], sh, { fl });
  ell(arm, [hc[0] + k(0.03), hc[1] - k(0.02), hc[2] + k(0.04)], [k(0.09), k(0.08), k(0.12)], sh, { fl }); // swollen outer lobe
  lumpy(arm.m, 4, 2, 6, 0.32);
  ridge(arm, (x, y, z) => y > hc[1] + k(0.05) && Math.abs(x - hc[0]) < VS * 0.7 && z > hc[2] - k(0.14), (x, y, z) => mix(sh(x, y, z) as number, st.shellLight, 0.45));
  ridge(arm, (x, y, z) => Math.abs(x - hc[0] - k(0.1)) < VS * 0.7 && Math.abs(y - hc[1]) < k(0.03) && z > hc[2] - k(0.12), (x, y, z) => mix(sh(x, y, z) as number, st.shellLight, 0.3));
  tubercles(arm, 30, k(0.01), (x, y, z) => mix(sh(x, y, z) as number, st.shellLight, 0.35), (_x, y, z) => y > hc[1] - k(0.02) && z > hc[2] - k(0.15) && z < hc[2] + k(0.16), 8);
  // fixed finger (inner side) with denticles
  const ff: M3[] = [[k(0.46), bodyY + k(0.03), k(1.38)], [k(0.44), bodyY + k(0.03), k(1.5)], [k(0.46), bodyY + k(0.025), k(1.6)], [k(0.5), bodyY + k(0.02), k(1.64)]];
  tube(arm, ff, (t) => k(0.045) * (1 - t * 0.75), mix(st.dark, st.tailTip, 0.3), fl);
  for (let d = 0; d < 6; d++) arm.dot([k(0.475), bodyY + k(0.025), k(1.4) + d * k(0.035)], 0xd8c8a8);
  // movable finger (outer side) — its own part, resting slightly open
  const pp: M3 = [k(0.58), bodyY + k(0.04), k(1.38)];
  const pin = rb.pm('pincer_l', 'arm_l', pp);
  tube(pin, [pp, [k(0.62), bodyY + k(0.04), k(1.5)], [k(0.6), bodyY + k(0.035), k(1.61)], [k(0.55), bodyY + k(0.03), k(1.66)]], (t) => k(0.044) * (1 - t * 0.75), mix(st.dark, st.tailTip, 0.3), fl);
  for (let d = 0; d < 6; d++) pin.dot([k(0.595), bodyY + k(0.03), k(1.42) + d * k(0.035)], 0xd8c8a8);

  // ------------------------------------------------------------ 4 pairs of segmented legs with spines and tarsal claws
  const LZ = [0.6, 0.44, 0.26, 0.06];
  LZ.forEach((z, i) => {
    const spread = (1.5 - i) * 0.12;
    const hip: M3 = [k(0.24), bodyY - k(0.05), k(z)];
    const knee: M3 = [k(0.52 + i * 0.02), bodyY + k(0.16), k(z + spread * 0.6)];
    const ank: M3 = [k(0.78 + i * 0.03), k(0.12), k(z + spread * 1.4)];
    const toe: M3 = [k(0.86 + i * 0.03), 0, k(z + spread * 1.75)];
    const leg = rb.pm(`leg_l${i + 1}`, 'body', hip);
    ell(leg, hip, [k(0.05), k(0.04), k(0.05)], darkC);
    tube(leg, [hip, [k(0.38), bodyY + k(0.1), k(z + spread * 0.3)], knee], (t) => k(0.05) - t * k(0.007), legC, fl); // femur
    ell(leg, knee, [k(0.052), k(0.05), k(0.052)], darkC);
    tube(leg, [knee, [k(0.68 + i * 0.03), bodyY + k(0.02), k(z + spread)], ank], (t) => k(0.045) - t * k(0.01), legC, fl); // patella + tibia
    tube(leg, [ank, toe], (t) => k(0.028) - t * k(0.01), mix(st.shellLight, 0xd8c090, 0.3)); // tarsus
    for (const dz of [-1, 1]) leg.line(toe, [toe[0] + k(0.015), 0, toe[2] + dz * k(0.02)], 0x120c08);
    for (let g = 1; g < 5; g++) {
      const t = g / 5;
      const p: M3 = [knee[0] + (ank[0] - knee[0]) * t, knee[1] + (ank[1] - knee[1]) * t - k(0.03), knee[2] + (ank[2] - knee[2]) * t];
      leg.line(p, [p[0] + k(0.01), p[1] - k(0.03), p[2]], mix(st.shellLight, 0xe0d0a8, 0.4)); // setae / spines
    }
    lumpy(leg.m, 3, 1, 30 + i, 0.45);
  });

  rb.mirrorLR();
  // lateral eye clusters (both sides, painted onto the body after mirroring)
  for (const sx of [-1, 1]) for (let e = 0; e < 3; e++) body.dot([sx * (k(0.2) + e * VS), bodyY + k(0.06), k(0.72) - e * VS * 1.4], e === 0 ? 0x2a3038 : 0x0c0c10, VF.METAL);

  // ------------------------------------------------------------ story details
  if (st.arrows) {
    const b = rb.sc('body');
    for (const [x, z, ax, az] of [[0.12, -0.2, 0.4, -0.5], [-0.18, 0.1, -0.5, 0.2]] as const) {
      const base: M3 = [k(x), bodyY + k(0.11), k(z)];
      cap(b, base, [base[0] + k(ax) * 0.6, base[1] + k(0.55), base[2] + k(az) * 0.6], VS * 0.6, VS * 0.6, 0x8a6a40);
      for (let f = 0; f < 3; f++) b.dot([base[0] + k(ax) * 0.6 + (f - 1) * VS, base[1] + k(0.55) - f * VS, base[2] + k(az) * 0.6], f === 1 ? 0xe8e0d0 : 0xb03a2a);
    }
  }
  if (st.trap) {
    const l = rb.sc('leg_r4');
    const c: M3 = [-k(0.82), k(0.07), k(0.06 + 1.5 * 0.12 * -1.2)];
    for (let a = 0; a < Math.PI * 2; a += 0.12) l.dot([c[0] + Math.cos(a) * k(0.07), c[1], c[2] + Math.sin(a) * k(0.07)], 0x6a3a20, VF.METAL);
    for (let a = 0; a < Math.PI * 2; a += 0.5) l.dot([c[0] + Math.cos(a) * k(0.07), c[1] + VS, c[2] + Math.sin(a) * k(0.07)], 0x8a8a8e, VF.METAL);
    cap(l, [c[0] + k(0.07), c[1], c[2]], [c[0] + k(0.2), 0, c[2] - k(0.1)], VS * 0.5, VS * 0.5, 0x4a4a4e, VF.METAL); // dragging chain
  }
  if (st.matriarch) {
    // her young ride on her back — miniature scorpions clinging to the tergites
    const b = rb.sc('body');
    for (let n = 0; n < 7; n++) {
      const bx = (hash3(n, 1, 9) - 0.5) * k(0.4), bz = k(0.3) - n * k(0.13);
      const by = bodyY + k(0.13) - Math.max(0, n - 4) * k(0.01);
      const yc = 0xe8d8b0;
      ell(b, [bx, by + k(0.02), bz], [k(0.035), k(0.02), k(0.06)], yc);
      tube(b, [[bx, by + k(0.02), bz - k(0.06)], [bx, by + k(0.06), bz - k(0.1)], [bx, by + k(0.09), bz - k(0.06)]], () => VS * 0.6, yc);
      for (const sx of [-1, 1]) b.line([bx + sx * k(0.03), by + k(0.015), bz + k(0.02)], [bx + sx * k(0.07), by, bz + k(0.05)], yc);
    }
  }
  for (const p of rb.parts) if (p.model.count > 6000) hollow(p.model, 3);
  realFinish(rb, 0.9);
  rb.sockM('back', 'body', [0, bodyY + k(0.14), -k(0.1)]);
  rb.sockM('stinger_tip', 'stinger', [0, tb[1] - k(0.16), tb[2] + k(0.28)]);
  rb.sockM('pincer_l_tip', 'pincer_l', [k(0.55), bodyY + k(0.03), k(1.66)]);
  rb.sockM('pincer_r_tip', 'pincer_r', [-k(0.55), bodyY + k(0.03), k(1.66)]);
  rb.sockM('head_top', 'body', [0, bodyY + k(0.16), k(0.56)]);
  return rb.build({ height: bodyY + k(1.12), radius: k(0.85), length: k(2.4), kind: 'scorpion', headY: bodyY });
}

export interface ScorpionOpts {
  alpha?: boolean;
  variant?: number;
}

const GIANT_VS = 1 / 36;

export function realGiantScorpionRig(o: ScorpionOpts = {}): RigSpec {
  const a = !!o.alpha;
  const v = (((o.variant ?? 0) % 3) + 3) % 3;
  if (a) {
    return realScorpionRig({
      name: 'giant_scorpion_alpha',
      vs: GIANT_VS,
      k: 1.3,
      shell: chitin(0x1a1614, 0x5a3a26, GIANT_VS, 13, { punct: 0.04, cell: 0.2 }),
      shellLight: 0x6a4a32,
      dark: 0x0e0a08,
      tailTip: 0x0a0806,
      telson: 0x6a2a14,
      scars: true,
      arrows: true,
      trap: true,
    });
  }
  // desert palette: ochre deathstalker, red-brown, fat-tailed with a black tail tip
  const pal = [
    { shell: chitin(0xa8743a, 0xd8a85a, GIANT_VS, 1, { cell: 0.2 }), light: 0xe0b870, dark: 0x5a3a1c, tip: 0x6a4420, tel: 0xc08a3a },
    { shell: chitin(0x7a3a1e, 0xb0602e, GIANT_VS, 2, { cell: 0.2 }), light: 0xc07a42, dark: 0x3a1a0c, tip: 0x3a1a0e, tel: 0x9a4a22 },
    { shell: chitin(0x8a6a3a, 0xb8945a, GIANT_VS, 3, { cell: 0.2 }), light: 0xc8a468, dark: 0x3a2a16, tip: 0x161210, tel: 0x2a1c12 },
  ][v];
  return realScorpionRig({
    name: `giant_scorpion_v${v}`,
    vs: GIANT_VS,
    k: 1,
    shell: pal.shell,
    shellLight: pal.light,
    dark: pal.dark,
    tailTip: pal.tip,
    telson: pal.tel,
    arrows: v === 0,
    trap: v === 1,
  });
}

/** Big Bertha: a colossal, scarred matriarch carrying her brood on her back */
export function realBigBerthaRig(): RigSpec {
  return realScorpionRig({
    name: 'big_bertha',
    vs: GIANT_VS,
    k: 1.85,
    shell: chitin(0x6a2a16, 0xa8502a, GIANT_VS, 17, { punct: 0.05, cell: 0.3 }),
    shellLight: 0xb8683a,
    dark: 0x2a0e06,
    tailTip: 0x1a0a06,
    telson: 0x8a2a12,
    matriarch: true,
    scars: true,
    arrows: true,
  });
}
