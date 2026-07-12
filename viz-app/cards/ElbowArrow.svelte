<script lang="ts">
  // One connector: a tube along the pre-sampled elbow curve plus cone
  // arrowheads. The elbow grammar guarantees vertical tangents at the
  // anchors, so heads are axis-aligned constants — the end head always
  // points down (into the lower card), a tail head (mutual links) up.
  import { T } from "@threlte/core";
  import * as THREE from "three";
  import type { ArrowSpec } from "./cardLayout";

  const { arrow, color }: { arrow: ArrowSpec; color: string } = $props();

  const TUBE_R = 1.4;
  const HEAD_H = 12;
  const HEAD_R = 4.5;

  const curve = $derived(new THREE.CatmullRomCurve3(arrow.path.map((p) => new THREE.Vector3(p.x, p.y, 0))));
</script>

<T.Mesh>
  <T.TubeGeometry args={[curve, 40, TUBE_R, 6, false]} />
  <T.MeshBasicMaterial {color} toneMapped={false} transparent opacity={0.85} />
</T.Mesh>
<!-- Cone apex sits at +h/2; flipping around z drops the apex onto the tip. -->
<T.Mesh position={[arrow.head.tip.x, arrow.head.tip.y + HEAD_H / 2, 0]} rotation.z={Math.PI}>
  <T.ConeGeometry args={[HEAD_R, HEAD_H, 8]} />
  <T.MeshBasicMaterial {color} toneMapped={false} />
</T.Mesh>
{#if arrow.tailHead}
  <T.Mesh position={[arrow.tailHead.tip.x, arrow.tailHead.tip.y - HEAD_H / 2, 0]}>
    <T.ConeGeometry args={[HEAD_R, HEAD_H, 8]} />
    <T.MeshBasicMaterial {color} toneMapped={false} />
  </T.Mesh>
{/if}
