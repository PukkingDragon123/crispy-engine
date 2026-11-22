// THE BEETLES: four scarab musicians of Khepri and the colossus they become.
//
// The band (one rig, `beetles_band`, 1/30 m): four upright scarabs ~1.5 m tall,
// each a different iridescent chitin (emerald-gold rhythm, lapis-violet bass,
// copper-crimson lead, obsidian-gold drums). Glossy segmented abdomens with
// sternite seams, a rounded pronotum, striated elytra hinged to open for flight
// over folded amber wings, a toothed clypeus scoop for a face, faceted compound
// eyes with glints (modelled, not painted), lamellate club antennae poking out
// of a golden-bristle mop-top fringe, thick spurred hind legs, toothed digging
// fore-tibiae for hands, little mid legs. Instruments, all Nile-made:
//   b0 rhythm: a two-bout semi-hollow guitar with lotus f-holes and an ankh headstock
//   b1 bass:   a violin-shaped bass in amber sunburst, played left-handed
//   b2 lead:   an oud-bodied lute guitar (staved bowl, sun rosette, bent pegbox)
//   b3 drums:  a lapis bass drum with a scarab-and-sun head, snare, floor tom,
//              hi-hat and crash in hammered bronze, a stool; sticks in his hands
// Parts per member (prefix b0_..b3_): body (root, the hip) → torso (pronotum) →
// head → ant_l/_r; torso → elytra_l/_r, wing_l/_r (hidden until flight),
// arm_l/_r → fore_l/_r, inst; body → leg_l/_r → shin_l/_r; b3 also body → kit.
// Sockets: b0_fx..b3_fx (where an instrument's notes leave it).
//
// The colossus (`beetles_colossus`, 1/10 m, ~8.8 m): a scarab mech in gold,
// lapis and bronze. pelvis (segmented abdomen rings) → thigh/shin/foot (piston
// thighs, saw-toothed tibiae, three-claw feet); torso (the great pronotum
// shield, riveted, with organ-pipe amplifiers on its back under the elytra) →
// disc (a spinning sun-disc record on the chest), head (rake-toothed crown, a
// curved rhinoceros horn, bezelled lens eyes eye_l/_r, mandibles mand_l/_r,
// antennae ant_l/_r), arm/fore (gold pauldrons, sawtooth tibiae) → fist_l (a
// toothed chitin claw) / fist_r (the silver hammer), cannon_l/_r (shoulder
// guns for the salute), elytra_l/_r. Sockets: mouth, disc_c, muzzle_l/_r, fist_l/_r.
import { TRig, VF, TOON, ell, seg, chain, paintSurf, bossExpressions } from '../tk';
import type { RigSpec, V3 } from '../tk';
import type { VoxelModel } from '../../../../engine/voxel/VoxelModel';
import { hash3 } from '../../../../engine/math/rand';

interface Chitin {
  base: number;
  shade: number;
  hi: number;
  dark: number;
  glint: number;
}
const MEMBERS: Chitin[] = [
  { base: 0x1f6a3a, shade: 0x0f3f22, hi: 0x3fa060, dark: 0x082414, glint: 0xb8f08a },
  { base: 0x2c3a92, shade: 0x18205a, hi: 0x5068cc, dark: 0x0c1030, glint: 0xb0c4ff },
  { base: 0x8a2e1a, shade: 0x521608, hi: 0xc0582c, dark: 0x2a0a04, glint: 0xffc080 },
  { base: 0x2a2420, shade: 0x161210, hi: 0x4e4234, dark: 0x0a0806, glint: 0xf0c860 },
];
const HAIR = [0x6a4420, 0x8a5a2a, 0xa8743a, 0xc4924e];
const GOLD = TOON.gold, LAPIS = TOON.lapis, BRONZE = { base: 0xa8742e, shade: 0x7a521e, hi: 0xd8a050, dark: 0x4a3010 }, SILVER = TOON.silver;

/** chitin surface: glossy base, hi on top-facing rims, a glint stripe, dark sutures */
function chitinPaint(m: VoxelModel, c: Chitin) {
  const hits: [number, number, number, number][] = [];
  m.forEach((x, y, z, col) => {
    if (col !== c.base) return;
    const up = !m.has(x, y + 1, z), dn = !m.has(x, y - 1, z);
    if (up && hash3(x, y, z) < 0.5) hits.push([x, y, z, c.hi]);
    else if (dn) hits.push([x, y, z, c.shade]);
  });
  for (const [x, y, z, col] of hits) m.set(x, y, z, col, VF.SOLID | VF.METAL);
}

/**
 * Sculpt an instrument in its own plane: u runs along the neck, v across it, w out of the
 * face. `fn` returns a colour (or null) per local voxel; the plane is tilted by `tilt` about Z
 * and lies at depth z0.
 */
