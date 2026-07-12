// The single source of per-frame truth for the animated card view. Owns the
// dome layout, refocus transition tracks, live per-card samples, arrow
// states, the drag orientation, and the camera tween — all stepped with an
// explicit dt so behavior is deterministic under bun test. Svelte reactivity
// is used ONLY for structure (renderList) and boundary flags (settled);
// per-frame numbers live in plain fields that the scene's frame task reads
// and applies imperatively (single-writer rule).
import * as THREE from "three";
import type { ArrowSpec, CardLayout, CardPlacement } from "./cardLayout";
import { arrowAnchors, elbowPath3, headTransform, trimEnd } from "./arrowFrame";
import { domeProject, frameFromDir, type DomeLayout } from "./dome";
import {
  buildTransition,
  easeOutCubic,
  sampleTrack,
  type DomeSnapshot,
  type TransitionSpec,
} from "./transition";
import type { PickItem } from "./picking";

export const HEAD_H = 12;
const HEAD_TRIM = HEAD_H * 0.8;
const ARROW_BASE_OPACITY = 0.85;
const VIEW_TAU_MS = 90;
const YAW_CLAMP = 0.9;
const PITCH_CLAMP = 0.6;

export interface RenderEntry {
  id: string;
  kind: CardPlacement["kind"];
  lane: CardPlacement["lane"];
  w: number;
  h: number;
  overflow: number;
  /** Leaving the layout: kept mounted while it fades/rolls out. */
  exiting: boolean;
}

export interface CardSample {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  dir: THREE.Vector3;
  lift: number;
  opacity: number;
  sx: number;
  sy: number;
  w: number;
  h: number;
}

export interface ArrowState {
  key: string;
  fromId: string;
  toId: string;
  dir: "in" | "out";
  twoWay: boolean;
  fromLocal: { x: number; y: number };
  toLocal: { x: number; y: number };
  /** Tube samples (end tucked under the head base). */
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
  let dome: DomeLayout | null = null;
  let spec: TransitionSpec | null = null;
  let t = 0;
  let liveR = 0;
  const samples = new Map<string, CardSample>();
  let arrowTracks: ArrowTrack[] = [];
  let arrows: ArrowState[] = [];
  const drag = { yaw: 0, pitch: 0 };
  const view = { zoom: 1, shift: 0 };
  let viewTarget: { zoom: number; shift: number } | null = null;
  let viewSeeded = false;

  const entryOf = (p: CardPlacement, exiting: boolean): RenderEntry => ({
    id: p.id,
    kind: p.kind,
    lane: p.lane,
    w: p.w,
    h: p.h,
    overflow: p.overflow,
    exiting,
  });

  const settledSample = (d: DomeLayout, p: CardPlacement): CardSample => {
    const c = d.byId[p.id]!;
    return {
      pos: c.pos.clone(),
      quat: c.quat.clone(),
      dir: c.dir.clone(),
      lift: p.z,
      opacity: 1,
      sx: 1,
      sy: 1,
      w: p.w,
      h: p.h,
    };
  };

  /** Live state with the drag baked in — the `from` of every transition. */
  const snapshot = (): DomeSnapshot => {
    const qDrag = dragQuat();
    return {
      R: liveR,
      cards: [...samples.entries()].map(([id, s]) => ({
        id,
        dir: s.dir.clone().applyQuaternion(qDrag),
        opacity: s.opacity,
        sx: s.sx,
        sy: s.sy,
        w: s.w,
        h: s.h,
        lift: s.lift,
      })),
    };
  };

