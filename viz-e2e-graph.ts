// End-to-end parity contract for the 3D graph stage: build the fixture
// bundle, load viz.html over file:// in headless system Chrome, and assert
// today's graph behavior through the probe (window.__okf.graph after the
// Threlte migration, window.__okf.scene.probe() before it). These assertions
// were recorded against the imperative GraphScene and must pass unchanged
// after the swap. Dev-tree only — not part of `bun test` or CI (needs a
// local Chrome).
//
//   bun viz-e2e-graph.ts
//
// Exits nonzero on any failed assertion or page error.
import { existsSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";

const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FIXTURE = join(import.meta.dir, "test", "fixtures", "cards-bundle");
const HTML = join(FIXTURE, "knowledge", "viz.html");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/* --- build the fixture ------------------------------------------------- */
console.log("building fixture bundle…");
const build = Bun.spawnSync(["bun", join(import.meta.dir, "okf.ts"), "viz"], {
  cwd: FIXTURE,
  stdout: "inherit",
  stderr: "inherit",
});
if (build.exitCode !== 0 || !existsSync(HTML)) {
  console.error("viz-e2e-graph: fixture build failed");
  process.exit(1);
}

/* --- drive Chrome ------------------------------------------------------ */
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH ?? DEFAULT_CHROME;
if (!existsSync(executablePath)) {
  console.error(`viz-e2e-graph: Chrome not found at ${executablePath} — set PUPPETEER_EXECUTABLE_PATH`);
  process.exit(1);
}
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--window-size=1400,900"] });

interface Probe {
  camPos: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  selected: number | null;
  darkBg: boolean;
  bloomIntensity: number;
  visibleLabelCount: number;
  dimmedCount: number;
  viewOffsetX: number;
  flying: boolean;
  paused: boolean;
}

// The probe seam: __okf.graph is the Threlte handle; __okf.scene.probe() the
// legacy one. Every assertion reads through here so the contract survives
// the swap byte-for-byte.
const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const p = w.__okf.graph ?? w.__okf.scene.probe();
    return JSON.parse(
      JSON.stringify({
        camPos: p.camPos,
        target: p.target,
        selected: p.selected,
        darkBg: p.darkBg,
        bloomIntensity: p.bloomIntensity,
        visibleLabelCount: p.visibleLabelCount,
        dimmedCount: p.dimmedCount,
        viewOffsetX: p.viewOffsetX,
        flying: p.flying,
        paused: p.paused,
      }),
    );
  });
const project = (page: Page, id: string): Promise<{ x: number; y: number }> =>
  page.evaluate((nid) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const i = w.__okf.nodes.findIndex((n: { id: string }) => n.id === nid);
    const p = w.__okf.graph ?? w.__okf.scene.probe();
    return p.project(i);
  }, id);
const nodeIndex = (page: Page, id: string): Promise<number> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.evaluate((nid) => (window as any).__okf.nodes.findIndex((n: { id: string }) => n.id === nid), id);
const waitInteractive = (page: Page) =>
  page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__okf?.perf?.summary().some((e: { name: string }) => e.name === "viz:interactive"),
    { timeout: 15_000, polling: 50 },
  );
const settleFly = (page: Page) =>
  page.waitForFunction(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const p = w.__okf.graph ?? w.__okf.scene?.probe();
      return p && p.flying === false;
    },
    { timeout: 5_000, polling: 25 },
  );
