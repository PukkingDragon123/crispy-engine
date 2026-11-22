// Shared pieces of the tomb and Serket's domain (STORY-B):
//  - setMaterial(): the voxel material with a jade "unmaking" front. `dissolve` burns the stone away
//    outward from a point (the tomb coming apart round her), `appear` builds it outward (her arena
//    assembling), `stone` turns any rig into carved sandstone (the statues are the game's own models).
//  - DomainSky: her night: pixel stars, a slow nebula band and three scorpion constellations whose
//    lines are strings of beads with light running along them. It sits round the camera (at infinity).
//  - buildArena(): the floating ring (floor with the riding bowl, megaliths, drifting shards).
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { globalUniforms, makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { hash3 } from '../../engine/math/rand';
import { ARENA, carvedBlock, domainFloor, standingStone } from '../models/props/serketDomain';

export interface SetUniforms {
  uDis: { value: number };
  uApp: { value: number };
  uOrigin: { value: THREE.Vector3 };
}

export function setUniforms(): SetUniforms {
  return { uDis: { value: 0 }, uApp: { value: 1e4 }, uOrigin: { value: new THREE.Vector3() } };
}

/** a voxel material that can burn away (dissolve) or build in (appear) round `u.uOrigin`; `stone` recolours a rig as carved sandstone */
export function setMaterial(u: SetUniforms, o: { appear?: boolean; stone?: boolean } = {}) {
  const m = makeVoxelMaterial();
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uDis, uApp;
uniform vec3 uOrigin;
float tdHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
float tdN = tdHash(floor(vWPos * 2.5)) * 0.55 + tdHash(floor(vWPos * 0.45)) * 0.45;
float tdD = length(vWPos - uOrigin) + tdN * 5.0;
float tdEdge = 0.0;
${o.appear ? 'if (tdD > uApp) discard; tdEdge = 1.0 - smoothstep(0.0, 1.8, uApp - tdD); if (uApp > 9000.0) tdEdge = 0.0;' : 'if (uDis > 0.0) { if (tdD < uDis) discard; tdEdge = 1.0 - smoothstep(0.0, 1.8, tdD - uDis); }'}`
      )
      .replace(
        '#include <color_fragment>',
        o.stone
          ? `#include <color_fragment>
{
  float stL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  float stG = tdHash(floor(vWPos * 18.0)) * 0.08 + tdHash(floor(vWPos * vec3(1.2, 6.0, 1.2))) * 0.06;
  diffuseColor.rgb = mix(vec3(0.42, 0.29, 0.19), vec3(0.86, 0.69, 0.48), smoothstep(0.02, 0.6, stL)) * (0.9 + stG);
}`
          : '#include <color_fragment>'
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(0.35, 1.0, 0.68) * tdEdge * 2.2;`
      );
  };
  m.customProgramCacheKey = () => `dustup-set-${o.appear ? 'a' : 'd'}${o.stone ? 's' : ''}`;
  return m;
}

// ------------------------------------------------------------------ the night of her domain
/** Scorpius-like figure (claws, head, heart, the long curled tail), unit units on a sky patch */
const SCORPIUS: [number, number][] = [
  [-0.9, 0.95], [-0.62, 0.62], [-0.35, 0.3], // upper claw
  [-1.05, 0.25], [-0.7, 0.18], // lower claw
  [-0.2, 0.15], [0.05, 0.0], [0.22, -0.2], [0.3, -0.48], [0.28, -0.78], [0.12, -1.02], [-0.12, -1.12], [-0.36, -1.02], [-0.5, -0.8], [-0.42, -0.6],
];
const SCORP_LINES: [number, number][] = [[0, 1], [1, 2], [3, 4], [4, 2], [2, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14]];

