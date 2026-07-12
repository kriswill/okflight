// The motion store is the single source of per-frame truth: flat layout
// coordinates tweened by transitions, mapped through the cylinder, composed
// with per-band scroll offsets, and faded by the scroll window — all stepped
// with explicit dt so every behavior pins down deterministically under bun
// test with no Threlte and no clock.
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildModel } from "../data";
import { cfg, node } from "../test-helpers";
import { edgeTangent } from "./arrowFrame";
import { BAND_Y, cardGraph, FOCUS_Z, layoutCards } from "./cardLayout";
import { arcFade, cylPose, FADE_END, FADE_START } from "./cylinder";
import { createCardMotion, HEAD_H } from "./motion.svelte";
import { DURATION_MS, easeOutCubic } from "./transition";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

const model = buildModel({
  nodes: [
    node("f", "Decision", "Focus"),
    node("a", "Pattern", "Alpha"),
    node("b", "Playbook", "Bravo"),
    node("c", "Reference", "Charlie"),
  ],
  edges: [
    { s: "a", t: "f" },
    { s: "f", t: "b" },
    { s: "c", t: "a" },
  ],
  cfg: cfg(),
});
const all = () => true;
const layoutF = () => layoutCards(cardGraph(model, "f", 1, all)!);
const layoutF2 = () => layoutCards(cardGraph(model, "f", 2, all)!);
const layoutA = () => layoutCards(cardGraph(model, "a", 1, all)!);

// A hub wide enough that its in-band extends past the fade window.
const wideModel = buildModel({
  nodes: [
    node("f", "Decision", "Focus"),
    ...Array.from({ length: 13 }, (_, i) => node(`n${String(i).padStart(2, "0")}`, "Pattern", `N${i}`)),
    node("gp", "Reference", "Grandparent"), // links into n00 (ring 2)
  ],
  edges: [
    ...Array.from({ length: 13 }, (_, i) => ({ s: `n${String(i).padStart(2, "0")}`, t: "f" })),
    { s: "gp", t: "n00" },
  ],
  cfg: cfg(),
});
const wideLayout = () => layoutCards(cardGraph(wideModel, "f", 2, all)!);

describe("first layout & settled state", () => {
  test("first setLayout settles instantly at cylinder poses", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    expect(m.settled).toBe(true);
    const f = m.sample("f")!;
    close(f.pos.x, 0, 1e-6);
    close(f.pos.y, 0, 1e-6);
    close(f.pos.z, FOCUS_Z, 1e-6);
    const flatA = layoutF().byId["a"]!;
    const expected = cylPose(flatA.x, flatA.y, flatA.z, "v");
    expect(m.sample("a")!.pos.distanceTo(expected.pos)).toBeLessThan(1e-6);
    expect(m.renderList.map((r) => r.id).sort()).toEqual(["a", "b", "f"]);
  });

  test("settled arrows satisfy the glue invariant against cylinder poses", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    for (const a of m.arrowStates()) {
      const from = m.sample(a.fromId)!;
      const anchorWorld = new THREE.Vector3(a.fromLocal.x, a.fromLocal.y, 0)
        .applyQuaternion(from.quat)
        .add(from.pos);
      expect(a.path[0]!.distanceTo(anchorWorld)).toBeLessThan(1e-9);
      close(a.opacity, 0.85);
    }
  });

  test("setLayout(null) clears everything and stays settled", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.setLayout(null);
    expect(m.settled).toBe(true);
    expect(m.renderList).toEqual([]);
    expect(m.sample("f")).toBeNull();
  });
});

