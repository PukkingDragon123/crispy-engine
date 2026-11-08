// The gunsmith's corner, fully 3D: the gun rack on the wall over the side
// cabinet (GunRack.ts) and the bench beside it.
//
// Browse the rack: drag or swipe, A / D, the arrows or the wheel. The camera
// glides from gun to gun and the one you look at lifts in its cradle under a
// warm spot. Click it and it comes down onto the gunsmith's turntable on the
// bench, close up. Every part slot is a brass marking pin stuck in the gun with
// a manila work tag on a twine (slot, the part in it, what else you own): click
// a tag or its pin to cycle the parts you own for that slot, or click a loose
// part in the walnut tray, or a fitted part on the gun to take it off. Sundown
// steps up and sets each part with a wrench in a spray of sparks; the gun is
// rebuilt with it and saved (Blueprints.fit / unfit; the six-shooter's gold
// parts through the save, chained with a price tag in the tray until bought).
// The tag tied to the turntable's crank picks which long gun rides on the
// sling. The work order on the clipboard reads out whatever you point at. Drag
// to turn the gun on the turntable; Esc or a click away from it puts it back.
// Blueprints you have not found are still pinned over the board rack.
import * as THREE from 'three';
import type { RigSpec, RigInstance } from '../../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { damp } from '../../../engine/math/rand';
import * as CH from '../../models/characters';
import * as WS from '../../models/props/workshop';
import * as HX from '../../models/props/hideout';
import { Blueprints, GUNS, ATTACHMENTS, AttachmentDef, gunTune } from '../../meta/Blueprints';
import * as Wp from '../../player/Weapons';
import { buildWeaponRig, weaponRigJob, LONG_FEEL } from '../../player/Weapons';
import { blueprintPhoto } from '../../ui/BlueprintReveal';
import { loadSave, writeSave, owns, buy, PRICES, GUN_PARTS, GUN_PERKS, GunLoadout } from '../../meta/Save';
import { BuildKit, HubHost, HubStation, HeroBubble, PriceLock, safe, geoOf, meshOf, reach, ease, clamp01, sstep, stepJob, nailGeo } from './HubKit';
import { GunRack, GunKey, RACK_ORDER, REV_DEFAULT, Display, Q_FLAT, buildDisplay, displayFromSpec, poseBox, scaleOf, restMatrix, componentsOf, GunComp, TextCard } from './GunRack';
import { GunsmithUI, SmithHit, SmithView, SmithStat, SmithOption, RackInfo } from './GunsmithUI';
import { RuneCircle, shellMaterial, gunSchematic, JADE, GOLD } from './GunsmithFX';
import type { Mode, Pick, View } from './HouseExtras';

const IN = HX.CABIN_IN;
const FV = 1 / 48;
const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
/** the work tags' size (the card is 0.12 m wide at 1) */
const TAG_SCALE = 1.36;
const GOLD_SLOTS = Object.keys(GUN_PARTS) as (keyof GunLoadout)[];
/** what each slot is called on its tag, and what sits there when nothing is fitted */
const SLOT_NAME: Record<string, string> = { barrel: 'BARREL', muzzle: 'MUZZLE', optic: 'OPTIC', under: 'UNDER THE BARREL', mag: 'MAGAZINE', stock: 'STOCK', cylinder: 'CYLINDER', grip: 'GRIP', sight: 'SIGHT' };
const BARE: Record<string, string> = {
  'shotgun:barrel': 'Coach Barrels', 'shotgun:muzzle': 'Open Bore', 'shotgun:stock': 'Plain Stock', 'shotgun:under': 'Nothing Fitted',
  'tommy:mag': 'L-Drum (50 Rounds)', 'tommy:muzzle': 'Bare Muzzle', 'tommy:optic': 'Iron Sights', 'tommy:under': 'Nothing Fitted',
  'revolver:barrel': 'Standard Barrel', 'revolver:cylinder': 'Standard Cylinder', 'revolver:grip': 'Walnut Grip', 'revolver:sight': 'No Sight',
  'revolver:under': 'Nothing Fitted', 'revolver:mag': 'Loose Rounds',
};
const BARE_DESC: Record<string, string> = { 'revolver:mag': 'Thumbing them in one at a time, like Pa did.', 'tommy:mag': 'Fifty rounds in the L-drum.', 'shotgun:barrel': 'Side by side, the way the stage line had them.' };

interface Part {
  id: string;
  gun: GunKey;
  slot: string;
  name: string;
  desc: string;
  /** the part's voxels in rig space (parented to the gun root it sits exactly where it fits on a bare gun) */
  grp: THREE.Group;
  /** centre of its content in rig space */
  c: THREE.Vector3;
  len: number;
  lock: PriceLock | null;
  /** revolver gold part: the save key; else a blueprint attachment */
  key?: string;
  proxy: THREE.Group | null;
  /** where it lies in the tray */
  home: THREE.Matrix4 | null;
}
/** one choice for a slot, as the panel lists it */
interface Opt {
  part: Part | null;
  def: AttachmentDef | null;
  /** the six-shooter's gold option ('long', 'bone'...) */
  gold: string | null;
  key: string;
  name: string;
  desc: string;
  state: SmithOption['state'];
  price?: number;
}
interface Flight {
  p: Part;
  t: number;
  on: boolean;
  from: THREE.Matrix4;
  /** where it lands: the gun root (+ a rig-space shift to the slot as it is now) or a tray spot */
  to: THREE.Object3D | null;
  shift: THREE.Vector3;
  back: THREE.Matrix4 | null;
  joint: THREE.Vector3;
}
type State = 'rack' | 'down' | 'work' | 'up';

export class Bench3D implements Mode {
  id = 'bench';
  done = false;
  rack: GunRack;
  private st: HubStation | null = null;
  private top = 0.958;
  private bx = -1.32;
  private zBack = -3.26;
  private zFront = -2.55;
  // ---- browsing and the work
  private state: State = 'rack';
  private sel: GunKey = 'revolver';
  private scroll = 1;
  private gunFly: { t: number; dur: number; d: Display; down: boolean; a: { p: THREE.Vector3; q: THREE.Quaternion; s: number }; b: { p: THREE.Vector3; q: THREE.Quaternion; s: number } } | null = null;
  private work: Display | null = null;
  // ---- the turntable
  private tt: RigInstance | null = null;
  private ttAt = new THREE.Vector3();
  private felt = 0.16;
  /** the baize over the platter's own origin */
  private feltTop = 0.06;
  private spin = 0;
  private spinTo = 0;
  private crank = new THREE.Vector3();
  private benchClip: THREE.Mesh | null = null;
  // ---- the parts tray and the parts
  private trayX = -0.77;
  private trayY = 0;
  private trayZ = -2.62;
  private trayLen = 0.75;
  private parts: Part[] = [];
  private pieceJob: Generator<void, void, void> | null = null;
  private built = new Set<GunKey>();
  // ---- builds spread over frames: the gun about to be fitted, the schematic's gun
  private prebuild: { key: string; gen: Generator<void, RigSpec | null, void>; spec: RigSpec | null; done: boolean } | null = null;
  private schemJob: { key: string; gen: Generator<void, RigSpec | null, void> } | null = null;
  // ---- the gunsmith's screen: panels, the selected component, the exploded view, the magic
  private smith: GunsmithUI | null = null;
  private selSlot = 0;
  private hoverOpt = -1;
  private uiHover: SmithHit = null;
  private buyArmed: { key: string; t: number } | null = null;
  private exploded = false;
  private explodeK = 0;
  private shellMat = shellMaterial();
  private hoverMat = shellMaterial(GOLD, GOLD);
  /** the energy shells on the selected slot's components, and the gold one on the component under the mouse */
  private shell: { key: string; objs: THREE.Mesh[] } | null = null;
  private hoverShell: { key: string; objs: THREE.Mesh[] } | null = null;
  private hoverComp: { comp: GunComp; x: number; y: number } | null = null;
  private rune: RuneCircle | null = null;
  private aura: THREE.PointLight | null = null;
  private auraK = 0;
  private schem = new Map<string, HTMLCanvasElement | null>();
  private schemWant = { key: '', t: 0 };
  private schemShown: HTMLCanvasElement | null = null;
  private board: { grp: THREE.Group; card: TextCard } | null = null;
  // ---- the blueprints you have not found
  private papers: { id: string; mesh: THREE.Mesh }[] = [];
  private paperJob: Generator<void, void, void> | null = null;
  private paperDelay = Infinity;
  // ---- fitting
  private fly: Flight | null = null;
  private offs: Flight[] = [];
  private queue: (() => void) | null = null;
  private wrench: THREE.Mesh | null = null;
  private wt = 0;
  // ---- input
  private drag = { down: false, x0: 0, x: 0, moved: false, s0: 0, spin0: 0, vx: 0, lt: 0, lx: 0 };
  private pending: (() => void) | null = null;
  private swallow = false;
  private listening = false;
  private hovered: Part | null = null;
  private ray = new THREE.Raycaster();
  private v = new THREE.Vector3();
  private t = 0;

  constructor(private h: HubHost, private bubble: HeroBubble) {
    this.rack = new GunRack(h);
  }

