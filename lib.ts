// Shared PURE helpers for the OKF knowledge-bundle tooling (validate/index/
// scaffold/migrate/viz): frontmatter parse/serialize, the OKF v0.2 trust/
// lifecycle/provenance readers, link extraction/resolution, bundle walking,
// slugs, ANSI. No package dependency by design — frontmatter YAML is parsed
// by Bun's built-in Bun.YAML (Bun >= 1.3.13), so the bundle stays consumable
// without a package.json; serialization is our own, so emitted docs keep the
// spec's hand-written style (flow mappings for {by, at}, block lists for
// sources). Anything VCS-shaped lives behind vcs/ providers; config and
// workspace context live in config-cli.ts.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

// The v0.2 readers (trust tier, status, staleness, generated.at fallback) and
// the FM type live in the browser-safe viz-app/okf-fields.ts so the viewer
// derives them identically; re-exported here for the CLI modules.
export * from "./viz-app/okf-fields";
import { asVerifiedList, FENCE_RE, FOOTNOTE_DEF_RE, isPlainObject, obj, str, type FM } from "./viz-app/okf-fields";

/** The spec revision this tooling implements (SPEC.md §12). */
export const OKF_VERSION = "0.2";
/** Bundle-root `okf_version` values consumed without a best-effort warning. */
export const SUPPORTED_OKF_VERSIONS: readonly string[] = ["0.1", "0.2"];

interface ConceptDoc {
  rel: string; // path relative to bundle root, e.g. "modules/nh.md"
  abs: string;
  fm: FM | null;
  fmError: string | null;
  body: string;
  raw: string;
}

// Reserved filenames and required/recommended frontmatter fields are profile
// policy, configured via okflight.toml's [profile] section (defaults in
// config-cli.ts) — commands read them from the loaded context.

/** All .md files under root, as sorted bundle-relative paths. */
export function walkMd(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry.startsWith(".") || entry.startsWith("_")) continue;
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (entry.endsWith(".md")) out.push(abs.slice(root.length + 1));
    }
  };
  walk(root);
  return out.sort();
}

export function parseDoc(root: string, rel: string): ConceptDoc {
  const abs = join(root, rel);
  const raw = readFileSync(abs, "utf8");
  const { fm, fmError, body } = parseFrontmatter(raw);
  return { rel, abs, fm, fmError, body, raw };
}

/** Split a doc into its YAML frontmatter mapping and body. No frontmatter
 *  (file doesn't open with `---`) is fm: null with no error; an unterminated
 *  block, unparseable YAML, or a non-mapping document is fm: null WITH an
 *  fmError. Non-string scalars (numbers, booleans) come through typed;
 *  YAML timestamps are kept as the literal string they were written as. */
export function parseFrontmatter(raw: string): {
  fm: FM | null;
  fmError: string | null;
  body: string;
} {
  if (!raw.startsWith("---\n")) return { fm: null, fmError: null, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { fm: null, fmError: "unterminated frontmatter block", body: raw };
  const block = raw.slice(4, end);
  const body = raw.slice(end + 5);
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(lenientScalars(block));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { fm: null, fmError: `invalid YAML — ${msg.split("\n")[0]}`, body };
  }
  if (parsed === null || parsed === undefined) return { fm: {}, fmError: null, body };
  if (!isPlainObject(parsed)) return { fm: null, fmError: "frontmatter must be a YAML mapping", body };
  return { fm: coerceStringFields(revive(parsed) as FM), fmError: null, body };
}

/** Hand-written v0.1 frontmatter (and most humans) write plain scalars
 *  YAML reads differently: `description: Note: see X` is a parse error,
 *  `title: Issue #42` silently drops the `#42`, `- Commits: abc` too. Before
 *  parsing, single-quote any unquoted plain scalar in a `key: value` /
 *  `- value` line that contains `: ` or ` #` or ends in `:` — the same
 *  cases yamlScalar quotes on the way out — so what was written is what is
 *  read. Block scalars, flow collections, and already-quoted values are
 *  left alone. */
