# Voxel model contract (dustUP)

All models are built with `src/engine/voxel/VoxelModel.ts` (DSL), colors from
`src/engine/voxel/palette.ts`, and rigs follow `src/engine/voxel/Rig.ts`.

## MOST IMPORTANT RULES (user, permanent — see /CLAUDE.md; they override everything below)
1. **Never use lazy, ugly, simple shapes** (plain spheres, boxes, cylinders, cones, rings, flat quads) for any model, prop,
   creature, effect or HUD piece. Every shape feels organic and hand-sculpted; anything that moves has a rig.
2. **Never hand-draw 2D art in code.** No canvas-primitive pictures (motifs, icons, portraits, card scenes, posters,
   backdrops). 2D art = a real 3D scene of game models photographed through IconFactory / CardStudio + post-processing.
   Typography is the only thing drawn directly; anything else 2D must be beautiful and polished, never a mess.
3. **No 2D eyes** — modelled, realistic eyes.
4. Beautiful, detailed, polished, alive. Lazy-looking work is wrong.

## STYLE v2 — THE ONLY ART RULES (user, final: "forget my old rules, make it just look good, human made, stylized")
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
  hand-placed shading (slightly darker undersides/recesses, an optional highlight row on top edges). No random
  per-voxel noise or dithering. Surface texture (wood grain, rust, weathering, paint wear, stone bedding) comes from
  the material library `src/game/models/materials.ts`: few tones, features running along the grain so the mesher
  still merges long runs. The renderer's AO and lighting do the rest.
- Palette: warm, stylized, slightly saturated (cartoon western/Egypt), not gritty. Bone `#f2dcb4` / shade `#d6b78a` /
  highlight `#fff1d6`; socket dark `#4a2c1a`. Shared ramps live in `src/game/models/style.ts` (`TOON`) — use them.
- Details: few, bold, meaningful, readable at 15 m (hat band, buckle, bandana knot, stitches as 1-voxel lines, rivets).
  Max ~4 accessories per character. No clutter.
- Glow: none, except tiny accents (fuse spark, a rune line).

**Faces**
- Eye sockets with dark walls. **No 2D eyes (user rule)**: the `eye_l`/`eye_r` parts are modelled eyes (glowing ember
  pupils / realistic eyeballs) that the engine renders as real geometry; pivot at the socket centre, +Z out of the face.
- Expressions: `jaw` angle + `brow` angles (+ eye part scale/rotation).

**Scales** (one family look)
- Humanoids (Sundown, all humanoid enemies/variants, merchant): **1/30 m**.
- Pinch, small hand items/attachments: 1/48.
- Guns (six-shooter, coach gun, Thompson, their attachments and hand items): sculpted in design cm, built at
  1/512 m (six-shooter) and 1/384 m (long guns), plus a half-resolution `lo` stand-in that Weapons swaps in only
  while an HD voxel is sub-pixel. Every component is its own rig part. See `characters/gunkit.ts`.
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

## STYLE v3 ADDENDUM (user, latest) — realistic creatures + Khonsu + ruined hideout
Humanoid skeletons, outlaws and NPCs stay STYLE v2 cartoon. These are the exceptions:
- **Husk (bring back the old design) and every bug: scarab, bomb scarab, golden scarab, giant scorpion, Big Bertha,
  Sunroller.**
  - Restore the earlier pre-v2 designs the user liked, then push them to **super detailed and realistic**.
  - Use anatomically convincing segments, chitin plates, joints, hairs, mandibles and dried skin.
  - Natural palettes. Tasteful per-voxel variation and texture are allowed again for these.
  - Higher resolution: 1/40–1/48 for the husk and small bugs; 1/30–1/36 for giant ones.
- **New creatures: the sand wolf (and its alpha) and dune worms (and their alpha).**
  - Realistic and detailed.
  - Rigged for super fluid procedural animation: many joints, see the part names below.
- **The first boss is the Avatar of Khonsu:**
  - A towering mummy (~3 m) with a crescent-moon scythe, a lunar crown and moon-silver and gold jewellery.
  - In its last phase a giant hand of Khonsu descends from the sky.
  - Epic, highly detailed, not chibi.
