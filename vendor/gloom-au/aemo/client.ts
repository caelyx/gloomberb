import { createThrottledFetch } from "gloomberb/utils";
import { CACHE_POLICY } from "../shared/cache-policy";
import { createDiskCache, expectArray, expectNumber, expectString, type DiskCodec } from "../shared/disk-cache";
import { USER_AGENT, createMemoryCache } from "../shared/http";
import { fuelById, fuelReport, parseFuel, type FuelReport, type FuelReportData } from "./fuel";
import { parseCumulativePrice, parseFiveMinute, parseNemSummary, type NemSummary, type PricePoint } from "./model";
import {
  historyQuery,
  openElectricityError,
  openElectricityRefusal,
  openElectricityUrl,
  parseOpenElectricity,
  queryKey,
  recentQuery,
  type OeData,
  type OeFuel,
  type OeHistoryRange,
  type OeQuery,
  type OeRefusal,
} from "./openelectricity";

const API = "https://visualisations.aemo.com.au/aemo/apps/api/report";
// AEMO's dashboard API leaves a request without an Accept header hanging.
const client = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 1,
  timeoutMs: 20_000,
  defaultHeaders: { "User-Agent": USER_AGENT, Accept: "application/json, text/plain, */*" },
});
/** Dispatch runs every five minutes. */
const cache = createMemoryCache<{ summary: NemSummary; prices: PricePoint[] }>(60_000, 1);

/**
 * Loaders take no abort signal: their requests are shared by every caller
 * (the memory and disk caches, and the client's own GET dedupe), so one
 * caller's abort (a chart closing) would fail the rest, and a caller's
 * signal would replace the client's timeout. A request no one waits for
 * still lands in the cache.
 */
export interface LoadOptions {
  force?: boolean;
}

export function loadNem(options: LoadOptions = {}) {
  return cache.load("nem", async () => {
    const [summaryResponse, pricesResponse] = await Promise.all([
      client.fetch(`${API}/ELEC_NEM_SUMMARY`),
      client.fetch(`${API}/5MIN`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeScale: ["30MIN"] }),
      }),
    ]);
    if (!summaryResponse.ok) throw new Error(`AEMO request failed (${summaryResponse.status})`);
    const summary = parseNemSummary(await summaryResponse.json());
    // The 24-hour history is optional; the current prices stand without it.
    const prices = pricesResponse.ok ? parseFiveMinute(await pricesResponse.json().catch(() => ({ "5MIN": [] }))) : [];
    return { summary, prices };
  }, options.force);
}

/** Chart histories: seven days of prices, or 48 hours of 5-minute dispatch with demand. */
const historyCache = createMemoryCache<PricePoint[]>(60_000, 2);

export type NemHistory = "prices-7d" | "dispatch-48h";

export function loadNemHistory(kind: NemHistory, options: LoadOptions = {}) {
  return historyCache.load(kind, async () => {
    const response = kind === "prices-7d"
      ? await client.fetch(`${API}/NEM_DASHBOARD_CUMUL_PRICE`)
      : await client.fetch(`${API}/5MIN`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeScale: ["5MIN"] }),
        });
    if (!response.ok) throw new Error(`AEMO request failed (${response.status})`);
    const payload = await response.json();
    return kind === "prices-7d" ? parseCumulativePrice(payload) : parseFiveMinute(payload);
  }, options.force);
}

async function fetchFuel(report: FuelReport): Promise<FuelReportData> {
  const response = await client.fetch(`${API}/FUEL`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: [report] }),
  });
  if (!response.ok) throw new Error(`AEMO generation mix request failed (${response.status})`);
  return parseFuel(await response.json(), report);
}

/** The latest dispatch interval's generation by region and fuel; moves every five minutes, so memory only. */
const currentFuelCache = createMemoryCache<FuelReportData>(60_000, 1);

export function loadFuelCurrent(options: LoadOptions = {}) {
  return currentFuelCache.load("current", () => fetchFuel("CURRENT"), options.force);
}

type StoredFuel = [ats: number[], regions: string[], fuels: string[], values: number[]];

/** Columns by AEMO's fuel name, so a fuel added later decodes to the same label. */
export const fuelReportCodec: DiskCodec<FuelReportData, StoredFuel> = {
  encode: (data) => [
    data.rows.map((row) => row.at),
    data.rows.map((row) => row.region),
    data.rows.map((row) => fuelById(row.fuel)?.source ?? data.fuels.find((fuel) => fuel.id === row.fuel)?.source ?? row.fuel),
    data.rows.map((row) => row.value),
  ],
  decode: (stored) => {
    const [ats, regions, fuels, values] = expectArray(stored, "generation mix").map((column) => expectArray(column, "generation mix column"));
    if (!ats || !regions || !fuels || !values || new Set([ats.length, regions.length, fuels.length, values.length]).size !== 1) {
      throw new Error("Cached generation mix columns differ in length");
    }
    return fuelReport(ats.map((at, index) => ({
      at: expectNumber(at, "generation mix time"),
      region: expectString(regions[index], "generation mix region"),
      source: expectString(fuels[index], "generation mix fuel"),
      value: expectNumber(values[index], "generation mix value"),
    })));
  },
};

