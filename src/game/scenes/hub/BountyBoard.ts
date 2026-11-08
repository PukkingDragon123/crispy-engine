// THE LONG RIDE: the hideout's journey board, a station in the garage corner.
// A big weathered notice board on the front wall above the saddle rail, under a
// carved header plank, where Sundown keeps track of the whole hunt:
//  • THE ROUTE: one pinned card per region of Serket's Reach (the Bonewind
//    Dunes, the Mirage Oasis, the Red Pyramid) strung together with red twine;
//    each shows the best wave he has reached there. A region he has not ridden
//    into yet hangs behind a padlocked chain.
//  • THE BOUNTIES: under each region a row of bounty tokens, one per boss who
//    first rides out there: a polished gold token once that boss is paid in full,
//    a dark iron one while it is still out there (hover for its name and wave).
//  • FINDS: blueprints found of all there are (a rolled blueprint pinned on the
//    card) and relics dug up (an ankh shard pinned beside it).
//  • THE CODEX: points, the title they earn and what the next title needs.
//  • NEXT UP: a note of the next few things to work toward: the next unpaid
//    bounty and its wave, the next region and the wave that opens it, the
//    cheapest thing in the shop catalogue and how far the bank is from it, how
//    many blueprints are still out there.
// Everything on it is a sculpted voxel model; only the lettering is drawn
// (Alagard on the cards). Press E there and the camera steps up to read it:
// A / D between the whole board, the route and the note; hover anything for
// what it means.
//
// Registration (one line, in HouseExtras' constructor after the parts are made):
//   installBountyBoard(this, h);
// It hooks itself into HouseExtras' build / use / update / dispose and the
// carousel's use. (Optionally add 'bounty' after 'garage' in HubScene's ORDER;
// without it the board is the first stop, left of RIDE OUT.)
import * as THREE from 'three';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { hash3, noise } from '../../../engine/math/rand';
import { pine, darkWood, weathered, rustedIron, agedPaper, brass } from '../../models/materials';
import * as WS from '../../models/props/workshop';
import { CABIN_IN } from '../../models/props/hideout';
import { blueprintScroll } from '../../models/props/treasure';
import { ankhFragment } from '../../models/props/loot';
import { loadSave, PRICES, owns } from '../../meta/Save';
import { Blueprints, REGION_NAMES, type RegionKey } from '../../meta/Blueprints';
import { Codex, F_CLAIM } from '../../meta/Codex';
import { BuildKit, HubHost, HubStation, HeroBubble, engrave, safe, geoOf, meshOf } from './HubKit';
import type { Mode, Pick, View, HouseExtras } from './HouseExtras';

const IN = CABIN_IN;
/** where the board hangs: on the front wall above the saddle rail, in the garage corner */
const AT = new THREE.Vector3(-3.58, 1.18, IN.front - 0.02);
const BV = 1 / 40;
/** the board's face (the front of its boards), board space z (m): everything pinned on it sits in front of this */
const FACE = 2 * BV;

// ------------------------------------------------------------------ the journey
const REGIONS: RegionKey[] = ['A', 'B', 'C'];
/** the bosses, by the region they first ride out in, with that first wave (the Codex boss ids) */
const BOSSES: Record<RegionKey, { id: string; name: string; wave: number }[]> = {
  A: [
    { id: 'khonsu', name: 'Avatar of Khonsu', wave: 5 },
    { id: 'marshal', name: 'The Dust Marshal', wave: 10 },
    { id: 'thornback', name: 'Old Thornback', wave: 15 },
    { id: 'ironclad', name: 'The Ironclad', wave: 20 },
    { id: 'gulp', name: 'Old Gulp', wave: 30 },
    { id: 'bertha', name: 'Big Bertha', wave: 45 },
    { id: 'sethos', name: 'Sethos', wave: 50 },
  ],
  B: [
    { id: 'pharaoh', name: 'Pharaoh Nekh-Amun', wave: 55 },
    { id: 'sunroller', name: 'The Sunroller', wave: 60 },
    { id: 'khonsuSand', name: 'Khonsu of the Sands', wave: 75 },
  ],
  C: [{ id: 'setAvatar', name: 'Avatar of Set', wave: 100 }],
};
const REGION_WAVES: Record<RegionKey, [number, number]> = { A: [1, 50], B: [51, 75], C: [76, 100] };

