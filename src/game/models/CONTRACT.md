# Voxel model contract (dustUP)

All models are built with `src/engine/voxel/VoxelModel.ts` (DSL), colors from
`src/engine/voxel/palette.ts`, and rigs follow `src/engine/voxel/Rig.ts`.

## Conventions
- Rig origin = ground between feet. Y up. **Faces +Z.** Character LEFT = +X, RIGHT = -X.
- `pivot` = joint center in the part's own voxel coords. `attach` = where that pivot
  sits in the parent's voxel coords (root part: rig space, origin on ground).
- Rest pose: arms hang straight down (slight A-pose ok), legs straight down.
- Static models return `{ model: VoxelModel, voxelSize: number }` with pivot 'bottom'
  (center of XZ, min Y) unless stated otherwise.
- **HIGH RESOLUTION (user requirement: "super super high resolution")**:
  - Hero Sundown + his look variants: **1/48 m** (≈86 voxels for 1.8 m) — fingers/knuckles, individual teeth,
    rib bones, stitching, buttons, buckle engraving, hat band weave, spur rowels.
  - Pinch: **1/96 m**. Revolver: **1/96 m**. Sandboards: **1/48 m**. Attachments: 1/48 m.
  - Merchant / other humanoid NPCs: **1/40 m**. Camel: 1/32 m. Dumb scarab / duck / small items: 1/64 m.
  - Humanoid enemies: **1/32 m** (engine auto-builds a 2x downsampled LOD for distant hordes).
  - Big creatures (giant scorpion, vulture...): 1/24 m. Bosses: Sethos 1-2 1/24 m, Anubis 1/20 m,
    Big Bertha / Sandworm / Sunroller 1/16 m, Avatar of Set 1/8 m, Serket avatar 1/12 m.
  - Props: small props 1/24–1/32 m, mid structures 1/16 m, huge structures 1/8–1/12 m.
  Detail must scale with resolution — don't just upscale blocks: add the extra small features.
- Use per-voxel variation (`vary`, `blotch`, `strata`, `gradY`, `dither`) everywhere —
  no flat single-color slabs. Emissive (`VF.EMISSIVE`/`VF.GLOW`) for eyes, runes, magic.
  `VF.METAL` for metal/gold. Counts at the new resolution: hero up to ~80k voxels, enemies 8k–25k,
  bosses up to ~150k, small instanced props up to ~6k (use bigger voxels for big things).

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
  - parts: humanoid + `jaw`, `hat` (parent head), `coat` (parent pelvis). Glowing Serket-green eyes.
- `revolverRig(parts: GunParts): RigSpec` — parts `frame` (root, pivot = grip center), `cylinder`
  (pivot = cylinder axis center, can spin around Z), `hammer` (pivot hinge), optional `scope`.
  `meta.muzzle: V3` (voxel coords in frame space), `meta.ejector`. voxelSize 1/32.
  `GunParts { barrel: 'standard'|'long'|'snub'|'serket'; cylinder: 'standard'|'venom'|'gold'|'bone'; grip: 'wood'|'bone'|'ivory'|'scarab'; sight: 'none'|'iron'|'scope' }`
  Gun points along +Z.
- `pinchRig(): RigSpec` — Pinch, the little scorpion companion (scorpion convention, voxelSize 1/48).
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
- Alpha versions: bigger silhouette details, crystal growths (alphaCrystal palette), glowing eyes, horns/crowns.
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

## Expressions & personality (user requirement: quirky, expressive, god-inspired)
- Face parts parented to `head`: `eye_l`, `eye_r` (glowing eye lights), optional `brow_l`, `brow_r`, plus `jaw`.
- Alternates in `spec.meta.expressions = { [name]: { parts?: { eye_l, eye_r, ... }, jaw?, brow?: [l, r], hide? } }`
  (same pivot as base part). Runtime: `RigInstance.setExpression(name)`, read `exprJaw` / `exprBrow`.
- Sundown: neutral, focus, smug, surprised, hurt, angry, laugh, wink, dead, determined.
- Bosses: neutral, angry, enraged, hurt, laugh, smug, stunned, defeated.
- Motifs: Sundown ↔ Serket (scorpions, venom green, healing ankh); enemies ↔ Set (storm red, Set-animal),
  jackals ↔ Anubis/Maat, scarabs ↔ Khepri, mummies ↔ Sekhmet's curse.

