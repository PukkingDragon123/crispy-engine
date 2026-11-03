// The physical upgrade card: the sculpted rarity frame (bronze / silver / gold /
// divine), the vignette photograph in its window, Alagard plaques front and back,
// and real cut gems in the level sockets. Lit by the world like any prop.
// Rare and better frames wear a holographic foil (a thin-film rainbow that slides
// with the viewing angle, a diffraction grating and glitter); a gold sheen can be
// swept across any card. Hovered cards breathe and their gems kindle; new level
// pips fill one by one. A hinged ledger (a walnut board with a parchment inset
// and a rarity-metal rim) folds out from behind the card with the full details:
// stat changes, levels, the next level, evolution path, synergies and flavour.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { hash3, noise } from '../../engine/math/rand';
import { SKILL_CARD, skillFrame, levelGem, SkillRarity, mixc } from '../models/props/tarot';
import { RARITY, Offer, UPGRADES, UPGRADE_BY_ID, UpgradeDef } from '../run/Upgrades';
import { fmtStat, DERIVED_INFO, CORE_INFO, StatId } from '../combat/Stats';
import { paintCardFront, paintCardBack, canvasTex, TEXT_PPV } from './CardArt';
import { skillFamily } from './SkillArt';

const VS = SKILL_CARD.voxelSize;
const frames = new Map<SkillRarity, THREE.BufferGeometry>();
const gems = new Map<string, THREE.BufferGeometry>();
const panels = new Map<SkillRarity, THREE.BufferGeometry>();
let backMat: THREE.MeshStandardMaterial | null = null;
let coreGeo: THREE.PlaneGeometry | null = null;

/** card size in metres */
export const CARD_W = SKILL_CARD.W * VS;
export const CARD_H = SKILL_CARD.H * VS;

function frameGeo(r: SkillRarity) {
  let g = frames.get(r);
  if (!g) {
    const f = skillFrame(r);
    g = buildVoxelGeometry(f.model, { voxelSize: f.voxelSize, pivot: f.pivot });
    frames.set(r, g);
  }
  return g;
}

function gemGeo(color: number, lit: boolean) {
  const k = color + (lit ? ':1' : ':0');
  let g = gems.get(k);
  if (!g) {
    const m = levelGem(color, lit);
    g = buildVoxelGeometry(m.model, { voxelSize: m.voxelSize, pivot: m.pivot });
    gems.set(k, g);
  }
  return g;
}

/** frame-local metres of a voxel rect's centre and size */
function rect(r: { x0: number; y0: number; x1: number; y1: number }) {
  return {
    x: ((r.x0 + r.x1 + 1) / 2 - SKILL_CARD.W / 2) * VS,
    y: ((r.y0 + r.y1 + 1) / 2 - SKILL_CARD.H / 2) * VS,
    w: (r.x1 - r.x0 + 1) * VS,
    h: (r.y1 - r.y0 + 1) * VS,
  };
}

// ------------------------------------------------------------------ foil frame material

/** per rarity: foil strength and the colour of the sweeping sheen */
const FOIL: Record<SkillRarity, { foil: number; sheen: number }> = {
  common: { foil: 0, sheen: 0xffe2a8 },
  uncommon: { foil: 0, sheen: 0xffe8b0 },
  rare: { foil: 0.55, sheen: 0xe6f0ff },
  epic: { foil: 0.8, sheen: 0xffd48a },
  legendary: { foil: 1.0, sheen: 0xffd36b },
  mythic: { foil: 1.15, sheen: 0xfff6dc },
};

type CardMat = VoxelMaterial & { foil: { uFoil: { value: number }; uSheen: { value: number }; uSheenCol: { value: THREE.Color } } };

/**
 * The game's voxel material plus holographic foil and a sheen band. One program
 * for every card (shared cache key); each card owns its uniforms, so dissolve,
 * flash, foil and sheen are per card.
 */
function cardMaterial(emissiveStrength = 1): CardMat {
  const m = makeVoxelMaterial({ fog: false, emissiveStrength }) as CardMat;
  const u = { uFoil: { value: 0 }, uSheen: { value: -9 }, uSheenCol: { value: new THREE.Color(1, 0.85, 0.5) } };
  m.foil = u;
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCardP; varying vec3 vCardX; varying vec3 vCardY;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvCardP = position; vCardX = normalize(normalMatrix * vec3(1.0, 0.0, 0.0)); vCardY = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uFoil, uSheen; uniform vec3 uSheenCol;\nvarying vec3 vCardP; varying vec3 vCardX; varying vec3 vCardY;`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 fvd = normalize(vViewPosition);
          vec2 va = vec2(dot(fvd, normalize(vCardX)), dot(fvd, normalize(vCardY)));
          vec2 cp = vCardP.xy;
          float metal = vMatx.y;
          if (uFoil > 0.001) {
            // thin-film rainbow sliding with the view angle and across the card
            float ph = va.x * 2.8 + va.y * 2.1 + cp.x * 1.7 + cp.y * 1.2;
            vec3 irid = 0.5 + 0.5 * cos(6.2831853 * (ph + vec3(0.0, 0.33, 0.67)));
            // diffraction grating + glitter that blinks as the card tilts
            float grate = 0.5 + 0.5 * sin((cp.x * 0.8 - cp.y) * 260.0 + va.x * 40.0);
            float glit = step(0.94, vhash(floor(vCardP * 170.0) + vec3(floor(ph * 5.0))));
            float fo = uFoil * (0.15 + 0.85 * metal);
            totalEmissiveRadiance += irid * (0.09 + 0.22 * grate + 1.2 * glit * metal) * fo * (0.55 + 0.45 * diffuseColor.rgb);
          }
          // the gold sheen: a hot band sweeping across the card
          float sb = cp.x * 0.75 + cp.y * 0.55 - uSheen;
          float band = exp(-sb * sb * 110.0) + 0.3 * exp(-sb * sb * 14.0);
          totalEmissiveRadiance += uSheenCol * band * (0.35 + 1.5 * metal);
        }`
      );
  };
  m.customProgramCacheKey = () => 'skill-card-foil-v1';
  return m;
}

