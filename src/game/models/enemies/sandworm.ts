// Sandworm (1/12, STYLE v2): a big cartoon leviathan. Octagonal armoured
// segments (sandstone back plates, cream ribbed belly, little dorsal spines),
// a blunt armoured head with two big eye sockets under heavy brows and a round
// toothy maw whose lower lip (`jaw`) drops open. Faces +Z; segments trail toward
// -Z, each parented to the previous (`head` -> seg1 -> ... -> segN).
import { TRig, TOON, Ramp, RigSpec, VoxelModel, rbox, seg, paint, toonShade, eyeSocket, bossExpressions, hollow } from './tk';

const HIDE: Ramp = { base: 0xc89a62, shade: 0xa47a48, hi: 0xe2b87c, dark: 0x6e4e2a };
const PLATE: Ramp = { base: 0x8a5a36, shade: 0x6c4428, hi: 0xa8744a, dark: 0x40261a };
const BELLY: Ramp = { base: 0xf0dcb0, shade: 0xd2bc8e, hi: 0xfff0cc, dark: 0xa89268 };

/** octagonal prism slice around the Z axis at (0, cy): fills |x|,|y'| <= r with the corners cut */
function octSlice(m: VoxelModel, z: number, cy: number, r: number, col: (x: number, y: number) => number) {
  const R = Math.round(r);
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++) {
      if (Math.abs(x) + Math.abs(y) > R * 1.42) continue;
      m.set(x, cy + y, z, col(x, y));
    }
}

