// MASTER OF PUPPETS: the Hanged Man of Set's cult, a marionette god who works
// other puppets. 1/20 m voxels, a gaunt 4.4 m lacquered-ebony marionette hung
// from a floating golden tau cross (the Hanged Man's T), a bronze bell swinging
// from its arm ("For Whom the Bell Tolls").
//
// Look: black lacquer wood with gold-leaf bands and lapis inlay, turned wooden
// ball joints (each knob carries a gilt groove), a carved ribcage with gaps
// between the ribs, a broad gold-and-lapis usekh collar, a pleated Set-red
// shendyt kilt, curled slippers, long gilt nail guards. The head is the Set
// animal: a long down-curved snout with a hinged nutcracker jaw and gold teeth,
// tall flat-topped ears with lapis insides, almond sockets holding modelled
// eyes (electric-blue glowing iris, slit pupil, glint). The tarot XII sigil
// (a tau with a hanging figure) is inlaid on the belly. In each fist he holds a
// marionette control cross with gilt tips; strings run from their tips.
//
// Rig (faces +Z, left = +X; authored in place):
//   pelvis (root) → torso → head → jaw, eye_l/_r
//   torso → arm_l → fore_l → hand_l → ctrl_l   (mirrored _r)
//   pelvis → thigh_l → shin_l → foot_l          (mirrored _r)
//   tau (second root, the floating cross) → bell
// Sockets: tip_a_l.._d_l / _r (control-cross tips), tau_head, tau_w_l/_r, tau_k_l/_r
// (where his own strings hang from), str_head/str_w_l/str_k_l (where they tie on),
// cape_anchor (the tattered mantle), mouth.
import { TRig, VF, TOON, ell, seg, chain, rbox, paintSurf, toonShade, bossExpressions } from '../tk';
import type { RigSpec, Ramp } from '../tk';

const VS = 1 / 20;
const r = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });
const EBONY = r(0x2e221d, 0x1d1512, 0x4c3a30, 0x110b09);
const GOLD = TOON.gold;
const LAPIS = TOON.lapis;
const KILT = r(0x8a1e1a, 0x5e1210, 0xb8382a, 0x3a0a08);
const BRONZE = r(0xa8742e, 0x7a521e, 0xd8a050, 0x4a3010);
const EYE = { rim: 0x0c1428, iris: 0x8fd4ff, ring: 0x3a8cff, pupil: 0x050a18, glint: 0xffffff };

