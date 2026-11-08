// THOTH'S HALL: where the codex lives now. Thoth (ibis-headed, very small, ten thousand
// and three, talks like a child) keeps everything the hunter has ever met in his library:
// a long nave of sandstone and gold under a starry lapis vault, papyrus columns, cedar
// bookcases to the ceiling, a gallery with rolling ladders, books that fly about, bronze
// lamps on chains, bookworm librarians at work. Every codex section is a wing: a bay of
// shelves with a specimen stand of glass bell jars, one jar per entry (a dusty sheet over
// the ones nobody has found yet), and a pedestal where Thoth sets the one you are looking
// at, alive. A pixel-art sheet tells its story; THOTH'S STUDY turns what you have done
// out there into a study you can complete, and finished studies earn Thoth's gifts. At his
// desk at the end of the hall he keeps the gift ladder and hands out errands.
//
// Opened wherever the codex used to open (the hideout's Book of Skills, CodexBook is now
// this) and from the main menu's sign. The host hands over its scene and camera; the hall
// swaps the post stack to its own and back on close. Touch: taps are clicks, swipes page.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import { touchScreen } from '../../engine/Input';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, sharedVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { Particles } from '../fx/Particles';
import { Codex, CodexCat, CodexEntry, CodexSection, F_CLAIM, F_READ, F_SEEN } from '../meta/Codex';
import { Research, GIFTS, giftName, giftModel, Errand } from '../meta/Research';
import { modelEntry } from '../models/lookup';
import { CONSUMABLES } from '../models/characters/consumables';
import { ThothAnim, ThothMode } from '../models/characters/thoth';
import { BookwormAnim, BookwormMode } from '../models/creatures/bookworm';
import { Puppet } from '../ui/codex/Puppet';
import { entryPuppet, placeProps, plateMound } from '../ui/codex/Plate';
import * as HM from './thoth/HallModels';
import { HallUI, HallUIState, PanelData, ErrandSlip } from './thoth/HallUI';
import { TALK, say, aboutEntry } from './thoth/ThothTalk';

export interface ThothHallOpts {
  hero: RigSpec | null;
  /** the scene and camera to hand the screen back to */
  back: { scene: THREE.Scene; camera: THREE.Camera };
  onClosed: () => void;
  /** opened from the main menu's sign (a different hello) */
  from?: 'menu' | 'hub';
}

type View = 'nave' | 'wing' | 'desk';
const PER_PAGE = 10;
const JAR_SCALE = 1.25;
const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const SHORT: Record<CodexCat, string> = { bounty: 'BOUNTIES', boss: 'BOSSES', wildlife: 'WILDLIFE', loot: 'LOOT', blueprint: 'PLANS', place: 'PLACES', legend: 'LEGENDS' };

/** each codex section's wing: which side of the nave, its bay centre */
const WING_PLAN: { cat: CodexCat; side: -1 | 0 | 1; z: number; x?: number }[] = [
  { cat: 'bounty', side: -1, z: HM.HALL.BAYS[0] },
  { cat: 'boss', side: -1, z: HM.HALL.BAYS[1] },
  { cat: 'wildlife', side: -1, z: HM.HALL.BAYS[2] },
  { cat: 'loot', side: 1, z: HM.HALL.BAYS[0] },
  { cat: 'blueprint', side: 1, z: HM.HALL.BAYS[1] },
  { cat: 'place', side: 1, z: HM.HALL.BAYS[2] },
  { cat: 'legend', side: 0, z: -10.3, x: -0.7 },
];
const APSE_Y = 1 / 12;

// ---------------------------------------------------------------- shared geometry (kept warm between visits)
const GEO = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => HM.Built) {
  let g = GEO.get(key);
  if (!g) {
    const b = make();
    g = buildVoxelGeometry(b.model, { voxelSize: b.voxelSize, pivot: b.pivot });
    GEO.set(key, g);
  }
  return g;
}
let WALLS: THREE.BufferGeometry[] | null = null;
const HM_WALLS = () => (WALLS ??= HM.hallWalls().map((b) => buildVoxelGeometry(b.model, { voxelSize: b.voxelSize, pivot: b.pivot })));
let STAND_SLOTS: HM.V3[] = [];
let PED_TOP = 0.9;
let DESK_META: ReturnType<typeof HM.thothDesk>['meta'] | null = null;

interface Jar {
  root: THREE.Group;
  base: THREE.Mesh;
  glass: THREE.Mesh;
  sheet: THREE.Mesh;
  holder: THREE.Group;
  hit: THREE.Mesh;
  key: string | null;
  shown: string | null;
  puppet: Puppet | null;
  extra: THREE.Object3D | null;
  lift: number;
}
interface Wing {
  i: number;
  sec: CodexSection;
  side: -1 | 0 | 1;
  fwd: THREE.Vector3;
  right: THREE.Vector3;
  standPos: THREE.Vector3;
  floor: number;
  stand: THREE.Mesh;
  ped: THREE.Mesh;
  pedPos: THREE.Vector3;
  arch: THREE.Mesh;
  jars: Jar[];
  page: number;
  sel: number;
}
interface Walker {
  rig: RigInstance;
  th: ThothAnim | null;
  bw: BookwormAnim | null;
  pos: THREE.Vector3;
  yaw: number;
  /** waypoints to walk (the last is the goal) */
  path: THREE.Vector3[];
  goalKey: string;
  face: number | null;
  speed: number;
  /** a gesture to play when standing (mode, seconds left) */
  gest: { mode: ThothMode | BookwormMode; t: number } | null;
  job?: string;
  t: number;
  /** standing on something (the stool): its height over the floor */
  perch: number;
}
interface Book {
  rig: RigInstance;
  c: THREE.Vector3;
  r: THREE.Vector3;
  f: THREE.Vector3;
  ph: number;
  flap: number;
  prev: THREE.Vector3;
  flip: number;
}

export class ThothHall {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
  private state: 'idle' | 'open' | 'closing' | 'done' = 'idle';
  private view: View = 'nave';
  private wing = -1;
  private wings: Wing[] = [];
  private ui!: HallUI;
  private particles = new Particles();
  private glassMat: VoxelMaterial;
  private silMat = new THREE.MeshBasicMaterial({ visible: false });
  private ray = new THREE.Raycaster();
  private camPos = new THREE.Vector3(0, 2.4, 8.6);
  private camLook = new THREE.Vector3(0, 3, 0);
  private goalPos = new THREE.Vector3();
  private goalLook = new THREE.Vector3();
  private par = new THREE.Vector2();
  private t = 0;
  // pointer
  private ptr = { x: -1, y: -1, down: false, sx: 0, sy: 0, moved: 0, touch: false, has: false };
  private clicks: { x: number; y: number }[] = [];
  private swipe = 0;
  private hoverId = '';
  private tip: HallUIState['tip'] = null;
  // life
  private thoth: Walker | null = null;
  private worms: Walker[] = [];
  private books: Book[] = [];
  private ladders: { rig: RigInstance; side: number; z: number; v: number; goal: number; wait: number }[] = [];
  private lamps: { rig: RigInstance; light: THREE.PointLight; flames: THREE.Vector3[]; ph: number }[] = [];
  private deskLight!: THREE.PointLight;
  private jarLight!: THREE.PointLight;
  private pedLight!: THREE.SpotLight;
  private moon!: THREE.DirectionalLight;
  private deskGroup = new THREE.Group();
  private deskHit!: THREE.Mesh;
  private thothHit!: THREE.Mesh;
  private giftShow: { key: string; p: Puppet | null } = { key: '', p: null };
  private ped: { key: string; obj: THREE.Object3D | null; puppet: Puppet | null; k: number } = { key: '', obj: null, puppet: null, k: 0 };
  private buildQ: Jar[] = [];
  // talk
  private talkText: string | null = null;
  private talkLeft = 0;
  private idleTalk = 18;
  private banner: HallUIState['banner'] = null;
  private errSkip = 0;
  private postSaved: { strength?: number; threshold?: number; vignette?: number } = {};
  private onPDown = (e: PointerEvent) => this.pDown(e);
  private onPMove = (e: PointerEvent) => this.pMove(e);
  private onPUp = (e: PointerEvent) => this.pUp(e);

  constructor(private engine: Engine, private o: ThothHallOpts) {
    this.glassMat = makeVoxelMaterial({ transparent: true, opacity: 0.13, roughness: 0.05 });
    this.glassMat.depthWrite = false;
    (this.glassMat.userData.emissiveStrength as { value: number }).value = 0;
  }

