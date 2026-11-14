// THE RIVER GATE — the water gate the Sphinx guards: two battered limestone
// pylons on either bank (ashlar courses, torus mouldings on every corner, a
// flared cavetto cornice, flagpole niches and registers of sunk-relief glyphs
// with their old paint), a lintel bridging the river with a winged sun disk in
// gold relief, and two huge cedar doors clad in bronze bands and studs that
// swing open when the Sphinx falls. 1/4 m voxels: big blocks, the pixel-art
// detail layer does the grain.
//   gate (root: pylons + lintel) → door_l (hinged at x = +10), door_r (x = −10)
// Faces +Z (toward the arena); the river runs through x = 0.
import { SRig, Grid, VoxelModel, VF, type V3, type RigSpec, type Field, type Paint, sstep, h3, vn, mix, pk, rbox, smin, ell } from './kit';

const S = 4;
const LIME = { hi: 0xeedfba, base: 0xd6be92, shade: 0xb39468, deep: 0x8a6c4a, recess: 0x5c4630 };
const COURSES = [0xd8c094, 0xcdb386, 0xe0cba0, 0xc6a87a, 0xd2b98b];
const PAINT = [0x3f5f9e, 0xb4603e, 0x3e9a8c, 0xd8a83e];
const GOLD = { hi: 0xffe690, base: 0xe2b046, shade: 0xa87828 };
const CEDAR = [0x6a4428, 0x5c3a22, 0x744c2e, 0x50321c];
const BRONZE = { hi: 0xd6b26a, base: 0x9a7a3e, patina: 0x5f9a7e, dark: 0x4a3a20 };
/** half the river span between the pylons */
export const GATE_HALF = 10;
export const GATE_H = 17.4;
const PX = 16; // pylon centre |x|

// hand-authored glyphs (5 x 7), carved as sunk relief
const GLYPHS = [
  ['.###.', '#...#', '#...#', '.###.', '#####', '..#..', '..#..'],
  ['.###.', '#...#', '#.#.#', '#...#', '.###.', '.....', '#####'],
  ['#.#.#', '.#.#.', '.....', '#.#.#', '.#.#.', '.....', '#.#.#'],
  ['..#..', '.##..', '.##..', '.###.', '.##..', '.#...', '.#...'],
  ['.##..', '####.', '.###.', '.####', '.####', '.#.#.', '#..#.'],
  ['..##.', '...#.', '.###.', '#....', '#....', '.###.', '....#'],
  ['.....', '.###.', '#.#.#', '.###.', '..#..', '.#.#.', '#...#'],
];
/** 1 inside a glyph cell of the relief registers on a pylon front (u across, v up, metres from the panel corner) */
function glyphAt(u: number, v: number, seed: number) {
  const gw = 1.8, gh = 2.5, px = 0.3;
  const col = Math.floor(u / gw), row = Math.floor(v / gh);
  const lu = u - col * gw, lv = v - row * gh;
  const gi = Math.floor(h3(col, row, 3, seed) * GLYPHS.length);
  const cx = Math.floor((lu - 0.15) / px), cy = 6 - Math.floor((lv - 0.2) / px);
  if (cx < 0 || cx > 4 || cy < 0 || cy > 6) return 0;
  return GLYPHS[gi][cy][cx] === '#' ? 1 : 0;
}

