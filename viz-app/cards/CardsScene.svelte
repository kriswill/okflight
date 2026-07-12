<script lang="ts" module>
  import type * as THREE_NS from "three";
  import type { RenderEntry } from "./motion.svelte";

  /** Refs a Card registers for imperative per-frame writes. */
  export interface CardRefs {
    group: THREE_NS.Group;
    boxMesh: THREE_NS.Mesh;
    faceMesh: THREE_NS.Mesh;
    boxMat: THREE_NS.MeshBasicMaterial;
    faceMat: THREE_NS.MeshBasicMaterial;
    entry: RenderEntry;
  }

  /** Refs an ElbowArrow registers. */
  export interface ArrowRefs {
    tubeMesh: THREE_NS.Mesh;
    headMesh: THREE_NS.Mesh;
    tailMesh: THREE_NS.Mesh | null;
    /** Additive glow tube behind the line (dark surfaces only). */
    haloMesh: THREE_NS.Mesh | null;
    tubeMat: THREE_NS.MeshBasicMaterial;
    headMat: THREE_NS.MeshBasicMaterial;
    tailMat: THREE_NS.MeshBasicMaterial | null;
    haloMat: THREE_NS.MeshBasicMaterial | null;
    /** Gradient endpoints (already glow-lifted), read on every tube rebuild. */
    from: THREE_NS.Color;
    to: THREE_NS.Color;
  }
</script>

