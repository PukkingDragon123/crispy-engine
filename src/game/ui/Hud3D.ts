// 3D HUD layer: the 2D pixel-art HUD canvas is composited in WebGL and real
// voxel models sit on top of it — the revolver cylinder (rounds in chambers,
// spins per shot with motion ghosts, swings out on reload, spits brass that
// tumbles off the screen), a spinning gold coin by the purse, the consumables
// as little turntable models in their slots, and Pinch as an idol inside the
// ultimate ring. Also hosts the ultimate cut-in: a 2D speed-line band with a
// lit 3D bust of Sundown (2D eyes) and an Alagard title.
import * as THREE from 'three';
import type { Hud } from './Hud';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { globalUniforms, makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { buildRigGeo, RigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import { TOON } from '../models/style';
import { FaceQuads, RigEyes, EyeStyle } from '../fx/FaceFx';
import { paintNotice } from './Choice';
import { TAROT, buildTarotFaces } from './TarotCards';
import { hudCylinder, hudRound, hudHeartRig } from '../models/props/hud';

interface Card {
  key: string;
  group: THREE.Group;
  face: THREE.Mesh;
  shade: THREE.Mesh;
  frame: THREE.Mesh;
  pop: number;
  lastCd: number;
  lastCharges: number;
  burst: number[];
  ready: number;
}

export interface CutInOpts {
  /** rig to show as the bust (default: the player) */
  geo?: RigGeo;
  eyes?: [EyeStyle, number];
  /** subject height in meters (default spec.meta.height) */
  height?: number;
  /** bust on the right side, title on the left */
  flip?: boolean;
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

export class Hud3D {
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
  // coin
  private coin: THREE.Mesh;
  private coinSpin = 0;
  // items
  private itemMeshes: (THREE.Object3D | null)[] = [];
  private itemKeys: string[] = [];
  private itemGeo = new Map<string, { geo: THREE.BufferGeometry; size: number } | null>();
  private itemPop: number[] = [];
  private lastCounts: number[] = [];
  // pinch idol
  private pinch: RigInstance | null = null;
  private pinchMat: VoxelMaterial;
  private t = 0;
  // cut-in
  private cut: {
    t: number;
    dur: number;
    band: THREE.Mesh;
    title: THREE.Mesh;
    bust: RigInstance | null;
    eyes: RigEyes | null;
    planes: THREE.Plane[];
    flip: boolean;
    height: number;
    human: boolean;
  } | null = null;
  private bandMat: THREE.ShaderMaterial;
  private bustSpec: RigSpec | null = null;
  /** the player's revolver (for card art that shows Sundown armed) */
  gunSpec: RigSpec | null = null;
  // pause poster
  private poster: THREE.Mesh | null = null;
  private posterK = 0;
  private posterOpen = false;
  private posterUi: HTMLDivElement | null = null;
  private posterMat: THREE.ShaderMaterial | null = null;
  private keyLight: THREE.DirectionalLight;
  private cards: Card[] = [];
  private cardsBuilt = false;
  private lastUlt = 0;

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

    this.mat = makeVoxelMaterial({ fog: false });
    this.ghostMat = makeVoxelMaterial({ fog: false, transparent: true, opacity: 0.22 });
    this.ghostMat.depthWrite = false;
    this.ghostMat.depthTest = false;
    this.pinchMat = makeVoxelMaterial({ fog: false });

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
    this.coin = new THREE.Mesh(buildVoxelGeometry(coinModel(), { voxelSize: 1, pivot: [0.5, 0.5, 0.5] }), this.mat);
    this.scene.add(this.coin);
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

    // pinch idol
    const pe = modelEntry('pinch');
    const ps = pe?.() as RigSpec | undefined;
    if (ps?.parts) {
      this.pinch = new RigInstance(buildRigGeo(ps, ps.name + ':hud'), { material: this.pinchMat, castShadow: false });
      this.scene.add(this.pinch.root);
    }

    this.bandMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uCol: { value: new THREE.Color(0x9dff3a) }, uAspect: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uT, uAspect; uniform vec3 uCol; varying vec2 vUv;
        float h(float n){ return fract(sin(n*91.7)*43758.5); }
        void main(){
          vec2 p = vec2(vUv.x * uAspect, vUv.y);
          // pixelate to 4px-ish cells for a pixel-art band
          vec2 cell = floor(p * vec2(220.0, 64.0));
          float row = cell.y;
          // speed lines rushing right-to-left
          float sp = step(0.82, h(row * 1.31)) * step(0.45, fract((cell.x + uT * (900.0 + h(row)*600.0)) / (60.0 + h(row*7.0)*140.0)));
          // halftone dots fading toward the left
          vec2 dc = fract(p * vec2(110.0, 32.0)) - 0.5;
          float dotR = 0.42 * smoothstep(0.15, 1.0, vUv.x);
          float dots = step(length(dc), dotR);
          vec3 base = vec3(0.07, 0.05, 0.04);
          vec3 c = mix(base, uCol * 0.45, dots * 0.55);
          c = mix(c, vec3(1.0, 0.96, 0.85), sp * 0.85);
          // border stripes
          float b = min(vUv.y, 1.0 - vUv.y);
          if (b < 0.045) c = uCol;
          else if (b < 0.07) c = vec3(0.02);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
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
    if (open && !this.poster) {
      const tex = paintNotice({ title: 'Paused', body: 'The outlaws hold their breath. The sand does not.\n\nWASD ride · SPACE jump · SHIFT drift · MOUSE aim & shoot · R reload · F kick · Q grapple · E scorpions · C swarm · G dung bomb · Z ultimate · 1/2 items · T interact', footer: 'Reward: a breather', stamp: 'ON HOLD' }, 300, 430);
      this.posterMat = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, uT: { value: 0 }, uAmp: { value: 1 } },
        vertexShader: `uniform float uT, uAmp; varying vec2 vUv; void main(){ vUv = uv; vec3 p = position;
          float w = sin(p.y * 0.012 + uT * 7.0) * (1.0 - uv.y) * 6.0 * uAmp + sin(p.x * 0.02 + uT * 5.0) * (1.0 - uv.y) * 4.0 * uAmp;
          p.x += w; p.y += sin(p.x * 0.015 + uT * 6.0) * 3.0 * uAmp * (1.0 - uv.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
        fragmentShader: `uniform sampler2D map; varying vec2 vUv; void main(){ vec4 t = texture2D(map, vUv); if (t.a < 0.5) discard; gl_FragColor = vec4(t.rgb, 1.0);
          #include <colorspace_fragment>
        }`,
        depthTest: false,
        depthWrite: false,
      });
      this.poster = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 12, 16), this.posterMat);
      this.poster.renderOrder = 20;
      this.poster.frustumCulled = false;
      this.scene.add(this.poster);
    }
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
    this.posterK = Math.max(0, Math.min(1, this.posterK + (this.posterOpen ? dt * 3 : -dt * 4)));
    if (!this.poster) return;
    const k = this.posterK;
    this.poster.visible = k > 0.001;
    if (!this.poster.visible) return;
    const e = 1 - Math.pow(1 - k, 3);
    const ph = Math.min(H * 0.86, 640), pw = ph * (300 / 430);
    this.poster.scale.set(pw, ph, 1);
    this.poster.position.set(W / 2 + (1 - e) * W * 0.8, -H / 2 + (1 - e) * 120, 400);
    this.poster.rotation.z = (1 - e) * -0.9 + Math.sin(this.t * 1.3) * 0.015;
    this.posterMat!.uniforms.uT.value = this.t;
    this.posterMat!.uniforms.uAmp.value = 0.35 + (1 - e) * 3;
    if (this.posterUi) {
      this.posterUi.style.left = `${W / 2 + (1 - e) * W * 0.8}px`;
      this.posterUi.style.top = `${H / 2 + ph * 0.06}px`;
      this.posterUi.style.opacity = String(e);
    }
  }

  /** the tarot ability bar: faces photographed from the posed 3D skeleton (needs the renderer) */
  private buildCards(renderer: THREE.WebGLRenderer) {
    this.cardsBuilt = true;
    const geo = this.bustSpec ? buildRigGeo(this.bustSpec, this.bustKey) : null;
    let faces: Record<string, HTMLCanvasElement> = {};
    try {
      faces = buildTarotFaces(renderer, geo);
    } catch (e) {
      console.warn('[hud] tarot faces failed', e);
      return;
    }
    for (const d of TAROT) {
      const cv = faces[d.key];
      if (!cv) continue;
      const tex = new THREE.CanvasTexture(cv);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      const group = new THREE.Group();
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, depthTest: false, depthWrite: false, transparent: true }));
      const back = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 1.04), new THREE.MeshBasicMaterial({ color: 0x1a0e08, toneMapped: false, depthTest: false, depthWrite: false, transparent: true, opacity: 0.55 }));
      back.position.set(0.03, -0.03, -1);
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.05), new THREE.MeshBasicMaterial({ color: 0xffd36b, toneMapped: false, depthTest: false, depthWrite: false, transparent: true, opacity: 0 }));
      frame.position.z = -0.5;
      const shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x120a06, toneMapped: false, depthTest: false, depthWrite: false, transparent: true, opacity: 0.62 }));
      shade.position.z = 1;
      for (const m of [back, frame, face, shade]) {
        m.frustumCulled = false;
        group.add(m);
      }
      back.renderOrder = 30;
      frame.renderOrder = 31;
      face.renderOrder = 32;
      shade.renderOrder = 33;
      this.scene.add(group);
      this.cards.push({ key: d.key, group, face, shade, frame, pop: 0, lastCd: 0, lastCharges: -1, burst: d.burst, ready: 0 });
    }
  }

  private updateCards(dt: number, W: number, H: number) {
    const hud = this.hud;
    const st = hud.last;
    if (!st || !this.cards.length) return;
    const s = hud.scale;
    const visible = hud.visible && hud.anchors.slide < 0.98;
    const cw = 40 * s, ch = 65 * s;
    const n = this.cards.length;
    hud.cardAnchors.length = 0;
    this.cards.forEach((c, i) => {
      const ult = c.key === 'Z';
      const sk = st.skills.find((k) => k.key === c.key);
      const frac = ult ? 1 - Math.min(1, st.ult) : sk && sk.max > 0 ? Math.min(1, sk.cd / sk.max) : 0;
      const cdNow = ult ? (st.ult >= 1 ? 0 : 99) : sk?.cd ?? 0;
      // used? cooldown jumped up, a charge was spent, or the ultimate fired
      const charges = sk?.charges ?? -1;
      const used = ult ? this.lastUlt >= 1 && st.ult < 0.5 : cdNow > c.lastCd + 0.4 || (charges >= 0 && c.lastCharges >= 0 && charges < c.lastCharges);
      c.lastCd = cdNow;
      c.lastCharges = charges;
      if (used) {
        c.pop = 1;
        this.engineBurst(c, s);
      }
      c.pop = Math.max(0, c.pop - dt * 1.6);
      const readyNow = frac <= 0.001;
      c.ready = readyNow ? Math.min(1, c.ready + dt * 4) : 0;
      // fan along the bottom-right, the ultimate largest at the end
      const big = ult ? 1.22 : 1;
      const slot = n - 1 - i;
      const x = W - (16 + 22) * s - slot * cw * 0.98 - (ult ? 0 : cw * 0.2);
      const fan = (slot - (n - 1) / 2) * 0.045;
      const bob = Math.sin(this.t * 1.4 + i * 1.3) * 2.2 * s;
      const k = c.pop;
      const lift = Math.sin(Math.min(1, (1 - k) * 1.0) * Math.PI) * (k > 0 ? 1 : 0);
      const y = H - 14 * s - (ch * big) / 2 - bob - lift * 50 * s;
      c.group.visible = visible;
      c.group.position.set(x, -y, 600 + i);
      c.group.scale.set(cw * big * (1 + k * 0.35), ch * big * (1 + k * 0.35), 1);
      c.group.rotation.set(0, k > 0 ? (1 - k) * Math.PI * 2 : 0, fan + Math.sin(this.t * 0.9 + i) * 0.02);
      // sand fills the card back up as the cooldown recovers (the shade covers the unrecovered top part)
      c.shade.visible = frac > 0.001;
      c.shade.scale.y = frac;
      c.shade.position.y = 0.5 - frac / 2;
      // ready: a brass frame breathes around the card
      (c.frame.material as THREE.MeshBasicMaterial).opacity = c.ready * (ult ? 0.55 + Math.sin(this.t * 6) * 0.3 : 0.25 + Math.sin(this.t * 3 + i) * 0.12);
      (c.face.material as THREE.MeshBasicMaterial).color.setScalar(readyNow ? 1 : 0.72);
      hud.cardAnchors.push({ key: c.key, x: x / s, y: y / s, h: (ch * big) / s, cd: ult ? 0 : cdNow });
    });
    this.lastUlt = st.ult;
  }

  private engineBurst(c: Card, s: number) {
    const x = c.group.position.x / s, y = -c.group.position.y / s;
    const cols = c.burst.map((h) => '#' + h.toString(16).padStart(6, '0'));
    this.hud.burst(x, y, cols, 34, 110);
  }

  /** player rig spec (and its geometry cache key) used for the cut-in bust */
  setBust(spec: RigSpec, cacheKey: string, gun?: RigSpec) {
    this.bustSpec = spec;
    this.bustKey = cacheKey;
    this.gunSpec = gun ?? null;
  }

  private buildCylinder(n: number) {
    this.cylN = n;
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

  /** ultimate / big-moment cut-in */
  cutIn(title: string, color = '#9dff3a', expr = 'angry', opts: CutInOpts = {}) {
    this.endCut();
    const W = window.innerWidth, H = window.innerHeight;
    const band = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.bandMat);
    band.renderOrder = 5;
    band.frustumCulled = false;
    this.bandMat.uniforms.uCol.value.set(color);
    this.scene.add(band);
    // title texture
    const cv = document.createElement('canvas');
    const fs = 44;
    const cx = cv.getContext('2d')!;
    cx.font = `${fs}px Alagard`;
    const tw = Math.ceil(cx.measureText(title).width) + 16;
    cv.width = tw;
    cv.height = fs + 20;
    const c2 = cv.getContext('2d')!;
    c2.font = `${fs}px Alagard`;
    c2.textBaseline = 'top';
    for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3], [3, 3], [-3, 3], [3, -3], [-3, -3]]) {
      c2.fillStyle = '#120a06';
      c2.fillText(title, 8 + dx, 8 + dy);
    }
    c2.fillStyle = color;
    c2.fillText(title, 8, 8);
    c2.fillStyle = 'rgba(255,255,255,0.35)';
    c2.fillRect(8, 8 + fs * 0.42, tw - 16, 2);
    const ttex = new THREE.CanvasTexture(cv);
    ttex.magFilter = THREE.NearestFilter;
    ttex.minFilter = THREE.NearestFilter;
    ttex.colorSpace = THREE.SRGBColorSpace;
    const tmat = new THREE.MeshBasicMaterial({ map: ttex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const titleM = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), tmat);
    const ts = Math.min(1.6, (W * 0.5) / tw) * 1.0;
    titleM.scale.set(tw * ts, cv.height * ts, 1);
    titleM.renderOrder = 7;
    titleM.frustumCulled = false;
    this.scene.add(titleM);
    // bust, clipped to the band
    let bust: RigInstance | null = null;
    let eyes: RigEyes | null = null;
    const planes = [new THREE.Plane(), new THREE.Plane()];
    const geo = opts.geo ?? (this.bustSpec ? buildRigGeo(this.bustSpec, this.bustKey) : null);
    if (geo) {
      const mat = makeVoxelMaterial({ fog: false });
      mat.clippingPlanes = planes;
      bust = new RigInstance(geo, { material: mat, castShadow: false });
      bust.setExpression(expr);
      eyes = new RigEyes(bust, opts.eyes?.[0] ?? 'glow', opts.eyes?.[1] ?? 0x9dff3a);
      this.scene.add(bust.root);
      for (const m of Object.values(bust.meshes)) m.renderOrder = 6;
    }
    void H;
    this.cut = { t: 0, dur: opts.geo ? 1.9 : 1.45, band, title: titleM, bust, eyes, planes, flip: !!opts.flip, height: opts.height ?? (geo?.spec.meta?.height as number) ?? 1.8, human: !!geo?.index['arm_r'] };
  }

  private endCut() {
    if (!this.cut) return;
    this.cut.band.removeFromParent();
    this.cut.title.removeFromParent();
    ((this.cut.title.material as THREE.MeshBasicMaterial).map as THREE.Texture).dispose();
    this.cut.bust?.root.removeFromParent();
    this.cut = null;
  }

  private updateCut(dt: number, W: number, H: number) {
    const c = this.cut!;
    c.t += dt;
    const k = c.t / c.dur;
    if (k >= 1) {
      this.endCut();
      return;
    }
    const inK = Math.min(1, c.t / 0.22);
    const outK = Math.max(0, (c.t - (c.dur - 0.22)) / 0.22);
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    const slide = (1 - ease(inK)) * -1 + ease(outK) * 1; // -1 -> 0 -> 1 (screen widths)
    const ang = -0.12;
    const bh = H * 0.34;
    const cx = W / 2 + slide * W * 1.3, cy = -H * 0.5;
    c.band.position.set(cx, cy, 100);
    c.band.rotation.z = ang;
    c.band.scale.set(W * 1.8, bh, 1);
    this.bandMat.uniforms.uT.value = c.t;
    this.bandMat.uniforms.uAspect.value = (W * 1.8) / bh;
    // title slides the opposite way, settles right of center
    const fl = c.flip ? -1 : 1;
    c.title.position.set(W / 2 + fl * W * 0.12 - slide * W * 1.1, cy + Math.sin(ang) * (fl * W * 0.12) - 6, 300);
    c.title.rotation.z = ang;
    // clip planes = band edges (normals pointing into the band)
    const n = new THREE.Vector3(-Math.sin(ang), Math.cos(ang), 0);
    const center = new THREE.Vector3(cx, cy, 0);
    c.planes[0].setFromNormalAndCoplanarPoint(n, center.clone().addScaledVector(n, -bh / 2 + bh * 0.07));
    c.planes[1].setFromNormalAndCoplanarPoint(n.clone().negate(), center.clone().addScaledVector(n, bh / 2 - bh * 0.07));
    if (c.bust) {
      const r = c.bust;
      const height = c.height;
      const s = (bh * (c.human ? 1.5 : 0.95)) / height; // head & chest fill the band
      r.root.scale.setScalar(s);
      const bx = W / 2 - fl * W * 0.23 + slide * W * 1.3 + c.t * 18 * fl;
      r.root.position.set(bx, cy - height * s * (c.human ? 0.72 : 0.45) + Math.sin(ang) * (bx - cx), 200);
      r.root.rotation.set(0.05, fl * (0.55 - c.t * 0.12), 0);
      // pose: gun arm raised across, head tilted down, menacing
      const nd = r.nodes;
      if (c.human && nd['arm_r']) nd['arm_r'].rotation.set(-1.9, 0.2, -0.5);
      if (nd['fore_r']) nd['fore_r'].rotation.set(-0.9, 0, 0);
      if (nd['arm_l']) nd['arm_l'].rotation.set(-0.4, 0, 0.5);
      if (nd['fore_l']) nd['fore_l'].rotation.set(-1.2, 0, 0);
      if (nd['head']) nd['head'].rotation.set(0.12 + Math.sin(c.t * 9) * 0.02, -0.25, 0.08);
      if (nd['jaw']) nd['jaw'].rotation.x = 0.25 + Math.abs(Math.sin(c.t * 11)) * 0.12;
      r.root.updateMatrixWorld(true);
      // the bust is clipped to the band; skip the 2D eyes when the head is outside it
      const head = r.nodes['eye_l'] ?? r.nodes['head'];
      const hp = head ? head.getWorldPosition(new THREE.Vector3()) : null;
      if (hp && c.planes[0].distanceToPoint(hp) > 0 && c.planes[1].distanceToPoint(hp) > 0) {
        c.eyes?.lookAt(new THREE.Vector3(bx + 400, cy, 900));
        c.eyes?.draw(this.faces, dt);
      }
    }
  }

  update(dt: number) {
    this.t += dt;
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
    this.hinge.visible = visible;
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

    // ------------------------------------------------ coin
    const co = A.coin;
    this.coin.visible = visible;
    this.coinSpin += dt * (1.6 + co.pop * 26);
    const cvox = (7.2 * s) / 7.5;
    this.coin.scale.setScalar(cvox * (1 + co.pop * 0.25));
    this.coin.position.set(co.x * s, -(co.y - co.pop * 3) * s, 0);
    this.coin.rotation.set(0.15, this.coinSpin, 0);

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

    // ------------------------------------------------ pinch idol
    if (this.pinch) {
      const u = A.ult;
      const p = this.pinch;
      p.root.visible = visible;
      const h = (p.geo.spec.meta?.length as number) ?? 0.5;
      const sc = (26 * s) / Math.max(0.3, h);
      const bounce = u.ready ? Math.abs(Math.sin(this.t * 6)) * 3 * s : 0;
      p.root.scale.setScalar(sc);
      p.root.position.set(u.x * s, -(u.y + 6) * s + bounce, 0);
      p.root.rotation.set(0.55, Math.sin(this.t * (u.ready ? 2.2 : 0.6)) * 0.7, 0);
      const n = p.nodes;
      for (let k = 1; k <= 5; k++) if (n['tail' + k]) n['tail' + k].rotation.x = -0.25 + Math.sin(this.t * (u.ready ? 7 : 2) + k * 0.6) * (u.ready ? 0.22 : 0.08);
      const snap = u.ready ? Math.max(0, Math.sin(this.t * 9)) * 0.6 : 0;
      if (n['pincer_l']) n['pincer_l'].rotation.x = -snap;
      if (n['pincer_r']) n['pincer_r'].rotation.x = -snap;
      const tint = this.pinchMat.userData.tint.value;
      const f = u.ready ? 1 : 0.45 + u.frac * 0.35;
      tint.setRGB(f, f, f * (u.ready ? 1 : 0.95));
      p.setExpression(u.ready ? 'happy' : 'sleepy');
      p.root.updateMatrixWorld(true);
    }

    if (this.cut) this.updateCut(dt, W, H);
    this.updatePoster(dt, W, H);
    this.updateCards(dt, W, H);
    this.faces.end(null);
  }

  render(renderer: THREE.WebGLRenderer) {
    if (!this.cardsBuilt && this.bustSpec) this.buildCards(renderer);
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
    globalUniforms.uRim.value = rim;
    renderer.autoClear = ac;
    renderer.localClippingEnabled = lc;
  }

  dispose() {
    this.endCut();
    this.posterUi?.remove();
    this.hud.canvas.style.display = '';
    this.hud.use3D = false;
    this.tex.dispose();
  }
}
