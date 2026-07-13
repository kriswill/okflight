<script lang="ts">
  // Test fixture: stands in for the Threlte GL stage in stage tests, which
  // must never resolve @threlte/core (unresolvable under bun test). Rendered
  // through Stage's `gl` injection seam.
  import type { VizState } from "./state.svelte";

  const { viz }: { viz: VizState } = $props();
</script>

<div data-testid="gl-stub">{viz.viewMode}</div>
