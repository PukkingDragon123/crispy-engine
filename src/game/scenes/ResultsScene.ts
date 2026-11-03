// End of a run: a lamplit table in the hideout. On it, a miniature voxel
// diorama of the region you rode through (zones you never reached under dust
// sheets), your trail pinned in red string, a skull where you fell. Shot to
// the wall above it, your WANTED poster fills in line by line and gets stamped.
// The poster's portrait is Sundown photographed from his own 3D rig
// (IconFactory, sepia print); the paper, the bullet holes and the rubber stamp
// are shaded on the lit sheet; only the typography is drawn into a canvas.
import * as THREE from 'three';
import type { Engine, GameScene } from '../../engine/Engine';
import type { RunState } from '../Ctx';
import type { SubArea } from '../world/RegionGen';
import { MAT } from '../world/Heightfield';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { TOON, bevelBox } from '../models/style';
import { modelEntry } from '../models/lookup';
import { loadSave } from '../meta/Save';
import { IconFactory } from '../ui/IconFactory';
import { PARCHMENT_GLSL } from '../ui/Choice';
import { Ease } from '../../engine/Tween';
import { nav } from '../Nav';

export interface RunResult {
  run: RunState;
  won: boolean;
  sa: SubArea;
  reached: number; // highest zone index unlocked
  trail: { x: number; z: number }[];
  deathAt: { x: number; z: number } | null;
  bosses: string[];
  heightAt(x: number, z: number): number;
  banked?: number;
  /** the rig the player rode with (for the poster portrait); falls back to the saved look */
  hero?: RigSpec | null;
}

const N = 88; // diorama columns per side
const VS = 0.024; // diorama voxel size (m)

function shade(c: number, f: number) {
  const r = Math.min(255, ((c >> 16) & 255) * f), g = Math.min(255, ((c >> 8) & 255) * f), b = Math.min(255, (c & 255) * f);
  return ((r << 16) | (g << 8) | b) >>> 0;
}

