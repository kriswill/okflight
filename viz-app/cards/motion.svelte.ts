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
import { arcFade, cylPose, FADE_START } from "./cylinder";
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
  const view = { zoom: 1, shift: 0 };
  let viewTarget: { zoom: number; shift: number } | null = null;
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
    s.opacity = s.baseOpacity * arcFade(eff);
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
      limits[side] = Math.max(0, maxAbs - FADE_START);
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
   *  position (clamped inside the edge) — arrows slide along the focus card
   *  as their band scrolls. */
  const driftFocusLocal = (
    local: { x: number; y: number },
    focusSample: CardSample,
    other: CardSample,
  ): { x: number; y: number } => {
    const half = (flow === "v" ? focusSample.w : focusSample.h) / 2;
    const drift = Math.min(half * DRIFT_CLAMP, Math.max(-half * DRIFT_CLAMP, other.effBand));
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
      const fromWorld = new THREE.Vector3(fl.x, fl.y, 0).applyQuaternion(from.quat).add(from.pos);
      const toWorld = new THREE.Vector3(tl.x, tl.y, 0).applyQuaternion(to.quat).add(to.pos);
      const head = edgeHead(toWorld, toTan, HEAD_H);
      const tailHead = tr.spec.twoWay ? edgeHead(fromWorld, fromTan, HEAD_H) : null;
      const endStub = toWorld.clone().addScaledVector(toTan, HEAD_H + HEAD_STEM);
      const startPoint = tailHead ? tailHead.base : fromWorld;
      const startStub = tailHead ? fromWorld.clone().addScaledVector(fromTan, HEAD_H + HEAD_STEM) : fromWorld;
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

  const settleAt = (layout: CardLayout) => {
    samples.clear();
    for (const p of layout.cards) samples.set(p.id, sampleOf(p));
    spec = null;
    t = 0;
    renderList = layout.cards.map((p) => entryOf(p, false));
    retargetArrows(null, layout);
    computeArrows(1);
    settled = viewAtTarget();
  };

  const viewAtTarget = () =>
    !viewTarget || (Math.abs(view.zoom - viewTarget.zoom) < 1e-4 && Math.abs(view.shift - viewTarget.shift) < 0.1);

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
      }
    }
    if (viewTarget && !viewAtTarget()) {
      const k = 1 - Math.exp(-dtMs / VIEW_TAU_MS);
      view.zoom += (viewTarget.zoom - view.zoom) * k;
      view.shift += (viewTarget.shift - view.shift) * k;
      if (viewAtTarget()) {
        view.zoom = viewTarget.zoom;
        view.shift = viewTarget.shift;
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
      const prevEntries = new Map(renderList.map((r) => [r.id, r]));
      renderList = [
        ...next.cards.map((p) => entryOf(p, false)),
        ...spec.tracks
          .filter((tr) => tr.kind === "exit" && prevEntries.has(tr.id))
          .map((tr) => ({ ...prevEntries.get(tr.id)!, exiting: true })),
      ];
      // Ensure every track id has a sample shell to tween.
      for (const track of spec.tracks) {
        if (!samples.has(track.id)) {
          const p = next.byId[track.id]!;
          samples.set(track.id, sampleOf(p));
        }
      }
      retargetArrows(prevFlat, next);
      flat = next;
      computeLimits(next);
      step(0);
      updateSettled();
    },

    step,

    setViewTargets(zoom: number, shift: number) {
      viewTarget = { zoom, shift };
      if (!viewSeeded || reduced()) {
        view.zoom = zoom;
        view.shift = shift;
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
          w: s.w * s.sx,
          h: s.h * s.sy,
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
