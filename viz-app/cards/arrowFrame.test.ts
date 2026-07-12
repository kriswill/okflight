// Frame-time arrow math: while cards move, every arrow is rebuilt from the
// cards' LIVE transforms — endpoints as card-local anchors carried by the
// card pose, the bezier generalized to 3D along the cards' edge normals,
// and heads locked at 90° to the card edge with the tube terminating at the
// cone's base center ("wonky heads" are the explicit failure mode here).
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildModel } from "../data";
import { cfg, node } from "../test-helpers";
import { cardGraph, layoutCards } from "./cardLayout";
import { elbowPath } from "./elbow";
import { arrowAnchors, edgeHead, edgeTangent, elbowPath3 } from "./arrowFrame";

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
    const qa = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0.2, 0));
    const qb = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, -0.3, 0));
    const from = v3(280, 320, -60);
    const to = v3(-90, 10, -5);
    const fromTan = v3(0, -1, 0).applyQuaternion(qa); // leaving a's bottom edge
    const toTan = v3(0, 1, 0).applyQuaternion(qb); // entering b's top edge
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

describe("edgeTangent", () => {
  test("classifies which card edge a local anchor sits on and returns its outward normal", () => {
    // Bottom-center of a 180x64 card (vertical-flow departure).
    expect(edgeTangent({ x: 12, y: -32 }, 180, 64)).toEqual({ x: 0, y: -1 });
    // Top-edge slot (vertical-flow arrival).
    expect(edgeTangent({ x: -40, y: 32 }, 180, 64)).toEqual({ x: 0, y: 1 });
    // Right-edge center (horizontal-flow departure).
    expect(edgeTangent({ x: 90, y: 0 }, 180, 64)).toEqual({ x: 1, y: 0 });
    // Left-edge slot (horizontal-flow arrival).
    expect(edgeTangent({ x: -115, y: 20 }, 230, 96)).toEqual({ x: -1, y: 0 });
  });
});

describe("edgeHead", () => {
  test("apex sits exactly on the card-edge anchor, axis perpendicular to the edge", () => {
    for (const [rx, ry] of [
      [0, 0],
      [0.3, 0.35],
      [-0.5, -0.2],
    ] as const) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0));
      const outward = v3(0, 1, 0).applyQuaternion(q); // out of a card's top edge
      const anchor = v3(rx * 100, ry * 100, -30);
      const h = edgeHead(anchor, outward, 12);
      // Cone geometry: apex at +h/2 on local +Y.
      const apex = v3(0, 6, 0).applyQuaternion(h.quat).add(h.pos);
      expect(apex.distanceTo(anchor)).toBeLessThan(1e-9);
      // Axis points INTO the card (against the outward edge tangent) — the
      // head is forced to 90° against the surface, never the sampled curve.
      const axis = v3(0, 1, 0).applyQuaternion(h.quat);
      expect(axis.dot(outward.clone().negate())).toBeGreaterThan(0.999999);
    }
  });

  test("base center lands one head-height out along the edge tangent — where the tube must stop", () => {
    const outward = v3(0, 1, 0);
    const h = edgeHead(v3(10, 48, 0), outward, 12);
    expect(h.base.distanceTo(v3(10, 60, 0))).toBeLessThan(1e-9);
    // Base is also derivable from the transform: pos - axis·h/2.
    const viaPose = v3(0, -6, 0).applyQuaternion(h.quat).add(h.pos);
    expect(viaPose.distanceTo(h.base)).toBeLessThan(1e-9);
  });
});
