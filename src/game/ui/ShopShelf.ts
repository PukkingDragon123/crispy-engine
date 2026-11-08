// Ozymandias's display stall and its price tags (the turtle-house shop, Shop.ts).
//
// THE STALL: a two-step wooden display stall that stands in the middle of his
// shop, in front of the counter: pine tops worn round at the front lips, sides
// cut like stair stringers with an arched opening and a knot-hole, risers and
// sides in chipped teal paint over weathered wood, turned walnut feet, a striped
// kilim runner over the top step whose fringe hangs down its front, and a brass
// tack on each lip for every slot. It is part of the room (parented to Gobi's
// shell, so it sinks with the house when he digs in); during a visit the wares
// fly out of his basket and land on its slots.
//
// THE TAGS: a manila card tag on a twine loop hangs from the tack under every
// ware, the price inked on it in Alagard with a two-word "what it does" under
// it (a red DEAL line when it is the day's deal); it swings when a ware lands
// or is lifted, and flips to SOLD when you buy. The card and twine are sculpted;
// only the lettering is drawn.
import * as THREE from 'three';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { pine, paintedWood, brass, weathered, darkWood, ropeMat } from '../models/materials';
import { hash3, noise } from '../../engine/math/rand';
import { sculpt, Surf, sdRoundBox2, len2, mixc } from './HudKit';

export const STALL_VS = 1 / 40;
const V = STALL_VS;

export interface StallTier {
  /** top surface height (m, stall space: origin on the floor at the stall's centre, front toward -z) */
  top: number;
  /** the top surface runs z0..z1 (m) */
  z0: number;
  z1: number;
  /** where a ware sits (z, m) */
  slotZ: number;
  /** the tack on the front lip the tags hang from (y, z in m) */
  tackY: number;
  tackZ: number;
}
export interface Stall {
  geo: THREE.BufferGeometry;
  /** half width (x, m) */
  halfX: number;
  /** lower step, upper step */
  tiers: [StallTier, StallTier];
  /** slot centres along x (m) for a full step, and the spacing (fewer wares centre up) */
  slotX: number[];
  slotStep: number;
  /** the stall's footprint (m): x -halfX..halfX, z zMin..zMax */
  zMin: number;
  zMax: number;
}

const TEAL = 0x4f8a86;
const KILIM = [0x9a2e22, 0x2e3e6a, 0xd0a040, 0xe8d8b4, 0x5a2a1a];

