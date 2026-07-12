<script lang="ts">
  // The cards view root, injected into Stage from main.ts (never imported by
  // App/Stage so @threlte/core stays out of the bun-test module graph).
  // Focused concept -> its directional card layout; no focus -> the synthetic
  // root card from the bundle's index.md; neither -> an empty-state prompt.
  import { Canvas } from "@threlte/core";
  import * as THREE from "three";
  import { mark } from "../perf";
  import type { VizState } from "../state.svelte";
  import { cardGraph, layoutCards, rootCardGraph, type CardLayout } from "./cardLayout";
  import CardsScene from "./CardsScene.svelte";

  const { viz }: { viz: VizState } = $props();

  const layout: CardLayout | null = $derived.by(() => {
    const g = viz.focusedConcept
      ? cardGraph(viz.model, viz.focusedConcept.id, viz.cardsDepth, viz.visible)
      : rootCardGraph(viz.model, viz.visible);
    return g ? layoutCards(g) : null;
  });

  // When cards is the initial view the paused GraphScene never composites,
  // so the startup marks (`--perf` waits on viz:interactive) fire here after
  // the canvas' first two RAF ticks.
  $effect(() => {
    if (!layout || performance.getEntriesByName("viz:interactive").length) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        mark("viz:first-frame");
        mark("viz:interactive");
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  });
</script>

{#if layout}
  <div class="cards-canvas">
    <Canvas
      renderMode="on-demand"
      toneMapping={THREE.NoToneMapping}
      createRenderer={(canvas) => new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })}
    >
      <CardsScene {viz} {layout} />
    </Canvas>
  </div>
{:else}
  <div class="empty"><p>Select a concept to see its connections.</p></div>
{/if}

<style>
  .cards-canvas {
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
