// The hideout: what's left of the Last Chance saloon at the edge of a dead
// town. Inside: a sagging walnut bar, a back bar crammed with bottles under a
// cracked mirror, overturned chairs and card tables, broken glass, sawdust,
// cobwebs, a pot-belly stove, junk shelves, posters, and big holes in the roof
// letting dusty shafts of evening sun fall across the floor. A wall has caved
// in onto the street, where false-front facades catch the last light.
// Sundown leans back against the bar with Pinch asleep on his shoulder.
// Everything you click is a physical object: the clothes rack & trunk (and the
// bar mirror) for your look, the gun bench, Thoth's codex on a table, the
// rubber duck on the bar, the gramophone on the piano, the piano, the
// dartboard, and the notice board by the breach (ride out).
// Camera: a walk-in through the breach, then a low cinematic interior frame
// with a slow drift, handheld sway and push-ins.
import * as THREE from 'three';
import type { Engine, GameScene } from '../../engine/Engine';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { makeVoxelMaterial, sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import * as PM from '../models/props';
import * as HX from '../models/props/hideout';
import * as CH from '../models/characters';
import { modelEntry } from '../models/lookup';
import { TOON } from '../models/style';
import { Particles } from '../fx/Particles';
import { FaceQuads, RigEyes, emote } from '../fx/FaceFx';
import { ENEMIES } from '../enemies/EnemyDefs';
import { loadSave, writeSave, buy, owns, PRICES, HATS, OUTFITS, BOARDS, GUN_PARTS, GUN_PERKS, GunLoadout } from '../meta/Save';
import { Ease } from '../../engine/Tween';
import { damp, rnd } from '../../engine/math/rand';

interface Clickable {
  id: string;
  obj: THREE.Object3D;
  label: string;
  hover: number;
  base: THREE.Vector3;
}

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

const UI_CSS = "position:absolute;z-index:8;padding:16px 20px;background:#e8d4a4;border:4px solid #5a3418;box-shadow:0 6px 0 #2a1408;font-family:'Alagard';color:#2a1a10;font-size:17px;pointer-events:auto";
const BTN_CSS = "font-family:'Alagard';font-size:17px;padding:4px 12px;background:#7a4a28;color:#fff3d6;border:3px solid #2a1408;box-shadow:0 3px 0 #2a1408;cursor:pointer";

type SM = { model: VoxelModel; voxelSize: number } | undefined | null;

function geoOf(sm: SM, pivot: 'bottom' | 'center' | [number, number, number] = 'bottom') {
  if (!sm?.model) return null;
  const g = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot });
  g.computeBoundingBox();
  return g;
}
function staticMesh(sm: SM, pivot: 'bottom' | 'center' = 'bottom') {
  const g = geoOf(sm, pivot);
  return g ? meshOf(g) : null;
}
function meshOf(g: THREE.BufferGeometry) {
  const m = new THREE.Mesh(g, sharedVoxelMaterial);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
/** guarded builder call: a missing / failing prop never breaks the hideout */
function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch (e) {
    console.warn('[hub] prop failed', e);
    return null;
  }
}

/** far mesa silhouettes for the dusk horizon */
function mesaModel(seed: number) {
  const m = new VoxelModel('mesa');
  const W = 10 + (seed % 3) * 4, H = 10 + (seed % 4) * 3;
  for (let y = 0; y < H; y++) {
    const w = W - Math.floor(y / 4);
    for (let x = -w; x <= w; x++) for (let z = -6; z <= 6; z++) m.set(x, y, z, y % 4 === 0 ? TOON.sandstone.shade : TOON.sandstone.base);
  }
  for (let x = -W + 3; x <= W - 3; x++) for (let z = -5; z <= 5; z++) m.set(x, H, z, TOON.sandstone.hi);
  return m;
}

