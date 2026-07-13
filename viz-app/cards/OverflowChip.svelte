<script lang="ts" module>
  /** Chip plane size in world units — the scene hit-tests against these. */
  export const CHIP_W = 64;
  export const CHIP_H = 26;
</script>

<script lang="ts">
  // Band-edge overflow indicator: a small pill pinned at the window edge
  // showing how many cards live past it. Clicking one pages the band
  // toward that edge (hit-tested by the scene). Static between recomputes —
  // plain Threlte prop reactivity (no frame-applier registry) keeps it in
  // place; motion.overflow re-emits whenever scroll/window/layout changes.
  import { T, useThrelte } from "@threlte/core";
  import * as THREE from "three";
  import { makeChipFace } from "./cardFace";

  interface Props {
    count: number;
    /** Triangle direction, radians (0 = +x on screen, canvas y-down). */
    angle: number;
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    bg: string;
    ink: string;
  }
  const { count, angle, pos, quat, bg, ink }: Props = $props();

  const { invalidate } = useThrelte();

  const mat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true });
  // Eager effect over the props (same rationale as Card.svelte's face
  // effect): regenerate on any change, invalidate the on-demand canvas.
  $effect(() => {
    const tex = makeChipFace({
      count,
      angle,
      bg,
      ink,
      w: CHIP_W,
      h: CHIP_H,
      dpr: Math.min(Math.max(devicePixelRatio || 1, 1), 2),
    });
    mat.map = tex;
    mat.needsUpdate = true;
    invalidate();
    return () => tex.dispose();
  });
</script>

<T.Group position={[pos.x, pos.y, pos.z]} quaternion={[quat.x, quat.y, quat.z, quat.w]}>
  <T.Mesh material={mat} scale={[CHIP_W, CHIP_H, 1]}>
    <T.PlaneGeometry args={[1, 1]} />
  </T.Mesh>
</T.Group>
