// Guided integration wizard — everything `okf init` writes plus the pieces
// that make a repo actually receive okflight: the knowledge-bundle agent
// skill (.agent/skills/), the repo-owned scaffold-scripts starter
// (<bundle>/_okflight/scripts/, wired into [scaffold] script), and a
// .gitignore entry for the generated viz. Interactive on a TTY (Enter
// accepts the default); every question also has a flag, so agents and CI
// run it non-interactively — no TTY (or --yes) means defaults, no hang.
// Same contract as init: never overwrites; re-running is a no-op. Does not
// load the workspace context — setup must work where none exists yet.
// Templates live in ./templates (shipped inside the package).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeWriter, starterIndex, starterLog, starterToml, validRelDir } from "./bootstrap";
import { CONFIG_FILE, LEGACY_CONFIG_FILE } from "./config-cli";
import { c } from "./lib";

const cwd = process.cwd();
const prog = process.env.OKF_PROG ?? "bun okf.ts";
const args = process.argv.slice(2);
const flagVal = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const has = (name: string) => args.includes(name);

const interactive = !has("--yes") && !!process.stdin.isTTY && !!process.stdout.isTTY;

/** prompt() with a default (Enter/None -> def); flag value wins outright. */
const ask = (flag: string | undefined, q: string, def: string): string => {
  if (flag !== undefined) return flag;
  if (!interactive) return def;
  const a = prompt(`${q} ${c.dim(`[${def}]`)}`);
  return a === null || a.trim() === "" ? def : a.trim();
};
const askYN = (skip: boolean, q: string): boolean => {
  if (skip) return false;
  if (!interactive) return true;
  const a = prompt(`${q} ${c.dim("[Y/n]")}`);
  return a === null || a.trim() === "" || /^y(es)?$/i.test(a.trim());
};

if (interactive)
  console.log(`${c.bold("okf setup")} ${c.dim("— guided OKFlight integration (Enter accepts the default)")}\n`);

const dir = ask(flagVal("--dir"), "Bundle directory", "knowledge").replace(/\/+$/, "");
if (!validRelDir(dir)) {
  console.error('setup: bundle directory must be a non-empty relative path without ".."');
  process.exit(1);
}
const title = ask(flagVal("--title"), "Graph display title", "OKF knowledge graph");
const skillsDir = ask(flagVal("--skills-dir"), "Agent-skills directory", ".agent/skills").replace(/\/+$/, "");
if (!validRelDir(skillsDir)) {
  console.error('setup: skills directory must be a non-empty relative path without ".."');
  process.exit(1);
}
const wantSkill = askYN(has("--no-skill"), `Install the agent skill (${skillsDir}/knowledge-bundle)?`);
const scriptsDir = `${dir}/_okflight/scripts`;
const wantScripts = askYN(has("--no-scripts"), `Create the scaffold-scripts starter (${scriptsDir}/)?`);
const isGitRepo = existsSync(join(cwd, ".git"));
const wantGitignore = isGitRepo && askYN(has("--no-gitignore"), `Add ${dir}/viz.html to .gitignore?`);

if (interactive) console.log("");
const w = makeWriter(cwd);
const notes: string[] = [];

// --- Config + bundle skeleton (the init core) ---------------------------------
const scaffoldScript = wantScripts ? `${scriptsDir}/main.ts` : null;
if (existsSync(join(cwd, LEGACY_CONFIG_FILE)) && !existsSync(join(cwd, CONFIG_FILE))) {
  // Writing okflight.toml beside a legacy okf.toml would silently shadow the
  // existing settings — the rename is the user's move, not setup's.
  notes.push(
    `found legacy ${LEGACY_CONFIG_FILE} — rename it to ${CONFIG_FILE} (same format); setup left the config alone`,
  );
} else if (!w.put(CONFIG_FILE, starterToml({ dir, title, scaffoldScript })) && scaffoldScript) {
  const existing = readFileSync(join(cwd, CONFIG_FILE), "utf8");
  if (!/^\s*\[scaffold\]/m.test(existing))
    notes.push(`${CONFIG_FILE} exists — add [scaffold] script = "${scaffoldScript}" to wire the starter`);
}
w.put(`${dir}/index.md`, starterIndex(dir));
w.put(`${dir}/log.md`, starterLog("okf setup"));

