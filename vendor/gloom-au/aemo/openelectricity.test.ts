import { describe, expect, test } from "bun:test";
import fiveMinute from "./fixtures/openelectricity-5m.json";
import hourly from "./fixtures/openelectricity-1h.json";
import { legendFormatter, openElectricityNotices } from "./generation";
import { fuelMix, mixHistory, parseFuel, renewableShare, summariseHistory, withFuelRows } from "./fuel";
import type { PricePoint } from "./model";
import {
  batteryArbitrage,
  batteryNet,
  currentRows,
  historyQuery,
  historyRows,
  openElectricityError,
  openElectricityErrorText,
  openElectricityLag,
  openElectricityRefusal,
  openElectricityUrl,
  parseOpenElectricity,
  recentQuery,
  type OeData,
} from "./openelectricity";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const aest = (value: string) => Date.parse(`${value}+10:00`);

describe("OpenElectricity network data", () => {
  test("reads region and fuel tech per series; charging is a positive load; rooftop runs behind", () => {
    const data = parseOpenElectricity(fiveMinute);
    expect(data.interval).toBe("5m");
    const charging = data.rows.filter((row) => row.fuel === "charging");
    expect(charging.every((row) => row.mw >= 0)).toBe(true);
    const latest = (fuel: string) => Math.max(...data.rows.filter((row) => row.fuel === fuel).map((row) => row.at));
    expect(new Date(latest("rooftop")).toISOString()).toBe("2026-10-10T04:25:00.000Z");
    expect(new Date(latest("discharging")).toISOString()).toBe("2026-10-10T06:05:00.000Z");
    expect(new Set(data.rows.map((row) => row.region))).toEqual(new Set(["NSW1", "SA1", "TAS1"]));
    expect(() => parseOpenElectricity({ success: false, error: "nope" })).toThrow(/not recognised/);
  });

  test("windows match AEMO's: hours by their end, 12 months inside the 366-day limit", () => {
    // AEMO's 48H report ran from the hour ending 05:00 on 7 October to 04:00 on 9 October.
    const hours = Array.from({ length: 48 }, (_, index) => aest("2026-10-07T05:00:00") + index * HOUR);
    expect(historyQuery("48H", hours)).toEqual({ interval: "1h", dateStart: "2026-10-07T04:00:00", dateEnd: "2026-10-09T04:00:00" });
    const weeks = Array.from({ length: 52 }, (_, index) => aest("2025-10-04T00:00:00") + index * 7 * DAY);
    const year = historyQuery("12M", weeks)!;
    expect(year).toMatchObject({ interval: "1d", dateStart: "2025-10-04T00:00:00", dateEnd: "2026-10-03T00:00:00" });
    expect((Date.parse(`${year.dateEnd}Z`) - Date.parse(`${year.dateStart}Z`)) / DAY).toBeLessThanOrEqual(366);
    expect(recentQuery(Date.parse("2026-10-10T06:17:48Z"))).toEqual({ interval: "5m", dateStart: "2026-10-09T16:15:00" });
    const url = new URL(openElectricityUrl(year));
    expect(url.searchParams.getAll("fueltech")).toEqual(["solar_rooftop", "battery_charging", "battery_discharging"]);
    expect(url.searchParams.get("primary_grouping")).toBe("network_region");
  });

  test("a 53-week AEMO year is clamped to 366 days", () => {
    const weeks = Array.from({ length: 53 }, (_, index) => aest("2025-09-27T00:00:00") + index * 7 * DAY);
    const year = historyQuery("12M", weeks)!;
    expect((Date.parse(`${year.dateEnd}Z`) - Date.parse(`${year.dateStart}Z`)) / DAY).toBe(366);
  });

  test("errors come from the status alone; only 401 blames the key", () => {
    expect(openElectricityError(401)).toBe("OpenElectricity refused the API key (401)");
    expect(openElectricityError(403)).toBe("OpenElectricity refused the request (403)");
    expect(openElectricityErrorText(new Error(openElectricityError(500)))).toBe("OpenElectricity request failed (500)");
    expect(openElectricityErrorText(new Error("The operation timed out."))).toBe("OpenElectricity unavailable: The operation timed out.");
  });

  test("refusals that would repeat stop the requests: auth until the key changes, credits for an hour or Retry-After", () => {
    const now = aest("2026-10-10T16:00:00");
    expect(openElectricityRefusal(401, null, now)!.until).toBe(Number.POSITIVE_INFINITY);
    expect(openElectricityRefusal(403, null, now)!.message).toMatch(/refused the request \(403\); not asking again until the key/);
    expect(openElectricityRefusal(429, "5", now)).toEqual({ until: now + HOUR, message: expect.stringMatching(/\(429\); not asking again before 17:00 AEST$/) });
    expect(openElectricityRefusal(429, "7200", now)!.until).toBe(now + 2 * HOUR);
    expect(openElectricityRefusal(429, new Date(now + 3 * HOUR).toUTCString(), now)!.until).toBe(now + 3 * HOUR);
    expect(openElectricityRefusal(500, null, now)).toBeNull();
  });
});

