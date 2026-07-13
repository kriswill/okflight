// Stage chrome tests: panel geometry, theme-toggle placement, and the GL
// injection seam. The GL stage itself is a DOM-only stub here (bun test
// must never resolve @threlte/core); the scene wiring that used to be
// asserted through a recording SceneApi stub now lives in the pure-module
// unit tests (graph/*.test.ts, gl/*.test.ts) and the e2e parity contract
// (viz-e2e-graph.ts).
import { afterEach, describe, expect, test } from "bun:test";
import { flushSync, mount, unmount } from "svelte";
import { buildModel } from "./data";
import GLStub from "./GLStub.svelte";
import Stage from "./Stage.svelte";
import { createVizState } from "./state.svelte";
import { node } from "./test-helpers";

const model = () =>
  buildModel({
    nodes: [node("a", "Decision", "Alpha"), node("b", "Pattern", "Beta")],
    edges: [{ s: "a", t: "b" }],
    files: { "f.ts": { html: "", lines: 1, size: 1, date: "", lang: "ts", refs: [] } },
  });

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

function mountStage(state = createVizState(model()), gl: typeof GLStub | null = GLStub) {
  const app = mount(Stage, {
    target: document.body,
    props: gl ? { viz: state, gl } : { viz: state },
  });
  cleanup = () => unmount(app);
  flushSync();
  return { state };
}

describe("Stage chrome", () => {
  test("panel width follows open/close, setPanelW, and window-resize re-clamp", () => {
    const { state } = mountStage();
    const stage = document.getElementById("stage")!;
    Object.defineProperty(stage, "clientWidth", { value: 1000, configurable: true });
    expect(document.getElementById("panel")).toBeNull();
    state.selectConcept("a");
    flushSync();
    // default: min(460, 85% of stage)
    expect((document.getElementById("panel") as HTMLElement).style.width).toBe("460px");
    state.setPanelW(555);
    flushSync();
    expect((document.getElementById("panel") as HTMLElement).style.width).toBe("555px");
    Object.defineProperty(stage, "clientWidth", { value: 400, configurable: true });
    window.dispatchEvent(new Event("resize"));
    flushSync();
    expect((document.getElementById("panel") as HTMLElement).style.width).toBe("368px"); // min(555, 92% of 400)
    state.clearSelection();
    flushSync();
    expect(document.getElementById("panel")).toBeNull();
  });

  test("theme toggle button hugs the panel's left edge when open", () => {
    const { state } = mountStage();
    const stage = document.getElementById("stage")!;
    Object.defineProperty(stage, "clientWidth", { value: 1000, configurable: true });
    const btn = document.getElementById("theme-toggle") as HTMLButtonElement;
    expect(btn.style.right).toBe("16px");
    state.selectConcept("a");
    flushSync();
    expect(btn.style.right).toBe("476px"); // default panel width (460) + 16
    state.clearSelection();
    flushSync();
    expect(btn.style.right).toBe("16px");
  });
});

describe("GL injection seam", () => {
  test("the injected GL stage mounts once and stays mounted across view flips", () => {
    const { state } = mountStage();
    const stub = () => document.querySelector("[data-testid=gl-stub]");
    expect(stub()).not.toBeNull();
    expect(stub()!.textContent).toBe("graph");
    state.setViewMode("cards");
    flushSync();
    // The GL stage owns mode switching internally — Stage never remounts it.
    expect(stub()!.textContent).toBe("cards");
    state.setViewMode("graph");
    flushSync();
    expect(stub()!.textContent).toBe("graph");
  });

  test("without a gl component, Stage renders chrome only and never throws", () => {
    const { state } = mountStage(createVizState(model()), null);
    expect(document.querySelector("[data-testid=gl-stub]")).toBeNull();
    expect(document.getElementById("gl-host")).toBeNull();
    state.setViewMode("cards");
    flushSync();
    expect(document.getElementById("stage")).not.toBeNull();
  });
});
