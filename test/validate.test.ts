// okf validate against OKF v0.2 (SPEC §5, §10, §11, §12, §13) — spawned like
// okf.test.ts so the exit code and report are what a user sees.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OKF = join(import.meta.dir, "..", "okf.ts");
const SPEC_FIXTURE = join(import.meta.dir, "fixtures", "spec-v02");

function run(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync([process.execPath, OKF, "validate", ...args], { cwd, env: { ...process.env, NO_COLOR: "1" } });
  const out = r.stdout.toString() + r.stderr.toString();
  return { code: r.exitCode, out, errors: out.split("\n").filter((l) => l.startsWith("ERROR:")), warnings: out.split("\n").filter((l) => l.startsWith("warn:")) };
}

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A throwaway workspace: okflight.toml (no VCS) + kb/ with the given files. */
function workspace(files: Record<string, string>, index = "---\nokf_version: '0.2'\n---\n\n# kb\n") {
  const root = mkdtempSync(join(tmpdir(), "okf-validate-"));
  dirs.push(root);
  writeFileSync(join(root, "okflight.toml"), '[bundle]\ndir = "kb"\n[vcs]\nprovider = "none"\n');
  mkdirSync(join(root, "kb"), { recursive: true });
  writeFileSync(join(root, "kb/index.md"), index);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, "kb", rel, ".."), { recursive: true });
    writeFileSync(join(root, "kb", rel), body);
  }
  return root;
}