// ------------------------------------------------------------------ the vignette window

const ART_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ART_FS = /* glsl */ `
uniform sampler2D map;
uniform float uHas, uT, uHover, uSheen, uDis, uFoil, uFlash;
uniform vec2 uSize;
varying vec2 vUv;
float ah(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  // crumbling into sand: grains drop out with a hot rim
  float g = ah(floor(vUv * vec2(60.0, 50.0)));
  if (uDis > 0.001 && g < uDis * 1.08 - 0.04) discard;
  float rim = uDis > 0.001 ? 1.0 - smoothstep(0.0, 0.08, g - uDis * 1.08 + 0.04) : 0.0;
  // the photo is graded linear light at half scale; the world's post stack tone-maps it
  vec3 c = texture2D(map, vUv).rgb * 2.0;
  // until it is developed: the frame's dark lacquer with a slow shimmer
  float sh = 0.5 + 0.5 * sin(uT * 3.0 + vUv.x * 9.0 - vUv.y * 6.0);
  vec3 wait = vec3(0.06, 0.035, 0.03) + vec3(0.05, 0.035, 0.015) * sh;
  c = mix(wait, c, uHas);
  // hover: a band of light runs over the varnish
  float band = exp(-pow((vUv.x * 0.8 + vUv.y * 0.6 - fract(uT * 0.35) * 2.6 + 0.6) * 6.0, 2.0));
  c += vec3(1.0, 0.93, 0.8) * band * 0.35 * uHover * uHas;
  // the card-wide sheen crosses the photo too
  vec2 cp = (vUv - 0.5) * uSize + vec2(0.0, 0.2);
  float sb = cp.x * 0.75 + cp.y * 0.55 - uSheen;
  c += vec3(1.0, 0.86, 0.55) * (exp(-sb * sb * 110.0) * 0.9 + 0.2 * exp(-sb * sb * 14.0));
  // a faint holographic lift at the photo's edges on foil cards
  float e = 1.0 - smoothstep(0.0, 0.1, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
  c += (0.5 + 0.5 * cos(6.2831853 * (vUv.x * 1.3 + vUv.y + uT * 0.1 + vec3(0.0, 0.33, 0.67)))) * e * 0.25 * uFoil;
  c = mix(c, vec3(1.6, 1.5, 1.3), uFlash);
  c += vec3(1.0, 0.55, 0.15) * rim * 1.4;
  gl_FragColor = vec4(c, 1.0);
}`;

// ------------------------------------------------------------------ public card

export interface SkillCard3D {
  offer: Offer;
  group: THREE.Group;
  /** invisible card-sized plane for picking */
  hit: THREE.Mesh;
  hasArt: boolean;
  setArt(t: THREE.Texture | null): void;
  update(dt: number, hover: number): void;
  /** 0..1: the card turns to sand (frame, gems, photo and plaques) */
  setDissolve(k: number): void;
  /** 0..1: white-hot */
  setFlash(k: number): void;
  /** sheen band position across the card (−0.9 … 0.9 crosses it; anything far outside hides it) */
  setSheen(x: number): void;
  /** start filling the new level pips (one by one) */
  fillPips(): void;
  /** called with the world position of each pip as it lights */
  onPip?: (at: THREE.Vector3, i: number) => void;
  /** the detail ledger (built on first open) */
  panel: DetailPanel | null;
  /** open the ledger toward a side (0 shut … 1 open, overshoot allowed) */
  setPanel(open: number, side: 1 | -1): void;
  dispose(): void;
}

export interface CardDetail {
  rows: { stat: StatId; before: number; after: number }[];
  /** current level of any upgrade (evolution partners) */
  lv: (id: string) => number;
}

