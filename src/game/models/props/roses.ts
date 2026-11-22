// The thorned desert rose of the GUNS N' ROSES skill: a rigged vine that bursts
// out of the sand, coils around its prey and blooms. Sculpted in one shared voxel
// frame (1 voxel = 2 cm): a tapered, twisting stem in three jointed segments with
// hooked thorns and serrated leaves, a calyx of sepals, and a bloom of five rings
// of cupped, scalloped petals (dark heart, crimson body, pale sun-caught rims).
// Parts: stem1 (root) -> stem2 -> stem3 -> bloom.
import { VoxelModel, VF, vary } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, V3 } from '../../../engine/voxel/Rig';

const VS = 0.02;
const H = 58; // stem height (voxels)
const STEM = [0x1f3a17, 0x2d5420, 0x3f6f2a, 0x5a8a38];
const THORN = [0x4a1e14, 0x7a3a22, 0xc89a6a];
const PET = [0x3e0610, 0x6e0c1c, 0x9e1428, 0xc8243a, 0xe8586a];

/** the stem's centre line at height y (a lazy S with a quarter twist) */
function spine(y: number): [number, number] {
  return [Math.sin(y * 0.085) * 3.2 + Math.sin(y * 0.23) * 0.6, Math.cos(y * 0.07) * 2.2 - 2.2];
}
const radius = (y: number) => 2.3 - (y / H) * 1.3;
const h01 = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

function stem(): VoxelModel {
  const m = new VoxelModel('rose_stem');
  for (let y = 0; y <= H; y++) {
    const [cx, cz] = spine(y);
    const r = radius(y);
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++)
      for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r + 1); z++) {
        const d = Math.hypot(x - cx, z - cz);
        if (d > r) continue;
        // ridged bark: lit on one side, a fine groove twisting up the stem
        const ang = Math.atan2(z - cz, x - cx) + y * 0.18;
        const groove = Math.cos(ang * 3) > 0.82;
        const lit = x - cx - (z - cz) * 0.4 > 0;
        const c = groove ? STEM[0] : d > r - 0.8 ? (lit ? STEM[3] : STEM[1]) : STEM[2];
        m.set(x, y, z, vary(c, 0.06));
      }
    // hooked thorns, spiralling, pointing up and out
    if (y > 3 && y < H - 4 && y % 5 === 2) {
      const a = y * 1.9;
      const dx = Math.cos(a), dz = Math.sin(a);
      for (let k = 0; k <= 3; k++) {
        const t = r + k * 0.9;
        const px = Math.round(cx + dx * t), pz = Math.round(cz + dz * t), py = y + Math.round(k * 0.7);
        m.set(px, py, pz, vary(THORN[Math.min(2, k === 3 ? 2 : k > 1 ? 1 : 0)], 0.05), k === 3 ? VF.SOFTAO : 0);
      }
    }
  }
  // two serrated leaves on short petioles
  for (const [ly, la, len] of [[17, 0.6, 9], [34, 3.6, 8], [46, 1.9, 6]] as [number, number, number][]) {
    const [cx, cz] = spine(ly);
    const dx = Math.cos(la), dz = Math.sin(la);
    for (let s = 0; s <= len; s++) {
      const u = s / len;
      const w = Math.sin(u * Math.PI) * 2.6 * (1 - u * 0.25);
      for (let q = -Math.ceil(w); q <= Math.ceil(w); q++) {
        if (Math.abs(q) > w) continue;
        // serration: every other step nips the edge
        if (Math.abs(q) > w - 0.9 && s % 2 === 1) continue;
        const px = Math.round(cx + dx * (radius(ly) + s) - dz * q);
        const pz = Math.round(cz + dz * (radius(ly) + s) + dx * q);
        const py = ly + Math.round(u * 3 - Math.abs(q) * 0.25 + Math.sin(u * Math.PI) * 1.2);
        const rib = q === 0;
        m.set(px, py, pz, vary(rib ? STEM[1] : (q + s) % 3 === 0 ? STEM[2] : STEM[3], 0.07));
      }
    }
  }
  return m;
}

