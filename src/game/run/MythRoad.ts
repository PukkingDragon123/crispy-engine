// ROADSIDE LEGENDS: gods and old stories of Egypt standing by the trail, each one a tarot trump,
// each one with a job that is a real legend (docs/LORE.md). They took the broken wagon's and the
// escorted peddler's place on the trail (RunScene.spawnQuests):
//   VII  The Chariot       Bes, the dwarf protector            Bad Moon Rising       drive off Set's night riders
//   III  The Empress       Taweret, the hippo mother           Mama Kin              her four ivory birth wands
//   VI   The Lovers        Hathor in her cow aspect            Red Red Wine          the red beer that put Sekhmet to sleep
//   XIV  Temperance        Khnum, the ram-headed potter        Wheel in the Sky      wet Nile clay for his wheel
//   II   The High Priestess Isis                              Dust in the Wind      the scattered pieces of Osiris (and Ra's secret name)
//   V    The Hierophant    Khun-Anup, the Eloquent Peasant     Simple Man            the steward's thugs who took his donkey
//   XX   Judgement         the Shipwrecked Sailor + serpent    Sloop John B          the serpent's myrrh, so he can go home
//   IV   The Emperor       Sinuhe the exile                    Ramble On             the strongman of Retjenu, dug up again
//   XV   The Devil         Setne Khamwas                       Sympathy for the Pages the Book of Thoth's torn pages
// Humans are shadows (models/shadowHuman). Gods are sculpted rigs (models/characters/mythFolk).
// Everything they say is floating 3D text (fx/WorldSpeech). Shots at a legend never land: the
// round sparks off a little ward and they tell you about it (an Enemies external target that
// deflects). The quest shows as a journal entry on the mission paper (title = the song, footer =
// the trump), and the objective tracker follows it.
//
// Also here: MOJO, THE FOOL'S DOG (the little dog at the Fool's heels in every tarot deck): a
// scruffy wire-haired terrier who loves coffee gum more than life. No gum on you and he snatches a
// fistful of gold and bolts; run him down while he pants, or bribe him. Coffee gum is sold at the
// turtle shop (gumWare, through Missions.wares) and Bes hands out a pack.
//
// Debug: ?debug=run&myth=<id> puts that legend (bes, taweret, hathor, khnum, isis, peasant, sailor,
// sinuhe, setne, dog) 14 m in front of the hunter at the start.
import * as THREE from 'three';
import type { Ctx, RayHit } from '../Ctx';
import type { Player } from '../player/Player';
import type { Enemies, ExternalTarget } from '../enemies/Enemies';
import type { Interactions, Interactable, ChestTier } from './Interact';
import type { PaperQuest } from '../ui/MissionPaper';
import type { Ware } from '../ui/Shop';
import type { VoiceId } from '../audio/Voice';
import { buildRigGeo, RigInstance, type RigSpec } from '../../engine/voxel/Rig';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { shadowHumanRig, shadowMaterial, shadowStaff, type ShadowKind } from '../models/shadowHuman';
import { besRig, taweretRig, hathorRig, khnumRig, isisRig, serpentRig, terrierRig, tokenModel, shadowProp, potterWheel, SERPENT_SEGS, type TokenKind } from '../models/characters/mythFolk';
import { speak3D, say3D } from '../fx/WorldSpeech';
import { WagonRepair } from './WagonRepair';
import { loadSave, writeSave } from '../meta/Save';
import { clamp, damp, dampAngle, rnd } from '../../engine/math/rand';
import { SpringF } from '../anim/spring';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const TEXT = { size: 0.15, color: '#fff3d6', glow: '#2a1408' };

// =================================================================== coffee gum
/** coffee gum in the hunter's pocket this ride (the shop sells it, Bes gives it, Mojo wants it) */
export const CoffeeGum = { n: 0 };
/** the turtle shop's coffee gum (Missions.wares adds it to the shelf) */
export function gumWare(ctx: Ctx): Ware {
  return {
    id: 'gum', name: 'Coffee Gum', price: Math.round(14 * (1 + Math.max(0, ctx.run.wave) * 0.03)), model: 'coffee_gum',
    desc: 'Three sticks of bitter coffee gum. Chew it, or pay off a scruffy little dog who would sell his soul for it.',
    short: 'dog bribe',
    buy: () => ((CoffeeGum.n += 3), true),
    note: () => ({ text: CoffeeGum.n ? `${CoffeeGum.n} in your pocket` : 'none in your pocket' }),
  };
}

// =================================================================== the legends
type Task =
  | { kind: 'gather'; token: TokenKind; n: number; what: string; names: string[]; guards: string[] }
  | { kind: 'slay'; foes: string[]; n: number; what: string; alpha?: string };
type Look = { rig: () => RigSpec; scale?: number } | { shadow: ShadowKind; prop?: 'staff' | 'oar' | 'bow' | 'book' };
interface LegendDef {
  id: string;
  name: string;
  arcana: string;
  song: string;
  look: Look;
  voice: VoiceId;
  pitch?: number;
  extra?: 'serpent' | 'wheel';
  hail: string;
  intro: string[];
  waiting: string[];
  /** lines starting with '@' are said by the serpent */
  done: string[];
  deflect: string[];
  task: Task;
  reward: { bounty: number; gold: number; heal?: number; chest?: ChestTier; gum?: number; card?: boolean };
}

