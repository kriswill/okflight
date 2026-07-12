<script lang="ts">
  // One card under the motion system: unit geometries scaled per frame by
  // the scene's frame task (zero geometry rebuilds while animating),
  // materials created once and always transparent (no mid-flight shader
  // recompiles). This component only owns structure + texture; every
  // transform/opacity write comes from the registered frame applier.
  import { T } from "@threlte/core";
  import * as THREE from "three";
  import { makeCardFace } from "./cardFace";
  import type { CardRefs } from "./CardsScene.svelte";
  import type { RenderEntry } from "./motion.svelte";

  interface Props {
    entry: RenderEntry;
    bg: string;
    title: string;
    desc: string;
    /** Structural (dir/root) card: outline face, no 3D slab behind it. */
    outline?: boolean;
    /** Page ink for outline faces. */
    ink?: string;
    /** Scene registry hook; returns the unregister cleanup. */
    registerCard: (id: string, refs: CardRefs) => () => void;
  }
  const { entry, bg, title, desc, outline = false, ink, registerCard }: Props = $props();

  const DEPTH = 8;

  let group = $state<THREE.Group | undefined>();
  let boxMesh = $state<THREE.Mesh | undefined>();
  let faceMesh = $state<THREE.Mesh | undefined>();

  // Created once; opacity/color mutated imperatively. Always transparent so
  // fades never trigger a program recompile mid-flight.
  const boxMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true });
  const faceMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true });

  $effect(() => {
    boxMat.color.set(bg);
  });

  // Texture regenerates only when the render entry changes (retarget time =
  // transition start, already at final detail) or the theme flips.
  const texture = $derived(
    makeCardFace({
      title,
      desc,
      bg,
      outline,
      ink,
      w: entry.w,
      h: entry.h,
      dpr: Math.min(Math.max(devicePixelRatio || 1, 1), 2),
    }),
  );
  $effect(() => {
    faceMat.map = texture;
    faceMat.needsUpdate = true;
    return () => texture.dispose();
  });

  $effect(() => {
    if (!group || !boxMesh || !faceMesh) return;
    return registerCard(entry.id, { group, boxMesh, faceMesh, boxMat, faceMat, entry });
  });
</script>

<T.Group bind:ref={group}>
  <T.Mesh bind:ref={boxMesh} position.z={-DEPTH / 2} material={boxMat} visible={!outline}>
    <T.BoxGeometry args={[1, 1, 1]} />
  </T.Mesh>
  <T.Mesh bind:ref={faceMesh} position.z={0.5} material={faceMat}>
    <T.PlaneGeometry args={[1, 1]} />
  </T.Mesh>
</T.Group>
