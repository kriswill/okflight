<script lang="ts">
  import type { Component } from "svelte";
  import AboutBadge from "./AboutBadge.svelte";
  import DetailPanel from "./DetailPanel.svelte";
  import type { VizState } from "./state.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";
  import Tooltip from "./Tooltip.svelte";

  interface Props {
    viz: VizState;
    /** The GL stage (graph + cards), injected from main.ts — a seam: the
     *  Threlte subtree must never enter the bun-test module graph. */
    gl?: Component<{ viz: VizState; onSceneReady?: () => void; onFirstFrame?: () => void }>;
    onSceneReady?: () => void;
    onFirstFrame?: () => void;
  }

  const { viz, gl: GL, onSceneReady, onFirstFrame }: Props = $props();

  let el = $state<HTMLElement | null>(null);
  // clientWidth is not a signal — the window resize listener below bumps this
  // so width-derived state (panel width in DetailPanel, the theme toggle's
  // offset) re-reads it. The GL stage sizes itself off the canvas instead.
  let resizeSeq = $state(0);
</script>

<svelte:window onresize={() => resizeSeq++} />

<main id="stage" bind:this={el}>
  {#if GL}
    <div id="gl-host"><GL {viz} {onSceneReady} {onFirstFrame} /></div>
  {/if}
  <Tooltip {viz} />
  <DetailPanel {viz} stageEl={el} {resizeSeq} />
  <ThemeToggle {viz} stageEl={el} {resizeSeq} />
  <AboutBadge {viz} />
</main>

<style>
  #stage {
    /* Full-bleed: the sidebar and detail panel overlay this rather than
       sharing a grid track, so the GL scene always has the whole viewport
       to frame. */
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  #gl-host {
    position: absolute;
    inset: 0;
  }
</style>
