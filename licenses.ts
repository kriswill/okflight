// Third-party license notices for the embedded viewer. Bun.build minifies
// three/svelte/postprocessing into the generated page and strips their
// copyright headers, but MIT and zlib terms require the notice to accompany
// every redistributed copy — so viz.ts bakes each runtime dependency's
// LICENSE text into the page (About modal, "Third-party licenses").
// Collection is driven by package.json `dependencies` minus BUILD_ONLY, and
// a dep with no findable license file fails the build: shipping the bundle
// without its notices is the compliance bug this module exists to prevent.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DepLicense } from "./viz-app/data";

/** `dependencies` entries whose code is NOT compiled into the generated
 *  page. npm/bunx installs only `dependencies`, so tooling okf needs at CLI
 *  runtime (the Svelte build plugin) must live there even though nothing of
 *  it is redistributed in the page — embedding its notice would misstate
 *  what the page contains. Test-/dev-only tooling stays in devDependencies. */
export const BUILD_ONLY = new Set(["bun-plugin-svelte"]);

/** Locate a dependency's package directory by walking the node_modules
 *  chain up from `from` — the layout differs by installer: nested beside the
 *  okf sources in a checkout or the nix package, flat in the consumer's
 *  node_modules for npm/bunx installs (symlinked stores resolve through
 *  existsSync). */
function packageDir(name: string, from: string): string {
  let dir = from;
  for (;;) {
    const cand = join(dir, "node_modules", name);
    if (existsSync(cand)) return cand;
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error(`cannot locate node_modules/${name} from ${from} — are okflight's dependencies installed?`);
    dir = parent;
  }
}

/** Collect every runtime dependency's license notice from `dir`'s
 *  package.json + the resolvable node_modules (dir = the okf checkout,
 *  where viz.ts lives). Throws when a dependency ships no recognizable
 *  license file. */
export function collectLicenses(dir: string): DepLicense[] {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return Object.keys(pkg.dependencies ?? {})
    .filter((name) => !BUILD_ONLY.has(name))
    .sort()
    .map((name) => {
      const pkgDir = packageDir(name, dir);
      const meta = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
        version?: string;
        license?: string | { type?: string };
      };
      // LICENSE / LICENSE.md / LICENCE / license.txt / LICENSE-MIT, any case;
      // shortest name wins so a plain LICENSE beats suffixed variants.
      const file = readdirSync(pkgDir)
        .filter((f) => /^licen[cs]e([.-]|$)/i.test(f))
        .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
      if (!file)
        throw new Error(`no license file found in node_modules/${name} — its notice must ship with the copy bundled into the page`);
      return {
        name,
        version: meta.version ?? "",
        // package.json `license` is a string SPDX id everywhere current, but
        // the long-deprecated `{type, url}` object form still exists in the wild.
        license: (typeof meta.license === "string" ? meta.license : meta.license?.type) ?? "",
        text: readFileSync(join(pkgDir, file), "utf8").trim(),
      };
    });
}
