# Voxel model contract (dustUP)

All models are built with `src/engine/voxel/VoxelModel.ts` (DSL), colors from
`src/engine/voxel/palette.ts`, and rigs follow `src/engine/voxel/Rig.ts`.

## ★ STYLE v2 — THE ONLY ART RULES (user, final: "forget my old rules, make it just look good, human made, stylized") ★
Reference the user gave: a polished cartoon voxel skeleton (MagicaVoxel-style). Big rounded-blocky skull, about 28% of
body height and as wide as the shoulders. Large square dark eye sockets, a small nose hole, a grin with a clean row of
teeth. Thin bone limbs with knobby joints, chunky blocky hands and feet, a clear rib cage (separate rib rows with gaps)
and a chunky pelvis. All in one warm cream bone colour with soft shading. Aim for "Hytale / Minecraft-Dungeons polish".
Every old note about resolution, the pixel-art pass, ramps, outlines, textures, realism and "no round shapes" is VOID.

**Look**
- Should read as hand-made by a professional voxel artist. Every voxel is deliberate. Clean, readable, appealing,
  charming. Silhouette first.
- Cartoon proportions for every humanoid: big head (crown to chin ≈ 28–30% of body height), short torso, slim limbs,
  chunky hands and feet/boots.
- Shapes: clean boxes plus stepped bevels. Round forms (skull dome, barrels, hat crowns) are fine as clean, symmetric
  stair-stepped silhouettes. No random bumps, jitter or noisy geometry.
- Author directly on the final grid. **No resampling or downsampling conversions, and no automatic texture/shading
  passes.** Delete those pipelines from your module.
- Colour: small palette. Each material gets base + shade + highlight (+1 accent). Mostly flat colour regions with
  hand-placed shading (slightly darker undersides/recesses, an optional highlight row on top edges). **No per-voxel
  noise, dithering, blotch or grain.** The renderer's AO and lighting do the rest.
- Palette: warm, stylized, slightly saturated (cartoon western/Egypt), not gritty. Bone `#f2dcb4` / shade `#d6b78a` /
  highlight `#fff1d6`; socket dark `#4a2c1a`. Shared ramps live in `src/game/models/style.ts` (`TOON`) — use them.
- Details: few, bold, meaningful, readable at 15 m (hat band, buckle, bandana knot, stitches as 1-voxel lines, rivets).
  Max ~4 accessories per character. No clutter.
- Glow: none, except tiny accents (fuse spark, a rune line).

**Faces**
- Big square eye sockets, 1 voxel deep, with dark walls (3×3 to 4×4 at 1/30). The engine draws expressive 2D eyes
  inside them.
- The `eye_l`/`eye_r` part is a tiny dark plug whose pivot is exactly the socket centre at the face surface, +Z out of the
  face, oriented with the head. The engine hides it and uses its bbox for the 2D eye size, so make it the size of the socket.
- Expressions only need `jaw` angle + `brow` angles. Eye-shape variants are no longer needed (eyes are 2D).

**Scales** (one family look)
- Humanoids (Sundown, all humanoid enemies/variants, merchant): **1/30 m**.
- Pinch, revolvers, hand items/attachments: 1/48.
- Boards: 1/32.
- Scarabs: 1/30.
- Camel: 1/24.
- Giant scorpion, vulture: 1/24.
- Big Bertha, Sunroller, Pharaoh, Dust Marshal, Sethos 1–2, Anubis, Serket avatar: 1/20.
- Sandworm: 1/12. Sethos 3 / Avatar of Set: 1/8.
- Props: small/medium (crates, barrels, cacti, rocks, skulls, furniture) 1/20. Buildings & landmarks 1/10–1/12.

**Standard toon humanoid layout** (voxel units at 1/30; origin ground, faces +Z). Everyone uses it so animations match.
Deviate only for a character's identity (jackal taller, mummy hunched, Anubis/Sethos scaled up):
- sole y=0, ankle 3, knee 12, hip joints y=20 at x=±3, pelvis 18–23, waist 24, chest 25–34, shoulders y=32 at x=±7.
- neck 34–36, head 36–52 (16 tall, 15 wide, 14 deep).
- Elbow y=25, fists at y≈14–18 (shorter cartoon arms; `JOINT` in `src/game/models/toon/humanoid.ts` holds the
  exact numbers and is the source of truth). Boots/feet 6–7 long, 4 wide, 4 tall.
- Total ≈ 52 voxels = 1.73 m (+ hat). `meta.height` etc. must match.

## Conventions
- Rig origin = ground between feet. Y up. **Faces +Z.** Character LEFT = +X, RIGHT = -X.
- `pivot` = joint center in the part's own voxel coords. `attach` = where that pivot
  sits in the parent's voxel coords (root part: rig space, origin on ground).
- Rest pose: arms hang straight down (slight A-pose ok), legs straight down.
- Static models return `{ model: VoxelModel, voxelSize: number }` with pivot 'bottom'
  (center of XZ, min Y) unless stated otherwise.
- Scales and look: see **STYLE v2** at the top. Everything below it is technical API only.

