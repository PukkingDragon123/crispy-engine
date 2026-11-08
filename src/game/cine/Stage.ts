// The choice stage: every Choice.show() is now a small scene played out in the
// desert instead of paper dropped in front of the lens.
//
// The speaker (a rigged, animated NPC on the HumanNpc animator, Pinch, or just
// a notice board when nobody speaks) stands a few metres ahead of the hunter.
// The camera blends off the run camera into an establishing shot, an opener can
// blow something up (the outlaws' dynamite takes a wagon apart: voxel fireball,
// shattered planks, a burning wreck), the speaker's lines type themselves out
// above their head in 3D while they talk, and then the options appear as real
// objects in the scene:
//   'post'  - notices shot to a weathered wanted board (the paper shader)
//   'items' - the things on offer laid out on the sand between you (canteen,
//             tonic, tin star, gold...), anything without an item becomes a
//             word scratched into the sand
//   'sand'  - words carved into the sand around a dig
//   'cards' - face-down cards on a crate table
// Hover or tap to push the camera in on one (its terms appear beside it), pick
// with 1-N, a click or a tap; ESC walks away when allowed. The chosen object
// reacts, the speaker answers, the camera hands back, and the actors wander
// off into the dust once the world is moving again.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Input } from '../../engine/Input';
import { touchText } from '../ui/TouchControls';
import type { ChoiceOption } from '../ui/Choice';
import { HumanNpc, type NpcMode } from '../run/TravelerEscort';
import { modelEntry } from '../models/lookup';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance, type RigSpec } from '../../engine/voxel/Rig';
import { makeVoxelMaterial, type VoxelMaterial } from '../../engine/render/VoxelMaterial';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { FloatText3D } from '../fx/FloatText3D';
import { Voice, type VoiceId } from '../audio/Voice';
import { Skills } from '../player/Skills';
import { canteen, digMound, xMarker } from '../models/props/treasure';
import { Cinema } from './Cinema';
import { CineCam } from './CineCam';
import { CineKit, GRAIN, SAND } from './CineKit';
import { VoxelWord } from './VoxelLetters';

export interface StageActor {
  /** rig key (cowboy_<hat>_<outfit>, outlaw_rider_v1, ...) or 'pinch' */
  rig: string;
  /** placement from the stage anchor: [metres to the right, metres toward the hunter] */
  at?: [number, number];
  yaw?: number;
  mode?: NpcMode;
  voice?: VoiceId;
  /** outlaw riders: step off the board */
  hideBoard?: boolean;
}
export interface StageProp {
  key: string;
  at: [number, number];
  yaw?: number;
  /** scale the model so its largest side is this long (m) */
  size?: number;
  /** the opener blows this one up */
  blast?: boolean;
}
export interface StageLine {
  /** actor index (default 0) or the hunter */
  who?: number | 'sundown';
  text: string;
}
export interface StageSpec {
  actors?: StageActor[];
  props?: StageProp[];
  lines?: StageLine[];
  presenter?: 'post' | 'items' | 'sand' | 'cards';
  opener?: 'dynamite';
  /** what the speaker says after each option */
  replies?: (StageLine | null)[];
  /** what the actors do after each option */
  after?: (NpcMode | null)[];
  /** hunter -> speaker distance (m) */
  dist?: number;
}

interface OptObj {
  root: THREE.Object3D;
  pick: THREE.Object3D[];
  label: FloatText3D;
  detail: FloatText3D;
  focus: THREE.Vector3;
  base: THREE.Vector3;
  baseQ: THREE.Quaternion;
  hover: number;
  kind: 'notice' | 'item' | 'mark' | 'card';
  word?: VoxelWord;
  notice?: THREE.Mesh;
  /** null until the choice; then counts up from minus its delay, revealed at 0 */
  appear: number | null;
}

interface Actor {
  npc: HumanNpc | null;
  pinch: RigInstance | null;
  root: THREE.Object3D;
  pos: THREE.Vector3;
  voice: VoiceId;
  height: number;
  walkOff: THREE.Vector3 | null;
}

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _r = new THREE.Raycaster();
const _n = new THREE.Vector2();
const sat = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
const ease = (k: number) => {
  k = sat(k);
  return k * k * (3 - 2 * k);
};

const SPECIAL: Record<string, () => { model: VoxelModel; voxelSize: number; pivot?: [number, number, number] }> = {
  canteen: () => canteen() as any,
  dig_mound: () => digMound(2) as any,
  x_marker: () => xMarker(3) as any,
};

/** a static voxel model as a mesh standing on its base (null if the key has none) */
function staticModel(key: string, mat: VoxelMaterial) {
  let e: any;
  try {
    e = SPECIAL[key]?.() ?? modelEntry(key)?.();
  } catch (err) {
    console.warn('[stage] model failed', key, err);
    return null;
  }
  if (!e || e.parts) return null;
  const sm = e.model ? e : e.base ? { model: e.base, voxelSize: e.voxelSize } : null;
  if (!sm?.model) return null;
  const model = sm.model as VoxelModel;
  const b = model.bounds();
  const pivot: [number, number, number] = sm.pivot && (sm.pivot[0] || sm.pivot[1] || sm.pivot[2]) ? sm.pivot : [(b.minX + b.maxX + 1) / 2, b.minY, (b.minZ + b.maxZ + 1) / 2];
  const geo = buildVoxelGeometry(model, { voxelSize: sm.voxelSize, pivot });
  geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, model, vs: sm.voxelSize as number, pivot, box: geo.boundingBox!.clone() };
}

