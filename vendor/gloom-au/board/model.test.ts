import { describe, expect, test } from "bun:test";
import { returns, rotation, sinceCommonStart, splitMovers, type Close } from "./model";

function series(values: number[], start = "2025-01-01"): Close[] {
  const base = Date.parse(`${start}T00:00:00Z`);
  return values.map((close, index) => ({ date: new Date(base + index * 86_400_000).toISOString().slice(0, 10), close }));
}

describe("returns", () => {
  test("session look-backs and year-to-date from the previous year's last close", () => {
    const closes = series(Array.from({ length: 300 }, (_, index) => 100 + index), "2025-06-01");
    const result = returns(closes);
    expect(result.week).toBeCloseTo((399 / 394 - 1) * 100, 9);
    const lastOf2025 = closes.filter((point) => point.date < "2026").at(-1)!;
    expect(result.ytd).toBeCloseTo((399 / lastOf2025.close - 1) * 100, 9);
    expect(returns([]).month).toBeNull();
    expect(returns(series([1, 2])).year).toBeNull();
  });
});

describe("rotation", () => {
  const benchmark = series(Array.from({ length: 80 }, () => 100));
  test("an accelerating sector is leading; one fading after a run is weakening; too little history is null", () => {
    // Steady linear gains decelerate in percentage terms, so acceleration is what leads.
    const rising = series(Array.from({ length: 80 }, (_, index) => 100 * Math.exp(0.0005 * index * index)));
    expect(rotation(rising, benchmark)?.quadrant).toBe("Leading");
    const fading = series(Array.from({ length: 80 }, (_, index) => (index < 70 ? 100 + index * 2 : 240 - (index - 70) * 3)));
    expect(rotation(fading, benchmark)?.quadrant).toBe("Weakening");
    const falling = series(Array.from({ length: 80 }, (_, index) => 200 - index));
    expect(rotation(falling, benchmark)?.quadrant).toBe("Lagging");
    expect(rotation(rising.slice(0, 30), benchmark)).toBeNull();
  });
});

describe("splitMovers", () => {
  test("largest moves first on each side, unchanged lines dropped", () => {
    const movers = [1.5, -2, 0, 3, -0.5].map((changePercent, index) => ({ code: `C${index}`, name: "", price: 1, changePercent, marketCap: null }));
    const split = splitMovers(movers, 2);
    expect(split.gainers.map((mover) => mover.changePercent)).toEqual([3, 1.5]);
    expect(split.losers.map((mover) => mover.changePercent)).toEqual([-2, -0.5]);
  });
});

describe("sinceCommonStart", () => {
  test("both lines start at zero on the first date both have", () => {
    const sector = [{ date: "2026-01-02", close: 100 }, { date: "2026-01-05", close: 110 }, { date: "2026-01-06", close: 121 }];
    const market = [{ date: "2026-01-05", close: 200 }, { date: "2026-01-06", close: 190 }];
    expect(sinceCommonStart(sector, market)).toEqual([
      [{ date: "2026-01-05", value: 0 }, { date: "2026-01-06", value: 10 }],
      [{ date: "2026-01-05", value: 0 }, { date: "2026-01-06", value: -5 }],
    ]);
    // Without the benchmark's history the sector is still drawn, from its own first close.
    expect(sinceCommonStart(sector, [])).toEqual([[{ date: "2026-01-02", value: 0 }, { date: "2026-01-05", value: 10 }, { date: "2026-01-06", value: 21 }], []]);
    expect(sinceCommonStart([], [])).toEqual([[], []]);
  });

  test("a session window starts the lines where the table's 1Y starts, so the legend and the table agree", () => {
    const sector = series(Array.from({ length: 260 }, (_, index) => 100 + index));
    const market = series(Array.from({ length: 260 }, () => 50));
    const [line, flat] = sinceCommonStart(sector, market, 252);
    expect(line.at(-1)?.value).toBeCloseTo(returns(sector).year!, 1);
    expect(line[0]).toEqual({ date: sector[7]!.date, value: 0 });
    expect(flat.at(-1)?.value).toBe(0);
    // A shorter history than the window starts at its first close.
    expect(sinceCommonStart(sector.slice(0, 10), [], 252)[0][0]?.date).toBe(sector[0]!.date);
  });
});
