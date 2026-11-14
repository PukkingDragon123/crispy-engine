// THE GOLDEN LEVIATHAN: the flagship of Cleopatra's river fleet (33 m, 1/9),
// and ADMIRAL APIS, the bull-headed captain who commands her from the aft castle.
//
// The galley: a long spoon hull of painted cedar with two tiers, five gun ports a
// side (each bronze gun its own part, `port_l1`..`port_r5`, so they aim, recoil
// and can be shot out), ten long oars a side, a forecastle with two squat deck
// mortars, a two-storey midship castle under a gold canopy, a main mast and a
// foremast with striped sails (the main sail carries a winged sun disc), twin
// steering oars, a bronze crocodile-snout ram at the waterline, a gold cobra
// rising from the stem and a recurved papyrus sternpost. Sections `bow` / `hull`
// / `stern` break apart when she founders.
//
// The admiral: a black bull with a white blaze, long lyre horns cradling a gold
// sun disc, a gold nose ring, a gold breastplate over a long lapis-banded robe,
// a gilded flail and a bronze war horn (Fig humanoid, rescaled to 1/28).
import type { RigSpec } from '../../../engine/voxel/Rig';
import { VoxelModel, VF, mix } from '../../../engine/voxel/VoxelModel';
import type { CSpec } from '../../../engine/voxel/VoxelModel';
import { noise } from '../../../engine/math/rand';
import { Sc } from '../enemies/real/sculpt';
import { ell, cap, tube } from '../enemies/real/rk';
import { BoatRig, shadeTops, plankC, deckC, friezeC, sailC, cannonBarrel } from './boats';
import { Fig, finish, figMeta } from '../enemies/figure/fig';
import { defaultExpressions } from '../toon/humanoid';
import { rescaleRig } from '../enemies/figure/gear';
import { NILE, METAL, XI, res, softFur, beastBody, clearHead, eyes, brows, headTop, kilt, corselet, bandG, usekhG, hornG, wrapShell } from './kit';

type G = [number, number, number];

/** build a gun along +Z in a scratch model, then lay it into `s` turned to point along +X (side 1) or -X (side -1) */
function sideGun(s: Sc, at: G, L: number, side: 1 | -1, gold = false) {
  const tmp = new VoxelModel('tmp');
  const ts = new Sc(tmp, 1);
  const { muzzle } = cannonBarrel(ts, [0, 0, 0], L, { gold });
  tmp.forEach((x, y, z, c, f) => s.m.set(Math.floor(at[0]) + side * z, Math.floor(at[1]) + y, Math.floor(at[2]) - side * x, c, f));
  return [at[0] + side * muzzle[2], at[1] + muzzle[1], at[2]] as G;
}

