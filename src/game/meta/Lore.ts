// SUNDOWN'S LEDGER, and the other lore the game speaks. docs/LORE.md is the bible; this
// file is what of it reaches the screen:
//   LEDGER        the pages of Sundown's own story. Each is a Legends entry in Thoth's Hall
//                 (meta/Codex) that opens through play: a first ride, a death, a wave, a boss
//                 met or beaten, a visit to the Hall. Each has a study (meta/Research).
//   LOADING_LORE  lines that take turns with the tips under the loading hourglass.
//   DEATH_LORE    a line under "N DAYS PASSED" when a ride ends (scenes/DeathCine).
// Pure data with no imports: the loading screen reads it at boot.

/** a tally kept in the save that a page or its study can wait on */
export type LoreStat = 'runs' | 'kills' | 'wave' | 'deaths' | 'found' | 'studies' | 'bosses';

export interface LedgerPage {
  id: string;
  name: string;
  title: string;
  /** a model registry key for the jar (cheap props: Thoth may build it mid-ride) */
  model: string;
  lore: string;
  /** shown while the page is still under the dust sheet */
  hint: string;
  /** opens when any of these codex keys is discovered (at any level) */
  via?: string[];
  /** opens when any of these codex keys is claimed (a boss beaten, ...) */
  claim?: string[];
  /** opens when a saved tally reaches n */
  need?: { stat: LoreStat; n: number };
  /** opens once this unlock (meta/Unlocks id) has been granted */
  unlock?: string;
  /** opens when a boss whose name matches walks in, or goes down */
  meet?: RegExp;
  beat?: RegExp;
  /** opens on the first visit to Thoth's Hall */
  hall?: boolean;
  /** Thoth's study for it: a tally, a codex key claimed, or a codex key known */
  study: { text: string; stat: LoreStat | `claim:${string}` | `known:${string}`; n: number };
}

const page = (n: string) => `Sundown's Ledger, page ${n}`;

