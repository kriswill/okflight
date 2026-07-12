// Refocus transitions are one rigid "the sphere turned" gesture: every card
// slerps along a great circle for the same 420ms; the new focus's slerp IS
// the pole rotation; exits keep rolling outward past the horizon while they
// fade; enters roll in from where the pre-rotation sphere had them. These
// tests pin the track builder and sampler the motion store steps through.
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildModel } from "../data";
import { cfg, node } from "../test-helpers";
import { CARD_H, CARD_W, cardGraph, FOCUS_H, FOCUS_W, FOCUS_Z, layoutCards } from "./cardLayout";
import { domeProject, extendFromPole, rotationToPole } from "./dome";
import { buildTransition, DURATION_MS, easeOutCubic, EXIT_DIST, sampleTrack, snapshotOf } from "./transition";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const POLE = new THREE.Vector3(0, 0, 1);

const model = buildModel({
  nodes: [
    node("f", "Decision", "Focus"),
    node("a", "Pattern", "Alpha"),
    node("b", "Playbook", "Bravo"),
    node("c", "Reference", "Charlie"),
  ],
  edges: [
    { s: "a", t: "f" }, // a -> f: a is in-row of f; f is out-row of a
    { s: "f", t: "b" },
    { s: "c", t: "a" },
  ],
  cfg: cfg(),
});
const all = () => true;
const prevDome = domeProject(layoutCards(cardGraph(model, "f", 1, all)!));
const nextDome = domeProject(layoutCards(cardGraph(model, "a", 1, all)!));
const spec = buildTransition(snapshotOf(prevDome), nextDome);
const byId = Object.fromEntries(spec.tracks.map((t) => [t.id, t]));

describe("buildTransition", () => {
  test("classifies shared / enter / exit", () => {
    expect(byId["f"]!.kind).toBe("shared");
    expect(byId["a"]!.kind).toBe("shared");
    expect(byId["c"]!.kind).toBe("enter");
    expect(byId["b"]!.kind).toBe("exit");
    expect(spec.duration).toBe(DURATION_MS);
    expect(spec.R0).toBe(prevDome.R);
    expect(spec.R1).toBe(nextDome.R);
  });

  test("shared endpoints: from prev dome dir to next dome dir", () => {
    const t = byId["f"]!;
    close(t.v0.distanceTo(prevDome.byId["f"]!.dir), 0);
    close(t.v1.distanceTo(nextDome.byId["f"]!.dir), 0);
  });

  test("kind-change scale morph endpoints (focus<->card)", () => {
    // a grows card -> focus: starts at the ratio, ends at 1.
    close(byId["a"]!.s0x, CARD_W / FOCUS_W);
    close(byId["a"]!.s0y, CARD_H / FOCUS_H);
    close(byId["a"]!.s1x, 1);
    // f shrinks focus -> card.
    close(byId["f"]!.s0x, FOCUS_W / CARD_W);
    close(byId["f"]!.s0y, FOCUS_H / CARD_H);
  });

  test("exit rolls a fixed surface distance past its rotation-carried position", () => {
    // Distance (not angle): on the big scaffold dome a fixed angle would
    // fling exits thousands of units; EXIT_DIST is world units of travel.
    const t = byId["b"]!;
    const qPole = rotationToPole(prevDome.byId["a"]!.lon, prevDome.byId["a"]!.lat);
    const carried = prevDome.byId["b"]!.dir.clone().applyQuaternion(qPole);
    close(t.v1.angleTo(POLE), carried.angleTo(POLE) + EXIT_DIST / nextDome.R, 1e-9);
    expect(t.o1).toBe(0);
  });

  test("enter starts from the pre-rotation image of its final position", () => {
    const t = byId["c"]!;
    const qPole = rotationToPole(prevDome.byId["a"]!.lon, prevDome.byId["a"]!.lat);
    const expected = extendFromPole(
      nextDome.byId["c"]!.dir.clone().applyQuaternion(qPole.clone().invert()),
      EXIT_DIST / nextDome.R,
    );
    close(t.v0.distanceTo(expected), 0, 1e-9);
    expect(t.o0).toBe(0);
  });

  test("new focus absent from prev falls back to identity pole rotation", () => {
    // Refocus onto c, which is not in prevDome: exits must still roll outward.
    const nextC = domeProject(layoutCards(cardGraph(model, "c", 1, all)!));
    const spec2 = buildTransition(snapshotOf(prevDome), nextC);
    const exitB = spec2.tracks.find((t) => t.id === "b")!;
    close(exitB.v1.angleTo(POLE), prevDome.byId["b"]!.dir.angleTo(POLE) + EXIT_DIST / nextC.R, 1e-9);
  });
});

