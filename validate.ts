// Validate the bundle against OKF v0.2 conformance (SPEC.md §11) plus the
// workspace's profile policy (okflight.toml [profile]; defaults in config-cli.ts).
//
//   errors   — frontmatter must parse; `type` (and the profile's required
//              fields) must be non-empty; reserved filenames carry no concept
//              frontmatter (root index.md may declare okf_version); body links
//              must be file-relative unless the profile allows /-rooted; and a
//              PRESENT trust/lifecycle/provenance/computation family must be
//              well-formed (§5, §7, §10) — a footnote must key into sources,
//              an Attested Computation needs a runtime and exactly one
//              computation.
//   warnings — missing recommended fields, v0.1 leftovers (`timestamp`, a body
//              `# Citations` list — run `okf migrate`), stale content, unused
//              sources, dangling links and path-valued fields (spec says
//              tolerate; we still want to know), unknown okf_version.
//
// Absence of any optional family is never an error (§11). Exit 1 on errors;
// --strict promotes warnings to errors.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadContext } from "./config-cli";
import {
  asVerifiedList,
  AUTHOR_RE,
  c,
  extractCitationsSection,
  extractFootnoteDefs,
  extractFootnoteRefs,
  extractLinks,
  isActor,
  isExternal,
  isIsoDateTime,
  isPlainObject,
  isStale,
  list,
  obj,
  OKF_VERSION,
  parseDoc,
  pathKind,
  resolveLink,
  resolvePathField,
  resolvePathFieldLenient,
  STATUSES,
  str,
  SUPPORTED_OKF_VERSIONS,
  walkMd,
  type FM,
} from "./lib";

const STRICT = process.argv.includes("--strict");
const { root: repo, bundle, cfg } = loadContext();
const { requiredFields, rootedLinks, repoLinks } = cfg.profile;
const reserved = new Set(cfg.profile.reservedFiles);
// A field listed in both never double-reports — required wins.
const recommendedFields = cfg.profile.recommendedFields.filter((f) => !requiredFields.includes(f));

const errors: string[] = [];
const warnings: string[] = [];
const now = new Date();

if (!existsSync(bundle)) {
  console.error(`no bundle at ${bundle}`);
  process.exit(1);
}

/** The v0.2 keys whose presence marks a doc as post-v0.1 (for the version nudge). */
const V02_KEYS = ["generated", "verified", "sources", "usage_window", "status", "stale_after", "runtime", "computation", "executor", "attester"];
let sawV02Fields = false;
let declaredVersion: string | null = null;

// "Empty" must cover every frontmatter value shape: "", [] and {} (arrays
// and objects are truthy, so a bare falsy check silently passes them).
const empty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) || (isPlainObject(v) && !Object.keys(v).length);

/** Resolve a path-valued frontmatter field (§6.2) the way body links are
 *  checked: inside the bundle it must exist (warn), escaping into the repo
 *  follows the repoLinks policy. */
function checkPathField(rel: string, field: string, value: unknown) {
  if (typeof value !== "string" || !value) return;
  const kind = pathKind(value);
  if (kind === "url" || kind === "descriptor") return;
  const inBundle = resolvePathFieldLenient(bundle, rel, value);
  if (inBundle.exists) return;
  if (kind === "rooted") {
    warnings.push(
      inBundle.rel === null
        ? `${rel}: ${field} '${value}' escapes the bundle (/-rooted paths are bundle-relative, §6.1)`
        : `${rel}: ${field} '${value}' does not resolve in the bundle`,
    );
    return;
  }
  // Relative and not in the bundle: it names something in the repository —
  // doc-relative (`../../src/x.py`), or workspace-relative as `okf scaffold`
  // writes `resource` (`src/x.py`); viz reads both the same way.
  if (repoLinks === "forbid") {
    errors.push(`${rel}: ${field} '${value}' leaves the bundle — profile forbids repo links`);
    return;
  }
  if (repoLinks !== "check") return;
  const docRel = resolveLink(repo, join(cfg.viz.bundle.dir, rel), value);
  const rootRel = value.split("#")[0]!.split("/").includes("..") ? null : value.split("#")[0]!;
  if (docRel === null && rootRel === null) errors.push(`${rel}: ${field} '${value}' escapes the repository`);
  else if (!(docRel && existsSync(join(repo, docRel))) && !(rootRel && existsSync(join(repo, rootRel))))
    warnings.push(`${rel}: ${field} '${value}' does not resolve in the bundle or the repository`);
}

