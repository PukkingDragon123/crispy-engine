// The Codex during a run: listens to the run's events (kills, alphas, bosses, gear,
// items), scans for first sightings (enemies in view range, the stretch of desert
// you are riding, the critters and folk of the side quests), and THOTH RECORDS it:
// a gold-roped cartouche on night lapis slides in from the right edge, the ibis-headed
// god of knowledge writes the entry with his reed pen (his arm moving, gold ink sparks
// at the nib, a line of hieroglyphs appearing one by one), with the thing's name, its
// section, its portrait (photographed from its own 3D model, printed into a gold niche)
// and the points it is worth. All stylized pixel art on its own canvas on the HUD's
// pixel grid (authored sprites: HudArt.ts).
//
// RunScene: `this.codexRun = new CodexRun(this.ctx, this)` after wireEvents(),
// `this.codexRun?.update(rdt, hold)` every frame (hold: a cutscene owns the screen, the
// card ducks out and new ones wait), `this.codexRun?.dispose()` in exit().
import * as THREE from 'three';
import type { Ctx } from '../../Ctx';
import { Codex, Discovery } from '../../meta/Codex';
import { IconFactory } from '../IconFactory';
import { Puppet } from './Puppet';
import { sprite, strip3, drawSprite, type PixelSprite } from '../PixelUI';
import { HUD_ART as ART } from '../HudArt';
import { pixelText, pixelTextWidth, variant, palNearest } from '../HudSprites';

const GLYPHS = ['ibis', 'eye', 'ankh', 'feather', 'scarab', 'reed', 'water', 'sun', 'djed'];
/** where the reed pen's nib is in each arm pose (arm sprite px) */
const NIB: [number, number][] = [[9, 0], [10, 1], [10, 5]];

interface Card {
  what: string;
  name: string;
  section: string;
  points: number;
  portrait: HTMLCanvasElement | null;
  glyphs: string[];
  w: number;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  c: string;
}

export class CodexRun {
  private offs: (() => void)[] = [];
  private queue: Discovery[] = [];
  private card: Card | null = null;
  private showT = -1;
  private cv: HTMLCanvasElement | null = null;
  private sparks: Spark[] = [];
  private lastGlyph = -1;
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