interface Journey {
  best: number;
  reached: Record<RegionKey, boolean>;
  beaten: Set<string>;
  bp: { found: number; total: number };
  relics: { found: number; total: number; per: Record<string, [number, number]> };
  codex: { pts: number; max: number; title: string; next: { title: string; at: number } | null };
  next: string[];
}
function journey(): Journey {
  const s = loadSave();
  const best = s.bestWave ?? 0;
  const reached = { A: true, B: best > 50, C: best > 75 };
  const beaten = new Set<string>();
  for (const r of REGIONS) for (const b of BOSSES[r]) if (Codex.flags('boss:' + b.id) & F_CLAIM) beaten.add(b.id);
  let bp = { found: 0, total: 0 };
  const relics = { found: 0, total: 0, per: {} as Record<string, [number, number]> };
  try {
    bp = Blueprints.count();
    for (const r of Blueprints.relics()) {
      relics.found += r.found;
      relics.total += r.total;
      relics.per[r.region] = [r.found, r.total];
    }
  } catch {
    /* no save yet */
  }
  let codex: Journey['codex'] = { pts: 0, max: 0, title: 'Greenhorn', next: null };
  try {
    const pts = Codex.points(), rk = Codex.rank(pts);
    codex = { pts, max: Codex.maxPoints(), title: rk.title, next: rk.next };
  } catch {
    /* no book */
  }
  // the next few things to work toward
  const next: string[] = [];
  const unpaid = REGIONS.flatMap((r) => BOSSES[r]).find((b) => !beaten.has(b.id));
  if (unpaid) next.push(`Pay off ${unpaid.name} (wave ${unpaid.wave}).`);
  if (!reached.B) next.push('Reach wave 50 and the storm parts for the Mirage Oasis.');
  else if (!reached.C) next.push('Reach wave 75 to ride on to the Red Pyramid.');
  else if (best < 100) next.push(`Wave 100 at the Apex of Set. Best so far: ${best}.`);
  let cheap: { key: string; price: number } | null = null;
  for (const [key, price] of Object.entries(PRICES)) if (price > 0 && price < 9999 && !owns(key) && (!cheap || price < cheap.price)) cheap = { key, price };
  if (cheap) {
    const [kind, a, b] = cheap.key.split(':');
    const nm = (kind === 'gun' ? `${b} ${a}` : `${a} ${kind}`).replace('_', ' ');
    next.push(s.bank >= cheap.price ? `The bank can buy the ${nm} now (${cheap.price}).` : `Bank ${cheap.price - s.bank} more for the ${nm}.`);
  }
  if (bp.total > bp.found) next.push(`${bp.total - bp.found} blueprints still out in the sand.`);
  if (codex.next) next.push(`${Math.max(0, codex.next.at - codex.pts)} codex points to ${codex.next.title}.`);
  return { best, reached, beaten, bp, relics, codex, next: next.slice(0, 4) };
}

// ------------------------------------------------------------------ the models
/** the board: vertical weathered boards in a walnut frame, iron corner plates, nail heads */
function boardModel() {
  const m = new VoxelModel('long_ride_board');
  const X = 32, Y = 44;
  const back = weathered({ along: 'y', seed: 21, checks: 0.5 });
  const frame = darkWood({ along: 'x', seed: 22 });
  const frameV = darkWood({ along: 'y', seed: 23 });
  const iron = rustedIron({ seed: 24, rust: 0.4 });
  for (let x = -X; x < X; x++)
    for (let y = 0; y < Y; y++) {
      const edge = x < -X + 3 || x >= X - 3 || y < 3 || y >= Y - 3;
      if (edge) {
        // the frame: rails over stiles, a bevel on its outer lip
        const rail = y < 3 || y >= Y - 3;
        const c = (rail ? frame : frameV)(x, y, 1) ?? 0x4e3220;
        for (let z = 0; z <= 2; z++) {
          if (z === 2 && (x === -X || x === X - 1 || y === 0 || y === Y - 1)) continue;
          m.set(x, y, z, c);
        }
        continue;
      }
      const seam = ((x + X) % 7) === 0;
      m.set(x, y, 0, back(x, y, 0) ?? 0x7a6a58);
      m.set(x, y, 1, seam ? 0x2e241c : back(x, y, 1) ?? 0x877866);
    }
  // iron corner plates with nail heads
  for (const [cx, cy] of [[-X, 0], [X - 4, 0], [-X, Y - 4], [X - 4, Y - 4]])
    for (let x = cx; x < cx + 4; x++)
      for (let y = cy; y < cy + 4; y++) {
        const inner = (cx < 0 ? x - cx : cx + 3 - x) + (cy === 0 ? y - cy : cy + 3 - y);
        if (inner > 4) continue;
        m.set(x, y, 3, iron(x, y, 3) ?? 0x4a4440, VF.SOLID | VF.METAL);
      }
  for (let x = -X + 9; x < X - 6; x += 9) for (const y of [1, Y - 2]) m.set(x, y, 3, 0x6a645c, VF.SOLID | VF.METAL);
  return m;
}

