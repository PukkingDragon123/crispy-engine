// Ruin spider (+ alpha "brood mother") — STYLE v3 realistic giant bug, 1/44 m.
// A big hairy desert tarantula that nests in the abandoned buildings: low domed
// carapace with radiating striae and a fovea, a raised caput carrying an eye
// tubercle with EIGHT modelled glossy eyes (two big front medians, two rear
// medians, four laterals), heavy hairy chelicerae with curved glossy fangs,
// pedipalps, a furry egg-shaped abdomen with long urticating hairs, spinnerets,
// and four pairs of jointed hairy legs (coxa, femur rising to a high knee,
// patella with pale bands, tibia, metatarsus, tarsus with dark scopula pads).
// The alpha is a scarred charcoal brood mother with a bone-white skull mark,
// crimson hair, longer fangs, an egg sac at her spinnerets and spiderlings
// riding on her back.
//
// Rig (scorpion convention so the insect animator walks it with a tetrapod gait):
//   body (root: thorax + abdomen) → head (caput: eyes, rears up to strike)
//     → mandible_l / mandible_r (chelicerae + fangs, snap open/closed)
//   body → arm_l / arm_r (pedipalps) → pincer_l / pincer_r (palp tarsi)
//   body → leg_l1 … leg_l4, leg_r1 … leg_r4 (front to back)
// Eyes are part of the head model (real geometry, no eye parts / no 2D eyes).
import type { RigSpec } from '../../../engine/voxel/Rig';
import { RBm, Sc, M3, VF, mix, mulRGB, hash3, noise, ell, cap, tube, paint, realFinish, chitin, hollow, lumpy } from './real/rk';
import { wetEye } from '../creatures/ckit';
import type { VoxelModel } from '../../../engine/voxel/VoxelModel';

export interface RuinSpiderOpts {
  alpha?: boolean;
  variant?: number;
}

const VS = 1 / 44;

interface Pal {
  carapace: number;
  sheen: number;
  leg: number;
  legHair: number;
  band: number;
  abdomen: number;
  abdHair: number;
  pattern: number;
  fang: number;
}
const PALS: Pal[] = [
  // desert tarantula: ochre carapace, dark brown legs with golden hair, rust-brown abdomen
  { carapace: 0x9a6a38, sheen: 0xd6a660, leg: 0x3e2a1c, legHair: 0xb8925a, band: 0xd8c08a, abdomen: 0x4a3020, abdHair: 0xa0603a, pattern: 0x24160e, fang: 0x0c0806 },
  // red-rump: near-black body, rusty-red abdomen hair, cream knee bands
  { carapace: 0x2e241e, sheen: 0x6a5240, leg: 0x1e1814, legHair: 0x7a5a42, band: 0xe0cfa8, abdomen: 0x2a1a14, abdHair: 0xb0482a, pattern: 0x120c0a, fang: 0x080606 },
];
const ALPHA: Pal = { carapace: 0x24201e, sheen: 0x5a4a44, leg: 0x161212, legHair: 0x6a4a3e, band: 0xe8dcc0, abdomen: 0x1c1412, abdHair: 0x9a2a1e, pattern: 0xe6dcc4, fang: 0x060404 };

const N6: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Setae: stiff hairs grown outward from exposed voxels that satisfy pred (voxel coords).
 * `density` = chance per surface voxel, `len` = max hair length (voxels). `down` lets hairs
 * grow downward too (legs, belly). Colour by col(x, y, z, srcColour, tipT).
 */
