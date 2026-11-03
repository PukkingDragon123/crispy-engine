// The healing cactus: a juicy plant that grows in clusters by oases and camps.
// Break it (shoot it, kick it, ride through it) and it bursts in a splash of
// sweet sap that heals; after a while it sprouts back from its stump.
//
//  'pear'   — a prickly-pear clump (seeded): a corky old trunk in a sand mound,
//             2-3 branches of plump blue-green paddles (pillowy, obovate, rimmed,
//             waxy bloom) studded with diagonal rows of tan glochid tufts and pale
//             spines, dew-like beads of sap, glossy magenta fruits on the top rims
//             and the odd yellow cup flower; a dried dead pad half buried at its foot.
//  'barrel' — a fat ribbed barrel cactus (seeded): spiralling ribs, felt areoles
//             with red hooked central spines and pale radials, a crown of yellow
//             fruits and orange flowers, one or two pups at its base.
//
// RIG (1/48 m, origin on the ground at the stem): `stump` (root, stays when the
// plant is broken: trunk / mound with torn juicy stubs) → `branch1..N` (pear) or
// `barrel`, `pup1`, `pup2` (barrel). Every branch pivots at its base, so the
// owner can wobble it with `CactusSway` and regrow it by scaling up from 0.
import type { RigInstance } from '../../../engine/voxel/Rig';
import { CRig, VoxelModel, VF, V3, RigSpec, blob, ell, cap, line, exposed, mixc, n01, h01, add3, sub3, scl3, dot3, cross3, norm3, sstep, memoBy } from './ckit';

const VS = 1 / 48;
const U = (m: number) => m / VS;
const V = (p: V3): V3 => [p[0] / VS, p[1] / VS, p[2] / VS];
const M = (i: number) => (i + 0.5) * VS;

const G = {
  pad: 0x6c9c56,
  padL: 0x8fbe72,
  padD: 0x4a783c,
  bloom: 0x9cc88a,
  areole: 0xbca46a,
  areoleD: 0x8c6c42,
  spine: 0xe6d8a8,
  bead: 0xd6f6aa,
  fruit: 0xc82c5c,
  fruitL: 0xe4507a,
  fruitD: 0x861a3e,
  fruitBase: 0x9a8a3a,
  fruitDot: 0xf0d070,
  petal: 0xf2cc3a,
  petalL: 0xffe68a,
  petalD: 0xe08a2a,
  stigma: 0x9ad04a,
  bark: 0x8a7458,
  barkD: 0x5e4c38,
  barkL: 0xa8926e,
  torn: 0xc8dc9a,
  tornD: 0x9cba6a,
  sand: 0xd9b98a,
  sandD: 0xbf9c6c,
  pebble: 0x9c8064,
  dead: 0xa88e5a,
  deadD: 0x7e6a44,
  rib: 0x5f9548,
  ribL: 0x86b866,
  ribD: 0x3e6a34,
  hook: 0xb05030,
  felt: 0xe0cfa0,
  yfruit: 0xe8c43a,
  yfruitD: 0xb88a2a,
  oflower: 0xe85a3a,
};