export function makeSkillCard(o: Offer, rows: { stat: StatId; before: number; after: number }[], detail?: CardDetail): SkillCard3D {
  const rarity = o.def.rarity as SkillRarity;
  const frameMat = cardMaterial();
  frameMat.foil.uFoil.value = FOIL[rarity].foil;
  frameMat.foil.uSheenCol.value.setHex(FOIL[rarity].sheen);
  const gemMat = makeVoxelMaterial({ fog: false, emissiveStrength: 1.6 });
  const group = new THREE.Group();
  const frame = new THREE.Mesh(frameGeo(rarity), frameMat);
  frame.castShadow = true;
  group.add(frame);
  // a card-stock core inside the slab: any sub-pixel crack in the voxel relief shows card, not sky
  backMat ??= new THREE.MeshStandardMaterial({ color: 0xa88c62, roughness: 0.95, side: THREE.DoubleSide });
  const core = new THREE.Mesh((coreGeo ??= new THREE.PlaneGeometry(SKILL_CARD.W * VS - 0.006, SKILL_CARD.H * VS - 0.006)), backMat);
  core.position.z = -0.005;
  group.add(core);
  const owned: { dispose(): void }[] = [frameMat, gemMat];
  // the photograph in the window
  const C = SKILL_CARD;
  const wr = rect(C.win);
  const artMat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: null },
      uHas: { value: 0 },
      uT: { value: 0 },
      uHover: { value: 0 },
      uSheen: { value: -9 },
      uDis: { value: 0 },
      uFoil: { value: FOIL[rarity].foil },
      uFlash: { value: 0 },
      uSize: { value: new THREE.Vector2(wr.w, wr.h) },
    },
    vertexShader: ART_VS,
    fragmentShader: ART_FS,
  });
  const artGeo = new THREE.PlaneGeometry(wr.w, wr.h);
  const art = new THREE.Mesh(artGeo, artMat);
  art.position.set(wr.x, wr.y, VS + 0.0004);
  group.add(art);
  owned.push(artMat, artGeo);
  // typography on the plaques (front faces +Z, back plaques face −Z)
  const plaqueMats: THREE.MeshBasicMaterial[] = [];
  const plaque = (cv: HTMLCanvasElement, r: { x0: number; y0: number; x1: number; y1: number }, z: number, back = false) => {
    const q = rect(r);
    const tex = canvasTex(cv);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    const geo = new THREE.PlaneGeometry(q.w, q.h);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(q.x, q.y, z);
    if (back) m.rotation.y = Math.PI;
    m.renderOrder = 2;
    group.add(m);
    owned.push(tex, mat, geo);
    plaqueMats.push(mat);
  };
  const ft = paintCardFront(o);
  plaque(ft.crest, C.crest, 3 * VS + 0.0005);
  plaque(ft.name, C.name, 3 * VS + 0.0005);
  plaque(ft.desc, C.desc, 2 * VS + 0.0005);
  const bt = paintCardBack(o, rows);
  plaque(bt.plaque, C.back.plaque, -4 * VS - 0.0005, true);
  plaque(bt.panel, C.back.panel, -3 * VS - 0.0005, true);
  // level gems: lit up to the current level; the new ones fill (fillPips) and pulse
  const gemCol = RARITY[o.def.rarity].hex;
  const pips: { dark: THREE.Mesh | null; lit: THREE.Mesh | null; fresh: boolean; t: number }[] = [];
  const total = Math.min(5, o.def.maxLv);
  const first = Math.floor((5 - total) / 2);
  for (let i = 0; i < total; i++) {
    const [gx, gy] = C.gems[first + i];
    const at = new THREE.Vector3((gx + 0.5 - C.W / 2) * VS, (gy + 0.5 - C.H / 2) * VS, 2 * VS);
    const fresh = i >= o.fromLv && i < o.toLv;
    const old = i < o.fromLv;
    let dark: THREE.Mesh | null = null;
    let lit: THREE.Mesh | null = null;
    if (!old) {
      dark = new THREE.Mesh(gemGeo(gemCol, false), frameMat);
      dark.position.copy(at);
      group.add(dark);
    }
    if (old || fresh) {
      lit = new THREE.Mesh(gemGeo(gemCol, true), gemMat);
      lit.position.copy(at);
      lit.position.z += 0.0004;
      if (fresh) lit.scale.setScalar(0.001);
      group.add(lit);
    }
    pips.push({ dark, lit, fresh, t: -1 });
  }
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(C.W * VS, C.H * VS), new THREE.MeshBasicMaterial({ visible: false }));
  group.add(hit);
  owned.push(hit.geometry, hit.material as THREE.Material);
  // the ledger hangs on a hinge at the card's edge
  const hinge = new THREE.Group();
  hinge.position.z = -5 * VS;
  group.add(hinge);
  let t = Math.random() * 10;
  let has = 0;
  let filling = -1;
  let dis = 0;
  const tmpV = new THREE.Vector3();
  const card: SkillCard3D = {
    offer: o,
    group,
    hit,
    hasArt: false,
    panel: null,
    setArt(tex) {
      artMat.uniforms.map.value = tex;
      card.hasArt = !!tex;
    },
    update(dt, hover) {
      t += dt;
      has = card.hasArt ? Math.min(1, has + dt * 2.5) : 0;
      artMat.uniforms.uHas.value = has * has * (3 - 2 * has);
      artMat.uniforms.uT.value = t;
      artMat.uniforms.uHover.value = hover;
      // hovered: the gems kindle and breathe
      gemMat.userData.emissiveStrength.value = 1.6 + hover * (2.4 + 1.1 * Math.sin(t * 4.2));
      frameMat.userData.fx.value.z = hover * 0.6;
      // pips filling one after another
      if (filling >= 0) {
        filling += dt;
        let k = 0;
        for (let i = 0; i < pips.length; i++) {
          const p = pips[i];
          if (!p.fresh || !p.lit) continue;
          const start = k * 0.28;
          k++;
          const u = (filling - start) / 0.42;
          if (u <= 0) continue;
          if (p.t < 0) {
            p.t = 0;
            card.onPip?.(p.lit.getWorldPosition(tmpV), i);
          }
          const e = Math.min(1, u);
          // grows out of the dark socket, overshoots, settles
          const s = e < 1 ? 1.35 * Math.sin(e * Math.PI * 0.5) - 0.35 * e * e * e : 1;
          p.lit.scale.setScalar(Math.max(0.001, s));
          if (p.dark) p.dark.visible = e < 0.7;
        }
      }
      // the newest pips keep pulsing
      for (const p of pips) if (p.fresh && p.lit && p.t >= 0 && filling > 1.2) p.lit.scale.setScalar(1 + Math.max(0, Math.sin(t * 5)) * 0.22);
      card.panel?.update(dt, hover);
    },
    setDissolve(k) {
      dis = k;
      frameMat.userData.fx.value.y = k;
      gemMat.userData.fx.value.y = k;
      artMat.uniforms.uDis.value = k;
      const a = 1 - Math.min(1, k * 2.2);
      for (const m of plaqueMats) m.opacity = a;
      core.visible = k < 0.35;
      card.panel?.setDissolve(k);
    },
    setFlash(k) {
      frameMat.userData.fx.value.x = k;
      gemMat.userData.fx.value.x = k;
      artMat.uniforms.uFlash.value = k * 0.8;
    },
    setSheen(x) {
      frameMat.foil.uSheen.value = x;
      artMat.uniforms.uSheen.value = x;
    },
    fillPips() {
      if (filling < 0) filling = 0;
    },
    setPanel(open, side) {
      if (open <= 0.004 || dis > 0) {
        if (card.panel) card.panel.group.visible = false;
        return;
      }
      if (!card.panel) {
        card.panel = new DetailPanel(o, detail ?? { rows, lv: () => 0 });
        hinge.add(card.panel.group);
      }
      const P = card.panel;
      P.group.visible = true;
      hinge.position.x = side * (CARD_W / 2 + 0.006);
      P.group.position.set(side * (PANEL_W / 2 + 0.012), 0, 0);
      // folded flat behind the card when shut; swings round (via the back) to face the viewer
      const o2 = Math.max(0, open);
      hinge.rotation.y = side * (Math.PI * (1 - Math.min(1, o2)) - 0.16 * o2);
      P.group.scale.setScalar(0.94 + 0.06 * Math.min(1, o2));
    },
    dispose() {
      group.removeFromParent();
      for (const d of owned) d.dispose();
      card.panel?.dispose();
    },
  };
  return card;
}

