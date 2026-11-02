// Bone Vulture (1/24, STYLE v2): a chunky dark-feathered vulture with a fluffy
// cream neck ruff and a big bleached bird-skull head (dark square sockets, hooked
// bone beak). Modelled in flight pose: broad wings with fingered primaries and a
// sawtooth trailing edge, fanned tail, talons tucked under.
// Bird convention: body (root), head, jaw (lower beak), wing_l/wing_r, tail, eye_l/r.
import { TRig, EnemyOpts, TOON, Ramp, RigSpec, V3, rbox, ell, seg, chain, paint, toonShade, eyeSocket, pick, VF } from './tk';

const FEATHER: Ramp[] = [
  { base: 0x5a3e2c, shade: 0x45301f, hi: 0x76543c, dark: 0x2c1d12 },
  { base: 0x46424a, shade: 0x343038, hi: 0x5e5864, dark: 0x1e1c22 },
];
const RUFF: Ramp = { base: 0xeee2c8, shade: 0xcfc0a2, hi: 0xfff6e4, dark: 0xa89878 };
const NECK: Ramp = { base: 0xc8706a, shade: 0xa4544e, hi: 0xe08e86, dark: 0x6e302c };

export function vultureRig(o: EnemyOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = o.variant ?? 0;
  const F = alpha ? TOON.black : pick(FEATHER, v);
  const BN = TOON.bone;
  const rig = new TRig(`vulture${alpha ? '_alpha' : ''}_v${v}`, 1 / 24);

  // ------------------------------------------------------------ body
  const body = rig.part('body', undefined, [0.5, 12, 0]);
  ell(body, 0, 12, 0, 5.4, 5, 8.4, F.base);
  ell(body, 0, 10.5, 1, 4, 3, 6, F.hi, undefined, (x, y, z) => y <= 9); // lighter belly
  // fluffy ruff collar: a clean chunky donut at the front of the body
  ell(body, 0, 12.5, 6.5, 5.6, 5.2, 2.2, RUFF.base);
  for (let x = -6; x <= 6; x++) for (let y = 6; y <= 19; y++) for (let z = 4; z <= 9; z++) if (((x) / 3.2) ** 2 + ((y - 13) / 3) ** 2 <= 1 && z >= 6) body.del(x, y, z);
  // talons tucked back under the belly
  for (const s of [1, -1]) {
    seg(body, [s * 2, 8, 1], [s * 2, 6, -2], 1.1, TOON.husk.shade);
    for (const dz of [-1, 0, 1]) seg(body, [s * 2, 6, -2], [s * 2 + dz, 5, -4], 0.6, TOON.black.base);
  }

  // ------------------------------------------------------------ head: pink neck + bird skull
  const head = rig.part('head', 'body', [0.5, 14, 7]);
  seg(head, [0, 13, 6], [0, 15, 10], 2.2, NECK.base);
  rbox(head, -4, 13, 9, 4, 20, 15, BN.base, 2.5);
  rbox(head, -4, 19, 14, 4, 19, 16, BN.base, 1, 'xz'); // brow ledge for a mean squint
  eyeSocket(rig, 'head', 1, 3, 16, 18, 15);
  // upper beak: a bone hook below the eyes, dark tip
  chain(head, [[0, 15, 15], [0, 15, 18], [0, 14, 20], [0, 12, 21]], [1.6, 1.4, 1.1, 0.7], BN.hi);
  paint(head, (x, y, z) => z >= 20 && y <= 13, TOON.black.base);
  head.set(1, 16, 17, TOON.socket.base).set(-1, 16, 17, TOON.socket.base);
  if (alpha) {
    // red crest of quills
    for (let i = 0; i < 4; i++) seg(head, [0, 20, 13 - i * 2], [0, 24 - i, 10 - i * 2.5], 0.9, TOON.setRed.base, undefined, 0.5);
    rbox(head, -1, 15, 17, 1, 16, 18, TOON.gold.base, 0.5, 'xyz', VF.METAL); // gold beak ring
  }
  const jaw = rig.part('jaw', 'head', [0.5, 14, 15]);
  chain(jaw, [[0, 13.5, 15], [0, 13, 18]], [1.1, 0.8], BN.shade);

  // ------------------------------------------------------------ wing (left; mirrored)
  const wing = rig.part('wing_l', 'body', [5.5, 13.5, 2]);
  const span = alpha ? 32 : 30;
  for (let x = 5; x <= span - 6; x++) {
    const t = (x - 5) / (span - 11);
    const lead = Math.round(4 - t * 3);
    const chord = Math.round(11 - t * 4);
    for (let dz = 0; dz < chord; dz++) {
      const z = lead - dz;
      // sawtooth trailing edge: every third column a feather is a step shorter
      if (dz === chord - 1 && x % 3 === 0) continue;
      const thick = dz < 3 ? 2 : 1;
      for (let y = 14 - thick + 1; y <= 14; y++) wing.set(x, y, z, dz < 2 ? RUFF.shade : dz < 4 ? F.hi : F.base);
    }
  }
  // fingered primaries
  for (let f = 0; f < 5; f++) {
    const z0 = 0 - f * 2;
    const len = 8 - Math.abs(f - 1.5) * 1.2;
    seg(wing, [span - 6, 14, z0], [span - 6 + len, 14 - f * 0.4, z0 - 1 - f * 0.8], 0.75, F.shade);
  }
  // bony wrist knuckle on the leading edge
  rbox(wing, span - 8, 13, 2, span - 6, 15, 4, BN.base, 1);

  // ------------------------------------------------------------ tail fan
  const tail = rig.part('tail', 'body', [0.5, 12.5, -7]);
  for (let z = -7; z >= -13; z--) {
    const w = Math.round(2 + (-7 - z) * 0.6);
    for (let x = -w; x <= w; x++) {
      if (z === -13 && Math.abs(x) % 2 === 1) continue;
      tail.set(x, 12, z, z <= -11 ? F.shade : F.base).set(x, 13, z, F.base);
    }
  }

  for (const p of rig.parts) if (p.name !== 'wing_l' && p.name !== 'tail') toonShade(p.model, [F, RUFF, NECK, BN]);
  rig.mirrorLR();
  rig.socket('beak', 'jaw', [0.5, 13, 18]);
  rig.socket('talons', 'body', [0.5, 5, -3]);
  return rig.build({ height: 20 / 24, radius: 0.35, wingspan: (span * 2 + 2) / 24, kind: 'vulture', flying: true, headY: 17 / 24 });
}
