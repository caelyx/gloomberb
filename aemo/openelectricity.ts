import { NEM_TOTAL, type FuelRow, type MixPoint } from "./fuel";
import { NEM_REGIONS, type PricePoint } from "./model";

/**
 * OpenElectricity (formerly OpenNEM, openelectricity.org.au), only when the
 * user has added an API key: what AEMO's dashboard leaves out of the mix.
 *
 * One endpoint, `GET /v4/data/network/NEM` with `metrics=power`, split by
 * region and fuel technology and filtered to three of them:
 *
 * - `solar_rooftop`: rooftop PV, AEMO's 30-minute estimates spread over
 *   5-minute rows. It runs about an hour and a half behind dispatch.
 * - `battery_charging`: grid batteries' load, in positive MW. OpenElectricity
 *   splits AEMO's bidirectional units into a charging and a discharging part,
 *   per unit, so a region can show both in one interval.
 * - `battery_discharging`: their output, near live (within ten minutes).
 *
 * Times are network time (AEST) with the offset; a 5-minute row carries the
 * dispatch interval's time as AEMO does, an hourly or daily row its start.
 * Each request costs credits (the free plan has 500 a day), so the plugin
 * asks for every region at once and keeps the answers on disk.
 */

export const OPEN_ELECTRICITY_API = "https://api.openelectricity.org.au/v4";

/** Key of the plugin setting (`configSchema`) that holds the API key. */
export const OPEN_ELECTRICITY_KEY_SETTING = "openElectricityApiKey";

/** What the licence asks for wherever the data shows. */
export const OPEN_ELECTRICITY_ATTRIBUTION = "Rooftop solar and battery charging: OpenElectricity (openelectricity.org.au), CC BY 4.0";

/** Without a key: what AEMO's mix cannot show, and how to fill it. */
export const OPEN_ELECTRICITY_HINT = "Add an OpenElectricity API key in the plugin's settings to add rooftop solar and battery charging.";

export type OeFuel = "rooftop" | "charging" | "discharging";

const FUELTECHS: Record<string, OeFuel> = {
  solar_rooftop: "rooftop",
  battery_charging: "charging",
  battery_discharging: "discharging",
};

export type OeInterval = "5m" | "1h" | "1d";

export interface OeRow {
  /** UTC ms: the dispatch interval (5m) or the bucket's start (1h, 1d). */
  at: number;
  region: string;
  fuel: OeFuel;
  /** Average MW; charging is positive here (a load), as OpenElectricity reports it. */
  mw: number;
}

export interface OeData {
  interval: OeInterval;
  rows: OeRow[];
}

