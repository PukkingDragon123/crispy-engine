// Serket's riding lesson: the interactive tutorial that follows the opening
// cinematic. The goddess floats at Sundown's side as a guide (the scorpion-girl
// spirit, models/characters/scorpionGirl.ts) and each step waits for the player
// to actually do it, with a short spoken line and a floating 3D prompt (Alagard)
// naming the keys. The first ride is kept short (the slow reveal, meta/Unlocks):
//   1. push (tap SHIFT, on the beat), carve (A / D) and tuck (hold SPACE)
//   2. drift (hold SHIFT through a carve) and sling out of it
//   3. hold SPACE to charge a jump, release, and land it
//   4. a trick in the air (SHIFT + W A S D), landed
//   5. aim (RMB) and shoot (LMB) three skull targets she raises: go for heads
//   6. reload (R) with Pinch's timing ring (R again) for venom rounds
//   7. kick (F)
//   8. grapple (Q) the scorpion totem she raises
//   9. the 30 s break between waves and ringing the bell (told)
//  10. the trail ledger and the shop compass; TAB opens the full ledger
// then "a hundred waves stand between you and your name", she leaves, and the
// run begins. The rest comes later, one LESSON at a time (`lesson` below): she
// rises out of the sand during a wave break, shows one thing hands-on, and goes:
//   dodge (the QTE ring: she hurls a spear of sand), guns (switching, 3 / 4 / 5),
//   tarot (she lends THE SUN: cast it, empower it on its ring), ult (she fills the
//   soul jar, he unleashes Serket's Wrath), dig (she buries a glint, he digs it up),
//   and each move as it unlocks: sand kick, wall ride, nose manual, dune surf, the
//   Neck Slicer. run/Progression queues them and marks them given (meta/Unlocks).
// Every step can be passed with N (or the "next step" label), and hold BACKSPACE
// (or click SKIP) to skip the whole lesson. On a touch screen every goal and line
// names the gestures instead of the keys (ui/TouchControls).
//
// API: `new Tutorial({ ctx, player, cam, lesson? })`, then every frame `update(dt)`
// until `done`, then `dispose()`. It never touches the wave director: the caller starts
// wave 1 when `done` turns true (a lesson's caller holds the break while it runs).
import * as THREE from 'three';
import type { Ctx } from '../Ctx';
import type { Player } from '../player/Player';
import type { CameraRig } from '../player/CameraRig';
import type { LandingInfo } from '../player/Board';
import type { Collider } from '../world/Colliders';
import type { VoxelModel } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { modelEntry } from '../models/lookup';
import { FloatText3D } from '../fx/FloatText3D';
import { Voice } from '../audio/Voice';
import { GlyphRings, SandVortex, SerketSpirit, guideSpot, spiritMotes, type SpiritPose } from '../fx/SerketSpirit';
import { isTouchDevice } from '../ui/TouchControls';
import { Skills } from '../player/Skills';
import type { Dodge, DodgeResult } from '../enemies/Dodge';
import { Unlocks, type LessonId } from '../meta/Unlocks';
import { technique, type TechniqueId } from '../player/Techniques';

/** on a touch screen the lesson names the gestures (ui/TouchControls) instead of the keys */
const TOUCH = isTouchDevice();
const say = (keys: string, touch: string) => (TOUCH ? touch : keys);

export interface TutorialDeps {
  ctx: Ctx;
  player: Player;
  cam: CameraRig;
  /** one later lesson instead of the first ride's lesson (a move, the dodge, the tarot, ...) */
  lesson?: LessonId;
}

/** how she opens each later lesson */
const LESSON_INTRO: Record<LessonId, string> = {
  dodge: 'A word before the next wave, bone-rider. The big ones telegraph. Learn to read them.',
  guns: 'Two irons on you now? Then learn to change them without dying.',
  tarot: 'The tarot woke in your hands. Let me show you how to wring more out of a card.',
  ult: 'Your canopic jar is brimming. Do you know what it is for? Let me show you.',
  dig: 'The desert hides more than bones. Let me teach you to dig.',
  sand_kick: 'You kicked off thin air back there. Again, properly this time.',
  wall_ride: 'You beat a god. Walls should be easy. Ride one.',
  manual: 'Rank five! Time you learned to glide on the nose.',
  dune_surf: 'That combo had rhythm. Now let the dunes do the pushing.',
  neck_slicer: 'Khonsu fell to you, and his secret with him. The Neck Slicer.',
};

type Wait = number | (() => boolean);
type Script = Generator<Wait, void, number>;

interface Goal {
  label: string;
  done: boolean;
  text: FloatText3D;
}

interface Totem {
  mesh: THREE.Mesh;
  col: Collider | null;
  at: THREE.Vector3;
  rise: number;
  sink: boolean;
  alive: boolean;
  halo: GlyphRings;
  h: number;
}

const JADE = '#c4ffe0', JADE_GLOW = '#3cff9a';
const KEYS = '#fff3d6', KEY_GLOW = '#ffb070';

