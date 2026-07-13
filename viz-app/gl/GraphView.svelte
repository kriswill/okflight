<script lang="ts">
  // The 3D graph stage as a Threlte subtree — one InstancedMesh of spheres
  // whose per-instance colors are boosted past 1.0 so the bloom pass renders
  // the excess as a glow corona; additive edge lines; canvas-texture sprite
  // labels; OrbitControls with eased fly-to. Layout is precomputed at
  // generation time — nothing simulates at runtime.
  //
  // Always mounted (the group toggles visible per viewMode) so its
  // makeDefault perspective camera anchors Threlte's camera set: the cards
  // scene's ortho camera steals the default while mounted and Threlte falls
  // back here when it unmounts. Svelte reactivity handles structure +
  // repaint boundaries; the camera is written only inside the single frame
  // task (fly tween, then controls damping — the cards single-writer rule).
  // The graph draws through its own composer task in the render stage
  // (bloom needs an EffectComposer); GlRoot stops Threlte's auto-render
  // task while this mode owns the frame.
  import { T, useTask, useThrelte } from "@threlte/core";
  import { BloomEffect, EffectComposer, EffectPass, RenderPass } from "postprocessing";
  import { untrack } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/addons/controls/OrbitControls.js";
  import { LineMaterial } from "three/addons/lines/LineMaterial.js";
  import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
  import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
  import { fitView, flyTarget, type FlyNode } from "../graph/flyTo";
  import { adjacency, labelVisible, makeLabelTexture, MAX_LABELS, rankByDegree } from "../graph/labels";
  import { createGraphMotion } from "../graph/motion.svelte";
  import { isDarkBg, paintEdgeColors, paintNodeColor, selRel } from "../graph/palette";
  import type { VizState } from "../state.svelte";
  import { ndc as toNdc, pressTracker } from "./pointer";
  import { SIDEBAR_W, viewOffsetX } from "./viewShift";

  interface Props {
    viz: VizState;
    onSceneReady?: () => void;
    onFirstFrame?: () => void;
  }
  const { viz, onSceneReady, onFirstFrame }: Props = $props();

  const { renderer, renderStage, invalidate, size, dpr, scene } = useThrelte();

  const inGraph = () => viz.viewMode === "graph";

  /* --- static structure (positions frozen at generation time) ------------- */
  // svelte-ignore state_referenced_locally -- viz's identity never changes
  const nodes = viz.model.nodes;
  // svelte-ignore state_referenced_locally -- viz's identity never changes
  const edges = viz.model.edgeIdx;
  const fnodes: FlyNode[] = nodes.map((n, i) => ({ x: n.x, y: n.y, z: n.z, r: viz.model.radii[i]! }));
  const adj = adjacency(nodes.length, edges);
  const labelRank = rankByDegree(nodes.length, edges);
  const top = new Set(labelRank.slice(0, MAX_LABELS));

  const cam = new THREE.PerspectiveCamera(55, 1, 1, 6000);
  cam.position.set(0, 60, 620);

  // Node spheres
  const sphereGeo = new THREE.SphereGeometry(1, 20, 20);
  const sphereMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const mesh = new THREE.InstancedMesh(sphereGeo, sphereMat, nodes.length);
  {
    const m = new THREE.Matrix4();
    fnodes.forEach((n, i) => {
      m.makeScale(n.r, n.r, n.r).setPosition(n.x, n.y, n.z);
      mesh.setMatrixAt(i, m);
    });
  }

  // Edge lines (positions fixed; colors rewritten on state changes).
  // Fat lines (LineSegments2): WebGL ignores linewidth on basic line
  // materials, so screen-space width needs the addon material.
  const lineGeo = new LineSegmentsGeometry();
  {
    const pos = new Float32Array(edges.length * 6);
    edges.forEach(([a, b], i) => {
      pos.set([fnodes[a]!.x, fnodes[a]!.y, fnodes[a]!.z, fnodes[b]!.x, fnodes[b]!.y, fnodes[b]!.z], i * 6);
    });
    lineGeo.setPositions(pos);
    lineGeo.setColors(new Float32Array(edges.length * 6));
  }
  const lineMat = new LineMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    linewidth: 1.6, // px
  });
  lineMat.toneMapped = false;
  const lines = new LineSegments2(lineGeo, lineMat);

  // Label sprites, built once; the eager texture effect below owns the maps
  // (and their disposal), so a theme flip re-inks every label.
  const labelGroup = new THREE.Group();
  const labels = fnodes.map((n) => {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false, // text always reads — lines/spheres never overdraw it
        toneMapped: false,
      }),
    );
    sp.renderOrder = 2;
    sp.position.set(n.x, n.y - n.r - 7, n.z);
    labelGroup.add(sp);
    return sp;
  });

  // HalfFloat framebuffer: without it the >1.0 instance colors are clamped
  // before the bloom pass, killing the glow entirely.
  const composer = new EffectComposer(renderer as THREE.WebGLRenderer, {
    multisampling: 0,
    frameBufferType: THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, cam));
  // Params mirror graph-ui's <Bloom> exactly (intensity retuned per theme).
  const bloom = new BloomEffect({
    intensity: 1.2,
    luminanceThreshold: 0.3,
    luminanceSmoothing: 0.7,
    mipmapBlur: true,
    radius: 0.6,
  });
  composer.addPass(new EffectPass(cam, bloom));

  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.addEventListener("change", invalidate);

  const gmotion = createGraphMotion();

  // Sleep-at-idle: the sim task runs only while something can move the
  // camera — an in-flight fly, an engaged pointer/wheel interaction, or its
  // damping tail. At rest the graph renders 0 fps (the old GraphScene
  // free-ran its RAF forever); state-change effects invalidate() directly,
  // so repaints never depend on the sim.
  let simActive = $state(true);
  let engaged = false; // between OrbitControls start/end (drag or wheel)
  const wake = () => (simActive = true);
  controls.addEventListener("start", () => {
    engaged = true;
    wake();
  });
  controls.addEventListener("end", () => {
    engaged = false;
    wake(); // damping tail: keep stepping until update() reports no motion
  });

  /* --- paint state (plain fields; effects below are the only writers) ----- */
  // Dark backgrounds get the glow look (additive lines, >1.0 bloom colors);
  // light ones get ink-on-paper (normal blending, colors fade toward the page).
  let darkBg = true;
  let selected: number | null = null;
  let hoverIdx: number | null = null;
  let dimmed: (i: number) => boolean = () => false;
  // svelte-ignore state_referenced_locally -- seed value; the theme effect below re-reads
  let theme = viz.theme();
  let baseColors: string[] = [];
  let shiftPx = 0;
  let fitted = false;

  const updateLabelVisibility = () => {
    labels.forEach((sp, i) => {
      sp.visible = labelVisible(i, {
        dimmed: dimmed(i),
        top,
        selected,
        hover: hoverIdx,
        isNeighbor: selected !== null && adj[selected]!.has(i),
      });
    });
  };

  const repaint = () => {
    const c = new THREE.Color();
    const ctx = { darkBg, bg: new THREE.Color(theme.bg) };
    nodes.forEach((_, i) => {
      paintNodeColor(c.set(baseColors[i]!), selRel(i, selected, adj), dimmed(i), ctx);
      mesh.setColorAt(i, c);
    });
    mesh.instanceColor!.needsUpdate = true;

    const edgeColors = new Float32Array(edges.length * 6);
    const ca = new THREE.Color(),
      cb = new THREE.Color();
    const hasSelection = selected !== null;
    edges.forEach(([a, b], i) => {
      const active = hasSelection ? a === selected || b === selected : true;
      const dim = dimmed(a) || dimmed(b) || !active;
      ca.set(baseColors[a]!);
      cb.set(baseColors[b]!);
      paintEdgeColors(ca, cb, { dim, active, hasSelection }, ctx);
      edgeColors.set([ca.r, ca.g, ca.b, cb.r, cb.g, cb.b], i * 6);
    });
    lineGeo.setColors(edgeColors);
    updateLabelVisibility();
  };

  /** Selected node scales up and its label grows; everything else at rest. */
  const applyEmphasis = () => {
    const m = new THREE.Matrix4();
    fnodes.forEach((n, i) => {
      const isSel = i === selected;
      const s = n.r * (isSel ? 1.3 : 1);
      m.makeScale(s, s, s).setPosition(n.x, n.y, n.z);
      mesh.setMatrixAt(i, m);
      const sp = labels[i]!;
      const base = sp.userData.base as { w: number; h: number } | undefined;
      if (!base) return;
      const k = isSel ? 1.45 : 1;
      sp.scale.set(base.w * k, base.h * k, 1);
      sp.position.set(n.x, n.y - s - (isSel ? 8 : 7), n.z);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  /* --- frame tasks --------------------------------------------------------- */
  // The one per-frame writer: fly tween first, then controls (user input +
  // damping) — the same ordering the old RAF loop used. autoInvalidate
  // keeps frames coming while it runs; when neither the fly nor the
  // controls moved anything and no interaction is engaged, it puts itself
  // to sleep.
  useTask(
    (delta) => {
      const flyMoved = gmotion.step(delta * 1000, cam.position, controls.target);
      const ctrlMoved = controls.update();
      if (!flyMoved && !ctrlMoved && !engaged) simActive = false;
    },
    { running: () => inGraph() && simActive },
  );

  // The draw — replaces Threlte's auto-render task in graph mode (GlRoot
  // stops that one). autoInvalidate must stay off or the render task itself
  // would force a render every frame, defeating on-demand mode.
  let firstFrame = true;
  let frames = 0; // composited-frame counter (probe: idle must not render)
  useTask(
    () => {
      if (!fitted) return; // first composited frame must be correctly framed
      composer.render();
      frames++;
      if (firstFrame) {
        firstFrame = false;
        onFirstFrame?.();
      }
    },
    { stage: renderStage, autoInvalidate: false, running: inGraph },
  );

  /* --- reactive bridges (same dependency sets Stage.svelte used) ----------- */
  $effect(() => {
    controls.enabled = viz.viewMode === "graph";
  });

  $effect(() => {
    void viz.query;
    void viz.hidden.size;
    void viz.isolateDepth;
    void viz.sel;
    void viz.facetSel;
    dimmed = (i) => !viz.visible(nodes[i]!);
    untrack(repaint);
    invalidate();
  });

  $effect(() => {
    void viz.selSeq;
    const i = viz.sceneSelectedIndex;
    const fly = viz.fly;
    selected = i;
    untrack(() => {
      applyEmphasis();
      repaint();
      if (i !== null && fly) {
        const { toPos, toTarget } = flyTarget(fnodes, adj, i, cam.position, controls.target, cam.fov, cam.aspect);
        gmotion.flyTo(cam.position, controls.target, toPos, toTarget);
        wake();
      }
    });
    invalidate();
  });

  $effect(() => {
    void viz.dark;
    void viz.paletteVersion;
    baseColors = nodes.map((n) => viz.colorOf(n.type));
    theme = viz.theme();
    untrack(() => {
      darkBg = isDarkBg(new THREE.Color(theme.bg));
      bloom.intensity = darkBg ? 1.95 : 0;
      lineMat.blending = darkBg ? THREE.AdditiveBlending : THREE.NormalBlending;
      lineMat.opacity = darkBg ? 0.7 : 1;
      lineMat.needsUpdate = true;
      repaint();
    });
    invalidate();
  });

  // Label textures: ONE eager effect owns every canvas texture. All inputs
  // are read before any work and the cleanup disposes what it made — the
  // Card.svelte rule; an intermediate $derived misses later invalidations.
  $effect(() => {
    void viz.dark;
    void viz.paletteVersion;
    const { labelInk, labelStroke } = viz.theme();
    const made = nodes.map((n) => makeLabelTexture(n.title, labelInk, labelStroke));
    labels.forEach((sp, i) => {
      const { tex, aspect } = made[i]!;
      sp.material.map = tex;
      sp.material.needsUpdate = true;
      const h = 7.5;
      sp.userData.base = { w: h * aspect, h };
    });
    untrack(() => {
      applyEmphasis();
      updateLabelVisibility();
    });
    invalidate();
    return () => {
      for (const m of made) m.tex.dispose();
    };
  });

  // Sizing + view shift: Threlte owns renderer.setSize; the composer, the
  // screen-space line width, and the projection offset (recentering content
  // in the strip clear of the sidebar/panel overlays) are ours. dpr rides
  // along so the composer's framebuffers track pixel-ratio changes.
  $effect(() => {
    const { width, height } = $size;
    void $dpr;
    if (!width || !height) return;
    const open = viz.sel.kind !== "none";
    shiftPx = viewOffsetX(SIDEBAR_W, open ? viz.panelPx(width) : 0);
    cam.aspect = width / height;
    if (shiftPx !== 0) cam.setViewOffset(width, height, shiftPx, 0, width, height);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    composer.setSize(width, height);
    lineMat.resolution.set(width, height);
    invalidate();
  });

  // Initial placement, once the canvas has a real size.
  $effect(() => {
    const { width, height } = $size;
    if (fitted || !width || !height) return;
    const { pos, target } = fitView(fnodes, cam.fov, width / height);
    cam.position.copy(pos);
    controls.target.copy(target);
    controls.update();
    fitted = true;
    invalidate();
  });

  /* --- pointer: hover / click-vs-drag (graph mode only) -------------------- */
  $effect(() => {
    if (viz.viewMode !== "graph") return;
    const el = renderer.domElement;
    const ray = new THREE.Raycaster();
    const v2 = new THREE.Vector2();
    const press = pressTracker();
    const pick = (e: PointerEvent): number | null => {
      const p = toNdc(e.clientX, e.clientY, el.getBoundingClientRect());
      ray.setFromCamera(v2.set(p.x, p.y), cam);
      const hit = ray.intersectObject(mesh, false)[0];
      return hit && hit.instanceId !== undefined && !dimmed(hit.instanceId) ? hit.instanceId : null;
    };
    const move = (e: PointerEvent) => {
      if (e.buttons) return;
      const i = pick(e);
      if (i !== hoverIdx) {
        hoverIdx = i;
        updateLabelVisibility();
        el.style.cursor = i === null ? "grab" : "pointer";
        invalidate();
      }
      if (i === null) {
        viz.hover = null;
        return;
      }
      const rect = el.getBoundingClientRect();
      viz.hover = { i, x: Math.min(e.clientX - rect.left + 14, rect.width - 330), y: e.clientY - rect.top + 14 };
    };
    // Grabbing the view cancels an in-flight fly-to instead of fighting it.
    const down = (e: PointerEvent) => {
      gmotion.cancelFly();
      press.down(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      if (!press.up(e.clientX, e.clientY)) return;
      const i = pick(e);
      if (i === null) viz.clearSelection();
      else viz.selectConcept(nodes[i]!.id, true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.style.cursor = "";
      hoverIdx = null;
      viz.hover = null;
    };
  });

  /* --- automation handle (the viz-e2e-graph.ts probe contract) ------------- */
  $effect(() => {
    const okf = (window as unknown as { __okf?: Record<string, unknown> }).__okf;
    if (!okf) return;
    okf.graph = {
      get active() {
        return viz.viewMode === "graph";
      },
      get renderPath() {
        return viz.viewMode === "graph" ? "composer" : "idle";
      },
      get camPos() {
        return { x: cam.position.x, y: cam.position.y, z: cam.position.z };
      },
      get target() {
        return { x: controls.target.x, y: controls.target.y, z: controls.target.z };
      },
      get selected() {
        return selected;
      },
      get darkBg() {
        return darkBg;
      },
      get bloomIntensity() {
        return bloom.intensity;
      },
      get visibleLabelCount() {
        return labels.filter((s) => s.visible).length;
      },
      get dimmedCount() {
        return nodes.reduce((k, _, i) => k + (dimmed(i) ? 1 : 0), 0);
      },
      get viewOffsetX() {
        return shiftPx;
      },
      get flying() {
        return !gmotion.settled;
      },
      get paused() {
        return viz.viewMode === "cards";
      },
      get frames() {
        return frames;
      },
      /** Node index -> client px (view offset included). */
      project: (i: number) => {
        const n = fnodes[i]!;
        const v = new THREE.Vector3(n.x, n.y, n.z).project(cam);
        const r = renderer.domElement.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
    };
    return () => {
      delete okf.graph;
    };
  });

  /* --- teardown (the disposal GraphScene never had) ------------------------ */
  $effect(() => {
    return () => {
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      composer.dispose();
      sphereGeo.dispose();
      sphereMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      for (const sp of labels) sp.material.dispose();
      mesh.dispose();
    };
  });

  // svelte-ignore state_referenced_locally -- fire-once startup mark, by design
  onSceneReady?.();
</script>

<T is={cam} makeDefault />
<T.Group visible={viz.viewMode === "graph"}>
  <T is={mesh} dispose={false} />
  <T is={lines} dispose={false} />
  <T is={labelGroup} dispose={false} />
</T.Group>
