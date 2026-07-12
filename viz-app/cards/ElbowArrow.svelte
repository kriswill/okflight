<script lang="ts">
  // One connector under the motion system: the tube geometry and both head
  // transforms are written by the scene's frame applier from live
  // ArrowStates (heads oriented by the end tangent — never detached).
  // This component owns the meshes and materials; the line itself carries a
  // vertex-color gradient from the source card's color to the target's
  // (built by the applier), with an additive halo tube behind it on dark
  // surfaces — the cards' echo of the graph's glowing edges.
  import { T } from "@threlte/core";
  import * as THREE from "three";
  import { brighten } from "./arrowFrame";
  import type { ArrowRefs } from "./CardsScene.svelte";
  import { HEAD_H } from "./motion.svelte";

  interface Props {
    arrowKey: string;
    twoWay: boolean;
    /** Card colors at each end of the line. */
    fromColor: string;
    toColor: string;
    /** Dark-surface treatment: endpoints lifted toward white + halo tube. */
    glow: boolean;
    registerArrow: (key: string, refs: ArrowRefs) => () => void;
    /** Rebuild this arrow's geometry after a color/glow change. */
    refreshArrow: (key: string) => void;
  }
  const { arrowKey, twoWay, fromColor, toColor, glow, registerArrow, refreshArrow }: Props = $props();

  const HEAD_R = 4.5;
  /** How far endpoint colors lift toward white when glowing. */
  const GLOW_LIFT = 0.2;

  let tubeMesh = $state<THREE.Mesh | undefined>();
  let headMesh = $state<THREE.Mesh | undefined>();
  let tailMesh = $state<THREE.Mesh | undefined>();
  let haloMesh = $state<THREE.Mesh | undefined>();

  // Created once, mutated in place (opacity per frame by the applier, colors
  // at structure time below). The tube's color rides its vertex attribute.
  const tubeMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, vertexColors: true });
  const headMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true });
  const tailMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true });
  const haloMat = new THREE.MeshBasicMaterial({
    toneMapped: false,
    transparent: true,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  // Gradient endpoints the applier reads when rebuilding the tube.
  const from = new THREE.Color();
  const to = new THREE.Color();
  $effect(() => {
    const lift = glow ? GLOW_LIFT : 0;
    from.copy(brighten(fromColor, lift));
    to.copy(brighten(toColor, lift));
    headMat.color.copy(to);
    tailMat.color.copy(from);
    refreshArrow(arrowKey);
  });

  $effect(() => {
    if (!tubeMesh || !headMesh || (twoWay && !tailMesh)) return;
    return registerArrow(arrowKey, {
      tubeMesh,
      headMesh,
      tailMesh: tailMesh ?? null,
      haloMesh: haloMesh ?? null,
      tubeMat,
      headMat,
      tailMat: twoWay ? tailMat : null,
      haloMat: haloMesh ? haloMat : null,
      from,
      to,
    });
  });
</script>

{#if glow}
  <T.Mesh bind:ref={haloMesh} material={haloMat} />
{/if}
<T.Mesh bind:ref={tubeMesh} material={tubeMat} />
<T.Mesh bind:ref={headMesh} material={headMat}>
  <T.ConeGeometry args={[HEAD_R, HEAD_H, 8]} />
</T.Mesh>
{#if twoWay}
  <T.Mesh bind:ref={tailMesh} material={tailMat}>
    <T.ConeGeometry args={[HEAD_R, HEAD_H, 8]} />
  </T.Mesh>
{/if}
