// The hero switch. Sundown's revolver kit lives inside Player / Weapons / Skills /
// Ultimate; another hero installs a HeroKit on the player (RunOptions.hero) and the
// shared systems hand their hero-specific turns to it:
//  • Player.update: kit.preBoard before the board steps (glide, hover feel), kit.update
//    instead of the revolver / melee / grapple update, kit.post after the riding
//    animation (the hero's own pose layer, props, trails)
//  • Skills (E / C / G casts, empower, echo, cooldowns) -> HeroSpells
//  • Ultimate.trigger -> HeroUlt
//  • the HUD weapon readout -> kit.hud()
import type { BoardInput } from '../Board';
import type { PlayerAnim } from '../../anim/playerAnim';
import type { WeaponHud } from '../Weapons';
import type * as THREE from 'three';

export interface HeroKit {
  readonly id: string;
  /** before Board.step: adjust the board tuning / input (glide, launcher hold) */
  preBoard(dt: number, bi: BoardInput): void;
  /** the hero's weapon / melee update (replaces the revolver's) */
  update(dt: number): void;
  /** after the riding animation each frame: the hero's pose layer, held props, trails */
  post(dt: number, pa: PlayerAnim): void;
  /** the lower-HUD weapon readout */
  hud(): WeaponHud;
  dispose(): void;
}

export type SpellKey = 'E' | 'C' | 'G';
export interface HeroSpells {
  /** try to cast; false = not ready (no cast happened) */
  cast(k: SpellKey): boolean;
  empower(k: SpellKey, perfect: boolean, aim: THREE.Vector3): void;
  echo(k: SpellKey): void;
  update(dt: number): void;
  cooldowns(): { scorp: number; swarm: number; bomb: number; bombCharges: number };
}

export interface HeroUlt {
  name: string;
  run(): Promise<void>;
}
