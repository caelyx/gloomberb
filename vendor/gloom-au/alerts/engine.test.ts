import { describe, expect, test } from "bun:test";
import type { AsxAnnouncement } from "../announcements/model";
import type { FrankingSnapshot } from "../franking/model";
import { EMPTY_STATE, runCheck, type AlertState, type CheckDeps } from "./engine";
import { createRule, type AuAlertRule } from "./rules";

const MIN = 60_000;
const NOW = Date.parse("2026-10-09T05:00:00Z");

let serial = 0;
function item(code: string, minutesAgo: number, types: string[] = ["Progress Report"], over: Partial<AsxAnnouncement> = {}): AsxAnnouncement {
  serial += 1;
  return {
    id: `mkt:${code}-${serial}`, code, companyName: null, documentKey: `${serial}`, releasedAt: NOW - minutesAgo * MIN,
    headline: `${code} ${types[0]}`, priceSensitive: true, category: "other", types, pages: null, size: null,
    documentUrl: `https://cdn.example/${serial}`, ...over,
  };
}

/** A feed newest first, served in pages of `size`, counting requests. */
function feed(items: AsxAnnouncement[], size = 3) {
  const sorted = [...items].sort((a, b) => b.releasedAt - a.releasedAt);
  const calls: number[] = [];
  return {
    calls,
    fetchPage: async (page: number) => {
      calls.push(page);
      return sorted.slice(page * size, (page + 1) * size);
    },
  };
}

const dividend: FrankingSnapshot = {
  code: "CBA", amount: 2.25, declaredCurrency: null, declaredAmount: null, kind: "final", frankingPercent: 100,
  exDate: "2026-10-10", recordDate: "2026-10-11", payDate: "2026-10-28", annualYield: 0.03,
};

function deps(over: Partial<CheckDeps> & { rules: AuAlertRule[] }): CheckDeps {
  return {
    now: NOW,
    state: EMPTY_STATE,
    fetchPage: async () => { throw new Error("no feed expected"); },
    loadDividend: async () => { throw new Error("no dividend expected"); },
    watchedCodes: async () => { throw new Error("no watchlist expected"); },
    ...over,
  };
}

const halts = (createdAt = NOW - 120 * MIN) => createRule({ event: "halt", scope: "market" }, [], createdAt);

describe("runCheck: announcements", () => {
  test("no active rules: nothing is requested", async () => {
    const paused = { ...halts(), status: "paused" as const };
    const result = await runCheck(deps({ rules: [paused], state: { ...EMPTY_STATE, cursor: { latest: NOW - MIN, seen: [] } } }));
    expect(result.fired).toEqual([]);
    expect(result.state.cursor).toBeNull();
    expect(result.state.lastCheckAt).toBe(NOW);
  });

  test("the first check reads back to when the rule was made, and no further", async () => {
    const source = feed([item("NMR", 10, ["Trading Halt"]), item("XYZ", 20), item("OLD", 200, ["Trading Halt"]), item("OLDER", 300), item("X", 400)]);
    const result = await runCheck(deps({ rules: [halts()], fetchPage: source.fetchPage }));
    expect(result.fired.map((alert) => [alert.code, alert.label])).toEqual([["NMR", "Trading halt"]]);
    expect(source.calls).toEqual([0]);
    expect(result.state.cursor?.latest).toBe(NOW - 10 * MIN);
    expect(result.complete).toBe(true);
  });

  test("the next check fires only what is new, including a late arrival inside the overlap", async () => {
    const first = item("NMR", 10, ["Trading Halt"]);
    const state: AlertState = { ...EMPTY_STATE, cursor: { latest: first.releasedAt, seen: [first.id] } };
    // Released 15 minutes ago (before the cursor) but not in the feed when it was last read.
    const late = item("LATE", 15, ["Trading Halt"]);
    const fresh = item("NEW", 2, ["Trading Halt"]);
    const source = feed([fresh, first, late, item("OLD", 90, ["Trading Halt"])], 10);
    const result = await runCheck(deps({ rules: [halts()], state, fetchPage: source.fetchPage }));
    expect(result.fired.map((alert) => alert.code).sort()).toEqual(["LATE", "NEW"]);
    expect(result.state.cursor?.seen).toEqual(expect.arrayContaining([fresh.id, first.id, late.id]));
  });

  test("pages back until it reaches the last check, and stops at the page limit", async () => {
    const many = Array.from({ length: 12 }, (_, index) => item(`C${index}`, index + 1, ["Trading Halt"]));
    const state: AlertState = { ...EMPTY_STATE, cursor: { latest: NOW - 60 * MIN, seen: [] } };
    const all = feed([...many, item("OLD", 120)], 3);
    const done = await runCheck(deps({ rules: [halts(NOW - 600 * MIN)], state, fetchPage: all.fetchPage }));
    expect(all.calls).toEqual([0, 1, 2, 3, 4]);
    expect(done.fired).toHaveLength(12);
    expect(done.complete).toBe(true);

    const capped = feed([...many, item("OLD", 120)], 3);
    const partial = await runCheck(deps({ rules: [halts(NOW - 600 * MIN)], state, fetchPage: capped.fetchPage, maxPages: 2 }));
    expect(capped.calls).toEqual([0, 1]);
    expect(partial.fired).toHaveLength(6);
    expect(partial.complete).toBe(false);
    expect(partial.notes.join(" ")).toMatch(/not checked/);
  });

  test("an item stamped in the future cannot push the cursor past the clock", async () => {
    const future = item("ODD", -24 * 60, ["Trading Halt"]);
    const source = feed([future, item("NMR", 10, ["Trading Halt"]), item("OLD", 500)], 10);
    const result = await runCheck(deps({ rules: [halts()], fetchPage: source.fetchPage }));
    expect(result.state.cursor?.latest).toBe(NOW);
    // An hour later, an item released 20 minutes ago is still caught.
    const later = item("LATER", -40, ["Trading Halt"]);
    const next = feed([future, later, item("OLD", 500)], 10);
    const again = await runCheck(deps({ rules: [halts()], state: result.state, now: NOW + 60 * MIN, fetchPage: next.fetchPage }));
    expect(again.fired.map((alert) => alert.code)).toEqual(["LATER"]);
  });

  test("a page that shifts while paging does not fire twice", async () => {
    const a = item("A", 1, ["Trading Halt"]);
    const b = item("B", 2, ["Trading Halt"]);
    const c = item("C", 3, ["Trading Halt"]);
    const old = item("OLD", 500);
    const pages = [[a, b], [b, c], [old]];
    const result = await runCheck(deps({ rules: [halts()], fetchPage: async (page) => pages[page] ?? [] }));
    expect(result.fired.map((alert) => alert.code)).toEqual(["A", "B", "C"]);
  });

  test("one announcement matching two rules is one alert", async () => {
    const watchedHalts = createRule({ event: "halt", scope: "watched" }, [], NOW - 120 * MIN);
    const source = feed([item("NMR", 10, ["Trading Halt"]), item("OLD", 500)]);
    const market = halts();
    const result = await runCheck(deps({ rules: [market, watchedHalts], fetchPage: source.fetchPage, watchedCodes: async () => new Set(["NMR"]) }));
    expect(result.fired).toHaveLength(1);
    expect(result.fired[0]!.ruleIds).toEqual([market.id, watchedHalts.id]);
  });

  test("a feed failure keeps the cursor, so the next check catches up", async () => {
    const state: AlertState = { ...EMPTY_STATE, cursor: { latest: NOW - 60 * MIN, seen: ["x"] } };
    const result = await runCheck(deps({ rules: [halts()], state, fetchPage: async () => { throw new Error("HTTP 503"); } }));
    expect(result.errors).toEqual(["ASX announcements: HTTP 503"]);
    expect(result.state.cursor).toEqual(state.cursor);
  });

  test("the watchlist is read only when a rule follows it", async () => {
    let reads = 0;
    const source = feed([item("OLD", 500)]);
    await runCheck(deps({ rules: [halts()], fetchPage: source.fetchPage, watchedCodes: async () => { reads += 1; return new Set(); } }));
    expect(reads).toBe(0);
  });
});

