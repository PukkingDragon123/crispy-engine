// Trail encounters between waves: a notice drops in with a little story and
// three choices. Small, flavorful trade-offs (no altars — just outlaws,
// strangers and one very nosy scorpion).
import type { Ctx } from '../Ctx';
import type { Player } from '../player/Player';
import type { Choice, ChoiceOption } from '../ui/Choice';
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
  options: (ChoiceOption & { run(d: EventDeps): void })[];
}

const perm = (d: EventDeps, stat: any, type: 'flat' | 'pct', value: number, source: string) => d.player.stats.add([{ stat, type, value, source }]);

const EVENTS: TrailEvent[] = [
  {
    id: 'stranger',
    heading: 'A Thirsty Stranger',
    options: [
      { title: 'Share your canteen', body: 'He drinks, nods, and presses a lucky horseshoe into your hand.', footer: '-15% health · +2 Luck', run: (d) => { d.player.applyDamage(d.player.maxHp * 0.15, 'event', true); perm(d, 'luck', 'flat', 2, 'horseshoe'); d.ctx.toast('LUCKY HORSESHOE', '#9dff3a', '+2 Luck'); } },
      { title: 'Point to the oasis', body: '"That way, friend." He wanders off. Nothing gained, nothing lost.', footer: 'Ride on', run: () => {} },
      { title: 'Rob him', body: 'His purse is heavy. His curse is heavier.', footer: '+45 gold · Cursed', run: (d) => { d.ctx.run.gold += 45; d.ctx.run.totalGold += 45; d.player.status.apply('curse', 4, 25, 1, 10, {}); d.ctx.toast('CURSED', '#c77df0', 'Your bones feel heavier'); } },
    ],
  },
  {
    id: 'snakeoil',
    heading: "Doc Hapi's Traveling Tonics",
    options: [
      { title: 'Buy a mystery tonic', body: '"Cures what ails ya, and some things that don\'t."', footer: '30 gold · random boon (probably)', run: (d) => {
        if (d.ctx.run.gold < 30) { d.ctx.toast('NOT ENOUGH GOLD', '#ff8a6a'); return; }
        d.ctx.run.gold -= 30;
        const r = rnd.next();
        if (r < 0.35) { perm(d, 'fireRate', 'pct', 0.08, 'tonic'); d.ctx.toast('QUICK-DRAW TONIC', '#9dff3a', '+8% fire rate'); }
        else if (r < 0.7) { perm(d, 'maxHp', 'flat', 20, 'tonic'); d.player.heal(20); d.ctx.toast('IRON-BONE TONIC', '#9dff3a', '+20 max health'); }
        else if (r < 0.9) { perm(d, 'moveSpeed', 'pct', 0.06, 'tonic'); d.ctx.toast('JACKRABBIT TONIC', '#9dff3a', '+6% speed'); }
        else { d.player.status.apply('poison', 6, 6, 1, 30, {}); d.ctx.toast('…THAT WAS CACTUS JUICE', '#ff8a6a', 'Poisoned'); }
      } },
      { title: 'Arrest the quack', body: 'There\'s a bounty on fraud. A small one.', footer: '+35 bounty', run: (d) => d.addBounty(35) },
      { title: 'Tip your hat', body: 'You leave him to his customers. Both of them.', footer: 'Ride on', run: () => {} },
    ],
  },
  {
    id: 'deputy',
    heading: 'A Wounded Deputy',
    options: [
      { title: 'Patch him up', body: 'He swears he\'ll put in a good word with the Sheriff.', footer: '-10% health · upgrade card', run: (d) => { d.player.applyDamage(d.player.maxHp * 0.1, 'event', true); d.card(); } },
      { title: 'Take his badge', body: 'Tin is tin. It stops bullets, sometimes.', footer: '+12 armor · -10% bounty gain', run: (d) => { perm(d, 'armor', 'flat', 12, 'stolen badge'); perm(d, 'bountyGain', 'pct', -0.1, 'stolen badge'); d.ctx.toast('STOLEN BADGE', '#c9a97c', '+12 armor'); } },
      { title: 'Leave him be', body: 'Someone else will find him. Probably vultures.', footer: 'Ride on', run: () => {} },
    ],
  },
  {
    id: 'pinch',
    heading: 'Pinch Found Something',
    options: [
      { title: 'Let him dig', body: 'Click click click. Something is definitely down there.', footer: 'Treasure… or trouble', run: (d) => {
        const r = rnd.next();
        if (r < 0.45) { d.chest(rnd.chance(0.3) ? 'silver' : 'wood'); d.ctx.toast('PINCH STRUCK GOLD', '#ffd36b'); }
        else if (r < 0.75) { d.ctx.run.gold += 25; d.ctx.toast('A BURIED PURSE', '#ffd36b', '+25 gold'); }
        else { d.ambush('scarab', 8); d.ctx.toast('A SCARAB NEST!', '#ff6a3a', 'Pinch regrets nothing'); }
      } },
      { title: 'Pull him away', body: 'He sulks on your shoulder for a whole minute.', footer: 'Ride on', run: (d) => d.player.express('smug', 1) },
      { title: 'Dig with him', body: 'Teamwork. The sand gets everywhere.', footer: 'Treasure · ambush likely', run: (d) => { d.chest('silver'); d.ambush('husk', 6); } },
    ],
  },
  {
    id: 'gambler',
    heading: 'The Coin-Flip Kid',
    options: [
      { title: 'Call heads', body: '"Double or nothing, bone man."', footer: 'Bet half your gold', run: (d) => {
        const bet = Math.floor(d.ctx.run.gold / 2);
        const win = rnd.chance(0.5);
        d.ctx.run.gold += win ? bet : -bet;
        d.ctx.toast(win ? 'HEADS!' : 'TAILS…', win ? '#9dff3a' : '#ff6a3a', win ? `+${bet} gold` : `-${bet} gold`);
      } },
      { title: 'Shoot the coin', body: 'Mid-air. Showing off is its own reward.', footer: '+3% crit chance', run: (d) => { perm(d, 'critChance', 'flat', 0.03, 'trick shot'); d.ctx.toast('TRICK SHOT', '#ffd36b', '+3% crit chance'); } },
      { title: 'Walk away', body: 'Smart. Boring, but smart.', footer: 'Ride on', run: () => {} },
    ],
  },
];

export class TrailEvents {
  private used = new Set<string>();
  constructor(private d: EventDeps) {}
  /** maybe roll an encounter after a wave */
  async maybe(wave: number) {
    if (wave < 3 || wave % 5 === 0 || !rnd.chance(0.35)) return;
    const pool = EVENTS.filter((e) => !this.used.has(e.id));
    if (!pool.length) return;
    const ev = rnd.pick(pool);
    this.used.add(ev.id);
    const i = await this.d.choice.show(ev.heading, ev.options, false);
    ev.options[Math.max(0, i)].run(this.d);
  }
}
