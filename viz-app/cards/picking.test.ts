// Picking is pure ray math against the layout's card rects (no WebGL, no
// scene graph), so it unit-tests under happy-dom — including the parallax
// regression: under the skewed iso camera a card must hit under its own
// *projected* center, not its orthographic footprint.
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildModel } from "../data";
import { cfg, node } from "../test-helpers";
import { BAND_Y, CARD_H, CARD_W, cardGraph, FOCUS_Z, layoutCards, type CardLayout } from "./cardLayout";
import { pickCard } from "./picking";

const model = buildModel({
  nodes: [node("f", "Decision", "Focus"), node("a", "Pattern", "Alpha"), node("b", "Pattern", "Beta")],
  edges: [
    { s: "a", t: "f" },
    { s: "f", t: "b" },
  ],
  cfg: cfg(),
});
const layout = layoutCards(cardGraph(model, "f", 1, () => true)!);

const camera = (skewed: boolean) => {
  const cam = new THREE.OrthographicCamera(-500, 500, 400, -400, 0.1, 3000);
  if (skewed) cam.position.set(0.25, 0.18, 1).normalize().multiplyScalar(900);
  else cam.position.set(0, 0, 900);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
};

describe("pickCard", () => {
  test("center of the viewport hits the focus card", () => {
    expect(pickCard({ x: 0, y: 0 }, camera(false), layout)).toBe("f");
  });

  test("empty gap between bands hits nothing", () => {
    // Halfway between focus top edge and the in-band bottom edge.
    const gapY = (BAND_Y[1]! - CARD_H / 2 + layout.byId["f"]!.h / 2) / 2;
    expect(pickCard({ x: 0, y: gapY / 400 }, camera(false), layout)).toBeNull();
    expect(pickCard({ x: 0.99, y: -0.99 }, camera(false), layout)).toBeNull();
  });

  test("skewed camera: every card hits under its projected center (parallax pin)", () => {
    const cam = camera(true);
    for (const c of layout.cards) {
      const p = new THREE.Vector3(c.x, c.y, c.z).project(cam);
      expect(pickCard({ x: p.x, y: p.y }, cam, layout)).toBe(c.id);
    }
  });

  test("overlapping cards: nearest along the ray wins", () => {
    const over: CardLayout = {
      ...layout,
      cards: [
        { ...layout.byId["f"]!, id: "behind", z: 0, w: CARD_W, h: CARD_H },
        { ...layout.byId["f"]!, id: "front", z: FOCUS_Z, w: CARD_W, h: CARD_H },
      ],
    };
    expect(pickCard({ x: 0, y: 0 }, camera(false), over)).toBe("front");
  });

  test("'more' chips are not pickable; dir cards are", () => {
    const chips: CardLayout = {
      ...layout,
      cards: [
        { ...layout.byId["f"]!, id: "chip", kind: "more" },
        { ...layout.byId["a"]!, id: "dir", kind: "dir" },
      ],
    };
    expect(pickCard({ x: 0, y: 0 }, camera(false), chips)).toBeNull();
    const a = layout.byId["a"]!;
    const p = new THREE.Vector3(a.x, a.y, a.z).project(camera(false));
    expect(pickCard({ x: p.x, y: p.y }, camera(false), chips)).toBe("dir");
  });
});
