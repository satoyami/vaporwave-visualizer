// Records docs/demo.mp4 (with game audio) and docs/demo.gif for the README.
//
//   bun run demo                 needs Google Chrome and ffmpeg (libx264)
//   bun run demo --work <dir>    keep frames and audio in <dir> instead of a temp folder
//
// The game runs in headless Chrome on Playwright's fake clock, so every video
// frame is exactly 1/30 s of game time no matter how slow capturing is.
// An autopilot flies the round: start, two gates, then a fade that skips the
// clock ahead to the last seconds and the TIME UP screen. Every sound the game
// triggers is logged, then mixed offline with distance + stereo panning for
// the 3D sounds (an approximation of the browser's HRTF).
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { $ } from "bun";
import { chromium, type Page } from "playwright";
import { SOUNDS, type SoundDef, type SpatialDef } from "../src/audio/sounds.ts";
import { DEFAULT_SPATIAL } from "../src/audio/engine.ts";
import { GATE_HEIGHT } from "../src/gates.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const OUT_DIR = path.join(ROOT, "docs");
const FPS = 30;
const WIDTH = 1280;
const HEIGHT = 720;
const RATE = 48000;
const PORT = 3999;

// Timeline, in frames.
const START_FRAME = 75; // idle on the ready screen first
const SKIP_TO_SECONDS = 6; // clock time left after the fade
const FADE_FRAMES = 9;
const HOLD_AFTER_GATES = 40; // frames after the 2nd gate before fading
const HOLD_AFTER_TIME_UP = 110;
const MAX_FRAMES = 1200;
const GIF = { start: 2, length: 8, fps: 10, width: 540, colors: 96 }; // README preview: start/length in seconds

const args = process.argv.slice(2);
const workArg = args.indexOf("--work");
const work = workArg >= 0 ? path.resolve(args[workArg + 1]!) : await mkdtemp(path.join(os.tmpdir(), "vaporwave-demo-"));
const framesDir = path.join(work, "frames");
await rm(framesDir, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });
await mkdir(OUT_DIR, { recursive: true });

// ------------------------------------------------------------------ record

interface FrameState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Gate hum positions (one per gate slot). */
  hums: [number, number, number][];
  phase: string;
  score: number;
  relative: number; // degrees to turn toward the next unscored gate
}

interface SoundEvent {
  frame: number;
  ref: string; // manifest id or url
  volume: number;
  rate: number;
  position: [number, number, number] | null;
}

const server = Bun.spawn(["bun", "index.ts"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "production" },
  stdout: "ignore",
  stderr: "inherit",
});

const decoded = new Map<string, Float32Array>();
const states: FrameState[] = [];
const fades: number[] = [];
let events: SoundEvent[] = [];

try {
  await waitForServer();
  const browser = await chromium.launch({ channel: "chrome", args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  // Paused: game time only moves when runFor() steps it, never with real time.
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => "__vaporwave" in window);
  await installHooks(page);

  const held = new Set<string>();
  const hold = async (key: string, down: boolean) => {
    if (down === held.has(key)) return;
    if (down) {
      held.add(key);
      await page.keyboard.down(key);
    } else {
      held.delete(key);
      await page.keyboard.up(key);
    }
  };
  const tap = (key: string) => page.keyboard.press(key);

  let clockMs = 0;
  let gatesDoneFrame = -1;
  let fadeStart = -1;
  let overFrame = -1;

  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    // Script: start, shift up, boost, then ease off once time is up.
    if (frame === START_FRAME) await hold("ArrowUp", true);
    if (frame === START_FRAME + 8 || frame === START_FRAME + 16) await tap("w");
    if (frame === START_FRAME + 75 || frame === START_FRAME + 81) await tap("w");
    if (frame === START_FRAME + 90) await hold("Shift", true);

    const prev = states.at(-1);
    if (prev && frame > START_FRAME && overFrame < 0) {
      // Autopilot: turn toward the next unscored gate.
      await hold("ArrowRight", prev.relative > 1);
      await hold("ArrowLeft", prev.relative < -1);
    }
    if (prev?.score === 2 && gatesDoneFrame < 0) gatesDoneFrame = frame;
    if (gatesDoneFrame >= 0 && fadeStart < 0 && frame >= gatesDoneFrame + HOLD_AFTER_GATES) fadeStart = frame;
    if (fadeStart < 0 && frame === MAX_FRAMES - 400) fadeStart = frame; // in case the 2nd gate is missed

    // Fade through black and skip the clock ahead at the darkest frame.
    let fade = 0;
    if (fadeStart >= 0) {
      const t = frame - fadeStart;
      fade = t < FADE_FRAMES ? t / FADE_FRAMES : t < 2 * FADE_FRAMES ? 2 - t / FADE_FRAMES : 0;
      if (t === FADE_FRAMES) {
        await page.evaluate((left) => {
          const { round } = (window as any).__vaporwave;
          round.update(round.timeLeft() - left);
        }, SKIP_TO_SECONDS);
      }
    }

    if (prev?.phase === "over" && overFrame < 0) {
      overFrame = frame;
      await hold("ArrowLeft", false);
      await hold("ArrowRight", false);
      await hold("Shift", false);
    }
    if (overFrame >= 0 && frame === overFrame + 20) await hold("ArrowUp", false);
    if (overFrame >= 0 && frame >= overFrame + HOLD_AFTER_TIME_UP) break;

    // Advance exactly one video frame of game time.
    const target = Math.round(((frame + 1) * 1000) / FPS);
    await page.clock.runFor(target - clockMs);
    clockMs = target;

    states.push(await snapshot(page, frame, fade));
    fades.push(fade);
    await page.screenshot({ path: path.join(framesDir, `${String(frame).padStart(5, "0")}.png`) });
    if (frame % 60 === 0) {
      const s = states.at(-1)!;
      console.log(`frame ${frame}  phase ${s.phase}  score ${s.score}  z ${s.z.toFixed(0)}`);
    }
  }

  events = await page.evaluate(() => (window as any).__vaporwave.__log as never);
  await browser.close();
} finally {
  server.kill();
}

