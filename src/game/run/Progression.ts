// The slow reveal, inside a run (meta/Unlocks holds the plan and the saved state):
//  - CARDS: rank-up cards whose group is still locked are held out of the deck
//    (pre-banished on the run's UpgradeManager); a group that opens mid-ride is let back in
//  - PAYOUTS: Codex discoveries, bounty ranks and bosses are checked against the unlock
//    ladders as they happen (a toast now, the reveal card at the results / death);
//    every death that reaches the Duat adds to Anubis' tally (death()), and the end of a
//    ride counts too (runOver())
//  - SERKET'S LESSONS: each unlocked move, and the dodge ring, the tarot, the soul jar,
//    digging and gun swapping, get a short hands-on lesson (run/Tutorial lesson mode)
//    at the next calm wave break; the break holds while she teaches
//  - THE OBJECTIVE TRACKER (ui/QuestTracker): the quests in hand with their world
//    positions, the quest givers not visited yet, the tracked note on top
//
// RunScene hooks (exact snippets: see the PROGRESSION report)
//   field:     progression: Progression | null = null;
//   enter():   after `this.thothErrand = new ThothErrand(this.ctx, this);`
//                this.progression = new Progression(this.ctx, this);
//   update():  after `this.thothErrand?.update(rdt);`        this.progression?.update(dt, rdt);
//   updateHud: `quests: this.questList(),`  ->  `quests: this.progression?.quests(this.questList()) ?? this.questList(),`
//              and after `...this.questHud(),`               ...this.progression?.hudOverride(),
//   onPlayerDeath(): after `this.run.revived = true;`        this.progression?.death(final);
//   endRun():  after the `const res = { ... };` block         this.progression?.runOver(won);
//   exit():    this.progression?.dispose();
import type { Ctx } from '../Ctx';
import type { HudQuest } from '../ui/Hud';
import { Unlocks, CARD_GROUPS, type LessonId, type UnlockDef } from '../meta/Unlocks';
import { Codex } from '../meta/Codex';
import { loadSave } from '../meta/Save';
import { TECHNIQUES, isUnlocked } from '../player/Techniques';
import { Skills } from '../player/Skills';
import { Tutorial } from './Tutorial';
import { QuestTracker, type TrackGiver, type TrackQuest } from '../ui/QuestTracker';
import { UnlockReveal } from '../ui/UnlockReveal';

/** the toast heading for an unlock that lands mid-ride */
const HEAD: Record<string, string> = {
  item: 'NEW STOCK AT THE TURTLE SHOP', ware: 'RARE STOCK AT THE TURTLE SHOP', plan: 'PLANS AT THE TURTLE SHOP', trinket: 'TRINKET PLAN LEARNED',
  cards: 'NEW CARDS IN THE DECK', mission: 'A NEW JOB OPENS', system: 'UNLOCKED', cosmetic: 'A NEW LOOK',
};

export class Progression {
  private tracker: QuestTracker;
  private lesson: Tutorial | null = null;
  private lessonId: LessonId | null = null;
  private heldBreak = false;
  private scanT = 0;
  private evalT = -1;
  private offs: (() => void)[] = [];
  /** a revive: show what the death paid once he is back on his feet */
  private reviveReveal = -1;
  private tipped = false;

  /** host: the RunScene (read duck-typed, like ThothErrand) */
  constructor(private ctx: Ctx, private host: any) {
    Unlocks.beginRun();
    UnlockReveal.ensure(ctx.engine);
    // the deck: locked card groups stay out
    const ban = host.upgrades?.banished as Set<string> | undefined;
    if (ban) for (const id of Unlocks.lockedCards()) if (!host.upgrades.lv?.(id)) ban.add(id);
    // ...and the rarest card a rank-up may deal (the cards worker's UpgradeManager.tierCap hook)
    this.capCards();
    // payouts as they happen
    this.offs.push(Codex.onDiscover(() => (this.evalT = 0.8)));
    this.offs.push(ctx.events.on('rankUp', (r: number) => Unlocks.noteRank(r)));
    this.offs.push(ctx.events.on('bossDefeated', () => (this.evalT = 1.2)));
    this.offs.push(Unlocks.onUnlock((u) => this.announce(u)));
    this.tracker = new QuestTracker({
      engine: ctx.engine,
      hud: host.hud,
      camera: host.camera ?? ctx.camera,
      source: () => this.sources(),
      live: () => !host.gameOver && !host.trial && !host.dying && !host.introOn && !host.cavePit?.stage && !host.picker?.active && !host.choice?.active && !host.shop?.active,
    });
  }