export function warshipRig(): RigSpec {
  const vs = 1 / 9;
  const r = new BoatRig('nile_warship', vs);
  const HL = 150, W = 36;
  const keel = (z: number) => -14 + 8 * (z / HL) ** 2 + (z < -HL * 0.6 ? ((-z - HL * 0.6) / (HL * 0.4)) ** 2 * 14 : 0);
  const gunw = (z: number) => 22 + (z > HL * 0.62 ? ((z - HL * 0.62) / (HL * 0.38)) ** 2 * 10 : 0) + (z < -HL * 0.62 ? ((-z - HL * 0.62) / (HL * 0.38)) ** 2 * 16 : 0);
  const halfW = (z: number) => W * Math.max(0, 1 - Math.abs(z / (HL + 2)) ** 2.4) ** 0.5;
  const plank = plankC(11, 0x7a3a22);
  const hull = r.part('hull', undefined, [0, 0, 0]);
  const bow = r.part('bow', 'hull', [0, 0, 50]);
  const stern = r.part('stern', 'hull', [0, 0, -50]);
  const sec = (z: number) => (z > 50 ? bow : z < -50 ? stern : hull);
  const portZ = [-64, -32, 0, 32, 64];
  const isPort = (y: number, z: number) => y >= 9 && y <= 14 && portZ.some((p) => Math.abs(z - p) <= 3);
  const isOar = (y: number, z: number) => y >= 3 && y <= 4 && ((z + 200) % 19 === 0) && Math.abs(z) < 100;
  for (let z = -HL; z <= HL; z++) {
    const yk = keel(z), yg = gunw(z), w = halfW(z);
    if (w < 0.6) continue;
    const s = sec(z);
    for (let y = Math.floor(yk); y <= Math.ceil(yg); y++) {
      const k = Math.max(0, Math.min(1, (y - yk) / Math.max(1, yg - yk)));
      const wy = w * k ** 0.3;
      for (let x = -Math.ceil(wy) - 1; x <= Math.ceil(wy); x++) {
        const d = wy - Math.abs(x + 0.5);
        if (d < 0) continue;
        if (!(d < 2 || y <= Math.floor(yk) + 1)) continue;
        // gun ports and oar ports open in the side
        if (d < 2 && (isPort(y, z) || isOar(y, z))) {
          if (d > 1) s.m.set(x, y, z, 0x1a0e08);
          continue;
        }
        let c: number;
        if (y >= Math.ceil(yg) - 4) c = res(friezeC(Math.ceil(yg) - 4), x, y, z);
        else if (y >= 6 && y <= 8) c = y === 7 ? 0xe8b43a : NILE.lapis; // the gun-deck wale
        else if (y >= 15 && y <= 16) c = NILE.carnelian;
        else if (y < 1) c = mix(res(plank, x, y, z), 0x2a3a2a, 0.4);
        else c = res(plank, x, y, z);
        s.m.set(x, y, z, c, c === 0xe8b43a ? VF.METAL : VF.SOLID);
      }
    }
    // port lids (open, painted red), the weather deck
    for (const p of portZ) if (Math.abs(z - p) <= 3) for (const sx of [1, -1]) for (let k = 0; k <= 2; k++) s.m.set(sx > 0 ? Math.ceil(w) + 1 + k : -Math.ceil(w) - 2 - k, 15 + k, z, NILE.carnelian);
    if (Math.abs(z) < HL - 10) for (let x = -Math.floor(w) + 2; x < Math.floor(w) - 2; x++) s.m.set(x, 22, z, res(deckC(7), x, 22, z));
  }
  // shields hung along the bulwark
  for (let z = -100; z <= 100; z += 10)
    for (const sx of [1, -1]) {
      const x0 = sx > 0 ? Math.ceil(halfW(z)) + 1 : -Math.ceil(halfW(z)) - 2;
      for (let y = 22; y <= 30; y++)
        for (let dz = -4; dz <= 4; dz++) {
          const rr = Math.hypot(y - 26, dz);
          if (rr > 4.3) continue;
          const s = sec(z + dz);
          s.m.set(x0, y, z + dz, rr > 3.4 ? NILE.bronze[0] : rr < 1 ? NILE.bronze[2] : noise.n3((z + dz) / 2.2, y / 2.2, sx) > 0.15 ? 0x3a2418 : 0xe8dcc4, rr > 3.4 || rr < 1 ? VF.METAL : VF.SOLID);
        }
    }
  // forecastle and aftcastle
  const castle = (s: Sc, z0: number, z1: number, h: number) => {
    for (let z = z0; z <= z1; z++) {
      const w = halfW(z) - 2;
      for (let x = -Math.floor(w); x < Math.floor(w); x++) {
        s.m.set(x, 22 + h, z, res(deckC(9), x, 22 + h, z));
        if (Math.abs(x + 0.5) > w - 1.5 || z === z0 || z === z1) for (let y = 23; y < 22 + h; y++) s.m.set(x, y, z, (y % 4 === 0) ? NILE.lapis : res(plank, x, y, z));
      }
      for (const sx of [1, -1]) for (let y = 23 + h; y <= 26 + h; y++) s.m.set(sx > 0 ? Math.floor(w) - 1 : -Math.floor(w), y, z, y === 26 + h ? 0xe8b43a : NILE.wood, y === 26 + h ? VF.METAL : VF.SOLID);
    }
  };
  castle(bow, 96, 130, 8);
  castle(stern, -135, -96, 12);
  // the admiral's canopy on the aft castle: four lotus columns under a gold roof
  for (const [cx, cz] of [[-14, -128], [13, -128], [-14, -100], [13, -100]] as [number, number][])
    for (let y = 35; y <= 54; y++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) stern.m.set(cx + dx, y, cz + dz, y > 51 ? 0x6a9a3a : y < 38 ? NILE.lapis : (y & 1) ? 0xe8dcc0 : 0xd8c8a8);
  for (let x = -16; x <= 15; x++) for (let z = -130; z <= -98; z++) stern.m.set(x, 55, z, (Math.floor(z / 3) & 1) ? 0xe8b43a : NILE.lapis, (Math.floor(z / 3) & 1) ? VF.METAL : VF.SOLID);
  for (let x = -16; x <= 15; x++) for (const z of [-131, -97]) stern.m.set(x, 54, z, NILE.carnelian);
  // the midship castle: two storeys of painted columns, a gold canopy roof
  for (let z = -40; z <= 20; z++)
    for (let x = -18; x <= 17; x++) {
      const ex = x === -18 || x === 17, ez = z === -40 || z === 20;
      if (ex || ez) {
        const col = (x + 100) % 6 === 0 || (z + 100) % 6 === 0 || (ex && ez);
        for (let y = 23; y <= 41; y++) {
          if (!col && y > 25 && y < 39 && y !== 32) continue;
          hull.m.set(x, y, z, y === 32 ? 0xe8b43a : col ? ((y & 1) ? 0xe8dcc0 : 0xd8c8a8) : NILE.lapis, y === 32 ? VF.METAL : VF.SOLID);
        }
      }
      hull.m.set(x, 42, z, ((Math.floor(x / 4) + Math.floor(z / 4)) & 1) ? 0xe8b43a : 0xf0e6cc, ((Math.floor(x / 4) + Math.floor(z / 4)) & 1) ? VF.METAL : VF.SOLID);
      if (ex || ez) hull.m.set(x, 43, z, NILE.carnelian);
    }
  // masts, yards and sails (rigged)
  const mast = (name: string, z: number, top: number, sw: number, sh: number, sun: boolean) => {
    const m = r.part(name, 'hull', [0, 22, z]);
    for (let y = 22; y <= top; y++) for (const [dx, dz] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1]]) if (Math.abs(dx) + Math.abs(dz) < 2 || y < top - 30) m.m.set(dx, y, z + dz, y % 14 === 0 ? NILE.rawhide : dx + dz < 0 ? NILE.woodDark : NILE.wood);
    ell(m, [-0.5, top + 1, z - 0.5], [2.6, 2, 2.6], METAL.gold[0], { fl: VF.METAL });
    const sl = r.part(name + '_sail', name, [0, top - 6, z + 1]);
    for (let x = -sw - 2; x <= sw + 1; x++) for (const y of [top - 6, top - 5]) sl.m.set(x, y, z + 1, y === top - 5 ? NILE.wood : NILE.woodDark);
    const sc = sailC(0x9a2018, 13);
    for (let y = top - 6 - sh; y <= top - 7; y++)
      for (let x = -sw; x <= sw - 1; x++) {
        const bx = Math.sin(((x + sw + 0.5) / (sw * 2)) * Math.PI), by = Math.sin(((y - (top - 6 - sh)) / sh) * Math.PI);
        sl.m.set(x, y, z + 2 + Math.round(bx * (0.6 + 0.4 * by) * sw * 0.16), res(sc, x, y, 0), VF.SOFTAO);
      }
    if (sun) {
      const cy = top - 6 - sh * 0.5;
      for (let x = -32; x <= 31; x++)
        for (let y = Math.floor(cy - 12); y <= Math.ceil(cy + 12); y++) {
          const d = Math.hypot(x + 0.5, (y - cy) * 1.05);
          const ax = Math.abs(x + 0.5);
          const wing = ax > 9 && Math.abs(y - cy - 1 + ax * 0.12) < 5 - ax * 0.12 && (Math.floor(y - cy + ax * 0.12) & 1) === 0;
          if (d > 9 && !wing) continue;
          const bx = Math.sin(((x + sw + 0.5) / (sw * 2)) * Math.PI), by = Math.sin(((y - (top - 6 - sh)) / sh) * Math.PI);
          sl.m.set(x, y, z + 3 + Math.round(bx * (0.6 + 0.4 * by) * sw * 0.16), d <= 9 ? (d < 7 ? 0xffc040 : 0xb8862a) : ax > 22 ? NILE.lapis : 0xe8b43a, d < 7 ? VF.EMISSIVE : VF.METAL);
        }
    }
  };
  mast('mast', 26, 150, 58, 76, true);
  mast('foremast', 86, 118, 34, 44, false);
  // gun ports: a bronze gun in each, pointing out of the side
  const ports: { part: string; at: number[]; side: number }[] = [];
  portZ.forEach((z, i) => {
    for (const sx of [1, -1] as const) {
      const name = `port_${sx > 0 ? 'l' : 'r'}${i + 1}`;
      const px = sx * (halfW(z) - 6);
      const g = r.part(name, sec(z) === bow ? 'bow' : sec(z) === stern ? 'stern' : 'hull', [px, 11.5, z]);
      const muz = sideGun(g, [px, 11.5, z], 26, sx);
      r.sock(name + '_muzzle', name, muz);
      ports.push({ part: name, at: [px * vs, 11.5 * vs, z * vs], side: sx });
    }
  });
  // two squat deck mortars on the forecastle
  for (const [i, x] of [[1, -9], [2, 8]] as [number, number][]) {
    const m = r.part(`mortar_${i}`, 'bow', [x, 31, 112]);
    for (let y = 31; y <= 33; y++) for (let dx = -5; dx <= 4; dx++) for (let dz = -5; dz <= 4; dz++) if (Math.hypot(dx + 0.5, dz + 0.5) < 5.2) m.m.set(x + dx, y, 112 + dz, res(plank, dx, y, dz));
    cap(m, [x, 34, 112], [x, 41, 115], 4.6, 3.6, (xx, yy) => (yy % 3 === 0 ? NILE.bronze[2] : NILE.bronze[0]), VF.METAL);
    for (let dx = -2; dx <= 1; dx++) for (let dz = -2; dz <= 1; dz++) m.m.set(x + dx, 41, 115 + dz, 0x0e0a08);
    r.sock(`mortar_${i}_muzzle`, `mortar_${i}`, [x, 42, 115]);
  }
  // oars: ten a side from the low oar ports
  const oarZ: number[] = [];
  for (let z = -95; z <= 95; z++) if ((z + 200) % 19 === 0 && Math.abs(z) < 100) oarZ.push(z);
  oarZ.forEach((z, i) => {
    for (const sx of [1, -1]) {
      const ox = sx * (halfW(z) - 1);
      const op = r.part(`oar_${sx > 0 ? 'l' : 'r'}${i + 1}`, 'hull', [ox, 3.5, z]);
      for (let k = 0; k <= 64; k++) {
        const x = ox + sx * k * 0.8, y = 3.5 - k * 0.42;
        op.m.set(Math.floor(x), Math.floor(y), z, NILE.wood);
        if (k > 50) for (let w = -2; w <= 2; w++) op.m.set(Math.floor(x), Math.floor(y), z + w, (k & 1) ? NILE.wood : NILE.woodDark);
      }
    }
  });
  // twin steering oars off the stern quarters
  for (const sx of [1, -1]) {
    const rp = r.part(sx > 0 ? 'rudder_l' : 'rudder_r', 'stern', [sx * 20, 34, -122]);
    for (let k = 0; k <= 62; k++) for (const dx of [0, 1]) rp.m.set(sx * 20 + Math.round(sx * k * 0.2) + dx - (sx < 0 ? 1 : 0), 34 - Math.round(k * 0.62), -122 - Math.round(k * 0.5), NILE.wood);
    for (let k = 0; k <= 16; k++) for (let w = -1; w <= 1; w++) for (let h = 0; h < 8; h++) rp.m.set(sx * 33 + w, -4 - h + Math.round(k * 0.2), -152 - k, (h + k) % 5 === 0 ? 0xe8b43a : NILE.woodDark);
  }
  // the bronze crocodile-snout ram
  const ramC = (x: number, y: number, z: number) => (z % 4 === 0 ? NILE.bronze[2] : y < -2 ? NILE.bronze[1] : NILE.bronze[0]);
  cap(bow, [0, -2, HL - 12], [0, -3, HL + 24], 6.5, 2.2, ramC, VF.METAL);
  for (const sx of [1, -1]) {
    ell(bow, [sx * 4.2, 1.2, HL + 4], [2.0, 1.8, 2.4], NILE.bronze[2], { fl: VF.METAL });
    bow.m.set(sx > 0 ? 4 : -5, 2, HL + 6, 0x1a1008);
    for (let z = HL + 2; z <= HL + 22; z += 3) bow.m.set(sx > 0 ? Math.round(4.2 - (z - HL) * 0.12) : -Math.round(4.2 - (z - HL) * 0.12) - 1, -5, z, NILE.ivory);
  }
  // the stem rises into a gold cobra with a spread hood
  tube(bow, [[0, gunw(HL) - 4, HL - 4], [0, gunw(HL) + 6, HL + 2], [0, gunw(HL) + 18, HL + 2], [0, gunw(HL) + 26, HL - 3]], (t) => 3.4 - t * 1.4, (x, y, z) => ((y + z) % 5 === 0 ? 0xffe08a : 0xe8b43a), VF.METAL);
  ell(bow, [0, gunw(HL) + 24, HL - 3], [6.4, 6.0, 1.6], (x, y) => (Math.abs(x + 0.5) < 1.5 && y % 3 === 0 ? NILE.lapis : 0xe8b43a), { fl: VF.METAL });
  ell(bow, [0, gunw(HL) + 30, HL - 1], [2.2, 2.0, 3.0], 0xe8b43a, { fl: VF.METAL });
  bow.m.set(-2, gunw(HL) + 31, HL + 1, NILE.carnelian).set(1, gunw(HL) + 31, HL + 1, NILE.carnelian);
  // the recurved papyrus sternpost
  tube(stern, [[0, gunw(-HL) - 4, -HL + 4], [0, gunw(-HL) + 10, -HL - 2], [0, gunw(-HL) + 26, -HL + 2], [0, gunw(-HL) + 32, -HL + 12]], (t) => 5.2 - t * 2.6, plank);
  ell(stern, [0, gunw(-HL) + 33, -HL + 15], [7.0, 4.4, 5.6], (x, y, z) => (((x + y + z) & 1) ? 0xe8b43a : 0x6a9a3a), { fl: VF.METAL });
  r.sock('admiral', 'stern', [0, 35, -114]);
  shadeTops(r);
  const m = vs;
  return r.build({
    kind: 'flagship', length: HL * 2 * m, beam: W * 2 * m, draft: 1.2, height: 16,
    deck: [[-3.0, 3.0, -10.6, 10.6, 22 * m], [-2.4, 2.4, 10.7, 14.4, 30 * m], [-2.6, 2.6, -15.0, -10.7, 34 * m], [-1.9, 1.9, -4.4, 2.2, 42 * m]],
    stations: [
      [0.0, 34 * m, -12.4], [-1.6, 34 * m, -14.0], [1.5, 34 * m, -11.4],
      [-2.0, 30 * m, 13.6], [1.9, 30 * m, 11.8], [0, 30 * m, 13.2],
      [-2.5, 22 * m, 6.5], [2.5, 22 * m, 5.0], [-2.4, 22 * m, -7.0], [2.4, 22 * m, -8.5], [0, 42 * m, -1.0],
    ],
    sections: [],
    guns: [],
    ports,
    mortars: ['mortar_1', 'mortar_2'],
    admiral: [0, 35 * m, -114 * m],
  });
}

