import { describe, expect, test } from "bun:test";
import {
  apportionCells,
  batteryResponse,
  fuelMix,
  hourlyPrices,
  mixHistory,
  parseFuel,
  renewableShare,
  summariseHistory,
} from "./fuel";
import { parseNemSummary, type PricePoint } from "./model";

const row = (DATETIME: string, STATE: string, FUEL_TYPE: string, SUPPLY: number) => ({ DATETIME, STATE, FUEL_TYPE, SUPPLY });
const HOUR = 3_600_000;

describe("FUEL report", () => {
  test("reads times as AEST (UTC+10) after Sydney moved to daylight time", () => {
    // 4 October 2026 began daylight saving in Sydney; NEM time stays UTC+10.
    const data = parseFuel({ FUEL_CURRENT: [row("2026-10-10T15:40:00", "SA1", "Wind", 812.5)] }, "CURRENT");
    expect(new Date(data.rows[0]!.at).toISOString()).toBe("2026-10-10T05:40:00.000Z");
  });

  test("orders fuels for display, keeps an unknown fuel after the known ones, and drops bad rows", () => {
    const data = parseFuel({ FUEL_CURRENT: [
      row("2026-10-10T15:40:00", "NSW1", "Solar", 1600),
      row("2026-10-10T15:40:00", "NSW1", "Pumped storage", 50),
      row("2026-10-10T15:40:00", "NSW1", "Black coal", 2600),
      row("2026-10-10T15:40:00", "NSW1", "Battery", 10),
      { DATETIME: "2026-10-10T15:40:00", STATE: "NSW1", FUEL_TYPE: "Gas", SUPPLY: null },
    ] }, "CURRENT");
    expect(data.fuels.map((fuel) => fuel.label)).toEqual(["Black coal", "Utility solar", "Battery discharge", "Pumped storage"]);
    expect(data.rows).toHaveLength(4);
    expect(() => parseFuel({ FUEL_48H: [] }, "CURRENT")).toThrow(/not recognised/);
  });

  test("the NEM is the regions summed; a region lists only the fuels it reported", () => {
    const data = parseFuel({ FUEL_CURRENT: [
      row("2026-10-10T15:35:00", "SA1", "Wind", 999),
      row("2026-10-10T15:40:00", "SA1", "Wind", 600),
      row("2026-10-10T15:40:00", "SA1", "Gas", 200),
      row("2026-10-10T15:40:00", "SA1", "Battery", 200),
      row("2026-10-10T15:40:00", "VIC1", "Brown coal", 3000),
      row("2026-10-10T15:40:00", "VIC1", "Wind", 1000),
    ] }, "CURRENT");
    const sa = fuelMix(data, "SA1")!;
    expect(sa.total).toBe(1000);
    expect(sa.fuels.map((entry) => [entry.fuel.id, entry.share])).toEqual([["gas", 0.2], ["wind", 0.6], ["battery", 0.2]]);
    expect(renewableShare(sa)).toBeCloseTo(0.6);
    const nem = fuelMix(data, "NEM")!;
    expect(nem.total).toBe(5000);
    expect(nem.fuels.find((entry) => entry.fuel.id === "wind")!.mw).toBe(1600);
    expect(fuelMix(data, "TAS1")).toBeNull();
  });

  test("history is average MW: MWh per day over 24 hours, per week over 168", () => {
    const daily = parseFuel({ FUEL_3M: [
      row("2026-07-12T00:00:00", "NSW1", "Black coal", 104_366.878),
      row("2026-07-13T00:00:00", "NSW1", "Black coal", 96_000),
      row("2026-07-13T00:00:00", "NSW1", "Wind", 24_000),
    ] }, "3M");
    const history = mixHistory(daily, "NSW1", "3M");
    expect(history.times).toHaveLength(2);
    expect(history.series[0]!.points[0]!.mw).toBeCloseTo(4348.62, 2);
    // Wind has no row for the first day: zero, not missing, so the days line up.
    expect(history.series.find((entry) => entry.fuel.id === "wind")!.points.map((point) => point.mw)).toEqual([0, 1000]);
    const weekly = mixHistory(parseFuel({ FUEL_12M: [row("2025-10-04T00:00:00", "SA1", "Wind", 168_000)] }, "12M"), "SA1", "12M");
    expect(weekly.series[0]!.points[0]!.mw).toBe(1000);
    const summary = summariseHistory(history);
    expect(summary.find((entry) => entry.fuel.id === "wind")).toMatchObject({ average: 500, low: 0, peak: { mw: 1000 } });
    expect(summary.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1);
  });
});