export const LEGENDS: LegendDef[] = [
  {
    id: 'bes', name: 'Bes', arcana: 'VII The Chariot', song: 'Bad Moon Rising', look: { rig: besRig }, voice: 'prospector', pitch: 0.9,
    hail: 'Oi! Bones! You look like a fellow who enjoys a scrap.',
    intro: [
      'Bes. Protector of mothers, babies, and anybody shorter than a camel.',
      "Set's night riders keep raiding the cradle camp over the dune. Mothers, babies, one very nervous goat.",
      "I'd sort them out myself, but the Treaty says a god can't lift a hand. A tongue, though. I can stick out my tongue.",
      "You ride. I'll dance on their graves. Deal?",
    ],
    waiting: ["Go on! I'll keep the goat calm.", 'Every one you drop, I do a little jig.', 'Lovely shooting. Do more of it.'],
    done: ['HA! Look at them run! Even the dead ones!', 'The camp sleeps easy tonight. Here, coffee gum. Keeps the jaw strong. Yours especially.', 'If a snake ever bothers you, say my name. Then shoot it. In that order.'],
    deflect: ['Ha! I wrestle cobras for breakfast, little bones.', "Missed me! I'm short, not slow.", 'Shoot the bandits, not the bodyguard!'],
    task: { kind: 'slay', foes: ['outlaw', 'gunslinger', 'husk'], n: 8, what: "Drive off Set's night riders" },
    reward: { bounty: 90, gold: 30, gum: 3, chest: 'silver' },
  },
  {
    id: 'taweret', name: 'Taweret', arcana: 'III The Empress', song: 'Mama Kin', look: { rig: taweretRig }, voice: 'mamaToad', pitch: 0.8,
    hail: 'Child! Yes, you, with the tail. Come here and let me look at you.',
    intro: [
      'I am Taweret. I keep the birthing bed, and I bite whatever crawls toward it in the dark.',
      'Four of my ivory wands blew away in the storm. Hippo tusk, carved with all my little guardians.',
      'Without them, every cradle in the Reach sleeps unguarded tonight.',
      'And do not tell me you are too old to need a mother. Nobody is.',
    ],
    waiting: ['Mind the jackals. They chew ivory.', 'Four, dear. I counted them myself.', 'Eat something on the way. You are all ribs.'],
    done: ['There. Every cradle guarded. Every little one safe.', 'Someone should have kept watch over yours, you know. I am sorry nobody did.', 'Here. Go and be fed.'],
    deflect: ['Not in front of the children.', 'Young man, I have bitten crocodiles in half.', 'I am a hippopotamus. Bullets are a light rain.'],
    task: { kind: 'gather', token: 'wand', n: 4, what: 'Find her ivory birth wands', names: ['an ivory birth wand'], guards: ['jackal', 'husk'] },
    reward: { bounty: 80, gold: 25, heal: 0.6, chest: 'silver' },
  },
  {
    id: 'hathor', name: 'Hathor', arcana: 'VI The Lovers', song: 'Red Red Wine', look: { rig: hathorRig }, voice: 'serket', pitch: 0.85,
    hail: 'Moo. That is hello. Come closer, sweet bones. I do not bite. Not anymore.',
    intro: [
      'I am Hathor, lady of music and drink and the western hills. Once I was the Eye of Ra.',
      'My father sent me to punish mankind, and I went as a lioness. Sekhmet. I did not stop. I could not stop.',
      'So Ra poured seven thousand jars of beer, dyed red with ochre, over the fields. I drank it for blood, fell asleep, and woke up gentle.',
      "She is stirring again in the mummies' linen. Bring me three jars of the red beer from the brewer's wreck before she wakes.",
    ],
    waiting: ['Three jars. Sekhmet is very thirsty, and I am very serious.', 'Do not drink any. You have no stomach. It would just go everywhere.'],
    done: ['Mmm. Barley and red ochre. Smells exactly like the worst day of my life.', 'I will pour it at sunset. If she wakes, she drinks, she sleeps. Everybody lives.', 'Go and dance somewhere, cowboy. You look like you have never danced.'],
    deflect: ['Moo. That means no.', 'I ate half of Egypt once. Do not test me.', 'Love and joy, love and joy. Put the gun down.'],
    task: { kind: 'gather', token: 'beer', n: 3, what: 'Bring the red beer', names: ['a jar of red beer'], guards: ['mummy', 'husk'] },
    reward: { bounty: 85, gold: 30, heal: 0.4, chest: 'silver' },
  },
  {
    id: 'khnum', name: 'Khnum', arcana: 'XIV Temperance', song: 'Wheel in the Sky', look: { rig: khnumRig }, voice: 'ozymandias', pitch: 1.05, extra: 'wheel',
    hail: 'You there. Yes, you. I know that clay. Come here and let me see my work.',
    intro: [
      'Khnum. Potter of the gods. I throw every child on my wheel, body and ka both, and set them in their mothers.',
      'Hm. You. I remember you. I made you with a sting in the clay. It was not my idea. Somebody owed somebody a debt.',
      'The storm dried my riverbed. Bring me four lumps of good wet clay from the sand pools, and I will throw a hundred babies before supper.',
      'Mind, the clay fights back. It still remembers being the Nile.',
    ],
    waiting: ['Four lumps. Wet. Not mud. There is a difference.', 'Patience is the whole art. And water. Mostly water.'],
    done: ['Ahh. Feel that. Good Nile clay.', "There is a little of every child's shape in a lump like this. Yours had a tail. I put it on with a grin, I admit it.", 'Go on. Temper the fire, mix the water. That is all anybody can do.'],
    deflect: ['I made the clay you are made of. Mind your aim.', 'You would shoot your own potter? I could make you shorter.', 'Clay does not bleed, young man. It cracks. Then I fix it.'],
    task: { kind: 'gather', token: 'clay', n: 4, what: 'Fetch wet river clay', names: ['a lump of river clay'], guards: ['scarab', 'husk'] },
    reward: { bounty: 80, gold: 25, card: true },
  },
  {
    id: 'isis', name: 'Isis', arcana: 'II The High Priestess', song: 'Dust in the Wind', look: { rig: isisRig }, voice: 'serket', pitch: 1.0,
    hail: 'Child of the sting. Come and sit with me. I have a story about names.',
    intro: [
      'I am Isis. When Ra grew old and drooled in his sleep, I mixed his spittle with clay and made a serpent, and it bit him.',
      'Only his secret name could cure that poison, and only I could speak the cure. So he whispered it to me. I have it still.',
      'Now Set has done to my husband what he does to everything: torn him to pieces and scattered him on the wind.',
      'Four pieces of Osiris lie in this sand. Bring them to me. I put him together once. I will do it again.',
    ],
    waiting: ['Four pieces. The crown, the crook, the flail, his hand.', "Set's jackals are sniffing for them too. Be quicker."],
    done: ['There he is. There you are, my love. Again.', 'You want to know about your own name. Of course you do.', 'A name given back must be earned, not tricked. I learned that from the sun. Keep riding. It is closer than you think.'],
    deflect: ["I know the sun's secret name. Yours too, very nearly.", 'I made a snake that bit a god. Try harder.', 'My wings are older than bullets, little one.'],
    task: { kind: 'gather', token: 'osiris', n: 4, what: 'Gather the pieces of Osiris', names: ['the white crown of Osiris', 'the crook of Osiris', 'the flail of Osiris', 'the green hand of Osiris'], guards: ['jackal', 'mummy'] },
    reward: { bounty: 100, gold: 35, heal: 0.5, chest: 'gold' },
  },
  {
    id: 'peasant', name: 'Khun-Anup', arcana: 'V The Hierophant', song: 'Simple Man', look: { shadow: 'man', prop: 'staff' }, voice: 'prospector', pitch: 1.15,
    hail: 'Sir! Sir! A petition, sir! A small one! Nine small ones!',
    intro: [
      'Khun-Anup, sir, a peasant of the Salt Field. I was taking salt and reeds to market when the steward\'s man laid his cloak across the road.',
      'My donkey stepped on the cloak. So he took my donkey. Then my salt. Then my reeds. Then my patience.',
      'I have petitioned the High Steward eight times. He says my words are too beautiful to answer, so he lets me keep talking.',
      'You look like a fellow who answers people. With bullets. Run his thugs off and I get my goods back.',
    ],
    waiting: ['Petition number nine: hurry, sir.', 'Justice is the breath of the nose, sir. Mine is getting short.'],
    done: ['My donkey! My salt! My slightly crushed reeds!', "Ma'at is a balance, sir, and you tipped it back. I shall write a poem about you. A long one.", 'Here, the steward\'s own purse. He will not mind. He loves my petitions.'],
    deflect: ['Petition number ten: please stop shooting me.', 'I am a humble man, sir. Humble men duck.', "Ma'at says no!"],
    task: { kind: 'slay', foes: ['outlaw', 'shotgunner'], n: 6, what: "Run off the steward's thugs" },
    reward: { bounty: 70, gold: 45 },
  },
  {
    id: 'sailor', name: 'The Shipwrecked Sailor', arcana: 'XX Judgement', song: 'Sloop John B', look: { shadow: 'traveller', prop: 'oar' }, voice: 'outlaw', pitch: 1.1, extra: 'serpent',
    hail: 'Ahoy! Ahoy, the dune! Is that a ship? It is a skeleton. Close enough!',
    intro: [
      "I sailed for the king's mines with a hundred and twenty sailors, the bravest hearts in Egypt. A wave of eight cubits took the ship and all of them.",
      'I washed up on an island. Then the sea dried up around it. That is the Reach for you.',
      'He found me there. Thirty cubits of gold, eyebrows of real lapis. He has been very kind. He talks a lot about his family.',
      "The wreck scattered his gifts for the king. Bring back three bundles of myrrh, and he says I can finally go home.",
    ],
    waiting: ['I want to go home. I feel so broke up.', 'He says a ship comes in four months. He said that four hundred years ago.'],
    done: ['Myrrh! Incense! Smell that! That smells like going home!', '@Do not weep, little one. The one who survives a disaster lives to tell of it.', 'He always says that. It is a good line. Now I am telling it to you.'],
    deflect: ['I survived a shipwreck in a desert. You will have to try harder.', 'Careful! He gets protective.', '@That tickles, little one.'],
    task: { kind: 'gather', token: 'myrrh', n: 3, what: "Recover the serpent's myrrh", names: ['a bundle of myrrh'], guards: ['husk', 'jackal'] },
    reward: { bounty: 90, gold: 30, chest: 'silver' },
  },
  {
    id: 'sinuhe', name: 'Sinuhe', arcana: 'IV The Emperor', song: 'Ramble On', look: { shadow: 'rider', prop: 'bow' }, voice: 'outlaw', pitch: 0.95,
    hail: 'Stranger. You ride like a man running from something. I would know.',
    intro: [
      'I am Sinuhe. When the old king died, I heard a thing I should not have heard, and my heart fled before my feet did.',
      'I ran past the Walls of the Ruler and across the bitter lakes. Thirst took me. Herdsmen found me. I became a great man in a foreign land.',
      'Then the strongman of Retjenu came to my tent to take everything I had. I put an arrow in his neck. Set has dug him up, and his men with him.',
      'Help me finish him again. Then I am going home. A man should be buried where he was born.',
    ],
    waiting: ['He carries a shield, an axe and too many javelins. Make him throw them all.', 'Every man has a road home. Mine is just very long.'],
    done: ['He falls. Again. I swear he gets heavier.', 'The king\'s letter said: come home, Sinuhe, you will not be buried in a ram\'s skin. I am going.', 'And you, scorpion boy. Where were you born? Go and find out. It matters more than you think.'],
    deflect: ['I outshot the strongman of Retjenu. Put it away.', 'I have fled from better men than you.'],
    task: { kind: 'slay', foes: ['gunslinger', 'outlaw'], n: 5, what: 'Fell the strongman of Retjenu', alpha: 'gunslinger' },
    reward: { bounty: 95, gold: 30, chest: 'silver' },
  },
  {
    id: 'setne', name: 'Setne Khamwas', arcana: 'XV The Devil', song: 'Sympathy for the Pages', look: { shadow: 'traveller', prop: 'book' }, voice: 'peddler', pitch: 1.05,
    hail: 'Psst. You. Bone man. Do you like books? I have a book problem.',
    intro: [
      "Setne, son of the Pharaoh, scholar, magician and, between us, a thief.",
      "I took the Book of Thoth out of Neferkaptah's tomb. Read it and you understand the birds, the fish and the gods. Dreadful idea.",
      'His ghost wants it back, and the book wants to go home to Thoth. It tore itself up out of spite. Three pages blew off across the dunes.',
      'Bring them to me before the dead do. I swear on my mummy I will return it. Mostly.',
    ],
    waiting: ['Hurry. Every page is a spell, and some of them are rude.', 'If a mummy offers you a game of senet, say no. Trust me.'],
    done: ['All three! The book has stopped screaming. Well. It is whispering now.', 'Fine, fine. It goes back to the little bird-headed fellow in his Hall. Tell him I am sorry. Tell him I read the ending.', 'Here. Something for the trouble. Do not open it near a mirror.'],
    deflect: ['The Book of Thoth taught me this one.', 'Bullets? I have read about bullets. They do not work on me.', 'Careful, I bruise like papyrus.'],
    task: { kind: 'gather', token: 'page', n: 3, what: 'Recover the pages of the Book of Thoth', names: ['a page of the Book of Thoth'], guards: ['mummy', 'husk'] },
    reward: { bounty: 90, gold: 40, card: true },
  },
];
/** what Sundown says when he takes a job */
const TAKE = ['Fine. But I charge by the head.', 'Sure. Gods tip well.', "Ain't my first errand for a god.", 'One job. Then I ride.'];