const checkActorAt = (rel: string, field: string, e: Record<string, unknown>, byRequired: boolean) => {
  if (byRequired && empty(e.by)) errors.push(`${rel}: ${field}.by is required (an actor, §7)`);
  else if (e.by !== undefined && !isActor(e.by))
    errors.push(`${rel}: ${field}.by '${String(e.by)}' is not an actor (human:<id> | process:<id> | <producer>/<version>)`);
  if (e.at !== undefined && !isIsoDateTime(e.at))
    errors.push(`${rel}: ${field}.at '${String(e.at)}' is not an ISO 8601 datetime with a UTC offset`);
};

const checkWindow = (rel: string, field: string, w: unknown): boolean => {
  if (!isPlainObject(w)) {
    errors.push(`${rel}: ${field} must be a { from, to } mapping`);
    return false;
  }
  let ok = true;
  for (const k of ["from", "to"])
    if (!isIsoDateTime(w[k])) {
      errors.push(`${rel}: ${field}.${k} '${String(w[k])}' is not an ISO 8601 datetime`);
      ok = false;
    }
  if (ok && Date.parse(w.from as string) > Date.parse(w.to as string)) {
    errors.push(`${rel}: ${field}: from is after to`);
    ok = false;
  }
  return ok;
};

/** §5 provenance/trust/lifecycle families — only when present. */
function checkFamilies(rel: string, fm: FM, body: string) {
  // §5.2 generated / verified
  const gen = fm.generated;
  if (gen !== undefined) {
    if (!isPlainObject(gen)) errors.push(`${rel}: generated must be a { by, at } mapping`);
    else checkActorAt(rel, "generated", gen, true);
  }
  const ver = fm.verified;
  if (ver !== undefined) {
    const entries = asVerifiedList(ver);
    if (!entries.length || (Array.isArray(ver) && entries.length !== ver.length))
      errors.push(`${rel}: verified must be a { by, at } mapping or a list of them`);
    entries.forEach((e, i) => checkActorAt(rel, `verified[${i}]`, e, true));
  }
  // §5.4 / §5.5 lifecycle
  if (fm.status !== undefined && !(STATUSES as readonly unknown[]).includes(fm.status))
    errors.push(`${rel}: status '${String(fm.status)}' must be one of ${STATUSES.join(" | ")}`);
  if (fm.stale_after !== undefined) {
    if (!isIsoDateTime(fm.stale_after)) errors.push(`${rel}: stale_after '${String(fm.stale_after)}' is not an ISO 8601 datetime`);
    else if (isStale(fm, now)) warnings.push(`${rel}: stale since ${String(fm.stale_after)} (stale_after)`);
  }
  // §5.1 sources + usage_window
  const sharedWindow = fm.usage_window;
  if (sharedWindow !== undefined) checkWindow(rel, "usage_window", sharedWindow);
  const ids = new Set<string>();
  const src = fm.sources;
  if (src !== undefined) {
    if (!Array.isArray(src)) errors.push(`${rel}: sources must be a list`);
    else
      src.forEach((s, i) => {
        const f = `sources[${i}]`;
        if (!isPlainObject(s)) {
          errors.push(`${rel}: ${f} must be a mapping with a resource`);
          return;
        }
        if (empty(s.resource) || typeof s.resource !== "string") errors.push(`${rel}: ${f}.resource is required`);
        else checkPathField(rel, `${f}.resource`, s.resource);
        if (s.id !== undefined) {
          if (typeof s.id !== "string" || !s.id) errors.push(`${rel}: ${f}.id must be a non-empty string`);
          else if (ids.has(s.id)) errors.push(`${rel}: duplicate sources id '${s.id}'`);
          else ids.add(s.id);
        }
        if (s.author !== undefined && !(typeof s.author === "string" && AUTHOR_RE.test(s.author)))
          warnings.push(`${rel}: ${f}.author '${String(s.author)}' is not actor-shaped (§7: human:<id>, process:<id>, team:<id>, <producer>/<version>)`);
        if (s.usage_count !== undefined) {
          if (typeof s.usage_count !== "number" || s.usage_count < 0) errors.push(`${rel}: ${f}.usage_count must be a non-negative number`);
          else if (s.usage_window === undefined && sharedWindow === undefined)
            warnings.push(`${rel}: ${f}.usage_count has no usage_window framing it (§5.1)`);
        }
        if (s.usage_window !== undefined) checkWindow(rel, `${f}.usage_window`, s.usage_window);
        if (s.last_modified !== undefined && !isIsoDateTime(s.last_modified))
          errors.push(`${rel}: ${f}.last_modified '${String(s.last_modified)}' is not an ISO 8601 datetime`);
      });
  }
  // Per-claim attribution: footnote labels are the join key into sources.
  const refs = extractFootnoteRefs(body);
  const defs = extractFootnoteDefs(body);
  for (const label of refs) {
    if (Array.isArray(src) && !ids.has(label))
      errors.push(`${rel}: footnote [^${label}] has no matching sources[].id`);
    else if (!Array.isArray(src)) warnings.push(`${rel}: footnote [^${label}] but no sources frontmatter to key into`);
    if (!(label in defs)) warnings.push(`${rel}: footnote [^${label}] has no definition line`);
  }
  // v0.1 leftovers (§13.1)
  if (fm.timestamp !== undefined) {
    if (gen === undefined) warnings.push(`${rel}: 'timestamp' is superseded by generated.at in OKF v0.2 — run okf migrate`);
    if (typeof fm.timestamp === "string" && fm.timestamp && Number.isNaN(Date.parse(fm.timestamp)))
      warnings.push(`${rel}: timestamp '${fm.timestamp}' is not ISO-8601 parseable`);
  }
  // A Citations section is a migration target only while it still holds
  // linked items — migrate moves those into sources; prose/revision items
  // (`Commits \`abc\``) legitimately stay, so they never nag.
  const cites = extractCitationsSection(body);
  if (cites?.items.some((i) => i.resource))
    warnings.push(`${rel}: body Citations list is superseded by 'sources' frontmatter in OKF v0.2 — run okf migrate`);
}

