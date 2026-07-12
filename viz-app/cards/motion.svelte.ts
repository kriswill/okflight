// The single source of per-frame truth for the animated card view. Cards
// live at FLAT layout coordinates (tweened by transitions), get a per-band
// SCROLL offset (the in-side and out-side scroll independently; ring-2
// clusters sit at parent-anchored coordinates so they track automatically),
// and are mapped through the cylinder scaffolding with a scroll-window fade.
// All stepped with explicit dt so behavior is deterministic under bun test.
// Svelte reactivity is used ONLY for structure (renderList/arrowList) and
// boundary flags (settled); per-frame numbers live in plain fields that the
// scene's frame task reads and applies imperatively (single-writer rule).
import * as THREE from "three";
import type { ArrowSpec, CardFlow, CardLayout, CardPlacement } from "./cardLayout";
import { arrowAnchors, edgeHead, edgeTangent, elbowPath3 } from "./arrowFrame";
import { arcFade, arcScale, cylPose, FADE_END, FADE_START } from "./cylinder";
import { buildTransition, easeOutCubic, sampleTrack, type FlatSnapshot, type TransitionSpec } from "./transition";
import type { PickItem } from "./picking";

export const HEAD_H = 12;
/** Straight run before each cone base so the tube meets the flat side at 90°. */
const HEAD_STEM = 8;
const ARROW_BASE_OPACITY = 0.85;
const VIEW_TAU_MS = 90;
/** Focus-edge anchors drift with the scrolled card, clamped to this
 *  fraction of the focus edge half-extent. */
const DRIFT_CLAMP = 0.85;

export type ScrollSide = "in" | "out";

/** One band-edge overflow indicator: `count` cards live past that edge. */
export interface OverflowChip {
  key: string;
  lane: ScrollSide;
  dir: 1 | -1;
  count: number;
}

export interface RenderEntry {
  id: string;
  kind: CardPlacement["kind"];
  lane: CardPlacement["lane"];
  w: number;
  h: number;
  /** Leaving the layout: kept mounted while it fades/rolls out. */
  exiting: boolean;
}

export interface CardSample {
  /** Flat layout coordinates (scroll NOT included). */
  flatX: number;
  flatY: number;
  lane: CardPlacement["lane"];
  lift: number;
  /** Track opacity before the scroll-window fade. */
  baseOpacity: number;
  sx: number;
  sy: number;
  w: number;
  h: number;
  /** Derived on every reproject: */
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  opacity: number;
  /** Band coordinate after scroll — what fades and drift anchors read. */
  effBand: number;
  /** Aperture scale by band distance (1 at center, SCALE_MIN at the fade
   *  edge) — the rendered card size; arrows and picking follow it. */
  scale: number;
}

export interface ArrowState {
  key: string;
  fromId: string;
  toId: string;
  dir: "in" | "out";
  twoWay: boolean;
  fromLocal: { x: number; y: number };
  toLocal: { x: number; y: number };
  path: THREE.Vector3[];
  head: { pos: THREE.Vector3; quat: THREE.Quaternion };
  tailHead: { pos: THREE.Vector3; quat: THREE.Quaternion } | null;
  opacity: number;
}

interface ArrowTrack {
  key: string;
  spec: Pick<ArrowSpec, "fromId" | "toId" | "dir" | "twoWay">;
  kind: "shared" | "enter" | "exit";
  from0: { x: number; y: number };
  from1: { x: number; y: number };
  to0: { x: number; y: number };
  to1: { x: number; y: number };
}

const defaultReducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const sameLayout = (a: CardLayout, b: CardLayout) =>
  a.focusId === b.focusId &&
  a.rootFocus === b.rootFocus &&
  a.cards.length === b.cards.length &&
  a.cards.every((c, i) => {
    const o = b.cards[i]!;
    return c.id === o.id && c.kind === o.kind && c.x === o.x && c.y === o.y && c.w === o.w && c.h === o.h;
  });

