// =============================================================================
// SET DRESSING FOR THE HALL OF TWO TRUTHS (AnubisTrial), 1/24 m, faces +Z, pivot bottom.
//   jackal shrine   the god's watchdog lying on his gilded shrine chest, after the one in
//                   the boy-king's tomb: a pylon-shaped chest with battered walls, a cavetto
//                   cornice and torus roll, gold frames round black-lacquer panels carrying
//                   raised djed-and-tyet friezes, on a sledge with gold-capped carrying poles.
//                   On the lid a recumbent black jackal: deep chest, folded haunches, long
//                   forelegs with paws, a lean neck, long snout, tall ears with gold inner
//                   faces, gold-rimmed modelled eyes, a gold ribbon at the throat, the tail
//                   laid along the lid.
//   offering table  a granite hetep table on a moulded stand: bread loaves with scored
//                   crusts, a heap of figs, blue lotus flowers, a tall beer jar and an incense
//                   bowl with one live ember.
//   feather of Ma'at a tall gilded standard on a stepped plinth carrying the ostrich plume
//                   of truth: a curved rachis, painted vane bands, a drooping tip.
// Everything is sculpted from blended masses (tk ell / seg / rbox) and then weathered.
// =============================================================================
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { V3 } from '../../../engine/voxel/Rig';
import { ell, seg, rbox, carveEll } from '../enemies/tk';
import { noise } from '../../../engine/math/rand';
import { weather } from '../wear';

export type DressModel = { model: VoxelModel; voxelSize: number };
const VS = 1 / 24;
const MET = VF.METAL;
const GOLD = 0xd8a640, GOLD_S = 0xa87a26, GOLD_H = 0xf2cf72;
const LACQ = 0x17151c, LACQ_S = 0x0d0c11, LACQ_H = 0x2c2834;
const LAPIS = 0x2d56a6, TURQ = 0x2f9a86, CARN = 0x9a3e26;
const GRANITE = 0x5f5a56, GRAN_S = 0x48443f, GRAN_H = 0x78716a;

const recolor = (m: VoxelModel, f: (x: number, y: number, z: number, c: number) => [number, number] | null) => {
  const todo: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, fl) => {
    const r = f(x, y, z, c);
    if (r && (r[0] !== c || r[1] !== fl)) todo.push([x, y, z, r[0], r[1]]);
  });
  for (const [x, y, z, c, fl] of todo) m.set(x, y, z, c, fl);
};
const surf = (m: VoxelModel, x: number, y: number, z: number) => !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z) || !m.has(x, y - 1, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);