let stall: Stall | null = null;
/** the display stall (built once) */
export function stallModel(): Stall {
  if (stall) return stall;
  const m = new VoxelModel('ozy_stall');
  const X0 = -28, X1 = 27;
  const topWood = pine({ along: 'x', seed: 11, ends: [X0, X1], knots: 0.5 });
  const paint = (seed: number, along: 'x' | 'y' | 'z') => paintedWood(TEAL, { along, seed, chip: 0.38, fade: 0.2 });
  const set = (x: number, y: number, z: number, c: number | null, f = VF.SOLID) => m.set(x, y, z, c ?? 0x6a4a2a, f);
  const stepTop = (z: number) => (z < -1 ? 14 : 26);

  // ---- turned walnut feet under the four corners
  const foot = darkWood({ along: 'y', seed: 4 });
  for (const [fx, fz] of [[-27, -10], [26, -10], [-27, 9], [26, 9]])
    for (let y = 0; y <= 1; y++)
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          if (y === 0 && Math.abs(dx) + Math.abs(dz) === 2) continue; // rounded at the floor
          set(fx + dx, y, fz + dz, foot(fx + dx, y, fz + dz));
        }

  // ---- the two sides, cut like stair stringers: an arched opening at the foot, a knot-hole, rounded corners
  const side = paint(3, 'y');
  for (const sx of [X0, X0 + 1, X1 - 1, X1])
    for (let z = -11; z <= 9; z++)
      for (let y = 2; y <= stepTop(z); y++) {
        const arch = 2 + 5.2 * Math.sqrt(Math.max(0, 1 - ((z + 1) / 7.6) ** 2));
        if (z > -9 && z < 7 && y < arch) continue;
        if (len2(z - 4, y - 19.5) < 1.7) continue; // the knot-hole
        if ((y === 14 && z === -11) || (y === 26 && (z === -1 || z === 9))) continue; // worn round corners
        set(sx, y, z, side(sx, y, z));
      }

  // ---- risers (vertical boards) and the closed back
  const riser = paint(7, 'y');
  const back = weathered({ along: 'y', seed: 9, checks: 0.4 });
  for (let x = X0 + 2; x <= X1 - 2; x++) {
    const seam = ((x + 28) % 6) === 0;
    for (let y = 2; y <= 12; y++) for (const z of [-11, -10]) set(x, y, z, seam && z === -11 ? 0x2e3a36 : riser(x, y, z));
    for (let y = 15; y <= 24; y++) for (const z of [-1, 0]) set(x, y, z, seam && z === -1 ? 0x2e3a36 : riser(x, y + 40, z));
    for (let y = 2; y <= 25; y++) for (const z of [9, 10]) set(x, y, z, seam && z === 10 ? 0x3a2e24 : back(x, y, z));
  }
  // the kick rail along the front foot
  for (let x = X0 + 2; x <= X1 - 2; x++) for (const y of [2, 3]) set(x, y, -12, darkWood({ along: 'x', seed: 2 })(x, y, -12));

  // ---- the step tops: three planks each, seams, the front lip worn round
  const plank = (y0: number, z0: number, z1: number, seams: number[]) => {
    for (let x = X0; x <= X1; x++)
      for (let z = z0; z <= z1; z++)
        for (let y = y0; y <= y0 + 1; y++) {
          const front = z === z0, top = y === y0 + 1;
          // the lip is rubbed round where hands and wares have slid over it for nine hundred years
          if (front && top && hash3(x >> 1, y, z) < 0.55 + 0.3 * noise.n2(x * 0.15, y0)) continue;
          if ((x === X0 || x === X1) && front && top) continue;
          let c = topWood(x, y, z);
          if (top && seams.includes(z)) c = mixc(c ?? 0x8a5a32, 0x2a1a0c, 0.65);
          set(x, y, z, c);
        }
  };
  plank(13, -12, -1, [-8, -4]);
  plank(25, -2, 10, [2, 6]);

  // ---- the kilim runner on the top step, hanging down its front with a fringe
  const kil = (x: number, z: number, hang: number) => {
    const band = z < 0 ? Math.floor(hang / 2) : Math.floor((z + 3) / 2.5);
    const dia = Math.abs((((x + 64) % 10) - 5)) + Math.abs(((hang + z + 64) % 6) - 3);
    if (band % 3 === 1 && dia < 4) return dia < 2 ? KILIM[2] : KILIM[3];
    const k = band % 4;
    return k === 0 ? KILIM[0] : k === 1 ? KILIM[1] : k === 2 ? KILIM[0] : KILIM[4];
  };
  for (let x = -24; x <= 23; x++) {
    const sag = noise.n2(x * 0.2, 5) > 0.45 ? 1 : 0;
    for (let z = -2; z <= 9; z++) set(x, 27, z, kil(x, z, 0), VF.SOLID);
    for (let y = 27; y >= 20 - sag; y--) set(x, y, -3, kil(x, -3, 27 - y));
    if ((x & 1) === 0) set(x, 19 - sag, -3, 0xe0cfa6); // fringe
    if ((x & 3) === 0 && hash3(x, 3, 7) > 0.4) set(x, 18 - sag, -3, 0xd4c094);
  }

  // the price tags bring their own brass pins (they are pushed into the lips wherever the wares stand)
  const slotX = [-21, -7, 7, 21];
  m.grime(0.12, 0.3);

  const geo = buildVoxelGeometry(m, { voxelSize: V, pivot: [0, 0, 0] });
  geo.computeBoundingBox();
  stall = {
    geo,
    halfX: 28 * V,
    slotX: slotX.map((x) => (x + 0.5) * V),
    slotStep: 14 * V,
    tiers: [
      { top: 15 * V, z0: -12 * V, z1: -1 * V, slotZ: -6.5 * V, tackY: 13.5 * V, tackZ: -12 * V - 0.001 },
      { top: 28 * V, z0: -2 * V, z1: 10 * V, slotZ: 4.5 * V, tackY: 25.5 * V, tackZ: -3 * V - 0.001 },
    ],
    zMin: -13 * V,
    zMax: 11 * V,
  };
  return stall;
}

/** the stall's top surface height at (x, z) in stall space (null: off the stall) */
export function stallTopAt(s: Stall, x: number, z: number): number | null {
  if (Math.abs(x) > s.halfX || z < s.tiers[0].z0 || z > s.tiers[1].z1 + V) return null;
  return z < s.tiers[1].z0 + V ? s.tiers[0].top : s.tiers[1].top;
}

