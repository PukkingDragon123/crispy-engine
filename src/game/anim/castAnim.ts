// Skill cast poses, layered over the riding animation (playerAnim) for the
// skill actions only — playerAnim is untouched; Player.animate calls apply()
// right after the action layer and before playerAnim.finish().
//
//  grenade  the Dung Bomb: an overhand throw with the free (left) arm — coil the
//           shoulder back with the ball cocked behind the skull, lean back, whip
//           it over the top, follow through down across the body.
//  flick    the Scorpion Toss: an underhand flick — swing low and back, scoop
//           forward and up, a snap of the wrist, the arm floats up after it.
//  whistle  the Scarab Swarm: two fingers to the teeth, chin up, the whistle,
//           then a sharp point at the prey ("go!").
//
// Hand targets are solved with playerAnim's two-bone arm IK in the torso frame,
// blended over whatever the base pose was, so it eases in and out cleanly.
import * as THREE from 'three';
import type { RigInstance } from '../../engine/voxel/Rig';
import { armIK } from './playerAnim';
import { smooth, easeInCubic, easeOutCubic, easeInOutSine } from './math';

export type CastPose = 'grenade' | 'flick' | 'whistle';
/** action length (s) of each pose and the share of it where the thing leaves the hand / the whistle sounds */
export const CAST_POSE: Record<CastPose, { dur: number; release: number }> = {
  grenade: { dur: 0.6, release: 0.47 },
  flick: { dur: 0.46, release: 0.42 },
  whistle: { dur: 1.0, release: 0.24 },
};

const _T = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const HINT = new THREE.Vector3(0, 0.4, 1);
/** where the fingers go for the whistle: at the teeth, in the head's frame (m) */
const MOUTH = new THREE.Vector3(0.03, 0.1, 0.27);

export class CastAnim {
  private ok = false;
  /** left shoulder and neck in the torso frame, arm bone lengths, body scale (as playerAnim measures them) */
  private SL = new THREE.Vector3(0.222, 0.361, 0.125);
  private neck = new THREE.Vector3(0, 0.458, 0.083);
  private l1 = 0.25;
  private l2 = 0.25;
  private sc = 1;

  init(rig: RigInstance) {
    const off = (name: string) => rig.geo.parts.find((p) => p.name === name)?.offset;
    const al = off('arm_l'), fo = off('fore_l'), hd = off('head'), sh = off('shin_l'), pel = off('pelvis'), th = off('thigh_l');
    if (al) this.SL.copy(al);
    if (fo) this.l1 = fo.length();
    const hs = rig.geo.sockets['hand_l'];
    if (hs) this.l2 = hs.offset.length();
    if (hd) this.neck.copy(hd);
    if (sh && pel && th) this.sc = (sh.length() + Math.max(0.1, pel.y + th.y + sh.y)) / 0.667;
    this.ok = !!(rig.nodes['arm_l'] && rig.nodes['fore_l'] && rig.nodes['torso']);
  }

  /** is this one of ours? */
  static owns(name: string | undefined): name is CastPose {
    return name === 'grenade' || name === 'flick' || name === 'whistle';
  }

