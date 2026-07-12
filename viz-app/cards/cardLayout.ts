// TheBrain-style card layout: the focused concept at the origin, cards that
// link INTO it on one scrollable band before it, cards it links OUT to on a
// band after it, ring-2 clusters anchored to their ring-1 parent (they track
// it under scroll). Directional flow — a 2-hop neighbor connected against
// the flow gets no card; arrows always run in-to-out through the focus.
// Pure data -> geometry; rendering (Threlte) and reactivity live elsewhere.

import type { ConceptNode, VizModel } from "../data";
import { arrowHead, edgeSlot, elbowPath, sideSlot, type Head, type Pt } from "./elbow";

// World units ≈ CSS px at ortho zoom 1 (the camera auto-fits via fitZoom).
export const CARD_W = 180;
export const CARD_H = 64;
export const FOCUS_W = 230;
export const FOCUS_H = 96;
// Wide enough that dome tilt foreshortening never makes neighbors read as
// touching (28 looked cramped once cards curled onto the sphere).
export const GAP_X = 52;
/** Row band centers by ring: [focus, ring 1, ring 2] (vertical flow). */
export const BAND_Y = [0, 180, 350] as const;

/** Horizontal flow (in-links left, out-links right): column band centers by
 *  ring and the vertical gap inside a column. */
export const BAND_X = [0, 320, 620] as const;
export const GAP_Y = 28;

/** Card flow orientation: "v" = TheBrain top-down (default), "h" = left-to-right. */
export type CardFlow = "v" | "h";
export const FOCUS_Z = 6;
const HEAD_SIZE = 10;

export interface CardEntry {
  id: string;
  /** "dir" = a sub-bundle's index.md; "root" = the KB-root index card. */
  kind: "card" | "dir" | "root";
  twoWay: boolean;
}

/** Ring-2 link in claim order; parent is always a ring-1 id. */
export interface Ring2Link {
  parent: string;
  id: string;
  kind: "card" | "dir" | "root";
}

export interface CardGraph {
  focusId: string;
  /** Synthetic root focus (bundle index.md) rather than a concept. */
  root: boolean;
  in1: CardEntry[];
  out1: CardEntry[];
  in2: Ring2Link[];
  out2: Ring2Link[];
}

export interface CardPlacement {
  id: string;
  kind: "focus" | "card" | "dir" | "root";
  lane: "focus" | "in" | "out";
  ring: 0 | 1 | 2;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  /** Arrow anchor: focus id for ring 1, the ring-1 parent for ring 2. */
  parentId: string | null;
  twoWay: boolean;
}

export interface ArrowSpec {
  fromId: string;
  toId: string;
  dir: "in" | "out";
  twoWay: boolean;
  path: Pt[];
  head: Head;
  /** Second head at the path start for mutual links. */
  tailHead: Head | null;
}

