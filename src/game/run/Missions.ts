// Landmark encounters: ride up to a tall wooden landmark, press T, and a short
// walk-in cinematic plays (crane around the building, title cut-in), then a
// notice offers its mission. One mission at a time, each landmark once per run.
//   Trading Post  → Gobi's turtle house: talk to Ozymandias, go inside to shop
//   Outlaw Fort   → clear the fort before the timer runs out
//   Abandoned Mine→ strike ore veins (timing bar) while scarabs swarm
//   Dusty Ranch   → rustlers took a camel: beat the guards, cut it loose
//   Sheriff's     → a WANTED alpha: hunt it down
//   Saloon        → five-card showdown with the dealer (double or nothing)
import * as THREE from 'three';
import type { Ctx, EnemyLike } from '../Ctx';
import type { Player } from '../player/Player';
import type { Enemies } from '../enemies/Enemies';
import type { Props, PropInst } from '../world/Props';
import type { CameraRig } from '../player/CameraRig';
import type { Qte } from '../ui/Qte';
import type { Choice } from '../ui/Choice';
import { Shop, merchantStock, type MerchantHooks, type Ware } from '../ui/Shop';
import { ITEMS, type ItemId } from '../player/Items';
import { Interactions, Interactable, Chest, ChestTier } from './Interact';
import type { Inventory } from '../player/Items';
import { modelEntry } from '../models/lookup';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { makeVoxelMaterial } from '../../engine/render/VoxelMaterial';
import { RigEyes, emote } from '../fx/FaceFx';
import { rnd } from '../../engine/math/rand';

export interface MissionDeps {
  ctx: Ctx;
  player: Player;
  enemies: Enemies;
  props: Props;
  inter: Interactions;
  choice: Choice;
  shop: Shop;
  qte: Qte;
  cam: CameraRig;
  items: Inventory;
  /** pick an upgrade card (rank-up flow) */
  card(): void;
  /** spawn a loot chest */
  chest(x: number, z: number, tier: ChestTier): Chest;
  addBounty(v: number): void;
  /** gear pieces the merchant also sells */
  gearWares?: () => Ware[];
}

interface Npc {
  rig: RigInstance;
  eyes: RigEyes | null;
  kind: 'merchant' | 'camel';
  t: number;
  /** the trading post this merchant belongs to, its trade prompt and its shop hooks */
  lm?: PropInst;
  inter?: Interactable;
  hooks?: MerchantHooks;
}

interface Active {
  type: string;
  name: string;
  text: string;
  sub: string;
  marker: THREE.Vector3 | null;
  timeLeft: number;
  update(dt: number): 'run' | 'win' | 'fail';
  reward(): void;
  cleanup?(): void;
}

export class Missions {
  active: Active | null = null;
  private seen = new Set<PropInst>();
  private done = new Set<PropInst>();
  private npcs: Npc[] = [];
  private busy = false;

  constructor(private d: MissionDeps) {}

  /** register newly built landmarks */
  scan() {
    for (const lm of this.d.props.landmarks) {
      if (this.seen.has(lm)) continue;
      this.seen.add(lm);
      const meta = lm.extra?.meta ?? {};
      const ent = meta.entrance as [number, number] | undefined;
      const fp = meta.footprint as [number, number] | undefined;
      const door = ent ? this.d.props.landmarkPoint(lm, ent[0], ent[1]) : this.d.props.landmarkPoint(lm, 0, (fp?.[1] ?? 12) * 0.5 + 2);
      const type = lm.extra.type as string;
      const name = lm.anchor.data?.name ?? type;
      const inter: Interactable = {
        pos: door.clone(),
        radius: 7,
        label: type === 'tradingPost' ? 'Talk to Ozymandias' : `Enter ${name}`,
        enabled: true,
        promptY: type === 'tradingPost' ? 3.2 : 2.4,
        use: () => void this.enter(lm, inter, door),
      };
      this.d.inter.add(inter);
      if (type === 'tradingPost') this.spawnMerchant(lm, door, inter);
    }
  }

