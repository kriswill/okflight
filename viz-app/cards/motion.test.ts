// The motion store is the single source of per-frame truth: it owns dome
// layouts, transition tracks, the drag orientation, and the camera tween,
// and is stepped with explicit dt — so every animation behavior pins down
// deterministically under bun test with no Threlte and no clock.
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildModel } from "../data";
import { cfg, node } from "../test-helpers";
import { cardGraph, FOCUS_Z, layoutCards, type CardLayout } from "./cardLayout";
import { domeProject } from "./dome";
import { createCardMotion } from "./motion.svelte";
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
const layoutA = () => layoutCards(cardGraph(model, "a", 1, all)!);

describe("first layout & settled state", () => {
  test("first setLayout settles instantly at the dome poses", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    expect(m.settled).toBe(true);
    const f = m.sample("f")!;
    close(f.pos.x, 0, 1e-6);
    close(f.pos.y, 0, 1e-6);
    close(f.pos.z, FOCUS_Z, 1e-6);
    close(f.opacity, 1);
    expect(m.renderList.map((r) => r.id).sort()).toEqual(["a", "b", "f"]);
    expect(m.renderList.every((r) => !r.exiting)).toBe(true);
  });

  test("settled arrows satisfy the glue invariant against dome poses", () => {
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
    expect(m.renderList.find((r) => r.id === "c")!.exiting).toBe(false);
    for (let i = 0; i < 41; i++) m.step(10);
    expect(m.settled).toBe(false);
    m.step(10);
    expect(m.settled).toBe(true);
    // Exits dropped; final poses equal the next dome exactly.
    expect(m.sample("b")).toBeNull();
    expect(m.renderList.map((r) => r.id).sort()).toEqual(["a", "c", "f"]);
    const dome = domeProject(layoutA());
    expect(m.sample("a")!.pos.distanceTo(dome.byId["a"]!.pos)).toBeLessThan(1e-6);
    expect(m.sample("f")!.pos.distanceTo(dome.byId["f"]!.pos)).toBeLessThan(1e-6);
  });

  test("progress reports the eased curve", () => {
    const m = start();
    for (let i = 0; i < 21; i++) m.step(10);
    close(m.progress, easeOutCubic(210 / DURATION_MS), 1e-9);
  });

  test("deterministic: 42x10ms equals 1x420ms", () => {
    const m1 = start();
    const m2 = start();
    for (let i = 0; i < 42; i++) m1.step(10);
    m2.step(DURATION_MS);
    for (const id of ["a", "f", "c"]) {
      expect(m1.sample(id)!.pos.distanceTo(m2.sample(id)!.pos)).toBeLessThan(1e-9);
      close(m1.sample(id)!.opacity, m2.sample(id)!.opacity, 1e-9);
    }
  });

  test("interrupt retargets from the live mid-flight state", () => {
    const m = start();
    for (let i = 0; i < 15; i++) m.step(10);
    const live = m.sample("a")!.pos.clone();
    m.setLayout(layoutF()); // reverse mid-flight
    expect(m.settled).toBe(false);
    expect(m.sample("a")!.pos.distanceTo(live)).toBeLessThan(1e-6); // position-continuous
  });

  test("a re-derived but identical layout never animates (theme flips)", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.setLayout(layoutF()); // fresh object, same placements
    expect(m.settled).toBe(true);
  });

  test("reduced motion snaps refocus instantly", () => {
    const m = createCardMotion({ reducedMotion: () => true });
    m.setLayout(layoutF());
    m.setLayout(layoutA());
    expect(m.settled).toBe(true);
    expect(m.sample("b")).toBeNull();
    expect(m.sample("c")).not.toBeNull();
  });
});

describe("arrows during transition", () => {
  test("glue invariant holds mid-flight; enter/exit opacity ramps", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.setLayout(layoutA());
    const at0 = Object.fromEntries(m.arrowStates().map((a) => [a.key, a]));
    close(at0["c→a"]!.opacity, 0, 1e-9); // enter starts invisible
    close(at0["f→b"]!.opacity, 0.85, 1e-9); // exit starts at base
    for (let i = 0; i < 15; i++) m.step(10);
    for (const a of m.arrowStates()) {
      const from = m.sample(a.fromId)!;
      const anchorWorld = new THREE.Vector3(a.fromLocal.x, a.fromLocal.y, 0)
        .applyQuaternion(from.quat)
        .add(from.pos);
      expect(a.path[0]!.distanceTo(anchorWorld)).toBeLessThan(1e-9);
    }
    // Exit arrows clear out by half the transition.
    for (let i = 0; i < 15; i++) m.step(10);
    const late = Object.fromEntries(m.arrowStates().map((a) => [a.key, a]));
    close(late["f→b"]!.opacity, 0, 1e-6);
    for (let i = 0; i < 12; i++) m.step(10);
    expect(m.arrowStates().find((a) => a.key === "f→b")).toBeUndefined();
  });
});

describe("drag", () => {
  test("clamps and rotates the pick poses, not the raw samples", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.dragBy(100000, 100000, 1);
    close(m.drag.yaw, 0.9);
    close(m.drag.pitch, 0.6);
    const raw = m.sample("f")!.pos;
    close(raw.x, 0, 1e-6); // raw sample untouched
    const picked = m.pickItems().find((p) => p.id === "f")!;
    expect(picked.pos.distanceTo(raw)).toBeGreaterThan(100); // composed pose moved
    const posed = m.pose("f")!;
    expect(posed.distanceTo(picked.pos)).toBeLessThan(1e-9);
  });

  test("sensitivity follows zoom·R (grab the surface)", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.dragBy(90, 0, 0.5);
    close(m.drag.yaw, 90 / (0.5 * m.R), 1e-12);
  });

  test("refocus bakes the drag into the start state and zeroes it", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.dragBy(200, 80, 1);
    const dragged = m.pose("a")!.clone();
    m.setLayout(layoutA());
    close(m.drag.yaw, 0);
    close(m.drag.pitch, 0);
    // e=0 sample equals the previously dragged rendered pose (continuity).
    expect(m.sample("a")!.pos.distanceTo(dragged)).toBeLessThan(1e-6);
  });
});

describe("view tween", () => {
  test("first targets seed instantly; later ones ease exponentially and snap", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.setViewTargets(0.5, -100);
    close(m.view.zoom, 0.5);
    close(m.view.shift, -100);
    expect(m.settled).toBe(true);
    m.setViewTargets(1, 0);
    expect(m.settled).toBe(false);
    m.step(90); // one time constant: 1 - e^-1 of the way there
    close(m.view.zoom, 0.5 + 0.5 * (1 - Math.exp(-1)), 1e-6);
    for (let i = 0; i < 200; i++) m.step(90);
    close(m.view.zoom, 1);
    close(m.view.shift, 0);
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
