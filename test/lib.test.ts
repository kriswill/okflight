// lib.ts frontmatter core + OKF v0.2 readers (SPEC §5, §6.2, §7, §13).
import { describe, expect, test } from "bun:test";
import {
  asVerifiedList,
  extractCitationsSection,
  extractFootnoteDefs,
  extractFootnoteRefs,
  fmToYaml,
  generatedAt,
  isActor,
  isIsoDateTime,
  isStale,
  parseFrontmatter,
  pathKind,
  resolvePathField,
  sourceId,
  statusOf,
  trustTier,
} from "../lib";

const SPEC_REVENUE = `---
type: Attested Computation
title: Revenue for fiscal year
description: Recognized revenue for a fiscal year, per Finance's definition.
status: stable
runtime: bigquery
parameters:
  - { name: year, type: integer, required: true }
executor:
  resource: references/skills/run-on-bq.md
  receipt: [job_id, executed_sql, result]
attester:
  resource: references/attesters/revenue.py
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-20T22:53:05Z }
verified: { by: human:ahormati, at: 2026-06-25T09:00:00Z }
stale_after: 2026-09-23T00:00:00Z
sources:
  - id: rev-policy
    resource: https://wiki.acme/finance/revenue-recognition
    title: Revenue recognition policy
    usage_count: 5000
    last_modified: 2026-05-30T00:00:00Z
usage_window: { from: 2026-06-01T00:00:00Z, to: 2026-06-30T00:00:00Z }
---

# Computation

    SELECT 1
`;

describe("parseFrontmatter", () => {
  test("parses the spec's nested v0.2 families, timestamps as literal strings", () => {
    const { fm, fmError, body } = parseFrontmatter(SPEC_REVENUE);
    expect(fmError).toBeNull();
    expect(fm!.generated).toEqual({ by: "reference_agent/gemini-2.5-pro", at: "2026-06-20T22:53:05Z" });
    expect(fm!.verified).toEqual({ by: "human:ahormati", at: "2026-06-25T09:00:00Z" });
    expect(fm!.parameters).toEqual([{ name: "year", type: "integer", required: true }]);
    expect(fm!.executor).toEqual({
      resource: "references/skills/run-on-bq.md",
      receipt: ["job_id", "executed_sql", "result"],
    });
    expect((fm!.sources as any)[0].usage_count).toBe(5000);
    expect((fm!.sources as any)[0].last_modified).toBe("2026-05-30T00:00:00Z");
    expect(fm!.stale_after).toBe("2026-09-23T00:00:00Z");
    expect(body).toBe("\n# Computation\n\n    SELECT 1\n");
  });

  test("v0.1 flat frontmatter still parses (quoted timestamp, flow tags, block list)", () => {
    const { fm, fmError } = parseFrontmatter(
      "---\ntype: Decision\ntags: [a, b]\ntimestamp: '2026-05-28T22:53:05+00:00'\nrefs:\n  - x\n  - y\n---\nbody\n",
    );
    expect(fmError).toBeNull();
    expect(fm).toEqual({ type: "Decision", tags: ["a", "b"], timestamp: "2026-05-28T22:53:05+00:00", refs: ["x", "y"] });
  });

  test("no frontmatter, unterminated, invalid, and non-mapping blocks", () => {
    expect(parseFrontmatter("# just a body\n")).toEqual({ fm: null, fmError: null, body: "# just a body\n" });
    expect(parseFrontmatter("---\ntype: X\n").fmError).toBe("unterminated frontmatter block");
    expect(parseFrontmatter("---\ntype: [unclosed\n---\n").fmError).toMatch(/^invalid YAML/);
    expect(parseFrontmatter("---\n- a\n- b\n---\n").fmError).toBe("frontmatter must be a YAML mapping");
    expect(parseFrontmatter("---\n# only a comment\n---\nb").fm).toEqual({});
  });
});

