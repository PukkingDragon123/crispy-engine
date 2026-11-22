// THE VESSELS: health and stamina as living liquids in blown-glass reliquaries (bottom left of the HUD).
//
//  • SOUL VESSEL (health): a long glass phial caged in gilt straps, its mouth a gold-and-lapis medallion in
//    which the beating 3D heart sits (Hud3D places the heart on it: the heart pumps the soul in). Inside,
//    luminous soul liquid (aqua to white, violet in the deeps) with a rolling surface and a rounded leading
//    front that surges and recoils; soul currents stream through it, small ghostly wisps swim in it (no
//    faces) and soul motes rise off the surface and drift up out of the glass. A hit splashes it, leaks a
//    burst of motes and lets the wisp nearest the front escape; the drained part keeps a dissolving ghost
//    trail for a moment. Healing sends a bright pulse out of the heart along the liquid and motes stream in.
//    Low on soul: the liquid reddens and pulses, hairline cracks run into the glass. A shield is a pale ward
//    that crackles along the glass.
//  • VENOM VESSEL (stamina): a slimmer phial of acid-green scorpion venom, its stopper a bone telson with a
//    curled stinger (a drop gathers on the tip and falls), a cork at the far end leaking green fumes. The
//    venom bubbles, and boils hard while it is being spent; it drains and refills visibly, and runs dry
//    with a red flash and a shake ('staminaEmpty').
// Each vessel is one quad in the 3D HUD layer drawn by a shader on the HUD's own pixel grid (crisp pixel art,
// ordered dither, a dark ink outline, no glow), so it reads as part of the 2D UI while the liquid moves at
// full frame rate. The liquid's surface is a small CPU wave sim (columns on springs) fed by hits, heals and
// the rider's acceleration; the wisps and particles are CPU sims passed in as uniforms.
import * as THREE from 'three';

export type VesselKind = 'soul' | 'venom';

/** where a vessel sits (HUD px) and what it holds: Hud lays these out, Hud3D draws them */
export interface VesselAnchor {
  /** the left edge of the whole piece and the tube's centre line */
  x: number;
  cy: number;
  /** the glass tube's length */
  len: number;
  /** 0..1 held */
  frac: number;
  /** the damage trail (fraction, soul) */
  trail?: number;
  /** a shield over the soul (0..1 of the length) */
  shield?: number;
  /** the rider's speed (m/s): the liquid sloshes when it changes */
  speed?: number;
  /** counts up on every 'staminaEmpty' (venom) */
  empty?: number;
  /** 0..1 shake (the HUD's hit shake) */
  shake?: number;
}

/** layout of each vessel along its length (HUD px): tube start offset from x, the far cap's length */
export const VESSEL = {
  soul: { R: 7, RS: 12, lead: 24, tail: 12 },
  venom: { R: 5, RS: 0, lead: 13, tail: 7 },
} as const;
/** the whole piece's width (HUD px) */
export const vesselWidth = (k: VesselKind, len: number) => VESSEL[k].lead + len + VESSEL[k].tail;
/** the soul vessel's medallion (HUD px): the heart sits on it */
export const soulSocket = (x: number, cy: number) => ({ x: x + VESSEL.soul.RS + 1, y: cy, r: VESSEL.soul.RS });

