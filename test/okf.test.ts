// The okf.ts dispatcher's built-in version command: `version` and its
// --version/-v aliases print the version from the package's own package.json
// (the build actually running) plus the bun runtime version.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const okflight = join(import.meta.dir, "..");

describe("okf version", () => {
  test.each(["version", "--version", "-v"])("`okf %s` prints the package version", async (arg) => {
    const { version } = await Bun.file(join(okflight, "package.json")).json();
    const r = Bun.spawnSync([process.execPath, join(okflight, "okf.ts"), arg], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString().trim()).toBe(`okflight ${version} (bun ${Bun.version})`);
  });

  test("version rejects stray flags like any other command", () => {
    const r = Bun.spawnSync([process.execPath, join(okflight, "okf.ts"), "version", "--nope"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("unknown flag");
  });
});