  private capCards() {
    const up = this.host.upgrades;
    if (up && 'tierCap' in up) up.tierCap = Unlocks.cardCap();
  }

  /** an unlock landed mid-ride: say so (the reveal card comes at the results / the death) */
  private announce(u: UnlockDef) {
    if (u.kind === 'cards') {
      this.capCards();
      const ban = this.host.upgrades?.banished as Set<string> | undefined;
      for (const id of CARD_GROUPS[u.id.slice(6)] ?? []) ban?.delete(id);
    }
    if (this.host.dying || this.host.trial || this.host.gameOver) return;
    this.ctx.toast(HEAD[u.kind] ?? 'UNLOCKED', '#ffd36b', u.name, true);
    this.ctx.sfx('loot_reveal', null, 0.5);
  }

  // ---------------------------------------------------------------- RunScene hooks
  update(dt: number, rdt: number) {
    if (this.tracker.tracked && !this.tipped) {
      this.tipped = true;
      this.ctx.events.emit('tip', 'tracker');
    }
    if (this.evalT >= 0) {
      this.evalT -= rdt;
      if (this.evalT < 0) Unlocks.evaluate();
    }
    if (this.reviveReveal >= 0 && this.host.player?.alive && !this.host.dying && !this.host.trial) {
      this.reviveReveal -= rdt;
      if (this.reviveReveal < 0) UnlockReveal.flush();
    }
    this.lessons(dt, rdt);
  }

  /** the mission paper's notes, with the tracked one flagged (on top, live distance) */
  quests(list: HudQuest[]): HudQuest[] {
    return this.tracker.decorate(list);
  }

  /** the tracker draws the waypoint: the HUD's own plain marker steps aside */
  hudOverride(): { marker: null } {
    return { marker: null };
  }

  /** a death reached the Duat (every death does: the weighing or the final word) */
  death(final: boolean) {
    this.lesson?.skip();
    const got = Unlocks.death();
    if (!got.length) {
      // nothing paid this time: the card still shows the tally and what it is climbing toward
      const nx = Unlocks.next('tally');
      UnlockReveal.later({
        id: 'tally', kind: 'system', track: 'tally', at: Unlocks.tally(), name: 'The scales remember you',
        line: nx ? `${nx.at - Unlocks.tally()} more and: ${nx.name}` : 'Anubis has given you all he has',
      });
    }
    if (!final) {
      this.reviveReveal = 2.5;
      this.ctx.events.emit('tip', 'tally');
    }
  }

  /** the ride is over (the save has banked it): the rides track counts; the cards show on the next screen */
  runOver(won: boolean) {
    void won;
    this.lesson?.skip();
    Unlocks.evaluate();
  }

  // ---------------------------------------------------------------- Serket's lessons
  private due(): LessonId | null {
    const h = this.host;
    const seen = (id: LessonId) => Unlocks.lessonSeen(id);
    // moves first: the one just learned
    for (const t of TECHNIQUES) if (!t.base && isUnlocked(t.id) && !seen(t.id as LessonId)) return t.id as LessonId;
    const sk = Skills.current;
    if (!seen('tarot') && sk && sk.learned.size > 0) return 'tarot';
    if (!seen('guns') && (h.player?.weapons?.carried?.length ?? 1) >= 2) return 'guns';
    if (!seen('ult') && this.ctx.run.ultCharge >= 1) return 'ult';
    const next = h.director?.nextWave ?? 0;
    if (!seen('dodge') && next >= 3) return 'dodge';
    if (!seen('dig') && next >= 3 && loadSave().runs >= 1) return 'dig';
    return null;
  }

