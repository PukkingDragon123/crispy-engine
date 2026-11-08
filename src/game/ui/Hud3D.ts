// The HUD compositor. The whole run HUD is ONE flat pixel-art layer: the 2D HUD
// canvas (Hud.ts: frames, bars, type) with the pictures painted into it on the
// same integer pixel grid — every picture a photograph of the game's own 3D
// model taken once by the sprite bank (HudSprites.ts) and finished as pixel art
// (palette, ink outline, rim light). This class paints its own pieces into that
// canvas (Hud.painters) — the revolver cylinder (flip-book frames over one
// chamber step, its rounds composited per chamber, motion ghosts on a spin, spent
// brass tumbling off on a reload), the beating wrapped heart (beat frames x
// loosening wraps), the spinning purse coin, the consumables — and hands the
// rest to its modules: Serket's soul jar (SoulBar), the outlaw readouts (tin
// star, tally board, wave plaque, stopwatch: OutlawHud), the long-gun magazines,
// gun-belt strip and treasure markers (ArsenalHud), the mission notes
// (MissionPaper) and the tarot cards (TarotBar).
// It then draws that canvas as a nearest-neighbour quad and, over it, the 2D
// pixel particles (dust, soul motes, sparks) and the pause poster.
// cutIn() draws nothing: it hands every big moment to the in-world cutscene
// director (cine/Cinema.ts).
import * as THREE from 'three';
import type { Hud, HudPainter } from './Hud';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { globalUniforms, makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { buildRigGeo, RigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import { TOON } from '../models/style';
import type { EyeStyle } from '../fx/FaceFx';
import { TarotBar } from './TarotBar';
import { hudCylinder, hudRound, hudHeartRig } from '../models/props/hud';
import { PausePoster } from './PausePoster';
import { SoulBar } from './SoulBar';
import { MissionPaper, questFromObjective } from './MissionPaper';
import { OutlawHud } from './OutlawHud';
import { Cinema, type BossLike } from '../cine/Cinema';
import { ArsenalHud } from './ArsenalHud';
import { SpriteBank, Sprite, Shot, blitC, blitObj, glint, setGlintFx, variant, framingBox, wrap } from './HudSprites';
import { PixelFx } from './HudKit';

export interface CutInOpts {
  /** the subject's rig (a boss cut-in passes the boss rig) */
  geo?: RigGeo;
  eyes?: [EyeStyle, number];
  /** subject height in meters */
  height?: number;
  flip?: boolean;
  /** the boss itself: its arrival cutscene erupts at its feet */
  boss?: BossLike;
  /** where a small title stamp should stand (default: in front of the hunter) */
  at?: THREE.Vector3;
}

const CR = 14; // cylinder radius in model units (≈ HUD px)
const CH = 8.4; // chamber distance from axis (fallback model)
const HR = 3.3; // chamber radius (fallback model)
const CL = 10;
/** the cylinder picture (HUD px, square) */
const CYL_PX = 46;
/** rotation frames per chamber step */
const CYL_F = 6;

/** the HUD's brass ramp (PixelUI) as rgb */
const BRASS = ['#2e1c06', '#7c5214', '#b88426', '#e2b24a', '#fff0a6'].map((h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

function chamberAngle(i: number, n: number) {
  return Math.PI / 2 - (i / n) * Math.PI * 2;
}

/** the simple procedural cylinder (only if the hi-res one fails to build) */
function cylinderModel(n: number) {
  const m = new VoxelModel('hud_cyl_' + n);
  const I = TOON.iron;
  for (let x = -CR; x <= CR; x++)
    for (let y = -CR; y <= CR; y++) {
      const d = Math.hypot(x, y);
      if (d > CR + 0.35) continue;
      let hole = false, rimHole = false;
      for (let i = 0; i < n; i++) {
        const a = chamberAngle(i, n);
        const hd = Math.hypot(x - Math.cos(a) * CH, y - Math.sin(a) * CH);
        if (hd <= HR + 0.25) hole = true;
        else if (hd <= HR + 1.25) rimHole = true;
      }
      const a = Math.atan2(y, x);
      const seg = ((((Math.PI / 2 - a) / (Math.PI * 2)) * n) % 1 + 1) % 1;
      const flute = d > CR - 2.6 && Math.abs(seg - 0.5) < 0.12;
      const lit = (-x * 0.55 + y * 0.83) / Math.max(1, d);
      for (let z = 0; z < CL; z++) {
        if (hole) {
          if (z === 0) m.set(x, y, z, TOON.socket.dark);
          continue;
        }
        const edge = z === CL - 1 || z === 0;
        if (edge && d > CR - 0.8) continue;
        if (flute && z > 1 && z < CL - 2) continue;
        let c = I.base;
        if (z === CL - 1) {
          if (d > CR - 2.6) c = lit > 0.35 ? I.hi : lit < -0.45 ? I.shade : I.base;
          if (rimHole) c = I.dark;
        } else if (flute || (d > CR - 3.6 && Math.abs(seg - 0.5) < 0.2)) c = I.shade;
        else if (z === 0) c = I.shade;
        else if (lit > 0.6 && d > CR - 1.5) c = I.hi;
        m.set(x, y, z, c);
      }
    }
  return m;
}

function coinModel() {
  const m = new VoxelModel('hud_coin');
  const G = TOON.gold;
  const R = 7;
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++) {
      const d = Math.hypot(x, y);
      if (d > R + 0.3) continue;
      for (let z = -1; z <= 1; z++) {
        const face = z !== 0;
        let c = G.base;
        if (!face) c = G.shade;
        else if (d > R - 1.3) c = (x * -0.6 + y * 0.8) / Math.max(1, d) > 0.2 ? G.hi : G.shade;
        m.set(x, y, z, c);
      }
    }
  // raised star on both faces
  const star = (px: number, py: number) => {
    const a = Math.atan2(py, px), r = Math.hypot(px, py);
    const k = Math.cos(((a + Math.PI / 2) * 5) % (Math.PI * 2)) * 0.5 + 0.5;
    return r < 2 + k * 3.2;
  };
  for (let x = -6; x <= 6; x++)
    for (let y = -6; y <= 6; y++) {
      if (!star(x, y)) continue;
      const hi = x * -0.6 + y * 0.8 > 0;
      m.set(x, y, 2, hi ? G.hi : G.base);
      m.set(x, -y, -2, hi ? G.hi : G.base);
    }
  return m;
}

// ------------------------------------------------------------------ the cylinder rig (photographed only)
interface CylRig {
  n: number;
  root: THREE.Group;
  inner: THREE.Group;
  rounds: THREE.Mesh[];
  brass: THREE.BufferGeometry;
  venom: THREE.BufferGeometry;
  spent: THREE.BufferGeometry;
  /** a lone spent case for the tumbling brass */
  case: { root: THREE.Group; inner: THREE.Group };
}
const cylRigs = new Map<number, CylRig>();
function cylRig(n: number): CylRig {
  let r = cylRigs.get(n);
  if (r) return r;
  const mat = SpriteBank.get().material();
  const inner = new THREE.Group();
  let chambers: [number, number][] = [];
  let seat = 0.01;
  let brass: THREE.BufferGeometry, venom: THREE.BufferGeometry, spent: THREE.BufferGeometry;
  try {
    const hc = hudCylinder(n);
    const u = CR / hc.meta.radius;
    const body = new THREE.Mesh(buildVoxelGeometry(hc.model, { voxelSize: hc.voxelSize * u, pivot: hc.pivot }), mat);
    body.position.z = -hc.meta.rearZ * u;
    inner.add(body);
    chambers = hc.meta.chambers.map(([x, y]) => [x * u, y * u]);
    const mk = (k: 'brass' | 'venom' | 'spent') => {
      const rd = hudRound(k, n);
      seat = rd.meta.seatOffset * u;
      return buildVoxelGeometry(rd.model, { voxelSize: rd.voxelSize * u, pivot: rd.pivot });
    };
    brass = mk('brass');
    venom = mk('venom');
    spent = mk('spent');
  } catch (e) {
    console.warn('[hud] hi-res cylinder failed, using fallback', e);
    inner.add(new THREE.Mesh(buildVoxelGeometry(cylinderModel(n), { voxelSize: 1, pivot: [0.5, 0.5, CL] }), mat));
    chambers = Array.from({ length: n }, (_, i) => [Math.cos(chamberAngle(i, n)) * CH, Math.sin(chamberAngle(i, n)) * CH]);
    brass = venom = spent = new THREE.BoxGeometry(HR * 1.8, HR * 1.8, 9);
  }
  // the rounds' brass is lit a little hotter than the rusty iron so a loaded chamber reads at a glance
  const rmat = makeVoxelMaterial({ fog: false });
  rmat.envMap = SpriteBank.get().envTexture();
  rmat.userData.tint.value.setRGB(1.75, 1.45, 1.0);
  const rounds: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(brass, rmat);
    m.position.set(chambers[i][0], chambers[i][1], seat);
    inner.add(m);
    rounds.push(m);
  }
  // every frame and variant shares this framing (rounds in or out)
  // (deep enough that no round, however long, ever moves the framing)
  inner.add(framingBox([-CR - 1.5, -CR - 1.5, -48], [CR + 1.5, CR + 1.5, 10]));
  const ci = new THREE.Group();
  ci.add(new THREE.Mesh(spent, mat));
  r = { n, root: wrap(inner), inner, rounds, brass, venom, spent, case: { root: wrap(ci), inner: ci } };
  cylRigs.set(n, r);
  return r;
}

/** one rotation frame: empty / brass-loaded / venom-loaded pictures and which chamber owns each changed pixel */
interface CylFrame {
  w: number;
  h: number;
  E: Uint8ClampedArray;
  L: Uint8ClampedArray;
  V: Uint8ClampedArray;
  sector: Int8Array;
  cx: number;
  cy: number;
}

interface Casing {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  w: number;
  life: number;
}

let coinRig: THREE.Group | null = null;
let heart: { rig: RigInstance; root: THREE.Group; height: number } | null = null;

export class Hud3D implements HudPainter {
  scene = new THREE.Scene();
  /** the 2D HUD canvas quad, drawn first in its own pass */
  private base = new THREE.Scene();
  private texW = 0;
  private texH = 0;
  cam = new THREE.OrthographicCamera(0, 1, 0, -1, -4000, 4000);
  private tex: THREE.CanvasTexture;
  private quad: THREE.Mesh;
  private bank = SpriteBank.get();
  // cylinder
  private cylN = 0;
  private frames: (CylFrame | null)[] = [];
  private comp = new Map<string, HTMLCanvasElement>();
  private casings: Casing[] = [];
  private lastPhase = '';
  private lastShown = 6;
  private insertT: number[] = [];
  // heart
  private beat = 0;
  private heartHurt = 0;
  private lastHp = -1;
  // coin
  private coinSpin = 0;
  // items
  private itemPop: number[] = [];
  private lastCounts: number[] = [];
  private lastItemKey: string[] = [];
  private brass = new PixelFx(160, false, 7);
  /** light catching metal, glass and gilt: pixel twinkles over every piece */
  private glints = new PixelFx(240, true, 62);
  // soul jar, mission paper, outlaw furniture, arsenal
  private soul: SoulBar;
  private paper: MissionPaper;
  private outlaw: OutlawHud;
  private arsenal: ArsenalHud;
  private t = 0;
  /** the pause poster's clock (runs while the HUD is hidden too) */
  private pt = 0;
  private bustSpec: RigSpec | null = null;
  /** the player's revolver (for card art that shows Sundown armed) */
  gunSpec: RigSpec | null = null;
  // pause poster
  private posterOpen = false;
  private posterUi: HTMLDivElement | null = null;
  private pp: PausePoster | null = null;
  /** the pause poster is rendered on its own at HUD-pixel resolution, then blown up nearest-neighbour */
  private posterScene = new THREE.Scene();
  private posterRT: THREE.WebGLRenderTarget | null = null;
  private posterQuad: THREE.Mesh | null = null;
  private posterPass = new THREE.Scene();
  private ppPending = false;
  private keyLight: THREE.DirectionalLight;
  /** the tarot ability cards (their art is photographed once the renderer and the player rig are known) */
  private tarot: TarotBar;

  constructor(private hud: Hud) {
    this.tex = this.makeTex();
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
    );
    this.quad.frustumCulled = false;
    this.base.add(this.quad);
    hud.canvas.style.display = 'none';
    hud.use3D = true;
    hud.painters.unshift(this);

    // lights for the 3D pause poster (the only lit thing left in this scene)
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a4a30, 1.1));
    this.keyLight = new THREE.DirectionalLight(0xfff0d8, 2.4);
    this.keyLight.position.set(-0.45, 0.8, 1).normalize();
    this.scene.add(this.keyLight);
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.5);
    fill.position.set(0.8, -0.2, 0.6);
    this.scene.add(fill);
    this.scene.add(this.brass.points, this.glints.points);
    setGlintFx(this.glints);

    this.soul = new SoulBar(this.scene, hud);
    this.paper = new MissionPaper(this.scene);
    this.outlaw = new OutlawHud(this.scene);
    this.arsenal = new ArsenalHud(this.scene, () => this.gunSpec);
    this.tarot = new TarotBar(this.scene, hud);
  }

  private makeTex() {
    const t = new THREE.CanvasTexture(this.hud.canvas);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    this.texW = this.hud.canvas.width;
    this.texH = this.hud.canvas.height;
    return t;
  }

  private bustKey = '';
  /** the pause screen: a wanted poster blows in and flutters; DOM buttons ride on it */
  showPause(open: boolean, actions?: { label: string; fn: () => void }[]) {
    this.posterOpen = open;
    if (!this.pp) {
      this.pp = new PausePoster(this.posterScene);
      this.pp.onShot = (n) => {
        const eng = (window as any).__engine;
        eng?.audio?.play('rev_shot', { volume: 0.9, pitch: n ? 1.06 : 1 });
        eng?.audio?.play('paper_flutter', { volume: 0.6 });
        eng?.flash?.(0xfff2d0, 0.18, 0.12);
      };
    }
    if (open) {
      this.ppPending = true;
      (window as any).__engine?.audio?.play('paper_flutter', { volume: 0.8 });
    } else this.pp.close();
    if (open && actions) {
      this.posterUi?.remove();
      const ui = document.createElement('div');
      ui.style.cssText = 'position:absolute;z-index:9;display:flex;flex-direction:column;gap:10px;align-items:center;transform:translate(-50%,0);pointer-events:auto';
      for (const a of actions) {
        const b = document.createElement('button');
        b.textContent = a.label;
        b.style.cssText = "font-family:'Alagard';font-size:22px;min-width:220px;padding:8px 18px;background:#7a4a28;color:#fff3d6;border:4px solid #2a1408;box-shadow:0 4px 0 #2a1408;cursor:pointer;letter-spacing:1px";
        b.onmouseenter = () => (b.style.background = '#9a5a30');
        b.onmouseleave = () => (b.style.background = '#7a4a28');
        b.onclick = (ev) => {
          ev.stopPropagation();
          a.fn();
        };
        ui.appendChild(b);
      }
      document.getElementById('overlay')?.appendChild(ui);
      this.posterUi = ui;
    }
    if (!open) {
      this.posterUi?.remove();
      this.posterUi = null;
    }
  }

  private updatePoster(dt: number, W: number, H: number) {
    const pp = this.pp;
    if (!pp) return;
    if (this.ppPending) {
      this.ppPending = false;
      pp.open(W, H);
    }
    pp.scale = this.hud.scale;
    pp.update(dt, W, H, this.pt);
    if (this.posterUi) {
      const v = pp.centre.visible;
      this.posterUi.style.left = `${pp.centre.x}px`;
      this.posterUi.style.top = `${pp.centre.y + pp.height * 0.13}px`;
      this.posterUi.style.opacity = String(v);
      this.posterUi.style.pointerEvents = v > 0.5 ? 'auto' : 'none';
    }
  }

  /** player rig spec (and its geometry cache key) used for the card art */
  setBust(spec: RigSpec, cacheKey: string, gun?: RigSpec) {
    this.bustSpec = spec;
    this.bustKey = cacheKey;
    this.gunSpec = gun ?? null;
  }

  /**
   * Big moments (boss arrivals, area names, ultimates, MOVE UNLOCKED, NECK SLICER...).
   * Nothing is drawn on screen any more: the in-world cutscene director plays them
   * (letterboxed boss eruptions, establishing shots, voxel title stamps).
   */
  cutIn(title: string, color = '#9dff3a', expr = 'angry', opts: CutInOpts = {}) {
    Cinema.cutIn(title, color, expr, opts);
  }

  // ================================================================ the picture layer (called from Hud.update)

  paint(c: CanvasRenderingContext2D, dt: number) {
    this.t += dt;
    const hud = this.hud;
    const A = hud.anchors;
    const visible = hud.visible && A.slide < 0.98;
    if (!visible) return;
    const s = hud.scale;
    // back to front: the notes and the sheriff's-office furniture, the long guns and treasure,
    // the cylinder, the heart and the jar above it, the purse coin and the consumables, the cards
    {
      const st = hud.last;
      const quests = st?.quests ?? (st?.objective ? [questFromObjective(st.objective)] : []);
      for (const [id, ok] of hud.questEnds) this.paper.end(id, ok);
      hud.questEnds.clear();
      this.paper.paint(c, dt, quests, A.paper, s, hud.recentToasts());
      hud.paperBottom = this.paper.bottom;
    }
    if (A.outlaw) this.outlaw.paint(c, dt, A.outlaw, s);
    this.arsenal.paint(c, dt, A.arsenal, s);
    this.paintCylinder(c, dt);
    this.paintHeart(c, dt);
    this.soul.paint(c, dt, A.soul, s);
    this.paintCoin(c, dt);
    this.paintItems(c, dt);
    this.tarot.paint(c, dt);
  }

  // ---------------------------------------------------------------- cylinder
  private cylFrame(n: number, f: number, prio: number): CylFrame | null {
    if (n !== this.cylN) {
      this.cylN = n;
      this.frames = new Array(CYL_F).fill(null);
      this.comp.clear();
      this.insertT = new Array(n).fill(1);
    }
    const have = this.frames[f];
    if (have) return have;
    const rho = (f / CYL_F) * ((Math.PI * 2) / n);
    const shot = (v: 'E' | 'L' | 'V') => (): Shot => {
      const r = cylRig(n);
      r.inner.rotation.set(0, 0, rho);
      for (const m of r.rounds) {
        m.visible = v !== 'E';
        m.geometry = v === 'V' ? r.venom : r.brass;
      }
      return { obj: r.root, w: CYL_PX, h: CYL_PX, yaw: -0.12, pitch: 0.22, fit: true, rim: '#ffe2a8' };
    };
    const fam = `cyl${n}:f${f}`;
    const e = this.bank.exact(fam + ':E', CYL_PX) ?? (this.bank.get(fam + ':E', CYL_PX, prio, shot('E')), null);
    const l = this.bank.exact(fam + ':L', CYL_PX) ?? (this.bank.get(fam + ':L', CYL_PX, prio, shot('L')), null);
    const v = this.bank.exact(fam + ':V', CYL_PX) ?? (this.bank.get(fam + ':V', CYL_PX, prio - 1, shot('V')), null);
    if (!e || !l || !v) return null;
    const px = (sp: Sprite) => sp.cv.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, sp.w, sp.h).data;
    const dE = px(e), dL = px(l), dV = px(v);
    const w = e.w, h = e.h;
    // the axis: the centroid of every pixel a round changes
    let sx = 0, sy = 0, cnt = 0;
    const diff = (k: number) => dE[k] !== dL[k] || dE[k + 1] !== dL[k + 1] || dE[k + 2] !== dL[k + 2] || dE[k + 3] !== dL[k + 3] || dE[k] !== dV[k] || dE[k + 1] !== dV[k + 1] || dE[k + 3] !== dV[k + 3];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (diff((y * w + x) * 4)) {
          sx += x;
          sy += y;
          cnt++;
        }
    const cx = cnt ? sx / cnt : w / 2, cy = cnt ? sy / cnt : h / 2;
    const sector = new Int8Array(w * h).fill(-1);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (!diff(k * 4)) continue;
        const phi = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
        let best = 0, bd = 9;
        for (let j = 0; j < n; j++) {
          // screen angle of sector j in this frame (y down)
          let d = phi + (chamberAngle(j, n) + rho);
          d = Math.atan2(Math.sin(d), Math.cos(d));
          if (Math.abs(d) < bd) {
            bd = Math.abs(d);
            best = j;
          }
        }
        sector[k] = best;
      }
    // a loaded chamber must read at a glance against the rust: the round's pixels go onto the
    // brass ramp by their own light (a venom primer keeps its jade)
    const L2 = new Uint8ClampedArray(dL), V2 = new Uint8ClampedArray(dV);
    const brass = (d: Uint8ClampedArray, k: number) => {
      const r = d[k], g = d[k + 1], b = d[k + 2];
      if (g > r * 1.05 && g > b) return;
      const l = r * 0.3 + g * 0.59 + b * 0.11;
      const p = l < 52 ? BRASS[0] : l < 96 ? BRASS[1] : l < 140 ? BRASS[2] : l < 186 ? BRASS[3] : BRASS[4];
      d[k] = p[0];
      d[k + 1] = p[1];
      d[k + 2] = p[2];
    };
    for (let p = 0; p < sector.length; p++) {
      if (sector[p] < 0) continue;
      if (dL[p * 4 + 3]) brass(L2, p * 4);
      if (dV[p * 4 + 3]) brass(V2, p * 4);
    }
    // each cartridge head gets its own dark rim, so six rounds never melt into one brass disc
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x, j = sector[p];
        if (j < 0) continue;
        const other = (xx: number, yy: number) => xx < 0 || yy < 0 || xx >= w || yy >= h || sector[yy * w + xx] !== j;
        if (!(other(x + 1, y) || other(x, y + 1) || other(x - 1, y) || other(x, y - 1))) continue;
        for (const d of [L2, V2]) {
          if (!d[p * 4 + 3]) continue;
          d[p * 4] = BRASS[0][0];
          d[p * 4 + 1] = BRASS[0][1];
          d[p * 4 + 2] = BRASS[0][2];
        }
      }
    const fr: CylFrame = { w, h, E: new Uint8ClampedArray(dE), L: L2, V: V2, sector, cx, cy };
    this.frames[f] = fr;
    return fr;
  }

  /** the cylinder at rotation rho (radians, + = counter-clockwise on screen) with chambers loaded / venom */
  private cylinderImage(n: number, rho: number, shown: number, venom: number) {
    const step = (Math.PI * 2) / n;
    const q = rho / step;
    const m = Math.floor(q);
    let f = Math.round((q - m) * CYL_F);
    let mm = m;
    if (f >= CYL_F) {
      f = 0;
      mm++;
    }
    let fr = this.cylFrame(n, f, 60);
    if (!fr) {
      fr = this.cylFrame(n, 0, 61);
      mm = Math.round(q);
      if (!fr) return null;
    }
    let mask = '';
    for (let j = 0; j < n; j++) {
      const i = (((j + mm) % n) + n) % n;
      mask += i < shown ? (i < venom ? 'v' : 'l') : '.';
    }
    const fi = this.frames.indexOf(fr);
    const key = fi + mask;
    let cv = this.comp.get(key);
    if (cv) {
      this.comp.delete(key);
      this.comp.set(key, cv);
      return { cv, fr };
    }
    cv = document.createElement('canvas');
    cv.width = fr.w;
    cv.height = fr.h;
    const cc = cv.getContext('2d')!;
    const img = cc.createImageData(fr.w, fr.h);
    const d = img.data;
    d.set(fr.E);
    for (let p = 0; p < fr.sector.length; p++) {
      const j = fr.sector[p];
      if (j < 0) continue;
      const ch = mask[j];
      if (ch === '.') continue;
      const src = ch === 'v' ? fr.V : fr.L;
      const k = p * 4;
      d[k] = src[k];
      d[k + 1] = src[k + 1];
      d[k + 2] = src[k + 2];
      d[k + 3] = src[k + 3];
    }
    cc.putImageData(img, 0, 0);
    this.comp.set(key, cv);
    if (this.comp.size > 64) this.comp.delete(this.comp.keys().next().value!);
    return { cv, fr };
  }

  private paintCylinder(c: CanvasRenderingContext2D, dt: number) {
    const cy = this.hud.anchors.cyl;
    const n = Math.max(5, Math.min(9, cy.n));
    // queue every rotation frame early (the first one first)
    for (let f = 0; f < CYL_F; f++) if (!this.frames[f] || n !== this.cylN) this.cylFrame(n, f, f === 0 ? 70 : 40);
    // spent brass tumbling off (drawn even while a long gun is up)
    this.paintCasings(c, dt, n);
    if (cy.hidden) {
      this.lastPhase = cy.phase;
      return;
    }
    const rho = -cy.rot;
    // rounds pop in one by one while reloading
    if (cy.shown > this.lastShown && cy.phase === 'insert')
      for (let i = this.lastShown; i < cy.shown && i < this.insertT.length; i++) {
        this.insertT[i] = 0;
        const a = chamberAngle(i, n) + rho;
        const r = CYL_PX * 0.27;
        for (let k = 0; k < 5; k++) this.brass.emit({ x: cy.x + Math.cos(a) * r, y: cy.y - Math.sin(a) * r, vx: (Math.random() - 0.5) * 50, vy: -20 - Math.random() * 40, ay: 120, drag: 2, life: 0.25 + Math.random() * 0.2, size: 1, c0: 0xfff0a6, c1: 0xb88426, alpha: 1 });
      }
    for (let i = 0; i < this.insertT.length; i++) this.insertT[i] = Math.min(1, this.insertT[i] + dt * 7);
    // eject: every spent case flies out and tumbles off screen
    if (cy.phase === 'eject' && this.lastPhase !== 'eject') {
      for (let i = 0; i < n; i++) {
        const a = chamberAngle(i, n) + rho;
        this.casings.push({ x: cy.x + Math.cos(a) * 9, y: cy.y - Math.sin(a) * 9, vx: -60 - Math.random() * 110, vy: -110 - Math.random() * 130, r: Math.random() * 4, w: (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 8), life: 1.6 });
      }
    }
    this.lastPhase = cy.phase;
    this.lastShown = cy.shown;
    const bob = Math.round(Math.sin(this.t * 1.6) * 1.2);
    const x = cy.x, y = cy.y + bob;
    const img = this.cylinderImage(n, rho, cy.shown, cy.venom);
    if (!img) return;
    // motion ghosts while it spins
    const spd = Math.abs(cy.angVel);
    const ng = Math.min(3, Math.floor(spd / 5));
    for (let g = ng; g >= 1; g--) {
      const gi = this.cylinderImage(n, rho - g * 0.11 * Math.sign(cy.angVel), cy.shown, cy.venom);
      if (gi) blitC(c, gi.cv, x, y, 0.22);
    }
    // floats a few pixels off the screen: its shadow falls down-right; light runs over the rims
    blitObj(c, img.cv, x, y, 4);
    glint(img.cv, x, y, 0.5 + spd * 0.05, dt);
  }

  private paintCasings(c: CanvasRenderingContext2D, dt: number, n: number) {
    const H = this.hud.canvas.height;
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const k = this.casings[i];
      k.life -= dt;
      k.vy += 520 * dt;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.r += k.w * dt;
      if (k.life <= 0 || k.y > H + 20) {
        this.casings.splice(i, 1);
        continue;
      }
      const f = ((Math.floor((k.r / Math.PI) * 4) % 4) + 4) % 4;
      const sp = this.bank.get('cylcase:' + f, 14, 30, () => {
        const r = cylRig(n);
        r.case.inner.rotation.set(Math.PI / 2, 0, (f * Math.PI) / 4);
        return { obj: r.case.root, w: 14, h: 14, yaw: 0, pitch: 0.2, fit: true };
      });
      if (sp) blitObj(c, sp, k.x, k.y, 7, Math.min(1, k.life * 3));
    }
  }

  // ---------------------------------------------------------------- heart
  private paintHeart(c: CanvasRenderingContext2D, dt: number) {
    const hh = this.hud.anchors.heart;
    const frac = Math.max(0, Math.min(1, hh.frac));
    if (this.lastHp >= 0 && frac < this.lastHp - 0.003) this.heartHurt = 1;
    this.lastHp = frac;
    this.heartHurt = Math.max(0, this.heartHurt - dt * 3);
    const bpm = 62 + (1 - frac) * 100;
    this.beat = (this.beat + dt * (bpm / 60)) % 1;
    const ph = this.beat;
    const lub = Math.exp(-(((ph - 0.02) / 0.06) ** 2)) + 0.6 * Math.exp(-(((ph - 0.27) / 0.07) ** 2));
    const beat = lub < 0.22 ? 0 : lub < 0.72 ? 1 : 2;
    const bucket = frac > 0.9 ? 0 : frac > 0.7 ? 1 : frac > 0.5 ? 2 : 3;
    const HW = 44, HH = 46;
    const get = (b: number, p: number, prio: number) =>
      this.bank.get(`heart:${b}:${p}`, HW, prio, () => {
        const h = heartRig();
        if (!h) return null;
        poseHeart(h.rig, [1, 0.8, 0.6, 0.3][b], [0, 0.5, 1][p]);
        return { obj: h.root, w: HW, h: HH, yaw: 0, pitch: 0.1, fit: true, rim: null };
      });
    // the whole flip-book for this health band (and the rest frame of the others)
    for (let p = 0; p < 3; p++) get(bucket, p, p === 0 ? 66 : 64);
    let sp = this.bank.exact(`heart:${bucket}:${beat}`, HW) ?? this.bank.exact(`heart:${bucket}:0`, HW);
    for (let b = 0; !sp && b < 4; b++) sp = this.bank.exact(`heart:${b}:${beat}`, HW) ?? this.bank.exact(`heart:${b}:0`, HW);
    sp ??= get(bucket, beat, 66);
    if (!sp) return;
    const shake = this.heartHurt * 3;
    const x = hh.x + Math.round((Math.random() - 0.5) * shake), y = hh.y - 3 + Math.round((Math.random() - 0.5) * shake) + Math.round(Math.sin(this.t * 1.3) * 0.6);
    blitObj(c, sp, x, y, 3);
    // hurt: white-hot flash; low health: the heart flushes ember red with every beat
    if (this.heartHurt > 0.05) blitC(c, variant(sp, 'flash'), x, y, this.heartHurt * 0.85);
    else if (frac < 0.3) blitC(c, variant(sp, 'ember'), x, y, (0.5 + 0.5 * Math.sin(this.t * 10)) * 0.55);
  }

  // ---------------------------------------------------------------- purse coin
  private paintCoin(c: CanvasRenderingContext2D, dt: number) {
    const co = this.hud.anchors.coin;
    this.coinSpin += dt * (1.6 + co.pop * 26);
    const NF = 8;
    const f = Math.floor(((this.coinSpin % Math.PI) / Math.PI) * NF) % NF;
    const get = (i: number) =>
      this.bank.get('coin:' + i, 18, i === 0 ? 50 : 35, () => {
        coinRig ??= wrap(new THREE.Mesh(buildVoxelGeometry(coinModel(), { voxelSize: 1, pivot: [0.5, 0.5, 0.5] }), SpriteBank.get().material()), framingBox([-7.6, -7.6, -7.6], [7.6, 7.6, 7.6]));
        return { obj: coinRig, w: 18, h: 18, yaw: 0.15 + (i / NF) * Math.PI, pitch: 0.15, fit: true };
      });
    for (let i = 0; i < NF; i++) get(i);
    const sp = this.bank.exact('coin:' + f, 18) ?? this.bank.exact('coin:0', 18);
    if (sp) {
      const y = co.y - Math.round(co.pop * 3);
      blitObj(c, sp, co.x, y, 2 + co.pop * 3);
      glint(sp, co.x, y, 0.35 + co.pop * 6, dt);
    }
  }

  // ---------------------------------------------------------------- consumables
  private paintItems(c: CanvasRenderingContext2D, dt: number) {
    const hud = this.hud;
    const items = hud.anchors.items;
    items.forEach((it, i) => {
      if (this.lastItemKey[i] !== it.model) {
        this.lastItemKey[i] = it.model;
        this.itemPop[i] = 1;
      }
      if (this.lastCounts[i] !== undefined && it.count < this.lastCounts[i]) this.itemPop[i] = 1;
      this.lastCounts[i] = it.count;
      this.itemPop[i] = Math.max(0, (this.itemPop[i] ?? 0) - dt * 3);
      const sp = it.model ? this.bank.get('item:' + it.model, 18, 45, () => itemShot(it.model)) : null;
      hud.items3D[i] = !!sp;
      if (!sp) return;
      const pop = this.itemPop[i];
      const hop = Math.round(Math.sin(pop * Math.PI) * 4 + Math.sin(this.t * 2 + i * 1.7) * 0.6);
      blitObj(c, sp, it.x, it.y - hop, 2 + hop);
      if (pop > 0.5) blitC(c, variant(sp, 'flash'), it.x, it.y - hop, (pop - 0.5) * 1.4);
    });
    hud.items3D.length = items.length;
  }

  update(dt: number) {
    this.pt += dt;
    const hud = this.hud;
    const s = hud.scale;
    const W = window.innerWidth, H = window.innerHeight;
    this.cam.left = 0;
    this.cam.right = W;
    this.cam.top = 0;
    this.cam.bottom = -H;
    this.cam.updateProjectionMatrix();
    this.quad.position.set(W / 2, -H / 2, -3000);
    this.quad.scale.set(W, H, 1);
    if (hud.canvas.width !== this.texW || hud.canvas.height !== this.texH) {
      this.tex.dispose();
      this.tex = this.makeTex();
      (this.quad.material as THREE.MeshBasicMaterial).map = this.tex;
    }
    this.tex.needsUpdate = true;
    const visible = hud.visible && hud.anchors.slide < 0.98;
    // the 2D pixel particles ride above the canvas; they keep running (and hide with the HUD)
    this.brass.points.visible = this.glints.points.visible = visible;
    this.brass.update(dt, s);
    this.glints.update(dt, s);
    this.soul.fx(dt, s, visible);
    this.outlaw.fx(dt, s, visible);
    this.arsenal.fx(dt, s, visible);
    this.paper.fx(dt, s, visible);
    this.tarot.fx(dt, W, H, visible);
    Cinema.poll(this.hud);
    this.updatePoster(dt, W, H);
  }

  render(renderer: THREE.WebGLRenderer) {
    this.bank.pump(renderer, 4);
    if (this.pp?.active && this.pp.needsArt) this.pp.buildArt(renderer, this.bustSpec, this.hud.scale);
    this.tarot.build(renderer, this.bustSpec, this.bustKey, this.gunSpec);
    const ac = renderer.autoClear;
    const lc = renderer.localClippingEnabled;
    const rim = globalUniforms.uRim.value;
    renderer.autoClear = false;
    renderer.localClippingEnabled = true;
    globalUniforms.uRim.value = 0;
    renderer.setRenderTarget(null);
    renderer.clearDepth();
    renderer.render(this.base, this.cam);
    renderer.clearDepth();
    renderer.render(this.scene, this.cam);
    if (this.pp?.active) this.renderPoster(renderer);
    globalUniforms.uRim.value = rim;
    renderer.autoClear = ac;
    renderer.localClippingEnabled = lc;
  }

  /** the poster cloth into a HUD-resolution target, then onto the screen on the HUD's pixel grid */
  private renderPoster(renderer: THREE.WebGLRenderer) {
    const W = window.innerWidth, H = window.innerHeight, s = this.hud.scale;
    const w = Math.ceil(W / s), h = Math.ceil(H / s);
    if (!this.posterRT || this.posterRT.width !== w || this.posterRT.height !== h) {
      this.posterRT?.dispose();
      this.posterRT = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
      this.posterRT.texture.colorSpace = THREE.SRGBColorSpace;
      if (!this.posterQuad) {
        this.posterQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, toneMapped: false }));
        this.posterQuad.frustumCulled = false;
        this.posterPass.add(this.posterQuad);
      }
      (this.posterQuad.material as THREE.MeshBasicMaterial).map = this.posterRT.texture;
      (this.posterQuad.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }
    // the target covers whole HUD pixels: the camera spans w*s × h*s css px
    const cam = this.posterCam;
    cam.left = 0;
    cam.right = w * s;
    cam.top = 0;
    cam.bottom = -h * s;
    cam.updateProjectionMatrix();
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.posterRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(this.posterScene, cam);
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear, prevAlpha);
    this.posterQuad!.position.set((w * s) / 2, -(h * s) / 2, 0);
    this.posterQuad!.scale.set(w * s, h * s, 1);
    renderer.clearDepth();
    renderer.render(this.posterPass, this.cam);
  }
  private posterCam = new THREE.OrthographicCamera(0, 1, 0, -1, -4000, 4000);

  dispose() {
    this.posterRT?.dispose();
    this.pp?.dispose();
    this.tarot.dispose();
    this.soul.dispose();
    this.paper.dispose();
    this.outlaw.dispose();
    this.arsenal.dispose();
    this.brass.dispose();
    this.glints.dispose();
    setGlintFx(null);
    const i = this.hud.painters.indexOf(this);
    if (i >= 0) this.hud.painters.splice(i, 1);
    this.posterUi?.remove();
    this.hud.canvas.style.display = '';
    this.hud.use3D = false;
    this.tex.dispose();
  }
}