export class Tutorial {
  /** true once she has gone (finished or skipped): start the waves */
  done = false;
  /** true when the player skipped */
  skipped = false;
  private ctx: Ctx;
  private player: Player;
  private cam: CameraRig;
  private spirit: SerketSpirit;
  private halo: GlyphRings;
  private sand: SandVortex;
  private texts: FloatText3D[] = [];
  private speech: FloatText3D | null = null;
  private goals: Goal[] = [];
  private co: Script;
  private wait: Wait = 0;
  private t = 0;
  private unsub: (() => void)[] = [];
  private prevJump: ((c: number, b: boolean) => void) | undefined;
  private prevLand: ((l: LandingInfo) => void) | undefined;
  private skipEl: HTMLDivElement;
  /** when BACKSPACE went down (real ms), 0 while up */
  private skipDown = 0;
  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Backspace') return;
    if (e.type === 'keydown') {
      if (!this.skipDown) this.skipDown = performance.now();
    } else {
      if (this.skipDown && performance.now() - this.skipDown > 600) this.skip();
      this.skipDown = 0;
    }
  };
  private spot = { pos: new THREE.Vector3(), yaw: 0, scale: 0.6 };
  private vel = new THREE.Vector3();
  private leaving = false;
  private props: Totem[] = [];
  private mat = makeVoxelMaterial();
  // what the player has done
  private rideDist = 0;
  private carveT = 0;
  private tuckT = 0;
  private jumpCharged = false;
  private landed: LandingInfo | null = null;
  private bailed = 0;
  private melee = 0;
  private perfect = false;
  private reloads = 0;
  private wasReloading = false;
  private targetsLeft = 0;
  private farT = 0;
  private lastDt = 1 / 60;
  private drifts = 0;
  private tricks = 0;
  private swaps = 0;
  private dodgeRes: DodgeResult | null = null;
  private ledgerSeen = false;
  private ledgerRestore: (() => void) | null = null;
  private dig: { site: any; tr: any } | null = null;
  private lentSun = false;
  /** a single later lesson (null: the first ride's lesson) */
  private lesson: LessonId | null = null;
  /** board move callbacks chained by a move lesson (restored on dispose) */
  private moveRestore: (() => void) | null = null;
  /** N (or the "next step" label): pass the current step */
  private stepSkip = false;
  private nextEl: HTMLDivElement;
  private onNext = (e: KeyboardEvent) => {
    if (e.code === 'KeyN' && !e.repeat) this.stepSkip = true;
  };

  constructor(d: TutorialDeps) {
    this.ctx = d.ctx;
    this.player = d.player;
    this.cam = d.cam;
    this.lesson = d.lesson ?? null;
    const scene = d.ctx.scene;
    guideSpot(this.player.pos, this.cam.yaw, this.ground, this.spot);
    this.spirit = new SerketSpirit(scene, { scale: this.spot.scale });
    this.spirit.root.position.copy(this.spot.pos);
    this.spirit.root.rotation.y = this.spot.yaw;
    this.spirit.form = 0.4;
    this.halo = new GlyphRings(scene, [{ radius: 1.6, y: 0.9, count: 9, speed: 0.6, tilt: [0.18, 0.1] }], 1.6);
    this.halo.appear = 0;
    this.sand = new SandVortex(scene, 380);
    // board callbacks (chained, restored on dispose)
    const b = this.player.board;
    this.prevJump = b.onJump;
    this.prevLand = b.onLand;
    b.onJump = (c, boost) => {
      this.prevJump?.(c, boost);
      if (c >= 0.3) this.jumpCharged = true;
    };
    b.onLand = (l) => {
      this.prevLand?.(l);
      if (this.jumpCharged) this.landed = l;
    };
    const ev = this.ctx.events;
    this.unsub.push(
      ev.on('melee', () => this.melee++),
      ev.on('perfectReload', () => (this.perfect = true)),
      ev.on('propShot', (c: Collider, p: THREE.Vector3) => this.onPropShot(c, p)),
      ev.on('driftBoost', () => this.drifts++),
      ev.on('trick', () => this.tricks++),
      ev.on('weaponSwap', () => this.swaps++)
    );
    // skipping: hold BACKSPACE, or click
    this.skipEl = document.createElement('div');
    this.skipEl.style.cssText = "position:absolute;right:3vw;top:3vh;font-family:'Alagard';font-size:16px;color:#e8fff2;opacity:.7;z-index:9;pointer-events:auto;cursor:pointer;padding:8px 12px;text-shadow:0 2px 0 #0a2a1a";
    this.skipEl.textContent = say('hold BACKSPACE to skip the lesson ▸', 'tap here to skip the lesson ▸');
    this.skipEl.onpointerdown = (e) => {
      e.stopPropagation();
      this.skip();
    };
    this.ctx.engine.overlay.append(this.skipEl);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    // passing a single step
    this.nextEl = document.createElement('div');
    this.nextEl.style.cssText = "position:absolute;right:3vw;top:calc(3vh + 34px);font-family:'Alagard';font-size:14px;color:#e8fff2;opacity:.55;z-index:9;pointer-events:auto;cursor:pointer;padding:6px 12px;text-shadow:0 2px 0 #0a2a1a";
    this.nextEl.textContent = say('N: next step  >', 'tap here: next step  >');
    this.nextEl.onpointerdown = (e) => {
      e.stopPropagation();
      this.stepSkip = true;
    };
    this.ctx.engine.overlay.append(this.nextEl);
    window.addEventListener('keydown', this.onNext);
    // the ledger: notice when he opens it (the scene pauses the lesson while it is up)
    const L = (this.ctx.engine.current as any)?.ledger as { toggle(v?: boolean): void; open: boolean } | undefined;
    if (L?.toggle && !this.lesson) {
      const orig = L.toggle;
      L.toggle = (v?: boolean) => {
        if (v ?? !L.open) this.ledgerSeen = true;
        orig.call(L, v);
      };
      this.ledgerRestore = () => (L.toggle = orig);
    }
    this.co = this.lesson ? this.lessonScript(this.lesson) : this.script();
  }

  private ground = (x: number, z: number) => this.ctx.world.groundAt(x, z);

  // ------------------------------------------------------------------ the lesson
  private *script(): Script {
    const sp = this.spirit;
    this.ctx.sfx('divine_chime', null, 0.6);
    yield 0.7;
    yield* this.line("Ride with me a while, bone-rider. Let's shake the rust off.", 'happy', 'present');

    // 1. ride, carve, tuck
    this.setGoals(
      TOUCH
        ? ['RIDE   hold your left thumb down', 'STEER   drag it into the turns', 'TUCK   flick up, keep it high']
        : ['PUSH   tap SHIFT  on the beat', 'CARVE   A / D  into the turns', 'TUCK   hold SPACE downhill']
    );
    yield* this.line(
      say(
        'The sand carries no lazy rider. Tap SHIFT to kick, and kick again as your foot lands back on the board. A and D to carve, hold SPACE to tuck.',
        'The sand carries no lazy rider. Hold your left thumb on the sand and the board kicks along. Drag it to steer, flick it up and keep it high to tuck.'
      ),
      'neutral',
      'point'
    );
    yield this.until(() => {
      this.check(0, this.rideDist > 26);
      this.check(1, this.carveT > 0.8);
      this.check(2, this.tuckT > 1.0);
      return this.goals.every((g) => g.done);
    });
    yield 0.5;
    this.clearGoals();
    yield* this.line('Ha! The sand still remembers you.', 'laugh', 'open');

    // 2. drift and sling out of it
    this.drifts = 0;
    this.setGoals(TOUCH ? ['DRIFT   flick your left thumb sideways', 'SLING   ease it back'] : ['DRIFT   hold SHIFT through an A / D carve', 'SLING   let go of SHIFT']);
    yield* this.line(
      say('Hold your foot down through a hard carve and the board slides out sideways. Let go, and the sand slings you out of it faster.', 'Flick your left thumb sideways and the board slides out into a drift. Ease it back, and the sand slings you out of it faster.'),
      'neutral',
      'point'
    );
    yield this.until(() => {
      if (this.player.board.drifting) this.check(0, true);
      if (this.drifts > 0) {
        this.check(0, true);
        this.check(1, true);
      }
      return this.drifts > 0;
    });
    yield 0.4;
    this.clearGoals();
    yield* this.line('Now you ride like you mean it.', 'happy', 'open');

    // 2. charge a jump and land it
    this.jumpCharged = false;
    this.landed = null;
    const jumpGoal = say('JUMP   hold SPACE ... release', 'JUMP   flick up, hold ... ease back');
    this.setGoals([jumpGoal, 'LAND IT   stay level']);
    yield* this.line(say('Now hold SPACE to coil those bones, let go to fly, and land it clean.', 'Now flick your left thumb up and hold it to coil those bones, ease back to fly, and land it clean.'), 'neutral', 'beckon');
    yield this.until(() => {
      if (this.jumpCharged) this.check(0, true);
      if (this.landed) {
        if (this.landed.quality === 'bail') {
          this.landed = null;
          this.jumpCharged = false;
          this.bailed++;
          this.retext(0, jumpGoal, false);
          if (this.bailed <= 2) this.quip(['Ouch. Knees soft, bones. Again.', 'Gravity: one. Skeleton: zero. Again!'][this.bailed - 1]);
        } else this.check(1, true);
      }
      return this.goals.every((g) => g.done);
    });
    yield 0.4;
    this.clearGoals();
    yield* this.line('Graceful. For a corpse.', 'smug', 'present');

    // 4. a trick in the air
    this.tricks = 0;
    this.setGoals(TOUCH ? ['TRICK   in the air, flick your left thumb', 'LAND IT   clean'] : ['TRICK   in the air, hold SHIFT + W A S D', 'LAND IT   clean']);
    yield* this.line(
      say('Style pays. Up in the air, hold SHIFT and lean with W A S D to spin and flip. Land it and the bounty board takes notice.', 'Style pays. Up in the air, flick your left thumb sideways to spin, up or down to flip. Land it and the bounty board takes notice.'),
      'smug',
      'beckon'
    );
    yield this.until(() => {
      if (this.tricks > 0) {
        this.check(0, true);
        this.check(1, true);
      }
      return this.tricks > 0;
    });
    yield 0.4;
    this.clearGoals();
    yield* this.line('Show-off. I love it.', 'laugh', 'open');

    // 3. aim and shoot: three skulls rise out of the sand
    sp.pose = 'raise';
    sp.flick();
    this.raiseTargets();
    yield 1.0;
    this.setGoals(TOUCH ? ['AIM   drag right, then hold still', 'SHOOT   keep the sights on a skull', 'SKULLS   0 / 3'] : ['AIM   hold RIGHT MOUSE', 'SHOOT   LEFT MOUSE', 'SKULLS   0 / 3']);
    yield* this.line(
      say(
        'Three old skulls with bad attitudes. Aim with the right mouse, shoot with the left. On anything with a head, go for the head: headshots hit hardest.',
        'Three old skulls with bad attitudes. Drag your right thumb to aim and hold it still; keep the sights on one and the gun speaks for itself. On anything with a head, go for the head.'
      ),
      'stern',
      'point'
    );
    yield this.until(() => {
      if (this.player.aiming) this.check(0, true);
      const hit = 3 - this.targetsLeft;
      if (hit > 0) this.check(1, true);
      this.retext(2, `SKULLS   ${hit} / 3`, hit >= 3);
      this.keepTargetsNear();
      return this.targetsLeft <= 0;
    });
    yield 0.5;
    this.clearGoals();
    this.sinkAll();
    yield* this.line('Three for three. Sethos ought to be worried.', 'happy', 'open');

    // 4. reload with the timing ring
    this.perfect = false;
    this.reloads = 0;
    this.player.ammo = Math.min(this.player.ammo, 1);
    this.setGoals(TOUCH ? ['RELOAD   tap the cylinder', 'VENOM ROUNDS   tap again in the bright window'] : ['RELOAD   R', 'VENOM ROUNDS   R again in the bright window']);
    yield* this.line(
      say(
        'Your cylinder is nearly dry. Press R and Pinch spins it for you; when his ring flashes in the bright window, press R again.',
        'Your cylinder is nearly dry. Tap it and Pinch spins it for you; when his ring flashes in the bright window, tap it again.'
      ),
      'neutral',
      'present'
    );
    yield this.until(() => {
      const R = this.player.reload;
      if (R.active) this.check(0, true);
      if (this.wasReloading && !R.active && !this.perfect) {
        this.reloads++;
        if (this.reloads < 3) {
          this.quip(this.reloads === 1 ? 'Too early or too late. Again, and watch the ring.' : say('Closer. Feel the click, then press.', 'Closer. Feel the click, then tap.'));
          this.player.ammo = Math.min(this.player.ammo, 1);
        }
      }
      this.wasReloading = R.active;
      if (this.perfect) this.check(1, true);
      return this.perfect || this.reloads >= 3;
    });
    yield 0.5;
    this.clearGoals();
    yield* this.line(this.perfect ? 'Venom rounds. My own recipe. Mind the aftertaste.' : 'Close enough. Practice makes poison.', 'smug', 'idle');

    // 5. kick
    this.melee = 0;
    this.setGoals([say('KICK   F', 'KICK   swipe your right thumb down')]);
    yield* this.line(say('Something too close for lead? Kick it. F.', 'Something too close for lead? Kick it. Swipe your right thumb down.'), 'stern', 'beckon');
    yield this.until(() => {
      this.check(0, this.melee > 0);
      return this.melee > 0;
    });
    yield 0.4;
    this.clearGoals();
    yield* this.line('Lovely form. Very... bony.', 'laugh', 'open');

    // (the dodge ring, guns, the tarot, the soul jar and digging come later, as lessons)

    // 6. grapple the totem
    sp.pose = 'raise';
    this.raiseTotem();
    yield 1.0;
    this.setGoals([say('GRAPPLE   aim at the totem, press Q', 'GRAPPLE   aim at the totem, swipe up')]);
    yield* this.line(say('Last trick. Aim at my totem and hook it with Q.', 'Last trick. Aim at my totem and swipe your right thumb up to hook it.'), 'neutral', 'point');
    yield this.until(() => {
      const hooked = this.player.board.grapple.active;
      this.check(0, hooked);
      this.keepTargetsNear();
      return hooked;
    });
    yield 1.2;
    this.clearGoals();
    this.sinkAll();
    yield* this.line('Hooked. Nothing out here outruns you now.', 'happy', 'open');

    // 9. the break and the bell, 10. the ledger
    yield* this.breakLesson();
    yield* this.ledgerLesson();
    yield* this.line(say("There. You're ready, or close enough to fake it.", "There. You're ready, or close enough to fake it. When the cards wake, tap them."), 'happy', 'open');

    // farewell
    sp.pose = 'open';
    yield* this.line('Sethos waits at the eye of the storm. A hundred waves stand between you and your name.', 'stern', 'open', 1.6);
    yield* this.line('Ride well, bone-rider. I will be watching.', 'happy', 'present', 1.0);
    yield* this.depart(false);
  }

  // ------------------------------------------------------------------ a later lesson
  private *lessonScript(id: LessonId): Script {
    this.ctx.sfx('divine_chime', null, 0.6);
    yield 0.6;
    yield* this.line(LESSON_INTRO[id], 'happy', 'present');
    switch (id) {
      case 'dodge':
        yield* this.dodgeLesson();
        break;
      case 'guns':
        yield* this.gunsLesson();
        break;
      case 'tarot':
        yield* this.tarotLesson();
        break;
      case 'ult':
        yield* this.ultLesson();
        break;
      case 'dig':
        yield* this.digLesson();
        break;
      default:
        yield* this.moveLesson(id);
    }
    Unlocks.markLesson(id);
    const bye = ['Now the sand is yours again.', 'Go on. Use it.', 'That is all. Ride.'];
    yield* this.line(bye[Math.floor(Math.random() * bye.length)], 'happy', 'open', 0.5);
    yield* this.depart(false);
  }

  /** a newly unlocked board move, done for real: the goal ticks when the board reports it */
  private *moveLesson(id: TechniqueId): Script {
    const t = technique(id);
    const b = this.player.board;
    let n = 0, a = 0;
    const prev = { k: b.onSandKick, w: b.onWallRide, m: b.onManual };
    b.onSandKick = () => {
      prev.k?.();
      if (id === 'sand_kick') n++;
    };
    b.onWallRide = (on, kicked, tt) => {
      prev.w?.(on, kicked, tt);
      if (id !== 'wall_ride') return;
      if (on) a++;
      if (kicked) n++;
    };
    b.onManual = (on, how, tt) => {
      prev.m?.(on, how, tt);
      if (id === 'manual' && on) n++;
    };
    const off = this.ctx.events.on('neckSlicer', () => id === 'neck_slicer' && n++);
    this.moveRestore = () => {
      b.onSandKick = prev.k;
      b.onWallRide = prev.w;
      b.onManual = prev.m;
      off();
      this.moveRestore = null;
    };
    const goals: Record<string, string[]> = {
      sand_kick: [say('SAND KICK   in the air, tap SPACE', 'SAND KICK   in the air, flick up again')],
      wall_ride: [say('WALL RIDE   jump into a wall at an angle', 'WALL RIDE   jump into a wall at an angle'), say('KICK OFF   SPACE', 'KICK OFF   flick up')],
      manual: [say('NOSE MANUAL   double-tap W', 'NOSE MANUAL   double-tap forward')],
      dune_surf: [say('DUNE SURF   hold SPACE down a dune face', 'DUNE SURF   flick up and hold, down a dune')],
      neck_slicer: [say('NECK SLICER   hold SPACE by an enemy, FIRE on the ring', 'NECK SLICER   hold jump by an enemy, shoot on the ring')],
    };
    this.setGoals(goals[id] ?? [t.name.toUpperCase()]);
    yield* this.line(t.how, 'neutral', 'point', 0.6);
    let waited = 0;
    const limit = id === 'wall_ride' || id === 'neck_slicer' ? 60 : 40;
    yield this.until(() => {
      waited += this.lastDt;
      if (id === 'dune_surf' && b.surfing) n++;
      if (id === 'wall_ride') {
        this.check(0, a > 0);
        this.check(1, n > 0);
      } else this.check(0, n > 0);
      return n > 0 || waited > limit;
    });
    this.stepSkip = false;
    yield 0.6;
    this.clearGoals();
    this.moveRestore?.();
    yield* this.line(n > 0 ? 'Yes! Exactly like that.' : 'No wall, no dune, no matter. You will find one. Practice it out there.', n > 0 ? 'laugh' : 'smug', 'open');
  }

  // ------------------------------------------------------------------ the newer lessons
  /** a wait that the player can pass with N / the "next step" label */
  private until(fn: () => boolean): () => boolean {
    return () => {
      if (fn()) return true;
      if (!this.stepSkip) return false;
      this.stepSkip = false;
      this.speech?.show(false);
      return true;
    };
  }

  private *dodgeLesson(): Script {
    const dg = (this.ctx.enemies as unknown as { dodge?: Dodge }).dodge;
    if (!dg) return;
    this.setGoals([say('DODGE   SPACE as the ring closes', 'DODGE   do what the ring says')]);
    yield* this.line(
      say(
        'The big brutes wind up before they strike. Time slows and a ring closes on you: hit SPACE as it meets the mark and you slip the blow, with a counter waiting.',
        'The big brutes wind up before they strike. Time slows and a ring closes on you: do what it says as it meets the mark, and you slip the blow with a counter waiting.'
      ),
      'stern',
      'raise'
    );
    let ok = false;
    for (let tries = 0; tries < 3 && !ok && !this.stepSkip; tries++) {
      // she draws a spear of sand out of the dune ahead of him
      const f = this.cam.forward();
      const from = new THREE.Vector3(this.player.pos.x + f.x * 7 + f.z * 2, 0, this.player.pos.z + f.z * 7 - f.x * 2);
      from.y = this.ground(from.x, from.z);
      this.spirit.pose = 'raise';
      this.spirit.flick();
      this.ctx.sfx('spectral_scorpion', from, 0.6, 1.3);
      this.ctx.fx.sandBurst(from, 1.0);
      spiritMotes(this.ctx.particles, from, 12, 0.6, 2);
      yield 0.5;
      this.dodgeRes = null;
      void dg.offer({ from, label: 'DODGE!' }).then((r) => (this.dodgeRes = r));
      yield () => this.dodgeRes !== null || this.stepSkip;
      if (this.stepSkip) break;
      const r = this.dodgeRes as DodgeResult | null;
      if (r === 'good' || r === 'perfect') {
        ok = true;
        this.check(0, true);
      } else if (r === 'none') yield 1.5; // the ring was busy: try again shortly
      else if (r === 'fail') {
        this.ctx.fx.sandBurst(this.player.pos, 0.8);
        this.quip(tries === 0 ? 'Too slow. That one was made of sand. The next won\'t be. Again.' : 'Watch the ring, not me. Again.');
        yield 2.0;
      }
    }
    this.stepSkip = false;
    yield 0.4;
    this.clearGoals();
    yield* this.line(ok ? 'Smooth as a sidewinder.' : 'You will learn it when it matters. Probably.', ok ? 'happy' : 'smug', 'open');
  }

  private *gunsLesson(): Script {
    const carried = this.player.weapons.carried;
    if (carried.length < 2) {
      yield* this.line(
        say(
          'Find a shotgun or tommy-gun blueprint and the gun rides on your back. Then 3, 4 and 5 draw your guns, or roll the mouse wheel.',
          'Find a shotgun or tommy-gun blueprint and the gun rides on your back. Then flick the floating cylinder sideways, or tap a gun on the strip, to draw it.'
        ),
        'neutral',
        'present'
      );
      return;
    }
    this.swaps = 0;
    this.setGoals([say('SWITCH GUNS   3 / 4 / 5 or the mouse wheel', 'SWITCH GUNS   flick the cylinder sideways')]);
    yield* this.line(say('You carry more than one iron. 3, 4 and 5 draw them, or roll the wheel.', 'You carry more than one iron. Flick the floating cylinder sideways, or tap a gun on the strip, to draw it.'), 'neutral', 'present');
    yield this.until(() => {
      this.check(0, this.swaps > 0);
      return this.swaps > 0;
    });
    yield 0.4;
    this.clearGoals();
    yield* this.line('Right tool, right corpse.', 'smug', 'open');
  }

  private *tarotLesson(): Script {
    const sk = Skills.current;
    if (!sk) return;
    const lent = !sk.learned.has('G');
    yield* this.line(
      'Rank up and the tarot wakes: cards of my power, each a skill of your own. Here, borrow my Sun for a moment.',
      'happy',
      'raise'
    );
    if (lent) {
      sk.learn('G');
      this.lentSun = true;
    }
    sk.bombCharges = 2;
    const empowered = () => {
      const a = sk as unknown as { nextBombPower?: number; bombs?: { power?: number }[] };
      return (a.nextBombPower ?? 1) > 1 || !!a.bombs?.some((b) => (b.power ?? 0) > 1);
    };
    this.setGoals(TOUCH ? ['CAST   tap THE SUN card', 'EMPOWER   tap it again as the jade ring meets the sight'] : ['CAST   G   (THE SUN)', 'EMPOWER   G again as the jade ring meets the sight']);
    yield* this.line(
      say(
        'Cast it with G. A jade ring closes over your head: press G again as it meets the sight, and the cast comes out empowered.',
        'Tap the card to cast it. A jade ring closes over your head: tap it again as it meets the sight, and the cast comes out empowered.'
      ),
      'neutral',
      'point'
    );
    let casts = 0, last = sk.bombCharges, refills = 0;
    yield this.until(() => {
      if (sk.bombCharges < last) {
        casts++;
        this.check(0, true);
      }
      last = sk.bombCharges;
      if (sk.bombCharges === 0 && refills < 2) {
        refills++;
        sk.bombCharges = last = 2;
      }
      if (empowered()) this.check(1, true);
      return this.goals.every((g) => g.done) || casts >= 5;
    });
    yield 1.4;
    this.clearGoals();
    this.returnSun();
    yield* this.line(lent ? 'And back up my sleeve it goes. Earn your own cards at the rank-ups.' : 'You knew that one already. Show-off.', 'smug', 'open');
  }

  private *ultLesson(): Script {
    const cur = this.ctx.engine.current as unknown as { ult?: { active: boolean } } | null;
    const run = this.ctx.run;
    yield* this.line('Every kill in a streak pours a soul into your canopic jar. When it brims, I come in person. Let me fill it for you, just this once.', 'happy', 'raise');
    run.ultCharge = 1;
    this.ctx.sfx('ult_ready', null, 0.7);
    spiritMotes(this.ctx.particles, this.player.center(new THREE.Vector3()), 20, 0.8, 2);
    this.setGoals(TOUCH ? ['SOUL JAR   full', "SERKET'S WRATH   tap the soul jar"] : ['SOUL JAR   full', "SERKET'S WRATH   Z"]);
    this.check(0, true);
    yield* this.line(say('Now. Press Z.', 'Now. Tap the jar.'), 'stern', 'beckon');
    let seen = false, waited = 0;
    yield this.until(() => {
      waited += this.lastDt;
      if (cur?.ult?.active) seen = true;
      if (seen || run.ultCharge < 0.5) this.check(1, true);
      return (seen && !cur?.ult?.active) || (!seen && run.ultCharge < 0.5) || waited > 30;
    });
    this.stepSkip = false;
    yield 0.6;
    this.clearGoals();
    yield* this.line(seen ? 'Did you feel that? That was me holding back.' : 'Keep it full, then. The dead will give you reasons.', 'laugh', 'open');
  }

  private *digLesson(): Script {
    const tr = (this.ctx.engine.current as any)?.treasure;
    const plant = () => {
      if (!tr?.addSite) return null;
      const at = this.aheadPoint(10, 1.5);
      at.y = this.ground(at.x, at.z);
      const z = (this.ctx.world as unknown as { zone?: { index: number; name: string } }).zone ?? { index: 0, name: 'the flats' };
      try {
        return tr.addSite('glint', at, z, { kind: 'gold' });
      } catch {
        return null;
      }
    };
    const site = plant();
    if (!site) {
      yield* this.line(say('Brass glints in the sand and heaped mounds hide old caches. Slow down over them and hold T to dig.', 'Brass glints in the sand and heaped mounds hide old caches. Slow down, touch the spot and hold to dig.'), 'neutral', 'point');
      return;
    }
    this.dig = { site, tr };
    this.ctx.sfx('sand_rise', site.pos, 0.6);
    this.setGoals([say('DIG   slow down on the glint, hold T', 'DIG   slow down, touch the glint and hold')]);
    yield* this.line(
      say(
        'See that glint in the sand? I dropped a coin. The desert keeps everything: glints, mounds, maps with an X. Slow down over it and hold T to dig.',
        'See that glint in the sand? I dropped a coin. The desert keeps everything: glints, mounds, maps with an X. Slow down, touch the spot and hold to dig.'
      ),
      'happy',
      'point'
    );
    let far = 0;
    yield this.until(() => {
      const d = this.dig!;
      if (d.site.done) {
        this.check(0, true);
        return true;
      }
      far = d.site.pos.distanceTo(this.player.pos) > 40 ? far + this.lastDt : 0;
      if (far > 3) {
        far = 0;
        this.dropDig();
        const s2 = plant();
        if (!s2) return true;
        this.dig = { site: s2, tr };
        this.quip('Over here, bone-rider.');
      }
      if (Math.random() < this.lastDt * 4) spiritMotes(this.ctx.particles, d.site.pos, 1, 0.3, 1.2);
      return false;
    });
    if (!this.dig?.site.done) this.dropDig();
    this.dig = null;
    yield 0.5;
    this.clearGoals();
    yield* this.line('Finders keepers. Maps lead to relics, and relics stay yours forever.', 'smug', 'open');
  }

  /** the borrowed card goes back up her sleeve */
  private returnSun() {
    if (!this.lentSun) return;
    this.lentSun = false;
    Skills.current?.learned.delete('G');
  }

  /** take back a dig spot he never dug */
  private dropDig() {
    const d = this.dig;
    if (!d || d.site.done) return;
    d.site.done = true;
    if (d.site.inter) d.tr.d?.inter?.remove?.(d.site.inter);
    d.site.inter = null;
    if (d.site.obj) d.site.obj.visible = false;
  }

  private *breakLesson(): Script {
    this.setGoals(TOUCH ? ['BREAK   30 s of quiet between waves', 'THE BELL   hold the stopwatch to call the next wave'] : ['BREAK   30 s of quiet between waves', 'THE BELL   hold T to call the next wave']);
    yield* this.line(
      say(
        'When a wave falls, the sand rests for thirty seconds and your bones knit. Shop, dig, or hold T to ring the bell and call the next wave early. Greed pays, if you live.',
        'When a wave falls, the sand rests for thirty seconds and your bones knit. Shop, dig, or hold the stopwatch to ring the bell and call the next wave early. Greed pays, if you live.'
      ),
      'stern',
      'present',
      1.4
    );
    this.clearGoals();
  }

  private *ledgerLesson(): Script {
    this.ledgerSeen = false;
    this.setGoals([say('LEDGER   TAB to open, TAB to close', 'LEDGER   tap the tin star')]);
    yield* this.line(
      say(
        'Down your left side hangs the trail ledger: your rank, the next boss, the next zone, your finds. The brass compass points to Gobi, my walking turtle of a shop. TAB opens your full ledger.',
        'Down your left side hangs the trail ledger: your rank, the next boss, the next zone, your finds. The brass compass points to Gobi, my walking turtle of a shop. Tap the tin star for your full ledger.'
      ),
      'neutral',
      'point'
    );
    let waited = 0;
    yield this.until(() => {
      waited += this.lastDt;
      this.check(0, this.ledgerSeen);
      return this.ledgerSeen || waited > 20;
    });
    this.stepSkip = false;
    yield 0.4;
    this.clearGoals();
    yield* this.line('Every number in there is a promise. Keep it.', 'happy', 'open');
  }

  /** she speaks: typed words floating by her head while her jaw moves */
  private *line(s: string, expr = 'neutral', pose: SpiritPose = 'idle', hold = 1.1): Script {
    this.spirit.setExpression(expr);
    this.spirit.pose = pose;
    this.speech?.show(false);
    const t = new FloatText3D(s, { size: 0.12, color: JADE, glow: JADE_GLOW, cps: 40, wrap: 30, hdr: 1.6 });
    this.ctx.scene.add(t.mesh);
    this.texts.push(t);
    this.speech = t;
    this.spirit.talking = true;
    this.ctx.sfx('divine_whisper', null, 0.32);
    while (!t.done) yield 0;
    this.spirit.talking = false;
    yield hold + s.length * 0.012;
    t.show(false);
  }

  /** a short aside without blocking the step */
  private quip(s: string) {
    this.speech?.show(false);
    const t = new FloatText3D(s, { size: 0.11, color: JADE, glow: JADE_GLOW, cps: 44, wrap: 30, hdr: 1.5 });
    this.ctx.scene.add(t.mesh);
    this.texts.push(t);
    this.speech = t;
    this.spirit.setExpression('sad');
    this.spirit.talking = true;
    this.ctx.engine.tweens.after(1.2, () => (this.spirit.talking = false));
    this.ctx.engine.tweens.after(3.2, () => t.show(false));
  }

  private *depart(fast: boolean): Script {
    this.leaving = true;
    this.clearGoals();
    this.sinkAll();
    const sp = this.spirit;
    sp.pose = 'raise';
    sp.flick();
    this.ctx.sfx('soul_leave', null, 0.8);
    this.sand.center.copy(sp.root.position);
    this.sand.bodyH = sp.height * sp.scale;
    this.sand.bodyR = 0.35;
    this.sand.gather = 1;
    const dur = fast ? 0.6 : 2.2;
    let t = 0;
    while (t < dur) {
      const k = t / dur;
      sp.form = 1 - k;
      this.halo.fade = 1 - k;
      this.sand.intensity = Math.sin(k * Math.PI) * 1.2;
      this.sand.center.copy(sp.root.position);
      if (Math.random() < 0.6) spiritMotes(this.ctx.particles, sp.socket('core'), 2, 0.5 * sp.scale, 2);
      t += yield 0;
    }
    sp.form = 0;
    this.done = true;
  }

  // ------------------------------------------------------------------ goals (floating key prompts by the rider)
  private setGoals(labels: string[]) {
    this.clearGoals();
    this.stepSkip = false;
    this.goals = labels.map((l) => ({ label: l, done: false, text: this.keyText(l, false) }));
  }
  private keyText(s: string, done: boolean) {
    const t = new FloatText3D(s, done ? { size: 0.1, color: '#c8ff9a', glow: '#3cff6a', cps: 0, wrap: 60, hdr: 1.5 } : { size: 0.1, color: KEYS, glow: KEY_GLOW, cps: 60, wrap: 60, hdr: 1.3 });
    this.ctx.scene.add(t.mesh);
    this.texts.push(t);
    return t;
  }
  private retext(i: number, s: string, done: boolean) {
    const g = this.goals[i];
    if (!g || (g.label === s && g.done === done)) return;
    g.label = s;
    g.done = done;
    g.text.show(false);
    g.text = this.keyText(done ? `~ ${s} ~` : s, done);
  }
  private check(i: number, ok: boolean) {
    const g = this.goals[i];
    if (!g || g.done || !ok) return;
    this.retext(i, g.label, true);
    this.ctx.sfx('qte_good', null, 0.6);
    this.ctx.fx.sparkle(this.player.center(new THREE.Vector3()).add(new THREE.Vector3(0, 0.9, 0)), 0x9dff3a, 8, 0.5);
  }
  private clearGoals() {
    for (const g of this.goals) g.text.show(false);
    this.goals = [];
  }

  // ------------------------------------------------------------------ targets and the totem
  private loadStatic(key: string) {
    const e = modelEntry(key)?.() as { model: VoxelModel; voxelSize: number } | undefined;
    if (!e?.model) return null;
    const g = buildVoxelGeometry(e.model, { voxelSize: e.voxelSize, pivot: 'bottom' });
    const b = e.model.bounds();
    return { g, h: (b.maxY - b.minY + 1) * e.voxelSize };
  }

  private raise(key: string, at: THREE.Vector3, opts: { grapple?: boolean; target?: boolean }) {
    const m = this.loadStatic(key) ?? this.loadStatic('cattle_skull_post');
    if (!m) return;
    at.y = this.ground(at.x, at.z);
    const mesh = new THREE.Mesh(m.g, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(at).add(new THREE.Vector3(0, -m.h - 0.2, 0));
    mesh.rotation.y = Math.atan2(this.player.pos.x - at.x, this.player.pos.z - at.z);
    this.ctx.scene.add(mesh);
    const cols = this.ctx.world.colliders;
    const col = opts.grapple
      ? cols.circle(at.x, at.z, 0.6, at.y, at.y + m.h, { solid: false, bullets: false, tag: 'grapple', data: { tutorial: true } })
      : cols.circle(at.x, at.z, 0.42, at.y, at.y + m.h + 0.1, { solid: false, bullets: true, tag: 'tutorial_target', data: { tutorial: true } });
    const halo = new GlyphRings(this.ctx.scene, [{ radius: opts.grapple ? 0.9 : 0.55, y: 0, count: opts.grapple ? 8 : 6, speed: 1.2, tilt: [0.12, 0] }], 1.8);
    halo.group.position.copy(at).add(new THREE.Vector3(0, m.h + 0.45, 0));
    this.props.push({ mesh, col, at: at.clone(), rise: 0, sink: false, alive: true, halo, h: m.h });
    if (opts.target) this.targetsLeft++;
    this.ctx.sfx('sand_rise', at, 0.8);
    this.ctx.fx.sandBurst(at, 1.1);
    spiritMotes(this.ctx.particles, at, 8, 0.6, 1.5);
  }

  private aheadPoint(dist: number, lateral: number) {
    const f = this.cam.forward();
    const v = this.player.board.vel;
    // lead the rider a little so the targets come up in front of a moving board
    return new THREE.Vector3(this.player.pos.x + f.x * dist - f.z * lateral + v.x * 0.6, 0, this.player.pos.z + f.z * dist + f.x * lateral + v.z * 0.6);
  }

  private raiseTargets() {
    for (const [dd, lat] of [[13, -4], [17, 3.5], [22, -0.5]]) this.raise('cattle_skull_post', this.aheadPoint(dd, lat), { target: true });
  }
  private raiseTotem() {
    this.raise('scorpion_totem', this.aheadPoint(17, 2), { grapple: true });
  }

  /** if he rides off and leaves the lesson behind, the sand brings it back in front of him */
  private keepTargetsNear() {
    const live = this.props.filter((p) => p.alive && !p.sink);
    if (!live.length) return;
    const near = live.some((p) => p.at.distanceTo(this.player.pos) < 45);
    this.farT = near ? 0 : this.farT + this.lastDt;
    if (this.farT < 3) return;
    this.farT = 0;
    const grapple = live.some((p) => p.col?.tag === 'grapple');
    for (const p of live) this.removeProp(p, true);
    this.targetsLeft = 0;
    if (grapple) this.raiseTotem();
    else for (let i = 0; i < live.length; i++) this.raise('cattle_skull_post', this.aheadPoint(13 + i * 4, (i % 2 ? 3 : -3)), { target: true });
    this.quip('Over here, bone-rider.');
  }

  private onPropShot(c: Collider, p: THREE.Vector3) {
    const t = this.props.find((q) => q.col === c && q.alive);
    if (!t) return;
    const at = p ?? t.at;
    this.ctx.fx.hit(at, { x: 0, y: 1, z: 0 }, 'bone', 1.6);
    this.ctx.fx.word(at, 'w_crack');
    this.ctx.sfx('hit_bone', at, 1);
    this.ctx.sfx('rock_crumble', at, 0.6);
    this.ctx.events.emit('gibs', at.x, at.y, at.z, 16, 0.07, [0xf2dcb4, 0xd6b78a, 0xfff1d6, 0x8a6a3a], 5, 3);
    spiritMotes(this.ctx.particles, at, 6, 0.3, 1.2);
    this.removeProp(t, false);
    this.targetsLeft = Math.max(0, this.targetsLeft - 1);
    this.spirit.snip();
  }

  private removeProp(t: Totem, sink: boolean) {
    t.alive = false;
    if (t.col) this.ctx.world.colliders.remove(t.col);
    t.col = null;
    if (sink) t.sink = true;
    else {
      t.mesh.visible = false;
      t.halo.fade = 0;
    }
  }
  private sinkAll() {
    for (const p of this.props) if (p.alive) this.removeProp(p, true);
  }

  // ------------------------------------------------------------------ frame
  skip() {
    if (this.leaving || this.done) return;
    this.skipped = true;
    if (this.lesson) Unlocks.markLesson(this.lesson);
    this.moveRestore?.();
    this.speech?.show(false);
    this.dropDig();
    this.dig = null;
    this.returnSun();
    this.co = this.depart(true);
    this.wait = 0;
  }

  update(dt: number) {
    if (this.done) return;
    this.t += dt;
    this.lastDt = dt;
    const pl = this.player;
    const b = pl.board;
    // what he's doing
    if (b.grounded && b.speed > 3) this.rideDist += b.speed * dt;
    if (b.grounded && b.speed > 4 && Math.abs(b.turnSpeed) > 0.7) this.carveT += dt;
    if (b.grounded && b.tucked && b.speed > 2) this.tuckT += dt;
    // skip by holding Backspace (real time, so a slow frame can't swallow it)
    const held = this.skipDown ? (performance.now() - this.skipDown) / 1000 : 0;
    this.skipEl.style.opacity = String(0.7 + Math.min(0.3, held * 0.5));
    if (held > 0.6) this.skip();
    // the script
    if (typeof this.wait === 'number') {
      this.wait -= dt;
      if (this.wait <= 0) this.step(dt);
    } else if (this.wait()) this.step(dt);
    // the guide floats at his side, leaning into the ride, looking at him
    const sp = this.spirit;
    if (!this.leaving) {
      guideSpot(pl.pos, this.cam.yaw, this.ground, this.spot);
      const k = 1 - Math.exp(-dt * (3.2 + b.speed * 0.4));
      const before = sp.root.position.clone();
      sp.root.position.lerp(this.spot.pos, k);
      this.vel.copy(sp.root.position).sub(before).divideScalar(Math.max(dt, 1e-3));
      sp.form = Math.min(1, sp.form + dt * 1.2);
      sp.scale += (this.spot.scale - sp.scale) * k;
      this.halo.appear = Math.min(1, this.halo.appear + dt * 0.8);
    }
    const yawTo = Math.atan2(pl.pos.x - sp.root.position.x, pl.pos.z - sp.root.position.z);
    let dy = yawTo - sp.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    sp.root.rotation.y += dy * Math.min(1, dt * 4);
    sp.root.rotation.z = THREE.MathUtils.clamp(-this.vel.dot(new THREE.Vector3(Math.cos(sp.root.rotation.y), 0, -Math.sin(sp.root.rotation.y))) * 0.012, -0.25, 0.25);
    sp.look = pl.center(new THREE.Vector3()).add(new THREE.Vector3(0, 0.4, 0));
    sp.update(dt);
    this.halo.group.position.copy(sp.root.position);
    this.halo.update(dt);
    this.sand.update(dt, this.ctx.world.env.fog);
    if (Math.random() < dt * 6) spiritMotes(this.ctx.particles, sp.socket('core'), 1, 0.4 * sp.scale, 0.8);
    // props rising / sinking
    for (const p of this.props) {
      if (p.sink) p.rise = Math.max(0, p.rise - dt * 1.4);
      else if (p.alive) p.rise = Math.min(1, p.rise + dt * 1.1);
      const e = p.rise * p.rise * (3 - 2 * p.rise);
      p.mesh.position.y = p.at.y - (p.h + 0.2) * (1 - e) + (p.alive ? Math.sin(this.t * 2 + p.at.x) * 0.0 : 0);
      if (p.sink && p.rise > 0 && Math.random() < dt * 12) this.ctx.fx.sandSpray(p.at, { x: 0, y: 1, z: 0 }, 0.4);
      if (p.sink && p.rise <= 0) p.mesh.visible = false;
      p.halo.fade = p.alive ? 1 : Math.max(0, p.halo.fade - dt * 2);
      p.halo.appear = Math.min(1, p.halo.appear + dt * 1.2);
      p.halo.update(dt);
    }
    // floating words, held at a fixed distance from the lens so they always read: her lines
    // beside her head, the key prompts hanging in the air above the rider
    const cam = this.ctx.camera;
    const lens = (at: THREE.Vector3, out: THREE.Vector3) => out.copy(cam.position).addScaledVector(at.sub(cam.position).normalize(), 3.4);
    if (this.speech) lens(sp.socket('head_top').add(new THREE.Vector3(0, 0.3, 0)), this.speech.anchor);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const fw = cam.getWorldDirection(new THREE.Vector3());
    const base = cam.position.clone().addScaledVector(fw, 3.4).addScaledVector(up, 0.78);
    this.goals.forEach((g, i) => g.text.anchor.copy(base).addScaledVector(up, -i * 0.15));
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.update(dt, cam, t === this.speech && sp.talking ? (c, i, s) => Voice.syllable('serket', c, { index: i, text: s }) : undefined);
      if (t !== this.speech && !this.goals.some((g) => g.text === t) && t.visibleAmount < 0.01) {
        t.dispose();
        this.texts.splice(i, 1);
      }
    }
  }

  private step(dt: number) {
    const r = this.co.next(dt);
    this.wait = r.done ? 1e9 : r.value;
    if (r.done) this.done = true;
  }

  dispose() {
    const b = this.player.board;
    b.onJump = this.prevJump;
    b.onLand = this.prevLand;
    for (const u of this.unsub) u();
    this.moveRestore?.();
    if (this.lesson) Unlocks.markLesson(this.lesson);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('keydown', this.onNext);
    this.skipEl.remove();
    this.nextEl.remove();
    this.ledgerRestore?.();
    this.dropDig();
    this.returnSun();
    for (const t of this.texts) t.dispose();
    this.texts = [];
    for (const p of this.props) {
      if (p.col) this.ctx.world.colliders.remove(p.col);
      p.mesh.removeFromParent();
      p.mesh.geometry.dispose();
      p.halo.dispose();
    }
    this.props = [];
    this.mat.dispose();
    this.spirit.dispose();
    this.halo.dispose();
    this.sand.dispose();
  }
}
