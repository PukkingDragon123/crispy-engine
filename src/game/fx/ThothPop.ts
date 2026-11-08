// THOTH POPS IN: the in-run discovery moment. When the hunter discovers something
// (a codex entry), the little ibis god pops into the world beside him on a ring of
// floating glyph cartouches, in a burst of gold and jade:
//   - he gasps at the thing (a miniature specimen of it floats in his ring, or the
//     real boss stands in view), runs a lap around it, stops to scribble notes on
//     his scroll (gold ink sparks off the nib), the entry's name types itself in
//     the air, he does a delighted little bounce, and pops back out;
//   - for big discoveries (a boss, a legend) he STOPS TIME for a moment: the world
//     freezes, a ripple drains the colour out of everything but him, a clock dial
//     of gold and lapis rings out and its hands clank to a halt; then time snaps
//     back;
//   - he talks like a child through the voice synth ("Ooh! A new one! Can I keep it?").
// About 2.5 s (3.2 s with the time stop); `skip()` hurries him out (the interact key).
// Everything runs on real time, so it keeps moving while the world is frozen.
//
//   const pop = new ThothPop(ctx, host);    // host: the RunScene (player, camRig)
//   if (pop.ready && !pop.busy) pop.play({ name, tag, section, points, big, specimen });
//   pop.update(rdt, paused);  pop.skip();  pop.dispose();
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import { RigInstance, voxelMesh } from '../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { ThothAnim, type ThothMode } from '../models/characters/thoth';
import { bakeRig, bakedRig } from './RigBake';
import { FloatText3D } from './FloatText3D';
import { Voice, type VoiceProfile, type Speech } from '../audio/Voice';
import type { Puppet } from '../ui/codex/Puppet';

// ------------------------------------------------------------------ voice
/** Thoth: a bright, breathless child's voice, quick and sing-song, with a faint divine shimmer */
export const THOTH_VOICE: VoiceProfile = {
  f0: 318, range: 9, formant: 1.34, bw: 1.0, tilt: 1.22, breath: 0.2, rasp: 0, growl: 0, jitter: 9, vib: [6.4, 20], creak: 0,
  speed: 1.16, pauseMul: 0.85, wordGap: 0.014, gain: 0.82, octave: 0.08, chirp: 1.1, nasal: 0.12, presence: 2, air: 2,
  reverb: 0.16, duck: 0.3, ref: 10,
  phrases: {
    fresh: ['Ooh! A new one! Can I keep it?', 'Wow wow wow! Hold still!', 'New friend! New friend!', 'I am writing you down!', 'Ooh, ooh! For my hall!', 'Hee hee! Got you!'],
    bounty: ['Eep! A bitey one! Hold still!', 'Ooh, a grumpy one! Writing it down!', 'Don\'t move! I\'m drawing your nose!'],
    boss: ['Stop! Everybody freeze!', 'Wait wait wait! Let me draw him!', 'Time out! I need a good look!'],
    wildlife: ['Aww! Can I keep it? Please?', 'So fluffy! Writing it down!', 'Ooh, it\'s so little! Like me!'],
    place: ['Ooh, a new place! I\'ll make a map!', 'Never been here! Well, not for a thousand years.'],
    legend: ['Ooh! I know you! Sort of!', 'Ten thousand years and I never saw that!'],
    loot: ['Shiny! What does it do?', 'Ooh, a thingy! For the shelf!'],
    again: ['More notes! More notes!', 'I knew you\'d come back!', 'Ooh, now I know even more!'],
  },
};
const lastPick = new Map<string, number>();
/** a random line of Thoth's for a mood (fresh, bounty, boss, wildlife, place, legend, loot, again) */
export function thothLine(kind: string) {
  const list = THOTH_VOICE.phrases?.[kind] ?? THOTH_VOICE.phrases!.fresh;
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === lastPick.get(kind)) i = (i + 1) % list.length;
  lastPick.set(kind, i);
  return list[i];
}
/** Thoth says a line (positional when `pos` is given) */
export function thothSay(text: string, o: { pos?: THREE.Vector3; follow?: boolean; volume?: number; delay?: number } = {}): Speech | null {
  return Voice.say(THOTH_VOICE, text, { key: 'thoth', ...o });
}

// ------------------------------------------------------------------ the show
export interface ThothShow {
  /** the entry's name (typed in the air) */
  name: string;
  /** NEW ENTRY, FIRST KILL, MASTERED... */
  tag: string;
  section?: string;
  points: number;
  /** a big discovery: he stops time */
  big?: boolean;
  /** a fresh entry (not a deeper level of a known one) */
  fresh?: boolean;
  /** the codex category (picks his line) */
  cat?: string;
  /** builds a miniature of the thing for him to run around (null: no specimen) */
  specimen?: (() => Puppet | null) | null;
}

