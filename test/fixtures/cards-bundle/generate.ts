// Deterministic generator for the cards-bundle fixture's "realistic mass".
//
//   bun test/fixtures/cards-bundle/generate.ts && (cd test/fixtures/cards-bundle && bun ../../../okf.ts index)
//
// It (re)writes the generated bundles below and NEVER touches the hand-written
// e2e core cluster (hub, in-a, in-b, both-e, out-c, out-d, in2-f, out2-g,
// island, notes/note-1): viz-e2e-cards.ts pins that neighborhood's exact
// shape, so no generated doc may link to any of those ids. Everything else
// models a practical engineering knowledge base: ADR supersede chains,
// pattern catalogs cited from everywhere, a mega-hub service (>24 in-links —
// exercises the "+N more" chip), dependency cycles, mutual links, orphan
// glossary terms, and an unregistered type for the generated-color fallback.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "knowledge");
const GENERATED_DIRS = [
  "decisions",
  "patterns",
  "playbooks",
  "runbooks",
  "services",
  "references",
  "glossary",
  "experiments",
];

interface Doc {
  id: string; // bundle-relative path minus .md
  type: string;
  title: string;
  desc: string;
  links: string[]; // target ids
}
const docs: Doc[] = [];
const byId = new Map<string, Doc>();
const add = (id: string, type: string, title: string, desc: string, links: string[] = []) => {
  const d = { id, type, title, desc, links };
  docs.push(d);
  byId.set(id, d);
  return d;
};
const linkFrom = (fromId: string, ...targets: string[]) => byId.get(fromId)!.links.push(...targets);

/* --- services: dependency graph with one mega in-hub --------------------- */
const serviceNames = [
  "core-platform",
  "auth-service",
  "user-service",
  "billing-engine",
  "notification-relay",
  "search-indexer",
  "queue-broker",
  "stream-processor",
  "metrics-collector",
  "feature-flags",
  "api-gateway",
  "web-frontend",
  "mobile-backend",
  "export-worker",
  "import-pipeline",
  "audit-log",
  "rate-limiter",
  "session-store",
  "email-composer",
  "webhook-dispatcher",
];
for (const n of serviceNames) {
  const title = n
    .split("-")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
  add(`services/${n}`, "Service", title, n === "core-platform" ? "Shared kernel every product surface builds on." : `Owns the ${n.replace(/-/g, " ")} concern.`);
}
// Every service except itself depends on core-platform (17 in-links so far;
// decisions and runbooks below push it past MAX_PER_SIDE for the chip).
for (const n of serviceNames) if (n !== "core-platform") linkFrom(`services/${n}`, "services/core-platform");
// A few realistic cross-dependencies.
linkFrom("services/api-gateway", "services/auth-service", "services/rate-limiter");
linkFrom("services/web-frontend", "services/api-gateway", "services/feature-flags");
linkFrom("services/mobile-backend", "services/api-gateway", "services/session-store");
linkFrom("services/billing-engine", "services/queue-broker", "services/audit-log");
linkFrom("services/notification-relay", "services/queue-broker", "services/email-composer");
linkFrom("services/export-worker", "services/queue-broker");
linkFrom("services/import-pipeline", "services/queue-broker", "services/search-indexer");
linkFrom("services/webhook-dispatcher", "services/rate-limiter");
// Mutual pair: auth <-> user.
linkFrom("services/auth-service", "services/user-service");
linkFrom("services/user-service", "services/auth-service");
// Three-node cycle: metrics -> queue -> stream -> metrics.
linkFrom("services/metrics-collector", "services/queue-broker");
linkFrom("services/queue-broker", "services/stream-processor");
linkFrom("services/stream-processor", "services/metrics-collector");

/* --- patterns: the catalog everything cites ------------------------------ */
const patternNames = [
  ["retry-backoff", "Retry with Exponential Backoff", "Bounded retries with jitter for transient faults."],
  ["idempotency-keys", "Idempotency Keys", "Make retried writes safe to repeat."],
  ["circuit-breaker", "Circuit Breaker", "Fail fast when a dependency browns out."],
  ["event-sourcing", "Event Sourcing", "State as an append-only event log."],
  ["cqrs", "CQRS", "Split read and write models."],
  ["saga", "Saga", "Long-lived transactions as compensating steps."],
  ["process-manager", "Process Manager", "Coordinate multi-service workflows."],
  ["outbox", "Transactional Outbox", "Atomically persist state and events."],
  ["bulkhead", "Bulkhead", "Partition resources so one failure can't sink all."],
  ["backpressure", "Backpressure", "Let slow consumers slow producers."],
  ["blue-green", "Blue-Green Deployment", ""],
  ["canary-analysis", "Progressive Delivery with Automated Canary Analysis and Rollback", "Ship to a slice, compare, promote or revert."],
  ["strangler-fig", "Strangler Fig Migration", "Grow the new system around the old."],
  ["feature-toggle", "Feature Toggle", ""],
  ["dead-letter", "Dead Letter Queue", "Park poison messages for later triage."],
  ["cache-aside", "Cache-Aside", "Read-through caching with explicit invalidation."],
] as const;
for (const [slug, title, desc] of patternNames) add(`patterns/${slug}`, "Pattern", title, desc);
// Mutual pair: saga <-> process-manager.
linkFrom("patterns/saga", "patterns/process-manager", "patterns/outbox");
linkFrom("patterns/process-manager", "patterns/saga");
linkFrom("patterns/cqrs", "patterns/event-sourcing");
linkFrom("patterns/event-sourcing", "patterns/outbox");
linkFrom("patterns/canary-analysis", "patterns/feature-toggle", "patterns/blue-green");
linkFrom("patterns/dead-letter", "patterns/backpressure");

