import { describe, expect, test } from "bun:test";
import { changes, decisions, parseRbaTable } from "./model";
import { formatChange, seriesPoints } from "./view";

const TABLE = `\uFEFFF1 INTEREST RATES AND YIELDS – MONEY MARKET
Title,Cash Rate Target,Change in the Cash Rate Target,3-month BBSW
Description,Cash Rate Target on date,"Change, in points",Bank bill swap
Frequency,Daily,as announced,Daily
Units,Per cent,Per cent,Per cent


Series ID,FIRMMCRTD,FIRMMCCRT,FIRMMBAB90D
28-Sep-2026,4.35,,4.60
29-Sep-2026,4.35,,4.61
30-Sep-2026,4.60,0.25,4.75
07-Oct-2026,4.60,,4.77
08-Oct-2026,,,
`;

describe("parseRbaTable", () => {
  test("reads the header block by label and skips blank cells", () => {
    const table = parseRbaTable(TABLE);
    expect(table.get("FIRMMCRTD")).toMatchObject({ title: "Cash Rate Target", units: "Per cent" });
    expect(table.get("FIRMMCRTD")!.points.map((point) => point.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-07"]);
    expect(table.get("FIRMMCCRT")!.points).toEqual([{ date: "2026-09-30", value: 0.25 }]);
    expect(() => parseRbaTable("<html>maintenance</html>")).toThrow(/not recognised/);
  });
});

describe("changes and decisions", () => {
  const target = parseRbaTable(TABLE).get("FIRMMCRTD")!.points;

  test("changes compare with the last observation on or before each look-back date", () => {
    const change = changes(target);
    expect(change.latest).toEqual({ date: "2026-10-07", value: 4.6 });
    // A week back is 30 Sep, already at 4.60; a month back predates the data.
    expect(change.week).toBe(0);
    expect(change.month).toBeNull();
  });

  test("a move shows the day after the announcement; a later meeting is upcoming", () => {
    const result = decisions(target, "2026-10-08", ["2026-09-29", "2026-11-03"]);
    expect(result[0]).toEqual({ date: "2026-09-29", change: 0.25, rate: 4.6 });
    expect(result[1]).toEqual({ date: "2026-11-03", change: null, rate: null });
    const hold = decisions([{ date: "2026-09-28", value: 4.35 }, { date: "2026-10-01", value: 4.35 }], "2026-10-08", ["2026-09-29"]);
    expect(hold[0]).toEqual({ date: "2026-09-29", change: 0, rate: 4.35 });
  });
});

describe("seriesPoints", () => {
  test("finds a series in its own table, empty when the table failed", () => {
    const f2 = new Map([["FCMYGBAG10D", { id: "FCMYGBAG10D", title: "", units: "", points: [{ date: "2026-10-07", value: 4.4 }] }]]);
    const tables = { f1: new Map(), f2, fx: new Map() };
    expect(seriesPoints(tables, "FCMYGBAG10D")).toEqual([{ date: "2026-10-07", value: 4.4 }]);
    expect(seriesPoints(tables, "FXRUSD")).toEqual([]);
    expect(seriesPoints(tables, "UNKNOWN")).toEqual([]);
  });
});

describe("formatChange", () => {
  test("a change that rounds to zero has no sign", () => {
    const rate = { kind: "rate" as const };
    const fx = { kind: "fx" as const };
    expect(formatChange(rate, -0.3)).toBe("0");
    expect(formatChange(rate, 0.4)).toBe("0");
    expect(formatChange(rate, -2.6)).toBe("-3");
    expect(formatChange(rate, 25)).toBe("+25");
    expect(formatChange(fx, -0.001)).toBe("0.00%");
    expect(formatChange(fx, 0.126)).toBe("+0.13%");
    expect(formatChange(fx, null)).toBe("—");
  });
});
