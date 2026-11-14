// The Avatar of Khonsu, Lord of the Shifting Sands — wave 75. Khonsu comes back
// as the desert itself: a ~33 m sandstone colossus that rises out of a swelling
// dune, rules the desert floor (every attack moves the real sand through
// world.sand, so boards, enemies and props ride it), turns the horde into
// sand-forms and pours a fresh army out of his palms.
//   Phase 1 (100–66%)  Helter Skelter (rolling dune walls: surf or jump the
//                      crest), Mr. Brownstone (fist slam: ring wave + a line of
//                      sandstone spikes), Start Me Up (scoops the dune and
//                      flings it)
//   Phase 2 (66–33%)   + Brown Sugar (every enemy is engulfed and becomes a
//                      sand-form; a wave of new ones rises out of the sand he
//                      pours; the heart flares while he works)
//   Phase 3 (33–0%)    + Come Together (a sinking vortex pulls you in while the
//                      ribcage opens on the moon heart), Shattered (two-fisted
//                      slam, three spike lines), Gimme Shelter (he collapses
//                      into a colossal tsunami you must surf) → Get Back (he
//                      re-forms elsewhere, heart first)
//   Death: an avalanche into the dune, a last ring wave flattens the arena, the
//   moon mask drops into the sand and cracks, and the light comes back.
// THE MOON RULES THE TIDES OF SAND (bosses/khonsu/LunarKit): his entrance sinks the sun
// and raises his moon over the dune (Undercover of the Night); Child of the Moon (the
// moon draws the desert after it: a broad flood of sand rolls across the arena toward
// the moon, then the backwash rolls back; drag the moon close first and it is a spring
// tide), Shine a Light (moonbeams), Patience (clock dials of slow time), from phase 2
// Lucy in the Sky with Diamonds (crescent shards) and Tomorrow Never Knows (the
// hourglass in front of his chest stops his shots mid-air), in phase 3 November Rain
// (the moon cracks open) and once Ruby Tuesday (blood eclipse: his heart burns open in
// the dark while red beams spiral out of him). Yesterday rewinds a volley you slipped.
// His first fall opens the Nile and frees Mark (meta/StageUnlocks): the cracked mask
// lets its moonlight go, and it rides off toward the river (khonsu/MoonReveal).
// Weak points: eyes (×2.2), head (×1.5), the moon core (×2.5 only while the
// chest is open), hands while they are planted after a slam.
import * as THREE from 'three';
import { Boss, BossDeps, HitSphere } from './Boss';
import type { RayHit } from '../Ctx';
import type { Hit } from '../combat/Damage';
import type { Enemy } from '../enemies/Enemies';
import { ENEMIES } from '../enemies/EnemyDefs';
import { SAND_MAX } from '../world/SandWaves';
import type { SandShape, SandShapeOpts } from '../world/SandWaves';
import { LunarKit } from './khonsu/LunarKit';
import { LunarSky } from './khonsu/LunarSky';
import { grantKhonsuSand } from '../meta/StageUnlocks';
import { playMoonReveal } from './khonsu/MoonReveal';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { khonsuSandSpikeModel, KS_VOXELS_PER_M } from '../models/enemies/khonsuSand';
import { P } from '../../engine/voxel/palette';
import { rnd, damp, clamp, dampAngle } from '../../engine/math/rand';

const SANDC = '#f3d29a';
const MOONC = '#cfe8ff';
const G = KS_VOXELS_PER_M.toFixed(1);
/** the breathing dune he stands in: its apron is the outer half of his skirt */
const MOUND_H = 5.4;
const MOUND_W = 7.6;
const GRAINS = ['grain0', 'grain1', 'grain2', 'grain3'];
const PUFFS = ['puff0', 'puff1', 'puff2', 'cloud0'];
const SANDS = [P.sand1, P.sand0, P.sand2, P.sand3];
const POUR_LEN: Record<string, number> = { pour_sh1: 7.5, pour_sh2: 6.2, pour_el: 6.4, pour_beak: 3.8 };
const ARMY = ['husk', 'husk', 'mummy', 'jackal', 'sandWolf', 'gunslinger', 'bandageWhipper', 'scarab'];

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _T = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qf = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qi = new THREE.Quaternion();

/**
 * The boss's own sand material: the game's cel/ink voxel shader plus grains
 * creeping down the stone, voxel ripples on every shelf of loose sand, moonlight
 * pulsing up the cracks, and (pours) falling sand that streams and tears apart.
 */
function sandMaterial(kind: 'body' | 'pour', fx: { value: THREE.Vector4 }): VoxelMaterial {
  const m = makeVoxelMaterial({ roughness: 0.96 });
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    sh.uniforms.uFx = fx; // one fx for every boss material: flash, crumble, crack glow
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vKsLocal;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvKsLocal = position;');
    let f = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vKsLocal;');
    if (kind === 'pour') {
      f = f
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          {
            vec3 cell = floor(vec3(vWPos.x * ${G}, (vWPos.y + uTime * 5.5) * ${G}, vWPos.z * ${G}));
            float tear = smoothstep(-1.5, -9.0, vKsLocal.y);
            if (vhash(cell + 17.0) < 0.06 + tear * 0.55) discard;
          }`
        )
        .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb *= 0.9 + 0.16 * sin((vWPos.y + uTime * 5.5) * 3.1 + vhash(floor(vWPos * 3.0)) * 2.0);`);
    } else {
      f = f
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if (vMatx.x < 0.05) diffuseColor.rgb *= 0.97 + 0.06 * vhash(floor(vWPos * ${G} + vec3(0.0, uTime * 1.1, 0.0)));`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            vec3 ksN = inverseTransformDirection(normal, viewMatrix);
            if (ksN.y > 0.6 && vMatx.x < 0.05) {
              vec2 q = floor(vKsLocal.xz * ${G}) / ${G};
              float rp = sin(q.x * 2.3 + q.y * 1.1 + sin(q.y * 0.6 + q.x * 0.2) * 1.4);
              diffuseColor.rgb *= rp > 0.55 ? 1.07 : rp < -0.55 ? 0.93 : 1.0;
            }
          }`
        )
        .replace(
          'totalEmissiveRadiance += diffuseColor.rgb * (vMatx.x * uEmissiveStrength * (1.0 + vFx.z));',
          'totalEmissiveRadiance += diffuseColor.rgb * (vMatx.x * uEmissiveStrength * (1.0 + vFx.z) * (0.72 + 0.28 * sin(uTime * 1.7 - vWPos.y * 0.42 + sin(vWPos.x * 0.3) * 1.5)));'
        );
    }
    sh.fragmentShader = f.replace('vec3(1.0, 0.55, 0.15) * dissolveEdge * 1.2', 'vec3(0.95, 0.82, 0.55) * dissolveEdge * 0.55');
  };
  m.customProgramCacheKey = () => 'khonsu-sand-' + kind + '-v1';
  m.userData.fx = fx;
  return m;
}

let SPIKE_GEOS: THREE.BufferGeometry[] | null = null;
function spikeGeos() {
  if (!SPIKE_GEOS)
    SPIKE_GEOS = [0, 1, 2].map((s) => {
      const m = khonsuSandSpikeModel(s);
      return buildVoxelGeometry(m.model, { voxelSize: m.voxelSize, pivot: [0.5, 0, 0.5] });
    });
  return SPIKE_GEOS;
}

interface ArmJ {
  S: THREE.Vector3;
  E: THREE.Vector3;
  W: THREE.Vector3;
  K: THREE.Vector3;
  fist: THREE.Vector3;
  palm: THREE.Vector3;
  L1: number;
  u0: THREE.Vector3;
  fingers: THREE.Vector3[];
  thumb: THREE.Vector3;
  wristAxis: THREE.Vector3;
}
interface ArmCtl {
  mode: 'rest' | 'aim';
  tgt: THREE.Vector3;
  now: THREE.Vector3;
  rate: number;
  curl: number;
  curlNow: number;
  wrist: number;
  wristNow: number;
  pole: THREE.Vector3;
}
interface Wave {
  shape: SandShape;
  kind: 'ridge' | 'ring';
  dmg: number;
  knock: number;
  hit: boolean;
  crossed: boolean;
  prev: number;
  harmless?: boolean;
}
interface Spike {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  h: number;
  r: number;
  t: number;
  hold: number;
  hit: boolean;
}

export class KhonsuSandAvatar extends Boss {
  private body: VoxelMaterial;
  private pour: VoxelMaterial;
  private maskMat: VoxelMaterial | null = null;
  private J: ArmJ[] = [];
  private arms: ArmCtl[] = [];
  private bendT = 0.14;
  private bendNow = 0.14;
  private twistT = 0;
  private twistNow = 0;
  private chestT = 0;
  private chestNow = 0;
  private glowT = 0.15;
  private glowNow = 0;
  private sunk = 0;
  private submerged = false;
  private planted = 0;
  private turnRate = 0.7;
  private moundOn = true;
  private moundBoost = 0;
  private moundShape: SandShape | null = null;
  private mine: SandShape[] = [];
  private waves: Wave[] = [];
  private spikes: Spike[] = [];
  private pit: { shape: SandShape; x: number; z: number; tick: number } | null = null;
  private coreLight: THREE.PointLight;
  /** the night, the moon and time (bosses/khonsu/LunarKit) */
  lunar: LunarKit;
  private moonCds = { tide: 6, rain: 0, ruby: false };
  private sandForms = new Map<Enemy, boolean>();
  private crumbles: { batch: unknown; until: number }[] = [];
  private offKill: (() => void) | null = null;
  private queue: string[] = [];
  private cds = { sugar: 8, together: 0, shelter: 0 };
  private lastAttack = '';
  private lastCallout = '';
  private pourNodes: { node: THREE.Object3D; len: number; hand: number }[] = [];
  private handPour = [0, 0];
  private headGroup: THREE.Object3D | null = null;
  private fxT = 0;
  private coreSphere: HitSphere;
  private eyeSpheres: HitSphere[];
  private handSpheres: HitSphere[];
  private eyeAxis: THREE.Vector3[];
  private dead = false;
  private firstFall = false;
  private maskDown = false;

