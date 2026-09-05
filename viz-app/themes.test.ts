// Palette slots: 12 curated + 20 derived per theme, all present and distinct.
import { describe, expect, test } from "bun:test";
import { relLuminance } from "./color";
import { SLOT_COUNT, THEMES } from "./themes";

describe("theme palette slots", () => {
  test("every theme carries --s1..--s32, each a distinct hex", () => {
    expect(SLOT_COUNT).toBe(32);
    for (const t of THEMES) {
      const slots = Array.from({ length: SLOT_COUNT }, (_, i) => t.vars[`--s${i + 1}`]);
      for (const s of slots) expect(s).toMatch(/^#[0-9a-f]{6}$/);
      expect(new Set(slots).size).toBe(SLOT_COUNT);
    }
  });

  test("curated slots are untouched; derived slots stay legible on their theme surface", () => {
    const light = THEMES.find((t) => t.name === "light")!;
    const dark = THEMES.find((t) => t.name === "dark")!;
    expect(light.vars["--s1"]).toBe("#4478bc");
    expect(dark.vars["--s12"]).toBe("#77569b");
    for (let k = 13; k <= SLOT_COUNT; k++) {
      // Mid-lightness colors: never near-white on light, never near-black on dark.
      expect(relLuminance(light.vars[`--s${k}`]!)).toBeLessThan(0.6);
      expect(relLuminance(dark.vars[`--s${k}`]!)).toBeGreaterThan(0.08);
    }
  });
});
