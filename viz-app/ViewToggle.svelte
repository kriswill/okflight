<script lang="ts">
  import type { VizState } from "./state.svelte";

  const { viz }: { viz: VizState } = $props();
</script>

<!-- The view section: which stage renders, plus the cards view's own layout
  settings (flow orientation, ring count). The 3D graph's neighbor isolation
  lives with the other filters at the sidebar's bottom (IsolateControl). -->
<div id="viewtoggle">
  <div class="row">
    <span class="hint">view</span>
    <button class="seg" class:active={viz.viewMode === "cards"} onclick={() => viz.setViewMode("cards")}>cards</button>
    <button class="seg" class:active={viz.viewMode === "graph"} onclick={() => viz.setViewMode("graph")}>3D</button>
  </div>
  {#if viz.viewMode === "cards"}
    <div class="row" id="flow">
      <span class="hint">flow</span>
      <button class="seg" class:active={viz.cardFlow === "h"} title="left-right flow" onclick={() => viz.setCardFlow("h")}>
        →
      </button>
      <button class="seg" class:active={viz.cardFlow === "v"} title="top-down flow" onclick={() => viz.setCardFlow("v")}>
        ↓
      </button>
    </div>
    <div class="row" id="hops">
      <span class="hint">hops</span>
      <button class="seg" class:active={viz.isolateDepth === 2} onclick={() => viz.setIsolate(2)}>2-hop</button>
      <button class="seg" class:active={viz.isolateDepth === 1} onclick={() => viz.setIsolate(1)}>1-hop</button>
    </div>
  {/if}
</div>

<style>
  /* .hint / .seg are global primitives (viz.ts) shared with the other controls. */
  #viewtoggle {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 4px 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 5px;
  }
</style>
