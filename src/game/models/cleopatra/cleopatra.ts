// CLEOPATRA, AVATAR OF RA (wave 75 of the Nile): a tall, graceful queen of the
// sun, ~3 m to the crown of her head and ~3.7 m to the tips of her sun crown,
// sculpted at 1/56 m with realistic adult proportions (eight heads tall,
// long neck, long legs under a floor-length gown).
// She is veiled head to foot in layered ivory silk: the face is never seen, only
// its shape under a fall of silk that drops from the bridge of the nose to the
// collarbones, with the hood folding from the crown down over the shoulders.
// Sunlight glows through the silk from within: brightest over the heart and in
// a band across the hidden eyes, a seam of light down the front of the gown.
// Gold: a jewelled diadem with a rearing uraeus cobra (ruby eyes), a sun disc
// cradled between two lyre horns with a slowly turning corona of rays, a broad
// usekh collar of gold, lapis, carnelian and turquoise, armlets, cuffs, rings
// and gilded nails, a girdle with a winged-sun clasp and a bead apron. Long
// bell sleeves, a pleated gown with a lotus-embroidered hem; slender bare feet
// en pointe with gold anklets peek beneath it. The simulated silk (veil,
// sleeve streamers, sash ribbons, skirt panels) is added by the boss.
// Rig (authored in place, rest frames aligned with rig space; faces +Z, left +X):
//   pelvis (root) → torso → head → crown → cobra, sun_disc → rays
//   torso → arm_l → fore_l → hand_l → fing_l, thumb_l   (mirrored _r)
//   pelvis → skirt → skirt_lo → foot_l / foot_r · pelvis → apron
import { KRig, VoxelModel, VF, E, C, SUB, union, raster, rasterU, finish, curve, tubePrims, pk, mixc, mulc, nS, n01, sstep, clamp01, mirX, norm3, sub3, add3, scl3, lerp, len3, smin, type V3, type Prim, type RigSpec, type Field, type Paint } from './kit';

const VS = 1 / 56;

// ---------------------------------------------------------------------------- palette
const SILK = { base: 0xeee0c8, light: 0xfdf3e2, shade: 0xd2bc98, dark: 0xa08664, deep: 0x5a4632 };
const GOLDC = { hi: 0xfff0a8, base: 0xe8b84a, shade: 0xb48428, dark: 0x6e4c12 };
const LAPIS = 0x2a4a9c, LAPIS_HI = 0x4a70c8, CARN = 0xc03a28, TURQ = 0x3ab0a6;
const SKIN = { base: 0xb47a52, light: 0xcc9468, shade: 0x8e5a3a };
const GLOWC = 0xffb848, CORE = 0xffe8a8;
const RUBY = 0xff3020;

// ---------------------------------------------------------------------------- landmarks (metres)
export const CLEO = {
  pelvis: [0, 1.62, 0] as V3,
  torso: [0, 1.9, 0] as V3,
  head: [0, 2.5, -0.01] as V3,
  crown: [0, 2.95, 0] as V3,
  cobra: [0, 2.94, 0.13] as V3,
  disc: [0, 3.3, -0.11] as V3,
  sh: [0.27, 2.43, -0.02] as V3,
  el: [0.38, 1.96, -0.04] as V3,
  wr: [0.45, 1.53, 0.02] as V3,
  skirt: [0, 1.45, 0] as V3,
  knee: [0, 0.86, 0.0] as V3,
  foot: [0.075, 0.26, 0.03] as V3,
  heart: [0, 2.16, 0.02] as V3,
  height: 3.0,
};
const ARM_DIR = norm3(sub3(CLEO.wr, CLEO.el));
const KN: V3 = add3(CLEO.wr, ARM_DIR, 0.15);
const TB: V3 = add3(add3(CLEO.wr, ARM_DIR, 0.045), [0, 0, 0.03]);

/** the inner sunlight leaking through the silk (0..1) */
function inner(x: number, y: number, z: number) {
  const front = z > 0 ? 1 : 0.35;
  const heart = Math.exp(-(x * x + (y - 2.15) ** 2 * 0.55) / 0.011) * front;
  const eyes = 0.95 * Math.exp(-((y - 2.83) ** 2 / 0.0011 + (x * x) / 0.0065)) * (z > 0.08 ? 1 : 0);
  const seam = 0.55 * Math.exp(-(x * x) / 0.0022) * sstep(0.3, 1.95, y) * (z > 0.05 ? 1 : 0);
  const throat = 0.5 * Math.exp(-(x * x) / 0.004 - (y - 2.52) ** 2 / 0.006) * (z > 0.03 ? 1 : 0);
  return Math.max(heart, eyes, seam, throat);
}

