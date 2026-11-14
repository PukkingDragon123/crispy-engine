// Ultimate: SERKET'S WRATH. Time crawls, the sand splits, a colossal scorpion
// rises behind Sundown and strikes three QTE-timed targets; perfect timing
// detonates every poison stack in the blast. Variants unlock permanently.
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../Ctx';
import type { Player } from './Player';
import type { Qte, QteResult } from '../ui/Qte';
import type { CameraRig } from './CameraRig';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import { Ease } from '../../engine/Tween';
import { P } from '../../engine/voxel/palette';
import { rnd } from '../../engine/math/rand';
import type { HeroUlt } from './heroes/HeroKit';

export type UltVariant = 'wrath' | 'detonation' | 'plague';

export const ULT_INFO: Record<UltVariant, { name: string; desc: string }> = {
  wrath: { name: "Serket's Wrath", desc: 'A colossal scorpion erupts and strikes three times. Perfect timing detonates poison.' },
  detonation: { name: 'Venom Detonation', desc: 'Every poisoned enemy on the field bursts. Damage scales with stacks.' },
  plague: { name: 'Plague of Khepri', desc: 'A storm of locusts and scarabs devours everything near you for 8 s.' },
};

/**
 * SOUL: the ultimate's charge (`run.ultCharge`, 0..1) is Serket's soul, shown in
 * the HUD as a glass canopic jar filling with jade smoke (ui/SoulBar). It fills
 * mostly from kill streaks: every kill in a streak pours in more than the last,
 * kills landing together (multi-kills) surge it, streak milestones pour a slug
 * in, and style (tricks, grazes) adds only a little. All gains scale with the
 * `ultCharge` stat. Nothing charges while the ultimate itself is running.
 */
export const SOUL = {
  /** every kill */
  kill: 0.004,
  /** + this per kill already in the streak (streak counted up to `streakCap`) */
  streakStep: 0.0011,
  streakCap: 50,
  /** kills this close together (s, game time) chain into a multi-kill… */
  multiWindow: 0.45,
  /** …and each extra kill in the chain surges this much (chain counted up to `multiCap`) */
  multiSurge: 0.012,
  multiCap: 8,
  /** streaks of 10, 25, 50, 100… pour this in at once */
  milestone: 0.06,
  /** alpha kills count this many times over */
  alpha: 4,
  /** a boss put down */
  boss: 0.25,
  /** style: trick score → soul (a 600-point trick ≈ 0.04) */
  style: 1 / 15000,
  graze: 0.0012,
} as const;

export class Ultimate {
  active = false;
  avatar: RigInstance | null = null;
  variant: UltVariant = 'wrath';
  /** size of the last kill chain (2 = double, 3 = triple…), for HUD flair */
  multiKill = 0;
  private multiT = -99;
  /** another hero's ultimate (Mark: Mr. Moonlight) runs in place of Serket's */
  hero: HeroUlt | null = null;

  constructor(private ctx: Ctx, private player: Player, private qte: Qte, private cam: CameraRig) {}

  /** pour soul into the jar (scaled by the ultCharge stat); ignored while the ultimate runs */
  addSoul(v: number) {
    if (this.active || v <= 0) return;
    const run = this.ctx.run;
    run.ultCharge = Math.min(1, run.ultCharge + v * this.player.stats.get('ultCharge'));
  }

  /** a kill; `streak` is the kill streak including this kill (run.combo) */
  chargeKill(streak: number, alpha = false) {
    const now = this.ctx.run.time;
    this.multiKill = now - this.multiT <= SOUL.multiWindow ? this.multiKill + 1 : 1;
    this.multiT = now;
    let g = SOUL.kill + SOUL.streakStep * Math.min(Math.max(0, streak - 1), SOUL.streakCap);
    if (this.multiKill > 1) g += SOUL.multiSurge * Math.min(this.multiKill - 1, SOUL.multiCap);
    if (streak === 10 || streak === 25 || (streak >= 50 && streak % 50 === 0)) g += SOUL.milestone;
    this.addSoul(alpha ? g * SOUL.alpha : g);
  }

  /** a landed trick (its style score) */
  chargeStyle(score: number) {
    this.addSoul(Math.max(0, score) * SOUL.style);
  }

  /** a bullet grazed past */
  chargeGraze() {
    this.addSoul(SOUL.graze);
  }

  /** a boss went down */
  chargeBoss() {
    this.addSoul(SOUL.boss);
  }

  private ensureAvatar() {
    if (this.avatar) return this.avatar;
    const e = modelEntry('serket_avatar') ?? modelEntry('serketAvatar');
    const spec = e?.() as RigSpec | undefined;
    if (!spec?.parts) return null;
    this.avatar = new RigInstance(buildRigGeo(spec, 'serket:ult'), { ownMaterial: true });
    this.avatar.material.userData.tint.value.setRGB(0.85, 1, 0.9);
    return this.avatar;
  }