function bloom(): VoxelModel {
  const m = new VoxelModel('rose_bloom');
  const [cx, cz] = spine(H);
  const cy = H + 6;
  // calyx: five pointed sepals curling down from the hip
  for (let p = 0; p < 5; p++) {
    const a = (p / 5) * Math.PI * 2 + 0.3;
    for (let s = 0; s <= 6; s++) {
      const rr = 1.5 + s * 0.85;
      m.set(Math.round(cx + Math.cos(a) * rr), Math.round(H + 1 - s * 0.45 + (s > 4 ? -1 : 0)), Math.round(cz + Math.sin(a) * rr), vary(s > 4 ? STEM[3] : STEM[2], 0.06));
    }
  }
  for (let y = H; y <= H + 2; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (x * x + z * z <= 4) m.set(Math.round(cx) + x, y, Math.round(cz) + z, vary(STEM[2], 0.05));
  // five rings of cupped petals, each ring turned and opened a little more
  const R = 8;
  for (let x = -R - 2; x <= R + 2; x++)
    for (let y = -6; y <= 7; y++)
      for (let z = -R - 2; z <= R + 2; z++) {
        const rad = Math.hypot(x, z);
        if (rad > R + 1.5) continue;
        const phi = Math.atan2(z, x);
        for (let ring = 0; ring < 5; ring++) {
          const rr = 1.4 + ring * 1.55;
          // the cup: radius grows with height (petals flare outward as they rise)
          const want = rr + Math.max(0, y) * (0.12 + ring * 0.07) - Math.max(0, -y) * 0.35;
          if (Math.abs(rad - want) > 0.62) continue;
          // petal lobes: five per ring, offset per ring, scalloped rims
          const lobe = Math.cos(5 * (phi - ring * 0.65));
          const top = 1.8 + ring * 0.55 + lobe * (1.2 + ring * 0.25);
          if (y > top || y < -3 - ring * 0.6) continue;
          const rim = y > top - 1.1;
          const c = ring === 0 ? PET[0] : rim ? (h01(x, y, z) > 0.55 ? PET[4] : PET[3]) : lobe < -0.4 ? PET[1] : ring < 2 ? PET[1] : PET[2];
          m.set(Math.round(cx) + x, cy + y, Math.round(cz) + z, vary(c, 0.05), ring === 0 ? VF.SOFTAO : 0);
          break;
        }
      }
  return m;
}

let cached: RigSpec | null = null;
/** the rose vine rig (cached): stem1 -> stem2 -> stem3 -> bloom */
export function roseVineRig(): RigSpec {
  if (cached) return cached;
  const all = stem();
  const parts: PartSpec[] = [];
  const cut = [0, 20, 40, H + 1];
  const names = ['stem1', 'stem2', 'stem3'];
  for (let i = 0; i < 3; i++) {
    const seg = new VoxelModel(names[i]);
    all.forEach((x, y, z, c, f) => {
      if (y >= cut[i] && y < cut[i + 1] + (i === 2 ? 99 : 0)) seg.set(x, y, z, c, f);
    });
    const [jx, jz] = spine(cut[i]);
    const j: V3 = [Math.round(jx), cut[i], Math.round(jz)];
    parts.push({ name: names[i], model: seg, pivot: j, attach: j, parent: i ? names[i - 1] : undefined });
  }
  const [bx, bz] = spine(H);
  const bj: V3 = [Math.round(bx), H, Math.round(bz)];
  parts.push({ name: 'bloom', model: bloom(), pivot: bj, attach: bj, parent: 'stem3' });
  cached = { name: 'rose_vine', voxelSize: VS, parts, meta: { height: (H + 13) * VS } };
  return cached;
}