// ------------------------------------------------------------------ the detail ledger

const PW = 70, PH = 108;
export const PANEL_W = PW * VS;
export const PANEL_H = PH * VS;
/** the parchment inset (voxels) */
const INSET = { x0: 6, y0: 6, x1: 63, y1: 101 };

type Ramp = [number, number, number, number]; // base, shade, hi, deep
const PANEL_METAL: Record<SkillRarity, Ramp> = {
  common: [0xbf8446, 0x8e5a2c, 0xe8b070, 0x4e2c12],
  uncommon: [0xbf8446, 0x8e5a2c, 0xe8b070, 0x4e2c12],
  rare: [0xc6cad6, 0x8e94a6, 0xf4f6fc, 0x4a5066],
  epic: [0xe2b44a, 0xa87a26, 0xffe08a, 0x5a3a10],
  legendary: [0xf0c450, 0xb8862a, 0xfff0a0, 0x6a4a10],
  mythic: [0xf2e2b6, 0xd2b880, 0xfffaea, 0x8e7a50],
};

/** a walnut board with a parchment inset, a beaded rarity-metal rim, corner bosses, rivets and hinge knuckles */
function panelModel(r: SkillRarity) {
  const m = new VoxelModel('skill_ledger');
  const [mb, ms, mh, md] = PANEL_METAL[r];
  const gem = RARITY[r].hex;
  const wood = (x: number, y: number) => {
    const g = noise.n2(x * 0.08, y * 0.6) * 0.5 + 0.5;
    return mixc(mixc(0x5a3a22, 0x3e2616, g), 0x6e4a2e, hash3(x, y, 3) < 0.08 ? 0.5 : 0);
  };
  const parch = (x: number, y: number) => {
    const edge = Math.min(x - INSET.x0, INSET.x1 - x, y - INSET.y0, INSET.y1 - y);
    const mott = noise.fbm2(x * 0.11, y * 0.09, 3) * 0.5 + 0.5;
    let c = mixc(0xf1e2bc, 0xdcc596, mott * 0.7);
    c = mixc(c, 0xb08a58, (1 - Math.min(1, edge / 6)) * 0.45); // foxed, darker toward the frame
    if (hash3(x, y, 11) < 0.012) c = mixc(c, 0x9a7a4a, 0.4);
    return c;
  };
  for (let y = 0; y < PH; y++)
    for (let x = 0; x < PW; x++) {
      const cx = Math.min(x, PW - 1 - x), cy = Math.min(y, PH - 1 - y);
      // rounded corners with a little wear
      const cr = 6;
      if (cx < cr && cy < cr && Math.hypot(cr - cx - 0.5, cr - cy - 0.5) > cr - 0.2 + (hash3(x, y, 5) - 0.5) * 0.9) continue;
      const edge = Math.min(cx, cy);
      m.set(x, y, -3, wood(x, y));
      m.set(x, y, -2, wood(x, y));
      if (edge <= 3) {
        // the beaded metal rim
        const along = cx < cy ? y : x;
        const bead = edge === 2 && along % 3 === 0;
        const h = edge === 0 ? 1 : edge === 1 ? 2 : bead ? 3 : 2;
        const col = edge === 0 ? ms : edge === 1 ? mh : bead ? mh : edge === 3 ? md : mb;
        for (let z = -1; z < h - 1; z++) m.set(x, y, z, z === h - 2 ? col : mixc(col, md, 0.4), VF.METAL);
      } else if (edge === 4 || edge === 5) {
        m.set(x, y, -1, edge === 4 ? 0x2a170c : mixc(0x3e2616, 0x2a170c, 0.5)); // an inked groove
      } else m.set(x, y, -1, parch(x, y), VF.SOFTAO);
    }
  // corner bosses: domed metal studs ringed with filigree beads
  const boss = (cx: number, cy: number, rr: number, h: number) => {
    for (let y = Math.floor(cy - rr - 1); y <= cy + rr + 1; y++)
      for (let x = Math.floor(cx - rr - 1); x <= cx + rr + 1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= rr) {
          const hz = Math.max(1, Math.round(h * Math.sqrt(1 - (d / rr) ** 2)));
          for (let z = 0; z < hz + 1; z++) m.set(x, y, z, z === hz ? (x < cx && y > cy ? mh : mb) : ms, VF.METAL);
        } else if (d <= rr + 1.2 && Math.round(Math.atan2(y - cy, x - cx) * 3) % 2 === 0) m.set(x, y, 1, md, VF.METAL);
      }
  };
  for (const [bx, by] of [[3.5, 3.5], [PW - 4.5, 3.5], [3.5, PH - 4.5], [PW - 4.5, PH - 4.5]]) boss(bx, by, 3.2, 3);
  // rivets along the long sides
  for (let y = 16; y < PH - 14; y += 12)
    for (const x of [1.5, PW - 2.5]) {
      m.set(Math.floor(x), y, 1, mh, VF.METAL);
      m.set(Math.floor(x) + 1, y, 1, mb, VF.METAL);
      m.set(Math.floor(x), y + 1, 1, mb, VF.METAL);
    }
  // hinge knuckles on both long edges (it can open either way): barrels with pins
  for (const x0 of [-2, PW]) {
    for (const [y0, len] of [[14, 14], [PH / 2 - 7, 14], [PH - 28, 14]] as [number, number][])
      for (let y = y0; y < y0 + len; y++)
        for (let a = 0; a < 10; a++) {
          const ang = (a / 10) * Math.PI * 2;
          const px = x0 + 0.5 + Math.cos(ang) * 1.6, pz = -1 + Math.sin(ang) * 1.6;
          const seam = (y - y0) % 7 === 0;
          m.set(px, y, pz, seam ? md : Math.sin(ang) > 0.3 ? mh : mb, VF.METAL);
        }
  }
  // a rarity cabochon on a crown mount, top centre
  const gx = PW / 2 - 0.5, gy = PH - 3.5;
  for (let y = Math.floor(gy - 3); y <= gy + 3; y++)
    for (let x = Math.floor(gx - 4); x <= gx + 4; x++) {
      const d = Math.hypot((x - gx) / 1.25, y - gy);
      if (d > 3.2) continue;
      const hz = Math.max(1, Math.round(Math.sqrt(Math.max(0, 1 - (d / 3.2) ** 2)) * 3));
      for (let z = 1; z <= hz + 1; z++) {
        const top = z === hz + 1;
        const c = top && x <= gx && y >= gy ? mixc(gem, 0xffffff, 0.5) : mixc(gem, 0x000000, top ? 0 : 0.3);
        m.set(x, y, z, c, VF.EMISSIVE);
      }
    }
  return m;
}

