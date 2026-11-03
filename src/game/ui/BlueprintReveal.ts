// BLUEPRINT FOUND: the world pauses, the rolled schematic flies up in front of
// the camera, the wax seal cracks and the parchment unrolls between two wooden
// rollers. The sheet is a photograph of a real 3D scene: the item itself (the
// gun with its part fitted, the gear piece, the cartridges of an upgrade) laid
// on a sculpted parchment sheet and shot through the CardStudio (sun, cel
// shadow, ink lines, a sepia grade). Alagard plaques (DOM) carry the words.
// E / click / Space rolls it back up and it soaks into the hunter.
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Input } from '../../engine/Input';
import { Ease } from '../../engine/Tween';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance } from '../../engine/voxel/Rig';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { CardStudio, Shot } from './CardStudio';
import { blueprint, Blueprints, bpColor, bpHex, ATTACHMENTS, WEAPON_UPGRADES, BlueprintDef } from '../meta/Blueprints';
import { buildWeaponRig } from '../player/Weapons';
import { buildGearDisplay, gearGlassMaterial } from '../player/Equipment';
import { parchmentSheet, scrollRoller, SCROLL_RIBBON } from '../models/props/treasure';
import { cartridgeTrio, revolverLaserModel } from '../models/characters/longguns';
import * as CH from '../models/characters';

const SHEET_W = 1.12;
const SHEET_H = 0.7;
const SEG = 72;
const ROLL_R = 0.022;

const photos = new Map<string, THREE.Texture>();
let mat: VoxelMaterial | null = null;

/** the item a blueprint unlocks, as a 3D object (also used by the hideout for previews) */
export function blueprintItem(def: BlueprintDef, material?: THREE.Material): { obj: THREE.Object3D; length: number } | null {
  const m = (material ?? (mat ??= makeVoxelMaterial())) as VoxelMaterial;
  if (def.kind === 'gun' || def.kind === 'attachment') {
    const g = def.gun ?? 'revolver';
    let spec;
    if (g === 'revolver') spec = (CH as any).revolverRig?.({ barrel: 'standard', cylinder: 'standard', grip: 'wood', sight: 'iron' });
    else {
      // the gun with this part fitted (and whatever else is already fitted in other slots)
      const fitted = Blueprints.fitted(g).filter((a) => a.slot !== def.slot);
      if (def.kind === 'attachment' && ATTACHMENTS[def.id]) fitted.push(ATTACHMENTS[def.id]);
      spec = buildWeaponRig(g, fitted);
    }
    if (!spec) return null;
    const inst = new RigInstance(buildRigGeo(spec, spec.name + ':bp'), { material: m });
    if (g === 'revolver' && def.id === 'rev_laser') {
      // the laser clamped under the barrel (same spot Weapons fits it in game)
      const lm = revolverLaserModel();
      const mesh = new THREE.Mesh(buildVoxelGeometry(lm.model, { voxelSize: lm.voxelSize, pivot: lm.pivot }), m);
      const vs = spec.voxelSize, piv = spec.parts[0].pivot;
      mesh.position.set((0.5 - piv[0]) * vs, (0.6 - piv[1]) * vs, (10.5 - piv[2]) * vs);
      inst.nodes['frame']?.add(mesh);
    }
    return { obj: inst.root, length: (spec.meta?.length as number) ?? 0.5 };
  }
  if (def.kind === 'gear' && def.gear) {
    const d = buildGearDisplay(def.gear, m, gearGlassMaterial(), 0.46);
    return { obj: d, length: 0.46 };
  }
  if (def.kind === 'upgrade') {
    const u = WEAPON_UPGRADES[def.id];
    const c = cartridgeTrio(u?.tip ?? 0xd0a040);
    const mesh = new THREE.Mesh(buildVoxelGeometry(c.model, { voxelSize: c.voxelSize, pivot: c.pivot }), m);
    mesh.scale.setScalar(3.4);
    const g = new THREE.Group();
    g.add(mesh);
    return { obj: g, length: 0.36 };
  }
  return null;
}

