// Egyptian accents — STYLE v2. Clean sandstone/limestone blocks with crisp
// mortar seams, painted lapis/gold/red accents, cartoon god statues with big
// heads. 1/12 m monuments, 1/16 m statues & totem, 1/24 m sarcophagus.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { Ramp } from '../style';
import { S, StaticModel, V3, PR, rngOf, meters, masonry, cylY, blob, seg, sandDrift, glyphPanel, toMeters, inCircle, mod, chunk } from './helpers';

const VS = 1 / 12;
const v = meters(VS);
const SS = PR.sandstone;
const LM = PR.lime;

/** tapered square column with masonry seams. half-width hw(t) */
function taperBlock(m: VoxelModel, y0: number, y1: number, hw: (t: number) => number, col: (x: number, y: number, z: number) => number) {
  for (let y = y0; y <= y1; y++) {
    const h = Math.round(hw((y - y0) / Math.max(1, y1 - y0)));
    for (let x = -h; x <= h; x++) for (let z = -h; z <= h; z++) m.set(x, y, z, col(x, y, z));
  }
}

// ---------------------------------------------------------------------------
export function obelisk(seed = 0, broken = false): StaticModel {
  const r = rngOf(seed, 3);
  const m = new VoxelModel('obelisk');
  const ms = masonry(SS, 8, 4, SS.dark, seed);
  // stepped plinth
  for (let s = 0; s < 3; s++) {
    const e = 14 - s * 2;
    for (let y = s * 3; y < s * 3 + 3; y++) for (let x = -e; x <= e; x++) for (let z = -e; z <= e; z++) m.set(x, y, z, y === s * 3 + 2 && (Math.abs(x) === e || Math.abs(z) === e) ? SS.hi : ms(x, y, z));
  }
  const H = v(7.4);
  const top = broken ? Math.round(H * r.range(0.4, 0.6)) : H;
  const hw = (t: number) => 6 - t * 2;
  taperBlock(m, 9, 9 + top, (t) => hw((t * top) / H), (x, _y, z) => (Math.abs(x) + Math.abs(z)) % 9 === 0 ? SS.shade : SS.base);
  // glyph columns on all faces (painted dark)
  const yTop = 9 + Math.min(top, H) - 6;
  glyphPanel(m, 'z+', -3, 3, 16, yTop, 8, seed + 1, { carve: true });
  glyphPanel(m, 'z-', -3, 3, 16, yTop, -8, seed + 2, { carve: true });
  glyphPanel(m, 'x+', -3, 3, 16, yTop, 8, seed + 3, { carve: true });
  glyphPanel(m, 'x-', -3, 3, 16, yTop, -8, seed + 4, { carve: true });
  if (!broken) {
    // gilded pyramidion
    for (let y = 0; y <= 5; y++) {
      const e = 4 - Math.round(y * 0.8);
      for (let x = -e; x <= e; x++) for (let z = -e; z <= e; z++) m.set(x, 9 + H + 1 + y, z, y >= 4 ? PR.gold.hi : x + z > 0 ? PR.gold.base : PR.gold.shade, VF.METAL);
    }
  } else {
    // jagged break + fallen top piece
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) if (mod(x * 3 + z * 5, 4) === 0) m.set(x, 9 + top + 1, z, SS.hi);
    const len = v(2.6);
    for (let k = 0; k <= len; k++)
      for (let a = -4; a <= 4; a++)
        for (let b = 0; b <= 7; b++) m.set(16 + k, b, a + 6, k === 0 ? SS.hi : mod(k + a, 9) === 0 ? SS.shade : SS.base);
    for (let k = 0; k < 6; k++) for (let a = -4 + k; a <= 4 - k; a++) for (let b = 0; b <= 7 - k; b++) m.set(16 + len + 1 + k, b, a + 6, PR.gold.base, VF.METAL);
  }
  sandDrift(m, 0, 0, 18, 18, 4, 0, seed);
  return S(m, VS);
}