function buildDiorama(res: RunResult) {
  const m = new VoxelModel('diorama');
  const sa = res.sa;
  const S = sa.field.size;
  const hs: number[] = [];
  let hmin = Infinity, hmax = -Infinity;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      // box-filtered height: a smooth, readable miniature instead of spiky pillars
      let h = 0;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) h += res.heightAt(((i + 0.17 + a * 0.33) / N) * S, ((j + 0.17 + b * 0.33) / N) * S);
      h /= 9;
      hs.push(h);
      hmin = Math.min(hmin, h);
      hmax = Math.max(hmax, h);
    }
  {
    const src = hs.slice();
    for (let j = 1; j < N - 1; j++)
      for (let i = 1; i < N - 1; i++) {
        let acc = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) acc += src[(j + dj) * N + i + di];
        hs[j * N + i] = acc / 9;
      }
  }
  const levels = 9;
  const zoneOf = (x: number, z: number) => {
    let best = -1, bd = Infinity;
    for (const zn of sa.zones) {
      const d = Math.hypot(zn.cx - x, zn.cz - z) - zn.r;
      if (d < bd) {
        bd = d;
        best = zn.index;
      }
    }
    return bd < 12 ? best : -1;
  };
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const wx = ((i + 0.5) / N) * S, wz = ((j + 0.5) / N) * S;
      const h = hs[j * N + i];
      const lv = 2 + Math.round(((h - hmin) / Math.max(1, hmax - hmin)) * levels);
      const mat = sa.field.matAt(wx, wz);
      const water = h <= sa.waterLevel + 0.05;
      const zi = zoneOf(wx, wz);
      const fogged = zi > res.reached || zi < 0;
      let top: number = TOON.sand.base;
      if (water) top = 0x3a8ab0;
      else if (mat === MAT.ROCK || mat === MAT.DARK_ROCK) top = TOON.sandstone.shade;
      else if (mat === MAT.RED_SAND) top = 0xd98a52;
      else if (mat === MAT.TILE) top = TOON.stone.base;
      else if (mat === MAT.GRASS) top = TOON.cactus.base;
      else if (mat === MAT.DIRT || mat === MAT.MUD) top = TOON.wood.hi;
      else if (mat === MAT.SAND_DARK) top = TOON.sand.shade;
      // contour bands every 3 levels + brighter crests
      if (lv % 3 === 0) top = shade(top, 0.93);
      if (fogged) top = shade(0xb8a890, 0.85 + (lv % 2) * 0.05);
      for (let y = 0; y <= lv; y++) {
        const c = y === lv ? top : y < 2 ? TOON.wood.shade : fogged ? 0x9a8a72 : shade(TOON.sandstone.base, 0.8 + (y / lv) * 0.2);
        m.set(i, y, j, c);
      }
    }
  // base plinth edge (wooden frame)
  for (let i = -1; i <= N; i++)
    for (const [x, z] of [[i, -1], [i, N], [-1, i], [N, i]]) {
      for (let y = 0; y <= 3; y++) m.set(x, y, z, y === 3 ? TOON.wood.hi : TOON.wood.base);
    }
  const toCell = (x: number, z: number) => [Math.floor((x / S) * N), Math.floor((z / S) * N)] as const;
  const topY = (i: number, j: number) => {
    let y = 30;
    while (y > 0 && !m.has(i, y, j)) y--;
    return y;
  };
  // the trail: red string pinned every few samples
  let last: readonly [number, number] | null = null;
  res.trail.forEach((p, k) => {
    const c = toCell(p.x, p.z);
    if (c[0] < 0 || c[1] < 0 || c[0] >= N || c[1] >= N) return;
    if (last) {
      const steps = Math.max(Math.abs(c[0] - last[0]), Math.abs(c[1] - last[1]));
      for (let s = 0; s <= steps; s++) {
        const ii = Math.round(last[0] + ((c[0] - last[0]) * s) / Math.max(1, steps)), jj = Math.round(last[1] + ((c[1] - last[1]) * s) / Math.max(1, steps));
        m.set(ii, topY(ii, jj) + 1, jj, TOON.red.base);
      }
    }
    if (k % 6 === 0) {
      const y = topY(c[0], c[1]);
      m.set(c[0], y + 1, c[1], TOON.red.base).set(c[0], y + 2, c[1], TOON.iron.hi).set(c[0], y + 3, c[1], TOON.red.hi);
    }
    last = c;
  });
  // landmarks: little wooden buildings; start: a flag
  for (const zn of sa.zones) {
    if (zn.index > res.reached) continue;
    for (const a of zn.anchors) {
      if (a.kind !== 'landmark') continue;
      const [i, j] = toCell(a.x, a.z);
      const y = topY(i, j) + 1;
      bevelBox(m, i - 1, y, j - 1, i + 1, y + 2, j + 1, TOON.wood.base, 0);
      m.box(i - 1, y + 3, j - 1, i + 1, y + 3, j + 1, TOON.red.shade);
    }
  }
  const st = toCell(sa.start.x, sa.start.z);
  {
    const y = topY(st[0], st[1]) + 1;
    m.box(st[0], y, st[1], st[0], y + 6, st[1], TOON.wood.dark);
    m.box(st[0] + 1, y + 4, st[1], st[0] + 3, y + 6, st[1], TOON.serket.base);
  }
  if (res.deathAt) {
    const [i, j] = toCell(res.deathAt.x, res.deathAt.z);
    const y = topY(i, j) + 1;
    // tiny skull
    bevelBox(m, i - 1, y + 1, j - 1, i + 1, y + 3, j + 1, TOON.bone.hi, 0);
    m.set(i - 1, y + 2, j + 2, TOON.socket.dark).set(i + 1, y + 2, j + 2, TOON.socket.dark);
    m.box(i - 1, y, j - 1, i + 1, y, j + 1, TOON.bone.base);
  }
  return m;
}

