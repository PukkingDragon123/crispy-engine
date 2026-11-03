// Curse Priest: one of Khonsu's night-priests, wrapped for the tomb and woken
// to sing the moon up. Built on the Cursed Mummy's wrapped body over Sundown's
// skeleton figure (1/36, standard humanoid parts), then dressed as a lunar
// priest: a night-indigo nemes hood with long lappets, Khonsu's crown (a full
// moon disc cradled in a silver crescent) over a gold diadem, an indigo stole
// sewn with silver stars, a pleated apron, cold moon-blue embers in the
// sockets, and a tall ebony staff (`weapon` on fore_r) crowned with a crescent
// holding a glowing moonstone (`orb` socket: where the ward thread leaves).
// Alpha: a hammered silver moon mask and gold horns on the crescents.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { defaultExpressions } from '../toon/humanoid';
import { Fig, finish, figMeta, ell, cap, tube, lineG, wrapShell, frayStrip, clothC, isSurf, mix, mulRGB, hash3, G, VF } from './figure/fig';
import { emberEyes, METAL, frontZ } from './figure/gear';
import { mummyBody } from './mummy';

const NIGHT = 0x26285a;
const NIGHT_D = 0x181a3e;
const NIGHT_L = 0x3a3e7c;
const MOON = 0xdfeeff;
const EBONY = 0x2a1c16;

/** a crescent in the x-y plane (horns up) around centre c, radius r, thickness t, depth d (z) */
function crescent(s: ReturnType<Fig['s']>, c: G, r: number, t: number, d: number, col: number, hornCol: number, fl = VF.METAL) {
  const pts: G[] = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    // from the left horn (upper left) down round the bottom to the right horn
    const a = Math.PI * (1.12 + (i / n) * 0.76) + Math.PI * 0.5;
    pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2]]);
  }
  for (let k = 0; k < d; k++) tube(s, pts.map((p) => [p[0], p[1], p[2] + k * 0.9] as G), (u) => Math.max(0.55, t * Math.sin(Math.PI * (0.08 + u * 0.84))), (u: number) => (u < 0.1 || u > 0.9 ? hornCol : col), fl);
}