/** small seeded PRNG */
function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================ prickly pear
interface Pad {
  o: V3;
  u: V3;
  w: V3;
  n: V3;
  L: number;
  W: number;
  T: number;
  curl: number;
  kids: Pad[];
}
const padHW = (p: Pad, t: number) => (p.W / 2) * Math.sqrt(Math.max(0, 1 - ((t - 0.56) / 0.56) ** 2));
/** voxelise one paddle: pillowy obovate slab with a rim, a waxy bloom, rows of areoles */
function drawPad(m: VoxelModel, p: Pad, R: () => number, spines: { at: V3; n: V3 }[]) {
  // tight bounds from the paddle's own frame
  const lo: V3 = [1e9, 1e9, 1e9], hi: V3 = [-1e9, -1e9, -1e9];
  for (const a of [-0.03, 1.13]) for (const b of [-0.52, 0.52]) for (const c of [-1, 1]) {
    const q = V(add3(add3(add3(p.o, scl3(p.u, a * p.L)), scl3(p.w, b * p.W)), scl3(p.n, c * (p.T * 0.6 + Math.abs(p.curl) * p.T + VS))));
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], q[i] - 1);
      hi[i] = Math.max(hi[i], q[i] + 1);
    }
  }
  const sp = 0.075;
  for (let x = Math.floor(lo[0]); x <= hi[0]; x++)
    for (let y = Math.max(0, Math.floor(lo[1])); y <= hi[1]; y++)
      for (let z = Math.floor(lo[2]); z <= hi[2]; z++) {
        const q = sub3([M(x), M(y), M(z)], p.o);
        const a = dot3(q, p.u), b = dot3(q, p.w), c = dot3(q, p.n);
        const t = a / p.L;
        if (t < -0.02 || t > 1.12) continue;
        const hw = padHW(p, t);
        if (hw < VS * 0.6 || Math.abs(b) > hw) continue;
        const e = b / hw;
        const hn = Math.max(VS * 0.75, (p.T / 2) * (0.42 + 0.58 * Math.sqrt(Math.max(0, 1 - e * e))) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, t))));
        const cc = c - p.curl * e * e * p.T;
        if (Math.abs(cc) > hn) continue;
        // colour
        const edge = Math.abs(b) > hw - VS * 1.2 || t > 1.12 - 0.03;
        const face = Math.abs(cc) > hn - VS * 1.05;
        let col = p.u[1] > 0 && n01(x, y, z, 0.22, 4) > 0.6 ? mixc(G.pad, G.padL, 0.4) : G.pad;
        const centre = 1 - Math.hypot(e, (t - 0.55) * 1.6);
        if (centre > 0.25) col = mixc(col, G.bloom, sstep(0.25, 0.8, centre) * 0.5);
        if (edge) col = G.padD;
        if (t < 0.12) col = mixc(col, G.padD, 0.4);
        if (face && !edge) {
          // areoles on a diagonal lattice
          const ia = Math.round(a / sp - 0.5);
          const ob = ia % 2 === 0 ? 0 : sp / 2;
          const ib = Math.round((b - ob) / sp);
          const da = a - (ia + 0.5) * sp, db = b - (ib * sp + ob);
          if (Math.hypot(da, db) < VS * 0.6 && t > 0.08) col = G.areole;
        }
        m.set(x, y, z, col);
      }
  // spines + sap beads at some areoles (collected, drawn after all pads)
  const sides = [1, -1];
  for (let ia = 1; ia < p.L / sp; ia++)
    for (let ib = -6; ib <= 6; ib++) {
      const ob = ia % 2 === 0 ? 0 : sp / 2;
      const a = (ia + 0.5) * sp, b = ib * sp + ob;
      const t = a / p.L;
      const hw = padHW(p, t);
      if (Math.abs(b) > hw - VS * 1.5 || t < 0.1) continue;
      const e = b / hw;
      const hn = (p.T / 2) * (0.42 + 0.58 * Math.sqrt(Math.max(0, 1 - e * e))) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, t)));
      for (const s of sides) {
        if (R() > 0.2) continue;
        const at = add3(add3(add3(p.o, scl3(p.u, a)), scl3(p.w, b)), scl3(p.n, s * hn + p.curl * e * e * p.T));
        spines.push({ at, n: scl3(p.n, s) });
      }
    }
}

