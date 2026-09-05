<script lang="ts">
  import { formatDate } from "./dates";
  import { familyRows } from "./families";
  import { encodeHash } from "./hash";
  import { createMd, esc } from "./markdown";
  import type { VizState } from "./state.svelte";

  interface Props {
    viz: VizState;
    stageEl: HTMLElement | null;
    /** Bumped by Stage on window resize — clientWidth reads are not reactive. */
    resizeSeq?: number;
  }
  const { viz, stageEl, resizeSeq = 0 }: Props = $props();

  // svelte-ignore state_referenced_locally -- viz's identity never changes
  const md = createMd({
    files: viz.model.files,
    byId: viz.model.byId,
    dirs: viz.model.dirs,
    commitUrl: viz.model.commitUrl,
    commits: viz.model.commits,
    bundleDir: viz.model.cfg.bundle.dir,
    bundles: viz.model.bundles,
    root: viz.model.root,
    math: viz.model.cfg.display.math,
  });

  const file = $derived(viz.sel.kind === "file" ? viz.model.files[viz.sel.path] : null);
  const filePath = $derived(viz.sel.kind === "file" ? viz.sel.path : "");
  const dir = $derived(viz.sel.kind === "dir" ? viz.model.dirs[viz.sel.path] : null);
  const dirPath = $derived(viz.sel.kind === "dir" ? viz.sel.path : "");
  // Cards view, nothing selected: the focused index doc (bundle or root).
  const indexDoc = $derived(viz.cardsIndexDoc);
  const indexTitle = $derived(
    indexDoc ? indexDoc.title || (viz.cardsBundle ? viz.cardsBundle + "/" : viz.model.displayName) : "",
  );
  /** Pseudo doc id whose directory the index body's links resolve against. */
  const indexFromId = $derived(viz.cardsBundle ? viz.cardsBundle + "/index" : "index");

  const fmtDate = (v: unknown) => formatDate(v, viz.model.cfg.display.dateFormat);

  const fmCell = (k: string, v: unknown): string => {
    const date = fmtDate(v);
    if (date) return esc(date);
    const val = esc(Array.isArray(v) ? v.join(", ") : v);
    if (k === "resource") {
      const p = String(v).replace(/\/$/, "");
      if (viz.model.files[p]) return `<a href="#" data-file="${esc(p)}">${val}</a>`;
      if (viz.model.dirs[p]) return `<a href="#" data-dir="${esc(p)}">${val}</a>`;
    }
    if (k === "description") return md.autolinkPaths(val);
    return val;
  };

  /** In-panel link for an OKF path-valued field (§6.2) of the selected
   *  concept: a concept (data-node), or an embedded file/dir (data-file /
   *  data-dir). `/`-rooted values are bundle-relative; relative ones are
   *  doc-relative, then bundle-root-relative (the spec's own spelling), then
   *  repo-relative like `resource`. Null: nothing embedded answers. */
  const pathLink = (fromId: string, value: string): string | null => {
    const bundleDir = viz.model.cfg.bundle.dir;
    const clean = value.replace(/\/$/, "");
    const candidates = clean.startsWith("/")
      ? [`${bundleDir}${clean}`]
      : [md.resolveFrom(fromId, clean), `${bundleDir}/${clean}`, clean];
    for (const p of candidates) {
      if (!p) continue;
      const nid = p.startsWith(bundleDir + "/") && p.endsWith(".md") ? p.slice(bundleDir.length + 1, -3) : null;
      if (nid && viz.model.byId[nid]) return `<a href="#" data-node="${esc(nid)}">${esc(value)}</a>`;
      if (viz.model.files[p]) return `<a href="#" data-file="${esc(p)}">${esc(value)}</a>`;
      if (viz.model.dirs[p]) return `<a href="#" data-dir="${esc(p)}">${esc(value)}</a>`;
    }
    return null;
  };

  const fmRows = (n: { id: string; fm: Record<string, unknown> }) =>
    familyRows({ fmtDate, pathLink: (v) => pathLink(n.id, v), plain: fmCell }, n.fm);

  /** The concept's `sources` entries, for footnote resolution in the body. */
  const sourcesOf = (fm: Record<string, unknown>) =>
    Array.isArray(fm.sources) ? (fm.sources.filter((s) => s && typeof s === "object") as Record<string, unknown>[]) : [];

  const NONE = '<span style="color:var(--ink-muted)">none</span>';
  const linkList = (ids: string[]) =>
    ids.map((i) => `<a href="#" data-node="${esc(i)}">${esc(viz.model.byId[i]!.title)}</a>`).join(" · ") || NONE;

  const outLinks = (id: string) => viz.model.edges.filter((e) => e.s === id).map((e) => e.t);
  const refList = (refs: string[]) => linkList(refs.filter((i) => viz.model.byId[i]));

  // Markdown bodies and embedded source emit plain anchors — one delegate
  // handles them (same contract as the legacy innerHTML panel).
  function onClick(e: MouseEvent) {
    const t = e.target as Element;
    if (t.closest(".close")) {
      // Closing a panel is a dismissal, not a navigation — the cards focus
      // must not change under the user: the index panel hides in place, and
      // a file/dir panel over a bundle focus falls back to that bundle.
      if (viz.sel.kind === "none") viz.hideIndexPanel();
      else if (viz.cardsBundle) viz.dismissSelection();
      else viz.clearSelection();
      return;
    }
    const af = t.closest("a[data-file]") as HTMLElement | null;
    if (af) {
      e.preventDefault();
      viz.selectFile(af.dataset.file!);
      return;
    }
    const ad = t.closest("a[data-dir]") as HTMLElement | null;
    if (ad) {
      e.preventDefault();
      viz.selectDir(ad.dataset.dir!);
      return;
    }
    const ab = t.closest("a[data-bundle]") as HTMLElement | null;
    if (ab) {
      e.preventDefault();
      const path = ab.dataset.bundle ?? "";
      if (path) viz.focusBundle(path);
      else {
        // The root index link: the root card lives in the cards view.
        viz.setViewMode("cards");
        viz.clearSelection();
      }
      return;
    }
    const a = t.closest("a[data-node]") as HTMLElement | null;
    if (a) {
      e.preventDefault();
      viz.selectConcept(a.dataset.node!, true);
      return;
    }
    // Footnote marks scroll to their definition (and back) inside the panel —
    // never a real hash navigation, which would clobber the view state.
    const fn = t.closest("a[data-fn]") as HTMLElement | null;
    if (fn) {
      e.preventDefault();
      const target = panelEl?.querySelector(`[data-fn-target="${CSS.escape(fn.dataset.fn!)}"]`);
      target?.scrollIntoView({ block: "nearest" });
    }
  }

  let panelEl: HTMLElement | null = $state(null);
  let resizing = $state(false);
  function onPointerDown(e: PointerEvent) {
    if (!(e.target as Element).closest(".resizer")) return;
    e.preventDefault();
    resizing = true;
    panelEl?.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!resizing || !stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    viz.setPanelW(Math.round(Math.min(Math.max(300, rect.right - e.clientX), rect.width * 0.92)));
  }
  function onPointerUp() {
    if (!resizing) return;
    resizing = false;
    viz.persistPanelW();
  }

  const widthStyle = $derived.by(() => {
    void resizeSeq;
    return stageEl ? viz.panelPx(stageEl.clientWidth) + "px" : undefined;
  });

  $effect(() => {
    void viz.sel;
    void viz.cardsBundle;
    if (panelEl) panelEl.scrollTop = 0;
  });