describe("okf validate (OKF v0.2)", () => {
  test("the spec's own examples validate with no errors", () => {
    const r = run(SPEC_FIXTURE);
    expect(r.errors).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("computations/profit.md: stale since 2026-06-15T00:00:00Z");
    // Appendix A writes executor/attester paths from the bundle root — resolved leniently, no noise.
    expect(r.out).not.toContain("executor.resource");
    expect(r.out).not.toContain("attester.resource");
  });

  test("malformed present families are errors; absence never is", () => {
    const root = workspace({
      "ok.md": "---\ntype: Note\ntitle: t\ndescription: d\n---\nplain v0.2 concept, no families\n",
      "bad.md": [
        "---",
        "type: Metric",
        "generated: { at: 2026-01-01T00:00:00Z }",
        "verified: [{ by: ahormati, at: 2026-01-01T00:00:00Z }, { by: human:k, at: yesterday }]",
        "status: final",
        "stale_after: soon",
        "sources: { resource: x }",
        "---",
        "body[^nope]",
        "",
      ].join("\n"),
      "dupes.md": [
        "---",
        "type: Metric",
        "sources:",
        "  - { id: a, resource: https://x }",
        "  - { id: a, resource: https://y, usage_count: 3 }",
        "  - { title: no resource }",
        "---",
        "cites a[^a] and b[^b]",
        "",
        "[^a]: A",
        "",
      ].join("\n"),
      "sub/index.md": "---\ntitle: nope\n---\n\n# sub\n",
    });
    const r = run(root);
    expect(r.code).toBe(1);
    const e = r.errors.join("\n");
    expect(e).toContain("bad.md: generated.by is required");
    expect(e).toContain("bad.md: verified[0].by 'ahormati' is not an actor");
    expect(e).toContain("bad.md: verified[1].at 'yesterday' is not an ISO 8601 datetime");
    expect(e).toContain("bad.md: status 'final' must be one of draft | stable | deprecated");
    expect(e).toContain("bad.md: stale_after 'soon' is not an ISO 8601 datetime");
    expect(e).toContain("bad.md: sources must be a list");
    expect(e).toContain("dupes.md: duplicate sources id 'a'");
    expect(e).toContain("dupes.md: sources[2].resource is required");
    expect(e).toContain("dupes.md: footnote [^b] has no matching sources[].id");
    expect(e).toContain("sub/index.md: reserved file must not have frontmatter");
    expect(e).not.toContain("ok.md");
    const w = r.warnings.join("\n");
    expect(w).toContain("dupes.md: sources[1].usage_count has no usage_window");
    expect(w).toContain("dupes.md: footnote [^b] has no definition line");
    expect(w).toContain("bad.md: footnote [^nope] but no sources frontmatter");
  });

  test("Attested Computation contract (§10)", () => {
    const root = workspace({
      "computations/none.md": "---\ntype: Attested Computation\ntitle: t\ndescription: d\ngenerated: { by: human:k }\n---\n# Computation\n\nprose only, no fence\n",
      "computations/shape.md": [
        "---",
        "type: Attested Computation",
        "runtime: bigquery",
        "parameters: [{ type: integer }, { name: year, required: yes }]",
        "computation: missing.sql",
        "executor: { resource: '', receipt: [] }",
        "attester: run-me",
        "---",
        "# Computation",
        "",
        "```sql",
        "SELECT 1",
        "```",
        "",
      ].join("\n"),
      "metric.md": "---\ntype: Metric\nruntime: bigquery\n---\nbody\n",
    });
    const r = run(root);
    const e = r.errors.join("\n");
    expect(e).toContain("computations/none.md: Attested Computation requires 'runtime'");
    expect(e).toContain("computations/none.md: Attested Computation needs a 'computation' path or a code block");
    expect(e).toContain("computations/shape.md: parameters[0] needs a name");
    expect(e).toContain("computations/shape.md: parameters[1].required must be a boolean");
    expect(e).toContain("computations/shape.md: executor.resource is required");
    expect(e).toContain("computations/shape.md: executor.receipt must be a non-empty list");
    expect(e).toContain("computations/shape.md: attester must be a mapping");
    const w = r.warnings.join("\n");
    expect(w).toContain("computations/shape.md: computation 'missing.sql' does not resolve in the bundle");
    expect(w).toContain("computations/shape.md: both 'computation' and an inline Computation fence");
    expect(w).toContain("metric.md: 'runtime' is an Attested Computation field (§10) on a 'Metric' concept");
  });

  test("v0.1 bundles consume with warnings only; --strict fails them; version nudge", () => {
    const legacy = {
      "old.md": "---\ntype: Decision\ntitle: t\ndescription: d\ntimestamp: '2026-05-28T22:53:05+00:00'\n---\n## Context\n\nx\n\n## Citations\n\n- [Doc](https://example.com/doc)\n",
      "new.md": "---\ntype: Decision\ntitle: t\ndescription: d\ngenerated: { by: human:k, at: 2026-05-28T22:53:05Z }\n---\nbody\n",
    };
    const root = workspace(legacy, "---\nokf_version: '0.1'\n---\n\n# kb\n");
    const r = run(root);
    expect(r.errors).toEqual([]);
    expect(r.code).toBe(0);
    const w = r.warnings.join("\n");
    expect(w).toContain("old.md: 'timestamp' is superseded by generated.at in OKF v0.2 — run okf migrate");
    expect(w).toContain("old.md: body Citations list is superseded by 'sources' frontmatter");
    expect(w).toContain("index.md: bundle declares okf_version '0.1' but concepts use v0.2 fields");
    expect(run(root, "--strict").code).toBe(1);

    const unknown = workspace({ "a.md": "---\ntype: X\ntitle: t\ndescription: d\ngenerated: { by: human:k }\n---\nb\n" }, "---\nokf_version: '9.0'\n---\n\n# kb\n");
    const u = run(unknown);
    expect(u.code).toBe(0);
    expect(u.warnings.join("\n")).toContain("okf_version '9.0' is not one this tooling knows");
  });

  test("path-valued fields: rooted is bundle-relative, dangling warns, repo escape follows repo-links", () => {
    const root = workspace({
      "a.md": "---\ntype: X\ntitle: t\ndescription: d\ngenerated: { by: human:k }\nresource: /b.md\nsources:\n  - { id: s, resource: /nope.md }\n  - { id: d, resource: all queries in project X }\n---\nx[^s] y[^d]\n\n[^s]: s\n[^d]: d\n",
      "b.md": "---\ntype: X\ntitle: t\ndescription: d\ngenerated: { by: human:k }\nresource: ../okflight.toml\n---\nb\n",
      "c.md": "---\ntype: X\ntitle: t\ndescription: d\ngenerated: { by: human:k }\nresource: ../../outside\n---\nc\n",
    });
    const r = run(root);
    expect(r.warnings.join("\n")).toContain("a.md: sources[0].resource '/nope.md' does not resolve in the bundle");
    expect(r.out).not.toContain("a.md: resource");
    expect(r.out).not.toContain("sources[1]");
    expect(r.out).not.toContain("b.md: resource"); // ../okflight.toml exists in the repo
    expect(r.errors.join("\n")).toContain("c.md: resource '../../outside' escapes the repository");
  });
});