const NW = 40, NP = 26, NWS = 7;

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */ `
#define NW ${NW}
#define NP ${NP}
#define NWS ${NWS}
uniform vec2 uSize;
uniform vec4 uTube;  // x0, x1, cy, R (quad px)
uniform vec2 uSpan;  // where the visible liquid starts and ends
uniform vec4 uSock;  // medallion centre, radius, heartbeat
uniform float uKind, uTime, uFront, uTrail, uLevel, uLean, uShield, uHurt, uLow, uFlash, uPulse, uCracks;
uniform float uWave[NW];
uniform vec4 uWisp[NWS];
uniform float uWispA[NWS];
uniform vec4 uPart[NP];
uniform float uPartK[NP];
varying vec2 vUv;

const vec3 INK = vec3(26.0, 14.0, 8.0) / 255.0;
const vec3 VOID = vec3(12.0, 8.0, 6.0) / 255.0;
const vec3 G_O = vec3(46.0, 28.0, 6.0) / 255.0;
const vec3 G_D = vec3(138.0, 92.0, 22.0) / 255.0;
const vec3 G_M = vec3(204.0, 150.0, 44.0) / 255.0;
const vec3 G_L = vec3(242.0, 198.0, 86.0) / 255.0;
const vec3 G_H = vec3(255.0, 246.0, 196.0) / 255.0;
const vec3 LP_D = vec3(20.0, 28.0, 58.0) / 255.0;
const vec3 LP_M = vec3(40.0, 58.0, 122.0) / 255.0;
const vec3 LP_L = vec3(68.0, 104.0, 192.0) / 255.0;
const vec3 BN_D = vec3(150.0, 128.0, 96.0) / 255.0;
const vec3 BN_M = vec3(214.0, 196.0, 160.0) / 255.0;
const vec3 BN_L = vec3(240.0, 228.0, 200.0) / 255.0;
const vec3 BN_H = vec3(255.0, 250.0, 236.0) / 255.0;
const vec3 WD_D = vec3(70.0, 40.0, 20.0) / 255.0;
const vec3 WD_M = vec3(130.0, 80.0, 42.0) / 255.0;
const vec3 WD_L = vec3(170.0, 112.0, 58.0) / 255.0;
const vec3 GL_H = vec3(222.0, 240.0, 236.0) / 255.0;
const vec3 GL_M = vec3(150.0, 190.0, 186.0) / 255.0;
const vec3 GL_D = vec3(92.0, 124.0, 128.0) / 255.0;
const vec3 SKY_L = vec3(124.0, 243.0, 220.0) / 255.0;
const vec3 SKY_H = vec3(216.0, 255.0, 246.0) / 255.0;
const vec3 RED = vec3(188.0, 42.0, 30.0) / 255.0;

float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }

vec3 liq(float i){
  vec3 a, b, c, d, e;
  if (uKind < 0.5) { a = vec3(34.0, 22.0, 92.0); b = vec3(28.0, 82.0, 168.0); c = vec3(46.0, 160.0, 218.0); d = vec3(122.0, 232.0, 244.0); e = vec3(228.0, 255.0, 250.0); }
  else { a = vec3(24.0, 46.0, 12.0); b = vec3(58.0, 120.0, 22.0); c = vec3(112.0, 198.0, 34.0); d = vec3(190.0, 246.0, 80.0); e = vec3(240.0, 255.0, 182.0); }
  vec3 r = i < 0.5 ? a : i < 1.5 ? b : i < 2.5 ? c : i < 3.5 ? d : e;
  r /= 255.0;
  if (uKind < 0.5 && uLow > 0.0) {
    vec3 w = (i < 0.5 ? vec3(60.0, 12.0, 46.0) : i < 1.5 ? vec3(128.0, 22.0, 64.0) : i < 2.5 ? vec3(206.0, 54.0, 92.0) : i < 3.5 ? vec3(255.0, 126.0, 146.0) : vec3(255.0, 224.0, 226.0)) / 255.0;
    r = mix(r, w, uLow * (0.42 + 0.22 * sin(uTime * 9.0)));
  }
  if (uFlash > 0.0) r = mix(r, vec3(dot(r, vec3(0.33))) * vec3(0.8, 0.75, 0.6), uFlash * 0.8);
  if (uHurt > 0.0) r = mix(r, vec3(1.0, 0.97, 0.94), uHurt * 0.55);
  return r;
}
// a cylinder lying along x, lit from above: a palette step by the height across it (-1 top .. 1 bottom)
vec3 goldAt(float v){ return v < -0.6 ? G_H : v < -0.15 ? G_L : v < 0.45 ? G_M : G_D; }
vec3 boneAt(float v){ return v < -0.6 ? BN_H : v < -0.1 ? BN_L : v < 0.5 ? BN_M : BN_D; }

void main(){
  vec2 p = floor(vec2(vUv.x, 1.0 - vUv.y) * uSize);
  vec2 pc = p + 0.5;
  float t = uTime;
  bool soul = uKind < 0.5;
  vec4 col = vec4(0.0);
  float x0 = uTube.x, x1 = uTube.y, cy = uTube.z, R = uTube.w;
  float Ri = R - 1.0;
  float dy = pc.y - cy;
  float dT = sdSeg(pc, vec2(x0 + R, cy), vec2(x1 - R, cy)) - R;
  float len = x1 - x0;
  vec3 inkC = INK;
  if (soul && uLow > 0.0) inkC = mix(INK, RED, uLow * (0.5 + 0.5 * sin(t * 9.0)) * 0.7);
  if (uFlash > 0.0) inkC = mix(inkC, RED, uFlash);

  // ------------------------------------------------ the glass tube and what is in it
  if (dT <= 1.0) {
    bool ward = soul && uShield > 0.0 && pc.x < mix(uSpan.x, uSpan.y, uShield);
    if (dT > 0.0) {
      col = vec4(ward ? (h21(p + floor(t * 12.0)) > 0.9 ? SKY_H : SKY_L) : inkC, 1.0);
    } else if (dT > -1.0) {
      vec3 g = dy < -R * 0.45 ? GL_H : dy > R * 0.45 ? GL_D : GL_M;
      if (ward) g = dy < 0.0 ? SKY_H : SKY_L;
      if (uHurt > 0.5) g = vec3(1.0);
      col = vec4(g, 0.94);
    } else {
      // smoky glass, lit by the liquid where it spills light past the front
      vec3 bg = vec3(18.0, 13.0, 32.0) / 255.0;
      float spill = pc.x > uFront ? clamp(1.0 - (pc.x - uFront) / 7.0, 0.0, 1.0) : 0.0;
      if (bayer4(p) < spill * 0.55) bg = mix(bg, liq(1.0), 0.5);
      col = vec4(bg, 0.86);
      // the surface: the sim plus a gentle swell
      float u = clamp((pc.x - uSpan.x) / max(1.0, uSpan.y - uSpan.x), 0.0, 1.0) * float(NW - 1);
      int i0 = int(floor(u));
      int i1 = min(i0 + 1, NW - 1);
      float w = mix(uWave[i0], uWave[i1], fract(u));
      w += sin(pc.x * 0.37 + t * 2.6) * 0.45 + sin(pc.x * 0.13 - t * 1.7) * 0.35;
      float surf = uLevel + w;
      float bot = cy + Ri;
      float depth = max(1.0, bot - surf);
      float dd = pc.y - surf;
      // the rounded leading front; its crest leans with the flow
      float q = clamp((pc.y - (surf + bot) * 0.5) / (depth * 0.5), -1.0, 1.0);
      float front = uFront - (1.0 - sqrt(max(0.0, 1.0 - q * q))) * 2.4 + uLean * clamp(1.0 - dd / depth, 0.0, 1.0) * 2.6;
      if (dd >= 0.0 && pc.x < front) {
        float li;
        if (dd < 1.0) li = 4.0;
        else if (dd < 2.2) li = 3.0;
        else li = 2.0;
        if (pc.y > bot - 1.5) li = 1.0;
        if (li == 2.0) {
          // soul currents stream out of the heart; venom swirls
          float n = sin(pc.x * (soul ? 0.24 : 0.4) - t * (soul ? 3.2 : 1.6) + sin(pc.y * 0.9 + t * 1.3 + pc.x * 0.05) * 1.6);
          if (n > 0.82) li = 3.0;
          else if (n < -0.86 && dd > 3.0) li = 1.0;
          if (dd > depth * 0.66 && bayer4(p) < 0.5) li = min(li, 1.0);
          if (soul && dd > depth * 0.8) li = 0.0;
        }
        if (pc.x > front - 1.0 && li > 1.0) li = max(li, 3.0);
        if (uPulse > 0.0 && abs(pc.x - uPulse) < 1.6) li = 4.0;
        col = vec4(liq(li), 1.0);
      } else if (soul && dd >= 0.0 && pc.x >= front && pc.x < uTrail) {
        // the ghost of what was lost, dissolving
        float k = clamp((uTrail - pc.x) / max(1.0, uTrail - front), 0.0, 1.0);
        if (bayer4(p + floor(t * 7.0)) < 0.35 + 0.3 * k) col = vec4(liq(dd < 1.0 ? 3.0 : 1.0), 0.9);
      }
      // the wisps: a bright head and a fading, weaving tail
      if (soul) for (int i = 0; i < NWS; i++) {
        float a = uWispA[i];
        if (a < 0.02) continue;
        vec2 h = uWisp[i].xy, v = uWisp[i].zw;
        float sp = length(v);
        vec2 dir = sp > 0.01 ? v / sp : vec2(1.0, 0.0);
        vec2 nrm = vec2(-dir.y, dir.x);
        vec2 qq = pc - h;
        float al = -dot(qq, dir), ac = dot(qq, nrm);
        float L = 4.0 + min(3.0, sp * 0.15);
        if (al > -1.7 && al < L) {
          float k = clamp(al / L, 0.0, 1.0);
          ac -= sin(al * 1.3 - t * 10.0 + float(i) * 2.0) * 0.85 * k;
          float rad = mix(1.4, 0.4, k);
          if (abs(ac) < rad) {
            bool head = al < 1.0 && abs(ac) < 1.05;
            vec3 wc = head ? liq(4.0) : (k < 0.5 ? liq(3.0) : liq(2.0));
            if (bayer4(p) < a * (head ? 1.0 : 1.05 - k * 0.55)) col = vec4(wc, 1.0);
          }
        }
      }
      // glass: a broken highlight along the upper inside, a glint at the mouth, a soft bounce below
      float yTop = cy - Ri + 0.5;
      float rel = pc.x - x0;
      if (abs(pc.y - (yTop + 0.5)) < 0.5 && rel > R && rel < R + len * 0.5 && mod(rel, 19.0) < 12.0) col.rgb = mix(col.rgb, GL_H, 0.6);
      if (abs(pc.y - (yTop + 1.5)) < 0.5 && rel > R + 9.0 && rel < R + 15.0) col.rgb = mix(col.rgb, vec3(1.0), 0.55);
      if (abs(pc.y - (cy + Ri - 0.5)) < 0.5 && pc.x > x1 - R - 22.0 && pc.x < x1 - R - 6.0) col.rgb = mix(col.rgb, GL_M, 0.3);
      // a glint sweeps the glass now and then
      float g = mod(t * 22.0, len + 160.0) - 20.0;
      if (abs(rel - g + dy * 0.7) < 1.0) col.rgb = mix(col.rgb, vec3(1.0), 0.4);
      // hairline cracks run in from the top as the soul runs low
      if (soul) for (int k = 0; k < 3; k++) {
        if (uCracks <= float(k)) break;
        float fk = float(k);
        float cx = floor(x0 + len * (k == 0 ? 0.58 : k == 1 ? 0.31 : 0.8));
        float L = k == 0 ? 7.0 : k == 1 ? 5.0 : 9.0;
        float off = floor(sin(pc.y * 1.9 + fk * 2.1) * 1.3 + 0.5) + floor((pc.y - (cy - Ri)) * (k == 1 ? -0.4 : 0.35));
        if (pc.y < cy - Ri + L && p.x == cx + off) col = vec4(mix(col.rgb, vec3(0.94, 1.0, 0.98), 0.85), 1.0);
        else if (pc.y < cy - Ri + L - 1.0 && p.x == cx + off + 1.0) col.rgb *= 0.6;
      }
    }
  }

  // ------------------------------------------------ the gilt cage straps (soul: quarter marks, venom: thirds)
  {
    float nb = soul ? 4.0 : 3.0;
    for (int k = 1; k < 4; k++) {
      if (float(k) >= nb) break;
      float b = floor(mix(uSpan.x, uSpan.y, float(k) / nb) + 0.5);
      float ax = abs(pc.x - b);
      float ay = abs(dy);
      if (ay <= R + 2.0 && ax < 2.0) {
        bool fill = ax < 1.0 && ay <= R + 1.0;
        if (fill) {
          vec3 g = goldAt(dy / (R + 1.0));
          if (pc.x > b && g == G_L) g = G_M;
          if (abs(dy) < 0.6) g = soul ? LP_L : G_L;
          col = vec4(g, 1.0);
        } else col = vec4(inkC, 1.0);
      }
    }
  }

  // ------------------------------------------------ the caps
  if (soul) {
    // the mouth's collar (beside the medallion): gold with a lapis inlay band
    float dC = sdBox(pc - vec2(x0 + 4.0, cy), vec2(3.0, R + 1.5));
    // the far stopper: a collar, a neck and a lotus bud
    float dS1 = sdBox(pc - vec2(x1 - 1.0, cy), vec2(2.0, R + 1.0));
    float dS2 = sdBox(pc - vec2(x1 + 2.0, cy), vec2(1.0, R - 2.0));
    vec2 bq = (pc - vec2(x1 + 6.5, cy)) / vec2(3.6, R - 0.5);
    float dS3 = (length(bq) - 1.0) * 3.0;
    float dS = min(dS1, min(dS2, dS3));
    if (dC <= 1.0) {
      if (dC > 0.0) col = vec4(inkC, 1.0);
      else {
        vec3 g = goldAt(dy / (R + 1.5));
        float cx = pc.x - (x0 + 4.0);
        if (abs(cx) < 1.0) g = mod(p.y, 2.0) < 1.0 && abs(dy) < R ? G_L : (dy < 0.0 ? LP_L : LP_M);
        if (abs(cx) > 2.0) g = g == G_H ? G_L : g == G_L ? G_M : g;
        col = vec4(g, 1.0);
      }
    }
    if (dS <= 1.0) {
      if (dS > 0.0) col = vec4(inkC, 1.0);
      else if (dS3 <= 0.0 && dS3 < min(dS1, dS2)) {
        // the bud: petals as lit and shadowed lobes
        vec2 n = normalize(bq + 0.0001);
        float l = dot(n, normalize(vec2(-0.5, -0.86)));
        float petal = sin(atan(bq.y, bq.x) * 3.0);
        vec3 g = l > 0.55 ? G_H : l > 0.1 ? G_L : l > -0.45 ? G_M : G_D;
        if (petal > 0.85 && length(bq) > 0.45) g = G_O;
        col = vec4(g, 1.0);
      } else if (dS1 <= 0.0) {
        vec3 g = goldAt(dy / (R + 1.0));
        if (abs(pc.x - (x1 - 1.0)) < 0.6) g = dy < 0.0 ? LP_L : LP_M;
        col = vec4(g, 1.0);
      } else col = vec4(goldAt(dy / (R - 2.0)) * 0.85, 1.0);
    }
    // the medallion the heart sits on: a beaded gold rim, a lapis ring set with gold stars, a dark well
    vec2 dv = pc - uSock.xy;
    float d = length(dv), rs = uSock.z;
    if (d <= rs + 1.0) {
      vec2 nd = dv / max(d, 0.001);
      float lit = dot(nd, normalize(vec2(-0.6, -0.8)));
      float ang = atan(dv.y, dv.x);
      vec3 c3;
      if (d > rs) c3 = inkC;
      else if (d > rs - 1.0) c3 = lit > 0.3 ? G_H : lit > -0.3 ? G_L : G_M;
      else if (d > rs - 2.0) c3 = fract(ang / 6.28318 * 16.0) < 0.42 ? (lit > 0.0 ? G_H : G_L) : G_D;
      else if (d > rs - 3.0) c3 = lit < -0.3 ? G_L : lit < 0.3 ? G_M : G_D;
      else if (d > rs - 5.0) c3 = fract(ang / 6.28318 * 10.0 + 0.5) < 0.16 && d > rs - 4.6 && d < rs - 3.4 ? G_L : (lit < -0.2 ? LP_L : lit < 0.4 ? LP_M : LP_D);
      else if (d > rs - 6.0) c3 = VOID;
      else {
        float glow = (1.0 - d / (rs - 6.0)) * (0.45 + 0.4 * uSock.w);
        c3 = bayer4(p) < glow ? liq(1.0) * 0.85 : VOID;
      }
      col = vec4(c3, 1.0);
    }
  } else {
    // the venom's stopper: a brass collar, a bone telson and its curled stinger, a drop on the tip
    float dC = sdBox(pc - vec2(x0 - 1.0, cy), vec2(3.0, R + 1.0));
    vec2 eq = (pc - vec2(x0 - 7.0, cy + 0.5)) / vec2(4.0, R + 1.2);
    float dB = (length(eq) - 1.0) * 3.5;
    vec2 sc = vec2(x0 - 6.0, cy - 1.0);
    vec2 sv = pc - sc;
    float sa = atan(sv.y, sv.x);
    if (sa < 0.0) sa += 6.28318;
    float st = (sa - 3.14159) / (5.2 - 3.14159);
    float dS = 9.0;
    if (st >= 0.0 && st <= 1.0) dS = abs(length(sv) - 5.0) - mix(1.9, 0.35, st);
    float dU = min(dC, min(dB, dS));
    if (dU <= 1.0) {
      if (dU > 0.0) col = vec4(inkC, 1.0);
      else if (dS <= 0.0 && dS <= min(dC, dB)) {
        float rr = (length(sv) - 5.0);
        vec3 g = rr < -0.5 ? BN_D : rr > 0.4 ? BN_H : BN_L;
        if (st > 0.86) g = liq(3.0);
        col = vec4(g, 1.0);
      } else if (dB <= 0.0 && dB <= dC) {
        vec2 n = normalize(eq + 0.0001);
        float l = dot(n, normalize(vec2(-0.5, -0.86)));
        vec3 g = l > 0.55 ? BN_H : l > 0.05 ? BN_L : l > -0.5 ? BN_M : BN_D;
        if (abs(eq.x + 0.15) < 0.1 && abs(eq.y) < 0.8) g = BN_D;
        col = vec4(g, 1.0);
      } else {
        vec3 g = goldAt(dy / (R + 1.0));
        if (abs(pc.x - (x0 - 1.0)) < 0.6) g = g == G_H ? G_L : G_O;
        col = vec4(g, 1.0);
      }
    }
    // the far end: a brass ring and a cork, a little vent notch the fumes leak from
    float dR = sdBox(pc - vec2(x1 - 0.5, cy), vec2(1.5, R + 0.5));
    float dK = sdBox(pc - vec2(x1 + 3.0, cy), vec2(2.0, R - 1.5));
    float dE = min(dR, dK);
    if (dE <= 1.0) {
      if (dE > 0.0) col = vec4(inkC, 1.0);
      else if (dK < dR) {
        vec3 g = dy < -1.5 ? WD_L : dy < 1.5 ? WD_M : WD_D;
        if (h21(p) > 0.8) g = WD_D;
        if (p.x == floor(x1 + 3.0) && pc.y < cy - R + 2.5) g = INK;
        col = vec4(g, 1.0);
      } else col = vec4(goldAt(dy / (R + 0.5)), 1.0);
    }
  }

  // ------------------------------------------------ particles: soul motes, venom bubbles, fumes and drops
  for (int i = 0; i < NP; i++) {
    vec4 pt = uPart[i];
    if (pt.w < 0.02) continue;
    float k = uPartK[i];
    float d = length(pc - pt.xy);
    if (k < 0.5 || k > 2.5) {
      if (d < pt.z && bayer4(p) < pt.w * 1.2) col = vec4(liq(4.0), 1.0);
      else if (d < pt.z + 1.2 && bayer4(p) < pt.w * 0.4) col = vec4(liq(3.0), max(col.a, 0.9));
    } else if (k < 1.5) {
      if (abs(d - pt.z) < 0.62 && bayer4(p) < pt.w) col = vec4(liq(4.0), 1.0);
      else if (d < pt.z - 0.5 && bayer4(p) < pt.w * 0.3) col = vec4(liq(3.0), 1.0);
    } else {
      if (d < pt.z && bayer4(p + vec2(float(i))) < pt.w * (1.15 - d / pt.z)) col = vec4(d < pt.z * 0.5 ? liq(3.0) : liq(2.0), 1.0);
    }
  }
  if (col.a < 0.01) discard;
  gl_FragColor = col;
}`;