function panelGeo(r: SkillRarity) {
  let g = panels.get(r);
  if (!g) {
    g = buildVoxelGeometry(panelModel(r), { voxelSize: VS, pivot: [PW / 2, PH / 2, 0] });
    panels.set(r, g);
  }
  return g;
}

// ----- typography (Alagard is the only thing drawn in 2D)

const INK = '#2a170c';
const INK_SOFT = '#6a4626';
const UP = '#2c6410';
const DOWN = '#8e1e10';
const TAGC = '#18566a';
/** rarity names in an ink that reads on parchment */
const RAR_INK: Record<string, string> = { common: '#5e4a2c', uncommon: '#3a6418', rare: '#17607a', epic: '#8e2c12', legendary: '#8a5e00', mythic: '#7a5410' };
const CAT_LABEL: Record<string, string> = { gun: 'IRON', insect: 'BROOD', passive: 'GRIT', gear: 'GEAR', relic: 'RELIC', evolution: 'EVOLUTION' };
/** stats where smaller is better */
const LOWER_BETTER = new Set<string>(['spread']);

/** a short line of flavour for upgrades that carry no lore of their own */
const FLAVOUR: Record<string, string> = {
  venom: 'What the scorpion starts, the desert finishes.',
  gun: 'Six chances to be right. Usually takes one.',
  gunstorm: 'Thunder has a sound. So does an empty cylinder.',
  rounds: 'A man is only as good as his last bullet. Carry more.',
  bottles: 'Every bottle on the fence is a lesson in angles.',
  horus: 'The falcon sees the twitch before the draw.',
  brood: 'Mother of a thousand stingers, all of them hungry.',
  pinch: 'Small claws. Big opinions.',
  swarm: 'A plague, but a loyal one.',
  fire: 'The sand remembers every fire you start.',
  dung: 'Khepri rolls the sun. You roll the rest.',
  dungcrown: 'A crown is a crown, whatever it is made of.',
  sunroller: 'Dawn, delivered at speed.',
  scarab: 'Armour that clicks its approval.',
  ribs: 'Hard to break a man with nothing left inside.',
  oasis: 'Water in the dunes, and a heart that keeps beating.',
  serket: 'Her blessing burns cold and green.',
  tumbleweed: 'Go where the wind goes. Faster.',
  coins: 'Luck is just gold that has not landed yet.',
  blood: 'Every wound you open pays you back.',
  board: 'The dunes are a wave if you are brave enough.',
  star: 'The badge still shines. The sheriff does not.',
  dynamite: 'Fuse, spark, sermon.',
  ra: 'Noon, any time you want it.',
  anubis: 'He weighs every kill. You come out ahead.',
  thoth: 'Every bounty is written down. Twice.',
  sekhmet: 'The lioness never puts a fire out.',
  moon: 'Hang in the air long enough and the moon notices.',
  bastet: 'A purr is just a growl with manners.',
};

