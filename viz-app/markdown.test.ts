// Characterization tests for the hand-rolled markdown renderer — written
// against the pre-refactor behavior; every case here is load-bearing for the
// detail panel.
import { describe, expect, test } from "bun:test";
import { createMd, esc } from "./markdown";

const ctx = {
  files: { "flakes/okf/viz.ts": {}, "modules/dev.nix": {}, "docs/svelt/manual.md": {} },
  byId: { "wiki/architecture": {}, "decisions/other": {} },
  dirs: { "flakes/ccglass": {} },
  commitUrl: "https://github.com/acme/widgets/commit/{hash}",
  commits: { abc1234: "abc1234def5678901234567890123456789012ab" },
};
const md = createMd(ctx);
const from = "decisions/foo"; // bundle-relative concept id

describe("esc", () => {
  test("escapes & < > \"", () => {
    expect(esc(`a & <b> "c"`)).toBe("a &amp; &lt;b&gt; &quot;c&quot;");
  });
});

describe("inline rendering", () => {
  test("code, bold, em", () => {
    expect(md.mdToHtml("has `code` **bold** *em* text", from)).toBe(
      "<p>has <code>code</code> <b>bold</b> <em>em</em> text</p>",
    );
  });

  test("verified commit-hash code span links out to GitHub by full oid", () => {
    expect(md.mdToHtml("landed in `abc1234` upstream", from)).toBe(
      '<p>landed in <code><a href="https://github.com/acme/widgets/commit/abc1234def5678901234567890123456789012ab"' +
        ' target="_blank" rel="noopener">abc1234</a></code> upstream</p>',
    );
  });

  test("unverified hex code span stays plain code", () => {
    expect(md.mdToHtml("nixpkgs rev `b5aa0fb`", from)).toBe("<p>nixpkgs rev <code>b5aa0fb</code></p>");
  });

  test("commit spans stay plain without a commitUrl template", () => {
    const bare = createMd({ files: {}, byId: {}, commits: { abc1234: "abc1234def" } });
    expect(bare.mdToHtml("`abc1234`", from)).toBe("<p><code>abc1234</code></p>");
  });

  test("non-GitHub commit-url template shapes the outbound link", () => {
    const gl = createMd({
      files: {},
      byId: {},
      commitUrl: "https://gitlab.com/o/r/-/commit/{hash}",
      commits: { abc1234: "abc1234def" },
    });
    expect(gl.mdToHtml("`abc1234`", from)).toBe(
      '<p><code><a href="https://gitlab.com/o/r/-/commit/abc1234def" target="_blank" rel="noopener">abc1234</a></code></p>',
    );
  });

  test("<https://…> autolink", () => {
    expect(md.mdToHtml("see <https://example.com/a?b=1>", from)).toBe(
      '<p>see <a href="https://example.com/a?b=1" target="_blank" rel="noopener">https://example.com/a?b=1</a></p>',
    );
  });

  test("concept link resolves to data-node", () => {
    expect(md.mdToHtml("[arch](../wiki/architecture.md)", from)).toBe(
      '<p><a href="#" data-node="wiki/architecture">arch</a></p>',
    );
  });

  test("concept links resolve under a non-default bundleDir (no hardcoded 'knowledge/' offsets)", () => {
    const kb = createMd({ ...ctx, bundleDir: "kb" });
    expect(kb.mdToHtml("[arch](../wiki/architecture.md)", from)).toBe(
      '<p><a href="#" data-node="wiki/architecture">arch</a></p>',
    );
    // Repo-file links resolve one level up from kb/<id>, not knowledge/<id>.
    expect(kb.mdToHtml("[viz](../../flakes/okf/viz.ts)", from)).toBe(
      '<p><a href="#" data-file="flakes/okf/viz.ts">viz</a></p>',
    );
  });

  test("repo-file link resolves to data-file", () => {
    expect(md.mdToHtml("[viz](../../flakes/okf/viz.ts)", from)).toBe(
      '<p><a href="#" data-file="flakes/okf/viz.ts">viz</a></p>',
    );
  });

  test("external link opens new tab", () => {
    expect(md.mdToHtml("[s](https://svelte.dev)", from)).toBe(
      '<p><a href="https://svelte.dev" target="_blank" rel="noopener">s</a></p>',
    );
  });

  test("unresolvable link degrades to title-only anchor", () => {
    expect(md.mdToHtml("[x](../nope.md)", from)).toBe('<p><a title="../nope.md">x</a></p>');
  });

  test("embedded-directory link resolves to data-dir (trailing slash dropped)", () => {
    expect(md.mdToHtml("[flake](../../flakes/ccglass/)", from)).toBe(
      '<p><a href="#" data-dir="flakes/ccglass">flake</a></p>',
    );
  });

  test("unembedded directory link degrades to title-only anchor", () => {
    expect(md.mdToHtml("[x](../../flakes/nope/)", from)).toBe('<p><a title="../../flakes/nope/">x</a></p>');
  });

  test("bundle index links resolve to data-bundle (root index -> empty path)", () => {
    const b = createMd({ ...ctx, bundles: { decisions: {}, "decisions/deep": {} }, root: {} });
    expect(b.mdToHtml("[here](index.md)", from)).toBe('<p><a href="#" data-bundle="decisions">here</a></p>');
    // A bundle index that also got embedded as a repo file still navigates:
    // the reserved-index route outranks the raw file view.
    const shadowed = createMd({
      ...ctx,
      files: { ...ctx.files, "knowledge/decisions/index.md": {} },
      bundles: { decisions: {} },
      root: {},
      bundleDir: "knowledge",
    });
    expect(shadowed.mdToHtml("[here](index.md)", "decisions/foo")).toBe(
      '<p><a href="#" data-bundle="decisions">here</a></p>',
    );
    expect(b.mdToHtml("[deep](deep/index.md)", from)).toBe(
      '<p><a href="#" data-bundle="decisions/deep">deep</a></p>',
    );
    expect(b.mdToHtml("[root](../index.md)", from)).toBe('<p><a href="#" data-bundle="">root</a></p>');
  });

  test("index links without an embedded bundle/root doc degrade to title-only anchors", () => {
    expect(md.mdToHtml("[x](nope/index.md)", from)).toBe('<p><a title="nope/index.md">x</a></p>');
    expect(md.mdToHtml("[r](../index.md)", from)).toBe('<p><a title="../index.md">r</a></p>');
  });
});