export function createCardMotion(opts?: { reducedMotion?: () => boolean }) {
  const reduced = opts?.reducedMotion ?? defaultReducedMotion;

  let renderList = $state<RenderEntry[]>([]);
  let arrowList = $state<{ key: string; fromId: string; toId: string; dir: "in" | "out"; twoWay: boolean }[]>([]);
  let settled = $state(true);
  /** Band-edge overflow indicators — cleared while a transition is in
   *  flight (mid-flight counts would lie), recomputed at settle/scroll. */
  let overflow = $state<OverflowChip[]>([]);

  // Plain per-frame state — no reactivity at 60fps.
  let flow: CardFlow = "v";
  let flat: CardLayout | null = null;
  let spec: TransitionSpec | null = null;
  let t = 0;
  const samples = new Map<string, CardSample>();
  let arrowTracks: ArrowTrack[] = [];
  let arrows: ArrowState[] = [];
  const scroll: Record<ScrollSide, number> = { in: 0, out: 0 };
  const limits: Record<ScrollSide, number> = { in: 0, out: 0 };
  // Visible-window fade ramp along the band axis. Defaults to the reference
  // window; setWindow derives it from the live viewport so the focus card
  // keeps its scale and cards vanish BEFORE the screen edge, however long
  // the band.
  let fadeStart = FADE_START;
  let fadeEnd = FADE_END;
  // Camera state: zoom plus a world-space look-at center. cx composes the
  // panel inset with the h-flow occupied-extent center; cy carries the
  // v-flow one — refocusing onto a one-sided node glides the view toward
  // its occupied side instead of pinning the focus to the stage center.
  const view = { zoom: 1, cx: 0, cy: 0 };
  let viewTarget: { zoom: number; cx: number; cy: number } | null = null;
  let viewSeeded = false;

  const bandOf = (x: number, y: number) => (flow === "v" ? x : y);
  const crossOf = (x: number, y: number) => (flow === "v" ? y : x);

  /** Map a sample's flat coords through scroll + cylinder + window fade. */
  const reproject = (s: CardSample) => {
    const band = bandOf(s.flatX, s.flatY);
    const sc = s.lane === "in" || s.lane === "out" ? scroll[s.lane] : 0;
    const eff = band - sc;
    const p = cylPose(eff, crossOf(s.flatX, s.flatY), s.lift, flow);
    s.pos = p.pos;
    s.quat = p.quat;
    s.effBand = eff;
    s.opacity = s.baseOpacity * arcFade(eff, fadeStart, fadeEnd);
    s.scale = arcScale(eff, fadeEnd);
  };
  const reprojectAll = () => {
    for (const s of samples.values()) reproject(s);
  };

  /** Scroll room per side: zero when the band fits the window, else enough
   *  to bring the farthest card fully inside it. */
  const computeLimits = (layout: CardLayout) => {
    for (const side of ["in", "out"] as const) {
      let maxAbs = 0;
      for (const c of layout.cards)
        if (c.lane === side) maxAbs = Math.max(maxAbs, Math.abs(bandOf(c.x, c.y)));
      limits[side] = Math.max(0, maxAbs - fadeStart);
    }
  };

  const entryOf = (p: CardPlacement, exiting: boolean): RenderEntry => ({
    id: p.id,
    kind: p.kind,
    lane: p.lane,
    w: p.w,
    h: p.h,
    exiting,
  });

  const sampleOf = (p: CardPlacement): CardSample => {
    const s: CardSample = {
      flatX: p.x,
      flatY: p.y,
      lane: p.lane,
      lift: p.z,
      baseOpacity: 1,
      sx: 1,
      sy: 1,
      w: p.w,
      h: p.h,
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      opacity: 1,
      effBand: 0,
      scale: 1,
    };
    reproject(s);
    return s;
  };

  /** Live state with the scroll baked into the flat coords — the `from` of
   *  every transition (position-continuous; scroll then resets to zero). */
  const snapshot = (): FlatSnapshot => ({
    cards: [...samples.entries()].map(([id, s]) => {
      const sc = s.lane === "in" || s.lane === "out" ? scroll[s.lane] : 0;
      return {
        id,
        x: flow === "v" ? s.flatX - sc : s.flatX,
        y: flow === "v" ? s.flatY : s.flatY - sc,
        opacity: s.opacity,
        sx: s.sx,
        sy: s.sy,
        w: s.w,
        h: s.h,
        lift: s.lift,
      };
    }),
  });

  /** Rebuild the arrow track set for a transition (or a settled layout). */
  const retargetArrows = (prevFlat: CardLayout | null, nextFlat: CardLayout) => {
    const next = new Map(nextFlat.arrows.map((a) => [a.fromId + "→" + a.toId, a]));
    const prev = new Map((prevFlat?.arrows ?? []).map((a) => [a.fromId + "→" + a.toId, a]));
    const tracks: ArrowTrack[] = [];
    for (const [key, a] of next) {
      const anchors1 = arrowAnchors(a, nextFlat.byId);
      const p = prev.get(key);
      if (p && prevFlat) {
        const anchors0 = arrowAnchors(p, prevFlat.byId);
        tracks.push({
          key,
          spec: a,
          kind: "shared",
          from0: anchors0.from.local,
          from1: anchors1.from.local,
          to0: anchors0.to.local,
          to1: anchors1.to.local,
        });
      } else {
        tracks.push({
          key,
          spec: a,
          kind: "enter",
          from0: anchors1.from.local,
          from1: anchors1.from.local,
          to0: anchors1.to.local,
          to1: anchors1.to.local,
        });
      }
    }
    if (prevFlat) {
      for (const [key, a] of prev) {
        if (next.has(key)) continue;
        const anchors0 = arrowAnchors(a, prevFlat.byId);
        tracks.push({
          key,
          spec: a,
          kind: "exit",
          from0: anchors0.from.local,
          from1: anchors0.from.local,
          to0: anchors0.to.local,
          to1: anchors0.to.local,
        });
      }
    }
    arrowTracks = tracks;
    arrowList = tracks.map((tr) => ({
      key: tr.key,
      fromId: tr.spec.fromId,
      toId: tr.spec.toId,
      dir: tr.spec.dir,
      twoWay: tr.spec.twoWay,
    }));
  };

  /** Anchors on the focus edge drift with the linked card's scrolled band
   *  position, COMPRESSED so the whole fade window maps onto the edge:
   *  every visible arrow gets a distinct, ordered anchor with spacing (no
   *  corner pile-ups), and all of them slide as the band scrolls. */
  const driftFocusLocal = (
    local: { x: number; y: number },
    focusSample: CardSample,
    other: CardSample,
  ): { x: number; y: number } => {
    const limit = ((flow === "v" ? focusSample.w : focusSample.h) / 2) * DRIFT_CLAMP;
    const drift = limit * Math.min(1, Math.max(-1, other.effBand / fadeEnd));
    return flow === "v" ? { x: drift, y: local.y } : { x: local.x, y: drift };
  };

  /** Recompute every arrow from the live card samples at eased progress e. */
  const computeArrows = (e: number) => {
    const focusId = flat?.focusId ?? null;
    const out: ArrowState[] = [];
    for (const tr of arrowTracks) {
      const from = samples.get(tr.spec.fromId);
      const to = samples.get(tr.spec.toId);
      if (!from || !to) continue;
      const lerp = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
        x: a.x + (b.x - a.x) * e,
        y: a.y + (b.y - a.y) * e,
      });
      let fl = tr.kind === "shared" ? lerp(tr.from0, tr.from1) : tr.from0;
      let tl = tr.kind === "shared" ? lerp(tr.to0, tr.to1) : tr.to0;
      if (focusId !== null && tr.spec.toId === focusId) tl = driftFocusLocal(tl, to, from);
      if (focusId !== null && tr.spec.fromId === focusId) fl = driftFocusLocal(fl, from, to);
      const ft = edgeTangent(fl, from.w, from.h);
      const tt = edgeTangent(tl, to.w, to.h);
      const fromTan = new THREE.Vector3(ft.x, ft.y, 0).applyQuaternion(from.quat);
      const toTan = new THREE.Vector3(tt.x, tt.y, 0).applyQuaternion(to.quat);
      // Anchors (and head sizes) follow the aperture-scaled card edges.
      const fromWorld = new THREE.Vector3(fl.x * from.scale, fl.y * from.scale, 0)
        .applyQuaternion(from.quat)
        .add(from.pos);
      const toWorld = new THREE.Vector3(tl.x * to.scale, tl.y * to.scale, 0).applyQuaternion(to.quat).add(to.pos);
      const head = edgeHead(toWorld, toTan, HEAD_H * to.scale);
      const tailHead = tr.spec.twoWay ? edgeHead(fromWorld, fromTan, HEAD_H * from.scale) : null;
      const endStub = toWorld.clone().addScaledVector(toTan, (HEAD_H + HEAD_STEM) * to.scale);
      const startPoint = tailHead ? tailHead.base : fromWorld;
      const startStub = tailHead
        ? fromWorld.clone().addScaledVector(fromTan, (HEAD_H + HEAD_STEM) * from.scale)
        : fromWorld;
      const bez = elbowPath3(startStub, fromTan, endStub, toTan);
      const path = tailHead ? [startPoint.clone(), ...bez, head.base] : [...bez, head.base];
      const ramp =
        tr.kind === "exit"
          ? ARROW_BASE_OPACITY * (1 - Math.min(1, e / 0.5))
          : tr.kind === "enter"
            ? ARROW_BASE_OPACITY * e
            : ARROW_BASE_OPACITY;
      out.push({
        key: tr.key,
        fromId: tr.spec.fromId,
        toId: tr.spec.toId,
        dir: tr.spec.dir,
        twoWay: tr.spec.twoWay,
        fromLocal: fl,
        toLocal: tl,
        path,
        head,
        tailHead,
        // Lines fade with their cards as they scroll through the window.
        opacity: ramp * Math.min(from.opacity, to.opacity, 1),
      });
    }
    arrows = out;
  };

  /** Count settled cards past each band edge (they render at opacity 0). */
  const computeOverflow = () => {
    if (!flat) {
      overflow = [];
      return;
    }
    const counts = { in: { neg: 0, pos: 0 }, out: { neg: 0, pos: 0 } };
    for (const s of samples.values()) {
      if (s.lane !== "in" && s.lane !== "out") continue;
      if (s.effBand >= fadeEnd - 1e-6) counts[s.lane].pos++;
      else if (s.effBand <= -(fadeEnd - 1e-6)) counts[s.lane].neg++;
    }
    overflow = (["in", "out"] as const).flatMap((lane) =>
      ([
        [-1, counts[lane].neg],
        [1, counts[lane].pos],
      ] as const)
        .filter(([, count]) => count > 0)
        .map(([dir, count]) => ({ key: `${lane}:${dir}`, lane, dir, count })),
    );
  };

  const settleAt = (layout: CardLayout) => {
    samples.clear();
    for (const p of layout.cards) samples.set(p.id, sampleOf(p));
    spec = null;
    t = 0;
    renderList = layout.cards.map((p) => entryOf(p, false));
    retargetArrows(null, layout);
    computeArrows(1);
    computeOverflow();
    settled = viewAtTarget();
  };

  const viewAtTarget = () =>
    !viewTarget ||
    (Math.abs(view.zoom - viewTarget.zoom) < 1e-4 &&
      Math.abs(view.cx - viewTarget.cx) < 0.1 &&
      Math.abs(view.cy - viewTarget.cy) < 0.1);

  const updateSettled = () => {
    settled = !spec && viewAtTarget();
  };

  /** Advance all tweens by dtMs. Returns true while more frames are needed. */
  const step = (dtMs: number): boolean => {
    if (spec) {
      t = spec.duration === 0 ? 1 : Math.min(1, t + dtMs / spec.duration);
      const e = easeOutCubic(t);
      for (const track of spec.tracks) {
        const v = sampleTrack(track, e);
        const s = samples.get(track.id);
        if (!s) continue;
        s.flatX = v.x;
        s.flatY = v.y;
        s.lift = v.lift;
        s.baseOpacity = v.opacity;
        s.sx = v.sx;
        s.sy = v.sy;
        s.w = track.w;
        s.h = track.h;
        reproject(s);
      }
      computeArrows(e);
      if (t >= 1) {
        for (const track of spec.tracks) if (track.kind === "exit") samples.delete(track.id);
        renderList = renderList.filter((r) => !r.exiting);
        arrowTracks = arrowTracks.filter((a) => a.kind !== "exit");
        arrowList = arrowList.filter((a) => arrowTracks.some((tr) => tr.key === a.key));
        spec = null;
        computeArrows(1);
        computeOverflow();
      }
    }
    if (viewTarget && !viewAtTarget()) {
      const k = 1 - Math.exp(-dtMs / VIEW_TAU_MS);
      view.zoom += (viewTarget.zoom - view.zoom) * k;
      view.cx += (viewTarget.cx - view.cx) * k;
      view.cy += (viewTarget.cy - view.cy) * k;
      if (viewAtTarget()) {
        view.zoom = viewTarget.zoom;
        view.cx = viewTarget.cx;
        view.cy = viewTarget.cy;
      }
    }
    updateSettled();
    return !settled;
  };

  return {
    get renderList() {
      return renderList;
    },
    get arrowList() {
      return arrowList;
    },
    get settled() {
      return settled;
    },
    /** Eased transition progress; 1 whenever no transition is in flight. */
    get progress() {
      return spec ? easeOutCubic(Math.min(1, t)) : 1;
    },
    get view() {
      return view;
    },
    get flow() {
      return flow;
    },
    get scroll() {
      return { ...scroll };
    },
    scrollLimit(side: ScrollSide) {
      return limits[side];
    },
    get rootFocus() {
      return flat?.rootFocus ?? false;
    },
    get focusId() {
      return flat?.focusId ?? null;
    },

    setLayout(next: CardLayout | null, flowArg: CardFlow = "v") {
      if (!next) {
        flat = null;
        spec = null;
        samples.clear();
        arrowTracks = [];
        arrows = [];
        renderList = [];
        arrowList = [];
        overflow = [];
        scroll.in = 0;
        scroll.out = 0;
        settled = true;
        return;
      }
      const prevFlat = flat;
      if (prevFlat && flow === flowArg && sameLayout(prevFlat, next)) {
        // Same placements re-derived (theme flip, no-op filter churn):
        // adopt the new references without animating or resetting scroll.
        flat = next;
        retargetArrows(null, next);
        if (!spec) computeArrows(1);
        return;
      }
      if (!prevFlat || reduced()) {
        flow = flowArg;
        flat = next;
        scroll.in = 0;
        scroll.out = 0;
        computeLimits(next);
        settleAt(next);
        return;
      }
      // Live refocus/reflow: from the scroll-baked live state, scroll reset.
      const snap = snapshot();
      flow = flowArg;
      scroll.in = 0;
      scroll.out = 0;
      spec = buildTransition(snap, next, flow);
      t = 0;
      overflow = [];
      const prevEntries = new Map(renderList.map((r) => [r.id, r]));
      renderList = [
        ...next.cards.map((p) => entryOf(p, false)),
        ...spec.tracks
          .filter((tr) => tr.kind === "exit" && prevEntries.has(tr.id))
          .map((tr) => ({ ...prevEntries.get(tr.id)!, exiting: true })),
      ];
      // Ensure every track id has a sample shell to tween, and re-band the
      // persisting ones: lane picks the scroll offset in reproject, so a
      // card moving between the focus/in/out lanes must adopt its NEW band
      // (a stale lane left ex-focus cards pinned while their band scrolled
      // under them). Exit tracks have no next placement and keep theirs.
      for (const track of spec.tracks) {
        const p = next.byId[track.id];
        const s = samples.get(track.id);
        if (!s) samples.set(track.id, sampleOf(p!));
        else if (p) s.lane = p.lane;
      }
      retargetArrows(prevFlat, next);
      flat = next;
      computeLimits(next);
      step(0);
      updateSettled();
    },

    step,

    setViewTargets(zoom: number, cx: number, cy: number) {
      viewTarget = { zoom, cx, cy };
      if (!viewSeeded || reduced()) {
        view.zoom = zoom;
        view.cx = cx;
        view.cy = cy;
        viewSeeded = true;
      }
      updateSettled();
    },

    /** Scroll one band by a world-unit delta, clamped to its limit. Ring-2
     *  clusters share their parent band's lane, so they track for free. */
    scrollBy(side: ScrollSide, delta: number) {
      const L = limits[side];
      const next = Math.min(L, Math.max(-L, scroll[side] + delta));
      if (next === scroll[side]) return;
      scroll[side] = next;
      reprojectAll();
      computeArrows(spec ? easeOutCubic(Math.min(1, t)) : 1);
      if (!spec) computeOverflow();
    },

    /** Visible half-extent along the band axis (world units), derived from
     *  the live viewport: the fade ramp ends there, so cards vanish before
     *  the screen edge instead of being clipped by it. */
    setWindow(halfBand: number) {
      const end = Math.min(FADE_END, Math.max(360, halfBand));
      if (end === fadeEnd) return;
      fadeEnd = end;
      fadeStart = Math.max(end - (FADE_END - FADE_START), end / 2);
      if (!flat) return;
      computeLimits(flat);
      scroll.in = Math.min(limits.in, Math.max(-limits.in, scroll.in));
      scroll.out = Math.min(limits.out, Math.max(-limits.out, scroll.out));
      reprojectAll();
      computeArrows(spec ? easeOutCubic(Math.min(1, t)) : 1);
      if (!spec) computeOverflow();
    },
    get window() {
      return { fadeStart, fadeEnd };
    },
    get overflow() {
      return overflow;
    },

    sample(id: string): CardSample | null {
      return samples.get(id) ?? null;
    },

    /** World center of a card as rendered. */
    pose(id: string): THREE.Vector3 | null {
      const s = samples.get(id);
      return s ? s.pos.clone() : null;
    },

    /** Live pickable poses (faded cards are unpickable via the opacity gate). */
    pickItems(): PickItem[] {
      const items: PickItem[] = [];
      for (const r of renderList) {
        const s = samples.get(r.id);
        if (!s) continue;
        items.push({
          id: r.id,
          kind: r.kind,
          pos: s.pos,
          quat: s.quat,
          w: s.w * s.sx * s.scale,
          h: s.h * s.sy * s.scale,
          opacity: s.opacity,
        });
      }
      return items;
    },

    arrowStates(): ArrowState[] {
      return arrows;
    },
  };
}

export type CardMotion = ReturnType<typeof createCardMotion>;
