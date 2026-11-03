// Ozymandias, the travelling trading post: a giant, very old desert tortoise
// (about 4.4 m to the top of his awning) who carries the whole shop on his back.
// Elephantine scaly legs with horn toenails, a craggy beaked head with wet
// modelled eyes and heavy lids, a weathered, sun-bleached scute shell with
// pyramided vertebrals, and a backpack caravan lashed on top: a saddle blanket,
// timber poles, rolled rugs, nailed crates, a water barrel, a striped awning on
// four posts, and things that swing — two lanterns, a copper kettle, clay pots,
// saddlebags and a hand-painted TRADING POST sign on a little bowsprit. Old
// Mother Tamsin rides on a cushion at the front of his shell (socket `rider`).
//
// RIG (faces +Z, LEFT = +X, origin on the ground under the shell, 1/18 m):
//   shell (root) → neck → head → jaw, eye_l/eye_r, lid_l/lid_r
//   shell → leg_fl → foot_fl (and fr, bl, br), shell → tail
//   shell → lantern_l, lantern_r, kettle, pots, bag_l, bag_r, sign (swing)
// meta.retract: per part, the local offset (m) that pulls it into the shell;
// meta.shellDrop: how far the shell sinks onto its plastron once legs are in.
import { CRig, VoxelModel, VF, V3, RigSpec, ell, cap, tube, line, blob, Prim, hollow, splitInto, wetEye, vessel, sheet, n01, h01, mixc, mulc, finish } from './ckit';
import { signPanel } from '../props/western';
import { PR, textWidth } from '../props/helpers';

const VS = 1 / 18;
const U = (m: number) => m / VS;
const P = (x: number, y: number, z: number): V3 => [x / VS, y / VS, z / VS];
/** voxel index -> metres at the cell centre */
const M = (i: number) => (i + 0.5) * VS;

// ------------------------------------------------------------------ palette
const SKIN = { base: 0x7a715d, shade: 0x5d5646, hi: 0x938a73, dark: 0x3e392e, groove: 0x4a4437, warm: 0x8a7658 };
const CARA = { base: 0x6b5636, ring: 0x7d6743, seam: 0x35281a, bleach: 0xa48d64, chip: 0xb79e74, dust: 0x9a7f58, scratch: 0x4a3a26 };
const PLAS = { base: 0xb39a6a, ring: 0xa38a5c, seam: 0x6a5634 };
const HORN = { base: 0x4c4436, hi: 0x6c6250, edge: 0x2e2a22, claw: 0xcdbf9c, clawD: 0x9a8c6c };
const WOOD = { base: 0x7a5530, shade: 0x5a3c20, hi: 0x9a7044, dark: 0x3e2814 };
const ROPE = { base: 0xc9a86a, shade: 0xa08350 };
const LEATHER = { base: 0x8a5a32, shade: 0x6a4224, hi: 0xa87444, stitch: 0xe0c89a };
const IRON = { base: 0x5a5a60, hi: 0x8a8c92 };
const COPPER = { base: 0xb4683a, hi: 0xd8925a, shade: 0x84482a, green: 0x5e9a7e };
const CLAY = { base: 0xb8693e, shade: 0x8e4c2a, hi: 0xd08458, paint: 0xe8d6b0 };

// ------------------------------------------------------------------ joints (metres)
const J = {
  shell: [0, 0.95, 0] as V3,
  neck: [0, 1.42, 1.32] as V3,
  head: [0, 1.9, 2.3] as V3,
  jaw: [0, 1.93, 2.47] as V3,
  eye: [0.205, 2.07, 2.77] as V3,
  legF: [0.92, 1.28, 1.02] as V3,
  kneeF: [1.03, 0.66, 1.12] as V3,
  footF: [1.06, 0.14, 1.18] as V3,
  legB: [0.9, 1.18, -1.08] as V3,
  kneeB: [0.99, 0.64, -1.2] as V3,
  footB: [1.01, 0.14, -1.26] as V3,
  tail: [0, 1.08, -1.6] as V3,
  rider: [0, 2.72, 0.62] as V3,
};
const Pv = (v: V3) => P(v[0], v[1], v[2]);
/** the carapace dome (metres): centre and radii */
const CC: V3 = [0, 1.62, -0.05], CR: V3 = [1.48, 1.08, 1.78];
/** top surface of the dome at (x, z), metres */
const domeY = (x: number, z: number) => CC[1] + CR[1] * Math.sqrt(Math.max(0, 1 - (x / CR[0]) ** 2 - ((z - CC[2]) / CR[2]) ** 2));

