// Sand wolf (STYLE v3, realistic): a lean desert wolf. Deep narrow chest,
// tucked waist, muscled haunches, shaggy ruff, desert-big ears, a long muzzle
// with fangs and a tongue, amber almond eyes, saddle-marked sandy coat,
// bushy drooping tail with a dark tip. Joint-rich rig for fluid procedural gaits.
// Rig: hips (root) → chest → neck → head → jaw → tongue; ear_l/ear_r, eye_l/eye_r;
// leg_fl → shin_fl → paw_fl (… fr; front legs on chest), leg_bl → shin_bl → paw_bl (… br; on hips);
// tail1 → tail2 → tail3 (on hips). Alpha adds a bone mask (`mask`).
import type { RigSpec } from '../../../../engine/voxel/Rig';
import { RBm, Sc, M3, mix, mulRGB, hash3, noise, ell, cap, tube, paint, realFinish, lumpy, ridge, mammalEye, hollow, fur } from './rk';
import type { CSpec } from './rk';

const V = 1 / 80;

/** shaggy tufts that flow outward from `center` blended with `flow` */
function tufts(s: Sc, center: M3, count: number, len: number, col: CSpec, pred: (x: number, y: number, z: number) => boolean, flow: M3, seed = 0) {
  const vs = s.vs;
  const surf: M3[] = [];
  s.m.forEach((x, y, z) => {
    const p: M3 = [(x + 0.5) * vs, (y + 0.5) * vs, (z + 0.5) * vs];
    if ((!s.m.has(x, y + 1, z) || !s.m.has(x + 1, y, z) || !s.m.has(x - 1, y, z) || !s.m.has(x, y - 1, z)) && pred(p[0], p[1], p[2])) surf.push(p);
  });
  if (!surf.length) return;
  for (let k = 0; k < count; k++) {
    const p = surf[Math.floor(hash3(k, seed, 3) * surf.length) % surf.length];
    let d: M3 = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    d = [d[0] / dl * 0.55 + flow[0] * 0.45, d[1] / dl * 0.55 + flow[1] * 0.45, d[2] / dl * 0.55 + flow[2] * 0.45];
    const L = len * (0.6 + hash3(k, seed, 5) * 0.7);
    cap(s, p, [p[0] + d[0] * L, p[1] + d[1] * L, p[2] + d[2] * L], vs * 1.1, vs * 0.5, col);
  }
}

