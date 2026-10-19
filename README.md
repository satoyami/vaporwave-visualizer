# vaporwave-visualizer

A three.js scene based on `image-refs/vaporwave-space.png`: a striped pink-to-violet
sky with stars and a glowing horizon over an endless neon grid you can cruise around.

## Controls

| Key | Action |
|---|---|
| ↑ / ↓ | Move forward / back |
| ← / → | Turn left / right |
| Q / W | Shift gear down / up (1–5) |
| Shift | Boost (2.5× the current gear) |
| M | Mute / unmute |
| ` (backtick) | Sound lab (dev panel); or open the page with `?dev` |

## Run

```bash
bun install
bun run dev      # dev server with hot reload at http://localhost:3000
bun run start    # same server without hot reload (PORT=8080 to change the port)
bun run build    # static build into ./dist, servable by any static host
bun check        # type check
```

## Layout

- `index.ts` – `Bun.serve` server for `index.html`
- `src/main.ts` – renderer, camera, render loop
- `src/world.ts` – sky, stars and grid floor (custom shaders)
- `src/movement.ts` – arrow-key movement (also reports speed, heading, distance)
- `src/hud.ts`, `src/hud.css` – top-right HUD (gate score, heading tape, speedometer, gears, odometer, nearest gate) and center crosshair
- `src/audio/` – sound (see below)
- `src/score.ts` – gate score: +1 the first time you fly through each gate (resets on reload)
- `src/popups.ts` – neon text popups in the scene ("GATES +1") that drift toward the camera and fade
- `src/gates.ts` – neon triangle gates, one every 4000 units (`GATE_SPACING`), each with a sky beam pulsing every 1.5 s (`PULSE_PERIOD`)

## Sound

Audio starts after the first key press or click (browser rule).

- `public/sounds/sfx/`, `public/sounds/ambience/` – the `.wav` files, served at `/sounds/...`
- `src/audio/sounds.ts` – manifest: every sound's file, mixer bus, volume, loop and 3D settings
- `src/audio/engine.ts` – the engine. three.js `AudioListener` rides on the camera and
  `PositionalAudio` handles loops attached to scene objects; plain Web Audio handles mixer
  buses (sfx / ambience / ui), loading, overlapping one-shots and ambience crossfades
- `src/audio/world-audio.ts` – what plays when: gate hum on every gate, a pulse in time with
  the beam flash, a whoosh when flying through a gate, gear and boost sounds
- `src/audio/dev-panel.ts` – the sound lab

### Adding a sound

1. Drop the `.wav` into `public/sounds/sfx/` or `public/sounds/ambience/`.
2. Add an entry to `SOUNDS` in `src/audio/sounds.ts` (add `spatial` to make it a 3D sound).
3. Trigger it from `src/audio/world-audio.ts`:
   - `engine.play("id")` – one-shot (pass `{ position }` to place it in the world)
   - `engine.positional("id", object)` – looping sound attached to a scene object
   - `engine.setAmbience("id")` – crossfade the background bed (also list it in `AMBIENCES`)

Missing files only log a warning, so you can add entries before the audio exists.

### Sound lab

Press backtick to open it. It lists every manifest sound plus any `.wav` in `public/sounds`
that isn't in the manifest yet (marked `*`). You can play or loop each one, mix the buses and
switch the ambience. **Place 40u ahead** drops a test emitter playing the selected sound:
fly around it to hear panning and distance, tune volume, distance and cone with the sliders,
then **Copy entry** to paste the tuned settings into `sounds.ts`.