describe("bare path autolinking", () => {
  test("bare embedded path becomes a data-file link", () => {
    expect(md.mdToHtml("see flakes/okf/viz.ts here", from)).toBe(
      '<p>see <a href="#" data-file="flakes/okf/viz.ts">flakes/okf/viz.ts</a> here</p>',
    );
  });

  test("path not in files stays plain", () => {
    expect(md.mdToHtml("see scripts/other/nope.ts here", from)).toBe("<p>see scripts/other/nope.ts here</p>");
  });

  test("text inside an existing anchor is not re-linked", () => {
    expect(md.mdToHtml("[flakes/okf/viz.ts](https://example.com)", from)).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener">flakes/okf/viz.ts</a></p>',
    );
  });
});

describe("mdFileToHtml (embedded markdown files)", () => {
  const fromFile = "docs/svelt/learnings.md";

  test("relative links resolve against the file's own directory", () => {
    expect(md.mdFileToHtml("[manual](./manual.md)", fromFile)).toBe(
      '<p><a href="#" data-file="docs/svelt/manual.md">manual</a></p>',
    );
  });

  test("links into knowledge/ resolve to concepts", () => {
    expect(md.mdFileToHtml("[arch](../../knowledge/wiki/architecture.md)", fromFile)).toBe(
      '<p><a href="#" data-node="wiki/architecture">arch</a></p>',
    );
  });

  test("external links and unresolvable targets behave like concept bodies", () => {
    expect(md.mdFileToHtml("[s](https://svelte.dev)", fromFile)).toBe(
      '<p><a href="https://svelte.dev" target="_blank" rel="noopener">s</a></p>',
    );
    expect(md.mdFileToHtml("[x](./nope.md)", fromFile)).toBe('<p><a title="./nope.md">x</a></p>');
  });

  test("bare repo paths still autolink", () => {
    expect(md.mdFileToHtml("see flakes/okf/viz.ts here", fromFile)).toBe(
      '<p>see <a href="#" data-file="flakes/okf/viz.ts">flakes/okf/viz.ts</a> here</p>',
    );
  });
});