// ------------------------------------------------------------------ skin & scales
/** thick old elephantine skin: staggered scale plates, dark grooves, dusty patches */
function skin(x: number, y: number, z: number, cell = 2.3, seed = 0) {
  const rowH = cell * 0.85;
  const row = Math.floor((y + 4000) / rowH);
  const off = (row & 1) * 0.5;
  const fx = (x + 4000) / cell + off, fz = (z + 4000) / cell + off * 0.7;
  const gx = fx - Math.floor(fx), gz = fz - Math.floor(fz), gy = (y + 4000) / rowH - row;
  const e = Math.min(gx, 1 - gx, gz, 1 - gz, gy, 1 - gy);
  if (e < 0.1) return SKIN.groove;
  const k = h01(Math.floor(fx), row, Math.floor(fz), seed);
  let c = k < 0.33 ? SKIN.shade : k < 0.82 ? SKIN.base : SKIN.hi;
  const n = n01(x, y, z, 0.11, seed);
  if (n > 0.68) c = mixc(c, SKIN.warm, 0.4);
  else if (n < 0.28) c = mixc(c, SKIN.dark, 0.25);
  return c;
}

// ------------------------------------------------------------------ the carapace
function scute(x: number, y: number, z: number) {
  const X = M(x), Y = M(y), Z = M(z);
  const nx = X / CR[0], ny = (Y - CC[1]) / CR[1], nz = (Z - CC[2]) / CR[2];
  const ax = Math.abs(nx);
  const wob = (n01(x, y, z, 0.09, 4) - 0.5) * 0.07;
  let seam = false, cu = 0, cv = 0, band = 0;
  if (ny < -0.42) {
    // marginal scutes around the rim
    const ang = Math.atan2(nx, nz);
    const k = Math.round((ang + wob) / 0.3);
    seam = Math.abs(ang + wob - k * 0.3) < 0.03 || Math.abs(ny + 0.42) < 0.04;
    cu = Math.sin(k * 0.3) * 0.95;
    cv = Math.cos(k * 0.3) * 0.95;
    band = 40;
  } else if (ax < 0.27 + wob) {
    const B = [-1.2, -0.6, -0.2, 0.2, 0.58, 1.2];
    for (let i = 0; i < B.length - 1; i++)
      if (nz >= B[i] && nz < B[i + 1]) {
        cv = (B[i] + B[i + 1]) / 2;
        band = i;
        seam = nz - B[i] < 0.035 || B[i + 1] - nz < 0.02;
      }
    seam = seam || Math.abs(ax - (0.27 + wob)) < 0.03;
  } else {
    const B = [-1.2, -0.46, 0.04, 0.5, 1.2];
    for (let i = 0; i < B.length - 1; i++)
      if (nz + wob >= B[i] && nz + wob < B[i + 1]) {
        cv = (B[i] + B[i + 1]) / 2;
        band = 10 + i;
        seam = nz + wob - B[i] < 0.035;
      }
    cu = Math.sign(nx) * 0.56;
  }
  if (seam) return h01(x, y, z, 3) < 0.35 ? CARA.dust : CARA.seam;
  // growth rings around each scute's centre, a sun-bleached crown, old scratches
  const d = Math.hypot((nx - cu) * 1.2, nz - cv);
  const ring = Math.floor(d / 0.06) % 2 === 1;
  let c: number = ring ? CARA.ring : CARA.base;
  if (ny > 0.62 && ring) c = CARA.bleach;
  else if (ny > 0.78) c = mixc(c, CARA.bleach, 0.45);
  if (h01(Math.floor(x / 2), Math.floor(y / 2), Math.floor(z / 2), 9) > 0.985) c = CARA.chip;
  if (Math.abs(n01(x, y, z, 0.35, 11) - 0.5) < 0.012 && band < 20) c = CARA.scratch;
  return c;
}

/** woven saddle blanket colours (stripes across the body, a zigzag band) */
function blanket(x: number, z: number) {
  const s = Math.floor((M(z) + 3) / 0.11);
  const zig = Math.abs(((M(x) * 6 + 100) % 2) - 1);
  if (s % 6 === 0) return 0xe8d6b0;
  if (s % 6 === 3) return Math.abs(((M(z) + 3) / 0.11) % 1 - zig) < 0.25 ? 0xd9a53a : 0x2f4a7a;
  return s % 2 ? 0xa83a2a : 0x8e2a20;
}

