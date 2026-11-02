// Humanoid enemy variants (STYLE v2), all built on the shared toon humanoid kit
// so they share Sundown's family look: big cream skulls with square sockets,
// skinny knobby bones, chunky fists and boots, clean small-palette outfits.
// Rig space: 1/30 m, origin on the ground, faces +Z, mirror plane = column 0.
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import {
  buildHumanoid, skeletonParts, mirrored, toonSkull, toonHand, boneUpperArm, boneForearm, boneShin, cowboyBoot, pantLeg, clothTorso,
  defaultExpressions, ExtraPart, HumanoidParts,
} from '../toon/humanoid';
import type { VariantOpts } from './kit';
import {
  W, ramp, both, paint, paintIf, carve, ball, line, ring, tilted, flatHat, cowHat, bowler, sombreroHat, minerHelmet, jacket, trousersTop, sheath,
  maskBandana, revolverDown, rifleDown, shotgunDown, dynamiteBundle, roundBox, autoShade, VF, TOON, Ramp,
} from './wear';

const HAND_L: V3 = [8.5, 16.5, 0.5];
const HAND_R: V3 = [-7.5, 16.5, 0.5];
const EXPR = defaultExpressions(['neutral', 'angry', 'hurt', 'surprised', 'laugh', 'dead', 'stunned', 'happy']);
const SPARK = { base: 0xffd24a, hi: 0xfff6b0, shade: 0xff8a2a };
const huskDark = ramp(0x8e7a5e, 0x725f46, 0xa69072, 0x4e3e2c);

function finish(name: string, P: HumanoidParts, extra: ExtraPart[], o: { topY?: number; radius?: number; sockets?: Record<string, { part: string; at: V3 }>; meta?: Record<string, unknown> } = {}): RigSpec {
  return buildHumanoid({ name, parts: P, extra, topY: o.topY ?? 52, radius: o.radius ?? 0.3, expressions: EXPR, sockets: o.sockets, meta: o.meta });
}
/** rebuild right-side limbs from the (edited) left ones */
function mirrorArms(P: HumanoidParts, fore = true) {
  P.arm_r = mirrored(P.arm_l, 'arm_r');
  if (fore) P.fore_r = mirrored(P.fore_l, 'fore_r');
}
function mirrorLegs(P: HumanoidParts) {
  P.thigh_r = mirrored(P.thigh_l, 'thigh_r');
  P.shin_r = mirrored(P.shin_l, 'shin_r');
}
/** little cartoon spark (emissive, tiny) */
function spark(m: VoxelModel, x: number, y: number, z: number) {
  m.set(x, y, z, SPARK.base, VF.EMISSIVE).set(x + 1, y, z, SPARK.hi, VF.EMISSIVE).set(x, y + 1, z, SPARK.shade, VF.EMISSIVE).set(x - 1, y + 1, z, SPARK.hi, VF.EMISSIVE);
}
/** shins with cowboy boots under bare bones */
function bootShin(boot: Ramp, spur: Ramp | null = TOON.silver, top = 6) {
  return boneShin({ foot: (m) => cowboyBoot(m, { ramp: boot, spur, shaftTop: top }) });
}
/** ragged hem: knock out a regular pattern of voxels on the lowest row */
function tatter(m: VoxelModel, y: number) {
  m.forEach((x, yy, z) => {
    if (yy === y && ((x * 5 + z * 3) & 3) === 0) m.del(x, yy, z);
  });
}

// ============================================================================ BOMBER HUSK
export function bomberHuskRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const skin = a ? huskDark : TOON.husk;
  const P = skeletonParts({ ramp: skin, skull: { mouth: 'grin', crack: a }, handL: { pose: 'open' }, handR: { pose: 'open' } });
  // ragged undershirt, open at the front so the ribs peek out
  jacket(P.torso, TOON.linen, { openFront: 3, tatter: true });
  // dynamite bundle strapped to the chest
  dynamiteBundle(P.torso, a ? 5 : 4, 25, 31, 5);
  // strap over the left shoulder
  for (let y = 26; y <= 34; y++) P.torso.set(5, y, 5, TOON.leatherDark.base);
  for (let z = -6; z <= 5; z++) P.torso.set(5, 35, z, TOON.leatherDark.base);
  if (a) {
    // TNT keg on the back
    roundBox(P.torso, -5, 23, -12, 5, 35, -7, W.barrel.base, 2);
    for (const y of [24, 29, 34]) paint(P.torso, -5, y, -12, 5, y, -7, TOON.iron.base);
    roundBox(P.torso, -3, 27, -13, 3, 31, -13, TOON.red.base, 0);
    for (const [x, y] of [[-1, 30], [1, 30], [0, 29], [-1, 28], [1, 28]]) P.torso.set(x, y, -14, TOON.bone.hi);
    // red war paint under the eyes
    for (const x of [3, 4]) both(P.head, x, 41, 6, TOON.setRed.base);
  }
  autoShade(P.torso, [TOON.linen]);
  // shorts + rope belt, bare husk shins
  trousersTop(P.pelvis, TOON.denim, W.rope.base);
  P.thigh_l = pantLeg('thigh', TOON.denim, { patch: TOON.linen });
  tatter(P.thigh_l, 12);
  mirrorLegs(P);
  P.hat = minerHelmet(a ? ramp(0xc8402e, 0xa02c20, 0xe86a50, 0x6a1810) : W.helmet);
  if (a) {
    // horns bolted to the helmet
    for (const s of [1, -1]) line(P.hat, [[s * 7, 51, -1], [s * 9, 53, -1], [s * 10, 56, -2], [s * 10, 58, -3]], (t) => (t > 0.7 ? TOON.bone.hi : TOON.bone.base), 0.5);
  }
  // fuse out of the bundle, curling over the left collarbone
  const fuse = new VoxelModel('fuse');
  line(fuse, [[1, 32, 6], [3, 33, 7], [5, 34, 7], [7, 35, 6], [9, 36, 4], [10, 38, 3]], W.rope.base);
  spark(fuse, 10, 39, 3);
  return finish(a ? 'bomber_husk_alpha' : 'bomber_husk', P, [{ name: 'fuse', model: fuse, parent: 'torso', joint: [1.5, 32, 6.5] }], {
    topY: a ? 58 : 55,
    radius: 0.32,
    sockets: { fuse_tip: { part: 'fuse', at: [10.5, 39.5, 3.5] } },
  });
}