/** silk paint: fold ridges light, valleys shaded (smooth blends), the inner light glowing through */
function silk(x: number, y: number, z: number, ny: number, fold: number, o: { trim?: boolean; tint?: number } = {}) {
  const L = inner(x, y, z);
  if (o.trim) return pk(ny > 0.3 ? GOLDC.hi : GOLDC.base, VF.METAL);
  let c = fold >= 0 ? mixc(SILK.base, SILK.light, Math.min(1, fold) * 0.85) : mixc(SILK.base, SILK.shade, Math.min(1, -fold * 1.1));
  if (fold < -0.85) c = mixc(c, SILK.dark, 0.5);
  if (ny < -0.6) c = mixc(c, SILK.shade, 0.5);
  if (o.tint !== undefined) c = mixc(c, o.tint, 0.35);
  if (L > 0.78) return pk(mixc(GLOWC, CORE, (L - 0.78) / 0.22), VF.GLOW);
  if (L > 0.3) return pk(mixc(c, GLOWC, 0.35 + (L - 0.3) * 1.3), VF.EMISSIVE);
  return pk(c);
}
const goldP = (ny: number, f = VF.METAL) => pk(ny > 0.5 ? GOLDC.hi : ny < -0.45 ? GOLDC.shade : GOLDC.base, f);

