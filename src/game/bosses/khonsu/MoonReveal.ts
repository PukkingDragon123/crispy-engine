// THE UNLOCK REVEAL after the first fall of Khonsu of the Sands (wave 75 of the dunes):
// the cracked moon mask lies in the sand; moonlight seeps out of the crack, climbs into a
// pillar and gathers into a shape: a cat-eared rider on a crescent board, dark against
// the moon with a cold silver rim. He looks back once, then glides off over the dunes
// toward the moon, where a river glitters on the horizon. The words hang in the world in
// moonlit 3D type (WorldSpeech): MARK IS FREE, THE NILE IS OPEN. About ten seconds,
// letterboxed, the hunter untouchable and the field quiet while it plays.
//
// Mark is the real rig (registry 'mark', characters/mark.ts) and his crescent board
// ('board_crescent'), drawn as a silhouette; if either is missing from the build the
// moon-cat stand-in (models/enemies/khonsuMoon) takes his place.
import * as THREE from 'three';
import type { Ctx } from '../../Ctx';
import type { Player } from '../../player/Player';
import type { CameraRig } from '../../player/CameraRig';
import type { Enemies } from '../../enemies/Enemies';
import { buildRigGeo, RigInstance, type RigSpec } from '../../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import type { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { modelEntry } from '../../models/lookup';
import { moonCatSilhouetteRig, crescentBoardModel } from '../../models/enemies/khonsuMoon';
import { say3D } from '../../fx/WorldSpeech';
import { rnd, damp, dampAngle } from '../../../engine/math/rand';

export interface RevealDeps {
  ctx: Ctx;
  cam: CameraRig;
  player: Player;
  enemies: Enemies;
  /** where the cracked mask lies */
  mask: THREE.Vector3;
  /** the bearing of the moon (unit, from LunarSky.dir) */
  moon: THREE.Vector3;
}

const silVert = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;
const silFrag = /* glsl */ `
uniform vec3 uRim;
uniform float uK, uGlow;
varying vec3 vN;
varying vec3 vV;
void main(){
  float f = 1.0 - max(dot(normalize(vN), normalize(vV)), 0.0);
  vec3 c = mix(vec3(0.025, 0.03, 0.055), uRim, clamp(pow(f, 1.8) * uK + uGlow, 0.0, 1.0));
  gl_FragColor = vec4(c * (1.0 + uGlow * 2.0), 1.0);
  #include <colorspace_fragment>
}`;

const PALE = [0xcfe8ff, 0xffffff, 0x9fd0ff];

/** Mark posed in a sideways surf crouch on his board (or the stand-in), as a moonlit silhouette */
function buildRider(mat: THREE.ShaderMaterial): { root: THREE.Group; rig: RigInstance | null; placeholder: boolean; dispose: () => void } {
  const root = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  let rig: RigInstance | null = null;
  let placeholder = false;
  try {
    const spec = modelEntry('mark')?.() as RigSpec | undefined;
    const board = modelEntry('board_crescent')?.() as { model: VoxelModel; voxelSize: number } | undefined;
    if (!spec?.parts) throw new Error('no mark rig');
    rig = new RigInstance(buildRigGeo(spec, 'mark'), { ownMaterial: true });
    const b = board?.model ? board : crescentBoardModel();
    const bg = buildVoxelGeometry(b.model, { voxelSize: b.voxelSize, pivot: 'center' });
    geos.push(bg);
    const bm = new THREE.Mesh(bg, mat);
    root.add(bm);
    // he rides sideways, knees bent, arms out for balance
    const n = rig.nodes;
    rig.root.rotation.y = Math.PI / 2;
    rig.root.position.y = 0.06;
    const set = (k: string, x: number, y: number, z: number) => n[k]?.rotation.set(x, y, z);
    set('pelvis', 0.12, 0, 0);
    set('torso', 0.32, 0.15, 0);
    set('head', -0.2, -0.75, 0);
    set('thigh_l', -0.55, 0, 0.32);
    set('shin_l', 0.85, 0, 0);
    set('thigh_r', 0.35, 0, -0.3);
    set('shin_r', 0.7, 0, 0);
    set('arm_l', 0.2, 0, 1.15);
    set('fore_l', -0.3, 0, 0.2);
    set('arm_r', -0.3, 0, -1.05);
    set('fore_r', -0.4, 0, -0.2);
    rig.root.scale.setScalar(0.98);
    root.add(rig.root);
  } catch {
    // the stand-in: the moon-cat silhouette rig (its board is the root part)
    placeholder = true;
    rig = new RigInstance(buildRigGeo(moonCatSilhouetteRig(), 'mooncat_silhouette'), { ownMaterial: true });
    root.add(rig.root);
  }
  rig.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.material = mat;
      m.castShadow = false;
    }
  });
  return {
    root,
    rig,
    placeholder,
    dispose: () => {
      rig?.material.dispose();
      for (const g of geos) g.dispose();
    },
  };
}