export class DomainSky {
  group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];
  private uFade = { value: 0 };
  /** 0..1 how bright the constellations burn (the soul scorpion's fall lights them) */
  burn = 0;
  private uBurn = { value: 0 };

  constructor(parent: THREE.Object3D, R = 280) {
    const uT = globalUniforms.uTime;
    // the nebula: a faint band of jade and violet light across the sky
    const neb = new THREE.ShaderMaterial({
      uniforms: { uFade: this.uFade, uTime: uT },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uFade, uTime; varying vec3 vD;
        float h(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float n(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
        void main(){
          vec3 d = normalize(vD);
          float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.55, -0.76))) * 3.2, 2.0));
          float cl = n(d * 4.0 + uTime * 0.01) * 0.6 + n(d * 9.0) * 0.4;
          vec3 c = mix(vec3(0.05, 0.22, 0.2), vec3(0.22, 0.1, 0.32), n(d * 2.5 + 3.0));
          float a = band * smoothstep(0.35, 0.85, cl) * 0.55;
          vec3 base = mix(vec3(0.012, 0.02, 0.05), vec3(0.03, 0.06, 0.1), smoothstep(-0.4, 0.6, d.y));
          gl_FragColor = vec4((base + c * a) * uFade, uFade);
        }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16), neb);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);
    this.mats.push(neb);
    // stars: square pixels that twinkle (sizes in screen pixels)
    const N = 2600;
    const pos = new Float32Array(N * 3), sz = new Float32Array(N), ph = new Float32Array(N), col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = hash3(i, 1, 7) * 2 - 1, a = hash3(i, 2, 7) * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * R * 0.96, u * R * 0.96, Math.sin(a) * s * R * 0.96], i * 3);
      const b = hash3(i, 3, 7);
      sz[i] = b > 0.985 ? 3 : b > 0.9 ? 2 : 1;
      ph[i] = hash3(i, 4, 7) * 6.28;
      const warm = hash3(i, 5, 7);
      col.set(warm > 0.8 ? [1, 0.86, 0.7] : warm < 0.2 ? [0.7, 0.85, 1] : [0.95, 0.97, 1], i * 3);
    }
    this.addPoints(pos, sz, ph, col, 1.0);
    // the constellations: bright stars, and lines strung as beads of light
    const patches = [
      { dir: new THREE.Vector3(0.2, 0.62, -0.76), scale: 0.36, rot: 0.3 },
      { dir: new THREE.Vector3(-0.78, 0.42, 0.46), scale: 0.26, rot: -0.9 },
      { dir: new THREE.Vector3(0.82, 0.3, 0.48), scale: 0.22, rot: 1.8 },
    ];
    const cp: number[] = [], cs: number[] = [], cph: number[] = [], cc: number[] = [];
    for (const [pi, p] of patches.entries()) {
      const d = p.dir.clone().normalize();
      const t1 = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
      const t2 = new THREE.Vector3().crossVectors(t1, d).normalize();
      const at = (u: number, v: number) => {
        const c = Math.cos(p.rot), s = Math.sin(p.rot);
        const uu = (c * u - s * v) * p.scale, vv = (s * u + c * v) * p.scale;
        return d.clone().addScaledVector(t1, uu).addScaledVector(t2, vv).normalize().multiplyScalar(R * 0.9);
      };
      SCORPIUS.forEach(([u, v], i) => {
        const w = at(u, v);
        cp.push(w.x, w.y, w.z);
        cs.push(i === 6 ? 5 : 3); // Antares, the heart, burns biggest
        cph.push(pi * 100 + i);
        cc.push(...(i === 6 ? [1, 0.55, 0.35] : [0.75, 1, 0.9]));
      });
      for (const [a, b] of SCORP_LINES) {
        const A = at(...SCORPIUS[a]), B = at(...SCORPIUS[b]);
        const n = Math.max(4, Math.round(A.distanceTo(B) / 2.6));
        for (let k = 1; k < n; k++) {
          const w = A.clone().lerp(B, k / n);
          cp.push(w.x, w.y, w.z);
          cs.push(1.5);
          cph.push(-(pi * 100 + a * 4 + k * 0.7));
          cc.push(0.35, 1, 0.7);
        }
      }
    }
    this.addPoints(new Float32Array(cp), new Float32Array(cs), new Float32Array(cph), new Float32Array(cc), 1.6, true);
    parent.add(this.group);
  }

  private addPoints(pos: Float32Array, sz: Float32Array, ph: Float32Array, col: Float32Array, k: number, constel = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    const m = new THREE.ShaderMaterial({
      uniforms: { uFade: this.uFade, uTime: globalUniforms.uTime, uK: { value: k }, uBurn: this.uBurn, uPx: { value: Math.min(2, window.devicePixelRatio || 1) } },
      vertexShader: `attribute float aSize, aPh; attribute vec3 aCol; uniform float uTime, uK, uBurn, uPx; varying vec3 vC; varying float vA;
        void main(){
          float tw = 0.75 + 0.25 * sin(uTime * (1.3 + fract(abs(aPh) * 3.1)) + aPh * 7.0);
          ${constel ? 'float run = aPh < 0.0 ? pow(0.5 + 0.5 * sin(uTime * 2.2 + aPh * 1.7), 6.0) : 0.0; tw = aPh < 0.0 ? 0.35 + run * 0.9 + uBurn * 0.6 : 1.0 + uBurn * 0.8;' : ''}
          vC = aCol * tw * uK; vA = tw;
          gl_PointSize = floor(aSize * uPx + 0.5);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `uniform float uFade; varying vec3 vC; varying float vA; void main(){ gl_FragColor = vec4(vC * uFade, 1.0); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const p = new THREE.Points(g, m);
    p.renderOrder = -9;
    p.frustumCulled = false;
    this.group.add(p);
    this.mats.push(m);
  }

  set fade(v: number) {
    this.uFade.value = v;
    this.group.visible = v > 0.002;
  }
  get fade() {
    return this.uFade.value;
  }

  update(camera: THREE.Camera) {
    this.group.position.copy(camera.position);
    this.uBurn.value = this.burn;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of this.mats) m.dispose();
  }
}

// ------------------------------------------------------------------ the ring
export interface Arena {
  group: THREE.Group;
  stones: { mesh: THREE.Mesh; rest: THREE.Vector3 }[];
  shards: { mesh: THREE.Mesh; rest: THREE.Vector3; spin: THREE.Vector3; ph: number }[];
  /** 0..1 the megaliths rising out of the void */
  rise: number;
  update(dt: number, t: number): void;
  dispose(): void;
}

let FLOOR: THREE.BufferGeometry | null = null;
const STONES: { g: THREE.BufferGeometry; h: number }[] = [];
const SHARDS: THREE.BufferGeometry[] = [];

/** the ring of Serket's domain, centred on `center` (floor height = center.y) */
export function buildArena(parent: THREE.Object3D, center: THREE.Vector3, mat: THREE.Material): Arena {
  const group = new THREE.Group();
  group.position.copy(center);
  if (!FLOOR) {
    const f = domainFloor();
    FLOOR = buildVoxelGeometry(f.model, { voxelSize: f.voxelSize, pivot: [0.5, 0, 0.5] });
    // (the floor's top voxel row is y = 0..vs: lower it so the riding surface sits on the profile)
    FLOOR.translate(0, -f.voxelSize, 0);
    for (let i = 0; i < 6; i++) {
      const s = standingStone(i);
      STONES.push({ g: buildVoxelGeometry(s.model, { voxelSize: s.voxelSize, pivot: [0.5, 0, 0.5] }), h: s.height });
    }
    for (let i = 0; i < 3; i++) {
      const b = carvedBlock(20 + i, 14 + i * 4);
      SHARDS.push(buildVoxelGeometry(b.model, { voxelSize: b.voxelSize, pivot: 'center' as any }));
    }
  }
  const floor = new THREE.Mesh(FLOOR, mat);
  floor.receiveShadow = true;
  floor.castShadow = true;
  group.add(floor);
  const stones: Arena['stones'] = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + 0.11;
    const r = ARENA.radius - 1.2 + (hash3(i, 3, 9) - 0.5) * 0.8;
    const S = STONES[i % STONES.length];
    const mesh = new THREE.Mesh(S.g, mat);
    const rest = new THREE.Vector3(Math.cos(a) * r, ARENA.lipH - 0.4, Math.sin(a) * r);
    mesh.position.copy(rest);
    // the carved face looks in at the heart of the ring
    mesh.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a)) + Math.PI + (hash3(i, 4, 9) - 0.5) * 0.25;
    mesh.rotation.z = (hash3(i, 5, 9) - 0.5) * 0.08;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    stones.push({ mesh, rest });
  }
  const shards: Arena['shards'] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const r = ARENA.radius + 6 + hash3(i, 1, 13) * 14;
    const mesh = new THREE.Mesh(SHARDS[i % SHARDS.length], mat);
    const rest = new THREE.Vector3(Math.cos(a) * r, -4 + hash3(i, 2, 13) * 16, Math.sin(a) * r);
    mesh.position.copy(rest);
    mesh.scale.setScalar(1 + hash3(i, 3, 13) * 1.6);
    mesh.castShadow = true;
    group.add(mesh);
    shards.push({ mesh, rest, spin: new THREE.Vector3(hash3(i, 4, 13) - 0.5, hash3(i, 5, 13) - 0.5, hash3(i, 6, 13) - 0.5).multiplyScalar(0.25), ph: i * 1.7 });
  }
  parent.add(group);
  const arena: Arena = {
    group,
    stones,
    shards,
    rise: 1,
    update(dt, t) {
      const e = arena.rise * arena.rise * (3 - 2 * arena.rise);
      for (const [i, s] of stones.entries()) {
        const k = Math.max(0, Math.min(1, e * 1.6 - (i % 5) * 0.12));
        s.mesh.position.set(s.rest.x, s.rest.y - (1 - k) * 14, s.rest.z);
      }
      for (const s of shards) {
        s.mesh.position.set(s.rest.x, s.rest.y + Math.sin(t * 0.4 + s.ph) * 0.8 - (1 - e) * 20, s.rest.z);
        s.mesh.rotation.x += s.spin.x * dt;
        s.mesh.rotation.y += s.spin.y * dt;
        s.mesh.rotation.z += s.spin.z * dt;
      }
    },
    dispose() {
      group.removeFromParent();
    },
  };
  return arena;
}