/** the carved header plank, THE LONG RIDE cut into it */
function headerModel() {
  const m = new VoxelModel('long_ride_header');
  const X = 62, Y = 7;
  const wood = pine({ along: 'x', seed: 31, ends: [-X, X - 1], knots: 0.4 });
  for (let x = -X; x < X; x++)
    for (let y = -Y; y <= Y; y++) {
      // a plank cut with rounded ends and a little bow
      const end = Math.max(0, Math.abs(x + 0.5) - (X - 6));
      if (Math.hypot(end, y * 0.9) > Y + 0.4 - (Math.abs(x) > X - 6 ? 0 : 0)) continue;
      for (let z = 0; z <= 3; z++) {
        if (z === 3 && (Math.abs(y) === Y || hash3(x >> 1, y, 3) < 0.04)) continue; // worn edges
        m.set(x, y, z, wood(x, y, z) ?? 0xb88250);
      }
    }
  engrave(m, 'THE LONG RIDE', 0, 0, 3, X * 2 - 22, Y * 2 - 4, 0x3a2412);
  return m;
}

/** a pinned paper card: torn edges, a curl at one corner, an iron tack at the top */
function noteModel(w: number, h: number, seed: number) {
  const m = new VoxelModel('long_ride_note');
  const paper = agedPaper({ seed, rect: [-w / 2, 0, w / 2, h], plane: 'xy', age: 0.6 });
  for (let x = -Math.floor(w / 2); x < Math.ceil(w / 2); x++)
    for (let y = 0; y < h; y++) {
      const tear = noise.n2(x * 0.45 + seed, y * 0.3) * 1.3;
      if ((y === 0 || y === h - 1) && hash3(x, y, seed) < 0.35) continue; // torn top and bottom
      if (Math.abs(x + 0.5) > w / 2 - 1 + Math.min(0, tear) * 0.6 && hash3(x, y, seed + 1) < 0.5) continue;
      const curl = x > w / 2 - 6 && y < 5 && x - (w / 2 - 6) + (5 - y) > 5 ? 1 : 0; // a lifted corner
      m.set(x, y, curl, paper(x, y, 0) ?? 0xe0cc9c);
    }
  // the tack
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (Math.abs(dx) + Math.abs(dy) < 2) m.set(dx, h - 4 + dy, 1, 0x6a645c, VF.SOLID | VF.METAL);
  m.set(0, h - 4, 2, 0x8a847a, VF.SOLID | VF.METAL);
  return m;
}

/** a bounty token: a stamped disc with a raised star, polished gold once paid, dark iron while still out there */
function tokenModel(paid: boolean) {
  const m = new VoxelModel('bounty_token');
  const R = 6;
  const g = brass({ seed: 7, patina: 0.05, polish: 0.8 });
  const ir = rustedIron({ seed: 8, rust: 0.55 });
  const star = (x: number, y: number) => {
    const a = Math.atan2(y, x), r = Math.hypot(x, y);
    const k = Math.cos(a * 5 - Math.PI / 2);
    return r < 2.0 + 1.7 * Math.max(0, k) ** 3;
  };
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++) {
      const r = Math.hypot(x, y);
      if (r > R + 0.3) continue;
      const rim = r > R - 1.2;
      const c = paid ? g(x, y, 0) ?? 0xd0a040 : ir(x, y, 0) ?? 0x4a4440;
      m.set(x, y, 0, c, VF.SOLID | VF.METAL);
      if (rim || star(x, y)) m.set(x, y, 1, paid ? (y > 0 ? 0xf2d27a : 0xc4952e) : y > 0 ? 0x7a746a : 0x4e4a44, VF.SOLID | VF.METAL);
    }
  // the nail it hangs on
  m.set(0, R + 1, 1, 0x5a544c, VF.SOLID | VF.METAL);
  return m;
}

