// CLEOPATRA'S GOLDEN ROYAL BARGE (1/14 m voxels, ~15.6 m long): a papyriform
// Nile barge. The gold-leafed hull sweeps up at both ends, a papyrus umbel at
// the prow and a lotus stern-post curling back over the deck; jewelled bands of
// lapis, turquoise and carnelian run under the gold rail above a lotus frieze,
// rope lashings bind the ends, and a dark red waterline band. On the teak deck
// a pavilion on four papyrus columns (bound shafts, open bell capitals) carries
// a cavetto cornice, a uraeus frieze and a winged sun disc; under it the queen's
// gold throne with lion legs and a sun-disc back on a lapis-edged dais, two
// ostrich-feather flabella behind it, gold fire bowls at the prow.
// Rig: hull (root; origin on the waterline, amidships, bow toward +Z)
//   hull → oar_l1..oar_l6 / oar_r1..oar_r6 (pivot at the oarlocks)
//   hull → rudder_l / rudder_r (stern steering oars) · hull → fan_l / fan_r (flabella)
// Sockets: throne_seat, dais_front, prow_deck, deck_fl/_fr, deck_bl/_br, brazier_l/_r,
// pennant_l/_r (flag anchors), curtain_l/_r/_b (the pavilion's architrave edges).
import { KRig, VoxelModel, VF, E, C, union, raster, rasterU, finish, curve, tubePrims, pk, mixc, mulc, nS, sstep, clamp01, type V3, type RigSpec, type Field } from './kit';

const VS = 1 / 14;
const GOLD = { hi: 0xffe08a, base: 0xe2b048, shade: 0xb07e26, dark: 0x6a4a12 };
const LAPIS = 0x2a4a9c, TURQ = 0x34a89e, CARN = 0xb4382a, RED = 0x7a2418, TEAK = 0x8a5a36, TEAK_D = 0x5e3a20, EBONY = 0x2a1a14;
const LINEN = 0xf0e6d0, FEATHER = 0xf6f0e4, CRIMSON = 0xa8203a, GREEN = 0x3a8a5a;
const goldP = (ny: number) => pk(ny > 0.5 ? GOLD.hi : ny < -0.45 ? GOLD.shade : GOLD.base, VF.METAL);

export const BARGE = {
  len: 15.2,
  deckY: 0.78,
  daisY: 1.08,
  seat: [0, 1.62, -0.75] as V3,
};

/** half beam, gunwale height and keel height along the hull */
function hullAt(z: number) {
  const az = Math.abs(z);
  const u = Math.max(0, (az - 3) / 4.6);
  const w = 1.8 * Math.pow(Math.max(0, 1 - Math.pow(az / 7.7, 2.2)), 0.55);
  const yt = 1.05 + 3.1 * u * u * (z < 0 ? 1.12 : 1);
  const yb = -0.55 + 1.7 * u * u;
  return { w, yt, yb };
}

