// Cleopatra's animal-human army: six sculpted soldier types on Sundown's bone
// figure (1/36, the horde's humanoid animation fits all of them), each with a
// distinct silhouette, a species head with modelled eyes and Egyptian kit.
//
//   wolf legionary   broad grey wolf, cropped bronze helmet with a crest, scale
//                    corselet, cowhide shield (blocks from the front), khopesh
//   jackal spearman  tall black jackal, striped nemes, layered linen cuirass,
//                    a 2.1 m leaf-bladed spear with a pennant
//   hippo shield     2.4 m barrel-chested river horse, tusks, periscope eyes,
//   bearer           bronze plate, a tower shield and a flanged mace (rig 1/26)
//   falcon archer    slate-backed falcon with the dark tear streak, folded wings,
//                    barred chest, scaled legs on talons, a horn-backed bow
//   baboon gunner    hamadryas baboon with a silver mane cape, huge canines,
//                    leather apron, powder flasks, a smouldering linstock
//   ram drummer      woolly ram with great spiral horns and a beard, leopard
//                    sash, a laced barrel war drum and two beaters
// Alphas: bigger (the horde scales them 1.32x), darker coats, gold furniture.
// Part names follow the humanoid contract; extra parts: shield, weapon, bow,
// tail, coat, hat, drum, stick_l.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { Fig, finish, figMeta } from '../enemies/figure/fig';
import { defaultExpressions } from '../toon/humanoid';
import { rescaleRig } from '../enemies/figure/gear';
import { jackalBody } from '../enemies/jackal';
import {
  NILE, METAL, XI, res, softFur, beastBody, clearHead, eyes, brows, headTop, kilt, corselet, bandG, warBelt, nemes, khopesh, spear, shieldG, bowG, quiverG, cowhideC, featherC, wrinkleC, scalesC, pleatsC,
  mix, mulRGB, noise, hash3, ell, sections, limbG, coatG, cutG, isSurf, wrapShell, lineG, hornG, tube, furC, leatherC, frontZ, usekhG, VoxelModel, VF,
} from './kit';
import type { CSpec, G } from './kit';

export interface SoldierOpts {
  alpha?: boolean;
  variant?: number;
}

const EXPR = defaultExpressions(['neutral', 'angry', 'snarl', 'hurt', 'surprised', 'laugh', 'dead', 'stunned']);

function done(F: Fig, name: string, kind: string, o: { alpha: boolean; radius: number; meta?: Record<string, unknown> }) {
  finish(F);
  const top = headTop(F);
  return F.build(name, figMeta(F, kind, { alpha: o.alpha, height: top * F.vs, radius: o.radius, expressions: EXPR, nile: true, ...(o.meta ?? {}) }));
}

/** a superellipse snout from z0 to z1: half width, top and bottom per t (0 at the base) */
function snout(hd: { m: VoxelModel }, z0: number, z1: number, prof: (t: number) => { hw: number; y0: number; y1: number; p?: number }, col: CSpec, topCol?: CSpec) {
  for (let z = z0; z <= z1; z++) {
    const t = (z - z0) / Math.max(1, z1 - z0);
    const q = prof(t);
    const p = q.p ?? 2.2;
    const yc = (q.y0 + q.y1) / 2, yr = (q.y1 - q.y0) / 2;
    for (let x = Math.floor(-q.hw) - 1; x <= Math.ceil(q.hw); x++)
      for (let y = Math.floor(q.y0) - 1; y <= Math.ceil(q.y1); y++) {
        const gx = x + 0.5, gy = y + 0.5;
        const u = Math.abs(gx) / q.hw, w = (gy - yc) / yr;
        if (u ** p + Math.abs(w) ** p > 1) continue;
        const top = gy > q.y1 - 1.0 && Math.abs(gx) < q.hw * 0.45;
        hd.m.set(x, y, z, res(top && topCol !== undefined ? topCol : col, x, y, z));
      }
  }
}

// ============================================================================ WOLF LEGIONARY
const WOLF_FUR = [
  { base: 0x6e6a66, light: 0x9a948c, dark: 0x3e3a38, belly: 0xc8beb0 },
  { base: 0x5a4a3c, light: 0x8a7460, dark: 0x2e2620, belly: 0xb8a48a },
  { base: 0x9a948a, light: 0xc4bcb0, dark: 0x5e5a54, belly: 0xe2dccc },
];

