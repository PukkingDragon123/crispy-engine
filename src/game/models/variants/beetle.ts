// Beetle variants (1/30 m, beetle convention): the Tick-Tock (bomb) Scarab and
// the Golden Scarab. Chunky, glossy, cartoon beetles with big square eye sockets.
// Parts: body (root), wing_l / wing_r (elytra halves, hinge on the top seam),
// head (+ jaw, eye_l / eye_r), leg_l1..3 / leg_r1..3, plus `bomb` on the bomb scarab.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { RigB, Part, VariantOpts, TOON, VR, VF, Ramp, VS, mx, eyeSockets } from './kit';

interface BeetleLook {
  shell: Ramp;
  under: Ramp;
  leg: Ramp;
  metal?: boolean;
  /** extra width for alphas */
  bulk?: number;
}

/** glossy cartoon highlight on the topmost voxels of a column range */
function gloss(p: Part, x0: number, x1: number, z0: number, z1: number, c: number, f?: number) {
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      for (let y = 40; y >= 0; y--)
        if (p.m.has(x, y, z)) {
          p.set(x, y, z, c, f);
          break;
        }
    }
}

/** shared chunky scarab: body, elytra, head with eye sockets, mandibles, six legs */
function scarabBase(rb: RigB, L: BeetleLook) {
  const f = L.metal ? VF.METAL : undefined;
  const b = L.bulk ?? 0;
  const S = L.shell, U = L.under;
  // ---------------------------------------------------------------- body (root)
  const body = rb.part('body', undefined, [0, 6, -2]);
  body.bev(-6 - b, 3, -8, 5 + b, 5, 3, U.base, 1, f); // belly
  for (let z = -7; z <= 2; z += 3) body.paint(-5 - b, 3, z, 4 + b, 3, z, U.shade); // belly segments
  body.box(-6 - b, 5, -9, 5 + b, 7, 1, S.dark, f); // core under the wing cases
  // pronotum (thorax shield)
  body.bev(-8 - b, 4, 2, 7 + b, 9, 8, S.base, 2, f);
  body.bev(-6 - b, 10, 3, 5 + b, 11, 7, S.base, 1, f);
  body.paintIf((x, y, z) => y <= 5 && z >= 1, S.shade);
  // pronotum shine
  gloss(body, 2, 3, 3, 5, S.hi, f);
  gloss(body, -4, -3, 3, 5, S.hi, f);
  // ---------------------------------------------------------------- elytra (split into wing halves)
  // chunky terraced dome (few big clean steps, like the reference skull)
  const dome = new Part('tmp', undefined, [0, 0, 0]);
  dome.bev(-9 - b, 6, -12, 8 + b, 9, 3, S.base, 2, f);
  dome.bev(-8 - b, 10, -11, 7 + b, 11, 2, S.base, 2, f);
  dome.bev(-6 - b, 12, -9, 5 + b, 13, 0, S.base, 2, f);
  // darker lower rim where the case meets the belly
  dome.paintIf((x, y) => y <= 6, S.shade);
  // centre suture
  gloss(dome, -1, 0, -13, 4, S.dark, f);
  // glossy cartoon shine: soft band + a crisp white spot on each case
  gloss(dome, 2, 4, -7, -3, S.hi, f);
  gloss(dome, -5, -3, -7, -3, S.hi, f);
  gloss(dome, 3, 3, -7, -6, 0xffffff, f);
  gloss(dome, -4, -4, -7, -6, 0xffffff, f);
  const wl = rb.part('wing_l', 'body', [0, 13, -4]);
  const wr = rb.part('wing_r', 'body', [0, 13, -4]);
  dome.m.forEach((x, y, z, rgb, fl) => (x >= 0 ? wl : wr).m.set(x, y, z, rgb, fl));
  // ---------------------------------------------------------------- head
  const head = rb.part('head', 'body', [0, 8, 9]);
  head.bev(-6 - b, 3, 9, 5 + b, 12, 15, S.base, 2, f);
  head.shade(S, { hi: false });
  // brow ridge over the eyes (gives the face attitude)
  head.box(-5 - b, 11, 15, 4 + b, 11, 15, S.hi, f);
  eyeSockets(rb, head, 2.5 + b * 0.5, 8.5, 16, 3, 3);
  // antennae with chunky clubs
  for (const s of [1, -1]) {
    head.set(mx(s, 3), 13, 12, L.leg.base).set(mx(s, 4), 14, 12, L.leg.base).set(mx(s, 5), 15, 12, L.leg.base);
    head.boxS(s, 5, 16, 11, 6, 17, 12, L.leg.hi);
  }
  // mandibles
  const jaw = rb.part('jaw', 'head', [0, 5, 15]);
  for (const s of [1, -1]) {
    jaw.boxS(s, 2, 4, 16, 3, 5, 16, L.leg.base, f);
    jaw.set(mx(s, 1), 4, 17, L.leg.hi, f);
  }
  // ---------------------------------------------------------------- legs
  const zs = [2, -3, -8];
  for (const s of [1, -1]) {
    zs.forEach((z0, i) => {
      const leg = rb.part(`leg_${s > 0 ? 'l' : 'r'}${i + 1}`, 'body', [s * (6 + b), 6, z0 + 1]);
      const o = b; // push legs out on bulky alphas
      const fz = z0 + (i === 0 ? 1 : i === 2 ? -1 : 0);
      leg.boxS(s, 6 + o, 5, z0, 8 + o, 6, z0 + 1, L.leg.base, f); // femur
      leg.boxS(s, 8 + o, 5, z0, 9 + o, 7, z0 + 1, L.leg.hi, f); // knee knob
      leg.boxS(s, 9 + o, 1, fz, 10 + o, 5, fz + 1, L.leg.base, f); // tibia
      leg.boxS(s, 9 + o, 0, fz - 1, 11 + o, 0, fz + 1, L.leg.shade, f); // foot pad
    });
  }
  return { body, head, jaw, wl, wr, dome };
}

