// CLEOPATRA'S ROYAL GUARD, a "Ram of Amun": a 2.5 m ram-headed elite warrior
// of the sun queen (1/44 m voxels, realistic proportions, not chibi).
// A deep-bronze athlete in a gold scale corselet, gold pauldrons and greaves,
// a pleated white linen kilt with a stiff gold-edged apron and a red sash. The
// ram head carries a Roman nose, short cream face hair, curly wool over the poll
// and down the neck, drooping ears, modelled amber eyes with the ram's
// horizontal bar pupils, and two massive ridged spiral horns capped in gold.
// He carries a tall round-topped gold shield (sun boss, horn relief, rivets,
// leather back) and a sun glaive (ebony shaft banded in gold, crescent blade
// pierced with a sun disc).
// The arms are sculpted in the READY pose (elbows bent, forearms forward), so
// the shield faces front and the glaive stands upright at rest:
//   pelvis (root) → torso → head → jaw, ear_l/_r, eye_l/_r
//   torso → arm_l → fore_l → shield · torso → arm_r → fore_r → weapon
//   pelvis → thigh_l → shin_l (and _r) · pelvis → apron (stiff front flap)
// Sockets: cape_anchor (between the shoulders), shield_face, blade, mouth.
import { KRig, VoxelModel, VF, E, C, SUB, union, raster, rasterU, finish, eyeball, curve, tubePrims, pk, mixc, mulc, nS, n01, sstep, clamp01, mirX, norm3, lerp, segDist, type V3, type Prim, type RigSpec, type Field, type Paint } from './kit';

const VS = 1 / 44;

const SKIN = { base: 0x8a5636, light: 0xa8704a, shade: 0x6a3e26, dark: 0x4a2a1a };
const GOLD = { hi: 0xffe28e, base: 0xe2b44c, shade: 0xb08028, dark: 0x6e4c14 };
const LINEN = { base: 0xf0e8d6, light: 0xfbf6ea, shade: 0xd2c6ae, dark: 0xa89a80 };
const LAPIS = 0x2c4c9e, CARN = 0xb4382a, TURQ = 0x3aa6a0, SASH = 0xa82a24;
const WOOL = { base: 0xe6dac0, light: 0xf6eedc, shade: 0xbfae8c, dark: 0x8c7a5a };
const FACE = { base: 0xece2cc, shade: 0xc8b89a, nose: 0x8a7a6c };
const HORN = { base: 0xd8c49a, ridge: 0xa8946a, light: 0xeee0bc, dark: 0x7c6a48 };
const EBONY = 0x2a1a14, LEATHER = 0x6a4228;

/** gold paint with scales / plain, by normal */
const goldP = (ny: number) => (ny > 0.55 ? GOLD.hi : ny < -0.5 ? GOLD.shade : GOLD.base);

