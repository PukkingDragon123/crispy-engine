// Scarab Swarmer — a chunky, cute-menacing beetle (STYLE v2, 1/30 m).
// Domed glossy elytra split by a dark suture, a toothed head shield that hangs
// over two big square eye sockets like a scowl, hooked mandibles, stubby legs.
// Beetle convention: body (root), head, jaw, wing_l/wing_r (elytra, hinge at
// the inner top edge, open with +z/-z roll), leg_l1..3 / leg_r1..3, eye_l/eye_r.
import { TRig, EnemyOpts, TOON, Ramp, RigSpec, V3, rbox, ell, seg, paint, toonShade, eyeSocket, pick, hollow, VF } from './tk';

export interface BeetleStyle {
  name: string;
  vs: number;
  /** size multiplier on the base 1/30 layout */
  k?: number;
  shell: Ramp;
  trim: Ramp;
  legs: Ramp;
  horn?: 'none' | 'rhino' | 'crown';
  spikes?: boolean;
  brows?: boolean;
  alpha?: boolean;
  extra?: (rig: TRig, K: (v: number) => number) => void;
  meta?: Record<string, any>;
}

export function beetleRig(st: BeetleStyle): RigSpec {
  const k = st.k ?? 1;
  const K = (v: number) => Math.round(v * k);
  const rig = new TRig(st.name, st.vs);
  const S = st.shell, T = st.trim, L = st.legs;

  // ------------------------------------------------------------ body: pronotum collar + belly + suture plate
  const body = rig.part('body', undefined, [0.5, K(5), 0]);
  ell(body, 0, K(5.5), K(-2), K(6.5), K(2.5), K(10), L.base); // belly
  // pronotum: rounded collar dome with a flat top
  ell(body, 0, K(5), K(4.5), K(7.4), K(7), K(5), S.base, VF.METAL, (x, y, z) => y >= K(5) && y <= K(10) && z >= K(1));
  paint(body, (x, y, z) => y <= K(5) + Math.max(0, k - 1) && z >= K(1), T.base, VF.METAL);
  // suture plate between the wings (reads as the dark centre seam)
  for (let z = K(-12); z <= K(0); z++)
    for (let y = K(5); y <= K(11); y++) {
      const top = K(5) + Math.sqrt(Math.max(0, 1 - ((z - K(-5)) / K(8.6)) ** 2)) * K(9.5) - 1;
      if (y <= top) body.set(0, y, z, S.dark);
    }

  // ------------------------------------------------------------ elytra (left; mirrored later): dome with a flat crown
  const wing = rig.part('wing_l', 'body', [1, K(12), K(1)]);
  ell(wing, 0, K(5), K(-5), K(8.4), K(9.5), K(8.6), S.base, VF.METAL, (x, y, z) => x >= 1 && y >= K(5) && y <= K(12) && z <= K(1));
  paint(wing, (x, y, z) => y <= K(5) + Math.max(0, k - 1), T.base, VF.METAL); // gold hem

  // ------------------------------------------------------------ head: big eyes under a toothed brow
  const head = rig.part('head', 'body', [0.5, K(7), K(8)]);
  rbox(head, K(-5), K(3), K(8), K(5), K(10), K(13), S.base, Math.max(2, K(2)), 'xyz', VF.METAL);
  // brow shield, 1 voxel over the eyes, three teeth
  rbox(head, K(-6), K(9), K(9), K(6), K(9) + Math.max(0, k - 1), K(14), T.base, Math.max(1, K(1.5)), 'xz', VF.METAL);
  for (const tx of [-4, 0, 4]) for (let i = 1; i <= Math.max(1, K(1)); i++) for (let w = -((k | 0) >> 1); w <= ((k | 0) >> 1); w++) head.set(K(tx) + w, K(9), K(14) + i, T.base, VF.METAL);
  paint(head, (x, y, z) => y <= K(4), S.shade, VF.METAL); // chin
  eyeSocket(rig, 'head', K(2), K(2) + K(3) - 1, K(6), K(6) + K(3) - 1, K(13));
  if (st.brows) {
    const bw = K(3);
    const brow = rig.part('brow_l', 'head', [K(2) + bw / 2, K(10) + 0.5, K(14)]);
    brow.box(K(2), K(10), K(13), K(2) + bw - 1, K(10) + Math.max(0, K(1) - 1), K(14), L.base);
  }
  // horns
  if (st.horn === 'rhino') {
    const pts: V3[] = [[0, K(10), K(11)], [0, K(14), K(13)], [0, K(18), K(12)], [0, K(20), K(9)]];
    for (let i = 0; i < pts.length - 1; i++) seg(head, pts[i], pts[i + 1], K(1.7) - i * 0.4 * k, T.base, VF.METAL, K(1.7) - (i + 1) * 0.4 * k);
  } else if (st.horn === 'crown') {
    for (const hx of [-3, 3]) seg(head, [K(hx), K(10), K(11)], [K(hx * 1.5), K(14), K(10)], Math.max(1, K(1.1)), T.base, VF.METAL, 0.6 * k);
  }

  // ------------------------------------------------------------ mandibles (jaw)
  const jaw = rig.part('jaw', 'head', [0.5, K(4), K(12)]);
  const mh = Math.max(1, K(1));
  for (const s of [1, -1]) {
    // straight blade forward, then a hooked tip curling inward
    const xo = s > 0 ? K(2) : -K(2) - mh;
    jaw.box(xo, K(3), K(13), xo + mh, K(3) + mh, K(15), L.base);
    const xi = s > 0 ? K(1) : -K(1) - mh + 1;
    jaw.box(Math.min(xi, xo), K(3), K(16), Math.max(xi, xo) + mh - 1, K(3) + mh, K(16) + mh - 1, L.hi);
  }

  // ------------------------------------------------------------ legs (left side; mirrored): sloped thigh, knee knob, straight shin, toe
  const legDefs: { hip: V3; knee: V3 }[] = [
    { hip: [4, 5, 4], knee: [8, 7, 6] },
    { hip: [5, 5, -2], knee: [9, 7, -2] },
    { hip: [4, 5, -8], knee: [8, 7, -10] },
  ];
  legDefs.forEach((d, i) => {
    const hip: V3 = [K(d.hip[0]), K(d.hip[1]), K(d.hip[2])];
    const knee: V3 = [K(d.knee[0]), K(d.knee[1]), K(d.knee[2])];
    const leg = rig.part(`leg_l${i + 1}`, 'body', [hip[0] + 0.5, hip[1] + 0.5, hip[2] + 0.5]);
    const th = Math.max(1, K(1));
    seg(leg, hip, knee, Math.max(1.2, K(1.3)), L.base);
    // shin: angled outward down to the foot
    const fz0 = i === 0 ? K(1.5) : i === 2 ? -K(1.5) : 0;
    const foot: V3 = [knee[0] + K(2), 0, knee[2] + fz0];
    seg(leg, knee, [foot[0], 1, foot[2]], Math.max(1, K(1.05)), L.base);
    // knee knob
    // foot pad
    leg.box(foot[0] - th, 0, foot[2] - th + 1, foot[0] + th, Math.max(0, th - 1), foot[2] + th, L.dark);
    if (st.spikes) seg(leg, [knee[0], knee[1] + K(1), knee[2]], [knee[0] + K(1), knee[1] + K(3), knee[2] - K(1)], Math.max(0.6, 0.6 * k), T.base, VF.METAL);
  });

  st.extra?.(rig, K);
  // shading pass on every part
  for (const p of rig.parts) toonShade(p.model, [S, T, L], { hi: p.name !== 'wing_l' && p.name !== 'body' });
  if (k >= 2) for (const p of rig.parts) hollow(p.model); // big boss beetles: keep only the shell
  rig.mirrorLR();
  rig.socket('back', 'body', [0.5, K(14), K(-4)]);
  rig.socket('head_top', 'head', [0.5, K(11), K(11)]);
  rig.socket('mouth', 'jaw', [0.5, K(4), K(17)]);
  return rig.build({ height: K(14) * st.vs, radius: K(9) * st.vs, length: K(30) * st.vs, kind: 'beetle', headY: K(8) * st.vs, ...(st.meta ?? {}) });
}

const SHELLS: [Ramp, Ramp][] = [
  [TOON.lapis, TOON.gold],
  [{ base: 0x3f9a5a, shade: 0x2e7442, hi: 0x6cc884, dark: 0x1c4a2a }, TOON.brass],
  [{ base: 0xb5632e, shade: 0x8a4a22, hi: 0xe08a4a, dark: 0x5a2c12 }, TOON.iron],
];

export function scarabRig(o: EnemyOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = o.variant ?? 0;
  const [shell, trim] = alpha ? [TOON.black, TOON.gold] : pick(SHELLS, v);
  return beetleRig({
    name: `scarab${alpha ? '_alpha' : ''}_v${v}`,
    vs: 1 / 30,
    shell,
    trim,
    legs: alpha ? TOON.black : TOON.black,
    horn: alpha ? 'rhino' : v === 2 ? 'crown' : 'none',
    spikes: alpha,
    alpha,
  });
}
