import { CACHE_POLICY } from "../shared/cache-policy";
import { combineMeta, createDiskCache, expectArray, expectNumber, expectString, type CacheMeta, type DiskCodec } from "../shared/disk-cache";
import { fetchText } from "../shared/http";
import { ABS_SERIES, derive, parseReleaseCalendar, parseSdmxCsv, type AbsPoint, type AbsRelease, type AbsSeriesDef } from "./model";

const ABS_DATA = "https://data.api.abs.gov.au/rest/data";
const ABS_CALENDAR = "https://www.abs.gov.au/release-calendar/future-releases";

type StoredPoints = [dates: string[], values: number[], periods: string[]];

export const absSeriesCodec: DiskCodec<AbsPoint[], StoredPoints> = {
  encode: (points) => [points.map((point) => point.date), points.map((point) => point.value), points.map((point) => point.period)],
  decode: (stored) => {
    const [dates, values, periods] = expectArray(stored, "ABS series").map((column) => expectArray(column, "ABS series"));
    if (!dates || !values || !periods || dates.length !== values.length || dates.length !== periods.length) throw new Error("Cached ABS series columns differ");
    return dates.map((date, index) => ({
      date: expectString(date, "ABS date"),
      value: expectNumber(values[index], "ABS value"),
      period: expectString(periods[index], "ABS period"),
    }));
  },
};

type StoredRelease = [at: number, when: string, title: string];

export const absCalendarCodec: DiskCodec<AbsRelease[], StoredRelease[]> = {
  encode: (releases) => releases.map((release) => [release.at, release.when, release.title]),
  decode: (stored) => expectArray(stored, "ABS calendar").map((entry) => {
    const [at, when, title] = expectArray(entry, "ABS release");
    return { at: expectNumber(at, "ABS release time"), when: expectString(when, "ABS release stamp"), title: expectString(title, "ABS release title") };
  }),
};

/** Kept on disk; see CACHE_POLICY.absSeries and absCalendar. */
const seriesCache = createDiskCache(CACHE_POLICY.absSeries, absSeriesCodec);
const calendarCache = createDiskCache(CACHE_POLICY.absCalendar, absCalendarCodec);

export function loadAbsSeries(def: AbsSeriesDef, options: { force?: boolean; signal?: AbortSignal } = {}) {
  return seriesCache.load(def.id, async (signal) => {
    const startYear = new Date().getUTCFullYear() - 15;
    const url = `${ABS_DATA}/${def.flow}/${def.key}?startPeriod=${startYear}&format=csv&detail=dataonly`;
    const points = derive(def, parseSdmxCsv(await fetchText(url, signal)));
    if (points.length === 0) throw new Error(`${def.label} has no observations`);
    return points;
  }, options);
}

export interface AbsIndicators {
  series: Map<string, AbsPoint[]>;
  errors: string[];
  /** Age of the oldest series shown, and any refresh that failed under a cached copy. */
  meta: CacheMeta | null;
}

/** Every indicator; one failing leaves the rest. */
export async function loadAbsIndicators(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<AbsIndicators> {
  const results = await Promise.all(ABS_SERIES.map(async (def) => {
    try {
      const result = await loadAbsSeries(def, options);
      return { def, points: result.data, meta: result as CacheMeta, error: null };
    } catch (error) {
      return { def, points: null, meta: null, error: `${def.label} unavailable: ${error instanceof Error ? error.message : String(error)}` };
    }
  }));
  const series = new Map(results.filter((result) => result.points).map((result) => [result.def.id, result.points!]));
  const errors = results.map((result) => result.error).filter((error): error is string => !!error);
  if (series.size === 0) throw new Error("ABS statistics are unavailable");
  return { series, errors, meta: combineMeta(results.map((result) => (result.meta ? { label: result.def.label, meta: result.meta } : null))) };
}

/** The indicators on disk, for a pane's first paint; null unless every series is there. */
export function cachedAbsIndicators(): AbsIndicators | null {
  const parts = ABS_SERIES.map((def) => ({ def, cached: seriesCache.peek(def.id) }));
  if (parts.some((part) => !part.cached)) return null;
  return {
    series: new Map(parts.map((part) => [part.def.id, part.cached!.data])),
    errors: [],
    meta: combineMeta(parts.map((part) => ({ label: part.def.label, meta: part.cached! }))),
  };
}

export function loadAbsReleases(options: { force?: boolean; signal?: AbortSignal } = {}) {
  return calendarCache.load("calendar", async (signal) => parseReleaseCalendar(await fetchText(ABS_CALENDAR, signal)), options);
}

export function cachedAbsReleases() {
  return calendarCache.peek("calendar");
}
