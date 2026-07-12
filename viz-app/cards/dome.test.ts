// The dome is the always-on projection layer: flat layout coordinates are
// treated as geodesic offsets (lat/long) on a sphere centered at (0,0,-R),
// so the focus card sits exactly at the flat origin and rows curl away
// evenly. These tests pin the mapping, the tangent frames, the to-pole
// rotation used by refocus transitions, and the horizon fade band.
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildModel } from "../data";
import { cfg, node } from "../test-helpers";
import { BAND_Y, cardGraph, FOCUS_Z, layoutCards } from "./cardLayout";
import {
  DOME_R_MIN,
  domePoint,
  domeProject,
  domeRadius,
  extendFromPole,
  frameFromDir,
  horizonFade,
  rotationToPole,
} from "./dome";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const vClose = (v: THREE.Vector3, x: number, y: number, z: number, eps = 1e-9) => {
  close(v.x, x, eps);
  close(v.y, y, eps);
  close(v.z, z, eps);
};

const R = 1000;

describe("domePoint", () => {
  test("origin maps to the front pole", () => {
    const p = domePoint(0, 0, R);
    expect(p.lon).toBe(0);
    expect(p.lat).toBe(0);
    vClose(p.dir, 0, 0, 1);
  });

  test("flat offsets are geodesic: lon = x/R, lat = y/R (band spacing preserved)", () => {
    for (const y of [BAND_Y[1], BAND_Y[2], -BAND_Y[1]!]) {
      close(domePoint(0, y, R).lat, y / R);
    }
    close(domePoint(240, 0, R).lon, 240 / R);
  });

  test("dir follows the explicit lat/long formula and stays unit length", () => {
    const x = 300;
    const y = -180;
    const { dir } = domePoint(x, y, R);
    const phi = x / R;
    const lam = y / R;
    vClose(dir, Math.sin(phi) * Math.cos(lam), Math.sin(lam), Math.cos(phi) * Math.cos(lam));
    close(dir.length(), 1);
  });
});

describe("frameFromDir", () => {
  test("pole frame is the identity (cards face the camera untilted)", () => {
    const f = frameFromDir(new THREE.Vector3(0, 0, 1));
    vClose(f.east, 1, 0, 0);
    vClose(f.north, 0, 1, 0);
    close(new THREE.Quaternion().angleTo(f.quat), 0, 1e-9);
  });

  test("frames are orthonormal, right-handed, tangent (quat maps +z onto dir)", () => {
    for (const [x, y] of [
      [300, 180],
      [-500, -350],
      [120, 350],
    ] as const) {
      const { dir } = domePoint(x, y, R);
      const f = frameFromDir(dir);
      close(f.east.length(), 1);
      close(f.north.length(), 1);
      close(f.east.dot(f.north), 0, 1e-9);
      close(f.east.dot(dir), 0, 1e-9);
      const cross = new THREE.Vector3().crossVectors(f.east, f.north);
      close(cross.distanceTo(dir), 0, 1e-9);
      const zMapped = new THREE.Vector3(0, 0, 1).applyQuaternion(f.quat);
      close(zMapped.distanceTo(dir), 0, 1e-9);
    }
  });

  test("east stays horizontal so rows keep reading level", () => {
    const { dir } = domePoint(400, 250, R);
    close(frameFromDir(dir).east.y, 0, 1e-9);
  });

  test("degenerate near ±y stays finite and orthonormal", () => {
    for (const s of [1, -1]) {
      const f = frameFromDir(new THREE.Vector3(0, s * 0.99999, Math.sqrt(1 - 0.99999 ** 2)).normalize());
      expect(Number.isFinite(f.east.x)).toBe(true);
      close(f.east.length(), 1, 1e-6);
      close(f.east.dot(f.north), 0, 1e-6);
    }
  });
});