/** photograph the item lying on a parchment sheet: the schematic (cached, 'scene' light for in-world use) */
export function blueprintPhoto(renderer: THREE.WebGLRenderer, id: string): THREE.Texture | null {
  const hit = photos.get(id);
  if (hit) return hit;
  const def = blueprint(id);
  if (!def) return null;
  mat ??= makeVoxelMaterial();
  const root = new THREE.Group();
  const sheet = parchmentSheet(124, 80, id.length * 7 + 3);
  const sheetMesh = new THREE.Mesh(buildVoxelGeometry(sheet.model, { voxelSize: sheet.voxelSize, pivot: sheet.pivot }), mat);
  root.add(sheetMesh);
  const item = blueprintItem(def, mat);
  if (item) {
    const holder = new THREE.Group();
    holder.add(item.obj);
    // guns lie on their left flank, muzzle to the right, top toward the head of the sheet
    if (def.kind === 'gun' || def.kind === 'attachment') {
      const x = new THREE.Vector3(0, -1, 0), y = new THREE.Vector3(0, 0, -1), z = new THREE.Vector3(1, 0, 0);
      holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    } else if (def.kind === 'upgrade') holder.rotation.set(-Math.PI / 2, 0, Math.PI / 2.4);
    else holder.rotation.set(-0.5, 0.6, 0);
    // centre it on the sheet, a hand's breadth above (it throws a shadow on the paper)
    root.add(holder);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const fit = Math.min(0.92 / Math.max(0.05, size.x), 0.5 / Math.max(0.05, size.z));
    holder.scale.setScalar(Math.min(1.6, fit));
    root.updateMatrixWorld(true);
    box.setFromObject(holder);
    const c = box.getCenter(new THREE.Vector3());
    holder.position.set(-c.x, 0.03 - box.min.y + 0.012, -c.z - 0.02);
  }
  const dist = 1.36;
  const pitch = 1.22;
  const shot: Shot = {
    root,
    cam: { pos: [0, Math.sin(pitch) * dist, Math.cos(pitch) * dist], look: [0, 0, -0.01], fov: 30 },
    sky: { zenith: 0x6a5a48, mid: 0x8a7258, horizon: 0xb09070, ground: 0x6a5038, sunDir: [-0.4, 0.8, -0.5], sunColor: 0xfff0d0, sunSize: 0, gain: 0.6 },
    key: { dir: [-0.55, 0.75, -0.45], color: 0xfff2dc, intensity: 3.0, center: [0, 0, 0], radius: 1.0 },
    hemi: { sky: 0xf0e0c0, ground: 0x8a6a48, intensity: 0.9 },
    rim: { dir: [0.6, 0.4, 0.8], color: 0xffd8a0, intensity: 0.8 },
    grade: { sat: 0.82, contrast: 1.1, shadowTint: 0xb89878, highTint: 0xfff2dc, vignette: 0.55, bloom: [0.18, 0.3, 1.6], grain: 0.07 },
    ink: { color: 0x2a1608, thr: 0.04, rel: 0.02, thick: 1.0, strength: 1 },
    env: 0.3,
    display: 'scene',
  };
  const studio = new CardStudio(renderer);
  let tex: THREE.Texture;
  try {
    const cv = studio.shoot(shot, 576, 360, 2);
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
  } finally {
    studio.dispose();
    sheetMesh.geometry.dispose();
  }
  photos.set(id, tex);
  return tex;
}

