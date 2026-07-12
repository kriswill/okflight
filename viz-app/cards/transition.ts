// Refocus transition tracks in FLAT layout space: every card lerps its
// (band, cross) coordinates over the same eased 420ms; the motion store maps
// samples through the cylinder and composes per-band scroll, so one track
// model serves both flows. Exits keep their cross lane and roll a fixed
// EXIT_DIST further along the band axis while fading; enters run the same
// path in reverse. Pure 2D math — no three.js needed here anymore.
import type { CardFlow, CardLayout } from "./cardLayout";

export const DURATION_MS = 420;
/** Exit/enter roll-out travel along the band axis, world units. */
export const EXIT_DIST = 420;
/** Matches GraphScene.stepFly — fast start, gentle landing. */
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** Live card state at transition start (scroll already baked in). */
export interface SnapshotCard {
  id: string;
  x: number;
  y: number;
  opacity: number;
  sx: number;
  sy: number;
  w: number;
  h: number;
  lift: number;
}

export interface FlatSnapshot {
  cards: SnapshotCard[];
}

/** The settled snapshot of a flat layout (scale 1, full opacity). */
export function snapshotOf(flat: CardLayout): FlatSnapshot {
  return {
    cards: flat.cards.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      opacity: 1,
      sx: 1,
      sy: 1,
      w: p.w,
      h: p.h,
      lift: p.z,
    })),
  };
}

export interface CardTrack {
  id: string;
  kind: "shared" | "enter" | "exit";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
  duration: number;
  tracks: CardTrack[];
}

/** Offset a point EXIT_DIST further from the band center along the band
 *  axis — where exits go and enters come from. */
const rollOut = (x: number, y: number, flow: CardFlow): { x: number; y: number } => {
  if (flow === "v") return { x: x + (Math.sign(x) || 1) * EXIT_DIST, y };
  return { x, y: y + (Math.sign(y) || 1) * EXIT_DIST };
};

export function buildTransition(
  prev: FlatSnapshot,
  next: CardLayout,
  flow: CardFlow,
  opts?: { duration?: number },
): TransitionSpec {
  const prevById = new Map(prev.cards.map((c) => [c.id, c]));
  const tracks: CardTrack[] = [];
  for (const target of next.cards) {
    const pc = prevById.get(target.id);
    if (pc) {
      tracks.push({
        id: target.id,
        kind: "shared",
        x0: pc.x,
        y0: pc.y,
        x1: target.x,
        y1: target.y,
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
      const from = rollOut(target.x, target.y, flow);
      tracks.push({
        id: target.id,
        kind: "enter",
        x0: from.x,
        y0: from.y,
        x1: target.x,
        y1: target.y,
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
    const to = rollOut(pc.x, pc.y, flow);
    tracks.push({
      id: pc.id,
      kind: "exit",
      x0: pc.x,
      y0: pc.y,
      x1: to.x,
      y1: to.y,
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
  return { duration: opts?.duration ?? DURATION_MS, tracks };
}

export interface TrackSample {
  x: number;
  y: number;
  opacity: number;
  sx: number;
  sy: number;
  lift: number;
}

/** Sample a track at eased progress `e` in flat space. The caller maps the
 *  result through the cylinder and multiplies the scroll-window fade. */
export function sampleTrack(t: CardTrack, e: number): TrackSample {
  const opacity =
    t.kind === "exit" ? t.o0 * (1 - Math.min(1, e / 0.8)) : t.o0 + (t.o1 - t.o0) * e;
  return {
    x: t.x0 + (t.x1 - t.x0) * e,
    y: t.y0 + (t.y1 - t.y0) * e,
    opacity,
    sx: t.s0x + (t.s1x - t.s0x) * e,
    sy: t.s0y + (t.s1y - t.s0y) * e,
    lift: t.lift0 + (t.lift1 - t.lift0) * e,
  };
}