export function column(seed = 0, broken = false): StaticModel {
  const r = rngOf(seed, 5);
  const m = new VoxelModel('column');
  const H = v(5);
  cylY(m, 0, 0, 0, 3, 8, LM.shade);
  cylY(m, 0, 0, 4, 4, 7.5, LM.hi);
  const top = broken ? Math.round(H * r.range(0.35, 0.65)) : H;
  for (let y = 5; y <= Math.min(top, H - 10); y++) {
    const band = y > H - 22 && y < H - 12;
    const rr = 6 - (y / H) * 0.6;
    for (let x = -7; x <= 7; x++)
      for (let z = -7; z <= 7; z++) {
        if (!inCircle(x, z, rr)) continue;
        const outer = !inCircle(x, z, rr - 1);
        const a = Math.atan2(z, x);
        const flute = outer && mod(Math.round((a / (Math.PI * 2)) * 16), 2) === 0;
        let c = flute ? LM.shade : LM.base;
        if (band && outer) c = mod(y, 4) === 0 ? PR.gold.base : mod(y, 4) === 2 ? PR.lapis.base : PR.red.base;
        m.set(x, y, z, c);
      }
  }
  if (!broken) {
    // papyrus/lotus capital flaring out
    for (let y = 0; y <= 9; y++) {
      const rr = 6 + Math.sin((y / 9) * Math.PI * 0.5) * 4;
      for (let x = -11; x <= 11; x++)
        for (let z = -11; z <= 11; z++) {
          if (!inCircle(x, z, rr)) continue;
          const outer = !inCircle(x, z, rr - 1);
          if (!outer && y < 8) continue;
          const a = Math.atan2(z, x);
          const petal = mod(Math.round((a / (Math.PI * 2)) * 10), 2) === 0;
          m.set(x, H - 10 + y, z, outer ? (petal ? PR.turquoise.base : PR.paintGreen.base) : LM.hi);
        }
    }
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) m.set(x, H, z, LM.base).set(x, H + 1, z, Math.abs(x) === 10 || Math.abs(z) === 10 ? LM.shade : LM.hi);
  } else {
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) if (inCircle(x, z, 5) && mod(x + z * 2, 3) === 0) m.set(x, top + 1, z, LM.hi);
    // fallen drum
    for (let k = 0; k < 9; k++) for (let a = -5; a <= 5; a++) for (let b = -5; b <= 5; b++) if (inCircle(a, b, 5)) m.set(14 + k, 5 + b, a + 4, k === 0 || k === 8 ? LM.hi : LM.base);
  }
  sandDrift(m, 0, 0, 12, 12, 3, 0, seed);
  return S(m, VS);
}

/** reclining sphinx with nemes headdress on a plinth, 1/10 */
export function sphinx(): StaticModel {
  const vs = 1 / 10;
  const m = new VoxelModel('sphinx');
  const ms = masonry(SS, 10, 4, SS.dark, 3);
  // plinth
  for (let x = -22; x <= 22; x++) for (let z = -52; z <= 52; z++) for (let y = 0; y <= 6; y++) m.set(x, y, z, y === 6 && (Math.abs(x) === 22 || Math.abs(z) === 52) ? SS.hi : ms(x, y, z));
  // lion body: long rounded box with a raised back and haunches
  for (let z = -44; z <= 12; z++)
    for (let x = -15; x <= 15; x++)
      for (let y = 7; y <= 30; y++) {
        const back = 26 + Math.round(Math.sin(((z + 44) / 56) * Math.PI) * 3);
        const rx = 15 - Math.max(0, y - back + 6) * 1.2;
        if (y > back || Math.abs(x) > rx) continue;
        m.set(x, y, z, SS.base);
      }
  for (const sx of [-1, 1]) blob(m, sx * 12, 15, -36, 6, 9, 10, SS.base);
  // ribs suggestion on the flank
  for (const sx of [-1, 1]) for (let z = -28; z <= 0; z += 6) for (let y = 12; y <= 22; y++) if (m.has(sx * 15, y, z)) m.set(sx * 15, y, z, SS.shade);
  // forelegs & paws extended forward
  for (const sx of [-1, 1]) {
    for (let z = -6; z <= 34; z++) for (let x = sx * 5; Math.abs(x) <= 14; x += sx) for (let y = 7; y <= 13; y++) m.set(x, y, z, z > 28 ? (mod(x, 3) === 0 ? SS.shade : SS.hi) : SS.base);
  }
  // chest + neck
  m.box(-11, 7, 6, 11, 30, 18, SS.base);
  // head: human face block with nemes headdress (lapis & gold stripes)
  const hx = 0, hy = 34, hz = 16;
  m.box(hx - 9, hy - 4, hz - 6, hx + 9, hy + 14, hz + 6, SS.base);
  for (let y = hy - 4; y <= hy + 16; y++)
    for (let x = -13; x <= 13; x++)
      for (let z = hz - 9; z <= hz + 4; z++) {
        const inHood = (y > hy + 12 && Math.abs(x) <= 11 - Math.max(0, y - hy - 14) * 2) || (Math.abs(x) >= 10 && Math.abs(x) <= 13 - Math.max(0, hy - y) / 3 && y < hy + 14);
        if (!inHood) continue;
        if (Math.abs(x) <= 9 && z > hz + 3 && y < hy + 13) continue;
        m.set(x, y, z, mod(y, 3) === 0 ? PR.gold.base : PR.lapis.base, mod(y, 3) === 0 ? VF.METAL : 0);
      }
  // lappets down the chest
  for (const sx of [-1, 1]) for (let y = hy - 14; y <= hy - 3; y++) for (let x = 8; x <= 12; x++) m.set(sx * x, y, hz + 4, mod(y, 3) === 0 ? PR.gold.base : PR.lapis.base, mod(y, 3) === 0 ? VF.METAL : 0);
  // face: eyes with kohl, nose, mouth, beard
  for (const sx of [-1, 1]) {
    m.box(hx + sx * 4 - 2, hy + 6, hz + 6, hx + sx * 4 + 2, hy + 7, hz + 6, PR.ink.base);
    m.set(hx + sx * 4, hy + 6, hz + 7, PR.white.base);
    m.box(hx + sx * 7, hy + 6, hz + 6, hx + sx * 7, hy + 6, hz + 6, PR.ink.base);
  }
  m.box(hx - 1, hy + 1, hz + 7, hx + 1, hy + 5, hz + 8, SS.hi);
  m.box(hx - 3, hy - 1, hz + 7, hx + 3, hy - 1, hz + 7, SS.dark);
  m.box(hx - 2, hy - 12, hz + 5, hx + 2, hy - 5, hz + 7, PR.lapis.shade);
  // uraeus cobra on the brow
  m.box(hx - 1, hy + 14, hz + 6, hx + 1, hy + 17, hz + 8, PR.gold.hi, VF.METAL);
  // tail curled along the flank
  for (let z = -46; z <= -20; z++) m.set(16, 8 + Math.round(Math.sin((z + 46) / 26 * Math.PI) * 2), z, SS.shade);
  // body top highlights
  m.forEach((x, y, z, c) => {
    if (c === SS.base && !m.has(x, y + 1, z)) m.set(x, y, z, SS.hi);
  });
  sandDrift(m, 26, -30, 8, 22, 6, 0, 7);
  return S(m, vs);
}