describe("fmToYaml", () => {
  test("round-trips the spec example in the spec's own style", () => {
    const { fm } = parseFrontmatter(SPEC_REVENUE);
    const yaml = fmToYaml(fm!);
    expect(yaml).toContain("generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-20T22:53:05Z }");
    expect(yaml).toContain("parameters:\n  - { name: year, type: integer, required: true }");
    expect(yaml).toContain("sources:\n  - id: rev-policy\n    resource: https://wiki.acme/finance/revenue-recognition");
    expect(yaml).toContain("executor:\n  resource: references/skills/run-on-bq.md\n  receipt: [job_id, executed_sql, result]");
    expect(parseFrontmatter(yaml + "\n").fm).toEqual(fm);
  });

  test("quotes exactly what YAML would misread; leaves actors, URLs, dates bare", () => {
    const fm = {
      a: "human:k",
      b: "https://x.y/z",
      c: "2026-06-28T14:00:00Z",
      d: "Revenue: FY",
      e: "x # y",
      f: "5000",
      g: "yes",
      h: "it's",
      i: "",
      j: "1e3",
      k: "-x",
      l: ["a b", "c, d"],
      m: 5000,
      n: true,
    };
    const yaml = fmToYaml(fm);
    expect(yaml).toContain("a: human:k\nb: https://x.y/z\nc: 2026-06-28T14:00:00Z\nd: 'Revenue: FY'\ne: 'x # y'\nf: '5000'\ng: 'yes'\nh: 'it''s'\ni: ''\nj: '1e3'\nk: '-x'\nl: [a b, 'c, d']\nm: 5000\nn: true");
    expect(parseFrontmatter(yaml + "\n").fm).toEqual(fm);
  });

  test("undefined values are dropped; flat string lists stay flow lists", () => {
    expect(fmToYaml({ type: "X", tags: ["a"], gone: undefined })).toBe("---\ntype: X\ntags: [a]\n---\n");
  });
});

describe("trust / lifecycle readers", () => {
  test("asVerifiedList: bare mapping is a one-element list (§5.2)", () => {
    expect(asVerifiedList({ by: "human:a", at: "x" })).toEqual([{ by: "human:a", at: "x" }]);
    expect(asVerifiedList([{ by: "process:p" }, "junk", { by: "human:a" }])).toEqual([{ by: "process:p" }, { by: "human:a" }]);
    expect(asVerifiedList(undefined)).toEqual([]);
    expect(asVerifiedList("human:a")).toEqual([]);
  });

  test("trustTier (§5.3)", () => {
    expect(trustTier({ type: "X" })).toBe("unverified");
    expect(trustTier({ verified: { by: "process:nightly", at: "x" } })).toBe("machine-confirmed");
    expect(trustTier({ verified: [{ by: "agent/1.0" }, { by: "human:k" }] })).toBe("human-reviewed");
    expect(trustTier({ verified: [] })).toBe("unverified");
  });

  test("statusOf defaults to stable (§5.4)", () => {
    expect(statusOf({})).toBe("stable");
    expect(statusOf({ status: "draft" })).toBe("draft");
    expect(statusOf({ status: "deprecated" })).toBe("deprecated");
    expect(statusOf({ status: "bogus" })).toBe("stable");
  });

  test("isStale is now >= stale_after (§5.5)", () => {
    const fm = { stale_after: "2026-09-23T00:00:00Z" };
    expect(isStale(fm, new Date("2026-09-22T23:59:59Z"))).toBe(false);
    expect(isStale(fm, new Date("2026-09-23T00:00:00Z"))).toBe(true);
    expect(isStale({}, new Date())).toBe(false);
    expect(isStale({ stale_after: "soon" }, new Date())).toBe(false);
  });

  test("generatedAt falls back to the v0.1 timestamp (§13.1)", () => {
    expect(generatedAt({ generated: { by: "human:k", at: "2026-01-01T00:00:00Z" }, timestamp: "old" })).toBe("2026-01-01T00:00:00Z");
    expect(generatedAt({ generated: { by: "human:k" }, timestamp: "2025-01-01T00:00:00+00:00" })).toBe("2025-01-01T00:00:00+00:00");
    expect(generatedAt({})).toBeUndefined();
  });

  test("isIsoDateTime requires an explicit offset (or a bare date)", () => {
    expect(isIsoDateTime("2026-06-30T14:00:00Z")).toBe(true);
    expect(isIsoDateTime("2026-05-28T22:53:05+00:00")).toBe(true);
    expect(isIsoDateTime("2026-05-28")).toBe(true);
    expect(isIsoDateTime("2026-06-30T14:00:00")).toBe(false);
    expect(isIsoDateTime("June 30")).toBe(false);
    expect(isIsoDateTime(20260630)).toBe(false);
  });

  test("isActor (§7)", () => {
    for (const ok of ["human:ahormati", "process:finance-nightly", "reference_agent/gemini-2.5-pro", "okflight/0.4.0"])
      expect(isActor(ok)).toBe(true);
    for (const bad of ["ahormati", "human:", "a b/c", "team:x", ""]) expect(isActor(bad)).toBe(false);
  });
});

