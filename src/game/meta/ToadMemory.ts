// Mama Toad remembers him. Every lost ride that ends on her couch is written down here
// (persisted in the save as `toad`): who laid him out, how far he rode, how many nights
// she sat up with him, and which of her old memories she has already told.
// Read it anywhere with `toadMemory.get()` (the NPC quest reads `facts` and `told`);
// the hideout wake-up asks `toadMemory.wakeLines()` for what she says.
import { loadSave, writeSave } from './Save';

export interface ToadDeath {
  /** the name of what killed him (null: the desert itself) */
  killer: string | null;
  boss: boolean;
  wave: number;
  /** the day of the ride he fell on (null until the days system reports one) */
  day: number | null;
  kills: number;
  /** weighings at Anubis' scales that ride */
  deaths: number;
  /** nights he lay on her couch before he woke */
  nights: number;
}

export interface ToadSave {
  v: 1;
  /** times she has nursed him back after a lost ride */
  nursed: number;
  /** nights at his bedside, all told */
  nights: number;
  /** what killed him, and how often */
  killers: Record<string, number>;
  /** the bosses among them */
  bosses: string[];
  /** his farthest ride so far */
  best: { wave: number; day: number };
  last: ToadDeath | null;
  /** her memories already told (ids, see MEMORIES) */
  told: string[];
  /** free facts other systems keep with her (quests, gifts): read and write through `fact()` */
  facts: Record<string, number | string | boolean>;
}

function fresh(): ToadSave {
  return { v: 1, nursed: 0, nights: 0, killers: {}, bosses: [], best: { wave: 0, day: 0 }, last: null, told: [], facts: {} };
}

function mem(): ToadSave {
  const s = loadSave() as any;
  if (!s.toad || s.toad.v !== 1) s.toad = fresh();
  const t = s.toad as ToadSave;
  t.killers ??= {};
  t.bosses ??= [];
  t.told ??= [];
  t.facts ??= {};
  t.best ??= { wave: 0, day: 0 };
  return t;
}