/** red twine strung between two pins (board space, metres), sagging */
function twineModel(a: THREE.Vector2, b: THREE.Vector2) {
  const V = 1 / 96;
  const m = new VoxelModel('long_ride_twine');
  const n = Math.ceil(a.distanceTo(b) / V);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = (a.x + (b.x - a.x) * t) / V, y = (a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * 0.035) / V;
    m.set(Math.round(x), Math.round(y), 0, (i >> 1) % 3 === 0 ? 0x8a1a12 : 0xb02a1c);
  }
  return m;
}

// ------------------------------------------------------------------ Alagard on paper
class Print {
  readonly mesh: THREE.Mesh;
  private cv = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private key = '';
  constructor(public w: number, public h: number, px = 384) {
    this.cv.width = px;
    this.cv.height = Math.max(16, Math.round((px * h) / w));
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: this.tex, transparent: true, roughness: 0.95, metalness: 0, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    this.mesh.renderOrder = 2;
  }
  /** lines of type from the top: [text, size (fraction of the height), colour, left-aligned] */
  set(lines: [string, number, string, boolean?][]) {
    const key = JSON.stringify(lines);
    if (key === this.key) return;
    try {
      if (document.fonts && !document.fonts.check('16px Alagard')) return; // retried until the face is in
    } catch {
      /* assume ready */
    }
    this.key = key;
    const c = this.cv.getContext('2d')!;
    const W = this.cv.width, H = this.cv.height, pad = W * 0.07;
    c.clearRect(0, 0, W, H);
    c.textBaseline = 'top';
    let y = H * 0.06;
    for (const [t, size, color, left] of lines) {
      let px = Math.round(size * H);
      c.font = `${px}px Alagard`;
      // wrap long lines to the card
      const words = t.split(' ');
      const rows: string[] = [];
      let cur = '';
      for (const wd of words) {
        const tryS = cur ? cur + ' ' + wd : wd;
        if (c.measureText(tryS).width > W - pad * 2 && cur) {
          rows.push(cur);
          cur = wd;
        } else cur = tryS;
      }
      if (cur) rows.push(cur);
      if (rows.length === 1 && c.measureText(rows[0]).width > W - pad * 2) {
        px = Math.floor((px * (W - pad * 2)) / c.measureText(rows[0]).width);
        c.font = `${px}px Alagard`;
      }
      c.fillStyle = color;
      c.textAlign = left ? 'left' : 'center';
      for (const r of rows) {
        c.fillText(r, left ? pad : W / 2, y);
        y += px * 1.12;
      }
      y += px * 0.12;
    }
    this.tex.needsUpdate = true;
  }
  dispose() {
    this.tex.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}

// ------------------------------------------------------------------ the station
interface Card {
  grp: THREE.Group;
  print: Print;
  tip: () => string;
}

export class BountyBoard implements Mode {
  id = 'bounty';
  done = false;
  private root = new THREE.Group();
  private cards: Card[] = [];
  private tokens: { obj: THREE.Object3D; tip: () => string }[] = [];
  private st: HubStation | null = null;
  private vi = 0;
  private views: View[] = [];
  private j: Journey = journey();
  private sway: { o: THREE.Object3D; ph: number; a: number }[] = [];
  private greet = 0;

  constructor(private h: HubHost, private bubble: HeroBubble) {}

  /** board space (m, origin at the board's bottom centre, facing the room) to world */
  private W(x: number, y: number, z = 0) {
    return this.root.localToWorld(new THREE.Vector3(x, y, z));
  }

