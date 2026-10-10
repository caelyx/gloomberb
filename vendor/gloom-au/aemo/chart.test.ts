import { describe, expect, test } from "bun:test";
import { matchesQuery } from "../shared/chart-series";
import {
  NEM_CHART_SERIES,
  NEM_FUEL_SERIES,
  nemChartSeries,
  nemChartSource,
  nemFuelChartSeries,
  nemFuelChartSource,
  nemOpenElectricityChartSeries,
  nemOpenElectricityChartSource,
  nemOpenElectricitySeries,
  parseNemFuelSeriesId,
  parseNemSeriesId,
} from "./chart";
import { fuelReportCodec, openElectricityCodec, setOpenElectricityKey } from "./client";
import fiveMinute from "./fixtures/openelectricity-5m.json";
import { parseOpenElectricity } from "./openelectricity";
import { parseFuel } from "./fuel";
import { nemTimeToUtc, parseCumulativePrice, parseFiveMinute } from "./model";

const brisbane = (ms: number) => new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Brisbane", hour: "2-digit", minute: "2-digit", hourCycle: "h23", day: "2-digit", month: "2-digit",
}).format(ms);

describe("NEM chart series ids", () => {
  test("price and demand for each of the five regions, case-insensitive", () => {
    expect(NEM_CHART_SERIES.map((item) => item.seriesId)).toContain("nem:SA1:price");
    expect(NEM_CHART_SERIES).toHaveLength(10);
    expect(parseNemSeriesId("nem:nsw1:demand")).toEqual({ region: "NSW1", measure: "demand" });
    expect(parseNemSeriesId("nem:WA1:price")).toBeNull();
    expect(parseNemSeriesId("rba:FIRMMCRTD")).toBeNull();
  });

  test("labels name the span and unit honestly", () => {
    const price = NEM_CHART_SERIES.find((item) => item.seriesId === "nem:VIC1:price")!;
    expect(price.label).toBe("Victoria electricity price (7 days)");
    expect(price.description).toContain("$/MWh");
    expect(price.description).toContain("AEST");
    expect(NEM_CHART_SERIES.find((item) => item.seriesId === "nem:VIC1:demand")!.label).toBe("Victoria electricity demand (48 h)");
  });
});

describe("cumulative price report", () => {
  test("keeps actual intervals and reads market time as UTC+10 across Sydney's daylight-saving change", () => {
    const points = parseCumulativePrice({ NEM_DASHBOARD_CUMUL_PRICE: [
      // Sydney moved to daylight time on 4 October 2026; NEM time did not.
      { DT: "2026-10-03T15:35:00", P: 96.99, CP: 1, R: "NSW1", A: 1 },
      { DT: "2026-10-05T12:00:00", P: -20.5, CP: 1, R: "NSW1", A: 1 },
      { DT: "2026-10-10T16:00:00", P: 64.02, CP: 0, R: "NSW1", A: 0 },
      { DT: "bad", P: 1, R: "NSW1", A: 1 },
    ] });
    expect(points).toEqual([
      { region: "NSW1", at: Date.parse("2026-10-03T05:35:00Z"), price: 96.99, actual: true },
      { region: "NSW1", at: Date.parse("2026-10-05T02:00:00Z"), price: -20.5, actual: true },
      { region: "NSW1", at: Date.parse("2026-10-10T06:00:00Z"), price: 64.02, actual: false },
    ]);
    expect(() => parseCumulativePrice({})).toThrow(/not recognised/);
  });
});

describe("resolved series", () => {
  const now = nemTimeToUtc("2026-10-10T16:00:00")!;
  const prices = parseCumulativePrice({ NEM_DASHBOARD_CUMUL_PRICE: [
    { DT: "2026-10-10T15:50:00", P: 120, R: "SA1", A: 1 },
    { DT: "2026-10-10T15:55:00", P: -5, R: "SA1", A: 1 },
    { DT: "2026-10-10T15:55:00", P: 80, R: "VIC1", A: 1 },
    { DT: "2026-10-10T16:30:00", P: 300, R: "SA1", A: 0 },
  ] });

  test("price: actual 5-minute points for one region in $/MWh, read on an AEST clock", () => {
    const series = nemChartSeries({ region: "SA1", measure: "price" }, prices, now);
    expect(series.unit).toBe("$/MWh");
    expect(series.timeBasis).toEqual({ kind: "market", timeZone: "Australia/Brisbane", cadenceMs: 300_000 });
    expect(series.points.map((point) => point.value)).toEqual([120, -5]);
    expect(brisbane(series.points[1]!.date.getTime())).toBe("10/10, 15:55");
    expect(series.warning).toBeUndefined();
  });

  test("demand comes from the 5-minute report's total demand", () => {
    const rows = parseFiveMinute({ "5MIN": [
      { SETTLEMENTDATE: "2026-10-10T15:55:00", REGIONID: "QLD1", RRP: 50, TOTALDEMAND: 6321.9, PERIODTYPE: "ACTUAL" },
      { SETTLEMENTDATE: "2026-10-10T15:50:00", REGIONID: "QLD1", RRP: 50, TOTALDEMAND: null, PERIODTYPE: "ACTUAL" },
    ] });
    const series = nemChartSeries({ region: "QLD1", measure: "demand" }, rows, now);
    expect(series.unit).toBe("MW");
    expect(series.points.map((point) => point.value)).toEqual([6321.9]);
  });

  test("an old latest interval is flagged; no intervals is an error", () => {
    const later = now + 2 * 3_600_000;
    expect(nemChartSeries({ region: "SA1", measure: "price" }, prices, later).warning).toMatch(/latest interval 15:55 AEST/);
    expect(() => nemChartSeries({ region: "TAS1", measure: "price" }, prices, now)).toThrow(/no intervals/);
  });
});

