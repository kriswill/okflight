// Immutable data model built once from the #data JSON blob baked in by
// ../viz.ts. Everything here is pure and framework-free.

import { displayName, normalizeVizConfig, type FacetConfig, type VizConfig } from "./config";

export interface ConceptNode {
  id: string;
  type: string;
  title: string;
  desc: string;
  fm: Record<string, unknown>;
  body: string;
  x: number;
  y: number;
  z: number;
}

export interface EmbeddedFile {
  html: string;
  lines: number;
  size: number;
  date: string;
  lang: string;
  refs: string[];
  /** Raw source, present for markdown files — rendered instead of `html`. */
  md?: string;
}

export interface EmbeddedDir {
  /** Immediate child files (repo-relative; a child may be unembedded if too big/binary). */
  files: string[];
  /** Immediate child directories (repo-relative, each with its own entry). */
  dirs: string[];
  date: string;
  refs: string[];
}

/** Build-time size breakdown of the emitted page, baked in by viz.ts for the
 *  About modal. Absent on embeds generated before this existed. */
export interface BuildStats {
  /** UTC ISO timestamp of the generating run. */
  generatedAt: string;
  /** Exact byte length of the finished HTML file (viz.ts solves the
   *  self-reference — this blob is inside the file it measures — by fixed
   *  point on the digit count). */
  totalBytes: number;
  /** Bytes each section occupies in the file, as written (post-escaping).
   *  The remainder up to totalBytes is page shell: template CSS/markup,
   *  repo/commit metadata, facet maps, embedded config, license notices,
   *  and this blob. */
  bytes: {
    nodes: number;
    edges: number;
    files: number;
    dirs: number;
    appJs: number;
    appCss: number;
  };
}

/** One bundled runtime dependency's license notice, read from its
 *  node_modules license file at generation time (../licenses.ts) — Bun.build
 *  minification strips the in-source copyright headers, and MIT/zlib terms
 *  require the notice to accompany every redistributed copy, so the page
 *  carries the verbatim texts itself. */
export interface DepLicense {
  name: string;
  version: string;
  /** SPDX id from the dep's package.json ("MIT", "Zlib"); "" if undeclared. */
  license: string;
  /** Verbatim license/notice text. */
  text: string;
}

/** okflight's own identity, embedded at generation time (../licenses.ts):
 *  the viewer app minified into this page IS okflight code, so its notice
 *  rides along with the bundled deps' under the same MIT rationale, and the
 *  About modal links back to the project. Absent on embeds generated before
 *  this existed. */
export interface GeneratorInfo {
  /** Display brand ("OKFlight"). */
  name: string;
  version: string;
  /** Project URL for the About modal link. */
  url: string;
  /** SPDX id from okflight's package.json; "" if undeclared. */
  license: string;
  /** "© 2026 Kris Williams", from the LICENSE file's copyright line (null:
   *  no LICENSE beside the generating checkout). */
  copyright: string | null;
  /** Verbatim LICENSE text (null: no LICENSE beside the generating checkout). */
  text: string | null;
}

/** One resolved link out of the bundle-root index.md: either a concept doc
 *  or a sub-bundle directory (its `<dir>/index.md` listing). */
export type RootLink = { kind: "concept"; id: string } | { kind: "dir"; path: string };

/** The bundle-root index.md, embedded for the cards view's synthetic root
 *  card. index.md is a reserved file — never a node — so its identity and
 *  out-links ride separately from the graph. */
export interface RootDoc {
  title: string;
  desc: string;
  /** Raw markdown body (after frontmatter), rendered in the details panel
   *  while this index is the cards focus (absent on pre-body embeds). */
  body?: string;
  links: RootLink[];
}

