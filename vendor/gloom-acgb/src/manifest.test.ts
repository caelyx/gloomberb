import { describe, expect, test } from "bun:test";
import manifest from "../gloom.json";
import pkg from "../package.json";
import { PLUGIN_HOSTS } from "./rba/client";
import { createAcgbPlugin } from "./plugin";
import { PLUGIN_ID } from "./version";

describe("manifest and plugin agree", () => {
  const plugin = createAcgbPlugin();

  test("ids, targets and version line up", () => {
    expect(plugin.id).toBe(PLUGIN_ID);
    expect(manifest.id).toBe(PLUGIN_ID);
    expect(plugin.targets).toEqual(manifest.targets as typeof plugin.targets);
    expect(plugin.version).toBe(pkg.version);
  });

  test("hosts in gloom.json are exactly the hosts the code reaches", () => {
    expect(manifest.hosts).toEqual([...PLUGIN_HOSTS]);
    expect(plugin.hosts).toEqual(PLUGIN_HOSTS);
  });

  test("contributed panes and shortcut codes exist on the plugin", () => {
    expect((plugin.panes ?? []).map((pane) => pane.id)).toEqual(manifest.contributes.panes);
    expect((plugin.paneTemplates ?? []).map((template) => template.shortcut?.prefix))
      .toEqual(manifest.contributes.shortcuts.map((shortcut) => shortcut.code));
  });

  test("runtime packages are dependencies, since plugins are installed with --production", () => {
    expect(Object.keys(pkg.dependencies)).toContain("papaparse");
  });
});