// ============================================================================ bomb scarab
export function bombScarabRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const rb = new RigB(a ? 'bomb_scarab_alpha' : 'bomb_scarab', VS);
  const L: BeetleLook = a
    ? { shell: TOON.setRed, under: TOON.leatherDark, leg: TOON.black, bulk: 1 }
    : { shell: VR.shellBlue, under: TOON.leatherDark, leg: TOON.black };
  const { body, head } = scarabBase(rb, L);
  if (a) {
    // rhino horn + shoulder spikes: same beetle, much worse attitude
    head.box(-1, 13, 13, 0, 14, 15, TOON.bone.base).box(-1, 15, 14, 0, 16, 15, TOON.bone.base).box(-1, 17, 15, 0, 17, 15, TOON.bone.hi);
    for (const s of [1, -1]) body.boxS(s, 6, 12, 4, 6, 13, 5, TOON.bone.base).set(mx(s, 6), 14, 5, TOON.bone.hi);
    // war stripes on the pronotum
    body.paint(-2, 11, 2, 1, 11, 8, TOON.bone.base);
  }
  // ---------------------------------------------------------------- the bomb: a big cartoon bomb wearing an alarm clock
  const r = a ? 6.4 : 5.6;
  const cy = 12 + r, cz = -4.5;
  const bomb = rb.part('bomb', 'body', [0, 13, -4]);
  bomb.ball(0, cy, cz, r, VR.bomb.base);
  bomb.paintIf((x, y) => y + 0.5 < cy - r * 0.55, VR.bomb.shade);
  // cartoon shine (upper-left-front): soft spot + crisp white core
  const shine = (lim: number, c: number) => {
    const sh = [0.5, 0.6, 0.62];
    const sl = Math.hypot(sh[0], sh[1], sh[2]);
    bomb.paintIf((x, y, z) => {
      const dx = x + 0.5, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
      const d = Math.hypot(dx, dy, dz);
      return d > r - 1.3 && (dx * sh[0] + dy * sh[1] + dz * sh[2]) / (d * sl) > lim;
    }, c);
  };
  shine(0.86, VR.bomb.hi);
  shine(0.955, 0xf2eef8);
  // neck collar where the fuse comes out (top)
  const top = Math.round(cy + r) - 1;
  bomb.box(-2, top - 1, -6, 1, top + 1, -3, TOON.iron.base, VF.METAL).box(-2, top + 1, -6, 1, top + 1, -3, TOON.iron.hi, VF.METAL);
  // curly fuse + spark
  const fuse: [number, number, number][] = [[0, top + 2, -5], [0, top + 3, -5], [1, top + 4, -5], [2, top + 4, -5], [2, top + 5, -6]];
  for (const [x, y, z] of fuse) bomb.set(x, y, z, VR.fuse.base);
  bomb.set(2, top + 6, -6, VR.spark.base, VF.EMISSIVE).set(3, top + 6, -6, VR.spark.hi, VF.EMISSIVE).set(2, top + 7, -6, VR.spark.shade, VF.EMISSIVE);
  rb.socket('fuse_tip', 'bomb', [2.5, top + 6.5, -5.5]);
  // little alarm clock strapped to the front: brass case, cream dial, two bells
  const front = Math.round(cz + r);
  const ccy = Math.round(cy) + 1;
  const ccx = 0;
  for (let x = -3; x <= 2; x++)
    for (let y = ccy - 3; y <= ccy + 2; y++) {
      const d = Math.hypot(x + 0.5, y + 0.5 - ccy);
      if (d > 3.05) continue;
      bomb.set(x, y, front - 1, TOON.brass.shade, VF.METAL);
      bomb.set(x, y, front, d > 2.1 ? TOON.brass.base : VR.cream.base, d > 2.1 ? VF.METAL : undefined);
    }
  bomb.set(-1, ccy, front + 1, TOON.black.base).set(-1, ccy + 1, front + 1, TOON.black.base).set(0, ccy, front + 1, TOON.setRed.base);
  for (const s2 of [1, -1]) {
    bomb.boxS(s2, 2, ccy + 3, front - 1, 3, ccy + 3, front, TOON.brass.hi, VF.METAL);
    bomb.set(mx(s2, 2), ccy + 4, front - 1, TOON.brass.base, VF.METAL);
  }
  rb.socket('clock', 'bomb', [ccx, ccy + 0.5, front + 1]);
  // wind-up key on the back
  const back = Math.round(cz - r) - 1;
  const ky = Math.round(cy);
  bomb.box(-1, ky, back - 1, 0, ky + 1, back, TOON.brass.shade, VF.METAL);
  const kz = back - 2;
  for (const s2 of [1, -1]) {
    bomb.boxS(s2, 1, ky + 3, kz, 3, ky + 3, kz, TOON.brass.hi, VF.METAL);
    bomb.boxS(s2, 1, ky - 2, kz, 3, ky - 2, kz, TOON.brass.shade, VF.METAL);
    bomb.boxS(s2, 3, ky - 1, kz, 3, ky + 2, kz, TOON.brass.base, VF.METAL);
  }
  bomb.box(-1, ky - 1, kz, 0, ky + 2, kz, TOON.brass.base, VF.METAL);
  if (a) {
    // skull-and-crossbones decal on both sides of the bigger bomb
    for (const s of [1, -1]) {
      const sxp = mx(s, Math.ceil(r) - 1);
      const w = TOON.bone.hi;
      for (const [dy, dz] of [[1, 0], [1, 1], [1, -1], [2, 0], [2, 1], [2, -1], [0, 0], [3, 0]]) bomb.paint(sxp, Math.round(cy) + dy - 1, Math.round(cz) + dz, sxp, Math.round(cy) + dy - 1, Math.round(cz) + dz, w);
      bomb.paint(sxp, Math.round(cy) + 1, Math.round(cz) - 1, sxp, Math.round(cy) + 1, Math.round(cz) - 1, VR.bomb.dark);
      bomb.paint(sxp, Math.round(cy) + 1, Math.round(cz) + 1, sxp, Math.round(cy) + 1, Math.round(cz) + 1, VR.bomb.dark);
      for (const k of [-2, -1, 1, 2]) bomb.paint(sxp, Math.round(cy) - 2 + (k > 0 ? 0 : 0), Math.round(cz) + k, sxp, Math.round(cy) - 2, Math.round(cz) + k, w);
    }
    // iron band around the equator
    bomb.paintIf((x, y, z) => y === Math.round(cy) - 3 && Math.hypot(x + 0.5, y + 0.5 - cy, z + 0.5 - cz) > r - 1.3, TOON.iron.base, VF.METAL);
  }
  return rb.build({ height: a ? 0.95 : 0.85, radius: 0.38, beetle: true });
}

