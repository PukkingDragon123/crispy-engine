// Old Hapi the merchant + his camel — STYLE v2 cartoon NPCs.
// Merchant: toon humanoid at 1/30 (flesh head, huge turban, long white beard on the jaw
// so it wags when he talks, striped robe, curly slippers, staff with a brass bell).
// Camel: quadruped at 1/24 (body root, neck, head, jaw, eyes, 4 legs, tail).
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, V3 } from '../../../engine/voxel/Rig';
import { TOON, Ramp } from '../style';
import {
  roundBox, roundBoxX, mirrored, mirrorV3, autoShade, toonHead, FACE_JOINT, toonHand, buildHumanoid, defaultExpressions, clothTorso, sleeve,
} from '../toon/humanoid';

export const MERCHANT_EXPRESSIONS = ['neutral', 'squinty', 'laugh', 'surprised'];
export const CAMEL_EXPRESSIONS = ['neutral', 'bored', 'smug', 'spit'];

const SKIN: Ramp = { base: 0xc98a5a, shade: 0xa66c42, hi: 0xe0a676, dark: 0x6e4226 };
const ROBE: Ramp = { base: 0x5a7ab0, shade: 0x45608e, hi: 0x7896c8, dark: 0x2c3e5e };
const VEST: Ramp = { base: 0x8a3a2a, shade: 0x6a2a1e, hi: 0xa84e3a, dark: 0x45180e };
const BEARD: Ramp = { base: 0xf2eee6, shade: 0xd2ccc0, hi: 0xffffff, dark: 0xa8a294 };

function turban() {
  const m = new VoxelModel('hat');
  const L = TOON.linen;
  // wrapped layers: each band shifted, diagonal folds
  for (let y = 47; y <= 58; y++) {
    const t = (y - 47) / 11;
    const hx = Math.round(9 - t * t * 4);
    const zb = -hx, zf = hx - 1;
    for (let x = -hx; x <= hx; x++)
      for (let z = zb; z <= zf; z++) {
        const dx = hx - Math.abs(x), dz = Math.min(z - zb, zf - z);
        if (dx + dz < (y >= 56 ? 3 : 2)) continue;
        const fold = ((x + y * 2 + 40) % 6 === 0) || y === 50 || y === 54;
        m.set(x, y, z, fold ? L.shade : L.base);
      }
  }
  // the dome top
  roundBox(m, -3, 59, -3, 3, 59, 2, L.base, 2);
  // brooch: ruby in gold + feather plume
  roundBox(m, -1, 50, 9, 1, 52, 9, TOON.gold.base, 1);
  m.set(0, 51, 10, TOON.red.hi).set(0, 51, 9, TOON.gold.base);
  for (let i = 0; i < 7; i++) m.set(i > 4 ? 1 : 0, 53 + i, 9 - (i >> 1), i > 4 ? TOON.turquoise.hi : TOON.turquoise.base);
  autoShade(m, [L], { hi: false });
  return m;
}

function merchantHead() {
  const h = toonHead({ skin: SKIN, nose: 'big', ears: true, brow: BEARD.base, mouth: false });
  // bushy white brows are the brow parts; add a white moustache on the head
  for (let x = -4; x <= 4; x++) if (Math.abs(x) >= 1) h.head.set(x, 39, 7, BEARD.base);
  for (const s of [1, -1]) h.head.set(s * 5, 38, 7, BEARD.base).set(s * 6, 37, 7, BEARD.shade);
  h.head.set(0, 39, 7, BEARD.shade);
  // long beard on the jaw (wags when he talks)
  const jaw = h.jaw;
  for (let y = 26; y <= 37; y++) {
    const hw = y >= 35 ? 5 : y >= 31 ? 4 : y >= 28 ? 3 : 2;
    for (let x = -hw; x <= hw; x++) for (let z = 4; z <= 7; z++) {
      if (y < 34 && z < 5) continue;
      jaw.set(x, y, z, (x + y) % 4 === 0 ? BEARD.shade : BEARD.base);
    }
  }
  jaw.set(0, 25, 6, BEARD.shade);
  // smile line
  for (let x = -2; x <= 2; x++) jaw.set(x, 38, 7, SKIN.dark);
  return h;
}

