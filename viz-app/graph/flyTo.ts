// Camera framing math, extracted pure from the scene: the initial fit and
// the fly-to-target solve are geometry only, so they unit-test without a
// renderer. Both return fresh vectors; callers own the tweening.
import * as THREE from "three";

export interface FlyNode {
  x: number;
  y: number;
  z: number;
  r: number;
}

const fovsRad = (fovDeg: number, aspect: number) => {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  return { vFov, hFov };
};

/** Initial placement: aim at the layout centroid and back off until the
 *  whole bounding sphere fits both the vertical and horizontal FOV. The
 *  layout is not origin-centered, so a fixed camera leaves the graph small
 *  and off-center. */
export function fitView(nodes: FlyNode[], fovDeg: number, aspect: number): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const center = new THREE.Vector3();
  for (const n of nodes) center.add(new THREE.Vector3(n.x, n.y, n.z));
  center.multiplyScalar(1 / Math.max(1, nodes.length));
  let radius = 60;
  for (const n of nodes) {
    radius = Math.max(radius, new THREE.Vector3(n.x, n.y, n.z).distanceTo(center) + n.r);
  }
  const { vFov, hFov } = fovsRad(fovDeg, aspect);
  // /1.2 pulls the camera 20% closer than a full-fit frame; distant outliers
  // may clip out of view at rest, which is fine — orbit/pan still reaches them.
  const dist = (radius * 1.06) / Math.tan(Math.min(vFov, hFov) / 2) / 1.2;
  const dir = new THREE.Vector3(0, 0.12, 1).normalize(); // slight elevation, like the old default
  return { pos: center.clone().addScaledVector(dir, dist), target: center };
}

/** Fly-to framing for node i: approach from the side opposite the neighbor
 *  centroid so the node's links fan out in view beyond it; fall back to the
 *  current view direction for loners. The slight upward bias keeps the label
 *  (below the node) clear of it. */
export function flyTarget(
  nodes: FlyNode[],
  adj: ReadonlySet<number>[],
  i: number,
  camPos: THREE.Vector3,
  curTarget: THREE.Vector3,
  fovDeg: number,
  aspect: number,
): { toPos: THREE.Vector3; toTarget: THREE.Vector3 } {
  const n = nodes[i]!;
  const target = new THREE.Vector3(n.x, n.y, n.z);
  const dir = new THREE.Vector3();
  const nb = [...adj[i]!];
  if (nb.length) {
    const centroid = new THREE.Vector3();
    for (const j of nb) centroid.add(new THREE.Vector3(nodes[j]!.x, nodes[j]!.y, nodes[j]!.z));
    dir.copy(target).sub(centroid.multiplyScalar(1 / nb.length));
  }
  if (dir.lengthSq() < 1) dir.copy(camPos).sub(curTarget);
  if (dir.lengthSq() < 1) dir.set(0, 0.2, 1);
  dir.normalize().setY(dir.y + 0.25).normalize();

  // Hold the current zoom level rather than flying to a fixed framing
  // distance; only back off as far as needed to keep every direct
  // neighbor inside the view cone along the chosen approach direction.
  // A neighbor's raw 3D distance isn't the right yardstick — an edge
  // that runs mostly along the view axis (deep into the scene) needs no
  // pull-back at all, unlike a same-length edge that runs sideways. So
  // decompose each neighbor offset into axial (along dir) and
  // perpendicular components and solve for the distance that keeps its
  // perpendicular offset inside the FOV cone at that depth.
  const { vFov, hFov } = fovsRad(fovDeg, aspect);
  const tanHalfFov = Math.tan(Math.min(vFov, hFov) / 2);
  let need = n.r / tanHalfFov;
  const offset = new THREE.Vector3();
  for (const j of nb) {
    const nbNode = nodes[j]!;
    offset.set(nbNode.x - n.x, nbNode.y - n.y, nbNode.z - n.z);
    const axial = offset.dot(dir);
    const perpLen = offset.addScaledVector(dir, -axial).length() + nbNode.r;
    need = Math.max(need, axial + perpLen / tanHalfFov);
  }
  const curDist = camPos.distanceTo(curTarget);
  const dist = Math.max(curDist, need);

  return { toPos: target.clone().add(dir.multiplyScalar(dist)), toTarget: target };
}
