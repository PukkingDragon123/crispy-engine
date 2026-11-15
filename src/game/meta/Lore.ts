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
    id: 'lastBounty', name: 'The Last Bounty', title: page('I'), model: 'skull_cow',
    lore: 'Ten years he rode with a marshal who had a fast smile and a tin star. The night the storm came, the marshal led him onto the hardpan after a bounty that did not exist, and an iron bear trap was waiting under the sand. He died there at sundown, watching his partner ride off with his horse, his share and his name. The flats are called Sundown Flats now.',
    hint: 'It begins where every ride begins.',
    via: ['legend:serket'],
    study: { text: 'Ride out three times', stat: 'runs', n: 3 },
  },
  {
    id: 'ironJaw', name: 'The Iron Jaw', title: page('II'), model: '@hero',
    lore: 'The trap crushed his skull past saving, and Serket spent a whole night trying to pry the iron off what was left. It had bitten into the bone for good. So she kept the teeth and taught them to talk. Rusted iron now clamps his scorpion mouthparts: it snaps on every kill, clacks on every reload and holds a cigarette better than lips ever did.',
    hint: 'Fall once, and stand before the jackal.',
    via: ['legend:anubis'],
    need: { stat: 'deaths', n: 1 },
    study: { text: 'Snap the jaw on 150 outlaws', stat: 'kills', n: 150 },
  },
  {
    id: 'blackStinger', name: 'The Black Stinger', title: page('III'), model: 'scorpion_totem',
    lore: 'Serket found two things on the dunes that night: a hunter\'s bones, still holding a grudge, and the empty shell of Aqrab, the Black Stinger, her champion, who held the storm wall for a thousand years. One had a will and no body. The other had a body and no will. She stitched them together, all the way. The skull is his now. So are the tail, the pincers and the temper.',
    hint: 'Ride as far as wave 10.',
    need: { stat: 'wave', n: 10 },
    study: { text: 'Reach wave 30', stat: 'wave', n: 30 },
  },
  {
    id: 'lastBrood', name: 'The Last of the Brood', title: page('IV'), model: 'pinch',
    lore: 'Set stole Serket\'s scorpions in the storm and twisted them into the giants of the dunes. One egg was left, tucked in a joint of the Black Stinger\'s shell, and it hatched in an empty socket of the hunter\'s new skull. Pinch saw him first, and scorpions imprint. They came out of the same shell, so they are bound: Pinch never wanders far, and Sundown never quite gets rid of him.',
    hint: 'Pinch will not look at the big scorpions. Find one anyway.',
    via: ['bounty:giantScorpion'],
    study: { text: 'Fill 40 jars in the Hall', stat: 'found', n: 40 },
  },
  {
    id: 'soulDebt', name: 'The Debt at the Scales', title: page('V'), model: 'realm_scales',
    lore: 'His heart was heavy: a hunter\'s and a grave robber\'s. Ammit was licking her lips. Serket asked for it on credit, and Anubis, a careful bookkeeper, agreed. He sends ahead every soul that cheated the scales, and they pour into Serket\'s canopic jar until he pays them over. Uncorking the jar spends them. That is why the debt never seems to get smaller.',
    hint: 'Stand before Anubis twice.',
    need: { stat: 'deaths', n: 2 },
    study: { text: 'Stand before Anubis five times', stat: 'deaths', n: 5 },
  },
  {
    id: 'starThatRusts', name: 'The Star That Rusts', title: page('VI'), model: 'shield_charm',
    lore: 'Sethos offered Marshal Wade Calloway a star that never tarnishes and a life that never ends. Calloway sold his partner for it. He died anyway, was buried with the star, and Set dug him back up as the Dust Marshal. Set keeps a promise the way a storm keeps a house. Calloway still calls him partner, and he means to finish what he started.',
    hint: 'The law rides out at wave 10.',
    via: ['boss:marshal'],
    study: { text: 'Bring in the Dust Marshal', stat: 'claim:boss:marshal', n: 1 },
  },
  {
    id: 'godsWork', name: 'Gold From the Gods', title: page('VII'), model: 'chest_gold',
    lore: 'At the dawn of the world Thoth wrote the Treaty of the Sands: no god may raise a hand in another god\'s desert. Set found the loophole. A storm is not a hand. The other gods cannot ride in after him without a war, but a dead man is not a god. So they post the bounties and pay him twice: in tomb gold, and in the letters of his name.',
    hint: 'Bring down a boss.',
    need: { stat: 'bosses', n: 1 },
    study: { text: 'Fell five different bosses', stat: 'bosses', n: 5 },
  },
  {
    id: 'scribe', name: 'The Scribe Keeps Count', title: page('VIII'), model: 'workshop_open_tome',
    lore: 'Every soul sent ahead gets one line in Thoth\'s big book. Sundown has been written down as dead so often that it ruins the records, so Thoth started a collection instead, and this Ledger is it. Thoth also wrote down the hunter\'s real name the night he died. He is not allowed to say it: a name given back has to be earned. He nearly says it every visit.',
    hint: 'Visit Thoth\'s Hall.',
    hall: true,
    study: { text: 'Finish five studies', stat: 'studies', n: 5 },
  },
  {
    id: 'borrowedNights', name: 'The Borrowed Nights', title: page('IX'), model: 'gear_hourglass',
    lore: 'Long ago Thoth beat Khonsu at senet and won five days off the moon. When Sundown falls for good, his soul goes back in the jar, the jar goes home to Mama Toad\'s mantel, and the bones need nights to knit. Thoth pays for those nights out of his winnings. Khonsu says they are still his, and the moon remembers every night it is owed.',
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
  'Sundown Flats: where he died, and where he rides.',
  'The trap that killed him is his mouth now.',
  'Every bounty carves a letter of his name back.',
  'Serket remade him from bone and a champion\'s shell.',
  'Four arms: two for the gun, two for everything else.',
  'Pinch hatched in his skull. He calls it home.',
  'The soul jar holds what he owes Anubis.',
  'Uncork the jar, and the debt grows again.',
  'A storm is not a hand. That was Set\'s loophole.',
  'Thoth won five days from the moon at senet.',
  'Khonsu remembers every night you borrowed.',
  'The Dust Marshal still calls him partner.',
  'Thoth knows his real name. He is not telling.',
  'Mama Toad keeps the soul jar on her mantel.',
  'Ozymandias sold a marshal a bear trap once.',
  'A million on Sethos. A million on Sundown.',
  'Mark kept silent three thousand years. Still does.',
  'Cleopatra\'s veil keeps the world from burning.',
  'Ra wants a noon that never ends.',
  'The bookworms file Sundown under S. For skeleton.',
  'Set keeps a promise the way a storm keeps a house.',
  'The Black Stinger held the wall a thousand years.',
];

/** a line under the sunrise count when a ride ends and the jar goes home (scenes/DeathCine) */
export const DEATH_LORE = [
  'the jar went home, and the bones followed',
  'Khonsu lent the nights, and Thoth paid for them',
  'Anubis wrote it down. The debt still stands.',
  'Mama Toad set the jar back on the mantel',
  'Pinch kept watch the whole time',
  'Serket is not finished with him yet',
  'collateral always comes home',
];

export function ledgerPage(id: string): LedgerPage | null {
  return LEDGER.find((p) => p.id === id) ?? null;
}