/** temple pylon gate: two tapered towers, lintel with winged sun, flag poles, reliefs. 1/12 */
export function templeGate(seed = 0): StaticModel & { meta: { flagAnchors: V3[]; entrance: [number, number] } } {
  const m = new VoxelModel('temple_gate');
  const ms = masonry(LM, 10, 5, LM.dark, seed);
  const gateHalf = v(1.9);
  const towerIn = gateHalf + 6;
  const W0 = v(5.6), W1 = v(4.6);
  const H = v(8.5), D = v(2.4);
  for (const sx of [-1, 1]) {
    for (let y = 0; y <= H; y++) {
      const t = y / H;
      const w = Math.round(W0 + (W1 - W0) * t);
      const d = Math.round(D * (1 - t * 0.25));
      for (let k = 0; k <= w; k++)
        for (let z = -d; z <= d; z++) {
          const x = sx * (towerIn + k);
          const inner = k > 2 && k < w - 2 && Math.abs(z) < d - 2 && y < H - 2 && y > 0;
          if (inner) {
            if (k === 3 || k === w - 3 || Math.abs(z) === d - 3 || y === H - 3 || y === 1) m.set(x, y, z, LM.shade);
            continue;
          }
          const edge = k === w || y === H;
          m.set(x, y, z, edge ? LM.hi : ms(x, y, z));
        }
    }
    // cavetto cornice
    for (let k = -1; k <= W1 + 2; k++) for (let z = -D - 2; z <= D + 2; z++) for (let y = H + 1; y <= H + 4; y++) m.set(sx * (towerIn + k), y, z, y === H + 4 ? LM.hi : y === H + 1 ? PR.paintYellow.base : LM.base);
    // two framed glyph columns per tower, painted
    for (const c of [8, 20]) {
      const u0 = sx * (towerIn + c);
      const lo = Math.min(u0, u0 + sx * 6), hi = Math.max(u0, u0 + sx * 6);
      for (let y = 14; y <= H - 14; y++) for (const u of [lo - 1, hi + 1]) m.set(u, y, Math.round(D * (1 - (y / H) * 0.25)), PR.lapis.shade);
      glyphPanel(m, 'z+', lo, hi, 16, H - 16, D + 1, seed + c + (sx > 0 ? 1 : 2), { carve: false, color: c === 8 ? PR.lapis.base : PR.red.shade });
    }
  }
  // door jambs + lintel + winged sun disk
  for (const sx of [-1, 1]) for (let y = 0; y <= v(5.2); y++) for (let z = -D + 4; z <= D - 4; z++) for (let k = 0; k < 6; k++) m.set(sx * (gateHalf + k), y, z, LM.base);
  for (let x = -gateHalf - 6; x <= gateHalf + 6; x++) for (let z = -D + 4; z <= D - 2; z++) for (let y = v(5.2); y <= v(6.4); y++) m.set(x, y, z, y === v(6.4) ? LM.hi : LM.base);
  const sunY = v(5.8), sz = D - 1;
  for (let x = -gateHalf - 4; x <= gateHalf + 4; x++) {
    const wing = Math.abs(x) > 3;
    const span = wing ? Math.max(0, 3 - Math.floor((Math.abs(x) - 3) / 5)) : 0;
    if (wing) for (let y = sunY - span; y <= sunY + 1; y++) m.set(x, y, sz, mod(Math.abs(x), 3) === 0 ? PR.lapis.base : mod(Math.abs(x), 3) === 1 ? PR.turquoise.base : PR.gold.base, VF.METAL);
  }
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) if (inCircle(x, y, 3)) m.set(x, sunY + y, sz + 1, PR.red.base);
  // flag poles in slots on the tower fronts
  const flags: V3[] = [];
  for (const sx of [-1, 1])
    for (const k of [6, W0 - 10]) {
      const x = sx * (towerIn + k);
      m.box(x, 0, D + 2, x + 1, H + 18, D + 3, PR.woodDark.base);
      for (let u = 1; u <= 10; u++) for (let w = 0; w < 5; w++) m.set(x + 1 + u, H + 16 - w, D + 2, w === 0 ? PR.red.hi : PR.red.base);
      flags.push([x, H + 18, D + 2]);
    }
  sandDrift(m, -towerIn - W0, 0, 16, 26, 8, 0, seed);
  sandDrift(m, towerIn + W0, 0, 14, 22, 6, 0, seed + 1);
  const ent: V3 = [0, 0, D + v(2)];
  const e = toMeters(m, VS, ent);
  return { model: m, voxelSize: VS, meta: { flagAnchors: flags.map((p) => toMeters(m, VS, p)), entrance: [e[0], e[2]] } };
}

