// Run-scoped EQUIPMENT: six slots (head, body, hands, feet, tool, charm), one
// piece per slot. Equipping replaces the slot's piece (GearPickups asks the
// player first). Every piece is a sculpted voxel model worn on Sundown's rig
// (fitted to his measured head / torso / fists / feet, attached by part and
// socket name), with real gameplay: stat modifiers plus small event-driven
// effects. Effects switch on and off cleanly with the piece.
//
// Hooks into the player without touching Player.ts: listeners on ctx.events,
// polling of public player state, and one interception of player.takeHit /
// player.applyDamage (an instance-level wrapper, removed again on dispose) for
// the defensive pieces (frontal block, knockback immunity, poison immunity,
// storm sight, cheat death).
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../Ctx';
import type { Player } from './Player';
import type { Hit } from '../combat/Damage';
import type { Modifier, StatId } from '../combat/Stats';
import { RARITY, Rarity } from '../run/Upgrades';
import type { RigInstance } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { GEAR_VS, GearAnchor, GearFit, GearModelId, GearPiece, DEFAULT_FIT, gearPieces, gearDisplay, Box } from '../models/props/gear';

export type GearSlot = 'head' | 'body' | 'hands' | 'feet' | 'tool' | 'charm';
export type GearId = GearModelId;
export type GearRarity = Exclude<Rarity, 'mythic'>;
type M = Omit<Modifier, 'source'>;

export const GEAR_SLOTS: GearSlot[] = ['head', 'body', 'hands', 'feet', 'tool', 'charm'];
export const SLOT_INFO: Record<GearSlot, { name: string }> = {
  head: { name: 'Head' },
  body: { name: 'Body' },
  hands: { name: 'Hands' },
  feet: { name: 'Feet' },
  tool: { name: 'Grapple' },
  charm: { name: 'Charm' },
};

export interface GearDef {
  id: GearId;
  name: string;
  slot: GearSlot;
  rarity: GearRarity;
  desc: string;
  lore?: string;
  god?: string;
  /** base price at the trading post (scaled by wave) */
  price: number;
  mods?: M[];
}

export const GEAR: Record<GearId, GearDef> = {
  // ------------------------------------------------------------------ head
  sunGoggles: { id: 'sunGoggles', name: 'Sun-Glass Goggles', slot: 'head', rarity: 'rare', price: 140, desc: 'See through sandstorms: storm and dust-devil damage -75%. Aiming telescopes the lenses: +15% crit chance, -20% spread. +15% crit damage.', lore: 'Amber ground from a lightning-struck dune.', mods: [{ stat: 'critDmg', type: 'flat', value: 0.15 }] },
  thothSpecs: { id: 'thothSpecs', name: 'Smoked Spectacles of Thoth', slot: 'head', rarity: 'epic', price: 220, god: 'Thoth', desc: 'A golden glint marks every skull in sight. Headshots deal +40% bonus divine damage. +4 Luck.', lore: 'The ibis reads the ledger of every weak point.', mods: [{ stat: 'luck', type: 'flat', value: 4 }] },
  jackalMask: { id: 'jackalMask', name: 'Jackal Half-Mask', slot: 'head', rarity: 'rare', price: 140, god: 'Anubis', desc: 'Kills within 7 m howl: nearby enemies are slowed and cursed, and you heal 3%. +2 Defense.', mods: [{ stat: 'def', type: 'flat', value: 2 }] },
  respirator: { id: 'respirator', name: 'Scarab Respirator', slot: 'head', rarity: 'uncommon', price: 90, god: 'Khepri', desc: 'Breathe easy: immune to poison, toxic damage -70%. +15% status potency, +2 Magic.', mods: [{ stat: 'statusPower', type: 'pct', value: 0.15 }, { stat: 'magic', type: 'flat', value: 2 }] },
  // ------------------------------------------------------------------ body
  scarabPlate: { id: 'scarabPlate', name: 'Scarab-Plate Armour', slot: 'body', rarity: 'epic', price: 220, god: 'Khepri', desc: 'Hits from the front are 60% blocked, and blocked bullets ricochet back at the shooter. +30 Armor, +5% physical resist.', mods: [{ stat: 'armor', type: 'flat', value: 30 }, { stat: 'physRes', type: 'flat', value: 0.05 }] },
  mummyWrap: { id: 'mummyWrap', name: 'Mummy-Wrap Vest', slot: 'body', rarity: 'uncommon', price: 90, desc: '+3 Vitality, +1.5 regen/s. Unhurt for 4 s, the linen knits you back together: +4 regen/s more.', lore: 'Previous owner no longer needs it. Mostly.', mods: [{ stat: 'vit', type: 'flat', value: 3 }, { stat: 'regen', type: 'flat', value: 1.5 }] },
  bonePauldrons: { id: 'bonePauldrons', name: 'Bone Pauldrons', slot: 'body', rarity: 'rare', price: 140, desc: 'Immovable: immune to knockback. Riding into enemies above 13 m/s shoulder-charges them (stun, speed-scaled damage). +15 Armor.', mods: [{ stat: 'armor', type: 'flat', value: 15 }] },
  cactusJerkin: { id: 'cactusJerkin', name: 'Cactus-Hide Jerkin', slot: 'body', rarity: 'uncommon', price: 90, desc: 'Prickly: enemies that hit you up close take 14 damage and bleed. +3 Defense.', mods: [{ stat: 'def', type: 'flat', value: 3 }] },
  // ------------------------------------------------------------------ hands
  gunslingerGloves: { id: 'gunslingerGloves', name: 'Gunslinger Gloves', slot: 'hands', rarity: 'uncommon', price: 90, desc: 'Fanning the hammer is 25% faster. +12% fire rate, +15% reload speed.', mods: [{ stat: 'fireRate', type: 'pct', value: 0.12 }, { stat: 'reloadSpeed', type: 'pct', value: 0.15 }] },
  stingerGauntlet: { id: 'stingerGauntlet', name: "Serket's Stinger Gauntlet", slot: 'hands', rarity: 'rare', price: 140, god: 'Serket', desc: 'Your fist stings: melee hits inject 5 poison stacks, counters 12. +30% melee damage.', mods: [{ stat: 'meleeDmg', type: 'pct', value: 0.3 }] },
  brassKnuckles: { id: 'brassKnuckles', name: 'Brass Knuckle-Dusters', slot: 'hands', rarity: 'uncommon', price: 90, desc: 'Counters burst into a 4.5 m shockwave. +45% melee damage, +20% knockback.', mods: [{ stat: 'meleeDmg', type: 'pct', value: 0.45 }, { stat: 'knockback', type: 'pct', value: 0.2 }] },
  // ------------------------------------------------------------------ feet
  ironSpurs: { id: 'ironSpurs', name: 'Iron Spurs', slot: 'feet', rarity: 'uncommon', price: 90, desc: 'Board kicks: riding through enemies above 7 m/s rakes them with the spurs (damage + bleed). Grapple kicks bleed. +10% acceleration.', mods: [{ stat: 'accel', type: 'pct', value: 0.1 }] },
  rattlesnakeBoots: { id: 'rattlesnakeBoots', name: 'Rattlesnake Boots', slot: 'feet', rarity: 'rare', price: 140, desc: 'Charged jumps go 25% higher. Landing from big air rattles out a venom shockwave.', mods: [{ stat: 'jump', type: 'pct', value: 0.25 }] },
  duneStriders: { id: 'duneStriders', name: 'Dune-Strider Boots', slot: 'feet', rarity: 'common', price: 60, desc: '+10% push speed, +15% acceleration, +25% boost regen, +4% dodge.', mods: [{ stat: 'moveSpeed', type: 'pct', value: 0.1 }, { stat: 'accel', type: 'pct', value: 0.15 }, { stat: 'boostRegen', type: 'pct', value: 0.25 }, { stat: 'dodge', type: 'flat', value: 0.04 }] },
  // ------------------------------------------------------------------ tool (grappling hooks)
  barbedHook: { id: 'barbedHook', name: 'Barbed Grappling Hook', slot: 'tool', rarity: 'rare', price: 140, desc: 'Hooking an enemy yanks it to your feet, stunned and bleeding (and the hook comes back fast). Bosses just bleed.' },
  twinClaw: { id: 'twinClaw', name: 'Twin-Claw Hook', slot: 'tool', rarity: 'epic', price: 220, desc: 'Two anchors: the second claw is ready right after the first for a double swing. Claws rake hooked enemies.' },
  lightningReel: { id: 'lightningReel', name: 'Lightning Reel Hook', slot: 'tool', rarity: 'legendary', price: 320, god: 'Set', desc: 'Zips you in 85% faster. Arriving cracks into a 4.5 m lightning burst that stuns everything.', lore: 'Wound with copper stolen from the telegraph.' },
  // ------------------------------------------------------------------ charm
  glassEye: { id: 'glassEye', name: 'Lucky Glass Eye', slot: 'charm', rarity: 'rare', price: 140, desc: 'The first shot after every reload is a guaranteed crit. +10% crit chance, +25% crit damage, +3 Luck.', mods: [{ stat: 'critChance', type: 'flat', value: 0.1 }, { stat: 'critDmg', type: 'flat', value: 0.25 }, { stat: 'luck', type: 'flat', value: 3 }] },
  hourglass: { id: 'hourglass', name: 'Hourglass of Khonsu', slot: 'charm', rarity: 'epic', price: 220, god: 'Khonsu', desc: 'When hurt, time slows to a trickle and you are untouchable for a moment (12 s cooldown). +6% cooldown reduction.', mods: [{ stat: 'cdr', type: 'flat', value: 0.06 }] },
  deadMansHand: { id: 'deadMansHand', name: "Dead Man's Hand", slot: 'charm', rarity: 'legendary', price: 320, god: 'Anubis', desc: 'Cheat death once per run: a fatal blow leaves you at 1 HP, untouchable for 2.5 s, and blasts everything away. +4% crit chance.', lore: 'Aces and eights. Wild Bill would have wanted it this way.', mods: [{ stat: 'critChance', type: 'flat', value: 0.04 }] },
};

