// RIP THE BOUNTY — when a boss or an alpha falls, its WANTED poster slams into the
// sand by the body on a weathered stake (a nail through the top, a rope lashing). Ride
// past it and a quick timing ring floats over the sheet: rip it off the nail.
//   perfect  a clean tear: the sheet flies to you, CLAIMED is stamped across it and
//            it pays a bonus (extra bounty and a fistful of gold)
//   good     a smaller bonus
//   miss     the sheet tears in two and blows away (the base bounty was already paid)
// Ignored, the ring comes back once you leave and ride by again; after a minute the
// wind takes the poster. The portrait is the outlaw photographed from its own rig
// (IconFactory) and printed in sepia; the paper, stamp and tear are a shader.
// Self-driving (listens for 'bossDefeated' / 'enemyKilled', ticks from
// engine.onAfterUpdate, cleans up when its scene goes away).
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import { Qte, type QuickResult } from '../ui/Qte';
import { IconFactory } from '../ui/IconFactory';
import { PARCHMENT_GLSL } from '../ui/Choice';
import { RigInstance, type RigGeo } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, type VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { weathered, ropeMat, blackIron } from '../models/materials';

export interface RipHost {
  ctx: Ctx;
  player: { pos: THREE.Vector3; alive: boolean; stats?: { get(k: string): number } };
  qte: Qte;
  addBounty(v: number): void;
  addGold(v: number): void;
}

const PW = 0.62, PH = 0.88; // sheet (m)
const CW = 372, CH = 528; // ink canvas (px)
const INK = '#2a1a10';
const STAMP_Y = 470;
const RANGE = 5.2;
const LIFE = 60;
const MAX_POSTERS = 3;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// ------------------------------------------------------------------ the stake (1/40 m, built once)
const STAKE_VS = 1 / 40;
let stakeGeo: THREE.BufferGeometry | null = null;
/** a hewn post leaning a little, split at the top, a rope lashing and a square nail where the sheet hangs */
function stakeModel() {
  const m = new VoxelModel('bounty_stake');
  const wood = weathered({ along: 'y', species: 'oak', seed: 7, knots: 0.9, bleach: 0.12, checks: 1, dust: 0.6, rotBelow: 6, rotFrom: -6 });
  const H = 66;
  for (let y = -14; y <= H; y++) {
    const t = (y + 14) / (H + 14);
    const cx = Math.round(Math.sin(t * 1.3) * 1.2 + t * 2), cz = Math.round(Math.sin(t * 2.1 + 1) * 0.6);
    const r = 3.2 - t * 0.5;
    const split = y > H - 9 && y < H - 1;
    for (let x = -5; x <= 5; x++)
      for (let z = -5; z <= 5; z++) {
        const dx = x - cx, dz = z - cz;
        // a hand-hewn section: a square with knocked-off corners, adze facets
        if (Math.abs(dx) > r || Math.abs(dz) > r || Math.abs(dx) + Math.abs(dz) > r * 1.45) continue;
        if (split && Math.abs(dx - 0.3) < 0.6 && dz > -2) continue; // the split down from the top
        if (y > H - 4 && Math.abs(dx) + Math.abs(dz) > r * 1.45 - (y - (H - 4)) * 0.7) continue; // a rounded, weathered top
        const c = wood(x, y, z);
        if (c != null) m.set(x, y, z, c);
      }
  }
  // rope lashing round the post under the sheet
  const rope = ropeMat({ along: 'y', seed: 3 });
  for (let y = 28; y <= 31; y++)
    for (let a = 0; a < 40; a++) {
      const ang = (a / 40) * Math.PI * 2;
      const x = Math.round(Math.cos(ang) * 4.1 + 1.6), z = Math.round(Math.sin(ang) * 4.1);
      const c = rope(x, y + a, z);
      if (c != null) m.set(x, y, z, c);
    }
  for (let k = 0; k < 6; k++) m.set(5, 27 - k, Math.round(Math.sin(k) * 0.6), (rope(0, k, 0) ?? 0x8a6a42) as number); // the loose end
  // a forged iron band round the head of the post, a rivet through it
  const band = blackIron(9, 0.5);
  for (let y = 60; y <= 62; y++)
    for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2;
      const x = Math.round(Math.cos(ang) * 3.9 + 2), z = Math.round(Math.sin(ang) * 3.9 + 0.4);
      m.set(x, y, z, (band(x, y, z) ?? 0x3a3a40) as number, VF.SOLID | VF.METAL);
    }
  m.set(-2, 61, 1, 0x6a6a72, VF.SOLID | VF.METAL);
  // the nail: a square forged head on the front face
  const iron = blackIron(5);
  const nz = 5;
  for (let x = 1; x <= 3; x++) for (let y = 55; y <= 57; y++) m.set(x, y, nz, (iron(x, y, nz) ?? 0x3a3a40) as number, VF.SOLID | VF.METAL);
  m.set(2, 56, nz + 1, 0x52535a, VF.SOLID | VF.METAL);
  return m;
}
function getStakeGeo() {
  if (!stakeGeo) stakeGeo = buildVoxelGeometry(stakeModel(), { voxelSize: STAKE_VS, pivot: [0.5, 0, 0.5] });
  return stakeGeo;
}
/** where the sheet hangs from on the stake (m, stake space) */
const NAIL = new THREE.Vector3(2 * STAKE_VS, 56 * STAKE_VS, 6.5 * STAKE_VS);

