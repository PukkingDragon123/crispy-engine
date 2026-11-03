// The house, more lived in: herbs drying on a twine by the hearth, the pet
// scorpion in its tank under the front window, the squeaky board on the lane,
// a cowhide, and the TROPHY WALL on the front wall: a WANTED bill for every
// great power of the Reach (photographed from its own 3D model; a "?" until you
// have seen it; crossed out in red paint once you have beaten it) and, above
// them, a carved plaque with the mounted head of each boss you have beaten.
import * as THREE from 'three';
import { RigInstance, buildRigGeo, RigSpec } from '../../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { makeVoxelMaterial, sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import * as HX from '../../models/props/hideout';
import * as WS from '../../models/props/workshop';
import { modelEntry } from '../../models/lookup';
import { IconFactory } from '../../ui/IconFactory';
import { PARCHMENT_GLSL } from '../../ui/Choice';
import { Codex, F_SEEN, F_CLAIM } from '../../meta/Codex';
import { Blueprints, RELICS } from '../../meta/Blueprints';
import * as PM from '../../models/props';
import { damp } from '../../../engine/math/rand';
import { BuildKit, HubHost, HubStation, HeroBubble, SM, safe, geoOf, meshOf, engrave, clamp01, ease, stepJob, nailGeo } from './HubKit';

const IN = HX.CABIN_IN;
/** the trophy wall: the front wall between the two front windows */
const WALL_Z = IN.front;
const BILL_W = 0.34, BILL_H = 0.47;

/** what Sundown says about each one he has put on the wall */
const TALES: Record<string, string> = {
  khonsu: 'The moon god sent his avatar. I sent it back in a bag.',
  khonsuSand: 'Khonsu of the Sands. Swept him up. Mostly.',
  sethos: 'Sethos. Hand of Set. Shook it. Kept it.',
  setAvatar: 'The Red God walked. Then he limped.',
  bertha: 'Big Bertha. Her kids still write.',
  marshal: 'The Dust Marshal. Third time was the charm.',
  sunroller: 'Got the Sunroller off his ball. Upside down, he cried.',
  pharaoh: 'Nekh-Amun refused to lie down. He lies down now.',
  gulp: 'Old Gulp. I was inside him a while. Long story.',
  ironclad: 'The Ironclad missed the last train out.',
  thornback: 'Old Thornback. Still picking needles out of my ribs.',
};
/** the short name on each trophy's brass plate */
const PLATE: Record<string, string> = { khonsu: 'KHONSU', khonsuSand: 'KHONSU', sethos: 'SETHOS', setAvatar: 'SET', bertha: 'BERTHA', marshal: 'MARSHAL', sunroller: 'SUNROLLER', pharaoh: 'NEKH-AMUN', gulp: 'OLD GULP', ironclad: 'IRONCLAD', thornback: 'THORNBACK' };
const WS_TV = 1 / 96;
const UNBEATEN = ['Plenty of wall left.', 'Still out there. Not for long.', 'One day, the whole wall.', 'Every nail is a promise.'];

interface BossRow {
  id: string;
  name: string;
  title: string;
  model?: string;
  wave: string;
  seen: boolean;
  beaten: boolean;
}

// ======================================================================= the WANTED bills
const BILL_PAPER = /* glsl */ `
{
  vec2 pUv = vMapUv;
  float pEdge = paperEdge(pUv, uAspect);
  float pTear = paperTear(pUv, 0.03);
  if (pEdge < pTear) discard;
  vec3 pCol = parchment(pUv, uAspect, pEdge, pTear);
  if (bulletHole(pUv, uAspect, vec2(0.5, 0.962), 0.028, pCol) < 0.5) discard;
  pCol *= 1.0 - uAge * 0.25 * smoothstep(0.3, 0.9, pFbm(pUv * 5.0 + uSeed));
  vec3 pLin = pow(pCol, vec3(2.2));
  vec4 pInk = texture2D(map, pUv);
  float pPress = 0.8 + 0.2 * smoothstep(0.2, 0.6, pNoise(pUv * vec2(uAspect, 1.0) * 200.0));
  pLin = mix(pLin, pInk.rgb * mix(vec3(1.0), pLin * 1.1, 0.2), pInk.a * pPress);
  diffuseColor.rgb *= pLin;
}`;