// ============================================================================ CACTUS HUSK
function cactusLimb(m: VoxelModel, pts: [number, number, number][], th: number) {
  const C = TOON.cactus;
  line(m, pts, C.base, th);
}
/** vertical rib stripes + regular spines on everything cactus-green */
function cactusFinish(m: VoxelModel) {
  const C = TOON.cactus;
  paintIf(m, (x, y, z, c) => c === C.base && ((x + z) & 1) === 1, C.shade);
  const spines: [number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    if (c !== C.base && c !== C.shade) return;
    if ((y % 3) !== 0 || ((x * 7 + z * 5 + y) % 4) !== 0) return;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!m.has(x + dx, y, z + dz)) spines.push([x + dx, y, z + dz]);
  });
  for (const [x, y, z] of spines) m.set(x, y, z, TOON.linen.hi);
}
function flower(m: VoxelModel, x: number, y: number, z: number, petal: Ramp = TOON.flower) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) m.set(x + dx, y, z + dz, petal.base);
  m.set(x, y, z, TOON.gold.base).set(x, y + 1, z, TOON.gold.hi);
}
export function cactusHuskRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const P = skeletonParts({ ramp: a ? huskDark : TOON.husk, skull: { mouth: 'smile' }, handL: { pose: 'open' }, handR: { pose: 'open' } });
  // faded red prospector long-johns, buttoned
  const longJ = ramp(0xb0503a, 0x8c3c2c, 0xc8684e, 0x5e2418);
  jacket(P.torso, longJ, { tatter: true });
  for (let y = 25; y <= 33; y += 3) P.torso.set(0, y, 5, TOON.bone.hi);
  // the saguaro that grew out of his back
  const C = TOON.cactus;
  const tw = a ? 3 : 2;
  roundBox(P.torso, -tw, 22, -11 - tw, tw, a ? 60 : 56, -7, C.base, 1);
  roundBox(P.torso, -tw + 1, a ? 61 : 57, -10 - tw, tw - 1, a ? 61 : 57, -8, C.base, 0);
  cactusLimb(P.torso, [[tw + 1, 36, -9], [9, 36, -9], [11, 37, -9], [11, 49, -9]], 1);
  cactusLimb(P.torso, [[-tw - 1, 30, -9], [-9, 30, -9], [-11, 31, -9], [-11, 41, -9]], 1);
  if (a) cactusLimb(P.torso, [[tw + 1, 26, -9], [7, 26, -9], [8, 27, -9], [8, 32, -9]], 1);
  cactusFinish(P.torso);
  flower(P.torso, 0, a ? 62 : 58, -9);
  flower(P.torso, 11, 51, -9, a ? TOON.flower : ramp(0xf8e070, 0xd8b840, 0xfff4a8, 0x9a7a20));
  if (a) flower(P.torso, -11, 43, -9);
  // prickly-pear pad on the right shoulder
  for (let y = 33; y <= 39; y++)
    for (let z = -3; z <= 2; z++) if (((y - 36) * (y - 36)) / 12 + ((z + 0.5) * (z + 0.5)) / 8 <= 1) P.torso.set(-8, y, z, C.base).set(-9, y, z, C.shade);
  for (const [y, z] of [[35, -2], [37, 1], [38, -1]]) P.torso.set(-10, y, z, TOON.linen.hi);
  autoShade(P.torso, [longJ]);
  // little flower on the skull (he's a romantic)
  flower(P.head, 4, 52, 1);
  if (a) {
    // cactus sprouts for a crown
    for (const [x, z] of [[-3, 0], [3, -2], [0, 3]]) roundBox(P.head, x - 1, 51, z - 1, x, 55, z, C.base, 0);
    cactusFinish(P.head);
  }
  // patched trousers + rope belt
  trousersTop(P.pelvis, TOON.denim, W.rope.base);
  P.thigh_l = pantLeg('thigh', TOON.denim, { patch: longJ });
  P.shin_l = pantLeg('shin', TOON.denim);
  tatter(P.shin_l, 3);
  // bare husk feet under the cuffs
  roundBox(P.shin_l, 2, 0, -2, 5, 2, 3, (a ? huskDark : TOON.husk).base, 1);
  mirrorLegs(P);
  // cactus nubs on the forearms
  roundBox(P.fore_l, 10, 21, -1, 11, 23, 0, C.base, 0);
  P.fore_l.set(12, 22, 0, TOON.linen.hi);
  P.fore_r = mirrored(P.fore_l, 'fore_r');
  return finish(a ? 'cactus_husk_alpha' : 'cactus_husk', P, [], { topY: a ? 63 : 59, radius: 0.34 });
}

