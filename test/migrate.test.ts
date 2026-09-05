// okf migrate: the pure per-doc step (migrate-doc.ts) and the driver end to
// end on a throwaway v0.1 workspace — dry run, --write, idempotence, and the
// validate hand-off.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter } from "../lib";
import { migrateDoc } from "../migrate-doc";

const OKF = join(import.meta.dir, "..", "okf.ts");
const BY = "okflight/test";

describe("migrateDoc", () => {
  test("timestamp -> generated in place; nothing else touched", () => {
    const fm = { type: "Decision", title: "t", timestamp: "2026-05-28T22:53:05+00:00", tags: ["a"], custom: { k: 1 } };
    const m = migrateDoc(fm, "body\n", BY)!;
    expect(Object.keys(m.fm)).toEqual(["type", "title", "generated", "tags", "custom"]);
    expect(m.fm.generated).toEqual({ by: BY, at: "2026-05-28T22:53:05+00:00" });
    expect(m.fm.custom).toEqual({ k: 1 });
    expect(m.body).toBe("body\n");
    expect(m.notes).toEqual([`timestamp -> generated { by: ${BY}, at: 2026-05-28T22:53:05+00:00 }`]);
  });

  test("existing generated wins; timestamp only fills a missing generated.at", () => {
    const keep = migrateDoc({ type: "X", generated: { by: "human:k", at: "2026-01-01T00:00:00Z" }, timestamp: "2025-01-01" }, "", BY)!;
    expect(keep.fm.generated).toEqual({ by: "human:k", at: "2026-01-01T00:00:00Z" });
    expect(keep.fm.timestamp).toBeUndefined();
    const fill = migrateDoc({ type: "X", generated: { by: "human:k" }, timestamp: "2025-01-01T00:00:00Z" }, "", BY)!;
    expect(fill.fm.generated).toEqual({ by: "human:k", at: "2025-01-01T00:00:00Z" });
    expect(fill.fm.timestamp).toBeUndefined();
  });

  test("Citations list -> sources; section removed; ids unique; existing sources kept", () => {
    const body = `## Context

x

## Citations

- [FP&A handbook](https://wiki.acme/finance/fpa-handbook)
- [FP&A handbook](https://wiki.acme/finance/fpa-handbook-v2)
- <https://wiki.acme/finance/cost-allocation>
- https://wiki.acme/finance/known

## After

y
`;
    const m = migrateDoc({ type: "X", sources: [{ id: "known", resource: "https://wiki.acme/finance/known" }] }, body, BY)!;
    expect(m.fm.sources).toEqual([
      { id: "known", resource: "https://wiki.acme/finance/known" },
      { id: "fp-a-handbook", resource: "https://wiki.acme/finance/fpa-handbook", title: "FP&A handbook" },
      { id: "fp-a-handbook-2", resource: "https://wiki.acme/finance/fpa-handbook-v2", title: "FP&A handbook" },
      { id: "wiki-acme-finance-cost-allocation", resource: "https://wiki.acme/finance/cost-allocation" },
    ]);
    expect(m.body).toBe("## Context\n\nx\n\n## After\n\ny\n");
    expect(m.notes).toEqual(["Citations -> sources (3 added, 1 kept)", "Citations section removed"]);
  });

  test("non-link citation items keep the section and are reported", () => {
    const body = "## Decision\n\nz\n\n## Citations\n\n- [Doc](https://x/doc)\n- Commits `abc1234`\n";
    const m = migrateDoc({ type: "Decision" }, body, BY)!;
    expect(m.fm.sources).toEqual([{ id: "doc", resource: "https://x/doc", title: "Doc" }]);
    expect(m.body).toBe(body);
    expect(m.notes[1]).toContain('1 Citations item(s) are not sources, left in place: "Commits `abc1234`"');
  });

  test("a v0.2 doc is a no-op (idempotent)", () => {
    expect(migrateDoc({ type: "X", generated: { by: "human:k", at: "2026-01-01T00:00:00Z" }, sources: [] }, "body[^a]\n\n[^a]: a\n", BY)).toBeNull();
    expect(migrateDoc({ type: "X" }, "## Citations\n\n- Commits `abc`\n", BY)).toBeNull();
  });
});