export function cursePriestRig(o: { alpha?: boolean } = {}): RigSpec {
  const alpha = !!o.alpha;
  const F = new Fig();
  const { hd, tr, eyeHole } = mummyBody(F, { alpha: false, variant: 2, collar: true });
  const GOLD = METAL.gold, SIL = METAL.silver;
  const cloth = clothC(NIGHT, 41, { fold: 3, crease: NIGHT_D, stain: mix(NIGHT, 0x5a4428, 0.25) });
  // ---------------------------------------------------------------- moon-blue embers deep in the sockets
  emberEyes(F, 0x8fd8ff, { orb: 0x0c1020 });
  // ---------------------------------------------------------------- nemes hood: indigo with a lighter stripe, lappets down the chest
  const hood = (x: number, y: number, z: number) => {
    if (z > 2.5 && y < 60.5) return false; // the face stays open
    if (eyeHole(x, y, z)) return false;
    return y > 49;
  };
  wrapShell(hd, 50, 63, (x, y) => ((y + (x > 0 ? 0 : 1)) % 3 === 0 ? NIGHT_L : (hash3(x, y, 3) > 0.9 ? NIGHT_D : NIGHT)), hood);
  // the hood's flared sides above the ears and its crown cap
  for (const s1 of [1, -1]) {
    ell(hd, [s1 * 7.2, 55.5, -1.5], [1.6, 5.2, 4.2], cloth);
    // lappets: two pleated bands falling in front of the shoulders onto the chest
    const lap = F.s('torso');
    for (let y = 36; y <= 47; y++) {
      const w = y > 44 ? 2.6 : 2.2;
      for (let x = 4.0; x <= 4.0 + w; x += 1) {
        const X = Math.floor(s1 > 0 ? x : -1 - x);
        const z = frontZ(lap.m, X, y) + 1;
        lap.m.set(X, y, z, (y % 2 === 0) ? NIGHT_L : NIGHT);
      }
    }
  }
  for (let x = -6; x <= 5; x++) for (let z = -7; z <= 3; z++) {
    let top = -1;
    for (let y = 66; y >= 58; y--) if (hd.m.has(x, y, z)) {
      top = y;
      break;
    }
    if (top >= 61) hd.m.set(x, top + 1, z, (x + z) % 4 === 0 ? NIGHT_L : NIGHT);
  }
  // gold diadem with lapis studs across the brow
  hd.m.forEach((x, y, z) => {
    if (y === 59 && z > -8 && isSurf(hd.m, x, y, z)) hd.m.set(x, y, z, (x + z) % 3 === 0 ? 0x2a4a9a : GOLD[0], (x + z) % 3 === 0 ? VF.SOLID : VF.METAL);
  });
  // ---------------------------------------------------------------- Khonsu's crown: full moon in a silver crescent
  const top = 66;
  cap(hd, [0, 62.5, -1.5], [0, top - 0.5, -1.5], 1.2, 0.9, GOLD[1], VF.METAL); // post
  crescent(hd, [0, top + 4.6, -2.2], alpha ? 6.2 : 5.4, 1.5, 2, SIL[0], alpha ? GOLD[2] : SIL[2]);
  ell(hd, [0, top + 5.2, -1.6], [3.4, 3.4, 0.9], (x, y) => ((x * 3 + y * 5) % 7 === 0 ? 0xb8d0f0 : MOON), { fl: VF.EMISSIVE });
  // ---------------------------------------------------------------- the moon mask (alpha)
  if (alpha) {
    for (let x = -6; x <= 5; x++)
      for (let y = 46; y <= 58; y++) {
        const gx = x + 0.5;
        if (Math.abs(gx) > 6 - Math.max(0, 48 - y) * 1.2 || eyeHole(gx, y + 0.5, 6.5)) continue;
        const z = frontZ(hd.m, x, y) + (hd.m.has(x, y, 7) ? 0 : 1);
        const kohl = (y === 56 || y === 51) && Math.abs(gx) > 0.6 && Math.abs(gx) < 6;
        hd.m.set(x, y, z, kohl ? 0x10142a : SIL[(x * 7 + y * 3) % 5 === 0 ? 2 : (x + y) % 4 === 0 ? 1 : 0], kohl ? VF.SOLID : VF.METAL);
      }
  }
  // ---------------------------------------------------------------- stole: indigo mantle on the shoulders, silver stars
  wrapShell(tr, 40, 45, cloth, (x, y, z) => y > 40 || Math.abs(x) > 6);
  for (const s1 of [1, -1]) {
    const a = F.s(s1 > 0 ? 'arm_l' : 'arm_r');
    wrapShell(a, 37, 44, cloth);
  }
  const stars: G[] = [[-5, 43, 0], [5, 42, 0], [-3, 44, 0], [4, 44, 0]];
  for (const [x, y] of stars) {
    const z = frontZ(tr.m, x, y);
    if (z > -50) tr.m.set(x, y, z, SIL[2], VF.METAL);
  }
  // ---------------------------------------------------------------- pleated night apron over the kilt
  const pv = F.s('pelvis');
  const az = frontZ(pv.m, 0, 24) + 1;
  frayStrip(pv, -3, 2, az, 26, 9, 11, (x, y) => (x % 2 === 0 ? NIGHT : NIGHT_L), 47);
  for (let x = -3; x <= 2; x++) pv.m.set(x, 26, az, GOLD[0], VF.METAL).set(x, 25, az, x % 2 ? 0x2a4a9a : GOLD[1], x % 2 ? VF.SOLID : VF.METAL);
  // ---------------------------------------------------------------- the moon staff (right hand)
  const hand = F.J.hand_r;
  const st = F.part('weapon', 'fore_r', [hand[0], hand[1], hand[2]]);
  const sx = hand[0] - 0.3, sz = hand[2] + 0.4;
  cap(st, [sx, 3, sz], [sx, 54, sz], 0.75, 0.85, (x, y) => (y % 9 === 0 ? SIL[1] : y % 9 === 1 ? SIL[0] : mix(EBONY, 0x4a3426, hash3(x, y, 5) * 0.35)));
  for (const y of [18, 26, 47]) ell(st, [sx, y, sz], [1.3, 0.7, 1.3], GOLD[0], { fl: VF.METAL }); // gold collars
  crescent(st, [sx, 58.2, sz - 0.4], 3.8, 1.1, 2, SIL[0], alpha ? GOLD[2] : SIL[2]);
  ell(st, [sx, 58.6, sz + 0.1], [1.7, 1.7, 1.5], 0x8fd8ff, { fl: VF.EMISSIVE | VF.GLOW });
  ell(st, [sx - 0.5, 59.2, sz + 1.2], [0.55, 0.55, 0.4], 0xffffff, { fl: VF.EMISSIVE });
  // gold tassels under the crescent
  for (const dx of [-1.6, 1.6]) lineG(st, [[sx + dx, 54.5, sz], [sx + dx * 1.1, 51.5, sz + 0.3], [sx + dx * 1.15, 49.5, sz + 0.2]], (t: number) => (t > 0.85 ? GOLD[2] : GOLD[0]));
  F.sock('orb', 'weapon', [sx, 58.6, sz + 0.5]);
  finish(F);
  let height = 0;
  hd.m.forEach((_x, y) => (height = Math.max(height, y + 1)));
  return F.build(`curse_priest${alpha ? '_alpha' : ''}`, figMeta(F, 'curse_priest', {
    alpha,
    height: height * F.vs,
    radius: 0.36,
    weakPoint: 'heart',
    expressions: defaultExpressions(['neutral', 'angry', 'hurt', 'surprised', 'dead', 'stunned']),
  }));
}
void mulRGB;
