// Stand-in for `katex` when display.math is off: viz.ts's build plugin
// aliases the import here so no KaTeX code reaches the page. markdown.ts
// never calls it in that mode; the throw guards against a future path that
// does.
export default {
  renderToString(): string {
    throw new Error("katex is not bundled — display.math is off");
  },
};