// =================================================================== the save: who he has met
function mythSave(): { met: string[]; done: string[]; fed: number } {
  const s = loadSave() as any;
  s.myth ??= { met: [], done: [], fed: 0 };
  s.myth.met ??= [];
  s.myth.done ??= [];
  s.myth.fed ??= 0;
  return s.myth;
}

// =================================================================== a ward that turns every shot
let wardId = 700000;
/** registers a legend with the enemies as a target that is never hurt: every hit sparks off and calls `hit` */
class Ward implements ExternalTarget {
  id = wardId++;
  vel = new THREE.Vector3();
  alive = true;
  isBoss = false;
  hp = 1;
  maxHp = 1;
  flying = true; // keeps the scarab swarm and the bomb off them
  constructor(public pos: THREE.Vector3, public radius: number, public height: number, public name: string, private hit: (p: THREE.Vector3, d: THREE.Vector3) => void) {}
  hitTest(o: THREE.Vector3, d: THREE.Vector3, maxT: number): RayHit | null {
    const ox = o.x - this.pos.x, oz = o.z - this.pos.z;
    const a = d.x * d.x + d.z * d.z, b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - this.radius * this.radius;
    const disc = b * b - 4 * a * c;
    if (disc < 0 || a < 1e-9) return null;
    let t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0) t = (-b + Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t > maxT) return null;
    const y = o.y + d.y * t;
    if (y < this.pos.y - 0.1 || y > this.pos.y + this.height) return null;
    const point = new THREE.Vector3(o.x + d.x * t, y, o.z + d.z * t);
    return { enemy: this, t, point, normal: new THREE.Vector3(point.x - this.pos.x, 0, point.z - this.pos.z).normalize(), headshot: false, part: 'torso', surface: 'enemy' };
  }
  takeDamage(_hit: unknown, point?: THREE.Vector3, dir?: THREE.Vector3) {
    this.hit(point ?? this.pos.clone().setY(this.pos.y + this.height * 0.6), dir ?? new THREE.Vector3(0, 0, 1));
    return 0;
  }
}

// =================================================================== a figure on the trail
/** a rigged legend with procedural life: breathing, eye contact, talking hands, a wave, a ward-raise, a cheer */
class Figure {
  root = new THREE.Group();
  rig: RigInstance;
  pos: THREE.Vector3;
  yaw: number;
  height: number;
  radius: number;
  talk = 0;
  wave = 0;
  cheer = 0;
  jig = 0;
  private ward = new SpringF(0, 4.2, 0.45);
  private flinch = new SpringF(0, 3.4, 0.35);
  private wardT = 0;
  private t = rnd.next() * 10;
  private rest: Record<string, THREE.Euler> = {};
  private prop: THREE.Mesh | null = null;

  constructor(private ctx: Ctx, spec: RigSpec, mat: THREE.Material, at: THREE.Vector3, yaw: number, scale = 1, prop?: 'staff' | 'oar' | 'bow' | 'book') {
    this.rig = new RigInstance(buildRigGeo(spec, spec.name + ':myth'), { material: mat as any, castShadow: true });
    for (const p of this.rig.geo.parts) this.rest[p.name] = p.rest.clone();
    this.rig.root.scale.setScalar(scale);
    this.root.add(this.rig.root);
    this.pos = at.clone();
    this.yaw = yaw;
    this.height = ((spec.meta?.height as number) ?? 1.8) * scale;
    this.radius = Math.max(0.35, ((spec.meta?.radius as number) ?? 0.3) * scale);
    if (prop) {
      const r = prop === 'staff' ? shadowStaff(1.7) : shadowProp(prop);
      const geo = buildVoxelGeometry(r.model, { voxelSize: r.voxelSize, pivot: prop === 'book' || prop === 'bow' ? 'center' : 'bottom' });
      this.prop = new THREE.Mesh(geo, mat);
      this.prop.castShadow = true;
      const sock = this.rig.sockets['hand_r'];
      if (sock) {
        sock.add(this.prop);
        if (prop === 'staff' || prop === 'oar') this.prop.position.set(0, -0.72, 0.02);
        if (prop === 'book') this.prop.rotation.set(1.2, 0, 0);
      }
    }
    ctx.scene.add(this.root);
    this.place();
  }

  /** a shot sparks off: the ward hand comes up, the body jerks */
  warded() {
    this.wardT = 0.9;
    this.flinch.v += 6;
  }

  private place() {
    this.root.position.set(this.pos.x, this.ctx.world.groundAt(this.pos.x, this.pos.z) + Math.abs(Math.sin(this.t * 7)) * 0.05 * this.jig, this.pos.z);
    this.root.rotation.y = this.yaw;
  }