/** soft, dusty, additive light-shaft material (fades at its ends and edges) */
function shaftMaterial(opacity: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: opacity }, uColor: { value: new THREE.Color(1.0, 0.78, 0.5) } },
    vertexShader: /* glsl */ `
      varying float vT; varying vec3 vW; varying vec3 vN; varying vec3 vV;
      uniform float uLen;
      void main(){
        vT = clamp(-position.y / ${'${LEN}'}, 0.0, 1.0);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uOpacity; uniform vec3 uColor;
      varying float vT; varying vec3 vW; varying vec3 vN; varying vec3 vV;
      void main(){
        float edge = pow(abs(dot(vN, vV)), 1.8);
        float ends = smoothstep(0.0, 0.08, vT) * (1.0 - smoothstep(0.7, 1.0, vT));
        float dust = 0.72 + 0.28 * sin(vW.y * 7.0 + uTime * 0.6 + vW.x * 4.0) * sin(vW.z * 6.0 - uTime * 0.45 + vW.y * 2.0);
        float a = uOpacity * edge * ends * dust * (1.1 - vT * 0.45);
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    side: THREE.FrontSide,
  });
}

const HOME: Shot = { pos: new THREE.Vector3(4.35, 1.3, 3.55), look: new THREE.Vector3(-1.1, 1.18, -1.75), fov: 47 };
const STREET: Shot = { pos: new THREE.Vector3(-10.5, 1.55, 0.5), look: new THREE.Vector3(1.0, 1.2, -1.6), fov: 50 };
// light travels from the low western sun at the back-left, down through the roof holes
const SUN_TO = new THREE.Vector3(0.56, -0.62, 0.55).normalize();

export class HubScene implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(47, 1, 0.05, 500);
  private particles = new Particles();
  private faces = new FaceQuads();
  private clickables: Clickable[] = [];
  private ray = new THREE.Raycaster();
  private hovered: Clickable | null = null;
  private hero: RigInstance | null = null;
  private heroEyes: RigEyes | null = null;
  private pinch: RigInstance | null = null;
  private heroHolder = new THREE.Group();
  private boardMesh: THREE.Object3D | null = null;
  private boardHolder = new THREE.Group();
  private gunHolder = new THREE.Group();
  private gun: RigInstance | null = null;
  private panel: HTMLDivElement | null = null;
  private tip: HTMLDivElement;
  private bank: HTMLDivElement;
  private title: HTMLDivElement;
  private goal: Shot = { pos: HOME.pos.clone(), look: HOME.look.clone(), fov: HOME.fov };
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private focused = false;
  private t = 0;
  private duck: THREE.Object3D | null = null;
  private duckSquash = 0;
  private music = true;
  private stoveLight!: THREE.PointLight;
  private flick: THREE.PointLight[] = [];
  private shafts: { mesh: THREE.Mesh; top: THREE.Vector3; len: number; r: number }[] = [];
  private wind: { stop(t?: number): void } | null = null;
  private seatY = 0.79;
  private barTopY = 1.12;
  private hitMat = new THREE.MeshBasicMaterial({ visible: false });
  private lanterns: { rig: RigInstance; light: THREE.PointLight | null; offset: THREE.Vector3; phase: number }[] = [];
  private chandelier: RigInstance | null = null;
  private candles: { light: THREE.PointLight; offset: THREE.Vector3 }[] = [];
  private door: RigInstance | null = null;
  private sign: RigInstance | null = null;
  private gust = 0;
  private creakCd = 4;
  private touch = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
  private chips: HTMLDivElement | null = null;

  constructor(private engine: Engine, private onRide: () => void, private onMenu: () => void) {
    this.tip = document.createElement('div');
    this.bank = document.createElement('div');
    this.title = document.createElement('div');
  }

  async enter() {
    const s = this.scene;
    const eng = this.engine;
    const P: any = PM;
    const hiQ = eng.quality.shadows;
    const sunDir = SUN_TO.clone().negate();
    // ------------------------------------------------ sky + atmosphere
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uSun: { value: sunDir } },
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uSun; varying vec3 vP;
          void main(){
            float y = vP.y;
            vec3 zen = vec3(0.16,0.22,0.42), mid = vec3(0.62,0.50,0.52), hor = vec3(1.0,0.66,0.38), low = vec3(0.50,0.32,0.22);
            vec3 c = y > 0.0 ? mix(hor, mix(mid, zen, smoothstep(0.2, 0.85, y)), smoothstep(0.0, 0.3, y)) : mix(hor, low, clamp(-y * 5.0, 0.0, 1.0));
            float d = max(0.0, dot(vP, uSun));
            c += vec3(1.0, 0.7, 0.4) * pow(d, 6.0) * 0.6 + vec3(1.0, 0.9, 0.7) * pow(d, 700.0) * 4.0;
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      })
    );
    s.add(sky);
    s.fog = new THREE.Fog(0xc89070, 26, 140);
    s.add(new THREE.HemisphereLight(0x8a80b0, 0x3a2416, 0.32));
    const sun = new THREE.DirectionalLight(0xffb56e, 3.4);
    sun.position.copy(sunDir).multiplyScalar(40);
    sun.target.position.set(-2, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(hiQ ? 4096 : 1024, hiQ ? 4096 : 1024);
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.02;
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -16;
    sc.right = 12;
    sc.bottom = -11;
    sc.top = 11;
    sc.near = 5;
    sc.far = 90;
    s.add(sun, sun.target);
    // warm bounce light filling the room (sunlight off the floorboards), a cool rim from the street
    const bounce = new THREE.PointLight(0xffa868, 7, 15, 1.2);
    bounce.position.set(0.5, 2.2, 0.8);
    s.add(bounce);
    const street = new THREE.DirectionalLight(0x9aa8d8, 0.4);
    street.position.set(-10, 4, 6);
    s.add(street);
    s.add(this.particles.group, this.faces.mesh);

    // ------------------------------------------------ placement helpers
    const add = (o: THREE.Object3D, id = '', label = '') => {
      s.add(o);
      if (id) this.clickables.push({ id, obj: o, label, hover: 0, base: o.position.clone() });
      return o;
    };
    /** free placement: bottom-centre pivot at (x, y, z), yaw ry */
    const put = (sm: SM, x: number, z: number, ry = 0, y = 0, id = '', label = '', scale = 1) => {
      const g = geoOf(sm);
      if (!g) return null;
      const grp = new THREE.Group();
      grp.add(meshOf(g));
      grp.position.set(x, y, z);
      grp.rotation.y = ry;
      grp.scale.setScalar(scale);
      grp.userData.bb = g.boundingBox;
      return add(grp, id, label);
    };
    /** stand an object with its back against a wall face ('back' z, 'left' x, 'right' x) */
    const backFace = -HX.ROOM.D / 2 + 2 * HX.ROOM.VS, leftFace = -HX.ROOM.W / 2 + 2 * HX.ROOM.VS, rightFace = HX.ROOM.W / 2 - 2 * HX.ROOM.VS;
    const against = (sm: SM, wall: 'back' | 'left' | 'right', along: number, y = 0, id = '', label = '', gap = 0.01) => {
      const g = geoOf(sm);
      if (!g) return null;
      const bb = g.boundingBox!;
      const grp = new THREE.Group();
      grp.add(meshOf(g));
      if (wall === 'back') grp.position.set(along, y, backFace - bb.min.z + gap);
      else if (wall === 'left') {
        grp.rotation.y = Math.PI / 2;
        grp.position.set(leftFace - bb.min.z + gap, y, along);
      } else {
        grp.rotation.y = -Math.PI / 2;
        grp.position.set(rightFace + bb.min.z - gap, y, along);
      }
      grp.userData.bb = bb;
      return add(grp, id, label);
    };
    const B = (f: () => SM) => safe(f);
    const topOf = (o: THREE.Object3D | null) => (o ? new THREE.Box3().setFromObject(o).max.y : 0);

    // ------------------------------------------------ the saloon shell (shared room frame)
    for (const f of [() => HX.saloonFloor(1), () => HX.saloonWalls(1), () => HX.porchAwning(1), () => HX.backRoom(1)]) {
      const sm = B(f as () => SM);
      const g = geoOf(sm, HX.ROOM_PIVOT);
      if (g) s.add(meshOf(g));
    }
    const roof = safe(() => HX.saloonRoof(1));
    const rg = geoOf(roof, HX.ROOM_PIVOT);
    if (rg) s.add(meshOf(rg));
    // dusty light shafts through every roof hole (and one through the breach)
    const shaftMat = (o: number, len: number) => {
      const m = shaftMaterial(o);
      m.vertexShader = m.vertexShader.replace('${LEN}', len.toFixed(3));
      return m;
    };
    const addShaft = (top: THREE.Vector3, r: number, o: number, lenOverride?: number) => {
      const len = lenOverride ?? (top.y / -SUN_TO.y) * 1.02;
      const geo = new THREE.CylinderGeometry(r * 0.92, r * 1.12, len, 24, 1, true);
      geo.translate(0, -len / 2, 0);
      const mesh = new THREE.Mesh(geo, shaftMat(o, len));
      mesh.position.copy(top);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), SUN_TO);
      mesh.renderOrder = 10;
      s.add(mesh);
      this.shafts.push({ mesh, top: top.clone(), len, r });
    };
    for (const h of roof?.meta.holes ?? []) addShaft(new THREE.Vector3(h.x, HX.ROOM.H + 0.1, h.z), (h.rx + h.rz) * 0.42, 0.16);
    addShaft(new THREE.Vector3(-6.4, 2.6, 0.1), 1.05, 0.07, 6.5);

    // ------------------------------------------------ rigs (everything that swings or creaks)
    const rig = (spec: RigSpec | null, x: number, y: number, z: number, ry = 0) => {
      if (!spec) return null;
      const ri = new RigInstance(buildRigGeo(spec, spec.name + ':hub'), { material: sharedVoxelMaterial, castShadow: true });
      ri.root.position.set(x, y, z);
      ri.root.rotation.y = ry;
      s.add(ri.root);
      return ri;
    };
    const touch = this.touch;
    const lanternAt = (x: number, z: number, chain: number, seed: number, light = true) => {
      const spec = safe(() => HX.lanternRig(chain, seed));
      const ri = rig(spec, x, HX.ROOM.H - 0.31, z);
      if (!ri || !spec) return;
      let l: THREE.PointLight | null = null;
      if (light) {
        l = new THREE.PointLight(0xffc070, 4.5, 6.5, 1.6);
        s.add(l);
      }
      this.lanterns.push({ rig: ri, light: l, offset: new THREE.Vector3(...(spec.meta!.light as [number, number, number])), phase: seed * 1.7 });
    };
    lanternAt(-2.1, -0.9, 0.7, 1);
    lanternAt(3.55, -0.55, 0.95, 2);
    lanternAt(-4.4, 2.6, 0.5, 3, !touch);
    const chSpec = safe(() => HX.chandelierRig());
    this.chandelier = rig(chSpec, 0.6, HX.ROOM.H - 0.31, 0.15, 0.3);
    if (this.chandelier && chSpec) {
      const cands = chSpec.meta!.candles as [number, number, number][];
      for (const c of touch ? cands.slice(0, 1) : cands) {
        const l = new THREE.PointLight(0xffb050, touch ? 2.6 : 1.4, 3.2, 1.8);
        s.add(l);
        this.candles.push({ light: l, offset: new THREE.Vector3(...c) });
      }
    }
    // the creaky back-room door (dim light in the back room behind it)
    this.door = rig(safe(() => HX.creakyDoorRig()), -3.85, 0, backFace - 0.03);
    const backLight = new THREE.PointLight(0x9a7a5a, 1.2, 4, 1.8);
    backLight.position.set(-3.4, 1.6, -5.4);
    s.add(backLight);
    // the sign swinging on chains under the porch, by the breach
    this.sign = rig(safe(() => HX.hangingSignRig('LAST CHANCE')), -6.05, 3.1, 1.9, -Math.PI / 2);

    // ------------------------------------------------ the bar
    const bbar = against(B(() => HX.backBar(1)), 'back', 0.9);
    const bbMeta = safe(() => HX.backBar(1))?.meta;
    if (bbar && bbMeta) {
      // invisible hit box over the cracked mirror (opens the wardrobe: check your look)
      const hb = new THREE.Mesh(new THREE.PlaneGeometry(bbMeta.mirrorSize[0], bbMeta.mirrorSize[1]), this.hitMat);
      hb.position.set(0.9 + bbMeta.mirror[0], bbMeta.mirror[1], backFace + 0.06);
      add(hb, 'mirror', 'Cracked Mirror — check your look');
    }
    const barSm = safe(() => HX.barCounterCraft(1));
    const bar = put(barSm, 0.9, -2.72);
    if (bar) this.barTopY = topOf(bar) - 0.05;
    // stools along the bar (one torn, one knocked over), Sundown on the right-hand one
    const stools: [number, number, number, 'ok' | 'torn'][] = [[-1.0, -1.98, 0, 'ok'], [0.35, -1.85, 1, 'ok'], [1.7, -2.0, 0, 'torn'], [3.0, -1.95, 0, 'ok']];
    stools.forEach(([x, z, tipped, st], i) => {
      const so = put(B(() => HX.barStool(i + 1, st)), x, z, 0.3 * x);
      if (so && tipped) {
        so.rotation.set(0, 0.6, Math.PI / 2);
        so.position.y = 0.21;
      }
      if (so && x === 3.0) this.seatY = topOf(so) - 0.01;
    });
    put(B(() => HX.kegCraft(1)), -2.05, -3.45, 0.3);
    put(B(() => HX.kegCraft(2)), 3.8, -3.5, -0.5);
    put(B(() => HX.kegCraft(3)), 4.15, -2.85, 1.1);
    put(B(() => HX.spittoon()), -0.3, -1.72, 0);
    put(B(() => HX.spittoon()), 2.25, -1.8, 0);
    // the rubber duck on the bar top, Pinch's favourite
    const duck = modelEntry('rubber_duck')?.() as SM;
    this.duck = put(duck, 2.3, -2.62, -0.9, this.barTopY, 'duck', 'Rubber Duck');
    put(B(() => HX.cobweb(1)), leftFace + 0.02, -4.3, 0, HX.ROOM.H - 0.36);
    put(B(() => HX.cobweb(2)), rightFace - 0.02, -4.3, -Math.PI / 2, HX.ROOM.H - 0.36);
    put(B(() => HX.cobweb(1)), leftFace + 0.02, 4.3, Math.PI / 2, HX.ROOM.H - 0.36);

    // ------------------------------------------------ the room
    this.heroHolder.position.set(3.0, 0, -1.95);
    this.heroHolder.rotation.y = 0.3;
    s.add(this.heroHolder);
    // stove (back-left corner), bedroll, wood
    const stove = safe(() => HX.stoveCraft(3.25));
    const stg = put(stove, -4.95, -3.75, 0.4);
    this.stoveLight = new THREE.PointLight(0xff7a30, 7, 5.5, 1.6);
    if (stove && stg) {
      stg.updateMatrixWorld(true);
      this.stoveLight.position.set(...(stove.meta.fire as [number, number, number])).applyMatrix4(stg.matrixWorld);
      this.stoveLight.position.z += 0.15;
    } else this.stoveLight.position.set(-4.95, 0.4, -3.4);
    s.add(this.stoveLight);
    put(B(() => HX.bedroll(1)), -3.2, -2.65, 0.9);
    put(B(() => HX.woodPile(1)), -5.35, -2.95, Math.PI / 2);
    // piano on the left wall with the gramophone on top
    const pianoSm = safe(() => HX.uprightPiano(1));
    const piano = against(pianoSm, 'left', -2.0, 0, 'piano', 'Busted Piano');
    if (piano && pianoSm) put(B(() => HX.gramophoneCraft()), leftFace + 0.34, -1.75, Math.PI / 2 - 0.4, pianoSm.meta.top, 'gramophone', 'Gramophone');
    // the breach: rubble, the notice board (ride out)
    put(B(() => HX.rubblePile(1)), -5.6, 0.25, 1.2);
    put(B(() => HX.rubblePile(2)), -6.7, 1.3, -0.4);
    put(B(() => HX.noticeBoardCraft(1)), -5.05, -0.95, Math.PI / 2 + 0.25, 0, 'board', 'Notice Board — RIDE OUT');
    // gun bench on the left wall, junk shelf above, saddle and rope
    const wbSm = safe(() => HX.workbenchCraft(1));
    const bench = against(wbSm, 'left', 2.95, 0, 'bench', 'Gun Bench — customize your revolver');
    if (bench && wbSm) {
      this.gunHolder.position.set(leftFace + 0.4, wbSm.meta.top + 0.03, 2.75);
      this.gunHolder.rotation.y = Math.PI / 2;
    }
    s.add(this.gunHolder);
    against(B(() => HX.junkShelf(1)), 'left', 3.15, 1.62);
    against(B(() => HX.junkShelf(2)), 'right', 2.6, 1.4);
    put(B(() => HX.saddleRail(1)), -4.25, 4.0, 0.2);
    put(B(() => HX.ropeCoil()), -3.9, 2.25, 0);
    // wardrobe: the armoire on the right wall + the steamer trunk in the corner
    against(B(() => HX.armoire(1)), 'right', -2.05, 0, 'wardrobe', 'Armoire — hats, outfits, boards');
    put(B(() => HX.steamerTrunk(1)), 4.85, -3.85, -0.35, 0, 'wardrobe', 'Steamer Trunk — hats, outfits, boards');
    against(B(() => HX.dartboardCraft()), 'back', 4.75, 1.05, 'dart', 'Dartboard');
    // card tables, chairs, the mess
    const t1 = put(B(() => HX.saloonTable(1, 'cards')), -1.55, 0.4, 0.3);
    put(B(() => HX.saloonChair(1, 'up')), -2.35, 0.85, 2.1);
    put(B(() => HX.saloonChair(2, 'tipped')), -0.7, 1.25, -0.7);
    put(B(() => HX.saloonChair(3, 'broken')), -1.9, -0.45, 0.4);
    put(B(() => HX.cardScatter(1)), -0.95, 1.0, 0.3);
    put(B(() => HX.saloonTable(3, 'tipped')), 0.95, 2.35, 0.9);
    put(B(() => HX.saloonChair(4, 'side')), 1.75, 2.9, -0.4);
    put(B(() => HX.brokenGlass(1)), 0.45, 1.9, 0);
    put(B(() => HX.brokenGlass(2)), 1.25, -1.55, 0.8);
    const t3 = put(B(() => HX.saloonTable(2, 'bare')), 2.45, 0.85, 0);
    if (t3) {
      put(B(() => HX.codexTome()), 2.38, 0.82, 0.5, topOf(t3), 'book', "Thoth's Codex");
      const ol = safe(() => HX.oilLamp());
      const olg = put(ol, 2.85, 0.6, 0, topOf(t3));
      if (ol && olg) {
        const l = new THREE.PointLight(0xffb860, 2.6, 3.5, 1.7);
        l.position.set(2.85, topOf(t3) + ol.meta.flame[1], 0.6);
        s.add(l);
        this.flick.push(l);
      }
    }
    if (t1) put(B(() => HX.bottlesCraft(3)), -1.45, 0.25, 0.4, topOf(t1));
    put(B(() => HX.saloonChair(5, 'up')), 3.15, 1.4, -2.3);
    put(B(() => HX.sawdust(1)), 0.5, -1.45, 0);
    put(B(() => HX.sawdust(2)), -1.3, 1.6, 1.2);
    put(B(() => HX.bottlesCraft(2)), -2.7, 1.7, 0.6);
    put(B(() => HX.bucket(1)), -2.5, -1.45, 0);
    put(B(() => HX.crateStack(3)), -4.8, 3.85, 0.1);
    put(B(() => HX.crateStack(2)), 5.0, 3.7, -0.4);
    put(B(() => HX.sackCraft(1)), -3.6, 3.95, 0.5);
    put(B(() => HX.sackCraft(2)), -5.25, 0.9, -0.6);
    put(B(() => HX.sackCraft(3)), 4.35, 3.95, 1.1);
    const ct = put(B(() => HX.crateTable(1)), 5.15, 1.2, 0.2);
    put(B(() => HX.potCactus(1)), 5.15, 1.2, 0, topOf(ct));
    put(B(() => HX.skullPlaque()), -5.0, backFace + 0.05, 0, 2.55);

    // ------------------------------------------------ the street outside the breach
    const gsm = B(() => HX.streetGround(16, 40));
    const gg = geoOf(gsm, [0.5, 1, 0]);
    if (gg) {
      const m = meshOf(gg);
      m.castShadow = false;
      m.position.set(-5.9, -0.02, 0);
      s.add(m);
    }
    const far = new THREE.Mesh(new THREE.CircleGeometry(300, 32), new THREE.MeshStandardMaterial({ color: 0xc08a5c, roughness: 1 }));
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.35;
    s.add(far);
    for (let i = 0; i < 10; i++) {
      const g = geoOf({ model: mesaModel(i), voxelSize: 2.4 });
      if (!g) continue;
      const mm = meshOf(g);
      mm.castShadow = false;
      const a = Math.PI * 1.15 + (i - 5) * 0.27;
      mm.position.set(Math.cos(a) * (170 + (i % 3) * 30), -1, Math.sin(a) * (170 + (i % 3) * 30));
      mm.rotation.y = a;
      s.add(mm);
    }
    // across the street: false fronts facing the saloon, with their boardwalk
    const facade = (sm: SM, z: number) => {
      const g = geoOf(sm);
      if (!g) return;
      const grp = new THREE.Group();
      grp.add(meshOf(g));
      grp.rotation.y = Math.PI / 2;
      grp.position.set(-15.2 - g.boundingBox!.max.z * 0 - 3.4, 0, z);
      s.add(grp);
    };
    facade(B(() => P.generalStoreFacade?.(1)), -0.5);
    facade(B(() => P.sheriffFacade?.(2)), -9.6);
    facade(B(() => P.saloonFacade?.(3)), 9.4);
    const bw = geoOf(B(() => HX.boardwalk(30, 2)));
    if (bw) {
      const m = meshOf(bw);
      m.rotation.y = -Math.PI / 2;
      m.position.set(-13.2, 0, 0);
      s.add(m);
    }
    // our own side of the street: a short boardwalk stub, hitching rail, pump, wagon, junk, grass
    put(B(() => HX.hitchingRail(1)), -8.0, 2.6, Math.PI / 2);
    this.boardHolder.position.set(-7.85, 0, 1.75);
    this.boardHolder.rotation.y = Math.PI / 2;
    s.add(this.boardHolder);
    put(B(() => HX.waterPump(1)), -8.4, -2.4, 1.2);
    put(B(() => P.wagon?.(1)), -10.4, -5.8, 0.9);
    put(B(() => HX.junkPile(1)), -7.6, -4.4, 0.4);
    put(B(() => HX.holeySign(1)), -7.2, 4.2, Math.PI / 2 + 0.2);
    put(B(() => HX.kegCraft(4)), -7.3, -1.6, 0);
    put(B(() => HX.kegCraft(5)), -7.4, 3.6, 1.4);
    for (let i = 0; i < 26; i++) {
      const x = -6.6 - Math.random() * 7, z = (Math.random() - 0.5) * 18;
      if (Math.abs(x + 13.2) < 1.4) continue;
      put(B(() => HX.grassTuft(i % 3 + 1)), x, z, Math.random() * 6);
    }
    for (const [x, z, k] of [[-12.0, 6.5, 'saguaro'], [-9.5, -8.5, 'organ'], [-17, 14, 'saguaro']] as const) put(B(() => P.cactus?.(Math.round(-x * 3), k)), x, z, x);
    put(B(() => P.tumbleweed?.(1)), -9.2, 5.2, 0, 0.35);

    this.buildGun();
    this.buildHero();

    // ------------------------------------------------ camera + UI
    this.camera.aspect = eng.width / eng.height;
    this.camera.updateProjectionMatrix();
    // walk-in: from the street, through the breach, into the bar
    this.camPos.copy(STREET.pos);
    this.camLook.copy(STREET.look);
    this.camera.position.copy(this.camPos);
    this.camera.fov = STREET.fov;
    (window as any).__music?.setMood('hub');
    this.wind = eng.audio.loop('wind_loop', 0.22);
    eng.input.setWantLock(false);
    this.tip.style.cssText = "position:absolute;z-index:7;pointer-events:none;display:none;font-family:'Alagard';font-size:17px;color:#fff3d6;text-shadow:0 2px 0 #2a1408,0 0 10px #000";
    this.bank.style.cssText = "position:absolute;left:24px;top:20px;z-index:7;pointer-events:none;font-family:'Alagard';font-size:22px;color:#ffd36b;text-shadow:0 3px 0 #2a1408";
    this.title.style.cssText = "position:absolute;right:28px;top:22px;z-index:7;pointer-events:none;font-family:'Alagard';font-size:30px;color:#fff3d6;text-align:right;text-shadow:0 3px 0 #2a1408,0 0 14px #000;opacity:0;transition:opacity 1.2s";
    this.title.innerHTML = 'THE HIDEOUT<div style="font-size:15px;opacity:.8">what\'s left of the Last Chance saloon</div>';
    eng.overlay.append(this.tip, this.bank, this.title);
    setTimeout(() => (this.title.style.opacity = '1'), 1200);
    setTimeout(() => (this.title.style.opacity = '0'), 6500);
    this.updateBank();
  }

  private updateBank() {
    const d = loadSave();
    this.bank.innerHTML = `BANK: ${d.bank} gold<div style="font-size:15px;color:#fff3d6;opacity:.8">Runs ${d.runs} · Best wave ${d.bestWave} · Outlaws ${d.kills}</div>`;
  }

  private buildHero() {
    const d = loadSave();
    this.hero?.root.removeFromParent();
    this.boardMesh?.removeFromParent();
    let spec: RigSpec | null = null;
    try {
      spec = (CH as any).skeletonCowboyRig?.({ hat: d.look.hat, outfit: d.look.outfit }) ?? null;
    } catch (e) {
      console.warn('[hub] hero', e);
    }
    spec = spec ?? ((modelEntry('cowboy_stetson_duster')?.() as RigSpec) || null);
    if (spec?.parts) {
      this.hero = new RigInstance(buildRigGeo(spec, spec.name + ':hub:' + d.look.hat + d.look.outfit), { material: makeVoxelMaterial() });
      // sit: pelvis on the log seat
      const hipY = (spec.meta?.hipY as number) ?? 0.67;
      this.hero.root.position.y = this.seatY - hipY + 0.06;
      this.heroHolder.add(this.hero.root);
      this.heroEyes = new RigEyes(this.hero, 'glow', 0x6aff1a);
      this.hero.setExpression('smug');
      // Pinch asleep on his shoulder
      const ps = modelEntry('pinch')?.() as RigSpec | undefined;
      if (ps?.parts) {
        this.pinch = new RigInstance(buildRigGeo(ps, ps.name + ':hub'), { material: makeVoxelMaterial() });
        this.pinch.root.scale.setScalar(0.8);
        if (!this.hero.attach('shoulder_l', this.pinch.root)) this.hero.nodes['torso']?.add(this.pinch.root);
        this.pinch.setExpression('sleepy');
      }
    }
    try {
      const b = (CH as any).sandboardModel?.(d.look.board);
      if (b?.model) {
        const bm = staticMesh(b, 'center')!;
        // leaning on the hitching rail
        bm.position.set(0, 0.62, -0.18);
        bm.rotation.set(-0.38, 0, 0);
        bm.rotateX(-Math.PI / 2);
        this.boardHolder.add(bm);
        this.boardMesh = bm;
      }
    } catch (e) {
      console.warn('[hub] board', e);
    }
  }

  private buildGun() {
    const d = loadSave();
    this.gun?.root.removeFromParent();
    let spec: RigSpec | null = null;
    try {
      spec = (CH as any).revolverRig?.(d.gun) ?? null;
    } catch (e) {
      console.warn('[hub] gun', e);
    }
    if (!spec?.parts) return;
    const key = `gun:${d.gun.barrel}:${d.gun.cylinder}:${d.gun.grip}:${d.gun.sight}`;
    this.gun = new RigInstance(buildRigGeo(spec, key), { material: makeVoxelMaterial() });
    this.gun.root.scale.setScalar(1.6);
    this.gun.root.rotation.set(0, Math.PI / 2, Math.PI / 2);
    this.gunHolder.add(this.gun.root);
  }

  private focus(shot: Shot | null) {
    this.focused = !!shot;
    const s = shot ?? HOME;
    this.goal.pos.copy(s.pos);
    this.goal.look.copy(s.look);
    this.goal.fov = s.fov;
  }

  private closePanel() {
    this.panel?.remove();
    this.panel = null;
    this.focus(null);
  }

  private openPanel(html: HTMLElement, side: 'left' | 'right') {
    this.panel?.remove();
    const p = document.createElement('div');
    p.style.cssText = UI_CSS + `;top:50%;transform:translateY(-50%);${side}:5vw;max-width:min(420px,40vw)`;
    const close = document.createElement('button');
    close.textContent = 'DONE';
    close.style.cssText = BTN_CSS + ';display:block;margin:14px auto 0';
    close.onclick = () => this.closePanel();
    p.append(html, close);
    this.engine.overlay.appendChild(p);
    this.panel = p;
  }

  private wardrobe() {
    // push in on Sundown with the rack behind him, panel on the left
    this.focus({ pos: new THREE.Vector3(2.9, 1.42, 0.7), look: new THREE.Vector3(5.1, 1.15, -2.5), fov: 40 });
    const wrap = document.createElement('div');
    const render = () => {
      wrap.innerHTML = '<div style="font-size:26px;color:#8a2a18;text-align:center;margin-bottom:8px">WARDROBE</div>';
      const d = loadSave();
      const row = (kind: 'hat' | 'outfit' | 'board', list: string[], cur: string) => {
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0';
        const i = list.indexOf(cur);
        const prev = document.createElement('button');
        prev.textContent = '◀';
        prev.style.cssText = BTN_CSS;
        const next = document.createElement('button');
        next.textContent = '▶';
        next.style.cssText = BTN_CSS;
        const lab = document.createElement('div');
        lab.style.cssText = 'flex:1;text-align:center';
        const key = `${kind}:${cur}`;
        const own = owns(key);
        lab.innerHTML = `<div style="font-size:13px;opacity:.7">${kind.toUpperCase()}</div>${cur.replace('_', ' ')}${own ? '' : `<div style="color:#a02a1a;font-size:14px">${PRICES[key]} gold</div>`}`;
        const set = (v: string) => {
          (d.look as any)[kind] = v;
          writeSave(d);
          this.buildHero();
          render();
          this.engine.audio.play('paper_flutter', { volume: 0.5 });
        };
        prev.onclick = () => set(list[(i - 1 + list.length) % list.length]);
        next.onclick = () => set(list[(i + 1) % list.length]);
        r.append(prev, lab, next);
        if (!own) {
          const b = document.createElement('button');
          b.textContent = 'BUY';
          b.style.cssText = BTN_CSS;
          b.onclick = () => {
            if (buy(key)) {
              this.engine.audio.play('gold_burst', { volume: 0.8 });
              this.updateBank();
              render();
            } else this.engine.audio.play('ui_error', { volume: 0.8 });
          };
          r.appendChild(b);
        }
        wrap.appendChild(r);
      };
      row('hat', HATS, d.look.hat);
      row('outfit', OUTFITS, d.look.outfit);
      row('board', BOARDS, d.look.board);
      const note = document.createElement('div');
      note.style.cssText = 'font-size:14px;opacity:.75;text-align:center;margin-top:6px';
      note.textContent = 'Locked looks are previewed; buy them to ride out in style.';
      wrap.appendChild(note);
    };
    render();
    this.openPanel(wrap, 'left');
  }

  /** drag a part chip onto its slot (or click it) */
  private gunBench() {
    this.focus({ pos: new THREE.Vector3(-3.35, 1.6, 1.55), look: new THREE.Vector3(-5.45, 1.0, 2.95), fov: 38 });
    const wrap = document.createElement('div');
    const render = () => {
      const d = loadSave();
      wrap.innerHTML = '<div style="font-size:26px;color:#8a2a18;text-align:center;margin-bottom:4px">GUN BENCH</div><div style="font-size:14px;text-align:center;opacity:.75;margin-bottom:8px">Drag a part onto its slot</div>';
      for (const slot of Object.keys(GUN_PARTS) as (keyof GunLoadout)[]) {
        const r = document.createElement('div');
        r.style.cssText = 'margin:8px 0';
        const target = document.createElement('div');
        target.style.cssText = 'border:3px dashed #5a3418;padding:6px 10px;margin-bottom:4px;background:#f4e4bc';
        target.innerHTML = `<span style="font-size:13px;opacity:.7">${slot.toUpperCase()}</span> · ${d.gun[slot]}<div style="font-size:13px;color:#5a3a1a">${GUN_PERKS[`${slot}:${d.gun[slot]}`] ?? ''}</div>`;
        target.ondragover = (e) => {
          e.preventDefault();
          target.style.background = '#ffe9a8';
        };
        target.ondragleave = () => (target.style.background = '#f4e4bc');
        target.ondrop = (e) => {
          e.preventDefault();
          const v = e.dataTransfer?.getData('text/plain') ?? '';
          const [sl, part] = v.split(':');
          if (sl === slot) equip(slot, part);
          else target.style.background = '#f4e4bc';
        };
        const chips = document.createElement('div');
        chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
        for (const part of GUN_PARTS[slot] as string[]) {
          const key = `gun:${slot}:${part}`;
          const own = owns(key);
          const c = document.createElement('div');
          c.draggable = true;
          c.textContent = own ? part : `${part} (${PRICES[key]}g)`;
          c.title = GUN_PERKS[`${slot}:${part}`] ?? '';
          c.style.cssText = `cursor:grab;padding:3px 8px;border:3px solid #2a1408;background:${(d.gun as any)[slot] === part ? '#c9a050' : own ? '#d8b878' : '#b8a888'};font-size:15px`;
          c.ondragstart = (e) => e.dataTransfer?.setData('text/plain', `${slot}:${part}`);
          c.onclick = () => equip(slot, part);
          chips.appendChild(c);
        }
        r.append(target, chips);
        wrap.appendChild(r);
      }
    };
    const equip = (slot: keyof GunLoadout, part: string) => {
      const key = `gun:${slot}:${part}`;
      if (!owns(key) && !buy(key)) {
        this.engine.audio.play('ui_error', { volume: 0.8 });
        return;
      }
      const d = loadSave();
      (d.gun as any)[slot] = part;
      writeSave(d);
      this.engine.audio.play(slot === 'cylinder' ? 'rev_spin' : 'rev_close', { volume: 0.8 });
      this.updateBank();
      this.buildGun();
      render();
    };
    render();
    this.openPanel(wrap, 'right');
  }

  private codex() {
    this.focus({ pos: new THREE.Vector3(3.45, 1.55, 2.5), look: new THREE.Vector3(2.4, 0.82, 0.85), fov: 34 });
    this.engine.audio.play('book_open', { volume: 0.8 });
    const d = loadSave();
    const wrap = document.createElement('div');
    wrap.style.cssText = 'max-height:56vh;overflow:auto;padding-right:6px';
    wrap.innerHTML = '<div style="font-size:26px;color:#8a2a18;text-align:center">THOTH\'S CODEX</div><div style="font-size:14px;text-align:center;opacity:.75;margin-bottom:8px">Every soul you send ahead is written down.</div>';
    for (const e of Object.values(ENEMIES) as any[]) {
      const n = d.codex[e.id] ?? 0;
      const r = document.createElement('div');
      r.style.cssText = 'border-bottom:2px solid rgba(90,52,24,.35);padding:6px 0';
      r.innerHTML = n > 0 ? `<b style="color:#5a1a10">${e.name}</b> <span style="float:right">${n} slain</span><div style="font-size:14px;opacity:.8">${e.title}</div>` : `<b style="opacity:.5">???</b><div style="font-size:14px;opacity:.5">Not yet encountered.</div>`;
      wrap.appendChild(r);
    }
    this.openPanel(wrap, 'right');
  }

  private click(c: Clickable) {
    const eng = this.engine;
    switch (c.id) {
      case 'wardrobe':
      case 'mirror':
        this.wardrobe();
        break;
      case 'bench':
        this.gunBench();
        break;
      case 'book':
        this.codex();
        break;
      case 'duck': {
        this.duckSquash = 1;
        eng.audio.play('duck_quack', { volume: 1, pitch: 0.9 + rnd.next() * 0.3 });
        const p = c.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.35, 0));
        emote(this.particles, p, rnd.pick(['heart', 'note', 'exclaim']), 0.8);
        break;
      }
      case 'gramophone':
        this.music = !this.music;
        (window as any).__music?.setMood(this.music ? 'hub' : 'off');
        eng.audio.play('ui_click', { volume: 0.7 });
        emote(this.particles, c.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.9, 0)), 'note');
        break;
      case 'piano':
        eng.audio.play('banjo_funny', { volume: 0.8 });
        emote(this.particles, c.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.6, 0)), 'note');
        break;
      case 'dart': {
        const score = rnd.pick([5, 10, 20, 25, 50, 0]);
        eng.audio.play('kick', { volume: 0.6, pitch: 1.6 });
        this.flashTip(score === 50 ? 'BULLSEYE!' : score === 0 ? 'Missed the board. Embarrassing.' : `${score} points`);
        break;
      }
      case 'board':
        eng.audio.play('door_creak', { volume: 0.8 });
        this.onRide();
        break;
    }
  }

  private flashTip(t: string) {
    this.tip.textContent = t;
    this.tip.style.display = 'block';
    this.tip.style.left = '50%';
    this.tip.style.top = '12vh';
    this.tip.style.transform = 'translateX(-50%)';
    this.tip.style.fontSize = '24px';
    clearTimeout((this.tip as any)._t);
    (this.tip as any)._t = setTimeout(() => {
      this.tip.style.display = 'none';
      this.tip.style.transform = '';
      this.tip.style.fontSize = '17px';
      (this.tip as any)._t = 0;
    }, 1600);
  }

  exit() {
    this.panel?.remove();
    this.tip.remove();
    this.bank.remove();
    this.title.remove();
    this.wind?.stop(0.5);
    document.body.style.cursor = 'default';
  }

  update(_dt: number, rdt: number) {
    this.t += rdt;
    const t = this.t;
    const inp = this.engine.input;
    if (inp.wasPressed('Escape')) {
      if (this.panel) this.closePanel();
      else this.onMenu();
    }
    // hover / click
    if (!this.panel) {
      this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), this.camera);
      const hits = this.ray.intersectObjects(this.clickables.map((c) => c.obj), true);
      let h: Clickable | null = null;
      if (hits.length) {
        let o: THREE.Object3D | null = hits[0].object;
        while (o && !h) {
          h = this.clickables.find((c) => c.obj === o) ?? null;
          o = o.parent;
        }
      }
      if (h !== this.hovered) {
        if (h) this.engine.audio.play('ui_hover', { volume: 0.4 });
        this.hovered = h;
        document.body.style.cursor = h ? 'pointer' : 'default';
      }
      if (h) {
        this.tip.textContent = h.label;
        this.tip.style.display = 'block';
        this.tip.style.left = `${inp.mouseX + 16}px`;
        this.tip.style.top = `${inp.mouseY + 12}px`;
        if (inp.wasPressed('Mouse0')) this.click(h);
      } else if (!(this.tip as any)._t) this.tip.style.display = 'none';
    }
    for (const c of this.clickables) {
      c.hover = damp(c.hover, c === this.hovered ? 1 : 0, 10, rdt);
      if (c.id !== 'mirror' && c.id !== 'dart') c.obj.position.y = c.base.y + c.hover * 0.04;
    }
    // duck squash
    if (this.duck) {
      this.duckSquash = Math.max(0, this.duckSquash - rdt * 3);
      const k = Math.sin(this.duckSquash * 12) * this.duckSquash;
      this.duck.scale.set(1 + k * 0.25, 1 - k * 0.3, 1 + k * 0.25);
    }
    // gun turntable on the bench
    if (this.gun) this.gun.root.rotation.z = Math.PI / 2 + Math.sin(t * 0.7) * 0.4;
    if (this.gun?.nodes['cylinder']) this.gun.nodes['cylinder'].rotation.z += rdt * 0.8;
    // flames: the stove grate breathes, lanterns waver
    this.stoveLight.intensity = 6.5 + Math.sin(t * 13) * 1.2 + Math.sin(t * 5.3) * 0.8;
    this.flick.forEach((l, i) => (l.intensity = (i < 3 ? 4.5 : 1.4) * (1 + Math.sin(t * (6 + i * 1.7) + i * 2.1) * 0.06 + Math.sin(t * (17 + i)) * 0.03)));
    for (const sh of this.shafts) (sh.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    // dust motes drifting inside the light shafts, a lazy curl of stove smoke
    if (this.shafts.length && Math.random() < rdt * 22) {
      const sh = this.shafts[Math.floor(Math.random() * this.shafts.length)];
      const k = 0.12 + Math.random() * 0.75;
      const p = sh.top.clone().addScaledVector(SUN_TO, sh.len * k);
      p.x += (Math.random() - 0.5) * sh.r * 1.4;
      p.z += (Math.random() - 0.5) * sh.r * 1.4;
      this.particles.emit({ pos: p, count: 1, spread: 0.04, up: 0.02, life: [3, 6], size: [0.018, 0.018], sprite: 'dot3', color: 0xfff0d0, drag: 0.3, jitter: 0.05, fadeIn: 0.8 });
    }
    if (Math.random() < rdt * 1.5) this.particles.emit({ pos: { x: -5.0, y: 0.95, z: -3.4 }, count: 1, spread: 0.05, up: 0.25, life: [2, 3.5], size: [0.12, 0.45], sprite: ['cloud0', 'cloud1'], color: 0x6a5e56, alpha: 0.16, drag: 0.5, rot: 3, rotSpeed: 0.3 });
    // hero idle: leaning back on the bar, elbows on the counter, one boot up on the stool rung
    if (this.hero) {
      const n = this.hero.nodes;
      if (n['thigh_l']) n['thigh_l'].rotation.set(-1.35, 0, 0.2);
      if (n['thigh_r']) n['thigh_r'].rotation.set(-1.0, 0, -0.25);
      if (n['shin_l']) n['shin_l'].rotation.x = 1.55;
      if (n['shin_r']) n['shin_r'].rotation.x = 0.85;
      if (n['torso']) n['torso'].rotation.set(-0.12 + Math.sin(t * 1.3) * 0.015, Math.sin(t * 0.25) * 0.05, 0);
      if (n['head']) n['head'].rotation.set(0.05 + Math.sin(t * 0.45) * 0.04, this.hovered ? 0.35 : Math.sin(t * 0.22) * 0.3, 0);
      if (n['arm_r']) n['arm_r'].rotation.set(0.55, 0, -0.55);
      if (n['fore_r']) n['fore_r'].rotation.x = -1.35;
      if (n['arm_l']) n['arm_l'].rotation.set(0.5, 0, 0.6);
      if (n['fore_l']) n['fore_l'].rotation.x = -1.4;
      this.hero.root.updateMatrixWorld(true);
      if (this.pinch && Math.random() < rdt * 0.35) emote(this.particles, this.pinch.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0)), 'zzz', 0.6);
      this.faces.begin();
      this.heroEyes?.lookAt(this.hovered ? this.hovered.obj.getWorldPosition(new THREE.Vector3()) : this.camera.position);
      this.heroEyes?.draw(this.faces, rdt);
      this.faces.end(this.scene.fog as THREE.Fog);
    }
    this.particles.update(rdt, this.scene.fog as THREE.Fog);
    // ------------------------------------------------ cinematic camera
    // idle: a slow lateral drift + gentle push-in; focus: push in and hold; always a little handheld
    const g = this.goal;
    const tgt = g.pos.clone();
    const look = g.look.clone();
    if (!this.focused) {
      const right = new THREE.Vector3().subVectors(look, tgt).cross(new THREE.Vector3(0, 1, 0)).normalize();
      const fwd = new THREE.Vector3().subVectors(look, tgt).normalize();
      tgt.addScaledVector(right, Math.sin(t * 0.06) * 0.45 + inp.ndcX * 0.12);
      tgt.addScaledVector(fwd, Math.sin(t * 0.041 + 1) * 0.3);
      tgt.y += Math.sin(t * 0.09) * 0.05 + inp.ndcY * 0.06;
      look.addScaledVector(right, Math.sin(t * 0.06 - 0.6) * 0.25);
    }
    const walkIn = this.t < 5.5;
    const k = 1 - Math.exp(-rdt * (walkIn ? 0.75 : 2.0));
    this.camPos.lerp(tgt, k);
    this.camLook.lerp(look, 1 - Math.exp(-rdt * (walkIn ? 1.1 : 2.6)));
    const sway = new THREE.Vector3(Math.sin(t * 1.3) * 0.006 + Math.sin(t * 2.9) * 0.003, Math.sin(t * 1.7) * 0.005 + Math.sin(t * 3.7) * 0.002, 0);
    this.camera.position.copy(this.camPos).add(sway);
    this.camera.lookAt(this.camLook.clone().add(sway.multiplyScalar(1.6)));
    this.camera.rotateZ(Math.sin(t * 0.6) * 0.005);
    this.camera.fov = damp(this.camera.fov, g.fov, walkIn ? 0.8 : 2.2, rdt);
    this.camera.updateProjectionMatrix();
  }
}

export { Ease };
