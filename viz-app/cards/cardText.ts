// Word wrap for card faces, measure-function-injected so tests run without
// canvas metrics (happy-dom has none) and the renderer can pass the real
// 2D-context measureText.

/** Greedy word wrap into at most `maxLines` lines of `maxWidth` (by
 *  `measure`); over-long words hard-break, overflow ellipsizes the last
 *  line. Whitespace-only input yields no lines. */
export function wrapLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length || maxLines <= 0) return [];
  const lines: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur) lines.push(cur);
    cur = "";
  };
  for (let w of words) {
    // A word that can never fit on a line of its own breaks mid-word.
    while (measure(w) > maxWidth) {
      flush();
      let cut = 1;
      while (cut < w.length && measure(w.slice(0, cut + 1)) <= maxWidth) cut++;
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    if (!w) continue;
    const joined = cur ? cur + " " + w : w;
    if (measure(joined) <= maxWidth) cur = joined;
    else {
      flush();
      cur = w;
    }
  }
  flush();
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (last && measure(last + "…") > maxWidth) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = last + "…";
  return kept;
}