export class ChoiceStage {
  phase: 'intro' | 'lines' | 'choose' | 'resolve' | 'linger' | 'gone' = 'intro';
  private t = 0;
  private pt = 0;
  private cin: Cinema | null;
  private kit: CineKit | null;
  private ccam: CineCam;
  private ownCam = false;
  private mat: VoxelMaterial;
  private group = new THREE.Group();
  private anchor = new THREE.Vector3();
  private toH = new THREE.Vector3();
  private right = new THREE.Vector3();
  private hunter = new THREE.Vector3();
  private actors: Actor[] = [];
  private props: { mesh: THREE.Mesh; model: VoxelModel; vs: number; pivot: [number, number, number]; blast: boolean }[] = [];
  private opts: OptObj[] = [];
  private texts: FloatText3D[] = [];
  private line: FloatText3D | null = null;
  private lineQ: StageLine[] = [];
  private lineHold = 0;
  private hovered = -1;
  private focusW = 0;
  private focusIdx = -1;
  private picked = -1;
  private presenterAt = new THREE.Vector3();
  private board: THREE.Mesh | null = null;
  private dyn: { mesh: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
  private boomDone = false;
  private hudWas = true;
  private hint: HTMLDivElement;
  private linger = 0;
  private pinchWas = true;
  private readonly lateFn = (rdt: number) => this.late(rdt);
  private readonly ownTick = (_dt: number, rdt: number) => this.ccam.apply(rdt);
  private clickQueued = false;

  constructor(
    private ctx: Ctx,
    private input: Input,
    private spec: StageSpec,
    private heading: string,
    private options: ChoiceOption[],
    private canCancel: boolean,
    private notice: (o: ChoiceOption) => THREE.Mesh,
    private done: (i: number) => void
  ) {
    this.cin = Cinema.get();
    this.kit = this.cin?.kit ?? null;
    if (this.cin) {
      this.ccam = this.cin.ccam;
      this.cin.late.add(this.lateFn);
    } else {
      this.ccam = new CineCam(ctx.camera);
      this.ownCam = true;
      ctx.engine.onAfterUpdate.push(this.ownTick);
    }
    this.ccam.groundAt = (x, z) => ctx.world.groundAt(x, z);
    this.mat = makeVoxelMaterial({ fog: true });
    ctx.scene.add(this.group);
    this.hint = document.createElement('div');
    this.hint.style.cssText = "position:absolute;left:50%;top:13vh;transform:translateX(-50%);font-family:'Alagard';font-size:24px;color:#fff3d6;text-shadow:0 3px 0 #2a1810,0 0 12px #000;z-index:7;pointer-events:none;display:none;letter-spacing:1px;text-align:center;opacity:.92";
    ctx.engine.overlay.appendChild(this.hint);
    this.build();
    // the HUD steps aside for the scene
    const hud = this.cin?.hud;
    this.hudWas = hud?.visible ?? true;
    hud?.setVisible(false);
    ctx.engine.letterbox(true, 0.45);
    this.ccam.take(false, 2.6);
    this.establishing(0);
  }

  // ------------------------------------------------------------------ set building
  private ground(x: number, z: number) {
    return this.ctx.world.groundAt(x, z);
  }
  /** stage coordinates -> world (on the ground) */
  private at(r: number, f: number, out = new THREE.Vector3()) {
    out.copy(this.anchor).addScaledVector(this.right, r).addScaledVector(this.toH, f);
    out.y = this.ground(out.x, out.z);
    return out;
  }

  private build() {
    const ctx = this.ctx;
    const sp = this.spec;
    const cin = this.cin;
    const cam = ctx.camera;
    const player = cin?.player;
    this.hunter.copy(player ? player.pos : cam.position);
    const rigCine = cin?.cam.cine;
    const hasActors = !!sp.actors?.length;
    let fwd: THREE.Vector3;
    if (rigCine && !hasActors) {
      // someone else framed a spot (a landmark door): set the scene there, facing their camera
      const a = rigCine.look.clone().lerp(rigCine.pos, 0.38);
      this.anchor.set(a.x, this.ground(a.x, a.z), a.z);
      fwd = new THREE.Vector3(this.anchor.x - rigCine.pos.x, 0, this.anchor.z - rigCine.pos.z);
      this.hunter.set(rigCine.pos.x, this.ground(rigCine.pos.x, rigCine.pos.z), rigCine.pos.z);
    } else {
      fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      fwd.y = 0;
      const d = sp.dist ?? (hasActors ? 7.5 : 4.2);
      this.anchor.copy(this.hunter).addScaledVector(fwd.normalize(), d);
      this.anchor.y = this.ground(this.anchor.x, this.anchor.z);
    }
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    this.toH.copy(fwd).negate();
    // screen-right as seen from the hunter (so option 1 sits on the left, reading order)
    this.right.set(this.toH.z, 0, -this.toH.x);
    const faceH = Math.atan2(this.toH.x, this.toH.z);
    // ---- set dressing
    for (const p of sp.props ?? []) {
      const sm = staticModel(p.key, this.mat);
      if (!sm) continue;
      const pos = this.at(p.at[0], p.at[1]);
      sm.mesh.position.copy(pos).add(new THREE.Vector3(0, -0.03, 0));
      sm.mesh.rotation.y = faceH + (p.yaw ?? 0);
      if (p.size) {
        const sz = sm.box.getSize(_v);
        sm.mesh.scale.setScalar(p.size / Math.max(sz.x, sz.y, sz.z, 1e-3));
      }
      this.group.add(sm.mesh);
      this.props.push({ mesh: sm.mesh, model: sm.model, vs: sm.vs, pivot: sm.pivot, blast: !!p.blast });
    }
    // ---- actors
    for (const a of sp.actors ?? []) {
      const pos = this.at(a.at?.[0] ?? 0, a.at?.[1] ?? 0);
      const yaw = faceH + (a.yaw ?? 0);
      if (a.rig === 'pinch') {
        const spec = modelEntry('pinch')?.() as RigSpec | undefined;
        if (!spec?.parts) continue;
        const r = new RigInstance(buildRigGeo(spec, 'pinch:stage'), { castShadow: true });
        r.root.position.copy(pos);
        r.root.rotation.y = yaw;
        r.root.scale.setScalar(1.6);
        this.group.add(r.root);
        const sk = Skills.current;
        if (sk) {
          this.pinchWas = sk.pinchRoot.visible;
          sk.pinchRoot.visible = false;
        }
        this.actors.push({ npc: null, pinch: r, root: r.root, pos, voice: a.voice ?? 'pinch', height: 0.5, walkOff: null });
        continue;
      }
      let npc: HumanNpc;
      try {
        npc = new HumanNpc(ctx, a.rig, pos, yaw);
      } catch (e) {
        console.warn('[stage] npc failed', a.rig, e);
        continue;
      }
      if (a.hideBoard) {
        npc.rig.setPartVisible('board', false);
        npc.pos.y -= 0.055;
      }
      npc.mode = a.mode ?? 'idle';
      npc.look = this.hunter.clone().add(new THREE.Vector3(0, 1.4, 0));
      npc.update(0.016);
      this.actors.push({ npc, pinch: null, root: npc.root, pos: npc.pos, voice: a.voice ?? 'outlaw', height: npc.height, walkOff: null });
    }
    // ---- the options, as things in the scene (hidden until the choice)
    const pres = sp.presenter ?? (this.options.every((o) => o.title.trim() === '?') ? 'cards' : 'post');
    const n = this.options.length;
    const front = hasActors ? 2.0 : 0;
    this.presenterAt.copy(this.at(0, front));
    if (pres === 'post') this.buildPost(hasActors);
    else if (pres === 'cards') this.buildCards();
    else
      this.options.forEach((o, i) => {
        const x = (i - (n - 1) / 2) * (pres === 'sand' ? 1.45 : 1.1);
        const f = front + (pres === 'sand' ? 0.25 + Math.abs(i - (n - 1) / 2) * -0.35 : 0.1);
        if (pres === 'items' && o.prop) {
          const sm = staticModel(o.prop, this.mat);
          if (sm) return this.addItem(i, o, sm.mesh, sm.box, this.at(x, f));
        }
        this.addMark(i, o, this.at(x, f + 0.2));
      });
    this.lineQ = [...(sp.lines ?? [])];
    // the hunter tips his hat to whoever he's facing
    player?.express('focus', 6);
  }

  /** a wanted board with each option shot to it as a paper notice */
  private buildPost(beside: boolean) {
    const sm = staticModel('wanted_board_1', this.mat);
    const pos = beside ? this.at(1.9, 1.2) : this.at(0, 0.4);
    const faceH = Math.atan2(this.toH.x, this.toH.z) + (beside ? -0.35 : 0);
    // board face: the frontmost planks between the posts
    let faceZ = 0.05, y0 = 0.9, y1 = 1.8, halfW = 0.6;
    if (sm) {
      const m = sm.model, vs = sm.vs, pv = sm.pivot;
      const b = m.bounds();
      const h = b.maxY - b.minY;
      let zf = -1e9;
      m.forEach((x, y, z) => {
        if (Math.abs(x + 0.5 - pv[0]) < 26 && y > b.minY + h * 0.35 && y < b.minY + h * 0.75 && z > zf) zf = z;
      });
      let lo = 1e9, hi = -1e9, wx = 0;
      m.forEach((x, y, z) => {
        if (z >= zf - 2 && Math.abs(x + 0.5 - pv[0]) < 30) {
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
          wx = Math.max(wx, Math.abs(x + 0.5 - pv[0]));
        }
      });
      if (zf > -1e9 && hi > lo) {
        faceZ = (zf + 1 - pv[2]) * vs + 0.012;
        y0 = (lo - pv[1]) * vs;
        y1 = (hi + 1 - pv[1]) * vs;
        halfW = Math.max(0.4, wx * vs - 0.06);
      }
      sm.mesh.position.copy(pos);
      sm.mesh.rotation.y = faceH;
      this.group.add(sm.mesh);
      this.board = sm.mesh;
    }
    const n = this.options.length;
    const w = Math.min(0.6, (halfW * 2) / (n + 0.25));
    const sc = w / 0.74;
    const q = new THREE.Quaternion().setFromAxisAngle(UP, faceH);
    const nrm = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const rgt = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    this.options.forEach((o, i) => {
      const mesh = this.notice(o);
      mesh.scale.setScalar(sc);
      const lx = (i - (n - 1) / 2) * (w + 0.05);
      const ly = THREE.MathUtils.clamp((y0 + y1) / 2 + (i % 2 ? 0.03 : -0.02), y0 + 1.02 * sc * 0.5, y1);
      const p = pos.clone().addScaledVector(rgt, lx).addScaledVector(nrm, faceZ + i * 0.002).add(new THREE.Vector3(0, ly, 0));
      mesh.position.copy(p);
      mesh.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (Math.random() - 0.5) * 0.1));
      this.group.add(mesh);
      const focus = p.clone();
      this.pushOpt({ root: mesh, pick: [mesh], kind: 'notice', notice: mesh, focus, labelAt: p.clone().add(new THREE.Vector3(0, 1.02 * sc * 0.62, 0)), i, o, normal: nrm });
    });
    this.presenterAt.copy(pos).add(new THREE.Vector3(0, (y0 + y1) / 2, 0));
  }

  /** face-down cards on a crate table */
  private buildCards() {
    const sm = staticModel('crate_table_1', this.mat) ?? staticModel('table_bare', this.mat);
    const pos = this.at(0, 0.9);
    let top = 0.8;
    if (sm) {
      sm.mesh.position.copy(pos);
      sm.mesh.rotation.y = Math.atan2(this.toH.x, this.toH.z);
      this.group.add(sm.mesh);
      top = sm.box.max.y + 0.012;
    }
    const n = this.options.length;
    const faceH = Math.atan2(this.toH.x, this.toH.z);
    this.options.forEach((o, i) => {
      const mesh = this.notice(o);
      mesh.scale.setScalar(0.36);
      const p = pos.clone().addScaledVector(this.right, (i - (n - 1) / 2) * 0.32).addScaledVector(this.toH, 0.05).add(new THREE.Vector3(0, top, 0));
      mesh.position.copy(p);
      mesh.rotation.set(-Math.PI / 2 + 0.05, 0, 0, 'YXZ');
      mesh.rotation.y = faceH + (Math.random() - 0.5) * 0.25;
      this.group.add(mesh);
      this.pushOpt({ root: mesh, pick: [mesh], kind: 'card', notice: mesh, focus: p.clone(), labelAt: p.clone().add(new THREE.Vector3(0, 0.28, 0)), i, o, normal: UP.clone() });
    });
    this.presenterAt.copy(pos).add(new THREE.Vector3(0, top, 0));
  }

  /** an item laid on the sand, scaled to read at a few metres */
  private addItem(i: number, o: ChoiceOption, mesh: THREE.Mesh, box: THREE.Box3, p: THREE.Vector3) {
    const sz = box.getSize(_v);
    const k = 0.5 / Math.max(sz.x, sz.y, sz.z, 1e-3);
    const holder = new THREE.Group();
    holder.add(mesh);
    mesh.scale.setScalar(k);
    holder.position.copy(p);
    holder.rotation.y = Math.atan2(this.toH.x, this.toH.z) + (i - 1) * 0.3;
    this.group.add(holder);
    const top = sz.y * k;
    this.pushOpt({ root: holder, pick: [mesh], kind: 'item', focus: p.clone().add(new THREE.Vector3(0, top * 0.5, 0)), labelAt: p.clone().add(new THREE.Vector3(0, top + 0.32, 0)), i, o, normal: this.toH.clone() });
  }

  /** a word scratched into the sand */
  private addMark(i: number, o: ChoiceOption, p: THREE.Vector3) {
    const text = (o.mark ?? shortWord(o.title)).toUpperCase();
    const word = new VoxelWord(text, { height: 0.26, style: 'sand', castShadow: false });
    const lay = new THREE.Group();
    word.group.rotation.x = -Math.PI / 2;
    lay.add(word.group);
    lay.position.copy(p).add(new THREE.Vector3(0, -0.004, 0));
    lay.rotation.y = Math.atan2(this.toH.x, this.toH.z);
    this.group.add(lay);
    word.enter('none');
    word.update(0);
    // a scuffed X beside the word, dug by a claw
    const x = staticModel('x_marker', this.mat);
    if (x) {
      x.mesh.position.copy(p).addScaledVector(this.right, -(word.width / 2 + 0.3)).add(new THREE.Vector3(0, -0.02, 0));
      x.mesh.scale.setScalar(0.55);
      x.mesh.rotation.y = lay.rotation.y + 0.4;
      lay.parent!.add(x.mesh);
      lay.userData.x = x.mesh;
    }
    const pick = new THREE.Mesh(new THREE.PlaneGeometry(word.width + 0.5, 0.6), new THREE.MeshBasicMaterial({ visible: false }));
    pick.rotation.x = -Math.PI / 2;
    pick.position.y = 0.05;
    lay.add(pick);
    this.pushOpt({ root: lay, pick: [pick, ...word.letters.map((l) => l.mesh)], kind: 'mark', word, focus: p.clone(), labelAt: p.clone().add(new THREE.Vector3(0, 0.45, 0)), i, o, normal: UP.clone() });
  }

  private pushOpt(a: { root: THREE.Object3D; pick: THREE.Object3D[]; kind: OptObj['kind']; focus: THREE.Vector3; labelAt: THREE.Vector3; i: number; o: ChoiceOption; normal: THREE.Vector3; notice?: THREE.Mesh; word?: VoxelWord }) {
    const label = new FloatText3D(`${a.i + 1}  ${a.o.title.toUpperCase()}`, { size: 0.17, px: 64, cps: 55, wrap: 22, color: '#fff3d6', glow: '#ff9a3a', hdr: 1.3 });
    label.anchor.copy(a.labelAt);
    const det = [a.o.body, a.o.footer ? `- ${a.o.footer} -` : ''].filter(Boolean).join('\n');
    const detail = new FloatText3D(det, { size: 0.09, px: 48, cps: 90, wrap: 30, color: '#f6e6c4', glow: '#c08040', hdr: 1.1 });
    detail.anchor.copy(a.labelAt).add(new THREE.Vector3(0, 0.26, 0));
    for (const t of [label, detail]) {
      (t.mesh.material as THREE.MeshBasicMaterial).fog = false;
      t.show(false);
      this.ctx.scene.add(t.mesh);
      this.texts.push(t);
    }
    a.root.visible = false;
    if (a.root.userData.x) a.root.userData.x.visible = false;
    this.opts.push({ root: a.root, pick: a.pick, label, detail, focus: a.focus, base: a.root.position.clone(), baseQ: a.root.quaternion.clone(), hover: 0, kind: a.kind, word: a.word, notice: a.notice, appear: null });
  }

  // ------------------------------------------------------------------ camera
  private headOf(i: number | 'sundown', out = new THREE.Vector3()) {
    if (i === 'sundown') {
      const p = this.cin?.player;
      const n = p?.rig.nodes['head'];
      if (n) return n.getWorldPosition(out);
      return out.copy(this.hunter).add(new THREE.Vector3(0, 1.5, 0));
    }
    const a = this.actors[i] ?? this.actors[0];
    if (!a) return out.copy(this.anchor).add(new THREE.Vector3(0, 1.5, 0));
    const n = a.npc?.rig.nodes['head'] ?? a.pinch?.root;
    if (n) {
      n.getWorldPosition(out);
      return a.pinch ? out.add(new THREE.Vector3(0, 0.25, 0)) : out;
    }
    return out.copy(a.pos).add(new THREE.Vector3(0, a.height * 0.85, 0));
  }

  private establishing(k: number) {
    const pos = this.hunter.clone().addScaledVector(this.toH, 3.3 - k * 1.2).addScaledVector(this.right, 2.1).add(new THREE.Vector3(0, 2.1 - k * 0.4, 0));
    const look = this.anchor.clone().add(new THREE.Vector3(0, 1.0, 0));
    this.ccam.set(pos, look, 50 - k * 4, 0.02);
  }

  private chooseShot(rdt: number) {
    const c = this.presenterAt;
    const base = c.clone().addScaledVector(this.toH, 3.3).addScaledVector(this.right, 0.7).add(new THREE.Vector3(0, 1.45, 0));
    const look = c.clone().lerp(this.anchor.clone().add(new THREE.Vector3(0, 1.1, 0)), this.actors.length ? 0.3 : 0).add(new THREE.Vector3(0, 0.25, 0));
    // hovering leans the lens toward a thing (gently: a full push would slide the
    // others out from under the cursor); picking pushes all the way in on it
    const want = this.picked >= 0 ? this.picked : this.hovered;
    if (want >= 0) this.focusIdx = want;
    const goal = this.picked >= 0 ? 1 : this.hovered >= 0 ? 0.3 : 0;
    this.focusW += (goal - this.focusW) * Math.min(1, rdt * (this.picked >= 0 ? 5 : 2.6));
    if (this.focusIdx >= 0 && this.focusW > 0.001) {
      const o = this.opts[this.focusIdx];
      const near = o.focus.clone().addScaledVector(this.toH, o.kind === 'notice' ? 1.05 : 1.35).add(new THREE.Vector3(0, o.kind === 'notice' ? 0.12 : 0.75, 0));
      const e = ease(this.focusW);
      base.lerp(near, e * 0.9);
      look.lerp(o.focus, e);
    }
    this.ccam.set(base, look, 46 - this.focusW * 6, 0);
  }

  // ------------------------------------------------------------------ the scene
  update(rdt: number) {
    if (this.phase === 'gone') return;
    if ((window as any).__cineHold) rdt = 0; // dev: freeze the scene for a screenshot
    this.t += rdt;
    this.pt += rdt;
    const inp = this.input;
    const click = inp.wasPressed('Mouse0') || inp.wasPressed('Space') || inp.wasPressed('Enter');
    if (click) this.clickQueued = true;
    // actors live on real time (the world itself is paused)
    for (const a of this.actors) this.animActor(a, rdt);
    this.updateOpener(rdt);
    if (this.phase === 'intro') {
      this.establishing(ease(this.pt / 2.4));
      const dur = this.spec.opener ? 2.6 : 1.0;
      if (this.pt >= dur || (this.clickQueued && this.pt > 0.4 && (!this.spec.opener || this.boomDone))) this.next('lines');
    } else if (this.phase === 'lines') this.updateLines(rdt);
    else if (this.phase === 'choose') this.updateChoose(rdt);
    else if (this.phase === 'resolve') this.updateResolve(rdt);
    else if (this.phase === 'linger') this.updateLinger(rdt);
    this.clickQueued = false;
    if (this.ownCam) this.late(rdt);
  }

  /** after the camera is final: billboarded words */
  private late(rdt: number) {
    const cam = this.ctx.camera;
    // spoken words hang at a fixed distance from the lens, toward the speaker, so they read
    // the same in a close-up and a wide shot (as in the opening)
    for (const [t, w] of this.lensAt) t.anchor.copy(cam.position).addScaledVector(_v.copy(w).sub(cam.position).normalize(), 3.1);
    for (const t of this.texts) t.update(rdt, cam);
    try {
      this.line?.update(rdt, cam, (c, i, s) => this.speakingVoice && Voice.syllable(this.speakingVoice, c, { index: i, text: s, pos: this.speakingPos }));
    } catch (e) {
      console.warn('[stage] line failed', e);
    }
  }
  private lensAt = new Map<FloatText3D, THREE.Vector3>();
  private speakingVoice: VoiceId | null = null;
  private speaker: number | 'sundown' = 0;
  private speakingPos = new THREE.Vector3();

  private next(p: ChoiceStage['phase']) {
    this.phase = p;
    this.pt = 0;
    if (p === 'choose') {
      const n = this.options.length;
      this.hint.innerHTML = touchText(`${escapeHtml(this.heading)}<div style="font-size:15px;opacity:.8;margin-top:6px">press 1-${n}, click or tap${this.canCancel ? '  ·  ESC to walk away' : ''}</div>`);
      this.hint.style.display = 'block';
      this.opts.forEach((o, i) => (o.appear = -(0.12 + i * 0.14)));
      this.ctx.engine.audio.play('paper_flutter', { volume: 0.45 });
    }
  }

  private say(l: StageLine) {
    const who = l.who ?? 0;
    const head = this.headOf(who);
    const t = new FloatText3D(l.text, { size: 0.105, px: 60, cps: 34, wrap: 30, color: who === 'sundown' ? '#fff3d6' : '#ffe9c4', glow: who === 'sundown' ? '#ffb070' : '#d0803a', hdr: 1.3 });
    // beside the speaker's head (above it would leave the frame in a medium shot)
    const w = head.clone().add(new THREE.Vector3(0, 0.12, 0)).addScaledVector(this.right, who === 'sundown' ? -0.85 : 0.9);
    t.anchor.copy(w);
    this.lensAt.set(t, w);
    (t.mesh.material as THREE.MeshBasicMaterial).fog = false;
    this.ctx.scene.add(t.mesh);
    this.line = t;
    this.speaker = who;
    this.speakingVoice = who === 'sundown' ? 'sundown' : (this.actors[who as number]?.voice ?? 'outlaw');
    this.speakingPos.copy(head);
    const a = typeof who === 'number' ? this.actors[who] : null;
    if (a?.npc) a.npc.talk = 0.6 + l.text.length * 0.035;
    this.lineHold = 0.9 + l.text.length * 0.018;
  }

  private updateLines(rdt: number) {
    const cur = this.line;
    if (!cur) {
      const l = this.lineQ.shift();
      if (!l) return this.next('choose');
      this.say(l);
      this.pt = 0;
    }
    const l = this.line!;
    // camera on whoever speaks, over the listener's shoulder
    const who = this.speaker;
    const head = this.headOf(who);
    const other = who === 'sundown' ? this.headOf(0) : this.headOf('sundown');
    const dir = head.clone().sub(other).setY(0).normalize();
    // a medium shot of whoever speaks, from the listener's side, a little off-axis
    const near = who === 'sundown' ? 2.1 : this.actors[who as number]?.pinch ? 1.6 : 2.7;
    const pos = head.clone().addScaledVector(dir, -near).addScaledVector(new THREE.Vector3(-dir.z, 0, dir.x), near * 0.32).add(new THREE.Vector3(0, -0.12, 0));
    const look = head.clone().add(new THREE.Vector3(0, -0.15, 0));
    // the first line gets a slow push from the establishing shot
    this.ccam.set(pos, look, 40 - Math.min(1, this.pt / 3) * 3, 0);
    if (this.clickQueued) {
      if (!l.done) l.skipTyping();
      else this.lineHold = 0;
    }
    if (l.done) {
      this.lineHold -= rdt;
      if (this.lineHold <= 0) {
        l.show(false);
        this.texts.push(l); // keeps fading out, disposed with the stage
        this.line = null;
      }
    }
  }

  private updateChoose(rdt: number) {
    const inp = this.input;
    const n = this.opts.length;
    // the options appear one by one
    this.opts.forEach((o, i) => {
      if (o.appear === null) return;
      const k0 = o.appear;
      o.appear += rdt;
      if (k0 < 0 && o.appear >= 0) {
        o.root.visible = true;
        if (o.root.userData.x) o.root.userData.x.visible = true;
        o.label.show(true);
        this.kit?.sandPop(o.focus, o.kind === 'notice' ? 0.25 : 0.55);
        this.ctx.engine.audio.play(o.kind === 'notice' || o.kind === 'card' ? 'card_flip' : 'sand_burst', { volume: 0.45, pitch: 0.9 + i * 0.08 });
      }
    });
    const ready = this.pt > 0.25 + n * 0.14;
    // hover: the pointer over an object (or its label)
    _n.set(inp.ndcX, inp.ndcY);
    _r.setFromCamera(_n, this.ctx.camera);
    const pickables = this.opts.flatMap((o) => o.pick);
    const hit = _r.intersectObjects(pickables, true)[0];
    let h = -1;
    if (hit) h = this.opts.findIndex((o) => o.pick.some((p) => p === hit.object || isAncestor(p, hit.object)));
    if (h < 0) h = this.labelHit(_n);
    if (h !== this.hovered && h >= 0) this.ctx.engine.audio.play('card_hover', { volume: 0.45 });
    this.hovered = h;
    this.opts.forEach((o, i) => {
      o.hover += ((i === h ? 1 : 0) - o.hover) * Math.min(1, rdt * 10);
      o.label.hover = o.hover;
      o.detail.show(o.hover > 0.5);
      this.poseOpt(o, i, rdt);
    });
    this.chooseShot(rdt);
    if (!ready) return;
    for (let i = 0; i < n; i++) if (inp.wasPressed('Digit' + (i + 1)) || inp.wasPressed('Numpad' + (i + 1))) return this.pick(i);
    if (this.canCancel && inp.wasPressed('Escape')) return this.pick(-1);
    if (inp.wasPressed('Mouse0') && h >= 0) return this.pick(h);
  }

  /** labels are clickable too (screen-space distance to the label's centre) */
  private labelHit(ndc: THREE.Vector2) {
    let best = -1, bd = 0.08;
    this.opts.forEach((o, i) => {
      _v.copy(o.label.mesh.position).project(this.ctx.camera);
      const d = Math.hypot(_v.x - ndc.x, (_v.y - ndc.y) * 0.6);
      if (_v.z < 1 && d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** idle life of an option object: hovered ones lift toward you */
  private poseOpt(o: OptObj, i: number, rdt: number) {
    const tt = this.t + i * 1.3;
    if (o.kind === 'item') {
      o.root.position.copy(o.base).add(new THREE.Vector3(0, o.hover * 0.28 + Math.sin(tt * 2) * 0.01 * o.hover, 0));
      o.root.rotation.y += rdt * (0.2 + o.hover * 1.4);
    } else if (o.kind === 'notice') {
      // the sheet stirs on its nail in the wind, and lifts off the board when hovered
      o.root.position.copy(o.base).addScaledVector(this.toH, o.hover * 0.06);
      o.root.quaternion.copy(o.baseQ).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08 * o.hover + Math.sin(tt * 1.7) * 0.025, 0, Math.sin(tt * 1.1) * 0.03)));
    } else if (o.kind === 'card') {
      o.root.position.copy(o.base).add(new THREE.Vector3(0, o.hover * 0.06, 0));
    } else if (o.kind === 'mark' && o.word) {
      o.word.mat.userData.fx.value.z = o.hover * 1.4;
      o.word.update(rdt);
    }
  }

  private pick(i: number) {
    this.picked = i;
    this.hint.style.display = 'none';
    this.ctx.engine.audio.play(i >= 0 ? 'poster_slam' : 'paper_flutter', { volume: 0.7 });
    this.opts.forEach((o, k) => {
      if (k !== i) {
        o.label.show(false);
        o.detail.show(false);
      } else o.detail.show(true);
    });
    this.next('resolve');
  }

  private updateResolve(rdt: number) {
    const i = this.picked;
    const o = i >= 0 ? this.opts[i] : null;
    const k = sat(this.pt / 0.75);
    if (o) {
      if (o.kind === 'notice' || o.kind === 'card') {
        // torn off and carried toward the hunter
        const to = o.base.clone().addScaledVector(this.toH, 0.8).add(new THREE.Vector3(0, 0.25, 0));
        o.root.position.lerpVectors(o.base, to, ease(k));
        o.root.rotateZ(rdt * 1.5 * (1 - k));
        const u = ((o.root as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
        if (u?.uOpacity) u.uOpacity.value = 1 - sat((this.pt - 0.45) / 0.4);
      } else if (o.kind === 'item') {
        o.root.position.copy(o.base).add(new THREE.Vector3(0, 0.3 + ease(k) * 0.35, 0));
        o.root.rotation.y += rdt * 6;
        if (Math.random() < rdt * 30) this.kit?.particles.emit({ pos: o.root.position, count: 2, spread: 1, up: 0.6, life: [0.3, 0.7], size: [0.08, 0.015], sprite: ['star4', 'spark'], additive: true, color: [0xffffff, 0xffe39a], drag: 2, jitter: 0.15 });
        if (this.pt > 0.55) o.root.scale.setScalar(Math.max(0.001, 1 - sat((this.pt - 0.55) / 0.3)));
      } else if (o.kind === 'mark' && o.word) {
        o.word.mat.userData.fx.value.z = 2.5 * (1 - k);
        if (this.pt > 0.35 && !o.word.leaving) {
          o.word.leave('crumble');
          o.word.onCrumble = (at) => this.kit?.particles.emit({ pos: at, count: 1, vel: { x: 0, y: 0.8, z: 0 }, spread: 0.6, life: [0.4, 0.9], size: [0.05, 0.02], sprite: GRAIN, color: SAND, gravity: 4 });
        }
        o.word.update(rdt);
      }
    }
    // the others sink back into the sand / stay on the board
    this.opts.forEach((p, j) => {
      if (j === i) return;
      if (p.kind === 'item' || p.kind === 'mark') p.root.position.y = p.base.y - ease(k) * 0.6;
    });
    this.chooseShot(rdt);
    if (this.pt >= 0.8 && this.pt - rdt < 0.8) {
      const r = i >= 0 ? this.spec.replies?.[i] : null;
      if (r) this.say(r);
      const mode = i >= 0 ? this.spec.after?.[i] : null;
      if (mode) for (const a of this.actors) if (a.npc) a.npc.mode = mode;
    }
    if (this.line) {
      if (this.clickQueued) {
        if (!this.line.done) this.line.skipTyping();
        else this.lineHold = 0;
      }
      if (this.line.done) this.lineHold -= rdt;
    }
    const lineOver = !this.line || (this.line.done && this.lineHold <= 0);
    if (this.pt >= 0.95 && lineOver) this.finishScene(i);
  }

  private finishScene(i: number) {
    const eng = this.ctx.engine;
    this.line?.show(false);
    for (const t of this.texts) t.show(false);
    this.ccam.release(2);
    eng.letterbox(false, 0.5);
    this.cin?.hud?.setVisible(this.hudWas);
    this.phase = 'linger';
    this.pt = 0;
    this.linger = 0;
    // the actors go about their business (Pinch hops back on the hunter's shoulder)
    this.actors = this.actors.filter((a) => {
      if (!a.pinch) return true;
      this.kit?.sandPop({ x: a.pos.x, y: a.pos.y + 0.1, z: a.pos.z }, 0.6);
      a.pinch.root.removeFromParent();
      const sk = Skills.current;
      if (sk) sk.pinchRoot.visible = this.pinchWas;
      return false;
    });
    this.actors.forEach((a, k) => {
      if (a.npc && (a.npc.mode === 'sit' || a.npc.mode === 'dead')) return;
      const away = a.pos.clone().sub(this.hunter).setY(0).normalize();
      away.applyAxisAngle(UP, (k % 2 ? 1 : -1) * 0.6);
      a.walkOff = away;
    });
    this.done(i);
  }

  private updateLinger(rdt: number) {
    this.linger += rdt;
    const eng = this.ctx.engine;
    const dt = eng.paused ? 0 : rdt;
    for (const a of this.actors) {
      if (!a.npc || !a.walkOff) continue;
      if (this.linger > 1.6) {
        a.npc.mode = 'walk';
        a.npc.vel.copy(a.walkOff).multiplyScalar(1.3);
        a.npc.pos.addScaledVector(a.npc.vel, dt);
        a.npc.pos.y = this.ground(a.npc.pos.x, a.npc.pos.z);
        a.npc.yaw = Math.atan2(a.walkOff.x, a.walkOff.z);
      }
    }
    // leave once out of the hunter's way (or after a while), in a puff of dust
    const far = this.cin ? this.cin.player.pos.distanceTo(this.anchor) > 38 : true;
    if ((this.linger > 9 && far) || this.linger > 40) this.dispose();
  }

  private animActor(a: Actor, rdt: number) {
    if (a.npc) {
      if (this.phase !== 'linger') a.npc.look = this.headOf('sundown');
      a.npc.update(rdt);
      return;
    }
    if (a.pinch) {
      // Pinch digs: pincers scoop, the tail flicks, sand flies
      const n = a.pinch.nodes, T = this.t;
      for (let k = 1; k <= 5; k++) n['tail' + k]?.rotation.set(-0.35 - Math.sin(T * 6 + k) * 0.12, 0, Math.sin(T * 3 + k) * 0.05);
      n['arm_l']?.rotation.set(0.5 + Math.sin(T * 11) * 0.45, 0, 0);
      n['arm_r']?.rotation.set(0.5 + Math.sin(T * 11 + Math.PI) * 0.45, 0, 0);
      n['pincer_l']?.rotation.set(0, -Math.max(0, Math.sin(T * 11)) * 0.6, 0);
      n['pincer_r']?.rotation.set(0, Math.max(0, Math.sin(T * 11 + 1)) * 0.6, 0);
      for (let k = 1; k <= 4; k++) {
        n['leg_l' + k]?.rotation.set(0, 0, Math.sin(T * 14 + k) * 0.12);
        n['leg_r' + k]?.rotation.set(0, 0, -Math.sin(T * 14 + k) * 0.12);
      }
      a.pinch.root.position.y = a.pos.y + Math.abs(Math.sin(T * 11)) * 0.02;
      if (this.phase !== 'linger' && Math.random() < rdt * 18)
        this.kit?.particles.emit({ pos: { x: a.pos.x, y: a.pos.y + 0.05, z: a.pos.z }, count: 3, vel: { x: -this.toH.x * 2, y: 2.4, z: -this.toH.z * 2 }, spread: 1.4, life: [0.4, 0.8], size: [0.05, 0.04], sprite: GRAIN, color: SAND, gravity: 10, ground: true });
    }
  }

  // ------------------------------------------------------------------ the opener: dynamite
  private updateOpener(rdt: number) {
    if (this.spec.opener !== 'dynamite' || this.boomDone || this.phase !== 'intro') return;
    const target = this.props.find((p) => p.blast);
    const thrower = this.actors[1] ?? this.actors[0];
    if (!target || !thrower) {
      this.boomDone = true;
      return;
    }
    if (!this.dyn && this.pt > 0.45) {
      if (thrower.npc) thrower.npc.mode = 'wave';
      const sm = staticModel('dynamite', this.mat) ?? staticModel('item_dynamite', this.mat);
      const holder = new THREE.Group();
      if (sm) {
        const sz = sm.box.getSize(_v);
        sm.mesh.scale.setScalar(0.32 / Math.max(sz.x, sz.y, sz.z, 1e-3));
        holder.add(sm.mesh);
      }
      const from = this.headOf(this.actors.indexOf(thrower)).add(new THREE.Vector3(0, 0.25, 0));
      const to = target.mesh.position.clone().add(new THREE.Vector3(0, 0.9, 0));
      holder.position.copy(from);
      this.group.add(holder);
      this.dyn = { mesh: holder, from, to, t: 0 };
      this.ctx.engine.audio.play('dynamite_fuse', { pos: from, volume: 0.8 });
    }
    if (this.dyn) {
      const d = this.dyn;
      d.t += rdt;
      const k = sat(d.t / 0.8);
      d.mesh.position.lerpVectors(d.from, d.to, k);
      d.mesh.position.y += Math.sin(k * Math.PI) * 2.2;
      d.mesh.rotation.set(d.t * 9, d.t * 5, 0);
      this.kit?.particles.emit({ pos: d.mesh.position, count: 2, spread: 1.2, life: [0.15, 0.35], size: [0.06, 0.01], sprite: 'spark', additive: true, color: [0xfff0b0, 0xffa040], drag: 2 });
      if (k >= 1) {
        d.mesh.removeFromParent();
        this.dyn = null;
        this.boom(target);
      }
    }
  }

  private boom(target: { mesh: THREE.Mesh; model: VoxelModel; vs: number; pivot: [number, number, number] }) {
    this.boomDone = true;
    const kit = this.kit;
    const at = target.mesh.position.clone();
    target.mesh.updateMatrixWorld(true);
    if (kit) {
      kit.debris.shatter(target.model, target.vs, target.mesh.matrixWorld.clone(), target.pivot, { chunk: 4, speed: 11, max: 240, up: 7 });
      kit.blast({ x: at.x, y: at.y + 0.4, z: at.z }, 3.2, { wood: true, debris: 60 });
      kit.burn({ x: at.x, y: at.y + 0.2, z: at.z }, 2.4, 30);
    }
    target.mesh.visible = false;
    this.ccam.shake(0.85);
    for (const a of this.actors) if (a.npc) a.npc.mode = 'cheer';
    setTimeout(() => {
      for (const a of this.actors) if (a.npc && this.phase !== 'linger') a.npc.mode = 'idle';
    }, 1600);
  }

  // ------------------------------------------------------------------ hooks for callers
  /** where the actors stand (e.g. to swap staged outlaws for real ones) */
  actorSpots() {
    return this.actors.map((a) => a.pos.clone());
  }
  /** the actors vanish in a puff of dust (real enemies take their place) */
  dismissActors() {
    for (const a of this.actors) {
      this.kit?.sandPop({ x: a.pos.x, y: a.pos.y + 0.3, z: a.pos.z }, 1.1);
      a.npc?.dispose();
      a.pinch?.root.removeFromParent();
    }
    this.actors = [];
  }

  dispose() {
    if (this.phase === 'gone') return;
    if (this.phase !== 'linger') {
      this.ccam.release(2);
      this.ctx.engine.letterbox(false, 0.4);
      this.cin?.hud?.setVisible(this.hudWas);
    }
    this.phase = 'gone';
    for (const a of this.actors) {
      if (this.kit) this.kit.sandPop({ x: a.pos.x, y: a.pos.y + 0.3, z: a.pos.z }, 0.9);
      a.npc?.dispose();
    }
    this.actors = [];
    const sk = Skills.current;
    if (sk && this.spec.actors?.some((a) => a.rig === 'pinch')) sk.pinchRoot.visible = this.pinchWas;
    for (const t of this.texts) t.dispose();
    this.line?.dispose();
    for (const o of this.opts) {
      o.word?.dispose();
      if (o.notice) {
        const m = o.notice.material as THREE.ShaderMaterial;
        (m.uniforms?.map?.value as THREE.Texture | undefined)?.dispose();
        if (m.uniforms?.uHasStamp?.value > 0.5) (m.uniforms.uStampMap.value as THREE.Texture | undefined)?.dispose();
        m.dispose();
        o.notice.geometry.dispose();
      }
    }
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !(m.material instanceof THREE.ShaderMaterial)) m.geometry.dispose();
    });
    this.group.removeFromParent();
    this.mat.dispose();
    this.hint.remove();
    this.cin?.late.delete(this.lateFn);
    if (this.ownCam) {
      const list = this.ctx.engine.onAfterUpdate;
      setTimeout(() => {
        const i = list.indexOf(this.ownTick);
        if (i >= 0) list.splice(i, 1);
      }, 0);
    }
  }
}

function isAncestor(a: THREE.Object3D, b: THREE.Object3D) {
  for (let o: THREE.Object3D | null = b; o; o = o.parent) if (o === a) return true;
  return false;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** the gist of an option title for a word scratched into the sand */
function shortWord(title: string) {
  const w = title.replace(/[^A-Za-z' ]/g, '').split(' ').filter(Boolean);
  const skip = new Set(['the', 'a', 'an', 'your', 'him', 'his', 'to', 'of', 'on', 'with', 'them']);
  const keep = w.filter((x) => !skip.has(x.toLowerCase()));
  return (keep[0] ?? w[0] ?? title).slice(0, 9);
}