  // ======================================================================= build
  build(k: BuildKit) {
    const wb = this.h.stations.find((s) => s.id === 'bench')?.objs[0];
    if (wb) {
      const bb = new THREE.Box3().setFromObject(wb);
      this.bx = wb.position.x;
      this.zBack = bb.min.z;
      this.zFront = bb.min.z + 35 * FV;
      this.top = wb.position.y + 46 * FV;
    }
    // ---- the rack, over the side cabinet between the bench's end and the futon
    this.rack.build(k, 0.225);
    const st = this.h.stations.find((s) => s.id === 'bench');
    if (st && this.rack.grp) st.objs.push(this.rack.grp);
    // ---- the turntable at the bench's right end, the tray in front of it, the work order on the tool wall
    this.ttAt.set(this.bx + 0.74, this.top - 0.004, this.zBack + 0.35);
    const ts = safe(() => WS.gunTurntableRig());
    this.tt = k.rig(ts, this.ttAt.x, this.ttAt.y, this.ttAt.z, -0.55, 'tt');
    this.felt = (ts?.meta?.felt as number) ?? 0.16;
    this.feltTop = this.felt - (this.tt?.nodes['top']?.position.y ?? 0.1);
    if (ts?.meta?.crank) this.crank.set(...(ts.meta.crank as [number, number, number]));
    // two rows: the parts you own along the front, the ones for sale (chained, priced) behind them
    const trs = safe(() => WS.partsTray(40, 7));
    this.trayX = this.ttAt.x - 0.57;
    this.trayZ = this.zFront - 0.17;
    this.trayLen = 40 * FV;
    k.put(trs, this.trayX, this.trayZ, 0, this.top, 1, false);
    this.trayY = this.top + (trs?.meta.top ?? 0.04) + 0.003;
    const cb = safe(() => WS.workClipboard());
    const cg = geoOf(cb);
    if (cb && cg) {
      const grp = new THREE.Group();
      grp.add(meshOf(cg));
      const [w, hh] = cb.meta.size;
      const card = new TextCard(w, hh, 300);
      card.mesh.position.set(...cb.meta.paper);
      card.mesh.position.z += 0.003;
      grp.add(card.mesh);
      // propped on the bench's front corner by the turntable, tipped up toward whoever is working
      grp.position.set(this.ttAt.x + 0.11, this.top + 0.004, this.zFront - 0.012);
      grp.rotation.set(-1.02, -0.18, 0, 'YXZ');
      grp.scale.setScalar(0.86);
      this.h.scene.add(grp);
      this.board = { grp, card };
    }
    // ---- the wrench he sets parts with; the pins, tags and twine the slots wear
    const wm = geoOf(safe(() => WS.benchWrench()), 'center');
    if (wm) {
      this.wrench = meshOf(wm);
      this.wrench.visible = false;
      this.h.scene.add(this.wrench);
    }
    // ---- the six-shooter's bench cradle stays empty now (the gun lives on the rack); his idle fiddling goes to the turntable
    const host = this.h as unknown as { gunHolder?: THREE.Object3D };
    if (host.gunHolder) {
      host.gunHolder.visible = false;
      host.gunHolder.position.copy(this.ttAt).add(new THREE.Vector3(0, this.felt, 0));
    }
    // ---- the gunsmith's panels and magic
    this.smith = new GunsmithUI(this.h.engine.overlay);
    this.rune = new RuneCircle(0.3);
    const F = this.floatAt();
    this.rune.grp.position.set(F.x, F.y - 0.3, F.z - 0.04);
    this.h.scene.add(this.rune.grp);
    this.aura = new THREE.PointLight(JADE, 0, 1.1, 2);
    this.aura.position.set(F.x, F.y - 0.12, F.z + 0.12);
    this.h.scene.add(this.aura);
    this.paperJob = this.makePapers();
  }

