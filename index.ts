// Dev server: bundles index.html (and the TypeScript it imports) on the fly.
import index from "./index.html";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/": index,
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`Vaporwave space running at ${server.url}`);
