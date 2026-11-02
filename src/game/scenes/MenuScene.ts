// Main menu: dusk in the dunes. A crooked signpost whose planks are the menu
// (hover swings a plank, click knocks it), Sundown resting by a campfire with
// Pinch asleep on his shoulder, tumbleweeds, and a chunky voxel "dustUP" logo
// built from the Alagard font. RIDE OUT dollies the camera toward the horizon.
import * as THREE from 'three';
import type { Engine, GameScene } from '../../engine/Engine';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { makeVoxelMaterial, sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import * as PM from '../models/props';
import { modelEntry } from '../models/lookup';
import { TOON } from '../models/style';
import { Particles } from '../fx/Particles';
import { FaceQuads, RigEyes, emote } from '../fx/FaceFx';
import { Ease } from '../../engine/Tween';
import { damp, noise } from '../../engine/math/rand';

function duneModel() {
  const m = new VoxelModel('menu_dunes');
  const R = 70;
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++) {
      const d = Math.hypot(x, z);
      if (d > R) continue;
      const h = Math.max(1, Math.round(3 + noise.n2(x * 0.045, z * 0.045) * 4 + noise.n2(x * 0.12 + 9, z * 0.12) * 1.2 + Math.max(0, d - 30) * 0.12 - (d < 10 ? (10 - d) * 0.25 : 0)));
      for (let y = 0; y < h; y++) m.set(x, y, z, y === h - 1 ? (((x + z) & 7) === 0 ? TOON.sand.hi : TOON.sand.base) : TOON.sand.shade);
    }
  return m;
}

function mesaModel(seed: number) {
  const m = new VoxelModel('mesa');
  const W = 10 + (seed % 3) * 4, H = 14 + (seed % 4) * 3;
  for (let y = 0; y < H; y++) {
    const w = W - Math.floor(y / 5);
    for (let x = -w; x <= w; x++) for (let z = -6; z <= 6; z++) m.set(x, y, z, y % 4 === 0 ? TOON.sandstone.shade : TOON.sandstone.base);
  }
  for (let x = -W + 3; x <= W - 3; x++) for (let z = -5; z <= 5; z++) m.set(x, H, z, TOON.sandstone.hi);
  return m;
}

/** chunky extruded voxel logo from the Alagard font */
function logoModel(text: string) {
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d')!;
  c.font = '48px Alagard';
  const w = Math.ceil(c.measureText(text).width) + 8;
  cv.width = w;
  cv.height = 60;
  c.font = '48px Alagard';
  c.textBaseline = 'top';
  c.fillStyle = '#fff';
  c.fillText(text, 4, 4);
  const img = c.getImageData(0, 0, w, 60).data;
  const m = new VoxelModel('logo');
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < 60 && img[(y * w + x) * 4 + 3] > 110;
  for (let y = 0; y < 60; y++)
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      const t = y / 52;
      const face = t < 0.45 ? TOON.gold.hi : t < 0.7 ? TOON.gold.base : TOON.poncho.base;
      const edge = !solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1);
      for (let z = 0; z < 4; z++) m.set(x, 60 - y, z, z === 3 ? (edge ? TOON.gold.shade : face) : TOON.wood.dark);
    }
  // dark outline slab behind
  for (let y = 0; y < 60; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (solid(x + dx, y + dy)) near = true;
      if (near) m.set(x, 60 - y, 0, 0x2a1408);
    }
  return m;
}

interface Plank {
  label: string;
  mesh: THREE.Object3D;
  rest: number;
  hover: number;
  knock: number;
}

