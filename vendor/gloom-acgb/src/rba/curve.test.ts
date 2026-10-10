import { describe, expect, test } from "bun:test";
import { acgbSnapshot, interpolateTenor, type LineYield } from "./curve";
import { parseF16, rbaDate } from "./f16";

const fixture = (name: string) => Bun.file(new URL(`../../test/fixtures/${name}`, import.meta.url)).text();
const table = parseF16(await fixture("f16-sample.csv"));

const line = (years: number, value: number): LineYield => ({ years, yield: value });

describe("interpolateTenor", () => {
  const lines = [line(0.1, 3.0), line(1.5, 4.0), line(2.5, 4.5), line(10.2, 5.2)];

  test("reads a tenor between two lines off the straight line through them", () => {
    expect(interpolateTenor(lines, 2)).toBeCloseTo(4.25, 10);
  });

  test("a line at the tenor itself gives its own yield", () => {
    expect(interpolateTenor(lines, 2.5)).toBe(4.5);
  });

  test("never extrapolates past the longest line", () => {
    expect(interpolateTenor(lines, 15)).toBeNull();
  });

  test("a line about to mature does not anchor the short end", () => {
    // Only the 0.1-year line lies below 1Y, and its yield is distorted by its last coupon.
    expect(interpolateTenor(lines, 1)).toBeNull();
  });

  test("no lines, no yield", () => {
    expect(interpolateTenor([], 5)).toBeNull();
  });
});

describe("acgbSnapshot", () => {
  const snapshot = acgbSnapshot(table)!;

  test("the latest session and the sessions a day, a week and a month before it", () => {
    expect(snapshot.latest.date).toBe("2026-09-23");
    expect(snapshot.lookbacks["1D"]?.date).toBe("2026-09-22");
    expect(snapshot.lookbacks["1W"]?.date).toBe("2026-09-16");
    expect(snapshot.lookbacks["1M"]?.date).toBe("2026-08-21");
  });

  test("a month back from the 31st stays in the shorter month rather than rolling into the next", () => {
    const yields = table.rows.at(-1)!.yields;
    const sessions = ["2026-02-27", "2026-03-02", "2026-03-31"].map((date) => ({ date, yields }));
    // 31 Mar back a month is 28 Feb (a Saturday), so Friday 27 Feb; rolling over would reach 3 Mar and pick 2 Mar.
    expect(acgbSnapshot({ ...table, rows: sessions })!.lookbacks["1M"]?.date).toBe("2026-02-27");
  });

  test("matches the RBA's own interpolated F2 yields to within 2bp", async () => {
    const f2 = (await fixture("f2-sample.csv")).split("\n").find((row) => rbaDate(row.split(",")[0] ?? "") === "2026-09-23")!;
    const [, two, three, five, ten] = f2.split(",").map(Number);
    const at = (tenor: string) => snapshot.latest.points.find((point) => point.tenor === tenor)?.yield;
    for (const [tenor, published] of [["2Y", two], ["3Y", three], ["5Y", five], ["10Y", ten]] as const) {
      expect(Math.abs(at(tenor)! - published!) * 100).toBeLessThan(2);
    }
  });
});
