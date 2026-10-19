// Dev server: bundles index.html (and the TypeScript it imports) on the fly.
import path from "node:path";
import index from "./index.html";

const SOUNDS_DIR = path.resolve(import.meta.dir, "public/sounds");
const isDev = process.env.NODE_ENV !== "production";

/** Serves files from public/sounds, refusing paths that escape it. */
async function serveSound(req: Request) {
  const rel = decodeURIComponent(new URL(req.url).pathname.slice("/sounds/".length));
  const file = path.resolve(SOUNDS_DIR, rel);
  if (!file.startsWith(SOUNDS_DIR + path.sep)) return new Response("Not found", { status: 404 });
  const blob = Bun.file(file);
  if (!(await blob.exists())) return new Response("Not found", { status: 404 });
  return new Response(blob);
}

/** Every .wav under public/sounds, for the sound lab (dev only). */
async function listSounds() {
  const urls: string[] = [];
  for await (const rel of new Bun.Glob("**/*.wav").scan({ cwd: SOUNDS_DIR })) {
    urls.push(`/sounds/${rel.split(path.sep).join("/")}`);
  }
  return Response.json(urls.sort());
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/": index,
    "/sounds/*": serveSound,
    "/api/sounds": isDev ? listSounds : new Response("Not found", { status: 404 }),
  },
  development: isDev && {
    hmr: true,
    console: true,
  },
});

console.log(`Vaporwave space running at ${server.url}`);
