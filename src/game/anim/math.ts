// Procedural animation math: easing curves, smooth value noise for fidgets and
// handheld sway, frame-rate independent smoothing. Allocation-free.

export const PI = Math.PI;
export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const remap = (v: number, a: number, b: number) => clamp01((v - a) / (b - a || 1e-6));

/** cubic smoothstep */
export const smooth = (t: number) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};
/** quintic smootherstep */
export const smoother = (t: number) => {
  t = clamp01(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t: number) => Math.pow(clamp01(t), 3);
export const easeInOutSine = (t: number) => 0.5 - 0.5 * Math.cos(PI * clamp01(t));
/** overshoots past 1 then settles (follow-through) */
export const easeOutBack = (t: number, s = 1.70158) => {
  t = clamp01(t) - 1;
  return 1 + (s + 1) * t * t * t + s * t * t;
};
/** dips below 0 before rising (anticipation) */
export const easeInBack = (t: number, s = 1.70158) => {
  t = clamp01(t);
  return (s + 1) * t * t * t - s * t * t;
};
/** damped wobble that ends at 0: amplitude 1 at t=0 */
export const wobble = (t: number, freq = 3, decay = 4) => Math.exp(-decay * t) * Math.cos(TAU * freq * t);

/** frame-rate independent exponential approach (lambda ~ 1/response time) */
export const damp = (cur: number, target: number, lambda: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

export function wrapAngle(a: number) {
  while (a > PI) a -= TAU;
  while (a < -PI) a += TAU;
  return a;
}

// ------------------------------------------------------------------ noise
function h1(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
/** smooth 1D value noise in [-1, 1] (cubic interpolation) */
export function vnoise(x: number, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = h1(i + seed * 57.3), b = h1(i + 1 + seed * 57.3);
  return (a + (b - a) * u) * 2 - 1;
}
/** two octaves: organic drift for idle sway / handheld feel */
export function fbm(x: number, seed = 0) {
  return vnoise(x, seed) * 0.66 + vnoise(x * 2.13 + 7.7, seed + 3) * 0.34;
}