function tableModel() {
  const m = new VoxelModel('table');
  const W = 60, D = 46;
  for (let x = -W; x <= W; x++)
    for (let z = -D; z <= D; z++) {
      const plank = Math.floor((z + 100) / 8);
      const seam = (z + 100) % 8 === 0;
      const c = seam ? TOON.wood.dark : plank % 2 ? TOON.wood.base : TOON.wood.shade;
      m.set(x, 0, z, c).set(x, -1, z, TOON.wood.shade);
    }
  for (const [x, z] of [[-W + 3, -D + 3], [W - 3, -D + 3], [-W + 3, D - 3], [W - 3, D - 3]]) m.box(x - 2, -36, z - 2, x + 2, -2, z + 2, TOON.wood.shade);
  return m;
}

const PW = 1.08, PH = 1.56; // poster sheet (m)
const CW = 720, CH = 1040; // ink canvas (px)
const INK = '#2a1a10';
const STAMP_Y = 905; // stamp centre on the ink canvas (px)

/** the player's own Sundown rig (passed in by the run, else the saved look) */
function heroSpec(res: RunResult): RigSpec | null {
  if (res.hero?.parts) return res.hero;
  try {
    const look = loadSave().look;
    for (const k of [`cowboy_${look.hat}_${look.outfit}`, 'cowboy_stetson_punk']) {
      const s = modelEntry(k)?.() as RigSpec | undefined;
      if (s?.parts) return s;
    }
  } catch {
    /* no portrait */
  }
  return null;
}

/** Sundown photographed from his own 3D rig (IconFactory), printed in sepia */
function capturePortrait(renderer: THREE.WebGLRenderer, res: RunResult): HTMLCanvasElement | null {
  const spec = heroSpec(res);
  if (!spec) return null;
  const mat = makeVoxelMaterial({ fog: false });
  const f = new IconFactory(renderer);
  try {
    const r = new RigInstance(buildRigGeo(spec, spec.name + ':poster'), { material: mat, castShadow: false });
    // a waist-up mugshot: the legs stay out of frame
    for (const p of ['thigh_l', 'thigh_r', 'shin_l', 'shin_r']) r.setPartVisible(p, false);
    r.setExpression(res.won ? 'smug' : 'determined');
    const n = r.nodes;
    if (n['jaw']) n['jaw'].rotation.x = r.exprJaw;
    n['brow_l']?.rotation.set(0, 0, r.exprBrow[0]);
    n['brow_r']?.rotation.set(0, 0, r.exprBrow[1]);
    n['arm_r']?.rotation.set(-0.5, 0, -0.35);
    n['fore_r']?.rotation.set(-1.3, 0, 0);
    n['head']?.rotation.set(0.06, 0.22, 0);
    r.root.updateMatrixWorld(true);
    const shot = f.capture(r.root, { w: 120, h: 112, ss: 4, yaw: 0.42, pitch: 0.1, fill: 0.96, dy: 0.02, light: 'sunset', levels: 12, ink: '#2a160a', rim: '#ffe2a8' });
    const c = shot.getContext('2d')!;
    const id = c.getImageData(0, 0, shot.width, shot.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
      const k = Math.min(1, Math.max(0, (l - 0.04) * 1.12));
      d[i] = Math.min(255, 66 + k * 180);
      d[i + 1] = Math.min(255, 38 + k * 152);
      d[i + 2] = Math.min(255, 20 + k * 104);
    }
    c.putImageData(id, 0, 0);
    return shot;
  } catch (e) {
    console.warn('[results] portrait capture failed', e);
    return null;
  } finally {
    f.dispose();
    mat.dispose();
  }
}

/**
 * The poster's ink: typography (Alagard) and the photographed portrait, on a
 * transparent canvas. The paper, the stamp and the bullet holes are the shader.
 */