describe("path-valued fields (§6.2)", () => {
  test("pathKind", () => {
    expect(pathKind("https://x/y")).toBe("url");
    expect(pathKind("/tables/customers.md")).toBe("rooted");
    expect(pathKind("../computations/revenue.md")).toBe("relative");
    expect(pathKind("references/attesters/revenue.py")).toBe("relative");
    expect(pathKind("dashboards/exec-revenue")).toBe("relative");
    expect(pathKind("all queries in BigQuery project X")).toBe("descriptor");
    expect(pathKind("orders")).toBe("descriptor");
  });

  test("resolvePathField: rooted is bundle-relative, relative is doc-relative, escapes are null", () => {
    expect(resolvePathField("/b", "metrics/x.md", "/tables/customers.md")).toBe("tables/customers.md");
    expect(resolvePathField("/b", "metrics/x.md", "../computations/revenue.md")).toBe("computations/revenue.md");
    expect(resolvePathField("/b", "x.md", "references/a.py")).toBe("references/a.py");
    expect(resolvePathField("/b", "x.md", "../../etc/passwd")).toBeNull();
    expect(resolvePathField("/b", "x.md", "/../etc")).toBeNull();
    expect(resolvePathField("/b", "x.md", "https://x")).toBeNull();
    expect(resolvePathField("/b", "x.md", "all queries in X")).toBeNull();
  });
});

describe("body conventions", () => {
  const body = `Sharded daily.[^ga4-schema] Also[^two] and again[^ga4-schema].

\`\`\`
not[^in-code]
\`\`\`

[^ga4-schema]: GA4 BigQuery Export schema
[^two]: Second
`;
  test("footnote refs and defs skip fences and definitions", () => {
    expect(extractFootnoteRefs(body)).toEqual(["ga4-schema", "two"]);
    expect(extractFootnoteDefs(body)).toEqual({ "ga4-schema": "GA4 BigQuery Export schema", two: "Second" });
  });

  test("extractCitationsSection: links, bare URLs, and non-link items with the removable range", () => {
    const b = `## Context

x

## Citations

- [FP&A handbook](https://wiki.acme/finance/fpa-handbook)
- <https://wiki.acme/finance/cost-allocation>
- https://example.com/x - the x doc
- Commits \`abc1234\`

## After
`;
    const c = extractCitationsSection(b)!;
    expect(c.items).toEqual([
      { resource: "https://wiki.acme/finance/fpa-handbook", title: "FP&A handbook", raw: "[FP&A handbook](https://wiki.acme/finance/fpa-handbook)" },
      { resource: "https://wiki.acme/finance/cost-allocation", title: "https://wiki.acme/finance/cost-allocation", raw: "<https://wiki.acme/finance/cost-allocation>" },
      { resource: "https://example.com/x", title: "the x doc", raw: "https://example.com/x - the x doc" },
      { resource: null, title: "Commits `abc1234`", raw: "Commits `abc1234`" },
    ]);
    const lines = b.split("\n");
    expect(lines[c.range[0]]).toBe("## Citations");
    expect(lines[c.range[1] - 1]).toBe("- Commits `abc1234`");
    expect(extractCitationsSection("# Citations\n")!.items).toEqual([]);
    expect(extractCitationsSection("## Sources\n- x\n")).toBeNull();
    expect(extractCitationsSection("```\n# Citations\n```\n")).toBeNull();
  });

  test("sourceId slugs titles and URLs", () => {
    expect(sourceId("Revenue recognition policy")).toBe("revenue-recognition-policy");
    expect(sourceId("https://www.wiki.acme/finance/fpa-handbook")).toBe("wiki-acme-finance-fpa-handbook");
    expect(sourceId("!!!")).toBe("source");
  });
});

