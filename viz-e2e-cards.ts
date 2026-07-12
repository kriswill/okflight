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
  await settle(page);
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

  console.log("3. focused layout: directional ring 1");
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.select("hub", false);
  });
  await settle(page);
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
  await settle(page);
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
  await settle(page);
  l = (await layout(page))!;
  check("hops off: back to one ring", l.cards.every((c) => c.ring < 2));

  console.log("5. type filter drops cards (deep-link path)");
  await page.evaluate(() => {
    location.hash = "#c/hub?hide=Reference&view=cards";
  });
  await settle(page);
  l = (await layout(page))!;
  check("hidden type's card gone", !l.byId["out-c"] && eq(l.cards.filter((c) => c.lane === "out").map((c) => c.id), ["out-d"]));
  await page.evaluate(() => {
    location.hash = "#c/hub?view=cards";
  });
  await settle(page);

  console.log("6. real mouse click on a card refocuses");
  const p = await okf<{ x: number; y: number }>(page, 'window.__okf.cards.project("in-a")');
  await page.mouse.click(p.x, p.y);
  await settle(page);
  l = (await layout(page))!;
  check("clicked card is the new focus", l.focusId === "in-a");
  check("old focus flows out of the new one", l.cards.some((c) => c.id === "hub" && c.lane === "out"));
  check("hash follows the refocus", await page.evaluate(() => location.hash === "#c/in-a?view=cards"));

  console.log("7. reload restores the cards view from the URL");
  await page.reload();
  await waitInteractive(page);
  await settle(page);
  l = (await layout(page))!;
  check("view + focus survive reload", (await okf(page, "window.__okf.view")) === "cards" && l.focusId === "in-a");

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
