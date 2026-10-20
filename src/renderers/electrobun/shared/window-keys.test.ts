import { describe, expect, test } from "bun:test";
import { commandBarMenuTarget, paneWindowRpcKey } from "./window-keys";

describe("window keys", () => {
  test("Cmd-K from the menu goes to the secondary window last in front, else to the main window", () => {
    const ready = new Set(["main", "window:w2", "detached:chart"]);
    const isReady = (key: string) => ready.has(key);

    expect(commandBarMenuTarget("window:w2", isReady)).toBe("window:w2");
    expect(commandBarMenuTarget("main", isReady)).toBe("main");
    // A popped-out pane has no bar, a window still loading cannot take it, and none at all is the main window.
    expect(commandBarMenuTarget("detached:chart", isReady)).toBe("main");
    expect(commandBarMenuTarget("window:w3", isReady)).toBe("main");
    expect(commandBarMenuTarget(null, isReady)).toBe("main");
  });

  test("a pane is focused in the window that shows it", () => {
    expect(paneWindowRpcKey("chart", { window: "main", kind: "docked" })).toBe("main");
    expect(paneWindowRpcKey("news", { window: "w2", kind: "floating" })).toBe("window:w2");
    expect(paneWindowRpcKey("quote", { window: "main", kind: "detached" })).toBe("detached:quote");
    expect(paneWindowRpcKey("gone", null)).toBeNull();
  });
});