  /** `look`: the hunter's head (or null) */
  update(dt: number, look: THREE.Vector3 | null) {
    this.t += dt;
    const t = this.t;
    this.wardT = Math.max(0, this.wardT - dt);
    const wd = this.ward.step(this.wardT > 0 ? 1 : 0, dt);
    const fl = this.flinch.step(0, dt);
    let ly = 0, lp = 0;
    if (look) {
      const dx = look.x - this.pos.x, dz = look.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 16) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 2.2, dt);
      let a = Math.atan2(dx, dz) - this.yaw;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      ly = d < 30 ? clamp(a, -1, 1) : 0;
      lp = d < 30 ? clamp(Math.atan2(look.y - (this.pos.y + this.height * 0.85), Math.max(1, d)), -0.4, 0.4) : 0;
    }
    const br = Math.sin(t * 1.7), tk = this.talk, ch = this.cheer, wv = this.wave, jg = this.jig;
    const set = (n: string, x: number, y: number, z: number) => {
      const node = this.rig.nodes[n], r = this.rest[n];
      if (node && r) node.rotation.set(r.x + x, r.y + y, r.z + z);
    };
    set('pelvis', 0, Math.sin(t * 0.5) * 0.04 + jg * Math.sin(t * 3.5) * 0.25, Math.sin(t * 0.8) * 0.015);
    set('torso', br * 0.025 - fl * 0.18 + tk * Math.sin(t * 3.1) * 0.035, ly * 0.25, jg * Math.sin(t * 7) * 0.08);
    set('head', -lp * 0.6 + tk * Math.sin(t * 6.7) * 0.06 + Math.sin(t * 0.9) * 0.03, ly * 0.55, Math.sin(t * 0.6) * 0.04 + tk * Math.sin(t * 2.3) * 0.05);
    set('jaw', tk > 0.05 ? Math.max(0, Math.sin(t * 13)) * 0.22 * tk : 0, 0, 0);
    // arms: hang and sway; talking hands; the left one waves; the right one raises the ward; both up to cheer
    const sway = Math.sin(t * 1.1) * 0.04;
    set('arm_l', sway - tk * 0.15 - ch * 0.4, 0, 0.1 + wv * 2.55 + ch * 2.5 + jg * (0.6 + Math.sin(t * 7) * 0.3));
    set('fore_l', -tk * (0.5 + Math.sin(t * 2.4) * 0.2) - ch * 0.3, 0, wv * (0.25 + Math.sin(t * 10) * 0.45));
    set('arm_r', -sway - tk * (0.3 + Math.sin(t * 2.1) * 0.22) - wd * 1.45 - ch * 0.4, 0, -0.1 - ch * 2.5 - jg * (0.6 + Math.sin(t * 7 + 1) * 0.3));
    set('fore_r', -tk * (0.6 + Math.sin(t * 2.9) * 0.25) - wd * 0.35 - ch * 0.3, 0, 0);
    set('thigh_l', jg * Math.max(0, Math.sin(t * 7)) * -0.5, 0, 0.02);
    set('shin_l', jg * Math.max(0, Math.sin(t * 7)) * 0.8, 0, 0);
    set('thigh_r', jg * Math.max(0, -Math.sin(t * 7)) * -0.5, 0, -0.02);
    set('shin_r', jg * Math.max(0, -Math.sin(t * 7)) * 0.8, 0, 0);
    set('tail', Math.sin(t * 0.9) * 0.06, Math.sin(t * 1.3) * 0.18, 0);
    set('wing_l', 0, 0, wd * 0.5 + ch * 0.3);
    set('wing_r', 0, 0, -wd * 0.5 - ch * 0.3);
    set('cape', Math.sin(t * 1.4) * 0.05 + 0.04, 0, Math.sin(t * 1.1) * 0.03);
    set('robe', Math.sin(t * 1.2) * 0.02, 0, 0);
    set('crown', Math.sin(t * 1.7 + 1) * 0.015, 0, 0);
    this.place();
  }

  headPos(out: THREE.Vector3) {
    const h = this.rig.nodes['head'];
    if (h) h.getWorldPosition(out);
    else out.copy(this.pos).setY(this.pos.y + this.height * 0.85);
    return out;
  }

  dispose() {
    this.root.removeFromParent();
  }
}

// =================================================================== the serpent of the island
class Serpent {
  root = new THREE.Group();
  rig: RigInstance;
  talk = 0;
  private t = rnd.next() * 10;
  private rest: Record<string, THREE.Euler> = {};
  constructor(private ctx: Ctx, public pos: THREE.Vector3, public yaw: number) {
    const spec = serpentRig();
    this.rig = new RigInstance(buildRigGeo(spec, 'serpent:myth'), { material: sharedVoxelMaterial, castShadow: true });
    for (const p of this.rig.geo.parts) this.rest[p.name] = p.rest.clone();
    this.root.add(this.rig.root);
    this.root.position.set(pos.x, ctx.world.groundAt(pos.x, pos.z) - 0.05, pos.z);
    this.root.rotation.y = yaw;
    ctx.scene.add(this.root);
  }
  update(dt: number, look: THREE.Vector3 | null) {
    this.t += dt;
    const t = this.t;
    if (look) this.yaw = dampAngle(this.yaw, Math.atan2(look.x - this.pos.x, look.z - this.pos.z), 0.35, dt);
    this.root.rotation.y = this.yaw;
    const set = (n: string, x: number, y: number, z: number) => {
      const node = this.rig.nodes[n], r = this.rest[n];
      if (node && r) node.rotation.set(r.x + x, r.y + y, r.z + z);
    };
    // the neck sways like a cobra listening, the head stays level
    let acc = 0;
    for (let i = 1; i <= SERPENT_SEGS; i++) {
      const x = Math.sin(t * 0.8 + i * 0.55) * 0.05 + 0.03, z = Math.sin(t * 0.6 + i * 0.45) * 0.07;
      acc += x;
      set('seg' + i, x, 0, z);
    }
    set('head', -acc + Math.sin(t * 1.3) * 0.05 + this.talk * Math.sin(t * 5) * 0.06, 0, 0);
    set('jaw', this.talk > 0.05 ? Math.max(0, Math.sin(t * 9)) * 0.25 * this.talk : 0.02, 0, 0);
  }
  headPos(out: THREE.Vector3) {
    return (this.rig.nodes['head'] ?? this.root).getWorldPosition(out);
  }
  dispose() {
    this.root.removeFromParent();
  }
}

// =================================================================== one legend's quest
type Phase = 'offer' | 'talk' | 'quest' | 'thanks' | 'done';
interface Token {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  inter: Interactable;
  got: boolean;
  guarded: boolean;
  name: string;
}

class Roadside {
  fig: Figure;
  serpent: Serpent | null = null;
  wheel: THREE.Mesh | null = null;
  phase: Phase = 'offer';
  finished = false;
  private inter: Interactable;
  private wards: Ward[] = [];
  private tokens: Token[] = [];
  private foes: { e: { alive: boolean; pos: THREE.Vector3 } }[] = [];
  private spawned = 0;
  private killed = 0;
  private hailed = false;
  private seq: { lines: string[]; i: number; t: number; then?: () => void } | null = null;
  private lineT = 0;
  private wardCd = 0;
  private wardLine = 0;
  private waitIdx = 0;
  private doneT = 0;
  private waveT = 0;
  private sparkT = 0;

  constructor(private d: MythDeps, public def: LegendDef, at: THREE.Vector3, faceTo: THREE.Vector3) {
    const ctx = d.ctx;
    const yaw = Math.atan2(faceTo.x - at.x, faceTo.z - at.z);
    const L = def.look;
    if ('rig' in L) this.fig = new Figure(ctx, L.rig(), godMat(), at, yaw, L.scale ?? 1);
    else this.fig = new Figure(ctx, shadowHumanRig(L.shadow), shadowMat(), at, yaw, 1, L.prop);
    if (def.extra === 'serpent') {
      const back = new THREE.Vector3(at.x - Math.sin(yaw) * 4.2 + Math.cos(yaw) * 1.5, 0, at.z - Math.cos(yaw) * 4.2 - Math.sin(yaw) * 1.5);
      this.serpent = new Serpent(ctx, back, yaw);
      const sw = new Ward(back, 1.9, 4.4, 'the serpent', (p, dir) => this.deflect(p, dir, true));
      this.wards.push(sw);
    }
    if (def.extra === 'wheel') {
      const w = potterWheel();
      this.wheel = new THREE.Mesh(buildVoxelGeometry(w.model, { voxelSize: w.voxelSize, pivot: 'bottom' }), sharedVoxelMaterial);
      this.wheel.castShadow = this.wheel.receiveShadow = true;
      const x = at.x + Math.cos(yaw) * 1.1 + Math.sin(yaw) * 0.6, z = at.z - Math.sin(yaw) * 1.1 + Math.cos(yaw) * 0.6;
      this.wheel.position.set(x, ctx.world.groundAt(x, z), z);
      ctx.scene.add(this.wheel);
    }
    const f = this.fig;
    this.wards.push(new Ward(f.pos, f.radius, f.height, def.name, (p, dir) => this.deflect(p, dir, false)));
    for (const w of this.wards) d.enemies.registerExternal(w);
    this.inter = {
      pos: f.pos,
      radius: 5.5,
      label: `Talk to ${def.name}`,
      enabled: true,
      promptY: Math.min(2.6, f.height + 0.2),
      use: () => this.use(),
    };
    d.inter.add(this.inter);
    const s = mythSave();
    if (!s.met.includes(def.id)) {
      s.met.push(def.id);
      writeSave();
    }
  }