// ================================================================== the price tag
const TAG_VS = 1 / 200;
const TAG_W = 30, TAG_H = 17; // card size in voxels (0.15 x 0.085 m)
/** hung a little larger than life so the price reads from the doorway */
const TAG_SCALE = 1.3;
let tagGeo: THREE.BufferGeometry | null = null;
let twineGeo: THREE.BufferGeometry | null = null;
/** the card: a manila tag with clipped top corners, a punched and reinforced hole, a slight curl, rubbed edges */
function tagModel() {
  const cx = TAG_W / 2, holeY = TAG_H - 3.2;
  const col = (x: number, y: number) => {
    const X = x - cx, Y = y - TAG_H / 2;
    let d = sdRoundBox2(X, Y, TAG_W / 2, TAG_H / 2, 1.6);
    // clipped top corners (the classic tag shoulder)
    d = Math.max(d, (Math.abs(X) + (Y - TAG_H / 2)) - TAG_W / 2 + 3.2);
    const hole = len2(X, y - holeY);
    return { d, hole, curl: 0.9 * Math.sin((x / TAG_W) * Math.PI) + 0.5 * (1 - y / TAG_H) };
  };
  const sd = (x: number, y: number, z: number, c: { d: number; hole: number; curl: number }) => {
    if (c.hole < 1.1) return 1;
    const zc = c.curl;
    return Math.max(c.d, Math.abs(z - 1 - zc) - (c.hole < 2.2 ? 1.0 : 0.55));
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const c = col(x, y);
    let k = 0xd8bd84;
    const n = noise.n2(x * 0.18, y * 0.18);
    if (n > 0.35) k = 0xcdb078;
    if (c.d > -1.4) k = mixc(k, 0x9a7a48, 0.55); // rubbed, grubby edges
    if (c.hole < 2.2) k = 0xb89a62; // the reinforcing ring
    if (hash3(x, y, 3) < 0.012) k = 0xa8865a; // foxing
    void s;
    void z;
    return [k, VF.SOLID];
  };
  return sculpt('ozy_tag', [-1, -1, -1, TAG_W + 1, TAG_H + 1, 4], sd, paint, VF.SOLID, col);
}
/** a short twine loop from the hole up to the tack */
function twineModel() {
  const m = new VoxelModel('ozy_twine');
  const r0 = ropeMat({ along: 'y', seed: 2, tones: [0x6e5432, 0x94764a, 0xb2925e, 0xcaa874] });
  const rope = (x: number, y: number, z: number) => r0(x, y, z) ?? 0x94764a;
  for (let y = 0; y <= 9; y++) {
    const s = Math.round(Math.sin((y / 9) * Math.PI) * 1.6);
    m.set(-s, y, 0, rope(-s, y, 0));
    m.set(s, y, 0, rope(s, y, 1));
  }
  // the brass pin it hangs from, pushed into the stall's lip
  const p0 = brass({ seed: 3, patina: 0.15, polish: 0.6 });
  const pin = (x: number, y: number, z: number) => p0(x, y, z) ?? 0xc4952e;
  for (let dx = -1; dx <= 1; dx++) for (let dy = 10; dy <= 12; dy++) if (Math.abs(dx) + Math.abs(dy - 11) < 2) m.set(dx, dy, -1, pin(dx, dy, -1), VF.SOLID | VF.METAL);
  m.set(0, 11, -2, pin(0, 11, -2), VF.SOLID | VF.METAL);
  return m;
}

export interface TagText {
  price: number;
  /** two or three words: what it does */
  short: string;
  /** was this price before the deal / the haggle (null: no discount) */
  was?: number | null;
  deal?: boolean;
  sold?: boolean;
  /** you cannot afford it */
  dear?: boolean;
}

/**
 * One price tag: hangs from its tack (the group's origin), swings on a little
 * pendulum, inked with the price in Alagard on a canvas laid flush on the card.
 */
export class PriceTag {
  readonly root = new THREE.Group();
  private swing = new THREE.Group();
  private cv = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private ink: THREE.MeshBasicMaterial;
  private ax = 0;
  private av = 0;
  private bx = 0;
  private bv = 0;
  private key = '';
  /** 0..1 the SOLD flip */
  private flip = 0;
  private flipTo = 0;
  private card: THREE.Group;
  private pending: TagText | null = null;
  private soldShown = false;
  private plane: THREE.Mesh;
  shown = 0;
  /** 1 once its ware has landed (or it is a SOLD tag): it drops down into view */
  want = 0;

