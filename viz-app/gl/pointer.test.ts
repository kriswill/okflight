import { describe, expect, test } from "bun:test";
import { ndc, pressTracker } from "./pointer";

describe("pressTracker", () => {
  test("sub-threshold press is a click", () => {
    const p = pressTracker();
    p.down(100, 100);
    expect(p.up(103, 102)).toBe(true);
    expect(p.isDown).toBe(false);
  });
  test("a drag past the threshold never clicks", () => {
    const p = pressTracker();
    p.down(100, 100);
    expect(p.up(100, 106)).toBe(false);
  });
  test("synthetic up with no matching down is ignored", () => {
    const p = pressTracker();
    expect(p.up(0, 0)).toBe(false);
  });
  test("cancel ends the press without a click", () => {
    const p = pressTracker();
    p.down(0, 0);
    p.cancel();
    expect(p.up(0, 0)).toBe(false);
  });
  test("threshold is configurable", () => {
    const p = pressTracker(10);
    p.down(0, 0);
    expect(p.up(0, 9)).toBe(true);
  });
});

describe("ndc", () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };
  test("corners map to ±1 with y flipped", () => {
    expect(ndc(10, 20, rect)).toEqual({ x: -1, y: 1 });
    expect(ndc(210, 120, rect)).toEqual({ x: 1, y: -1 });
  });
  test("center maps to origin", () => {
    expect(ndc(110, 70, rect)).toEqual({ x: 0, y: 0 });
  });
});