  // ------------------------------------------------------------- talking
  private say(line: string) {
    const ctx = this.d.ctx;
    const serp = line.startsWith('@') && this.serpent;
    const text = line.replace(/^@/, '');
    if (serp) {
      this.serpent!.talk = 1;
      speak3D(ctx.engine, 'pharaoh', text, this.serpent!.rig.nodes['head'] ?? this.serpent!.root, { key: 'myth:' + this.def.id, lift: 0.6, ...TEXT, size: 0.17, voice: { follow: true, pitch: 0.7 } as any });
    } else {
      this.fig.talk = 1;
      if (this.serpent) this.serpent.talk = 0;
      const head = this.fig.rig.nodes['head'] ?? this.fig.root;
      speak3D(ctx.engine, this.def.voice, text, head, { key: 'myth:' + this.def.id, lift: 0.42, ...TEXT, voice: { follow: true, pitch: this.def.pitch ?? 1 } as any });
    }
    this.lineT = 1.4 + text.length / 30;
  }
  private play(lines: string[], then?: () => void) {
    this.seq = { lines, i: 0, t: 0, then };
  }

  private use() {
    const ctx = this.d.ctx;
    if (this.seq) {
      // T again skips to the next line
      this.seq.t = 0;
      return;
    }
    if (this.phase === 'offer') {
      this.phase = 'talk';
      ctx.toast(this.def.arcana.toUpperCase(), '#ffd36b', this.def.name, true);
      ctx.sfx('card_pick', this.fig.pos, 0.7);
      this.play(this.def.intro, () => this.accept());
    } else if (this.phase === 'quest') {
      if (this.complete()) this.finish();
      else {
        this.say(this.def.waiting[this.waitIdx++ % this.def.waiting.length]);
      }
    } else if (this.phase === 'done') this.say(this.def.done[this.def.done.length - 1]);
  }

  private accept() {
    const ctx = this.d.ctx, def = this.def;
    this.phase = 'quest';
    this.inter.label = `${def.name}: ${def.task.what}`;
    ctx.toast(def.song.toUpperCase(), '#ffd36b', def.task.what, true);
    ctx.sfx('page_turn', null, 0.6, 0.9);
    const pl = this.d.player as any;
    if (pl.root) speak3D(ctx.engine, 'sundown', TAKE[Math.floor(rnd.next() * TAKE.length)], pl.root, { key: 'sundown', lift: 1.9, ...TEXT, voice: { follow: true } as any });
    const T = def.task;
    if (T.kind === 'gather') this.spreadTokens(T);
    else this.spawnFoes(T, Math.ceil(T.n / 2));
  }

  private complete() {
    const T = this.def.task;
    return T.kind === 'gather' ? this.tokens.length > 0 && this.tokens.every((t) => t.got) : this.killed >= T.n;
  }

  private finish() {
    const d = this.d, ctx = d.ctx, def = this.def, R = def.reward, f = this.fig;
    this.phase = 'thanks';
    this.inter.label = `Talk to ${def.name}`;
    f.cheer = 1;
    this.play(def.done, () => (this.phase = 'done'));
    ctx.toast(`${def.song.toUpperCase()}: DONE`, '#ffd36b', `${def.arcana}: ${def.name}`, true);
    ctx.sfx('sting_positive', null, 0.8);
    ctx.sfx('divine_chime', f.pos, 0.6);
    const wave = Math.max(1, ctx.run.wave);
    d.addBounty(R.bounty + wave * 5);
    ctx.run.gold += R.gold;
    ctx.run.totalGold += R.gold;
    if (R.heal) d.player.heal(d.player.maxHp * R.heal);
    if (R.gum) CoffeeGum.n += R.gum;
    ctx.fx.coins({ x: f.pos.x, y: f.pos.y + 1.2, z: f.pos.z }, 10);
    ctx.fx.sparkle({ x: f.pos.x, y: f.pos.y + f.height * 0.6, z: f.pos.z }, 0xffd36b, 18, 1.2);
    if (R.chest) {
      const a = f.yaw + Math.PI * 0.5;
      d.chest?.(f.pos.x + Math.sin(a) * 2.4, f.pos.z + Math.cos(a) * 2.4, R.chest);
    }
    if (R.card) d.card?.();
    const s = mythSave();
    if (!s.done.includes(def.id)) s.done.push(def.id);
    writeSave();
    ctx.events.emit('mythDone', def.id);
  }

  // ------------------------------------------------------------- the jobs
  private spreadTokens(T: Extract<Task, { kind: 'gather' }>) {
    const ctx = this.d.ctx, at = this.fig.pos;
    const a0 = rnd.next() * Math.PI * 2;
    for (let i = 0; i < T.n; i++) {
      let p: THREE.Vector3 | null = null;
      for (let k = 0; k < 14 && !p; k++) {
        const a = a0 + (i / T.n) * Math.PI * 2 + (rnd.next() - 0.5) * 0.9;
        const r = 18 + rnd.next() * 26;
        const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
        if (ctx.world.storm.sdf(x, z) > 6) p = new THREE.Vector3(x, ctx.world.groundAt(x, z), z);
      }
      if (!p) p = new THREE.Vector3(at.x + (rnd.next() - 0.5) * 20, 0, at.z + (rnd.next() - 0.5) * 20);
      p.y = ctx.world.groundAt(p.x, p.z);
      const m = tokenModel(T.token, i);
      const mesh = new THREE.Mesh(buildVoxelGeometry(m.model, { voxelSize: m.voxelSize, pivot: 'bottom' }), sharedVoxelMaterial);
      mesh.castShadow = true;
      mesh.scale.setScalar(T.token === 'page' ? 2.2 : 1.8);
      mesh.position.copy(p);
      ctx.scene.add(mesh);
      const name = T.names[i % T.names.length];
      const tok: Token = { mesh, pos: p, got: false, guarded: false, name, inter: null as unknown as Interactable };
      tok.inter = { pos: p, radius: 3, label: `Pick up ${name}`, enabled: true, promptY: 1.1, use: () => this.pick(tok) };
      this.d.inter.add(tok.inter);
      this.tokens.push(tok);
    }
  }

  private pick(tok: Token) {
    if (tok.got) return;
    const ctx = this.d.ctx, T = this.def.task as Extract<Task, { kind: 'gather' }>;
    tok.got = true;
    this.d.inter.remove(tok.inter);
    ctx.fx.sparkle({ x: tok.pos.x, y: tok.pos.y + 0.4, z: tok.pos.z }, 0xffe2a0, 12, 0.7);
    ctx.sfx('pickup_bounty', tok.pos, 0.7, 1.1);
    tok.mesh.removeFromParent();
    tok.mesh.geometry.dispose();
    const n = this.tokens.filter((t) => t.got).length;
    ctx.toast(n >= T.n ? `ALL ${T.n}: BACK TO ${this.def.name.toUpperCase()}` : `${n}/${T.n}`, '#ffd36b', tok.name.replace(/^(a|an|the) /, (s) => s[0].toUpperCase() + s.slice(1)));
  }

  private spawnFoes(T: Extract<Task, { kind: 'slay' }>, count: number) {
    const ctx = this.d.ctx, at = this.fig.pos;
    const left = T.n - this.spawned;
    const wave = Math.max(1, ctx.run.wave);
    for (let i = 0; i < Math.min(count, left); i++) {
      const a = rnd.next() * Math.PI * 2, r = 20 + rnd.next() * 9;
      const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
      const alpha = !!T.alpha && this.spawned === 0;
      const kind = alpha ? T.alpha! : T.foes[Math.floor(rnd.next() * T.foes.length)];
      const e = this.d.enemies.spawn(kind, x, z, { emerge: wave < 3 || rnd.chance(0.5) ? 'sand' : 'run', alpha });
      this.spawned++;
      if (e) this.foes.push({ e });
      else this.killed++;
    }
  }

  // ------------------------------------------------------------- shots that never land
  private deflect(p: THREE.Vector3, dir: THREE.Vector3, serpent: boolean) {
    const ctx = this.d.ctx;
    // the round sparks off a ward and goes back the way it came, a little wide
    ctx.fx.sparkle(p, 0xffe6a0, 10, 0.5);
    ctx.fx.ring(p, 0xffd36b, 1.1, 0.3);
    const back = _w.copy(dir).multiplyScalar(-1);
    back.x += (rnd.next() - 0.5) * 0.8;
    back.y = Math.abs(back.y) + 0.35;
    back.z += (rnd.next() - 0.5) * 0.8;
    back.normalize();
    ctx.fx.tracer(p, { x: p.x + back.x * 9, y: p.y + back.y * 9, z: p.z + back.z * 9 }, 0xffe6a0, 260);
    ctx.sfx('ricochet', p, 0.7, 0.9 + rnd.next() * 0.3);
    if (this.wardCd > 0) return;
    this.wardCd = 2.2;
    ctx.sfx('gem_chime', p, 0.4, 1.3);
    if (!serpent) this.fig.warded();
    if (this.seq) return;
    let pool = this.def.deflect.filter((l) => l.startsWith('@') === serpent);
    if (!pool.length) pool = this.def.deflect.map((l) => (serpent ? '@' : '') + l.replace(/^@/, ''));
    this.say(pool[this.wardLine++ % pool.length]);
  }