// ============================================================================ DUNG SKELETON
function dungBall(m: VoxelModel, cx: number, cy: number, cz: number, r: number) {
  const D = TOON.dung;
  ball(m, cx, cy, cz, r, D.base);
  // a few deliberate darker clumps + straw bits
  for (const [dx, dy, dz] of [[0.5, 0.6, 0.6], [-0.7, -0.2, 0.5], [0.2, -0.7, -0.6], [-0.4, 0.5, -0.7]]) ball(m, cx + dx * r * 0.85, cy + dy * r * 0.85, cz + dz * r * 0.85, r * 0.32, D.shade);
  ball(m, cx, cy, cz, r - 0.6, D.base);
  for (const [dx, dy, dz] of [[0.9, 0.3, 0.1], [-0.2, 0.95, 0.1], [0.1, 0.2, 0.97]]) m.set(Math.round(cx + dx * r), Math.round(cy + dy * r), Math.round(cz + dz * r), W.straw.hi);
  autoShade(m, [D], { hi: false });
}
function flies(m: VoxelModel, spots: [number, number, number][]) {
  for (const [x, y, z] of spots) {
    m.set(x, y, z, TOON.black.base);
    m.set(x - 1, y + 1, z, 0xe8f2ff).set(x + 1, y + 1, z, 0xe8f2ff);
  }
}
export function dungSkeletonRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const ballHead = (o.variant ?? 0) === 1;
  const D = TOON.dung;
  const P = skeletonParts({ skull: { mouth: 'grin' }, handL: { pose: 'open' }, handR: { pose: 'fist' } });
  // dung "boots": feet and lower shins caked
  paintIf(P.shin_l, (x, y) => y <= 6, D.base);
  roundBox(P.shin_l, 2, 0, -3, 5, 2, 4, D.base, 1);
  P.shin_l.set(3, 3, 1, D.hi).set(4, 3, -2, D.shade);
  mirrorLegs(P);
  // dung diaper (yes): a ring of clean lumps around the hips
  const lumps = new VoxelModel();
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2;
    ball(lumps, Math.round(Math.sin(t) * 5), 20 + (i % 2), Math.cos(t) * 3.6 - 0.5, 2.9, D.base);
  }
  ball(lumps, 0, 17, 0, 3.2, D.base);
  for (const [x, y, z] of [[3, 22, 3], [-4, 21, -3], [5, 19, 1]] as [number, number, number][]) lumps.set(x, y + 2, z, D.hi);
  lumps.forEach((x, y, z, c, f) => P.pelvis.set(x, y, z, c, f));
  autoShade(P.pelvis, [D], { hi: false });
  // smear on the ribs
  paintIf(P.torso, (x, y, z) => x >= 2 && x <= 5 && y >= 25 && y <= 28 && z >= 2, D.base);
  if (ballHead) {
    // his head IS a dung ball. Sockets + grin carved in.
    const h = new VoxelModel('head');
    dungBall(h, 0, 45, 0, 7.6);
    for (const s of [1, -1]) {
      for (let i = 2; i <= 5; i++)
        for (let y = 42; y <= 45; y++) {
          for (let z = 5; z <= 9; z++) h.del(s * i, y, z);
          h.set(s * i, y, 4, TOON.socket.dark);
        }
    }
    for (let x = -4; x <= 4; x++) {
      for (let z = 4; z <= 9; z++) if (h.has(x, 40, z + 1) === false && h.has(x, 40, z)) h.set(x, 40, z, Math.abs(x) % 2 ? TOON.bone.shade : TOON.bone.hi);
    }
    P.head = h;
    P.brow_l = undefined;
    P.brow_r = undefined;
  } else {
    // splat on the skull top with a drip
    const splat = new VoxelModel();
    ball(splat, 1, 51, -1, 3.6, D.base, undefined, 0.7);
    ball(splat, -2, 51, 1, 2.6, D.base, undefined, 0.7);
    ball(splat, 2, 53, -1, 1.8, D.base);
    for (let y = 46; y <= 50; y++) splat.set(6, y, 0, D.base);
    splat.set(6, 45, 0, D.hi).set(2, 55, -1, D.hi);
    autoShade(splat, [D], { hi: false });
    splat.forEach((x, y, z, c, f) => P.head.set(x, y, z, c, f));
    // clothespin on the nose
    for (const x of [-1, 1]) for (let y = 39; y <= 43; y++) P.head.set(x, y, 7, W.straw.base);
    P.head.set(0, 41, 7, TOON.silver.base).set(0, 41, 8, TOON.silver.hi);
  }
  if (a) {
    // King Dung: little gold crown + dung pauldrons
    const cr = new VoxelModel('hat');
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 4; z++) if (Math.abs(x) === 5 || z === -5 || z === 4) cr.set(x, 52, z, TOON.gold.base, VF.METAL).set(x, 53, z, TOON.gold.hi, VF.METAL);
    for (const [x, z] of [[-5, 4], [0, 4], [5, 4], [-5, -5], [5, -5], [0, -5]]) cr.set(x, 54, z, TOON.gold.hi, VF.METAL);
    cr.set(0, 53, 5, TOON.setRed.base);
    P.hat = cr;
    for (const s of [1, -1]) {
      const sp = new VoxelModel();
      ball(sp, s * 7, 34, -1, 3.2, D.base);
      sp.forEach((x, y, z, c, f) => P.torso.set(x, y, z, c, f));
    }
    autoShade(P.torso, [D], { hi: false });
  }
  // the flies (and their stink lines)
  const fl = new VoxelModel('flies');
  flies(fl, a ? [[10, 52, 3], [-11, 49, -2], [6, 57, -4], [-6, 56, 5], [12, 46, -1], [-9, 55, -6], [3, 59, 2]] : [[10, 52, 3], [-11, 49, -2], [6, 56, -4], [-6, 55, 5], [12, 46, -1]]);
  const stink = ramp(0xa8c86a, 0x88a84a, 0xc8e490, 0x587a2a);
  line(fl, [[-3, 54, 0], [-4, 55, 0], [-3, 56, 0], [-4, 57, 0]], stink.base);
  line(fl, [[3, 55, -1], [4, 56, -1], [3, 57, -1], [4, 58, -1]], stink.base);
  // the ammunition
  const bl = new VoxelModel('ball');
  dungBall(bl, -7, 11, 3, a ? 5.2 : 4.2);
  const name = ballHead ? 'dung_skeleton_ballhead' : a ? 'dung_skeleton_alpha' : 'dung_skeleton';
  return finish(name, P, [
    { name: 'flies', model: fl, parent: 'head', joint: [0.5, 38, -2] },
    { name: 'ball', model: bl, parent: 'fore_r', joint: HAND_R },
  ], { topY: a ? 55 : 53 });
}