function wolfHead(F: Fig, Fu: { base: number; light: number; dark: number; belly: number }, seed: number) {
  const { hd, jw } = clearHead(F);
  const fur = softFur(Fu.base, Fu.light, Fu.dark, seed);
  const pale = softFur(Fu.belly, mix(Fu.belly, 0xffffff, 0.2), Fu.light, seed + 3);
  ell(hd, [0, 55.4, -1.4], [5.8, 5.6, 6.2], fur);
  ell(hd, [0, 51.6, -3.6], [4.6, 4.0, 3.8], fur);
  ell(hd, [0, 56.4, 2.2], [4.2, 2.6, 2.6], fur);
  for (const s of [1, -1]) {
    ell(hd, [s * 2.7, 57.1, 3.6], [2.3, 1.3, 1.5], fur);
    ell(hd, [s * 4.4, 51.6, 1.4], [2.3, 2.6, 2.6], pale);
    ell(hd, [s * 5.5, 50.8, -1.2], [1.8, 3.4, 3.2], pale);
    hornG(hd, [s * 6.4, 49.6, -1.0], [s * 0.6, -1, -0.5], 2.6, 0.9, pale);
    hornG(hd, [s * 6.0, 52.6, -2.4], [s * 0.7, -0.4, -0.8], 2.2, 0.8, pale);
  }
  snout(hd, 3, 14, (t) => ({ hw: 3.5 - t * 1.35, y0: 48.6 + t * 0.5, y1: 55.0 - t * 2.3, p: 2.3 }), fur, mix(Fu.base, Fu.dark, 0.5));
  // nose leather + nostrils
  for (let x = -2; x <= 1; x++) for (let y = 50; y <= 52; y++) hd.m.set(x, y, 14, y === 52 && (x === -2 || x === 1) ? 0x2a2224 : 0x141012).set(x, y, 15, 0x141012);
  hd.m.set(-2, 51, 15, 0x060404).set(1, 51, 15, 0x060404).set(-1, 52, 15, 0x3a3236);
  // lip line, upper fangs bared in a snarl
  for (let z = 6; z <= 14; z++) for (const x of [-3, 2]) if (hd.m.has(x, 49, z)) hd.m.set(x, 49, z, Fu.dark);
  for (const x of [-2, 1]) hd.m.set(x, 48, 12, NILE.ivory).set(x, 47, 12, NILE.ivory).set(x, 48, 11, NILE.ivoryShade);
  for (const x of [-1, 0]) hd.m.set(x, 48, 13, NILE.ivoryShade);
  for (let z = 7; z <= 10; z++) for (const x of [-3, 2]) hd.m.set(x, 48, z, NILE.ivoryShade); // carnassials
  // upright ears
  for (const s of [1, -1])
    for (let y = 59; y <= 67; y++) {
      const t = (y - 59) / 8;
      const x0 = 2.4 + t * 1.6, x1 = 6.8 - t * 2.6;
      for (let x = Math.floor(x0); x <= Math.ceil(x1) - 1; x++)
        for (let z = -3; z <= -1; z++) {
          const X = XI(s, x);
          const inner = z === -1 && x > Math.floor(x0) && x < Math.ceil(x1) - 1 && y < 66;
          hd.m.set(X, y, z, inner ? (y < 61 ? pale(X, y, z) as number : 0x5a3a3a) : res(fur, X, y, z));
        }
    }
  // the canine jaw
  for (let z = 0; z <= 13; z++) {
    const t = Math.max(0, (z - 1) / 12);
    const hw = 3.0 - t * 1.2;
    for (let x = -4; x < 4; x++)
      for (let y = 46; y <= 48; y++) {
        const gx = x + 0.5;
        if (Math.abs(gx) > hw || (y === 46 && (z > 11 || Math.abs(gx) > hw - 1))) continue;
        jw.m.set(x, y, z, y === 48 && Math.abs(gx) < hw - 0.9 && z > 2 ? 0x5a1e22 : y <= 47 ? res(pale, x, y, z) : res(fur, x, y, z));
      }
  }
  for (const x of [-2, 1]) jw.m.set(x, 49, 11, NILE.ivory);
  for (let z = 4; z <= 9; z++) jw.m.set(-1, 48, z, 0x8a3438).set(0, 48, z, 0x8a3438);
  eyes(F, { x0: 2, y0: 54, z: 3, w: 3, h: 2, iris: 0xd89a28, lid: 0x1a1210 });
  brows(F, 1, 4, 56, 4, Fu.dark);
  return { fur, pale };
}

export function wolfLegionaryRig(o: SoldierOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % 3) + 3) % 3;
  const seed = 31 + v * 7 + (alpha ? 3 : 0);
  const Fu = alpha ? { base: 0x2e2a2a, light: 0x4e4844, dark: 0x161414, belly: 0x6a625a } : WOLF_FUR[v];
  const F = new Fig();
  const fur = softFur(Fu.base, Fu.light, Fu.dark, seed);
  const pale = softFur(Fu.belly, mix(Fu.belly, 0xffffff, 0.2), Fu.light, seed + 3);
  const body = beastBody(F, { seed, fur, belly: pale, dark: Fu.dark, bulk: 1.08, legs: 'digi', tail: 'bushy', mane: softFur(Fu.light, Fu.belly, Fu.base, seed + 1), nail: NILE.ink });
  wolfHead(F, Fu, seed);
  // ---- kit: scale corselet, war belt, kilt, bracers, greaves
  corselet(F, { y0: 30, y1: 42, seed, metal: alpha ? METAL.gold : NILE.bronze });
  kilt(F, { seed, belt: (x) => ((x & 3) === 1 ? NILE.carnelian : NILE.rawhide), stripe: NILE.red });
  warBelt(F, 25);
  for (const n of ['fore_l', 'fore_r']) bandG(F.s(n), 26, 29, (x, y) => (y === 27 ? NILE.bronze[2] : NILE.bronze[0]));
  for (const n of ['shin_l', 'shin_r']) {
    const sh = F.s(n);
    wrapShell(sh, 8, 13, (x, y, z) => (z > 0.5 ? (y === 13 || y === 8 ? NILE.bronze[2] : NILE.bronze[0]) : null), () => true, VF.METAL);
  }
  // ---- cropped bronze helmet: a shell over the crown with a crest fin and cheek guards
  const hat = F.part('hat', 'head', [...F.J.hat] as G);
  const hd = F.m('head');
  const B = alpha ? METAL.gold : NILE.bronze;
  hd.forEach((x, y, z) => {
    if (y < 57 || z > 3) return;
    const earSlot = Math.abs(x + 0.5) > 2.2 && Math.abs(x + 0.5) < 6.6 && y >= 59 && z >= -3 && z <= -1;
    if (earSlot) return;
    for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, -1], [0, 0, 1]]) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (hd.has(X, Y, Z) || Y > 62) continue;
      if (Math.abs(X + 0.5) > 2.2 && Math.abs(X + 0.5) < 6.6 && Y >= 59 && Z >= -3 && Z <= -1) continue;
      hat.m.set(X, Y, Z, Y === 57 ? B[2] : (X + Z) % 6 === 0 ? B[1] : B[0], VF.METAL);
    }
  });
  for (let z = -6; z <= 3; z++) for (let y = 62; y <= 63 + (z > -4 && z < 2 ? 1 : 0); y++) for (const x of [-1, 0]) hat.m.set(x, y, z, y >= 63 ? (alpha ? NILE.carnelian : NILE.lapis) : B[2], y >= 63 ? VF.SOLID : VF.METAL);
  for (const s of [1, -1]) for (let y = 50; y <= 56; y++) for (let z = -2; z <= 1; z++) hat.m.set(XI(s, 6), y, z, y === 50 || z === 1 ? B[2] : B[0], VF.METAL);
  // ---- khopesh and cowhide shield
  khopesh(F, 'weapon', 'fore_r', body.handR, { gold: alpha });
  shieldG(F, body.handL, { seed, h: 22, w: 6.4, emblem: alpha ? METAL.gold[0] : NILE.carnelian });
  if (alpha) {
    // a gold usekh, a plume and battle scars
    usekhG(F.s('torso'), [METAL.gold[0], NILE.lapis, METAL.gold[0], NILE.carnelian, METAL.gold[2]], { rMax: 8.6, y0: 41 });
    for (let k = 0; k < 7; k++) hat.m.set(-1 + (k & 1), 65 + Math.floor(k / 2), -3 - k, k & 1 ? NILE.carnelian : 0xd8402e);
    for (const [x, y, z] of [[3, 53, 4], [4, 52, 3], [4, 51, 2]] as G[]) F.s('head').m.set(x, y, z, 0xc8a090);
  }
  return done(F, `nile_wolf${alpha ? '_alpha' : ''}_v${v}`, 'nile_wolf', { alpha, radius: 0.36, meta: { blocksFront: true, shieldUp: true, weaponRest: 'khopesh' } });
}