/* --- decisions: ADRs with a supersede chain ------------------------------ */
const adrTopics = [
  "Adopt event sourcing for billing",
  "Standardize on queue-broker for async work",
  "Single sign-on across surfaces",
  "Deprecate the legacy export path",
  "Rate limit all public endpoints",
  "Move session state out of process",
  "Introduce feature flags",
  "Progressive delivery for user-facing services",
  "Consolidate webhooks into one dispatcher",
  "Split search from the core platform",
  "Adopt idempotency keys on all writes",
  "Backpressure over unbounded buffering",
  "Audit every billing mutation",
  "Retire the nightly batch importer",
  "Canary before promote",
  "One metrics pipeline",
  "Email composition as a service",
  "Cache invalidation protocol",
];
adrTopics.forEach((topic, i) => {
  const n = String(i + 1).padStart(3, "0");
  add(`decisions/adr-${n}`, "Decision", `ADR-${n}: ${topic}`, i % 3 === 0 ? `Accepted. ${topic}.` : "");
});
// Supersede chain six deep: adr-002 supersedes adr-001, ... adr-006 -> adr-005.
for (let i = 2; i <= 6; i++)
  linkFrom(`decisions/adr-${String(i).padStart(3, "0")}`, `decisions/adr-${String(i - 1).padStart(3, "0")}`);
// Mutual pair (companion decisions cross-reference).
linkFrom("decisions/adr-010", "decisions/adr-011");
linkFrom("decisions/adr-011", "decisions/adr-010");
// ADRs ground themselves in patterns/services (4 also cite core-platform).
linkFrom("decisions/adr-001", "patterns/event-sourcing", "services/billing-engine");
linkFrom("decisions/adr-002", "services/queue-broker", "patterns/outbox");
linkFrom("decisions/adr-003", "services/auth-service", "services/core-platform");
linkFrom("decisions/adr-004", "services/export-worker");
linkFrom("decisions/adr-005", "services/rate-limiter", "patterns/circuit-breaker");
linkFrom("decisions/adr-006", "services/session-store", "services/core-platform");
linkFrom("decisions/adr-007", "services/feature-flags", "patterns/feature-toggle");
linkFrom("decisions/adr-008", "patterns/canary-analysis", "services/core-platform");
linkFrom("decisions/adr-009", "services/webhook-dispatcher");
linkFrom("decisions/adr-010", "services/search-indexer", "services/core-platform");
linkFrom("decisions/adr-011", "patterns/idempotency-keys");
linkFrom("decisions/adr-012", "patterns/backpressure", "patterns/dead-letter");
linkFrom("decisions/adr-013", "services/audit-log", "services/billing-engine");
linkFrom("decisions/adr-014", "services/import-pipeline");
linkFrom("decisions/adr-015", "patterns/canary-analysis", "patterns/blue-green");
linkFrom("decisions/adr-016", "services/metrics-collector");
linkFrom("decisions/adr-017", "services/email-composer");
linkFrom("decisions/adr-018", "patterns/cache-aside");

/* --- references: widely cited library ------------------------------------ */
const refNames = [
  ["style-guide", "Engineering Style Guide", "House rules for code, docs, and reviews."],
  ["api-conventions", "API Conventions", "Naming, pagination, and error envelopes."],
  ["oncall-handbook", "On-call Handbook", "Expectations, escalation, and hand-off."],
  ["slo-catalog", "SLO Catalog", "Agreed service objectives and budgets."],
  ["glossary-guide", "Glossary Authoring Guide", ""],
  ["security-baseline", "Security Baseline", "Minimum bar for every deployable."],
  ["data-retention", "Data Retention Policy", ""],
  ["incident-severity", "Incident Severity Matrix", "What counts as SEV1 through SEV4."],
  ["postmortem-template", "Postmortem Template", ""],
  ["queue-semantics", "Queue Delivery Semantics", "At-least-once, and what that implies."],
  ["release-calendar", "Release Calendar", ""],
  ["vendor-matrix", "Vendor Comparison Matrix", "Kept for the next contract cycle."], // orphan
  ["deprecated-wiki-map", "Deprecated Wiki Map", "Where the old wiki pages went."], // orphan
  ["licensing-notes", "Licensing Notes", ""],
] as const;
for (const [slug, title, desc] of refNames) add(`references/${slug}`, "Reference", title, desc);
linkFrom("references/queue-semantics", "patterns/dead-letter", "patterns/idempotency-keys");
linkFrom("references/slo-catalog", "services/metrics-collector");
linkFrom("references/incident-severity", "references/oncall-handbook");