export function paintPoster(res: RunResult, lines: number, portrait: HTMLCanvasElement | null, cv = document.createElement('canvas')) {
  const W = CW, H = CH;
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, W, H);
  c.imageSmoothingEnabled = false;
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.fillStyle = INK;
  c.font = '96px Alagard';
  c.fillText('WANTED', W / 2, 40);
  c.font = '32px Alagard';
  c.fillText(res.won ? '- A LEGEND OF THE DUNES -' : '- DEAD OR ALIVE -', W / 2, 146);
  if (portrait) {
    const pw = portrait.width * 3, ph = portrait.height * 3;
    c.globalAlpha = 0.94;
    c.drawImage(portrait, Math.round(W / 2 - pw / 2), 188, pw, ph);
    c.globalAlpha = 1;
  }
  c.fillStyle = INK;
  c.font = '64px Alagard';
  c.fillText('SUNDOWN', W / 2, 532);
  const r = res.run;
  const mm = Math.floor(r.time / 60), ss = Math.floor(r.time % 60);
  const rows: [string, string][] = [
    ['Waves survived', String(Math.max(0, r.wave - (res.won ? 0 : 1)))],
    ['Outlaws laid low', String(r.kills)],
    ['Bounty earned', `$${Math.round(r.totalBounty)}`],
    ['Gold collected', String(Math.round(r.totalGold))],
    ['Bounty rank', String(r.rank)],
    ['Time in the saddle', `${mm}:${String(ss).padStart(2, '0')}`],
    ['Bosses', res.bosses.length ? res.bosses.join(', ') : '-'],
  ];
  const x0 = 64, x1 = W - 64;
  rows.slice(0, lines).forEach(([k, v], i) => {
    const y = 616 + i * 42;
    c.font = '32px Alagard';
    c.textAlign = 'left';
    c.fillStyle = '#4a2a14';
    c.fillText(k, x0, y);
    const kw = c.measureText(k).width;
    // long values (boss lists) step down a size rather than run off the sheet
    let small = false;
    let vw = c.measureText(v).width;
    if (vw > x1 - x0 - kw - 40) {
      small = true;
      c.font = '16px Alagard';
      vw = c.measureText(v).width;
    }
    c.textAlign = 'right';
    c.fillStyle = INK;
    c.fillText(v, x1, y + (small ? 10 : 0));
    // dot leaders, set in type
    c.font = '32px Alagard';
    c.textAlign = 'left';
    c.fillStyle = 'rgba(42,26,16,0.55)';
    const dot = c.measureText('. ').width;
    const n = Math.floor((x1 - vw - 14 - (x0 + kw + 14)) / dot);
    if (n > 0) c.fillText('. '.repeat(n), x0 + kw + 14, y);
  });
  return cv;
}

/** the stamp's word (white; the shader inks, frames and presses it) */
function paintStampWord(word: string) {
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = '80px Alagard';
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(m.measureText(word).width) + 60;
  cv.height = 112;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.font = '80px Alagard';
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(word, cv.width / 2, cv.height / 2 + 4);
  return cv;
}

function inkTexture(cv: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** paper (shader) + ink map on a lit standard material, so the lamp and shadows still play on it */
const POSTER_PAPER = /* glsl */ `
{
  vec2 pUv = vMapUv;
  float pEdge = paperEdge(pUv, uAspect);
  float pTear = paperTear(pUv, 0.02);
  if (pEdge < pTear) discard;
  vec3 pCol = parchment(pUv, uAspect, pEdge, pTear);
  if (bulletHole(pUv, uAspect, vec2(0.045, 0.972), 0.03, pCol) < 0.5) discard;
  if (bulletHole(pUv, uAspect, vec2(0.955, 0.972), 0.03, pCol) < 0.5) discard;
  // it was folded in four in somebody's saddlebag
  float fold = exp(-pow((pUv.y - 0.52) * 150.0, 2.0)) + 0.7 * exp(-pow((pUv.x - 0.5) * uAspect * 150.0, 2.0));
  pCol *= 1.0 - 0.07 * fold;
  vec3 pLin = pow(pCol, vec3(2.2));
  vec4 pInk = texture2D(map, pUv);
  float pPress = 0.8 + 0.2 * smoothstep(0.2, 0.6, pNoise(pUv * vec2(uAspect, 1.0) * 260.0));
  pLin = mix(pLin, pInk.rgb * mix(vec3(1.0), pLin * 1.1, 0.2), pInk.a * pPress);
  if (uStamp > 0.001) {
    float st = rubberStamp(pUv, uAspect, uStampRect, uStampAng, uStampMap);
    pLin = mix(pLin, uStampCol * mix(vec3(1.0), pLin, 0.25), st * 0.85 * uStamp);
  }
  diffuseColor.rgb *= pLin;
}
`;

/** a sheet shot to the wall at its two top corners: it bows a little and the bottom corners curl out */
function posterGeometry() {
  const g = new THREE.PlaneGeometry(PW, PH, 14, 20);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const xn = pos.getX(i) / (PW / 2), yn = pos.getY(i) / (PH / 2);
    const low = Math.pow((1 - yn) / 2, 2.2);
    const sag = Math.sin(((yn + 1) / 2) * Math.PI) * 0.01;
    pos.setZ(i, sag * (1 - xn * xn) + 0.05 * low * xn * xn * xn * xn + 0.006 * Math.sin(xn * 3.1 + yn * 2.3));
  }
  g.computeVertexNormals();
  return g;
}