export interface CardLayout {
  focusId: string;
  rootFocus: boolean;
  cards: CardPlacement[];
  arrows: ArrowSpec[];
  byId: Record<string, CardPlacement>;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

const byTitle = (m: VizModel) => (a: string, b: string) => {
  const na = m.byId[a]!;
  const nb = m.byId[b]!;
  return na.title.localeCompare(nb.title) || a.localeCompare(b);
};

/** Classify the focus concept's neighborhood into directional rings. */
export function cardGraph(
  model: VizModel,
  focusId: string,
  depth: 1 | 2,
  visible: (n: ConceptNode) => boolean,
): CardGraph | null {
  if (!model.byId[focusId]) return null;
  const ok = (id: string) => !!model.byId[id] && visible(model.byId[id]!);
  const cmp = byTitle(model);

  const inIds = (model.inLinks[focusId] ?? []).filter(ok).sort(cmp);
  const outAll = new Set(model.edges.filter((e) => e.s === focusId && ok(e.t)).map((e) => e.t));
  const inSet = new Set(inIds);
  const outIds = [...outAll].filter((id) => !inSet.has(id)).sort(cmp);

  const in1 = inIds.map((id) => ({ id, kind: "card" as const, twoWay: outAll.has(id) }));
  const out1 = outIds.map((id) => ({ id, kind: "card" as const, twoWay: false }));

  const in2: Ring2Link[] = [];
  const out2: Ring2Link[] = [];
  if (depth === 2) {
    const placed = new Set([focusId, ...inIds, ...outIds]);
    // Parents in row order; a candidate reachable from two parents attaches
    // to the first (alphabetical) one that claims it.
    for (const p of in1)
      for (const id of (model.inLinks[p.id] ?? []).filter(ok).sort(cmp))
        if (!placed.has(id)) {
          placed.add(id);
          in2.push({ parent: p.id, id, kind: "card" });
        }
    for (const p of out1)
      for (const c of childLinks(model, p, visible))
        if (!placed.has(c.id)) {
          placed.add(c.id);
          out2.push({ parent: p.id, ...c });
        }
  }
  return { focusId, root: false, in1, out1, in2, out2 };
}

/** One entry's onward links, continuing the out-flow: a concept card's
 *  out-links (title-sorted, like cardGraph), a dir card's bundle-index links
 *  (authored order — mirrors the document); root entries never expand. */
function childLinks(
  model: VizModel,
  e: CardEntry,
  visible: (n: ConceptNode) => boolean,
): { id: string; kind: "card" | "dir" }[] {
  const ok = (id: string) => !!model.byId[id] && visible(model.byId[id]!);
  if (e.kind === "card")
    return [...new Set(model.edges.filter((x) => x.s === e.id && ok(x.t)).map((x) => x.t))]
      .sort(byTitle(model))
      .map((id) => ({ id, kind: "card" as const }));
  if (e.kind === "dir")
    return (model.bundles[e.id]?.links ?? []).flatMap((l): { id: string; kind: "card" | "dir" }[] =>
      l.kind === "concept"
        ? ok(l.id)
          ? [{ id: l.id, kind: "card" }]
          : []
        : [{ id: l.path, kind: "dir" }],
    );
  return [];
}

/** The no-selection layout: a synthetic root card for the bundle's index.md,
 *  its links fanning out below (concept cards plus dir cards for sub-bundle
 *  indexes; dirs are structural, so type filters never hide them). Authored
 *  link order is kept — it mirrors the document. Depth 2 continues the flow:
 *  concepts expand their out-links, dirs their bundle's index links. */
export function rootCardGraph(
  model: VizModel,
  visible: (n: ConceptNode) => boolean,
  depth: 1 | 2 = 1,
): CardGraph | null {
  if (!model.root) return null;
  const out1: CardEntry[] = [];
  for (const l of model.root.links) {
    if (l.kind === "dir") out1.push({ id: l.path, kind: "dir", twoWay: false });
    else if (model.byId[l.id] && visible(model.byId[l.id]!)) out1.push({ id: l.id, kind: "card", twoWay: false });
  }
  const out2: Ring2Link[] = [];
  if (depth === 2) {
    const placed = new Set(["", ...out1.map((e) => e.id)]);
    for (const e of out1)
      for (const c of childLinks(model, e, visible))
        if (!placed.has(c.id)) {
          placed.add(c.id);
          out2.push({ parent: e.id, ...c });
        }
  }
  return { focusId: "", root: true, in1: [], out1, in2: [], out2 };
}

/** Focus a dir card: the bundle's index.md centered, its parent index above
 *  (the root card, or the enclosing bundle for nested dirs), its authored
 *  links below — the navigable analogue of rootCardGraph. Depth 2 keeps
 *  chaining in both directions: ancestor indexes up, entries' own links down. */
export function bundleCardGraph(
  model: VizModel,
  path: string,
  depth: 1 | 2,
  visible: (n: ConceptNode) => boolean,
): CardGraph | null {
  const doc = model.bundles[path];
  if (!doc) return null;
  const ok = (id: string) => !!model.byId[id] && visible(model.byId[id]!);
  // Nearest ancestor with an embedded index: an enclosing bundle, else the
  // KB root (null when no root index is embedded).
  const parentOf = (p: string): CardEntry | null => {
    let up = p;
    while (up.includes("/")) {
      up = up.slice(0, up.lastIndexOf("/"));
      if (model.bundles[up]) return { id: up, kind: "dir", twoWay: false };
    }
    return model.root ? { id: "", kind: "root", twoWay: false } : null;
  };

  const parent = parentOf(path);
  const in1 = parent ? [parent] : [];
  const placed = new Set([path, ...in1.map((e) => e.id)]);
  const out1: CardEntry[] = [];
  for (const l of doc.links) {
    const e: CardEntry | null =
      l.kind === "dir"
        ? { id: l.path, kind: "dir", twoWay: false }
        : ok(l.id)
          ? { id: l.id, kind: "card", twoWay: false }
          : null;
    if (!e || placed.has(e.id)) continue;
    placed.add(e.id);
    out1.push(e);
  }
  const in2: Ring2Link[] = [];
  const out2: Ring2Link[] = [];
  if (depth === 2) {
    if (parent?.kind === "dir") {
      const gp = parentOf(parent.id);
      if (gp && !placed.has(gp.id)) {
        placed.add(gp.id);
        in2.push({ parent: parent.id, id: gp.id, kind: gp.kind });
      }
    }
    for (const e of out1)
      for (const c of childLinks(model, e, visible))
        if (!placed.has(c.id)) {
          placed.add(c.id);
          out2.push({ parent: e.id, ...c });
        }
  }
  return { focusId: path, root: false, in1, out1, in2, out2 };
}

/** One side's ring-1 entries as a SINGLE centered band — never a grid,
 *  never a cap: long bands are explored by scrolling, with cards fading at
 *  the window edge. */
function placeSide(
  entries: CardEntry[],
  lane: "in" | "out",
  parentId: string,
  cards: CardPlacement[],
  flow: CardFlow,
): CardPlacement[] {
  const placed: CardPlacement[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    placed.push({
      id: e.id,
      kind: e.kind,
      lane,
      ring: 1,
      ...bandCoords(flow, lane, 1, i, entries.length, 0),
      z: 0,
      w: CARD_W,
      h: CARD_H,
      parentId,
      twoWay: e.twoWay,
    });
  }
  cards.push(...placed);
  return placed;
}

/** Position within a band: centered spread along the band axis at the
 *  ring's cross offset, plus an optional band-axis anchor (ring-2 clusters
 *  center on their parent so they track it under scroll). */
function bandCoords(
  flow: CardFlow,
  lane: "in" | "out",
  ring: 1 | 2,
  i: number,
  len: number,
  anchor: number,
): { x: number; y: number } {
  if (flow === "v") {
    const sign = lane === "in" ? 1 : -1;
    return { x: anchor + (i - (len - 1) / 2) * (CARD_W + GAP_X), y: sign * BAND_Y[ring] };
  }
  const sign = lane === "in" ? -1 : 1;
  return { x: sign * BAND_X[ring], y: anchor + ((len - 1) / 2 - i) * (CARD_H + GAP_Y) };
}

/** Optimal 1D de-overlap along the band axis: place the cards to minimize
 *  total squared displacement from their anchored (parent-centered)
 *  positions subject to a minimum pitch between neighbors. Substituting
 *  y_i = x_i − i·pitch turns the gap constraint into monotonicity, so the
 *  optimum is isotonic regression (pool-adjacent-violators). Colliding
 *  clusters share the displacement symmetrically — each merged block keeps
 *  its anchors' mean — and anything clear of the crowd (extremities
 *  included) stays exactly on its parent, unlike a greedy rightward sweep
 *  with a global re-center. */
function spreadAlongBand(placed: CardPlacement[], flow: CardFlow, pitch: number) {
  if (placed.length < 2) return;
  const get = (c: CardPlacement) => (flow === "v" ? c.x : c.y);
  const set = (c: CardPlacement, v: number) => (flow === "v" ? (c.x = v) : (c.y = v));
  const sorted = [...placed].sort((a, b) => get(a) - get(b));
  const blocks: { sum: number; n: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let cur = { sum: get(sorted[i]!) - i * pitch, n: 1 };
    while (blocks.length) {
      const prev = blocks[blocks.length - 1]!;
      if (prev.sum / prev.n < cur.sum / cur.n) break;
      blocks.pop();
      cur = { sum: prev.sum + cur.sum, n: prev.n + cur.n };
    }
    blocks.push(cur);
  }
  let i = 0;
  for (const b of blocks) {
    const mean = b.sum / b.n;
    for (let k = 0; k < b.n; k++, i++) set(sorted[i]!, mean + i * pitch);
  }
}

/** Ring 2: per-parent clusters on the outer band, centered on the parent's
 *  band position so grandparents/grandchildren track their parent as the
 *  side scrolls; a de-overlap sweep keeps neighboring clusters apart. */
function placeRing2(
  links: Ring2Link[],
  lane: "in" | "out",
  ring1: CardPlacement[],
  cards: CardPlacement[],
  flow: CardFlow,
): CardPlacement[] {
  const placed: CardPlacement[] = [];
  const byParent = new Map<string, Ring2Link[]>();
  for (const l of links) (byParent.get(l.parent) ?? byParent.set(l.parent, []).get(l.parent)!).push(l);
  for (const [parentId, kids] of byParent) {
    const parent = ring1.find((c) => c.id === parentId);
    if (!parent) continue;
    const anchor = flow === "v" ? parent.x : parent.y;
    kids.forEach((kid, i) => {
      placed.push({
        id: kid.id,
        kind: kid.kind,
        lane,
        ring: 2,
        ...bandCoords(flow, lane, 2, i, kids.length, anchor),
        z: 0,
        w: CARD_W,
        h: CARD_H,
        parentId,
        twoWay: false,
      });
    });
  }
  spreadAlongBand(placed, flow, flow === "v" ? CARD_W + GAP_X : CARD_H + GAP_Y);
  cards.push(...placed);
  return placed;
}

export function layoutCards(g: CardGraph, opts?: { flow?: CardFlow }): CardLayout {
  const flow = opts?.flow ?? "v";
  const cards: CardPlacement[] = [];
  const arrows: ArrowSpec[] = [];

  const focus: CardPlacement = {
    id: g.focusId,
    kind: "focus",
    lane: "focus",
    ring: 0,
    x: 0,
    y: 0,
    z: FOCUS_Z,
    w: FOCUS_W,
    h: FOCUS_H,
    parentId: null,
    twoWay: false,
  };
  cards.push(focus);

  const inPlaced = placeSide(g.in1, "in", g.focusId, cards, flow);
  const outPlaced = placeSide(g.out1, "out", g.focusId, cards, flow);
  const in2Placed = placeRing2(g.in2, "in", inPlaced, cards, flow);
  const out2Placed = placeRing2(g.out2, "out", outPlaced, cards, flow);
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));

  // Ring 1 in: card exit-edge center to its own slot on the focus entry
  // edge (bottom->top for vertical flow, right->left-edge for horizontal;
  // horizontal slot order is reversed so the top card takes the top slot).
  inPlaced.forEach((c, i) => {
    const n = inPlaced.length;
    const path =
      flow === "v"
        ? elbowPath({ x: c.x, y: c.y - c.h / 2 }, edgeSlot(0, FOCUS_H / 2, FOCUS_W, i, n))
        : elbowPath({ x: c.x + c.w / 2, y: c.y }, sideSlot(0, -FOCUS_W / 2, FOCUS_H, n - 1 - i, n), { axis: "x" });
    arrows.push({
      fromId: c.id,
      toId: g.focusId,
      dir: "in",
      twoWay: c.twoWay,
      path,
      head: arrowHead(path, HEAD_SIZE),
      tailHead: c.twoWay ? arrowHead(path, HEAD_SIZE, true) : null,
    });
  });
  // Ring 1 out: focus exit-edge slot to the card entry-edge center.
  outPlaced.forEach((c, i) => {
    const n = outPlaced.length;
    const path =
      flow === "v"
        ? elbowPath(edgeSlot(0, -FOCUS_H / 2, FOCUS_W, i, n), { x: c.x, y: c.y + c.h / 2 })
        : elbowPath(sideSlot(0, FOCUS_W / 2, FOCUS_H, n - 1 - i, n), { x: c.x - c.w / 2, y: c.y }, { axis: "x" });
    arrows.push({
      fromId: g.focusId,
      toId: c.id,
      dir: "out",
      twoWay: false,
      path,
      head: arrowHead(path, HEAD_SIZE),
      tailHead: null,
    });
  });
  // Ring 2 arrows attach to the parent card's outer edge, slot per sibling.
  const bySide = [
    { placed: in2Placed, dir: "in" as const },
    { placed: out2Placed, dir: "out" as const },
  ];
  for (const { placed, dir } of bySide) {
    const siblings = new Map<string, CardPlacement[]>();
    for (const c of placed) (siblings.get(c.parentId!) ?? siblings.set(c.parentId!, []).get(c.parentId!)!).push(c);
    for (const [parentId, kids] of siblings) {
      const p = byId[parentId]!;
      kids.forEach((c, i) => {
        const n = kids.length;
        let path;
        if (flow === "v") {
          const slot =
            dir === "in" ? edgeSlot(p.x, p.y + p.h / 2, p.w, i, n) : edgeSlot(p.x, p.y - p.h / 2, p.w, i, n);
          path =
            dir === "in"
              ? elbowPath({ x: c.x, y: c.y - c.h / 2 }, slot)
              : elbowPath(slot, { x: c.x, y: c.y + c.h / 2 });
        } else {
          const slot =
            dir === "in"
              ? sideSlot(p.y, p.x - p.w / 2, p.h, n - 1 - i, n)
              : sideSlot(p.y, p.x + p.w / 2, p.h, n - 1 - i, n);
          path =
            dir === "in"
              ? elbowPath({ x: c.x + c.w / 2, y: c.y }, slot, { axis: "x" })
              : elbowPath(slot, { x: c.x - c.w / 2, y: c.y }, { axis: "x" });
        }
        arrows.push({
          fromId: dir === "in" ? c.id : parentId,
          toId: dir === "in" ? parentId : c.id,
          dir,
          twoWay: false,
          path,
          head: arrowHead(path, HEAD_SIZE),
          tailHead: null,
        });
      });
    }
  }

  const bounds = {
    minX: Math.min(...cards.map((c) => c.x - c.w / 2)),
    maxX: Math.max(...cards.map((c) => c.x + c.w / 2)),
    minY: Math.min(...cards.map((c) => c.y - c.h / 2)),
    maxY: Math.max(...cards.map((c) => c.y + c.h / 2)),
  };
  return { focusId: g.focusId, rootFocus: g.root, cards, arrows, byId, bounds };
}

