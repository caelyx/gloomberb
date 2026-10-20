import { describe, expect, test } from "bun:test";
import { createPaneInstance, type LayoutConfig } from "../../types/config";
import { getDockedPaneIds } from "./dock-tree";
import { findPaneLocation } from "./queries";
import {
  closeSecondaryWindow,
  movePaneToMainWindow,
  movePaneToNewWindow,
  viewLayoutFromWindow,
} from "./secondary-windows";

/** A main grid of two panes and a floating one, with window w2 holding a grid of two and a floating pane. */
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
      createPaneInstance("chat", { instanceId: "chat" }),
      createPaneInstance("news", { instanceId: "news" }),
      createPaneInstance("econ", { instanceId: "econ" }),
      createPaneInstance("alerts", { instanceId: "alerts" }),
    ],
    floating: [{ instanceId: "chat", x: 4, y: 4, width: 40, height: 12 }],
    detached: [],
    windows: [{
      id: "w2",
      dockRoot: {
        kind: "split",
        axis: "vertical",
        ratio: 0.5,
        first: { kind: "pane", instanceId: "news" },
        second: { kind: "pane", instanceId: "econ" },
      },
      floating: [{ instanceId: "alerts", x: 10, y: 2, width: 30, height: 10 }],
    }],
  };
}

describe("secondary window layout operations", () => {
  test("moving a pane to a new window gives it a fresh id and keeps every other pane placed", () => {
    const moved = movePaneToNewWindow(twoWindowLayout(), "chart");
    expect(moved?.windowId).toBe("w3");
    expect(findPaneLocation(moved!.layout, "chart")).toEqual({ window: "w3", kind: "docked" });
    expect(getDockedPaneIds(moved!.layout)).toEqual(["list"]);
    expect(moved!.layout.windows?.map((window) => window.id)).toEqual(["w2", "w3"]);
    expect(moved!.layout.instances).toHaveLength(6);

    // A window id freed by closing is reused, so ids stay short.
    const afterClose = closeSecondaryWindow(twoWindowLayout(), "w2");
    expect(movePaneToNewWindow(afterClose, "list")?.windowId).toBe("w2");
    expect(movePaneToNewWindow(twoWindowLayout(), "missing")).toBeNull();
  });

  test("moving a window pane to the main window docks it beside the anchor and leaves the window open", () => {
    const layout = movePaneToMainWindow(twoWindowLayout(), "news", "list");
    expect(findPaneLocation(layout, "news")).toEqual({ window: "main", kind: "docked" });
    expect(getDockedPaneIds(layout)).toEqual(["list", "news", "chart"]);
    expect(layout.windows?.[0]?.dockRoot).toEqual({ kind: "pane", instanceId: "econ" });

    // With no usable anchor it goes to the main grid's right edge; an emptied window stays.
    const emptied = movePaneToMainWindow(movePaneToMainWindow(twoWindowLayout(), "econ", null), "news", "missing");
    expect(getDockedPaneIds(emptied)).toEqual(["list", "chart", "econ", "news"]);
    expect(emptied.windows?.map((window) => window.id)).toEqual(["w2"]);
    expect(emptied.windows?.[0]?.dockRoot).toBeNull();
  });

  test("closing a window moves its grid into the main window as one block and its floating panes with it", () => {
    const layout = closeSecondaryWindow(twoWindowLayout(), "w2");
    expect(layout.windows ?? []).toEqual([]);
    expect(layout.dockRoot).toEqual({
      kind: "split",
      axis: "horizontal",
      ratio: 0.5,
      first: twoWindowLayout().dockRoot,
      second: twoWindowLayout().windows![0]!.dockRoot,
    });
    expect(layout.floating.map((entry) => entry.instanceId)).toEqual(["chat", "alerts"]);
    expect(layout.instances).toHaveLength(6);

    // Into an empty main window the window's grid becomes the whole grid.
    const emptyMain = { ...twoWindowLayout(), dockRoot: null, floating: [] };
    expect(closeSecondaryWindow(emptyMain, "w2").dockRoot).toEqual(twoWindowLayout().windows![0]!.dockRoot);
    expect(closeSecondaryWindow(twoWindowLayout(), "w9")).toEqual(twoWindowLayout());
  });

  test("a window's view of the layout swaps it with the main window, so every pane stays placed", () => {
    const view = viewLayoutFromWindow(twoWindowLayout(), "w2");
    expect(getDockedPaneIds(view)).toEqual(["news", "econ"]);
    expect(view.floating.map((entry) => entry.instanceId)).toEqual(["alerts"]);
    expect(findPaneLocation(view, "list")?.kind).toBe("docked");
    expect(findPaneLocation(view, "list")?.window).not.toBe("main");
    expect(findPaneLocation(view, "chat")?.kind).toBe("floating");
    expect(view.instances).toEqual(twoWindowLayout().instances);

    // A window that is gone shows an empty grid rather than the main window's.
    const gone = viewLayoutFromWindow(twoWindowLayout(), "w9");
    expect(gone.dockRoot).toBeNull();
    expect(gone.floating).toEqual([]);
    expect(findPaneLocation(gone, "list")).not.toBeNull();
  });
});
