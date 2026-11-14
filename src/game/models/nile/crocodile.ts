// SEBEKHOTEP, Jaw of the Nile: Cleopatra's crocodile-headed river champion
// (an original Sobek-flavoured design). Sculpted on Sundown's bone figure (so the
// boss framework's humanoid animation drives the legs, arms, spine and head) and
// rescaled to 1/18 m: about 3.9 m to the plumes, a 3.6 m bronze glaive.
//
//  - head: a long, flat-topped crocodile skull with raised eye orbits (golden
//    eyes with slit pupils), a nostril mound on the snout tip, interlocking ivory
//    teeth along both lips (the big fourth tooth shows), a pale yellow mouth, the
//    hinge far back on the `jaw` part; a gold diadem with a sun disc and two tall
//    lapis-and-gold plumes, gold hoops in the earflaps like the temple crocodiles
//  - body: a massive armoured torso with rows of keeled osteoderms down the back,
//    a square-scaled pale belly, thick scaly limbs, clawed hands and feet
//  - tail: four segments (tail1..tail4), laterally flattened, a double crest of
//    scutes that merges into one toward the tip
//  - kit: a broad usekh, a single heavy bronze pauldron (left), gold armbands,
//    bronze bracers, a long lamellar kilt on a gold belt, the glaive (`weapon`)
// Expressions: neutral, angry, enraged, hurt, laugh, smug, stunned, defeated.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { Fig, finish, figMeta } from '../enemies/figure/fig';
import { defaultExpressions } from '../toon/humanoid';
import { rescaleRig } from '../enemies/figure/gear';
import { NILE, METAL, XI, res, beastBody, clearHead, eyes, brows, headTop, kilt, bandG, scalesC, mix, mulRGB, noise, hash3, ell, hornG, tube, isSurf, wrapShell, usekhG, frontZ, VF } from './kit';
import type { CSpec, G } from './kit';

export const CROC_VS = 1 / 18;

const PAL = { back: 0x3a4428, side: 0x5e6436, belly: 0xd2c696, dark: 0x1e2414, fleck: 0x8a8a52 };

/** olive armoured hide with dark transverse bands; a square-scaled pale belly in front */
function hideC(seed: number, bandAxis: 'y' | 'z' = 'y'): CSpec {
  return (x, y, z) => {
    const n = noise.n3(x / 4 + seed, y / 4, z / 4 - seed);
    const b = bandAxis === 'y' ? y : z;
    const band = ((Math.floor(b / 5) % 3) + 3) % 3 === 0 && noise.n3(x / 3, b / 2, seed) > -0.2;
    let c = n > 0.35 ? PAL.side : PAL.back;
    if (band) c = mix(c, PAL.dark, 0.55);
    if (hash3(x, y, z) > 0.96) c = PAL.fleck;
    return c;
  };
}
function bellyC(): CSpec {
  return (x, y) => ((((x % 3) + 3) % 3 === 0 || ((y % 3) + 3) % 3 === 0) ? mix(PAL.belly, 0x6a6a3a, 0.4) : PAL.belly);
}

