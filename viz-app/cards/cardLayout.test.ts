// The card view's TDD core: cardGraph picks and classifies neighbors
// (directional flow — in-links above, out-links below, ring 2 continues the
// same direction outward), layoutCards turns that into deterministic world
// placements + elbow arrows, fitView fits/centers the ortho camera. The e2e
// asserts against exactly these outputs via window.__okf.cards.
import { describe, expect, test } from "bun:test";
import type { ConceptNode } from "../data";
import { buildModel } from "../data";
import { cfg, node } from "../test-helpers";
import {
  BAND_X,
  BAND_Y,
  CARD_H,
  CARD_W,
  cardGraph,
  FOCUS_H,
  FOCUS_W,
  FOCUS_Z,
  fitView,
  GAP_X,
  GAP_Y,
  ZOOM_MIN,
  bundleCardGraph,
  layoutCards,
  rootCardGraph,
} from "./cardLayout";

const all = (_n: ConceptNode) => true;

// Titles pick the alphabetical order on purpose: in-row sorts to
// [in-a, in-b, both-e], out-row to [out-d, out-c].
const model = () =>
  buildModel({
    nodes: [
      node("hub", "Decision", "Hub"),
      node("in-a", "Pattern", "Alpha In"),
      node("in-b", "Playbook", "Beta In"),
      node("out-c", "Reference", "Gamma Out"),
      node("out-d", "Pattern", "Delta Out"),
      node("both-e", "Playbook", "Epsilon Both"),
      node("in2-f", "Decision", "F Deep"),
      node("out2-g", "Reference", "G Deep"),
      node("island", "Host", "Island"),
    ],
    edges: [
      { s: "in-a", t: "hub" },
      { s: "in-b", t: "hub" },
      { s: "hub", t: "out-c" },
      { s: "hub", t: "out-d" },
      { s: "hub", t: "both-e" },
      { s: "both-e", t: "hub" },
      { s: "in2-f", t: "in-a" },
      { s: "out-c", t: "out2-g" },
    ],
    root: {
      title: "KB",
      desc: "",
      links: [
        { kind: "concept" as const, id: "hub" },
        { kind: "concept" as const, id: "island" },
        { kind: "dir" as const, path: "notes" },
      ],
    },
    bundles: {
      notes: {
        title: "Notes",
        desc: "",
        links: [
          { kind: "concept" as const, id: "island" },
          { kind: "concept" as const, id: "in2-f" },
        ],
      },
    },
    cfg: cfg(),
  });

describe("cardGraph", () => {
  test("unknown focus id -> null", () => {
    expect(cardGraph(model(), "ghost", 1, all)).toBeNull();
  });

  test("ring 1: in-links above (title-sorted), out-links below, mutual joins the in row", () => {
    const g = cardGraph(model(), "hub", 1, all)!;
    expect(g.in1.map((e) => e.id)).toEqual(["in-a", "in-b", "both-e"]);
    expect(g.out1.map((e) => e.id)).toEqual(["out-d", "out-c"]);
    expect(g.in1.find((e) => e.id === "both-e")!.twoWay).toBe(true);
    expect(g.in1.find((e) => e.id === "in-a")!.twoWay).toBe(false);
  });

  test("visible predicate trims both rows", () => {
    const g = cardGraph(model(), "hub", 1, (n) => n.type !== "Playbook")!;
    expect(g.in1.map((e) => e.id)).toEqual(["in-a"]);
    expect(g.out1.map((e) => e.id)).toEqual(["out-d", "out-c"]);
  });

  test("depth 1 has no ring 2; depth 2 flows directionally", () => {
    const g1 = cardGraph(model(), "hub", 1, all)!;
    expect(g1.in2).toEqual([]);
    expect(g1.out2).toEqual([]);
    const g2 = cardGraph(model(), "hub", 2, all)!;
    expect(g2.in2).toEqual([{ parent: "in-a", id: "in2-f", kind: "card" }]);
    expect(g2.out2).toEqual([{ parent: "out-c", id: "out2-g", kind: "card" }]);
  });

  test("ring 2 skips already-placed cards and picks the alphabetically-first parent", () => {
    const m = buildModel({
      nodes: [
        node("f", "Decision", "Focus"),
        node("p", "Pattern", "Alpha"),
        node("q", "Pattern", "Beta"),
        node("deep", "Pattern", "Deep"),
      ],
      edges: [
        { s: "p", t: "f" },
        { s: "q", t: "f" },
        // q also links into p: q is ring 1, must NOT reappear as ring 2 under p.
        { s: "q", t: "p" },
        // deep links into both ring-1 parents: attaches only under Alpha (p).
        { s: "deep", t: "p" },
        { s: "deep", t: "q" },
      ],
      cfg: cfg(),
    });
    const g = cardGraph(m, "f", 2, all)!;
    expect(g.in2).toEqual([{ parent: "p", id: "deep", kind: "card" }]);
  });
});