describe("merged into AEMO's mix", () => {
  test("hourly rooftop and charging land on AEMO's hour-ending times; charging peaks at its most negative", () => {
    const aemo = parseFuel({ FUEL_48H: [
      { DATETIME: "2026-10-07T05:00:00", STATE: "SA1", FUEL_TYPE: "Battery", SUPPLY: 31.731 },
      { DATETIME: "2026-10-07T06:00:00", STATE: "SA1", FUEL_TYPE: "Battery", SUPPLY: 81.647 },
      { DATETIME: "2026-10-07T07:00:00", STATE: "SA1", FUEL_TYPE: "Battery", SUPPLY: 135.901 },
    ] }, "48H");
    const times = [...new Set(aemo.rows.map((row) => row.at))];
    const merged = withFuelRows(aemo, historyRows(parseOpenElectricity(hourly), "48H", times));
    const history = mixHistory(merged, "SA1", "48H");
    expect(history.series.map((entry) => entry.fuel.id)).toEqual(["rooftop", "battery", "battery-charging"]);
    const charging = history.series.find((entry) => entry.fuel.id === "battery-charging")!.points;
    // OpenElectricity's 04:00 hour is AEMO's hour ending 05:00.
    expect(charging[0]).toEqual({ at: aest("2026-10-07T05:00:00"), mw: -2.780067 });
    const summary = summariseHistory(history).find((entry) => entry.fuel.id === "battery-charging")!;
    expect(summary.peak!.mw).toBeCloseTo(-3.818725);
    expect(summary.low).toBeCloseTo(-1.39595);
    // Charging is a load: no share of generation.
    expect(summary.share).toBe(0);
  });

  test("a week is the mean of its days, and needs four of them", () => {
    const start = aest("2025-10-04T00:00:00");
    const days = (from: number, count: number, mw: number) => Array.from({ length: count }, (_, index) => ({ at: from + index * DAY, region: "VIC1", fuel: "rooftop" as const, mw }));
    const data: OeData = { interval: "1d", rows: [...days(start, 7, 700), ...days(start + 7 * DAY, 3, 100)] };
    const rows = historyRows(data, "12M", [start, start + 7 * DAY]);
    expect(rows).toEqual([{ at: start, region: "VIC1", fuel: "rooftop", value: 700 * 168 }]);
  });

  test("the latest mix takes each figure from its own latest interval, stamped with AEMO's", () => {
    const aemoAt = aest("2026-10-10T16:05:00");
    const aemo = parseFuel({ FUEL_CURRENT: [
      { DATETIME: "2026-10-10T16:05:00", STATE: "SA1", FUEL_TYPE: "Wind", SUPPLY: 600 },
      { DATETIME: "2026-10-10T16:05:00", STATE: "SA1", FUEL_TYPE: "Battery", SUPPLY: 14 },
    ] }, "CURRENT");
    const current = currentRows(parseOpenElectricity(fiveMinute), aemoAt);
    expect(current.rooftopAt).toBe(aest("2026-10-10T14:25:00"));
    expect(current.chargingAt).toBe(aemoAt);
    expect(openElectricityLag(aemoAt, current)).toBe("rooftop 14:25");
    expect(openElectricityLag(aest("2026-10-10T16:30:00"), currentRows(parseOpenElectricity(fiveMinute), aest("2026-10-10T16:30:00")))).toBe("rooftop 14:25, charging 16:05");
    const mix = fuelMix(withFuelRows(aemo, current.rows), "SA1")!;
    expect(mix.fuels.map((entry) => [entry.fuel.id, entry.mw])).toEqual([["wind", 600], ["rooftop", 1724.152], ["battery", 14], ["battery-charging", -115.74]]);
    // Charging is not generation: the total and the shares leave it out; rooftop counts as renewable.
    expect(mix.total).toBeCloseTo(2338.152);
    expect(renewableShare(mix)).toBeCloseTo(2324.152 / 2338.152);
  });
});