// ============================================================================ JACKAL SPEARMAN
export function jackalSpearmanRig(o: SoldierOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % 2) + 2) % 2;
  const F = new Fig();
  const coat = alpha ? { base: 0x141216, light: 0x2a2630, dark: 0x060608, belly: 0x3a3440 } : v ? { base: 0x2a2228, light: 0x4a3e42, dark: 0x120e10, belly: 0x8a6a4a } : { base: 0x1e1c22, light: 0x3a3440, dark: 0x0c0a0e, belly: 0xa87a46 };
  jackalBody(F, { alpha: false, variant: 0, fur: coat });
  const tr = F.s('torso');
  // layered linen cuirass (linothorax) banded in red and blue, over the usekh
  const lin = pleatsC(NILE.linenHi, 17 + v);
  wrapShell(tr, 29, 40, (x, y, z) => (y === 33 || y === 37 ? NILE.red : y === 29 ? NILE.lapis : res(lin, x, y, z)));
  wrapShell(tr, 30, 39, (x, y, z) => (Math.abs(x + 0.5) < 1.2 && z > 0 ? METAL.gold[0] : null), (x, y, z) => z > 2, VF.METAL);
  // shoulder guards of stiff linen
  for (const s of [1, -1]) ell(F.s(s > 0 ? 'arm_l' : 'arm_r'), [s * 8.8, 42.0, 0], [2.9, 1.6, 3.0], (x, y) => (y >= 42 ? NILE.linenHi : NILE.red));
  // nemes over the crown, ears standing through it
  nemes(F, { y0: 50, y1: 60, hx: 6.9, zb: -7.6, zf: 4.4, c1: alpha ? METAL.gold[0] : NILE.linenHi, c2: alpha ? NILE.lapis : 0x23439a, lappets: true, earGap: [1.6, 6.4] });
  F.sock('head_top', 'head', [0, 75, -2]);
  // bronze greaves, leather bracers
  for (const n of ['shin_l', 'shin_r']) wrapShell(F.s(n), 8, 13, (x, y, z) => (z > 0.5 ? (y === 13 ? NILE.bronze[2] : NILE.bronze[0]) : null), () => true, VF.METAL);
  for (const n of ['fore_l', 'fore_r']) bandG(F.s(n), 25, 29, (x, y) => (y === 27 ? NILE.leatherDark : NILE.rawhide), false);
  // the spear, a small round buckler on the back of the left forearm
  spear(F, 'weapon', 'fore_r', [-9, 21.5, 0], { len: 52, back: 20, pennant: alpha ? METAL.gold[0] : NILE.red, gold: alpha });
  const sd = F.part('shield', 'fore_l', [11, 27, 0]);
  for (let y = 19; y <= 31; y++)
    for (let z = -6; z <= 5; z++) {
      const r = Math.hypot(y - 25, z + 0.5);
      if (r > 6.2) continue;
      const rim = r > 5.2;
      sd.m.set(12, y, z, rim ? NILE.bronze[0] : r < 1.5 ? NILE.bronze[2] : res(cowhideC(9 + v, 0x2a1a10, 0xe8dcc4, 0x9a5a2a), 12, y, z), rim || r < 1.5 ? VF.METAL : VF.SOLID);
      sd.m.set(11, y, z, rim ? NILE.bronze[1] : NILE.woodDark, rim ? VF.METAL : VF.SOLID);
    }
  return done(F, `nile_jackal_spear${alpha ? '_alpha' : ''}_v${v}`, 'nile_jackal_spear', { alpha, radius: 0.33, meta: { melee: 'thrust', weaponRest: 'spear +Z' } });
}