describe("sampleTrack", () => {
  test("e=0 and e=1 hit the exact endpoints (pos, opacity, scale)", () => {
    const t = byId["a"]!;
    const s0 = sampleTrack(t, spec.R0, 0);
    close(s0.dir.distanceTo(t.v0), 0);
    close(s0.opacity, 1); // shared card fully visible at rest
    close(s0.sx, CARD_W / FOCUS_W);
    const s1 = sampleTrack(t, spec.R1, 1);
    close(s1.dir.distanceTo(t.v1), 0);
    close(s1.opacity, 1);
    close(s1.sx, 1);
    // Final pos: the new focus lands exactly at the flat origin + lift.
    close(s1.pos.x, 0, 1e-6);
    close(s1.pos.y, 0, 1e-6);
    close(s1.pos.z, FOCUS_Z, 1e-6);
  });

  test("slerp: unit dirs and constant angular speed", () => {
    const t = byId["f"]!;
    const total = t.v0.angleTo(t.v1);
    for (const e of [0.25, 0.5, 0.75]) {
      const s = sampleTrack(t, spec.R1, e);
      close(s.dir.length(), 1, 1e-9);
      close(s.dir.angleTo(t.v0), total * e, 1e-9);
    }
  });

  test("the new focus's track is the pole rotation: it lands on the pole", () => {
    const t = byId["a"]!;
    close(t.v1.distanceTo(POLE), 0, 1e-9);
    close(t.v0.angleTo(POLE), t.v0.angleTo(t.v1), 1e-12);
  });

  test("exit opacity reaches 0 by e=0.8 and stays there", () => {
    const t = byId["b"]!;
    expect(sampleTrack(t, spec.R1, 0.4).opacity).toBeGreaterThan(0);
    close(sampleTrack(t, spec.R1, 0.8).opacity, 0, 1e-9);
    close(sampleTrack(t, spec.R1, 1).opacity, 0, 1e-9);
  });

  test("enter fades in from 0 and scales 0.9 -> 1", () => {
    const t = byId["c"]!;
    close(sampleTrack(t, spec.R1, 0).opacity, 0);
    close(sampleTrack(t, spec.R1, 0).sx, 0.9);
    const late = sampleTrack(t, spec.R1, 0.9);
    expect(late.opacity).toBeGreaterThan(0.8);
    close(sampleTrack(t, spec.R1, 1).sx, 1);
  });

  test("R interpolation keeps every sample on the interpolated sphere", () => {
    const t = byId["f"]!;
    for (const e of [0, 0.3, 0.7, 1]) {
      const R = spec.R0 + (spec.R1 - spec.R0) * e;
      const s = sampleTrack(t, R, e);
      const C = new THREE.Vector3(0, 0, -R);
      const lift = t.lift0 + (t.lift1 - t.lift0) * e;
      close(s.pos.distanceTo(C), R + lift, 1e-6);
    }
  });

  test("quat follows the live dir (cards roll with the surface)", () => {
    const t = byId["f"]!;
    const s = sampleTrack(t, spec.R1, 0.5);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(s.quat);
    close(normal.distanceTo(s.dir), 0, 1e-9);
  });
});

describe("easeOutCubic", () => {
  test("matches the stepFly precedent", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    close(easeOutCubic(0.5), 1 - 0.5 ** 3);
  });
});
