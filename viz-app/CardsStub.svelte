<script lang="ts">
  // Test fixture: stands in for the Threlte cards view in stage tests, which
  // must never resolve @threlte/core (unresolvable under bun test). Rendered
  // through Stage's `cards` injection seam.
  import type { VizState } from "./state.svelte";

  const { viz }: { viz: VizState } = $props();
</script>

<div data-testid="cards-stub">{viz.viewMode}</div>