## Humanoid part names (all bipeds)
`pelvis` (root) → `torso` → `head` (→ optional `jaw`, `hat`), `arm_l`/`arm_r` (upper arm, pivot at shoulder)
→ `fore_l`/`fore_r` (forearm + hand, pivot at elbow); `thigh_l`/`thigh_r` (pivot hip) → `shin_l`/`shin_r`
(shin + foot, pivot knee). Optional: `coat` (coat tails, parent pelvis), `tail`, `cape`, `weapon`, `shield`, `gun`.
Sockets: `hand_r`, `hand_l`, `head_top`, `back`, `shoulder_l`, `shoulder_r`, `hip_r`, `chest`.
`meta.height` (m), `meta.radius` (m, body hit radius).

## Scorpion part names
`body` (root), `tail1`…`tail5` chain, `stinger` (parent tail5), `arm_l`/`arm_r` (pincer arms),
`pincer_l`/`pincer_r` (movable claw jaw), `leg_l1`…`leg_l4`, `leg_r1`…`leg_r4`.

## Beetle part names
`body` (root), `head`, `leg_l1`…`leg_l3`, `leg_r1`…`leg_r3`, `wing_l`, `wing_r` (elytra).

## Bird: `body` (root), `head`, `wing_l`, `wing_r`, `tail`.
## Camel/quadruped: `body` (root), `neck`, `head`, `leg_fl`, `leg_fr`, `leg_bl`, `leg_br`, `tail`.
## Sandworm: `head` (root, maw), `seg1`…`segN` chained, each parented to the previous.

## Required exports
### characters/ (registryCharacters.ts)
- `skeletonCowboyRig(look: CowboyLook): RigSpec` — `CowboyLook { hat: HatId; outfit: OutfitId }`
  - `HatId = 'stetson' | 'duck' | 'sombrero' | 'nemes' | 'tophat' | 'bandit'`
  - `OutfitId = 'duster' | 'poncho' | 'vest' | 'sheriff' | 'pharaoh'`
  - parts: humanoid + `jaw`, `hat` (parent head), `coat` (parent pelvis). Eye sockets get engine-drawn 2D eyes.
- `revolverRig(parts: GunParts): RigSpec` — parts `frame` (root, pivot = grip center), `cylinder`
  (pivot = cylinder axis center, can spin around Z), `hammer` (pivot hinge), optional `scope`.
  `meta.muzzle: V3` (voxel coords in frame space), `meta.ejector`. 
  `GunParts { barrel: 'standard'|'long'|'snub'|'serket'; cylinder: 'standard'|'venom'|'gold'|'bone'; grip: 'wood'|'bone'|'ivory'|'scarab'; sight: 'none'|'iron'|'scope' }`
  Gun points along +Z.
- `pinchRig(): RigSpec` — Pinch, the little scorpion companion (scorpion convention).
- `sandboardModel(style: BoardId)` — `BoardId = 'driftwood'|'cactus'|'cyber'|'bone'|'scarab_gold'|'serket'`, ~1.45 m long along Z.
- `dungBombModel()`, `rubberDuckModel()`, `dungBallModel()`
- `dumbScarabRig(): RigSpec` (beetle convention, small, googly eyes, comedic)
- `merchantRig(): RigSpec` (humanoid; old merchant, turban, long beard, robe), `camelRig(): RigSpec`
- `anubisRig(): RigSpec` (humanoid ~4.2 m, + `weapon` was-scepter on fore_r, `jaw`)
- `serketAvatarRig(): RigSpec` (giant spectral scorpion, scorpion convention, glowing)
- `attachmentModel(id: AttachmentId): { model; voxelSize; socket: string; offset?: V3; rot?: V3 }`
  `AttachmentId = 'scarab_pauldron'|'scorpion_cape'|'locust_bandolier'|'venom_tank'|'bone_crown'|'serket_halo'|'sun_disk'|'feather_plume'|'dynamite_belt'|'sheriff_star'|'ankh_amulet'|'beetle_backpack'`

### enemies/ (registryEnemies.ts) — all take `o: { alpha?: boolean; variant?: number }`
- `huskRig`, `gunslingerRig` (part `gun` on fore_r), `mummyRig`, `jackalRig` (`weapon` khopesh on fore_r,
  `shield` on fore_l, `tail`), `scarabRig` (beetle), `giantScorpionRig` (scorpion), `vultureRig` (bird),
  `outlawRiderRig` (humanoid bandit + `board` part parented to pelvis? no: `board` is a separate root-level part).
- Alpha versions: bigger and meaner silhouette (horns/crown/armor/scars), same family look.
- Minibosses: `bigBerthaRig()`, `dustMarshalRig(tier: number)` (`gun_l`,`gun_r`), `sunrollerRig()` + `sunBallModel()`,
  `pharaohRig()` (`weapon` crook, `shield` sarcophagus lid), `sandwormRig(o: { segments: number; scale: number })`.
- Major boss: `sethosRig(form: 1 | 2 | 3)` (forms 1-2 humanoid ~3 m with `gun_l`,`gun_r`; form 3 giant ~11 m with `weapon` staff).

