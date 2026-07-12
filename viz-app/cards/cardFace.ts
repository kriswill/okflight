// Canvas-texture card faces: the whole face (rounded rect, border, title,
// description) drawn in 2D and mapped onto the card's front plane — the same
// approach as scene.ts' sprite labels, so no SDF/troika dependency and crisp
// text under the orthographic camera. e2e-verified only: happy-dom has no
// real 2D text metrics.
import * as THREE from "three";
import { wrapLines } from "./cardText";

/** Readable ink for a #rrggbb background by WCAG relative luminance. */
export function inkFor(hex: string): string {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.45 ? "#16181d" : "#f6f7f9";
}

export interface CardFaceOpts {
  title: string;
  /** Extra lines under the title (focus card only); "" skips. */
  desc: string;
  /** Card background — the type color (or the neutral for dir/root/more). */
  bg: string;
  w: number;
  h: number;
  /** Texture pixels per world unit (device pixel ratio, clamped). */
  dpr: number;
  /** Dimmed style for "+N more" chips. */
  muted?: boolean;
}

export function makeCardFace(o: CardFaceOpts): THREE.CanvasTexture {
  const s = 2 * o.dpr; // supersample: 2 texture px per world px per dpr
  const W = Math.round(o.w * s);
  const H = Math.round(o.h * s);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const ink = inkFor(o.bg);
  const r = 10 * s;

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
