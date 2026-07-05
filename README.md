# okflight

`okf` — a CLI for maintaining an [OKF v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
knowledge bundle: `scaffold` stubs catalog docs from the repo sources, `index`
regenerates progressive-disclosure `index.md` listings, `validate` checks
spec/profile conformance and links, and `viz` renders the bundle as a
self-contained interactive 3D graph (single offline HTML file — Svelte 5 viewer
around Three.js glow spheres, bundled at generation time by `Bun.build`).
Since minification strips the bundled libraries' copyright headers and their
MIT/zlib terms require notices to accompany redistributed copies, `viz` embeds
each runtime dependency's LICENSE text (collected from `node_modules` at build
time) in the page — see "Third-party licenses" in the viewer's About modal.

okf operates on a **workspace**: the nearest directory at or above cwd holding
an `okflight.toml` (the pre-rebrand name `okf.toml` is still discovered, with a
rename nudge), else the git toplevel (zero-config mode). `okf init [--dir=<d>]`
bootstraps a fresh workspace — a commented starter `okflight.toml` plus the
bundle skeleton (`<d>/index.md`, `<d>/log.md`); it never overwrites. `okf setup`
is the guided superset — see "Integrating into a repo" below. **Git is optional** —
`[vcs] provider = "auto"|"git"|"none"` selects the version-control adapter
(auto = git when the root is a git toplevel); the `none` provider walks the
filesystem (minus `[vcs] ignore` globs), stamps mtime dates, and skips commit
links, so any directory tree — no VCS at all — can host a bundle.

All commands read that one optional config file (strict-validated; malformed
config fails the command): `[bundle] dir` sets the bundle root (default
`knowledge/`), `[profile]` tunes validation policy (`required-fields`,
`recommended-fields`, `reserved-files`, `rooted-links = "error"|"allow"`,
`repo-links = "check"|"ignore"|"forbid"` — defaults reproduce the stock
OKF-plus-reference-tooling behavior), `[vcs]` adds `url` and
`commit-url-template = "{url}/commit/{hash}"` for forge-agnostic revision
links, and the remaining sections drive the viz viewer. Facet filter lenses
can classify concepts via `[facet.<name>.classify]` — the built-in
`nix-optional-attrs` parser or `provider = "command"` running any repo
script that prints a JSON name→value map.

`okf scaffold` runs the workspace's own metadata pass: `[scaffold] script`
(a TS/JS module dynamically imported; its default export receives the
injected `ScaffoldContext` API from `scaffold-api.ts` — emit with
idempotence/`--force`, VCS timestamps, comment extraction, text helpers) or
`command` (any argv, `OKF_*` env), plus declarative `[[scaffold.collect]]`
entries (glob + templates with `{name}`/`{Title}`/`{path}`/… placeholders,
validated at load) for repos with simple needs. It is a bun/TypeScript
project run from source — no compile step.

## Outputs

- `packages.<system>.okf` (= `default`) — the CLI: sources + vendored
  `node_modules` in the store, wrapped as `bin/okf` (`bun run --prefer-offline
  --no-install …` with git on PATH). Systems: `aarch64-darwin`, `aarch64-linux`,
  `x86_64-linux`.
- `checks.<system>.test` — the viewer unit tests (`bun test`) run offline
  against the vendored deps.
- `devShells.<system>.default` — bun + git for hacking on okf standalone.

## Consuming from a parent flake

```nix
inputs.okf = {
  url = "github:kriswill/okflight";
  inputs.nixpkgs.follows = "nixpkgs";
  inputs.flake-parts.follows = "flake-parts";
};
```

then re-export `inputs.okf.packages.${system}.okf` from the parent's packages
module. `follows` makes the parent build against the parent's nixpkgs; the
lock here only governs standalone builds (`nix build .#okf`), so drv paths
may legitimately differ between the two. Advance the parent's pin with
`nix flake update okf`. While this repository is private, either consume it
as `git+ssh://git@github.com/kriswill/okflight.git` with an SSH key
authorized for the repo (auth rides the SSH agent — e.g. 1Password,
enclave-gated, no token at rest), or keep the `github:` form and set
`access-tokens = github.com=<token>` in `nix.conf`.

