import { describe, expect, test } from "bun:test";
import { decodeHash, decodeViewHash, encodeHash, encodeViewHash } from "./hash";

const model = {
  byId: { "wiki/architecture": {} },
  files: { "flakes/okf/viz.ts": {}, "docs/50%.md": {}, "docs/what?.md": {} },
  dirs: { "flakes/ccglass": {} },
  bundles: { notes: {} },
  typeCounts: { "Alpha Module": 2, Decision: 1 },
  facets: [
    { name: "platform", values: ["macos", "linux"] },
    { name: "status", values: ["draft", "stable"] },
  ],
};

describe("encodeHash", () => {
  test("concept / file / dir / none", () => {
    expect(encodeHash({ kind: "concept", id: "wiki/architecture" })).toBe("c/wiki/architecture");
    expect(encodeHash({ kind: "file", path: "flakes/okf/viz.ts" })).toBe("f/flakes/okf/viz.ts");
    expect(encodeHash({ kind: "dir", path: "flakes/ccglass" })).toBe("d/flakes/ccglass");
    expect(encodeHash({ kind: "none" })).toBe("");
  });

  test("literal '%' is escaped so the hash stays decodable", () => {
    expect(encodeHash({ kind: "file", path: "docs/50%.md" })).toBe("f/docs/50%25.md");
  });

  test("literal '?' is escaped so it can't read as the filter separator", () => {
    expect(encodeHash({ kind: "file", path: "docs/what?.md" })).toBe("f/docs/what%3F.md");
  });
});

// Bundle focus (the cards view centered on a sub-bundle's index.md) is a
// navigation, so it rides in the selection segment — Back walks through
// bundles just like concepts.
describe("bundle selection", () => {
  const f = { hidden: [], q: "", isolate: 2 as const, facets: {}, view: "cards" as const, flow: "h" as const };

  test("encodes as b/<path>", () => {
    expect(encodeHash({ kind: "bundle", path: "notes" })).toBe("b/notes");
    expect(encodeViewHash({ sel: { kind: "bundle", path: "notes" }, filters: f })).toBe("b/notes");
  });

  test("decodes only known bundles; absent bundle map (old embed) -> none", () => {
    expect(decodeHash("b/notes", model)).toEqual({ kind: "bundle", path: "notes" });
    expect(decodeHash("b/ghost", model)).toEqual({ kind: "none" });
    expect(decodeHash("b/notes", { ...model, bundles: undefined })).toEqual({ kind: "none" });
  });

  test("inherited Object.prototype keys never decode as bundles", () => {
    for (const k of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(decodeHash("b/" + k, model)).toEqual({ kind: "none" });
    }
  });

  test("isolate rides behind '?' for a bundle selection too (1 hop; 2 is the default)", () => {
    expect(encodeViewHash({ sel: { kind: "bundle", path: "notes" }, filters: { ...f, isolate: 1 } })).toBe(
      "b/notes?isolate=1",
    );
    expect(decodeViewHash("b/notes?isolate=1", model).filters.isolate).toBe(1);
    expect(decodeViewHash("b/notes", model).filters.isolate).toBe(2);
  });

  test("isolate rides for the cards view without a selection (root-focus hops)", () => {
    const none = { kind: "none" } as const;
    expect(encodeViewHash({ sel: none, filters: { ...f, isolate: 1 } })).toBe("?isolate=1");
    expect(decodeViewHash("?isolate=1", model).filters.isolate).toBe(1);
    // The graph view still drops it: isolation needs an anchor concept.
    expect(encodeViewHash({ sel: none, filters: { ...f, view: "graph" as const, isolate: 2 } })).toBe("?view=graph");
    expect(decodeViewHash("?isolate=2&view=graph", model).filters.isolate).toBe(0);
  });
});