export class ResultsScene implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
  private poster!: THREE.Mesh;
  private inkCanvas = document.createElement('canvas');
  private ink: THREE.CanvasTexture | null = null;
  private stampTex: THREE.CanvasTexture | null = null;
  private portrait: HTMLCanvasElement | null = null;
  private paperU = {
    uSeed: { value: Math.random() },
    uAspect: { value: PW / PH },
    uStamp: { value: 0 },
    uStampAng: { value: 0.16 },
    uStampRect: { value: new THREE.Vector4(0.5, 1 - STAMP_Y / CH, 0.12, 0.05) },
    uStampCol: { value: new THREE.Color('#b02a1a') },
    uStampMap: { value: null as THREE.Texture | null },
  };
  private lines = 0;
  private t = 0;
  private ui: HTMLDivElement;
  private diorama = new THREE.Group();

  constructor(private engine: Engine, private res: RunResult, private onAgain: () => void) {
    this.ui = document.createElement('div');
  }

  async enter() {
    const s = this.scene;
    const eng = this.engine;
    s.background = new THREE.Color(0x140c08);
    s.fog = new THREE.Fog(0x140c08, 6, 18);
    s.add(new THREE.HemisphereLight(0xffd8a8, 0x2a1a10, 0.7));
    const lamp = new THREE.PointLight(0xffb060, 30, 9, 1.6);
    lamp.position.set(-0.6, 2.1, 0.8);
    lamp.castShadow = true;
    s.add(lamp);
    const key = new THREE.DirectionalLight(0xffe2b8, 1.4);
    key.position.set(2, 4, 3);
    key.castShadow = true;
    s.add(key);
    const mat = makeVoxelMaterial();
    const table = new THREE.Mesh(buildVoxelGeometry(tableModel(), { voxelSize: 0.04, pivot: [0.5, 1, 0.5] }), mat);
    table.receiveShadow = true;
    s.add(table);
    const geo = buildVoxelGeometry(buildDiorama(this.res), { voxelSize: VS, pivot: [N / 2, 0, N / 2] });
    const dio = new THREE.Mesh(geo, mat);
    dio.castShadow = true;
    dio.receiveShadow = true;
    this.diorama.add(dio);
    this.diorama.position.set(0, 0.01, 0.15);
    s.add(this.diorama);
    // the wall + pinned poster
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 1 }));
    wall.position.set(0, 2, -2.2);
    s.add(wall);
    this.poster = this.buildPoster();
    this.poster.position.set(0, 1.55, -2.15);
    this.poster.rotation.z = 0.03;
    s.add(this.poster);
    this.camera.aspect = eng.width / eng.height;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(0.6, 0.9, 2.2);
    this.camera.lookAt(0, 0.1, 0.1);
    (window as any).__music?.setMood(this.res.won ? 'victory' : 'tension');
    // UI buttons
    this.ui.style.cssText = "position:absolute;left:50%;bottom:6vh;transform:translateX(-50%);display:flex;gap:18px;z-index:8;opacity:0;transition:opacity .6s";
    const btn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = "font-family:'Alagard';font-size:24px;padding:10px 22px;background:#7a4a28;color:#fff3d6;border:4px solid #2a1408;box-shadow:0 5px 0 #2a1408;cursor:pointer;letter-spacing:1px;pointer-events:auto";
      b.onmouseenter = () => {
        b.style.background = '#9a5a30';
        eng.audio.play('ui_hover', { volume: 0.5 });
      };
      b.onmouseleave = () => (b.style.background = '#7a4a28');
      b.onclick = () => {
        eng.audio.play('ui_click', { volume: 0.7 });
        fn();
      };
      this.ui.appendChild(b);
    };
    btn('RIDE AGAIN', () => this.onAgain());
    btn('HIDEOUT', () => nav.hub());
    if (this.res.banked) {
      const b = document.createElement('div');
      b.style.cssText = "font-family:'Alagard';font-size:20px;color:#ffd36b;text-shadow:0 3px 0 #2a1408;align-self:center";
      b.textContent = `+${this.res.banked} gold banked`;
      this.ui.appendChild(b);
    }
    eng.overlay.appendChild(this.ui);
    eng.input.setWantLock(false);
    // poster fills in line by line
    void (async () => {
      await eng.tweens.wait(2.2, true);
      for (let i = 1; i <= 8; i++) {
        this.lines = i;
        if (i <= 7) {
          paintPoster(this.res, i, this.portrait, this.inkCanvas);
          if (this.ink) this.ink.needsUpdate = true;
        } else this.paperU.uStamp.value = 1; // the rubber stamp slams down
        eng.audio.play(i === 8 ? 'poster_slam' : 'page_turn', { volume: i === 8 ? 1 : 0.4 });
        if (i === 8) eng.tweens.run(0.25, (k) => (this.poster.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.06)), Ease.outQuad, { real: true });
        await eng.tweens.wait(i === 7 ? 0.7 : 0.32, true);
      }
      this.ui.style.opacity = '1';
    })();
  }

  /** the WANTED sheet: shader paper on a curled, lit sheet + the ink canvas */
  private buildPoster() {
    this.portrait = capturePortrait(this.engine.renderer, this.res);
    paintPoster(this.res, 0, this.portrait, this.inkCanvas);
    this.ink = inkTexture(this.inkCanvas);
    const word = this.res.won ? 'LEGEND' : 'CLAIMED';
    const sc = paintStampWord(word);
    this.stampTex = inkTexture(sc);
    this.stampTex.minFilter = THREE.LinearFilter;
    this.stampTex.generateMipmaps = false;
    const u = this.paperU;
    u.uStampMap.value = this.stampTex;
    u.uStampRect.value.z = sc.width / 2 / CH;
    u.uStampRect.value.w = sc.height / 2 / CH;
    u.uStampCol.value.set(this.res.won ? '#2a7a1a' : '#b02a1a');
    const mat = new THREE.MeshStandardMaterial({ map: this.ink, roughness: 0.93, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uAspect, uStamp, uStampAng;\nuniform vec4 uStampRect;\nuniform vec3 uStampCol;\nuniform sampler2D uStampMap;\n' + PARCHMENT_GLSL)
        .replace('#include <map_fragment>', POSTER_PAPER);
    };
    mat.customProgramCacheKey = () => 'dustup-wanted-poster';
    return new THREE.Mesh(posterGeometry(), mat);
  }

  exit() {
    this.ui.remove();
    this.ink?.dispose();
    this.stampTex?.dispose();
    (this.poster?.material as THREE.Material | undefined)?.dispose();
    this.poster?.geometry.dispose();
  }

  update(_dt: number, rdt: number) {
    this.t += rdt;
    const t = this.t;
    // cinematic: low sweep over the diorama, then pull back to the poster
    const k = Math.min(1, t / 6);
    const e = k * k * (3 - 2 * k);
    const a = 0.9 - e * 0.9 + Math.sin(t * 0.15) * 0.05;
    const r = 1.15 + e * 1.5;
    this.camera.position.set(Math.sin(a) * r, 0.5 + e * 0.8, 0.15 + Math.cos(a) * r);
    const look = new THREE.Vector3(0, 0.08 + e * 0.8, 0.15 - e * 1.45);
    this.camera.lookAt(look);
    this.diorama.rotation.y = Math.sin(t * 0.2) * 0.06;
    void this.lines;
  }
}