function buildShell(m: VoxelModel) {
  // the dark body inside, so every opening shows flesh, not a void
  ell(m, P(0, 1.42, -0.05), [U(1.22), U(0.42), U(1.5)], () => SKIN.dark);
  // carapace: a high, weathered dome cut off at the rim
  ell(m, Pv(CC), [U(CR[0]), U(CR[1]), U(CR[2])], (x, y, z) => scute(x, y, z), { keep: (_lx, ly) => ly > -0.57 });
  // pyramided vertebral scutes (a craggy keel)
  for (const vz of [-0.9, -0.4, 0.0, 0.39, 0.78]) {
    const z = CC[2] + vz * CR[2];
    const y = domeY(0, z);
    ell(m, P(0, y - 0.02, z), [U(0.24), U(0.07), U(0.24)], (x, yy, zz) => scute(x, yy, zz));
  }
  // marginal rim flares out a little over the legs and the neck
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const x = Math.sin(a) * CR[0] * 0.97, z = CC[2] + Math.cos(a) * CR[2] * 0.97;
    ell(m, P(x, 1.03, z), [U(0.16), U(0.07), U(0.16)], (xx, yy, zz) => scute(xx, yy, zz));
  }
  // notches where the neck and tail come out
  ell(m, P(0, 1.3, 1.62), [U(0.62), U(0.36), U(0.42)], 0, { carve: true });
  ell(m, P(0, 1.12, -1.78), [U(0.28), U(0.2), U(0.25)], 0, { carve: true });
  // plastron: the belly plate, seamed
  ell(m, P(0, 0.98, -0.05), [U(1.2), U(0.11), U(1.5)], (x, y, z) => {
    const X = M(x), Z = M(z);
    if (Math.abs(X) < 0.03 || [-0.9, -0.35, 0.2, 0.75].some((s) => Math.abs(Z - s) < 0.03)) return PLAS.seam;
    return Math.floor(Math.hypot(X * 1.2, Z) / 0.08) % 3 === 0 ? PLAS.ring : PLAS.base;
  });
  // ---- the saddle blanket over the crown, fringed along both sides
  const blk: V3[] = [];
  m.forEach((x, y, z) => {
    if (Math.abs(M(x)) < 0.95 && M(z) > -1.15 && M(z) < 0.5 && M(y) > 2.2 && !m.has(x, y + 1, z)) blk.push([x, y + 1, z]);
  });
  for (const [x, y, z] of blk) m.set(x, y, z, blanket(x, z), VF.SOFTAO);
  for (const sx of [-1, 1])
    for (let z = -1.1; z < 0.48; z += 0.07) {
      const x = sx * 0.96;
      const y = domeY(x, z) + 0.02;
      line(m, [P(x, y, z), P(x * 1.04, y - 0.12 - ((z * 7) % 1) * 0.04, z)], h01(U(z), 1, 2) < 0.5 ? 0xe8d6b0 : 0xd9a53a);
    }
  // ---- the timber frame: two side poles following the dome, cross bars, lashing
  for (const sx of [-1, 1]) {
    const pts: V3[] = [];
    for (let z = -1.32; z <= 0.97; z += 0.23) pts.push(P(sx * 0.8, domeY(sx * 0.8, z) + 0.1, z));
    tube(m, pts, pts.map(() => U(0.05)), (x, y, z) => (h01(x, y, z, 2) < 0.12 ? WOOD.dark : (z & 3) === 0 ? WOOD.shade : WOOD.base));
    // ropes lashing the frame down to the rim
    for (const z of [-0.95, -0.15, 0.62]) {
      const y0 = domeY(sx * 0.8, z) + 0.12;
      line(m, [P(sx * 0.8, y0, z), P(sx * 1.2, domeY(sx * 1.2, z) + 0.03, z + 0.04), P(sx * 1.47, 1.1, z + 0.06)], (x, y, zz) => ((x + y + zz) & 1 ? ROPE.base : ROPE.shade));
    }
  }
  for (const z of [-1.1, -0.5, 0.35, 0.9]) {
    const y = Math.max(domeY(-0.8, z), domeY(0.8, z)) + 0.13;
    cap(m, P(-0.84, y, z), P(0.84, y + 0.02, z), U(0.045), U(0.045), (x, yy) => ((x + yy) & 1 ? WOOD.base : WOOD.shade));
  }
  // ---- posts and the striped awning
  const posts: [number, number][] = [[0.78, 0.86], [-0.78, 0.86], [0.78, -1.26], [-0.78, -1.26]];
  for (const [x, z] of posts) {
    const top = z > 0 ? 4.4 : 4.2;
    cap(m, P(x, domeY(x, z) - 0.05, z), P(x * 1.02, top, z + 0.02), U(0.055), U(0.045), (xx, yy) => (yy % 5 === 0 ? WOOD.dark : WOOD.base));
  }
  // lantern arms reaching out from the front posts
  for (const sx of [-1, 1]) cap(m, P(sx * 0.78, 4.02, 0.87), P(sx * 1.0, 4.05, 0.95), U(0.03), U(0.025), WOOD.shade);
  sheet(m, P(-0.88, 4.44, 1.0), P(0.88, 4.44, 1.0), P(-0.88, 4.23, -1.38), P(0.88, 4.23, -1.38), (u) => (Math.floor(u * 9) % 2 ? PR.canvasStripe.base : PR.canvas.base), { sag: 2.2, ripple: 0.5, thick: 1, res: 0.35, seed: 7 });
  for (let x = -0.86; x <= 0.86; x += 0.065) {
    const t = Math.floor((x + 1) * 15) % 3;
    line(m, [P(x, 4.43, 1.01), P(x, 4.36 - t * 0.02, 1.02)], t ? PR.canvas.shade : PR.canvasStripe.base);
  }
  // the bowsprit pole the sign hangs from, out over his head
  cap(m, P(0, domeY(0, 0.85) + 0.05, 0.85), P(0, 3.3, 1.74), U(0.05), U(0.04), WOOD.base);
  // ---- cargo: rolled rugs across the middle, a stack of crates and a barrel behind
  rugRoll(m, P(-0.88, 2.87, 0.12), P(0.88, 2.86, 0.14), U(0.19), [0xb0442e, 0x2f4a7a, 0xe8d6b0]);
  rugRoll(m, P(-0.84, 2.84, -0.28), P(0.86, 2.83, -0.3), U(0.18), [0x3f6a4a, 0xc8903a, 0x8e2a20]);
  rugRoll(m, P(-0.8, 3.18, -0.08), P(0.8, 3.19, -0.07), U(0.17), [0x8e2a20, 0xe8d6b0, 0x2f4a7a]);
  crate(m, [0.12, 2.92, -0.86], [0.36, 0.33, 0.33], 0.12, 1);
  crate(m, [-0.05, 3.49, -0.88], [0.27, 0.24, 0.26], -0.25, 2);
  vessel(m, P(0.66, 2.36, -1.06), [3.3, 3.7, 3.9, 4.0, 4.0, 3.9, 3.7, 3.4, 3.2, 3.0, 2.8], (row, x, z, a) => {
    if (row === 1 || row === 8) return IRON.base;
    return Math.floor((a + Math.PI) * 4) % 2 ? WOOD.base : WOOD.shade;
  }, { seed: 3 });
  // ---- Tamsin's cushion at the front of his shell
  ell(m, P(0, 2.66, 0.62), [U(0.36), U(0.07), U(0.3)], (x, y, z) => (Math.abs(M(x)) > 0.3 || Math.abs(M(z) - 0.62) > 0.25 ? 0xd9a53a : (x + z) % 4 === 0 ? 0xc8503a : 0xa83a2a), { fl: VF.SOFTAO });
  hollow(m, 2);
}