// ------------------------------------------------------------------ the sheet
const PAPER = /* glsl */ `
{
  vec2 pUv = vMapUv;
  float pEdge = paperEdge(pUv, uAspect);
  float pTear = paperTear(pUv, 0.025);
  if (pEdge < pTear) discard;
  // torn in two on a miss: each half keeps its side of a ragged line
  float pSplit = 0.5 + 0.06 * sin(pUv.y * 23.0 + uSeed * 9.0) + (pFbm(pUv * vec2(4.0, 30.0)) - 0.5) * 0.08;
  if (uHalf > 0.5 && uHalf < 1.5 && pUv.x > pSplit) discard;
  if (uHalf > 1.5 && pUv.x < pSplit) discard;
  vec3 pCol = parchment(pUv * 0.55 + uSeed, uAspect, pEdge, pTear); // a small sheet: coarser fibres, no moire
  if (uHalf > 0.5) pCol = mix(pCol, vec3(0.55, 0.38, 0.2), smoothstep(0.025, 0.0, abs(pUv.x - pSplit)) * 0.7);
  // the nail hole, torn out once it is ripped
  if (bulletHole(pUv, uAspect, vec2(0.5, 0.955), uRipped > 0.5 ? 0.06 : 0.022, pCol) < 0.5) discard;
  float fold = exp(-pow((pUv.y - 0.5) * 140.0, 2.0)) * 0.8;
  pCol *= 1.0 - 0.07 * fold;
  vec3 pLin = pow(pCol, vec3(2.2));
  vec4 pInk = texture2D(map, pUv);
  float pPress = 0.8 + 0.2 * smoothstep(0.2, 0.6, pNoise(pUv * vec2(uAspect, 1.0) * 200.0));
  pLin = mix(pLin, pInk.rgb * mix(vec3(1.0), pLin * 1.1, 0.2), pInk.a * pPress);
  if (uStamp > 0.001) {
    float st = rubberStamp(pUv, uAspect, uStampRect, uStampAng, uStampMap);
    pLin = mix(pLin, uStampCol * mix(vec3(1.0), pLin, 0.25), st * 0.85 * uStamp);
  }
  diffuseColor.rgb *= pLin;
}
`;

