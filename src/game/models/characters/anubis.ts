// Anubis — judge of the dead (runs the Anubis Trial). STYLE v2 cartoon god at 1/20 m on a
// 1.5x toon layout (~4.6 m to the ear tips): black jackal head with a long snout, tall gold-lined
// ears, striped lappets, gold collar, bracers and kilt, was-sceptre in the right hand.
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, V3 } from '../../../engine/voxel/Rig';
import { TOON, Ramp } from '../style';
import { roundBox, roundBoxX, mirrored, mirrorV3, autoShade, defaultExpressions } from '../toon/humanoid';

export const ANUBIS_EXPRESSIONS = ['neutral', 'angry', 'judging', 'defeated'];
const VS = 1 / 20;
const K: Ramp = { base: 0x2c2838, shade: 0x1e1b28, hi: 0x423c52, dark: 0x121018 }; // black jackal skin
const G = TOON.gold;
const L = TOON.lapis;
const LIN = TOON.linen;

function bandRing(m: VoxelModel, y0: number, y1: number, hx: number, zb: number, zf: number, col: (y: number, x: number, z: number) => number) {
  for (let y = y0; y <= y1; y++)
    for (let x = -hx; x <= hx; x++)
      for (let z = zb; z <= zf; z++) {
        const edge = Math.abs(x) === hx || z === zb || z === zf;
        if (!edge || (Math.abs(x) === hx && (z === zb || z === zf))) continue;
        m.set(x, y, z, col(y, x, z));
      }
}

function pelvis() {
  const m = new VoxelModel('pelvis');
  roundBox(m, -8, 27, -5, 8, 35, 4, K.base, 2);
  // gold belt with a lapis buckle
  bandRing(m, 33, 35, 9, -6, 5, (y) => (y === 34 ? G.base : G.shade));
  roundBox(m, -2, 32, 6, 2, 36, 6, L.base, 1);
  m.set(0, 34, 7, G.hi);
  autoShade(m, [K]);
  return m;
}

function torso() {
  const m = new VoxelModel('torso');
  // broad chest tapering to the waist
  for (let y = 36; y <= 51; y++) {
    const hx = y >= 46 ? 10 : y >= 41 ? 9 : 8;
    const zf = y >= 44 ? 6 : 5;
    roundBoxX(m, -hx, y, -6, hx, y, zf, K.base, 0);
    for (let z = -6; z <= zf; z++) m.del(-hx, y, z === -6 || z === zf ? z : 999).del(hx, y, z === -6 || z === zf ? z : 999);
  }
  // pecs + abs (subtle, hand-placed)
  for (const s of [1, -1]) roundBox(m, s * 1, 45, 7, s * 7, 49, 7, K.base, 1);
  for (let y = 38; y <= 43; y++) if (y !== 40 && y !== 43) for (const s of [1, -1]) for (let i = 1; i <= 3; i++) m.set(s * i, y, 6, K.hi);
  // usekh collar: stepped rings
  const rows: [number, number, number][] = [[53, 6, G.base], [52, 8, L.base], [51, 10, G.hi], [50, 10, TOON.turquoise.base], [49, 9, G.base], [48, 8, L.base], [47, 7, G.shade]];
  for (const [y, hw, c] of rows)
    for (let x = -hw; x <= hw; x++)
      for (let z = -7; z <= 7; z++) {
        const edge = Math.abs(x) === hw || z === -7 || z === 7;
        if (!edge) continue;
        if (y >= 52 && Math.abs(x) <= 3 && z > -6 && z < 6) continue;
        m.set(x, y, z, c);
      }
  // neck
  roundBox(m, -3, 52, -4, 3, 55, 2, K.shade, 1);
  autoShade(m, [K]);
  return m;
}

