// Regenerate index.md files throughout the bundle (OKF SPEC §8:
// progressive disclosure — one directory level at a time).
//
// Hand-maintained parts are preserved on regeneration:
//   - the bundle-root index.md frontmatter (okf_version etc.)
//   - each index.md's "blurb": prose between the top of the body and the
//     first `# ` heading, used as the directory's description in its parent.
// Everything from the first heading down is regenerated.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadContext } from "./config-cli";
import { fmToYaml, indexBlurb, OKF_VERSION, parseDoc, parseFrontmatter, statusOf, str, titleFromSlug, type FM } from "./lib";

const { bundle, cfg } = loadContext();
const bundleName = basename(cfg.viz.bundle.dir);
const reserved = new Set(cfg.profile.reservedFiles);

interface DirInfo { rel: string; blurb: string; }

function listDir(absDir: string) {
  const entries = readdirSync(absDir).filter((e) => !e.startsWith(".") && !e.startsWith("_")).sort();
  const dirs = entries.filter((e) => statSync(join(absDir, e)).isDirectory());
  const mds = entries.filter((e) => e.endsWith(".md") && !reserved.has(e));
  return { dirs, mds };
}

function existingBlurbAndFm(absIndex: string): { blurb: string; fm: FM | null; fmError: string | null } {
  if (!existsSync(absIndex)) return { blurb: "", fm: null, fmError: null };
  const { fm, fmError, body } = parseFrontmatter(readFileSync(absIndex, "utf8"));
  return { blurb: indexBlurb(body), fm, fmError };
}

function genDir(relDir: string): DirInfo {
  const absDir = join(bundle, relDir);
  const { dirs, mds } = listDir(absDir);
  const children = dirs.map((d) => genDir(relDir ? `${relDir}/${d}` : d));

  const absIndex = join(absDir, "index.md");
  const { blurb, fm, fmError } = existingBlurbAndFm(absIndex);

  const conceptLines = mds.map((f) => {
    const doc = parseDoc(bundle, relDir ? `${relDir}/${f}` : f);
    const title = str(doc.fm, "title") || titleFromSlug(f.replace(/\.md$/, ""));
    const desc = str(doc.fm, "description") || "";
    // Lifecycle (OKF §5.4) is liftable into the listing: a deprecated concept
    // stays listed (links and history) but says so before anyone opens it.
    const mark = statusOf(doc.fm) === "deprecated" ? " _(deprecated)_" : "";
    return `* [${title}](${f})${mark}${desc ? ` - ${desc}` : ""}`;
  });
  const dirLines = children.map((c) => {
    const name = c.rel.split("/").pop()!;
    const firstSentence = c.blurb.split(/(?<=\.)\s/)[0].replace(/\n/g, " ").trim();
    return `* [${name}](${name}/index.md)${firstSentence ? ` - ${firstSentence}` : ""}`;
  });

  const isRoot = relDir === "";
  const parts: string[] = [];
  if (isRoot) {
    // The root frontmatter is preserved verbatim — if it won't parse, bail
    // rather than silently overwrite it with a stub.
    if (fmError) {
      console.error(`index-gen: ${cfg.viz.bundle.dir}/index.md frontmatter is malformed (${fmError}); fix it and re-run`);
      process.exit(1);
    }
    const rootFm: FM = fm ?? { okf_version: OKF_VERSION };
    if (!rootFm.okf_version) rootFm.okf_version = OKF_VERSION; // never rewrites a declared version — that is `okf migrate`'s job
    parts.push(fmToYaml(rootFm));
  }
  parts.push(`# ${isRoot ? bundleName : relDir.split("/").pop()!}\n`);
  if (blurb) parts.push(blurb + "\n");
  if (conceptLines.length) parts.push(`## Concepts\n\n${conceptLines.join("\n")}\n`);
  if (dirLines.length) parts.push(`## Subdirectories\n\n${dirLines.join("\n")}\n`);

  writeFileSync(absIndex, parts.join("\n"));
  console.log(`  ~ ${relDir ? relDir + "/" : ""}index.md`);
  return { rel: relDir, blurb };
}

genDir("");
console.log("index-gen: done");
