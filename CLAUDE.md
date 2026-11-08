# dustUP — project rules

## MOST IMPORTANT RULES — from the user, permanent, they override every other note

1. **Never use lazy, ugly, simple shapes.**
   - No plain spheres, boxes, cylinders, cones, rings or flat quads standing in for a model, prop, creature, effect or
     HUD piece.
   - Every shape must feel organic and hand-sculpted: taper, asymmetry, wear, believable anatomy or construction.
   - Anything that moves or bends has a rig.
2. **Never hand-draw 2D art in code.**
   - Do not paint pictures with canvas primitives: no `fillRect`/arc/line/pixel-loop motifs, icons, portraits, card
     scenes, poster pictures, backdrops or symbols.
   - All 2D art is a photograph of a real 3D scene built from the game's own models (posed rigs, set dressing, lights),
     captured through `src/game/ui/IconFactory.ts` / `src/game/ui/CardStudio.ts`, then post-processed (ink lines,
     bloom, grade, paper).
   - If something truly cannot come from 3D, it must be beautiful, detailed and polished 2D art, never a mess.
   - Typography (Alagard text) is the only thing drawn directly.
   - Exception, from the user's latest note: game UI is stylized 2D pixel art (see art direction below).
3. **No 2D eyes.** Eyes are modelled, realistic eyes.
4. **Beautiful, detailed, polished, alive.** If a piece looks lazy, cheap or messy, it is wrong: redo it.
5. **No churn — credits are precious.**
   - Never remake or redesign a model or feature that is already good unless the user asks for that specific thing.
   - Plan first, then get it right in one or two passes, with few screenshots.
   - Finished, approved work (e.g. the tortoise shopkeeper, the sandworms) is frozen.
6. **Never use emoji. Ever.** Not in game text, UI, buttons, toasts, code, comments, docs, commit messages or
   replies. Use words, Alagard typography or real 3D/sculpted art instead.

## Current art direction (latest user notes win)
- Realistic lighting with an anime-painted look: cel light ramp, black ink outlines, and lots of 2D pixel-art particles
  for dust, sand and trails. "Lighting 100× better, super realistic and anime-painted".
- Not cartoony. Sundown matches the user's skeleton reference exactly.
- Very high voxel counts everywhere. Fluid, procedural animation.
- Enemy skill names reference Rolling Stones / Guns N' Roses / Beatles songs.
- UI (latest note): the lower HUD stays live 3D: the soul jar, the heart, the revolver cylinder and bullets, the
  tarot cards. Never replace those with 2D. The rest (bounty plank, wave plaque, notes, toasts, ledger, codex card,
  prompts) is detailed, stylized 2D pixel art that reads as UI, not photographed 3D or texture: moderate pixel
  resolution, hand-authored pixel sprites allowed there, polished and consistent.
- World: near terrain, ruins and buildings read as big blocks with crisp pixel-art textures; pixel-art foliage sprites.
- Guns: very high resolution models.
- Model details: `src/game/models/CONTRACT.md`.

## Workflow
- Develop on branch `claude/awesome-gates-xl4c4a`. Commit with clear messages and push there; no PRs unless asked.
- Type-check: `npx tsc --noEmit`. Build: `npx vite build`. Headless check: `node tools/play.cjs <url> ...`
  (dev server on :5174).