// ============================================================================ MARIACHI
export function mariachiRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const trim = a ? TOON.gold : TOON.silver;
  const C = W.charro;
  const P = skeletonParts({ skull: { mouth: 'grin' }, handL: { pose: 'fist' }, handR: { pose: 'open' } });
  // white shirt, then a short black bolero over it with studded edges
  jacket(P.torso, TOON.linen, {});
  jacket(P.torso, C, { y0: 28, openFront: 4 });
  for (let y = 28; y <= 33; y += 2) both(P.torso, 4, y, 4, trim.base, VF.METAL);
  for (let x = 4; x <= 7; x += 2) for (const z of [4, -6]) both(P.torso, x, 28, z, trim.base, VF.METAL);
  // red bow tie
  const red = TOON.red;
  for (let x = -3; x <= 3; x++)
    for (let y = 32; y <= 35; y++) {
      const ax = Math.abs(x);
      if (ax === 0 ? y === 33 || y === 34 : Math.abs(y - 33.5) <= ax * 0.6 + 0.2) P.torso.set(x, y, 5, ax === 0 ? red.shade : ax === 3 ? red.hi : red.base);
    }
  if (a) {
    // crossed bandoliers with brass rounds
    for (let i = 0; i <= 9; i++) {
      P.torso.set(-6 + i, 24 + i, 5, TOON.leatherDark.base);
      P.torso.set(6 - i, 24 + i, 6, TOON.leatherDark.base);
      if (i % 2) P.torso.set(-6 + i, 24 + i, 6, TOON.brass.hi, VF.METAL);
    }
  }
  autoShade(P.torso, [C, TOON.linen]);
  // sleeves
  sheath(P.arm_l, 6, 10, 26, 33, -2, 2, C);
  for (let y = 27; y <= 33; y += 2) P.arm_l.set(11, y, 0, trim.base, VF.METAL);
  sheath(P.fore_l, 6, 10, 19, 24, -2, 2, C, TOON.linen.base);
  P.fore_l.set(11, 21, 0, trim.base, VF.METAL);
  autoShade(P.arm_l, [C]);
  P.arm_r = mirrored(P.arm_l, 'arm_r');
  const foreR = boneForearm({ pose: 'open' });
  sheath(foreR, 6, 10, 19, 24, -2, 2, C, TOON.linen.base);
  P.fore_r = mirrored(foreR, 'fore_r');
  // handlebar mustache
  for (let x = -4; x <= 4; x++) P.head.set(x, 40, 7, W.mustache.base).set(x, 39, 7, Math.abs(x) <= 2 ? W.mustache.base : W.mustache.shade);
  for (const s of [1, -1]) P.head.set(s * 5, 40, 7, W.mustache.base).set(s * 6, 41, 7, W.mustache.base).set(s * 6, 42, 7, W.mustache.hi);
  P.head.set(0, 40, 7, W.mustache.hi);
  // charro trousers with stud rows, black boots
  trousersTop(P.pelvis, C, a ? TOON.gold.base : TOON.red.base);
  P.thigh_l = pantLeg('thigh', C);
  for (let y = 13; y <= 19; y += 2) P.thigh_l.set(6, y, -1, trim.base, VF.METAL);
  P.shin_l = pantLeg('shin', C);
  cowboyBoot(P.shin_l, { ramp: TOON.black, spur: trim, shaftTop: 5 });
  for (let y = 7; y <= 11; y += 2) P.shin_l.set(6, y, -1, trim.base, VF.METAL);
  mirrorLegs(P);
  P.hat = sombreroHat(C, a ? TOON.gold : TOON.red, a ? 17 : 15);
  // the guitar (guitarrón for the alpha): body bottom-right, neck up to the left shoulder
  const g = new VoxelModel('guitar');
  const k = a ? 1.18 : 1;
  const wood = a ? ramp(0x8a5430, 0x6c3e22, 0xa86c40, 0x46280e) : TOON.wood;
  const ang = 0.6;
  tilted(g, -3, 21, 7, 8, ang, 26, (u, v) => {
    const lower = Math.hypot(u, v) <= 5.3 * k;
    const upper = Math.hypot(u - 6 * k, v) <= 4.2 * k;
    if (lower || upper) {
      const rim = Math.hypot(u, v) > 4.4 * k && Math.hypot(u - 6 * k, v) > 3.3 * k;
      if (Math.hypot(u - 4 * k, v) <= 1.6 * k) return TOON.black.base;
      if (u > -2.6 * k && u < -1.4 * k && Math.abs(v) <= 2) return wood.dark;
      return rim ? wood.dark : wood.base;
    }
    if (u >= 9 * k && u <= 21 * k && Math.abs(v) <= 1) return TOON.leatherDark.base;
    if (u > 21 * k && u <= 24.5 * k && Math.abs(v) <= 1.6) return wood.dark;
    return null;
  });
  // back plate + strings
  tilted(g, -3, 21, 6, 6, ang, 26, (u, v) => (Math.hypot(u, v) <= 5.3 * k - 0.5 || Math.hypot(u - 6 * k, v) <= 4.2 * k - 0.5 ? wood.shade : null));
  tilted(g, -3, 21, 9, 9, ang, 26, (u, v) => (Math.abs(v) < 0.5 && u > -2 * k && u < 22 * k ? TOON.linen.hi : null));
  return finish(a ? 'mariachi_alpha' : 'mariachi', P, [{ name: 'guitar', model: g, parent: 'torso', joint: [0.5, 26, 6.5] }], { topY: 61, radius: 0.32 });
}

// ============================================================================ SHARPSHOOTER
export function sharpshooterRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const coat = a ? ramp(0x3a3446, 0x2a2534, 0x4e475c, 0x1a1622) : ramp(0x5a4a3e, 0x46382e, 0x726050, 0x2c221a);
  const P = skeletonParts({ skull: { mouth: 'grin', crack: true }, handL: { pose: 'fist' }, handR: { pose: 'fist' } });
  // long rider coat: jacket + collar, stiff skirt below the waist
  jacket(P.torso, coat, { openFront: 2 });
  for (let x = -5; x <= 5; x++) for (let z = -6; z <= -3; z++) P.torso.set(x, 35, z, coat.shade);
  // bandolier
  for (let i = 0; i <= 10; i++) {
    P.torso.set(-6 + i, 24 + i, 5, TOON.leatherDark.base);
    if (i % 2 === 0) P.torso.set(-6 + i, 24 + i, 6, TOON.brass.hi, VF.METAL);
  }
  if (a) {
    // trophy cord of tiny skulls
    for (const [x, y] of [[-3, 31], [0, 30], [3, 31]]) {
      roundBox(P.torso, x - 1, y - 1, 6, x + 1, y + 1, 6, TOON.bone.base, 1);
      P.torso.set(x, y, 7, TOON.socket.dark);
    }
  }
  autoShade(P.torso, [coat]);
  sheath(P.arm_l, 6, 10, 26, 33, -2, 2, coat);
  sheath(P.fore_l, 6, 10, 19, 24, -2, 2, coat, coat.dark);
  mirrorArms(P);
  const skirt = new VoxelModel('coat');
  for (let y = 9; y <= 23; y++) {
    const hx = y <= 14 ? 8 : 7, zb = y <= 14 ? -7 : -6;
    for (let x = -hx; x <= hx; x++)
      for (let z = zb; z <= 4; z++) {
        const shell = Math.abs(x) === hx || z === zb;
        if (!shell || (Math.abs(x) === hx && (z === zb || z > 2))) continue;
        skirt.set(x, y, z, y === 9 ? coat.shade : coat.base);
      }
  }
  for (let y = 9; y <= 15; y++) skirt.del(0, y, -7);
  autoShade(skirt, [coat], { under: false });
  // red bandana mask
  if (P.jaw) maskBandana(P.jaw, a ? TOON.black : TOON.red);
  // eyepatch over the right eye (only the left eye gets a 2D eye)
  for (let x = -6; x <= -1; x++) for (let y = 41; y <= 46; y++) P.head.set(x, y, 6, TOON.black.base);
  P.head.set(-3, 44, 7, TOON.black.hi);
  for (const [x, y, z] of [[0, 46, 6], [1, 47, 6], [2, 47, 6], [3, 48, 6], [4, 48, 6], [5, 48, 6], [6, 48, 6], [7, 48, 5], [8, 48, 3]] as [number, number, number][]) P.head.set(x, y, z, TOON.black.base);
  P.eye_r = undefined;
  P.hat = flatHat(a ? TOON.black : W.felt, a ? TOON.setRed.base : TOON.red.base, { rx: 13.5, rz: 12.5, crownH: 5 });
  if (a) line(P.hat, [[8, 50, -2], [10, 53, -3], [11, 57, -4]], TOON.setRed.base, 0.5);
  // boots
  P.shin_l = bootShin(TOON.leatherDark);
  mirrorLegs(P);
  const gun = rifleDown(-8, a);
  return finish(a ? 'sharpshooter_alpha' : 'sharpshooter', P, [
    { name: 'coat', model: skirt, parent: 'pelvis', joint: [0.5, 23.5, -5.5] },
    { name: 'gun', model: gun, parent: 'fore_r', joint: HAND_R },
  ], { topY: 55, radius: 0.3, sockets: { muzzle: { part: 'gun', at: [-7, -15.5, 1.5] } } });
}