export function puppeteerRig(): RigSpec {
  const rig = new TRig('master_puppets', VS);
  const W = EBONY.base;

  // ---------------------------------------------------------------- pelvis + kilt
  const pelvis = rig.part('pelvis', undefined, [0.5, 40, 0.5]);
  ell(pelvis, 0.5, 40, 0.5, 5.5, 3.6, 4, W);
  // the shendyt: a pleated kilt flaring from the hip band, a gilt hem, a front apron
  for (let y = 30; y <= 43; y++) {
    const k = (43 - y) / 13;
    const rx = 5.8 + k * 2.4, rz = 4.3 + k * 1.6;
    for (let x = Math.floor(-rx); x <= Math.ceil(rx); x++)
      for (let z = Math.floor(-rz); z <= Math.ceil(rz); z++) {
        const d = ((x - 0.0) / rx) ** 2 + ((z - 0.0) / rz) ** 2;
        if (d > 1 || d < 0.62) continue;
        const pleat = ((x + 40) >> 1) % 2 === 0;
        let c = pleat ? KILT.base : KILT.shade;
        if (y <= 31) c = GOLD.base;
        else if (y >= 42) c = GOLD.hi;
        pelvis.set(x, y, z, c);
      }
  }
  // front apron: a long panel with a gilt border and a lapis tau
  for (let y = 29; y <= 41; y++)
    for (let x = -2; x <= 3; x++) {
      const edge = x === -2 || x === 3 || y === 29;
      pelvis.set(x, y, 7, edge ? GOLD.base : KILT.hi);
      pelvis.set(x, y, 6, KILT.shade);
    }
  for (let y = 33; y <= 38; y++) pelvis.set(0, y, 8, LAPIS.base), pelvis.set(1, y, 8, LAPIS.base);
  for (let x = -1; x <= 2; x++) pelvis.set(x, 38, 8, LAPIS.base);

  // ---------------------------------------------------------------- torso: waist knob, carved ribcage, collar
  const torso = rig.part('torso', 'pelvis', [0.5, 46, 0.5]);
  ell(torso, 0.5, 45.5, 0.5, 3.6, 2.6, 3.2, W); // turned waist knob
  for (let x = -3; x <= 4; x++) for (let z = -3; z <= 4; z++) if (Math.hypot(x - 0.5, z - 0.5) <= 3.7 && Math.hypot(x - 0.5, z - 0.5) > 2.6) torso.set(x, 45, z, GOLD.base);
  // chest: an inverted-egg cage, ribs as separate rows with dark gaps between
  for (let y = 47; y <= 61; y++) {
    const t = (y - 47) / 14;
    const rx = 4.6 + Math.sin(t * Math.PI * 0.85) * 4.0, rz = 3.4 + Math.sin(t * Math.PI * 0.8) * 2.2;
    for (let x = Math.floor(-rx); x <= Math.ceil(rx + 1); x++)
      for (let z = Math.floor(-rz); z <= Math.ceil(rz + 1); z++) {
        const d = ((x - 0.5) / rx) ** 2 + ((z - 0.5) / rz) ** 2;
        if (d > 1) continue;
        const shell = d > 0.55;
        const gap = shell && z > -1 && y >= 48 && y <= 57 && y % 2 === 0 && Math.abs(x - 0.5) > 1.2;
        torso.set(x, y, z, gap ? EBONY.dark : W);
      }
  }
  // the sternum: a gilt strip; the tarot XII sigil on the belly (a tau and a figure hung head-down)
  for (let y = 47; y <= 57; y++) torso.set(0, y, 6, GOLD.base), torso.set(1, y, 6, GOLD.base);
  for (let x = -2; x <= 3; x++) torso.set(x, 52, 7, GOLD.hi);
  torso.set(0, 51, 7, GOLD.hi), torso.set(1, 51, 7, GOLD.hi), torso.set(0, 50, 7, LAPIS.hi), torso.set(1, 49, 7, LAPIS.hi), torso.set(0, 48, 7, LAPIS.hi);
  // the usekh collar: concentric gold / lapis / turquoise rows over the shoulders and chest
  for (let y = 56; y <= 62; y++)
    for (let x = -10; x <= 11; x++)
      for (let z = -5; z <= 7; z++) {
        if (!torso.has(x, y, z) && !(y >= 58 && Math.abs(x - 0.5) < 10)) continue;
        const dx = x - 0.5, dz = z - 0.5;
        const ring = Math.hypot(dx * 0.75, dz, (y - 62) * 1.3);
        if (ring < 4.2 || ring > 9.3 || dz < -3) continue;
        const band = Math.floor((ring - 4.2) / 1.3);
        const c = [GOLD.hi, LAPIS.base, GOLD.base, TOON.turquoise.base, GOLD.base][band % 5];
        if (y === 58 || torso.has(x, y, z)) torso.set(x, y, z, c, VF.SOLID | (band % 2 === 0 ? VF.METAL : 0));
      }
  // neck: three turned vertebra rings
  for (let i = 0; i < 3; i++) ell(torso, 0.5, 62.5 + i * 1.6, 0.5, 2.2 - i * 0.2, 0.8, 2.0, i === 1 ? GOLD.base : W);
  rig.socket('cape_anchor', 'torso', [0.5, 60, -4.5]);

  // ---------------------------------------------------------------- head: the Set animal
  const head = rig.part('head', 'torso', [0.5, 64, 0.5]);
  ell(head, 0.5, 71, 0.5, 5.2, 5.6, 5.8, W);
  chain(head, [[0.5, 72, 3], [0.5, 71.5, 8], [0.5, 70, 12], [0.5, 67.6, 15]], [3.4, 2.9, 2.2, 1.5], W);
  // the mouth line: everything under it is the jaw
  const mouthY = (z: number) => 69.2 - Math.max(0, z - 4) * 0.22;
  const del: [number, number, number][] = [];
  head.forEach((x, y, z) => {
    if (z > 3 && y < mouthY(z)) del.push([x, y, z]);
  });
  for (const [x, y, z] of del) head.del(x, y, z);
  // gilt stripes along the snout, gold upper teeth
  paintSurf(head, (x, y, z) => z > 5 && (Math.round(z) % 4 === 0) && y > mouthY(z) + 1, GOLD.base);
  for (let z = 5; z <= 14; z += 2) for (const x of [-1, 2]) head.set(x, Math.floor(mouthY(z)) - 0, z, 0xfff1c8);
  // tall Set ears with squared tips and lapis insides
  for (const s of [1, -1]) {
    for (let y = 75; y <= 88; y++) {
      const w = y >= 85 ? 2.2 : 1.4;
      const cx = s * (3 + (y - 75) * 0.12) + 0.5;
      for (let x = Math.floor(cx - w); x <= Math.ceil(cx + w); x++)
        for (let z = -2; z <= 0; z++) {
          if (Math.abs(x - cx) > w) continue;
          const inner = z === 0 && Math.abs(x - cx) < w - 0.6 && y < 87 && y > 76;
          head.set(x, y, z, inner ? LAPIS.base : y >= 87 ? GOLD.base : W);
        }
    }
  }
  // almond sockets for the eyes
  for (const s of [1, -1])
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++) {
        const ex = s * 3 + 0.5 + x * 0.9, ey = 72.5 + y * 0.7;
        for (let z = 3; z <= 7; z++) {
          const vx = Math.round(ex), vy = Math.round(ey);
          if (head.has(vx, vy, z) && Math.hypot(vx - (s * 3 + 0.5), (vy - 72.5) * 1.4) < 1.9 && z >= 4) head.set(vx, vy, z, 0x0a0606);
        }
      }
  // kohl line (gold) round the sockets, a lapis brow band across the crown
  paintSurf(head, (x, y, z) => y >= 74 && y <= 75 && z >= -1, LAPIS.base);
  paintSurf(head, (x, y, z) => y === 76 && z >= 0, GOLD.hi);
  {
    const eye = rig.part('eye_l', 'head', [3.5, 72.5, 5.2]);
    for (let x = 2; x <= 4; x++)
      for (let y = 72; y <= 73; y++)
        for (let z = 4; z <= 6; z++) {
          const front = z === 6;
          let c = EYE.rim, f: number = VF.SOLID | VF.METAL;
          if (front) {
            if (x === 3 && y === 72) c = EYE.pupil;
            else if (x === 3 && y === 73) (c = EYE.glint), (f = VF.SOLID | VF.GLOW);
            else (c = x === 2 ? EYE.ring : EYE.iris), (f = VF.SOLID | VF.GLOW);
          } else if (z === 5) (c = EYE.ring), (f = VF.SOLID | VF.EMISSIVE);
          eye.set(x, y, z, c, f);
        }
  }
  // the nutcracker jaw with gold teeth
  const jaw = rig.part('jaw', 'head', [0.5, 69, 3.5]);
  chain(jaw, [[0.5, 68, 3.5], [0.5, 67.2, 8], [0.5, 65.8, 12.5]], [2.5, 2.0, 1.3], W);
  {
    const d2: [number, number, number][] = [];
    jaw.forEach((x, y, z) => {
      if (y >= mouthY(z)) d2.push([x, y, z]);
    });
    for (const [x, y, z] of d2) jaw.del(x, y, z);
    for (let z = 5; z <= 12; z += 2) for (const x of [-1, 2]) jaw.set(x, Math.floor(mouthY(z)) - 1, z, 0xfff1c8);
    paintSurf(jaw, (x, y, z) => y < 66.5 && z > 7, GOLD.shade);
  }
  rig.socket('mouth', 'head', [0.5, 68.5, 13]);
  rig.socket('str_head', 'head', [0.5, 80, 0.5]);

  // ---------------------------------------------------------------- arms with control crosses
  const knob = (m: ReturnType<typeof rig.part>, cx: number, cy: number, cz: number, rr: number) => {
    ell(m, cx, cy, cz, rr, rr * 0.9, rr, W);
    for (let x = Math.floor(cx - rr - 1); x <= Math.ceil(cx + rr + 1); x++)
      for (let z = Math.floor(cz - rr - 1); z <= Math.ceil(cz + rr + 1); z++) if (m.has(x, Math.round(cy), z) && Math.hypot(x - cx, z - cz) > rr - 0.9) m.set(x, Math.round(cy), z, GOLD.base, VF.SOLID | VF.METAL);
  };
  const arm = rig.part('arm_l', 'torso', [9.5, 58, 0.5]);
  knob(arm, 9.5, 58, 0.5, 2.6);
  seg(arm, [9.8, 56, 0.5], [11, 47, 0.5], 2.0, W, undefined, 1.6);
  for (let x = 8; x <= 13; x++) for (let z = -2; z <= 3; z++) if (arm.has(x, 52, z) && Math.hypot(x - 10.4, z - 0.5) > 1.0) arm.set(x, 52, z, GOLD.base, VF.SOLID | VF.METAL);
  const fore = rig.part('fore_l', 'arm_l', [11, 45, 0.5]);
  knob(fore, 11, 45, 0.5, 2.1);
  seg(fore, [11, 43.5, 0.5], [11.5, 34, 1], 1.7, W, undefined, 1.3);
  for (let x = 9; x <= 14; x++) for (let z = -2; z <= 3; z++) if (fore.has(x, 37, z) && Math.hypot(x - 11.4, z - 0.9) > 0.8) fore.set(x, 37, z, GOLD.base, VF.SOLID | VF.METAL);
  const hand = rig.part('hand_l', 'fore_l', [11.5, 32.5, 1]);
  knob(hand, 11.5, 32.5, 1, 1.4);
  rbox(hand, 10, 27, -0.5, 13, 31, 2.5, W, 1);
  // long fingers curling round the control cross, gilt nail guards
  for (let f = 0; f < 4; f++) {
    const fz = -0.5 + f * 1;
    chain(hand, [[10.4, 27.5, fz], [10.2, 25, fz + 0.6], [11.2, 23.4, fz + 1.6], [12.6, 24, fz + 1.8]], [0.6, 0.55, 0.5, 0.45], W);
    hand.set(13, 24, Math.round(fz + 1.8), GOLD.hi, VF.SOLID | VF.METAL);
  }
  seg(hand, [13, 30, 1.5], [14, 27, 3], 0.6, W);
  hand.set(14, 26, 3, GOLD.hi, VF.SOLID | VF.METAL);
  // the control cross: a main bar along X, a cross bar along Z, gilt tips, a hook on top
  const ctrl = rig.part('ctrl_l', 'hand_l', [11.5, 25.5, 2]);
  seg(ctrl, [5.5, 25.5, 2], [17.5, 25.5, 2], 0.75, BRONZE.shade);
  seg(ctrl, [11.5, 25.5, -3.5], [11.5, 25.5, 7.5], 0.75, BRONZE.shade);
  for (const [x, z] of [[5, 2], [18, 2], [11.5, -4], [11.5, 8]] as [number, number][]) ell(ctrl, x, 25.5, z, 1.1, 1.1, 1.1, GOLD.hi, VF.SOLID | VF.METAL);
  rig.socket('tip_a_l', 'ctrl_l', [5, 25, 2]);
  rig.socket('tip_b_l', 'ctrl_l', [18, 25, 2]);
  rig.socket('tip_c_l', 'ctrl_l', [11.5, 25, -4]);
  rig.socket('tip_d_l', 'ctrl_l', [11.5, 25, 8]);
  rig.socket('str_w_l', 'hand_l', [11.5, 33, 1]);

  // ---------------------------------------------------------------- legs (the Hanged Man's crossed legs are posed by the boss)
  const thigh = rig.part('thigh_l', 'pelvis', [4.5, 37, 0.5]);
  knob(thigh, 4.5, 37.5, 0.5, 2.6);
  seg(thigh, [4.5, 36, 0.5], [4.5, 23, 0.8], 2.4, W, undefined, 2.0);
  for (let x = 1; x <= 8; x++) for (let z = -3; z <= 4; z++) if (thigh.has(x, 30, z) && Math.hypot(x - 4.5, z - 0.6) > 1.4) thigh.set(x, 30, z, GOLD.base, VF.SOLID | VF.METAL);
  const shin = rig.part('shin_l', 'thigh_l', [4.5, 21, 0.8]);
  knob(shin, 4.5, 21, 0.8, 2.4);
  seg(shin, [4.5, 19.5, 0.8], [4.5, 7, 0.5], 1.9, W, undefined, 1.4);
  for (let x = 2; x <= 7; x++) for (let z = -2; z <= 3; z++) if (shin.has(x, 10, z) && Math.hypot(x - 4.5, z - 0.6) > 0.9) shin.set(x, 10, z, GOLD.base, VF.SOLID | VF.METAL);
  rig.socket('str_k_l', 'shin_l', [4.5, 22, 1.5]);
  const foot = rig.part('foot_l', 'shin_l', [4.5, 5.5, 0.5]);
  knob(foot, 4.5, 5.5, 0.5, 1.7);
  // a curled Set-red slipper with a gilt toe
  for (let z = -2; z <= 7; z++) {
    const t = (z + 2) / 9;
    const h = 3.2 - t * 1.6;
    const w = 2.2 - Math.max(0, t - 0.6) * 3;
    for (let x = Math.floor(4.5 - w); x <= Math.ceil(4.5 + w); x++) for (let y = 0; y <= h; y++) if (Math.abs(x - 4.5) <= w) foot.set(x, y + 1, z, y === 0 ? KILT.dark : KILT.base);
  }
  seg(foot, [4.5, 2.5, 7], [4.5, 4.5, 9], 0.7, GOLD.hi, VF.SOLID | VF.METAL);

  // ---------------------------------------------------------------- the tau cross and its bell
  const tau = rig.part('tau', undefined, [0.5, 104, 0.5]);
  for (let x = -19; x <= 20; x++) {
    const tip = Math.abs(x - 0.5) > 16.5;
    const y0 = tip ? 102 : 103, y1 = tip ? 108 : 107;
    for (let y = y0; y <= y1; y++)
      for (let z = -1; z <= 2; z++) {
        const band = Math.abs(x - 0.5) % 6 < 1;
        tau.set(x, y, z, band ? LAPIS.base : y === y1 ? GOLD.hi : y === y0 ? GOLD.shade : GOLD.base, VF.SOLID | VF.METAL);
      }
  }
  for (let y = 93; y <= 103; y++) for (let x = -1; x <= 2; x++) for (let z = -1; z <= 2; z++) tau.set(x, y, z, y % 4 === 0 ? LAPIS.base : GOLD.base, VF.SOLID | VF.METAL);
  ell(tau, 0.5, 92.5, 0.5, 1.8, 1.4, 1.8, GOLD.hi, VF.SOLID | VF.METAL);
  // incised glyph dashes along the beam
  for (let x = -15; x <= 16; x += 2) if (Math.abs(x - 0.5) > 2.5) tau.set(x, 105, 3, GOLD.dark);
  rig.socket('tau_head', 'tau', [0.5, 92, 0.5]);
  rig.socket('tau_w_l', 'tau', [15, 102, 0.5]);
  rig.socket('tau_k_l', 'tau', [6, 102.5, 0.5]);
  const bell = rig.part('bell', 'tau', [-17, 101.5, 0.5]);
  seg(bell, [-17, 101.5, 0.5], [-17, 99.5, 0.5], 0.6, BRONZE.shade);
  for (let y = 91; y <= 99; y++) {
    const t = (99 - y) / 8;
    const R0 = 1.6 + t * t * 2.6 + (y === 91 ? 0.5 : 0);
    for (let x = -22; x <= -12; x++)
      for (let z = -5; z <= 6; z++) {
        const d = Math.hypot(x + 17 - 0.5 + 0.5, z - 0.5);
        if (d > R0 || (d < R0 - 1.2 && y < 98)) continue;
        bell.set(x, y, z, y === 95 ? GOLD.hi : y <= 92 ? BRONZE.hi : BRONZE.base, VF.SOLID | VF.METAL);
      }
  }
  ell(bell, -17, 91.5, 0.5, 0.9, 0.9, 0.9, BRONZE.dark);

  rig.mirrorLR();
  for (const p of rig.parts) toonShade(p.model, [EBONY, GOLD, LAPIS, KILT, BRONZE]);
  return rig.build({
    height: 4.4,
    radius: 1.1,
    kind: 'master_puppets',
    defaultExpression: 'smug',
    expressions: bossExpressions(0.5),
    cloth: { cape: [0x24142e, 0x140a1c, 0x8a6a2a] },
  });
}
