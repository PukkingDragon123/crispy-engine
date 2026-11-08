// THE CODEX: Sundown's old leather field book, opened on a walnut desk under an
// oil lamp. A thick tooled cover with a gilt title, brass corners and a clasp; a
// silk ribbon in the gutter; yellowed, stained, dog-eared pages that turn with a real
// 3D curl; leather thumb-tabs for the chapters (Bounties, Bosses, Wildlife, Loot &
// Gear, Blueprints, Places, Legends, Moves & Cards). Each entry is a spread: a live,
// animated 3D plate on the left (hold the cursor on it and the creature attacks;
// unknown ones are silhouettes) and the typeset account on the right (lore, stats,
// song-titled moves, weaknesses, kills, the points it was worth, a rubber stamp).
//
// Opened from the hideout's Book of Skills lectern. The hub hands over its
// scene/camera; the book swaps the post stack to its own and back on close.
//
// THE CODEX IS NOW THOTH'S HALL: `CodexBook` (what the hideout and the menu open) is the
// hall (scenes/ThothHall.ts). The old field book stays here as `FieldBook`, untouched.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import type { RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { hash3 } from '../../engine/math/rand';
import { sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import * as HX from '../models/props/hideout';
import { Particles } from '../fx/Particles';
import { Codex } from '../meta/Codex';
import { BOOK, BM, BV, coverBoard, spine, pageBlock, strap, desk, inkwell, ribbonGeometry, prof } from './codex/BookModels';
import { PageSheet, FaceContent } from './codex/PageSheet';
import { paintPage, PageSpec, Painted, PLATE_RECT, Link, TITLE_ROWS, INDEX_ROWS } from './codex/PageInk';
import { Plate, PLATE_RES } from './codex/Plate';

export interface CodexBookOpts {
  hero: RigSpec | null;
  /** the scene and camera to hand the screen back to */
  back: { scene: THREE.Scene; camera: THREE.Camera };
  onClosed: () => void;
}

interface Spread {
  L: PageSpec;
  R: PageSpec;
}
interface Turn {
  leaf: number;
  dir: 1 | -1;
  t: number;
  dur: number;
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const MIN_T = 0.0035;
const TAB_COLORS = [0x7a2418, 0x3a2a5a, 0x4a6a2a, 0x9a6a1a, 0x1e4a6e, 0x8a4a2a, 0x2a5a5a, 0x5a2a4a];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

/** the rubber stamp's word (white; the page shader inks and presses it) */
function stampWord(word: string) {
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = '64px Alagard';
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(m.measureText(word).width) + 48;
  cv.height = 92;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.font = '64px Alagard';
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(word, cv.width / 2, cv.height / 2 + 4);
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return { tex: t, w: cv.width, h: cv.height };
}

/** a leather thumb-tab, stitched where it is glued to the leaf, worn round its lip */
function tabModel(color: number, seed: number) {
  const m = new VoxelModel('codex_tab');
  const OUT = 12, IN = 4, W = 14;
  for (let x = -IN; x < OUT; x++)
    for (let z = 0; z < W; z++) {
      const lip = OUT - 1 - x;
      const cz = Math.min(z, W - 1 - z);
      if (lip < 3 && cz < 3 && Math.hypot(3 - lip, 3 - cz) > 3.2) continue;
      const n = hash3(x, z, seed);
      let c = n > 0.5 ? color : ((color & 0xfefefe) >> 1) + ((color & 0xfcfcfc) >> 2);
      if (lip < 2 || cz < 1) c = ((c & 0xfefefe) >> 1) + 0x302418;
      if (x === 0 && z % 3 === 1) c = 0xd8c8a0;
      m.set(x, 0, z, c, VF.SOFTAO);
      m.set(x, -1, z, c, VF.SOFTAO);
    }
  return buildVoxelGeometry(m, { voxelSize: BV, pivot: [0, 0, W / 2] });
}

function labelTexture(text: string) {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.font = '32px Alagard';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#3a2408';
  c.fillText(text, 33, 35);
  c.fillStyle = '#f0c45a';
  c.fillText(text, 32, 33);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export class FieldBook {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, 0.02, 30);
  private state: 'idle' | 'opening' | 'open' | 'closing' | 'done' = 'idle';
  private t = 0;
  private spreads: Spread[] = [];
  private starts: number[] = [];
  private cur = 0;
  private turn: Turn | null = null;
  private steps: Turn[] = [];
  private book = new THREE.Group();
  private hinge = new THREE.Group();
  private inner = new THREE.Group();
  private spineG = new THREE.Group();
  private blockR!: THREE.Mesh;
  private blockL!: THREE.Mesh;
  private sheetL = new PageSheet(0.21);
  private sheetR = new PageSheet(0.63);
  private sheetT = new PageSheet(0.47);
  private band = new THREE.Group();
  private tongue = new THREE.Group();
  private ribbon: THREE.Mesh | null = null;
  private ribbonPts: THREE.Vector3[] = [];
  private tabs: { g: THREE.Group; mesh: THREE.Mesh; label: THREE.Mesh; sec: number; hover: number; name: string }[] = [];
  private plates = [new Plate(), new Plate()];
  private platesUsed: Plate[] = [];
  private cache = new Map<string, { painted: Painted; tex: THREE.CanvasTexture; used: number }>();
  private stamps = new Map<string, ReturnType<typeof stampWord>>();
  private faceL: FaceContent | null = null;
  private faceR: FaceContent | null = null;
  private linksL: Link[] = [];
  private linksR: Link[] = [];
  private particles = new Particles();
  private lampLight!: THREE.PointLight;
  private flame = new THREE.Vector3();
  private key!: THREE.DirectionalLight;
  private ray = new THREE.Raycaster();
  private hoverKey = '';
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private par = new THREE.Vector2();
  private ui = document.createElement('div');
  private header = document.createElement('div');
  private hint = document.createElement('div');
  private tip = document.createElement('div');
  private closeBtn = document.createElement('button');
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private texs: THREE.Texture[] = [];
  private theta = 0;
  private strapK = 0;
  private frame = 0;

  constructor(private engine: Engine, private o: CodexBookOpts) {}

  // ======================================================================= build
  private own<T extends THREE.BufferGeometry>(g: T) {
    this.geos.push(g);
    return g;
  }

  private build() {
    const s = this.scene;
    s.background = new THREE.Color(0x0c0705);
    s.fog = new THREE.Fog(0x0c0705, 1.4, 3.6);
    // ---- the room: a warm key from the lamp side, a cool window from behind, a dim fill
    this.key = new THREE.DirectionalLight(0xffd6a8, 2.3);
    this.key.position.set(-0.9, 1.7, 0.75);
    this.key.target.position.set(0, 0, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0003;
    this.key.shadow.normalBias = 0.006;
    const sc = this.key.shadow.camera;
    sc.left = -0.62;
    sc.right = 0.62;
    sc.top = 0.5;
    sc.bottom = -0.5;
    sc.near = 0.6;
    sc.far = 3.6;
    const rim = new THREE.DirectionalLight(0x8aa4dc, 0.55);
    rim.position.set(0.9, 0.9, -1.3);
    s.add(this.key, this.key.target, rim, new THREE.HemisphereLight(0x8a7e9e, 0x2a160c, 0.5));
    // ---- the desk, the lamp, the inkwell
    const dk = desk();
    const deskM = new THREE.Mesh(this.own(dk.geo), sharedVoxelMaterial);
    deskM.receiveShadow = true;
    deskM.position.y = 0;
    s.add(deskM);
    try {
      const ol = HX.oilLamp();
      const lamp = new THREE.Mesh(this.own(buildVoxelGeometry(ol.model, { voxelSize: ol.voxelSize, pivot: 'bottom' })), sharedVoxelMaterial);
      lamp.position.set(-0.56, 0, -0.24);
      lamp.scale.setScalar(1.15);
      lamp.castShadow = true;
      s.add(lamp);
      this.flame.set(ol.meta.flame[0], ol.meta.flame[1], ol.meta.flame[2]).multiplyScalar(1.15).add(lamp.position);
    } catch (e) {
      console.warn('[codex] lamp', e);
      this.flame.set(-0.56, 0.3, -0.24);
    }
    this.lampLight = new THREE.PointLight(0xffb060, 1.4, 2.4, 1.6);
    this.lampLight.position.copy(this.flame).add(new THREE.Vector3(0, 0.04, 0));
    s.add(this.lampLight);
    const ink = new THREE.Mesh(this.own(inkwell()), sharedVoxelMaterial);
    ink.position.set(0.5, 0, -0.2);
    ink.rotation.y = -0.5;
    ink.castShadow = ink.receiveShadow = true;
    s.add(ink);
    s.add(this.particles.group);
    // ---- the book
    const { BT, TB, CW } = BM;
    const h = BT + TB / 2;
    s.add(this.book);
    this.book.position.set(0, 0.0005, 0.02);
    const front = new THREE.Mesh(this.own(coverBoard(true)), sharedVoxelMaterial);
    front.rotation.z = Math.PI;
    front.position.y = BT;
    const back = new THREE.Mesh(this.own(coverBoard(false)), sharedVoxelMaterial);
    back.rotation.x = Math.PI;
    back.position.y = BT;
    for (const m of [front, back]) m.castShadow = m.receiveShadow = true;
    const blk = this.own(pageBlock());
    this.blockR = new THREE.Mesh(blk, sharedVoxelMaterial);
    this.blockL = new THREE.Mesh(blk, sharedVoxelMaterial);
    this.blockR.position.y = BT;
    this.blockL.position.y = BT;
    for (const m of [this.blockR, this.blockL]) m.castShadow = m.receiveShadow = true;
    this.hinge.position.set(0, h, 0);
    this.inner.position.set(0, -h, 0);
    this.hinge.add(this.inner);
    this.inner.add(front, this.blockL, this.sheetL.mesh);
    this.book.add(this.hinge, back, this.blockR, this.sheetR.mesh, this.sheetT.mesh);
    const sp = new THREE.Mesh(this.own(spine()), sharedVoxelMaterial);
    sp.castShadow = true;
    this.spineG.add(sp);
    this.book.add(this.spineG);
    // the clasp strap: hinged on the back board's fore-edge
    const st = strap();
    const bandM = new THREE.Mesh(this.own(st.band), sharedVoxelMaterial);
    const tongueM = new THREE.Mesh(this.own(st.tongue), sharedVoxelMaterial);
    bandM.castShadow = tongueM.castShadow = true;
    this.band.position.set(CW, 0, 0);
    this.band.add(bandM, this.tongue);
    this.tongue.position.set(0, st.height, 0);
    this.tongue.add(tongueM);
    this.book.add(this.band);
    // the ribbon, deep red silk, swallow-tailed
    this.ribbonPts = [
      new THREE.Vector3(0.0, BT + 0.0028, -BM.PH / 2 - 0.004),
      new THREE.Vector3(0.0008, BT + 0.0028, -BM.PH / 4),
      new THREE.Vector3(0.0012, BT + 0.0028, 0),
      new THREE.Vector3(0.0018, BT + 0.0028, BM.PH / 4),
      new THREE.Vector3(0.0022, BT + 0.0024, BM.PH / 2 + 0.002),
      new THREE.Vector3(0.004, BT * 0.55, BM.PH / 2 + 0.011),
      new THREE.Vector3(0.008, 0.0015, BM.PH / 2 + 0.024),
      new THREE.Vector3(0.014, 0.0012, BM.PH / 2 + 0.05),
      new THREE.Vector3(0.022, 0.0012, BM.PH / 2 + 0.078),
      new THREE.Vector3(0.032, 0.0012, BM.PH / 2 + 0.104),
    ];
    const rmat = new THREE.MeshStandardMaterial({ color: 0x7a1414, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide });
    rmat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvRUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRUv;')
        .replace('#include <map_fragment>', '#include <map_fragment>\nif (vRUv.y > 0.93 && abs(vRUv.x - 0.5) < (vRUv.y - 0.93) * 7.0) discard;\ndiffuseColor.rgb *= 0.82 + 0.18 * sin(vRUv.x * 40.0) * sin(vRUv.x * 40.0) + 0.12 * step(0.9, vRUv.y);');
    };
    this.mats.push(rmat);
    this.ribbon = new THREE.Mesh(ribbonGeometry(this.ribbonPts, 0.011), rmat);
    this.ribbon.castShadow = true;
    this.ribbon.receiveShadow = true;
    this.book.add(this.ribbon);
    // ---- the chapters
    const secs = Codex.sections();
    this.spreads.push({ L: { kind: 'frontis' }, R: { kind: 'contents' } });
    secs.forEach((sec, i) => {
      this.starts[i] = this.spreads.length;
      // the chapter title opens the index; long chapters run on over more index pages
      const n = sec.entries.length;
      this.spreads.push({ L: { kind: 'title', s: i }, R: { kind: 'index', s: i, from: TITLE_ROWS, to: TITLE_ROWS + INDEX_ROWS } });
      for (let from = TITLE_ROWS + INDEX_ROWS; from < n; from += INDEX_ROWS * 2)
        this.spreads.push({ L: { kind: 'index', s: i, from, to: from + INDEX_ROWS }, R: from + INDEX_ROWS < n ? { kind: 'index', s: i, from: from + INDEX_ROWS, to: from + INDEX_ROWS * 2 } : { kind: 'end' } });
      for (const e of sec.entries) this.spreads.push({ L: { kind: 'plate', key: e.key }, R: { kind: 'entry', key: e.key } });
    });
    this.starts[secs.length] = this.spreads.length;
    this.spreads.push({ L: { kind: 'moves' }, R: { kind: 'cards' } });
    this.spreads.push({ L: { kind: 'end' }, R: { kind: 'end' } });
    const names = [...secs.map((x) => x.name), 'Moves & Cards'];
    names.forEach((name, i) => {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(this.own(tabModel(TAB_COLORS[i % TAB_COLORS.length], i + 3)), sharedVoxelMaterial);
      mesh.castShadow = true;
      const tex = labelTexture(ROMAN[i]);
      this.texs.push(tex);
      const lm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, metalness: 0.4, depthWrite: false });
      this.mats.push(lm);
      const label = new THREE.Mesh(this.own(new THREE.PlaneGeometry(0.03, 0.03)), lm);
      label.rotation.x = -Math.PI / 2;
      label.position.set(0.0215, BV + 0.0003, 0);
      g.add(mesh, label);
      this.book.add(g);
      this.tabs.push({ g, mesh, label, sec: i, hover: 0, name });
    });
    // ---- the screen furniture: rank and points, the hints, a close button, a tooltip
    this.ui.style.cssText = 'position:absolute;inset:0;z-index:8;pointer-events:none';
    this.header.style.cssText = "position:absolute;left:26px;top:20px;font-family:'Alagard';font-size:22px;color:#ffd36b;text-shadow:0 3px 0 #2a1408,0 0 12px #000;opacity:0;transition:opacity .8s";
    this.hint.style.cssText = "position:absolute;left:50%;bottom:20px;transform:translateX(-50%);font-family:'Alagard';font-size:15px;color:#fff3d6;opacity:0;transition:opacity .8s;text-shadow:0 2px 0 #2a1408,0 0 8px #000;white-space:nowrap";
    this.hint.textContent = 'A / D: turn the page   ·   click a tab or a chapter   ·   hold the cursor on a plate   ·   Esc: close';
    this.tip.style.cssText = "position:absolute;display:none;font-family:'Alagard';font-size:17px;color:#fff3d6;text-shadow:0 2px 0 #2a1408,0 0 10px #000;white-space:nowrap";
    this.closeBtn.textContent = 'CLOSE';
    this.closeBtn.style.cssText = "position:absolute;right:24px;top:18px;pointer-events:auto;font-family:'Alagard';font-size:18px;padding:5px 14px;background:#7a4a28;color:#fff3d6;border:3px solid #2a1408;box-shadow:0 4px 0 #2a1408;cursor:pointer;opacity:0;transition:opacity .8s";
    this.closeBtn.onmousedown = (e) => e.stopPropagation();
    this.closeBtn.onclick = () => this.close();
    this.ui.append(this.header, this.hint, this.tip, this.closeBtn);
    this.engine.overlay.appendChild(this.ui);
    this.updateHeader();
    // first spread
    this.showStatic(0);
    this.layout(0, false);
  }

  private updateHeader() {
    const pts = Codex.points(), rk = Codex.rank(pts);
    this.header.innerHTML = `${rk.title.toUpperCase()}<span style="color:#fff3d6;opacity:.85"> · ${pts} pts</span>`;
  }

  // ======================================================================= open / close
  async open() {
    const eng = this.engine;
    eng.audio.play('paper_flutter', { volume: 0.4, pitch: 0.8 });
    await eng.fadeOut(0.3);
    try {
      this.build();
    } catch (e) {
      console.error('[codex] build failed', e);
    }
    eng.post.setSceneCamera(this.scene, this.camera);
    this.state = 'opening';
    this.t = 0;
    this.theta = 0;
    this.strapK = 0;
    this.shotClosed(1);
    eng.input.setWantLock(false);
    (window as any).__codex = this;
    void eng.fadeIn(0.45);
  }

  close() {
    if (this.state !== 'open') return;
    this.state = 'closing';
    this.t = 0;
    // a leaf caught mid-turn settles back where it came from before the cover comes down
    if (this.turn) {
      const back = this.turn.dir > 0 ? this.turn.leaf : this.turn.leaf + 1;
      this.turn = null;
      this.showStatic(back);
    }
    this.steps = [];
    this.tip.style.display = 'none';
    document.body.style.cursor = 'default';
    this.engine.audio.play('book_close', { volume: 0.8 });
    for (const el of [this.header, this.hint, this.closeBtn]) el.style.opacity = '0';
  }

  private async finishClose() {
    const eng = this.engine;
    this.state = 'done';
    await eng.fadeOut(0.3);
    eng.post.setSceneCamera(this.o.back.scene, this.o.back.camera);
    void eng.fadeIn(0.4);
    this.o.onClosed();
  }

  // ======================================================================= pages
  private painted(spread: number, side: 'L' | 'R') {
    const id = `${spread}:${side}`;
    let c = this.cache.get(id);
    if (!c) {
      const sp = this.spreads[spread];
      const painted = paintPage(side === 'L' ? sp.L : sp.R, spread * 2 + (side === 'L' ? 0 : 1), side === 'L');
      const tex = new THREE.CanvasTexture(painted.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      c = { painted, tex, used: 0 };
      this.cache.set(id, c);
      // keep a handful of pages warm
      if (this.cache.size > 16) {
        const old = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.cache.size - 16);
        for (const [k, v] of old) {
          v.tex.dispose();
          this.cache.delete(k);
        }
      }
    }
    c.used = ++this.frame;
    return c;
  }

  /** forget the pages whose ink depends on the book's state (indices, contents, the frontispiece) */
  private repaintIndices() {
    for (const [k, v] of [...this.cache.entries()]) {
      const [si, side] = k.split(':');
      const sp = this.spreads[+si];
      const kind = (side === 'L' ? sp.L : sp.R).kind;
      if (kind === 'title' || kind === 'index' || kind === 'contents' || kind === 'frontis') {
        v.tex.dispose();
        this.cache.delete(k);
      }
    }
  }

  private plateKey(spread: number) {
    const L = this.spreads[spread]?.L;
    return L?.kind === 'plate' ? L.key : null;
  }

  /** assign live plates to the plate pages on screen (at most two at once) */
  private platesFor(keys: (string | null)[]) {
    const want = keys.filter((k): k is string => !!k);
    const used: Plate[] = [];
    const free = this.plates.filter((p) => !p.entry || !want.includes(p.entry.key));
    for (const k of want) {
      let p = this.plates.find((q) => q.entry?.key === k && !used.includes(q));
      if (!p) p = free.shift() ?? this.plates.find((q) => !used.includes(q))!;
      const e = Codex.entry(k)!;
      p.set(e, !Codex.known(k), this.o.hero);
      used.push(p);
    }
    this.platesUsed = used;
    return used;
  }

  private face(spread: number, side: 'L' | 'R'): FaceContent | null {
    if (spread < 0 || spread >= this.spreads.length) return null;
    const c = this.painted(spread, side);
    const fc: FaceContent = { ink: c.tex, seed: hash3(spread, side === 'L' ? 1 : 2, 7) };
    const sp = this.spreads[spread];
    if (side === 'L' && sp.L.kind === 'plate') {
      const p = this.plates.find((q) => q.entry?.key === (sp.L as any).key);
      if (p) fc.plate = { tex: p.rt.texture, depth: p.rt.depthTexture!, rect: PLATE_RECT, style: p.style, near: p.camera.near, far: p.camera.far };
    }
    if (side === 'R' && c.painted.stamp) {
      let s = this.stamps.get(c.painted.stamp);
      if (!s) this.stamps.set(c.painted.stamp, (s = stampWord(c.painted.stamp)));
      const H = 1;
      fc.stamp = { map: s.tex, rect: [0.7, 1 - 0.83, (s.w / 2 / 1075) * 0.85 * H, (s.h / 2 / 1075) * 0.85], ang: 0.2 + (fc.seed - 0.5) * 0.2, color: new THREE.Color(c.painted.stamp === 'MASTERED' ? '#1e5a8a' : '#a8281a') };
    }
    return fc;
  }

  private ear(spread: number, side: 'L' | 'R') {
    const n = hash3(spread, side === 'L' ? 5 : 9, 3);
    return n > 0.84 ? 0.07 + (n - 0.84) * 0.25 : 0;
  }

  /** resting on a spread: both statics show it, no turning leaf */
  private showStatic(spread: number) {
    this.cur = spread;
    this.platesFor([this.plateKey(spread)]);
    this.faceL = this.face(spread, 'L');
    this.faceR = this.face(spread, 'R');
    this.sheetL.setFace('B', this.faceL);
    this.sheetR.setFace('F', this.faceR);
    // the other sides only ever peek out of a dog-eared corner: plain paper
    this.sheetL.setFace('F', { ink: null, seed: 0.3 });
    this.sheetR.setFace('B', { ink: null, seed: 0.8 });
    this.linksL = this.painted(spread, 'L').painted.links;
    this.linksR = this.painted(spread, 'R').painted.links;
    this.sheetT.mesh.visible = false;
    // reading an entry clears its NEW mark (and the indices are inked again)
    const R = this.spreads[spread].R;
    if (R.kind === 'entry') {
      const f0 = Codex.flags(R.key);
      Codex.markRead(R.key);
      if (Codex.flags(R.key) !== f0) this.repaintIndices();
    }
    this.updateHeader();
  }

  /** a leaf starts turning: statics show the spreads either side, the leaf carries the pages in between */
  private beginTurn(t: Turn) {
    const k = t.leaf;
    this.turn = t;
    // a riffle flips too fast to stage dioramas: only a proper turn carries live plates
    this.platesFor(t.dur > 0.4 ? [this.plateKey(k), this.plateKey(k + 1)] : []);
    this.faceL = this.face(k, 'L');
    this.faceR = this.face(k + 1, 'R');
    if (t.dur <= 0.4 && this.faceL) this.faceL.plate = null;
    this.sheetL.setFace('B', this.faceL);
    this.sheetR.setFace('F', this.faceR);
    this.sheetT.setFace('F', this.face(k, 'R'));
    const back = this.face(k + 1, 'L');
    if (back && t.dur <= 0.4) back.plate = null;
    this.sheetT.setFace('B', back);
    this.sheetT.mesh.visible = true;
    if (t.dur > 0.4) this.engine.audio.play('page_turn', { volume: 0.55, pitch: 0.9 + Math.random() * 0.2 });
    else if (Math.random() < 0.6) this.engine.audio.play('paper_flutter', { volume: 0.25, pitch: 1.3 + Math.random() * 0.3 });
  }

  /** go to a spread: one turn, or a riffle of quick turns ending on a proper one */
  goTo(target: number) {
    target = Math.max(0, Math.min(this.spreads.length - 1, target));
    if (this.state !== 'open' || this.turn || target === this.cur) return;
    const c = this.cur;
    const steps: Turn[] = [];
    const n = Math.abs(target - c);
    if (target > c) {
      const k = Math.min(5, n);
      for (let i = 0; i < k; i++) {
        const leaf = k === 1 ? c : Math.round(c + (i * (target - 1 - c)) / (k - 1));
        steps.push({ leaf, dir: 1, t: 0, dur: i === k - 1 ? 0.78 : 0.2 });
      }
    } else {
      const k = Math.min(5, n);
      for (let i = 0; i < k; i++) {
        const leaf = k === 1 ? c - 1 : Math.round(c - 1 - (i * (c - 1 - target)) / (k - 1));
        steps.push({ leaf, dir: -1, t: 0, dur: i === k - 1 ? 0.78 : 0.2 });
      }
    }
    this.steps = steps;
    this.beginTurn(this.steps.shift()!);
  }

  /** the blocks' thicknesses for a (fractional) spread position */
  private thick(pos: number) {
    const f = pos / Math.max(1, this.spreads.length - 1);
    const tL = MIN_T + (BM.TB - 2 * MIN_T) * f;
    return { tL, tR: BM.TB - tL };
  }

  /** shape the leaves, the blocks, the tabs for a spread position */
  private layout(pos: number, turning: boolean) {
    const { tL, tR } = this.thick(pos);
    this.blockR.scale.set(1, tR / BM.TB, 1);
    this.blockL.scale.set(-1, tL / BM.TB, 1);
    this.liftK += ((this.hoverKey === 'next' && !turning ? 1 : 0) - this.liftK) * 0.18;
    this.sheetL.shape(1, tR, tL, 1, this.ear(this.cur, 'L'));
    this.sheetR.shape(0, tR, tL, 1, this.ear(this.cur, 'R'), this.liftK * 0.007);
    // thumb-tabs: glued to the leaf before each chapter, riding in the left or the right block
    const leaves = this.spreads.length - 1;
    const leafT = BM.TB / leaves;
    this.tabs.forEach((tb, i) => {
      const leaf = this.starts[tb.sec] - 1;
      const onLeft = leaf < pos - 0.5;
      const depth = onLeft ? pos - 1 - leaf : leaf - pos;
      const y = BM.BT + (onLeft ? tL : tR) - Math.max(0.5, depth + 0.5) * leafT;
      const z = -BM.PH / 2 + 0.034 + i * ((BM.PH - 0.068) / 7);
      tb.g.position.set(onLeft ? -BM.PW + 0.001 : BM.PW - 0.001, Math.max(BM.BT + 0.0008, y) + tb.hover * 0.003, z);
      tb.g.rotation.set(0, 0, 0);
      tb.g.scale.set(onLeft ? -1 : 1, 1, 1);
      tb.label.scale.x = onLeft ? -1 : 1;
    });
  }
  private liftK = 0;

  // ======================================================================= camera
  private shotOpen(out: THREE.Vector3, look: THREE.Vector3) {
    const asp = this.engine.width / this.engine.height;
    const vf = THREE.MathUtils.degToRad(this.camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * asp);
    const W = 0.76, D = 0.5;
    const dW = W / 2 / Math.tan(hf / 2);
    const dH = (D * 0.8) / 2 / Math.tan(vf / 2);
    const d = Math.max(dW, dH) + 0.06;
    const dir = new THREE.Vector3(0, 0.86, 0.51).normalize();
    look.set(0, 0.03, 0.045);
    out.copy(look).addScaledVector(dir, d);
  }

  private shotClosed(k: number) {
    const p = new THREE.Vector3(BM.CW * 0.55 + 0.04, 0.5, 0.4), l = new THREE.Vector3(BM.CW * 0.5, 0.04, 0.03);
    if (k >= 1) {
      this.camPos.copy(p);
      this.camLook.copy(l);
    }
    return { p, l };
  }

  private updateCamera(rdt: number) {
    const o = new THREE.Vector3(), ol = new THREE.Vector3();
    this.shotOpen(o, ol);
    const c = this.shotClosed(0);
    let w = 1;
    if (this.state === 'opening') w = ease(clamp01((this.t - 0.55) / 1.9));
    else if (this.state === 'closing' || this.state === 'done') w = 1 - ease(clamp01(this.t / 1.1));
    const P = c.p.lerp(o, w), L = c.l.lerp(ol, w);
    const inp = this.engine.input;
    this.par.x += ((this.state === 'open' ? inp.ndcX : 0) - this.par.x) * (1 - Math.exp(-rdt * 2));
    this.par.y += ((this.state === 'open' ? inp.ndcY : 0) - this.par.y) * (1 - Math.exp(-rdt * 2));
    const t = this.engine.realTime;
    P.x += this.par.x * 0.025 + Math.sin(t * 0.21) * 0.004;
    P.y += this.par.y * 0.012 + Math.sin(t * 0.17) * 0.003;
    const k = 1 - Math.exp(-rdt * 5);
    this.camPos.lerp(P, k);
    this.camLook.lerp(L, k);
    const cam = this.camera;
    cam.aspect = this.engine.width / this.engine.height;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    cam.updateProjectionMatrix();
  }

  // ======================================================================= frame
  update(rdt: number) {
    if (this.state === 'idle') return;
    this.t += rdt;
    const t = this.t;
    const eng = this.engine;
    // ---- cover and clasp
    if (this.state === 'opening') {
      this.strapK = ease(clamp01((t - 0.35) / 0.5));
      this.theta = Math.PI * ease(clamp01((t - 0.85) / 1.45));
      if (t > 0.35 && t - rdt <= 0.35) eng.audio.play('chest_unlock', { volume: 0.55, pitch: 1.2 });
      if (t > 0.85 && t - rdt <= 0.85) eng.audio.play('book_open', { volume: 0.9 });
      if (t > 2.45) {
        this.state = 'open';
        for (const el of [this.header, this.hint, this.closeBtn]) el.style.opacity = '1';
      }
    } else if (this.state === 'closing') {
      this.theta = Math.PI * (1 - ease(clamp01(t / 1.0)));
      this.strapK = 1 - ease(clamp01((t - 0.9) / 0.4));
      if (t > 1.45) void this.finishClose();
    }
    this.hinge.rotation.z = this.theta - Math.PI;
    this.spineG.rotation.z = this.theta / 2;
    this.band.rotation.z = -Math.PI / 2 * this.strapK;
    this.band.position.y = BV * 2 * this.strapK;
    this.tongue.rotation.z = -Math.PI / 2 * this.strapK;
    const openK = clamp01((this.theta - Math.PI * 0.94) / (Math.PI * 0.06));
    if (this.ribbon) this.ribbon.visible = openK > 0.5;
    // the right block's top leaf must not show through the closed cover
    this.sheetR.mesh.visible = this.theta > 0.05;
    for (const tb of this.tabs) tb.g.visible = this.theta > Math.PI * 0.5;
    // ---- turning
    if (this.turn) {
      const tr = this.turn;
      tr.t = Math.min(1, tr.t + rdt / tr.dur);
      if (tr.t >= 1) {
        const land = tr.dir > 0 ? tr.leaf + 1 : tr.leaf;
        this.turn = null;
        if (this.steps.length) {
          this.cur = land;
          this.beginTurn(this.steps.shift()!);
        } else this.showStatic(land);
      }
      const now = this.turn as Turn | null;
      if (now) {
        // the leaf's own T: forward 0 → 1, back 1 → 0
        const T = now.dir > 0 ? ease(now.t) : 1 - ease(now.t);
        this.layoutTurning(now.leaf + T, T);
      } else this.layout(this.cur, false);
    } else this.layout(this.cur, false);
    // ---- input
    if (this.state === 'open') this.input();
    // ---- life: the plates, the lamp, the ribbon
    for (const p of this.platesUsed) p.render(eng.renderer, rdt);
    const rt = eng.realTime;
    this.lampLight.intensity = 1.4 * (1 + Math.sin(rt * 9.3) * 0.06 + Math.sin(rt * 23.1) * 0.03 + Math.sin(rt * 3.1) * 0.04);
    if (Math.random() < rdt * 14) this.particles.emit({ pos: { x: this.flame.x + (Math.random() - 0.5) * 0.004, y: this.flame.y, z: this.flame.z }, count: 1, spread: 0.01, up: 0.06, life: [0.25, 0.45], size: [0.022, 0.008], sprite: ['flame0', 'flame1', 'flame2', 'flame3'], color: 0xffb050, additive: true, animate: true });
    if (Math.random() < rdt * 6) this.particles.emit({ pos: { x: (Math.random() - 0.5) * 0.9, y: 0.05 + Math.random() * 0.35, z: (Math.random() - 0.5) * 0.5 }, count: 1, spread: 0.004, up: 0.004, life: [3, 6], size: [0.0018, 0.0018], sprite: 'dot3', color: 0xfff0d0, drag: 0.3, jitter: 0.004, fadeIn: 1 });
    this.particles.update(rdt, this.scene.fog as THREE.Fog);
    if (this.ribbon) {
      const pts = this.ribbonPts;
      const sw = Math.sin(rt * 0.9) * 0.002;
      pts[8].x = 0.022 + sw;
      pts[9].x = 0.032 + sw * 2.2;
      const g = this.ribbon.geometry as THREE.BufferGeometry;
      const pa = g.attributes.position as THREE.BufferAttribute;
      for (const i of [8, 9]) for (let s = 0; s < 2; s++) pa.setX(i * 2 + s, pts[i].x + (s ? 0.0055 : -0.0055));
      pa.needsUpdate = true;
    }
    this.updateCamera(rdt);
  }

  /** mid-turn: the blocks and tabs follow the leaf over */
  private layoutTurning(pos: number, T: number) {
    const tr = this.turn!;
    const { tL, tR } = this.thick(pos);
    this.blockR.scale.set(1, tR / BM.TB, 1);
    this.blockL.scale.set(-1, tL / BM.TB, 1);
    this.sheetL.shape(1, tR, tL, 1, this.ear(tr.leaf, 'L'));
    this.sheetR.shape(0, tR, tL, 1, this.ear(tr.leaf + 1, 'R'));
    this.sheetT.shape(T, tR, tL, tr.dir);
    const leaves = this.spreads.length - 1;
    const leafT = BM.TB / leaves;
    this.tabs.forEach((tb, i) => {
      const leaf = this.starts[tb.sec] - 1;
      const z = -BM.PH / 2 + 0.034 + i * ((BM.PH - 0.068) / 7);
      if (leaf === tr.leaf) {
        // this tab rides on the turning leaf's fore-edge
        this.sheetT.mesh.updateMatrixWorld(true);
        const P = this.sheetT.geo.attributes.position as THREE.BufferAttribute;
        const j = Math.round(((z + BM.PH / 2) / BM.PH) * 22);
        const k = j * 41 + 40;
        tb.g.position.set(P.getX(k), P.getY(k), z);
        const kk = j * 41 + 39;
        const a = Math.atan2(P.getY(k) - P.getY(kk), P.getX(k) - P.getX(kk));
        tb.g.rotation.set(0, 0, a);
        tb.g.scale.set(1, 1, 1);
        tb.label.scale.x = 1;
        return;
      }
      tb.g.rotation.set(0, 0, 0);
      const onLeft = leaf < pos - 0.5;
      const depth = onLeft ? pos - 1 - leaf : leaf - pos;
      const y = BM.BT + (onLeft ? tL : tR) - Math.max(0.5, depth + 0.5) * leafT;
      tb.g.position.set(onLeft ? -BM.PW + 0.001 : BM.PW - 0.001, Math.max(BM.BT + 0.0008, y), z);
      tb.g.scale.set(onLeft ? -1 : 1, 1, 1);
      tb.label.scale.x = onLeft ? -1 : 1;
    });
  }

  private hitLink(links: Link[], u: number, v: number) {
    for (const l of links) if (u >= l.r[0] && u <= l.r[2] && v >= l.r[1] && v <= l.r[3]) return l;
    return null;
  }

  private input() {
    const eng = this.engine;
    const inp = eng.input;
    if (inp.wasPressed('Escape') || inp.wasPressed('Backspace')) {
      this.close();
      return;
    }
    const n = this.starts.length;
    const secOf = (sp: number) => {
      let s = -1;
      for (let i = 0; i < n; i++) if (sp >= this.starts[i]) s = i;
      return s;
    };
    if (!this.turn) {
      if (inp.wasPressed('KeyD') || inp.wasPressed('ArrowRight') || inp.wasPressed('PageDown') || inp.wheel > 0) this.goTo(this.cur + 1);
      else if (inp.wasPressed('KeyA') || inp.wasPressed('ArrowLeft') || inp.wasPressed('PageUp') || inp.wheel < 0) this.goTo(this.cur - 1);
      else if (inp.wasPressed('KeyE')) this.goTo(this.starts[Math.min(n - 1, secOf(this.cur) + 1)]);
      else if (inp.wasPressed('KeyQ')) {
        const s = secOf(this.cur);
        this.goTo(s < 0 ? 0 : this.cur === this.starts[s] ? (s > 0 ? this.starts[s - 1] : 0) : this.starts[s]);
      } else if (inp.wasPressed('Home')) this.goTo(0);
    }
    // ---- the mouse: tabs, links, the plate, the page corners
    this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), this.camera);
    let key = '', tipText = '';
    let action: (() => void) | null = null;
    const tabHits = this.ray.intersectObjects(this.tabs.map((x) => x.mesh), false);
    if (tabHits.length) {
      const tb = this.tabs.find((x) => x.mesh === tabHits[0].object)!;
      key = 'tab' + tb.sec;
      tipText = tb.name;
      action = () => this.goTo(this.starts[tb.sec]);
    } else if (!this.turn) {
      const hits = this.ray.intersectObjects([this.sheetL.mesh, this.sheetR.mesh], false);
      const h = hits[0];
      if (h?.uv) {
        const left = h.object === this.sheetL.mesh;
        const u = left ? 1 - h.uv.x : h.uv.x, v = h.uv.y;
        const ln = this.hitLink(left ? this.linksL : this.linksR, u, v);
        if (ln) {
          key = 'link:' + ln.to;
          const [kind, val] = [ln.to.slice(0, ln.to.indexOf(':')), ln.to.slice(ln.to.indexOf(':') + 1)];
          if (kind === 'section') {
            tipText = 'Open the chapter';
            action = () => this.goTo(this.starts[+val]);
          } else {
            const target = this.spreads.findIndex((s) => s.R.kind === 'entry' && s.R.key === val);
            tipText = Codex.known(val) ? 'Read the entry' : 'An empty page';
            action = () => this.goTo(target);
          }
        } else if (left && this.spreads[this.cur].L.kind === 'plate' && u > PLATE_RECT[0] && u < PLATE_RECT[2] && v > PLATE_RECT[1] && v < PLATE_RECT[3]) {
          key = 'plate';
          const p = this.platesUsed[0];
          if (p && !p.locked) p.provoke();
        } else if (left && this.cur > 0) {
          key = 'prev';
          action = () => this.goTo(this.cur - 1);
        } else if (!left && this.cur < this.spreads.length - 1) {
          key = 'next';
          action = () => this.goTo(this.cur + 1);
        }
      }
    }
    for (const tb of this.tabs) tb.hover += ((key === 'tab' + tb.sec ? 1 : 0) - tb.hover) * 0.25;
    if (key !== this.hoverKey) {
      if (key && key !== 'plate') eng.audio.play('ui_hover', { volume: 0.18, pitch: 1.4 });
      this.hoverKey = key;
      document.body.style.cursor = key && key !== 'plate' ? 'pointer' : 'default';
    }
    if (tipText) {
      this.tip.textContent = tipText;
      this.tip.style.display = 'block';
      this.tip.style.left = `${inp.mouseX + 16}px`;
      this.tip.style.top = `${inp.mouseY + 12}px`;
    } else this.tip.style.display = 'none';
    if (inp.wasPressed('Mouse0') && action) {
      eng.audio.play('ui_click', { volume: 0.35, pitch: 1.2 });
      action();
    }
  }

  dispose() {
    this.state = 'done';
    this.ui.remove();
    document.body.style.cursor = 'default';
    for (const p of this.plates) p.dispose();
    for (const c of this.cache.values()) c.tex.dispose();
    for (const s of this.stamps.values()) s.tex.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    for (const sh of [this.sheetL, this.sheetR, this.sheetT]) {
      sh.geo.dispose();
      sh.mat.dispose();
    }
    this.ribbon?.geometry.dispose();
    this.key.shadow.map?.dispose();
    if ((window as any).__codex === this) (window as any).__codex = null;
  }
}

/** the codex opens Thoth's Hall now (same constructor, open / update / close / dispose) */
export { ThothHall as CodexBook } from '../scenes/ThothHall';