export interface OeQuery {
  interval: OeInterval;
  /** Network time, no offset, as the API wants it. */
  dateStart: string;
  /** Exclusive; none for "up to the latest settled interval". */
  dateEnd?: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const AEST = 10 * HOUR;

/** `2026-10-09T16:00:00`: NEM time without an offset. */
export function aestNaive(ms: number): string {
  return new Date(ms + AEST).toISOString().slice(0, 19);
}

export function openElectricityUrl(query: OeQuery): string {
  const params = new URLSearchParams({ metrics: "power", interval: query.interval, date_start: query.dateStart });
  if (query.dateEnd) params.set("date_end", query.dateEnd);
  params.set("primary_grouping", "network_region");
  for (const fueltech of Object.keys(FUELTECHS)) params.append("fueltech", fueltech);
  return `${OPEN_ELECTRICITY_API}/data/network/NEM?${params}`;
}

/** The last 24 hours at 5 minutes, every region: about 4,300 rows. */
export function recentQuery(now: number): OeQuery {
  const start = Math.floor((now - DAY) / (5 * MINUTE)) * 5 * MINUTE;
  return { interval: "5m", dateStart: aestNaive(start) };
}

export type OeHistoryRange = "48H" | "3M" | "12M";

/**
 * The same window as AEMO's report, given its times: hours by their end
 * (OpenElectricity labels them by their start), days, and weeks from their
 * first day (read as days and averaged here, since the API's weeks need
 * not start on AEMO's Saturday). 12M is 364 days, inside the free plan's
 * 366-day limit for daily data.
 */
export function historyQuery(range: OeHistoryRange, times: readonly number[]): OeQuery | null {
  const first = times[0];
  const last = times.at(-1);
  if (first == null || last == null) return null;
  switch (range) {
    case "48H": return { interval: "1h", dateStart: aestNaive(first - HOUR), dateEnd: aestNaive(last) };
    case "3M": return { interval: "1d", dateStart: aestNaive(first), dateEnd: aestNaive(last + DAY) };
    // Clamped, should AEMO ever send a 53rd week: past 366 days the request is refused (and still costs a credit).
    case "12M": return { interval: "1d", dateStart: aestNaive(Math.max(first, last + 7 * DAY - 366 * DAY)), dateEnd: aestNaive(last + 7 * DAY) };
  }
}

/** A cache key for a query: the same window is the same answer. */
export function queryKey(query: OeQuery): string {
  return `${query.interval}:${query.dateStart}:${query.dateEnd ?? "live"}`;
}

export function parseOpenElectricity(payload: unknown): OeData {
  const body = payload as { success?: unknown; data?: unknown } | null;
  if (!body || body.success === false || !Array.isArray(body.data)) throw new Error("OpenElectricity response format was not recognised");
  const series = (body.data as Array<Record<string, unknown>>).find((entry) => entry?.metric === "power");
  if (!series) return { interval: "5m", rows: [] };
  const interval = series.interval === "1h" || series.interval === "1d" ? series.interval : "5m";
  const rows: OeRow[] = [];
  for (const result of Array.isArray(series.results) ? (series.results as Array<Record<string, unknown>>) : []) {
    const columns = (result.columns ?? {}) as Record<string, unknown>;
    const region = typeof columns.region === "string" ? columns.region : "";
    const fuel = typeof columns.fueltech === "string" ? FUELTECHS[columns.fueltech] : undefined;
    if (!(region in NEM_REGIONS) || !fuel || !Array.isArray(result.data)) continue;
    for (const pair of result.data as unknown[]) {
      if (!Array.isArray(pair) || typeof pair[0] !== "string" || typeof pair[1] !== "number" || !Number.isFinite(pair[1])) continue;
      const at = Date.parse(pair[0]);
      if (Number.isFinite(at)) rows.push({ at, region, fuel, mw: pair[1] });
    }
  }
  return { interval, rows };
}

/**
 * One error line for a failed request, from its status alone: the server's
 * own text is never shown (it could echo what was sent). Only 401 is about
 * the key; 403 can also be a plan or permission refusal.
 */
export function openElectricityError(status: number): string {
  if (status === 401) return `OpenElectricity refused the API key (${status})`;
  if (status === 403) return `OpenElectricity refused the request (${status})`;
  if (status === 429) return `OpenElectricity rate limit or daily credits reached (${status})`;
  return `OpenElectricity request failed (${status})`;
}

/** An error for a notice: OpenElectricity's own messages name it already; anything else (a timeout) gets the name. */
export function openElectricityErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return /^OpenElectricity\b/.test(text) ? text : `OpenElectricity unavailable: ${text}`;
}

export interface OeRefusal {
  /** UTC ms; Infinity for "until the key changes". */
  until: number;
  message: string;
}

/**
 * How long to stop asking after a refusal that would only repeat, at a
 * credit each time: 401 and 403 until the key in settings changes; 429 (the
 * day's credits or the rate limit) for Retry-After, and at least an hour.
 * Null for anything else, which the cache's own freshness paces.
 */
export function openElectricityRefusal(status: number, retryAfter: string | null, now: number): OeRefusal | null {
  if (status === 401 || status === 403) {
    return { until: Number.POSITIVE_INFINITY, message: `${openElectricityError(status)}; not asking again until the key in the plugin's settings changes` };
  }
  if (status !== 429) return null;
  const seconds = retryAfter != null && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter.trim()) * 1000 : null;
  const date = retryAfter != null && seconds == null ? Date.parse(retryAfter) - now : null;
  const wait = Math.max(HOUR, seconds ?? (date != null && Number.isFinite(date) ? date : 0));
  const until = now + wait;
  return { until, message: `${openElectricityError(status)}; not asking again before ${aestNaive(until).slice(11, 16)} AEST` };
}

function inScope(region: string, scope: string): boolean {
  return scope === NEM_TOTAL ? region in NEM_REGIONS : region === scope;
}

// --- Into AEMO's mix -------------------------------------------------------------

/** Rows for the mix (`FuelRow`): rooftop as generation, charging as negative MW. */
function mixFuel(fuel: OeFuel): string | null {
  return fuel === "rooftop" ? "rooftop" : fuel === "charging" ? "battery-charging" : null;
}

/**
 * Rooftop solar and battery charging as history rows on AEMO's times and in
 * its units (MWh over the period), so `mixHistory` reads them like the rest.
 * Hours move to their end; a week is the mean of its days, kept only with at
 * least four of them.
 */