describe("layoutCards", () => {
  test("focus card at the origin", () => {
    const l = layoutCards(cardGraph(model(), "hub", 1, all)!);
    const f = l.byId["hub"]!;
    expect(f).toMatchObject({ kind: "focus", lane: "focus", ring: 0, x: 0, y: 0, z: FOCUS_Z, w: FOCUS_W, h: FOCUS_H });
  });

  test("edge-less focus: one card, no arrows, bounds = its rect", () => {
    const l = layoutCards(cardGraph(model(), "island", 1, all)!);
    expect(l.cards).toHaveLength(1);
    expect(l.arrows).toHaveLength(0);
    expect(l.bounds).toEqual({ minX: -FOCUS_W / 2, maxX: FOCUS_W / 2, minY: -FOCUS_H / 2, maxY: FOCUS_H / 2 });
  });

  test("ring-1 rows sit at ±BAND_Y[1], centered and symmetric", () => {
    const l = layoutCards(cardGraph(model(), "hub", 1, all)!);
    const pitch = CARD_W + GAP_X;
    // Three in-cards: centered around x=0 in sorted order.
    expect(l.byId["in-a"]).toMatchObject({ lane: "in", ring: 1, x: -pitch, y: BAND_Y[1], parentId: "hub" });
    expect(l.byId["in-b"]).toMatchObject({ x: 0, y: BAND_Y[1] });
    expect(l.byId["both-e"]).toMatchObject({ x: pitch, y: BAND_Y[1], twoWay: true });
    // Two out-cards: symmetric halves below.
    expect(l.byId["out-d"]).toMatchObject({ lane: "out", ring: 1, x: -pitch / 2, y: -BAND_Y[1]! });
    expect(l.byId["out-c"]).toMatchObject({ x: pitch / 2, y: -BAND_Y[1]! });
  });

  test("arrows: in flows card-bottom -> focus-top slot, out flows focus-bottom slot -> card-top; heads point down", () => {
    const l = layoutCards(cardGraph(model(), "hub", 1, all)!);
    const inArrow = l.arrows.find((a) => a.fromId === "in-a")!;
    expect(inArrow.dir).toBe("in");
    expect(inArrow.toId).toBe("hub");
    expect(inArrow.path[0]).toEqual({ x: l.byId["in-a"]!.x, y: BAND_Y[1]! - CARD_H / 2 });
    // Lands on the focus top edge, inside its width.
    const end = inArrow.path[inArrow.path.length - 1]!;
    expect(end.y).toBe(FOCUS_H / 2);
    expect(Math.abs(end.x)).toBeLessThan(FOCUS_W / 2);
    // Head at the lower end, wings trailing above: downward flow.
    expect(inArrow.head.tip.y).toBe(end.y);
    expect(inArrow.head.left.y).toBeGreaterThan(inArrow.head.tip.y);

    const outArrow = l.arrows.find((a) => a.toId === "out-c")!;
    expect(outArrow.dir).toBe("out");
    expect(outArrow.fromId).toBe("hub");
    expect(outArrow.path[0]!.y).toBe(-FOCUS_H / 2);
    expect(outArrow.path[outArrow.path.length - 1]).toEqual({
      x: l.byId["out-c"]!.x,
      y: -BAND_Y[1]! + CARD_H / 2,
    });
  });

  test("multiple in-arrows land on distinct focus-top slots; only the mutual arrow carries a tail head", () => {
    const l = layoutCards(cardGraph(model(), "hub", 1, all)!);
    const ends = l.arrows.filter((a) => a.dir === "in").map((a) => a.path[a.path.length - 1]!.x);
    expect(new Set(ends).size).toBe(ends.length);
    expect(l.arrows.find((a) => a.fromId === "both-e")!.tailHead).not.toBeNull();
    expect(l.arrows.find((a) => a.fromId === "in-a")!.tailHead).toBeNull();
  });

  test("large in-sets stay one scrollable band — never a grid, never a cap", () => {
    const many = buildModel({
      nodes: [
        node("f", "Decision", "Focus"),
        ...Array.from({ length: 30 }, (_, i) => node(`n${String(i).padStart(2, "0")}`, "Pattern", `N${i}`)),
      ],
      edges: Array.from({ length: 30 }, (_, i) => ({ s: `n${String(i).padStart(2, "0")}`, t: "f" })),
      cfg: cfg(),
    });
    const l = layoutCards(cardGraph(many, "f", 1, all)!);
    const inCards = l.cards.filter((c) => c.lane === "in");
    expect(inCards).toHaveLength(30);
    expect(inCards.every((c) => c.y === BAND_Y[1])).toBe(true); // one band
    expect(l.arrows.filter((a) => a.dir === "in")).toHaveLength(30);
    // Centered spread: symmetric extremes.
    const xs = inCards.map((c) => c.x);
    expect(Math.min(...xs)).toBe(-Math.max(...xs));
  });

  test("neighboring ring-2 clusters never overlap: a band-axis sweep spaces them", () => {
    // p1 has two kids (cluster spans past its slot); p2, one slot over, has
    // one kid. Without the sweep, k2 and k3 would sit ~116 apart (< card
    // width). After it, every ring-2 pair is at least one pitch apart.
    const m = buildModel({
      nodes: [
        node("f", "Decision", "Focus"),
        node("p1", "Pattern", "Alpha"),
        node("p2", "Pattern", "Beta"),
        node("k1", "Term", "K1"),
        node("k2", "Term", "K2"),
        node("k3", "Term", "K3"),
      ],
      edges: [
        { s: "p1", t: "f" },
        { s: "p2", t: "f" },
        { s: "k1", t: "p1" },
        { s: "k2", t: "p1" },
        { s: "k3", t: "p2" },
      ],
      cfg: cfg(),
    });
    const l = layoutCards(cardGraph(m, "f", 2, all)!);
    const ring2 = l.cards.filter((c) => c.ring === 2).sort((a, b) => a.x - b.x);
    const pitch = CARD_W + GAP_X;
    for (let i = 1; i < ring2.length; i++) {
      expect(ring2[i]!.x - ring2[i - 1]!.x).toBeGreaterThanOrEqual(pitch - 1e-9);
    }
    // The spread stays centered where the clusters wanted to be.
    const meanWanted = (l.byId["p1"]!.x * 2 + l.byId["p2"]!.x) / 3;
    const meanGot = ring2.reduce((n, c) => n + c.x, 0) / ring2.length;
    expect(Math.abs(meanGot - meanWanted)).toBeLessThan(1e-6);
  });

  test("de-overlap is balanced: crowding splits between both neighbors, extremities never drift", () => {
    // p1 (band -464) has three kids overflowing rightward into p2's (-232)
    // single kid; p5 (+464) has one kid far from the crowd. The old greedy
    // sweep pushed collisions right then re-centered the WHOLE set, dragging
    // p5's kid off its parent. Optimal placement moves only the colliding
    // block (sharing displacement across it) and leaves p5's kid exactly
    // on its anchor.
    const m = buildModel({
      nodes: [
        node("f", "Decision", "Focus"),
        node("p1", "Pattern", "A"),
        node("p2", "Pattern", "B"),
        node("p3", "Pattern", "C"),
        node("p4", "Pattern", "D"),
        node("p5", "Pattern", "E"),
        node("k1", "Term", "K1"),
        node("k2", "Term", "K2"),
        node("k3", "Term", "K3"),
        node("k4", "Term", "K4"),
        node("k5", "Term", "K5"),
      ],
      edges: [
        { s: "p1", t: "f" },
        { s: "p2", t: "f" },
        { s: "p3", t: "f" },
        { s: "p4", t: "f" },
        { s: "p5", t: "f" },
        { s: "k1", t: "p1" },
        { s: "k2", t: "p1" },
        { s: "k3", t: "p1" },
        { s: "k4", t: "p2" },
        { s: "k5", t: "p5" },
      ],
      cfg: cfg(),
    });
    const l = layoutCards(cardGraph(m, "f", 2, all)!);
    const pitch = CARD_W + GAP_X;
    const ring2 = l.cards.filter((c) => c.ring === 2).sort((a, b) => a.x - b.x);
    for (let i = 1; i < ring2.length; i++) {
      expect(ring2[i]!.x - ring2[i - 1]!.x).toBeGreaterThanOrEqual(pitch - 1e-9);
    }
    // The far cluster sits exactly on its parent — no global drift.
    expect(l.byId["k5"]!.x).toBeCloseTo(l.byId["p5"]!.x, 6);
    // The colliding block shares displacement: its mean stays where the
    // anchors wanted it (p1's kids nudge left, p2's kid right).
    const block = [l.byId["k1"]!, l.byId["k2"]!, l.byId["k3"]!, l.byId["k4"]!];
    const wanted = (l.byId["p1"]!.x - pitch + l.byId["p1"]!.x + (l.byId["p1"]!.x + pitch) + l.byId["p2"]!.x) / 4;
    const got = block.reduce((n, c) => n + c.x, 0) / 4;
    expect(got).toBeCloseTo(wanted, 6);
    // Symmetric sharing: p1's kids give ground leftward…
    expect(l.byId["k3"]!.x).toBeLessThan(l.byId["p1"]!.x + pitch);
    expect(l.byId["k1"]!.x).toBeLessThan(l.byId["p1"]!.x - pitch);
    // …while p2's kid yields rightward.
    expect(l.byId["k4"]!.x).toBeGreaterThan(l.byId["p2"]!.x);
  });

  test("ring 2 clusters center on their parent and its arrows attach to the parent card edge", () => {
    const l = layoutCards(cardGraph(model(), "hub", 2, all)!);
    // Children track their parent: the cluster centers on the parent's band position.
    expect(l.byId["in2-f"]).toMatchObject({ ring: 2, y: BAND_Y[2], x: l.byId["in-a"]!.x, parentId: "in-a" });
    expect(l.byId["out2-g"]).toMatchObject({ ring: 2, y: -BAND_Y[2]!, x: l.byId["out-c"]!.x, parentId: "out-c" });
    const a = l.arrows.find((a) => a.fromId === "in2-f")!;
    expect(a.toId).toBe("in-a");
    expect(a.path[a.path.length - 1]!.y).toBe(BAND_Y[1]! + CARD_H / 2);
    const b = l.arrows.find((a) => a.toId === "out2-g")!;
    expect(b.fromId).toBe("out-c");
    expect(b.path[0]!.y).toBe(-BAND_Y[1]! - CARD_H / 2);
  });

  test("bounds enclose every card rect exactly", () => {
    const l = layoutCards(cardGraph(model(), "hub", 2, all)!);
    const minX = Math.min(...l.cards.map((c) => c.x - c.w / 2));
    const maxX = Math.max(...l.cards.map((c) => c.x + c.w / 2));
    const minY = Math.min(...l.cards.map((c) => c.y - c.h / 2));
    const maxY = Math.max(...l.cards.map((c) => c.y + c.h / 2));
    expect(l.bounds).toEqual({ minX, maxX, minY, maxY });
  });

  test("deterministic: same input, deeply equal output", () => {
    const a = layoutCards(cardGraph(model(), "hub", 2, all)!);
    const b = layoutCards(cardGraph(model(), "hub", 2, all)!);
    expect(a).toEqual(b);
  });
});