// ----------------------------------------------------------------------------- the jackal shrine
export function jackalShrineModel(): DressModel {
  const m = new VoxelModel('hall_jackal_shrine');
  const HX = 9, Z0 = -18, Z1 = 18, TOP = 22;
  // sledge runners with curled fronts, and two carrying poles through brackets
  for (const s of [1, -1]) {
    seg(m, [s * 7, 1, Z0 - 2], [s * 7, 1, Z1 + 2], 1.4, GOLD_S);
    seg(m, [s * 7, 1.5, Z1 + 2], [s * 7, 4, Z1 + 4], 1.3, GOLD_S);
    seg(m, [s * 7, 7, Z0 - 7], [s * 7, 7, Z1 + 7], 1.0, LACQ);
    for (const e of [Z0 - 7, Z1 + 7]) ell(m, s * 7, 7, e, 1.5, 1.5, 1.6, GOLD_H, MET);
  }
  // the chest: battered walls (it narrows upward), a torus roll, a cavetto cornice, a raised lid
  for (let y = 3; y <= TOP; y++) {
    const t = (y - 3) / (TOP - 3);
    const hx = HX - t * 0.9, hz0 = Z0 + t * 0.9, hz1 = Z1 - t * 0.9;
    for (let x = -Math.round(hx); x <= Math.round(hx); x++) for (let z = Math.round(hz0); z <= Math.round(hz1); z++) m.set(x, y, z, LACQ);
  }
  for (let y = TOP - 2; y <= TOP + 3; y++) {
    const flare = y >= TOP ? (y - TOP + 1) * 0.7 : 0.6; // the torus, then the cornice flaring out
    rbox(m, -Math.round(HX + flare), y, Math.round(Z0 - flare), Math.round(HX + flare), y, Math.round(Z1 + flare), y === TOP - 1 ? GOLD_H : y >= TOP + 2 ? GOLD : LAPIS, 1, 'xz', y === TOP - 1 || y >= TOP + 2 ? MET : 0);
  }
  rbox(m, -8, TOP + 4, -16, 8, TOP + 4, 16, LACQ_H, 2, 'xz');
  // panels: gold frames, black lacquer fields with raised djed / tyet friezes, a lapis dado band
  recolor(m, (x, y, z, c) => {
    if (c !== LACQ || y < 3 || y > TOP - 3 || !surf(m, x, y, z)) return null;
    const side = Math.abs(x) >= 8; // long walls (x faces); else the end walls
    const u = side ? z : x;
    const umax = side ? 17 : 8;
    if (y <= 5 || y >= TOP - 4 || Math.abs(u) >= umax - 1) return [GOLD, MET];
    if (y === 6) return [(u & 3) === 0 ? CARN : (u & 3) === 2 ? TURQ : LAPIS, 0];
    const cell = side ? ((u + 64) % 6) : ((u + 64) % 5);
    const vy = y - 8;
    // the frieze: djed pillars (cross bars) alternating with tyet knots (a loop on a stem)
    const djed = Math.floor((u + 64) / 6) % 2 === 0;
    if (cell === 2 || cell === 3) {
      if (djed && vy >= 0 && vy <= 8) return [vy === 6 || vy === 7 || vy === 4 ? GOLD_H : GOLD, MET];
      if (!djed && vy >= 0 && vy <= 5) return [GOLD, MET];
    }
    if (!djed && vy >= 6 && vy <= 9 && cell >= 1 && cell <= 4 && !(vy === 7 && (cell === 2 || cell === 3))) return [GOLD, MET];
    return [noise.n3(x * 0.3, y * 0.3, z * 0.3) > 0.5 ? LACQ_H : LACQ, 0];
  });
  // ---- the recumbent jackal on the lid
  const B = TOP + 5;
  ell(m, 0, B + 4.5, -2, 5.2, 4.6, 10.5, LACQ); // body
  ell(m, 0, B + 5.5, 5.5, 4.6, 5.4, 4.8, LACQ); // deep chest
  for (const s of [1, -1]) {
    ell(m, s * 3.4, B + 4.2, -9, 3.6, 4.4, 5.2, LACQ); // haunches
    ell(m, s * 4.4, B + 1.6, -6.5, 1.8, 1.7, 5.5, LACQ); // folded hind leg
    ell(m, s * 4.2, B + 1.2, -1.2, 1.5, 1.2, 2.2, LACQ_S); // hind paw tucked forward
    seg(m, [s * 2.7, B + 4, 6], [s * 2.5, B + 1.4, 14.5], 1.6, LACQ, 0, 1.3); // forearm
    ell(m, s * 2.5, B + 1.2, 16.2, 1.7, 1.2, 2.4, LACQ); // paw
    for (const k of [-1, 0, 1]) m.set(Math.round(s * 2.5 + k * 0.9), B + 1, 18, LACQ_H); // toes
  }
  seg(m, [0, B + 7.5, 6.5], [0, B + 13, 8.2], 3.2, LACQ, 0, 2.6); // neck
  ell(m, 0, B + 14.6, 8.2, 3.7, 3.4, 4.2, LACQ); // cranium
  seg(m, [0, B + 13.8, 10.5], [0, B + 12.6, 17.5], 2.1, LACQ, 0, 1.15); // long snout
  ell(m, 0, B + 13.2, 13, 2.2, 1.4, 3.2, LACQ); // muzzle mass
  ell(m, 0, B + 12.9, 18.2, 1.0, 0.9, 0.8, 0x07070b); // nose
  for (const s of [1, -1]) {
    seg(m, [s * 2.0, B + 16.5, 7.6], [s * 2.7, B + 23.5, 6.4], 1.7, LACQ, 0, 0.45); // tall ears
    // eyes: carved socket, gold rim, white calcite, obsidian pupil (modelled, set in the skull)
    carveEll(m, s * 2.5, B + 15, 11, 0.9, 0.7, 0.9);
    m.set(s * 3, B + 15, 11, 0xe8e0d0).set(s * 2, B + 15, 11, 0x0a0806);
    m.set(s * 3, B + 16, 11, GOLD_H, MET).set(s * 2, B + 14, 11, GOLD_H, MET);
    seg(m, [s * 3.4, B + 15, 10.6], [s * 3.9, B + 15.6, 8.6], 0.45, GOLD, MET); // kohl line
  }
  // gold inner faces of the ears
  recolor(m, (x, y, z, c) => (c === LACQ && y >= B + 19 && y <= B + 22 && Math.abs(x) >= 1 && Math.abs(x) <= 4 && z >= 6 && !m.has(x, y, z + 1) ? [GOLD, MET] : null));
  // gold ribbon at the throat, tied in a knot with hanging ends
  m.forEach((x, y, z) => {
    if (y >= B + 9 && y <= B + 10 && z >= 5 && surf(m, x, y, z)) m.set(x, y, z, GOLD, MET);
  });
  seg(m, [0.5, B + 9, 10.4], [1, B + 6, 11.2], 0.6, GOLD_H, MET);
  // the tail laid along the lid
  seg(m, [0, B + 3.5, -12], [2.5, B + 1.4, -15.5], 1.4, LACQ, 0, 1.1);
  seg(m, [2.5, B + 1.4, -15.5], [5.5, B + 0.8, -13], 1.1, LACQ, 0, 0.7);
  // fur sheen streaks on the lacquered body
  recolor(m, (x, y, z, c) => {
    if (c !== LACQ || y < B || !surf(m, x, y, z)) return null;
    const n = noise.n3(x * 0.9, y * 0.22, z * 0.9);
    return n > 0.42 ? [LACQ_H, 0] : n < -0.5 ? [LACQ_S, 0] : null;
  });
  weather(m, { seed: 3, edge: 0.2, cavity: 0.2, dust: 0.08, scuffs: 0.3, stains: 0.1 });
  return { model: m, voxelSize: VS };
}

