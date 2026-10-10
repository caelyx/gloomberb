import { scalarPoint, staticSeries } from "gloomberb/components";
import type { ResolvedSeries, SeriesPeriod, SeriesStyle } from "gloomberb/time-series";
import { colors } from "gloomberb/theme";

/** One observation of an official statistic. */
export interface DatedPoint {
  /** ISO date. */
  date: string;
  value: number;
}

/** The common shape the chart capability resolves to. */
export function resolvedSeries(options: {
  id: string;
  label: string;
  unit: string;
  unitGroup: string;
  frequency: SeriesPeriod;
  points: readonly DatedPoint[];
  warning?: string;
}): ResolvedSeries {
  return {
    id: options.id,
    label: options.label,
    color: colors.textBright,
    unit: options.unit,
    unitGroup: options.unitGroup,
    nativeFrequency: options.frequency,
    dataShape: "scalar",
    style: "line",
    transform: "raw",
    axis: "left",
    panelId: "main",
    interpolation: "none",
    ...(options.warning ? { warning: options.warning } : {}),
    points: options.points.map((point) => {
      const date = new Date(`${point.date}T00:00:00Z`);
      return { date, observedAt: date, value: point.value };
    }),
  };
}

/**
 * An intraday series for the chart capability: points at exact instants,
 * with the time axis and cursor read on `timeZone`'s clock.
 */
export function intervalSeries(options: {
  id: string;
  label: string;
  unit: string;
  unitGroup: string;
  timeZone: string;
  cadenceMs: number;
  points: ReadonlyArray<{ at: number; value: number }>;
  warning?: string;
}): ResolvedSeries {
  return {
    ...resolvedSeries({ ...options, frequency: "auto", points: [] }),
    timeBasis: { kind: "market", timeZone: options.timeZone, cadenceMs: options.cadenceMs },
    points: options.points.map((point) => {
      const date = new Date(point.at);
      return { date, observedAt: date, value: point.value };
    }),
  };
}

/**
 * A dated series for a pane's own chart, spaced by calendar so monthly,
 * quarterly and business-day data read on a true time axis.
 */
export function paneSeries(points: ReadonlyArray<{ date: string; value: number | null }>, options: {
  id: string;
  label: string;
  color: string;
  style?: SeriesStyle;
  negativeColor?: string;
}): ResolvedSeries {
  return staticSeries(points.map((point) => scalarPoint(new Date(`${point.date}T00:00:00Z`), point.value)), {
    ...options,
    calendarSpaced: true,
  });
}
