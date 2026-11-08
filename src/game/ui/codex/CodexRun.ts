// The Codex during a run: listens to the run's events (kills, alphas, bosses, gear,
// items), scans for first sightings (enemies in view range, the stretch of desert
// you are riding, the critters and folk of the side quests), and THOTH POPS IN to
// record it (fx/ThothPop.ts): the little ibis god appears beside the hunter on a
// ring of glyph cartouches in a burst of gold and jade, gasps, runs a lap around a
// floating miniature of the thing, scribbles it onto his scroll while its name
// types itself in the air, bounces with delight and pops back out. For a fresh boss
// or legend he stops time for a moment. The interact key hurries him along.
//
// RunScene: `this.codexRun = new CodexRun(this.ctx, this)` after wireEvents(),
// `this.codexRun?.update(rdt, hold)` every frame (hold: a cutscene owns the screen,
// Thoth hurries out and new discoveries wait), `this.codexRun?.dispose()` in exit().
import * as THREE from 'three';
import type { Ctx } from '../../Ctx';
import { Codex, Discovery } from '../../meta/Codex';
import { Puppet } from './Puppet';
import { ThothPop, type ThothShow } from '../../fx/ThothPop';

export class CodexRun {
  private offs: (() => void)[] = [];
  private queue: Discovery[] = [];
  private scanT = 0;
  private stingCd = 0;
  private pop: ThothPop;

  /** host: the RunScene (read duck-typed: player, camRig, opts.area, codexKills, colony, jerboa, frogs, scarabs, shop, trial, pausedByUser) */
  constructor(private ctx: Ctx, private host: any) {
    Codex.sync();
    this.pop = new ThothPop(ctx, host);
    this.offs.push(Codex.listen(ctx.events, () => host?.codexKills ?? {}));
    this.offs.push(Codex.onDiscover((d) => this.queue.push(d)));
    Codex.discover('legend', 'serket', 'sight');
  }

  private near(o: any, r: number) {
    const p = this.host?.player?.pos as THREE.Vector3 | undefined;
    const q = (o?.pos ?? o?.root?.position ?? o?.mama?.pos) as THREE.Vector3 | undefined;
    return !!p && !!q && Math.hypot(q.x - p.x, q.z - p.z) < r;
  }

  /** hold: a cutscene, staged encounter or rank-up owns the screen; Thoth hurries out and new discoveries wait */
  update(rdt: number, hold = false) {
    this.stingCd -= rdt;
    // ---- sightings, twice a second
    this.scanT -= rdt;
    if (this.scanT <= 0) {
      this.scanT = 0.5;
      const h = this.host;
      const p = h?.player?.pos as THREE.Vector3 | undefined;
      if (p) {
        for (const e of this.ctx.enemies.list as any[]) {
          if (!e.alive || Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > 30) continue;
          if (e.def?.id) Codex.discover('bounty', e.def.id, 'sight');
          else if (e.isBoss) {
            const id = Codex.bossId(e.name, e.title);
            if (id) Codex.discover('boss', id, 'sight');
          }
        }
        const z = this.ctx.world?.zone;
        const area = h?.opts?.area;
        if (z && area) Codex.discover('place', `${area}${z.index}`, 'sight');
        if (h.colony && this.near(h.colony, 40)) Codex.discover('wildlife', 'meerkat', 'sight');
        if (h.colony?.modal) Codex.discover('wildlife', 'beatles', 'sight');
        if (h.jerboa && this.near(h.jerboa, 35)) Codex.discover('wildlife', 'jerboa', 'sight');
        if (h.frogs && (h.frogs.revealed || this.near(h.frogs, 18))) Codex.discover('wildlife', 'rainFrog', 'sight');
        if (Array.isArray(h.scarabs) && h.scarabs.some((s: any) => this.near(s, 25))) Codex.discover('wildlife', 'dungScarab', 'sight');
        if (h.escort && this.near(h.escort, 30)) Codex.discover('wildlife', 'camel', 'sight');
        if (h.shop?.active) Codex.discover('legend', 'ozymandias', 'sight');
        if (h.trial) Codex.discover('legend', 'anubis', 'sight');
      }
    }
    // ---- Thoth
    const paused = !!this.host?.pausedByUser || this.ctx.engine.paused;
    if (this.pop.busy && (hold || (!paused && this.ctx.engine.input.hit('interact')))) this.pop.skip();
    if (!hold && !paused && !this.pop.busy && this.queue.length && this.pop.ready) this.show(this.merge());
    this.pop.update(rdt, paused);
  }

  /** several discoveries at once fold into one visit */
  private merge(): Discovery & { more: number } {
    const d = this.queue.shift()!;
    let pts = d.points, more = 0;
    while (this.queue.length && this.queue[0].entry === d.entry) pts += this.queue.shift()!.points;
    if (this.queue.length > 3) {
      for (const q of this.queue) pts += q.points;
      more = this.queue.length;
      this.queue = [];
    }
    return { ...d, points: pts, more };
  }

  private show(d: Discovery & { more: number }) {
    const e = d.entry;
    const tag = d.fresh ? 'NEW ENTRY' : d.level === 'master' ? 'MASTERED' : e.cat === 'boss' ? 'DEFEATED' : e.cat === 'bounty' ? 'FIRST KILL' : 'UPDATED';
    const section = `${Codex.sections().find((s) => s.cat === e.cat)?.name ?? ''}${d.more ? ` and ${d.more} more` : ''}`;
    // a fresh boss or legend is big enough for him to stop time over
    const big = d.fresh && (e.cat === 'boss' || e.cat === 'legend');
    // a miniature of the thing for him to run around (bosses are right there in the world; places have no body)
    const specimen = e.cat === 'boss' || e.cat === 'place' || e.cat === 'blueprint'
      ? null
      : () => (e.enemy ? Puppet.enemy(e.enemy, { castShadow: false }) : e.model && !e.model.startsWith('@') ? Puppet.fromKey(e.model, { castShadow: false }) : null);
    const show: ThothShow = { name: e.name, tag, section, points: d.points, big, fresh: d.fresh, cat: e.cat, specimen };
    if (!this.pop.play(show)) {
      this.queue.unshift(d);
      return;
    }
    if (d.fresh && !big && e.cat === 'place' && this.stingCd <= 0) {
      (window as any).__music?.stinger?.('discover');
      this.stingCd = 10;
    }
  }

  dispose() {
    for (const o of this.offs) o();
    this.offs = [];
    this.queue = [];
    this.pop.dispose();
  }
}
