<script lang="ts">
  import Badge from "./Badge.svelte";
  import { formatDate } from "./dates";
  import type { VizState } from "./state.svelte";

  const { viz, onClose }: { viz: VizState; onClose: () => void } = $props();
  const m = $derived(viz.model);
  const stats = $derived(viz.model.stats);

  // Two panes: the app info shown since the modal existed, and the bundled
  // deps' license notices. The tab bar only renders when there are notices
  // to show (pre-licenses embeds keep the untabbed layout), and the modal
  // remounts per open (AboutBadge's {#if aboutOpen}), so it always opens on
  // the info pane.
  let tab: "info" | "licenses" = $state("info");

  const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);
  const pct = (n: number, total: number) => {
    const p = (n / total) * 100;
    return p >= 1 ? `${p.toFixed(0)}%` : "<1%";
  };

  // Largest-first; the remainder up to totalBytes (template markup/CSS, repo
  // and commit metadata, facet maps, embedded config, license notices, the
  // stats blob itself) closes the table so the rows always sum to the total.
  const rows = $derived.by(() => {
    if (!stats) return [];
    const b = stats.bytes;
    const listed = [
      { label: "Embedded source files", count: Object.keys(m.files).length, bytes: b.files },
      { label: "Concept documents", count: m.nodes.length, bytes: b.nodes },
      { label: "Graph links", count: m.edges.length, bytes: b.edges },
      { label: "Directory listings", count: Object.keys(m.dirs).length, bytes: b.dirs },
      { label: "Viewer app (JS)", count: null, bytes: b.appJs },
      { label: "Viewer styles (CSS)", count: null, bytes: b.appCss },
    ].sort((a, b2) => b2.bytes - a.bytes);
    const rest = stats.totalBytes - listed.reduce((s, r) => s + r.bytes, 0);
    return [...listed, { label: "Page shell & metadata", count: null, bytes: rest }];
  });

  const generated = $derived.by(() => {
    if (!stats) return null;
    const date = formatDate(stats.generatedAt.slice(0, 10), m.cfg.display.dateFormat) ?? stats.generatedAt.slice(0, 10);
    return `${date} · ${stats.generatedAt.slice(11, 16)} UTC`;
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions --
     the backdrop is a pointer-only dismiss affordance; Escape (svelte:window
     below) and the ✕ button are the keyboard paths -->
<div class="overlay" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="About this page">
    <header>
      <h2>{m.displayName} <span class="badge"><Badge text={m.cfg.display.badge} /></span></h2>
      <button class="close" aria-label="Close" onclick={onClose}>×</button>
    </header>
    {#if m.licenses.length}
      <div class="tabs" role="tablist" aria-label="About sections">
        <button class="seg" class:active={tab === "info"} role="tab" aria-selected={tab === "info"} onclick={() => (tab = "info")}>
          <!-- info circle -->
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
            <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4" />
            <path d="M8 7.4v3.4M8 5.15v.02" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
          About
        </button>
        <button class="seg" class:active={tab === "licenses"} role="tab" aria-selected={tab === "licenses"} onclick={() => (tab = "licenses")}>
          <!-- scales of justice -->
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
            <path
              d="M8 2.5v11M5.8 13.5h4.4M3 4.5h10M3 4.5l-1.8 4M3 4.5l1.8 4M1.2 8.5a1.8 1.8 0 0 0 3.6 0M13 4.5l-1.8 4M13 4.5l1.8 4M11.2 8.5a1.8 1.8 0 0 0 3.6 0"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          </svg>
          Licenses
        </button>
      </div>
    {/if}
    {#if tab === "info"}
      <p class="about">{@html m.cfg.display.aboutHtml}</p>
      <p class="counts">{m.nodes.length} concepts · {m.edges.length} links · {Object.keys(m.files).length} embedded files</p>
      {#if stats}
        <h3>What's in this file</h3>
        <table>
          <thead><tr><th>Section</th><th class="num">Count</th><th class="num">Size</th><th class="num">%</th></tr></thead>
          <tbody>
            {#each rows as r (r.label)}
              <tr>
                <td>{r.label}</td>
                <td class="num">{r.count ?? ""}</td>
                <td class="num">{fmtBytes(r.bytes)}</td>
                <td class="num pct">{pct(r.bytes, stats.totalBytes)}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr><td>Total</td><td></td><td class="num">{fmtBytes(stats.totalBytes)}</td><td></td></tr>
          </tfoot>
        </table>
        <p class="gen">Everything above is baked into this single HTML file — it works offline, straight from disk. Generated {generated}.</p>
      {/if}
      {#if m.generator}
        <p class="tool">
          Built with <a href={m.generator.url} target="_blank" rel="noopener">{m.generator.name}</a>{m.generator.version
            ? ` v${m.generator.version}`
            : ""}{m.generator.license ? ` · ${m.generator.license} license` : ""}{m.generator.copyright
            ? ` · ${m.generator.copyright}`
            : ""}
        </p>
      {/if}
    {:else}
      <p class="lic-note">This page embeds the minified viewer app and these libraries; the notices below accompany them as their licenses require.</p>
      {#if m.generator?.text}
        <details class="lic">
          <summary>{m.generator.name} {m.generator.version}{m.generator.license ? ` · ${m.generator.license}` : ""} — this viewer</summary>
          <pre>{m.generator.text}</pre>
        </details>
      {/if}
      {#each m.licenses as l (l.name)}
        <details class="lic">
          <summary>{l.name} {l.version}{l.license ? ` · ${l.license}` : ""}</summary>
          <pre>{l.text}</pre>
        </details>
      {/each}
    {/if}
  </div>
</div>
<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 5; /* above the sidebar help bubble (4) */
    display: flex;
    /* Top-anchored, not centered: the panes differ in height, and a centered
       box would recenter on every tab switch — the tab strip must stay put
       under the pointer while only the bottom edge moves. */
    align-items: flex-start;
    justify-content: center;
    background: color-mix(in srgb, var(--page) 45%, transparent);
    backdrop-filter: blur(2px);
  }
  .modal {
    /* Wide enough that conventionally 80-column-wrapped LICENSE texts render
       in the licenses pane without harsh re-wraps (80ch of 10.5px monospace
       + pre/modal padding), while still fitting small screens. */
    width: min(580px, calc(100vw - 32px));
    margin-top: 13vh;
    max-height: min(80vh, 640px);
    overflow-y: auto;
    background: var(--surface-1);
    border: 1px solid var(--grid);
    border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
    padding: 16px 18px;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 8px;
  }
  h2 {
    font-size: 16px;
  }
  .badge {
    color: var(--ink-muted);
    font-weight: 500;
  }
  .close {
    margin-left: auto;
    flex: none;
    cursor: pointer;
    color: var(--ink-muted);
    font-size: 18px;
    line-height: 1;
    border: 0;
    background: none;
    padding: 0;
  }
  .close:hover {
    color: var(--ink-1);
  }
  .about {
    color: var(--ink-2);
    font-size: 12.5px;
  }
  .counts {
    color: var(--ink-muted);
    font-size: 12px;
    margin: 6px 0 12px;
  }
  h3 {
    font-size: 11px;
    font-weight: 600;
    color: var(--ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  th {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-align: left;
    padding: 3px 0;
    border-bottom: 1px solid var(--grid);
  }
  td {
    padding: 3px 0;
    color: var(--ink-2);
  }
  td.num,
  th.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    padding-left: 12px;
    white-space: nowrap;
  }
  td.pct {
    color: var(--ink-muted);
  }
  tfoot td {
    border-top: 1px solid var(--grid);
    font-weight: 600;
    color: var(--ink-1);
  }
  .gen {
    color: var(--ink-muted);
    font-size: 11.5px;
    margin-top: 10px;
  }
  .tool {
    color: var(--ink-muted);
    font-size: 11.5px;
    margin-top: 6px;
  }
  .tool a {
    color: var(--ink-2);
  }
  .tool a:hover {
    color: var(--ink-1);
  }
  /* .seg is a global primitive (viz.ts) shared with the sidebar controls. */
  .tabs {
    display: flex;
    gap: 4px;
    padding-bottom: 8px;
    margin-bottom: 10px;
    border-bottom: 1px solid var(--grid);
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .tabs svg {
    flex: none;
  }
  .lic-note {
    color: var(--ink-muted);
    font-size: 11.5px;
    margin-bottom: 6px;
  }
  details.lic {
    margin: 2px 0;
    font-size: 12px;
  }
  details.lic summary {
    cursor: pointer;
    color: var(--ink-2);
  }
  details.lic summary:hover {
    color: var(--ink-1);
  }
  details.lic pre {
    margin: 6px 0 10px;
    padding: 8px 10px;
    font: 10.5px/1.5 ui-monospace, Menlo, monospace;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--ink-2);
    background: var(--page);
    border: 1px solid var(--grid);
    border-radius: 6px;
  }
</style>