function hairy(m: VoxelModel, pred: (x: number, y: number, z: number) => boolean, col: (x: number, y: number, z: number, src: number, tip: number) => number, density: number, len: number, seed: number, down = true) {
  const add: [number, number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    if (!pred(x, y, z)) return;
    const h = hash3(x * 3.1 + seed, y * 5.3 - seed, z * 7.7);
    if (h > density) return;
    const start = Math.floor(hash3(x, y + seed, z) * 6);
    for (let k = 0; k < 6; k++) {
      const [dx, dy, dz] = N6[(start + k) % 6];
      if (!down && dy < 0) continue;
      if (m.has(x + dx, y + dy, z + dz)) continue;
      const L = 1 + Math.floor(hash3(z, x + seed, y) * len);
      for (let l = 1; l <= L; l++) add.push([x + dx * l, y + dy * l, z + dz * l, col(x + dx * l, y + dy * l, z + dz * l, c, l / L)]);
      break;
    }
  });
  for (const [x, y, z, c] of add) if (!m.has(x, y, z)) m.set(x, y, z, c);
}

/** wetEye in meters (voxel-geometric conversion) */
function eyeM(s: Sc, c: M3, r: number, fwd: M3, iris: number) {
  wetEye(s.m, [c[0] / VS, c[1] / VS, c[2] / VS], r / VS, fwd, { sclera: 0x0a0808, iris, irisEdge: 0x050404, pupil: 0x020202, irisR: 0.9, pupilR: 0.45, bigGlint: 1, smallGlint: r / VS >= 1.4 });
}