const TAG_RULES: [RegExp, string][] = [
  [/poison|venom|sting/i, 'POISON'],
  [/crit|headshot|deadeye|weak point/i, 'CRIT'],
  [/board|drift|boost|airborne|trick|m\/s|mobility|big air/i, 'BOARD'],
  [/pinch|scorpion|brood/i, 'PINCH'],
  [/burn|fire|ignite|flame|searing|aflame/i, 'FIRE'],
  [/locust|swarm|insect/i, 'SWARM'],
  [/explo|blast|dynamite|bomb|nova|slug/i, 'BLAST'],
  [/lightning|bolt|stun|storm|jolt/i, 'SHOCK'],
  [/reload|ammo|cylinder|rounds|chamber|fire rate|bullet|pierce|bounce/i, 'GUN'],
  [/heal|lifesteal|vitality|health|shield/i, 'SUSTAIN'],
  [/armou?r|defense|resist|block/i, 'GUARD'],
  [/gold|coin|bounty|luck/i, 'LOOT'],
  [/slows? (the world|time)|bullet time/i, 'TIME'],
  [/counter|melee|whip|kick|slam/i, 'MELEE'],
];

/** synergy keywords for a card (at most five) */
export function synergyTags(def: UpgradeDef, lv: number) {
  const text = `${def.name} ${def.desc(Math.max(1, lv))} ${def.id}`;
  const out: string[] = [];
  for (const [re, tag] of TAG_RULES) if (re.test(text) && !out.includes(tag)) out.push(tag);
  if (def.learn) out.unshift('SKILL');
  if (def.god && out.length < 5) out.push(def.god.toUpperCase());
  return out.slice(0, 5);
}

