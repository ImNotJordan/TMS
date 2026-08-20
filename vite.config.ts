// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load `.dev.vars` into `process.env` for `vite dev`.
 *
 * The Cloudflare plugin is build-only (see the header comment), so the dev
 * server runs the SSR entry under Node rather than workerd. `.dev.vars` is a
 * wrangler/workerd convention, so nothing reads it in dev — server-side secrets
 * like `TITAN_AWS_*` would silently be absent, and every endpoint that requires
 * the server principal would answer 503 with correct credentials sitting right
 * there in the file.
 *
 * Dev only. In production the same names come from `wrangler secret put`, and
 * the Worker's env binding carries them.
 */
function loadDevVars() {
  return {
    name: "titan-dev-vars",
    config(_config: unknown, env: { command: string }) {
      if (env.command !== "serve") return;

      const file = path.resolve(rootDir, ".dev.vars");
      if (!fs.existsSync(file)) return;

      let loaded = 0;
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        // A real environment variable always wins over the file.
        if (!key || !value || process.env[key]) continue;
        process.env[key] = value;
        loaded += 1;
      }
      if (loaded > 0) {
        console.log(`[dev] loaded ${loaded} var(s) from .dev.vars`);
      }
    },
  };
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [loadDevVars()],
    resolve: {
      alias: {
        "@titan/aws-client": path.resolve(rootDir, "packages/aws-client/src"),
      },
    },
  },
});