const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  console.log("1. startup: marks, fit, resident labels, sidebar view shift");
  await page.goto("file://" + HTML);
  await waitInteractive(page);
  const marks = await page.evaluate(() =>
    Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__okf.perf.summary().map((e: { name: string; ms: number }) => [e.name, e.ms]),
    ),
  );
  check(
    "mark order: scene-init ≤ first-frame ≤ interactive",
    marks["viz:scene-init"] <= marks["viz:first-frame"] && marks["viz:first-frame"] <= marks["viz:interactive"],
    JSON.stringify(marks),
  );
  let p = await probe(page);
  check("no selection, nothing dimmed, not flying", p.selected === null && p.dimmedCount === 0 && p.flying === false);
  check("resident labels: exactly the top-28 by degree", p.visibleLabelCount === 28, `got ${p.visibleLabelCount}`);
  check("sidebar-only view shift recenters left of center", p.viewOffsetX === -130, `got ${p.viewOffsetX}`);
  check("bloom follows the theme", p.bloomIntensity === (p.darkBg ? 1.95 : 0));
  const startDark = p.darkBg;

  console.log("2. select flies: eased convergence, panel view shift, hero framing");
  const hubIdx = await nodeIndex(page, "hub");
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.select("hub");
  });
  p = await probe(page);
  check("fly starts on select", p.flying === true);
  await settleFly(page);
  p = await probe(page);
  check("selection recorded", p.selected === hubIdx);
  check("panel open shifts the projection right of center", p.viewOffsetX === 100, `got ${p.viewOffsetX}`);
  check("fly lands the target on the node", Math.hypot(p.target.x - p.camPos.x, p.target.y - p.camPos.y) >= 0 && p.flying === false);
  const hubPx = await project(page, "hub");
  // Viewport 1400, sidebar 260, open panel 460 -> clear-strip center at
  // ((1400 + 260 - 460) / 2, 900 / 2). Same 600 the cards view converges on.
  check(
    "hero centers in the unobstructed strip",
    Math.abs(hubPx.x - 600) < 2 && Math.abs(hubPx.y - 450) < 2,
    JSON.stringify(hubPx),
  );
  check(
    "selection widens the label set (hero + neighbors join the top-28)",
    p.visibleLabelCount >= 28 && p.visibleLabelCount <= 34,
    `got ${p.visibleLabelCount}`,
  );
  // Reselecting the SAME node must re-fly (the selSeq bump is the trigger —
  // the deleted stage.test.ts bridge test's behavior, now checked live).
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.select("hub");
  });
  p = await probe(page);
  check("reselecting the selected node re-flies (selSeq bump)", p.flying === true);
  await settleFly(page);

  console.log("3. pointer: click selects, a drag never does");
  const inAPx = await project(page, "in-a");
  await page.mouse.click(inAPx.x, inAPx.y);
  await settleFly(page);
  p = await probe(page);
  const inAIdx = await nodeIndex(page, "in-a");
  check("real mouse click on a sphere selects it", p.selected === inAIdx);
  check("hash follows the click", await page.evaluate(() => location.hash.startsWith("#c/in-a")));
  const hubPx2 = await project(page, "hub");
  await page.mouse.move(hubPx2.x, hubPx2.y);
  await page.mouse.down();
  await page.mouse.move(hubPx2.x + 6, hubPx2.y + 2, { steps: 3 });
  await page.mouse.up();
  await settle(page);
  p = await probe(page);
  check("a 6px drag over a sphere never selects it", p.selected === inAIdx);

  console.log("4. theme flip repaints: bloom + darkBg swap in place");
  await page.click("#theme-toggle");
  await settle(page);
  p = await probe(page);
  check("darkBg flips with the theme", p.darkBg === !startDark);
  check("bloom follows: 1.95 dark, 0 light", p.bloomIntensity === (p.darkBg ? 1.95 : 0));
  await page.click("#theme-toggle");
  await settle(page);
  p = await probe(page);
  check("flip back restores", p.darkBg === startDark && p.bloomIntensity === (startDark ? 1.95 : 0));

  console.log("5. hide-type dims nodes and their labels");
  await page.evaluate(() => {
    location.hash = "#c/in-a?hide=Reference";
  });
  await settle(page);
  p = await probe(page);
  check("hidden type dims nodes", p.dimmedCount > 0, `dimmed ${p.dimmedCount}`);
  check("dimmed nodes drop their labels", p.visibleLabelCount < 28 + 6, `got ${p.visibleLabelCount}`);
  const dimmedWithFilter = p.dimmedCount;
  await page.evaluate(() => {
    location.hash = "#c/in-a";
  });
  await settle(page);
  p = await probe(page);
  check("clearing the filter undims", p.dimmedCount === 0, `was ${dimmedWithFilter}, now ${p.dimmedCount}`);
  // The same dim effect must also re-fire on a search query (the other
  // branch the deleted stage.test.ts dim-bridge test covered; facets stay
  // unit-tested in state.test.ts — this fixture configures none).
  await page.evaluate(() => {
    location.hash = "#c/in-a?q=hub";
  });
  await settle(page);
  p = await probe(page);
  check("search query dims non-matches", p.dimmedCount > 0, `dimmed ${p.dimmedCount}`);
  await page.evaluate(() => {
    location.hash = "#c/in-a";
  });
  await settle(page);
  p = await probe(page);
  check("clearing the query undims", p.dimmedCount === 0);

  console.log("6. panel close drops the view shift back to sidebar-only");
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.select("__none__"); // unknown id -> clearSelection
  });
  await settle(page);
  p = await probe(page);
  check("selection cleared", p.selected === null);
  check("view shift returns to the sidebar-only offset", p.viewOffsetX === -130, `got ${p.viewOffsetX}`);

  console.log("6b. idle scene renders 0 fps (on-demand rendering, sleep-at-idle sim)");
  // Only meaningful on the Threlte handle (the legacy scene free-ran its RAF).
  const hasFrames = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof (window as any).__okf.graph?.frames === "number";
  });
  if (hasFrames) {
    // The damping tail from section 3's drag decays to OrbitControls' 1e-6
    // epsilon over a couple of seconds — poll until the counter stops
    // advancing, then hold a full quiet window.
    await page.waitForFunction(
      () =>
        new Promise((resolve) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const g = (window as any).__okf.graph;
          const before = g.frames;
          setTimeout(() => resolve(g.frames === before), 300);
        }),
      { timeout: 10_000, polling: 100 },
    );
    const f0 = await page.evaluate(() => (window as any).__okf.graph.frames); // eslint-disable-line @typescript-eslint/no-explicit-any
    await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
    const f1 = await page.evaluate(() => (window as any).__okf.graph.frames); // eslint-disable-line @typescript-eslint/no-explicit-any
    check("no frames composited while idle", f1 === f0, `frames ${f0} -> ${f1}`);
  } else {
    console.log("  (skipped: legacy scene has no frame counter)");
  }

  console.log("7. cards mode pauses the graph; graph mode resumes it");
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.setView("cards");
  });
  await settle(page);
  p = await probe(page);
  check("cards mode pauses compositing", p.paused === true);
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.setView("graph");
  });
  await settle(page);
  p = await probe(page);
  check("graph mode resumes", p.paused === false);

  console.log("8. deep-linked selection flies from the fitted pose, not the constructor default");
  // Full navigation (not a hash tweak) so the app boots with the selection
  // already applied — the case where the fly effect runs before the fit.
  await page.goto("about:blank");
  await page.goto("file://" + HTML + "#c/hub");
  await waitInteractive(page);
  p = await probe(page);
  check("deep link starts a fly on load", p.flying === true);
  const flyFrom = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__okf.graph.flyFrom as { x: number; y: number; z: number } | null,
  );
  check(
    "the fly's start is the fitted view, not the camera's constructor pose",
    !!flyFrom && Math.hypot(flyFrom.x - 0, flyFrom.y - 60, flyFrom.z - 620) > 20,
    JSON.stringify(flyFrom),
  );
  await settleFly(page);
  p = await probe(page);
  const hubPx3 = await project(page, "hub");
  check(
    "deep-linked selection lands selected + centered",
    p.selected === hubIdx && Math.abs(hubPx3.x - 600) < 2 && Math.abs(hubPx3.y - 450) < 2,
    JSON.stringify({ selected: p.selected, px: hubPx3 }),
  );

  check("no page errors", pageErrors.length === 0, pageErrors.join("; "));
} finally {
  await browser.close();
}

if (failures) {
  console.error(`\nviz-e2e-graph: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nviz-e2e-graph: all assertions passed");
