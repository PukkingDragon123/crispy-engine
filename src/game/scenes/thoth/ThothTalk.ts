// What Thoth says in his Hall. He is ten thousand and three years old and talks like a
// small, delighted child: short sentences, lots of "look, look!", tiny confessions.
import { Codex, F_READ, F_SEEN, type CodexCat, type CodexEntry } from '../../meta/Codex';
import { LEDGER } from '../../meta/Lore';

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export const TALK = {
  hello: [
    "Hi! Hi! You came back! I'm ten thousand and three, you know. And a half!",
    "I'm ten thousand and three! Look, look, a beetle! Oh. It's a raisin.",
    'Welcome to my hall! I collect EVERYTHING. Look at my jars!',
    'Shhh, the bookworms are working. Okay, I am done shhh-ing. HI!',
    'You smell like sand and adventures. Did you bring me something?',
  ],
  coming: ['Wait for me! I am coming! My legs are very short!', 'One second! I am finding my other sandal!', 'Coming, coming! Do not touch the jars!'],
  helloMenu: [
    "You found my hall! It is the best hall. I'm ten thousand and three!",
    'Come in, come in! Wipe your bones on the mat!',
  ],
  wing: {
    bounty: ['These are the bad ones. I keep them in jars so they cannot be rude.', 'Bounties! Some of them still growl at night. I sing to them.'],
    boss: ['The BIG bad ones! I made them small. It is a trick. Do not tell them.', 'Bosses! I had to stand on my stool to put the lids on.'],
    wildlife: ['The nice ones! The meerkats sing for me sometimes. Badly.', 'Critters! I want a hippo calf SO much. Just a little one.'],
    loot: ['Shiny things! I like the shiny things best. Do not tell the books.', 'Treasure and stuff! Everything in here is mine. Well. Ours.'],
    blueprint: ['Plans and drawings! I drew some of them. The good ones.', 'Look at all the lines! So straight! I cannot draw straight. I am a bird.'],
    place: ['Every place in the Reach, in a little jar! The sand gets everywhere.', 'Places! I do not go outside. Outside has weather.'],
    legend: ['The gods and the friends. Khonsu is my best friend. Do not tell Ra.', 'Legends! I knew all of them when they were babies. Well, most.'],
  } as Record<CodexCat, string[]>,
  seen: {
    bounty: ['Ooh, a {name}! It bit me once. Well, it bit the jar.', 'I counted its teeth! There are lots. I lost count. Twice.', 'A {name}! Do not tap the glass. It hates that. I tap it anyway.'],
    boss: ['{name}! Is it not SO big? Well, it was. Now it is pocket size.', 'Careful, {name} is grumpy. I gave it a sticker. Still grumpy.'],
    wildlife: ['A {name}! Can I keep it? I already kept it. Look!', 'The {name}! It is my favourite. They are all my favourite.'],
    loot: ['{name}! Can I hold it? Just for a second? Okay, I am holding it.', 'Ooh, {name}. Shiny. I licked it. Do not lick it.'],
    blueprint: ['{name}! I measured it with my beak. It is eleven beaks long.', 'Look at the little numbers on the plan! I love little numbers.'],
    place: ['{name}! I have never been. I do not go out. Outside has weather.', 'Is {name} real? Of course it is real. It is in a jar!'],
    legend: ['{name}! A real legend! I have their autograph. Somewhere.'],
  } as Record<CodexCat, string[]>,
  legend: {
    sundown: 'That is YOU! You look very bony in this one. Very handsome bones.',
    pinch: 'Pinch! She pinched me. Shh. I know who she REALLY is. She knows I know. We do not talk about it.',
    mamaToad: 'Mama Toad makes the best soup. I am not allowed soup after bedtime.',
    serket: 'Serket is very nice and very scary. Like a cactus with a hug.',
    anubis: 'Anubis weighed my heart once! It was light as a feather. I won!',
    khonsu: 'Khonsu! My best friend! He is the moon on Tuesdays. I am the moon the other days.',
    thoth: "That's ME! I look very handsome. And very old. Ten thousand and three!",
    khepri: 'Khepri rolls the sun every morning. He is never late. I am always late.',
    set: 'Set is grumpy. He is always grumpy. I gave him a hug once. Grumpier.',
    ozymandias: 'Mister Ozymandias sells everything. He sold me a rock. It is a good rock.',
    // the pages of Sundown's Ledger
    lastBounty: 'This is the saddest page. I drew a little sun in the corner so it is less sad.',
    ironJaw: 'You learned to talk through a bear trap! I tried talking through a teapot. It did not work.',
    blackStinger: 'Aqrab was SO big. He let me ride on his tail once. Yours is smaller. Can I ride it anyway? No? Okay.',
    lastBrood: 'The little scorpion on the sarcophagus! She was the size of a raisin. Then she was a GODDESS. Eep.',
    soulDebt: 'I read the number Anubis wrote. I had to sit down. I am still a little bit sitting down.',
    starThatRusts: 'The marshal was mean. I put his page next to the vinegar. Hmph.',
    godsWork: 'I wrote the Treaty! With my best pen. Set read it VERY carefully. Too carefully.',
    scribe: 'That is my page about you! I know your real name, you know. It starts with... NO. Not telling!',
    borrowedNights: 'I won five days off Khonsu at senet! He says I cheated. I did not cheat. I am just very good.',
    moonCat: 'Mark never talks! I told him a joke once. He blinked. I think that is cat for laughing.',
    sunsDaughter: 'Cleopatra is SO shiny. Do not look under the veil. I looked once. My feathers went crispy.',
    theBurning: 'Ra wants it to be noon forever. Then when is bedtime? Exactly. Terrible plan.',
    lastPage: 'It is empty because it is YOURS. Write something nice. Use your best handwriting!',
  } as Record<string, string>,
  /** a fresh Ledger page waiting to be read: his hello is about it */
  loreHello: {
    lastBounty: 'I started your Ledger! Page one! It is about how you... oh. Maybe read it sitting down.',
    ironJaw: 'New page! It is about your jaw! Clack clack! Sorry. Clack.',
    blackStinger: 'I wrote about the tomb in the Weeping Wall! The doors went BOOM and the little scorpion stood up! Eep!',
    lastBrood: 'New page! About Pinch! Who is Serket! Who rides in your HAT! Go look, go look!',
    soulDebt: 'I wrote down your debt. Do not read the number before bedtime.',
    starThatRusts: 'You met the marshal! I wrote it all down. I used my angry pen.',
    godsWork: 'New page! It is about the Treaty. I wrote the Treaty! Did I say that already? I wrote it!',
    scribe: 'You came! I wrote a page about you! Just one so far. Well. Lots. But one is about you.',
    borrowedNights: 'You met the moon! Did Khonsu say anything about me? Did he? He is a sore loser.',
    moonCat: 'Mark is free! Mark is FREE! I wrote it down in glitter. Glitter is very hard to write with.',
    sunsDaughter: 'You went to the river! There is a new page and it is very shiny. Squint!',
    theBurning: 'New page. It is about Ra. It is a little bit hot to hold. Careful!',
    lastPage: 'The last page is ready! It is blank! That is the whole point! Go look!',
  } as Record<string, string>,
  unknown: [
    'It is under the sheet! I do not know what it is yet. Will you go find it? Pleeease?',
    'Nobody has found this one yet. It might be a dragon! It is not a dragon.',
    'An empty jar. Empty jars make me sad. Not cry-sad. A little bit sad.',
    'Shhh, maybe it is hiding! Go out and look for it, okay?',
  ],
  ready: ['You found out everything! Give me your notes! Give me, give me!', 'The study is ready! Press the button! Press it! I love the stamp part.'],
  study: ['We are still studying it. Science takes ages. I know about ages.', 'A little more and we will know everything. Well, almost everything.'],
  studied: ['All done! I wrote it in my big book. In my best handwriting.', 'Studied! Gold seal and everything. I am very proud of us.'],
  stamp: ['Stamp stamp! Studied! Look how shiny the seal is!', 'Hooray! Another one for the big book! Bookworms, file it!', 'Done! I am doing a little dance. You cannot see it. It is inside.'],
  errandTaken: ['Yay! Come back soon! Not too soon. Okay, soon.', 'You are the best! I will wait right here. I am very good at waiting.'],
  errandDone: ['You did it! You did it! Here, take this. I was saving it for you.', 'Really? REALLY? Oh, thank you! This is the best day since the year four thousand.'],
  errandDrop: ['Oh. Okay. That is okay. I am not sad. I am a little sad.'],
  errandWait: ['Did you do my errand yet? No? That is okay! Errands take ages.'],
  idle: [
    'Did you know the moon is MY job? I do it at night.',
    'The bookworms ate a whole dictionary yesterday. Now they use long words.',
    'I am not small. Everybody else is just very big.',
    'I was ten thousand and two last year! Time goes so fast.',
    'Bookworm number four, that is not a book, that is a sandwich!',
    'Can you count to ten thousand? I can! It takes a while.',
    'I invented writing. Then I invented doodling. Doodling is better.',
    // gossip about the hunter's story (docs/LORE.md)
    'Your real name has a LOT of consonants. That is all I am saying. That is ALL.',
    'Pinch rides in your hat, and she is a whole goddess. A whole one! In a hat!',
    'Four arms! You could hold four books at once. Please hold four books at once.',
    'Serket keeps the canopic jars. I keep regular jars. Mine have more creatures in them.',
    'I wrote the Treaty of the Sands. Set says a storm is not a hand. RUDE.',
    'Khonsu still wants his five days back. Finders keepers!',
    'Anubis is very good at sums. I am very good at doodles. We are a team.',
  ],
  gifts: ['These are my gifts! Every study you finish, I get closer to giving you one.', 'I wrapped them myself. With papyrus. It is crinkly.'],
  bye: ['Bye! Bye! Come back with more things for my jars!', 'Bye! Do not get eaten! Unless it is for science.'],
};

export function say(list: string[], name?: string) {
  return pick(list).replace(/\{name\}/g, name ?? 'it');
}

/** what he says when you look at a specimen */
export function aboutEntry(e: CodexEntry, known: boolean) {
  if (!known) return say(TALK.unknown);
  if (e.cat === 'legend' && TALK.legend[e.id]) return TALK.legend[e.id];
  return say(TALK.seen[e.cat] ?? TALK.seen.bounty, e.name);
}

/** his hello when a Ledger page opened since the last visit and is still unread (null: none) */
export function helloLore(): string | null {
  for (let i = LEDGER.length - 1; i >= 0; i--) {
    const p = LEDGER[i];
    const f = Codex.flags('legend:' + p.id);
    if (f & F_SEEN && !(f & F_READ) && TALK.loreHello[p.id]) return TALK.loreHello[p.id];
  }
  return null;
}