  /** hold: a cutscene, staged encounter or rank-up owns the screen; the card ducks out and new ones wait */
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
    // ---- the card
    if (hold && this.showT >= 0 && this.showT < 3.4) this.showT = 3.4;
    if (this.showT >= 0) {
      this.showT += rdt;
      if (this.showT > 4.0) {
        this.card = null;
        this.showT = -1;
      }
    }
    if (!hold && this.showT < 0 && this.queue.length) this.show(this.merge());
    this.draw(rdt);
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
      const cv = this.icons.capture(p.root, { w: 24, h: 24, ss: 4, yaw: 0.5, pitch: 0.1, fill: 0.9, light: 'sunset', ink: '#0c0806', rim: '#ffe2a8', levels: 32 });
      // printed onto the HUD's palette, like everything else on the card
      const g = cv.getContext('2d', { willReadFrequently: true })!;
      const img = g.getImageData(0, 0, cv.width, cv.height);
      for (let i = 0; i < img.data.length; i += 4) {
        if (!img.data[i + 3]) continue;
        const q = palNearest(img.data[i], img.data[i + 1], img.data[i + 2]);
        img.data[i] = q[0];
        img.data[i + 1] = q[1];
        img.data[i + 2] = q[2];
      }
      g.putImageData(img, 0, 0);
      return cv;
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
    const what = d.fresh ? 'NEW ENTRY' : d.level === 'master' ? 'MASTERED' : e.cat === 'boss' ? 'DEFEATED' : e.cat === 'bounty' ? 'FIRST KILL' : 'UPDATED';
    const section = `${Codex.sections().find((s) => s.cat === e.cat)?.name ?? ''}${d.more ? ` and ${d.more} more` : ''}`;
    const glyphs: string[] = [];
    let seed = 0;
    for (const ch of e.name) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
    for (let i = 0; i < 7; i++) glyphs.push(GLYPHS[(seed + i * 5) % GLYPHS.length]);
    const portrait = this.portrait(d);
    const textW = Math.max(pixelTextWidth('THOTH RECORDS', 16) + 8 + pixelTextWidth(what, 16), pixelTextWidth(e.name, 16), glyphs.length * 9 + 6 + pixelTextWidth(section, 16));
    this.card = { what, name: e.name, section, points: d.points, portrait, glyphs, w: Math.round(48 + textW + 10 + (portrait ? 36 : 0) + pixelTextWidth(`+${d.points}`, 32) + 22) };
    this.showT = 0;
    this.lastGlyph = -1;
    eng.audio.play('page_turn', { volume: 0.5, pitch: 1.1 });
    eng.audio.play('gem_chime', { volume: 0.35, pitch: d.fresh ? 1 : 1.25 });
    if (d.fresh && this.stingCd <= 0 && (e.cat === 'boss' || e.cat === 'legend' || e.cat === 'place')) {
      (window as any).__music?.stinger?.('discover');
      this.stingCd = 10;
    }
  }

  /** the HUD's pixel scale (the card shares its grid) */
  private scale() {
    return this.host?.hud?.scale ?? (window.innerWidth > 1800 ? 3 : 2);
  }

  private draw(rdt: number) {
    const card = this.card;
    if (!card && !this.sparks.length) {
      if (this.cv) this.cv.style.display = 'none';
      return;
    }
    const s = this.scale();
    if (!this.cv) {
      this.cv = document.createElement('canvas');
      this.cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:7;pointer-events:none;image-rendering:pixelated';
      this.ctx.engine.overlay.appendChild(this.cv);
    }
    const W = Math.ceil(window.innerWidth / s), H = Math.ceil(window.innerHeight / s);
    if (this.cv.width !== W || this.cv.height !== H) {
      this.cv.width = W;
      this.cv.height = H;
    }
    this.cv.style.display = '';
    const c = this.cv.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, W, H);
    if (!card) return;
    const t = this.showT;
    // slides in from the right edge with a little overshoot; slips back out at the end
    const inK = Math.min(1, t / 0.45), outK = t > 3.4 ? Math.min(1, (t - 3.4) / 0.5) : 0;
    const ease = 1 + 2.2 * Math.pow(inK - 1, 3) + 1.2 * Math.pow(inK - 1, 2);
    const cw = card.w, ch = ART.cart_m.h;
    const x0 = Math.round(W - 4 - cw * ease + (cw + 12) * outK * outK), y0 = Math.round(H * 0.34 - ch / 2 + Math.sin(t * 2.1) * 0.6);
    // the cartouche and its shadow
    const cart = strip3(ART.cart_l, ART.cart_m, ART.cart_r, cw, 'cartouche');
    c.globalAlpha = 0.34;
    c.drawImage(variant(cart, 'shadow'), x0 + 3, y0 + 4);
    c.globalAlpha = 1;
    c.drawImage(cart, x0, y0);
    // Thoth writing: the arm works while the glyphs appear, then rests the pen
    const writing = t > 0.25 && t < 1.85;
    const pose = writing ? [0, 1, 2, 1][Math.floor(t * 9) % 4] : 0;
    const tx = x0 + 9, ty = y0 + 10;
    c.drawImage(sprite(ART.thoth), tx, ty);
    const arm = ART['thoth_arm' + pose];
    c.drawImage(sprite(arm), tx + 14, ty + 18);
    const nib = NIB[pose];
    if (writing && Math.random() < rdt * 30) this.sparks.push({ x: tx + 14 + nib[0], y: ty + 18 + nib[1], vx: (Math.random() - 0.3) * 30, vy: -10 - Math.random() * 25, t: 0, life: 0.3 + Math.random() * 0.4, c: Math.random() < 0.5 ? '#fff0a6' : '#e2b24a' });
    // the writing: what, the name, the section; the hieroglyphs appear one by one in gold ink
    const lx = x0 + 46;
    const hw = pixelText(c, 'THOTH RECORDS', lx, y0 + 5, { size: 16, color: '#e2b24a', outline: '#0c1028' });
    pixelText(c, card.what, lx + hw + 8, y0 + 5, { size: 16, color: '#7cf2b4', outline: '#0c1028' });
    pixelText(c, card.name, lx, y0 + 19, { size: 16, color: '#fff4d8', outline: '#0c1028' });
    const shown = Math.max(0, Math.min(card.glyphs.length, Math.floor((t - 0.3) / 0.18)));
    for (let i = 0; i < shown; i++) {
      const g = sprite(ART['glyph_' + card.glyphs[i]]);
      const fresh = i === shown - 1 && writing;
      c.drawImage(fresh ? sprite(ART['glyph_' + card.glyphs[i]], { i: '#fff0a6' }, 'hot') : g, lx + i * 9, y0 + 38);
    }
    if (shown - 1 > this.lastGlyph) {
      this.lastGlyph = shown - 1;
      for (let k = 0; k < 5; k++) this.sparks.push({ x: lx + (shown - 1) * 9 + 3, y: y0 + 42, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 30, t: 0, life: 0.35 + Math.random() * 0.3, c: '#fff0a6' });
    }
    if (card.section) pixelText(c, card.section, lx + card.glyphs.length * 9 + 6, y0 + 36, { size: 16, color: '#8ab0e8', outline: '#0c1028' });
    // the portrait in a gold niche, and the points
    let rx = x0 + cw - 16 - pixelTextWidth(`+${card.points}`, 32);
    if (card.portrait) {
      const px0 = rx - 38, py0 = y0 + 13;
      c.drawImage(sprite(ART.niche), px0 - 2, py0 - 2);
      c.drawImage(card.portrait, px0 + 1, py0 + 1);
    }
    const pop = t < 0.6 ? 0 : Math.max(0, 1 - (t - 0.6) * 4);
    pixelText(c, `+${card.points}`, rx + 4, y0 + 12 - Math.round(pop * 3), { size: 32, color: pop > 0.5 ? '#fff0a6' : '#e2b24a', outline: '#0c1028' });
    // gold ink sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.t += rdt;
      if (p.t > p.life) {
        this.sparks.splice(i, 1);
        continue;
      }
      p.vy += 60 * rdt;
      p.x += p.vx * rdt;
      p.y += p.vy * rdt;
      c.globalAlpha = 1 - p.t / p.life;
      c.fillStyle = p.c;
      c.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    c.globalAlpha = 1;
    void drawSprite;
  }

  dispose() {
    for (const o of this.offs) o();
    this.offs = [];
    this.card = null;
    this.cv?.remove();
    this.cv = null;
    this.icons?.dispose();
  }
}
