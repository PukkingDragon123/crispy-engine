// Sand Husk — the restored realistic design, rebuilt on Sundown's skeleton figure
// (characters/skeleton.ts, 1/36): same bones, joints and proportions as Sundown,
// dressed with desiccated leathery hide shrink-wrapped over them. Ribs press
// through the chest, the belly is sunken with a dry gash, the left flank has
// split open (the figure's own ribs show, sand pours out), knobby joints, claw
// hands, bony bare feet, a hide-over-skull face with deep sunken sockets holding
// shrivelled cloudy eyeballs, a collapsed nose, lips drawn back from yellow teeth
// and shrivelled ears. Torn burial linen: loincloth (front panels ride the
// thighs, the back flap is the swaying `coat` part), a frayed rope belt with a
// pouch and a bird-skull charm, Set's sigil daubed in red ochre.
//   v0: burial shawl, forearm wraps, a little flowering saguaro on the shoulder.
//   v1: linen burial hood with a vulture feather, wraps, a wanted-poster scrap.
//   v2: right forearm stripped to the bone, a broken arrow in the back, a red sash.
//   alpha: ashen hide, bone spikes from the spine, horns, wrist spurs, ember eyes.
import type { RigSpec } from '../../../../engine/voxel/Rig';
import {
  Fig, G, Sc, VF, mix, mulRGB, hash3, noise, ell, coatG, lineG, hornG, frayStrip, frayStripZ, ropeG, loopXZ, wrapShell, clothC,
  leatherC, tones, finish, figMeta, CSpec,
} from '../figure/fig';
import { driedBody, driedHead, driedEyes, SAND, frontZ, resolve } from '../figure/flesh';

export interface EnemyOpts {
  alpha?: boolean;
  variant?: number;
}
/** voxel size of the figure-based humanoid enemies (Sundown's grid) */
export const ENEMY_VS = 1 / 36;

const SKIN = [0x705640, 0x645140, 0x7a5a3c];
const ROPE: [number, number] = [0xb89a62, 0x8a7046];

/** torn linen loincloth: hip wrap, front panels on the thighs, back flap as the `coat` part */
export function loincloth(F: Fig, lin: CSpec, seed: number, o: { back?: boolean; front?: boolean } = {}) {
  const pv = F.s('pelvis');
  wrapShell(pv, 22, 27, lin);
  // ragged hem: knock voxels out of the lowest row, let a few threads hang lower
  const hem: G[] = [];
  pv.m.forEach((x, y, z) => {
    if (y === 22 && hash3(x * 3, z * 5, seed) > 0.62) hem.push([x, y, z]);
  });
  for (const [x, y, z] of hem) pv.m.del(x, y, z);
  if (o.front !== false)
    for (const s1 of [1, -1]) {
      const th = F.s(s1 > 0 ? 'thigh_l' : 'thigh_r');
      const x0 = s1 > 0 ? 0 : -4, x1 = s1 > 0 ? 3 : -1;
      frayStrip(th, x0, x1, 3, 23, 5, 8, lin, seed + (s1 > 0 ? 1 : 2), (y) => (y < 18 ? 1 : 0));
    }
  if (o.back !== false) {
    const cp = F.part('coat', 'pelvis', [0, 27, -7]);
    frayStrip(cp, -4, 3, -8, 27, 9, 13, lin, seed + 3, (y) => (y < 21 ? 1 : 0));
    frayStrip(cp, -3, 2, -9, 26, 3, 5, mulCol(lin, 0.9), seed + 4);
    return cp;
  }
  return null;
}
const mulCol = (c: CSpec, k: number): CSpec => (typeof c === 'number' ? mulRGB(c, k) : (x: number, y: number, z: number) => mulRGB(c(x, y, z) as number, k));