<script lang="ts">
  // Inside-the-Canvas root under the motion system. Svelte reactivity here
  // handles STRUCTURE only (mounting cards/arrows from motion.renderList/
  // arrowList, colors, textures); a single frame task samples the motion
  // store and imperatively writes every transform, opacity, tube geometry,
  // and the camera (single-writer rule). Dragging rotates one pivot group
  // about the dome center — no per-card work at all.
  import { T, useTask, useThrelte } from "@threlte/core";
  import * as THREE from "three";
  import { mark } from "../perf";
  import type { VizState } from "../state.svelte";
  import { tubeGradient } from "./arrowFrame";
  import Card from "./Card.svelte";
  import { inkFor } from "./cardFace";
  import { fitZoom, type CardLayout } from "./cardLayout";
  import ElbowArrow from "./ElbowArrow.svelte";
  import { createCardMotion, type ArrowState } from "./motion.svelte";
  import { pickCard3 } from "./picking";

  const { viz, layout }: { viz: VizState; layout: CardLayout } = $props();

  const { size, invalidate, renderer } = useThrelte();

  // Dead-on orthographic view: visual depth comes from the cylinder tilt
  // and card slabs alone, so bands and arrows line up with the screen axes.
  const EYE = new THREE.Vector3(0, 0, 900);
  const SIDEBAR_W = 260; // keep in sync with Stage.svelte / Sidebar #side
  const TUBE_R = 1.4;
  /** Tube tessellation — tubeGradient's ring math must match. */
  const TUBULAR = 40;
  const RADIAL = 6;
  /** Halo tube: wider, faint, additive — reads as glow on dark surfaces. */
  const HALO_R = TUBE_R * 2.8;
  const HALO_OPACITY = 0.3;

  const motion = createCardMotion();

  let cam = $state<THREE.OrthographicCamera | undefined>();

  /* --- registries + frame application ------------------------------------ */
  const cardRefs = new Map<string, CardRefs>();
  const arrowRefs = new Map<string, ArrowRefs>();
  let hovered: string | null = null;

  const DEPTH = 8;
  const applyCard = (id: string, refs: CardRefs) => {
    const s = motion.sample(id);
    if (!s) return;
    refs.group.position.copy(s.pos);
    refs.group.quaternion.copy(s.quat);
    // Aperture depth cue: the whole card shrinks with its sample scale
    // (arrow anchors and picking follow it inside the motion store).
    refs.group.scale.setScalar(s.scale * (hovered === id ? 1.03 : 1));
    refs.boxMesh.scale.set(s.w * s.sx, s.h * s.sy, DEPTH);
    refs.faceMesh.scale.set(s.w * s.sx, s.h * s.sy, 1);
    refs.boxMat.opacity = s.opacity;
    refs.faceMat.opacity = s.opacity;
    // Fully faded cards should not catch the eye as z-fighting ghosts.
    refs.group.visible = s.opacity > 0.004;
  };

  const applyArrow = (a: ArrowState, refs: ArrowRefs, rebuildTube: boolean) => {
    if (rebuildTube) {
      const curve = new THREE.CatmullRomCurve3(a.path);
      // Same CPU gradient array for tube and halo (separate GL buffers).
      const grad = tubeGradient(refs.from, refs.to, TUBULAR, RADIAL);
      const old = refs.tubeMesh.geometry;
      const tube = new THREE.TubeGeometry(curve, TUBULAR, TUBE_R, RADIAL, false);
      tube.setAttribute("color", new THREE.BufferAttribute(grad, 3));
      refs.tubeMesh.geometry = tube;
      old?.dispose();
      if (refs.haloMesh) {
        const oldHalo = refs.haloMesh.geometry;
        const halo = new THREE.TubeGeometry(curve, TUBULAR, HALO_R, RADIAL, false);
        halo.setAttribute("color", new THREE.BufferAttribute(grad, 3));
        refs.haloMesh.geometry = halo;
        oldHalo?.dispose();
      }
    }
    refs.headMesh.position.copy(a.head.pos);
    refs.headMesh.quaternion.copy(a.head.quat);
    if (a.tailHead && refs.tailMesh) {
      refs.tailMesh.position.copy(a.tailHead.pos);
      refs.tailMesh.quaternion.copy(a.tailHead.quat);
    }
    refs.tubeMat.opacity = a.opacity;
    refs.headMat.opacity = a.opacity;
    if (refs.tailMat) refs.tailMat.opacity = a.opacity;
    if (refs.haloMat) refs.haloMat.opacity = a.opacity * HALO_OPACITY;
  };

  const applyCamera = () => {
    if (!cam) return;
    const v = motion.view;
    cam.position.set(EYE.x + v.shift, EYE.y, EYE.z);
    cam.lookAt(v.shift, 0, 0);
    cam.zoom = v.zoom;
    cam.updateProjectionMatrix();
  };

  const applyFrame = (forceArrows = false) => {
    const rebuildTubes = forceArrows || !motion.settled;
    for (const [id, refs] of cardRefs) applyCard(id, refs);
    for (const a of motion.arrowStates()) {
      const refs = arrowRefs.get(a.key);
      if (refs) applyArrow(a, refs, rebuildTubes);
    }
    applyCamera();
  };

  const registerCard = (id: string, refs: CardRefs) => {
    cardRefs.set(id, refs);
    applyCard(id, refs);
    invalidate();
    return () => {
      cardRefs.delete(id);
    };
  };
  const registerArrow = (key: string, refs: ArrowRefs) => {
    arrowRefs.set(key, refs);
    const a = motion.arrowStates().find((s) => s.key === key);
    if (a) applyArrow(a, refs, true);
    invalidate();
    return () => {
      refs.tubeMesh.geometry?.dispose();
      refs.haloMesh?.geometry?.dispose();
      arrowRefs.delete(key);
    };
  };
  /** Structure-time color/glow change: rebuild that arrow's gradient. */
  const refreshArrow = (key: string) => {
    const refs = arrowRefs.get(key);
    const a = motion.arrowStates().find((s) => s.key === key);
    if (refs && a) {
      applyArrow(a, refs, true);
      invalidate();
    }
  };

  /* --- the one frame task ------------------------------------------------- */
  useTask(
    (delta) => {
      motion.step(delta * 1000);
      applyFrame();
    },
    { running: () => !motion.settled },
  );

  /* --- retarget + view targets -------------------------------------------- */
  $effect(() => {
    motion.setLayout(layout, viz.cardFlow);
    if (motion.settled) {
      // Snap paths (first mount, reduced motion, no-op relayout): apply once.
      applyFrame(true);
      invalidate();
    }
  });

  const rightInset = $derived(viz.sel.kind !== "none" || viz.cardsIndexDoc ? viz.panelPx($size.width) : 0);
  const zoomTarget = $derived(
    fitZoom(layout.bounds, Math.max(160, $size.width - SIDEBAR_W - rightInset), Math.max(160, $size.height - 48)),
  );
  const shiftTarget = $derived.by(() => {
    const z = zoomTarget;
    return (rightInset - SIDEBAR_W) / 2 / z;
  });
  $effect(() => {
    motion.setViewTargets(zoomTarget, shiftTarget);
    if (motion.settled) {
      applyCamera();
      invalidate();
    }
  });

  /* --- colors / titles (structure-time reactivity) ------------------------ */
  // Same central source as the graph: the applied theme's CSS vars
  // (themes.ts stops), re-read on every palette bump — never hardcoded.
  const themeVars = $derived.by(() => {
    void viz.paletteVersion;
    return viz.theme();
  });
  const NEUTRAL = $derived(themeVars.neutral);
  const INK = $derived(themeVars.ink);
  // A dir card wears its bundle's dominant concept type color (an empty
  // bundle stays neutral) — the same hue the legend gives those concepts.
  const bundleColor = (path: string): string => {
    const counts = new Map<string, number>();
    for (const n of viz.model.nodes)
      if (n.id.startsWith(path + "/")) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    let best = "";
    for (const t of [...counts.keys()].sort()) if (counts.get(t)! > (counts.get(best) ?? 0)) best = t;
    return best ? viz.colorOf(best) : NEUTRAL;
  };
  // The KB root card (synthetic focus or ring-1 "root" entry) vs a bundle's
  // index card vs a concept card, by id shape: concepts win lookups outright.
  const isRoot = (r: RenderEntry) => r.id === "";
  const isBundle = (r: RenderEntry) => !isRoot(r) && !viz.model.byId[r.id];
  const colorFor = $derived.by(() => {
    void viz.paletteVersion;
    const m = new Map<string, string>();
    for (const r of motion.renderList) {
      const n = viz.model.byId[r.id];
      m.set(r.id, n ? viz.colorOf(n.type) : isBundle(r) ? bundleColor(r.id) : NEUTRAL);
    }
    return m;
  });
  // Concept cards read as type-colored outlines with page-ink text; the
  // structural cards (root and bundle indexes) are the solid slabs.
  const outlineFor = (r: RenderEntry): boolean => !isRoot(r) && !isBundle(r);
  // Dark surface -> glow treatment on the lines, judged from the applied
  // theme's page color (same luminance rule the card faces use for ink).
  const GLOW = $derived(inkFor(themeVars.bg || "#ffffff") !== "#16181d");
  const titleFor = (r: RenderEntry): string => {
    if (isRoot(r)) return viz.model.root?.title || viz.model.displayName;
    if (isBundle(r)) return viz.model.bundles[r.id]?.title || r.id + "/";
    return viz.model.byId[r.id]?.title ?? r.id;
  };
  const descFor = (r: RenderEntry): string => {
    if (r.kind !== "focus") return "";
    if (isRoot(r)) return viz.model.root?.desc ?? "";
    if (isBundle(r)) return viz.model.bundles[r.id]?.desc ?? "";
    return viz.model.byId[r.id]?.desc ?? "";
  };

  /* --- pointer machine: hover / click / drag ------------------------------ */
  const clickableKinds = new Set(["card", "dir", "root"]);
  const setHovered = (id: string | null) => {
    if (hovered === id) return;
    const prev = hovered;
    hovered = id;
    for (const affected of [prev, id]) {
      if (!affected) continue;
      const refs = cardRefs.get(affected);
      if (refs) applyCard(affected, refs);
    }
    invalidate();
  };

  $effect(() => {
    const el = renderer.domElement;
    const ndc = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return { x: ((cx - r.left) / r.width) * 2 - 1, y: -(((cy - r.top) / r.height) * 2 - 1) };
    };
    const pick = (e: PointerEvent) => {
      if (!cam) return null;
      return pickCard3(ndc(e.clientX, e.clientY), cam, motion.pickItems());
    };
    // Which scrollable band the pointer is over: intersect the pointer ray
    // with the z=0 stage plane (exact for any camera pose, unlike a plain
    // unproject) and classify by the cross coordinate.
    const ray = new THREE.Raycaster();
    const sideAt = (cx: number, cy: number): "in" | "out" | null => {
      if (!cam) return null;
      const n = ndc(cx, cy);
      ray.setFromCamera(new THREE.Vector2(n.x, n.y), cam);
      const tZ = -ray.ray.origin.z / ray.ray.direction.z;
      const wx = ray.ray.origin.x + ray.ray.direction.x * tZ;
      const wy = ray.ray.origin.y + ray.ray.direction.y * tZ;
      const cross = motion.flow === "v" ? wy : wx;
      const inSign = motion.flow === "v" ? 1 : -1; // in-band: above (v) / left (h)
      if (cross * inSign > 60) return "in";
      if (cross * inSign < -60) return "out";
      return null;
    };
    let press: { x: number; y: number } | null = null;
    let dragSide: "in" | "out" | null = null;
    let dragging = false;
    let last = { x: 0, y: 0 };

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      press = { x: e.clientX, y: e.clientY };
      last = { x: e.clientX, y: e.clientY };
      dragSide = sideAt(e.clientX, e.clientY);
    };
    const move = (e: PointerEvent) => {
      if (press && !dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) {
        dragging = true;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* no active pointer */
        }
        setHovered(null);
        if (dragSide) el.style.cursor = "grabbing";
      }
      if (dragging) {
        if (dragSide) {
          // Direct manipulation: the band's content follows the pointer.
          const zoom = cam?.zoom ?? 1;
          const worldD =
            motion.flow === "v" ? (e.clientX - last.x) / zoom : -(e.clientY - last.y) / zoom;
          motion.scrollBy(dragSide, -worldD);
          applyFrame(true);
          invalidate();
        }
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (!motion.settled) return; // hover disabled mid-animation
      const id = pick(e);
      const c = id ? motion.renderList.find((r) => r.id === id) : null;
      setHovered(c && clickableKinds.has(c.kind) ? id : null);
      el.style.cursor = hovered ? "pointer" : sideAt(e.clientX, e.clientY) ? "grab" : "default";
    };
    const up = (e: PointerEvent) => {
      const wasDragging = dragging;
      dragging = false;
      dragSide = null;
      if (wasDragging) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* no active pointer */
        }
        el.style.cursor = "default";
        press = null;
        return; // a drag never selects
      }
      if (!press || e.button !== 0) return;
      press = null;
      const id = pick(e);
      if (!id) {
        viz.clearSelection();
        return;
      }
      const r = motion.renderList.find((x) => x.id === id);
      if (r?.kind === "dir") viz.focusBundle(id);
      else if (r?.kind === "root") viz.clearSelection();
      else if (r?.kind === "card") viz.selectConcept(id, false);
    };
    const cancel = () => {
      press = null;
      dragging = false;
      dragSide = null;
      el.style.cursor = "default";
    };
    const wheel = (e: WheelEvent) => {
      const side = sideAt(e.clientX, e.clientY);
      if (!side) return;
      e.preventDefault();
      const zoom = cam?.zoom ?? 1;
      // Dominant wheel axis drives the band; trackpad horizontal swipes map
      // naturally in vertical flow.
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      motion.scrollBy(side, raw / zoom);
      applyFrame(true);
      invalidate();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      el.removeEventListener("wheel", wheel);
      el.style.cursor = "default";
    };
  });

  /* --- automation handle --------------------------------------------------- */
  $effect(() => {
    const okf = (window as unknown as { __okf?: Record<string, unknown> }).__okf;
    if (!okf) return;
    okf.cards = {
      get layout() {
        return layout;
      },
      get settled() {
        return motion.settled;
      },
      get progress() {
        return motion.progress;
      },
      get scroll() {
        return { ...motion.scroll };
      },
      scrollBy: (side: "in" | "out", d: number) => {
        motion.scrollBy(side, d);
        applyFrame(true);
        invalidate();
      },
      pose: (id: string) => {
        const p = motion.pose(id);
        return p ? { x: p.x, y: p.y, z: p.z } : null;
      },
      /** Live card center in client px, for automation clicks. */
      project: (id: string) => {
        const p = motion.pose(id);
        if (!p || !cam) return null;
        const v = p.clone().project(cam);
        const r = renderer.domElement.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
    };
    return () => {
      delete okf.cards;
    };
  });

  // Startup marks when cards is the initial view (paused graph never
  // composites; --perf waits on viz:interactive).
  $effect(() => {
    if (performance.getEntriesByName("viz:interactive").length) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        mark("viz:first-frame");
        mark("viz:interactive");
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  });
</script>

<T.OrthographicCamera makeDefault bind:ref={cam} position={[EYE.x, EYE.y, EYE.z]} near={0.1} far={6000} />

{#each motion.renderList as r (r.id)}
  <Card
    entry={r}
    bg={colorFor.get(r.id) ?? NEUTRAL}
    title={titleFor(r)}
    desc={descFor(r)}
    outline={outlineFor(r)}
    ink={INK}
    {registerCard}
  />
{/each}
{#each motion.arrowList as a (a.key)}
  <ElbowArrow
    arrowKey={a.key}
    twoWay={a.twoWay}
    fromColor={colorFor.get(a.fromId) ?? NEUTRAL}
    toColor={colorFor.get(a.toId) ?? NEUTRAL}
    glow={GLOW}
    {registerArrow}
    {refreshArrow}
  />
{/each}
