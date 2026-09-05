<script lang="ts">
  import type { VizState } from "./state.svelte";

  const { viz }: { viz: VizState } = $props();
</script>

<!-- Graph view only: neighborhood isolation needs an anchor concept and is
  off by default. The cards view's ring count ("hops") is a layout setting
  and lives in the view section (ViewToggle). -->
{#if viz.viewMode === "graph" && viz.selectedConcept}
  <div id="isolate">
    <span class="hint">neighbors</span>
    <button
      class="seg"
      class:active={viz.isolateDepth === 2}
      onclick={() => viz.setIsolate(viz.isolateDepth === 2 ? 0 : 2)}
    >
      2-hop
    </button>
    <button
      class="seg"
      class:active={viz.isolateDepth === 1}
      onclick={() => viz.setIsolate(viz.isolateDepth === 1 ? 0 : 1)}
    >
      1-hop
    </button>
    <button class="seg" class:active={viz.isolateDepth === 0} onclick={() => viz.setIsolate(0)}>off</button>
  </div>
{/if}

<style>
  /* .hint / .seg are global primitives (viz.ts) shared with the other controls. */
  #isolate {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 4px;
    margin-bottom: 6px;
    border-top: 1px solid var(--grid);
    border-bottom: 1px solid var(--grid);
  }
</style>
