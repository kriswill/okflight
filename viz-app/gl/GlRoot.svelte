<script lang="ts">
  // In-Canvas root: hosts the per-mode scene subtrees and owns the two
  // scene-level mode switches (render path + background) — single writer
  // for both, so neither subtree fights over them.
  //
  // GraphView stays mounted in both modes (its makeDefault camera anchors
  // Threlte's camera set; rebuild is expensive); the cards subtree mounts
  // per focus so `__okf.cards` disappears in graph view, as the e2e asserts.
  import { useThrelte } from "@threlte/core";
  import * as THREE from "three";
  import type { CardLayout } from "../cards/cardLayout";
  import CardsScene from "../cards/CardsScene.svelte";
  import type { VizState } from "../state.svelte";
  import GraphView from "./GraphView.svelte";

  interface Props {
    viz: VizState;
    layout: CardLayout | null;
    onSceneReady?: () => void;
    onFirstFrame?: () => void;
  }
  const { viz, layout, onSceneReady, onFirstFrame }: Props = $props();

  const { autoRender, invalidate, scene } = useThrelte();

  // Exactly one draw path per mode: graph -> GraphView's composer task
  // (bloom), cards -> Threlte's auto-render task. Both being live would
  // double-render; both being stopped would freeze the stage.
  $effect(() => {
    autoRender.set(viz.viewMode !== "graph");
    invalidate();
  });

  // Graph mode fills every pixel with the page color; cards mode clears to
  // transparent so the page CSS background shows through the alpha canvas.
  $effect(() => {
    void viz.dark;
    void viz.paletteVersion;
    scene.background = viz.viewMode === "graph" ? new THREE.Color(viz.theme().bg) : null;
    invalidate();
  });
</script>

<GraphView {viz} {onSceneReady} {onFirstFrame} />
{#if viz.viewMode === "cards" && layout}
  <CardsScene {viz} {layout} />
{/if}
