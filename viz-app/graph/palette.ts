// Graph paint rules, extracted pure from the scene so the color math is
// unit-testable: dark backgrounds get the glow look (>1.0 boosts that the
// bloom pass renders as a corona), light ones get ink-on-paper (colors fade
// toward the page, never toward black). Callers pass THREE.Color scratch
// objects pre-set to the base color; these mutate in place (hot loop).
import * as THREE from "three";

/** A node's relation to the current selection. */
export type SelRel = "none" | "hero" | "neighbor" | "rest";

export const selRel = (i: number, selected: number | null, adj: ReadonlySet<number>[]): SelRel =>
  selected === null ? "none" : i === selected ? "hero" : adj[selected]!.has(i) ? "neighbor" : "rest";

/** Linear-space relative luminance; mid gray (~0.26) still counts as light. */
export const isDarkBg = (bg: THREE.Color): boolean => 0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b < 0.15;

export interface PaintCtx {
  darkBg: boolean;
  bg: THREE.Color;
}

export function paintNodeColor(c: THREE.Color, rel: SelRel, dimmed: boolean, ctx: PaintCtx): void {
  if (ctx.darkBg) {
    if (dimmed) {
      c.multiplyScalar(0.12);
      return;
    }
    const brightness = (c.r + c.g + c.b) / 3;
    let boost = (1.2 + brightness * 0.8) * 1.875; // bloom feeds on the >1.0 excess
    if (rel === "hero") boost *= 1.5;             // hero glow
    else if (rel === "neighbor") boost *= 1.15;   // linked nodes brighten
    else if (rel === "rest") boost *= 0.4;        // the rest recede
    c.multiplyScalar(boost);
  } else {
    // Ink-on-paper: de-emphasis fades toward the page, never toward black.
    // Non-neighbors keep ~40% presence — the dark path's 0.4× equivalent.
    if (dimmed) c.lerp(ctx.bg, 0.88);
    else if (rel === "neighbor") c.lerp(ctx.bg, 0.08);
    else if (rel === "rest") c.lerp(ctx.bg, 0.6);
  }
}

export interface EdgeState {
  dim: boolean;
  active: boolean;
  hasSelection: boolean;
}

export function paintEdgeColors(ca: THREE.Color, cb: THREE.Color, s: EdgeState, ctx: PaintCtx): void {
  if (ctx.darkBg) {
    // Rest state: a uniform quiet web; edges only assert themselves for a selection.
    const k = s.dim ? (s.hasSelection && !s.active ? 0.04 : 0.08) : s.hasSelection ? 0.75 : 0.28;
    ca.multiplyScalar(k);
    cb.multiplyScalar(k);
  } else {
    // Normal blending: visibility comes from staying darker than the page.
    // The rest of the web stays a visible whisper during a selection.
    const t = s.dim ? (s.hasSelection && !s.active ? 0.8 : 0.84) : s.hasSelection ? 0.08 : 0.42;
    ca.lerp(ctx.bg, t);
    cb.lerp(ctx.bg, t);
  }
}