const GOLD = 0xe8b84a, GOLD_L = 0xffe38c, GOLD_S = 0xb8862e, JADE = 0x3fbf8a, JADE_D = 0x237a58, LAPIS = 0x2a4ea6, LAPIS_D = 0x1a3478;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const sstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const easeBack = (t: number) => {
  const c = 2.2;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
/** in the world he is drawn a touch larger than life so he reads beside the hunter */
const THOTH_SCALE = 1.2;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// ------------------------------------------------------------------ the glyph cartouches
type Glyph = 'ankh' | 'eye' | 'feather' | 'ibis' | 'reed' | 'water' | 'sun' | 'djed';
const GLYPHS: Glyph[] = ['ibis', 'ankh', 'eye', 'feather', 'djed', 'water', 'sun', 'reed'];

/** a small sculpting pen on a voxel tile: strokes and blobs in the tile's (u, v) face plane */
class TilePen {
  constructor(public m: VoxelModel, public z: number, public col: number, public fl: number) {}
  dot(u: number, v: number, r: number) {
    for (let i = Math.floor(u - r - 1); i <= Math.ceil(u + r + 1); i++)
      for (let j = Math.floor(v - r - 1); j <= Math.ceil(v + r + 1); j++) if (Math.hypot(i + 0.5 - u, j + 0.5 - v) <= r) this.m.set(i, j, this.z, this.col, this.fl);
  }
  stroke(pts: [number, number][], r0: number, r1 = r0) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(2, Math.ceil(L * 3));
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        const r = r0 + (r1 - r0) * ((acc + L * t) / (total || 1));
        this.dot(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r);
      }
      acc += L;
    }
  }
  ring(u: number, v: number, rx: number, ry: number, w: number, a0 = 0, a1 = Math.PI * 2) {
    const n = Math.ceil((rx + ry) * 6);
    for (let s = 0; s <= n; s++) {
      const a = a0 + ((a1 - a0) * s) / n;
      this.dot(u + Math.cos(a) * rx, v + Math.sin(a) * ry, w);
    }
  }
}

/** a cartouche tile: a gold rope border on a jade or lapis field, the glyph raised in glowing gold */
function glyphTile(g: Glyph, i: number) {
  const m = new VoxelModel('glyph_' + g);
  const W = 7, H = 10; // half extents (voxels)
  const field = i & 1 ? LAPIS : JADE, fieldD = i & 1 ? LAPIS_D : JADE_D;
  for (let x = -W; x < W; x++)
    for (let y = -H; y < H; y++) {
      // a rounded-end cartouche outline
      const cx = x + 0.5, cy = y + 0.5;
      const ey = Math.max(0, Math.abs(cy) - (H - W));
      const d = Math.hypot(cx, ey) / W;
      if (d > 1) continue;
      const rim = d > 0.82;
      for (let z = -1; z <= (rim ? 1 : 0); z++) {
        let c = rim ? ((Math.floor(Math.atan2(cy, cx) * 6) + z) & 1 ? GOLD_S : GOLD_L) : (x + y) % 5 === 0 ? fieldD : field;
        if (z < 0) c = GOLD_S;
        m.set(x, y, z, c, rim ? VF.METAL | VF.EMISSIVE : VF.SOLID);
      }
    }
  // the base bar of the cartouche
  for (let x = -W + 2; x < W - 2; x++) m.set(x, -H + 2, 1, GOLD, VF.METAL | VF.EMISSIVE);
  const p = new TilePen(m, 1, GOLD_L, VF.METAL | VF.EMISSIVE);
  switch (g) {
    case 'ankh':
      p.ring(0, 4, 2.1, 2.6, 0.75);
      p.stroke([[-3.4, 1], [3.4, 1]], 0.85);
      p.stroke([[0, 1], [0, -6]], 0.8, 1.05);
      break;
    case 'eye':
      p.ring(0, 2, 3.6, 1.6, 0.6);
      p.dot(0.4, 2, 1.25);
      p.stroke([[-3.6, 4.4], [0, 5.1], [3.6, 4.2]], 0.55);
      p.stroke([[0.2, 0.3], [0.2, -3.2], [1.4, -4.6], [2.8, -4.2]], 0.6);
      p.stroke([[-1.6, 0.4], [-3.2, -4.4]], 0.55);
      break;
    case 'feather':
      p.stroke([[0, -6.5], [0.6, -1], [1.5, 4], [2.3, 6.2]], 0.5, 0.45);
      p.stroke([[0.3, -5], [-1.2, -1], [-1.0, 3], [1.0, 6.4]], 1.0, 0.6);
      p.stroke([[0.6, -4.5], [1.9, -1], [2.6, 3]], 0.8, 0.5);
      break;
    case 'ibis':
      p.dot(1, -1, 2.1);
      p.dot(2.6, -0.4, 1.4);
      p.stroke([[-0.8, 0], [-1.8, 2.4], [-1.0, 4.4]], 0.75);
      p.dot(-0.9, 4.8, 1.0);
      p.stroke([[-0.2, 5], [1.4, 4.4], [2.4, 2.9], [2.8, 1.8]], 0.5, 0.4);
      p.stroke([[0.4, -2.6], [0.2, -6.4]], 0.45);
      p.stroke([[1.4, -2.6], [1.8, -6.4]], 0.45);
      break;
    case 'reed':
      p.stroke([[0.2, -6.5], [0, -1], [0.6, 3], [1.8, 6.2]], 0.55, 0.4);
      p.stroke([[0.1, -2], [-1.6, 1], [-2.4, 4.4]], 0.9, 0.4);
      p.stroke([[0.5, 1], [2.2, 3.5], [2.6, 5.6]], 0.8, 0.4);
      break;
    case 'water':
      for (const v of [3.6, 0.4, -2.8]) {
        const pts: [number, number][] = [];
        for (let u = -4.2; u <= 4.21; u += 1.05) pts.push([u, v + ((Math.round((u + 4.2) / 1.05) & 1) ? 0.9 : -0.6)]);
        p.stroke(pts, 0.5);
      }
      break;
    case 'sun':
      p.ring(0, 1, 3.4, 3.4, 0.7);
      p.dot(0, 1, 1.5);
      p.stroke([[-2.6, -3.6], [0, -5.4], [2.6, -3.6]], 0.55);
      break;
    case 'djed':
      p.stroke([[0, -6.5], [0, 4.5]], 1.25, 1.0);
      for (const v of [1.2, 2.6, 4.0, 5.3]) p.stroke([[-3, v], [3, v]], 0.55);
      p.stroke([[-2.2, -6.5], [2.2, -6.5]], 0.6);
      break;
  }
  return voxelMesh(m, 1 / 84, 'center');
}

