import { expect, test } from "bun:test";
import pkg from "../package.json";
import { PLUGIN_VERSION } from "./version";

test("PLUGIN_VERSION matches package.json", () => {
  expect(PLUGIN_VERSION).toBe(pkg.version);
});
