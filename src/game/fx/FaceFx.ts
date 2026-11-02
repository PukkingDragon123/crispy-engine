// 2D pixel-art faces on 3D voxel heads. Eyes are face-aligned quads placed at
// each head's eye parts (voxel eye parts are hidden), drawn from the pixel atlas:
// blinking, gaze toward a target, flickering ember pupils, expression shapes.
// Also pops 2D emotes (anger vein, sweat drop, ?, hearts, zzz, notes) over heads.
import * as THREE from 'three';
import { atlas } from './PixelArt';
import type { Particles } from './Particles';
import type { RigInstance } from '../../engine/voxel/Rig';
import { rnd } from '../../engine/math/rand';

const MAX = 1600;

/** instanced face-aligned pixel sprites (orientation from the instance matrix) */
export class FaceQuads {
  mesh: THREE.InstancedMesh;
  private iUV: THREE.InstancedBufferAttribute;
  private iCol: THREE.InstancedBufferAttribute;
  n = 0;
  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.iUV = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.iCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.iUV.setUsage(THREE.DynamicDrawUsage);
    this.iCol.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iUV', this.iUV);
    geo.setAttribute('iCol', this.iCol);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas().texture }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } },
      vertexShader: /* glsl */ `
        attribute vec4 iUV; attribute vec4 iCol;
        varying vec2 vUv; varying vec4 vCol; varying float vFog;
        void main(){
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vUv = mix(iUV.xy, iUV.zw, uv);
          vCol = iCol; vFog = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 fogColor; uniform float fogNear, fogFar;
        varying vec2 vUv; varying vec4 vCol; varying float vFog;
        void main(){
          vec4 t = texture2D(map, vUv);
          if (t.a < 0.5) discard;
          vec3 c = t.rgb * vCol.rgb * vCol.a;
          c = mix(c, fogColor, smoothstep(fogNear, fogFar, vFog));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 4;
  }
  begin() {
    this.n = 0;
  }
  push(m: THREE.Matrix4, sprite: string, color: number, intensity = 1) {
    if (this.n >= MAX) return;
    const i = this.n++;
    const f = atlas().get(sprite);
    this.mesh.setMatrixAt(i, m);
    this.iUV.setXYZW(i, f.u0, f.v0, f.u1, f.v1);
    this.iCol.setXYZW(i, ((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, intensity);
  }
  end(fog?: THREE.Fog | null) {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.iUV.needsUpdate = true;
    this.iCol.needsUpdate = true;
    if (fog) {
      const u = (this.mesh.material as THREE.ShaderMaterial).uniforms;
      u.fogColor.value.copy(fog.color);
      u.fogNear.value = fog.near;
      u.fogFar.value = fog.far;
    }
  }
}

export type EyeStyle = 'glow' | 'organic';

/** expression -> [left sprite, right sprite] (right sprites mirrored by caller) */
export function eyeShapes(expr: string, style: EyeStyle): [string, string] {
  if (style === 'organic') {
    switch (expr) {
      case 'angry':
      case 'enraged':
      case 'snarl':
      case 'determined':
        return ['o_angry', 'o_angry'];
      case 'hurt':
      case 'laugh':
      case 'happy':
        return ['o_closed', 'o_closed'];
      case 'smug':
      case 'focus':
      case 'bored':
      case 'judging':
        return ['o_half', 'o_half'];
      case 'wink':
        return ['o_open', 'o_closed'];
      case 'dead':
      case 'defeated':
        return ['e_x', 'e_x'];
      default:
        return ['o_open', 'o_open'];
    }
  }
  switch (expr) {
    case 'focus':
      return ['e_slit', 'e_slit'];
    case 'smug':
      return ['e_half', 'e_round'];
    case 'surprised':
    case 'scared':
    case 'panic':
      return ['e_wide', 'e_wide'];
    case 'hurt':
      return ['e_closed', 'e_closed'];
    case 'angry':
    case 'enraged':
    case 'determined':
    case 'snarl':
      return ['e_angry', 'e_angry'];
    case 'laugh':
    case 'happy':
    case 'sing':
      return ['e_happy', 'e_happy'];
    case 'wink':
      return ['e_closed', 'e_round'];
    case 'dead':
    case 'defeated':
      return ['e_x', 'e_x'];
    case 'stunned':
      return ['e_spiral', 'e_spiral'];
    case 'sad':
      return ['e_sad', 'e_sad'];
    case 'love':
      return ['e_heart', 'e_heart'];
    default:
      return ['e_round', 'e_round'];
  }
}

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _m2 = new THREE.Matrix4();

/** blink/flicker/gaze state for one face */
export class EyeState {
  blinkIn = 1 + rnd.next() * 4;
  blinkT = 0;
  flick = rnd.next() * 10;
  constructor(public style: EyeStyle, public color: number, public size: number) {}
  tick(dt: number) {
    this.flick += dt;
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkT = 0.12;
      this.blinkIn = 2.2 + rnd.next() * 3.5;
    }
    if (this.blinkT > 0) this.blinkT -= dt;
  }
  /** write both eyes. eyeWorld: matrix of the eye part (pivot at eye center, oriented with head) */
  draw(q: FaceQuads, eyeL: THREE.Matrix4 | null, eyeR: THREE.Matrix4 | null, expr: string, gx = 0, gy = 0, emis = 1.4) {
    const [sl, sr] = eyeShapes(expr, this.style);
    const blink = this.blinkT > 0 && !sl.includes('x') && !sl.includes('spiral');
    const flick = this.style === 'glow' ? 1 + Math.sin(this.flick * 23) * 0.06 + Math.sin(this.flick * 7.3) * 0.05 : 1;
    const shapes: [THREE.Matrix4 | null, string, number][] = [
      [eyeL, blink ? (this.style === 'glow' ? 'e_closed' : 'o_closed') : sl, 1],
      [eyeR, blink ? (this.style === 'glow' ? 'e_closed' : 'o_closed') : sr, -1],
    ];
    for (const [M, spr, side] of shapes) {
      if (!M) continue;
      M.decompose(_p, _q, _s);
      // glowing embers sit inside the dark socket (smaller than the socket); organic eyes fill it
      const sc = this.size * Math.max(0.2, _s.x) * (this.style === 'glow' ? 0.72 : 1);
      // gaze shift in the face plane + nudge forward off the surface
      _m2.compose(new THREE.Vector3(gx * sc * 0.18, gy * sc * 0.18, sc * 0.08), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      _m.compose(_p, _q, new THREE.Vector3(1, 1, 1)).multiply(_m2);
      // mirror right-eye shapes horizontally so slants face inward
      _m.multiply(new THREE.Matrix4().makeScale(sc * side * flick, sc * flick, sc));
      q.push(_m, spr, this.style === 'glow' ? this.color : 0xffffff, this.style === 'glow' ? emis : 1);
      if (this.style === 'organic' && (spr === 'o_open' || spr === 'o_half' || spr === 'o_angry')) {
        // pupil + glint follow the gaze
        _m2.compose(new THREE.Vector3(gx * sc * 0.22 * side, -0.05 * sc + gy * sc * 0.15, 0.01), new THREE.Quaternion(), new THREE.Vector3(0.38, 0.38, 1));
        q.push(_m.clone().multiply(_m2), 'o_pupil', this.color, 1);
        _m2.compose(new THREE.Vector3(gx * sc * 0.22 * side + 0.08 * sc, 0.08 * sc + gy * sc * 0.15, 0.02), new THREE.Quaternion(), new THREE.Vector3(0.14, 0.14, 1));
        q.push(_m.clone().multiply(_m2), 'o_glint', 0xffffff, 1.2);
      }
    }
  }
}

/** attach 2D eyes to a non-instanced rig (player, bosses, NPCs) */
export class RigEyes {
  state: EyeState;
  private l: THREE.Object3D | null;
  private r: THREE.Object3D | null;
  gaze = new THREE.Vector2();
  constructor(public rig: RigInstance, style: EyeStyle, color: number) {
    this.l = rig.nodes['eye_l'] ?? rig.sockets['eye_l'] ?? null;
    this.r = rig.nodes['eye_r'] ?? rig.sockets['eye_r'] ?? null;
    let size = 0.1;
    const lm = rig.meshes['eye_l'];
    if (lm) {
      lm.geometry.computeBoundingBox();
      const b = lm.geometry.boundingBox!;
      size = Math.max(0.04, Math.max(b.max.x - b.min.x, b.max.y - b.min.y) * 1.25);
      rig.setPartVisible('eye_l', false);
      rig.setPartVisible('eye_r', false);
    }
    this.state = new EyeState(style, color, size);
  }
  /** look target in world space -> gaze vector */
  lookAt(target: THREE.Vector3) {
    const head = this.rig.nodes['head'];
    if (!head) return;
    const local = head.worldToLocal(target.clone());
    const l = Math.hypot(local.x, local.y, local.z) || 1;
    this.gaze.set(Math.max(-1, Math.min(1, (local.x / l) * 2.2)), Math.max(-1, Math.min(1, (local.y / l) * 2.2)));
  }
  draw(q: FaceQuads, dt: number) {
    if (!this.rig.root.visible) return;
    this.state.tick(dt);
    // hidden voxel eyes may have been re-shown by expression swaps
    this.rig.setPartVisible('eye_l', false);
    this.rig.setPartVisible('eye_r', false);
    this.l?.updateWorldMatrix(true, false);
    this.r?.updateWorldMatrix(true, false);
    this.state.draw(q, this.l?.matrixWorld ?? null, this.r?.matrixWorld ?? null, this.rig.expression, -this.gaze.x, this.gaze.y);
  }
}

export type EmoteKind = 'anger' | 'sweat' | 'q' | 'heart' | 'zzz' | 'note' | 'star' | 'drop' | 'exclaim';

export function emote(p: Particles, at: { x: number; y: number; z: number }, kind: EmoteKind, scale = 1) {
  const sprite = kind === 'exclaim' ? 'dg_!' : 'fx_' + kind;
  const rise = kind === 'zzz' ? 0.6 : 1.2;
  p.emit({ pos: { x: at.x + (rnd.next() - 0.5) * 0.3, y: at.y, z: at.z }, count: 1, vel: { x: 0.2, y: rise, z: 0 }, life: [0.9, 1.1], size: [0.55 * scale, 0.7 * scale], sprite, color: 0xffffff, screen: true, sizeJitter: 0, drag: 1.5 });
}