// ============================================================================ HIPPO SHIELD BEARER
function hippoHead(F: Fig, K: { skin: CSpec; dark: number; pink: number; belly: CSpec }, alpha: boolean) {
  const { hd, jw } = clearHead(F);
  ell(hd, [0, 56.0, -2.6], [6.0, 5.2, 5.8], K.skin);
  ell(hd, [0, 51.6, -4.4], [5.8, 4.6, 4.0], K.skin);
  // the great muzzle: a long flat-topped box that swells into heavy lip pads at the front,
  // wider than the skull
  snout(hd, 0, 17, (t) => ({ hw: 5.0 + t * 1.6 + Math.max(0, t - 0.55) * 1.6, y0: 49.2, y1: 57.4 - t * 2.2, p: 2.8 }), K.skin);
  for (const s of [1, -1]) {
    ell(hd, [s * 4.6, 51.6, 13.6], [2.9, 3.0, 3.6], K.skin); // lip pad
    ell(hd, [s * 3.0, 50.4, 16.2], [2.2, 1.8, 1.6], K.skin);
  }
  // nostril mounds on top of the snout
  for (const s of [1, -1]) {
    ell(hd, [s * 2.6, 55.6, 15.0], [1.7, 1.2, 1.6], K.skin);
    hd.m.set(XI(s, 2), 56, 15, 0x1a1012).set(XI(s, 2), 56, 16, 0x1a1012).set(XI(s, 3), 56, 15, 0x2a1a1c);
  }
  // periscope eye mounds, small round ears
  for (const s of [1, -1]) {
    ell(hd, [s * 3.8, 59.6, 1.8], [2.0, 1.8, 2.0], K.skin);
    ell(hd, [s * 4.8, 61.8, -3.8], [1.2, 1.5, 0.9], K.skin);
    hd.m.set(XI(s, 4), 61, -3, K.pink).set(XI(s, 4), 62, -3, mulRGB(K.pink, 0.7));
    // blood-sweat streak from the eye
    for (let y = 55; y <= 58; y++) if (hd.m.has(XI(s, 4), y, 3)) hd.m.set(XI(s, 4), y, 3, mix(K.pink, 0xa83a2a, 0.5));
  }
  // pink lip line and whisker pores
  hd.m.forEach((x, y, z) => {
    if (y <= 50 && z >= 3 && isSurf(hd.m, x, y, z)) hd.m.set(x, y, z, y === 49 ? K.pink : mix(res(K.skin, x, y, z), K.pink, 0.45));
  });
  for (let k = 0; k < 14; k++) {
    const x = Math.floor((hash3(k, 3, 1) - 0.5) * 11), z = 11 + Math.floor(hash3(k, 5, 2) * 6);
    for (let y = 56; y >= 50; y--) if (hd.m.has(x, y, z) && !hd.m.has(x, y + 1, z)) {
      hd.m.set(x, y, z, K.dark);
      break;
    }
  }
  // the U jaw with the tusks rising outside the upper lip
  for (let z = -1; z <= 17; z++) {
    const t = (z + 1) / 18;
    const hw = 5.0 + Math.sin(t * Math.PI) * 0.7 + t * 1.0;
    for (let x = -7; x < 7; x++)
      for (let y = 44; y <= 49; y++) {
        const gx = x + 0.5;
        const round = (y - 44.5) / 5;
        if (Math.abs(gx) > hw - (y === 44 ? 1.4 : 0) || (y <= 45 && z > 15 - (45 - y))) continue;
        const inner = y === 49 && Math.abs(gx) < hw - 1.1 && z > 1 && z < 17;
        jw.m.set(x, y, z, inner ? (z > 13 ? K.pink : 0x7a3038) : y <= 45 ? res(K.belly, x, y, z) : res(K.skin, x, y, z));
        void round;
      }
  }
  for (const s of [1, -1]) {
    hornG(jw, [s * 4.6, 49.4, 14.0], [s * 0.25, 1, 0.3], alpha ? 5.8 : 5.0, 1.1, NILE.ivory, [s * 0.1, 0, -0.6], NILE.ivoryShade);
    jw.m.set(XI(s, 1), 49, 16, NILE.ivory).set(XI(s, 1), 50, 16, NILE.ivory);
  }
  eyes(F, { x0: 3, y0: 59, z: 3, w: 2, h: 2, iris: 0x7a4018, lid: 0x2a1418 });
  brows(F, 2, 5, 61, 2, K.dark);
}

export function hippoShieldRig(o: SoldierOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % 2) + 2) % 2;
  const seed = 51 + v * 5 + (alpha ? 2 : 0);
  const base = alpha ? 0x3e3438 : v ? 0x6e5c58 : 0x5e5458;
  const pink = 0xb87a7c;
  const skin = wrinkleC(base, seed, 0, pink);
  const belly = wrinkleC(mix(base, pink, 0.3), seed + 2);
  const F = new Fig();
  const body = beastBody(F, { seed, fur: skin, belly, dark: mix(base, 0x140c10, 0.5), bulk: 1.24, paunch: 2.6, legs: 'pillar', tail: 'stub', nail: 0xd8c8b0, foot: skin });
  hippoHead(F, { skin, dark: mix(base, 0x140c10, 0.5), pink, belly }, alpha);
  // ---- bronze plate cuirass with embossed rings, layered leather apron, gold collar
  const tr = F.s('torso');
  const B = alpha ? METAL.gold : NILE.bronze;
  wrapShell(tr, 31, 43, (x, y, z) => {
    const r = Math.hypot(Math.abs(x + 0.5) - 4.2, y + 0.5 - 37.5);
    if (z > 1 && (Math.abs(r - 2.4) < 0.5)) return B[2];
    if (y === 31 || y === 43) return NILE.rawhide;
    return (x + y) % 7 === 0 ? B[1] : B[0];
  }, () => true, VF.METAL);
  usekhG(tr, [METAL.gold[0], NILE.turq, METAL.gold[0], NILE.lapis, METAL.gold[2]], { rMax: 9.4, y0: 42 });
  // a long kilt under layered leather strips (the strips ride the thighs)
  kilt(F, { seed, bulk: 1.24, belt: (x) => ((x & 3) === 1 ? METAL.gold[0] : NILE.leatherDark), long: true, panel: (x, y) => (((x + 64) % 3) === 2 ? NILE.leatherDark : y & 1 ? NILE.leather : NILE.rawhide), hem: B[0] });
  // shoulder plates
  for (const s of [1, -1]) {
    const a = F.s(s > 0 ? 'arm_l' : 'arm_r');
    ell(a, [s * (8.6 + body.dx), 42.4, 0], [3.4, 1.8, 3.4], (x, y) => (y >= 43 ? B[2] : B[0]), { fl: VF.METAL });
  }
  for (const n of ['fore_l', 'fore_r']) bandG(F.s(n), 25, 29, (x, y) => (y === 25 || y === 29 ? B[2] : B[0]));
  // bronze cap with a lapis band
  const hat = F.part('hat', 'head', [...F.J.hat] as G);
  const hd = F.m('head');
  hd.forEach((x, y, z) => {
    if (y < 60 || z > 0 || z < -8) return;
    if (!hd.has(x, y + 1, z) && !(Math.abs(x + 0.5) > 3.6 && Math.abs(x + 0.5) < 6.2 && z > -5)) hat.m.set(x, y + 1, z, y === 60 ? NILE.lapis : B[0], y === 60 ? VF.SOLID : VF.METAL);
  });
  // ---- tower shield and flanged mace
  shieldG(F, body.handL, { seed, h: 34, w: 8.4, tower: true, face: cowhideC(seed + 4, 0x4a2a1a, 0xe8d8bc, 0x8a5030), studs: true, emblem: alpha ? METAL.gold[0] : NILE.lapis });
  const wp = F.part('weapon', 'fore_r', body.handR);
  const hx = Math.floor(body.handR[0]);
  for (let y = 4; y <= 25; y++) wp.m.set(hx, y, 0, y > 17 ? (y & 1 ? NILE.leather : NILE.leatherDark) : NILE.woodDark);
  for (let y = 2; y <= 6; y++) for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const r = 2.6 - Math.abs(y - 4) * 0.5;
    for (let rr = 0; rr <= r; rr += 0.5) wp.m.set(hx + Math.round(Math.cos(a) * rr), y, Math.round(Math.sin(a) * rr), rr > r - 0.6 ? B[2] : B[0], VF.METAL);
  }
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) wp.m.set(hx + dx - 1, 7, dz - 1, B[1], VF.METAL);
  wp.m.set(hx, 1, 0, B[2], VF.METAL);
  const spec = done(F, `nile_hippo${alpha ? '_alpha' : ''}_v${v}`, 'nile_hippo', { alpha, radius: 0.5, meta: { blocksFront: true, shieldUp: true, heavy: true } });
  return rescaleRig(spec, 1 / 26);
}