export function lenientScalars(block: string): string {
  let inBlockScalar: number | null = null; // indent of an open `|`/`>` body
  return block
    .split("\n")
    .map((line) => {
      const indent = line.match(/^\s*/)![0].length;
      if (inBlockScalar !== null) {
        if (line.trim() === "" || indent > inBlockScalar) return line;
        inBlockScalar = null;
      }
      const m = /^(\s*(?:-\s+)?(?:[A-Za-z0-9_.-]+:\s+)?)(.*)$/.exec(line);
      if (!m || !m[1]) return line;
      const [, head, value] = m;
      if (/^[|>]/.test(value)) {
        inBlockScalar = indent;
        return line;
      }
      if (value === "" || /^['"\[{&*!%@`]/.test(value)) return line;
      if (/^#/.test(value)) return line; // a comment, not a value
      if (!(/: /.test(value) || /\s#/.test(value) || /:$/.test(value))) return line;
      return `${head}'${value.replace(/'/g, "''")}'`;
    })
    .join("\n");
}

/** The spec's string-typed keys keep their written text even when YAML
 *  would read a number, boolean, or date (`title: 2024`, `tags: [2024]`). */
function coerceStringFields(fm: FM): FM {
  for (const k of ["type", "title", "description", "resource", "timestamp", "okf_version"])
    if (fm[k] !== undefined && fm[k] !== null && typeof fm[k] !== "string" && !isPlainObject(fm[k]) && !Array.isArray(fm[k]))
      fm[k] = String(fm[k]);
  if (Array.isArray(fm.tags)) fm.tags = fm.tags.map((t) => (typeof t === "string" || isPlainObject(t) || Array.isArray(t) ? t : String(t)));
  return fm;
}

/** Bun.YAML turns bare ISO timestamps into Date objects; OKF treats every
 *  timestamp as the literal string written (§5), so put them back. */
function revive(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString().replace(/\.000Z$/, "Z");
  if (Array.isArray(v)) return v.map(revive);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = revive(x);
    return out;
  }
  return v;
}

// --- Serialization ------------------------------------------------------------
// Emits the spec's own hand-written style: bare scalars where YAML allows
// (quoted otherwise), flat string lists as flow lists, small mappings
// ({by, at}, usage_window, parameter entries) as flow mappings, lists of
// mappings (sources, verified) as block lists, other mappings as indented
// block mappings. Round-trips through parseFrontmatter.

function yamlScalar(s: string): string {
  if (
    s === "" ||
    /: |\s#|[,\[\]{}'"]/.test(s) || // mapping/comment/flow/quote indicators inside
    /:$/.test(s) ||
    /^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) ||
    /^\s|\s$/.test(s) ||
    /^[+-]?(\d[\d_]*\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) || // would parse as a number
    /^0x[0-9a-f]+$/i.test(s) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(s)
  )
    return `'${s.replace(/'/g, "''")}'`;
  // Bare ISO timestamps and `human:x` / `https://…` stay bare, as in the
  // spec's examples — parseFrontmatter revives YAML dates back to strings.
  return s;
}

function yamlValueInline(v: unknown): string {
  // Newlines can't live in a single-quoted flow scalar; JSON's double-quoted
  // form (\n escapes) is valid YAML anywhere.
  if (typeof v === "string") return v.includes("\n") ? JSON.stringify(v) : yamlScalar(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(yamlValueInline).join(", ")}]`;
  if (isPlainObject(v))
    return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${yamlValueInline(x)}`).join(", ")} }`;
  return yamlScalar(String(v));
}

/** A mapping is "small" (flow style) when every value is a scalar, it has at
 *  most four keys — {by, at}, {from, to}, {name, type, required} — and it
 *  names no `resource`: entries that point somewhere (sources, executor,
 *  attester) are block style, as the spec writes them. */
const isSmallMap = (v: Record<string, unknown>) =>
  Object.keys(v).length <= 4 &&
  !("resource" in v) &&
  Object.values(v).every((x) => !Array.isArray(x) && !isPlainObject(x));

function yamlLines(key: string, v: unknown, indent: string): string[] {
  // Multi-line strings keep the block form they were written in (`|` keeps
  // the final newline, `|-` drops it), one line per source line.
  if (typeof v === "string" && v.includes("\n")) {
    const keep = v.endsWith("\n");
    const text = keep ? v.slice(0, -1) : v;
    return [`${indent}${key}: ${keep ? "|" : "|-"}`, ...text.split("\n").map((l) => (l ? `${indent}  ${l}` : ""))];
  }
  if (Array.isArray(v)) {
    if (v.every((x) => !isPlainObject(x) && !Array.isArray(x))) return [`${indent}${key}: ${yamlValueInline(v)}`];
    const out = [`${indent}${key}:`];
    for (const item of v) {
      if (isPlainObject(item)) {
        if (isSmallMap(item)) out.push(`${indent}  - ${yamlValueInline(item)}`);
        else {
          const entries = Object.entries(item);
          entries.forEach(([k, x], i) => {
            const sub = yamlLines(k, x, indent + "    ");
            if (i === 0) sub[0] = `${indent}  - ${sub[0]!.slice(indent.length + 4)}`;
            out.push(...sub);
          });
        }
      } else out.push(`${indent}  - ${yamlValueInline(item)}`);
    }
    return out;
  }
  if (isPlainObject(v)) {
    if (isSmallMap(v)) return [`${indent}${key}: ${yamlValueInline(v)}`];
    const out = [`${indent}${key}:`];
    for (const [k, x] of Object.entries(v)) out.push(...yamlLines(k, x, indent + "  "));
    return out;
  }
  return [`${indent}${key}: ${yamlValueInline(v)}`];
}

export function fmToYaml(fm: FM): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined) continue;
    lines.push(...yamlLines(k, v, ""));
  }
  return `---\n${lines.join("\n")}\n---\n`;
}

/** ISO 8601 datetime with an explicit UTC offset (§5) — or a bare date,
 *  which the v0.1 tooling emitted and the spec's examples tolerate. */
export function isIsoDateTime(s: unknown): boolean {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/.test(s) &&
    !Number.isNaN(Date.parse(s))
  );
}

/** Actor convention (§7): `human:<id>`, `process:<id>`, or `<producer>/<version>`. */
export const ACTOR_RE = /^(human:\S+|process:\S+|[^\s:/]+\/\S+)$/;
export function isActor(s: unknown): boolean {
  return typeof s === "string" && ACTOR_RE.test(s);
}
/** The looser shape `sources[].author` may take: any actor, or a
 *  `<kind>:<id>` tag such as the spec's own `team:ga4-docs`. */
export const AUTHOR_RE = /^(human:\S+|process:\S+|[^\s:/]+\/\S+|[^\s:/]+:\S+)$/;

export type PathKind = "url" | "rooted" | "relative" | "descriptor";

/** Classify a path-valued field (§6.2). A scope descriptor ("all queries in
 *  project X") is prose: it contains whitespace, or has neither a slash nor a
 *  file extension. */
export function pathKind(s: string): PathKind {
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return "url";
  if (/\s/.test(s)) return "descriptor";
  if (s.startsWith("/")) return "rooted";
  if (s.includes("/") || /\.[A-Za-z0-9]{1,6}$/.test(s) || s.startsWith(".")) return "relative";
  return "descriptor";
}

/** Resolve a path-valued field to a bundle-relative path: `/`-rooted values
 *  are bundle-relative (§6.1), relative ones doc-relative. Null: escapes the
 *  bundle (or is a URL/descriptor). */
export function resolvePathField(root: string, docRel: string, value: string): string | null {
  const kind = pathKind(value);
  if (kind === "url" || kind === "descriptor") return null;
  if (kind === "rooted") {
    const clean = value.split("#")[0]!.slice(1); // fragments name a heading, not a file
    if (!clean) return null;
    const abs = resolve(root, clean);
    return abs.startsWith(root + "/") ? abs.slice(root.length + 1) : null;
  }
  return resolveLink(root, docRel, value);
}

/** resolvePathField, then — when the doc-relative reading names nothing on
 *  disk — the same value read from the bundle root, which is how the spec's
 *  own examples write `references/…` from inside `computations/` (Appendix
 *  A). Returns the bundle-relative path that exists, else the doc-relative
 *  candidate (or null if none). */
export function resolvePathFieldLenient(root: string, docRel: string, value: string): { rel: string | null; exists: boolean } {
  const rel = resolvePathField(root, docRel, value);
  if (rel !== null && existsSync(join(root, rel))) return { rel, exists: true };
  if (pathKind(value) === "relative" && !value.startsWith(".")) {
    const fromRoot = resolvePathField(root, "index.md", value);
    if (fromRoot !== null && existsSync(join(root, fromRoot))) return { rel: fromRoot, exists: true };
  }
  return { rel, exists: false };
}

// --- Body conventions: footnotes (§5.1) and the legacy Citations list (§13.1) --

/** Lines of a markdown body with fenced code blocks blanked (kept as empty
 *  strings so line indices survive). */
export function proseLines(body: string): string[] {
  let inFence = false;
  return body.split("\n").map((line) => {
    if (FENCE_RE.test(line)) { inFence = !inFence; return ""; }
    return inFence ? "" : line;
  });
}

/** Footnote labels referenced in prose (`…[^ga4-schema]`), in order, deduped. */
export function extractFootnoteRefs(body: string): string[] {
  const out: string[] = [];
  for (const line of proseLines(body)) {
    if (FOOTNOTE_DEF_RE.test(line)) continue; // a definition, not a use
    for (const m of line.matchAll(/\[\^([^\]\s]+)\]/g)) if (!out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/** Footnote definitions (`[^id]: text`) as label -> text. */
export function extractFootnoteDefs(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of proseLines(body)) {
    const m = FOOTNOTE_DEF_RE.exec(line);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

export interface CitationItem {
  /** Link target or bare URL; null for a non-link item (prose, revision hashes). */
  resource: string | null;
  /** Link text, or the whole item for non-links. */
  title: string;
  raw: string;
}

/** The v0.1 body `# Citations` (any heading level) list. Null: no such
 *  section. `range` is the [start, end) line span of the whole section
 *  (heading through the last item), for removal by migrate. */
