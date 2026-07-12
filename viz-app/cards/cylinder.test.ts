// The scaffolding is now a cylinder whose curvature follows the SCROLL
// axis: vertical flow wraps the horizontal band axis around a vertical-axis
// cylinder (rows curve away left/right); horizontal flow wraps the vertical
// band axis (columns curve away up/down). The cross axis stays flat. Fade
// is by arc distance from the band center — the window cards scroll through.
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { arcFade, arcScale, CYL_R, cylPose, FADE_END, FADE_START, SCALE_MIN } from "./cylinder";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const vClose = (v: THREE.Vector3, x: number, y: number, z: number, eps = 1e-6) => {
  close(v.x, x, eps);
  close(v.y, y, eps);
  close(v.z, z, eps);
};

describe("cylPose", () => {
  test("origin maps to the origin with identity orientation, both flows", () => {
    for (const flow of ["v", "h"] as const) {
      const p = cylPose(0, 0, 0, flow);
      vClose(p.pos, 0, 0, 0);
      close(new THREE.Quaternion().angleTo(p.quat), 0, 1e-9);
    }
  });

  test("vertical flow: band arc wraps around a vertical-axis cylinder, cross stays flat", () => {
    const band = 600;
    const cross = 180;
    const th = band / CYL_R;
    const p = cylPose(band, cross, 0, "v");
    vClose(p.pos, CYL_R * Math.sin(th), cross, CYL_R * (Math.cos(th) - 1));
    // Tangent orientation: card normal follows the surface.
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(p.quat);
    vClose(n, Math.sin(th), 0, Math.cos(th));
    // Card's up stays world-up (rows read level).
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.quat);
    vClose(up, 0, 1, 0);
  });

  test("horizontal flow: the cylinder reorients — band arc wraps vertically, cross flat", () => {
    const band = -400;
    const cross = 320;
    const ph = band / CYL_R;
    const p = cylPose(band, cross, 0, "h");
    vClose(p.pos, cross, CYL_R * Math.sin(ph), CYL_R * (Math.cos(ph) - 1));
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(p.quat);
    vClose(n, 0, Math.sin(ph), Math.cos(ph));
  });

  test("lift rides the surface normal", () => {
    const p0 = cylPose(600, 0, 0, "v");
    const p6 = cylPose(600, 0, 6, "v");
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(p0.quat);
    expect(p6.pos.clone().sub(p0.pos).distanceTo(n.multiplyScalar(6))).toBeLessThan(1e-9);
  });
});

describe("arcScale", () => {
  test("full size at the band center, SCALE_MIN by the fade edge, symmetric and monotone", () => {
    expect(arcScale(0)).toBe(1);
    close(arcScale(FADE_END), SCALE_MIN);
    close(arcScale(-FADE_END), SCALE_MIN);
    expect(arcScale(FADE_END + 500)).toBe(SCALE_MIN);
    let prev = 1;
    for (let d = 0; d <= FADE_END; d += 20) {
      const s = arcScale(d);
      expect(s).toBeLessThanOrEqual(prev);
      expect(s).toBeGreaterThanOrEqual(SCALE_MIN);
      close(s, arcScale(-d));
      prev = s;
    }
  });
});

describe("arcFade", () => {
  test("fully visible inside the window, gone past the edge, symmetric and monotone", () => {
    expect(arcFade(0)).toBe(1);
    expect(arcFade(FADE_START)).toBe(1);
    expect(arcFade(-FADE_START)).toBe(1);
    expect(arcFade(FADE_END)).toBe(0);
    expect(arcFade(-FADE_END - 500)).toBe(0);
    let prev = 1;
    for (let d = FADE_START; d <= FADE_END; d += 20) {
      const f = arcFade(d);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
    const mid = arcFade((FADE_START + FADE_END) / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});