export interface RawData {
  nodes: ConceptNode[];
  edges: { s: string; t: string }[];
  files?: Record<string, EmbeddedFile>;
  dirs?: Record<string, EmbeddedDir>;
  /** https web URL of the repo, for the header name (null: no remote). */
  repoUrl?: string | null;
  /** Revision-link template with {url} pre-substituted — only {hash} remains
   *  (null: no repo URL, citations stay plain code). */
  commitUrl?: string | null;
  /** Verified revision citations: literal as written -> full canonical id. */
  commits?: Record<string, string>;
  /** Facet name -> (name -> value), for facets with a classify source
   *  (built by that facet's classifier at generation time). */
  facetMaps?: Record<string, Record<string, string>>;
  /** Normalized VizConfig embedded by the build (absent: generic viewer). */
  cfg?: unknown;
  /** Build-time size breakdown (absent: pre-stats embed). */
  stats?: BuildStats;
  /** Bundled deps' license notices (absent: pre-licenses embed). */
  licenses?: DepLicense[];
  /** The generating okflight's identity (absent: pre-generator embed). */
  generator?: GeneratorInfo;
  /** Bundle-root index.md for the cards view's root card (absent/null: none). */
  root?: RootDoc | null;
  /** Sub-bundle index.md docs by dir path — dir cards render from (and focus
   *  into) these (absent: pre-bundles embed, dir cards stay inert). */
  bundles?: Record<string, RootDoc>;
}

export interface VizModel {
  nodes: ConceptNode[];
  files: Record<string, EmbeddedFile>;
  dirs: Record<string, EmbeddedDir>;
  repoUrl: string | null;
  /** Revision-link template ({hash} placeholder), see RawData.commitUrl. */
  commitUrl: string | null;
  /** "owner/repo"-style display name from repoUrl (null: none derivable). */
  repoName: string | null;
  /** Normalized viz configuration (generic defaults when unconfigured). */
  cfg: VizConfig;
  /** Header name: cfg.display.name ?? repoName ?? cfg.display.fallbackName. */
  displayName: string;
  commits: Record<string, string>;
  byId: Record<string, ConceptNode>;
  indexOf: Map<string, number>;
  edges: { s: string; t: string }[];
  edgeIdx: [number, number][];
  deg: Record<string, number>;
  inLinks: Record<string, string[]>;
  /** Undirected adjacency by id, for neighborhood isolation. */
  adjById: Record<string, Set<string>>;
  typeCounts: Record<string, number>;
  allTypes: string[];
  /** Legend cluster per type, derived from each type's concepts' top-level bundle directory. */
  typeGroup: Record<string, string>;
  /** Types per legend cluster, in allTypes order. */
  groupTypes: Record<string, string[]>;
  /** cfg.taxonomy.groupOrder filtered to present clusters, the "other" bucket
   *  appended only if non-empty; [] = flat legend without group headers. */
  groupOrder: string[];
  /** Resolved facet definitions: file/array order preserved, `values`
   *  inferred (alpha-sorted) when the config left them empty; a facet with
   *  no rule ever resolving anything (still empty after inference) is
   *  dropped entirely — no sidebar row, never consulted for visibility. */
  facets: { name: string; values: string[] }[];
  /** facet name -> node id -> resolved value; a missing entry means
   *  "unresolved" for that facet — always visible, never hidden by it. */
  facetById: Record<string, Record<string, string>>;
  /** Scene sphere radius per node (same order as nodes). */
  radii: number[];
  /** Build-time size breakdown (null: pre-stats embed — About modal hides it). */
  stats: BuildStats | null;
  /** Bundled deps' license notices for the About modal ([] on pre-licenses embeds). */
  licenses: DepLicense[];
  /** The generating okflight's identity (null: pre-generator embed — the
   *  About modal hides the Built-with line and own-license entry). */
  generator: GeneratorInfo | null;
  /** Root card source (null: no root index.md embedded — cards view shows an
   *  empty state instead of the root layout). Concept links are pre-validated
   *  against byId. */
  root: RootDoc | null;
  /** Sub-bundle index docs by dir path, concept links pre-validated like the
   *  root's ({} when the embed predates bundles). */
  bundles: Record<string, RootDoc>;
}

// A concept's id is its bundle-relative path minus ".md" (viz.ts) — the
// top-level path segment is already a stable, zero-maintenance topology
// signal. Root docs (no '/') group as ".".
export function dirOf(id: string): string {
  return id.includes("/") ? id.split("/")[0]! : ".";
}