export const GEAR_IDS = Object.keys(GEAR) as GearId[];
export const GEAR_RARITY_ORDER: GearRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const gearColor = (id: GearId) => RARITY[GEAR[id].rarity].color;
export const gearHex = (id: GearId) => RARITY[GEAR[id].rarity].hex;

// ===================================================================== fitting
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const VS = GEAR_VS;

interface Frame {
  node: THREE.Object3D;
  pos: THREE.Vector3;
}

/** vertex positions of a rig part (node-local metres) */
function partVerts(rig: RigInstance, name: string): ArrayLike<number> | null {
  const m = rig.meshes[name];
  return (m?.geometry.getAttribute('position')?.array as ArrayLike<number>) ?? null;
}

/** bounds of the vertices that pass a filter */
function vbox(a: ArrayLike<number> | null, keep: (x: number, y: number, z: number) => boolean) {
  const b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9, n: 0 };
  if (!a) return b;
  for (let i = 0; i < a.length; i += 3) {
    const x = a[i], y = a[i + 1], z = a[i + 2];
    if (!keep(x, y, z)) continue;
    b.n++;
    if (x < b.x0) b.x0 = x;
    if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y;
    if (y > b.y1) b.y1 = y;
    if (z < b.z0) b.z0 = z;
    if (z > b.z1) b.z1 = z;
  }
  return b;
}

/**
 * Measure the hero's body (in gear voxels) and the anchor frames gear hangs from.
 * Everything comes from the rig's own sockets and part meshes, so a redesigned
 * hero still wears his gear properly.
 */
