import { describe, expect, test } from "bun:test";
import { secondaryWindowMayRequest } from "./secondary-window-writes";

describe("requests from a secondary window", () => {
  test("cannot write the config or session it only holds a view of", () => {
    // Its copy of the layout has its own grid in the main window's place; saved, it would swap them.
    for (const method of ["config.save", "config.export", "session.set", "session.delete", "desktop.syncMainState", "desktop.replaceDetachedPaneState", "desktop.setThemePreview", "update.apply"]) {
      expect(secondaryWindowMayRequest(method)).toBe(false);
    }
  });

  test("can still read, fetch, and ask the host to move its panes", () => {
    for (const method of ["init", "http.fetch", "capability.invoke", "ticker.save", "host.windowControl", "desktop.moveToMainWindow", "pluginState.setMany"]) {
      expect(secondaryWindowMayRequest(method)).toBe(true);
    }
  });
});
