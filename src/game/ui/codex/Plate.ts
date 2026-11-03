// A Codex plate: a little lit diorama (a sand mound with pebbles and dry grass, a
// painted dusk backdrop, a warm key with crisp cel shadows, a cool rim) holding a
// live Puppet, rendered every frame into a texture the page shader paints with ink
// lines from the depth. Places get a miniature of the spot built from the game's
// own props; blueprints a turntable in the drafting light; unknown entries a
// shadowed silhouette.
import * as THREE from 'three';
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { buildRigGeo, RigSpec } from '../../../engine/voxel/Rig';
import { hash3 } from '../../../engine/math/rand';
import { sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { modelEntry } from '../../models/lookup';
import * as CH from '../../models/characters';
import { CONSUMABLES } from '../../models/characters/consumables';
import * as LG from '../../models/characters/longguns';
import type { CodexEntry } from '../../meta/Codex';
import { Puppet } from './Puppet';

export const PLATE_RES = 512;

/** props for each place's miniature: [registry key, x, z, yaw, scale] (metres around the mound) */
const PLACES: Record<string, [string, number, number, number, number][]> = {
  flats: [['cactus_saguaro_dmg1', -1.4, -0.6, 0.4, 1], ['skull_cow', 0.9, 0.5, 2.2, 1.4], ['tumbleweed', 1.5, -0.8, 0, 1]],
  canyon: [['column_broken', -1.2, -0.9, 0.3, 0.9], ['cattle_skull_post', 1.1, 0.2, -0.6, 1], ['skull_cow', -0.2, 0.9, 1.4, 1.2]],
  bones: [['rib_arch', 0, -0.6, 0.4, 0.55], ['skull_giant', 1.3, 0.6, -0.8, 0.5], ['skull_cow', -1.2, 0.7, 2.6, 1.2]],
  temple: [['statue_thoth', -0.6, -0.7, 0.3, 0.55], ['column_broken', 1.0, -0.4, 0.8, 0.7], ['sarcophagus', 0.3, 0.8, -0.4, 0.6]],
  outpost: [['watchtower', -0.7, -0.9, 0.3, 0.45], ['trough', 1.0, 0.4, -0.4, 1], ['chest_wood', -0.4, 0.8, 0.6, 1.2]],
  glassdunes: [['obelisk_broken', 0.2, -0.8, 0.2, 0.55], ['ore_amethyst', -1.0, 0.4, 0.4, 1.4], ['ore_turquoise', 1.1, 0.6, -0.2, 1.3]],
  hollows: [['scorpion_totem', 0, -0.6, 0.2, 0.7], ['skull_cow', 1.2, 0.6, 2.0, 1.2], ['dung_ball', -1.0, 0.7, 0, 1.4]],
  obelisks: [['obelisk', -0.6, -0.8, 0.1, 0.4], ['obelisk_broken', 0.9, -0.3, 0.6, 0.45], ['obelisk', 0.2, 0.9, 0.3, 0.3]],
  mesas: [['watchtower', 0.2, -0.8, 0.5, 0.4], ['well', -1.0, 0.5, 0.2, 0.7], ['cactus_saguaro_dmg2', 1.2, 0.4, 0, 0.8]],
  arena: [['gallows', 0, -0.7, 0.2, 0.55], ['skull_cow', 1.1, 0.6, 2.2, 1.2], ['scorpion_totem', -1.1, 0.4, 0.8, 0.6]],
  palmshore: [['well', -0.6, -0.5, 0.2, 0.7], ['column_broken', 1.0, -0.4, 0.4, 0.6], ['trough', 0.4, 0.8, 0.3, 1]],
  marsh: [['column_broken', -0.8, -0.6, 0.6, 0.65], ['statue_bastet', 0.9, -0.5, -0.3, 0.45], ['skull_cow', 0, 0.9, 1.0, 1.1]],
  floodruins: [['column', -0.9, -0.7, 0.2, 0.45], ['column_broken', 0.9, -0.6, 0.7, 0.55], ['sarcophagus', 0, 0.7, 0.4, 0.55]],
  lotustemple: [['temple_gate', 0, -0.8, 0, 0.35], ['statue_bastet', -1.1, 0.4, 0.6, 0.45], ['statue_horus', 1.1, 0.4, -0.6, 0.45]],
  oasisheart: [['well', 0, -0.5, 0.3, 0.8], ['statue_sekhmet', -1.1, 0.3, 0.6, 0.45], ['chest_gold', 1.0, 0.6, -0.4, 1.1]],
  stormapproach: [['statue_set', 0, -0.7, 0, 0.45], ['obelisk_broken', 1.2, -0.2, 0.6, 0.45], ['skull_giant', -1.0, 0.6, 1.2, 0.45]],
  sphinxavenue: [['sphinx', 0, -0.5, 0.2, 0.22], ['obelisk', -1.3, 0.5, 0.1, 0.3], ['obelisk', 1.3, 0.5, 0.1, 0.3]],
  pyramidbase: [['capstone', 0, -0.4, 0.4, 0.5], ['statue_anubis', -1.1, 0.4, 0.6, 0.45], ['column_broken', 1.1, 0.5, -0.4, 0.55]],
  pyramidterraces: [['temple_gate', 0, -0.7, 0, 0.32], ['statue_ra', -1.1, 0.4, 0.5, 0.42], ['chest_divine', 1.0, 0.6, -0.3, 1]],
  apex: [['capstone', 0, -0.2, 0.7, 0.55], ['statue_set', -1.1, 0.3, 0.6, 0.42], ['statue_serket', 1.1, 0.3, -0.6, 0.42]],
};

const SAND = [0xe8c48a, 0xd9ad70, 0xf2d6a2, 0xc99a5e];

/** a sand mound (unit radius ~1 m): wind ripples, pebbles, two dry grass tufts, a bleached rib */
function moundGeometry(seed: number) {
  const VS = 1 / 40, R = 40;
  const m = new VoxelModel('plate_mound');
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++) {
      const r = Math.hypot(x, z * 1.15) / R;
      if (r > 1) continue;
      const h = Math.round((1 - r * r) * 5 + Math.sin(x * 0.45 + z * 0.2) * 0.6 * (1 - r));
      const rip = Math.sin(x * 0.55 + z * 0.3 + Math.sin(z * 0.2) * 1.2);
      for (let y = Math.min(0, h - 2); y <= h; y++) {
        let c = y === h ? (rip > 0.5 ? SAND[2] : rip < -0.6 ? SAND[1] : SAND[0]) : SAND[1];
        const n = hash3(x, z, seed);
        if (y === h && n > 0.985) c = 0x8a7660;
        if (y === h && r > 0.92) c = SAND[3];
        m.set(x, y, z, c);
      }
    }
  // dry grass tufts
  for (const [tx, tz] of [[-26, 14], [24, -18]] as const) {
    const base = Math.round((1 - Math.hypot(tx, tz * 1.15) ** 2 / (R * R)) * 5);
    for (let b = 0; b < 9; b++) {
      const a = (b / 9) * Math.PI * 2, L = 5 + (b % 3) * 2;
      for (let s = 1; s <= L; s++) m.set(Math.round(tx + Math.cos(a) * s * 0.35), base + s, Math.round(tz + Math.sin(a) * s * 0.35), s > L - 2 ? 0xd8c088 : 0xb09858);
    }
  }
  // a bleached rib arching out of the sand
  for (let s = 0; s <= 16; s++) {
    const a = (s / 16) * Math.PI * 0.85;
    m.set(18 + Math.round(Math.cos(a) * 9), 3 + Math.round(Math.sin(a) * 6), 18, s % 5 === 0 ? 0xe8d8b8 : 0xf2e4c8);
  }
  return buildVoxelGeometry(m, { voxelSize: VS, pivot: [0.5, 5.5, 0.5], ao: 0.85 });
}

