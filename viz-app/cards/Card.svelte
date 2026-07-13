<script lang="ts">
  // One card under the motion system: unit geometries scaled per frame by
  // the scene's frame task (zero geometry rebuilds while animating),
  // materials created once and always transparent (no mid-flight shader
  // recompiles). This component only owns structure + texture; every
  // transform/opacity write comes from the registered frame applier.
  //
  // Face textures are LAZY: a supersampled canvas costs real GPU memory, so
  // the applier requests one only while the card is inside the visible
  // window (and releases it again far outside) — a hub with hundreds of
  // links mounts hundreds of cards but only ever textures the visible few.
  import { T, useThrelte } from "@threlte/core";
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

  const { invalidate } = useThrelte();

  const DEPTH = 8;

  let group = $state<THREE.Group | undefined>();
  let boxMesh = $state<THREE.Mesh | undefined>();
  let faceMesh = $state<THREE.Mesh | undefined>();
  let faceWanted = $state(false);

  // Created once; opacity/color mutated imperatively. Always transparent so
  // fades never trigger a program recompile mid-flight.
  const boxMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true });
  const faceMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true });

  $effect(() => {
    boxMat.color.set(bg);
    invalidate();
  });

  // One EAGER effect owns the face texture: every input is read
  // unconditionally BEFORE the gate (the dependency set must never depend
  // on the gate state), and any change — theme flips included — disposes
  // and regenerates. Deliberately NOT an intermediate $derived: a derived
  // whose gate short-circuits past the prop reads has been seen to miss
  // later prop invalidations in the bundled runtime.
  $effect(() => {
    const spec = {
      title,
      desc,
      bg,
      outline,
      ink,
      w: entry.w,
      h: entry.h,
      dpr: Math.min(Math.max(devicePixelRatio || 1, 1), 2),
    };
    const tex = faceWanted ? makeCardFace(spec) : null;
    faceMat.map = tex;
    faceMat.needsUpdate = true;
    invalidate();
    return () => tex?.dispose();
  });

  $effect(() => {
    if (!group || !boxMesh || !faceMesh) return;
    return registerCard(entry.id, {
      group,
      boxMesh,
      faceMesh,
      boxMat,
      faceMat,
      entry,
      wantFace: (want: boolean) => (faceWanted = want),
      hasFace: () => faceWanted,
    });
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