describe("batteries against the 5-minute price", () => {
  const t0 = aest("2026-10-10T12:00:00");
  const at = (index: number) => t0 + index * 300_000;
  const data: OeData = {
    interval: "5m",
    rows: [
      { at: at(0), region: "SA1", fuel: "charging", mw: 100 },
      { at: at(0), region: "SA1", fuel: "discharging", mw: 0 },
      { at: at(1), region: "SA1", fuel: "charging", mw: 0 },
      { at: at(1), region: "SA1", fuel: "discharging", mw: 200 },
      { at: at(1), region: "VIC1", fuel: "discharging", mw: 100 },
      // No price for this interval: left out.
      { at: at(2), region: "SA1", fuel: "discharging", mw: 999 },
      { at: at(0), region: "SA1", fuel: "rooftop", mw: 1500 },
    ],
  };
  const prices: PricePoint[] = [
    { region: "SA1", at: at(0), price: -20, actual: true },
    { region: "SA1", at: at(1), price: 400, actual: true },
    { region: "VIC1", at: at(1), price: 100, actual: true },
    { region: "SA1", at: at(2), price: 9_000, actual: false },
  ];

  test("sold at, bought at and the spread for one region", () => {
    const sa = batteryArbitrage(data, prices, "SA1");
    expect(sa).toMatchObject({ soldAt: 400, boughtAt: -20, spread: 420, averagePrice: 190, intervals: 2 });
    expect(sa.dischargedMwh).toBeCloseTo(200 / 12);
    expect(sa.peakDischarge).toEqual({ at: at(1), mw: 200, price: 400 });
  });

  test("the NEM weighs each region's batteries against its own price", () => {
    const nem = batteryArbitrage(data, prices, "NEM");
    expect(nem.soldAt).toBeCloseTo((200 * 400 + 100 * 100) / 300);
    expect(nem.peakDischarge).toEqual({ at: at(1), mw: 300, price: 300 });
    expect(batteryArbitrage(data, prices, "TAS1").soldAt).toBeNull();
  });

  test("net is discharge minus charging where both are reported", () => {
    expect(batteryNet(data, "SA1")).toEqual([{ at: at(0), mw: -100 }, { at: at(1), mw: 200 }]);
  });
});

describe("OpenElectricity notices in the mix views", () => {
  const data = { interval: "5m" as const, rows: [] };
  test("a failure, a kept copy with its age, and an empty answer each say so", () => {
    expect(openElectricityNotices({ error: "The operation timed out.", data: null }, 0)).toEqual(["OpenElectricity unavailable: The operation timed out."]);
    const kept = { data, fetchedAt: aest("2026-10-10T09:00:00"), stale: true, refreshError: "OpenElectricity refused the request (403)", source: "stale-fallback" as const };
    expect(openElectricityNotices({ error: null, data: kept }, 12)).toEqual(["Rooftop solar and battery charging are from 10 Oct 09:00 AEST (refresh failed): OpenElectricity refused the request (403)"]);
    const fresh = { data, fetchedAt: aest("2026-10-10T09:00:00"), stale: false, source: "network" as const };
    expect(openElectricityNotices({ error: null, data: fresh }, 0)).toEqual(["OpenElectricity returned no rooftop solar or battery data for this window."]);
    expect(openElectricityNotices({ error: null, data: fresh }, 12)).toEqual([]);
  });
});

describe("mix history legend", () => {
  const series = (labels: string[]) => labels.map((label) => ({ label, unit: label === "Spot price" ? "$/MWh" : "MW" }) as never);
  test("compact values without units; names before values when the row runs short", () => {
    const few = series(["Wind", "Spot price"]);
    const format = legendFormatter(few, 100);
    expect(format(1_848, few[0])).toBe("1.8k");
    expect(format(132.4, few[1])).toBe("$132");
    const many = series(["Black coal", "Brown coal", "Gas", "Liquid fuel", "Hydro", "Biomass", "Wind", "Utility solar", "Battery discharge"]);
    expect(legendFormatter(many, 98)(1_848, many[0])).toBe("");
    expect(legendFormatter(many, 200)(1_848, many[0])).toBe("1.8k");
  });
});