/* --- playbooks: procedures that fan out ---------------------------------- */
const playbookNames = [
  ["onboarding", "Engineer Onboarding", "First two weeks, from laptop to first deploy."],
  ["release", "Release a Service", "The promote path, canary to full."],
  ["hotfix", "Ship a Hotfix", ""],
  ["schema-migration", "Run a Schema Migration", "Expand, migrate, contract."],
  ["dependency-upgrade", "Upgrade a Shared Dependency", ""],
  ["oncall-handoff", "On-call Hand-off", ""],
  ["capacity-review", "Quarterly Capacity Review", "Forecast, budget, and pre-scale."],
  ["postmortem", "Run a Postmortem", "Blameless, timeboxed, action-tracked."],
  ["key-rotation", "Rotate Service Credentials", ""],
  ["region-failover", "Regional Failover Drill", "Prove the runbooks twice a year."],
  ["data-export", "Customer Data Export", ""],
  ["sunset-feature", "Sunset a Feature", "Flags off, data archived, code deleted."],
] as const;
for (const [slug, title, desc] of playbookNames) add(`playbooks/${slug}`, "Playbook", title, desc);
// Onboarding fans out wide (out-row wrap in the cards view).
linkFrom(
  "playbooks/onboarding",
  "references/style-guide",
  "references/api-conventions",
  "references/oncall-handbook",
  "references/security-baseline",
  "services/core-platform",
  "services/web-frontend",
  "patterns/feature-toggle",
  "glossary/error-budget",
  "glossary/slo",
  "playbooks/release",
  "playbooks/oncall-handoff",
  "references/glossary-guide",
);
linkFrom("playbooks/release", "patterns/canary-analysis", "references/release-calendar", "runbooks/deploy-standard");
linkFrom("playbooks/hotfix", "runbooks/deploy-standard", "references/incident-severity");
linkFrom("playbooks/schema-migration", "patterns/strangler-fig", "services/billing-engine", "references/style-guide");
linkFrom("playbooks/dependency-upgrade", "references/security-baseline", "references/style-guide");
linkFrom("playbooks/oncall-handoff", "references/oncall-handbook", "references/incident-severity");
linkFrom("playbooks/capacity-review", "references/slo-catalog", "services/metrics-collector");
linkFrom("playbooks/postmortem", "references/postmortem-template", "references/incident-severity", "references/style-guide");
linkFrom("playbooks/key-rotation", "services/auth-service", "references/security-baseline");
linkFrom("playbooks/region-failover", "runbooks/failover-database", "runbooks/failover-traffic", "references/oncall-handbook");
linkFrom("playbooks/data-export", "services/export-worker", "references/data-retention");
linkFrom("playbooks/sunset-feature", "services/feature-flags", "references/data-retention", "references/style-guide");

/* --- runbooks: operational procedures ------------------------------------ */
const runbookNames = [
  ["deploy-standard", "Standard Deploy", "The default promote pipeline."],
  ["rollback", "Roll Back a Deploy", ""],
  ["incident-triage", "Incident Triage", "First fifteen minutes of any page."],
  ["queue-drain", "Drain a Backed-up Queue", ""],
  ["cache-flush", "Flush the Edge Cache", ""],
  ["failover-database", "Database Failover", "Promote the replica, verify, repoint."],
  ["failover-traffic", "Traffic Failover", ""],
  ["restore-backup", "Restore from Backup", "Point-in-time recovery, rehearsed."],
  ["scale-workers", "Scale Worker Pools", ""],
  ["rotate-logs", "Rotate and Archive Logs", ""],
] as const;
for (const [slug, title, desc] of runbookNames) add(`runbooks/${slug}`, "Runbook", title, desc);
linkFrom("runbooks/deploy-standard", "services/core-platform", "references/release-calendar");
linkFrom("runbooks/rollback", "runbooks/deploy-standard", "patterns/blue-green");
linkFrom("runbooks/incident-triage", "references/incident-severity", "references/oncall-handbook", "services/core-platform");
linkFrom("runbooks/queue-drain", "services/queue-broker", "patterns/backpressure", "references/queue-semantics");
linkFrom("runbooks/cache-flush", "patterns/cache-aside", "services/api-gateway");
linkFrom("runbooks/failover-database", "services/core-platform", "runbooks/restore-backup");
linkFrom("runbooks/failover-traffic", "services/api-gateway", "services/core-platform");
linkFrom("runbooks/restore-backup", "references/data-retention");
linkFrom("runbooks/scale-workers", "services/export-worker", "services/import-pipeline", "services/core-platform");
linkFrom("runbooks/rotate-logs", "services/audit-log");

