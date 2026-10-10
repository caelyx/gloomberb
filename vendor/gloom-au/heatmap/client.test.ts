import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { DataProvider, QuoteBatchResult, QuoteSubscriptionTarget } from "gloomberb/types/data-provider";
import scan from "./fixtures/tradingview-xjo.json";
import { createHeatmapLoader, INDEX_SCAN_URL, QUOTE_BATCH_SIZE } from "./client";
import { parseIndexScan, type Listing } from "./model";

const members = parseIndexScan(scan);

/** The directory for every scan member, Banks for all; CBA without a market cap, as ASX publishes it. */
const directory: Listing[] = members.map((member) => ({
  code: member.code,
  name: member.name,
  industryGroup: "Banks",
  marketCap: member.code === "CBA" ? null : member.marketCap,
}));

const RATE_LIMIT = "Anonymous market rate limit exceeded";

/**
 * A host that quotes every symbol, recording batches. Like Gloomberb's router
 * it never throws for a refused batch: it resolves with a null quote and the
 * reason, as a string, for each name. `fail` refuses a whole call by its
 * number, `refuse` single symbols.
 */
function fakeProvider(fail: (call: number) => boolean = () => false, refuse: (symbol: string) => string | null = () => null) {
  const batches: string[][] = [];
  const provider = {
    async getQuotesBatch(targets: QuoteSubscriptionTarget[]): Promise<QuoteBatchResult[]> {
      batches.push(targets.map((target) => target.symbol));
      const refused = fail(batches.length);
      return targets.map((target) => {
        const reason = refused ? RATE_LIMIT : refuse(target.symbol);
        if (reason) return { target, quote: null, error: reason as unknown as Error };
        return {
          target,
          quote: { symbol: target.symbol, price: 10, change: 0.1, changePercent: 1, currency: "AUD", lastUpdated: 1_700_000_000_000, marketCap: target.symbol === "CBA.AX" ? 300e9 : 1e9 },
        };
      });
    },
  } as unknown as DataProvider;
  return { provider, batches };
}

function transport(respond: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  return {
    calls,
    transport: async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return respond();
    },
  };
}

const loader = (respond: () => Response | Promise<Response>, deps: Parameters<typeof createHeatmapLoader>[0] = {}) => {
  const http = transport(respond);
  return { ...http, loader: createHeatmapLoader({ transport: http.transport, directory: async () => directory, ...deps }) };
};

const MINUTE = 60_000;

afterEach(() => {
  setSystemTime();
});

