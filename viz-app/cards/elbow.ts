// Arrow geometry for the card view. Every connector is a cubic bezier with
// axis-aligned tangents at both ends, so arrows leave and enter card edges
// perpendicular. axis "y" (default) is the TheBrain-style downward flow
// (vertical tangents, upper anchor to lower anchor); axis "x" is the
// horizontal-flow variant (leftward anchor to rightward anchor). Pure math:
// no three.js, no DOM.

export interface Pt {
  x: number;
  y: number;
}

/** Arrowhead triangle: tip on the path end, wings trailing behind it. */
export interface Head {
  tip: Pt;
  left: Pt;
  right: Pt;
}

/** Sampled S-curve between two edge anchors. `bend` scales how far the
 *  axis-aligned tangents extend (fraction of the along-flow drop). */
export function elbowPath(
  from: Pt,
  to: Pt,
  opts?: { segments?: number; bend?: number; axis?: "y" | "x" },
): Pt[] {
  const segments = opts?.segments ?? 24;
  const bend = opts?.bend ?? 0.4;
  const c1 = { ...from };
  const c2 = { ...to };
  if ((opts?.axis ?? "y") === "y") {
    const k = bend * (from.y - to.y);
    c1.y = from.y - k;
    c2.y = to.y + k;
  } else {
    const k = bend * (to.x - from.x);
    c1.x = from.x + k;
    c2.x = to.x - k;
  }
  const pts: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    // Exact anchors at the ends — no float drift on the joints.
    if (i === 0) pts.push({ ...from });
    else if (i === segments) pts.push({ ...to });
    else
      pts.push({
        x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
        y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
      });
  }
  return pts;
}

/** i-th of n anchor points along a horizontal card edge, spread over the
 *  middle 70% of the width so arrows never touch a card's corners. */
export function edgeSlot(cx: number, edgeY: number, width: number, i: number, n: number): Pt {
  const usable = width * 0.7;
  return { x: cx + usable * ((i + 1) / (n + 1) - 0.5), y: edgeY };
}

/** i-th of n anchor points along a vertical card edge (horizontal flow),
 *  spread over the middle 70% of the height. */
export function sideSlot(cy: number, edgeX: number, height: number, i: number, n: number): Pt {
  const usable = height * 0.7;
  return { x: edgeX, y: cy + usable * ((i + 1) / (n + 1) - 0.5) };
}

/** Arrowhead at the path's end (default) or start (`atStart`), oriented
 *  along the adjacent segment, pointing outward from the path. */
export function arrowHead(path: Pt[], size = 1, atStart = false): Head {
  const a = atStart ? path[1]! : path[path.length - 2]!;
  const b = atStart ? path[0]! : path[path.length - 1]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const bx = b.x - ux * size;
  const by = b.y - uy * size;
  const w = size * 0.5;
  return {
    tip: { ...b },
    left: { x: bx - uy * w, y: by + ux * w },
    right: { x: bx + uy * w, y: by - ux * w },
  };
}
