// This repo's okf scaffolder — the repo-specific metadata pass, invoked by
// `okf scaffold` via okflight.toml `[scaffold] script`. The default export
// receives the injected ScaffoldContext (vendored type surface:
// ./scaffold-api.d.ts) — dependency injection, so this module needs NO
// runtime import from an okflight checkout: node/bun builtins only, no own
// node_modules. Idempotence, --force, and the written/skipped summary are
// owned by ctx.emit. Lives under _okflight/scripts/ beside the bundle: the
// `_` prefix keeps it out of okf's bundle walk, so the bundle itself stays
// pure markdown. As passes grow, split them into one file per scaffolded
// type beside this entry.

import type { ScaffoldContext } from "./scaffold-api";

export default async function scaffold(ctx: ScaffoldContext) {
  ctx.log(`scaffold pass for ${ctx.bundleDir}/ — nothing configured yet (edit ${ctx.bundleDir}/_okflight/scripts/main.ts)`);

  // Emit one concept doc per source component the bundle should catalog, e.g.:
  //
  //   for (const path of ctx.vcs.trackedFiles()) {
  //     if (!path.startsWith("src/services/") || !path.endsWith(".py")) continue;
  //     const name = path.split("/").pop()!.replace(/\.py$/, "");
  //     const blurb = ctx.leadingComment(readFileSync(join(ctx.root, path), "utf8"), "#");
  //     ctx.emit(
  //       `services/${name}.md`,
  //       {
  //         type: "Service",
  //         title: ctx.titleFromSlug(name),
  //         description: ctx.firstSentence(blurb ?? ctx.titleFromSlug(name)),
  //         resource: path,
  //         timestamp: ctx.timestamp(path),
  //       },
  //       `${ctx.mdSafe(ctx.sentence(blurb ?? ""))}\n\n## Source\n\n- Source: [\`${path}\`](../../${path})`,
  //     );
  //   }
  //
  // ctx.emit skips existing docs unless --force, so hand enrichment survives
  // re-runs. Simple glob→doc passes fit better as declarative
  // [[scaffold.collect]] entries in okflight.toml — reserve this script for
  // logic templates can't express.
}