  /**
   * The trading post is Gobi, a giant turtle with a little shop-house and an
   * acacia on his shell, plodding round his campfire; Ozymandias, the tortoise
   * who keeps the shop, stands on the porch. (If the turtle model is missing,
   * Old Mother Tamsin keeps the shop on foot by the camp.)
   */
  private spawnMerchant(lm: PropInst, door: THREE.Vector3, inter: Interactable) {
    const ctx = this.d.ctx;
    const out = new THREE.Vector3(door.x - lm.anchor.x, 0, door.z - lm.anchor.z).normalize();
    const face = Math.atan2(out.x, out.z);
    const rigOf = (key: string) => {
      const spec = modelEntry(key)?.() as RigSpec | undefined;
      return spec?.parts ? new RigInstance(buildRigGeo(spec, key + ':npc'), { material: makeVoxelMaterial() }) : null;
    };
    const home = new THREE.Vector3(lm.anchor.x, 0, lm.anchor.z);
    const gobi = rigOf('turtle_house');
    const ozzy = gobi ? rigOf('tortoise_guy') : null;
    if (gobi) {
      // he starts beside the fire, side-on, already on his rounds (the shop seats Ozymandias on the porch)
      const at = home.clone().addScaledVector(out, 4.5);
      gobi.root.position.set(at.x, ctx.world.groundAt(at.x, at.z), at.z);
      gobi.root.rotation.y = face + Math.PI / 2;
      ctx.scene.add(gobi.root);
      const p = this.d.player;
      this.npcs.push({ rig: gobi, eyes: null, kind: 'merchant', t: rnd.next() * 10, lm, inter, hooks: this.shopHooks({ rider: ozzy, home, hunter: { rig: p.rig, gun: p.gun, root: p.root } }) });
      return;
    }
    const tamsin = rigOf('merchant');
    if (tamsin) {
      const at = door.clone();
      tamsin.root.position.set(at.x, ctx.world.groundAt(at.x, at.z), at.z);
      tamsin.root.rotation.y = face;
      ctx.scene.add(tamsin.root);
      this.npcs.push({ rig: tamsin, eyes: null, kind: 'merchant', t: rnd.next() * 10, lm, inter, hooks: this.shopHooks({}) });
    }
  }

  /** what the shop needs to stage a merchant's arrival scene and run his shop */
  private shopHooks(extra: Partial<MerchantHooks>): MerchantHooks {
    const d = this.d;
    return {
      board: d.player.board,
      stock: () => this.wares(),
      busy: () => this.busy || d.choice.active || !d.player.alive,
      ...extra,
    };
  }

  /**
   * The shop's shelf: the same stock until the next boss wave brings a fresh one
   * (the shop's StockBook keeps what sold), consumables + the tonic + a fortune
   * card + gear pieces, each able to say what it means for you right now.
   */
  private wares(): Ware[] {
    const d = this.d;
    return d.shop.book.stock(() => [
      ...merchantStock(d.ctx, (id) => d.items.add(id), () => d.player.heal(d.player.maxHp), () => d.card(), {
        pockets: (id: ItemId) => {
          let have = 0, room = false;
          for (const sl of d.items.slots) {
            if (!sl) room = true;
            else if (sl.id === id) {
              have += sl.count;
              if (sl.count < ITEMS[id].stack) room = true;
            }
          }
          return { have, room };
        },
        hp: () => [d.player.hp, d.player.maxHp],
      }),
      ...(d.gearWares?.() ?? []),
    ]);
  }