// ------------------------------------------------------------------ the clock dial (time stop)
function clockDial() {
  const R = 34;
  const face = new VoxelModel('dial');
  for (let x = -R - 2; x <= R + 2; x++)
    for (let y = -R - 2; y <= R + 2; y++) {
      const cx = x + 0.5, cy = y + 0.5;
      const r = Math.hypot(cx, cy);
      const a = Math.atan2(cy, cx);
      if (r > R + 1.5) continue;
      if (r > R - 3.2) {
        // the bezel: a twisted gold rope, rounded front to back
        const t = (r - (R - 3.2)) / 4.7;
        const zr = Math.round(Math.sin(t * Math.PI) * 2.2);
        for (let z = -1; z <= zr; z++) face.set(x, y, z, (Math.floor(a * 18 + r * 0.8) & 1) ? GOLD_L : GOLD, VF.METAL | (z === zr ? VF.EMISSIVE : 0));
        continue;
      }
      // the lapis face with gold-dust stars, an engraved inner ring, the hour marks
      let c = (Math.floor(cx * 0.7 + cy * 0.37) & 7) === 0 ? LAPIS_D : LAPIS;
      let fl: number = VF.SOLID;
      const star = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (star % 41 === 0 && r < R - 6) (c = GOLD_L), (fl = VF.EMISSIVE);
      if (Math.abs(r - 21) < 0.7 || Math.abs(r - (R - 4.2)) < 0.6) (c = GOLD), (fl = VF.METAL | VF.EMISSIVE);
      face.set(x, y, -1, c, fl);
    }
  // twelve hour marks: little feathers of Maat pointing in, the twelfth a crescent moon
  for (let h = 0; h < 12; h++) {
    const a = Math.PI / 2 - (h * Math.PI) / 6;
    const ca = Math.cos(a), sa = Math.sin(a);
    if (h === 0) {
      for (let s = 0; s <= 24; s++) {
        const b = Math.PI * (0.15 + 0.7 * (s / 24));
        const px = Math.cos(b) * 3.2, py = -Math.sin(b) * 3.2 + 26.5;
        face.set(Math.floor(px), Math.floor(py), 0, GOLD_L, VF.METAL | VF.EMISSIVE);
        face.set(Math.floor(px), Math.floor(py), 1, GOLD_L, VF.METAL | VF.EMISSIVE);
      }
      continue;
    }
    for (let s = 0; s <= 6; s++) {
      const r = 24 + s;
      const w = s < 2 ? 0 : s < 5 ? 1 : 0;
      for (let k = -w; k <= w; k++) {
        const px = ca * r - sa * k * 0.9, py = sa * r + ca * k * 0.9;
        face.set(Math.floor(px), Math.floor(py), 0, s === 6 ? GOLD : GOLD_L, VF.METAL | VF.EMISSIVE);
      }
    }
  }
  // the moon boss in the centre
  for (let x = -5; x <= 5; x++)
    for (let y = -5; y <= 5; y++) {
      const r = Math.hypot(x + 0.5, y + 0.5);
      if (r > 4.6) continue;
      const zr = Math.round(Math.sqrt(Math.max(0, 1 - (r / 4.6) ** 2)) * 2.5);
      for (let z = 0; z <= zr; z++) face.set(x, y, z, r > 3.6 ? GOLD : 0xe9eef7, VF.METAL | (r > 3.6 ? VF.EMISSIVE : 0));
    }
  const hand = (len: number, w: number, crescent: boolean) => {
    const m = new VoxelModel('hand');
    for (let y = -7; y <= len; y++) {
      const t = y / len;
      const hw = y < 0 ? 0 : y < len * 0.75 ? w * (1 - t * 0.35) : w * 1.6 * (1 - (t - 0.75) / 0.25);
      for (let x = -Math.ceil(hw); x <= Math.ceil(hw); x++) {
        if (Math.abs(x + 0.5) > hw + 0.5) continue;
        const edge = Math.abs(x + 0.5) > hw - 0.6;
        m.set(x, y, 2, edge ? GOLD_L : GOLD, VF.METAL | (edge ? VF.EMISSIVE : 0));
      }
    }
    // the counterweight: an ankh loop on the minute hand, a crescent on the hour hand
    for (let s = 0; s < 28; s++) {
      const a = (s / 28) * Math.PI * 2;
      if (crescent && Math.sin(a) > 0.3) continue;
      const px = Math.cos(a) * 2.6, py = Math.sin(a) * 3.2 - 9;
      m.set(Math.floor(px), Math.floor(py), 2, GOLD_L, VF.METAL | VF.EMISSIVE);
    }
    m.set(0, -6, 2, GOLD, VF.METAL);
    return voxelMesh(m, 1 / 72, [0, 0, 2.5]);
  };
  const g = new THREE.Group();
  const faceMesh = voxelMesh(face, 1 / 72, 'center');
  const minute = hand(26, 1.3, false);
  const hour = hand(17, 1.7, true);
  minute.position.z = 0.034;
  hour.position.z = 0.05;
  for (const m of [faceMesh, minute, hour]) m.castShadow = false;
  g.add(faceMesh, minute, hour);
  return { group: g, minute, hour };
}

