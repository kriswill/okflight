// Shared workspace-bootstrap pieces for `okf init` (minimal skeleton) and
// `okf setup` (guided integration): the starter okflight.toml template, the
// bundle skeleton, and the never-overwrite writer both commands promise.
// Neither command loads the workspace context — they must work where none
// exists yet.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/** Same shape [scaffold] script/collect paths are held to at config load. */
export const validRelDir = (dir: string): boolean =>
  !!dir && !dir.startsWith("/") && !dir.split("/").includes("..");

/** Escape a value for interpolation into a basic TOML string. */
const tomlStr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export interface StarterOpts {
  /** Bundle dir, workspace-relative, no trailing slash. */
  dir: string;
  /** [display] title. */
  title: string;
  /** Workspace-relative [scaffold] script to wire live; null leaves the
   *  section as a commented example. */
  scaffoldScript: string | null;
}

export function starterToml({ dir, title, scaffoldScript }: StarterOpts): string {
  const scaffoldSection = scaffoldScript
    ? `[scaffold]                       # the workspace's metadata pass (okf scaffold)
script = "${tomlStr(scaffoldScript)}"  # repo-owned pass; default export gets the ScaffoldContext API
# command = ["python3", "tools/scaffold.py"]  # non-JS alternative (OKF_* env); exclusive with script`
    : `# [scaffold]                     # the workspace's metadata pass (okf scaffold)
# script = "${dir}/_okflight/scripts/main.ts"  # TS/JS module; default export gets the ScaffoldContext API
# command = ["python3", "tools/scaffold.py"]  # non-JS alternative (OKF_* env); exclusive with script`;
  return `# okflight.toml — workspace settings for the okf CLI (all sections optional;
# this file's directory is the workspace root). Reference: the okflight README.

[bundle]
dir = "${tomlStr(dir)}" # OKF bundle root, workspace-relative
# out = "viz.html"               # viz output file, relative to the bundle dir

# [profile]                      # validation policy (defaults shown)
# required-fields = ["type"]
# recommended-fields = ["title", "description", "timestamp"]
# reserved-files = ["index.md", "log.md"]
# rooted-links = "error"         # "error" | "allow"
# repo-links = "check"           # "check" | "ignore" | "forbid"

# [vcs]
# provider = "auto"              # "auto" | "git" | "none" (no VCS: fs walk + mtime)
# ignore = ["dist/**"]           # none-provider ignore globs
# url = ""                       # repo web URL ("" = derive from the remote, any forge)
# commit-url-template = "{url}/commit/{hash}"   # GitLab: "{url}/-/commit/{hash}"

[display]
title = "${tomlStr(title)}"    # <title> = "<name> — <title>"
# badge = "OKFlight"             # brand label (stage About button + modal title)
# name = ""                      # header name override ("" = derive owner/repo)
# date-format = "iso"            # "iso" | "us" | "international"
# about-html = """Help-bubble text (trusted HTML)."""

${scaffoldSection}
# [[scaffold.collect]]           # declarative tier: glob + templates
# glob = "src/**/*.py"
# type = "Module"
# output = "modules/{name}.md"
# comment = "#"                  # leading-comment marker for descriptions

# [taxonomy]                     # viz legend/palette
# types = ["Decision", "Module"] # palette slot order — append-only
# group-order = ["Knowledge"]
# [taxonomy.dir-groups]          # top-level bundle dir -> legend cluster
# decisions = "Knowledge"

# [facet.status]                 # 0..n filter lenses (viz)
# values = ["draft", "final"]
# frontmatter = "status"         # read a frontmatter key as the value
`;
}

export const starterIndex = (dir: string): string => `---
okf_version: '0.1'
---

# ${basename(dir)}

Describe this bundle here — the blurb above the first heading is
hand-maintained and survives \`okf index\` regeneration.
`;

export const starterLog = (creator: string): string => `# Log

## ${new Date().toISOString().slice(0, 10)}

- **Creation** — bundle initialized by \`${creator}\`.
`;

export interface Writer {
  /** Write `rel` under cwd unless it already exists (the bootstrap
   *  never-overwrite contract); dirs created; logs `+ rel`. Returns true
   *  if written. */
  put(rel: string, content: string): boolean;
  created: string[];
}

export function makeWriter(cwd: string): Writer {
  const created: string[] = [];
  return {
    created,
    put(rel: string, content: string): boolean {
      const abs = join(cwd, rel);
      if (existsSync(abs)) return false;
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content);
      created.push(rel);
      console.log(`  + ${rel}`);
      return true;
    },
  };
}