describe("refocus transition", () => {
  const start = () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.setLayout(layoutA());
    return m;
  };

  test("keeps exiting cards mounted, settles exactly at the duration", () => {
    const m = start();
    expect(m.settled).toBe(false);
    expect(m.renderList.find((r) => r.id === "b")!.exiting).toBe(true);
    for (let i = 0; i < 41; i++) m.step(10);
    expect(m.settled).toBe(false);
    m.step(10);
    expect(m.settled).toBe(true);
    expect(m.sample("b")).toBeNull();
    const flat = layoutA();
    for (const id of ["a", "c", "f"]) {
      const p = flat.byId[id]!;
      const expected = cylPose(p.x, p.y, p.z, "v");
      expect(m.sample(id)!.pos.distanceTo(expected.pos)).toBeLessThan(1e-6);
    }
  });

  test("progress reports the eased curve; deterministic stepping", () => {
    const m1 = start();
    const m2 = start();
    for (let i = 0; i < 21; i++) m1.step(10);
    close(m1.progress, easeOutCubic(210 / DURATION_MS), 1e-9);
    for (let i = 0; i < 21; i++) m1.step(10);
    m2.step(DURATION_MS);
    for (const id of ["a", "f", "c"]) {
      expect(m1.sample(id)!.pos.distanceTo(m2.sample(id)!.pos)).toBeLessThan(1e-9);
    }
  });

  test("interrupt retargets from the live mid-flight state", () => {
    const m = start();
    for (let i = 0; i < 15; i++) m.step(10);
    const live = m.sample("a")!.pos.clone();
    m.setLayout(layoutF());
    expect(m.settled).toBe(false);
    expect(m.sample("a")!.pos.distanceTo(live)).toBeLessThan(1e-6);
  });

  test("cascading interrupts keep exiting cards from older layouts renderable", () => {
    const m = start();
    m.step(10);
    m.setLayout(layoutCards(cardGraph(model, "c", 1, all)!));
    expect(m.renderList.find((r) => r.id === "b")?.exiting).toBe(true);
    expect(m.sample("b")).not.toBeNull();
    for (let i = 0; i < 43; i++) m.step(10);
    expect(m.settled).toBe(true);
    expect(m.sample("b")).toBeNull();
  });

  test("a re-derived but identical layout never animates (theme flips)", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.setLayout(layoutF());
    expect(m.settled).toBe(true);
  });

  test("reduced motion snaps refocus instantly", () => {
    const m = createCardMotion({ reducedMotion: () => true });
    m.setLayout(layoutF());
    m.setLayout(layoutA());
    expect(m.settled).toBe(true);
    expect(m.sample("b")).toBeNull();
  });

  test("flow toggle with the same focus animates cards to the reoriented cylinder", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    const vPos = m.sample("a")!.pos.clone();
    m.setLayout(layoutCards(cardGraph(model, "f", 1, all)!, { flow: "h" }), "h");
    expect(m.settled).toBe(false);
    // Flat coords carry over exactly; the only start-of-transition delta is
    // the cylinder curvature plane switching axes (~z-only, invisible at R).
    expect(m.sample("a")!.pos.distanceTo(vPos)).toBeLessThan(5);
    for (let i = 0; i < 42; i++) m.step(10);
    const flatH = layoutCards(cardGraph(model, "f", 1, all)!, { flow: "h" });
    const p = flatH.byId["a"]!;
    // Horizontal flow: the band (curved, scrollable) axis is y; cross is x.
    expect(m.sample("a")!.pos.distanceTo(cylPose(p.y, p.x, p.z, "h").pos)).toBeLessThan(1e-6);
    close(m.sample("f")!.pos.x, 0, 1e-6); // focus stays centered
  });
});

describe("arrows", () => {
  test("arrowList mirrors tracked keys; exit arrows unmount at settle", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    expect(m.arrowList.map((a) => a.key).sort()).toEqual(["a→f", "f→b"]);
    m.setLayout(layoutA());
    expect(m.arrowList.map((a) => a.key).sort()).toEqual(["a→f", "c→a", "f→b"]);
    for (let i = 0; i < 42; i++) m.step(10);
    expect(m.arrowList.map((a) => a.key).sort()).toEqual(["a→f", "c→a"]);
  });

  test("heads stay pinned to card edges mid-flight (glue + base-center stem)", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.setLayout(layoutA());
    for (let i = 0; i < 15; i++) m.step(10);
    for (const a of m.arrowStates()) {
      const from = m.sample(a.fromId)!;
      const to = m.sample(a.toId)!;
      const anchorFrom = new THREE.Vector3(a.fromLocal.x, a.fromLocal.y, 0)
        .applyQuaternion(from.quat)
        .add(from.pos);
      expect(a.path[0]!.distanceTo(anchorFrom)).toBeLessThan(1e-9);
      const tt = edgeTangent(a.toLocal, to.w, to.h);
      const toTan = new THREE.Vector3(tt.x, tt.y, 0).applyQuaternion(to.quat);
      const anchorTo = new THREE.Vector3(a.toLocal.x, a.toLocal.y, 0).applyQuaternion(to.quat).add(to.pos);
      const last = a.path[a.path.length - 1]!;
      expect(last.distanceTo(anchorTo.clone().addScaledVector(toTan, HEAD_H))).toBeLessThan(1e-9);
      const apex = new THREE.Vector3(0, HEAD_H / 2, 0).applyQuaternion(a.head.quat).add(a.head.pos);
      expect(apex.distanceTo(anchorTo)).toBeLessThan(1e-9);
    }
  });
});

