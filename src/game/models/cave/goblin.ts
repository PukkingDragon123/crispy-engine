// Sand-cave crystal goblins — STYLE v3 realistic creatures, 1/48 m, ~1.2 m tall,
// hunched. Sinewy pale cave-dwellers with mottled grey-green (or dusky violet)
// skin, ribs and spine knobs showing, long arms with knobbly knuckles and curled
// claws, splayed three-toed feet, a big head with a heavy brow, a long hooked nose,
// a wide mouth of crooked teeth over an underbite with two tusks (the jaw opens),
// huge reflective modelled eyes for the dark, and long ragged pointed ears (shootable).
// Crystals grow out of them: a spray from the upper back, shards along the spine,
// small points through the scalp and the elbows. Hide loincloth strips, a rope belt
// with a pouch, shin wraps.
//   spear goblin: a crude spear with a lashed cyan crystal point and a bone charm.
//   slinger: a sling (cord + pouch cradling a glowing stone) and a bandolier of stones.
//   alpha (the Geode King): bigger, darker, glowing violet vein-tattoos, a crystal crown,
//          a bone necklace and a violet-tipped war spear.
//
// Rig (humanoid convention): pelvis (root) → torso → head → jaw, ear_l/ear_r, eye_l/eye_r;
// torso → arm_l → fore_l (+ _r); pelvis → thigh_l → shin_l (+ _r); fore_r → weapon.
// Socket hand_r.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { RBm, M3, VF, mix, mulRGB, hash3, noise, ell, cap, tube, paint, cut, realFinish, mammalEye, lumpy, tubercles } from '../enemies/real/rk';
import { CRYSTAL, crystal, crystalSpray, fleshC } from './kit';

export interface CaveGoblinOpts {
  alpha?: boolean;
  variant?: number;
  slinger?: boolean;
}

const VS = 1 / 48;

interface Pal {
  skin: number;
  light: number;
  dark: number;
  belly: number;
  iris: number;
  hide: number;
  cry: keyof typeof CRYSTAL;
}
const PALS: Pal[] = [
  { skin: 0x6e7a62, light: 0x949c7e, dark: 0x485240, belly: 0x9a967a, iris: 0xd8e060, hide: 0x7a5a3a, cry: 'cyan' },
  { skin: 0x6c6a7c, light: 0x9290a6, dark: 0x464458, belly: 0x9a94a0, iris: 0xf0c060, hide: 0x6a4a34, cry: 'violet' },
];
const ALPHA: Pal = { skin: 0x4a4e5a, light: 0x6a7080, dark: 0x2c2e38, belly: 0x707280, iris: 0xff7a3a, hide: 0x4a3426, cry: 'violet' };