</script>

{#if viz.sel.kind !== "none" || indexDoc}
  <!-- Click/pointer handlers are delegates for keyboard-reachable anchors and
       the close button inside — the section itself is not the interactive
       element. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <section
    id="panel"
    aria-live="polite"
    bind:this={panelEl}
    style:width={widthStyle}
    onclick={onClick}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
  >
    <div class="resizer" class:active={resizing}></div>
    <!-- Locked header: back link (when a concept referred us here) or a title
         crumb, plus close — always visible while the body scrolls. -->
    <header class="bar">
      {#if (viz.sel.kind === "file" || viz.sel.kind === "dir") && viz.backConcept}
        <a href="#{encodeHash({ kind: 'concept', id: viz.backConcept.id })}" class="back" data-node={viz.backConcept.id}
          >← {viz.backConcept.title}</a
        >
      {:else if viz.selectedConcept}
        <span class="crumb title">{viz.selectedConcept.title}</span>
      {:else if indexDoc}
        <span class="crumb title">{indexTitle}</span>
      {:else if viz.sel.kind === "dir"}
        <span class="crumb">{dirPath.split("/").pop()}/</span>
      {:else}
        <span class="crumb">{filePath.split("/").pop()}</span>
      {/if}
      <button class="close" aria-label="Close">×</button>
    </header>
    {#if viz.selectedConcept}
      {@const n = viz.selectedConcept}
      <span class="chip"><span class="dot" style="background:{viz.colorOf(n.type)}"></span>{n.type}</span>
      <table class="fm">
        <tbody>{@html fmRows(n)}</tbody>
      </table>
      <div id="body-md">{@html md.mdToHtml(n.body, n.id, { sources: sourcesOf(n.fm) })}</div>
      <div class="backlinks"><h4>Links to</h4>{@html linkList(outLinks(n.id))}</div>
      <div class="backlinks"><h4>Cited by</h4>{@html linkList(viz.model.inLinks[n.id] || [])}</div>
    {:else if file}
      {#if file.md != null}
        <!-- Markdown files read as documents: back link, rendered body,
             backlinks — no source view or metadata table. -->
        <div id="body-md" class="md-doc">{@html md.mdFileToHtml(file.md, filePath)}</div>
        <div class="backlinks"><h4>Referenced by</h4>{@html refList(file.refs)}</div>
      {:else}
        <h2>{filePath.split("/").pop()}</h2>
        <span class="chip"><span class="dot" style="background:var(--ink-muted)"></span>{file.lang}</span>
        <table class="fm">
          <tbody>
            <tr><td>path</td><td>{filePath}</td></tr>
            <tr><td>language</td><td>{file.lang}</td></tr>
            <tr><td>lines</td><td>{file.lines}</td></tr>
            <tr><td>size</td><td>{(file.size / 1024).toFixed(1)} KB</td></tr>
            <tr><td>last commit</td><td>{fmtDate(file.date) ?? file.date}</td></tr>
          </tbody>
        </table>
        <div class="backlinks flat"><h4>Referenced by</h4>{@html refList(file.refs)}</div>
        <pre class="src">{@html file.html}</pre>
      {/if}
    {:else if dir}
      <h2>{dirPath.split("/").pop()}/</h2>
      <span class="chip"><span class="dot" style="background:var(--ink-muted)"></span>directory</span>
      <table class="fm">
        <tbody>
          <tr><td>path</td><td>{dirPath}/</td></tr>
          <tr><td>entries</td><td>{dir.dirs.length + dir.files.length}</td></tr>
          <tr><td>last commit</td><td>{fmtDate(dir.date) ?? dir.date}</td></tr>
        </tbody>
      </table>
      <div class="backlinks flat"><h4>Referenced by</h4>{@html refList(dir.refs)}</div>
      <ul class="dir-list">
        {#each dir.dirs as d (d)}
          <li>
            {#if viz.model.dirs[d]}
              <a href="#{encodeHash({ kind: 'dir', path: d })}" data-dir={d}>{d.split("/").pop()}/</a>
            {:else}
              <span>{d.split("/").pop()}/</span>
            {/if}
          </li>
        {/each}
        {#each dir.files as f (f)}
          {@const ef = viz.model.files[f]}
          <li>
            {#if ef}
              <a href="#{encodeHash({ kind: 'file', path: f })}" data-file={f}>{f.split("/").pop()}</a>
              <span class="meta">{ef.lines} lines · {(ef.size / 1024).toFixed(1)} KB</span>
            {:else}
              <span>{f.split("/").pop()}</span>
              <span class="meta">not embedded</span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if indexDoc}
      <!-- The focused index.md read as a document; its listing links navigate
           (concepts select, sub-bundle indexes refocus). -->
      <span class="chip"><span class="dot" style="background:var(--ink-muted)"></span>index</span>
      <div id="body-md" class="md-doc">{@html md.mdToHtml(indexDoc.body ?? "", indexFromId)}</div>
    {/if}
  </section>
{/if}

<style>
  #panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(460px, 85%);
    /* Inside (left, canvas edge) eases from 90% so the scene reads through
       faintly at the seam; outside (right, screen edge) is fully opaque. */
    background: linear-gradient(
      to right,
      color-mix(in srgb, var(--surface-1) 90%, transparent),
      var(--surface-1)
    );
    border-left: 1px solid var(--grid);
    padding: 0 18px 18px;
    overflow-y: auto;
    z-index: 2;
  }
  .resizer {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    touch-action: none;
    z-index: 4;
  }
  .resizer:hover,
  .resizer.active {
    background: var(--grid);
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 -18px 12px;
    padding: 10px 18px;
    background: var(--surface-1);
    border-bottom: 1px solid var(--grid);
  }
  .bar .back,
  .bar .crumb {
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar .crumb {
    color: var(--ink-muted);
  }
  .bar .crumb.title {
    font-size: 16px;
    font-weight: 600;
    color: var(--ink-1);
  }
  .bar .close {
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
  #panel h2 {
    font-size: 17px;
    margin: 0 0 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--ink-2);
    border: 1px solid var(--grid);
    border-radius: 999px;
    padding: 2px 9px;
    margin-bottom: 10px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
    box-shadow: 0 0 0 2px var(--surface-1);
  }
  table.fm {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    margin: 8px 0 14px;
  }
  table.fm td {
    border-top: 1px solid var(--grid);
    padding: 4px 6px;
    vertical-align: top;
  }
  table.fm td:first-child {
    color: var(--ink-muted);
    white-space: nowrap;
    width: 1%;
  }
  /* OKF v0.2 families (families.ts): nested tables, actor tags, tier/status
     chips, the stale badge. Global — the rows are @html strings. */
  table.fm :global(table.sub) {
    border-collapse: collapse;
    font-size: 11.5px;
    margin: 2px 0;
  }
  table.fm :global(table.sub td),
  table.fm :global(table.sub th) {
    border-top: 0;
    padding: 1px 8px 1px 0;
    text-align: left;
    white-space: normal;
    width: auto;
    color: inherit;
  }
  table.fm :global(table.sub th) {
    color: var(--ink-muted);
    font-weight: 500;
  }
  table.fm :global(table.sub td:first-child) {
    color: var(--ink-muted);
  }
  table.fm :global(table.sources td:first-child) {
    color: inherit;
  }
  table.fm :global(tr.win td) {
    color: var(--ink-muted);
    font-size: 11px;
  }
  table.fm :global(ul.events) {
    margin: 2px 0 0;
    padding-left: 0;
    list-style: none;
  }
  table.fm :global(ol.sub) {
    margin: 0;
    padding-left: 16px;
  }
  table.fm :global(.actor .kind) {
    color: var(--ink-muted);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-right: 3px;
  }
  table.fm :global(.actor-human) {
    color: var(--link);
  }
  table.fm :global(.when),
  table.fm :global(.dim),
  table.fm :global(.range) {
    color: var(--ink-muted);
  }
  table.fm :global(.fam-chip) {
    display: inline-block;
    font-size: 10.5px;
    line-height: 16px;
    padding: 0 7px;
    border-radius: 999px;
    border: 1px solid var(--grid);
    margin-right: 6px;
    vertical-align: middle;
  }
  table.fm :global(.tier-human-reviewed),
  table.fm :global(.status-stable) {
    border-color: color-mix(in srgb, var(--ok, #3fb950) 60%, transparent);
    color: var(--ok, #3fb950);
  }
  table.fm :global(.tier-machine-confirmed),
  table.fm :global(.status-draft) {
    border-color: color-mix(in srgb, var(--warn, #d29922) 60%, transparent);
    color: var(--warn, #d29922);
  }
  table.fm :global(.tier-unverified) {
    color: var(--ink-muted);
  }
  table.fm :global(.status-deprecated),
  table.fm :global(.stale) {
    border-color: color-mix(in srgb, var(--danger, #f85149) 60%, transparent);
    color: var(--danger, #f85149);
  }
  #body-md :global(sup.fn) {
    font-size: 10px;
    line-height: 0;
  }
  #body-md :global(.footnotes) {
    border-top: 1px solid var(--grid);
    margin-top: 12px;
    padding-top: 6px;
    font-size: 11.5px;
    color: var(--ink-muted);
  }
  #body-md :global(.footnotes ol) {
    padding-left: 18px;
    margin: 0;
  }
  .backlinks {
    border-top: 1px solid var(--grid);
    margin-top: 14px;
    padding-top: 10px;
  }
  .backlinks.flat {
    border-top: 0;
    margin-top: 0;
    padding-top: 0;
  }
  .backlinks h4 {
    font-size: 12px;
    color: var(--ink-muted);
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  /* Injected via {@html} — must escape Svelte's scoping. */
  #body-md {
    font-size: 13.5px;
    color: var(--ink-2);
  }
  /* A rendered markdown document's leading heading acts as the panel title. */
  .md-doc :global(h3:first-child) {
    color: var(--ink-1);
    font-size: 17px;
    margin: 0 0 8px;
  }
  #body-md :global(h3) {
    color: var(--ink-1);
    font-size: 14px;
    margin: 14px 0 6px;
  }
  #body-md :global(p),
  #body-md :global(ul),
  #body-md :global(ol),
  #body-md :global(pre) {
    margin: 0 0 8px;
  }
  #body-md :global(ul),
  #body-md :global(ol) {
    padding-left: 20px;
  }
  #body-md :global(li) {
    margin-bottom: 3px;
  }
  #body-md :global(code) {
    font: 12px ui-monospace, Menlo, monospace;
    background: var(--page);
    border: 1px solid var(--grid);
    border-radius: 4px;
    padding: 0 4px;
  }
  #body-md :global(pre) {
    background: var(--page);
    border: 1px solid var(--grid);
    border-radius: 6px;
    padding: 8px 10px;
    overflow-x: auto;
  }
  #body-md :global(pre code) {
    border: 0;
    background: none;
    padding: 0;
  }
  #body-md :global(.tbl-wrap) {
    overflow-x: auto;
    margin: 0 0 10px;
  }
  #body-md :global(.tbl-wrap table) {
    border-collapse: collapse;
    font-size: 12.5px;
    width: 100%;
  }
  #body-md :global(.tbl-wrap th),
  #body-md :global(.tbl-wrap td) {
    border: 1px solid var(--grid);
    padding: 4px 8px;
    text-align: left;
    vertical-align: top;
  }
  #body-md :global(.tbl-wrap th) {
    color: var(--ink-1);
    background: var(--page);
  }
  #body-md :global(a) {
    color: var(--link);
  }
  .dir-list {
    list-style: none;
    padding: 0;
    margin-top: 12px;
    font: 12.5px/1.6 ui-monospace, Menlo, monospace;
  }
  .dir-list li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 6px;
    border-top: 1px solid var(--grid);
  }
  .dir-list li:last-child {
    border-bottom: 1px solid var(--grid);
  }
  .dir-list .meta {
    color: var(--ink-muted);
    font-size: 11px;
    white-space: nowrap;
  }
  .src {
    background: var(--page);
    border: 1px solid var(--grid);
    border-radius: 6px;
    padding: 10px 12px;
    overflow-x: auto;
    white-space: pre;
    margin-top: 12px;
    font: 12px/1.55 ui-monospace, Menlo, monospace;
    color: var(--ink-2);
  }
  .src :global(a) {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .src :global(a:hover) {
    color: var(--link);
  }
  .src :global(.tok-c) {
    color: var(--tok-c);
    font-style: italic;
  }
  .src :global(.tok-s) {
    color: var(--tok-s);
  }
  .src :global(.tok-k) {
    color: var(--tok-k);
  }
  .src :global(.tok-n) {
    color: var(--tok-n);
  }
</style>
