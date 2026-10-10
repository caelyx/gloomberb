import type { TimeRange } from "gloomberb/time-series";
import type { DatedPoint } from "./series";

/** The look-backs an in-pane statistics chart offers, in the host's range vocabulary. */
export type StatRange = Extract<TimeRange, "1Y" | "5Y" | "ALL">;

export const STAT_RANGES: ReadonlyArray<{ value: StatRange; label: string }> = [
  { value: "1Y", label: "1Y" },
  { value: "5Y", label: "5Y" },
  { value: "ALL", label: "All" },
];

export const DEFAULT_STAT_RANGE: StatRange = "5Y";

/** A persisted range read back safely; anything unknown falls back to the default. */
export function statRange(value: unknown): StatRange {
  return STAT_RANGES.some((option) => option.value === value) ? (value as StatRange) : DEFAULT_STAT_RANGE;
}

/** `years` calendar years before an ISO date (29 February falls back to the 28th). */
function yearsBefore(date: string, years: number): string {
  const [year, month, day] = date.split("-");
  const shifted = `${Number(year) - years}-${month}-${day}`;
  return month === "02" && day === "29" ? shifted.replace(/-29$/, "-28") : shifted;
}

/** The points within `range` of the latest one, oldest first as given. */
export function pointsInRange<T extends DatedPoint>(points: readonly T[], range: StatRange): T[] {
  const latest = points.at(-1);
  if (!latest || range === "ALL") return [...points];
  const from = yearsBefore(latest.date, range === "1Y" ? 1 : 5);
  return points.filter((point) => point.date >= from);
}

/** Percent change of each point from the first one, for comparing indices on one axis. */
export function cumulativeReturn(points: readonly DatedPoint[]): DatedPoint[] {
  const base = points.find((point) => point.value > 0)?.value;
  if (base == null) return [];
  return points.map((point) => ({ date: point.date, value: Math.round(((point.value / base) - 1) * 10_000) / 100 }));
}