function plane(m: VoxelModel, o: V3, tilt: number, ext: [number, number, number, number, number, number], fn: (u: number, v: number, w: number) => number | null, flags?: (u: number, v: number, w: number) => number) {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const [u0, u1, v0, v1, w0, w1] = ext;
  const R = Math.max(Math.abs(u0), Math.abs(u1)) + Math.max(Math.abs(v0), Math.abs(v1)) + 1;
  for (let x = Math.floor(o[0] - R); x <= Math.ceil(o[0] + R); x++)
    for (let y = Math.floor(o[1] - R); y <= Math.ceil(o[1] + R); y++)
      for (let z = Math.floor(o[2] + w0); z <= Math.ceil(o[2] + w1); z++) {
        const dx = x - o[0], dy = y - o[1];
        const u = dx * c + dy * s, v = -dx * s + dy * c, w = z - o[2];
        if (u < u0 || u > u1 || v < v0 || v > v1 || w < w0 || w > w1) continue;
        const col = fn(u, v, w);
        if (col === null) continue;
        m.set(x, y, z, col, flags ? flags(u, v, w) : VF.SOLID);
      }
}

// ===================================================================================== the band
function member(rig: TRig, i: number) {
  const P = `b${i}_`;
  const C = MEMBERS[i];
  const drummer = i === 3;
  // ---- body: the abdomen (sternite seams on the belly), mid legs
  const body = rig.part(P + 'body', undefined, [0.5, 16, 0.5]);
  ell(body, 0.5, 23.5, -1, 7, 9, 5.6, C.base);
  paintSurf(body, (x, y, z) => z > 1 && (y - 15) % 3 === 0, C.dark);
  paintSurf(body, (x, y, z) => z > 2 && (y - 15) % 3 === 1, C.shade);
  for (const s of [1, -1]) {
    chain(body, [[s * 5.5 + 0.5, 26, 2], [s * 8.5 + 0.5, 21, 3.5], [s * 9.5 + 0.5, 17, 6]], [1.1, 0.9, 0.6], C.shade);
    body.set(s * 10 + (s > 0 ? 0 : 1), 16, 7, C.dark);
  }
  chitinPaint(body, C);
  // ---- torso: the pronotum shield
  const torso = rig.part(P + 'torso', P + 'body', [0.5, 31, 0.5]);
  ell(torso, 0.5, 34, 0.2, 7.6, 4.8, 6.4, C.base);
  paintSurf(torso, (x, y, z) => y >= 37 && Math.abs(x - 0.5) < 1, C.dark); // the median suture
  paintSurf(torso, (x, y, z) => y === 37 && (x === 3 || x === -2) && z > 2, C.glint);
  chitinPaint(torso, C);
  rig.socket(P + 'fx', drummer ? P + 'kit' : P + 'torso', drummer ? [0.5, 8, 13] : [-1.5, 26, 9]);
  // ---- head: clypeus scoop with rake teeth, faceted eyes, the mop-top
  const head = rig.part(P + 'head', P + 'torso', [0.5, 38, 2]);
  ell(head, 0.5, 41.5, 3, 5, 4, 4.5, C.base);
  // clypeus: a broad scoop jutting forward, its front edge cut into six teeth
  for (let x = -5; x <= 6; x++)
    for (let z = 5; z <= 9; z++)
      for (let y = 38; y <= 40; y++) {
        if (Math.hypot((x - 0.5) / 6, (z - 5) / 4.2) > 1) continue;
        if (z === 9 && (x + 6) % 2 === 0) continue;
        head.set(x, y, z, y === 40 ? C.hi : C.base, VF.SOLID | VF.METAL);
      }
  // compound eyes: glossy black domes, a facet grid catching light, a glint
  for (const s of [1, -1]) {
    const ex = s * 4.2 + 0.5;
    for (let x = Math.floor(ex - 2); x <= Math.ceil(ex + 2); x++)
      for (let y = 40; y <= 43; y++)
        for (let z = 3; z <= 7; z++) {
          const d = Math.hypot((x - ex) / 1.7, (y - 41.5) / 1.6, (z - 5) / 1.7);
          if (d > 1) continue;
          const g = (x + y + z) % 2 === 0;
          const glint = y === 42 && z === 6 && Math.abs(x - ex) < 0.8;
          head.set(x, y, z, glint ? 0xffffff : g ? 0x2a2418 : 0x0e0c08, glint ? VF.SOLID | VF.GLOW : VF.SOLID | VF.METAL);
        }
  }
  // little mandibles under the scoop
  for (const s of [1, -1]) seg(head, [s * 2 + 0.5, 37.6, 6], [s * 0.8 + 0.5, 37, 8], 0.6, C.dark);
  // the mop-top: a cap of golden bristles, bangs to the eyebrows, sides over the cheeks
  for (let x = -6; x <= 7; x++)
    for (let y = 41; y <= 47; y++)
      for (let z = -3; z <= 8; z++) {
        const dx = x - 0.5, dz = z - 2.6;
        const cap = Math.hypot(dx / 5.9, (y - 43.6) / 3.2, dz / 5.6);
        if (cap > 1 || cap < 0.72) continue;
        const front = dz > 3.4;
        if (front && y < 43) continue; // the bangs stop above the eyes
        if (!front && Math.abs(dx) > 4.6 && y < 41) continue;
        const strand = HAIR[(Math.abs(x * 7 + z * 3) + (y > 45 ? 2 : 0)) % 4];
        head.set(x, y, z, y >= 46 ? HAIR[3] : strand, VF.SOLID | VF.SOFTAO);
      }
  // bangs fringe tips: short strands hanging over the brow, a parting
  for (let x = -4; x <= 5; x++) if (x !== 1) head.set(x, 42, 7, HAIR[(x + 9) % 3], VF.SOLID | VF.SOFTAO);
  // ---- antennae: stalk out through the fringe to a three-plate lamellate club
  const ant = rig.part(P + 'ant_l', P + 'head', [2.5, 43, 6.5]);
  chain(ant, [[2.5, 43, 6.5], [4, 44.5, 8.5], [5.5, 45.5, 9.5]], [0.5, 0.5, 0.45], C.dark);
  // the club: three stacked lamellae fanned from the stalk tip
  for (let k = 0; k < 3; k++) ell(ant, 5.8 + k * 0.7, 46 + (k - 1) * 0.9, 10.2, 1.3, 0.55, 1.1, k === 1 ? GOLD.hi : GOLD.base, VF.SOLID | VF.METAL);
  // ---- elytra over the back (they open for flight), folded wings beneath
  const ely = rig.part(P + 'elytra_l', P + 'torso', [1, 36, -3.5]);
  ell(ely, 3.6, 25, -5.2, 4.4, 11.2, 3.8, C.base, undefined, (x, y, z) => x >= 1 && z <= -2);
  paintSurf(ely, (x, y, z) => (x - 1) % 2 === 0 && z < -6, C.shade); // striae grooves
  paintSurf(ely, (x, y, z) => x === 1, C.dark); // the sutural seam
  chitinPaint(ely, C);
  const wing = rig.part(P + 'wing_l', P + 'torso', [1, 35, -6]);
  for (let x = 1; x <= 12; x++)
    for (let y = 18; y <= 35; y++) {
      const t = (35 - y) / 17;
      if (x > 2 + Math.sin(t * Math.PI) * 10) continue;
      const vein = (x + Math.floor(y * 0.4)) % 4 === 0 || y === 34;
      wing.set(x, y, -7, vein ? 0x5a3a14 : 0xe0b060, VF.SOLID | VF.SOFTAO | VF.EMISSIVE);
    }
  // ---- arms (fore legs): femur → toothed tibia with a tarsal claw
  const arm = rig.part(P + 'arm_l', P + 'torso', [6.5, 34, 2]);
  seg(arm, [6.5, 34, 2], [8.5, 28.5, 4], 1.5, C.base, undefined, 1.2);
  chitinPaint(arm, C);
  const fore = rig.part(P + 'fore_l', P + 'arm_l', [8.5, 28, 4]);
  seg(fore, [8.5, 28, 4], [7, 22.5, 7.5], 1.2, C.base, undefined, 1.0);
  for (let k = 0; k < 3; k++) fore.set(10, 26 - k * 1.6, 5 + k, C.dark); // the digging teeth
  seg(fore, [7, 22.3, 7.6], [6.2, 21.4, 9], 0.6, C.dark);
  if (drummer) {
    // drumsticks: pale wood with a bead tip
    seg(fore, [6.5, 21.6, 8.6], [2.5, 21, 14.5], 0.55, 0xe0c090);
    fore.set(2, 21, 15, 0xfff0d0);
  }
  chitinPaint(fore, C);
  // ---- hind legs: thick femur → spurred tibia → clawed tarsus
  const leg = rig.part(P + 'leg_l', P + 'body', [4, 16, 0]);
  seg(leg, [4, 16, 0], [5, 9, 2], 2.1, C.base, undefined, 1.6);
  chitinPaint(leg, C);
  const shin = rig.part(P + 'shin_l', P + 'leg_l', [5, 9, 2]);
  seg(shin, [5, 9, 2], [5, 2.5, 0], 1.4, C.base, undefined, 1.1);
  for (let k = 0; k < 3; k++) shin.set(7, 7 - k * 2, 1, C.dark);
  chain(shin, [[5, 2, 0], [5, 0.8, 2.5], [5, 0.5, 4.5]], [0.9, 0.8, 0.6], C.shade);
  for (const dx of [-1, 1]) shin.set(5 + dx, 0, 5, C.dark);
  chitinPaint(shin, C);

  // ---- the instrument
  if (i === 0 || i === 1) {
    const bass = i === 1;
    const inst = rig.part(P + 'inst', P + 'torso', [0.5, 28, 8]);
    const tilt = bass ? Math.PI - 0.62 : 0.62;
    const o: V3 = bass ? [2, 24, 8] : [-1, 24, 8];
    const lb = bass ? [4.4, 5.0] : [4.2, 4.8], ub = bass ? [3.4, 4.0] : [3.2, 3.8], uc = bass ? 5.2 : 4.6;
    const L = bass ? 25 : 22;
    plane(inst, o, tilt, [-5, L + 1, -6, 6, -1, 2], (u, v, w) => {
      const inLow = (u / lb[0]) ** 2 + (v / lb[1]) ** 2 <= 1;
      const inUp = ((u - uc) / ub[0]) ** 2 + (v / ub[1]) ** 2 <= 1;
      const waist = bass && Math.abs(u - 2.8) < 0.9 && Math.abs(v) > 3.2;
      if ((inLow || inUp) && !waist && w <= 1) {
        const rr = Math.min(1, Math.hypot(u / (lb[0] + 1), v / (lb[1] + 0.6)));
        if (w < 0) return bass ? 0x4a2410 : 0x6a3414; // the back
        // lotus f-holes, a bridge and tailpiece, a pickguard
        if (Math.abs(Math.abs(v) - 2.4) < 0.5 && u > 1 && u < 4.5) return 0x140a06;
        if (Math.abs(u + 1.2) < 0.6 && Math.abs(v) < 2) return GOLD.hi;
        if (!bass && v < -1.2 && u > 0 && u < 4) return LAPIS.base;
        if (bass && v > 1.4 && u > 3 && u < 6) return 0x1a120c;
        return bass ? (rr > 0.8 ? 0x5a2a10 : rr > 0.5 ? 0xa85a20 : 0xe0a040) : rr > 0.82 ? 0x8a4a1a : rr > 0.55 ? 0xc07a2a : 0xe8b850;
      }
      // the neck: dark wood, gold fret dots, a silver string line
      if (u >= uc + 2 && u <= L - 4 && Math.abs(v) <= 0.9 && w >= 0 && w <= 1) return w === 1 && Math.abs(v) < 0.5 ? (Math.round(u) % 3 === 0 ? GOLD.hi : 0xd8dce4) : 0x3a2414;
      // the headstock: an ankh (loop with a hole, a crossbar), gold tuning pegs
      if (!bass && w >= 0 && w <= 1) {
        const lu = u - (L - 1.5);
        if (Math.hypot(lu / 1.9, v / 1.6) <= 1 && Math.hypot(lu / 0.9, v / 0.7) > 1) return GOLD.base;
        if (Math.abs(u - (L - 3.6)) < 0.6 && Math.abs(v) <= 2.4) return Math.abs(v) > 1.8 ? GOLD.hi : GOLD.base;
        if (u > L - 4 && u < L - 3 && Math.abs(v) < 0.8) return GOLD.base;
      }
      if (bass && w >= 0 && w <= 1 && u > L - 4 && u <= L) {
        if (Math.abs(v) <= 1.3) return 0x3a2414;
        if (Math.abs(v) <= 2 && Math.round(u) % 2 === 0) return GOLD.hi;
      }
      return null;
    }, (u, v, w) => (w === 1 && Math.abs(v) < 0.5 && u > uc + 2 ? VF.SOLID | VF.METAL : VF.SOLID));
  } else if (i === 2) {
    // the oud: a staved pear bowl, a pale soundboard with a sun rosette, a bent-back pegbox
    const inst = rig.part(P + 'inst', P + 'torso', [0.5, 28, 8]);
    plane(inst, [-1.5, 23.5, 8.5], 0.55, [-6, 17, -5, 5, -3, 1], (u, v, w) => {
      const e = (u / (u > 0 ? 6.2 : 5.4)) ** 2 + (v / (4.8 - Math.max(0, u) * 0.3)) ** 2;
      if (e <= 1 && u < 6) {
        const bowl = -3 * Math.sqrt(Math.max(0, 1 - e));
        if (w < bowl - 0.5) return null;
        if (w < 1) return w <= 0 && Math.round(v * 1.2) % 2 === 0 ? 0x6a3414 : 0x9a5a24; // the staves
        const rr = Math.hypot(u - 1.2, v);
        if (rr < 1.4) return 0x1a0e06;
        if (rr < 2.3) return Math.round(Math.atan2(v, u - 1.2) * 2.5) % 2 === 0 ? GOLD.hi : 0x3a2010;
        if (Math.abs(u + 3) < 0.6 && Math.abs(v) < 2.4) return 0x3a2010; // the bridge
        return e > 0.86 ? 0xc49860 : 0xead2a2;
      }
      if (u >= 5.8 && u <= 13 && Math.abs(v) <= 0.9 && w >= 0 && w <= 1) return w === 1 && Math.abs(v) < 0.5 ? 0xd8dce4 : 0x3a2414;
      // the pegbox, bent back
      if (u > 13 && u <= 17) {
        const ww = -(u - 13) * 0.9;
        if (Math.abs(v) <= 1 && w <= ww + 1 && w >= ww - 0.4) return Math.round(u) % 2 === 0 && Math.abs(v) > 0.4 ? GOLD.hi : 0x3a2414;
      }
      return null;
    }, (u, v, w) => (w === 1 && Math.abs(v) < 0.5 ? VF.SOLID | VF.METAL : VF.SOLID));
  } else {
    // the drum kit, on the sand in front of him, and his stool
    const kit = rig.part(P + 'kit', P + 'body', [0.5, 0, 9]);
    // bass drum: a lapis shell with gold hoops, a cream head carrying a scarab rolling the sun
    for (let x = -7; x <= 8; x++)
      for (let y = 0; y <= 15; y++)
        for (let z = 6; z <= 12; z++) {
          const rr = Math.hypot(x - 0.5, y - 7.5);
          if (rr > 7.4) continue;
          let c: number = LAPIS.base;
          if (z === 6 || z === 12) c = rr > 6.6 ? GOLD.base : 0xf0e2c0;
          else if (rr > 6.6) c = (z % 2 === 0 ? LAPIS.hi : LAPIS.base);
          if (z === 12 && rr <= 6.6) {
            if (Math.hypot(x - 0.5, y - 10) < 2.6) c = 0xe85a2a; // the sun
            else if (Math.hypot((x - 0.5) / 2.4, (y - 5.2) / 1.9) < 1) c = 0x2a1a10; // the scarab
            else if (Math.abs(y - 7.3) < 0.5 && Math.abs(x - 0.5) < 2.5) c = 0x2a1a10;
            else if (Math.hypot(x - 0.5, y - 7.5) > 5.6) c = GOLD.hi;
          }
          kit.set(x, y + 1, z, c, rr > 6.6 ? VF.SOLID | VF.METAL : VF.SOLID);
        }
    // snare (left) and floor tom (right) with bronze hoops, on legs
    const drum = (cx: number, cy: number, cz: number, R: number, h: number) => {
      for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++)
        for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++)
          for (let y = cy; y <= cy + h; y++) {
            const rr = Math.hypot(x - cx, z - cz);
            if (rr > R) continue;
            kit.set(x, y, z, y === cy + h ? (rr > R - 0.8 ? BRONZE.hi : 0xf0e2c0) : rr > R - 0.8 ? (y % 2 ? LAPIS.base : GOLD.base) : LAPIS.shade, VF.SOLID);
          }
      for (const a of [0.8, 2.9, 5]) seg(kit, [cx + Math.cos(a) * R * 0.7, cy, cz + Math.sin(a) * R * 0.7], [cx + Math.cos(a) * R * 1.1, 0, cz + Math.sin(a) * R * 1.1], 0.4, SILVER.shade);
    };
    drum(-6.5, 13, 5, 3, 2);
    drum(8.5, 7, 4, 3.3, 5);
    // cymbals: hammered bronze, lathe-ringed, a domed bell, on stands
    const cymbal = (cx: number, cy: number, cz: number, R: number, tilt: number) => {
      seg(kit, [cx, 0, cz], [cx, cy - 1, cz], 0.45, SILVER.shade);
      for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++)
        for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) {
          const rr = Math.hypot(x - cx, z - cz);
          if (rr > R) continue;
          const y = Math.round(cy + (z - cz) * tilt + (rr < 1 ? 1 : 0) - rr * 0.12);
          kit.set(x, y, z, Math.round(rr * 1.5) % 2 === 0 ? BRONZE.hi : BRONZE.base, VF.SOLID | VF.METAL);
        }
    };
    cymbal(-9.5, 18, 3, 2.8, 0);
    cymbal(-9.5, 17, 3, 2.8, 0);
    cymbal(7.5, 21, 9, 3.6, -0.3);
    // the stool he sits on
    ell(kit, 0.5, 12.5, -2, 3.4, 1, 3.2, 0x5a2a14);
    for (const [dx, dz] of [[-2, -4], [3, -4], [-2, 0], [3, 0]]) seg(kit, [dx + 0.5 - (dx > 0 ? 0.5 : -0.5), 12, dz], [dx * 1.3 + 0.5, 0, dz * 1.1 - 1], 0.45, SILVER.shade);
  }
}

