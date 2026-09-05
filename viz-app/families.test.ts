// OKF v0.2 frontmatter families in the detail panel (families.ts): actors,
// events, tier/status chips, the stale badge, sources/parameters tables,
// path links, and the generic nested fallback.
import { describe, expect, test } from "bun:test";
import { actorHtml, familyRow, familyRows, genericHtml, type FamilyCtx } from "./families";

const ctx: FamilyCtx = {
  fmtDate: (v) => (typeof v === "string" && /^2026-06-25/.test(v) ? "Jun 25, 2026" : null),
  pathLink: (v) => (v === "references/attesters/revenue.py" ? `<a href="#" data-file="kb/${v}">${v}</a>` : v === "../computations/revenue.md" ? '<a href="#" data-node="computations/revenue">../computations/revenue.md</a>' : null),
  plain: (_k, v) => `plain:${String(v)}`,
  now: new Date("2026-09-04T00:00:00Z"),
};

describe("actors and events", () => {
  test("actorHtml tags human/process and leaves producer/version as agent", () => {
    expect(actorHtml("human:ahormati")).toBe('<span class="actor actor-human"><span class="kind">human</span>ahormati</span>');
    expect(actorHtml("process:finance-nightly")).toContain('actor-process"><span class="kind">process</span>finance-nightly');
    expect(actorHtml("reference_agent/gemini-2.5-pro")).toBe('<span class="actor actor-agent">reference_agent/gemini-2.5-pro</span>');
    expect(actorHtml("<x>")).toBe('<span class="actor actor-agent">&lt;x&gt;</span>');
  });

  test("generated renders by · at with the date humanized", () => {
    const fm = { generated: { by: "human:k", at: "2026-06-25T09:00:00Z" } };
    const row = familyRow(ctx, fm, "generated", fm.generated);
    expect(row).toBe('<tr><td>generated</td><td><span class="actor actor-human"><span class="kind">human</span>k</span> · <span class="when">Jun 25, 2026</span></td></tr>');
  });

  test("verified: bare mapping and list both get the tier chip and an event per verifier", () => {
    const bare = { verified: { by: "process:nightly", at: "x" } };
    expect(familyRow(ctx, bare, "verified", bare.verified)).toContain('<span class="fam-chip tier-machine-confirmed">machine-confirmed</span><ul class="events"><li>');
    const list = { verified: [{ by: "process:nightly" }, { by: "human:k", at: "2026-06-25T09:00:00Z" }] };
    const row = familyRow(ctx, list, "verified", list.verified);
    expect(row).toContain("tier-human-reviewed");
    expect(row.match(/<li>/g)).toHaveLength(2);
    expect(row).toContain("Jun 25, 2026");
  });
});

describe("lifecycle", () => {
  test("status chip uses the written value; stale_after gets the badge only when past", () => {
    expect(familyRow(ctx, { status: "deprecated" }, "status", "deprecated")).toContain('<span class="fam-chip status-deprecated">deprecated</span>');
    expect(familyRow(ctx, { status: "bogus" }, "status", "bogus")).toContain('status-stable">bogus</span>');
    expect(familyRow(ctx, { stale_after: "2026-06-15T00:00:00Z" }, "stale_after", "2026-06-15T00:00:00Z")).toContain('<span class="fam-chip stale">stale</span>');
    expect(familyRow(ctx, { stale_after: "2099-01-01T00:00:00Z" }, "stale_after", "2099-01-01T00:00:00Z")).not.toContain("stale</span>");
  });
});

