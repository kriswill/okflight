// OKF v0.2 frontmatter readers (SPEC §5, §7, §13) — the trust, lifecycle and
// provenance derivations every consumer needs, in a browser-safe module (no
// node imports) shared by the CLI (lib.ts re-exports it) and the viewer app,
// so the detail panel and validate derive tiers/status/staleness identically.

/** Parsed frontmatter: any YAML mapping. v0.2 families nest (generated,
 *  verified, sources, executor…), so values are unknown — use str()/obj()/
 *  list() to read them shape-safely. */
export type FM = Record<string, unknown>;

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** Shape-safe frontmatter readers: the value if it has the expected shape, else undefined. */
export const str = (fm: FM | null | undefined, key: string): string | undefined => {
  const v = fm?.[key];
  return typeof v === "string" ? v : undefined;
};
export const obj = (fm: FM | null | undefined, key: string): Record<string, unknown> | undefined => {
  const v = fm?.[key];
  return isPlainObject(v) ? v : undefined;
};
export const list = (fm: FM | null | undefined, key: string): unknown[] | undefined => {
  const v = fm?.[key];
  return Array.isArray(v) ? v : undefined;
};


// --- OKF v0.2 trust / lifecycle / provenance readers (SPEC §5, §7, §13) -------

export type TrustTier = "unverified" | "machine-confirmed" | "human-reviewed";
export const TRUST_TIERS: readonly TrustTier[] = ["unverified", "machine-confirmed", "human-reviewed"];
export type Status = "draft" | "stable" | "deprecated";
export const STATUSES: readonly Status[] = ["draft", "stable", "deprecated"];

/** `verified` as a list: a bare {by, at} mapping is a one-element list (§5.2
 *  MUST); anything else non-list is empty. Entries are returned as written —
 *  validate checks their shape. */
export function asVerifiedList(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter(isPlainObject);
  if (isPlainObject(v)) return [v];
  return [];
}

/** Trust tier derived from `verified` (§5.3): human-reviewed when any
 *  verifier is a `human:` actor, machine-confirmed when there are verifiers
 *  but none human, else unverified. */
export function trustTier(fm: FM | null | undefined): TrustTier {
  const entries = asVerifiedList(fm?.verified);
  if (!entries.length) return "unverified";
  return entries.some((e) => typeof e.by === "string" && e.by.startsWith("human:"))
    ? "human-reviewed"
    : "machine-confirmed";
}

/** Lifecycle status (§5.4); absent or unrecognized ⇒ stable. */
export function statusOf(fm: FM | null | undefined): Status {
  const s = str(fm, "status");
  return s && (STATUSES as readonly string[]).includes(s) ? (s as Status) : "stable";
}

/** `now >= stale_after` (§5.5); unset or unparseable ⇒ never stale. */
export function isStale(fm: FM | null | undefined, now: Date = new Date()): boolean {
  const s = str(fm, "stale_after");
  if (!s) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t) && now.getTime() >= t;
}

/** When the content last changed: `generated.at`, falling back to the v0.1
 *  `timestamp` (§13.1). */
export function generatedAt(fm: FM | null | undefined): string | undefined {
  const at = obj(fm, "generated")?.at;
  if (typeof at === "string" && at) return at;
  return str(fm, "timestamp");
}


/** The v0.2 path-valued fields beyond `resource` (§6.2, §10.2): computation,
 *  executor.resource, attester.resource, and each sources[].resource — as
 *  written, in frontmatter order. Callers classify them with pathKind. */
export function pathFieldValues(fm: FM | null | undefined): string[] {
  const out: string[] = [];
  const c = str(fm, "computation");
  if (c) out.push(c);
  for (const k of ["executor", "attester"]) {
    const r = obj(fm, k)?.resource;
    if (typeof r === "string" && r) out.push(r);
  }
  for (const s of list(fm, "sources") ?? [])
    if (isPlainObject(s) && typeof s.resource === "string" && s.resource) out.push(s.resource);
  return out;
}
