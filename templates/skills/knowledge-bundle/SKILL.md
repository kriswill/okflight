---
name: knowledge-bundle
description: Maintain the {bundle}/ OKF bundle — this repo's authored knowledge layer (patterns, decision records, playbooks, component catalog). Use after adding or changing components, when making a non-obvious design decision worth recording, or when asked to "update the knowledge bundle", "add a decision record", "validate the bundle", or "regenerate the knowledge graph".
---

# Maintaining the {bundle}/ OKF bundle

`{bundle}/` is an [Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md)
bundle: markdown concept docs with YAML frontmatter, cross-linked into a
graph. It exists so rationale survives outside commit bodies and chat
history — **keep it current as part of any change, not as an afterthought.**
Workspace settings live in the repo-root `okflight.toml`; if a
`{bundle}/okf-profile.md` exists, it holds this repo's authoring
conventions — read it before authoring.

## Commands (okf — github:kriswill/okflight)

Run as `okf <cmd>` however this repo provides it (nix devshell,
`nix run github:kriswill/okflight -- <cmd>`, or
`bun <okflight-checkout>/okf.ts <cmd>`):

```sh
okf scaffold  # stub concept docs from the repo sources (never overwrites)
okf index     # regenerate index.md listings (blurbs above the first heading are preserved)
okf validate  # conformance + link check; must exit 0 before committing
okf migrate   # dry-run upgrade of v0.1 docs (timestamp, ## Citations) — add --write to apply
okf viz       # regenerate {bundle}/viz.html interactive graph (gitignored)
```

{scaffold-note}

## When to update what

| Change you just made | Bundle action |
|---|---|
| Added a component the scaffold pass covers | `scaffold` then `index`; then bring the stub up to the quality checklist below — scaffolded output is a placeholder, not an entry |
| Removed or renamed a component | Delete/rename its doc, fix inbound links (`validate` finds them), `index` |
| Made a non-obvious decision (anything that would deserve a long commit body) | Add `{bundle}/decisions/<slug>.md` (template below); cite commit hashes; link affected concepts both ways |
| Changed how a core mechanism works | Update the matching `{bundle}/patterns/*.md` |
| New recurring procedure | Add `{bundle}/playbooks/<slug>.md` |
| Any of the above | Append a log entry to the **owning bundle directory's** `log.md` (`{bundle}/decisions/log.md`, `{bundle}/patterns/log.md`, … — create it on the first entry) under today's `## YYYY-MM-DD` (newest first, `**Update**`/`**Creation**`/`**Deprecation**` lead), links relative to that file; then run `index` + `validate` |

## Entry quality checklist

Run this before committing any concept doc you created or touched:

- **Description** = what it *is* (upstream-accurate) + how *this repo* uses
  it, in one sentence. No name-restating filler ("X local service").
- **Body** says what the source can't: wiring, deliberate deviations,
  gotchas. Concise — delete anything that restates the description or the
  code.
- **`sources`** (frontmatter) lists the upstream docs / man pages /
  reference material the entry derives from, each with an `id`, and the
  body attributes claims with footnotes keyed to those ids
  (`…as documented.[^style-guide]`). Fetch each URL to confirm it resolves
  — a guessed link is worse than none. Commit hashes go in the body prose
  (`Commits \`<hash>\``), not in `sources`.
- **`generated`** is `{ by: <actor>, at: <ISO-8601> }` — `human:<your id>`
  when you author by hand, `<agent>/<version>` when an agent does. Add a
  `verified: { by: human:<id>, at }` entry only after a person has actually
  checked the content against its sources; set `status: deprecated` (never
  delete) when an entry stops being current, and `stale_after` when a fact
  has a known shelf life.
- **Cross-links** — every concept the body names is a link, with a backlink
  from the target when the relationship is load-bearing. Aim for ≥2 edges
  beyond any scaffolded links.
- **Touched a component whose doc is still a stub?** Upgrade it in the same
  change.

## Decision-record template

```markdown
---
type: Decision
title: <Short Imperative Title>
description: <one sentence — what was decided and the key why.>
tags: [<topic>]
status: stable
generated: { by: human:<your id>, at: <ISO-8601 now> }
sources:
  - id: <short-id>
    resource: <URL or ../path/to/reference.md>
    title: <what it is>
---

**Where:** [<concept>](<relative link to the affected concept doc>).

## Context

<the problem/constraint that forced a choice>

## Decision

<what was chosen, and the mechanics that make it work>

## Consequences

<what got better, what to watch out for — per the reference.[^<short-id>]>
Landed in commits `<hash>`.

[^<short-id>]: <what it is>
```

## Profile rules that trip people up

- Frontmatter requires `type`; `title`, `description`, `generated`
  are recommended (warnings; `okf validate --strict` promotes them to
  errors). A v0.1 `timestamp` or body `## Citations` list is a warning that
  says `okf migrate` — run it rather than hand-porting.
- Every footnote label (`[^x]`) must match a `sources[].id` — an unmatched
  one is an error; every timestamp is ISO-8601 with an explicit offset.
- Links are **file-relative** (`../patterns/foo.md`) — never `/`-rooted;
  links may escape into the repo (`../../src/...`) but must resolve.
- Body section headings are **H2** (`## Context`, `## Decision`); no H1 in
  concept bodies (frontmatter `title` is the H1).
- Never hand-edit generated `index.md` listing sections — only the blurb
  above the first heading; `viz.html` is generated and gitignored.
- ⚠️ **Logs are bundle-scoped; the root `{bundle}/log.md` is NOT the
  default.** Per OKF SPEC §9 a `log.md` may appear at any level, recording
  changes to that scope — so entries go in the `log.md` of the directory
  owning the change's primary subject. The root log records bundle-level
  events only: new bundle types or directories, root-level concept docs,
  bundle-wide sweeps, tooling conventions. Before appending to the root
  log, justify why no single sub-bundle owns the change — if one does, the
  entry belongs there.