describe("provenance", () => {
  test("sources table: only the columns present, titled resources link, actors tagged, per-entry window", () => {
    const sources = [
      { id: "rev", resource: "https://wiki.acme/rev", title: "Revenue policy", author: "team:fpa", usage_count: 5000, last_modified: "2026-06-25T00:00:00Z" },
      { id: "att", resource: "references/attesters/revenue.py", usage_window: { from: "2026-06-25T00:00:00Z", to: "2026-06-25T00:00:00Z" } },
      { resource: "all queries in project X" },
    ];
    const row = familyRow(ctx, { sources }, "sources", sources);
    expect(row).toContain("<th>id</th><th>resource</th><th>author</th><th>usage</th><th>last_modified</th>");
    expect(row).toContain('<a href="https://wiki.acme/rev" target="_blank" rel="noopener">Revenue policy</a>');
    expect(row).toContain('<a href="#" data-file="kb/references/attesters/revenue.py">references/attesters/revenue.py</a>');
    expect(row).toContain("<code>all queries in project X</code>");
    expect(row).toContain('<span class="actor actor-agent">team:fpa</span>');
    expect(row).toContain("<td>5000</td>");
    expect(row).toContain("<td>Jun 25, 2026</td>");
    expect(row).toContain('<tr class="win"><td colspan="5">window Jun 25, 2026 → Jun 25, 2026</td></tr>');
    expect(row).toContain('<code id="src-rev">rev</code>');
  });

  test("usage_window renders as a range", () => {
    const w = { from: "2026-06-25T00:00:00Z", to: "2026-07-01T00:00:00Z" };
    expect(familyRow(ctx, { usage_window: w }, "usage_window", w)).toContain('Jun 25, 2026 <span class="range">→</span> 2026-07-01T00:00:00Z');
  });
});

describe("computation", () => {
  test("parameters table, runtime code, computation/executor/attester links with receipt", () => {
    const fm = {
      runtime: "bigquery",
      parameters: [{ name: "year", type: "integer", required: true }, { name: "seg", type: "string", required: false }],
      computation: "../computations/revenue.md",
      executor: { resource: "references/skills/run-on-bq.md", receipt: ["job_id", "result"] },
      attester: { resource: "references/attesters/revenue.py" },
    };
    expect(familyRow(ctx, fm, "runtime", fm.runtime)).toBe("<tr><td>runtime</td><td><code>bigquery</code></td></tr>");
    const params = familyRow(ctx, fm, "parameters", fm.parameters);
    expect(params).toContain("<tr><td><code>year</code></td><td>integer</td><td>required</td></tr>");
    expect(params).toContain("<tr><td><code>seg</code></td><td>string</td><td>optional</td></tr>");
    expect(familyRow(ctx, fm, "computation", fm.computation)).toContain('data-node="computations/revenue"');
    const ex = familyRow(ctx, fm, "executor", fm.executor);
    expect(ex).toContain("<code>references/skills/run-on-bq.md</code>"); // not embedded: plain code
    expect(ex).toContain('<span class="dim">receipt:</span> <code>job_id</code> <code>result</code>');
    expect(familyRow(ctx, fm, "attester", fm.attester)).toContain('data-file="kb/references/attesters/revenue.py"');
  });
});

describe("fallbacks", () => {
  test("unknown scalar keys go through the panel's plain cell; nested unknowns become a sub-table", () => {
    expect(familyRow(ctx, {}, "owner", "x")).toBe("<tr><td>owner</td><td>plain:x</td></tr>");
    expect(genericHtml(ctx, { a: 1, b: ["x", "y"], c: { d: "e" } })).toBe(
      '<table class="sub"><tbody><tr><td>a</td><td>1</td></tr><tr><td>b</td><td>x, y</td></tr><tr><td>c</td><td><table class="sub"><tbody><tr><td>d</td><td>e</td></tr></tbody></table></td></tr></tbody></table>',
    );
    expect(genericHtml(ctx, [{ a: "<" }])).toBe('<ol class="sub"><li><table class="sub"><tbody><tr><td>a</td><td>&lt;</td></tr></tbody></table></li></ol>');
  });

  test("familyRows keeps frontmatter order and skips title/type", () => {
    const html = familyRows(ctx, { type: "X", title: "T", description: "d", status: "draft", generated: { by: "human:k" } });
    expect(html.match(/<tr><td>(\w+)<\/td>/g)).toEqual(["<tr><td>description</td>", "<tr><td>status</td>", "<tr><td>generated</td>"]);
  });
});