// ============================================================================ ADMIRAL APIS
export function admiralApisRig(): RigSpec {
  const F = new Fig();
  const seed = 307;
  const black = softFur(0x1e1a1c, 0x3a3236, 0x0a0808, seed);
  const blaze = softFur(0xf0e8dc, 0xffffff, 0xc8c0b4, seed + 1);
  const body = beastBody(F, { seed, fur: black, belly: softFur(0x2e282a, 0x4a4246, 0x141012, seed + 2), dark: 0x0a0808, bulk: 1.3, paunch: 1.6, legs: 'hoof', tail: 'tuft', tailCol: black, foot: 0x2a2420, hand: black, nail: 0x2a2420 });
  const { hd, jw } = clearHead(F);
  ell(hd, [0, 56.0, -2.2], [6.2, 5.4, 5.8], black);
  ell(hd, [0, 52.0, -4.2], [5.6, 4.4, 4.0], black);
  // the broad blunt muzzle and its wet nose pad
  for (let z = 1; z <= 12; z++) {
    const t = (z - 1) / 11;
    const hw = 4.6 - t * 0.7, y1 = 56.2 - t * 2.6, y0 = 48.8 + t * 0.4;
    for (let x = -5; x < 5; x++) for (let y = 48; y <= 57; y++) {
      const gx = x + 0.5, gy = y + 0.5;
      const u = Math.abs(gx) / hw, w = (gy - (y0 + y1) / 2) / ((y1 - y0) / 2);
      if (u ** 2.4 + Math.abs(w) ** 2.2 > 1) continue;
      hd.m.set(x, y, z, z >= 11 ? 0x5a4a4c : res(black, x, y, z));
    }
  }
  for (const s of [1, -1]) hd.m.set(XI(s, 2), 51, 13, 0x0a0606).set(XI(s, 2), 52, 13, 0x1a1212);
  // the white blaze down the forehead
  hd.m.forEach((x, y, z) => {
    const ax = Math.abs(x + 0.5);
    if (z >= 2 && y >= 53 && ax < 2.6 - (60 - y) * 0.1 && !hd.m.has(x, y, z + 1)) hd.m.set(x, y, z, res(blaze, x, y, z));
  });
  // gold nose ring through the septum
  for (const [x, y, z] of [[-1, 50, 13], [0, 50, 13], [-2, 49, 13], [1, 49, 13], [-2, 48, 14], [1, 48, 14], [-1, 47, 14], [0, 47, 14]] as G[]) hd.m.set(x, y, z, METAL.gold[0], VF.METAL);
  // lyre horns cradling the sun disc, ears below them
  for (const s of [1, -1]) {
    hornG(hd, [s * 5.6, 59.4, -1.6], [s * 1, 0.25, 0.1], 10, 1.8, (x, y) => (y > 64 ? 0xe8dcc0 : 0xb8a888), [-s * 0.6, 1.6, 0.4], 0x8a7a62);
    ell(hd, [s * 7.0, 56.0, -2.6], [2.6, 0.9, 1.3], black);
    hd.m.set(XI(s, 7), 56, -1, 0x6a4a4a);
  }
  const disc = 0xffc040;
  for (let x = -4; x <= 3; x++) for (let y = 62; y <= 69; y++) {
    const d = Math.hypot(x + 0.5, y - 65.5);
    if (d > 4) continue;
    hd.m.set(x, y, -3, d > 3.1 ? METAL.gold[1] : disc, d > 3.1 ? VF.METAL : VF.EMISSIVE);
    hd.m.set(x, y, -4, METAL.gold[1], VF.METAL);
  }
  for (const [y, c] of [[61, METAL.gold[0]], [62, NILE.turq], [63, METAL.gold[0]]] as [number, number][]) hd.m.set(-1, y, -2, c).set(0, y, -2, c);
  // the heavy jaw
  for (let z = -2; z <= 11; z++) {
    const hw = 4.2 - (z / 11) * 0.8;
    for (let x = -5; x < 5; x++) for (let y = 46; y <= 48; y++) {
      if (Math.abs(x + 0.5) > hw || (y === 46 && z > 9)) continue;
      jw.m.set(x, y, z, y === 48 && Math.abs(x + 0.5) < hw - 1 && z > 2 ? 0x5a2a2e : res(black, x, y, z));
    }
  }
  eyes(F, { x0: 3, y0: 55, z: 2, w: 3, h: 2, iris: 0x4a2010, lid: 0x0a0606 });
  brows(F, 2, 5, 57, 3, 0x0a0808);
  // the admiral's kit: gold breastplate, broad usekh, long lapis-banded robe, armlets
  corselet(F, { y0: 31, y1: 42, metal: METAL.gold, seed });
  usekhG(F.s('torso'), [METAL.gold[0], NILE.lapis, METAL.gold[0], NILE.carnelian, METAL.gold[2], NILE.lapis], { rMax: 11, y0: 40 });
  kilt(F, { seed, bulk: 1.3, long: true, belt: (x) => ((x & 3) === 1 ? NILE.lapis : METAL.gold[0]), panel: (x, y) => ((y >> 1) & 1 ? NILE.lapis : 0xf0e6cc), hem: METAL.gold[0] });
  for (const n of ['arm_l', 'arm_r']) bandG(F.s(n), 37, 38, METAL.gold[0]);
  for (const n of ['fore_l', 'fore_r']) bandG(F.s(n), 25, 28, (x, y) => (y === 26 ? NILE.lapis : METAL.gold[0]));
  // the gilded flail (nekhakha) in the right fist
  const wp = F.part('weapon', 'fore_r', body.handR);
  const hx = Math.floor(body.handR[0]);
  for (let y = 18; y <= 30; y++) wp.m.set(hx, y, 1, (y % 3 === 0) ? NILE.lapis : METAL.gold[0], (y % 3 === 0) ? VF.SOLID : VF.METAL);
  for (let k = 0; k < 3; k++) for (let i = 0; i < 9; i++) {
    const y = 31 - i, z = 2 + Math.round(i * 0.45), x = hx - 1 + k;
    wp.m.set(x, y, z, i % 2 ? METAL.gold[2] : NILE.carnelian, i % 2 ? VF.METAL : VF.SOLID);
  }
  // a bronze war horn on a cord at the left hip
  const pv = F.s('pelvis');
  tube(pv, [[9.5, 24, 2], [10.6, 20, 3.4], [10.2, 16.5, 6.2]], (t) => 0.8 + t * 1.3, (t: number) => (t > 0.8 ? NILE.bronze[2] : NILE.bronze[0]), VF.METAL);
  wrapShell(pv, 24, 24, NILE.rawhide, (x, y, z) => z > 0);
  F.sock('horn', 'pelvis', [10.2, 16, 7]);
  finish(F);
  const top = headTop(F, 70);
  const spec = F.build('nile_admiral', figMeta(F, 'nile_admiral', { height: top * F.vs, radius: 0.5, expressions: defaultExpressions(['neutral', 'angry', 'enraged', 'hurt', 'laugh', 'smug', 'stunned', 'defeated']) }));
  return rescaleRig(spec, 1 / 28);
}

void tube;
void mix;
void (null as unknown as CSpec);