export function extractCitationsSection(body: string): { items: CitationItem[]; range: [number, number] } | null {
  const lines = body.split("\n");
  const prose = proseLines(body);
  const start = prose.findIndex((l) => /^#{1,6}\s+Citations\s*$/i.test(l));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^#{1,6}\s/.test(prose[end]!)) end++;
  const items: CitationItem[] = [];
  for (let i = start + 1; i < end; i++) {
    const m = /^\s*[-*+]\s+(.*\S)\s*$/.exec(lines[i]!);
    if (!m) continue;
    const raw = m[1]!;
    const link = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*(.*)$/.exec(raw);
    if (link) items.push({ resource: link[2]!, title: link[1]! || link[2]!, raw });
    else {
      const bare = /^<?(https?:\/\/[^\s>]+)>?\s*(.*)$/.exec(raw);
      if (bare) items.push({ resource: bare[1]!, title: bare[2]?.replace(/^[-–—:]\s*/, "") || bare[1]!, raw });
      else items.push({ resource: null, title: raw, raw });
    }
  }
  // Trim trailing blank lines out of the range so removal leaves one separator.
  while (end > start + 1 && lines[end - 1]!.trim() === "") end--;
  return { items, range: [start, end] };
}

/** Stable footnote/source id from a title or URL: lowercase, dashed. */
export function sourceId(titleOrUrl: string): string {
  let s = titleOrUrl;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      const u = new URL(s);
      s = u.hostname.replace(/^www\./, "") + u.pathname;
    }
  } catch { /* not a URL */ }
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "source"
  );
}