- **The hideout is now a small ruined outpost:** messy, props everywhere, with a cinematic camera.

**Part names for the new rigs**
- **Wolf (quadruped):**
  - `hips` (root) → `chest` → `neck` → `head` → `jaw`.
  - Legs: `leg_fl` → `shin_fl` → `paw_fl` (same for fr, bl, br). Front legs parent to `chest`, back legs to `hips`.
  - Tail: `tail1` → `tail2` → `tail3` (parent `hips`).
  - Also `ear_l`/`ear_r`, `eye_l`/`eye_r`.
  - Faces +Z. `meta.height`, `meta.radius`, `meta.length`.
- **Dune worm:**
  - `head` (root, with `jaw_t`/`jaw_b` mandibles or a petal maw) → `seg1` … `seg12`, each parented to the previous, with a
    tapering tail.
  - `meta.segLength` (m) and `meta.radius`.
- **Khonsu hand:** `palm` (root, wrist at the origin, fingers pointing +Y). Fingers `f1_1`→`f1_2`→`f1_3` … `f4_*` and thumb
  `t_1`→`t_2`→`t_3`, each pivot at its knuckle.

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
  - `OutfitId = 'bare' | 'punk' | 'duster' | 'poncho' | 'vest' | 'sheriff' | 'pharaoh'` (`punk` = the biker-jacket default look)
  - Sundown is the HD build (`characters/sundown.ts`, 1/54 m, sculpted in 1/36 design units so every joint/socket
    matches the legacy layout). The 1/36 `skeleton.ts` build stays only as the base for `skeletonFigure()` (enemies).
  - parts: humanoid + `jaw`, `hat` (parent head), `coat` (parent pelvis), modelled `eye_l`/`eye_r` (glowing pupils).
  - socket `board_back` (torso, between the shoulder blades); mount a board with
    `attachBoardOnBack(rig, sandboardModel(id) | geometry | Object3D, opts?)` from `characters/index.ts`.
- `pinchRig()` is the HD Pinch (1/72 m, sculpted in the legacy 1/48 units; same part names and sockets).
- `revolverRig(parts: GunParts, lod: 'hd' | 'lo' = 'hd'): RigSpec` — every component its own part:
  `frame` (root, pivot = grip centre), `cylinder` (pivot = cylinder axis, spins on Z), `hammer` (pivot = hammer
  screw; negative X rotation cocks it), `barrel` > `front_sight`, `rear_sight`, `ejector_housing` > `ejector_rod`,
  `housing_screw`, `base_pin`, `pin_latch`, `loading_gate`, `trigger`, `trigger_guard`, `grip_frame`,
  `grip_l` / `grip_r` (> `medallion_l` / `_r`), `screw_hammer`, `screw_bolt`, `screw_trigger`, `screw_bs_l` / `_r`,
  optional `scope`, `scope_ring_r`, `scope_ring_f`. Sockets `muzzle`, `ejector`, `laser`, `gate`, `spur`.
  `meta.muzzle: V3` (voxel coords in frame space), `meta.ejector`, `meta.cylinderCenter`,
  `meta.components: { name, label, slot? }[]`, `meta.explode: { [part]: { dir, dist (m), delay } }`.
  `GunParts { barrel: 'standard'|'long'|'snub'|'serket'; cylinder: 'standard'|'venom'|'gold'|'bone'; grip: 'wood'|'bone'|'ivory'|'scarab'; sight: 'none'|'iron'|'scope' }`
  Gun points along +Z. Long guns (`longguns.ts`: `shotgunRig`, `tommyRig`) follow the same rules; animated part
  names stay `barrels`, `hammer_l`, `hammer_r`, `lever` (coach gun) and `drum`, `bolt` (Thompson).
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

## Sundown hair (half-zombie remake)
- Parts `hair_l`, `hair_l2`, `hair_r`, `hair_r2`, `hair_b`, `hair_b2` are children of `head`; chains listed in
  `meta.hair.chains`. `installHairSway(rig)` (`characters/hairSway.ts`) drives them; rigs without hair ignore it.