// ============================================================================ SHOTGUNNER
export function shotgunnerRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const P = skeletonParts({ skull: { mouth: 'grin' }, handL: { pose: 'fist' }, handR: { pose: 'fist' } });
  // the barrel he wears for trousers
  const B = W.barrel;
  for (let y = 10; y <= 25; y++) {
    const r = 10 - ((y - 17.5) / 7.5) ** 2 * 1.6;
    for (let x = -11; x <= 11; x++)
      for (let z = -11; z <= 11; z++) {
        const d = Math.hypot(x, z + 0.5);
        if (d > r || d <= r - 1.5) continue;
        const stave = Math.floor(((Math.atan2(z + 0.5, x) + Math.PI) / (Math.PI * 2)) * 18) & 1;
        const hoop = y === 11 || y === 17 || y === 18 || y === 24;
        P.pelvis.set(x, y, z, hoop ? (a ? TOON.iron.hi : TOON.iron.base) : stave ? B.base : B.shade, hoop ? VF.METAL : undefined);
      }
  }
  if (a) {
    // studded with spikes + a painted danger band
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      const x = Math.round(Math.cos(t) * 10.5), z = Math.round(Math.sin(t) * 10.5 - 0.5);
      P.pelvis.set(x, 17, z, TOON.silver.hi, VF.METAL);
    }
    paintIf(P.pelvis, (x, y, z) => y >= 20 && y <= 21 && z > 6, TOON.red.base);
  }
  autoShade(P.pelvis, [B], { hi: false });
  // suspenders over the bare ribs
  const sus = a ? TOON.black : TOON.red;
  for (const s of [1, -1]) {
    for (let y = 24; y <= 33; y++) both(P.torso, 3, y, 4, sus.base);
    for (let z = -5; z <= 4; z++) both(P.torso, 3, 34, z, sus.base);
    for (let y = 24; y <= 33; y++) both(P.torso, 3, y, -6, sus.base);
    both(P.torso, 3, 25, 5, TOON.brass.hi, VF.METAL);
    void s;
  }
  // walrus mustache
  const st = W.greyStache;
  for (let x = -5; x <= 5; x++) P.head.set(x, 40, 7, Math.abs(x) <= 1 ? st.hi : st.base).set(x, 39, 7, st.base);
  for (const s of [1, -1]) P.head.set(s * 5, 38, 7, st.shade).set(s * 5, 37, 7, st.shade).set(s * 4, 38, 7, st.base);
  P.hat = bowler(a ? TOON.black : W.feltBrown, a ? TOON.setRed.base : TOON.leatherDark.base);
  if (a) for (let i = 0; i < 3; i++) roundBox(P.hat, 5 + i, 50, 6 - i, 5 + i, 54, 6 - i, W.stick.base, 0);
  P.shin_l = bootShin(TOON.leather);
  mirrorLegs(P);
  const gun = shotgunDown(-10, a);
  return finish(a ? 'shotgunner_alpha' : 'shotgunner', P, [{ name: 'gun', model: gun, parent: 'fore_r', joint: HAND_R }], {
    topY: 57,
    radius: 0.36,
    sockets: { muzzle: { part: 'gun', at: [-8.5, -2.5, 0.5] } },
  });
}

// ============================================================================ TUMBLEWEED BANDIT
export function tumbleweedBanditRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const P = skeletonParts({ skull: { mouth: 'grin' }, handL: { pose: 'fist' }, handR: { pose: 'fist' } });
  // classic bandit mask across the eyes (sockets stay open)
  for (let x = -7; x <= 7; x++)
    for (let y = 41; y <= 46; y++) {
      const inSock = Math.abs(x) >= 2 && Math.abs(x) <= 5 && y >= 42 && y <= 45;
      if (!inSock) P.head.set(x, y, 7, TOON.black.base);
    }
  for (let y = 41; y <= 46; y++) for (let z = -7; z <= 6; z++) both(P.head, 8, y, z, TOON.black.base);
  for (let x = -7; x <= 7; x++) for (let y = 43; y <= 44; y++) P.head.set(x, y, -8, TOON.black.base);
  P.head.set(0, 42, -9, TOON.black.base).set(1, 41, -9, TOON.black.base).set(0, 40, -9, TOON.black.hi);
  if (a && P.jaw) maskBandana(P.jaw, TOON.red);
  P.hat = flatHat(W.felt, TOON.silver.base, { rx: 11.5, rz: 10.5, crownH: 4 });
  P.shin_l = bootShin(TOON.leatherDark);
  mirrorLegs(P);
  // the disguise: a woven tumbleweed around the whole middle
  const wd = new VoxelModel('weed');
  const R = a ? 14.5 : 13.5;
  const rings: [number, number, number][] = a
    ? [[1, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, -1], [0, 1, 0], [1, 1.2, 0], [-1, 1.2, 0]]
    : [[1, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, -1], [0, 1, 0], [0, 1.2, 1]];
  rings.forEach((n, i) => ring(wd, [0, 25, 0], n, R, 0.8, i % 2 ? W.weed.shade : W.weed.base));
  // a few twig tufts poking out
  const tufts: [number, number, number][] = [[0.8, 0.55, 0.3], [-0.75, 0.6, -0.35], [0.3, -0.2, 0.95], [-0.95, -0.2, 0.3]];
  for (const [dx, dy, dz] of tufts) {
    const l = Math.hypot(dx, dy, dz);
    const p0: [number, number, number] = [(dx / l) * R, 25 + (dy / l) * R, (dz / l) * R];
    const p1: [number, number, number] = [(dx / l) * (R + 3), 25 + (dy / l) * (R + 3) + 1, (dz / l) * (R + 3)];
    line(wd, [p0, p1], W.weed.dark);
    if (a) wd.set(Math.round(p1[0]), Math.round(p1[1]) + 1, Math.round(p1[2]), TOON.bone.hi);
  }
  const extra: ExtraPart[] = [
    { name: 'weed', model: wd, parent: 'pelvis', joint: [0.5, 25, 0.5] },
    { name: 'gun', model: revolverDown(-8), parent: 'fore_r', joint: HAND_R },
  ];
  if (a) extra.push({ name: 'gun_l', model: mirrored(revolverDown(-8), 'gun_l'), parent: 'fore_l', joint: HAND_L });
  return finish(a ? 'tumbleweed_bandit_alpha' : 'tumbleweed_bandit', P, extra, { topY: 54, radius: 0.45, sockets: { muzzle: { part: 'gun', at: [-7, 1.5, 1.5] } } });
}

