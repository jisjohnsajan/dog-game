# 🐭 Squeak & Seek 🐶

A gloriously useless **WebXR AR** game: a rat scurries around your real room, your dog companion tracks it, you corner the rat, catch it, and **YEET** it with ragdoll physics — complete with random meme sounds and fullscreen meme flashes on every throw.

## Play

- **AR (Android Chrome + ARCore):** https://jisjohnsajan.github.io/dog-game/
- **Preview mode** (any desktop browser): works the full loop in a fake room — drag to look, tap the rat to catch, swipe up to yeet.

## Gameplay

1. 🐭 A rat spawns on your floor and scurries around your real room.
2. 🐕 Your pet companion is anchored to the camera and constantly looks at the rat — barking (RUFF!) when it hides.
3. 🙈 The rat's AI bolts for hiding spots learned from your furniture (tables, pillars, walls) via the XR hit-test.
4. 👆 Corner it and **TAP** to catch it (boing!).
5. 🚀 **SWIPE UP** to yeet it — cannon-es ragdoll flight, random meme sound, random fullscreen meme flash, splat + ta-da fanfare.

## Tech

- **Three.js** — rendering, primitives-based models (swap in your own GLTF — see notes at the bottom of `game.js`)
- **cannon-es** — physics for the yeet ragdoll
- **WebXR** (`immersive-ar` + `hit-test` + `local-floor` + `dom-overlay`) — plane/floor detection, reticle spawning
- **Web Audio API** — 100% synthesized squeaks, barks, boings, splats, and fanfares (`sfx.js`) — zero audio assets for the core effects
- Your own meme mp3s + images as random throw surprises

## Files

| File | Purpose |
|---|---|
| `index.html` | HUD, start overlay, meme flash layer, import map |
| `game.js` | Full game loop, rat/pet AI, WebXR session, catch/yeet |
| `sfx.js` | Synthesized SFX + random meme throw sounds (`THROWS` array) |
| `*.mp3` / `*.webp` / `*.jpg` | Meme assets (randomly picked per yeet; `MEME_IMAGES` in `game.js`) |
