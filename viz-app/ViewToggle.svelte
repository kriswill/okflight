<script lang="ts">
  import type { VizState } from "./state.svelte";

  const { viz }: { viz: VizState } = $props();
</script>

<div id="viewtoggle">
  <span class="hint">view</span>
  <button class="seg" class:active={viz.viewMode === "graph"} onclick={() => viz.setViewMode("graph")}>3D</button>
  <button class="seg" class:active={viz.viewMode === "cards"} onclick={() => viz.setViewMode("cards")}>cards</button>
</div>

<style>
  /* .hint / .seg are global primitives (viz.ts) shared with the other controls. */
  #viewtoggle {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 4px 8px;
  }
</style>