export class MenuScene implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  private particles = new Particles();
  private faces = new FaceQuads();
  private planks: Plank[] = [];
  private ray = new THREE.Raycaster();
  private hovered: Plank | null = null;
  private hero: RigInstance | null = null;
  private heroEyes: RigEyes | null = null;
  private pinch: RigInstance | null = null;
  private fireLight!: THREE.PointLight;
  private firePos = new THREE.Vector3(2.6, 0.2, 1.8);
  private weeds: { m: THREE.Object3D; x: number; z: number; v: number }[] = [];
  private t = 0;
  private leaving = false;
  private panel: HTMLDivElement | null = null;
  private msg: HTMLDivElement;
  private logo!: THREE.Mesh;
  private wind: { stop(t?: number): void } | null = null;

  constructor(private engine: Engine, private onRide: () => void) {
    this.msg = document.createElement('div');
  }

  async enter() {
    const s = this.scene;
    const eng = this.engine;
    // dusk sky
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {},
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP; void main(){ float y = vP.y; vec3 zen = vec3(0.14,0.22,0.45); vec3 hor = vec3(1.0,0.62,0.36); vec3 low = vec3(0.55,0.32,0.22);
          vec3 c = y > 0.0 ? mix(hor, zen, pow(clamp(y*1.6,0.0,1.0), 0.7)) : mix(hor, low, clamp(-y*4.0,0.0,1.0));
          float sun = pow(max(0.0, dot(vP, normalize(vec3(-0.35,0.08,-1.0)))), 600.0);
          c += vec3(1.0,0.8,0.5) * sun * 2.0;
          gl_FragColor = vec4(c,1.0);
          #include <colorspace_fragment>
        }`,
      })
    );
    s.add(sky);
    s.fog = new THREE.Fog(0xe0905a, 40, 160);
    s.add(new THREE.HemisphereLight(0xffc89a, 0x5a3a2a, 0.9));
    const sun = new THREE.DirectionalLight(0xffa868, 2.0);
    sun.position.set(-14, 6, -40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = sc.bottom = -14;
    sc.right = sc.top = 14;
    s.add(sun);
    this.fireLight = new THREE.PointLight(0xff9a40, 14, 9, 1.6);
    this.fireLight.position.copy(this.firePos).add(new THREE.Vector3(0, 0.6, 0));
    s.add(this.fireLight);
    s.add(this.particles.group);
    s.add(this.faces.mesh);
    // ground + mesas
    const dunes = new THREE.Mesh(buildVoxelGeometry(duneModel(), { voxelSize: 0.5, pivot: [0.5, 4, 0.5] }), sharedVoxelMaterial);
    dunes.receiveShadow = true;
    s.add(dunes);
    for (let i = 0; i < 6; i++) {
      const mm = new THREE.Mesh(buildVoxelGeometry(mesaModel(i), { voxelSize: 1.6, pivot: 'bottom' }), sharedVoxelMaterial);
      const a = -1.9 + i * 0.32;
      mm.position.set(Math.sin(a) * 120, -2, -Math.cos(a) * 120 - 20);
      mm.rotation.y = a;
      s.add(mm);
    }
    const P: any = PM;
    // the signpost
    try {
      const sign = P.menuSign();
      const post = new THREE.Mesh(buildVoxelGeometry(sign.post.model, { voxelSize: sign.post.voxelSize, pivot: 'bottom' }), sharedVoxelMaterial);
      post.castShadow = true;
      s.add(post);
      for (const pl of sign.planks) {
        const g = new THREE.Group();
        const mesh = new THREE.Mesh(buildVoxelGeometry(pl.model, { voxelSize: pl.voxelSize, pivot: pl.pivot }), sharedVoxelMaterial);
        mesh.castShadow = true;
        g.add(mesh);
        g.position.set(pl.at[0], pl.at[1], pl.at[2]);
        g.rotation.z = pl.rot?.[2] ?? 0;
        s.add(g);
        this.planks.push({ label: pl.label, mesh: g, rest: g.rotation.z, hover: 0, knock: 0 });
      }
    } catch (e) {
      console.warn('[menu] sign failed', e);
    }
    // campfire, cacti, tumbleweeds
    try {
      const cf = P.campfire(1);
      const m = new THREE.Mesh(buildVoxelGeometry(cf.model, { voxelSize: cf.voxelSize, pivot: 'bottom' }), sharedVoxelMaterial);
      m.position.copy(this.firePos).setY(0.05);
      s.add(m);
      for (let i = 0; i < 5; i++) {
        const c = P.cactus(i * 13 + 3, i % 2 ? 'saguaro' : 'barrel');
        const cm = new THREE.Mesh(buildVoxelGeometry(c.model, { voxelSize: c.voxelSize, pivot: 'bottom' }), sharedVoxelMaterial);
        cm.castShadow = true;
        const a = i * 1.3 + 0.4;
        cm.position.set(Math.cos(a) * (10 + i * 3) - 4, 0, Math.sin(a) * (8 + i * 2) - 10);
        s.add(cm);
      }
      for (let i = 0; i < 3; i++) {
        const tw = P.tumbleweed(i);
        const tm = new THREE.Mesh(buildVoxelGeometry(tw.model, { voxelSize: tw.voxelSize, pivot: 'center' }), sharedVoxelMaterial);
        tm.castShadow = true;
        s.add(tm);
        this.weeds.push({ m: tm, x: -30 - i * 25, z: -6 - i * 5, v: 3 + i });
      }
    } catch (e) {
      console.warn('[menu] props failed', e);
    }
    // Sundown resting by the fire, Pinch asleep on his shoulder
    const spec = modelEntry('cowboy_stetson_duster')?.() as RigSpec | undefined;
    if (spec?.parts) {
      this.hero = new RigInstance(buildRigGeo(spec, spec.name + ':player'), { material: makeVoxelMaterial() });
      this.hero.root.position.set(4.2, 0.15, 1.0);
      this.hero.root.rotation.y = -2.2;
      s.add(this.hero.root);
      this.heroEyes = new RigEyes(this.hero, 'glow', 0x9dff3a);
      this.hero.setExpression('smug');
      const ps = modelEntry('pinch')?.() as RigSpec | undefined;
      if (ps?.parts) {
        this.pinch = new RigInstance(buildRigGeo(ps, ps.name + ':menu'), { material: makeVoxelMaterial() });
        this.pinch.root.scale.setScalar(0.8);
        if (!this.hero.attach('shoulder_l', this.pinch.root)) this.hero.nodes['torso']?.add(this.pinch.root);
        this.pinch.setExpression('sleepy');
      }
    }
    // logo
    const lm = logoModel('dustUP');
    this.logo = new THREE.Mesh(buildVoxelGeometry(lm, { voxelSize: 0.06, pivot: 'center' }), makeVoxelMaterial());
    this.logo.position.set(-3.6, 4.6, -2.5);
    this.logo.rotation.y = 0.35;
    this.logo.castShadow = true;
    s.add(this.logo);
    // camera
    this.camera.aspect = eng.width / eng.height;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(-1.2, 2.4, 9.5);
    this.camera.lookAt(0.6, 2.1, 0);
    (window as any).__music?.setMood('menu');
    this.wind = eng.audio.loop('wind_loop', 0.35);
    eng.input.setWantLock(false);
    this.msg.style.cssText = "position:absolute;left:50%;bottom:7vh;transform:translateX(-50%);font-family:'Alagard';font-size:20px;color:#fff3d6;text-shadow:0 3px 0 #2a1408,0 0 12px #000;z-index:7;pointer-events:none;opacity:0;transition:opacity .4s;text-align:center";
    eng.overlay.appendChild(this.msg);
    this.say('Hover a plank · click to choose');
  }

  private say(t: string) {
    this.msg.textContent = t;
    this.msg.style.opacity = '1';
    clearTimeout((this.msg as any)._t);
    (this.msg as any)._t = setTimeout(() => (this.msg.style.opacity = '0'), 2600);
  }

  exit() {
    this.msg.remove();
    this.panel?.remove();
    this.wind?.stop(0.5);
  }

  private choose(p: Plank) {
    const eng = this.engine;
    p.knock = 1;
    eng.audio.play('ui_click', { volume: 0.8 });
    eng.audio.play('kick', { volume: 0.4, pitch: 1.4 });
    switch (p.label) {
      case 'NEW RUN':
      case 'RESUME':
        if (this.leaving) return;
        this.leaving = true;
        eng.audio.play('level_transition', { volume: 0.8 });
        if (this.pinch) {
          this.pinch.setExpression('surprised');
          emote(this.particles, this.pinch.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.4, 0)), 'exclaim');
        }
        // dolly past the sign toward the sunset
        const from = this.camera.position.clone();
        eng.tweens.run(1.6, (k) => {
          this.camera.position.lerpVectors(from, new THREE.Vector3(-2, 2.8, -30), k);
          this.camera.lookAt(-6, 3, -120);
        }, Ease.inQuad, { real: true });
        eng.tweens.after(1.0, () => this.onRide(), true);
        break;
      case 'SETTINGS':
        this.openSettings();
        break;
      case 'HIDEOUT':
        this.say('The hideout saloon is still being swept out. Soon, partner.');
        break;
      case 'CODEX':
        this.say("Thoth's codex is gathering dust… and stories.");
        break;
    }
  }

  private openSettings() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      return;
    }
    const eng = this.engine;
    const p = document.createElement('div');
    p.style.cssText = "position:absolute;right:6vw;top:50%;transform:translateY(-50%);z-index:8;padding:18px 22px;background:#e8d4a4;border:4px solid #5a3418;box-shadow:0 6px 0 #2a1408;font-family:'Alagard';color:#2a1a10;font-size:18px;min-width:260px;pointer-events:auto";
    const row = (label: string, input: HTMLElement) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:14px;margin:10px 0';
      const l = document.createElement('span');
      l.textContent = label;
      r.append(l, input);
      p.appendChild(r);
    };
    const title = document.createElement('div');
    title.textContent = 'SETTINGS';
    title.style.cssText = 'font-size:28px;color:#8a2a18;text-align:center;margin-bottom:6px';
    p.appendChild(title);
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(Math.round(((eng.audio as any).master?.gain?.value ?? 1) * 100));
    vol.oninput = () => (eng.audio as any).setMaster?.(+vol.value / 100);
    row('Volume', vol);
    const q = document.createElement('select');
    for (const [v, t] of [['high', 'High'], ['low', 'Low (fast)']]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      q.appendChild(o);
    }
    q.value = eng.quality.bloom ? 'high' : 'low';
    q.onchange = () => eng.applyQuality(q.value === 'low' ? { shadows: false, pixelRatio: 0.6, bloom: false, shadowSize: 512 } : { shadows: true, pixelRatio: Math.min(window.devicePixelRatio, 1.5), bloom: true, shadowSize: 2048 });
    row('Quality', q);
    const sens = document.createElement('input');
    sens.type = 'range';
    sens.min = '20';
    sens.max = '300';
    sens.value = String(Math.round(((eng.input as any).sensitivity ?? 1) * 100));
    sens.oninput = () => ((eng.input as any).sensitivity = +sens.value / 100);
    row('Mouse', sens);
    p.querySelectorAll('input,select').forEach((el) => ((el as HTMLElement).style.cssText = 'font-family:Alagard;font-size:16px;accent-color:#8a2a18'));
    eng.overlay.appendChild(p);
    this.panel = p;
  }

  update(_dt: number, rdt: number) {
    this.t += rdt;
    const t = this.t;
    const eng = this.engine;
    const inp = eng.input;
    // hover / click planks
    this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), this.camera);
    const hits = this.ray.intersectObjects(this.planks.map((p) => p.mesh), true);
    let h: Plank | null = null;
    if (hits.length) {
      let o: THREE.Object3D | null = hits[0].object;
      while (o && !h) {
        h = this.planks.find((p) => p.mesh === o) ?? null;
        o = o.parent;
      }
    }
    if (h !== this.hovered) {
      if (h) eng.audio.play('ui_hover', { volume: 0.5 });
      this.hovered = h;
      document.body.style.cursor = h ? 'pointer' : 'default';
    }
    if (h && inp.wasPressed('Mouse0')) this.choose(h);
    for (const p of this.planks) {
      p.hover = damp(p.hover, p === h ? 1 : 0, 10, rdt);
      p.knock = Math.max(0, p.knock - rdt * 2.5);
      p.mesh.rotation.z = p.rest + Math.sin(t * 1.3 + p.rest * 20) * 0.015 + p.hover * Math.sin(t * 9) * 0.05 + Math.sin(p.knock * 18) * p.knock * 0.3;
      p.mesh.rotation.y = p.hover * 0.18;
    }
    // fire flicker + embers
    this.fireLight.intensity = 12 + Math.sin(t * 17) * 2 + Math.sin(t * 7.3) * 1.5;
    if (Math.random() < rdt * 14) this.particles.emit({ pos: { x: this.firePos.x, y: this.firePos.y + 0.4, z: this.firePos.z }, count: 1, spread: 0.2, up: 1.6, life: [0.8, 1.6], size: [0.05, 0.02], sprite: 'spark', color: 0xffa040, additive: true, drag: 0.6, jitter: 0.6 });
    if (Math.random() < rdt * 6) this.particles.emit({ pos: { x: this.firePos.x, y: this.firePos.y + 0.3, z: this.firePos.z }, count: 1, spread: 0.15, up: 0.8, life: [0.3, 0.5], size: [0.25, 0.1], sprite: ['flame0', 'flame1', 'flame2', 'flame3'], color: 0xffc060, additive: true, animate: true });
    this.particles.update(rdt, this.scene.fog as THREE.Fog);
    // tumbleweeds
    for (const w of this.weeds) {
      w.x += w.v * rdt;
      if (w.x > 40) w.x = -40;
      const bounce = Math.abs(Math.sin(this.t * w.v * 0.8)) * 0.6;
      w.m.position.set(w.x, 1.3 + bounce, w.z);
      w.m.rotation.z -= rdt * w.v * 1.4;
    }
    // hero idle: breathing, head nod, Pinch snoring
    if (this.hero) {
      const n = this.hero.nodes;
      if (n['thigh_l']) n['thigh_l'].rotation.x = -1.45;
      if (n['thigh_r']) n['thigh_r'].rotation.x = -1.3;
      if (n['shin_l']) n['shin_l'].rotation.x = 1.5;
      if (n['shin_r']) n['shin_r'].rotation.x = 1.2;
      if (n['torso']) n['torso'].rotation.x = 0.12 + Math.sin(t * 1.6) * 0.02;
      if (n['head']) n['head'].rotation.set(0.1 + Math.sin(t * 0.5) * 0.06, Math.sin(t * 0.3) * 0.25, 0);
      if (n['arm_r']) n['arm_r'].rotation.set(-0.6, 0, -0.2);
      if (n['fore_r']) n['fore_r'].rotation.x = -0.9;
      if (n['arm_l']) n['arm_l'].rotation.set(-0.4, 0, 0.3);
      this.hero.root.updateMatrixWorld(true);
      if (this.pinch && Math.random() < rdt * 0.4) emote(this.particles, this.pinch.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0)), 'zzz', 0.6);
      this.faces.begin();
      this.heroEyes?.lookAt(this.hovered ? this.hovered.mesh.getWorldPosition(new THREE.Vector3()) : this.firePos);
      this.heroEyes?.draw(this.faces, rdt);
      this.faces.end(this.scene.fog as THREE.Fog);
    }
    this.logo.position.y = 4.6 + Math.sin(t * 1.2) * 0.06;
    this.logo.rotation.y = 0.35 + Math.sin(t * 0.5) * 0.05;
    // gentle camera drift following the mouse
    if (!this.leaving) {
      const tx = -1.2 + inp.ndcX * 0.5, ty = 2.4 + inp.ndcY * 0.25;
      this.camera.position.x = damp(this.camera.position.x, tx, 2, rdt);
      this.camera.position.y = damp(this.camera.position.y, ty, 2, rdt);
      this.camera.lookAt(0.6, 2.1, 0);
    }
  }
}