describe("pipe tables", () => {
  test("header, alignment, escaped pipe", () => {
    const src = ["| a | b | c |", "| --- | :---: | ---: |", "| 1 | 2 \\| x | 3 |"].join("\n");
    expect(md.mdToHtml(src, from)).toBe(
      '<div class="tbl-wrap"><table><thead><tr><th>a</th><th style="text-align:center">b</th>' +
        '<th style="text-align:right">c</th></tr></thead><tbody><tr><td>1</td>' +
        '<td style="text-align:center">2 | x</td><td style="text-align:right">3</td></tr></tbody></table></div>',
    );
  });

  test("pipe lines without a delimiter row fall back to paragraph", () => {
    expect(md.mdToHtml("| not | a table |", from)).toBe("<p>| not | a table |</p>");
  });
});

describe("blocks", () => {
  test("fenced code escapes content", () => {
    expect(md.mdToHtml("```\nconst a = <b> & c;\n```", from)).toBe(
      "<pre><code>const a = &lt;b&gt; &amp; c;</code></pre>",
    );
  });

  test("unclosed fence still flushes", () => {
    expect(md.mdToHtml("```\ndangling", from)).toBe("<pre><code>dangling</code></pre>");
  });

  test("headings render as h3", () => {
    expect(md.mdToHtml("## Context", from)).toBe("<h3>Context</h3>");
  });

  test("ul with hard-wrap continuation", () => {
    expect(md.mdToHtml("- first line\n  continues here\n- second", from)).toBe(
      "<ul><li>first line continues here</li><li>second</li></ul>",
    );
  });

  test("ol", () => {
    expect(md.mdToHtml("1. one\n2) two", from)).toBe("<ol><li>one</li><li>two</li></ol>");
  });

  test("adjacent paragraph lines merge", () => {
    expect(md.mdToHtml("line one\nline two\n\nnext para", from)).toBe("<p>line one line two</p><p>next para</p>");
  });
});

describe("math (KaTeX)", () => {
  const mathMd = createMd({ ...ctx, math: true });
  const html = (src: string) => mathMd.mdToHtml(src, from);

  test("off by default: delimiters stay literal text, no KaTeX markup", () => {
    expect(md.mdToHtml("energy is $E = mc^2$ exactly", from)).toBe("<p>energy is $E = mc^2$ exactly</p>");
    expect(md.mdToHtml("$\na+b\n$", from)).not.toContain("katex");
    expect(md.mdToHtml("\\(x^2\\)", from)).not.toContain("katex");
  });

  test("inline $…$ renders KaTeX markup inside the paragraph", () => {
    const out = html("energy is $E = mc^2$ exactly");
    expect(out).toStartWith("<p>energy is <span class=\"katex\">");
    expect(out).toEndWith(" exactly</p>");
    expect(out).toContain("<annotation encoding=\"application/x-tex\">E = mc^2</annotation>");
  });

  test("inline \\(…\\) is an equivalent delimiter", () => {
    expect(html("\\(x^2\\)")).toContain('<span class="katex">');
  });

  test("display $$…$$ on one line renders in display mode", () => {
    const out = html("$$\\int_0^1 x\\,dx$$");
    expect(out).toContain("katex-display");
    expect(out).not.toContain("<p>");
  });

  test("display block spanning several lines", () => {
    const out = html("intro\n\n$$\na = b\n+ c\n$$\n\nafter");
    expect(out).toStartWith("<p>intro</p>");
    expect(out).toContain("katex-display");
    expect(out).toEndWith("<p>after</p>");
  });

  test("\\[…\\] display delimiter", () => {
    expect(html("\\[a+b\\]")).toContain("katex-display");
  });

  test("dollars in prose are not math", () => {
    expect(html("costs $5 to $10 per seat")).toBe("<p>costs $5 to $10 per seat</p>");
  });

  test("escaped \\$ stays a literal dollar", () => {
    expect(html("\\$x\\$")).toBe("<p>$x$</p>");
  });

  test("dollars inside a code span stay literal", () => {
    expect(html("run `echo $HOME and $PWD` now")).toBe("<p>run <code>echo $HOME and $PWD</code> now</p>");
  });

  test("math inside a fenced block is not rendered", () => {
    expect(html("```\n$$x^2$$\n```")).toBe("<pre><code>$$x^2$$</code></pre>");
  });

  test("markdown inside math is left to KaTeX", () => {
    // *…* and _…_ are TeX syntax here, not emphasis.
    expect(html("$a_1 * b_2$")).not.toContain("<em>");
  });

  test("a bad formula renders inline as an error, not a throw", () => {
    const out = html("$\\frac{1}$");
    expect(out).toContain("katex-error");
  });

  test("math survives in list items and table cells", () => {
    expect(html("- $x^2$")).toContain('<li><span class="katex"');
    expect(html("| a |\n| --- |\n| $x^2$ |")).toContain('<td><span class="katex"');
  });

  test("unterminated display block still renders", () => {
    expect(html("$$\na+b")).toContain("katex-display");
  });
});

