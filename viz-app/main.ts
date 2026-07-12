// Viewer entry: parse the baked-in #data blob, build the immutable model and
// the reactive state, and mount the Svelte app. Data + layout are baked in by
// ../viz.ts.
import { mount } from "svelte";
import App from "./App.svelte";
// The cards view (and with it @threlte/core) enters the app only here:
// main.ts is the one module the test suite never imports, so bun test never
// has to resolve threlte (svelte-only export conditions).
import CardView from "./cards/CardView.svelte";
import { loadFromDom } from "./data";
import { mark } from "./perf";
import { createVizState } from "./state.svelte";

const model = loadFromDom();
mark("viz:parse");

const viz = createVizState(model);
mount(App, { target: document.body, props: { viz, cards: CardView } });
mark("viz:mount");
