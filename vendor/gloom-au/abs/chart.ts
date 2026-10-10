import type { ChartSource } from "../shared/chart-series";
import { AU_CHART_CAPABILITY_ID } from "../shared/chart-series";
import { resolvedSeries } from "../shared/series";
import { loadAbsSeries } from "./client";
import { ABS_SERIES, findAbsSeries } from "./model";
import { chartPoints } from "./view";

/** ABS indicators as `abs:<id>` chart series. */
export const absChartSource: ChartSource = {
  catalog: () => ABS_SERIES.map((def) => ({
    seriesId: `abs:${def.id}`,
    label: def.label,
    description: `ABS ${def.flow.split(",")[1]} ${def.key}`,
    detail: def.group,
    style: "line",
  })),
  resolve(seriesId, signal) {
    if (!seriesId.startsWith("abs:")) return null;
    const def = findAbsSeries(seriesId.slice(4));
    if (!def) return Promise.reject(new Error(`Unknown ABS series ${seriesId}`));
    return loadAbsSeries(def, { signal }).then(({ data: points }) => resolvedSeries({
      id: `${AU_CHART_CAPABILITY_ID}:${seriesId}`,
      label: def.label,
      unit: def.unit === "%" ? "%" : "thousand",
      unitGroup: def.unit === "%" ? "au-stat-percent" : "au-stat-thousands",
      frequency: def.frequency,
      // Quarters at their last month, as the pane plots them.
      points: chartPoints(points),
    }));
  },
};