const SHEET_VS = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
void main(){
  vUv = uv;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SHEET_FS = /* glsl */ `
uniform sampler2D map;
uniform vec3 uLight;
uniform float uGlow, uT;
varying vec2 vUv;
varying vec3 vN;
void main(){
  vec3 n = normalize(gl_FrontFacing ? vN : -vN);
  float l = 0.62 + 0.5 * max(dot(n, normalize(uLight)), 0.0);
  vec3 c = gl_FrontFacing ? texture2D(map, vUv).rgb * 2.0 : vec3(0.74, 0.6, 0.4) * 0.85;
  // a slow warm sheen sweeping across the paper
  float band = exp(-pow((vUv.x * 0.9 + vUv.y * 0.4 - fract(uT * 0.22) * 2.4 + 0.5) * 5.0, 2.0));
  c += vec3(1.0, 0.9, 0.7) * band * 0.08 * uGlow;
  gl_FragColor = vec4(c * l, 1.0);
}`;

interface Job {
  id: string;
  from?: THREE.Vector3;
  done: () => void;
}

export class BlueprintReveal {
  /** true while the reveal owns the screen (world paused) */
  active = false;
  private group = new THREE.Group();
  private sheet: THREE.Mesh;
  private sheetMat: THREE.ShaderMaterial;
  private rollL: THREE.Mesh;
  private rollR: THREE.Mesh;
  private ui: HTMLDivElement;
  private queue: Job[] = [];
  private job: Job | null = null;
  private unroll = 0;
  private t = 0;
  private ready = false;
  private closing = false;
  private hold = new THREE.Group();

  constructor(private ctx: Ctx, private input: Input, private hud?: { setVisible(on: boolean): void }, private hero?: () => THREE.Vector3) {
    const geo = new THREE.PlaneGeometry(SHEET_W, SHEET_H, SEG, 1);
    this.sheetMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, uLight: { value: new THREE.Vector3(-0.3, 0.5, 1) }, uGlow: { value: 1 }, uT: { value: 0 } },
      vertexShader: SHEET_VS,
      fragmentShader: SHEET_FS,
      side: THREE.DoubleSide,
    });
    this.sheet = new THREE.Mesh(geo, this.sheetMat);
    this.sheet.frustumCulled = false;
    mat ??= makeVoxelMaterial();
    const r = scrollRoller(SHEET_H * 100 + 1);
    const rg = buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: r.pivot });
    this.rollL = new THREE.Mesh(rg, mat);
    this.rollR = new THREE.Mesh(rg, mat);
    this.hold.add(this.sheet, this.rollL, this.rollR);
    this.group.add(this.hold);
    this.group.visible = false;
    ctx.scene.add(this.group);
    this.ui = document.createElement('div');
    this.ui.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:7;display:none;font-family:'Alagard';color:#fff3d6;text-shadow:0 2px 0 #2a1810,0 0 12px rgba(0,0,0,0.55);letter-spacing:1px;text-align:center";
    ctx.engine.overlay.appendChild(this.ui);
  }

  /** show the reveal for a blueprint (queued if one is already up); resolves when it is rolled away */
  show(id: string, from?: THREE.Vector3): Promise<void> {
    return new Promise((done) => {
      this.queue.push({ id, from: from?.clone(), done });
      if (!this.active) this.next();
    });
  }

  private next() {
    const job = this.queue.shift();
    if (!job) return;
    const def = blueprint(job.id);
    if (!def) {
      job.done();
      return this.next();
    }
    const ctx = this.ctx;
    const eng = ctx.engine;
    this.job = job;
    this.active = true;
    this.ready = false;
    this.closing = false;
    this.unroll = 0;
    eng.paused = true;
    this.input.enabled = false;
    eng.audio.setMuffle(0.5);
    this.hud?.setVisible(false);
    this.sheetMat.uniforms.map.value = blueprintPhoto(eng.renderer, job.id);
    this.layout(0);
    // where it sits: in front of the camera, a touch low
    const cam = ctx.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const home = cam.position.clone().addScaledVector(fwd, 1.2).addScaledVector(up, 0.1);
    const start = job.from ?? cam.position.clone().addScaledVector(fwd, 2).addScaledVector(up, -1.2);
    this.group.visible = true;
    this.group.position.copy(start);
    this.group.quaternion.copy(cam.quaternion);
    this.group.scale.setScalar(0.25);
    const col = bpColor(job.id);
    const hex = bpHex(job.id);
    const cnt = Blueprints.count();
    this.ui.innerHTML =
      `<div style="position:absolute;left:0;right:0;top:6vh;font-size:46px;color:${col};opacity:0" data-a>BLUEPRINT FOUND</div>` +
      `<div style="position:absolute;left:0;right:0;top:calc(6vh + 54px);font-size:17px;opacity:0" data-a>${def.line}</div>` +
      `<div style="position:absolute;left:50%;transform:translateX(-50%);bottom:9vh;width:min(760px,90vw);opacity:0" data-b>` +
      `<div style="font-size:34px;color:${col}">${def.name.toUpperCase()}</div>` +
      `<div style="font-size:17px;margin-top:8px;line-height:1.35;color:#f6e8c8">${def.desc}</div>` +
      `<div style="font-size:15px;margin-top:10px;color:#e0b373">PERMANENTLY UNLOCKED · ${cnt.found} / ${cnt.total} BLUEPRINTS</div></div>` +
      `<div style="position:absolute;left:0;right:0;bottom:3vh;font-size:16px;opacity:0" data-b>E · CLICK · SPACE to roll it up</div>`;
    this.ui.style.display = 'block';
    const fade = (sel: string, d: number) => eng.tweens.after(d, () => this.ui.querySelectorAll<HTMLElement>(sel).forEach((e) => {
      e.style.transition = 'opacity .35s';
      e.style.opacity = '1';
    }), true);
    ctx.sfx('loot_reveal', null, 0.8);
    ctx.sfx('paper_flutter', null, 0.7, 0.9);
    // fly in, spinning the roll to face you
    eng.tweens.run(0.6, (k) => {
      this.group.position.lerpVectors(start, home, k);
      this.group.position.addScaledVector(up, Math.sin(Math.min(1, k) * Math.PI) * 0.25);
      this.group.scale.setScalar(0.25 + 0.75 * Math.min(1, k));
      this.group.quaternion.copy(cam.quaternion);
      this.group.rotateZ((1 - k) * 2.4);
    }, Ease.outBack, {
      real: true,
      done: () => {
        // the seal cracks and the ribbon snaps away
        const seal = this.hold.localToWorld(new THREE.Vector3(-SHEET_W / 2 + 0.03, 0, 0.04));
        const rib = SCROLL_RIBBON[def.kind] ?? 0xb8322a;
        ctx.particles.emit({ pos: seal, count: 14, spread: 1.6, up: 1.2, life: [0.4, 0.8], size: [0.05, 0.02], sprite: ['dot3', 'spark'], color: [0xa82a1c, rib, 0x7a1a12], gravity: 6, drag: 1.5 });
        ctx.particles.emit({ pos: seal, count: 10, spread: 1.4, up: 0.6, life: [0.3, 0.6], size: [0.09, 0.02], sprite: 'star4', additive: true, color: [hex, 0xffffff], drag: 2 });
        ctx.sfx('glass_break', null, 0.25, 1.8);
        ctx.sfx('page_turn', null, 0.7);
        eng.tweens.run(0.85, (k) => this.layout(k), Ease.outCubic, { real: true, done: () => (this.ready = true) });
        fade('[data-a]', 0.1);
        fade('[data-b]', 0.55);
        if (def.rarity === 'epic' || def.rarity === 'legendary' || def.kind === 'gun') {
          ctx.sfx('divine_chime', null, 0.55);
          eng.tweens.after(0.6, () => ctx.fx.sparkle(this.group.position, hex, 16, 0.7), true);
        }
      },
    });
  }

  /** bend the sheet: flat up to the unrolled front, wrapped round the right roller past it */
  private layout(k: number) {
    this.unroll = k;
    const pos = this.sheet.geometry.getAttribute('position') as THREE.BufferAttribute;
    const x0 = -SHEET_W / 2;
    const front = x0 + 0.012 + (SHEET_W - 0.012) * k;
    for (let i = 0; i < pos.count; i++) {
      const u = (i % (SEG + 1)) / SEG;
      const y = i < SEG + 1 ? SHEET_H / 2 : -SHEET_H / 2;
      const x = x0 + u * SHEET_W;
      if (x <= front) pos.setXYZ(i, x, y, 0);
      else {
        // a tight spiral: each turn sits a hair further out
        const s = x - front;
        let th = 0, r = ROLL_R, left = s;
        while (left > 0) {
          const step = Math.min(left, 0.004);
          th += step / r;
          r = ROLL_R + (th / (Math.PI * 2)) * 0.0016;
          left -= step;
        }
        pos.setXYZ(i, front + Math.sin(th) * r, y, ROLL_R - Math.cos(th) * r);
      }
    }
    pos.needsUpdate = true;
    this.sheet.geometry.computeVertexNormals();
    this.rollR.position.set(front + 0.002, 0, ROLL_R);
    this.rollL.position.set(x0 - 0.01, 0, -0.012);
    this.rollR.rotation.y = -k * 14;
  }

  private close() {
    if (!this.job || this.closing) return;
    this.closing = true;
    const ctx = this.ctx;
    const eng = ctx.engine;
    ctx.sfx('paper_flutter', null, 0.6, 1.2);
    ctx.sfx('card_pick', null, 0.7);
    this.ui.querySelectorAll<HTMLElement>('[data-a],[data-b]').forEach((e) => (e.style.opacity = '0'));
    const from = this.group.position.clone();
    const hero = this.hero?.();
    const cam = ctx.camera;
    const to = hero ?? cam.position.clone().add(new THREE.Vector3(0, -1.6, 0).applyQuaternion(cam.quaternion)).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), 3);
    eng.tweens.run(0.32, (k) => this.layout(1 - k), Ease.inQuad, {
      real: true,
      done: () => {
        eng.tweens.run(0.42, (k) => {
          this.group.position.lerpVectors(from, to, k);
          this.group.scale.setScalar(1 - k * 0.8);
          this.group.rotateZ(0.2);
        }, Ease.inQuad, {
          real: true,
          done: () => {
            ctx.fx.sparkle(to, bpHex(this.job?.id ?? ''), 14, 0.5);
            ctx.sfx('gem_chime', null, 0.55);
            this.finish();
          },
        });
      },
    });
  }

  private finish() {
    const job = this.job;
    this.group.visible = false;
    this.ui.style.display = 'none';
    this.job = null;
    this.active = false;
    const eng = this.ctx.engine;
    if (this.queue.length) {
      job?.done();
      return this.next();
    }
    eng.paused = false;
    this.input.enabled = true;
    eng.audio.setMuffle(0);
    this.hud?.setVisible(true);
    job?.done();
  }

  /** call every frame with real time (before the scene's modal early return) */
  update(rdt: number) {
    if (!this.active) return;
    this.t += rdt;
    this.sheetMat.uniforms.uT.value = this.t;
    // a gentle hover while it is up
    if (this.ready && !this.closing) {
      const cam = this.ctx.camera;
      this.group.quaternion.copy(cam.quaternion);
      this.hold.rotation.set(Math.sin(this.t * 0.9) * 0.025, Math.sin(this.t * 0.7) * 0.05, 0);
      const inp = this.input;
      if (inp.wasPressed('KeyE') || inp.wasPressed('Space') || inp.wasPressed('Enter') || inp.clicked(0) || inp.wasPressed('KeyT')) this.close();
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.ui.remove();
    this.sheet.geometry.dispose();
    this.sheetMat.dispose();
    if (this.active) {
      this.ctx.engine.paused = false;
      this.input.enabled = true;
      this.hud?.setVisible(true);
    }
  }
}
