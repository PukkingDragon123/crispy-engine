// Thoth's errand on the trail. The little god hands out one errand at a time in his
// Hall ("find me a sand hippo calf!"); during a ride this keeps an eye on it:
//  - it shows as a mission note (paperQuest(), pushed into RunScene.questList()),
//  - it spots the sand hippo herds and their calves for the Codex (the Hall has jars
//    for them), and notices when a calf is picked up,
//  - when the errand is met it says so once ("go and tell Thoth!").
// The satchel of consumables Thoth packed (research gifts, errand rewards) is handed
// over at the start of the ride with ThothErrand.unpack().
//
// RunScene hooks (exact snippets: see the lead's notes in the HALL report):
//   field:   thothErrand: ThothErrand | null = null;
//   enter(): after `this.codexRun = new CodexRun(...)`:
//              this.thothErrand = new ThothErrand(this.ctx, this);
//              ThothErrand.unpack((id) => this.items.add(id), (s) => this.hud.toast(s, '#7cf2b4', "From Thoth's satchel"));
//   update(): next to `this.codexRun?.update(...)`:   this.thothErrand?.update(rdt);
//   questList(): before `return out;`:                const tq = this.thothErrand?.paperQuest(); if (tq) out.push(tq);
//   exit():  this.thothErrand?.dispose();
import type { Ctx } from '../Ctx';
import { Codex } from '../meta/Codex';
import { Research } from '../meta/Research';
import { ITEMS, ItemId } from '../player/Items';
import type { PaperQuest } from '../ui/MissionPaper';

export class ThothErrand {
  private scanT = 0;
  private wasMet = false;

  /** host: the RunScene (read duck-typed: player.pos, wildlife.herds / wildlife.carry, codexKills) */
  constructor(private ctx: Ctx, private host: any) {
    const e = Research.errand();
    this.wasMet = !!e && (e.met || Research.errandMet(e, this.runKills()));
  }

  /** pack Thoth's satchel into the pockets (call once the inventory exists) */
  static unpack(give: (id: ItemId) => boolean, say?: (text: string) => void) {
    const got = Research.takeSatchel(give);
    if (!got.length || !say) return got;
    const counts = new Map<ItemId, number>();
    for (const id of got) counts.set(id, (counts.get(id) ?? 0) + 1);
    say([...counts].map(([id, n]) => `${ITEMS[id]?.name ?? id}${n > 1 ? ' x' + n : ''}`).join(', ').toUpperCase());
    return got;
  }

  private runKills(): Record<string, number> {
    return (this.host?.codexKills ?? {}) as Record<string, number>;
  }

  update(dt: number) {
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.5;
    this.scanHippos();
    const e = Research.errand();
    if (!e || this.wasMet) return;
    if (Research.errandMet(e, this.runKills())) {
      this.wasMet = true;
      Research.markMet();
      this.ctx.toast("THOTH'S ERRAND DONE", '#7cf2b4', 'Go and tell Thoth in his Hall!');
      this.ctx.audio?.play?.('sting_positive', { volume: 0.6 });
    }
  }

  /** the sand hippo herds and their calves (Wildlife keeps them; read duck-typed) */
  private scanHippos() {
    const wl = this.host?.wildlife;
    const p = this.host?.player?.pos;
    if (!wl || !p) return;
    const herds = wl.herds as { members: { pos: { x: number; z: number }; baby: boolean }[] }[] | undefined;
    if (Array.isArray(herds))
      for (const h of herds)
        for (const m of h.members ?? []) {
          const d = Math.hypot(m.pos.x - p.x, m.pos.z - p.z);
          if (!m.baby && d < 38) Codex.discover('wildlife', 'sandHippo', 'sight');
          if (m.baby && d < 26) Codex.discover('wildlife', 'hippoCalf', 'sight');
        }
    if (wl.carry?.baby && !this.carried) {
      this.carried = true;
      Codex.discover('wildlife', 'hippoCalf', 'kill');
    } else if (!wl.carry) this.carried = false;
  }
  private carried = false;

  /** the mission note for the HUD's nail (null: no errand) */
  paperQuest(): PaperQuest | null {
    const e = Research.errand();
    if (!e) return null;
    const pr = Research.errandProgress(e, this.runKills());
    const met = pr.cur >= pr.need;
    return {
      id: 'thoth:' + e.id,
      title: "Thoth's Errand",
      objective: met ? 'Done! Go and tell Thoth' : e.objective,
      progress: pr.need > 1 ? `${Math.max(0, pr.cur)}/${pr.need}` : undefined,
      reward: `Reward: ${Research.rewardText(e)}`,
    };
  }

  dispose() {
    /* nothing held */
  }
}
