<script lang="ts">
  // The GL stage root, injected into Stage from main.ts (never imported by
  // App/Stage so @threlte/core stays out of the bun-test module graph).
  // Owns the ONE Threlte <Canvas> both scenes share; GlRoot inside it hosts
  // the per-mode subtrees. Cards layout is derived here (DOM side) so the
  // empty-state prompt can render as a Canvas sibling: focused concept ->
  // its directional card layout; no focus -> the synthetic root card from
  // the bundle's index.md; neither -> the prompt.
  import { Canvas } from "@threlte/core";
  import * as THREE from "three";
  import { bundleCardGraph, cardGraph, layoutCards, rootCardGraph, type CardLayout } from "../cards/cardLayout";
  import type { VizState } from "../state.svelte";
  import GlRoot from "./GlRoot.svelte";

  interface Props {
    viz: VizState;
    onSceneReady?: () => void;
    onFirstFrame?: () => void;
  }
  const { viz, onSceneReady, onFirstFrame }: Props = $props();

  const layout: CardLayout | null = $derived.by(() => {
    if (viz.viewMode !== "cards") return null;
    const g = viz.focusedConcept
      ? cardGraph(viz.model, viz.focusedConcept.id, viz.cardsDepth, viz.visible)
      : viz.cardsBundle
        ? bundleCardGraph(viz.model, viz.cardsBundle, viz.cardsDepth, viz.visible)
        : rootCardGraph(viz.model, viz.visible, viz.cardsDepth);
    return g ? layoutCards(g, { flow: viz.cardFlow }) : null;
  });
</script>

<div class="gl-canvas">
  <!-- Explicit NoToneMapping/no-shadows: Threlte defaults to AgX + PCFSoft,
       which would clamp the >1.0 bloom colors and cost shadow-map state.
       antialias is ~free for the graph (its draw is a composer blit) and
       keeps cards edges clean. One FIXED dpr clamp for both modes: a
       per-mode value made Threlte setPixelRatio() and reallocate the
       backbuffer on every view toggle (a visible hitch on retina). 1.5 is
       the graph's tuned bloom fill budget; card text stays crisp because
       the face textures supersample at their own min(dpr, 2). -->
  <Canvas
    renderMode="on-demand"
    toneMapping={THREE.NoToneMapping}
    shadows={false}
    dpr={[1, 1.5]}
    createRenderer={(canvas) =>
      new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" })}
  >
    <GlRoot {viz} {layout} {onSceneReady} {onFirstFrame} />
  </Canvas>
</div>
{#if viz.viewMode === "cards" && !layout}
  <div class="empty"><p>Select a concept to see its connections.</p></div>
{/if}

<style>
  .gl-canvas {
    position: absolute;
    inset: 0;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-muted);
    font-size: 14px;
  }
</style>