/** Card scale never drops below this: readable cards beat fitting every
 *  last band card on screen (long bands are explored by scrolling). */
export const ZOOM_MIN = 0.6;

export interface FitView {
  zoom: number;
  /** World cross-axis center of the occupied extent — where the camera
   *  should look. 0 keeps the focus centered; a one-sided layout (a node
   *  with links in only one direction) shifts it toward the occupied side
   *  so the visualization balances instead of leaving half the stage empty. */
  cross: number;
}

/** Fit the layout's CROSS-axis extent (ring count) into the viewport;
 *  zoom clamped to [ZOOM_MIN, 1]. The band axis never participates — it is
 *  scrollable, so a longer band must not shrink the cards: the focus keeps
 *  its scale and off-window cards fade behind the overflow indicators. */
export function fitView(
  b: CardLayout["bounds"],
  vw: number,
  vh: number,
  flow: CardFlow = "v",
  pad = 0.85,
): FitView {
  const [lo, hi] = flow === "v" ? [b.minY, b.maxY] : [b.minX, b.maxX];
  const extent = hi - lo;
  const avail = flow === "v" ? vh : vw;
  if (!(extent > 0)) return { zoom: 1, cross: 0 };
  return {
    zoom: Math.min(1, Math.max(ZOOM_MIN, (pad * avail) / extent)),
    cross: (lo + hi) / 2,
  };
}
