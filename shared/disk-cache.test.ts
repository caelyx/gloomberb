import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { MemoryPluginPersistence } from "gloomberb/test-support";
import { CACHE_POLICY, cacheAge, type DiskCachePolicy } from "./cache-policy";
import { combineMeta, createDiskCache, decodePoints, encodePoints, expectArray, expectNumber } from "./disk-cache";

const MINUTE = 60_000;
const T0 = Date.parse("2026-10-10T00:00:00Z");

function policy(overrides: Partial<DiskCachePolicy> = {}): DiskCachePolicy {
  return { kind: `test-${Math.random()}`, source: "test", schemaVersion: 1, staleMs: 10 * MINUTE, expireMs: 60 * MINUTE, maxEntries: 10, ...overrides };
}

/** Stored as `[label, value]`; decode refuses anything else. */
const codec = {
  encode: (value: { label: string; value: number }) => [value.label, value.value] as [string, number],
  decode: (stored: [string, number]) => {
    const [label, value] = expectArray(stored, "test entry");
    if (typeof label !== "string") throw new Error("bad label");
    return { label, value: expectNumber(value, "test value") };
  },
};

afterEach(() => setSystemTime());

describe("cache policy", () => {
  test("every kind is unique, expires no sooner than it goes stale, and is bounded", () => {
    const policies = Object.values(CACHE_POLICY);
    expect(new Set(policies.map((entry) => entry.kind)).size).toBe(policies.length);
    for (const entry of policies) {
      expect(entry.expireMs).toBeGreaterThanOrEqual(entry.staleMs);
      expect(entry.maxEntries).toBeGreaterThan(0);
      expect(entry.schemaVersion).toBeGreaterThan(0);
    }
  });

  test("cacheAge splits fresh, stale and expired at the policy's edges", () => {
    const window = { staleMs: 10, expireMs: 100 };
    expect(cacheAge(1_000, window, 1_009)).toBe("fresh");
    expect(cacheAge(1_000, window, 1_010)).toBe("stale");
    expect(cacheAge(1_000, window, 1_099)).toBe("stale");
    expect(cacheAge(1_000, window, 1_100)).toBe("expired");
    expect(cacheAge(Number.NaN, window, 1_000)).toBe("expired");
    // Dated ahead of the clock: a little is jitter, more is a skewed clock.
    expect(cacheAge(1_000 + MINUTE, window, 1_000)).toBe("fresh");
    expect(cacheAge(1_000 + 6 * MINUTE, window, 1_000)).toBe("stale");
  });
});

