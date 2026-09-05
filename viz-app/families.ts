// Detail-panel rendering of a concept's frontmatter, OKF v0.2-aware: the
// trust, lifecycle, provenance and computation families (SPEC §5, §10) get
// purpose-built rows — actors and dates, a trust-tier chip, a stale badge,
// a sources table, a parameters table, path links — and anything else
// (unknown keys, §4.1) falls back to a generic cell, with nested mappings
// and lists rendered as a small key/value table rather than "[object
// Object]". Pure HTML strings, framework-free; the panel delegates clicks on
// the data-* anchors exactly as it does for the body.

import { esc } from "./markdown";
import { asVerifiedList, isPlainObject, isStale, statusOf, trustTier, type FM } from "./okf-fields";

export interface FamilyCtx {
  /** Humanized date per display.date-format, or null when not a date. */
  fmtDate(v: unknown): string | null;
  /** In-panel link for a path-valued field (file/dir/concept anchor) or
   *  null when nothing embedded answers to it. */
  pathLink(value: string): string | null;
  /** The generic cell renderer for plain keys (description autolinking etc). */
  plain(k: string, v: unknown): string;
  now?: Date;
}

const ACTOR_KIND: Record<string, string> = { human: "human", process: "process" };

/** An actor (§7) as a small kind-tagged span. */
export function actorHtml(v: unknown): string {
  if (typeof v !== "string") return esc(String(v));
  const m = /^(human|process):(.+)$/.exec(v);
  if (m) return `<span class="actor actor-${ACTOR_KIND[m[1]!]}"><span class="kind">${m[1]}</span>${esc(m[2]!)}</span>`;
  return `<span class="actor actor-agent">${esc(v)}</span>`;
}

const dateOr = (ctx: FamilyCtx, v: unknown) => (v === undefined ? "" : esc(ctx.fmtDate(v) ?? String(v)));

/** `by · at` for one { by, at } event. */
const eventHtml = (ctx: FamilyCtx, e: Record<string, unknown>) =>
  [e.by !== undefined ? actorHtml(e.by) : "", e.at !== undefined ? `<span class="when">${dateOr(ctx, e.at)}</span>` : ""]
    .filter(Boolean)
    .join(" · ");

/** A value that may name a path: linked when the embed knows it, else text
 *  (URLs open in a new tab). */