function pylonF(cx: number): Field {
  return (x, y, z) => {
    const lx = x - cx;
    if (y < -1 || y > 24.5) return 1;
    const t = Math.min(y, 21) / 21;
    let hx = 6.0 - t * 1.4, hz = 4.0 - t * 0.9;
    if (y > 21) {
      const c = sstep(21, 22.8, y);
      hx += c * 0.9;
      hz += c * 0.9;
    }
    let d = Math.max(Math.abs(lx) - hx, Math.abs(z) - hz, -y, y - 23.4);
    // plinth
    d = Math.min(d, rbox(lx, y, z, 0, 0.5, 0, 6.6, 0.55, 4.6, 0.1));
    // torus mouldings on the vertical corners and under the cornice
    if (y < 21.2) for (const sx of [-1, 1]) for (const sz of [-1, 1]) d = Math.min(d, Math.hypot(lx - sx * hx, z - sz * hz) - 0.32);
    d = Math.min(d, Math.max(Math.abs(y - 21.1) - 0.3, Math.abs(lx) - hx - 0.25, Math.abs(z) - hz - 0.25));
    // flagpole niches in the front
    for (const nx of [-3.0, 3.0]) if (Math.abs(lx - nx) < 0.45 && z > hz - 0.6 && y > 1 && y < 17) d = Math.max(d, 0.05);
    // sunk-relief registers on the front and back
    if (Math.abs(z) > hz - 0.35 && y > 2.5 && y < 17.5 && Math.abs(lx) < hx - 1.2 && Math.abs(Math.abs(lx) - 3.0) > 0.8) {
      if (glyphAt(lx + 6, y - 2.5, cx > 0 ? 1 : 2) && Math.abs(z) > hz - 0.3) d = Math.max(d, -(Math.abs(z) - (hz - 0.26)));
    }
    return d;
  };
}
function pylonPaint(cx: number): Paint {
  return (x, y, z, nx, ny, nz) => {
    void nz;
    const lx = x - cx;
    const t = Math.min(y, 21) / 21;
    const hz = 4.0 - t * 0.9;
    // glyph floors keep their paint
    if (Math.abs(z) < hz - 0.12 && Math.abs(z) > hz - 0.4 && y > 2.5 && y < 17.5 && glyphAt(lx + 6, y - 2.5, cx > 0 ? 1 : 2)) return pk(vn(x * 0.4, y * 0.4, 0, 5) > 0.35 ? PAINT[Math.floor(h3(Math.floor((lx + 6) / 1.8), Math.floor((y - 2.5) / 2.5), 1, 9) * 4)] : LIME.shade);
    if (y > 20.8 && y < 21.4) return pk(mix(LIME.base, PAINT[0], 0.25));
    if (y > 21.4) {
      // the cornice: painted leaf pattern, mostly faded
      const band = Math.floor((x + z) * 1.6) % 3;
      return pk(vn(x * 0.3, y, z * 0.3, 7) > 0.5 ? [mix(PAINT[0], LIME.base, 0.4), mix(PAINT[1], LIME.base, 0.4), LIME.base][band] : ny > 0.5 ? LIME.hi : LIME.base);
    }
    const row = Math.floor(y / 1.2);
    const off = h3(row, 5, 1, 3) * 2.0;
    const bx = (Math.abs(nx) > 0.7 ? z : x) + off;
    const joint = y - row * 1.2 < 0.12 || bx / 2.2 - Math.floor(bx / 2.2) < 0.05;
    let c = COURSES[Math.floor(h3(row, Math.floor(bx / 2.2), 4, 7) * COURSES.length)];
    if (joint) c = mix(c, LIME.recess, 0.5);
    const st = vn(x * 0.3, y * 0.06, z * 0.3, 11);
    if (st > 0.62) c = mix(c, LIME.shade, (st - 0.62) * 1.6);
    if (y < 1.4) c = mix(c, 0x6e6a48, 0.5);
    if (ny > 0.6) c = mix(c, LIME.hi, 0.4);
    return pk(c);
  };
}

function lintelF(x: number, y: number, z: number) {
  if (Math.abs(x) > GATE_HALF + 1.5) return 1;
  let d = Math.max(Math.abs(x) - (GATE_HALF + 1.2), Math.abs(z) - 2.6, Math.abs(y - 19.4) - 1.8);
  const c = sstep(21.2, 22.6, y);
  d = Math.min(d, Math.max(Math.abs(x) - (GATE_HALF + 1.2), Math.abs(z) - 2.6 - c * 0.8, y - 22.9, 21.1 - y));
  d = Math.min(d, Math.max(Math.abs(y - 21.1) - 0.3, Math.abs(z) - 2.85, Math.abs(x) - (GATE_HALF + 1.2)));
  // the winged sun disk in relief on the front
  const sun = ell(x, y, z, 0, 19.4, 2.6, 1.3, 1.3, 0.35);
  const wing = Math.max(Math.abs(y - 19.6 + Math.abs(x) * 0.06) - 0.75 + Math.abs(x) * 0.05, Math.abs(x) - 7.2, 1.25 - Math.abs(x), z - 2.85, 2.4 - z);
  d = Math.min(d, sun, wing);
  return d;
}
function lintelPaint(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  void nx;
  if (z > 2.62 && Math.hypot(x, y - 19.4) < 1.35) return pk(Math.hypot(x, y - 19.4) < 0.9 ? GOLD.hi : GOLD.base, VF.METAL);
  if (z > 2.62 && Math.abs(x) > 1.2 && Math.abs(x) < 7.3 && y > 18.4 && y < 20.6) {
    const f = Math.floor(Math.abs(x) * 2.2) % 2;
    return pk(y < 19.2 ? (f ? PAINT[0] : PAINT[2]) : f ? GOLD.base : GOLD.shade, y < 19.2 ? VF.SOLID : VF.METAL);
  }
  return pylonPaint(0)(x, y, z, nx, ny, nz);
}