function sheetGeometry() {
  // hung from its top centre: the bottom corners curl out, a little belly in the middle
  const g = new THREE.PlaneGeometry(PW, PH, 10, 14);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const xn = pos.getX(i) / (PW / 2), yn = pos.getY(i) / (PH / 2);
    const low = Math.pow((1 - yn) / 2, 2);
    pos.setZ(i, 0.012 * Math.sin(((yn + 1) / 2) * Math.PI) * (1 - xn * xn) + 0.05 * low * xn * xn + 0.004 * Math.sin(xn * 3 + yn * 2));
    pos.setY(i, pos.getY(i) - PH / 2); // pivot at the top edge
  }
  g.computeVertexNormals();
  return g;
}

function inkTexture(cv: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** the outlaw photographed from its own rig, printed in sepia */
function portrait(renderer: THREE.WebGLRenderer, geo: RigGeo | null): HTMLCanvasElement | null {
  if (!geo?.parts?.length) return null;
  const mat = makeVoxelMaterial({ fog: false });
  const f = new IconFactory(renderer);
  try {
    const r = new RigInstance(geo, { material: mat, castShadow: false });
    r.setExpression('angry');
    if (r.nodes['jaw']) r.nodes['jaw'].rotation.x = r.exprJaw;
    r.root.updateMatrixWorld(true);
    const shot = f.capture(r.root, { w: 88, h: 84, ss: 3, yaw: 0.45, pitch: 0.12, fill: 0.95, light: 'sunset', levels: 10, ink: '#2a160a', rim: '#ffe2a8' });
    const c = shot.getContext('2d')!;
    const id = c.getImageData(0, 0, shot.width, shot.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
      const k = Math.min(1, Math.max(0, (l - 0.04) * 1.15));
      d[i] = Math.min(255, 66 + k * 180);
      d[i + 1] = Math.min(255, 38 + k * 152);
      d[i + 2] = Math.min(255, 20 + k * 104);
    }
    c.putImageData(id, 0, 0);
    return shot;
  } catch (e) {
    console.warn('[bounty] portrait', e);
    return null;
  } finally {
    f.dispose();
    mat.dispose();
  }
}

/** the poster's ink: Alagard type and the printed photograph (the paper and the stamp are the shader) */
function paintSheet(name: string, reward: number, boss: boolean, photo: HTMLCanvasElement | null) {
  const cv = document.createElement('canvas');
  cv.width = CW;
  cv.height = CH;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.fillStyle = INK;
  c.font = '64px Alagard';
  c.fillText('WANTED', CW / 2, 18);
  c.font = '16px Alagard';
  c.fillText(boss ? '- BY THE GODS, DEAD OR ALIVE -' : '- DEAD OR ALIVE -', CW / 2, 88);
  if (photo) {
    const s = 3;
    c.globalAlpha = 0.95;
    c.drawImage(photo, Math.round(CW / 2 - (photo.width * s) / 2), 112, photo.width * s, photo.height * s);
    c.globalAlpha = 1;
  }
  let sz = 32;
  c.font = `${sz}px Alagard`;
  const nm = name.toUpperCase();
  if (c.measureText(nm).width > CW - 40) {
    sz = 16;
    c.font = `${sz}px Alagard`;
  }
  c.fillStyle = INK;
  c.fillText(nm, CW / 2, 372 + (sz === 16 ? 8 : 0));
  c.font = '48px Alagard';
  c.fillStyle = '#6a1a10';
  c.fillText(`$${Math.round(reward).toLocaleString('en-US')}`, CW / 2, 410);
  return cv;
}
function paintStampWord(word: string) {
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = '64px Alagard';
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(m.measureText(word).width) + 48;
  cv.height = 96;
  const c = cv.getContext('2d')!;
  c.font = '64px Alagard';
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(word, cv.width / 2, cv.height / 2 + 4);
  return cv;
}

interface Poster {
  root: THREE.Group;
  stake: THREE.Mesh;
  sheets: THREE.Mesh[];
  mats: THREE.MeshStandardMaterial[];
  u: Record<string, THREE.IUniform>;
  ink: THREE.CanvasTexture;
  stampTex: THREE.CanvasTexture;
  at: THREE.Vector3;
  reward: number;
  t: number;
  drop: number;
  state: 'up' | 'offer' | 'flying' | 'torn' | 'gone';
  offers: number;
  wasNear: boolean;
  fly: { t: number; from: THREE.Vector3; v: THREE.Vector3; spin: THREE.Vector3 }[];
  result: QuickResult | null;
}

export class BountyRip {
  private posters: Poster[] = [];
  private offering: Poster | null = null;
  private stakeMat: VoxelMaterial;
  private sheetGeo = sheetGeometry();
  private offs: (() => void)[] = [];
  private scene: THREE.Scene;
  private tick = (_dt: number, rdt: number) => this.update(Math.min(0.1, rdt));

  constructor(private h: RipHost) {
    const ctx = h.ctx;
    this.scene = ctx.scene;
    this.stakeMat = makeVoxelMaterial();
    this.offs.push(
      ctx.events.on('bossDefeated', (b: any, escaped: boolean) => {
        if (escaped || !b?.pos) return;
        this.spawn(b.pos, b.name ?? 'Outlaw', b.bounty ?? 150, b.rig?.geo ?? null, true);
      }),
      ctx.events.on('enemyKilled', (en: any) => {
        if (!en?.alpha || !en.pos) return;
        const gain = h.player.stats?.get?.('bountyGain') ?? 1;
        const base = (en.def?.bounty ?? 10) * 8 * gain * (1 + ctx.run.wave * 0.04);
        // its portrait comes from the very geometry the horde renders it with
        this.spawn(en.pos, en.name ?? 'Alpha', base, en.batch?.geo ?? null, false);
      })
    );
    ctx.engine.onAfterUpdate.push(this.tick);
    (window as any).__bountyRip = this;
  }

  /** a poster slams into the sand beside the body */
  spawn(where: { x: number; y?: number; z: number }, name: string, reward: number, geo: RigGeo | null, boss: boolean) {
    const ctx = this.h.ctx;
    if (this.posters.filter((p) => p.state !== 'gone').length >= MAX_POSTERS) this.retire(this.posters[0]);
    // beside the body, on the side facing the hunter
    const pp = this.h.player.pos;
    let dx = pp.x - where.x, dz = pp.z - where.z;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    const at = new THREE.Vector3(where.x + dx * 1.4 - dz * 1.1, 0, where.z + dz * 1.4 + dx * 1.1);
    at.y = ctx.world.groundAt(at.x, at.z);
    const root = new THREE.Group();
    root.position.copy(at);
    root.rotation.y = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.4;
    const stake = new THREE.Mesh(getStakeGeo(), this.stakeMat);
    stake.castShadow = stake.receiveShadow = true;
    stake.rotation.set((Math.random() - 0.5) * 0.12, 0, (Math.random() - 0.5) * 0.14);
    root.add(stake);
    // the sheet
    const photo = portrait(ctx.engine.renderer, geo);
    const ink = inkTexture(paintSheet(name, reward, boss, photo));
    const sw = paintStampWord('CLAIMED');
    const stampTex = inkTexture(sw);
    stampTex.minFilter = THREE.LinearFilter;
    stampTex.generateMipmaps = false;
    const u: Record<string, THREE.IUniform> = {
      uSeed: { value: Math.random() },
      uAspect: { value: PW / PH },
      uStamp: { value: 0 },
      uStampAng: { value: -0.18 + Math.random() * 0.1 },
      uStampRect: { value: new THREE.Vector4(0.5, 1 - STAMP_Y / CH, sw.width / 2 / CH, sw.height / 2 / CH) },
      uStampCol: { value: new THREE.Color('#b02a1a') },
      uStampMap: { value: stampTex },
      uRipped: { value: 0 },
    };
    const mats: THREE.MeshStandardMaterial[] = [];
    const sheets: THREE.Mesh[] = [];
    for (let half = 0; half < 3; half++) {
      const mat = new THREE.MeshStandardMaterial({ map: ink, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
      const uh = { uHalf: { value: half } };
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u, uh);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uAspect, uStamp, uStampAng, uHalf, uRipped;\nuniform vec4 uStampRect;\nuniform vec3 uStampCol;\nuniform sampler2D uStampMap;\n' + PARCHMENT_GLSL)
          .replace('#include <map_fragment>', PAPER);
      };
      mat.customProgramCacheKey = () => 'dustup-bounty-sheet';
      const s = new THREE.Mesh(this.sheetGeo, mat);
      s.castShadow = true;
      s.receiveShadow = true;
      s.visible = half === 0;
      mats.push(mat);
      sheets.push(s);
    }
    const hang = new THREE.Group();
    hang.position.copy(NAIL);
    stake.add(hang);
    for (const s of sheets) hang.add(s);
    this.scene.add(root);
    const p: Poster = { root, stake, sheets, mats, u, ink, stampTex, at, reward, t: 0, drop: 0, state: 'up', offers: 0, wasNear: false, fly: [], result: null };
    this.posters.push(p);
    ctx.sfx('whoosh', { x: at.x, y: at.y + 2, z: at.z }, 0.5, 0.8);
    return p;
  }

  private update(rdt: number) {
    const ctx = this.h.ctx;
    // the scene that owns us is gone: tidy up
    if ((ctx.engine.current as any)?.scene !== this.scene) {
      this.dispose();
      return;
    }
    const pp = this.h.player.pos;
    const t = ctx.engine.realTime;
    let best: Poster | null = null, bd = RANGE;
    for (const p of this.posters) {
      p.t += rdt;
      if (p.state === 'gone') continue;
      // the slam: down out of the air, a thunk into the sand, a shiver
      if (p.drop < 1) {
        const was = p.drop;
        p.drop = Math.min(1, p.drop + rdt / 0.32);
        const k = p.drop * p.drop;
        p.stake.position.y = (1 - k) * 3.2;
        if (was < 1 && p.drop >= 1) {
          ctx.sfx('dagger_stab', p.at, 0.9, 0.6);
          ctx.sfx('poster_slam', p.at, 0.5, 1.2);
          ctx.fx.dust({ x: p.at.x, y: p.at.y + 0.1, z: p.at.z }, 0.9, 0xe6cf9f, 6);
          ctx.particles.emit({ pos: { x: p.at.x, y: p.at.y + 0.05, z: p.at.z }, count: 18, spread: 2.2, up: 2.4, life: [0.4, 0.9], size: [0.05, 0.08], sprite: ['dot3', 'grain0'], color: [0xf0d29a, 0xe3bd80, 0xd6a968], gravity: 12, ground: true });
          p.stake.rotation.z += 0.05;
        }
      }
      p.stake.rotation.z *= Math.exp(-4 * rdt);
      // the sheet sways on its nail in the wind
      if (p.state === 'up' || p.state === 'offer') {
        const s = p.sheets[0];
        s.rotation.x = -0.06 + Math.sin(t * 2.1 + p.u.uSeed.value * 9) * 0.05;
        s.rotation.z = Math.sin(t * 1.4 + p.u.uSeed.value * 5) * 0.04;
      }
      if (p.state === 'flying' || p.state === 'torn') this.animateFly(p, rdt);
      if (p.t > LIFE && p.state === 'up') this.blowAway(p);
      // nearest one in reach gets the offer
      if (p.state === 'up' && p.drop >= 1) {
        const d = Math.hypot(pp.x - p.at.x, pp.z - p.at.z);
        if (d > RANGE + 1.5) p.wasNear = false;
        if (d < bd && !p.wasNear) {
          bd = d;
          best = p;
        }
      }
    }
    this.posters = this.posters.filter((p) => {
      if (p.state === 'gone' && !p.root.parent) return false;
      return true;
    });
    if (best && !this.offering && this.h.player.alive && !this.h.qte.active && !this.h.qte.quickActive) this.offer(best);
  }

  private offer(p: Poster) {
    p.state = 'offer';
    p.wasNear = true;
    p.offers++;
    this.offering = p;
    const top = () => p.sheets[0].getWorldPosition(_v2).add(_v.set(0, -PH * 0.45, 0));
    void this.h.qte.quick({ action: 'interact', label: 'RIP IT', duration: 0.95, at: () => top() }).then((r) => {
      this.offering = null;
      if (r === 'skip') {
        p.state = 'up';
        if (p.offers >= 3) p.t = Math.max(p.t, LIFE - 8);
        return;
      }
      this.rip(p, r);
    });
  }

  private rip(p: Poster, r: QuickResult) {
    const ctx = this.h.ctx;
    p.result = r;
    const at = p.sheets[0].getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -PH * 0.45, 0));
    ctx.sfx('paper_flutter', at, 1, r === 'fail' ? 0.8 : 1.1);
    ctx.sfx('page_turn', at, 0.8, 0.7);
    // scraps off the nail
    ctx.particles.emit({ pos: { x: at.x, y: at.y + PH * 0.4, z: at.z }, count: r === 'fail' ? 26 : 12, spread: 2.6, up: 1.2, life: [0.8, 1.6], size: [0.06, 0.04], sprite: ['linen', 'dot3'], color: [0xe8d8b0, 0xd6c08e, 0xbfa070], gravity: 3, drag: 1.6, rot: 6, rotSpeed: 6 });
    p.u.uRipped.value = 1;
    if (r === 'fail') {
      // torn in two: each half flutters off
      p.state = 'torn';
      p.sheets[0].visible = false;
      for (const k of [1, 2]) {
        const s = p.sheets[k];
        s.visible = true;
        s.getWorldPosition(_v);
        this.scene.attach(s);
        const side = k === 1 ? -1 : 1;
        p.fly.push({ t: 0, from: _v.clone(), v: new THREE.Vector3(side * 1.8 + (Math.random() - 0.5), 2 + Math.random(), (Math.random() - 0.5) * 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.root.rotation.y), spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, side * 4) });
      }
      ctx.toast('TORN', '#d8c8a8', 'The bounty still counts');
      return;
    }
    // a clean rip: stamped, it flies to the hunter and pays out
    p.state = 'flying';
    p.u.uStamp.value = 1;
    ctx.sfx('poster_slam', at, 0.9, 1);
    const s = p.sheets[0];
    s.getWorldPosition(_v);
    this.scene.attach(s);
    p.fly.push({ t: 0, from: _v.clone(), v: new THREE.Vector3(0, 3.2, 0), spin: new THREE.Vector3(-3, 7, 2) });
    const perfect = r === 'perfect';
    const extra = Math.round(p.reward * (perfect ? 0.25 : 0.1));
    const gold = perfect ? 12 + Math.round(ctx.run.wave * 0.8) : 0;
    ctx.engine.tweens.after(0.55, () => {
      this.h.addBounty(extra);
      if (gold > 0) this.h.addGold(gold);
      const pp = this.h.player.pos;
      const c = { x: pp.x, y: pp.y + 1.6, z: pp.z };
      ctx.fx.coins(c, perfect ? 14 : 6);
      ctx.fx.sparkle(c, 0xffd36b, perfect ? 16 : 8, 0.9);
      ctx.fx.number(c, `+${extra}`, 0xffd36b, perfect ? 1.3 : 1);
      ctx.sfx(perfect ? 'gold_burst' : 'pickup_bounty', null, 0.8);
      if (perfect) ctx.sfx('sting_positive', null, 0.5);
      ctx.toast(perfect ? 'CLEAN RIP' : 'BOUNTY RIPPED', perfect ? '#ffd36b' : '#c8ff5a', perfect ? `+${extra} bounty  +${gold} gold` : `+${extra} bounty`);
    }, true);
  }

  /** a sheet in the air: up off the nail, then home to the hunter (clean) or tumbling away (torn) */
  private animateFly(p: Poster, dt: number) {
    const pp = this.h.player.pos;
    let alive = 0;
    p.fly.forEach((f, i) => {
      const s = p.state === 'torn' ? p.sheets[i + 1] : p.sheets[0];
      f.t += dt;
      if (p.state === 'flying') {
        // rise, then a homing arc into the hunter's chest, folding smaller
        const k = Math.min(1, f.t / 0.55);
        const target = _v.set(pp.x, pp.y + 1.3, pp.z);
        const up = f.from.clone().add(new THREE.Vector3(0, 1.2, 0));
        const a = up.clone().lerp(target, k * k);
        s.position.copy(f.from.clone().lerp(up, Math.min(1, f.t / 0.2)).lerp(a, k));
        s.rotation.x += f.spin.x * dt;
        s.rotation.y += f.spin.y * dt;
        s.scale.setScalar(Math.max(0.05, 1 - k * 0.9));
        if (k < 1) alive++;
      } else {
        // flutter down and off on the wind
        f.v.y -= 2.2 * dt;
        f.v.multiplyScalar(Math.exp(-1.2 * dt));
        f.v.y = Math.max(f.v.y, -0.9);
        s.position.addScaledVector(f.v, dt);
        s.position.x += Math.sin(f.t * 5 + i) * 0.6 * dt;
        s.rotation.x += f.spin.x * dt;
        s.rotation.y += f.spin.y * dt;
        s.rotation.z += f.spin.z * dt * Math.exp(-f.t);
        if (f.t < 3) alive++;
        else s.visible = false;
      }
    });
    if (!alive) {
      for (const s of p.sheets) s.visible = false;
      this.retireLater(p);
    }
  }

  /** an untouched poster after a minute: the wind takes the sheet, the stake sinks */
  private blowAway(p: Poster) {
    p.state = 'torn';
    const s = p.sheets[0];
    s.getWorldPosition(_v);
    this.scene.attach(s);
    p.sheets[1].visible = p.sheets[2].visible = false;
    // the torn halves never show: reuse the clean sheet as the only flyer
    p.sheets[1] = s;
    p.fly.push({ t: 0, from: _v.clone(), v: new THREE.Vector3(2.5, 1.5, 1), spin: new THREE.Vector3(2, 3, 1) });
    this.h.ctx.sfx('paper_flutter', p.at, 0.4, 0.8);
  }

  private retireLater(p: Poster) {
    if (p.state === 'gone') return;
    p.state = 'gone';
    // the stake stays a while as a marker, then sinks into the sand
    this.h.ctx.engine.tweens.run(1.5, (k) => (p.stake.position.y = -k * 2), undefined, { real: true, delay: 6, done: () => this.retire(p) });
  }

  private retire(p: Poster) {
    p.state = 'gone';
    p.root.removeFromParent();
    for (const s of p.sheets) s.removeFromParent();
    for (const m of p.mats) m.dispose();
    p.ink.dispose();
    p.stampTex.dispose();
    if (this.offering === p) this.offering = null;
  }

  dispose() {
    const ctx = this.h.ctx;
    const i = ctx.engine.onAfterUpdate.indexOf(this.tick);
    if (i >= 0) ctx.engine.onAfterUpdate.splice(i, 1);
    for (const off of this.offs) off();
    this.offs = [];
    for (const p of this.posters) this.retire(p);
    this.posters = [];
    this.stakeMat.dispose();
    this.sheetGeo.dispose();
    if ((window as any).__bountyRip === this) delete (window as any).__bountyRip;
  }
}