export function beetlesBandRig(): RigSpec {
  const rig = new TRig('beetles_band', 1 / 30);
  for (let i = 0; i < 4; i++) member(rig, i);
  rig.mirrorLR();
  topo(rig);
  // folded wings stay hidden until a member takes off (the boss shows them)
  return rig.build({ height: 1.5, radius: 0.6, kind: 'beetles_band', members: 4, defaultExpression: 'neutral', expressions: bossExpressions(0.2) });
}

// ===================================================================================== the colossus
export function beetlesColossusRig(): RigSpec {
  const rig = new TRig('beetles_colossus', 1 / 10);
  const EM = { base: 0x1f6a3a, shade: 0x0f3f22, hi: 0x3fa060, dark: 0x082414, glint: 0xb8f08a };
  const plate = (m: VoxelModel) => {
    const hits: [number, number, number, number][] = [];
    m.forEach((x, y, z, c) => {
      if (c !== GOLD.base) return;
      if (!m.has(x, y + 1, z) && hash3(x, y, z) < 0.6) hits.push([x, y, z, GOLD.hi]);
      else if (!m.has(x, y - 1, z)) hits.push([x, y, z, GOLD.shade]);
    });
    for (const [x, y, z, c] of hits) m.set(x, y, z, c, VF.SOLID | VF.METAL);
  };
  const rivets = (m: VoxelModel, pred: (x: number, y: number, z: number) => boolean) => paintSurf(m, (x, y, z) => pred(x, y, z) && hash3(x * 3, y * 5, z * 7) < 0.5, BRONZE.hi, VF.SOLID | VF.METAL);

  // ---- pelvis: the segmented abdomen, gold sternites over bronze joints, a lapis gem belt
  const pelvis = rig.part('pelvis', undefined, [0.5, 34, 0.5]);
  for (let k = 0; k < 5; k++) {
    const y0 = 25 + k * 3.6;
    ell(pelvis, 0.5, y0 + 1.6, -1, 11.5 + k * 0.6, 2.4, 9 + k * 0.4, k % 2 ? GOLD.base : BRONZE.base);
    ell(pelvis, 0.5, y0 + 3.2, -1, 10.5 + k * 0.6, 0.8, 8.2 + k * 0.4, BRONZE.dark);
  }
  for (let a = 0; a < 12; a++) {
    const x = Math.round(Math.sin((a / 12) * Math.PI * 2) * 13.5 + 0.5), z = Math.round(Math.cos((a / 12) * Math.PI * 2) * 10.2 - 1);
    ell(pelvis, x, 39.6, z, 0.9, 0.9, 0.9, LAPIS.hi, VF.SOLID | VF.GLOW);
  }
  plate(pelvis);
  // ---- legs: piston thighs, saw-toothed tibiae, three-claw feet
  const thigh = rig.part('thigh_l', 'pelvis', [11.5, 32, 0.5]);
  ell(thigh, 11.5, 32, 0.5, 4.6, 4.6, 4.6, BRONZE.base);
  seg(thigh, [11.5, 31, 0.5], [14, 19, 3], 4.4, GOLD.base, undefined, 3.6);
  seg(thigh, [9.5, 29, -3.5], [12, 19, -1], 1.1, SILVER.base, VF.SOLID | VF.METAL); // the piston
  rivets(thigh, (x, y, z) => z > 3 && (y % 4 === 0));
  plate(thigh);
  const shin = rig.part('shin_l', 'thigh_l', [14, 17, 3]);
  ell(shin, 14, 17, 3, 4, 4, 4, BRONZE.hi, VF.SOLID | VF.METAL);
  seg(shin, [14, 16, 2.5], [13, 5, -0.5], 3.4, EM.base, undefined, 2.8);
  for (let k = 0; k < 4; k++) seg(shin, [14 + 2.5, 14 - k * 2.6, -1.5], [14 + 4.5, 13 - k * 2.6, -3.5], 0.9, EM.dark, undefined, 0.4);
  const foot = rig.part('foot_l', 'shin_l', [13, 4.5, 0]);
  ell(foot, 13, 4, 0, 3, 2.6, 3.4, BRONZE.base);
  for (const [dx, dz] of [[-3, 9], [0, 10.5], [3, 9]]) chain(foot, [[13, 3, 1], [13 + dx * 0.6, 1.8, dz * 0.6], [13 + dx, 0.6, dz]], [1.8, 1.4, 0.7], dx === 0 ? GOLD.base : BRONZE.shade);
  seg(foot, [13, 2, -2], [13, 0.6, -6], 1.2, BRONZE.shade, undefined, 0.5);
  plate(foot);

  // ---- torso: the great pronotum shield, its back of organ-pipe amplifiers
  const torso = rig.part('torso', 'pelvis', [0.5, 44, 0.5]);
  ell(torso, 0.5, 56, 0.5, 19, 13, 12, GOLD.base, undefined, (x, y, z) => z < 11.5);
  // lapis inlay bands sweeping round the shield and a median ridge
  paintSurf(torso, (x, y, z) => Math.abs(Math.hypot((x - 0.5) / 19, (y - 56) / 13) - 0.72) < 0.05, LAPIS.base);
  paintSurf(torso, (x, y, z) => Math.abs(x - 0.5) < 1.2 && y > 62, LAPIS.hi);
  rivets(torso, (x, y, z) => Math.abs(Math.hypot((x - 0.5) / 19, (y - 56) / 13) - 0.84) < 0.04);
  for (let k = 0; k < 6; k++) {
    const px = 1 + k * 2.4;
    seg(torso, [px, 48, -10], [px, 58 + (k % 3) * 2.5, -10], 1.3, SILVER.base, VF.SOLID | VF.METAL);
    torso.set(Math.round(px), 58 + (k % 3) * 2.5 + 1, -10, 0x0a0806);
  }
  plate(torso);
  rig.socket('chest', 'torso', [0.5, 55, 14]);
  // ---- the chest disc: a sun-disc record (grooves, a gold label, a scarab), it spins
  const disc = rig.part('disc', 'torso', [0.5, 55, 12.5]);
  for (let x = -8; x <= 9; x++)
    for (let y = 47; y <= 64; y++) {
      const rr = Math.hypot(x - 0.5, y - 55.5);
      if (rr > 8.4) continue;
      for (let z = 11; z <= 13; z++) {
        let c = Math.round(rr * 1.3) % 2 === 0 ? 0x1a1410 : 0x2e261e;
        let f: number = VF.SOLID | VF.METAL;
        if (rr > 7.6) c = GOLD.hi;
        else if (rr < 2.8) {
          c = Math.hypot((x - 0.5) / 1.6, (y - 55.5) / 1.2) < 1 ? 0x2a1a10 : 0xe85a2a;
          f = VF.SOLID | VF.EMISSIVE;
        } else if (z === 13 && Math.round(Math.atan2(y - 55.5, x - 0.5) * 6 / Math.PI) % 2 === 0 && rr > 6.2) c = GOLD.base;
        disc.set(x, y, z, c, f);
      }
    }
  rig.socket('disc_c', 'disc', [0.5, 55.5, 14]);
  // ---- head: rake-toothed crown, a curved horn, bezelled lens eyes, mandibles, antennae
  const head = rig.part('head', 'torso', [0.5, 66, 6]);
  ell(head, 0.5, 70, 9, 9, 6.5, 8, GOLD.base);
  for (let x = -8; x <= 9; x++)
    for (let z = 14; z <= 19; z++)
      for (let y = 65; y <= 68; y++) {
        if (Math.hypot((x - 0.5) / 9.5, (z - 13) / 6) > 1) continue;
        if (z >= 18 && (x + 9) % 3 === 0) continue;
        head.set(x, y, z, y === 68 ? GOLD.hi : BRONZE.base, VF.SOLID | VF.METAL);
      }
  chain(head, [[0.5, 74, 12], [0.5, 80, 15.5], [0.5, 85, 13.5], [0.5, 87.5, 9.5]], [3.2, 2.5, 1.8, 0.9], EM.base);
  paintSurf(head, (x, y, z) => y > 84, GOLD.hi);
  plate(head);
  rig.socket('mouth', 'head', [0.5, 64, 18]);
  const eye = rig.part('eye_l', 'head', [6.5, 71, 14.5]);
  for (let x = 4; x <= 9; x++)
    for (let y = 68; y <= 74; y++)
      for (let z = 12; z <= 16; z++) {
        const d = Math.hypot((x - 6.5) / 2.6, (y - 71) / 2.6, (z - 14) / 2);
        if (d > 1) continue;
        const rr = Math.hypot(x - 6.5, y - 71);
        let c = 0x3a2a10, f: number = VF.SOLID | VF.METAL;
        if (z >= 15) {
          if (rr < 0.8) c = 0x0a0604;
          else if (x === 7 && y === 72) (c = 0xffffff), (f = VF.SOLID | VF.GLOW);
          else if (rr < 1.8) (c = 0xffc040), (f = VF.SOLID | VF.GLOW);
          else (c = BRONZE.hi), (f = VF.SOLID | VF.METAL);
        }
        eye.set(x, y, z, c, f);
      }
  const mand = rig.part('mand_l', 'head', [3.5, 65.5, 15]);
  chain(mand, [[3.5, 65.5, 15], [5, 64, 19], [2, 63.5, 21.5]], [1.5, 1.1, 0.6], EM.dark);
  const ant = rig.part('ant_l', 'head', [5.5, 75, 13]);
  chain(ant, [[5.5, 75, 13], [8, 79, 16], [10, 81, 18]], [0.8, 0.7, 0.6], BRONZE.dark);
  // the lamellate club: three curved gold leaves fanned from the stalk tip
  for (let k = 0; k < 3; k++) ell(ant, 10.5 + k * 0.4, 81 + (k - 1) * 1.6, 18.6 + k * 0.3, 1.6, 0.8, 2.6, k === 1 ? GOLD.hi : GOLD.base, VF.SOLID | VF.METAL);
  // ---- arms: gold pauldrons, sawtooth tibiae; a toothed claw left, the silver hammer right
  const arm = rig.part('arm_l', 'torso', [19.5, 60, 2]);
  ell(arm, 20, 62, 1, 5.4, 4.2, 5.4, GOLD.base);
  paintSurf(arm, (x, y, z) => (y === 61 || y === 64) && x > 17, LAPIS.base);
  seg(arm, [19.5, 59, 2], [24, 48, 5], 4, BRONZE.base, undefined, 3.4);
  plate(arm);
  const fore = rig.part('fore_l', 'arm_l', [24, 47, 5]);
  seg(fore, [24, 47, 5], [25, 35, 9], 3.2, EM.base, undefined, 3.6);
  for (let k = 0; k < 4; k++) seg(fore, [27.5, 45 - k * 2.8, 6 + k * 0.8], [30, 45.5 - k * 2.8, 5.5 + k * 0.8], 0.9, EM.dark, undefined, 0.35);
  const claw = rig.part('fist_l', 'fore_l', [25, 33, 9]);
  ell(claw, 25, 31, 10, 3.8, 3.4, 3.8, EM.base);
  for (const [dx, dz] of [[-2.5, 4], [0, 5], [2.5, 4]]) chain(claw, [[25 + dx * 0.5, 29, 11], [25 + dx, 26, 11 + dz * 0.6], [25 + dx * 0.8, 23.5, 10 + dz]], [1.4, 1.0, 0.5], EM.dark);
  rig.socket('fist_l', 'fist_l', [25, 28, 11]);
  // the silver hammer (authored on the right before mirroring, so the mirror keeps it)
  const ham = rig.part('fist_r', 'fore_r', [-24, 33, 9]);
  bevelHammer(ham);
  rig.socket('fist_r', 'fist_r', [-24, 26, 9]);
  // ---- shoulder cannons for the salute
  const can = rig.part('cannon_l', 'torso', [12.5, 67, -3]);
  ell(can, 12.5, 67, -3, 3, 2.4, 3, BRONZE.base);
  seg(can, [12.5, 68, -2.5], [14.5, 76, 4.5], 2.2, BRONZE.base, VF.SOLID | VF.METAL, 1.8);
  seg(can, [14.4, 75.6, 4.2], [14.6, 76.6, 5.2], 2.4, GOLD.hi, VF.SOLID | VF.METAL);
  can.set(15, 77, 5, 0x0a0806);
  rig.socket('muzzle_l', 'cannon_l', [14.6, 77, 5.4]);
  // ---- elytra over the back
  const ely = rig.part('elytra_l', 'torso', [2, 66, -9]);
  ell(ely, 8, 52, -12.5, 9.5, 16, 5.2, EM.base, undefined, (x, y, z) => x >= 1 && z <= -8);
  paintSurf(ely, (x, y, z) => (x - 1) % 3 === 0 && z < -13, EM.shade);
  paintSurf(ely, (x, y, z) => x === 1, GOLD.base);
  paintSurf(ely, (x, y, z) => !ely.has(x, y + 1, z) && hash3(x, y, z) < 0.5, EM.hi, VF.SOLID | VF.METAL);

  rig.mirrorLR();
  topo(rig);
  return rig.build({ height: 8.8, radius: 3.4, kind: 'beetles_colossus', defaultExpression: 'angry', expressions: bossExpressions(0.3) });
}