  // ======================================================================= the parts (for the tray: per gun, against the bare gun)
  private *makePieces(g: GunKey): Generator<void, void, void> {
    // every part (owned, or for sale for the six-shooter), cut from a build with it fitted: its slot's components
    const want: { id: string; slot: string; name: string; desc: string; key?: string; fitted: AttachmentDef[]; gun?: GunLoadout }[] = [];
    if (g === 'revolver') {
      for (const slot of GOLD_SLOTS)
        for (const o of GUN_PARTS[slot] as string[]) {
          if (o === (REV_DEFAULT as unknown as Record<string, string>)[slot]) continue;
          want.push({ id: `${slot}:${o}`, slot, name: `${cap(o)} ${cap(slot)}`, desc: GUN_PERKS[`${slot}:${o}`] ?? '', key: `gun:${slot}:${o}`, fitted: [], gun: { ...REV_DEFAULT, [slot]: o } as GunLoadout });
        }
    }
    for (const a of Blueprints.attachments(g)) if (a.owned) want.push({ id: a.id, slot: a.slot, name: a.name, desc: a.desc, fitted: [ATTACHMENTS[a.id]], gun: g === 'revolver' ? REV_DEFAULT : undefined });
    for (const w of want) {
      let grp: THREE.Group | null = null;
      if (w.id === 'rev_speedloader') {
        const cg = geoOf(safe(() => WS.moonClip()));
        if (cg) (grp = new THREE.Group()).add(meshOf(cg));
      } else {
        const spec = yield* weaponRigJob(g, w.fitted, w.gun ? { gun: w.gun as never } : {});
        grp = spec ? componentPiece(spec, w.slot) : null;
      }
      if (grp) this.addPart({ id: w.id, gun: g, slot: w.slot, name: w.name, desc: w.desc, key: w.key, grp });
      yield;
    }
  }
  private addPart(p: Omit<Part, 'c' | 'len' | 'lock' | 'proxy' | 'home'>) {
    const bb = new THREE.Box3().setFromObject(p.grp);
    if (bb.isEmpty()) return;
    const c = bb.getCenter(new THREE.Vector3());
    const part: Part = { ...p, c, len: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z, 0.03), lock: null, proxy: null, home: null };
    if (p.key && !owns(p.key)) part.lock = new PriceLock(this.h, p.key, PRICES[p.key] ?? 0, 14, 0.5);
    if (part.lock) this.h.scene.add(part.lock.grp);
    p.grp.visible = false;
    this.h.scene.add(p.grp);
    this.parts.push(part);
    this.layout();
  }
  private ensurePieces(g: GunKey) {
    if (this.built.has(g)) return;
    this.built.add(g);
    const job = this.makePieces(g);
    const prev = this.pieceJob;
    this.pieceJob = (function* () {
      if (prev) yield* prev;
      yield* job;
    })();
  }
  private fittedNow(p: Part) {
    if (p.key) {
      const [slot, o] = p.id.split(':');
      return (loadSave().gun as unknown as Record<string, string>)[slot] === o;
    }
    return Blueprints.fitted(p.gun).some((a) => a.id === p.id);
  }
  private usable(p: Part) {
    return !p.lock || p.lock.open;
  }

  // ======================================================================= the slots as they are now (pins and tags)
  private configKey(g: GunKey) {
    const d = loadSave();
    return g === 'revolver' ? `${d.gun.barrel}:${d.gun.cylinder}:${d.gun.grip}:${d.gun.sight}:${Blueprints.fitted('revolver').map((a) => a.id).join(',')}` : Blueprints.fitted(g).map((a) => a.id).sort().join(',');
  }
  /** take the energy shells off */
  private clearShell() {
    for (const sh of [this.shell, this.hoverShell]) sh?.objs.forEach((m) => m.removeFromParent());
    this.shell = null;
    this.hoverShell = null;
  }
  /** shells over components: copies of their meshes in the glow material, riding on their nodes (so they explode with them) */
  private shellOver(d: Display, names: string[], mat: THREE.ShaderMaterial) {
    const out: THREE.Mesh[] = [];
    for (const n of names) {
      const mesh = d.inst.meshes[n], node = d.inst.nodes[n];
      if (!mesh || !node) continue;
      const sm = new THREE.Mesh(mesh.geometry, mat);
      sm.renderOrder = 4;
      sm.raycast = () => undefined;
      node.add(sm);
      out.push(sm);
    }
    return out;
  }
  /** the component a hit landed on (walking up to its rig node) */
  private compOf(d: Display, o: THREE.Object3D | null): GunComp | null {
    const comps = componentsOf(d.spec);
    for (; o && o !== d.root; o = o.parent) {
      const name = o.name;
      const c = comps.find((q) => q.name === name);
      if (c) return c;
    }
    return null;
  }
  /** the slots of a gun, in the order the panel lists them */
  private slotIds(g: GunKey): string[] {
    return g === 'revolver' ? [...GOLD_SLOTS, 'under', 'mag'] : [...GUNS[g].slots];
  }
  /** a slot's choices: what is there with nothing fitted, then every part you can fit there */
  private options(g: GunKey, slot: string): { part: Part | null; name: string; desc: string }[] {
    const out: { part: Part | null; name: string; desc: string }[] = [{ part: null, name: BARE[`${g}:${slot}`] ?? 'Nothing Fitted', desc: g === 'revolver' && GOLD_SLOTS.includes(slot as keyof GunLoadout) ? GUN_PERKS[`${slot}:${(REV_DEFAULT as unknown as Record<string, string>)[slot]}`] ?? '' : BARE_DESC[`${g}:${slot}`] ?? '' }];
    for (const p of this.parts) if (p.gun === g && p.slot === slot && this.usable(p)) out.push({ part: p, name: p.name, desc: p.desc });
    return out;
  }
  private current(g: GunKey, slot: string) {
    return this.parts.find((p) => p.gun === g && p.slot === slot && this.fittedNow(p)) ?? null;
  }
  private lockedCount(g: GunKey, slot: string) {
    if (g === 'revolver' && GOLD_SLOTS.includes(slot as keyof GunLoadout)) return this.parts.filter((p) => p.gun === g && p.slot === slot && !this.usable(p)).length;
    return Blueprints.attachments(g).filter((a) => a.slot === slot && !a.owned).length;
  }
  // ======================================================================= the gunsmith's panels
  /** every choice for a slot: what is there bare, then each part (fitted, owned, for sale, or a blueprint still out there) */
  private allOptions(g: GunKey, slot: string): Opt[] {
    const bareName = BARE[`${g}:${slot}`] ?? 'Nothing Fitted';
    const isGold = g === 'revolver' && GOLD_SLOTS.includes(slot as keyof GunLoadout);
    if (isGold) {
      const cfg = loadSave().gun as unknown as Record<string, string>;
      return (GUN_PARTS[slot as keyof GunLoadout] as string[]).map((o) => {
        const def = o === (REV_DEFAULT as unknown as Record<string, string>)[slot];
        const key = `gun:${slot}:${o}`;
        const part = def ? null : this.parts.find((p) => p.id === `${slot}:${o}`) ?? null;
        const state: Opt['state'] = cfg[slot] === o ? 'fitted' : def || owns(key) ? 'owned' : 'buy';
        return { part, def: null, gold: o, key, name: def ? bareName : `${cap(o)} ${cap(slot)}`, desc: GUN_PERKS[`${slot}:${o}`] ?? '', state, price: PRICES[key] ?? 0 };
      });
    }
    const fitted = Blueprints.fitted(g);
    const cur = fitted.find((a) => a.slot === slot) ?? null;
    const out: Opt[] = [{ part: null, def: null, gold: null, key: `${g}:${slot}:bare`, name: bareName, desc: BARE_DESC[`${g}:${slot}`] ?? 'As she came from the maker.', state: cur ? 'owned' : 'fitted' }];
    for (const a of Blueprints.attachments(g)) {
      if (a.slot !== slot) continue;
      const part = this.parts.find((p) => p.id === a.id) ?? null;
      out.push({ part, def: ATTACHMENTS[a.id], gold: null, key: a.id, name: a.name, desc: a.desc, state: cur?.id === a.id ? 'fitted' : a.owned ? 'owned' : 'blueprint' });
    }
    return out;
  }
  /** what a slot is fitted with now */
  private fittedOpt(g: GunKey, slot: string) {
    const all = this.allOptions(g, slot);
    return all.find((o) => o.state === 'fitted') ?? all[0];
  }
  /** the stats a gun would have with one slot set to an option (long guns: the tune maths; the six-shooter: its perks) */
  private statsWith(g: GunKey, slot: string, o: Opt | null) {
    if (g !== 'revolver') {
      const F = LONG_FEEL[g];
      const fitted = Blueprints.fitted(g);
      const list = o ? fitted.filter((a) => a.slot !== slot).concat(o.def ? [o.def] : []) : fitted;
      const t = gunTune(g, list);
      const pellets = g === 'shotgun' ? LONG_FEEL.shotgun.pellets : 1;
      return {
        DAMAGE: (t.dmgMul * (pellets + t.pelletsAdd)) / pellets,
        ACCURACY: 1 / (t.spreadMul * t.hipSpreadMul),
        RANGE: t.rangeMul,
        RELOAD: 1 / t.reloadMul,
        HANDLING: 1 / t.recoilMul,
        MAGAZINE: F.mag + t.magAdd,
        CRIT: t.critAdd,
      } as Record<string, number>;
    }
    const cfg = { ...(loadSave().gun as unknown as Record<string, string>) };
    let fitted = Blueprints.fitted('revolver');
    if (o?.gold) cfg[slot] = o.gold;
    else if (o && !GOLD_SLOTS.includes(slot as keyof GunLoadout)) fitted = fitted.filter((a) => a.slot !== slot).concat(o.def ? [o.def] : []);
    const m = { DAMAGE: 1, 'FIRE RATE': 1, RELOAD: 1, ACCURACY: 1, CRIT: 0 } as Record<string, number>;
    for (const sl of GOLD_SLOTS) {
      const perk = GUN_PERKS[`${sl}:${cfg[sl]}`] ?? '';
      for (const mm of perk.matchAll(/([+-]\d+)%\s+([a-z ]+)/gi)) {
        const v = +mm[1] / 100, w = mm[2].trim().toLowerCase();
        if (w.startsWith('damage')) m.DAMAGE *= 1 + v;
        else if (w.startsWith('fire rate')) m['FIRE RATE'] *= 1 + v;
        else if (w.startsWith('crit chance')) m.CRIT += v;
        else if (w.startsWith('reload')) m.RELOAD *= 1 + v;
      }
    }
    const t = gunTune('revolver', fitted);
    m.RELOAD /= t.reloadMul;
    m.ACCURACY = 1 / t.hipSpreadMul;
    m.CRIT += t.critAdd;
    return m;
  }
  /** the right-hand panel's comparison bars: fitted now against the shown option */
  private stats(g: GunKey, slot: string, shown: Opt): SmithStat[] {
    const now = this.statsWith(g, slot, null), then = this.statsWith(g, slot, shown);
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const out: SmithStat[] = [];
    for (const k of Object.keys(now)) {
      if (k === 'MAGAZINE') out.push({ label: 'MAGAZINE', now: now[k], then: then[k], max: g === 'tommy' ? 120 : 6, text: (v) => `${Math.round(v)} rds` });
      else if (k === 'CRIT') out.push({ label: 'CRIT', now: now[k], then: then[k], max: 0.2, text: (v) => `+${Math.round(v * 100)}%` });
      else out.push({ label: k, now: now[k], then: then[k], max: 2, text: pct });
    }
    return out;
  }
  /** everything the panels show this frame */
  private smithView(): SmithView | null {
    const d = this.work;
    if (!d || this.state !== 'work') return null;
    const g = d.g;
    const ids = this.slotIds(g);
    this.selSlot = Math.max(0, Math.min(ids.length - 1, this.selSlot));
    const slot = ids[this.selSlot];
    const opts = this.allOptions(g, slot);
    const fitted = opts.find((o) => o.state === 'fitted') ?? opts[0];
    const shown = this.hoverOpt >= 0 && opts[this.hoverOpt] ? opts[this.hoverOpt] : fitted;
    const carried = g === 'revolver' ? null : Blueprints.guns().find((q) => q.id === g)?.carried ? 'Rides with me' : 'Stays home';
    const notes: string[] = [];
    if (shown.state === 'blueprint') notes.push('Its blueprint is still out there in the dunes.');
    if (shown.state === 'buy') notes.push(this.buyArmed?.key === shown.key ? `Click again to buy it for ${shown.price} gold.` : `For sale: ${shown.price} gold (you have ${loadSave().bank}).`);
    return {
      name: GUNS[g].name,
      title: GUNS[g].title,
      sling: carried,
      slots: ids.map((id) => {
        const all = this.allOptions(g, id);
        return {
          label: g === 'revolver' && id === 'mag' ? 'SPEEDLOADER' : SLOT_NAME[id] ?? id.toUpperCase(),
          part: (all.find((o) => o.state === 'fitted') ?? all[0]).name,
          owned: all.filter((o) => o.state === 'owned' || o.state === 'fitted').length - 1,
          locked: all.filter((o) => o.state === 'buy' || o.state === 'blueprint').length,
        };
      }),
      sel: this.selSlot,
      options: opts.map((o) => ({ name: o.name, state: o.state, price: o.price, armed: this.buyArmed?.key === o.key })),
      shown: { name: shown.name, desc: shown.desc || GUNS[g].desc, state: shown.state === 'fitted' ? 'FITTED' : shown.state === 'owned' ? 'IN THE TRAY' : shown.state === 'buy' ? 'FOR SALE' : 'NOT FOUND' },
      stats: this.stats(g, slot, shown),
      notes,
      schematic: this.schematicFor(g, slot, shown),
      exploded: this.exploded,
      busy: !!this.fly,
      tag: this.hoverComp ? { text: this.hoverComp.comp.label + (this.hoverComp.comp.slot ? '' : '  (fixed)'), x: this.hoverComp.x, y: this.hoverComp.y } : null,
    };
  }
  /** the card beside the rack for the gun you are looking at (while you browse) */
  private rackInfo(): RackInfo | null {
    if (this.state !== 'rack' || this.done || this.rack.focus === null || !this.st) return null;
    const g = RACK_ORDER[this.rack.focus];
    const found = this.rack.owned(g);
    if (!found) return { name: '? ? ?', title: 'An empty cradle', status: 'Not found yet', desc: 'Its shape is still in the dust on the boards. Somewhere out in the dunes there is a blueprint for it.', fitted: [], found };
    const carried = g === 'revolver' || Blueprints.guns().find((q) => q.id === g)?.carried;
    const fitted = this.slotIds(g).map((sl) => this.allOptions(g, sl).find((o) => o.state === 'fitted')).filter((o): o is Opt => !!o && (!!o.def || (!!o.gold && o.gold !== (REV_DEFAULT as unknown as Record<string, string>)[o.key.split(':')[1]]))).map((o) => o.name);
    return { name: GUNS[g].name, title: GUNS[g].title, status: g === 'revolver' ? 'On my hip' : carried ? 'On the sling' : 'Stays home', desc: GUNS[g].desc, fitted, found };
  }
  /** the schematic photograph for what is shown (its gun is built as a job once a choice has held a moment, then kept) */
  private schematicFor(g: GunKey, slot: string, o: Opt) {
    const key = `${g}:${this.configKey(g)}:${slot}:${o.key}`;
    if (this.schem.has(key)) return (this.schemShown = this.schem.get(key) ?? this.schemShown);
    if (this.schemWant.key !== key) this.schemWant = { key, t: 0 };
    if (this.schemWant.t > 0.25 && this.schemJob?.key !== key) {
      if (g === 'revolver') {
        const cfg = { ...(loadSave().gun as unknown as Record<string, string>) };
        if (o.gold) cfg[slot] = o.gold;
        let fitted = Blueprints.fitted('revolver');
        if (!o.gold && !GOLD_SLOTS.includes(slot as keyof GunLoadout)) fitted = fitted.filter((a) => a.slot !== slot).concat(o.def ? [o.def] : []);
        this.schemJob = { key, gen: weaponRigJob('revolver', fitted, { gun: cfg as never }) };
      } else this.schemJob = { key, gen: weaponRigJob(g, Blueprints.fitted(g).filter((a) => a.slot !== slot).concat(o.def ? [o.def] : [])) };
    }
    return this.schemShown;
  }
  /** a click on the panels */
  private onSmith(h: SmithHit) {
    const d = this.work;
    if (!d || !h || this.fly) return;
    const eng = this.h.engine;
    if (h.kind === 'slot') return this.selectSlot(h.i);
    if (h.kind === 'explode') return this.toggleExplode();
    if (h.kind === 'sling') return this.toggleSling();
    if (h.kind !== 'opt') return;
    const slot = this.slotIds(d.g)[this.selSlot];
    const o = this.allOptions(d.g, slot)[h.i];
    if (!o || o.state === 'fitted') return;
    if (o.state === 'blueprint') {
      eng.audio.play('rev_dry', { volume: 0.45, pitch: 1.2 });
      this.bubble.say('Need to find that blueprint first.');
      return;
    }
    if (o.state === 'buy') {
      if (this.buyArmed?.key !== o.key) {
        this.buyArmed = { key: o.key, t: 3.5 };
        eng.audio.play('rev_dry', { volume: 0.5, pitch: 0.7 });
        return;
      }
      this.buyArmed = null;
      if (!buy(o.key)) {
        eng.audio.play('ui_error', { volume: 0.7 });
        this.bubble.say("Can't cover that yet.");
        return;
      }
      eng.audio.play('chest_unlock', { volume: 0.8 });
      eng.audio.play('gold_burst', { volume: 0.7 });
      this.h.updateBank();
    }
    this.exploded = false;
    const cur = this.current(d.g, slot);
    if (!o.part && !o.gold && !o.def) {
      if (cur) this.unfit(cur);
      return;
    }
    if (o.gold && o.gold === (REV_DEFAULT as unknown as Record<string, string>)[slot]) {
      if (cur) this.unfit(cur);
      return;
    }
    if (o.part) this.fit(o.part);
    else {
      // its piece is still being cut for the tray: fit it straight away
      if (o.gold) {
        const sv = loadSave();
        (sv.gun as unknown as Record<string, string>)[slot] = o.gold;
        writeSave(sv);
        } else if (o.def) Blueprints.fit(d.g, o.def.id);
      this.rebuildWork();
      this.layout();
      this.burst(this.floatAt());
    }
  }
  private selectSlot(i: number) {
    const d = this.work;
    if (!d) return;
    const n = this.slotIds(d.g).length;
    const j = ((i % n) + n) % n;
    if (j !== this.selSlot) this.h.engine.audio.play('ui_hover', { volume: 0.3, pitch: 1.2 });
    this.selSlot = j;
    this.hoverOpt = -1;
  }
  private toggleExplode() {
    const d = this.work;
    if (!d || this.fly) return;
    if (!d.spec.meta?.explode) {
      this.bubble.say('She does not come apart, that one.');
      return;
    }
    this.exploded = !this.exploded;
    this.h.engine.audio.play(this.exploded ? 'whoosh' : 'rev_close', { volume: 0.4, pitch: this.exploded ? 1.3 : 1 });
    if (this.exploded) this.burst(this.ttAt.clone().add(new THREE.Vector3(0, this.felt + 0.08, 0)), 10);
  }
  /** jade and gold motes, and a few sparks */
  private burst(at: THREE.Vector3, n = 16) {
    this.h.particles.emit({ pos: at, count: n, spread: 0.9, up: 0.5, life: [0.6, 1.3], size: [0.02, 0.004], sprite: 'spark', color: [JADE, GOLD, 0xc8ffe8], additive: true, gravity: -0.6, drag: 1.5 });
  }
  /** the exploded view, the energy shell on the selected component, the rune circle and the aura */
  private updateMagic(rdt: number) {
    const d = this.work;
    const on = this.state === 'work' || this.state === 'down';
    this.rune?.update(rdt, on, this.t);
    this.auraK += ((on ? 1 : 0) - this.auraK) * (1 - Math.exp(-rdt * 2.5));
    if (this.aura) this.aura.intensity = this.auraK * (0.55 + Math.sin(this.t * 2.3) * 0.12);
    if (this.auraK > 0.4 && Math.random() < rdt * 10) {
      const a = Math.random() * Math.PI * 2, r = 0.12 + Math.random() * 0.2;
      const F = this.floatAt();
      this.h.particles.emit({ pos: { x: F.x + Math.cos(a) * r, y: F.y - 0.29, z: F.z - 0.04 + Math.sin(a) * r * 0.6 }, count: 1, vel: { x: 0, y: 0.07, z: 0 }, spread: 0.02, life: [1.6, 2.8], size: [0.012, 0.003], sprite: 'spark', color: [JADE, GOLD], additive: true, gravity: -0.05 });
    }
    if (this.board) this.board.grp.visible = this.state !== 'work' && this.state !== 'down';
    // exploded view: every component flies out along its own axis (the guns' layout), staggered, and back
    const want = this.exploded && this.state === 'work' && !this.fly ? 1 : 0;
    this.explodeK += (want - this.explodeK) * (1 - Math.exp(-rdt * (want ? 2.2 : 3.4)));
    if (Math.abs(this.explodeK - want) < 0.002) this.explodeK = want;
    const fn = d?.root.userData.explode as ((t: number) => void) | undefined;
    if (d && fn && (this.explodeK > 0 || this.lastEx > 0)) fn(this.explodeK);
    this.lastEx = this.explodeK;
    // the jade shell over the selected slot's components, a gold one over whatever the mouse is on
    const slot = d ? this.slotIds(d.g)[this.selSlot] : '';
    const key = d && this.state === 'work' ? `${d.root.uuid}:${slot}` : '';
    if (key !== (this.shell?.key ?? '')) {
      this.shell?.objs.forEach((m) => m.removeFromParent());
      this.shell = d && key ? { key, objs: this.shellOver(d, componentsOf(d.spec).filter((c) => c.slot === slot).map((c) => c.name), this.shellMat) } : null;
    }
    const hk = d && this.hoverComp && this.state === 'work' ? `${d.root.uuid}:${this.hoverComp.comp.name}` : '';
    if (hk !== (this.hoverShell?.key ?? '')) {
      this.hoverShell?.objs.forEach((m) => m.removeFromParent());
      this.hoverShell = d && hk && this.hoverComp && this.hoverComp.comp.slot !== slot ? { key: hk, objs: this.shellOver(d, [this.hoverComp.comp.name], this.hoverMat) } : null;
    }
    for (const [m, k] of [[this.shellMat, this.shell?.objs.length ? 1 : 0], [this.hoverMat, this.hoverShell?.objs.length ? 0.7 : 0]] as const) {
      m.uniforms.uT.value += rdt;
      m.uniforms.uK.value += ((this.state === 'work' ? k : 0) - m.uniforms.uK.value) * (1 - Math.exp(-rdt * 6));
    }
  }
  private lastEx = 0;
  // ======================================================================= the tray
  /** lay the gun's loose parts along the tray; fitted ones ride on the gun (with a hidden hit proxy) */
  private layout() {
    const g = this.sel;
    const loose = this.parts.filter((p) => p.gun === g && !this.fittedNow(p) && this.fly?.p !== p);
    const q = this.trayQuat();
    const show = this.state !== 'rack';
    for (const p of this.parts) {
      const flying = this.fly?.p === p || this.offs.some((f) => f.p === p);
      p.grp.visible = show && p.gun === g && (flying || !this.fittedNow(p));
      p.lock?.show(p.grp.visible && !flying);
    }
    // yours along the front row, the chained ones for sale along the back (smaller)
    const rows: [Part[], number, number][] = [
      [loose.filter((p) => this.usable(p)), this.trayZ + 0.068, g === 'revolver' ? 1.05 : 0.82],
      [loose.filter((p) => !this.usable(p)), this.trayZ - 0.07, g === 'revolver' ? 0.8 : 0.7],
    ];
    const span = this.trayLen - 0.07;
    const place: { p: Part; at: THREE.Vector3; s: number }[] = [];
    for (const [list, z, sc] of rows) {
      const tot = list.reduce((a, p) => a + p.len * sc + 0.028, 0) - 0.028;
      const k = tot > span ? span / tot : 1;
      let x = this.trayX - Math.min(tot * k, span) / 2;
      for (const p of list) {
        const L = p.len * sc * k;
        place.push({ p, at: new THREE.Vector3(x + L / 2, this.trayY, z), s: sc * k });
        x += L + 0.028 * k;
      }
    }
    for (const { p, at, s: sk } of place) {
      const m = new THREE.Object3D();
      m.quaternion.copy(q);
      m.scale.setScalar(sk);
      m.position.copy(at).sub(p.c.clone().multiplyScalar(sk).applyQuaternion(q));
      m.updateMatrixWorld(true);
      // measure it lying there to sit it on the felt
      p.home = m.matrixWorld.clone();
      const bb = new THREE.Box3();
      p.grp.updateMatrixWorld(true);
      p.grp.children.forEach((c) => {
        const mesh = c as THREE.Mesh;
        if (!mesh.geometry) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        bb.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrix).applyMatrix4(p.home!));
      });
      if (!bb.isEmpty()) p.home.premultiply(new THREE.Matrix4().makeTranslation(0, this.trayY - bb.min.y, 0));
      if (!this.offs.some((f) => f.p === p)) {
        p.home.decompose(p.grp.position, p.grp.quaternion, p.grp.scale);
        if (p.lock) {
          p.lock.grp.position.set(at.x, this.trayY + Math.max(0.04, bb.max.y - bb.min.y) + 0.012, at.z - 0.01);
          p.lock.grp.rotation.y = 0;
        }
      }
    }
    this.refreshProxies();
  }
  /** parts lie in the tray the way the gun lies on the turntable */
  private trayQuat() {
    return Q_FLAT.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.35));
  }
  /** (the fitted parts are the gun's own components now: a click on one selects its slot) */
  private refreshProxies() {
    for (const p of this.parts) {
      p.proxy?.removeFromParent();
      p.proxy = null;
    }
  }
  /** pieces are cut from a build with only that part fitted; they land where the gun has its slot */
  private shiftOf(_p: Part) {
    return new THREE.Vector3();
  }

  // ======================================================================= blueprints you haven't found: pinned over the board rack
  private *makePapers(): Generator<void, void, void> {
    const locked = Blueprints.list().filter((b) => !b.owned && b.kind !== 'gear' && b.kind !== 'gun');
    let slot = 0;
    for (const b of locked) {
      if (slot >= 18) break;
      const col = slot % 6, row = Math.floor(slot / 6);
      const at = new THREE.Vector3(-4.42 + col * 0.36 + (row % 2) * 0.1, 2.36 - row * 0.21, IN.back + 0.01 + slot * 0.0006);
      const w = 0.27;
      slot++;
      const tex = safe(() => blueprintPhoto(this.h.engine.renderer, b.id));
      if (tex) {
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
        mat.color.setScalar(2);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 1.6), mat);
        mesh.position.copy(at);
        mesh.rotation.z = Math.sin(slot * 2.3 + b.id.length) * 0.05;
        mesh.receiveShadow = true;
        const nail = new THREE.Mesh(nailGeo(), sharedVoxelMaterial);
        nail.position.set(0, w / 3.2 - 0.012, -0.004);
        mesh.add(nail);
        this.h.scene.add(mesh);
        this.papers.push({ id: b.id, mesh });
      }
      yield;
    }
  }

  // ======================================================================= the mode
  enter(): Mode | null {
    this.st = this.h.here;
    this.done = false;
    this.paperDelay = Math.min(this.paperDelay, 8);
    this.state = 'rack';
    const i = RACK_ORDER.indexOf(this.sel);
    this.scroll = i;
    this.rack.focus = i;
    this.home = { at: this.st.stand.clone(), face: this.st.face };
    this.goTo(this.rackRest());
    this.h.engine.audio.play('rev_open', { volume: 0.45 });
    this.listen(true);
    this.ensurePieces(this.sel);
    return this;
  }
  private rackRest() {
    const c = this.rack.bays[1]?.centre ?? new THREE.Vector3(0.2, 1.6, -3.1);
    const at = new THREE.Vector2(this.bx + 0.12, this.zFront + 0.4);
    return { at, face: Math.atan2(c.x - at.x, c.z - at.y) };
  }
  private workRest() {
    const at = new THREE.Vector2(this.ttAt.x - 1.42, this.zFront + 0.24);
    return { at, face: Math.atan2(this.ttAt.x - at.x, this.ttAt.z - at.y) };
  }
  /** look at another bay */
  private focusTo(i: number) {
    const n = RACK_ORDER.length;
    const j = Math.max(0, Math.min(n - 1, i));
    if (j !== this.rack.focus) {
      const g = RACK_ORDER[j];
      const own = this.rack.owned(g);
      this.h.engine.audio.play(!own ? 'paper_flutter' : g === 'revolver' ? 'rev_hammer' : g === 'shotgun' ? 'shotgun_pump' : 'lever_cycle', { volume: own ? 0.32 : 0.2, pitch: 1.1 });
      if (own && GUNS[g].lore && Math.random() < 0.35) this.bubble.say(GUNS[g].lore!);
    } else if (j !== i) this.h.engine.audio.play('ui_error', { volume: 0.2, pitch: 1.4 });
    this.rack.focus = j;
    this.sel = RACK_ORDER[j];
    if (this.rack.owned(this.sel)) {
      this.ensurePieces(this.sel);
    }
  }
  /** the gun comes down off the rack onto the turntable */
  private takeDown() {
    const b = this.rack.bayOf(this.sel);
    if (!b.disp || b.out || this.gunFly) return;
    const d = b.disp;
    b.out = true;
    this.state = 'down';
    this.spinTo = 0;
    this.selSlot = 0;
    this.exploded = false;
    this.explodeK = 0;
    const top = this.tt?.nodes['top'];
    this.spin = 0;
    if (top) top.rotation.y = 0;
    const a = { p: d.hold.getWorldPosition(new THREE.Vector3()), q: d.hold.getWorldQuaternion(new THREE.Quaternion()), s: d.hold.scale.x };
    this.gunFly = { t: 0, dur: 1.15, d, down: true, a, b: this.benchPose(d) };
    this.h.engine.audio.play(d.g === 'revolver' ? 'rev_spin' : 'shotgun_pump', { volume: 0.5 });
    this.goTo(this.workRest());
    this.rack.focus = null;
    if (d.g === 'revolver') this.rack.refreshLedge();
    this.ensurePieces(d.g);
  }
  /** the gun goes back up into its bay */
  private putBack() {
    const d = this.work;
    if (!d || this.gunFly || this.fly) return;
    const b = this.rack.bayOf(d.g);
    this.state = 'up';
    this.exploded = false;
    this.explodeK = 0;
    d.root.visible = true;
    this.clearShell();
    for (const p of this.parts) {
      p.proxy?.removeFromParent();
      p.proxy = null;
    }
    this.benchClip?.removeFromParent();
    this.benchClip = null;
    const a = { p: d.hold.getWorldPosition(new THREE.Vector3()), q: d.hold.getWorldQuaternion(new THREE.Quaternion()), s: d.hold.scale.x };
    this.h.scene.attach(d.hold);
    const rest = this.rack.restPose(b, d);
    this.gunFly = { t: 0, dur: 1.0, d, down: false, a, b: { p: rest.pos, q: rest.quat, s: rest.scale } };
    this.work = null;
    this.h.engine.audio.play('rev_close', { volume: 0.45 });
    this.goTo(this.rackRest());
    this.layout();
  }
  /** where a gun lies on the turntable (world) */
  /** where the gun floats over the turntable while you work on it: in front of the lamp, at the lens' height */
  private floatAt() {
    return this.ttAt.clone().add(new THREE.Vector3(0, 0.55, 0.3));
  }
  /** the gun's pose floating over the turntable: upright, its right flank to you, turned by the platter's spin (world) */
  private benchPose(d: Display, spin = 0, bob = 0) {
    const s = scaleOf(d.g, 'bench');
    const c0 = poseBox(d, Q_SIDE, s).getCenter(new THREE.Vector3());
    const r = new THREE.Quaternion().setFromAxisAngle(_up, spin);
    const p = this.floatAt().sub(c0.applyQuaternion(r));
    p.y += bob;
    return { p, q: r.multiply(Q_SIDE), s };
  }

  view(): View | null {
    if (this.state === 'rack') {
      const bays = this.rack.bays;
      if (!bays.length) return null;
      const s = Math.max(0, Math.min(bays.length - 1, this.scroll));
      const i0 = Math.floor(s), i1 = Math.min(bays.length - 1, i0 + 1), f = s - i0;
      const c = bays[i0].centre.clone().lerp(bays[i1].centre, f);
      const mid = bays[1].centre;
      // the look leads toward the bay, the camera follows less: a glide along the rack that keeps it in frame
      const look = new THREE.Vector3(mid.x + (c.x - mid.x) * 0.6, 1.73, this.rack.backZ);
      const pos = new THREE.Vector3(mid.x + (c.x - mid.x) * 0.35, 1.77, this.rack.frontZ + 1.7);
      return { pos, look, fov: 50 };
    }
    const T = this.ttAt;
    const rev = (this.work?.g ?? this.sel) === 'revolver';
    void T;
    const F = this.floatAt();
    const k = 1 + this.explodeK * 0.22;
    return rev
      ? { pos: F.clone().add(new THREE.Vector3(0, 0.1, 1.0 * k)), look: F.clone().add(new THREE.Vector3(0, -0.03, 0)), fov: 40 }
      : { pos: F.clone().add(new THREE.Vector3(0, 0.14, 1.52 * k)), look: F.clone().add(new THREE.Vector3(0, -0.03, 0)), fov: 40 };
  }
  step(d: number) {
    if (this.state === 'rack') this.focusTo((this.rack.focus ?? 1) + d);
    else if (this.state === 'work') {
      this.spinTo = Math.max(-1.1, Math.min(1.1, this.spinTo + d * 0.45));
      this.h.engine.audio.play('lever_cycle', { volume: 0.15, pitch: 1.6 });
    }
  }
  hint() {
    const touch = !!(this.h as unknown as { touch?: boolean }).touch;
    if (this.state === 'rack') return touch ? 'Swipe: browse the rack   ·   tap the gun: take it down' : 'Drag, A / D or the wheel: browse the rack   ·   click the gun: take it down   ·   Esc: done';
    if (this.state === 'work' && !this.fly) return touch ? 'Tap a component, then a part   ·   swipe: turn it   ·   tap away: back on the rack' : 'W / S: component   ·   click a part to fit it   ·   X: explode   ·   drag: turn it   ·   Esc: back on the rack';
    return '';
  }
  back() {
    if (this.gunFly || this.fly) return false;
    if (this.state === 'work') {
      this.putBack();
      return false;
    }
    this.goTo(this.home);
    this.rack.focus = null;
    this.rack.spotOverride = null;
    this.listen(false);
    this.done = true;
    this.h.engine.audio.play('rev_close', { volume: 0.35 });
    return true;
  }
  picks(): Pick[] {
    if (this.swallow || this.gunFly || this.fly) return [];
    const out: Pick[] = [];
    if (this.state === 'rack') {
      for (const b of this.rack.bays) {
        const obj = b.disp && !b.out ? b.disp.hold : b.dust ?? b.plateMesh;
        if (!obj) continue;
        out.push({
          obj,
          lift: false,
          tip: () => '',
          click: () => (this.pending = () => {
            if (b.i !== this.rack.focus) this.focusTo(b.i);
            else if (b.disp) this.takeDown();
            else this.bubble.say(['Haven\'t found that one yet.', 'Heard tell of one like it out past the dunes.', 'That cradle\'s waiting on a blueprint.'][Math.floor(Math.random() * 3)]);
          }),
        });
      }
      return out;
    }
    if (this.state !== 'work' || !this.work) return out;

    for (const p of this.parts) {
      if (p.gun !== this.work.g) continue;
      if (p.proxy) out.push({ obj: p.proxy, lift: false, tip: () => '', click: () => (this.pending = () => this.unfit(p)) });
      else if (p.grp.visible) out.push({ obj: p.grp, tip: () => '', click: () => (this.pending = () => this.fit(p)) });
    }
    // the gun itself and the clipboard catch clicks without doing anything (a click on them is not a click away)
    out.push({ obj: this.work.hold, lift: false, tip: () => '', click: () => undefined });
    if (this.board) out.push({ obj: this.board.grp, lift: false, tip: () => '', click: () => undefined });
    return out;
  }

  // ======================================================================= swapping parts
  private cycle(slot: string) {
    const d = this.work;
    if (!d) return;
    const opts = this.options(d.g, slot);
    const cur = this.current(d.g, slot);
    if (opts.length <= 1) {
      this.h.engine.audio.play('rev_dry', { volume: 0.45, pitch: 1.2 });
      const lk = this.lockedCount(d.g, slot);
      this.bubble.say(lk ? (d.g === 'revolver' ? 'Buy one off the tray first.' : 'Need a blueprint for that.') : 'Nothing else fits there.');
      return;
    }
    const i = opts.findIndex((o) => o.part === cur);
    const next = opts[(i + 1) % opts.length];
    if (!next.part) {
      if (cur) this.unfit(cur);
    } else this.fit(next.part);
  }
  private toggleSling() {
    const d = this.work;
    if (!d || d.g === 'revolver') return;
    const carried = Blueprints.guns().find((q) => q.id === d.g)?.carried;
    Blueprints.setSecondary(carried ? null : d.g);
    this.h.engine.audio.play(carried ? 'rev_close' : 'shotgun_pump', { volume: 0.6 });
    this.bubble.say(carried ? 'Stays home today.' : `${GUNS[d.g].name} rides with me.`);
    this.rack.refreshTags();
  }
  private fit(p: Part) {
    if (p.lock && !p.lock.open && !p.lock.click()) return;
    this.exploded = false;
    this.startPrebuild(p);
    const d = this.work;
    if (!d || this.fly) return;
    const prev = this.current(p.gun, p.slot);
    p.grp.updateMatrixWorld(true);
    const shift = this.shiftOf(p);
    this.fly = { p, t: 0, on: true, from: p.grp.matrixWorld.clone(), to: d.root, shift, back: null, joint: new THREE.Vector3() };
    this.queue = prev && prev !== p ? () => this.popOff(prev) : null;
    this.wt = 0;
    this.layout();
    // he steps up beside the turntable to set it
    const j = this.v.copy(p.c).add(shift).applyMatrix4(d.root.matrixWorld);
    // (always from the left of the turntable, so he never stands between you and the gun)
    const at = new THREE.Vector2(Math.min(j.x - 0.42, this.ttAt.x - 0.66), this.zFront + 0.3);
    this.goTo({ at, face: Math.atan2(j.x - at.x, j.z - at.y) });
  }
  /** take a part off: saved now, it flies from the gun back into the tray */
  private unfit(p: Part) {
    const d = this.work;
    if (!d || this.fly) return;
    d.root.updateMatrixWorld(true);
    const from = d.root.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(this.shiftOf(p)));
    this.apply(p, false);
    this.offs.push({ p, t: 0, on: false, from, to: null, shift: new THREE.Vector3(), back: null, joint: new THREE.Vector3() });
    this.layout();
    this.h.engine.audio.play('rev_eject', { volume: 0.45 });
  }
  /** a part that was replaced pops off the gun back into the tray (its new place) */
  private popOff(p: Part) {
    this.offs.push({ p, t: 0, on: false, from: this.lastRoot.clone().multiply(new THREE.Matrix4().makeTranslation(this.lastShift)), to: null, shift: new THREE.Vector3(), back: null, joint: new THREE.Vector3() });
    this.layout();
  }
  private lastRoot = new THREE.Matrix4();
  private lastShift = new THREE.Vector3();
  /** the save: fit or remove, then the gun is rebuilt on the turntable */
  private apply(p: Part, on: boolean) {
    const prevShift = (() => {
      const q = this.current(p.gun, p.slot);
      return q ? this.shiftOf(q) : new THREE.Vector3();
    })();
    if (this.work) {
      this.work.root.updateMatrixWorld(true);
      this.lastRoot.copy(this.work.root.matrixWorld);
      this.lastShift.copy(prevShift);
    }
    if (p.key) {
      const [slot, o] = p.id.split(':') as [keyof GunLoadout, string];
      const d = loadSave();
      (d.gun as unknown as Record<string, string>)[slot] = on ? o : (REV_DEFAULT as unknown as Record<string, string>)[slot];
      writeSave(d);
    } else if (on) Blueprints.fit(p.gun, p.id);
    else Blueprints.unfit(p.gun, p.slot as 'under');
    this.rebuildWork(on ? p.id : null);
  }
  /** build the gun as it will be with a part fitted, a component a frame, while the part flies and the wrench turns */
  private startPrebuild(p: Part) {
    const g = p.gun;
    let fitted = Blueprints.fitted(g);
    let gun: GunLoadout | undefined;
    if (p.key) gun = { ...(loadSave().gun as GunLoadout), [p.slot]: p.id.split(':')[1] } as GunLoadout;
    else fitted = fitted.filter((a) => a.slot !== p.slot).concat(ATTACHMENTS[p.id] ? [ATTACHMENTS[p.id]] : []);
    this.prebuild = { key: p.id, gen: weaponRigJob(g, fitted, gun ? { gun: gun as never } : {}), spec: null, done: false };
  }
  /** swap the gun on the turntable for a fresh build with what is fitted now (the prebuilt one when it matches) */
  private rebuildWork(prebuilt: string | null = null) {
    const old = this.work;
    if (!old) return;
    let d: Display | null = null;
    const pb = this.prebuild;
    if (prebuilt && pb && pb.key === prebuilt) {
      while (!pb.done) {
        const r = pb.gen.next();
        if (r.done) {
          pb.done = true;
          pb.spec = r.value;
        }
      }
      if (pb.spec) d = displayFromSpec(old.g, pb.spec);
    }
    this.prebuild = null;
    d ??= buildDisplay(old.g);
    if (!d) return;
    const parent = old.hold.parent;
    d.hold.position.copy(old.hold.position);
    d.hold.quaternion.copy(old.hold.quaternion);
    d.hold.scale.copy(old.hold.scale);
    // (a longer or shorter barrel: the float pose recentres it next frame)
    for (const p of this.parts) {
      if (p.proxy?.parent === old.root) {
        p.proxy.removeFromParent();
        p.proxy = null;
      }
    }
    old.hold.removeFromParent();
    parent?.add(d.hold);
    this.work = d;
    this.rack.bayOf(d.g).disp = d;
    if (this.fly?.to === old.root) this.fly.to = d.root;
    this.clearShell();
    this.dressBenchClip();
  }
  /** the moon clip, when fitted, lies on the baize beside the six-shooter */
  private dressBenchClip() {
    this.benchClip?.removeFromParent();
    this.benchClip = null;
    const top = this.tt?.nodes['top'];
    if (!top || this.work?.g !== 'revolver' || !Blueprints.fitted('revolver').some((a) => a.id === 'rev_speedloader')) return;
    const cg = geoOf(safe(() => WS.moonClip()));
    if (!cg) return;
    this.benchClip = meshOf(cg);
    this.benchClip.position.set(0.04, this.feltTop + 0.002, 0.12);
    this.benchClip.scale.setScalar(1.2);
    top.add(this.benchClip);
  }

  // ======================================================================= input: drag / swipe, click-on-release
  private onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement)?.closest?.('button,a,input')) return;
    const d = this.drag;
    d.down = true;
    d.moved = false;
    d.x0 = d.x = d.lx = e.clientX;
    d.lt = performance.now();
    d.vx = 0;
    d.s0 = this.scroll;
    d.spin0 = this.spinTo;
  };
  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d.down) return;
    d.x = e.clientX;
    const now = performance.now();
    const dt = Math.max(1, now - d.lt);
    d.vx = d.vx * 0.6 + ((e.clientX - d.lx) / dt) * 0.4;
    d.lx = e.clientX;
    d.lt = now;
    if (Math.abs(d.x - d.x0) > 12) {
      d.moved = true;
      this.pending = null;
    }
  };
  private onUp = () => {
    const d = this.drag;
    if (!d.down) return;
    d.down = false;
    if (d.moved && this.state === 'rack') {
      const flick = -d.vx * 0.9;
      this.focusTo(Math.round(this.scroll + Math.max(-1, Math.min(1, flick))));
    }
  };
  private listen(on: boolean) {
    if (on === this.listening) return;
    this.listening = on;
    const f = on ? window.addEventListener : window.removeEventListener;
    f('pointerdown', this.onDown as EventListener);
    f('pointermove', this.onMove as EventListener);
    f('pointerup', this.onUp as EventListener);
    f('pointercancel', this.onUp as EventListener);
    if (!on) this.drag.down = false;
  }

  // ======================================================================= per frame
  tick(t: number, rdt: number) {
    this.t = t;
    this.paperDelay -= rdt;
    // the tray's parts: right away once a gun is on the turntable, else in the frame's spare slot
    if (this.state !== 'rack' && this.pieceJob) {
      try {
        if (this.pieceJob.next().done) this.pieceJob = null;
      } catch (e) {
        console.warn('[hub+] bench parts', e);
        this.pieceJob = null;
      }
    } else this.pieceJob = stepJob(this.pieceJob, 'bench parts');
    if (this.paperDelay <= 0) this.paperJob = stepJob(this.paperJob, 'bench papers');
    // the gun about to be fitted and the schematic's gun are built a component a frame
    const pb = this.prebuild;
    if (pb && !pb.done) {
      try {
        const r = pb.gen.next();
        if (r.done) {
          pb.done = true;
          pb.spec = r.value;
        }
      } catch (e) {
        console.warn('[hub+] prebuild', e);
        this.prebuild = null;
      }
    }
    const sj = this.schemJob;
    if (sj) {
      try {
        const r = sj.gen.next();
        if (r.done) {
          this.schemJob = null;
          this.schem.set(sj.key, r.value ? gunSchematic(this.h.engine.renderer, r.value, r.value.name) : null);
          if (this.schem.size > 30) this.schem.delete(this.schem.keys().next().value!);
        }
      } catch (e) {
        console.warn('[hub+] schematic', e);
        this.schemJob = null;
      }
    }
    for (const p of this.parts) p.lock?.update(rdt);
    this.rack.tick(rdt);
  }

  update(_t: number, rdt: number) {
    const eng = this.h.engine, inp = eng.input;
    this.swallow = false;
    // ---- the gunsmith's panels: what the mouse is over, a click on them, the keys
    let ui: SmithHit = null;
    if (this.state === 'work' && this.smith) {
      ui = this.smith.hit(inp.mouseX, inp.mouseY);
      this.uiHover = ui;
      this.hoverOpt = ui?.kind === 'opt' ? ui.i : -1;
      if (inp.wasPressed('Mouse0') && ui && !this.fly) {
        const h = ui;
        this.pending = () => this.onSmith(h);
      }
      if (!this.fly) {
        if (inp.wasPressed('KeyX')) this.toggleExplode();
        if (inp.wasPressed('KeyC')) this.toggleSling();
        if (inp.wasPressed('ArrowUp') || inp.wasPressed('KeyW')) this.selectSlot(this.selSlot - 1);
        if (inp.wasPressed('ArrowDown') || inp.wasPressed('KeyS')) this.selectSlot(this.selSlot + 1);
      }
    } else {
      this.uiHover = null;
      this.hoverOpt = -1;
    }
    if (this.buyArmed && (this.buyArmed.t -= rdt) <= 0) this.buyArmed = null;
    this.schemWant.t += rdt;
    // ---- a click on the gun picks the component under it; a click on nothing puts the gun back (decided on release)
    if (this.state === 'work' && !this.fly && inp.wasPressed('Mouse0') && this.work && !ui) {
      this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), this.h.camera);
      const gunHit = this.ray.intersectObjects([this.work.root], true)[0];
      if (gunHit) {
        const c = this.compOf(this.work, gunHit.object);
        const slot = c?.slot ? this.slotIds(this.work.g).indexOf(c.slot) : -1;
        if (slot >= 0) this.pending = () => this.selectSlot(slot);
        else if (c) this.pending = () => this.bubble.say(`The ${c.label.toLowerCase()} stays as she is.`);
      } else {
        const hits = this.ray.intersectObjects(this.picks().map((p) => p.obj), true);
        if (!hits.length) this.pending = () => this.putBack();
      }
    }
    if (this.pending && !inp.isDown('Mouse0') && !this.drag.down) {
      const f = this.pending;
      this.pending = null;
      if (!this.drag.moved) {
        f();
        this.swallow = true;
      }
    }
    // ---- browsing: the drag slides the view along the rack, the wheel steps
    if (this.state === 'rack') {
      const n = this.rack.bays.length;
      if (this.drag.down && this.drag.moved) {
        const per = Math.max(140, eng.width * 0.2);
        this.scroll = Math.max(-0.35, Math.min(n - 0.65, this.drag.s0 - (this.drag.x - this.drag.x0) / per));
        const near = Math.max(0, Math.min(n - 1, Math.round(this.scroll)));
        if (near !== this.rack.focus) this.focusTo(near);
      } else this.scroll = damp(this.scroll, this.rack.focus ?? 1, 5, rdt);
      if (inp.wheel) this.focusTo((this.rack.focus ?? 1) + Math.sign(inp.wheel));
    } else if (this.state === 'work') {
      if (this.drag.down && this.drag.moved) this.spinTo = Math.max(-1.2, Math.min(1.2, this.drag.spin0 + (this.drag.x - this.drag.x0) * 0.006));
    }
    // ---- the turntable turns (a slow drift while you look)
    const top = this.tt?.nodes['top'];
    if (top) {
      this.spin = damp(this.spin, this.spinTo, 4, rdt);
      top.rotation.y = this.spin + (this.state === 'work' ? Math.sin(this.t * 0.35) * 0.05 : 0);
    }
    // ---- the gun floats over the platter while you work on it, turning with it and breathing a little
    if (this.state === 'work' && this.work && !this.gunFly) {
      const pz = this.benchPose(this.work, this.spin + Math.sin(this.t * 0.35) * 0.05, Math.sin(this.t * 1.4) * 0.006);
      this.work.hold.position.copy(pz.p);
      this.work.hold.quaternion.copy(pz.q);
      this.work.hold.scale.setScalar(pz.s);
    }
    // ---- the gun coming down or going back up
    const gf = this.gunFly;
    if (gf) {
      gf.t += rdt;
      const u = clamp01(gf.t / gf.dur), e = ease(u);
      const b = gf.down ? this.benchPose(gf.d, this.spin) : gf.b;
      const hold = gf.d.hold;
      hold.position.lerpVectors(gf.a.p, b.p, e);
      // out from the wall and up, then down onto the baize (or back into the cradle)
      hold.position.y += Math.sin(Math.PI * u) * 0.16;
      hold.position.z += Math.sin(Math.PI * Math.min(1, u * 1.3)) * 0.22;
      hold.quaternion.slerpQuaternions(gf.a.q, b.q, ease(clamp01(u * 1.15 - 0.05)));
      hold.scale.setScalar(gf.a.s + (b.s - gf.a.s) * e);
      if (u >= 1) {
        this.gunFly = null;
        const bay = this.rack.bayOf(gf.d.g);
        if (gf.down) {
          this.work = gf.d;
          this.state = 'work';
          eng.audio.play('counter_clang', { volume: 0.22, pitch: 0.7 });
          this.h.particles.emit({ pos: this.ttAt.clone().add(new THREE.Vector3(0, this.felt + 0.02, 0)), count: 8, spread: 0.5, up: 0.25, life: [0.5, 1.1], size: [0.02, 0.006], color: 0xd8c8a0, gravity: -0.4 });
          this.dressBenchClip();
          this.layout();
        } else {
          this.rack.seat(bay);
          this.rack.focus = bay.i;
          this.state = 'rack';
          if (gf.d.g === 'revolver') this.rack.refreshLedge();
          eng.audio.play('rev_hammer', { volume: 0.3 });
        }
      }
    }
    // ---- the warm spot follows the gun down onto the turntable, and back up to the rack
    const T = this.ttAt;
    this.rack.spotOverride = this.state === 'work' || this.state === 'down' ? { pos: _sp.set(T.x + 0.3, T.y + 1.25, T.z + 0.85), target: _st.copy(this.floatAt()) } : null;
    // ---- pins, the hover, the work order, the panels and the magic
    if (this.state === 'work') this.hover();
    else this.hoverComp = null;
    this.writeBoard();
    this.updateMagic(rdt);
    this.smith?.frame(rdt, this.smithView(), this.uiHover, this.rackInfo());
    // ---- parts flying off the gun back to the tray
    for (const f of this.offs) {
      f.t += rdt;
      const u = clamp01(f.t / 0.7), e = ease(u);
      const to = f.p.home ?? f.from;
      lerpMatrix(f.p.grp, f.from, to, e, Math.sin(Math.PI * u) * 0.12);
      f.p.grp.visible = true;
    }
    if (this.offs.some((f) => f.t >= 0.7)) {
      this.offs = this.offs.filter((f) => f.t < 0.7);
      eng.audio.play('shell_casing', { volume: 0.45 });
      this.layout();
    }
    this.updateFit(rdt);
  }
  /** a part flying onto the gun; once he is at the gun, the wrench goes to work in a spray of sparks */
  private updateFit(rdt: number) {
    const f = this.fly;
    if (!f || !f.to) return;
    const eng = this.h.engine;
    f.t += rdt;
    const p = f.p;
    f.to.updateMatrixWorld(true);
    const target = f.to.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(f.shift));
    const u = clamp01(f.t / 0.8);
    lerpMatrix(p.grp, f.from, target, ease(u), Math.sin(Math.PI * u) * 0.16);
    p.grp.visible = true;
    const joint = f.joint.copy(p.c).applyMatrix4(target);
    let done = false;
    if (u >= 1) {
      if (this.h.route.length === 0 && this.h.atK > 0.5) this.wt += rdt;
      const wt = this.wt;
      if (wt > 0 && wt < 1.1) {
        if (this.wrench) {
          this.wrench.visible = true;
          this.wrench.position.copy(joint).add(new THREE.Vector3(-0.05, 0.07, 0.06));
          this.wrench.rotation.set(-Math.PI / 2, 0, Math.sin(wt * 14) * 0.5 + 0.4);
        }
        if (Math.random() < rdt * 26) this.h.particles.emit({ pos: joint, count: 2, spread: 0.9, up: 0.6, life: [0.2, 0.45], size: [0.03, 0.006], sprite: 'spark', color: 0xffc860, additive: true, gravity: -6, stretch: 0.03 });
        if (Math.floor(wt * 7) !== Math.floor((wt - rdt) * 7)) eng.audio.play(Math.random() < 0.5 ? 'rev_close' : 'counter_clang', { volume: 0.35, pitch: 1.2 + Math.random() * 0.3 });
      }
      done = wt >= 1.15 || f.t > 7;
    }
    if (!done) return;
    if (this.wrench) this.wrench.visible = false;
    this.fly = null;
    this.wt = 0;
    this.apply(p, true);
    eng.audio.play('rev_spin', { volume: 0.5 });
    this.h.particles.emit({ pos: joint, count: 12, spread: 1.4, up: 0.8, life: [0.3, 0.6], size: [0.04, 0.008], sprite: 'spark', color: 0xffe0a0, additive: true, gravity: -6 });
    this.burst(joint, 22);
    if (Math.random() < 0.6) this.bubble.say(['That\'ll do.', 'Snug as a tick.', 'Now we\'re talking.', 'Purrs like a cat.'][Math.floor(Math.random() * 4)]);
    const q = this.queue;
    this.queue = null;
    q?.();
    this.layout();
    this.goTo(this.workRest());
  }
  /** what the mouse is over at the turntable (the tag grows a touch; the work order reads it out) */
  private hover() {
    const inp = this.h.engine.input;
    this.hovered = null;
    this.hoverComp = null;
    const d = this.work;
    if (this.fly || !d || this.uiHover) return;
    this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), this.h.camera);
    const g = this.ray.intersectObject(d.root, true)[0];
    const c = g ? this.compOf(d, g.object) : null;
    if (c) {
      this.hoverComp = { comp: c, x: inp.mouseX, y: inp.mouseY };
      return;
    }
    const objs: THREE.Object3D[] = [];
    for (const p of this.parts) if (p.gun === d.g && p.grp.visible) objs.push(p.grp);
    const hit = this.ray.intersectObjects(objs, true)[0];
    for (let o: THREE.Object3D | null = hit?.object ?? null; o; o = o.parent) {
      const p = this.parts.find((q) => q.grp === o);
      if (p) return void (this.hovered = p);
    }
  }
  /** the work order on the clipboard: the gun, or whatever you point at */
  private writeBoard() {
    const b = this.board;
    if (!b) return;
    const g = this.work?.g ?? this.sel;
    const own = this.rack.owned(g);
    const L: Parameters<TextCard['set']>[0] = [{ t: 'WORK ORDER', size: 0.055, color: '#8a2a14' }];
    const hv = this.hovered;
    if (!own) L.push({ t: 'Nothing on the bench', size: 0.06 });
    else if (hv) {
      const p = hv as Part;
      L.push({ t: p.proxy ? 'On the gun' : 'In the tray', size: 0.05, color: '#5a4228' }, { t: p.name, size: 0.072, wrap: true }, { t: p.desc, size: 0.046, wrap: true });
      L.push({ t: p.lock && !p.lock.open ? p.lock.tip(p.name).replace(p.name + ': ', '').replace(`${p.name} `, '') : p.proxy ? 'Click: take it off' : 'Click: fit it', size: 0.046, color: '#8a2a14', wrap: true });
    } else {
      L.push({ t: GUNS[g].name, size: 0.08 }, { t: GUNS[g].title, size: 0.05, color: '#5a4228' }, { t: GUNS[g].desc, size: 0.044, wrap: true });
      const ups = Blueprints.upgrades().filter((u) => u.owned && (!u.gun || u.gun === g));
      if (ups.length) L.push({ t: 'Loaded with: ' + ups.map((u) => u.name).join(', '), size: 0.044, color: '#8a2a14', wrap: true });
    }
    b.card.set(L, 0.07);
  }

  // ======================================================================= Sundown
  private rest = { at: new THREE.Vector2(), face: 0 };
  private home = { at: new THREE.Vector2(), face: 0 };
  private goTo(s: { at: THREE.Vector2; face: number }) {
    const st = this.st;
    if (!st) return;
    this.rest = s;
    st.stand.copy(s.at);
    st.face = s.face;
    this.h.route = [s.at.clone()];
  }
  /** his hand on the wrench while a part seats */
  poseHero(_t: number, _rdt: number) {
    const f = this.fly;
    if (!f || !f.on || this.wt <= 0) return;
    const w = sstep(0, 0.25, this.wt) * (1 - sstep(0.95, 1.15, this.wt));
    if (this.wrench?.visible) reach(this.h, 'r', this.wrench.position.clone().add(new THREE.Vector3(-0.05, 0, 0.05)), new THREE.Vector3(-1, -0.4, -0.2), w);
  }

  dispose() {
    this.listen(false);
    for (const p of this.parts) p.lock?.dispose();
    for (const pp of this.papers) (pp.mesh.material as THREE.Material).dispose();
    this.clearShell();
    this.board?.card.dispose();
    this.rack.dispose();
    this.smith?.dispose();
    this.rune?.dispose();
    this.shellMat.dispose();
    this.hoverMat.dispose();
  }
}

