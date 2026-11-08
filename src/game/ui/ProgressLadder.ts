// THE TRAIL LEDGER: what you are working toward in a run, as one tactile pixel-
// art object on its own HUD layer (a canvas over the run, on the HUD's pixel grid),
// in the HUD's stylized pixel-art style: authored sprites (HudArt.ts) with Alagard
// type on top; only the next boss's portrait is a photograph of its own rig.
//
//  • A worn leather strap hangs down the left edge from a brass buckle, a
//    bandolier with punched notches. Four badges ride on it:
//      RANK     a stamped brass concho; its parchment tag reads the rank and the
//               reward of the next one, and eight cartridges sit in their loops
//               on the tag, one per eighth of the bounty to the next rank
//      BOSS     a photograph of the next boss itself (its own rig, posed), the
//               wave it waits at and its name; "NOW" while you fight it
//      ZONE     the treasure-map scrap: the wave that opens the next zone and its
//               name (the storm parting to the next region at 50 and 75)
//      FINDS    a rolled blueprint: blueprints and relics found, all time, with
//               this ride's finds counted on
//    In a fight only the badges and a short figure show; the tags slide out from
//    behind the strap for the 30 s break, and for a few seconds whenever a row
//    changes (it pops, glints and swings).
//  • THE SHOP COMPASS: a brass pocket compass at the screen edge whose needle
//    points at Ozymandias's walking shop when it is off-screen, beside a
//    photograph of Gobi's turtle house and the distance; on screen, the little
//    turtle house rides over him with the distance under it. It shows during
//    the break, when the shop is near, and early in a ride; grey while he is
//    dug in.
//  • FIRST-TIME TIPS: a pinned note slides out under the ledger the first time
//    something new happens (the break, the shop, a rank-up, a boss wave coming,
//    a zone opening, a blueprint or relic found). Each shows once, ever.
//
// RunScene hooks: construct it once the director exists, dispose it in exit. It
// ticks itself after every engine update (engine.onAfterUpdate) and follows the
// HUD's visibility, so cutscenes, the cave and the Weighing hide it too.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import type { Ctx } from '../Ctx';
import type { Hud } from './Hud';
import type { WaveDirector } from '../run/WaveDirector';
import type { World } from '../world/World';
import type { Shop } from './Shop';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { VF } from '../../engine/voxel/VoxelModel';
import { buildRigGeo, clearRigCache, RigInstance, type RigSpec } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import { blueprintScroll } from '../models/props/treasure';
import { signpost } from '../models/props/western';
import { sculpt, Surf, fbm3, h3, mixc, mulc, clamp, clamp01, len2, sdRoundBox2, TAU, METAL, KNZ } from './HudKit';
import { SpriteBank, Shot, Sprite, blitC, blitObj, variant, wrap, pixelText, pixelTextWidth } from './HudSprites';
import { sprite, nine, SWAP_DIM, HUD_PAL } from './PixelUI';
import { HUD_ART as ART } from './HudArt';
import { Blueprints } from '../meta/Blueprints';
import { SUBAREAS } from '../world/RegionGen';

export interface LadderDeps {
  engine: Engine;
  ctx: Ctx;
  hud: Hud;
  director: WaveDirector;
  world: World;
  shop: Shop;
  camera: THREE.Camera;
}

const STRAP_L = 128;

// ------------------------------------------------------------------ boss table (mirrors bosses/BossRoster)
const BOSS: Record<string, { name: string; model: string }> = {
  khonsu: { name: 'Avatar of Khonsu', model: 'khonsu_avatar' },
  khonsuSand: { name: 'Khonsu of the Sands', model: 'khonsu_sand' },
  sethos: { name: 'Sethos', model: 'sethos_1' },
  setAvatar: { name: 'Avatar of Set', model: 'sethos_3' },
  bertha: { name: 'Big Bertha', model: 'big_bertha' },
  marshal: { name: 'The Dust Marshal', model: 'dust_marshal_1' },
  sunroller: { name: 'The Sunroller', model: 'sunroller' },
  pharaoh: { name: 'Pharaoh Nekh-Amun', model: 'pharaoh' },
  sandworm: { name: 'Old Gulp', model: 'sandworm' },
  ironclad: { name: 'The Ironclad', model: 'ironclad' },
  thornback: { name: 'Old Thornback', model: 'thorny_lizard_boss' },
};
/** which boss waits at boss wave w (the same table as makeBoss) */
export function bossAt(w: number) {
  let id: string;
  if (w >= 100) id = 'setAvatar';
  else if (w === 85 || w === 50) id = 'sethos';
  else if (w === 75) id = 'khonsuSand';
  else if (w === 5 || w === 35 || w === 65) id = 'khonsu';
  else if (w === 10 || w === 25 || w === 40) id = 'marshal';
  else {
    const first: Record<number, string> = { 15: 'thornback', 20: 'ironclad', 30: 'sandworm', 45: 'bertha', 55: 'pharaoh', 60: 'sunroller' };
    const rot = ['bertha', 'sunroller', 'ironclad', 'sandworm', 'pharaoh', 'thornback'];
    id = first[w] ?? rot[Math.floor(w / 5) % rot.length];
  }
  return { id, ...BOSS[id] };
}

