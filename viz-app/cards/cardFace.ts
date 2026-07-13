// Canvas-texture card faces: the whole face (rounded rect, border, title,
// description) drawn in 2D and mapped onto the card's front plane — the same
// approach as the graph's sprite labels (graph/labels.ts), so no SDF/troika
// dependency and crisp text under the orthographic camera. e2e-verified
// only: happy-dom has no real 2D text metrics.
import * as THREE from "three";
import { relLuminance } from "../color";
import { wrapLines } from "./cardText";

/** Readable ink for a #rrggbb background by WCAG relative luminance. */
export function inkFor(hex: string): string {
  return relLuminance(hex) > 0.45 ? "#16181d" : "#f6f7f9";
}

export interface CardFaceOpts {
  title: string;
  /** Extra lines under the title (focus card only); "" skips. */
  desc: string;
  /** Card background — the type color (or the neutral for dir/root/more).
   *  Outline faces use it as the border color instead. */
  bg: string;
  w: number;
  h: number;
  /** Texture pixels per world unit (device pixel ratio, clamped). */
  dpr: number;
  /** Dimmed style for "+N more" chips. */
  muted?: boolean;
  /** Structural (dir/root) card: transparent body, `bg`-colored border,
   *  text in `ink` — reads as a waypoint, not a document. */
  outline?: boolean;
  /** Text color for outline faces (the page ink; solid faces derive theirs
   *  from `bg` contrast). */
  ink?: string;
}

export interface ChipFaceOpts {
  /** Cards hidden past this band edge. */
  count: number;
  /** Pointing direction of the triangle, radians (0 = +x, canvas y-down). */
  angle: number;
  bg: string;
  ink: string;
  w: number;
  h: number;
  dpr: number;
}

/** Overflow indicator face: a neutral pill with a direction triangle and
 *  the hidden-card count — "more cards live past this edge of the window". */
export function makeChipFace(o: ChipFaceOpts): THREE.CanvasTexture {
  const s = 2 * o.dpr;
  const W = Math.round(o.w * s);
  const H = Math.round(o.h * s);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  ctx.beginPath();
  ctx.roundRect(1, 1, W - 2, H - 2, H / 2);
  ctx.fillStyle = o.bg;
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = o.ink;
  ctx.lineWidth = Math.max(1, s * 0.6);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const label = String(o.count);
  ctx.fillStyle = o.ink;
  ctx.font = `600 ${Math.round(13 * s)}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const textW = ctx.measureText(label).width;
  const gap = 5 * s;
  const triR = 4.5 * s;
  const groupW = triR * 1.8 + gap + textW;
  const triX = W / 2 - groupW / 2 + triR * 0.9;
  const textX = W / 2 + groupW / 2 - textW / 2;
  ctx.fillText(label, textX, H / 2 + s);

  // Triangle pointing along `angle`, centered at (triX, H/2).
  const pts: [number, number][] = [
    [triR, 0],
    [-triR * 0.8, triR * 0.9],
    [-triR * 0.8, -triR * 0.9],
  ];
  ctx.beginPath();
  pts.forEach(([px, py], i) => {
    const x = triX + px * Math.cos(o.angle) - py * Math.sin(o.angle);
    const y = H / 2 + px * Math.sin(o.angle) + py * Math.cos(o.angle);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function makeCardFace(o: CardFaceOpts): THREE.CanvasTexture {
  const s = 2 * o.dpr; // supersample: 2 texture px per world px per dpr
  const W = Math.round(o.w * s);
  const H = Math.round(o.h * s);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const ink = o.outline ? (o.ink ?? inkFor(o.bg)) : inkFor(o.bg);
  const r = 10 * s;

  if (o.outline) {
    // Transparent body (the canvas stays clear) with a faint tint so the
    // border color registers as the card's identity at a glance.
    const lw = 2 * s;
    ctx.beginPath();
    ctx.roundRect(lw / 2 + 1, lw / 2 + 1, W - lw - 2, H - lw - 2, r - lw / 2);
    ctx.fillStyle = o.bg;
    ctx.globalAlpha = 0.08;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = o.bg;
    ctx.lineWidth = lw;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.roundRect(1, 1, W - 2, H - 2, r);
    ctx.fillStyle = o.bg;
    ctx.globalAlpha = o.muted ? 0.55 : 1;
    ctx.fill();
    // Hairline border a step toward the ink color keeps edges defined where
    // neighboring cards share a hue.
    ctx.globalAlpha = o.muted ? 0.4 : 0.55;
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, s * 0.75);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const padX = 12 * s;
  const maxW = W - padX * 2;
  const font = (px: number, weight: number) =>
    (ctx.font = `${weight} ${Math.round(px * s)}px ui-sans-serif, system-ui, -apple-system, sans-serif`);
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  font(15, 600);
  const titleLines = wrapLines(o.title, maxW, (t) => ctx.measureText(t).width, 2);
  font(12, 400);
  const descLines = o.desc ? wrapLines(o.desc, maxW, (t) => ctx.measureText(t).width, 2) : [];

  const titleLh = 19 * s;
  const descLh = 15 * s;
  const block = titleLines.length * titleLh + descLines.length * descLh + (descLines.length ? 4 * s : 0);
  let y = (H - block) / 2 + titleLh / 2;
  font(15, 600);
  for (const line of titleLines) {
    ctx.fillText(line, W / 2, y);
    y += titleLh;
  }
  if (descLines.length) {
    y += 4 * s - (titleLh - descLh) / 2;
    font(12, 400);
    ctx.globalAlpha = 0.75;
    for (const line of descLines) {
      ctx.fillText(line, W / 2, y);
      y += descLh;
    }
    ctx.globalAlpha = 1;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
