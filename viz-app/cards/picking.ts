// Pointer picking for the card view: cast the camera ray and intersect each
// card's own z-plane, then rect-test in world space. No raycasting against
// mesh geometry — the layout IS the source of truth, which keeps picking
// exact under the skewed iso camera (each card is tested at its own depth,
// so parallax can't smear hit targets) and free of scene-graph coupling.
import * as THREE from "three";
import type { CardLayout } from "./cardLayout";
import type { Pt } from "./elbow";

/** Topmost pickable card under the pointer (ndc: normalized device coords),
 *  or null. "more" chips are inert; dir cards pick like concept cards. */
export function pickCard(ndc: Pt, camera: THREE.OrthographicCamera, layout: CardLayout): string | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  const { origin, direction } = ray.ray;
  let best: { id: string; t: number } | null = null;
  for (const c of layout.cards) {
    if (c.kind === "more") continue;
    if (Math.abs(direction.z) < 1e-9) continue;
    const t = (c.z - origin.z) / direction.z;
    if (t < 0) continue;
    const x = origin.x + direction.x * t;
    const y = origin.y + direction.y * t;
    if (Math.abs(x - c.x) <= c.w / 2 && Math.abs(y - c.y) <= c.h / 2 && (!best || t < best.t))
      best = { id: c.id, t };
  }
  return best?.id ?? null;
}
