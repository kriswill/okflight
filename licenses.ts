// Third-party license notices for the embedded viewer. Bun.build minifies
// three/svelte/postprocessing into the generated page and strips their
// copyright headers, but MIT and zlib terms require the notice to accompany
// every redistributed copy — so viz.ts bakes each runtime dependency's
// LICENSE text into the page (About modal, "Third-party licenses").
// Collection is driven by package.json `dependencies` (exactly the set the
// bundle can embed; build-only tooling lives in devDependencies), and a dep
// with no findable license file fails the build: shipping the bundle without
// its notices is the compliance bug this module exists to prevent.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DepLicense } from "./viz-app/data";

/** Collect every runtime dependency's license notice from `dir`'s
 *  package.json + node_modules (dir = the okf checkout, where viz.ts lives).
 *  Throws when a dependency ships no recognizable license file. */
export function collectLicenses(dir: string): DepLicense[] {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return Object.keys(pkg.dependencies ?? {})
    .sort()
    .map((name) => {
      const pkgDir = join(dir, "node_modules", name);
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