/** "the Dust Marshal", "a husk" */
function the(name: string, boss: boolean) {
  if (/^(the|a|an)\s/i.test(name)) return name.replace(/^The /, 'the ');
  return boss ? 'the ' + name : (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name;
}
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const num = (n: number) => NUM[n] ?? String(n);
const pick = <T,>(a: T[], seed: number) => a[Math.abs(Math.floor(seed)) % a.length];

/** her old memories of him, opened up as the visits pile up (`at`: nursed count needed) */
const MEMORIES: { id: string; at: number; text: string }[] = [
  { id: 'coatrack', at: 1, text: 'First time the sand brought you home, all bones and a hat, I near hung my shawl on you. Thought you were a coat rack.' },
  { id: 'soup', at: 1, text: "You wouldn't take my soup that first week. Said skeletons don't eat. Then you ate four bowls." },
  { id: 'tail', at: 2, text: 'You used to sleep curled up with your tail over your nose. Like a little cat. A bony little cat.' },
  { id: 'hat', at: 2, text: "You never once took that hat off. Not to sleep, not to eat. I've stopped asking." },
  { id: 'pinch', at: 3, text: 'Pinch sat on your chest the whole time you were out. Wouldn\'t eat. Wouldn\'t click. Just watched you breathe.' },
  { id: 'song', at: 3, text: 'I sang you the swamp song while you slept. The one my mama sang me. You hummed the low part.' },
  { id: 'scarf', at: 4, text: "I've knit you nine scarves now, one for every time I sat up with you. They're in the chest. Don't count them." },
  { id: 'door', at: 4, text: 'I leave the lamp in the window every night you ride. So the sand knows where to bring you.' },
  { id: 'name', at: 5, text: 'You talk in your sleep, you know. Same word, over and over. I never can make it out. Sounds like a name.' },
  { id: 'kin', at: 6, text: "Folks out there threw you away once. Well. Their loss. You've got a mama now, and she's a toad. Deal with it." },
];

export const toadMemory = {
  /** everything she remembers (read-only use: write through the methods) */
  get(): Readonly<ToadSave> {
    return mem();
  },

  /** a lost ride: what killed him and how far he got (the death cinematic records it) */
  recordDeath(d: ToadDeath) {
    const t = mem();
    const prevBest = { ...t.best };
    t.nursed++;
    t.nights += d.nights;
    if (d.killer) {
      t.killers[d.killer] = (t.killers[d.killer] ?? 0) + 1;
      if (d.boss && !t.bosses.includes(d.killer)) t.bosses.push(d.killer);
    }
    t.best = { wave: Math.max(prevBest.wave, d.wave), day: Math.max(prevBest.day, d.day ?? 0) };
    t.last = { ...d };
    t.facts['prevBestWave'] = prevBest.wave;
    t.facts['prevBestDay'] = prevBest.day;
    writeSave();
    return t;
  },

  /** set or read a fact she keeps (other systems: quests, gifts) */
  fact(key: string, value?: number | string | boolean) {
    const t = mem();
    if (value !== undefined) {
      t.facts[key] = value;
      writeSave();
    }
    return t.facts[key];
  },

  /** a memory told: it will not come round again until she has told them all */
  tell(id: string) {
    const t = mem();
    if (!t.told.includes(id)) t.told.push(id);
    writeSave();
  },

  /**
   * What she says when he wakes on her couch, in order:
   *   asleep: murmured over him before he stirs;
   *   days:   the first thing once he is up (the nights she sat up);
   *   after:  the rest, as he gets his feet under him (his killer, his ride, a memory).
   */
  wakeLines(): { asleep: string; days: string; after: string[] } {
    const t = mem();
    const d = t.last;
    const n = t.nursed;
    const seed = n * 7 + (d?.wave ?? 0) * 3;
    const nights = d?.nights ?? 2;
    const first = n <= 1;
    const asleep = first
      ? 'Hush now. You are in my hideout, on my good couch. Mama Toad has you.'
      : pick(['There he is. Breathe, sugar. Mama has you.', 'Shh. Just the fire crackling, honey. Sleep a little more.', `${num(nights)} nights and you still snore like my kettle.`, 'Easy, easy. That poultice stings because it is working.'], seed);
    const days = first
      ? `${num(nights)} days you lay there, sugar. The sand brought you to my door, so I guess you are mine now.`
      : pick([`${num(nights)} days you were gone, sugar. I sat right here for every one of them.`, `${num(nights)} nights I kept that lamp lit. ${n === 2 ? 'Second' : n === 3 ? 'Third' : 'Again'} time the sand brought you home.`, `${num(nights)} days asleep. I counted them on my knitting. That is ${num(nights)} rows.`], seed + 1);
    const after: string[] = [];
    if (d?.killer) {
      const k = the(d.killer, d.boss);
      const times = t.killers[d.killer] ?? 1;
      if (d.boss) after.push(times > 1 ? `${cap(k)} again? That makes ${num(times)} times. You stop going at it head on, you hear me?` : `You went and took on ${k} all by yourself? With that hat? Lord.`);
      else after.push(times > 2 ? `${cap(k)}. ${cap(num(times))} times now. That one has your number, dear. Watch its hands.` : times > 1 ? `Was it ${k} again? I know that look.` : `Pinch says it was ${k} that laid you out. A little one, he says. He is lying, isn't he.`);
    } else after.push('The desert took you all on its own this time. Drink more water, honey.');
    if (d) {
      const prevDay = Number(t.facts['prevBestDay'] ?? 0), prevWave = Number(t.facts['prevBestWave'] ?? 0);
      if (d.day) after.push(d.day > prevDay && !first ? `Day ${d.day}, though. Farthest you ever rode. I am so proud I could croak.` : `You made it to day ${d.day} out there. ${d.day < prevDay ? 'You have done better. You will again.' : 'Not bad for a bag of bones.'}`);
      else after.push(d.wave > prevWave && !first ? `Wave ${d.wave}. Farthest you ever rode, honey. I am so proud I could croak.` : `${d.wave} waves of them, and you sent ${d.kills} on ahead. ${d.wave < prevWave ? 'You have done better. You will again.' : 'Not bad for a bag of bones.'}`);
      if (d.deaths >= 3) after.push(`The jackal weighed you ${num(d.deaths)} times that ride. Your heart is getting heavy, dear. I can hear it in your chest.`);
    }
    // one memory, the oldest she has not told yet (round again once all are told)
    const open = MEMORIES.filter((m) => m.at <= n);
    let m = open.find((x) => !t.told.includes(x.id));
    if (!m && open.length) {
      t.told = [];
      m = open[seed % open.length];
    }
    if (m) {
      after.push(m.text);
      toadMemory.tell(m.id);
    }
    if (n > 1) after.push(pick(['Now eat something before you ride out and do it all again.', 'Go on, then. Warm your bones by the fire.', 'And wipe your boots. You tracked half the Duat in here.'], seed + 2));
    return { asleep, days, after };
  },
};

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
