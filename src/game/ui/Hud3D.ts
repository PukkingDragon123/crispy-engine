// The HUD compositor. The whole run HUD is ONE flat, stylized pixel-art layer: the 2D
// HUD canvas (Hud.ts: frames, bars, type) with the pieces painted into it on the same
// integer pixel grid from hand-authored pixel sprites (HudArt.ts, drawn by PixelUI).
// This class paints its own pieces into that canvas (Hud.painters) — the revolver
// cylinder (the steel body never turns; each chamber's bore and round orbit the axis,
// rounds smear on a spin, pop in on a reload, spent brass tumbles off), the beating
// wrapped heart (beat frames, its linen coming loose as health drains), the spinning
// purse coin — and hands the rest to its modules: Serket's soul jar (SoulBar), the
// outlaw readouts (tin star, tally plank, wave plaque, stopwatch: OutlawHud), the
// long-gun magazines, gun belt and treasure markers (ArsenalHud), the mission notes
// (MissionPaper) and the tarot cards (TarotBar). Every piece casts a little pixel
// shadow and catches glints (HudSprites).
// It then draws that canvas as a nearest-neighbour quad and, over it, the 2D pixel
// particles (dust, soul motes, sparks) and the pause poster.
// cutIn() draws nothing: it hands every big moment to the in-world cutscene director
// (cine/Cinema.ts).
import * as THREE from 'three';
import type { Hud, HudPainter } from './Hud';
import { globalUniforms } from '../../engine/render/VoxelMaterial';
import type { RigGeo, RigSpec } from '../../engine/voxel/Rig';
import type { EyeStyle } from '../fx/FaceFx';
import { TarotBar } from './TarotBar';
import { PausePoster } from './PausePoster';
import { SoulBar } from './SoulBar';
import { MissionPaper, questFromObjective } from './MissionPaper';
import { OutlawHud } from './OutlawHud';
import { Cinema, type BossLike } from '../cine/Cinema';
import { ArsenalHud } from './ArsenalHud';
import { SpriteBank, blitC, blitObj, glint, setGlintFx, variant } from './HudSprites';
import { HUD_ART as ART } from './HudArt';
import { sprite, drawSprite, SWAP_FLASH, SWAP_LIT } from './PixelUI';
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