// ============================================================================ LASSO RIDER (Lasso Lucy)
export function lassoRiderRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const P = skeletonParts({ skull: { mouth: 'smile' }, handL: { pose: 'fist' }, handR: { pose: 'fist' } });
  // braided pigtails with ribbon bows
  const Y = W.yarn;
  for (let y = 35; y <= 47; y++) {
    const x = y >= 44 ? 7 : 8, z = y < 40 ? -2 : -3;
    const c = y & 1 ? Y.base : Y.shade, c2 = y & 1 ? Y.shade : Y.base;
    both(P.head, x, y, z, c);
    both(P.head, x, y, z - 1, c2);
    if (y <= 43) both(P.head, x + 1, y, z, c2), both(P.head, x + 1, y, z - 1, c);
  }
  for (const z of [-3, -1]) both(P.head, 10, 37, z, TOON.lapis.base);
  both(P.head, 8, 34, -2, Y.hi);
  // neckerchief
  const nk = TOON.turquoise;
  for (let y = 30; y <= 34; y++) {
    const hw = y - 30;
    for (let x = -hw; x <= hw; x++) P.torso.set(x, y, 5, (x + y) % 3 === 0 ? nk.hi : nk.base);
  }
  // fringed leather vest over bare ribs
  const L = TOON.leather;
  jacket(P.torso, L, { y0: 26, openFront: 4 });
  for (let x = -7; x <= 7; x += 2) for (const z of [4, -6]) if (Math.abs(x) >= 4 || z === -6) P.torso.set(x, 25, z, L.hi).set(x, 24, z, L.shade);
  if (a) for (let i = 0; i <= 10; i++) P.torso.set(-6 + i, 24 + i, 6, i % 2 ? TOON.brass.hi : TOON.leatherDark.base, i % 2 ? VF.METAL : undefined);
  autoShade(P.torso, [L]);
  // chaps with side fringe, red boots
  trousersTop(P.pelvis, TOON.denim, TOON.leatherDark.base);
  P.thigh_l = pantLeg('thigh', TOON.leatherDark);
  for (let y = 13; y <= 19; y += 2) P.thigh_l.set(6, y, -1, L.hi).set(6, y, 0, L.hi);
  P.shin_l = bootShin(ramp(0xb8402c, 0x902e20, 0xd45a42, 0x5e1a10), a ? TOON.gold : TOON.silver);
  mirrorLegs(P);
  // pink cowgirl hat with a daisy
  P.hat = cowHat(a ? ramp(0x8a2a3e, 0x6a1e2e, 0xa83c52, 0x420e1a) : W.feltPink, TOON.linen.base);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) P.hat.set(9, 50 + dz, 2 + dx, TOON.white.base);
  P.hat.set(9, 50, 2, TOON.gold.base);
  if (a) line(P.hat, [[-8, 50, -3], [-10, 54, -4], [-11, 58, -6]], TOON.white.base, 0.5);
  // lasso: coil in the fist + a big open loop
  const ls = new VoxelModel('lasso');
  for (let i = 0; i < 3; i++) ring(ls, [-9 - i, 13, 1], [1, 0, 0], 3.6, 0.6, i === 1 ? W.rope.shade : W.rope.base);
  ring(ls, [-10, 5, 3], [1, 0, 0.35], 6.5, 0.6, W.rope.base);
  // sandboard under her boots (root-level part, top flush with the sand)
  const bd = new VoxelModel('board');
  const Wd = a ? ramp(0x5a3c2c, 0x44281c, 0x74503a, 0x2a1810) : TOON.wood;
  roundBox(bd, -6, 0, -19, 6, 1, 17, Wd.base, 2);
  roundBox(bd, -5, 1, 18, 5, 2, 19, Wd.base, 1);
  roundBox(bd, -4, 2, 20, 4, 3, 20, Wd.base, 1);
  for (let z = -18; z <= 17; z++) for (const x of [-3, 3]) bd.set(x, 1, z, a ? TOON.gold.base : TOON.red.base);
  for (const z of [-4, 3]) for (let x = -5; x <= 5; x++) bd.set(x, 2, z, TOON.leatherDark.base);
  autoShade(bd, [Wd], { hi: false });
  return finish(a ? 'lasso_rider_alpha' : 'lasso_rider', P, [
    { name: 'lasso', model: ls, parent: 'fore_r', joint: HAND_R },
    { name: 'board', model: bd, parent: '', joint: [0.5, 1, 0.5] },
  ], { topY: 56, radius: 0.32 });
}