function head() {
  const m = new VoxelModel('head');
  // cranium
  for (let y = 56; y <= 72; y++) {
    const hx = y >= 71 ? 6 : y >= 69 ? 7 : 8;
    const zb = y >= 71 ? -6 : -8, zf = y >= 71 ? 4 : 6;
    for (let x = -hx; x <= hx; x++)
      for (let z = zb; z <= zf; z++) {
        const dx = hx - Math.abs(x), dz = Math.min(z - zb, zf - z);
        if (dx + dz < 2) continue;
        m.set(x, y, z, K.base);
      }
  }
  // long snout (upper), tapering forward
  for (let z = 7; z <= 18; z++) {
    const hw = z >= 15 ? 2 : z >= 11 ? 3 : 4;
    const top = z >= 15 ? 61 : z >= 11 ? 63 : 65;
    for (let x = -hw; x <= hw; x++) for (let y = 58; y <= top; y++) m.set(x, y, z, K.base);
  }
  // shiny nose tip
  roundBox(m, -1, 60, 19, 1, 62, 19, K.dark, 0);
  m.set(0, 62, 19, K.hi);
  // upper teeth / fangs along the snout
  for (let z = 9; z <= 17; z += 2) for (const s of [1, -1]) m.set(s * (z >= 15 ? 2 : 3), 58, z, TOON.white.base);
  // eye sockets (3x3, 1 deep, on the front of the cranium beside the snout)
  for (const s of [1, -1]) for (let i = 4; i <= 6; i++) for (let y = 65; y <= 67; y++) {
    m.del(s * i, y, 6);
    m.set(s * i, y, 5, G.dark);
  }
  // kohl lines (gold) from the eye corners
  for (const s of [1, -1]) m.set(s * 7, 66, 6, G.base).set(s * 8, 65, 5, G.base);
  // ears: tall, pointed, gold inner
  for (const s of [1, -1])
    for (let y = 71; y <= 91; y++) {
      const t = (y - 71) / 20;
      const w = Math.max(0, Math.round(3 - t * 3));
      for (let x = 5 - w + 1; x <= 5 + w; x++)
        for (let z = -3; z <= 0; z++) {
          const inner = z === 0 && Math.abs(x - 5) < w && y < 89;
          m.set(s * x, y, z, inner ? G.shade : K.base);
        }
    }
  // gold forehead band + striped lappets behind the ears down to the shoulders
  for (let x = -8; x <= 8; x++) m.set(x, 69, 7 - (Math.abs(x) > 6 ? 1 : 0), G.base);
  for (const s of [1, -1])
    for (let y = 48; y <= 68; y++)
      for (let x = 8; x <= 10; x++)
        for (let z = -4; z <= 2; z++) {
          if (y < 56 && z > 0) continue;
          m.set(s * x, y, z, (y & 1) ? L.base : G.base);
        }
  for (let y = 54; y <= 68; y++) for (let x = -7; x <= 7; x++) m.set(x, y, -9, (y & 1) ? L.base : G.base);
  autoShade(m, [K]);
  return m;
}

function jaw() {
  const m = new VoxelModel('jaw');
  for (let z = 6; z <= 17; z++) {
    const hw = z >= 14 ? 2 : 3;
    for (let x = -hw; x <= hw; x++) for (let y = 54; y <= 57; y++) m.set(x, y, z, y === 57 && Math.abs(x) < hw && z > 7 ? 0x6a2030 : K.shade);
  }
  for (let z = 8; z <= 16; z += 2) for (const s of [1, -1]) m.set(s * 2, 57, z, TOON.white.base);
  autoShade(m, [K], { hi: false });
  return m;
}

function armL() {
  const arm = new VoxelModel('arm_l');
  roundBox(arm, 10, 38, -3, 14, 50, 2, K.base, 1);
  roundBox(arm, 11, 51, -2, 13, 52, 1, K.base, 0);
  bandRing(arm, 43, 44, 3, -4, 3, (y) => (y === 44 ? G.hi : G.base)); // armband (centred at x 12)
  autoShade(arm, [K]);
  // shift the ring onto the arm (bandRing is centred at x=0)
  const fixed = new VoxelModel('arm_l');
  arm.forEach((x, y, z, c, f) => fixed.set(y >= 43 && y <= 44 && (c === G.hi || c === G.base) ? x + 12 : x, y, z, c, f));
  const fore = new VoxelModel('fore_l');
  roundBox(fore, 10, 28, -3, 14, 37, 2, K.base, 1);
  // gold bracer with lapis inlay
  roundBox(fore, 9, 28, -4, 15, 32, 3, G.base, 1);
  for (let y = 29; y <= 31; y++) fore.set(15, y, 0, L.base).set(9, y, 0, L.base);
  // big fist
  roundBox(fore, 9, 20, -3, 15, 27, 4, K.base, 2);
  for (let x = 10; x <= 14; x++) fore.set(x, 25, 5, K.hi);
  for (const x of [11, 13]) for (let y = 21; y <= 24; y++) fore.set(x, y, 4, K.shade);
  autoShade(fore, [K]);
  return { arm: fixed, fore };
}

function legL() {
  const thigh = new VoxelModel('thigh_l');
  roundBox(thigh, 2, 18, -3, 9, 30, 3, K.base, 1);
  const shin = new VoxelModel('shin_l');
  roundBox(shin, 3, 4, -3, 8, 17, 2, K.base, 1);
  // gold anklet + sandal with straps
  roundBox(shin, 2, 4, -4, 9, 5, 3, G.base, 1);
  roundBox(shin, 2, 0, -4, 9, 1, 7, TOON.leather.base, 1);
  roundBox(shin, 3, 2, -3, 8, 3, 6, K.base, 1);
  for (let x = 3; x <= 8; x++) shin.set(x, 3, 7, G.base);
  autoShade(thigh, [K]);
  autoShade(shin, [K, TOON.leather]);
  return { thigh, shin };
}

