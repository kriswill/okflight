// Picking under motion: cards are oriented planes (dome tangent + drag
// rotation), so the hit test is ray -> card-local frame -> rect. Still pure
// layout-driven math (no scene raycasts) and still exact under the skewed
// iso camera — each card is tested at its own live pose, so parallax can't
// smear targets. Ports the flat-era suite via identity quaternions.
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildModel } from "../data";
import { cfg, node } from "../test-helpers";
import { BAND_Y, CARD_H, CARD_W, cardGraph, FOCUS_Z, layoutCards, type CardLayout } from "./cardLayout";
import { pickCard3, type PickItem } from "./picking";

const model = buildModel({
  nodes: [node("f", "Decision", "Focus"), node("a", "Pattern", "Alpha"), node("b", "Pattern", "Beta")],
  edges: [
    { s: "a", t: "f" },
    { s: "f", t: "b" },
  ],
  cfg: cfg(),
});
const layout = layoutCards(cardGraph(model, "f", 1, () => true)!);

/** Flat-era bridge: every placement as an axis-aligned pick item. */
const flatItems = (l: CardLayout): PickItem[] =>
  l.cards.map((c) => ({
    id: c.id,
    kind: c.kind,
    pos: new THREE.Vector3(c.x, c.y, c.z),
    quat: new THREE.Quaternion(),
    w: c.w,
    h: c.h,
    opacity: 1,
  }));

const camera = (skewed: boolean) => {
  const cam = new THREE.OrthographicCamera(-500, 500, 400, -400, 0.1, 3000);
  if (skewed) cam.position.set(0.25, 0.18, 1).normalize().multiplyScalar(900);
  else cam.position.set(0, 0, 900);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
};

const ndcOf = (p: THREE.Vector3, cam: THREE.OrthographicCamera) => {
  const v = p.clone().project(cam);
  return { x: v.x, y: v.y };
};

describe("pickCard3 — flat bridge (identity quats)", () => {
  test("center of the viewport hits the focus card", () => {
    expect(pickCard3({ x: 0, y: 0 }, camera(false), flatItems(layout))).toBe("f");
  });

  test("empty gap between bands hits nothing", () => {
    const gapY = (BAND_Y[1]! - CARD_H / 2 + layout.byId["f"]!.h / 2) / 2;
    expect(pickCard3({ x: 0, y: gapY / 400 }, camera(false), flatItems(layout))).toBeNull();
    expect(pickCard3({ x: 0.99, y: -0.99 }, camera(false), flatItems(layout))).toBeNull();
  });

  test("skewed camera: every card hits under its projected center (parallax pin)", () => {
    const cam = camera(true);
    for (const c of layout.cards) {
      const ndc = ndcOf(new THREE.Vector3(c.x, c.y, c.z), cam);
      expect(pickCard3(ndc, cam, flatItems(layout))).toBe(c.id);
    }
  });

  test("overlapping cards: nearest along the ray wins (focus lift beats z=0)", () => {
    const f = layout.byId["f"]!;
    const items: PickItem[] = [
      { id: "behind", kind: "card", pos: new THREE.Vector3(f.x, f.y, 0), quat: new THREE.Quaternion(), w: CARD_W, h: CARD_H, opacity: 1 },
      { id: "front", kind: "card", pos: new THREE.Vector3(f.x, f.y, FOCUS_Z), quat: new THREE.Quaternion(), w: CARD_W, h: CARD_H, opacity: 1 },
    ];
    expect(pickCard3({ x: 0, y: 0 }, camera(false), items)).toBe("front");
  });

  test("'more' chips are inert; dir cards pick", () => {
    const a = layout.byId["a"]!;
    const items: PickItem[] = [
      { id: "chip", kind: "more", pos: new THREE.Vector3(0, 0, 0), quat: new THREE.Quaternion(), w: CARD_W, h: CARD_H, opacity: 1 },
      { id: "dir", kind: "dir", pos: new THREE.Vector3(a.x, a.y, 0), quat: new THREE.Quaternion(), w: a.w, h: a.h, opacity: 1 },
    ];
    expect(pickCard3({ x: 0, y: 0 }, camera(false), items)).toBeNull();
    const cam = camera(false);
    expect(pickCard3(ndcOf(new THREE.Vector3(a.x, a.y, 0), cam), cam, items)).toBe("dir");
  });
});

describe("pickCard3 — oriented cards", () => {
  const tiltedItem = (quat: THREE.Quaternion, pos = new THREE.Vector3(120, 90, -40)): PickItem => ({
    id: "tilted",
    kind: "card",
    pos,
    quat,
    w: CARD_W,
    h: CARD_H,
    opacity: 1,
  });
  const tilt30 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 6);

  test("a 30°-tilted card picks at its projected center", () => {
    const cam = camera(true);
    const item = tiltedItem(tilt30);
    expect(pickCard3(ndcOf(item.pos, cam), cam, [item])).toBe("tilted");
  });

  test("hit testing happens in the tilted plane, not the flat footprint", () => {
    const cam = camera(false);
    const item = tiltedItem(tilt30);
    // Points ON the tilted plane just inside/outside the local half-height.
    const inside = item.pos.clone().add(new THREE.Vector3(0, CARD_H / 2 - 2, 0).applyQuaternion(tilt30));
    const outside = item.pos.clone().add(new THREE.Vector3(0, CARD_H / 2 + 2, 0).applyQuaternion(tilt30));
    expect(pickCard3(ndcOf(inside, cam), cam, [item])).toBe("tilted");
    expect(pickCard3(ndcOf(outside, cam), cam, [item])).toBeNull();
  });

  test("a whole-dome drag rotation moves the hit targets with the cards", () => {
    const cam = camera(true);
    const R = 900;
    const C = new THREE.Vector3(0, 0, -R);
    const qDrag = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    // A card at the pole, rotated about the dome center by the drag.
    const pos = new THREE.Vector3(0, 0, 0).sub(C).applyQuaternion(qDrag).add(C);
    const item = tiltedItem(qDrag.clone(), pos);
    expect(pickCard3(ndcOf(pos, cam), cam, [item])).toBe("tilted");
    // The old (undragged) center no longer hits.
    expect(pickCard3(ndcOf(new THREE.Vector3(0, 0, 0), cam), cam, [item])).toBeNull();
  });

  test("nearly faded cards are unpickable", () => {
    const cam = camera(false);
    const ghost: PickItem = { ...tiltedItem(new THREE.Quaternion(), new THREE.Vector3(0, 0, 0)), opacity: 0.1 };
    expect(pickCard3({ x: 0, y: 0 }, cam, [ghost])).toBeNull();
    expect(pickCard3({ x: 0, y: 0 }, cam, [{ ...ghost, opacity: 0.2 }])).toBe("tilted");
  });
});