  /** walk-in cinematic, then the landmark's offer */
  private async enter(lm: PropInst, inter: Interactable, door: THREE.Vector3) {
    if (this.busy || this.d.choice.active || this.d.shop.active) return;
    const { ctx, cam } = this.d;
    const type = lm.extra.type as string;
    if (type !== 'tradingPost' && (this.active || this.done.has(lm))) {
      ctx.toast(this.active ? 'ONE JOB AT A TIME' : 'NOTHING LEFT HERE', '#c9a97c', this.active ? this.active.name : 'The place is quiet now.');
      return;
    }
    this.busy = true;
    const eng = ctx.engine;
    const name = (lm.anchor.data?.name as string) ?? type;
    try {
      if (type === 'tradingPost') {
        const fwd = new THREE.Vector3(door.x - lm.anchor.x, 0, door.z - lm.anchor.z).normalize();
        const rugAt = door.clone().addScaledVector(fwd, 2.2);
        const facing = Math.atan2(-fwd.x, -fwd.z);
        // this post's own merchant (he may have wandered round his camp)
        const merchant = this.npcs.find((n) => n.kind === 'merchant' && n.lm === lm) ?? this.npcs.find((n) => n.kind === 'merchant');
        if (merchant) merchant.t = 0;
        const at = merchant ? merchant.rig.root.position : rugAt;
        await this.d.shop.open(at.clone(), facing, this.wares(), merchant?.rig.root.position ?? door);
        return;
      }
      // crane shot around the landmark
      const h = (lm.extra?.meta?.height as number) ?? 12;
      const c = new THREE.Vector3(lm.anchor.x, lm.baseY + h * 0.45, lm.anchor.z);
      const R = Math.max(18, h * 1.6);
      const a0 = Math.atan2(door.x - lm.anchor.x, door.z - lm.anchor.z);
      eng.letterbox(true, 0.4);
      ctx.sfx('door_creak', door, 0.8);
      ctx.events.emit('cutin', name.toUpperCase(), '#ffd36b', 'determined');
      await eng.tweens.tween(2.2, (k) => {
        const a = a0 - 0.9 + k * 1.0;
        cam.setCine({ pos: new THREE.Vector3(c.x + Math.sin(a) * R, c.y + h * (0.5 - k * 0.25), c.z + Math.cos(a) * R), look: c, fov: 50 });
      }, (t) => t, true);
      cam.setCine({ pos: door.clone().add(new THREE.Vector3(0, 2, 0)).addScaledVector(new THREE.Vector3(door.x - lm.anchor.x, 0, door.z - lm.anchor.z).normalize(), 5), look: door.clone().add(new THREE.Vector3(0, 1.6, 0)), fov: 46 }, true);
      await eng.tweens.wait(0.5, true);
      const offer = this.offer(type, lm, door);
      const pick = await this.d.choice.show(name, [offer.card, { title: 'Ride On', body: 'Not today. The desert is big and you are mostly bones.', footer: 'Walk away' }]);
      cam.setCine(null);
      eng.letterbox(false, 0.4);
      if (pick === 0) {
        this.done.add(lm);
        inter.enabled = false;
        this.start(offer.make());
      }
    } finally {
      this.busy = false;
    }
  }

  private start(m: Active) {
    this.active = m;
    this.d.ctx.toast(m.name.toUpperCase(), '#ffd36b', m.text, true);
    this.d.ctx.sfx('poster_slam', null, 0.9);
  }