export function crocChampionRig(o: { enraged?: boolean } = {}): RigSpec {
  const F = new Fig();
  const seed = 211;
  const hide = hideC(seed);
  const belly = bellyC();
  const body = beastBody(F, { seed, fur: hide, belly, dark: PAL.dark, bulk: 1.26, paunch: 1.2, legs: 'pillar', tail: 'none', nail: 0xe8dcc0, foot: hide, hand: hide });
  // ---------------------------------------------------------------- the crocodile head
  const { hd, jw } = clearHead(F);
  ell(hd, [0, 54.4, -2.4], [5.8, 4.2, 6.0], hide);
  ell(hd, [0, 51.6, -4.6], [5.4, 4.0, 4.0], hide);
  // the long flat snout, a slight swelling at the nose
  for (let z = 1; z <= 26; z++) {
    const t = (z - 1) / 25;
    const hw = 4.9 - t * 2.6 + Math.max(0, t - 0.82) * 4.5;
    const y1 = 55.2 - t * 1.8, y0 = 50.6;
    for (let x = -6; x < 6; x++)
      for (let y = 49; y <= 57; y++) {
        const gx = x + 0.5, gy = y + 0.5;
        const u = Math.abs(gx) / hw, w = (gy - (y0 + y1) / 2) / ((y1 - y0) / 2);
        if (u ** 3 + Math.abs(w) ** 2.4 > 1) continue;
        hd.m.set(x, y, z, gy > y1 - 1 && Math.abs(gx) < hw * 0.5 ? mix(res(hide, x, y, z), PAL.dark, 0.2) : res(hide, x, y, z));
      }
  }
  // tubercles along the top of the snout, the nostril mound
  for (let z = 4; z <= 22; z += 3) for (const s of [1, -1]) hd.m.set(XI(s, 1 + (z % 2)), Math.round(55 - ((z - 1) / 25) * 1.8), z, PAL.dark);
  ell(hd, [0, 54.0, 24.6], [2.0, 1.0, 1.6], hide);
  hd.m.set(-1, 55, 25, 0x0a0a06).set(0, 55, 24, 0x0a0a06);
  // raised eye orbits and the brow plates behind them
  for (const s of [1, -1]) {
    ell(hd, [s * 3.2, 57.4, 1.2], [2.0, 1.7, 2.1], hide);
    ell(hd, [s * 2.4, 58.2, -1.8], [1.6, 1.0, 1.6], mix(PAL.back, PAL.dark, 0.3));
    // earflap with a gold hoop
    ell(hd, [s * 5.6, 54.6, -3.0], [0.9, 1.6, 2.0], hide);
    for (const [y, z] of [[52, -3], [51, -3], [51, -2], [52, -1], [53, -1]] as [number, number][]) hd.m.set(XI(s, 7), y, z, METAL.gold[0], VF.METAL);
  }
  // nuchal shield: keeled scutes on the back of the neck
  for (const [x, y, z] of [[1.6, 55.4, -7.2], [-1.6, 55.4, -7.2], [3.6, 54.0, -6.6], [-3.6, 54.0, -6.6], [1.6, 52.2, -7.8], [-1.6, 52.2, -7.8]] as G[]) ell(hd, [x, y, z], [1.1, 0.9, 0.8], PAL.dark);
  // the upper teeth: a row down each lip, the big ones sticking out
  for (let z = 5; z <= 25; z += 2) {
    const t = (z - 1) / 25;
    const hw = 4.9 - t * 2.6 + Math.max(0, t - 0.82) * 4.5;
    for (const s of [1, -1]) {
      const x = XI(s, Math.max(0, Math.floor(hw - 0.6)));
      const long = z === 9 || z === 21 || z === 23;
      hd.m.set(x, 50, z, NILE.ivory).set(x, 49, z, long ? NILE.ivory : NILE.ivoryShade);
      if (long) hd.m.set(x, 48, z, NILE.ivoryShade);
    }
  }
  for (let z = 3; z <= 25; z++) for (const s of [1, -1]) {
    const t = (z - 1) / 25;
    const hw = 4.9 - t * 2.6 + Math.max(0, t - 0.82) * 4.5;
    const x = XI(s, Math.max(0, Math.floor(hw - 0.4)));
    if (hd.m.has(x, 51, z)) hd.m.set(x, 51, z, mix(PAL.dark, PAL.back, 0.4)); // lip line
  }
  // the lower jaw (hinge far back), pale yellow mouth, interlocking lower teeth
  for (let z = -4; z <= 26; z++) {
    const t = Math.max(0, (z - 1) / 25);
    const hw = 4.7 - t * 2.5 + Math.max(0, t - 0.82) * 3.8;
    for (let x = -6; x < 6; x++)
      for (let y = 46; y <= 50; y++) {
        const gx = x + 0.5;
        if (Math.abs(gx) > hw - (y === 46 ? 1 : 0) || (y === 46 && z > 22)) continue;
        const mouth = y === 50 && Math.abs(gx) < hw - 1 && z > -2;
        jw.m.set(x, y, z, mouth ? (z < 6 ? 0xb8a060 : 0xd8c890) : y <= 47 ? res(belly, x, y, z) : res(hide, x, y, z));
      }
  }
  for (let z = 6; z <= 24; z += 2) for (const s of [1, -1]) {
    const t = (z - 1) / 25;
    const hw = 4.7 - t * 2.5 + Math.max(0, t - 0.82) * 3.8;
    const x = XI(s, Math.max(0, Math.floor(hw - 0.8)));
    jw.m.set(x, 51, z + 1, NILE.ivory);
    if (z === 8 || z === 20) jw.m.set(x, 52, z + 1, NILE.ivory).set(x, 53, z + 1, NILE.ivoryShade);
  }
  for (let z = 3; z <= 14; z++) jw.m.set(-1, 50, z, 0xc89a78).set(0, 50, z, 0xc89a78); // tongue
  eyes(F, { x0: 2, y0: 57, z: 3, w: 3, h: 2, iris: o.enraged ? 0xff7a2a : 0xd8a828, pupil: 'slit', lid: 0x1a1a0e });
  brows(F, 2, 4, 59, 2, mix(PAL.back, PAL.dark, 0.3));
  // ---------------------------------------------------------------- armoured hide: osteoderms down the back
  const tr = F.s('torso'), pv = F.s('pelvis');
  for (let y = 29; y <= 46; y += 3)
    for (const x of [-4.2, -1.6, 1.6, 4.2]) {
      let z = -99;
      for (let zz = -14; zz <= 0; zz++) if (tr.m.has(Math.floor(x), y, zz)) {
        z = zz;
        break;
      }
      if (z > -99) {
        ell(tr, [x, y + 0.5, z - 0.2], [1.2, 1.0, 0.9], PAL.dark);
        tr.m.set(Math.floor(x), y + 1, z - 1, mix(PAL.dark, PAL.back, 0.4));
      }
    }
  // ---------------------------------------------------------------- the tail: four flattened segments with a double crest
  const pivots: G[] = [[0, 22, -6.5], [0, 18.5, -16], [0, 13.5, -25.5], [0, 8.5, -34.5], [0, 4.5, -43]];
  const radii = [5.0, 4.0, 3.0, 1.9, 0.8];
  for (let i = 0; i < 4; i++) {
    const tl = F.part('tail' + (i + 1), i === 0 ? 'pelvis' : 'tail' + i, pivots[i]);
    const a = pivots[i], b = pivots[i + 1];
    const N = 12;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const c: G = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const r = radii[i] + (radii[i + 1] - radii[i]) * t;
      ell(tl, c, [r * 0.72, r, r * 0.9], (x, y, z) => (y < c[1] - r * 0.4 ? res(belly, x, y, z) : res(hideC(seed, 'z'), x, y, z)));
      // crest scutes: two rows that merge into one on the last segment
      if (k % 2 === 0) {
        const xs = i < 2 ? [1.3, -1.3] : i === 2 ? [0.7, -0.7] : [0];
        for (const x of xs) hornG(tl, [c[0] + x, c[1] + r * 0.85, c[2]], [x * 0.15, 1, -0.3], Math.max(1.2, r * 0.45), Math.max(0.6, r * 0.22), PAL.dark);
      }
    }
  }
  // ---------------------------------------------------------------- the champion's kit
  usekhG(tr, [METAL.gold[0], NILE.lapis, METAL.gold[0], NILE.carnelian, METAL.gold[2], NILE.turq, METAL.gold[0]], { rMax: 11.2, y0: 39 });
  kilt(F, { seed, bulk: 1.26, long: true, belt: (x) => ((x & 3) === 1 ? NILE.lapis : METAL.gold[0]), panel: scalesC(NILE.bronze, 3), hem: NILE.bronze[0] });
  wrapShell(pv, 17, 22, scalesC(NILE.bronze, 7), (x, y, z) => z < 0, VF.METAL);
  for (const n of ['arm_l', 'arm_r']) bandG(F.s(n), 37, 38, (x, y) => (y === 38 ? METAL.gold[2] : METAL.gold[0]));
  for (const n of ['fore_l', 'fore_r']) bandG(F.s(n), 25, 29, (x, y) => (y === 25 || y === 29 ? METAL.gold[0] : NILE.bronze[0]));
  // one heavy bronze pauldron on the left shoulder: layered lames with a gold rim
  const al = F.s('arm_l');
  const ax = 8.6 + body.dx;
  for (let k = 0; k < 3; k++) ell(al, [ax + 0.4, 43.6 - k * 1.7, -0.2], [4.0 - k * 0.3, 1.4, 4.2 - k * 0.3], (x, y, z) => (y <= 42.6 - k * 1.7 ? METAL.gold[0] : NILE.bronze[k & 1 ? 1 : 0]), { fl: VF.METAL });
  for (let k = 0; k < 3; k++) hornG(al, [ax + 1.4 + k * 0.6, 45.2 - k * 1.4, -2.4 + k * 2.2], [0.8, 0.9, 0], 2.6, 0.9, NILE.bronze[2]);
  // ---------------------------------------------------------------- the crown: gold diadem, sun disc, two tall plumes
  const hat = F.part('hat', 'head', [...F.J.hat] as G);
  for (let x = -5; x <= 4; x++) for (const z of [-1, 0, 1, 2]) {
    let top = -1;
    for (let y = 62; y >= 54; y--) if (hd.m.has(x, y, z)) {
      top = y;
      break;
    }
    if (top > 0) hat.m.set(x, top + 1, z, z === 2 ? NILE.lapis : METAL.gold[0], z === 2 ? VF.SOLID : VF.METAL);
  }
  const discC = o.enraged ? 0xff8a2a : 0xffc040;
  for (let x = -4; x <= 3; x++)
    for (let y = 60; y <= 67; y++) {
      const d = Math.hypot(x + 0.5, y - 63.5);
      if (d > 4) continue;
      hat.m.set(x, y, -2, d > 3.1 ? METAL.gold[1] : discC, d > 3.1 ? VF.METAL : VF.EMISSIVE);
      hat.m.set(x, y, -3, METAL.gold[1], VF.METAL);
    }
  for (const [y, c] of [[59, METAL.gold[0]], [60, 0x2e9a8a], [61, METAL.gold[0]]] as [number, number][]) hat.m.set(-1, y, -1, c).set(0, y, -1, c); // uraeus
  for (const s of [1, -1])
    for (let y = 60; y <= 76; y++) {
      const w = y < 74 ? 1.6 : 1.6 - (y - 73) * 0.5;
      for (let x = 0; x <= Math.round(w); x++) hat.m.set(XI(s, 4 + x), y, -3 - Math.floor((y - 60) / 6), ((y >> 1) & 1) ? NILE.lapis : METAL.gold[0], ((y >> 1) & 1) ? VF.SOLID : VF.METAL);
    }
  // ---------------------------------------------------------------- the glaive: a bronze-shod shaft, a croc-head socket, a long curved blade
  const wp = F.part('weapon', 'fore_r', body.handR);
  const hx = Math.floor(body.handR[0]);
  for (let y = 2; y <= 50; y++) {
    const wrap = y > 18 && y < 26;
    for (const [dx, dz] of [[0, 0], [1, 0], [0, -1], [1, -1]]) wp.m.set(hx + dx, y, dz, wrap ? ((y & 1) ? NILE.leather : NILE.leatherDark) : (y % 7 === 0 ? METAL.gold[0] : NILE.woodDark), y % 7 === 0 ? VF.METAL : VF.SOLID);
  }
  for (let y = -1; y <= 2; y++) wp.m.set(hx, y, 0, NILE.bronze[2], VF.METAL).set(hx + 1, y, -1, NILE.bronze[0], VF.METAL);
  // the socket: a small gold crocodile head biting the shaft
  ell(wp, [hx + 1, 52, 1.0], [2.0, 2.2, 3.2], METAL.gold[0], { fl: VF.METAL });
  for (let z = 2; z <= 6; z++) wp.m.set(hx, 52, z, METAL.gold[1], VF.METAL).set(hx + 1, 52, z, METAL.gold[1], VF.METAL);
  wp.m.set(hx - 1, 53, 1, 0x2a1a08).set(hx + 2, 53, 1, 0x2a1a08);
  // the blade: rises and sweeps forward, a wide belly, a hooked back-spike
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const y = 54 + t * 20 - t * t * 4;
    const zc = 1 + t * t * 9;
    const w = 1.4 + Math.sin(Math.min(1, t * 1.2) * Math.PI) * 3.2;
    for (let s = -1; s <= w; s += 0.5) {
      const z = Math.floor(zc + s);
      const edge = s > w - 0.7;
      const inlay = Math.abs(s - w * 0.4) < 0.4 && t > 0.15 && t < 0.75;
      const c = edge ? NILE.bronze[2] : inlay ? METAL.gold[0] : s < 0 ? NILE.bronze[1] : NILE.bronze[0];
      wp.m.set(hx, Math.floor(y), z, c, VF.METAL);
      if (!edge) wp.m.set(hx + 1, Math.floor(y), z, c, VF.METAL);
    }
  }
  hornG(wp, [hx + 0.5, 58, -0.5], [0, 0.6, -1], 4, 1.0, NILE.bronze[1], [0, -0.6, 0]);
  F.sock('blade_tip', 'weapon', [hx + 0.5, 72, 12]);
  F.sock('mouth', 'head', [0, 50, 24]);
  F.sock('cape_anchor', 'torso', [0, 44, -8]);
  finish(F);
  const top = headTop(F);
  const exprs = defaultExpressions(['neutral', 'angry', 'enraged', 'hurt', 'laugh', 'smug', 'stunned', 'defeated']);
  for (const k of Object.keys(exprs)) exprs[k].jaw = (exprs[k].jaw ?? 0) * 1.6;
  const spec = F.build(o.enraged ? 'nile_crocodile_enraged' : 'nile_crocodile', figMeta(F, 'nile_crocodile', { height: top * F.vs, radius: 0.5, expressions: exprs, defaultExpression: 'angry', tail: 4 }));
  return rescaleRig(spec, CROC_VS);
}
void frontZ;
void isSurf;
void mulRGB;
void tube;