  constructor(d: BossDeps) {
    super(d, 'khonsu_sand', { name: 'Avatar of Khonsu', title: 'Lord of the Shifting Sands', hp: 2600 * 6, scale: 1, eyes: ['glow', 0x9fd0ff] });
    this.armor = 46;
    this.physRes = 0.12;
    this.magicRes = 0.18;
    this.bounty = 1200;
    this.gold = 520;
    this.phases = [0.66, 0.33];
    this.flying = true; // he sits in the dune; update() places him
    this.squash.kick = () => {}; // a 33 m giant does not wobble like jelly
    const ctx = this.ctx;
    const meta = this.rig.geo.spec.meta ?? {};
    // ------------------------------------------------------------------ materials
    const fx = this.rig.material.userData.fx;
    this.body = sandMaterial('body', fx);
    this.pour = sandMaterial('pour', fx);
    const pours = new Set<string>((meta.pours as string[]) ?? []);
    for (const [name, mesh] of Object.entries(this.rig.meshes)) {
      const p = pours.has(name);
      mesh.material = p ? this.pour : this.body;
      if (p) mesh.castShadow = false;
    }
    this.rig.material.dispose();
    this.rig.material = this.body;
    for (const name of pours) {
      const node = this.rig.nodes[name];
      if (!node) continue;
      const key = name.replace(/_[lr]$/, '');
      const hand = name === 'pour_hand_l' ? 0 : name === 'pour_hand_r' ? 1 : -1;
      this.pourNodes.push({ node, len: POUR_LEN[key] ?? 12, hand });
      if (hand >= 0) node.visible = false;
    }
    if (this.rig.nodes['mask_crack']) this.rig.nodes['mask_crack'].visible = false;
    // ------------------------------------------------------------------ rig data (rig-local metres, right side mirrored)
    const ik = meta.ik;
    const mx = (meta.mirrorX as number) ?? 0;
    for (const s of [0, 1]) {
      const pt = (v: number[]) => (s === 0 ? new THREE.Vector3(v[0], v[1], v[2]) : new THREE.Vector3(mx - v[0], v[1], v[2]));
      const ax = (v: number[]) => (s === 0 ? new THREE.Vector3(v[0], v[1], v[2]) : new THREE.Vector3(v[0], -v[1], -v[2])); // rotation axes mirror as pseudo-vectors
      const S = pt(ik.shoulder), E = pt(ik.elbow);
      this.J.push({ S, E, W: pt(ik.wrist), K: pt(ik.knuckle), fist: pt(ik.fist), palm: pt(ik.palm), L1: S.distanceTo(E), u0: E.clone().sub(S).normalize(), fingers: (ik.fingerAxes as number[][]).map(ax), thumb: ax(ik.thumbAxis), wristAxis: ax(ik.handX) });
      this.arms.push({ mode: 'rest', tgt: new THREE.Vector3(), now: new THREE.Vector3(), rate: 2.2, curl: 0.45, curlNow: 0.45, wrist: 0, wristNow: 0, pole: new THREE.Vector3(s === 0 ? 0.8 : -0.8, -0.2, -0.55).normalize() });
    }
    const ea = meta.eyeAxis as number[];
    this.eyeAxis = [new THREE.Vector3(ea[0], ea[1], ea[2]).normalize(), new THREE.Vector3(-ea[0], ea[1], ea[2]).normalize()];
    // ------------------------------------------------------------------ hit spheres (node-local offsets)
    const rest = (name: string) => {
      const out = new THREE.Vector3();
      let n: THREE.Object3D | null = this.rig.nodes[name] ?? null;
      while (n && n !== this.rig.root) {
        out.add(n.position);
        n = n.parent;
      }
      return out;
    };
    const off = (name: string, p: number[] | THREE.Vector3): [number, number, number] => {
      const v = (Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : p.clone()).sub(rest(name));
      return [v.x, v.y, v.z];
    };
    const mir = (p: number[]) => [mx - p[0], p[1], p[2]];
    this.eyeSpheres = [
      { node: 'eye_l', r: 1.0, part: 'eye', weak: 2.2 },
      { node: 'eye_r', r: 1.0, part: 'eye', weak: 2.2 },
    ];
    this.coreSphere = { node: 'core', r: 1.9, part: 'core', weak: 0.4, offset: [0, 0, 0.45] };
    this.handSpheres = [
      { node: 'hand_l', r: 2.6, part: 'hand', weak: 0.9, offset: off('hand_l', this.J[0].palm) },
      { node: 'hand_r', r: 2.6, part: 'hand', weak: 0.9, offset: off('hand_r', this.J[1].palm) },
    ];
    this.hitSpheres = [
      ...this.eyeSpheres,
      this.coreSphere,
      { node: 'head', r: 2.8, part: 'head', weak: 1.5, offset: off('head', meta.skull) },
      ...this.handSpheres,
      { node: 'torso', r: 4.8, part: 'torso', weak: 0.7, offset: off('torso', [0, 18.0, -2.4]) },
      { node: 'spine', r: 4.6, part: 'body', weak: 0.6, offset: off('spine', [0, 8.8, 0.6]) },
      { node: 'ribs_l', r: 2.3, part: 'ribs', weak: 0.4, offset: off('ribs_l', [2.5, 15, 4.2]) },
      { node: 'ribs_r', r: 2.3, part: 'ribs', weak: 0.4, offset: off('ribs_r', mir([2.5, 15, 4.2])) },
      { node: 'arm_l', r: 2.3, part: 'arm', weak: 0.6, offset: off('arm_l', [10.1, 14.1, 1.8]) },
      { node: 'arm_r', r: 2.3, part: 'arm', weak: 0.6, offset: off('arm_r', mir([10.1, 14.1, 1.8])) },
      { node: 'fore_l', r: 2.0, part: 'arm', weak: 0.6, offset: off('fore_l', [13.5, 5.6, 5.05]) },
      { node: 'fore_r', r: 2.0, part: 'arm', weak: 0.6, offset: off('fore_r', mir([13.5, 5.6, 5.05])) },
    ];
    this.radius = 7.5;
    // ------------------------------------------------------------------ light, env, spikes, sand-forms
    this.coreLight = new THREE.PointLight(0x9fd0ff, 0, 18, 1.6);
    this.coreLight.position.set(0, 0, 1.4);
    (this.rig.nodes['core'] ?? this.root).add(this.coreLight);
    this.lunar = new LunarKit(this, { scale: 2.4, elev: 21, size: 11, callout: (s) => this.callout(s) });
    spikeGeos();
    this.offKill = ctx.events.on('enemyKilled', (e: Enemy) => this.onEnemyKilled(e));
    (window as any).__khonsuSand = this; // dev handle: __khonsuSand.debug('helterSkelter')
  }

  protected hitKind() {
    return 'sand' as any;
  }