function build(): RigSpec {
  const rig = new KRig('cleo_barge', VS);
  const hull = rig.part('hull', undefined, [0, 0, 0]);
  const deckY = (z: number) => Math.min(hullAt(z).yt - 0.32, BARGE.deckY + Math.max(0, Math.abs(z) - 4.5) * 0.25);

  // ------------------------------------------------------------------ the hull
  const P = 2.4;
  const hullF: Field = (x, y, z) => {
    if (Math.abs(z) > 7.75) return 1;
    const { w, yt, yb } = hullAt(z);
    if (w < 0.06) return 1;
    const h = yt - yb;
    const q = Math.pow(Math.abs(x) / w, P) + Math.pow(Math.max(0, yt - y) / h, P);
    let d = (Math.pow(q, 1 / P) - 1) * Math.min(w, h * 0.5);
    d = Math.max(d, y - yt);
    // hollow above the deck, inside the bulwark
    const dy = deckY(z);
    if (y > dy) {
      const qi = Math.pow(Math.abs(x) / Math.max(0.01, w - 0.16), P) + Math.pow(Math.max(0, yt + 0.4 - y) / h, P);
      d = Math.max(d, -(Math.pow(qi, 1 / P) - 1) * Math.min(w, h * 0.5));
    }
    return d;
  };
  raster(hull, VS, [-1.95, -0.7, -7.9], [1.95, 4.4, 7.9], hullF, (x, y, z, nx, ny) => {
    const { w, yt } = hullAt(z);
    const dy = deckY(z);
    const inside = Math.abs(x) < w - 0.13 && y > dy - 0.1;
    if (ny > 0.7 && inside && y < dy + 0.12) {
      // teak deck planks along the length, gold inlay border
      if (Math.abs(x) > w - 0.4) return goldP(ny);
      const seam = Math.abs(((x + 10) % 0.28) - 0.14) > 0.12 || Math.abs(((z + 20 + Math.floor((x + 10) / 0.28) * 0.7) % 2.1) - 1.05) > 1.02;
      return pk(seam ? TEAK_D : nS(x, y, z * 0.2, 6, 3) > 0.3 ? mulc(TEAK, 1.08) : TEAK);
    }
    if (inside) return pk(mulc(TEAK, 0.85));
    if (y > yt - 0.09) return goldP(ny); // gold rail
    const fromTop = yt - y;
    // jewelled bands under the rail
    if (fromTop < 0.36) {
      const row = Math.floor(fromTop / 0.09);
      const chk = Math.floor((z + 20) / 0.18) & 1;
      const cols = [LAPIS, GOLD.base, TURQ, CARN];
      const c = cols[(row + chk * 2) % 4];
      return pk(c, c === GOLD.base ? VF.METAL : VF.SOLID);
    }
    // lotus frieze
    if (fromTop < 0.78) {
      const u = (z + 20) / 0.42, fu = u - Math.floor(u), v = (fromTop - 0.36) / 0.42;
      const petal = Math.abs(fu - 0.5) < 0.12 + (1 - v) * 0.3 && v > 0.12 && v < 0.9;
      const stem = Math.abs(fu - 0.5) < 0.05 && v >= 0.6;
      if (petal) return pk(v < 0.45 ? TURQ : LAPIS);
      if (stem) return pk(GREEN);
      return goldP(ny);
    }
    // rope lashings toward the ends
    if (Math.abs(z) > 4.6 && ((z + 20) % 0.5) < 0.12) return pk(ny > 0 ? 0xc8a868 : 0x8a6a3a);
    // waterline: dark red band, then the wet underbody
    if (y < 0.12 && y > -0.08) return pk(RED);
    if (y <= -0.08) return pk(0x3a2418);
    void nx;
    return goldP(ny);
  }, { interior: TEAK_D });

  // ------------------------------------------------------------------ prow umbel and lotus stern-post
  {
    const prow = curve([[0, 3.6, 7.25], [0, 4.25, 7.62], [0, 4.85, 7.8], [0, 5.15, 7.85]], 12);
    const pf = union(tubePrims(prow, (t) => 0.32 - t * 0.14), 0.08);
    rasterU(hull, VS, pf, (x, y, z, _nx, ny) => ((Math.floor(y / 0.16) & 1) ? goldP(ny) : pk(y > 4.3 ? GREEN : LAPIS)));
    // the open papyrus umbel: a flared bell of gold rays
    const top: V3 = [0, 5.15, 7.85];
    const umbel: Field = (x, y, z) => {
      const ly = y - top[1];
      if (ly < -0.05 || ly > 0.75) return 0.2;
      const R = 0.16 + ly * 0.85;
      const a = Math.atan2(x, z - top[2]);
      const rib = Math.cos(a * 18) * 0.03;
      const r = Math.hypot(x, z - top[2]);
      return Math.max(r - R - rib, ly - 0.72 - Math.cos(a * 18) * 0.04, -(r - R + 0.12 + ly * 0.2));
    };
    raster(hull, VS, [-0.85, 5.0, 7.0], [0.85, 6.0, 8.7], umbel, (x, y, z, _nx, ny) => {
      const a = Math.atan2(x, z - top[2]);
      return Math.cos(a * 18) > 0.6 ? pk(GREEN) : goldP(ny);
    });
    const stern = curve([[0, 3.8, -7.2], [0, 4.7, -7.55], [0, 5.35, -7.3], [0, 5.6, -6.75], [0, 5.35, -6.35]], 16);
    const sf = union(tubePrims(stern, (t) => 0.34 - t * 0.2), 0.08);
    rasterU(hull, VS, sf, (x, y, z, _nx, ny) => ((Math.floor((y + z * 0.3) / 0.16) & 1) ? goldP(ny) : pk(LAPIS)));
    const bud = union([E([0, 5.18, -6.28], [0.2, 0.3, 0.2]), C([0, 5.0, -6.28], [0, 5.55, -6.28], 0.12, 0.02)], 0.08);
    rasterU(hull, VS, bud, (_x, y, _z, _nx, ny) => (y > 5.25 ? pk(CARN) : goldP(ny)));
  }

  // ------------------------------------------------------------------ the dais, pavilion and throne
  const dy0 = BARGE.deckY, daisTop = BARGE.daisY;
  {
    const dais: Field = (x, y, z) => Math.max(Math.abs(x) - 1.35, Math.abs(z + 0.15) - 1.55, y - daisTop, dy0 - 0.1 - y);
    raster(hull, VS, [-1.5, dy0 - 0.15, -1.8], [1.5, daisTop + 0.1, 1.5], dais, (x, y, z, _nx, ny) => {
      if (ny > 0.6) return Math.abs(x) > 1.2 || Math.abs(z + 0.15) > 1.4 ? goldP(ny) : pk(((Math.floor(x / 0.3) + Math.floor(z / 0.3)) & 1) ? LAPIS : mulc(LAPIS, 0.75));
      return y > daisTop - 0.08 ? goldP(ny) : pk(EBONY);
    });
    // steps at the front
    for (let s = 0; s < 2; s++) {
      const st: Field = (x, y, z) => Math.max(Math.abs(x) - 0.7, y - (dy0 + 0.1 + s * 0.1), Math.abs(z - (1.5 + (1 - s) * 0.18)) - 0.1 - (1 - s) * 0.0);
      raster(hull, VS, [-0.8, dy0 - 0.1, 1.2], [0.8, daisTop, 1.95], st, (_x, _y, _z, _nx, ny) => (ny > 0.5 ? goldP(ny) : pk(EBONY)));
    }
    // four papyrus columns with open bell capitals
    const colH = 3.0;
    for (const [cx, cz] of [[1.15, -1.5], [-1.15, -1.5], [1.15, 1.3], [-1.15, 1.3]]) {
      const base = daisTop;
      const col: Field = (x, y, z) => {
        const ly = y - base;
        if (ly < 0 || ly > colH + 0.05) return 0.2;
        const r = Math.hypot(x - cx, z - cz);
        const a = Math.atan2(x - cx, z - cz);
        const t = ly / colH;
        let R = 0.15 - t * 0.04 + Math.cos(a * 8) * 0.012;
        if (t > 0.8) R = 0.11 + (t - 0.8) * 1.0 + Math.cos(a * 8) * 0.02;
        if (ly < 0.12) R = 0.2;
        return r - R;
      };
      raster(hull, VS, [cx - 0.4, base, cz - 0.4], [cx + 0.4, base + colH + 0.1, cz + 0.4], col, (x, y, z, _nx, ny) => {
        const t = (y - base) / colH;
        if (t > 0.72 && t < 0.8) return pk((Math.floor(y / 0.07) & 1) ? CARN : GOLD.base, VF.METAL);
        if (t > 0.8) return pk(Math.cos(Math.atan2(x - cx, z - cz) * 8) > 0.4 ? GREEN : GOLD.base, VF.METAL);
        void ny;
        return pk(Math.cos(Math.atan2(x - cx, z - cz) * 8) > 0.5 ? GOLD.hi : GOLD.base, VF.METAL);
      });
    }
    // architrave, cavetto cornice, roof
    const y0 = daisTop + colH, ax = 1.4, azF = 1.55, azB = -1.75;
    const roof: Field = (x, y, z) => {
      const ly = y - y0;
      if (ly < 0 || ly > 0.75) return 0.2;
      const flare = ly > 0.3 ? (ly - 0.3) * (ly - 0.3) * 1.5 : 0;
      return Math.max(Math.abs(x) - ax - flare, z - azF - flare, azB - flare - z, -(Math.min(ax - Math.abs(x), azF - z, z - azB) - 0.25 - flare) * (ly < 0.62 ? 1 : -1));
    };
    raster(hull, VS, [-2.0, y0, -2.4], [2.0, y0 + 0.8, 2.2], roof, (x, y, z, _nx, ny) => {
      const ly = y - y0;
      if (ly < 0.3) return goldP(ny);
      // cornice leaves: blue / red / green vertical tongues
      const along = Math.abs(x) > ax - 0.05 ? z : x;
      const k = Math.floor((along + 10) / 0.16) % 3;
      if (ny > 0.6) return pk((Math.floor((x + 10) / 0.3) & 1) ? LINEN : 0xd8c49a);
      return pk([LAPIS, CARN, GREEN][k]);
    });
    // uraeus frieze on the front edge
    for (let i = -7; i <= 7; i++) {
      const c: V3 = [i * 0.19, y0 + 0.86, azF + 0.32];
      const cob = union([C([c[0], c[1] - 0.1, c[2]], [c[0], c[1] + 0.06, c[2] + 0.03], 0.05, 0.035), E([c[0], c[1] + 0.06, c[2] + 0.04], [0.06, 0.07, 0.025])], 0.03);
      rasterU(hull, VS, cob, (_x, _y, _z, _nx, ny) => goldP(ny));
    }
    // winged sun disc on the front architrave
    const wc: V3 = [0, y0 + 0.16, azF + 0.06];
    const wing: Field = (x, y, z) => {
      const disc = Math.hypot(x, y - wc[1]) - 0.24;
      const ax2 = Math.abs(x);
      const wingD = Math.max(ax2 - 1.25, Math.abs(y - wc[1] - 0.02 + ax2 * 0.05) - (0.14 - ax2 * 0.08));
      return Math.max(Math.min(disc, wingD), Math.abs(z - wc[2]) - 0.08);
    };
    raster(hull, VS, [-1.4, wc[1] - 0.3, wc[2] - 0.12], [1.4, wc[1] + 0.3, wc[2] + 0.14], wing, (x, y) => {
      if (Math.hypot(x, y - wc[1]) < 0.24) return pk(Math.hypot(x, y - wc[1]) < 0.15 ? 0xffd070 : CARN, VF.GLOW);
      const f = Math.floor(Math.abs(x) / 0.12) % 3;
      return pk([LAPIS, GOLD.base, TURQ][f], f === 1 ? VF.METAL : VF.SOLID);
    });
    // the throne: lion legs, cushion, sun-disc back, cobra armrests
    const S = BARGE.seat;
    const throne = union(
      [
        E([0, S[1] - 0.06, S[2]], [0.42, 0.08, 0.36]),
        C([0, S[1], S[2] - 0.34], [0, S[1] + 1.25, S[2] - 0.44], 0.3, 0.26),
        C([0.4, S[1] + 0.05, S[2] + 0.25], [0.4, S[1] + 0.32, S[2] - 0.3], 0.06, 0.06),
        C([-0.4, S[1] + 0.05, S[2] + 0.25], [-0.4, S[1] + 0.32, S[2] - 0.3], 0.06, 0.06),
        ...[[0.32, 0.25], [-0.32, 0.25], [0.32, -0.3], [-0.32, -0.3]].map(([lx, lz]) => C([lx, daisTop, S[2] + lz], [lx, S[1] - 0.08, S[2] + lz], 0.07, 0.05)),
      ],
      0.05
    );
    rasterU(hull, VS, throne, (x, y, z, _nx, ny) => {
      if (y < S[1] + 0.03 && y > S[1] - 0.03 && Math.abs(x) < 0.34 && z > S[2] - 0.3) return pk(CRIMSON);
      if (y > S[1] + 0.85 && z < S[2] - 0.38 && Math.hypot(x, y - S[1] - 0.95) < 0.2) return pk(CARN, VF.EMISSIVE);
      if (y < daisTop + 0.12) return pk(GOLD.dark, VF.METAL); // paws
      return goldP(ny);
    });
    const cushion = union([E([0, S[1] + 0.06, S[2] + 0.02], [0.36, 0.07, 0.32])], 0.03);
    rasterU(hull, VS, cushion, (x, _y, z) => pk(Math.abs(Math.abs(x) - 0.3) < 0.04 || Math.abs(z - S[2] - 0.3) < 0.04 ? GOLD.base : CRIMSON));
  }
  // ------------------------------------------------------------------ fire bowls at the prow
  for (const s of [1, -1]) {
    const bz = 4.9, bx = s * 0.85, by = deckY(bz);
    const bowl = union([C([bx, by, bz], [bx, by + 0.7, bz], 0.06, 0.05), E([bx, by + 0.85, bz], [0.32, 0.16, 0.32])], 0.06);
    raster(hull, VS, bowl.lo, bowl.hi, (x, y, z) => Math.max(bowl(x, y, z), -(Math.hypot(x - bx, z - bz) - 0.24) * (y > by + 0.9 ? 1 : -1)), (_x, y, _z, _nx, ny) => (y > by + 0.88 && ny > 0.4 ? pk(0xff8a20, VF.GLOW) : goldP(ny)));
    rig.socket(s > 0 ? 'brazier_l' : 'brazier_r', 'hull', [bx, by + 1.0, bz]);
  }
  // ------------------------------------------------------------------ pennant poles at the stern quarter
  for (const s of [1, -1]) {
    const pz = -4.6, px = s * 1.1, py = deckY(pz);
    const pole = union([C([px, py, pz], [px, py + 4.2, pz], 0.06, 0.04), E([px, py + 4.25, pz], [0.09, 0.12, 0.09])], 0.02);
    rasterU(hull, VS, pole, (_x, y, _z, _nx, ny) => ((Math.floor(y / 0.5) & 1) ? goldP(ny) : pk(LAPIS)));
    rig.socket(s > 0 ? 'pennant_l' : 'pennant_r', 'hull', [px, py + 4.1, pz]);
  }

  // ------------------------------------------------------------------ oars (6 a side) and the stern steering oars
  const oarZ = [-3.4, -2.05, -0.7, 0.65, 2.0, 3.35];
  for (let i = 0; i < 6; i++) {
    const z = oarZ[i];
    const { w, yt } = hullAt(z);
    const piv: V3 = [w - 0.05, yt + 0.02, z];
    const om = rig.part('oar_l' + (i + 1), 'hull', piv);
    const out: V3 = [piv[0] + 3.0, -0.25, z - 0.35];
    const inb: V3 = [piv[0] - 0.9, piv[1] + 0.42, z + 0.1];
    const shaft = union([C(inb, out, 0.045, 0.05)], 0.01);
    rasterU(om, VS, shaft, (_x, _y, _z, _nx, ny) => (ny > 0.3 ? pk(0xa87a46) : pk(0x8a6238)));
    const dir = [out[0] - inb[0], out[1] - inb[1], out[2] - inb[2]];
    const dl = Math.hypot(dir[0], dir[1], dir[2]);
    const blade: Field = (x, y, z2) => {
      const px = x - out[0], py = y - out[1], pz = z2 - out[2];
      const u = (px * dir[0] + py * dir[1] + pz * dir[2]) / dl;
      const across = Math.hypot(px - (dir[0] / dl) * u, py - (dir[1] / dl) * u);
      const t = clamp01((u + 0.95) / 1.0);
      const wdt = 0.16 * Math.sin(t * Math.PI * 0.95 + 0.05);
      return Math.max(-u - 0.95, u - 0.05, Math.abs(pz - (dir[2] / dl) * u) - wdt, across - 0.03);
    };
    raster(om, VS, [out[0] - 1.1, out[1] - 0.5, out[2] - 0.4], [out[0] + 0.3, out[1] + 0.6, out[2] + 0.4], blade, (_x, _y, z2) => (Math.abs(z2 - out[2]) > 0.1 ? pk(LAPIS) : pk(GOLD.base, VF.METAL)));
    // oarlock ring
    for (const sx of [1, -1]) {
      const lock = union([E([piv[0] * sx, piv[1], piv[2]], [0.09, 0.07, 0.09])], 0.02);
      rasterU(hull, VS, lock, (_x, _y, _z, _nx, ny) => goldP(ny));
    }
  }
  for (const s of [1, -1]) {
    const z = -5.5;
    const { w, yt } = hullAt(z);
    const piv: V3 = [s * (w + 0.05), yt + 0.4, z];
    const rm = rig.part(s > 0 ? 'rudder_l' : 'rudder_r', 'hull', piv);
    const top: V3 = [piv[0] - s * 0.4, piv[1] + 1.4, z + 0.6];
    const low: V3 = [piv[0] + s * 0.35, -0.4, z - 2.0];
    const sh = union([C(top, low, 0.07, 0.07)], 0.01);
    rasterU(rm, VS, sh, (_x, y) => ((Math.floor(y / 0.4) & 1) ? pk(GOLD.base, VF.METAL) : pk(EBONY)));
    const bl = union([E([low[0], low[1] + 0.25, low[2] + 0.35], [0.05, 0.55, 0.32], [0.55, 0, 0])], 0.02);
    rasterU(rm, VS, bl, () => pk(GOLD.base, VF.METAL));
    const post = union([C([s * (w - 0.1), yt - 0.1, z], [s * (w - 0.05), yt + 0.55, z], 0.08, 0.07)], 0.02);
    rasterU(hull, VS, post, (_x, _y, _z, _nx, ny) => goldP(ny));
  }
  // ------------------------------------------------------------------ flabella: tall ostrich-feather fans behind the throne
  for (const s of [1, -1]) {
    const S = BARGE.seat;
    const base: V3 = [s * 0.85, BARGE.daisY, S[2] - 0.75];
    const top: V3 = [s * 0.95, BARGE.daisY + 2.15, S[2] - 0.95];
    const pole = union([C(base, top, 0.035, 0.03)], 0.01);
    rasterU(hull, VS, pole, (_x, y, _z, _nx, ny) => ((Math.floor(y / 0.35) & 1) ? goldP(ny) : pk(EBONY)));
    const fm = rig.part(s > 0 ? 'fan_l' : 'fan_r', 'hull', top);
    for (let f = 0; f < 11; f++) {
      const a = -Math.PI * 0.42 + (f / 10) * Math.PI * 0.84;
      const L = 0.72;
      const tip: V3 = [top[0] + Math.sin(a) * L, top[1] + Math.cos(a) * L, top[2] - 0.05];
      const mid: V3 = [top[0] + Math.sin(a) * L * 0.55, top[1] + Math.cos(a) * L * 0.55 + 0.02, top[2] - 0.03];
      const fe = union([C(top, mid, 0.04, 0.1), C(mid, tip, 0.1, 0.06)], 0.05);
      raster(fm, VS, fe.lo, fe.hi, (x, y, z) => Math.max(fe(x, y, z), Math.abs(z - top[2] + 0.04) - 0.05), (x, y, z) => {
        const d = Math.hypot(x - top[0], y - top[1]);
        return d > L * 0.88 ? pk(GOLD.base, VF.METAL) : pk(nS(x, y, z, 30, f) > 0.3 ? mixc(FEATHER, 0xd8d0c0, 0.5) : FEATHER);
      }, { under: true });
    }
    const hub = union([E(top, [0.12, 0.12, 0.08])], 0.02);
    rasterU(fm, VS, hub, (_x, _y, _z, _nx, ny) => goldP(ny));
  }

  rig.mirrorLR();
  for (const p of rig.parts) finish(p.model, 1.04, 0.9, (_c, f) => (f & (VF.METAL | VF.GLOW)) !== 0);
  // ------------------------------------------------------------------ sockets
  const S = BARGE.seat;
  rig.socket('throne_seat', 'hull', [0, S[1] + 0.12, S[2] + 0.05]);
  rig.socket('dais_front', 'hull', [0, BARGE.daisY, 1.2]);
  rig.socket('prow_deck', 'hull', [0, deckY(3.6), 3.6]);
  rig.socket('deck_fl', 'hull', [0.75, deckY(2.4), 2.4]);
  rig.socket('deck_fr', 'hull', [-0.75, deckY(2.4), 2.4]);
  rig.socket('deck_bl', 'hull', [0.7, deckY(-2.8), -2.8]);
  rig.socket('deck_br', 'hull', [-0.7, deckY(-2.8), -2.8]);
  const yA = BARGE.daisY + 3.0;
  rig.socket('curtain_fl', 'hull', [1.4, yA, 1.5]);
  rig.socket('curtain_bl', 'hull', [1.4, yA, -1.7]);
  rig.socket('curtain_fr', 'hull', [-1.4, yA, 1.5]);
  rig.socket('curtain_br', 'hull', [-1.4, yA, -1.7]);
  return rig.build({ kind: 'cleo_barge', length: 15.6, beam: 3.6, height: 6, radius: 2, deckY: BARGE.deckY, oarZ });
}

let CACHE: RigSpec | null = null;
/** Cleopatra's golden royal barge */
export function cleoBargeRig(): RigSpec {
  return (CACHE ??= build());
}
void sstep;
void LINEN;
void VoxelModel;
