// End of a run: a lamplit table in the hideout. On it, a miniature voxel
// diorama of the region you rode through (zones you never reached under dust
// sheets), your trail pinned in red string, a skull where you fell. Pinned
// above it, your WANTED poster fills in line by line and gets stamped.
import * as THREE from 'three';
import type { Engine, GameScene } from '../../engine/Engine';
import type { RunState } from '../Ctx';
import type { SubArea } from '../world/RegionGen';
import { MAT } from '../world/Heightfield';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { TOON, bevelBox } from '../models/style';
import { Ease } from '../../engine/Tween';

export interface RunResult {
  run: RunState;
  won: boolean;
  sa: SubArea;
  reached: number; // highest zone index unlocked
  trail: { x: number; z: number }[];
  deathAt: { x: number; z: number } | null;
  bosses: string[];
  heightAt(x: number, z: number): number;
}

const N = 88; // diorama columns per side
const VS = 0.045; // diorama voxel size (m)

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
      const h = res.heightAt(((i + 0.5) / N) * S, ((j + 0.5) / N) * S);
      hs.push(h);
      hmin = Math.min(hmin, h);
      hmax = Math.max(hmax, h);
    }
  const levels = 14;
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

export function paintPoster(res: RunResult, lines: number) {
  const W = 360, H = 520;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const P = 4;
  for (let y = 0; y < H; y += P)
    for (let x = 0; x < W; x += P) {
      const e = Math.min(x, y, W - P - x, H - P - y);
      const n = Math.sin(x * 0.37 + y * 0.11) * Math.cos(y * 0.23 - x * 0.07);
      c.fillStyle = e < 8 ? '#9a6a38' : e < 16 ? '#cfae78' : n > 0.6 ? '#e2cb98' : '#ecd9ae';
      c.fillRect(x, y, P, P);
    }
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.fillStyle = '#2a1a10';
  c.font = '48px Alagard';
  c.fillText('WANTED', W / 2, 22);
  c.font = '16px Alagard';
  c.fillText(res.won ? '— A LEGEND OF THE DUNES —' : '— DEAD OR ALIVE —', W / 2, 74);
  // portrait box
  c.fillStyle = '#d8c08c';
  c.fillRect(W / 2 - 70, 98, 140, 120);
  c.strokeStyle = '#2a1a10';
  c.lineWidth = 4;
  c.strokeRect(W / 2 - 70, 98, 140, 120);
  // pixel skull portrait with a hat
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    c.fillStyle = col;
    c.fillRect(W / 2 - 70 + x * 4, 98 + y * 4, w * 4, h * 4);
  };
  px(7, 6, 21, 3, '#6a3a20');
  px(11, 2, 13, 5, '#7a4a28');
  px(11, 5, 13, 1, '#b0392a');
  px(11, 9, 13, 11, '#f2dcb4');
  px(13, 12, 3, 3, '#2a1a10');
  px(19, 12, 3, 3, '#2a1a10');
  px(14, 13, 1, 1, '#9dff3a');
  px(20, 13, 1, 1, '#9dff3a');
  px(17, 16, 1, 1, '#2a1a10');
  px(13, 18, 9, 1, '#2a1a10');
  for (let i = 0; i < 4; i++) px(14 + i * 2, 18, 1, 2, '#f2dcb4');
  px(12, 21, 11, 3, '#b0392a');
  c.fillStyle = '#2a1a10';
  c.font = '32px Alagard';
  c.fillText('SUNDOWN', W / 2, 228);
  const r = res.run;
  const mm = Math.floor(r.time / 60), ss = Math.floor(r.time % 60);
  const rows: [string, string][] = [
    ['Waves survived', String(Math.max(0, r.wave - (res.won ? 0 : 1)))],
    ['Outlaws laid low', String(r.kills)],
    ['Bounty earned', `$${Math.round(r.totalBounty)}`],
    ['Gold collected', String(Math.round(r.totalGold))],
    ['Bounty rank', String(r.rank)],
    ['Time in the saddle', `${mm}:${String(ss).padStart(2, '0')}`],
    ['Bosses', res.bosses.length ? res.bosses.join(', ') : '—'],
  ];
  c.font = '16px Alagard';
  rows.slice(0, lines).forEach(([k, v], i) => {
    const y = 276 + i * 26;
    c.textAlign = 'left';
    c.fillStyle = '#4a2a14';
    c.fillText(k, 34, y);
    c.textAlign = 'right';
    c.fillStyle = '#2a1a10';
    c.fillText(v, W - 34, y);
    c.fillStyle = 'rgba(42,26,16,0.25)';
    c.fillRect(34, y + 19, W - 68, 2);
  });
  if (lines > rows.length) {
    c.save();
    c.translate(W / 2, 452);
    c.rotate(-0.16);
    c.globalAlpha = 0.85;
    c.strokeStyle = res.won ? '#2a7a1a' : '#b02a1a';
    c.fillStyle = c.strokeStyle;
    c.lineWidth = 5;
    c.font = '40px Alagard';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const word = res.won ? 'LEGEND' : 'CLAIMED';
    const w = c.measureText(word).width + 30;
    c.strokeRect(-w / 2, -28, w, 56);
    c.fillText(word, 0, 2);
    c.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export class ResultsScene implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
  private poster!: THREE.Mesh;
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
    this.poster = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.56), new THREE.MeshStandardMaterial({ map: paintPoster(this.res, 0), roughness: 0.95 }));
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
    eng.overlay.appendChild(this.ui);
    eng.input.setWantLock(false);
    // poster fills in line by line
    void (async () => {
      await eng.tweens.wait(2.2, true);
      for (let i = 1; i <= 8; i++) {
        this.lines = i;
        const old = (this.poster.material as THREE.MeshStandardMaterial).map;
        (this.poster.material as THREE.MeshStandardMaterial).map = paintPoster(this.res, i);
        old?.dispose();
        eng.audio.play(i === 8 ? 'poster_slam' : 'page_turn', { volume: i === 8 ? 1 : 0.4 });
        if (i === 8) eng.tweens.run(0.25, (k) => (this.poster.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.06)), Ease.outQuad, { real: true });
        await eng.tweens.wait(i === 7 ? 0.7 : 0.32, true);
      }
      this.ui.style.opacity = '1';
    })();
  }

  exit() {
    this.ui.remove();
  }

  update(_dt: number, rdt: number) {
    this.t += rdt;
    const t = this.t;
    // cinematic: low sweep over the diorama, then pull back to the poster
    const k = Math.min(1, t / 6);
    const e = k * k * (3 - 2 * k);
    const a = 0.9 - e * 0.9 + Math.sin(t * 0.15) * 0.05;
    const r = 1.4 + e * 1.6;
    this.camera.position.set(Math.sin(a) * r, 0.55 + e * 0.75, 0.15 + Math.cos(a) * r);
    const look = new THREE.Vector3(0, 0.15 + e * 0.75, 0.15 - e * 1.4);
    this.camera.lookAt(look);
    this.diorama.rotation.y = Math.sin(t * 0.2) * 0.06;
    void this.lines;
  }
}
