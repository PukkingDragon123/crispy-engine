// What Thoth says in his Hall. He is ten thousand and three years old and talks like a
// small, delighted child: short sentences, lots of "look, look!", tiny confessions.
import type { CodexCat, CodexEntry } from '../../meta/Codex';

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export const TALK = {
  hello: [
    "Hi! Hi! You came back! I'm ten thousand and three, you know. And a half!",
    "I'm ten thousand and three! Look, look, a beetle! Oh. It's a raisin.",
    'Welcome to my hall! I collect EVERYTHING. Look at my jars!',
    'Shhh, the bookworms are working. Okay, I am done shhh-ing. HI!',
    'You smell like sand and adventures. Did you bring me something?',
  ],
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
    pinch: 'Pinch! He pinched me. That is how he got his name! Probably.',
    mamaToad: 'Mama Toad makes the best soup. I am not allowed soup after bedtime.',
    serket: 'Serket is very nice and very scary. Like a cactus with a hug.',
    anubis: 'Anubis weighed my heart once! It was light as a feather. I won!',
    khonsu: 'Khonsu! My best friend! He is the moon on Tuesdays. I am the moon the other days.',
    thoth: "That's ME! I look very handsome. And very old. Ten thousand and three!",
    khepri: 'Khepri rolls the sun every morning. He is never late. I am always late.',
    set: 'Set is grumpy. He is always grumpy. I gave him a hug once. Grumpier.',
    ozymandias: 'Mister Ozymandias sells everything. He sold me a rock. It is a good rock.',
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