/** fallen pyramidion capstone half in the sand, gilded tip. 1/16 */
export function capstone(): StaticModel {
  const vs = 1 / 16;
  const m = new VoxelModel('capstone');
  const H = 24;
  for (let y = 0; y <= H; y++) {
    const e = Math.round(18 * (1 - y / H));
    for (let x = -e; x <= e; x++)
      for (let z = -e; z <= e; z++) {
        const outer = Math.abs(x) === e || Math.abs(z) === e;
        const gold = y > H - 8;
        m.set(x, y, z, gold ? (x + z > 0 ? PR.gold.hi : PR.gold.base) : outer ? (mod(y, 4) === 0 ? SS.shade : z > 0 || x > 0 ? SS.hi : SS.base) : SS.base, gold ? VF.METAL : 0);
      }
  }
  glyphPanel(m, 'z+', -8, 8, 3, 13, 18, 4, { carve: true });
  sandDrift(m, 0, 0, 22, 22, 6, 0, 2);
  return S(m, vs);
}

/** crumbling mud-brick walls with an arched window. 1/12 */
export function mudbrickRuin(seed = 0): StaticModel {
  const r = rngOf(seed, 9);
  const m = new VoxelModel('mudbrick_ruin');
  const brick = masonry(PR.adobe, 6, 3, PR.adobe.dark, seed);
  const L = r.int(40, 56), H = r.int(26, 38);
  const wall = (x0: number, z0: number, len: number, along: 'x' | 'z') => {
    for (let k = 0; k <= len; k++) {
      // stepped broken top profile
      const top = Math.round(H - Math.abs(Math.sin(k * 0.21 + seed)) * 8 - (k > len * 0.7 ? (k - len * 0.7) * 1.2 : 0));
      for (let y = 0; y <= top; y++)
        for (let t = 0; t < 4; t++) {
          const x = along === 'x' ? x0 + k : x0 + t, z = along === 'x' ? z0 + t : z0 + k;
          m.set(x, y, z, y === top ? PR.adobe.hi : brick(x, y, z));
        }
    }
  };
  wall(-L / 2, 0, L, 'x');
  wall(-L / 2, -r.int(20, 30), r.int(20, 30), 'z');
  // arched window
  const wx = r.int(-8, 6);
  for (let x = wx; x < wx + 8; x++)
    for (let y = 10; y < 20 + (Math.abs(x - wx - 3.5) < 2.5 ? 2 : 0); y++) for (let t = 0; t < 4; t++) m.del(x, y, t);
  // a fallen pile of bricks
  for (let i = 0; i < 9; i++) chunk(m, L / 2 + 2 + (i % 3) * 3, Math.floor(i / 3) * 2, 4 + (i % 2), L / 2 + 4 + (i % 3) * 3, Math.floor(i / 3) * 2 + 1, 6 + (i % 2), PR.adobe, 0);
  sandDrift(m, 0, 6, L * 0.6, 12, 6, 0, seed);
  return S(m, VS);
}

// ---------------------------------------------------------------------------
// god statues (1/16): standing figure on a plinth, painted accents, per-god head
// ---------------------------------------------------------------------------
export type GodId = 'ra' | 'thoth' | 'bastet' | 'horus' | 'sekhmet' | 'anubis' | 'set' | 'serket';

