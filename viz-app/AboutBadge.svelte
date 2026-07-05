<!-- Bottom-left stage control: the circled (?) plus the brand wordmark,
     mirroring ThemeToggle's chrome in the opposite corner. Clicking opens
     the About modal (which this component owns), so the sidebar header
     stays a plain repo name. -->
<script lang="ts">
  import AboutModal from "./AboutModal.svelte";
  import Badge from "./Badge.svelte";
  import type { VizState } from "./state.svelte";

  const { viz }: { viz: VizState } = $props();
  let aboutOpen = $state(false);
</script>

<button
  id="about-badge"
  type="button"
  aria-label="About this page"
  aria-haspopup="dialog"
  title="About this page"
  onclick={() => (aboutOpen = true)}
>
  <span class="q">?</span>
  <span class="brand"><Badge text={viz.model.cfg.display.badge} /></span>
</button>

{#if aboutOpen}
  <AboutModal {viz} onClose={() => (aboutOpen = false)} />
{/if}

<style>
  #about-badge {
    position: absolute;
    bottom: 16px;
    /* Hugs the graph's left edge: the sidebar overlay's width (Sidebar.svelte
       / Stage's SIDEBAR_WIDTH, kept in sync by hand) + the theme toggle's
       16px corner inset. */
    left: calc(260px + 16px);
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 14px 0 8px;
    border: 1px solid var(--grid);
    border-radius: 18px;
    background: var(--surface-1);
    color: var(--ink-2);
    font: inherit;
    font-size: 14.5px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
  #about-badge:hover,
  #about-badge:focus-visible {
    color: var(--ink-1);
    border-color: var(--ink-muted);
    outline: none;
  }
  .q {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 21px;
    height: 21px;
    border: 1px solid var(--ink-muted);
    border-radius: 50%;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-muted);
  }
  #about-badge:hover .q,
  #about-badge:focus-visible .q {
    color: var(--ink-1);
    border-color: var(--ink-1);
  }
  .brand {
    font-weight: 500;
  }
</style>
