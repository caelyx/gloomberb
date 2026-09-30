import { expect, test } from "bun:test";
import { getDockedPaneIds } from "../../plugins/pane-manager/dock-tree";
import { BROWSER_RESEARCH_PANE_ID, createBrowserConfigStore } from "./config-host";
import type { StorageLike } from "../../data/json-storage";
import { PRIVATE_DEFAULT_LAYOUT } from "./private-default-config";

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

test("a research link opens its ticker on the requested tab", async () => {
  const store = createBrowserConfigStore(memoryStorage(), "?ticker=aapl&tab=financials");
  const config = await store.loadConfig("browser://local");

  const research = config.layout.instances.find((instance) => instance.instanceId === BROWSER_RESEARCH_PANE_ID);
  expect(research?.binding).toEqual({ kind: "fixed", symbol: "AAPL" });
  expect(config.layouts[0]?.paneState?.[BROWSER_RESEARCH_PANE_ID]).toEqual({ activeTabId: "financials" });
});

// Downstream: without a research link the private workspace opens first, and
// the research workspace (still on NVDA) is the next layout.
test("a visit without a research link opens the private workspace, with research on NVDA next", async () => {
  const store = createBrowserConfigStore(memoryStorage());
  const config = await store.loadConfig("browser://local");
  expect(config.layouts[0]?.name).toBe(PRIVATE_DEFAULT_LAYOUT!.name);
  expect(config.layout).toEqual(PRIVATE_DEFAULT_LAYOUT!.layout);
  const research = config.layouts[1]?.layout.instances.find((instance) => instance.instanceId === BROWSER_RESEARCH_PANE_ID);
  expect(research?.binding).toEqual({ kind: "fixed", symbol: "NVDA" });
});

test("a research link still opens on research, with the private workspace next", async () => {
  const config = await createBrowserConfigStore(memoryStorage(), "?ticker=aapl").loadConfig("browser://local");
  expect(config.layouts.map((layout) => layout.name).slice(0, 2)).toEqual(["Research", PRIVATE_DEFAULT_LAYOUT!.name]);
});

test("the private default never replaces or re-enters a saved config", async () => {
  const storage = memoryStorage();
  const store = createBrowserConfigStore(storage);
  const fresh = await store.loadConfig("browser://local");
  // The visitor closes the private workspace and saves.
  const edited = { ...fresh, layouts: fresh.layouts.slice(1), layout: fresh.layouts[1]!.layout };
  await store.saveConfig(edited);

  const restored = await createBrowserConfigStore(storage).loadConfig("browser://local");
  expect(restored.layouts.map((layout) => layout.name)).not.toContain(PRIVATE_DEFAULT_LAYOUT!.name);
  expect(restored.layouts[0]?.name).toBe("Research");
});

test("a returning visitor keeps the saved layout", async () => {
  const storage = memoryStorage();
  const first = createBrowserConfigStore(storage, "?ticker=NVDA");
  await first.saveConfig(await first.loadConfig("browser://local"));

  const second = createBrowserConfigStore(storage, "?ticker=MSFT");
  const restored = await second.loadConfig("browser://local");
  const research = restored.layout.instances.find((instance) => instance.instanceId === BROWSER_RESEARCH_PANE_ID);
  expect(research?.binding).toEqual({ kind: "fixed", symbol: "NVDA" });
  expect(getDockedPaneIds(restored.layout)).toHaveLength(6);
});