export const LEDGER: LedgerPage[] = [
  {
    id: 'lastBounty', name: 'The First Bounty', title: page('I'), model: 'skull_cow',
    lore: 'His first bounty from the gods had no name on it, only a scorpion pressed in green wax. It led him to a tomb cut into the Weeping Wall, the great red cliff at the edge of the Reach. Inside, on the sarcophagus, sat a little scorpion. The doors slammed shut. Then the little scorpion stood up out of itself and was Serket, and she had been waiting for him since the day he was born.',
    hint: 'It begins with a door in a mountain.',
    via: ['legend:serket'],
    study: { text: 'Ride out three times', stat: 'runs', n: 3 },
  },
  {
    id: 'ironJaw', name: 'The Iron Jaw', title: page('II'), model: '@hero',
    lore: 'He grew up a scavenger, eating what the rail camps threw out. At ten he crept into a trapper\'s cache on the flats at sundown, and an iron bear trap snapped shut on his face. The trapper laughed and rode away. The trap never came off: it grew into his chitin like iron into a tree. He filed the teeth and polished the springs, and now the grille snaps on every kill, clacks on every reload and holds a cigarette better than lips ever did.',
    hint: 'Fall once, and stand before the jackal.',
    via: ['legend:anubis'],
    need: { stat: 'deaths', n: 1 },
    study: { text: 'Snap the jaw on 150 outlaws', stat: 'kills', n: 150 },
  },
  {
    id: 'blackStinger', name: 'The Black Stinger', title: page('III'), model: 'scorpion_totem',
    lore: 'The tomb in the Weeping Wall was Aqrab\'s: the Black Stinger, Serket\'s champion, who held the storm wall for a thousand years and fell the night it broke. She needed a new one. In her domain she set him a soul scorpion to kill, and when he did she finished what her sting began: she woke the venom in his tail and set a drop of her own sight in his eye. The post is his now. So is the temper.',
    hint: 'Ride as far as wave 10.',
    need: { stat: 'wave', n: 10 },
    study: { text: 'Reach wave 30', stat: 'wave', n: 30 },
  },
  {
    id: 'lastBrood', name: 'The Little Scorpion', title: page('IV'), model: 'pinch',
    lore: 'Pinch is Serket herself, made small. In that shape a goddess can cross the Treaty without breaking it, because a scorpion is not a hand. She rides in his hat and whispers to him in clicks. Set stole the rest of her brood in the storm and twisted them into the giants of the dunes, and she will not look at them. Whether it was she who sat with a baby by a cold fire one dawn, she will not say.',
    hint: 'Pinch will not look at the big scorpions. Find one anyway.',
    via: ['bounty:giantScorpion'],
    study: { text: 'Fill 40 jars in the Hall', stat: 'found', n: 40 },
  },
  {
    id: 'soulDebt', name: 'The Weighing', title: page('V'), model: 'realm_scales',
    lore: 'When he falls, Anubis sets his heart on the Scales of Ma\'at against the feather. Serket stands surety, so the first falls are forgiven: balance the heart and walk back up into the sun. But every fall leaves something on it. After the third it is too heavy to balance, and Anubis sends him home to heal. Ammit is very patient.',
    hint: 'Stand before Anubis twice.',
    need: { stat: 'deaths', n: 2 },
    study: { text: 'Stand before Anubis five times', stat: 'deaths', n: 5 },
  },
  {
    id: 'starThatRusts', name: 'The Star That Rusts', title: page('VI'), model: 'shield_charm',
    lore: 'Wade Calloway was the young lawman whose trap is Sundown\'s grille. Years later Sethos offered him a star that never tarnishes and a life that never ends, for the head of the scorpion-boy who got away. Calloway took it, died anyway, was buried with the star, and Set dug him back up as the Dust Marshal. Set keeps a promise the way a storm keeps a house. Calloway still calls him kid.',
    hint: 'The law rides out at wave 10.',
    via: ['boss:marshal'],
    study: { text: 'Bring in the Dust Marshal', stat: 'claim:boss:marshal', n: 1 },
  },
  {
    id: 'godsWork', name: 'Gold From the Gods', title: page('VII'), model: 'chest_gold',
    lore: 'At the dawn of the world Thoth wrote the Treaty of the Sands: no god may raise a hand in another god\'s desert. Set found the loophole. A storm is not a hand. The other gods cannot ride in after him without a war, but a cursed child is not a god, and not quite a man. So they post the bounties and pay him twice: in tomb gold, and in the letters of the name his mother whispered once.',
    hint: 'Bring down a boss.',
    need: { stat: 'bosses', n: 1 },
    study: { text: 'Fell five different bosses', stat: 'bosses', n: 5 },
  },
  {
    id: 'scribe', name: 'The Book of Thoth', title: page('VIII'), model: 'workshop_open_tome',
    lore: 'The tarot was never a game: Thoth wrote it, twenty-two trumps that hold the world in pictures. Sundown\'s father dealt it over the cradle and drew the Tower, the Moon and Death. His mother hid the Star in the swaddle. Thoth heard her whisper the baby\'s name that night and wrote it down. He is not allowed to say it: a name given back has to be earned. He nearly says it every visit.',
    hint: 'Visit Thoth\'s Hall.',
    hall: true,
    study: { text: 'Finish five studies', stat: 'studies', n: 5 },
  },
  {
    id: 'borrowedNights', name: 'The Borrowed Nights', title: page('IX'), model: 'gear_hourglass',
    lore: 'Long ago Thoth beat Khonsu at senet and won five days off the moon. When Sundown\'s heart grows too heavy, Anubis sends him home to Mama Toad\'s couch, and the bones need nights to knit. Thoth pays for those nights out of his winnings. Khonsu says they are still his, and the moon remembers every night it is owed.',
    hint: 'The moon walks at wave 5.',
    via: ['boss:khonsu', 'boss:khonsuSand'],
    study: { text: 'Reach wave 50', stat: 'wave', n: 50 },
  },
  {
    id: 'moonCat', name: 'The Cat Who Kept Silent', title: page('X'), model: 'mark_crest',
    lore: 'Under the Heart of the Oasis, where Khonsu sleeps, a cat warrior in moon linen kept a temple and a vow of silence for three thousand years. When Khonsu of the Sands fell, the oath broke. Mark is free, and he rides with Sundown now. Cats choose their people. Also, Khonsu asked him to watch the man who borrows nights. Mark says nothing about either.',
    hint: 'Bring down Khonsu of the Sands.',
    claim: ['boss:khonsuSand'],
    unlock: 'hero:mark',
    study: { text: 'Fell ten different bosses', stat: 'bosses', n: 10 },
  },
  {
    id: 'sunsDaughter', name: 'The Sun\'s Daughter', title: page('XI'), model: 'statue_ra',
    lore: 'Past the oasis runs Ra\'s river, and Cleopatra rules it from a golden barge. She is veiled head to foot because her face is made of sunlight, and anyone who sees it burns. Her father poured himself into her so he could walk the world without setting it alight. Her crocodile has eaten her enemies for a thousand floods. Her Sphinx has never lost a riddle.',
    hint: 'Ride the river and meet the Queen\'s court.',
    meet: /cleopatra|sphinx|sebekhotep|leviathan/i,
    study: { text: 'Reach wave 75', stat: 'wave', n: 75 },
  },
  {
    id: 'theBurning', name: 'The Burning', title: page('XII'), model: 'ra_meteor',
    lore: 'Ra is tired: of Set\'s storm, of Khonsu\'s long nights, of the whole squabbling Reach. His cure is the Burning, a noon that never ends, the sun nailed to the top of the sky until the desert is clean, bright glass. Cleopatra rode ahead to make the river ready. When her light goes out, her father comes himself, and the river burns.',
    hint: 'Put out the light of the Queen of the Nile.',
    meet: /^ra$/i,
    beat: /cleopatra/i,
    study: { text: 'Reach wave 100', stat: 'wave', n: 100 },
  },
  {
    id: 'lastPage', name: 'The Last Page', title: page('XIII'), model: 'book',
    lore: 'At the Apex of the Red Pyramid the priest burned away and the god walked in his skin, and Sundown put him down anyway. Thoth left this page blank on purpose. He says the hunter gets to write the ending himself, in his best handwriting, and spell his own name right once he knows it.',
    hint: 'Nobody has written this page yet.',
    claim: ['boss:setAvatar'],
    study: { text: 'Finish 40 studies', stat: 'studies', n: 40 },
  },
];

