import { describe, expect, test } from "bun:test";
import manifest from "../gloom.json";
import pkg from "../package.json";
import { PLUGIN_HOSTS } from "./asx/urls";
import { PLUGIN_ID } from "./version";
import { createAsxPlugin } from "./plugin";

describe("manifest and plugin agree", () => {
  const plugin = createAsxPlugin();

  test("ids match", () => {
    expect(manifest.id).toBe(PLUGIN_ID);
    expect(plugin.id).toBe(PLUGIN_ID);
  });

  test("hosts in gloom.json are exactly the hosts the code reaches", () => {
    expect(manifest.hosts).toEqual([...PLUGIN_HOSTS]);
    expect(plugin.hosts).toEqual(PLUGIN_HOSTS);
  });

  test("contributed panes exist on the plugin", () => {
    const paneIds = (plugin.panes ?? []).map((pane) => pane.id);
    expect(paneIds).toEqual(manifest.contributes.panes);
  });

  test("shortcut codes match the pane templates", () => {
    const prefixes = (plugin.paneTemplates ?? []).map((template) => template.shortcut?.prefix);
    expect(prefixes).toEqual(manifest.contributes.shortcuts.map((shortcut) => shortcut.code));
  });

  describe("the ASX pane template binds a ticker", () => {
    const template = plugin.paneTemplates![0]!;
    const context = (activeTicker: string | null) =>
      ({ activeTicker, config: {}, layout: {}, focusedPaneId: null, activeCollectionId: null }) as unknown as Parameters<NonNullable<typeof template.createInstance>>[0];

    test("uses the active ticker when the command bar has no argument", async () => {
      const instance = await template.createInstance!(context("CBA.AX"));
      expect(instance?.binding).toEqual({ kind: "fixed", symbol: "CBA.AX" });
      expect(instance?.placement).toBe("floating");
      expect(template.canCreate!(context("CBA.AX"))).toBe(true);
    });

    test("the host's resolved symbol wins over what was typed", async () => {
      expect((await template.createInstance!(context("AAPL"), { symbol: "CBA.AX", arg: "cba" }))?.binding).toEqual({ kind: "fixed", symbol: "CBA.AX" });
    });

    test("opening the same ticker twice reuses one pane", async () => {
      const first = await template.createInstance!(context("CBA.AX"));
      const again = await template.createInstance!(context("AAPL"), { symbol: "cba.ax" });
      expect(first?.instanceId).toBe("asx-announcements:CBA.AX");
      expect(again?.instanceId).toBe(first?.instanceId);
    });

    test("an explicit argument or symbol wins over the active ticker", async () => {
      expect((await template.createInstance!(context("CBA.AX"), { arg: " bhp.ax " }))?.binding).toEqual({ kind: "fixed", symbol: "BHP.AX" });
      expect((await template.createInstance!(context(null), { symbol: "wbc.ax" }))?.binding).toEqual({ kind: "fixed", symbol: "WBC.AX" });
    });

    test("cannot be created with no ticker at all", async () => {
      expect(template.canCreate!(context(null))).toBe(false);
      expect(await template.createInstance!(context(null))).toBeNull();
    });
  });

  test("runs on every renderer, the hosted web app included", () => {
    expect(manifest.targets).toEqual(["cli", "tui", "desktop", "web"]);
  });

  test("runtime packages are dependencies, since plugins are installed with --production", () => {
    expect(Object.keys(pkg.dependencies)).toContain("unpdf");
    expect(Object.keys(pkg.devDependencies)).not.toContain("unpdf");
  });

  test("the access token is optional", () => {
    const token = plugin.configSchema?.find((field) => field.key === "accessToken");
    expect(token?.required).toBe(false);
  });

  test("targets and version line up with package.json", () => {
    expect(plugin.targets).toEqual(manifest.targets as typeof plugin.targets);
    expect(plugin.version).toBe(pkg.version);
  });
});