function kilt() {
  const m = new VoxelModel('coat');
  for (let y = 22; y <= 32; y++) {
    const hx = 9 + (y < 26 ? 1 : 0);
    for (let x = -hx; x <= hx; x++)
      for (let z = -6; z <= 5; z++) {
        const edge = Math.abs(x) === hx || z === -6 || z === 5;
        if (!edge) continue;
        m.set(x, y, z, (x & 1) ? LIN.base : LIN.shade);
      }
  }
  // front apron: gold & lapis stripes
  for (let y = 18; y <= 32; y++) for (let x = -3; x <= 3; x++) m.set(x, y, 6, Math.abs(x) === 3 || y === 18 ? G.base : (y & 1) ? L.base : G.shade);
  autoShade(m, [LIN], { under: false });
  return m;
}

function sceptre() {
  // was-sceptre: straight shaft, forked foot, angled animal head on top
  const m = new VoxelModel('weapon');
  for (let y = 4; y <= 86; y++) for (let x = -13; x <= -12; x++) m.set(x, y, 0, (y % 12 === 0) ? G.hi : G.base);
  for (const dx of [-1, 1]) for (let y = 0; y <= 3; y++) m.set(-12.5 + dx * 1.5, y, 0, G.shade);
  roundBox(m, -14, 86, -1, -11, 89, 4, G.base, 1);
  for (let z = 5; z <= 7; z++) m.set(-13, 88, z, G.base).set(-12, 88, z, G.base);
  m.set(-12, 90, 0, G.hi).set(-13, 90, -1, G.hi);
  m.set(-11, 88, 2, L.base);
  return m;
}

export function anubisRig(): RigSpec {
  const J = (name: string, model: VoxelModel, j: V3, parent?: string): PartSpec => ({ name, model, pivot: j, attach: j, parent });
  const arms = armL();
  const legs = legL();
  const eye = new VoxelModel('eye_l');
  for (let i = 4; i <= 6; i++) for (let y = 65; y <= 67; y++) eye.set(i, y, 5, G.dark);
  const brow = new VoxelModel('brow_l');
  for (let i = 3; i <= 7; i++) brow.set(i, 68, 7, K.hi);
  const eyeJ: V3 = [5.5, 66.5, 7];
  const browJ: V3 = [5.5, 68.5, 7.5];
  const parts: PartSpec[] = [
    J('pelvis', pelvis(), [0.5, 31, 0]),
    J('torso', torso(), [0.5, 36, -0.5], 'pelvis'),
    J('head', head(), [0.5, 55, -1], 'torso'),
    J('jaw', jaw(), [0.5, 57.5, 6], 'head'),
    J('eye_l', eye, eyeJ, 'head'),
    J('eye_r', mirrored(eye, 'eye_r'), mirrorV3(eyeJ), 'head'),
    J('brow_l', brow, browJ, 'head'),
    J('brow_r', mirrored(brow, 'brow_r'), mirrorV3(browJ), 'head'),
    J('arm_l', arms.arm, [12.5, 49, 0], 'torso'),
    J('fore_l', arms.fore, [12.5, 37.5, 0], 'arm_l'),
    J('arm_r', mirrored(arms.arm, 'arm_r'), mirrorV3([12.5, 49, 0]), 'torso'),
    J('fore_r', mirrored(arms.fore, 'fore_r'), mirrorV3([12.5, 37.5, 0]), 'arm_r'),
    J('weapon', sceptre(), [-11.5, 24, 0.5], 'fore_r'),
    J('thigh_l', legs.thigh, [6, 30, 0], 'pelvis'),
    J('shin_l', legs.shin, [6, 18, 0], 'thigh_l'),
    J('thigh_r', mirrored(legs.thigh, 'thigh_r'), mirrorV3([6, 30, 0]), 'pelvis'),
    J('shin_r', mirrored(legs.shin, 'shin_r'), mirrorV3([6, 18, 0]), 'thigh_r'),
    J('coat', kilt(), [0.5, 33, 6], 'pelvis'),
  ];
  return {
    name: 'anubis',
    voxelSize: VS,
    parts,
    sockets: {
      hand_r: { part: 'fore_r', at: mirrorV3([12.5, 24, 0.5]) },
      hand_l: { part: 'fore_l', at: [12.5, 24, 0.5] },
      head_top: { part: 'head', at: [0.5, 73, 0] },
      chest: { part: 'torso', at: [0.5, 46, 7] },
      back: { part: 'torso', at: [0.5, 46, -7] },
      cape_anchor: { part: 'torso', at: [0.5, 51, -7] },
      sceptre_top: { part: 'weapon', at: [-12, 91, 0.5] },
      mouth: { part: 'jaw', at: [0.5, 56, 18] },
      eye_l: { part: 'head', at: eyeJ },
      eye_r: { part: 'head', at: mirrorV3(eyeJ) },
    },
    meta: {
      height: 73 * VS,
      earTop: 92 * VS,
      radius: 0.9,
      eyeColor: G.hi,
      expressions: defaultExpressions(ANUBIS_EXPRESSIONS),
      cloth: { cape: [0x1c1a3a, 0x0f0e22, G.base], capeLen: 2.4, capeWidth: 1.7 },
    },
  };
}
