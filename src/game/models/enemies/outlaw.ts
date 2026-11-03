// Dune Outlaw: Set's posse, riding a battered sandboard. Built on Sundown's own
// skeleton figure (characters/skeleton.ts, 1/36) with weathered bones and ember
// eyes: a bandana mask over the nose and jaw, felt hat, an open linen shirt under
// a stiff duster (shoulders, lapels, stand-up collar, long tails as the swaying
// `coat` part), sleeves, gun belt with an empty holster, stitched boots with spurs
// and a revolver (`gun` on fore_r, `muzzle` socket). The rider stands on the
// `board`, a root-level part so the stance can yaw while the board tracks travel.
// v1 blue mask + black hat, v2 black mask + wide grey hat + striped poncho.
// Alpha: skull-painted black mask, tall hat, Set-red duster, gold-trimmed board.
import type { RigSpec } from '../../../engine/voxel/Rig';
import { defaultExpressions } from '../toon/humanoid';
import { EnemyOpts, liftSpec } from './human';
import { Fig, finish, figMeta, mix, mulRGB, clothC, frayStrip, Sc } from './figure/fig';
import { ageBones, emberEyes, hatG, addHat, HatKind, maskBandana, shirtG, dusterG, sleeveG, gunBeltG, bootG, revolverG, boardG, METAL, resolveC } from './figure/gear';

const BH = 2; // board top in voxels: the rider stands on it

/** woven poncho: a stepped tent over the shoulders, banded stripes, a fringed hem */
function ponchoG(F: Fig, base: number, seed: number) {
  const s: Sc = F.s('torso');
  const band = (y: number) => (y === 36 || y === 41 ? 0xe8d8b0 : y === 37 || y === 40 ? 0x9a2a1e : y === 38 || y === 39 ? 0x2e7a70 : base);
  for (let y = 32; y <= 45; y++) {
    const hw = y >= 45 ? 3.6 : y >= 44 ? 5.6 : y >= 42 ? 8.2 : y >= 38 ? 10.2 : 11.2;
    const zb = y >= 45 ? -4.2 : y >= 43 ? -6.4 : -7.6, zf = y >= 45 ? 2.2 : y >= 43 ? 4.4 : 5.6;
    for (let x = -12; x < 12; x++)
      for (let z = -9; z <= 7; z++) {
        const gx = x + 0.5, gz = z + 0.5;
        const zc = (zf + zb) / 2, zr = (zf - zb) / 2;
        const out = (Math.abs(gx) / hw) ** 3 + (Math.abs(gz - zc) / zr) ** 3 <= 1;
        const inn = (Math.abs(gx) / (hw - 1)) ** 3 + (Math.abs(gz - zc) / (zr - 1)) ** 3 <= 1;
        if (!out || (inn && y < 45)) continue;
        if (y === 45 && Math.abs(gx) < 2.2 && gz > -2.5 && gz < 1.5) continue; // neck hole
        const c = band(y);
        s.m.set(x, y, z, c === base ? mulRGB(base, ((x + y) & 3) === 0 ? 0.92 : 1) : c);
      }
  }
  for (let x = -11; x < 11; x += 2) {
    s.m.set(x, 31, 5, 0xd8c8a0).set(x, 31, -8, 0xd8c8a0);
    if ((x & 3) === 1) s.m.set(x, 30, 5, 0xc8b890);
  }
  void seed;
}

export function outlawRiderRig(o: EnemyOpts = {}): RigSpec {
  const alpha = !!o.alpha;
  const v = (((o.variant ?? 0) % 3) + 3) % 3;
  const F = new Fig();
  F.boneMirror('fore_r', 'fore_l'); // both fists: one on the gun, one balancing
  ageBones(F, { seed: 11 + v, tint: alpha ? 0x7a6a58 : 0xb89a6a, amt: alpha ? 0.32 : 0.22 });
  emberEyes(F, alpha ? 0xff2a10 : 0xff6a20);
  const looks: { hat: HatKind; felt: number; band: number; mask: number; coat: number }[] = [
    { hat: 'cowboy', felt: 0x7a5236, band: 0x8a2a20, mask: 0xa83424, coat: 0x7a5a3c },
    { hat: 'cowboy', felt: 0x2a2422, band: 0x3a5a8a, mask: 0x3a5a8a, coat: 0x5e4a3a },
    { hat: 'wide', felt: 0x7a746c, band: 0x1e1a18, mask: 0x2a2624, coat: 0xb0703a },
  ];
  const L = alpha ? { hat: 'tall' as HatKind, felt: 0x1e1a1a, band: 0x8a1e16, mask: 0x1e1a1a, coat: 0x8a2018 } : looks[v];
  const top = addHat(F, hatG(L.hat, L.felt, L.band, { bullet: v === 1, seed: v + 4 }));
  maskBandana(F, L.mask, { teeth: alpha, seed: v });
  const poncho = v === 2 && !alpha;
  shirtG(F, 0xd8c8a4, v);
  if (poncho) ponchoG(F, L.coat, v);
  else {
    const cp = dusterG(F, L.coat, alpha ? 0x1e1a1a : mulRGB(L.coat, 0.7), { seed: v, len: 13 });
    frayStrip(cp, -9, 8, -10, 16, 1, 2, clothC(L.coat, v + 9, { fold: 4 }), v + 3); // worn hem
    for (const s1 of [1, -1]) sleeveG(F, s1, clothC(L.coat, v + 2, { fold: 3, crease: mulRGB(L.coat, 0.8) }), { cuff: mulRGB(L.coat, 0.72) });
  }
  gunBeltG(F, 0x5a3a22, alpha ? METAL.gold : METAL.silver, { loops: !alpha, holster: true, seed: v + 2 });
  for (const s1 of [1, -1]) bootG(F, s1, alpha ? 0x221c1a : 0x3e2a1c, { seed: v + 3, spur: alpha ? METAL.gold : METAL.silver });
  revolverG(F, { metal: alpha ? METAL.steel : METAL.iron });
  const stripe = alpha ? 0x8a1e16 : [0xa83424, 0x3a5a8a, 0xb0703a][v];
  boardG(F, alpha ? 0x2a2220 : 0x8a6440, alpha ? METAL.gold[0] : 0x6a4a30, stripe, { gold: alpha, seed: v });
  finish(F);
  const spec = F.build(`outlaw_rider${alpha ? '_alpha' : ''}_v${v}`, figMeta(F, 'outlaw_rider', {
    alpha,
    variant: v,
    height: (top + BH) * F.vs,
    radius: 0.32,
    boardTop: BH * F.vs,
    headY: (F.J.eye[1] + BH) * F.vs,
    expressions: defaultExpressions(['neutral', 'angry', 'hurt', 'surprised', 'laugh', 'dead']),
    cloth: { duster: [L.coat, mulRGB(L.coat, 0.8), 0x3a2414], bandana: [L.mask, mulRGB(L.mask, 0.8), 0xf0e6d6] },
  }));
  // stand the rider on the board; the board stays a root-level part
  liftSpec(spec, BH, ['board']);
  const bp = spec.parts.find((p) => p.name === 'board');
  if (bp) delete bp.parent;
  return spec;
}
void mix;
void resolveC;
