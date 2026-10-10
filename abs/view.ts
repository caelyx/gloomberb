import type { AbsIndicators } from "./client";
import { ABS_SERIES, type AbsPoint, type AbsSeriesDef } from "./model";

export interface IndicatorRow {
  id: string;
  label: string;
  group: AbsSeriesDef["group"];
  unit: AbsSeriesDef["unit"];
  latest: AbsPoint | null;
  previous: AbsPoint | null;
  yearAgo: AbsPoint | null;
}

export function indicatorRows(indicators: AbsIndicators): IndicatorRow[] {
  return ABS_SERIES.map((def) => {
    const points = indicators.series.get(def.id) ?? [];
    const latest = points.at(-1) ?? null;
    const lag = def.frequency === "quarterly" ? 4 : 12;
    return {
      id: def.id,
      label: def.label,
      group: def.group,
      unit: def.unit,
      latest,
      previous: points.at(-2) ?? null,
      yearAgo: points.length > lag ? points[points.length - 1 - lag]! : null,
    };
  });
}

export function formatIndicator(unit: AbsSeriesDef["unit"], point: AbsPoint | null): string {
  return point ? formatIndicatorValue(unit, point.value) : "—";
}

export function formatIndicatorValue(unit: AbsSeriesDef["unit"], value: number): string {
  return unit === "k" ? `${value > 0 ? "+" : ""}${value.toFixed(1)}k` : `${value.toFixed(1)}%`;
}

/** `2026-08` → `Aug 2026`; `2026-Q2` → `Jun Q 2026`. */
export function formatPeriod(period: string | undefined): string {
  if (!period) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = period.match(/^(\d{4})-(\d{2})$/);
  if (month) return `${months[Number(month[2]) - 1]} ${month[1]}`;
  const quarter = period.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) return `${months[Number(quarter[2]) * 3 - 1]} Q ${quarter[1]}`;
  return period;
}

/**
 * Points as the chart plots them: a quarter at its last month (`2026-Q2` on
 * 1 June), where the table's "Jun Q" puts it, rather than at the quarter's
 * first day; months as they are.
 */
export function chartPoints(points: readonly AbsPoint[]): AbsPoint[] {
  return points.map((point) => {
    const quarter = point.period.match(/^(\d{4})-Q([1-4])$/);
    return quarter ? { ...point, date: `${quarter[1]}-${String(Number(quarter[2]) * 3).padStart(2, "0")}-01` } : point;
  });
}