export function measureRig(rig: RigInstance): { fit: GearFit; frames: Partial<Record<GearAnchor, Frame>> } {
  const fit: GearFit = JSON.parse(JSON.stringify(DEFAULT_FIT));
  const frames: Partial<Record<GearAnchor, Frame>> = {};
  const S = rig.sockets, N = rig.nodes;
  const g = (m: number) => m / VS;
  // ---- face
  const head = N['head'];
  if (head) {
    const hv = partVerts(rig, 'head');
    const all = vbox(hv, () => true);
    const el = S['eye_l']?.parent === head ? S['eye_l'].position : null;
    const er = S['eye_r']?.parent === head ? S['eye_r'].position : null;
    const ey = el && er ? (el.y + er.y) / 2 : all.y0 + (all.y1 - all.y0) * 0.45;
    const ex = el && er ? (el.x + er.x) / 2 : (all.x0 + all.x1) / 2;
    const band = vbox(hv, (x, y) => Math.abs(y - ey) < 0.05 && Math.abs(x - ex) < 0.12);
    const fz = band.n ? band.z1 : all.z1;
    const brow = vbox(hv, (_x, y) => y > ey + 0.02 && y < ey + 0.1);
    const hb = brow.n ? brow : all;
    const hat = N['hat'];
    fit.head = {
      hw: g(Math.max(hb.x1 - ex, ex - hb.x0)),
      back: g(hb.z0 - fz),
      top: g(all.y1 - ey),
      brim: hat && hat.parent === head ? g(hat.position.y - ey) : g(all.y1 - ey),
      chin: g(all.y0 - ey),
    };
    frames.face = { node: head, pos: new THREE.Vector3(ex, ey, fz) };
  }
  // ---- torso
  const torso = N['torso'];
  if (torso) {
    const tv = partVerts(rig, 'torso');
    const all = vbox(tv, () => true);
    const cy = S['chest']?.parent === torso ? S['chest'].position.y : all.y0 + (all.y1 - all.y0) * 0.55;
    const band = vbox(tv, (_x, y) => Math.abs(y - cy) < 0.06);
    const b = band.n ? band : all;
    fit.torso = { hw: g(Math.max(b.x1, -b.x0)), back: g(b.z0 - b.z1), top: g(all.y1 - cy), waist: g(all.y0 - cy) };
    frames.torso = { node: torso, pos: new THREE.Vector3(0, cy, b.z1) };
  }
  // ---- shoulders
  for (const k of ['shoulder_l', 'shoulder_r'] as const) if (S[k]) frames[k] = { node: S[k].parent!, pos: S[k].position.clone() };
  // ---- hands: the fist is whatever of the forearm mesh lies around the hand socket
  for (const [k, part] of [['hand_l', 'fore_l'], ['hand_r', 'fore_r']] as const) {
    const s = S[k];
    if (!s) continue;
    const node = s.parent!;
    const p = s.position;
    const fv = rig.meshes[part] && node === N[part] ? partVerts(rig, part) : null;
    const fb = vbox(fv, (_x, y) => y < p.y + 0.09);
    if (fb.n > 8) fit[k] = { x0: g(fb.x0 - p.x), x1: g(fb.x1 - p.x), y0: g(fb.y0 - p.y), y1: g(Math.min(fb.y1, p.y + 0.09) - p.y), z0: g(fb.z0 - p.z), z1: g(fb.z1 - p.z) } as Box;
    frames[k] = { node, pos: p.clone() };
  }
  // ---- feet: the bottom of each shin mesh
  for (const [k, part] of [['foot_l', 'shin_l'], ['foot_r', 'shin_r']] as const) {
    const node = N[part];
    if (!node) continue;
    const sv = partVerts(rig, part);
    const all = vbox(sv, () => true);
    const foot = vbox(sv, (_x, y) => y < all.y0 + 0.1);
    const shin = vbox(sv, (_x, y) => y > all.y0 + 0.14 && y < all.y0 + 0.24);
    if (!foot.n) continue;
    const cx = (foot.x0 + foot.x1) / 2, cz = (foot.z0 + foot.z1) / 2;
    if (k === 'foot_l')
      fit.foot = {
        hw: g((foot.x1 - foot.x0) / 2),
        toe: g(foot.z1 - cz),
        heel: g(foot.z0 - cz),
        h: g(Math.min(0.1, foot.y1 - foot.y0)),
        shinHW: shin.n ? g((shin.x1 - shin.x0) / 2) : DEFAULT_FIT.foot.shinHW,
        shinZ0: shin.n ? g(shin.z0 - cz) : DEFAULT_FIT.foot.shinZ0,
        shinZ1: shin.n ? g(shin.z1 - cz) : DEFAULT_FIT.foot.shinZ1,
      };
    frames[k] = { node, pos: new THREE.Vector3(cx, all.y0, cz) };
  }
  // ---- hip (left = mirror of the hip_r socket) and the belt front
  const pelvis = N['pelvis'];
  if (pelvis) {
    const pv = partVerts(rig, 'pelvis');
    const all = vbox(pv, () => true);
    const hr = S['hip_r']?.parent === pelvis ? S['hip_r'].position : new THREE.Vector3(all.x0, (all.y0 + all.y1) / 2, 0);
    frames.hip_l = { node: pelvis, pos: new THREE.Vector3(Math.abs(hr.x), hr.y, hr.z) };
    const bx = Math.abs(hr.x) * 0.45;
    const front = vbox(pv, (x, y) => Math.abs(y - hr.y) < 0.05 && Math.abs(x - bx) < 0.06);
    frames.belt = { node: pelvis, pos: new THREE.Vector3(bx, hr.y - 0.01, (front.n ? front.z1 : all.z1) + 0.01) };
  }
  return { fit, frames };
}

// ===================================================================== meshes
let glassMat: THREE.Material | null = null;
let glassMatHud: THREE.Material | null = null;
/** the see-through glass for lenses, bulbs and domes (shared) */
export function gearGlassMaterial(hud = false) {
  const make = () => {
    const m = makeVoxelMaterial({ transparent: true, opacity: 0.42, roughness: 0.08, fog: !hud });
    m.depthWrite = false;
    return m;
  };
  if (hud) return (glassMatHud ??= make());
  return (glassMat ??= make());
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function pieceGeo(key: string, p: GearPiece) {
  let g = geoCache.get(key);
  if (!g) {
    g = buildVoxelGeometry(p.model, { voxelSize: VS, pivot: [0.5, 0.5, 0.5] });
    geoCache.set(key, g);
  }
  return g;
}

/**
 * A showcase group of a gear item (pairs side by side) centred on its bounds, for
 * world drops, the HUD and card photos. `size` = the largest dimension in metres.
 */
export function buildGearDisplay(id: GearId, opaque: THREE.Material, glass: THREE.Material, size = 0.5) {
  const d = gearDisplay(id);
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  const meshes: THREE.Mesh[] = [];
  for (const [k, model, mat] of [['o', d.model, opaque], ['g', d.glass, glass]] as const) {
    if (!model || !model.map.size) continue;
    const key = 'show:' + id + ':' + k;
    let geo = geoCache.get(key);
    if (!geo) {
      geo = buildVoxelGeometry(model, { voxelSize: VS, pivot: [0.5, 0.5, 0.5] });
      geoCache.set(key, geo);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = k === 'o';
    mesh.receiveShadow = k === 'o';
    if (k === 'g') mesh.renderOrder = 2;
    inner.add(mesh);
    meshes.push(mesh);
  }
  const box = new THREE.Box3();
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!);
  }
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const k = size / Math.max(0.01, sz.x, sz.y, sz.z);
  inner.position.copy(c).multiplyScalar(-k);
  inner.scale.setScalar(k);
  group.userData.extent = sz.clone().multiplyScalar(k);
  return group;
}

// ===================================================================== worn visuals
interface Joint {
  kind: GearPiece['joint'];
  node: THREE.Group;
  rest: THREE.Vector3;
  a: THREE.Vector2;
  w: THREE.Vector2;
  prev: THREE.Vector3 | null;
  pv: THREE.Vector3;
  t: number;
}

interface Worn {
  id: GearId;
  roots: THREE.Group[];
  joints: Joint[];
  hook: { node: THREE.Group; world: THREE.Group } | null;
}

/** dresses a rig in gear: pieces on their anchors, moving bits on little joints */
export class GearRig {
  fit: GearFit;
  frames: Partial<Record<GearAnchor, Frame>>;
  private worn = new Map<GearSlot, Worn>();
  constructor(private rig: RigInstance, private scene: THREE.Object3D, private opaque: THREE.Material, private glass: THREE.Material = gearGlassMaterial()) {
    const m = measureRig(rig);
    this.fit = m.fit;
    this.frames = m.frames;
  }

  wear(slot: GearSlot, id: GearId) {
    this.remove(slot);
    const w: Worn = { id, roots: [], joints: [], hook: null };
    const groups = new Map<string, THREE.Group>();
    const pieces = gearPieces(id, this.fit);
    pieces.forEach((p, i) => {
      const f = this.frames[p.anchor];
      if (!f) return;
      const mesh = new THREE.Mesh(pieceGeo(`${id}:${i}:${this.rig.geo.spec.name}`, p), p.glass ? this.glass : this.opaque);
      mesh.castShadow = !p.glass;
      mesh.receiveShadow = !p.glass;
      if (p.glass) mesh.renderOrder = 2;
      const key = p.group ?? (p.joint ? p.name : '');
      let holder = key ? groups.get(p.anchor + ':' + key) : undefined;
      if (!holder) {
        holder = new THREE.Group();
        holder.name = 'gear:' + id + ':' + (key || p.name);
        holder.position.copy(f.pos).addScaledVector(_v.set(p.at[0], p.at[1], p.at[2]), VS);
        f.node.add(holder);
        w.roots.push(holder);
        if (key) groups.set(p.anchor + ':' + key, holder);
        if (p.joint) {
          const j: Joint = { kind: p.joint, node: holder, rest: holder.position.clone(), a: new THREE.Vector2(), w: new THREE.Vector2(), prev: null, pv: new THREE.Vector3(), t: Math.random() * 9 };
          w.joints.push(j);
          if (p.joint === 'hook') {
            const world = new THREE.Group();
            world.visible = false;
            this.scene.add(world);
            w.hook = { node: holder, world };
          }
        }
      }
      holder.add(mesh);
      if (p.joint === 'hook' && w.hook) {
        const wm = new THREE.Mesh(mesh.geometry, mesh.material);
        wm.castShadow = true;
        w.hook.world.add(wm);
      }
    });
    this.worn.set(slot, w);
  }