// ----------------------------------------------------------------------------- the offering table
export function offeringTableModel(): DressModel {
  const m = new VoxelModel('hall_offering_table');
  // moulded stand: a flared foot, a waisted shaft, a capital, then the slab with its spout
  for (let y = 0; y <= 15; y++) {
    const r = y < 2 ? 5.2 - y * 0.6 : y > 13 ? 3.4 + (y - 13) * 0.8 : 2.6 + Math.abs(y - 8) * 0.06 + (y === 3 ? 0.8 : 0);
    ell(m, 0, y, 0, r, 0.55, r, y === 3 || y === 14 ? GRAN_H : GRANITE);
  }
  rbox(m, -10, 16, -7, 10, 18, 7, GRANITE, 1);
  rbox(m, -9, 19, -6, 9, 19, 6, GRAN_S, 1); // the recessed offering plane (hetep: loaf on a mat)
  rbox(m, -10, 19, -7, 10, 19, -7, GRANITE, 0);
  rbox(m, -10, 19, 7, 10, 19, 7, GRANITE, 0);
  rbox(m, -2, 16, 7, 2, 17, 10, GRANITE, 1); // spout
  // engraved channels on the slab top running to the spout
  for (let z = -5; z <= 8; z++) m.set(0, 19, z, GRAN_S);
  // offerings
  const BY = 20;
  for (const [x, z, s] of [[-5.5, -1.5, 1], [-1.5, -3, 0.85]] as [number, number, number][]) {
    ell(m, x, BY + 1.6 * s, z, 3 * s, 1.9 * s, 2.6 * s, 0xc88a44);
    for (let k = -1; k <= 1; k++) m.set(Math.round(x + k * 1.2), Math.round(BY + 3.2 * s), Math.round(z), 0x8a5a26); // scored crust
  }
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4, r = i ? 1.6 : 0;
    ell(m, 4.5 + Math.cos(a) * r, BY + 0.9 + (i ? 0 : 1.2), 2.5 + Math.sin(a) * r, 1.1, 1.0, 1.1, i % 2 ? 0x5a2a4a : 0x6e3858); // figs
  }
  // a tall beer jar
  for (let y = 0; y <= 12; y++) {
    const r = y < 2 ? 1.2 + y * 0.7 : y < 8 ? 2.6 - Math.abs(y - 5) * 0.12 : y < 11 ? 1.6 - (y - 8) * 0.2 : 1.4;
    ell(m, 6.5, BY + y, -3.5, r, 0.55, r, y === 9 ? 0x2d56a6 : y > 10 ? 0x6a4020 : 0xb0703a);
  }
  // blue lotus: stems bending over the edge, closed buds and one open flower
  for (const [x, z, h, open] of [[-7, 4, 9, 1], [-5.5, 5, 7, 0], [-8.5, 3, 6, 0]] as [number, number, number, number][]) {
    seg(m, [x + 2, BY, z - 2], [x, BY + h, z], 0.45, 0x3f6f2a);
    if (open) for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      seg(m, [x, BY + h, z], [x + Math.cos(a) * 2.2, BY + h + 1.6, z + Math.sin(a) * 2.2], 0.55, k % 2 ? 0x6a8ed8 : 0x8aaaf0);
    }
    else ell(m, x, BY + h + 1, z, 0.9, 1.7, 0.9, 0x5a7ec8);
    if (open) ell(m, x, BY + h + 0.4, z, 0.8, 0.6, 0.8, 0xf2cf72);
  }
  // incense bowl with one live ember
  ell(m, 0, BY + 1, 4.5, 2.2, 1.1, 2.2, GOLD_S, MET);
  carveEll(m, 0, BY + 2, 4.5, 1.6, 0.8, 1.6);
  m.set(0, BY + 1, 4, 0xff8a3a, VF.EMISSIVE).set(1, BY + 1, 5, 0xffc060, VF.EMISSIVE);
  recolor(m, (x, y, z, c) => (c === GRANITE && surf(m, x, y, z) ? [noise.n3(x * 0.5, y * 0.5, z * 0.5) > 0.35 ? GRAN_H : noise.n3(x * 0.7 + 3, y * 0.7, z * 0.7) < -0.45 ? GRAN_S : GRANITE, 0] : null));
  weather(m, { seed: 5, edge: 0.16, cavity: 0.22, dust: 0.1, scuffs: 0.4, stains: 0.3 });
  return { model: m, voxelSize: VS };
}

