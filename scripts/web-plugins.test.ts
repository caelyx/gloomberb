import { describe, expect, test } from "bun:test";

import { mergeManifestHosts } from "./web-plugins";

// Downstream: the web build reads each bundled plugin's gloom.json as well as
// its module, because some plugins list their hosts only in the manifest.
describe("web-bundled plugin manifests", () => {
  const plugin = { id: "hackernews", hosts: ["a.example.com"] };

  test("proxies the hosts from both the module and gloom.json", () => {
    expect(mergeManifestHosts("pkg", plugin, { id: "hackernews", targets: ["web"], hosts: ["b.example.com", "a.example.com"] }))
      .toEqual(["a.example.com", "b.example.com"]);
    expect(mergeManifestHosts("pkg", { id: "hackernews" }, undefined)).toEqual([]);
  });

  test.each([
    [["not", "an", "object"], "not a JSON object"],
    [{ id: "someone-else" }, "does not match"],
    [{ targets: ["cli", "tui", "desktop"] }, "\"web\" target"],
    [{ hosts: "b.example.com" }, "list of host names"],
    [{ hosts: [42] }, "list of host names"],
  ])("fails the build for manifest %j", (manifest, message) => {
    expect(() => mergeManifestHosts("pkg", plugin, manifest)).toThrow(message);
  });
});
