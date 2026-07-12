// Refocus transitions now tween FLAT layout coordinates (band/cross); the
// cylinder mapping is applied per sample by the motion store, so the same
// tracks serve both flows and compose with per-band scrolling. Exits roll a
// fixed distance further along the band axis while fading; enters run the
// reverse path. The motion store owns time; this module owns geometry.
import { describe, expect, test } from "bun:test";
import { buildModel } from "../data";
import { cfg, node } from "../test-helpers";
import { CARD_H, CARD_W, cardGraph, FOCUS_H, FOCUS_W, layoutCards } from "./cardLayout";
import { buildTransition, DURATION_MS, easeOutCubic, EXIT_DIST, sampleTrack, snapshotOf } from "./transition";

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
const layoutF = layoutCards(cardGraph(model, "f", 1, all)!);
const layoutA = layoutCards(cardGraph(model, "a", 1, all)!);
const spec = buildTransition(snapshotOf(layoutF), layoutA, "v");
const byId = Object.fromEntries(spec.tracks.map((t) => [t.id, t]));

describe("buildTransition", () => {
  test("classifies shared / enter / exit", () => {
    expect(byId["f"]!.kind).toBe("shared");
    expect(byId["a"]!.kind).toBe("shared");
    expect(byId["c"]!.kind).toBe("enter");
    expect(byId["b"]!.kind).toBe("exit");
    expect(spec.duration).toBe(DURATION_MS);
  });

  test("shared tracks lerp between the flat placements", () => {
    const t = byId["f"]!;
    close(t.x0, layoutF.byId["f"]!.x);
    close(t.y0, layoutF.byId["f"]!.y);
    close(t.x1, layoutA.byId["f"]!.x);
    close(t.y1, layoutA.byId["f"]!.y);
  });

  test("kind-change scale morph endpoints (focus<->card)", () => {
    close(byId["a"]!.s0x, CARD_W / FOCUS_W);
    close(byId["a"]!.s0y, CARD_H / FOCUS_H);
    close(byId["a"]!.s1x, 1);
    close(byId["f"]!.s0x, FOCUS_W / CARD_W);
  });

  test("exits roll a fixed distance further out along the band axis while fading", () => {
    const t = byId["b"]!; // b sat below the focus (out row) at band x=0
    close(t.y1, t.y0); // cross coordinate held
    close(Math.abs(t.x1 - t.x0), EXIT_DIST);
    expect(t.o1).toBe(0);
  });

  test("horizontal flow rolls exits along the vertical band axis instead", () => {
    const specH = buildTransition(snapshotOf(layoutCards(cardGraph(model, "f", 1, all)!, { flow: "h" })), layoutCards(cardGraph(model, "a", 1, all)!, { flow: "h" }), "h");
    const t = specH.tracks.find((x) => x.id === "b")!;
    close(t.x1, t.x0);
    close(Math.abs(t.y1 - t.y0), EXIT_DIST);
  });

  test("enters run the exit path in reverse (arrive from beyond the window)", () => {
    const t = byId["c"]!;
    close(t.y0, t.y1);
    close(Math.abs(t.x0 - t.x1), EXIT_DIST);
    expect(t.o0).toBe(0);
    close(t.s0x, 0.9);
  });
});

describe("sampleTrack", () => {
  test("endpoints exact at e=0/1; linear lerp between", () => {
    const t = byId["a"]!;
    const s0 = sampleTrack(t, 0);
    close(s0.x, t.x0);
    close(s0.y, t.y0);
    close(s0.sx, CARD_W / FOCUS_W);
    const s1 = sampleTrack(t, 1);
    close(s1.x, t.x1);
    close(s1.opacity, 1);
    close(s1.sx, 1);
    const mid = sampleTrack(t, 0.5);
    close(mid.x, (t.x0 + t.x1) / 2);
  });

  test("exit opacity reaches 0 by e=0.8; enter fades in from 0", () => {
    const ex = byId["b"]!;
    expect(sampleTrack(ex, 0.4).opacity).toBeGreaterThan(0);
    close(sampleTrack(ex, 0.8).opacity, 0);
    close(sampleTrack(ex, 1).opacity, 0);
    const en = byId["c"]!;
    close(sampleTrack(en, 0).opacity, 0);
    expect(sampleTrack(en, 0.9).opacity).toBeGreaterThan(0.8);
  });

  test("lift interpolates (focus hover transfers)", () => {
    const t = byId["a"]!; // becomes the focus: gains the lift
    close(sampleTrack(t, 0).lift, 0);
    close(sampleTrack(t, 1).lift, layoutA.byId["a"]!.z);
  });
});

describe("easeOutCubic", () => {
  test("matches the stepFly precedent", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    close(easeOutCubic(0.5), 1 - 0.5 ** 3);
  });
});