  // ------------------------------------------------------------- frame
  update(dt: number) {
    const d = this.d, ctx = d.ctx, pl = d.player;
    const head = pl.pos.clone().setY(pl.pos.y + 1.5);
    const dist = Math.hypot(pl.pos.x - this.fig.pos.x, pl.pos.z - this.fig.pos.z);
    this.wardCd -= dt;
    this.fig.update(dt, dist < 40 ? head : null);
    this.serpent?.update(dt, dist < 40 ? head : null);
    if (this.wheel) this.wheel.rotation.y += dt * 1.3;
    // talking fades when the line is out; hands wave on the hail; the cheer settles
    this.lineT -= dt;
    this.fig.talk = damp(this.fig.talk, this.lineT > 0 && (!this.serpent || this.serpent.talk < 0.5) ? 1 : 0, 6, dt);
    if (this.serpent) this.serpent.talk = damp(this.serpent.talk, this.lineT > 0 && this.serpent.talk > 0.5 ? 1 : 0, 6, dt);
    this.waveT -= dt;
    this.fig.wave = damp(this.fig.wave, this.waveT > 0 ? 1 : 0, 5, dt);
    this.fig.cheer = damp(this.fig.cheer, this.phase === 'thanks' ? 0.8 : 0, 2, dt);
    this.fig.jig = damp(this.fig.jig, this.def.id === 'bes' && (this.phase === 'thanks' || (this.phase === 'quest' && this.killed > 0 && this.lineT > 0)) ? 1 : 0, 3, dt);
    if (!this.hailed && this.phase === 'offer' && dist < 34 && pl.alive) {
      this.hailed = true;
      this.waveT = 2.2;
      this.say(this.def.hail);
      ctx.sfx('divine_chime', this.fig.pos, 0.35, 1.2);
    }
    // the dialogue
    if (this.seq) {
      const S = this.seq;
      S.t -= dt;
      if (dist > 45) {
        // he rode off mid-story: it waits for him
        S.t = Math.max(S.t, 0.5);
      } else if (S.t <= 0) {
        if (S.i < S.lines.length) {
          this.say(S.lines[S.i++]);
          S.t = this.lineT;
        } else {
          this.seq = null;
          S.then?.();
        }
      }
    }
    if (this.phase === 'quest') this.updateJob(dt);
    if (this.phase === 'done') {
      this.doneT += dt;
      if (this.doneT > 12 && dist > 55) this.finished = true;
    }
  }

  private updateJob(dt: number) {
    const d = this.d, ctx = d.ctx, T = this.def.task, pl = d.player;
    if (T.kind === 'gather') {
      this.sparkT -= dt;
      const sp = this.sparkT <= 0;
      if (sp) this.sparkT = 1.1;
      for (const tok of this.tokens) {
        if (tok.got) continue;
        tok.mesh.rotation.y += dt * 0.9;
        tok.mesh.position.y = tok.pos.y + 0.12 + Math.sin(performance.now() / 600 + tok.pos.x) * 0.08;
        if (sp) ctx.fx.sparkle({ x: tok.pos.x, y: tok.pos.y + 0.6, z: tok.pos.z }, 0xffe2a0, 3, 0.45);
        // the desert does not give its pieces up for free
        if (!tok.guarded && Math.hypot(pl.pos.x - tok.pos.x, pl.pos.z - tok.pos.z) < 30) {
          tok.guarded = true;
          const n = 1 + Math.min(3, Math.floor(Math.max(1, ctx.run.wave) / 6)) + (rnd.chance(0.5) ? 1 : 0);
          for (let i = 0; i < n; i++) {
            const a = rnd.next() * Math.PI * 2;
            d.enemies.spawn(T.guards[i % T.guards.length], tok.pos.x + Math.cos(a) * 6, tok.pos.z + Math.sin(a) * 6, { emerge: 'sand' });
          }
        }
      }
    } else {
      let k = 0;
      for (const f of this.foes) if (!f.e.alive) k++;
      this.killed = k + (this.spawned - this.foes.length);
      const alive = this.foes.length - k;
      if (this.spawned < T.n && alive <= 1) this.spawnFoes(T, T.n - this.spawned);
      if (this.killed >= T.n && this.killed > 0 && !this.cheered) {
        this.cheered = true;
        ctx.toast(`${T.what.toUpperCase()}: DONE`, '#ffd36b', `Back to ${this.def.name}`);
      }
    }
  }
  private cheered = false;

  // ------------------------------------------------------------- the journal and the tracker
  objective(): { title: string; text: string; progress: string; pos: THREE.Vector3 | null } | null {
    if (this.phase !== 'quest') return null;
    const T = this.def.task, pl = this.d.player.pos;
    if (this.complete()) return { title: this.def.song, text: `Return to ${this.def.name}`, progress: 'done', pos: this.fig.pos.clone().setY(this.fig.pos.y + this.fig.height + 0.4) };
    if (T.kind === 'gather') {
      const left = this.tokens.filter((t) => !t.got);
      left.sort((a, b) => a.pos.distanceToSquared(pl) - b.pos.distanceToSquared(pl));
      const p = left[0]?.pos;
      return { title: this.def.song, text: T.what, progress: `${T.n - left.length}/${T.n}`, pos: p ? p.clone().setY(p.y + 1.2) : null };
    }
    let best: THREE.Vector3 | null = null, bd = Infinity;
    for (const f of this.foes)
      if (f.e.alive) {
        const dd = f.e.pos.distanceToSquared(pl);
        if (dd < bd) (bd = dd), (best = f.e.pos);
      }
    return { title: this.def.song, text: T.what, progress: `${this.killed}/${T.n}`, pos: best ? best.clone().setY(best.y + 2) : this.fig.pos.clone().setY(this.fig.pos.y + this.fig.height) };
  }

  dispose() {
    for (const w of this.wards) {
      w.alive = false;
      this.d.enemies.unregisterExternal(w);
    }
    this.d.inter.remove(this.inter);
    for (const t of this.tokens) {
      if (!t.got) this.d.inter.remove(t.inter);
      t.mesh.removeFromParent();
    }
    this.fig.dispose();
    this.serpent?.dispose();
    this.wheel?.removeFromParent();
    this.finished = true;
  }
}

let _godMat: THREE.Material | null = null, _shMat: THREE.Material | null = null;
const godMat = () => (_godMat ??= makeVoxelMaterial());
const shadowMat = () => (_shMat ??= shadowMaterial());

// =================================================================== Mojo, the Fool's dog
type DogState = 'roam' | 'approach' | 'beg' | 'chew' | 'flee' | 'pant' | 'leave' | 'gone';
const DOG_BARK = ['Yip!', 'Rrrf?', 'Yap! Yap yap!', 'Hrrf.'];
const DOG_WARD = ['*snap* ...*ptoo*', 'Grrrrf.', 'Yap! Yap yap yap!', '(He caught it in his teeth. He is judging you.)'];

class Mojo {
  root = new THREE.Group();
  rig: RigInstance;
  pos: THREE.Vector3;
  yaw = rnd.next() * Math.PI * 2;
  state: DogState = 'roam';
  finished = false;
  private home: THREE.Vector3;
  private t = 0;
  private st = 0;
  private phase = 0;
  private speed = 0;
  private stolen = 0;
  private flees = 0;
  private sit = 0;
  private beg = 0;
  private chew = 0;
  private pant = 0;
  private wag = 1;
  private rest: Record<string, THREE.Euler> = {};
  private inter: Interactable;
  private ward: Ward;
  private wardCd = 0;
  private wardI = 0;
  private gifted = false;

  constructor(private d: MythDeps, at: THREE.Vector3) {
    const spec = terrierRig();
    this.rig = new RigInstance(buildRigGeo(spec, 'terrier:myth'), { material: godMat() as any, castShadow: true });
    for (const p of this.rig.geo.parts) this.rest[p.name] = p.rest.clone();
    this.rig.root.scale.setScalar(1.15);
    this.root.add(this.rig.root);
    this.pos = at.clone();
    this.home = at.clone();
    d.ctx.scene.add(this.root);
    this.inter = { pos: this.pos, radius: 3.2, label: 'Give Mojo coffee gum', enabled: false, promptY: 0.9, use: () => this.use() };
    d.inter.add(this.inter);
    this.ward = new Ward(this.pos, 0.45, 0.6, 'Mojo', (p, dir) => this.deflect(p, dir));
    d.enemies.registerExternal(this.ward);
  }

