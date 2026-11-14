// Ra's burning of the Nile valley: one shared uniform read by the terrain (charred
// ground, glowing crack nets, the fire front), the river (water turning to lava)
// and the CPU queries (heat, lava physics). The burn spreads outward from an origin
// as a ragged front; amount 0 = untouched, 1 = burned wherever the front has passed.
import * as THREE from 'three';

/** x, z: origin (m); y: front radius (m); w: amount (0..1) */
export const BURN = { value: new THREE.Vector4(0, 0, 0, 0) };

/** reset for every world that is not the burning Nile (the desert, the hub...) */
export function resetBurn() {
  BURN.value.set(0, 0, 0, 0);
}

/** GLSL: `burnMask(xz)` (ragged front, for colour) and `burnSmooth(xz)` (no jitter, matches burnAt on the CPU) */
export const BURN_GLSL = /* glsl */ `
uniform vec4 uBurn;
float burnH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float burnVN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(burnH(i), burnH(i + vec2(1.0, 0.0)), f.x), mix(burnH(i + vec2(0.0, 1.0)), burnH(i + vec2(1.0, 1.0)), f.x), f.y); }
float burnSmooth(vec2 p) {
  if (uBurn.w <= 0.0) return 0.0;
  return uBurn.w * (1.0 - smoothstep(uBurn.z - 16.0, uBurn.z, distance(p, uBurn.xy)));
}
float burnMask(vec2 p) {
  if (uBurn.w <= 0.0) return 0.0;
  float d = distance(p, uBurn.xy) + (burnVN(p * 0.045) - 0.5) * 34.0 + (burnVN(p * 0.21) - 0.5) * 7.0;
  return uBurn.w * (1.0 - smoothstep(uBurn.z - 16.0, uBurn.z, d));
}
/** 0..1: how close a point is to the advancing fire front (flames, the brightest cracks) */
float burnFront(vec2 p) {
  if (uBurn.w <= 0.0 || uBurn.w >= 0.999 && uBurn.z > 5000.0) return 0.0;
  float d = distance(p, uBurn.xy) + (burnVN(p * 0.045) - 0.5) * 34.0 + (burnVN(p * 0.21) - 0.5) * 7.0;
  return (1.0 - smoothstep(0.0, 22.0, abs(d - uBurn.z + 6.0))) * uBurn.w;
}`;

/** CPU twin of burnSmooth */
export function burnAt(x: number, z: number) {
  const b = BURN.value;
  if (b.w <= 0) return 0;
  const d = Math.hypot(x - b.x, z - b.y);
  const t = Math.min(1, Math.max(0, (d - (b.z - 16)) / 16));
  return b.w * (1 - t * t * (3 - 2 * t));
}