## STYLE: BLOCKY + DETAILED (user requirement — overrides earlier hints)
- **No round/ellipsoid/sphere-looking shapes.** Do not use `ellipsoid`/`sphere`/`cylinder`/`tube` for visible forms.
  Build from boxes, slabs, stepped/chamfered edges (corner voxels cut 1–2 steps), layered plates, bevels
  made of offset boxes. Curves are suggested by stair-stepped box stacks, never smooth blobs.
  Reference: the enemies fork's first husk design (user: "old husk design already looks good").
- Detail density stays high: panel lines, seams, rivets, stitching, chips, inset faces, overhangs, trims.
- Rocks/cacti/props too: angular faceted chunks, ribbed box cacti, stacked slab rocks.

## Enemy variants (src/game/models/variants/, registryVariants.ts) — all `(o: { alpha?: boolean })`
`bomberHuskRig` (dynamite bundle, lit fuse part `fuse`), `cactusHuskRig` (spiky cactus-overgrown husk),
`dungSkeletonRig` (joke enemy: skeleton caked in dung, flies buzzing, carries dung ball part `ball`),
`mariachiRig` (skeleton mariachi with guitar part `guitar`, buffs allies — funny), `sharpshooterRig` (long rifle `gun`),
`shotgunnerRig` (`gun`), `bombScarabRig` (beetle convention, ticking glowing bomb on back), `goldenScarabRig`
(treasure piñata beetle, flees), `tumbleweedBanditRig` (bandit hiding inside a tumbleweed part `weed`),
`lassoRiderRig` (rider + `lasso`), `jackalArcherRig` (`bow`), `bandageWhipperRig` (mummy with long bandage whip `whip`).
Same part-name conventions; jaw + eye parts for expressive faces.

## GLOW: minimal (user: "I hate the glow effect")
- Emissive only for tiny accents: eye lights (a few voxels), a fuse spark, a rune line. Never large glowing
  surfaces, auras, crystal fields or glowing veins everywhere. Prefer painted bright colors over VF.GLOW.
  VF.GLOW reserved for eye pupils; VF.EMISSIVE sparingly.

## WORLD THEME: mostly outlaw Wild West wooden props (user requirement)
Majority of scatter/structures = weathered wood: shacks, plank fences (broken), crates (TNT/dynamite crates,
supply crates), whiskey barrels, water towers, windmills, outhouses, gallows, mine entrances + mine carts + rails,
hitching posts, signposts, wanted boards, wagons + loose wagon wheels, saloon/sheriff/general-store facades,
campfires, tents, troughs, cattle skulls. Egyptian ruins remain as accents (temples, obelisks) for the mythology.
- `cactus(seed, kind)` must be a real procedural generator (seeded: trunk height, arm count/height/bend,
  rib pattern, flowers, holes, scars, damaged states) — blocky, high variety.

## ART DIRECTION UPDATE (user): realistic outlaw, not magical
- Palette grounded & weathered: sun-bleached wood, rust, leather, dusty denim/linen, desaturated sands.
  Serket green / Set red / divine gold only as small accents. Avoid neon, purple magic, cyan spirit looks
  (except Anubis/underworld & the Serket avatar which are literally divine).
- **No altars or shrines anywhere** (drop ankhShrine/sekhmetShrine). Choice events use outlaw encounters instead.
- Props must be MUCH more detailed: plank seams, nail heads, iron straps, rope lashings, splintered ends,
  rusty corrugated tin, painted signage with chipped letters, sand drifts at the base.

## Landmark encounters (big & tall, visible from far; riding in triggers a walk-in cinematic + mission)
Export from props: `outlawFort()` (tall log palisade with gate opening ≥8 m wide + 2 watchtowers),
`tradingPost()` (two-storey wooden store with porch, merchant spot), `mineHeadframe()` (tall timber mine tower,
ore carts), `ranchBarn()` (big barn + corral fence), `sheriffOffice()` (office + jail cells), `saloon()` (two-storey
saloon with balcony & swinging doors). Return `{ model, voxelSize, meta: { entrance: [x,z] meters local, footprint:
[w,d] meters, height } }`. Use 1/8–1/12 m voxels.

## Cloth (engine-simulated, not voxels)
Duster tails, poncho fronts, bandana tails, capes, mummy bandage ribbons, flags and banners are simulated by the
engine's Verlet cloth and rendered as blocky fabric strips. Models keep only the stiff upper garment and expose
sockets: Sundown `coat_anchor_l`, `coat_anchor_r`, `coat_anchor_back` (waistline, on pelvis/torso), `bandana_anchor`
(back of neck). Bosses/NPCs: `cape_anchor`. Props with flags: `meta.flagAnchor: [x,y,z]` meters.

