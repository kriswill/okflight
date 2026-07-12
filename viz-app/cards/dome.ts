// The invisible dome the cards lie on: flat layout coordinates are geodesic
// offsets (x -> longitude arc, y -> latitude arc) on a sphere centered at
// (0, 0, -R), front pole at the flat origin. Latitude bands preserve the
// flat row spacing exactly, rows stay level, and drag decomposes into pure
// yaw/pitch about the sphere center. Pure three math — no Threlte, no DOM.
import * as THREE from "three";
import type { CardLayout, CardPlacement } from "./cardLayout";

export const DOME_R_MIN = 900;
/** Angle-from-pole band over which cards fade at the dome's horizon. */
const FADE_START_Z = Math.cos((55 * Math.PI) / 180);
const FADE_END_Z = Math.cos((80 * Math.PI) / 180);

const POLE = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

export interface DomeCard {
  id: string;
  lon: number;
  lat: number;
  /** Unit direction from the sphere center (drag excluded). */
  dir: THREE.Vector3;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

export interface DomeLayout {
  focusId: string;
  rootFocus: boolean;
  R: number;
  cards: DomeCard[];
  byId: Record<string, DomeCard>;
  /** The source flat layout — arrows, bounds, and slots still read from it. */
  flat: CardLayout;
}

/** Sphere radius for a layout: floored so small layouts barely curl, scaled
 *  so wide layouts never push their rim into the resting fade zone. */
export function domeRadius(b: CardLayout["bounds"]): number {
  const extent = Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minY), Math.abs(b.maxY));
  return Math.max(DOME_R_MIN, 1.2 * extent);
}

/** Geodesic mapping of a flat point: arc lengths become angles. */
export function domePoint(x: number, y: number, R: number): { lon: number; lat: number; dir: THREE.Vector3 } {
  const lon = x / R;
  const lat = y / R;
  return {
    lon,
    lat,
    dir: new THREE.Vector3(Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat)),
  };
}

/** Tangent frame at a surface direction: east stays horizontal (rows read
 *  level), north completes the right-handed basis, quat maps card-local
 *  +x/+y/+z onto east/north/outward-normal. */
export function frameFromDir(dir: THREE.Vector3): { east: THREE.Vector3; north: THREE.Vector3; quat: THREE.Quaternion } {
  const east = new THREE.Vector3().crossVectors(UP, dir);
  // Near the sphere's ±y poles the horizontal reference degenerates — any
  // stable meridian will do there (cards never rest that far up).
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(dir, east);
  const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, north, dir));
  return { east, north, quat };
}

/** The rotation carrying the card at (lon, lat) onto the front pole:
 *  un-yaw to the zero meridian, then un-pitch to the equator's pole. */
export function rotationToPole(lon: number, lat: number): THREE.Quaternion {
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -lon);
  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lat);
  return qx.multiply(qy);
}

/** Visibility multiplier by angle from the pole: 1 inside 55°, 0 past 80°,
 *  smoothstepped between — the "rolls out of view over the horizon" fade. */
export function horizonFade(dirZ: number): number {
  const t = (dirZ - FADE_END_Z) / (FADE_START_Z - FADE_END_Z);
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Roll a direction further away from the pole along its own meridian —
 *  where exiting cards go, and where entering cards come from. */
export function extendFromPole(dir: THREE.Vector3, extraRad: number): THREE.Vector3 {
  const axis = new THREE.Vector3().crossVectors(POLE, dir);
  if (axis.lengthSq() < 1e-12) axis.set(1, 0, 0).cross(POLE).negate(); // pole itself: pick the +x meridian
  axis.normalize();
  return dir.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, extraRad)).normalize();
}

/** Map a full flat layout onto the dome. Lift (CardPlacement.z — the focus
 *  hover) rides along the outward normal so the pole card ends up exactly
 *  where the flat layout had it. */
export function domeProject(flat: CardLayout, R = domeRadius(flat.bounds)): DomeLayout {
  const C = new THREE.Vector3(0, 0, -R);
  const cards = flat.cards.map((c: CardPlacement): DomeCard => {
    const { lon, lat, dir } = domePoint(c.x, c.y, R);
    const { quat } = frameFromDir(dir);
    const pos = C.clone().addScaledVector(dir, R + c.z);
    return { id: c.id, lon, lat, dir, pos, quat };
  });
  return {
    focusId: flat.focusId,
    rootFocus: flat.rootFocus,
    R,
    cards,
    byId: Object.fromEntries(cards.map((c) => [c.id, c])),
    flat,
  };
}