function godHead(m: VoxelModel, god: GodId, cx: number, y0: number, cz: number) {
  // head block: 14 wide, 14 tall, 12 deep — big cartoon head
  const skin: Ramp = god === 'anubis' ? PR.jackal : god === 'set' ? PR.setRed : god === 'bastet' ? { base: 0x3c3640, shade: 0x2a2630, hi: 0x58505e, dark: 0x1a161e } : SS;
  const isBird = god === 'ra' || god === 'horus' || god === 'thoth';
  if (god === 'serket') {
    // woman's face with lapis wig and a scorpion crown
    m.box(cx - 6, y0, cz - 5, cx + 6, y0 + 12, cz + 6, SS.base);
    for (let y = y0 - 4; y <= y0 + 14; y++) for (let x = -8; x <= 8; x++) for (let z = -7; z <= 3; z++) if (Math.abs(x) >= 7 || y >= y0 + 13 || z <= -6) m.set(cx + x, y, cz + z, mod(y, 3) === 0 ? PR.lapis.shade : PR.lapis.base);
    for (const sx of [-1, 1]) m.box(cx + sx * 3 - 1, y0 + 7, cz + 7, cx + sx * 3 + 1, y0 + 7, cz + 7, PR.ink.base);
    m.box(cx - 2, y0 + 3, cz + 7, cx + 2, y0 + 3, cz + 7, PR.red.base);
    // scorpion on top
    m.box(cx - 3, y0 + 15, cz - 3, cx + 3, y0 + 17, cz + 3, PR.gold.base, VF.METAL);
    for (let k = 0; k < 7; k++) m.box(cx, y0 + 17 + Math.min(k, 4), cz - 3 - k + Math.max(0, k - 4) * 2, cx, y0 + 18 + Math.min(k, 4), cz - 3 - k + Math.max(0, k - 4) * 2, PR.gold.hi, VF.METAL);
    for (const sx of [-1, 1]) m.box(cx + sx * 4, y0 + 16, cz + 3, cx + sx * 5, y0 + 17, cz + 6, PR.gold.base, VF.METAL);
    return;
  }
  m.box(cx - 6, y0, cz - 6, cx + 6, y0 + 11, cz + 5, skin.base);
  for (const [x, y, z] of [[-6, 11, -6], [6, 11, -6], [-6, 11, 5], [6, 11, 5], [-6, 0, 5], [6, 0, 5]]) m.del(cx + x, y0 + y, cz + z);
  m.box(cx - 5, y0 + 12, cz - 5, cx + 5, y0 + 12, cz + 4, skin.hi);
  // eyes: kohl-lined
  for (const sx of [-1, 1]) {
    m.box(cx + sx * 3 - 1, y0 + 6, cz + 6, cx + sx * 3 + 1, y0 + 7, cz + 6, PR.ink.base);
    m.set(cx + sx * 3, y0 + 7, cz + 6, god === 'anubis' || god === 'bastet' ? PR.gold.hi : PR.white.base);
    m.set(cx + sx * 5, y0 + 6, cz + 6, PR.ink.base);
  }
  if (isBird) {
    if (god === 'thoth') {
      // long curved ibis beak
      for (let k = 0; k < 12; k++) m.box(cx - 1, y0 + 4 - Math.floor(k * k / 18), cz + 6 + k, cx + 1, y0 + 5 - Math.floor(k * k / 18), cz + 6 + k, k > 8 ? PR.ink.base : PR.ink.shade);
    } else {
      // short hooked falcon beak
      m.box(cx - 2, y0 + 2, cz + 6, cx + 2, y0 + 5, cz + 9, PR.gold.shade, VF.METAL);
      m.box(cx - 1, y0, cz + 8, cx + 1, y0 + 2, cz + 9, PR.gold.dark, VF.METAL);
      for (const sx of [-1, 1]) m.box(cx + sx * 4, y0 + 3, cz + 6, cx + sx * 4, y0 + 5, cz + 6, PR.ink.base);
    }
    // lapis wig (lappets)
    for (const sx of [-1, 1]) for (let y = y0 - 6; y <= y0 + 9; y++) m.box(cx + sx * 7, y, cz - 4, cx + sx * 8, y, cz + 3, mod(y, 3) === 0 ? PR.gold.base : PR.lapis.base, mod(y, 3) === 0 ? VF.METAL : 0);
  } else {
    // animal snout
    const snoutLen = god === 'anubis' ? 7 : god === 'set' ? 8 : 4;
    for (let k = 1; k <= snoutLen; k++) {
      const w = god === 'bastet' || god === 'sekhmet' ? 3 : 2;
      const yb = god === 'set' ? y0 + 2 - Math.floor(k / 3) : y0 + 1;
      m.box(cx - w, yb, cz + 5 + k, cx + w, y0 + 5 - (god === 'anubis' ? Math.floor(k / 3) : 0), cz + 5 + k, k === snoutLen ? skin.shade : skin.base);
    }
    m.box(cx - 1, y0 + 4, cz + 5 + snoutLen + 1, cx + 1, y0 + 5, cz + 5 + snoutLen + 1, PR.ink.base);
    // ears
    const earH = god === 'anubis' ? 11 : god === 'bastet' ? 7 : god === 'set' ? 9 : 4;
    for (const sx of [-1, 1]) {
      for (let y = 0; y < earH; y++) {
        const w = god === 'set' ? 2 : Math.max(1, 3 - Math.floor((y * 3) / earH));
        m.box(cx + sx * 4 - (sx < 0 ? w - 1 : 0), y0 + 12 + y, cz - 1, cx + sx * 4 + (sx > 0 ? w - 1 : 0), y0 + 12 + y, cz + 1, y === earH - 1 && god === 'set' ? skin.hi : skin.base);
        if (god !== 'set' && y < earH - 2) m.set(cx + sx * 4, y0 + 12 + y, cz + 2, PR.red.shade);
      }
      if (god === 'set') m.box(cx + sx * 4 - 1, y0 + 12 + earH, cz - 1, cx + sx * 4 + 2, y0 + 13 + earH, cz + 1, skin.hi);
    }
    if (god === 'sekhmet') for (let y = y0 - 5; y <= y0 + 11; y++) for (let x = -9; x <= 9; x++) for (let z = -7; z <= 0; z++) if (Math.abs(x) >= 7 && !m.has(cx + x, y, cz + z)) m.set(cx + x, y, cz + z, mod(y + x, 3) === 0 ? PR.paintYellow.shade : PR.paintYellow.base);
    if (god === 'bastet') for (const sx of [-1, 1]) m.box(cx + sx * 7, y0 + 3, cz, cx + sx * 7, y0 + 5, cz, PR.gold.base, VF.METAL);
    if (god === 'anubis') for (const sx of [-1, 1]) for (let y = y0 - 5; y <= y0 + 6; y++) m.box(cx + sx * 7, y, cz - 4, cx + sx * 7, y, cz + 2, mod(y, 3) === 0 ? PR.gold.base : PR.lapis.base, mod(y, 3) === 0 ? VF.METAL : 0);
  }
  // crowns
  if (god === 'ra' || god === 'sekhmet') {
    for (let x = -5; x <= 5; x++) for (let y = -5; y <= 5; y++) if (inCircle(x, y, 5)) m.set(cx + x, y0 + 19 + y, cz - 2, inCircle(x, y, 3) ? PR.red.base : PR.gold.base, VF.METAL);
    m.box(cx - 1, y0 + 13, cz + 3, cx + 1, y0 + 16, cz + 5, PR.gold.hi, VF.METAL);
  }
  if (god === 'horus') {
    // double crown: white cone inside red
    for (let y = 0; y <= 12; y++) {
      const e = 5 - Math.floor(y / 3);
      for (let x = -e; x <= e; x++) for (let z = -e; z <= e; z++) m.set(cx + x, y0 + 13 + y, cz - 1 + z, PR.white.base);
    }
    for (let y = 0; y <= 4; y++) for (let x = -6; x <= 6; x++) for (let z = -6; z <= 5; z++) if (Math.abs(x) === 6 || Math.abs(z) >= 5) m.set(cx + x, y0 + 12 + y, cz - 1 + z, PR.red.base);
  }
  if (god === 'thoth') for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) if (inCircle(x, y, 4) && !inCircle(x - 2, y, 3)) m.set(cx + x, y0 + 17 + y, cz - 2, PR.silver.base, VF.METAL);
}