function doorF(s: number): Field {
  return (x, y, z) => {
    const lx = x * s; // 0 at the meeting edge .. GATE_HALF at the hinge
    let d = rbox(lx, y, z, GATE_HALF * 0.5, GATE_H * 0.5, 0, GATE_HALF * 0.5 - 0.05, GATE_H * 0.5, 0.45, 0.05);
    // bronze bands with studs
    for (const by of [1.4, 5.4, 9.4, 13.4, 16.4]) {
      d = Math.min(d, rbox(lx, y, z, GATE_HALF * 0.5, by, 0, GATE_HALF * 0.5 - 0.05, 0.32, 0.6, 0.04));
      if (Math.abs(y - by) < 0.5) {
        const sx = Math.round(lx / 0.8) * 0.8;
        d = Math.min(d, ell(lx, y, Math.abs(z), sx, by, 0.62, 0.2, 0.2, 0.14));
      }
    }
    // half of the great sun emblem at the meeting edge
    d = Math.min(d, Math.max(ell(lx, y, Math.abs(z), 0, 9.4, 0.45, 2.6, 2.6, 0.4), -lx));
    // plank grooves
    if (Math.abs(z) > 0.36 && (lx * 1.6) % 1 < 0.12) d = Math.max(d, 0.02);
    return d;
  };
}
function doorPaint(s: number): Paint {
  return (x, y, z, nx, ny, nz) => {
    void nx;
    void nz;
    const lx = x * s;
    if (Math.hypot(lx, y - 9.4) < 2.6 && Math.abs(z) > 0.5) return pk(Math.hypot(lx, y - 9.4) < 1.6 ? GOLD.hi : GOLD.base, VF.METAL);
    for (const by of [1.4, 5.4, 9.4, 13.4, 16.4])
      if (Math.abs(y - by) < 0.36 || (Math.abs(y - by) < 0.52 && Math.abs(z) > 0.6)) {
        const p = vn(x * 0.8, y * 0.8, z * 0.8, 21);
        return pk(p > 0.6 ? BRONZE.patina : ny > 0.4 || Math.abs(z) > 0.7 ? BRONZE.hi : BRONZE.base, p > 0.6 ? VF.SOLID : VF.METAL);
      }
    const plank = Math.floor(lx * 1.6);
    let c = CEDAR[Math.floor(h3(plank, 1, 1, 3) * CEDAR.length)];
    if ((lx * 1.6) % 1 < 0.12) c = 0x2a1a10;
    if (y < 1.2) c = mix(c, 0x3e4a30, 0.5);
    return pk(c);
  };
}

function sculpt(f: Field, box: number[], m: VoxelModel, paint: Paint) {
  const g = new Grid(S, box);
  g.fill(f);
  g.emit({ part: () => m }, paint, () => pk(LIME.recess));
}

export function riverGateRig(): RigSpec {
  const rig = new SRig('river_gate', S);
  const gate = rig.part('gate', undefined, [0, 0, 0]);
  const dl = rig.part('door_l', 'gate', [GATE_HALF, 0, 0]);
  const dr = rig.part('door_r', 'gate', [-GATE_HALF, 0, 0]);
  for (const cx of [PX, -PX]) sculpt(pylonF(cx), [cx - 7.4, -0.2, -5.6, cx + 7.4, 23.6, 5.6], gate, pylonPaint(cx));
  {
    const g = new Grid(S, [-GATE_HALF - 1.6, 16.6, -3.8, GATE_HALF + 1.6, 23.2, 3.8]);
    g.fill(lintelF);
    g.emit({ part: () => gate }, lintelPaint, () => pk(LIME.recess));
  }
  sculpt(doorF(1), [-0.2, -0.2, -1.0, GATE_HALF + 0.2, GATE_H + 0.2, 1.0], dl, doorPaint(1));
  sculpt(doorF(-1), [-GATE_HALF - 0.2, -0.2, -1.0, 0.2, GATE_H + 0.2, 1.0], dr, doorPaint(-1));
  void smin;
  const v3 = (x: number, y: number, z: number): V3 => [x, y, z];
  return rig.build({ kind: 'river_gate', half: GATE_HALF, height: 23.4, pylonX: PX, doorH: GATE_H, sun: v3(0, 19.4, 2.9) });
}