function staff() {
  const m = new VoxelModel('weapon');
  const W = TOON.wood;
  // gnarled staff, held in the right hand (x ~ -8), from the ground to above the head
  const kinks = [0, 0, 1, 1, 0, 0, -1, 0];
  for (let y = 0; y <= 52; y++) {
    const k = kinks[Math.floor(y / 7) % kinks.length];
    m.set(-8 + k, y, 0, W.base).set(-7 + k, y, 0, (y & 3) === 0 ? W.shade : W.base);
  }
  // curled top + brass bell
  for (const [x, y] of [[-8, 53], [-9, 54], [-10, 54], [-11, 53], [-11, 52]] as [number, number][]) m.set(x, y, 0, W.base).set(x, y, 1, W.shade);
  roundBox(m, -12, 48, -1, -10, 50, 1, TOON.brass.base, 1);
  m.set(-11, 47, 0, TOON.brass.shade).set(-11, 51, 0, TOON.brass.hi);
  // rag tied to the grip
  roundBox(m, -8, 20, -1, -6, 21, 1, TOON.red.base, 0);
  return m;
}

export function merchantRig(): RigSpec {
  const h = merchantHead();
  // stout torso: robe + belly, embroidered vest, red sash, bead necklace
  const torso = clothTorso({ ramp: ROBE, halfX: 7, zFront: 4, belly: 4 });
  for (let y = 25; y <= 33; y++)
    for (let x = -7; x <= 7; x++)
      for (let z = -5; z <= 5; z++) {
        if (!torso.has(x, y, z)) continue;
        const outside = !torso.has(x, y, z + 1) || !torso.has(x, y, z - 1) || !torso.has(x + 1, y, z) || !torso.has(x - 1, y, z);
        if (outside && Math.abs(x) >= 3 && y >= 26) torso.set(x, y, z + (z >= 4 ? 1 : 0), VEST.base);
      }
  for (const s of [1, -1]) for (let y = 26; y <= 33; y += 2) torso.set(s * 3, y, 6, TOON.gold.hi);
  roundBoxX(torso, -8, 24, -5, 8, 25, 6, TOON.red.base, 1);
  torso.set(5, 23, 6, TOON.red.shade).set(5, 22, 6, TOON.red.shade);
  for (const [x, y] of [[-2, 33], [-1, 32], [0, 32], [1, 32], [2, 33]] as [number, number][]) torso.set(x, y, 6, (x & 1) ? TOON.turquoise.base : TOON.gold.base);
  autoShade(torso, [ROBE, VEST]);
  // pelvis: robe waist (the robe skirt is the stiff 'coat' part)
  const pelvis = new VoxelModel('pelvis');
  roundBox(pelvis, -6, 18, -4, 6, 23, 3, ROBE.shade, 1);
  // arms: wide robe sleeves, skin hands
  const armL = new VoxelModel('arm_l');
  sleeve(armL, 6, 10, 26, 33, -2, 2, ROBE);
  const foreL = new VoxelModel('fore_l');
  sleeve(foreL, 6, 11, 19, 25, -3, 2, ROBE, VEST);
  toonHand(foreL, { ramp: SKIN, pose: 'open' });
  const foreR = mirrored(foreL, 'fore_r');
  // replace right hand with a fist around the staff
  const foreR2 = new VoxelModel('fore_r');
  sleeve(foreR2, -11, -6, 19, 25, -3, 2, ROBE, VEST);
  const fist = new VoxelModel('tmp');
  toonHand(fist, { ramp: SKIN, pose: 'fist' });
  fist.forEach((x, y, z, c) => foreR2.set(-x, y, z, c));
  void foreR;
  // legs: baggy trousers + curly slippers (mostly hidden by the robe)
  const thighL = new VoxelModel('thigh_l');
  roundBox(thighL, 2, 12, -2, 5, 20, 1, TOON.linen.shade, 1);
  const shinL = new VoxelModel('shin_l');
  roundBox(shinL, 2, 3, -2, 5, 11, 1, TOON.linen.shade, 1);
  roundBox(shinL, 2, 0, -3, 5, 2, 4, TOON.red.base, 1);
  shinL.set(3, 2, 5, TOON.red.base).set(4, 2, 5, TOON.red.base).set(3, 3, 6, TOON.gold.base).set(4, 3, 6, TOON.gold.base);
  autoShade(shinL, [TOON.red]);
  // robe skirt (stiff), flaring to the ankles, gold trim hem
  const skirt = new VoxelModel('coat');
  for (let y = 3; y <= 23; y++) {
    const hx = 7 + Math.floor((23 - y) / 8), zb = -5 - Math.floor((23 - y) / 10), zf = 4 + Math.floor((23 - y) / 10);
    for (let x = -hx; x <= hx; x++)
      for (let z = zb; z <= zf; z++) {
        const shell = Math.abs(x) === hx || z === zb || z === zf;
        if (!shell || (Math.abs(x) === hx && (z === zb || z === zf))) continue;
        if (z === zf && Math.abs(x) <= 1 && y < 12) continue; // front slit
        m3(skirt, x, y, z, y === 3 ? TOON.gold.base : (x + 40) % 5 === 0 ? ROBE.shade : ROBE.base);
      }
  }
  autoShade(skirt, [ROBE], { hi: false });
  return buildHumanoid({
    name: 'merchant',
    parts: {
      pelvis,
      torso,
      head: h.head,
      jaw: h.jaw,
      eye_l: h.eye_l,
      eye_r: h.eye_r,
      brow_l: h.brow_l,
      brow_r: h.brow_r,
      hat: turban(),
      arm_l: armL,
      fore_l: foreL,
      arm_r: mirrored(armL, 'arm_r'),
      fore_r: foreR2,
      thigh_l: thighL,
      shin_l: shinL,
      thigh_r: mirrored(thighL, 'thigh_r'),
      shin_r: mirrored(shinL, 'shin_r'),
    },
    joints: { eye: FACE_JOINT.eye, brow: FACE_JOINT.brow },
    extra: [
      { name: 'weapon', model: staff(), parent: 'fore_r', joint: [-7.5, 16.5, 0.5] },
      { name: 'coat', model: skirt, parent: 'pelvis', joint: [0.5, 23.5, 0] },
    ],
    topY: 60,
    radius: 0.34,
    expressions: defaultExpressions(MERCHANT_EXPRESSIONS),
    sockets: {
      cape_anchor: { part: 'torso', at: [0.5, 33, -6] },
      shoulder_r: { part: 'torso', at: [-6.5, 34.5, 0.5] },
      head_top: { part: 'hat', at: [0.5, 60, 0] },
    },
    meta: { cloth: { cape: [0x8a3a2a, 0x5e261c, 0xc79a46], capeLen: 0.6, capeWidth: 0.45 } },
  });
}
function m3(m: VoxelModel, x: number, y: number, z: number, c: number) {
  m.set(x, y, z, c);
}