  remove(slot: GearSlot) {
    const w = this.worn.get(slot);
    if (!w) return;
    for (const r of w.roots) r.removeFromParent();
    w.hook?.world.removeFromParent();
    this.worn.delete(slot);
  }

  /** animate joints: telescoping lenses, spinning rowels, swinging charms, the flying hook */
  update(dt: number, s: { aiming: boolean; speed: number; grapple: { active: boolean; x: number; y: number; z: number }; from: THREE.Vector3 }) {
    if (dt <= 0) return;
    for (const w of this.worn.values()) {
      for (const j of w.joints) {
        j.t += dt;
        if (j.kind === 'focus') {
          j.a.x += ((s.aiming ? 1 : 0) - j.a.x) * Math.min(1, dt * 12);
          j.node.position.copy(j.rest);
          j.node.position.z += j.a.x * 1.6 * VS;
          j.node.rotation.z = j.a.x * 1.4;
        } else if (j.kind === 'spin') {
          j.node.rotation.x -= dt * (1.5 + s.speed * 2.2);
        } else if (j.kind === 'swing') this.swing(j, dt);
      }
      if (w.hook) {
        const g = s.grapple;
        const fly = g.active;
        w.hook.node.visible = !fly;
        w.hook.world.visible = fly;
        if (fly) {
          const dir = _v.set(g.x - s.from.x, g.y - s.from.y, g.z - s.from.z);
          const L = dir.length() || 1;
          dir.multiplyScalar(1 / L);
          w.hook.world.quaternion.setFromUnitVectors(_v2.set(0, -1, 0), dir);
          w.hook.world.position.set(g.x, g.y, g.z).addScaledVector(dir, -8 * VS);
        }
      }
    }
  }

  /** a pendulum hanging along local −Y, pushed around by the anchor's acceleration */
  private swing(j: Joint, dt: number) {
    const n = j.node;
    const parent = n.parent;
    if (!parent) return;
    const wp = parent.localToWorld(_v.copy(j.rest));
    if (!j.prev) {
      j.prev = wp.clone();
      return;
    }
    const vel = _v2.copy(wp).sub(j.prev).multiplyScalar(1 / dt);
    j.prev.copy(wp);
    const acc = vel.clone().sub(j.pv).multiplyScalar(1 / dt);
    j.pv.lerp(vel, 0.6);
    acc.clampLength(0, 40);
    // effective gravity in the parent's frame
    const geff = new THREE.Vector3(-acc.x * 0.35, -9.8 - acc.y * 0.2, -acc.z * 0.35);
    const q = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    geff.applyQuaternion(q).normalize();
    const tx = -Math.atan2(geff.z, -geff.y), tz = Math.atan2(geff.x, -geff.y);
    const k = 70, c = 7;
    j.w.x += ((tx - j.a.x) * k - j.w.x * c) * dt;
    j.w.y += ((tz - j.a.y) * k - j.w.y * c) * dt;
    j.a.x = THREE.MathUtils.clamp(j.a.x + j.w.x * dt, -1.2, 1.2);
    j.a.y = THREE.MathUtils.clamp(j.a.y + j.w.y * dt, -1.2, 1.2);
    n.rotation.set(j.a.x, 0, j.a.y);
  }

  dispose() {
    for (const s of [...this.worn.keys()]) this.remove(s);
  }
}

// ===================================================================== shared fx helpers
type P3 = { x: number; y: number; z: number };

/** a jagged pixel-art lightning bolt between two points */
export function zap(ctx: Ctx, a: P3, b: P3, color = 0x9fe0ff, seg = 7) {
  let px = a.x, py = a.y, pz = a.z;
  for (let i = 1; i <= seg; i++) {
    const t = i / seg;
    const j = i === seg ? 0 : 0.45;
    const x = a.x + (b.x - a.x) * t + (Math.random() - 0.5) * j, y = a.y + (b.y - a.y) * t + (Math.random() - 0.5) * j, z = a.z + (b.z - a.z) * t + (Math.random() - 0.5) * j;
    const n = 3;
    for (let k = 0; k < n; k++) {
      const u = k / n;
      ctx.particles.emit({ pos: { x: px + (x - px) * u, y: py + (y - py) * u, z: pz + (z - pz) * u }, count: 1, life: [0.12, 0.2], size: [0.16, 0.05], sprite: 'glow8', additive: true, color: k ? color : 0xffffff, sizeJitter: 0 });
    }
    px = x;
    py = y;
    pz = z;
  }
  ctx.particles.emit({ pos: b, count: 5, spread: 3, life: [0.1, 0.25], size: [0.1, 0.02], sprite: ['spark', 'star4'], additive: true, color: [0xffffff, color] });
}

/** a ground shockwave: dust ring, sand, a small crater mark */
export function shockwave(ctx: Ctx, at: P3, r: number, color = 0xe6cf9f) {
  ctx.fx.ring({ x: at.x, y: at.y + 0.15, z: at.z }, color, r * 1.2, 0.4);
  ctx.fx.sandBurst(at, Math.min(2, r * 0.35));
  ctx.particles.emit({ pos: { x: at.x, y: at.y + 0.2, z: at.z }, count: 18, spread: r * 1.6, up: 1.2, life: [0.4, 0.8], size: [0.5, 1.2], sprite: ['puff0', 'puff1'], color: [0xe9d3a4, 0xdcc08c], alpha: 0.5, drag: 2.5 });
  ctx.events.emit('groundMark', at.x, at.z, r * 0.6, 1);
}

// ===================================================================== equipment
interface GearCtx {
  ctx: Ctx;
  pl: Player;
  eq: Equipment;
  on(ev: string, fn: (...a: any[]) => void): void;
  tick(fn: (dt: number) => void): void;
  /** before an incoming hit lands: return a changed hit, or null to cancel it */
  guard(fn: (hit: Hit, from?: THREE.Vector3) => Hit | null): void;
  /** after an incoming hit landed */
  after(fn: (hit: Hit, from: THREE.Vector3 | undefined, dealt: number) => void): void;
  /** final damage filter (every source, incl. storm and status ticks) */
  filter(fn: (amount: number, source: string, tick: boolean) => number): void;
  /** toggled stat modifiers under a key (null removes) */
  mod(key: string, mods: M[] | null): void;
}