  build(k: BuildKit) {
    const s = this.h.scene;
    this.root.position.copy(AT);
    this.root.rotation.y = Math.PI; // its face (+z) to the room
    s.add(this.root);
    this.root.updateMatrixWorld(true);
    const add = (geo: THREE.BufferGeometry | null, x: number, y: number, z: number, parent: THREE.Object3D = this.root) => {
      if (!geo) return null;
      const mm = meshOf(geo);
      mm.position.set(x, y, z);
      parent.add(mm);
      return mm;
    };
    // ---- the board and its header
    add(buildVoxelGeometry(boardModel(), { voxelSize: BV, pivot: [0, 0, 0] }), 0, 0, 0);
    add(buildVoxelGeometry(headerModel(), { voxelSize: 1 / 96, pivot: [0, 0, 0] }), 0, 44 * BV + 0.075, 0.01);
    // a warm lamp on the board (the garage corner is in the shade of the tie beam)
    k.lamp(0xffc888, 1.5, 2.8, 1.6, this.W(0, 0.85, 0.75), 0.02);
    const j = this.j;
    // ---- the route: a card per region, strung together with red twine
    const RX = [-0.5, 0, 0.5], RY = 0.66, RW = 0.4, RH = 0.24;
    REGIONS.forEach((r, i) => {
      const c = this.card(RX[i], RY, RW, RH, 40 + i, FACE + 0.002 + i * 0.003, () => this.regionTip(r));
      this.regionPrint(c.print, r);
      if (!j.reached[r]) {
        // not ridden into yet: a padlocked chain across it
        const lc = geoOf(safe(() => WS.lockChain(30, 50 + i)), 'center');
        const ch = add(lc, 0, RH * 0.45, 0.03, c.grp);
        if (ch) ch.rotation.z = (i - 1.5) * 0.06;
      }
      // the bounty tokens under it, one per boss that first rides out there
      const list = BOSSES[r];
      list.forEach((b, bi) => {
        const paid = j.beaten.has(b.id);
        const g = geoOf({ model: tokenModel(paid), voxelSize: 1 / 160 }, 'center');
        const tx = RX[i] + (bi - (list.length - 1) / 2) * 0.06, ty = RY - 0.075;
        const tm = add(g, tx, ty, FACE + 0.008);
        if (tm) {
          tm.rotation.z = Math.sin(bi * 2.1 + i) * 0.2;
          this.sway.push({ o: tm, ph: bi + i * 3, a: 0.04 });
          this.tokens.push({ obj: tm, tip: () => (paid ? `${b.name}: paid in full` : `${b.name}: still out there (wave ${b.wave})`) });
        }
      });
    });
    for (let i = 0; i < 2; i++) {
      const tw = geoOf({ model: twineModel(new THREE.Vector2(RX[i] + 0.02, RY + RH - 0.04), new THREE.Vector2(RX[i + 1] - 0.02, RY + RH - 0.04)), voxelSize: 1 / 96 }, [0, 0, 0]);
      add(tw, 0, 0, FACE + 0.02);
    }
    // ---- finds, the codex, the note of what is next
    const finds = this.card(-0.5, 0.1, 0.44, 0.3, 61, FACE + 0.003, () => `Blueprints ${j.bp.found} of ${j.bp.total} · relics ${j.relics.found} of ${j.relics.total}`);
    finds.print.set([
      ['FINDS', 0.17, '#7a1a10'],
      [`Blueprints  ${j.bp.found} / ${j.bp.total}`, 0.15, '#2a1a0e'],
      [`Relics  ${j.relics.found} / ${j.relics.total}`, 0.15, '#2a1a0e'],
      ['kept forever, whatever happens', 0.1, '#6a4a28'],
    ]);
    const scroll = safe(() => blueprintScroll('gun'));
    if (scroll) {
      const sm = add(buildVoxelGeometry(scroll.model, { voxelSize: scroll.voxelSize, pivot: 'center' }), -0.32, 0.41, FACE + 0.035);
      if (sm) {
        sm.rotation.set(Math.PI / 2 - 0.2, 0, 0.5);
        sm.scale.setScalar(0.8);
      }
    }
    const ankh = safe(() => ankhFragment());
    if (ankh) {
      const am = add(buildVoxelGeometry(ankh.model, { voxelSize: ankh.voxelSize, pivot: 'center' }), -0.69, 0.41, FACE + 0.03);
      if (am) am.rotation.set(Math.PI / 2 - 0.15, 0, -0.3);
    }
    const codex = this.card(-0.02, 0.12, 0.36, 0.27, 62, FACE + 0.005, () => `Codex: ${j.codex.pts} points (${j.codex.title})`);
    codex.print.set([
      ['THE CODEX', 0.16, '#7a1a10'],
      [`${j.codex.pts} points`, 0.17, '#2a1a0e'],
      [j.codex.title, 0.14, '#4a2a14'],
      [j.codex.next ? `${Math.max(0, j.codex.next.at - j.codex.pts)} more: ${j.codex.next.title}` : 'every page is full', 0.1, '#6a4a28'],
    ]);
    const note = this.card(0.47, 0.07, 0.48, 0.42, 63, FACE + 0.002, () => 'What to work toward next');
    note.print.set([['NEXT UP', 0.12, '#7a1a10'], ...j.next.map((t): [string, number, string, boolean] => [t, 0.075, '#2a1a0e', true])]);
    // ---- the views: the whole board, the route, the note
    const cam = (x: number, y: number, d: number, fov: number): View => ({ pos: this.W(x, y, d), look: this.W(x, y, 0), fov });
    this.views = [cam(0, 0.62, 1.55, 46), cam(0, 0.72, 0.95, 42), cam(0.46, 0.3, 0.8, 42)];
    // ---- the station: he stands back by the garage post, looking it over
    const stand = new THREE.Vector2(-2.62, 1.95);
    this.st = k.station({
      id: 'bounty', label: 'The Long Ride', title: 'THE LONG RIDE', short: 'LONG RIDE', sub: this.subline(), verb: 'Read the board',
      stand, face: Math.atan2(AT.x - stand.x, AT.z - stand.y), at: this.W(0, 0.62, 0), r: 0.9, objs: [this.root], pose: 'range',
      via: [new THREE.Vector2(-2.62, 0.25)], slot: [-0.86, 0.84, 'left'],
      shot: { pos: new THREE.Vector3(-1.7, 1.62, 0.2), look: new THREE.Vector3(), fov: 50, subject: this.W(0.15, 0.62, 0), ndc: [-0.18, 0.02] },
    });
  }