// ============================================================================ golden scarab
export function goldenScarabRig(o: VariantOpts = {}): RigSpec {
  const a = !!o.alpha;
  const rb = new RigB(a ? 'golden_scarab_alpha' : 'golden_scarab', VS);
  const bronze: Ramp = { base: 0x9a6a22, shade: 0x7a5016, hi: 0xc28e36, dark: 0x4e320c };
  const { body, head, jaw, wl, wr } = scarabBase(rb, { shell: TOON.gold, under: bronze, leg: bronze, bulk: a ? 1 : 0 });
  // lapis + turquoise collar across the pronotum (Egyptian jewellery)
  body.paintIf((x, y, z) => z === 7 && y >= 7, TOON.lapis.base);
  body.paintIf((x, y, z) => z === 6 && y >= 9, TOON.turquoise.base);
  body.paintIf((x, y, z) => z === 5 && y >= 10 && (x & 1) === 0, TOON.lapis.base);
  // piggy-bank coin slot across the top of the wing cases
  for (const w of [wl, wr])
    for (let x = -3; x <= 2; x++) {
      for (let y = 15; y >= 6; y--)
        if (w.m.has(x, y, -5)) {
          w.del(x, y, -5);
          w.set(x, y - 1, -5, TOON.black.base);
          break;
        }
    }
  // rude face: mouth + tongue out instead of fierce mandibles
  jaw.m.map.clear();
  head.paint(-2, 5, 15, 1, 5, 15, TOON.black.base);
  head.paint(-3, 6, 15, -3, 6, 15, TOON.black.base).paint(2, 6, 15, 2, 6, 15, TOON.black.base);
  jaw.box(-1, 4, 15, 0, 5, 16, VR.pink.base).box(-1, 3, 16, 0, 3, 17, VR.pink.hi).set(0, 4, 17, VR.pink.shade);
  // price tag on a string off the back
  body.set(1, 8, -10, VR.cream.shade).set(1, 7, -11, VR.cream.shade).set(2, 6, -12, VR.cream.shade);
  body.box(1, 1, -13, 5, 6, -13, VR.cream.base);
  body.set(1, 6, -13, VR.cream.dark).set(5, 1, -13, VR.cream.shade);
  // painted "$" on the tag
  for (const [x, y] of [[3, 5], [4, 5], [2, 4], [3, 3], [4, 2], [2, 1], [3, 1]]) body.set(x, y, -14, TOON.setRed.base);
  if (a) {
    // the fat cat: little crown with a ruby, money sack on its back
    for (let x = -4; x <= 3; x++) head.set(x, 13, 13, TOON.gold.hi, VF.METAL).set(x, 13, 12, TOON.gold.base, VF.METAL);
    for (const x of [-4, -1, 0, 3]) head.set(x, 14, 13, TOON.gold.hi, VF.METAL);
    head.set(-1, 13, 14, VR.ruby.base, VF.METAL).set(0, 13, 14, VR.ruby.hi, VF.METAL);
    const sack = rb.part('sack', 'body', [0, 13, -4]);
    sack.ball(0, 17.5, -5, 4.2, VR.canvas.base, undefined, 1.05);
    sack.shade(VR.canvas);
    sack.box(-1, 21, -6, 0, 23, -5, VR.canvas.shade).box(-2, 21, -6, 1, 21, -5, TOON.leather.base);
    sack.box(-2, 24, -6, 1, 24, -5, VR.canvas.hi);
    for (const [x, y] of [[0, 20], [1, 20], [-1, 19], [0, 18], [1, 17], [-1, 16], [0, 16], [0, 21], [0, 15]]) sack.paint(x, y, -1, x, y, 0, TOON.gold.shade);
  }
  return rb.build({ height: 0.6, radius: 0.45, beetle: true });
}