/** one bill: typography + the photographed portrait on shader paper, curling off the wall at its foot */
class BountyBill {
  mesh: THREE.Mesh;
  private cv = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  constructor(private b: BossRow, age: number) {
    this.paint(null);
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const u = { uSeed: { value: Math.random() }, uAspect: { value: BILL_W / BILL_H }, uAge: { value: age } };
    const mat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uAspect, uAge;\n' + PARCHMENT_GLSL)
        .replace('#include <map_fragment>', BILL_PAPER);
    };
    mat.customProgramCacheKey = () => 'dustup-bounty-bill';
    const g = new THREE.PlaneGeometry(BILL_W, BILL_H, 6, 9);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const xn = pos.getX(i) / (BILL_W / 2), yn = pos.getY(i) / (BILL_H / 2);
      const low = Math.pow((1 - yn) / 2, 2.4);
      pos.setZ(i, 0.004 + 0.022 * low * (0.4 + 0.6 * xn * xn) + 0.003 * Math.sin(xn * 2.7 + yn * 3.1));
    }
    g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }
  /** the ink: typography and (once it is baked) the sepia portrait */
  paint(portrait: HTMLCanvasElement | null) {
    const W = 300, H = 420, b = this.b;
    const cv = this.cv;
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d')!;
    c.clearRect(0, 0, W, H);
    c.imageSmoothingEnabled = false;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillStyle = '#2a160a';
    c.font = '54px Alagard';
    c.fillText('WANTED', W / 2, 22);
    c.font = '15px Alagard';
    c.fillText(b.seen ? '- DEAD OR ALIVE -' : '- SIGHTINGS WANTED -', W / 2, 80);
    if (b.seen && portrait) {
      const pw = portrait.width * 3, ph = portrait.height * 3;
      c.globalAlpha = 0.95;
      c.drawImage(portrait, Math.round(W / 2 - pw / 2), 104, pw, ph);
      c.globalAlpha = 1;
    } else if (!b.seen) {
      c.font = '150px Alagard';
      c.fillStyle = 'rgba(42,22,10,0.85)';
      c.fillText('?', W / 2, 108);
    }
    c.fillStyle = '#2a160a';
    const name = b.seen ? b.name.toUpperCase() : 'NAME UNKNOWN';
    let fs = 30;
    c.font = `${fs}px Alagard`;
    while (c.measureText(name).width > W - 36 && fs > 14) c.font = `${--fs}px Alagard`;
    c.fillText(name, W / 2, 278);
    c.font = '15px Alagard';
    c.fillStyle = '#4a2a14';
    const sub = b.seen ? b.title : 'Rumoured at wave ' + b.wave;
    c.fillText(sub.length > 34 ? sub.slice(0, 33) + '.' : sub, W / 2, 316);
    c.fillStyle = '#2a160a';
    c.font = '28px Alagard';
    const wave = parseInt(b.wave, 10) || 10;
    c.fillText(`$${(1000 + wave * 120).toLocaleString('en-US')} REWARD`, W / 2, 350);
    c.font = '13px Alagard';
    c.fillText('Sheriff of the Last Chance', W / 2, 392);
    if (this.tex) this.tex.needsUpdate = true;
  }
  dispose() {
    this.tex.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}