export function godStatue(god: GodId = 'ra'): StaticModel {
  const vs = 1 / 16;
  const m = new VoxelModel('statue_' + god);
  const ms = masonry(SS, 8, 4, SS.dark, god.length);
  // plinth with a name cartouche
  for (let y = 0; y <= 9; y++) for (let x = -14; x <= 14; x++) for (let z = -12; z <= 12; z++) m.set(x, y, z, y === 9 ? SS.hi : ms(x, y, z));
  glyphPanel(m, 'z+', -8, 8, 2, 8, 12, god.charCodeAt(0), { carve: true });
  const B = 10;
  // feet (left foot forward)
  m.box(-6, B, -2, -2, B + 2, 6, SS.base);
  m.box(2, B, -6, 6, B + 2, 2, SS.base);
  // legs
  m.box(-6, B + 3, -2, -2, B + 18, 2, SS.base);
  m.box(2, B + 3, -4, 6, B + 18, 0, SS.base);
  // kilt (white with gold belt & pleats)
  for (let y = B + 14; y <= B + 24; y++) for (let x = -8; x <= 8; x++) for (let z = -5; z <= 4; z++) if (Math.abs(x) === 8 || z === -5 || z === 4 || y === B + 14) m.set(x, y, z, y === B + 24 ? PR.gold.base : mod(x, 3) === 0 ? PR.linen.shade : PR.linen.base, y === B + 24 ? VF.METAL : 0);
  // torso
  m.box(-8, B + 25, -4, 8, B + 38, 4, SS.base);
  m.box(-9, B + 36, -4, 9, B + 38, 4, SS.base);
  // broad collar (wesekh)
  for (let x = -9; x <= 9; x++) for (let y = B + 33; y <= B + 38; y++) {
    const band = mod(y, 2) === 0 ? PR.turquoise.base : y === B + 33 ? PR.gold.base : PR.lapis.base;
    if (Math.abs(x) <= 9 - Math.max(0, B + 35 - y)) m.set(x, y, 5, band, band === PR.gold.base ? VF.METAL : 0);
  }
  // arms: left holds a staff, right holds an ankh across the chest
  m.box(-12, B + 24, -2, -9, B + 38, 2, SS.base);
  m.box(9, B + 30, -2, 12, B + 38, 2, SS.base);
  m.box(4, B + 28, 2, 12, B + 31, 6, SS.base);
  for (let y = B + 28; y <= B + 34; y++) m.set(5, y, 7, PR.gold.base, VF.METAL);
  for (let x = 3; x <= 7; x++) m.set(x, B + 34, 7, PR.gold.base, VF.METAL);
  for (const [x, y] of [[4, B + 36], [6, B + 36], [5, B + 37], [4, B + 35], [6, B + 35]]) m.set(x, y, 7, PR.gold.hi, VF.METAL);
  m.box(-11, B + 1, 3, -10, B + 52, 4, PR.woodDark.base);
  m.box(-12, B + 50, 2, -9, B + 52, 5, PR.gold.base, VF.METAL);
  // gold bracelets
  for (const x of [-12, 9]) m.box(x, B + 31, -2, x + 3, B + 32, 2, PR.gold.base, VF.METAL);
  // neck + head
  m.box(-3, B + 39, -2, 3, B + 41, 2, SS.base);
  godHead(m, god, 0, B + 42, -1);
  // tops get the highlight tone
  m.forEach((x, y, z, c) => {
    if (c === SS.base && !m.has(x, y + 1, z)) m.set(x, y, z, SS.hi);
  });
  sandDrift(m, 0, 0, 18, 16, 4, 0, 3);
  return S(m, vs);
}