  private bark(text: string, big = false) {
    say3D(this.d.ctx.engine, text, this.rig.nodes['head'] ?? this.root, { key: 'myth:dog', lift: 0.35, ...TEXT, size: big ? 0.14 : 0.12, hold: 1.4 });
    this.d.ctx.sfx('squeak', this.pos, 0.5, 1.6 + rnd.next() * 0.3);
  }
  private sundown(text: string) {
    const pl = this.d.player as any;
    if (pl.root) speak3D(this.d.ctx.engine, 'sundown', text, pl.root, { key: 'sundown', lift: 1.9, ...TEXT, voice: { follow: true } as any });
  }

  private deflect(p: THREE.Vector3, dir: THREE.Vector3) {
    const ctx = this.d.ctx;
    ctx.fx.sparkle(p, 0xffe6a0, 8, 0.4);
    ctx.sfx('ricochet', p, 0.6, 1.4);
    const back = _w.copy(dir).multiplyScalar(-1);
    ctx.fx.tracer(p, { x: p.x + back.x * 6, y: p.y + 2, z: p.z + back.z * 6 }, 0xffe6a0, 260);
    if (this.wardCd > 0) return;
    this.wardCd = 2;
    this.bark(DOG_WARD[this.wardI++ % DOG_WARD.length]);
    if (this.state === 'roam' || this.state === 'approach') this.go('beg');
  }

  private go(s: DogState) {
    this.state = s;
    this.st = 0;
  }

  private use() {
    const ctx = this.d.ctx;
    if (this.state === 'beg' || this.state === 'pant' || this.state === 'flee') {
      if (CoffeeGum.n > 0) {
        CoffeeGum.n--;
        this.go('chew');
        this.inter.enabled = false;
        ctx.sfx('scarab_squish', this.pos, 0.3, 1.6);
        this.bark('*chomp chomp chomp*', true);
        const s = mythSave();
        s.fed++;
        writeSave();
        ctx.toast('MOJO', '#ffd36b', CoffeeGum.n ? `He chews it like it owes him money. ${CoffeeGum.n} gum left` : 'He chews it like it owes him money');
      } else if (this.state === 'pant') {
        // grabbed by the scruff: the gold comes back with interest
        const back = Math.round(this.stolen * 1.5);
        ctx.run.gold += back;
        ctx.fx.coins({ x: this.pos.x, y: this.pos.y + 0.4, z: this.pos.z }, 8);
        ctx.sfx('pickup_gold', this.pos, 0.8);
        ctx.toast('GOT HIM', '#ffd36b', `Mojo coughs up ${back} gold, slobber included`);
        this.sundown('Gotcha. Now cough it up, mutt.');
        this.bark('Hrrrf.');
        this.stolen = 0;
        this.inter.enabled = false;
        this.go('leave');
      }
    }
  }

