{
  description = "okf — CLI for maintaining OKF knowledge bundles (scaffold/index/validate/viz)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];

      perSystem =
        { pkgs, config, ... }:
        {
          packages = {
            okf = pkgs.callPackage ./package.nix { };
            default = config.packages.okf;
          };

          # Offline `bun test` against the vendored node_modules (happy-dom +
          # svelte-loader preloads from bunfig.toml; no network).
          checks.test = config.packages.okf.passthru.tests.unit;

          devShells.default = pkgs.mkShell {
            packages = builtins.attrValues { inherit (pkgs) bun git; } ++ [
              # Live-source `okf`: runs the enclosing checkout's okf.ts (a
              # flake only sees a store copy of itself, so the working tree
              # must be resolved at call time) — edits apply with no rebuild.
              (pkgs.writeShellScriptBin "okf" ''
                root=$(git rev-parse --show-toplevel 2>/dev/null)
                if [ ! -f "$root/okf.ts" ]; then
                  echo "okf(dev shim): no okf.ts at the git toplevel ('$root') — run inside the okflight checkout" >&2
                  exit 1
                fi
                OKF_PROG=okf exec bun "$root/okf.ts" "$@"
              '')
            ];
          };
        };
    };
}