const frames = states.length;
console.log(`captured ${frames} frames (${(frames / FPS).toFixed(1)} s), ${events.length} sound events`);

// --------------------------------------------------------------------- mix

const audioPath = path.join(work, "audio.f32");
await Bun.write(audioPath, await mixAudio());

// ------------------------------------------------------------------ encode

const mp4 = path.join(OUT_DIR, "demo.mp4");
const gif = path.join(OUT_DIR, "demo.gif");
await $`ffmpeg -v error -y -framerate ${FPS} -i ${path.join(framesDir, "%05d.png")} -f f32le -ar ${RATE} -ac 2 -i ${audioPath} -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -movflags +faststart ${mp4}`;
await $`ffmpeg -v error -y -ss ${GIF.start} -t ${GIF.length} -i ${mp4} -vf ${`fps=${GIF.fps},scale=${GIF.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${GIF.colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`} ${gif}`;
console.log(`wrote ${path.relative(ROOT, mp4)} (${(Bun.file(mp4).size / 1e6).toFixed(1)} MB) and ${path.relative(ROOT, gif)} (${(Bun.file(gif).size / 1e6).toFixed(1)} MB)`);
if (workArg < 0) await rm(work, { recursive: true, force: true });

// ----------------------------------------------------------------- helpers

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("dev server didn't start");
}

/** Log every sound the game plays, drive CSS animations from the fake clock, add a fade overlay. */
async function installHooks(page: Page) {
  await page.evaluate(() => {
    const v = (window as any).__vaporwave;
    v.__log = [];
    v.__frame = 0;
    const play = v.audio.play;
    v.audio.play = (ref: any, opts: any = {}) => {
      v.__log.push({
        frame: v.__frame,
        ref: typeof ref === "string" ? ref : ref.url,
        volume: opts.volume ?? 1,
        rate: opts.rate ?? 1,
        position: opts.position ? [opts.position.x, opts.position.y, opts.position.z] : null,
      });
      return play(ref, opts);
    };
    const fade = document.createElement("div");
    fade.id = "demo-fade";
    fade.style.cssText = "position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:9999";
    document.body.appendChild(fade);
    // Don't show the keyboard hint in the video.
    document.getElementById("hint")?.remove();
  });
}

async function snapshot(page: Page, frame: number, fade: number): Promise<FrameState> {
  return page.evaluate(
    ({ frame, fade, fps, humY }) => {
      const v = (window as any).__vaporwave;
      v.__frame = frame;
      (document.getElementById("demo-fade") as HTMLElement).style.opacity = String(fade);
      // CSS animations run on real time; pin them to game time instead.
      const starts: WeakMap<Animation, number> = (v.__animStarts ??= new WeakMap());
      for (const a of document.getAnimations()) {
        if (!starts.has(a)) starts.set(a, frame);
        a.pause();
        a.currentTime = ((frame - starts.get(a)!) * 1000) / fps;
      }
      const cam = v.camera;
      const nav = v.gates.nearestGate();
      const heading = (((-cam.rotation.y * 180) / Math.PI) % 360 + 360) % 360;
      return {
        x: cam.position.x,
        y: cam.position.y,
        z: cam.position.z,
        yaw: cam.rotation.y,
        hums: v.gates.slots().map((g: any) => [g.position.x, humY, g.position.z]),
        phase: v.round.phase(),
        score: v.score.value(),
        relative: ((nav.bearing - heading + 540) % 360) - 180,
      };
    },
    { frame, fade, fps: FPS, humY: GATE_HEIGHT * 0.4 },
  );
}

/** Decode an audio file to interleaved stereo float samples at RATE. */
async function decode(url: string) {
  let data = decoded.get(url);
  if (!data) {
    const file = path.join(ROOT, "public", decodeURIComponent(url));
    const bytes = await $`ffmpeg -v error -i ${file} -f f32le -ac 2 -ar ${RATE} -`.arrayBuffer();
    data = new Float32Array(bytes);
    decoded.set(url, data);
  }
  return data;
}

/** Inverse distance model, as configured on the game's PannerNodes. */
function distanceGain(d: number, s: SpatialDef) {
  const dist = Math.min(Math.max(d, s.refDistance), s.maxDistance);
  return s.refDistance / (s.refDistance + s.rolloff * (dist - s.refDistance));
}

/** Left/right gains for a source at `pos` heard from frame state `st` (equal-power pan). */
function spatialGains(st: FrameState, pos: [number, number, number], s: SpatialDef): [number, number] {
  const dx = pos[0] - st.x;
  const dy = pos[1] - st.y;
  const dz = pos[2] - st.z;
  const d = Math.hypot(dx, dy, dz);
  const g = distanceGain(d, s);
  const flat = Math.hypot(dx, dz) || 1;
  // Camera right vector on the ground for yaw (YXZ order, -Z forward).
  const pan = (dx * Math.cos(st.yaw) - dz * Math.sin(st.yaw)) / flat;
  const angle = ((pan + 1) * Math.PI) / 4;
  return [g * Math.cos(angle) * Math.SQRT2, g * Math.sin(angle) * Math.SQRT2];
}

function defOf(ref: string): SoundDef {
  return (SOUNDS as Record<string, SoundDef>)[ref] ?? { url: ref, bus: "sfx" };
}

/** Adds `src` (stereo) into `out` from sample `at`, with per-frame gains and a playback rate. */
function addSource(
  out: Float32Array,
  src: Float32Array,
  at: number,
  gains: (frame: number) => [number, number],
  opts: { rate?: number; loop?: boolean; offset?: number } = {},
) {
  const rate = opts.rate ?? 1;
  const srcLen = src.length / 2;
  const total = out.length / 2;
  const perFrame = RATE / FPS;
  let pos = opts.offset ?? 0;
  let gPrev = gains(Math.floor(at / perFrame));
  let gNext = gains(Math.floor(at / perFrame) + 1);
  let frameIdx = Math.floor(at / perFrame);
  for (let i = at; i < total; i++) {
    if (!opts.loop && pos >= srcLen - 1) break;
    const f = Math.floor(i / perFrame);
    if (f !== frameIdx) {
      frameIdx = f;
      gPrev = gNext;
      gNext = gains(f + 1);
    }
    const blend = (i - f * perFrame) / perFrame;
    const gl = gPrev[0] + (gNext[0] - gPrev[0]) * blend;
    const gr = gPrev[1] + (gNext[1] - gPrev[1]) * blend;
    const p = opts.loop ? pos % srcLen : pos;
    const i0 = Math.floor(p);
    const i1 = opts.loop ? (i0 + 1) % srcLen : Math.min(i0 + 1, srcLen - 1);
    const t = p - i0;
    out[i * 2]! += (src[i0 * 2]! * (1 - t) + src[i1 * 2]! * t) * gl;
    out[i * 2 + 1]! += (src[i0 * 2 + 1]! * (1 - t) + src[i1 * 2 + 1]! * t) * gr;
    pos += rate;
  }
}

async function mixAudio() {
  const total = Math.ceil((frames / FPS) * RATE);
  const out = new Float32Array(total * 2);
  const clampFrame = (f: number) => states[Math.min(Math.max(f, 0), frames - 1)]!;
  const master = (f: number) => 1 - 0.8 * (fades[Math.min(Math.max(f, 0), frames - 1)] ?? 0);

  // Background bed, fading in over the first 2 seconds.
  const bed = SOUNDS.spaceBed;
  addSource(out, await decode(bed.url), 0, (f) => {
    const g = bed.volume * Math.min(f / (2 * FPS), 1) * master(f);
    return [g, g];
  }, { loop: true });

  // Gate hums: one looping emitter per gate slot, following the gate.
  const hum = SOUNDS.gateHum;
  const humSrc = await decode(hum.url);
  for (let slot = 0; slot < states[0]!.hums.length; slot++) {
    addSource(out, humSrc, 0, (f) => {
      const st = clampFrame(f);
      const [l, r] = spatialGains(st, st.hums[slot]!, hum.spatial);
      const g = hum.volume * master(f);
      return [l * g, r * g];
    }, { loop: true, offset: ((slot * 0.37) % 1) * (humSrc.length / 2) });
  }

  // One-shots from the game's log.
  for (const e of events) {
    const def = defOf(e.ref);
    const src = await decode(def.url);
    const volume = (def.volume ?? 1) * e.volume;
    const st = clampFrame(e.frame);
    const fixed = e.position ? spatialGains(st, e.position, def.spatial ?? DEFAULT_SPATIAL) : ([1, 1] as [number, number]);
    addSource(out, src, Math.round((e.frame / FPS) * RATE), (f) => [fixed[0] * volume * master(f), fixed[1] * volume * master(f)], {
      rate: e.rate,
    });
  }

  // Keep peaks under -1 dBFS.
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  const limit = 10 ** (-1 / 20);
  if (peak > limit) for (let i = 0; i < out.length; i++) out[i]! *= limit / peak;
  console.log(`mixed ${(total / RATE).toFixed(1)} s of audio, peak ${(20 * Math.log10(Math.max(peak, 1e-9))).toFixed(1)} dBFS before limiting`);
  return out;
}
