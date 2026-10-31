import { describe, expect, test } from "bun:test";
import type { FrankingSnapshot } from "../franking/model";
import { dueDividendDates } from "./dividend-dates";
import { createRule } from "./rules";

const NOW = Date.parse("2026-10-01T00:00:00Z");
const snapshot: FrankingSnapshot = {
  code: "CBA", amount: 2.25, declaredCurrency: null, declaredAmount: null, kind: "final", frankingPercent: 100,
  exDate: "2026-10-14", recordDate: "2026-10-15", payDate: "2026-10-28", annualYield: 0.03,
};
const rule = (values: Record<string, string>) => createRule({ event: "dividend-dates", scope: "ticker", code: "CBA", ...values }, [], NOW);

describe("dueDividendDates", () => {
  test("a date is due from the lead time before it until the day itself (Sydney dates)", () => {
    const ex1 = rule({ dates: "ex", leadDays: "1" });
    expect(dueDividendDates(ex1, snapshot, "2026-10-12")).toEqual([]);
    expect(dueDividendDates(ex1, snapshot, "2026-10-13")).toEqual([{ kind: "ex", date: "2026-10-14", daysAway: 1 }]);
    expect(dueDividendDates(ex1, snapshot, "2026-10-14")).toEqual([{ kind: "ex", date: "2026-10-14", daysAway: 0 }]);
    expect(dueDividendDates(ex1, snapshot, "2026-10-15")).toEqual([]);
  });

  test("only the dates the rule follows", () => {
    const all = rule({ dates: "all", leadDays: "14" });
    expect(dueDividendDates(all, snapshot, "2026-10-14").map((due) => due.kind)).toEqual(["ex", "record", "pay"]);
    expect(dueDividendDates(rule({ dates: "pay", leadDays: "0" }), snapshot, "2026-10-28")).toEqual([{ kind: "pay", date: "2026-10-28", daysAway: 0 }]);
  });

  test("a missing or malformed date is skipped", () => {
    expect(dueDividendDates(rule({ dates: "all", leadDays: "14" }), { ...snapshot, exDate: null, recordDate: "soon" }, "2026-10-14"))
      .toEqual([{ kind: "pay", date: "2026-10-28", daysAway: 14 }]);
  });
});
