import { nemTimeToUtc, NEM_REGIONS, type PricePoint } from "./model";

/**
 * Generation by fuel type, from AEMO's dashboard `FUEL` report: one row per
 * region and fuel at each time. What it covers (checked against the live
 * report, 2026-10):
 *
 * - Solar is utility-scale only. Rooftop PV is not in the report, so solar's
 *   share of what households actually use is understated, most of all at noon.
 * - Battery is discharge only (never negative). Charging is not reported.
 * - There is no NEM total and no Western Australia; the NEM is the five
 *   regions summed.
 */

/** The report's windows: the latest dispatch interval, then hourly, daily and weekly history. */
export type FuelReport = "CURRENT" | "48H" | "3M" | "12M";

/** Hours each history row covers: SUPPLY is MWh over that period, so MWh / hours = average MW. */
export const REPORT_HOURS: Record<Exclude<FuelReport, "CURRENT">, number> = { "48H": 1, "3M": 24, "12M": 168 };

export interface FuelSpec {
  id: string;
  /** AEMO's FUEL_TYPE. */
  source: string;
  label: string;
  renewable: boolean;
}

/**
 * Display order everywhere (table rows, bar segments, chart legend):
 * thermal first, then hydro and the variable renewables, battery last so it
 * reads as the response to them. Colours are in `fuel-colors.ts`.
 */
export const FUELS: readonly FuelSpec[] = [
  { id: "black-coal", source: "Black coal", label: "Black coal", renewable: false },
  { id: "brown-coal", source: "Brown coal", label: "Brown coal", renewable: false },
  { id: "gas", source: "Gas", label: "Gas", renewable: false },
  { id: "liquid", source: "Liquid Fuel", label: "Liquid fuel", renewable: false },
  { id: "hydro", source: "Hydro", label: "Hydro", renewable: true },
  { id: "biomass", source: "Biomass", label: "Biomass", renewable: true },
  { id: "wind", source: "Wind", label: "Wind", renewable: true },
  { id: "solar", source: "Solar", label: "Utility solar", renewable: true },
  { id: "battery", source: "Battery", label: "Battery discharge", renewable: false },
];

/**
 * What AEMO's report leaves out, from OpenElectricity when the user has added
 * an API key (`openelectricity.ts`): rooftop PV, and battery charging as
 * negative MW (a load), so the battery's net position can be read.
 */
export const OPEN_ELECTRICITY_FUELS: readonly FuelSpec[] = [
  { id: "rooftop", source: "Rooftop solar", label: "Rooftop solar", renewable: true },
  { id: "battery-charging", source: "Battery charging", label: "Battery charging", renewable: false },
];

/** Rooftop beside utility solar, charging beside discharge. */
const ORDER: readonly FuelSpec[] = FUELS.flatMap((fuel) => (
  fuel.id === "solar" ? [fuel, OPEN_ELECTRICITY_FUELS[0]!] : fuel.id === "battery" ? [fuel, OPEN_ELECTRICITY_FUELS[1]!] : [fuel]
));

const BY_SOURCE = new Map(ORDER.map((fuel) => [fuel.source.toLowerCase(), fuel]));
const BY_ID = new Map(ORDER.map((fuel) => [fuel.id, fuel]));

/** A fuel AEMO adds later keeps its own name and goes after the known ones. */
export function fuelSpec(source: string): FuelSpec {
  const known = BY_SOURCE.get(source.trim().toLowerCase());
  if (known) return known;
  const id = source.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return BY_ID.get(id) ?? { id, source, label: source.trim(), renewable: false };
}

export function fuelById(id: string): FuelSpec | undefined {
  return BY_ID.get(id);
}

function fuelRank(id: string): number {
  const index = ORDER.findIndex((fuel) => fuel.id === id);
  return index < 0 ? ORDER.length : index;
}

/** The five regions summed. */
export const NEM_TOTAL = "NEM";
export type MixRegion = keyof typeof NEM_REGIONS | typeof NEM_TOTAL;

export function mixRegionName(region: string): string {
  return region === NEM_TOTAL ? "NEM" : NEM_REGIONS[region] ?? region;
}

export interface FuelRow {
  /** UTC ms of the row's time: the dispatch interval, or the end of the hour, or the day or week it starts. */
  at: number;
  region: string;
  fuel: string;
  /** MW for CURRENT; MWh over the period for history. */
  value: number;
}

export interface FuelReportData {
  rows: FuelRow[];
  /** Fuel specs met in the report, in display order. */
  fuels: FuelSpec[];
}

/** Rows by AEMO's fuel name, as parsed or as kept on disk. */
export function fuelReport(entries: Iterable<{ at: number; region: string; source: string; value: number }>): FuelReportData {
  const fuels = new Map<string, FuelSpec>();
  const rows: FuelRow[] = [];
  for (const entry of entries) {
    const spec = fuelSpec(entry.source);
    fuels.set(spec.id, spec);
    rows.push({ at: entry.at, region: entry.region, fuel: spec.id, value: entry.value });
  }
  return { rows, fuels: [...fuels.values()].sort((a, b) => fuelRank(a.id) - fuelRank(b.id)) };
}