/* --- glossary: many small terms, several orphans -------------------------- */
const termNames = [
  ["slo", "SLO", "Service level objective.", ["references/slo-catalog"]],
  ["error-budget", "Error Budget", "How much unreliability the SLO affords.", ["glossary/slo"]],
  ["idempotent", "Idempotent", "Safe to apply more than once.", ["patterns/idempotency-keys"]],
  ["backfill", "Backfill", "Recompute derived data for the past.", ["services/import-pipeline"]],
  ["canary", "Canary", "A small slice that ships first.", ["patterns/canary-analysis"]],
  ["dead-letter", "Dead Letter", "", ["patterns/dead-letter"]],
  ["fan-out", "Fan-out", "One event, many consumers.", ["services/queue-broker"]],
  ["p99", "p99", "Ninety-ninth percentile latency.", []],
  ["toil", "Toil", "Manual, repetitive, automatable work.", []],
  ["runway", "Runway", "", []],
  ["blast-radius", "Blast Radius", "What breaks when this breaks.", []],
  ["cold-start", "Cold Start", "", []],
  ["drift", "Drift", "Config diverging from source of truth.", []],
  ["shard", "Shard", "", []],
  ["watermark", "Watermark", "Progress marker in a stream.", []],
] as const;
for (const [slug, title, desc, links] of termNames) add(`glossary/${slug}`, "Term", title, desc, [...links]);

/* --- experiments: unregistered type (generated color fallback) ------------ */
add("experiments/edge-rendering", "Experiment", "Edge Rendering Spike", "Can we render cards at the CDN edge?", [
  "services/web-frontend",
]);
add("experiments/vector-search", "Experiment", "Vector Search Trial", "", ["services/search-indexer"]);
add("experiments/queue-sharding", "Experiment", "Queue Sharding Prototype", "", [
  "services/queue-broker",
  "patterns/bulkhead",
]);
add("experiments/llm-summaries", "Experiment", "LLM Digest Summaries", "Summarize the audit log weekly.", [
  "services/audit-log",
]);
add("experiments/paused-island", "Experiment", "Paused: Offline Mode", "Parked until next quarter.", []); // island

/* --- notes: grow the existing sub-bundle without touching note-1 ---------- */
add("notes/note-2", "Reference", "Note Two", "Scratch thinking that references Note One.", ["notes/note-1"]);
add("notes/note-3", "Reference", "Note Three", "", ["notes/note-2"]);

/* --- emit ------------------------------------------------------------------ */
// The e2e-pinned neighborhood: nothing generated may link INTO these ids
// (that would grow hub's asserted rows or rings). notes/note-1 is exempt —
// it appears in no asserted layout; only its file stays hand-written.
const CORE = new Set(["hub", "in-a", "in-b", "both-e", "out-c", "out-d", "in2-f", "out2-g", "island"]);
for (const d of docs)
  for (const t of d.links) {
    if (CORE.has(t)) throw new Error(`generated doc ${d.id} links into the e2e core cluster (${t})`);
    if (!byId.has(t) && t !== "notes/note-1") throw new Error(`generated doc ${d.id} links to unknown id ${t}`);
  }

for (const dir of GENERATED_DIRS) rmSync(join(ROOT, dir), { recursive: true, force: true });

const render = (d: Doc): string => {
  const fm = [`type: ${d.type}`, `title: ${JSON.stringify(d.title)}`];
  if (d.desc) fm.push(`description: ${JSON.stringify(d.desc)}`);
  const linkLines = d.links.map((t) => {
    const target = byId.get(t);
    const rel = relative(dirname(join(ROOT, d.id + ".md")), join(ROOT, t + ".md"));
    return `- [${target?.title ?? t}](${rel})`;
  });
  return `---\n${fm.join("\n")}\n---\n\n# ${d.title}\n\n${d.desc || "No summary yet."}\n${
    linkLines.length ? `\n## Related\n\n${linkLines.join("\n")}\n` : ""
  }`;
};

let written = 0;
for (const d of docs) {
  const abs = join(ROOT, d.id + ".md");
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, render(d));
  written++;
}
const edgeCount = docs.reduce((n, d) => n + d.links.length, 0);
console.log(`generated ${written} docs, ${edgeCount} links across ${GENERATED_DIRS.length + 1} bundles`);