describe("footnotes (OKF §5.1 per-claim attribution)", () => {
  test("marks number in first-reference order; definitions lift to a footnotes list", () => {
    const body = "Sharded daily.[^ga4] Also[^two] and again.[^ga4]\n\n[^ga4]: GA4 export schema\n[^two]: Second *note*\n";
    const html = md.mdToHtml(body, from);
    expect(html).toBe(
      '<p>Sharded daily.<sup class="fn"><a href="#" data-fn="ga4" title="ga4">1</a></sup> Also<sup class="fn"><a href="#" data-fn="two" title="two">2</a></sup> and again.<sup class="fn"><a href="#" data-fn="ga4" title="ga4">1</a></sup></p>' +
        '<div class="footnotes"><ol><li data-fn-target="ga4">GA4 export schema</li><li data-fn-target="two">Second <em>note</em></li></ol></div>',
    );
  });

  test("a definition matching a sources[].id links to the source resource (URL, concept, file, or plain)", () => {
    const sources = [
      { id: "pol", resource: "https://wiki.acme/policy", title: "Policy" },
      { id: "arch", resource: "../wiki/architecture.md" },
      { id: "man", resource: "/svelt/manual.md" },
      { id: "scope", resource: "all queries in project X" },
      { id: "untitled", resource: "https://x/y" },
    ];
    const body = "a[^pol] b[^arch] c[^man] d[^scope] e[^untitled]\n\n[^pol]: The policy\n[^arch]: Arch\n[^man]: Manual\n[^scope]: Scope\n";
    const html = md.mdToHtml(body, from);
    expect(html).not.toContain("footnotes\"><ol><li data-fn-target=\"pol\">The policy —"); // sources not passed: no links
    const linked = md.mdToHtml(body, from, { sources });
    expect(linked).toContain('<li data-fn-target="pol">The policy — <a href="https://wiki.acme/policy" target="_blank" rel="noopener">https://wiki.acme/policy</a></li>');
    expect(linked).toContain('<li data-fn-target="arch">Arch — <a href="#" data-node="wiki/architecture">../wiki/architecture.md</a></li>');
    expect(linked).toContain('<li data-fn-target="man">Manual — <span class="dim">/svelt/manual.md</span></li>');
    expect(linked).toContain('<li data-fn-target="scope">Scope — <span class="dim">all queries in project X</span></li>');
    // No definition line: the source title (or id) stands in.
    expect(linked).toContain('<li data-fn-target="untitled">untitled — <a href="https://x/y"');
  });

  test("marks inside code spans and fences stay literal", () => {
    expect(md.mdToHtml("use `[^x]` here\n\n```\n[^y]: nope\n```\n", from)).toBe("<p>use <code>[^x]</code> here</p><pre><code>[^y]: nope</code></pre>");
  });
});