describe("horizontal flow", () => {
  const h = (focus = "hub", depth: 1 | 2 = 1) => layoutCards(cardGraph(model(), focus, depth, all)!, { flow: "h" });

  test("in-column left, out-column right, focus at the origin, columns centered", () => {
    const l = h();
    const pitch = CARD_H + GAP_Y;
    expect(l.byId["hub"]).toMatchObject({ x: 0, y: 0, kind: "focus" });
    // Sorted [in-a, in-b, both-e] reads top -> bottom in the left column.
    expect(l.byId["in-a"]).toMatchObject({ lane: "in", ring: 1, x: -BAND_X[1]!, y: pitch });
    expect(l.byId["in-b"]).toMatchObject({ x: -BAND_X[1]!, y: 0 });
    expect(l.byId["both-e"]).toMatchObject({ x: -BAND_X[1]!, y: -pitch, twoWay: true });
    expect(l.byId["out-d"]).toMatchObject({ lane: "out", ring: 1, x: BAND_X[1]!, y: pitch / 2 });
    expect(l.byId["out-c"]).toMatchObject({ x: BAND_X[1]!, y: -pitch / 2 });
  });

  test("arrows flow rightward: card right edge -> left-edge slot; heads point right", () => {
    const l = h();
    const inArrow = l.arrows.find((a) => a.fromId === "in-a")!;
    expect(inArrow.path[0]).toEqual({ x: -BAND_X[1]! + CARD_W / 2, y: l.byId["in-a"]!.y });
    const end = inArrow.path[inArrow.path.length - 1]!;
    expect(end.x).toBe(-FOCUS_W / 2);
    expect(Math.abs(end.y)).toBeLessThan(FOCUS_H / 2);
    // Head at the right end, wings trailing left: rightward flow.
    expect(inArrow.head.tip.x).toBe(end.x);
    expect(inArrow.head.left.x).toBeLessThan(inArrow.head.tip.x);
    expect(inArrow.head.right.x).toBeLessThan(inArrow.head.tip.x);

    const outArrow = l.arrows.find((a) => a.toId === "out-c")!;
    expect(outArrow.path[0]!.x).toBe(FOCUS_W / 2);
    expect(outArrow.path[outArrow.path.length - 1]).toEqual({
      x: BAND_X[1]! - CARD_W / 2,
      y: l.byId["out-c"]!.y,
    });
  });

  test("ring 2 sits one band further out on each side", () => {
    const l = h("hub", 2);
    expect(l.byId["in2-f"]).toMatchObject({ ring: 2, x: -BAND_X[2]!, y: l.byId["in-a"]!.y, parentId: "in-a" });
    expect(l.byId["out2-g"]).toMatchObject({ ring: 2, x: BAND_X[2]!, y: l.byId["out-c"]!.y, parentId: "out-c" });
    const a = l.arrows.find((x) => x.fromId === "in2-f")!;
    expect(a.path[0]!.x).toBe(-BAND_X[2]! + CARD_W / 2);
    expect(a.path[a.path.length - 1]!.x).toBe(-BAND_X[1]! - CARD_W / 2);
  });

  test("large sets stay one scrollable column", () => {
    const many = buildModel({
      nodes: [node("f", "Decision", "Focus"), ...Array.from({ length: 9 }, (_, i) => node(`n${i}`, "Pattern", `N${i}`))],
      edges: Array.from({ length: 9 }, (_, i) => ({ s: `n${i}`, t: "f" })),
      cfg: cfg(),
    });
    const l = layoutCards(cardGraph(many, "f", 1, all)!, { flow: "h" });
    const col = l.cards.filter((c) => c.lane === "in");
    expect(col).toHaveLength(9);
    expect(col.every((c) => c.x === -BAND_X[1]!)).toBe(true);
  });

  test("same card set as vertical; only the geometry changes", () => {
    const v = layoutCards(cardGraph(model(), "hub", 2, all)!);
    const hz = h("hub", 2);
    expect(hz.cards.map((c) => c.id).sort()).toEqual(v.cards.map((c) => c.id).sort());
    expect(hz.arrows.map((a) => a.fromId + "→" + a.toId).sort()).toEqual(
      v.arrows.map((a) => a.fromId + "→" + a.toId).sort(),
    );
  });
});