// ======================================================================= the decor
export class HouseDecor {
  private herbs: RigInstance | null = null;
  private board: RigInstance | null = null;
  private boardRect = { x0: 0, x1: 0, z0: 0, z1: 0 };
  private onBoard = false;
  private dip = 0;
  private squeaks = 0;
  // the pet
  private pet: RigInstance | null = null;
  private petHold = new THREE.Group();
  private petHalf: [number, number] = [0.2, 0.1];
  private petT = new THREE.Vector2();
  private petP = new THREE.Vector2();
  private petYaw = 0;
  private petWait = 2;
  private petWalk = 0;
  private petAlert = 0;
  private petPhase = 0;
  private petRest: Record<string, THREE.Euler> = {};
  private petScale = 0.14;
  private tankAt = new THREE.Vector3();
  // the trophy wall
  private bosses: BossRow[] = [];
  private bills: BountyBill[] = [];
  private trophies = new Map<string, { at: THREE.Vector3; grp: THREE.Group }>();
  private slots: THREE.Vector3[] = [];
  private job: Generator<void, void, void> | null = null;
  private icons: IconFactory | null = null;
  private tale = 0;
  /** a slow push-in on whatever he is talking about (HouseExtras hands it to the camera) */
  focus: { pos: THREE.Vector3; look: THREE.Vector3; fov: number; t: number; dur: number } | null = null;
  station: HubStation | null = null;
  private v = new THREE.Vector3();

  constructor(private h: HubHost, private bubble: HeroBubble) {}

