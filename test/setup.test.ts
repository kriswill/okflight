// `okf setup` (the guided integration wizard) and its supporting pieces:
// config discovery's okflight.toml-over-legacy preference, the never-
// overwrite end-to-end behavior of the wizard in a scratch workspace, and
// the drift guard keeping templates/scaffold/scaffold-api.d.ts (the type
// surface setup vendors into consumer repos) in lockstep with the real
// ScaffoldContext in scaffold-api.ts.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findConfigUp } from "../config-cli";

const okflight = join(import.meta.dir, "..");

const run = (script: string, cwd: string, ...flags: string[]) => {
  const r = Bun.spawnSync([process.execPath, join(okflight, script), ...flags], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = r.stdout.toString() + r.stderr.toString();
  if (r.exitCode !== 0) throw new Error(`${script} failed (${r.exitCode}):\n${out}`);
  return out;
};

describe("findConfigUp", () => {
  test("okflight.toml beats legacy okf.toml in the same directory; walk-up still finds either", () => {
    const root = mkdtempSync(join(tmpdir(), "okf-find-"));
    writeFileSync(join(root, "okf.toml"), "");
    expect(findConfigUp(root)).toEqual({ dir: root, file: "okf.toml" });
    writeFileSync(join(root, "okflight.toml"), "");
    expect(findConfigUp(root)).toEqual({ dir: root, file: "okflight.toml" });
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findConfigUp(nested)).toEqual({ dir: root, file: "okflight.toml" });
  });
});

describe("okf init", () => {
  test("writes okflight.toml (the rebranded config name)", () => {
    const root = mkdtempSync(join(tmpdir(), "okf-init-"));
    run("init.ts", root);
    expect(existsSync(join(root, "okflight.toml"))).toBe(true);
    expect(existsSync(join(root, "knowledge", "index.md"))).toBe(true);
  });
});

describe("okf setup", () => {
  test("full non-interactive run: config wired to the scripts starter, skill installed, gitignore appended; re-run is a no-op", () => {
    const root = mkdtempSync(join(tmpdir(), "okf-setup-"));
    mkdirSync(join(root, ".git")); // enough for setup's is-a-git-repo check
    run("setup.ts", root, "--yes", "--dir=docs/kb", "--title=KB graph");

    const toml = readFileSync(join(root, "okflight.toml"), "utf8");
    expect(toml).toContain('dir = "docs/kb"');
    expect(toml).toContain('title = "KB graph"');
    expect(toml).toContain('script = "docs/kb/_okflight/scripts/main.ts"');
    expect(existsSync(join(root, "docs/kb/index.md"))).toBe(true);
    expect(existsSync(join(root, "docs/kb/log.md"))).toBe(true);

    const skill = readFileSync(join(root, ".agent/skills/knowledge-bundle/SKILL.md"), "utf8");
    expect(skill).toContain("docs/kb/"); // {bundle} substituted
    expect(skill).toContain("docs/kb/_okflight/scripts"); // scripts variant of {scaffold-note}
    expect(skill).not.toContain("{bundle}");
    expect(skill).not.toContain("{scaffold-note}");

    expect(existsSync(join(root, "docs/kb/_okflight/scripts/main.ts"))).toBe(true);
    expect(existsSync(join(root, "docs/kb/_okflight/scripts/scaffold-api.d.ts"))).toBe(true);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain("docs/kb/viz.html");

    const again = run("setup.ts", root, "--yes", "--dir=docs/kb", "--title=KB graph");
    expect(again).toContain("nothing written");
    const gi = readFileSync(join(root, ".gitignore"), "utf8");
    expect(gi.split("docs/kb/viz.html").length).toBe(2); // appended exactly once
  });

  test("--no-skill/--no-scripts/--no-gitignore prune to the init core; skill text falls back to the generic scaffold note", () => {
    const root = mkdtempSync(join(tmpdir(), "okf-setup-min-"));
    mkdirSync(join(root, ".git"));
    run("setup.ts", root, "--yes", "--no-skill", "--no-scripts", "--no-gitignore");
    const toml = readFileSync(join(root, "okflight.toml"), "utf8");
    expect(toml).toContain('# script = "knowledge/_okflight/scripts/main.ts"'); // [scaffold] left commented
    expect(existsSync(join(root, ".agent"))).toBe(false);
    expect(existsSync(join(root, "knowledge/_okflight"))).toBe(false);
    expect(existsSync(join(root, ".gitignore"))).toBe(false);

    const root2 = mkdtempSync(join(tmpdir(), "okf-setup-noscripts-"));
    run("setup.ts", root2, "--yes", "--no-scripts", "--skills-dir=.claude/skills");
    const skill = readFileSync(join(root2, ".claude/skills/knowledge-bundle/SKILL.md"), "utf8");
    expect(skill).toContain("[[scaffold.collect]]"); // generic variant of {scaffold-note}
    expect(skill).not.toContain("_okflight/scripts");
  });

  test("a legacy okf.toml is never shadowed: setup suggests the rename and leaves config to the user", () => {
    const root = mkdtempSync(join(tmpdir(), "okf-setup-legacy-"));
    writeFileSync(join(root, "okf.toml"), '[bundle]\ndir = "kb"\n');
    const out = run("setup.ts", root, "--yes", "--no-scripts", "--no-skill");
    expect(out).toContain("rename it to okflight.toml");
    expect(existsSync(join(root, "okflight.toml"))).toBe(false);
  });
});

describe("templates/scaffold/scaffold-api.d.ts", () => {
  test("vendored ScaffoldContext surface matches scaffold-api.ts member-for-member", () => {
    const members = (src: string): string[] => {
      const block = src.match(/export interface ScaffoldContext \{(.*?)\n\}/s);
      expect(block).not.toBeNull();
      return [...block![1]!.matchAll(/^ {2}(?:readonly )?(\w+)\??\s*[:(]/gm)].map((m) => m[1]!).sort();
    };
    const real = members(readFileSync(join(okflight, "scaffold-api.ts"), "utf8"));
    const vendored = members(readFileSync(join(okflight, "templates/scaffold/scaffold-api.d.ts"), "utf8"));
    expect(real.length).toBeGreaterThan(10); // the extractor actually parsed something
    expect(vendored).toEqual(real);
  });
});
