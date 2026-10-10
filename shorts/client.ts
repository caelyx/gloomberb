import { createThrottledFetch } from "gloomberb/utils";
import { cachedAsxDirectory, loadAsxDirectory } from "../directory/client";
import { CACHE_POLICY } from "../shared/cache-policy";
import { createDiskCache, expectArray, expectNumber, expectString, type CacheMeta, type DiskCodec } from "../shared/disk-cache";
import { USER_AGENT } from "../shared/http";
import {
  ASIC_SHORTS_BASE,
  parseReportIndex,
  parseShortCsv,
  selectHistoryFiles,
  type ReportFile,
  type ShortDay,
  type ShortRow,
  type ShortWindow,
} from "./model";

/** Static files on ASIC's download host: a brisker pace than the shared client is still polite. */
const asic = createThrottledFetch({ requestsPerMinute: 120, maxRetries: 2, timeoutMs: 20_000, defaultHeaders: { "User-Agent": USER_AGENT } });

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await asic.fetch(url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`ASIC request failed (${response.status})`);
  return response.text();
}

type StoredRow = [code: string, product: string, shortPositions: number, onIssue: number, percent: number];

export const shortDayCodec: DiskCodec<ShortDay, { date: string; rows: StoredRow[] }> = {
  encode: (day) => ({ date: day.date, rows: day.rows.map((row) => [row.code, row.product, row.shortPositions, row.onIssue, row.percent]) }),
  decode: (stored) => ({
    date: expectString(stored?.date, "ASIC report date"),
    rows: expectArray(stored.rows, "ASIC rows").map((entry): ShortRow => {
      const [code, product, shortPositions, onIssue, percent] = expectArray(entry, "ASIC row");
      return {
        code: expectString(code, "ASIC code"),
        product: expectString(product, "ASIC product"),
        shortPositions: expectNumber(shortPositions, "short positions"),
        onIssue: expectNumber(onIssue, "on issue"),
        percent: expectNumber(percent, "short percent"),
      };
    }),
  }),
};

export const reportIndexCodec: DiskCodec<ReportFile[], Array<[date: string, url: string]>> = {
  encode: (files) => files.map((file) => [file.date, file.url]),
  decode: (stored) => expectArray(stored, "ASIC index").map((entry) => {
    const [date, url] = expectArray(entry, "ASIC index entry");
    return { date: expectString(date, "ASIC index date"), url: expectString(url, "ASIC index url") };
  }),
};

/** Which days exist; refreshed hourly. */
const indexCache = createDiskCache(CACHE_POLICY.asicIndex, reportIndexCodec);
/** A published day never changes, so it is kept on disk for a year. */
const dayCache = createDiskCache(CACHE_POLICY.asicDay, shortDayCodec);

export function loadReportIndex(options: { force?: boolean; signal?: AbortSignal } = {}) {
  return indexCache.load("index", async (signal) => (
    parseReportIndex(JSON.parse(await fetchText(`${ASIC_SHORTS_BASE}/short-selling-data.json`, signal)))
  ), options);
}

export async function loadShortDay(file: ReportFile, signal?: AbortSignal): Promise<ShortDay> {
  return (await dayCache.load(file.date, async (shared) => parseShortCsv(await fetchText(file.url, shared), file.date), { signal })).data;
}

/** Up to `limit` loads at once, in order. */
async function mapLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface LatestShorts {
  latest: ShortDay;
  /** About a week earlier, for the change column; null when unavailable. */
  weekAgo: ShortDay | null;
  /** Full company names from the ASX directory; ASIC truncates its product names. */
  names: Map<string, string>;
  /** When ASIC's list of reports was last read; a published day itself never changes. */
  meta: CacheMeta;
}

function companyNames(directory: readonly { code: string; name: string }[]): Map<string, string> {
  return new Map(directory.map((company) => [company.code, company.name]));
}

/**
 * The newest report and the one five published days before it. A day listed
 * in the index but not yet downloadable falls back to the day before.
 */
export async function loadLatestShorts(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<LatestShorts> {
  const { data: index, ...meta } = await loadReportIndex(options);
  let latest: ShortDay | null = null;
  let latestAt = 0;
  let lastError: unknown = null;
  for (; latestAt < Math.min(3, index.length); latestAt += 1) {
    try {
      latest = await loadShortDay(index[latestAt]!, options.signal);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!latest) throw lastError ?? new Error("ASIC short position reports could not be loaded");
  const previous = index[latestAt + 5];
  const [weekAgo, directory] = await Promise.all([
    previous ? loadShortDay(previous, options.signal).catch(() => null) : Promise.resolve(null),
    loadAsxDirectory({ signal: options.signal }).catch(() => []),
  ]);
  return { latest, weekAgo, names: companyNames(directory), meta };
}

/** The newest report on disk and its week-ago partner, for a pane's first paint. */
export function cachedLatestShorts(): LatestShorts | null {
  const index = indexCache.peek("index");
  if (!index) return null;
  const at = index.data.findIndex((file) => dayCache.peek(file.date));
  if (at < 0 || at >= 3) return null;
  const previous = index.data[at + 5];
  return {
    latest: dayCache.peek(index.data[at]!.date)!.data,
    weekAgo: previous ? dayCache.peek(previous.date)?.data ?? null : null,
    names: companyNames(cachedAsxDirectory() ?? []),
    meta: index,
  };
}

export interface ShortHistory {
  days: ShortDay[];
  meta: CacheMeta;
}

/** Every day a window needs; a day that fails to load is left out rather than failing the history. */
export async function loadShortHistory(window: ShortWindow, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ShortHistory> {
  const { data: index, ...meta } = await loadReportIndex(options);
  const files = selectHistoryFiles(index, window);
  const days = await mapLimited(files, 6, (file) => loadShortDay(file, options.signal).catch(() => null));
  const loaded = days.filter((day): day is ShortDay => day !== null);
  if (loaded.length === 0 && files.length > 0) throw new Error("ASIC short position reports could not be loaded");
  return { days: loaded, meta };
}

/** A window's days on disk, for a first paint; null unless the index and every day are there. */
export function cachedShortHistory(window: ShortWindow): ShortHistory | null {
  const index = indexCache.peek("index");
  if (!index) return null;
  const days = selectHistoryFiles(index.data, window).map((file) => dayCache.peek(file.date)?.data ?? null);
  if (days.length === 0 || days.some((day) => !day)) return null;
  return { days: days as ShortDay[], meta: index };
}