function chamberAngle(i: number, n: number) {
  return Math.PI / 2 - (i / n) * Math.PI * 2;
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
  /**
   * The cylinder, composed each frame from authored pixel parts: the steel body (lit from the
   * upper left, so it never turns), then each chamber's bore and its round orbiting the axis.
   */
  private cylinderImage(n: number, rho: number, shown: number, venom: number, roundsOnly = false) {
    const cv = this.cylCv;
    const g = cv.getContext('2d')!;
    const body = ART.cyl;
    if (cv.width !== body.w + 4) {
      cv.width = body.w + 4;
      cv.height = body.h + 4;
    }
    g.clearRect(0, 0, cv.width, cv.height);
    const cx = cv.width / 2, cy = cv.height / 2;
    if (!roundsOnly) g.drawImage(sprite(body), 2, 2);
    const step = (Math.PI * 2) / n;
    const R = body.w * 0.285;
    for (let i = 0; i < n; i++) {
      const a = chamberAngle(i, n) + rho;
      const x = cx + Math.cos(a) * R, y = cy - Math.sin(a) * R;
      if (!roundsOnly) {
        drawSprite(g, sprite(ART.cyl_socket), x, y);
        // the stop notch on the rim between two chambers
        const an = a - step / 2;
        drawSprite(g, sprite(ART.cyl_notch), cx + Math.cos(an) * (body.w * 0.43), cy - Math.sin(an) * (body.w * 0.43));
      }
      if (i < shown) {
        const pop = 1 - (this.insertT[i] ?? 1);
        drawSprite(g, sprite(i < venom ? ART.round_venom : ART.round_brass), x, y - Math.round(pop * 3));
      }
    }
    return cv;
  }
  private cylCv = document.createElement('canvas');
  private ghostCv = document.createElement('canvas');

  private paintCylinder(c: CanvasRenderingContext2D, dt: number) {
    const cy = this.hud.anchors.cyl;
    const n = Math.max(5, Math.min(9, cy.n));
    if (n !== this.cylN) {
      this.cylN = n;
      this.insertT = new Array(n).fill(1);
    }
    // spent brass tumbling off (drawn even while a long gun is up)
    this.paintCasings(c, dt);
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
        const r = ART.cyl.w * 0.285;
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
    const spd = Math.abs(cy.angVel);
    // floats a few pixels off the screen: its shadow falls down-right; light runs over the rims
    blitObj(c, this.cylinderImage(n, rho, cy.shown, cy.venom), x, y, 4);
    // motion ghosts while it spins: the rounds smeared back along their arc
    const ng = Math.min(3, Math.floor(spd / 5));
    for (let g = 1; g <= ng; g++) {
      const gi = this.cylinderImage(n, rho - g * 0.11 * Math.sign(cy.angVel), cy.shown, cy.venom, true);
      blitC(c, gi, x, y, 0.28 / g);
    }
    glint(sprite(ART.cyl), x, y, 0.5 + spd * 0.05, dt);
  }

  private paintCasings(c: CanvasRenderingContext2D, dt: number) {
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
      // a tumbling case: two authored angles, quarter-turned
      const f = ((Math.floor((k.r / Math.PI) * 4) % 8) + 8) % 8;
      const cv = sprite(f % 2 ? ART.casing1 : ART.casing0);
      const sh = variant(cv, 'shadow');
      drawSprite(c, sh, k.x + 3, k.y + 5, { turns: f >> 1, alpha: 0.3 * Math.min(1, k.life * 3) });
      drawSprite(c, cv, k.x, k.y, { turns: f >> 1, alpha: Math.min(1, k.life * 3) });
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
    // the linen wraps come loose from the top as health drains
    const wraps = frac > 0.75 ? 3 : frac > 0.5 ? 2 : frac > 0.25 ? 1 : 0;
    const def = ART[`heart${wraps}_${lub > 0.45 ? 1 : 0}`];
    const sp = sprite(def);
    const shake = this.heartHurt * 3;
    const x = hh.x + Math.round((Math.random() - 0.5) * shake), y = hh.y - 3 + Math.round((Math.random() - 0.5) * shake);
    blitObj(c, sp, x, y, 3);
    // hurt: a white-hot flash; low health: the heart flushes hot with every beat
    if (this.heartHurt > 0.05) blitC(c, sprite(def, SWAP_FLASH, 'flash'), x, y, this.heartHurt * 0.85);
    else if (frac < 0.3 && lub > 0.3) blitC(c, sprite(def, SWAP_LIT, 'lit'), x, y, 0.6);
  }

  // ---------------------------------------------------------------- purse coin
  private paintCoin(c: CanvasRenderingContext2D, dt: number) {
    const co = this.hud.anchors.coin;
    this.coinSpin += dt * (1.6 + co.pop * 26);
    // a flip-book turn: face, three-quarter, half, edge and back again
    const seq = [0, 1, 2, 3, 2, 1];
    const f = seq[Math.floor((this.coinSpin / Math.PI) * 6) % 6];
    const sp = sprite(ART['coin' + f]);
    const y = co.y - Math.round(co.pop * 3);
    blitObj(c, sp, co.x, y, 2 + co.pop * 3);
    if (f === 0) glint(sp, co.x, y, 0.35 + co.pop * 6, dt);
  }

  // ---------------------------------------------------------------- consumables
  /** the consumables are the HUD's own pixel icons (Hud.ts draws them in their slots) */
  private paintItems(c: CanvasRenderingContext2D, dt: number) {
    const hud = this.hud;
    hud.items3D.length = hud.anchors.items.length;
    hud.items3D.fill(false);
    void c;
    void dt;
    void this.itemPop;
    void this.lastCounts;
    void this.lastItemKey;
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