export function caveGoblinRig(o: CaveGoblinOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const sling = !!o.slinger;
  const v = (((o.variant ?? 0) % PALS.length) + PALS.length) % PALS.length;
  const pal = alpha ? ALPHA : PALS[v];
  const K = alpha ? 1.14 : 1;
  const k = (m: number) => m * K;
  const name = `cave_goblin${sling ? '_slinger' : ''}${alpha ? '_alpha' : ''}_v${v}`;
  const rb = new RBm(name, VS);
  const seed = (alpha ? 41 : 5) + v * 13 + (sling ? 7 : 0);
  const skin = fleshC(pal.skin, pal.light, pal.dark, VS, seed, { cell: 0.07, veins: alpha ? 0 : 0.6, vein: mix(pal.dark, 0x4a3a5a, 0.4), pores: 0.04 });
  const cry = CRYSTAL[pal.cry];
  const hideC = (x: number, y: number, z: number) => {
    const n = noise.n3(x * 0.25, y * 0.25 + seed, z * 0.25);
    return n > 0.35 ? mix(pal.hide, 0xb08a60, 0.35) : n < -0.4 ? mulRGB(pal.hide, 0.72) : pal.hide;
  };
  const rope = (x: number, y: number, z: number) => ((x + y + z) & 1 ? 0x9a7a4c : 0x7a5e3a);

  // ================================================================ pelvis + loincloth
  const hipY = k(0.52);
  const pelvis = rb.pm('pelvis', undefined, [0, hipY, 0]);
  ell(pelvis, [0, hipY + k(0.02), -k(0.01)], [k(0.115), k(0.08), k(0.085)], skin);
  // rope belt with a knot, a pouch and hide strips hanging front and back
  const beltY = hipY + k(0.07);
  for (let a = 0; a < Math.PI * 2; a += 0.05) pelvis.dot([Math.cos(a) * k(0.122), beltY + Math.sin(a * 3) * 0.004, Math.sin(a) * k(0.094)], rope);
  ell(pelvis, [k(0.05), beltY, k(0.09)], [k(0.02), k(0.018), k(0.015)], rope);
  pelvis.rbox([-k(0.15), beltY - k(0.09), -k(0.03)], [-k(0.1), beltY - k(0.01), k(0.04)], k(0.012), hideC); // pouch
  for (let st = 0; st < 5; st++) {
    const a = -0.9 + st * 0.45;
    for (const back of [false, true]) {
      const zs = back ? -1 : 1;
      const x = Math.sin(a) * k(0.1), z = zs * Math.cos(a) * k(0.085);
      const L = k(0.13 + hash3(st, seed, back ? 1 : 2) * 0.08);
      tube(pelvis, [[x, beltY - k(0.01), z], [x * 1.08, beltY - L * 0.5, z * 1.15], [x * 1.1, beltY - L, z * 1.2]], () => k(0.016), hideC);
    }
  }
  if (sling) {
    // a bag of sling stones on the hip, glowing pebbles peeking out
    ell(pelvis, [k(0.13), beltY - k(0.06), -k(0.04)], [k(0.04), k(0.05), k(0.04)], hideC);
    for (let p = 0; p < 3; p++) ell(pelvis, [k(0.13) + p * k(0.012), beltY - k(0.01), -k(0.04) + p * k(0.01)], [k(0.012), k(0.012), k(0.012)], p === 1 ? cry.light : cry.mid, { fl: VF.EMISSIVE });
  }

  // ================================================================ torso (hunched)
  const torso = rb.pm('torso', 'pelvis', [0, hipY + k(0.07), 0]);
  ell(torso, [0, hipY + k(0.15), k(0.03)], [k(0.11), k(0.09), k(0.085)], skin); // belly
  ell(torso, [0, hipY + k(0.28), k(0.05)], [k(0.145), k(0.11), k(0.1)], skin); // chest
  ell(torso, [0, hipY + k(0.34), -k(0.02)], [k(0.165), k(0.08), k(0.1)], skin); // hunched shoulders / trapezius
  ell(torso, [0, hipY + k(0.3), -k(0.07)], [k(0.12), k(0.09), k(0.06)], skin); // upper back hump
  lumpy(torso.m, 3, 1, seed, 0.38);
  // ribs on the flanks, sunken belly line, paler belly
  paint(torso, (x, y, z) => Math.abs(x) > k(0.08) && y > hipY + k(0.18) && y < hipY + k(0.31) && Math.abs(Math.sin((y - hipY) * (alpha ? 70 : 80))) < 0.28, mulRGB(pal.dark, 1.05));
  paint(torso, (x, y, z) => z > k(0.06) && Math.abs(x) < k(0.07) && y < hipY + k(0.24), mix(pal.skin, pal.belly, 0.6));
  // spine knobs and a crystal spray erupting from the upper back
  for (let s = 0; s < 6; s++) ell(torso, [0, hipY + k(0.12) + s * k(0.04), -k(0.08) - Math.sin(s * 0.5) * k(0.03)], [k(0.014), k(0.012), k(0.012)], mix(pal.skin, pal.light, 0.4));
  crystalSpray(torso, [k(0.05), hipY + k(0.33), -k(0.09)], [0.35, 0.8, -0.7], k(alpha ? 0.3 : 0.22), cry, seed, alpha ? 6 : 4);
  for (let s = 0; s < 3; s++) crystal(torso, [-k(0.04) + s * k(0.02), hipY + k(0.2) + s * k(0.05), -k(0.1)], [-0.2, 0.6, -1], k(0.07), k(0.014), cry, { seed: seed + s });
  tubercles(torso, 10, k(0.008), mix(pal.skin, pal.dark, 0.4), (_x, y) => y > hipY + k(0.25), seed);
  if (sling) {
    // bandolier of glowing stones across the chest
    for (let t = 0; t <= 24; t++) {
      const q = t / 24;
      const x = k(0.13) - q * k(0.26), y = hipY + k(0.36) - q * k(0.2);
      const z = Math.sqrt(Math.max(0, 1 - (x / k(0.15)) ** 2)) * k(0.105) + k(0.04);
      torso.dot([x, y, z], 0x5a3e28);
      if (t % 5 === 2) ell(torso, [x, y, z + k(0.01)], [k(0.011), k(0.011), k(0.009)], cry.mid, { fl: VF.EMISSIVE });
    }
  }
  if (alpha) {
    // bone necklace: knucklebones and two little skulls
    for (let t = 0; t <= 16; t++) {
      const a = -1.2 + (t / 16) * 2.4;
      const p: M3 = [Math.sin(a) * k(0.12), hipY + k(0.37) - Math.cos(a) * k(0.05), Math.cos(a) * k(0.1) + k(0.03)];
      ell(torso, p, [k(0.011), k(0.009), k(0.009)], t % 4 === 0 ? 0xe8dcc0 : 0xd0c098);
    }
    for (const sx of [1, -1]) ell(torso, [sx * k(0.05), hipY + k(0.31), k(0.14)], [k(0.018), k(0.02), k(0.015)], 0xeadcc0);
    // glowing vein tattoos
    paint(torso, (x, y, z) => Math.abs(noise.n3(x * 9, y * 9, z * 9)) < 0.04, cry.light, VF.EMISSIVE);
  }

  // ================================================================ head
  const neck: M3 = [0, hipY + k(0.39), k(0.08)];
  const head = rb.pm('head', 'torso', neck);
  cap(head, neck, [0, hipY + k(0.45), k(0.12)], k(0.05), k(0.05), skin); // stubby neck
  const hc: M3 = [0, hipY + k(0.49), k(0.13)];
  ell(head, hc, [k(0.1), k(0.095), k(0.105)], skin);
  ell(head, [0, hipY + k(0.46), k(0.2)], [k(0.085), k(0.06), k(0.06)], skin); // face / cheeks
  ell(head, [0, hipY + k(0.515), k(0.21)], [k(0.098), k(0.026), k(0.04)], mulRGB(pal.skin, 0.95)); // heavy brow
  // long hooked nose with flared nostrils
  tube(head, [[0, hipY + k(0.5), k(0.235)], [0, hipY + k(0.48), k(0.285)], [0, hipY + k(0.455), k(0.31)], [0, hipY + k(0.44), k(0.305)]], (t) => k(0.026) - t * k(0.012), skin);
  for (const sx of [1, -1]) {
    ell(head, [sx * k(0.016), hipY + k(0.448), k(0.29)], [k(0.012), k(0.01), k(0.012)], skin);
    head.dot([sx * k(0.014), hipY + k(0.44), k(0.296)], 0x1a1010);
  }
  // deep eye sockets, cheekbones, the mouth slit with jagged upper teeth
  for (const sx of [1, -1]) {
    ell(head, [sx * k(0.048), hipY + k(0.49), k(0.21)], [k(0.03), k(0.026), k(0.02)], 0, { carve: true });
    ell(head, [sx * k(0.07), hipY + k(0.465), k(0.2)], [k(0.026), k(0.018), k(0.025)], mix(pal.skin, pal.light, 0.4));
  }
  cut(head, (x, y, z) => Math.abs(x) < k(0.062) && Math.abs(y - (hipY + k(0.428))) < VS * 0.9 && z > k(0.2));
  for (let t = -5; t <= 5; t++) {
    const x = t * k(0.011);
    const L = 1 + Math.floor(hash3(t, seed, 1) * 2.5);
    for (let l = 0; l < L; l++) head.dot([x, hipY + k(0.432) - l * VS, k(0.255) - Math.abs(x) * 0.5], hash3(t, l, seed) < 0.3 ? 0xc8b88a : 0xe8dcb8);
  }
  // scalp: a few crystal points through the skin, stringy hair at the back
  for (let s = 0; s < (alpha ? 7 : 3); s++) {
    const a = -0.8 + s * (1.6 / Math.max(1, (alpha ? 7 : 3) - 1));
    crystal(head, [Math.sin(a) * k(0.06), hipY + k(0.56), k(0.1) - Math.cos(a) * k(0.02)], [Math.sin(a) * 0.5, 1, -0.35], k(alpha ? 0.16 : 0.07) * (alpha && s === 3 ? 1.5 : 1), k(alpha ? 0.022 : 0.014), cry, { seed: seed + s * 3 });
  }
  for (let h = 0; h < 9; h++) {
    const x = (h - 4) * k(0.016);
    tube(head, [[x, hipY + k(0.55), k(0.06)], [x * 1.2, hipY + k(0.5), -k(0.01)], [x * 1.3, hipY + k(0.42), -k(0.02)]], () => VS * 0.6, 0x2a2420);
  }
  // modelled eyes: big, reflective, made for the dark
  const eye = mammalEye(rb, 'eye_l', 'head', [k(0.048), hipY + k(0.49), k(0.215)], k(0.025), [0.3, 0.05, 1], { iris: pal.iris, lid: pal.dark, pupil: 0x050404 });
  paint(eye, () => true, (x, y, z) => {
    const c = eye.m.get(x, y, z)! & 0xffffff;
    return c;
  }, VF.EMISSIVE);

  // jaw: underbite, two tusks
  const jaw = rb.pm('jaw', 'head', [0, hipY + k(0.44), k(0.14)]);
  ell(jaw, [0, hipY + k(0.415), k(0.205)], [k(0.075), k(0.026), k(0.06)], skin);
  ell(jaw, [0, hipY + k(0.4), k(0.23)], [k(0.04), k(0.022), k(0.03)], skin); // chin
  for (const sx of [1, -1]) cap(jaw, [sx * k(0.042), hipY + k(0.425), k(0.245)], [sx * k(0.046), hipY + k(0.47), k(0.255)], k(0.009), VS * 0.6, 0xe8d8b0);
  for (let t = -3; t <= 3; t++) jaw.dot([t * k(0.011), hipY + k(0.43), k(0.25) - Math.abs(t) * k(0.004)], 0xd8c8a0);

  // ears: long, ragged, pointed (left; mirrored)
  const ear = rb.pm('ear_l', 'head', [k(0.09), hipY + k(0.5), k(0.11)]);
  const earPts: M3[] = [[k(0.09), hipY + k(0.5), k(0.11)], [k(0.2), hipY + k(0.53), k(0.07)], [k(0.32), hipY + k(0.57), k(0.02)], [k(0.4), hipY + k(0.6), -k(0.02)]];
  tube(ear, earPts, (t) => k(0.045) * (1 - t * 0.85), skin);
  // flatten and cup the ear: carve the front face, paint the cup
  cut(ear, (x, y, z) => z > k(0.08) - (x - k(0.09)) * 0.36 && y > hipY + k(0.5) + (x - k(0.09)) * 0.3);
  paint(ear, (x, y, z) => z > k(0.06) - (x - k(0.09)) * 0.36, mix(pal.skin, 0xc08a84, 0.35));
  // notches torn out of the rim
  for (let nt = 0; nt < 2; nt++) cut(ear, (x, y) => Math.abs(x - k(0.2 + nt * 0.09)) < VS * 1.2 && y < hipY + k(0.51 + nt * 0.035));

  // ================================================================ arms (left; mirrored)
  const sh: M3 = [k(0.155), hipY + k(0.34), k(0.02)];
  const el: M3 = [k(0.225), hipY + k(0.17), k(0.04)];
  const wr: M3 = [k(0.25), hipY - k(0.0), k(0.1)];
  const arm = rb.pm('arm_l', 'torso', sh);
  ell(arm, sh, [k(0.05), k(0.05), k(0.05)], skin);
  tube(arm, [sh, [k(0.2), hipY + k(0.25), k(0.03)], el], (t) => k(0.042) - t * k(0.01), skin);
  const fore = rb.pm('fore_l', 'arm_l', el);
  ell(fore, el, [k(0.034), k(0.034), k(0.034)], mix(pal.skin, pal.light, 0.3)); // knobbly elbow
  tube(fore, [el, [k(0.24), hipY + k(0.09), k(0.07)], wr], (t) => k(0.034) - t * k(0.008), skin);
  // hide bracer
  for (let w = 0; w < 3; w++) {
    const t = 0.3 + w * 0.12;
    const p: M3 = [el[0] + (wr[0] - el[0]) * t, el[1] + (wr[1] - el[1]) * t, el[2] + (wr[2] - el[2]) * t];
    fore.disc([p[0], p[1] - k(0.008), p[2]], k(0.036), k(0.016), 'y', hideC);
  }
  crystal(fore, [k(0.23), hipY + k(0.17), k(0.0)], [0.3, 0.2, -1], k(0.06), k(0.012), cry, { seed: seed + 21 });
  // hand: palm, four long knobbly fingers curling forward, a thumb, black claws
  ell(fore, [wr[0] + k(0.004), wr[1] - k(0.035), wr[2] + k(0.01)], [k(0.024), k(0.038), k(0.034)], skin);
  for (let f = 0; f < 4; f++) {
    const fz = wr[2] - k(0.02) + f * k(0.016);
    const b: M3 = [wr[0] + k(0.006), wr[1] - k(0.07), fz];
    const m: M3 = [wr[0] + k(0.008), wr[1] - k(0.11), fz + k(0.02)];
    const t: M3 = [wr[0] + k(0.006), wr[1] - k(0.13), fz + k(0.045)];
    tube(fore, [b, m, t], (q) => k(0.011) * (1 - q * 0.35), skin);
    tube(fore, [t, [t[0], t[1] - k(0.004), t[2] + k(0.018)]], (q) => k(0.007) * (1 - q * 0.6), 0x1a1612);
  }
  tube(fore, [[wr[0] - k(0.012), wr[1] - k(0.04), wr[2] + k(0.03)], [wr[0] - k(0.018), wr[1] - k(0.07), wr[2] + k(0.06)]], () => k(0.011), skin);

  // ================================================================ legs (left; mirrored)
  const hp: M3 = [k(0.075), hipY - k(0.01), 0];
  const kn: M3 = [k(0.09), k(0.3), k(0.075)];
  const an: M3 = [k(0.092), k(0.075), -k(0.012)];
  const thigh = rb.pm('thigh_l', 'pelvis', hp);
  tube(thigh, [hp, [k(0.085), k(0.41), k(0.05)], kn], (t) => k(0.055) - t * k(0.014), skin);
  const shin = rb.pm('shin_l', 'thigh_l', kn);
  ell(shin, kn, [k(0.038), k(0.04), k(0.038)], mix(pal.skin, pal.light, 0.3));
  tube(shin, [kn, [k(0.092), k(0.19), k(0.04)], an], (t) => k(0.04) - t * k(0.012), skin);
  for (let w = 0; w < 4; w++) shin.disc([k(0.092), k(0.12) + w * k(0.03), k(0.02) - w * k(0.006)], k(0.035), k(0.014), 'y', hideC);
  // splayed foot: heel, three long toes with claws, a dewclaw
  ell(shin, [an[0], k(0.03), an[2] - k(0.01)], [k(0.034), k(0.03), k(0.05)], skin);
  for (let t = -1; t <= 1; t++) {
    const tx = an[0] + t * k(0.022);
    tube(shin, [[tx, k(0.025), an[2] + k(0.02)], [tx + t * k(0.012), k(0.02), an[2] + k(0.09)], [tx + t * k(0.016), k(0.012), an[2] + k(0.13)]], (q) => k(0.016) * (1 - q * 0.4), skin);
    tube(shin, [[tx + t * k(0.016), k(0.012), an[2] + k(0.13)], [tx + t * k(0.018), k(0.002), an[2] + k(0.15)]], () => k(0.007), 0x1a1612);
  }
  tube(shin, [[an[0] - k(0.025), k(0.05), an[2] - k(0.02)], [an[0] - k(0.035), k(0.02), an[2] - k(0.06)]], () => k(0.008), 0x1a1612);

  rb.mirrorLR();

  // ================================================================ weapon (right hand)
  const grip: M3 = [-wr[0], wr[1] - k(0.045), wr[2] + k(0.02)];
  const wp = rb.pm('weapon', 'fore_r', grip);
  const wood = (x: number, y: number, z: number) => (noise.n3(x * 0.6, y * 0.08, z * 0.6) > 0.2 ? 0x8a6a44 : 0x6e5234);
  if (!sling) {
    const L = k(alpha ? 1.75 : 1.55);
    const butt: M3 = [grip[0], grip[1] - L * 0.32, grip[2] - k(0.06)];
    const top: M3 = [grip[0], grip[1] + L * 0.68, grip[2] + k(0.13)];
    tube(wp, [butt, grip, top], () => k(0.017), wood);
    // lashings and a bone charm under the head
    for (const t of [0.0, 0.88, 0.93]) {
      const p: M3 = [butt[0] + (top[0] - butt[0]) * t, butt[1] + (top[1] - butt[1]) * t, butt[2] + (top[2] - butt[2]) * t];
      wp.disc([p[0], p[1] - k(0.012), p[2]], k(0.024), k(0.024), 'y', rope);
    }
    const ch: M3 = [top[0], top[1] - L * 0.1, top[2]];
    tube(wp, [ch, [ch[0] + k(0.02), ch[1] - k(0.08), ch[2] + k(0.01)]], () => VS * 0.6, rope);
    ell(wp, [ch[0] + k(0.02), ch[1] - k(0.1), ch[2] + k(0.01)], [k(0.016), k(0.02), k(0.012)], 0xe8dcc0);
    // the crystal point
    const dir: M3 = [0, top[1] - butt[1], top[2] - butt[2]];
    crystal(wp, [top[0], top[1] - k(0.04), top[2] - k(0.008)], dir, k(alpha ? 0.34 : 0.26), k(alpha ? 0.045 : 0.034), alpha ? CRYSTAL.violet : CRYSTAL.cyan, { seed: seed + 50, tip: 0.45 });
  } else {
    // the sling: two cords from the fist to a hide pouch cradling a glowing stone
    const pouch: M3 = [grip[0] - k(0.02), grip[1] - k(0.3), grip[2] + k(0.05)];
    for (const dz of [-k(0.015), k(0.015)]) tube(wp, [grip, [grip[0] - k(0.01), grip[1] - k(0.15), grip[2] + k(0.03) + dz], [pouch[0], pouch[1] + k(0.03), pouch[2] + dz * 2]], () => VS * 0.6, rope);
    ell(wp, pouch, [k(0.03), k(0.02), k(0.04)], hideC);
    ell(wp, [pouch[0], pouch[1] + k(0.016), pouch[2]], [k(0.018), k(0.018), k(0.018)], cry.light, { fl: VF.EMISSIVE });
  }
  rb.sockM('hand_r', 'fore_r', grip);

  realFinish(rb, 0.8);
  let top = 0;
  rb.m('head').forEach((_x, y) => (top = Math.max(top, (y + 1) * VS)));
  return rb.build({ height: top, radius: k(0.32), kind: 'cave_goblin', alpha, slinger: sling });
}