/** a rolled rug: striped body, spiral rolled ends */
function rugRoll(m: VoxelModel, a: V3, b: V3, r: number, cols: number[]) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  cap(m, a, b, r, r * 0.95, (x, y, z) => {
    const t = ((x + 0.5 - a[0]) * (b[0] - a[0]) + (y + 0.5 - a[1]) * (b[1] - a[1]) + (z + 0.5 - a[2]) * (b[2] - a[2])) / (L * L);
    if (t < 0.03 || t > 0.97) {
      const d = Math.hypot(y + 0.5 - (a[1] + (b[1] - a[1]) * t), z + 0.5 - (a[2] + (b[2] - a[2]) * t));
      return Math.floor(d * 1.4) % 2 ? cols[0] : cols[2];
    }
    const s = Math.floor(t * 16);
    return s % 4 === 0 ? cols[2] : s % 4 === 2 ? cols[1] : cols[0];
  }, { fl: VF.SOFTAO });
}

/** a nailed wooden crate (planks, framed edges, iron corners), slightly turned */
function crate(m: VoxelModel, c: V3, h: V3, yaw: number, seed: number) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const R = Math.hypot(h[0], h[2]) + VS;
  const e = VS * 1.6;
  for (let x = Math.floor(U(c[0] - R)); x <= Math.ceil(U(c[0] + R)); x++)
    for (let y = Math.floor(U(c[1] - h[1])); y <= Math.ceil(U(c[1] + h[1])); y++)
      for (let z = Math.floor(U(c[2] - R)); z <= Math.ceil(U(c[2] + R)); z++) {
        const X = M(x) - c[0], Y = M(y) - c[1], Z = M(z) - c[2];
        const lx = X * cs - Z * sn, lz = X * sn + Z * cs;
        if (Math.abs(lx) > h[0] || Math.abs(Y) > h[1] || Math.abs(lz) > h[2]) continue;
        const ex = h[0] - Math.abs(lx) < e, ey = h[1] - Math.abs(Y) < e, ez = h[2] - Math.abs(lz) < e;
        let col: number;
        if (ex && ey && ez) col = IRON.base;
        else if ((ex && ey) || (ex && ez) || (ey && ez)) col = WOOD.dark;
        else {
          const plank = Math.floor((Y + h[1]) / 0.12);
          const seam = (Y + h[1]) % 0.12 < VS * 0.9;
          col = seam ? WOOD.dark : (plank + seed) % 2 ? WOOD.base : mixc(WOOD.base, WOOD.hi, 0.5);
          if (!seam && h01(x, y, z, seed) > 0.97) col = IRON.hi; // nail heads
        }
        m.set(x, y, z, col);
      }
}