describe("rootCardGraph", () => {
  test("no embedded root -> null", () => {
    const m = buildModel({ nodes: [node("a", "T", "A")], edges: [], cfg: cfg() });
    expect(rootCardGraph(m, all)).toBeNull();
  });

  test("root layout: no in-row, authored link order below, dirs as dir cards", () => {
    const g = rootCardGraph(model(), all)!;
    expect(g.in1).toEqual([]);
    expect(g.out1.map((e) => ({ id: e.id, kind: e.kind }))).toEqual([
      { id: "hub", kind: "card" },
      { id: "island", kind: "card" },
      { id: "notes", kind: "dir" },
    ]);
    const l = layoutCards(g);
    expect(l.rootFocus).toBe(true);
    expect(l.byId["notes"]).toMatchObject({ kind: "dir", lane: "out" });
  });

  test("hidden types drop concept cards but never dir cards", () => {
    const g = rootCardGraph(model(), (n) => n.type !== "Decision")!;
    expect(g.out1.map((e) => e.id)).toEqual(["island", "notes"]);
  });

  test("depth 2: concepts expand out-links, dirs expand their bundle's index links", () => {
    const g = rootCardGraph(model(), all, 2)!;
    expect(g.in2).toEqual([]);
    expect(g.out2).toEqual([
      // hub's out-links, title-sorted (Delta, Epsilon, Gamma).
      { parent: "hub", id: "out-d", kind: "card" },
      { parent: "hub", id: "both-e", kind: "card" },
      { parent: "hub", id: "out-c", kind: "card" },
      // notes' bundle links in authored order; island is already placed ring 1.
      { parent: "notes", id: "in2-f", kind: "card" },
    ]);
  });
});

