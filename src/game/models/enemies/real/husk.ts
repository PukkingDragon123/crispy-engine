// Sand Husk (1/32 m): a dried, sand-crusted corpse clawing up out of the dunes.
// Hunched, emaciated, cracked leathery skin, ribs showing, torn burial linen with
// frayed edges, sand pouring from a split in its side, ember-lit eye sockets.
import type { RigSpec } from '../../../../engine/voxel/Rig';
import { RBm, Sc, M3, humanM, HumanM, torsoAt, tonal, cloth, crystalsM, hornM, frayX, frayZ, coat, mulCol, jit, VF, P, mix, mulRGB, hash3, noise, addEyePart, snapM, boneTex , pouchM, skullCharmM, posterScrapM } from './sculpt';
import { realFinish, driedEye, lumpy, bands, boneR, rope, loopPts } from './rk';

export interface EnemyOpts {
  alpha?: boolean;
  variant?: number;
}

export const ENEMY_VS = 1 / 48;

export function huskRig(o: EnemyOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % 3) + 3) % 3;
  const VS = ENEMY_VS;
  const K = alpha ? 1.3 : 1; // alpha: physically bigger (more voxels, same voxel size)
  const m = (x: number) => x * K; // scale meters
  const rb = new RBm(`husk${alpha ? '_alpha' : ''}_v${v}`, VS);
  const cs = VS / 0.12; // noise cell ~12cm

  const skinBase = alpha ? 0x4e4842 : [0x705640, 0x645140, 0x7a5a3c][v];
  // clean tone bands (reads well with outlines + cel light): shrunken hollows, base, sun-bleached highs
  const skin = bands(mix(skinBase, 0x2a1d14, 0.4), skinBase, mix(skinBase, 0xb89068, 0.3), VS, 0.42, v + 1, -0.42, 0.45);
  const crack = alpha ? 0x221a14 : 0x2a1a10;
  const cavity = 0x2a1a10;
  const crust = bands(P.sand2, P.sand1, P.sand0, VS, 0.3, v + 7);
  const boneC = boneR(0xe6d6b4, VS, v + 2);
  const linenBase = v === 1 ? 0xd9ccaa : 0xc4b38f;
  const linenX = cloth(linenBase, 0x7a6a4c, 5, 'x', v);
  const linenZ = cloth(linenBase, 0x7a6a4c, 5, 'z', v);
  const nail = jit(0x1a120c, 0.06);

  const spec: HumanM = {
    hip: [m(0.125), m(0.94), 0],
    knee: [m(0.132), m(0.5), m(0.094)],
    ankle: [m(0.132), m(0.1), m(0.006)],
    shoulder: [m(0.32), m(1.5), m(0.18)],
    elbow: [m(0.385), m(1.15), m(0.28)],
    wrist: [m(0.395), m(0.81), m(0.38)],
    waist: [0, m(1.06), 0],
    pelvis: { c: [0, m(0.975), 0], r: [m(0.23), m(0.13), m(0.15)] },
    torso: {
      y0: m(1.0),
      y1: m(1.62),
      f: (t) => ({ zc: m(Math.pow(t, 1.5) * 0.238), rx: m((3.3 + t * 2.2 - Math.max(0, t - 0.86) * 9) / 16), rz: m((2.1 + Math.sin(t * Math.PI) * 0.95) / 16) }),
    },
    thighR: [m(0.095), m(0.07)],
    shinR: [m(0.07), m(0.052)],
    armR: [m(0.075), m(0.062)],
    foreR: [m(0.062), m(0.05)],
    col: { pelvis: skin, torso: skin, arm: skin, fore: skin, hand: skin, thigh: skin, shin: skin, foot: skin, accent: nail },
    hand: 'claw',
    foot: 'bare',
    footLen: m(0.29),
    footW: m(0.11),
    handSize: 1.25 * K,
  };
  const { pelvis, torso, arm, fore, thigh, shin } = humanM(rb, spec);
  const T = (y: number) => torsoAt(spec, y);

  // dried flesh is never smooth: shrink-wrapped lumps, sinews and folds
  for (const s of [pelvis, torso, arm, fore, thigh, shin]) lumpy(s.m, 3, 1, v + 2, 0.36);
  // skin cracks everywhere (dark crack network) before details
  for (const s of [pelvis, torso, arm, fore, thigh, shin]) coat(s, (x, y, z) => Math.abs(noise.n3(x * 5, y * 5, z * 5 + v)) < 0.011, crack);

  // ---------------------------------------------------------------- pelvis: loincloth
  for (let y = m(0.9); y <= m(1.02); y += VS) pelvis.disc([0, y, 0], m(0.25), VS, 'y', linenX, undefined, m(0.17));
  {
    const flap = rb.pm('loin', 'pelvis', [0, m(0.92), m(0.17)]);
    frayX(flap, -m(0.13), m(0.13), m(0.17), m(0.92), m(0.12), m(0.26), linenX, 11 + v);
    frayX(flap, -m(0.12), m(0.12), m(0.18), m(0.92), m(0.1), m(0.22), mulCol(linenX, 0.9), 12 + v);
  }
  frayX(pelvis, -m(0.16), m(0.16), -m(0.15), m(0.92), m(0.08), m(0.2), linenX, 23 + v);
  pelvis.ell([m(0.05), m(0.95), m(0.165)], [m(0.03), m(0.025), m(0.02)], mulCol(linenX, 0.8)); // knot
  pelvis.line([m(0.06), m(0.93), m(0.17)], [m(0.08), m(0.82), m(0.18)], mulCol(linenX, 0.85));

  // ---------------------------------------------------------------- torso: ribs, wound, spine
  const ribTop = m(1.42), ribBot = m(1.16);
  for (let y = ribBot; y <= ribTop; y += VS) {
    const f = T(y);
    const ry = Math.round(y / VS);
    const isRib = ry % 3 !== 0; // 2 voxel rib, 1 voxel gap
    for (let a = -1.25; a <= 1.25; a += 0.04) {
      const x = Math.sin(a) * f.rx;
      const z = f.zc + Math.cos(a) * f.rz;
      if (!isRib) {
        torso.del([x, y, z]);
        torso.del([x, y, z - VS]);
        torso.dot([x * 0.85, y, z - VS * 1.5], cavity);
      } else if (Math.abs(a) > 0.12) {
        torso.dot([x, y, z], boneC);
      }
    }
    // sternum ridge
    torso.dot([-VS * 0.5, y, f.zc + f.rz], boneC).dot([VS * 0.5, y, f.zc + f.rz], mulRGB(P.bone2, 0.95));
  }
  // collarbones
  const cf = T(m(1.49));
  torso.limb([0, m(1.5), cf.zc + cf.rz * 0.9], [m(0.25), m(1.52), cf.zc + cf.rz * 0.4], m(0.018), m(0.016), boneC);
  torso.limb([0, m(1.5), cf.zc + cf.rz * 0.9], [-m(0.25), m(1.52), cf.zc + cf.rz * 0.4], m(0.018), m(0.016), boneC);
  // shrunken belly with a gash
  const bf = T(m(1.08));
  torso.carve([0, m(1.08), bf.zc + bf.rz], [m(0.12), m(0.05), m(0.05)]);
  torso.ell([0, m(1.08), bf.zc + bf.rz - m(0.05)], [m(0.1), m(0.04), m(0.02)], cavity);
  // the split in the left flank, sand pouring out
  const wf = T(m(1.26));
  const wc: M3 = [wf.rx * 0.95, m(1.26), wf.zc + wf.rz * 0.3];
  torso.carve(wc, [m(0.07), m(0.12), m(0.08)]);
  torso.ell([wc[0] - m(0.045), wc[1], wc[2]], [m(0.04), m(0.1), m(0.06)], cavity);
  torso.ell([wc[0] - m(0.02), wc[1] - m(0.08), wc[2]], [m(0.045), m(0.045), m(0.05)], tonal(P.sand1, P.sand0, P.sand2, cs, 3));
  for (let k = 0; k < 9; k++) torso.dot([wc[0] + m(0.03) + (k > 4 ? VS : 0), wc[1] - m(0.1) - k * VS, wc[2] + (k % 3 === 1 ? VS : 0)], k % 2 ? P.sand1 : P.sand0);
  // torn skin lips around the wound
  for (let a = 0; a < Math.PI * 2; a += 0.35) torso.dot([wc[0] + m(0.012), wc[1] + Math.sin(a) * m(0.12), wc[2] + Math.cos(a) * m(0.08)], mulCol(skin, 1.15));
  // spine vertebrae + shoulder blades
  for (let y = m(1.05); y <= m(1.6); y += VS * 2) {
    const f = T(y);
    torso.ell([0, y, f.zc - f.rz - VS * 0.2], [VS * 1.2, VS * 0.9, VS * 0.9], Math.round(y / VS) % 4 === 0 ? boneC : mulRGB(P.bone3, 0.9));
  }
  for (const sx of [1, -1]) {
    const f = T(m(1.44));
    torso.ell([sx * m(0.15), m(1.44), f.zc - f.rz + m(0.03)], [m(0.1), m(0.12), m(0.035)], skin);
    torso.line([sx * m(0.07), m(1.52), f.zc - f.rz + m(0.0)], [sx * m(0.22), m(1.37), f.zc - f.rz + m(0.01)], boneC);
  }
  // sand caked on the upper back and shoulders
  coat(torso, (x, y, z) => y > m(1.45) && noise.n3(x * 7, y * 7, z * 7 + v) > -0.2 && z < T(y).zc + T(y).rz * 0.3, crust);
  // neck: sinewy strands
  torso.limb([0, m(1.58), m(0.26)], [0, m(1.7), m(0.34)], m(0.07), m(0.06), skin);
  for (const sx of [-1, 1]) torso.limb([sx * m(0.035), m(1.57), m(0.31)], [sx * m(0.02), m(1.7), m(0.4)], VS * 0.6, VS * 0.6, mulCol(skin, 0.8));
  torso.dot([0, m(1.66), m(0.41)], cavity);

  // burial shawl over left shoulder, down the back with frayed edge (not on v2)
  if (v !== 2) {
    for (let y = m(1.12); y <= m(1.62); y += VS) {
      const f = T(y);
      for (let x = -f.rx - VS * 2; x <= f.rx + VS * 2; x += VS) {
        const diag = x - (y - m(1.62)) * 0.9;
        const bottom = m(1.12) + hash3(Math.round(x / VS), 9, v) * m(0.08);
        if (diag < -m(0.12) || y < bottom) continue;
        const zz = f.zc - Math.sqrt(Math.max(0, 1 - (x / (f.rx + VS * 2)) ** 2)) * (f.rz + VS * 1.5);
        torso.dot([x, y, zz], linenZ);
        torso.dot([x, y, zz - VS], mulCol(linenZ, 0.92));
      }
    }
    for (let x = m(0.12); x <= m(0.36); x += VS) for (let z = -m(0.02); z <= m(0.3); z += VS) if (torso.m.has(torso.i(x), torso.i(m(1.6)), torso.i(z)) || torso.m.has(torso.i(x), torso.i(m(1.58)), torso.i(z))) torso.dot([x, m(1.63), z], linenX);
    frayZ(torso, -m(0.05), m(0.25), m(0.37), m(1.58), m(0.03), m(0.1), linenZ, 5);
  }

  // ---------------------------------------------------------------- head
  const head = rb.pm('head', 'torso', [0, m(1.7), m(0.35)]);
  const HC: M3 = [0, m(1.86), m(0.44)];
  const hr = m(0.22);
  head.ell([HC[0], HC[1] - hr * 0.05, HC[2] + hr * 0.05], [hr * 0.9, hr * 0.85, hr * 0.92], skin); // face mass
  head.ell([HC[0], HC[1] - hr * 0.55, HC[2] + hr * 0.3], [hr * 0.62, hr * 0.38, hr * 0.6], skin); // muzzle / maxilla
  for (const sx of [-1, 1]) head.ell([sx * hr * 0.72, HC[1] - hr * 0.2, HC[2] + hr * 0.25], [hr * 0.28, hr * 0.32, hr * 0.5], skin); // temples / cheeks
  head.ell([HC[0], HC[1] + hr * 0.45, HC[2] - hr * 0.15], [hr * 1.02, hr * 0.75, hr * 1.08], skin); // cranium dome
  lumpy(head.m, 3, 1, v + 13, 0.36);
  const zf = HC[2] + hr * 0.95;
  // brow ridge
  for (const sx of [-1, 1]) head.ell([sx * hr * 0.42, HC[1] + hr * 0.25, zf - hr * 0.12], [hr * 0.3, hr * 0.1, hr * 0.14], mulCol(skin, 1.06)); // brow ridges
  // deep eye sockets with ember pupils
  for (const sx of [-1, 1]) {
    const ec: M3 = [sx * hr * 0.45, HC[1] + hr * 0.02, zf];
    head.carve(ec, [hr * 0.25, hr * 0.2, hr * 0.42]);
    head.ell([ec[0], ec[1], ec[2] - hr * 0.36], [hr * 0.22, hr * 0.18, VS * 0.8], cavity);
    // a shrivelled, cloudy eyeball remnant sunk deep in the socket (real geometry; eye_r is mirrored)
    if (sx === 1) driedEye(rb, 'eye_l', 'head', snapM(VS, [ec[0], ec[1] - hr * 0.03, ec[2] - hr * 0.2]), hr * 0.13);
    // dark bags under eyes
    head.dot([ec[0], ec[1] - hr * 0.26, zf - VS * 0.2], mulCol(skin, 0.65));
  }
  // nose: collapsed, two dark nostril holes
  head.ell([0, HC[1] - hr * 0.2, zf + VS * 0.4], [hr * 0.12, hr * 0.15, VS], mulCol(skin, 0.95));
  head.dot([-VS, HC[1] - hr * 0.32, zf + VS], cavity).dot([0, HC[1] - hr * 0.32, zf + VS], cavity);
  // cheekbones poking through the dried skin
  for (const sx of [-1, 1]) {
    head.ell([sx * hr * 0.72, HC[1] - hr * 0.25, zf - hr * 0.2], [hr * 0.14, hr * 0.08, hr * 0.15], boneC);
    head.ell([sx * hr * 0.55, HC[1] - hr * 0.48, zf - VS], [hr * 0.12, hr * 0.12, VS], mulCol(skin, 0.6)); // sunken cheek
  }
  // upper lip pulled back from teeth
  const ty = HC[1] - hr * 0.62;
  for (let x = -hr * 0.5; x <= hr * 0.5 + 1e-6; x += VS) {
    const ix = Math.round(x / VS);
    head.dot([x, ty, zf], hash3(ix, 3, v) > 0.18 ? (ix % 2 ? 0xf0e0bd : 0xd8c196) : cavity);
    head.dot([x, ty - VS, zf], hash3(ix, 5, v) > 0.3 ? 0xe8d5ab : cavity);
    head.dot([x, ty, zf - VS], cavity);
  }
  // ears: shriveled, their own parts (they flap when it lurches)
  {
    const ep: M3 = [hr * 0.98, HC[1] + hr * 0.12, HC[2]];
    const ear = rb.pm('ear_l', 'head', ep);
    ear.ell([hr * 1.02, HC[1] + hr * 0.05, HC[2]], [VS * 1.2, hr * 0.2, hr * 0.14], mulCol(skin, 0.9));
    ear.ell([hr * 1.06, HC[1] + hr * 0.02, HC[2] - hr * 0.03], [VS * 0.8, hr * 0.1, hr * 0.07], mulCol(skin, 0.6));
    lumpy(ear.m, 2, 1, 7, 0.4);
  }
  coat(head, (x, y, z) => y > HC[1] + hr * 0.7 || (y > HC[1] + hr * 0.4 && z < HC[2] - hr * 0.3), crust);
  coat(head, (x, y, z) => Math.abs(noise.n3(x * 6, y * 6, z * 6 + 5)) < 0.012 && y > HC[1] - hr * 0.5, crack);
  if (v === 1) {
    // linen burial hood wrapped around the skull, frayed tails down the back
    for (let y = HC[1] - hr * 0.2; y <= HC[1] + hr * 1.3; y += VS) {
      for (let a = 0; a < Math.PI * 2; a += 0.05) {
        const t = (y - (HC[1] + hr * 0.4)) / (hr * 0.95);
        const rr = Math.sqrt(Math.max(0, 1 - t * t));
        const x = Math.sin(a) * (hr * 1.15) * rr;
        const z = HC[2] - hr * 0.15 + Math.cos(a) * (hr * 1.2) * rr;
        if (Math.cos(a) > 0.55 && y < HC[1] + hr * 0.6) continue; // face opening
        head.dot([x, y, z], linenZ);
      }
    }
    frayX(head, -hr * 0.7, hr * 0.7, HC[2] - hr * 1.32, HC[1] + hr * 0.2, m(0.08), m(0.24), linenX, 77);
  } else if (v === 0) {
    for (const [x, len] of [[-0.08, 0.14], [-0.02, 0.2], [0.05, 0.16], [0.1, 0.11]] as const)
      head.line([m(x), HC[1] + hr * 0.6, HC[2] - hr * 1.0], [m(x) * 1.2, HC[1] + hr * 0.6 - m(len), HC[2] - hr * 1.15], jit(0x3b2a1c, 0.1));
  }

  // jaw hangs open
  const jaw = rb.pm('jaw', 'head', [0, HC[1] - hr * 0.5, HC[2] + hr * 0.1]);
  jaw.rbox([-hr * 0.62, ty - hr * 0.55, HC[2] - hr * 0.3], [hr * 0.62, ty - VS * 2, zf - VS * 0.5], hr * 0.2, skin);
  for (let x = -hr * 0.45; x <= hr * 0.45 + 1e-6; x += VS) {
    const ix = Math.round(x / VS);
    jaw.dot([x, ty - VS * 2.5, zf - VS], hash3(ix, 8, v) > 0.25 ? (ix % 2 ? 0xe8d5ab : 0xcfb98c) : cavity);
    jaw.dot([x, ty - VS * 2.5, zf - VS * 2], cavity);
  }
  jaw.ell([0, ty - VS * 3, zf - VS * 4], [hr * 0.3, VS, hr * 0.2], mulCol(skin, 0.5)); // tongue remnant
  

  // ---------------------------------------------------------------- limbs details
  coat(arm, (x, y) => y > m(1.4), crust);
  // knobby elbow + wrist bones
  fore.ball([spec.elbow[0] + VS, spec.elbow[1], spec.elbow[2] - m(0.03)], m(0.04), boneC);
  fore.dot([spec.wrist[0] + m(0.05), spec.wrist[1], spec.wrist[2]], boneC);
  if (v !== 2) {
    // linen wraps on the forearm, slightly loose with a dangling end
    for (const yy of [0.88, 0.94, 1.0, 1.06]) {
      const y = m(yy);
      const t = (spec.elbow[1] - y) / (spec.elbow[1] - spec.wrist[1]);
      const cx = spec.elbow[0] + (spec.wrist[0] - spec.elbow[0]) * t, cz = spec.elbow[2] + (spec.wrist[2] - spec.elbow[2]) * t;
      fore.band([cx, y, cz], m(0.068), m(0.045), VS * 1.5, linenX);
    }
    fore.line([spec.wrist[0] + m(0.06), m(0.9), spec.wrist[2] - m(0.03)], [spec.wrist[0] + m(0.09), m(0.74), spec.wrist[2] - m(0.07)], linenX);
  }
  // knee caps + shin bone ridge
  shin.ell([spec.knee[0], spec.knee[1], spec.knee[2] + m(0.06)], [m(0.035), m(0.035), m(0.02)], boneC);
  shin.line([spec.knee[0], spec.knee[1] - m(0.06), spec.knee[2] + m(0.05)], [spec.ankle[0], spec.ankle[1] + m(0.06), spec.ankle[2] + m(0.045)], mulRGB(P.bone2, 0.9));
  coat(shin, (x, y) => y < m(0.16), crust);
  thigh.ball([spec.hip[0] + m(0.07), spec.hip[1] - m(0.04), spec.hip[2]], m(0.03), boneC); // hip bone jut

  rb.mirrorLR();

  // variant 2: right forearm stripped to bare bone with finger bones
  if (v === 2) {
    const fr = rb.sc('fore_r');
    const E: M3 = [-spec.elbow[0], spec.elbow[1], spec.elbow[2]];
    const W: M3 = [-spec.wrist[0], spec.wrist[1], spec.wrist[2]];
    fr.m.carveWhere((x, y) => (y + 0.5) * VS < spec.elbow[1] - m(0.04));
    fr.limb([E[0] - m(0.015), E[1] - m(0.04), E[2]], [W[0] - m(0.015), W[1] + m(0.02), W[2]], m(0.018), m(0.016), boneC);
    fr.limb([E[0] + m(0.02), E[1] - m(0.04), E[2] - m(0.01)], [W[0] + m(0.02), W[1] + m(0.02), W[2] - m(0.01)], m(0.015), m(0.014), mulRGB(P.bone2, 0.95));
    fr.ell([W[0], W[1], W[2]], [m(0.03), m(0.025), m(0.04)], boneC);
    for (let f = 0; f < 4; f++) {
      const z = W[2] - m(0.035) + f * m(0.024);
      fr.line([W[0], W[1] - m(0.02), z], [W[0] + m(0.004), W[1] - m(0.08), z + m(0.01)], boneC);
      fr.line([W[0] + m(0.004), W[1] - m(0.08), z + m(0.01)], [W[0] + m(0.01), W[1] - m(0.13), z + m(0.035)], boneC);
      fr.dot([W[0] + m(0.004), W[1] - m(0.08), z + m(0.01)], 0xfff4dc);
    }
    // torn skin cuff at the elbow
    for (let a = 0; a < Math.PI * 2; a += 0.3) fr.dot([E[0] + Math.sin(a) * m(0.06), E[1] - m(0.04) - hash3(Math.round(a * 10), 1, 1) * m(0.04), E[2] + Math.cos(a) * m(0.06)], skin);
  }

  // ---------------------------------------------------------------- quirks (wanted-poster personalities)
  if (v === 0) {
    // a little saguaro sprouted out of its right shoulder, flowering
    const tr = rb.sc('torso');
    const cb: M3 = [-m(0.22), m(1.58), m(0.13)];
    const cac = (x: number, y: number, z: number) => {
      const rib = ((x + z) & 1) === 0;
      return mulRGB(rib ? P.cactus1 : P.cactus2, 0.94 + hash3(x, y, z) * 0.1);
    };
    tr.limb(cb, [cb[0] - m(0.02), cb[1] + m(0.24), cb[2] + m(0.01)], m(0.035), m(0.03), cac);
    tr.ball([cb[0] - m(0.02), cb[1] + m(0.25), cb[2] + m(0.01)], m(0.03), cac);
    tr.tube([[cb[0] - m(0.01), cb[1] + m(0.1), cb[2]], [cb[0] - m(0.07), cb[1] + m(0.11), cb[2]], [cb[0] - m(0.08), cb[1] + m(0.18), cb[2]]], m(0.022), m(0.02), cac);
    for (let k = 0; k < 18; k++) {
      const a = hash3(k, 1, 7) * Math.PI * 2, yy = cb[1] + hash3(k, 2, 7) * m(0.24);
      tr.dot([cb[0] - m(0.02) + Math.sin(a) * m(0.042), yy, cb[2] + Math.cos(a) * m(0.042)], 0xf4ecd0); // spines
    }
    tr.dot([cb[0] - m(0.02), cb[1] + m(0.29), cb[2] + m(0.01)], 0xff6fa8).px([cb[0] - m(0.02), cb[1] + m(0.29), cb[2] + m(0.01)], 1, 0, 0, 0xffa6c8).px([cb[0] - m(0.02), cb[1] + m(0.29), cb[2] + m(0.01)], -1, 0, 0, 0xffa6c8).px([cb[0] - m(0.02), cb[1] + m(0.29), cb[2] + m(0.01)], 0, 0, 1, 0xffd23a);
    tr.ell([cb[0], cb[1] - m(0.01), cb[2]], [m(0.05), m(0.02), m(0.05)], crust); // dirt clump at the root
  } else if (v === 1) {
    // a vulture feather stuck through the hood
    const hd = rb.sc('head');
    const f0: M3 = [m(0.1), HC[1] + hr * 0.95, HC[2] - hr * 0.4];
    const f1: M3 = [m(0.26), HC[1] + hr * 2.1, HC[2] - hr * 1.0];
    hd.line(f0, f1, 0xf0e6d0);
    for (let k = 0; k <= 14; k++) {
      const t = k / 14;
      const p: M3 = [f0[0] + (f1[0] - f0[0]) * t, f0[1] + (f1[1] - f0[1]) * t, f0[2] + (f1[2] - f0[2]) * t];
      const w = Math.sin(t * Math.PI) * 2.2 + 0.6;
      for (let d = 1; d <= w; d++) {
        hd.px(p, d, 0, 0, t > 0.82 ? 0xe9e2d4 : mulRGB(0x2a221e, 0.9 + hash3(k, d, 1) * 0.25));
        if (d < w - 1) hd.px(p, -d, 0, 0, t > 0.82 ? 0xe9e2d4 : mulRGB(0x3a2e26, 0.9 + hash3(k, d, 2) * 0.2));
      }
    }
  } else {
    // a broken arrow lodged in the back + a red storm sash knotted on the left arm (Set's gangs)
    const tr = rb.sc('torso');
    const bf2 = T(m(1.4));
    const a0: M3 = [m(0.06), m(1.4), bf2.zc - bf2.rz + m(0.02)];
    const a1: M3 = [m(0.14), m(1.58), bf2.zc - bf2.rz - m(0.24)];
    tr.line(a0, a1, P.wood1);
    tr.line([a1[0], a1[1] - VS, a1[2]], [a1[0] + m(0.03), a1[1] - m(0.06), a1[2] + m(0.05)], P.setRed1);
    tr.line([a1[0] - VS, a1[1], a1[2]], [a1[0] - m(0.03), a1[1] - m(0.05), a1[2] + m(0.05)], 0xf0e6d0);
    const al = rb.sc('arm_l');
    const sh = spec.shoulder;
    al.band([sh[0] + m(0.025), m(1.36), sh[2] + m(0.035)], m(0.088), m(0.05), VS * 2, P.setRed1);
    al.line([sh[0] + m(0.1), m(1.36), sh[2]], [sh[0] + m(0.14), m(1.22), sh[2] - m(0.04)], P.setRed1);
    al.line([sh[0] + m(0.1), m(1.35), sh[2] + VS], [sh[0] + m(0.16), m(1.25), sh[2] + m(0.02)], P.setRed0);
  }
  // crude Set sigil daubed on the loincloth front in red ochre (all variants)
  {
    const pv = rb.sc('pelvis');
    const z = m(0.245);
    pv.line([-m(0.04), m(0.93), z], [0, m(0.965), z], 0x6a3a22).line([0, m(0.965), z], [m(0.05), m(0.935), z], 0x6a3a22);
    pv.line([-m(0.005), m(0.965), z], [-m(0.01), m(1.005), z], 0x6a3a22).line([m(0.015), m(0.965), z], [m(0.02), m(1.005), z], 0x6a3a22);
  }

  // ---------------------------------------------------------------- alpha mutation
  if (alpha) {
    const tr = rb.sc('torso');
    const f1 = T(m(1.45));
    // bone spikes erupting from the spine + one small crystal accent
    for (let y = m(1.2); y <= m(1.58); y += m(0.09)) hornM(tr, [0, y, T(y).zc - T(y).rz], [0, 0.5, -1], m(0.12 + (y - m(1.2)) * 0.35), m(0.03), tonal(P.bone1, P.bone0, P.bone3, cs, 6), [0, 0.6, 0]);
    void f1;
    const hd = rb.sc('head');
    for (const sx of [1, -1]) hornM(hd, [sx * hr * 0.6, HC[1] + hr * 0.8, HC[2] - hr * 0.3], [sx * 0.7, 1, -0.5], m(0.38), m(0.06), tonal(P.bone1, P.bone0, P.bone3, cs, 4), [sx * 0.2, -0.5, -0.9]);
    hornM(hd, [0, HC[1] + hr * 1.0, HC[2] - hr * 0.4], [0, 1, -0.2], m(0.24), m(0.045), tonal(P.bone2, P.bone0, P.bone3, cs, 5));
    for (const nm of ['fore_l', 'fore_r']) {
      const f = rb.sc(nm);
      const sx = nm.endsWith('_l') ? 1 : -1;
      for (let k = 0; k < 4; k++) hornM(f, [sx * spec.wrist[0], spec.wrist[1] - m(0.17), spec.wrist[2] - m(0.03) + k * m(0.025)], [0, -0.5, 1], m(0.12), m(0.014), jit(0x2a2018, 0.08), [0, -0.6, 0], false);
    }
  }

  // ---------------------------------------------------------------- accessories + face paint
  {
    const pv = rb.sc('pelvis');
    // frayed rope belt with a pouch and a tiny bird-skull charm
    rope(pv, loopPts([0, m(1.03), 0], m(0.262), m(0.178), 'xz', 30, 0.05, 4), VS * 0.9, [0xb89a62, 0x8a7046], { closed: true });
    rope(pv, [[m(0.08), m(1.03), m(0.17)], [m(0.1), m(1.02), m(0.172)]], VS * 0.9, [0xb89a62, 0x8a7046], { knot: true });
    pouchM(pv, [-m(0.18), m(0.97), m(0.13)], m(0.08), m(0.09), m(0.05), tonal(P.leather1, P.leather0, P.leather3, VS / 0.05, 3));
    pv.line([m(0.12), m(1.02), m(0.16)], [m(0.13), m(0.94), m(0.17)], 0x9a7e4a);
    skullCharmM(pv, [m(0.13), m(0.91), m(0.17)], VS * 1.4);
    const hd = rb.sc('head');
    // Set war paint: two red-ochre drips under each eye + a cracked-lip scar
    hd.line([-hr * 0.15, HC[1] - hr * 0.45, zf + VS * 0.2], [hr * 0.05, HC[1] - hr * 0.75, zf + VS * 0.2], 0x2a140c);
    if (v === 1) posterScrapM(rb.sc('torso'), [-m(0.08), m(1.33), T(m(1.33)).zc + T(m(1.33)).rz + VS], m(0.14), m(0.18)); // it's wanted too
  }
  realFinish(rb, 0.6, false);
  rb.sockM('hand_r', 'fore_r', [-spec.wrist[0], spec.wrist[1] - m(0.08), spec.wrist[2]]);
  rb.sockM('hand_l', 'fore_l', [spec.wrist[0], spec.wrist[1] - m(0.08), spec.wrist[2]]);
  rb.sockM('head_top', 'head', [0, HC[1] + hr * 1.05, HC[2] - hr * 0.2]);
  rb.sockM('back', 'torso', [0, m(1.35), T(m(1.35)).zc - T(m(1.35)).rz]);
  rb.sockM('chest', 'torso', [0, m(1.35), T(m(1.35)).zc + T(m(1.35)).rz]);
  rb.sockM('shoulder_l', 'torso', [m(0.3), m(1.62), m(0.18)]);
  rb.sockM('shoulder_r', 'torso', [-m(0.3), m(1.62), m(0.18)]);
  rb.sockM('hip_r', 'pelvis', [-m(0.22), m(0.95), 0]);
  return rb.build({ height: HC[1] + hr * 1.1, radius: m(0.3), kind: 'husk', alpha, headY: HC[1], scale: K });
}