/** frayed rope belt with a knot and tails, a leather pouch and a bird-skull charm */
export function ropeBelt(F: Fig, seed: number, o: { pouch?: boolean; charm?: boolean; y?: number } = {}) {
  const pv = F.s('pelvis');
  const y = o.y ?? 27.6;
  ropeG(pv, loopXZ([0, y, -1.6], 7.5, 4.95, 30, 0.04, seed), ROPE, true);
  ell(pv, [3.2, y, 3.3], [1.0, 0.9, 0.8], ROPE[1]);
  for (const dx of [0, 1.2]) lineG(pv, [[3.0 + dx, y - 0.5, 3.6], [3.3 + dx, y - 2.6, 3.9], [3.1 + dx * 1.3, y - 4.4, 3.8]], (t) => (t > 0.85 ? 0xd8c08a : ROPE[(dx > 0 ? 1 : 0)]));
  if (o.pouch !== false) {
    const L = leatherC(0x7a4e2c, seed);
    pv.rbox([-9.0, 23.2, -0.9], [-6.6, 26.8, 1.9], 0.7, L);
    pv.box([-9.1, 25.6, 1.4], [-6.5, 26.8, 2.3], 0x5a361e); // flap
    pv.dot([-7.8, 25.4, 2.1], 0xc79a46, VF.METAL); // buckle
    lineG(pv, [[-8.4, 26.9, 0.8], [-8.0, y + 0.4, 0.5]], 0x5a361e);
  }
  if (o.charm !== false) {
    lineG(pv, [[1.6, y - 0.4, 3.5], [1.9, y - 3.4, 3.9]], 0x6a5030);
    const b = (x: number, y2: number) => ((x + y2) & 1 ? 0xeadcb8 : 0xd8c8a0);
    for (let x = 1; x <= 2; x++) for (let yy = 22; yy <= 23; yy++) for (let z = 3; z <= 4; z++) pv.m.set(x, yy, z, b(x, yy));
    pv.m.set(1, 23, 4, 0x1a120c).set(2, 23, 4, 0x1a120c); // eye holes
    pv.m.set(1, 22, 5, 0xc8b484).set(1, 21, 5, 0xb8a070); // beak
  }
}

/** a burial shawl over the left shoulder, down the back with a frayed edge */
export function shawl(F: Fig, lin: CSpec, seed: number) {
  const s = F.s('torso');
  const m = s.m;
  for (let y = 31; y <= 44; y++)
    for (let x = -8; x <= 7; x++) {
      const gx = x + 0.5;
      if (gx < -1.5 + (y - 44) * 0.85) continue;
      const bottom = 31 + Math.floor(hash3(x, 9, seed) * 3);
      if (y < bottom) continue;
      let zb = 99;
      for (let z = -9; z <= 6; z++) if (m.has(x, y, z)) {
        zb = z;
        break;
      }
      if (zb === 99) continue;
      m.set(x, y, zb - 1, resolve(lin, x, y, zb - 1) as number);
    }
  // over the left shoulder top, a fringe hanging down the front
  for (let x = 2; x <= 7; x++)
    for (let z = -5; z <= 2; z++) {
      let top = -1;
      for (let y = 46; y >= 40; y--) if (m.has(x, y, z)) {
        top = y;
        break;
      }
      if (top > 0) m.set(x, top + 1, z, resolve(lin, x, top + 1, z) as number);
    }
  for (let x = 3; x <= 6; x++) {
    const zf = frontZ(m, x, 42) + 1;
    frayStrip(s, x, x, zf, 43, 2, 3, lin, seed + 7);
  }
}

/** loose linen wraps around both forearms with a dangling end */
export function forearmWraps(F: Fig, lin: CSpec, seed: number) {
  for (const s1 of [1, -1]) {
    const s = F.s(s1 > 0 ? 'fore_l' : 'fore_r');
    for (const y of [27, 28, 30]) wrapShell(s, y, y, lin);
    lineG(s, [[s1 * 10.6, 27.5, -0.6], [s1 * 10.9, 25.5, -1.0], [s1 * 10.7, 23.4, -0.8]], mulCol(lin, 0.92));
    void seed;
  }
}