// ------------------------------------------------------------------ the time ripple (post pass)
const RippleShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uRad: { value: 0 },
    uAmt: { value: 0 },
    uRing: { value: 0 },
    uKeep: { value: 0.08 },
    uAspect: { value: 1.7 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uRad, uAmt, uRing, uKeep, uAspect;
    varying vec2 vUv;
    void main(){
      vec2 d = vUv - uCenter; d.x *= uAspect;
      float r = length(d);
      vec2 dir = r > 1e-4 ? d / r : vec2(0.0);
      // the wavefront: a thin refracting ring with a gold lip
      float x = (r - uRad) / 0.03;
      float ring = exp(-x * x) * uRing;
      vec2 off = dir * ring * 0.014; off.x /= uAspect;
      vec3 col = texture2D(tDiffuse, vUv - off).rgb;
      // behind the wave, the world is frozen: drained, cooled, a whisper of old papyrus
      float inside = 1.0 - smoothstep(uRad - 0.03, uRad + 0.02, r);
      float keep = smoothstep(uKeep, uKeep * 1.7, r);
      float k = inside * keep * uAmt;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 frozen = mix(vec3(l), col, 0.1) * vec3(0.95, 0.99, 1.07);
      frozen = mix(frozen, vec3(l) * vec3(1.08, 0.98, 0.84), 0.22);
      col = mix(col, frozen, k);
      col += vec3(1.0, 0.8, 0.4) * ring * 0.28;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// ------------------------------------------------------------------ ThothPop
interface Timeline {
  gasp: number;
  freeze0: number;
  freeze1: number;
  run0: number;
  run1: number;
  write1: number;
  joy1: number;
  out1: number;
}

export class ThothPop {
  private rig: RigInstance | null = null;
  private anim: ThothAnim | null = null;
  private stage = new THREE.Group();
  private body = new THREE.Group();
  private tiles: THREE.Mesh[] = [];
  private dial: ReturnType<typeof clockDial> | null = null;
  private ripple: ShaderPass | null = null;
  private title: FloatText3D | null = null;
  private sub: FloatText3D | null = null;
  private specimen: Puppet | null = null;
  private show: ThothShow | null = null;
  private tl: Timeline | null = null;
  private t = 0;
  private yaw = 0;
  private yawInit = false;
  private heading = 0;
  private ang = -1;
  private pos = new THREE.Vector3();
  private voicePos = new THREE.Vector3();
  private stageY = 0;
  private trailT = 0;
  private sparkT = 0;
  private fired = new Set<string>();
  private freezing = false;
  private speech: Speech | null = null;
  /** playback rate of the show (1 = real time; 0 holds a frame, for captures) */
  timeScale = 1;

  /** host: the RunScene (player.pos, camRig.yaw) */
  constructor(private ctx: Ctx, private host: any) {
    this.stage.visible = false;
    this.stage.add(this.body);
    ctx.scene.add(this.stage);
    void bakeRig('thoth').then(() => this.ensureRig());
  }

  /** the rig is baked and he can appear */
  get ready() {
    return !!bakedRig('thoth');
  }
  /** a show is on */
  get busy() {
    return !!this.show;
  }

  private ensureRig() {
    if (this.rig) return true;
    const geo = bakedRig('thoth');
    if (!geo) return false;
    this.rig = new RigInstance(geo, { castShadow: true });
    this.anim = new ThothAnim(this.rig, 7);
    this.body.add(this.rig.root);
    GLYPHS.forEach((g, i) => {
      const m = glyphTile(g, i);
      m.castShadow = false;
      this.tiles.push(m);
      this.stage.add(m);
    });
    this.dial = clockDial();
    this.dial.group.visible = false;
    this.ctx.scene.add(this.dial.group);
    return true;
  }

  play(s: ThothShow) {
    if (!this.ensureRig()) return false;
    this.finish();
    this.show = s;
    const big = !!s.big;
    const fz = big ? 0.8 : 0;
    const gasp = 0.12;
    const freeze0 = 0.42, freeze1 = freeze0 + fz;
    const run0 = big ? freeze1 : 0.55;
    const run1 = run0 + 0.7;
    const write1 = run1 + 0.55;
    const joy1 = write1 + 0.45;
    this.tl = { gasp, freeze0, freeze1, run0, run1, write1, joy1, out1: joy1 + 0.3 };
    this.t = 0;
    this.fired.clear();
    this.ang = -1.05;
    this.yawInit = false;
    this.place(0, true);
    this.stage.visible = true;
    this.stage.scale.setScalar(0.001);
    // the specimen: a miniature of the thing, floating in the ring
    try {
      this.specimen = s.specimen?.() ?? null;
    } catch (e) {
      console.warn('[thoth] specimen', e);
      this.specimen = null;
    }
    if (this.specimen) {
      const p = this.specimen;
      const k = Math.min(0.52 / Math.max(0.1, p.height), 0.36 / Math.max(0.05, p.radius), 2.2);
      p.root.scale.setScalar(k);
      p.root.position.set(0, 0.08, 0);
      p.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = false;
      });
      this.stage.add(p.root);
    }
    // the floating words: the name (typed), and the tag, section and points beneath
    this.title?.dispose();
    this.sub?.dispose();
    this.title = new FloatText3D(s.name, { size: 0.3, color: '#fff4d8', glow: '#ffc85a', cps: 34, wrap: 26, hdr: 1.6 });
    const subTxt = `${s.tag}${s.section ? ' - ' + s.section : ''}   +${s.points}`;
    this.sub = new FloatText3D(subTxt, { size: 0.15, color: '#8ef2c0', glow: '#3fbf8a', cps: 0, wrap: 60, hdr: 1.4 });
    this.title.show(false);
    this.sub.show(false);
    this.ctx.scene.add(this.title.mesh, this.sub.mesh);
    const a = this.anim!;
    a.mode = 'gasp';
    a.lookAt = null;
    return true;
  }

  /** hurry him out (a skip, or a cutscene starting) */
  skip() {
    const tl = this.tl;
    if (!tl || this.t >= tl.joy1) return;
    this.t = tl.joy1;
    this.endFreeze(true);
    this.speech?.stop(0.12);
  }

  update(rdt: number, paused = false) {
    if (!this.show || !this.tl || !this.anim || !this.rig) return;
    const dt = paused ? 0 : rdt * this.timeScale;
    const tl = this.tl;
    this.t += dt;
    const t = this.t;
    const once = (k: string, at: number) => t >= at && !this.fired.has(k) && (this.fired.add(k), true);
    const a = this.anim;
    const big = !!this.show.big;
    const cam = this.ctx.camera;
    this.place(dt);
    const c = this.stage.position;

    // ---------------------------------------------------------------- the stage: in, alive, out
    const inK = clamp(t / 0.32, 0, 1);
    const outK = clamp((t - tl.joy1) / (tl.out1 - tl.joy1), 0, 1);
    const sc = Math.max(0.001, easeBack(inK) * (1 - sstep(0, 1, outK)));
    this.stage.scale.setScalar(sc);
    const spin = t * 0.9;
    this.tiles.forEach((m, i) => {
      const n = this.tiles.length;
      const rise = sstep(0.04 * i, 0.04 * i + 0.3, t);
      const ai = spin + (i / n) * Math.PI * 2;
      const r = 1.08 + 0.07 * Math.sin(t * 3 + i);
      m.position.set(Math.sin(ai) * r, 0.1 + rise * 0.16 + Math.sin(t * 4 + i * 1.3) * 0.035, Math.cos(ai) * r);
      m.rotation.set(0, ai, Math.sin(t * 2 + i) * 0.08);
      m.scale.setScalar(Math.max(0.001, rise));
    });
    if (this.specimen) {
      const p = this.specimen;
      p.root.rotation.y = t * 0.8;
      p.root.position.y = 0.1 + Math.sin(t * 2.6) * 0.03;
      try {
        p.update(dt, cam.position);
      } catch {
        /* a puppet that cannot animate just floats */
      }
    }

    // ---------------------------------------------------------------- beats
    if (once('in', 0)) {
      this.burst(1);
      this.ctx.engine.audio.play('loot_reveal', { volume: 0.7, pitch: 1.15 });
      this.ctx.engine.audio.play('gem_chime', { volume: 0.45, pitch: 1.2 });
      a.kick(-4);
      a.flutter(1.5);
    }
    if (once('voice', 0.14)) {
      const s = this.show;
      const kind = !s.fresh ? 'again' : big && s.cat === 'boss' ? 'boss' : s.cat === 'bounty' ? 'bounty' : s.cat === 'wildlife' ? 'wildlife' : s.cat === 'place' ? 'place' : s.cat === 'legend' ? 'legend' : s.cat === 'loot' || s.cat === 'blueprint' ? 'loot' : 'fresh';
      this.speech = thothSay(thothLine(kind), { pos: this.voicePos, follow: true, volume: 1 });
      a.talk(this.speech?.duration ?? 1.2);
    }
    if (once('text', 0.34)) {
      this.title?.show(true);
      this.ctx.engine.audio.play('page_turn', { volume: 0.45, pitch: 1.15 });
    }
    if (once('sub', 0.8)) this.sub?.show(true);
    // the time stop
    if (big) {
      if (once('freeze', tl.freeze0)) this.startFreeze();
      if (this.freezing) {
        this.ctx.engine.hitStop(0.06, 0.02);
        this.freezeFx(t - tl.freeze0, tl.freeze1 - tl.freeze0);
        if (t >= tl.freeze1) this.endFreeze(false);
      }
    }

    // ---------------------------------------------------------------- Thoth's moves
    let mode: ThothMode = 'gasp';
    const camYaw = Math.atan2(cam.position.x - c.x, cam.position.z - c.z); // stage-local "toward the camera"
    let face = camYaw;
    let R = 0.64;
    if (t < tl.gasp) mode = 'gasp';
    else if (big && t >= tl.freeze0 && t < tl.freeze1) mode = 'stoptime';
    else if (t < tl.run0) mode = 'gasp';
    else if (t < tl.run1) {
      // the scamper: the long way round, behind the thing, to its front-right
      mode = 'run';
      const k = (t - tl.run0) / (tl.run1 - tl.run0);
      const e = k * k * (3 - 2 * k);
      const a0 = -1.05, a1 = -1.05 - (Math.PI * 2 - 1.8);
      this.ang = a0 + (a1 - a0) * e;
      a.speed = 3.6;
      const dir = -1;
      face = camYaw + this.ang + (dir * Math.PI) / 2;
      R = 0.64 + Math.sin(k * Math.PI) * 0.12;
    } else if (t < tl.write1) {
      mode = 'write';
      this.ang = -1.05 - (Math.PI * 2 - 1.8);
      // three-quarters to the camera, turned a little toward the specimen
      face = camYaw - 0.55;
      a.lookAt = null;
    } else if (t < tl.joy1) {
      mode = 'delight';
      this.ang = damp(this.ang, -Math.PI * 2 + 0.35, 6, dt);
      R = damp(R, 0.6, 6, dt);
      face = camYaw - 0.2;
    } else {
      mode = 'delight';
      face = camYaw;
    }
    if (a.mode !== mode) {
      a.mode = mode;
      if (mode === 'run') this.ctx.engine.audio.play('paper_flutter', { volume: 0.35, pitch: 1.3 });
      if (mode === 'write') this.ctx.engine.audio.play('page_turn', { volume: 0.4, pitch: 1.25 });
      if (mode === 'delight') {
        a.flutter(1.2);
        this.ctx.engine.audio.play('gem_chime', { volume: 0.5, pitch: 1.35 });
        this.ctx.fx.sparkle(this.textPos(_v, 1.05), 0xffe38c, 10, 0.5);
      }
    }
    a.lookAt = mode === 'gasp' || mode === 'delight' ? cam.position : null;
    // where he stands on the ring (stage space)
    const ang = camYaw + this.ang;
    this.body.position.set(Math.sin(ang) * R, 0.06, Math.cos(ang) * R);
    this.heading = this.yawToward(this.heading, face, mode === 'run' ? 18 : 10, dt);
    this.body.rotation.y = this.heading;
    a.update(dt);
    // pop in and out of thin air (on top of his own squash and stretch)
    const pk = THOTH_SCALE * Math.max(0.001, easeBack(clamp((t - 0.02) / 0.3, 0, 1)) * (1 - sstep(0, 0.8, outK)));
    this.rig.root.scale.setScalar(pk);
    this.rig.root.position.y = a.rootLift;
    this.rig.root.rotation.y = outK * Math.PI * 2.5; // a twirl as he pops out

    // ---------------------------------------------------------------- motes, nib sparks, trail
    this.rig.root.updateMatrixWorld(true);
    this.body.getWorldPosition(this.voicePos);
    this.voicePos.y += 0.45;
    this.trailT -= dt;
    if (mode === 'run' && this.trailT <= 0) {
      this.trailT = 0.04;
      const p = this.body.getWorldPosition(_v);
      this.ctx.particles.emit({ pos: { x: p.x, y: p.y + 0.04, z: p.z }, count: 2, spread: 0.4, up: 0.6, life: [0.3, 0.6], size: [0.07, 0.01], sprite: ['star4', 'dot'], additive: true, color: [GOLD_L, JADE], jitter: 0.08, drag: 2 });
    }
    this.sparkT -= dt;
    if (mode === 'write' && this.sparkT <= 0) {
      this.sparkT = 0.035;
      const nib = this.rig.sockets.nib?.getWorldPosition(_w);
      if (nib) this.ctx.particles.emit({ pos: { x: nib.x, y: nib.y, z: nib.z }, count: 2, spread: 0.6, up: 0.9, life: [0.2, 0.45], size: [0.045, 0.008], sprite: ['spark', 'star4'], additive: true, color: [GOLD_L, 0xfff0a6], gravity: 2.5, jitter: 0.01 });
    }
    if (dt > 0 && Math.random() < dt * 14 * sc) {
      const r = 0.95 * sc;
      const aa = Math.random() * Math.PI * 2;
      this.ctx.particles.emit({ pos: { x: c.x + Math.sin(aa) * r, y: c.y + 0.1, z: c.z + Math.cos(aa) * r }, count: 1, vel: { x: Math.cos(aa) * 0.6, y: 0.9, z: -Math.sin(aa) * 0.6 }, life: [0.5, 1.0], size: [0.06, 0.01], sprite: ['dot', 'star4'], additive: true, color: [GOLD, JADE, GOLD_L], drag: 1.5 });
    }
    if (once('out', tl.joy1)) {
      this.burst(0.7);
      this.ctx.engine.audio.play('divine_chime', { volume: 0.4, pitch: 1.3 });
      this.title?.show(false);
      this.sub?.show(false);
    }

    // ---------------------------------------------------------------- the words in the air
    if (this.title && this.sub) {
      this.title.anchor.copy(this.textPos(_v, 1.5));
      this.sub.anchor.copy(this.textPos(_v, 1.24));
      this.title.update(rdt, cam);
      this.sub.update(rdt, cam);
    }
    if (t >= tl.out1) this.finish();
  }

  /** a world point above the stage, pulled a little toward the camera so the words sit in front */
  private textPos(out: THREE.Vector3, h: number) {
    const c = this.stage.position;
    const cam = this.ctx.camera.position;
    out.set(cam.x - c.x, 0, cam.z - c.z).normalize().multiplyScalar(0.35);
    return out.add(c).setY(c.y + h);
  }

  /** stage anchor: beside the hunter, to the right of the view, glued to his frame */
  private place(dt: number, snap = false) {
    const p = this.host?.player?.pos as THREE.Vector3 | undefined;
    const camYaw = (this.host?.camRig?.yaw as number | undefined) ?? 0;
    if (!this.yawInit || snap) {
      this.yaw = camYaw;
      this.yawInit = true;
    } else {
      let d = camYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-5 * dt));
    }
    if (!p) return;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const x = p.x + rx * 2.35 + fx * 1.75, z = p.z + rz * 2.35 + fz * 1.75;
    let g = this.ctx.world?.groundAt?.(x, z) ?? p.y;
    g = clamp(g, p.y - 1.5, p.y + 1.2);
    const y = g + 0.14 + Math.sin(this.t * 2.2) * 0.025;
    this.stageY = snap ? y : damp(this.stageY, y, 10, dt);
    this.stage.position.set(x, this.stageY, z);
  }

  private yawToward(cur: number, target: number, l: number, dt: number) {
    let d = target - cur;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return cur + d * (1 - Math.exp(-l * dt));
  }

  /** a puff of gold and jade, glyph sprites and a flash of light */
  private burst(power: number) {
    const c = this.stage.position;
    const p = { x: c.x + this.body.position.x, y: c.y + 0.35, z: c.z + this.body.position.z };
    const P = this.ctx.particles;
    P.emit({ pos: p, count: Math.round(18 * power), spread: 3.2 * power, up: 1.5, life: [0.35, 0.8], size: [0.12, 0.01], sprite: ['star4', 'spark'], additive: true, color: [GOLD_L, GOLD, JADE, 0x8ef2c0], drag: 3, jitter: 0.12 });
    P.emit({ pos: p, count: Math.round(8 * power), spread: 1.4, up: 1.6, life: [0.7, 1.3], size: [0.2, 0.05], sprite: ['glyph0', 'glyph1', 'glyph2', 'glyph3'], additive: true, color: [GOLD_L, JADE], drag: 2, jitter: 0.3, fadeIn: 0.1 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      P.emit({ pos: { x: c.x + Math.sin(a) * 0.3, y: c.y + 0.08, z: c.z + Math.cos(a) * 0.3 }, count: 1, vel: { x: Math.sin(a) * 2.6 * power, y: 0.3, z: Math.cos(a) * 2.6 * power }, life: [0.35, 0.5], size: [0.09, 0.02], sprite: 'dot', additive: true, color: i & 1 ? GOLD_L : JADE, drag: 4 });
    }
    this.ctx.fx.light(p, 0xffd98a, 3.2 * power, 0.45, 5);
  }

  // ---------------------------------------------------------------- the time stop
  private startFreeze() {
    this.freezing = true;
    const eng = this.ctx.engine;
    eng.audio.play('time_slow', { volume: 0.7, pitch: 1.2 });
    eng.audio.play('rev_hammer', { volume: 0.6, pitch: 0.55 });
    (window as any).__music?.stinger?.('discover');
    if (!this.ripple) {
      this.ripple = new ShaderPass(RippleShader);
      eng.post.composer.addPass(this.ripple);
    }
    if (this.dial) this.dial.group.visible = true;
    this.anim?.flutter(2);
  }
  private freezeFx(ft: number, dur: number) {
    const u = this.ripple?.uniforms;
    const cam = this.ctx.camera;
    // the ripple runs out from Thoth across the screen; his little bubble keeps its colour
    if (u) {
      this.body.getWorldPosition(_v);
      _v.y += 0.4;
      _v.project(cam);
      u.uCenter.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
      u.uAspect.value = this.ctx.engine.width / Math.max(1, this.ctx.engine.height);
      const outK = sstep(dur - 0.22, dur, ft);
      u.uRad.value = (1 - Math.pow(1 - clamp(ft / 0.45, 0, 1), 2.4)) * 2.2 * (1 - outK);
      u.uAmt.value = 0.9 * (1 - outK);
      u.uRing.value = (ft < 0.5 ? 1 : 0.35) * (1 - outK);
      // his bubble (and the dial behind him) keeps its colour: ~0.75 m around him, in screen heights
      const d = this.body.getWorldPosition(_w).distanceTo(cam.position);
      u.uKeep.value = clamp(0.78 / (2 * Math.max(0.5, d) * Math.tan((cam.fov * Math.PI) / 360)), 0.05, 0.32);
    }
    // the dial behind him: rings out, the hands whirl then CLANK to a halt
    const dl = this.dial;
    if (dl) {
      // a halo of a clock right behind him
      const c = this.body.getWorldPosition(_v);
      const toCam = _w.set(cam.position.x - c.x, 0, cam.position.z - c.z).normalize();
      dl.group.position.set(c.x - toCam.x * 0.7, c.y + 0.55, c.z - toCam.z * 0.7);
      dl.group.quaternion.copy(cam.quaternion);
      const k = easeBack(clamp(ft / 0.28, 0, 1)) * (1 - sstep(dur - 0.18, dur, ft));
      dl.group.scale.setScalar(Math.max(0.001, k));
      const whirl = ft < 0.3 ? ft * 40 : 12 + Math.sin((ft - 0.3) * 40) * 0.05 * Math.exp(-(ft - 0.3) * 8);
      dl.minute.rotation.z = -whirl;
      dl.hour.rotation.z = -whirl / 12 - 0.9;
      if (!this.fired.has('clank') && ft >= 0.3) {
        this.fired.add('clank');
        this.ctx.engine.audio.play('qte_perfect', { volume: 0.55, pitch: 0.8 });
        this.ctx.engine.audio.play('counter_clang', { volume: 0.35, pitch: 1.4 });
        const p = dl.group.position;
        this.ctx.particles.emit({ pos: { x: p.x, y: p.y, z: p.z }, count: 16, spread: 2.2, up: 0.4, life: [0.4, 0.9], size: [0.16, 0.03], sprite: ['glyph0', 'glyph1', 'glyph2', 'glyph3'], additive: true, color: [GOLD_L, 0x8ef2c0], drag: 2.5, jitter: 0.4 });
      }
    }
  }
  private endFreeze(quick: boolean) {
    if (!this.freezing) return;
    this.freezing = false;
    this.ctx.engine.audio.play('whoosh', { volume: 0.5, pitch: quick ? 1.4 : 1.1 });
    if (this.dial) this.dial.group.visible = false;
    if (this.ripple) {
      this.ctx.engine.post.composer.removePass(this.ripple);
      this.ripple.dispose();
      this.ripple = null;
    }
  }

  private finish() {
    this.endFreeze(true);
    this.show = null;
    this.tl = null;
    this.stage.visible = false;
    if (this.specimen) {
      this.specimen.dispose();
      this.specimen = null;
    }
    this.title?.dispose();
    this.sub?.dispose();
    this.title = this.sub = null;
    if (this.anim) {
      this.anim.mode = 'idle';
      this.anim.lookAt = null;
    }
  }

  dispose() {
    this.finish();
    this.stage.removeFromParent();
    this.dial?.group.removeFromParent();
    for (const m of this.tiles) m.geometry.dispose();
    this.rig?.dispose();
  }
}