  build(k: BuildKit) {
    const s = this.h.scene;
    // ---- herbs drying on a twine in the back-right corner, by the hearth
    this.herbs = k.rig(safe(() => WS.herbRig()), IN.right - 0.04, 2.24, -2.72, -Math.PI / 2, 'herbs');
    // ---- the squeaky board, in the lane where he walks (lined up on a floor board: z 0.30..0.40)
    const bs = safe(() => WS.looseBoardRig());
    this.board = k.rig(bs, -0.62, 0.002, 0.351, 0, 'squeak');
    if (this.board && bs) {
      const L = bs.meta!.length as number;
      this.boardRect = { x0: -0.62 - 0.05, x1: -0.62 + L + 0.05, z0: 0.351 - 0.17, z1: 0.351 + 0.17 };
      this.board.root.traverse((o) => ((o as THREE.Mesh).castShadow = false));
    }
    // ---- a cowhide in front of the trophy wall
    k.put(safe(() => WS.cowhideRug()), 0.95, 2.18, 0.1, 0.004, 1, false);
    // ---- the pet scorpion's tank on a cabinet under the front-left window
    const cab = k.against(safe(() => WS.sideCabinet(19)), 'front', -1.2, 0, 0.05, 0.92);
    if (cab) {
      const top = new THREE.Box3().setFromObject(cab).max.y;
      const ts = safe(() => WS.terrarium());
      const tg = geoOf(ts, WS.ORIGIN_PIVOT);
      const glassG = geoOf(safe(() => WS.terrariumGlass()), WS.ORIGIN_PIVOT);
      if (ts && tg) {
        const tank = new THREE.Group();
        tank.add(meshOf(tg));
        if (glassG) {
          const gm = makeVoxelMaterial({ transparent: true, opacity: 0.16 });
          gm.depthWrite = false;
          const glass = meshOf(glassG, gm, false);
          glass.renderOrder = 3;
          tank.add(glass);
        }
        tank.position.set(-1.2, top, WALL_Z - 0.3);
        tank.rotation.y = Math.PI + 0.06;
        s.add(tank);
        tank.updateMatrixWorld(true);
        this.tankAt.copy(tank.position);
        // the heat lamp's glow on the sand
        if (this.h.engine.quality.shadows) k.lamp(0xffb070, 0.55, 0.9, 2, new THREE.Vector3(...(ts.meta.lamp as number[])).applyMatrix4(tank.matrixWorld).add(new THREE.Vector3(0, -0.06, 0)), 0.04);
        this.petHalf = ts.meta.half;
        this.petHold.position.set(0, ts.meta.floor, 0);
        tank.add(this.petHold);
        this.buildPet();
      }
    }
    // ---- the relics you have dug up, on a curio shelf over the wax bench (one shelf per region)
    this.buildRelics(k);
    // ---- a cobweb high in the front-right corner
    k.put(safe(() => HX.cobweb(3)), IN.right - 0.05, IN.front - 0.05, Math.PI, 2.1, 1, false);
    // ---- the trophy wall: a picture light, the bills, the plaques
    this.bosses = this.readBosses();
    const pl = safe(() => WS.pictureLight());
    for (const px of [0.18, 1.62]) {
      const g = k.put(pl, px, WALL_Z - 0.01, Math.PI, 2.33, 1, false);
      if (g) g.position.z = WALL_Z - (g ? new THREE.Box3().setFromObject(g).getSize(this.v).z / 2 : 0);
    }
    k.lamp(0xffc888, 2.4, 3.2, 1.5, new THREE.Vector3(0.9, 2.05, WALL_Z - 0.75), 0.02);
    if (this.h.engine.quality.shadows) k.lamp(0xffb070, 0.8, 2.0, 1.6, new THREE.Vector3(0.6, 1.2, WALL_Z - 0.6));
    this.bosses.forEach((b, i) => {
      const row = i < 6 ? 0 : 1;
      const col = row === 0 ? i : i - 6;
      // two rows centred on the wall between the windows (x 0.9), staggered like they went up one at a time
      const x = 0.9 + (row === 0 ? col - 2.5 : col - 2) * 0.43 + Math.sin(i * 2.7) * 0.03;
      const y = (row === 0 ? 1.52 : 0.99) + Math.sin(i * 1.9) * 0.025;
      const bill = new BountyBill(b, 0.3 + (i % 3) * 0.3);
      bill.mesh.position.set(x, y, WALL_Z - 0.006 - i * 0.0007);
      bill.mesh.rotation.set(0, Math.PI, Math.sin(i * 3.1) * 0.045);
      s.add(bill.mesh);
      this.bills.push(bill);
      if (b.beaten) {
        const px = geoOf(safe(() => WS.paintCross(i)), 'center');
        if (px) {
          const m = meshOf(px, sharedVoxelMaterial, false);
          m.position.set(x, y - 0.02, WALL_Z - 0.03 - i * 0.0007);
          m.rotation.set(0, Math.PI, Math.sin(i * 5.3) * 0.12);
          s.add(m);
        }
      }
    });
    for (let i = 0; i < 11; i++) this.slots.push(new THREE.Vector3(-0.5 + i * 0.28, 2.08 + Math.sin(i * 1.7) * 0.015, WALL_Z));
    // empty slots get a nail waiting
    const beaten = this.bosses.filter((b) => b.beaten);
    this.slots.forEach((p, i) => {
      if (i < beaten.length) return;
      const n = new THREE.Mesh(nailGeo(), sharedVoxelMaterial);
      n.position.set(p.x, p.y + 0.13, WALL_Z);
      n.rotation.set(0.25, Math.PI, 0);
      s.add(n);
    });
    this.job = this.bake(beaten);
    // ---- the station
    // he stands off to the left of the wall (screen right), the camera back by the coffee table takes it all in
    const stand = new THREE.Vector2(-0.32, 2.02);
    this.station = k.station({
      id: 'trophies', label: 'Trophy Wall', title: 'THE TROPHY WALL', short: 'TROPHIES', sub: beaten.length ? `${beaten.length} of ${this.bosses.length} bounties paid in full` : 'every nail is a promise', verb: 'Spin a yarn',
      stand, face: 0.42, at: new THREE.Vector3(0.9, 1.7, WALL_Z), r: 0.9, objs: [], pose: 'trophies',
      via: [new THREE.Vector2(-0.32, 0.25)], slot: [-0.86, 0.84, 'left'],
      shot: { pos: new THREE.Vector3(0.62, 1.64, -1.12), look: new THREE.Vector3(), fov: 50, subject: new THREE.Vector3(stand.x, 1.42, stand.y), ndc: [0.36, -0.04] },
    });
  }