  private subline() {
    const j = this.j;
    const total = REGIONS.reduce((a, r) => a + BOSSES[r].length, 0);
    return `${j.beaten.size} of ${total} bounties paid · best wave ${j.best}`;
  }

  /** a pinned card (board space, bottom-left corner + size, m) with its print */
  private card(cx: number, y: number, w: number, hh: number, seed: number, z: number, tip: () => string): Card {
    const NV = 1 / 80;
    const wv = Math.round(w / NV), hv = Math.round(hh / NV);
    const grp = new THREE.Group();
    grp.position.set(cx, y, z);
    grp.rotation.z = Math.sin(seed * 1.7) * 0.025;
    const g = buildVoxelGeometry(noteModel(wv, hv, seed), { voxelSize: NV, pivot: [0, 0, 0] });
    grp.add(meshOf(g, sharedVoxelMaterial, true));
    const print = new Print(w * 0.92, hh * 0.72, 448);
    print.mesh.position.set(0, hh * 0.42, NV + 0.0006);
    grp.add(print.mesh);
    this.root.add(grp);
    const c = { grp, print, tip };
    this.cards.push(c);
    return c;
  }

  private regionPrint(p: Print, r: RegionKey) {
    const j = this.j;
    const [w0, w1] = REGION_WAVES[r];
    const paid = BOSSES[r].filter((b) => j.beaten.has(b.id)).length;
    const best = j.best >= w0 ? Math.min(j.best, w1) : 0;
    p.set([
      [REGION_NAMES[r], 0.2, '#2a1a0e'],
      [j.reached[r] ? (best ? `best wave ${best} of ${w1}` : `waves ${w0} to ${w1}`) : `opens after wave ${w0 - 1}`, 0.15, j.reached[r] ? '#4a2a14' : '#7a1a10'],
      [`bounties ${paid} / ${BOSSES[r].length}`, 0.14, '#6a4a28'],
    ]);
  }
  private regionTip(r: RegionKey) {
    const j = this.j;
    const paid = BOSSES[r].filter((b) => j.beaten.has(b.id)).length;
    const rel = j.relics.per[r];
    return `${REGION_NAMES[r]}: ${j.reached[r] ? `${paid} of ${BOSSES[r].length} bounties paid` : `locked until wave ${REGION_WAVES[r][0] - 1}`}${rel ? ` · relics ${rel[0]}/${rel[1]}` : ''}`;
  }

