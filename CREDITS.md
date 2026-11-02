# dustUP — Audio credits

Every sound in dustUP is built from **real recordings** (firearms, foley, field
recordings, creature/voice performances and multi-sampled acoustic instruments).
Nothing is synthesized: `tools/build_audio.py` cuts, layers, filters, pitches,
compresses and reverberates the recordings below into the game's sound set, and
`tools/audio_provenance.json` lists the exact source file(s) behind every output
file. The generative score (`src/game/audio/Music.ts`) plays the CC0 Meta guitar and
piano samples.

All sources are **CC0 1.0 (public domain)** except the **Oculus Audio Pack 01**,
which is **CC BY 4.0** and is credited below as its license requires.

## Required attribution (CC BY 4.0)

> "Oculus Audio Pack 01" by Oculus VR, LLC (https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/), licensed under CC BY 4.0. Files renamed to the UCS naming convention; OGG previews transcoded from the original WAVs.

License: https://creativecommons.org/licenses/by/4.0/ — Source mirror: https://github.com/facebookincubator/Meta-open-sound (`corpora/oculus-audio-pack`).
dustUP **modified** these sounds (trimmed, layered with other recordings, pitched,
filtered, normalized, re-encoded to MP3). dustUP sound ids that contain Oculus
Audio Pack material:

`anubis_roar`, `bandage`, `banjo_funny`, `board_jump`, `board_land`, `book_close`, `book_open`, `boost`, `boss_death`, `boss_hurt`, `boss_laugh`, `card_erupt`, `chest_unlock`, `chicken`, `counter_clang`, `divine_chime`, `divine_power`, `divine_whisper`, `door_creak`, `duck_quack`, `dung_kick`, `giant_scorpion_death`, `giant_scorpion_hiss`, `glass_break`, `gold_burst`, `gore_splat`, `gunslinger_laugh`, `headshot`, `heal`, `hit_bone`, `hit_crit`, `kick`, `level_transition`, `limb_off`, `loot_reveal`, `merchant_greet`, `mummy_death`, `mummy_groan`, `paper_flutter`, `pickup_gold`, `punch`, `qte_fail`, `qte_prompt`, `rank_up`, `resurrect`, `rev_eject`, `saloon_loop`, `shell_casing`, `shield_up`, `soul_leave`, `spectral_scorpion`, `sting_negative`, `sting_positive`, `time_slow`, `ui_back`, `ui_click`, `ui_close`, `ui_error`, `ui_open`, `ult_activate`, `ult_ready`, `underworld_loop`, `water_loop`, `whoosh`, `whoosh_big`

## CC0 sources (credit appreciated, not required)

### Firearms — Free Firearm Sound Library
Still North Media / Ben Jaszczak (Kickstarter, 2014), CC0.
https://www.kickstarter.com/projects/bjjaszcz/the-firearm-sound-library — mirror:
https://github.com/buddingmonkey/FreeFirearmsSFXLibrary.
Used: Smith & Wesson 642 (.38 revolver: shots, hammer, cylinder open/close/spin,
shell insert/eject), Ruger Single Six (single-action revolver: shots, hammer cock,
loading gate, dry fire), Winchester Model 1894 (lever action), Winchester Model 12 and
Charles Daly / Benelli Nova (pump shotguns), Colt 1911 (outlaw pistols).

### Instruments — Meta Open Sound
Meta Creative Audio team, CC0: Meta Steel Guitar, Meta Nylon Guitar, Meta Piano.
https://github.com/facebookincubator/Meta-open-sound

### Field recordings — Freesound (via omarchy-ambient)
Mirror with edit notes: https://github.com/funcoder/omarchy-ambient (CC0 recordings).
- Desert wind — "Wind on bushes with muffled gust of wind, twig branch, close to desert ground" by **felix.blume** — https://freesound.org/s/711106/
- Thunder — "Rain and Thunder Ambience Tübingen" by **Sheyvan** — https://freesound.org/s/369547/
- Night crickets — "Crickets (close recording)" by **felix.blume** — https://freesound.org/s/476672/