  private buildRelics(k: BuildKit) {
    const cs = safe(() => WS.curioShelf());
    const shelf = k.against(cs, 'left', -2.3, 1.46, 0.02, 1, false);
    if (!shelf || !cs) return;
    shelf.updateMatrixWorld(true);
    const P: Record<string, () => SM> = PM as unknown as Record<string, () => SM>;
    let regions: ReturnType<typeof Blueprints.relics> = [];
    try {
      regions = Blueprints.relics();
    } catch {
      return;
    }
    regions.forEach((r, ri) => {
      const y = cs.meta.shelves[2 - ri] ?? 0;
      r.list.forEach((rel, i) => {
        if (!rel.found) return;
        const def = RELICS.find((q) => q.id === rel.id);
        const g = geoOf(safe(() => P[def?.model ?? '']?.()));
        if (!g) return;
        const m = meshOf(g);
        const size = g.boundingBox!.getSize(this.v);
        m.scale.setScalar(Math.min(0.11 / Math.max(size.x, size.z, 0.01), 0.15 / Math.max(size.y, 0.01)));
        const n = r.list.length;
        m.position.set(-0.42 + (i + 0.5) * (0.84 / n), y + 0.002, -0.005);
        m.rotation.y = Math.sin(i * 2.3 + ri) * 0.5;
        shelf.add(m);
      });
    });
  }

  /** the bosses, in the Codex's order, with what Sundown knows of each */
  private readBosses(): BossRow[] {
    try {
      const sec = Codex.sections().find((q) => q.cat === 'boss');
      return (sec?.entries ?? []).map((e) => {
        const f = Codex.flags(e.key);
        const wave = (e.stats?.find((q) => q[0] === 'Waves')?.[1] ?? '').split(/[ ,·]/)[0] || '?';
        return { id: e.id, name: e.name, title: e.title, model: e.model, wave, seen: !!(f & (F_SEEN | F_CLAIM)), beaten: !!(f & F_CLAIM) };
      });
    } catch (e) {
      console.warn('[hub+] bosses', e);
      return [];
    }
  }

  /** one boss a frame: photograph it for its bill, mount the beaten ones' heads on plaques */
  private *bake(beaten: BossRow[]): Generator<void, void, void> {
    yield;
    for (let i = 0; i < this.bosses.length; i++) {
      const b = this.bosses[i];
      if (!b.seen || !b.model) continue;
      let ri: RigInstance | null = null;
      try {
        const spec = modelEntry(b.model)?.() as RigSpec | undefined;
        if (spec?.parts) {
          ri = new RigInstance(buildRigGeo(spec, spec.name + ':trophy'), { material: sharedVoxelMaterial, castShadow: true });
          ri.root.updateMatrixWorld(true);
          this.icons ??= new IconFactory(this.h.engine.renderer);
          const shot = this.icons.capture(ri.root, { w: 70, h: 54, ss: 3, yaw: 0.55, pitch: 0.12, fill: 0.9, light: 'sunset', ink: '#2a160a', rim: '#ffe2a8', levels: 10 });
          // print it: a sepia grade so it sits in the ink like an engraving
          const c = shot.getContext('2d')!;
          const id = c.getImageData(0, 0, shot.width, shot.height);
          const d = id.data;
          for (let k = 0; k < d.length; k += 4) {
            const l = (d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11) / 255;
            const q = Math.min(1, Math.max(0, (l - 0.04) * 1.1));
            d[k] = Math.min(255, 62 + q * 176);
            d[k + 1] = Math.min(255, 36 + q * 150);
            d[k + 2] = Math.min(255, 18 + q * 100);
          }
          c.putImageData(id, 0, 0);
          this.bills[i]?.paint(shot);
        }
      } catch (e) {
        console.warn('[hub+] bill', b.id, e);
      }
      yield;
      const slot = beaten.indexOf(b);
      if (slot >= 0 && ri) {
        try {
          this.mount(b, ri, slot);
        } catch (e) {
          console.warn('[hub+] trophy', b.id, e);
        }
        yield;
      }
    }
  }