interface Wisp { x: number; y: number; vx: number; vy: number; a: number; th: number; free: boolean }
interface Pt { x: number; y: number; vx: number; vy: number; r: number; gr: number; life: number; max: number; kind: number; peak: number }

const rnd = Math.random;

export class LiquidVessel {
  readonly mesh: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;
  private wave = new Float32Array(NW);
  private wv = new Float32Array(NW);
  private wisps: Wisp[] = [];
  private pts: Pt[] = [];
  private shown = -1;
  private fv = 0;
  private lastFrac = -1;
  private lastSpeed = 0;
  private lastEmpty = 0;
  private t = 0;
  private hurt = 0;
  private flash = 0;
  private boil = 0;
  private pulse = -1;
  private pulseT = 1;
  private spawnT = 0;
  private fumeT = 0;
  private dripT = 2;
  private shakeE = 0;

  constructor(private kind: VesselKind, scene: THREE.Scene) {
    const v4 = () => Array.from({ length: NWS }, () => new THREE.Vector4());
    this.u = {
      uSize: { value: new THREE.Vector2(1, 1) }, uTube: { value: new THREE.Vector4() }, uSpan: { value: new THREE.Vector2() }, uSock: { value: new THREE.Vector4() },
      uKind: { value: kind === 'soul' ? 0 : 1 }, uTime: { value: 0 }, uFront: { value: 0 }, uTrail: { value: 0 }, uLevel: { value: 0 }, uLean: { value: 0 },
      uShield: { value: 0 }, uHurt: { value: 0 }, uLow: { value: 0 }, uFlash: { value: 0 }, uPulse: { value: -1 }, uCracks: { value: 0 },
      uWave: { value: this.wave }, uWisp: { value: v4() }, uWispA: { value: new Float32Array(NWS) },
      uPart: { value: Array.from({ length: NP }, () => new THREE.Vector4()) }, uPartK: { value: new Float32Array(NP) },
    };
    const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, transparent: true, depthWrite: false, depthTest: true, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -20;
    this.mesh.visible = false;
    scene.add(this.mesh);
    for (let i = 0; i < NWS; i++) this.wisps.push({ x: 0, y: 0, vx: 8, vy: 0, a: 0, th: rnd() * 6.28, free: false });
    for (let i = 0; i < NP; i++) this.pts.push({ x: 0, y: 0, vx: 0, vy: 0, r: 1, gr: 0, life: 0, max: 1, kind: 0, peak: 1 });
  }

