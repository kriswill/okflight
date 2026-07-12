<script lang="ts">
  // Inside-the-Canvas root: the skewed iso ortho camera, one Card per
  // placement, one ElbowArrow per arrow, pointer picking against the layout
  // (no scene-graph raycasts), and the __okf.cards debug handle the e2e
  // script asserts against.
  import { T, useThrelte } from "@threlte/core";
  import * as THREE from "three";
  import type { VizState } from "../state.svelte";
  import Card from "./Card.svelte";
  import { fitZoom, type ArrowSpec, type CardLayout, type CardPlacement } from "./cardLayout";
  import ElbowArrow from "./ElbowArrow.svelte";
  import { pickCard3, type PickItem } from "./picking";

  const { viz, layout }: { viz: VizState; layout: CardLayout } = $props();

  const { size, invalidate, renderer } = useThrelte();

  // Fixed skew direction: a subtle yaw+pitch parallelogram look; cards stay
  // axis-aligned in world space so the flow still reads strictly vertical.
  const EYE = new THREE.Vector3(0.25, 0.18, 1).normalize().multiplyScalar(900);

  let cam = $state<THREE.OrthographicCamera | undefined>();
  // The sidebar and detail panel overlay the stage (same trick as
  // GraphScene.setViewShift): fit and center the layout inside the
  // unobstructed region, not the full canvas.
  const SIDEBAR_W = 260; // keep in sync with Stage.svelte / Sidebar #side
  const rightInset = $derived(viz.sel.kind !== "none" ? viz.panelPx($size.width) : 0);
  const zoom = $derived(
    fitZoom(layout.bounds, Math.max(160, $size.width - SIDEBAR_W - rightInset), Math.max(160, $size.height - 48)),
  );
  const shift = $derived((rightInset - SIDEBAR_W) / 2 / zoom);
  $effect(() => {
    if (!cam) return;
    cam.position.set(EYE.x + shift, EYE.y, EYE.z);
    cam.lookAt(shift, 0, 0);
    cam.zoom = zoom;
    cam.updateProjectionMatrix();
    invalidate();
  });

  // Colors re-derive on palette/theme flips exactly like Stage's theme bridge.
  const NEUTRAL = $derived(viz.dark ? "#3d4350" : "#c9ced8");
  const colorFor = $derived.by(() => {
    void viz.paletteVersion;
    void viz.dark;
    const m = new Map<string, string>();
    for (const c of layout.cards) {
      const n = viz.model.byId[c.id];
      m.set(c.id, c.kind === "card" || (c.kind === "focus" && n) ? viz.colorOf(n!.type) : NEUTRAL);
    }
    return m;
  });

  const titleFor = (c: CardPlacement): string => {
    if (c.kind === "more") return `+${c.overflow} more`;
    if (c.kind === "dir") return c.id + "/";
    if (c.kind === "focus" && layout.rootFocus) return viz.model.root?.title || viz.model.displayName;
    return viz.model.byId[c.id]?.title ?? c.id;
  };
  const descFor = (c: CardPlacement): string => {
    if (c.kind !== "focus") return "";
    if (layout.rootFocus) return viz.model.root?.desc ?? "";
    return viz.model.byId[c.id]?.desc ?? "";
  };
  // Arrows take the non-focus endpoint's color so each stream reads as its
  // card's type.
  const arrowColor = (a: ArrowSpec): string => {
    const other = a.dir === "in" ? a.fromId : a.toId;
    const c = layout.byId[other];
    return c && c.ring === 2 ? (colorFor.get(other) ?? NEUTRAL) : (colorFor.get(other) ?? NEUTRAL);
  };

  /* --- pointer picking --------------------------------------------------- */
  let hovered = $state<string | null>(null);
  const clickable = (id: string) => {
    const c = layout.byId[id];
    return !!c && (c.kind === "card" || c.kind === "dir");
  };
  // Flat identity poses until the motion store owns live transforms.
  const pickItems: PickItem[] = $derived(
    layout.cards.map((c) => ({
      id: c.id,
      kind: c.kind,
      pos: new THREE.Vector3(c.x, c.y, c.z),
      quat: new THREE.Quaternion(),
      w: c.w,
      h: c.h,
      opacity: 1,
    })),
  );
  $effect(() => {
    const el = renderer.domElement;
    const ndc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1) };
    };
    const move = (e: PointerEvent) => {
      if (!cam) return;
      const id = pickCard3(ndc(e), cam, pickItems);
      hovered = id && clickable(id) ? id : null;
      el.style.cursor = hovered ? "pointer" : "default";
    };
    const up = (e: PointerEvent) => {
      if (!cam || e.button !== 0) return;
      const id = pickCard3(ndc(e), cam, pickItems);
      if (!id) {
        viz.clearSelection();
        return;
      }
      const c = layout.byId[id]!;
      if (c.kind === "dir") viz.selectDir(id);
      else if (c.kind === "card") viz.selectConcept(id, false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.style.cursor = "default";
    };
  });

  /* --- automation handle (mirrors __okf.scene / __okf.perf) -------------- */
  $effect(() => {
    const okf = (window as unknown as { __okf?: Record<string, unknown> }).__okf;
    if (!okf) return;
    const current = layout;
    okf.cards = {
      get layout() {
        return current;
      },
      /** Card center in client px, for automation clicks. */
      project: (id: string) => {
        const c = current.byId[id];
        if (!c || !cam) return null;
        const v = new THREE.Vector3(c.x, c.y, c.z).project(cam);
        const r = renderer.domElement.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
    };
    return () => {
      delete okf.cards;
    };
  });
</script>

<T.OrthographicCamera makeDefault bind:ref={cam} position={[EYE.x, EYE.y, EYE.z]} near={0.1} far={4000} />

{#each layout.cards as c (c.id)}
  <Card
    placement={c}
    bg={colorFor.get(c.id) ?? NEUTRAL}
    title={titleFor(c)}
    desc={descFor(c)}
    hovered={hovered === c.id}
  />
{/each}
{#each layout.arrows as a (a.fromId + "→" + a.toId)}
  <ElbowArrow arrow={a} color={arrowColor(a)} />
{/each}
