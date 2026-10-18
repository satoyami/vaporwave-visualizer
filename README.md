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
- `src/hud.ts`, `src/hud.css` – top-right HUD (heading tape, speedometer, gears, odometer, nearest gate) and center crosshair
- `src/gates.ts` – neon triangle gates, one every 4000 units (`GATE_SPACING`), each with a sky beam pulsing every 1.5 s (`PULSE_PERIOD`)