describe("code-review follow-ups", () => {
  test("lenient scalars: unquoted ': ' and ' #' values read as written; block scalars untouched", () => {
    const { fm, fmError } = parseFrontmatter(
      "---\ntype: Note\ntitle: Issue #42 follow-up\ndescription: Note: see X\nrefs:\n  - Commits: abc\n  - see: also\nbody_text: |\n  a: b # not a comment\n  c\n---\n",
    );
    expect(fmError).toBeNull();
    expect(fm!.title).toBe("Issue #42 follow-up");
    expect(fm!.description).toBe("Note: see X");
    expect(fm!.refs).toEqual([{ Commits: "abc" }, { see: "also" }]);
    expect(fm!.body_text).toBe("a: b # not a comment\nc\n");
    expect(fmToYaml(fm!)).toContain("title: 'Issue #42 follow-up'\ndescription: 'Note: see X'");
  });

  test("string-typed keys keep bare numbers/booleans as text", () => {
    const { fm } = parseFrontmatter("---\ntype: 2024\ntitle: 2024\ndescription: true\ntags: [2024, foo]\nokf_version: 0.2\ncount: 3\n---\n");
    expect(fm).toEqual({ type: "2024", title: "2024", description: "true", tags: ["2024", "foo"], okf_version: "0.2", count: 3 });
  });

  test("multi-line strings serialize as block scalars and round-trip", () => {
    const fm = { type: "X", description: "first line\nsecond line\n", note: "no trailing\nnewline", generated: { by: "human:k", at: "a\nb" } };
    const yaml = fmToYaml(fm);
    expect(yaml).toContain("description: |\n  first line\n  second line\nnote: |-\n  no trailing\n  newline\n");
    expect(yaml).toContain('generated: { by: human:k, at: "a\\nb" }');
    expect(parseFrontmatter(yaml + "\n").fm).toEqual(fm);
  });

  test("rooted path fields drop a #fragment before resolving", () => {
    expect(resolvePathField("/b", "x.md", "/tables/customers.md#joins")).toBe("tables/customers.md");
    expect(resolvePathField("/b", "x.md", "/#top")).toBeNull();
  });

  test("footnote grammar: indented definitions count, indented fences do not hide marks (viewer parity)", () => {
    const body = "text[^x]\n\n  [^x]: note\n\n    ```\n    [^y]\n    ```\n";
    expect(extractFootnoteDefs(body)).toEqual({ x: "note" });
    expect(extractFootnoteRefs(body)).toEqual(["x", "y"]);
  });
});

describe("extractCitationsSection — prefixed items (dotfiles shapes)", () => {
  test("first link/URL anywhere in the item is the source; prose before it joins the title", () => {
    const b = "## Citations\n\n- nix-darwin homebrew options — <https://nix-darwin.github.io/manual>\n- Fork supervision layer: [nix/tools/README.md](https://gh/x/README.md)\n- Manual: [`docs/helium.md`](../../docs/helium.md) — dated learned-behaviour\n- Commits `abc` (PR #22)\n";
    expect(extractCitationsSection(b)!.items.map(({ resource, title }) => [resource, title])).toEqual([
      ["https://nix-darwin.github.io/manual", "nix-darwin homebrew options"],
      ["https://gh/x/README.md", "Fork supervision layer: nix/tools/README.md"],
      ["../../docs/helium.md", "Manual: docs/helium.md"],
      [null, "Commits `abc` (PR #22)"],
    ]);
    expect(sourceId("How the Open Knowledge Format can improve data sharing")).toBe("how-the-open-knowledge-format-can-improve-data");
  });
});

describe("footnote refs ignore inline code (viewer parity)", () => {
  test("a [^id] inside backticks is prose about footnotes, not a citation", () => {
    expect(extractFootnoteRefs("write `…documented.[^manual]` to cite; real one here[^real]\n\n[^real]: r\n")).toEqual(["real"]);
  });
});