function build(): RigSpec {
  const rig = new KRig('cleo_guard', VS);
  // ------------------------------------------------------------------ landmarks (left; right mirrored)
  const HIP: V3 = [0.13, 1.2, 0], KNEE: V3 = [0.135, 0.66, 0.03], ANK: V3 = [0.125, 0.11, -0.01];
  const SH: V3 = [0.29, 1.95, -0.02], EL: V3 = [0.33, 1.52, -0.04], WR: V3 = [0.33, 1.47, 0.29], FIST: V3 = [0.33, 1.46, 0.37];
  const HEAD_P: V3 = [0, 2.08, 0], JAW_P: V3 = [0, 2.2, 0.07];
  const EYE: V3 = [0.083, 2.3, 0.105];

  // ------------------------------------------------------------------ body (skin under the armour)
  const side: Prim[] = [
    E([0.11, 1.8, 0.1], [0.12, 0.09, 0.08]), // pec
    E([0.18, 1.66, -0.04], [0.1, 0.2, 0.12]), // lat
    E([0.29, 1.93, -0.01], [0.11, 0.11, 0.11]), // deltoid
    E([0.09, 1.2, -0.08], [0.1, 0.12, 0.1]), // glute
    // leg
    C(HIP, KNEE, 0.11, 0.075),
    E([0.14, 0.94, 0.05], [0.085, 0.2, 0.09]), // quad
    C(KNEE, ANK, 0.07, 0.045),
    E([0.13, 0.47, -0.03], [0.065, 0.13, 0.07]), // calf
    E([0.125, 0.04, 0.06], [0.055, 0.04, 0.12]), // foot
    // arm (ready pose)
    C(SH, EL, 0.085, 0.066),
    E([0.31, 1.75, 0.01], [0.07, 0.13, 0.075]), // biceps
    E([0.31, 1.73, -0.07], [0.06, 0.13, 0.065]), // triceps
    C(EL, WR, 0.064, 0.048),
    E([0.33, 1.5, 0.1], [0.07, 0.065, 0.12]), // forearm muscle
    E(FIST, [0.05, 0.06, 0.055]),
  ];
  const P: Prim[] = [
    E([0, 1.72, 0], [0.25, 0.27, 0.17]),
    E([0, 1.47, 0.02], [0.19, 0.17, 0.14]),
    E([0, 1.72, -0.08], [0.22, 0.25, 0.12]),
    C([0, 2.0, -0.04], [0.22, 1.98, -0.04], 0.09, 0.07),
    C([0, 2.0, -0.04], [-0.22, 1.98, -0.04], 0.09, 0.07),
    C([0, 1.96, -0.03], [0, 2.14, 0.0], 0.1, 0.085),
    E([0, 1.24, -0.01], [0.21, 0.14, 0.15]),
  ];
  for (const q of side) {
    P.push(q);
    P.push(q.c ? { ...q, c: mirX(q.c) } : { ...q, a: mirX(q.a!), b: mirX(q.b!) });
  }
  // the right fist grips the glaive shaft: leave a channel
  const body = union(P, 0.05);
  const whole = new VoxelModel('guard');
  const scaleY = (y: number) => Math.floor(y / 0.032);
  const bodyPaint: Paint = (x, y, z, nx, ny) => {
    const ax = Math.abs(x);
    // corselet: gold scales over chest and belly (not the arms)
    const onArm = ax > 0.24 && y < 1.93;
    if (y > 1.4 && y < 1.99 && !onArm && !(y > 1.9 && Math.hypot(x, z - 0.02) < 0.12)) {
      const row = scaleY(y);
      const u = Math.atan2(x, z) * 0.35 / 0.03 + (row & 1) * 0.5;
      const fu = u - Math.floor(u), fy = y / 0.032 - row;
      let c = fy < 0.25 ? GOLD.dark : fy > 0.7 ? GOLD.hi : GOLD.base;
      if (Math.abs(fu - 0.5) > 0.42) c = GOLD.shade;
      if (y > 1.93) c = (Math.floor(Math.atan2(x, z) * 5) & 1) ? LAPIS : GOLD.base; // collar band
      if (ny < -0.5) c = mulc(c, 0.85);
      return pk(c, VF.METAL);
    }
    // pauldrons
    if (ax > 0.2 && y > 1.88) return pk(goldP(ny), VF.METAL);
    // gold bracers on the forearms, greaves on the shins
    if (ax > 0.25 && y > 1.38 && y < 1.56 && z > 0.06 && z < 0.27) return pk(goldP(ny), VF.METAL);
    if (y > 0.2 && y < 0.58 && ax > 0.05) return pk(y > 0.55 || y < 0.23 ? GOLD.shade : ny > 0.4 ? GOLD.hi : GOLD.base, VF.METAL);
    // sandals
    if (y < 0.05) return pk(y < 0.02 ? LEATHER : SKIN.base);
    if (y < 0.14 && y > 0.09 && ax > 0.06) return pk(GOLD.base, VF.METAL);
    const m = nS(x, y, z, 22, 2);
    return pk(ny > 0.5 ? SKIN.light : ny < -0.4 ? SKIN.shade : m > 0.45 ? SKIN.light : m < -0.5 ? SKIN.shade : SKIN.base);
  };
  rasterU(whole, VS, body, bodyPaint, { interior: SKIN.dark });

  // ------------------------------------------------------------------ pleated linen kilt + red sash + gold belt
  const kilt: Field = (x, y, z) => {
    const t = clamp01((1.46 - y) / 0.62);
    const rx = lerp(0.215, 0.31, t), rz = lerp(0.165, 0.27, t), zc = lerp(-0.01, 0.0, t);
    const a = Math.atan2(x, z - zc);
    const pleat = Math.abs(a) > 0.5 ? 0.012 * Math.sin(a * 34) * t : 0;
    const q = Math.hypot(x / rx, (z - zc) / rz);
    const d = (q - 1) * Math.min(rx, rz) - pleat;
    const hem = 0.84 + 0.015 * Math.sin(a * 2 + 0.5);
    return Math.max(d, hem - y, y - 1.47);
  };
  raster(whole, VS, [-0.36, 0.8, -0.32], [0.36, 1.5, 0.32], kilt, (x, y, z, nx, ny) => {
    const a = Math.atan2(x, z);
    const pl = Math.sin(a * 34);
    let c = pl > 0.3 ? LINEN.light : pl < -0.5 ? LINEN.shade : LINEN.base;
    if (y < 0.88) c = (Math.floor(a * 18) & 1) ? GOLD.base : LINEN.base; // gold hem stitching
    if (ny < -0.5) c = LINEN.dark;
    void nx;
    return pk(c, c === GOLD.base ? VF.METAL : VF.SOLID);
  }, { interior: LINEN.dark });
  // sash and belt
  const belt: Field = (x, y, z) => Math.max(Math.hypot(x / 0.225, (z + 0.005) / 0.175) - 1, Math.abs(y - 1.43) / 0.05 - 1) * 0.05;
  raster(whole, VS, [-0.3, 1.36, -0.25], [0.3, 1.5, 0.25], belt, (x, y, _z, _nx, ny) => {
    if (Math.abs(y - 1.43) < 0.016) return pk(goldP(ny), VF.METAL);
    return pk(Math.abs(x) < 0.04 ? GOLD.base : SASH, Math.abs(x) < 0.04 ? VF.METAL : VF.SOLID);
  });
  // sun buckle
  const bk: Field = (x, y, z) => Math.max(Math.hypot(x, y - 1.43) - 0.05, Math.abs(z - 0.19) - 0.012);
  raster(whole, VS, [-0.07, 1.36, 0.15], [0.07, 1.5, 0.23], bk, (x, y) => pk(Math.hypot(x, y - 1.43) < 0.022 ? CARN : GOLD.hi, Math.hypot(x, y - 1.43) < 0.022 ? VF.EMISSIVE : VF.METAL));

  // ------------------------------------------------------------------ the ram head
  const H: Prim[] = [
    E([0, 2.29, -0.02], [0.115, 0.12, 0.13]),
    E([0, 2.35, 0.04], [0.1, 0.07, 0.09]),
    C([0, 2.3, 0.08], [0, 2.17, 0.3], 0.085, 0.058),
    E([0, 2.255, 0.2], [0.062, 0.055, 0.09]), // Roman nose
    E([0, 2.15, 0.315], [0.05, 0.04, 0.04]),
    E([0, 2.12, 0.22], [0.058, 0.035, 0.1]), // lower jaw
    E([0.068, 2.22, 0.1], [0.05, 0.06, 0.08]),
    E([-0.068, 2.22, 0.1], [0.05, 0.06, 0.08]),
    E([0, 2.13, -0.02], [0.1, 0.1, 0.11]), // throat
    SUB(E(EYE, [0.026, 0.02, 0.024])),
    SUB(E(mirX(EYE), [0.026, 0.02, 0.024])),
  ];
  const head = union(H, 0.035);
  // the royal headcloth: gold and lapis stripes over the poll, the nape and the lappets
  const nemes = (x: number, y: number, z: number, ny: number) => {
    const st = Math.floor((y + Math.abs(x) * 0.25 + z * 0.15) / 0.028) & 1;
    if (st) return pk(ny > 0.5 ? GOLD.hi : ny < -0.4 ? GOLD.shade : GOLD.base, VF.METAL);
    return pk(ny < -0.4 ? mulc(LAPIS, 0.75) : LAPIS);
  };
  const hp: Paint = (x, y, z, _nx, ny, nz) => {
    const ax = Math.abs(x);
    // curly wool over the poll, the nape and the throat ruff
    const woolly = (y > 2.34 && z < 0.12) || z < -0.06 || (y < 2.16 && z < 0.12);
    if (woolly) return nemes(x, y, z, ny);
    // nostrils and mouth line
    if (z > 0.31 && y > 2.14 && y < 2.18 && ax > 0.012 && ax < 0.035) return pk(0x3a2a22);
    if (Math.abs(y - (2.14 - (z - 0.2) * 0.1)) < 0.006 && z > 0.18) return pk(0x4a3a30);
    let c = ny > 0.5 ? mixc(FACE.base, 0xffffff, 0.3) : FACE.base;
    if (nz > 0.6 && z > 0.25) c = mixc(c, FACE.nose, 0.35);
    if (n01(x, y, z, 18, 9) < 0.25) c = mixc(c, FACE.shade, 0.6);
    return pk(c);
  };
  raster(whole, VS, [-0.2, 2.0, -0.2], [0.2, 2.5, 0.38], head, hp, { interior: WOOL.dark });
  // wool mane down the back of the neck
  const mane = union([C([0, 2.32, -0.08], [0, 1.98, -0.12], 0.1, 0.09), E([0, 2.08, 0.02], [0.13, 0.08, 0.13])], 0.04);
  raster(whole, VS, mane.lo, mane.hi, mane, (x, y, z, _nx, ny) => nemes(x, y, z, ny), { under: true, interior: WOOL.dark });
  // lappets falling over the collarbones
  for (const s of [1, -1]) {
    const lp: Field = (x, y, z) => {
      const t = clamp01((2.24 - y) / 0.38);
      return Math.max(Math.abs(x - s * (0.115 + t * 0.03)) - (0.045 + t * 0.012), Math.abs(z - (0.06 - t * 0.0) - 0.0) - 0.022, y - 2.26, 1.86 - y);
    };
    raster(whole, VS, [s > 0 ? 0.04 : -0.24, 1.84, -0.04], [s > 0 ? 0.24 : -0.04, 2.28, 0.12], lp, (x, y, z, _nx, ny) => (y < 1.89 ? pk(GOLD.base, VF.METAL) : nemes(x, y, z, ny)));
  }

  // ------------------------------------------------------------------ spiral horns (ridged ivory, gold caps)
  const hornPts = (s: number): V3[] => {
    const pts: V3[] = [[s * 0.06, 2.37, -0.0], [s * 0.13, 2.41, -0.04]];
    const O: V3 = [s * 0.17, 2.26, -0.07];
    const N = 30;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const th = Math.PI / 2 + u * Math.PI * 2.3;
      const R = 0.135 * (1 - 0.55 * u);
      pts.push([O[0] + s * (0.0 + 0.16 * u), O[1] + Math.sin(th) * R, O[2] - Math.cos(th) * R * 1.05]);
    }
    return pts;
  };
  for (const s of [1, -1]) {
    const pts = hornPts(s);
    const prims = tubePrims(pts, (t) => 0.05 * (1 - 0.75 * t) + 0.01, 0.01);
    const f = union(prims, 0.012);
    // arc length for the ridges
    const acc: number[] = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    const total = acc[acc.length - 1];
    const arcAt = (x: number, y: number, z: number) => {
      let bi = 0, bd = 1e9;
      for (let i = 0; i < pts.length; i++) {
        const d = (x - pts[i][0]) ** 2 + (y - pts[i][1]) ** 2 + (z - pts[i][2]) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      return acc[bi] / total;
    };
    raster(whole, VS, f.lo, f.hi, (x, y, z) => {
      const d = f(x, y, z);
      if (d > 0.01) return d;
      const u = arcAt(x, y, z);
      return d - (Math.sin(u * total * 190) > 0.5 ? 0.004 : 0);
    }, (x, y, z, _nx, ny) => {
      const u = arcAt(x, y, z);
      if (u > 0.9 || (u > 0.03 && u < 0.07)) return pk(goldP(ny), VF.METAL);
      const r = Math.sin(u * total * 190);
      return pk(r > 0.5 ? HORN.light : r < -0.6 ? HORN.ridge : ny < -0.4 ? HORN.dark : HORN.base);
    }, { interior: HORN.dark });
  }

  // ------------------------------------------------------------------ cut the body into parts
  rig.part('pelvis', undefined, [0, 1.22, 0]);
  rig.part('torso', 'pelvis', [0, 1.45, 0]);
  rig.part('head', 'torso', HEAD_P);
  rig.part('jaw', 'head', JAW_P);
  rig.part('apron', 'pelvis', [0, 1.4, 0.18]);
  for (const s of [1, -1]) {
    const sf = s > 0 ? '_l' : '_r';
    const m = (v: V3): V3 => [v[0] * s, v[1], v[2]];
    rig.part('arm' + sf, 'torso', m(SH));
    rig.part('fore' + sf, 'arm' + sf, m(EL));
    rig.part('thigh' + sf, 'pelvis', m(HIP));
    rig.part('shin' + sf, 'thigh' + sf, m(KNEE));
    rig.part('ear' + sf, 'head', m([0.1, 2.25, 0.0]));
  }
  const parts: Record<string, VoxelModel> = {};
  for (const p of rig.parts) parts[p.name] = p.model;
  whole.forEach((x, y, z, c, f) => {
    const X = (x + 0.5) * VS, Y = (y + 0.5) * VS, Z = (z + 0.5) * VS;
    const ax = Math.abs(X), s = X >= 0 ? '_l' : '_r';
    const sx = Math.sign(X) || 1;
    const dU = segDist(ax, Y, Z, SH, EL) / 0.12, dF = segDist(ax, Y, Z, EL, FIST) / 0.1;
    let p: string;
    if (Y > 2.15 || (Y > 2.0 && ax < 0.14 && Z > -0.04)) {
      p = Y < 2.19 - Math.max(0, Z - 0.12) * 0.15 && Z > 0.1 && ax < 0.08 ? 'jaw' : 'head';
    } else if (ax > 0.21 && Math.min(dU, dF) < 1.2 && !(Y > 1.9 && ax < 0.3)) {
      p = dF < dU ? 'fore' + s : 'arm' + s;
    } else if (Y < 0.845) p = (Y < 0.64 ? 'shin' : 'thigh') + s;
    else if (Y < 1.47) p = 'pelvis';
    else p = 'torso';
    void sx;
    parts[p].set(x, y, z, c, f);
  });
  // the kilt's front apron: a stiff gold-edged panel that swings on its own
  {
    const ap: Field = (x, y, z) => {
      const t = clamp01((1.4 - y) / 0.52);
      const hw = lerp(0.07, 0.15, t);
      const zf = lerp(0.18, 0.29, t);
      return Math.max(Math.abs(x) - hw, Math.abs(z - zf) - 0.016, y - 1.42, 0.86 - y);
    };
    raster(parts['apron'], VS, [-0.18, 0.84, 0.12], [0.18, 1.44, 0.34], ap, (x, y) => {
      const t = clamp01((1.4 - y) / 0.52);
      const hw = lerp(0.07, 0.15, t);
      const edge = hw - Math.abs(x) < 0.022 || y < 0.9;
      if (edge) return pk(GOLD.base, VF.METAL);
      const band = Math.floor((y - 0.86) / 0.07);
      return pk(band % 3 === 0 ? LAPIS : band % 3 === 1 ? LINEN.light : CARN);
    });
  }
  // ears: drooping leaves out to the sides, under the horns
  for (const s of [1, -1]) {
    const em = parts[s > 0 ? 'ear_l' : 'ear_r'];
    const f = union([E([s * 0.155, 2.22, 0.01], [0.07, 0.022, 0.034], [0, 0, -s * 0.45])], 0.01);
    rasterU(em, VS, f, (_x, _y, _z, _nx, ny) => pk(ny < 0 ? 0xc89a8a : FACE.base));
  }
  // eyes: amber with the ram's horizontal bar pupils
  for (const s of [1, -1]) {
    const c: V3 = [EYE[0] * s, EYE[1], EYE[2]];
    const em = rig.part(s > 0 ? 'eye_l' : 'eye_r', 'head', c);
    eyeball(em, VS, c, 0.022, norm3([s * 0.8, 0.05, 0.6]), { iris: 0xd8a032, sclera: 0x8a6a3a, bar: true, irisR: 0.95, pupilR: 0.5 });
    parts['head'].forEach((x, y, z, col, f) => {
      const X = (x + 0.5) * VS, Y = (y + 0.5) * VS, Z = (z + 0.5) * VS;
      const d = Math.hypot(X - c[0], Y - c[1], Z - c[2]);
      if (d < 0.038 && d > 0.022) parts['head'].set(x, y, z, Y > c[1] + 0.012 ? 0x3a2a20 : mixc(col, 0x3a2a20, 0.4), f);
    });
  }

  // ------------------------------------------------------------------ the shield (left fist, faces +Z)
  const SC: V3 = [0.2, 1.42, 0.5];
  {
    const sh = rig.part('shield', 'fore_l', FIST);
    const hw = 0.31, top = 0.6, bot = -0.55;
    const shape = (u: number, v: number) => {
      // rounded top: a semicircle of radius hw centred at v = top - hw
      const vc = top - hw;
      const d = v > vc ? Math.hypot(u, v - vc) - hw : Math.max(Math.abs(u) - hw, bot - v);
      return d;
    };
    const f: Field = (x, y, z) => {
      const u = x - SC[0], v = y - SC[1];
      const bulge = 0.055 * (1 - (u / hw) ** 2) * (1 - ((v - 0.02) / 0.62) ** 2);
      const w = z - SC[2] - bulge;
      return Math.max(shape(u, v), Math.abs(w) - 0.022);
    };
    raster(sh, VS, [SC[0] - hw - 0.04, SC[1] + bot - 0.04, SC[2] - 0.06], [SC[0] + hw + 0.04, SC[1] + top + 0.04, SC[2] + 0.12], f, (x, y, z, _nx, ny, nz) => {
      const u = x - SC[0], v = y - SC[1];
      if (nz < -0.3) return pk(LEATHER); // the back
      const rim = -shape(u, v) < 0.035;
      if (rim) return pk(goldP(ny), VF.METAL);
      // the sun boss with a carnelian heart
      const db = Math.hypot(u, v - 0.1);
      if (db < 0.045) return pk(CARN, VF.EMISSIVE);
      if (db < 0.13) return pk(Math.sin(Math.atan2(v - 0.1, u) * 16) > 0 ? GOLD.hi : GOLD.base, VF.METAL);
      // horn relief: two spirals hugging the boss
      const hr = Math.abs(Math.hypot(Math.abs(u) - 0.16, v - 0.02) - 0.075 - Math.atan2(v - 0.02, Math.abs(u) - 0.16) * 0.012);
      if (hr < 0.014) return pk(GOLD.dark, VF.METAL);
      // rivets
      const ra = Math.atan2(v - 0.05, u), rr = Math.hypot(u, v - 0.05);
      if (Math.abs(rr - 0.24) < 0.016 && Math.abs(Math.sin(ra * 6)) > 0.97) return pk(GOLD.hi, VF.METAL);
      void z;
      return pk((Math.floor((v + 1) / 0.12) & 1) && Math.abs(u) > 0.2 ? GOLD.shade : GOLD.base, VF.METAL);
    }, { interior: LEATHER });
    // the raised boss and rim (added outward)
    const boss = union([E([SC[0], SC[1] + 0.1, SC[2] + 0.075], [0.12, 0.12, 0.035])], 0.01);
    rasterU(sh, VS, boss, (x, y) => pk(Math.hypot(x - SC[0], y - SC[1] - 0.1) < 0.045 ? CARN : GOLD.hi, Math.hypot(x - SC[0], y - SC[1] - 0.1) < 0.045 ? VF.EMISSIVE : VF.METAL), { under: true });
    // the grip handle behind, in the fist
    const hd = union([C([FIST[0], FIST[1] - 0.07, FIST[2] + 0.04], [FIST[0], FIST[1] + 0.07, FIST[2] + 0.04], 0.02, 0.02), C([FIST[0], FIST[1] - 0.07, FIST[2] + 0.04], [FIST[0] - 0.03, FIST[1] - 0.07, SC[2] - 0.02], 0.015, 0.015), C([FIST[0], FIST[1] + 0.07, FIST[2] + 0.04], [FIST[0] - 0.03, FIST[1] + 0.07, SC[2] - 0.02], 0.015, 0.015)], 0.01);
    rasterU(sh, VS, hd, () => pk(LEATHER));
  }
  rig.socket('shield_face', 'shield', [SC[0], SC[1] + 0.1, SC[2] + 0.1]);

  // ------------------------------------------------------------------ the sun glaive (right fist, upright)
  {
    const F: V3 = mirX(FIST);
    const wp = rig.part('weapon', 'fore_r', F);
    const sx = F[0], sz = F[2];
    const shaft = union([C([sx, 0.06, sz], [sx, 2.22, sz], 0.022, 0.02)], 0.005);
    rasterU(wp, VS, shaft, (_x, y) => {
      const band = ((y + 10) % 0.42) < 0.05 || y < 0.12;
      return band ? pk(GOLD.base, VF.METAL) : pk(EBONY);
    });
    // crescent blade with a sun disc piercing, on the top
    const bc: V3 = [sx, 2.42, sz];
    const blade: Field = (x, y, z) => {
      const u = x - bc[0] - 0.02, v = y - bc[1];
      const outer = Math.hypot(u, v) - 0.26;
      const inner = Math.hypot(u + 0.13, v + 0.02) - 0.22;
      const crescent = Math.max(outer, -inner, -u - 0.06);
      const sun = Math.hypot(u - 0.05, v) - 0.055;
      const s2 = Math.max(crescent, -sun);
      const thick = Math.abs(z - bc[2]) - (0.018 - Math.max(0, Math.hypot(u, v) - 0.2) * 0.2);
      return Math.max(s2, thick);
    };
    raster(wp, VS, [bc[0] - 0.12, bc[1] - 0.3, bc[2] - 0.05], [bc[0] + 0.32, bc[1] + 0.3, bc[2] + 0.05], blade, (x, y) => {
      const r = Math.hypot(x - bc[0] - 0.02, y - bc[1]);
      return pk(r > 0.225 ? 0xfff2c8 : r > 0.19 ? GOLD.hi : GOLD.base, VF.METAL);
    });
    // a spike and a socket collar
    const sp = union([C([sx, 2.2, sz], [sx, 2.32, sz], 0.035, 0.026), C([sx, 2.6, sz], [sx, 2.78, sz], 0.02, 0.002)], 0.01);
    rasterU(wp, VS, sp, (_x, _y, _z, _nx, ny) => pk(goldP(ny), VF.METAL));
    rig.socket('blade', 'weapon', [sx + 0.2, 2.42, sz]);
  }

  for (const p of rig.parts) finish(p.model, 1.04, 0.9, (_c, f) => (f & (VF.METAL | VF.EMISSIVE)) !== 0);
  rig.socket('cape_anchor', 'torso', [0, 1.98, -0.17]);
  rig.socket('mouth', 'head', [0, 2.15, 0.33]);
  rig.socket('head_top', 'head', [0, 2.45, 0.0]);
  return rig.build({ kind: 'cleo_guard', height: 2.5, radius: 0.55, hipY: HIP[1], kneeY: KNEE[1], thigh: HIP[1] - KNEE[1], shin: KNEE[1] - ANK[1] });
}

let CACHE: RigSpec | null = null;
/** Cleopatra's ram-headed royal guard */
export function cleoGuardRig(): RigSpec {
  return (CACHE ??= build());
}
void curve;
void sstep;
void SUB;
void TURQ;