/** lines that take turns with the gameplay tips under the loading hourglass (short: they must fit one line) */
export const LOADING_LORE = [
  'Sundown Flats: where the trap closed. He walked out.',
  'The trap from his boyhood is his grille now.',
  'Every bounty buys back a letter of his name.',
  'Born with a tail. Left by a cold fire at dawn.',
  'Four arms: two for the gun, two for everything else.',
  'Pinch is Serket, made small. She whispers.',
  'Every fall makes his heart a little heavier.',
  'Three falls, and the heart will not balance.',
  'A storm is not a hand. That was Set\'s loophole.',
  'Thoth won five days from the moon at senet.',
  'Khonsu remembers every night you borrowed.',
  'The Dust Marshal still calls him partner.',
  'Thoth knows his real name. He is not telling.',
  'Mama Toad fed a scorpion boy once. She remembers.',
  'Ozymandias sold a young lawman a bear trap once.',
  'A million on Sethos. A million on Sundown.',
  'Mark kept silent three thousand years. Still does.',
  'Cleopatra\'s veil keeps the world from burning.',
  'Ra wants a noon that never ends.',
  'The bookworms file Sundown under S. For scorpion.',
  'Set keeps a promise the way a storm keeps a house.',
  'The Black Stinger held the wall a thousand years.',
  'The tarot is the Book of Thoth. He wrote it.',
  'His mother hid The Star in his swaddle.',
  'The Fool has no number. Sundown has no name.',
  'His father drew the Tower, and walked away.',
  'Humans are shadows. The gods cannot tell them apart.',
];

/** a line under the sunrise count when a ride ends and the jar goes home (scenes/DeathCine) */
export const DEATH_LORE = [
  'Anubis sent him home, and the bones followed',
  'Khonsu lent the nights, and Thoth paid for them',
  'Anubis wrote it down. The debt still stands.',
  'Mama Toad kept the kettle on',
  'Pinch kept watch the whole time',
  'Serket is not finished with him yet',
  'a cursed child always comes home',
];

export function ledgerPage(id: string): LedgerPage | null {
  return LEDGER.find((p) => p.id === id) ?? null;
}
