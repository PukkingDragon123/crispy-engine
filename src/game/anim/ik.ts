// Analytic two-bone IK in a joint's sagittal plane, plus look-at with clamps.
// Rig convention: limbs hang along -Y, character faces +Z. A positive X
// rotation swings a hanging limb backward; negative swings it forward.

export interface TwoBone {
  /** rotation for the upper bone (thigh/upper arm) about X */
  upper: number;
  /** rotation for the lower bone (shin/forearm) about X, relative to the upper */
  lower: number;
  /** true when the target was out of reach */
  stretched: boolean;
}

const _ik: TwoBone = { upper: 0, lower: 0, stretched: false };

/**
 * Solve a planar two-bone chain hanging down from its root.
 * fwd: target forward offset (+Z), down: target distance below the root (positive).
 * bend: +1 = joint points forward (human knee), -1 = joint points backward (elbow, hock).
 */
export function twoBoneIK(l1: number, l2: number, fwd: number, down: number, bend = 1, out: TwoBone = _ik): TwoBone {
  const d0 = Math.hypot(fwd, down);
  const maxD = (l1 + l2) * 0.9995;
  const minD = Math.abs(l1 - l2) + 1e-4;
  const d = d0 > maxD ? maxD : d0 < minD ? minD : d0;
  out.stretched = d0 > maxD;
  // angle of the target direction from straight down (forward positive)
  const th = Math.atan2(fwd, down);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const a = Math.acos(cosA < -1 ? -1 : cosA > 1 ? 1 : cosA);
  const cosK = (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2);
  const k = Math.PI - Math.acos(cosK < -1 ? -1 : cosK > 1 ? 1 : cosK);
  // forward swing is a negative X rotation in this rig convention
  out.upper = -(th + a * bend);
  out.lower = k * bend;
  return out;
}

export interface LookResult {
  yaw: number;
  pitch: number;
}
const _look: LookResult = { yaw: 0, pitch: 0 };

/** yaw/pitch to face a local-space direction (x right/left, y up, z forward), clamped */
export function lookAngles(x: number, y: number, z: number, maxYaw: number, maxPitch: number, out: LookResult = _look) {
  const yaw = Math.atan2(x, Math.max(1e-4, z));
  const pitch = Math.atan2(y, Math.hypot(x, z));
  out.yaw = yaw > maxYaw ? maxYaw : yaw < -maxYaw ? -maxYaw : yaw;
  out.pitch = pitch > maxPitch ? maxPitch : pitch < -maxPitch ? -maxPitch : pitch;
  return out;
}