// ------------------------------------------------------------------ the head
function buildHead(rig: CRig) {
  const mass = new VoxelModel('headMass');
  const E = J.eye;
  const prims: Prim[] = [
    { c: P(0, 2.03, 2.58), r: [U(0.29), U(0.27), U(0.34)] },
    { c: P(0, 1.95, 2.86), r: [U(0.2), U(0.19), U(0.21)] },
    { c: P(0.16, 2.14, 2.7), r: [U(0.11), U(0.065), U(0.12)] },
    { c: P(-0.16, 2.14, 2.7), r: [U(0.11), U(0.065), U(0.12)] },
    { c: P(0.2, 1.92, 2.6), r: [U(0.12), U(0.13), U(0.16)] },
    { c: P(-0.2, 1.92, 2.6), r: [U(0.12), U(0.13), U(0.16)] },
    { c: P(0, 1.8, 2.5), r: [U(0.2), U(0.12), U(0.22)] },
    { c: P(0, 1.96, 2.36), r: [U(0.26), U(0.24), U(0.14)] },
    { c: Pv(E), r: [U(0.11), U(0.1), U(0.11)], sub: true, k: 2 },
    { c: P(-E[0], E[1], E[2]), r: [U(0.11), U(0.1), U(0.11)], sub: true, k: 2 },
  ];
  const mouthY = (Z: number) => 1.905 + Math.max(0, 2.78 - Z) * 0.22;
  blob(mass, prims, (x, y, z) => {
    const X = M(x), Y = M(y), Z = M(z);
    if (Z > 2.93 && Y < 2.04 && Y > 1.8) return Math.abs(Y - mouthY(Z)) < 0.03 ? HORN.edge : Y > mouthY(Z) ? HORN.base : HORN.hi; // the beak
    if (Z > 2.42 && Math.abs(Y - mouthY(Z)) < 0.025) return HORN.edge; // the long grin line
    // big plates on the crown, finer scales below
    return skin(x, y, z, Y > 2.08 ? 3.4 : 2.0, 5);
  }, { k: U(0.18), disp: (x, y, z) => (n01(x, y, z, 0.32, 6) - 0.5) * 0.9 });
  // the hooked upper beak tip and nostrils
  cap(mass, P(0, 1.99, 3.0), P(0, 1.87, 3.1), U(0.075), U(0.03), HORN.base);
  for (const sx of [-1, 1]) mass.set(Math.floor(U(sx * 0.05)), Math.floor(U(2.03)), Math.floor(U(3.04)), 0x1a1612);
  const head = rig.part('head', 'neck', Pv(J.head));
  const jaw = rig.part('jaw', 'head', Pv(J.jaw));
  splitInto(mass, head, jaw, (x, y, z) => M(z) > 2.42 && M(y) < mouthY(M(z)) - 0.012);
  // eyes: wet, dark-amber, recessed under the brow; lids that blink
  const eye = rig.part('eye_l', 'head', Pv(E));
  wetEye(eye, Pv(E), U(0.098), [0.62, 0.06, 0.78], { iris: 0x7a4a16, irisEdge: 0x3a220c, sclera: 0x1c140e, pupil: 0x070504, irisR: 0.8, pupilR: 0.42 });
  rig.mirror('eye_l', 'eye_r', 'head');
  const lid = rig.part('lid_l', 'head', Pv(E), [-1.15, 0, 0]);
  const fwd: V3 = [0.62, 0.06, 0.78];
  ell(lid, Pv(E), [U(0.13), U(0.13), U(0.13)], (x, y, z) => skin(x, y, z, 1.6, 8), {
    keep: (lx, ly, lz) => lx * lx + ly * ly + lz * lz > 0.62 && ly > -0.18 && lx * fwd[0] + ly * fwd[1] + lz * fwd[2] > -0.15,
  });
  rig.mirror('lid_l', 'lid_r', 'head');
  finish(head);
}

