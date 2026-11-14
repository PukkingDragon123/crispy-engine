// THE UNLOCK CARD: every permanent unlock of the slow reveal (meta/Unlocks) is
// announced once on a pinned parchment card that drops in at the top of the screen,
// in the HUD's stylized pixel-art style: the authored torn-parchment frame and the
// red ribbon of the toasts, the lapis niche holding a photograph of the thing itself
// (its own model through the SpriteBank / IconFactory; an authored glyph for things
// without one), the tally that paid for it ("ANUBIS' TALLY 3") and one line on what
// it gives you. Several queue up and drop one after another.
//
// It lives above every scene (its own canvas in the engine overlay, ticked from
// engine.onAfterUpdate), so a death that pays out shows on the death cinematic, a
// finished ride on the results, a study on Thoth's Hall. Outside a run it pulls the
// pending reveals itself once the screen is uncovered; inside a run only
// run/Progression shows cards (in-run unlocks are toasted, then listed at the end).
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import { Unlocks, TRACK_TITLE, type UnlockDef } from '../meta/Unlocks';
import { modelEntry } from '../models/lookup';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, clearRigCache, RigInstance, type RigSpec } from '../../engine/voxel/Rig';
import { SpriteBank, type Shot, type Sprite, blitObj, blitC, wrap, pixelText, pixelTextWidth } from './HudSprites';
import { sprite, nine, strip3, type PixelSprite } from './PixelUI';
import { HUD_ART as ART } from './HudArt';
import { wrapInk } from './HudKit';

const RIBBON_R: PixelSprite = { w: ART.ribbon_end.w, h: ART.ribbon_end.h, rows: ART.ribbon_end.rows.map((r) => r.split('').reverse().join('')) };

interface Card {
  u: UnlockDef;
  t: number;
  dur: number;
  idx: number;
  of: number;
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

/** where the card's picture comes from when the unlock has no model */
function glyphFor(u: UnlockDef): PixelSprite {
  if (u.kind === 'mission') return ART.signpost;
  if (u.kind === 'system') return ART.thoth;
  if (u.kind === 'cosmetic') return ART.star_s;
  if (u.track === 'tally') return ART.glyph_ankh;
  return ART.glyph_eye;
}

const KIND_RIBBON: Record<string, string> = {
  tally: "ANUBIS' TALLY",
  item: 'NEW STOCK', ware: 'RARE STOCK', plan: 'NEW STOCK', trinket: 'TRINKET PLAN', cards: 'NEW CARDS', mission: 'NEW JOB', system: 'UNLOCKED', cosmetic: 'NEW LOOK',
};

class Reveal {
  private cv = document.createElement('canvas');
  private c = this.cv.getContext('2d')!;
  private s = 2;
  private w = 0;
  private h = 0;
  private q: Card[] = [];
  private cur: Card | null = null;
  private sparks: Spark[] = [];
  private bank = SpriteBank.get();
  private sceneT = 0;
  private lastScene: unknown = null;
  private gap = 0;

  constructor(private eng: Engine) {
    this.cv.id = 'unlock-reveal';
    this.cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:12;image-rendering:pixelated';
    eng.overlay.appendChild(this.cv);
    eng.onAfterUpdate.push((_dt, rdt) => this.update(rdt));
  }

  /** cards that are not saved unlocks (the tally after a death that paid nothing), shown with the next batch */
  local: UnlockDef[] = [];
  /** show everything waiting: the saved reveals and the local cards */
  flush() {
    const list = [...Unlocks.takeReveal(), ...this.local];
    this.local = [];
    if (list.length) this.show(list);
  }

  show(list: UnlockDef[]) {
    const n0 = this.q.length + (this.cur ? 1 : 0);
    list.forEach((u, i) => this.q.push({ u, t: 0, dur: list.length > 3 ? 3.0 : 3.8, idx: n0 + i + 1, of: 0 }));
    const of = this.q.length + (this.cur ? 1 : 0);
    for (const c of this.q) c.of = Math.max(c.of, of);
    if (this.cur) this.cur.of = Math.max(this.cur.of, of);
  }

  private resize() {
    this.s = window.innerWidth > 1800 ? 3 : 2;
    const w = Math.ceil(window.innerWidth / this.s), h = Math.ceil(window.innerHeight / this.s);
    if (w === this.w && h === this.h) return;
    this.w = this.cv.width = w;
    this.h = this.cv.height = h;
    this.c.imageSmoothingEnabled = false;
  }

