<!-- The h1 / About-modal suffix badge. The stock "OKFlight" wordmark renders
     two-tone — "OKF" a shade stronger than "light", both under the host
     name's weight — while a configured custom badge renders plain in the
     host's muted style. -->
<script lang="ts">
  const { text }: { text: string } = $props();
</script>

{#if text === "OKFlight"}
  <span class="okf">OKF</span><span class="light">light</span>
{:else}
  {text}
{/if}

<style>
  .okf {
    color: var(--ink-2);
    font-weight: 600;
  }
  .light {
    color: var(--ink-muted);
    font-weight: 500;
  }
</style>
