<script lang="ts">
  import type { VizState } from "./state.svelte";

  const { viz }: { viz: VizState } = $props();
</script>

<div id="viewtoggle">
  <span class="hint">view</span>
  <button class="seg" class:active={viz.viewMode === "graph"} onclick={() => viz.setViewMode("graph")}>3D</button>
  <button class="seg" class:active={viz.viewMode === "cards"} onclick={() => viz.setViewMode("cards")}>cards</button>
  {#if viz.viewMode === "cards"}
    <span class="hint flow-hint">flow</span>
    <button class="seg" class:active={viz.cardFlow === "v"} title="top-down flow" onclick={() => viz.setCardFlow("v")}>
      ↓
    </button>
    <button class="seg" class:active={viz.cardFlow === "h"} title="left-right flow" onclick={() => viz.setCardFlow("h")}>
      →
    </button>
  {/if}
</div>

<style>
  /* .hint / .seg are global primitives (viz.ts) shared with the other controls. */
  #viewtoggle {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 4px 8px;
  }
  .flow-hint {
    margin-left: 8px;
  }
</style>