// ============================================================================ JACKAL ARCHER
export function jackalArcherRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const F = TOON.jackal, G = TOON.gold;
  // ---- head: jackal skull-mask head with long snout + tall ears
  const head = new VoxelModel('head');
  roundBox(head, -6, 41, -6, 6, 48, 4, F.base, 2);
  roundBox(head, -5, 49, -5, 5, 50, 3, F.base, 2);
  roundBox(head, -3, 40, 4, 3, 44, 9, F.base, 1);
  roundBox(head, -2, 40, 10, 2, 43, 12, F.base, 1);
  roundBox(head, -1, 42, 13, 1, 43, 13, TOON.black.base, 0);
  for (let z = 5; z <= 12; z++) for (let x = -2; x <= 2; x++) if (head.has(x, 40, z)) head.set(x, 40, z, F.dark);
  // ears
  for (const s of [1, -1])
    for (let y = 49; y <= 60; y++) {
      const w = Math.max(0, 3 - Math.floor((y - 49) / 4));
      for (let i = 0; i <= w; i++) for (let z = -2; z <= 0; z++) both(head, 3 + i, y, z, F.base);
      if (w >= 1) both(head, 3 + Math.floor(w / 2) + 1, y, 1, a ? G.base : G.shade);
      void s;
    }
  // eye sockets 3x3 above the snout + kohl lines
  const S = TOON.socket;
  for (const s of [1, -1]) {
    for (let i = 2; i <= 4; i++)
      for (let y = 45; y <= 47; y++) {
        head.del(s * i, y, 4).del(s * i, y, 3);
        head.set(s * i, y, 2, S.dark);
      }
    for (let i = 2; i <= 5; i++) head.set(s * i, 44, 4, TOON.black.base);
    head.set(s * 6, 45, 4, TOON.black.base);
  }
  if (a) for (let x = -5; x <= 5; x++) head.set(x, 48, 4, Math.abs(x) % 2 ? G.base : TOON.lapis.base, VF.METAL);
  autoShade(head, [F]);
  const eye_l = new VoxelModel('eye_l');
  for (let i = 2; i <= 4; i++) for (let y = 45; y <= 47; y++) eye_l.set(i, y, 3, S.dark);
  const eye_r = mirrored(eye_l, 'eye_r');
  const jaw = new VoxelModel('jaw');
  roundBox(jaw, -2, 38, 4, 2, 39, 11, F.shade, 1);
  both(jaw, 2, 39, 11, TOON.bone.hi);
  // ---- torso: fur, light chest, gold usekh collar, quiver
  const torso = new VoxelModel('torso');
  for (let y = 24; y <= 33; y++) {
    const hw = y <= 26 ? 4 : y <= 29 ? 5 : 6;
    roundBox(torso, -hw, y, -4, hw, y, 3, F.base, 1);
  }
  for (let x = -5; x <= 5; x++) for (let z = -3; z <= 2; z++) if (Math.abs(x) >= 3) torso.set(x, 34, z, F.base);
  // lighter chest + belly fur
  for (let y = 25; y <= 31; y++) for (let x = -3; x <= 3; x++) if (Math.abs(x) <= (y < 28 ? 2 : 3)) torso.set(x, y, 3, F.hi);
  // quiver strap across the chest
  for (let i = 0; i <= 9; i++) torso.set(-5 + i, 33 - i, 4, TOON.leather.base);
  torso.set(0, 28, 5, G.base, VF.METAL);
  const rows: [number, number, number][] = [[34, 4, G.base], [33, 6, TOON.lapis.base], [32, 7, G.hi], [31, 7, TOON.turquoise.base]];
  for (const [y, hw, c] of rows)
    for (let x = -hw; x <= hw; x++)
      for (let z = -6; z <= 4; z++) {
        if (!(Math.abs(x) === hw || z === -6 || z === 4)) continue;
        if (y === 34 && Math.abs(x) <= 2 && z > -5 && z < 3) continue;
        torso.set(x, y, z, c, c === G.base || c === G.hi ? VF.METAL : undefined);
      }
  roundBox(torso, -6, 24, -10, -3, 36, -7, TOON.leather.base, 1);
  for (let x = -6; x <= -3; x++) for (const z of [-10, -7]) torso.set(x, 30, z, G.base);
  for (const [x, z] of [[-5, -9], [-4, -8], [-6, -8]]) {
    torso.set(x, 37, z, TOON.wood.base).set(x, 38, z, TOON.white.base).set(x, 39, z, a ? TOON.setRed.base : TOON.white.base);
  }
  // ---- arms (fur, gold bands), fists
  const arm_l = new VoxelModel('arm_l');
  roundBox(arm_l, 6, 26, -2, 9, 33, 1, F.base, 1);
  for (let x = 6; x <= 9; x++) for (let z = -2; z <= 1; z++) if (arm_l.has(x, 30, z)) arm_l.set(x, 30, z, G.base, VF.METAL);
  const fore_l = new VoxelModel('fore_l');
  roundBox(fore_l, 6, 20, -2, 9, 25, 1, F.base, 1);
  for (let x = 6; x <= 9; x++) for (let z = -2; z <= 1; z++) if (fore_l.has(x, 20, z)) fore_l.set(x, 20, z, G.base, VF.METAL), fore_l.set(x, 21, z, G.hi, VF.METAL);
  toonHand(fore_l, { ramp: F, pose: 'fist' });
  autoShade(arm_l, [F]);
  autoShade(fore_l, [F]);
  // ---- legs: fur, gold-strapped sandals
  const thigh_l = pantLeg('thigh', F);
  const shin_l = pantLeg('shin', F);
  roundBox(shin_l, 2, 0, -2, 5, 2, 4, F.base, 1);
  for (let x = 2; x <= 5; x++) for (let z = -2; z <= 4; z++) shin_l.set(x, 0, z, TOON.leather.base);
  for (let x = 2; x <= 5; x++) shin_l.set(x, 2, 2, G.base);
  const pelvis = new VoxelModel('pelvis');
  roundBox(pelvis, -5, 18, -4, 5, 23, 3, F.base, 1);
  // ---- kilt, tail, bow
  const kilt = new VoxelModel('kilt');
  const Ln = TOON.linen;
  for (let y = 13; y <= 22; y++) {
    const hx = y <= 17 ? 8 : 7;
    for (let x = -hx; x <= hx; x++)
      for (let z = -6; z <= 4; z++) if (Math.abs(x) === hx || z === -6 || z === 4) kilt.set(x, y, z, (x & 1) ? Ln.base : Ln.shade);
  }
  for (let x = -7; x <= 7; x++) for (let z = -6; z <= 4; z++) if (Math.abs(x) === 7 || z === -6 || z === 4) kilt.set(x, 23, z, G.base, VF.METAL);
  roundBox(kilt, -2, 14, 5, 2, 22, 5, a ? TOON.setRed.base : G.base, 0);
  for (let y = 15; y <= 21; y += 2) kilt.set(0, y, 6, TOON.lapis.base);
  const tail = new VoxelModel('tail');
  roundBox(tail, -1, 12, -9, 1, 19, -6, F.base, 1);
  roundBox(tail, -1, 11, -10, 1, 13, -8, F.hi, 1);
  const bow = new VoxelModel('bow');
  const BW = a ? G : ramp(0x5a3a22, 0x44281a, 0x74502e, 0x2a180c);
  for (let y = 1; y <= 33; y++) {
    const t = (y - 16.5) / 16.5;
    const z = 1 - Math.round(t * t * 4) + (Math.abs(t) > 0.92 ? 1 : 0);
    const c = Math.abs(t) < 0.12 ? TOON.red.base : Math.abs(t) > 0.9 ? G.hi : BW.base;
    bow.set(8, y, z, c, Math.abs(t) > 0.9 || a ? VF.METAL : undefined).set(9, y, z, c, Math.abs(t) > 0.9 || a ? VF.METAL : undefined);
  }
  for (let y = 2; y <= 32; y++) bow.set(8, y, -3, TOON.linen.hi);
  const P: HumanoidParts = {
    pelvis, torso, head, jaw, eye_l, eye_r, arm_l, fore_l, arm_r: mirrored(arm_l, 'arm_r'), fore_r: mirrored(fore_l, 'fore_r'),
    thigh_l, shin_l, thigh_r: mirrored(thigh_l, 'thigh_r'), shin_r: mirrored(shin_l, 'shin_r'),
  };
  return buildHumanoid({
    name: a ? 'jackal_archer_alpha' : 'jackal_archer',
    parts: P,
    extra: [
      { name: 'kilt', model: kilt, parent: 'pelvis', joint: [0.5, 23.5, -0.5] },
      { name: 'tail', model: tail, parent: 'pelvis', joint: [0.5, 19, -5.5] },
      { name: 'bow', model: bow, parent: 'fore_l', joint: HAND_L },
    ],
    joints: { eye: [3.5, 46.5, 5], jaw: [0.5, 40, 4] },
    topY: 61,
    radius: 0.3,
    expressions: EXPR,
  });
}

