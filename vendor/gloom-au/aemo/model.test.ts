import { describe, expect, test } from "bun:test";
import { nemTimeToUtc, parseFiveMinute, parseNemSummary, regionDay } from "./model";

describe("NEM time", () => {
  test("market time is UTC+10 all year, even while Sydney is on daylight time", () => {
    expect(new Date(nemTimeToUtc("2026-10-08T21:55:00")!).toISOString()).toBe("2026-10-08T11:55:00.000Z");
    expect(new Date(nemTimeToUtc("2026-06-08T21:55:00")!).toISOString()).toBe("2026-06-08T11:55:00.000Z");
  });
});

describe("parsers", () => {
  test("summary rows and notices; a missing summary is a format error", () => {
    const summary = parseNemSummary({
      ELEC_NEM_SUMMARY: [{ SETTLEMENTDATE: "2026-10-08T21:50:00", REGIONID: "SA1", PRICE: -1.3567, TOTALDEMAND: 1434.32, PRICE_STATUS: "FIRM" }],
      ELEC_NEM_SUMMARY_MARKET_NOTICE: [{ NOTICEID: 1, EFFECTIVEDATE: "2026-10-08T21:18:56", TYPEID: "RECLASSIFY CONTINGENCY", EXTERNALREFERENCE: "Cancellation" }],
    });
    expect(summary.regions[0]).toMatchObject({ region: "SA1", price: -1.3567, demand: 1434.32, status: "FIRM" });
    expect(summary.notices[0]).toMatchObject({ id: 1, type: "RECLASSIFY CONTINGENCY", title: "Cancellation" });
    expect(() => parseNemSummary({})).toThrow(/not recognised/);
  });

  test("24-hour figures use actual intervals only, and count negative prices", () => {
    const now = nemTimeToUtc("2026-10-08T22:00:00")!;
    const points = parseFiveMinute({ "5MIN": [
      { SETTLEMENTDATE: "2026-10-08T21:50:00", REGIONID: "SA1", RRP: -10, PERIODTYPE: "ACTUAL" },
      { SETTLEMENTDATE: "2026-10-08T21:55:00", REGIONID: "SA1", RRP: 30, PERIODTYPE: "ACTUAL" },
      { SETTLEMENTDATE: "2026-10-08T22:05:00", REGIONID: "SA1", RRP: 900, PERIODTYPE: "FORECAST" },
      { SETTLEMENTDATE: "2026-10-07T21:00:00", REGIONID: "SA1", RRP: 500, PERIODTYPE: "ACTUAL" },
    ] });
    expect(regionDay(points, "SA1", now)).toEqual({ average: 10, low: -10, high: 30, negativeShare: 0.5 });
    expect(regionDay(points, "NSW1", now).average).toBeNull();
  });
});