// ----------------------------------------------------------------------------- the feather standard
export function maatFeatherModel(): DressModel {
  const m = new VoxelModel('hall_maat_feather');
  for (let y = 0; y <= 4; y++) rbox(m, -(6 - y), y, -(6 - y), 6 - y, y, 6 - y, y === 2 ? GOLD : GRANITE, 1, 'xz', y === 2 ? MET : 0); // stepped plinth
  seg(m, [0, 4, 0], [0, 50, 0], 1.0, GOLD, MET); // gilded pole
  for (const y of [12, 24, 36, 49]) ell(m, 0, y, 0, 1.8, 0.9, 1.8, GOLD_H, MET); // collars
  // the plume: curved rachis rising and drooping forward, vanes either side in painted bands
  const P = (t: number): V3 => [Math.sin(t * 2.1) * 1.2, 51 + t * 26 - t * t * 6, t * t * 9];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, c = P(t);
    const w = 4.2 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.92) + 0.6;
    for (let k = -Math.ceil(w); k <= Math.ceil(w); k++) {
      if (Math.abs(k) > w) continue;
      const band = Math.floor(t * 10) % 3;
      const col = Math.abs(k) < 0.6 ? 0xf6ead0 : band === 0 ? 0x2f9a86 : band === 1 ? 0xf0e4c8 : 0x2d56a6;
      m.set(Math.round(c[0] + k), Math.round(c[1] - Math.abs(k) * 0.35), Math.round(c[2]), Math.abs(k) > w - 1 && (i & 1) ? 0xd8ccb0 : col);
      m.set(Math.round(c[0] + k), Math.round(c[1] - Math.abs(k) * 0.35), Math.round(c[2]) - 1, 0xd8ccb0);
    }
  }
  weather(m, { seed: 7, edge: 0.14, cavity: 0.18, dust: 0.06, scuffs: 0.3, stains: 0.1 });
  return { model: m, voxelSize: VS };
}

/** where the dressing stands in the hall (world metres, ry radians); geometry is shared per model */
export function hallDressing(): { sm: DressModel; at: V3; ry: number }[] {
  const shrine = jackalShrineModel(), table = offeringTableModel(), feather = maatFeatherModel();
  const out: { sm: DressModel; at: V3; ry: number }[] = [];
  for (const s of [1, -1]) {
    for (const z of [14.5, 5.5]) out.push({ sm: shrine, at: [s * 8.1, 0, z], ry: -s * Math.PI / 2 });
    for (const z of [10, -3.5]) out.push({ sm: table, at: [s * 7.7, 0, z], ry: -s * Math.PI / 2 });
    out.push({ sm: feather, at: [s * 6.9, 0, -11.2], ry: -s * 0.5 });
  }
  return out;
}
