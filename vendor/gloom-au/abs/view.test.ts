import { describe, expect, test } from "bun:test";
import { chartPoints, formatPeriod } from "./view";

describe("chartPoints", () => {
  test("a quarter is plotted at its last month, as the table names it; months are unchanged", () => {
    const points = chartPoints([
      { period: "2026-Q1", date: "2026-01-01", value: 1 },
      { period: "2026-Q4", date: "2026-10-01", value: 2 },
      { period: "2026-08", date: "2026-08-01", value: 3 },
    ]);
    expect(points.map((point) => point.date)).toEqual(["2026-03-01", "2026-12-01", "2026-08-01"]);
    expect(formatPeriod("2026-Q4")).toBe("Dec Q 2026");
  });
});