  /** cluster center with the most enemies around */
  private bestTarget(maxD = 40): THREE.Vector3 | null {
    const list = this.ctx.enemies.list.filter((e) => e.alive && e.pos.distanceTo(this.player.pos) < maxD);
    let best: EnemyLike | null = null, bestN = -1;
    for (const e of list) {
      let n = 0;
      for (const o of list) if (o.pos.distanceTo(e.pos) < 6) n += o.isBoss ? 4 : 1;
      if (n > bestN) {
        bestN = n;
        best = e;
      }
    }
    return best ? best.pos.clone() : null;
  }

  async trigger() {
    if (this.active) return;
    const ctx = this.ctx;
    const eng = ctx.engine;
    this.active = true;
    ctx.run.ultCharge = 0;
    this.player.invuln = 999;
    eng.input.enabled = false;
    eng.letterbox(true, 0.4);
    eng.slowMo(0.08, 20);
    ctx.sfx('ult_activate', null, 1);
    ctx.sfx('quake_rumble', null, 1);
    ctx.shake(0.6);
    this.player.express('angry', 6);
    this.player.playAction('ult', 1.6);
    ctx.events.emit('cutin', (this.hero?.name ?? ULT_INFO[this.variant].name).toUpperCase(), this.hero ? '#cfe2ff' : '#9dff3a', 'angry');
    if (this.hero) await this.hero.run();
    else if (this.variant === 'detonation') await this.detonation();
    else if (this.variant === 'plague') await this.plague();
    else await this.wrath();
    eng.slowMo(1, 5);
    eng.letterbox(false, 0.5);
    this.cam.setCine(null);
    eng.input.enabled = true;
    this.player.invuln = 1.2;
    this.active = false;
  }

