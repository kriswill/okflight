// Frame-time arrow math: while cards move, every arrow is rebuilt from the
// cards' LIVE transforms — endpoints as card-local anchors carried by the
// card pose, the bezier generalized to 3D along the cards' edge normals,
// and heads oriented by the live end tangent so tips never detach from the
// line or the card ("wonky heads" are the explicit failure mode here).
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildModel } from "../data";
import { cfg, node } from "../test-helpers";
import { cardGraph, layoutCards } from "./cardLayout";
import { domePoint, frameFromDir } from "./dome";
import { elbowPath } from "./elbow";
import { arrowAnchors, elbowPath3, headTransform, trimEnd } from "./arrowFrame";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const v3 = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

const model = buildModel({
  nodes: [
    node("f", "Decision", "Focus"),
    node("a", "Pattern", "Alpha"),
    node("b", "Pattern", "Beta"),
    node("c", "Reference", "Gamma"),
    node("d", "Decision", "Delta"),
  ],
  edges: [
    { s: "a", t: "f" },
    { s: "b", t: "f" },
    { s: "f", t: "c" },
    { s: "c", t: "d" },
    { s: "f", t: "b" }, // mutual with b
  ],
  cfg: cfg(),
});
const layout = layoutCards(cardGraph(model, "f", 2, () => true)!);

describe("arrowAnchors", () => {
  test("round-trips every arrow endpoint through card-center + local offset", () => {
    for (const a of layout.arrows) {
      const { from, to } = arrowAnchors(a, layout.byId);
      const fc = layout.byId[from.cardId]!;
      const tc = layout.byId[to.cardId]!;
      close(fc.x + from.local.x, a.path[0]!.x);
      close(fc.y + from.local.y, a.path[0]!.y);
      close(tc.x + to.local.x, a.path[a.path.length - 1]!.x);
      close(tc.y + to.local.y, a.path[a.path.length - 1]!.y);
    }
  });

  test("anchor card ids follow the arrow direction", () => {
    const inA = layout.arrows.find((a) => a.fromId === "a")!;
    expect(arrowAnchors(inA, layout.byId).from.cardId).toBe("a");
    expect(arrowAnchors(inA, layout.byId).to.cardId).toBe("f");
  });
});

describe("elbowPath3", () => {
  test("flat degenerate case reproduces the 2D elbow exactly", () => {
    const from = { x: -104, y: 148 };
    const to = { x: 30, y: 48 };
    const flat2d = elbowPath(from, to);
    const flat3d = elbowPath3(v3(from.x, from.y), v3(0, -1, 0), v3(to.x, to.y), v3(0, 1, 0));
    expect(flat3d).toHaveLength(flat2d.length);
    flat2d.forEach((p, i) => {
      close(flat3d[i]!.x, p.x);
      close(flat3d[i]!.y, p.y);
      close(flat3d[i]!.z, 0);
    });
  });

  test("exact endpoints and tangent alignment for tilted card frames", () => {
    const fa = frameFromDir(domePoint(300, 350, 1000).dir);
    const fb = frameFromDir(domePoint(-100, 0, 1000).dir);
    const from = v3(280, 320, -60);
    const to = v3(-90, 10, -5);
    const fromTan = fa.north.clone().negate(); // leaving a's bottom edge
    const toTan = fb.north.clone(); // entering b's top edge
    const path = elbowPath3(from, fromTan, to, toTan);
    expect(path).toHaveLength(25);
    expect(path[0]!.distanceTo(from)).toBeLessThan(1e-9);
    expect(path[24]!.distanceTo(to)).toBeLessThan(1e-9);
    // Fine sampling: end segments align with the requested tangents.
    const fine = elbowPath3(from, fromTan, to, toTan, { segments: 2000 });
    const d0 = fine[1]!.clone().sub(fine[0]!).normalize();
    const d1 = fine[fine.length - 1]!.clone().sub(fine[fine.length - 2]!).normalize();
    expect(d0.dot(fromTan)).toBeGreaterThan(0.999);
    // Entering along -toTan (the path flows INTO the edge the tangent leaves).
    expect(d1.dot(toTan.clone().negate())).toBeGreaterThan(0.999);
  });
});

describe("headTransform", () => {
  const path = elbowPath3(v3(0, 148), v3(0, -1, 0), v3(20, 48), v3(0, 1, 0));

  test("end head: cone apex lands exactly on the path tip, axis along travel", () => {
    const h = headTransform(path, 12);
    const apex = v3(0, 6, 0).applyQuaternion(h.quat).add(h.pos);
    expect(apex.distanceTo(path[path.length - 1]!)).toBeLessThan(1e-9);
    const travel = path[path.length - 1]!.clone().sub(path[path.length - 2]!).normalize();
    const axis = v3(0, 1, 0).applyQuaternion(h.quat);
    expect(axis.dot(travel)).toBeGreaterThan(0.999999);
  });

  test("start head: apex on the first point, oriented backwards", () => {
    const h = headTransform(path, 12, true);
    const apex = v3(0, 6, 0).applyQuaternion(h.quat).add(h.pos);
    expect(apex.distanceTo(path[0]!)).toBeLessThan(1e-9);
    const backward = path[0]!.clone().sub(path[1]!).normalize();
    const axis = v3(0, 1, 0).applyQuaternion(h.quat);
    expect(axis.dot(backward)).toBeGreaterThan(0.999999);
  });
});

describe("trimEnd", () => {
  test("pulls the final sample back along the end segment, leaving the rest", () => {
    const path = elbowPath3(v3(0, 148), v3(0, -1, 0), v3(20, 48), v3(0, 1, 0));
    const before = path.map((p) => p.clone());
    const trimmed = trimEnd(path, 9.6);
    const d = before[before.length - 1]!.clone().sub(before[before.length - 2]!).normalize();
    const expected = before[before.length - 1]!.clone().addScaledVector(d, -9.6);
    expect(trimmed[trimmed.length - 1]!.distanceTo(expected)).toBeLessThan(1e-9);
    for (let i = 0; i < trimmed.length - 1; i++) expect(trimmed[i]!.distanceTo(before[i]!)).toBe(0);
  });
});
