// Converts the master .wav files in sounds-src/ into the .ogg files the game loads
// from public/sounds/, keeping the folder layout. Needs ffmpeg with libopus.
//
//   bun run sounds           convert new or changed files
//   bun run sounds --force   convert everything again
import path from "node:path";
import { $ } from "bun";

const ROOT = path.resolve(import.meta.dir, "..");
const SRC = path.join(ROOT, "sounds-src");
const OUT = path.join(ROOT, "public/sounds");
/** Opus at this bitrate is close to transparent for stereo music and effects. */
const BITRATE = "160k";

const force = process.argv.includes("--force");
let converted = 0;
let skipped = 0;

for await (const rel of new Bun.Glob("**/*.wav").scan({ cwd: SRC })) {
  const input = path.join(SRC, rel);
  const output = path.join(OUT, rel.replace(/\.wav$/i, ".ogg"));
  const src = Bun.file(input);
  const dst = Bun.file(output);
  if (!force && (await dst.exists()) && dst.lastModified >= src.lastModified) {
    skipped++;
    continue;
  }
  await $`mkdir -p ${path.dirname(output)}`;
  // Opus always runs at 48 kHz; -application audio favors music over speech.
  await $`ffmpeg -hide_banner -loglevel error -y -i ${input} -map_metadata -1 -c:a libopus -b:a ${BITRATE} -vbr on -application audio -ar 48000 ${output}`;
  converted++;
  console.log(`✓ ${rel} → ${path.relative(ROOT, output)}`);
}

console.log(`${converted} converted, ${skipped} up to date`);
