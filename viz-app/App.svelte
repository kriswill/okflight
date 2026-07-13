<script lang="ts">
  import type { Component } from "svelte";
  import { decodeViewHash, encodeViewHash } from "./hash";
  import { installPerf, mark, summary } from "./perf";
  import type { CreateScene, SceneApi } from "./scene";
  import Sidebar from "./Sidebar.svelte";
  import Stage from "./Stage.svelte";
  import type { VizState } from "./state.svelte";

  interface Props {
    viz: VizState;
    /** Test seam, forwarded to Stage. */
    createScene?: CreateScene;
    /** Cards view component, injected by main.ts and forwarded to Stage. */
    cards?: Component<{ viz: VizState }>;
  }
  const { viz, createScene, cards }: Props = $props();

  /* --- URL state (hash) — selection + filters survive reload/back/forward - */
  let currentState: string | null = null;
  const selPart = (h: string) => h.split("?", 1)[0]!;

  function applyHash() {
    // decodeViewHash owns the (single) decode of the raw hash. currentState
    // always holds the canonical encodeViewHash form, so an encoded deep link
    // compares equal to what the write-effect stores: the URL is applied,
    // never rewritten (a rewrite pushes a history entry per navigation —
    // Back trap). A hash without filter params clears the filters: every
    // in-app link is click-intercepted, so a bare hash only arrives via
    // deep link, hand edit, or Back to an unfiltered entry.
    const view = decodeViewHash(location.hash.slice(1), viz.model);
    const h = encodeViewHash(view);
    if (h === currentState) return;
    currentState = h;
    viz.setFilters(
      view.filters.hidden,
      view.filters.q,
      view.filters.isolate,
      view.filters.facets,
      view.filters.view,
      view.filters.flow,
    );
    const sel = view.sel;
    if (sel.kind === "concept") viz.selectConcept(sel.id, true);
    else if (sel.kind === "file") viz.selectFile(sel.path);
    else if (sel.kind === "dir") viz.selectDir(sel.path);
    else if (sel.kind === "bundle") viz.focusBundle(sel.path);
    else viz.clearSelection();
  }

  $effect(() => {
    const h = encodeViewHash({
      // Bundle focus is a navigation without a details panel: viz.sel stays
      // "none", so compose the encoded selection from cardsBundle — but a
      // live selection (a file/dir panel opened over the bundle) is what
      // the user is looking at and must win the URL.
      sel:
        viz.sel.kind === "none" && viz.cardsBundle
          ? { kind: "bundle", path: viz.cardsBundle }
          : viz.sel,
      filters: {
        hidden: [...viz.hidden],
        q: viz.query,
        isolate: viz.isolateDepth,
        facets: { ...viz.facetSel },
        view: viz.viewMode,
        flow: viz.cardFlow,
      },
    });
    if (currentState === h) return;
    const selChanged = currentState == null || selPart(h) !== selPart(currentState);
    currentState = h;
    if (location.hash.slice(1) === h) return;
    if (selChanged) {
      // Selection navigations get history entries (Back walks selections).
      if (h) location.hash = h;
      else {
        try {
          history.pushState(null, "", location.pathname + location.search);
        } catch {
          location.hash = "";
        }
      }
    } else {
      // Filter-only change: keep the URL shareable without one history entry
      // per keystroke/toggle — the current entry is amended in place.
      try {
        history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
      } catch {
        location.hash = h;
      }
    }
  });

  /* --- dark mode ----------------------------------------------------------- */
  $effect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const on = () => viz.systemSchemeChanged(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  });

  /* --- debug/scripting hook (also used by automated visual checks) --------- */
  let sceneRef: SceneApi | null = null;
  const okf: Record<string, unknown> = {
    select: (id: string, fly = true) => (viz.model.byId[id] ? viz.selectConcept(id, fly) : viz.clearSelection()),
    selectFile: (path: string) => viz.selectFile(path),
    selectDir: (path: string) => viz.selectDir(path),
    focusBundle: (path: string) => viz.focusBundle(path),
    get scene() {
      return sceneRef;
    },
    get view() {
      return viz.viewMode;
    },
    setView: (v: "graph" | "cards") => viz.setViewMode(v),
    get flow() {
      return viz.cardFlow;
    },
    setFlow: (f: "v" | "h") => viz.setCardFlow(f),
    // svelte-ignore state_referenced_locally -- viz's identity never changes
    nodes: viz.model.nodes,
  };
  installPerf(okf);
  (window as unknown as { __okf: unknown }).__okf = okf;

  const onSceneReady = (s: SceneApi) => {
    sceneRef = s;
    mark("viz:scene-init");
  };
  const onFirstFrame = () => {
    mark("viz:first-frame");
    mark("viz:interactive");
    console.log(
      "okf viz startup: " +
        summary()
          .map((e) => `${e.name.slice(4)} ${e.ms}ms`)
          .join(" · "),
    );
  };

  applyHash();
</script>

<svelte:window onhashchange={applyHash} onpopstate={applyHash} />

<Sidebar {viz} />
<Stage {viz} {createScene} {cards} {onSceneReady} {onFirstFrame} />