  // ------------------------------------------------------------------ helpers
  private callout(song: string) {
    if (song === this.lastCallout) return;
    this.lastCallout = song;
    this.ctx.toast(`« ${song} »`, SANDC, 'Avatar of Khonsu');
    this.ctx.engine.tweens.after(2, () => (this.lastCallout = ''));
  }
  private say(lines: string[]) {
    this.taunt(rnd.pick(lines), SANDC);
  }
  private ground(x: number, z: number) {
    return this.ctx.world.groundAt(x, z);
  }
  /** the dune without any living sand on it */
  private baseGround(x: number, z: number) {
    const w = this.ctx.world;
    return Math.max(w.sa.field.heightSmooth(x, z), w.sa.waterLevel);
  }
  private predicted(t: number) {
    const v = this.player.board.vel;
    return this.playerPos().clone().addScaledVector(_w.set(v.x, 0, v.z), t);
  }
  /** a slam point toward p, kept inside his reach */
  private reachPoint(p: THREE.Vector3, min = 6.5, max = 24.5) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const r = clamp(d, min, max);
    const x = this.pos.x + (dx / d) * r, z = this.pos.z + (dz / d) * r;
    return new THREE.Vector3(x, this.ground(x, z), z);
  }
  /** world point of an arm's effector (fist or palm under the knuckles) */
  private handWorld(s: number, out: THREE.Vector3, fist = false) {
    const J = this.J[s];
    const hand = this.rig.nodes[s === 0 ? 'hand_l' : 'hand_r'];
    out.copy(fist ? J.fist : J.K).sub(J.W);
    hand.updateWorldMatrix(true, false);
    return hand.localToWorld(out);
  }
  private socketWorld(name: string, out: THREE.Vector3) {
    const s = this.rig.sockets[name];
    if (s) s.getWorldPosition(out);
    else out.set(this.pos.x, this.pos.y + 15, this.pos.z);
    return out;
  }
  /** add a living-sand shape without ever pushing the breathing mound out of the 8 slots */
  private addSand(o: SandShapeOpts) {
    const sand = this.ctx.world.sand;
    this.mine = this.mine.filter((s) => sand.shapes.includes(s));
    while (sand.shapes.length >= SAND_MAX && this.mine.length) {
      const old = this.mine.shift()!;
      sand.remove(old);
    }
    const s = sand.add(o);
    this.mine.push(s);
    return s;
  }
  /** a sand geyser */
  private plume(x: number, z: number, k = 1) {
    const y = this.ground(x, z);
    this.ctx.particles.emit({ pos: { x, y, z }, count: Math.round(8 * k), vel: { x: 0, y: 7 * k, z: 0 }, spread: 2.2, jitter: 0.6, life: [0.6, 1.1], size: [0.24, 0.12], sprite: GRAINS, color: SANDS, gravity: 14, ground: true, bounce: 0.1 });
    this.ctx.particles.emit({ pos: { x, y: y + 0.3, z }, count: Math.max(1, Math.round(2 * k)), vel: { x: 0, y: 2.2 * k, z: 0 }, spread: 0.8, life: [0.8, 1.5], size: [0.9 * k, 2.4 * k], sprite: PUFFS, color: [P.sand0, P.sand1], alpha: 0.8, drag: 2, rot: 6, rotSpeed: 0.8, jitter: 0.5 });
  }
  /** the rumble line that telegraphs a dune wave */
  private async plumeLine(x: number, z: number, dx: number, dz: number, halfLen: number, dur: number) {
    this.ctx.sfx('quake_rumble', { x, y: this.ground(x, z), z }, 0.9, 1.15);
    const pulses = Math.max(2, Math.round(dur / 0.3));
    for (let i = 0; i < pulses; i++) {
      for (let l = -halfLen; l <= halfLen; l += 3.4) {
        if (rnd.chance(0.35)) continue;
        this.plume(x - dz * l + (rnd.next() - 0.5) * 1.5, z + dx * l + (rnd.next() - 0.5) * 1.5, 0.55 + (i / pulses) * 0.5);
      }
      this.ctx.shake(0.12);
      await this.wait(dur / pulses);
    }
  }
  private stopArms() {
    for (const A of this.arms) {
      A.mode = 'rest';
      A.wrist = 0;
    }
    this.bendT = 0.14;
    this.twistT = 0;
    this.turnRate = 0.7;
    this.anim.jaw = 0;
  }
  private aim(s: number, p: THREE.Vector3, rate: number, curl: number, wrist = 0) {
    const A = this.arms[s];
    A.mode = 'aim';
    A.tgt.copy(p);
    A.rate = rate;
    A.curl = curl;
    A.wrist = wrist;
  }
  /** a point above and outside a shoulder (fist raised for a slam) */
  private overhead(s: number) {
    return this.root.localToWorld(new THREE.Vector3(s === 0 ? 9 : -9, 33, -3));
  }

  // ------------------------------------------------------------------ intro: the dune swells and he rises out of it
  async intro() {
    const ctx = this.ctx;
    const cam = this.d.cam;
    ctx.engine.letterbox(true, 0.5);
    this.invulnerable = true;
    this.submerged = true;
    this.radius = -50;
    this.sunk = 38;
    this.moundOn = false;
    this.glowT = 0;
    const bx = this.pos.x, bz = this.pos.z;
    const g = this.baseGround(bx, bz);
    const pp = this.playerPos();
    const dx = bx - pp.x, dz = bz - pp.z, dl = Math.hypot(dx, dz) || 1;
    const fx = dx / dl, fz = dz / dl;
    const camPos = new THREE.Vector3(pp.x - fx * 7 + fz * 5, 0, pp.z - fz * 7 - fx * 5);
    camPos.y = this.ground(camPos.x, camPos.z) + 2.4;
    const look = new THREE.Vector3(bx, g + 4, bz);
    cam.setCine({ pos: camPos, look, fov: 58 });
    // Undercover of the Night: the sun slides down behind him and his moon comes up over the dune
    this.lunar.sky.aim(LunarSky.azimOf(dx, dz));
    this.lunar.fall(1);
    this.callout('Undercover of the Night');
    await this.wait(0.2);
    // 1) the quake: the desert drains toward the spot
    ctx.sfx('quake_rumble', { x: bx, y: g, z: bz }, 1, 0.7);
    this.addSand({ kind: 'mound', x: bx, z: bz, height: -2.6, width: 8, life: 2.6, rise: 0.6, fall: 0.8 });
    for (let t = 0; t < 1.5; t += 0.1) {
      ctx.shake(0.25);
      for (let i = 0; i < 6; i++) {
        const a = rnd.next() * Math.PI * 2, r = 12 + rnd.next() * 8;
        const x = bx + Math.cos(a) * r, z = bz + Math.sin(a) * r;
        ctx.particles.emit({ pos: { x, y: this.ground(x, z) + 0.2, z }, count: 3, vel: { x: -Math.cos(a) * 9, y: 0.6, z: -Math.sin(a) * 9 }, spread: 1, life: [1.0, 1.6], size: [0.22, 0.14], sprite: GRAINS, color: SANDS, gravity: 4, drag: 0.4, ground: true });
      }
      await this.wait(0.1);
    }
    // 2) the swell
    ctx.sfx('sand_rise', { x: bx, y: g, z: bz }, 1, 0.5);
    this.addSand({ kind: 'mound', x: bx, z: bz, height: 9.5, width: 9.5, life: 7.5, rise: 2.0, fall: 2.6 });
    await this.wait(1.0);
    // 3) he rises out of it, hands first, grabbing the dune
    this.moundOn = true;
    const rise = 4.4;
    let lit = false;
    for (let t = 0; t < rise; t += 0.05) {
      const k = t / rise, e = 1 - (1 - k) ** 3;
      this.sunk = 38 * (1 - e);
      camPos.y = this.ground(camPos.x, camPos.z) + 2.4 + e * 8;
      look.y = g + 4 + e * 19;
      if (rnd.chance(0.5)) ctx.shake(0.12 + (1 - k) * 0.2);
      this.cascade(3, 0.6);
      if (!lit && k > 0.42) {
        lit = true;
        this.glowT = 1.2;
        ctx.sfx('divine_power', this.pos, 0.9, 0.6);
      }
      await this.wait(0.05);
    }
    this.sunk = 0;
    // 4) the roar
    this.root.updateMatrixWorld(true);
    const head = this.socketWorld('mouth', new THREE.Vector3());
    const hx = Math.sin(this.yaw), hz = Math.cos(this.yaw);
    cam.setCine({ pos: new THREE.Vector3(head.x + hx * 16 + hz * 6, head.y - 2, head.z + hz * 16 - hx * 6), look: head.clone().add(_v.set(0, 2.5, 0)), fov: 46 });
    this.setExpr('enraged');
    this.anim.jaw = 0.3;
    ctx.sfx('boss_roar', this.pos, 1, 0.55);
    ctx.shake(0.8);
    this.taunt('You crossed my sky, little bones. Now cross my desert.', SANDC);
    ctx.events.emit('bossIntro', this);
    await this.wait(2.6);
    this.anim.jaw = 0;
    this.setExpr('angry');
    cam.setCine(null);
    ctx.engine.letterbox(false, 0.5);
    this.invulnerable = false;
    this.submerged = false;
    this.radius = 7.5;
    this.glowT = 0.2;
  }

  // ------------------------------------------------------------------ fight loop
  protected async fight() {
    while (true) {
      this.check();
      const q = this.queue.shift();
      if (q) {
        await this.run(q);
        continue;
      }
      const p = this.phase, r = rnd.next(), d = this.distToPlayer();
      const c = this.cds, m = this.moonCds;
      let pick: string;
      if (d > 44) pick = r < 0.4 ? 'drift' : r < 0.7 ? 'helterSkelter' : 'shineALight';
      else if (p === 0) pick = r < 0.24 ? 'helterSkelter' : r < 0.46 ? 'mrBrownstone' : r < 0.6 ? 'startMeUp' : r < 0.76 && m.tide <= 0 ? 'childOfTheMoon' : r < 0.88 ? 'shineALight' : 'patience';
      else if (p === 1)
        pick = r < 0.15 ? 'helterSkelter' : r < 0.3 ? 'mrBrownstone' : r < 0.39 ? 'startMeUp' : r < 0.48 && c.sugar <= 0 ? 'brownSugar' : r < 0.58 && m.tide <= 0 ? 'childOfTheMoon' : r < 0.68 ? 'lucy' : r < 0.77 ? 'patience' : r < 0.88 ? 'tomorrowNeverKnows' : 'shineALight';
      else if (!m.ruby && this.frac < 0.25) pick = 'rubyTuesday';
      else
        pick =
          r < 0.13 ? 'helterSkelter' : r < 0.25 ? 'shattered' : r < 0.34 && c.together <= 0 ? 'comeTogether' : r < 0.41 && c.shelter <= 0 ? 'gimmeShelter' : r < 0.51 && m.tide <= 0 ? 'springTide' : r < 0.59 && m.rain <= 0 ? 'novemberRain' : r < 0.67 ? 'tomorrowNeverKnows' : r < 0.75 ? 'lucy' : r < 0.83 && c.sugar <= 0 ? 'brownSugar' : r < 0.91 ? 'patience' : 'mrBrownstone';
      if (pick === this.lastAttack && pick !== 'drift') pick = pick === 'helterSkelter' ? 'mrBrownstone' : 'helterSkelter';
      // a volley you slipped is not over yet: he rewinds it
      if (p >= 1 && this.alive && this.lunar.missedFor(1.2) && this.lunar.liveBullets() >= 10 && rnd.chance(0.35)) await this.run('yesterday');
      await this.run(pick);
      await this.wait(p >= 2 ? 0.45 : 0.8);
    }
  }
  private async run(name: string) {
    this.lastAttack = name;
    switch (name) {
      case 'helterSkelter':
        return this.helterSkelter();
      case 'mrBrownstone':
        return this.mrBrownstone(false);
      case 'shattered':
        return this.mrBrownstone(true);
      case 'startMeUp':
        return this.startMeUp();
      case 'brownSugar':
        return this.brownSugar();
      case 'comeTogether':
        return this.comeTogether();
      case 'gimmeShelter':
        return this.gimmeShelter();
      case 'childOfTheMoon':
        return this.childOfTheMoon(false);
      case 'springTide':
        return this.childOfTheMoon(true);
      case 'shineALight':
        return this.shineALight();
      case 'lucy':
        return this.lucyInTheSky();
      case 'patience':
        return this.patience();
      case 'tomorrowNeverKnows':
        return this.tomorrowNeverKnows();
      case 'novemberRain':
        return this.novemberRain();
      case 'rubyTuesday':
        return this.rubyTuesday();
      case 'yesterday':
        return this.yesterday();
      default:
        return this.drift();
    }
  }
  /** dev/test: queue an attack by name (helterSkelter, mrBrownstone, shattered, startMeUp, brownSugar, comeTogether, gimmeShelter,
   *  childOfTheMoon, springTide, shineALight, lucy, patience, tomorrowNeverKnows, novemberRain, rubyTuesday, yesterday) */
  debug(name: string) {
    this.queue.unshift(name);
  }

  /** the dune he stands in creeps after you */
  private async drift() {
    const pp = this.playerPos();
    const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    const go = Math.max(0, d - 24);
    this.moundBoost = 1.2;
    this.ctx.sfx('sand_spray', this.pos, 0.8, 0.6);
    await this.moveTo(this.pos.x + (dx / d) * go, this.pos.z + (dz / d) * go, 4.5, 4);
    this.moundBoost = 0;
  }

  // ------------------------------------------------------------------ Helter Skelter: dune walls roll at you
  private async helterSkelter() {
    this.callout('Helter Skelter');
    if (rnd.chance(0.5)) this.say(['Ride, then. The dunes are coming down.', 'Down the slide, little bones.', 'The desert is a sea, and I am its tide.']);
    const n = 1 + this.phase + (rnd.chance(0.5) ? 1 : 0);
    // both hands drag through the dune toward you
    this.bendT = 0.42;
    this.turnRate = 1.2;
    for (const s of [0, 1]) this.aim(s, this.root.localToWorld(new THREE.Vector3(s === 0 ? 8 : -8, 0, 15)), 2.4, 0.9, 0.2);
    for (let i = 0; i < n; i++) {
      this.check();
      const pp = this.predicted(1.1);
      let ang = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
      if (i > 0) ang += (i % 2 ? 1 : -1) * (0.45 + rnd.next() * 0.5); // later walls come in from the flanks
      if (this.phase >= 2 && i === n - 1) ang += (Math.PI / 2) * rnd.sign(); // and one crosses them
      const dx = Math.sin(ang), dz = Math.cos(ang);
      const back = 26;
      const sx = pp.x - dx * back, sz = pp.z - dz * back;
      const h = 5.2 + rnd.next() * 1.4 + this.phase * 0.6;
      const halfLen = 22 + this.phase * 4, speed = 12.5 + this.phase * 1.6;
      await this.plumeLine(sx, sz, dx, dz, halfLen, 1.05 - this.phase * 0.12);
      const shape = this.addSand({ kind: 'ridge', x: sx, z: sz, dir: { x: dx, z: dz }, speed, height: h, width: 4.6, halfLen, life: (back + 36) / speed + 1.4, rise: 0.9, fall: 1.3 });
      this.waves.push({ shape, kind: 'ridge', dmg: 24 + this.phase * 5, knock: 17, hit: false, crossed: false, prev: NaN });
      this.ctx.sfx('whoosh_big', { x: sx, y: this.ground(sx, sz), z: sz }, 1, 0.55);
      this.ctx.shake(0.3);
      for (const s of [0, 1]) this.arms[s].tgt.copy(this.root.localToWorld(new THREE.Vector3(s === 0 ? 6 + i : -6 - i, 0, 20)));
      await this.wait(0.55);
    }
    await this.wait(1.0);
    this.stopArms();
  }

  // ------------------------------------------------------------------ Mr. Brownstone / Shattered: the fist comes down
  private async mrBrownstone(double: boolean) {
    this.callout(double ? 'Shattered' : 'Mr. Brownstone');
    if (rnd.chance(0.45)) this.say(double ? ['Break.', 'Everything breaks into sand.'] : ['Kneel.', 'The mountain falls on you.', 'Lie down in the dust.']);
    const pp = this.predicted(1.3);
    const local = this.root.worldToLocal(_v.copy(pp));
    const s = local.x >= 0 ? 0 : 1;
    const target = this.reachPoint(pp);
    const arms = double ? [0, 1] : [s];
    // windup: he rears back, the fist climbs overhead
    this.turnRate = 1.5;
    this.bendT = -0.12;
    this.twistT = double ? 0 : (s === 0 ? 1 : -1) * 0.25;
    for (const a of arms) this.aim(a, this.overhead(a), 3.2, 1.5, 0.9);
    this.anim.jaw = 0.25;
    this.ctx.sfx('boss_roar', this.pos, 0.6, 0.6);
    this.addSand({ kind: 'mound', x: target.x, z: target.z, height: 0.9, width: 2.6, life: 1.7, rise: 0.8, fall: 0.6 });
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + i;
        this.plume(target.x + Math.cos(a) * 3.2, target.z + Math.sin(a) * 3.2, 0.5);
      }
      await this.wait(0.24 - this.phase * 0.03);
    }
    // the slam: a deep bow, the fist drives into the dune
    const dist = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
    this.bendT = clamp((dist - 8) / 16, 0, 1) * 0.95 + 0.1;
    this.twistT = 0;
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    for (const a of arms) {
      const t = double ? target.clone().addScaledVector(side, a === 0 ? 2.6 : -2.6) : target;
      this.aim(a, _v.set(t.x, this.ground(t.x, t.z) + 0.35, t.z), 9.5, 1.5, 0.9);
    }
    for (let t = 0; t < 0.6; t += 0.05) {
      await this.wait(0.05);
      if (this.handWorld(arms[0], _w, true).distanceTo(this.arms[arms[0]].tgt) < 2) break;
    }
    this.impact(target, double);
    this.planted = 1;
    await this.wait(1.15);
    this.planted = 0;
    this.stopArms();
  }
  private impact(at: THREE.Vector3, double: boolean) {
    const ctx = this.ctx;
    const g = this.ground(at.x, at.z);
    const p = { x: at.x, y: g + 0.3, z: at.z };
    ctx.shake(double ? 1.1 : 0.9);
    ctx.engine.hitStop(0.05);
    ctx.sfx('explosion_big', p, 1, 0.55);
    ctx.sfx('rock_crumble', p, 1, 0.7);
    ctx.fx.sandBurst(p, 3.2);
    ctx.fx.dust(p, 4, P.sand0, 10);
    ctx.particles.emit({ pos: p, count: 26, spread: 9, up: 9, life: [0.8, 1.5], size: [0.3, 0.2], sprite: 'pebble', color: [0xffffff, 0xe0c8a0], gravity: 16, ground: true, bounce: 0.3, rot: 6, rotSpeed: 8 });
    ctx.world.deform(at.x, at.z, 3.4, 0.9);
    ctx.events.emit('bossPlow', { x: at.x, z: at.z }, 5);
    const pl = this.player;
    if (Math.hypot(pl.pos.x - at.x, pl.pos.z - at.z) < 5.4 && pl.pos.y < g + 3) pl.takeHit({ base: 32 + this.phase * 5, kind: 'phys', source: 'contact', knock: 18 }, new THREE.Vector3(at.x, g, at.z));
    const ring = this.addSand({ kind: 'ring', x: at.x, z: at.z, speed: 13.5, height: (double ? 3.4 : 2.7) + this.phase * 0.4, width: 2.8, life: 2.8, rise: 0.25, fall: 1.0 });
    this.waves.push({ shape: ring, kind: 'ring', dmg: 16 + this.phase * 3, knock: 13, hit: false, crossed: false, prev: NaN });
    const a0 = Math.atan2(pl.pos.x - at.x, pl.pos.z - at.z);
    const lines = double ? [a0, a0 - 0.55, a0 + 0.55] : [a0];
    for (const a of lines) this.spikeLine(at.x, at.z, a, 9 + this.phase * 2, 0.12);
  }
  private spikeLine(x0: number, z0: number, ang: number, n: number, delay: number) {
    const storm = this.ctx.world.storm;
    for (let i = 0; i < n; i++) {
      const d = 3.4 + i * 2.25;
      const x = x0 + Math.sin(ang) * d + (rnd.next() - 0.5) * 0.9, z = z0 + Math.cos(ang) * d + (rnd.next() - 0.5) * 0.9;
      if (storm.sdf(x, z) < 2) break;
      this.ctx.engine.tweens.after(delay + i * 0.075, () => {
        if (!this.dead) this.raiseSpike(x, z, 0.8 + (i / n) * 0.45);
      });
    }
  }
  private raiseSpike(x: number, z: number, sc: number) {
    const geos = spikeGeos();
    const mesh = new THREE.Mesh(geos[rnd.int(0, geos.length - 1)], this.body);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const s = sc * (0.9 + rnd.next() * 0.3);
    mesh.scale.setScalar(s);
    mesh.rotation.set((rnd.next() - 0.5) * 0.2, rnd.next() * Math.PI * 2, (rnd.next() - 0.5) * 0.2);
    mesh.position.set(x, this.ground(x, z) - 5 * s, z);
    this.ctx.scene.add(mesh);
    this.spikes.push({ mesh, x, z, h: 4.4 * s, r: 1.15 * s, t: 0, hold: 1.0 + rnd.next() * 0.35, hit: false });
    this.ctx.fx.sandBurst({ x, y: this.ground(x, z), z }, 1.1);
    if (rnd.chance(0.4)) this.ctx.sfx('rock_crumble', { x, y: this.ground(x, z), z }, 0.7, 1.1 + rnd.next() * 0.3);
  }

  // ------------------------------------------------------------------ Start Me Up: a fistful of the dune, flung
  private async startMeUp() {
    this.callout('Start Me Up');
    const s = rnd.chance(0.5) ? 0 : 1;
    const dig = this.root.localToWorld(new THREE.Vector3(s === 0 ? 10 : -10, 0, 9));
    dig.y = this.ground(dig.x, dig.z) - 1.4;
    this.bendT = 0.38;
    this.aim(s, dig, 3.6, 1.1, 0.3);
    await this.wait(0.75);
    this.ctx.fx.sandBurst({ x: dig.x, y: dig.y + 1.4, z: dig.z }, 1.8);
    this.ctx.sfx('sand_burst', dig, 1, 0.7);
    // the scoop swings up toward you and lets go
    const pp = this.predicted(0.9);
    const up = this.pos.clone().lerp(pp, 0.3);
    up.y = this.pos.y + 26;
    this.bendT = 0.02;
    this.aim(s, up, 6.5, 1.0, 0.2);
    await this.wait(0.42);
    this.arms[s].curl = -0.1;
    const from = this.handWorld(s, new THREE.Vector3(), false);
    const tgt = this.predicted(1.3);
    const n = 11 + this.phase * 4;
    this.ctx.sfx('whoosh_big', from, 1, 0.7);
    for (let i = 0; i < n; i++) {
      const a = rnd.next() * Math.PI * 2, r = Math.sqrt(rnd.next()) * (6 + this.phase);
      const tx = tgt.x + Math.cos(a) * r, tz = tgt.z + Math.sin(a) * r, ty = this.ground(tx, tz);
      const dx = tx - from.x, dz = tz - from.z;
      const T = 1.15 + Math.hypot(dx, dz) / 34 + rnd.next() * 0.25, g = 16;
      this.d.enemies.proj.spawn({ kind: 'sand', x: from.x, y: from.y, z: from.z, vx: dx / T, vy: (ty - from.y) / T + 0.5 * g * T, vz: dz / T, dmg: 9 + this.phase * 2, grav: g, life: T + 1, sourceId: this.id });
    }
    this.ctx.particles.emit({ pos: from, count: 30, spread: 5, up: 2, life: [0.6, 1.2], size: [0.26, 0.14], sprite: GRAINS, color: SANDS, gravity: 10, ground: true });
    await this.wait(0.9);
    this.stopArms();
  }

  // ------------------------------------------------------------------ Brown Sugar: "change them" — sand-forms, and an army poured out of his palms
  private async brownSugar() {
    this.callout('Brown Sugar');
    this.cds.sugar = 26;
    this.say(['Sand remembers every shape.', 'Your dead are my clay.', 'Rise again — as me.']);
    this.chestT = 0.8;
    this.glowT = 1;
    this.bendT = 0.2;
    for (const s of [0, 1]) this.aim(s, this.root.localToWorld(new THREE.Vector3(s === 0 ? 12 : -12, 14, 9)), 2.6, -0.1, -0.2);
    this.ctx.sfx('divine_whisper', this.pos, 1, 0.6);
    // every living thing on the field is engulfed and turned
    const crowd = clamp(24 / Math.max(1, this.d.enemies.list.length), 0.3, 1); // keep the sand storm affordable in a crowd
    for (const e of this.d.enemies.list) {
      if (!e.alive || this.sandForms.has(e)) continue;
      const delay = Math.min(1.2, e.pos.distanceTo(this.pos) / 45);
      this.ctx.engine.tweens.after(delay, () => this.engulf(e, crowd));
    }
    await this.wait(1.3);
    // he pours sand from his palms; it rises as a wave of soldiers
    const pp = this.playerPos();
    const fa = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
    const fx = Math.sin(fa), fz = Math.cos(fa), sx = fz, sz = -fx;
    const mid = new THREE.Vector3(this.pos.x + fx * 13, 0, this.pos.z + fz * 13);
    for (const s of [0, 1]) {
      const sgn = this.root.worldToLocal(_v.copy(mid).addScaledVector(_w.set(sx, 0, sz), 7)).x >= 0 ? 1 : -1;
      const k = s === 0 ? sgn : -sgn;
      const p = mid.clone().addScaledVector(_w.set(sx, 0, sz), 7 * k);
      p.y = this.ground(p.x, p.z) + 12;
      this.aim(s, p, 2.4, -0.15, 1.0);
      this.handPour[s] = 1;
    }
    this.ctx.sfx('sand_spray', mid, 1, 0.6);
    await this.wait(0.9);
    const ridge = this.addSand({ kind: 'ridge', x: mid.x, z: mid.z, dir: { x: fx, z: fz }, speed: 6.5, height: 2.4, width: 3.2, halfLen: 12, life: 5.5, rise: 0.6, fall: 1.2 });
    this.waves.push({ shape: ridge, kind: 'ridge', dmg: 0, knock: 0, hit: true, crossed: true, prev: NaN, harmless: true });
    const types = ARMY.filter((t) => ENEMIES[t]);
    const n = Math.max(2, Math.min(4 + this.phase * 2, 90 - this.d.enemies.list.length)); // his army, even in a crowd
    for (let i = 0; i < n; i++) {
      await this.wait(0.36);
      const l = (rnd.next() - 0.5) * 20;
      const x = ridge.x + ridge.dx * ridge.travel + sx * l, z = ridge.z + ridge.dz * ridge.travel + sz * l;
      if (this.ctx.world.storm.sdf(x, z) < 4) continue;
      const e = this.d.enemies.spawn(rnd.pick(types), x, z, { emerge: 'sand' });
      this.plume(x, z, 1.1);
      if (e) this.makeSandForm(e);
    }
    this.handPour[0] = this.handPour[1] = 0;
    this.chestT = 0;
    this.glowT = 0.2 + this.phase * 0.3;
    await this.wait(0.6);
    this.stopArms();
  }
  private engulf(e: Enemy, k = 1) {
    if (!e.alive || this.sandForms.has(e) || this.dead) return;
    const p = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
    for (let i = 0; i < Math.max(1, Math.round(3 * k)); i++)
      this.ctx.engine.tweens.after(i * 0.12, () => {
        const a = rnd.next() * Math.PI * 2;
        this.ctx.particles.emit({ pos: { x: p.x + Math.cos(a) * 1.2, y: p.y + 0.2, z: p.z + Math.sin(a) * 1.2 }, count: 10, vel: { x: -Math.sin(a) * 3, y: 4.5, z: Math.cos(a) * 3 }, spread: 1.4, jitter: 0.5, life: [0.5, 0.9], size: [0.18, 0.1], sprite: GRAINS, color: SANDS, gravity: 6, drag: 1 });
      });
    if (rnd.chance(k)) this.ctx.fx.dust(p, 1.2 * e.scale, P.sand1, 4);
    if (rnd.chance(k)) this.ctx.sfx('sand_rise', p, 0.6, 0.9);
    this.ctx.engine.tweens.after(0.45, () => this.makeSandForm(e));
  }
  /**
   * A sand-form: tinted sand, tougher, bursts into sand on death. If Enemies.ts
   * owns a `sandForm` flag (tint + burst in kill()), it does the drawing.
   */
  private makeSandForm(e: Enemy) {
    if (!e.alive || this.sandForms.has(e)) return;
    const hooked = 'sandForm' in e;
    (e as any).sandForm = true;
    e.maxHp *= 1.6;
    e.hp *= 1.6;
    e.armor *= 1.25;
    e.dmgMul *= 1.12;
    this.sandForms.set(e, hooked);
    this.ctx.fx.sandBurst({ x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z }, 0.7);
  }
  private onEnemyKilled(e: Enemy) {
    const hooked = this.sandForms.get(e);
    if (hooked === undefined) return;
    this.sandForms.delete(e);
    if (hooked) return;
    const c = { x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z };
    this.ctx.fx.sandBurst(c, 1.3 * e.scale);
    this.ctx.fx.dust(c, 1.1 * e.scale, P.sand1, 5);
    this.ctx.sfx('sand_burst', c, 0.7);
    // no bones: whatever the body breaks into crumbles straight back into sand
    this.crumbles.push({ batch: e.batch, until: this.t + 2.6 });
  }

  // ------------------------------------------------------------------ Come Together: the vortex, the open heart
  private async comeTogether() {
    this.callout('Come Together');
    this.cds.together = 16;
    this.say(['Come. Closer. Into me.', 'All sand flows to the heart.', 'The desert is a mouth.']);
    const pp = this.playerPos();
    const a = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
    const r = clamp(this.distToPlayer() * 0.55, 9, 15);
    const cx = this.pos.x + Math.sin(a) * r, cz = this.pos.z + Math.cos(a) * r;
    const shape = this.addSand({ kind: 'mound', x: cx, z: cz, height: -5.5, width: 7.5, life: 7.6, rise: 1.3, fall: 1.6 });
    this.pit = { shape, x: cx, z: cz, tick: 0 };
    this.chestT = 1;
    this.glowT = 1.2;
    this.bendT = 0.45;
    this.ctx.sfx('divine_power', this.pos, 1, 0.7);
    this.ctx.toast('THE HEART IS OPEN', MOONC, 'Shoot the moon core — stay out of the pit!');
    const side = _a.set(Math.cos(a), 0, -Math.sin(a));
    for (let t = 0; t < 6.2; t += 0.25) {
      for (const s of [0, 1]) {
        const k = this.root.worldToLocal(_v.set(cx + side.x * 5, 0, cz + side.z * 5)).x >= 0 === (s === 0) ? 1 : -1;
        const p = _w.set(cx + side.x * 5.5 * k, 0, cz + side.z * 5.5 * k);
        p.y = this.ground(p.x, p.z) + 5 + Math.sin(this.t * 2 + s) * 0.8;
        this.aim(s, p, 2.2, 0.6 + Math.sin(this.t * 3 + s) * 0.5, 0.6);
      }
      if (Math.round(t * 4) % 5 === 0) this.fire('ring', { count: 12 + this.phase * 3, speed: 8.5, dmg: 8 + this.phase * 2, proj: 'sand' }, this.socketWorld('core', _b));
      if (Math.round(t * 4) % 4 === 0) this.ctx.sfx('heartbeat', this.pos, 1, 0.7);
      await this.wait(0.25);
    }
    this.chestT = 0;
    this.glowT = 0.2 + this.phase * 0.3;
    this.stopArms();
  }

  // ------------------------------------------------------------------ Gimme Shelter → Get Back: he becomes the tsunami, then re-forms
  private async gimmeShelter() {
    const ctx = this.ctx;
    this.callout('Gimme Shelter');
    this.cds.shelter = 40;
    this.say(['There is no shelter in the desert.', 'Then drown in me!']);
    this.invulnerable = true;
    this.bendT = -0.25;
    for (const s of [0, 1]) this.aim(s, this.overhead(s), 2.6, 0.2, -0.3);
    this.anim.jaw = 0.4;
    ctx.sfx('boss_roar', this.pos, 1, 0.5);
    ctx.shake(0.6);
    await this.wait(1.0);
    // he pours himself into the dune
    const pp = this.playerPos();
    const ang = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
    const dx = Math.sin(ang), dz = Math.cos(ang);
    const sx = this.pos.x + dx * 6, sz = this.pos.z + dz * 6;
    this.moundBoost = 3;
    this.bendT = 0.6;
    const fx = this.rig.material.userData.fx.value;
    ctx.sfx('quake_rumble', this.pos, 1, 0.5);
    for (let t = 0; t < 1.4; t += 0.05) {
      const k = t / 1.4;
      this.sunk = k * k * 32;
      fx.y = k * 0.3;
      this.cascade(5, 1);
      if (rnd.chance(0.4)) ctx.shake(0.35);
      await this.wait(0.05);
    }
    this.submerged = true;
    this.radius = -50;
    this.root.visible = false;
    this.moundOn = false;
    this.moundBoost = 0;
    // the tsunami
    const dist = Math.hypot(pp.x - sx, pp.z - sz) + 32;
    const speed = 15.5;
    void this.plumeLine(sx, sz, dx, dz, 40, 0.5).catch(() => {});
    const tsu = this.addSand({ kind: 'ridge', x: sx, z: sz, dir: { x: dx, z: dz }, speed, height: 9.5, width: 6, halfLen: 46, life: dist / speed + 2, rise: 0.7, fall: 1.5 });
    this.waves.push({ shape: tsu, kind: 'ridge', dmg: 34 + this.phase * 4, knock: 22, hit: false, crossed: false, prev: NaN });
    ctx.toast('SURF IT!', '#fff3d6', 'Ride with the wave or jump as the face hits', true);
    ctx.sfx('explosion_big', { x: sx, y: this.ground(sx, sz), z: sz }, 1, 0.4);
    ctx.shake(0.9);
    for (let t = 0; t < dist / speed + 0.5 && ctx.world.sand.shapes.includes(tsu); t += 0.1) await this.wait(0.1);
    // Get Back: he re-forms ahead of the wave, heart first
    const p2 = this.playerPos();
    let rx = p2.x + dx * 21, rz = p2.z + dz * 21;
    if (ctx.world.storm.sdf(rx, rz) < 14) {
      const q = ctx.world.storm.randomPointNear(p2.x, p2.z, 18, 28, 14);
      if (q) {
        rx = q.x;
        rz = q.z;
      }
    }
    this.callout('Get Back');
    this.say(['The sand always gets back up.', 'Did you think the desert ends?']);
    this.place(rx, rz, Math.atan2(p2.x - rx, p2.z - rz));
    this.sunk = 30;
    this.root.visible = true;
    this.moundOn = true;
    this.addSand({ kind: 'mound', x: rx, z: rz, height: 7, width: 9, life: 4.2, rise: 1.0, fall: 2.2 });
    ctx.sfx('sand_rise', this.pos, 1, 0.5);
    for (let t = 0; t < 2.6; t += 0.05) {
      const k = t / 2.6;
      this.sunk = 30 * (1 - (1 - (1 - k) ** 3));
      fx.y = 0.3 * (1 - k);
      this.cascade(3, 0.7);
      if (rnd.chance(0.3)) ctx.shake(0.2);
      await this.wait(0.05);
    }
    fx.y = 0;
    this.sunk = 0;
    this.submerged = false;
    this.radius = 7.5;
    this.invulnerable = false;
    this.stopArms();
    this.chestT = 1;
    this.glowT = 1;
    await this.wait(3.0);
    this.chestT = 0;
    this.glowT = 0.8;
  }

  // ------------------------------------------------------------------ the moon and the tides of sand (bosses/khonsu/LunarKit)
  /**
   * Child of the Moon: he lifts his hands to the moon and it draws the desert after it. A broad,
   * low flood of sand rolls across the arena toward the moon (surf it or jump the crest), then the
   * backwash rolls home. A spring tide (the moon dragged close first) runs higher and faster.
   */
  private async childOfTheMoon(spring: boolean) {
    const ctx = this.ctx;
    const k = this.lunar;
    this.moonCds.tide = spring ? 28 : 19;
    if (spring) {
      this.callout('2000 Light Years from Home');
      this.say(['Come down, moon. Pull harder.', 'The sky is a rope, and I am pulling.']);
      k.sky.nearT = 1;
      ctx.sfx('quake_rumble', this.pos, 1, 0.5);
      ctx.sfx('divine_power', this.pos, 0.9, 0.45);
      for (let t = 0; t < 1.4; t += 0.2) {
        ctx.shake(0.2);
        await this.wait(0.2);
      }
    }
    this.callout('Child of the Moon');
    if (!spring && rnd.chance(0.6)) this.say(['The moon calls the sand home.', 'Tide is turning, little bones.', 'Every dune is a wave that remembers.']);
    k.sky.nearT = Math.max(k.sky.nearT, 0.3);
    // both hands up to the moon
    const md = k.sky.flatDir(new THREE.Vector3());
    this.bendT = -0.2;
    this.turnRate = 1.4;
    for (const s of [0, 1]) this.aim(s, this.root.localToWorld(new THREE.Vector3(s === 0 ? 10 : -10, 34, 6)), 2.2, -0.15, -0.4);
    this.glowT = 1;
    k.tug(spring ? 2.6 : 1.4);
    ctx.toast(spring ? 'SPRING TIDE' : 'THE TIDE COMES IN', '#cfe8ff', 'The sand runs toward the moon: ride the swell');
    const pp = this.playerPos();
    // the flood forms on the far side from the moon and rolls toward it
    const back = 30;
    const sx = pp.x - md.x * back, sz = pp.z - md.z * back;
    const h = spring ? 6.4 : 4.2, halfLen = spring ? 64 : 54, speed = spring ? 12.5 : 10;
    await this.plumeLine(sx, sz, md.x, md.z, halfLen * 0.6, spring ? 1.1 : 1.3);
    const flood = this.addSand({ kind: 'ridge', x: sx, z: sz, dir: { x: md.x, z: md.z }, speed, height: h, width: spring ? 9 : 8, halfLen, life: (back + 44) / speed + 1.5, rise: 1.0, fall: 1.6 });
    this.waves.push({ shape: flood, kind: 'ridge', dmg: 18 + this.phase * 4, knock: 15, hit: false, crossed: false, prev: NaN });
    ctx.sfx('whoosh_big', { x: sx, y: this.ground(sx, sz), z: sz }, 1, 0.45);
    ctx.shake(0.35);
    if (spring) void k.shineALight({ n: 6, gap: 0.35, pattern: 'track', dmg: 16, song: false }).catch(() => {});
    await this.wait(back / speed + 1.6);
    // the backwash: home again, from the moon's side
    const p2 = this.playerPos();
    const bx = p2.x + md.x * 26, bz = p2.z + md.z * 26;
    k.tug(0);
    await this.plumeLine(bx, bz, -md.x, -md.z, halfLen * 0.5, 0.9);
    const ebb = this.addSand({ kind: 'ridge', x: bx, z: bz, dir: { x: -md.x, z: -md.z }, speed: speed + 2.5, height: h * 0.85, width: 5.5, halfLen: halfLen * 0.8, life: (26 + 40) / (speed + 2.5) + 1.2, rise: 0.7, fall: 1.3 });
    this.waves.push({ shape: ebb, kind: 'ridge', dmg: 20 + this.phase * 4, knock: 16, hit: false, crossed: false, prev: NaN });
    ctx.sfx('whoosh_big', { x: bx, y: this.ground(bx, bz), z: bz }, 1, 0.55);
    await this.wait(1.2);
    k.sky.nearT = 0;
    this.glowT = 0.2 + this.phase * 0.3;
    this.stopArms();
  }
  /** moonbeams crash down round you (one hand raised to the moon) */
  private async shineALight() {
    this.aim(rnd.chance(0.5) ? 0 : 1, this.root.localToWorld(new THREE.Vector3(6, 36, 4)), 2.6, -0.2, -0.3);
    this.glowT = 1;
    this.ctx.sfx('divine_power', this.pos, 0.7, 0.8);
    await this.wait(0.5);
    await this.lunar.shineALight({ n: 6 + this.phase * 2, gap: 0.22, lead: 1.1, dmg: 18 + this.phase * 4, pattern: this.phase >= 1 && rnd.chance(0.5) ? 'ring' : 'track' });
    await this.wait(0.6);
    this.glowT = 0.2 + this.phase * 0.3;
    this.stopArms();
  }
  private async lucyInTheSky() {
    this.bendT = -0.1;
    for (const s of [0, 1]) this.aim(s, this.root.localToWorld(new THREE.Vector3(s === 0 ? 12 : -12, 30, 8)), 2.4, 0.2, 0);
    if (rnd.chance(0.5)) this.say(['The sky breaks for me.', 'Catch the moon, little bones.']);
    await this.wait(0.5);
    await this.lunar.lucy({ n: 6 + this.phase * 2, gap: 0.28, dmg: 18 + this.phase * 3, splinters: 6 + this.phase * 2, spread: 8 });
    await this.wait(0.6);
    this.stopArms();
  }
  private async patience() {
    this.bendT = 0.3;
    for (const s of [0, 1]) this.aim(s, this.root.localToWorld(new THREE.Vector3(s === 0 ? 9 : -9, 2, 16)), 2.2, 0.8, 0.4);
    if (rnd.chance(0.5)) this.say(['Wait for me.', 'Sand runs slow in my glass.']);
    await this.lunar.patience({ n: 1 + this.phase, dur: 3.0 - this.phase * 0.2, dmg: 18 + this.phase * 3 });
    // while you crawl, the dune rises at you
    if (this.phase >= 1) await this.helterSkelter();
    else await this.wait(1.6);
    this.stopArms();
  }
  private coreWorld(out: THREE.Vector3) {
    const c = this.rig.nodes['core'];
    if (c) c.getWorldPosition(out);
    else out.set(this.pos.x, this.pos.y + 14, this.pos.z);
    return out;
  }
  /** the hourglass hangs before his chest: his shots stop dead in the air, then fly on */
  private async tomorrowNeverKnows() {
    this.chestT = 0.7;
    this.glowT = 1.2;
    this.bendT = 0.1;
    for (const s of [0, 1]) this.aim(s, this.root.localToWorld(new THREE.Vector3(s === 0 ? 8 : -8, 16, 12)), 2.6, -0.1, -0.2);
    this.ctx.sfx('divine_whisper', this.pos, 1, 0.6);
    await this.wait(0.8);
    const toP = new THREE.Vector3();
    await this.lunar.tomorrowNeverKnows({
      volley: () => {
        const core = this.coreWorld(new THREE.Vector3());
        this.fire('ring', { count: 26 + this.phase * 6, speed: 10, dmg: 9 + this.phase * 2, proj: 'sand', phase: rnd.next() }, core);
        for (const s of [0, 1]) this.fire('fan', { count: 9 + this.phase * 2, spread: 1.3, speed: 12, dmg: 9 + this.phase * 2, proj: 'sand' }, this.handWorld(s, new THREE.Vector3()));
      },
      anchor: () => {
        const pp = this.playerPos();
        toP.set(pp.x - this.pos.x, 0, pp.z - this.pos.z).normalize();
        return this.coreWorld(new THREE.Vector3()).addScaledVector(toP, 9).add(new THREE.Vector3(0, 4, 0));
      },
      hold: 1.8,
      lead: 0.5,
    });
    this.chestT = 0;
    this.glowT = 0.2 + this.phase * 0.3;
    this.stopArms();
  }
  private async yesterday() {
    this.say(['Again.', 'Yesterday was mine too.']);
    await this.lunar.yesterday(() => this.coreWorld(new THREE.Vector3()).add(new THREE.Vector3(0, 9, 0)), 0.6);
  }
  private async novemberRain() {
    this.moonCds.rain = 18;
    this.bendT = -0.25;
    for (const s of [0, 1]) this.aim(s, this.overhead(s), 2.4, 1.4, 0.6);
    this.say(['Even the moon breaks for me.', 'Let it rain.']);
    await this.lunar.novemberRain({ stage: 3, n: 12, gap: 0.18, dmg: 18, spread: 16 });
    this.stopArms();
  }
  /** once, near the end: the blood eclipse; his heart burns open in the dark while red beams spiral out of him */
  private async rubyTuesday() {
    this.moonCds.ruby = true;
    this.setExpr('enraged');
    this.taunt('Goodbye, moonlight.', '#ff7a5a');
    await this.lunar.rubyTuesday({
      dur: 7,
      during: async () => {
        this.chestT = 1;
        this.glowT = 1.6;
        this.ctx.toast('THE HEART IS OPEN', MOONC, 'Shoot the moon core while the eclipse lasts');
        void this.lunar.shineALight({ n: 16, gap: 0.16, lead: 1.2, dmg: 18, pattern: 'spiral', at: this.pos.clone(), blood: true, song: false }).catch(() => {});
        await this.helterSkelter();
      },
    });
    this.chestT = 0;
    this.glowT = 0.8;
    this.setExpr('angry');
  }

  // ------------------------------------------------------------------ phases
  protected onPhase(p: number) {
    super.onPhase(p);
    if (p === 1) {
      this.taunt('The desert has many hands.', SANDC);
      this.lunar.crack(1);
      this.glowT = 0.5;
      this.queue.push('brownSugar');
    } else if (p === 2) {
      this.taunt('Come together… into the sand.', SANDC);
      this.lunar.crack(2);
      this.glowT = 0.8;
      this.queue.push('comeTogether');
    }
  }

  // ------------------------------------------------------------------ targeting: the open heart and the eyes win close calls
  private rayT(o: THREE.Vector3, d: THREE.Vector3, s: HitSphere) {
    const n = this.rig.nodes[s.node];
    if (!n) return -1;
    const c = n.localToWorld(_p.set(...(s.offset ?? [0, 0, 0])));
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const disc = b * b - (ox * ox + oy * oy + oz * oz - s.r * s.r);
    if (disc < 0) return -1;
    let t = -b - Math.sqrt(disc);
    if (t < 0) t = -b + Math.sqrt(disc);
    return t;
  }
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    if (this.submerged || !this.root.visible) return null;
    const best = super.hitTest(o, d, maxT);
    if (!best) return null;
    const prefer = (s: HitSphere, slack: number): RayHit | null => {
      const t = this.rayT(o, d, s);
      if (t < 0 || t > best.t + slack || t > maxT) return null;
      const point = o.clone().addScaledVector(d, t);
      return { enemy: this, t, point, normal: d.clone().negate(), headshot: true, part: s.part, surface: 'enemy' };
    };
    if (this.chestNow > 0.6) {
      const h = prefer(this.coreSphere, 4.5);
      if (h) return h;
    }
    for (const s of this.eyeSpheres) {
      const h = prefer(s, 1.4);
      if (h) return h;
    }
    return best;
  }
  takeDamage(hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3) {
    this.coreSphere.weak = this.chestNow > 0.6 ? 2.5 : 0.4;
    for (const s of this.handSpheres) s.weak = this.planted > 0 ? 1.3 : 0.9;
    const amt = super.takeDamage(hit, point, dir);
    if (amt > 0 && hit.tags?.[0] === 'core' && this.chestNow > 0.6) {
      this.glowNow = Math.min(2, this.glowNow + 0.25);
      if (rnd.chance(0.25)) this.ctx.sfx('divine_chime', point ?? this.pos, 0.6, 0.7);
    }
    if (this.alive && this.frac < 0.18 && this.cds.shelter <= 0 && !this.queue.includes('gimmeShelter') && this.lastAttack !== 'gimmeShelter') this.queue.push('gimmeShelter');
    return amt;
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number) {
    if (this.root.parent) {
      this.keepMound();
      const amp = this.moundShape?.amp ?? MOUND_H;
      this.pos.y = this.baseGround(this.pos.x, this.pos.z) + (amp - MOUND_H) * 0.5 - this.sunk;
      if (this.alive && !this.moveTarget && !this.submerged) this.yaw = dampAngle(this.yaw, Math.atan2(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z), this.turnRate, dt);
    }
    this.cds.sugar -= dt;
    this.cds.together -= dt;
    this.cds.shelter -= dt;
    super.update(dt);
    this.updateWaves(dt);
    this.updateSpikes(dt);
    this.updatePit(dt);
    this.updateSandForms(dt);
    if (this.alive) {
      this.moonCds.tide -= dt;
      this.moonCds.rain -= dt;
    }
    this.lunar.update(dt);
    this.ambientFx(dt);
  }
  private keepMound() {
    const sand = this.ctx.world.sand;
    if (!this.moundOn) {
      if (this.moundShape) {
        this.moundShape.life = Math.min(this.moundShape.life, this.moundShape.t + this.moundShape.fall); // let it sink away
        this.mine.push(this.moundShape);
        this.moundShape = null;
      }
      return;
    }
    if (!this.moundShape || !sand.shapes.includes(this.moundShape)) {
      this.mine = this.mine.filter((s) => sand.shapes.includes(s));
      if (sand.shapes.length >= SAND_MAX && this.mine.length) sand.remove(this.mine.shift()!);
      const fresh = !this.moundShape;
      this.moundShape = sand.add({ kind: 'mound', x: this.pos.x, z: this.pos.z, height: MOUND_H, width: MOUND_W, life: 1e7, rise: fresh ? 1.6 : 0.05, fall: 2.0, spray: false });
    }
    const m = this.moundShape;
    m.x = this.pos.x;
    m.z = this.pos.z;
    m.height = MOUND_H * (1 + 0.06 * Math.sin(this.t * 0.55)) + this.moundBoost;
  }

  /** dune walls: caught on the steep face = hurt; surfing with it, or airborne over it, is fine */
  private updateWaves(dt: number) {
    if (!this.waves.length) return;
    const sand = this.ctx.world.sand;
    const pl = this.player;
    const P0 = pl.pos;
    for (const w of this.waves) {
      const s = w.shape;
      if (!sand.shapes.includes(s)) {
        w.harmless = true;
        w.prev = NaN;
        continue;
      }
      if (s.t < 0 || s.amp < 1.2) continue;
      const rx = P0.x - s.x, rz = P0.z - s.z;
      let along: number, dx: number, dz: number;
      if (w.kind === 'ridge') {
        along = rx * s.dx + rz * s.dz - s.travel;
        dx = s.dx;
        dz = s.dz;
        if (Math.abs(-rx * s.dz + rz * s.dx) > s.halfLen * 0.82) {
          w.prev = along;
          continue;
        }
      } else {
        const r = Math.hypot(rx, rz) || 1;
        along = r - s.travel;
        dx = rx / r;
        dz = rz / r;
      }
      const g0 = this.baseGround(P0.x, P0.z);
      const v = pl.board.vel;
      const vAlong = v.x * dx + v.z * dz;
      const onFace = along > -0.3 && along < s.width * 0.95;
      if (!w.harmless && !w.hit && onFace && pl.alive && P0.y < g0 + s.amp * 0.5 && vAlong < s.speed * 0.95) {
        w.hit = true;
        pl.takeHit({ base: w.dmg, kind: 'phys', source: 'contact', knock: w.knock }, _v.set(P0.x - dx * 3, P0.y, P0.z - dz * 3));
        pl.board.impulse.y += 5;
        this.ctx.fx.sandBurst({ x: P0.x, y: P0.y + 0.6, z: P0.z }, 1.6);
        this.ctx.sfx('sand_burst', P0, 1, 0.8);
      }
      if (!w.harmless && !w.hit && !w.crossed && w.prev > 0 && along <= 0 && s.amp > 3) {
        w.crossed = true;
        this.ctx.toast(rnd.pick(['CREST JUMPED!', 'RODE IT OUT!', 'OVER THE TOP!']), SANDC);
      }
      // riding its back: the dune carries a surfer along
      if (along < -0.5 && along > -s.width * 2.6 && pl.board.grounded && vAlong > 2) {
        v.x += dx * 4 * dt;
        v.z += dz * 4 * dt;
      }
      w.prev = along;
    }
    this.waves = this.waves.filter((w) => sand.shapes.includes(w.shape));
  }

  private updateSpikes(dt: number) {
    const pl = this.player;
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      s.t += dt;
      const rise = 0.14, fall = 0.6;
      const k = s.t < rise ? 1 - (1 - s.t / rise) ** 2 : s.t < rise + s.hold ? 1 : 1 - (s.t - rise - s.hold) / fall;
      if (k <= 0 && s.t > rise) {
        s.mesh.removeFromParent();
        this.spikes.splice(i, 1);
        continue;
      }
      const g = this.ground(s.x, s.z);
      s.mesh.position.y = g - (1 - k) * s.h * 1.15;
      if (!s.hit && s.t < rise + 0.12 && pl.alive) {
        const d = Math.hypot(pl.pos.x - s.x, pl.pos.z - s.z);
        if (d < s.r + 0.6 && pl.pos.y < g + s.h * k) {
          s.hit = true;
          pl.takeHit({ base: 20 + this.phase * 3, kind: 'phys', source: 'contact', knock: 10 }, new THREE.Vector3(s.x, pl.pos.y, s.z));
          pl.board.impulse.y += 7;
        }
      }
      if (s.t > rise + s.hold && rnd.chance(dt * 6)) this.ctx.particles.emit({ pos: { x: s.x, y: g + s.h * k * 0.6, z: s.z }, count: 3, spread: 0.6, life: [0.4, 0.8], size: [0.16, 0.1], sprite: GRAINS, color: SANDS, gravity: 10, ground: true });
    }
  }

  private updatePit(dt: number) {
    const pit = this.pit;
    if (!pit) return;
    const s = pit.shape;
    if (!this.ctx.world.sand.shapes.includes(s)) {
      this.pit = null;
      return;
    }
    const depth = -s.amp;
    if (depth < 0.4) return;
    const pl = this.player;
    const dx = pit.x - pl.pos.x, dz = pit.z - pl.pos.z, d = Math.hypot(dx, dz) || 1;
    if (d < 24 && pl.alive && this.alive) {
      const pull = (5 + 9 * (1 - d / 24)) * Math.min(1, depth / 4) * (pl.board.grounded ? 1 : 0.4);
      const v = pl.board.vel;
      v.x += ((dx / d) * pull - (dz / d) * pull * 0.35) * dt;
      v.z += ((dz / d) * pull + (dx / d) * pull * 0.35) * dt;
      if (d < 3.2) {
        pit.tick -= dt;
        if (pit.tick <= 0) {
          pit.tick = 0.5;
          pl.takeHit({ base: 9 + this.phase * 2, kind: 'phys', source: 'contact', knock: 0, status: [{ id: 'slow', stacks: 1, dur: 1 }] });
        }
      }
    }
    // the sand turns into the hole
    if (rnd.chance(dt * 30)) {
      const a = rnd.next() * Math.PI * 2, r = 2.5 + rnd.next() * 7;
      const x = pit.x + Math.cos(a) * r, z = pit.z + Math.sin(a) * r;
      this.ctx.particles.emit({ pos: { x, y: this.ground(x, z) + 0.15, z }, count: 3, vel: { x: -Math.sin(a) * 5 - Math.cos(a) * 2, y: 0.3, z: Math.cos(a) * 5 - Math.sin(a) * 2 }, spread: 0.6, life: [0.7, 1.2], size: [0.2, 0.12], sprite: GRAINS, color: SANDS, gravity: 3, drag: 0.6, ground: true });
    }
  }

  private updateSandForms(dt: number) {
    for (const [e, hooked] of this.sandForms) {
      if (!e.alive) {
        this.sandForms.delete(e);
        continue;
      }
      if (!hooked) e.tint.setRGB(1.0, 0.8, 0.52);
      if (rnd.chance(dt * 2.5)) this.ctx.particles.emit({ pos: { x: e.pos.x, y: e.pos.y + e.height * (0.3 + rnd.next() * 0.6), z: e.pos.z }, count: 2, spread: 0.5, life: [0.4, 0.8], size: [0.1, 0.06], sprite: GRAINS, color: SANDS, gravity: 9, ground: true });
    }
    if (this.crumbles.length) {
      const rag = (this.d.enemies as unknown as { rag?: { batch: unknown; life: number }[] }).rag;
      this.crumbles = this.crumbles.filter((c) => c.until > this.t);
      if (Array.isArray(rag)) for (const r of rag) for (const c of this.crumbles) if (r.batch === c.batch && r.life > 3) r.life = 0.55;
    }
  }

  /** sand sliding off him in heavy sheets (rise / collapse) */
  private cascade(n: number, k: number) {
    for (let i = 0; i < n; i++) {
      const x = this.pos.x + (rnd.next() - 0.5) * 18, z = this.pos.z + (rnd.next() - 0.5) * 12;
      const top = this.pos.y + 4 + rnd.next() * 26;
      const g = this.ground(x, z);
      if (top < g + 1) continue;
      this.ctx.particles.emit({ pos: { x, y: top, z }, count: 4, vel: { x: 0, y: -3, z: 0 }, spread: 1.4, jitter: 1, life: [0.8, 1.4], size: [0.3, 0.2], sprite: GRAINS, color: SANDS, gravity: 12, ground: true, bounce: 0.05 });
      if (rnd.chance(0.35 * k)) this.ctx.particles.emit({ pos: { x, y: Math.max(g + 1, top - 4), z }, count: 1, vel: { x: 0, y: -1, z: 0 }, spread: 0.6, life: [1.2, 2], size: [2, 4.5], sprite: ['cloud0', 'cloud1', 'cloud2'], color: [P.sand0, P.sand1], alpha: 0.85, drag: 1.5, rot: 6, rotSpeed: 0.4, jitter: 1 });
    }
  }

  private ambientFx(dt: number) {
    if (!this.root.visible || this.submerged) return;
    this.fxT += dt;
    if (this.fxT < 0.07) return;
    this.fxT = 0;
    const ctx = this.ctx;
    for (const p of this.pourNodes) {
      if (p.hand >= 0 ? this.handPour[p.hand] < 0.5 : false) continue;
      p.node.getWorldPosition(_v);
      const len = p.hand >= 0 ? p.node.scale.y * 12 : p.len;
      const y = _v.y - len * 0.85;
      const g = this.ground(_v.x, _v.z);
      ctx.particles.emit({ pos: { x: _v.x, y: Math.max(g + 0.2, y), z: _v.z }, count: p.hand >= 0 ? 6 : 2, vel: { x: 0, y: -5, z: 0 }, spread: 0.9, jitter: 0.4, life: [0.5, 0.9], size: [0.22, 0.14], sprite: GRAINS, color: SANDS, gravity: 14, ground: true, bounce: 0.05 });
      if (p.hand >= 0 || rnd.chance(0.25)) ctx.particles.emit({ pos: { x: _v.x, y: g + 0.4, z: _v.z }, count: 1, spread: 1.2, up: 0.8, life: [0.8, 1.4], size: [0.8, 2.2], sprite: PUFFS, color: [P.sand0, P.sand1], alpha: 0.75, drag: 2, rot: 6, rotSpeed: 0.6, jitter: 0.8 });
    }
    // his bow wave while the dune carries him
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.6) {
      const fx = this.vel.x / sp, fz = this.vel.z / sp;
      for (let i = 0; i < 3; i++) {
        const l = (rnd.next() - 0.5) * 12;
        const x = this.pos.x + fx * 9 - fz * l, z = this.pos.z + fz * 9 + fx * l;
        ctx.fx.sandSpray({ x, y: this.ground(x, z) + 0.3, z }, { x: fx * 6, y: 1, z: fz * 6 }, 1.5);
      }
    }
  }

  // ------------------------------------------------------------------ procedural animation
  protected animate(dt: number) {
    const n = this.rig.nodes;
    const t = this.t;
    const hitK = Math.max(0, 1 - this.hitT / 0.35) * 0.04;
    this.bendNow = damp(this.bendNow, this.bendT, 2.6, dt);
    this.twistNow = damp(this.twistNow, this.twistT, 2.6, dt);
    const br = Math.sin(t * 0.55) * 0.025;
    n['spine'].rotation.set(this.bendNow * 0.25 + br, this.twistNow * 0.35, Math.sin(t * 0.31) * 0.02);
    n['torso'].rotation.set(this.bendNow * 0.75 + br * 0.6 + hitK, this.twistNow * 0.65, Math.sin(t * 0.37 + 1) * 0.025);
    // the head searches for you, slow and heavy
    const head = n['head'];
    if (head && head.parent === n['torso']) {
      head.parent.updateWorldMatrix(true, false);
      const lp = head.parent.worldToLocal(this.player.center(_a));
      const dx = lp.x - head.position.x, dy = lp.y - head.position.y, dz = lp.z - head.position.z;
      const yaw = clamp(Math.atan2(dx, dz), -0.75, 0.75), pitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)) - 0.25, -0.45, 0.55);
      head.rotation.x = damp(head.rotation.x, pitch * 0.8 - this.bendNow * 0.35, 2.2, dt);
      head.rotation.y = damp(head.rotation.y, yaw * 0.85, 2.2, dt);
      head.rotation.z = Math.sin(t * 0.43) * 0.03;
      if (n['jaw']) n['jaw'].rotation.x = damp(n['jaw'].rotation.x, this.rig.exprJaw + this.anim.jaw, 8, dt);
    }
    // ribcage gates and the moon heart
    this.chestNow = damp(this.chestNow, this.chestT, 3.2, dt);
    const open = this.chestNow * 1.2 + Math.sin(t * 1.1) * 0.015;
    n['ribs_l'].rotation.y = open;
    n['ribs_r'].rotation.y = -open;
    const core = n['core'];
    core.rotation.z = Math.sin(t * 0.4) * 0.12;
    core.scale.setScalar(1 + Math.sin(t * (2.4 + this.chestNow * 2)) * 0.03 * (1 + this.chestNow));
    this.glowNow = damp(this.glowNow, this.glowT, 2, dt);
    this.coreLight.intensity = this.root.visible ? 2 + this.chestNow * 14 + this.glowNow * 4 + Math.sin(t * 3) * 0.8 : 0;
    const fx = this.rig.material.userData.fx.value;
    fx.z = 0.1 + this.glowNow * 0.7 + this.chestNow * 0.25;
    this.root.updateMatrixWorld(true);
    // arms (IK onto the dune), hands, fingers
    for (let s = 0; s < 2; s++) this.solveArm(s, dt);
    // eyes find you
    if (head) {
      for (let s = 0; s < 2; s++) {
        const eye = n[s === 0 ? 'eye_l' : 'eye_r'];
        if (!eye) continue;
        const lp = head.worldToLocal(this.player.center(_a)).sub(eye.position).normalize();
        _q.setFromUnitVectors(this.eyeAxis[s], lp);
        _qi.identity().slerp(_q, Math.min(1, 0.45 / Math.max(0.01, 2 * Math.acos(Math.min(1, Math.abs(_q.w))))));
        eye.quaternion.slerp(_qi, 1 - Math.exp(-6 * dt));
      }
    }
    // falling sand always hangs straight down
    for (const p of this.pourNodes) {
      const node = p.node;
      if (p.hand >= 0) {
        const k = this.handPour[p.hand];
        node.visible = k > 0.5 && this.root.visible;
        if (!node.visible) continue;
        node.getWorldPosition(_v);
        node.scale.set(1, clamp((_v.y - this.ground(_v.x, _v.z)) / 12, 0.1, 1.8), 1);
      }
      node.parent!.getWorldQuaternion(_q);
      node.quaternion.copy(_q.invert().multiply(this.root.quaternion));
    }
  }

  private solveArm(s: number, dt: number) {
    const A = this.arms[s], J = this.J[s], n = this.rig.nodes;
    const sf = s === 0 ? '_l' : '_r';
    const arm = n['arm' + sf], fore = n['fore' + sf], hand = n['hand' + sf];
    if (A.mode === 'rest') {
      // hands planted on the dune in front of him, shifting their weight
      this.root.localToWorld(A.tgt.copy(J.K).add(_v.set(Math.sin(this.t * 0.23 + s * 2) * 0.5, 0, Math.cos(this.t * 0.19 + s) * 0.5 + this.bendNow * 4)));
      A.tgt.y = this.ground(A.tgt.x, A.tgt.z) + 0.45;
      A.rate = 2.2;
      A.curl = 0.45 + Math.sin(this.t * 0.7 + s * 3) * 0.08;
    }
    if (A.now.lengthSq() === 0) A.now.copy(A.tgt);
    A.now.lerp(A.tgt, 1 - Math.exp(-A.rate * dt));
    A.wristNow = damp(A.wristNow, A.wrist, 6, dt);
    A.curlNow = damp(A.curlNow, A.curl, 7, dt);
    hand.quaternion.setFromAxisAngle(J.wristAxis, A.wristNow);
    // effector relative to the elbow (rest-aligned frames), with the wrist as posed
    const k = _a.copy(A.curlNow > 1 ? J.fist : J.K).sub(J.W).applyQuaternion(hand.quaternion).add(_b.copy(J.W).sub(J.E));
    const L2 = k.length();
    const f0 = k.normalize();
    const L1 = J.L1;
    arm.parent!.getWorldQuaternion(_qt);
    arm.getWorldPosition(_S);
    const D = _d.copy(A.now).sub(_S);
    const dist = clamp(D.length(), Math.abs(L1 - L2) + 0.05, (L1 + L2) * 0.995);
    const dir = D.normalize();
    const pole = _p.copy(A.pole).applyQuaternion(this.root.quaternion);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    _E.copy(_S).addScaledVector(dir, a).addScaledVector(pole, h);
    _T.copy(_S).addScaledVector(dir, dist);
    _qi.copy(_qt).invert();
    _qa.setFromUnitVectors(J.u0, _v.copy(_E).sub(_S).normalize().applyQuaternion(_qi));
    _qw.copy(_qt).multiply(_qa).invert();
    _qf.setFromUnitVectors(f0, _v.copy(_T).sub(_E).normalize().applyQuaternion(_qw));
    const kk = 1 - Math.exp(-14 * dt);
    arm.quaternion.slerp(_qa, kk);
    fore.quaternion.slerp(_qf, kk);
    // fingers: one curl drives all four, each a beat behind the last
    for (let f = 0; f < 4; f++) {
      const ax = J.fingers[f];
      const w = Math.sin(this.t * 1.3 + f * 0.7 + s) * 0.05;
      const c = A.curlNow + f * 0.04;
      n[`fing${f + 1}${sf}`]?.quaternion.setFromAxisAngle(ax, c - 0.3 + w);
      n[`tip${f + 1}${sf}`]?.quaternion.setFromAxisAngle(ax, c * 1.1 - 0.42 + w);
    }
    n['thumb' + sf]?.quaternion.setFromAxisAngle(J.thumb, A.curlNow * 0.7 - 0.1);
    n['thumbtip' + sf]?.quaternion.setFromAxisAngle(J.thumb, A.curlNow * 0.6);
    hand.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ death: the avalanche, the mask, the sun
  die() {
    if (!this.alive) return;
    this.alive = false;
    this.dead = true;
    const ctx = this.ctx;
    this.setExpr('defeated');
    this.taunt('The moon… sets… on the sand…', SANDC);
    this.lunar.calm();
    ctx.engine.slowMo(0.2, 30);
    ctx.engine.tweens.after(1.4, () => ctx.engine.slowMo(1, 3), true);
    ctx.sfx('boss_death', this.pos, 1, 0.75);
    ctx.shake(1);
    ctx.engine.flash(0xdfeeff, 0.4, 0.7);
    ctx.events.emit('bossShatter', this);
    ctx.events.emit('bossKilled', this);
    const sand = ctx.world.sand;
    for (const s of this.mine) sand.remove(s);
    this.mine = [];
    this.waves = [];
    this.pit = null;
    this.invulnerable = true;
    this.radius = -50;
    void this.deathSequence();
  }
  private async deathSequence() {
    const ctx = this.ctx;
    // the first fall opens the Nile and frees Mark (saved at once; `?reveal=1` replays the reveal)
    let first = false;
    try {
      first = grantKhonsuSand();
    } catch (e) {
      console.warn('[khonsuSand] unlock', e);
    }
    this.firstFall = first || new URLSearchParams(location.search).get('reveal') === '1';
    const tw = ctx.engine.tweens;
    const fx = this.rig.material.userData.fx.value;
    this.chestT = 1;
    this.glowT = 1.6;
    this.bendT = 0.55;
    for (const s of [0, 1]) this.aim(s, this.root.localToWorld(new THREE.Vector3(s === 0 ? 20 : -20, -2, 10)), 1.4, -0.2, -0.3);
    this.moundBoost = 2.5;
    let dropped = false;
    // 1) the avalanche: he slumps forward and pours into the dune
    for (let t = 0; t < 3.4; t += 0.05) {
      await tw.wait(0.05);
      const k = t / 3.4;
      this.sunk = k * k * 24;
      fx.y = 0.6 * k * k;
      this.cascade(5, 1);
      if (rnd.chance(0.3)) ctx.shake(0.3);
      if (!dropped && t > 0.5) {
        dropped = true;
        void this.dropMask();
      }
    }
    // 2) the last wave rolls out and flattens the arena
    const sand = ctx.world.sand;
    const ring = sand.ring(this.pos.x, this.pos.z, { speed: 20, height: 3.4, width: 4, life: 3.6, rise: 0.2, fall: 1.4 });
    this.mine.push(ring);
    ctx.sfx('explosion_big', this.pos, 1, 0.45);
    ctx.shake(0.7);
    this.moundOn = false;
    this.keepMound();
    this.root.visible = false;
    // 3) the first fall frees what the moon kept: the Nile opens and Mark rides out of the cracked mask
    if (this.firstFall) {
      for (let t = 0; t < 4 && !this.maskDown; t += 0.1) await tw.wait(0.1);
      await tw.wait(0.6);
      try {
        await playMoonReveal({ ctx, cam: this.d.cam, player: this.player, enemies: this.d.enemies, mask: this.headGroup ? this.headGroup.position.clone() : this.pos.clone(), moon: this.lunar.sky.dir.clone() });
      } catch (e) {
        console.warn('[khonsuSand] reveal', e);
      }
    }
    // 4) the light returns
    this.ctx.toast('« Here Comes the Sun »', '#ffe3a0', 'The sands fall quiet');
    void this.lunar.end();
    await tw.wait(2.4);
    // 5) bounty, then clean up
    const at = this.headGroup ? this.headGroup.position.clone() : this.pos.clone();
    ctx.fx.coins({ x: at.x, y: this.ground(at.x, at.z) + 1, z: at.z }, 40);
    this.onDefeated?.(this, false);
    this.dispose();
  }
  /** the moon mask drops into the sand and cracks */
  private async dropMask() {
    const ctx = this.ctx;
    const tw = ctx.engine.tweens;
    const head = this.rig.nodes['head'];
    if (!head) return;
    ctx.scene.attach(head);
    this.headGroup = head;
    const mf = { value: new THREE.Vector4() };
    const mat = sandMaterial('body', mf);
    this.maskMat = mat;
    head.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = mat;
    });
    if (this.rig.nodes['pour_beak']) this.rig.nodes['pour_beak'].visible = false;
    const v = new THREE.Vector3(Math.sin(this.yaw) * 3 + (rnd.next() - 0.5) * 2, 0, Math.cos(this.yaw) * 3 + (rnd.next() - 0.5) * 2);
    let vy = 1.5;
    for (let i = 0; i < 160; i++) {
      await tw.wait(1 / 40);
      const dt = 1 / 40;
      vy -= 16 * dt;
      head.position.x += v.x * dt;
      head.position.z += v.z * dt;
      head.position.y += vy * dt;
      head.rotation.x += 0.7 * dt;
      head.rotation.z += 0.25 * dt;
      if (head.position.y < this.ground(head.position.x, head.position.z) + 1.2) break;
    }
    // impact: the mask cracks, the eyes go out
    this.maskDown = true;
    const p = { x: head.position.x, y: this.ground(head.position.x, head.position.z) + 0.4, z: head.position.z };
    const crack = this.rig.nodes['mask_crack'];
    if (crack) crack.visible = true;
    for (const e of ['eye_l', 'eye_r']) {
      const eye = this.rig.nodes[e];
      if (!eye) continue;
      eye.getWorldPosition(_v);
      ctx.particles.emit({ pos: { x: _v.x, y: _v.y, z: _v.z }, count: 14, spread: 2, up: 1.5, life: [0.6, 1.2], size: [0.3, 0.05], sprite: ['spark', 'glow8'], additive: true, color: [0xcfe8ff, 0x9fd0ff, 0xffffff], drag: 1.5 });
      eye.visible = false;
    }
    if (this.rig.nodes['jaw']) this.rig.nodes['jaw'].rotation.x = 0.55;
    ctx.sfx('rock_crumble', p, 1, 0.6);
    ctx.sfx('explosion', p, 0.8, 0.6);
    ctx.fx.sandBurst(p, 2.6);
    ctx.fx.dust(p, 3, P.sand0, 8);
    ctx.shake(0.5);
    // and slowly sinks into the dune
    for (let t = 0; t < 3; t += 0.05) {
      await tw.wait(0.05);
      head.position.y -= 0.45 * 0.05;
      mf.value.y = Math.min(0.55, t * 0.2);
    }
  }

  dispose() {
    if (!this.root.parent && !this.headGroup?.parent && !this.offKill) return;
    super.dispose();
    const sand = this.ctx.world.sand;
    for (const s of this.mine) sand.remove(s);
    if (this.moundShape) sand.remove(this.moundShape);
    this.mine = [];
    this.waves = [];
    this.pit = null;
    this.moundShape = null;
    for (const s of this.spikes) s.mesh.removeFromParent();
    this.spikes = [];
    this.headGroup?.removeFromParent();
    this.coreLight.removeFromParent();
    this.offKill?.();
    this.offKill = null;
    this.sandForms.clear();
    this.crumbles = [];
    this.dead = true;
    if (this.alive) void this.lunar.end();
    this.body.dispose();
    this.pour.dispose();
    this.maskMat?.dispose();
    if ((window as any).__khonsuSand === this) (window as any).__khonsuSand = null;
  }
}
