// The rank-up's opening beat: a bullet-cam headshot.
// The world drops into slow motion while Sundown snaps his revolver onto the
// best target (nearest, in front, in sight, alive, a head if possible). He
// fires: the flash blooms in bullet time, the cylinder gap spits fire, a smoke
// ring rolls off the muzzle and a sculpted jacketed round leaves the barrel,
// spinning on its rifling, wrapped in heat shimmer, shedding air ripples, a
// spiral of hot dust and the sand it kicks up skimming the dunes. The camera
// rides just behind it and orbits as it closes in, then lets it go and watches
// it from the side: in through the face, out the back of the skull in a burst
// of bone splinters, mist and whatever the creature bleeds (the kill itself
// runs through the horde's normal damage path, so it is a normal kill with the
// normal gore: a burst skull, a severed head, a neck fountain). A hit-stop beat,
// then time snaps back and the shot hands straight over to the rank-up
// cinematic (RankUpCine) and its cards.
// With nothing in range a longhorn skull on a stake stands in and bursts.
// Full length (about 2.9 s) for the first few rank-ups of a run, a short cut
// (about 1.3 s) after that; click / space / tap skips it instantly.
// Everything here runs on real time and drives the camera after the scene's
// own update (CardPicker calls update() from its late hook).
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import { Particles } from './Particles';
import { fluidFor, FLUIDS, type Fluid } from './Gore';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, globalUniforms, type VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { VoxelModel } from '../../engine/voxel/VoxelModel';
import type { RigInstance } from '../../engine/voxel/Rig';
import { armIK } from '../anim/playerAnim';
import { hash3 } from '../../engine/math/rand';
import { bulletRound, boneShard, skullStake, SKULL_SEAT, SKULL_AIM, BULLET_LEN, BULLET_R, type ShardKind } from '../models/props/bulletCam';

// ------------------------------------------------------------------ host

export interface Shooter {
  root: THREE.Object3D;
  rig: RigInstance;
  gun: RigInstance;
  pos: THREE.Vector3;
  invuln: number;
  alive: boolean;
  express?: (name: string, dur: number) => void;
}

export interface BulletCamHost {
  shooter: Shooter;
  /** hide / show the run HUD */
  hud?: (on: boolean) => void;
  /** the player has the game paused (pause menu): the beat holds where it is */
  held?: () => boolean;
}

// ------------------------------------------------------------------ helpers

const sat = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
const sm = (k: number) => {
  k = sat(k);
  return k * k * k * (k * (k * 6 - 15) + 10);
};
const outBack = (k: number) => {
  k = sat(k);
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};
const lerp = THREE.MathUtils.lerp;
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const GRAIN = ['grain0', 'grain1', 'grain2', 'grain3', 'grain4', 'grain5'];
const PUFF = ['puff0', 'puff1', 'puff2', 'puff3', 'cloud0'];
const FLAME = ['flame0', 'flame1', 'flame2'];
const SAND = [0xf6dfb0, 0xeccb8f, 0xe0b373, 0xcf9a5a];
const BONE = [0xf3e8cf, 0xe1d0ab, 0xc9b994];
const SMOKE = [0xe6e0d6, 0xcfc8bc, 0xb8b0a4];

interface Pose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  roll: number;
}
const pose = (): Pose => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60, roll: 0 });
function mixPose(a: Pose, b: Pose, k: number, out: Pose) {
  out.pos.lerpVectors(a.pos, b.pos, k);
  out.look.lerpVectors(a.look, b.look, k);
  out.fov = lerp(a.fov, b.fov, k);
  out.roll = lerp(a.roll, b.roll, k);
  return out;
}
const copyPose = (o: Pose, a: Pose) => (o.pos.copy(a.pos), o.look.copy(a.look), (o.fov = a.fov), (o.roll = a.roll), o);

/** cubic Hermite distance profile: 0 → L over u ∈ [0,1], starting at slope m0, ending at m1 */
function hermite(u: number, L: number, m0: number, m1: number) {
  const u2 = u * u, u3 = u2 * u;
  return (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * L + (u3 - u2) * m1;
}

const NOISE_GLSL = /* glsl */ `
float rh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh(i), rh(i + vec2(1.0, 0.0)), f.x), mix(rh(i + vec2(0.0, 1.0)), rh(i + vec2(1.0, 1.0)), f.x), f.y); }`;

// ------------------------------------------------------------------ the beat's timing

interface Plan {
  fire: number;
  /** full cut: the side shot of the muzzle after the trigger */
  muzzle: number;
  /** trigger → entry */
  flight: number;
  /** the last stretch the camera lets the round go on alone */
  slow: number;
  /** entry → exit (inside the skull) */
  through: number;
  /** the burst developing in bullet time */
  burst: number;
  /** the hit-stop freeze */
  stop: number;
  /** after the snap, before the hand-off */
  hold: number;
}
const FULL: Plan = { fire: 0.42, muzzle: 0.3, flight: 1.55, slow: 0.42, through: 0.16, burst: 0.22, stop: 0.16, hold: 0.4 };
const SHORT: Plan = { fire: 0.2, muzzle: 0, flight: 0.6, slow: 0.2, through: 0.06, burst: 0.08, stop: 0.1, hold: 0.22 };

// ------------------------------------------------------------------ rigid voxel fragments

interface Piece {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  w: THREE.Vector3;
  r: number;
  life: number;
  rest: boolean;
  own: boolean;
}

/** splinters and skull fragments: tumble, bounce on the dunes, settle, sink into the sand */
class Pieces {
  list: Piece[] = [];
  constructor(private parent: THREE.Object3D, private groundAt: (x: number, z: number) => number) {}
  add(mesh: THREE.Mesh, v: THREE.Vector3, w: THREE.Vector3, r: number, life: number, own = false) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.parent.add(mesh);
    this.list.push({ mesh, v, w, r, life, rest: false, own });
  }
  update(dt: number) {
    if (dt <= 0) return;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const m = p.mesh;
      p.life -= dt;
      if (p.life <= 0) {
        m.removeFromParent();
        if (p.own) m.geometry.dispose();
        this.list.splice(i, 1);
        continue;
      }
      if (!p.rest) {
        p.v.y -= 13 * dt;
        m.position.addScaledVector(p.v, dt);
        const wl = p.w.length();
        if (wl > 1e-4) m.quaternion.premultiply(_q.setFromAxisAngle(_v.copy(p.w).divideScalar(wl), wl * dt));
        const g = this.groundAt(m.position.x, m.position.z) + p.r * 0.45;
        if (m.position.y < g) {
          m.position.y = g;
          if (p.v.y < -1.4) {
            p.v.y *= -0.28;
            p.v.x *= 0.55;
            p.v.z *= 0.55;
            p.w.multiplyScalar(0.5);
          } else {
            p.v.set(p.v.x * 0.7, 0, p.v.z * 0.7);
            p.w.multiplyScalar(0.7);
            if (Math.abs(p.v.x) + Math.abs(p.v.z) < 0.2) p.rest = true;
          }
        }
      } else if (p.life < 1.6) m.position.y -= dt * 0.05; // settles into the sand
    }
  }
  clear() {
    for (const p of this.list) {
      p.mesh.removeFromParent();
      if (p.own) p.mesh.geometry.dispose();
    }
    this.list.length = 0;
  }
}

// ------------------------------------------------------------------ air ripples (bullet-time shock rings)