describe("disk cache", () => {
  test("a copy written by one session decodes in the next, served without a request", async () => {
    setSystemTime(new Date(T0));
    const store = new MemoryPluginPersistence();
    const shape = policy();
    const first = createDiskCache(shape, codec);
    first.attach(store);
    const fetched = await first.load("k", async () => ({ label: "cash rate", value: 3.6 }));
    expect(fetched.source).toBe("network");
    // Stored compactly, as the codec says.
    expect(store.getResource(shape.kind, "k", { sourceKey: "test", schemaVersion: 1 })?.value).toEqual(["cash rate", 3.6]);

    setSystemTime(new Date(T0 + MINUTE));
    const restarted = createDiskCache(shape, codec);
    restarted.attach(store);
    expect(restarted.peek("k")).toMatchObject({ data: { label: "cash rate", value: 3.6 }, fetchedAt: T0, stale: false });
    let calls = 0;
    const served = await restarted.load("k", async () => { calls += 1; return { label: "x", value: 0 }; });
    expect(calls).toBe(0);
    expect(served).toMatchObject({ source: "cache", stale: false, data: { value: 3.6 } });
  });

  test("past staleMs a load refetches; a failed refresh keeps the copy with the reason, until it expires", async () => {
    setSystemTime(new Date(T0));
    const store = new MemoryPluginPersistence();
    const cache = createDiskCache(policy(), codec);
    cache.attach(store);
    await cache.load("k", async () => ({ label: "a", value: 1 }));

    setSystemTime(new Date(T0 + 11 * MINUTE));
    expect(cache.peek("k")?.stale).toBe(true);
    const failing = async (): Promise<{ label: string; value: number }> => { throw new Error("rba.gov.au request failed (503)"); };
    const fallback = await cache.load("k", failing);
    expect(fallback).toMatchObject({ source: "stale-fallback", stale: true, fetchedAt: T0, refreshError: "rba.gov.au request failed (503)", data: { value: 1 } });

    const refreshed = await cache.load("k", async () => ({ label: "a", value: 2 }));
    expect(refreshed).toMatchObject({ source: "network", stale: false, data: { value: 2 } });

    setSystemTime(new Date(T0 + 11 * MINUTE + 61 * MINUTE));
    expect(cache.peek("k")).toBeNull();
    await expect(cache.load("k", failing)).rejects.toThrow("503");
  });

  test("force refetches a fresh copy", async () => {
    const cache = createDiskCache(policy(), codec);
    cache.attach(new MemoryPluginPersistence());
    await cache.load("k", async () => ({ label: "a", value: 1 }));
    const forced = await cache.load("k", async () => ({ label: "a", value: 2 }), { force: true });
    expect(forced).toMatchObject({ source: "network", data: { value: 2 } });
  });

  test("a corrupt entry is ignored and replaced", async () => {
    const store = new MemoryPluginPersistence();
    const shape = policy();
    store.seedResource(shape.kind, "k", { not: "a tuple" }, { sourceKey: "test", schemaVersion: 1 });
    const cache = createDiskCache(shape, codec);
    cache.attach(store);
    expect(cache.peek("k")).toBeNull();
    const loaded = await cache.load("k", async () => ({ label: "fresh", value: 5 }));
    expect(loaded).toMatchObject({ source: "network", data: { label: "fresh" } });
  });

  test("an entry from another schema version is dropped", async () => {
    const store = new MemoryPluginPersistence();
    const shape = policy({ schemaVersion: 2 });
    store.seedResource(shape.kind, "k", ["old shape", 1], { sourceKey: "test", schemaVersion: 1 });
    const cache = createDiskCache(shape, codec);
    cache.attach(store);
    expect(cache.peek("k")).toBeNull();
    let calls = 0;
    await cache.load("k", async () => { calls += 1; return { label: "new", value: 2 }; });
    expect(calls).toBe(1);
  });

  test("keeps at most maxEntries per kind on disk, dropping the least recently fetched", async () => {
    const store = new MemoryPluginPersistence();
    const shape = policy({ maxEntries: 2 });
    const cache = createDiskCache(shape, codec);
    cache.attach(store);
    for (const key of ["a", "b", "a", "c"]) await cache.load(key, async () => ({ label: key, value: 1 }), { force: true });
    const stored = (key: string) => store.getResource(shape.kind, key, { sourceKey: "test", schemaVersion: 1 });
    expect(stored("a")).not.toBeNull();
    expect(stored("b")).toBeNull();
    expect(stored("c")).not.toBeNull();
    // A later session no longer finds it.
    const restarted = createDiskCache(shape, codec);
    restarted.attach(store);
    expect(restarted.peek("b")).toBeNull();
    expect(restarted.peek("a")?.data.label).toBe("a");
  });

  test("one caller aborting leaves the request to the others sharing it", async () => {
    const cache = createDiskCache(policy(), codec);
    cache.attach(new MemoryPluginPersistence());
    let release!: () => void;
    let shared: AbortSignal | null = null;
    const loader = (signal: AbortSignal) => {
      shared = signal;
      return new Promise<{ label: string; value: number }>((resolve) => { release = () => resolve({ label: "a", value: 1 }); });
    };
    const leaving = new AbortController();
    const first = cache.load("k", loader, { signal: leaving.signal });
    const second = cache.load("k", loader);
    await Bun.sleep(1);
    leaving.abort();
    expect(await first.catch((error) => error.name)).toBe("AbortError");
    expect(shared!.aborted).toBe(false);
    release();
    expect(await second).toMatchObject({ source: "network", stale: false, data: { value: 1 } });
    expect(cache.peek("k")?.data.value).toBe(1);
  });

  test("the request is abandoned once every caller has aborted, and the next caller starts afresh", async () => {
    const cache = createDiskCache(policy(), codec);
    cache.attach(new MemoryPluginPersistence());
    const signals: AbortSignal[] = [];
    const hanging = (signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<{ label: string; value: number }>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    };
    const a = new AbortController();
    const b = new AbortController();
    const first = cache.load("k", hanging, { signal: a.signal });
    const second = cache.load("k", hanging, { signal: b.signal });
    await Bun.sleep(1);
    a.abort();
    expect(signals[0]!.aborted).toBe(false);
    b.abort();
    expect(signals[0]!.aborted).toBe(true);
    expect(await first.catch((error) => error.name)).toBe("AbortError");
    expect(await second.catch((error) => error.name)).toBe("AbortError");
    const next = await cache.load("k", async () => ({ label: "b", value: 2 }));
    expect(next).toMatchObject({ source: "network", data: { value: 2 } });
  });

  test("an abort over a stale copy does not report a failed refresh to the caller still waiting", async () => {
    setSystemTime(new Date(T0));
    const cache = createDiskCache(policy(), codec);
    cache.attach(new MemoryPluginPersistence());
    await cache.load("k", async () => ({ label: "old", value: 1 }));
    setSystemTime(new Date(T0 + 20 * MINUTE));
    const leaving = new AbortController();
    const slow = (signal: AbortSignal) => new Promise<{ label: string; value: number }>((resolve, reject) => {
      const timer = setTimeout(() => resolve({ label: "new", value: 2 }), 20);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("The operation was aborted")); });
    });
    const first = cache.load("k", slow, { signal: leaving.signal }).catch(() => null);
    const second = cache.load("k", slow);
    await Bun.sleep(1);
    leaving.abort();
    await first;
    const result = await second;
    expect(result.refreshError).toBeUndefined();
    expect(result).toMatchObject({ source: "network", data: { value: 2 } });
  });

  test("a failed forced refresh of a fresh copy is not reported again by later plain loads", async () => {
    setSystemTime(new Date(T0));
    const cache = createDiskCache(policy(), codec);
    cache.attach(new MemoryPluginPersistence());
    await cache.load("k", async () => ({ label: "a", value: 1 }));
    const forced = await cache.load("k", async () => { throw new Error("down"); }, { force: true });
    expect(forced).toMatchObject({ source: "stale-fallback", refreshError: "down" });
    setSystemTime(new Date(T0 + MINUTE));
    let calls = 0;
    const plain = await cache.load("k", async () => { calls += 1; return { label: "x", value: 0 }; });
    expect(calls).toBe(0);
    expect(plain).toEqual({ source: "cache", stale: false, fetchedAt: T0, data: { label: "a", value: 1 } });
  });

  test("a damaged entry index does not fail a load that succeeded", async () => {
    const store = new MemoryPluginPersistence();
    const shape = policy();
    store.setState(`cache-index:${shape.kind}`, { not: "a list" }, { schemaVersion: 1 });
    const cache = createDiskCache(shape, codec);
    cache.attach(store);
    const loaded = await cache.load("k", async () => ({ label: "a", value: 1 }));
    expect(loaded.source).toBe("network");
    expect(store.getState<string[]>(`cache-index:${shape.kind}`, { schemaVersion: 1 })).toEqual(["k"]);
  });

  test("a copy dated well ahead of the clock is refetched rather than served as fresh", async () => {
    const store = new MemoryPluginPersistence();
    const shape = policy({ staleMs: 2 * MINUTE, expireMs: 1_440 * MINUTE });
    setSystemTime(new Date(T0 + 60 * MINUTE));
    const skewed = createDiskCache(shape, codec);
    skewed.attach(store);
    await skewed.load("k", async () => ({ label: "ahead", value: 1 }));

    setSystemTime(new Date(T0));
    const cache = createDiskCache(shape, codec);
    cache.attach(store);
    expect(cache.peek("k")?.stale).toBe(true);
    const loaded = await cache.load("k", async () => ({ label: "now", value: 2 }));
    expect(loaded).toMatchObject({ source: "network", fetchedAt: T0, data: { label: "now" } });
  });

  test("without persistence it is a memory cache with the same rules", async () => {
    const cache = createDiskCache(policy(), codec);
    let calls = 0;
    const loader = async () => { calls += 1; return { label: "a", value: calls }; };
    await cache.load("k", loader);
    const second = await cache.load("k", loader);
    expect(calls).toBe(1);
    expect(second.source).toBe("cache");
  });
});

describe("codec helpers", () => {
  test("points round-trip through two columns; mismatched columns are refused", () => {
    const points = [{ date: "2026-09-30", value: 3.6 }, { date: "2026-10-01", value: 3.85 }];
    expect(decodePoints(JSON.parse(JSON.stringify(encodePoints(points))), "points")).toEqual(points);
    expect(() => decodePoints([["2026-10-01"], []], "points")).toThrow();
    expect(() => decodePoints([["2026-10-01"], ["3.6"]], "points")).toThrow();
    expect(() => decodePoints("junk", "points")).toThrow();
  });

  test("combineMeta is as old as the oldest part and carries each part's failure", () => {
    expect(combineMeta([null])).toBeNull();
    expect(combineMeta([
      { label: "F1", meta: { fetchedAt: 200, stale: false } },
      { label: "F2", meta: { fetchedAt: 100, stale: true, refreshError: "down" } },
      null,
    ])).toEqual({ fetchedAt: 100, stale: true, refreshError: "F2: down" });
  });
});