describe("encodeViewHash", () => {
  const none = { kind: "none" } as const;
  const f = (o: Partial<{ hidden: string[]; q: string; isolate: 0 | 1 | 2; facets: Record<string, string> }>) => ({
    hidden: [],
    q: "",
    isolate: 0 as const,
    facets: {},
    view: "graph" as const,
    flow: "h" as const,
    ...o,
  });

  test("empty filters add nothing beyond the view", () => {
    expect(encodeViewHash({ sel: none, filters: f({}) })).toBe("?view=graph");
    expect(encodeViewHash({ sel: { kind: "concept", id: "wiki/architecture" }, filters: f({}) })).toBe(
      "c/wiki/architecture?view=graph",
    );
  });

  test("filters ride behind '?', hidden types sorted for a canonical form", () => {
    expect(encodeViewHash({ sel: none, filters: f({ hidden: ["Decision", "Alpha Module"] }) })).toBe(
      "?hide=Alpha+Module%2CDecision&view=graph",
    );
    expect(encodeViewHash({ sel: none, filters: f({ hidden: ["Alpha Module", "Decision"] }) })).toBe(
      "?hide=Alpha+Module%2CDecision&view=graph",
    );
    expect(encodeViewHash({ sel: { kind: "concept", id: "wiki/architecture" }, filters: f({ q: "tmux conf" }) })).toBe(
      "c/wiki/architecture?q=tmux+conf&view=graph",
    );
  });

  test("isolate rides behind '?' only for a concept selection and a nonzero depth", () => {
    expect(encodeViewHash({ sel: { kind: "concept", id: "wiki/architecture" }, filters: f({ isolate: 2 }) })).toBe(
      "c/wiki/architecture?isolate=2&view=graph",
    );
    expect(encodeViewHash({ sel: { kind: "concept", id: "wiki/architecture" }, filters: f({ isolate: 0 }) })).toBe(
      "c/wiki/architecture?view=graph",
    );
    expect(encodeViewHash({ sel: none, filters: f({ isolate: 2 }) })).toBe("?view=graph"); // no selection -> never emitted
  });

  test("a facet rides behind '?' as its own name, always emittable (no selection gate)", () => {
    expect(encodeViewHash({ sel: none, filters: f({ facets: { platform: "macos" } }) })).toBe("?view=graph&platform=macos");
    expect(
      encodeViewHash({ sel: { kind: "file", path: "docs/50%.md" }, filters: f({ facets: { platform: "linux" } }) }),
    ).toBe("f/docs/50%25.md?view=graph&platform=linux");
    expect(encodeViewHash({ sel: none, filters: f({ facets: { platform: "all" } }) })).toBe("?view=graph"); // "all" omitted
  });

  test("multiple active facets all encode; 'all' entries are skipped", () => {
    expect(encodeViewHash({ sel: none, filters: f({ facets: { platform: "macos", status: "all" } }) })).toBe(
      "?view=graph&platform=macos",
    );
    expect(encodeViewHash({ sel: none, filters: f({ facets: { platform: "macos", status: "stable" } }) })).toBe(
      "?view=graph&platform=macos&status=stable",
    );
  });

  test("hide, q, isolate, view, then facets appear in that order", () => {
    expect(
      encodeViewHash({
        sel: { kind: "concept", id: "wiki/architecture" },
        filters: f({ hidden: ["Decision"], q: "arch", isolate: 1, facets: { platform: "macos", status: "stable" } }),
      }),
    ).toBe("c/wiki/architecture?hide=Decision&q=arch&isolate=1&view=graph&platform=macos&status=stable");
  });
});

// The view is a filter-class hash param: selection-independent, "cards"
// (the default) never emitted so default links stay bare.
describe("view mode param", () => {
  const f = (view: "graph" | "cards") => ({ hidden: [], q: "", isolate: 0 as const, facets: {}, view, flow: "h" as const });

  test("view=graph encodes with or without a selection; cards adds nothing", () => {
    expect(encodeViewHash({ sel: { kind: "none" }, filters: f("graph") })).toBe("?view=graph");
    expect(encodeViewHash({ sel: { kind: "concept", id: "wiki/architecture" }, filters: f("graph") })).toBe(
      "c/wiki/architecture?view=graph",
    );
    expect(encodeViewHash({ sel: { kind: "none" }, filters: f("cards") })).toBe("");
  });

  test("composes with the other filter params, after isolate", () => {
    expect(
      encodeViewHash({
        sel: { kind: "concept", id: "wiki/architecture" },
        filters: { hidden: ["Decision"], q: "arch", isolate: 1, facets: { platform: "macos" }, view: "graph", flow: "h" },
      }),
    ).toBe("c/wiki/architecture?hide=Decision&q=arch&isolate=1&view=graph&platform=macos");
  });

  test("round-trips; absent or garbage decodes to cards", () => {
    const view = { sel: { kind: "none" } as const, filters: f("graph") };
    expect(decodeViewHash(encodeViewHash(view), model).filters.view).toBe("graph");
    expect(decodeViewHash("c/wiki/architecture", model).filters.view).toBe("cards");
    expect(decodeViewHash("?view=bogus", model).filters.view).toBe("cards");
    expect(decodeViewHash("", model).filters.view).toBe("cards");
  });
});

