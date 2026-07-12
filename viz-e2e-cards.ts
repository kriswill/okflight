// End-to-end check of the cards view: build the fixture bundle, load the
// resulting viz.html over file:// in headless system Chrome (puppeteer-core,
// same pattern as viz-perf.ts), and assert the card layout through the
// window.__okf.cards automation handle. Dev-tree only — not part of `bun
// test` or CI (needs a local Chrome).
//
//   bun viz-e2e-cards.ts
//
// Exits nonzero on any failed assertion or page error.
import { existsSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import type { CardLayout } from "./viz-app/cards/cardLayout";

const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FIXTURE = join(import.meta.dir, "test", "fixtures", "cards-bundle");
const HTML = join(FIXTURE, "knowledge", "viz.html");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* --- build the fixture ------------------------------------------------- */
console.log("building fixture bundle…");
const build = Bun.spawnSync(["bun", join(import.meta.dir, "okf.ts"), "viz"], {
  cwd: FIXTURE,
  stdout: "inherit",
  stderr: "inherit",
});
if (build.exitCode !== 0 || !existsSync(HTML)) {
  console.error("viz-e2e-cards: fixture build failed");
  process.exit(1);
}

/* --- drive Chrome ------------------------------------------------------ */
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH ?? DEFAULT_CHROME;
if (!existsSync(executablePath)) {
  console.error(`viz-e2e-cards: Chrome not found at ${executablePath} — set PUPPETEER_EXECUTABLE_PATH`);
  process.exit(1);
}
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--window-size=1400,900"] });

// The handle lives on window.__okf; page.evaluate can only return JSON.
const layout = (page: Page): Promise<CardLayout | null> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.evaluate(() => JSON.parse(JSON.stringify((window as any).__okf.cards?.layout ?? null)));
const waitInteractive = (page: Page) =>
  page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__okf?.perf?.summary().some((e: { name: string }) => e.name === "viz:interactive"),
    { timeout: 15_000, polling: 50 },
  );