function build(): RigSpec {
  const rig = new KRig('cleopatra', VS);
  const P = CLEO;

  // ================================================================== body: bodice, hips and the gown
  const torsoPrims: Prim[] = [
    E([0, 2.2, -0.01], [0.2, 0.25, 0.135]),
    E([0, 2.36, -0.02], [0.25, 0.085, 0.12]),
    E([0, 1.88, 0.0], [0.148, 0.12, 0.11]),
    E([0, 1.73, 0.02], [0.18, 0.12, 0.13]),
    E([0, 1.6, -0.02], [0.25, 0.17, 0.17]),
  ];
  for (const s of [1, -1]) {
    torsoPrims.push(E([s * 0.092, 2.16, 0.07], [0.09, 0.082, 0.078]));
    torsoPrims.push(E([s * 0.27, 2.41, -0.02], [0.075, 0.075, 0.075]));
    torsoPrims.push(E([s * 0.09, 1.58, -0.08], [0.12, 0.14, 0.11]));
  }
  const torsoU = union(torsoPrims, 0.07);
  const bodice: Field = (x, y, z) => {
    const d = torsoU(x, y, z);
    if (d > 0.03) return d;
    // a crossover wrap: soft diagonal folds over the front, vertical gathers at the back
    const f = z > 0 ? Math.sin((x * (y > 2.0 ? 0.7 : -0.7) + y) * 30) : Math.sin(x * 40 + y * 4);
    return d - f * 0.0025;
  };
  const gownT = (y: number) => clamp01((1.62 - y) / 1.46);
  const gownR = (y: number) => {
    const t = gownT(y);
    return [0.25 + 0.04 * t + 0.15 * t * t * t, 0.18 + 0.05 * t + 0.14 * t * t * t, -0.02 + 0.03 * Math.sin(t * Math.PI) * 0.6];
  };
  const hemY = (a: number) => 0.15 + 0.045 * Math.sin(3 * a + 0.6) + 0.022 * Math.sin(7 * a + 1.3);
  const gownFold = (a: number, y: number) => {
    const t = gownT(y);
    return 0.62 * Math.sin(18 * a + 2.2 * t) + 0.38 * Math.sin(8 * a - 1.3 * t + 1.0);
  };
  const gown: Field = (x, y, z) => {
    if (y > 1.66) return 0.2;
    const [rx, rz, zc] = gownR(y);
    const a = Math.atan2(x, z - zc);
    const t = gownT(y);
    const amp = 0.004 + 0.026 * Math.pow(t, 1.4);
    const q = Math.hypot(x / rx, (z - zc) / rz);
    const m = Math.min(rx, rz);
    let d = (q - 1) * m - gownFold(a, y) * amp;
    d = Math.max(d, hemY(a) - y);
    // open at the hem: a wall of silk 2.5 cm thick, hollow inside
    if (y < 0.62) d = Math.max(d, -((q - 1) * m + 0.026 + amp));
    return d;
  };
  const bodyField: Field = (x, y, z) => smin(bodice(x, y, z), gown(x, y, z), 0.06);
  const whole = new VoxelModel('cleo');
  raster(whole, VS, [-0.5, 0.08, -0.45], [0.5, 2.55, 0.42], bodyField, (x, y, z, _nx, ny) => {
    const a = Math.atan2(x, z);
    let fold = 0;
    if (y < 1.66) fold = gownFold(a, y) * sstep(1.66, 1.4, y);
    else fold = (z > 0 ? Math.sin((x * (y > 2.0 ? 0.7 : -0.7) + y) * 30) : Math.sin(x * 40 + y * 4)) * 0.6;
    // the lotus hem: a gold band with lotus buds, then an embroidered border
    const hy = hemY(a);
    if (y < hy + 0.035) return pk(ny > 0.2 ? GOLDC.hi : GOLDC.base, VF.METAL);
    if (y < hy + 0.11) {
      const u = (a / (Math.PI * 2)) * 64;
      const fu = u - Math.floor(u), v = (y - hy - 0.035) / 0.075;
      const bud = Math.abs(fu - 0.5) < 0.42 - v * 0.38 && v < 0.85;
      if (bud) return pk((Math.floor(u) & 1) ? LAPIS : GOLDC.base, (Math.floor(u) & 1) ? VF.SOLID : VF.METAL);
    }
    // the interior of the gown seen from below: deep shadowed silk
    if (y < 0.64 && ny < -0.2 && Math.hypot(x, z) < 0.3) return pk(SILK.deep);
    return silk(x, y, z, ny, fold);
  }, { interior: SILK.deep });

  // ------------------------------------------------------------------ the girdle and its winged-sun clasp
  const girdle: Field = (x, y, z) => Math.max(Math.hypot(x / 0.158, (z - 0.002) / 0.12) - 1, Math.abs(y - 1.855 + z * 0.08) / 0.024 - 1) * 0.03;
  raster(whole, VS, [-0.22, 1.78, -0.18], [0.22, 1.94, 0.18], girdle, (x, y, z, _nx, ny) => {
    const a = Math.atan2(x, z);
    return (Math.floor(a * 9) & 1) ? goldP(ny) : pk(a > 0 ? LAPIS : CARN);
  });
  {
    const cz = 0.128, cy = 1.85;
    const clasp: Field = (x, y, z) => {
      const disc = Math.hypot(x, y - cy) - 0.032;
      const wing = Math.max(Math.abs(x) - 0.13, Math.abs(y - cy - 0.004 + Math.abs(x) * 0.12) - (0.018 - Math.abs(x) * 0.08));
      return Math.max(Math.min(disc, wing), Math.abs(z - cz) - 0.01);
    };
    raster(whole, VS, [-0.16, 1.78, cz - 0.03], [0.16, 1.92, cz + 0.03], clasp, (x, y) => {
      if (Math.hypot(x, y - cy) < 0.02) return pk(CARN, VF.GLOW);
      const feather = Math.floor(Math.abs(x) / 0.02);
      return pk(feather % 2 ? TURQ : GOLDC.hi, feather % 2 ? VF.SOLID : VF.METAL);
    });
  }

  // ------------------------------------------------------------------ cut the body into pelvis / torso / skirt / skirt_lo
  rig.part('pelvis', undefined, P.pelvis);
  rig.part('torso', 'pelvis', P.torso);
  rig.part('skirt', 'pelvis', P.skirt);
  rig.part('skirt_lo', 'skirt', P.knee);
  const cuts: [string, number][] = [['torso', 1.93], ['pelvis', 1.47], ['skirt', 0.86], ['skirt_lo', -9]];
  const pm: Record<string, VoxelModel> = { torso: rig.m('torso'), pelvis: rig.m('pelvis'), skirt: rig.m('skirt'), skirt_lo: rig.m('skirt_lo') };
  whole.forEach((x, y, z, c, f) => {
    const Y = (y + 0.5) * VS;
    let i = 0;
    while (Y < cuts[i][1]) i++;
    pm[cuts[i][0]].set(x, y, z, c, f);
    // buried plug: a few cells across the cut so bending never opens a gap
    if (i < cuts.length - 1 && Y - cuts[i][1] < 0.05) {
      let buried = true;
      for (const [dx, dy, dz] of [[2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 2], [0, 0, -2], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]])
        if (!whole.has(x + dx, y + dy, z + dz)) buried = false;
      if (buried) pm[cuts[i + 1][0]].set(x, y, z, c, f);
    }
  });

  // ================================================================== the head: veiled face and hood
  const faceU = union(
    [
      E([0, 2.81, 0.0], [0.13, 0.165, 0.152]),
      E([0, 2.872, 0.106], [0.1, 0.03, 0.046]),
      C([0, 2.852, 0.142], [0, 2.772, 0.184], 0.022, 0.028),
      E([0, 2.772, 0.166], [0.034, 0.02, 0.022]),
      E([0.068, 2.79, 0.1], [0.05, 0.045, 0.05]),
      E([-0.068, 2.79, 0.1], [0.05, 0.045, 0.05]),
      E([0, 2.672, 0.115], [0.05, 0.042, 0.04]),
      E([0, 2.93, -0.03], [0.12, 0.07, 0.12]),
      SUB(E([0.046, 2.832, 0.142], [0.03, 0.017, 0.022])),
      SUB(E([-0.046, 2.832, 0.142], [0.03, 0.017, 0.022])),
    ],
    0.025
  );
  const hoodU = union(
    [
      E([0, 2.64, -0.1], [0.19, 0.3, 0.13]),
      C([0.11, 2.86, -0.03], [0.23, 2.47, -0.05], 0.06, 0.12),
      C([-0.11, 2.86, -0.03], [-0.23, 2.47, -0.05], 0.06, 0.12),
      C([0, 2.62, 0.0], [0, 2.47, 0.0], 0.1, 0.13),
    ],
    0.08
  );
  // the fall of silk from the bridge of the nose to the collarbones
  const curtain: Field = (x, y, z) => {
    if (y > 2.79 || y < 2.4) return 0.2;
    const t = (2.79 - y) / 0.39;
    const zf = 0.168 - t * 0.12;
    const hw = 0.06 + t * 0.12;
    const zb = 0.0 - t * 0.04;
    return Math.max(z - zf - Math.cos((x / hw) * 1.4) * 0.006, zb - z, Math.abs(x) - hw);
  };
  const hoodFold = (x: number, y: number, z: number) => {
    const a = Math.atan2(x, z + 0.02);
    const k = sstep(2.95, 2.6, y);
    return Math.sin(a * 7 + 0.6) * k;
  };
  const headField: Field = (x, y, z) => {
    const face = faceU(x, y, z) - 0.006;
    const hood = hoodU(x, y, z);
    let d = smin(face, hood, 0.07);
    d = smin(d, curtain(x, y, z), 0.035);
    if (d > 0.03) return d;
    const inFace = z > 0.07 && y > 2.6 && Math.abs(x) < 0.11;
    return d - (inFace ? 0 : hoodFold(x, y, z) * 0.012);
  };
  const head = rig.part('head', 'torso', P.head);
  raster(head, VS, [-0.32, 2.36, -0.32], [0.32, 3.06, 0.26], headField, (x, y, z, _nx, ny) => {
    const inFace = z > 0.07 && y > 2.6 && Math.abs(x) < 0.11;
    const fold = inFace ? 0.25 : hoodFold(x, y, z);
    // a thin gold border where the hood's edge falls over the shoulders
    const edge = !inFace && y < 2.52 && Math.abs(Math.abs(x) - 0.21) < 0.015 && z < 0.05;
    return silk(x, y, z, ny, fold, { trim: edge });
  }, { interior: SILK.deep });

  // ------------------------------------------------------------------ usekh collar: conforms to the hood and shoulders
  {
    const cBody: Field = (x, y, z) => Math.min(bodice(x, y, z), headField(x, y, z));
    const front = (x: number, z: number) => Math.max(0, Math.cos(Math.atan2(x, z)));
    const yTop = (x: number, z: number) => 2.5 - 0.05 * front(x, z);
    const depth = (x: number, z: number) => 0.045 + 0.085 * Math.pow(front(x, z), 1.5);
    const col: Field = (x, y, z) => {
      if (y < 2.25 || y > 2.56) return 0.1;
      const d = cBody(x, y, z);
      const yt = yTop(x, z), dp = depth(x, z);
      return Math.max(Math.abs(d - 0.01) - 0.009, y - yt, yt - dp - y);
    };
    const cm = rig.m('torso');
    raster(cm, VS, [-0.4, 2.25, -0.3], [0.4, 2.58, 0.3], col, (x, y, z, _nx, ny) => {
      const v = (yTop(x, z) - y) / depth(x, z);
      const rows = [GOLDC.hi, LAPIS, GOLDC.base, CARN, GOLDC.base, TURQ, GOLDC.hi];
      const row = Math.max(0, Math.min(rows.length - 1, Math.floor(v * rows.length)));
      const c = rows[row];
      const metal = c === GOLDC.base || c === GOLDC.hi;
      const bead = (Math.floor(Math.atan2(x, z) * 22) & 1) === 0;
      return pk(metal ? (ny > 0.4 ? GOLDC.hi : c) : bead ? c : mulc(c, 0.8), metal ? VF.METAL : VF.SOLID);
    });
    // teardrop pendants around the front edge
    for (let i = -7; i <= 7; i++) {
      const a = (i / 7) * 1.1;
      const yb = yTop(Math.sin(a), Math.cos(a)) - depth(Math.sin(a), Math.cos(a)) - 0.012;
      let r = 0.5;
      while (r > 0.02 && cBody(Math.sin(a) * r, yb, Math.cos(a) * r) > 0.012) r -= 0.003;
      const x0 = Math.sin(a) * r, z0 = Math.cos(a) * r;
      const dc: V3 = [x0, yb, z0 + 0.004];
      const drop = union([E(dc, [0.012, 0.022, 0.01])], 0.005);
      rasterU(cm, VS, drop, () => pk(i & 1 ? CARN : GOLDC.hi, i & 1 ? VF.EMISSIVE : VF.METAL), { under: true });
    }
  }

  // ================================================================== the crown: diadem, uraeus, lyre horns, sun disc, corona
  const crown = rig.part('crown', 'head', P.crown);
  {
    const yb = (z: number) => 2.935 - z * 0.25;
    const band: Field = (x, y, z) => {
      const q = Math.hypot(x / 0.13, (z - 0.004) / 0.158);
      return Math.hypot((q - 1) * 0.142, y - yb(z)) - 0.017;
    };
    raster(crown, VS, [-0.2, 2.86, -0.22], [0.2, 3.02, 0.22], band, (x, y, z, _nx, ny) => {
      const a = Math.atan2(x, z);
      const seg = Math.floor(a * 6);
      if (Math.abs(y - yb(z)) < 0.007 && (seg & 1)) return pk(seg & 2 ? LAPIS : CARN);
      return goldP(ny);
    });
    // lyre horns rising from the temples and cradling the disc
    for (const s of [1, -1]) {
      const pts = curve([[s * 0.1, 2.96, -0.06], [s * 0.18, 3.06, -0.1], [s * 0.235, 3.22, -0.11], [s * 0.225, 3.4, -0.11], [s * 0.15, 3.53, -0.105]], 14);
      const hf = union(tubePrims(pts, (t) => 0.03 - t * 0.022), 0.01);
      rasterU(crown, VS, hf, (x, y, z, _nx, ny) => {
        const groove = Math.sin((y + Math.abs(x)) * 160) > 0.7;
        void z;
        return pk(groove ? GOLDC.shade : ny > 0.4 ? GOLDC.hi : GOLDC.base, VF.METAL);
      });
    }
    // a gold mount behind the disc
    const mount = union([C([0, 2.97, -0.08], [0, 3.1, -0.12], 0.035, 0.03)], 0.01);
    rasterU(crown, VS, mount, (_x, _y, _z, _nx, ny) => goldP(ny));
  }
  // the sun disc: a lens of molten gold-red light in a raised gold rim
  const disc = rig.part('sun_disc', 'crown', P.disc);
  {
    const D = P.disc, R = 0.205;
    const lens: Field = (x, y, z) => {
      const r = Math.hypot(x - D[0], y - D[1]);
      const th = 0.012 + 0.03 * Math.sqrt(Math.max(0, 1 - (r / R) ** 2));
      return Math.max(r - R, Math.abs(z - D[2]) - th);
    };
    raster(disc, VS, [D[0] - R - 0.02, D[1] - R - 0.02, D[2] - 0.06], [D[0] + R + 0.02, D[1] + R + 0.02, D[2] + 0.06], lens, (x, y, _z, _nx, _ny, nz) => {
      const r = Math.hypot(x - D[0], y - D[1]) / R;
      if (r > 0.9) return goldP(_ny);
      if (nz < -0.4) return pk(GOLDC.shade, VF.METAL);
      const ring = Math.sin(r * 26) > 0.6;
      if (r < 0.22) return pk(CORE, VF.GLOW);
      if (r < 0.5) return pk(ring ? 0xf09030 : 0xffc050, VF.EMISSIVE);
      return pk(ring ? 0xb83a14 : 0xd8561c, VF.EMISSIVE);
    });
    // the corona: sixteen tapered rays, long and short, turning slowly (own part)
    const rays = rig.part('rays', 'sun_disc', D);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
      const L = i & 1 ? 0.06 : 0.12;
      const r0 = 0.27;
      const dir: V3 = [Math.cos(a), Math.sin(a), 0];
      const base: V3 = [D[0] + dir[0] * r0, D[1] + dir[1] * r0, D[2] - 0.01];
      const tip: V3 = add3(base, dir, L);
      const side: V3 = [-dir[1], dir[0], 0];
      const ray: Field = (x, y, z) => {
        const px = x - base[0], py = y - base[1];
        const u = px * dir[0] + py * dir[1], v = px * side[0] + py * side[1];
        const t = u / L;
        const w = 0.026 * (1 - t) + 0.002;
        return Math.max(-u, u - L, Math.abs(v) - w, Math.abs(z - base[2]) - 0.01);
      };
      raster(rays, VS, [Math.min(base[0], tip[0]) - 0.04, Math.min(base[1], tip[1]) - 0.04, base[2] - 0.03], [Math.max(base[0], tip[0]) + 0.04, Math.max(base[1], tip[1]) + 0.04, base[2] + 0.03], ray, (x, y) => {
        const u = (x - base[0]) * dir[0] + (y - base[1]) * dir[1];
        return u > L * 0.7 ? pk(0xfff0b0, VF.EMISSIVE) : pk(GOLDC.base, VF.METAL);
      });
    }
  }
  // the uraeus: a rearing gold cobra with a jewelled hood and ruby eyes
  const cobra = rig.part('cobra', 'crown', P.cobra);
  {
    const body = curve([[0, 3.0, -0.07], [0, 3.02, 0.05], [0, 2.955, 0.135], [0, 3.02, 0.165], [0, 3.1, 0.172], [0, 3.15, 0.182]], 22);
    const bf = union(tubePrims(body, (t) => 0.012 + Math.sin(t * Math.PI) * 0.008), 0.008);
    rasterU(cobra, VS, bf, (_x, y, _z, _nx, ny) => pk((Math.floor(y * 120) & 1) ? GOLDC.base : ny > 0.3 ? GOLDC.hi : GOLDC.shade, VF.METAL));
    const hood: Field = (x, y, z) => {
      const e = Math.hypot(x / 0.048, (y - 3.085) / 0.062) - 1;
      return Math.max(e * 0.048, Math.abs(z - 0.168 + (x * x) * 2) - 0.009);
    };
    raster(cobra, VS, [-0.06, 3.0, 0.14], [0.06, 3.16, 0.2], hood, (x, y, _z, _nx, _ny, nz) => {
      if (nz < -0.3) return pk(GOLDC.shade, VF.METAL);
      const r = Math.hypot(x / 0.048, (y - 3.085) / 0.062);
      if (r > 0.82) return pk(GOLDC.hi, VF.METAL);
      const band = Math.floor((y - 3.02) / 0.016);
      return pk(Math.abs(x) < 0.008 ? GOLDC.base : band % 3 === 0 ? LAPIS : band % 3 === 1 ? CARN : TURQ, Math.abs(x) < 0.008 ? VF.METAL : VF.SOLID);
    });
    const hd = union([E([0, 3.158, 0.19], [0.017, 0.013, 0.024])], 0.005);
    rasterU(cobra, VS, hd, (_x, _y, _z, _nx, ny) => goldP(ny));
    for (const s of [1, -1]) cobra.set(Math.floor((s * 0.013) / VS), Math.floor(3.165 / VS), Math.floor(0.196 / VS), RUBY, VF.GLOW);
  }

  // ================================================================== arms: sleeves, armlets, hands (left; mirrored)
  const arm = rig.part('arm_l', 'torso', P.sh);
  const fore = rig.part('fore_l', 'arm_l', P.el);
  const hand = rig.part('hand_l', 'fore_l', P.wr);
  const fing = rig.part('fing_l', 'hand_l', KN);
  const thumb = rig.part('thumb_l', 'hand_l', TB);
  {
    const up = union([C(P.sh, P.el, 0.068, 0.056), E([0.3, 2.26, -0.02], [0.072, 0.12, 0.072])], 0.04);
    raster(arm, VS, up.lo, up.hi, (x, y, z) => up(x, y, z) - Math.sin(y * 40 + x * 20) * 0.0015, (x, y, z, _nx, ny) => {
      // a gold armlet with a lapis band
      const t = (P.sh[1] - y) / (P.sh[1] - P.el[1]);
      if (t > 0.42 && t < 0.52) return Math.abs(t - 0.47) < 0.014 ? pk(LAPIS) : goldP(ny);
      return silk(x, y, z, ny, Math.sin(y * 40 + x * 20) * 0.5);
    }, { interior: SILK.deep });
    // the bell sleeve: flares from the elbow and opens over the wrist
    const tip = add3(P.wr, ARM_DIR, 0.05);
    const bell = union([C(P.el, tip, 0.056, 0.105)], 0.02);
    const hollow = union([C(add3(P.wr, ARM_DIR, -0.14), add3(tip, ARM_DIR, 0.05), 0.03, 0.088)], 0.01);
    const sleeveFold = (x: number, y: number, z: number) => {
      const t = clamp01(len3(sub3([x, y, z], P.el)) / 0.5);
      const a = Math.atan2(z - P.el[2], x - P.el[0]);
      return Math.sin(a * 6 + t * 2) * t;
    };
    raster(fore, VS, bell.lo, bell.hi, (x, y, z) => Math.max(bell(x, y, z) - sleeveFold(x, y, z) * 0.01, -hollow(x, y, z)), (x, y, z, _nx, ny) => {
      const t = len3(sub3([x, y, z], P.el)) / len3(sub3(tip, P.el));
      if (t > 0.9) return goldP(ny); // gold cuff hem
      if (t > 0.82 && t < 0.88) return pk(LAPIS);
      return silk(x, y, z, ny, sleeveFold(x, y, z));
    }, { interior: SILK.deep });
    // the hand: slender palm, long fingers with a dancer's soft curl, gold rings and gilded nails
    const roll = Math.atan2(ARM_DIR[0], -ARM_DIR[1]);
    const palmC = add3(P.wr, ARM_DIR, 0.075);
    const palm = union([E(palmC, [0.022, 0.078, 0.044], [0, 0, roll]), C(add3(P.wr, ARM_DIR, -0.02), add3(P.wr, ARM_DIR, 0.03), 0.028, 0.03)], 0.02);
    const skinP: Paint = (_x, _y, _z, _nx, ny) => pk(ny > 0.4 ? SKIN.light : ny < -0.4 ? SKIN.shade : SKIN.base);
    rasterU(hand, VS, palm, skinP);
    // wrist cuff
    const cuff = union([C(add3(P.wr, ARM_DIR, -0.01), add3(P.wr, ARM_DIR, 0.025), 0.034, 0.034)], 0.005);
    rasterU(hand, VS, cuff, (x, y, z, _nx, ny) => ((Math.floor(Math.atan2(z - P.wr[2], x - P.wr[0]) * 4) & 1) ? goldP(ny) : pk(TURQ)));
    const lens = [0.09, 0.105, 0.1, 0.08];
    for (let j = 0; j < 4; j++) {
      const zo = (j - 1.5) * 0.021;
      const b0 = add3(KN, [0, 0, zo]);
      const curl = 0.02 + j * 0.004;
      const L = lens[j];
      const m1 = add3(add3(b0, ARM_DIR, L * 0.55), [-curl * 0.5, 0, 0]);
      const t1 = add3(add3(b0, ARM_DIR, L), [-curl, 0, zo * 0.15]);
      const ff = union([C(b0, m1, 0.013, 0.011), C(m1, t1, 0.011, 0.008)], 0.006);
      rasterU(fing, VS, ff, (x, y, z, _nx, ny) => {
        const tt = len3(sub3([x, y, z], b0)) / L;
        if (tt > 0.86) return pk(GOLDC.hi, VF.METAL); // gilded nails
        if ((j === 1 || j === 3) && tt > 0.22 && tt < 0.32) return goldP(ny); // rings
        return skinP(x, y, z, 0, ny, 0, 0);
      });
    }
    const t0 = TB, t1 = add3(add3(TB, ARM_DIR, 0.05), [-0.01, 0, 0.035]), t2 = add3(t1, norm3([ARM_DIR[0] - 0.2, ARM_DIR[1], 0.5]), 0.04);
    const tf = union([C(t0, t1, 0.015, 0.012), C(t1, t2, 0.012, 0.009)], 0.006);
    rasterU(thumb, VS, tf, (x, y, z, _nx, ny) => (len3(sub3([x, y, z], t0)) > 0.08 ? pk(GOLDC.hi, VF.METAL) : skinP(x, y, z, 0, ny, 0, 0)));
  }

  // ================================================================== feet en pointe, gold anklets
  const foot = rig.part('foot_l', 'skirt_lo', P.foot);
  {
    const ank: V3 = [0.075, 0.24, 0.02], ball: V3 = [0.08, 0.08, 0.075], toe: V3 = [0.082, 0.015, 0.1];
    const ff = union([C([0.075, 0.36, 0.0], ank, 0.034, 0.028), C(ank, ball, 0.03, 0.026), C(ball, toe, 0.024, 0.014), E([0.072, 0.21, -0.012], [0.026, 0.032, 0.028])], 0.02);
    rasterU(foot, VS, ff, (x, y, z, _nx, ny) => {
      if (Math.abs(y - 0.25) < 0.012) return goldP(ny);
      if (y < 0.06 && Math.abs(y - 0.045) < 0.008) return goldP(ny); // toe ring
      void x; void z;
      return pk(ny > 0.4 ? SKIN.light : ny < -0.4 ? SKIN.shade : SKIN.base);
    });
  }

  // ================================================================== the bead apron: seven strands down the front of the gown
  const apron = rig.part('apron', 'pelvis', [0, 1.84, 0.12]);
  {
    const front = (x: number, y: number) => {
      let z = 0.5;
      while (z > -0.1 && gown(x, y, z) > 0 && bodice(x, y, z) > 0) z -= 0.004;
      return z;
    };
    for (let i = -3; i <= 3; i++) {
      const x0 = i * 0.034;
      for (let y = 1.82; y > 1.06 + Math.abs(i) * 0.06; y -= 0.026) {
        const x = x0 * (1 + (1.82 - y) * 0.25);
        const z = front(x, y) + 0.012;
        const k = Math.round((1.82 - y) / 0.026);
        const bead = union([E([x, y, z], [0.011, 0.013, 0.009])], 0.004);
        const c = k % 3 === 0 ? GOLDC.hi : k % 3 === 1 ? (i & 1 ? LAPIS : CARN) : GOLDC.base;
        rasterU(apron, VS, bead, () => pk(c, c === GOLDC.hi || c === GOLDC.base ? VF.METAL : VF.SOLID));
      }
    }
  }

  // ------------------------------------------------------------------ mirror, finish, sockets
  rig.mirrorLR();
  for (const p of rig.parts) finish(p.model, 1.03, 0.93, (_c, f) => (f & (VF.METAL | VF.EMISSIVE | VF.GLOW)) !== 0);
  rig.socket('veil_anchor', 'head', [0, 2.95, -0.11]);
  rig.socket('heart', 'torso', P.heart);
  rig.socket('chest_front', 'torso', [0, 2.16, 0.16]);
  rig.socket('disc', 'sun_disc', P.disc);
  rig.socket('disc_front', 'sun_disc', [P.disc[0], P.disc[1], P.disc[2] + 0.08]);
  rig.socket('cobra_mouth', 'cobra', [0, 3.155, 0.215]);
  rig.socket('head_top', 'head', [0, 3.0, 0]);
  rig.socket('face', 'head', [0, 2.82, 0.17]);
  rig.socket('sash_l', 'pelvis', [0.13, 1.84, 0.1]);
  rig.socket('skirt_f', 'pelvis', [0, 1.6, 0.2]);
  rig.socket('skirt_b', 'pelvis', [0, 1.6, -0.22]);
  rig.socket('skirt_l', 'pelvis', [0.26, 1.6, -0.02]);
  rig.socket('sleeve_a_l', 'fore_l', add3(P.el, [0.0, -0.05, -0.04]));
  rig.socket('sleeve_b_l', 'fore_l', add3(add3(P.wr, ARM_DIR, 0.04), [0.02, 0, -0.08]));
  rig.socket('palm_l', 'hand_l', add3(add3(P.wr, ARM_DIR, 0.09), [-0.03, 0, 0]));
  rig.socket('fingertip_l', 'fing_l', add3(KN, ARM_DIR, 0.1));
  rig.mirrorLR();
  return rig.build({
    kind: 'cleopatra',
    height: CLEO.height,
    radius: 0.5,
    armDir: ARM_DIR,
    defaultExpression: 'neutral',
  });
}

let CACHE: RigSpec | null = null;
/** Cleopatra, Avatar of Ra */
export function cleopatraRig(): RigSpec {
  return (CACHE ??= build());
}
void SUB;
void n01;
void lerp;
void scl3;
void mirX;