  // ======================================================================= build
  private build() {
    const s = this.scene;
    const H = HM.HALL;
    s.background = new THREE.Color(0x07060c);
    s.fog = new THREE.Fog(0x161428, 18, 52);
    // ---- light: a cool moon from the high windows, a warm bounce, lamps on chains
    s.add(new THREE.HemisphereLight(0x7080c8, 0x7a4a26, 1.05));
    this.moon = new THREE.DirectionalLight(0xa8c0ff, 1.15);
    this.moon.position.set(7, 16, 4);
    this.moon.target.position.set(0, 0, -1);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.03;
    const sc = this.moon.shadow.camera;
    sc.left = -9;
    sc.right = 9;
    sc.top = 13;
    sc.bottom = -13;
    sc.near = 2;
    sc.far = 40;
    s.add(this.moon, this.moon.target);
    s.add(this.particles.group);
    // ---- the shell
    const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0, shadow = true): THREE.Mesh => {
      const m = new THREE.Mesh(g, sharedVoxelMaterial);
      m.position.set(x, y, z);
      m.rotation.y = yaw;
      m.castShadow = shadow;
      m.receiveShadow = true;
      s.add(m);
      return m;
    };
    place(geo('floor', HM.hallFloor), 0, 0, 0, 0, false);
    place(geo('vault', HM.hallVault), 0, 0, 0, 0, false);
    const walls = HM_WALLS();
    walls.forEach((g) => place(g, 0, 0, 0, 0, false));
    // columns on every pier's nave face
    const col = geo('column', () => HM.papyrusColumn(0));
    for (const [z0, z1] of H.PIERS) for (const sd of [-1, 1]) place(col, sd * (H.NX + 0.05), 0, (z0 + z1) / 2);
    // bookcases: bay back walls, bay side walls, the apse
    const bcW = [0, 1, 2].map((k) => geo('bc20_' + k, () => HM.bookcase(2.0, 3.2, 11 + k, { scrolls: k === 1 })));
    const bcS = [0, 1].map((k) => geo('bc17_' + k, () => HM.bookcase(1.7, 3.2, 21 + k, { scrolls: k === 0 })));
    const bcA = [0, 1].map((k) => geo('bc23_' + k, () => HM.bookcase(2.3, 3.2, 31 + k, { scrolls: k === 1 })));
    let n = 0;
    const D2 = 0.23;
    for (const sd of [-1, 1])
      for (const zc of H.BAYS)
        for (let lvl = 0; lvl < 2; lvl++) {
          const y = lvl * 3.2;
          for (const dz of [-1, 1]) place(bcW[n++ % 3], sd * (H.NX + H.BAY_D - D2), y, zc + dz, -sd * Math.PI / 2, false);
          for (const [zs, yaw] of [[zc + 2.17, Math.PI], [zc - 2.17, 0]] as const)
            for (const dx of [0.85, 2.55]) place(bcS[n++ % 2], sd * (H.NX + dx), y, zs, yaw, false);
        }
    for (let lvl = 0; lvl < 2; lvl++) {
      for (const sd of [-1, 1]) place(bcW[n++ % 3], sd * 3.35, APSE_Y + lvl * 3.2, H.APSE_Z + D2, 0, false);
      for (const sd of [-1, 1]) for (const z of [-7.55, -9.85]) place(bcA[n++ % 2], sd * (H.APSE_X - D2), APSE_Y + lvl * 3.2, z, -sd * Math.PI / 2, false);
    }
    // the moon on the apse wall, the ibis statues at the apse's mouth
    const moonM = place(geo('moon', HM.moonRoundel), 0, 4.55, H.APSE_Z + 0.02, 0, false);
    moonM.castShadow = false;
    try {
      const st = modelEntry('statue_thoth')?.() as any;
      if (st?.model) {
        const g = geo('statue_thoth', () => ({ model: st.model, voxelSize: st.voxelSize, pivot: 'bottom' }));
        g.computeBoundingBox();
        const hgt = g.boundingBox!.max.y - g.boundingBox!.min.y;
        for (const sd of [-1, 1]) {
          const m = place(g, sd * 3.55, APSE_Y, -6.95, -sd * 0.55);
          m.scale.setScalar(2.7 / Math.max(0.5, hgt));
        }
      }
    } catch (e) {
      console.warn('[hall] statue', e);
    }
    // rugs in the bays and before the desk
    const rugG = geo('rug', () => HM.rug(2.4, 3.0, 4));
    for (const sd of [-1, 1]) for (const zc of H.BAYS) place(rugG, sd * 4.55, 0.002, zc, Math.PI / 2, false);
    // ---- the desk
    const dk = HM.thothDesk();
    DESK_META = dk.meta;
    const deskM = new THREE.Mesh(geo('desk', () => dk), sharedVoxelMaterial);
    deskM.castShadow = deskM.receiveShadow = true;
    this.deskGroup.add(deskM);
    this.deskGroup.position.set(2.75, APSE_Y, -9.45);
    this.deskGroup.rotation.y = -0.42;
    s.add(this.deskGroup);
    this.deskLight = new THREE.PointLight(0xffb060, 3.2, 5, 2);
    this.deskLight.position.set(...dk.meta.flame);
    this.deskGroup.add(this.deskLight);
    this.deskHit = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.3, 1.2), this.silMat);
    this.deskHit.position.set(0, 0.65, 0);
    this.deskGroup.add(this.deskHit);
    // ---- the wings
    const standG = geo('stand', () => {
      const b = HM.jarStand(1);
      STAND_SLOTS = b.slots;
      return b;
    });
    if (!STAND_SLOTS.length) STAND_SLOTS = HM.jarStand(1).slots;
    const pedG = geo('pedestal', () => {
      const b = HM.pedestal();
      PED_TOP = b.top;
      return b;
    });
    if (PED_TOP === 0.9) PED_TOP = HM.pedestal().top;
    const baseG = geo('jar_base', HM.jarBase), glassG = geo('jar_glass', HM.jarGlass);
    const sheetG = [0, 1, 2].map((k) => geo('sheet' + k, () => HM.dustSheet(k * 3 + 1)));
    const secs = Codex.sections();
    WING_PLAN.forEach((wp, i) => {
      const sec = secs.find((x) => x.cat === wp.cat)!;
      const fwd = wp.side === 0 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(wp.side, 0, 0);
      const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
      const floor = wp.side === 0 ? APSE_Y : 0;
      const standPos = wp.side === 0 ? new THREE.Vector3(wp.x ?? 0, floor, wp.z) : new THREE.Vector3(wp.side * 5.35, floor, wp.z);
      const yaw = wp.side === 0 ? 0 : -wp.side * Math.PI / 2;
      const stand = place(standG, standPos.x, standPos.y, standPos.z, yaw);
      const pedPos = standPos.clone().addScaledVector(fwd, -1.3).addScaledVector(right, -1.2);
      if (wp.side === 0) pedPos.set(-2.55, floor, -8.7);
      const ped = place(pedG, pedPos.x, pedPos.y, pedPos.z, yaw);
      const arch = new THREE.Mesh(new THREE.BoxGeometry(wp.side === 0 ? 7.5 : 0.3, 3.2, wp.side === 0 ? 0.3 : 3.8), this.silMat);
      arch.position.set(wp.side === 0 ? 0 : wp.side * 3.2, 1.6, wp.side === 0 ? -6.6 : wp.z);
      s.add(arch);
      const jars: Jar[] = [];
      const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
      STAND_SLOTS.forEach((sl, k) => {
        const root = new THREE.Group();
        const p = new THREE.Vector3(sl[0], sl[1], sl[2]).applyQuaternion(q).add(standPos);
        root.position.copy(p);
        root.rotation.y = yaw;
        root.scale.setScalar(JAR_SCALE);
        const base = new THREE.Mesh(baseG, sharedVoxelMaterial);
        base.castShadow = base.receiveShadow = true;
        const glass = new THREE.Mesh(glassG, this.glassMat);
        glass.renderOrder = 2;
        const sheet = new THREE.Mesh(sheetG[(k + i) % 3], sharedVoxelMaterial);
        sheet.receiveShadow = true;
        sheet.rotation.y = (k * 1.7 + i) % 6.28;
        const holder = new THREE.Group();
        holder.position.y = 5 / 32;
        const hit = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.8, 0.42), this.silMat);
        hit.position.y = 0.36;
        root.add(base, glass, sheet, holder, hit);
        s.add(root);
        jars.push({ root, base, glass, sheet, holder, hit, key: null, shown: null, puppet: null, extra: null, lift: 0 });
      });
      const firstFresh = sec.entries.findIndex((e) => {
        const f = Codex.flags(e.key);
        return f && !(f & F_READ);
      });
      this.wings.push({ i, sec, side: wp.side, fwd, right, standPos, floor, stand, ped, pedPos, arch, jars, page: 0, sel: Math.max(0, firstFresh) });
      this.fillJars(this.wings[i], false);
    });
    // ---- lamps on chains down the nave
    for (const [z, len] of [[6, 4.6], [1.2, 4.9], [-3.6, 4.6], [-8.6, 4.2]] as const) {
      const spec = HM.hangingLampRig(len);
      const rig = new RigInstance(buildRigGeo(spec, 'hall:lamp:' + len), { castShadow: false });
      rig.root.position.set(0, H.CEIL + H.VAULT_R - 0.05, z);
      s.add(rig.root);
      const light = new THREE.PointLight(0xffa050, 9, 13, 1.6);
      light.position.set(0, -0.4, 0);
      rig.nodes['lamp'].add(light);
      this.lamps.push({ rig, light, flames: (spec.meta!.flames as HM.V3[]).map((f) => new THREE.Vector3(...f)), ph: z });
    }
    // a warm light over the jar you have picked, a spot on the pedestal
    this.jarLight = new THREE.PointLight(0xffd090, 0, 2.2, 2);
    s.add(this.jarLight);
    this.pedLight = new THREE.SpotLight(0xffd8a0, 0, 7, 0.42, 0.6, 1.5);
    s.add(this.pedLight, this.pedLight.target);
    // ---- rolling ladders on the gallery rail
    for (const sd of [-1, 1]) {
      const rig = new RigInstance(buildRigGeo(HM.ladderRig(3.9), 'hall:ladder'));
      rig.root.rotation.order = 'YXZ';
      rig.root.rotation.set(-0.25, sd < 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      s.add(rig.root);
      this.ladders.push({ rig, side: sd, z: sd < 0 ? 4 : -2, v: 0, goal: sd < 0 ? 4 : -2, wait: 2 + Math.random() * 3 });
    }
    // ---- flying books
    for (let k = 0; k < 9; k++) {
      const rig = new RigInstance(buildRigGeo(HM.flyingBookRig(k % 5), 'hall:book:' + (k % 5)));
      rig.root.scale.setScalar(1.15);
      s.add(rig.root);
      const c = new THREE.Vector3((Math.random() - 0.5) * 2.4, 5.2 + Math.random() * 1.6, 7 - k * 1.9);
      this.books.push({ rig, c, r: new THREE.Vector3(0.9 + Math.random() * 1.2, 0.35 + Math.random() * 0.4, 1.1 + Math.random() * 1.3), f: new THREE.Vector3(0.11 + Math.random() * 0.08, 0.23 + Math.random() * 0.1, 0.09 + Math.random() * 0.06), ph: Math.random() * 10, flap: Math.random() * 6, prev: c.clone(), flip: -1 });
    }
    // ---- Thoth and the bookworms (their models come from the registry; absent → the hall carries on)
    this.thoth = this.walker('thoth', new THREE.Vector3(0.9, 0, 5.4));
    this.thothHit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.95, 0.6), this.silMat);
    this.thothHit.position.y = 0.47;
    if (this.thoth) this.thoth.rig.root.add(this.thothHit);
    const wormJobs: [string, string][] = [['gallery', 'bookworm'], ['ladder', 'bookworm_elder'], ['desk', 'bookworm_archivist'], ['shelf', 'bookworm_apprentice']];
    wormJobs.forEach(([job, key], k) => {
      const w = this.walker(key, new THREE.Vector3(0, 0, 0), k + 2);
      if (!w) return;
      w.job = job;
      if (job === 'gallery') w.pos.set(HM.HALL.NX + 0.3, HM.HALL.GALLERY + 1 / 12, 5);
      this.worms.push(w);
    });
    // ---- the screen
    this.ui = new HallUI(this.engine.overlay);
  }

  /** a character from the registry as a walker, with its own animator (null when its model is missing) */
  private walker(key: string, at: THREE.Vector3, seed = 3): Walker | null {
    let spec: RigSpec | null = null;
    try {
      const r = modelEntry(key)?.() as RigSpec | undefined;
      if (r?.parts) spec = r;
    } catch (e) {
      console.warn('[hall] model', key, e);
    }
    if (!spec) return null;
    const rig = new RigInstance(buildRigGeo(spec, 'hall:' + key));
    rig.root.position.copy(at);
    this.scene.add(rig.root);
    const isWorm = spec.meta?.kind === 'bookworm' || key.startsWith('bookworm');
    return {
      rig,
      th: isWorm ? null : new ThothAnim(rig, seed),
      bw: isWorm ? new BookwormAnim(rig, seed) : null,
      pos: at.clone(),
      yaw: Math.PI,
      path: [],
      goalKey: '',
      face: null,
      speed: isWorm ? 0.22 : 1.9,
      gest: null,
      t: Math.random() * 10,
      perch: 0,
    };
  }

  // ======================================================================= jars
  private entriesOn(w: Wing) {
    return w.sec.entries.slice(w.page * PER_PAGE, w.page * PER_PAGE + PER_PAGE);
  }
  private pages(w: Wing) {
    return Math.max(1, Math.ceil(w.sec.entries.length / PER_PAGE));
  }
  /** set every jar of a wing to its entry on the current page (puppets are built a few a frame) */
  private fillJars(w: Wing, urgent: boolean) {
    const es = this.entriesOn(w);
    w.jars.forEach((j, k) => {
      const e = es[k] ?? null;
      j.key = e?.key ?? null;
      j.root.visible = !!e;
      const known = !!e && Codex.known(e.key);
      j.sheet.visible = !!e && !known;
      j.glass.visible = !!e && known;
      if (j.shown !== (known ? j.key : null)) {
        this.clearJar(j);
        if (known) {
          if (urgent) this.buildQ.unshift(j);
          else this.buildQ.push(j);
        }
      }
    });
  }
  private clearJar(j: Jar) {
    j.puppet?.dispose();
    j.puppet = null;
    if (j.extra) {
      j.extra.removeFromParent();
      j.extra.traverse((o) => (o as THREE.Mesh).userData?.own && (o as THREE.Mesh).geometry.dispose());
    }
    j.extra = null;
    j.shown = null;
  }
  /** a specimen to fit in a box (height h, radius r): a puppet, or a place's miniature */
  private specimen(e: CodexEntry, h: number, r: number): { obj: THREE.Object3D; puppet: Puppet | null } | null {
    let obj: THREE.Object3D | null = null;
    let puppet: Puppet | null = null;
    if (e.theme) {
      const g = new THREE.Group();
      const mound = new THREE.Mesh(plateMound(), sharedVoxelMaterial);
      mound.receiveShadow = mound.castShadow = true;
      g.add(mound, ...placeProps(e.theme));
      obj = g;
    } else {
      puppet = entryPuppet(e, this.o.hero);
      if (puppet?.mode === 'spin') puppet.root.rotation.y = 0.6;
      obj = puppet?.root ?? null;
    }
    if (!obj) return null;
    puppet?.update(0.016);
    obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);
    if (bb.isEmpty()) return { obj, puppet };
    const size = bb.getSize(new THREE.Vector3());
    const k = Math.min(h / Math.max(0.01, size.y), (r * 2) / Math.max(0.01, Math.max(size.x, size.z)), 3);
    const wrap = new THREE.Group();
    wrap.add(obj);
    obj.position.y -= bb.min.y;
    wrap.scale.setScalar(k);
    return { obj: wrap, puppet };
  }
  private buildSome(budgetMs: number) {
    const t0 = performance.now();
    while (this.buildQ.length && performance.now() - t0 < budgetMs) {
      const j = this.buildQ.shift()!;
      if (!j.key || !Codex.known(j.key) || j.shown === j.key) continue;
      const e = Codex.entry(j.key)!;
      try {
        const sp = this.specimen(e, 0.5, 0.17);
        if (sp) {
          j.holder.add(sp.obj);
          j.extra = sp.obj;
          j.puppet = sp.puppet;
        }
      } catch (err) {
        console.warn('[hall] jar', e.key, err);
      }
      j.shown = j.key;
    }
  }

  // ======================================================================= open / close
  async open() {
    const eng = this.engine;
    eng.audio.play('book_open', { volume: 0.6, pitch: 0.85 });
    await eng.fadeOut(0.35);
    try {
      this.build();
    } catch (e) {
      console.error('[hall] build failed', e);
    }
    const post: any = eng.post;
    if (post?.bloom) {
      this.postSaved.strength = post.bloom.strength;
      this.postSaved.threshold = post.bloom.threshold;
      post.bloom.strength = 0.32;
      post.bloom.threshold = 0.95;
    }
    if (post?.u?.uVignette) {
      this.postSaved.vignette = post.u.uVignette.value;
      post.u.uVignette.value = 0.42;
    }
    eng.post.setSceneCamera(this.scene, this.camera);
    eng.input.setWantLock(false);
    this.state = 'open';
    this.ptr.touch = touchScreen();
    window.addEventListener('pointerdown', this.onPDown);
    window.addEventListener('pointermove', this.onPMove);
    window.addEventListener('pointerup', this.onPUp);
    this.setView('nave', true);
    this.camPos.set(0.2, 2.6, 8.6);
    this.camLook.set(0, 3.2, 0);
    this.talk(say(this.o.from === 'menu' ? TALK.helloMenu : TALK.hello), 7);
    (window as any).__hall = this;
    this.buildSome(60);
    void eng.fadeIn(0.6);
  }

  close() {
    if (this.state !== 'open') return;
    this.state = 'closing';
    this.talk(say(TALK.bye), 3);
    this.engine.audio.play('book_close', { volume: 0.7 });
    document.body.style.cursor = 'default';
    void this.finishClose();
  }

  private async finishClose() {
    const eng = this.engine;
    await eng.fadeOut(0.4);
    this.state = 'done';
    this.restorePost();
    eng.post.setSceneCamera(this.o.back.scene, this.o.back.camera);
    this.ui.canvas.style.display = 'none';
    void eng.fadeIn(0.45);
    this.o.onClosed();
  }

  private restorePost() {
    const post: any = this.engine.post;
    if (this.postSaved.strength !== undefined && post?.bloom) {
      post.bloom.strength = this.postSaved.strength;
      post.bloom.threshold = this.postSaved.threshold;
      this.postSaved.strength = undefined;
    }
    if (this.postSaved.vignette !== undefined && post?.u?.uVignette) {
      post.u.uVignette.value = this.postSaved.vignette;
      this.postSaved.vignette = undefined;
    }
  }

  // ======================================================================= views
  private setView(v: View, quiet = false, wing = -1) {
    this.view = v;
    this.wing = v === 'wing' ? wing : -1;
    if (v === 'wing') {
      const w = this.wings[wing];
      w.page = Math.floor(w.sel / PER_PAGE);
      this.fillJars(w, true);
      if (!quiet) {
        this.engine.audio.play('page_turn', { volume: 0.5, pitch: 0.9 });
        this.talk(say(TALK.wing[w.sec.cat]), 6);
      }
      this.select(w.sel, true);
    } else {
      this.ped.key = '';
      if (v === 'desk' && !quiet) {
        this.engine.audio.play('paper_flutter', { volume: 0.4 });
        this.talk(say(TALK.gifts), 6);
      }
    }
    if (!quiet) this.engine.audio.play('whoosh', { volume: 0.25, pitch: 1.3 });
  }

  private select(idx: number, fromView = false) {
    const w = this.wings[this.wing];
    if (!w) return;
    const n = w.sec.entries.length;
    idx = Math.max(0, Math.min(n - 1, idx));
    const changedPage = Math.floor(idx / PER_PAGE) !== w.page;
    w.sel = idx;
    if (changedPage) {
      w.page = Math.floor(idx / PER_PAGE);
      this.fillJars(w, true);
      this.engine.audio.play('paper_flutter', { volume: 0.35, pitch: 1.2 });
    }
    const e = w.sec.entries[idx];
    const known = Codex.known(e.key);
    if (!fromView) this.engine.audio.play(known ? 'ui_click' : 'ui_hover', { volume: 0.3, pitch: 1.1 });
    const f0 = Codex.flags(e.key);
    if (f0 && !(f0 & F_READ)) Codex.markRead(e.key);
    // Thoth says something about it (not on the wing's own hello)
    if (!fromView) {
      const st = Research.state(e.key);
      this.talk(st === 'ready' ? say(TALK.ready) : aboutEntry(e, known), 6);
      this.gesture(this.thoth, st === 'ready' ? 'delight' : !known ? 'think' : Math.random() < 0.3 ? 'gasp' : 'wave', 1.6);
    }
  }

  /** build the pedestal's live specimen for the selected entry (one at a time) */
  private updatePedestal(dt: number) {
    const w = this.view === 'wing' ? this.wings[this.wing] : null;
    const e = w ? w.sec.entries[w.sel] : null;
    const key = e && Codex.known(e.key) ? e.key : '';
    if (key !== this.ped.key) {
      this.ped.k = Math.max(0, this.ped.k - dt * 6);
      if (this.ped.k <= 0 || !this.ped.obj) {
        this.ped.obj?.removeFromParent();
        this.ped.puppet?.dispose();
        this.ped.obj = null;
        this.ped.puppet = null;
        this.ped.key = key;
        if (key && w && e) {
          try {
            const sp = this.specimen(e, 0.8, 0.45);
            if (sp) {
              this.ped.obj = sp.obj;
              this.ped.puppet = sp.puppet;
              sp.obj.position.copy(w.pedPos).add(new THREE.Vector3(0, PED_TOP, 0));
              sp.obj.rotation.y = Math.atan2(-w.fwd.x, -w.fwd.z) + (w.side === 0 ? 0.35 : w.side * 0.3);
              this.scene.add(sp.obj);
              this.particles.emit({ pos: { x: w.pedPos.x, y: w.pedPos.y + PED_TOP + 0.1, z: w.pedPos.z }, count: 26, spread: 0.7, up: 0.9, life: [0.5, 1.2], size: [0.05, 0.01], sprite: ['spark', 'star4'], color: [0xffe08a, 0xfff4c8, 0x8ab0ff], additive: true, drag: 1.5 });
              this.engine.audio.play('divine_whisper', { volume: 0.25, pitch: 1.3 });
            }
          } catch (err) {
            console.warn('[hall] pedestal', key, err);
          }
        }
      }
    } else this.ped.k = Math.min(1, this.ped.k + dt * 3);
    if (this.ped.obj) {
      const k = this.ped.k;
      const s = 0.2 + 0.8 * (1 - Math.pow(1 - k, 3));
      this.ped.obj.scale.setScalar(s);
      this.ped.puppet?.update(dt, this.camera.position);
    }
    // the spot follows the wing's pedestal
    const want = w && this.view === 'wing' ? 7 : 0;
    this.pedLight.intensity = damp(this.pedLight.intensity, want, 4, dt);
    if (w) {
      this.pedLight.position.copy(w.pedPos).add(new THREE.Vector3(0, 3.4, 0)).addScaledVector(w.fwd, -1.2);
      this.pedLight.target.position.copy(w.pedPos).add(new THREE.Vector3(0, PED_TOP + 0.3, 0));
    }
  }

  // ======================================================================= the camera
  private frameGoal() {
    const asp = this.engine.width / this.engine.height;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const hf = 2 * Math.atan(Math.tan(fov / 2) * asp);
    const usable = this.view === 'nave' ? 1 : clamp01((this.ui?.panelLeft() ?? this.engine.width * 0.62) / this.engine.width - 0.02);
    if (this.view === 'nave') {
      this.goalPos.set(0, 1.75, 8.25);
      this.goalLook.set(0, 2.7, -6);
      return;
    }
    if (this.view === 'desk') {
      const d = this.deskGroup;
      const f = new THREE.Vector3(Math.sin(d.rotation.y), 0, Math.cos(d.rotation.y));
      const r = new THREE.Vector3().crossVectors(f, UP).negate();
      const look = d.position.clone().add(new THREE.Vector3(0, 0.95, 0));
      const dist = 2.9 / Math.max(0.35, usable);
      look.addScaledVector(r, -(0.5 - usable / 2) * 2 * dist * Math.tan(hf / 2));
      this.goalLook.copy(look);
      this.goalPos.copy(look).addScaledVector(f, dist).add(new THREE.Vector3(0, 0.55, 0));
      return;
    }
    const w = this.wings[this.wing];
    // the stand and the pedestal together, in the part of the screen the sheet and the plaques leave free
    const c = w.standPos.clone().lerp(w.pedPos, 0.32);
    const contentW = 5.0;
    let d = contentW / usable / (2 * Math.tan(hf / 2));
    d = Math.max(3.8, Math.min(w.side === 0 ? 7.4 : 6.9, d));
    const visW = 2 * d * Math.tan(hf / 2), visH = 2 * d * Math.tan(fov / 2);
    const shift = (0.5 - usable / 2) * visW;
    const look = c.add(new THREE.Vector3(0, 1.05 - visH * 0.1, 0)).addScaledVector(w.right, shift);
    this.goalLook.copy(look);
    this.goalPos.copy(look).addScaledVector(w.fwd, -d).add(new THREE.Vector3(0, 0.5, 0));
  }

  private updateCamera(rdt: number) {
    this.frameGoal();
    const k = 1 - Math.exp(-rdt * (this.view === 'nave' ? 1.6 : 2.6));
    this.camPos.lerp(this.goalPos, k);
    this.camLook.lerp(this.goalLook, k);
    const nx = this.ptr.has && !this.ptr.touch ? (this.ptr.x / this.engine.width) * 2 - 1 : 0;
    const ny = this.ptr.has && !this.ptr.touch ? -(this.ptr.y / this.engine.height) * 2 + 1 : 0;
    this.par.x = damp(this.par.x, nx, 2, rdt);
    this.par.y = damp(this.par.y, ny, 2, rdt);
    const t = this.t;
    const cam = this.camera;
    const fwd = new THREE.Vector3().subVectors(this.camLook, this.camPos).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const amp = this.view === 'nave' ? 0.12 : 0.05;
    cam.position.copy(this.camPos).addScaledVector(right, this.par.x * amp + Math.sin(t * 0.17) * 0.03).add(new THREE.Vector3(0, this.par.y * amp * 0.5 + Math.sin(t * 0.23) * 0.02, 0));
    cam.lookAt(this.camLook);
    cam.aspect = this.engine.width / this.engine.height;
    cam.updateProjectionMatrix();
  }

  // ======================================================================= life
  private updateLife(dt: number) {
    const t = this.t;
    // lamps sway on their chains; flames flicker
    for (const l of this.lamps) {
      const ch = l.rig.nodes['chain'], lp = l.rig.nodes['lamp'];
      ch.rotation.set(Math.sin(t * 0.37 + l.ph) * 0.012, 0, Math.sin(t * 0.29 + l.ph * 2) * 0.014);
      lp.rotation.set(Math.sin(t * 0.9 + l.ph) * 0.03, Math.sin(t * 0.2 + l.ph) * 0.2, Math.sin(t * 0.77 + l.ph) * 0.03);
      l.light.intensity = 9 * (1 + Math.sin(t * 9.1 + l.ph) * 0.05 + Math.sin(t * 23.7 + l.ph) * 0.03);
      if (Math.random() < dt * 9) {
        const f = l.flames[Math.floor(Math.random() * l.flames.length)];
        const wp = lp.localToWorld(f.clone());
        this.particles.emit({ pos: wp, count: 1, spread: 0.02, up: 0.12, life: [0.25, 0.45], size: [0.07, 0.02], sprite: ['flame0', 'flame1', 'flame2', 'flame3'], color: 0xffb050, additive: true, animate: true });
      }
    }
    this.deskLight.intensity = 3.2 * (1 + Math.sin(t * 8.3) * 0.06);
    // dust in the lamplight, stars that twinkle on the vault
    if (Math.random() < dt * 10) this.particles.emit({ pos: { x: (Math.random() - 0.5) * 5, y: 0.5 + Math.random() * 5, z: 8 - Math.random() * 17 }, count: 1, spread: 0.03, up: 0.01, life: [4, 8], size: [0.012, 0.012], sprite: 'dot2', color: 0xffe8c0, additive: true, drag: 0.4, jitter: 0.02, fadeIn: 1.5 });
    if (Math.random() < dt * 3) {
      const a = Math.random() * Math.PI, z = 8 - Math.random() * 18;
      const R = HM.HALL.VAULT_R - 0.08;
      this.particles.emit({ pos: { x: Math.cos(a) * R, y: HM.HALL.CEIL + Math.sin(a) * R, z }, count: 1, spread: 0, life: [0.6, 1.1], size: [0.16, 0.02], sprite: 'star4', color: 0xffe9a0, additive: true });
    }
    // flying books: lazy loops through the air under the vault, flapping
    for (const b of this.books) {
      const tt = t + b.ph;
      const p = new THREE.Vector3(b.c.x + Math.sin(tt * b.f.x) * b.r.x, b.c.y + Math.sin(tt * b.f.y) * b.r.y, b.c.z + Math.cos(tt * b.f.z) * b.r.z);
      const v = p.clone().sub(b.prev);
      b.prev.copy(p);
      b.rig.root.position.copy(p);
      if (v.lengthSq() > 1e-8) {
        const yaw = Math.atan2(v.x, v.z);
        b.rig.root.rotation.set(-v.y * 8, yaw, Math.sin(tt * 0.7) * 0.25, 'YXZ');
      }
      b.flap += dt * (3.2 + Math.sin(tt * 0.3) * 1.2);
      const fl = 0.55 + Math.sin(b.flap) * 0.45;
      b.rig.nodes['cover_l'].rotation.z = 0.35 + fl * 0.9;
      b.rig.nodes['cover_r'].rotation.z = -(0.35 + fl * 0.9);
      if (b.flip < 0 && Math.random() < dt * 0.15) b.flip = 0;
      if (b.flip >= 0) {
        b.flip += dt * 1.6;
        b.rig.nodes['leaf'].rotation.z = 0.6 - Math.min(1, b.flip) * 1.2;
        if (b.flip > 1.6) b.flip = -1;
      } else b.rig.nodes['leaf'].rotation.z = 0.6;
    }
    // ladders roll along the rail now and then
    for (const l of this.ladders) {
      l.wait -= dt;
      if (l.wait <= 0 && Math.abs(l.goal - l.z) < 0.02) {
        l.goal = 7.4 - Math.random() * 12.5;
        l.wait = 6 + Math.random() * 8;
      }
      const dz = l.goal - l.z;
      l.v = damp(l.v, Math.sign(dz) * Math.min(0.7, Math.abs(dz) * 0.8), 2, dt);
      l.z += l.v * dt;
      l.rig.root.position.set(l.side * (HM.HALL.NX - 2 / 12) , HM.HALL.GALLERY + 6 / 12, l.z);
      for (const wn of ['wheel_l', 'wheel_r']) l.rig.nodes[wn].rotation.x += (l.v * dt) / 0.09 * -l.side;
    }
    this.updateThoth(dt);
    this.updateWorms(dt);
    // the next gift turns slowly on the desk
    const ng = Research.nextGift();
    const gk = ng ? giftModel(ng) ?? '' : '';
    if (gk !== this.giftShow.key) {
      this.giftShow.p?.dispose();
      this.giftShow = { key: gk, p: null };
      if (gk) {
        try {
          const p = CONSUMABLES[gk] ? Puppet.model(CONSUMABLES[gk](), gk) : Puppet.fromKey(gk);
          if (p) {
            const k = Math.min(0.28 / Math.max(0.02, p.height), 0.22 / Math.max(0.02, p.radius), 2);
            p.root.scale.setScalar(k);
            p.root.position.set(0.55, (DESK_META?.top ?? 0.97) + 0.02, -0.05);
            this.deskGroup.add(p.root);
            this.giftShow.p = p;
          }
        } catch (e) {
          console.warn('[hall] gift', gk, e);
        }
      }
    }
    this.giftShow.p?.update(dt);
    if (this.giftShow.p && Math.random() < dt * 2.5) {
      const wp = this.giftShow.p.root.getWorldPosition(new THREE.Vector3());
      this.particles.emit({ pos: { x: wp.x, y: wp.y + 0.15, z: wp.z }, count: 1, spread: 0.2, up: 0.2, life: [0.5, 0.9], size: [0.05, 0.01], sprite: 'star4', color: 0xffe08a, additive: true });
    }
  }

  /** send a walker somewhere (waypoints through the nave so nobody walks through the furniture) */
  private goTo(w: Walker, goal: THREE.Vector3, key: string) {
    if (w.goalKey === key) return;
    w.goalKey = key;
    const path: THREE.Vector3[] = [];
    const inBay = (p: THREE.Vector3) => Math.abs(p.x) > HM.HALL.NX - 0.2 && p.z > HM.HALL.APSE_START;
    const atDesk = (p: THREE.Vector3) => p.z < HM.HALL.APSE_START + 0.4 && p.x > 0.9;
    const floorAt = (z: number) => (z < HM.HALL.APSE_START ? APSE_Y : 0);
    const P = (x: number, z: number) => new THREE.Vector3(x, floorAt(z), z);
    if (w.perch > 0) path.push(w.pos.clone().setY(w.pos.y - w.perch));
    if (inBay(w.pos)) path.push(P(Math.sign(w.pos.x) * 1.9, w.pos.z));
    if (atDesk(w.pos) && !atDesk(goal)) path.push(P(0.9, -6.9));
    if (atDesk(goal) && !atDesk(w.pos)) path.push(P(0.9, -6.9));
    if (inBay(goal)) path.push(P(Math.sign(goal.x) * 1.9, goal.z));
    path.push(goal.clone());
    w.path = path;
    w.perch = 0;
  }

  /** walk the path; the animator does the legs. Returns true when standing at the goal. */
  private stepWalker(w: Walker, dt: number) {
    w.t += dt;
    let moving = false;
    const tgt = w.path[0];
    if (tgt) {
      const dx = tgt.x - w.pos.x, dz = tgt.z - w.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        moving = true;
        const sp = Math.min(w.speed, d * 3 + 0.2);
        w.pos.x += (dx / d) * sp * dt;
        w.pos.z += (dz / d) * sp * dt;
        w.pos.y = damp(w.pos.y, tgt.y, 10, dt);
        const want = Math.atan2(dx, dz);
        let dy = want - w.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        w.yaw += dy * Math.min(1, dt * 9);
      } else {
        w.pos.copy(tgt);
        w.path.shift();
        moving = w.path.length > 0;
      }
    }
    if (!moving && w.face !== null) {
      let dy = w.face - w.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      w.yaw += dy * Math.min(1, dt * 5);
    }
    if (w.gest) {
      w.gest.t -= dt;
      if (w.gest.t <= 0) w.gest = null;
    }
    let lift = 0;
    if (w.th) {
      w.th.mode = moving ? 'run' : ((w.gest?.mode as ThothMode) ?? (w.perch > 0 ? 'write' : 'idle'));
      w.th.speed = w.speed;
      w.th.lookAt = moving ? null : this.camera.position;
      w.th.update(dt);
      lift = w.th.rootLift;
    } else if (w.bw) {
      w.bw.mode = moving ? 'inch' : ((w.gest?.mode as BookwormMode) ?? 'read');
      w.bw.speed = w.speed;
      w.bw.lookAt = this.camera.position;
      w.bw.update(dt);
    }
    w.rig.root.position.set(w.pos.x, w.pos.y + lift, w.pos.z);
    w.rig.root.rotation.y = w.yaw;
    return !moving;
  }

  private gesture(w: Walker | null, mode: ThothMode | BookwormMode, t = 1.6) {
    if (w) w.gest = { mode, t };
  }

  private updateThoth(dt: number) {
    const th = this.thoth;
    if (!th) return;
    const cam = this.camera.position;
    if (this.view === 'wing') {
      const w = this.wings[this.wing];
      const goal = w.pedPos.clone().addScaledVector(w.right, -0.85).addScaledVector(w.fwd, -0.55);
      goal.y = w.floor;
      this.goTo(th, goal, 'wing' + this.wing);
      th.face = Math.atan2(cam.x - goal.x, cam.z - goal.z);
    } else if (this.view === 'desk' || (this.view === 'nave' && this.t > 10)) {
      const st = DESK_META?.stool ?? [0, 0.6, 0.47];
      const stand = this.deskGroup.localToWorld(new THREE.Vector3(st[0], 0, st[2] + 0.42));
      this.goTo(th, stand, 'desk');
      th.face = this.deskGroup.rotation.y + Math.PI;
      // at the stool he hops up onto the top step and writes
      if (th.goalKey === 'desk' && !th.path.length && th.perch === 0) {
        const top = this.deskGroup.localToWorld(new THREE.Vector3(st[0], st[1], st[2] + 0.05));
        th.perch = st[1];
        th.path = [top];
        this.gesture(th, 'hop', 0.4);
      }
      if (this.view === 'desk' && th.perch > 0 && !th.path.length) th.face = this.deskGroup.rotation.y + Math.PI + 0.9;
    } else {
      const goal = new THREE.Vector3(0.55, 0, 2.5);
      this.goTo(th, goal, 'hello');
      th.face = Math.atan2(cam.x - goal.x, cam.z - goal.z);
    }
    this.stepWalker(th, dt);
  }

  private updateWorms(dt: number) {
    const t = this.t;
    for (const w of this.worms) {
      if (w.job === 'ladder') {
        // the elder reads on the rolling ladder, riding it along the rail
        const l = this.ladders[0];
        l.rig.root.updateMatrixWorld(true);
        const p = l.rig.nodes['ladder'].localToWorld(new THREE.Vector3(0, -2.05, 0.06));
        w.pos.copy(p);
        w.path = [];
        w.yaw = l.side < 0 ? Math.PI / 2 : -Math.PI / 2;
        w.face = null;
      } else if (w.job === 'gallery') {
        // up on the gallery, inching from one end to the other with a book; shelving it at the ends
        if (!w.path.length && !w.gest) {
          const far = w.pos.z > 0 ? -5.6 : 7.2;
          w.path = [new THREE.Vector3(HM.HALL.NX + 0.3, HM.HALL.GALLERY + 1 / 12, far)];
          w.goalKey = 'g' + far;
          this.gesture(w, 'shelve', 2.6);
        }
        w.face = w.pos.x > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else if (w.job === 'desk') {
        const top = (DESK_META?.top ?? 0.97) + 0.005;
        const p = this.deskGroup.localToWorld(new THREE.Vector3(-0.42, top, -0.3));
        w.pos.copy(p);
        w.path = [];
        w.face = this.deskGroup.rotation.y + 0.6;
        if (!w.gest && Math.random() < dt * 0.05) this.gesture(w, 'look', 2.5);
      } else {
        // the apprentice tends the jars of whichever wing you are in
        const wg = this.view === 'wing' ? this.wings[this.wing] : this.wings[0];
        const goal = wg.standPos.clone().addScaledVector(wg.right, 2.25 * (Math.sin(t * 0.05) > 0 ? 1 : -1)).addScaledVector(wg.fwd, -0.15);
        goal.y = wg.floor;
        this.goTo(w, goal, 'jars' + wg.i + (goal.x > 0 ? 'a' : 'b') + Math.sign(Math.sin(t * 0.05)));
        w.face = Math.atan2(-wg.fwd.x, -wg.fwd.z);
        if (!w.path.length && !w.gest && Math.random() < dt * 0.12) this.gesture(w, Math.random() < 0.5 ? 'rear' : 'look', 2.2);
      }
      this.stepWalker(w, dt);
    }
  }

  // ======================================================================= talk
  private talk(text: string, hold = 6) {
    this.talkText = text;
    this.talkLeft = hold + text.length / 46;
    this.thoth?.th?.talk(Math.min(4, text.length / 18));
    if (Math.random() < 0.5) this.engine.audio.play('squeak', { volume: 0.12, pitch: 1.6 + Math.random() * 0.4 });
  }

  // ======================================================================= input
  private pDown(e: PointerEvent) {
    if (this.state !== 'open') return;
    this.ptr.down = true;
    this.ptr.sx = e.clientX;
    this.ptr.sy = e.clientY;
    this.ptr.moved = 0;
    this.ptr.x = e.clientX;
    this.ptr.y = e.clientY;
    this.ptr.has = true;
    if (e.pointerType === 'touch') this.ptr.touch = true;
    else if (e.pointerType === 'mouse') this.ptr.touch = false;
  }
  private pMove(e: PointerEvent) {
    this.ptr.x = e.clientX;
    this.ptr.y = e.clientY;
    this.ptr.has = true;
    if (e.pointerType === 'mouse') this.ptr.touch = false;
    if (this.ptr.down) this.ptr.moved = Math.max(this.ptr.moved, Math.hypot(e.clientX - this.ptr.sx, e.clientY - this.ptr.sy));
  }
  private pUp(e: PointerEvent) {
    if (!this.ptr.down) return;
    this.ptr.down = false;
    const dx = e.clientX - this.ptr.sx, dy = e.clientY - this.ptr.sy;
    if (this.ptr.moved < 14) this.clicks.push({ x: e.clientX, y: e.clientY });
    else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) this.swipe = dx < 0 ? 1 : -1;
  }

  /** what is under a screen point: a UI id, or a 3D thing */
  private pick(x: number, y: number): string {
    const u = this.ui.hit(x, y);
    if (u) return u;
    const ndc = new THREE.Vector2((x / this.engine.width) * 2 - 1, -(y / this.engine.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const objs: THREE.Object3D[] = [];
    if (this.view === 'wing') {
      for (const j of this.wings[this.wing].jars) if (j.root.visible) objs.push(j.hit);
    } else {
      for (const w of this.wings) objs.push(w.arch);
    }
    objs.push(this.deskHit);
    if (this.thoth) objs.push(this.thothHit);
    const hits = this.ray.intersectObjects(objs, false);
    const h = hits[0];
    if (!h) return '';
    if (h.object === this.deskHit) return this.view === 'desk' ? '' : 'desk';
    if (h.object === this.thothHit) return 'thoth';
    if (this.view === 'wing') {
      const k = this.wings[this.wing].jars.findIndex((j) => j.hit === h.object);
      if (k >= 0) return 'jar:' + k;
    } else {
      const k = this.wings.findIndex((w) => w.arch === h.object);
      if (k >= 0) return 'wing:' + k;
    }
    return '';
  }

  private act(id: string) {
    const eng = this.engine;
    if (!id) return;
    const [kind, arg] = id.split(':');
    switch (kind) {
      case 'close':
        this.close();
        return;
      case 'back':
        this.setView('nave');
        return;
      case 'desk':
        this.setView('desk');
        return;
      case 'wing':
        eng.audio.play('ui_click', { volume: 0.4 });
        if (this.view === 'wing' && this.wing === +arg) return;
        this.setView('wing', false, +arg);
        return;
      case 'jar': {
        const w = this.wings[this.wing];
        this.select(w.page * PER_PAGE + +arg);
        const j = w.jars[+arg];
        j.lift = 1;
        return;
      }
      case 'page': {
        const w = this.wings[this.wing];
        const np = (w.page + +arg + this.pages(w)) % this.pages(w);
        this.select(np * PER_PAGE);
        return;
      }
      case 'study':
        this.completeStudy();
        return;
      case 'thoth':
        this.talk(say(TALK.idle), 5);
        this.gesture(this.thoth, Math.random() < 0.5 ? 'wave' : 'delight', 1.8);
        return;
      case 'talk':
        this.talkLeft = Math.min(this.talkLeft, 0.4);
        return;
      case 'errand':
        this.errandAct(arg);
        return;
    }
  }

  private completeStudy() {
    const w = this.wings[this.wing];
    if (!w) return;
    const e = w.sec.entries[w.sel];
    const gifts = Research.complete(e.key);
    if (!gifts) return;
    const eng = this.engine;
    eng.audio.play('rank_up', { volume: 0.6, pitch: 1.1 });
    eng.audio.play('poster_slam', { volume: 0.4, pitch: 1.3 });
    eng.flash(0xfff0c0, 0.25, 0.3);
    const at = w.pedPos.clone().add(new THREE.Vector3(0, PED_TOP + 0.4, 0));
    this.particles.emit({ pos: at, count: 60, spread: 1.6, up: 1.6, life: [0.7, 1.6], size: [0.07, 0.01], sprite: ['spark', 'star4', 'feather'], color: [0xffe08a, 0xfff4c8, 0x8ab0ff], additive: true, gravity: 1.2, drag: 1.2 });
    this.gesture(this.thoth, gifts.length ? 'stoptime' : 'delight', 2.2);
    if (gifts.length) {
      const g = gifts[gifts.length - 1];
      this.banner = { title: 'A GIFT FROM THOTH', sub: gifts.map(giftName).join('  ·  ') };
      this.talk(g.say, 8);
      eng.audio.play('loot_reveal', { volume: 0.6 });
    } else {
      this.banner = { title: 'STUDY COMPLETE', sub: `${e.name}  ·  ${Research.count()} studies` };
      this.talk(say(TALK.stamp), 5);
    }
    this.ui.showBanner();
  }

  private errandAct(what: string) {
    const eng = this.engine;
    if (what === 'take') {
      const e = Research.proposeErrand(this.errSkip);
      if (!e) return;
      Research.takeErrand(e);
      eng.audio.play('paper_flutter', { volume: 0.5 });
      this.talk(say(TALK.errandTaken), 5);
    } else if (what === 'skip') {
      this.errSkip++;
      const e = Research.proposeErrand(this.errSkip);
      if (e) this.talk(e.ask, 7);
      eng.audio.play('page_turn', { volume: 0.4, pitch: 1.2 });
    } else if (what === 'turnin') {
      const done = Research.turnInErrand();
      if (!done) return;
      eng.audio.play('gold_burst', { volume: 0.6 });
      eng.audio.play('sting_positive', { volume: 0.5 });
      this.banner = { title: 'ERRAND DONE', sub: Research.rewardText(done) };
      this.ui.showBanner();
      this.talk(say(TALK.errandDone), 6);
      this.errSkip = 0;
      this.gesture(this.thoth, 'delight', 2);
    } else if (what === 'drop') {
      Research.dropErrand();
      this.talk(say(TALK.errandDrop), 4);
    }
  }

  private input() {
    const eng = this.engine;
    const inp = eng.input;
    // keys
    if (inp.wasPressed('Escape') || inp.wasPressed('Backspace')) {
      if (this.view === 'nave') this.close();
      else this.setView('nave');
      return;
    }
    for (let k = 0; k < 7; k++) if (inp.wasPressed('Digit' + (k + 1))) this.act('wing:' + k);
    if (this.view === 'wing') {
      const w = this.wings[this.wing];
      const col = w.sel % 5, row = Math.floor((w.sel % PER_PAGE) / 5);
      // the jar order on screen runs with the stand's own left-to-right
      if (inp.wasPressed('KeyD') || inp.wasPressed('ArrowRight')) this.select(w.sel + 1);
      else if (inp.wasPressed('KeyA') || inp.wasPressed('ArrowLeft')) this.select(w.sel - 1);
      else if (inp.wasPressed('KeyW') || inp.wasPressed('ArrowUp')) this.select(row === 0 ? w.sel + 5 : w.sel);
      else if (inp.wasPressed('KeyS') || inp.wasPressed('ArrowDown')) this.select(row === 1 ? w.sel - 5 : w.sel);
      else if (inp.wasPressed('KeyE') || inp.wasPressed('PageDown')) this.act('page:1');
      else if (inp.wasPressed('KeyQ') || inp.wasPressed('PageUp')) this.act('page:-1');
      else if (inp.wasPressed('Enter') || inp.wasPressed('Space')) this.completeStudy();
      else if (inp.wasPressed('Tab')) this.act('wing:' + ((this.wing + 1) % 7));
      void col;
    } else if (this.view === 'nave') {
      if (inp.wasPressed('Enter') || inp.wasPressed('Space')) this.act('wing:0');
      else if (inp.wasPressed('KeyT')) this.act('desk');
    }
    if (this.swipe) {
      if (this.view === 'wing') this.act('page:' + this.swipe);
      this.swipe = 0;
    }
    // pointer: hover (mouse) and clicks / taps
    let hov = '';
    if (this.ptr.has && !this.ptr.touch) hov = this.pick(this.ptr.x, this.ptr.y);
    if (hov !== this.hoverId) {
      if (hov && !hov.startsWith('jar') && hov !== 'panel' && hov !== 'talk') eng.audio.play('ui_hover', { volume: 0.15, pitch: 1.4 });
      this.hoverId = hov;
      document.body.style.cursor = hov && hov !== 'panel' ? 'pointer' : 'default';
    }
    this.ui.hover = hov;
    this.tip = null;
    if (hov.startsWith('jar:') && this.view === 'wing') {
      const w = this.wings[this.wing];
      const e = w.sec.entries[w.page * PER_PAGE + +hov.slice(4)];
      if (e) this.tip = { text: Codex.known(e.key) ? e.name : 'Under a dust sheet', x: this.ptr.x, y: this.ptr.y };
      const j = w.jars[+hov.slice(4)];
      j.puppet?.update(1 / 60, this.camera.position);
    } else if (hov.startsWith('wing:') && this.view !== 'wing') {
      const w = this.wings[+hov.slice(5)];
      this.tip = { text: w.sec.name, x: this.ptr.x, y: this.ptr.y };
    } else if (hov === 'desk') this.tip = { text: "Thoth's desk: gifts and errands", x: this.ptr.x, y: this.ptr.y };
    else if (hov === 'thoth') this.tip = { text: 'Thoth', x: this.ptr.x, y: this.ptr.y };
    for (const c of this.clicks.splice(0)) this.act(this.pick(c.x, c.y));
  }

  // ======================================================================= frame
  update(rdt: number) {
    if (this.state === 'idle' || this.state === 'done') return;
    const dt = Math.min(rdt, 0.05);
    this.t += dt;
    if (this.state === 'open') this.input();
    this.buildSome(this.view === 'wing' ? 7 : 4);
    this.updateLife(dt);
    this.updatePedestal(dt);
    // jars: the picked one rises a touch and gets a warm light
    if (this.view === 'wing') {
      const w = this.wings[this.wing];
      const sel = w.sel - w.page * PER_PAGE;
      w.jars.forEach((j, k) => {
        j.lift = damp(j.lift, k === sel ? 1 : 0, 6, dt);
        j.root.position.y = this.jarBaseY(w, k) + j.lift * 0.035;
      });
      const sj = w.jars[sel];
      if (sj) {
        this.jarLight.position.copy(sj.root.position).add(new THREE.Vector3(0, 0.75, 0)).addScaledVector(w.fwd, -0.25);
        this.jarLight.intensity = damp(this.jarLight.intensity, 2.2, 5, dt);
      }
    } else this.jarLight.intensity = damp(this.jarLight.intensity, 0, 5, dt);
    // talk timing and idle chatter
    this.talkLeft -= dt;
    if (this.talkLeft <= 0) this.talkText = null;
    this.idleTalk -= dt;
    if (this.idleTalk <= 0) {
      this.idleTalk = 24 + Math.random() * 16;
      if (!this.talkText && this.state === 'open') {
        const e = Research.errand();
        this.talk(e && this.view === 'nave' ? say(Research.errandMet(e) ? TALK.ready : TALK.errandWait) : say(TALK.idle), 5);
      }
    }
    this.particles.update(dt, this.scene.fog as THREE.Fog);
    this.updateCamera(dt);
    this.drawUI(rdt);
  }

  private jarBaseY(w: Wing, k: number) {
    return w.standPos.y + STAND_SLOTS[k][1];
  }

  // ======================================================================= the screen
  private panelData(w: Wing): PanelData {
    const e = w.sec.entries[w.sel];
    const known = Codex.known(e.key);
    const f = Codex.flags(e.key);
    const g = Research.goal(e);
    const st = Research.state(e.key);
    const kills = e.cat === 'bounty' ? Codex.kills(e.id) : 0;
    return {
      key: e.key,
      name: e.name,
      title: e.title,
      section: w.sec.name,
      num: e.n,
      known,
      isNew: !!f && !(f & F_READ),
      lore: e.lore,
      stats: [...(e.stats ?? []), ...(kills ? [['Brought down', String(kills)] as [string, string]] : [])],
      moves: e.moves ?? [],
      weak: e.weak,
      hint: e.hint,
      points: `${Codex.entryPoints(e)} of ${Codex.entryMax(e)} pts${f & F_CLAIM ? '  ·  ' + (e.claimWord ?? 'RECORDED') : f & F_SEEN ? '  ·  SEEN' : ''}`,
      study: g ? { state: st, text: g.text, cur: g.cur, need: g.need } : null,
    };
  }

  private errandSlip(): ErrandSlip {
    const e: Errand | null = Research.errand();
    if (e) {
      const pr = Research.errandProgress(e);
      const met = pr.cur >= pr.need;
      return { state: met ? 'met' : 'active', ask: e.ask, objective: e.objective, progress: met ? 'Done! Tell Thoth.' : pr.need > 1 ? `${Math.max(0, pr.cur)} / ${pr.need}` : 'Not yet', reward: 'Reward: ' + Research.rewardText(e) };
    }
    const p = Research.proposeErrand(this.errSkip);
    if (!p) return { state: 'none', ask: '', objective: '', progress: '', reward: '' };
    return { state: 'offer', ask: p.ask, objective: p.objective, progress: '', reward: 'Reward: ' + Research.rewardText(p) };
  }

  private drawUI(rdt: number) {
    const secs = this.wings.map((w) => {
      const st = Codex.sectionStats(w.sec);
      return { name: SHORT[w.sec.cat], found: st.found, total: st.total, ready: Research.readyCount(w.sec.cat), fresh: st.fresh };
    });
    const ng = Research.nextGift();
    const markers: HallUIState['markers'] = [];
    let hoverWing = -1;
    if (this.hoverId.startsWith('wing:')) hoverWing = +this.hoverId.slice(5);
    if (this.view === 'wing') {
      const w = this.wings[this.wing];
      const v = new THREE.Vector3();
      w.jars.forEach((j) => {
        if (!j.key || !j.root.visible) return;
        const st = Research.state(j.key);
        const f = Codex.flags(j.key);
        const kind = st === 'ready' ? 'ready' : f && !(f & F_READ) ? 'new' : null;
        if (!kind) return;
        v.copy(j.root.position).add(new THREE.Vector3(0, 0.95, 0)).project(this.camera);
        if (v.z > 1) return;
        markers.push({ x: (v.x * 0.5 + 0.5) * this.engine.width, y: (-v.y * 0.5 + 0.5) * this.engine.height, kind });
      });
    }
    const sat = Research.satchel();
    const state: HallUIState = {
      view: this.view,
      studies: Research.count(),
      nextGift: ng ? { name: giftName(ng), at: ng.at } : null,
      wings: secs,
      activeWing: this.wing,
      hoverWing,
      page: this.view === 'wing' ? { cur: this.wings[this.wing].page, total: this.pages(this.wings[this.wing]) } : null,
      panel: this.view === 'wing' ? this.panelData(this.wings[this.wing]) : null,
      talk: this.state === 'open' || this.state === 'closing' ? this.talkText : null,
      errand: this.view === 'nave' ? this.errandSlip() : null,
      gifts: this.view === 'desk' ? GIFTS.map((g, i) => ({ name: giftName(g), at: g.at, given: i < Research.given() })) : null,
      satchel: sat.length ? sat.map((s) => `${s.n} ${s.n > 1 ? 'x ' : ''}${giftName({ at: 0, kind: 'item', id: s.id, say: '' }).replace(/ x\d+$/, '')}`).join(', ') : null,
      tip: this.tip,
      markers,
      banner: this.banner,
      hint: this.view === 'wing' ? 'A / D  choose   ·   W / S  shelf   ·   Q / E  page   ·   Enter  study   ·   Esc  back' : this.view === 'desk' ? 'Esc  back' : '1 - 7  wings   ·   T  desk   ·   Esc  close',
      touch: this.ptr.touch,
    };
    this.banner = null;
    this.ui.frame(rdt, state);
  }

  dispose() {
    this.state = 'done';
    this.restorePost();
    window.removeEventListener('pointerdown', this.onPDown);
    window.removeEventListener('pointermove', this.onPMove);
    window.removeEventListener('pointerup', this.onPUp);
    this.ui?.canvas.remove();
    document.body.style.cursor = 'default';
    for (const w of this.wings) for (const j of w.jars) this.clearJar(j);
    this.ped.obj?.removeFromParent();
    this.ped.puppet?.dispose();
    this.giftShow.p?.dispose();
    for (const w of [this.thoth, ...this.worms]) w?.rig.dispose();
    this.moon?.shadow.map?.dispose();
    this.glassMat.dispose();
    this.silMat.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && (m.geometry as any).type === 'BoxGeometry') m.geometry.dispose();
    });
    if ((window as any).__hall === this) (window as any).__hall = null;
  }
}