### props/ (registryProps.ts)
Static `{ model, voxelSize }` builders (seeded where variety matters): cactus(seed, kind), rock(seed,size),
boulder(seed), tumbleweed(seed), palm(seed), dryBush(seed), skull(kind), ribArch(), boneScatter(seed),
obelisk(seed, broken), column(seed, broken), sphinx(), templeGate(), capstone(), mudbrickRuin(seed),
godStatue(god), hieroglyphWall(seed), shack(seed), watchtower(), fence(len), wagon(), wantedBoard(), tent(seed),
well(), campfire(), scorpionTotem(), ankhShrine(), sekhmetShrine(), sarcophagus(), chest(tier) → `{ base, lid, voxelSize, hinge }`,
oreNode(type), crate(seed), barrel(), pot(seed), trough(), rug(), bandage(), dagger(), smokeBomb(), shieldCharm(),
divineCharm(), goldCoin(), ankhFragment(), hub pieces (barCounter, shelf, bottle(seed), stool, table, piano, mirror,
wardrobe, workbench, noticeBoard, book, gramophone, dartboard, lantern, saloon shell pieces), menuSign() → `{ post, planks[] }`.

## Expressions
- Face parts parented to `head`: `eye_l`, `eye_r` (small dark plug filling the socket; engine hides it and draws 2D eyes there), optional `brow_l`, `brow_r`, plus `jaw`.
- Alternates in `spec.meta.expressions = { [name]: { parts?: { eye_l, eye_r, ... }, jaw?, brow?: [l, r], hide? } }`
  (same pivot as base part). Runtime: `RigInstance.setExpression(name)`, read `exprJaw` / `exprBrow`.
- Sundown: neutral, focus, smug, surprised, hurt, angry, laugh, wink, dead, determined.
- Bosses: neutral, angry, enraged, hurt, laugh, smug, stunned, defeated.
- Motifs: Sundown ↔ Serket (scorpions, venom green, healing ankh); enemies ↔ Set (storm red, Set-animal),
  jackals ↔ Anubis/Maat, scarabs ↔ Khepri, mummies ↔ Sekhmet's curse.

## Enemy variants (src/game/models/variants/, registryVariants.ts) — all `(o: { alpha?: boolean })`
`bomberHuskRig` (dynamite bundle, lit fuse part `fuse`), `cactusHuskRig` (spiky cactus-overgrown husk),
`dungSkeletonRig` (joke enemy: skeleton caked in dung, flies buzzing, carries dung ball part `ball`),
`mariachiRig` (skeleton mariachi with guitar part `guitar`, buffs allies — funny), `sharpshooterRig` (long rifle `gun`),
`shotgunnerRig` (`gun`), `bombScarabRig` (beetle convention, ticking glowing bomb on back), `goldenScarabRig`
(treasure piñata beetle, flees), `tumbleweedBanditRig` (bandit hiding inside a tumbleweed part `weed`),
`lassoRiderRig` (rider + `lasso`), `jackalArcherRig` (`bow`), `bandageWhipperRig` (mummy with long bandage whip `whip`).
Same part-name conventions; jaw + eye parts for expressive faces.

## WORLD THEME (content): mostly outlaw Wild West wooden props, Egyptian ruins as accents, no altars/shrines
Majority of scatter/structures = weathered wood: shacks, plank fences (broken), crates (TNT/dynamite crates,
supply crates), whiskey barrels, water towers, windmills, outhouses, gallows, mine entrances + mine carts + rails,
hitching posts, signposts, wanted boards, wagons + loose wagon wheels, saloon/sheriff/general-store facades,
campfires, tents, troughs, cattle skulls. Egyptian ruins remain as accents (temples, obelisks) for the mythology.
- `cactus(seed, kind)` must be a real procedural generator (seeded: trunk height, arm count/height/bend,
  rib pattern, flowers, holes, damaged states) — clean stylized shapes, high variety.

## Landmark encounters (big & tall, visible from far; riding in triggers a walk-in cinematic + mission)
Export from props: `outlawFort()` (tall log palisade with gate opening ≥8 m wide + 2 watchtowers),
`tradingPost()` (two-storey wooden store with porch, merchant spot), `mineHeadframe()` (tall timber mine tower,
ore carts), `ranchBarn()` (big barn + corral fence), `sheriffOffice()` (office + jail cells), `saloon()` (two-storey
saloon with balcony & swinging doors). Return `{ model, voxelSize, meta: { entrance: [x,z] meters local, footprint:
[w,d] meters, height } }`. Use 1/10–1/12 m voxels.

## Cloth (engine-simulated, not voxels)
Duster tails, poncho fronts, bandana tails, capes, mummy bandage ribbons, flags and banners are simulated by the
engine's Verlet cloth and rendered as blocky fabric strips. Models keep only the stiff upper garment and expose
sockets: Sundown `coat_anchor_l`, `coat_anchor_r`, `coat_anchor_back` (waistline, on pelvis/torso), `bandana_anchor`
(back of neck). Bosses/NPCs: `cape_anchor`. Props with flags: `meta.flagAnchor: [x,y,z]` meters.
