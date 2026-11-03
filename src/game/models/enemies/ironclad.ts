// THE IRONCLAD (miniboss): a hulking skeleton that crawled out of a derailed
// locomotive and wore it. Built on Sundown's skeleton figure (1/36, standard
// humanoid parts and joints) re-proportioned into a brute — shoulders pushed
// wide, head sunk low between the plates, a barrel rib cage with a coal
// furnace burning inside it — then scaled to boss size (1/16 → ~4 m).
//
// Scavenged armour, every piece its own breakable part:
//   helm        riveted nasal helm with a brass locomotive headlamp and two
//               bent rail-spike horns (`lamp` socket)
//   pauldron_l  three red-painted boiler-plate lames with a brass band
//   pauldron_r  three bare rusted lames, one cracked, a hanging chain
//   chest       boiler-plate cuirass with a firebox door (its grate glows) and
//               a pressure gauge; under it the furnace heart (`heart` socket)
//   shield      a cow-catcher (pilot) off the front of the engine: red bumper
//               beam, knuckle coupler, a V-wedge of slanted iron bars. It is
//               sculpted in the guard frame and stored rotated, and fore_l's
//               rest pose bends the elbow 90° so the shield stands in front.
// Fixed gear: an iron gorget, a riveted belt with plate tassets, greaves,
// iron-shod boots, a boiler tank on the back and a balloon smokestack
// (`stack` part, `smoke` socket). The right forearm ends in a six-barrel
// gatling (`gatling` part, `barrels` spin about local Y, `muzzle` socket).
// Hit-sphere sockets: hs_helm, hs_skull, hs_pl, hs_pr, hs_chest, hs_heart,
// hs_shield, hs_pelvis, hs_thigh_l, hs_thigh_r.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { defaultExpressions } from '../toon/humanoid';
import { Fig, finish, figMeta, ell, cap, tube, sections, limbG, lineG, cutG, isSurf, agedBone, mix, mulRGB, noise, hash3, hornG, Sc, VoxelModel, VF, G, CSpec, ColorFn } from './figure/fig';
import { ageBones, emberEyes, METAL, rescaleRig } from './figure/gear';
import { BOSS_EXPR } from './marshal';

export const IRONCLAD_VS = 1 / 16;

const RUST = 0x8a4a22;
const RUST_D = 0x5e2e14;
const SOOT = 0x2a2624;
const RED = 0x9a2a1c;
const LEATHER = 0x4a2e1c;
const EMBER = 0xff7a1e;

/** weathered iron: broad rust patches, soot, the odd bright scuff */
function ironC(base: number, seed: number, rust = 0.3): ColorFn {
  return (x, y, z) => {
    const n = noise.n3(x / 3.6 + seed, y / 4.2, z / 3.6 - seed);
    const k = noise.n3(x / 1.8, y / 2.1 + seed, z / 1.8);
    if (n > 0.6 - rust * 0.45) return n > 0.78 - rust * 0.3 ? RUST_D : RUST;
    if (k > 0.68) return mix(base, 0xc8ccd4, 0.28);
    if (n < -0.5) return mix(base, SOOT, 0.45);
    return base;
  };
}
/** chipped locomotive red */
function paintC(base: number, seed: number): ColorFn {
  return (x, y, z) => {
    const n = noise.n3(x / 2.6 + seed, y / 2.6, z / 2.6 + seed);
    if (n > 0.52) return METAL.iron[1];
    if (n > 0.4) return RUST;
    return noise.n3(x / 5, y / 7 + seed, z / 5) > 0.45 ? mix(base, 0xffffff, 0.08) : base;
  };
}

/** move a sub-tree of parts (voxels, pivots and their sockets) by d */
function shiftSub(F: Fig, names: string[], d: G) {
  const set = new Set(names);
  for (const n of names) {
    if (!F.has(n)) continue;
    const src = F.m(n);
    const o = new VoxelModel(n);
    src.forEach((x, y, z, c, f) => o.set(x + d[0], y + d[1], z + d[2], c, f));
    F.setModel(n, o);
    const p = F.fig.parts[n].pivot;
    F.fig.parts[n].pivot = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
  }
  for (const s of Object.values(F.fig.sockets)) if (set.has(s.part)) s.at = [s.at[0] + d[0], s.at[1] + d[1], s.at[2] + d[2]];
}

/** a domed rivet sitting on a surface point, pushed out along n */
function rivet(s: Sc, p: G, n: G, col = METAL.brass[0]) {
  ell(s, [p[0] + n[0] * 0.35, p[1] + n[1] * 0.35, p[2] + n[2] * 0.35], [0.62, 0.62, 0.62], col, { fl: VF.METAL });
}

