// Consumable use animations — a full-body overlay posed on top of the riding pose.
//
// startItemUse() puts the item model in Sundown's hand and installs a per-rig hook
// (`rig.itemUse`) that PlayerAnim.finish() calls every frame (one-line hook there):
// it blends both arms (own IK, torso space), head, jaw and torso into a hand-keyed
// sequence per item, animates the prop in the hand and fires timed events back to
// the caller (light the fuse, release the throw, toss the bottle, pin the star...).
//
//   whiskey   grab from the belt, tip it up under the mask, gulp gulp, toss the bottle, wipe the mask
//   snakeoil  thumb the cork off, quick swig, toss, full-body shiver
//   bandage   present the gun arm, wind the roll round the forearm three times, tug it tight
//   linen     the same, slower, in embalmer's gold, pressing the seal at the end
//   dynamite  pull a bundle, light the fuse off his own ghost-fire eye, coil, hurl it at the aim
//   charm     lift Serket's charm to his face, rub the gem till it glows, raise it high
//   dagger    draw, slash the gun forearm for the blood pact, flip the blade, sheathe
//   smoke     pull the bomb, raise it high, slam it down at his feet
//   shield    show the tin star (it spins and glints), slap it onto his chest
import * as THREE from 'three';
import { voxelMesh } from '../../engine/voxel/Rig';
import type { RigInstance } from '../../engine/voxel/Rig';
import { armIK } from './playerAnim';
import type { PlayerAnimIn } from './playerAnim';
import { clamp01, lerp, smooth, easeOutCubic, easeInCubic, easeInOutSine, easeOutBack, TAU } from './math';
import { consumable } from '../models/characters/consumables';
import { forearmWrapModel } from '../models/characters/sundown';

export type UseEvent = 'grab' | 'pop' | 'lit' | 'release' | 'toss' | 'smash' | 'pin' | 'cut' | 'peak' | 'wrapped' | 'done';
/** at: the item's world position; dir: a world direction (throw / toss) */
export type UseListener = (e: UseEvent, at: THREE.Vector3, dir: THREE.Vector3, prop: THREE.Object3D) => void;

type Kind = 'whiskey' | 'snakeoil' | 'bandage' | 'linen' | 'dynamite' | 'charm' | 'dagger' | 'smoke' | 'shield';
const SEQ: Record<Kind, { key: string; dur: number; ev: [number, UseEvent][] }> = {
  whiskey: { key: 'item_whiskey', dur: 1.85, ev: [[0.1, 'grab'], [0.7, 'toss']] },
  snakeoil: { key: 'item_snakeoil', dur: 1.55, ev: [[0.08, 'grab'], [0.22, 'pop'], [0.56, 'toss']] },
  bandage: { key: 'item_bandage', dur: 1.75, ev: [[0.1, 'grab'], [0.8, 'wrapped']] },
  linen: { key: 'item_linen', dur: 2.0, ev: [[0.1, 'grab'], [0.84, 'wrapped']] },
  dynamite: { key: 'item_dynamite', dur: 1.3, ev: [[0.1, 'grab'], [0.36, 'lit'], [0.63, 'release']] },
  charm: { key: 'item_charm', dur: 1.5, ev: [[0.08, 'grab'], [0.8, 'peak']] },
  dagger: { key: 'item_dagger', dur: 1.2, ev: [[0.12, 'grab'], [0.5, 'cut']] },
  smoke: { key: 'item_smoke', dur: 1.0, ev: [[0.1, 'grab'], [0.5, 'smash']] },
  shield: { key: 'item_star', dur: 1.2, ev: [[0.08, 'grab'], [0.6, 'pin']] },
};
/** item id (Items.ts) -> animation */
const KIND: Record<string, Kind> = { whiskey: 'whiskey', snakeoil: 'snakeoil', bandage: 'bandage', goldBandage: 'linen', dynamite: 'dynamite', charm: 'charm', dagger: 'dagger', smoke: 'smoke', shield: 'shield' };

