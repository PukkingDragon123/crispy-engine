// Installing Mark on a run (RunOptions.hero === 'mark'): his visuals for the Player
// (his rig, a twin baton where Sundown's revolver would be, the crescent glide board)
// and the kit + spells wired into the shared Player / Skills / Ultimate.
import type { PlayerVisuals } from '../Player';
import type { Ctx } from '../../Ctx';
import type { Player } from '../Player';
import type { Input } from '../../../engine/Input';
import type { Skills } from '../Skills';
import type { Ultimate } from '../Ultimate';
import type { Qte } from '../../ui/Qte';
import type { CameraRig } from '../CameraRig';
import { markRig, crescentBoardModel, markBatonRig } from '../../models/characters';
import { MarkKit } from './MarkKit';
import { MarkSpells, MARK_SPELLS } from './MarkSpells';

export function markVisuals(): PlayerVisuals {
  return { rig: markRig(), gun: markBatonRig(), board: crescentBoardModel() };
}

export interface MarkInstall {
  ctx: Ctx;
  player: Player;
  input: Input;
  skills: Skills;
  ult: Ultimate;
  qte: Qte;
  cam: CameraRig;
}

export function installMark(d: MarkInstall): MarkKit {
  const kit = new MarkKit({ ctx: d.ctx, player: d.player, input: d.input });
  const spells = new MarkSpells({ ctx: d.ctx, player: d.player, kit, qte: d.qte, cam: d.cam });
  kit.spells = spells;
  d.player.kit = kit;
  d.skills.hero = spells;
  d.skills.constants = { scorpCd: MARK_SPELLS.beam.cd, swarmCd: MARK_SPELLS.dash.cd, bombRecharge: MARK_SPELLS.rain.recharge };
  d.ult.hero = spells;
  return kit;
}