describe("NEM generation chart series", () => {
  const data = parseFuel({ FUEL_3M: [
    { DATETIME: "2026-07-12T00:00:00", STATE: "SA1", FUEL_TYPE: "Wind", SUPPLY: 24_000 },
    { DATETIME: "2026-07-12T00:00:00", STATE: "VIC1", FUEL_TYPE: "Wind", SUPPLY: 48_000 },
  ] }, "3M");

  test("ids per region and the NEM, findable by any words of a search", () => {
    expect(parseNemFuelSeriesId("nem:sa1:fuel:wind")).toEqual({ region: "SA1", fuel: "wind" });
    expect(parseNemFuelSeriesId("nem:NEM:battery")).toEqual({ region: "NEM", fuel: "battery-hourly" });
    expect(parseNemFuelSeriesId("nem:SA1:fuel:nuclear")).toBeNull();
    expect(parseNemFuelSeriesId("nem:SA1:price")).toBeNull();
    const found = NEM_FUEL_SERIES.filter((item) => matchesQuery(item, "victoria  wind"));
    expect(found.map((item) => item.seriesId)).toEqual(["nem:VIC1:fuel:wind"]);
    expect(NEM_FUEL_SERIES.find((item) => item.seriesId === "nem:SA1:fuel:solar")!.description).toContain("no rooftop PV");
  });

  test("daily series are average MW on the AEST calendar day; the NEM sums the regions", () => {
    const sa = nemFuelChartSeries({ region: "SA1", fuel: "wind" }, data);
    expect(sa.label).toBe("South Australia wind generation (3M daily)");
    expect(sa.points[0]!.value).toBe(1000);
    expect(sa.points[0]!.date.toISOString().slice(0, 10)).toBe("2026-07-12");
    expect(nemFuelChartSeries({ region: "NEM", fuel: "wind" }, data).points[0]!.value).toBe(3000);
    expect(() => nemFuelChartSeries({ region: "TAS1", fuel: "wind" }, data)).toThrow(/no wind/);
  });

  test("the disk copy decodes to the same report", () => {
    const decoded = fuelReportCodec.decode(JSON.parse(JSON.stringify(fuelReportCodec.encode(data))));
    expect(decoded).toEqual(data);
    expect(() => fuelReportCodec.decode([[1], ["SA1"], []] as never)).toThrow();
  });
});

describe("OpenElectricity chart series", () => {
  test("are listed only with a key, and the AEMO sources leave their ids alone", async () => {
    setOpenElectricityKey(null);
    expect(nemOpenElectricitySeries()).toEqual([]);
    await expect(nemOpenElectricityChartSource.resolve("nem:SA1:rooftop")!).rejects.toThrow(/API key/);
    setOpenElectricityKey("  test-key ");
    expect(nemOpenElectricitySeries().map((item) => item.seriesId)).toContain("nem:NEM:battery-net");
    expect(nemChartSource.resolve("nem:SA1:battery-net")).toBeNull();
    expect(nemFuelChartSource.resolve("nem:SA1:rooftop")).toBeNull();
    expect(parseNemFuelSeriesId("nem:SA1:fuel:rooftop")).toBeNull();
    setOpenElectricityKey(null);
  });

  test("battery net is discharge minus charging; a cached copy decodes to the same rows", () => {
    const data = parseOpenElectricity(fiveMinute);
    const series = nemOpenElectricityChartSeries({ region: "SA1", measure: "battery-net" }, data);
    expect(series.points.at(-1)!.value).toBeCloseTo(13.9993 - 115.74);
    expect(openElectricityCodec.decode(JSON.parse(JSON.stringify(openElectricityCodec.encode(data))))).toEqual(data);
    expect(() => openElectricityCodec.decode(["5m", [1], ["SA1"], ["wind"], [1]] as never)).toThrow();
  });
});
