// The cold open: ~4.5 s, straight to the point.
//
// Dusk out in the dunes. Sundown staggers away from the lens, three whiskeys
// deep (anim/drunkWalk.ts), stops, turns round and outdraws the camera: the
// round punches a hole through the lens (cracked glass, a scorched ember lip,
// light bleeding through), time freezes, and the view flies into the hole until
// it burns white - the white-hot desert sun the intro picks up from (LensShot).
// Without a lens rig it cuts to black. Uses the intro's own skip.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import type { CameraRig } from '../player/CameraRig';
import type { Player } from '../player/Player';
import type { World } from '../world/World';
import { RigInstance, buildRigGeo, type RigSpec } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import * as CH from '../models/characters';
import { CineKit, GRAIN, SAND, type KitWorld } from './CineKit';
import { DrunkGait } from '../anim/drunkWalk';
import { LensShot } from './LensShot';

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
  /** the lens he shoots through (the intro owns it); without it the cold open cuts to black */
  lens?: LensShot | null;
}

const sat = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
const ease = (k: number) => {
  k = sat(k);
  return k * k * (3 - 2 * k);
};

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

export async function playColdOpen(d: ColdOpenDeps): Promise<void> {
  const { engine: eng, cam, world, scene, player } = d;
  if (d.skipped()) return;
  const gAt = (x: number, z: number) => world.groundAt(x, z);
  const p0 = player.pos.clone();
  const S = findSet(world, p0);
  // `dir` points from him toward the lens; he walks the other way until he turns
  const dir = new THREE.Vector3(p0.x - S.x, 0, p0.z - S.z);
  if (dir.lengthSq() < 1) dir.set(1, 0, 0);
  dir.normalize();
  const side = new THREE.Vector3(dir.z, 0, -dir.x);
  const yawD = Math.atan2(dir.x, dir.z);
  const kit = new CineKit(eng, scene, world as unknown as KitWorld);
  const own: THREE.Object3D[] = [];
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
  actor.root.position.copy(S);
  actor.root.rotation.y = yawD + Math.PI;
  scene.add(actor.root);
  own.push(actor.root);
  actor.setExpression('determined');

  // ---- the clock
  let last = performance.now();
  const dtCap = d.dtCap ?? 0.05;
  let T = 0;
  let rate = 1;
  const gait = new DrunkGait(3.7);
  let fadeOut = false, turnStep = false, rattled = false;
  // ---- the draw: he stops, turns round, looks into the lens and shoots it (needs the intro's lens rig)
  const lens = d.lens ?? null;
  const DRAW = 1.3;
  /** after the shot: the frozen beat, then the push into the hole */
  const PUSH_AT = 0.95, PUSH_DUR = 0.95;
  const END = lens ? DRAW + 1.05 + PUSH_AT + PUSH_DUR + 0.05 : DRAW + 1.9;
  let drawn = false, fired = false, heart = false, pushing = false;
  const mz = new THREE.Vector3(), camW = new THREE.Vector3(), tv = new THREE.Vector3();
  const HOL = { x: 0.2, z: -0.26, f: -0.7 };
  const aim = { x: 0, z: 0 };
  let recoil = 0;
  const shot = (pos: THREE.Vector3, look: THREE.Vector3, fov: number, roll = 0) => {
    pos.y = Math.max(pos.y, gAt(pos.x, pos.z) + 0.3);
    cam.setCine({ pos, look, fov, roll }, false);
  };
  try {
    eng.letterbox(true, 0.01);
    void eng.fadeIn(0.6);
    // dev: ?coldfrom=1 starts the cold open late
    const from = +(new URLSearchParams(location.search).get('coldfrom') ?? 0);
    if (from > 0) T = from;
    while (!d.skipped() && T < END) {
      await eng.tweens.wait(0.016, true);
      const now = performance.now();
      const dt = Math.min(dtCap, (now - last) / 1000);
      last = now;
      if ((window as any).__cineHold) continue; // dev: freeze for a screenshot
      T += dt;
      (window as any).__coldT = T;
      // real time until the shot; the shot freezes the world (once the flash has burnt out); only the lens lives on
      rate = fired && T > DRAW + 1.05 + 0.09 ? 0.05 : 1;
      const cdt = dt * rate;
      const dd = T - DRAW;
      eng.slowMo(rate, 30);
      // ---- Sundown staggers away from the lens, stops, and turns round on it
      const walkAmt = 1 - ease((dd + 0.15) / 0.35);
      gait.update(cdt, 6.0, walkAmt);
      gait.pose(actor.nodes, { armL: true, armR: !drawn, head: false });
      actor.root.position.addScaledVector(dir, -cdt * 1.15 * walkAmt);
      const turnK = ease((dd - 0.05) / 0.38);
      actor.root.rotation.y = yawD + Math.PI * (1 - turnK);
      const ap = actor.root.position;
      ap.y = gAt(ap.x, ap.z);
      // the boot that plants as he swings round
      const pivot = !turnStep && dd > 0.2;
      if (pivot) turnStep = true;
      if (gait.stepped || pivot) {
        eng.audio.play('footstep_sand', { volume: 0.4, pitch: 0.9 + Math.random() * 0.2 });
        const fp = actor.nodes[gait.foot === 1 ? 'shin_l' : 'shin_r']?.getWorldPosition(tv) ?? ap;
        kit.particles.emit({ pos: { x: fp.x, y: ap.y + 0.04, z: fp.z }, count: 5, spread: 1.2, up: 1.1, life: [0.4, 0.8], size: [0.05, 0.03], sprite: GRAIN, color: SAND, gravity: 9, ground: true });
      }
      const n = actor.nodes;
      if (n['jaw']) n['jaw'].rotation.x = actor.exprJaw;
      n['brow_l']?.rotation.set(0, 0, actor.exprBrow[0]);
      n['brow_r']?.rotation.set(0, 0, actor.exprBrow[1]);
      n['head']?.rotation.set(-0.03 + gait.head.x, gait.head.y, gait.head.z);
      if (lens && dd > 0) {
        // ---- the draw (in real time: the fastest thing in a frozen world)
        if (dd > 0.08 && !rattled) {
          rattled = true;
          actor.setExpression('focus');
          eng.audio.play('skeleton_rattle', { volume: 0.35, pitch: 0.8 });
        }
        const turn = ease((dd - 0.52) / 0.26);
        if (n['pelvis']) n['pelvis'].rotation.y += 0.34 * turn;
        if (n['torso']) {
          n['torso'].rotation.y += 0.2 * turn;
          n['torso'].rotation.x -= 0.05 * turn;
        }
        n['arm_l']?.rotation.set(0.22 * turn + gait.armL.x * (1 - turn), 0, 0.2 * turn + gait.armL.z * (1 - turn));
        actor.root.updateMatrixWorld(true);
        camW.copy(cam.camera.position);
        // the head comes up and finds the lens
        const look = ease((dd - 0.05) / 0.4);
        if (n['head'] && n['torso']) {
          const hl = n['torso'].worldToLocal(camW.clone()).sub(n['head'].position);
          const yaw = Math.atan2(hl.x, hl.z), pitch = -Math.atan2(hl.y, Math.hypot(hl.x, hl.z));
          const r = n['head'].rotation;
          r.set(r.x + (pitch - 0.04 - r.x) * look, r.y + (yaw - r.y) * look, r.z + (0.07 - r.z) * look);
        }
        // the gun hand: down to the holster, the iron comes up into the lens
        if (n['arm_r'] && n['fore_r'] && n['torso']) {
          const sh = n['torso'].worldToLocal(camW.clone()).sub(n['arm_r'].position).normalize();
          aim.z = Math.asin(THREE.MathUtils.clamp(sh.x, -1, 1));
          aim.x = Math.atan2(-sh.z, -sh.y);
          const k1 = ease((dd - 0.56) / 0.1), k2 = 1 - Math.pow(1 - sat((dd - 0.68) / 0.13), 3);
          if (dd > 0.66 && !drawn) {
            drawn = true;
            actor.attach('hand_r', holder);
            eng.audio.play('rev_spin', { volume: 0.5, pitch: 1.3 });
          }
          const ax0 = gait.armR.x + (HOL.x - gait.armR.x) * k1, az0 = gait.armR.z + (HOL.z - gait.armR.z) * k1, f0 = gait.armR.fore + (HOL.f - gait.armR.fore) * k1;
          recoil *= Math.exp(-dt * 7);
          n['arm_r'].rotation.set(ax0 + (aim.x - ax0) * k2 - recoil, 0, az0 + (aim.z - az0) * k2);
          n['fore_r'].rotation.set(f0 * (1 - k2) - recoil * 0.4, 0, 0);
        }
        if (dd > 0.9 && dd < 0.95 && !fired) eng.audio.play('rev_hammer', { volume: 0.8 });
        actor.root.updateMatrixWorld(true);
        // BANG
        if (!fired && dd >= 1.05) {
          fired = true;
          if (!(gun.sockets['muzzle']?.getWorldPosition(mz))) gun.root.getWorldPosition(mz);
          const dc = camW.clone().sub(mz).normalize();
          const P = kit.particles;
          P.emit({ pos: mz, count: 1, life: [0.06, 0.07], size: [0.62, 0.8], sprite: ['flash0', 'flash1', 'flash2'], animate: true, additive: true, color: 0xfff2a0, rot: 6.28 });
          P.emit({ pos: mz.clone().addScaledVector(dc, 0.18), count: 1, life: [0.05, 0.06], size: [0.36, 0.2], sprite: 'glow16', additive: true, color: 0xffd27a, sizeJitter: 0 });
          P.emit({ pos: mz, count: 16, vel: { x: dc.x * 16, y: dc.y * 16, z: dc.z * 16 }, spread: 5, life: [0.06, 0.22], size: [0.04, 0.012], sprite: 'spark', additive: true, color: [0xffd070, 0xfff2a0, 0xff9a40], stretch: 0.025, drag: 5 });
          P.emit({ pos: mz, count: 6, vel: { x: dc.x * 6, y: dc.y * 6, z: dc.z * 6 }, spread: 2, life: [0.25, 0.5], size: [0.03, 0.012], sprite: 'dot3', additive: true, color: [0xffa040, 0xff7020, 0xffd070], drag: 3, gravity: 3 });
          P.emit({ pos: mz, count: 6, vel: { x: dc.x * 3 + side.x * 0.4, y: dc.y * 3 + 0.4, z: dc.z * 3 + side.z * 0.4 }, spread: 0.9, life: [0.8, 1.6], size: [0.14, 0.7], sprite: ['puff0', 'puff1', 'puff2'], color: [0xddd6ca, 0xc4bcae, 0xb0a898], alpha: 0.55, drag: 4, rot: 6, rotSpeed: 1.2, gravity: -0.4 });
          kit.light(mz, 0xffb050, 12, 0.14, 10);
          eng.audio.play('rev_shot', { volume: 1, pitch: 0.92 });
          eng.flash(0xfff0c8, 0.45, 0.1);
          cam.addTrauma(0.55);
          recoil = 0.5;
          // the round goes through the lens where the muzzle points
          LensShot.toUv(cam.camera, mz, lens.hole);
          lens.hole.set(THREE.MathUtils.clamp(lens.hole.x, 0.3, 0.7), THREE.MathUtils.clamp(lens.hole.y, 0.32, 0.72));
          lens.on = 1;
          lens.burn = 1;
          lens.light = 0.35;
          lens.crack = 0;
          kit.after(0.0, () => eng.audio.play('glass_break', { volume: 1, pitch: 0.8 }));
          eng.audio.play('time_slow', { volume: 0.6, pitch: 1.2 });
          // glass splinters hang in the frozen air just in front of the lens
          const cv = cam.camera;
          const ray = new THREE.Vector3(lens.hole.x * 2 - 1, lens.hole.y * 2 - 1, 0.5).unproject(cv).sub(cv.position).normalize();
          const gp = cv.position.clone().addScaledVector(ray, 0.55);
          P.emit({ pos: gp, count: 18, vel: { x: -ray.x * 1.2, y: -ray.y * 1.2 + 0.2, z: -ray.z * 1.2 }, spread: 1.6, life: [2.5, 4], size: [0.012, 0.006], sprite: ['star4', 'spark', 'dot3'], additive: true, color: [0xffffff, 0xfff4d8, 0xd8ecff], drag: 1, gravity: 1 });
        }
        if (fired) {
          const f = dd - 1.05;
          // cracks race out from the hole, the lip cools, the light behind it swells
          lens.crack = 1 - Math.pow(1 - sat(f / 0.16), 3);
          lens.burn = 0.35 + 0.65 * Math.exp(-f * 1.4);
          lens.light = 0.35 + 0.85 * ease((f - 0.15) / 0.75);
          if (!heart && f > 0.25) {
            heart = true;
            eng.audio.play('heartbeat', { volume: 0.7, pitch: 0.9 });
          }
          // ...then the view flies into the hole and burns white: the desert sun
          const pk = sat((f - PUSH_AT) / PUSH_DUR);
          if (pk > 0 && !pushing) {
            pushing = true;
            eng.audio.play('whoosh_big', { volume: 0.9, pitch: 0.55 });
            eng.audio.play('wind_loop', { volume: 0.5, pitch: 1.4 });
          }
          lens.push = pk * pk * (3 - 2 * pk);
          lens.white = Math.pow(sat((pk - 0.5) / 0.5), 1.5);
          lens.blaze = Math.max(lens.white, pk * 0.3);
        }
        lens.sync();
      }
      if (pinch) {
        const pn = pinch.nodes;
        for (let k = 1; k <= 5; k++) pn['tail' + k]?.rotation.set(-0.3 - Math.sin(T * 2 + k) * 0.08, 0, 0);
        pinch.root.rotation.y = Math.sin(T * 1.3) * 0.3;
      }
      actor.root.updateMatrixWorld(true);
      // ---- the camera: low behind him as he walks off; he turns round into it, it creeps in, then holds
      const k = ease(sat(dd / 1.05));
      shot(ap.clone().addScaledVector(dir, 2.95 - k * 0.3).addScaledVector(side, 0.34).add(new THREE.Vector3(0, 1.2, 0)), ap.clone().add(new THREE.Vector3(0, 1.3, 0)).addScaledVector(dir, -2.2 * (1 - turnK)).addScaledVector(side, 0.06), 40 - k * 2);
      kit.update(cdt, cdt);
      if (!lens && !fadeOut && T >= END - 0.7) {
        fadeOut = true;
        void eng.fadeOut(0.65, '#000');
      }
    }
  } finally {
    // hand back on black (or on the lens burnt white): the intro picks up from here
    if (!d.skipped() && !lens) eng.fadeEl.style.opacity = '1';
    eng.slowMo(1, 1000);
    actor.dispose();
    for (const o of own) o.removeFromParent();
    kit.dispose();
    cam.setCine(null, false);
  }
}
