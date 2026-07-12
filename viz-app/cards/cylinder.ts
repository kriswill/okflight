// The scroll scaffolding: a huge cylinder whose curvature follows the band
// (scroll) axis and reorients with the flow toggle. Vertical flow: rows
// extend along x and wrap around a vertical-axis cylinder; horizontal flow:
// columns extend along y and wrap around a horizontal-axis cylinder. The
// cross axis is flat — bands are straight lines rolled over the curve, so
// scrolling reads as cards rolling into and out of view. Fade is by arc
// distance from the band center (the visible window), not by angle: the
// cylinder stays subtle scaffolding at any radius. Pure three math.
import * as THREE from "three";
import type { CardFlow } from "./cardLayout";

/** Same scale as the old dome: curvature never reads as a ball. */
export const CYL_R = 4800;
/** Arc distance from band center where cards start/finish fading. */
export const FADE_START = 640;
export const FADE_END = 920;

/** Surface pose for a (band, cross) coordinate: band is the scrollable axis
 *  (x in vertical flow, y in horizontal), cross is the flat ring offset. */
export function cylPose(
  band: number,
  cross: number,
  lift: number,
  flow: CardFlow,
  R = CYL_R,
): { pos: THREE.Vector3; quat: THREE.Quaternion } {
  const a = band / R;
  if (flow === "v") {
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    const pos = new THREE.Vector3(R * Math.sin(a), cross, R * (Math.cos(a) - 1)).addScaledVector(
      new THREE.Vector3(Math.sin(a), 0, Math.cos(a)),
      lift,
    );
    return { pos, quat };
  }
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -a);
  const pos = new THREE.Vector3(cross, R * Math.sin(a), R * (Math.cos(a) - 1)).addScaledVector(
    new THREE.Vector3(0, Math.sin(a), Math.cos(a)),
    lift,
  );
  return { pos, quat };
}

/** Visibility by arc distance from the band center: 1 inside the window,
 *  smoothstepped to 0 past the edge — cards (and their lines) fade in and
 *  out as they scroll through. */
export function arcFade(dist: number): number {
  const d = Math.abs(dist);
  const t = (FADE_END - d) / (FADE_END - FADE_START);
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