describe("runCheck: dividend dates", () => {
  const exRule = createRule({ event: "dividend-dates", scope: "ticker", code: "CBA", dates: "ex", leadDays: "1" }, [], NOW - 60 * MIN);

  test("fires once when a date comes due, and not again", async () => {
    // 05:00Z on 9 October is 16:00 in Sydney, so the ex-date (10 October) is a day away.
    const first = await runCheck(deps({ rules: [exRule], loadDividend: async () => dividend }));
    expect(first.fired.map((alert) => [alert.code, alert.label, alert.at])).toEqual([["CBA", "Ex-dividend tomorrow", Date.parse("2026-10-10T00:00:00Z")]]);
    expect(first.fired[0]!.headline).toMatch(/A\$2\.25.*100% franked/);
    const again = await runCheck(deps({ rules: [exRule], state: first.state, loadDividend: async () => dividend }));
    expect(again.fired).toEqual([]);
  });

  test("a dividend announcement in this check's feed asks for that company's dividend afresh", async () => {
    const announced = createRule({ event: "dividend", scope: "ticker", code: "CBA" }, [], NOW - 60 * MIN);
    const asked: Array<[string, boolean]> = [];
    const source = feed([item("CBA", 5, ["Dividend Rate"]), item("OLD", 500)], 10);
    await runCheck(deps({
      rules: [exRule, announced, createRule({ event: "dividend-dates", scope: "ticker", code: "BHP" }, [], NOW - 60 * MIN)],
      fetchPage: source.fetchPage,
      loadDividend: async (code, refresh) => { asked.push([code, refresh]); return dividend; },
    }));
    expect(asked.sort()).toEqual([["BHP", false], ["CBA", true]]);
  });

  test("covers every ASX holding for a watched rule; one company failing does not stop the rest", async () => {
    const watched = createRule({ event: "dividend-dates", scope: "watched", dates: "ex", leadDays: "1" }, [], NOW - 60 * MIN);
    const asked: string[] = [];
    const result = await runCheck(deps({
      rules: [watched],
      watchedCodes: async () => new Set(["CBA", "BAD"]),
      loadDividend: async (code) => {
        asked.push(code);
        if (code === "BAD") throw new Error("HTTP 404");
        return dividend;
      },
    }));
    expect(asked.sort()).toEqual(["BAD", "CBA"]);
    expect(result.fired.map((alert) => alert.code)).toEqual(["CBA"]);
    expect(result.errors).toEqual(["Dividend dates for BAD: HTTP 404"]);
  });
});
