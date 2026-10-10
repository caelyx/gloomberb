import { expect, test } from "bun:test";
import { getDockedPaneIds } from "../../layout/pane-manager/dock-tree";
import { BROWSER_RESEARCH_PANE_ID, createBrowserConfigStore } from "./config-host";
import type { StorageLike } from "../../data/json-storage";
import { PRIVATE_DEFAULT_LAYOUTS } from "./private-default-config";

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

// Downstream: without a research link the private layouts open, in order; a
// research link opens on research with the private layouts after it.
const privateNames = PRIVATE_DEFAULT_LAYOUTS!.map((layout) => layout.name);

test("a visit without a research link opens the private layouts", async () => {
  const config = await createBrowserConfigStore(memoryStorage()).loadConfig("browser://local");
  expect(config.layouts.map((layout) => layout.name)).toEqual(privateNames);
  expect(config.layout).toEqual(PRIVATE_DEFAULT_LAYOUTS![0]!.layout);
});

test("a research link still opens on research, with the private layouts next", async () => {
  const config = await createBrowserConfigStore(memoryStorage(), "?ticker=aapl").loadConfig("browser://local");
  expect(config.layouts.map((layout) => layout.name)).toEqual(["Research", ...privateNames]);
});

test("every private layout docks exactly its own panes and focuses one of them", () => {
  for (const saved of PRIVATE_DEFAULT_LAYOUTS!) {
    const ids = saved.layout.instances.map((instance) => instance.instanceId);
    expect(getDockedPaneIds(saved.layout).sort()).toEqual([...ids].sort());
    expect(ids).toContain(saved.focusedPaneId!);
    for (const key of Object.keys(saved.paneState ?? {})) expect(ids).toContain(key);
  }
});

test("the private default never replaces or re-enters a saved config", async () => {
  const storage = memoryStorage();
  const store = createBrowserConfigStore(storage);
  const fresh = await store.loadConfig("browser://local");
  // The visitor closes the first layout and saves.
  const edited = { ...fresh, layouts: fresh.layouts.slice(1), layout: fresh.layouts[1]!.layout };
  await store.saveConfig(edited);

  const restored = await createBrowserConfigStore(storage).loadConfig("browser://local");
  expect(restored.layouts.map((layout) => layout.name)).toEqual(privateNames.slice(1));
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
