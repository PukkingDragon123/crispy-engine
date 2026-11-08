// 3D HUD layer: the 2D pixel-art HUD canvas is composited in WebGL and real
// voxel models sit on top of it in the lower part of the HUD — the revolver
// cylinder (rounds in chambers, spins per shot with motion ghosts, swings out on
// reload, spits brass that tumbles off the screen), the beating wrapped heart and
// the consumables as little turntable models in their slots. The upper and
// framing pieces are stylized 2D pixel art painted into the canvas (Hud.painters):
// this class paints the purse coin, the mission notes and the outlaw readouts. cutIn() no longer draws anything on
// screen: it hands every big moment to the in-world cutscene director
// (cine/Cinema.ts: boss arrivals, area titles, voxel title stamps).
// Also hosts: the SOUL BAR (Serket's 3D soul jar above the heart, Pinch guarding
// its lid — SoulBar.ts), the long-gun magazines, gun belt and treasure (3D,
// ArsenalHud.ts), the 3D tarot cards (TarotBar.ts), the MISSION PAPER notes (2D,
// MissionPaper.ts) and the outlaw readouts — tin star, tally plank, wave plaque,
// break stopwatch (2D, OutlawHud.ts) — and the pause poster (rendered at HUD
// pixel resolution).
import * as THREE from 'three';
import type { Hud, HudPainter } from './Hud';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { globalUniforms, makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { buildRigGeo, RigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import { TOON } from '../models/style';
import { FaceQuads, RigEyes, EyeStyle } from '../fx/FaceFx';
import { TarotBar } from './TarotBar';
import { hudCylinder, hudRound, hudHeartRig } from '../models/props/hud';
import { PausePoster } from './PausePoster';
import { SoulBar } from './SoulBar';
import { MissionPaper, questFromObjective } from './MissionPaper';
import { OutlawHud } from './OutlawHud';
import { Cinema, type BossLike } from '../cine/Cinema';
import { ArsenalHud } from './ArsenalHud';
import { SpriteBank, blitObj, glint, setGlintFx } from './HudSprites';
import { PixelFx } from './HudKit';
import { HUD_ART as ART } from './HudArt';
import { sprite } from './PixelUI';

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

const CR = 14; // cylinder radius in voxels
const CL = 10; // cylinder length in voxels
const CH = 8.4; // chamber distance from axis
const HR = 3.3; // chamber radius

function chamberAngle(i: number, n: number) {
  return Math.PI / 2 - (i / n) * Math.PI * 2;
}

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
        if (edge && d > CR - 0.8) continue; // bevel both faces
        if (flute && z > 1 && z < CL - 2) continue;
        let c = I.base;
        if (z === CL - 1) {
          // rear face, hand-painted: rim highlight arc, dark rings around chambers
          c = I.base;
          if (d > CR - 2.6) c = lit > 0.35 ? I.hi : lit < -0.45 ? I.shade : I.base;
          if (rimHole) c = I.dark;
        } else if (flute || (d > CR - 3.6 && Math.abs(seg - 0.5) < 0.2)) c = I.shade;
        else if (z === 0) c = I.shade;
        else if (lit > 0.6 && d > CR - 1.5) c = I.hi;
        m.set(x, y, z, c);
      }
    }
  // ratchet star + pin
  for (let x = -2; x <= 2; x++)
    for (let y = -2; y <= 2; y++) {
      if (Math.abs(x) + Math.abs(y) > 2) continue;
      m.set(x, y, CL, Math.abs(x) + Math.abs(y) === 0 ? I.hi : I.shade);
    }
  return m;
}