// ------------------------------------------------------------------ legs, tail, neck
function buildLeg(rig: CRig, name: string, S: V3, K: V3, F: V3, claws: number, cell: number) {
  const up = rig.part('leg_' + name, 'shell', Pv(S));
  blob(up, [{ a: Pv(S), b: Pv(K), r0: U(0.33), r1: U(0.27) }, { c: Pv(K), r: [U(0.27), U(0.24), U(0.27)] }], (x, y, z) => {
    // big armour scales on the front of the leg, fine ones behind
    const front = M(z) > (S[2] + K[2]) / 2 + 0.05;
    return skin(x, y, z, front ? cell * 1.5 : cell, name.length * 3);
  }, { k: U(0.12), disp: (x, y, z) => (n01(x, y, z, 0.3, 2) - 0.5) * 0.8 });
  const ft = rig.part('foot_' + name, 'leg_' + name, Pv(K));
  const pad: V3 = [F[0] + 0.01, 0.12, F[2] + 0.03];
  blob(ft, [{ a: Pv(K), b: Pv(F), r0: U(0.27), r1: U(0.3) }, { c: Pv(pad), r: [U(0.33), U(0.13), U(0.36)] }], (x, y, z) => {
    if (M(y) < 0.05) return SKIN.dark; // the worn sole
    // wrinkle rings around the ankle like an elephant's
    if (M(y) > 0.2 && M(y) < 0.55 && Math.floor(M(y) / 0.05) % 3 === 0) return SKIN.groove;
    return skin(x, y, z, cell, 7);
  }, { k: U(0.1), keep: (_x, y) => y >= 0, disp: (x, y, z) => (n01(x, y, z, 0.3, 3) - 0.5) * 0.7 });
  // horn toenails round the front of the foot
  for (let k = 0; k < claws; k++) {
    const a = (k - (claws - 1) / 2) * 0.36;
    const base: V3 = [pad[0] + Math.sin(a) * 0.29, 0.07, pad[2] + Math.cos(a) * 0.31];
    cap(ft, Pv(base), P(base[0] + Math.sin(a) * 0.08, 0.025, base[2] + Math.cos(a) * 0.1), U(0.05), U(0.022), (x, y) => (M(y) > 0.06 ? HORN.claw : HORN.clawD));
  }
}

function buildNeck(rig: CRig) {
  const m = rig.part('neck', 'shell', Pv(J.neck));
  const pts: V3[] = [P(0, 1.32, 1.18), P(0, 1.5, 1.72), P(0, 1.78, 2.14), P(0, 1.93, 2.38)];
  const rad = [U(0.34), U(0.31), U(0.27), U(0.25)];
  tube(m, pts, rad, (x, y, z) => {
    // deep folds where the neck bends, a paler throat
    const fold = Math.floor((M(z) + M(y) * 0.6) / 0.07) % 4 === 0;
    if (fold) return SKIN.groove;
    return M(y) < 1.55 + (M(z) - 1.2) * 0.45 ? mixc(skin(x, y, z, 1.8, 3), 0xa89a7c, 0.35) : skin(x, y, z, 2.2, 3);
  });
  // the loose collar of skin where the neck leaves the shell
  ell(m, P(0, 1.38, 1.5), [U(0.42), U(0.16), U(0.3)], (x, y, z) => (Math.floor(M(z) / 0.06) % 2 ? SKIN.shade : SKIN.groove), { under: true });
}