/** rust bleeding down from each brass rivet / seam on a part (surface only) */
function rustStreaks(s: Sc, seed: number) {
  const m = s.m;
  const starts: G[] = [];
  const studs = new Set<string>();
  m.forEach((x, y, z, c, f) => {
    const brass = (f & VF.METAL) !== 0 && (c === METAL.brass[0] || c === METAL.brass[1] || c === METAL.gold[0] || c === METAL.gold[1]);
    if (!brass) return;
    studs.add(x + ',' + y + ',' + z);
    if (hash3(x + seed, y, z) > 0.55) starts.push([x, y, z]);
  });
  for (const [x, y0, z] of starts) {
    const len = 2 + Math.floor(hash3(x, y0 + seed, z) * 4);
    for (let i = 1; i <= len; i++) {
      const y = y0 - i;
      // walk the streak down the outside of the plate (the voxel itself, or the next one in)
      for (const dz of [0, -1, 1]) {
        const X = x, Z = z + dz;
        if (m.has(X, y, Z) && isSurf(m, X, y, Z) && !studs.has(X + ',' + y + ',' + Z)) {
          m.set(X, y, Z, i === len ? RUST_D : RUST);
          break;
        }
      }
    }
  }
}

export function ironcladRig(tier = 1): RigSpec {
  const T = Math.max(1, Math.min(3, tier | 0));
  const F = new Fig();
  const IRON = T >= 3 ? 0x3a3c42 : METAL.iron[0];
  const TRIM = T >= 2 ? METAL.gold : METAL.brass;
  const PAINT = T >= 3 ? 0x1e1c1e : RED;
  const iron = ironC(IRON, 3 + T, 0.32);
  const ironD = ironC(mulRGB(IRON, 0.8), 9 + T, 0.4);
  const bone = agedBone(0xd8c49a, 7, 0x7a6040);
  const boneD = agedBone(0xbca47a, 11, 0x6a5034);

  // ============================================================== re-proportion the figure into a brute
  ageBones(F, { seed: 31, tint: 0x9a7a52, amt: 0.3, grime: 0x5a4430 });
  emberEyes(F, T >= 3 ? 0xff3a10 : EMBER, { orb: 0x140a06 });
  shiftSub(F, ['arm_l', 'fore_l'], [4.5, -1, 0]);
  shiftSub(F, ['arm_r', 'fore_r'], [-4.5, -1, 0]);
  shiftSub(F, ['head', 'jaw', 'eye_l', 'eye_r', 'brow_l', 'brow_r'], [0, -3, 1.5]);
  shiftSub(F, ['thigh_l', 'shin_l'], [1.5, 0, 0]);
  shiftSub(F, ['thigh_r', 'shin_r'], [-1.5, 0, 0]);
  const SH: G = [12.5, 41.5, 0], EL: G = [12.5, 32, 0], HIP: G = [5.5, 24, 0], KNEE: G = [5, 15.5, 0];

  // ============================================================== torso: barrel rib cage, spine, the furnace heart, back boiler
  const tr = F.s('torso');
  tr.m.map.clear();
  const cage = (y: number) => {
    const t = (y - 29) / 16;
    const a = 7 + Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.62) * 4.2 - Math.max(0, t - 0.82) * 6;
    return { a, f: 4 + Math.sin(Math.min(1, t * 1.1) * Math.PI * 0.6) * 3.4, b: -6.5 - Math.sin(Math.min(1, t) * Math.PI * 0.7) * 2.2, p: 2.3 };
  };
  // ribs: a hollow barrel, every third row a gap; sternum at the front, a heavy spine at the back
  sections(tr, 29, 44, (y) => cage(y), (x, y, z) => {
    const q = cage(y + 0.5);
    const zc = (q.f + q.b) / 2, zr = (q.f - q.b) / 2;
    const u = Math.abs(x + 0.5) / q.a, v = Math.abs(z + 0.5 - zc) / zr;
    const d = Math.pow(u, 2.3) + Math.pow(v, 2.3);
    if (d < 0.62) return null; // hollow inside
    const sternum = Math.abs(x + 0.5) < 1.6 && z > zc;
    const spine = Math.abs(x + 0.5) < 2.2 && z < zc;
    if (!sternum && !spine && y % 3 === 2) return null; // rib gaps
    return spine ? boneD(x, y, z) : bone(x, y, z);
  });
  for (let y = 29; y <= 46; y += 2) ell(tr, [0, y + 0.5, -8.6], [1.8, 0.9, 1.3], boneD); // vertebra knobs
  cap(tr, [0, 43.5, -2.5], [0, 47, -0.5], 2.4, 2.0, boneD); // neck
  for (const s1 of [1, -1]) {
    cap(tr, [s1 * 1.5, 44.5, 4.5], [s1 * 11, 44, 0.5], 1.2, 1.0, bone); // clavicles
    ell(tr, [s1 * 7.5, 40, -8.2], [3.6, 4.5, 1.2], boneD); // shoulder blades
  }
  // the furnace heart: an iron firebox in the cage, coals glowing through a grate
  ell(tr, [0, 37, 0.5], [4.6, 4.2, 3.8], ironD);
  for (let x = -3; x <= 2; x++)
    for (let y = 34; y <= 39; y++) {
      const z = 4;
      const slot = y % 2 === 0;
      tr.m.set(x, y, z, slot ? (hash3(x, y, 9) > 0.5 ? 0xffb040 : EMBER) : METAL.iron[1], slot ? VF.EMISSIVE | VF.GLOW : VF.METAL);
    }
  ell(tr, [0, 36.5, 2.2], [3.2, 2.8, 1.4], (x, y, z) => (hash3(x, y, z) > 0.6 ? 0xffd070 : hash3(x, z, y) > 0.4 ? EMBER : 0xc8341a), { fl: VF.EMISSIVE });
  // back boiler tank with brass bands, a feed pipe over the right shoulder
  cap(tr, [0, 30.5, -11], [0, 43.5, -11], 4.6, 4.6, iron);
  ell(tr, [0, 43.5, -11], [4.6, 1.8, 4.6], iron);
  for (const y of [32, 37, 42]) for (let a = 0; a < 40; a++) {
    const t = (a / 40) * Math.PI * 2;
    tr.m.set(Math.floor(Math.cos(t) * 4.9), y, Math.floor(-11 + Math.sin(t) * 4.9), TRIM[0], VF.METAL);
  }
  tube(tr, [[-2.5, 42, -8], [-6, 46, -6], [-10.5, 46.5, -2.5], [-12, 45, 0]], () => 0.9, (t: number) => (t > 0.9 ? TRIM[1] : METAL.iron[1]), VF.METAL);
  // gorget: a thick riveted iron collar the skull sinks into
  for (let y = 42; y <= 46; y++)
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      const r = 7.4 - (y - 42) * 0.25;
      for (const dr of [0, 0.8]) tr.m.set(Math.floor(Math.cos(t) * (r + dr)), y, Math.floor(-1 + Math.sin(t) * (r + dr) * 0.92), y === 46 ? TRIM[1] : (iron(a, y, 0) as number), VF.METAL);
    }
  for (let a = 0; a < 12; a++) {
    const t = (a / 12) * Math.PI * 2;
    rivet(tr, [Math.cos(t) * 8.4, 44, -1 + Math.sin(t) * 7.8], [Math.cos(t), 0, Math.sin(t)], TRIM[0]);
  }
  F.sock('heart', 'torso', [0, 37, 4.5]);
  F.sock('hs_heart', 'torso', [0, 37, 2]);
  F.sock('hs_chest', 'torso', [0, 37.5, 4]);
  F.sock('back', 'torso', [0, 37, -15]);

  // ============================================================== pelvis: heavy bone, riveted belt, plate tassets
  const pv = F.s('pelvis');
  pv.m.map.clear();
  for (const s1 of [1, -1]) ell(pv, [s1 * 5, 25.5, -1.5], [4.2, 3.8, 3.4], bone); // iliac wings
  ell(pv, [0, 23, -2], [3.5, 2.5, 3], boneD); // sacrum
  sections(pv, 25, 28, () => ({ a: 10.4, f: 5.4, b: -8.4, p: 2.6 }), (x, y, z) => (y === 28 || y === 25 ? TRIM[1] : (iron(x, y, z) as number)), VF.METAL);
  cutG(pv, (x, y, z) => y > 25 && y < 28 && Math.abs(x) < 9.6 && z < 4.6 && z > -7.6); // the belt is a band, not a block
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    rivet(pv, [Math.cos(t) * 10.6, 26.5, -1.5 + Math.sin(t) * 7], [Math.cos(t), 0, Math.sin(t)], TRIM[0]);
  }
  // round brass boss on the buckle
  ell(pv, [0, 26.5, 6.2], [2.4, 2.4, 0.8], TRIM[0], { fl: VF.METAL });
  ell(pv, [0, 26.5, 6.8], [1.2, 1.2, 0.5], TRIM[2], { fl: VF.METAL });
  // hanging tassets: front, back and hip plates, slightly splayed
  for (const [cx, cz, nz, w] of [[0, 5.6, 1, 4.2], [7.5, 2.5, 0.4, 3.4], [-7.5, 2.5, 0.4, 3.4], [0, -8.4, -1, 4.6]] as [number, number, number, number][]) {
    for (let y = 18; y <= 24; y++) for (let x = -w; x <= w; x++) {
      const X = Math.floor(cx + x), Z = Math.floor(cz + nz * (24 - y) * 0.25 + Math.abs(x) * -0.15 * Math.sign(nz || 1));
      if (y === 18 && (Math.abs(x) > w - 1.5)) continue;
      pv.m.set(X, y, Z, y === 21 ? TRIM[1] : (ironD(X, y, Z) as number), VF.METAL);
    }
  }

  // ============================================================== legs: massive femurs, knee cops, greaves, iron-shod boots
  for (const s1 of [1, -1]) {
    const X = (x: number) => s1 * x;
    const th = F.s(s1 > 0 ? 'thigh_l' : 'thigh_r');
    th.m.map.clear();
    ell(th, [X(HIP[0]), 23.5, 0], [2.8, 2.8, 2.8], bone);
    limbG(th, [X(HIP[0]), 23, 0], [X(KNEE[0]), 16.5, 0.2], (t) => 2.5 - 0.5 * t + Math.sin(t * Math.PI) * 0.3, bone);
    const sh = F.s(s1 > 0 ? 'shin_l' : 'shin_r');
    sh.m.map.clear();
    ell(sh, [X(KNEE[0]), 15.5, 0.4], [2.6, 2.3, 2.6], bone);
    limbG(sh, [X(KNEE[0]), 14.5, 0.2], [X(4.6), 5, 0], (t) => 2.1 - 0.5 * t, bone);
    limbG(sh, [X(KNEE[0] + 1.6), 14, -0.6], [X(5.6), 5.5, -0.6], () => 1.0, boneD); // fibula
    // knee cop: a domed plate with a flared wing
    ell(sh, [X(KNEE[0]), 15.5, 2.3], [2.8, 2.4, 1.5], iron, { fl: VF.METAL, keep: (_x, _y, lz) => lz > -0.2 });
    rivet(sh, [X(KNEE[0]), 15.5, 3.8], [0, 0, 1], TRIM[0]);
    // greave over the front of the shin
    for (let y = 6; y <= 13; y++)
      for (let a = -5; a <= 5; a++) {
        const t = (a / 5) * 1.25;
        const r = 2.6 - (13 - y) * 0.05;
        sh.m.set(Math.floor(X(4.8) + Math.sin(t) * r), y, Math.floor(Math.cos(t) * r), y === 13 || y === 6 ? TRIM[1] : (iron(a, y, s1) as number), VF.METAL);
      }
    // the boot: iron-shod, toe-capped, with a thick sole
    ell(sh, [X(4.8), 2.6, 0.8], [3.4, 2.7, 4.8], ironD, { fl: VF.METAL });
    ell(sh, [X(4.8), 2.3, 4.6], [3.0, 2.2, 1.8], iron, { fl: VF.METAL });
    for (let x = -3; x <= 3; x++) for (let z = -4; z <= 6; z++) if (sh.m.has(Math.floor(X(4.8)) + x, 0, z)) sh.m.set(Math.floor(X(4.8)) + x, 0, z, SOOT);
    rivet(sh, [X(4.8), 3.2, 5.9], [0, 0.2, 1], TRIM[0]);
    cutG(sh, (_x, y) => y < 0);
  }

  // ============================================================== arms: thick bones, knob joints, big fists
  for (const s1 of [1, -1]) {
    const X = (x: number) => s1 * x;
    const a = F.s(s1 > 0 ? 'arm_l' : 'arm_r');
    a.m.map.clear();
    ell(a, [X(SH[0]), SH[1] - 0.5, 0], [3.0, 3.0, 3.0], bone);
    limbG(a, [X(SH[0]), SH[1] - 1, 0], [X(EL[0]), EL[1] + 1.2, 0], (t) => 2.4 - 0.5 * t + Math.sin(t * Math.PI) * 0.4, bone);
    ell(a, [X(EL[0]), EL[1] + 0.6, 0], [2.5, 2.0, 2.4], boneD);
    const f = F.s(s1 > 0 ? 'fore_l' : 'fore_r');
    f.m.map.clear();
    ell(f, [X(EL[0]), EL[1] - 0.4, -0.4], [2.2, 2.0, 2.2], boneD); // olecranon
    limbG(f, [X(EL[0] - 0.8), EL[1] - 1, 0.4], [X(EL[0] + 0.4), 24, 0.8], () => 1.45, bone); // radius
    limbG(f, [X(EL[0] + 1), EL[1] - 1, -0.8], [X(EL[0] + 1.2), 24, -0.6], () => 1.3, boneD); // ulna
    // iron vambrace with leather straps
    for (let y = 25; y <= 30; y++)
      for (let k = 0; k < 28; k++) {
        const t = (k / 28) * Math.PI * 2;
        const r = 2.9 + (y === 25 || y === 30 ? 0.4 : 0);
        f.m.set(Math.floor(X(EL[0] + 0.3) + Math.cos(t) * r), y, Math.floor(Math.sin(t) * r), y === 27 ? LEATHER : y === 25 || y === 30 ? TRIM[1] : (ironD(k, y, s1) as number), y === 27 ? VF.SOLID : VF.METAL);
      }
    if (s1 > 0) {
      // the shield fist: a knuckled bone fist round the grip
      ell(f, [X(13.5), 21, 0.6], [2.9, 3.2, 2.8], bone);
      for (let k = 0; k < 4; k++) ell(f, [X(12.2 + k * 0.9), 19.2, 2.2], [0.7, 0.8, 0.8], boneD); // knuckles
      ell(f, [X(11), 22.4, 2.4], [0.9, 1.4, 0.9], bone); // thumb over the grip
    }
  }

  // ============================================================== the gatling arm (right)
  const gx = -13, gz = 0;
  const gt = F.part('gatling', 'fore_r', [gx + 0.5, 25.5, gz + 0.5]);
  cap(gt, [gx + 0.5, 27.5, gz + 0.5], [gx + 0.5, 15.5, gz + 0.5], 3.4, 3.1, iron, VF.METAL); // housing
  for (const y of [26, 21, 16]) for (let k = 0; k < 32; k++) {
    const t = (k / 32) * Math.PI * 2;
    gt.m.set(Math.floor(gx + 0.5 + Math.cos(t) * 3.7), y, Math.floor(gz + 0.5 + Math.sin(t) * 3.7), TRIM[0], VF.METAL);
  }
  // crank box and the ammo drum on the outside, a cartridge belt feeding in
  ell(gt, [gx - 2.6, 22, gz - 1.5], [1.8, 2.6, 2.2], ironD, { fl: VF.METAL });
  cap(gt, [gx - 4.4, 21.5, gz - 2.2], [gx - 7.4, 21.5, gz - 2.2], 3.6, 3.6, (x, y, z) => ((Math.round(Math.atan2(y - 21.5, z + 2.2) * 4) & 1) ? TRIM[0] : TRIM[1]), VF.METAL);
  ell(gt, [gx - 7.6, 21.5, gz - 2.2], [0.8, 1.6, 1.6], ironD, { fl: VF.METAL });
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const p: G = [gx - 4 + t * 2.2, 24.5 - Math.sin(t * Math.PI) * 1.4 + t * 1, gz + 2.2 + Math.sin(t * Math.PI) * 1.5];
    ell(gt, p, [0.55, 0.9, 0.55], TRIM[2], { fl: VF.METAL });
  }
  for (const y of [28, 29]) for (let k = 0; k < 30; k++) {
    const t = (k / 30) * Math.PI * 2;
    gt.m.set(Math.floor(gx + 0.5 + Math.cos(t) * 3.1), y, Math.floor(gz + 0.5 + Math.sin(t) * 3.1), LEATHER);
  }
  const br = F.part('barrels', 'gatling', [gx + 0.5, 15, gz + 0.5]);
  for (let k = 0; k < 6; k++) {
    const t = (k / 6) * Math.PI * 2;
    const bx = gx + 0.5 + Math.cos(t) * 2.1, bz = gz + 0.5 + Math.sin(t) * 2.1;
    cap(br, [bx, 15, bz], [bx, 3.2, bz], 0.85, 0.8, (x, y) => (y <= 4 ? SOOT : y % 4 === 0 ? 0x8a8d94 : 0x5a5d64), VF.METAL);
  }
  cap(br, [gx + 0.5, 15, gz + 0.5], [gx + 0.5, 4, gz + 0.5], 0.9, 0.9, METAL.iron[1], VF.METAL);
  for (const y of [11, 5]) ell(br, [gx + 0.5, y + 0.5, gz + 0.5], [3.4, 0.7, 3.4], y === 5 ? TRIM[1] : METAL.iron[0], { fl: VF.METAL });
  F.sock('muzzle', 'gatling', [gx + 0.5, 2.5, gz + 0.5]);

  // ============================================================== skull: cracked, a broken tooth (the helm hides most of it)
  const hd = F.s('head');
  for (const [x, y, z] of [[-4, 57, 4], [-3, 56, 5], [-3, 55, 5], [-2, 54, 6], [-4, 58, 3]] as G[]) if (hd.m.has(x, y, z)) hd.m.set(x, y, z, 0x4a3420);
  const jw = F.s('jaw');
  jw.m.forEach((x, y, z) => {
    if (x === 1 && y >= 44 && z >= 5) jw.m.del(x, y, z);
  });
  F.sock('hs_skull', 'head', [0, 52, 1]);

  // ============================================================== HELM (breakable)
  const HC: G = [-0.5, 52.6, -0.2];
  const hm = F.part('helm', 'head', [0, 46, 0]);
  ell(hm, HC, [8.2, 8.6, 8.2], iron, { fl: VF.METAL, keep: (lx, ly, lz) => ly > -0.2 || lz < 0.15 });
  ell(hm, HC, [7.0, 7.4, 7.0], 0, { carve: true });
  // open the face under the brow band, keep a nasal bar
  cutG(hm, (x, y, z) => z > HC[2] + 2.5 && y < 55.2 && y > 45 && !(Math.abs(x + 0.5) < 1.1 && y > 48.5));
  // brow band and a crest fin down the middle
  for (let k = -12; k <= 12; k++) {
    const t = (k / 12) * 1.35;
    for (const y of [55, 56]) hm.m.set(Math.floor(HC[0] + Math.sin(t) * 8.4), y, Math.floor(HC[2] + Math.cos(t) * 8.4), y === 56 ? TRIM[1] : (iron(k, y, 0) as number), VF.METAL);
  }
  for (let z = -8; z <= 6; z++) {
    const top = Math.floor(HC[1] + 8.6 * Math.sqrt(Math.max(0, 1 - ((z - HC[2]) / 8.4) ** 2)));
    for (let y = top; y <= top + 2 - (z < -5 ? 1 : 0); y++) hm.m.set(-1, y, z, ironD(-1, y, z) as number, VF.METAL).set(0, y, z, iron(0, y, z) as number, VF.METAL);
  }
  for (let k = -8; k <= 8; k += 2) {
    const t = (k / 12) * 1.35;
    rivet(hm, [HC[0] + Math.sin(t) * 8.9, 55.5, HC[2] + Math.cos(t) * 8.9], [Math.sin(t), 0, Math.cos(t)], TRIM[0]);
  }
  // the headlamp: a brass drum on the brow with a glowing lens
  cap(hm, [-0.5, 58.5, 6.4], [-0.5, 58.5, 9.6], 2.4, 2.6, TRIM[0], VF.METAL);
  ell(hm, [-0.5, 58.5, 9.9], [1.9, 1.9, 0.6], 0xfff0b0, { fl: VF.EMISSIVE | VF.GLOW });
  ell(hm, [-0.5, 61.2, 7.6], [1.2, 0.8, 1.6], SOOT, { fl: VF.METAL }); // lamp chimney
  F.sock('lamp', 'helm', [-0.5, 58.5, 10.4]);
  // bent rail-spike horns
  for (const s1 of [1, -1]) hornG(hm, [HC[0] + s1 * 7.4, 56.5, HC[2] - 1], [s1 * 1, 0.55, 0.15], 8.5, 1.5, (x, y, z) => (hash3(x, y, z) > 0.7 ? RUST : METAL.iron[1]), [s1 * -0.4, 1.3, 0], RUST_D);
  rustStreaks(hm, 5);
  F.sock('hs_helm', 'helm', [-0.5, 55, 0]);

  // ============================================================== PAULDRONS (breakable): red-painted left, bare and cracked right
  for (const s1 of [1, -1]) {
    const name = s1 > 0 ? 'pauldron_l' : 'pauldron_r';
    const pp = F.part(name, s1 > 0 ? 'arm_l' : 'arm_r', [s1 * SH[0], SH[1], 0]);
    const plate: CSpec = s1 > 0 ? paintC(PAINT, 13) : ironC(IRON, 17, 0.55);
    for (let i = 2; i >= 0; i--) {
      const c: G = [s1 * (SH[0] + 0.6 + i * 0.5), SH[1] + 2.4 - i * 2.6, -0.2];
      const r: G = [6.6 + i * 0.7, 4.4, 6.4 + i * 0.5];
      ell(pp, c, r, i === 0 ? plate : s1 > 0 ? (i === 1 ? plate : ironD) : ironD, { fl: VF.METAL, keep: (lx, ly) => ly > -0.15 && s1 * lx > -0.62 });
      ell(pp, c, [r[0] - 1.3, r[1] - 1.3, r[2] - 1.3], 0, { carve: true });
      // the rolled lower edge of each lame
      for (let k = 0; k < 36; k++) {
        const t = (k / 36) * Math.PI * 2;
        const lx = Math.cos(t);
        if (s1 * lx < -0.6) continue;
        const p: G = [c[0] + lx * r[0], c[1] - 0.2, c[2] + Math.sin(t) * r[2]];
        pp.m.set(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]), i === 0 ? TRIM[1] : METAL.iron[1], VF.METAL);
        if (k % 4 === 0) rivet(pp, [p[0], p[1] + 0.9, p[2]], [lx, 0.3, Math.sin(t)], TRIM[0]);
      }
    }
    // spike on the top lame
    hornG(pp, [s1 * (SH[0] + 1.6), SH[1] + 6.2, -0.4], [s1 * 0.35, 1, -0.1], 5.5, 1.3, s1 > 0 ? METAL.iron[1] : RUST, [s1 * 0.2, 0.1, 0]);
    if (s1 < 0) {
      // the right pauldron is cracked through, a length of chain hangs off it
      cutG(pp, (x, y, z) => Math.abs(x + 15.5 + (y - 41) * 0.35) < 0.7 && y > 38 && y < 46 && z > 0);
      const chain: G[] = [];
      for (let i = 0; i < 9; i++) chain.push([-(SH[0] + 6.2), SH[1] - 1 - i * 0.9, 3 - Math.sin(i * 0.5) * 1.5]);
      lineG(pp, chain, (t: number) => (Math.floor(t * 9) % 2 ? METAL.iron[2] : METAL.iron[1]));
    } else {
      // brass band and a stencilled number plate on the red lame
      ell(pp, [SH[0] + 6.4, SH[1] + 1.4, 1.6], [0.8, 1.6, 2.2], TRIM[0], { fl: VF.METAL });
      ell(pp, [SH[0] + 6.9, SH[1] + 1.4, 1.6], [0.4, 0.8, 1.2], 0x1e1a1a);
    }
    rustStreaks(pp, 7 + s1);
    F.sock(s1 > 0 ? 'hs_pl' : 'hs_pr', name, [s1 * (SH[0] + 1), SH[1] + 1.5, 0]);
  }

  // ============================================================== CHEST (breakable): boiler-plate cuirass with a firebox door
  const ch = F.part('chest', 'torso', [0, 37, 0]);
  const outer = (y: number) => {
    const q = cage(y);
    return { a: q.a + 1.6, f: q.f + 2.0, b: q.b, p: 2.3 };
  };
  sections(ch, 29, 43, outer, (x, y, z) => {
    const q = outer(y + 0.5);
    const zc = (q.f + q.b) / 2, zr = (q.f - q.b) / 2;
    if (z + 0.5 < zc + zr * 0.1) return null; // front half only
    const d = Math.pow(Math.abs(x + 0.5) / q.a, 2.3) + Math.pow(Math.abs(z + 0.5 - zc) / zr, 2.3);
    if (d < 0.72) return null; // a shell
    return y === 34 || y === 40 ? METAL.iron[1] : (iron(x, y, z) as number);
  }, VF.METAL);
  // rivets along the seams
  for (const y of [34, 40, 43])
    for (let x = -10; x <= 10; x += 3) {
      let z = -99;
      for (let k = 12; k > -2; k--) if (ch.m.has(x, y, k)) {
        z = k;
        break;
      }
      if (z > -99) rivet(ch, [x + 0.5, y + 0.5, z + 0.6], [0, 0, 1], TRIM[0]);
    }
  // firebox door: brass-rimmed round hatch, a glowing grate, hinges on the left, soot above
  const fz = (() => {
    for (let k = 14; k > 0; k--) if (ch.m.has(0, 37, k)) return k;
    return 8;
  })();
  for (let x = -5; x <= 4; x++)
    for (let y = 32; y <= 42; y++) {
      const dx = x + 0.5, dy = y + 0.5 - 37;
      const r = Math.hypot(dx, dy);
      if (r > 4.6) continue;
      const rim = r > 3.4;
      const slot = !rim && Math.abs(dy) < 2.6 && (y % 2 === 0);
      ch.m.set(x, y, fz + 1, rim ? (r > 4.1 ? TRIM[1] : TRIM[0]) : slot ? (hash3(x, y, 3) > 0.5 ? 0xffb040 : EMBER) : SOOT, slot ? VF.EMISSIVE | VF.GLOW : VF.METAL);
    }
  for (const y of [34, 40]) ell(ch, [-5.2, y + 0.5, fz + 1.2], [0.9, 0.9, 0.9], METAL.iron[1], { fl: VF.METAL });
  ell(ch, [3.4, 37.5, fz + 2], [0.7, 1.4, 0.7], TRIM[2], { fl: VF.METAL }); // latch
  for (let y = 42; y <= 44; y++) for (let x = -3; x <= 2; x++) if (ch.m.has(x, y, fz) || ch.m.has(x, y, fz - 1)) ch.m.set(x, y, ch.m.has(x, y, fz) ? fz : fz - 1, mix(SOOT, IRON, hash3(x, y, 1) * 0.4), VF.METAL);
  // pressure gauge: a brass cup with a white face and a red needle near the red line
  const gzF = fz;
  ell(ch, [-6.5, 41.5, gzF], [1.9, 1.9, 1.0], TRIM[0], { fl: VF.METAL });
  for (const [x, y] of [[-7, 41], [-7, 42], [-6, 41], [-6, 42], [-8, 41], [-6, 40], [-7, 40]] as [number, number][]) ch.m.set(x, y, gzF + 1, 0xeee6d2);
  ch.m.set(-6, 42, gzF + 2, 0xc81e1e).set(-5, 43, gzF + 1, 0xc81e1e);
  rustStreaks(ch, 11);

  // ============================================================== SMOKESTACK (back): a soot-black balloon stack
  const st = F.part('stack', 'torso', [3, 44, -12]);
  tube(st, [[3, 43, -12.5], [3.3, 48, -13.4], [3.8, 53, -14.6]], (t) => 1.9 + t * 0.5, (t: number) => (t > 0.45 && t < 0.52 ? TRIM[0] : mix(SOOT, IRON, hash3(Math.floor(t * 20), 1, 2) * 0.3)), VF.METAL);
  ell(st, [3.9, 55, -14.9], [3.6, 2.4, 3.6], SOOT, { fl: VF.METAL, keep: (_x, ly) => ly > -0.6 });
  ell(st, [3.9, 55.6, -14.9], [2.5, 2.2, 2.5], 0, { carve: true });
  for (let k = 0; k < 28; k++) {
    const t = (k / 28) * Math.PI * 2;
    st.m.set(Math.floor(3.9 + Math.cos(t) * 3.7), 56, Math.floor(-14.9 + Math.sin(t) * 3.7), TRIM[1], VF.METAL);
  }
  ell(st, [3.9, 54.6, -14.9], [2.1, 0.6, 2.1], EMBER, { fl: VF.EMISSIVE }); // the glow down the flue
  F.sock('smoke', 'stack', [3.9, 57, -14.9]);

  // ============================================================== SHIELD (breakable): the cow-catcher, sculpted in the guard frame
  // guard frame: elbow bent 90°, forearm pointing +Z at chest height, the shield standing in front of the fist.
  const gs = new Sc(new VoxelModel('cowcatcher'), 1);
  const SX = 8; // shield centre x (pulled in across the body)
  const zB = 13; // back plate
  // riveted backing plate
  for (let x = -3; x <= 19; x++)
    for (let y = 19; y <= 39; y++) {
      const bottom = 18 + Math.abs(x + 0.5 - SX) * 0.55;
      if (y < bottom) continue;
      gs.m.set(x, y, zB, ironD(x, y, zB) as number, VF.METAL).set(x, y, zB - 1, METAL.iron[1], VF.METAL);
    }
  // the V wedge of slanted bars
  for (let x = -2; x <= 18; x += 2) {
    const off = Math.abs(x + 0.5 - SX);
    const yb = 18 + off * 0.55;
    const zt = zB + 1.5, zb = zB + 3.4 + (11 - off) * 0.42;
    cap(gs, [x + 0.5, 39, zt], [x + 0.5, yb, zb], x === SX ? 1.25 : 0.85, x === SX ? 1.1 : 0.75, ironC(METAL.iron[1], x, 0.45), VF.METAL);
  }
  // braces across the bars
  for (const y of [33, 26]) {
    const pts: G[] = [];
    for (let x = -2; x <= 18.5; x += 1) {
      const off = Math.abs(x - SX);
      const k = (39 - y) / Math.max(1, 39 - (18 + off * 0.55));
      pts.push([x, y, zB + 1.5 + (zB + 3.4 + (11 - off) * 0.42 - zB - 1.5) * Math.min(1, k) + 0.6]);
    }
    tube(gs, pts, () => 0.7, TRIM[1], VF.METAL);
  }
  ell(gs, [SX + 0.5, 18.6, zB + 7.8], [1.3, 1.6, 1.3], TRIM[0], { fl: VF.METAL }); // brass tip
  // red bumper beam with iron end caps, a brass stripe and the knuckle coupler
  for (let x = -4; x <= 20; x++)
    for (let y = 39; y <= 43; y++)
      for (let z = zB - 1; z <= zB + 3; z++) {
        const cap0 = x <= -3 || x >= 19;
        gs.m.set(x, y, z, cap0 ? METAL.iron[1] : y === 41 && z === zB + 3 ? TRIM[0] : (paintC(PAINT, 21)(x, y, z) as number), VF.METAL);
      }
  for (const x of [-3, 19]) for (const y of [40, 42]) rivet(gs, [x + 0.5, y + 0.5, zB + 4], [0, 0, 1], TRIM[0]);
  cap(gs, [SX + 0.5, 41, zB + 3.5], [SX + 0.5, 41, zB + 6.5], 1.4, 1.2, METAL.iron[1], VF.METAL);
  ell(gs, [SX + 0.5, 41, zB + 7], [2.2, 1.6, 1.4], ironD, { fl: VF.METAL });
  cutG(gs, (x, y, z) => x > SX - 0.2 && x < SX + 1.2 && y > 40.6 && z > zB + 6.6); // the knuckle's jaw
  // dents and a bent bar
  for (const [x, y] of [[2, 30], [15, 24], [11, 35]] as [number, number][]) gs.m.del(x, y, zB);
  // straps behind, round the fist
  for (let y = 30; y <= 34; y++) for (let x = 11; x <= 16; x++) if (y === 30 || y === 34 || x === 11 || x === 16) gs.m.set(x, y, zB - 2, LEATHER);
  rustStreaks(gs, 23);
  // rotate into the rest frame (forearm hanging): guard (x, y, z) → rest (x, 31 - z, y - 32) about the elbow (·, 32, 0)
  const shd = F.part('shield', 'fore_l', [13.5, 20.5, 0.5]);
  gs.m.forEach((x, y, z, c, f) => shd.m.set(x, 31 - z, y - 32, c, f));
  F.sock('hs_shield', 'shield', [SX + 0.5, 31 - 16, 31 - 32]);
  F.sock('shield_front', 'shield', [SX + 0.5, 31 - 22, 30 - 32]);

  // ============================================================== hit-sphere sockets on the body
  F.sock('hs_pelvis', 'pelvis', [0, 24, -1]);
  F.sock('hs_thigh_l', 'thigh_l', [HIP[0], 19.5, 0]);
  F.sock('hs_thigh_r', 'thigh_r', [-HIP[0], 19.5, 0]);
  F.sock('hand_l', 'fore_l', [13.5, 20.5, 0.5]);

  finish(F, { skip: ['eye_l', 'eye_r'] });
  let top = 0;
  for (const n of ['helm', 'stack', 'pauldron_l', 'pauldron_r']) F.m(n).forEach((_x, y) => (top = Math.max(top, y + 1)));
  const spec = F.build(`ironclad_${T}`, figMeta(F, 'ironclad', {
    tier: T,
    boss: true,
    height: top * F.vs,
    radius: 0.62,
    defaultExpression: 'angry',
    expressions: defaultExpressions(BOSS_EXPR),
    plates: ['helm', 'pauldron_l', 'pauldron_r', 'chest', 'shield'],
  }));
  // the shield arm stands in guard: elbow bent 90° (the cow-catcher upright in front)
  const fl = spec.parts.find((p) => p.name === 'fore_l');
  if (fl) fl.rest = [-Math.PI / 2, 0, 0];
  const fr = spec.parts.find((p) => p.name === 'fore_r');
  if (fr) fr.rest = [-0.25, 0, 0];
  return rescaleRig(spec, IRONCLAD_VS);
}