### Kenney (kenney.nl), CC0
Impact Sounds, RPG Audio, Casino Audio — https://kenney.nl/assets/category:Audio
(via the CC0 mirror https://github.com/Mcamento8/open-game-sfx-index).

### OpenGameArt.org packs, CC0
Via https://github.com/Mcamento8/open-game-sfx-index and https://github.com/novincode/atomcut-library:

| Pack | Author | URL |
|---|---|---|
| RPG Sound Pack | artisticdude | https://opengameart.org/content/rpg-sound-pack |
| Zombies Sound Pack | artisticdude | https://opengameart.org/content/zombies-sound-pack |
| Swishes Sound Pack | artisticdude | https://opengameart.org/content/swishes-sound-pack |
| 37 Hits/Punches | qubodup | https://opengameart.org/content/37-hitspunches |
| 20 Rustles (dry leaves) | qubodup | https://opengameart.org/content/20-rustles-dry-leaves |
| 35 Wooden Cracks/Hits/Destructions | qubodup | https://opengameart.org/content/35-wooden-crackshitsdestructions |
| 8 Wet Squish/Slurp Impacts | qubodup | https://opengameart.org/content/8-wet-squish-slurp-impacts |
| Fantozzi's Footsteps (Grass/Sand & Stone) | qubodup | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone |
| Swish - bamboo stick weapon swhoshes | qubodup | https://opengameart.org/content/swish-bamboo-stick-weapon-swhoshes |
| 100 CC0 SFX | rubberduck | https://opengameart.org/content/100-cc0-sfx |
| 100 CC0 SFX #2 | rubberduck | https://opengameart.org/content/100-cc0-sfx-2 |
| 100 CC0 metal and wood SFX | rubberduck | https://opengameart.org/content/100-cc0-metal-and-wood-sfx |
| 25 CC0 bang / firework SFX | rubberduck | https://opengameart.org/content/25-cc0-bang-firework-sfx |
| 25 CC0 mud SFX | rubberduck | https://opengameart.org/content/25-cc0-mud-sfx |
| 30 CC0 SFX loops | rubberduck | https://opengameart.org/content/30-cc0-sfx-loops |
| 40 CC0 water / splash / slime SFX | rubberduck | https://opengameart.org/content/40-cc0-water-splash-slime-sfx |
| 75 CC0 breaking / falling / hit SFX | rubberduck | https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx |
| 80 CC0 creature SFX | rubberduck | https://opengameart.org/content/80-cc0-creature-sfx |
| 80 CC0 creature SFX #2 | rubberduck | https://opengameart.org/content/80-cc0-creture-sfx-2 |
| 80 CC0 RPG SFX | rubberduck | https://opengameart.org/content/80-cc0-rpg-sfx |
| 20 sword sound effects (attacks and clashes) | starninjas | https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes |
| Book flip sounds | voltiment555 | https://opengameart.org/content/book-flip-sounds |
| Dialog vocal samples | mirceakitsune | https://opengameart.org/content/dialog-vocal-samples |
| Fantasy accessory SFX library | vehicle | https://opengameart.org/content/fantasy-accessory-sfx-library |
| Fantasy sound effects (tinysized SFX) | vehicle | https://opengameart.org/content/fantasy-sound-effects-tinysized-sfx |
| Magic spell SFX | jaggedstone | https://opengameart.org/content/magic-spell-sfx |
| Random SFX | écrivain | https://opengameart.org/content/random-sfx |
| Superpowers assets sound effects | medicinestorm | https://opengameart.org/content/superpowers-assets-sound-effects |
| Swamp environment audio | LokiF | https://opengameart.org/content/swamp-environment-audio |

## Rebuilding
`python3 tools/build_audio.py` (needs numpy + ffmpeg with libmp3lame). The script's
header documents where to clone each source; `--list` prints every recipe.

## Font
- **Alagard** by Hewett Tsoi — pixel font supplied by the project owner (`src/assets/fonts/alagard.ttf`); distributed by its author as free for personal and commercial use. Used for all UI text.
