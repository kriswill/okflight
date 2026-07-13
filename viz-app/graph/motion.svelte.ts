// The single source of per-frame truth for graph camera motion (the eased
// fly-to). Mirrors cards/motion.svelte.ts: per-frame numbers live in plain
// (non-reactive) fields stepped by an explicit dt — deterministic under bun
// test, no clock, no Threlte — and $state marks only the settled boundary
// flag the frame task's `running` gate reads.
import * as THREE from "three";

// dt-based tween matching the legacy feel: the old loop advanced t by
// 0.02/frame, ≈50 frames at 60Hz. Same duration on any refresh rate.
const FLY_MS = 833;

export interface GraphMotion {
  /** True when no fly is in flight — the frame task can sleep. */
  readonly settled: boolean;
  flyTo(fromPos: THREE.Vector3, fromTarget: THREE.Vector3, toPos: THREE.Vector3, toTarget: THREE.Vector3): void;
  /** Grabbing the view cancels an in-flight fly-to instead of fighting it. */
  cancelFly(): void;
  /** Advance the tween and write the eased pose into camPos/target.
   *  Returns true when it moved them (a render is needed). */
  step(dtMs: number, camPos: THREE.Vector3, target: THREE.Vector3): boolean;
}

export function createGraphMotion(): GraphMotion {
  let fly: {
    fromPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toPos: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
  } | null = null;
  let settled = $state(true);

  return {
    get settled() {
      return settled;
    },
    flyTo(fromPos, fromTarget, toPos, toTarget) {
      fly = {
        fromPos: fromPos.clone(),
        fromTarget: fromTarget.clone(),
        toPos: toPos.clone(),
        toTarget: toTarget.clone(),
        t: 0,
      };
      settled = false;
    },
    cancelFly() {
      fly = null;
      settled = true;
    },
    step(dtMs, camPos, target) {
      if (!fly) return false;
      fly.t = Math.min(1, fly.t + dtMs / FLY_MS);
      const e = 1 - Math.pow(1 - fly.t, 3);
      // Absolute interpolation lands exactly on the node, so any manual pan
      // offset is flown out rather than carried over (which clipped labels).
      camPos.lerpVectors(fly.fromPos, fly.toPos, e);
      target.lerpVectors(fly.fromTarget, fly.toTarget, e);
      if (fly.t >= 1) {
        fly = null;
        settled = true;
      }
      return true;
    },
  };
}
