// Shared run context passed to all gameplay systems (interfaces only to avoid cycles).
import type * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { World } from './world/World';
import type { Particles } from './fx/Particles';
import type { Fx } from './fx/Fx';
import type { AudioEngine } from '../engine/audio/AudioEngine';
import type { Hit } from './combat/Damage';

export interface EnemyLike {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  height: number;
  alive: boolean;
  isBoss: boolean;
  hp: number;
  maxHp: number;
  name: string;
  flying?: boolean;
}

export interface RayHit {
  enemy: EnemyLike | null;
  t: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  headshot: boolean;
  part: string;
  surface: 'enemy' | 'terrain' | 'prop' | 'none';
  prop?: any;
}

export interface EnemyApi {
  list: EnemyLike[];
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxT: number, skip?: Set<number>): RayHit | null;
  damage(e: EnemyLike, hit: Hit, point?: THREE.Vector3, dir?: THREE.Vector3): number;
  nearest(p: THREE.Vector3, maxD: number, filter?: (e: EnemyLike) => boolean): EnemyLike | null;
  inRadius(p: THREE.Vector3, r: number, fn: (e: EnemyLike, d: number) => void): void;
}

export interface RunState {
  wave: number;
  bounty: number; // xp
  rank: number;
  bountyToNext: number;
  gold: number;
  kills: number;
  totalBounty: number;
  totalGold: number;
  time: number;
  ultCharge: number;
  revived: boolean;
  combo: number;
  comboTimer: number;
  style: number;
}

export interface Ctx {
  engine: Engine;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: World;
  particles: Particles;
  fx: Fx;
  audio: AudioEngine;
  enemies: EnemyApi;
  run: RunState;
  /** play sound helper (id, position?) */
  sfx(id: string, pos?: { x: number; y: number; z: number } | null, vol?: number, pitch?: number): void;
  shake(amount: number): void;
  /** world-space floating title text (cinematic floating words) */
  say?(text: string, opts?: any): void;
  toast(text: string, color?: string, sub?: string, big?: boolean): void;
  events: EventBus;
}

type Handler = (...a: any[]) => void;
export class EventBus {
  private m = new Map<string, Handler[]>();
  on(ev: string, h: Handler) {
    let l = this.m.get(ev);
    if (!l) this.m.set(ev, (l = []));
    l.push(h);
    return () => this.off(ev, h);
  }
  off(ev: string, h: Handler) {
    const l = this.m.get(ev);
    if (l) this.m.set(ev, l.filter((x) => x !== h));
  }
  emit(ev: string, ...a: any[]) {
    const l = this.m.get(ev);
    if (l) for (const h of l.slice()) h(...a);
  }
  clear() {
    this.m.clear();
  }
}
