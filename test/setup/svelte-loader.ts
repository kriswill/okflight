// bun test loader for Svelte 5: the shared compiler plugin (viz-app/
// svelte-plugin.ts) registered as a runtime plugin, with styles injected —
// there is no bundler here to collect virtual CSS modules.
import { readFileSync } from "fs";
import { plugin } from "bun";
import { sveltePlugin } from "../../viz-app/svelte-plugin";

plugin(sveltePlugin({ dev: true, css: "injected" }));

plugin({
  name: "svelte-client-entries",
  setup(b) {
    // bun test resolves package exports with the "default" (server) condition
    // and has no --conditions flag; swap svelte's server entries for their
    // client siblings (same dir, so relative imports resolve identically).
    b.onLoad({ filter: /svelte\/src\/(?:[^/]+\/)*index-server\.js$/ }, (args) => ({
      contents: readFileSync(args.path.replace(/index-server\.js$/, "index-client.js"), "utf8"),
      loader: "js",
    }));
  },
});