export function pathHtml(ctx: FamilyCtx, v: unknown): string {
  if (typeof v !== "string") return esc(String(v));
  if (/^https?:\/\//.test(v)) return `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>`;
  return ctx.pathLink(v) ?? `<code>${esc(v)}</code>`;
}

/** Generic nested value: scalars inline, lists joined, mappings/lists of
 *  mappings as a nested key/value table. */
export function genericHtml(ctx: FamilyCtx, v: unknown): string {
  if (Array.isArray(v)) {
    if (v.every((x) => !isPlainObject(x) && !Array.isArray(x))) return esc(v.map(String).join(", "));
    return `<ol class="sub">${v.map((x) => `<li>${genericHtml(ctx, x)}</li>`).join("")}</ol>`;
  }
  if (isPlainObject(v)) {
    const rows = Object.entries(v)
      .map(([k, x]) => `<tr><td>${esc(k)}</td><td>${genericHtml(ctx, x)}</td></tr>`)
      .join("");
    return `<table class="sub"><tbody>${rows}</tbody></table>`;
  }
  const d = ctx.fmtDate(v);
  return d ? esc(d) : esc(String(v));
}

const chip = (cls: string, text: string) => `<span class="fam-chip ${cls}">${esc(text)}</span>`;

/** One frontmatter key -> table row HTML (`<tr>…</tr>`), or "" to skip. */
export function familyRow(ctx: FamilyCtx, fm: FM, k: string, v: unknown): string {
  const row = (label: string, html: string) => `<tr><td>${esc(label)}</td><td>${html}</td></tr>`;
  switch (k) {
    case "generated":
      return isPlainObject(v) ? row(k, eventHtml(ctx, v)) : row(k, genericHtml(ctx, v));
    case "verified": {
      const entries = asVerifiedList(v);
      if (!entries.length) return row(k, genericHtml(ctx, v));
      const tier = trustTier(fm);
      const items = entries.map((e) => `<li>${eventHtml(ctx, e)}</li>`).join("");
      return row(k, `${chip(`tier-${tier}`, tier)}<ul class="events">${items}</ul>`);
    }
    case "status": {
      const s = statusOf(fm);
      return row(k, chip(`status-${s}`, typeof v === "string" ? v : s));
    }
    case "stale_after": {
      const stale = isStale(fm, ctx.now);
      return row(k, `${dateOr(ctx, v)}${stale ? " " + chip("stale", "stale") : ""}`);
    }
    case "usage_window":
      return isPlainObject(v)
        ? row(k, `${dateOr(ctx, v.from)} <span class="range">→</span> ${dateOr(ctx, v.to)}`)
        : row(k, genericHtml(ctx, v));
    case "sources": {
      if (!Array.isArray(v) || !v.every(isPlainObject)) return row(k, genericHtml(ctx, v));
      const cols = ["id", "resource", "author", "usage_count", "last_modified"].filter((c) => v.some((s) => s[c] !== undefined));
      const head = cols.map((c) => `<th>${esc(c === "usage_count" ? "usage" : c)}</th>`).join("");
      const body = v
        .map((s) => {
          const cells = cols.map((c) => {
            if (c === "resource") {
              const label = typeof s.title === "string" && s.title ? esc(s.title) : null;
              const link = pathHtml(ctx, s.resource);
              // A titled source shows its title, linked where the resource links.
              const html = label ? link.replace(/>[^<]*<\/a>$/, `>${label}</a>`) : link;
              return `<td>${label && html === link && !/<a /.test(link) ? `${label} <span class="dim">${link}</span>` : html}</td>`;
            }
            if (c === "last_modified") return `<td>${dateOr(ctx, s[c])}</td>`;
            if (c === "author") return `<td>${s[c] === undefined ? "" : actorHtml(s[c])}</td>`;
            if (c === "id") return `<td><code id="src-${esc(String(s.id ?? ""))}">${esc(s.id === undefined ? "" : String(s.id))}</code></td>`;
            return `<td>${s[c] === undefined ? "" : esc(String(s[c]))}</td>`;
          });
          const win = isPlainObject(s.usage_window)
            ? `<tr class="win"><td colspan="${cols.length}">window ${dateOr(ctx, s.usage_window.from)} → ${dateOr(ctx, s.usage_window.to)}</td></tr>`
            : "";
          return `<tr>${cells.join("")}</tr>${win}`;
        })
        .join("");
      return row(k, `<table class="sub sources"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
    }
    case "parameters": {
      if (!Array.isArray(v) || !v.every(isPlainObject)) return row(k, genericHtml(ctx, v));
      const body = v
        .map(
          (p) =>
            `<tr><td><code>${esc(String(p.name ?? ""))}</code></td><td>${esc(String(p.type ?? ""))}</td><td>${p.required === true ? "required" : p.required === false ? "optional" : ""}</td></tr>`,
        )
        .join("");
      return row(k, `<table class="sub params"><tbody>${body}</tbody></table>`);
    }
    case "computation":
      return row(k, pathHtml(ctx, v));
    case "executor":
    case "attester": {
      if (!isPlainObject(v)) return row(k, genericHtml(ctx, v));
      const parts = [v.resource !== undefined ? pathHtml(ctx, v.resource) : ""];
      if (Array.isArray(v.receipt)) parts.push(`<span class="dim">receipt:</span> ${v.receipt.map((r) => `<code>${esc(String(r))}</code>`).join(" ")}`);
      const rest = Object.entries(v).filter(([kk]) => kk !== "resource" && kk !== "receipt");
      if (rest.length) parts.push(genericHtml(ctx, Object.fromEntries(rest)));
      return row(k, parts.filter(Boolean).join("<br>"));
    }
    case "runtime":
      return row(k, `<code>${esc(String(v))}</code>`);
    default:
      if (isPlainObject(v) || (Array.isArray(v) && v.some((x) => isPlainObject(x) || Array.isArray(x))))
        return row(k, genericHtml(ctx, v));
      return row(k, ctx.plain(k, v));
  }
}

/** All frontmatter rows for a concept, in frontmatter order, minus the keys
 *  the panel shows elsewhere (title as the heading, type as the chip). */
export function familyRows(ctx: FamilyCtx, fm: FM, skip: readonly string[] = ["title", "type"]): string {
  return Object.entries(fm)
    .filter(([k]) => !skip.includes(k))
    .map(([k, v]) => familyRow(ctx, fm, k, v))
    .join("");
}