/** §10 Attested Computation contract. */
function checkComputation(rel: string, fm: FM, body: string) {
  if (fm.type !== "Attested Computation") {
    for (const k of ["runtime", "parameters", "computation", "executor", "attester"])
      if (fm[k] !== undefined) warnings.push(`${rel}: '${k}' is an Attested Computation field (§10) on a '${String(fm.type)}' concept`);
    return;
  }
  if (empty(fm.runtime) || typeof fm.runtime !== "string") errors.push(`${rel}: Attested Computation requires 'runtime' (§10.2)`);
  const params = fm.parameters;
  if (params !== undefined) {
    if (!Array.isArray(params)) errors.push(`${rel}: parameters must be a list of { name, type, required }`);
    else
      params.forEach((p, i) => {
        if (!isPlainObject(p) || typeof p.name !== "string" || !p.name)
          errors.push(`${rel}: parameters[${i}] needs a name (and type, required)`);
        else {
          if (p.type !== undefined && typeof p.type !== "string") errors.push(`${rel}: parameters[${i}].type must be a string`);
          if (p.required !== undefined && typeof p.required !== "boolean") errors.push(`${rel}: parameters[${i}].required must be a boolean`);
        }
      });
  }
  // §10.3: the computation is inline (a fence under # Computation) XOR a file.
  const fence = hasComputationFence(body);
  const file = str(fm, "computation");
  if (fm.computation !== undefined && typeof fm.computation !== "string") errors.push(`${rel}: computation must be a path`);
  else if (file) checkPathField(rel, "computation", file);
  if (!file && !fence) errors.push(`${rel}: Attested Computation needs a 'computation' path or a code block under a Computation heading (§10.3)`);
  else if (file && fence) warnings.push(`${rel}: both 'computation' and an inline Computation fence — the file wins (§10.3)`);
  for (const k of ["executor", "attester"] as const) {
    const v = fm[k];
    if (v === undefined) continue;
    if (!isPlainObject(v)) {
      errors.push(`${rel}: ${k} must be a mapping with a resource`);
      continue;
    }
    if (typeof v.resource !== "string" || !v.resource) errors.push(`${rel}: ${k}.resource is required`);
    else checkPathField(rel, `${k}.resource`, v.resource);
    if (k === "executor" && v.receipt !== undefined) {
      const r = v.receipt;
      if (!Array.isArray(r) || !r.length || !r.every((x) => typeof x === "string" && x))
        errors.push(`${rel}: executor.receipt must be a non-empty list of field names`);
    }
  }
}

