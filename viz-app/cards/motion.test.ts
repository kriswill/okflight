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

  test("cascading interrupts keep exiting cards from older layouts renderable", () => {
    // f -> a puts b in exit flight; retargeting to c while b is still
    // exiting must keep a render entry for b (it lives in samples, not in
    // either the previous or the next flat layout).
    const m = start(); // f -> a in flight; b exiting
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
  test("arrowList mirrors the tracked keys for structural mounting", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    expect(m.arrowList.map((a) => a.key).sort()).toEqual(["a→f", "f→b"]);
    m.setLayout(layoutA());
    // During the transition the exiting arrow stays mounted.
    expect(m.arrowList.map((a) => a.key).sort()).toEqual(["a→f", "c→a", "f→b"]);
    for (let i = 0; i < 42; i++) m.step(10);
    expect(m.arrowList.map((a) => a.key).sort()).toEqual(["a→f", "c→a"]);
  });

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

describe("arrow heads", () => {
  // The user-visible contract: the tube stops at the cone's flat base
  // center and meets it at 90°; the apex touches the card edge exactly.
  test("tube terminates at the head's base center via a straight perpendicular stem", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    expect(m.arrowStates().length).toBeGreaterThan(0);
    for (const a of m.arrowStates()) {
      const to = m.sample(a.toId)!;
      const toTan = new THREE.Vector3(0, 1, 0).applyQuaternion(to.quat);
      const anchor = new THREE.Vector3(a.toLocal.x, a.toLocal.y, 0).applyQuaternion(to.quat).add(to.pos);
      const last = a.path[a.path.length - 1]!;
      const prev = a.path[a.path.length - 2]!;
      expect(last.distanceTo(anchor.clone().addScaledVector(toTan, HEAD_H))).toBeLessThan(1e-9);
      const d = last.clone().sub(prev).normalize();
      expect(d.dot(toTan.clone().negate())).toBeGreaterThan(0.999999);
      const apex = new THREE.Vector3(0, HEAD_H / 2, 0).applyQuaternion(a.head.quat).add(a.head.pos);
      expect(apex.distanceTo(anchor)).toBeLessThan(1e-9);
    }
  });

  test("two-way arrows get the same treatment at the tail", () => {
    const mutual = buildModel({
      nodes: [node("f", "Decision", "Focus"), node("e", "Pattern", "Echo")],
      edges: [
        { s: "e", t: "f" },
        { s: "f", t: "e" },
      ],
      cfg: cfg(),
    });
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutCards(cardGraph(mutual, "f", 1, all)!));
    const a = m.arrowStates().find((s) => s.twoWay)!;
    const from = m.sample(a.fromId)!;
    const fromTan = new THREE.Vector3(0, -1, 0).applyQuaternion(from.quat);
    const anchor = new THREE.Vector3(a.fromLocal.x, a.fromLocal.y, 0).applyQuaternion(from.quat).add(from.pos);
    // Path starts at the tail cone's base center, leaving perpendicular.
    expect(a.path[0]!.distanceTo(anchor.clone().addScaledVector(fromTan, HEAD_H))).toBeLessThan(1e-9);
    const d0 = a.path[1]!.clone().sub(a.path[0]!).normalize();
    expect(d0.dot(fromTan)).toBeGreaterThan(0.999999);
    const tailApex = new THREE.Vector3(0, HEAD_H / 2, 0).applyQuaternion(a.tailHead!.quat).add(a.tailHead!.pos);
    expect(tailApex.distanceTo(anchor)).toBeLessThan(1e-9);
  });
});

describe("drag", () => {
  // Drag is a SUBTLE reorientation about the focus card (the origin), never
  // a globe spin: tight clamps, fixed per-pixel sensitivity, and — the core
  // contract — the focus card stays (essentially) centered at all times.
  test("clamps tight and keeps the focus card centered while neighbors parallax", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.dragBy(100000, 100000);
    close(m.drag.yaw, 0.18);
    close(m.drag.pitch, 0.12);
    const raw = m.sample("f")!.pos;
    close(raw.x, 0, 1e-6); // raw sample untouched
    // The focus sits at the pivot: only its tiny lift vector rotates.
    const pickedFocus = m.pickItems().find((p) => p.id === "f")!;
    expect(pickedFocus.pos.distanceTo(raw)).toBeLessThan(2);
    // Ring cards get visible-but-moderate parallax, not relocation.
    const rawA = m.sample("a")!.pos;
    const pickedA = m.pickItems().find((p) => p.id === "a")!;
    const shift = pickedA.pos.distanceTo(rawA);
    expect(shift).toBeGreaterThan(10);
    expect(shift).toBeLessThan(80);
    const posed = m.pose("a")!;
    expect(posed.distanceTo(pickedA.pos)).toBeLessThan(1e-9);
  });

  test("fixed per-pixel sensitivity (independent of zoom and dome size)", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.dragBy(90, 0);
    close(m.drag.yaw, 90 * 0.0009, 1e-12);
  });

  test("refocus bakes the drag into the start state and zeroes it", () => {
    const m = createCardMotion({ reducedMotion: () => false });
    m.setLayout(layoutF());
    m.dragBy(200, 80);
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
