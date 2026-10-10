import { describe, expect, test } from "bun:test";
import { cumulativeReturn, pointsInRange, statRange } from "./chart-range";

const points = [
  { date: "2019-06-30", value: 1 },
  { date: "2021-10-09", value: 2 },
  { date: "2021-10-10", value: 3 },
  { date: "2025-10-09", value: 4 },
  { date: "2025-10-10", value: 5 },
  { date: "2026-10-10", value: 6 },
];

describe("pointsInRange", () => {
  test("keeps calendar years back from the latest point, inclusive", () => {
    expect(pointsInRange(points, "1Y").map((point) => point.value)).toEqual([5, 6]);
    expect(pointsInRange(points, "5Y").map((point) => point.value)).toEqual([3, 4, 5, 6]);
    expect(pointsInRange(points, "ALL")).toHaveLength(6);
    expect(pointsInRange([], "1Y")).toEqual([]);
  });

  test("a leap day reaches back to 28 February", () => {
    const leap = [{ date: "2023-02-28", value: 1 }, { date: "2024-02-29", value: 2 }];
    expect(pointsInRange(leap, "1Y")).toHaveLength(2);
  });
});

describe("statRange", () => {
  test("reads persisted values and defaults the rest", () => {
    expect(statRange("1Y")).toBe("1Y");
    expect(statRange("ALL")).toBe("ALL");
    expect(statRange("10Y")).toBe("5Y");
    expect(statRange(null)).toBe("5Y");
  });
});

describe("cumulativeReturn", () => {
  test("percent change from the first positive point", () => {
    expect(cumulativeReturn([{ date: "a", value: 200 }, { date: "b", value: 210 }, { date: "c", value: 190 }]))
      .toEqual([{ date: "a", value: 0 }, { date: "b", value: 5 }, { date: "c", value: -5 }]);
    expect(cumulativeReturn([])).toEqual([]);
  });
});