/** play the reveal; resolves when the hunter has the reins back */
export async function playMoonReveal(d: RevealDeps): Promise<void> {
  const { ctx, cam, player } = d;
  const eng = ctx.engine;
  const tw = eng.tweens;
  const P = ctx.particles;
  const wait = (s: number) => tw.wait(s);
  const inputWas = eng.input.enabled;
  eng.input.enabled = false;
  d.enemies.calm();
  player.invuln = Math.max(player.invuln, 14);
  eng.letterbox(true, 0.6);
  const m = d.mask.clone();
  const g = ctx.world.groundAt(m.x, m.z);
  m.y = g;
  const R = new THREE.Vector3(d.moon.x, 0, d.moon.z);
  if (R.lengthSq() < 1e-4) R.set(0, 0, -1);
  R.normalize();
  const side = new THREE.Vector3(R.z, 0, -R.x);
  const light = new THREE.PointLight(0xcfe8ff, 0, 16, 1.6);
  light.position.set(m.x, g + 1.2, m.z);
  ctx.scene.add(light);
  const mat = new THREE.ShaderMaterial({ vertexShader: silVert, fragmentShader: silFrag, uniforms: { uRim: { value: new THREE.Color(0xd8ecff) }, uK: { value: 1.4 }, uGlow: { value: 1 } } });
  let rider: ReturnType<typeof buildRider> | null = null;
  const lines: { end(): void }[] = [];
  const shot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 44 };
  try {
    // ------------------------------------------------------------------ 1) the mask: light seeps out of the crack
    (window as unknown as { __moonReveal?: string }).__moonReveal = 'mask'; // dev handle: which beat is playing
    shot.pos.copy(m).addScaledVector(R, 5.5).addScaledVector(side, 2.2);
    shot.pos.y = Math.max(ctx.world.groundAt(shot.pos.x, shot.pos.z) + 1.3, g + 1.6);
    shot.look.set(m.x, g + 0.9, m.z);
    cam.setCine(shot);
    ctx.sfx('divine_whisper', m, 1, 0.5);
    ctx.sfx('heartbeat', m, 0.8, 0.6);
    // Mark's rig is sculpted now, while the camera holds on the mask
    await wait(0.35);
    rider = buildRider(mat);
    rider.root.visible = false;
    ctx.scene.add(rider.root);
    for (let t = 0; t < 1.8; t += 0.05) {
      light.intensity = t * 4;
      P.emit({ pos: { x: m.x + (rnd.next() - 0.5) * 1.6, y: g + 0.4, z: m.z + (rnd.next() - 0.5) * 1.6 }, count: 2, vel: { x: 0, y: 1.2 + t, z: 0 }, spread: 0.3, life: [0.6, 1.1], size: [0.22, 0.04], sprite: ['spark', 'glow8'], additive: true, color: PALE, drag: 0.6 });
      await wait(0.05);
    }
    // ------------------------------------------------------------------ 2) the pillar of moonlight; it gathers into a shape
    (window as unknown as { __moonReveal?: string }).__moonReveal = 'pillar';
    ctx.sfx('divine_power', m, 1, 0.6);
    const top = new THREE.Vector3(m.x, g + 1.6, m.z);
    for (let t = 0; t < 1.4; t += 0.05) {
      shot.look.y = g + 0.9 + t * 0.55;
      for (let h = 0; h < 5; h += 0.7) P.emit({ pos: { x: m.x, y: g + h, z: m.z }, count: 1, vel: { x: 0, y: 2.5, z: 0 }, spread: 0.4 + (5 - h) * 0.06, life: [0.3, 0.5], size: [0.5, 0.1], sprite: 'glow16', additive: true, color: PALE });
      // motes spiral in to where he will stand
      const a = t * 9;
      P.emit({ pos: { x: top.x + Math.cos(a) * 2.2, y: top.y + Math.sin(t * 5) * 0.6, z: top.z + Math.sin(a) * 2.2 }, count: 1, vel: { x: -Math.cos(a) * 3, y: 0, z: -Math.sin(a) * 3 }, life: [0.5, 0.7], size: [0.3, 0.05], sprite: 'star4', additive: true, color: PALE });
      light.intensity = 7 + Math.sin(t * 20) * 1.5;
      await wait(0.05);
    }
    // ------------------------------------------------------------------ 3) the flash: a rider stands on a crescent of light
    (window as unknown as { __moonReveal?: string }).__moonReveal = 'rider';
    eng.flash(0xdfefff, 0.5, 0.6);
    ctx.sfx('divine_chime', top, 1, 0.55);
    ctx.sfx('glass_break', top, 0.5, 0.5);
    const rr = rider.root;
    rr.visible = true;
    const yaw0 = Math.atan2(-R.x, -R.z); // facing the camera side first (back toward the moon)
    rr.position.set(m.x, g + 1.0, m.z);
    rr.rotation.set(0, yaw0, 0);
    P.emit({ pos: { x: m.x, y: g + 1.6, z: m.z }, count: 40, spread: 3, up: 2, life: [0.6, 1.2], size: [0.3, 0.05], sprite: ['spark', 'star4'], additive: true, color: PALE, drag: 1.4 });
    lines.push(say3D(eng, 'MARK IS FREE', () => new THREE.Vector3(rr.position.x, rr.position.y + 2.6, rr.position.z), { key: 'reveal:mark', size: 0.3, px: 72, color: '#eef6ff', glow: '#7fc4ff', hdr: 1.8, cps: 16, hold: 3.2 }));
    for (let t = 0; t < 1.6; t += 0.05) {
      const k = Math.min(1, t / 0.6);
      mat.uniforms.uGlow.value = 1 - k * 0.92;
      rr.scale.setScalar(0.4 + 0.6 * (1 - (1 - k) ** 3));
      rr.position.y = g + 1.0 + Math.sin(t * 3) * 0.06;
      light.intensity = damp(light.intensity, 3, 3, 0.05);
      await wait(0.05);
    }
    // ------------------------------------------------------------------ 4) he turns to the moon and glides off toward the river on the horizon
    (window as unknown as { __moonReveal?: string }).__moonReveal = 'ride';
    shot.fov = 52;
    const camFrom = m.clone().addScaledVector(R, -6.5).addScaledVector(side, 2.6);
    camFrom.y = Math.max(ctx.world.groundAt(camFrom.x, camFrom.z) + 1.5, g + 1.8);
    shot.pos.copy(camFrom);
    shot.look.copy(m).addScaledVector(R, 30);
    shot.look.y = g + 7;
    ctx.sfx('whoosh_big', m, 0.8, 0.8);
    lines.push(say3D(eng, 'THE NILE IS OPEN', () => new THREE.Vector3(m.x + R.x * 60, g + 14, m.z + R.z * 60), { key: 'reveal:nile', size: 0.3, px: 72, color: '#eef6ff', glow: '#46d8ff', hdr: 1.8, cps: 14, hold: 3.6 }));
    const riverD = 130;
    const yawGo = Math.atan2(R.x, R.z);
    let dist = 0, speed = 0;
    for (let t = 0; t < 4.6; t += 1 / 30) {
      const dt = 1 / 30;
      // turn toward the moon, then away
      rr.rotation.y = dampAngle(rr.rotation.y, yawGo, 3.5, dt);
      speed = Math.min(22, speed + dt * 9);
      dist += speed * dt;
      const x = m.x + R.x * dist + side.x * Math.sin(dist * 0.08) * 2, z = m.z + R.z * dist + side.z * Math.sin(dist * 0.08) * 2;
      const gy = ctx.world.groundAt(x, z);
      rr.position.set(x, damp(rr.position.y, gy + 0.9 + Math.sin(t * 2.2) * 0.12, 6, dt), z);
      rr.rotation.z = Math.sin(dist * 0.08 + 1.2) * 0.12;
      const n = rider.rig?.nodes;
      if (n?.['scarf']) n['scarf'].rotation.x = Math.sin(t * 7) * 0.12 - 0.2;
      for (let i = 1; i <= 6; i++) if (n?.['tail' + i]) n['tail' + i].rotation.x = -0.25 + Math.sin(t * 5 + i * 0.6) * 0.15;
      // moon-dust off the board's tail, and the river on the horizon catching the light
      P.emit({ pos: { x: x - R.x * 0.8, y: gy + 0.4, z: z - R.z * 0.8 }, count: 2, vel: { x: -R.x * 3, y: 0.8, z: -R.z * 3 }, spread: 0.4, life: [0.6, 1.1], size: [0.2, 0.04], sprite: ['spark', 'dot3'], additive: true, color: PALE, drag: 0.8 });
      if (rnd.chance(0.5)) P.emit({ pos: { x: x - R.x, y: gy + 0.2, z: z - R.z }, count: 2, spread: 0.6, up: 1.2, life: [0.5, 0.9], size: [0.14, 0.08], sprite: ['grain0', 'grain1', 'grain2'], color: [0xd8c9a8, 0xbfae8c], gravity: 6, ground: true });
      for (let i = 0; i < 6; i++) {
        const l = (rnd.next() - 0.5) * 220;
        const rx = m.x + R.x * (riverD + Math.sin(l * 0.03) * 14) + side.x * l, rz = m.z + R.z * (riverD + Math.sin(l * 0.03) * 14) + side.z * l;
        const near = 1 - Math.abs(l) / 110;
        P.emit({ pos: { x: rx, y: ctx.world.groundAt(rx, rz) + 0.3, z: rz }, count: 1, life: [0.25, 0.55], size: [1.6 + near * 2.4, 0.2], sprite: rnd.chance(0.3) ? 'star4' : 'spark', additive: true, color: [0xeaf4ff, 0xbfe0ff, 0xffffff] });
      }
      // the camera lets him go, drifting up to keep the moon in frame
      shot.pos.y = camFrom.y + t * 0.35;
      shot.look.lerp(rr.position.clone().addScaledVector(R, 24).add(new THREE.Vector3(0, 6, 0)), 0.04);
      mat.uniforms.uGlow.value = Math.max(0.06, 0.08 + Math.max(0, t - 3.4) * 0.5);
      if (t > 3.4) rr.scale.setScalar(Math.max(0.02, 1 - (t - 3.4) / 1.2));
      await wait(dt);
    }
    lines.push(say3D(eng, rider.placeholder ? 'Find him in the hideout' : 'Ride as Mark: his board waits by the hideout door', null, { key: 'reveal:hint', screen: [0, -0.42], size: 0.12, px: 56, color: '#fff3d6', glow: '#7fc4ff', hdr: 1.4, hold: 2.6 }));
    await wait(2.2);
  } finally {
    (window as unknown as { __moonReveal?: string }).__moonReveal = 'done';
    cam.setCine(null);
    eng.letterbox(false, 0.6);
    eng.input.enabled = inputWas || eng.input.enabled;
    player.invuln = Math.min(player.invuln, 1);
    light.removeFromParent();
    if (rider) {
      rider.root.removeFromParent();
      rider.dispose();
    }
    mat.dispose();
  }
}