const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
// Cards-view actions animate (420ms dome turn, 90ms-tau camera tween):
// wait for the motion store to report settled before asserting on poses.
const settleMotion = (page: Page) =>
  page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__okf.cards?.settled === true,
    { timeout: 5_000, polling: 25 },
  );
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const okf = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`JSON.parse(JSON.stringify(${fn}))`) as any;

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  console.log("1. default load stays on the graph view");
  await page.goto("file://" + HTML);
  await waitInteractive(page);
  check("view is graph", (await okf(page, "window.__okf.view")) === "graph");
  check("no cards handle in graph view", (await okf(page, "window.__okf.cards ?? null")) === null);

  console.log("2. cards view without a selection: synthetic root card");
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.setView("cards");
  });
  await settleMotion(page);
  let l = (await layout(page))!;
  check("root focus layout", l.rootFocus === true && l.byId[l.focusId]?.kind === "focus");
  check(
    "root out-row: index.md links in authored order, dirs as dir cards",
    eq(
      l.cards.filter((c) => c.lane === "out").map((c) => [c.id, c.kind]),
      [
        ["hub", "card"],
        ["island", "card"],
        ["notes", "dir"],
      ],
    ),
    JSON.stringify(l.cards),
  );
  check("root view has no in-row", l.cards.every((c) => c.lane !== "in"));

  console.log("3. focused layout: directional ring 1 (animated refocus)");
  const animatedDuringRefocus = await page.evaluate(
    () =>
      new Promise((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const okf = (window as any).__okf;
        okf.select("hub", false);
        // The retarget lands on the effect flush; probe one frame later,
        // well inside the 420ms dome turn.
        requestAnimationFrame(() => resolve(okf.cards.settled === false));
      }),
  );
  check("refocus starts a transition", animatedDuringRefocus === true);
  await settleMotion(page);
  check(
    "focus pose lands exactly at the pole (origin + lift)",
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const okf = (window as any).__okf;
      const p = okf.cards.pose("hub");
      return okf.cards.progress === 1 && Math.abs(p.x) < 1e-3 && Math.abs(p.y) < 1e-3 && Math.abs(p.z - 6) < 1e-3;
    }),
  );
  l = (await layout(page))!;
  check("focus card centered", l.focusId === "hub" && l.byId["hub"]!.x === 0 && l.byId["hub"]!.y === 0);
  check(
    "in-links above (title-sorted, mutual joins in-row)",
    eq(
      l.cards.filter((c) => c.lane === "in").map((c) => c.id),
      ["both-e", "in-a", "in-b"],
    ) && l.cards.filter((c) => c.lane === "in").every((c) => c.y > 0),
  );
  check(
    "out-links below",
    eq(
      l.cards.filter((c) => c.lane === "out").map((c) => c.id),
      ["out-c", "out-d"],
    ) && l.cards.filter((c) => c.lane === "out").every((c) => c.y < 0),
  );
  check("island never appears", !l.byId["island"]);
  const twoWay = l.arrows.filter((a) => a.twoWay);
  check("mutual link: one two-headed arrow in the in-row", twoWay.length === 1 && twoWay[0]!.fromId === "both-e" && twoWay[0]!.tailHead !== null);
  check("every arrow head points down (wings above tip)", l.arrows.every((a) => a.head.left.y > a.head.tip.y));

  console.log("4. hops honored: 2-hop adds the directional second ring");
  await page.evaluate(() => {
    [...document.querySelectorAll("#isolate .seg")].find((b) => b.textContent!.trim() === "2-hop")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settleMotion(page);
  l = (await layout(page))!;
  check("hash carries isolate + view", await page.evaluate(() => location.hash.includes("isolate=2") && location.hash.includes("view=cards")));
  check(
    "ring 2 above: in-of-in under its ring-1 parent",
    eq(l.cards.filter((c) => c.ring === 2 && c.lane === "in").map((c) => [c.id, c.parentId]), [["in2-f", "in-a"]]),
  );
  check(
    "ring 2 below: out-of-out under its ring-1 parent",
    eq(l.cards.filter((c) => c.ring === 2 && c.lane === "out").map((c) => [c.id, c.parentId]), [["out2-g", "out-c"]]),
  );
  await page.evaluate(() => {
    [...document.querySelectorAll("#isolate .seg")].find((b) => b.textContent!.trim() === "off")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settleMotion(page);
  l = (await layout(page))!;
  check("hops off: back to one ring", l.cards.every((c) => c.ring < 2));

  console.log("5. type filter drops cards (deep-link path)");
  await page.evaluate(() => {
    location.hash = "#c/hub?hide=Reference&view=cards";
  });
  await settleMotion(page);
  l = (await layout(page))!;
  check("hidden type's card gone", !l.byId["out-c"] && eq(l.cards.filter((c) => c.lane === "out").map((c) => c.id), ["out-d"]));
  await page.evaluate(() => {
    location.hash = "#c/hub?view=cards";
  });
  await settleMotion(page);

  console.log("6. real mouse click on a card refocuses");
  const p = await okf<{ x: number; y: number }>(page, 'window.__okf.cards.project("in-a")');
  await page.mouse.click(p.x, p.y);
  await settleMotion(page);
  l = (await layout(page))!;
  check("clicked card is the new focus", l.focusId === "in-a");
  check("old focus flows out of the new one", l.cards.some((c) => c.id === "hub" && c.lane === "out"));
  check("hash follows the refocus", await page.evaluate(() => location.hash === "#c/in-a?view=cards"));
  check(
    "cards that rolled out are gone after settle",
    (await okf(page, 'window.__okf.cards.pose("out-d") ?? null')) === null,
  );
  check(
    "panel inset honored: focus centers in the unobstructed region (camera tween settled)",
    await page.evaluate(() => {
      // viewport 1400, sidebar 260, open panel 460 -> center at (1400+260-460)/2.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (window as any).__okf.cards.project("in-a");
      return Math.abs(p.x - 600) < 2;
    }),
  );

  console.log("6b. dragging the dome reorients without selecting");
  await page.mouse.move(700, 840);
  await page.mouse.down();
  await page.mouse.move(820, 880, { steps: 8 });
  await page.mouse.up();
  const dragState = await okf<{ yaw: number; pitch: number }>(page, "window.__okf.cards.drag");
  check("drag rotates the dome", Math.abs(dragState.yaw) > 0.01);
  check("a drag never selects", (await layout(page))!.focusId === "in-a");
  const jiggleTarget = await okf<{ x: number; y: number }>(page, 'window.__okf.cards.project("hub")');
  await page.mouse.move(jiggleTarget.x, jiggleTarget.y);
  await page.mouse.down();
  await page.mouse.move(jiggleTarget.x + 2, jiggleTarget.y + 1);
  await page.mouse.up();
  await settleMotion(page);
  check("a sub-threshold press still selects (through the dragged pose)", (await layout(page))!.focusId === "hub");
  const dragAfter = await okf<{ yaw: number; pitch: number }>(page, "window.__okf.cards.drag");
  check("refocus renormalizes the drag to neutral", Math.abs(dragAfter.yaw) < 1e-9 && Math.abs(dragAfter.pitch) < 1e-9);
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.select("in-a", false);
  });
  await settleMotion(page);

  console.log("7. reload restores the cards view from the URL");
  await page.reload();
  await waitInteractive(page);
  await settleMotion(page);
  l = (await layout(page))!;
  check("view + focus survive reload", (await okf(page, "window.__okf.view")) === "cards" && l.focusId === "in-a");

  console.log("7b. prefers-reduced-motion snaps refocus");
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  // Remount the cards scene so the motion store re-reads the media query.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const okf = (window as any).__okf;
    okf.setView("graph");
    okf.setView("cards");
  });
  await settleMotion(page);
  check(
    "reduced motion: refocus settles on the same tick",
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const okf = (window as any).__okf;
      okf.select("hub", false);
      return okf.cards.settled === true;
    }),
  );
  await page.emulateMediaFeatures([]);

  console.log("8. toggle back to the 3D graph");
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.setView("graph");
  });
  await settle(page);
  check("graph host visible again", await page.evaluate(() => !document.getElementById("graph-host")!.classList.contains("hidden")));
  check("cards handle removed", (await okf(page, "window.__okf.cards ?? null")) === null);
  check("graph scene alive", await page.evaluate(() => !!(window as any).__okf.scene)); // eslint-disable-line @typescript-eslint/no-explicit-any

  check("no page errors", pageErrors.length === 0, pageErrors.join("; "));
} finally {
  await browser.close();
}

if (failures) {
  console.error(`\nviz-e2e-cards: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nviz-e2e-cards: all assertions passed");