export function historyRows(data: OeData, range: OeHistoryRange, times: readonly number[]): FuelRow[] {
  const wanted = new Set(times);
  const hours = range === "48H" ? 1 : range === "3M" ? 24 : 168;
  const rows: FuelRow[] = [];
  if (range !== "12M") {
    for (const row of data.rows) {
      const fuel = mixFuel(row.fuel);
      const at = range === "48H" ? row.at + HOUR : row.at;
      if (fuel && wanted.has(at)) rows.push({ at, region: row.region, fuel, value: (fuel === "battery-charging" ? -row.mw : row.mw) * hours });
    }
    return rows;
  }
  const weeks = new Map<string, { at: number; region: string; fuel: string; sum: number; days: number }>();
  for (const row of data.rows) {
    const fuel = mixFuel(row.fuel);
    const week = fuel ? times.find((start) => row.at >= start && row.at < start + 7 * DAY) : undefined;
    if (!fuel || week == null) continue;
    const key = `${week}|${row.region}|${fuel}`;
    const bucket = weeks.get(key) ?? { at: week, region: row.region, fuel, sum: 0, days: 0 };
    bucket.sum += fuel === "battery-charging" ? -row.mw : row.mw;
    bucket.days += 1;
    weeks.set(key, bucket);
  }
  for (const bucket of weeks.values()) {
    if (bucket.days >= 4) rows.push({ at: bucket.at, region: bucket.region, fuel: bucket.fuel, value: (bucket.sum / bucket.days) * hours });
  }
  return rows;
}

export interface CurrentRows {
  /** Stamped with AEMO's interval so `fuelMix` reads them with the rest of the mix. */
  rows: FuelRow[];
  /** The interval each figure is really from: rooftop runs behind dispatch. */
  rooftopAt: number | null;
  chargingAt: number | null;
}

/** The latest time at or before `limit` with rows of this fuel (the latest of all when none is). */
function latestTime(data: OeData, fuel: OeFuel, limit: number): number | null {
  let before: number | null = null;
  let any: number | null = null;
  for (const row of data.rows) {
    if (row.fuel !== fuel) continue;
    if (any == null || row.at > any) any = row.at;
    if (row.at <= limit && (before == null || row.at > before)) before = row.at;
  }
  return before ?? any;
}

/** Rooftop solar and battery charging for AEMO's latest interval, each from its own latest interval. */
export function currentRows(data: OeData, aemoAt: number): CurrentRows {
  const rooftopAt = latestTime(data, "rooftop", aemoAt);
  const chargingAt = latestTime(data, "charging", aemoAt);
  const rows: FuelRow[] = [];
  for (const row of data.rows) {
    if (row.fuel === "rooftop" && row.at === rooftopAt) rows.push({ at: aemoAt, region: row.region, fuel: "rooftop", value: row.mw });
    if (row.fuel === "charging" && row.at === chargingAt) rows.push({ at: aemoAt, region: row.region, fuel: "battery-charging", value: -row.mw });
  }
  return { rows, rooftopAt, chargingAt };
}

/** `rooftop 14:25, charging 16:15` for the figures that are not from AEMO's interval; empty when all are. */
export function openElectricityLag(aemoAt: number, current: CurrentRows): string {
  const time = (ms: number) => {
    const date = new Date(ms + AEST);
    return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  };
  return [
    current.rooftopAt != null && current.rooftopAt !== aemoAt ? `rooftop ${time(current.rooftopAt)}` : "",
    current.chargingAt != null && current.chargingAt !== aemoAt ? `charging ${time(current.chargingAt)}` : "",
  ].filter(Boolean).join(", ");
}

// --- Batteries against the 5-minute price ----------------------------------------

/** One fuel over time for a region (or the regions summed), MW as reported, oldest first. */
export function oeSeries(data: OeData, region: string, fuel: OeFuel): MixPoint[] {
  const sums = new Map<number, number>();
  for (const row of data.rows) {
    if (row.fuel === fuel && inScope(row.region, region)) sums.set(row.at, (sums.get(row.at) ?? 0) + row.mw);
  }
  return [...sums].sort((a, b) => a[0] - b[0]).map(([at, mw]) => ({ at, mw }));
}

/** Discharge minus charging at each interval both are reported. */
export function batteryNet(data: OeData, region: string): MixPoint[] {
  const charging = new Map(oeSeries(data, region, "charging").map((point) => [point.at, point.mw]));
  return oeSeries(data, region, "discharging").flatMap((point) => (charging.has(point.at) ? [{ at: point.at, mw: point.mw - charging.get(point.at)! }] : []));
}

