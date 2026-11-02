// Khepri's Sunroller (1/20, STYLE v2): a big bronze dung beetle boss with a gold
// crown of horns, a battered cowboy hat it won in a fight, spiky digging legs
// and expressive brows. sunBallModel(): the "sun" it rolls — a huge packed-dung
// ball with Khepri's gold sun disc on both sides and junk stuck in it.
import { beetleRig } from './scarab';
import { TRig, TOON, RigSpec, VoxelModel, rbox, ell, seg, paint, bossExpressions, hollow, VF } from './tk';

export function sunrollerRig(): RigSpec {
  const spec = beetleRig({
    name: 'sunroller',
    vs: 1 / 20,
    k: 2.6,
    shell: { base: 0x6a4a2a, shade: 0x52381e, hi: 0x8a6438, dark: 0x2e1e0e },
    trim: TOON.gold,
    legs: TOON.black,
    horn: 'crown',
    spikes: true,
    brows: true,
    extra: (rig: TRig, K) => {
      // battered cowboy hat perched between the horns, a bullet hole in the crown
      const hd = rig.m('head');
      const y0 = K(10) + 1, cz = K(10);
      rbox(hd, -K(4), y0, cz - K(3), K(4), y0, cz + K(3), TOON.hat.base, 2, 'xz');
      rbox(hd, -K(2), y0 + 1, cz - K(1.6), K(2), y0 + K(2.2), cz + K(1.6), TOON.hat.base, 1.5, 'xz');
      paint(hd, (x, y, z) => y === y0 + 1 && Math.abs(z - cz) <= K(1.6) && Math.abs(x) <= K(2), TOON.red.base);
      hd.del(K(1), y0 + K(1.6), cz + K(1.6));
      hd.del(K(1), y0 + K(1.6) - 1, cz + K(1.6));
    },
  });
  spec.meta = { ...spec.meta, boss: true, kind: 'sunroller', expressions: bossExpressions(0.5), defaultExpression: 'angry', pushes: 'sun_ball' };
  return spec;
}

/** The rolling "sun": packed-dung ball, gold sun discs, embedded junk. Static, ~3.6 m. */
export function sunBallModel(): { model: VoxelModel; voxelSize: number; radius: number } {
  const VS = 1 / 20;
  const R = 1.8;
  const Rv = Math.round(R / VS);
  const m = new VoxelModel('sun_ball');
  const D = TOON.dung;
  ell(m, 0, Rv, 0, Rv, Rv, Rv, D.base);
  hollow(m);
  // deliberate lighter clumps (hand-placed patches, not noise)
  const dirs: [number, number, number][] = [[0.2, 0.9, 0.3], [-0.5, 0.4, 0.75], [0.6, -0.3, 0.7], [-0.4, -0.7, -0.5], [0.3, 0.2, -0.9], [-0.8, 0.5, -0.2], [0.1, -0.95, 0.2]];
  const surf = (d: [number, number, number], r = Rv): [number, number, number] => {
    const L = Math.hypot(...d);
    return [(d[0] / L) * r, (d[1] / L) * r + Rv, (d[2] / L) * r];
  };
  dirs.forEach((d, i) => {
    const c = surf(d);
    const pr = 5 + (i % 3) * 2;
    paint(m, (x, y, z) => (x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2 <= pr * pr, i % 2 ? D.hi : D.shade);
  });
  // Khepri sun discs on both flanks with ray lines
  for (const s of [1, -1]) {
    paint(m, (x, y, z) => s * x > Rv - 6 && (y - Rv) ** 2 + z * z <= 13 * 13, TOON.gold.base, VF.METAL);
    paint(m, (x, y, z) => s * x > Rv - 6 && (y - Rv) ** 2 + z * z <= 9 * 9, TOON.gold.hi, VF.METAL);
    paint(m, (x, y, z) => s * x > Rv - 6 && (y - Rv) ** 2 + z * z <= 4 * 4, TOON.red.base);
    for (let a = 0; a < 8; a++) {
      const t = (a / 8) * Math.PI * 2;
      paint(m, (x, y, z) => {
        if (s * x <= 0) return false;
        const yy = y - Rv, r = Math.hypot(yy, z);
        if (r < 15 || r > 26) return false;
        const ang = Math.atan2(yy, z);
        let d = Math.abs(ang - t);
        d = Math.min(d, Math.PI * 2 - d);
        return d * r < 1.4;
      }, TOON.poncho.hi);
    }
  }
  // junk: a cow skull, a wagon wheel, a boulder, a cactus chunk
  const sk = surf([0.15, 0.25, 1], Rv - 1);
  rbox(m, sk[0] - 4, sk[1] - 3, sk[2], sk[0] + 4, sk[1] + 3, sk[2] + 4, TOON.bone.base, 2);
  m.box(sk[0] - 3, sk[1], sk[2] + 4, sk[0] - 2, sk[1] + 1, sk[2] + 4, TOON.socket.base);
  m.box(sk[0] + 2, sk[1], sk[2] + 4, sk[0] + 3, sk[1] + 1, sk[2] + 4, TOON.socket.base);
  for (const sx of [-1, 1]) seg(m, [sk[0] + sx * 4, sk[1] + 2, sk[2] + 2], [sk[0] + sx * 9, sk[1] + 6, sk[2] + 1], 1.2, TOON.bone.hi, undefined, 0.6);
  const wh = surf([-0.9, 0.3, -0.3], Rv);
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * Math.PI * 2;
    m.set(wh[0], wh[1] + Math.round(Math.sin(t) * 9), wh[2] + Math.round(Math.cos(t) * 9), TOON.wood.base);
  }
  for (let a = 0; a < 4; a++) seg(m, [wh[0], wh[1], wh[2]], [wh[0], wh[1] + Math.sin((a * Math.PI) / 4) * 8, wh[2] + Math.cos((a * Math.PI) / 4) * 8], 0.6, TOON.wood.shade);
  const rk = surf([0.5, -0.4, -0.75], Rv);
  rbox(m, rk[0] - 4, rk[1] - 3, rk[2] - 4, rk[0] + 4, rk[1] + 3, rk[2] + 4, TOON.stone.base, 2);
  const cc = surf([0.7, 0.6, -0.3], Rv);
  rbox(m, cc[0] - 2, cc[1] - 2, cc[2] - 2, cc[0] + 2, cc[1] + 6, cc[2] + 2, TOON.cactus.base, 1);
  return { model: m, voxelSize: VS, radius: R };
}
