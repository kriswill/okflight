import { describe, expect, test } from "bun:test";
import { adjacency, labelVisible, MAX_LABELS, rankByDegree } from "./labels";

const edges: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
];

describe("adjacency / rankByDegree", () => {
  test("adjacency is symmetric", () => {
    const adj = adjacency(4, edges);
    expect([...adj[0]!].sort()).toEqual([1, 2, 3]);
    expect(adj[3]!.has(0)).toBe(true);
    expect(adj[3]!.has(1)).toBe(false);
  });
  test("rank orders busiest first", () => {
    const rank = rankByDegree(4, edges); // degrees: 3,2,2,1
    expect(rank[0]).toBe(0);
    expect(rank[3]).toBe(3);
  });
  test("MAX_LABELS caps the resident set", () => {
    expect(MAX_LABELS).toBe(28);
  });
});

describe("labelVisible", () => {
  const top = new Set([0, 1]);
  const base = { dimmed: false, top, selected: null, hover: null, isNeighbor: false };
  test("top-ranked nodes show at rest", () => {
    expect(labelVisible(0, base)).toBe(true);
    expect(labelVisible(5, base)).toBe(false);
  });
  test("selection, hover, and neighbors join the top set", () => {
    expect(labelVisible(5, { ...base, selected: 5 })).toBe(true);
    expect(labelVisible(5, { ...base, hover: 5 })).toBe(true);
    expect(labelVisible(5, { ...base, isNeighbor: true })).toBe(true);
  });
  test("dimmed always hides, even for the top set", () => {
    expect(labelVisible(0, { ...base, dimmed: true })).toBe(false);
    expect(labelVisible(5, { ...base, dimmed: true, selected: 5 })).toBe(false);
  });
});
