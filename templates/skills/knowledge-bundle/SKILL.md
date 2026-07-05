---
name: knowledge-bundle
description: Maintain the {bundle}/ OKF bundle — this repo's authored knowledge layer (patterns, decision records, playbooks, component catalog). Use after adding or changing components, when making a non-obvious design decision worth recording, or when asked to "update the knowledge bundle", "add a decision record", "validate the bundle", or "regenerate the knowledge graph".
---

# Maintaining the {bundle}/ OKF bundle

`{bundle}/` is an [Open Knowledge Format v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
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
| Any of the above | Append a `log.md` entry under today's `## YYYY-MM-DD` (newest first, `**Update**`/`**Creation**`/`**Deprecation**` lead), then run `index` + `validate` |

## Entry quality checklist

Run this before committing any concept doc you created or touched:

- **Description** = what it *is* (upstream-accurate) + how *this repo* uses
  it, in one sentence. No name-restating filler ("X local service").
- **Body** says what the source can't: wiring, deliberate deviations,
  gotchas. Concise — delete anything that restates the description or the
  code.
- **`## Citations`** links upstream docs / man pages / reference material;
  commit hashes for decisions. Fetch each URL to confirm it resolves — a
  guessed link is worse than none.
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
timestamp: '<ISO-8601 now>'
---

**Status:** active. **Where:** [<concept>](<relative link to the affected concept doc>).

## Context

<the problem/constraint that forced a choice>

## Decision

<what was chosen, and the mechanics that make it work>

## Consequences

<what got better, what to watch out for>

## Citations

- Commits `<hash>`
```

## Profile rules that trip people up

- Frontmatter requires `type`; `title`, `description`, `timestamp`
  (ISO-8601) are recommended (warnings; `okf validate --strict` promotes
  them to errors).
- Links are **file-relative** (`../patterns/foo.md`) — never `/`-rooted;
  links may escape into the repo (`../../src/...`) but must resolve.
- Body section headings are **H2** (`## Context`, `## Citations`); no H1 in
  concept bodies (frontmatter `title` is the H1).
- Never hand-edit generated `index.md` listing sections — only the blurb
  above the first heading; `viz.html` is generated and gitignored.