// ============================================================================ FALCON ARCHER
function falconHead(F: Fig, P: { back: number; dark: number; light: number; cream: number; bar: number }, seed: number) {
  const { hd, jw } = clearHead(F);
  const crown = featherC(P.back, P.dark, P.light, seed);
  const cheek = featherC(P.cream, mix(P.cream, P.bar, 0.25), 0xfff8ec, seed + 1);
  ell(hd, [0, 55.4, -1.4], [4.9, 5.0, 5.4], crown);
  ell(hd, [0, 52.4, 0.8], [4.3, 3.8, 3.8], cheek);
  ell(hd, [0, 49.6, 0.0], [3.7, 2.8, 3.6], cheek);
  // nape feathers swept back
  for (let k = -2; k <= 2; k++) hornG(hd, [k * 1.0, 54.6 - Math.abs(k) * 0.6, -6.0], [k * 0.2, -0.6, -1], 2.4, 0.8, crown);
  // the dark cap down to the eyes and the "tear" streak (malar stripe) under each eye
  hd.m.forEach((x, y, z) => {
    if ((y >= 56 || z < -2) && isSurf(hd.m, x, y, z)) hd.m.set(x, y, z, res(crown, x, y, z));
  });
  for (const s1 of [1, -1])
    for (let y = 48; y <= 54; y++)
      for (const x of [2, 3]) {
        const X = XI(s1, x + (y < 51 ? 1 : 0));
        for (let z = 7; z >= -3; z--) if (hd.m.has(X, y, z)) {
          hd.m.set(X, y, z, P.dark);
          break;
        }
      }
  // yellow cere, a big hooked beak: blue-grey at the base, near black at the hook
  ell(hd, [0, 54.6, 4.0], [1.9, 1.5, 1.4], 0xe8b830);
  tube(hd, [[0, 54.8, 4.6], [0, 54.8, 7.2], [0, 53.6, 9.4], [0, 51.6, 10.2], [0, 49.8, 9.6]], (t) => 1.95 - t * 1.4, (t: number) => (t < 0.45 ? 0x5a6274 : 0x1e2028));
  for (const s1 of [1, -1]) hd.m.set(XI(s1, 1), 54, 6, 0x0e0e12); // nostrils in the cere
  // lower mandible on the jaw
  tube(jw, [[0, 51.8, 4.0], [0, 51.2, 6.6], [0, 51.0, 8.2]], (t) => 1.2 - t * 0.55, 0xd8a628);
  eyes(F, { x0: 2, y0: 54, z: 3, w: 3, h: 3, iris: 0x1e0e06, lid: 0xe8b830 });
  brows(F, 1, 4, 57, 3, P.dark);
  void seed;
}

export function falconArcherRig(o: SoldierOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % 2) + 2) % 2;
  const seed = 71 + v * 3 + (alpha ? 5 : 0);
  const P = alpha ? { back: 0x2a2a36, dark: 0x121218, light: 0x4a4a5a, cream: 0xd8c8a8, bar: 0x2a2a36 } : v ? { back: 0x6a5240, dark: 0x3a2a20, light: 0x9a7a5a, cream: 0xf0e0c0, bar: 0x6a4a30 } : { back: 0x4a5062, dark: 0x2a2e3a, light: 0x6a7286, cream: 0xf2e6cc, bar: 0x5a5e6e };
  const F = new Fig();
  const feathers = featherC(P.back, P.dark, P.light, seed);
  const chest = featherC(P.cream, P.bar, 0xfffaf0, seed + 2, 1);
  const body = beastBody(F, { seed, fur: feathers, belly: chest, dark: P.dark, bulk: 0.94, legs: 'bird', tail: 'feather', tailCol: featherC(P.back, P.dark, P.cream, seed + 4, 1), foot: 0xd8a628, nail: 0x141210, hand: leatherC(0x7a4a26, seed) });
  falconHead(F, P, seed);
  // folded wings over the back: layered primaries crossing behind the kilt
  const tr = F.s('torso');
  for (const s of [1, -1]) {
    ell(tr, [s * 4.8, 39.0, -5.6], [3.0, 5.6, 2.2], feathers);
    for (let k = 0; k < 5; k++) {
      const x0 = s * (5.6 - k * 0.7);
      tube(tr, [[x0, 38 - k * 0.5, -6.4], [x0 - s * 1.2, 30 - k, -7.6], [x0 - s * 2.6, 22 - k * 1.2, -8.2]], (t) => 0.85 - t * 0.3, (t: number) => (t > 0.75 ? P.dark : k & 1 ? P.light : P.back));
    }
  }
  // feather mantle over the shoulders (the arms carry their own caps)
  for (const s of [1, -1]) {
    const a = F.s(s > 0 ? 'arm_l' : 'arm_r');
    for (let y = 36; y <= 43; y++) wrapShell(a, y, y, (x, yy, z) => res(featherC(P.back, P.dark, P.light, seed + 7), x, yy, z), (x, yy, z) => yy > 37 || ((x + z) & 1) === 0);
  }
  kilt(F, { seed, belt: (x) => ((x & 3) === 1 ? NILE.turq : METAL.gold[0]) });
  // leather bracer on the bow arm, hip quiver
  bandG(F.s('fore_l'), 25, 30, (x, y) => (y === 27 ? METAL.gold[0] : NILE.rawhide), false);
  const pv = F.s('pelvis');
  limbG(pv, [-7.5, 15.5, -2.0], [-8.5, 26.5, -4.5], () => 1.7, leatherC(0x7a4a26, 7));
  for (const [dx, dz] of [[0, 0], [1, -1], [-1, 0], [0, -1]] as [number, number][]) {
    const x = -9 + dx, z = -5 + dz;
    for (let y = 27; y <= 29; y++) pv.m.set(x, y, z, 0x8a5a30);
    pv.m.set(x, 30, z, 0xf0e6d0).set(x, 31, z, (dx + dz) & 1 ? NILE.carnelian : P.dark);
  }
  bowG(F, body.handL, { gold: alpha, len: 20 });
  if (alpha) {
    // the double crown of a captain: white with a red rim
    const hat = F.part('hat', 'head', [...F.J.hat] as G);
    for (let y = 60; y <= 68; y++) {
      const r = y <= 62 ? 4.4 : 3.2 - (y - 63) * 0.3;
      for (let x = -5; x <= 4; x++) for (let z = -6; z <= 2; z++) if (Math.hypot(x + 0.5, (z + 2) * 1.1) <= r) hat.m.set(x, y, z, y <= 61 ? NILE.carnelian : 0xf4eee0);
    }
    for (let k = 0; k < 5; k++) hat.m.set(3, 62 + k, 2 + (k > 2 ? 1 : 0), METAL.gold[0], VF.METAL);
  }
  return done(F, `nile_falcon${alpha ? '_alpha' : ''}_v${v}`, 'nile_falcon', { alpha, radius: 0.32, meta: { bow: true } });
}

