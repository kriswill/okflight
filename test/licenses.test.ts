// License-notice collection (licenses.ts) and its end-to-end guarantee: the
// page `okf viz` generates must physically carry the bundled deps' license
// texts. Bun.build minification strips the three/svelte/postprocessing
// copyright headers, and MIT/zlib terms require the notice to accompany every
// redistributed copy — the About modal's "Third-party licenses" section is
// the compliance surface, and a dep whose license file can't be found must
// fail the build loudly instead of shipping notice-less.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_ONLY, collectLicenses } from "../licenses";

const okflight = join(import.meta.dir, "..");

describe("collectLicenses", () => {
  test("every embedded runtime dependency yields a notice with version, id, and real text", () => {
    const pkg = JSON.parse(readFileSync(join(okflight, "package.json"), "utf8"));
    const got = collectLicenses(okflight);
    // Driven by package.json `dependencies` minus the BUILD_ONLY tooling —
    // a new runtime dep is picked up automatically, and its missing LICENSE
    // would throw here. Every exclusion must still BE a dependency, so a
    // removed dep can't leave a stale entry silently masking a future one.
    for (const name of BUILD_ONLY) expect(Object.keys(pkg.dependencies)).toContain(name);
    const embedded = Object.keys(pkg.dependencies).filter((d: string) => !BUILD_ONLY.has(d));
    expect(got.map((l) => l.name)).toEqual(embedded.sort());
    for (const l of got) {
      expect(l.version).toMatch(/^\d+\./);
      expect(l.license.length).toBeGreaterThan(0);
      expect(l.text.length).toBeGreaterThan(200); // a real notice, not a stub
      expect(l.text).toContain("Copyright");
    }
  });

  test("the known bundled deps carry their MIT/zlib notice texts", () => {
    const by = Object.fromEntries(collectLicenses(okflight).map((l) => [l.name, l]));
    expect(by.three!.text).toContain("The MIT License");
    expect(by.svelte!.text).toContain("Permission is hereby granted");
    expect(by.postprocessing!.license).toBe("Zlib");
    expect(by.postprocessing!.text).toContain("This software is provided 'as-is'");
  });

  /** Fake checkout: package.json deps + node_modules/<dep> with given files. */
  const fixture = (deps: Record<string, Record<string, string>>) => {
    const root = mkdtempSync(join(tmpdir(), "okf-lic-"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: Object.fromEntries(Object.keys(deps).map((n) => [n, "1.0.0"])) }),
    );
    for (const [name, files] of Object.entries(deps)) {
      const dir = join(root, "node_modules", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.2.3", license: "MIT" }));
      for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
    }
    return root;
  };

  test("license file name variants are all found; a plain LICENSE beats suffixed ones", () => {
    const root = fixture({
      a: { "LICENCE.md": "notice A" }, // British spelling
      b: { "license.txt": "notice B" }, // lowercase
      c: { LICENSE: "notice C", "LICENSE-MIT.txt": "alt C" },
      d: { "licenses.txt": "not a licen[cs]e file", LICENSE: "notice D" }, // prefix must not over-match
    });
    expect(collectLicenses(root).map((l) => l.text)).toEqual(["notice A", "notice B", "notice C", "notice D"]);
  });

  test("a dependency without any license file throws (viz fails the build)", () => {
    const root = fixture({ nolicense: { "README.md": "not a notice" } });
    expect(() => collectLicenses(root)).toThrow(/node_modules\/nolicense/);
  });
});

describe("okf viz output", () => {
  test(
    "the generated page embeds every runtime dep's license notice",
    () => {
      const root = mkdtempSync(join(tmpdir(), "okf-viz-"));
      writeFileSync(join(root, "okflight.toml"), '[vcs]\nprovider = "none"\n');
      mkdirSync(join(root, "knowledge"));
      writeFileSync(join(root, "knowledge", "index.md"), "# Index\n");
      writeFileSync(
        join(root, "knowledge", "alpha.md"),
        "---\ntype: Decision\ntitle: Alpha\ndescription: a\n---\n\nSee [beta](beta.md).\n",
      );
      writeFileSync(join(root, "knowledge", "beta.md"), "---\ntype: Pattern\ntitle: Beta\ndescription: b\n---\n\nBody.\n");

      const r = Bun.spawnSync([process.execPath, join(okflight, "viz.ts")], { cwd: root, stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) throw new Error(`viz.ts failed (${r.exitCode}):\n${r.stdout}\n${r.stderr}`);
      const html = readFileSync(join(root, "knowledge", "viz.html"), "utf8");

      // Structure: the notices ride the #data blob the viewer boots from
      // (`<\/` is the valid JSON escape of `/`, so the blob parses verbatim).
      const blob = html.match(/<script id="data" type="application\/json">(.*?)<\/script>/s)![1]!;
      const pkg = JSON.parse(readFileSync(join(okflight, "package.json"), "utf8"));
      const licenses: { name: string; text: string }[] = JSON.parse(blob).licenses;
      const embedded = Object.keys(pkg.dependencies).filter((d: string) => !BUILD_ONLY.has(d));
      expect(licenses.map((l) => l.name)).toEqual(embedded.sort());
      for (const l of licenses) expect(l.text).toContain("Copyright");

      // Compliance: the notice texts are physically present in the shipped file.
      expect(html).toContain("three.js authors"); // three (MIT)
      expect(html).toContain("Permission is hereby granted"); // MIT grant (three + svelte)
      expect(html).toContain("Raoul van Rüschen"); // postprocessing (zlib)
    },
    30_000, // spawns a full Bun.build of the viewer
  );
});
