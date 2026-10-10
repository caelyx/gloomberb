import { CACHE_POLICY } from "../shared/cache-policy";
import { combineMeta, createDiskCache, decodePoints, encodePoints, expectArray, expectString, type CacheMeta, type DiskCodec, type StoredPoints } from "../shared/disk-cache";
import { fetchText } from "../shared/http";
import { parseRbaTable, type RbaSeries, type RbaTableId } from "./model";

const RBA_TABLES = "https://www.rba.gov.au/statistics/tables/csv";

type StoredSeries = [id: string, title: string, units: string, points: StoredPoints];

export const rbaTableCodec: DiskCodec<Map<string, RbaSeries>, StoredSeries[]> = {
  encode: (table) => [...table.values()].map((series) => [series.id, series.title, series.units, encodePoints(series.points)]),
  decode: (stored) => new Map(expectArray(stored, "RBA table").map((entry) => {
    const [id, title, units, points] = expectArray(entry, "RBA series");
    const series: RbaSeries = { id: expectString(id, "RBA series id"), title: expectString(title, "RBA title"), units: expectString(units, "RBA units"), points: decodePoints(points, "RBA points") };
    return [series.id, series];
  })),
};

/** Kept on disk, so the pane opens with the last tables; see CACHE_POLICY.rbaTable. */
const cache = createDiskCache(CACHE_POLICY.rbaTable, rbaTableCodec);

export function loadRbaTable(table: RbaTableId, options: { force?: boolean; signal?: AbortSignal } = {}) {
  return cache.load(table, async (signal) => parseRbaTable(await fetchText(`${RBA_TABLES}/${table}-data.csv`, signal)), options);
}

/** One table on disk, without fetching. */
export function cachedRbaTable(table: RbaTableId) {
  return cache.peek(table);
}

const TABLE_SUBJECT: Record<RbaTableId, string> = {
  f1: "Cash rate and money-market rates",
  f2: "Government bond yields",
  "f11.1": "Exchange rates",
};

export interface RbaTables {
  f1: Map<string, RbaSeries>;
  f2: Map<string, RbaSeries>;
  fx: Map<string, RbaSeries>;
}

export interface RbaLoad {
  tables: RbaTables;
  errors: string[];
  /** Age of the oldest table shown, and any refresh that failed under a cached copy. */
  meta: CacheMeta | null;
}

const TABLE_IDS: readonly RbaTableId[] = ["f1", "f2", "f11.1"];

function assemble(parts: Array<{ value: Map<string, RbaSeries>; meta: CacheMeta | null; error: string | null }>): RbaLoad {
  const [f1, f2, fx] = parts as [typeof parts[number], typeof parts[number], typeof parts[number]];
  return {
    tables: { f1: f1.value, f2: f2.value, fx: fx.value },
    errors: parts.map((part) => part.error).filter((error): error is string => !!error),
    meta: combineMeta(parts.map((part, index) => (part.meta ? { label: TABLE_SUBJECT[TABLE_IDS[index]!], meta: part.meta } : null))),
  };
}

/** All three tables; F2 or F11.1 failing leaves the others in place. */
export async function loadRbaTables(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<RbaLoad> {
  const parts = await Promise.all(TABLE_IDS.map(async (table) => {
    try {
      const result = await loadRbaTable(table, options);
      return { value: result.data, meta: result as CacheMeta, error: null };
    } catch (error) {
      return { value: new Map<string, RbaSeries>(), meta: null, error: `${TABLE_SUBJECT[table]} unavailable: ${error instanceof Error ? error.message : String(error)}` };
    }
  }));
  if (parts.every((part) => part.error)) throw new Error("RBA statistical tables are unavailable");
  return assemble(parts);
}

/** The tables on disk, for a pane's first paint; null unless every table is there. */
export function cachedRbaTables(): RbaLoad | null {
  const parts = TABLE_IDS.map((table) => cache.peek(table));
  if (parts.some((part) => !part)) return null;
  return assemble(parts.map((part) => ({ value: part!.data, meta: part!, error: null })));
}
