// Deterministic fly-tween stepping — the graph counterpart of
// cards/motion.test.ts. Plain fields + explicit dt: no clock, no renderer.
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createGraphMotion } from "./motion.svelte";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe("graph motion", () => {
  test("starts settled and step() is a no-op", () => {
    const m = createGraphMotion();
    expect(m.settled).toBe(true);
    const pos = v(1, 2, 3);
    expect(m.step(16, pos, v(0, 0, 0))).toBe(false);
    expect(pos).toEqual(v(1, 2, 3));
  });

  test("flyFrom exposes the tween's start pose while in flight, null when settled", () => {
    const m = createGraphMotion();
    expect(m.flyFrom).toBeNull();
    m.flyTo(v(5, 6, 7), v(0, 0, 0), v(100, 0, 0), v(0, 0, 0));
    expect(m.flyFrom).toEqual(v(5, 6, 7));
    m.step(200, v(0, 0, 0), v(0, 0, 0));
    expect(m.flyFrom).toEqual(v(5, 6, 7)); // frozen at fly start, not live
    m.step(10_000, v(0, 0, 0), v(0, 0, 0));
    expect(m.flyFrom).toBeNull();
  });

  test("flyTo unsettles; the tween eases out and lands exactly", () => {
    const m = createGraphMotion();
    m.flyTo(v(0, 0, 0), v(0, 0, 0), v(100, 0, 0), v(10, 0, 0));
    expect(m.settled).toBe(false);
    const pos = v(0, 0, 0);
    const tgt = v(0, 0, 0);
    // Half the duration: t=0.5, easeOutCubic → 1-(0.5)^3 = 0.875
    expect(m.step(416.5, pos, tgt)).toBe(true);
    expect(pos.x).toBeCloseTo(87.5, 3);
    expect(tgt.x).toBeCloseTo(8.75, 3);
    expect(m.settled).toBe(false);
    // The rest of the duration completes and settles on the exact target.
    m.step(416.5, pos, tgt);
    expect(pos.x).toBe(100);
    expect(tgt.x).toBe(10);
    expect(m.settled).toBe(true);
    expect(m.step(16, pos, tgt)).toBe(false);
  });

  test("duration is dt-based, not frame-based: many small steps land where few large ones do", () => {
    const a = createGraphMotion();
    const b = createGraphMotion();
    a.flyTo(v(0, 0, 0), v(0, 0, 0), v(100, 0, 0), v(0, 0, 0));
    b.flyTo(v(0, 0, 0), v(0, 0, 0), v(100, 0, 0), v(0, 0, 0));
    const posA = v(0, 0, 0);
    const posB = v(0, 0, 0);
    for (let i = 0; i < 25; i++) a.step(400 / 25, posA, v(0, 0, 0)); // 25 × 16ms
    b.step(400, posB, v(0, 0, 0)); // one 400ms step
    expect(posA.x).toBeCloseTo(posB.x, 3);
  });

  test("an oversized dt clamps to the end pose", () => {
    const m = createGraphMotion();
    m.flyTo(v(0, 0, 0), v(0, 0, 0), v(100, 0, 0), v(10, 0, 0));
    const pos = v(0, 0, 0);
    const tgt = v(0, 0, 0);
    m.step(10_000, pos, tgt);
    expect(pos.x).toBe(100);
    expect(m.settled).toBe(true);
  });

  test("cancelFly freezes the pose mid-flight and settles", () => {
    const m = createGraphMotion();
    m.flyTo(v(0, 0, 0), v(0, 0, 0), v(100, 0, 0), v(0, 0, 0));
    const pos = v(0, 0, 0);
    m.step(200, pos, v(0, 0, 0));
    const frozen = pos.clone();
    m.cancelFly();
    expect(m.settled).toBe(true);
    expect(m.step(200, pos, v(0, 0, 0))).toBe(false);
    expect(pos).toEqual(frozen);
  });

  test("a new flyTo mid-flight restarts from the given pose", () => {
    const m = createGraphMotion();
    m.flyTo(v(0, 0, 0), v(0, 0, 0), v(100, 0, 0), v(0, 0, 0));
    const pos = v(0, 0, 0);
    m.step(400, pos, v(0, 0, 0));
    m.flyTo(pos, v(0, 0, 0), v(-50, 0, 0), v(0, 0, 0));
    const start = pos.clone();
    m.step(1, pos, v(0, 0, 0));
    expect(Math.abs(pos.x - start.x)).toBeLessThan(1); // continues from the handoff pose
    m.step(10_000, pos, v(0, 0, 0));
    expect(pos.x).toBe(-50);
  });
});