describe("okf migrate (driver)", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  const run = (cwd: string, cmd: string, ...args: string[]) => {
    const r = Bun.spawnSync([process.execPath, OKF, cmd, ...args], { cwd, env: { ...process.env, NO_COLOR: "1" } });
    return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
  };

  test("dry run changes nothing; --write migrates, validates clean, and is idempotent", () => {
    const root = mkdtempSync(join(tmpdir(), "okf-migrate-"));
    dirs.push(root);
    writeFileSync(join(root, "okflight.toml"), '[bundle]\ndir = "kb"\n[vcs]\nprovider = "none"\n[scaffold]\nactor = "human:kris"\n');
    mkdirSync(join(root, "kb/decisions"), { recursive: true });
    writeFileSync(join(root, "kb/index.md"), "---\nokf_version: '0.1'\n---\n\n# kb\n\nBlurb.\n");
    const old = "---\ntype: Decision\ntitle: Old\ndescription: d\ntags: [x]\ntimestamp: '2026-05-28T22:53:05+00:00'\n---\n\n## Context\n\nx\n\n## Citations\n\n- [Doc](https://example.com/doc)\n";
    writeFileSync(join(root, "kb/decisions/old.md"), old);
    writeFileSync(join(root, "kb/new.md"), "---\ntype: Note\ntitle: New\ndescription: d\ngenerated: { by: human:k, at: 2026-05-28T22:53:05Z }\n---\nbody\n");

    const dry = run(root, "migrate");
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("~ decisions/old.md");
    expect(dry.out).toContain("timestamp -> generated { by: human:kris, at: 2026-05-28T22:53:05+00:00 }");
    expect(dry.out).toContain("~ index.md\n    okf_version 0.1 -> 0.2");
    expect(dry.out).toContain("2 file(s) would change (dry run)");
    expect(readFileSync(join(root, "kb/decisions/old.md"), "utf8")).toBe(old);

    const write = run(root, "migrate", "--write");
    expect(write.code).toBe(0);
    expect(write.out).toContain("2 file(s) rewritten");
    const migrated = readFileSync(join(root, "kb/decisions/old.md"), "utf8");
    expect(migrated).toBe(
      "---\ntype: Decision\ntitle: Old\ndescription: d\ntags: [x]\ngenerated: { by: human:kris, at: 2026-05-28T22:53:05+00:00 }\nsources:\n  - id: doc\n    resource: https://example.com/doc\n    title: Doc\n---\n\n## Context\n\nx\n",
    );
    expect(parseFrontmatter(readFileSync(join(root, "kb/index.md"), "utf8")).fm).toEqual({ okf_version: "0.2" });
    expect(readFileSync(join(root, "kb/index.md"), "utf8")).toContain("\n# kb\n\nBlurb.\n");

    const v = run(root, "validate");
    expect(v.out).not.toContain("ERROR");
    expect(v.out).not.toContain("superseded");
    expect(v.code).toBe(0);

    const again = run(root, "migrate", "--write");
    expect(again.out).toContain("nothing to do");
    expect(readFileSync(join(root, "kb/decisions/old.md"), "utf8")).toBe(migrated);
  });

  test("--actor overrides config and must be actor-shaped", () => {
    const root = mkdtempSync(join(tmpdir(), "okf-migrate-"));
    dirs.push(root);
    writeFileSync(join(root, "okflight.toml"), '[bundle]\ndir = "kb"\n[vcs]\nprovider = "none"\n');
    mkdirSync(join(root, "kb"));
    writeFileSync(join(root, "kb/a.md"), "---\ntype: X\ntimestamp: '2026-01-01'\n---\nb\n");
    expect(run(root, "migrate", "--actor=bogus").code).toBe(1);
    expect(run(root, "migrate", "--actor=process:ci").out).toContain("generated { by: process:ci, at: 2026-01-01 }");
    expect(run(root, "migrate").out).toMatch(/generated \{ by: okflight\/\d+\.\d+\.\d+/);
  });
});