interface Linger {
  obj: THREE.Object3D;
  until: number;
}
interface UseState {
  kind: Kind;
  t: number;
  dur: number;
  prop: THREE.Group;
  gem: THREE.Object3D | null;
  fired: number;
  on: UseListener;
  l1: number;
  l2: number;
  hidden: boolean;
  /** jaw offset added last frame (PlayerAnim damps the jaw from its current value, lambda 18) */
  jawPrev: number;
}
interface RigHook {
  itemUse?: (I: PlayerAnimIn, anim: unknown) => void;
}
const live = new WeakMap<RigInstance, { use: UseState | null; linger: Linger[]; clock: number }>();
const geoCache = new Map<string, { geo: THREE.BufferGeometry; gem: THREE.BufferGeometry | null }>();

function propGeo(key: string) {
  let g = geoCache.get(key);
  if (!g) {
    const c = consumable(key)!;
    const b = c.model.bounds();
    const pivot: [number, number, number] = [(b.minX + b.maxX + 1) / 2, (b.minY + b.maxY + 1) / 2, (b.minZ + b.maxZ + 1) / 2];
    const geo = voxelMesh(c.model, c.voxelSize, pivot).geometry;
    const gem = c.meta.gem ? voxelMesh(c.meta.gem, c.voxelSize, pivot).geometry : null;
    geoCache.set(key, (g = { geo, gem }));
  }
  return g;
}

/** how long the use animation for this item lasts (seconds), 0 if it has none */
export function itemUseDuration(id: string) {
  const k = KIND[id];
  return k ? SEQ[k].dur : 0;
}

/**
 * Play the full use animation of a consumable on a rig (Sundown). Returns the duration.
 * The listener receives the timed events; 'done' always fires at the end.
 */
export function startItemUse(rig: RigInstance, id: string, on: UseListener = () => {}, material?: THREE.Material): number {
  const kind = KIND[id];
  if (!kind) return 0;
  const seq = SEQ[kind];
  let st = live.get(rig);
  if (!st) live.set(rig, (st = { use: null, linger: [], clock: 0 }));
  if (st.use) finishUse(st.use, rig);
  const mat = material ?? (rig.material as unknown as THREE.Material);
  const g = propGeo(seq.key);
  const prop = new THREE.Group();
  prop.name = 'item:' + id;
  const mesh = new THREE.Mesh(g.geo, mat);
  mesh.castShadow = true;
  prop.add(mesh);
  let gem: THREE.Object3D | null = null;
  if (g.gem) {
    gem = new THREE.Mesh(g.gem, mat);
    prop.add(gem);
  }
  prop.visible = false;
  const hand = rig.sockets['hand_l'] ?? rig.nodes['fore_l'];
  hand?.add(prop);
  const fore = rig.nodes['fore_l'];
  const l1 = fore ? fore.position.length() : 0.26;
  const l2 = rig.sockets['hand_l'] ? rig.sockets['hand_l'].position.length() : 0.32;
  st.use = { kind, t: 0, dur: seq.dur, prop, gem, fired: 0, on, l1, l2, hidden: false, jawPrev: 0 };
  (rig as unknown as RigHook).itemUse = (I, anim) => tick(rig, I, anim);
  return seq.dur;
}

/** true while a use animation is playing on this rig */
export function itemUseActive(rig: RigInstance) {
  return !!live.get(rig)?.use;
}

function finishUse(u: UseState, rig: RigInstance) {
  u.prop.removeFromParent();
  const st = live.get(rig);
  if (st && st.use === u) st.use = null;
}

// ------------------------------------------------------------------ scratch
const _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qs = new THREE.Quaternion();
const _inv = new THREE.Matrix4(), _b = new THREE.Matrix4();
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const T = new THREE.Vector3(), TR = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
const POLE_L = new THREE.Vector3(0.6, -0.8, -0.2), POLE_R = new THREE.Vector3(-0.8, -0.6, -0.2);
const HINT_FWD = new THREE.Vector3(0, 0.2, 1), HINT_UP = new THREE.Vector3(0, 1, 0.3), HINT_IN = new THREE.Vector3(-1, 0.3, 0.4);