function roundModel(venom: boolean) {
  const m = new VoxelModel('hud_round');
  const B = TOON.brass;
  for (let x = -4; x <= 4; x++)
    for (let y = -4; y <= 4; y++) {
      const d = Math.hypot(x, y);
      for (let z = 0; z <= 8; z++) {
        if (z < 8 && d > HR - 0.3) continue;
        if (z === 8 && d > HR + 0.75) continue;
        let c = B.shade;
        if (z === 8) {
          c = d < 1.3 ? (venom ? TOON.serket.base : TOON.silver.hi) : d > HR - 0.2 ? ((-x + y) > 1 ? B.hi : B.base) : B.base;
          if (venom && d >= 1.3 && d < 2.2) c = TOON.serket.shade;
        }
        m.set(x, y, z, c);
      }
    }
  return m;
}

interface Casing {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rx: number;
  ry: number;
  wx: number;
  wy: number;
  life: number;
}

export class Hud3D implements HudPainter {
  scene = new THREE.Scene();
  /** the 2D HUD canvas quad, drawn first in its own pass */
  private base = new THREE.Scene();
  private texW = 0;
  private texH = 0;
  cam = new THREE.OrthographicCamera(0, 1, 0, -1, -4000, 4000);
  private tex: THREE.CanvasTexture;
  private quad: THREE.Mesh;
  private mat: VoxelMaterial;
  private ghostMat: VoxelMaterial;
  private faces = new FaceQuads();
  // cylinder
  private hinge = new THREE.Group();
  private cylGroup = new THREE.Group();
  private ghosts: THREE.Group[] = [];
  private cylN = 0;
  private rounds: THREE.Mesh[] = [];
  private roundGeo: THREE.BufferGeometry;
  private venomGeo: THREE.BufferGeometry;
  private spentGeo: THREE.BufferGeometry | null = null;
  private heart: RigInstance | null = null;
  private heartMat: VoxelMaterial;
  private beat = 0;
  private heartHurt = 0;
  private lastHp = -1;
  private casings: Casing[] = [];
  private lastPhase = '';
  private lastShown = 6;
  private insertT: number[] = [];
  // coin (2D pixel art, painted with the HUD)
  private coinSpin = 0;
  /** light catching metal, glass and gilt on the 2D pieces: pixel twinkles */
  private glints = new PixelFx(240, true, 62);
  private bank = SpriteBank.get();
  /** the pause poster's clock (runs while the HUD is hidden too) */
  private pt = 0;
  /** the pause poster is rendered on its own at HUD-pixel resolution, then blown up nearest-neighbour */
  private posterScene = new THREE.Scene();
  private posterRT: THREE.WebGLRenderTarget | null = null;
  private posterQuad: THREE.Mesh | null = null;
  private posterPass = new THREE.Scene();
  private posterCam = new THREE.OrthographicCamera(0, 1, 0, -1, -4000, 4000);
  // items
  private itemMeshes: (THREE.Object3D | null)[] = [];
  private itemKeys: string[] = [];
  private itemGeo = new Map<string, { geo: THREE.BufferGeometry; size: number } | null>();
  private itemPop: number[] = [];
  private lastCounts: number[] = [];
  // soul jar, mission paper, outlaw furniture
  private soul: SoulBar;
  private paper: MissionPaper;
  private outlaw: OutlawHud;
  private arsenal: ArsenalHud;
  private t = 0;
  private bustSpec: RigSpec | null = null;
  /** the player's revolver (for card art that shows Sundown armed) */
  gunSpec: RigSpec | null = null;
  // pause poster
  private posterOpen = false;
  private posterUi: HTMLDivElement | null = null;
  private pp: PausePoster | null = null;
  private ppPending = false;
  private keyLight: THREE.DirectionalLight;
  /** the tarot ability cards (built lazily once the renderer and the player rig are known) */
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
    this.scene.add(this.glints.points);
    setGlintFx(this.glints);

