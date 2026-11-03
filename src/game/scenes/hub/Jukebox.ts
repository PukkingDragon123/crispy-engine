// The gramophone, extended: a crate of 78s on the floor beside it. E opens the
// crate (the camera leans in); click a sleeve and the shellac flies onto the
// platter, the needle drops, the band changes tune, and Sundown dances to it,
// each record its own dance: a Texas two-step, a slow sway with an invisible
// partner, an air-guitar headbang, a heel-kicking jig, and for "Paint It Black"
// the old skeleton dance, jaw clacking. The toadlets bob along, Pinch wakes up
// for it, Mama nods, and little pixel notes float off the horn on the beat.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../../engine/voxel/Mesher';
import { sharedVoxelMaterial } from '../../../engine/render/VoxelMaterial';
import * as WS from '../../models/props/workshop';
import * as HX from '../../models/props/hideout';
import { legIK, LegPose } from '../../anim/playerAnim';
import { damp } from '../../../engine/math/rand';
import { BuildKit, HubHost, HubStation, hubStats, saveHubStats, safe, geoOf, meshOf, reach, joint, ease, clamp01 } from './HubKit';
import type { Mode, Pick, View } from './HouseExtras';

type Dance = 'twostep' | 'sway' | 'rock' | 'jig' | 'spooky';
interface Rec {
  name: string;
  mood: string;
  bpm: number;
  dance: Dance;
  label: [number, number];
}
const RECORDS: Rec[] = [
  { name: 'Dead Flowers', mood: 'hub', bpm: 96, dance: 'twostep', label: [0xb02a1a, 0xe8d8b0] },
  { name: 'Wild Horses', mood: 'menu', bpm: 66, dance: 'sway', label: [0x2a4a8a, 0xe8d8b0] },
  { name: 'The Long and Winding Road', mood: 'explore', bpm: 100, dance: 'twostep', label: [0x3a6a3a, 0xd8c078] },
  { name: 'Paradise City', mood: 'combat', bpm: 132, dance: 'rock', label: [0x1e1a18, 0xd8a840] },
  { name: 'Here Comes the Sun', mood: 'victory', bpm: 120, dance: 'jig', label: [0xe0a020, 0xf0e6c8] },
  { name: 'Paint It Black', mood: 'underworld', bpm: 104, dance: 'spooky', label: [0x141210, 0xe8e2d4] },
  { name: 'Welcome to the Jungle', mood: 'boss', bpm: 124, dance: 'rock', label: [0x7a1a2a, 0xd8a840] },
  { name: 'Gimme Shelter', mood: 'tension', bpm: 80, dance: 'sway', label: [0x5a3a6a, 0xe8d8b0] },
];

export class Jukebox implements Mode {
  id = 'records';
  done = false;
  private st: HubStation | null = null;
  private crate: THREE.Group | null = null;
  private sleeves: { obj: THREE.Mesh; rec: Rec }[] = [];
  private platter = new THREE.Vector3();
  private platterY = 0;
  private disc: THREE.Group | null = null;
  private discRec: Rec | null = null;
  private fly: { obj: THREE.Group; t: number; from: THREE.Vector3; to: THREE.Vector3; rec: Rec } | null = null;
  private beat = 0;
  private w = 0;
  private lp: LegPose = { x: 0, z: 0, knee: 0, roll: 0 };
  private noteBeat = 0;
  private cur: Rec = RECORDS[0];

  constructor(private h: HubHost) {}

  get playing() {
    return this.h.music;
  }

