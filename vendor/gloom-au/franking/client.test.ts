import { afterEach, expect, setSystemTime, test } from "bun:test";
import { loadFranking, loadFrankingWithin } from "./client";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-11T00:00:00Z");
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setSystemTime();
});

test("loadFrankingWithin reuses a copy younger than the limit, past the cache's own six hours", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ data: { dividend: 1.1, dividendType: "I", frankingPercent: 100, dateExDate: "2026-11-01T00:00:00" } }));
  }) as unknown as typeof fetch;

  setSystemTime(new Date(T0));
  expect((await loadFranking("WITHIN")).exDate).toBe("2026-11-01");
  expect(calls).toBe(1);

  setSystemTime(new Date(T0 + 10 * HOUR));
  await loadFrankingWithin("WITHIN", 24 * HOUR);
  expect(calls).toBe(1);

  setSystemTime(new Date(T0 + 25 * HOUR));
  await loadFrankingWithin("WITHIN", 24 * HOUR);
  expect(calls).toBe(2);
});