// ============================================================================ BANDAGE WHIPPER (mummy)
function wraps(m: VoxelModel, R: Ramp) {
  paintIf(m, (x, y, z, c) => c === R.base && ((y + (((x + z + 40) / 4) | 0)) % 3) === 0, R.shade);
}
export function bandageWhipperRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const Bd = TOON.bandage;
  const sk = toonSkull({ ramp: Bd, mouth: 'smile' });
  wraps(sk.head, Bd);
  const torso = clothTorso({ ramp: Bd, halfX: 6, zBack: -5, zFront: 3 });
  roundBox(torso, -2, 34, -4, 2, 38, -1, Bd.base, 1); // wrapped neck
  wraps(torso, Bd);
  // gold scarab amulet
  roundBox(torso, -1, 28, 4, 1, 30, 4, TOON.lapis.base, 0);
  torso.set(0, 30, 5, TOON.turquoise.hi);
  both(torso, 2, 29, 4, TOON.gold.base, VF.METAL);
  if (a) {
    const rows: [number, number, number][] = [[34, 4, TOON.gold.base], [33, 6, TOON.lapis.base], [32, 7, TOON.gold.hi]];
    for (const [y, hw, c] of rows) for (let x = -hw; x <= hw; x++) for (let z = -6; z <= 4; z++) if (Math.abs(x) === hw || z === -6 || z === 4) torso.set(x, y, z, c);
  }
  // left arm: thickly wrapped, broken shackle on the wrist
  const arm_l = new VoxelModel('arm_l');
  roundBox(arm_l, 6, 26, -2, 9, 33, 1, Bd.base, 1);
  wraps(arm_l, Bd);
  const fore_l = new VoxelModel('fore_l');
  roundBox(fore_l, 6, 20, -2, 9, 25, 1, Bd.base, 1);
  toonHand(fore_l, { ramp: Bd, pose: 'open' });
  wraps(fore_l, Bd);
  for (let x = 5; x <= 10; x++) for (let z = -3; z <= 2; z++) if (x === 5 || x === 10 || z === -3 || z === 2) fore_l.set(x, 21, z, TOON.iron.base, VF.METAL).set(x, 22, z, TOON.iron.hi, VF.METAL);
  for (const [y, z] of [[20, 2], [19, 3], [18, 3]] as [number, number][]) fore_l.set(11, y, z, TOON.iron.shade, VF.METAL);
  // right arm: unwrapped bone (he made the whip out of it)
  const armR = mirrored(boneUpperArm(), 'arm_r');
  const foreR = mirrored(boneForearm({ pose: 'fist' }), 'fore_r');
  const pelvis = new VoxelModel('pelvis');
  roundBox(pelvis, -6, 17, -4, 6, 23, 3, Bd.base, 1);
  wraps(pelvis, Bd);
  // canopic jar on the left hip
  roundBox(pelvis, 7, 17, -1, 9, 21, 1, TOON.sandstone.base, 0);
  roundBox(pelvis, 7, 22, -1, 9, 23, 1, TOON.jackal.base, 0);
  pelvis.set(8, 24, 0, TOON.jackal.base).set(8, 19, 2, TOON.lapis.base);
  const thigh_l = pantLeg('thigh', Bd);
  const shin_l = pantLeg('shin', Bd);
  roundBox(shin_l, 2, 0, -2, 5, 2, 4, Bd.base, 1);
  wraps(thigh_l, Bd);
  wraps(shin_l, Bd);
  // loose bandage tail off the left calf
  line(shin_l, [[5, 6, -2], [6, 4, -4], [6, 2, -5]], Bd.shade);
  // the whip: a long unravelled bandage from the bone fist
  const whip = new VoxelModel('whip');
  const pts: [number, number, number][] = a
    ? [[-8, 14, 1], [-9, 8, 2], [-10, 3, 4], [-10, 0, 9], [-7, 0, 15], [-3, 0, 19], [1, 1, 21], [3, 2, 21]]
    : [[-8, 14, 1], [-9, 8, 2], [-10, 3, 4], [-9, 0, 9], [-6, 0, 13], [-3, 1, 16], [-2, 2, 17]];
  line(whip, pts, (t) => (Math.floor(t * 14) % 2 ? Bd.shade : Bd.base), 0.5);
  let hat: VoxelModel | undefined;
  if (a) {
    // nemes headdress: striped gold/lapis cloth with lappets
    hat = new VoxelModel('hat');
    for (let y = 47; y <= 53; y++) {
      const hx = y >= 52 ? 6 : 8;
      for (let x = -hx; x <= hx; x++) for (let z = -8; z <= 6; z++) {
        const shell = Math.abs(x) === hx || z === -8 || y >= 52;
        if (!shell || (y >= 52 && (Math.abs(x) > 6 || z < -7 || z > 5))) continue;
        hat.set(x, y, z, (y & 1) ? TOON.gold.base : TOON.lapis.base, (y & 1) ? VF.METAL : undefined);
      }
    }
    for (const s of [1, -1]) for (let y = 34; y <= 46; y++) for (let z = 0; z <= 3; z++) both(hat, 8, y, z, (y & 1) ? TOON.gold.base : TOON.lapis.base);
    for (let x = -7; x <= 7; x++) hat.set(x, 47, 7, TOON.gold.hi, VF.METAL);
    hat.set(0, 48, 8, TOON.setRed.base).set(0, 49, 8, TOON.gold.hi);
  }
  const P: HumanoidParts = {
    pelvis, torso, head: sk.head, jaw: sk.jaw, eye_l: sk.eye_l, eye_r: sk.eye_r, brow_l: sk.brow_l, brow_r: sk.brow_r, hat,
    arm_l, fore_l, arm_r: armR, fore_r: foreR, thigh_l, shin_l, thigh_r: mirrored(thigh_l, 'thigh_r'), shin_r: mirrored(shin_l, 'shin_r'),
  };
  return finish(a ? 'bandage_whipper_alpha' : 'bandage_whipper', P, [{ name: 'whip', model: whip, parent: 'fore_r', joint: HAND_R }], { topY: a ? 54 : 52, radius: 0.34 });
}
