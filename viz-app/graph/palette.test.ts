// Paint-rule math pinned before the Threlte migration: these values are the
// dark-glow / ink-on-paper contract the scene renders from. Colors are built
// from raw components (no hex) so no color-space conversion muddies expected
// values.
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { isDarkBg, paintEdgeColors, paintNodeColor, selRel, type SelRel } from "./palette";

const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const near = (a: THREE.Color, r: number, g: number, b: number) => {
  expect(a.r).toBeCloseTo(r, 5);
  expect(a.g).toBeCloseTo(g, 5);
  expect(a.b).toBeCloseTo(b, 5);
};

describe("selRel", () => {
  const adj = [new Set([1]), new Set([0]), new Set<number>()];
  test("no selection", () => expect(selRel(0, null, adj)).toBe("none"));
  test("hero", () => expect(selRel(1, 1, adj)).toBe("hero"));
  test("neighbor", () => expect(selRel(1, 0, adj)).toBe("neighbor"));
  test("rest", () => expect(selRel(2, 0, adj)).toBe("rest"));
});

describe("isDarkBg", () => {
  test("black is dark, white is light", () => {
    expect(isDarkBg(c(0, 0, 0))).toBe(true);
    expect(isDarkBg(c(1, 1, 1))).toBe(false);
  });
  test("mid gray (~0.26) still counts as light", () => {
    expect(isDarkBg(c(0.26, 0.26, 0.26))).toBe(false);
  });
  test("luminance is channel-weighted, not averaged", () => {
    expect(isDarkBg(c(0.5, 0, 0))).toBe(true); // 0.2126*0.5 ≈ 0.106
    expect(isDarkBg(c(0, 0.5, 0))).toBe(false); // 0.7152*0.5 ≈ 0.358
  });
});

describe("paintNodeColor — dark (glow)", () => {
  const ctx = { darkBg: true, bg: c(0, 0, 0) };
  // brightness (1+0.5+0)/3 = 0.5 → base boost (1.2+0.4)*1.875 = 3.0
  const base = () => c(1, 0.5, 0);

  test("unselected boost feeds bloom past 1.0", () => {
    const col = base();
    paintNodeColor(col, "none", false, ctx);
    near(col, 3, 1.5, 0);
  });
  test("hero ×1.5, neighbor ×1.15, rest ×0.4", () => {
    const factors: [SelRel, number][] = [
      ["hero", 1.5],
      ["neighbor", 1.15],
      ["rest", 0.4],
    ];
    for (const [rel, k] of factors) {
      const col = base();
      paintNodeColor(col, rel, false, ctx);
      near(col, 3 * k, 1.5 * k, 0);
    }
  });
  test("dimmed collapses to 0.12× regardless of selection", () => {
    const col = base();
    paintNodeColor(col, "hero", true, ctx);
    near(col, 0.12, 0.06, 0);
  });
});

describe("paintNodeColor — light (ink-on-paper)", () => {
  const bg = c(1, 1, 1);
  const ctx = { darkBg: false, bg };

  test("no selection leaves the base color untouched", () => {
    const col = c(0.2, 0.4, 0.6);
    paintNodeColor(col, "none", false, ctx);
    near(col, 0.2, 0.4, 0.6);
  });
  test("hero stays full strength", () => {
    const col = c(0.2, 0.4, 0.6);
    paintNodeColor(col, "hero", false, ctx);
    near(col, 0.2, 0.4, 0.6);
  });
  test("de-emphasis fades toward the page, never toward black", () => {
    const neighbor = c(0, 0, 0);
    paintNodeColor(neighbor, "neighbor", false, ctx);
    near(neighbor, 0.08, 0.08, 0.08); // lerp(bg, 0.08)
    const rest = c(0, 0, 0);
    paintNodeColor(rest, "rest", false, ctx);
    near(rest, 0.6, 0.6, 0.6); // lerp(bg, 0.6)
  });
  test("dimmed keeps a whisper of presence (lerp 0.88, not erase)", () => {
    const col = c(0, 0, 0);
    paintNodeColor(col, "rest", true, ctx);
    near(col, 0.88, 0.88, 0.88);
  });
});

describe("paintEdgeColors", () => {
  const dark = { darkBg: true, bg: c(0, 0, 0) };
  const light = { darkBg: false, bg: c(1, 1, 1) };
  const pair = () => [c(1, 0, 0), c(0, 1, 0)] as const;

  test("dark: rest-state web is a uniform 0.28×", () => {
    const [ca, cb] = pair();
    paintEdgeColors(ca, cb, { dim: false, active: true, hasSelection: false }, dark);
    near(ca, 0.28, 0, 0);
    near(cb, 0, 0.28, 0);
  });
  test("dark: selection asserts active edges (0.75×) and mutes the rest (0.04×)", () => {
    const [ca, cb] = pair();
    paintEdgeColors(ca, cb, { dim: false, active: true, hasSelection: true }, dark);
    near(ca, 0.75, 0, 0);
    const [cc, cd] = pair();
    paintEdgeColors(cc, cd, { dim: true, active: false, hasSelection: true }, dark);
    near(cc, 0.04, 0, 0);
  });
  test("dark: dimmed without selection sits at 0.08×", () => {
    const [ca, cb] = pair();
    paintEdgeColors(ca, cb, { dim: true, active: true, hasSelection: false }, dark);
    near(ca, 0.08, 0, 0);
    near(cb, 0, 0.08, 0);
  });
  test("light: fades are lerps toward the page", () => {
    const [ca] = [c(0, 0, 0)];
    paintEdgeColors(ca, c(0, 0, 0), { dim: false, active: true, hasSelection: false }, light);
    near(ca, 0.42, 0.42, 0.42);
    const cc = c(0, 0, 0);
    paintEdgeColors(cc, c(0, 0, 0), { dim: true, active: false, hasSelection: true }, light);
    near(cc, 0.8, 0.8, 0.8);
  });
});
