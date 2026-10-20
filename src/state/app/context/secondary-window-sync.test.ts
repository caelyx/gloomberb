import { describe, expect, test } from "bun:test";
import { appReducer, createInitialState, type AppState } from "../../../core/state/app/state";
import { addPaneToLayout, getDockedPaneIds, removePane } from "../../../layout/pane-manager";
import { secondaryWindowPaneIds, viewLayoutFromWindow } from "../../../layout/pane-manager/secondary-windows";
import { createDefaultConfig, createPaneInstance, type AppConfig, type LayoutConfig } from "../../../types/config";
import type { DesktopSharedStateSnapshot, DesktopWindowIntent } from "../../../types/desktop-window";
import { applyWindowIntent, SecondaryWindowSync } from "./secondary-window-sync";

/** Main has a list and a chart; window w2 has news and econ side by side. */
function twoWindowLayout(): LayoutConfig {
  return {
    dockRoot: {
      kind: "split",
      axis: "horizontal",
      ratio: 0.5,
      first: { kind: "pane", instanceId: "list" },
      second: { kind: "pane", instanceId: "chart" },
    },
    instances: [
      createPaneInstance("portfolio-list", { instanceId: "list" }),
      createPaneInstance("ticker-detail", { instanceId: "chart" }),
      createPaneInstance("news", { instanceId: "news" }),
      createPaneInstance("econ", { instanceId: "econ" }),
    ],
    floating: [],
    detached: [],
    windows: [{
      id: "w2",
      dockRoot: {
        kind: "split",
        axis: "horizontal",
        ratio: 0.5,
        first: { kind: "pane", instanceId: "news" },
        second: { kind: "pane", instanceId: "econ" },
      },
      floating: [],
    }],
  };
}

function mainConfig(layout = twoWindowLayout()): AppConfig {
  const config = createDefaultConfig("/tmp/gloomberb-test");
  return { ...config, layout, layouts: [{ name: "Main", layout }], activeLayoutIndex: 0 };
}

function mainState(layout = twoWindowLayout()): AppState {
  return createInitialState(mainConfig(layout));
}

/** The snapshot window w2 receives for the main window's state. */
function viewOf(state: AppState): DesktopSharedStateSnapshot {
  return {
    config: { ...state.config, layout: viewLayoutFromWindow(state.config.layout, "w2") },
    paneState: state.paneState,
    focusedPaneId: "news",
    statusBarVisible: false,
  };
}

function hydrate(local: AppState, snapshot: DesktopSharedStateSnapshot): AppState {
  return appReducer(local, { type: "HYDRATE_DESKTOP_SNAPSHOT", snapshot });
}

/** Applies an intent the way the main window does and returns its next state. */
function applyInMain(state: AppState, intent: DesktopWindowIntent): { state: AppState; applied: boolean } {
  const outcome = applyWindowIntent(state, "w2", intent);
  return { applied: outcome.applied, state: outcome.actions.reduce(appReducer, state) };
}

describe("applyWindowIntent", () => {
  test("takes pane state and plugin settings for the window's own panes only", () => {
    const state = mainState();
    const paneState = applyInMain(state, {
      type: "replacePaneState",
      paneState: { news: { cursorSymbol: "AAPL" }, list: { cursorSymbol: "MSFT" } },
    });
    expect(paneState.applied).toBe(true);
    expect(paneState.state.paneState.news).toEqual({ cursorSymbol: "AAPL" });
    expect(paneState.state.paneState.list).toEqual(state.paneState.list);

    const withPlugin = { ...state, config: { ...state.config, pluginConfig: { keep: { a: 1 }, drop: { b: 2 } } } };
    const plugin = applyWindowIntent(withPlugin, "w2", {
      type: "setPluginConfig",
      values: { drop: null, added: { c: 3 } },
    });
    expect(plugin.save?.pluginConfig).toEqual({ keep: { a: 1 }, added: { c: 3 } });
  });

  test("a grid edit enters the main window's undo history and is saved; a stale one is refused", () => {
    const state = mainState();
    const view = viewLayoutFromWindow(state.config.layout, "w2");
    const edited = removePane(view, "econ");
    const intent: DesktopWindowIntent = {
      type: "editLayout",
      edit: {
        windowId: "w9",
        basePaneIds: ["news", "econ"],
        dockRoot: edited.dockRoot,
        floating: edited.floating,
        instances: edited.instances.filter((instance) => instance.instanceId === "news"),
      },
    };
    // The host names the window; the edit's own claim is ignored.
    const outcome = applyWindowIntent(state, "w2", intent);
    expect(outcome.applied).toBe(true);
    expect(outcome.actions.map((action) => action.type)).toEqual(["PUSH_LAYOUT_HISTORY", "UPDATE_LAYOUT"]);
    const next = outcome.actions.reduce(appReducer, state);
    expect(secondaryWindowPaneIds(next.config.layout, "w2")).toEqual(["news"]);
    expect(outcome.save?.layout.instances.some((instance) => instance.instanceId === "econ")).toBe(false);

    expect(applyWindowIntent(next, "w2", intent).applied).toBe(false);
  });
});