/** A fenced or indented code block directly under a `Computation` heading. */
function hasComputationFence(body: string): boolean {
  const lines = body.split("\n");
  const at = lines.findIndex((l) => /^#{1,6}\s+Computation\s*$/i.test(l));
  if (at === -1) return false;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^#{1,6}\s/.test(l)) return false;
    if (/^\s*(```|~~~)/.test(l) || /^(\t| {4})\S/.test(l)) return true;
  }
  return false;
}

const files = walkMd(bundle);
for (const rel of files) {
  const doc = parseDoc(bundle, rel);
  const base = rel.split("/").pop()!;
  const isRootIndex = rel === "index.md";

  if (reserved.has(base)) {
    // index.md may carry frontmatter only at the bundle root (okf_version, §12)
    if (doc.fmError) errors.push(`${rel}: frontmatter error — ${doc.fmError}`);
    else if (doc.fm && !isRootIndex) errors.push(`${rel}: reserved file must not have frontmatter`);
    else if (isRootIndex && doc.fm) {
      const v = doc.fm.okf_version;
      if (v === undefined) warnings.push(`${rel}: root index frontmatter should declare okf_version`);
      else {
        declaredVersion = String(v);
        if (!SUPPORTED_OKF_VERSIONS.includes(declaredVersion))
          warnings.push(`${rel}: okf_version '${declaredVersion}' is not one this tooling knows (${SUPPORTED_OKF_VERSIONS.join(", ")}) — consuming best-effort (§12)`);
      }
    }
  } else {
    if (doc.fmError) errors.push(`${rel}: frontmatter error — ${doc.fmError}`);
    else if (!doc.fm) errors.push(`${rel}: missing frontmatter (every concept needs at least 'type')`);
    else {
      for (const f of requiredFields) if (empty(doc.fm[f])) errors.push(`${rel}: empty or missing '${f}'`);
      for (const f of recommendedFields) if (empty(doc.fm[f])) warnings.push(`${rel}: missing recommended field '${f}'`);
      if (doc.fm.type !== undefined && typeof doc.fm.type !== "string") errors.push(`${rel}: 'type' must be a string`);
      for (const f of ["title", "description"]) if (doc.fm[f] !== undefined && typeof doc.fm[f] !== "string") errors.push(`${rel}: '${f}' must be a string`);
      const tags = list(doc.fm, "tags");
      if (doc.fm.tags !== undefined && (!tags || !tags.every((t) => typeof t === "string")))
        errors.push(`${rel}: 'tags' must be a list of strings`);
      if (doc.fm.resource !== undefined && typeof doc.fm.resource !== "string") errors.push(`${rel}: 'resource' must be a URI or path`);
      else checkPathField(rel, "resource", doc.fm.resource);
      if (V02_KEYS.some((k) => doc.fm![k] !== undefined)) sawV02Fields = true;
      checkFamilies(rel, doc.fm, doc.body);
      checkComputation(rel, doc.fm, doc.body);
    }
  }

  for (const target of extractLinks(doc.body)) {
    if (isExternal(target)) continue;
    if (target.startsWith("/")) {
      if (rootedLinks === "error")
        errors.push(`${rel}: /-rooted link '${target}' — profile requires file-relative links`);
      else {
        const rooted = resolvePathField(bundle, rel, target);
        if (rooted === null || !existsSync(join(bundle, rooted))) warnings.push(`${rel}: dangling bundle link '${target}'`);
      }
      continue;
    }
    const inBundle = resolveLink(bundle, rel, target);
    if (inBundle !== null) {
      if (!existsSync(join(bundle, inBundle))) warnings.push(`${rel}: dangling bundle link '${target}'`);
    } else if (repoLinks === "forbid") {
      errors.push(`${rel}: link '${target}' leaves the bundle — profile forbids repo links`);
    } else if (repoLinks === "check") {
      // Escapes the bundle — allowed (points into the repo), but verify it resolves.
      const inRepo = resolveLink(repo, join(cfg.viz.bundle.dir, rel), target);
      if (inRepo === null) errors.push(`${rel}: link '${target}' escapes the repository`);
      else if (!existsSync(join(repo, inRepo))) warnings.push(`${rel}: dangling repo link '${target}'`);
    }
  }
}

if (sawV02Fields && declaredVersion !== null && declaredVersion !== OKF_VERSION && SUPPORTED_OKF_VERSIONS.includes(declaredVersion))
  warnings.push(`index.md: bundle declares okf_version '${declaredVersion}' but concepts use v${OKF_VERSION} fields — run okf migrate to bump it`);

for (const w of warnings) console.log(`${c.yellow("warn:")}  ${w}`);
for (const e of errors) console.log(`${c.red("ERROR:")} ${e}`);
const summary = `${files.length} files checked — ${errors.length} error(s), ${warnings.length} warning(s)`;
console.log("\n" + (errors.length ? c.red(summary) : warnings.length ? c.yellow(summary) : c.green(summary)));
process.exit(errors.length || (STRICT && warnings.length) ? 1 : 0);