// ===================================================================== CAMEL (1/24)
const HIDE: Ramp = { base: 0xd2a066, shade: 0xb0804a, hi: 0xe8bc84, dark: 0x7a5228 };

function camelBody() {
  const m = new VoxelModel('body');
  // chunky barrel body
  roundBox(m, -7, 22, -16, 7, 34, 14, HIDE.base, 4);
  // big hump
  for (let y = 35; y <= 44; y++) {
    const t = (y - 35) / 9;
    const hx = Math.round(6 - t * 3), hz = Math.round(10 - t * 6);
    roundBox(m, -hx, y, -2 - hz, hx, y, -2 + hz, HIDE.base, 2);
  }
  // colourful saddle blanket draped over the hump
  for (let x = -8; x <= 8; x++)
    for (let z = -10; z <= 7; z++)
      for (let y = 27; y <= 45; y++) {
        if (!m.has(x, y, z)) continue;
        const outer = !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z);
        if (!outer) continue;
        const band = z === -10 || z === 7 || y === 27 ? TOON.gold.base : (z + 20) % 4 < 2 ? TOON.red.base : TOON.turquoise.base;
        m.set(x, y, z, band);
      }
  // tassels hanging from the blanket hem
  for (const s of [1, -1]) for (let z = -9; z <= 6; z += 3) m.set(s * 8, 26, z, TOON.gold.shade).set(s * 8, 25, z, TOON.red.base);
  // saddle bags
  for (const s of [1, -1]) roundBox(m, s * 8, 24, -15, s * 10, 31, -10, TOON.leather.base, 1);
  for (const s of [1, -1]) m.set(s * 10, 29, -13, TOON.brass.hi);
  // shaggy hump fur fringe
  for (let z = -10; z <= 6; z += 2) m.set(0, 45, z - 2, HIDE.shade);
  autoShade(m, [HIDE, TOON.leather]);
  return m;
}
function camelNeck() {
  const m = new VoxelModel('neck');
  // thick S-curved neck rising forward
  const pts: [number, number][] = [[28, 13], [30, 15], [32, 17], [35, 19], [38, 20], [41, 20], [44, 21]];
  for (const [y, z] of pts) roundBox(m, -3, y, z - 3, 3, y + 3, z + 3, HIDE.base, 2);
  // shaggy fringe under the neck
  for (const [y, z] of pts.slice(0, 5)) m.set(0, y, z + 4, HIDE.shade).set(1, y - 1, z + 4, HIDE.dark);
  autoShade(m, [HIDE]);
  return m;
}
function camelHead() {
  const m = new VoxelModel('head');
  // big cartoon head
  roundBox(m, -5, 45, 17, 5, 53, 28, HIDE.base, 3);
  // long muzzle
  roundBox(m, -4, 45, 29, 4, 50, 34, HIDE.hi, 2);
  m.set(-2, 49, 35, HIDE.dark).set(2, 49, 35, HIDE.dark);
  // ears + fuzzy tuft
  for (const s of [1, -1]) roundBox(m, s * 5, 53, 19, s * 6, 55, 20, HIDE.shade, 0);
  roundBox(m, -3, 54, 21, 3, 55, 26, HIDE.dark, 1);
  // bridle with brass studs
  for (let y = 45; y <= 52; y++) for (const s of [1, -1]) m.set(s * 6, y, 27, TOON.red.base);
  for (let x = -4; x <= 4; x++) m.set(x, 51, 31 - (Math.abs(x) === 4 ? 1 : 0), TOON.red.base);
  for (const s of [1, -1]) m.set(s * 6, 48, 28, TOON.brass.hi);
  // heavy-lidded brows over the side eyes
  for (const s of [1, -1]) for (let z = 21; z <= 25; z++) m.set(s * 6, 51, z, HIDE.shade);
  autoShade(m, [HIDE]);
  return m;
}
function camelJaw() {
  // big floppy lower lip (chews)
  const m = new VoxelModel('jaw');
  roundBox(m, -4, 42, 25, 4, 44, 34, HIDE.shade, 2);
  for (let x = -3; x <= 3; x++) m.set(x, 44, 35, 0xb46a5a).set(x, 43, 35, 0xb46a5a);
  return m;
}
function camelLeg(front: boolean) {
  const m = new VoxelModel(front ? 'leg_fl' : 'leg_bl');
  const z = front ? 10 : -12;
  // thick thigh, knobby knee, sturdy shin, big flat padded foot
  roundBox(m, 3, 15, z - 3, 7, 25, z + 2, HIDE.base, 2);
  roundBox(m, 3, 12, z - 3, 7, 14, z + 2, HIDE.shade, 2);
  roundBox(m, 4, 3, z - 2, 6, 11, z + 1, HIDE.base, 1);
  roundBox(m, 3, 0, z - 3, 7, 2, z + 3, HIDE.dark, 2);
  autoShade(m, [HIDE]);
  return m;
}