export function sandWolfRig(o: { alpha?: boolean } = {}): RigSpec {
  const A = !!o.alpha;
  const K = A ? 1.22 : 1;
  const k = (m: number) => m * K;
  const VS = V;
  const rb = new RBm(A ? 'sand_wolf_alpha' : 'sand_wolf', VS);
  // coat: sandy fawn, grey saddle, cream underside/muzzle, black accents
  const fawn = A ? 0x9a7a58 : 0xc8995e;
  const saddle = A ? 0x4a4038 : 0x76664f;
  const cream = A ? 0xc8b89a : 0xead6ae;
  const black = 0x1c1612;
  const coat = fur(fawn, mix(fawn, 0xffffff, 0.18), mix(fawn, 0x3a2a1a, 0.3), VS, 1, 'z');
  const coatSaddle = fur(saddle, mix(saddle, fawn, 0.35), mix(saddle, 0x101010, 0.3), VS, 2, 'z');
  const coatCream = fur(cream, mix(cream, 0xffffff, 0.2), mix(cream, fawn, 0.4), VS, 3, 'y');
  const nose = 0x161210;

  // ------------------------------------------------------------ hips (root) + waist + haunches
  const hipP: M3 = [0, k(0.62), -k(0.3)];
  const hips = rb.pm('hips', undefined, hipP);
  ell(hips, [0, k(0.635), -k(0.33)], [k(0.12), k(0.14), k(0.18)], coat);
  for (const sx of [-1, 1]) ell(hips, [sx * k(0.075), k(0.6), -k(0.36)], [k(0.07), k(0.13), k(0.12)], coat); // haunch muscles
  cap(hips, [0, k(0.64), -k(0.2)], [0, k(0.63), -k(0.06)], k(0.105), k(0.12), coat); // loin
  // tuck-up: carve the belly line up toward the hips
  ell(hips, [0, k(0.45), -k(0.16)], [k(0.16), k(0.1), k(0.16)], 0, { carve: true });
  lumpy(hips.m, 3, 1, 1, 0.34);

  // ------------------------------------------------------------ chest: deep narrow ribcage, scapulae, ruff
  const chestP: M3 = [0, k(0.63), -k(0.06)];
  const chest = rb.pm('chest', 'hips', chestP);
  ell(chest, [0, k(0.6), k(0.14)], [k(0.13), k(0.2), k(0.22)], coat); // ribcage, deep
  for (const sx of [-1, 1]) ell(chest, [sx * k(0.08), k(0.7), k(0.22)], [k(0.06), k(0.1), k(0.09)], coat); // scapula mass
  ell(chest, [0, k(0.56), k(0.3)], [k(0.085), k(0.12), k(0.05)], coatCream); // breastbone / chest fur
  lumpy(chest.m, 3, 1, 2, 0.34);

  // ------------------------------------------------------------ neck with the ruff
  const neckP: M3 = [0, k(0.7), k(0.3)];
  const neck = rb.pm('neck', 'chest', neckP);
  tube(neck, [[0, k(0.69), k(0.28)], [0, k(0.745), k(0.38)], [0, k(0.79), k(0.45)]], (t) => k(0.095) - t * k(0.022), coat);
  ell(neck, [0, k(0.74), k(0.35)], [k(0.115), k(0.1), k(0.09)], coat); // ruff mass
  lumpy(neck.m, 3, 2, 3, 0.3);
  tufts(neck, [0, k(0.74), k(0.36)], 80, k(0.05), coat, () => true, [0, -0.4, -0.6], 1);

  // ------------------------------------------------------------ head: wedge skull, stop, long muzzle, nose, cheeks
  const headP: M3 = [0, k(0.8), k(0.445)];
  const head = rb.pm('head', 'neck', headP);
  ell(head, [0, k(0.845), k(0.53)], [k(0.08), k(0.075), k(0.095)], coat); // cranium
  ridge(head, (x, y, z) => Math.abs(x) < VS * 0.8 && y > k(0.88) && z < k(0.575)); // sagittal crest
  tube(head, [[0, k(0.825), k(0.575)], [0, k(0.815), k(0.655)], [0, k(0.8), k(0.74)]], (t) => k(0.052) - t * k(0.022), coat); // muzzle
  ell(head, [0, k(0.8), k(0.655)], [k(0.042), k(0.03), k(0.08)], coatCream); // pale muzzle underside
  for (const sx of [-1, 1]) ell(head, [sx * k(0.06), k(0.815), k(0.555)], [k(0.04), k(0.05), k(0.05)], coatCream); // cheek fur
  ell(head, [0, k(0.808), k(0.751)], [k(0.02), k(0.016), k(0.014)], nose); // nose leather
  for (const sx of [-1, 1]) head.dot([sx * k(0.009), k(0.804), k(0.763)], 0x050404); // nostrils
  paint(head, (x, y, z) => z > k(0.635) && y < k(0.795) && Math.abs(x) > k(0.025), black); // lip line
  lumpy(head.m, 2, 1, 4, 0.42);
  tufts(head, [0, k(0.83), k(0.535)], 26, k(0.035), coatCream, (x, y, z) => z < k(0.595) && Math.abs(x) > k(0.05), [0, -0.3, -0.8], 2);
  // eye sockets + amber almond eyes (real geometry)
  for (const sx of [-1, 1]) ell(head, [sx * k(0.043), k(0.855), k(0.607)], [k(0.016), k(0.012), k(0.012)], 0, { carve: true });
  mammalEye(rb, 'eye_l', 'head', [k(0.042), k(0.855), k(0.606)], k(0.016), [0.45, 0.05, 1], { iris: A ? 0xd8701a : 0xd2901e });
  // ears: big triangular desert ears, leaning out, black rims, pale inner fur (own part)
  {
    const ep: M3 = [k(0.048), k(0.895), k(0.5)];
    const ear = rb.pm('ear_l', 'head', ep);
    for (let t = 0; t <= 14; t++) {
      const f = t / 14;
      const c: M3 = [ep[0] + f * k(0.03), ep[1] + f * k(0.125), ep[2] - f * k(0.022)];
      const w = k(0.04) * (1 - f * 0.9);
      ell(ear, c, [w, VS * 0.9, k(0.02) * (1 - f * 0.5) + VS * 0.5], (i, j, kk) => {
        const x = (i + 0.5) * VS - c[0], z = (kk + 0.5) * VS - c[2];
        if (f > 0.85 || Math.abs(x) > w - VS * 1.1) return black;
        return z > 0 ? mix(cream, 0xd8a898, 0.35) : (coat(i, j, kk) as number);
      });
    }
    lumpy(ear.m, 2, 1, 6, 0.5);
  }

  // ------------------------------------------------------------ jaw with fangs + tongue
  const jawP: M3 = [0, k(0.805), k(0.565)];
  const jaw = rb.pm('jaw', 'head', jawP);
  tube(jaw, [[0, k(0.785), k(0.575)], [0, k(0.778), k(0.655)], [0, k(0.77), k(0.72)]], (t) => k(0.033) - t * k(0.012), coatCream);
  paint(jaw, (_x, y, z) => y > k(0.785) && z > k(0.595), black);
  for (const sx of [-1, 1]) {
    // canines + a row of carnassials
    jaw.dot([sx * k(0.018), k(0.794), k(0.71)], 0xf4ecd8).dot([sx * k(0.018), k(0.802), k(0.71)], 0xf4ecd8);
    for (let t = 0; t < 4; t++) jaw.dot([sx * k(0.024), k(0.792), k(0.635) + t * k(0.018)], 0xe8dcc4);
    head.dot([sx * k(0.02), k(0.788), k(0.72)], 0xf4ecd8).dot([sx * k(0.02), k(0.78), k(0.72)], 0xf4ecd8); // upper fangs
  }
  const tP: M3 = [0, k(0.782), k(0.615)];
  const tongue = rb.pm('tongue', 'jaw', tP);
  tube(tongue, [tP, [0, k(0.782), k(0.675)], [0, k(0.776), k(0.715)]], (t) => k(0.017) - t * k(0.006), 0xc8606a);
  paint(tongue, (x) => Math.abs(x) < VS * 0.6, 0xa84a56);

  // ------------------------------------------------------------ legs (built per side so the _fl/_fr names stay exact)
  for (const side of [1, -1]) {
    const sfx = side > 0 ? 'l' : 'r';
    const X = (x: number) => x * side;
    // front: shoulder → elbow → wrist → paw (on chest)
    const sh: M3 = [X(k(0.085)), k(0.62), k(0.22)];
    const el: M3 = [X(k(0.095)), k(0.4), k(0.18)];
    const wr: M3 = [X(k(0.092)), k(0.11), k(0.22)];
    const pw: M3 = [X(k(0.092)), k(0.035), k(0.255)];
    const uf = rb.pm(`leg_f${sfx}`, 'chest', sh);
    tube(uf, [sh, [X(k(0.1)), k(0.52), k(0.2)], el], (t) => k(0.052) - t * k(0.014), coat);
    lumpy(uf.m, 3, 1, 5, 0.38);
    const sf = rb.pm(`shin_f${sfx}`, `leg_f${sfx}`, el);
    tube(sf, [el, [X(k(0.094)), k(0.26), k(0.19)], wr], (t) => k(0.032) - t * k(0.01), coat);
    paint(sf, (x) => Math.abs(x) < k(0.088), coatCream); // pale inner leg
    const pf = rb.pm(`paw_f${sfx}`, `shin_f${sfx}`, wr);
    paw(pf, wr, pw, side, k, coatCream, black);
    // back: hip → stifle → hock → paw (on hips)
    const hp: M3 = [X(k(0.08)), k(0.6), -k(0.34)];
    const st: M3 = [X(k(0.098)), k(0.38), -k(0.24)];
    const hk: M3 = [X(k(0.092)), k(0.18), -k(0.42)];
    const pb: M3 = [X(k(0.092)), k(0.035), -k(0.36)];
    const ub = rb.pm(`leg_b${sfx}`, 'hips', hp);
    tube(ub, [hp, [X(k(0.1)), k(0.5), -k(0.28)], st], (t) => k(0.075) - t * k(0.03), coat); // muscled thigh
    lumpy(ub.m, 3, 1, 6, 0.36);
    const sb = rb.pm(`shin_b${sfx}`, `leg_b${sfx}`, st);
    tube(sb, [st, [X(k(0.096)), k(0.28), -k(0.33)], hk], (t) => k(0.04) - t * k(0.016), coat);
    ell(sb, hk, [k(0.022), k(0.026), k(0.026)], coat); // hock knob
    const pbP = rb.pm(`paw_b${sfx}`, `shin_b${sfx}`, hk);
    tube(pbP, [hk, [X(k(0.093)), k(0.1), -k(0.39)], [X(k(0.092)), k(0.05), -k(0.37)]], (t) => k(0.022) - t * k(0.004), coatCream); // metatarsus
    paw(pbP, [X(k(0.092)), k(0.05), -k(0.37)], pb, side, k, coatCream, black);
  }

  // ------------------------------------------------------------ tail: bushy, drooping, dark tip
  const T: M3[] = [[0, k(0.665), -k(0.48)], [0, k(0.59), -k(0.6)], [0, k(0.47), -k(0.7)], [0, k(0.33), -k(0.75)]];
  const rads = [k(0.04), k(0.055), k(0.05), k(0.03)];
  let tParent = 'hips';
  for (let i = 0; i < 3; i++) {
    const seg = rb.pm(`tail${i + 1}`, tParent, T[i]);
    tube(seg, [T[i], T[i + 1]], (t) => rads[i] + (rads[i + 1] - rads[i]) * t, i === 2 ? coatSaddle : coat);
    lumpy(seg.m, 3, 2, 7 + i, 0.3);
    tufts(seg, [T[i][0], T[i][1], T[i][2]], 30, k(0.04), i === 2 ? black : coat, () => true, [0, -0.7, -0.5], 3 + i);
    if (i === 2) paint(seg, (_x, y) => y < k(0.4), black);
    tParent = `tail${i + 1}`;
  }

  // ------------------------------------------------------------ coat pattern: grey saddle, cream belly, dark dorsal line
  for (const name of ['hips', 'chest', 'neck']) {
    const s = rb.sc(name);
    paint(s, (x, y, z) => y > k(0.69) + Math.abs(x) * 0.6 && z < k(0.36), coatSaddle);
    paint(s, (x, y) => y < k(0.5) || (name === 'chest' && y < k(0.56)), coatCream);
    paint(s, (x, y, z) => Math.abs(x) < VS * 1.2 && y > k(0.74) && z < k(0.3), mix(saddle, 0x101010, 0.4));
  }
  // scars: hairless pale lines across the muzzle and a shoulder
  paint(head, (x, y, z) => Math.abs((z - k(0.635)) - (x + k(0.02)) * 1.4) < VS * 0.7 && x > -k(0.04) && x < k(0.03) && y > k(0.81), 0xc8a098);
  paint(chest, (x, y, z) => x > k(0.05) && Math.abs((y - k(0.7)) + (z - k(0.2)) * 0.9) < VS * 0.8 && z > k(0.12) && z < k(0.3), 0xc8a098);

  // ------------------------------------------------------------ alpha: cracked bone mask + ochre war markings
  if (A) {
    const mp: M3 = [0, k(0.86), k(0.575)];
    const mask = rb.pm('mask', 'head', mp);
    const boneC = (x: number, y: number, z: number) => (noise.n3(x * 0.3, y * 0.3, z * 0.3) > 0.3 ? 0xd8c8a4 : 0xeee2c4);
    ell(mask, [0, k(0.87), k(0.575)], [k(0.075), k(0.05), k(0.09)], boneC, { keep: (_lx, ly) => ly > -0.25 });
    ell(mask, [0, k(0.86), k(0.575)], [k(0.065), k(0.042), k(0.085)], 0, { carve: true });
    for (const sx of [-1, 1]) {
      ell(mask, [sx * k(0.043), k(0.858), k(0.615)], [k(0.02), k(0.016), k(0.03)], 0, { carve: true }); // eye holes
      tube(mask, [[sx * k(0.06), k(0.9), k(0.535)], [sx * k(0.1), k(0.95), k(0.495)], [sx * k(0.12), k(1.01), k(0.525)]], (t) => k(0.018) * (1 - t * 0.8), 0xe8dcc0); // horn stubs
    }
    lumpy(mask.m, 2, 1, 9, 0.45);
    paint(mask, (x, y, z) => Math.abs((z - k(0.575)) - x * 2) < VS * 0.6 && y > k(0.89), 0x5a4a36); // crack
    paint(rb.sc('chest'), (x, y, z) => Math.abs(x) > k(0.07) && y > k(0.62) && y < k(0.76) && z > k(0.12) && z < k(0.3) && Math.abs(((z + y * 0.5 + 1) / k(0.05)) % 1) < 0.25, 0x8a3a1e);
  }

  for (const p of rb.parts) if (p.model.count > 5000) hollow(p.model, 3);
  realFinish(rb, 0.6, false);
  rb.sockM('mouth', 'jaw', [0, k(0.785), k(0.725)]);
  rb.sockM('head_top', 'head', [0, k(0.92), k(0.515)]);
  rb.sockM('back', 'chest', [0, k(0.8), k(0.05)]);
  return rb.build({ height: k(1.02), radius: k(0.34), length: k(1.3), kind: 'quadruped', headY: k(0.84) });
}

/** paw: pastern + 4 toe pads with dark claws + dewclaw (front) */
function paw(s: Sc, from: M3, at: M3, side: number, k: (m: number) => number, col: CSpec, claw: number) {
  const vs = s.vs;
  tube(s, [from, at], (t) => k(0.022) + t * k(0.004), col);
  ell(s, [at[0], k(0.022), at[2] + k(0.015)], [k(0.03), k(0.022), k(0.035)], col);
  for (let t = 0; t < 4; t++) {
    const ox = (t - 1.5) * k(0.014) * side;
    const c: M3 = [at[0] + ox, k(0.015), at[2] + k(0.045) + (t === 1 || t === 2 ? k(0.008) : 0)];
    ell(s, c, [k(0.009), k(0.014), k(0.012)], col);
    s.dot([c[0], vs * 0.5, c[2] + k(0.012)], claw);
  }
  lumpy(s.m, 2, 1, 3, 0.45);
}
