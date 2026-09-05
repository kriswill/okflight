// Migrate a v0.1 bundle to OKF v0.2 in place (SPEC.md §13.1's two breaking
// renames), idempotently:
//   timestamp            -> generated: { by: <actor>, at: <timestamp> }
//   body Citations list  -> sources: [{ id, resource, title }]  (section removed)
//   root index okf_version -> "0.2"
// Dry-run by default (prints what would change); --write applies. A doc that
// already carries `generated` keeps it (its `timestamp` is dropped only when
// generated.at exists, so no date is ever lost); citation items that are not
// links (revision hashes, prose) are left in place and reported, since they
// are not sources. Unknown frontmatter keys are preserved (§4.1). Bodies are
// untouched except for the removed section. Run `okf index` + `okf validate`
// afterwards. This module is the pure per-doc step; migrate.ts is the driver.

import { extractCitationsSection, isPlainObject, sourceId, str, type FM } from "./lib";

/** Migrate one concept doc; null when nothing changes. */
export function migrateDoc(fm: FM, body: string, by: string): { fm: FM; body: string; notes: string[] } | null {
  const notes: string[] = [];
  let out: FM = { ...fm };

  // §13.1: timestamp -> generated.at
  const ts = str(fm, "timestamp");
  const gen = isPlainObject(fm.generated) ? { ...fm.generated } : null;
  if (fm.timestamp !== undefined) {
    if (!gen) {
      // generated lands where timestamp was, so the key order stays readable.
      const next: FM = {};
      for (const [k, v] of Object.entries(out)) {
        if (k === "timestamp") next.generated = ts ? { by, at: ts } : { by };
        else next[k] = v;
      }
      out = next;
      notes.push(ts ? `timestamp -> generated { by: ${by}, at: ${ts} }` : `timestamp (empty) -> generated { by: ${by} }`);
    } else if (typeof gen.at === "string" && gen.at) {
      delete out.timestamp;
      notes.push("timestamp dropped (generated.at already present)");
    } else if (ts) {
      out.generated = { ...gen, at: ts };
      delete out.timestamp;
      notes.push(`timestamp -> generated.at (${ts})`);
    }
  }

  // §13.1: body Citations -> sources
  const cites = extractCitationsSection(body);
  let nextBody = body;
  if (cites) {
    const existing = Array.isArray(out.sources) ? out.sources.filter(isPlainObject) : [];
    const known = new Set(existing.map((s) => String(s.resource)));
    const usedIds = new Set(existing.map((s) => String(s.id)));
    const added: FM[] = [];
    const kept: string[] = [];
    for (const item of cites.items) {
      if (!item.resource) {
        kept.push(item.raw);
        continue;
      }
      if (known.has(item.resource)) continue;
      known.add(item.resource);
      const base = sourceId(item.title !== item.resource ? item.title : item.resource);
      let id = base;
      for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
      usedIds.add(id);
      const entry: FM = { id, resource: item.resource };
      if (item.title && item.title !== item.resource) entry.title = item.title;
      added.push(entry);
    }
    if (added.length) {
      out.sources = [...existing, ...added];
      notes.push(`Citations -> sources (${added.length} added${existing.length ? `, ${existing.length} kept` : ""})`);
    }
    if (kept.length) {
      // Non-source items stay under the heading — leave the section, and say
      // so once, alongside the change that moved its links (a section holding
      // only such items is simply not a migration target, so re-runs stay silent).
      if (added.length)
        notes.push(`${kept.length} Citations item(s) are not sources, left in place: ${kept.map((k) => `"${k}"`).join(", ")}`);
    } else if (added.length || cites.items.length === 0) {
      // Remove the heading through the last item plus the blank lines around it.
      const lines = body.split("\n");
      const [start, end] = cites.range;
      let cut = end;
      while (cut < lines.length && lines[cut]!.trim() === "") cut++;
      let from = start;
      while (from > 0 && lines[from - 1]!.trim() === "") from--;
      lines.splice(from, cut - from, ...(from > 0 && cut < lines.length ? [""] : []));
      nextBody = lines.join("\n");
      if (!nextBody.endsWith("\n")) nextBody += "\n";
      notes.push("Citations section removed");
    }
  }

  return notes.length ? { fm: out, body: nextBody, notes } : null;
}
