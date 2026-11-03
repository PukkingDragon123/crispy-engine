// Sundown's in-run quips: short, dry, rate-limited lines on the big moments
// (a multi-kill, low bones, a perfect reload, a big trick, a new zone, a boss
// walking in, a boss going down). Each one types itself out as a small Alagard
// subtitle beside his head and is spoken in his voice (Voice 'sundown').
//
// Self-driving: hooks ctx.events and engine.onAfterUpdate itself and tears down
// when the run scene goes away. RunScene needs one line:
//   new Barks(this.ctx, this.player);
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import { FloatText3D } from '../fx/FloatText3D';
import { Voice } from './Voice';

/** what Barks reads off the hunter */
export interface BarkHero {
  readonly pos: THREE.Vector3;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
}

type Kind = 'multi' | 'massacre' | 'lowHp' | 'reload' | 'trick' | 'zone' | 'boss' | 'bossDown' | 'dodge';

const LINES: Record<Kind, string[]> = {
  multi: ['Next.', 'Too slow.', "Who's next?", "Line 'em up.", 'Thinned the herd.', 'Crowded.'],
  massacre: ['Dust to dust.', 'Rest easy, boys.', 'All of you? Fine.', 'That all?'],
  lowHp: ['Just a scratch.', 'Been deader.', 'Not yet.', 'Bones hold.', 'Still standing.', 'Easy, now.'],
  reload: ['Six fresh.', 'Smooth.', 'Loaded.', 'Back in business.', 'Click.'],
  trick: ['Still got it.', 'Bones remember.', 'Smooth as sand.', 'Not bad.', 'Easy.'],
  zone: ['New ground. Same dead.', "Sand's different here.", 'Smells like trouble.', 'Keep riding.'],
  boss: ['Big talk.', "Let's dance.", "You'll do.", 'Draw.', 'Bigger they come.'],
  bossDown: ['Stay down.', "That's that.", 'Told you.', 'Rest easy.'],
  dodge: ['Missed.', 'Close.', 'Nope.'],
};

/** cooldown (s), chance, priority (high ones may break the global gap), delay (s), how long it may wait for silence (s) */
const RULES: Record<Kind, { cd: number; chance: number; prio: number; delay: number; wait: number }> = {
  multi: { cd: 14, chance: 0.75, prio: 1, delay: 0.35, wait: 1.2 },
  massacre: { cd: 10, chance: 1, prio: 2, delay: 0.45, wait: 1.5 },
  lowHp: { cd: 30, chance: 1, prio: 2, delay: 0.5, wait: 1.5 },
  reload: { cd: 25, chance: 0.55, prio: 0, delay: 0.25, wait: 0.8 },
  trick: { cd: 18, chance: 0.7, prio: 1, delay: 0.3, wait: 1 },
  zone: { cd: 0, chance: 1, prio: 3, delay: 4.5, wait: 5 },
  boss: { cd: 0, chance: 1, prio: 3, delay: 2.9, wait: 6 },
  bossDown: { cd: 0, chance: 1, prio: 3, delay: 1.6, wait: 4 },
  dodge: { cd: 30, chance: 0.35, prio: 0, delay: 0.2, wait: 0.6 },
};

const GAP = 7; // seconds between any two barks (priority 3 ignores it)
const KEY = 'sundown-bark';

export class Barks {
  private t = 0;
  private lastAny = -1e9;
  private last = new Map<Kind, number>();
  private bags = new Map<Kind, string[]>();
  private recent = new Map<Kind, string>();
  private queued: { kind: Kind; at: number; until: number } | null = null;
  private sub: FloatText3D | null = null;
  private subLeft = 0;
  private fading: FloatText3D[] = [];
  private zone = 0;
  private host: unknown = null;
  private offs: (() => void)[] = [];
  private right = new THREE.Vector3();
  private dead = false;

  constructor(private ctx: Ctx, private hero: BarkHero) {
    Voice.attach(ctx.audio);
    this.zone = ctx.world.activeZone;
    this.host = ctx.engine.current;
    const ev = ctx.events;
    this.offs.push(
      ev.on('multiKill', (n: number) => n >= 3 && this.want(n >= 6 ? 'massacre' : 'multi')),
      ev.on('playerHurt', () => {
        const h = this.hero;
        if (h.alive && h.hp > 0 && h.hp / Math.max(1, h.maxHp) < 0.3) this.want('lowHp');
      }),
      ev.on('perfectReload', () => this.want('reload')),
      ev.on('trick', (l: { score?: number; quality?: string }) => {
        const s = l?.score ?? 0;
        if (s >= 450 || (l?.quality === 'perfect' && s >= 250)) this.want('trick');
      }),
      ev.on('bossIntro', () => this.want('boss')),
      ev.on('bossKilled', () => this.want('bossDown')),
      ev.on('perfectDodge', () => this.want('dodge')),
      ev.on('playerDeath', () => {
        this.queued = null;
        Voice.stop(KEY, 0.15);
      }),
    );
    ctx.engine.onAfterUpdate.push(this.tick);
  }