const seg = (k: number, a: number, b: number) => clamp01((k - a) / (b - a));
const bell = (k: number, a: number, b: number, c: number, d: number) => smooth(seg(k, a, b)) * (1 - smooth(seg(k, c, d)));

function tick(rig: RigInstance, I: PlayerAnimIn, anim: unknown) {
  const st = live.get(rig);
  if (!st) return;
  st.clock += I.dt;
  // lingering after-effects (the bandage wrap on the forearm)
  for (let i = st.linger.length - 1; i >= 0; i--) {
    const l = st.linger[i];
    if (st.clock > l.until) {
      l.obj.removeFromParent();
      st.linger.splice(i, 1);
    } else if (st.clock > l.until - 0.6) l.obj.scale.setScalar(Math.max(0.01, (l.until - st.clock) / 0.6));
  }
  const u = st.use;
  if (!u) {
    if (!st.linger.length) delete (rig as unknown as RigHook).itemUse;
    return;
  }
  u.t += I.dt;
  const k = clamp01(u.t / u.dur);
  const seq = SEQ[u.kind];
  const n = rig.nodes;
  const torso = n['torso'], head = n['head'], jaw = n['jaw'];
  const armL = n['arm_l'], foreL = n['fore_l'], armR = n['arm_r'], foreR = n['fore_r'];
  if (!torso || !armL || !foreL) return finishUse(u, rig);
  const w = smooth(k / 0.12) * smooth((1 - k) / 0.14);
  const SL = armL.position, SR = armR?.position ?? SL;

  // ---------------- body / head first (they move the anchors the hands reach for)
  let headX = 0, headY = 0, headZ = 0, jawAdd = 0, torsoX = 0, torsoY = 0, torsoZ = 0;
  const secs = u.t;
  switch (u.kind) {
    case 'whiskey': {
      const h = bell(k, 0.26, 0.36, 0.6, 0.7);
      headX = -0.62 * h + 0.05 * Math.sin(secs * 13) * h;
      jawAdd = 0.14 * Math.abs(Math.sin(secs * 13)) * h;
      headY = -0.18 * bell(k, 0.72, 0.78, 0.86, 0.92);
      break;
    }
    case 'snakeoil': {
      const h = bell(k, 0.26, 0.33, 0.48, 0.55);
      headX = -0.55 * h;
      const sh = bell(k, 0.58, 0.62, 0.84, 0.94);
      headY = Math.sin(secs * 34) * 0.26 * sh;
      headZ = Math.sin(secs * 29 + 1) * 0.12 * sh;
      torsoZ = Math.sin(secs * 31) * 0.05 * sh;
      jawAdd = Math.abs(Math.sin(secs * 40)) * 0.18 * sh;
      break;
    }
    case 'bandage':
    case 'linen':
      headX = 0.38 * bell(k, 0.12, 0.25, 0.86, 0.96);
      headY = -0.28 * bell(k, 0.12, 0.25, 0.86, 0.96);
      if (u.kind === 'linen') headX += 0.12 * bell(k, 0.84, 0.88, 0.92, 0.98);
      break;
    case 'dynamite': {
      const coil = smooth(seg(k, 0.42, 0.58)) * (1 - easeOutCubic(seg(k, 0.58, 0.66)));
      const rel = easeOutCubic(seg(k, 0.58, 0.68)) * (1 - smooth(seg(k, 0.82, 1)));
      torsoY = -0.38 * coil + 0.34 * rel;
      torsoX = -0.06 * coil + 0.16 * rel;
      const look = bell(k, 0.18, 0.28, 0.42, 0.5);
      headY = 0.3 * look;
      headX = 0.08 * look;
      break;
    }
    case 'charm': {
      headX = 0.28 * bell(k, 0.2, 0.34, 0.72, 0.8) - 0.32 * bell(k, 0.74, 0.8, 0.88, 0.96);
      break;
    }
    case 'dagger':
      headX = 0.32 * bell(k, 0.18, 0.3, 0.6, 0.72);
      headY = -0.22 * bell(k, 0.18, 0.3, 0.6, 0.72);
      jawAdd = 0.12 * bell(k, 0.48, 0.5, 0.56, 0.64);
      break;
    case 'smoke': {
      const slam = bell(k, 0.42, 0.5, 0.62, 0.8);
      torsoX = 0.26 * slam;
      headX = 0.3 * slam - 0.15 * bell(k, 0.22, 0.32, 0.38, 0.44);
      break;
    }
    case 'shield':
      headX = 0.14 * bell(k, 0.16, 0.26, 0.42, 0.5) + 0.3 * bell(k, 0.5, 0.56, 0.66, 0.74);
      headY = 0.16 * bell(k, 0.5, 0.56, 0.66, 0.74);
      break;
  }
  if (torsoX || torsoY || torsoZ) {
    torso.rotateX(torsoX * w);
    torso.rotateY(torsoY * w);
    torso.rotateZ(torsoZ * w);
  }
  if (head && (headX || headY || headZ)) {
    head.rotateY(headY * w);
    head.rotateX(headX * w);
    head.rotateZ(headZ * w);
  }
  if (jaw) {
    jaw.rotation.x += jawAdd * w - u.jawPrev * Math.exp(-18 * I.dt);
    u.jawPrev = jawAdd * w;
  }
  rig.root.updateMatrixWorld(true);
  _inv.copy(torso.matrixWorld).invert();
  const toT = (o: THREE.Object3D | undefined, out: THREE.Vector3, dx = 0, dy = 0, dz = 0) => {
    if (!o) return out.set(0, 0.5, 0.3);
    return o.getWorldPosition(out).applyMatrix4(_inv).add(_v.set(dx, dy, dz));
  };
  const mouth = toT(rig.sockets['mouth'] ?? head, A);
  const hip = B.set(SL.x - 0.05, SL.y - 0.47, SL.z + 0.09);

  // ---------------- right arm presents the gun forearm (bandage, linen, dagger)
  let wR = 0;
  if (u.kind === 'bandage' || u.kind === 'linen' || u.kind === 'dagger') {
    wR = w * smooth(seg(k, 0.04, 0.16));
    TR.set(SR.x + 0.13, SR.y - (u.kind === 'dagger' ? 0.22 : 0.27), SR.z + 0.31);
    ik(armR, foreR, SR, TR, POLE_R, u.l1, u.l2, HINT_UP, wR);
    armR?.updateMatrixWorld(true);
  }
  // the gun forearm's middle (where the wrap goes / the blade cuts)
  const foreMid = C;
  if (foreR) {
    foreR.getWorldPosition(_w);
    (rig.sockets['hand_r'] ?? foreR).getWorldPosition(_x);
    foreMid.copy(_w).lerp(_x, 0.42).applyMatrix4(_inv);
  } else foreMid.set(-0.1, 0.15, 0.35);

  // ---------------- left hand target + prop orientation (torso-local directions)
  let pole = POLE_L, hint = HINT_FWD;
  const pDir = _y.set(0, 1, 0), pUp = _z.set(0, 0, 1);
  let spin = 0, scale = 1;
  switch (u.kind) {
    case 'whiskey':
    case 'snakeoil': {
      const sw = u.kind === 'snakeoil';
      const up0 = sw ? 0.08 : 0.12, at0 = sw ? 0.2 : 0.3, hold1 = sw ? 0.5 : 0.62, toss = sw ? 0.56 : 0.7;
      const tilt = lerp(0.25, sw ? 0.95 : 1.05, smooth(seg(k, at0, hold1 - 0.06)));
      // neck into the mouth, bottom raised as he drinks
      const nd = D.set(-0.15, -Math.sin(tilt), -Math.cos(tilt)).normalize();
      const atMouth = _x.copy(mouth).addScaledVector(nd, -0.11);
      if (k < up0) T.copy(hip);
      else if (k < at0) T.copy(hip).lerp(atMouth, easeInOutSine(seg(k, up0, at0)));
      else if (k < hold1) T.copy(atMouth);
      else if (k < toss) T.copy(atMouth).lerp(_w.set(SL.x - 0.08, SL.y - 0.12, SL.z + 0.3), smooth(seg(k, hold1, toss)));
      else if (!sw) {
        // wipe the mask with the back of the hand, his right to his left
        const s = easeInOutSine(seg(k, 0.74, 0.9));
        T.copy(mouth).add(_w.set(lerp(-0.09, 0.1, s), -0.02, 0.075));
        hint = HINT_FWD;
      } else T.set(SL.x + 0.1, SL.y - 0.2, SL.z + 0.26); // a fist clenched through the shiver
      if (k >= at0 && k < toss) pDir.copy(nd).negate();
      else pDir.set(0.1, 1, 0.25);
      pUp.set(0, 0, 1);
      pole = POLE_L;
      if (k > 0.04 && k < at0) hint = HINT_IN;
      break;
    }
    case 'bandage':
    case 'linen': {
      const turns = u.kind === 'linen' ? 3.5 : 3;
      const a0 = 0.2, a1 = u.kind === 'linen' ? 0.78 : 0.76;
      // forearm axis (torso space) to wind around
      const fa = _w.set(0.55, 0.15, 0.35).normalize();
      if (foreR && rig.sockets['hand_r']) {
        foreR.getWorldPosition(_x).applyMatrix4(_inv);
        rig.sockets['hand_r'].getWorldPosition(D).applyMatrix4(_inv);
        fa.copy(D).sub(_x).normalize();
      }
      const e1 = _x.set(0, 1, 0).addScaledVector(fa, -fa.y).normalize();
      const e2 = D.crossVectors(fa, e1);
      if (k < a0) T.copy(hip).lerp(_v.copy(foreMid).addScaledVector(e1, 0.08), easeInOutSine(seg(k, 0.08, a0)));
      else if (k < a1) {
        const ph = seg(k, a0, a1) * TAU * turns;
        T.copy(foreMid).addScaledVector(fa, lerp(0.05, -0.04, seg(k, a0, a1))).addScaledVector(e1, Math.cos(ph) * 0.08).addScaledVector(e2, Math.sin(ph) * 0.08);
      } else if (k < 0.86) T.copy(foreMid).addScaledVector(e1, 0.08).addScaledVector(fa, -0.09 * easeOutBack(seg(k, a1, 0.84), 2));
      else T.copy(foreMid).addScaledVector(e1, 0.06);
      pDir.copy(fa);
      pUp.copy(e1);
      scale = lerp(1, 0.5, seg(k, a0, a1));
      pole = POLE_L;
      break;
    }
    case 'dynamite': {
      const eye = toT(rig.sockets['eye_l'] ?? head, _x);
      const atEye = _v.copy(eye).add(D.set(0.03, -0.13, 0.1));
      const cock = _w.set(SL.x + 0.06, SL.y + 0.17, SL.z - 0.22);
      const aim = D.copy(I.aimPoint).applyMatrix4(_inv).sub(SL).normalize();
      const relP = TR.copy(SL).addScaledVector(aim, 0.5);
      relP.y += 0.06;
      if (k < 0.14) T.copy(hip);
      else if (k < 0.32) T.copy(hip).lerp(atEye, easeInOutSine(seg(k, 0.14, 0.32)));
      else if (k < 0.44) T.copy(atEye);
      else if (k < 0.58) T.copy(atEye).lerp(cock, easeInOutSine(seg(k, 0.44, 0.58)));
      else if (k < 0.64) T.copy(cock).lerp(relP, easeInCubic(seg(k, 0.58, 0.64)));
      else T.copy(relP).lerp(_v.set(SL.x - 0.3, SL.y - 0.36, SL.z + 0.24), easeOutCubic(seg(k, 0.64, 0.86)));
      if (k < 0.5) pDir.copy(eye).sub(T).normalize(); // fuse to the eye
      else pDir.set(0, 0.4, -1).normalize();
      pUp.set(0, 0, 1);
      pole = k < 0.6 ? POLE_L : _v.set(0.7, -0.7, -0.3);
      break;
    }
    case 'charm': {
      const face = _w.copy(mouth).add(D.set(0.02, 0.07, 0.2));
      const chest = _x.set(SL.x - 0.16, SL.y - 0.14, SL.z + 0.2);
      if (k < 0.18) T.copy(chest);
      else if (k < 0.36) T.copy(chest).lerp(face, easeInOutSine(seg(k, 0.18, 0.36)));
      else if (k < 0.74) {
        const ph = secs * 9 * TAU * 0.25;
        T.copy(face).add(D.set(Math.cos(ph) * 0.012, Math.sin(ph) * 0.012, 0));
      } else if (k < 0.86) T.copy(face).lerp(_v.set(SL.x - 0.06, SL.y + 0.42, SL.z + 0.26), easeOutBack(seg(k, 0.74, 0.84), 1.6));
      else T.set(SL.x - 0.06, SL.y + 0.42, SL.z + 0.26);
      pDir.set(0, 1, 0);
      pUp.copy(mouth).sub(T).normalize();
      if (u.gem) u.gem.scale.setScalar(1 + 0.45 * bell(k, 0.36, 0.5, 0.8, 0.95) * (0.6 + 0.4 * Math.sin(secs * 22)));
      hint = HINT_FWD;
      break;
    }
    case 'dagger': {
      const above = _w.copy(foreMid).add(D.set(0.07, 0.1, 0.05));
      if (k < 0.18) T.copy(hip);
      else if (k < 0.42) T.copy(hip).lerp(above, easeInOutSine(seg(k, 0.18, 0.42)));
      else if (k < 0.52) T.copy(foreMid).add(D.set(lerp(0.08, -0.11, easeInCubic(seg(k, 0.42, 0.52))), lerp(0.05, -0.01, seg(k, 0.42, 0.52)), 0.06));
      else if (k < 0.76) T.copy(foreMid).add(D.set(-0.11 + 0.15 * smooth(seg(k, 0.52, 0.76)), 0.12 * Math.sin(seg(k, 0.52, 0.76) * Math.PI), 0.08));
      else T.copy(foreMid).add(D.set(0.04, 0.06, 0.08)).lerp(hip, easeInOutSine(seg(k, 0.76, 0.92)));
      pDir.set(-0.8, 0.1, 0.6).normalize();
      pUp.set(0, 1, 0);
      spin = easeOutCubic(seg(k, 0.55, 0.74)) * TAU;
      break;
    }
    case 'smoke': {
      const high = _w.set(SL.x + 0.06, SL.y + 0.3, SL.z + 0.05);
      const low = _x.set(SL.x - 0.02, SL.y - 0.62, SL.z + 0.34);
      if (k < 0.12) T.copy(hip);
      else if (k < 0.4) T.copy(hip).lerp(high, easeInOutSine(seg(k, 0.12, 0.4)));
      else if (k < 0.5) T.copy(high).lerp(low, easeInCubic(seg(k, 0.4, 0.5)));
      else T.copy(low).lerp(_v.set(SL.x + 0.05, SL.y - 0.4, SL.z + 0.2), smooth(seg(k, 0.55, 0.85)));
      pole = _v.set(0.7, -0.5, -0.4);
      break;
    }
    case 'shield': {
      const show = _w.set(SL.x - 0.06, SL.y + 0.1, SL.z + 0.34);
      const chestL = _x.set(0.1, 0.25, 0.33);
      if (k < 0.16) T.copy(hip);
      else if (k < 0.42) T.copy(hip).lerp(show, easeInOutSine(seg(k, 0.16, 0.36)));
      else if (k < 0.58) T.copy(show).lerp(chestL, easeInCubic(seg(k, 0.42, 0.58)));
      else T.copy(chestL).add(D.set(0, 0, 0.025 * Math.abs(Math.sin(seg(k, 0.58, 0.72) * Math.PI * 2))));
      pDir.set(0, 1, 0);
      pUp.set(0, 0, 1);
      spin = easeOutCubic(seg(k, 0.2, 0.42)) * TAU;
      hint = HINT_FWD;
      break;
    }
  }
  ik(armL, foreL, SL, T, pole, u.l1, u.l2, hint, w);
  foreL.updateMatrixWorld(true);

  // the gun wrist stops correcting toward the aim while the gun arm is posed
  if (wR > 0) {
    const a = anim as { armActR?: number };
    a.armActR = Math.max(a.armActR ?? 0, wR);
  }

  // ---------------- the prop in the hand
  const grabK = seq.ev[0][0];
  const goneAt = u.kind === 'dynamite' ? 0.63 : u.kind === 'whiskey' ? 0.7 : u.kind === 'snakeoil' ? 0.56 : u.kind === 'smoke' ? 0.5 : u.kind === 'shield' ? 0.6 : 0.9;
  const vis = k >= grabK && k < goneAt;
  u.prop.visible = vis;
  if (vis) {
    const pop = easeOutBack(clamp01((k - grabK) / 0.06), 2);
    u.prop.scale.setScalar(Math.max(0.01, pop * scale));
    // world orientation: model +Y along pDir, model +Z toward pUp (torso space -> world)
    torso.getWorldQuaternion(_qs);
    _y.copy(pDir).applyQuaternion(_qs).normalize();
    _z.copy(pUp).applyQuaternion(_qs);
    _z.addScaledVector(_y, -_z.dot(_y));
    if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
    _z.normalize();
    _x.crossVectors(_y, _z);
    _b.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_b);
    if (spin) _q.multiply(_qa.setFromAxisAngle(_v.set(0, 1, 0), spin));
    const hand = u.prop.parent!;
    hand.getWorldQuaternion(_qb);
    u.prop.quaternion.copy(_qb.invert().multiply(_q));
    u.prop.position.set(-0.004, -0.01, 0.045);
  }

  // ---------------- events
  const evs = seq.ev;
  while (u.fired < evs.length && k >= evs[u.fired][0]) {
    const e = evs[u.fired][1];
    u.fired++;
    const at = u.prop.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3();
    if (e === 'release') dir.copy(I.aimPoint).sub(at).normalize();
    else if (e === 'toss') dir.set(0.4, 0.9, -0.6).applyQuaternion(torso.getWorldQuaternion(_qs)).normalize();
    else if (e === 'cut') at.copy(foreMid).applyMatrix4(torso.matrixWorld);
    if (e === 'wrapped' && foreR) {
      const wm = forearmWrapModel(u.kind === 'linen' ? 'embalm' : 'trail');
      const mesh = voxelMesh(wm.model, wm.voxelSize, wm.pivot, u.prop.children[0] instanceof THREE.Mesh ? (u.prop.children[0].material as THREE.Material) : undefined);
      foreR.add(mesh);
      const st2 = live.get(rig)!;
      for (const l of st2.linger.filter((x) => x.obj.parent === foreR)) l.until = Math.min(l.until, st2.clock);
      st2.linger.push({ obj: mesh, until: st2.clock + 9 });
    }
    u.on(e, at, dir, u.prop);
  }
  if (k >= 1) {
    finishUse(u, rig);
    u.on('done', u.prop.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(), u.prop);
  }
}

/** two-bone IK for one arm in torso space, blended by w */
function ik(arm: THREE.Object3D | undefined, fore: THREE.Object3D | undefined, S: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, l1: number, l2: number, hint: THREE.Vector3, w: number) {
  if (!arm || !fore || w <= 0.001) return;
  armIK(S, target, pole, l1, l2, hint, _qa, _qb);
  arm.quaternion.slerp(_qa, w);
  fore.quaternion.slerp(_qb, w);
}