  private spawn(kind: number, x: number, y: number, vx: number, vy: number, r: number, life: number, gr = 0, peak = 1) {
    const p = this.pts.find((q) => q.life <= 0);
    if (!p) return;
    Object.assign(p, { kind, x, y, vx, vy, r, life, max: life, gr, peak });
  }

  update(dt: number, a: VesselAnchor | null, s: number, visible: boolean) {
    const m = this.mesh;
    m.visible = visible && !!a;
    if (!a || !m.visible) return;
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const soul = this.kind === 'soul';
    const L = VESSEL[this.kind];
    const R = L.R;
    // the quad: the whole piece plus headroom for what rises off it (HUD px, whole pixels)
    const padT = soul ? 17 : 15;
    const qx = Math.round(a.x) - 1, qw = vesselWidth(this.kind, a.len) + 3;
    const below = soul ? L.RS + 2 : R + 3;
    const qy = Math.round(a.cy) - R - 1 - padT, qh = R + 1 + padT + below;
    const cy = Math.round(a.cy) - qy;
    const x0 = Math.round(a.x) + L.lead - qx, x1 = x0 + a.len;
    const xs = soul ? x0 + 8 : x0 + 3, xe = soul ? x1 - 3 : x1 - 2;
    const Ri = R - 1;
    const level = cy - Ri + 1.5;
    // shake: the HUD's hit shake, the dry flash
    if ((a.empty ?? 0) !== this.lastEmpty) {
      if (this.lastEmpty !== 0 || (a.empty ?? 0) > 0) {
        this.flash = 1;
        this.shakeE = 1;
        for (let i = 0; i < 5; i++) this.spawn(2, x1 + 3 + rnd() * 2, cy - R - 1, 3 + rnd() * 6, -8 - rnd() * 6, 1.2, 1.2, 1.6, 0.7);
      }
      this.lastEmpty = a.empty ?? 0;
    }
    this.shakeE = Math.max(0, this.shakeE - dt * 3);
    const sh = Math.max(a.shake ?? 0, this.shakeE);
    const ox = Math.round((rnd() - 0.5) * 5 * sh), oy = Math.round((rnd() - 0.5) * 3 * sh);
    m.position.set((qx + ox + qw / 2) * s, -(qy + oy + qh / 2) * s, -1000);
    m.scale.set(qw * s, qh * s, 1);
    const u = this.u;
    (u.uSize.value as THREE.Vector2).set(qw, qh);
    (u.uTube.value as THREE.Vector4).set(x0, x1, cy, R);
    (u.uSpan.value as THREE.Vector2).set(xs, xe);
    if (soul) {
      const sk = soulSocket(Math.round(a.x), Math.round(a.cy));
      (u.uSock.value as THREE.Vector4).set(sk.x - qx + 0.5, sk.y - qy + 0.5, sk.r, 0.5 + 0.5 * Math.sin(this.t * 6));
    }

    // ---------------------------------------------- the level and its front (a spring: surges, recoils)
    const frac = Math.max(0, Math.min(1, a.frac));
    if (this.shown < 0) this.shown = frac;
    if (this.lastFrac < 0) this.lastFrac = frac;
    const dF = frac - this.lastFrac;
    this.lastFrac = frac;
    const span = xe - xs;
    const front = () => xs + this.shown * span;
    if (dF < -0.002) {
      const amt = -dF;
      if (soul) {
        // a hit: a splash, a leak of motes, a soul gets out
        this.hurt = 1;
        const f = front();
        for (let i = 0; i < Math.min(14, 4 + Math.round(amt * 50)); i++) this.spawn(0, f - rnd() * 12, level + rnd() * 4, (rnd() - 0.5) * 46, -22 - rnd() * 46, 0.7 + rnd() * 0.6, 0.6 + rnd() * 0.5);
        for (let k = 0; k < 3; k++) this.wv[Math.floor(rnd() * NW)] -= 30 + amt * 260;
        let best: Wisp | null = null, bd = 1e9;
        for (const w of this.wisps) if (!w.free && w.a > 0.5 && Math.abs(f - w.x) < bd) { bd = Math.abs(f - w.x); best = w; }
        if (best) {
          best.free = true;
          best.vx = (rnd() - 0.3) * 20;
          best.vy = -38;
        }
      } else this.boil = Math.min(1, this.boil + amt * 10);
    } else if (dF > 0.003) {
      if (soul) {
        // healing: a pulse out of the heart along the liquid, motes stream in
        this.pulse = xs;
        this.pulseT = 0;
        const f = front();
        for (let i = 0; i < Math.min(10, 3 + Math.round(dF * 40)); i++) this.spawn(3, f - rnd() * 20, 1 + rnd() * 4, (rnd() - 0.5) * 6, 26 + rnd() * 16, 0.8, 0.55 + rnd() * 0.25);
      }
      const i = Math.min(NW - 1, Math.floor(this.shown * (NW - 1)));
      this.wv[i] += 20;
    }
    this.fv += ((frac - this.shown) * 170 - this.fv * 15) * dt;
    this.shown += this.fv * dt;
    this.shown = Math.max(0, Math.min(1.02, this.shown));
    const fx = front();
    u.uFront.value = fx;
    u.uLean.value = Math.max(-1, Math.min(1, this.fv * 5));
    u.uLevel.value = level;
    u.uTrail.value = xs + Math.max(this.shown, Math.min(1, a.trail ?? 0)) * span;

    // ---------------------------------------------- the surface: columns on springs, sloshed by the ride
    const spd = a.speed ?? 0;
    const acc = Math.max(-40, Math.min(40, (spd - this.lastSpeed) / Math.max(dt, 1e-3)));
    this.lastSpeed = spd;
    const steps = 2, h = dt / steps;
    for (let st = 0; st < steps; st++) {
      for (let i = 0; i < NW; i++) {
        const l = this.wave[Math.max(0, i - 1)], r = this.wave[Math.min(NW - 1, i + 1)];
        this.wv[i] += ((l + r - 2 * this.wave[i]) * 700 - this.wave[i] * 26 - this.wv[i] * 3.2 - acc * 3 * (i / (NW - 1) - 0.5)) * h;
      }
      for (let i = 0; i < NW; i++) this.wave[i] = Math.max(-2.6, Math.min(2.6, this.wave[i] + this.wv[i] * h));
    }
    if (!soul && this.boil > 0.05 && rnd() < this.boil * 0.6) this.wv[Math.floor(rnd() * NW * Math.max(0.05, this.shown))] -= 10 * this.boil;

    // ---------------------------------------------- wisps (soul)
    if (soul) {
      const nAct = frac > 0.01 ? Math.max(1, Math.round(frac * NWS)) : 0;
      const minX = xs + 2, maxX = fx - 3, minY = level + 2.5, maxY = cy + Ri - 1.5;
      const room = maxX - minX > 4;
      const WA = u.uWispA.value as Float32Array, WP = u.uWisp.value as THREE.Vector4[];
      this.wisps.forEach((w, i) => {
        if (w.free) {
          w.vy -= 24 * dt;
          w.x += w.vx * dt;
          w.y += w.vy * dt;
          w.a -= dt * 1.3;
          if (w.a <= 0 || w.y < -4) {
            w.free = false;
            w.a = 0;
          }
        } else {
          const want = i < nAct && room ? 1 : 0;
          if (w.a <= 0.01 && want) {
            w.x = minX + rnd() * Math.max(1, maxX - minX);
            w.y = minY + rnd() * Math.max(0.5, maxY - minY);
          }
          w.a += (want - w.a) * Math.min(1, dt * 2.5);
          w.th += (rnd() - 0.5) * dt * 5;
          const sp = 9 + 5 * Math.sin(this.t * 0.7 + i * 1.9);
          let tx = Math.cos(w.th) * sp, ty = Math.sin(w.th) * sp * 0.35;
          if (w.x < minX + 2) tx += 14;
          if (w.x > maxX - 2) tx -= 14;
          if (w.y < minY) ty += 8;
          if (w.y > maxY) ty -= 8;
          w.vx += (tx - w.vx) * Math.min(1, dt * 3);
          w.vy += (ty - w.vy) * Math.min(1, dt * 3);
          w.x += w.vx * dt;
          w.y += w.vy * dt;
          if (room) {
            w.x = Math.max(xs, Math.min(fx - 1, w.x));
            w.y = Math.max(minY - 1, Math.min(maxY + 0.5, w.y));
          }
          if (Math.abs(Math.cos(w.th)) < 0.2) w.th += Math.sign(Math.sin(w.th) || 1) * 0.6;
        }
        WP[i].set(w.x, w.y, w.vx, w.vy);
        WA[i] = Math.max(0, Math.min(1, w.a));
      });
    }

    // ---------------------------------------------- particles
    this.spawnT -= dt;
    if (soul) {
      if (this.spawnT <= 0 && fx - xs > 6) {
        this.spawnT = 0.22 + rnd() * 0.3 - frac * 0.1;
        this.spawn(0, xs + 3 + rnd() * (fx - xs - 5), level, (rnd() - 0.5) * 5, -9 - rnd() * 8, 0.55 + rnd() * 0.5, 1.3 + rnd() * 1.1);
      }
    } else {
      if (this.spawnT <= 0 && fx - xs > 3) {
        this.spawnT = (0.32 - this.boil * 0.26) * (0.6 + rnd() * 0.8);
        this.spawn(1, xs + 1 + rnd() * (fx - xs - 2), cy + Ri - 1, (rnd() - 0.5) * 2, -7 - rnd() * 7 - this.boil * 8, 0.75 + rnd() * 0.55, 1.4);
      }
      this.fumeT -= dt;
      if (this.fumeT <= 0) {
        this.fumeT = 0.4 + rnd() * 0.5 - this.boil * 0.2;
        this.spawn(2, x1 + 3, cy - R - 1, 2 + rnd() * 4, -5 - rnd() * 5, 0.9, 1.6 + rnd() * 0.6, 1.3, 0.55);
      }
      this.dripT -= dt;
      if (this.dripT <= 0) {
        this.dripT = 3 + rnd() * 3;
        this.spawn(4, x0 - 3.5, cy - 5.5, 0, 2, 0.75, 0.9);
      }
    }
    const P = u.uPart.value as THREE.Vector4[], PK = u.uPartK.value as Float32Array;
    this.pts.forEach((p, i) => {
      if (p.life > 0) {
        p.life -= dt;
        if (p.kind === 4) p.vy += 30 * dt;
        else if (p.kind === 0) p.vx += Math.sin(this.t * 3 + i) * 6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r += p.gr * dt;
        // a bubble pops at the surface
        if (p.kind === 1 && p.y < level + 0.5) p.life = 0;
        // a streaming-in mote goes into the liquid
        if (p.kind === 3 && p.y > level + 1) p.life = 0;
      }
      const k = p.life > 0 ? p.life / p.max : 0;
      const al = p.kind === 0 ? Math.sin(Math.PI * k) : p.kind === 2 ? k * p.peak : Math.min(1, k * 3);
      P[i].set(p.x, p.y, p.r, p.life > 0 ? al : 0);
      PK[i] = p.kind === 3 ? 0 : p.kind;
    });

    // ---------------------------------------------- flashes and fx
    this.hurt = Math.max(0, this.hurt - dt * 4);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.boil = Math.max(0, this.boil - dt * 1.4);
    if (this.pulse >= 0) {
      this.pulseT += dt / 0.45;
      this.pulse = xs + (fx - xs) * this.pulseT;
      if (this.pulseT >= 1) this.pulse = -1;
    }
    u.uTime.value = this.t;
    u.uHurt.value = this.hurt;
    u.uFlash.value = this.flash;
    u.uPulse.value = this.pulse;
    u.uLow.value = soul ? Math.max(0, Math.min(1, (0.32 - frac) / 0.17)) : 0;
    u.uCracks.value = soul ? (frac < 0.5 ? 1 : 0) + (frac < 0.3 ? 1 : 0) + (frac < 0.15 ? 1 : 0) : 0;
    u.uShield.value = soul ? Math.max(0, Math.min(1, a.shield ?? 0)) : 0;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