  build(k: BuildKit) {
    const gr = this.h.stations.find((s) => s.id === 'gramophone');
    const g = gr?.objs[0];
    // the platter, from the gramophone model's own numbers (record at voxel y 11, centred on x = z = 0)
    if (g) {
      const sm = safe(() => HX.gramophoneCraft());
      if (sm) {
        const b = sm.model.bounds();
        const vs = sm.voxelSize;
        g.updateMatrixWorld(true);
        this.platter.copy(g.localToWorld(new THREE.Vector3((0.5 - (b.minX + b.maxX + 1) / 2) * vs, (12.05 - b.minY) * vs, (0.5 - (b.minZ + b.maxZ + 1) / 2) * vs)));
        this.platterY = this.platter.y;
      }
    }
    // the record crate on the floor by the table's end
    const cs = safe(() => WS.recordCrate());
    this.crate = k.put(cs, 0.3, -1.05, 0.55, 0, 1, false);
    if (this.crate) {
      // a sleeve to click per record (the crate's sleeves stand along its X)
      const box = new THREE.BoxGeometry(0.03, 0.26, 0.26);
      const inv = new THREE.MeshBasicMaterial({ visible: false });
      this.crate.updateMatrixWorld(true);
      const cb = cs ? cs.model.bounds() : null;
      RECORDS.forEach((rec, i) => {
        const o = new THREE.Mesh(box, inv);
        const lx = cb ? (-11 + 2 + i * 2.2 + 0.5 - (cb.minX + cb.maxX + 1) / 2) / 64 : 0;
        o.position.copy(this.crate!.localToWorld(new THREE.Vector3(lx, 0.15, 0)));
        o.rotation.y = this.crate!.rotation.y;
        this.h.scene.add(o);
        this.sleeves.push({ obj: o, rec });
      });
    }
    const last = RECORDS.find((r) => r.name === hubStats().record);
    if (last) this.cur = last;
    this.putDisc(this.cur);
  }
  private discOf(rec: Rec) {
    const sm = WS.shellacRecord(rec.label[0], rec.label[1]);
    const g = buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot: 'center' });
    const grp = new THREE.Group();
    const m = meshOf(g, sharedVoxelMaterial, false);
    grp.add(m);
    grp.scale.setScalar(0.94);
    return grp;
  }
  private putDisc(rec: Rec) {
    this.disc?.removeFromParent();
    this.disc = this.discOf(rec);
    this.disc.position.copy(this.platter);
    this.h.scene.add(this.disc);
    this.discRec = rec;
  }

  // ======================================================================= the mode
  enter(): Mode | null {
    this.st = this.h.here;
    this.done = false;
    this.h.engine.audio.play('card_pick', { volume: 0.4, pitch: 0.7 });
    return this;
  }
  view(): View | null {
    const c = this.crate?.position ?? new THREE.Vector3(0.3, 0, -1.05);
    return { pos: new THREE.Vector3(c.x - 0.55, 1.15, c.z + 1.1), look: new THREE.Vector3((c.x + this.platter.x) / 2, 0.38, (c.z + this.platter.z) / 2), fov: 46 };
  }
  hint() {
    return this.fly ? '' : `Now playing: ${this.h.music ? this.cur.name : 'nothing'}   ·   click a sleeve to put it on, the record to lift the needle   ·   Esc: done`;
  }
  back() {
    if (this.fly) return false;
    this.done = true;
    return true;
  }
  picks(): Pick[] {
    if (this.fly) return [];
    const out: Pick[] = this.sleeves.map((s) => ({ obj: s.obj, lift: false, tip: () => `"${s.rec.name}"${this.h.music && this.cur === s.rec ? ' (playing)' : ''}`, click: () => this.choose(s.rec) }));
    if (this.disc) out.push({ obj: this.disc, lift: false, tip: () => (this.h.music ? 'Lift the needle' : `Drop the needle on "${this.cur.name}"`), click: () => this.toggle() });
    return out;
  }
  private toggle() {
    this.h.music = !this.h.music;
    (window as any).__music?.setMood(this.h.music ? this.cur.mood : 'off');
    this.h.engine.audio.play('ui_click', { volume: 0.6, pitch: this.h.music ? 1.2 : 0.7 });
  }
  private choose(rec: Rec) {
    const s = this.sleeves.find((q) => q.rec === rec);
    if (!s) return;
    const obj = this.discOf(rec);
    const from = s.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.12, 0));
    obj.position.copy(from);
    this.h.scene.add(obj);
    this.fly = { obj, t: 0, from, to: this.platter.clone(), rec };
    (window as any).__music?.setMood('off', 0.3);
    this.h.engine.audio.play('paper_flutter', { volume: 0.4, pitch: 1.2 });
  }

  // ======================================================================= per frame
  tick(t: number, rdt: number) {
    const f = this.fly;
    if (f) {
      f.t += rdt;
      const u = clamp01(f.t / 0.85), e = ease(u);
      f.obj.position.lerpVectors(f.from, f.to, e);
      f.obj.position.y += Math.sin(Math.PI * u) * 0.25;
      f.obj.rotation.set((1 - e) * Math.PI / 2, (1 - e) * 4, 0);
      if (this.disc) this.disc.position.y = this.platterY + Math.sin(Math.PI * clamp01(u * 1.4)) * 0.06;
      if (u >= 1) {
        this.disc?.removeFromParent();
        this.disc = f.obj;
        this.disc.rotation.set(0, 0, 0);
        this.disc.position.copy(this.platter);
        this.discRec = f.rec;
        this.cur = f.rec;
        this.fly = null;
        this.h.music = true;
        (window as any).__music?.setMood(f.rec.mood, 0.4);
        this.h.engine.audio.play('rev_hammer', { volume: 0.3, pitch: 1.6 }); // the needle drops
        const st = hubStats();
        st.record = f.rec.name;
        saveHubStats();
        this.h.active = null;
      }
    }
    // the record turns
    if (this.disc && this.h.music && !this.fly) this.disc.rotation.y -= rdt * 4.2;
    // the beat (the band's own tempo when it says)
    const bpm = ((window as any).__music?.cur?.bpm as number) || this.cur.bpm;
    if (this.h.music) this.beat += (rdt * bpm) / 60;
    // the room grooves: toadlets bob, Pinch wakes, Mama nods, notes off the horn
    const near = this.h.music ? 1 : 0;
    const bob = Math.abs(Math.sin(this.beat * Math.PI));
    for (const b of this.h.toadlets) if (b.floor && b.hopT < 0) b.rig.root.position.y = b.home.y + bob * 0.022 * near;
    if (this.h.pinch && this.h.here.id === 'gramophone' && this.w > 0.3) {
      this.h.pinch.root.rotation.z = Math.sin(this.beat * Math.PI) * 0.25 * this.w;
      this.h.pinch.setExpression('happy');
    } else if (this.h.pinch && this.h.pinch.root.rotation.z !== 0) {
      this.h.pinch.root.rotation.z = 0;
      this.h.pinch.setExpression('sleepy');
    }
    if (near && this.h.mama?.nodes['head']) this.h.mama.nodes['head'].rotateX(Math.sin(this.beat * Math.PI * 2) * 0.03);
    if (near && Math.floor(this.beat) !== this.noteBeat) {
      this.noteBeat = Math.floor(this.beat);
      if (this.noteBeat % 2 === 0) {
        const p = this.h.gramTop.clone().add(new THREE.Vector3(-0.08, 0.35, 0));
        this.h.particles.emit({ pos: p, count: 1, vel: { x: (Math.random() - 0.5) * 0.15, y: 0.28, z: 0.1 }, life: [1.6, 2.2], size: [0.07, 0.06], sprite: 'fx_note', color: [0xfff3d6, 0xffd890], drag: 0.4, fadeIn: 0.2 });
      }
    }
    void t;
  }
  update(_t: number, _rdt: number) {
    /* the mode is just the camera and the clicks */
  }

  /** Sundown's dance at the gramophone (whenever a record plays and he's there) */
  poseHero(t: number, rdt: number) {
    const hero = this.h.hero, spec = this.h.heroSpec;
    const on = this.h.music && this.h.here.id === 'gramophone' && !this.fly;
    this.w = damp(this.w, on ? Math.min(1, this.h.atK * 1.2) : 0, 3, rdt);
    const w = this.w;
    if (!hero || !spec || w < 0.01) return;
    const n = hero.nodes;
    const b = this.beat, P = Math.PI;
    const hipY = (spec.meta?.hipY as number) ?? 0.67, kneeY = (spec.meta?.kneeY as number) ?? 0.36;
    const d = this.cur.dance;
    // ---- feet (holder space) and the hips
    let fl = { x: 0.11, y: 0, z: 0.02 }, fr = { x: -0.11, y: 0, z: 0.02 };
    let rx = 0, ry = -0.02, rz = 0, yaw = 0;
    const s1 = Math.sin(P * b), s2 = Math.sin(P * b * 0.5);
    switch (d) {
      case 'twostep': {
        rx = s2 * 0.1;
        ry = -0.03 - Math.abs(s1) * 0.03;
        const lifting = Math.max(0, s1);
        if (s2 > 0) fl = { x: 0.11 + rx, y: lifting * 0.07, z: 0.03 };
        else fr = { x: -0.11 + rx, y: lifting * 0.07, z: 0.03 };
        fl.x += rx * 0.5;
        fr.x += rx * 0.5;
        break;
      }
      case 'sway':
        rx = s2 * 0.05;
        ry = -0.02 - Math.abs(s2) * 0.015;
        yaw = Math.sin(P * b * 0.125) * 0.5;
        fl.y = Math.max(0, s2) * 0.03;
        fr.y = Math.max(0, -s2) * 0.03;
        break;
      case 'rock':
        fl = { x: 0.2, y: 0, z: 0.05 };
        fr = { x: -0.2, y: 0, z: -0.04 };
        ry = -0.09 - Math.abs(s1) * 0.03;
        rz = -0.03;
        break;
      case 'jig': {
        ry = -0.03 + Math.abs(s1) * 0.07;
        const kickL = Math.max(0, s2), kickR = Math.max(0, -s2);
        fl = { x: 0.1, y: kickL * 0.14 + Math.abs(s1) * 0.05, z: 0.02 + kickL * 0.18 };
        fr = { x: -0.1, y: kickR * 0.14 + Math.abs(s1) * 0.05, z: 0.02 + kickR * 0.18 };
        break;
      }
      case 'spooky':
        rx = s1 * 0.06;
        ry = -0.05 - Math.abs(Math.sin(P * b * 2)) * 0.02;
        fl = { x: 0.13, y: Math.max(0, s1) * 0.05, z: 0.02 + s1 * 0.05 };
        fr = { x: -0.13, y: Math.max(0, -s1) * 0.05, z: 0.02 - s1 * 0.05 };
        break;
    }
    hero.root.position.x += rx * w;
    hero.root.position.y += ry * w;
    hero.root.position.z += rz * w;
    this.h.heroHolder.rotation.y += yaw * w;
    for (const [th, sh, f] of [['thigh_l', 'shin_l', fl], ['thigh_r', 'shin_r', fr]] as const) {
      const T = n[th], S = n[sh];
      if (!T || !S) continue;
      legIK(f.x - rx - T.position.x, f.y - (hipY + hero.root.position.y), f.z - hero.root.position.z, hipY - kneeY, kneeY, 0.6, this.lp);
      T.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lp.x, 0, this.lp.z)), w);
      S.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lp.knee, 0, this.lp.roll)), w);
    }
    // ---- the body, the head, the arms
    const H = this.h.heroHolder;
    const W = (x: number, y: number, z: number) => H.localToWorld(new THREE.Vector3(x, y, z));
    switch (d) {
      case 'twostep':
        joint(this.h, 'torso', 0.04, s2 * 0.15, -rx * 0.8, w);
        joint(this.h, 'head', Math.sin(P * b * 2) * 0.07, s2 * 0.2, s1 * 0.05, w);
        reach(this.h, 'l', W(0.165, 0.79, 0.09), new THREE.Vector3(1, -0.2, -0.4), w);
        reach(this.h, 'r', W(-0.165, 0.79, 0.09), new THREE.Vector3(-1, -0.2, -0.4), w);
        break;
      case 'sway':
        joint(this.h, 'torso', 0.03, 0, s2 * 0.08, w);
        joint(this.h, 'head', 0.06, s2 * 0.12, s2 * 0.1 + 0.1, w);
        // an invisible partner: one hand held out, the other at her back
        reach(this.h, 'r', W(-0.3, 1.32, 0.3), new THREE.Vector3(-1, -0.6, -0.1), w);
        reach(this.h, 'l', W(0.02, 1.2, 0.36), new THREE.Vector3(1, -0.4, 0), w);
        break;
      case 'rock': {
        const bang = Math.max(0, Math.sin(P * b * 2));
        joint(this.h, 'torso', -0.14 + bang * 0.12, 0.25, 0, w);
        joint(this.h, 'head', -0.15 + bang * 0.55, 0.1, 0, w);
        reach(this.h, 'l', W(0.36, 1.18, 0.24), new THREE.Vector3(1, -0.6, 0), w);
        const strum = Math.sin(P * b * 4);
        reach(this.h, 'r', W(-0.06 + strum * 0.03, 0.98 + strum * 0.09, 0.22), new THREE.Vector3(-1, 0.2, -0.3), w);
        break;
      }
      case 'jig':
        joint(this.h, 'torso', 0.02, s2 * 0.1, 0, w);
        joint(this.h, 'head', Math.sin(P * b * 2) * 0.08, 0, s2 * 0.1, w);
        joint(this.h, 'arm_l', -0.4 + s2 * 1.2, 0, 0.35, w);
        joint(this.h, 'fore_l', -0.9, 0, 0, w);
        joint(this.h, 'arm_r', -0.4 - s2 * 1.2, 0, -0.35, w);
        joint(this.h, 'fore_r', -0.9, 0, 0, w);
        break;
      case 'spooky': {
        // elbows out, forearms swinging together, side to side; the skull tilts and the jaw clacks
        const sw = Math.sin(P * b);
        joint(this.h, 'torso', 0.05, sw * 0.18, sw * 0.12, w);
        joint(this.h, 'head', 0.05, -sw * 0.25, -sw * 0.25, w);
        joint(this.h, 'arm_l', -0.3, 0.2, 1.05, w);
        joint(this.h, 'fore_l', -1.2 + sw * 0.5, 0, 0, w);
        joint(this.h, 'arm_r', -0.3, -0.2, -1.05, w);
        joint(this.h, 'fore_r', -1.2 + sw * 0.5, 0, 0, w);
        joint(this.h, 'jaw', Math.abs(Math.sin(P * b * 4)) * 0.3, 0, 0, w);
        break;
      }
    }
    void t;
  }

  dispose() {
    this.disc?.removeFromParent();
  }
}

export { geoOf };
