// Graph label helpers: degree ranking/adjacency and the visibility rule are
// pure and unit-tested; makeLabelTexture draws to a 2D canvas and is
// e2e-verified only (happy-dom has no real 2D text metrics).
import * as THREE from "three";

/** Only the busiest nodes get a resident label; hover/selection add theirs. */
export const MAX_LABELS = 28;

export function adjacency(count: number, edges: [number, number][]): Set<number>[] {
  const adj = Array.from({ length: count }, () => new Set<number>());
  for (const [a, b] of edges) {
    adj[a]!.add(b);
    adj[b]!.add(a);
  }
  return adj;
}

/** Node indices sorted busiest-first. */
export function rankByDegree(count: number, edges: [number, number][]): number[] {
  const deg = new Array<number>(count).fill(0);
  for (const [a, b] of edges) {
    deg[a]!++;
    deg[b]!++;
  }
  return Array.from({ length: count }, (_, i) => i).sort((a, b) => deg[b]! - deg[a]!);
}

export function labelVisible(
  i: number,
  o: { dimmed: boolean; top: ReadonlySet<number>; selected: number | null; hover: number | null; isNeighbor: boolean },
): boolean {
  return !o.dimmed && (o.top.has(i) || i === o.selected || i === o.hover || o.isNeighbor);
}

export function makeLabelTexture(text: string, ink: string, stroke: string): { tex: THREE.CanvasTexture; aspect: number } {
  const font = `600 44px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d")!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  cv.width = w;
  cv.height = 64;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.lineWidth = 7;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, 12, 34);
  ctx.fillStyle = ink;
  ctx.fillText(text, 12, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / 64 };
}