  private async wrath() {
    const ctx = this.ctx;
    const eng = ctx.engine;
    const p = this.player.pos.clone();
    const back = new THREE.Vector3(-Math.sin(this.cam.yaw), 0, -Math.cos(this.cam.yaw));
    const base = p.clone().addScaledVector(back, 6);
    base.y = ctx.world.groundAt(base.x, base.z);
    // ground splits
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.fx.sandBurst({ x: base.x + Math.cos(a) * 4, y: base.y, z: base.z + Math.sin(a) * 4 }, 1.2);
    }
    ctx.events.emit('groundMark', base.x, base.z, 5, 1);
    ctx.fx.dust({ x: base.x, y: base.y + 1, z: base.z }, 4, P.sand0, 10);
    const av = this.ensureAvatar();
    const holder = new THREE.Group();
    holder.position.copy(base);
    holder.rotation.y = this.cam.yaw;
    ctx.scene.add(holder);
    if (av) {
      holder.add(av.root);
      av.root.scale.setScalar(1);
    }
    // camera: low dramatic shot
    const camPos = p.clone().addScaledVector(back, -7).add(new THREE.Vector3(Math.cos(this.cam.yaw) * 6, 2.5, -Math.sin(this.cam.yaw) * 6));
    this.cam.setCine({ pos: camPos, look: base.clone().add(new THREE.Vector3(0, 6, 0)), fov: 62 });
    // rise
    await eng.tweens.tween(1.3, (k) => {
      holder.position.y = base.y - 9 * (1 - k);
      if (av) av.material.userData.fx.value.y = 0;
    }, Ease.outBack, true);
    ctx.sfx('spectral_scorpion', base, 1);
    ctx.sfx('boss_roar', base, 0.6, 0.7);
    ctx.shake(0.8);
    // three strikes
    const strikes: QteResult[] = [];
    for (let s = 0; s < 3; s++) {
      const target = this.bestTarget() ?? p.clone().add(new THREE.Vector3(rnd.next() * 16 - 8, 0, rnd.next() * 16 - 8));
      target.y = ctx.world.groundAt(target.x, target.z);
      this.cam.setCine({ pos: target.clone().add(new THREE.Vector3(Math.sin(this.cam.yaw + 0.6) * -12, 7, Math.cos(this.cam.yaw + 0.6) * -12)), look: target.clone().add(new THREE.Vector3(0, 1, 0)), fov: 55 });
      ctx.fx.ring({ x: target.x, y: target.y + 0.2, z: target.z }, P.serket, 12, 1.2);
      // aim the avatar
      holder.lookAt(target.x, holder.position.y, target.z);
      if (av?.nodes['tail1']) for (let k = 1; k <= 5; k++) av.nodes['tail' + k] && (av.nodes['tail' + k].rotation.x = -0.6);
      const r = await this.qte.run({ kind: 'ring', key: 'KeyZ', label: `STRIKE ${s + 1}/3`, duration: 1.05 - s * 0.12 });
      strikes.push(r);
      // strike
      if (av?.nodes['tail1']) for (let k = 1; k <= 5; k++) av.nodes['tail' + k] && (av.nodes['tail' + k].rotation.x = 0.4);
      const mult = r === 'perfect' ? 1.7 : r === 'good' ? 1 : 0.4;
      const radius = r === 'perfect' ? 8 : 6;
      ctx.fx.explosion({ x: target.x, y: target.y + 0.5, z: target.z }, radius * 0.6, r === 'perfect' ? 'poison' : 'fire');
      ctx.sfx('explosion_big', target, 1);
      ctx.sfx('scorpion_sting', target, 1, 0.6);
      ctx.shake(0.7);
      eng.hitStop(0.08);
      ctx.world.deform(target.x, target.z, radius * 0.5, 1.2);
      ctx.events.emit('groundMark', target.x, target.z, radius, 3);
      ctx.enemies.inRadius(target, radius, (e) => {
        const det = r === 'perfect' ? (e as any).status?.stacks?.('poison') ?? 0 : 0;
        ctx.enemies.damage(e, { base: 110 * mult + det * 9, kind: 'magic', source: 'ult', knock: 12, canCrit: true, forceCrit: r === 'perfect', status: [{ id: 'poison', stacks: 8, dur: 6, power: 2.5 }, { id: 'stun', stacks: 1, dur: 1 }] });
      });
      if (r === 'perfect') ctx.toast('VENOM DETONATION', '#9dff3a');
      await eng.tweens.wait(0.25, true);
    }
    const perfects = strikes.filter((x) => x === 'perfect').length;
    if (perfects === 3) {
      ctx.toast("SERKET'S BLESSING", '#ffd36b', 'Flawless — ultimate refunds 35%', true);
      ctx.run.ultCharge = 0.35;
    }
    // finale sweep + sink
    ctx.fx.ring({ x: base.x, y: base.y + 0.3, z: base.z }, P.sand0, 30, 0.8);
    ctx.sfx('whoosh_big', base, 1);
    ctx.enemies.inRadius(base, 14, (e) => ctx.enemies.damage(e, { base: 40, kind: 'magic', source: 'ult', knock: 16, canCrit: true }));
    await eng.tweens.tween(0.9, (k) => {
      holder.position.y = base.y - 10 * k;
      if (av) av.material.userData.fx.value.y = k;
    }, Ease.inQuad, true);
    holder.removeFromParent();
    if (av) av.material.userData.fx.value.y = 0;
  }

  private async detonation() {
    const ctx = this.ctx;
    const eng = ctx.engine;
    const r = await this.qte.run({ kind: 'ring', key: 'KeyZ', label: 'DETONATE', duration: 1.1 });
    const mult = r === 'perfect' ? 1.8 : r === 'good' ? 1.2 : 0.7;
    let n = 0;
    for (const e of ctx.enemies.list) {
      const st = (e as any).status?.stacks?.('poison') ?? 0;
      if (!e.alive || st <= 0) continue;
      const delay = 0.04 * n++;
      eng.tweens.after(delay, () => {
        if (!e.alive) return;
        ctx.fx.explosion({ x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z }, 1.6, 'poison');
        ctx.enemies.damage(e, { base: 30 + st * 12 * mult, kind: 'magic', source: 'ult', canCrit: true });
      }, true);
    }
    ctx.sfx('poison_burst', null, 1);
    await eng.tweens.wait(0.4 + n * 0.04, true);
  }

  private async plague() {
    const ctx = this.ctx;
    const eng = ctx.engine;
    const r = await this.qte.run({ kind: 'mash', key: 'KeyZ', label: 'SUMMON THE PLAGUE', duration: 1.8, target: 12 });
    const dur = r === 'perfect' ? 10 : r === 'good' ? 8 : 5;
    eng.slowMo(1, 5);
    eng.letterbox(false, 0.3);
    eng.input.enabled = true;
    ctx.events.emit('plague', dur);
    const t0 = performance.now();
    while (performance.now() - t0 < dur * 1000) {
      ctx.enemies.inRadius(this.player.pos, 12, (e) => ctx.enemies.damage(e, { base: 6, kind: 'magic', source: 'swarm', status: [{ id: 'bleed', stacks: 1, dur: 2 }, { id: 'poison', stacks: 1, dur: 3, power: 2 }], canCrit: false }));
      ctx.particles.emit({ pos: this.player.center(new THREE.Vector3()), count: 30, spread: 10, up: 2, life: [0.4, 0.8], size: [0.12, 0.12], sprite: ['fly0', 'locust'], color: 0xffffff, drag: 1, jitter: 6 });
      await eng.tweens.wait(0.25, true);
    }
  }
}