const basename = (id: string) => id.split("/").pop() ?? id;

/**
 * Package-name -> facet value for the OS-guarded packages in a facet's
 * configured nix-packages file. Each `lib.optionalAttrs (<pred>) { <attrs> }`
 * block is classified by the first `guards` key found in its predicate text
 * (e.g. {darwin: "macos", linux: "linux"}); everything outside a matched
 * block is universal (absent from the map -> falls through to the facet's
 * next resolution stage). Brace-depth scan, not a lazy regex: an attr RHS
 * like `inputs.x.packages.${system}.x` contains a `}` that would truncate a
 * non-greedy capture and silently drop later attrs. Any structural change to
 * the file degrades the affected packages to a fall-through — never throws.
 */
export function parsePackagePlatforms(nixSource: string, guards: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /optionalAttrs\s*\(([^{]*)\{/g; // predicate text up to the block-opening brace
  for (let m = re.exec(nixSource); m; m = re.exec(nixSource)) {
    const pred = m[1]!;
    const os = Object.entries(guards).find(([k]) => pred.includes(k))?.[1] ?? null;
    if (!os) continue;
    // Scan from just after the '{' to its matching close (depth 0).
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < nixSource.length && depth > 0; i++) {
      const c = nixSource[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    if (depth !== 0) continue; // unbalanced (EOF) — bail, don't misclassify
    // Keep only the block's depth-0 text: dropping every nested `{...}` (callPackage
    // args, `${system}` interps) means a nested `arg =` on its own line can never be
    // mistaken for a top-level package attr.
    let d = 0;
    let top = "";
    for (const c of nixSource.slice(m.index + m[0].length, i - 1)) {
      if (c === "{") d++;
      else if (c === "}") d--;
      else if (d === 0) top += c;
    }
    for (const a of top.matchAll(/(?:^|\n)[ \t]*([A-Za-z][\w-]*)[ \t]*=/g)) out[a[1]!] = os;
    re.lastIndex = i; // resume after this block
  }
  return out;
}

/**
 * Resolve one concept's value for one facet — first hit wins:
 * `ids[full-id]` -> the facet's classify map (only when the concept's type
 * is in `classify.types`, keyed per `classify.key`; a miss falls through,
 * it does not resolve to unresolved) -> a string frontmatter value (an
 * explicit `values` list makes an out-of-range value unresolved, no further
 * fall-through — the author explicitly tagged it) -> `types[type]` ->
 * undefined ("unresolved" — always visible for this facet).
 */
export function facetValueOf(node: ConceptNode, facet: FacetConfig, classifyMap: Record<string, string>): string | undefined {
  const id = facet.ids[node.id];
  if (id !== undefined) return id;
  if (facet.classify && facet.classify.types.includes(node.type)) {
    const v = classifyMap[facet.classify.key === "id" ? node.id : basename(node.id)];
    if (v !== undefined) return v;
  }
  if (facet.frontmatter) {
    const fmv = node.fm[facet.frontmatter];
    if (typeof fmv === "string") return !facet.values.length || facet.values.includes(fmv) ? fmv : undefined;
  }
  return facet.types[node.type];
}

/** "owner/repo"-style display name from any forge URL — the full repo path
 *  (so GitLab subgroups keep their group chain), https or ssh form, with or
 *  without ".git", explicit ports dropped (a manual vcs.url override never
 *  passes through vcs/git.ts's normalizeRemoteUrl, so the port must be
 *  handled here too). Underivable shapes yield null; set display.name for
 *  those. */
export function repoNameFromUrl(url: string | null): string | null {
  return url?.match(/^(?:https?:\/\/|ssh:\/\/(?:[^@/]+@)?|[^@/:]+@)([^/:]+)(?::\d+)?[/:](.+?)(?:\.git)?\/?$/)?.[2] ?? null;
}

export function buildModel(raw: RawData): VizModel {
  const cfg = normalizeVizConfig(raw.cfg);
  const nodes = raw.nodes;
  const files = raw.files || {};
  const dirs = raw.dirs || {};
  const repoUrl = raw.repoUrl || null;
  const commitUrl = raw.commitUrl || null;
  const repoName = repoNameFromUrl(repoUrl);
  const commits = raw.commits || {};
  const byId: Record<string, ConceptNode> = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = raw.edges.filter((e) => byId[e.s] && byId[e.t]);
  const edgeIdx: [number, number][] = edges.map((e) => [indexOf.get(e.s)!, indexOf.get(e.t)!]);

  const deg: Record<string, number> = {};
  const inLinks: Record<string, string[]> = {};
  const adjById: Record<string, Set<string>> = {};
  for (const n of nodes) adjById[n.id] = new Set();
  for (const e of edges) {
    deg[e.s] = (deg[e.s] || 0) + 1;
    deg[e.t] = (deg[e.t] || 0) + 1;
    (inLinks[e.t] = inLinks[e.t] || []).push(e.s);
    adjById[e.s]!.add(e.t);
    adjById[e.t]!.add(e.s);
  }

  const typeCounts: Record<string, number> = {};
  for (const n of nodes) typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
  const typeOrder = cfg.taxonomy.types;
  const allTypes = [
    ...typeOrder.filter((t) => typeCounts[t]),
    ...Object.keys(typeCounts)
      .filter((t) => !typeOrder.includes(t))
      .sort(),
  ];

  // The profile keeps every type inside one top-level directory, so this is
  // normally unambiguous; if that's ever violated, the first concept of a
  // type fixes its group (deterministic, not "last write wins"). No
  // dir-groups configured -> no clusters at all (flat legend), not one big
  // "Other" bucket.
  const typeGroup: Record<string, string> = {};
  const groupTypes: Record<string, string[]> = {};
  let groupOrder: string[] = [];
  if (Object.keys(cfg.taxonomy.dirGroups).length) {
    for (const n of nodes) typeGroup[n.type] ??= cfg.taxonomy.dirGroups[dirOf(n.id)] ?? cfg.taxonomy.other;
    for (const t of allTypes) (groupTypes[typeGroup[t]!] ??= []).push(t);
    // The other-bucket appends last unless group-order already places it
    // (listing it there pins the overflow cluster's position).
    groupOrder = [
      ...cfg.taxonomy.groupOrder.filter((g) => groupTypes[g]),
      ...(groupTypes[cfg.taxonomy.other] && !cfg.taxonomy.groupOrder.includes(cfg.taxonomy.other)
        ? [cfg.taxonomy.other]
        : []),
    ];
  }

  const facetMaps = raw.facetMaps ?? {};
  const facets: { name: string; values: string[] }[] = [];
  const facetById: Record<string, Record<string, string>> = {};
  for (const f of cfg.facets) {
    const classifyMap = f.classify ? (facetMaps[f.name] ?? {}) : {};
    const resolved: Record<string, string> = {};
    for (const n of nodes) {
      const v = facetValueOf(n, f, classifyMap);
      if (v !== undefined) resolved[n.id] = v;
    }
    const values = f.values.length ? f.values : [...new Set(Object.values(resolved))].sort();
    if (!values.length) continue; // never resolved anything and no explicit values: no-op, drop the lens
    facets.push({ name: f.name, values });
    facetById[f.name] = resolved;
  }

  const radii = nodes.map((n) => (3.5 + Math.min(6.5, (deg[n.id] || 0) * 0.8)) * 0.2058);

  return {
    nodes,
    files,
    dirs,
    repoUrl,
    commitUrl,
    repoName,
    cfg,
    displayName: displayName(cfg, repoName),
    commits,
    byId,
    indexOf,
    edges,
    edgeIdx,
    deg,
    inLinks,
    adjById,
    typeCounts,
    allTypes,
    typeGroup,
    groupTypes,
    groupOrder,
    facets,
    facetById,
    radii,
    stats: raw.stats ?? null,
    licenses: raw.licenses ?? [],
    generator: raw.generator ?? null,
    root: raw.root
      ? { ...raw.root, links: raw.root.links.filter((l) => l.kind !== "concept" || byId[l.id]) }
      : null,
    // Null prototype: paths are user-controlled keys, and a dir literally
    // named "constructor" must work while inherited keys must never resolve.
    bundles: Object.assign(
      Object.create(null) as Record<string, RootDoc>,
      Object.fromEntries(
        Object.entries(raw.bundles ?? {}).map(([path, doc]) => [
          path,
          { ...doc, links: doc.links.filter((l) => l.kind !== "concept" || byId[l.id]) },
        ]),
      ),
    ),
  };
}

/** Map one resolved bundle-relative link target from the root index.md to a
 *  RootLink: a known concept wins outright; otherwise a sub-bundle's
 *  `<dir>/index.md` names that dir; anything else (unknown doc, the root
 *  index itself) drops. Pure — the generator resolves paths first. */
export function classifyRootLink(resolved: string, ids: Set<string>): RootLink | null {
  const id = resolved.replace(/\.md$/, "");
  if (ids.has(id)) return { kind: "concept", id };
  if (resolved.endsWith("/index.md")) return { kind: "dir", path: resolved.slice(0, -"/index.md".length) };
  return null;
}

/** BFS neighbor set within `depth` hops of `id`, including `id` itself so the
 *  origin never vanishes from its own filtered view. An id absent from the
 *  model returns an empty set; a real but edge-less node returns itself. */
export function neighborsWithin(model: VizModel, id: string, depth: 1 | 2): Set<string> {
  const seen = new Set<string>();
  if (!model.adjById[id]) return seen;
  seen.add(id);
  let frontier = [id];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const nb of model.adjById[cur] ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

export interface ConceptTree {
  node: ConceptNode;
  children: ConceptTree[];
}

/** BFS tree of `anchorId`'s neighborhood for the pinned sidebar listing.
 *  Each node attaches to exactly one parent — its alphabetically-first
 *  (title, then id) neighbor in the previous BFS layer — and siblings sort
 *  alphabetically, so every reachable node renders exactly once. Invisible
 *  nodes are spliced out with their visible descendants promoted to the
 *  nearest visible ancestor. The anchor is always included, even when it
 *  fails `visible` (it is the selection context). Unknown anchor -> null. */
export function conceptTree(
  model: VizModel,
  anchorId: string,
  depth: 1 | 2,
  visible: (n: ConceptNode) => boolean,
): ConceptTree | null {
  const anchor = model.byId[anchorId];
  if (!anchor) return null;
  const byTitle = (a: ConceptNode, b: ConceptNode) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

  const layer = new Map<string, number>([[anchorId, 0]]);
  const kids = new Map<string, ConceptNode[]>();
  let frontier = [anchorId];
  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const nb of model.adjById[cur] ?? []) {
        if (!layer.has(nb)) {
          layer.set(nb, d);
          next.push(nb);
        }
      }
    }
    for (const id of next) {
      const parent = [...(model.adjById[id] ?? [])]
        .filter((p) => layer.get(p) === d - 1)
        .map((p) => model.byId[p]!)
        .sort(byTitle)[0]!;
      const list = kids.get(parent.id);
      if (list) list.push(model.byId[id]!);
      else kids.set(parent.id, [model.byId[id]!]);
    }
    frontier = next;
  }

  // An invisible child is spliced out and its visible descendants promoted
  // into this sibling list; the final sort keeps siblings alphabetical even
  // after promotion merges two generations.
  const build = (id: string): ConceptTree[] => {
    const out: ConceptTree[] = [];
    for (const c of kids.get(id) ?? []) {
      if (visible(c)) out.push({ node: c, children: build(c.id) });
      else out.push(...build(c.id));
    }
    return out.sort((a, b) => byTitle(a.node, b.node));
  };
  return { node: anchor, children: build(anchorId) };
}

/** Ids rendered by a conceptTree: the anchor plus every emitted row. */
export function treeIds(t: ConceptTree): Set<string> {
  const ids = new Set<string>();
  const walk = (n: ConceptTree) => {
    ids.add(n.node.id);
    n.children.forEach(walk);
  };
  walk(t);
  return ids;
}

export function loadFromDom(): VizModel {
  return buildModel(JSON.parse(document.getElementById("data")!.textContent!));
}
