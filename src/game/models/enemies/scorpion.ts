// Giant Scorpion (1/24) and Big Bertha, the matriarch (1/20) — STYLE v2.
// Chunky toy-like arachnid: rounded carapace with a big-eyed face, segmented
// back plates with raised lips, a pill-segment tail curling over the back to an
// amber stinger bulb, and oversized boxy pincers. Scorpion convention:
// body (root), tail1..5, stinger, arm_l/r, pincer_l/r (movable outer finger,
// closes with -y on the left), leg_l1..4 / leg_r1..4, jaw (chelicerae), eye_l/r.
import { TRig, EnemyOpts, TOON, Ramp, RigSpec, V3, rbox, ell, seg, chain, paint, toonShade, eyeSocket, bossExpressions, pick, hollow, VF } from './tk';

interface ScorpStyle {
  name: string;
  vs: number;
  k: number;
  shell: Ramp;
  belly: Ramp;
  sting: Ramp;
  trim: Ramp;
  spike?: Ramp;
  spikes?: boolean;
  brows?: boolean;
  matriarch?: boolean;
}

function scorpionBuild(st: ScorpStyle): RigSpec {
  const k = st.k;
  const K = (v: number) => Math.round(v * k);
  const R = (v: number) => v * k;
  const rig = new TRig(st.name, st.vs);
  const S = st.shell, B = st.belly, G = st.sting, T = st.trim, SP = st.spike ?? st.trim;

  // ------------------------------------------------------------ body: carapace + plated mesosoma + belly
  const body = rig.part('body', undefined, [0.5, K(9), 0]);
  ell(body, 0, R(6.5), R(-2), R(7), R(2.5), R(12), B.base);
  // carapace: rounded block with an inset crown step
  rbox(body, K(-8), K(6), K(0), K(8), K(10), K(11), S.base, R(3), 'xz');
  rbox(body, K(-7), K(11), K(1), K(7), K(11) + K(1) - 1, K(10), S.base, R(3), 'xz');
  rbox(body, K(-5), K(12), K(2), K(5), K(12) + K(1) - 1, K(8), S.base, R(2.5), 'xz');
  // mesosoma: five plates with raised rear lips (sawtooth profile)
  for (let i = 0; i < 5; i++) {
    const z1 = K(-1 - 3 * i), z0 = K(-3 - 3 * i);
    const w = K(8 - Math.floor(i * 0.8));
    rbox(body, -w, K(6), z0, w, K(10), z1, S.base, R(2), 'xz');
    rbox(body, -w + K(1), K(11), z0, w - K(1), K(11) + K(1) - 1, z0 + K(1) - 1, T.base, R(1.5), 'xz');
    // seam groove at the plate front
    for (let x = -w + 1; x <= w - 1; x++) for (let y = K(8); y <= K(10); y++) if (body.has(x, y, z1) && !body.has(x, y + 1, z1)) body.set(x, y, z1, S.dark);
  }
  // face
  eyeSocket(rig, 'body', K(2), K(2) + K(3) - 1, K(8), K(8) + K(3) - 1, K(11));
  if (st.brows) {
    const bw = K(4);
    const brow = rig.part('brow_l', 'body', [K(2) + bw / 2, K(11) + 0.5, K(11) + 1]);
    brow.box(K(1), K(11), K(11), K(1) + bw - 1, K(11) + Math.max(0, K(1) - 1), K(12), S.dark);
  }

  // chelicerae (jaw)
  const jaw = rig.part('jaw', 'body', [0.5, K(7), K(11)]);
  for (const s of [1, -1]) {
    const x0 = s > 0 ? K(1) : -K(3), x1 = s > 0 ? K(3) : -K(1);
    rbox(jaw, x0, K(5), K(11), x1, K(7), K(13), S.shade, 1);
    jaw.box(s > 0 ? K(1) : -K(1), K(5), K(14), s > 0 ? K(1) : -K(1), K(5), K(14), TOON.bone.base);
  }

  // ------------------------------------------------------------ tail: pill segments arcing over the back
  const P: V3[] = [
    [0, K(9), K(-15)],
    [0, K(13), K(-21)],
    [0, K(20), K(-24)],
    [0, K(27), K(-22)],
    [0, K(31), K(-16)],
    [0, K(31), K(-10)],
  ];
  const tr = [3.4, 3.1, 2.9, 2.7, 2.5];
  let parent = 'body';
  for (let i = 0; i < 5; i++) {
    const a = P[i], b = P[i + 1];
    const name = `tail${i + 1}`;
    const tp = rig.part(name, parent, [a[0] + 0.5, a[1] + 0.5, a[2] + 0.5]);
    // pill segment, starting a little past the joint so a slim dark neck shows the segmentation
    const L0 = Math.hypot(b[1] - a[1], b[2] - a[2]) || 1;
    const a2: V3 = [a[0], a[1] + ((b[1] - a[1]) / L0) * R(1.6), a[2] + ((b[2] - a[2]) / L0) * R(1.6)];
    seg(tp, a, a2, R(tr[i] * 0.7), S.dark);
    seg(tp, a2, b, R(tr[i]), S.base, undefined, R(tr[i] * 0.94));
    if (st.spikes && i >= 1) {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2;
      const cy = K(20), cz = K(-14); // rough centre of the tail arc
      const ny = my - cy, nz = mz - cz, L = Math.hypot(ny, nz) || 1;
      const n: V3 = [0, ny / L, nz / L];
      seg(tp, [mx, my, mz], [mx, my + n[1] * R(tr[i] + 2.5), mz + n[2] * R(tr[i] + 2.5)], R(0.9), SP.base, VF.METAL, R(0.4));
    }
    parent = name;
  }
  const sb = P[5];
  const sting = rig.part('stinger', 'tail5', [sb[0] + 0.5, sb[1] + 0.5, sb[2] + 0.5]);
  ell(sting, 0, sb[1], sb[2] + R(1.5), R(3.3), R(3), R(3.8), G.base);
  paint(sting, (x, y, z) => y >= sb[1] + R(1.5) && z <= sb[2] + R(2), G.hi);
  chain(sting, [[0, sb[1] - R(0.5), sb[2] + R(4.5)], [0, sb[1] - R(2), sb[2] + R(7)], [0, sb[1] - R(5), sb[2] + R(8)]], [R(1.4), R(1), R(0.5)], TOON.black.base);

  // ------------------------------------------------------------ pincers (left; mirrored)
  const sh: V3 = [K(6), K(8), K(10)];
  const elbow: V3 = [K(11), K(9), K(13)];
  const wrist: V3 = [K(11), K(10), K(17)];
  const arm = rig.part('arm_l', 'body', [sh[0] + 0.5, sh[1] + 0.5, sh[2] + 0.5]);
  seg(arm, sh, elbow, R(1.9), S.base);
  seg(arm, elbow, wrist, R(2), S.base);
  seg(arm, elbow, elbow, R(2.3), S.shade); // elbow knob
  // manus: big rounded block
  const hx0 = K(8), hx1 = K(15), hy0 = K(7), hy1 = K(13), hz0 = K(17), hz1 = K(23);
  rbox(arm, hx0, hy0, hz0, hx1, hy1, hz1, S.base, R(2.6));
  // fixed (inner) finger
  chain(arm, [[K(9.5), K(9.5), K(23)], [K(9.5), K(9.5), K(27)], [K(11), K(9.5), K(30.5)]], [R(1.7), R(1.2), R(0.6)], S.base);
  for (let i = 0; i < 3; i++) arm.set(K(11), K(9.5), K(24) + i * K(2), TOON.bone.base);
  // movable (outer) finger
  const pin = rig.part('pincer_l', 'arm_l', [K(14) + 0.5, K(10) + 0.5, K(22) + 0.5]);
  chain(pin, [[K(14), K(10), K(23)], [K(14), K(10), K(27)], [K(12.5), K(10), K(30.5)]], [R(1.7), R(1.2), R(0.6)], S.base);
  for (let i = 0; i < 3; i++) pin.set(K(12.5), K(10), K(24) + i * K(2), TOON.bone.base);
  if (st.spikes) for (const zz of [K(18), K(21)]) seg(arm, [K(15), K(12), zz], [K(17), K(15), zz - K(1)], R(0.9), SP.base, VF.METAL, R(0.4));

  // ------------------------------------------------------------ legs (left; mirrored)
  const LEGS: [number, number][] = [
    [7, 2],
    [3, 1],
    [-1, -1],
    [-5, -2.5],
  ];
  LEGS.forEach(([z, spread], i) => {
    const hip: V3 = [K(7), K(7), K(z)];
    const knee: V3 = [K(12), K(11), K(z + spread)];
    const foot: V3 = [K(14.5), K(1), K(z + spread * 1.6)];
    const leg = rig.part(`leg_l${i + 1}`, 'body', [hip[0] + 0.5, hip[1] + 0.5, hip[2] + 0.5]);
    seg(leg, hip, knee, R(1.4), S.base);
    seg(leg, knee, foot, R(1.15), S.base, undefined, R(0.95));
    seg(leg, knee, knee, R(1.6), S.shade);
    leg.box(foot[0] - K(1), 0, foot[2] - K(1), foot[0] + K(1), Math.max(0, K(1) - 1), foot[2] + K(1), S.dark);
  });

  // ------------------------------------------------------------ alpha / matriarch dressing
  if (st.spikes) {
    for (const [x, z] of [[-4, 4], [0, 6], [4, 4]] as [number, number][]) seg(body, [K(x), K(12), K(z)], [K(x * 1.2), K(15.5), K(z - 1)], R(1.1), SP.base, VF.METAL, R(0.4));
  }
  if (st.matriarch) {
    // a little gold crown on the carapace crown
    rbox(body, K(-4), K(13), K(4), K(4), K(13), K(8), TOON.gold.base, R(1.2), 'xz', VF.METAL);
    for (const x of [-3, 0, 3]) body.box(K(x), K(14), K(6), K(x) + Math.max(0, K(1) - 1), K(14) + K(2 + (x === 0 ? 1 : 0)), K(6) + Math.max(0, K(1) - 1), TOON.gold.base, VF.METAL);
    body.box(0, K(17), K(6), Math.max(0, K(1) - 1), K(17), K(6) + Math.max(0, K(1) - 1), TOON.red.base);
    // three babies riding on her back plates
    const babies: [number, number, number][] = [[-4, -4, 0.4], [3, -8, -0.3], [-1, -12, 0.2]];
    for (const [bx, bz] of babies) {
      const x = K(bx), z = K(bz), y = K(11) + 1;
      rbox(body, x - 2, y, z - 3, x + 2, y + 2, z + 2, S.hi, 1);
      body.box(x - 1, y + 1, z + 2, x - 1, y + 1, z + 2, TOON.socket.base);
      body.box(x + 1, y + 1, z + 2, x + 1, y + 1, z + 2, TOON.socket.base);
      chain(body, [[x, y + 2, z - 3], [x, y + 5, z - 4], [x, y + 6, z - 1]], [1, 0.8, 0.6], S.hi);
      for (const s of [-1, 1]) body.box(x + s * 3, y, z + 2, x + s * 3, y + 1, z + 3, S.hi);
    }
  }

  for (const p of rig.parts) toonShade(p.model, [S, B, G, T, SP]);
  if (k >= 2) for (const p of rig.parts) hollow(p.model);
  rig.mirrorLR();
  rig.socket('stinger_tip', 'stinger', [0.5, sb[1] - R(5), sb[2] + R(8)]);
  rig.socket('back', 'body', [0.5, K(12), K(-5)]);
  rig.socket('mouth', 'jaw', [0.5, K(6), K(14)]);
  rig.socket('claw_l', 'pincer_l', [K(12.5) + 0.5, K(10) + 0.5, K(30.5)]);
  rig.socket('claw_r', 'pincer_r', [-K(12.5) + 0.5, K(10) + 0.5, K(30.5)]);
  return rig.build({
    height: (K(31) + R(3.5)) * st.vs,
    radius: K(11) * st.vs,
    length: K(54) * st.vs,
    kind: 'scorpion',
    headY: K(9) * st.vs,
    poisonResist: 0.75,
  });
}