const RIPPLES = 18;
class Ripples {
  private geo: THREE.BufferGeometry;
  private rings: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number; life: number; r1: number }[] = [];
  private next = 0;
  constructor(parent: THREE.Object3D) {
    // a ragged annulus (radial 0 inside .. 1 outside), the band itself is drawn by the shader
    const NA = 72, NR = 3;
    const pos: number[] = [], aux: number[] = [], idx: number[] = [];
    for (let i = 0; i <= NR; i++)
      for (let j = 0; j <= NA; j++) {
        const a = (j / NA) * Math.PI * 2, r = 0.45 + (i / NR) * 0.55;
        pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
        aux.push(i / NR, j / NA);
      }
    for (let i = 0; i < NR; i++)
      for (let j = 0; j < NA; j++) {
        const a = i * (NA + 1) + j, b = a + NA + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('aux', new THREE.Float32BufferAttribute(aux, 2));
    this.geo.setIndex(idx);
    for (let i = 0; i < RIPPLES; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uK: { value: 0 }, uSeed: { value: i * 3.7 }, uA: { value: 0 }, uT: globalUniforms.uTime },
        vertexShader: /* glsl */ `attribute vec2 aux; varying vec2 vA; varying float vF;
          void main(){ vA = aux; vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vec3 n = normalize(normalMatrix * vec3(0.0, 0.0, 1.0)); vF = abs(dot(n, normalize(-mv.xyz)));
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `uniform float uK, uSeed, uA, uT; varying vec2 vA; varying float vF;
          ${NOISE_GLSL}
          void main(){
            float ang = vA.y * 6.2831853;
            vec2 d = vec2(cos(ang), sin(ang));
            float n = rn(d * 2.6 + vec2(uSeed, uK * 2.0)) * 0.6 + rn(d * 7.0 - vec2(uSeed * 1.3, uT)) * 0.4;
            // a wobbling compression front with a softer rarefaction trailing inside it
            float c = 0.62 + (n - 0.5) * 0.3;
            float w = 0.09 + 0.08 * n;
            float front = exp(-pow((vA.x - c) / w, 2.0));
            float rare = exp(-pow((vA.x - c + 0.24) / (w * 1.6), 2.0)) * 0.35;
            // broken in places, like real distortion catching the light
            float gaps = smoothstep(0.18, 0.5, rn(d * 4.0 + vec2(uSeed * 2.1, 0.0)));
            float a = (front + rare) * gaps * uA * (1.0 - uK) * (1.0 - uK) * (0.35 + 0.65 * vF);
            if (a < 0.003) discard;
            vec3 col = mix(vec3(1.0, 0.93, 0.82), vec3(0.82, 0.92, 1.0), vA.x) * (front * 1.2 + rare * 0.6);
            gl_FragColor = vec4(col * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      parent.add(mesh);
      this.rings.push({ mesh, mat, t: 0, life: 1, r1: 0.1 });
    }
  }
  spawn(at: THREE.Vector3, dir: THREE.Vector3, r1: number, life: number, alpha: number, spin: number) {
    const R = this.rings[this.next];
    this.next = (this.next + 1) % this.rings.length;
    R.mesh.position.copy(at);
    R.mesh.quaternion.setFromUnitVectors(Z, dir).multiply(_q.setFromAxisAngle(Z, spin));
    R.t = 0;
    R.life = life;
    R.r1 = r1;
    R.mat.uniforms.uA.value = alpha;
    R.mesh.visible = true;
    R.mesh.scale.setScalar(0.001);
  }
  update(dt: number) {
    for (const R of this.rings) {
      if (!R.mesh.visible) continue;
      R.t += dt;
      const k = R.t / R.life;
      if (k >= 1) {
        R.mesh.visible = false;
        continue;
      }
      R.mat.uniforms.uK.value = k;
      R.mesh.scale.setScalar(R.r1 * (0.15 + 0.85 * (1 - Math.pow(1 - k, 2.2))));
    }
  }
  hide() {
    for (const R of this.rings) R.mesh.visible = false;
  }
  dispose() {
    for (const R of this.rings) {
      R.mesh.removeFromParent();
      R.mat.dispose();
    }
    this.geo.dispose();
  }
}

// ------------------------------------------------------------------ heat shimmer around the round

/** a sleeve of shimmering hot air trailing the round: a bow-shock flare at the nose easing out behind it */
class HeatWake {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(parent: THREE.Object3D) {
    const NS = 28, NA = 32, LEN = 0.75;
    const pos: number[] = [], aux: number[] = [], idx: number[] = [];
    for (let i = 0; i <= NS; i++) {
      const s = i / NS;
      // flare from just ahead of the nose, swelling out and fraying behind
      const r = 0.011 + 0.052 * Math.pow(s, 0.55) + 0.012 * Math.sin(s * 9.0) * s;
      for (let j = 0; j <= NA; j++) {
        const a = (j / NA) * Math.PI * 2;
        pos.push(Math.cos(a) * r, Math.sin(a) * r, -0.035 + s * LEN);
        aux.push(s, j / NA);
      }
    }
    for (let i = 0; i < NS; i++)
      for (let j = 0; j < NA; j++) {
        const a = i * (NA + 1) + j, b = a + NA + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aux', new THREE.Float32BufferAttribute(aux, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uA: { value: 0 } },
      vertexShader: /* glsl */ `attribute vec2 aux; varying vec2 vA; varying float vEdge; varying float vD;
        void main(){ vA = aux; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal); vEdge = 1.0 - abs(dot(n, normalize(-mv.xyz))); vD = -mv.z;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform float uT, uA; varying vec2 vA; varying float vEdge; varying float vD;
        ${NOISE_GLSL}
        void main(){
          float s = vA.x, ang = vA.y * 6.2831853;
          // Schlieren-like streaks pouring back off the round, wavering
          float st = rn(vec2(ang * 3.2 + sin(s * 7.0 - uT * 3.0) * 0.6, s * 9.0 - uT * 14.0));
          float st2 = rn(vec2(ang * 7.0, s * 21.0 - uT * 22.0));
          float lines = smoothstep(0.55, 0.95, st) * 0.8 + smoothstep(0.7, 1.0, st2) * 0.5;
          float along = smoothstep(0.0, 0.06, s) * pow(1.0 - s, 1.6);
          float a = (0.25 + lines) * along * (0.25 + vEdge * vEdge * 1.4) * uA;
          a *= smoothstep(0.1, 0.45, vD);
          if (a < 0.003) discard;
          vec3 col = mix(vec3(1.0, 0.86, 0.62), vec3(1.0, 0.97, 0.9), lines);
          gl_FragColor = vec4(col * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }
  set(at: THREE.Vector3, dir: THREE.Vector3, a: number, t: number) {
    this.mesh.visible = a > 0.01;
    this.mesh.position.copy(at);
    // the sleeve's +Z runs back along the path
    this.mesh.quaternion.setFromUnitVectors(Z, _v.copy(dir).negate());
    this.mat.uniforms.uA.value = a;
    this.mat.uniforms.uT.value = t;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------ voxel fracture

interface Frag {
  geo: THREE.BufferGeometry;
  /** centre in the source mesh's local space (meters) */
  c: THREE.Vector3;
  r: number;
  horn: boolean;
}

/** split a model into jagged Voronoi chunks (each meshed around its own centre) */
function fracture(model: VoxelModel, vs: number, pivot: [number, number, number], seeds: [number, number, number, number][]): Frag[] {
  const groups: VoxelModel[] = seeds.map(() => new VoxelModel('frag'));
  const sums = seeds.map(() => [0, 0, 0, 0]);
  model.forEach((x, y, z, rgb, f) => {
    let best = 0, bd = Infinity;
    const j = hash3(x, y, z) * 2.2; // ragged borders, not clean planes
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      const d = Math.hypot(x - s[0], y - s[1], z - s[2]) * (s[3] ? 0.55 : 1) + j;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    groups[best].set(x, y, z, rgb, f);
    const S = sums[best];
    S[0] += x;
    S[1] += y;
    S[2] += z;
    S[3]++;
  });
  const out: Frag[] = [];
  groups.forEach((g, i) => {
    const S = sums[i];
    if (S[3] < 3) return;
    const cx = S[0] / S[3] + 0.5, cy = S[1] / S[3] + 0.5, cz = S[2] / S[3] + 0.5;
    const b = g.bounds();
    const r = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) * vs * 0.5;
    out.push({ geo: buildVoxelGeometry(g, { voxelSize: vs, pivot: [cx, cy, cz] }), c: new THREE.Vector3((cx - pivot[0]) * vs, (cy - pivot[1]) * vs, (cz - pivot[2]) * vs), r, horn: !!seeds[i][3] });
  });
  return out;
}

// ------------------------------------------------------------------ targets

interface Target {
  kind: 'enemy' | 'skull';
  e: any;
  head: THREE.Vector3;
  /** head radius (m) */
  r: number;
  body: THREE.Vector3;
  fluid: Fluid;
  shard: ShardKind;
}

/** the stand-in when nothing is in range: a skull on a stake, placed where the camera is not looking yet */
class Stake {
  group = new THREE.Group();
  post: THREE.Mesh;
  skull: THREE.Mesh;
  seat = new THREE.Group();
  wob = 0;
  wobV = 0;
  axis = new THREE.Vector3(1, 0, 0);
  yawQ = new THREE.Quaternion();
  life = 40;
  broken = false;
  constructor(parent: THREE.Object3D, private model: { postGeo: THREE.BufferGeometry; skullGeo: THREE.BufferGeometry; at: [number, number, number]; tilt: number }, mat: THREE.Material) {
    this.post = new THREE.Mesh(model.postGeo, mat);
    this.skull = new THREE.Mesh(model.skullGeo, mat);
    for (const m of [this.post, this.skull]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    this.seat.position.set(model.at[0], model.at[1], model.at[2]);
    this.seat.rotation.x = model.tilt;
    this.seat.add(this.skull);
    this.group.add(this.post, this.seat);
    parent.add(this.group);
  }
  aim(out: THREE.Vector3) {
    this.group.updateMatrixWorld(true);
    return out.set(SKULL_AIM[0] - SKULL_SEAT[0], SKULL_AIM[1] - SKULL_SEAT[1], SKULL_AIM[2] - SKULL_SEAT[2]).applyMatrix4(this.skull.matrixWorld);
  }
  update(dt: number) {
    // the post shudders off the hit and rings down
    this.wobV += (-170 * this.wob - 7 * this.wobV) * dt;
    this.wob += this.wobV * dt;
    this.group.quaternion.setFromAxisAngle(this.axis, this.wob).multiply(this.yawQ);
  }
  dispose() {
    this.group.removeFromParent();
  }
}

// ------------------------------------------------------------------ the beat

export class BulletCam {
  /** the beat owns the camera */
  active = false;
  /** the beat has played out (or was skipped): hand over to the rank-up */
  finished = false;
  /** the grade at the hand-off (RankUpCine continues from it) */
  desat = 0;
  /** seconds since the trigger of the beat */
  t = 0;
  private P: Plan = FULL;
  private short = false;
  private host: BulletCamHost | null = null;
  private tg: Target | null = null;
  private p = new Particles();
  private mat: VoxelMaterial;
  private bulletGeo: THREE.BufferGeometry | null = null;
  private bullet: THREE.Mesh | null = null;
  private bulletSpin = new THREE.Group();
  private ripples: Ripples;
  private wake: HeatWake;
  private pieces: Pieces;
  private shardGeo = new Map<ShardKind, THREE.BufferGeometry[]>();
  private stakeModel: { postGeo: THREE.BufferGeometry; skullGeo: THREE.BufferGeometry; at: [number, number, number]; tilt: number; skullModel: VoxelModel; skullVs: number; seatV: [number, number, number] } | null = null;
  private stake: Stake | null = null;
  // the shot
  private M0 = new THREE.Vector3();
  private D = new THREE.Vector3(0, 0, 1);
  private right = new THREE.Vector3(1, 0, 0);
  private upP = new THREE.Vector3(0, 1, 0);
  private B = new THREE.Vector3();
  private heel = new THREE.Vector3();
  private mid = new THREE.Vector3();
  private dist = 0;
  private spin = 0;
  private fired = false;
  private entered = false;
  private exited = false;
  private frozen = false;
  private snapped = false;
  private resolved = false;
  private side = 1;
  private exitAt = new THREE.Vector3();
  private entryAt = new THREE.Vector3();
  private rippleT = 0;
  private kickT = 0;
  private trauma = 0;
  private fovKick = 0;
  private gone = false;
  // camera
  private run = pose();
  private cur = pose();
  private shotA = pose();
  private shotB = pose();
  private muzzleShot = pose();
  private witness = pose();
  // light from the pool in Fx (held while we need it)
  private light: { l: THREE.PointLight; t: number; dur: number; i0: number } | null = null;
  private lightI = 0;
  private lightCol = new THREE.Color();
  // the shooter's pose layer
  private baseQ: THREE.Quaternion[] = [0, 1, 2, 3, 4].map(() => new THREE.Quaternion());
  private wroteQ: THREE.Quaternion[] = [0, 1, 2, 3, 4].map(() => new THREE.Quaternion(NaN, NaN, NaN, NaN));
  private baseHam = 0;
  private wroteHam = NaN;
  private baseCyl = 0;
  private wroteCyl = NaN;
  private aimW = 0;
  private recoil = 0;
  private recoilV = 0;
  private cock = 0;
  private cocked = false;
  // saved state
  private saved = { desat: 0, ca: 0, vig: 0.32, radial: 0, rc: new THREE.Vector2(0.5, 0.5), input: true, invuln: 0 };
  private skipOn: ((e: Event) => void) | null = null;
  private skipReq = false;

  constructor(private ctx: Ctx) {
    this.p.groundAt = ctx.world.groundAt;
    ctx.scene.add(this.p.group);
    this.mat = makeVoxelMaterial({ roughness: 0.55 });
    this.ripples = new Ripples(ctx.scene);
    this.wake = new HeatWake(ctx.scene);
    this.pieces = new Pieces(ctx.scene, ctx.world.groundAt);
  }

  // ---------------------------------------------------------------- start

  /** the run's Enemies (the typed ctx.enemies only exposes the EnemyApi) */
  private get horde(): any {
    return this.ctx.enemies as any;
  }

  /**
   * Begin the beat. short: the quick cut for later rank-ups. Returns false
   * (and does nothing) when it cannot play here.
   */
  start(host: BulletCamHost, short: boolean): boolean {
    const sh = host.shooter;
    if (!sh || !sh.alive || !sh.rig?.nodes['arm_r'] || !sh.rig.nodes['fore_r'] || !sh.gun?.root?.parent) return false;
    const ctx = this.ctx;
    const eng = ctx.engine;
    this.host = host;
    this.short = short;
    this.P = short ? SHORT : FULL;
    this.t = 0;
    this.finished = false;
    this.fired = this.entered = this.exited = this.frozen = this.snapped = this.resolved = this.gone = false;
    this.dist = 0;
    this.spin = Math.random() * 6;
    this.trauma = 0;
    this.fovKick = 0;
    this.aimW = 0;
    this.recoil = this.recoilV = 0;
    this.cock = 0;
    this.cocked = false;
    this.rippleT = 0;
    this.kickT = 0;
    for (const q of this.wroteQ) q.set(NaN, NaN, NaN, NaN);
    this.wroteHam = this.wroteCyl = NaN;
    // the target
    const cam = ctx.camera;
    this.run.pos.copy(cam.position);
    cam.getWorldDirection(_v);
    this.run.look.copy(cam.position).addScaledVector(_v, 8);
    this.run.fov = cam.fov;
    this.run.roll = 0;
    copyPose(this.cur, this.run);
    this.tg = this.pickEnemy(sh) ?? this.plantStake(sh);
    if (!this.tg) return false;
    this.active = true;
    // a fresh line for the shot (the side the camera orbits toward)
    this.aimFrame(sh);
    this.side = this.right.dot(_v.copy(this.run.pos).sub(sh.pos)) >= 0 ? 1 : -1;
    // the world drops into bullet time; the hunter is untouchable and off the controls
    const u = eng.post.u;
    this.saved.desat = u.uDesat.value;
    this.saved.ca = u.uCA.value;
    this.saved.vig = u.uVignette.value;
    this.saved.radial = u.uRadial.value;
    this.saved.rc.copy(u.uRadialCenter.value);
    this.saved.input = eng.input.enabled;
    this.saved.invuln = sh.invuln;
    this.desat = this.saved.desat;
    eng.input.enabled = false;
    eng.input.setWantLock(false);
    sh.invuln = Math.max(sh.invuln, 60);
    eng.slowMo(0.05, 9);
    eng.letterbox(true, 0.3);
    eng.audio.setMuffle(0.45, 0.25);
    eng.flash(0xfff0c8, 0.22, 0.25);
    ctx.sfx('time_slow', null, 0.85);
    sh.express?.('focus', 3);
    host.hud?.(false);
    // a tap anywhere skips (touch layers swallow the canvas click)
    this.skipReq = false;
    this.skipOn = () => (this.skipReq = true);
    window.addEventListener('pointerdown', this.skipOn, true);
    return true;
  }

  // ---------------------------------------------------------------- targets

  /** world centre and radius of an enemy's head (its body if it has none) */
  private headOf(e: any, out: THREE.Vector3): number {
    const H = this.horde;
    const i = typeof e.part === 'function' ? e.part('head') : -1;
    if (i >= 0 && !e.hidden?.[i] && H?.gore?.partWorld) {
      const part = e.batch.geo.parts[i];
      const g = part.geo as THREE.BufferGeometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (H.gore.partWorld(e, i, _m)) {
        g.boundingBox!.getCenter(out).applyMatrix4(_m);
        const sc = _v3.setFromMatrixScale(_m).x;
        return Math.max(0.07, Math.min(0.6, g.boundingBox!.getSize(_v3).length() * 0.3 * sc));
      }
    }
    out.set(e.pos.x, e.pos.y + e.height * 0.62, e.pos.z);
    return Math.max(0.12, Math.min(0.8, e.radius * 0.65));
  }

  private shoulder(sh: Shooter, out: THREE.Vector3) {
    return sh.rig.nodes['arm_r'].getWorldPosition(out);
  }

  private clearLine(from: THREE.Vector3, to: THREE.Vector3, slack: number) {
    const w = this.ctx.world;
    const d = _v2.subVectors(to, from);
    const L = d.length();
    if (L < 0.5) return true;
    d.divideScalar(L);
    if (w.field.raycast(from.x, from.y, from.z, d.x, d.y, d.z, L - slack) >= 0) return false;
    const hit = { t: -1, c: null as any, nx: 0, nz: 0 };
    w.colliders.raycast(from.x, from.y, from.z, d.x, d.y, d.z, L - slack, hit);
    return hit.t < 0;
  }

  /** nearest, in front, in sight, alive, with a head if possible */
  private pickEnemy(sh: Shooter): Target | null {
    const H = this.horde;
    if (!H?.list) return null;
    const cam = this.ctx.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const S = this.shoulder(sh, new THREE.Vector3());
    let best: any = null, bs = Infinity;
    const head = new THREE.Vector3();
    for (const e of H.list as any[]) {
      if (!e.alive || e.isBoss || e.sandForm || e.state === 'hidden' || e.state === 'burrow' || e.state === 'spawn' || e.anim?.hidden || e.retreat > 0) continue;
      const dx = e.pos.x - sh.pos.x, dz = e.pos.z - sh.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 2 || d > 46) continue;
      const front = (dx * fwd.x + dz * fwd.z) / Math.max(d, 1e-3);
      if (front < -0.2) continue;
      const hi = typeof e.part === 'function' ? e.part('head') : -1;
      const hasHead = hi >= 0 && !e.hidden?.[hi] && e.batch?.geo?.parts?.[hi]?.parent >= 0;
      const score = d * (1 + (1 - front) * 0.9) * (hasHead ? 1 : 1.8) * (e.alpha ? 2.6 : 1) * (d < 3.5 ? 1.5 : 1);
      if (score >= bs) continue;
      this.headOf(e, head);
      if (!this.clearLine(S, head, 0.35)) continue;
      bs = score;
      best = e;
    }
    if (!best) return null;
    const t: Target = { kind: 'enemy', e: best, head: new THREE.Vector3(), r: 0.15, body: new THREE.Vector3(), fluid: 'blood', shard: 'blood' };
    t.r = this.headOf(best, t.head);
    t.body.set(best.pos.x, best.pos.y + best.height * 0.45, best.pos.z);
    t.fluid = fluidFor(best.def?.id ?? '', best.def?.hitKind ?? 'flesh', !!best.alpha);
    t.shard = t.fluid;
    return t;
  }

  private buildStake() {
    if (this.stakeModel) return this.stakeModel;
    const s = skullStake(Math.floor(Math.random() * 1000));
    const seatV: [number, number, number] = [SKULL_SEAT[0] / s.skull.voxelSize, SKULL_SEAT[1] / s.skull.voxelSize, SKULL_SEAT[2] / s.skull.voxelSize];
    this.stakeModel = {
      postGeo: buildVoxelGeometry(s.stake.model, { voxelSize: s.stake.voxelSize, pivot: [0, 0, 0] }),
      skullGeo: buildVoxelGeometry(s.skull.model, { voxelSize: s.skull.voxelSize, pivot: seatV }),
      at: s.skullAt,
      tilt: s.skullTilt,
      skullModel: s.skull.model,
      skullVs: s.skull.voxelSize,
      seatV,
    };
    return this.stakeModel;
  }

  /** nothing to shoot: a skull on a stake, set off to the side where the run camera is not looking yet */
  private plantStake(sh: Shooter): Target | null {
    const ctx = this.ctx;
    const w = ctx.world;
    const cam = ctx.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3()).setY(0);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const S = this.shoulder(sh, new THREE.Vector3());
    const n = new THREE.Vector3();
    let spot: THREE.Vector3 | null = null;
    const head = new THREE.Vector3();
    search: for (const deg of [68, -68, 82, -82, 54, -54, 38, -38, 20, -20, 0])
      for (const dist of [10.5, 8, 13.5]) {
        const a = (deg * Math.PI) / 180;
        const dir = _v.copy(fwd).multiplyScalar(Math.cos(a)).addScaledVector(right, Math.sin(a));
        const x = sh.pos.x + dir.x * dist, z = sh.pos.z + dir.z * dist;
        w.normal(x, z, n);
        if (n.y < 0.86) continue;
        let blocked = false;
        w.colliders.query(x, z, 1.1, () => (blocked = true));
        if (blocked) continue;
        const g = w.groundAt(x, z);
        head.set(x, g + 1.42, z);
        if (!this.clearLine(S, head, 0.3)) continue;
        spot = new THREE.Vector3(x, g, z);
        break search;
      }
    if (!spot) {
      const x = sh.pos.x + fwd.x * 7, z = sh.pos.z + fwd.z * 7;
      spot = new THREE.Vector3(x, w.groundAt(x, z), z);
    }
    const model = this.buildStake();
    this.stake?.dispose();
    const st = new Stake(ctx.scene, model, this.mat);
    st.group.position.copy(spot).add(_v.set(0, -0.04, 0));
    // the skull faces the hunter, turned a little for a three-quarter silhouette
    st.yawQ.setFromAxisAngle(UP, Math.atan2(sh.pos.x - spot.x, sh.pos.z - spot.z) + (Math.random() < 0.5 ? -0.45 : 0.45));
    st.group.quaternion.copy(st.yawQ);
    this.stake = st;
    const t: Target = { kind: 'skull', e: null, head: new THREE.Vector3(), r: 0.1, body: spot.clone().add(_v.set(0, 0.9, 0)), fluid: 'sand', shard: 'skull' };
    st.aim(t.head);
    return t;
  }

  private alive() {
    const tg = this.tg!;
    return tg.kind === 'skull' ? !this.stake?.broken : !!tg.e?.alive;
  }

  /** the shot line from the shoulder (before the trigger) or the muzzle (after) to the head */
  private aimFrame(sh: Shooter) {
    const tg = this.tg!;
    if (tg.kind === 'enemy' && tg.e?.alive) tg.r = this.headOf(tg.e, tg.head);
    else if (tg.kind === 'skull' && this.stake && !this.stake.broken) this.stake.aim(tg.head);
    const from = this.fired ? this.M0 : this.shoulder(sh, _v3);
    this.D.subVectors(tg.head, from);
    if (this.D.lengthSq() < 1e-6) this.D.set(0, 0, 1);
    this.D.normalize();
    this.right.crossVectors(this.D, UP);
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    this.upP.crossVectors(this.right, this.D).normalize();
  }

  // ---------------------------------------------------------------- per frame

  /**
   * dt: world seconds (scaled), rdt: real seconds. skip: a skip key went down.
   * Runs after the scene's update: poses the hunter, flies the round, writes the camera.
   */
  update(dt: number, rdt: number, skip: boolean) {
    const ctx = this.ctx;
    if (!this.active) {
      // leftovers keep falling: world time (or a slow crawl while the cards have the world frozen)
      const ldt = ctx.engine.paused ? rdt * 0.8 : dt;
      this.leftovers(ldt);
      return;
    }
    const sh = this.host!.shooter;
    const held = !!this.host!.held?.();
    if (!held) this.t += rdt;
    if ((skip || this.skipReq) && !held) {
      this.skipReq = false;
      this.skipNow();
      return;
    }
    this.skipReq = false;
    const P = this.P;
    const t = this.t;
    const T = this.times();
    // ---- beats
    if (!this.fired && t >= T.fire) this.fire(sh);
    if (this.fired && !this.entered && t >= T.entry) this.enter();
    if (this.entered && !this.exited && t >= T.exit) this.exit();
    if (this.exited && !this.frozen && t >= T.freeze) {
      this.frozen = true;
      ctx.engine.hitStop(P.stop + 0.02, 0);
    }
    if (this.frozen && !this.snapped && t >= T.snap) this.snap();
    if (this.fired && !this.entered && t >= T.slow0 && !this.kickT) {
      // the camera lets go: the world all but stops
      this.kickT = t;
      ctx.engine.slowMo(0.008, 10);
      ctx.sfx('bullet_whiz', this.tg!.head, 0.55, 0.42);
    }
    // ---- the line, the round
    this.aimFrame(sh);
    const fxRate = held ? 0 : this.fxRate(t, T);
    this.flyRound(t, T, rdt, fxRate);
    // ---- the hunter's draw, shot and follow-through
    this.poseShooter(sh, t, T, rdt);
    // ---- fx in bullet time
    const fdt = rdt * fxRate;
    this.p.update(fdt, ctx.world.env.fog as THREE.Fog | null);
    this.ripples.update(fdt);
    this.pieces.update(fdt);
    this.stake?.update(Math.min(fdt * 3, 0.05));
    this.updateLight(fdt);
    // ---- camera + grade
    this.camera(t, T, rdt);
    this.grade(t, T, rdt);
    if (t >= T.end) this.finish();
  }

  private times() {
    const P = this.P;
    const fire = P.fire;
    const entry = fire + P.flight;
    const exit = entry + P.through;
    const freeze = exit + P.burst;
    const snap = freeze + P.stop;
    return { fire, slow0: entry - P.slow, entry, exit, freeze, snap, end: snap + P.hold, cut: fire + P.muzzle };
  }

  private fxRate(t: number, T: ReturnType<BulletCam['times']>) {
    if (t < T.fire) return lerp(1, 0.3, sat(t / T.fire));
    if (t < T.slow0) return 0.16;
    if (t < T.exit) return 0.1;
    if (t < T.freeze) return 0.14;
    if (t < T.snap) return 0;
    return 1;
  }

  // ---------------------------------------------------------------- the round

  private ensureBullet() {
    if (this.bullet) return this.bullet;
    const r = bulletRound();
    this.bulletGeo = buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: 'center' });
    this.bullet = new THREE.Mesh(this.bulletGeo, this.mat);
    this.bullet.castShadow = false;
    this.bullet.frustumCulled = false;
    this.bulletSpin.add(this.bullet);
    this.bulletSpin.visible = false;
    this.ctx.scene.add(this.bulletSpin);
    return this.bullet;
  }

  /** the muzzle in world space, from the gun's own muzzle socket */
  private muzzle(sh: Shooter, out: THREE.Vector3) {
    const g = sh.gun;
    const mz = g.geo.spec.meta?.muzzle as [number, number, number] | undefined;
    const frame = g.nodes['frame'];
    if (frame && mz) {
      const vs = g.geo.spec.voxelSize;
      const piv = g.geo.spec.parts[0].pivot;
      frame.updateWorldMatrix(true, false);
      return frame.localToWorld(out.set((mz[0] - piv[0]) * vs, (mz[1] - piv[1]) * vs, (mz[2] - piv[2]) * vs));
    }
    return g.root.getWorldPosition(out);
  }

  private fire(sh: Shooter) {
    const ctx = this.ctx;
    this.fired = true;
    this.ensureBullet();
    sh.root.updateMatrixWorld(true);
    this.muzzle(sh, this.M0);
    this.aimFrame(sh);
    this.B.copy(this.M0);
    this.dist = 0;
    // the profile shot of the muzzle (full cut)
    const mz = this.muzzleShot;
    mz.pos.copy(this.M0).addScaledVector(this.right, 0.5 * this.side).addScaledVector(this.D, 0.22).addScaledVector(this.upP, 0.05);
    mz.look.copy(this.M0).addScaledVector(this.D, 0.3);
    mz.fov = 34;
    mz.roll = 0;
    this.recoilV += 22;
    this.cock = 0;
    this.trauma = Math.min(1, this.trauma + 0.35);
    ctx.engine.slowMo(0.025, 6);
    const M = this.M0, D = this.D, R = this.right, U = this.upP;
    const p = this.p;
    // the flash blooming in bullet time
    p.emit({ pos: _v.copy(M).addScaledVector(D, 0.05), count: 1, life: [0.1, 0.1], size: [0.22, 0.5], sprite: ['flash0', 'flash1', 'flash2'], additive: true, color: 0xfff0c0, sizeJitter: 0 });
    p.emit({ pos: _v.copy(M).addScaledVector(D, 0.03), count: 1, life: [0.16, 0.16], size: [0.4, 0.9], sprite: 'glow32', additive: true, color: 0xffb860, alpha: 0.7, sizeJitter: 0 });
    for (let i = 0; i < 12; i++) {
      const k = i / 11;
      p.emit({ pos: _v.copy(M).addScaledVector(D, 0.02 + k * 0.16), count: 1, vel: { x: D.x * (2 + k * 4), y: D.y * (2 + k * 4), z: D.z * (2 + k * 4) }, spread: 0.7, life: [0.07, 0.15], size: [0.075 - k * 0.04, 0.15 - k * 0.06], sprite: FLAME, additive: true, color: [0xffd27a, 0xff9a3a, 0xfff2c0], drag: 6, rot: 6 });
    }
    // the cylinder gap spits fire out both sides
    const cyl = sh.gun.nodes['cylinder'];
    const C = cyl ? cyl.getWorldPosition(_v2).addScaledVector(D, 0.03) : _v2.copy(M).addScaledVector(D, -0.13);
    for (const s of [-1, 1]) p.emit({ pos: C, count: 5, vel: { x: R.x * s * 2.6 + U.x * 0.5, y: R.y * s * 2.6 + U.y * 0.5, z: R.z * s * 2.6 + U.z * 0.5 }, spread: 0.7, life: [0.05, 0.1], size: [0.035, 0.08], sprite: FLAME, additive: true, color: [0xffc060, 0xfff0c0], drag: 9 });
    // burning powder grains, then smoke: a plume and a ring rolling off the muzzle
    p.emit({ pos: M, count: 30, vel: { x: D.x * 7, y: D.y * 7, z: D.z * 7 }, spread: 3.2, life: [0.12, 0.35], size: [0.022, 0.006], sprite: ['spark', 'streak'], additive: true, color: [0xffc060, 0xffe8a0, 0xff7a2a], drag: 2.4, gravity: 4, stretch: 0.03 });
    p.emit({ pos: _v.copy(M).addScaledVector(D, 0.1), count: 5, vel: { x: D.x * 1.3, y: D.y * 1.3, z: D.z * 1.3 }, spread: 0.45, life: [0.5, 0.9], size: [0.06, 0.3], sprite: PUFF, color: SMOKE, alpha: 0.5, drag: 2.4, rot: 6, rotSpeed: 0.5 });
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const dx = R.x * Math.cos(a) + U.x * Math.sin(a), dy = R.y * Math.cos(a) + U.y * Math.sin(a), dz = R.z * Math.cos(a) + U.z * Math.sin(a);
      p.emit({ pos: { x: M.x + D.x * 0.06 + dx * 0.03, y: M.y + D.y * 0.06 + dy * 0.03, z: M.z + D.z * 0.06 + dz * 0.03 }, count: 1, vel: { x: dx * 0.9 + D.x * 0.6, y: dy * 0.9 + D.y * 0.6, z: dz * 0.9 + D.z * 0.6 }, life: [0.55, 0.85], size: [0.045, 0.13], sprite: PUFF, color: SMOKE, alpha: 0.55, drag: 2.8, rot: 6, rotSpeed: 0.4 });
    }
    this.ripples.spawn(_v.copy(M).addScaledVector(D, 0.06), D, 0.32, 0.5, 1.4, Math.random() * 6);
    // hanging dust in the air along the line: it streaks past the riding camera
    const L = M.distanceTo(this.tg!.head);
    for (let i = 0; i < 140; i++) {
      const s = 0.8 + Math.random() * Math.max(0.5, L - 1);
      const a = Math.random() * Math.PI * 2, r = 0.14 + Math.random() * 0.75;
      const x = M.x + D.x * s + (R.x * Math.cos(a) + U.x * Math.sin(a)) * r;
      const y = M.y + D.y * s + (R.y * Math.cos(a) + U.y * Math.sin(a)) * r;
      const z = M.z + D.z * s + (R.z * Math.cos(a) + U.z * Math.sin(a)) * r;
      p.emit({ pos: { x, y, z }, count: 1, spread: 0.05, life: [2.2, 3.2], size: [0.012, 0.01], sprite: ['dot2', 'dot3'], color: [0xf3e2bc, 0xe6cf9f, 0xfff4dc], alpha: 0.8, drag: 0.5, fadeIn: 0.1 });
    }
    this.holdLight(M, 0xffb24a, 16);
    ctx.engine.flash(0xfff0c8, 0.16, 0.14);
    ctx.sfx('rev_shot', M, 1, 0.55);
    ctx.sfx('explosion', M, 0.28, 0.5);
    ctx.engine.tweens.after(0.22, () => ctx.sfx('bullet_whiz', this.B, 0.6, 0.48), true);
    if (!this.short) ctx.engine.tweens.after(0.5, () => ctx.sfx('heartbeat', null, 0.55, 0.85), true);
  }

  private flyRound(t: number, T: ReturnType<BulletCam['times']>, rdt: number, fxRate: number) {
    if (!this.fired || this.gone) return;
    const tg = this.tg!;
    const P = this.P;
    const L = Math.max(0.6, this.M0.distanceTo(tg.head) - tg.r * 0.8);
    const slowD = Math.min(1.1, L * 0.3);
    const thru = tg.r * 1.6;
    let d: number;
    if (t < T.slow0) {
      const Tc = T.slow0 - T.fire;
      const u = sat((t - T.fire) / Tc);
      const v0 = this.short ? 3.5 : 1.1, v1 = slowD / P.slow;
      d = hermite(u, L - slowD, v0 * Tc, v1 * Tc);
    } else if (t < T.entry) d = L - slowD + slowD * sat((t - T.slow0) / P.slow);
    else if (t < T.exit) d = L + thru * sat((t - T.entry) / P.through);
    else if (t < T.snap) d = L + thru + 0.03 + 0.12 * sat((t - T.exit) / Math.max(0.01, P.burst));
    else d = L + thru + 0.15 + (t - T.snap) * 46;
    this.dist = d;
    // the line from the muzzle to the (moving) head: its far end keeps tracking the target until it is hit
    this.B.copy(this.M0).addScaledVector(this.D, d);
    const nose = this.B;
    const heel = this.heel.copy(nose).addScaledVector(this.D, -BULLET_LEN);
    const mid = this.mid.copy(nose).addScaledVector(this.D, -BULLET_LEN * 0.5);
    // spin on the rifling (slow enough to read in bullet time)
    this.spin += rdt * (t < T.snap ? 13 : 40);
    this.bulletSpin.visible = true;
    this.bulletSpin.position.copy(mid);
    this.bulletSpin.quaternion.setFromUnitVectors(Z, this.D);
    this.bullet!.rotation.z = this.spin;
    // gone: off into the dunes after the snap
    if (t >= T.snap && t - T.snap > 0.35) {
      this.gone = true;
      this.bulletSpin.visible = false;
      this.wake.set(nose, this.D, 0, 0);
      return;
    }
    const inside = t >= T.entry && t < T.exit;
    const fdt = rdt * fxRate;
    const p = this.p;
    // shimmer, ripples, the spiral of hot dust off the heel, the air it shoves aside
    this.wake.set(nose, this.D, inside ? 0 : t < T.snap ? 1 : 0.4, this.ctx.engine.realTime);
    this.rippleT -= rdt;
    if (this.rippleT <= 0 && !inside && t < T.snap && fdt > 0) {
      this.rippleT = this.short ? 0.05 : 0.07;
      this.ripples.spawn(heel, this.D, 0.07 + Math.random() * 0.06, 0.55 + Math.random() * 0.3, 0.9, Math.random() * 6);
    }
    if (fdt > 0 && !inside) {
      const R = this.right, U = this.upP;
      for (let k = 0; k < 2; k++) {
        const a = this.spin * 0.6 + k * Math.PI;
        const r = BULLET_R * 1.6;
        const x = heel.x + (R.x * Math.cos(a) + U.x * Math.sin(a)) * r, y = heel.y + (R.y * Math.cos(a) + U.y * Math.sin(a)) * r, z = heel.z + (R.z * Math.cos(a) + U.z * Math.sin(a)) * r;
        p.emit({ pos: { x, y, z }, count: 1, life: [0.22, 0.32], size: [0.011, 0.003], sprite: 'glow8', additive: true, color: [0xffd8a0, 0xfff2d0], sizeJitter: 0 });
      }
      if (Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        const dx = R.x * Math.cos(a) + U.x * Math.sin(a), dy = R.y * Math.cos(a) + U.y * Math.sin(a), dz = R.z * Math.cos(a) + U.z * Math.sin(a);
        p.emit({ pos: { x: heel.x + dx * 0.03, y: heel.y + dy * 0.03, z: heel.z + dz * 0.03 }, count: 1, vel: { x: dx * 0.5, y: dy * 0.5, z: dz * 0.5 }, life: [0.4, 0.7], size: [0.008, 0.004], sprite: 'dot2', color: [0xf3e2bc, 0xfff4dc], alpha: 0.85, drag: 1.5 });
      }
      // skimming the dunes: the shock of it lifts a wake of pixel sand off the crest
      const g = this.ctx.world.groundAt(mid.x, mid.z);
      const h = mid.y - g;
      const k = sat(1 - h / 1.7);
      if (k > 0 && Math.random() < 0.35 + k) {
        const n = Math.ceil(k * 4);
        for (const s of [-1, 1]) {
          const ox = R.x * s, oz = R.z * s;
          const gx = mid.x + ox * (0.05 + Math.random() * 0.25), gz = mid.z + oz * (0.05 + Math.random() * 0.25);
          p.emit({ pos: { x: gx, y: this.ctx.world.groundAt(gx, gz) + 0.02, z: gz }, count: n, vel: { x: ox * (0.6 + k * 1.6) + this.D.x * 0.8, y: 0.9 + k * 2.4, z: oz * (0.6 + k * 1.6) + this.D.z * 0.8 }, spread: 0.6 + k, life: [0.6, 1.2], size: [0.02, 0.014], sprite: GRAIN, color: SAND, gravity: 6, drag: 0.8, ground: true, bounce: 0.1 });
          if (Math.random() < k * 0.5) p.emit({ pos: { x: gx, y: this.ctx.world.groundAt(gx, gz) + 0.05, z: gz }, count: 1, vel: { x: ox * 0.4, y: 0.4, z: oz * 0.4 }, spread: 0.2, life: [0.8, 1.4], size: [0.08, 0.3], sprite: PUFF, color: SAND, alpha: 0.5 * k, drag: 2, rot: 6, rotSpeed: 0.4 });
        }
      }
    }
  }

  // ---------------------------------------------------------------- impact

  private enter() {
    const ctx = this.ctx;
    this.entered = true;
    const tg = this.tg!;
    this.aimFrame(this.host!.shooter);
    const En = this.entryAt.copy(tg.head).addScaledVector(this.D, -tg.r * 0.8);
    const F = FLUIDS[tg.fluid];
    const p = this.p;
    const D = this.D;
    // back-spatter: bone dust and a fine spray kicked back along the shot
    p.emit({ pos: En, count: 16, vel: { x: -D.x * 1.5, y: -D.y * 1.5 + 0.2, z: -D.z * 1.5 }, spread: 1.4, life: [0.3, 0.7], size: [0.02, 0.01], sprite: F.sprite, color: tg.kind === 'skull' ? BONE : F.cols, gravity: F.gravity * 0.4, drag: 1.2, stretch: 0.01 });
    p.emit({ pos: En, count: 12, vel: { x: -D.x * 0.7, y: -D.y * 0.7, z: -D.z * 0.7 }, spread: 1.0, life: [0.4, 0.9], size: [0.018, 0.01], sprite: GRAIN, color: BONE, drag: 1.4, gravity: 3 });
    p.emit({ pos: En, count: 1, life: [0.14, 0.14], size: [0.06, 0.24], sprite: 'star4', additive: true, color: 0xfff0d0, sizeJitter: 0 });
    p.emit({ pos: En, count: 2, vel: { x: -D.x * 0.3, y: -D.y * 0.3, z: -D.z * 0.3 }, spread: 0.2, life: [0.5, 0.9], size: [0.04, 0.16], sprite: PUFF, color: tg.kind === 'skull' ? 0xeadcc0 : F.mist, alpha: 0.4, drag: 2.2 });
    this.ripples.spawn(En, D, tg.r * 1.4, 0.35, 1.6, 0);
    this.trauma = Math.min(1, this.trauma + 0.2);
    this.holdLight(En, 0xfff0d0, 5);
    ctx.engine.audio.setMuffle(0, 0.05);
    ctx.sfx('hit_bone', En, 0.95, 0.6);
    ctx.sfx('headshot', En, 0.6, 0.62);
  }

  private exit() {
    const ctx = this.ctx;
    this.exited = true;
    const tg = this.tg!;
    const D = this.D;
    const X = this.exitAt.copy(tg.head).addScaledVector(D, tg.r * 0.85);
    const F = FLUIDS[tg.fluid];
    const p = this.p;
    // the kill: through the horde's normal damage path (a headshot, burst skull, the fountain)
    this.resolve();
    // the exit burst in bullet time: splinters, a cone of spray, a blooming cloud of mist
    this.splinters(X, tg.shard, tg.kind === 'skull' ? 6 : 13, tg.r);
    const wet = tg.kind === 'skull' ? [0xeadcc0, 0xd9b276, 0xf3e8cf] : F.cols;
    const spr = tg.kind === 'skull' ? GRAIN : F.sprite;
    p.emit({ pos: X, count: 70, vel: { x: D.x * 5, y: D.y * 5 + 0.6, z: D.z * 5 }, spread: 3.0, gravity: F.gravity, drag: 0.5, life: [0.5, 1.2], size: [0.045, 0.022], sprite: spr, color: wet, stretch: 0.03, ground: true });
    p.emit({ pos: X, count: 34, vel: { x: D.x * 2.2, y: D.y * 2.2, z: D.z * 2.2 }, spread: 2.2, life: [0.6, 1.4], size: [0.018, 0.01], sprite: ['dot2', 'dot3'], color: wet, drag: 1.2, gravity: 2 });
    p.emit({ pos: _v.copy(X).addScaledVector(D, 0.08), count: 9, vel: { x: D.x * 1.5, y: D.y * 1.5, z: D.z * 1.5 }, spread: 1.0, life: [1.1, 2.0], size: [0.1, 0.55 + tg.r], sprite: PUFF, color: tg.kind === 'skull' ? [0xeadcc0, 0xf3e8cf] : F.mist, alpha: 0.5, drag: 1.8, rot: 6, rotSpeed: 0.4, jitter: 0.06 });
    p.emit({ pos: X, count: 20, vel: { x: D.x * 4, y: D.y * 4 + 0.5, z: D.z * 4 }, spread: 3.2, life: [0.6, 1.2], size: [0.03, 0.026], sprite: ['bone', 'pebble'], color: BONE, gravity: 13, ground: true, bounce: 0.3, rot: 6, rotSpeed: 12 });
    p.emit({ pos: X, count: 1, life: [0.12, 0.12], size: [0.3, 0.7], sprite: ['flash0', 'flash2'], additive: true, color: tg.kind === 'skull' ? 0xfff2d0 : 0xffd8c8, alpha: 0.7, sizeJitter: 0 });
    this.ripples.spawn(X, D, tg.r * 2.6, 0.5, 1.8, 1);
    this.trauma = Math.min(1, this.trauma + 0.7);
    this.fovKick -= 5;
    const u = ctx.engine.post.u;
    u.uCA.value = this.saved.ca + 0.024;
    ctx.engine.flash(tg.kind === 'skull' ? 0xfff2d8 : 0xffd8c8, 0.32, 0.2);
    ctx.sfx('hit_crit', X, 0.8, 0.7);
    ctx.sfx('explosion', X, 0.25, 0.65);
    if (tg.kind === 'skull') {
      ctx.sfx('hit_bone', X, 1, 0.75);
      ctx.sfx('rock_crumble', X, 0.6, 1.3);
      ctx.sfx('skeleton_rattle', X, 0.5, 0.8);
    }
  }

  /** the shot lands for real: the enemy dies through the normal damage path (or the skull bursts) */
  private resolve() {
    if (this.resolved) return;
    this.resolved = true;
    const tg = this.tg!;
    const D = this.D;
    if (tg.kind === 'skull') {
      this.burstSkull();
      return;
    }
    const e = tg.e;
    if (!e?.alive) return;
    const X = _v3.copy(tg.head).addScaledVector(D, tg.r * 0.85);
    const hi = typeof e.part === 'function' ? e.part('head') : -1;
    const hit = {
      base: Math.max(60, e.hp * 4 + 40),
      kind: 'true' as const,
      source: 'gun' as const,
      forceCrit: true,
      headshot: hi >= 0,
      knock: 4,
      dirX: D.x,
      dirZ: D.z,
      tags: [hi >= 0 ? 'head' : 'torso'],
    };
    try {
      this.ctx.enemies.damage(e, hit, X.clone(), D.clone());
    } catch (err) {
      console.warn('bullet cam: damage failed', err);
    }
    // anything that soaked it (shields, a sand-form) still goes down: it was the rank-up shot
    if (e.alive && typeof this.horde.kill === 'function') this.horde.kill(e, hit, D.x, D.z, true, false);
  }

  private shardGeos(kind: ShardKind) {
    let g = this.shardGeo.get(kind);
    if (!g) {
      g = [];
      for (let i = 0; i < 7; i++) {
        const s = boneShard(i + kind.length * 17, kind);
        g.push(buildVoxelGeometry(s.model, { voxelSize: s.voxelSize, pivot: 'center' }));
      }
      this.shardGeo.set(kind, g);
    }
    return g;
  }

  /** sculpted splinters of skull blown out of the exit along the shot */
  private splinters(X: THREE.Vector3, kind: ShardKind, n: number, r: number) {
    const geos = this.shardGeos(kind);
    const D = this.D;
    const sc = Math.max(0.7, Math.min(1.8, r / 0.13));
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geos[i % geos.length], this.mat);
      m.scale.setScalar(sc * (0.7 + Math.random() * 0.5));
      m.position.copy(X).addScaledVector(D, Math.random() * 0.04);
      m.quaternion.setFromEuler(_e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      const a = Math.random() * Math.PI * 2, c = Math.random() * 0.75;
      const v = D.clone().multiplyScalar(2.6 + Math.random() * 4.2);
      v.addScaledVector(this.right, Math.cos(a) * c * 3.2).addScaledVector(this.upP, Math.sin(a) * c * 3.2 + 0.8);
      const w = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(30);
      this.pieces.add(m, v, w, 0.02 * sc, 7 + Math.random() * 3);
    }
  }

  /** the longhorn skull bursts: jagged chunks of the real model, horns breaking off whole */
  private burstSkull() {
    const st = this.stake;
    const sm = this.stakeModel;
    if (!st || !sm || st.broken) return;
    st.broken = true;
    const vs = sm.skullVs;
    const b = sm.skullModel.bounds();
    const seeds: [number, number, number, number][] = [];
    // horns: two pieces each
    for (const s of [-1, 1]) {
      seeds.push([(s * 0.24) / vs, 0.045 / vs, -0.115 / vs, 1]);
      seeds.push([(s * 0.43) / vs, 0.15 / vs, -0.02 / vs, 1]);
    }
    // bone: a handful of chunks, smaller and denser where the round came out (the poll)
    let guard = 0;
    while (seeds.length < 20 && guard++ < 400) {
      const x = b.minX + Math.random() * (b.maxX - b.minX), y = b.minY + Math.random() * (b.maxY - b.minY), z = b.minZ + Math.random() * (b.maxZ - b.minZ);
      if (Math.abs(x * vs) > 0.13 || !sm.skullModel.has(Math.round(x), Math.round(y), Math.round(z))) continue;
      if (z * vs > 0.12 && Math.random() < 0.55) continue; // the long face breaks into fewer, bigger pieces
      seeds.push([x, y, z, 0]);
    }
    const frags = fracture(sm.skullModel, vs, sm.seatV, seeds);
    st.skull.visible = false;
    st.skull.updateMatrixWorld(true);
    const W = st.skull.matrixWorld;
    for (const f of frags) {
      const m = new THREE.Mesh(f.geo, this.mat);
      const c = f.c.clone().applyMatrix4(W);
      m.position.copy(c);
      W.decompose(_v, m.quaternion, _v2);
      const out = c.clone().sub(this.entryAt);
      const dd = out.length() || 1;
      out.divideScalar(dd);
      const v = f.horn
        ? out.multiplyScalar(1.2).addScaledVector(this.D, 1.3).add(_v.set(0, 2.2, 0))
        : out.multiplyScalar(1.6 + Math.random() * 1.6).addScaledVector(this.D, 2.2 + Math.random() * 2.6).add(_v.set(0, 1.2, 0));
      const w = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(f.horn ? 7 : 16);
      this.pieces.add(m, v, w, f.r, 9 + Math.random() * 3, true);
    }
    // the stake takes the shove and rings
    st.axis.crossVectors(UP, this.D).normalize();
    st.wobV += 1.8;
  }

  private snap() {
    const ctx = this.ctx;
    this.snapped = true;
    ctx.engine.slowMo(1, 22);
    ctx.engine.timeScale = Math.max(ctx.engine.timeScale, 0.45);
    ctx.sfx('whoosh_big', this.exitAt, 0.6, 1.05);
    this.trauma = Math.min(1, this.trauma + 0.25);
    this.host!.shooter.express?.('smug', 1.2);
  }

  // ---------------------------------------------------------------- the hunter

  /**
   * The draw, the shot and the follow-through, layered over whatever the
   * player's animation wrote this frame (it keeps riding in slow motion).
   */
  private poseShooter(sh: Shooter, t: number, T: ReturnType<BulletCam['times']>, rdt: number) {
    const P = this.P;
    // weight: snaps up with a little overshoot, lowers through the hold after the snap
    const up = outBack(t / (T.fire * 0.82));
    const down = t > T.snap ? sat((t - T.snap) / (P.hold * 0.85)) : 0;
    this.aimW = Math.max(0, Math.min(1.08, up)) * (1 - sm(down));
    // thumb back on the hammer while the arm comes up, it falls on the shot
    this.cock = this.fired ? 0 : sat((t - T.fire * 0.35) / (T.fire * 0.45));
    // recoil spring (real time: the hero is quicker than the world)
    const n = Math.max(1, Math.ceil(rdt / 0.008));
    for (let i = 0; i < n; i++) {
      const h = rdt / n;
      this.recoilV += (-150 * this.recoil - 13 * this.recoilV) * h;
      this.recoil += this.recoilV * h;
    }
    this.applyPose(sh, Math.min(1, this.aimW), this.recoil * 0.06);
    if (this.cock >= 0.5 && !this.cocked) {
      this.cocked = true;
      this.ctx.sfx('rev_hammer', sh.pos, 0.7, 0.72);
    }
  }

  private applyPose(sh: Shooter, w: number, rc: number) {
    const rig = sh.rig;
    const n = rig.nodes;
    const nodes = [n['torso'], n['arm_r'], n['fore_r'], n['head'], sh.gun.root];
    // the player's own pose this frame (or the one kept from before if it did not run)
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      if (nd && !nd.quaternion.equals(this.wroteQ[i])) this.baseQ[i].copy(nd.quaternion);
    }
    const ham = sh.gun.nodes['hammer'], cyl = sh.gun.nodes['cylinder'];
    if (ham && ham.rotation.x !== this.wroteHam) this.baseHam = ham.rotation.x;
    if (cyl && cyl.rotation.z !== this.wroteCyl) this.baseCyl = cyl.rotation.z;
    for (let i = 0; i < nodes.length; i++) nodes[i]?.quaternion.copy(this.baseQ[i]);
    if (ham) ham.rotation.x = this.baseHam + (-0.85 - this.baseHam) * this.cock;
    if (cyl) cyl.rotation.z = this.baseCyl + (this.fired ? Math.PI / 3 : (Math.PI / 3) * sm(this.cock));
    const [torso, armR, foreR, head] = nodes;
    const tgt = this.tg!.head;
    if (w > 1e-3 && torso && armR && foreR) {
      // twist the chest round toward the target
      rig.root.updateWorldMatrix(true, false);
      const al = _v.copy(tgt).applyMatrix4(_m.copy(rig.root.matrixWorld).invert());
      let yaw = Math.atan2(al.x, al.z);
      if (yaw > 2.4) yaw -= Math.PI * 2;
      _e.setFromQuaternion(torso.quaternion, 'XYZ');
      _e.y = lerp(_e.y, Math.max(-1.3, Math.min(1.3, yaw * 0.62)), w);
      torso.quaternion.setFromEuler(_e);
      torso.updateMatrixWorld(true);
      // straight-arm aim (the player rig's own two-bone IK), in the chest's frame
      const inv = _m.copy(torso.matrixWorld).invert();
      const aimT = _v.copy(tgt).applyMatrix4(inv);
      const upT = _v2.copy(UP).transformDirection(inv);
      const S = armR.position;
      const l1 = foreR.position.length();
      const hand = rig.sockets['hand_r'];
      const l2 = hand ? hand.position.length() : l1;
      const dA = _v3.copy(aimT).sub(S).normalize();
      const T = aimT.copy(S).addScaledVector(dA, (l1 + l2) * 0.965);
      const qU = new THREE.Quaternion(), qL = new THREE.Quaternion();
      armIK(S, T, new THREE.Vector3(-0.5, -0.85, -0.2), l1, l2, upT, qU, qL);
      armR.quaternion.slerp(qU, w);
      foreR.quaternion.slerp(qL, w);
      // the kick: the arm rides up off the shot
      if (Math.abs(rc) > 1e-4) {
        const axis = _v.crossVectors(this.D, UP).normalize();
        this.rotateWorld(armR, _q2.setFromAxisAngle(axis, rc * 0.45 * w));
      }
      armR.updateMatrixWorld(true);
      // wrist: the barrel onto the line from the hand to the head, kicking up on the shot
      const holder = sh.gun.root.parent!;
      if (hand) {
        hand.getWorldPosition(_v);
        const d = _v2.subVectors(tgt, _v);
        if (d.lengthSq() > 0.04) {
          const hq = holder.getWorldQuaternion(_q).invert();
          d.normalize().applyQuaternion(hq);
          const qc = _q2.setFromUnitVectors(Z, d);
          sh.gun.root.quaternion.slerp(qc, w);
          if (Math.abs(rc) > 1e-4) {
            sh.gun.root.updateMatrixWorld(true);
            const axis = _v.crossVectors(this.D, UP).normalize();
            this.rotateWorld(sh.gun.root, _q2.setFromAxisAngle(axis, rc * w));
          }
        }
      }
      // eyes and skull on the target
      if (head && head.parent) {
        head.updateWorldMatrix(true, false);
        const hp = head.getWorldPosition(_v);
        const hq = head.getWorldQuaternion(_q);
        const fw = _v2.set(0, 0, 1).applyQuaternion(hq);
        const to = _v3.copy(tgt).sub(hp).normalize();
        const dq = _q2.setFromUnitVectors(fw, to);
        const ang = 2 * Math.acos(Math.min(1, Math.abs(dq.w)));
        const k = Math.min(1, 0.9 / Math.max(ang, 1e-4)) * w * 0.85;
        const world = new THREE.Quaternion().slerp(dq, k).multiply(hq);
        head.quaternion.copy(head.parent.getWorldQuaternion(_q).invert().multiply(world));
      }
    }
    for (let i = 0; i < nodes.length; i++) if (nodes[i]) this.wroteQ[i].copy(nodes[i]!.quaternion);
    if (ham) this.wroteHam = ham.rotation.x;
    if (cyl) this.wroteCyl = cyl.rotation.z;
    sh.root.updateMatrixWorld(true);
  }

  /** rotate a node by a world-space rotation about its own pivot */
  private rotateWorld(nd: THREE.Object3D, qw: THREE.Quaternion) {
    const pq = nd.parent ? nd.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    const local = pq.clone().invert().multiply(qw).multiply(pq);
    nd.quaternion.premultiply(local);
  }

  /** put the hunter back exactly as his own animation left him */
  private restorePose() {
    const sh = this.host?.shooter;
    if (!sh) return;
    const n = sh.rig.nodes;
    const nodes = [n['torso'], n['arm_r'], n['fore_r'], n['head'], sh.gun.root];
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      if (nd && nd.quaternion.equals(this.wroteQ[i])) nd.quaternion.copy(this.baseQ[i]);
    }
    const ham = sh.gun.nodes['hammer'], cyl = sh.gun.nodes['cylinder'];
    if (ham && ham.rotation.x === this.wroteHam) ham.rotation.x = this.baseHam;
    if (cyl && cyl.rotation.z === this.wroteCyl) cyl.rotation.z = this.baseCyl;
    sh.root.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- camera

  private camera(t: number, T: ReturnType<BulletCam['times']>, rdt: number) {
    const ctx = this.ctx;
    const sh = this.host!.shooter;
    const cam = ctx.camera;
    const tg = this.tg!;
    const D = this.D, R = this.right, U = this.upP;
    const out = this.cur;
    const P = this.P;
    // the draw: over the gun shoulder, down the line to the target
    const S = this.shoulder(sh, _v);
    const draw = this.shotA;
    draw.pos.copy(S).addScaledVector(D, -0.78).addScaledVector(R, 0.3).addScaledVector(U, 0.16);
    draw.look.copy(S).addScaledVector(D, 6).addScaledVector(R, 0.12);
    draw.fov = 44;
    draw.roll = 0;
    if (!this.fired) {
      mixPose(this.run, draw, sm(t / (T.fire * 0.9)), out);
    } else {
      // the chase: just behind the round, orbiting as it closes in
      const u = sat((t - T.fire) / P.flight);
      const th = (0.12 + 0.95 * Math.pow(u, 1.5)) * this.side;
      const chase = this.shotB;
      const back = lerp(0.42, 0.3, u);
      const off = _v2.copy(U).multiplyScalar(Math.cos(th)).addScaledVector(R, Math.sin(th)).multiplyScalar(0.085);
      const tail = Math.min(this.dist, back);
      chase.pos.copy(this.M0).addScaledVector(D, Math.max(0, this.dist - tail - BULLET_LEN * 0.5)).add(off);
      chase.look.copy(this.B).addScaledVector(D, 2.4).addScaledVector(off, -0.6);
      chase.fov = lerp(52, 46, u);
      chase.roll = -th * 0.16;
      // the witness: off the side of the head, the round coming in across the frame
      const wsc = Math.max(1, tg.r / 0.13);
      const wit = this.witness;
      wit.pos.copy(tg.head).addScaledVector(D, -0.62 * wsc).addScaledVector(R, 0.78 * wsc * this.side).addScaledVector(U, 0.14 * wsc);
      wit.look.copy(tg.head).addScaledVector(D, -0.12 * wsc);
      wit.fov = 40;
      wit.roll = 0;
      if (!this.short && t < T.cut) {
        // full cut: hard cut to the muzzle in profile as the flash blooms
        copyPose(out, this.muzzleShot);
        // drift with the round
        out.look.lerp(this.B, 0.35);
      } else if (t < T.slow0) {
        const from = this.short ? draw : this.muzzleShot;
        const t0 = this.short ? T.fire : T.cut;
        const k = sm((t - t0) / (this.short ? 0.2 : 0.3));
        mixPose(from, chase, k, out);
      } else if (t < T.snap) {
        const k = sm((t - T.slow0) / (P.slow * 0.95));
        mixPose(chase, wit, k, out);
      } else {
        // after the snap: ease back to take in the body going down
        const k = sm((t - T.snap) / P.hold);
        copyPose(out, wit);
        out.pos.addScaledVector(D, -0.35 * k * wsc).addScaledVector(UP, 0.12 * k);
        out.look.lerp(tg.body, 0.3 * k);
        out.fov = lerp(wit.fov, 46, k);
      }
    }
    out.pos.y = Math.max(out.pos.y, ctx.world.groundAt(out.pos.x, out.pos.z) + 0.16);
    this.trauma = Math.max(0, this.trauma - rdt * 1.6);
    this.fovKick *= Math.exp(-rdt * 6);
    cam.position.copy(out.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(out.look);
    cam.rotateZ(out.roll);
    const s = this.trauma * this.trauma;
    if (s > 1e-4) {
      const q = this.ctx.engine.realTime * 29;
      cam.rotateX((Math.sin(q * 1.3) + Math.sin(q * 2.9 + 1.1) * 0.6) * 0.03 * s);
      cam.rotateY((Math.sin(q * 1.1 + 2.0) + Math.sin(q * 3.7) * 0.5) * 0.03 * s);
      cam.rotateZ(Math.sin(q * 1.7 + 4.0) * 0.045 * s);
    }
    cam.fov = out.fov + this.fovKick;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** bullet-time grade: drained colour, a vignette, speed blur round the round, a fringe on the hit */
  private grade(t: number, T: ReturnType<BulletCam['times']>, rdt: number) {
    const u = this.ctx.engine.post.u;
    const want = t < T.fire ? 0.32 : t < T.exit ? 0.44 : t < T.snap ? 0.18 : 0.3;
    this.desat += (want - this.desat) * (1 - Math.exp(-rdt * 7));
    u.uDesat.value = this.desat;
    u.uVignette.value = 0.32 + 0.24 * sat(t * 3);
    u.uCA.value = Math.max(this.saved.ca + 0.003, u.uCA.value - rdt * 0.05);
    // radial speed blur centred on the round while it flies, on the head when it hits
    let rad = 0;
    const at = _v.copy(this.fired && !this.entered ? this.B : this.tg!.head);
    if (this.fired && t < T.slow0) rad = 0.32 * sm((t - T.fire - 0.15) / 0.3);
    else if (this.exited && t < T.snap + 0.2) rad = 0.5 * Math.max(0, 1 - (t - T.exit) * 2.5);
    at.project(this.ctx.camera);
    if (at.z < 1) u.uRadialCenter.value.set(at.x * 0.5 + 0.5, at.y * 0.5 + 0.5);
    u.uRadial.value = rad;
  }

  // ---------------------------------------------------------------- light

  private holdLight(at: THREE.Vector3, col: number, intensity: number) {
    const lights = (this.ctx.fx as any).lights as { l: THREE.PointLight; t: number; dur: number; i0: number }[] | undefined;
    if (!lights?.length) return;
    if (!this.light) {
      let best = lights[0];
      for (const L of lights) if (L.t / L.dur > best.t / best.dur) best = L;
      this.light = best;
    }
    this.light.l.position.copy(at);
    this.light.l.distance = 6;
    this.lightCol.setHex(col);
    this.light.l.color.copy(this.lightCol);
    this.lightI = intensity;
  }

  private updateLight(fdt: number) {
    const L = this.light;
    if (!L) return;
    this.lightI *= Math.exp(-fdt * 22);
    // keep it ours: the pool's own fade never catches up
    L.t = 0;
    L.dur = 1e9;
    L.i0 = this.lightI;
    L.l.intensity = this.lightI;
  }

  private dropLight() {
    const L = this.light;
    if (!L) return;
    L.t = L.dur = 1;
    L.i0 = 0;
    L.l.intensity = 0;
    this.light = null;
  }

  // ---------------------------------------------------------------- the end

  /** a click / space / tap: the shot lands now and the rank-up takes over */
  skipNow() {
    if (!this.active) return;
    if (!this.fired) {
      const sh = this.host!.shooter;
      sh.root.updateMatrixWorld(true);
      this.muzzle(sh, this.M0);
      this.fired = true;
    }
    this.aimFrame(this.host!.shooter);
    if (!this.exited) {
      this.exitAt.copy(this.tg!.head).addScaledVector(this.D, this.tg!.r * 0.85);
      this.entryAt.copy(this.tg!.head).addScaledVector(this.D, -this.tg!.r * 0.8);
      this.resolve();
      if (this.tg!.kind === 'enemy') this.splinters(this.exitAt, this.tg!.shard, 6, this.tg!.r);
    }
    this.finish();
  }

  private finish() {
    if (!this.active) return;
    const ctx = this.ctx;
    const eng = ctx.engine;
    const sh = this.host!.shooter;
    this.active = false;
    this.finished = true;
    this.restorePose();
    this.bulletSpin.visible = false;
    this.wake.set(this.B, this.D, 0, 0);
    this.ripples.hide();
    this.dropLight();
    eng.input.enabled = this.saved.input;
    sh.invuln = Math.max(this.saved.invuln, 1.2);
    const u = eng.post.u;
    u.uCA.value = this.saved.ca;
    u.uRadial.value = this.saved.radial;
    u.uRadialCenter.value.copy(this.saved.rc);
    // the grade carries on into the rank-up (it reads the saved value, then continues from ours)
    u.uDesat.value = this.saved.desat;
    eng.slowMo(1, 22);
    if (this.skipOn) window.removeEventListener('pointerdown', this.skipOn, true);
    this.skipOn = null;
  }

  /** splinters, skull chunks and the stake after the beat */
  private leftovers(dt: number) {
    if (dt <= 0) return;
    this.p.update(dt, this.ctx.world.env.fog as THREE.Fog | null);
    this.ripples.update(dt);
    this.pieces.update(dt);
    const st = this.stake;
    if (st) {
      st.update(Math.min(dt, 0.05));
      st.life -= dt;
      if (st.life < 2) st.group.position.y -= dt * 0.9;
      if (st.life <= 0) {
        st.dispose();
        this.stake = null;
      }
    }
  }

  /** the beat is over (or never ran) and nothing of it is left to animate */
  get idle() {
    return !this.active && this.pieces.list.length === 0 && this.p.count === 0 && !this.stake;
  }

  dispose() {
    if (this.active) {
      this.finish();
      this.host?.hud?.(true);
    }
    if (this.skipOn) window.removeEventListener('pointerdown', this.skipOn, true);
    this.pieces.clear();
    this.stake?.dispose();
    this.stake = null;
    this.ripples.dispose();
    this.wake.dispose();
    this.p.group.removeFromParent();
    this.bulletSpin.removeFromParent();
    this.bulletGeo?.dispose();
    for (const gs of this.shardGeo.values()) for (const g of gs) g.dispose();
    if (this.stakeModel) {
      this.stakeModel.postGeo.dispose();
      this.stakeModel.skullGeo.dispose();
    }
    this.mat.dispose();
  }
}