// Focusing a dir card centers that bundle's index.md: parent index above
// (the root card, or the enclosing bundle for nested dirs), authored links
// below — the navigable analogue of rootCardGraph.
describe("bundleCardGraph", () => {
  const bModel = () =>
    buildModel({
      nodes: [
        node("hub", "Decision", "Hub"),
        node("notes/n1", "Note", "N1"),
        node("notes/n2", "Note", "N2"),
        node("notes/deep/d1", "Note", "D1"),
      ],
      edges: [{ s: "notes/n1", t: "hub" }],
      root: { title: "KB", desc: "", links: [{ kind: "dir" as const, path: "notes" }] },
      bundles: {
        notes: {
          title: "Notes",
          desc: "Side notes",
          links: [
            { kind: "concept" as const, id: "notes/n1" },
            { kind: "concept" as const, id: "notes/n2" },
            { kind: "dir" as const, path: "notes/deep" },
          ],
        },
        "notes/deep": {
          title: "Deep",
          desc: "",
          links: [{ kind: "concept" as const, id: "notes/deep/d1" }],
        },
      },
      cfg: cfg(),
    });

  test("unknown bundle -> null; inherited prototype keys too", () => {
    expect(bundleCardGraph(bModel(), "ghost", 1, all)).toBeNull();
    expect(bundleCardGraph(bModel(), "constructor", 1, all)).toBeNull();
    expect(bundleCardGraph(bModel(), "toString", 1, all)).toBeNull();
  });

  test("bundle focus: root card above, authored links below with kinds", () => {
    const g = bundleCardGraph(bModel(), "notes", 1, all)!;
    expect(g.focusId).toBe("notes");
    expect(g.root).toBe(false);
    expect(g.in1).toEqual([{ id: "", kind: "root", twoWay: false }]);
    expect(g.out1.map((e) => ({ id: e.id, kind: e.kind }))).toEqual([
      { id: "notes/n1", kind: "card" },
      { id: "notes/n2", kind: "card" },
      { id: "notes/deep", kind: "dir" },
    ]);
    expect(g.in2).toEqual([]);
    expect(g.out2).toEqual([]);
  });

  test("visible predicate trims concept links, never dirs", () => {
    const g = bundleCardGraph(bModel(), "notes", 1, (n) => n.id !== "notes/n2")!;
    expect(g.out1.map((e) => e.id)).toEqual(["notes/n1", "notes/deep"]);
  });

  test("no embedded root -> no in-row", () => {
    const m = bModel();
    const g = bundleCardGraph({ ...m, root: null }, "notes", 1, all)!;
    expect(g.in1).toEqual([]);
  });

  test("nested bundle: enclosing bundle above, root chains in at depth 2", () => {
    const g = bundleCardGraph(bModel(), "notes/deep", 2, all)!;
    expect(g.in1).toEqual([{ id: "notes", kind: "dir", twoWay: false }]);
    expect(g.in2).toEqual([{ parent: "notes", id: "", kind: "root" }]);
    expect(g.out1.map((e) => e.id)).toEqual(["notes/deep/d1"]);
  });

  test("depth 2: concepts expand out-links, dirs expand their bundle's links", () => {
    const g = bundleCardGraph(bModel(), "notes", 2, all)!;
    expect(g.out2).toEqual([
      { parent: "notes/n1", id: "hub", kind: "card" },
      { parent: "notes/deep", id: "notes/deep/d1", kind: "card" },
    ]);
  });

  test("layout places the root in-card with an arrow into the bundle focus", () => {
    const l = layoutCards(bundleCardGraph(bModel(), "notes", 1, all)!);
    expect(l.rootFocus).toBe(false);
    expect(l.byId["notes"]).toMatchObject({ kind: "focus", ring: 0, x: 0, y: 0 });
    expect(l.byId[""]).toMatchObject({ kind: "root", lane: "in", ring: 1 });
    expect(l.arrows.some((a) => a.fromId === "" && a.toId === "notes" && a.dir === "in")).toBe(true);
  });
});

