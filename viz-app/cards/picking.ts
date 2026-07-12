// Pointer picking for the animated card view: cards are oriented planes
// (dome tangent frame, possibly composed with the drag rotation), so each
// hit test transforms the camera ray into the card's local frame and
// rect-tests there. The motion store supplies live poses — picking needs no
// scene-graph raycasts and stays exact mid-animation and mid-drag.
import * as THREE from "three";
import type { CardPlacement } from "./cardLayout";
import type { Pt } from "./elbow";

/** A card's live pickable pose, produced by the motion store. */
export interface PickItem {
  id: string;
  kind: CardPlacement["kind"];
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  w: number;
  h: number;
  opacity: number;
}

/** Cards faded below this are ghosts on their way out — never pickable. */
const MIN_PICK_OPACITY = 0.15;

/** Topmost pickable card under the pointer (ndc), or null. "more" chips are
 *  inert; dir cards pick like concept cards; nearest ray-hit wins. */
export function pickCard3(ndc: Pt, camera: THREE.OrthographicCamera, items: PickItem[]): string | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  const invQuat = new THREE.Quaternion();
  const oL = new THREE.Vector3();
  const dL = new THREE.Vector3();
  let best: { id: string; t: number } | null = null;
  for (const c of items) {
    if (c.kind === "more" || c.opacity < MIN_PICK_OPACITY) continue;
    invQuat.copy(c.quat).invert();
    oL.copy(ray.ray.origin).sub(c.pos).applyQuaternion(invQuat);
    dL.copy(ray.ray.direction).applyQuaternion(invQuat);
    if (Math.abs(dL.z) < 1e-9) continue;
    const t = -oL.z / dL.z;
    if (t < 0) continue;
    const x = oL.x + dL.x * t;
    const y = oL.y + dL.y * t;
    if (Math.abs(x) <= c.w / 2 && Math.abs(y) <= c.h / 2 && (!best || t < best.t)) best = { id: c.id, t };
  }
  return best?.id ?? null;
}