let mound: THREE.BufferGeometry | null = null;

const BACK_FS = /* glsl */ `
uniform vec3 uTop, uMid, uLow, uSun;
uniform float uBlue;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 c = d.y > 0.0 ? mix(uMid, uTop, smoothstep(0.0, 0.6, d.y)) : mix(uMid, uLow, smoothstep(0.0, 0.25, -d.y));
  c += uSun * pow(max(dot(d, normalize(vec3(-0.6, 0.12, -0.8))), 0.0), 8.0) * 0.6;
  c = mix(c, vec3(0.0), uBlue);
  gl_FragColor = vec4(c, 1.0);
}`;

export class Plate {
  rt: THREE.WebGLRenderTarget;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  entry: CodexEntry | null = null;
  locked = false;
  puppet: Puppet | null = null;
  private props = new THREE.Group();
  private ground: THREE.Mesh;
  private back: THREE.Mesh;
  private backU: Record<string, THREE.IUniform>;
  private key: THREE.DirectionalLight;
  private rim: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private look = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private spin = 0;
  private hoverCd = 0;
  style = 1;

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(PLATE_RES, PLATE_RES, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(PLATE_RES, PLATE_RES) });
    this.rt.texture.minFilter = THREE.LinearFilter;
    this.rt.texture.generateMipmaps = false;
    mound ??= moundGeometry(7);
    this.ground = new THREE.Mesh(mound, sharedVoxelMaterial);
    this.ground.receiveShadow = true;
    this.ground.castShadow = true;
    this.scene.add(this.ground, this.props);
    this.backU = { uTop: { value: new THREE.Color(0x3a3060) }, uMid: { value: new THREE.Color(0xd8925a) }, uLow: { value: new THREE.Color(0x6a4a3a) }, uSun: { value: new THREE.Color(0xffc080) }, uBlue: { value: 0 } };
    this.back = new THREE.Mesh(
      new THREE.SphereGeometry(40, 24, 12),
      new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: this.backU, vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: BACK_FS })
    );
    this.back.renderOrder = -5;
    this.scene.add(this.back);
    this.key = new THREE.DirectionalLight(0xffd8a8, 3.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.rim = new THREE.DirectionalLight(0x8fb0ff, 1.6);
    this.hemi = new THREE.HemisphereLight(0xa8b0d8, 0x7a5434, 0.75);
    this.scene.add(this.key, this.key.target, this.rim, this.hemi);
  }

  /** stage an entry (hero: the hunter's rig for his own page) */
  set(e: CodexEntry, locked: boolean, hero: RigSpec | null) {
    if (this.entry === e && this.locked === locked) return;
    this.clear();
    this.entry = e;
    this.locked = locked;
    this.style = locked ? 3 : e.plate === 'blueprint' ? 2 : 1;
    let p: Puppet | null = null;
    try {
      if (e.enemy) p = Puppet.enemy(e.enemy);
      else if (e.model === '@hero') p = hero ? Puppet.rig(hero, { key: 'codex:hero:' + hero.name }) : null;
      else if (e.model?.startsWith('@long:')) {
        const g = e.model.slice(6);
        const spec = ((LG as any)[g === 'tommy' ? 'tommyRig' : 'shotgunRig']?.() ?? null) as RigSpec | null;
        if (spec?.parts) p = Puppet.rig(spec, { spin: true, key: 'codex:long:' + g });
      } else if (e.model?.startsWith('@cart:')) {
        const m = (LG as any).cartridgeTrio?.(+e.model.slice(6));
        if (m?.model) p = Puppet.model(m, 'codex:cart:' + e.model.slice(6));
      } else if (e.model === '@revlaser') {
        const m = (LG as any).revolverLaserModel?.();
        if (m?.model) p = Puppet.model(m, 'codex:revlaser');
      } else if (e.model?.startsWith('@gun:')) {
        const [slot, part] = e.model.slice(5).split(':');
        const spec = (CH as any).revolverRig?.({ barrel: 'standard', cylinder: 'standard', grip: 'wood', sight: 'iron', [slot]: part }) as RigSpec;
        if (spec?.parts) p = Puppet.rig(spec, { spin: true, key: 'codex:gun:' + slot + part });
      } else if (e.model && CONSUMABLES[e.model]) p = Puppet.model(CONSUMABLES[e.model](), e.model);
      else if (e.model) p = Puppet.fromKey(e.model);
    } catch (err) {
      console.warn('[codex] plate model', e.key, err);
      p = null;
    }
    if (e.theme) this.buildPlace(e.theme);
    this.puppet = p;
    if (p) {
      if (p.mode === 'spin' && e.cat !== 'legend') p.root.rotation.y = 0.6;
      this.scene.add(p.root);
      if (locked) p.setSilhouette(true);
      p.update(0.016, this.camera.position);
    }
    this.ground.visible = this.style !== 2;
    this.backU.uBlue.value = this.style === 2 ? 1 : 0;
    this.frame();
  }

  private buildPlace(theme: string) {
    for (const [key, x, z, ry, sc] of PLACES[theme] ?? []) {
      try {
        const r = modelEntry(key)?.() as any;
        if (!r) continue;
        let obj: THREE.Object3D;
        if (r.parts) obj = Puppet.rig(r as RigSpec, { key: 'codex:place:' + key }).root;
        else {
          const m = new THREE.Mesh(buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: 'bottom' }), sharedVoxelMaterial);
          m.castShadow = m.receiveShadow = true;
          m.userData.own = true;
          obj = m;
        }
        obj.position.set(x * 0.7, 0, z * 0.7);
        obj.rotation.y = ry;
        obj.scale.setScalar(sc * 0.55);
        this.props.add(obj);
      } catch (err) {
        console.warn('[codex] place prop', key, err);
      }
    }
  }

  /** frame the subject: whatever is on the mound fills the plate with a little air round it */
  private frame() {
    const box = new THREE.Box3();
    const subj = this.puppet?.root ?? this.props;
    subj.updateMatrixWorld(true);
    box.setFromObject(subj);
    if (this.props.children.length) box.union(new THREE.Box3().setFromObject(this.props));
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.z) * 0.5;
    // the mound scales to the subject's footprint
    const gr = Math.max(0.35, r * 1.5);
    this.ground.scale.set(gr, Math.min(1, gr), gr);
    const fit = Math.max(size.y, Math.max(size.x, size.z) * 0.9) * 1.32 + 0.05;
    const dist = fit / (2 * Math.tan(THREE.MathUtils.degToRad(15))) + r * 0.6;
    const pitch = this.entry?.cat === 'place' ? 0.42 : this.style === 2 ? 0.32 : 0.16;
    const yaw = this.style === 2 ? 0.0 : -0.38;
    this.look.set(c.x, c.y - size.y * 0.03, c.z);
    this.camPos.set(c.x + Math.sin(yaw) * Math.cos(pitch) * dist, this.look.y + Math.sin(pitch) * dist, c.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    this.camera.near = Math.max(0.01, dist * 0.08);
    this.camera.far = dist * 4 + 10;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.look);
    this.camera.updateProjectionMatrix();
    // the painted backdrop always sits inside the far plane
    this.back.position.copy(this.camPos);
    this.back.scale.setScalar((this.camera.far * 0.85) / 40);
    // a warm key from the front-left, a cool rim from behind
    const L = Math.max(1, dist);
    this.key.position.set(c.x - L * 0.8, c.y + L * 1.2, c.z + L * 0.9);
    this.key.target.position.copy(c);
    const sc = this.key.shadow.camera;
    const ext = Math.max(gr * 1.1, size.y);
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 0.05;
    sc.far = L * 4 + ext * 2;
    sc.updateProjectionMatrix();
    this.rim.position.set(c.x + L, c.y + L * 0.6, c.z - L * 1.2);
  }

  /** hovering the plate: the creature attacks (or the object hops and spins) */
  provoke() {
    if (this.locked || this.hoverCd > 0 || !this.puppet) return;
    this.puppet.attack();
    this.hoverCd = 2.2;
  }

  render(renderer: THREE.WebGLRenderer, dt: number) {
    this.hoverCd = Math.max(0, this.hoverCd - dt);
    const p = this.puppet;
    if (p) p.update(dt, this.camera.position);
    if (this.entry?.cat === 'place') {
      this.spin += dt * 0.12;
      this.props.rotation.y = Math.sin(this.spin) * 0.35;
      this.ground.rotation.y = this.props.rotation.y;
    }
    const prevT = renderer.getRenderTarget();
    const prevTone = renderer.toneMapping;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevA = renderer.getClearAlpha();
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevT);
    renderer.toneMapping = prevTone;
    renderer.setClearColor(prevClear, prevA);
  }

  private clear() {
    this.puppet?.dispose();
    this.puppet = null;
    for (const o of [...this.props.children]) {
      o.removeFromParent();
      if ((o as THREE.Mesh).userData?.own) (o as THREE.Mesh).geometry.dispose();
    }
    this.props.rotation.y = 0;
    this.ground.rotation.y = 0;
  }

  dispose() {
    this.clear();
    this.rt.depthTexture?.dispose();
    this.rt.dispose();
    this.back.geometry.dispose();
    (this.back.material as THREE.Material).dispose();
    this.key.shadow.map?.dispose();
  }
}
