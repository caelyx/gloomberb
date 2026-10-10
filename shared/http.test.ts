import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { createMemoryCache } from "./http";

afterEach(() => { setSystemTime(); });

describe("createMemoryCache", () => {
  test("concurrent loads share one request; a fresh entry is reused; force refetches", async () => {
    const cache = createMemoryCache<number>(60_000);
    let calls = 0;
    const loader = async () => ++calls;
    const [a, b] = await Promise.all([cache.load("k", loader), cache.load("k", loader)]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
    expect(await cache.load("k", loader)).toBe(1);
    expect(await cache.load("k", loader, true)).toBe(2);
  });

  test("a failed refresh keeps recent data, but not data past its stale limit", async () => {
    const cache = createMemoryCache<string>(60_000, 10, 10 * 60_000);
    setSystemTime(new Date("2026-10-08T00:00:00Z"));
    await cache.load("k", async () => "first");
    const failing = async (): Promise<string> => { throw new Error("down"); };
    setSystemTime(new Date("2026-10-08T00:05:00Z"));
    expect(await cache.load("k", failing)).toBe("first");
    expect(cache.isFresh("k")).toBe(false);
    setSystemTime(new Date("2026-10-08T00:20:00Z"));
    await expect(cache.load("k", failing)).rejects.toThrow("down");
  });
});