describe("heatmap loader", () => {
  test("the ASX 50 from the scan: one POST, one quote batch of .AX symbols", async () => {
    const { loader: heatmap, calls } = loader(() => Response.json(scan));
    const { provider, batches } = fakeProvider();
    const board = await heatmap.load(provider, { universe: "asx50", source: "tradingview" });
    expect(calls[0]?.url).toBe(INDEX_SCAN_URL);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body)).symbols.groups).toEqual([{ type: "index", values: ["ASX:XJO"] }]);
    expect(board).toMatchObject({ ranked: false, fallback: null, missingQuotes: 0 });
    expect(board.assets).toHaveLength(50);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toContain("BHP.AX");
  });

  test("a 403 from the scanner falls back to the top 50 by market cap, filling CBA's cap from its quote", async () => {
    const { loader: heatmap } = loader(() => new Response("Forbidden", { status: 403 }));
    const { provider } = fakeProvider();
    const board = await heatmap.load(provider, { universe: "asx50", source: "tradingview" });
    expect(board.ranked).toBe(true);
    expect(board.fallback).toBe("request failed (403)");
    expect(board.assets).toHaveLength(50);
    expect(board.assets.find((tile) => tile.label === "CBA")?.size).toBe(300e9);
  });

  test("a network error, a non-JSON body or an empty scan fall back the same way", async () => {
    for (const respond of [
      () => Promise.reject(new TypeError("fetch failed")),
      () => new Response("<html>", { status: 200 }),
      () => Response.json({ totalCount: 0, data: [] }),
    ]) {
      const { loader: heatmap } = loader(respond);
      const board = await heatmap.load(fakeProvider().provider, { universe: "asx50", source: "tradingview" });
      expect(board.ranked).toBe(true);
      expect(board.fallback).toBeTruthy();
    }
  });

  test("the market-cap source never asks the scanner and is not a fallback", async () => {
    const { loader: heatmap, calls } = loader(() => Response.json(scan));
    const board = await heatmap.load(fakeProvider().provider, { universe: "asx50", source: "market-cap" });
    expect(calls).toHaveLength(0);
    expect(board).toMatchObject({ ranked: true, fallback: null });
  });

  test("the ASX 200 is quoted in batches of at most 100; a refused batch costs only its own tiles", async () => {
    const { loader: heatmap } = loader(() => Response.json(scan));
    const { provider, batches } = fakeProvider((call) => call === 2);
    const board = await heatmap.load(provider, { universe: "asx200", source: "tradingview" });
    expect(batches.map((batch) => batch.length)).toEqual([QUOTE_BATCH_SIZE, 99]);
    expect(board.assets).toHaveLength(100);
    expect(board).toMatchObject({ missingQuotes: 99, rateLimited: true });
  });

  test("after a rate-limited batch the rest are not asked for, and a board with no quotes says why", async () => {
    const { loader: heatmap } = loader(() => Response.json(scan));
    const { provider, batches } = fakeProvider(() => true);
    await expect(heatmap.load(provider, { universe: "asx200", source: "tradingview" })).rejects.toThrow("limit for signed-out use");
    expect(batches).toHaveLength(1);
  });

  test("single names the host could not quote are counted as missing, with no rate limit", async () => {
    const { loader: heatmap } = loader(() => Response.json(scan));
    const { provider } = fakeProvider(() => false, (symbol) => (symbol === "BHP.AX" || symbol === "CSL.AX" ? "No quote" : null));
    const board = await heatmap.load(provider, { universe: "asx50", source: "tradingview" });
    expect(board).toMatchObject({ missingQuotes: 2, rateLimited: false });
    expect(board.assets).toHaveLength(48);
  });

  test("a market-cap fill with refusals is kept for ten minutes, not twelve hours", async () => {
    let now = 1_700_000_000_000;
    const { loader: heatmap } = loader(() => Response.json(scan), { now: () => now });
    const refusing = fakeProvider(() => false, (symbol) => (symbol === "CBA.AX" ? RATE_LIMIT : null));
    const first = await heatmap.load(refusing.provider, { universe: "asx50", source: "market-cap" });
    expect(first.assets.some((tile) => tile.label === "CBA")).toBe(false);
    now += 11 * MINUTE;
    const later = await heatmap.load(fakeProvider().provider, { universe: "asx50", source: "market-cap", force: true });
    expect(later.assets.find((tile) => tile.label === "CBA")?.size).toBe(300e9);
  });

  test("a failed refresh keeps the last board, marked with the failure and its build time", async () => {
    let now = 1_700_000_000_000;
    const { loader: heatmap } = loader(() => Response.json(scan), { now: () => now });
    const first = await heatmap.load(fakeProvider().provider, { universe: "asx50", source: "tradingview" });
    expect(first.refreshError).toBeNull();
    now += 2 * MINUTE;
    const kept = await heatmap.load(fakeProvider(() => true).provider, { universe: "asx50", source: "tradingview", force: true });
    expect(kept.assets).toHaveLength(50);
    expect(kept.builtAt).toBe(first.builtAt);
    expect(kept.refreshError).toContain("limit for signed-out use");
    now += 10 * MINUTE;
    await expect(heatmap.load(fakeProvider(() => true).provider, { universe: "asx50", source: "tradingview", force: true })).rejects.toThrow();
  });

  test("a day-old member list stands in for a failed scan, flagged, and the scanner backs off", async () => {
    const start = new Date("2026-10-01T00:00:00Z");
    setSystemTime(start);
    let now = start.getTime();
    let fail = false;
    const { loader: heatmap, calls } = loader(() => (fail ? new Response("Forbidden", { status: 403 }) : Response.json(scan)), { now: () => now });
    await heatmap.load(fakeProvider().provider, { universe: "asx50", source: "tradingview" });
    fail = true;
    now += 25 * 60 * MINUTE;
    setSystemTime(new Date(now));
    const board = await heatmap.load(fakeProvider().provider, { universe: "asx50", source: "tradingview" });
    expect(board).toMatchObject({ ranked: false, fallback: null, membersAsOf: start.getTime() });
    const asked = calls.length;
    now += 2 * MINUTE;
    setSystemTime(new Date(now));
    await heatmap.load(fakeProvider().provider, { universe: "asx50", source: "tradingview" });
    expect(calls.length).toBe(asked);
  });

  test("a scan without ASX 50 tags falls back to the ranking rather than an empty board", async () => {
    const untagged = { ...scan, data: (scan as { data: Array<{ s: string; d: unknown[] }> }).data.map((row) => ({ ...row, d: [row.d[0], row.d[1], row.d[2], [{ proname: "ASX:XJO" }]] })) };
    const { loader: heatmap } = loader(() => Response.json(untagged));
    const board = await heatmap.load(fakeProvider().provider, { universe: "asx50", source: "tradingview" });
    expect(board.ranked).toBe(true);
    expect(board.fallback).toContain("only 0 ASX 50 members");
    expect(board.assets).toHaveLength(50);
  });

  test("the Sectors board without the directory sizes the indices evenly instead of failing", async () => {
    const { loader: heatmap } = loader(() => new Response("Forbidden", { status: 403 }), { directory: () => Promise.reject(new Error("down")) });
    const board = await heatmap.load(fakeProvider().provider, { universe: "sectors", source: "tradingview" });
    expect(board.assets).toHaveLength(11);
    expect(board.assets.every((tile) => tile.size === null)).toBe(true);
    expect(board.sectorsUnavailable).toBe(true);
  });

  test("the Sectors board quotes the eleven sector indices", async () => {
    const { loader: heatmap } = loader(() => Response.json(scan));
    const { provider, batches } = fakeProvider();
    const board = await heatmap.load(provider, { universe: "sectors", source: "tradingview" });
    expect(batches).toEqual([["^AXEJ", "^AXMJ", "^AXNJ", "^AXDJ", "^AXSJ", "^AXHJ", "^AXFJ", "^AXIJ", "^AXTJ", "^AXUJ", "^AXPJ"]]);
    // Every fake company is a bank, so only Financials has weight.
    expect(board.assets.filter((tile) => tile.size).map((tile) => tile.symbol)).toEqual(["^AXFJ"]);
  });
});
