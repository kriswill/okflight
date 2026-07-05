#!/usr/bin/env node
// npm/bunx entry point. okf runs on Bun — Bun.TOML, Bun.build (+ the Svelte
// plugin at `okf viz` time), and Bun.Glob are used at CLI runtime, so node
// cannot host it directly. The node shebang is deliberate: bunx respects it,
// so both `bunx okflight` and `npx okflight` land here under node and we
// re-exec through a bun; `bunx --bun okflight` (or a bun-run invocation)
// hits the typeof-Bun fast path and imports the CLI in-process.
//
// Bun lookup order: the PATH (the common case — bunx users by definition,
// and any machine with bun installed), then the `bun` optionalDependency
// npm brings alongside this package (flat and nested install layouts), so
// plain `npx okflight` works with no prerequisites. A machine with none of
// these gets an explanation instead of a cryptic ENOENT.
//
// OKF_PROG makes usage/help print the name the user actually typed
// (okflight or okf, per the bin symlink) rather than "bun okf.ts".

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../okf.ts", import.meta.url));
process.env.OKF_PROG ??= basename(process.argv[1] ?? "", ".mjs") || "okf";

if (typeof Bun !== "undefined") {
  await import(entry);
} else {
  const isWin = process.platform === "win32";
  const local = ["../node_modules/.bin/bun", "../../.bin/bun"] // nested (global installs) and flat layouts
    .map((rel) => fileURLToPath(new URL(rel + (isWin ? ".cmd" : ""), import.meta.url)))
    .filter((p) => existsSync(p));
  for (const bun of ["bun", ...local]) {
    // .cmd shims need a shell; node refuses to spawn them directly.
    const r = spawnSync(bun, [entry, ...process.argv.slice(2)], { stdio: "inherit", shell: bun.endsWith(".cmd") });
    if (r.error && r.error.code === "ENOENT") continue; // not on PATH — try the next candidate
    if (r.error) throw r.error;
    process.exit(r.status ?? 1);
  }
  // Every candidate ENOENT'd — no bun anywhere.
  console.error(
    "okf: the Bun runtime is required (this CLI uses Bun.build/Bun.TOML at runtime and cannot run under node).\n" +
      "     Installing the okflight package normally brings bun along as an optional dependency; it seems to be\n" +
      "     missing here (--no-optional install, or an unsupported platform). Install bun from https://bun.sh\n" +
      "     — e.g. `npm install -g bun` or `curl -fsSL https://bun.sh/install | bash` — then re-run.",
  );
  process.exit(1);
}
