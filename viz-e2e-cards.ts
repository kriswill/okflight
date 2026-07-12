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
    "root out-row: concept cards first, then one dir card per bundle",
    (() => {
      const out = l.cards.filter((c) => c.lane === "out");
      const cards = out.filter((c) => c.kind === "card").map((c) => c.id);
      const dirs = out.filter((c) => c.kind === "dir").map((c) => c.id);
      return (
        cards.length === 9 &&
        cards.includes("hub") &&
        cards.includes("island") &&
        eq(dirs, [
          "decisions",
          "experiments",
          "glossary",
          "notes",
          "patterns",
          "playbooks",
          "references",
          "runbooks",
          "services",
        ])
      );
    })(),
    JSON.stringify(l.cards.map((c) => [c.id, c.kind])),
  );
  check("root view has no in-row", l.cards.every((c) => c.lane !== "in"));

  console.log("2a. the focused index.md reads in the details panel");
  check(
    "root focus renders the root index.md",
    await page.evaluate(() => document.querySelector("#panel .md-doc h3")?.textContent === "knowledge"),
  );
  const linked = await page.evaluate(() => {
    const a = document.querySelector('#panel a[data-bundle="decisions"]') as HTMLElement | null;
    a?.click();
    return !!a;
  });
  check("subdirectory listing links are bundle navigations", linked);
  await settleMotion(page);
  l = (await layout(page))!;
  check("panel link refocuses onto the bundle", l.focusId === "decisions");
  check(
    "bundle focus renders its own index.md",
    await page.evaluate(() => document.querySelector("#panel .md-doc h3")?.textContent === "decisions"),
  );
  await page.click("#panel .close");
  await settle(page);
  l = (await layout(page))!;
  check(
    "closing the index panel dismisses it without changing focus",
    l.focusId === "decisions" && (await page.evaluate(() => !document.querySelector("#panel"))),
  );
  await page.evaluate(() => {
    location.hash = "#?view=cards"; // back to the root focus (a clear, not a navigation)
  });
  await settleMotion(page);
  check(
    "a non-navigation clear keeps the panel dismissed",
    await page.evaluate(() => !document.querySelector("#panel")),
  );

  console.log("2b. dir cards are bundle indexes: click focuses the bundle, root card walks back");
  const dirPt = await okf<{ x: number; y: number }>(page, 'window.__okf.cards.project("decisions")');
  await page.mouse.click(dirPt.x, dirPt.y);
  await settleMotion(page);
  l = (await layout(page))!;
  check(
    "clicked dir card becomes the bundle focus",
    l.focusId === "decisions" && l.rootFocus === false && l.byId["decisions"]?.kind === "focus",
  );
  check("root card sits in the in-row", l.byId[""]?.kind === "root" && l.byId[""]?.lane === "in");
  check(
    "bundle out-row lists the bundle's concepts",
    l.cards.filter((c) => c.lane === "out" && c.ring === 1).length === 18 && !!l.byId["decisions/adr-001"],
  );
  check("hash records the bundle focus", await page.evaluate(() => location.hash === "#b/decisions?view=cards"));
  const rootPt = await okf<{ x: number; y: number }>(page, 'window.__okf.cards.project("")');
  await page.mouse.click(rootPt.x, rootPt.y);
  await settleMotion(page);
  l = (await layout(page))!;
  check("clicking the root in-card returns to the root focus", l.rootFocus === true);

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

  console.log("6b. band scrolling on the mega-hub (wheel + drag under the mouse, no orbit)");
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.select("services/core-platform", false);
  });
  await settleMotion(page);
  l = (await layout(page))!;
  check("mega-hub keeps every in-link on one scrollable band (no grid)", l.cards.filter((c) => c.lane === "in" && c.ring === 1).length === 29);
  check("focus keeps full scale on the mega-hub (zoom pinned at 1)", (await okf(page, "window.__okf.cards.zoom")) === 1);
  type Ovf = { lane: string; dir: number; count: number }[];
  const ovf = await okf<Ovf>(page, "window.__okf.cards.overflow");
  const neg0 = ovf.find((o) => o.lane === "in" && o.dir === -1)?.count ?? 0;
  const pos0 = ovf.find((o) => o.lane === "in" && o.dir === 1)?.count ?? 0;
  check("overflow chips flag hidden cards on both band edges", neg0 > 0 && pos0 > 0 && neg0 + pos0 < 29, JSON.stringify(ovf));
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.cards.scrollBy("in", 232); // exactly one card pitch
  });
  const ovf2 = await okf<Ovf>(page, "window.__okf.cards.overflow");
  check(
    "chip counts track the scroll",
    (ovf2.find((o) => o.lane === "in" && o.dir === -1)?.count ?? 0) === neg0 + 1 &&
      (ovf2.find((o) => o.lane === "in" && o.dir === 1)?.count ?? 0) === pos0 - 1,
    JSON.stringify(ovf2),
  );
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.cards.scrollBy("in", -232);
  });
  const focusBefore = await okf<{ x: number; y: number }>(page, 'window.__okf.cards.project("services/core-platform")');
  // Wheel over the in-band (above the focus card).
  await page.mouse.move(focusBefore.x, focusBefore.y - 220);
  await page.mouse.wheel({ deltaY: 400 });
  const afterWheel = await okf<{ in: number; out: number }>(page, "window.__okf.cards.scroll");
  check("wheel over the in-band scrolls it", Math.abs(afterWheel.in) > 50);
  check("wheel never scrolls the other band", afterWheel.out === 0);
  const focusAfter = await okf<{ x: number; y: number }>(page, 'window.__okf.cards.project("services/core-platform")');
  check("the focus card never moves while scrolling", Math.hypot(focusAfter.x - focusBefore.x, focusAfter.y - focusBefore.y) < 1);
  // Drag the in-band: content follows the pointer; a drag never selects.
  await page.mouse.move(focusBefore.x, focusBefore.y - 220);
  await page.mouse.down();
  await page.mouse.move(focusBefore.x + 180, focusBefore.y - 220, { steps: 6 });
  await page.mouse.up();
  const afterDrag = await okf<{ in: number; out: number }>(page, "window.__okf.cards.scroll");
  check("dragging the band scrolls it", Math.abs(afterDrag.in - afterWheel.in) > 50);
  check("a band drag never selects", (await layout(page))!.focusId === "services/core-platform");
  // A sub-threshold press on a visible band card still selects, and resets
  // the scroll. Pick whichever in-card currently sits nearest the window
  // center (long bands fade their far cards out).
  const centerCard = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const okf = (window as any).__okf;
    const inCards = okf.cards.layout.cards.filter(
      (c: { lane: string; ring: number }) => c.lane === "in" && c.ring === 1,
    );
    const scrolled = okf.cards.scroll.in;
    inCards.sort(
      (a: { x: number }, b: { x: number }) => Math.abs(a.x - scrolled) - Math.abs(b.x - scrolled),
    );
    const id = inCards[0].id;
    return { id, px: okf.cards.project(id) };
  });
  await page.mouse.move(centerCard.px.x, centerCard.px.y);
  await page.mouse.down();
  await page.mouse.move(centerCard.px.x + 2, centerCard.px.y + 1);
  await page.mouse.up();
  await settleMotion(page);
  check("a sub-threshold press still selects", (await layout(page))!.focusId === centerCard.id);
  const scrollAfter = await okf<{ in: number; out: number }>(page, "window.__okf.cards.scroll");
  check("refocus resets band scrolls", scrollAfter.in === 0 && scrollAfter.out === 0);
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.select("in-a", false);
  });
  await settleMotion(page);

  console.log("6c. flow toggle reorients the layout with an animated transition");
  const animatedFlowToggle = await page.evaluate(
    () =>
      new Promise((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const okf = (window as any).__okf;
        okf.setFlow("h");
        requestAnimationFrame(() => resolve(okf.cards.settled === false));
      }),
  );
  check("flow toggle animates cards to their new positions", animatedFlowToggle === true);
  await settleMotion(page);
  l = (await layout(page))!;
  check(
    "horizontal flow: in-links left, out-links right",
    l.cards.filter((c) => c.lane === "in").every((c) => c.x < 0) &&
      l.cards.filter((c) => c.lane === "out").every((c) => c.x > 0) &&
      l.byId[l.focusId]!.x === 0,
  );
  check("hash carries flow=h", await page.evaluate(() => location.hash.includes("flow=h")));
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__okf.setFlow("v");
  });
  await settleMotion(page);
  check("back to vertical: flow param drops from the hash", await page.evaluate(() => !location.hash.includes("flow")));

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

  console.log("7c. bundle deep link applies and survives reload");
  await page.evaluate(() => {
    location.hash = "#b/notes?view=cards";
  });
  await settleMotion(page);
  l = (await layout(page))!;
  check("hash navigation focuses the bundle", l.focusId === "notes");
  await page.reload();
  await waitInteractive(page);
  await settleMotion(page);
  l = (await layout(page))!;
  check(
    "bundle focus survives reload",
    (await okf(page, "window.__okf.view")) === "cards" && l.focusId === "notes",
  );

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
