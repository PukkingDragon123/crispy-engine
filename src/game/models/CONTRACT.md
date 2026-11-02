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
- Default human-scale voxel size: **1/16 m** (≈29 voxels for a 1.8 m character).
- Use per-voxel variation (`vary`, `blotch`, `strata`, `gradY`, `dither`) everywhere —
  no flat single-color slabs. Emissive (`VF.EMISSIVE`/`VF.GLOW`) for eyes, runes, magic.
  `VF.METAL` for metal/gold. Keep counts sane: small props 300–3000 voxels, humanoids
  2k–7k, bosses up to ~40k (use bigger voxels for big things).

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