  private calm() {
    const h = this.host, d = h.director;
    if (!d?.inBreak || d.breakLeft < 12 || d.paused) return false;
    if (h.tutorial || h.gameOver || h.trial || h.dying || h.introOn || h.cavePit?.stage) return false;
    if (h.picker?.active || h.choice?.active || h.shop?.active || h.colony?.modal || h.jerboa?.modal || h.gearLoot?.active) return false;
    if (!h.player?.alive || !h.hud?.visible || this.ctx.engine.paused) return false;
    if ((h.bosses as { alive: boolean }[] | undefined)?.some((b) => b.alive)) return false;
    return true;
  }

  private lessons(dt: number, rdt: number) {
    const h = this.host;
    if (this.lesson) {
      // a boss, a death or a cutscene ends the lesson early
      if (h.gameOver || h.trial || h.dying || !h.player?.alive || (h.bosses as { alive: boolean }[] | undefined)?.some((b) => b.alive)) this.lesson.skip();
      this.lesson.update(dt);
      if (this.lesson.done) {
        this.lesson.dispose();
        this.lesson = null;
        this.lessonId = null;
        if (this.heldBreak && h.director) h.director.paused = false;
        this.heldBreak = false;
      }
      return;
    }
    this.scanT -= rdt;
    if (this.scanT > 0) return;
    this.scanT = 0.5;
    if (!this.calm()) return;
    const id = this.due();
    if (!id) return;
    this.lessonId = id;
    this.lesson = new Tutorial({ ctx: this.ctx, player: h.player, cam: h.camRig, lesson: id });
    // the break waits for her
    if (h.director && !h.director.paused) {
      h.director.paused = true;
      this.heldBreak = true;
    }
  }

  // ---------------------------------------------------------------- the tracker's view of the trail
  private sources(): { quests: TrackQuest[]; givers: TrackGiver[]; at: { x: number; z: number } } {
    const h = this.host;
    const quests: TrackQuest[] = [];
    const add = (src: any) => {
      const r = src?.hud?.();
      if (!r?.objective) return;
      const sub = String(r.objective.sub ?? '').split(' — ');
      quests.push({ id: r.objective.text, title: r.objective.text, text: sub[1] ?? sub[0] ?? '', pos: r.marker ?? null });
    };
    for (const q of [h.frogs, h.wagon, h.escort, h.missions]) add(q);
    const tq = h.thothErrand?.paperQuest?.();
    if (tq) quests.push({ id: tq.id, title: tq.title, text: tq.objective, pos: null });
    const p = h.player?.pos ?? { x: 0, z: 0 };
    // a revealed X: the nearest one is a quest of its own
    const xs = ((h.treasure?.waypoints?.() ?? []) as { x: number; y: number; z: number; kind: string }[]).filter((w) => w.kind === 'x');
    if (xs.length) {
      xs.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      quests.push({ id: 'treasure:x', title: 'Buried Treasure', text: 'Dig up the X', pos: xs[0] });
    }
    const givers: TrackGiver[] = [];
    for (const g of (h.missions?.givers?.() ?? []) as { pos: TrackGiver['pos']; name: string; open: boolean }[]) givers.push(g);
    const w = h.wagon;
    if (w && !w.revealed && !w.fixed && w.pete?.pos) givers.push({ pos: { x: w.pete.pos.x, y: w.pete.pos.y + 2.6, z: w.pete.pos.z }, name: w.name ?? 'A stranded wagon', open: true });
    const e = h.escort;
    if (e && e.phase === 'waiting' && e.npc?.pos) givers.push({ pos: { x: e.npc.pos.x, y: e.npc.pos.y + 3, z: e.npc.pos.z }, name: e.name ?? 'A traveler', open: true });
    const f = h.frogs;
    if (f && !f.revealed && !f.done && f.mama?.pos) givers.push({ pos: { x: f.mama.pos.x, y: f.mama.pos.y + 1.8, z: f.mama.pos.z }, name: 'Mama Rain Frog', open: true });
    return { quests, givers, at: { x: p.x, z: p.z } };
  }

  dispose() {
    for (const o of this.offs) o();
    this.offs = [];
    if (this.lesson) {
      this.lesson.dispose();
      this.lesson = null;
    }
    if (this.heldBreak && this.host.director) this.host.director.paused = false;
    this.heldBreak = false;
    this.tracker.dispose();
  }
}