describe("scroll", () => {
  const start = () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(wideLayout());
    return m;
  };

  test("bands wider than the window get scroll room; narrow bands do not", () => {
    const m = start();
    expect(m.scrollLimit("in")).toBeGreaterThan(0);
    expect(m.scrollLimit("out")).toBe(0); // no out-links at all
    m.scrollBy("out", 500);
    expect(m.scroll.out).toBe(0);
  });

  test("scrolling moves only that band; the focus card never moves", () => {
    const m = start();
    const focusBefore = m.sample("f")!.pos.clone();
    const aBefore = m.sample("n06")!.pos.clone();
    m.scrollBy("in", 300);
    expect(m.sample("f")!.pos.distanceTo(focusBefore)).toBeLessThan(1e-9);
    const aAfter = m.sample("n06")!.pos;
    expect(aAfter.distanceTo(aBefore)).toBeGreaterThan(100);
    close(m.scroll.in, 300);
  });

  test("clamps to the limit; edge cards fade in as they scroll into the window", () => {
    const m = start();
    const L = m.scrollLimit("in");
    m.scrollBy("in", 1e9);
    close(m.scroll.in, L);
    // The rightmost band card is now inside the window: fully visible.
    const flat = wideLayout();
    const maxBand = Math.max(...flat.cards.filter((c) => c.lane === "in" && c.ring === 1).map((c) => c.x));
    const edgeId = flat.cards.find((c) => c.x === maxBand && c.ring === 1)!.id;
    close(m.sample(edgeId)!.opacity, 1, 1e-6);
    // And the leftmost card has scrolled out past the fade edge.
    const minBand = Math.min(...flat.cards.filter((c) => c.lane === "in" && c.ring === 1).map((c) => c.x));
    const farId = flat.cards.find((c) => c.x === minBand && c.ring === 1)!.id;
    close(m.sample(farId)!.opacity, arcFade(minBand - L), 1e-6);
    expect(m.sample(farId)!.opacity).toBe(0);
  });

  test("ring-2 children track their parent through the scroll", () => {
    const m = start();
    const parentBefore = m.sample("n00")!.pos.clone();
    const kidBefore = m.sample("gp")!.pos.clone();
    m.scrollBy("in", 240);
    const parentDelta = m.sample("n00")!.pos.clone().sub(parentBefore);
    const kidDelta = m.sample("gp")!.pos.clone().sub(kidBefore);
    expect(parentDelta.length()).toBeGreaterThan(100);
    expect(kidDelta.distanceTo(parentDelta)).toBeLessThan(1);
  });

  test("focus-edge arrow anchors drift with the scrolled card and clamp at the edge", () => {
    const m = start();
    const arrowFor = (id: string) => m.arrowStates().find((a) => a.fromId === id)!;
    // The card sitting exactly over the focus starts anchored dead-center.
    const centerId = wideLayout().cards.find((c) => c.ring === 1 && c.x === 0)!.id;
    close(arrowFor(centerId).toLocal.x, 0, 1e-9);
    m.scrollBy("in", 60); // small enough to stay inside the clamp
    close(arrowFor(centerId).toLocal.x, -60, 1e-6); // drifts opposite the scroll, 1:1
    m.scrollBy("in", 1e9);
    const half = (m.sample("f")!.w / 2) * 0.85;
    expect(Math.abs(arrowFor("n00").toLocal.x)).toBeLessThanOrEqual(half + 1e-9);
    // Fully faded cards carry fully faded lines.
    close(arrowFor("n00").opacity, 0, 1e-6);
  });

  test("a refocus bakes the scroll into the start state and resets it", () => {
    const m = start();
    m.scrollBy("in", 300);
    const dragged = m.sample("n06")!.pos.clone();
    m.setLayout(layoutCards(cardGraph(wideModel, "n06", 1, all)!));
    close(m.scroll.in, 0);
    expect(m.sample("n06")!.pos.distanceTo(dragged)).toBeLessThan(1e-6); // continuity
  });
});

describe("view tween", () => {
  test("first targets seed instantly; later ones ease exponentially and snap", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.setViewTargets(0.5, -100);
    close(m.view.zoom, 0.5);
    expect(m.settled).toBe(true);
    m.setViewTargets(1, 0);
    expect(m.settled).toBe(false);
    m.step(90);
    close(m.view.zoom, 0.5 + 0.5 * (1 - Math.exp(-1)), 1e-6);
    for (let i = 0; i < 200; i++) m.step(90);
    close(m.view.zoom, 1);
    expect(m.settled).toBe(true);
  });

  test("reduced motion snaps view targets", () => {
    const m = createCardMotion({ reducedMotion: () => true });
    m.setLayout(layoutF());
    m.setViewTargets(0.5, -100);
    m.setViewTargets(0.8, -50);
    close(m.view.zoom, 0.8);
    expect(m.settled).toBe(true);
  });
});

describe("ring2 lift sanity", () => {
  test("depth-2 layouts settle every card on the cylinder", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF2());
    const flat = layoutF2();
    for (const c of flat.cards) {
      const expected = cylPose(c.x, c.y, c.z, "v");
      expect(m.sample(c.id)!.pos.distanceTo(expected.pos)).toBeLessThan(1e-6);
    }
    void BAND_Y; // referenced to keep layout-constant import meaningful
    void FADE_END;
  });
});
