#!/usr/bin/env node
// npm/bunx entry point. okf runs on Bun — Bun.TOML, Bun.build (+ the Svelte
// plugin at `okf viz` time), and Bun.Glob are used at CLI runtime, so node
// cannot host it directly. The node shebang is deliberate: bunx respects it,
// so both `bunx @kriswill/okflight` and `npx @kriswill/okflight` land here
// under node and we re-exec through a bun; `bunx --bun @kriswill/okflight`
// (or a bun-run invocation) hits the typeof-Bun fast path and imports the
// CLI in-process.
//
// Bun lookup order: the PATH (the common case — bunx users by definition,
// and any machine with bun installed), then the `bun` optionalDependency
// npm brings alongside this package (flat and nested install layouts), so
// plain `npx @kriswill/okflight` works with no prerequisites. A machine with none of
// these gets an explanation instead of a cryptic ENOENT.
//
// OKF_PROG makes usage/help print the name the user actually typed
// (okflight or okf, per the bin symlink) rather than "bun okf.ts".

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../okf.ts", import.meta.url));
process.env.OKF_PROG ??= basename(process.argv[1] ?? "", ".mjs") || "okf";

/** Oldest Bun this CLI runs on (Bun.YAML for frontmatter) — mirrors package.json engines. */
const MIN_BUN = "1.3.13";
const olderThan = (v, min) => {
  const a = v.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
};

if (typeof Bun !== "undefined") {
  if (olderThan(Bun.version, MIN_BUN)) {
    console.error(`okf: Bun ${MIN_BUN} or newer is required (found ${Bun.version}) — run \`bun upgrade\`.`);
    process.exit(1);
  }
  await import(entry);
} else {
  const isWin = process.platform === "win32";
  // The optionalDependency's binary, found by module resolution so every
  // install layout (flat, nested, scoped, global) works. Its postinstall
  // renames the platform binary to bin/bun.exe on every OS, and spawning it
  // directly needs no shell.
  let pkgBun = null;
  try {
    pkgBun = join(dirname(createRequire(import.meta.url).resolve("bun/package.json")), "bin", "bun.exe");
  } catch {} // not installed (--no-optional, unsupported platform)
  // With install scripts skipped (--ignore-scripts, pnpm's default), bun.exe
  // stays a small text placeholder, and every local candidate (the .bin shims
  // too) would end up running it: an opaque spawn error on Windows, the text
  // run as a shell script on POSIX. The real binary is tens of MB.
  const placeholder = pkgBun !== null && existsSync(pkgBun) && statSync(pkgBun).size < 1024 * 1024;
  // .bin shims as a fallback: nested (global installs) and flat layouts, the
  // flat one three levels up because this package is scoped
  // (node_modules/@kriswill/okflight/bin/).
  const shims = ["../node_modules/.bin/bun", "../../../.bin/bun"].map((rel) =>
    fileURLToPath(new URL(rel + (isWin ? ".cmd" : ""), import.meta.url)),
  );
  const local = placeholder ? [] : [...(pkgBun ? [pkgBun] : []), ...shims].filter((p) => existsSync(p));
  for (const bun of ["bun", ...local]) {
    // .cmd shims need a shell; node refuses to spawn them directly.
    const r = spawnSync(bun, [entry, ...process.argv.slice(2)], { stdio: "inherit", shell: bun.endsWith(".cmd") });
    if (r.error && r.error.code === "ENOENT") continue; // not on PATH — try the next candidate
    if (r.error) throw r.error;
    process.exit(r.status ?? 1);
  }
  // Every candidate ENOENT'd — no usable bun anywhere.
  console.error(
    "okf: the Bun runtime is required (this CLI uses Bun.build/Bun.TOML at runtime and cannot run under node).\n" +
      (placeholder
        ? "     The bun optional dependency is installed but its install script never ran (--ignore-scripts, or\n" +
          "     pnpm without approved builds), so it has no binary. Run `npm rebuild bun` (pnpm: `pnpm approve-builds`),\n" +
          "     or install bun from https://bun.sh\n"
        : "     Installing the okflight package normally brings bun along as an optional dependency; it seems to be\n" +
          "     missing here (--no-optional install, or an unsupported platform). Install bun from https://bun.sh\n") +
      "     — e.g. `npm install -g bun` or `curl -fsSL https://bun.sh/install | bash` — then re-run.",
  );
  process.exit(1);
}