  update(dt: number) {
    const d = this.d, ctx = d.ctx, pl = d.player;
    this.t += dt;
    this.st += dt;
    this.wardCd -= dt;
    const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    let want = 0, dirYaw = this.yaw;
    const gum = CoffeeGum.n > 0;
    switch (this.state) {
      case 'roam': {
        // sniffing about his patch, nose down, tail going
        const a = this.t * 0.4;
        const tx = this.home.x + Math.cos(a) * 3, tz = this.home.z + Math.sin(a * 1.3) * 3;
        dirYaw = Math.atan2(tx - this.pos.x, tz - this.pos.z);
        want = 1.4;
        if (dist < 28 && pl.alive) {
          this.go('approach');
          this.bark(DOG_BARK[0], true);
        }
        break;
      }
      case 'approach':
        dirYaw = Math.atan2(dx, dz);
        want = dist > 2.6 ? 7 : 0;
        if (dist <= 2.8) {
          this.go('beg');
          this.sundown(gum ? 'Smells the gum on me, huh.' : 'Where did you come from, mutt?');
        }
        if (dist > 60) this.go('roam');
        break;
      case 'beg':
        dirYaw = Math.atan2(dx, dz);
        this.inter.label = gum ? 'Give Mojo coffee gum' : 'Pet the dog';
        this.inter.enabled = gum;
        if (!gum && this.st > 1.6) this.steal();
        else if (gum && this.st > 9) this.steal();
        break;
      case 'chew':
        if (this.st > 3.2 && !this.gifted && this.stolen === 0) {
          this.gifted = true;
          // a happy dog digs up a present
          const g = 20 + Math.max(1, ctx.run.wave) * 2;
          ctx.run.gold += g;
          ctx.run.totalGold += g;
          ctx.fx.coins({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z }, 8);
          ctx.fx.sandBurst({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, 0.6);
          ctx.toast('A PRESENT', '#ffd36b', `Mojo digs up ${g} gold he buried earlier. Good boy.`);
          this.bark('Yip!', true);
        }
        if (this.st > 3.2 && !this.gifted && this.stolen > 0) {
          this.gifted = true;
          const back = this.stolen * 2;
          ctx.run.gold += back;
          ctx.fx.coins({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z }, 10);
          ctx.toast('BRIBED', '#ffd36b', `For gum he gives back ${back} gold. All of it, and then some.`);
          this.stolen = 0;
        }
        if (this.st > 5.5) this.go('leave');
        break;
      case 'flee': {
        // away from the hunter, weaving
        dirYaw = Math.atan2(-dx, -dz) + Math.sin(this.t * 2.3) * 0.5;
        want = 10.5;
        this.inter.enabled = gum && dist < 12;
        this.inter.label = 'Toss Mojo some coffee gum';
        this.inter.radius = gum ? 12 : 3.2;
        if (this.st > 6 + rnd.next() * 0.02) {
          this.go('pant');
          this.bark('*hff hff hff*');
        }
        break;
      }
      case 'pant':
        dirYaw = Math.atan2(dx, dz);
        this.inter.enabled = true;
        this.inter.radius = gum ? 12 : 3.4;
        this.inter.label = gum ? 'Toss Mojo some coffee gum' : 'Grab the mutt';
        if (this.st > 3.6) {
          this.flees++;
          if (this.flees >= 3) {
            ctx.toast('HE GOT AWAY', '#c9a97c', `Mojo is somewhere out there with ${this.stolen} of your gold`);
            this.sundown('...I am not telling anybody about this.');
            this.go('gone');
          } else this.go('flee');
        }
        break;
      case 'leave':
        dirYaw = Math.atan2(-dx, -dz);
        want = 5;
        if (this.st > 7 || dist > 60) this.go('gone');
        break;
      case 'gone':
        // digs in and is gone
        want = 0;
        if (this.st < 0.1) ctx.fx.sandBurst({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, 0.8);
        this.root.position.y -= dt * 0.8;
        if (this.st > 1) this.finished = true;
        break;
    }
    // locomotion
    this.speed = damp(this.speed, want, 5, dt);
    this.yaw = dampAngle(this.yaw, dirYaw, this.state === 'flee' ? 7 : 5, dt);
    if (this.speed > 0.05) {
      let nx = this.pos.x + Math.sin(this.yaw) * this.speed * dt, nz = this.pos.z + Math.cos(this.yaw) * this.speed * dt;
      if (ctx.world.storm.sdf(nx, nz) < 4) {
        // the storm wall: turn along it
        this.yaw += dt * 3;
        nx = this.pos.x;
        nz = this.pos.z;
      }
      this.pos.x = nx;
      this.pos.z = nz;
    }
    this.pos.y = ctx.world.groundAt(this.pos.x, this.pos.z);
    if (this.state !== 'gone') this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.animate(dt);
  }

  private steal() {
    const ctx = this.d.ctx;
    const take = Math.min(ctx.run.gold, 12 + Math.max(1, ctx.run.wave) * 3);
    this.inter.enabled = false;
    if (take <= 0) {
      this.bark('Hrrf.');
      ctx.toast('THE FOOL\'S DOG', '#c9a97c', 'He sniffs your empty pockets, sneezes and trots off');
      this.go('leave');
      return;
    }
    ctx.run.gold -= take;
    this.stolen += take;
    ctx.fx.coins({ x: this.pos.x, y: this.pos.y + 0.5, z: this.pos.z }, 6);
    ctx.sfx('pickup_gold', this.pos, 0.6, 1.4);
    ctx.toast("THE FOOL'S DOG", '#ffd36b', `Mojo snatched ${take} gold. Run him down, or bribe him with coffee gum`, true);
    this.sundown(rnd.chance(0.5) ? 'Hey! That is my gold, you flea-bitten little...' : 'Oh, you did NOT.');
    this.go('flee');
  }

  private animate(dt: number) {
    const s = this.state, t = this.t;
    this.sit = damp(this.sit, s === 'beg' || s === 'chew' ? 1 : 0, 6, dt);
    this.beg = damp(this.beg, s === 'beg' && CoffeeGum.n > 0 ? 1 : 0, 5, dt);
    this.chew = damp(this.chew, s === 'chew' ? 1 : 0, 8, dt);
    this.pant = damp(this.pant, s === 'pant' || (s === 'flee' && this.st > 4) ? 1 : 0, 6, dt);
    this.wag = damp(this.wag, s === 'beg' || s === 'chew' || s === 'approach' ? 1 : s === 'flee' ? 0.6 : 0.4, 4, dt);
    const run = clamp(this.speed / 9, 0, 1), walk = clamp(this.speed / 2, 0, 1);
    this.phase += dt * (6 + this.speed * 1.6);
    const ph = this.phase, sw = Math.sin(ph) * (0.35 + run * 0.45) * walk;
    const set = (n: string, x: number, y: number, z: number) => {
      const node = this.rig.nodes[n], r = this.rest[n];
      if (node && r) node.rotation.set(r.x + x, r.y + y, r.z + z);
    };
    const sitTilt = -0.42 * this.sit - 0.55 * this.beg;
    set('body', sitTilt + Math.sin(ph * 2) * 0.03 * walk, 0, Math.sin(ph) * 0.03 * walk);
    this.rig.root.position.y = -0.07 * this.sit + Math.abs(Math.sin(ph)) * 0.04 * run;
    // a trot: diagonal pairs; a gallop leans into it; sitting folds the back legs
    set('leg_fl', sw + 0.42 * this.sit - 1.1 * this.beg, 0, 0);
    set('leg_br', sw * 0.9 - 1.1 * this.sit, 0, 0);
    set('leg_fr', -sw + 0.42 * this.sit - 1.2 * this.beg + Math.sin(t * 9) * 0.25 * this.beg, 0, 0);
    set('leg_bl', -sw * 0.9 - 1.1 * this.sit, 0, 0);
    // the head: watches the hunter (or the gum), cocks sideways while begging
    set('head', 0.38 * this.sit + 0.4 * this.beg + Math.sin(t * 9) * 0.06 * this.chew - Math.sin(t * 1.6) * 0.06 * (s === 'roam' ? 1 : 0) + 0.25 * (s === 'roam' ? 1 : 0), 0, Math.sin(t * 0.9) * 0.2 * this.beg);
    set('jaw', this.chew * (0.12 + Math.sin(t * 11) * 0.12) + this.pant * (0.3 + Math.sin(t * 13) * 0.05), 0, 0);
    set('tail', -0.2, Math.sin(t * (10 + this.wag * 8)) * 0.55 * this.wag, 0);
    const flop = Math.sin(ph * 2) * 0.25 * run;
    set('ear_l', flop, 0, 0);
    set('ear_r', -flop, 0, 0);
  }

  dispose() {
    this.ward.alive = false;
    this.d.enemies.unregisterExternal(this.ward);
    this.d.inter.remove(this.inter);
    this.root.removeFromParent();
    this.finished = true;
  }
}

// =================================================================== the trail
export interface MythDeps {
  ctx: Ctx;
  player: Player;
  enemies: Enemies;
  inter: Interactions;
  addBounty(v: number): void;
  chest?(x: number, z: number, tier: ChestTier): unknown;
  /** a free upgrade card (the rank-up picker) */
  card?(): void;
}

export class MythRoad {
  private legends: Roadside[] = [];
  private dog: Mojo | null = null;
  private dogDone = false;
  private order: LegendDef[];
  private next = 0;
  private waitT = 0;
  private dogTry = 0;

  constructor(private d: MythDeps) {
    CoffeeGum.n = 0;
    // legends he has never met come first, then the rest, each lot shuffled
    const met = new Set(mythSave().met);
    const sh = <T,>(a: T[]) => a.map((x) => [rnd.next(), x] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
    this.order = [...sh(LEGENDS.filter((l) => !met.has(l.id))), ...sh(LEGENDS.filter((l) => met.has(l.id)))];
    const want = new URLSearchParams(location.search).get('myth');
    if (want) {
      const p = d.player.pos, yaw = (d.player as any).yaw ?? 0;
      const at = new THREE.Vector3(p.x + Math.sin(yaw) * 14, 0, p.z + Math.cos(yaw) * 14);
      if (want === 'dog') this.dog = new Mojo(d, at);
      else {
        const def = LEGENDS.find((l) => l.id === want);
        if (def) {
          this.order = [def, ...this.order.filter((l) => l !== def)];
          this.legends.push(new Roadside(d, def, at, p));
          this.next = 1;
        }
      }
    }
  }

  /** place the next legend somewhere down the trail (called as zones open) */
  spawn(near: THREE.Vector3) {
    if (this.legends.filter((l) => l.phase !== 'done').length >= 2 || this.next >= this.order.length) return;
    const at = WagonRepair.findSpot(this.d.ctx, near, 45, 95);
    if (!at) return;
    this.legends.push(new Roadside(this.d, this.order[this.next++], at, near));
  }

  update(dt: number) {
    const ctx = this.d.ctx, pl = this.d.player;
    for (const l of this.legends) l.update(dt);
    for (let i = this.legends.length - 1; i >= 0; i--)
      if (this.legends[i].finished) {
        this.legends[i].dispose();
        this.legends.splice(i, 1);
        this.waitT = 25;
      }
    // the next legend turns up a while after the last one moved on
    if (this.waitT > 0) {
      this.waitT -= dt;
      if (this.waitT <= 0) this.spawn(pl.pos);
    }
    // the Fool's dog finds him from the second wave on, once a ride
    this.dogTry -= dt;
    if (!this.dog && !this.dogDone && ctx.run.wave >= 2 && pl.alive && this.dogTry <= 0) {
      this.dogTry = 4;
      const at = WagonRepair.findSpot(ctx, pl.pos, 40, 70);
      if (at) this.dog = new Mojo(this.d, at);
    }
    if (this.dog) {
      this.dog.update(dt);
      if (this.dog.finished) {
        this.dog.dispose();
        this.dog = null;
        this.dogDone = true;
      }
    }
  }

  /** the journal entries (one note per job in hand) */
  papers(): PaperQuest[] {
    const out: PaperQuest[] = [];
    for (const l of this.legends) {
      const o = l.objective();
      if (o) out.push({ id: o.title, title: o.title, objective: o.text, progress: o.progress, reward: `${l.def.arcana}: ${l.def.name}` });
    }
    return out;
  }

  /** the objective tracker's view: jobs in hand and legends still waiting to be met */
  track(): { quests: { id: string; title: string; text: string; pos: THREE.Vector3 | null }[]; givers: { pos: THREE.Vector3; name: string; open: boolean }[] } {
    const quests: { id: string; title: string; text: string; pos: THREE.Vector3 | null }[] = [];
    const givers: { pos: THREE.Vector3; name: string; open: boolean }[] = [];
    for (const l of this.legends) {
      const o = l.objective();
      if (o) quests.push({ id: o.title, title: o.title, text: o.text, pos: o.pos });
      else if (l.phase === 'offer') givers.push({ pos: l.fig.pos.clone().setY(l.fig.pos.y + l.fig.height + 0.5), name: `${l.def.name}, ${l.def.arcana.replace(/^[IVXL]+ /, '')}`, open: true });
    }
    return { quests, givers };
  }

  /** the HUD's single objective (when no landmark mission runs) */
  hud(): { objective: { text: string; sub: string } | null; marker: THREE.Vector3 | null } | null {
    for (const l of this.legends) {
      const o = l.objective();
      if (o) return { objective: { text: o.title, sub: `${o.text} — ${o.progress}` }, marker: o.pos };
    }
    return null;
  }

  dispose() {
    for (const l of this.legends) l.dispose();
    this.legends = [];
    this.dog?.dispose();
    this.dog = null;
  }
}
