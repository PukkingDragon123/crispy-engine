// Trail encounters between waves, staged as little scenes in the desert: the
// stranger, Doc Hapi, the wounded deputy, the coin-flip kid, Pinch at a dig and
// an outlaw ambush that opens by blowing a wagon to splinters. The people are
// rigged NPCs that talk (typed 3D words + their voices), and the three choices
// are things in the scene - the canteen he begs for, the tin star, gold, words
// scratched into the sand (cine/Stage.ts via Choice.stage()). Small, flavorful
// trade-offs.
import type { Ctx } from '../Ctx';
import type { Player } from '../player/Player';
import type { Choice, ChoiceOption } from '../ui/Choice';
import type { StageSpec } from '../cine/Stage';
import { npcLook } from './TravelerEscort';
import { rnd } from '../../engine/math/rand';

export interface EventDeps {
  ctx: Ctx;
  player: Player;
  choice: Choice;
  card(): void;
  chest(tier: 'wood' | 'silver' | 'gold'): void;
  ambush(kind: string, n: number): void;
  addBounty(v: number): void;
}

interface TrailEvent {
  id: string;
  heading: string;
  /** earliest wave it can show up on */
  minWave?: number;
  stage(d: EventDeps): StageSpec;
  options: (ChoiceOption & { run(d: EventDeps): void })[];
}

const perm = (d: EventDeps, stat: any, type: 'flat' | 'pct', value: number, source: string) => d.player.stats.add([{ stat, type, value, source }]);

/** swap the staged outlaws for real ones, standing where the actors stood */
function outlawsAttack(d: EventDeps, extra = 0) {
  const spots = d.choice.stageActors();
  d.choice.dismissActors();
  const en = d.ctx.enemies as unknown as { spawn?: (kind: string, x: number, z: number, o?: object) => unknown };
  let n = 0;
  if (en.spawn)
    for (const p of spots) {
      try {
        en.spawn('outlaw', p.x, p.z, { emerge: 'run' });
        n++;
      } catch (e) {
        console.warn('[trail] outlaw spawn failed', e);
      }
    }
  const missing = spots.length - n + extra;
  if (missing > 0) d.ambush('outlaw', missing);
}