function wrap(c: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? line + ' ' + w : w;
    if (line && c.measureText(t).width > maxW) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

const font = (px: number) => `${Math.round(px)}px Alagard`;

/** engraved ink: a pale lip under the stroke, then the ink */
function engrave(c: CanvasRenderingContext2D, text: string, x: number, y: number, color = INK, lip = 0.5) {
  c.fillStyle = `rgba(255,246,222,${lip})`;
  c.fillText(text, x, y + Math.max(1, TEXT_PPV * 0.14));
  c.fillStyle = color;
  c.fillText(text, x, y);
}

/** the evolution line: what this becomes (with whom), or what it was born of */
function evolutionText(def: UpgradeDef, lv: (id: string) => number) {
  if (def.evolveFrom) return `Born of ${def.evolveFrom.map((id) => UPGRADE_BY_ID[id]?.name ?? id).join(' + ')}.`;
  for (const e of UPGRADES) {
    if (!e.evolveFrom || !e.evolveFrom.includes(def.id)) continue;
    const pid = e.evolveFrom[0] === def.id ? e.evolveFrom[1] : e.evolveFrom[0];
    const partner = UPGRADE_BY_ID[pid];
    if (!partner) continue;
    const need = Math.min(def.maxLv, 3);
    const needP = Math.min(partner.maxLv, 3);
    const have = lv(pid);
    return `At Lv ${need}, with ${partner.name} at Lv ${needP} (you: ${have ? 'Lv ' + have : 'none'}), evolves into ${e.name}.`;
  }
  return '';
}

interface Op {
  h: number;
  draw: (y: number) => void;
}

/** lay out the ledger; returns the canvas and where the pip row sits (fraction of height from the top) */
function paintDetail(o: Offer, d: CardDetail) {
  const cv = document.createElement('canvas');
  cv.width = (INSET.x1 - INSET.x0 + 1) * TEXT_PPV;
  cv.height = (INSET.y1 - INSET.y0 + 1) * TEXT_PPV;
  const c = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  const def = o.def;
  const rar = RARITY[def.rarity];
  let pipY = 0;
  const build = (s: number) => {
    const ops: Op[] = [];
    const gap = (h: number) => ops.push({ h: h * s, draw: () => {} });
    const centre = (text: string, px: number, color = INK, fitW = W * 0.92) => {
      c.font = font(px * s);
      const w = c.measureText(text).width;
      const p2 = w > fitW ? (px * s * fitW) / w : px * s;
      ops.push({
        h: p2 * 1.18,
        draw: (y) => {
          c.font = font(p2);
          c.textAlign = 'center';
          engrave(c, text, W / 2, y + p2 * 0.86, color);
        },
      });
    };
    const label = (text: string) => {
      const px = 24 * s;
      ops.push({
        h: px * 1.35,
        draw: (y) => {
          c.font = font(px);
          c.textAlign = 'center';
          const sp = text.split('').join(String.fromCharCode(8202));
          engrave(c, `- ${sp} -`, W / 2, y + px, INK_SOFT, 0.35);
        },
      });
    };
    const para = (text: string, px: number, color = INK, quote = false) => {
      c.font = font(px * s);
      const ls = wrap(c, quote ? `"${text}"` : text, W * 0.88);
      const lh = px * s * 1.16;
      ops.push({
        h: ls.length * lh,
        draw: (y) => {
          c.font = font(px * s);
          c.textAlign = 'center';
          ls.forEach((l, i) => engrave(c, l, W / 2, y + px * s * 0.86 + i * lh, color, quote ? 0.3 : 0.5));
        },
      });
    };
    // header: rarity · category · god
    if (def.learn) centre(`NEW SKILL  ·  KEY [${def.learn}]${def.god ? '  ·  ' + def.god.toUpperCase() : ''}`, 32, '#16664a');
    else centre(`${rar.name.toUpperCase()}  ·  ${CAT_LABEL[def.cat] ?? ''}${def.god ? '  ·  ' + def.god.toUpperCase() : ''}`, 30, RAR_INK[def.rarity] ?? INK);
    gap(4);
    centre(def.name.toUpperCase(), 54, INK);
    // levels: a line, then a row of real gems (3D, placed by the panel)
    const lvText = def.learn ? 'A TAROT SKILL  ·  YOURS FOR GOOD' : def.cat === 'evolution' ? 'EVOLUTION  ·  ONE OF A KIND' : def.maxLv === 1 ? 'SINGLE LEVEL' : o.fromLv === 0 ? `NEW  ·  LEVEL 1 OF ${def.maxLv}` : `LEVEL ${o.fromLv} → ${o.toLv}  OF ${def.maxLv}`;
    centre(lvText, 30, INK_SOFT);
    ops.push({ h: 66 * s, draw: (y) => (pipY = (y + 36 * s) / H) });
    // the stat changes, current → new, coloured by whether it helps
    if (d.rows.length) {
      label('CHANGES');
      for (const r of d.rows) {
        const nm = (DERIVED_INFO as any)[r.stat]?.name ?? (CORE_INFO as any)[r.stat]?.name ?? r.stat;
        const fmt = (DERIVED_INFO as any)[r.stat]?.fmt ?? 'int';
        const delta = r.after - r.before;
        const good = LOWER_BETTER.has(r.stat) ? delta < 0 : delta > 0;
        const sign = delta >= 0 ? '+' : '−';
        const pc =
          fmt === 'pct'
            ? `${sign}${Math.abs(delta * 100).toFixed(1)}%`
            : Math.abs(r.before) > 1e-6
              ? `${sign}${Math.abs(Math.round((delta / Math.abs(r.before)) * 100))}%`
              : `${sign}${fmtStat(r.stat, Math.abs(delta))}`;
        const vals = `${fmtStat(r.stat, r.before)} → ${fmtStat(r.stat, r.after)}`;
        let px = 31 * s;
        c.font = font(px);
        const need = c.measureText(`${nm}  ${vals}  (${pc})`).width;
        if (need > W * 0.9) px *= (W * 0.9) / need;
        ops.push({
          h: px * 1.3,
          draw: (y) => {
            c.font = font(px);
            const by = y + px * 0.9;
            c.textAlign = 'left';
            engrave(c, nm, W * 0.05, by);
            c.textAlign = 'right';
            const pw = c.measureText(` (${pc})`).width;
            engrave(c, ` (${pc})`, W * 0.95, by, Math.abs(delta) < 1e-9 ? INK_SOFT : good ? UP : DOWN);
            engrave(c, vals, W * 0.95 - pw, by, INK);
          },
        });
      }
    } else {
      label(o.fromLv > 0 ? 'NOW' : 'EFFECT');
      para(o.fromLv > 0 ? def.desc(o.fromLv) : def.desc(o.toLv), 28, INK);
    }
    gap(6);
    // what the next level would add
    label('NEXT LEVEL');
    if (o.toLv < def.maxLv) para(`Lv ${o.toLv + 1}: ${def.desc(o.toLv + 1)}`, 27, INK);
    else para(def.maxLv > 1 ? 'Fully honed: this takes it to the top.' : 'Nothing more to learn: it is whole.', 27, INK_SOFT);
    // evolution path
    const evo = evolutionText(def, d.lv);
    if (evo) {
      gap(6);
      label('EVOLUTION');
      para(evo, 27, def.evolveFrom ? RAR_INK.mythic : RAR_INK.epic);
    }
    // synergies
    const tags = synergyTags(def, o.toLv);
    if (tags.length) {
      gap(6);
      label('SYNERGY');
      centre(tags.join('  ·  '), 30, TAGC);
    }
    // flavour
    const fl = def.lore ?? FLAVOUR[skillFamily(def)] ?? '';
    if (fl) {
      gap(10);
      para(fl, 26, INK_SOFT, true);
    }
    return ops;
  };
  // as large as the parchment allows
  let s = 1.32;
  let ops = build(s);
  const room = H * 0.94;
  for (let i = 0; i < 14 && ops.reduce((a, b) => a + b.h, 0) > room; i++) {
    s *= 0.94;
    ops = build(s);
  }
  const total = ops.reduce((a, b) => a + b.h, 0);
  let y = (H - total) / 2;
  c.textBaseline = 'alphabetic';
  for (const op of ops) {
    op.draw(y);
    y += op.h;
  }
  return { cv, pipY };
}

/** the ledger: a sculpted board carrying the full typeset details and a row of real level gems */
export class DetailPanel {
  group = new THREE.Group();
  /** invisible plane for picking (hover stays while the pointer reads the ledger) */
  hit: THREE.Mesh;
  private mat: VoxelMaterial;
  private gemMat: VoxelMaterial;
  private textMat: THREE.MeshBasicMaterial;
  private owned: { dispose(): void }[] = [];
  private fresh: THREE.Mesh[] = [];
  private t = 0;

  constructor(o: Offer, d: CardDetail) {
    const rarity = o.def.rarity as SkillRarity;
    this.mat = makeVoxelMaterial({ fog: false });
    this.gemMat = makeVoxelMaterial({ fog: false, emissiveStrength: 1.8 });
    const body = new THREE.Mesh(panelGeo(rarity), this.mat);
    body.castShadow = true;
    this.group.add(body);
    const { cv, pipY } = paintDetail(o, d);
    const tex = canvasTex(cv);
    this.textMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    const iw = (INSET.x1 - INSET.x0 + 1) * VS, ih = (INSET.y1 - INSET.y0 + 1) * VS;
    const geo = new THREE.PlaneGeometry(iw, ih);
    const txt = new THREE.Mesh(geo, this.textMat);
    const ix = ((INSET.x0 + INSET.x1 + 1) / 2 - PW / 2) * VS, iy = ((INSET.y0 + INSET.y1 + 1) / 2 - PH / 2) * VS;
    txt.position.set(ix, iy, 0.0006);
    txt.renderOrder = 2;
    this.group.add(txt);
    this.owned.push(this.mat, this.gemMat, this.textMat, tex, geo);
    this.hit = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), new THREE.MeshBasicMaterial({ visible: false }));
    this.group.add(this.hit);
    this.owned.push(this.hit.geometry, this.hit.material as THREE.Material);
    // the level pips as real cut gems, set into the parchment under the level line
    const n = Math.min(8, o.def.maxLv);
    const col = RARITY[o.def.rarity].hex;
    const gy = iy + ih / 2 - pipY * ih;
    const step = 0.06;
    for (let i = 0; i < n; i++) {
      const lit = i < o.toLv;
      const g = new THREE.Mesh(gemGeo(col, lit), lit ? this.gemMat : this.mat);
      g.position.set(ix + (i - (n - 1) / 2) * step, gy, 0.0);
      g.scale.setScalar(1.15);
      this.group.add(g);
      if (i >= o.fromLv && i < o.toLv) this.fresh.push(g);
    }
  }

  update(dt: number, hover: number) {
    this.t += dt;
    this.gemMat.userData.emissiveStrength.value = 1.8 + hover * 1.6;
    for (const g of this.fresh) g.scale.setScalar(1.15 * (1 + Math.max(0, Math.sin(this.t * 5)) * 0.2));
  }

  setDissolve(k: number) {
    this.mat.userData.fx.value.y = k;
    this.gemMat.userData.fx.value.y = k;
    this.textMat.opacity = 1 - Math.min(1, k * 2.2);
  }

  dispose() {
    this.group.removeFromParent();
    for (const d of this.owned) d.dispose();
  }
}