export function sandwormRig(o: { segments?: number; scale?: number } = {}): RigSpec {
  const N = Math.max(3, Math.min(16, Math.round(o.segments ?? 8)));
  const S = o.scale ?? 1;
  const VS = 1 / 12;
  const K = (v: number) => Math.round(v * S);
  const rig = new TRig(`sandworm_${N}_${S.toFixed(2)}`, VS);
  const R0 = K(14);
  const cy = R0 + 1;

  const skin = (r: number) => (x: number, y: number) => (y > r * 0.42 ? PLATE.base : y < -r * 0.5 ? BELLY.base : HIDE.base);

  // ------------------------------------------------------------ head
  const head = rig.part('head', undefined, [0.5, cy + 0.5, 0.5]);
  for (let z = -K(2); z <= K(12); z++) {
    const taper = z > K(8) ? (z - K(8)) * 0.6 : 0;
    octSlice(head, z, cy, R0 + 1 - taper, skin(R0));
  }
  // armoured crown plates (raised bands)
  for (const zz of [K(0), K(5)]) for (let z = zz; z < zz + K(3); z++) octSlice(head, z, cy, R0 + 2, (x, y) => (y > R0 * 0.3 ? PLATE.base : HIDE.base));
  paint(head, (x, y) => y < cy - R0 - 1, BELLY.base);
  const zf = K(12);
  // maw: round hole with a dark throat and a ring of teeth
  const mc = cy - K(3), mr = K(7.5);
  for (let x = -mr - 1; x <= mr + 1; x++)
    for (let y = -mr - 1; y <= mr + 1; y++) {
      const d = Math.hypot(x, y);
      if (d > mr) continue;
      for (let z = zf - K(5); z <= zf + 1; z++) head.del(x, mc + y, z);
      head.set(x, mc + y, zf - K(5), TOON.red.dark);
      if (d > mr - K(1.5)) for (let z = zf - K(4); z <= zf - K(1); z++) head.set(x, mc + y, z, TOON.red.shade);
    }
  // teeth: chunky triangles around the upper rim pointing inward
  for (let a = 0; a < 7; a++) {
    const t = Math.PI * (0.12 + (a / 6) * 0.76);
    const bx = Math.cos(t) * (mr - 0.5), by = Math.sin(t) * (mr - 0.5);
    seg(head, [bx, mc + by, zf - K(1)], [bx * 0.55, mc + by * 0.55, zf - K(1)], K(1.3), TOON.bone.base, undefined, K(0.5));
  }
  // eyes under heavy brows
  const ex0 = K(4), ex1 = K(4) + K(4) - 1, ey0 = cy + K(6), ey1 = cy + K(6) + K(4) - 1;
  eyeSocket(rig, 'head', ex0, ex1, ey0, ey1, zf);
  const bw = ex1 - ex0 + 1 + K(2);
  const brow = rig.part('brow_l', 'head', [(ex0 + ex1 + 1) / 2, ey1 + 1.5, zf + 1]);
  rbox(brow, ex0 - K(1), ey1 + 1, zf - K(1), ex0 - K(1) + bw - 1, ey1 + K(2), zf + 1, PLATE.dark, 1);

  // lower lip (jaw): drops open around the bottom of the maw
  const jaw = rig.part('jaw', 'head', [0.5, mc - mr + 0.5, zf - K(4) + 0.5]);
  for (let x = -mr - 1; x <= mr + 1; x++)
    for (let y = -mr - K(3); y <= -mr + K(3); y++) {
      const d = Math.hypot(x, y);
      if (y > -mr * 0.55 || d < mr - 0.2 || d > mr + K(3)) continue;
      for (let z = zf - K(4); z <= zf + 1; z++) jaw.set(x, mc + y, z, z >= zf ? HIDE.shade : BELLY.base);
    }
  for (let a = 0; a < 5; a++) {
    const t = -Math.PI * (0.2 + (a / 4) * 0.6);
    const bx = Math.cos(t) * (mr - 0.5), by = Math.sin(t) * (mr - 0.5);
    seg(jaw, [bx, mc + by, zf - K(1)], [bx * 0.6, mc + by * 0.6, zf - K(1)], K(1.1), TOON.bone.base, undefined, K(0.5));
  }

  // ------------------------------------------------------------ segments
  let parent = 'head';
  let zFront = -K(2) - 1;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const r = Math.max(K(5), Math.round(R0 * (1 - 0.45 * t * t) - (i === N ? K(2) : 0)));
    const len = K(9);
    const sg = rig.part(`seg${i}`, parent, [0.5, cy + 0.5, zFront + 0.5]);
    for (let z = zFront; z > zFront - len; z--) {
      const neck = z > zFront - K(1.5); // slim joint band at the front
      octSlice(sg, z, cy, neck ? r - K(1.5) : r, neck ? () => HIDE.dark : skin(r));
    }
    // belly ribs
    paint(sg, (x, y, z) => y < cy - r * 0.5 && (zFront - z) % K(3) === 0, BELLY.shade);
    // back plate rim + two dorsal spines
    for (let k2 = 0; k2 < 2; k2++) {
      const zz = zFront - K(3) - k2 * K(4);
      seg(sg, [0, cy + r, zz], [0, cy + r + K(4) - k2, zz - K(2)], K(1.4), TOON.bone.shade, undefined, K(0.4));
    }
    if (i === N) {
      // tail tip: blunt cone + spike
      for (let z = zFront - len; z > zFront - len - K(5); z--) octSlice(sg, z, cy, Math.max(1, r - (zFront - len - z) * 1.1), skin(r));
      seg(sg, [0, cy, zFront - len - K(5)], [0, cy + K(2), zFront - len - K(10)], K(1.6), TOON.bone.shade, undefined, K(0.4));
    }
    parent = `seg${i}`;
    zFront -= len;
  }

  for (const p of rig.parts) {
    toonShade(p.model, [HIDE, PLATE, BELLY]);
    hollow(p.model);
  }
  rig.mirrorLR();
  rig.socket('maw', 'head', [0.5, mc + 0.5, zf + 1]);
  rig.socket('throat', 'head', [0.5, mc + 0.5, zf - K(6)]);
  return rig.build({
    height: (cy + R0 + K(3)) * VS,
    radius: R0 * VS,
    length: (K(12) - zFront) * VS,
    segments: N,
    scale: S,
    kind: 'sandworm',
    boss: true,
    headY: cy * VS,
    expressions: bossExpressions(0.55),
    defaultExpression: 'angry',
  });
}