// ============================================================================ BABOON GUNNER
function baboonHead(F: Fig, K: { fur: CSpec; mane: CSpec; face: number; faceDark: number }, seed: number) {
  const { hd, jw } = clearHead(F);
  ell(hd, [0, 55.0, -2.0], [5.2, 4.8, 5.4], K.fur);
  // the silver mane: a hood of long hair down to the shoulders
  ell(hd, [0, 54.0, -4.4], [7.2, 6.2, 4.8], K.mane);
  for (const s of [1, -1]) {
    ell(hd, [s * 6.0, 52.0, -1.6], [2.4, 5.4, 4.0], K.mane);
    for (let k = 0; k < 4; k++) hornG(hd, [s * (5.4 + k * 0.5), 48.5 - k * 0.4, -2.5 - k * 0.8], [s * 0.3, -1, -0.4], 2.4, 1.0, K.mane);
  }
  // heavy brow shelf
  ell(hd, [0, 57.0, 2.2], [4.6, 1.5, 2.0], mulRGB(K.face, 0.75));
  // long dog muzzle of bare skin
  snout(hd, 2, 13, (t) => ({ hw: 3.2 - t * 0.8, y0: 49.0 + t * 0.6, y1: 55.6 - t * 1.6, p: 2.4 }), K.face, K.faceDark);
  for (const s of [1, -1]) ell(hd, [s * 3.5, 51.2, 3.6], [2.0, 2.0, 2.4], K.face); // cheek pouches
  for (let x = -2; x <= 1; x++) for (let y = 51; y <= 53; y++) hd.m.set(x, y, 13, y === 53 ? K.faceDark : 0x2a1418);
  hd.m.set(-2, 52, 14, 0x0a0606).set(1, 52, 14, 0x0a0606);
  for (const s of [1, -1]) {
    hornG(hd, [s * 2.0, 49.4, 11.4], [s * 0.1, -1, 0.15], 2.6, 0.75, NILE.ivory);
    for (let z = 6; z <= 12; z++) if (hd.m.has(XI(s, 3), 49, z)) hd.m.set(XI(s, 3), 49, z, K.faceDark);
  }
  for (let z = 1; z <= 12; z++) {
    const t = z / 12;
    const hw = 2.8 - t * 0.9;
    for (let x = -3; x < 3; x++) for (let y = 46; y <= 48; y++) {
      const gx = x + 0.5;
      if (Math.abs(gx) > hw || (y === 46 && z > 10)) continue;
      jw.m.set(x, y, z, y === 48 && Math.abs(gx) < hw - 0.8 && z > 2 ? 0x6a2228 : res(K.mane, x, y, z));
    }
  }
  for (const s of [1, -1]) jw.m.set(XI(s, 1), 49, 10, NILE.ivory).set(XI(s, 1), 50, 10, NILE.ivory);
  eyes(F, { x0: 1, y0: 54, z: 3, w: 3, h: 2, iris: 0xb07020, lid: 0x1a0e0a });
  brows(F, 1, 4, 56, 4, mulRGB(K.face, 0.6));
  void seed;
}