/** limestone wall slab with painted glyph registers and a cracked broken edge. 1/12 */
export function hieroglyphWall(seed = 0): StaticModel {
  const r = rngOf(seed, 15);
  const m = new VoxelModel('hieroglyph_wall');
  const L = r.int(44, 60), H = r.int(34, 44);
  const ms = masonry(LM, 12, 6, LM.shade, seed);
  for (let x = -L / 2; x <= L / 2; x++) {
    const broken = x > L / 2 - 12 ? Math.round((x - (L / 2 - 12)) * 1.6) : 0;
    for (let y = 0; y <= H - broken; y++) for (let z = 0; z < 5; z++) m.set(x, y, z, y === H - broken ? LM.hi : ms(x, y, z));
  }
  // painted registers: coloured glyph bands separated by blue lines
  const cols = [PR.lapis.base, PR.red.base, PR.ink.base, PR.turquoise.shade];
  for (let reg = 0; reg < 3; reg++) {
    const yTop = H - 6 - reg * 10;
    for (let x = -L / 2 + 3; x <= L / 2 - 3; x++) if (m.has(x, yTop + 2, 4)) m.set(x, yTop + 2, 4, PR.lapis.shade);
    glyphPanel(m, 'z+', -L / 2 + 4, L / 2 - 14, yTop - 6, yTop, 5, seed * 7 + reg, { carve: false, color: cols[reg % cols.length] });
  }
  sandDrift(m, 0, 4, L * 0.55, 8, 6, 0, seed);
  return S(m, VS);
}

/** grapple totem: stone pillar topped by a carved scorpion whose tail holds an iron ring. anchor = ring centre (m). 1/16 */
export function scorpionTotem(): StaticModel & { anchor: V3 } {
  const vs = 1 / 16;
  const m = new VoxelModel('scorpion_totem');
  const ms = masonry(SS, 6, 4, SS.dark, 3);
  for (let y = 0; y <= 4; y++) for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) m.set(x, y, z, y === 4 ? SS.hi : ms(x, y, z));
  const PH = 34;
  for (let y = 5; y <= PH; y++) for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) m.set(x, y, z, ms(x, y, z));
  glyphPanel(m, 'z+', -3, 3, 8, PH - 3, 5, 11, { carve: true });
  glyphPanel(m, 'x+', -3, 3, 8, PH - 3, 5, 12, { carve: true });
  for (let y = PH + 1; y <= PH + 3; y++) for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) m.set(x, y, z, y === PH + 3 ? SS.hi : SS.base);
  // scorpion: body, claws forward (+Z), tail arching up behind
  const by = PH + 4;
  m.box(-4, by, -6, 4, by + 3, 4, SS.base);
  m.box(-3, by + 4, -5, 3, by + 4, 3, SS.hi);
  for (const sx of [-1, 1]) {
    m.box(sx * 4, by, 4, sx * 5, by + 2, 9, SS.base);
    m.box(sx * 3, by, 9, sx * 7, by + 3, 13, SS.base);
    m.box(sx * 3, by + 1, 13, sx * 4, by + 2, 15, SS.shade);
    m.box(sx * 6, by + 1, 13, sx * 7, by + 2, 15, SS.shade);
    for (let l = 0; l < 3; l++) seg(m, [sx * 4, by + 1, -4 + l * 3], [sx * 9, by - 3, -5 + l * 3], 1, SS.shade);
  }
  for (const sx of [-1, 1]) m.box(sx * 2, by + 2, 5, sx * 2, by + 2, 5, PR.ink.base);
  const tail: V3[] = [[0, by + 2, -6], [0, by + 6, -10], [0, by + 12, -12], [0, by + 18, -11], [0, by + 23, -7], [0, by + 25, -2]];
  for (let i = 0; i < tail.length - 1; i++) seg(m, tail[i], tail[i + 1], 3 - (i > 3 ? 1 : 0), i % 2 ? SS.base : SS.hi);
  // iron ring held at the tail tip
  const rc: V3 = [0, by + 25, 4];
  for (let a = 0; a < 48; a++) {
    const t = (a / 48) * Math.PI * 2;
    const y = Math.round(rc[1] + Math.sin(t) * 5), z = Math.round(rc[2] + Math.cos(t) * 5);
    m.box(-1, y, z, 1, y, z, PR.iron.base, VF.METAL);
  }
  m.box(-1, by + 24, -2, 1, by + 26, 0, PR.iron.dark, VF.METAL);
  // the one rune line (painted, not glowing)
  for (let y = 8; y < PH - 2; y += 2) m.set(0, y, 6, PR.serket.base);
  sandDrift(m, 0, 0, 12, 12, 3, 0, 5);
  return { ...S(m, vs), anchor: toMeters(m, vs, rc) };
}

