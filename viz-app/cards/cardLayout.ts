// TheBrain-style card layout: the focused concept at the origin, cards that
// link INTO it in rows above, cards it links OUT to in rows below, second
// ring continuing the same direction (directional flow — a 2-hop neighbor
// connected against the flow gets no card). All arrows are downward elbows,
// so the whole picture reads as one top-to-bottom stream through the focus.
// Pure data -> geometry; rendering (Threlte) and reactivity live elsewhere.

import type { ConceptNode, VizModel } from "../data";
import { arrowHead, edgeSlot, elbowPath, type Head, type Pt } from "./elbow";

// World units ≈ CSS px at ortho zoom 1 (the camera auto-fits via fitZoom).
export const CARD_W = 180;
export const CARD_H = 64;
export const FOCUS_W = 230;
export const FOCUS_H = 96;
export const GAP_X = 28;
/** Row band centers by ring: [focus, ring 1, ring 2]. */
export const BAND_Y = [0, 180, 350] as const;
/** Extra rows of a wrapped band step outward by this much. */
export const SUB_GAP = 96;
export const ROW_CAP = 8;
export const MAX_PER_SIDE = 24;
export const FOCUS_Z = 6;
const HEAD_SIZE = 10;

export interface CardEntry {
  id: string;
  kind: "card" | "dir";
  twoWay: boolean;
}

export interface CardGraph {
  focusId: string;
  /** Synthetic root focus (bundle index.md) rather than a concept. */
  root: boolean;
  in1: CardEntry[];
  out1: CardEntry[];
  /** Ring-2 links in claim order; parent is always a ring-1 id. */
  in2: { parent: string; id: string }[];
  out2: { parent: string; id: string }[];
}

export interface CardPlacement {
  id: string;
  kind: "focus" | "card" | "dir" | "more";
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
  /** kind "more" only: how many cards the side cap hid. */
  overflow: number;
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

  const in2: { parent: string; id: string }[] = [];
  const out2: { parent: string; id: string }[] = [];
  if (depth === 2) {
    const placed = new Set([focusId, ...inIds, ...outIds]);
    // Parents in row order; a candidate reachable from two parents attaches
    // to the first (alphabetical) one that claims it.
    for (const p of in1)
      for (const id of (model.inLinks[p.id] ?? []).filter(ok).sort(cmp))
        if (!placed.has(id)) {
          placed.add(id);
          in2.push({ parent: p.id, id });
        }
    for (const p of out1)
      for (const id of model.edges
        .filter((e) => e.s === p.id && ok(e.t))
        .map((e) => e.t)
        .sort(cmp))
        if (!placed.has(id)) {
          placed.add(id);
          out2.push({ parent: p.id, id });
        }
  }
  return { focusId, root: false, in1, out1, in2, out2 };
}

/** The no-selection layout: a synthetic root card for the bundle's index.md,
 *  its links fanning out below (concept cards plus neutral dir cards; dirs
 *  are structural, so type filters never hide them). Authored link order is
 *  kept — it mirrors the document. Always one ring deep. */
export function rootCardGraph(model: VizModel, visible: (n: ConceptNode) => boolean): CardGraph | null {
  if (!model.root) return null;
  const out1: CardEntry[] = [];
  for (const l of model.root.links) {
    if (l.kind === "dir") out1.push({ id: l.path, kind: "dir", twoWay: false });
    else if (model.byId[l.id] && visible(model.byId[l.id]!)) out1.push({ id: l.id, kind: "card", twoWay: false });
  }
  return { focusId: "", root: true, in1: [], out1, in2: [], out2: [] };
}

/** Chunk one side's entries into centered rows stepping outward from the
 *  focus; hard-cap with a "+N more" chip so hub nodes can't melt the GPU. */
