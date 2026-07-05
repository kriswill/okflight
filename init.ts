// Bootstrap an okf workspace in the CURRENT DIRECTORY (which becomes the
// workspace root — discovery finds the okflight.toml written here): a
// commented starter config plus the bundle skeleton (<dir>/index.md,
// <dir>/log.md). Strictly a bootstrapper: never overwrites; re-running is a
// no-op. For the guided integration (agent skill, scaffold-scripts starter,
// gitignore) see setup.ts. Does not load the workspace context — init must
// work where none exists yet.

import { CONFIG_FILE } from "./config-cli";
import { makeWriter, starterIndex, starterLog, starterToml, validRelDir } from "./bootstrap";
import { c } from "./lib";

const dirArg = process.argv.find((a) => a.startsWith("--dir="))?.slice("--dir=".length);
const dir = (dirArg ?? "knowledge").replace(/\/+$/, "");
if (!validRelDir(dir)) {
  console.error('init: --dir must be a non-empty relative path without ".."');
  process.exit(1);
}

const w = makeWriter(process.cwd());
w.put(CONFIG_FILE, starterToml({ dir, title: "OKF knowledge graph", scaffoldScript: null }));
w.put(`${dir}/index.md`, starterIndex(dir));
w.put(`${dir}/log.md`, starterLog("okf init"));

if (!w.created.length) {
  console.log(
    `init: already initialized (${CONFIG_FILE}, ${dir}/index.md, ${dir}/log.md all exist) — nothing written`,
  );
} else {
  const prog = process.env.OKF_PROG ?? "bun okf.ts";
  console.log(
    [
      "",
      `Workspace initialized at ${process.cwd()}`,
      "",
      `Next steps:`,
      `  ${c.cyan(`${prog} validate`)}   ${c.dim("conformance + links (should already pass)")}`,
      `  ${c.cyan(`${prog} index`)}      ${c.dim("regenerate index.md listings as concepts appear")}`,
      `  ${c.cyan(`${prog} viz`)}        ${c.dim(`render the graph at ${dir}/viz.html`)}`,
      `  ${c.dim(`wire your metadata pass via [scaffold] in ${CONFIG_FILE}, then`)} ${c.cyan(`${prog} scaffold`)}`,
      `  ${c.dim("or run")} ${c.cyan(`${prog} setup`)} ${c.dim("for the guided integration (agent skill, scaffold scripts)")}`,
    ].join("\n"),
  );
}
