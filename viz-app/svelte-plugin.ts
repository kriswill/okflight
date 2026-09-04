// Svelte 5 compiler plugin for Bun — the one place .svelte / .svelte.[tj]s
// files get compiled, shared by `okf viz` (Bun.build) and `bun test` (the
// runtime plugin in test/setup/svelte-loader.ts). In-repo rather than npm's
// bun-plugin-svelte: that package (0.0.6, March 2025, oven-sh/bun monorepo)
// is unmaintained — no source maps, no SSR, whitespace handling derived from
// the bundler's minify setting (oven-sh/bun#39378) — and Bun ships no
// built-in Svelte loader; its own docs hand-roll exactly this. Bun's plugin
// API has no warnings channel and no source-map passthrough, so compiler
// warnings go to stderr and component maps are dropped (as upstream did).
//
// Client-only by design: the viewer is a browser bundle, nothing is rendered
// server-side. Two things a caller must do that this plugin can't:
//   - Bun.build needs `conditions: ["svelte"]` so packages exposing a
//     `svelte` export condition (@threlte/core) resolve to their Svelte
//     entry — upstream mutated builder.config to inject it; runtime plugins
//     have no config, so the test loader swaps entries by hand instead.
//   - Component CSS: with `css: "external"` every component's styles become
//     a virtual `okf-svelte:*.css` module imported from its JS, which
//     Bun.build emits as a .css output chunk for the caller to inline.
//     Under `bun test` there is no bundler to collect them, so pass
//     `css: "injected"` and the component injects its own <style>.

import type { BunPlugin } from "bun";
import { basename } from "node:path";
import { compile, compileModule, type CompileOptions, type Warning } from "svelte/compiler";

export interface SveltePluginOptions {
  /** Svelte `dev` mode: runtime checks + readable output. Default false. */
  dev?: boolean;
  /** Where component styles go — "external" (virtual CSS modules, for
   *  Bun.build) or "injected" (inline <style> at mount, for tests). */
  css?: "external" | "injected";
  /** Strip insignificant whitespace/comments (production). Default true. */
  minify?: boolean;
  /** Called per compiler warning; default prints `file:line message` to
   *  stderr. */
  onWarn?: (w: Warning, path: string) => void;
}

const NS = "okf-svelte";

const defaultWarn = (w: Warning, path: string) => {
  const at = w.start ? `:${w.start.line}:${w.start.column}` : "";
  console.warn(`svelte: ${path}${at} ${w.message}`);
};

export function sveltePlugin({ dev = false, css = "external", minify = true, onWarn = defaultWarn }: SveltePluginOptions = {}): BunPlugin {
  /** Virtual CSS modules: import specifier -> a component's compiled styles. */
  const styles = new Map<string, string>();
  const ts = new Bun.Transpiler({ loader: "ts" });
  const base: CompileOptions = {
    generate: "client",
    runes: true,
    dev,
    css,
    preserveWhitespace: !minify,
    preserveComments: !minify,
    // Same prime seed svelte/compiler uses; content-hashed so a component's
    // scope class is stable across builds and machines.
    cssHash: ({ css }) => `svelte-${Bun.hash(css, 5381).toString(36)}`,
  };

  return {
    name: NS,
    setup(b) {
      b.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
        const r = compile(await Bun.file(path).text(), { ...base, filename: path });
        for (const w of r.warnings) onWarn(w, path);
        let code = r.js.code;
        if (css === "external" && r.css?.code) {
          const id = `${NS}:${basename(path)}-${Bun.hash(path).toString(36)}.css`;
          styles.set(id, r.css.code);
          code += `\nimport ${JSON.stringify(id)};`;
        }
        return { contents: code, loader: "ts" };
      });
      b.onLoad({ filter: /\.svelte\.[tj]s$/ }, async ({ path }) => {
        let src = await Bun.file(path).text();
        if (path.endsWith(".ts")) src = await ts.transform(src);
        const r = compileModule(src, { generate: "client", dev, filename: path });
        for (const w of r.warnings) onWarn(w, path);
        return { contents: r.js.code, loader: "js" };
      });
      b.onResolve({ filter: new RegExp(`^${NS}:`) }, ({ path }) => ({ path, namespace: NS }));
      b.onLoad({ filter: /\.css$/, namespace: NS }, ({ path }) => {
        const source = styles.get(path);
        if (source === undefined) throw new Error(`${NS}: unknown virtual CSS module ${path}`);
        return { contents: source, loader: "css" };
      });
    },
  };
}
