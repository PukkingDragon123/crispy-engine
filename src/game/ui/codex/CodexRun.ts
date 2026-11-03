// The Codex during a run: listens to the run's events (kills, alphas, bosses, gear,
// items), scans for first sightings (enemies in view range, the stretch of desert
// you are riding, the critters and folk of the side quests), and slips a "NEW CODEX
// ENTRY +N" card in from the right edge: a little parchment slip with the thing's
// portrait photographed from its own 3D model (IconFactory), its name and the points.
//
// RunScene: `this.codexRun = new CodexRun(this.ctx, this)` after wireEvents(),
// `this.codexRun?.update(rdt)` every frame, `this.codexRun?.dispose()` in exit().
import * as THREE from 'three';
import type { Ctx } from '../../Ctx';
import { Codex, Discovery } from '../../meta/Codex';
import { IconFactory } from '../IconFactory';
import { Puppet } from './Puppet';

const CARD_CSS = "position:absolute;right:-380px;top:34vh;z-index:7;pointer-events:none;display:flex;align-items:center;gap:12px;padding:10px 18px 10px 12px;min-width:250px;background:#e8d4a4;border:4px solid #5a3418;border-right:none;box-shadow:0 6px 0 #2a1408,inset 0 0 18px rgba(120,70,20,.35);font-family:'Alagard';color:#2a1a10;transition:right .55s cubic-bezier(.2,.8,.2,1),opacity .4s";

export class CodexRun {
  private offs: (() => void)[] = [];
  private queue: Discovery[] = [];
  private card: HTMLDivElement | null = null;
  private showT = -1;
  private scanT = 0;
  private icons: IconFactory | null = null;
  private stingCd = 0;

  /** host: the RunScene (read duck-typed: player, opts.area, codexKills, colony, jerboa, frogs, scarabs, shop, trial) */
  constructor(private ctx: Ctx, private host: any) {
    Codex.sync();
    this.offs.push(Codex.listen(ctx.events, () => host?.codexKills ?? {}));
    this.offs.push(Codex.onDiscover((d) => this.queue.push(d)));
    Codex.discover('legend', 'serket', 'sight');
  }

  private near(o: any, r: number) {
    const p = this.host?.player?.pos as THREE.Vector3 | undefined;
    const q = (o?.pos ?? o?.root?.position ?? o?.mama?.pos) as THREE.Vector3 | undefined;
    return !!p && !!q && Math.hypot(q.x - p.x, q.z - p.z) < r;
  }

  update(rdt: number) {
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
    // ---- the card
    if (this.showT >= 0) {
      this.showT += rdt;
      if (this.showT > 3.4 && this.card) {
        this.card.style.right = '-380px';
        this.card.style.opacity = '0';
      }
      if (this.showT > 4.0) {
        this.card?.remove();
        this.card = null;
        this.showT = -1;
      }
    }
    if (this.showT < 0 && this.queue.length) this.show(this.merge());
  }

  /** several discoveries at once fold into one card */
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

  private portrait(d: Discovery): HTMLCanvasElement | null {
    const e = d.entry;
    if (e.cat === 'place' || e.cat === 'blueprint') return null;
    let p: Puppet | null = null;
    try {
      p = e.enemy ? Puppet.enemy(e.enemy, { castShadow: false }) : e.model && !e.model.startsWith('@') ? Puppet.fromKey(e.model, { castShadow: false }) : null;
      if (!p) return null;
      p.update(0.016);
      this.icons ??= new IconFactory(this.ctx.engine.renderer);
      return this.icons.capture(p.root, { w: 44, h: 44, ss: 3, yaw: 0.5, pitch: 0.1, fill: 0.86, light: 'sunset', ink: '#2a160a', rim: '#ffe2a8', levels: 10 });
    } catch (err) {
      console.warn('[codex] portrait', e.key, err);
      return null;
    } finally {
      p?.dispose();
    }
  }

  private show(d: Discovery & { more: number }) {
    const eng = this.ctx.engine;
    const e = d.entry;
    const card = document.createElement('div');
    card.style.cssText = CARD_CSS;
    const img = this.portrait(d);
    if (img) {
      img.style.cssText = 'width:66px;height:66px;image-rendering:pixelated;flex:none;border:3px solid #2a1408;background:#3a2414;box-shadow:0 3px 0 #2a1408';
      card.appendChild(img);
    }
    const what = d.fresh ? 'NEW CODEX ENTRY' : d.level === 'master' ? 'CODEX · MASTERED' : e.cat === 'boss' ? 'CODEX · DEFEATED' : e.cat === 'bounty' ? 'CODEX · FIRST KILL' : 'CODEX · UPDATED';
    const txt = document.createElement('div');
    txt.innerHTML = `<div style="font-size:13px;color:#8e2616;letter-spacing:1px">${what}</div><div style="font-size:21px;line-height:1.1">${e.name}</div><div style="font-size:12px;opacity:.7">${Codex.sections().find((s) => s.cat === e.cat)?.name ?? ''}${d.more ? ` · and ${d.more} more` : ''}</div>`;
    const pts = document.createElement('div');
    pts.style.cssText = "font-size:30px;color:#b8861a;text-shadow:0 2px 0 #5a3418;margin-left:auto;padding-left:10px";
    pts.textContent = `+${d.points}`;
    card.append(txt, pts);
    eng.overlay.appendChild(card);
    this.card = card;
    this.showT = 0;
    requestAnimationFrame(() => (card.style.right = '0px'));
    eng.audio.play('page_turn', { volume: 0.5, pitch: 1.1 });
    eng.audio.play('gem_chime', { volume: 0.35, pitch: d.fresh ? 1 : 1.25 });
    if (d.fresh && this.stingCd <= 0 && (e.cat === 'boss' || e.cat === 'legend' || e.cat === 'place')) {
      (window as any).__music?.stinger?.('discover');
      this.stingCd = 10;
    }
  }

  dispose() {
    for (const o of this.offs) o();
    this.offs = [];
    this.card?.remove();
    this.card = null;
    this.icons?.dispose();
  }
}