// The view fits the CROSS axis alone (ring count): the band axis is
// scrollable, so its length must never shrink the cards. And it centers on
// the OCCUPIED cross extent, not the focus — a node with links on only one
// side balances the visualization instead of leaving half the stage empty.
describe("fitView", () => {
  const bounds = { minX: -3000, maxX: 3000, minY: -100, maxY: 100 };

  test("vertical flow fits the vertical (cross) extent; band length is ignored", () => {
    // Cross extent 200 in a 400-high viewport -> clamped to 1, despite a
    // 6000-wide band.
    expect(fitView(bounds, 450, 400, "v", 1).zoom).toBe(1);
    // Cross 800 in a 400-high viewport: 0.5 -> clamped to ZOOM_MIN.
    expect(fitView({ ...bounds, minY: -400, maxY: 400 }, 450, 400, "v", 1).zoom).toBe(ZOOM_MIN);
    // Cross 500 in a 400-high viewport: 0.8.
    expect(fitView({ ...bounds, minY: -250, maxY: 250 }, 450, 400, "v", 1).zoom).toBeCloseTo(0.8);
  });

  test("horizontal flow fits the horizontal (cross) extent instead", () => {
    const b = { minX: -250, maxX: 250, minY: -3000, maxY: 3000 };
    expect(fitView(b, 400, 300, "h", 1).zoom).toBeCloseTo(0.8);
    expect(fitView(b, 800, 300, "h", 1).zoom).toBe(1);
  });

  test("one-sided layouts rebalance: cross centers on the occupied midpoint", () => {
    // No out-links (v-flow): everything sits above the focus.
    const oneSided = { minX: -3000, maxX: 3000, minY: -48, maxY: 382 };
    expect(fitView(oneSided, 800, 852, "v", 1).cross).toBeCloseTo(167);
    // Symmetric layouts keep the focus dead center.
    expect(fitView({ minX: 0, maxX: 0, minY: -212, maxY: 212 }, 800, 852, "v", 1).cross).toBe(0);
    // h-flow: the cross is x.
    expect(fitView({ minX: -710, maxX: 115, minY: 0, maxY: 0 }, 800, 852, "h", 1).cross).toBeCloseTo(-297.5);
  });

  test("asymmetric extents fit as-is — no symmetric doubling", () => {
    const asym = { minX: 0, maxX: 0, minY: -50, maxY: 250 }; // extent 300
    expect(fitView(asym, 450, 400, "v", 1).zoom).toBe(1);
    expect(fitView({ minX: 0, maxX: 0, minY: -50, maxY: 550 }, 450, 400, "v", 1).zoom).toBeCloseTo(400 / 600);
  });

  test("pad shrinks proportionally; never below ZOOM_MIN; degenerate bounds -> centered 1", () => {
    expect(fitView({ ...bounds, minY: -250, maxY: 250 }, 450, 400, "v", 0.9).zoom).toBeCloseTo(0.72);
    expect(ZOOM_MIN).toBeGreaterThanOrEqual(0.5);
    expect(fitView({ ...bounds, minY: -2000, maxY: 2000 }, 800, 600, "v", 0.85).zoom).toBe(ZOOM_MIN);
    const degenerate = fitView({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, 800, 600, "v", 0.85);
    expect(degenerate.zoom).toBe(1);
    expect(degenerate.cross).toBe(0);
  });
});
