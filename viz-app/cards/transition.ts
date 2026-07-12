// Refocus transition tracks: one rigid sphere-turn. Every card slerps along
// a great circle over the same eased 420ms — the new focus's slerp IS the
// rotation that brings it to the pole; exiting cards are carried with that
// turn and pushed a further 0.35rad over their meridian while fading;
// entering cards run the same path in reverse. The motion store owns time;
// this module owns geometry. Pure three math.
import * as THREE from "three";
import { extendFromPole, frameFromDir, horizonFade, type DomeLayout } from "./dome";

export const DURATION_MS = 420;
export const EXIT_ARC = 0.35;
/** Matches GraphScene.stepFly — fast start, gentle landing. */
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

const POLE = new THREE.Vector3(0, 0, 1);

/** Live card state at transition start (drag already baked into dir). */
export interface SnapshotCard {
  id: string;
  dir: THREE.Vector3;
  opacity: number;
  sx: number;
  sy: number;
  w: number;
  h: number;
  lift: number;
}

export interface DomeSnapshot {
  R: number;
  cards: SnapshotCard[];
}

/** The settled snapshot of a dome layout (scale 1, full opacity). */
export function snapshotOf(dome: DomeLayout): DomeSnapshot {
  return {
    R: dome.R,
    cards: dome.cards.map((c) => {
      const p = dome.flat.byId[c.id]!;
      return { id: c.id, dir: c.dir.clone(), opacity: 1, sx: 1, sy: 1, w: p.w, h: p.h, lift: p.z };
    }),
  };
}

export interface CardTrack {
  id: string;
  kind: "shared" | "enter" | "exit";
  v0: THREE.Vector3;
  v1: THREE.Vector3;
  o0: number;
  o1: number;
  s0x: number;
  s0y: number;
  s1x: number;
  s1y: number;
  lift0: number;
  lift1: number;
  /** Final render dims (previous dims for exits — they never re-detail). */
  w: number;
  h: number;
}

export interface TransitionSpec {
  R0: number;
  R1: number;
  duration: number;
  tracks: CardTrack[];
}

export function buildTransition(
  prev: DomeSnapshot,
  next: DomeLayout,
  opts?: { duration?: number },
): TransitionSpec {
  const prevById = new Map(prev.cards.map((c) => [c.id, c]));
  // The turn: the minimal rotation carrying the new focus's live direction
  // to the pole (identity when the focus wasn't on screen — plain relayout).
  const prevFocus = prevById.get(next.focusId);
  const qPole = prevFocus
    ? new THREE.Quaternion().setFromUnitVectors(prevFocus.dir.clone().normalize(), POLE)
    : new THREE.Quaternion();
  const qPoleInv = qPole.clone().invert();

  const tracks: CardTrack[] = [];
  for (const nc of next.cards) {
    const target = next.flat.byId[nc.id]!;
    const pc = prevById.get(nc.id);
    if (pc) {
      tracks.push({
        id: nc.id,
        kind: "shared",
        v0: pc.dir.clone(),
        v1: nc.dir.clone(),
        o0: pc.opacity,
        o1: 1,
        // Size morphs render as scale on the final (already re-detailed)
        // face: start at the ratio that reproduces the previous footprint.
        s0x: (pc.w * pc.sx) / target.w,
        s0y: (pc.h * pc.sy) / target.h,
        s1x: 1,
        s1y: 1,
        lift0: pc.lift,
        lift1: target.z,
        w: target.w,
        h: target.h,
      });
    } else {
      tracks.push({
        id: nc.id,
        kind: "enter",
        v0: extendFromPole(nc.dir.clone().applyQuaternion(qPoleInv), EXIT_ARC),
        v1: nc.dir.clone(),
        o0: 0,
        o1: 1,
        s0x: 0.9,
        s0y: 0.9,
        s1x: 1,
        s1y: 1,
        lift0: target.z,
        lift1: target.z,
        w: target.w,
        h: target.h,
      });
    }
  }
  for (const pc of prev.cards) {
    if (next.byId[pc.id]) continue;
    tracks.push({
      id: pc.id,
      kind: "exit",
      v0: pc.dir.clone(),
      v1: extendFromPole(pc.dir.clone().applyQuaternion(qPole), EXIT_ARC),
      o0: pc.opacity,
      o1: 0,
      s0x: pc.sx,
      s0y: pc.sy,
      s1x: 0.9,
      s1y: 0.9,
      lift0: pc.lift,
      lift1: 0,
      w: pc.w,
      h: pc.h,
    });
  }
  return { R0: prev.R, R1: next.R, duration: opts?.duration ?? DURATION_MS, tracks };
}

export interface TrackSample {
  dir: THREE.Vector3;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  opacity: number;
  sx: number;
  sy: number;
}

/** Sample a track at eased progress `e` on the sphere of radius `R` (the
 *  caller interpolates R). Orientation is re-derived from the live dir every
 *  sample — cards genuinely roll with the surface. */
export function sampleTrack(t: CardTrack, R: number, e: number): TrackSample {
  const omega = t.v0.angleTo(t.v1);
  const dir =
    omega < 1e-9
      ? t.v1.clone()
      : t.v0
          .clone()
          .multiplyScalar(Math.sin((1 - e) * omega) / Math.sin(omega))
          .addScaledVector(t.v1, Math.sin(e * omega) / Math.sin(omega))
          .normalize();
  const lift = t.lift0 + (t.lift1 - t.lift0) * e;
  const pos = new THREE.Vector3(0, 0, -R).addScaledVector(dir, R + lift);
  const { quat } = frameFromDir(dir);
  const fade = horizonFade(dir.z);
  const opacity =
    t.kind === "exit"
      ? t.o0 * (1 - Math.min(1, e / 0.8)) * fade
      : (t.o0 + (t.o1 - t.o0) * e) * fade;
  return {
    dir,
    pos,
    quat,
    opacity,
    sx: t.s0x + (t.s1x - t.s0x) * e,
    sy: t.s0y + (t.s1y - t.s0y) * e,
  };
}