interface Active {
  id: GearId;
  offs: (() => void)[];
  ticks: ((dt: number) => void)[];
  guards: ((hit: Hit, from?: THREE.Vector3) => Hit | null)[];
  afters: ((hit: Hit, from: THREE.Vector3 | undefined, dealt: number) => void)[];
  filters: ((amount: number, source: string, tick: boolean) => number)[];
  modKeys: Set<string>;
}

const any = (e: EnemyLike) => e as any;
const statusApply = (e: EnemyLike, id: string, stacks: number, dur: number, power = 0, cap = 99) => any(e).status?.apply(id, stacks, dur, power, cap, any(e).def?.statusRes ?? {});

export class Equipment {
  slots: Record<GearSlot, GearId | null> = { head: null, body: null, hands: null, feet: null, tool: null, charm: null };
  /** (slot, new piece or null, previous piece or null) */
  onChange?: (slot: GearSlot, id: GearId | null, prev: GearId | null) => void;
  visuals: GearRig | null = null;
  /** run-scoped: the dead man's hand only pays out once */
  deadHandSpent = false;
  private active = new Map<GearSlot, Active>();
  private origTakeHit: Player['takeHit'];
  private origApply: Player['applyDamage'];
  private myTakeHit: Player['takeHit'];
  private myApply: Player['applyDamage'];
  private t = 0;

  constructor(private ctx: Ctx, private player: Player, o: { visuals?: boolean } = {}) {
    const pl = player as any;
    this.origTakeHit = pl.takeHit;
    this.origApply = pl.applyDamage;
    this.myTakeHit = (hit: Hit, from?: THREE.Vector3) => this.takeHit(hit, from);
    this.myApply = (a: number, s: string, tick: boolean) => this.applyDamage(a, s, tick);
    pl.takeHit = this.myTakeHit;
    pl.applyDamage = this.myApply;
    if (o.visuals !== false) this.visuals = new GearRig(player.rig, ctx.scene, player.rig.material);
  }

  has(id: GearId) {
    return this.slots[GEAR[id].slot] === id;
  }
  get(slot: GearSlot) {
    return this.slots[slot];
  }
  /** what equipping `id` would replace (null if the slot is free or it is already worn) */
  wouldReplace(id: GearId): GearId | null {
    const cur = this.slots[GEAR[id].slot];
    return cur && cur !== id ? cur : null;
  }
  list(): GearId[] {
    return GEAR_SLOTS.map((s) => this.slots[s]).filter((x): x is GearId => !!x);
  }

  /** wear a piece; returns the piece it replaced (if any) */
  equip(id: GearId): GearId | null {
    const def = GEAR[id];
    const slot = def.slot;
    const prev = this.slots[slot];
    if (prev === id) return null;
    if (prev) this.deactivate(slot);
    this.slots[slot] = id;
    this.activate(slot, id);
    this.visuals?.wear(slot, id);
    this.onChange?.(slot, id, prev);
    this.ctx.events.emit('gearChanged', slot, id, prev);
    return prev;
  }

  unequip(slot: GearSlot): GearId | null {
    const prev = this.slots[slot];
    if (!prev) return null;
    this.deactivate(slot);
    this.slots[slot] = null;
    this.visuals?.remove(slot);
    this.onChange?.(slot, null, prev);
    this.ctx.events.emit('gearChanged', slot, null, prev);
    return prev;
  }

  /** for carrying the loadout across sub-areas */
  snapshot(): GearId[] {
    return this.list();
  }
  restore(ids: GearId[]) {
    for (const id of ids) if (GEAR[id]) this.equip(id);
  }

  update(dt: number) {
    this.t += dt;
    for (const a of this.active.values()) for (const f of a.ticks) f(dt);
    const pl = this.player;
    this.visuals?.update(dt, { aiming: pl.aiming, speed: pl.speed, grapple: pl.board.grapple, from: pl.muzzleWorld });
  }

  dispose() {
    for (const s of GEAR_SLOTS) if (this.slots[s]) this.deactivate(s);
    const pl = this.player as any;
    if (pl.takeHit === this.myTakeHit) delete pl.takeHit;
    if (pl.applyDamage === this.myApply) delete pl.applyDamage;
    this.visuals?.dispose();
  }

  // ------------------------------------------------------------------ interception
  private takeHit(hit: Hit, from?: THREE.Vector3): number {
    const pl = this.player;
    let h: Hit | null = hit;
    if (pl.alive && pl.invuln <= 0)
      for (const a of this.active.values())
        for (const g of a.guards) {
          h = g(h, from);
          if (!h) return 0;
        }
    const dealt = this.origTakeHit.call(pl, h, from);
    if (dealt > 0) for (const a of this.active.values()) for (const f of a.afters) f(h, from, dealt);
    return dealt;
  }

  private applyDamage(amount: number, source: string, tick: boolean): number {
    let a = amount;
    for (const ac of this.active.values()) for (const f of ac.filters) a = f(a, source, tick);
    return this.origApply.call(this.player, Math.max(0, a), source, tick);
  }

  // ------------------------------------------------------------------ effects
  private deactivate(slot: GearSlot) {
    const a = this.active.get(slot);
    if (!a) return;
    for (const off of a.offs) off();
    this.player.stats.removeSource('gear:' + a.id);
    for (const k of a.modKeys) this.player.stats.removeSource(k);
    this.active.delete(slot);
  }

  private activate(slot: GearSlot, id: GearId) {
    const def = GEAR[id];
    const a: Active = { id, offs: [], ticks: [], guards: [], afters: [], filters: [], modKeys: new Set() };
    this.active.set(slot, a);
    const stats = this.player.stats;
    if (def.mods) stats.add(def.mods.map((m) => ({ ...m, source: 'gear:' + id })));
    const g: GearCtx = {
      ctx: this.ctx,
      pl: this.player,
      eq: this,
      on: (ev, fn) => a.offs.push(this.ctx.events.on(ev, fn)),
      tick: (fn) => a.ticks.push(fn),
      guard: (fn) => a.guards.push(fn),
      after: (fn) => a.afters.push(fn),
      filter: (fn) => a.filters.push(fn),
      mod: (key, mods) => {
        const src = 'gear:' + id + ':' + key;
        stats.removeSource(src);
        a.modKeys.add(src);
        if (mods) stats.add(mods.map((m) => ({ ...m, source: src })));
      },
    };
    FX[id]?.(g);
  }

}

/** the grapple's fire / arrive edges, shared by the hook pieces (polls the board's grapple) */
function grappleEdges(g: GearCtx, onFire: (target: EnemyLike | null) => void, onArrive?: (at: THREE.Vector3) => void) {
  let was = false;
  const last = new THREE.Vector3();
  g.tick(() => {
    const gr = g.pl.board.grapple;
    if (gr.active && !was) onFire(g.pl.grappleTarget);
    if (gr.active) last.set(gr.x, gr.y, gr.z);
    if (!gr.active && was && onArrive && g.pl.pos.distanceTo(last) < 4.6) onArrive(last.clone());
    was = gr.active;
  });
}

// ===================================================================== the effects
const fwdOf = (pl: Player) => _v.set(Math.sin(pl.cam.yaw), 0, Math.cos(pl.cam.yaw));
const chestOf = (pl: Player) => pl.center(new THREE.Vector3());

