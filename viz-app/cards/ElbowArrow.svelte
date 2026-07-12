<script lang="ts">
  // One connector under the motion system: the tube geometry and both head
  // transforms are written by the scene's frame applier from live
  // ArrowStates (heads oriented by the end tangent — never detached).
  // This component owns only the meshes, the shared material, and the
  // static cone geometry.
  import { T } from "@threlte/core";
  import * as THREE from "three";
  import type { ArrowRefs } from "./CardsScene.svelte";
  import { HEAD_H } from "./motion.svelte";

  interface Props {
    arrowKey: string;
    twoWay: boolean;
    color: string;
    registerArrow: (key: string, refs: ArrowRefs) => () => void;
  }
  const { arrowKey, twoWay, color, registerArrow }: Props = $props();

  const HEAD_R = 4.5;

  let tubeMesh = $state<THREE.Mesh | undefined>();
  let headMesh = $state<THREE.Mesh | undefined>();
  let tailMesh = $state<THREE.Mesh | undefined>();

  // One material for tube + heads: color/opacity mutate together.
  const mat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.85 });
  $effect(() => {
    mat.color.set(color);
  });

  $effect(() => {
    if (!tubeMesh || !headMesh || (twoWay && !tailMesh)) return;
    return registerArrow(arrowKey, { tubeMesh, headMesh, tailMesh: tailMesh ?? null, mat });
  });
</script>

<T.Mesh bind:ref={tubeMesh} material={mat} />
<T.Mesh bind:ref={headMesh} material={mat}>
  <T.ConeGeometry args={[HEAD_R, HEAD_H, 8]} />
</T.Mesh>
{#if twoWay}
  <T.Mesh bind:ref={tailMesh} material={mat}>
    <T.ConeGeometry args={[HEAD_R, HEAD_H, 8]} />
  </T.Mesh>
{/if}