export interface BatteryPeak {
  at: number;
  mw: number;
  /** The spot price then (for the NEM, weighted across the regions by MW). */
  price: number | null;
}

export interface BatteryArbitrage {
  /** Discharge-weighted spot price: what the average MWh sold earned. */
  soldAt: number | null;
  /** Charging-weighted spot price: what the average MWh stored cost. */
  boughtAt: number | null;
  /** Sold at minus bought at. */
  spread: number | null;
  /** Plain mean of the spot prices over the same intervals; for the NEM, of every region's prices alike (no demand weighting). */
  averagePrice: number | null;
  dischargedMwh: number;
  chargedMwh: number;
  peakDischarge: BatteryPeak | null;
  peakCharge: BatteryPeak | null;
  /** Intervals with both a battery figure and a price. */
  intervals: number;
}

/**
 * When batteries charged and discharged against the 5-minute spot price, over
 * the intervals that have both. For the NEM each region's batteries are
 * weighed against their own region's price.
 */
export function batteryArbitrage(data: OeData, prices: readonly PricePoint[], region: string): BatteryArbitrage {
  const priceAt = new Map<string, number>();
  for (const point of prices) if (point.actual && inScope(point.region, region)) priceAt.set(`${point.region}|${point.at}`, point.price);
  const byTime = new Map<number, { discharge: number; dischargeValue: number; charge: number; chargeValue: number }>();
  const priced = new Map<string, number>();
  for (const row of data.rows) {
    if (row.fuel === "rooftop" || !inScope(row.region, region)) continue;
    const price = priceAt.get(`${row.region}|${row.at}`);
    if (price == null) continue;
    priced.set(`${row.region}|${row.at}`, price);
    const slot = byTime.get(row.at) ?? { discharge: 0, dischargeValue: 0, charge: 0, chargeValue: 0 };
    if (row.fuel === "discharging") {
      slot.discharge += row.mw;
      slot.dischargeValue += row.mw * price;
    } else {
      slot.charge += row.mw;
      slot.chargeValue += row.mw * price;
    }
    byTime.set(row.at, slot);
  }
  let discharge = 0;
  let dischargeValue = 0;
  let charge = 0;
  let chargeValue = 0;
  let peakDischarge: BatteryPeak | null = null;
  let peakCharge: BatteryPeak | null = null;
  for (const [at, slot] of byTime) {
    discharge += slot.discharge;
    dischargeValue += slot.dischargeValue;
    charge += slot.charge;
    chargeValue += slot.chargeValue;
    if (slot.discharge > 0 && (!peakDischarge || slot.discharge > peakDischarge.mw)) peakDischarge = { at, mw: slot.discharge, price: slot.dischargeValue / slot.discharge };
    if (slot.charge > 0 && (!peakCharge || slot.charge > peakCharge.mw)) peakCharge = { at, mw: slot.charge, price: slot.chargeValue / slot.charge };
  }
  const spot = [...priced.values()];
  const soldAt = discharge > 0 ? dischargeValue / discharge : null;
  const boughtAt = charge > 0 ? chargeValue / charge : null;
  const intervalHours = data.interval === "5m" ? 5 / 60 : data.interval === "1h" ? 1 : 24;
  return {
    soldAt,
    boughtAt,
    spread: soldAt != null && boughtAt != null ? soldAt - boughtAt : null,
    averagePrice: spot.length ? spot.reduce((sum, price) => sum + price, 0) / spot.length : null,
    dischargedMwh: discharge * intervalHours,
    chargedMwh: charge * intervalHours,
    peakDischarge,
    peakCharge,
    intervals: byTime.size,
  };
}

/** Spot price weighted by one fuel's MW (rooftop: what its output was worth), each region at its own price. */
export function priceWeighted(data: OeData, prices: readonly PricePoint[], region: string, fuel: OeFuel): number | null {
  const priceAt = new Map<string, number>();
  for (const point of prices) if (point.actual && inScope(point.region, region)) priceAt.set(`${point.region}|${point.at}`, point.price);
  let weighted = 0;
  let total = 0;
  for (const row of data.rows) {
    if (row.fuel !== fuel || !inScope(row.region, region) || !(row.mw > 0)) continue;
    const price = priceAt.get(`${row.region}|${row.at}`);
    if (price == null) continue;
    weighted += row.mw * price;
    total += row.mw;
  }
  return total > 0 ? weighted / total : null;
}