export interface SarcophagusParts {
  base: VoxelModel;
  lid: VoxelModel;
  voxelSize: number;
  /** build base with this pivot (bottom centre) */
  basePivot: V3;
  /** build lid with this pivot; place it at (lidPivot - basePivot) * voxelSize; slide/lift to open */
  lidPivot: V3;
}

/** anthropoid gold & lapis sarcophagus on a dais, ≈2.6 m long, 1/24. Head toward +Z. */
export function sarcophagusParts(): SarcophagusParts {
  const vs = 1 / 24;
  const base = new VoxelModel('sarcophagus_base');
  const lid = new VoxelModel('sarcophagus_lid');
  // dais
  for (let x = -18; x <= 18; x++) for (let z = -36; z <= 36; z++) for (let y = 0; y <= 4; y++) base.set(x, y, z, y === 4 ? SS.hi : masonry(SS, 8, 3, SS.dark, 1)(x, y, z));
  // coffin box (tapered toward the feet)
  const halfW = (z: number) => Math.round(12 - Math.max(0, -z - 10) * 0.18 + (z > 20 ? -(z - 20) * 0.2 : 0));
  const BH = 14;
  for (let z = -30; z <= 30; z++) {
    const hw = halfW(z);
    for (let x = -hw; x <= hw; x++)
      for (let y = 5; y <= 5 + BH; y++) {
        const wall = Math.abs(x) === hw || Math.abs(z) === 30 || y === 5;
        if (!wall) {
          if (y === 6) base.set(x, y, z, PR.socket.base);
          continue;
        }
        const band = mod(y, 4) === 0;
        base.set(x, y, z, y === 5 + BH ? PR.gold.hi : band ? PR.gold.base : mod(z, 6) === 0 ? PR.lapis.shade : PR.lapis.base, band || y === 5 + BH ? VF.METAL : 0);
      }
  }
  // lid: domed body with face, crossed arms, wings
  const LY = 6 + BH;
  for (let z = -30; z <= 30; z++) {
    const hw = halfW(z);
    for (let x = -hw; x <= hw; x++) {
      const dome = Math.round(Math.sqrt(Math.max(0, 1 - (x * x) / (hw * hw + 1))) * 6);
      for (let y = 0; y <= dome; y++) {
        const top = y === dome;
        let c = PR.gold.base;
        let f: number = VF.METAL;
        if (top) {
          // feathered wing pattern in lapis & turquoise across the body
          if (z < 8 && z > -24) c = mod(Math.abs(x) + Math.floor(z / 3), 4) < 2 ? PR.lapis.base : PR.turquoise.base;
          if (z < 8 && z > -24 && mod(z, 3) === 0) c = PR.gold.base;
          if (c !== PR.gold.base) f = 0;
        }
        lid.set(x, LY + y, z, c, f);
      }
    }
  }
  // head: nemes stripes + face + beard
  for (let z = 14; z <= 29; z++)
    for (let x = -12; x <= 12; x++) {
      if (Math.abs(x) > halfW(z)) continue;
      const y = LY + 7;
      const face = Math.abs(x) <= 6 && z >= 17 && z <= 27;
      lid.set(x, y, z, face ? PR.gold.hi : mod(x, 3) === 0 ? PR.gold.base : PR.lapis.base, face || mod(x, 3) === 0 ? VF.METAL : 0);
      if (face) lid.set(x, y + 1, z, PR.gold.hi, VF.METAL);
    }
  for (const sx of [-1, 1]) {
    lid.box(sx * 3 - 1, LY + 9, 23, sx * 3 + 1, LY + 9, 24, PR.ink.base);
    lid.set(sx * 3, LY + 9, 24, PR.white.base);
  }
  lid.box(-1, LY + 9, 20, 1, LY + 10, 21, PR.gold.shade, VF.METAL);
  lid.box(-2, LY + 9, 18, 2, LY + 9, 18, PR.red.shade);
  lid.box(-1, LY + 7, 11, 1, LY + 9, 16, PR.lapis.shade);
  // crossed arms with crook & flail
  for (let k = -6; k <= 6; k++) {
    lid.set(k, LY + 7, 6 + Math.abs(k) / 2, PR.gold.hi, VF.METAL);
    lid.set(k, LY + 7, 3 + Math.abs(k) / 2, PR.gold.hi, VF.METAL);
  }
  for (let z = 0; z <= 12; z++) lid.set(-3, LY + 8, z, PR.lapis.shade).set(3, LY + 8, z, PR.gold.shade, VF.METAL);
  const b = base.bounds();
  const lb = lid.bounds();
  return { base, lid, voxelSize: vs, basePivot: [(b.minX + b.maxX + 1) / 2, b.minY, (b.minZ + b.maxZ + 1) / 2], lidPivot: [(lb.minX + lb.maxX + 1) / 2, lb.minY, (lb.minZ + lb.maxZ + 1) / 2] };
}

/** sarcophagus as one static model (lid closed) with a sand drift */
export function sarcophagus(): StaticModel {
  const p = sarcophagusParts();
  const m = p.base.clone();
  m.merge(p.lid);
  sandDrift(m, 0, 0, 22, 40, 3, 0, 41);
  return { model: m, voxelSize: p.voxelSize };
}

