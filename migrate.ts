// okf migrate — the driver around migrate-doc.ts: walks the bundle, prints a
// per-file change summary (dry run) or rewrites the files (--write), and bumps
// the root index.md okf_version. See migrate-doc.ts for what changes and why.

import { writeFileSync } from "node:fs";
import { loadContext } from "./config-cli";
import { c, fmToYaml, isActor, OKF_VERSION, parseDoc, walkMd, type FM } from "./lib";
import { migrateDoc } from "./migrate-doc";
import { resolveActor } from "./scaffold-api";

const WRITE = process.argv.includes("--write");
const actorFlag = process.argv.find((a) => a.startsWith("--actor="))?.slice("--actor=".length);
const { bundle, cfg } = loadContext();
const reserved = new Set(cfg.profile.reservedFiles);
const actor = actorFlag || resolveActor(cfg);
if (!isActor(actor)) {
  console.error(`migrate: --actor '${actor}' is not an OKF actor (human:<id> | process:<id> | <producer>/<version>)`);
  process.exit(1);
}

const changes: { rel: string; notes: string[]; next: string }[] = [];
const leftovers: string[] = [];
for (const rel of walkMd(bundle)) {
  const doc = parseDoc(bundle, rel);
  const base = rel.split("/").pop()!;
  if (doc.fmError) {
    leftovers.push(`${rel}: frontmatter error — ${doc.fmError} (fix by hand)`);
    continue;
  }
  if (reserved.has(base)) {
    if (rel === "index.md" && doc.fm && doc.fm.okf_version !== undefined && String(doc.fm.okf_version) !== OKF_VERSION) {
      const fm: FM = { ...doc.fm, okf_version: OKF_VERSION };
      changes.push({ rel, notes: [`okf_version ${String(doc.fm.okf_version)} -> ${OKF_VERSION}`], next: fmToYaml(fm) + doc.body });
    }
    continue;
  }
  if (!doc.fm) continue; // missing frontmatter is validate's to report
  const m = migrateDoc(doc.fm, doc.body, actor);
  if (m) changes.push({ rel, notes: m.notes, next: fmToYaml(m.fm) + m.body });
}

for (const ch of changes) {
  console.log(`${WRITE ? c.green("~") : c.yellow("~")} ${ch.rel}`);
  for (const n of ch.notes) console.log(`    ${n}`);
  if (WRITE) writeFileSync(`${bundle}/${ch.rel}`, ch.next);
}
for (const l of leftovers) console.log(`${c.yellow("!")} ${l}`);
if (!changes.length) console.log(`migrate: nothing to do — bundle is already OKF v${OKF_VERSION}`);
else if (WRITE) console.log(`\nmigrate: ${changes.length} file(s) rewritten — run okf index && okf validate`);
else console.log(`\nmigrate: ${changes.length} file(s) would change (dry run) — re-run with --write to apply`);
process.exit(leftovers.length ? 1 : 0);
