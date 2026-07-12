// Frame-time arrow math for the animated card view. The static ArrowSpec
// endpoints become card-local anchors once per layout; every animated frame
// re-derives world anchors from the cards' live pose, bends the elbow in 3D
// along the cards' edge normals, and pins the head cones perpendicular to
// the card edge with the tube ending at each cone's base center — tips stay
// glued to both the tube and the card no matter how the dome turns. Pure
// three math; elbow.ts (the 2D grammar) untouched.
import * as THREE from "three";
import type { ArrowSpec, CardPlacement } from "./cardLayout";

export interface ArrowAnchor {
  cardId: string;
  /** Offset from the card center, in the card's local (tangent) frame. */
  local: { x: number; y: number };
}

/** Convert an ArrowSpec's precomputed flat endpoints into card-local
 *  anchors. Exact by construction: local = endpoint − card center. */
export function arrowAnchors(
  spec: ArrowSpec,
  byId: Record<string, CardPlacement>,
): { from: ArrowAnchor; to: ArrowAnchor } {
  const fc = byId[spec.fromId]!;
  const tc = byId[spec.toId]!;
  const first = spec.path[0]!;
  const last = spec.path[spec.path.length - 1]!;
  return {
    from: { cardId: spec.fromId, local: { x: first.x - fc.x, y: first.y - fc.y } },
    to: { cardId: spec.toId, local: { x: last.x - tc.x, y: last.y - tc.y } },
  };
}

/** Which edge a card-local anchor sits on, as its outward unit normal —
 *  the flow tangent for that endpoint. Anchors always land on an edge
 *  midline (slots are corner-inset), so the dominant normalized component
 *  decides. Orientation-agnostic: this is what lets the same arrow code
 *  serve vertical and horizontal layouts. */
export function edgeTangent(local: { x: number; y: number }, w: number, h: number): { x: number; y: number } {
  const rx = local.x / (w / 2);
  const ry = local.y / (h / 2);
  if (Math.abs(ry) >= Math.abs(rx)) return { x: 0, y: Math.sign(ry) || 1 };
  return { x: Math.sign(rx), y: 0 };
}

/** The 2D elbow generalized to 3D: control points extend along each card's
 *  edge tangent, scaled by the projected drop (bend · (other−this)·tangent),
 *  which reproduces the flat elbow exactly in the degenerate planar case.
 *  `fromTangent` points out of the departing edge, `toTangent` out of the
 *  receiving edge (the path arrives along −toTangent). */
export function elbowPath3(
  from: THREE.Vector3,
  fromTangent: THREE.Vector3,
  to: THREE.Vector3,
  toTangent: THREE.Vector3,
  opts?: { segments?: number; bend?: number },
): THREE.Vector3[] {
  const segments = opts?.segments ?? 24;
  const bend = opts?.bend ?? 0.4;
  const c1 = from.clone().addScaledVector(fromTangent, bend * to.clone().sub(from).dot(fromTangent));
  const c2 = to.clone().addScaledVector(toTangent, bend * from.clone().sub(to).dot(toTangent));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    if (i === 0) {
      pts.push(from.clone());
      continue;
    }
    if (i === segments) {
      pts.push(to.clone());
      continue;
    }
    const t = i / segments;
    const u = 1 - t;
    pts.push(
      new THREE.Vector3()
        .addScaledVector(from, u * u * u)
        .addScaledVector(c1, 3 * u * u * t)
        .addScaledVector(c2, 3 * u * t * t)
        .addScaledVector(to, t * t * t),
    );
  }
  return pts;
}

/** Cone transform for an arrowhead pinned to a card edge: apex exactly on
 *  the anchor, axis forced perpendicular to the edge (along −outward, into
 *  the card) regardless of how the sampled curve approaches, and `base` —
 *  the flat side's center, one head-height out along the edge tangent —
 *  which is exactly where the tube must terminate. */
export function edgeHead(
  anchor: THREE.Vector3,
  outward: THREE.Vector3,
  size: number,
): { pos: THREE.Vector3; quat: THREE.Quaternion; base: THREE.Vector3 } {
  const axis = outward.clone().negate();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  return {
    pos: anchor.clone().addScaledVector(outward, size / 2),
    quat,
    base: anchor.clone().addScaledVector(outward, size),
  };
}