const CHITIN: Ramp[] = [
  { base: 0xb04a2a, shade: 0x88361e, hi: 0xd8693e, dark: 0x5a1e10 },
  { base: 0xc8995a, shade: 0xa47a42, hi: 0xe6b878, dark: 0x6e4e2a },
  { base: 0x4a4452, shade: 0x36323e, hi: 0x625a6c, dark: 0x201c26 },
];
const AMBER: Ramp = { base: 0xe8a23c, shade: 0xc07e26, hi: 0xffc864, dark: 0x8a5214 };

export function giantScorpionRig(o: EnemyOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = o.variant ?? 0;
  return scorpionBuild({
    name: `giant_scorpion${alpha ? '_alpha' : ''}_v${v}`,
    vs: 1 / 24,
    k: alpha ? 1.15 : 1,
    shell: alpha ? TOON.black : pick(CHITIN, v),
    belly: alpha ? TOON.setRed : TOON.sand,
    sting: alpha ? TOON.setRed : AMBER,
    trim: alpha ? TOON.setRed : pick(CHITIN, v),
    spike: TOON.gold,
    spikes: alpha,
  });
}

/** Big Bertha: the scorpion matriarch miniboss — gold crown, babies on her back, expressive brows */
export function bigBerthaRig(): RigSpec {
  const spec = scorpionBuild({
    name: 'big_bertha',
    vs: 1 / 20,
    k: 2.2,
    shell: { base: 0x9a3a2e, shade: 0x742a22, hi: 0xc45a44, dark: 0x481812 },
    belly: TOON.sand,
    sting: AMBER,
    trim: { base: 0x6a2a20, shade: 0x521e18, hi: 0x8a3a2c, dark: 0x30100c },
    brows: true,
    matriarch: true,
  });
  spec.meta = { ...spec.meta, boss: true, expressions: bossExpressions(0.4), defaultExpression: 'smug' };
  return spec;
}