function buildTail(rig: CRig) {
  const m = rig.part('tail', 'shell', Pv(J.tail));
  cap(m, P(0, 1.06, -1.56), P(0, 0.76, -2.02), U(0.15), U(0.05), (x, y, z) => skin(x, y, z, 1.8, 4));
  cap(m, P(0, 0.79, -1.98), P(0, 0.7, -2.12), U(0.05), U(0.02), HORN.base);
}

// ------------------------------------------------------------------ swaying goods
function buildLantern(rig: CRig, name: string, at: V3) {
  const m = rig.part(name, 'shell', Pv(at));
  const [x, y, z] = at;
  line(m, [P(x, y, z), P(x, y - 0.12, z)], IRON.base);
  // cap, glass with a warm flame, base, corner bars
  vessel(m, P(x, y - 0.2, z), [1.3, 2.0, 2.6, 1.6], () => IRON.base, { seed: 2 });
  vessel(m, P(x, y - 0.48, z), [2.3, 2.5, 2.6, 2.6, 2.5], (row, xx, zz, a) => (Math.floor((a + Math.PI) / (Math.PI / 2) + 0.5) % 1 === 0 && Math.abs(Math.sin(a * 2)) < 0.25 ? IRON.base : row === 2 && Math.hypot(xx + 0.5 - U(x), zz + 0.5 - U(z)) < 1.2 ? 0xffe2a0 : 0xffc66a), { fl: VF.EMISSIVE | VF.SOFTAO, seed: 3 });
  vessel(m, P(x, y - 0.56, z), [2.8, 2.6], () => IRON.base, { seed: 4 });
}

function buildKettle(rig: CRig, at: V3) {
  const m = rig.part('kettle', 'shell', Pv(at));
  const [x, y, z] = at;
  line(m, [P(x, y, z), P(x, y - 0.14, z)], ROPE.base);
  vessel(m, P(x, y - 0.46, z - 0.02), [2.6, 3.3, 3.5, 3.4, 3.0, 2.2, 1.4], (row, xx, zz) => (row === 6 ? COPPER.shade : h01(xx, row, zz, 6) > 0.9 ? COPPER.green : row > 3 ? COPPER.hi : COPPER.base), { fl: VF.METAL, seed: 6 });
  cap(m, P(x, y - 0.36, z - 0.2), P(x, y - 0.27, z - 0.33), U(0.03), U(0.018), COPPER.base, { fl: VF.METAL });
  line(m, [P(x - 0.12, y - 0.24, z), P(x, y - 0.14, z), P(x + 0.12, y - 0.24, z)], IRON.base);
}

function buildPots(rig: CRig, at: V3) {
  const m = rig.part('pots', 'shell', Pv(at));
  const [x, y, z] = at;
  for (const [dx, dz, h, s] of [[-0.12, 0.05, 0.42, 1], [0.1, -0.08, 0.3, 2]] as [number, number, number, number][]) {
    line(m, [P(x, y, z), P(x + dx, y - h + 0.36, z + dz)], ROPE.shade);
    const prof = s === 1 ? [1.8, 2.8, 3.4, 3.5, 3.1, 2.2, 1.6, 1.8] : [1.6, 2.6, 3.0, 2.8, 2.0, 1.4, 1.6];
    vessel(m, P(x + dx, y - h - 0.05, z + dz), prof, (row, xx, zz) => (row === 3 && s === 1 ? CLAY.paint : row === prof.length - 1 ? CLAY.shade : h01(xx, row, zz, s) > 0.8 ? CLAY.hi : CLAY.base), { seed: s, hollowTop: 1 });
  }
}