  // ---------------------------------------------------------------- the mode
  enter(): Mode | null {
    this.j = journey();
    this.done = false;
    this.vi = 0;
    return this;
  }
  view(): View | null {
    return this.views[this.vi] ?? null;
  }
  step(d: number) {
    const n = this.views.length;
    this.vi = (((this.vi + d) % n) + n) % n;
  }
  hint() {
    return 'Hover anything on the board   ·   A / D: the board, the route, the note   ·   Esc: done';
  }
  back() {
    this.done = true;
    return true;
  }
  picks(): Pick[] {
    return [...this.cards.map((c) => ({ obj: c.grp, tip: c.tip, click: () => this.h.engine.audio.play('paper_flutter', { volume: 0.35, pitch: 1.2 }) })), ...this.tokens.map((t) => ({ obj: t.obj, tip: t.tip, click: () => this.h.engine.audio.play('gem_chime', { volume: 0.3, pitch: 0.8 }), lift: false }))];
  }
  update(_t: number, _rdt: number) {
    /* the cards and tokens stay pinned; HouseExtras moves the camera */
  }
  /** always: the tokens sway on their nails; a word from Sundown when he walks up */
  tick(t: number, rdt: number) {
    for (const s of this.sway) s.o.rotation.z = Math.sin(t * 1.1 + s.ph) * s.a;
    this.greet = Math.max(0, this.greet - rdt);
  }
  arrive() {
    if (this.greet > 0) return;
    this.greet = 40;
    const j = this.j;
    const left = REGIONS.flatMap((r) => BOSSES[r]).filter((b) => !j.beaten.has(b.id));
    const line = !left.length
      ? 'Every bounty in the Reach, paid in full. Almost feels like retiring.'
      : left.length >= 10
        ? 'A long ride ahead. Best get started.'
        : `${left[0].name} next. ${left.length} bounties still riding.`;
    this.bubble.say(line);
  }
  dispose() {
    for (const c of this.cards) c.print.dispose();
    this.root.removeFromParent();
  }
}

/**
 * Hook the board into the hideout: HouseExtras builds, updates and disposes it,
 * its E opens the board, and the carousel's E on the station reaches it.
 * Call once, before HouseExtras.build (one line in HouseExtras' constructor).
 */
export function installBountyBoard(ex: HouseExtras, h: HubHost) {
  const board = new BountyBoard(h, ex.bubble);
  const X = ex as unknown as {
    build(k: BuildKit): void;
    use(st: HubStation): boolean;
    update(t: number, rdt: number): void;
    dispose(): void;
    verbFor(st: HubStation): string | null;
    onArrive(st: HubStation): void;
    begin(m: Mode): void;
  };
  const b0 = X.build.bind(ex), u0 = X.use.bind(ex), up0 = X.update.bind(ex), d0 = X.dispose.bind(ex), a0 = X.onArrive.bind(ex);
  X.build = (k) => {
    b0(k);
    try {
      board.build(k);
    } catch (e) {
      console.warn('[hub+] bounty board', e);
    }
  };
  X.use = (st) => {
    if (st.id !== 'bounty') return u0(st);
    const m = board.enter();
    if (m) X.begin(m);
    return true;
  };
  X.update = (t, rdt) => {
    up0(t, rdt);
    board.tick(t, rdt);
  };
  X.onArrive = (st) => {
    a0(st);
    if (st.id === 'bounty') board.arrive();
  };
  X.dispose = () => {
    board.dispose();
    d0();
  };
  // the carousel only hands E to the extras for the stations it knows: let it reach the board too
  const host = h as unknown as { use(st: HubStation): void };
  if (typeof host.use === 'function') {
    const hu = host.use.bind(h);
    host.use = (st: HubStation) => (st.id === 'bounty' ? void X.use(st) : hu(st));
  }
  return board;
}

