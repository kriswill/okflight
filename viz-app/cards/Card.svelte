<script lang="ts">
  // One card: a shallow colored box (side walls give the iso depth) with a
  // canvas-texture face carrying the text. Dumb render leaf — every position,
  // size, and role decision was made (and unit-tested) in cardLayout.
  import { T } from "@threlte/core";
  import { makeCardFace } from "./cardFace";
  import type { CardPlacement } from "./cardLayout";

  interface Props {
    placement: CardPlacement;
    bg: string;
    title: string;
    desc: string;
    hovered: boolean;
  }
  const { placement: c, bg, title, desc, hovered }: Props = $props();

  const DEPTH = 8;

  const texture = $derived(
    makeCardFace({
      title,
      desc,
      bg,
      w: c.w,
      h: c.h,
      dpr: Math.min(Math.max(devicePixelRatio || 1, 1), 2),
      muted: c.kind === "more",
    }),
  );
  // Dispose each replaced texture (theme flips, refocus) — Threlte only
  // auto-disposes what T components created.
  $effect(() => {
    const t = texture;
    return () => t.dispose();
  });
</script>

<T.Group position={[c.x, c.y, c.z]} scale={hovered ? 1.03 : 1}>
  <T.Mesh position.z={-DEPTH / 2}>
    <T.BoxGeometry args={[c.w, c.h, DEPTH]} />
    <T.MeshBasicMaterial color={bg} toneMapped={false} opacity={c.kind === "more" ? 0.55 : 1} transparent={c.kind === "more"} />
  </T.Mesh>
  <T.Mesh position.z={0.5}>
    <T.PlaneGeometry args={[c.w, c.h]} />
    <T.MeshBasicMaterial map={texture} transparent toneMapped={false} />
  </T.Mesh>
</T.Group>