  /** ask for a bark; it fires after its delay once the air is clear */
  private want(kind: Kind) {
    const r = RULES[kind];
    if (this.t - (this.last.get(kind) ?? -1e9) < r.cd) return;
    if (Math.random() > r.chance) return;
    if (this.queued && RULES[this.queued.kind].prio > r.prio) return;
    this.queued = { kind, at: this.t + r.delay, until: this.t + r.delay + r.wait };
  }

  private tick = (_dt: number, rdt: number) => {
    const eng = this.ctx.engine;
    if (eng.current !== this.host) return this.dispose();
    if (eng.paused) return;
    this.t += rdt;
    // a new zone opened up
    const z = this.ctx.world.activeZone;
    if (z !== this.zone) {
      this.zone = z;
      this.want('zone');
    }
    const q = this.queued;
    if (q && this.t >= q.at) {
      const pr = RULES[q.kind].prio;
      const clear = this.hero.alive && !Voice.speaking(KEY) && (pr >= 3 || this.t - this.lastAny >= GAP);
      if (clear) {
        this.queued = null;
        this.fire(q.kind);
      } else if (this.t > q.until) this.queued = null;
    }
    this.updateText(rdt);
  };

  private pick(kind: Kind) {
    let bag = this.bags.get(kind);
    if (!bag || !bag.length) {
      bag = LINES[kind].slice().sort(() => Math.random() - 0.5);
      // never the same line twice in a row
      if (bag.length > 1 && bag[bag.length - 1] === this.recent.get(kind)) bag.unshift(bag.pop()!);
      this.bags.set(kind, bag);
    }
    const line = bag.pop()!;
    this.recent.set(kind, line);
    return line;
  }

  private fire(kind: Kind) {
    const text = this.pick(kind);
    this.last.set(kind, this.t);
    this.lastAny = this.t;
    const sp = Voice.say('sundown', text, { pos: this.hero.pos, follow: true, key: KEY, duck: 0.3 });
    // the subtitle types at the pace of the voice
    const dur = sp ? Math.max(0.25, sp.duration * 0.85) : text.length / 22;
    this.show(text, Math.min(60, Math.max(10, text.length / dur)), (sp?.duration ?? dur) + 1.1 + text.length * 0.03);
  }

  // ---------------------------------------------------------------- subtitle
  private show(text: string, cps: number, life: number) {
    if (this.sub) {
      this.sub.show(false);
      this.fading.push(this.sub);
    }
    const ft = new FloatText3D(text, { size: 0.15, px: 56, cps, wrap: 24, color: '#f3e4c4', glow: '#ff9a4a', hdr: 1.25 });
    this.place(ft);
    this.ctx.scene.add(ft.mesh);
    this.sub = ft;
    this.subLeft = life;
  }

  /** beside his head, on the camera's right, sized to read the same at any distance */
  private place(ft: FloatText3D) {
    const cam = this.ctx.camera;
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    ft.anchor.copy(this.hero.pos).addScaledVector(this.right, 0.62);
    ft.anchor.y += 2.05;
  }

  private updateText(rdt: number) {
    const cam = this.ctx.camera;
    const fit = (ft: FloatText3D) => {
      const k = THREE.MathUtils.clamp(cam.position.distanceTo(ft.anchor) / 5.5, 0.6, 2.4);
      ft.mesh.scale.multiplyScalar(k);
    };
    if (this.sub) {
      this.subLeft -= rdt;
      this.place(this.sub);
      this.sub.update(rdt, cam);
      fit(this.sub);
      if (this.subLeft <= 0 || !this.hero.alive) {
        this.sub.show(false);
        this.fading.push(this.sub);
        this.sub = null;
      }
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i];
      this.place(f);
      f.update(rdt, cam);
      fit(f);
      if (f.visibleAmount < 0.02) {
        f.dispose();
        this.fading.splice(i, 1);
      }
    }
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    for (const off of this.offs) off();
    const l = this.ctx.engine.onAfterUpdate;
    // may be called from inside the engine's onAfterUpdate loop: unhook after it
    queueMicrotask(() => {
      const i = l.indexOf(this.tick);
      if (i >= 0) l.splice(i, 1);
    });
    this.sub?.dispose();
    for (const f of this.fading) f.dispose();
    this.sub = null;
    this.fading = [];
    Voice.stop(KEY, 0.1);
  }
}
