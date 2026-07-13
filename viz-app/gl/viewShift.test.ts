import { expect, test } from "bun:test";
import { SIDEBAR_W, viewOffsetX } from "./viewShift";

test("offset is half the inset imbalance", () => {
  expect(viewOffsetX(260, 460)).toBe(100);
  expect(viewOffsetX(260, 0)).toBe(-130);
  expect(viewOffsetX(0, 0)).toBe(0);
});

test("sidebar width single-sources the hand-synced literal", () => {
  expect(SIDEBAR_W).toBe(260);
});
