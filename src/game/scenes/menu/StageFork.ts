// THE FORK IN THE TRAIL: once a ride is behind you, NEW RUN asks where to. The three
// boards under it swing round the post edge-on and two destination boards swing in in
// their place, cut and lettered like the rest of the signpost: THE DUNES (sun-bleached
// pine, red paint) and THE NILE (river-blue paint, gold leaf), plus a small BACK board.
// Until Khonsu of the Sands has fallen the Nile board hangs in chains with a padlock and
// says how to open it. A pick is written to the save (`stage`, read by main.ts on the
// ride) and the ride leaves at once. Arrows / W S + Enter work, Esc goes back.
import * as THREE from 'three';
import type { Engine } from '../../../engine/Engine';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import type { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { makeVoxelMaterial, VoxelMaterial } from '../../../engine/render/VoxelMaterial';
import type { Particles } from '../../fx/Particles';
import type { Ramp } from '../../models/style';
import { signBoard, chainLine, padlockBody, padlockShackle } from '../../models/props/menuSigns';
import { STAGES, type StageId } from '../../meta/Stage';
import { nileOpen, chosenStage, setStage } from '../../meta/StageUnlocks';
import { hideoutOpen } from '../../meta/HideoutGate';
import { damp } from '../../../engine/math/rand';

const R = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });
const PS = 0.78;
type Pivot = [number, number, number];

interface Board {
  id: StageId | 'back';
  group: THREE.Group;
  proxy: THREE.Mesh;
  mat: VoxelMaterial;
  dir: 1 | -1;
  restYaw: number;
  restRoll: number;
  y0: number;
  z0: number;
  hover: number;
  knock: number;
  rattle: number;
  lock: THREE.Group | null;
}

export interface ForkHost {
  engine: Engine;
  camera: THREE.PerspectiveCamera;
  particles: Particles;
  /** the signpost group (boards hang on it) */
  post: THREE.Group;
  /** z of the post's face in its own space */
  faceZ: number;
  /** the menu's own boards under NEW RUN (they swing aside while the fork is open) */
  under: THREE.Group[];
  say(t: string): void;
  /** leave on the ride (the menu's camera flight) */
  ride(): void;
}