export function baboonGunnerRig(o: SoldierOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % 2) + 2) % 2;
  const seed = 91 + v * 3 + (alpha ? 4 : 0);
  const Fu = alpha ? { base: 0x5a5048, light: 0x8a8074, dark: 0x2e2824, mane: 0xd8d0c4 } : v ? { base: 0x8a7458, light: 0xb09a7a, dark: 0x4a3a2a, mane: 0xc8b89a } : { base: 0x7a7068, light: 0xa49a8e, dark: 0x463e38, mane: 0xd0c8bc };
  const fur = softFur(Fu.base, Fu.light, Fu.dark, seed);
  const mane = softFur(Fu.mane, 0xf2ece2, Fu.light, seed + 2);
  const face = alpha ? 0x8a3a3a : 0xc0846e, faceDark = alpha ? 0x4a1a1e : 0x8a5246;
  const F = new Fig();
  const body = beastBody(F, { seed, fur, belly: softFur(Fu.light, Fu.mane, Fu.base, seed + 1), dark: Fu.dark, bulk: 1.12, paunch: 0.6, legs: 'pillar', tail: 'tuft', tailCol: fur, mane, hand: face, foot: fur, nail: 0x2a1a14 });
  baboonHead(F, { fur, mane, face, faceDark }, seed);
  // leather gunner's apron, powder flasks on a bandolier, soot on the hands and chest
  const tr = F.s('torso');
  wrapShell(tr, 29, 38, leatherC(0x5a3a22, seed), (x, y, z) => z > 1.5);
  for (let y = 29; y <= 45; y++) {
    const x = Math.round(-6 + (y - 29) * 0.75);
    const z = frontZ(tr.m, x, y) + 1;
    if (z > -40) tr.m.set(x, y, z, NILE.leatherDark).set(x + 1, y, z, NILE.rawhide);
    if (y % 4 === 1 && z > -40) {
      ell(tr, [x + 0.5, y - 0.5, z + 1.2], [1.0, 1.4, 0.9], NILE.bronze[0], { fl: VF.METAL });
      tr.m.set(x, y + 1, z + 1, NILE.bronze[2], VF.METAL);
    }
  }
  for (const n of ['fore_l', 'fore_r']) F.s(n).m.forEach((x, y, z, c) => {
    if (y < 24 && noise.n3(x * 0.6, y * 0.6, z * 0.6) > 0.2) F.s(n).m.set(x, y, z, mix(c & 0xffffff, 0x1a1412, 0.45));
  });
  kilt(F, { seed, belt: NILE.leatherDark, panel: leatherC(0x5a3a22, seed + 1), hem: NILE.leatherDark });
  // leather skullcap with bronze studs
  const hat = F.part('hat', 'head', [...F.J.hat] as G);
  const hd = F.m('head');
  hd.forEach((x, y, z) => {
    if (y < 58 || z < -4 || z > 3) return;
    if (!hd.has(x, y + 1, z)) hat.m.set(x, y + 1, z, (x + z) % 4 === 0 ? NILE.bronze[2] : NILE.leatherDark, (x + z) % 4 === 0 ? VF.METAL : VF.SOLID);
  });
  // the linstock: a bronze-shod staff with a forked head clamping the smouldering match
  const wp = F.part('weapon', 'fore_r', body.handR);
  const hx = Math.floor(body.handR[0]);
  for (let y = 2; y <= 44; y++) wp.m.set(hx, y, 0, y < 5 ? NILE.bronze[0] : (y & 3) === 0 ? NILE.woodDark : NILE.wood, y < 5 ? VF.METAL : VF.SOLID);
  for (const s of [1, -1]) for (let y = 44; y <= 48; y++) wp.m.set(hx, y, s * (y > 45 ? 2 : 1), NILE.bronze[y === 48 ? 2 : 0], VF.METAL);
  for (let y = 46; y <= 49; y++) wp.m.set(hx, y, 0, y >= 48 ? 0xffa030 : 0x4a3a2a, y >= 48 ? VF.EMISSIVE : VF.SOLID);
  F.sock('match', 'weapon', [hx + 0.5, 50, 0.5]);
  if (alpha) {
    usekhG(tr, [METAL.gold[0], NILE.carnelian, METAL.gold[2]], { rMax: 7.6, y0: 42 });
    for (const x of [-3, 2]) hat.m.set(x, 63, -1, METAL.gold[0], VF.METAL).set(x, 64, -1, METAL.gold[2], VF.METAL);
  }
  return done(F, `nile_baboon${alpha ? '_alpha' : ''}_v${v}`, 'nile_baboon', { alpha, radius: 0.38, meta: { gunner: true } });
}

// ============================================================================ RAM WAR-DRUMMER
function ramHead(F: Fig, K: { wool: CSpec; face: CSpec; horn: CSpec; hornDark: number }, alpha: boolean) {
  const { hd, jw } = clearHead(F);
  ell(hd, [0, 56.2, -2.4], [5.4, 5.2, 5.4], K.wool);
  ell(hd, [0, 52.4, -3.8], [4.6, 4.0, 3.6], K.wool);
  // the long roman-nosed face
  snout(hd, 1, 13, (t) => ({ hw: 3.1 - t * 0.9, y0: 49.4 + t * 0.9, y1: 56.6 - t * 2.4 + Math.sin(t * Math.PI) * 0.7, p: 2.3 }), K.face);
  for (let x = -2; x <= 1; x++) hd.m.set(x, 51, 13, 0x3a2a2a);
  hd.m.set(-2, 52, 13, 0x1a1010).set(1, 52, 13, 0x1a1010);
  // drooping ears out to the sides
  for (const s of [1, -1]) ell(hd, [s * 5.8, 53.4, -1.8], [2.4, 0.9, 1.1], K.face);
  // great spiral horns: rising from the crown, curling back, down and forward around the ears
  for (const s of [1, -1]) {
    const pts: G[] = [];
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const phi = t * Math.PI * 1.9;
      const R = 6.4 - t * 3.6;
      pts.push([s * (3.4 + t * 5.2), 55.0 + Math.cos(phi) * R + 0.4, -2.4 - Math.sin(phi) * R]);
    }
    tube(hd, pts, (t) => (alpha ? 2.9 : 2.6) - t * 1.8, (t: number) => (Math.floor(t * 30) % 3 === 0 ? K.hornDark : res(K.horn, 0, 0, 0)));
    if (alpha) for (const p of pts.slice(N - 5)) hd.m.set(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]), METAL.gold[0], VF.METAL);
  }
  // narrow jaw with a goatee
  for (let z = 1; z <= 11; z++) {
    const hw = 2.4 - (z / 11) * 0.9;
    for (let x = -3; x < 3; x++) for (let y = 47; y <= 49; y++) {
      if (Math.abs(x + 0.5) > hw) continue;
      jw.m.set(x, y, z, y === 49 && z > 3 && Math.abs(x + 0.5) < hw - 0.8 ? 0x5a2a2a : res(K.face, x, y, z));
    }
  }
  tube(jw, [[0, 47, 8], [0, 44.5, 7.4], [0, 42.5, 6.4]], (t) => 1.1 - t * 0.6, K.wool);
  eyes(F, { x0: 3, y0: 54, z: 2, w: 3, h: 2, iris: 0xd8a030, pupil: 'bar', lid: 0x2a1a12 });
  brows(F, 2, 4, 56, 3, K.wool);
}

