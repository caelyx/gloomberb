import { describe, expect, test } from "bun:test";
import { MAX_RULES, createRule, describeRule, readRules, toggleRule } from "./rules";

const NOW = Date.parse("2026-10-10T00:00:00Z");

describe("createRule", () => {
  test("a ticker rule takes the code as typed, with or without .AX", () => {
    expect(createRule({ event: "halt", scope: "ticker", code: "bhp.ax" }, [], NOW)).toMatchObject({
      event: "halt", scope: "ticker", code: "BHP", priceSensitiveOnly: false, keyword: null, status: "active", createdAt: NOW,
    });
    expect(createRule({ event: "halt", scope: "ticker", code: " cba " }, [], NOW).code).toBe("CBA");
  });

  test("a ticker rule needs a valid ASX code", () => {
    expect(() => createRule({ event: "halt", scope: "ticker", code: "" }, [], NOW)).toThrow(/ASX code/);
    expect(() => createRule({ event: "halt", scope: "ticker", code: "AAPL.US" }, [], NOW)).toThrow(/ASX code/);
  });

  test("watched and market rules carry no code", () => {
    expect(createRule({ event: "results", scope: "watched", code: "BHP" }, [], NOW).code).toBeNull();
    expect(createRule({ event: "halt", scope: "market" }, [], NOW).code).toBeNull();
  });

  test("price-sensitive and keyword filters are read and normalised", () => {
    const rule = createRule({ event: "any", scope: "watched", priceSensitive: "yes", keyword: "  Lithium   Offtake " }, [], NOW);
    expect(rule.priceSensitiveOnly).toBe(true);
    expect(rule.keyword).toBe("lithium offtake");
    expect(() => createRule({ event: "any", scope: "watched", keyword: "x".repeat(81) }, [], NOW)).toThrow(/keyword/);
  });

  test("every announcement on the whole market is refused as too broad", () => {
    expect(() => createRule({ event: "any", scope: "market" }, [], NOW)).toThrow(/too broad/i);
    expect(createRule({ event: "any", scope: "market", priceSensitive: "yes" }, [], NOW).scope).toBe("market");
    expect(createRule({ event: "any", scope: "market", keyword: "takeover" }, [], NOW).keyword).toBe("takeover");
  });

  test("results and dividends on the whole market need a narrowing filter too; halts do not", () => {
    expect(() => createRule({ event: "results", scope: "market" }, [], NOW)).toThrow(/too broad/i);
    expect(() => createRule({ event: "dividend", scope: "market" }, [], NOW)).toThrow(/too broad/i);
    expect(createRule({ event: "results", scope: "market", priceSensitive: "yes" }, [], NOW).event).toBe("results");
    expect(createRule({ event: "dividend", scope: "watched" }, [], NOW).event).toBe("dividend");
    expect(createRule({ event: "halt", scope: "market" }, [], NOW).event).toBe("halt");
  });

  test("dividend date rules take the dates and a lead time, and not the whole market", () => {
    const rule = createRule({ event: "dividend-dates", scope: "ticker", code: "CBA", dates: "ex,pay", leadDays: "3" }, [], NOW);
    expect(rule).toMatchObject({ dates: ["ex", "pay"], leadDays: 3 });
    expect(createRule({ event: "dividend-dates", scope: "watched" }, [], NOW)).toMatchObject({ dates: ["ex"], leadDays: 1 });
    expect(createRule({ event: "dividend-dates", scope: "watched", dates: "all" }, [], NOW).dates).toEqual(["ex", "record", "pay"]);
    expect(() => createRule({ event: "dividend-dates", scope: "market" }, [], NOW)).toThrow(/whole market/);
    expect(() => createRule({ event: "dividend-dates", scope: "watched", leadDays: "15" }, [], NOW)).toThrow(/0 to 14/);
    expect(() => createRule({ event: "dividend-dates", scope: "watched", leadDays: "1.5" }, [], NOW)).toThrow(/0 to 14/);
  });

  test("an unknown event or scope is refused", () => {
    expect(() => createRule({ event: "earnings", scope: "ticker", code: "BHP" }, [], NOW)).toThrow(/event/);
    expect(() => createRule({ event: "halt", scope: "sector" }, [], NOW)).toThrow(/whom/);
  });

  test("the same rule twice is refused, and so is one past the limit", () => {
    const first = createRule({ event: "halt", scope: "ticker", code: "BHP" }, [], NOW);
    expect(() => createRule({ event: "halt", scope: "ticker", code: "BHP.AX" }, [first], NOW)).toThrow(/already/);
    expect(createRule({ event: "halt", scope: "ticker", code: "BHP", priceSensitive: "yes" }, [first], NOW).priceSensitiveOnly).toBe(true);
    const many = Array.from({ length: MAX_RULES }, (_, index) => ({ ...first, id: `r${index}`, keyword: `k${index}` }));
    expect(() => createRule({ event: "halt", scope: "market" }, many, NOW)).toThrow(/at most/);
  });
});

describe("readRules", () => {
  test("keeps the valid rules and drops the rest, so one bad entry cannot hide the others", () => {
    const good = createRule({ event: "halt", scope: "ticker", code: "BHP" }, [], NOW);
    const rules = readRules([good, { ...good, id: "x", event: "nonsense" }, null, "junk", { ...good, id: good.id }]);
    expect(rules).toEqual([good]);
    expect(readRules(undefined)).toEqual([]);
    expect(readRules({ not: "an array" })).toEqual([]);
  });
});

describe("toggleRule", () => {
  test("pausing keeps the rule; resuming starts it afresh, so nothing from the pause fires", () => {
    const rule = createRule({ event: "halt", scope: "market" }, [], NOW);
    const paused = toggleRule(rule, NOW + 1000);
    expect(paused).toMatchObject({ status: "paused", createdAt: NOW });
    expect(toggleRule(paused, NOW + 5000)).toMatchObject({ status: "active", createdAt: NOW + 5000 });
  });
});

describe("describeRule", () => {
  test("says what is followed, in words", () => {
    expect(describeRule(createRule({ event: "halt", scope: "ticker", code: "BHP" }, [], NOW))).toBe("Trading halts · BHP");
    expect(describeRule(createRule({ event: "any", scope: "market", priceSensitive: "yes", keyword: "lithium" }, [], NOW)))
      .toBe("Any announcement · whole market · price-sensitive · \"lithium\"");
    expect(describeRule(createRule({ event: "dividend-dates", scope: "watched", dates: "ex,pay", leadDays: "2" }, [], NOW)))
      .toBe("Dividend dates · portfolios and watchlists · ex, pay · 2 days ahead");
  });
});