function buildBag(rig: CRig, name: string, side: number) {
  const pivot: V3 = [side * 1.18, 2.47, -0.3];
  const m = rig.part(name, 'shell', Pv(pivot));
  const c: V3 = [side * 1.53, 1.98, -0.3];
  ell(m, Pv(c), [U(0.13), U(0.33), U(0.42)], (x, y, z) => {
    const Y = M(y), Z = M(z);
    if (Math.abs(Z + 0.3) > 0.39 || Y < 1.69) return LEATHER.stitch; // stitched seam round the edge
    if (Y > 2.1) return LEATHER.shade; // the flap
    return n01(x, y, z, 0.2, 5) > 0.6 ? LEATHER.hi : LEATHER.base;
  }, { rot: [0, 0, side * 0.42] });
  for (const dz of [-0.16, 0.16]) {
    ell(m, P(side * 1.62, 2.06, -0.3 + dz), [U(0.03), U(0.06), U(0.035)], IRON.hi, { fl: VF.METAL });
    line(m, [P(side * 1.24, 2.47, -0.3 + dz), P(side * 1.48, 2.3, -0.3 + dz)], LEATHER.shade);
  }
}

function buildSign(rig: CRig) {
  const at: V3 = [0, 3.3, 1.74];
  const m = rig.part('sign', 'shell', Pv(at));
  const lines = textWidth('TRADING POST', 1, 1) <= 40 ? ['TRADING POST'] : ['TRADING', 'POST'];
  const zf = Math.round(U(1.76));
  const H = lines.length * 6 - 1 + 4;
  const yBot = Math.round(U(3.22)) - H;
  signPanel(m, 0, yBot, zf, lines, { bg: PR.paintWhite, ink: PR.red.dark, pad: 1, thick: 2 });
  for (const sx of [-1, 1]) line(m, [P(sx * 0.4, 3.3, 1.74), P(sx * 0.5, M(yBot + H), 1.72)], IRON.base);
}

// ================================================================== RIG
let cached: RigSpec | null = null;
export function caravanTortoiseRig(): RigSpec {
  if (cached) return cached;
  const rig = new CRig('caravan_tortoise', VS);
  buildShell(rig.part('shell', undefined, Pv(J.shell)));
  buildNeck(rig);
  buildHead(rig);
  buildLeg(rig, 'fl', J.legF, J.kneeF, J.footF, 5, 2.4);
  buildLeg(rig, 'bl', J.legB, J.kneeB, J.footB, 4, 2.1);
  rig.mirror('leg_fl', 'leg_fr', 'shell');
  rig.mirror('foot_fl', 'foot_fr', 'leg_fr');
  rig.mirror('leg_bl', 'leg_br', 'shell');
  rig.mirror('foot_bl', 'foot_br', 'leg_br');
  buildTail(rig);
  buildLantern(rig, 'lantern_l', [1.0, 4.04, 0.95]);
  buildLantern(rig, 'lantern_r', [-1.0, 4.04, 0.95]);
  buildKettle(rig, [0.8, 3.62, -1.36]);
  buildPots(rig, [-1.02, 2.95, -1.02]);
  buildBag(rig, 'bag_l', 1);
  buildBag(rig, 'bag_r', -1);
  buildSign(rig);
  rig.socket('rider', 'shell', Pv(J.rider));
  rig.socket('head_top', 'head', P(0, 2.32, 2.6));
  rig.socket('mouth', 'jaw', P(0, 1.86, 2.95));
  let top = 0;
  for (const p of rig.parts) p.model.forEach((_x, y) => (top = Math.max(top, y + 1)));
  const v = (x: number, y: number, z: number): V3 => [x, y, z];
  cached = rig.build({
    caravan: true,
    height: top * VS,
    radius: 1.9,
    /** snout tip ahead of the origin; where the rug goes; how high his face is (m) */
    front: 3.12,
    rugDist: 4.25,
    headY: 2.06,
    /** where wares come out of the pack (m, root space) */
    pack: [0.25, 3.25, 0.05],
    retract: {
      neck: v(0, -0.22, -0.95),
      leg_fl: v(-0.16, 0.68, -0.05),
      leg_fr: v(0.16, 0.68, -0.05),
      leg_bl: v(-0.12, 0.64, 0.05),
      leg_br: v(0.12, 0.64, 0.05),
      tail: v(0, 0.12, 0.38),
    },
    shellDrop: 0.8,
    swing: ['lantern_l', 'lantern_r', 'kettle', 'pots', 'bag_l', 'bag_r', 'sign'],
    eyes: 'voxel',
  });
  return cached;
}
void mulc;