/** move an object along a matrix blend (position eased with a hop, rotation slerped, scale lerped) */
const _sp = new THREE.Vector3(), _st = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** floating at the turntable: upright, muzzle to the right, the right flank to you */
const Q_SIDE = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)));
const _pa = new THREE.Vector3(), _qa = new THREE.Quaternion(), _sa = new THREE.Vector3(), _pb = new THREE.Vector3(), _qb = new THREE.Quaternion(), _sb = new THREE.Vector3();
function lerpMatrix(o: THREE.Object3D, A: THREE.Matrix4, B: THREE.Matrix4, e: number, hop: number) {
  A.decompose(_pa, _qa, _sa);
  B.decompose(_pb, _qb, _sb);
  o.position.lerpVectors(_pa, _pb, e);
  o.position.y += hop;
  o.quaternion.slerpQuaternions(_qa, _qb, e);
  o.scale.lerpVectors(_sa, _sb, e);
}
function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** the shared laser geometry is not the component's to dispose */
function laserGeoRef(o: THREE.Object3D) {
  return (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.userData?.shared ? (o as THREE.Mesh).geometry : null;
}

/** a part's piece for the tray: its slot's components from a build with it fitted, meshed in rig space */
function componentPiece(spec: RigSpec, slot: string): THREE.Group | null {
  const names = new Set(componentsOf(spec).filter((c) => c.slot === slot).map((c) => c.name));
  if (!names.size) return null;
  const grp = new THREE.Group();
  for (const p of spec.parts) {
    if (!names.has(p.name)) continue;
    const mesh = meshOf(buildVoxelGeometry(p.model, { voxelSize: spec.voxelSize, pivot: p.pivot }), sharedVoxelMaterial);
    mesh.applyMatrix4(restMatrix(spec, p.name));
    grp.add(mesh);
  }
  return grp.children.length ? grp : null;
}
