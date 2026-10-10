import { chartSeriesProvider, type ChartSeriesCatalogItem } from "gloomberb/capabilities";
import { loadRbaTable } from "../rba/client";
import { RBA_SERIES, findRbaSeries } from "../rba/model";
import { resolvedSeries } from "./series";

export const AU_CHART_CAPABILITY_ID = "au-markets";

export interface ChartSource {
  catalog(): ChartSeriesCatalogItem[];
  /** Null when the id is not this source's. */
  resolve(seriesId: string, signal?: AbortSignal): Promise<ReturnType<typeof resolvedSeries>> | null;
}

const rbaSource: ChartSource = {
  catalog: () => RBA_SERIES.map((def) => ({
    seriesId: `rba:${def.id}`,
    label: def.label,
    description: `RBA ${def.table.toUpperCase()} ${def.id}`,
    detail: def.group,
    style: "line",
  })),
  resolve(seriesId, signal) {
    if (!seriesId.startsWith("rba:")) return null;
    const def = findRbaSeries(seriesId.slice(4));
    if (!def) return Promise.reject(new Error(`Unknown RBA series ${seriesId}`));
    return loadRbaTable(def.table, { signal }).then(({ data: table }) => {
      const series = table.get(def.id);
      if (!series || series.points.length === 0) throw new Error(`${def.label} has no observations`);
      return resolvedSeries({
        id: `${AU_CHART_CAPABILITY_ID}:${seriesId}`,
        label: def.label,
        unit: def.kind === "rate" ? "%" : def.kind === "index" ? "index" : def.label.slice(4),
        unitGroup: def.kind === "rate" ? "au-rate-percent" : `au-${def.id.toLowerCase()}`,
        frequency: "daily",
        points: series.points,
      });
    });
  },
};

const sources: ChartSource[] = [rbaSource];

/** Adds a source (ABS, NEM) without this module importing it. */
export function registerChartSource(source: ChartSource): void {
  if (!sources.includes(source)) sources.push(source);
}

/** Every word of the query, in any order ("sa wind", "battery victoria"). */
export function matchesQuery(item: ChartSeriesCatalogItem, needle: string): boolean {
  const haystack = `${item.seriesId} ${item.label} ${item.description ?? ""} ${item.detail ?? ""}`.toLowerCase();
  return needle.split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

/** RBA (and ABS, NEM) series in Gloomberb's chart catalogue and custom charts. */
export function createAuChartSeriesCapability() {
  return chartSeriesProvider({
    id: AU_CHART_CAPABILITY_ID,
    name: "Australian statistics",
    provider: {
      catalog: ({ limit }) => sources.flatMap((source) => source.catalog()).slice(0, limit ?? 32),
      search: ({ query, limit }) => {
        const needle = query?.trim().toLowerCase() ?? "";
        const all = sources.flatMap((source) => source.catalog());
        return (needle ? all.filter((item) => matchesQuery(item, needle)) : all).slice(0, limit ?? 32);
      },
      resolve: async ({ seriesId, signal }) => {
        for (const source of sources) {
          const result = source.resolve(seriesId, signal);
          if (result) return result;
        }
        throw new Error(`Unknown Australian series ${seriesId}`);
      },
    },
  });
}