  private covered() {
    const e = this.eng as unknown as { covered?: boolean; loader?: { shown?: boolean } | null };
    return !!e.covered || !!e.loader?.shown || parseFloat(this.eng.fadeEl.style.opacity || '0') > 0.35;
  }

  private update(rdt: number) {
    const dt = Math.min(0.1, rdt);
    if (this.eng.overlay !== this.cv.parentElement) this.eng.overlay.appendChild(this.cv);
    const scene = this.eng.current as unknown as { director?: unknown } | null;
    if (scene !== this.lastScene) {
      this.lastScene = scene;
      this.sceneT = 0;
    }
    this.sceneT += dt;
    const covered = this.covered();
    // outside a run, pending reveals show themselves once the new scene has settled
    if (!covered && scene && !scene.director && this.sceneT > 2.2 && !this.cur && !this.q.length && (Unlocks.pendingReveal() || this.local.length)) this.flush();
    if (!this.cur && !this.q.length && !this.sparks.length) {
      if (this.w) {
        this.c.clearRect(0, 0, this.w, this.h);
        this.w = this.h = 0;
        this.cv.width = this.cv.height = 1;
      }
      return;
    }
    this.resize();
    const c = this.c;
    c.clearRect(0, 0, this.w, this.h);
    if (covered) return;
    this.bank.pump(this.eng.renderer, 2);
    this.gap = Math.max(0, this.gap - dt);
    if (!this.cur && this.q.length && this.gap <= 0) {
      this.cur = this.q.shift()!;
      this.cur.t = 0;
      this.eng.audio.play('paper_flutter', { volume: 0.6, pitch: 1.05 });
    }
    const C = this.cur;
    if (C) {
      C.t += dt;
      this.paint(C);
      if (C.t > C.dur + 0.5) {
        this.cur = null;
        this.gap = 0.15;
      }
    }
    this.paintSparks(dt);
  }

  // ---------------------------------------------------------------- the card
  private photo(key: string, S: number): Sprite | null {
    return this.bank.get('unlock:' + key, S, 60, (): Shot | null => {
      const e = modelEntry(key)?.() as (RigSpec & { model?: never }) | { model: any; voxelSize: number } | undefined;
      if (!e) return null;
      const mat = this.bank.material();
      if ((e as RigSpec).parts) {
        const ck = 'unlock:' + key;
        const rig = new RigInstance(buildRigGeo(e as RigSpec, ck), { material: mat });
        return {
          obj: wrap(rig.root), w: S, h: S, yaw: 0.6, pitch: 0.25, fill: 0.85,
          after: () => {
            rig.root.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
            clearRigCache(ck);
          },
        };
      }
      const st = e as { model: any; voxelSize: number };
      if (!st.model) return null;
      const geo = buildVoxelGeometry(st.model, { voxelSize: st.voxelSize, pivot: 'center' });
      const mesh = new THREE.Mesh(geo, mat);
      return { obj: wrap(mesh), w: S, h: S, yaw: 0.7, pitch: 0.3, fill: 1.0, after: () => geo.dispose() };
    });
  }

