// THE WEIGHING OF THE HEART — once per run, death sends Sundown's soul to the
// Duat. Anubis stands behind the Scales of Ma'at; keep the scales level, then
// trace the hieroglyphs. Pass: resurrection. Fail: Ammit's snack.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import type { Qte } from '../ui/Qte';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, RigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { modelEntry } from '../models/lookup';
import { placeholderHumanoid } from '../models/placeholder';
import { TOON, bevelBox, disc } from '../models/style';
import { FaceQuads, RigEyes } from '../fx/FaceFx';
import { Ease } from '../../engine/Tween';
import { rnd } from '../../engine/math/rand';

function floorModel() {
  const m = new VoxelModel('duat_floor');
  const N = 22;
  for (let x = -N; x <= N; x++)
    for (let z = -N; z <= N; z++) {
      const tile = ((Math.floor((x + 100) / 3) + Math.floor((z + 100) / 3)) & 1) === 0;
      const seam = (x + 100) % 3 === 0 || (z + 100) % 3 === 0;
      const r = Math.hypot(x, z);
      if (r > N + 0.5) continue;
      m.set(x, 0, z, seam ? 0x0a1418 : tile ? 0x14262c : 0x0f1d22);
      // gold inlay ring around the scales
      if (Math.abs(r - 6) < 0.5) m.set(x, 0, z, TOON.gold.shade);
    }
  return m;
}

function pillarModel() {
  const m = new VoxelModel('duat_pillar');
  bevelBox(m, -2, 0, -2, 2, 1, 2, 0x2a3a40, 1);
  bevelBox(m, -1, 2, -1, 1, 22, 1, 0x1e2c32, 0);
  for (let y = 4; y < 22; y += 4) for (let x = -1; x <= 1; x++) m.set(x, y, 2, TOON.turquoise.shade);
  bevelBox(m, -2, 23, -2, 2, 24, 2, 0x2a3a40, 1);
  // brazier bowl with a small teal flame
  disc(m, 0, 0, 25, 25, 2.2, TOON.gold.shade);
  disc(m, 0, 0, 26, 26, 1.6, 0x6af0e0, 2);
  m.set(0, 27, 0, 0xb0fff4, 2);
  return m;
}

function scalesModel() {
  const m = new VoxelModel('scales');
  const G = TOON.gold;
  disc(m, 0, 0, 0, 1, 3.2, G.shade);
  bevelBox(m, -1, 2, -1, 1, 26, 1, G.base, 0);
  bevelBox(m, -2, 27, -2, 2, 29, 2, G.hi, 1);
  // ankh finial
  m.box(0, 30, 0, 0, 33, 0, G.hi);
  m.box(-1, 32, 0, 1, 32, 0, G.hi);
  m.set(-1, 34, 0, G.hi).set(1, 34, 0, G.hi).set(0, 35, 0, G.hi);
  return m;
}
function beamModel() {
  const m = new VoxelModel('beam');
  m.box(-14, 0, 0, 14, 1, 0, TOON.gold.base);
  m.set(-14, -1, 0, TOON.gold.hi).set(14, -1, 0, TOON.gold.hi);
  return m;
}
function panModel(feather: boolean) {
  const m = new VoxelModel('pan');
  // chains
  for (let y = 0; y < 10; y++) {
    m.set(-3, -y, 0, TOON.gold.shade);
    m.set(3, -y, 0, TOON.gold.shade);
  }
  disc(m, 0, 0, -11, -10, 4.2, TOON.gold.base);
  disc(m, 0, 0, -10, -10, 3.2, TOON.gold.shade);
  if (feather) {
    // Ma'at's feather
    for (let y = 0; y < 9; y++) {
      const w = y < 2 ? 0 : y > 6 ? 1 : 2;
      for (let x = -w; x <= w; x++) m.set(x, -9 + y, 0, y === 8 ? 0xffffff : x === 0 ? 0xd8e8f0 : 0xf4f8ff);
    }
  } else {
    // the heart: a chunky red voxel heart
    const H = [
      '.XX.XX.',
      'XXXXXXX',
      'XXXXXXX',
      '.XXXXX.',
      '..XXX..',
      '...X...',
    ];
    H.forEach((row, ry) => [...row].forEach((ch, rx) => ch === 'X' && m.box(rx - 3, -4 - ry, -1, rx - 3, -4 - ry, 1, ry < 2 && rx > 3 ? 0xe86a5a : 0xc0302a)));
  }
  return m;
}

export class AnubisTrial {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  private faces = new FaceQuads();
  private anubis: RigInstance;
  private anubisEyes: RigEyes;
  private soul: RigInstance;
  private soulEyes: RigEyes;
  private beam = new THREE.Group();
  private panL = new THREE.Group();
  private panR = new THREE.Group();
  private tilt = 0;
  private t = 0;
  private caption: HTMLDivElement;
  private camT = 0;
  private loop: { stop(t?: number): void } | null = null;