const EVENTS: TrailEvent[] = [
  {
    id: 'stranger',
    heading: 'A Thirsty Stranger',
    stage: (d) => ({
      actors: [{ rig: npcLook(d.player, ['cowboy_stetson_poncho', 'cowboy_sombrero_poncho', 'cowboy_stetson_duster']), mode: 'idle', voice: 'prospector' }],
      props: [{ key: 'skull_cow', at: [1.5, -0.5], yaw: 0.8 }, { key: 'dry_bush_1', at: [-1.8, -1.1] }],
      presenter: 'items',
      lines: [{ text: 'Water... friend. Just a mouthful. The sun took my horse, my hat and my good sense.' }],
      replies: [{ text: 'Bless your bones. Take this - it never once let me down.' }, { text: 'The oasis. Sure. Sure. Which way is that again?' }, { text: 'May the sand fill your sockets, thief.' }],
      after: ['tip', 'wave', 'cower'],
    }),
    options: [
      { title: 'Share your canteen', prop: 'canteen', body: 'He drinks, nods, and presses a lucky horseshoe into your hand.', footer: '-15% health · +2 Luck', run: (d) => { d.player.applyDamage(d.player.maxHp * 0.15, 'event', true); perm(d, 'luck', 'flat', 2, 'horseshoe'); d.ctx.toast('LUCKY HORSESHOE', '#9dff3a', '+2 Luck'); } },
      { title: 'Point to the oasis', mark: 'OASIS', body: '"That way, friend." He wanders off. Nothing gained, nothing lost.', footer: 'Ride on', run: () => {} },
      { title: 'Rob him', prop: 'gold_coin', body: 'His purse is heavy. His curse is heavier.', footer: '+45 gold · Cursed', run: (d) => { d.ctx.run.gold += 45; d.ctx.run.totalGold += 45; d.player.status.apply('curse', 4, 25, 1, 10, {}); d.ctx.toast('CURSED', '#c77df0', 'Your bones feel heavier'); } },
    ],
  },
  {
    id: 'snakeoil',
    heading: "Doc Hapi's Traveling Tonics",
    stage: (d) => ({
      actors: [{ rig: npcLook(d.player, ['cowboy_tophat_vest', 'cowboy_tophat_duster', 'cowboy_tophat_punk']), mode: 'idle', voice: 'peddler' }],
      props: [{ key: 'crate_stack_1', at: [-1.8, -0.7], yaw: 0.4 }, { key: 'barrel_1', at: [1.6, -0.8] }],
      presenter: 'items',
      lines: [{ text: "Step right up! Doc Hapi's Tonics cure the gout, the grippe and the Curse of Set!" }, { who: 'sundown', text: "I'm mostly bones, Doc." }, { text: 'Then you need it twice as bad!' }],
      replies: [{ text: 'A wise investment, sir! Strictly no refunds.' }, { text: "Now, now, officer! There's been a terrible misunderstanding!" }, { text: 'Good day! Tell your friends. Tell your bones.' }],
      after: ['cheer', 'cower', 'tip'],
    }),
    options: [
      { title: 'Buy a mystery tonic', prop: 'item_snakeoil', body: '"Cures what ails ya, and some things that don\'t."', footer: '30 gold · random boon (probably)', run: (d) => {
        if (d.ctx.run.gold < 30) { d.ctx.toast('NOT ENOUGH GOLD', '#ff8a6a'); return; }
        d.ctx.run.gold -= 30;
        const r = rnd.next();
        if (r < 0.35) { perm(d, 'fireRate', 'pct', 0.08, 'tonic'); d.ctx.toast('QUICK-DRAW TONIC', '#9dff3a', '+8% fire rate'); }
        else if (r < 0.7) { perm(d, 'maxHp', 'flat', 20, 'tonic'); d.player.heal(20); d.ctx.toast('IRON-BONE TONIC', '#9dff3a', '+20 max health'); }
        else if (r < 0.9) { perm(d, 'moveSpeed', 'pct', 0.06, 'tonic'); d.ctx.toast('JACKRABBIT TONIC', '#9dff3a', '+6% speed'); }
        else { d.player.status.apply('poison', 6, 6, 1, 30, {}); d.ctx.toast('…THAT WAS CACTUS JUICE', '#ff8a6a', 'Poisoned'); }
      } },
      { title: 'Arrest the quack', prop: 'item_star', body: 'There\'s a bounty on fraud. A small one.', footer: '+35 bounty', run: (d) => d.addBounty(35) },
      { title: 'Tip your hat', mark: 'TIP', body: 'You leave him to his customers. Both of them.', footer: 'Ride on', run: () => {} },
    ],
  },
  {
    id: 'deputy',
    heading: 'A Wounded Deputy',
    stage: (d) => ({
      actors: [{ rig: npcLook(d.player, ['cowboy_stetson_sheriff', 'cowboy_sombrero_sheriff', 'cowboy_bandit_sheriff']), mode: 'sit', voice: 'outlaw' }],
      props: [{ key: 'rock_1', at: [0.1, -0.85] }, { key: 'fence_broken_1', at: [-2.2, -0.6], yaw: 0.5 }],
      presenter: 'items',
      lines: [{ text: "Set's posse... jumped me at the pass. Got any linen on you, stranger?" }],
      replies: [{ text: "Obliged. I'll put in a good word with the Sheriff." }, { text: 'That... is government property.' }, { text: 'Figures. Even the vultures got better manners.' }],
      after: ['sit', 'sit', 'sit'],
    }),
    options: [
      { title: 'Patch him up', prop: 'item_bandage', body: 'He swears he\'ll put in a good word with the Sheriff.', footer: '-10% health · upgrade card', run: (d) => { d.player.applyDamage(d.player.maxHp * 0.1, 'event', true); d.card(); } },
      { title: 'Take his badge', prop: 'item_star', body: 'Tin is tin. It stops bullets, sometimes.', footer: '+12 armor · -10% bounty gain', run: (d) => { perm(d, 'armor', 'flat', 12, 'stolen badge'); perm(d, 'bountyGain', 'pct', -0.1, 'stolen badge'); d.ctx.toast('STOLEN BADGE', '#c9a97c', '+12 armor'); } },
      { title: 'Leave him be', mark: 'LEAVE', body: 'Someone else will find him. Probably vultures.', footer: 'Ride on', run: () => {} },
    ],
  },
  {
    id: 'pinch',
    heading: 'Pinch Found Something',
    stage: () => ({
      dist: 4.6,
      actors: [{ rig: 'pinch', at: [0, -0.2], voice: 'pinch' }],
      props: [{ key: 'dig_mound', at: [0, -0.55] }],
      presenter: 'sand',
      lines: [{ text: '*click click click*  (something is down there!)' }, { who: 'sundown', text: 'Last time it was a nest of scarabs, partner.' }],
      replies: [{ who: 'sundown', text: 'Go on, then.' }, { who: 'sundown', text: 'Not today.' }, { who: 'sundown', text: 'Shove over.' }],
    }),
    options: [
      { title: 'Let him dig', mark: 'DIG', body: 'Click click click. Something is definitely down there.', footer: 'Treasure… or trouble', run: (d) => {
        const r = rnd.next();
        if (r < 0.45) { d.chest(rnd.chance(0.3) ? 'silver' : 'wood'); d.ctx.toast('PINCH STRUCK GOLD', '#ffd36b'); }
        else if (r < 0.75) { d.ctx.run.gold += 25; d.ctx.toast('A BURIED PURSE', '#ffd36b', '+25 gold'); }
        else { d.ambush('scarab', 8); d.ctx.toast('A SCARAB NEST!', '#ff6a3a', 'Pinch regrets nothing'); }
      } },
      { title: 'Pull him away', mark: 'NO', body: 'He sulks on your shoulder for a whole minute.', footer: 'Ride on', run: (d) => d.player.express('smug', 1) },
      { title: 'Dig with him', mark: 'BOTH', body: 'Teamwork. The sand gets everywhere.', footer: 'Treasure · ambush likely', run: (d) => { d.chest('silver'); d.ambush('husk', 6); } },
    ],
  },
  {
    id: 'gambler',
    heading: 'The Coin-Flip Kid',
    stage: (d) => ({
      actors: [{ rig: npcLook(d.player, ['cowboy_bandit_punk', 'cowboy_sombrero_punk', 'cowboy_bandit_vest']), mode: 'idle', voice: 'outlaw' }],
      props: [{ key: 'crate_table_1', at: [-1.7, -0.5], yaw: 0.3 }, { key: 'whiskey_barrel_1', at: [1.7, -0.9] }],
      presenter: 'items',
      lines: [{ text: 'Heads or tails, bone man? Double or nothing. I never lose. Almost never.' }],
      replies: [{ text: "Let's see what the coin says..." }, { text: "Whoa! Nice shootin', mister!" }, { text: 'Chicken bones!' }],
      after: ['idle', 'cheer', 'idle'],
    }),
    options: [
      { title: 'Call heads', prop: 'gold_coin', body: '"Double or nothing, bone man."', footer: 'Bet half your gold', run: (d) => {
        const bet = Math.floor(d.ctx.run.gold / 2);
        const win = rnd.chance(0.5);
        d.ctx.run.gold += win ? bet : -bet;
        d.ctx.toast(win ? 'HEADS!' : 'TAILS…', win ? '#9dff3a' : '#ff6a3a', win ? `+${bet} gold` : `-${bet} gold`);
      } },
      { title: 'Shoot the coin', mark: 'SHOOT', body: 'Mid-air. Showing off is its own reward.', footer: '+3% crit chance', run: (d) => { perm(d, 'critChance', 'flat', 0.03, 'trick shot'); d.ctx.toast('TRICK SHOT', '#ffd36b', '+3% crit chance'); } },
      { title: 'Walk away', mark: 'WALK', body: 'Smart. Boring, but smart.', footer: 'Ride on', run: () => {} },
    ],
  },
  {
    id: 'dynamite',
    heading: 'Dynamite on the Trail',
    minWave: 4,
    stage: () => ({
      dist: 8.5,
      actors: [
        { rig: 'outlaw_rider_v1', at: [-1.5, 0.3], hideBoard: true, voice: 'outlaw', yaw: 0.15 },
        { rig: 'outlaw_rider_v2', at: [1.1, 0.9], hideBoard: true, voice: 'outlaw', yaw: -0.2 },
      ],
      props: [{ key: 'wagon_1', at: [3.6, -1.8], yaw: 1.25, blast: true }, { key: 'barrel_2', at: [-3.2, -1.2] }],
      opener: 'dynamite',
      presenter: 'items',
      lines: [{ text: 'Howdy, skeleton. That wagon was the warm-up.' }, { who: 1, text: 'Your purse, or your skull. Pick quick.' }],
      replies: [{ who: 'sundown', text: 'Skull it is. Yours.' }, { text: "Pleasure doin' business, bones." }, { who: 1, text: 'Hey! That strongbox is OURS!' }],
      after: [null, 'cheer', null],
    }),
    options: [
      { title: 'Draw on them', mark: 'DRAW', body: 'Two of them, one of you. Bad odds - for them.', footer: 'Fight · +60 bounty', run: (d) => { outlawsAttack(d, 1); d.addBounty(60); d.ctx.toast('DRAW!', '#ff6a3a', 'Set\'s posse wants a fight'); } },
      { title: 'Toss your purse', prop: 'gold_coin', body: 'Gold is just heavy sand. They let you ride.', footer: '-30% gold', run: (d) => { const lose = Math.floor(d.ctx.run.gold * 0.3); d.ctx.run.gold -= lose; d.ctx.toast('ROBBED', '#c9a97c', `-${lose} gold`); } },
      { title: 'Loot the strongbox', prop: 'trunk', body: 'While they admire the fire, you crack the wreck\'s strongbox.', footer: 'Silver chest · they open fire', run: (d) => { d.chest('silver'); outlawsAttack(d); } },
    ],
  },
];

export class TrailEvents {
  private used = new Set<string>();
  constructor(private d: EventDeps) {
    (window as any).__trail = this; // dev handle: __trail.play('dynamite')
  }
  /** maybe roll an encounter after a wave */
  async maybe(wave: number) {
    if (wave < 3 || wave % 5 === 0 || !rnd.chance(0.35)) return;
    const pool = EVENTS.filter((e) => !this.used.has(e.id) && wave >= (e.minWave ?? 0));
    if (!pool.length) return;
    await this.run(rnd.pick(pool));
  }
  /** play one encounter now (dev / scripted) */
  async play(id: string) {
    const ev = EVENTS.find((e) => e.id === id);
    if (ev && !this.d.choice.active) await this.run(ev);
  }
  private async run(ev: TrailEvent) {
    this.used.add(ev.id);
    let spec: StageSpec = {};
    try {
      spec = ev.stage(this.d);
    } catch (e) {
      console.warn('[trail] stage failed', e);
    }
    const i = await this.d.choice.stage(spec).show(ev.heading, ev.options, false);
    ev.options[Math.max(0, i)].run(this.d);
  }
}
