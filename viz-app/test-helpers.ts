// Shared fixtures for the viz-app test suite. Not a test file itself —
// `bun test` only picks up *.test.ts — and never bundled (only test files
// import it).
import type { ConceptNode } from "./data";

export const node = (id: string, type: string, title = id, extra: Partial<ConceptNode> = {}): ConceptNode => ({
  id,
  type,
  title,
  desc: "",
  fm: {},
  body: "",
  x: 0,
  y: 0,
  z: 0,
  ...extra,
});

/** Repo-shaped raw viz config (TOML kebab spelling) for RawData.cfg —
 *  reproduces the pre-config-file hardcoded taxonomy/platform behavior,
 *  now as a single `platform` facet mirroring the repo's okflight.toml. */
export const cfg = (over: Record<string, unknown> = {}) => ({
  taxonomy: {
    types: [
      "Alpha Module",
      "Nix Package",
      "Playbook",
      "Pattern",
      "Decision",
      "Host",
      "Sub-flake",
      "Flake-parts Module",
      "Wiki Config",
      "Wiki Plugin",
      "Overlay",
      "Reference",
    ],
    "group-order": ["Knowledge", "System", "Packages", "Wiki"],
    "dir-groups": {
      decisions: "Knowledge",
      patterns: "Knowledge",
      playbooks: "Knowledge",
      ".": "Knowledge",
      modules: "System",
      hosts: "System",
      packages: "Packages",
      wiki: "Wiki",
    },
  },
  facet: {
    platform: {
      values: ["macos", "linux"],
      types: {
        "Alpha Module": "macos",
        "Beta Module": "linux",
        Host: "macos", // replaces host-default
      },
      ids: { "hosts/europa": "linux" },
      classify: {
        provider: "nix-optional-attrs",
        file: "modules/packages.nix",
        guards: { darwin: "macos", linux: "linux" },
        types: ["Nix Package", "Sub-flake", "Overlay"],
      },
    },
  },
  ...over,
});