describe("SecondaryWindowSync", () => {
  test("sends a grid edit once, keeps it over snapshots that predate it, and lets main's state win after", () => {
    const main = mainState();
    const sync = new SecondaryWindowSync("w2");
    let local = hydrate(createInitialState(mainConfig()), viewOf(main));
    sync.start(viewOf(main), local);
    expect(sync.collect(local)).toEqual([]);

    local = appReducer(local, { type: "UPDATE_LAYOUT", layout: removePane(local.config.layout, "econ") });
    const intents = sync.collect(local);
    expect(intents.map((intent) => intent.type)).toEqual(["editLayout"]);
    expect(sync.collect(local)).toEqual([]);

    // Main's next snapshot was sent before it applied the edit: the window keeps its grid.
    const stale = sync.receive(viewOf(main), local);
    expect(getDockedPaneIds(stale.config.layout)).toEqual(["news"]);

    const applied = applyInMain(main, intents[0]!);
    expect(sync.settle(intents[0]!, applied.applied)).toBe(false);
    local = hydrate(local, sync.receive(viewOf(applied.state), local));
    sync.noteSynced(local);
    expect(sync.collect(local)).toEqual([]);
  });

  test("a pane opened in the window reaches the main window with its state, and survives snapshots in between", () => {
    const main = mainState();
    const sync = new SecondaryWindowSync("w2");
    let local = hydrate(createInitialState(mainConfig()), viewOf(main));
    sync.start(viewOf(main), local);

    const opened = createPaneInstance("calendar", { instanceId: "cal" });
    local = appReducer(local, {
      type: "UPDATE_LAYOUT",
      layout: addPaneToLayout(local.config.layout, opened, { relativeTo: "econ", position: "right" }),
    });
    local = appReducer(local, { type: "REPLACE_PANE_STATE", paneId: "cal", state: { month: "2026-10" } });
    const intents = sync.collect(local);
    expect(intents.map((intent) => intent.type)).toEqual(["editLayout", "replacePaneState"]);

    // A snapshot from before main took the edit still shows the new pane here.
    const stale = sync.receive(viewOf(main), local);
    expect(getDockedPaneIds(stale.config.layout)).toEqual(["news", "econ", "cal"]);
    expect(stale.config.layout.instances.some((instance) => instance.instanceId === "cal")).toBe(true);

    let next = main;
    for (const intent of intents) {
      const result = applyInMain(next, intent);
      expect(result.applied).toBe(true);
      next = result.state;
    }
    expect(secondaryWindowPaneIds(next.config.layout, "w2")).toEqual(["news", "econ", "cal"]);
    expect(next.paneState.cal).toEqual({ month: "2026-10" });
  });

  test("a refused edit is dropped so main's state comes back", () => {
    const main = mainState();
    const sync = new SecondaryWindowSync("w2");
    let local = hydrate(createInitialState(mainConfig()), viewOf(main));
    sync.start(viewOf(main), local);
    local = appReducer(local, { type: "UPDATE_LAYOUT", layout: removePane(local.config.layout, "econ") });
    const [intent] = sync.collect(local);
    expect(sync.settle(intent!, false)).toBe(true);
    const restored = sync.receive(viewOf(main), local);
    expect(restored.config.layout.dockRoot).toEqual(viewOf(main).config.layout.dockRoot);
  });

  test("a window's focus stays among its own panes", () => {
    const main = mainState();
    // The main window's focused pane is in its own grid, not this window's.
    const local = hydrate(createInitialState(mainConfig()), { ...viewOf(main), focusedPaneId: "list" });
    expect(["news", "econ"]).toContain(local.focusedPaneId!);
    const next = appReducer(local, { type: "FOCUS_NEXT", paneOrder: getDockedPaneIds(local.config.layout) });
    expect(["news", "econ"]).toContain(next.focusedPaneId!);
    expect(next.focusedPaneId).not.toBe(local.focusedPaneId);
  });

  test("sends the state of its own panes that changed, and keeps its own focus", () => {
    const main = mainState();
    const sync = new SecondaryWindowSync("w2");
    let local = hydrate(createInitialState(mainConfig()), viewOf(main));
    sync.start(viewOf(main), local);
    local = appReducer(local, { type: "UPDATE_PANE_STATE", paneId: "econ", patch: { cursorSymbol: "SPY" } });
    local = appReducer(local, { type: "UPDATE_PANE_STATE", paneId: "list", patch: { cursorSymbol: "QQQ" } });
    local = appReducer(local, { type: "FOCUS_PANE", paneId: "econ" });
    expect(sync.collect(local)).toEqual([{ type: "replacePaneState", paneState: { econ: { cursorSymbol: "SPY" } } }]);

    const stale = sync.receive(viewOf(main), local);
    expect(stale.paneState.econ).toEqual({ cursorSymbol: "SPY" });
    expect(stale.focusedPaneId).toBe("econ");
  });
});