export function camelRig(): RigSpec {
  const J = (name: string, model: VoxelModel, j: V3, parent?: string, rest?: V3): PartSpec => ({ name, model, pivot: j, attach: j, parent, rest });
  const eyeL = new VoxelModel('eye_l');
  // eye plug on the side of the head (+X), facing out
  for (let y = 48; y <= 50; y++) for (let z = 22; z <= 24; z++) eyeL.set(6, y, z, TOON.socket.dark);
  const fl = camelLeg(true), bl = camelLeg(false);
  const tail = new VoxelModel('tail');
  for (let y = 24; y <= 31; y++) tail.set(0, y, -17, HIDE.shade);
  roundBox(tail, -1, 21, -18, 1, 23, -17, HIDE.dark, 0);
  const parts: PartSpec[] = [
    J('body', camelBody(), [0.5, 28, 0.5]),
    J('neck', camelNeck(), [0.5, 29, 13], 'body'),
    J('head', camelHead(), [0.5, 46, 21], 'neck'),
    J('jaw', camelJaw(), [0.5, 44.5, 26], 'head'),
    J('eye_l', eyeL, [7, 49.5, 23.5], 'head', [0, Math.PI / 2, 0]),
    J('eye_r', mirrored(eyeL, 'eye_r'), mirrorV3([7, 49.5, 23.5]), 'head', [0, -Math.PI / 2, 0]),
    J('leg_fl', fl, [5.5, 24, 10], 'body'),
    J('leg_fr', mirrored(fl, 'leg_fr'), mirrorV3([5.5, 24, 10]), 'body'),
    J('leg_bl', bl, [5.5, 24, -12], 'body'),
    J('leg_br', mirrored(bl, 'leg_br'), mirrorV3([5.5, 24, -12]), 'body'),
    J('tail', tail, [0.5, 31, -16.5], 'body'),
  ];
  const expressions: Record<string, { jaw?: number }> = {};
  for (const e of CAMEL_EXPRESSIONS) expressions[e] = { jaw: e === 'spit' ? 0.35 : e === 'smug' ? 0.05 : 0 };
  const VS = 1 / 24;
  return {
    name: 'camel',
    voxelSize: VS,
    parts,
    sockets: { mouth: { part: 'jaw', at: [0.5, 43, 35] }, saddle: { part: 'body', at: [0.5, 45, -2] }, head_top: { part: 'head', at: [0.5, 56, 23] } },
    meta: { height: 56 * VS, length: 52 * VS, radius: 0.7, expressions },
  };
}