function buildPear(seed: number): RigSpec {
  const R = rng(seed * 31 + 7);
  const rig = new CRig('heal_cactus_pear_' + seed, VS);
  const stump = rig.part('stump', undefined, [0, 0, 0]);
  // ---- sand mound with pebbles, corky old trunk
  ell(stump, [0, 0, 0], [U(0.3), U(0.075), U(0.3)], (x, y, z) => (h01(x, y, z, 3) < 0.05 ? G.pebble : y > 1 && n01(x, y, z, 0.3, 2) > 0.6 ? G.sandD : G.sand), { keep: (_a, _b, _c, _x, y) => y >= 0 });
  const trunkTop: V3 = [0, 0.17, 0];
  blob(stump, [{ a: [0, 0, 0], b: V(trunkTop), r0: U(0.075), r1: U(0.058) }, { c: V([0.03, 0.04, 0.02]), r: [U(0.08), U(0.05), U(0.07)] }], (x, y, z) => {
    const band = n01(x * 0.6, y * 2.2, z * 0.6, 0.35, 9);
    return band > 0.66 ? G.barkD : band < 0.3 ? G.barkL : G.bark;
  }, { k: U(0.03), disp: (x, y, z) => (n01(x, y, z, 0.45, 5) - 0.5) * 1.2, keep: (_x, y) => y >= 0 });
  // ---- a dried dead pad half buried at its foot
  {
    const az = R() * 6.28;
    const dp: Pad = { o: [Math.sin(az) * 0.12, 0.02, Math.cos(az) * 0.12], u: norm3([Math.sin(az), 0.18, Math.cos(az)]), w: [0, 0, 0], n: [0, 0, 0], L: 0.26, W: 0.2, T: 0.04, curl: 0.4, kids: [] };
    dp.n = norm3(cross3(dp.u, [Math.cos(az), 0, -Math.sin(az)]));
    if (dp.n[1] < 0) dp.n = scl3(dp.n, -1);
    dp.w = norm3(cross3(dp.n, dp.u));
    const tmp = new VoxelModel('dead');
    drawPad(tmp, dp, R, []);
    tmp.forEach((x, y, z) => stump.set(x, y, z, h01(x, y, z, 8) < 0.3 ? G.deadD : G.dead));
  }
  // ---- branches of paddles
  const nB = 2 + (R() < 0.45 ? 1 : 0);
  const branches: string[] = [];
  const spines: { at: V3; n: V3 }[] = [];
  const terminals: Pad[] = [];
  const mkPad = (o: V3, u: V3, nHint: V3, L: number): Pad => {
    let n = norm3(sub3(nHint, scl3(u, dot3(nHint, u))));
    const w = norm3(cross3(u, n));
    n = norm3(cross3(w, u));
    return { o, u, w, n, L, W: L * (0.74 + R() * 0.1), T: 0.07 + R() * 0.016, curl: (R() - 0.5) * 0.45, kids: [] };
  };
  const grow = (p: Pad, depth: number) => {
    if (depth >= 3) {
      terminals.push(p);
      return;
    }
    const nk = depth === 0 ? 1 + (R() < 0.75 ? 1 : 0) : R() < 0.55 ? 1 : R() < 0.75 ? 2 : 0;
    for (let i = 0; i < nk; i++) {
      const phi = nk === 1 ? (R() - 0.5) * 1.3 : i === 0 ? -0.55 - R() * 0.2 : 0.55 + R() * 0.2;
      const t = 0.56 + 0.56 * Math.sqrt(Math.max(0, 1 - phi * phi));
      const base = add3(add3(p.o, scl3(p.u, t * p.L * 0.94)), scl3(p.w, phi * (p.W / 2) * 0.86));
      const beta = 0.2 + Math.abs(phi) * 0.75 + R() * 0.2;
      let u = norm3(add3(scl3(p.u, Math.cos(beta)), scl3(p.w, Math.sin(beta) * Math.sign(phi || 1))));
      u = norm3(add3(u, scl3(p.n, (R() - 0.5) * 0.7)));
      if (u[1] < 0.3) u = norm3([u[0], 0.35, u[2]]);
      const twist = (R() - 0.5) * 2;
      const nh = norm3(add3(scl3(p.n, Math.cos(twist)), scl3(p.w, Math.sin(twist))));
      const k = mkPad(base, u, nh, p.L * (0.82 + R() * 0.12));
      p.kids.push(k);
      grow(k, depth + 1);
    }
    if (!p.kids.length) terminals.push(p);
  };
  for (let b = 0; b < nB; b++) {
    const az = (b / nB) * Math.PI * 2 + R() * 1.2;
    const tilt = 0.12 + R() * 0.35;
    const o: V3 = [Math.sin(az) * 0.025, trunkTop[1] - 0.02, Math.cos(az) * 0.025];
    const u = norm3([Math.sin(az) * Math.sin(tilt), Math.cos(tilt), Math.cos(az) * Math.sin(tilt)]);
    const fa = az + Math.PI / 2 + (R() - 0.5) * 1.2;
    const p = mkPad(o, u, [Math.sin(fa), 0, Math.cos(fa)], 0.39 + R() * 0.07);
    grow(p, 0);
    const name = 'branch' + (b + 1);
    const m = rig.part(name, 'stump', V(o));
    branches.push(name);
    const draw = (q: Pad) => {
      drawPad(m, q, R, spines);
      for (const k of q.kids) draw(k);
    };
    draw(p);
    // a torn juicy stub on the stump, hidden inside the paddle base until it breaks off
    cap(stump, V(sub3(o, scl3(u, 0.02))), V(add3(o, scl3(u, 0.035))), U(0.016), U(0.012), (x, y, z) => (h01(x, y, z, 4) < 0.4 ? G.tornD : G.torn), { fl: VF.METAL });
  }
  // ---- spines and sap beads
  const owner = (p: V3) => {
    const v = V(p);
    for (const b of branches) {
      const m = rig.m(b);
      for (const [dx, dy, dz] of [[0, 0, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as V3[]) if (m.has(Math.floor(v[0]) + dx, Math.floor(v[1]) + dy, Math.floor(v[2]) + dz)) return m;
    }
    return null;
  };
  for (const s of spines) {
    const m = owner(s.at);
    if (!m) continue;
    if (R() < 0.18) {
      const b = add3(s.at, scl3(s.n, VS * 1.1));
      m.set(Math.floor(b[0] / VS), Math.floor(b[1] / VS), Math.floor(b[2] / VS), G.bead, VF.METAL);
      continue;
    }
    const dir = norm3(add3(s.n, [(R() - 0.5) * 0.9, (R() - 0.2) * 0.8, (R() - 0.5) * 0.9]));
    const len = VS * (2.2 + R() * 1.6);
    line(m, [V(add3(s.at, scl3(s.n, VS * 0.6))), V(add3(s.at, scl3(dir, len)))], G.spine);
  }
  // ---- fruits (tunas) on the top rims of the outer paddles, a flower or two
  let flowers = R() < 0.6 ? 1 + (R() < 0.3 ? 1 : 0) : 0;
  for (const p of terminals) {
    const m = owner(add3(p.o, scl3(p.u, p.L * 0.5)));
    if (!m) continue;
    const nf = 2 + Math.floor(R() * 3);
    for (let i = 0; i < nf; i++) {
      const phi = (i / Math.max(1, nf - 1) - 0.5) * 1.4 + (R() - 0.5) * 0.15;
      const t = 0.56 + 0.56 * Math.sqrt(Math.max(0, 1 - phi * phi));
      const rim = add3(add3(p.o, scl3(p.u, t * p.L * 0.97)), scl3(p.w, phi * (p.W / 2) * 0.97));
      const out = norm3(add3(scl3(p.u, (t - 0.56) / 0.56), scl3(p.w, phi)));
      if (flowers > 0 && i === Math.floor(nf / 2)) {
        flowers--;
        const fc = add3(rim, scl3(out, 0.03));
        cap(m, V(rim), V(fc), U(0.018), U(0.016), G.pad);
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          const side = norm3(cross3(out, Math.abs(out[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
          const side2 = cross3(out, side);
          const pd = norm3(add3(scl3(out, 0.75), add3(scl3(side, Math.cos(a) * 0.8), scl3(side2, Math.sin(a) * 0.8))));
          cap(m, V(fc), V(add3(fc, scl3(pd, 0.05))), U(0.008), U(0.014), (x, y, z) => {
            const d = Math.hypot(M(x) - fc[0], M(y) - fc[1], M(z) - fc[2]);
            return d < 0.018 ? G.petalD : d > 0.04 ? G.petalL : G.petal;
          }, { fl: VF.SOFTAO });
        }
        ell(m, V(add3(fc, scl3(out, 0.012))), [U(0.011), U(0.011), U(0.011)], G.stigma);
        continue;
      }
      const a0 = add3(rim, scl3(out, -0.01)), a1 = add3(rim, scl3(out, 0.06 + R() * 0.015));
      cap(m, V(a0), V(a1), U(0.026), U(0.034), (x, y, z) => {
        const along = dot3(sub3([M(x), M(y), M(z)], a0), out) / 0.07;
        let c = along < 0.18 ? G.fruitBase : mixc(G.fruitL, G.fruit, sstep(0.2, 0.6, along));
        if (M(y) < a0[1] + (a1[1] - a0[1]) * along - 0.012) c = mixc(c, G.fruitD, 0.5);
        if (h01(x, y, z, 21) < 0.07 && along > 0.2) c = G.fruitDot;
        return c;
      }, { fl: VF.METAL });
      // the dimpled flower scar on top
      const top = V(add3(a1, scl3(out, 0.028)));
      ell(m, top, [1.4, 1.4, 1.4], 0, { carve: true });
      ell(m, V(add3(a1, scl3(out, 0.016))), [1.1, 1.1, 1.1], G.fruitD, { under: false });
    }
  }
  for (const b of branches) {
    const m = rig.m(b);
    const del: V3[] = [];
    m.forEach((x, y, z) => {
      if (stump.has(x, y, z) && exposed(stump, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) m.del(x, y, z);
  }
  let top = 0;
  for (const b of branches) rig.m(b).forEach((_x, y) => (top = Math.max(top, y)));
  return rig.build({ kind: 'healCactus', variant: 'pear', branches, height: (top + 1) * VS, radius: 0.45 });
}

// ============================================================================ barrel
function buildBarrel(seed: number): RigSpec {
  const R = rng(seed * 17 + 3);
  const rig = new CRig('heal_cactus_barrel_' + seed, VS);
  const stump = rig.part('stump', undefined, [0, 0, 0]);
  const H = 0.62 + R() * 0.2, Rb = 0.24 + R() * 0.06, N = 18 + Math.floor(R() * 4);
  const twist = (R() - 0.5) * 0.9;
  ell(stump, [0, 0, 0], [U(0.38), U(0.08), U(0.38)], (x, y, z) => (h01(x, y, z, 3) < 0.06 ? G.pebble : n01(x, y, z, 0.3, 2) > 0.6 ? G.sandD : G.sand), { keep: (_a, _b, _c, _x, y) => y >= 0 });
  // torn flesh ring (inside the barrel's foot until it breaks off)
  ell(stump, V([0, 0.06, 0]), [U(Rb * 0.72), U(0.035), U(Rb * 0.72)], (x, y, z) => (Math.hypot(M(x), M(z)) > Rb * 0.6 ? G.ribD : h01(x, y, z, 5) < 0.35 ? G.tornD : G.torn), { fl: VF.METAL });
  const barrel = (name: string, cx: number, cz: number, h: number, r: number, crown: boolean) => {
    const m = rig.part(name, 'stump', V([cx, 0.03, cz]));
    const yc = h * 0.45, hy = h * 0.58;
    const lim = U(r) + 2;
    const areoles: { at: V3; n: V3 }[] = [];
    for (let y = 1; y <= U(h) + 1; y++)
      for (let x = Math.floor(U(cx) - lim); x <= U(cx) + lim; x++)
        for (let z = Math.floor(U(cz) - lim); z <= U(cz) + lim; z++) {
          const X = M(x) - cx, Y = M(y), Z = M(z) - cz;
          const rb = r * Math.sqrt(Math.max(0, 1 - ((Y - yc) / hy) ** 2));
          if (rb <= 0) continue;
          const th = Math.atan2(Z, X) + Y * twist;
          const crest = 0.5 + 0.5 * Math.cos(N * th);
          const rho = Math.hypot(X, Z);
          if (rho > rb * (0.88 + 0.12 * crest)) continue;
          let c = crest > 0.75 ? G.ribL : crest < 0.2 ? G.ribD : G.rib;
          if (Y < 0.05) c = mixc(c, G.sand, 0.4);
          if (Y > h * 0.9) c = mixc(c, 0xb8d070, 0.35);
          m.set(x, y, z, c);
        }
    // areoles along the crests
    for (let k = 0; k < N; k++)
      for (let Y = 0.07; Y < h * 0.96; Y += 0.068) {
        const th = (k / N) * Math.PI * 2 - Y * twist;
        const rb = r * Math.sqrt(Math.max(0, 1 - ((Y - yc) / hy) ** 2));
        if (rb < 0.03) continue;
        const nrm = norm3([Math.cos(th), (yc - Y) * -0.6, Math.sin(th)]);
        areoles.push({ at: [cx + Math.cos(th) * rb, Y, cz + Math.sin(th) * rb], n: nrm });
      }
    let i = 0;
    for (const a of areoles) {
      i++;
      const v = V(a.at);
      m.set(Math.floor(v[0]), Math.floor(v[1]), Math.floor(v[2]), G.felt);
      if (i % 3) continue;
      // red hooked central spine, pale radials
      const tip = add3(a.at, scl3(a.n, VS * 3.2));
      line(m, [V(add3(a.at, scl3(a.n, VS * 0.6))), V(tip)], G.hook);
      m.set(Math.floor(tip[0] / VS), Math.floor(tip[1] / VS) - 1, Math.floor(tip[2] / VS), G.hook);
      for (const s of [-1, 1]) {
        const sd = norm3(add3(a.n, [-a.n[2] * s * 0.9, 0.5 * s, a.n[0] * s * 0.9]));
        line(m, [V(add3(a.at, scl3(sd, VS * 0.6))), V(add3(a.at, scl3(sd, VS * 2.2)))], G.spine);
      }
      if (R() < 0.08) {
        const b = add3(a.at, scl3(a.n, VS * 1.1));
        m.set(Math.floor(b[0] / VS), Math.floor(b[1] / VS), Math.floor(b[2] / VS), G.bead, VF.METAL);
      }
    }
    if (crown) {
      const nfr = 6 + Math.floor(R() * 3);
      for (let f = 0; f < nfr; f++) {
        const a = (f / nfr) * Math.PI * 2 + R() * 0.3;
        const rr = r * (0.32 + R() * 0.08);
        const base: V3 = [cx + Math.cos(a) * rr, h * 0.97, cz + Math.sin(a) * rr];
        const d = norm3([Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35]);
        if (f % 3 === 1) {
          // an orange flower
          for (let k = 0; k < 8; k++) {
            const pa = (k / 8) * Math.PI * 2;
            const pd = norm3(add3(scl3(d, 0.8), [Math.cos(pa) * 0.7, 0, Math.sin(pa) * 0.7]));
            cap(m, V(base), V(add3(base, scl3(pd, 0.05))), U(0.008), U(0.013), (x, y, z) => (Math.hypot(M(x) - base[0], M(y) - base[1], M(z) - base[2]) < 0.02 ? G.petal : G.oflower), { fl: VF.SOFTAO });
          }
          ell(m, V(add3(base, scl3(d, 0.012))), [1.3, 1.3, 1.3], G.petalL);
        } else {
          cap(m, V(base), V(add3(base, scl3(d, 0.06))), U(0.022), U(0.026), (x, y, z) => (h01(x, y, z, 12) < 0.12 ? G.yfruitD : (y % 3 === 0 ? mixc(G.yfruit, G.yfruitD, 0.25) : G.yfruit)), { fl: VF.METAL });
        }
      }
      // wool felt on the crown
      ell(m, V([cx, h * 0.985, cz]), [U(r * 0.28), 1.5, U(r * 0.28)], G.felt, { under: true });
    }
    return m;
  };
  barrel('barrel', 0, 0, H, Rb, true);
  const parts = ['barrel'];
  const nPup = 1 + (R() < 0.5 ? 1 : 0);
  for (let p = 0; p < nPup; p++) {
    const a = R() * 6.28;
    const d = Rb + 0.08 + R() * 0.04;
    barrel('pup' + (p + 1), Math.cos(a) * d, Math.sin(a) * d, H * (0.32 + R() * 0.12), Rb * (0.38 + R() * 0.1), R() < 0.5);
    parts.push('pup' + (p + 1));
  }
  for (const b of parts) {
    const m = rig.m(b);
    const del: V3[] = [];
    m.forEach((x, y, z) => {
      if (stump.has(x, y, z) && exposed(stump, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) m.del(x, y, z);
  }
  return rig.build({ kind: 'healCactus', variant: 'barrel', branches: parts, height: H + 0.08, radius: Rb + 0.12 });
}

const memo = memoBy((k: string) => k, (k: string) => {
  const [kind, seed] = k.split(':');
  return kind === 'barrel' ? buildBarrel(+seed) : buildPear(+seed);
});
/** a healing cactus (seeded): 'pear' (prickly-pear clump) or 'barrel' */
export function healCactusRig(seed: number, kind: 'pear' | 'barrel' = 'pear'): RigSpec {
  return memo(`${kind}:${seed}`);
}

// ============================================================================ sway / regrow
class Spr {
  x = 0;
  v = 0;
  step(dt: number, k = 90, c = 5) {
    this.v += (-k * this.x - c * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}
/**
 * Springy wobble of the branches (each pivots at its base): `push` a direction
 * (hit, a board riding past), plus a gentle breeze sway. `grow` 0..1 scales the
 * branches up from their stubs (staggered, with a little overshoot).
 */
export class CactusSway {
  private sx: Spr[] = [];
  private sz: Spr[] = [];
  private names: string[];
  t = Math.random() * 10;
  grow = 1;
  constructor(public rig: RigInstance) {
    this.names = (rig.geo.spec.meta?.branches as string[]) ?? [];
    for (let i = 0; i < this.names.length; i++) {
      this.sx.push(new Spr());
      this.sz.push(new Spr());
    }
  }
  push(dx: number, dz: number, power: number) {
    for (let i = 0; i < this.names.length; i++) {
      const k = power * (0.7 + 0.6 * ((i * 0.37) % 1));
      this.sx[i].v += dz * k;
      this.sz[i].v -= dx * k;
    }
  }
  update(dt: number) {
    this.t += dt;
    const n = this.rig.nodes;
    for (let i = 0; i < this.names.length; i++) {
      const breeze = Math.sin(this.t * 1.1 + i * 1.7) * 0.012;
      const x = this.sx[i].step(dt) + breeze, z = this.sz[i].step(dt);
      const node = n[this.names[i]];
      if (!node) continue;
      node.rotation.set(x, 0, z);
      // staggered sprouting
      const g = Math.max(0, Math.min(1, this.grow * (1 + this.names.length * 0.25) - i * 0.25));
      const sc = g <= 0 ? 0.0001 : g >= 1 ? 1 : Math.max(0.0001, sstep(0, 1, g) * (1 + Math.sin(g * Math.PI) * 0.14));
      node.scale.setScalar(sc);
      node.visible = g > 0;
    }
  }
}
