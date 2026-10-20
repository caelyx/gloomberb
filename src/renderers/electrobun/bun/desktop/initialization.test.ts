import { expect, test } from "bun:test";
import { CapabilityRegistry } from "../../../../capabilities";
import { desktopRendererCapabilityManifests, normalizeInitWindowTarget } from "./initialization";

test("a view opened on a secondary window's channel is that window, whatever it claims", () => {
  expect(normalizeInitWindowTarget("window:w2", { kind: "main" })).toEqual({ kind: "window", windowId: "w2" });
  expect(normalizeInitWindowTarget("main", { kind: "detached", paneId: "chat" })).toEqual({ kind: "main" });
  expect(normalizeInitWindowTarget("detached:chat", {})).toEqual({ kind: "detached", paneId: "chat" });
  // An empty id is no window; with no channel to go on, a view is the main window unless it says it is popped out.
  expect(normalizeInitWindowTarget("window:", {})).toEqual({ kind: "main", paneId: undefined });
});

test("desktop init includes disabled renderer-safe manifests while invocation stays disabled", async () => {
  let enabled = false;
  const registry = new CapabilityRegistry({ isPluginEnabled: () => enabled });
  registry.register("charts", {
    id: "charts.test",
    kind: "chart-series",
    name: "Test Charts",
    operations: {
      resolve: { kind: "query", rendererSafe: true, handler: () => "ok" },
      private: { kind: "read", handler: () => "private" },
    },
  });

  expect(desktopRendererCapabilityManifests(registry)).toEqual([expect.objectContaining({
    id: "charts.test",
    operations: [expect.objectContaining({ id: "resolve" })],
  })]);
  await expect(registry.invoke("charts.test", "resolve", {}, { renderer: true }))
    .rejects.toThrow("not available");

  enabled = true;
  await expect(registry.invoke("charts.test", "resolve", {}, { renderer: true })).resolves.toBe("ok");
});