/** The report with rows from another source added (OpenElectricity's rooftop PV and battery charging). */
export function withFuelRows(data: FuelReportData, rows: readonly FuelRow[]): FuelReportData {
  if (rows.length === 0) return data;
  const fuels = new Map(data.fuels.map((fuel) => [fuel.id, fuel]));
  for (const row of rows) if (!fuels.has(row.fuel)) fuels.set(row.fuel, fuelById(row.fuel) ?? fuelSpec(row.fuel));
  return { rows: [...data.rows, ...rows], fuels: [...fuels.values()].sort((a, b) => fuelRank(a.id) - fuelRank(b.id)) };
}

export function parseFuel(payload: unknown, report: FuelReport): FuelReportData {
  const rows = (payload as Record<string, unknown> | null)?.[`FUEL_${report}`];
  if (!Array.isArray(rows)) throw new Error("AEMO generation mix format was not recognised");
  return fuelReport((rows as Array<Record<string, unknown>>).flatMap((row) => {
    const at = typeof row.DATETIME === "string" ? nemTimeToUtc(row.DATETIME) : null;
    const region = typeof row.STATE === "string" ? row.STATE.trim() : "";
    const value = typeof row.SUPPLY === "number" && Number.isFinite(row.SUPPLY) ? row.SUPPLY : null;
    const source = typeof row.FUEL_TYPE === "string" ? row.FUEL_TYPE.trim() : "";
    return at != null && region && value != null && source ? [{ at, region, source, value }] : [];
  }));
}

export interface FuelShare {
  fuel: FuelSpec;
  mw: number;
  /** Of the region's total; 0 when the total is 0. */
  share: number;
}

export interface FuelMix {
  region: string;
  at: number;
  total: number;
  /** Every fuel in the report, in display order, including those at 0 MW. */
  fuels: FuelShare[];
}

function regionMatches(row: FuelRow, region: string): boolean {
  return region === NEM_TOTAL ? row.region in NEM_REGIONS : row.region === region;
}

/** One region's (or the NEM's) generation at the report's latest time. */
export function fuelMix(data: FuelReportData, region: string): FuelMix | null {
  const latest = data.rows.reduce((max, row) => (regionMatches(row, region) ? Math.max(max, row.at) : max), Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(latest)) return null;
  const totals = new Map<string, number>();
  for (const row of data.rows) {
    if (row.at === latest && regionMatches(row, region)) totals.set(row.fuel, (totals.get(row.fuel) ?? 0) + row.value);
  }
  const fuels = data.fuels.filter((fuel) => totals.has(fuel.id));
  const total = fuels.reduce((sum, fuel) => sum + Math.max(0, totals.get(fuel.id)!), 0);
  return {
    region,
    at: latest,
    total,
    fuels: fuels.map((fuel) => {
      const mw = totals.get(fuel.id)!;
      return { fuel, mw, share: total > 0 ? Math.max(0, mw) / total : 0 };
    }),
  };
}

/** Share of the total from hydro, biomass, wind and utility solar. Battery is storage, so it counts in neither part. */
export function renewableShare(mix: FuelMix): number | null {
  if (!(mix.total > 0)) return null;
  return mix.fuels.reduce((sum, entry) => sum + (entry.fuel.renewable ? Math.max(0, entry.mw) : 0), 0) / mix.total;
}

/**
 * Cells for each part of a stacked bar `width` cells wide, by largest
 * remainder, so the cells always add up to the width and each part is within
 * one cell of its exact length. Negative parts count as zero.
 */
export function apportionCells(values: readonly number[], width: number): number[] {
  const cells = Math.max(0, Math.floor(width));
  const clean = values.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = clean.reduce((sum, value) => sum + value, 0);
  if (!(total > 0) || cells === 0) return clean.map(() => 0);
  const exact = clean.map((value) => (value / total) * cells);
  const result = exact.map(Math.floor);
  let left = cells - result.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    result[index]! += 1;
    left -= 1;
  }
  return result;
}

export interface MixPoint {
  at: number;
  /** Average MW over the period. */
  mw: number;
}

export interface MixHistory {
  region: string;
  report: Exclude<FuelReport, "CURRENT">;
  /** Each time in the window, oldest first. */
  times: number[];
  /** Per fuel in display order: average MW at every time (0 where the region reported nothing). */
  series: Array<{ fuel: FuelSpec; points: MixPoint[] }>;
}