// --- Agent skill + scaffold scripts, from the shipped templates ---------------
const template = (rel: string) => readFileSync(join(import.meta.dir, "templates", rel), "utf8");

if (wantSkill) {
  const scaffoldNote = wantScripts
    ? `The okf CLI itself is generic; THIS repo's scaffolding logic lives in
\`${scriptsDir}/\` — a \`main.ts\` entry run by \`okf scaffold\` via
okflight.toml \`[scaffold] script\`, written against the injected
\`ScaffoldContext\` API (vendored type surface: \`scaffold-api.d.ts\` beside
it; the runtime is injected, so no okflight checkout is needed).
Component-scan changes (new source dirs, new doc types, cross-link targets)
are edits there, not to okf itself. The \`_\` prefix keeps the directory out
of okf's bundle walk.`
    : `The okf CLI itself is generic; wire THIS repo's scaffolding logic via
\`[scaffold]\` in okflight.toml — a \`script\` (TS/JS module written against
the injected \`ScaffoldContext\` API), a \`command\` (any language, \`OKF_*\`
env), or declarative \`[[scaffold.collect]]\` globs (see the okflight README).`;
  const skill = template("skills/knowledge-bundle/SKILL.md")
    .replaceAll("{bundle}", dir)
    .replace("{scaffold-note}", scaffoldNote);
  w.put(`${skillsDir}/knowledge-bundle/SKILL.md`, skill);
}

if (wantScripts) {
  w.put(`${scriptsDir}/main.ts`, template("scaffold/main.ts"));
  w.put(`${scriptsDir}/scaffold-api.d.ts`, template("scaffold/scaffold-api.d.ts"));
}

// --- .gitignore (append, not put: the file usually already exists) ------------
if (wantGitignore) {
  const gi = join(cwd, ".gitignore");
  const line = `${dir}/viz.html`;
  const cur = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!cur.split("\n").some((l) => l.trim() === line || l.trim() === `/${line}`)) {
    writeFileSync(gi, cur + (cur && !cur.endsWith("\n") ? "\n" : "") + line + "\n");
    console.log(`  ~ .gitignore (+ ${line})`);
    w.created.push(".gitignore");
  }
}

// --- Report --------------------------------------------------------------------
for (const n of notes) console.log(`${c.yellow("  ! ")}${n}`);

if (!w.created.length && !notes.length) {
  console.log("setup: everything already in place — nothing written");
} else {
  const steps = [
    `  ${c.cyan(`${prog} validate`)}   ${c.dim("conformance + links (should already pass)")}`,
    `  ${c.cyan(`${prog} index`)}      ${c.dim("regenerate index.md listings as concepts appear")}`,
    `  ${c.cyan(`${prog} viz`)}        ${c.dim(`render the graph at ${dir}/viz.html`)}`,
  ];
  if (wantScripts)
    steps.push(`  ${c.dim(`teach ${scriptsDir}/main.ts your repo's components, then`)} ${c.cyan(`${prog} scaffold`)}`);
  if (wantSkill)
    steps.push(
      `  ${c.dim(`agents that read .claude/skills can share the install:`)} ${c.cyan(`ln -s ../../${skillsDir}/knowledge-bundle .claude/skills/knowledge-bundle`)}`,
    );
  if (existsSync(join(cwd, "flake.nix")))
    steps.push(
      "",
      `  ${c.dim("flake.nix detected — consume okf as an input:")}`,
      `    ${c.dim("inputs.okf.url = \"github:kriswill/okflight\";")}`,
      `    ${c.dim("inputs.okf.inputs.nixpkgs.follows = \"nixpkgs\";  # then expose inputs.okf.packages.<system>.okf")}`,
    );
  console.log(["", `Workspace set up at ${cwd}`, "", "Next steps:", ...steps].join("\n"));
}