  constructor(private engine: Engine, private qte: Qte, playerGeo: RigGeo) {
    const s = this.scene;
    s.background = new THREE.Color(0x020a0f);
    s.fog = new THREE.Fog(0x041a22, 14, 70);
    s.add(new THREE.HemisphereLight(0x5ab8d8, 0x081014, 1.2));
    const key = new THREE.DirectionalLight(0x9ff0ff, 2.2);
    key.position.set(-6, 14, 10);
    s.add(key);
    const rim = new THREE.DirectionalLight(0xffc870, 1.2);
    rim.position.set(8, 6, -12);
    s.add(rim);
    const mat = makeVoxelMaterial();
    const VS = 1 / 6;
    const floor = new THREE.Mesh(buildVoxelGeometry(floorModel(), { voxelSize: 0.5, pivot: [0.5, 1, 0.5] }), mat);
    s.add(floor);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const p = new THREE.Mesh(buildVoxelGeometry(pillarModel(), { voxelSize: 0.35, pivot: 'bottom' }), mat);
      p.position.set(Math.cos(a) * 12, 0, Math.sin(a) * 12 - 3);
      s.add(p);
    }
    // the scales
    const scales = new THREE.Group();
    scales.position.set(0, 0, -1);
    scales.add(new THREE.Mesh(buildVoxelGeometry(scalesModel(), { voxelSize: VS, pivot: 'bottom' }), mat));
    this.beam.position.set(0, 27 * VS, 0);
    this.beam.add(new THREE.Mesh(buildVoxelGeometry(beamModel(), { voxelSize: VS, pivot: [0.5, 0.5, 0.5] }), mat));
    scales.add(this.beam);
    this.panL.add(new THREE.Mesh(buildVoxelGeometry(panModel(false), { voxelSize: VS, pivot: [0.5, 0.5, 0.5] }), mat));
    this.panR.add(new THREE.Mesh(buildVoxelGeometry(panModel(true), { voxelSize: VS, pivot: [0.5, 0.5, 0.5] }), mat));
    this.panL.position.set(-14 * VS, 0, 0);
    this.panR.position.set(14 * VS, 0, 0);
    this.beam.add(this.panL, this.panR);
    s.add(scales);
    // Anubis
    let spec = modelEntry('anubis')?.() as RigSpec | undefined;
    if (!spec?.parts) spec = placeholderHumanoid(0x1a1a24);
    this.anubis = new RigInstance(buildRigGeo(spec, 'anubis:trial'), { ownMaterial: true });
    const ah = (spec.meta?.height as number) ?? 4.2;
    this.anubis.root.scale.setScalar(4.6 / ah);
    this.anubis.root.position.set(0, 0, -5);
    s.add(this.anubis.root);
    this.anubisEyes = new RigEyes(this.anubis, 'glow', 0xffd040);
    // Sundown's soul: ghostly teal
    const smat = makeVoxelMaterial({ transparent: true, opacity: 0.72 });
    smat.userData.tint.value.setRGB(0.55, 1.15, 1.2);
    this.soul = new RigInstance(playerGeo, { material: smat, castShadow: false });
    this.soul.root.position.set(0, 0, 4.5);
    this.soul.root.rotation.y = Math.PI;
    s.add(this.soul.root);
    this.soulEyes = new RigEyes(this.soul, 'glow', 0x9dff3a);
    s.add(this.faces.mesh);
    this.caption = document.createElement('div');
    this.caption.style.cssText = "position:absolute;left:50%;bottom:15vh;transform:translateX(-50%);width:min(80vw,900px);text-align:center;font-family:'Alagard';font-size:28px;color:#e8fbff;text-shadow:0 3px 0 #02121a,0 0 18px #0a4a5a;z-index:6;pointer-events:none;opacity:0;transition:opacity .4s";
    engine.overlay.appendChild(this.caption);
  }

  private async say(text: string, hold = 2.2, color = '#e8fbff') {
    this.caption.style.color = color;
    this.caption.textContent = text;
    this.caption.style.opacity = '1';
    this.engine.audio.play('divine_whisper', { volume: 0.6 });
    await this.engine.tweens.wait(hold, true);
    this.caption.style.opacity = '0';
    await this.engine.tweens.wait(0.35, true);
  }

  /** the whole trial; resolves true when the soul is judged worthy */
  async run(stats: { kills: number; wave: number }): Promise<boolean> {
    const eng = this.engine;
    this.camera.aspect = eng.width / eng.height;
    this.camera.updateProjectionMatrix();
    this.loop = eng.audio.loop('underworld_loop', 0.7);
    eng.post.u.uSpirit.value = 0.35;
    await eng.fadeIn(1.0);
    await this.say('…the sand gives way. Cold. Quiet. The Duat.', 2.4);
    this.camT = 1;
    this.anubis.setExpression('neutral');
    eng.audio.play('anubis_roar', { volume: 0.7 });
    await this.say('ANUBIS: "Bones of the West. You died with your boots on."', 2.6, '#ffd36b');
    await this.say(`"${stats.kills} souls sent ahead of you. Let us weigh your heart against the feather."`, 3, '#ffd36b');
    this.camT = 2;
    const a = await this.qte.run({ kind: 'balance', label: "KEEP MA'AT LEVEL", duration: 3.2, drift: 0.9 + Math.min(1.2, stats.wave * 0.02) });
    if (a === 'fail') return this.verdict(false);
    this.camT = 3;
    await this.say('"Balanced… for now. Speak the words of passage."', 2.2, '#ffd36b');
    const glyphs = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
    const seq = Array.from({ length: 4 + Math.min(3, Math.floor(stats.wave / 20)) }, () => rnd.pick(glyphs));
    const b = await this.qte.run({ kind: 'sequence', keys: seq, label: 'WORDS OF PASSAGE', duration: 3.4 });
    return this.verdict(b !== 'fail');
  }

  private async verdict(ok: boolean) {
    const eng = this.engine;
    this.camT = 4;
    if (ok) {
      this.anubis.setExpression('smug');
      eng.audio.play('divine_power', { volume: 0.9 });
      eng.flash(0xbff8ff, 0.5, 0.8);
      await this.say('"Your heart is light as the feather. Go back. Finish your hunt."', 2.6, '#9dff3a');
    } else {
      this.anubis.setExpression('angry');
      eng.audio.play('sting_negative', { volume: 0.9 });
      eng.flash(0xff2a1a, 0.4, 0.6);
      await this.say('"Heavy. So heavy. Ammit is hungry tonight."', 2.6, '#ff6a3a');
    }
    await eng.fadeOut(0.8, ok ? '#e8fbff' : '#000');
    eng.post.u.uSpirit.value = 0;
    this.loop?.stop(0.6);
    return ok;
  }

  update(rdt: number) {
    this.t += rdt;
    const t = this.t;
    // scales sway (balance QTE drives the visual tilt via its own needle; we add life)
    this.tilt += (Math.sin(t * 0.9) * 0.08 - this.tilt) * Math.min(1, rdt * 2);
    this.beam.rotation.z = this.tilt;
    this.panL.rotation.z = -this.tilt;
    this.panR.rotation.z = -this.tilt;
    // Anubis breathes, the soul kneels and floats
    const an = this.anubis.nodes;
    if (an['torso']) an['torso'].rotation.x = Math.sin(t * 0.8) * 0.03;
    if (an['head']) an['head'].rotation.set(0.25 + Math.sin(t * 0.6) * 0.05, Math.sin(t * 0.4) * 0.1, 0);
    if (an['arm_r']) an['arm_r'].rotation.set(-0.5, 0, -0.2);
    const sn = this.soul.nodes;
    this.soul.root.position.y = 0.15 + Math.sin(t * 1.6) * 0.08;
    if (sn['thigh_l']) sn['thigh_l'].rotation.x = -1.4;
    if (sn['shin_l']) sn['shin_l'].rotation.x = 1.6;
    if (sn['thigh_r']) sn['thigh_r'].rotation.x = -0.2;
    if (sn['shin_r']) sn['shin_r'].rotation.x = 1.5;
    if (sn['head']) sn['head'].rotation.x = -0.25;
    // camera choreography
    const shots: [THREE.Vector3, THREE.Vector3, number][] = [
      [new THREE.Vector3(0, 9, 16), new THREE.Vector3(0, 2, -2), 55],
      [new THREE.Vector3(2.5, 2.2, 6.5), new THREE.Vector3(0, 4.2, -5), 42],
      [new THREE.Vector3(-3.5, 3.2, 5), new THREE.Vector3(0, 3.3, -1), 46],
      [new THREE.Vector3(3, 1.6, 7.5), new THREE.Vector3(0, 1.6, 4.4), 40],
      [new THREE.Vector3(0, 3, 10), new THREE.Vector3(0, 3, -3), 50],
    ];
    const [p, l, f] = shots[Math.min(this.camT, shots.length - 1)];
    const k = Math.min(1, rdt * 1.6);
    this.camera.position.lerp(p.clone().add(new THREE.Vector3(Math.sin(t * 0.3) * 0.3, Math.sin(t * 0.5) * 0.15, 0)), k);
    const look = (this.camera.userData.look as THREE.Vector3 | undefined) ?? l.clone();
    look.lerp(l, k);
    this.camera.userData.look = look;
    this.camera.lookAt(look);
    this.camera.fov += (f - this.camera.fov) * k;
    this.camera.updateProjectionMatrix();
    // eyes
    this.faces.begin();
    this.anubis.root.updateMatrixWorld(true);
    this.soul.root.updateMatrixWorld(true);
    this.anubisEyes.lookAt(this.soul.root.position.clone().add(new THREE.Vector3(0, 1.4, 0)));
    this.anubisEyes.draw(this.faces, rdt);
    this.soulEyes.lookAt(new THREE.Vector3(0, 4, -5));
    this.soulEyes.draw(this.faces, rdt);
    this.faces.end(this.scene.fog as THREE.Fog);
  }

  dispose() {
    this.caption.remove();
  }
}

export { Ease };