// Vertical card flow rides the hash the same way as view=graph.
describe("flow param", () => {
  const f = (flow: "v" | "h") => ({
    hidden: [],
    q: "",
    isolate: 2 as const,
    facets: {},
    view: "cards" as const,
    flow,
  });

  test("flow=v encodes only when vertical; composes after isolate", () => {
    expect(encodeViewHash({ sel: { kind: "none" }, filters: f("v") })).toBe("?flow=v");
    expect(encodeViewHash({ sel: { kind: "none" }, filters: f("h") })).toBe("");
    expect(encodeViewHash({ sel: { kind: "none" }, filters: { ...f("v"), isolate: 1 } })).toBe("?isolate=1&flow=v");
  });

  test("round-trips; absent or garbage decode to horizontal", () => {
    expect(decodeViewHash(encodeViewHash({ sel: { kind: "none" }, filters: f("v") }), model).filters.flow).toBe("v");
    expect(decodeViewHash("", model).filters.flow).toBe("h");
    expect(decodeViewHash("?flow=sideways", model).filters.flow).toBe("h");
  });
});

describe("decodeViewHash", () => {
  test("selection + filters round-trip, including '%' paths", () => {
    for (const view of [
      {
        sel: { kind: "concept", id: "wiki/architecture" },
        filters: { hidden: ["Alpha Module", "Decision"], q: "", isolate: 0, facets: { platform: "all", status: "all" }, view: "graph", flow: "v" },
      },
      {
        sel: { kind: "none" },
        filters: { hidden: [], q: "a?b&c=%", isolate: 0, facets: { platform: "macos", status: "all" }, view: "graph", flow: "v" },
      },
      {
        sel: { kind: "file", path: "docs/50%.md" },
        filters: { hidden: ["Decision"], q: "tmux", isolate: 0, facets: { platform: "linux", status: "draft" }, view: "graph", flow: "v" },
      },
      {
        sel: { kind: "concept", id: "wiki/architecture" },
        filters: { hidden: ["Decision"], q: "tmux", isolate: 1, facets: { platform: "macos", status: "all" }, view: "graph", flow: "v" },
      },
    ] as const) {
      const decoded = decodeViewHash(encodeViewHash(view as never), model);
      expect(decoded.sel).toEqual(view.sel);
      expect(decoded.filters).toEqual(view.filters as never);
    }
  });

  test("bare selection hashes decode to the defaults: cards, 2 hops, horizontal, every facet 'all'", () => {
    expect(decodeViewHash("c/wiki/architecture", model)).toEqual({
      sel: { kind: "concept", id: "wiki/architecture" },
      filters: { hidden: [], q: "", isolate: 2, facets: { platform: "all", status: "all" }, view: "cards", flow: "h" },
    });
  });

  test("unknown hidden types are dropped against the model", () => {
    expect(decodeViewHash("?hide=Decision,Nope,", model).filters.hidden).toEqual(["Decision"]);
  });

  test("junk filter params fall back to empty filters", () => {
    expect(decodeViewHash("c/wiki/architecture?%%%", model).sel).toEqual({
      kind: "concept",
      id: "wiki/architecture",
    });
  });

  test("graph view: a stray isolate= on a non-concept selection is dropped on decode", () => {
    expect(decodeViewHash("?isolate=2&view=graph", model).filters.isolate).toBe(0);
    expect(decodeViewHash("f/flakes/okf/viz.ts?isolate=1&view=graph", model).filters.isolate).toBe(0);
  });

  test("garbage isolate values clamp to the view's default (graph 0, cards 2)", () => {
    expect(decodeViewHash("c/wiki/architecture?isolate=3&view=graph", model).filters.isolate).toBe(0);
    expect(decodeViewHash("c/wiki/architecture?isolate=abc&view=graph", model).filters.isolate).toBe(0);
    expect(decodeViewHash("c/wiki/architecture?isolate=3", model).filters.isolate).toBe(2);
    expect(decodeViewHash("c/wiki/architecture?isolate=0", model).filters.isolate).toBe(2);
  });

  test("only known facet names decode; a param outside a facet's values clamps to 'all'", () => {
    expect(decodeViewHash("?platform=macos", model).filters.facets).toEqual({ platform: "macos", status: "all" });
    expect(decodeViewHash("?platform=bogus", model).filters.facets.platform).toBe("all");
    expect(decodeViewHash("?nope=macos", model).filters.facets).toEqual({ platform: "all", status: "all" });
  });

  test("os= decodes as a legacy alias for a facet literally named 'platform'", () => {
    expect(decodeViewHash("?os=macos", model).filters.facets.platform).toBe("macos");
    expect(decodeViewHash("f/flakes/okf/viz.ts?os=linux", model).filters.facets.platform).toBe("linux");
    expect(decodeViewHash("d/flakes/ccglass?os=macos", model).filters.facets.platform).toBe("macos");
    expect(decodeViewHash("c/wiki/architecture?os=bogus", model).filters.facets.platform).toBe("all");
    expect(decodeViewHash("c/wiki/architecture", model).filters.facets.platform).toBe("all");
  });

  test("os= is ignored when no facet is literally named 'platform'", () => {
    const noPlatform = { ...model, facets: [{ name: "status", values: ["draft", "stable"] }] };
    expect(decodeViewHash("?os=macos", noPlatform).filters.facets).toEqual({ status: "all" });
  });

  test("an explicit platform= wins over a simultaneous legacy os=", () => {
    expect(decodeViewHash("?platform=linux&os=macos", model).filters.facets.platform).toBe("linux");
  });

  test("a model without configured facets decodes an empty facets record", () => {
    const generic = { ...model, facets: undefined };
    expect(decodeViewHash("?os=macos", generic).filters.facets).toEqual({});
    expect(decodeViewHash("?os=macos", { ...model, facets: [] }).filters.facets).toEqual({});
  });
});

