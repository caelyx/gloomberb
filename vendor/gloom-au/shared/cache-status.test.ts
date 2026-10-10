import { describe, expect, test } from "bun:test";
import { keyedValue, refreshNotice } from "./cache-status";

describe("keyed cached resources", () => {
  test("a new key shows its disk copy rather than the previous key's data", () => {
    const held = { key: "3D", value: "three days" };
    expect(keyedValue("3D", held, null)).toBe("three days");
    expect(keyedValue("1M", held, "a month, from disk")).toBe("a month, from disk");
    // No copy on disk: the previous window stands in while loading.
    expect(keyedValue("1M", held, null)).toBe("three days");
    expect(keyedValue("1M", null, null)).toBeNull();
  });

  test("a failed refresh becomes a notice", () => {
    expect(refreshNotice({ fetchedAt: 0, stale: true, refreshError: "down" })).toEqual(["Refresh failed, showing the last copy: down"]);
    expect(refreshNotice({ fetchedAt: 0, stale: false })).toEqual([]);
  });
});