describe("stacked bar cells", () => {
  test("always fill the width exactly and stay within a cell of each exact length", () => {
    const values = [2625, 1625, 1000, 64, 45, 44, 11, 0, -5];
    for (const width of [7, 40, 97]) {
      const cells = apportionCells(values, width);
      expect(cells.reduce((sum, value) => sum + value, 0)).toBe(width);
      const total = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
      cells.forEach((count, index) => expect(Math.abs(count - Math.max(0, values[index]!) / total * width)).toBeLessThan(1));
    }
    expect(apportionCells([0, 0], 10)).toEqual([0, 0]);
  });
});

describe("battery response against price", () => {
  // Hour ending 18:00 AEST on 8 October 2026 = 08:00 UTC.
  const end = Date.parse("2026-10-08T08:00:00Z");
  const prices = (from: number, count: number, price: number): PricePoint[] =>
    Array.from({ length: count }, (_, index) => ({ region: "SA1", at: from + (index + 1) * 300_000, price, actual: true }));

  test("hourly prices average the dispatch intervals ending in each hour (hour-ending, like the mix)", () => {
    const points = [
      ...prices(end - HOUR, 12, 300),
      // The 18:05 interval belongs to the next hour.
      { region: "SA1", at: end + 300_000, price: 10_000, actual: true },
      // Forecasts and other regions do not count.
      { region: "SA1", at: end, price: 9_999, actual: false },
      { region: "VIC1", at: end, price: 9_999, actual: true },
      // An hour with too few intervals has no average.
      ...prices(end - 2 * HOUR, 3, 50),
    ];
    const hourly = hourlyPrices(points, "SA1", [end - HOUR, end]);
    expect(hourly.get(end)).toBe(300);
    expect(hourly.has(end - HOUR)).toBe(false);
  });

  test("the discharge-weighted price shows batteries selling into the evening peak", () => {
    const hourly = new Map([[end - HOUR, 50], [end, 300], [end + HOUR, 100]]);
    const response = batteryResponse([
      { at: end - HOUR, mw: 0 },
      { at: end, mw: 300 },
      { at: end + HOUR, mw: 100 },
      { at: end + 2 * HOUR, mw: 500 },
    ], hourly);
    expect(response.averagePrice).toBe(150);
    expect(response.dischargePrice).toBe(250);
    expect(response.peak).toEqual({ at: end + 2 * HOUR, mw: 500, price: null });
  });
});

describe("FCAS prices", () => {
  test("come with the summary, per region, and a missing service reads as null", () => {
    const summary = parseNemSummary({
      ELEC_NEM_SUMMARY: [],
      ELEC_NEM_SUMMARY_PRICES: [{ REGIONID: "VIC1", RRP: -60, RAISEREGRRP: 1.47, LOWERREGRRP: 1.8, RAISE1SECRRP: 0.02 }],
    });
    expect(summary.fcas).toHaveLength(1);
    expect(summary.fcas[0]!.prices.RAISEREGRRP).toBe(1.47);
    expect(summary.fcas[0]!.prices.LOWER5MINRRP).toBeNull();
    expect(parseNemSummary({ ELEC_NEM_SUMMARY: [] }).fcas).toEqual([]);
  });
});
