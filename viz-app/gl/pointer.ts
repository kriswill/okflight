// Pointer-gesture helpers shared by the GL scenes. DOM- and three-free so
// they unit-test directly.

export interface PressTracker {
  readonly isDown: boolean;
  down(x: number, y: number): void;
  /** True when this up completes a click: a matching down happened and the
   *  pointer moved at most `threshold` px since. Ignores synthetic ups with
   *  no matching down; always ends the press. */
  up(x: number, y: number): boolean;
  cancel(): void;
}

/** Click-vs-drag classifier: a press that travels beyond `threshold` px is a
 *  drag and must not select on release. */
export function pressTracker(threshold = 4): PressTracker {
  let isDown = false;
  let downX = 0;
  let downY = 0;
  return {
    get isDown() {
      return isDown;
    },
    down(x, y) {
      isDown = true;
      downX = x;
      downY = y;
    },
    up(x, y) {
      if (!isDown) return false;
      isDown = false;
      return Math.hypot(x - downX, y - downY) <= threshold;
    },
    cancel() {
      isDown = false;
    },
  };
}

/** Client coords -> normalized device coords for a canvas rect. */
export const ndc = (
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } => ({
  x: ((clientX - rect.left) / rect.width) * 2 - 1,
  y: -((clientY - rect.top) / rect.height) * 2 + 1,
});