// ------------------------------------------------------------------ the heart (photographed only)
function heartRig() {
  if (heart) return heart;
  try {
    const spec = hudHeartRig();
    const rig = new RigInstance(buildRigGeo(spec, 'hud_heart:sprite'), { material: SpriteBank.get().material(), castShadow: false });
    const height = (spec.meta?.height as number) ?? 0.14;
    rig.root.scale.setScalar(36 / height);
    // turned so the apex hangs down: it reads as a heart at a glance
    rig.root.rotation.set(0.1, 0, -0.38);
    // measure the biggest beat once: every frame shares that framing, so the beat shows
    poseHeart(rig, 1, 1);
    rig.root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(rig.root);
    const root = wrap(rig.root, framingBox([b.min.x - 1, b.min.y - 1, b.min.z - 1], [b.max.x + 1, b.max.y + 1, b.max.z + 1]));
    heart = { rig, root, height };
  } catch (e) {
    console.warn('[hud] heart failed', e);
    return null;
  }
  return heart;
}

/** squeeze the heart for a beat (0 rest … 1 the lub) and loosen its linen for a health fraction */
function poseHeart(hr: RigInstance, frac: number, lub: number) {
  const n = hr.nodes;
  const sq = 1 + lub * 0.085;
  if (n['heart']) n['heart'].scale.set(sq, sq, sq);
  for (const v of ['aorta', 'pulmonary', 'vena']) if (n[v]) n[v].scale.setScalar(1 + lub * 0.12);
  const axes = (hr.geo.spec.meta?.wrapAxes as [number, number, number][] | undefined) ?? [];
  for (let i = 0; i < 6; i++) {
    const w = n['wrap' + (i + 1)];
    if (!w) continue;
    const loosen = Math.max(0, Math.min(1, (1 - frac) * 6.5 - (5 - i)));
    const ax = axes[i] ?? [0, 1, 0];
    w.quaternion.setFromAxisAngle(new THREE.Vector3(ax[0], ax[1], ax[2]).normalize(), loosen * (0.35 + 0.08 * Math.sin(i * 1.7)));
  }
}

/** a consumable's own model, turned to show its best side */
function itemShot(key: string): Shot | null {
  const me = modelEntry(key);
  const r = me?.() as any;
  const sm = r?.model ? r : r?.base ? { model: r.base, voxelSize: r.voxelSize } : null;
  if (!sm?.model) return null;
  const mesh = new THREE.Mesh(buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize ?? 0.05, pivot: 'center' }), SpriteBank.get().material());
  mesh.rotation.set(0.1, 0, 0.1);
  return { obj: wrap(mesh), w: 18, h: 18, yaw: 0.6, pitch: 0.4, fit: true, after: () => mesh.geometry.dispose() };
}
