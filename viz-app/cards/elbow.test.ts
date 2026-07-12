// The elbow grammar: every arrow in the card view is a vertical-out /
// vertical-in cubic S-curve from an upper anchor down to a lower anchor, so
// flows always read top-to-bottom. These tests pin the curve's contract —
// exact endpoints, vertical tangents, monotonic descent — because the layout
// and the e2e assertions both build on it.
import { describe, expect, test } from "bun:test";
import { arrowHead, edgeSlot, elbowPath } from "./elbow";

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe("elbowPath", () => {
  const from = { x: -20, y: 40 };
  const to = { x: 15, y: -10 };
  const path = elbowPath(from, to);

  test("first and last points are exactly the anchors", () => {
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]).toEqual(to);
  });

  test("default sampling yields segments+1 = 25 points", () => {
    expect(path).toHaveLength(25);
    expect(elbowPath(from, to, { segments: 8 })).toHaveLength(9);
  });

  test("tangents are vertical at both ends", () => {
    // Sampled points drift in x by O(t^2), so assert the tangent *direction*:
    // at fine sampling the end segments must be nearly vertical.
    const fine = elbowPath(from, to, { segments: 1000 });
    const slope = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(b.x - a.x) / Math.abs(b.y - a.y);
    expect(slope(fine[0]!, fine[1]!)).toBeLessThan(0.01);
    expect(slope(fine[fine.length - 2]!, fine[fine.length - 1]!)).toBeLessThan(0.01);
    // Default sampling stays visually vertical too (catches swapped axes).
    expect(slope(path[0]!, path[1]!)).toBeLessThan(0.15);
    expect(slope(path[path.length - 2]!, path[path.length - 1]!)).toBeLessThan(0.15);
  });

  test("y descends monotonically when to is below from", () => {
    for (let i = 1; i < path.length; i++) expect(path[i]!.y).toBeLessThanOrEqual(path[i - 1]!.y);
  });

  test("vertically aligned anchors degrade to a straight finite line", () => {
    const straight = elbowPath({ x: 5, y: 30 }, { x: 5, y: 0 });
    for (const p of straight) {
      close(p.x, 5);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe("edgeSlot", () => {
  test("single slot sits at the edge center", () => {
    expect(edgeSlot(10, -3, 20, 0, 1)).toEqual({ x: 10, y: -3 });
  });

  test("three slots spread evenly, symmetric, inside the card width", () => {
    const s = [0, 1, 2].map((i) => edgeSlot(0, 5, 20, i, 3));
    close(s[1]!.x, 0);
    close(s[0]!.x, -s[2]!.x);
    expect(s[0]!.x).toBeGreaterThan(-10);
    expect(s[2]!.x).toBeLessThan(10);
    expect(s[0]!.x).toBeLessThan(s[1]!.x);
    for (const p of s) expect(p.y).toBe(5);
  });
});

describe("arrowHead", () => {
  const path = elbowPath({ x: 0, y: 30 }, { x: 0, y: 0 });

  test("end head: tip is the last point, wings sit behind it, symmetric", () => {
    const h = arrowHead(path, 2);
    expect(h.tip).toEqual(path[path.length - 1]!);
    // Final segment points down, so the wings trail above the tip.
    expect(h.left.y).toBeGreaterThan(h.tip.y);
    expect(h.right.y).toBeGreaterThan(h.tip.y);
    close(h.left.y, h.right.y);
    close(h.left.x + h.right.x, 2 * h.tip.x);
  });

  test("start head: tip is the first point, oriented opposite (upward)", () => {
    const h = arrowHead(path, 2, true);
    expect(h.tip).toEqual(path[0]!);
    expect(h.left.y).toBeLessThan(h.tip.y);
    expect(h.right.y).toBeLessThan(h.tip.y);
  });
});