  private offer(type: string, lm: PropInst, door: THREE.Vector3): { card: { title: string; body: string; footer: string; stamp?: string; accent?: string }; make: () => Active } {
    const { ctx, enemies, player } = this.d;
    const wave = Math.max(1, ctx.run.wave);
    const spawnRing = (kind: string, n: number, c: THREE.Vector3, r0: number, r1: number, alphaChance = 0) => {
      const out: EnemyLike[] = [];
      for (let i = 0; i < n; i++) {
        const a = rnd.next() * Math.PI * 2, r = r0 + rnd.next() * (r1 - r0);
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        if (ctx.world.storm.sdf(x, z) < 4) continue;
        const e = enemies.spawn(kind, x, z, { emerge: 'run', alpha: rnd.chance(alphaChance) });
        if (e) out.push(e as unknown as EnemyLike);
      }
      return out;
    };
    switch (type) {
      case 'outlawFort': {
        const reward = 60 + wave * 6;
        return {
          card: { title: 'Clear the Fort', body: `Outlaws have dug into the old fort. Gun down every last one of them within 90 seconds.`, footer: `Reward: Gold Strongbox · ${reward} bounty`, stamp: 'WANTED' },
          make: () => {
            const c = new THREE.Vector3(lm.anchor.x, 0, lm.anchor.z);
            const foes = [...spawnRing('outlaw', 4 + Math.floor(wave / 6), c, 4, 12, 0.1), ...spawnRing('gunslinger', 5 + Math.floor(wave / 5), c, 3, 14), ...spawnRing('shotgunner', 2, c, 2, 8)];
            const total = foes.length;
            return {
              type, name: 'Clear the Fort', text: 'Gun down every outlaw', sub: '', marker: c.clone().setY(lm.baseY + 3), timeLeft: 90,
              update(dt) {
                this.timeLeft -= dt;
                const left = foes.filter((f) => f.alive).length;
                this.sub = `${total - left}/${total} outlaws`;
                if (left === 0) return 'win';
                return this.timeLeft <= 0 ? 'fail' : 'run';
              },
              reward: () => {
                this.d.chest(door.x, door.z, 'gold');
                this.d.addBounty(reward);
              },
            };
          },
        };
      }
      case 'mineHeadframe': {
        return {
          card: { title: 'Strike It Rich', body: 'Five veins still glitter in the old mine yard. Hit each one at the right moment. Scarabs hate noise.', footer: 'Reward: gold & gems per vein', stamp: 'GOLD' },
          make: () => {
            const veins: Interactable[] = [];
            let mined = 0;
            const c = new THREE.Vector3(lm.anchor.x, 0, lm.anchor.z);
            for (let i = 0; i < 5; i++) {
              const a = (i / 5) * Math.PI * 2 + rnd.next() * 0.5, r = 12 + rnd.next() * 8;
              const p = new THREE.Vector3(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r);
              p.y = ctx.world.groundAt(p.x, p.z);
              const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ color: 0xffd040, metalness: 0.6, roughness: 0.3, flatShading: true }));
              marker.position.copy(p).add(new THREE.Vector3(0, 0.6, 0));
              ctx.scene.add(marker);
              const v: Interactable = {
                pos: p, radius: 3, label: 'Mine the vein', enabled: true, promptY: 1.6,
                use: async () => {
                  v.enabled = false;
                  ctx.sfx('mining_hit', p, 1);
                  const r = await this.d.qte.run({ kind: 'bar', key: 'KeyT', label: 'STRIKE!', speed: 1.2 + mined * 0.15, width: 0.16 });
                  ctx.sfx(r === 'fail' ? 'rock_crumble' : 'ore_crack', p, 1);
                  const gold = r === 'perfect' ? 30 : r === 'good' ? 16 : 5;
                  ctx.run.gold += gold;
                  ctx.run.totalGold += gold;
                  ctx.fx.coins({ x: p.x, y: p.y + 0.8, z: p.z }, Math.ceil(gold / 4));
                  ctx.toast(r === 'perfect' ? 'MOTHER LODE' : r === 'good' ? 'NICE STRIKE' : 'CHIPPED IT', '#ffd36b', `+${gold} gold`);
                  marker.removeFromParent();
                  this.d.inter.remove(v);
                  mined++;
                  spawnRing('scarab', 2 + Math.floor(wave / 8), p, 8, 14);
                },
              };
              veins.push(v);
              this.d.inter.add(v);
              (v as any).marker = marker;
            }
            return {
              type, name: 'Strike It Rich', text: 'Mine the glittering veins', sub: '', marker: null, timeLeft: 120,
              update(dt) {
                this.timeLeft -= dt;
                const left = veins.filter((v) => v.enabled);
                this.sub = `${mined}/5 veins`;
                let best: THREE.Vector3 | null = null, bd = Infinity;
                for (const v of left) {
                  const dd = v.pos.distanceTo(player.pos);
                  if (dd < bd) {
                    bd = dd;
                    best = v.pos;
                  }
                }
                this.marker = best ? best.clone().setY(best.y + 1.5) : null;
                if (mined >= 5) return 'win';
                return this.timeLeft <= 0 ? 'fail' : 'run';
              },
              reward: () => this.d.addBounty(40 + wave * 3),
              cleanup: () => {
                for (const v of veins) {
                  (v as any).marker?.removeFromParent();
                  this.d.inter.remove(v);
                }
              },
            };
          },
        };
      }
      case 'ranchBarn': {
        return {
          card: { title: 'Camel Rustlers', body: 'Bandits stole the rancher\'s prize camel, Humphrey. Find their camp, deal with the guards, cut him loose.', footer: 'Reward: Silver Strongbox · Humphrey\'s gratitude (+5% speed)', stamp: 'HELP' },
          make: () => {
            const a = rnd.next() * Math.PI * 2;
            const camp = new THREE.Vector3(lm.anchor.x + Math.cos(a) * 45, 0, lm.anchor.z + Math.sin(a) * 45);
            for (let k = 0; k < 8 && ctx.world.storm.sdf(camp.x, camp.z) < 10; k++) camp.lerp(new THREE.Vector3(lm.anchor.x, 0, lm.anchor.z), 0.25);
            camp.y = ctx.world.groundAt(camp.x, camp.z);
            const guards = [...spawnRing('outlaw', 3, camp, 3, 7, 0.15), ...spawnRing('lassoRider', 2, camp, 4, 8)];
            let freed = false;
            let camel: RigInstance | null = null;
            const spec = modelEntry('camel')?.() as RigSpec | undefined;
            if (spec?.parts) {
              camel = new RigInstance(buildRigGeo(spec, 'camel:npc'), { material: makeVoxelMaterial() });
              camel.root.position.copy(camp);
              ctx.scene.add(camel.root);
            }
            const free: Interactable = {
              pos: camp, radius: 3.5, label: 'Cut Humphrey loose', enabled: true, promptY: 2.6,
              use: () => {
                if (guards.some((g) => g.alive)) {
                  ctx.toast('GUARDS FIRST', '#ff8a6a', 'They\'re watching the rope.');
                  return;
                }
                freed = true;
                free.enabled = false;
                ctx.sfx('camel_grunt', camp, 1);
                emote(ctx.particles, { x: camp.x, y: camp.y + 2.6, z: camp.z }, 'heart', 1.4);
              },
            };
            this.d.inter.add(free);
            return {
              type, name: 'Camel Rustlers', text: 'Free Humphrey the camel', sub: '', marker: camp.clone().setY(camp.y + 3), timeLeft: 150,
              update(dt) {
                this.timeLeft -= dt;
                const left = guards.filter((g) => g.alive).length;
                this.sub = left ? `${left} guards left` : 'Cut the rope! [T]';
                if (camel) camel.root.rotation.y += dt * (freed ? 3 : 0.1);
                if (freed) return 'win';
                return this.timeLeft <= 0 ? 'fail' : 'run';
              },
              reward: () => {
                this.d.chest(camp.x + 2, camp.z, 'silver');
                player.stats.add([{ stat: 'moveSpeed', type: 'pct', value: 0.05, source: 'humphrey' }]);
                ctx.toast("HUMPHREY'S GRATITUDE", '#9dff3a', '+5% speed for the rest of the run');
              },
              cleanup: () => {
                this.d.inter.remove(free);
                if (camel) ctx.engine.tweens.after(4, () => camel!.root.removeFromParent());
              },
            };
          },
        };
      }
      case 'sheriffOffice': {
        const kinds = ['jackal', 'mummy', 'giantScorpion', 'outlaw', 'gunslinger'];
        const kind = rnd.pick(kinds);
        const reward = 120 + wave * 10;
        const names = ['"Two-Teeth" Tobias', 'Mad Mabel', 'The Dune Butcher', 'Sixfinger Sal', 'Old Rattlejaw'];
        const outlaw = rnd.pick(names);
        return {
          card: { title: `Wanted: ${outlaw}`, body: `A notorious ${kind.replace(/([A-Z])/g, ' $1').toLowerCase()} alpha is terrorising the zone. Bring back its bones.`, footer: `Reward: ${reward} bounty · Silver Strongbox`, stamp: 'DEAD OR ALIVE', accent: '#8a2a18' },
          make: () => {
            const pp = player.pos;
            let tgt: EnemyLike | null = null;
            for (let k = 0; k < 10 && !tgt; k++) {
              const a = rnd.next() * Math.PI * 2;
              const x = pp.x + Math.cos(a) * 55, z = pp.z + Math.sin(a) * 55;
              if (ctx.world.storm.sdf(x, z) < 8) continue;
              tgt = enemies.spawn(kind, x, z, { alpha: true, emerge: 'sand' }) as unknown as EnemyLike;
            }
            if (tgt) (tgt as any).hp = (tgt as any).maxHp = (tgt as any).maxHp * 1.6;
            return {
              type, name: `Wanted: ${outlaw}`, text: 'Hunt the marked alpha', sub: '', marker: null, timeLeft: 180,
              update(dt) {
                this.timeLeft -= dt;
                if (!tgt) return 'fail';
                this.marker = tgt.pos.clone().setY(tgt.pos.y + tgt.height + 1);
                this.sub = `${Math.round(tgt.pos.distanceTo(player.pos))} m`;
                if (!tgt.alive) return 'win';
                return this.timeLeft <= 0 ? 'fail' : 'run';
              },
              reward: () => {
                this.d.addBounty(reward);
                if (tgt) this.d.chest(tgt.pos.x, tgt.pos.z, 'silver');
              },
            };
          },
        };
      }
      case 'saloon':
      default: {
        return {
          card: { title: 'Five-Card Showdown', body: 'The dealer grins with all six of his teeth. Bet a quarter of your gold: pick the high card and you double it.', footer: 'Double or nothing', stamp: 'ANTE UP' },
          make: () => {
            let state: 'play' | 'win' | 'fail' = 'play';
            void (async () => {
              const bet = Math.max(10, Math.floor(ctx.run.gold * 0.25));
              const suits = ['Scarab', 'Ankh', 'Skull', 'Cactus'];
              const ranks = ['2', '4', '7', '9', 'J', 'Q', 'K', 'A'];
              const values = [0, 1, 2].map(() => Math.floor(rnd.next() * ranks.length));
              const dealer = Math.floor(rnd.next() * ranks.length);
              const pick = await this.d.choice.show(`Dealer shows: ${ranks[dealer]} of ${rnd.pick(suits)} · bet ${bet} gold`, [0, 1, 2].map((i) => ({ title: '?', body: 'A face-down card, worn soft at the corners.', footer: `Card ${i + 1}` })), false);
              const v = values[Math.max(0, pick)];
              const win = v >= dealer;
              ctx.toast(`${ranks[v]} OF ${rnd.pick(suits).toUpperCase()}`, win ? '#9dff3a' : '#ff6a3a', win ? `You win ${bet} gold!` : `You lose ${bet} gold.`, true);
              ctx.run.gold = Math.max(0, ctx.run.gold + (win ? bet : -bet));
              if (win) ctx.sfx('gold_burst', null, 1);
              else ctx.sfx('sting_negative', null, 0.8);
              state = win ? 'win' : 'fail';
            })();
            return { type, name: 'Five-Card Showdown', text: 'Play your hand', sub: '', marker: null, timeLeft: 999, update: () => state === 'play' ? 'run' : state, reward: () => {} };
          },
        };
      }
    }
  }

  update(dt: number) {
    this.scan();
    // NPC idles
    const ctx = this.d.ctx;
    for (const n of this.npcs) {
      n.t += dt;
      const nd = n.rig.nodes;
      if (n.kind === 'merchant') {
        // the merchant's walk, idle, shyness (hiding in the shell from danger) and his
        // arrival cutscene all live in the shop; the trade prompt follows him round
        this.d.shop.animateMerchant(n.rig, dt, this.d.player.pos, n.hooks);
        if (n.inter) this.d.shop.merchantFront(n.rig, n.inter.pos);
      } else {
        if (nd['head']) nd['head'].rotation.set(Math.sin(n.t * 0.9) * 0.1, Math.sin(n.t * 0.5) * 0.25, 0);
        if (nd['jaw']) nd['jaw'].rotation.x = Math.abs(Math.sin(n.t * 4)) * 0.15;
        if (nd['tail']) nd['tail'].rotation.z = Math.sin(n.t * 2.3) * 0.4;
      }
      if (n.eyes && ctx.faces) {
        n.rig.root.updateMatrixWorld(true);
        n.eyes.lookAt(this.d.player.center(new THREE.Vector3()));
        n.eyes.draw(ctx.faces, dt);
      }
    }
    const m = this.active;
    if (!m) return;
    const r = m.update(dt);
    if (r === 'run') return;
    this.active = null;
    m.cleanup?.();
    if (r === 'win') {
      ctx.toast('MISSION COMPLETE', '#9dff3a', m.name, true);
      ctx.sfx('sting_positive', null, 0.9);
      m.reward();
    } else {
      ctx.toast('MISSION FAILED', '#ff6a3a', m.name, true);
      ctx.sfx('sting_negative', null, 0.8);
    }
  }

  hud() {
    const m = this.active;
    if (!m) return { objective: null, marker: null };
    const t = m.timeLeft < 900 ? ` · ${Math.max(0, Math.ceil(m.timeLeft))}s` : '';
    return { objective: { text: m.name, sub: `${m.text}${m.sub ? ' — ' + m.sub : ''}${t}` }, marker: m.marker };
  }
}
