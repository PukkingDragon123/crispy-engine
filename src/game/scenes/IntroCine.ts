// Opening cinematic (played from the menu's NEW RUN). The menu tilts up into a
// blinding sky; we come down out of it over Serket's Reach:
//   1. crane down from the clouds — the place name floats in the sky
//   2. Sundown walks the ridge on foot, twirling his revolver
//   3. the ground shakes; the soul of the goddess Serket rises out of the sand —
//      a spectral scorpion of jade light, fresnel-lit, shedding motes
//   4. she speaks in floating 3D words; you answer (1 / 2 / 3, click or tap) and
//      she answers back
//   5. "Now RIDE." — he throws down the board and hops on, the soul scatters
//   6. the first wave rises over the far dune crest, silhouetted against the sun
// SPACE / ESC / the SKIP label skips.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import type { CameraRig } from '../player/CameraRig';
import type { Player } from '../player/Player';
import type { Fx } from '../fx/Fx';
import type { Particles } from '../fx/Particles';
import type { World } from '../world/World';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { globalUniforms, makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { modelEntry } from '../models/lookup';
import { FloatText3D } from '../fx/FloatText3D';

export interface IntroDeps {
  engine: Engine;
  cam: CameraRig;
  player: Player;
  fx: Fx;
  particles: Particles;
  world: World;
  scene: THREE.Scene;
  cutIn(title: string, color: string, expr: string): void;
}

const JADE = '#b8ffcf';
const JADE_GLOW = '#3cff9a';

/** the goddess's glow: an additive fresnel shell that rides on her jade body, flickering like a flame */
function soulMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: globalUniforms.uTime,
      uFade: { value: 0 },
      uA: { value: new THREE.Color(0x2cff8c) },
      uB: { value: new THREE.Color(0xe6fff4) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        vec4 wp = modelMatrix * vec4(position + normal * 0.012, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFade; uniform vec3 uA, uB;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
        float flick = 0.8 + 0.2 * sin(uTime * 11.0 + vW.y * 4.0 + vW.x * 2.0);
        float rise = 0.5 + 0.5 * sin(vW.y * 3.0 - uTime * 4.0);
        vec3 col = mix(uA, uB, f) * (0.35 + f * 3.0 + rise * 0.25) * flick;
        float a = clamp(0.12 + f * 1.1, 0.0, 1.0) * clamp(uFade, 0.0, 1.0);
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function walkPose(r: RigInstance, ph: number, amt: number) {
  const n = r.nodes;
  const s = Math.sin(ph);
  const set = (k: string, x: number, y = 0, z = 0) => n[k]?.rotation.set(x, y, z);
  set('thigh_l', -s * 0.55 * amt);
  set('thigh_r', s * 0.55 * amt);
  set('shin_l', Math.max(0, Math.sin(ph + 1.4)) * 0.85 * amt);
  set('shin_r', Math.max(0, Math.sin(ph + 1.4 + Math.PI)) * 0.85 * amt);
  set('arm_l', s * 0.45 * amt, 0, 0.08);
  set('fore_l', -0.25 - Math.max(0, s) * 0.3 * amt);
  set('torso', 0.05 * amt, Math.sin(ph) * 0.09 * amt, Math.cos(ph) * 0.03 * amt);
  if (n['pelvis']) n['pelvis'].rotation.y = -Math.sin(ph) * 0.06 * amt;
}

export async function playIntro(d: IntroDeps) {
  const { engine: eng, cam, player, world } = d;
  const camera = cam.camera;
  let skipped = false;
  const skip = document.createElement('div');
  skip.style.cssText = "position:absolute;right:3vw;bottom:4vh;font-family:'Alagard';font-size:18px;color:#fff3d6;opacity:.75;z-index:9;pointer-events:auto;cursor:pointer;padding:8px 12px;text-shadow:0 2px 0 #2a1408";
  skip.textContent = 'SKIP ▸';
  skip.onpointerdown = (e) => {
    e.stopPropagation();
    skipped = true;
  };
  eng.overlay.append(skip);
  // response picking (keys, mouse, touch)
  let pick = -1;
  const mouse = new THREE.Vector2(-9, -9);
  let clicked = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'Escape') skipped = true;
    const k = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (k >= 0) pick = k;
    if (e.code === 'Enter' || e.code === 'KeyE') clicked = true;
  };
  const onMove = (e: PointerEvent) => {
    const r = eng.renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  const onDown = (e: PointerEvent) => {
    onMove(e);
    clicked = true;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerdown', onDown);
  document.exitPointerLock?.();

  // ------------------------------------------------------------------ the set
  const p = player.pos.clone();
  const fwd = new THREE.Vector3(Math.sin(cam.yaw), 0, Math.cos(cam.yaw));
  const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const gy = (v: THREE.Vector3) => world.groundAt(v.x, v.z);
  const texts: FloatText3D[] = [];
  const text = (s: string, at: THREE.Vector3, o: ConstructorParameters<typeof FloatText3D>[1] = {}) => {
    const t = new FloatText3D(s, o);
    t.anchor.copy(at);
    d.scene.add(t.mesh);
    texts.push(t);
    return t;
  };
  // Sundown on foot: his own rig and revolver
  const actor = new RigInstance(player.rig.geo, { material: player.material });
  const gunA = new RigInstance(player.gun.geo, { material: player.material });
  const holder = new THREE.Group();
  holder.rotation.x = Math.PI / 2;
  holder.add(gunA.root);
  if (!actor.attach('hand_r', holder)) actor.nodes['fore_r']?.add(holder);
  const walkFrom = p.clone().addScaledVector(fwd, -8);
  const actorPos = walkFrom.clone();
  actorPos.y = gy(actorPos);
  actor.root.position.copy(actorPos);
  actor.root.rotation.y = Math.atan2(fwd.x, fwd.z);
  d.scene.add(actor.root);
  let walkPh = 0, walkAmt = 0, spin = 0, spinRate = 0, armUp = 0, lastStep = 0;
  // Serket's soul
  const soulAt = p.clone().addScaledVector(fwd, 10);
  soulAt.y = gy(soulAt);
  let soul: RigInstance | null = null;
  const soulMat = soulMaterial();
  const spec = modelEntry('serket_avatar')?.() as RigSpec | undefined;
  const SOUL_SCALE = 2.2;
  if (spec?.parts) {
    // her jade body (lit, cel-shaded, see-through at the edges) wrapped in a glowing shell
    soul = new RigInstance(buildRigGeo(spec, 'serket:soul'), { ownMaterial: true, castShadow: false });
    soul.material.transparent = true;
    soul.material.userData.tint.value.setRGB(0.8, 1.2, 1.0);
    soul.material.userData.emissiveStrength.value = 2.2;
    for (const m of Object.values(soul.meshes)) {
      m.receiveShadow = false;
      const shell = new THREE.Mesh(m.geometry, soulMat);
      shell.renderOrder = 6;
      m.add(shell);
    }
    soul.root.scale.setScalar(SOUL_SCALE);
    soul.root.position.copy(soulAt).add(new THREE.Vector3(0, -6, 0));
    soul.root.rotation.y = Math.atan2(-fwd.x, -fwd.z);
    d.scene.add(soul.root);
  }
  const soulH = ((spec?.meta?.height as number) ?? 2.6) * SOUL_SCALE;
  const soulLight = new THREE.PointLight(0x5affb0, 0, 26, 1.6);
  soulLight.position.copy(soulAt).add(new THREE.Vector3(0, soulH * 0.6, 0));
  d.scene.add(soulLight);
  let soulRise = 0, soulFade = 0, soulTarget = 0;
  // the first wave, waiting beyond the far dune
  const crest = p.clone().addScaledVector(fwd, 42);
  const waveActors: RigInstance[] = [];
  const waveMat = makeVoxelMaterial();
  waveMat.userData.tint.value.setRGB(0.32, 0.26, 0.24);
  let waveRise = 0;
  const waveKeys = ['husk', 'scarab', 'husk_v1', 'gunslinger', 'jackal', 'husk_v2', 'scarab_v1', 'husk'];

  const tick = (dt: number) => {
    // Sundown
    walkPh += dt * 6.2 * walkAmt;
    walkPose(actor, walkPh, walkAmt);
    actor.root.position.y = gy(actor.root.position) + Math.abs(Math.cos(walkPh)) * 0.035 * walkAmt;
    if (walkAmt > 0.3 && Math.floor(walkPh / Math.PI) !== lastStep) {
      lastStep = Math.floor(walkPh / Math.PI);
      eng.audio.play('footstep_sand', { volume: 0.35 });
      d.fx.dust({ x: actor.root.position.x, y: actor.root.position.y + 0.05, z: actor.root.position.z }, 0.25, 0xe6cf9f, 2);
    }
    spin += spinRate * dt;
    holder.rotation.x = Math.PI / 2 + spin;
    const n = actor.nodes;
    if (n['arm_r']) n['arm_r'].rotation.set(-0.35 - armUp * 1.2, 0, -0.25 - armUp * 0.2);
    if (n['fore_r']) n['fore_r'].rotation.set(-1.05 + armUp * 0.5, 0, 0);
    if (n['head']) n['head'].rotation.x = -0.12 * (1 - walkAmt) - (soulTarget > 0 ? 0.25 : 0);
    actor.root.updateMatrixWorld(true);
    // the soul
    soulFade += (soulTarget - soulFade) * Math.min(1, dt * 1.6);
    soulMat.uniforms.uFade.value = soulFade;
    soulLight.intensity = soulFade * 38;
    if (soul) {
      soul.material.opacity = 0.88 * soulFade;
      soul.material.userData.fx.value.y = Math.max(0, 1 - soulFade * 1.15);
      soul.root.position.y = soulAt.y - 6 * (1 - soulRise) + 0.4 + Math.sin(performance.now() / 700) * 0.18 * soulRise;
      const tt = performance.now() / 1000;
      for (const [k, node] of Object.entries(soul.nodes)) {
        const m = /^tail(\d)$/.exec(k);
        if (m) node.rotation.x = Math.sin(tt * 1.3 + +m[1] * 0.6) * 0.07;
        else if (k.startsWith('pincer')) node.rotation.y = Math.sin(tt * 2.1 + (k.endsWith('l') ? 0 : 1.5)) * 0.12;
        else if (k.startsWith('leg_')) node.rotation.x = Math.sin(tt * 3 + k.charCodeAt(5) * 0.7) * 0.08;
      }
      soul.root.visible = soulFade > 0.01;
      if (soulFade > 0.2 && Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2, rr = 1.5 + Math.random() * 4;
        d.particles.emit({ pos: { x: soulAt.x + Math.cos(a) * rr, y: soul.root.position.y + Math.random() * soulH, z: soulAt.z + Math.sin(a) * rr }, count: 1, up: 1.6, life: [1.2, 2.2], size: [0.08, 0.2], sprite: ['spark'], color: [0x9dffc8, 0xe6fff4], alpha: 0.9 * soulFade, drag: 0.8 });
      }
    }
    // the waiting wave
    waveActors.forEach((w, i) => {
      w.root.position.y = (w.root.userData.y as number) - 2.2 * (1 - waveRise) + Math.sin(performance.now() / 500 + i) * 0.04;
      w.root.rotation.z = Math.sin(performance.now() / 900 + i * 1.7) * 0.04;
    });
    // floating words
    let hoverIdx = -1;
    if (choices.length) {
      const rc = new THREE.Raycaster();
      rc.setFromCamera(mouse, camera);
      const hit = rc.intersectObjects(choices.map((c) => c.mesh), false)[0];
      hoverIdx = hit ? choices.findIndex((c) => c.mesh === hit.object) : -1;
      choices.forEach((c, i) => (c.hover += ((i === hoverIdx ? 1 : 0) - c.hover) * Math.min(1, dt * 10)));
      if (clicked && hoverIdx >= 0) pick = hoverIdx;
    }
    clicked = false;
    for (const t of texts) t.update(dt, camera, t === speaking ? () => eng.audio.play('ui_hover', { volume: 0.08, pitch: 0.8 + Math.random() * 0.5 }) : undefined);
  };
  let choices: FloatText3D[] = [];
  let speaking: FloatText3D | null = null;
  let last = performance.now();
  // ?cinedt=0.5 lets slow headless test machines get through the scene
  const dtCap = +(new URLSearchParams(location.search).get('cinedt') ?? 0.05);
  const frame = async () => {
    await eng.tweens.wait(0.016, true);
    const now = performance.now();
    const dt = Math.min(dtCap, (now - last) / 1000);
    last = now;
    tick(dt);
    return dt;
  };
  const runFor = async (dur: number, fn: (k: number, t: number, dt: number) => void) => {
    let t = 0;
    while (!skipped && t < dur) {
      const dt = await frame();
      t += dt;
      fn(Math.min(1, t / dur), t, dt);
    }
  };
  const ease = (k: number) => k * k * (3 - 2 * k);
  const lerpV = (a: THREE.Vector3, b: THREE.Vector3, k: number) => a.clone().lerp(b, k);

  /** Serket (or anyone) speaks: typed words floating beside the speaker */
  const say = async (who: 'serket' | 'sundown' | 'pinch', line: string, hold = 1.4) => {
    if (skipped) return;
    const at = who === 'serket' ? soulAt.clone().add(new THREE.Vector3(0, soulH * 1.05, 0)).addScaledVector(side, -2.2) : actor.root.position.clone().add(new THREE.Vector3(0, 2.35, 0)).addScaledVector(side, who === 'pinch' ? 0.6 : -0.4);
    const t = text(line, at, who === 'serket' ? { size: 0.62, color: JADE, glow: JADE_GLOW, cps: 34, wrap: 30, hdr: 1.7 } : { size: 0.2, color: who === 'pinch' ? '#c8ff8a' : '#fff3d6', glow: who === 'pinch' ? '#6aff1a' : '#ffb070', cps: 40, wrap: 28, hdr: 1.3 });
    speaking = t;
    if (who === 'serket') eng.audio.play('divine_whisper', { volume: 0.55 });
    while (!skipped && !t.done) {
      await frame();
      if (clicked) t.skipTyping();
    }
    await runFor(hold + line.length * 0.012, () => {});
    t.show(false);
    speaking = null;
    await runFor(0.25, () => {});
  };
  /** three floating answers beside Sundown; resolves with the chosen index */
  const ask = async (opts: string[]) => {
    if (skipped) return 0;
    pick = -1;
    const base = actor.root.position.clone().add(new THREE.Vector3(0, 1.75, 0)).addScaledVector(side, 1.55);
    choices = opts.map((o, i) => text(`${i + 1} · ${o}`, base.clone().add(new THREE.Vector3(0, -i * 0.36, 0)).addScaledVector(fwd, 0.2 * i), { size: 0.17, color: '#fff3d6', glow: '#ffb070', cps: 70, wrap: 40, align: 'left', hdr: 1.2 }));
    eng.audio.play('card_hover', { volume: 0.5 });
    let t = 0;
    while (!skipped && pick < 0 && t < 14) t += await frame();
    const k = pick < 0 ? 0 : pick;
    eng.audio.play('ui_click', { volume: 0.8 });
    choices.forEach((c, i) => (i === k ? (c.hover = 1) : c.show(false)));
    await runFor(0.5, () => {});
    choices.forEach((c) => c.show(false));
    choices = [];
    return k;
  };

  player.rig.root.visible = false;
  player.boardMesh.visible = false;
  eng.input.enabled = false;
  eng.letterbox(true, 0.01);
  (window as any).__music?.setMood('intro');
  try {
    // 1. down out of the sky
    const skyPos = p.clone().addScaledVector(fwd, -26).add(new THREE.Vector3(0, 38, 0));
    const skyLook = p.clone().addScaledVector(fwd, 60).add(new THREE.Vector3(0, 70, 0));
    const ridgePos = p.clone().addScaledVector(fwd, -15).addScaledVector(side, 4).add(new THREE.Vector3(0, 4.5, 0));
    const ridgeLook = walkFrom.clone().add(new THREE.Vector3(0, 1.2, 0));
    cam.setCine({ pos: skyPos, look: skyLook, fov: 24 }, false);
    const title = text("SERKET'S REACH", p.clone().addScaledVector(fwd, 46).add(new THREE.Vector3(0, 26, 0)), { size: 3.2, color: '#ffe8b8', glow: '#ff9a3a', cps: 18, wrap: 40, hdr: 1.6 });
    const sub = text('where the sand remembers every bone', p.clone().addScaledVector(fwd, 46).add(new THREE.Vector3(0, 22.6, 0)), { size: 1.05, color: '#fff3d6', glow: '#ffb070', cps: 40, wrap: 60, hdr: 1.3 });
    sub.show(false);
    void eng.fadeIn(1.4);
    eng.audio.play('whoosh_big', { volume: 0.6, pitch: 0.6 });
    await runFor(1.6, () => {});
    sub.show(true);
    await runFor(3.2, (k) => {
      const e = ease(k);
      cam.setCine({ pos: lerpV(skyPos, ridgePos, e), look: lerpV(skyLook, ridgeLook, e), fov: 24 + 22 * e }, false);
    });
    title.show(false);
    sub.show(false);
    // 2. Sundown walks the ridge, twirling his revolver
    walkAmt = 1;
    const walkTo = p.clone().addScaledVector(fwd, -1);
    await runFor(5.2, (k, t) => {
      actor.root.position.lerpVectors(walkFrom, walkTo, k);
      spinRate = (t > 0.8 && t < 2.6) || (t > 3.3 && t < 4.6) ? 16 : 0;
      if (t > 0.8 && t < 0.85) eng.audio.play('rev_spin', { volume: 0.7 });
      if (t > 3.3 && t < 3.35) eng.audio.play('rev_spin', { volume: 0.7, pitch: 1.1 });
      if (spinRate === 0) spin += (Math.round(spin / (Math.PI * 2)) * Math.PI * 2 - spin) * 0.25;
      const ap = actor.root.position;
      const cp = ap.clone().addScaledVector(fwd, 3.6 - k * 0.6).addScaledVector(side, 1.3).add(new THREE.Vector3(0, 0.95, 0));
      cp.y = Math.max(cp.y, world.groundAt(cp.x, cp.z) + 0.5);
      cam.setCine({ pos: cp, look: ap.clone().add(new THREE.Vector3(0, 1.15, 0)), fov: 42 }, true);
    });
    walkAmt = 0;
    spinRate = 0;
    spin = Math.round(spin / (Math.PI * 2)) * Math.PI * 2;
    // 3. the ground shakes, the soul rises
    eng.audio.play('quake_rumble', { volume: 0.9 });
    eng.audio.play('sand_rise', { volume: 1 });
    const ap = actor.root.position.clone();
    const shoulder = ap.clone().addScaledVector(fwd, -2.6).addScaledVector(side, 1.15).add(new THREE.Vector3(0, 1.75, 0));
    cam.setCine({ pos: shoulder, look: soulAt.clone().add(new THREE.Vector3(0, 2.6, 0)), fov: 52 }, true);
    soulTarget = 1;
    await runFor(2.6, (k) => {
      soulRise = ease(k);
      if (Math.random() < 0.5) {
        const a = k * Math.PI * 8, r = 4.5 * (1 - k) + 0.8;
        d.fx.sandBurst({ x: soulAt.x + Math.cos(a) * r, y: soulAt.y, z: soulAt.z + Math.sin(a) * r }, 1.2);
      }
    });
    eng.audio.play('spectral_scorpion', { volume: 1 });
    // hero shot of the goddess
    const low = soulAt.clone().addScaledVector(fwd, -8.5).addScaledVector(side, -3.4);
    low.y = world.groundAt(low.x, low.z) + 0.9;
    cam.setCine({ pos: low, look: soulAt.clone().add(new THREE.Vector3(0, soulH * 0.75, 0)), fov: 46 }, true);
    // 4. she speaks; you answer
    const herShot = () => cam.setCine({ pos: shoulder, look: soulAt.clone().add(new THREE.Vector3(0, soulH * 0.8, 0)), fov: 50 }, true);
    const hisShot = () => {
      const c = ap.clone().addScaledVector(fwd, 3.2).addScaledVector(side, 1.6).add(new THREE.Vector3(0, 1.45, 0));
      cam.setCine({ pos: c, look: ap.clone().add(new THREE.Vector3(0, 1.45, 0)).addScaledVector(side, 0.8), fov: 44 }, true);
    };
    await say('serket', 'Bone-rider. You walk where the living fear to ride.', 1.2);
    herShot();
    hisShot();
    const a1 = await ask(["Who's askin'?", "Evenin', ma'am.  *tips hat*", "*twirls revolver*  Depends who's payin'."]);
    if (a1 === 1) armUp = 1;
    if (a1 === 2) {
      spinRate = 18;
      eng.audio.play('rev_spin', { volume: 0.8 });
    }
    herShot();
    await say('serket', ['The one who keeps your bones from becoming sand.', 'Manners. How rare among the dead.', 'Payment? I will pay you with your name.'][a1], 1.0);
    armUp = 0;
    spinRate = 0;
    spin = Math.round(spin / (Math.PI * 2)) * Math.PI * 2;
    await say('serket', "Set's storm devours my desert. His outlaws ride the dunes on stolen souls.", 1.1);
    await say('serket', 'And beware the moon. Khonsu walks the night with a crescent scythe.', 1.1);
    hisShot();
    const a2 = await ask(["How many of 'em?", "What's in it for me?", 'Pinch, you hearin\' this?']);
    herShot();
    if (a2 === 2) {
      eng.audio.play('scorpion_chitter', { volume: 0.8 });
      await say('pinch', '*click click*', 0.6);
    }
    await say('serket', ['A hundred waves, bone-rider. Each worse than the last.', 'Your flesh. Your name. Your sunset.', 'Even your scorpion understands.'][a2], 1.0);
    const ride = text('Now — RIDE.', soulAt.clone().add(new THREE.Vector3(0, soulH * 1.05, 0)).addScaledVector(side, -2.2), { size: 1.0, color: '#eafff2', glow: JADE_GLOW, cps: 22, wrap: 20, hdr: 2 });
    speaking = ride;
    eng.audio.play('divine_power', { volume: 0.8 });
    await runFor(1.4, () => {});
    ride.show(false);
    // 5. he throws the board down and hops on; the soul scatters on the wind
    hisShot();
    soulTarget = 0;
    eng.audio.play('soul_leave', { volume: 0.9 });
    for (let i = 0; i < 40; i++) d.particles.emit({ pos: { x: soulAt.x + (Math.random() - 0.5) * 5, y: soulAt.y + Math.random() * soulH, z: soulAt.z + (Math.random() - 0.5) * 5 }, count: 1, up: 3, life: [1.2, 2], size: [0.1, 0.25], sprite: ['spark'], color: [0x9dffc8, 0xffffff], alpha: 0.9, drag: 0.5, jitter: 2 });
    await runFor(0.5, () => {});
    eng.audio.play('board_jump', { volume: 0.9 });
    d.fx.sandBurst({ x: ap.x, y: ap.y, z: ap.z }, 1.4);
    await runFor(0.4, (k) => {
      actor.root.position.y = gy(ap) + Math.sin(k * Math.PI) * 0.9;
      actor.root.rotation.y = Math.atan2(fwd.x, fwd.z) + k * Math.PI * 2;
    });
    actor.root.visible = false;
    player.rig.root.visible = true;
    player.boardMesh.visible = true;
    eng.audio.play('board_land', { volume: 0.9 });
    // 6. the waves
    for (let i = 0; i < waveKeys.length; i++) {
      const sp = modelEntry(waveKeys[i])?.() as RigSpec | undefined;
      if (!sp?.parts) continue;
      const w = new RigInstance(buildRigGeo(sp, 'cine:' + waveKeys[i]), { material: waveMat, castShadow: false });
      const at = crest.clone().addScaledVector(side, (i - (waveKeys.length - 1) / 2) * 2.6).addScaledVector(fwd, (i % 2) * 1.5);
      at.y = world.groundAt(at.x, at.z);
      w.root.position.copy(at);
      w.root.rotation.y = Math.atan2(-fwd.x, -fwd.z);
      w.root.userData.y = at.y;
      d.scene.add(w.root);
      waveActors.push(w);
    }
    const hp = p.clone().addScaledVector(fwd, -3).addScaledVector(side, 1.2).add(new THREE.Vector3(0, 1.4, 0));
    cam.setCine({ pos: hp, look: crest.clone().add(new THREE.Vector3(0, 2.2, 0)), fov: 30 }, true);
    eng.audio.play('wave_start', { volume: 0.9 });
    const wv = text('WAVE 1', crest.clone().add(new THREE.Vector3(0, 7.5, 0)), { size: 3.4, color: '#fff3d6', glow: '#ff6a3a', cps: 12, wrap: 20, hdr: 1.8 });
    const wsub = text('a hundred waves stand between you and your name', crest.clone().add(new THREE.Vector3(0, 5.2, 0)), { size: 0.85, color: '#ffe0b0', glow: '#ff9a3a', cps: 50, wrap: 60, hdr: 1.3 });
    await runFor(2.8, (k) => (waveRise = ease(Math.min(1, k * 1.6))));
    wv.show(false);
    wsub.show(false);
    eng.audio.play('jackal_howl', { volume: 0.5 });
    await runFor(0.6, () => {});
    d.cutIn("SERKET'S REACH", '#c8ff5a', 'determined');
  } finally {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    skip.remove();
    for (const t of texts) t.dispose();
    actor.root.removeFromParent();
    soul?.root.removeFromParent();
    soulMat.dispose();
    soulLight.removeFromParent();
    for (const w of waveActors) w.root.removeFromParent();
    waveMat.dispose();
    player.rig.root.visible = true;
    player.boardMesh.visible = true;
    cam.setCine(null);
    eng.letterbox(false, 0.5);
    eng.input.enabled = true;
    if (skipped) void eng.fadeIn(0.3);
    (window as any).__music?.setMood('explore');
  }
}
