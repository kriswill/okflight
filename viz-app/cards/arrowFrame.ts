// Frame-time arrow math for the animated card view. The static ArrowSpec
// endpoints become card-local anchors once per layout; every animated frame
// re-derives world anchors from the cards' live pose, bends the elbow in 3D
// along the cards' edge normals, and orients the head cones by the live end
// tangent — tips stay glued to both the tube and the card edge no matter
// how the dome turns. Pure three math; elbow.ts (the 2D grammar) untouched.
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

/** Cone transform for an arrowhead: apex exactly on the path end, axis
 *  aligned with the live travel direction (cone geometry points +y with the
 *  apex at +h/2, so pos backs off half a height along the tangent). */
export function headTransform(
  path: THREE.Vector3[],
  size: number,
  atStart = false,
): { pos: THREE.Vector3; quat: THREE.Quaternion } {
  const a = atStart ? path[1]! : path[path.length - 2]!;
  const b = atStart ? path[0]! : path[path.length - 1]!;
  const d = b.clone().sub(a).normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  return { pos: b.clone().addScaledVector(d, -size / 2), quat };
}

/** Pull the final sample back along the end segment so the tube tucks under
 *  the head's base instead of poking past the apex. */
export function trimEnd(path: THREE.Vector3[], trim: number): THREE.Vector3[] {
  const a = path[path.length - 2]!;
  const b = path[path.length - 1]!;
  const d = b.clone().sub(a).normalize();
  const out = path.slice();
  out[out.length - 1] = b.clone().addScaledVector(d, -trim);
  return out;
}