    this.mat = makeVoxelMaterial({ fog: false });
    this.ghostMat = makeVoxelMaterial({ fog: false, transparent: true, opacity: 0.22 });
    this.ghostMat.depthWrite = false;
    this.ghostMat.depthTest = false;

    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a4a30, 1.1));
    this.keyLight = new THREE.DirectionalLight(0xfff0d8, 2.4);
    this.keyLight.position.set(-0.45, 0.8, 1).normalize();
    this.scene.add(this.keyLight);
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.5);
    fill.position.set(0.8, -0.2, 0.6);
    this.scene.add(fill);

    this.roundGeo = buildVoxelGeometry(roundModel(false), { voxelSize: 1, pivot: [0.5, 0.5, 9] });
    this.venomGeo = buildVoxelGeometry(roundModel(true), { voxelSize: 1, pivot: [0.5, 0.5, 9] });
    this.hinge.add(this.cylGroup);
    this.scene.add(this.hinge);
    for (let g = 0; g < 3; g++) {
      const gg = new THREE.Group();
      this.ghosts.push(gg);
      this.hinge.add(gg);
    }
    // health: a real heart in old linen, beating
    this.heartMat = makeVoxelMaterial({ fog: false });
    try {
      const spec = hudHeartRig();
      this.heart = new RigInstance(buildRigGeo(spec, 'hud_heart'), { material: this.heartMat, castShadow: false });
      this.scene.add(this.heart.root);
    } catch (e) {
      console.warn('[hud] heart failed', e);
    }
    this.scene.add(this.faces.mesh);

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

  /** player rig spec (and its geometry cache key) used for the cut-in bust */
  setBust(spec: RigSpec, cacheKey: string, gun?: RigSpec) {
    this.bustSpec = spec;
    this.bustKey = cacheKey;
    this.gunSpec = gun ?? null;
  }

  private buildCylinder(n: number) {
    this.cylN = n;
    // the cylinder model exists for 5-9 chambers; long guns (drums) clamp here
    n = Math.max(5, Math.min(9, n));
    for (const g of [this.cylGroup, ...this.ghosts]) g.clear();
    // the floating magazine: the hi-res rusty cylinder (fallback: the simple procedural one)
    let geo: THREE.BufferGeometry;
    let geoZ = 0;
    let chambers: [number, number][] = [];
    let seat = 0.01;
    try {
      const hc = hudCylinder(n);
      const u = CR / hc.meta.radius; // HUD units per metre
      geo = buildVoxelGeometry(hc.model, { voxelSize: hc.voxelSize * u, pivot: hc.pivot });
      geoZ = -hc.meta.rearZ * u;
      chambers = hc.meta.chambers.map(([x, y]) => [x * u, y * u]);
      const mkRound = (k: 'brass' | 'venom' | 'spent') => {
        const r = hudRound(k, n);
        seat = r.meta.seatOffset * u;
        return buildVoxelGeometry(r.model, { voxelSize: r.voxelSize * u, pivot: r.pivot });
      };
      this.roundGeo = mkRound('brass');
      this.venomGeo = mkRound('venom');
      this.spentGeo = mkRound('spent');
    } catch (e) {
      console.warn('[hud] hi-res cylinder failed, using fallback', e);
      geo = buildVoxelGeometry(cylinderModel(n), { voxelSize: 1, pivot: [0.5, 0.5, CL] });
      chambers = Array.from({ length: n }, (_, i) => [Math.cos(chamberAngle(i, n)) * CH, Math.sin(chamberAngle(i, n)) * CH]);
    }
    const mk = (g: THREE.Group, mat: THREE.Material, keep: boolean) => {
      const body = new THREE.Mesh(geo, mat);
      body.position.z = geoZ;
      g.add(body);
      for (let i = 0; i < n; i++) {
        const r = new THREE.Mesh(this.roundGeo, mat);
        r.position.set(chambers[i][0], chambers[i][1], seat);
        r.userData.seat = seat;
        g.add(r);
        if (keep) this.rounds[i] = r;
      }
    };
    this.rounds = [];
    mk(this.cylGroup, this.mat, true);
    for (const g of this.ghosts) mk(g, this.ghostMat, false);
    this.insertT = new Array(n).fill(1);
  }

  private itemObject(key: string): THREE.Object3D | null {
    if (!key) return null;
    let e = this.itemGeo.get(key);
    if (e === undefined) {
      e = null;
      const me = modelEntry(key);
      try {
        const r = me?.() as any;
        const sm = r?.model ? r : r?.base ? { model: r.base, voxelSize: r.voxelSize } : null;
        if (sm?.model) {
          const geo = buildVoxelGeometry(sm.model, { voxelSize: 1, pivot: 'center' });
          geo.computeBoundingBox();
          const b = geo.boundingBox!;
          const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
          e = { geo, size };
        }
      } catch (err) {
        console.warn('hud item model failed', key, err);
      }
      this.itemGeo.set(key, e);
    }
    if (!e) return null;
    const mesh = new THREE.Mesh(e.geo, this.mat);
    mesh.userData.size = e.size;
    const holder = new THREE.Group();
    holder.add(mesh);
    return holder;
  }

  /**
   * Big moments (boss arrivals, area names, ultimates, MOVE UNLOCKED, NECK SLICER...).
   * Nothing is drawn on screen any more: the in-world cutscene director plays them
   * (letterboxed boss eruptions, establishing shots, voxel title stamps).
   */
  cutIn(title: string, color = '#9dff3a', expr = 'angry', opts: CutInOpts = {}) {
    Cinema.cutIn(title, color, expr, opts);
  }

  // ================================================================ the 2D pieces (called from Hud.update)
  paint(c: CanvasRenderingContext2D, dt: number) {
    const hud = this.hud;
    const A = hud.anchors;
    if (!(hud.visible && A.slide < 0.98)) return;
    const s = hud.scale;
    {
      const st = hud.last;
      const quests = st?.quests ?? (st?.objective ? [questFromObjective(st.objective)] : []);
      for (const [id, ok] of hud.questEnds) this.paper.end(id, ok);
      hud.questEnds.clear();
      this.paper.paint(c, dt, quests, A.paper, s, hud.recentToasts());
      hud.paperBottom = this.paper.bottom;
    }
    if (A.outlaw) this.outlaw.paint(c, dt, A.outlaw, s);
    this.paintCoin(c, dt);
  }

  /** the purse coin: a pixel flip-book turn (face, three-quarter, half, edge and back) */
  private paintCoin(c: CanvasRenderingContext2D, dt: number) {
    const co = this.hud.anchors.coin;
    this.coinSpin += dt * (1.6 + co.pop * 26);
    const seq = [0, 1, 2, 3, 2, 1];
    const f = seq[Math.floor((this.coinSpin / Math.PI) * 6) % 6];
    const sp = sprite(ART['coin' + f]);
    const y = co.y - Math.round(co.pop * 3);
    blitObj(c, sp, co.x, y, 2 + co.pop * 3);
    if (f === 0) glint(sp, co.x, y, 0.35 + co.pop * 6, dt);
  }

  update(dt: number) {
    this.t += dt;
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
    this.faces.begin();
    const A = hud.anchors;
    const visible = hud.visible && A.slide < 0.98;

    // ------------------------------------------------ cylinder
    const cy = A.cyl;
    if (cy.n !== this.cylN) this.buildCylinder(cy.n);
    const vox = (cy.R * s) / (CR + 0.5); // css px per voxel
    this.hinge.visible = visible && !cy.hidden;
    const hx = cy.x * s - CR * vox * 1.05, hy = -cy.y * s;
    this.hinge.position.set(hx, hy + Math.sin(this.t * 1.6) * 2.5 * s, 0);
    this.hinge.scale.setScalar(vox);
    // floats, turned a little so its rusty depth shows; swings out on reload
    this.hinge.rotation.set(-0.18 - cy.open * 0.35 + Math.sin(this.t * 0.9) * 0.04, 0.32 - cy.open * 1.05 + Math.sin(this.t * 0.7) * 0.05, 0);
    const place = (g: THREE.Group, rot: number) => {
      g.position.set(CR * 1.05, 0, 0);
      g.rotation.set(0, 0, -rot);
    };
    place(this.cylGroup, cy.rot);
    const spd = Math.abs(cy.angVel);
    const ng = Math.min(3, Math.floor(spd / 5));
    this.ghosts.forEach((g, i) => {
      g.visible = i < ng;
      place(g, cy.rot + (i + 1) * 0.11 * Math.sign(cy.angVel));
    });
    // rounds: loaded / venom / insertion pop
    if (cy.shown > this.lastShown && cy.phase === 'insert') for (let i = this.lastShown; i < cy.shown && i < this.insertT.length; i++) this.insertT[i] = 0;
    for (let i = 0; i < this.rounds.length; i++) {
      const r = this.rounds[i];
      const loaded = i < cy.shown;
      r.visible = loaded;
      r.geometry = i < cy.venom ? this.venomGeo : this.roundGeo;
      this.insertT[i] = Math.min(1, this.insertT[i] + dt * 7);
      const k = this.insertT[i];
      r.position.z = (r.userData.seat ?? 0.01) + (1 - k) * 9;
      r.scale.setScalar(1 + (1 - k) * 0.5);
      for (const g of this.ghosts) {
        const gr = g.children[i + 1];
        if (gr) gr.visible = loaded;
      }
    }
    // eject: every spent case flies out and tumbles off screen
    if (cy.phase === 'eject' && this.lastPhase !== 'eject') {
      const n = this.rounds.length;
      for (let i = 0; i < n; i++) {
        const a = chamberAngle(i, n) - cy.rot;
        const mesh = new THREE.Mesh(this.spentGeo ?? this.roundGeo, this.mat);
        mesh.scale.setScalar(vox);
        this.scene.add(mesh);
        const wx = hx + (CR * 1.05 - CR * 0.3) * vox + Math.cos(a) * CH * vox * 0.6;
        const wy = hy + Math.sin(a) * CH * vox;
        this.casings.push({ mesh, x: wx, y: wy, vx: (-120 - Math.random() * 220) * (s / 2), vy: (220 + Math.random() * 260) * (s / 2), rx: Math.random() * 6, ry: Math.random() * 6, wx: (Math.random() - 0.5) * 30, wy: (Math.random() - 0.5) * 30, life: 1.6 });
      }
    }
    this.lastPhase = cy.phase;
    this.lastShown = cy.shown;
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life -= dt;
      c.vy -= 1500 * (s / 2) * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rx += c.wx * dt;
      c.ry += c.wy * dt;
      c.mesh.position.set(c.x, c.y, 50);
      c.mesh.rotation.set(c.rx, c.ry, 0);
      if (c.life <= 0 || c.y < -H - 60) {
        c.mesh.removeFromParent();
        this.casings.splice(i, 1);
      }
    }

    // ------------------------------------------------ heart
    if (this.heart) {
      const hh = A.heart;
      const hr = this.heart;
      hr.root.visible = visible;
      const frac = Math.max(0, Math.min(1, hh.frac));
      if (this.lastHp >= 0 && frac < this.lastHp - 0.003) this.heartHurt = 1;
      this.lastHp = frac;
      this.heartHurt = Math.max(0, this.heartHurt - dt * 3);
      const bpm = 62 + (1 - frac) * 100;
      this.beat = (this.beat + dt * (bpm / 60)) % 1;
      const ph = this.beat;
      const lub = Math.exp(-(((ph - 0.02) / 0.06) ** 2)) + 0.6 * Math.exp(-(((ph - 0.27) / 0.07) ** 2));
      const height = (hr.geo.spec.meta?.height as number) ?? 0.14;
      const sz = (36 * s) / height;
      const sq = 1 + lub * 0.085 - this.heartHurt * 0.12;
      hr.root.scale.setScalar(sz);
      const n = hr.nodes;
      if (n['heart']) n['heart'].scale.set(sq * (1 + this.heartHurt * 0.05), sq, sq);
      for (const v of ['aorta', 'pulmonary', 'vena']) if (n[v]) n[v].scale.setScalar(1 + lub * 0.12);
      // wraps loosen from the top down as health drains
      const axes = (hr.geo.spec.meta?.wrapAxes as [number, number, number][] | undefined) ?? [];
      for (let i = 0; i < 6; i++) {
        const w = n['wrap' + (i + 1)];
        if (!w) continue;
        const loosen = Math.max(0, Math.min(1, (1 - frac) * 6.5 - (5 - i)));
        const ax = axes[i] ?? [0, 1, 0];
        w.quaternion.setFromAxisAngle(new THREE.Vector3(ax[0], ax[1], ax[2]).normalize(), loosen * (0.35 + 0.08 * Math.sin(this.t * 3 + i)));
      }
      const shake = this.heartHurt * 4 * s;
      hr.root.position.set(hh.x * s + (Math.random() - 0.5) * shake, -hh.y * s + (Math.random() - 0.5) * shake, 0);
      hr.root.rotation.set(0.1, Math.sin(this.t * 0.6) * 0.45, Math.sin(this.t * 0.8) * 0.05);
      const tint = this.heartMat.userData.tint.value;
      const low = frac < 0.3 ? 0.5 + 0.5 * Math.sin(this.t * 10) : 0;
      tint.setRGB(1 + this.heartHurt * 0.4 + low * 0.25, 1 - this.heartHurt * 0.2, 1 - this.heartHurt * 0.2);
    }

    // ------------------------------------------------ items
    A.items.forEach((it, i) => {
      if (this.itemKeys[i] !== it.model) {
        this.itemMeshes[i]?.removeFromParent();
        this.itemMeshes[i] = this.itemObject(it.model);
        this.itemKeys[i] = it.model;
        if (this.itemMeshes[i]) this.scene.add(this.itemMeshes[i]!);
        this.itemPop[i] = 1;
      }
      hud.items3D[i] = !!this.itemMeshes[i];
      const o = this.itemMeshes[i];
      if (!o) return;
      if (this.lastCounts[i] !== undefined && it.count < this.lastCounts[i]) this.itemPop[i] = 1;
      this.lastCounts[i] = it.count;
      this.itemPop[i] = Math.max(0, (this.itemPop[i] ?? 0) - dt * 3);
      const mesh = o.children[0] as THREE.Mesh;
      const sz = (it.size * s * 0.72) / (mesh.userData.size || 1);
      o.visible = visible;
      o.position.set(it.x * s, -it.y * s, 0);
      o.scale.setScalar(sz * (1 + this.itemPop[i] * 0.35));
      o.rotation.set(0.45, this.t * 0.9 + i * 1.7 + this.itemPop[i] * 6, 0.1);
    });
    for (let i = A.items.length; i < this.itemMeshes.length; i++) if (this.itemMeshes[i]) this.itemMeshes[i]!.visible = false;

    // ------------------------------------------------ soul jar, outlaw readouts, mission paper
    this.soul.update(dt, A.soul, visible, s);
    this.outlaw.fx(dt, s, visible);
    this.paper.fx(dt, s, visible);
    this.glints.points.visible = visible;
    this.glints.update(dt, s);
    this.arsenal.update(dt, A.arsenal, visible, s, !!cy.hidden);
    Cinema.poll(this.hud);
    this.updatePoster(dt, W, H);
    this.tarot.update(dt, W, H);
    this.faces.end(null);
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
  dispose() {
    this.posterRT?.dispose();
    this.pp?.dispose();
    this.glints.dispose();
    setGlintFx(null);
    const pi = this.hud.painters.indexOf(this);
    if (pi >= 0) this.hud.painters.splice(pi, 1);
    this.tarot.dispose();
    this.soul.dispose();
    this.paper.dispose();
    this.outlaw.dispose();
    this.arsenal.dispose();
    this.posterUi?.remove();
    this.hud.canvas.style.display = '';
    this.hud.use3D = false;
    this.tex.dispose();
  }
}
