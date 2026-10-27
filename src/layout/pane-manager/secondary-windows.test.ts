import { describe, expect, test } from "bun:test";
import { createPaneInstance, type LayoutConfig } from "../../types/config";
import { getDockedPaneIds } from "./dock-tree";
import { removePane } from "./layout-state";
import { findPaneLocation } from "./queries";
import {
  applySecondaryWindowLayoutEdit,
  closeSecondaryWindow,
  movePaneToMainWindow,
  movePaneToNewWindow,
  secondaryWindowPaneIds,
  viewLayoutFromWindow,
  windowLayoutEditFromView,
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

  test("an edit made in a window's view applies to that window's grid and its own panes only", () => {
    const layout = twoWindowLayout();
    const view = viewLayoutFromWindow(layout, "w2");
    const base = secondaryWindowPaneIds(layout, "w2");
    expect(base).toEqual(["news", "econ", "alerts"]);

    // Rearranged and retitled, with a main-window pane retitled behind its back.
    const edited: LayoutConfig = {
      ...view,
      dockRoot: { kind: "split", axis: "horizontal", ratio: 0.3, first: view.dockRoot!, second: { kind: "pane", instanceId: "alerts" } },
      floating: [],
      instances: view.instances.map((instance) => (
        instance.instanceId === "news" ? { ...instance, title: "Headlines", paneId: "chat" }
          : instance.instanceId === "list" ? { ...instance, title: "Not yours" }
            : instance
      )),
    };
    const applied = applySecondaryWindowLayoutEdit(layout, windowLayoutEditFromView(edited, "w2", base));
    expect(applied).not.toBeNull();
    expect(secondaryWindowPaneIds(applied!, "w2")).toEqual(["news", "econ", "alerts"]);
    expect(applied!.windows![0]!.floating).toEqual([]);
    expect(applied!.dockRoot).toEqual(layout.dockRoot);
    const news = applied!.instances.find((instance) => instance.instanceId === "news")!;
    expect(news.title).toBe("Headlines");
    // A window cannot change a pane's type, nor touch a pane outside it.
    expect(news.paneId).toBe("news");
    expect(applied!.instances.find((instance) => instance.instanceId === "list")!.title).toBeUndefined();
  });

  test("closing a pane in a window removes it from the layout, and edits from a stale or foreign view are dropped", () => {
    const layout = twoWindowLayout();
    const base = secondaryWindowPaneIds(layout, "w2");
    const view = viewLayoutFromWindow(layout, "w2");

    const closed = applySecondaryWindowLayoutEdit(layout, windowLayoutEditFromView(removePane(view, "econ"), "w2", base));
    expect(secondaryWindowPaneIds(closed!, "w2")).toEqual(["news", "alerts"]);
    expect(closed!.instances.some((instance) => instance.instanceId === "econ")).toBe(false);
    expect(closed!.instances).toHaveLength(5);

    // A main-window pane brought in from the view's other windows is not this window's to take.
    const foreign = { ...view, floating: [...view.floating, { instanceId: "list", x: 0, y: 0, width: 20, height: 8 }] };
    expect(applySecondaryWindowLayoutEdit(layout, windowLayoutEditFromView(foreign, "w2", base))).toBeNull();

    // The window's panes changed since the view was made: the edit is from an older state.
    expect(applySecondaryWindowLayoutEdit(layout, windowLayoutEditFromView(view, "w2", ["news", "econ"]))).toBeNull();
    expect(applySecondaryWindowLayoutEdit(layout, windowLayoutEditFromView(view, "w9", base))).toBeNull();
  });

  test("a pane opened in a window joins the layout there, but never under an id the layout already holds", () => {
    const layout = twoWindowLayout();
    const base = secondaryWindowPaneIds(layout, "w2");
    const view = viewLayoutFromWindow(layout, "w2");
    const opened = {
      ...view,
      instances: [...view.instances, createPaneInstance("calendar", { instanceId: "cal" })],
      floating: [...view.floating, { instanceId: "cal", x: 2, y: 2, width: 30, height: 10 }],
    };

    const applied = applySecondaryWindowLayoutEdit(layout, windowLayoutEditFromView(opened, "w2", base));
    expect(secondaryWindowPaneIds(applied!, "w2")).toEqual(["news", "econ", "alerts", "cal"]);
    expect(applied!.instances.find((instance) => instance.instanceId === "cal")!.paneId).toBe("calendar");
    expect(findPaneLocation(applied!, "cal")).toEqual({ window: "w2", kind: "floating" });

    // An id the main window already holds is that pane's, whatever the view says it is.
    const reused = {
      ...view,
      instances: [...view.instances.filter((instance) => instance.instanceId !== "list"), createPaneInstance("calendar", { instanceId: "list" })],
      floating: [...view.floating, { instanceId: "list", x: 2, y: 2, width: 30, height: 10 }],
    };
    expect(applySecondaryWindowLayoutEdit(layout, windowLayoutEditFromView(reused, "w2", base))).toBeNull();
  });
});