  function dragQuat(): THREE.Quaternion {
    return new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), drag.yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), drag.pitch));
  }

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

  /** Recompute every arrow from the live card samples at eased progress e. */
  const computeArrows = (e: number) => {
    const out: ArrowState[] = [];
    for (const tr of arrowTracks) {
      const from = samples.get(tr.spec.fromId);
      const to = samples.get(tr.spec.toId);
      if (!from || !to) continue;
      const lerp = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
        x: a.x + (b.x - a.x) * e,
        y: a.y + (b.y - a.y) * e,
      });
      const fl = tr.kind === "shared" ? lerp(tr.from0, tr.from1) : tr.from0;
      const tl = tr.kind === "shared" ? lerp(tr.to0, tr.to1) : tr.to0;
      const fromWorld = new THREE.Vector3(fl.x, fl.y, 0).applyQuaternion(from.quat).add(from.pos);
      const toWorld = new THREE.Vector3(tl.x, tl.y, 0).applyQuaternion(to.quat).add(to.pos);
      const fromTan = new THREE.Vector3(0, -1, 0).applyQuaternion(from.quat);
      const toTan = new THREE.Vector3(0, 1, 0).applyQuaternion(to.quat);
      const full = elbowPath3(fromWorld, fromTan, toWorld, toTan);
      const opacity =
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
        path: trimEnd(full, HEAD_TRIM),
        head: headTransform(full, HEAD_H),
        tailHead: tr.spec.twoWay ? headTransform(full, HEAD_H, true) : null,
        opacity,
      });
    }
    arrows = out;
  };

  const settleAt = (d: DomeLayout) => {
    samples.clear();
    for (const p of d.flat.cards) samples.set(p.id, settledSample(d, p));
    liveR = d.R;
    spec = null;
    t = 0;
    renderList = d.flat.cards.map((p) => entryOf(p, false));
    retargetArrows(null, d.flat);
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
      liveR = spec.R0 + (spec.R1 - spec.R0) * e;
      for (const track of spec.tracks) {
        const s = sampleTrack(track, liveR, e);
        samples.set(track.id, {
          pos: s.pos,
          quat: s.quat,
          dir: s.dir,
          lift: track.lift0 + (track.lift1 - track.lift0) * e,
          opacity: s.opacity,
          sx: s.sx,
          sy: s.sy,
          w: track.w,
          h: track.h,
        });
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
    get drag() {
      return drag;
    },
    get view() {
      return view;
    },
    get R() {
      return liveR;
    },
    get rootFocus() {
      return dome?.rootFocus ?? false;
    },
    get focusId() {
      return dome?.focusId ?? null;
    },
    dragQuat,

    setLayout(flat: CardLayout | null) {
      if (!flat) {
        dome = null;
        spec = null;
        samples.clear();
        arrowTracks = [];
        arrows = [];
        renderList = [];
        arrowList = [];
        settled = true;
        return;
      }
      const prevFlat = dome?.flat ?? null;
      if (prevFlat && sameLayout(prevFlat, flat)) {
        // Same placements re-derived (theme flip, no-op filter churn):
        // adopt the new references without animating.
        dome = domeProject(flat);
        retargetArrows(null, flat);
        if (!spec) {
          for (const p of flat.cards) samples.set(p.id, settledSample(dome, p));
          computeArrows(1);
        }
        return;
      }
      const next = domeProject(flat);
      if (!dome || reduced()) {
        dome = next;
        settleAt(next);
        return;
      }
      // Live refocus: from the drag-baked live state, drag renormalized.
      const snap = snapshot();
      drag.yaw = 0;
      drag.pitch = 0;
      spec = buildTransition(snap, next);
      t = 0;
      // Exit entries come from the CURRENT render list, not the previous
      // flat layout: under cascading interrupts an exiting card may belong
      // to a layout two retargets back — samples and renderList are the
      // only structures guaranteed to still know it.
      const prevEntries = new Map(renderList.map((r) => [r.id, r]));
      renderList = [
        ...flat.cards.map((p) => entryOf(p, false)),
        ...spec.tracks
          .filter((tr) => tr.kind === "exit" && prevEntries.has(tr.id))
          .map((tr) => ({ ...prevEntries.get(tr.id)!, exiting: true })),
      ];
      retargetArrows(prevFlat, flat);
      dome = next;
      // Seed t=0 samples so reads before the first step are already live.
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

    dragBy(dxPx: number, dyPx: number, zoom: number) {
      const denom = Math.max(1e-6, zoom * liveR);
      drag.yaw = Math.min(YAW_CLAMP, Math.max(-YAW_CLAMP, drag.yaw + dxPx / denom));
      drag.pitch = Math.min(PITCH_CLAMP, Math.max(-PITCH_CLAMP, drag.pitch + dyPx / denom));
    },

    sample(id: string): CardSample | null {
      return samples.get(id) ?? null;
    },

    /** Drag-composed world center of a card (what the user actually sees). */
    pose(id: string): THREE.Vector3 | null {
      const s = samples.get(id);
      if (!s) return null;
      const C = new THREE.Vector3(0, 0, -liveR);
      return s.pos.clone().sub(C).applyQuaternion(dragQuat()).add(C);
    },

    /** Live pickable poses: drag-composed transforms, live footprints. */
    pickItems(): PickItem[] {
      const qDrag = dragQuat();
      const C = new THREE.Vector3(0, 0, -liveR);
      const items: PickItem[] = [];
      for (const r of renderList) {
        const s = samples.get(r.id);
        if (!s) continue;
        items.push({
          id: r.id,
          kind: r.kind,
          pos: s.pos.clone().sub(C).applyQuaternion(qDrag).add(C),
          quat: qDrag.clone().multiply(s.quat),
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
