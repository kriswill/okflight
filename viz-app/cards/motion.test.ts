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
import { BAND_Y, CARD_W, cardGraph, FOCUS_Z, layoutCards } from "./cardLayout";
import { arcFade, arcScale, CYL_R, cylPose, FADE_END, FADE_START, SCALE_MIN } from "./cylinder";
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
    // the cylinder curvature plane switching axes — a z-only sag of
    // R(1-cos(band/R)) at card a's band coordinate (BAND_Y[1]).
    const zSag = CYL_R * (1 - Math.cos(BAND_Y[1] / CYL_R));
    expect(m.sample("a")!.pos.distanceTo(vPos)).toBeLessThan(zSag + 0.5);
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
      // Anchors live on the RENDERED (aperture-scaled) card edges.
      const anchorFrom = new THREE.Vector3(a.fromLocal.x * from.scale, a.fromLocal.y * from.scale, 0)
        .applyQuaternion(from.quat)
        .add(from.pos);
      expect(a.path[0]!.distanceTo(anchorFrom)).toBeLessThan(1e-9);
      const tt = edgeTangent(a.toLocal, to.w, to.h);
      const toTan = new THREE.Vector3(tt.x, tt.y, 0).applyQuaternion(to.quat);
      const anchorTo = new THREE.Vector3(a.toLocal.x * to.scale, a.toLocal.y * to.scale, 0)
        .applyQuaternion(to.quat)
        .add(to.pos);
      const last = a.path[a.path.length - 1]!;
      expect(last.distanceTo(anchorTo.clone().addScaledVector(toTan, HEAD_H * to.scale))).toBeLessThan(1e-9);
      const apex = new THREE.Vector3(0, (HEAD_H * to.scale) / 2, 0).applyQuaternion(a.head.quat).add(a.head.pos);
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

  test("aperture: cards shrink toward the window edge; picking and arrows track the scaled edge", () => {
    const m = start();
    m.scrollBy("in", 300);
    // Every band card's scale follows its scrolled band distance; the focus
    // (band center) stays full size.
    close(m.sample("f")!.scale, 1);
    const flat = wideLayout();
    for (const c of flat.cards.filter((x) => x.lane === "in" && x.ring === 1)) {
      const s = m.sample(c.id)!;
      close(s.scale, arcScale(s.effBand));
      const item = m.pickItems().find((i) => i.id === c.id)!;
      close(item.w, s.w * s.scale);
      close(item.h, s.h * s.scale);
    }
    // An off-center card's arrow starts exactly on its scaled edge.
    const id = flat.cards.find((x) => x.lane === "in" && x.ring === 1 && Math.abs(x.x - 300) > 500)!.id;
    const s = m.sample(id)!;
    expect(s.scale).toBeLessThan(1);
    const a = m.arrowStates().find((x) => x.fromId === id)!;
    const anchor = new THREE.Vector3(a.fromLocal.x * s.scale, a.fromLocal.y * s.scale, 0)
      .applyQuaternion(s.quat)
      .add(s.pos);
    expect(a.path[0]!.distanceTo(anchor)).toBeLessThan(1e-9);
  });

  test("cards adopt their new band on refocus: an ex-focus scrolls with its band", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    // n00 is the focus first (lane "focus"), then f takes over and n00
    // joins the wide in band — its sample must re-band or it stays pinned
    // while the band scrolls under it.
    m.setLayout(layoutCards(cardGraph(wideModel, "n00", 1, all)!));
    m.setLayout(wideLayout());
    m.step(DURATION_MS);
    expect(m.settled).toBe(true);
    const s0 = m.sample("n00")!;
    const posBefore = s0.pos.clone();
    const effBefore = s0.effBand;
    m.scrollBy("in", 200);
    const s = m.sample("n00")!;
    close(s.effBand, effBefore - 200, 1e-6);
    expect(s.pos.distanceTo(posBefore)).toBeGreaterThan(100);
    // And the new focus (previously an out-lane card) stays pinned.
    expect(m.sample("f")!.effBand).toBe(0);
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

  test("focus-edge anchors spread the fade window across the edge and drift with scroll", () => {
    const m = start();
    const arrowFor = (id: string) => m.arrowStates().find((a) => a.fromId === id)!;
    const limit = (m.sample("f")!.w / 2) * 0.85;
    // The card sitting exactly over the focus starts anchored dead-center.
    const flat = wideLayout();
    const ring1 = flat.cards.filter((c) => c.ring === 1).sort((a, b) => a.x - b.x);
    const centerId = ring1.find((c) => c.x === 0)!.id;
    close(arrowFor(centerId).toLocal.x, 0, 1e-9);
    // Anchors are the window position compressed onto the edge: ordered and
    // SPACED — neighbors never stack on one corner point.
    const nextId = ring1[ring1.indexOf(ring1.find((c) => c.x === 0)!) + 1]!.id;
    const a0 = arrowFor(centerId).toLocal.x;
    const a1 = arrowFor(nextId).toLocal.x;
    expect(a1).toBeGreaterThan(a0);
    close(a1 - a0, (limit * (CARD_W + 52)) / FADE_END, 1); // one pitch of spacing, scaled
    // Scrolling drifts every anchor proportionally.
    m.scrollBy("in", 120);
    close(arrowFor(centerId).toLocal.x, (limit * -120) / FADE_END, 1e-6);
    // Far past the window they clamp at the edge, with lines fully faded.
    m.scrollBy("in", 1e9);
    expect(Math.abs(arrowFor("n00").toLocal.x)).toBeLessThanOrEqual(limit + 1e-9);
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

// The focus card keeps its scale no matter the band length: the visible
// window derives from the viewport (setWindow), and cards hidden past its
// edges are surfaced by per-edge overflow chips with counts.
describe("viewport window & overflow", () => {
  const start = () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(wideLayout());
    return m;
  };
  // wideLayout ring-1 in band: 13 cards at ±232 pitch (±1392 extremes),
  // plus gp (ring 2) anchored at band -1392.

  test("setWindow pulls the fade edge in: far cards hide, scroll room grows", () => {
    const m = start();
    const flat = wideLayout();
    const id696 = flat.cards.find((c) => c.ring === 1 && Math.abs(c.x - 696) < 1)!.id;
    expect(m.sample(id696)!.opacity).toBeGreaterThan(0); // default 920 window
    const limitBefore = m.scrollLimit("in");
    m.setWindow(500);
    expect(m.window.fadeEnd).toBe(500);
    expect(m.sample(id696)!.opacity).toBe(0);
    expect(m.sample(id696)!.scale).toBeCloseTo(SCALE_MIN, 6); // aperture follows
    expect(m.scrollLimit("in")).toBeGreaterThan(limitBefore);
  });

  test("overflow chips count hidden cards per band edge and track the scroll", () => {
    const m = start();
    m.setWindow(500);
    // Visible: bands 0, ±232, ±464. Hidden ring 1: ±696..±1392 (4 a side);
    // gp (ring 2, band -1392) joins the negative side.
    const neg = m.overflow.find((c) => c.lane === "in" && c.dir === -1)!;
    const pos = m.overflow.find((c) => c.lane === "in" && c.dir === 1)!;
    expect(neg.count).toBe(5);
    expect(pos.count).toBe(4);
    expect(m.overflow.some((c) => c.lane === "out")).toBe(false); // nothing there
    m.scrollBy("in", 232); // one pitch toward the positive edge
    expect(m.overflow.find((c) => c.lane === "in" && c.dir === -1)!.count).toBe(6);
    expect(m.overflow.find((c) => c.lane === "in" && c.dir === 1)!.count).toBe(3);
  });

  test("chips clear during a transition and recompute at settle", () => {
    const m = start();
    m.setWindow(500);
    expect(m.overflow.length).toBeGreaterThan(0);
    m.setLayout(layoutCards(cardGraph(wideModel, "n00", 1, all)!));
    expect(m.overflow).toEqual([]); // mid-flight: counts would lie
    for (let i = 0; i < 42; i++) m.step(10);
    expect(m.settled).toBe(true);
    // n00's neighborhood is tiny — everything fits, no chips.
    expect(m.overflow).toEqual([]);
    m.setLayout(wideLayout());
    for (let i = 0; i < 42; i++) m.step(10);
    expect(m.overflow.length).toBeGreaterThan(0); // recomputed at settle
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