/** Hourly (48H), daily (3M) and weekly (12M) history; on disk, see CACHE_POLICY.nemFuelHistory. */
const fuelHistoryCache = createDiskCache(CACHE_POLICY.nemFuelHistory, fuelReportCodec);

export function loadFuelHistory(report: Exclude<FuelReport, "CURRENT">, options: LoadOptions = {}) {
  return fuelHistoryCache.load(report, () => fetchFuel(report), options);
}

export function cachedFuelHistory(report: Exclude<FuelReport, "CURRENT">) {
  return fuelHistoryCache.peek(report);
}

// --- OpenElectricity (only with an API key) ----------------------------------------

/** No retries: a request costs credits whether it succeeds or not. */
const oeClient = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 0,
  timeoutMs: 30_000,
  defaultHeaders: { "User-Agent": USER_AGENT, Accept: "application/json" },
});

let oeKey: string | null = null;

/** The key from the plugin's settings; `setupOpenElectricity` and the NEM pane keep it current for the chart series. */
export function setOpenElectricityKey(key: string | null | undefined): void {
  oeKey = typeof key === "string" && key.trim() ? key.trim() : null;
}

export function openElectricityKey(): string | null {
  return oeKey;
}

/** The setting as it is saved in the app config, for `gloomberb fn`, which runs no `setup()` with config. */
export function openElectricityKeyFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The last refusal that would only repeat (a credit each time), for the key it was given to; see `openElectricityRefusal`. */
let refusal: (OeRefusal & { key: string }) | null = null;

/** For tests: forget a remembered refusal. */
export function resetOpenElectricityRefusal(): void {
  refusal = null;
}

async function fetchOpenElectricity(key: string, query: OeQuery): Promise<OeData> {
  if (refusal && refusal.key === key && Date.now() < refusal.until) throw new Error(refusal.message);
  const response = await oeClient.fetch(openElectricityUrl(query), { headers: { Authorization: `Bearer ${key}` } });
  // 404 is the API's "no data in this window".
  if (response.status === 404) return { interval: query.interval, rows: [] };
  if (!response.ok) {
    const refused = openElectricityRefusal(response.status, response.headers.get("retry-after"), Date.now());
    if (refused) refusal = { ...refused, key };
    throw new Error(refused?.message ?? openElectricityError(response.status));
  }
  if (refusal?.key === key) refusal = null;
  return parseOpenElectricity(await response.json().catch(() => null));
}

const OE_FUELS: readonly OeFuel[] = ["rooftop", "charging", "discharging"];
type StoredOe = [interval: string, ats: number[], regions: string[], fuels: string[], mws: number[]];

export const openElectricityCodec: DiskCodec<OeData, StoredOe> = {
  encode: (data) => [data.interval, data.rows.map((row) => row.at), data.rows.map((row) => row.region), data.rows.map((row) => row.fuel), data.rows.map((row) => row.mw)],
  decode: (stored) => {
    const [interval, ...columns] = expectArray(stored, "OpenElectricity data");
    const [ats, regions, fuels, mws] = columns.map((column) => expectArray(column, "OpenElectricity column"));
    if (interval !== "5m" && interval !== "1h" && interval !== "1d") throw new Error("Cached OpenElectricity interval not recognised");
    if (!ats || !regions || !fuels || !mws || new Set([ats.length, regions.length, fuels.length, mws.length]).size !== 1) {
      throw new Error("Cached OpenElectricity columns differ in length");
    }
    return {
      interval,
      rows: ats.map((at, index) => {
        const fuel = expectString(fuels[index], "OpenElectricity fuel") as OeFuel;
        if (!OE_FUELS.includes(fuel)) throw new Error("Cached OpenElectricity fuel not recognised");
        return { at: expectNumber(at, "OpenElectricity time"), region: expectString(regions[index], "OpenElectricity region"), fuel, mw: expectNumber(mws[index], "OpenElectricity MW") };
      }),
    };
  },
};

const oeRecentCache = createDiskCache(CACHE_POLICY.openElectricityRecent, openElectricityCodec);
const oeHistoryCache = createDiskCache(CACHE_POLICY.openElectricityHistory, openElectricityCodec);

/** Every region's rooftop solar and battery charging and discharging over the last 24 hours, 5-minute. */
export function loadOpenElectricityRecent(key: string, options: LoadOptions = {}) {
  return oeRecentCache.load("recent", () => fetchOpenElectricity(key, recentQuery(Date.now())), options);
}

export function cachedOpenElectricityRecent() {
  return oeRecentCache.peek("recent");
}

/** The same for AEMO's history window (`times` from its report); null when the window is empty. */
export function loadOpenElectricityHistory(key: string, range: OeHistoryRange, times: readonly number[], options: LoadOptions = {}) {
  const query = historyQuery(range, times);
  if (!query) return Promise.resolve(null);
  return oeHistoryCache.load(queryKey(query), () => fetchOpenElectricity(key, query), options);
}

export function cachedOpenElectricityHistory(range: OeHistoryRange, times: readonly number[]) {
  const query = historyQuery(range, times);
  return query ? oeHistoryCache.peek(queryKey(query)) : null;
}