describe("decodeHash", () => {
  test("valid concept, with and without leading #", () => {
    expect(decodeHash("c/wiki/architecture", model)).toEqual({ kind: "concept", id: "wiki/architecture" });
    expect(decodeHash("#c/wiki/architecture", model)).toEqual({ kind: "concept", id: "wiki/architecture" });
  });

  test("valid file", () => {
    expect(decodeHash("f/flakes/okf/viz.ts", model)).toEqual({ kind: "file", path: "flakes/okf/viz.ts" });
  });

  test("valid dir", () => {
    expect(decodeHash("d/flakes/ccglass", model)).toEqual({ kind: "dir", path: "flakes/ccglass" });
  });

  test("percent-encoded hashes decode", () => {
    expect(decodeHash("c/wiki%2Farchitecture", model)).toEqual({ kind: "concept", id: "wiki/architecture" });
  });

  test("unknown targets and junk fall back to none", () => {
    expect(decodeHash("c/nope", model)).toEqual({ kind: "none" });
    expect(decodeHash("f/nope.ts", model)).toEqual({ kind: "none" });
    expect(decodeHash("d/nope", model)).toEqual({ kind: "none" });
    expect(decodeHash("garbage", model)).toEqual({ kind: "none" });
    expect(decodeHash("", model)).toEqual({ kind: "none" });
  });

  test("round-trips", () => {
    const sel = { kind: "concept", id: "wiki/architecture" } as const;
    expect(decodeHash(encodeHash(sel), model)).toEqual(sel);
    const pct = { kind: "file", path: "docs/50%.md" } as const;
    expect(decodeHash(encodeHash(pct), model)).toEqual(pct);
  });
});