  /** a carved plaque on the wall, its name engraved, the boss's head (or the whole beast, pinned) on the boss */
  private mount(b: BossRow, ri: RigInstance, slot: number) {
    const p = this.slots[slot];
    const pq = WS.trophyPlaque(31 + slot * 7);
    const [x0, y0, x1, y1, z] = pq.meta.plate;
    const g = geoOf(pq);
    if (!g) return;
    const grp = new THREE.Group();
    const pm = meshOf(g);
    grp.add(pm);
    // the name plate: fine brass (1/256) with the name engraved in Alagard, screwed over the plaque's plate
    const NV = 1 / 256, W = 23, Hh = 7;
    const nm = new VoxelModel('name_plate');
    for (let x = -W; x < W; x++)
      for (let y = -Hh; y < Hh; y++) {
        const rim = x === -W || x === W - 1 || y === -Hh || y === Hh - 1;
        nm.set(x, y, 0, 0x6a4a1c);
        nm.set(x, y, 1, rim ? 0x9a7430 : y > Hh - 3 ? 0xf0cc78 : 0xd8a850, VF.METAL);
      }
    for (const sx of [-W + 2, W - 3]) nm.set(sx, 0, 2, 0x8a6a30, VF.METAL);
    try {
      engrave(nm, PLATE[b.id] ?? b.name.split(' ').pop()!.toUpperCase(), 0, -0.5, 1, W * 2 - 10, 8, 0x3a2410, VF.METAL);
    } catch {
      /* no canvas: a blank plate */
    }
    const plate = meshOf(buildVoxelGeometry(nm, { voxelSize: NV, pivot: [0, 0, 0] }), sharedVoxelMaterial, false);
    const pb = pq.model.bounds();
    plate.position.set(((x0 + x1 + 1) / 2 - (pb.minX + pb.maxX + 1) / 2) * WS_TV, ((y0 + y1 + 1) / 2 - pb.minY) * WS_TV, (z + 1 - (pb.minZ + pb.maxZ + 1) / 2) * WS_TV);
    grp.add(plate);
    const back = -g.boundingBox!.min.z;
    grp.position.set(p.x, p.y - 0.165, WALL_Z - back - 0.004);
    grp.rotation.y = Math.PI;
    this.h.scene.add(grp);
    // keep only the head and what hangs off it
    const parts = ri.geo.parts;
    const hi = parts.findIndex((q) => /^(head|skull|helm)$/.test(q.name));
    if (hi >= 0) {
      const keep = new Set<number>([hi]);
      for (let k = 0; k < parts.length; k++) {
        let q = parts[k].parent;
        while (q >= 0 && !keep.has(q)) q = parts[q].parent;
        if (q >= 0) keep.add(k);
      }
      parts.forEach((q, k) => ri.setPartVisible(q.name, keep.has(k)));
    }
    ri.root.position.set(0, 0, 0);
    ri.root.rotation.set(0, 0, 0);
    ri.root.scale.setScalar(1);
    ri.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    ri.root.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh) box.expandByObject(o);
    });
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const sc = hi >= 0 ? Math.min(0.2 / size.y, 0.21 / size.x, 0.24 / size.z) : Math.min(0.2 / size.x, 0.2 / size.y, 0.12 / size.z);
    const hold = new THREE.Group();
    hold.position.set(pq.meta.mount[0], pq.meta.mount[1], pq.meta.mount[2] - 0.012);
    hold.rotation.y = Math.sin(slot * 2.3) * 0.28;
    ri.root.scale.setScalar(sc);
    ri.root.position.set(-c.x * sc, -c.y * sc, -box.min.z * sc);
    hold.add(ri.root);
    grp.add(hold);
    this.trophies.set(b.id, { at: new THREE.Vector3(p.x, p.y, WALL_Z), grp });
  }

  private buildPet() {
    const spec = safe(() => modelEntry('giant_scorpion_v2')?.() as RigSpec | undefined);
    if (!spec?.parts) return;
    const ri = new RigInstance(buildRigGeo(spec, spec.name + ':pet'), { material: sharedVoxelMaterial, castShadow: true });
    const len = (spec.meta?.length as number) || 2.4;
    this.petScale = 0.36 / len;
    ri.root.scale.setScalar(this.petScale);
    this.petHold.add(ri.root);
    this.pet = ri;
    for (const p of ri.geo.parts) this.petRest[p.name] = p.rest.clone();
    this.petT.set(0.05, 0);
  }

  // ======================================================================= the trophy station's yarn
  yarn() {
    const won = this.bosses.filter((b) => b.beaten);
    const st = this.station;
    if (!won.length) {
      this.bubble.say(UNBEATEN[this.tale++ % UNBEATEN.length]);
      return;
    }
    const b = won[this.tale++ % won.length];
    this.bubble.say(TALES[b.id] ?? `${b.name}. That one was personal.`);
    const tr = this.trophies.get(b.id);
    if (tr && st) {
      const look = tr.at.clone().add(new THREE.Vector3(0, -0.02, 0));
      this.focus = { pos: new THREE.Vector3(look.x + 0.35, 1.72, WALL_Z - 1.25), look, fov: 36, t: 0, dur: 5.2 };
    }
    this.h.engine.audio.play('page_turn', { volume: 0.2, pitch: 0.8 });
  }

  // ======================================================================= per frame
  update(t: number, rdt: number) {
    // the bake runs a slice each frame
    if (this.job) {
      this.job = stepJob(this.job, 'bake');
      if (!this.job) {
        this.icons?.dispose();
        this.icons = null;
      }
    }
    if (this.focus) {
      this.focus.t += rdt;
      if (this.focus.t > this.focus.dur || this.h.here !== this.station) this.focus = null;
    }
    // herbs sway in the draught from the door
    if (this.herbs) {
      const g = this.h.gust;
      for (let i = 1; i <= 5; i++) {
        const n = this.herbs.nodes['b' + i];
        if (n) n.rotation.set(Math.sin(t * 0.8 + i * 1.3) * 0.02 * (0.5 + g), 0, Math.sin(t * 1.1 + i * 2.1) * 0.035 * (0.4 + g));
      }
    }
    this.squeakBoard(rdt);
    this.animatePet(t, rdt);
  }

  private squeakBoard(rdt: number) {
    if (!this.board) return;
    const p = this.h.pos, r = this.boardRect;
    const on = p.x > r.x0 && p.x < r.x1 && p.y > r.z0 && p.y < r.z1;
    if (on && !this.onBoard) {
      const eng = this.h.engine;
      this.squeaks++;
      eng.audio.play('squeak', { volume: 0.32, pitch: 0.42 + Math.random() * 0.12 });
      eng.audio.play('door_creak', { volume: 0.12, pitch: 1.7 + Math.random() * 0.3 });
      this.dip = 1;
      for (let k = 0; k < 4; k++) this.h.particles.emit({ pos: { x: p.x + (Math.random() - 0.5) * 0.5, y: 0.02, z: 0.35 + (Math.random() - 0.5) * 0.1 }, count: 1, spread: 0.06, up: 0.12, life: [1.5, 3], size: [0.014, 0.012], sprite: 'dot3', color: 0xe8d0a8, drag: 0.6, jitter: 0.02 });
      if (this.squeaks === 3 && this.h.mamaCd < 6) {
        this.h.say("That board's been squeaking since the old sheriff. Leave it be.");
        this.h.mamaCd = 14;
      }
    }
    this.onBoard = on;
    this.dip = damp(this.dip, on ? 0.6 : 0, on ? 10 : 4, rdt);
    const n = this.board.nodes['board'];
    if (n) n.rotation.z = -this.dip * 0.012 + (on ? 0 : Math.max(0, this.dip - 0.1) * Math.sin(performance.now() * 0.05) * 0.002);
  }

  /** the pet: potters about the sand, stops, tastes the air with its claws, and squares up when he comes close */
  private animatePet(t: number, rdt: number) {
    const ri = this.pet;
    if (!ri) return;
    const n = ri.nodes;
    const near = Math.hypot(this.h.pos.x - this.tankAt.x, this.h.pos.y - this.tankAt.z) < 1.6;
    this.petAlert = damp(this.petAlert, near ? 1 : 0, 2, rdt);
    const [hx, hz] = this.petHalf;
    const d = this.petT.clone().sub(this.petP);
    let want = 0;
    if (this.petWait > 0) this.petWait -= rdt;
    else if (d.length() > 0.02) want = 1;
    else {
      this.petT.set((Math.random() * 2 - 1) * hx * 0.9, (Math.random() * 2 - 1) * hz * 0.85);
      this.petWait = 1.5 + Math.random() * 4;
    }
    let yawT = this.petYaw;
    if (want) yawT = Math.atan2(d.x, d.y);
    if (near) {
      // turn to face him (tank space is rotated half a turn from the room)
      const lx = -(this.h.pos.x - this.tankAt.x), lz = -(this.h.pos.y - this.tankAt.z);
      yawT = Math.atan2(lx - this.petP.x, lz - this.petP.y);
      want *= 0.3;
    }
    let dy = yawT - this.petYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.petYaw += dy * (1 - Math.exp(-rdt * 3));
    const turning = Math.min(1, Math.abs(dy) * 2);
    const facing = Math.abs(dy) < 0.5 ? 1 : 0;
    this.petWalk = damp(this.petWalk, Math.max(want * facing, turning * 0.6), 4, rdt);
    if (want && facing) this.petP.addScaledVector(d.normalize(), Math.min(d.length(), 0.045 * rdt));
    this.petP.x = THREE.MathUtils.clamp(this.petP.x, -hx, hx);
    this.petP.y = THREE.MathUtils.clamp(this.petP.y, -hz, hz);
    ri.root.position.set(this.petP.x, 0, this.petP.y);
    ri.root.rotation.y = this.petYaw;
    this.petPhase += rdt * (2 + this.petWalk * 7);
    const w = this.petWalk, a = this.petAlert, ph = this.petPhase;
    const R = (name: string, x: number, y: number, z: number) => {
      const node = n[name], r0 = this.petRest[name];
      if (node && r0) node.rotation.set(r0.x + x, r0.y + y, r0.z + z);
    };
    R('body', Math.sin(ph * 2) * 0.012 * w - a * 0.05, 0, Math.sin(ph) * 0.02 * w);
    for (let i = 1; i <= 4; i++)
      for (const [side, sg] of [['l', 1], ['r', -1]] as const) {
        const p = ph + i * 1.57 + (sg > 0 ? 0 : Math.PI);
        R(`leg_${side}${i}`, 0, Math.sin(p) * 0.32 * w, sg * (Math.max(0, Math.cos(p)) * 0.28 * w + Math.sin(t * 0.7 + i) * 0.02));
      }
    for (let i = 1; i <= 5; i++) R('tail' + i, Math.sin(t * 1.3 - i * 0.6) * 0.04 + a * 0.06 + (i > 3 ? Math.sin(t * 3.1) * 0.02 * a : 0), Math.sin(t * 0.9 - i * 0.5) * 0.05, 0);
    const clack = a > 0.5 ? Math.max(0, Math.sin(t * 9)) * Math.max(0, Math.sin(t * 0.8)) : 0;
    for (const [side, sg] of [['l', 1], ['r', -1]] as const) {
      R('arm_' + side, -a * 0.25 + Math.sin(t * 0.7 + sg) * 0.04, sg * (a * 0.3 + Math.sin(t * 0.5) * 0.05), 0);
      R('pincer_' + side, 0, sg * (clack * 0.35 + Math.max(0, Math.sin(t * 0.37 + sg)) * 0.12), 0);
    }
  }

  dispose() {
    for (const b of this.bills) b.dispose();
    this.icons?.dispose();
    this.job = null;
  }
}

export { clamp01, ease };
export type { SM };