export function ramDrummerRig(o: SoldierOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % 2) + 2) % 2;
  const seed = 111 + v * 3 + (alpha ? 6 : 0);
  const woolBase = alpha ? 0x3a3230 : v ? 0xb8a890 : 0xe6dccb;
  const wool: CSpec = (x, y, z) => {
    // tight curls: broad soft clumps with a darker crease between them
    const n = noise.n3(x / 2.2 + seed, y / 2.2, z / 2.2 - seed);
    return n > 0.38 ? mix(woolBase, 0xffffff, 0.12) : n < -0.4 ? mix(woolBase, 0x5a4a3a, 0.2) : woolBase;
  };
  const face = softFur(alpha ? 0x2a2220 : 0xd8c8ae, alpha ? 0x4a3e3a : 0xf0e4cc, alpha ? 0x161210 : 0x9a8a72, seed);
  const F = new Fig();
  const body = beastBody(F, { seed, fur: wool, belly: wool, dark: 0x4a3a2a, bulk: 1.06, legs: 'hoof', tail: 'stub', tailCol: wool, foot: 0x2a2420, hand: face, nail: 0x2a2420 });
  ramHead(F, { wool, face, horn: alpha ? 0x6a5a48 : 0xc8b48a, hornDark: alpha ? 0x3a2e24 : 0x9a8462 }, alpha);
  // leopard-skin sash over the left shoulder (the priests' skin), kilt, gold armlets
  const tr = F.s('torso');
  const leo: CSpec = (x, y, z) => {
    const n = noise.n3(x / 1.6 + 3, y / 1.6, z / 1.6);
    return n > 0.42 ? 0x2a1a10 : n > 0.3 ? 0x8a5a20 : 0xd8a448;
  };
  for (let y = 30; y <= 45; y++) {
    const xc = -4 + (y - 30) * 0.62;
    for (let x = Math.floor(xc - 2); x <= Math.ceil(xc + 2); x++) {
      for (const zs of [1, -1]) {
        const z = zs > 0 ? frontZ(tr.m, x, y) + 1 : (() => {
          for (let zz = -12; zz < 0; zz++) if (tr.m.has(x, y, zz)) return zz - 1;
          return -99;
        })();
        if (z > -40) tr.m.set(x, y, z, res(leo, x, y, z));
      }
    }
  }
  kilt(F, { seed, belt: (x) => ((x & 3) === 1 ? NILE.carnelian : METAL.gold[0]), stripe: NILE.lapis });
  for (const n of ['arm_l', 'arm_r']) bandG(F.s(n), 36, 37, METAL.gold[0]);
  // the war drum, slung on the pelvis: a tapered barrel of staves, laced hide heads, bronze hoops
  const dr = F.part('drum', 'pelvis', [0, 27, 6]);
  const L = 6;
  for (let x = -L; x < L; x++) {
    const gx = (x + 0.5) / L;
    const R = 4.2 + Math.cos(gx * Math.PI * 0.5) * 0.9;
    const head = x === -L || x === L - 1;
    const hoop = x === -L + 1 || x === L - 2;
    for (let y = -6; y <= 6; y++)
      for (let z = -6; z <= 6; z++) {
        const r = Math.hypot(y + 0.5, z + 0.5);
        if (r > R) continue;
        const shell = r > R - 1.2;
        if (!shell && !head) continue;
        const ang = Math.atan2(y + 0.5, z + 0.5);
        const stave = Math.floor((ang + Math.PI) / (Math.PI / 7)) & 1;
        const lace = !head && !hoop && shell && Math.abs(((ang * 7) / Math.PI + gx * 3.5) % 2) < 0.35;
        const c = head ? (r > R - 0.9 ? NILE.bronze[0] : r < 1.2 ? NILE.ivoryShade : 0xe8d8b4) : hoop ? NILE.bronze[2] : lace ? 0xd8c8a0 : stave ? NILE.wood : NILE.woodDark;
        dr.m.set(x, 27 + y, 12 + z, c, hoop || (head && r > R - 0.9) ? VF.METAL : VF.SOLID);
      }
  }
  // strap up over the right shoulder
  for (let y = 33; y <= 46; y++) {
    const x = Math.round(5 - (y - 33) * 0.7);
    tr.m.set(x, y, frontZ(tr.m, x, y) + 1, NILE.rawhide);
  }
  // beaters: a padded stick in each fist
  for (const [part, parent, h] of [['weapon', 'fore_r', body.handR], ['stick_l', 'fore_l', body.handL]] as [string, string, G][]) {
    const st = F.part(part, parent, h);
    const hx = Math.floor(h[0]);
    for (let z = -1; z <= 9; z++) st.m.set(hx, 20, z, NILE.woodDark);
    ell(st, [hx + 0.5, 20.5, 10.4], [1.2, 1.2, 1.4], 0xe8d8b4);
  }
  if (alpha) {
    // the twin plumes of a drum-major and a gold sun disc between the horns
    const hat = F.part('hat', 'head', [...F.J.hat] as G);
    ell(hat, [0, 64.0, -2.4], [2.4, 2.4, 0.8], METAL.gold[0], { fl: VF.METAL });
    for (const s of [1, -1]) for (let y = 62; y <= 70; y++) hat.m.set(XI(s, 1), y, -3 - Math.floor((y - 62) / 3), (y & 1) ? NILE.carnelian : 0xf0e8d8);
  }
  return done(F, `nile_ram${alpha ? '_alpha' : ''}_v${v}`, 'nile_ram', { alpha, radius: 0.36, meta: { drummer: true } });
}

export const SOLDIER_RIGS = { wolfLegionaryRig, jackalSpearmanRig, hippoShieldRig, falconArcherRig, baboonGunnerRig, ramDrummerRig };
void scalesC;
void sections;
void cutG;
void lineG;
void coatG;