A vendored copy (or in-tree checkout) works too via a relative-path input
(`url = "./path/to/okflight"`) — edits then flow through on the next
evaluation, no lock bump needed.

## Integrating into a repo (`okf setup`)

`okf setup` is the guided wizard that makes a repository receive okflight —
interactive on a TTY (Enter accepts every default), flag-driven for agents
and CI (`--yes` plus `--dir=`/`--title=`/`--skills-dir=`/`--no-skill`/
`--no-scripts`/`--no-gitignore`). It writes, and never overwrites:

- `okflight.toml` — the commented starter config (as `init` does), with
  `[scaffold] script` pre-wired when the scripts starter is chosen;
- the bundle skeleton — `<dir>/index.md`, `<dir>/log.md`;
- `.agent/skills/knowledge-bundle/SKILL.md` — an agent skill teaching the
  bundle-maintenance loop (when to scaffold/index/validate, entry quality
  bar, decision-record template), with the bundle dir substituted in; point
  `--skills-dir=` at `.claude/skills` (or symlink) for Claude Code;
- `<dir>/_okflight/scripts/` — the repo-owned metadata pass: a starter
  `main.ts` (run by `okf scaffold` with the injected `ScaffoldContext`) plus
  the vendored `scaffold-api.d.ts` type surface, so the scripts typecheck
  with no okflight checkout at runtime. The `_` prefix keeps the directory
  out of the bundle walk;
- a `.gitignore` entry for the generated `<dir>/viz.html`.

The installed templates live in this repo's `templates/`; a test keeps the
vendored `scaffold-api.d.ts` member-for-member in sync with
`scaffold-api.ts`. If setup finds a `flake.nix` it prints the
`inputs.okf` wiring as a next step (it never edits your flake).

## Adopting okf in any repo (no Nix required)

okf is plain bun — clone this repository anywhere (or vendor it), then:

```sh
git clone https://github.com/kriswill/okflight ~/src/okflight
cd ~/src/okflight && bun install      # once; vendors the viz viewer deps
cd ~/src/your-project
bun ~/src/okflight/okf.ts setup       # guided integration (or `init` for the bare skeleton)
bun ~/src/okflight/okf.ts validate && bun ~/src/okflight/okf.ts viz
```

Any language, any domain, git or no VCS at all (`[vcs] provider = "none"`).
Wire your own metadata pass via `[scaffold]` (script with the injected
`ScaffoldContext` API, any-language `command`, or declarative
`[[scaffold.collect]]` globs).

## Dependency vendoring (the FOD hash)

`node_modules` is a fixed-output derivation running `bun install
--frozen-lockfile` (no bun packaging helper exists in nixpkgs; this mirrors its
`opencode`/`helix-gpt` packages). The lock is pure JS with no os/cpu-conditional
packages, so **one hash serves all platforms**. When `bun.lock` changes (or a
nixpkgs bump changes bun and the install layout shifts — the failure is a loud
hash mismatch), refresh it:

1. In `package.nix`, set the FOD's `outputHash = lib.fakeHash;`
2. `nix build .#okf.node_modules` — copy the `got:` sha256 back in.

## Development

A consuming repo can wrap a checkout of this working tree
(`bun path/to/okflight/okf.ts`) for live edits with no rebuild; nix
consumers get the pinned store build. Standalone:

```sh
nix develop            # or any ambient bun
bun install
bun test
bun okf.ts help
```

**Dev-tree only** (not available from the nix-built package, whose
`node_modules` is a read-only store path):

- `okf viz --check` — spawns `bunx svelte-check`, which writes
  `node_modules/.svelte2tsx-language-server-files` at startup.
- `okf viz --perf` — needs a locally installed Chrome (puppeteer-core).
