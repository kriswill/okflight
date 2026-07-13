// Camera framing math pinned before the Threlte migration: fit distance,
// approach direction, and the FOV-cone neighbor solve are the fly-to feel.
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { fitView, flyTarget, type FlyNode } from "./flyTo";

const node = (x: number, y: number, z: number, r = 4): FlyNode => ({ x, y, z, r });
const FOV = 55;

describe("fitView", () => {
  test("targets the centroid and backs off along the elevated default axis", () => {
    const nodes = [node(-100, 0, 0), node(100, 40, 0)];
    const { pos, target } = fitView(nodes, FOV, 1);
    expect(target.x).toBeCloseTo(0, 5);
    expect(target.y).toBeCloseTo(20, 5);
    const dir = pos.clone().sub(target).normalize();
    const expected = new THREE.Vector3(0, 0.12, 1).normalize();
    expect(dir.dot(expected)).toBeCloseTo(1, 5);
  });

  test("distance follows the bounding-sphere/FOV formula with the 1.2 crop", () => {
    const nodes = [node(-100, 0, 0), node(100, 0, 0)]; // radius = 100 + 4
    const { pos, target } = fitView(nodes, FOV, 2); // wide: vertical FOV governs
    const vFov = (FOV * Math.PI) / 180;
    const expected = (104 * 1.06) / Math.tan(vFov / 2) / 1.2;
    expect(pos.distanceTo(target)).toBeCloseTo(expected, 3);
  });

  test("tight clusters keep the 60-unit minimum radius", () => {
    const near = fitView([node(0, 0, 0), node(1, 0, 0)], FOV, 1);
    const spread = fitView([node(-56, 0, 0), node(56, 0, 0)], FOV, 1); // radius still 60
    expect(near.pos.distanceTo(near.target)).toBeCloseTo(spread.pos.distanceTo(spread.target), 3);
  });
});

describe("flyTarget", () => {
  const camPos = new THREE.Vector3(0, 0, 500);
  const curTarget = new THREE.Vector3(0, 0, 0);

  test("always lands the target on the node", () => {
    const nodes = [node(10, 20, 30), node(50, 20, 30)];
    const adj = [new Set([1]), new Set([0])];
    const { toTarget } = flyTarget(nodes, adj, 0, camPos, curTarget, FOV, 1);
    expect(toTarget).toEqual(new THREE.Vector3(10, 20, 30));
  });

  test("approaches from the side opposite the neighbor centroid, biased upward", () => {
    const nodes = [node(0, 0, 0), node(-80, 0, 0), node(-40, 0, 0)];
    const adj = [new Set([1, 2]), new Set([0]), new Set([0])];
    const { toPos } = flyTarget(nodes, adj, 0, camPos, curTarget, FOV, 1);
    expect(toPos.x).toBeGreaterThan(0); // neighbors sit at -x → approach from +x
    expect(toPos.y).toBeGreaterThan(0); // the +0.25 label-clearing bias
  });

  test("loner falls back to the current view direction and holds zoom", () => {
    const nodes = [node(0, 0, 0)];
    const adj = [new Set<number>()];
    const { toPos, toTarget } = flyTarget(nodes, adj, 0, camPos, curTarget, FOV, 1);
    // Distance never drops below the current zoom (cone need is tiny here).
    expect(toPos.distanceTo(toTarget)).toBeCloseTo(500, 3);
    const dir = toPos.clone().sub(toTarget).normalize();
    expect(dir.z).toBeGreaterThan(0.9); // view direction, tilted slightly up
    expect(dir.y).toBeGreaterThan(0);
  });

  test("sideways neighbors force more pull-back than axial ones", () => {
    // Symmetric neighbor pairs cancel the centroid, so the approach falls
    // back to the camera axis (+z-ish); the close camera makes the cone need
    // govern, not current zoom. Edges running along the view axis need far
    // less pull-back than same-length edges running sideways.
    const closeCam = new THREE.Vector3(0, 0, 10);
    const axial: FlyNode[] = [node(0, 0, 0), node(0, 0, 100), node(0, 0, -100)];
    const sideways: FlyNode[] = [node(0, 0, 0), node(100, 0, 0), node(-100, 0, 0)];
    const adjHub = [new Set([1, 2]), new Set([0]), new Set([0])];
    const a = flyTarget(axial, adjHub, 0, closeCam, curTarget, FOV, 1);
    const s = flyTarget(sideways, adjHub, 0, closeCam, curTarget, FOV, 1);
    const distA = a.toPos.distanceTo(a.toTarget);
    const distS = s.toPos.distanceTo(s.toTarget);
    expect(distS).toBeGreaterThan(distA);
    expect(distA).toBeGreaterThan(10); // the cone need, not the current zoom, governs both
  });

  test("current zoom wins when neighbors already fit the cone", () => {
    const nodes = [node(0, 0, 0), node(5, 0, 0)];
    const adj = [new Set([1]), new Set([0])];
    const { toPos, toTarget } = flyTarget(nodes, adj, 0, camPos, curTarget, FOV, 1);
    expect(toPos.distanceTo(toTarget)).toBeCloseTo(500, 3);
  });
});
