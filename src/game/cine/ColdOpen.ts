// The cold open: ~10.5 s of action in front of the (approved, unchanged) opening.
//
// Dusk on a lonely stretch of frontier street out in the dunes. Sundown steps
// out of a saloon and walks toward the lens, unhurried; a lit fuse fizzes back
// across the sand behind him to the dynamite stacked on the porch. BOOM - time
// drops into slow motion as the saloon comes apart in a voxel fireball: the
// building shatters into tumbling chunks, a shock ring rolls through the living
// sand under his boots, burning planks and embers rain down around him and he
// never once looks back. A close-up: the fire on his skull, the hat brim dips.
// The wagon goes up too - a wide shot of a small figure walking out of an
// inferno - and the title "dustUP" bursts up out of the sand in front of the
// blaze in voxel-cast gold, then a cut to black and the bounty poster.
// Uses the intro's own skip (SPACE / ESC / the SKIP label).
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import type { CameraRig } from '../player/CameraRig';
import type { Player } from '../player/Player';
import type { World } from '../world/World';
import { RigInstance, buildRigGeo, type RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { modelEntry } from '../models/lookup';
import * as CH from '../models/characters';
import { CineKit, GRAIN, SAND, type KitWorld } from './CineKit';
import { VoxelWord, warmLetters } from './VoxelLetters';

export interface ColdOpenDeps {
  engine: Engine;
  cam: CameraRig;
  world: World;
  scene: THREE.Scene;
  player: Player;
  /** the intro's skip flag */
  skipped(): boolean;
  /** cap on a frame's dt (slow headless machines) */
  dtCap?: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const sat = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
const ease = (k: number) => {
  k = sat(k);
  return k * k * (3 - 2 * k);
};

interface SetPiece {
  mesh: THREE.Mesh;
  model: VoxelModel;
  vs: number;
  pivot: [number, number, number];
  /** which blast takes it: 1 the saloon, 2 the wagon */
  boom: number;
}

function piece(key: string): { mesh: THREE.Mesh; model: VoxelModel; vs: number; pivot: [number, number, number]; box: THREE.Box3 } | null {
  try {
    const e = modelEntry(key)?.() as { model?: VoxelModel; voxelSize?: number } | undefined;
    if (!e?.model || !e.voxelSize) return null;
    const b = e.model.bounds();
    const pivot: [number, number, number] = [(b.minX + b.maxX + 1) / 2, b.minY, (b.minZ + b.maxZ + 1) / 2];
    const geo = buildVoxelGeometry(e.model, { voxelSize: e.voxelSize, pivot });
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return { mesh, model: e.model, vs: e.voxelSize, pivot, box: geo.boundingBox!.clone() };
  } catch (err) {
    console.warn('[coldopen] model failed', key, err);
    return null;
  }
}

/** a flat, clear patch of desert well inside the storm, away from the start */
function findSet(world: World, p: THREE.Vector3) {
  const storm = (world as unknown as { storm?: { sdf(x: number, z: number): number } }).storm;
  let best: { x: number; z: number; score: number } | null = null;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    for (const R of [46, 60, 34]) {
      const x = p.x + Math.cos(a) * R, z = p.z + Math.sin(a) * R;
      const sd = storm ? storm.sdf(x, z) : 99;
      if (sd < 26) continue;
      let lo = 1e9, hi = -1e9;
      for (let k = 0; k < 9; k++) {
        const aa = (k / 9) * Math.PI * 2, rr = k === 0 ? 0 : 13;
        const g = world.groundAt(x + Math.cos(aa) * rr, z + Math.sin(aa) * rr);
        lo = Math.min(lo, g);
        hi = Math.max(hi, g);
      }
      let props = 0;
      world.colliders?.query(x, z, 15, () => props++);
      const score = hi - lo + props * 1.5 + (R === 34 ? 0.5 : 0);
      if (!best || score < best.score) best = { x, z, score };
    }
  }
  return best ? new THREE.Vector3(best.x, world.groundAt(best.x, best.z), best.z) : p.clone().add(new THREE.Vector3(40, 0, 0));
}

function walkPose(r: RigInstance, ph: number, amt: number) {
  const n = r.nodes;
  const s = Math.sin(ph);
  n['thigh_l']?.rotation.set(-s * 0.5 * amt, 0, 0);
  n['thigh_r']?.rotation.set(s * 0.5 * amt, 0, 0);
  n['shin_l']?.rotation.set(Math.max(0, Math.sin(ph + 1.4)) * 0.8 * amt, 0, 0);
  n['shin_r']?.rotation.set(Math.max(0, Math.sin(ph + 1.4 + Math.PI)) * 0.8 * amt, 0, 0);
  n['arm_l']?.rotation.set(s * 0.38 * amt, 0, 0.1);
  n['fore_l']?.rotation.set(-0.3 - Math.max(0, s) * 0.25 * amt, 0, 0);
  n['arm_r']?.rotation.set(-s * 0.3 * amt, 0, -0.12);
  n['fore_r']?.rotation.set(-0.35 - Math.max(0, -s) * 0.2 * amt, 0, 0);
  n['torso']?.rotation.set(0.04 * amt, Math.sin(ph) * 0.08 * amt, Math.cos(ph) * 0.03 * amt);
  if (n['pelvis']) n['pelvis'].rotation.y = -Math.sin(ph) * 0.06 * amt;
  if (n['coat']) n['coat'].rotation.x = -Math.abs(s) * 0.12 * amt - 0.04;
}

export async function playColdOpen(d: ColdOpenDeps): Promise<void> {
  const { engine: eng, cam, world, scene, player } = d;
  if (d.skipped()) return;
  warmLetters();
  const gAt = (x: number, z: number) => world.groundAt(x, z);
  const p0 = player.pos.clone();
  const S = findSet(world, p0);
  // the street runs from the saloon toward the lens; the start (and the poster) lie behind the camera
  const dir = new THREE.Vector3(p0.x - S.x, 0, p0.z - S.z);
  if (dir.lengthSq() < 1) dir.set(1, 0, 0);
  dir.normalize();
  const side = new THREE.Vector3(dir.z, 0, -dir.x);
  const yawD = Math.atan2(dir.x, dir.z);
  const at = (fwd: number, right: number, up = 0) => {
    const v = S.clone().addScaledVector(dir, fwd).addScaledVector(side, right);
    v.y = gAt(v.x, v.z) + up;
    return v;
  };
  const kit = new CineKit(eng, scene, world as unknown as KitWorld);
  const own: THREE.Object3D[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const pieces: SetPiece[] = [];
  const add = (key: string, pos: THREE.Vector3, yaw: number, boom: number, sink = 0.05) => {
    const pc = piece(key);
    if (!pc) return null;
    pc.mesh.material = player.material;
    pc.mesh.position.copy(pos).add(new THREE.Vector3(0, -sink, 0));
    pc.mesh.rotation.y = yaw;
    scene.add(pc.mesh);
    own.push(pc.mesh);
    geos.push(pc.mesh.geometry);
    if (boom) pieces.push({ mesh: pc.mesh, model: pc.model, vs: pc.vs, pivot: pc.pivot, boom });
    return pc;
  };
  // ---- the set: a saloon with dynamite on its porch, a wagon, barrels, a hitching rail
  let frontZ = 5;
  {
    const pc = piece('saloon');
    if (pc) {
      frontZ = pc.box.max.z;
      const C = at(-(frontZ + 4), 0);
      let lo = C.y;
      for (const [a, b] of [[-5, -4], [5, -4], [-5, 4], [5, 4]]) lo = Math.min(lo, gAt(C.x + side.x * a + dir.x * b, C.z + side.z * a + dir.z * b));
      pc.mesh.material = player.material;
      pc.mesh.position.set(C.x, lo - 0.25, C.z);
      pc.mesh.rotation.y = yawD;
      scene.add(pc.mesh);
      own.push(pc.mesh);
      geos.push(pc.mesh.geometry);
      pieces.push({ mesh: pc.mesh, model: pc.model, vs: pc.vs, pivot: pc.pivot, boom: 1 });
    }
  }
  const porch = at(-3.4, 2.6);
  add('tnt_crate_1', porch, yawD + 0.3, 1);
  add('tnt_crate_2', porch.clone().add(new THREE.Vector3(0, 0.55, 0)).addScaledVector(side, 0.12), yawD - 0.2, 1, 0);
  add('whiskey_barrel_1', at(-3.2, -3.4), yawD, 1);
  add('whiskey_barrel_2', at(-2.6, -4.2), yawD + 1, 1);
  add('hitching_rail', at(-2.2, 4.6), yawD + Math.PI / 2, 1);
  const wagonAt = at(-1.2, -6.4);
  add('wagon_1', wagonAt, yawD + 0.35, 2);
  add('signpost_1', at(4.5, 4.4), yawD - 0.6, 0);
  // ---- Sundown on foot: his own rig, gun on the hip, board slung on his back, Pinch on the shoulder
  const actor = new RigInstance(player.rig.geo, { material: player.material });
  const gun = new RigInstance(player.gun.geo, { material: player.material });
  const holder = new THREE.Group();
  holder.rotation.x = Math.PI / 2;
  holder.add(gun.root);
  if (!actor.attach('hip_r', holder)) actor.nodes['pelvis']?.add(holder);
  const board = new THREE.Mesh(player.boardMesh.geometry, player.material);
  board.castShadow = true;
  const mount = (CH as unknown as { attachBoardOnBack?: (r: RigInstance, b: THREE.Object3D, o?: { material?: THREE.Material }) => THREE.Group | null }).attachBoardOnBack;
  if (!(mount && actor.sockets['board_back'] && mount(actor, board, { material: player.material }))) {
    const sling = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.rotation.x = -Math.PI / 2;
    tilt.position.set(0, -0.05, -0.07);
    tilt.add(board);
    sling.rotation.z = 0.36;
    sling.add(tilt);
    if (!actor.attach('back', sling)) actor.nodes['torso']?.add(sling);
  }
  let pinch: RigInstance | null = null;
  const ps = modelEntry('pinch')?.() as RigSpec | undefined;
  if (ps?.parts) {
    pinch = new RigInstance(buildRigGeo(ps, 'pinch:coldopen'), { material: player.material });
    if (!actor.attach('shoulder_l', pinch.root)) actor.nodes['torso']?.add(pinch.root);
  }
  const A = at(-2.2, 0.4);
  actor.root.position.copy(A);
  actor.root.rotation.y = yawD;
  scene.add(actor.root);
  own.push(actor.root);
  actor.setExpression('determined');
  const head = () => {
    const n = actor.nodes['head'] ?? actor.root;
    return n.getWorldPosition(new THREE.Vector3());
  };
  // ---- the title, cast in voxels (rises later, behind him, in front of the blaze)
  const word = new VoxelWord('dustUP', { height: 2.3, style: 'gold' });
  let wordIn = false;
  word.onLand = (_l, p, i) => {
    kit.sandPop(p, 1.6);
    kit.sfx(i % 2 ? 'rock_crumble' : 'sand_burst', p, 0.8, 0.7 + Math.random() * 0.2);
    cam.addTrauma(0.12);
  };

  // ---- the clock
  let last = performance.now();
  const dtCap = d.dtCap ?? 0.05;
  let T = 0;
  let rate = 1;
  let walkPh = 0;
  let lastStep = 0;
  let boom1 = false, boom2 = false, fadeOut = false;
  const fuseFrom = A.clone();
  const fuseTo = porch.clone();
  const shot = (pos: THREE.Vector3, look: THREE.Vector3, fov: number, roll = 0) => {
    pos.y = Math.max(pos.y, gAt(pos.x, pos.z) + 0.3);
    cam.setCine({ pos, look, fov, roll }, false);
  };
  const blast = (pc: SetPiece[], center: THREE.Vector3, r: number) => {
    for (const p of pc) {
      p.mesh.updateMatrixWorld(true);
      kit.debris.shatter(p.model, p.vs, p.mesh.matrixWorld.clone(), p.pivot, { chunk: p.vs < 1 / 14 ? 7 : 4, speed: 12 + r, max: p.vs < 1 / 14 ? 420 : 120, up: 8 });
      p.mesh.visible = false;
    }
    kit.blast(center, r, { wood: true, debris: 90 });
    kit.after(0.12, () => kit.blast(center.clone().addScaledVector(side, r * 0.6).add(new THREE.Vector3(0, r * 0.4, 0)), r * 0.6, { ring: false, flash: false, sound: false, wood: true }));
    kit.after(0.3, () => kit.blast(center.clone().addScaledVector(side, -r * 0.7).add(new THREE.Vector3(0, r * 0.2, 0)), r * 0.55, { ring: false, flash: false, sound: false, wood: true }));
    kit.burn(center, r * 0.9, 40);
    cam.addTrauma(0.9);
  };
  try {
    eng.letterbox(true, 0.01);
    void eng.fadeIn(0.9);
    eng.audio.play('dynamite_fuse', { volume: 0.7 });
    eng.audio.play('door_creak', { volume: 0.6, pitch: 0.8 });
    while (!d.skipped() && T < 10.6) {
      await eng.tweens.wait(0.016, true);
      const now = performance.now();
      const dt = Math.min(dtCap, (now - last) / 1000);
      last = now;
      T += dt;
      // time: real speed until the blast, then deep slow motion, easing up a little for the title
      rate = T < 2.0 ? 1 : T < 7.6 ? 0.3 : 0.42;
      const cdt = dt * rate;
      // the world (its living sand) slows with us
      eng.slowMo(rate, 30);
      // ---- Sundown walks toward the lens and never looks back
      const walkAmt = 1;
      walkPh += cdt * 6.0;
      walkPose(actor, walkPh, walkAmt);
      actor.root.position.addScaledVector(dir, cdt * 1.15);
      const ap = actor.root.position;
      ap.y = gAt(ap.x, ap.z) + Math.abs(Math.cos(walkPh)) * 0.035;
      if (Math.floor(walkPh / Math.PI) !== lastStep) {
        lastStep = Math.floor(walkPh / Math.PI);
        if (rate > 0.9) eng.audio.play('footstep_sand', { volume: 0.4, pitch: 0.9 + Math.random() * 0.2 });
        kit.particles.emit({ pos: { x: ap.x, y: ap.y + 0.04, z: ap.z }, count: 5, spread: 1.2, up: 1.1, life: [0.4, 0.8], size: [0.05, 0.03], sprite: GRAIN, color: SAND, gravity: 9, ground: true });
      }
      const n = actor.nodes;
      if (n['jaw']) n['jaw'].rotation.x = actor.exprJaw;
      n['brow_l']?.rotation.set(0, 0, actor.exprBrow[0]);
      n['brow_r']?.rotation.set(0, 0, actor.exprBrow[1]);
      // the hat brim dips in the close-up
      if (n['head']) n['head'].rotation.x += ((T > 4.6 && T < 5.8 ? 0.2 : -0.03) - n['head'].rotation.x) * Math.min(1, dt * 4);
      if (pinch) {
        const pn = pinch.nodes;
        for (let k = 1; k <= 5; k++) pn['tail' + k]?.rotation.set(-0.3 - Math.sin(T * 2 + k) * 0.08, 0, 0);
        pinch.root.rotation.y = boom1 ? Math.PI * 0.85 : Math.sin(T * 1.3) * 0.3; // Pinch looks back. Sundown doesn't.
      }
      actor.root.updateMatrixWorld(true);
      // ---- the fuse fizzing back across the sand to the porch
      if (!boom1) {
        const k = sat(T / 2.0);
        const fp = fuseFrom.clone().lerp(fuseTo, k);
        fp.y = gAt(fp.x, fp.z) + 0.05;
        kit.particles.emit({ pos: fp, count: 3, spread: 1.6, up: 0.8, life: [0.15, 0.4], size: [0.06, 0.01], sprite: 'spark', additive: true, color: [0xfff0b0, 0xffa040], drag: 2, gravity: 3 });
        kit.particles.emit({ pos: fp, count: 1, vel: { x: 0, y: 0.6, z: 0 }, spread: 0.2, life: [0.6, 1.1], size: [0.08, 0.2], sprite: 'puff0', color: 0x8a7a68, alpha: 0.5, drag: 1 });
        kit.light(fp, 0xffb050, 3, 0.12, 4);
      }
      if (!boom1 && T >= 2.0) {
        boom1 = true;
        const saloon = pieces.find((p) => p.boom === 1 && p.vs < 1 / 14);
        const center = saloon ? saloon.mesh.position.clone().add(new THREE.Vector3(0, 2.4, 0)) : at(-(frontZ + 4), 0, 2.4);
        blast(pieces.filter((p) => p.boom === 1), center, 6.2);
        kit.blast(porch, 3, { ring: false, flash: false, sound: false, wood: true });
        eng.audio.play('time_slow', { volume: 0.8, pitch: 0.85 });
        eng.flash(0xfff4d8, 0.75, 0.5);
      }
      if (!boom2 && T >= 5.6) {
        boom2 = true;
        blast(pieces.filter((p) => p.boom === 2), wagonAt.clone().add(new THREE.Vector3(0, 0.8, 0)), 3.6);
      }
      // burning planks and embers raining down around him
      if (boom1 && T < 8.5 && Math.random() < dt * 9) {
        const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 5;
        const x = ap.x + Math.cos(a) * r, z = ap.z + Math.sin(a) * r;
        kit.debris.burst(x, ap.y + 7 + Math.random() * 4, z, 1 + Math.floor(Math.random() * 2), 0.14, [0x5a3a1e, 0x2a1a10, 0x8a5a30], 1.2, -3);
        kit.particles.emit({ pos: { x, y: ap.y + 6, z }, count: 4, vel: { x: 0, y: -4, z: 0 }, spread: 0.8, life: [1.2, 2], size: [0.07, 0.02], sprite: ['dot3', 'spark'], additive: true, color: [0xffd080, 0xff7a20], gravity: 2, drag: 0.6 });
      }
      if (boom1 && Math.random() < dt * 6) kit.ash(head().addScaledVector(dir, 1.2), 2, { x: side.x * 1.2, y: 0, z: side.z * 1.2 });
      // ---- the title rises out of the sand between him and the blaze
      if (!wordIn && T >= 7.4) {
        wordIn = true;
        const L = ap.clone().addScaledVector(dir, -4.2);
        L.y = gAt(L.x, L.z);
        word.group.position.copy(L);
        word.group.rotation.y = yawD;
        word.plant(gAt);
        scene.add(word.group);
        own.push(word.group);
        word.enter('rise', 0.1, 0.05);
        kit.shock(L.x, L.z, { power: 0.8, speed: 9, life: 1.6 });
        eng.audio.play('quake_rumble', { volume: 0.8, pitch: 0.9 });
      }
      if (wordIn) word.update(dt);
      // ---- the camera
      const h = head();
      if (T < 2.0) {
        const k = T / 2.0;
        shot(ap.clone().addScaledVector(dir, 4.4 - k * 0.3).addScaledVector(side, 0.9).add(new THREE.Vector3(0, 0.75, 0)), ap.clone().add(new THREE.Vector3(0, 1.3, 0)).addScaledVector(dir, -2.5), 44 - k * 2);
      } else if (T < 4.4) {
        const k = (T - 2.0) / 2.4;
        const a = -0.35 + k * 0.6;
        const off = dir.clone().applyAxisAngle(UP, a).multiplyScalar(3.9 - k * 0.6);
        shot(ap.clone().add(off).add(new THREE.Vector3(0, 0.42, 0)), ap.clone().add(new THREE.Vector3(0, 1.4, 0)).addScaledVector(dir, -3), 40 - k * 4, 0.06 - k * 0.04);
      } else if (T < 5.6) {
        const k = (T - 4.4) / 1.2;
        shot(h.clone().addScaledVector(dir, 1.25 - k * 0.15).addScaledVector(side, 0.42).add(new THREE.Vector3(0, -0.14, 0)), h.clone().add(new THREE.Vector3(0, 0.02, 0)), 30 - k * 2, -0.03);
      } else if (T < 7.6) {
        const k = (T - 5.6) / 2.0;
        shot(ap.clone().addScaledVector(side, -11 + k * 1.5).addScaledVector(dir, 5.5).add(new THREE.Vector3(0, 2.2 + k * 0.4, 0)), ap.clone().add(new THREE.Vector3(0, 1.8, 0)).addScaledVector(dir, -4.5), 52);
      } else {
        const k = ease((T - 7.6) / 3.0);
        const L = word.group.position;
        shot(ap.clone().addScaledVector(dir, 6.5 + k * 3).addScaledVector(side, 0.6).add(new THREE.Vector3(0, 0.9 + k * 2.4, 0)), L.clone().add(new THREE.Vector3(0, 1.3 + k * 0.4, 0)).lerp(ap.clone().add(new THREE.Vector3(0, 1.4, 0)), 0.25 * (1 - k)), 50 - k * 4);
      }
      kit.update(cdt, cdt);
      if (!fadeOut && T >= 9.9) {
        fadeOut = true;
        void eng.fadeOut(0.65, '#000');
      }
    }
  } finally {
    // hand back on black: the bounty poster fades in from here
    if (!d.skipped()) eng.fadeEl.style.opacity = '1';
    eng.slowMo(1, 1000);
    word.dispose();
    actor.dispose();
    for (const o of own) o.removeFromParent();
    for (const g of geos) g.dispose();
    kit.dispose();
    cam.setCine(null, false);
  }
}