export function huskRig(o: EnemyOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % 3) + 3) % 3;
  const seed = alpha ? 31 : 7 + v * 13;
  const F = new Fig();
  const skin = alpha ? 0x4e4842 : SKIN[v];
  const K = driedBody(F, { skin, seed, boneArmR: !alpha && v === 2 });
  driedHead(F, K, { seed, patch: alpha ? 'brow' : v === 0 ? 'brow' : v === 2 ? 'temple' : 'none', hair: v === 0 && !alpha });
  driedEyes(F, { ember: alpha });

  const linBase = v === 1 ? 0xd9ccaa : alpha ? 0xb4a688 : 0xc4b38f;
  const lin = clothC(linBase, seed, { fold: 3, crease: mix(linBase, 0x5a4a32, 0.32), stain: mix(linBase, 0x6a5030, 0.35) });
  loincloth(F, lin, seed);
  ropeBelt(F, seed);
  // Set's sigil daubed in red ochre on the left front panel
  {
    const th = F.s('thigh_l');
    for (const [x, y] of [[1, 19], [1, 20], [0, 21], [2, 21], [0, 22], [2, 22]] as [number, number][]) if (th.m.has(x, y, 3)) th.m.set(x, y, 3, mix(th.m.get(x, y, 3)! & 0xffffff, 0x6a2414, 0.6));
  }
  if (v !== 2 && !alpha) shawl(F, lin, seed); // the alpha's spine spikes stay bare
  if (v !== 2 || alpha) forearmWraps(F, lin, seed);

  // ---------------------------------------------------------------- quirks
  if (alpha) {
    const bone = (x: number, y: number, z: number) => mix(0xd8c49c, 0x8a7050, Math.max(0, noise.n3(x / 2.5, y / 2.5, z / 2.5)) * 0.8);
    const tr = F.s('torso');
    for (const [y, len] of [[32, 3.0], [35, 4.0], [38, 4.6], [41, 4.0]] as [number, number][]) hornG(tr, [0, y + 0.5, -6.0], [0, 0.3, -1], len, 1.15, bone, [0, 0.35, 0], mix(0xd8c49c, 0x6a5038, 0.5));
    const hd = F.s('head');
    // heavy ridged horns sweeping up and back from the temples, darkening to the tips
    const horn = (x: number, y: number, z: number) => mix(0x6a5a46, 0x241a12, Math.min(1, Math.max(0, (y - 58) / 9)) * 0.8 + (((x + y + z) & 3) === 0 ? 0.12 : 0));
    for (const sx of [1, -1]) hornG(hd, [sx * 4.8, 60.0, -1.0], [sx * 0.4, 0.85, -0.45], 12, 2.3, horn, [sx * 0.15, -1.1, -1.5], 0x3a2c20);
    hornG(hd, [0, 62.5, -3.0], [0, 0.8, -0.6], 4.0, 1.2, horn);
    for (const s1 of [1, -1]) {
      const fs = F.s(s1 > 0 ? 'fore_l' : 'fore_r');
      for (let k = 0; k < 3; k++) hornG(fs, [s1 * (8.0 + k * 1.1), 26.0, 1.2], [s1 * 0.1, -0.45, 1], 3.2, 0.62, 0x2a2018);
    }
  } else if (v === 0) {
    // a little saguaro sprouted from the right shoulder, flowering
    const tr = F.s('torso');
    const cac = (x: number, y: number, z: number) => ((x + z) & 1 ? 0x4e7c35 : 0x6b9e45);
    ell(tr, [-7.4, 44.0, -2.4], [1.6, 0.8, 1.5], tones(SAND.c, SAND.b, 0x8a6a44, 2, 3)); // dirt clump at the root
    for (let y = 44; y <= 51; y++) for (const x of [-8, -7]) for (const z of [-3, -2]) if (!(y === 51 && (x + z) % 2 === 0)) tr.m.set(x, y, z, cac(x, y, z));
    for (const [x, y] of [[-9, 47], [-10, 47], [-10, 48], [-10, 49], [-10, 50]] as [number, number][]) tr.m.set(x, y, -2, cac(x, y, -2)).set(x, y, -3, cac(x, y, -3));
    for (const [x, y, z] of [[-9, 46, -1], [-6, 48, -3], [-8, 50, -4], [-6, 45, -2], [-11, 49, -2], [-9, 49, -4], [-7, 46, -1]] as G[]) tr.m.set(x, y, z, 0xf4ecd0); // spines
    tr.m.set(-8, 52, -3, 0xff6fa8).set(-7, 52, -2, 0xff6fa8).set(-8, 52, -2, 0xffd23a).set(-7, 52, -3, 0xffa6c8).set(-10, 51, -2, 0xffa6c8);
  } else if (v === 1) {
    // linen burial hood wrapped around the skull, frayed tails down the back, a vulture feather through it
    const hd = F.s('head');
    const hoodC = clothC(0xcfc09c, seed + 5, { fold: 3, axis: 'z' });
    const face = (x: number, y: number, z: number) => z > 1.2 && y < 58.2 && Math.abs(x) < 5.6;
    wrapShell(hd, 49, 62, hoodC, (x, y, z) => !face(x, y, z));
    for (let x = -6; x <= 5; x++) for (let z = -8; z <= 5; z++) {
      let top = -1;
      for (let y = 66; y >= 56; y--) if (hd.m.has(x, y, z)) {
        top = y;
        break;
      }
      if (top >= 58 && !face(x + 0.5, top, z + 0.5)) hd.m.set(x, top + 1, z, resolve(hoodC, x, top + 1, z) as number);
    }
    // a folded brow band across the forehead
    for (let x = -6; x <= 5; x++) hd.m.set(x, 58, 6, resolve(hoodC, x, 58, 6) as number).set(x, 59, 6, mulRGB(resolve(hoodC, x, 59, 6) as number, 0.93));
    frayStrip(hd, -4, 3, -9, 52, 4, 8, hoodC, seed + 9);
    // the feather
    const f0: G = [2.5, 64.0, -5.0], f1: G = [5.5, 72.5, -9.5];
    lineG(hd, [f0, f1], 0xf0e6d0);
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      const p: G = [f0[0] + (f1[0] - f0[0]) * t, f0[1] + (f1[1] - f0[1]) * t, f0[2] + (f1[2] - f0[2]) * t];
      const w = Math.round(Math.sin(t * Math.PI) * 1.6 + 0.5);
      for (let d = 1; d <= w; d++) {
        const c = t > 0.85 ? 0xe9e2d4 : (k + d) & 1 ? 0x2a221e : 0x3a2e26;
        hd.m.set(Math.floor(p[0]) + d, Math.floor(p[1]), Math.floor(p[2]), c).set(Math.floor(p[0]) - d, Math.floor(p[1]), Math.floor(p[2]), mulRGB(c, 0.9));
      }
    }
    // it's wanted too: a torn poster scrap nailed to the chest
    const tr = F.s('torso');
    for (let x = -6; x <= -3; x++) for (let y = 35; y <= 39; y++) {
      if (x === -6 && y === 35) continue;
      const z = frontZ(tr.m, x, y) + 1;
      const band = y === 39 ? 0x9a2a1c : x >= -5 && x <= -4 && y >= 36 && y <= 37 ? 0x3a2a1c : y === 35 && (x & 1) ? 0x3a2a1c : 0xe0d0a8;
      tr.m.set(x, y, z, band);
    }
    tr.m.set(-5, 39, frontZ(tr.m, -5, 39) + 1, 0x8a8a8a, VF.METAL);
  } else {
    // a broken arrow lodged in the back
    const tr = F.s('torso');
    lineG(tr, [[1.5, 38.5, -5.6], [3.2, 43.0, -11.5]], 0x8a5a30);
    tr.m.set(3, 43, -12, 0xb8322a).set(4, 43, -11, 0xb8322a).set(2, 43, -11, 0xf0e6d0).set(3, 44, -12, 0xf0e6d0);
    // a red storm sash knotted on the left arm (Set's gangs)
    const al = F.s('arm_l');
    const red = (x: number, y: number, z: number) => ((x + y + z) & 1 ? 0x8a2a20 : 0x74221a);
    wrapShell(al, 37, 38, red);
    ell(al, [10.6, 37.6, -0.6], [0.8, 0.9, 0.9], 0x641c16);
    lineG(al, [[11.0, 37.0, -0.8], [11.6, 34.2, -1.4]], 0x8a2a20);
    lineG(al, [[10.9, 36.8, 0.2], [11.8, 34.6, 0.6]], 0x74221a);
  }
  finish(F);

  // height: crown (or hood / horns) top
  let top = 63;
  F.m('head').forEach((_x, y) => (top = Math.max(top, y + 1)));
  return F.build(`husk${alpha ? '_alpha' : ''}_v${v}`, figMeta(F, 'husk', { alpha, variant: v, height: top * F.vs, radius: 0.3 }));
}
void coatG;
void frayStripZ;
void Sc;