// ------------------------------------------------------------------ first-time tips
const TIP_KEY = 'dustup-tips-v1';
const TIPS: Record<string, [string, string, string]> = {
  ledger: ['THE TRAIL LEDGER', 'Your next rank, the next boss', 'and your finds hang here.'],
  break: ['A THIRTY SECOND BREAK', 'Heal up, shop or explore.', 'Hold T to ring the bell early.'],
  shop: ['THE WALKING SHOP', 'Follow the smoke and the bell.', 'Ride up slowly to trade.'],
  rank: ['BOUNTY RANK UP', 'Every rank deals three cards.', 'Keep one upgrade for the ride.'],
  boss: ['A BOSS RIDES IN NEXT', 'Every fifth wave. Beat it and', 'the storm opens a new zone.'],
  zone: ['THE STORM PARTED', 'A new zone is open: new jobs,', 'new landmarks, richer loot.'],
  blueprint: ['BLUEPRINT FOUND', 'Kept forever. Fit it on the', 'workbench at the hideout.'],
  relic: ['RELIC DUG UP', 'It goes on the curio shelf', 'at home, and pays the bank.'],
};
function seenTips(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(TIP_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  t: number;
  c: string;
}
interface Row {
  /** the figure shown next to the badge in a fight */
  short: string;
  title: string;
  sub: string;
  /** pops when it changes */
  pop: number;
  key: string;
  /** 0..1 how far its tag is slid out */
  slide: number;
}

const _cv = new THREE.Vector3();
export class ProgressLadder {
  private cv = document.createElement('canvas');
  private c: CanvasRenderingContext2D;
  private bank = SpriteBank.get();
  private s = 2;
  private w = 0;
  private h = 0;
  private t = 0;
  private show = 0;
  /** seconds the tags stay out after something changed */
  private hold = 10;
  private rows: Row[] = [];
  private sparks: Spark[] = [];
  private bp0 = 0;
  private rel0 = 0;
  private bpRun = 0;
  private relRun = 0;
  private counts = { bp: { found: 0, total: 0 }, rel: { found: 0, total: 0 } };
  private unsub: (() => void)[] = [];
  // compass
  private cmp = { x: 0, y: 0, show: 0, ang: 0, on: false };
  // tips
  private seen = seenTips();
  private tipQ: string[] = [];
  private tip: { id: string; t: number } | null = null;
  private lastZone = 0;
  private wasBreak = false;

  constructor(private d: LadderDeps) {
    this.c = this.cv.getContext('2d')!;
    this.cv.id = 'ledger';
    this.cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;image-rendering:pixelated';
    d.engine.overlay.appendChild(this.cv);
    this.resize();
    this.readCounts();
    this.bp0 = this.counts.bp.found;
    this.rel0 = this.counts.rel.found;
    this.lastZone = d.world.activeZone;
    const ev = d.ctx.events;
    const on = (e: string, f: (...a: any[]) => void) => this.unsub.push(ev.on(e, f));
    on('blueprintFound', () => {
      this.bpRun++;
      this.readCounts();
      this.poke(3);
      this.want('blueprint');
    });
    on('relicFound', () => {
      this.relRun++;
      this.readCounts();
      this.poke(3);
      this.want('relic');
    });
    on('rankUp', () => {
      this.poke(0);
      this.want('rank');
    });
    on('intermission', (b: { next?: number }) => {
      this.want('break');
      if ((b?.next ?? 0) % 5 === 0) this.want('boss');
    });
    this.want('ledger');
    for (let i = 0; i < 4; i++) this.rows.push({ short: '', title: '', sub: '', pop: 0, key: '', slide: 0 });
    d.engine.onAfterUpdate.push(this.tick);
  }
  private tick = (_dt: number, rdt: number) => this.update(rdt);

  private resize() {
    this.s = this.d.hud.scale || (window.innerWidth > 1800 ? 3 : 2);
    const w = Math.ceil(window.innerWidth / this.s), h = Math.ceil(window.innerHeight / this.s);
    if (w === this.w && h === this.h) return;
    this.w = this.cv.width = w;
    this.h = this.cv.height = h;
    this.c.imageSmoothingEnabled = false;
  }

  private readCounts() {
    try {
      this.counts.bp = Blueprints.count();
      let f = 0, t = 0;
      for (const r of Blueprints.relics()) {
        f += r.found;
        t += r.total;
      }
      this.counts.rel = { found: f, total: t };
    } catch {
      /* no save */
    }
  }

  /** a row changed: it pops and the tags slide out for a few seconds */
  private poke(i: number) {
    const r = this.rows[i];
    if (r) r.pop = 1;
    this.hold = Math.max(this.hold, 6);
  }

  private want(id: string) {
    if (this.seen.has(id) || this.tipQ.includes(id) || this.tip?.id === id) return;
    this.tipQ.push(id);
  }

  // ---------------------------------------------------------------- pictures (authored pixel sprites)
  private ledgerCache = new Map<string, Sprite>();
  /** a canvas as the Sprite shape the paint code uses */
  private asSprite(key: string, make: () => HTMLCanvasElement): Sprite {
    let sp = this.ledgerCache.get(key);
    if (!sp) {
      const cv = make();
      sp = { cv, w: cv.width, h: cv.height, bx: 0, by: 0, bw: cv.width, bh: cv.height };
      this.ledgerCache.set(key, sp);
    }
    return sp;
  }
  /** the leather strap hanging from its brass buckle */
  private strap() {
    return this.asSprite('strap', () => {
      const w = ART.strap.w, h = STRAP_L + 18;
      const cv = document.createElement('canvas');
      cv.width = Math.max(w, ART.buckle.w);
      cv.height = h;
      const g = cv.getContext('2d')!;
      const sx = Math.round((cv.width - w) / 2);
      for (let y = 6; y < h; y += ART.strap.h) g.drawImage(sprite(ART.strap), sx, y);
      g.drawImage(sprite(ART.buckle), Math.round((cv.width - ART.buckle.w) / 2), 0);
      return cv;
    });
  }
  private concho(S: number) {
    void S;
    return this.asSprite('concho', () => sprite(ART.concho_l));
  }
  /** a pinned parchment tag (the authored torn-parchment frame), its nail at the left or the top */
  private paper(W: number, H: number, pin: 'left' | 'top') {
    return this.asSprite(`paper${W}x${H}${pin}`, () => {
      const cv = document.createElement('canvas');
      cv.width = W + 4;
      cv.height = H + 6;
      const g = cv.getContext('2d')!;
      g.drawImage(nine(ART.nine_parch, W, H, 8), 2, 3);
      const nl = sprite(ART.nail);
      if (pin === 'left') g.drawImage(nl, 3, Math.round(3 + H / 2 - nl.height / 2));
      else g.drawImage(nl, Math.round(2 + W / 2 - nl.width / 2), 3);
      return cv;
    });
  }
  private cartridge() {
    return this.asSprite('cart', () => sprite(ART.cart));
  }
  /** the zone badge (a signpost) and the finds badge (a blueprint roll) */
  private prop(name: string, S: number, ..._rest: unknown[]) {
    void S;
    return this.asSprite('prop:' + name, () => sprite(name === 'sign' ? ART.signpost : ART.prize_blueprint));
  }
  /** the next boss, photographed from its own rig (its portrait in the badge; built once, then let go) */
  private boss(key: string, S: number) {
    return this.bank.get('lg:boss', key + '@' + S, 40, (): Shot | null => {
      const spec = modelEntry(key)?.() as RigSpec | undefined;
      if (!spec?.parts) return null;
      const ck = 'ledger:' + key;
      const rig = new RigInstance(buildRigGeo(spec, ck), { material: this.bank.material() });
      // head and shoulders: the top of the rig fills the badge
      return {
        obj: wrap(rig.root), w: S, h: S, yaw: 0.45, pitch: 0.08, fill: 2.2, dy: 0.3,
        after: () => {
          rig.root.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
          clearRigCache(ck);
        },
      };
    });
  }
  /** Gobi's turtle house, the compass's picture (greyed while he is dug in) */
  private turtle(S: number, grey: boolean) {
    void S;
    return this.asSprite('turtle' + (grey ? ':grey' : ''), () => (grey ? sprite(ART.turtle_house, SWAP_DIM, 'dim') : sprite(ART.turtle_house)));
  }
  /** the brass compass with its needle turned to one of 16 headings */
  private compass(frame: number) {
    return this.asSprite('cmp' + frame, () => {
      const body = ART.compass, dial = ART.compass_dial;
      const cv = document.createElement('canvas');
      cv.width = body.w;
      cv.height = body.h;
      const g = cv.getContext('2d')!;
      g.drawImage(sprite(body), 0, 0);
      const cx = (body.w - 1) / 2, cy = cx + 5;
      let R = 0;
      for (let y = 0; y < dial.h; y++) for (let x = 0; x < dial.w; x++) if (dial.rows[y][x] === 'u') R = Math.max(R, Math.hypot(x - cx, y - cy));
      const a = (frame / 16) * TAU;
      // the needle: the north half painted red, the south half tin
      for (let r = -R; r <= R; r += 0.5) {
        const x = Math.round(cx + Math.sin(a) * r), y = Math.round(cy - Math.cos(a) * r);
        g.fillStyle = r > 0 ? HUD_PAL.C : HUD_PAL.Q;
        g.fillRect(x, y, 1, 1);
      }
      g.fillStyle = HUD_PAL.i;
      g.fillRect(Math.round(cx), Math.round(cy), 1, 1);
      return cv;
    });
  }

  // ---------------------------------------------------------------- state -> rows
  private compute() {
    const { ctx, director: dr, world } = this.d;
    const run = ctx.run;
    const R = this.rows;
    // rank
    const frac = clamp01(run.bounty / Math.max(1, run.bountyToNext));
    R[0].short = String(run.rank);
    R[0].title = `RANK ${run.rank}`;
    R[0].sub = `to rank ${run.rank + 1}: a card`;
    // the next boss: the wave you are on or the one coming
    const cur = Math.max(1, dr.inBreak ? dr.nextWave : dr.wave || 1);
    const bw = Math.ceil(cur / 5) * 5;
    const fighting = dr.phase === 'boss' && dr.wave === bw;
    const b = bossAt(bw);
    R[1].short = fighting ? 'NOW' : String(bw);
    R[1].title = fighting ? 'BOSS: NOW' : `WAVE ${bw} BOSS`;
    R[1].sub = b.name;
    // the next zone (or the storm parting to the next region)
    const zs = world.sa.zones, zi = world.activeZone;
    const next = zs[zi + 1];
    const zw = zs[zi]?.waves?.[1] ?? bw;
    const area = world.sa.key;
    if (next) {
      R[2].short = String(zw);
      R[2].title = `WAVE ${zw} OPENS`;
      R[2].sub = next.name;
    } else if (area !== 'C') {
      const to = SUBAREAS[area === 'A' ? 'B' : 'C'];
      R[2].short = String(zw);
      R[2].title = `WAVE ${zw}: STORM PARTS`;
      R[2].sub = to.name;
    } else {
      R[2].short = '100';
      R[2].title = 'WAVE 100';
      R[2].sub = 'the storm breaks';
    }
    // finds
    const c = this.counts;
    R[3].short = `${c.bp.found}/${c.bp.total}`;
    R[3].title = `BLUEPRINTS ${c.bp.found}/${c.bp.total}`;
    const runFinds = this.bpRun + this.relRun;
    R[3].sub = `relics ${c.rel.found}/${c.rel.total}` + (runFinds ? `  +${runFinds} this ride` : '');
    // a row whose meaning changed pops
    R.forEach((r, i) => {
      const k = i === 0 ? r.short : r.title + r.sub;
      if (r.key && k !== r.key && i !== 3) this.poke(i);
      r.key = k;
    });
    return { frac, boss: b, fighting };
  }

  // ---------------------------------------------------------------- per frame
  update(rdt: number) {
    const dt = Math.min(0.1, rdt);
    this.t += dt;
    this.resize();
    const { hud, engine: eng, director: dr, world } = this.d;
    const c = this.c;
    c.clearRect(0, 0, this.w, this.h);
    const vis = hud.visible && !eng.paused;
    this.show += ((vis ? 1 : 0) - this.show) * Math.min(1, dt * 6);
    if (this.show < 0.02) return;
    this.bank.pump(eng.renderer, 2);
    const S = this.compute();
    // tips: the zone opening, the shop in sight
    if (world.activeZone !== this.lastZone) {
      this.lastZone = world.activeZone;
      this.want('zone');
      this.hold = Math.max(this.hold, 6);
    }
    const shop = this.d.shop.nearestShop();
    if (shop && shop.dist < 140 && !shop.visited) this.want('shop');
    const brk = dr.inBreak;
    if (brk && !this.wasBreak) this.hold = Math.max(this.hold, 3);
    this.wasBreak = brk;
    this.hold = Math.max(0, this.hold - dt);
    // a first-time tip takes the tags' place beside the strap while it shows
    const tipOn = !!this.tip || (this.tipQ.length > 0 && this.show > 0.9);
    const open = (brk || this.hold > 0) && !tipOn;
    const k = 1;
    const x0 = Math.round(-30 * (1 - this.show)) + 4;
    const top = Math.max(58, Math.round(this.h * 0.17));
    this.paintLedger(c, dt, x0, top, open, S, k);
    this.paintTip(c, dt, x0 + 52, top + 10); // right of the badges and their figures
    this.paintCompass(c, dt, shop, brk);
    this.paintSparks(c, dt);
  }

  private paintLedger(c: CanvasRenderingContext2D, dt: number, x0: number, top: number, open: boolean, S: ReturnType<ProgressLadder['compute']>, k: number) {
    void k;
    const sx = x0 + 9;
    const strap = this.strap();
    if (strap) blitObj(c, strap, sx, top + strap.h / 2 - 9, 2, this.show);
    const pitch = 32;
    const y0 = top + 22;
    const icons: (Sprite | null)[] = [
      this.concho(26),
      this.boss(S.boss.model, 28),
      this.prop('sign', 28, () => signpost(2), 0.55, 0.12, { fill: 2.0, dy: 0.3 }),
      this.prop('scroll', 28, () => blueprintScroll('gun'), 0.95, 0.42),
    ];
    this.rows.forEach((r, i) => {
      const cy = y0 + i * pitch;
      r.pop = Math.max(0, r.pop - dt * 1.6);
      // the tag slides out from behind the strap (a little stagger down the strap)
      const want = open ? 1 : 0;
      r.slide += (want - r.slide) * Math.min(1, dt * (want ? 7 - i : 9));
      if (r.slide > 0.02) this.paintTag(c, r, i, sx + 8, cy, S);
      // the badge on the strap
      const ic = icons[i];
      const bounce = Math.sin(r.pop * Math.PI) * 3;
      const sz = 1 + 0.25 * Math.sin(r.pop * Math.PI);
      if (ic) {
        blitObj(c, ic, sx, cy - bounce, 2 + bounce, this.show, ic.w * sz, ic.h * sz);
        if (r.pop > 0.6 && Math.random() < dt * 30) this.spark(sx + (Math.random() - 0.5) * 16, cy + (Math.random() - 0.5) * 14);
      }
      // in a fight: just the figure beside the badge
      const fig = 1 - r.slide;
      if (fig > 0.05 && r.short && i !== 2) {
        c.globalAlpha = fig * this.show;
        pixelText(c, r.short, sx + 14, cy - 8, { size: 16, color: i === 1 && S.fighting ? '#ff8a6a' : '#fff3d6', outline: '#1a0e06' });
        c.globalAlpha = 1;
      }
    });
  }

  private paintTag(c: CanvasRenderingContext2D, r: Row, i: number, x: number, cy: number, S: ReturnType<ProgressLadder['compute']>) {
    const tw = Math.max(pixelTextWidth(r.title, 16), pixelTextWidth(r.sub, 16) + 4 + (i === 0 ? 52 : 0));
    const W = Math.min(220, Math.ceil((tw + 22) / 16) * 16);
    const H = 30;
    const pp = this.paper(W, H, 'left');
    if (!pp) return;
    const e = 1 - Math.pow(1 - r.slide, 3);
    const px = Math.round(x - (W + 10) * (1 - e));
    const swing = Math.sin(this.t * 1.3 + i) * 0.4 + Math.sin(r.pop * Math.PI * 3) * r.pop * 2;
    // clip to the right of the strap so it seems to come out from behind it
    c.save();
    c.beginPath();
    c.rect(x - 3, cy - 30, this.w, 60);
    c.clip();
    blitObj(c, pp, px + pp.w / 2 - 2, cy + Math.round(swing), 2, this.show * Math.min(1, r.slide * 2));
    const tx = px + 10, ty = cy - 14 + Math.round(swing);
    const al = this.show * clamp01(r.slide * 1.6 - 0.4);
    c.globalAlpha = al;
    pixelText(c, r.title, tx, ty, { size: 16, color: '#3a1c0a', lip: '#f6e8c4' });
    pixelText(c, r.sub, tx + (i === 0 ? 52 : 0), ty + 13, { size: 16, color: i === 1 ? '#8a2016' : '#6a4a28' });
    c.globalAlpha = 1;
    // the rank row: eight cartridges in their loops, one per eighth of the bounty to the next rank
    if (i === 0) {
      const cart = this.cartridge();
      if (cart) {
        const n = 8, filled = Math.floor(S.frac * n + 1e-6);
        const cx0 = tx + 3;
        for (let j = 0; j < n; j++) {
          const on = j < filled;
          const xx = cx0 + j * 6, yy = ty + 20;
          c.globalAlpha = al * (on ? 1 : 0.35);
          blitC(c, on ? cart : variant(cart, 'shadow'), xx, yy);
        }
        c.globalAlpha = 1;
      }
    }
    c.restore();
  }

  // ---------------------------------------------------------------- the shop compass
  private paintCompass(c: CanvasRenderingContext2D, dt: number, shop: ReturnType<Shop['nearestShop']>, brk: boolean) {
    const C = this.cmp;
    const run = this.d.ctx.run;
    const want = !!shop && !this.d.shop.visiting && shop.dist > 22 && (brk || shop.dist < 170 || run.time < 75);
    C.show += ((want ? 1 : 0) - C.show) * Math.min(1, dt * 4);
    if (C.show < 0.03 || !shop) return;
    const p = this.d.hud.project?.({ x: shop.pos.x, y: shop.pos.y + 8.5, z: shop.pos.z });
    if (!p) return;
    const s = this.s, W = this.w, H = this.h;
    let x = p.x / s, y = p.y / s;
    const onScreen = p.visible && !p.behind && x > 20 && x < W - 20 && y > 30 && y < H - 30;
    const dist = `${Math.round(shop.dist)} m`;
    const tur = this.turtle(30, shop.hidden);
    const al = C.show * this.show;
    if (onScreen) {
      // over Gobi: the little turtle house and the distance under it
      const bob = Math.round(Math.sin(this.t * 2.2) * 1.5);
      if (tur) blitObj(c, tur, x, y - 14 + bob, 3, al);
      c.globalAlpha = al;
      pixelText(c, shop.hidden ? 'dug in' : dist, x, y + 4 + bob, { size: 16, color: shop.hidden ? '#c9a97c' : '#ffd36b', align: 'center', outline: '#1a0e06' });
      c.globalAlpha = 1;
      return;
    }
    // off screen: the compass at the edge, its needle pointing the way (straight ahead = up, behind = down)
    const cx = W / 2, cy = H / 2;
    const v = _cv.set(shop.pos.x, shop.pos.y + 3, shop.pos.z).applyMatrix4(this.d.camera.matrixWorldInverse);
    const ang = Math.atan2(v.x, -v.z); // 0 = up, clockwise
    // clamped to a frame inside the screen edge that keeps clear of the ledger (left) and the HUD's bottom bar
    const sx = Math.sin(ang), sy = -Math.cos(ang);
    const L = 64, R = W - 30, T = 40, B = H - 86;
    const t = Math.min(sx < 0 ? (L - cx) / sx : sx > 0 ? (R - cx) / sx : 1e9, sy < 0 ? (T - cy) / sy : sy > 0 ? (B - cy) / sy : 1e9);
    x = cx + sx * t;
    y = cy + sy * t;
    C.ang += Math.atan2(Math.sin(ang - C.ang), Math.cos(ang - C.ang)) * Math.min(1, dt * 8);
    const frame = ((Math.round((C.ang / TAU) * 16) % 16) + 16) % 16;
    const cmp = this.compass(frame);
    const wob = Math.round(Math.sin(this.t * 3.1) * 0.6);
    if (cmp) blitObj(c, cmp, x, y + wob, 3, al);
    // the turtle house and the distance on the inner side
    const ix = x - Math.sin(ang) * 38, iy = y + Math.cos(ang) * 26;
    if (tur) blitObj(c, tur, ix, iy - 4, 2, al * 0.95);
    c.globalAlpha = al;
    pixelText(c, shop.hidden ? 'dug in' : dist, ix, iy + 8, { size: 16, color: shop.hidden ? '#c9a97c' : '#ffd36b', align: 'center', outline: '#1a0e06' });
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- first-time tips
  private paintTip(c: CanvasRenderingContext2D, dt: number, x0: number, y: number) {
    if (!this.tip && this.tipQ.length && this.show > 0.9) {
      const id = this.tipQ.shift()!;
      this.tip = { id, t: 0 };
      this.seen.add(id);
      try {
        localStorage.setItem(TIP_KEY, JSON.stringify([...this.seen]));
      } catch {
        /* storage blocked */
      }
      this.d.ctx.sfx('paper_flutter', null, 0.45, 1.1);
    }
    const T = this.tip;
    if (!T) return;
    T.t += dt;
    const DUR = 8.5;
    if (T.t > DUR) {
      this.tip = null;
      return;
    }
    const lines = TIPS[T.id];
    if (!lines) {
      this.tip = null;
      return;
    }
    const tw = Math.max(...lines.map((l) => pixelTextWidth(l, 16)));
    const W = Math.min(272, Math.max(160, Math.ceil((tw + 24) / 16) * 16)), H = 52;
    const pp = this.paper(W, H, 'top');
    if (!pp) return;
    const inK = clamp01(T.t / 0.45), outK = clamp01((T.t - (DUR - 0.5)) / 0.5);
    const e = 1 - Math.pow(1 - inK, 3) - outK * outK;
    const x = Math.round(x0 - (W + 30) * (1 - e));
    const yy = y;
    const sway = Math.sin(T.t * 2.4) * Math.max(0, 1 - T.t * 0.6) * 2;
    // it slides out from behind the ledger's figures
    c.save();
    c.beginPath();
    c.rect(x0 - 6, yy - 12, this.w, H + 30);
    c.clip();
    blitObj(c, pp, x + pp.w / 2, yy + H / 2 + Math.round(sway), 3, this.show);
    c.globalAlpha = this.show * clamp01(e * 1.5);
    pixelText(c, lines[0], x + 10, yy + 7, { size: 16, color: '#8a2016', lip: '#f6e8c4' });
    pixelText(c, lines[1], x + 10, yy + 22, { size: 16, color: '#3a1c0a' });
    pixelText(c, lines[2], x + 10, yy + 35, { size: 16, color: '#3a1c0a' });
    c.globalAlpha = 1;
    c.restore();
  }

  // ---------------------------------------------------------------- pixel sparks
  private spark(x: number, y: number) {
    if (this.sparks.length > 60) return;
    const a = Math.random() * TAU, v = 18 + Math.random() * 30;
    this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 10, life: 0.35 + Math.random() * 0.35, t: 0, c: Math.random() < 0.5 ? '#fff6d0' : '#ffd36b' });
  }
  private paintSparks(c: CanvasRenderingContext2D, dt: number) {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.t += dt;
      if (p.t > p.life) {
        this.sparks.splice(i, 1);
        continue;
      }
      p.vx *= 1 - dt * 3;
      p.vy = p.vy * (1 - dt * 3) + 30 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      c.globalAlpha = (1 - p.t / p.life) * this.show;
      c.fillStyle = p.c;
      c.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    c.globalAlpha = 1;
  }

  dispose() {
    const L = this.d.engine.onAfterUpdate, i = L.indexOf(this.tick);
    if (i >= 0) L.splice(i, 1);
    for (const u of this.unsub) u();
    this.unsub = [];
    this.cv.remove();
  }
}