describe("rotationToPole", () => {
  test("carries the card's dir exactly onto the pole, all quadrants", () => {
    for (const [x, y] of [
      [416, 180],
      [-416, 180],
      [208, -350],
      [-624, -276],
    ] as const) {
      const p = domePoint(x, y, R);
      const rotated = p.dir.clone().applyQuaternion(rotationToPole(p.lon, p.lat));
      close(rotated.distanceTo(new THREE.Vector3(0, 0, 1)), 0, 1e-12);
    }
  });

  test("identity at the pole", () => {
    close(new THREE.Quaternion().angleTo(rotationToPole(0, 0)), 0, 1e-12);
  });
});

describe("horizonFade", () => {
  const zAt = (deg: number) => Math.cos((deg * Math.PI) / 180);

  test("fully visible up to 55°, fully gone past 80°", () => {
    expect(horizonFade(zAt(0))).toBe(1);
    expect(horizonFade(zAt(55))).toBe(1);
    expect(horizonFade(zAt(80))).toBe(0);
    expect(horizonFade(zAt(89))).toBe(0);
  });

  test("monotone smoothstep in between", () => {
    let prev = 1;
    for (let deg = 55; deg <= 80; deg += 2.5) {
      const v = horizonFade(zAt(deg));
      expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      prev = v;
    }
    const mid = horizonFade(zAt(67.5));
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});

describe("extendFromPole", () => {
  test("rolls a dir further from the pole along its own meridian", () => {
    const p = domePoint(200, 300, R);
    const before = p.dir.angleTo(new THREE.Vector3(0, 0, 1));
    const out = extendFromPole(p.dir, 0.35);
    close(out.length(), 1);
    close(out.angleTo(new THREE.Vector3(0, 0, 1)), before + 0.35, 1e-9);
    // Same meridian: the horizontal direction is preserved.
    const flatBefore = Math.atan2(p.dir.y, p.dir.x);
    const flatAfter = Math.atan2(out.y, out.x);
    close(flatBefore, flatAfter, 1e-9);
  });

  test("at the exact pole picks an arbitrary but finite meridian", () => {
    const out = extendFromPole(new THREE.Vector3(0, 0, 1), 0.35);
    close(out.length(), 1, 1e-9);
    close(out.angleTo(new THREE.Vector3(0, 0, 1)), 0.35, 1e-9);
  });
});

describe("domeRadius / domeProject", () => {
  const model = buildModel({
    nodes: [
      node("f", "Decision", "Focus"),
      node("a", "Pattern", "Alpha"),
      node("b", "Pattern", "Beta"),
    ],
    edges: [
      { s: "a", t: "f" },
      { s: "f", t: "b" },
    ],
    cfg: cfg(),
  });
  const flat = layoutCards(cardGraph(model, "f", 1, () => true)!);

  test("radius floors at DOME_R_MIN and scales 1.2x with the extent", () => {
    expect(domeRadius(flat.bounds)).toBe(DOME_R_MIN);
    expect(domeRadius({ minX: -2000, maxX: 1500, minY: -100, maxY: 100 })).toBe(2400);
  });

  test("projects every card onto the sphere with its lift along the normal", () => {
    const dome = domeProject(flat);
    expect(dome.cards).toHaveLength(flat.cards.length);
    expect(dome.flat).toBe(flat);
    const C = new THREE.Vector3(0, 0, -dome.R);
    for (const c of dome.cards) {
      const placement = flat.byId[c.id]!;
      // |pos - C| = R + lift (focus lift rides along the outward normal).
      close(c.pos.distanceTo(C), dome.R + placement.z, 1e-6);
      expect(dome.byId[c.id]).toBe(c);
    }
    // The settled focus card sits exactly where the flat layout put it.
    const f = dome.byId["f"]!;
    vClose(f.pos, 0, 0, FOCUS_Z, 1e-9);
    close(new THREE.Quaternion().angleTo(f.quat), 0, 1e-9);
  });
});