function placeSide(
  entries: CardEntry[],
  lane: "in" | "out",
  sign: 1 | -1,
  parentId: string,
  cards: CardPlacement[],
): CardPlacement[] {
  const kept = entries.slice(0, MAX_PER_SIDE);
  const overflow = entries.length - kept.length;
  const items: (CardEntry | { id: string; kind: "more"; twoWay: false })[] = [...kept];
  if (overflow > 0) items.push({ id: `__more:${lane}`, kind: "more", twoWay: false });

  const placed: CardPlacement[] = [];
  for (let r = 0; r * ROW_CAP < items.length; r++) {
    const row = items.slice(r * ROW_CAP, (r + 1) * ROW_CAP);
    const pitch = CARD_W + GAP_X;
    for (let i = 0; i < row.length; i++) {
      const e = row[i]!;
      placed.push({
        id: e.id,
        kind: e.kind,
        lane,
        ring: 1,
        x: (i - (row.length - 1) / 2) * pitch,
        y: sign * (BAND_Y[1] + r * SUB_GAP),
        z: 0,
        w: CARD_W,
        h: CARD_H,
        parentId: e.kind === "more" ? null : parentId,
        twoWay: e.twoWay,
        overflow: e.kind === "more" ? overflow : 0,
      });
    }
  }
  cards.push(...placed);
  return placed.filter((c) => c.kind !== "more");
}

/** Ring 2: one band further out, wrapped the same way. */
function placeRing2(
  links: { parent: string; id: string }[],
  lane: "in" | "out",
  sign: 1 | -1,
  cards: CardPlacement[],
): CardPlacement[] {
  const placed: CardPlacement[] = [];
  const pitch = CARD_W + GAP_X;
  for (let r = 0; r * ROW_CAP < links.length; r++) {
    const row = links.slice(r * ROW_CAP, (r + 1) * ROW_CAP);
    for (let i = 0; i < row.length; i++) {
      const l = row[i]!;
      placed.push({
        id: l.id,
        kind: "card",
        lane,
        ring: 2,
        x: (i - (row.length - 1) / 2) * pitch,
        y: sign * (BAND_Y[2] + r * SUB_GAP),
        z: 0,
        w: CARD_W,
        h: CARD_H,
        parentId: l.parent,
        twoWay: false,
        overflow: 0,
      });
    }
  }
  cards.push(...placed);
  return placed;
}

export function layoutCards(g: CardGraph): CardLayout {
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
    overflow: 0,
  };
  cards.push(focus);

  const inPlaced = placeSide(g.in1, "in", 1, g.focusId, cards);
  const outPlaced = placeSide(g.out1, "out", -1, g.focusId, cards);
  const in2Placed = placeRing2(g.in2, "in", 1, cards);
  const out2Placed = placeRing2(g.out2, "out", -1, cards);
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));

  // Ring 1 in: card bottom-center down to its own slot on the focus top edge.
  inPlaced.forEach((c, i) => {
    const path = elbowPath({ x: c.x, y: c.y - c.h / 2 }, edgeSlot(0, FOCUS_H / 2, FOCUS_W, i, inPlaced.length));
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
  // Ring 1 out: focus bottom-edge slot down to the card top-center.
  outPlaced.forEach((c, i) => {
    const path = elbowPath(edgeSlot(0, -FOCUS_H / 2, FOCUS_W, i, outPlaced.length), { x: c.x, y: c.y + c.h / 2 });
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
        const slot =
          dir === "in"
            ? edgeSlot(p.x, p.y + p.h / 2, p.w, i, kids.length)
            : edgeSlot(p.x, p.y - p.h / 2, p.w, i, kids.length);
        const path =
          dir === "in"
            ? elbowPath({ x: c.x, y: c.y - c.h / 2 }, slot)
            : elbowPath(slot, { x: c.x, y: c.y + c.h / 2 });
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

/** Ortho zoom fitting the layout's symmetric envelope (origin-centered, so
 *  the focus card stays centered) into the viewport; never zooms past 1. */
export function fitZoom(
  b: CardLayout["bounds"],
  vw: number,
  vh: number,
  pad = 0.85,
): number {
  const w = 2 * Math.max(Math.abs(b.minX), Math.abs(b.maxX));
  const h = 2 * Math.max(Math.abs(b.minY), Math.abs(b.maxY));
  if (!(w > 0) || !(h > 0)) return 1;
  return Math.min(1, pad * Math.min(vw / w, vh / h));
}