/** Markdown link targets in body order (skips images and fenced code blocks). */
export function extractLinks(body: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    for (const m of line.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.push(m[1]);
  }
  return out;
}

export function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/.test(target) || target.startsWith("#");
}

/** Resolve a doc-relative link target to a bundle-relative path (or null if it escapes). */
export function resolveLink(root: string, docRel: string, target: string): string | null {
  const clean = target.split("#")[0];
  if (!clean) return null;
  const abs = resolve(root, dirname(docRel), clean);
  return abs.startsWith(root + "/") ? abs.slice(root.length + 1) : null;
}

/** The hand-written blurb of an index.md body: prose between the top and
 *  the first heading (the `# title` line itself excluded). index-gen
 *  preserves it across regenerations and parent listings show it as the
 *  directory's description, so it is the durable description source. */
export function indexBlurb(body: string): string {
  return body.replace(/^\s*# .*\n/, "").split(/^#{1,6} /m)[0]!.trim();
}

/** First ATX `# heading` text in a markdown body, skipping fenced code
 *  (null: none) — the display-title fallback for index docs, which rarely
 *  carry frontmatter. */
export function firstHeading(body: string): string | null {
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) return m[1]!;
  }
  return null;
}

export function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

// ANSI colors, gated on TTY and NO_COLOR so piped/captured output stays plain.
const tty = process.stdout.isTTY === true && !process.env.NO_COLOR;
const paint = (open: string) => (s: string) => (tty ? `\x1b[${open}m${s}\x1b[0m` : s);
export const c = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  cyan: paint("36"),
};