  constructor(mat: THREE.Material) {
    tagGeo ??= buildVoxelGeometry(tagModel(), { voxelSize: TAG_VS, pivot: [TAG_W / 2, TAG_H, 1] });
    twineGeo ??= buildVoxelGeometry(twineModel(), { voxelSize: TAG_VS, pivot: [0.5, 11.5, 0.5] });
    this.root.add(this.swing);
    const tw = new THREE.Mesh(twineGeo, mat);
    tw.scale.setScalar(1);
    this.swing.add(tw);
    this.card = new THREE.Group();
    this.card.position.y = -11.2 * TAG_VS;
    this.swing.add(this.card);
    const tag = new THREE.Mesh(tagGeo, mat);
    tag.castShadow = true;
    // the card hangs below the hole: shift so the hole sits on the twine's foot
    tag.position.y = 3.2 * TAG_VS;
    this.card.add(tag);
    this.cv.width = 192;
    this.cv.height = 108;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.ink = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, alphaTest: 0.35, depthWrite: false, toneMapped: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(TAG_W * TAG_VS * 0.94, (TAG_H - 4.4) * TAG_VS), this.ink);
    this.plane = plane;
    // just in front of the card's face (it faces -z), under the hole
    plane.position.set(0, 3.2 * TAG_VS - (4.4 + (TAG_H - 4.4) / 2) * TAG_VS, -1.0 * TAG_VS);
    plane.rotation.y = Math.PI;
    plane.renderOrder = 2;
    this.card.add(plane);
    this.root.scale.setScalar(0.0001);
  }

  /** ink it (redrawn only when the words change); turning SOLD flips the card over */
  set(t: TagText) {
    const key = `${t.price}|${t.short}|${t.was ?? ''}|${t.deal ? 1 : 0}|${t.sold ? 1 : 0}|${t.dear ? 1 : 0}`;
    if (key === this.key || (this.pending && t.sold)) return;
    if (t.sold && !this.soldShown && this.key) {
      this.soldShown = true;
      this.flipTo = 1;
      this.pending = t;
      return;
    }
    this.soldShown = !!t.sold;
    this.key = key;
    this.draw(t);
  }

  private draw(t: TagText) {
    const c = this.cv.getContext('2d')!;
    const W = this.cv.width, H = this.cv.height;
    c.clearRect(0, 0, W, H);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const INK = '#3a2210', RED = '#9a1e12';
    if (t.sold) {
      c.font = '52px Alagard';
      c.fillStyle = RED;
      c.save();
      c.translate(W / 2, H / 2);
      c.rotate(-0.12);
      c.fillText('SOLD', 0, 2);
      c.restore();
    } else {
      const top = t.deal || t.was ? 24 : 0;
      if (top) {
        c.font = '22px Alagard';
        c.fillStyle = RED;
        c.fillText(t.deal ? `DEAL  was ${t.was}` : `was ${t.was}`, W / 2, 16);
      }
      c.font = '50px Alagard';
      c.fillStyle = t.dear ? RED : INK;
      const p = String(t.price);
      c.fillText(p, W / 2 - 14, H / 2 - 4 + top * 0.35);
      c.font = '22px Alagard';
      c.fillText('gold', W / 2 + c.measureText(p).width * 0.5 + 26, H / 2 + 6 + top * 0.35);
      c.font = '21px Alagard';
      c.fillStyle = '#5a3a1c';
      c.fillText(t.short, W / 2, H - 15);
    }
    this.tex.needsUpdate = true;
  }

  /** a knock (ware landed / lifted / shot): a swing */
  kick(k = 1) {
    this.av += (Math.random() - 0.3) * 6 * k;
    this.bv += (Math.random() - 0.5) * 4 * k;
  }

  update(dt: number, want: number) {
    this.shown += (want - this.shown) * Math.min(1, dt * 7);
    this.root.scale.setScalar(Math.max(0.0001, Math.min(1, this.shown * 1.15)) * TAG_SCALE);
    // two damped pendulums (front-back, side to side)
    this.av += (-38 * this.ax - 3.2 * this.av) * dt;
    this.bv += (-32 * this.bx - 3.0 * this.bv) * dt;
    this.ax += this.av * dt;
    this.bx += this.bv * dt;
    // the SOLD flip: a turn about the twine, the new face inked at the halfway point
    if (this.flipTo > this.flip) {
      this.flip = Math.min(1, this.flip + dt * 2.6);
      if (this.flip >= 0.5 && this.pending) {
        const p = this.pending;
        this.pending = null;
        this.key = `${p.price}|${p.short}|${p.was ?? ''}|${p.deal ? 1 : 0}|1|${p.dear ? 1 : 0}`;
        this.draw(p);
        this.kick(0.6);
      }
      if (this.flip >= 1) {
        this.flip = 0;
        this.flipTo = 0;
      }
    }
    const turn = this.flipTo ? Math.sin(this.flip * Math.PI) * Math.PI * 0.5 : 0;
    this.swing.rotation.set(this.ax * 0.5, turn, this.bx * 0.35);
  }

  dispose() {
    this.tex.dispose();
    this.ink.dispose();
    this.plane.geometry.dispose();
    this.root.removeFromParent();
  }
}