export function ruinSpiderRig(o: RuinSpiderOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = ((o.variant ?? 0) % PALS.length + PALS.length) % PALS.length;
  const pal = alpha ? ALPHA : PALS[v];
  const k = (m: number) => m * (alpha ? 1.08 : 1);
  const rb = new RBm(alpha ? 'ruin_spider_alpha' : `ruin_spider_v${v}`, VS);
  const bodyY = k(0.3);
  const fl = VF.METAL;
  const shell = chitin(pal.carapace, pal.sheen, VS, 3 + v, { cell: 0.06, punct: 0.05 });
  const legC = (x: number, y: number, z: number) => {
    const n = noise.n3(x * 0.35, y * 0.35 + v, z * 0.35);
    return n > 0.45 ? mix(pal.leg, pal.legHair, 0.35) : n < -0.5 ? mulRGB(pal.leg, 0.8) : pal.leg;
  };
  const hairTip = (src: number, t: number) => mix(mix(src, pal.legHair, 0.6), mix(pal.legHair, 0xfff0d0, 0.25), t);

  // ================================================================ body: thorax + pedicel + abdomen
  const body = rb.pm('body', undefined, [0, bodyY, 0]);
  // carapace: low dome, flattened underside, slightly narrower at the front
  ell(body, [0, bodyY, k(0.07)], [k(0.15), k(0.075), k(0.19)], shell, { keep: (lx, ly, lz) => ly > -0.55 && Math.abs(lx) < 1 - Math.max(0, lz) * 0.18, fl });
  // fovea (central pit) and radiating striae
  ell(body, [0, bodyY + k(0.075), k(0.03)], [k(0.022), k(0.018), k(0.03)], 0, { carve: true });
  paint(body, (x, y, z) => {
    if (y < bodyY + k(0.03)) return false;
    const dx = x, dz = z - k(0.03);
    const d = Math.hypot(dx, dz);
    if (d < k(0.03) || d > k(0.15)) return false;
    const a = Math.atan2(dz, dx);
    return Math.abs(Math.sin(a * 4)) < 0.16;
  }, mulRGB(pal.carapace, 0.68), fl);
  // marginal rim of short pale hairs around the carapace edge
  paint(body, (x, y, z) => y < bodyY - k(0.01) && y > bodyY - k(0.035) && z > -k(0.08), mix(pal.carapace, pal.legHair, 0.5), fl);
  // sternum + coxae ring underneath
  ell(body, [0, bodyY - k(0.06), k(0.07)], [k(0.085), k(0.03), k(0.13)], mulRGB(pal.leg, 0.9));
  // pedicel (narrow waist)
  cap(body, [0, bodyY - k(0.01), -k(0.1)], [0, bodyY + k(0.0), -k(0.15)], k(0.04), k(0.045), mulRGB(pal.leg, 0.85));
  // abdomen: egg-shaped (wider at the back), furry
  const abC: M3 = [0, bodyY + k(0.07), -k(0.36)];
  const abd = (x: number, y: number, z: number) => {
    const n = noise.n3(x * 0.3, y * 0.3 + 4, z * 0.3);
    return n > 0.4 ? mix(pal.abdomen, pal.abdHair, 0.45) : n < -0.45 ? mulRGB(pal.abdomen, 0.82) : pal.abdomen;
  };
  ell(body, abC, [k(0.19), k(0.165), k(0.24)], abd);
  ell(body, [0, abC[1] + k(0.01), abC[2] - k(0.06)], [k(0.205), k(0.17), k(0.21)], abd);
  lumpy(body.m, 4, 1, 7 + v, 0.42);
  // dorsal pattern: dark midline heart mark + chevrons (alpha: a bone-white skull of Set)
  const top = (x: number, y: number) => y > abC[1] + k(0.06) && Math.abs(x) < k(0.16);
  if (!alpha) {
    paint(body, (x, y, z) => top(x, y) && z > -k(0.4) && z < -k(0.18) && Math.abs(x) < k(0.025) + (z + k(0.4)) * 0.05, pal.pattern);
    for (let c = 0; c < 4; c++) {
      const zc = -k(0.42) - c * k(0.05);
      paint(body, (x, y, z) => top(x, y) && Math.abs(z - zc + Math.abs(x) * 0.7) < VS * 0.9 && Math.abs(x) < k(0.11) - c * k(0.015), pal.pattern);
    }
  } else {
    // skull: cranium, two hollow sockets, nasal notch, teeth row
    const sk = (x: number, z: number) => {
      const lx = x / k(0.1), lz = (z + k(0.36)) / k(0.11);
      if (lx * lx + lz * lz < 1 && lz > -0.55) return true;
      return Math.abs(x) < k(0.06) && z < -k(0.36) - k(0.05) && z > -k(0.36) - k(0.09);
    };
    paint(body, (x, y, z) => top(x, y) && sk(x, z), pal.pattern);
    for (const sx of [-1, 1]) paint(body, (x, y, z) => top(x, y) && Math.hypot(x - sx * k(0.04), z + k(0.36) + k(0.01)) < k(0.026), 0x1a1210);
    paint(body, (x, y, z) => top(x, y) && Math.abs(x) < k(0.012) && z < -k(0.36) - k(0.035) && z > -k(0.36) - k(0.055), 0x1a1210);
    for (let t = -2; t <= 2; t++) paint(body, (x, y, z) => top(x, y) && Math.abs(x - t * k(0.024)) < VS * 0.5 && z < -k(0.36) - k(0.06) && z > -k(0.36) - k(0.09), 0x1a1210);
  }
  // spinnerets: two finger-like tapered segments at the rear tip
  for (const sx of [-1, 1]) tube(body, [[sx * k(0.025), bodyY + k(0.02), -k(0.56)], [sx * k(0.035), bodyY + k(0.0), -k(0.62)], [sx * k(0.04), bodyY - k(0.03), -k(0.645)]], (t) => k(0.026) * (1 - t * 0.55), mulRGB(pal.abdomen, 0.85));
  if (alpha) {
    // egg sac clutched at the spinnerets (wolf-spider style): papery silk ball with dimples
    const ec: M3 = [0, bodyY - k(0.04), -k(0.7)];
    ell(body, ec, [k(0.1), k(0.09), k(0.095)], (x, y, z) => (hash3(x, y, z) < 0.12 ? 0xcfc6b0 : noise.n3(x * 0.5, y * 0.5, z * 0.5) > 0.2 ? 0xf2ecdc : 0xe2d9c4));
    for (let d = 0; d < 9; d++) ell(body, [ec[0] + (hash3(d, 1, 2) - 0.5) * k(0.16), ec[1] + (hash3(d, 3, 4) - 0.5) * k(0.14), ec[2] + (hash3(d, 5, 6) - 0.5) * k(0.15)], [k(0.012), k(0.012), k(0.012)], 0, { carve: true });
    // spiderlings riding on her back: tiny pale bodies with splayed hair-thin legs
    for (let n = 0; n < 9; n++) {
      const bx = (hash3(n, 7, 1) - 0.5) * k(0.26), bz = -k(0.22) - hash3(n, 3, 9) * k(0.3);
      const lx = bx / k(0.205), lz = (bz - abC[2]) / k(0.24);
      const by = abC[1] + k(0.165) * Math.sqrt(Math.max(0, 1 - lx * lx - lz * lz)) + k(0.012);
      const yc = n % 3 ? 0xd8c8a4 : 0xc0a882;
      ell(body, [bx, by, bz], [k(0.014), k(0.011), k(0.02)], yc);
      ell(body, [bx, by + k(0.003), bz + k(0.022)], [k(0.011), k(0.009), k(0.012)], mulRGB(yc, 0.85));
      for (const sx of [-1, 1]) for (let l = 0; l < 2; l++) body.line([bx + sx * k(0.012), by, bz + k(0.01) - l * k(0.02)], [bx + sx * k(0.038), by - k(0.012), bz + k(0.02) - l * k(0.04)], 0x8a7454);
    }
    // old wounds: pale scratches across the carapace
    for (let s = 0; s < 3; s++) paint(body, (x, y, z) => y > bodyY + k(0.03) && Math.abs(z - k(0.1) + s * k(0.07) - x * 0.8) < VS * 0.6 && Math.abs(x) < k(0.12), 0x8a7a6a, fl);
  }
  // long urticating hairs over the abdomen, short golden hairs on the carapace
  const abdHair = (x: number, y: number, z: number) => z * VS < -k(0.14) && y * VS > bodyY - k(0.07);
  hairy(body.m, abdHair, (_x, _y, _z, src, t) => mix(mix(src, pal.abdHair, 0.7), mix(pal.abdHair, 0xf0c890, 0.3), t), 0.5, 2, 11 + v, false);
  hairy(body.m, (x, y, z) => z * VS > -k(0.12) && y * VS > bodyY - k(0.02), (_x, _y, _z, src) => mix(src, pal.legHair, 0.55), 0.18, 1, 13 + v, false);

  // ================================================================ head: caput + eye tubercle with 8 eyes
  const hp: M3 = [0, bodyY + k(0.015), k(0.15)];
  const head = rb.pm('head', 'body', hp);
  ell(head, [0, bodyY + k(0.035), k(0.22)], [k(0.115), k(0.07), k(0.1)], shell, { keep: (_lx, ly) => ly > -0.6, fl });
  ell(head, [0, bodyY + k(0.0), k(0.18)], [k(0.1), k(0.05), k(0.08)], shell, { fl }); // hidden plug into the thorax
  // clypeus: the front edge overhanging the chelicerae
  ell(head, [0, bodyY + k(0.02), k(0.3)], [k(0.08), k(0.035), k(0.035)], shell, { fl });
  // eye tubercle
  const tub: M3 = [0, bodyY + k(0.1), k(0.27)];
  ell(head, tub, [k(0.072), k(0.045), k(0.055)], (x, y, z) => mix(shell(x, y, z) as number, 0x1a120c, 0.35), { fl });
  const irisC = alpha ? 0x4a0a08 : 0x1e1612;
  for (const sx of [-1, 1]) {
    eyeM(head, [sx * k(0.031), tub[1] - k(0.004), tub[2] + k(0.046)], k(0.033), [sx * 0.15, 0.12, 1], irisC); // anterior medians (big, forward)
    eyeM(head, [sx * k(0.05), tub[1] + k(0.032), tub[2] + k(0.012)], k(0.027), [sx * 0.45, 0.85, 0.3], irisC); // posterior medians (up)
    eyeM(head, [sx * k(0.07), tub[1] - k(0.016), tub[2] + k(0.03)], k(0.022), [sx * 0.85, 0.05, 0.55], irisC); // anterior laterals
    eyeM(head, [sx * k(0.074), tub[1] + k(0.012), tub[2] - k(0.022)], k(0.02), [sx * 0.85, 0.3, -0.45], irisC); // posterior laterals
  }
  // bristly brows over the eye field
  hairy(head.m, (x, y, z) => y * VS > tub[1] + k(0.02) && z * VS < tub[2] - k(0.01) && Math.abs(x * VS) < k(0.06), (_x, _y, _z, src) => mix(src, pal.legHair, 0.7), 0.35, 1, 21 + v, false);

  // ================================================================ chelicerae + fangs (left, mirrored)
  const chB: M3 = [k(0.038), bodyY - k(0.005), k(0.28)];
  const ch = rb.pm('mandible_l', 'head', chB);
  ell(ch, [k(0.04), bodyY - k(0.03), k(0.335)], [k(0.042), k(0.055), k(0.065)], (x, y, z) => {
    const n = noise.n3(x * 0.4, y * 0.4, z * 0.4 + 9);
    return n > 0.3 ? mix(pal.leg, pal.legHair, 0.4) : pal.leg;
  });
  // the fang: a glossy curved hook folded under the chelicera, curving inward and back
  const fangL = alpha ? 1.35 : 1;
  tube(ch, [[k(0.045), bodyY - k(0.075), k(0.385)], [k(0.04), bodyY - k(0.105) * fangL, k(0.395)], [k(0.028), bodyY - k(0.13) * fangL, k(0.38)], [k(0.012), bodyY - k(0.14) * fangL, k(0.35)]], (t) => k(0.016) * (1 - t * 0.75), pal.fang, fl);
  ch.dot([k(0.044), bodyY - k(0.1) * fangL, k(0.4)], 0x6a6460, fl); // wet glint on the fang
  // hairy front of the chelicera
  hairy(ch.m, (x, y, z) => z * VS > k(0.33) && y * VS > bodyY - k(0.07), (_x, _y, _z, src, t) => hairTip(src, t), 0.45, 2, 31 + v, true);

  // ================================================================ pedipalps
  const pa: M3 = [k(0.07), bodyY - k(0.04), k(0.25)];
  const palp = rb.pm('arm_l', 'body', pa);
  const pk: M3 = [k(0.12), bodyY + k(0.08), k(0.34)];
  const pt: M3 = [k(0.14), k(0.1), k(0.47)];
  tube(palp, [pa, [k(0.1), bodyY + k(0.03), k(0.29)], pk], (t) => k(0.03) - t * k(0.004), legC);
  ell(palp, pk, [k(0.032), k(0.03), k(0.032)], mix(pal.leg, pal.band, 0.4));
  tube(palp, [pk, [k(0.135), bodyY - k(0.02), k(0.41)], pt], (t) => k(0.028) - t * k(0.004), legC);
  const tip = rb.pm('pincer_l', 'arm_l', pt);
  tube(tip, [pt, [k(0.14), k(0.05), k(0.51)], [k(0.135), k(0.02), k(0.535)]], (t) => k(0.027) - t * k(0.004), legC);
  ell(tip, [k(0.135), k(0.022), k(0.535)], [k(0.026), k(0.02), k(0.03)], mulRGB(pal.leg, 0.6)); // dark scopula pad
  hairy(palp.m, () => true, (_x, _y, _z, src, t) => hairTip(src, t), 0.42, 2, 41 + v, true);
  hairy(tip.m, () => true, (_x, _y, _z, src, t) => hairTip(src, t), 0.42, 2, 43 + v, true);

  // ================================================================ 4 pairs of legs (left, mirrored)
  const ANG = [0.95, 0.4, -0.22, -0.82];
  const REACH = [k(0.98), k(0.88), k(0.84), k(1.0)];
  const HZ = [k(0.17), k(0.1), k(0.03), -k(0.04)];
  for (let i = 0; i < 4; i++) {
    const a = ANG[i], R = REACH[i];
    const dx = Math.cos(a), dz = Math.sin(a);
    const hip: M3 = [k(0.085) + Math.max(0, dx) * k(0.02), bodyY - k(0.04), HZ[i] + dz * k(0.02)];
    const P = (t: number, y: number): M3 => [hip[0] + dx * R * t, y, hip[2] + dz * R * t];
    const thick = i === 0 || i === 3 ? 1.1 : 1;
    const troch = P(0.06, bodyY - k(0.025));
    const knee = P(0.38, bodyY + k(0.24) - i * k(0.012));
    const pat = P(0.48, bodyY + k(0.21) - i * k(0.012));
    const ank = P(0.76, k(0.14));
    const met = P(0.93, k(0.045));
    const toe = P(1.0, k(0.0));
    const leg = rb.pm(`leg_l${i + 1}`, 'body', hip);
    ell(leg, hip, [k(0.04), k(0.035), k(0.04)], mulRGB(pal.leg, 0.85)); // coxa
    tube(leg, [hip, troch, P(0.22, bodyY + k(0.14)), knee], (t) => k(0.04) * thick - t * k(0.005), legC); // trochanter + femur (rising)
    ell(leg, knee, [k(0.04) * thick, k(0.038) * thick, k(0.04) * thick], mix(pal.leg, pal.band, 0.55)); // knee knuckle
    tube(leg, [knee, pat], (t) => k(0.036) * thick - t * k(0.002), (x, y, z) => (hash3(x, y, z) < 0.5 ? mix(pal.leg, pal.band, 0.45) : pal.leg)); // patella (pale-banded)
    tube(leg, [pat, P(0.62, k(0.2)), ank], (t) => k(0.034) * thick - t * k(0.007), legC); // tibia
    ell(leg, ank, [k(0.028), k(0.028), k(0.028)], mix(pal.leg, pal.band, 0.35));
    tube(leg, [ank, met], (t) => k(0.026) * thick - t * k(0.005), legC); // metatarsus
    tube(leg, [met, toe], (t) => k(0.022) * thick - t * k(0.003), mulRGB(pal.leg, 0.75)); // tarsus
    ell(leg, [toe[0], k(0.012), toe[2]], [k(0.024), k(0.014), k(0.03)], mulRGB(pal.leg, 0.5), { rot: [0, -a + Math.PI / 2, 0] }); // scopula pad
    // longitudinal pale stripes on patella + tibia (tarantula leg markings)
    paint(leg, (x, y, z) => {
      const along = ((x - hip[0]) * dx + (z - hip[2]) * dz) / R;
      return along > 0.38 && along < 0.7 && y > bodyY - k(0.02) - (along - 0.38) * k(0.5) && hash3(Math.round(along * 40), 1, i) < 0.6 && Math.abs(((x - hip[0]) * -dz + (z - hip[2]) * dx)) < VS * 0.6;
    }, mix(pal.band, pal.legHair, 0.3));
    // setae: long hairs, more on the femur/tibia, golden tips
    hairy(leg.m, (x, y, z) => {
      const along = ((x * VS - hip[0]) * dx + (z * VS - hip[2]) * dz) / R;
      return along > 0.04 && along < 0.95 && y * VS > k(0.02);
    }, (_x, _y, _z, src, t) => hairTip(src, t), 0.5, 2, 51 + i * 7 + v, true);
    // tarsal claws
    leg.line([toe[0] + dx * k(0.01), k(0.006), toe[2] + dz * k(0.01)], [toe[0] + dx * k(0.03), 0, toe[2] + dz * k(0.03)], 0x0c0806);
  }

  rb.mirrorLR();

  for (const p of rb.parts) if (p.model.count > 5000) hollow(p.model, 3);
  realFinish(rb, 0.85);
  rb.sockM('mouth', 'head', [0, bodyY - k(0.06), k(0.4)]);
  rb.sockM('muzzle', 'head', [0, bodyY - k(0.04), k(0.42)]);
  rb.sockM('head_top', 'head', [0, bodyY + k(0.16), k(0.26)]);
  rb.sockM('back', 'body', [0, bodyY + k(0.24), -k(0.34)]);
  return rb.build({ height: bodyY + k(0.28), radius: k(0.55), length: k(1.2), kind: 'spider', headY: bodyY + k(0.1) });
}
