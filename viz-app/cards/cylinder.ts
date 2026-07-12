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

/** Tight enough that the curve reads as gentle depth (with the aperture
 *  scale below), never as a ball. */
export const CYL_R = 2400;
/** Arc distance from band center where cards start/finish fading. */
export const FADE_START = 640;
export const FADE_END = 920;
/** Aperture floor: a card at the fade edge renders at this scale. */
export const SCALE_MIN = 0.85;

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

/** Aperture scale by arc distance from the band center: full size in the
 *  middle, smoothstepped down to SCALE_MIN by the fade edge. The dead-on
 *  orthographic camera has no perspective of its own, so this supplies the
 *  depth cue as cards recede along the cylinder. `end` defaults to the
 *  reference window; the motion store passes its viewport-derived edge. */
export function arcScale(dist: number, end = FADE_END): number {
  const t = Math.min(1, Math.abs(dist) / end);
  const s = t * t * (3 - 2 * t);
  return 1 - (1 - SCALE_MIN) * s;
}

/** Visibility by arc distance from the band center: 1 inside the window,
 *  smoothstepped to 0 past the edge — cards (and their lines) fade in and
 *  out as they scroll through. The [start, end] ramp defaults to the
 *  reference window; the motion store passes its viewport-derived one. */
export function arcFade(dist: number, start = FADE_START, end = FADE_END): number {
  const d = Math.abs(dist);
  const t = (end - d) / (end - start);
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