/** One region's (or the NEM's) history as average MW per fuel. */
export function mixHistory(data: FuelReportData, region: string, report: Exclude<FuelReport, "CURRENT">): MixHistory {
  const hours = REPORT_HOURS[report];
  const byFuel = new Map<string, Map<number, number>>();
  const times = new Set<number>();
  for (const row of data.rows) {
    if (!regionMatches(row, region)) continue;
    times.add(row.at);
    const values = byFuel.get(row.fuel) ?? new Map<number, number>();
    values.set(row.at, (values.get(row.at) ?? 0) + row.value);
    byFuel.set(row.fuel, values);
  }
  const sorted = [...times].sort((a, b) => a - b);
  return {
    region,
    report,
    times: sorted,
    series: data.fuels.filter((fuel) => byFuel.has(fuel.id)).map((fuel) => {
      const values = byFuel.get(fuel.id)!;
      return { fuel, points: sorted.map((at) => ({ at, mw: (values.get(at) ?? 0) / hours })) };
    }),
  };
}

export interface FuelWindowSummary {
  fuel: FuelSpec;
  average: number;
  /** Furthest from zero: battery charging (negative) peaks at its most negative. */
  peak: MixPoint | null;
  /** Nearest to zero. */
  low: number;
  /** Of all energy in the window. */
  share: number;
}

/** Average, peak and low MW per fuel over the window, and its share of the energy. */
export function summariseHistory(history: MixHistory): FuelWindowSummary[] {
  const totals = history.series.map((entry) => entry.points.reduce((sum, point) => sum + Math.max(0, point.mw), 0));
  const all = totals.reduce((sum, value) => sum + value, 0);
  return history.series.map((entry, index) => {
    const count = entry.points.length;
    const peak = entry.points.reduce<MixPoint | null>((best, point) => (!best || Math.abs(point.mw) > Math.abs(best.mw) ? point : best), null);
    const low = entry.points.reduce<number | null>((best, point) => (best == null || Math.abs(point.mw) < Math.abs(best) ? point.mw : best), null);
    return {
      fuel: entry.fuel,
      average: count ? entry.points.reduce((sum, point) => sum + point.mw, 0) / count : 0,
      peak,
      low: low ?? 0,
      share: all > 0 ? totals[index]! / all : 0,
    };
  });
}

const HOUR = 3_600_000;
/** An hour needs at least half its twelve dispatch prices to have an average. */
const MIN_INTERVALS_PER_HOUR = 6;

/**
 * Hourly average spot price at each hour ending `times` (AEMO labels a period
 * by its end, for the hourly mix and for 5-minute dispatch alike): the mean of
 * the actual dispatch prices in (end - 1 h, end].
 */
export function hourlyPrices(points: readonly PricePoint[], region: string, times: readonly number[]): Map<number, number> {
  const buckets = new Map<number, { sum: number; count: number }>();
  const wanted = new Set(times);
  for (const point of points) {
    if (point.region !== region || !point.actual) continue;
    const end = Math.ceil(point.at / HOUR) * HOUR;
    if (!wanted.has(end)) continue;
    const bucket = buckets.get(end) ?? { sum: 0, count: 0 };
    bucket.sum += point.price;
    bucket.count += 1;
    buckets.set(end, bucket);
  }
  const result = new Map<number, number>();
  for (const [end, bucket] of buckets) {
    if (bucket.count >= MIN_INTERVALS_PER_HOUR) result.set(end, bucket.sum / bucket.count);
  }
  return result;
}

export interface BatteryResponse {
  /** Simple mean of the hourly prices that have a battery figure. */
  averagePrice: number | null;
  /** Price weighted by battery discharge: what the average discharged MWh earned. */
  dischargePrice: number | null;
  /** Price weighted by battery charging (OpenElectricity only): what the average charged MWh cost. */
  chargePrice: number | null;
  peak: (MixPoint & { price: number | null }) | null;
}

/** Each price weighted by the magnitude of `points` at its time; null with no weight. */
function weightedPrice(points: readonly MixPoint[], prices: ReadonlyMap<number, number>): number | null {
  let weighted = 0;
  let total = 0;
  for (const point of points) {
    const price = prices.get(point.at);
    const weight = Math.abs(point.mw);
    if (price == null || !(weight > 0)) continue;
    weighted += weight * price;
    total += weight;
  }
  return total > 0 ? weighted / total : null;
}

/** When batteries discharged (and, given charging, charged) against what the price was then. */
export function batteryResponse(battery: readonly MixPoint[], prices: ReadonlyMap<number, number>, charging?: readonly MixPoint[]): BatteryResponse {
  let priceSum = 0;
  let priceCount = 0;
  let weighted = 0;
  let energy = 0;
  let peak: BatteryResponse["peak"] = null;
  for (const point of battery) {
    const price = prices.get(point.at);
    if (!peak || point.mw > peak.mw) peak = { ...point, price: price ?? null };
    if (price == null) continue;
    priceSum += price;
    priceCount += 1;
    if (point.mw > 0) {
      weighted += point.mw * price;
      energy += point.mw;
    }
  }
  return {
    averagePrice: priceCount ? priceSum / priceCount : null,
    dischargePrice: energy > 0 ? weighted / energy : null,
    chargePrice: charging ? weightedPrice(charging, prices) : null,
    peak,
  };
}