function vmesh(model: VoxelModel, vs: number, pivot: Pivot, mat: THREE.Material) {
  const m = new THREE.Mesh(buildVoxelGeometry(model, { voxelSize: vs, pivot }), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export class StageFork {
  /** 0 closed → 1 open (the boards swing round the post) */
  private k = 0;
  private want = 0;
  private boards: Board[] = [];
  private sel = -1;
  private kb = false;
  private lastNdc = new THREE.Vector2(9, 9);
  private ray = new THREE.Raycaster();
  private t = 0;
  private hot: Board | null = null;
  private gone = false;
  private leaving = false;

  constructor(private h: ForkHost) {
    const woods = {
      dunes: R(0xd8b27c, 0xb48a54, 0xecd0a0, 0x7a5a34),
      nile: R(0x2f6aa8, 0x23528a, 0x4f8cc8, 0x14304e),
      back: R(0x8a7662, 0x6c5a48, 0xa69078, 0x46382c),
    };
    const red = R(0xc8442a, 0xa0341e, 0xe2643e, 0x6a2010), gold = R(0xf0c860, 0xc8962e, 0xffe8a0, 0x7a5414), cream = R(0xf3e2bc, 0xd8c39a, 0xfff4dc, 0xa48c66);
    const defs: { id: Board['id']; label: string; dir: 1 | -1; wood: Ramp; ink: Ramp; seed: number }[] = [
      { id: 'desert', label: STAGES.desert.name.toUpperCase(), dir: 1, wood: woods.dunes, ink: red, seed: 41 },
      { id: 'nile', label: STAGES.nile.name.toUpperCase(), dir: -1, wood: woods.nile, ink: gold, seed: 57 },
      { id: 'back', label: 'BACK', dir: 1, wood: woods.back, ink: cream, seed: 63 },
    ];
    defs.forEach((d, i) => {
      const pm = signBoard(d.label, d.dir, d.seed, d.wood, d.ink);
      const mat = makeVoxelMaterial();
      (mat.userData.emissiveStrength as { value: number }).value = 0;
      const mesh = vmesh(pm.model, pm.voxelSize, pm.pivot as Pivot, mat);
      const sc = d.id === 'back' ? PS * 0.82 : PS;
      mesh.scale.setScalar(sc);
      const g = new THREE.Group();
      g.add(mesh);
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(pm.length * sc, pm.height * sc, 0.12), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.position.set((d.dir * pm.length * sc) / 2, 0, 0.04);
      g.add(proxy);
      const slot = i + 1;
      const y0 = 2.3 - slot * 0.37, z0 = h.faceZ + 0.004 + slot * 0.002;
      g.position.set(0, y0, z0);
      g.visible = false;
      h.post.add(g);
      const b: Board = { id: d.id, group: g, proxy, mat, dir: d.dir, restYaw: [0.06, -0.1, 0.05][i], restRoll: [0.03, -0.045, 0.05][i], y0, z0, hover: 0, knock: 0, rattle: 0, lock: null };
      if (d.id === 'nile' && !nileOpen()) {
        b.lock = this.lock(g, d.dir, pm.length * sc, pm.height * sc);
        mat.color.setScalar(0.62);
      }
      this.boards.push(b);
    });
  }

  /** chains crossed over a sealed board, a padlock where they meet */
  private lock(g: THREE.Group, dir: 1 | -1, len: number, hgt: number) {
    const u = PS / 96;
    const Lv = len / u, Hv = hgt / u;
    const lock = new THREE.Group();
    lock.position.set(dir * len * 0.46, 0, 12 * u);
    g.add(lock);
    const iron = makeVoxelMaterial();
    for (const s of [1, -1]) {
      const CS = 1.6;
      const ch = chainLine((-Lv * 0.36) / CS, (s * Hv * 0.44) / CS, (Lv * 0.32) / CS, (-s * Hv * 0.4) / CS, s > 0 ? 5 : 9);
      const mesh = vmesh(ch.model, ch.voxelSize, [0, 0, 0], iron);
      mesh.scale.setScalar(PS * CS);
      mesh.position.set(dir * -0.02 * len, 0, s * 0.6 * u);
      if (dir < 0) mesh.rotation.y = Math.PI;
      lock.add(mesh);
    }
    const pb = padlockBody(), sh = padlockShackle();
    const body = vmesh(pb.model, pb.voxelSize, pb.pivot as Pivot, iron);
    body.scale.setScalar(PS * 1.9);
    body.position.set(0, -2 * u, 7 * u);
    body.rotation.z = 0.12;
    const shackle = vmesh(sh.model, sh.voxelSize, sh.pivot as Pivot, iron);
    shackle.position.set(-(sh.span / 2) / 96, -4 / 96, 0);
    body.add(shackle);
    lock.add(body);
    lock.userData.body = body;
    return lock;
  }

  /** NEW RUN was pressed: true when the fork takes it (after the first ride) */
  offer(): boolean {
    if (this.gone || this.leaving || !hideoutOpen()) return false;
    this.want = 1;
    this.kb = false;
    this.sel = this.boards.findIndex((b) => b.id === chosenStage());
    const eng = this.h.engine;
    eng.audio.play('door_creak', { volume: 0.35, pitch: 1.6 });
    eng.audio.play('whoosh', { volume: 0.4, pitch: 1.3 });
    this.h.say('Where to?  ·  pick a trail');
    return true;
  }
  close() {
    this.want = 0;
    this.h.engine.audio.play('ui_back', { volume: 0.5 });
  }
  /** the fork owns the signpost (open, opening or closing) */
  get busy() {
    return this.k > 0.001 || this.want > 0;
  }

  private pick(b: Board) {
    const eng = this.h.engine;
    b.knock = 1;
    eng.audio.play('ui_click', { volume: 0.7 });
    eng.audio.play('kick', { volume: 0.5, pitch: 1.25 });
    const wp = b.proxy.getWorldPosition(new THREE.Vector3());
    const P = this.h.particles;
    P.emit({ pos: wp, count: 12, spread: 1.2, up: 0.6, life: [0.5, 1.1], size: [0.03, 0.02], sprite: ['grain0', 'grain1', 'grain2', 'woodchip'], color: [0xe8c890, 0xc8a070, 0x9a7448], gravity: 6, drag: 1.2, jitter: 0.5 });
    if (b.id === 'back') {
      this.close();
      return;
    }
    if (b.id === 'nile' && !nileOpen()) {
      b.rattle = 1.2;
      eng.audio.play('skeleton_rattle', { volume: 0.4, pitch: 1.4 });
      eng.audio.play('ui_error', { volume: 0.4 });
      this.h.say(STAGES.nile.sealed);
      return;
    }
    setStage(b.id);
    if (b.id === 'nile') {
      // river spray off the blue board
      P.emit({ pos: wp, count: 26, spread: 1.6, up: 1.2, life: [0.5, 1.1], size: [0.05, 0.015], sprite: ['dot3', 'star4'], color: [0x9fd8ff, 0xeaf6ff, 0x4fa8e8], additive: true, gravity: 4, drag: 1.2 });
      eng.audio.play('gem_chime', { volume: 0.4, pitch: 0.8 });
    }
    this.h.say(b.id === 'nile' ? 'Down to the river' : 'Out into the dunes');
    this.leaving = true;
    this.h.ride();
  }

  /** per frame while busy; returns true when it handled the menu this frame */
  update(dt: number): boolean {
    if (this.gone) return false;
    this.t += dt;
    const eng = this.h.engine;
    const inp = eng.input;
    // swing: the menu's boards turn edge-on round the post, then the destinations turn in
    this.k = damp(this.k, this.want, this.want ? 7 : 9, dt);
    if (Math.abs(this.k - this.want) < 0.002) this.k = this.want;
    const out = Math.min(1, this.k * 2), inn = Math.max(0, this.k * 2 - 1);
    const eo = out * out * (3 - 2 * out), ei = inn * inn * (3 - 2 * inn);
    this.h.under.forEach((g, i) => {
      const dir = i % 2 === 0 ? 1 : -1;
      g.rotation.y = (g.userData.forkYaw0 ??= g.rotation.y) * (1 - eo) + dir * eo * (Math.PI / 2);
      g.visible = eo < 0.98;
      if (this.k === 0) delete g.userData.forkYaw0;
    });
    let hit: Board | null = null;
    if (this.want > 0 && this.k > 0.6 && !this.leaving) {
      // keyboard
      const up = inp.wasPressed('ArrowUp') || inp.wasPressed('KeyW');
      const down = inp.wasPressed('ArrowDown') || inp.wasPressed('KeyS');
      if (up || down) {
        this.kb = true;
        const n = this.boards.length;
        this.sel = this.sel < 0 ? 0 : (this.sel + (down ? 1 : -1) + n) % n;
      }
      if (inp.ndcX !== this.lastNdc.x || inp.ndcY !== this.lastNdc.y) {
        this.kb = false;
        this.lastNdc.set(inp.ndcX, inp.ndcY);
      }
      if (!this.kb) {
        this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), this.h.camera);
        const hits = this.ray.intersectObjects(this.boards.map((b) => b.proxy), false);
        hit = hits.length ? (this.boards.find((b) => b.proxy === hits[0].object) ?? null) : null;
        this.sel = hit ? this.boards.indexOf(hit) : this.sel;
      } else hit = this.boards[this.sel] ?? null;
      if (hit !== this.hot) {
        if (hit) {
          eng.audio.play('ui_hover', { volume: 0.45 });
          if (hit.id === 'nile' && hit.lock) {
            hit.rattle = Math.max(hit.rattle, 0.5);
            this.h.say(STAGES.nile.sealed);
          } else if (hit.id === 'nile') this.h.say('THE NILE  ·  surf the river against Cleopatra');
          else if (hit.id === 'desert') this.h.say('THE DUNES  ·  the bounty trail through the desert');
        }
        this.hot = hit;
      }
      document.body.style.cursor = hit && !this.kb ? 'pointer' : 'default';
      if (inp.wasPressed('Escape') || inp.wasPressed('Backspace')) this.close();
      else if (hit && !this.kb && inp.wasPressed('Mouse0')) this.pick(hit);
      else if (this.kb && hit && (inp.wasPressed('Enter') || inp.wasPressed('Space') || inp.wasPressed('NumpadEnter'))) this.pick(hit);
      else if (!hit && !this.kb && inp.wasPressed('Mouse0')) this.close();
    }
    for (const b of this.boards) {
      const g = b.group;
      g.visible = ei > 0.02;
      const on = b === hit ? 1 : 0;
      b.hover = damp(b.hover, on, 9, dt);
      b.knock = Math.max(0, b.knock - dt * 2.2);
      b.rattle = Math.max(0, b.rattle - dt * 1.6);
      const hv = b.hover;
      const sway = Math.sin(this.t * 1.3 + b.restYaw * 40) * 0.012;
      g.rotation.z = b.restRoll * (1 - hv * 0.7) + sway + Math.sin(b.knock * 20) * b.knock * 0.22 + Math.sin(this.t * 38) * b.rattle * 0.05;
      g.rotation.y = (b.restYaw * (1 - hv) + hv * 0.06) * ei - b.dir * (1 - ei) * (Math.PI / 2);
      g.position.z = b.z0 + hv * 0.09 - b.knock * 0.04;
      g.position.y = b.y0 + hv * 0.035;
      g.scale.setScalar(1 + hv * 0.035);
      const lit = b.lock ? hv * 0.4 : hv;
      (b.mat.userData.emissiveStrength as { value: number }).value = lit * 1.5 + b.knock * 0.8;
      if (b.id === 'nile') b.mat.emissive.setRGB(0.04 * lit, 0.12 * lit, 0.24 * lit);
      else b.mat.emissive.setRGB(0.22 * lit, 0.09 * lit, 0.02 * lit);
      if (b.lock) {
        const body = b.lock.userData.body as THREE.Object3D;
        body.rotation.z = 0.12 + Math.sin(this.t * 1.7) * 0.04 + Math.sin(this.t * 38) * b.rattle * 0.25;
      }
    }
    return this.busy;
  }

  dispose() {
    this.gone = true;
    for (const b of this.boards) {
      b.group.removeFromParent();
      b.mat.dispose();
    }
    this.boards = [];
  }
}
