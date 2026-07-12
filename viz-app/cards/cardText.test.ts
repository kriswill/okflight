// wrapLines is the pure half of card-face text: word wrap under an injected
// measure function (tests use char count; the renderer passes canvas
// measureText). The canvas drawing itself (makeCardFace) is e2e-verified —
// happy-dom has no real 2D text metrics.
import { describe, expect, test } from "bun:test";
import { wrapLines } from "./cardText";

const measure = (s: string) => s.length;

describe("wrapLines", () => {
  test("short text stays on one line", () => {
    expect(wrapLines("hello", 10, measure, 2)).toEqual(["hello"]);
  });

  test("wraps at word boundaries", () => {
    expect(wrapLines("alpha beta gamma", 11, measure, 3)).toEqual(["alpha beta", "gamma"]);
  });

  test("clamps to maxLines with an ellipsis on the last line", () => {
    expect(wrapLines("aa bb cc dd ee ff", 5, measure, 2)).toEqual(["aa bb", "cc d…"]);
  });

  test("hard-breaks a single over-long word", () => {
    expect(wrapLines("abcdefghij", 4, measure, 3)).toEqual(["abcd", "efgh", "ij"]);
  });

  test("empty or whitespace-only text yields no lines", () => {
    expect(wrapLines("", 10, measure, 2)).toEqual([]);
    expect(wrapLines("   ", 10, measure, 2)).toEqual([]);
  });
});