## RESOLUTION — FINAL (user changed mind: "I prefer lower resolution blocky that looks good and polished")
This OVERRIDES the earlier high-resolution section:
- Sundown + all humanoids (enemies, variants, merchant): **1/16 m** (≈29 voxels for 1.8 m) — chunky, readable,
  polished: clean silhouettes, deliberate color blocking, 2–3 tone shading per material, crisp edge highlights.
- Pinch, revolver, small items: 1/32 m. Sandboards: 1/16 m. Camel: 1/14 m.
- Big creatures 1/12 m; bosses: Sethos 1–2 & Dust Marshal & Pharaoh 1/12 m, Anubis 1/10 m,
  Big Bertha / Sunroller / sandworm 1/8 m, Avatar of Set 1/5 m. Props: small 1/16 m, structures 1/8–1/10 m.
- Polish > voxel count: every voxel intentional; faces still expressive (eye/brow/jaw parts) at this scale.

## RESOLUTION — USER FINAL CHOICE: 1/24 m
User: "I think 1/24 would be good." → Sundown, all humanoid enemies/variants, merchant, scarab-size creatures:
**voxelSize 1/24 m** (≈43 voxels for 1.8 m). Pinch/revolver/small items 1/48 m. Boards 1/24. Camel 1/20.
Giant scorpion/vulture 1/16; Sethos 1–2 / Dust Marshal / Pharaoh 1/16; Anubis 1/14; Big Bertha / Sunroller /
sandworm 1/10; Avatar of Set 1/6. Small props 1/24, structures 1/10. Same polished chunky style.

## ★ DEFINITIVE SPEC (supersedes every resolution note above) ★
User: "No no no — I mean HIGH resolution, keep it high resolution, higher, but more stylized blocky and polished."
- **High resolution**: Sundown + look variants **1/48 m**; Pinch & revolver **1/96 m**; boards 1/48; merchant 1/40;
  humanoid enemies & variants **1/32 m** (engine auto-LODs hordes); scarabs 1/32; giant scorpion/vulture 1/24;
  Sethos 1–2 / Dust Marshal / Pharaoh 1/24; Anubis 1/20; Big Bertha / Sunroller / sandworm 1/16; Avatar of Set 1/8;
  small props 1/32; structures/landmarks 1/12–1/16.
- **Stylized blocky**: forms constructed from boxes/slabs/planes with chamfered (stepped) edges and crisp
  silhouettes — never smooth rounded blobs. Think "high-res stylized voxel sculpture": big readable shape language,
  then fine detail inside the planes.
- **Polished**: deliberate color blocking, 2–3 tone shading per material (light top/edge highlights, mid, shadow),
  clean seams, crisp trims, no random noise speckle. Minimal glow. Realistic outlaw palette. Expressions.

## ★★ FINAL SCALE + PIXEL-ART LOOK (latest user direction, overrides all scale notes) ★★
User: "Make voxel art 1/38 instead" + "super super detailed realistic voxel art mixed with pixel art, custom parts,
quirky design, never lazy simple shapes, professional pixel art, super high resolution polish" (refs: pixel-art ore
icons, 128×128 pixel-art swords — rich hue-shifted ramps, crisp dark outlines, bright glints, texture inside shapes).
- **Scale**: Sundown + looks, humanoid enemies, variants, merchant, scarab-size creatures: **1/38 m**.
  Pinch & revolver 1/76. Boards 1/38. Camel 1/30. Giant scorpion, vulture, Dust Marshal, Pharaoh, Sethos 1–2: 1/28.
  Anubis 1/19. Big Bertha, Sunroller, sandworm: 1/19. Avatar of Set 1/10. Props unchanged.
- **Pixel-art shading inside the voxels** (every material):
  - 4–5 step **hue-shifted ramps**: shadows shift cooler & more saturated (toward red-violet/blue), highlights
    shift warmer & lighter (toward yellow); avoid pure value-only darkening.
  - **Outline voxels**: 1-voxel darker rim on silhouette/part edges (like pixel-art outlines) — selective, not black.
  - **Glints**: 1–2 voxel bright specular highlights on metal, gems, glass eyes, wet surfaces.
  - **Material texture**: wood grain, leather pores/creases, fabric weave/stitching, bone cracks, rust patches,
    painted chipping — readable patterns, not random speckle.
  - **Custom parts everywhere**: buckles, rivets, straps, pouches, charms, patches, tools — quirky storytelling.