/** the silver hammer: a bevelled mallet block with gold rims and an engraved band, on a bronze haft */
function bevelHammer(m: VoxelModel) {
  seg(m, [-24, 33, 9], [-24, 30, 9], 2.2, BRONZE.base);
  for (let x = -32; x <= -16; x++) {
    const u = (x + 24) / 8; // -1 .. 1 along the head
    const flare = Math.abs(u) > 0.82 ? 0.6 : 0;
    const R = 4.6 + flare - Math.abs(u) * 0.3;
    for (let y = 20; y <= 32; y++)
      for (let z = 3; z <= 15; z++) {
        const rr = Math.hypot(y - 26, z - 9);
        if (rr > R) continue;
        const face = Math.abs(u) > 0.94;
        const collar = Math.abs(Math.abs(u) - 0.78) < 0.08;
        const band = Math.abs(u) < 0.1;
        const c = face ? (rr < R - 1.2 ? SILVER.hi : SILVER.base) : collar ? GOLD.base : band ? LAPIS.base : rr > R - 0.8 && y > 26 ? SILVER.hi : y < 24 ? SILVER.shade : SILVER.base;
        m.set(x, y, z, c, VF.SOLID | VF.METAL);
      }
  }
}

/** parents before children (parts authored against a mirrored parent come out of mirrorLR late) */
function topo(rig: TRig) {
  const out: typeof rig.parts = [];
  const done = new Set<string>();
  let guard = 0;
  while (out.length < rig.parts.length && guard++ < 64)
    for (const p of rig.parts) {
      if (done.has(p.name) || (p.parent && !done.has(p.parent))) continue;
      out.push(p);
      done.add(p.name);
    }
  rig.parts = out;
}