  /**
   * Pose the cast. `k` 0..1 through the action, `aimWorld` where it is thrown /
   * pointed, `t` the anim clock (tremble). Returns false if it isn't a cast pose.
   */
  apply(rig: RigInstance, name: string, k: number, aimWorld: THREE.Vector3, t: number) {
    if (!this.ok || !CastAnim.owns(name)) return false;
    const n = rig.nodes;
    const torso = n['torso'], arm = n['arm_l'], fore = n['fore_l'], head = n['head'];
    const S = this.SL, sc = this.sc;
    // blend in quickly, out over the tail
    const w = smooth(k / 0.1) * smooth((1 - k) / (name === 'whistle' ? 0.16 : 0.2));
    let twist = 0, lean = 0, nod = 0;
    // ---- body: coil / uncoil the torso before solving the arm in its frame
    if (name === 'grenade') {
      const coil = k < 0.4 ? easeInOutSine(k / 0.4) : 1 - easeOutCubic((k - 0.4) / 0.16);
      const thru = smooth((k - 0.42) / 0.2);
      twist = 0.55 * coil - 0.45 * thru;
      lean = -0.22 * coil + 0.3 * thru;
    } else if (name === 'flick') {
      const back = k < 0.36 ? easeInOutSine(k / 0.36) : 1 - smooth((k - 0.36) / 0.14);
      const thru = smooth((k - 0.38) / 0.2);
      twist = 0.3 * back - 0.25 * thru;
      lean = 0.2 * back - 0.08 * thru;
    } else {
      const up = smooth(k / 0.18) * (1 - smooth((k - 0.68) / 0.1));
      nod = -0.2 * up;
      lean = -0.06 * up + 0.14 * smooth((k - 0.7) / 0.12);
      twist = -0.18 * smooth((k - 0.7) / 0.12);
    }
    if (torso) {
      torso.rotateY(twist * w);
      torso.rotateX(lean * w);
      // the whistle tips the chin up before the hand finds the mouth
      if (head && nod) head.rotateX(nod * w);
      torso.updateMatrixWorld(true);
    }
    // the aim point in the torso frame (where the arm throws / points)
    if (!torso || !arm || !fore) return false;
    _inv.copy(torso.matrixWorld).invert();
    const dir = _aim.copy(aimWorld).applyMatrix4(_inv).sub(S);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const T = _T;
    if (name === 'grenade') {
      // cocked behind the skull → whipped over the top → down across the body
      const cock = _a.set(S.x + 0.04 * sc, S.y + 0.24 * sc, S.z - 0.3 * sc);
      const rel = _b.copy(S).addScaledVector(dir, 0.5 * sc);
      rel.y += 0.2 * sc;
      if (k < 0.4) T.lerpVectors(_T.set(S.x + 0.15 * sc, S.y - 0.36 * sc, S.z + 0.05 * sc), cock, easeInOutSine(k / 0.4));
      else if (k < 0.5) T.lerpVectors(cock, rel, easeInCubic((k - 0.4) / 0.1));
      else {
        const fol = _a.set(S.x - 0.3 * sc, S.y - 0.38 * sc, S.z + 0.3 * sc);
        T.lerpVectors(rel, fol, easeOutCubic((k - 0.5) / 0.28));
      }
      _pole.set(0.6, k < 0.45 ? 0.9 : -0.6, k < 0.45 ? -0.3 : -0.4);
    } else if (name === 'flick') {
      // low and back → scooped forward and up → floats up after the release
      const low = _a.set(S.x + 0.12 * sc, S.y - 0.46 * sc, S.z - 0.26 * sc);
      const rel = _b.copy(S).addScaledVector(dir, 0.46 * sc);
      rel.y -= 0.08 * sc;
      if (k < 0.36) T.lerpVectors(_T.set(S.x + 0.14 * sc, S.y - 0.42 * sc, S.z + 0.06 * sc), low, easeInOutSine(k / 0.36));
      else if (k < 0.46) {
        const u = (k - 0.36) / 0.1;
        T.lerpVectors(low, rel, easeInCubic(u));
        T.y -= Math.sin(u * Math.PI) * 0.1 * sc; // the scoop
      } else {
        const fol = _a.copy(S).addScaledVector(dir, 0.4 * sc);
        fol.y += 0.22 * sc;
        T.lerpVectors(rel, fol, easeOutCubic((k - 0.46) / 0.3));
      }
      _pole.set(0.7, -0.8, -0.2);
    } else {
      // two fingers to the teeth (just in front of the jaw), a tremble while it shrills, then the point
      // the teeth, found in the head's own frame (it may be turned off the torso), into the torso frame
      const mouth = head ? head.localToWorld(_a.copy(MOUTH)).applyMatrix4(_inv) : _a.set(this.neck.x + 0.03 * sc, this.neck.y + 0.1 * sc, this.neck.z + 0.21 * sc);
      const tremble = k > 0.2 && k < 0.66 ? Math.sin(t * 46) * 0.006 * sc : 0;
      mouth.y += tremble;
      const point = _b.copy(S).addScaledVector(dir, 0.55 * sc);
      point.y += 0.06 * sc;
      const rest = _T.set(S.x + 0.14 * sc, S.y - 0.4 * sc, S.z + 0.08 * sc);
      if (k < 0.18) T.lerpVectors(rest, mouth, easeOutCubic(k / 0.18));
      else if (k < 0.68) T.copy(mouth);
      else T.lerpVectors(mouth, point, easeOutCubic((k - 0.68) / 0.12));
      _pole.set(1, k < 0.68 ? -0.35 : -0.6, k < 0.68 ? -0.2 : -0.3);
    }
    armIK(S, T, _pole, this.l1, this.l2, HINT, _qa, _qb);
    arm.quaternion.slerp(_qa, w);
    fore.quaternion.slerp(_qb, w);
    arm.updateMatrixWorld(true);
    return true;
  }
}