/** remember per-enemy cooldowns (board kicks, charges) */
function cooldowns() {
  const m = new Map<number, number>();
  return (id: number, now: number, cd: number) => {
    if ((m.get(id) ?? -1e9) > now) return false;
    m.set(id, now + cd);
    if (m.size > 200) for (const [k, v] of m) if (v < now) m.delete(k);
    return true;
  };
}

const FX: Partial<Record<GearId, (g: GearCtx) => void>> = {
  sunGoggles(g) {
    g.filter((a, src) => (src === 'storm' ? a * 0.25 : a));
    let on = false;
    g.tick(() => {
      if (g.pl.aiming === on) return;
      on = g.pl.aiming;
      g.mod('zoom', on ? [{ stat: 'critChance', type: 'flat', value: 0.15 }, { stat: 'spread', type: 'pct', value: -0.2 }] : null);
      if (on) g.ctx.sfx('lever_cycle', null, 0.18, 1.9);
    });
  },

  thothSpecs(g) {
    const ctx = g.ctx;
    let t = 0;
    const cf = new THREE.Vector3(), d = new THREE.Vector3();
    g.tick((dt) => {
      t -= dt;
      if (t > 0) return;
      t = 0.3;
      ctx.camera.getWorldDirection(cf);
      const cam = ctx.camera.position;
      const marks: EnemyLike[] = [];
      for (const e of ctx.enemies.list) {
        if (!e.alive) continue;
        d.set(e.pos.x - cam.x, e.pos.y + e.height * 0.85 - cam.y, e.pos.z - cam.z);
        const L = d.length();
        if (L > 36 || d.dot(cf) / L < 0.62) continue;
        marks.push(e);
        if (marks.length >= 8) break;
      }
      for (const e of marks) ctx.particles.emit({ pos: { x: e.pos.x, y: e.pos.y + e.height * 0.9, z: e.pos.z }, count: 1, life: [0.3, 0.3], size: [0.34, 0.12], sprite: 'star4', additive: true, color: 0xffd36b, alpha: 0.9, sizeJitter: 0 });
    });
    g.on('enemyHit', (e: EnemyLike, hit: Hit, amt: number) => {
      if (!hit?.headshot || hit.source !== 'gun' || hit.tags?.includes('thoth') || !e.alive) return;
      const p = { x: e.pos.x, y: e.pos.y + e.height * 0.9, z: e.pos.z };
      ctx.enemies.damage(e, { base: amt * 0.3, kind: 'true', source: 'divine', canCrit: false, tags: ['thoth'] });
      ctx.fx.glyphs(p, 0xffd36b, 3, 0.4);
    });
  },

  jackalMask(g) {
    const ctx = g.ctx;
    let howl = -9;
    g.on('enemyKilled', (e: EnemyLike) => {
      const pl = g.pl;
      if (Math.hypot(e.pos.x - pl.pos.x, e.pos.z - pl.pos.z) > 7) return;
      pl.heal(pl.maxHp * 0.03);
      const now = ctx.run.time;
      if (now - howl < 1.5) return;
      howl = now;
      ctx.sfx('jackal_howl', pl.pos, 0.55, 1.15);
      const c = chestOf(pl);
      ctx.particles.emit({ pos: c, count: 16, spread: 6, up: 0.6, life: [0.5, 0.9], size: [0.6, 1.6], sprite: ['puff0', 'puff1'], color: [0x3a3446, 0x5a4a6a], alpha: 0.45, drag: 3 });
      ctx.fx.ring({ x: pl.pos.x, y: pl.pos.y + 0.4, z: pl.pos.z }, 0xb565ff, 9, 0.5);
      ctx.enemies.inRadius(pl.pos, 8, (o) => {
        statusApply(o, 'slow', 2, 2.5);
        statusApply(o, 'curse', 3, 4, 0, 15);
      });
    });
  },

  respirator(g) {
    g.guard((hit) => (hit.status?.some((s) => s.id === 'poison') ? { ...hit, status: hit.status.filter((s) => s.id !== 'poison') } : hit));
    g.filter((a, src) => (src === 'poison' ? a * 0.3 : a));
    g.tick(() => {
      if (g.pl.status.has('poison')) g.pl.status.clear('poison');
    });
  },

  scarabPlate(g) {
    const ctx = g.ctx;
    let lastReflect = -9;
    g.guard((hit, from) => {
      if (!from || (hit.source !== 'projectile' && hit.source !== 'contact' && hit.source !== 'explosion')) return hit;
      const pl = g.pl;
      const f = fwdOf(pl);
      const dx = from.x - pl.pos.x, dz = from.z - pl.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05 || (dx * f.x + dz * f.z) / d < 0.57) return hit;
      const c = chestOf(pl);
      const at = { x: c.x + (dx / d) * 0.4, y: c.y, z: c.z + (dz / d) * 0.4 };
      ctx.fx.hit(at, { x: dx / d, y: 0.3, z: dz / d }, 'armor', 1.2);
      ctx.sfx('hit_armor', at, 0.8, 1.15);
      if (hit.source === 'projectile' && ctx.run.time - lastReflect > 0.12) {
        lastReflect = ctx.run.time;
        // send it back along the line it came in on
        let best: EnemyLike | null = null, bd = 0.82;
        for (const e of ctx.enemies.list) {
          if (!e.alive) continue;
          const ex = e.pos.x - pl.pos.x, ez = e.pos.z - pl.pos.z, el = Math.hypot(ex, ez);
          if (el > 45 || el < 0.5) continue;
          const dot = (ex * dx + ez * dz) / (el * d);
          if (dot > bd) (bd = dot), (best = e);
        }
        if (best) {
          const to = { x: best.pos.x, y: best.pos.y + best.height * 0.6, z: best.pos.z };
          ctx.fx.bulletTracer(at, to, 0x7fb0ff, true);
          ctx.sfx('ricochet', at, 0.7);
          ctx.enemies.damage(best, { base: 20 + hit.base * 1.2, kind: 'phys', source: 'gun', canCrit: true, tags: ['reflect'] });
        }
      }
      return { ...hit, base: hit.base * 0.4, knock: (hit.knock ?? 0) * 0.3 };
    });
  },

  mummyWrap(g) {
    let hurt = -99, calm = false;
    g.on('playerHurt', () => (hurt = g.ctx.run.time));
    g.tick(() => {
      const c = g.ctx.run.time - hurt > 4;
      if (c !== calm) {
        calm = c;
        g.mod('calm', c ? [{ stat: 'regen', type: 'flat', value: 4 }] : null);
      }
      if (calm && g.pl.hp < g.pl.maxHp && Math.random() < 0.04) g.ctx.particles.emit({ pos: chestOf(g.pl), count: 1, spread: 0.6, up: 0.6, life: [0.6, 1], size: [0.09, 0.05], sprite: 'linen', color: 0xffffff, drag: 2, jitter: 0.3 });
    });
  },

  bonePauldrons(g) {
    const ctx = g.ctx;
    g.guard((hit) => (hit.knock ? { ...hit, knock: 0 } : hit));
    const ready = cooldowns();
    g.tick(() => {
      const pl = g.pl;
      const sp = pl.speed;
      if (sp < 13 || !pl.alive) return;
      const v = pl.board.vel;
      ctx.enemies.inRadius(pl.pos, 1.8, (e) => {
        if (e.flying || !ready(e.id, ctx.run.time, 0.8)) return;
        const dir = new THREE.Vector3(v.x, 0, v.z).normalize();
        ctx.enemies.damage(e, { base: 12 + sp * 1.4, kind: 'phys', source: 'board', knock: 10, dirX: dir.x, dirZ: dir.z, status: [{ id: 'stun', stacks: 1, dur: 0.5 }], canCrit: true }, undefined, dir);
        ctx.sfx('hit_bone', e.pos, 0.9, 0.8);
        ctx.shake(0.25);
        ctx.fx.word(e.pos, 'w_pow', 0.8);
      });
    });
  },

  cactusJerkin(g) {
    const ctx = g.ctx;
    g.after((hit, from) => {
      if (!from || (hit.source !== 'contact' && hit.source !== 'thorns')) return;
      const e = ctx.enemies.nearest(from, 3);
      if (!e) return;
      ctx.enemies.damage(e, { base: 14, kind: 'phys', source: 'thorns', canCrit: false, status: [{ id: 'bleed', stacks: 2, dur: 3 }] });
      ctx.particles.emit({ pos: chestOf(g.pl), count: 10, spread: 5, life: [0.2, 0.4], size: [0.06, 0.03], sprite: 'streak', color: [0xf4f0e8, 0xd8e8b0], drag: 2, stretch: 0.02 });
    });
  },

  gunslingerGloves(g) {
    let on = false;
    g.tick(() => {
      if (g.pl.fanning === on) return;
      on = g.pl.fanning;
      g.mod('fan', on ? [{ stat: 'fireRate', type: 'pct', value: 0.25 }] : null);
    });
  },

  stingerGauntlet(g) {
    const ctx = g.ctx;
    g.on('enemyHit', (e: EnemyLike, hit: Hit) => {
      if ((hit.source !== 'melee' && hit.source !== 'counter') || !e.alive) return;
      const st = g.pl.stats;
      statusApply(e, 'poison', hit.source === 'counter' ? 12 : 5, 5, 2.4 * st.get('statusPower'), st.get('poisonStacks'));
      const p = { x: e.pos.x, y: e.pos.y + e.height * 0.6, z: e.pos.z };
      ctx.particles.emit({ pos: p, count: 8, spread: 2.5, up: 1.5, life: [0.3, 0.6], size: [0.08, 0.03], sprite: ['dot3', 'bubble'], color: [0xc8ff5a, 0x9dff3a], gravity: 8 });
      ctx.sfx('scorpion_sting', p, 0.5);
    });
  },

  brassKnuckles(g) {
    const ctx = g.ctx;
    g.on('counter', () => {
      const pl = g.pl;
      const p = pl.pos;
      shockwave(ctx, p, 4.5, 0xffd36b);
      ctx.sfx('punch', p, 1, 0.8);
      ctx.shake(0.45);
      ctx.enemies.inRadius(p, 4.5, (e) => {
        const dir = new THREE.Vector3(e.pos.x - p.x, 0, e.pos.z - p.z).normalize();
        ctx.enemies.damage(e, { base: 35, kind: 'phys', source: 'melee', knock: 12, dirX: dir.x, dirZ: dir.z, status: [{ id: 'stun', stacks: 1, dur: 0.6 }], tags: ['knuckle'] }, undefined, dir);
      });
    });
  },

  ironSpurs(g) {
    const ctx = g.ctx;
    const ready = cooldowns();
    g.tick(() => {
      const pl = g.pl;
      const sp = pl.speed;
      if (sp < 7 || !pl.alive) return;
      ctx.enemies.inRadius(pl.pos, 1.35, (e) => {
        if (e.flying || !ready(e.id, ctx.run.time, 0.7)) return;
        const v = pl.board.vel;
        const dir = new THREE.Vector3(v.x, 0, v.z).normalize();
        ctx.enemies.damage(e, { base: 8 + sp * 0.9, kind: 'phys', source: 'board', knock: 4, dirX: dir.x, dirZ: dir.z, status: [{ id: 'bleed', stacks: 2, dur: 3 }], canCrit: true }, undefined, dir);
        ctx.sfx('kick', e.pos, 0.7, 1.2);
        ctx.particles.emit({ pos: { x: e.pos.x, y: e.pos.y + 0.4, z: e.pos.z }, count: 6, spread: 3, life: [0.15, 0.3], size: [0.08, 0.02], sprite: ['spark', 'star4'], additive: true, color: [0xffffff, 0xffd8a0] });
      });
    });
    g.on('grappleKick', (e: EnemyLike) => statusApply(e, 'bleed', 4, 4, 1.5, 12));
  },

  rattlesnakeBoots(g) {
    const ctx = g.ctx;
    let air = 0;
    g.tick((dt) => {
      const pl = g.pl;
      if (!pl.board.grounded) {
        air += dt;
        return;
      }
      if (air > 0.7 && pl.alive) {
        const p = pl.pos;
        shockwave(ctx, p, 3.5, 0x9dff3a);
        ctx.particles.emit({ pos: { x: p.x, y: p.y + 0.2, z: p.z }, count: 20, spread: 6, up: 1.5, life: [0.3, 0.6], size: [0.08, 0.03], sprite: 'dot3', color: [0xc8ff5a, 0x9dff3a, 0x6ec02a], gravity: 10, ground: true });
        ctx.sfx('skeleton_rattle', p, 0.8, 1.6);
        ctx.sfx('poison_burst', p, 0.5);
        ctx.enemies.inRadius(p, 3.5, (e) => {
          ctx.enemies.damage(e, { base: 10 + Math.min(1.5, air) * 8, kind: 'magic', source: 'poison', canCrit: false, status: [{ id: 'poison', stacks: 4, dur: 4, power: 2.2 }, { id: 'slow', stacks: 1, dur: 1.5 }] });
        });
      }
      air = 0;
    });
  },

  barbedHook(g) {
    const ctx = g.ctx;
    grappleEdges(g, (e) => {
      if (!e || !e.alive) return;
      const pl = g.pl;
      if (e.isBoss || e.radius > 1.4) {
        statusApply(e, 'bleed', 4, 4, 2, 12);
        ctx.enemies.damage(e, { base: 25, kind: 'phys', source: 'grapple', canCrit: true });
        return;
      }
      pl.releaseGrapple();
      const from = pl.muzzleWorld.clone();
      const to = new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z);
      const dir = new THREE.Vector3(pl.pos.x - e.pos.x, 0, pl.pos.z - e.pos.z);
      const d = dir.length() || 1;
      dir.multiplyScalar(1 / d);
      // the rope snaps taut and reels the catch in
      for (let i = 0; i <= 10; i++) ctx.particles.emit({ pos: from.clone().lerp(to, i / 10), count: 1, life: [0.22, 0.22], size: [0.07, 0.05], sprite: 'dot3', color: 0xc8a46a, vel: { x: dir.x * 8, y: 0, z: dir.z * 8 }, sizeJitter: 0 });
      ctx.sfx('rope_reel', to, 0.9);
      ctx.enemies.damage(e, { base: 15, kind: 'phys', source: 'grapple', knock: Math.min(12, d * 0.5), canCrit: true, status: [{ id: 'stun', stacks: 1, dur: 1 }, { id: 'bleed', stacks: 3, dur: 4 }] }, to, dir);
      pl.grappleCd = Math.min(pl.grappleCd, 1);
      ctx.toast('YANKED!', '#c8a46a');
    });
  },

  twinClaw(g) {
    const ctx = g.ctx;
    let ready = true, t = 0;
    g.tick((dt) => {
      if (!ready && (t -= dt) <= 0) {
        ready = true;
        ctx.sfx('rev_close', g.pl.pos, 0.3, 1.5);
      }
    });
    grappleEdges(g, (e) => {
      const pl = g.pl;
      if (ready) {
        ready = false;
        t = 2.2 * (1 - pl.stats.get('cdr'));
        // the second claw is ready almost at once
        pl.grappleCd = Math.min(pl.grappleCd, 0.3);
      }
      if (e && e.alive) {
        ctx.enemies.damage(e, { base: 18, kind: 'phys', source: 'grapple', canCrit: true, status: [{ id: 'bleed', stacks: 3, dur: 4 }] });
        ctx.sfx('scorpion_sting', e.pos, 0.6, 0.8);
      }
    });
  },

  lightningReel(g) {
    const ctx = g.ctx;
    let lastBurst = -9;
    const burst = (at: THREE.Vector3) => {
      if (ctx.run.time - lastBurst < 0.6) return;
      lastBurst = ctx.run.time;
      ctx.sfx('thunder', at, 0.7, 1.3);
      ctx.fx.light({ x: at.x, y: at.y + 1, z: at.z }, 0x9fe0ff, 8, 0.35, 14);
      ctx.particles.emit({ pos: at, count: 1, life: [0.12, 0.12], size: [1.5, 4], sprite: 'glow16', additive: true, color: 0xcff4ff, sizeJitter: 0 });
      ctx.fx.ring(at, 0x9fe0ff, 6, 0.35);
      ctx.shake(0.35);
      let n = 0;
      ctx.enemies.inRadius(at, 4.5, (e) => {
        if (n++ < 8) zap(ctx, { x: at.x, y: at.y + 0.8, z: at.z }, { x: e.pos.x, y: e.pos.y + e.height * 0.6, z: e.pos.z });
        ctx.enemies.damage(e, { base: 30, kind: 'magic', source: 'divine', canCrit: true, status: [{ id: 'stun', stacks: 1, dur: 1.2 }] });
      });
    };
    g.tick((dt) => {
      const pl = g.pl;
      const gr = pl.board.grapple;
      if (!gr.active) return;
      const d = _v2.set(gr.x - pl.pos.x, gr.y - pl.pos.y - 1.2, gr.z - pl.pos.z);
      const L = d.length();
      if (L < 0.5) return;
      pl.board.vel.addScaledVector(d, (26 * dt) / L);
      if (Math.random() < dt * 30) ctx.particles.emit({ pos: pl.muzzleWorld.clone().lerp(_v.set(gr.x, gr.y, gr.z), Math.random()), count: 1, life: [0.08, 0.14], size: [0.12, 0.03], sprite: 'spark', additive: true, color: 0x9fe0ff });
    });
    grappleEdges(g, () => g.ctx.sfx('divine_power', g.pl.pos, 0.35, 1.6), (at) => burst(at));
    g.on('grappleKick', (e: EnemyLike) => burst(new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z)));
  },

  glassEye(g) {
    const ctx = g.ctx;
    let primed = false, lastAmmo = g.pl.ammo;
    g.tick(() => {
      const pl = g.pl;
      if (pl.ammo > lastAmmo && pl.ammo >= pl.maxAmmo && !primed) {
        primed = true;
        g.mod('lucky', [{ stat: 'critChance', type: 'flat', value: 1 }]);
        ctx.particles.emit({ pos: pl.muzzleWorld, count: 3, spread: 0.6, life: [0.3, 0.5], size: [0.16, 0.04], sprite: 'star4', additive: true, color: 0x6ad8c8 });
      }
      lastAmmo = pl.ammo;
    });
    // the crit is rolled inside the shot; the 'shot' event comes after it
    g.on('shot', () => {
      if (!primed) return;
      primed = false;
      g.mod('lucky', null);
    });
  },

  hourglass(g) {
    const ctx = g.ctx;
    let ready = 0;
    g.on('playerHurt', (a: number) => {
      const now = ctx.run.time;
      if (now < ready || a < 4 || !g.pl.alive) return;
      ready = now + 12;
      const pl = g.pl;
      pl.invuln = Math.max(pl.invuln, 0.9);
      ctx.engine.slowMo(0.3, 30);
      ctx.sfx('time_slow', pl.pos, 0.7);
      ctx.particles.emit({ pos: chestOf(pl), count: 26, spread: 2.5, up: 1, life: [0.8, 1.4], size: [0.06, 0.02], sprite: 'dot3', color: [0xf2c870, 0xffd880, 0xd8a850], drag: 2.5, jitter: 0.8 });
      ctx.fx.ring(chestOf(pl), 0xcfe2ff, 5, 0.6);
      ctx.engine.tweens.after(1.3, () => ctx.engine.slowMo(1, 5), true);
    });
  },

  deadMansHand(g) {
    const ctx = g.ctx;
    g.filter((a) => {
      const pl = g.pl;
      if (g.eq.deadHandSpent || !pl.alive || a < pl.hp + pl.shield) return a;
      g.eq.deadHandSpent = true;
      pl.invuln = Math.max(pl.invuln, 2.5);
      const p = pl.pos.clone();
      ctx.engine.tweens.after(0, () => {
        ctx.toast("DEAD MAN'S HAND", '#ff5a3a', 'Aces and eights. Not today.', true);
        ctx.events.emit('cutin', "DEAD MAN'S HAND", '#ff5a3a', 'angry');
        ctx.sfx('resurrect', p, 0.9);
        ctx.engine.flash(0xffffff, 0.5, 0.3);
        shockwave(ctx, p, 6, 0xff8a6a);
        ctx.events.emit('explosion', { x: p.x, y: p.y + 0.5, z: p.z }, 6, 60, 'player');
        ctx.fx.explosion({ x: p.x, y: p.y + 0.5, z: p.z }, 4);
      }, true);
      return Math.max(0, pl.hp - 1) + pl.shield;
    });
  },
};

/** the stat rows a gear swap changes (for the card's ledger side) */
export function gearPreview(stats: Player['stats'], id: GearId, replacing: GearId | null) {
  const add = GEAR[id].mods ?? [];
  const rem = replacing ? GEAR[replacing].mods ?? [] : [];
  const keys = [...new Set([...add, ...rem].map((m) => m.stat))] as StatId[];
  const after = stats.clone();
  if (replacing) {
    after.removeSource('gear:' + replacing);
    for (const k of [...after.mods]) if (k.source.startsWith('gear:' + replacing + ':')) after.removeSource(k.source);
  }
  after.add(add.map((m) => ({ ...m, source: 'preview:' + id })));
  return keys.map((k) => ({ stat: k, before: stats.get(k), after: after.get(k) }));
}