  private paint(C: Card) {
    const c = this.c, u = C.u;
    const head = `${TRACK_TITLE[u.track]}  ${u.at}`;
    // the effect line wraps (two lines at most) so the card stays a card, not a banner
    const lw = Math.min(210, this.w - 90);
    const lines = wrapInk(u.line, lw, 16, 2);
    const tw = Math.max(pixelTextWidth(u.name, 16), pixelTextWidth(head, 16), ...lines.map((l) => pixelTextWidth(l, 16)));
    const W = Math.min(this.w - 16, Math.max(200, Math.ceil(tw * 1.06 + 64)));
    const H = 60 + lines.length * 13;
    // in: a drop with a little overshoot; out: snapped back up past the top
    const tin = Math.min(1, C.t / 0.42), tout = Math.max(0, (C.t - C.dur) / 0.45);
    const back = (k: number) => 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
    // in a run: just under the wave plaque; on the death / results screens: lower middle, clear of their titles
    const inRun = !!(this.eng.current as unknown as { director?: unknown } | null)?.director;
    const y0 = inRun ? 52 : Math.round(Math.min(this.h - H - 40, this.h * 0.58));
    const y = Math.round(-H - 20 + (y0 + H + 20) * back(tin) - (y0 + H + 40) * tout * tout);
    const x = Math.round(this.w / 2 - W / 2);
    const sway = Math.sin(C.t * 2.2) * Math.max(0, 1 - C.t * 0.5) * 1.5;
    if (C.t > 0.38 && C.t - 0.1 < 0.38) {
      for (let i = 0; i < 26; i++) this.spark(x + Math.random() * W, y + H - 2 + Math.random() * 4);
      this.eng.audio.play(u.track === 'tally' ? 'soul_leave' : 'loot_reveal', { volume: 0.45 });
    }
    // the parchment, nailed at its top
    c.save();
    c.translate(0, Math.round(sway));
    blitObj(c, nine(ART.nine_parch, W, H, 8), x + W / 2, y + H / 2, 3, 1);
    const nl = sprite(ART.nail);
    c.drawImage(nl, Math.round(x + W / 2 - nl.width / 2), y + 2);
    // the ribbon tab: what kind of unlock
    const rt = KIND_RIBBON[u.id === 'tally' ? 'tally' : u.kind] ?? 'UNLOCKED';
    const rw = Math.ceil(pixelTextWidth(rt, 16)) + 20;
    const rib = strip3(ART.ribbon_end, ART.ribbon_mid, RIBBON_R, rw, 'unlock-ribbon');
    blitC(c, rib, x + W - rw / 2 - 6, y - 4);
    pixelText(c, rt, x + W - rw / 2 - 6, y - 4 - 8, { size: 16, color: '#fff3d6', align: 'center', outline: '#2a0604' });
    // the niche and its picture
    const niche = sprite(ART.niche);
    const nx = x + 8, ny = y + Math.round((H - niche.height) / 2) + 1;
    c.drawImage(niche, nx, ny);
    const pic = u.model ? this.photo(u.model, 28) : null;
    if (pic) blitObj(c, pic, nx + niche.width / 2, ny + niche.height / 2, 1, 1);
    else {
      const g = sprite(glyphFor(u));
      const k = Math.max(1, Math.floor(22 / Math.max(g.width, g.height)));
      c.drawImage(g, Math.round(nx + niche.width / 2 - (g.width * k) / 2), Math.round(ny + niche.height / 2 - (g.height * k) / 2), g.width * k, g.height * k);
    }
    // the words
    const tx = nx + niche.width + 8;
    const al = Math.min(1, Math.max(0, (C.t - 0.25) * 4));
    c.globalAlpha = al;
    pixelText(c, head, tx, y + 10, { size: 16, color: u.track === 'tally' ? '#5a2a8a' : '#8a2016', lip: '#f6e8c4' });
    pixelText(c, u.name, tx, y + 25, { size: 16, color: '#3a1c0a' });
    lines.forEach((l, i) => pixelText(c, l, tx, y + 40 + i * 13, { size: 16, color: '#6a4a28' }));
    if (C.of > 1) pixelText(c, `${C.idx}/${C.of}`, x + W - 10, y + H - 19, { size: 16, color: '#8a6a40', align: 'right' });
    c.globalAlpha = 1;
    c.restore();
  }

  // ---------------------------------------------------------------- pixel sparks
  private spark(x: number, y: number) {
    if (this.sparks.length > 80) return;
    const a = -Math.PI * (0.1 + Math.random() * 0.8), v = 20 + Math.random() * 40;
    this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.4 + Math.random() * 0.5, c: Math.random() < 0.5 ? '#fff6d0' : '#e8c890' });
  }
  private paintSparks(dt: number) {
    const c = this.c;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.t += dt;
      if (p.t > p.life) {
        this.sparks.splice(i, 1);
        continue;
      }
      p.vy += 60 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      c.globalAlpha = 1 - p.t / p.life;
      c.fillStyle = p.c;
      c.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    c.globalAlpha = 1;
  }
}

let inst: Reveal | null = null;
export const UnlockReveal = {
  /** attach to the engine (once; it lives above every scene) */
  ensure(eng?: Engine) {
    const e = eng ?? ((window as any).__engine as Engine | undefined);
    if (!inst && e?.overlay) inst = new Reveal(e);
    return inst;
  },
  /** a card that is not a saved unlock, shown with the next batch (outside a run, or on flush) */
  later(u: UnlockDef) {
    const r = UnlockReveal.ensure();
    if (r) r.local.push(u);
  },
  /** show every pending card now */
  flush() {
    UnlockReveal.ensure()?.flush();
  },
  /** queue cards now (in a run: run/Progression decides when) */
  show(list: UnlockDef[]) {
    if (!list.length) return;
    UnlockReveal.ensure()?.show(list);
  },
};
