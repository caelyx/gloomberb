import { cumulativeReturn } from "../shared/chart-range";
import type { DatedPoint } from "../shared/series";

/** The headline ASX indices and the A-VIX, by the symbols Gloomberb quotes them under. */
export const ASX_INDICES = [
  { symbol: "^AXJO", label: "S&P/ASX 200" },
  { symbol: "^AORD", label: "All Ordinaries" },
  { symbol: "^AXKO", label: "S&P/ASX 300" },
  { symbol: "^AXVI", label: "S&P/ASX 200 VIX" },
] as const;

export const BENCHMARK = "^AXJO";

/** The 11 S&P/ASX 200 GICS sector indices. */
export const ASX_SECTORS = [
  { symbol: "^AXEJ", label: "Energy" },
  { symbol: "^AXMJ", label: "Materials" },
  { symbol: "^AXNJ", label: "Industrials" },
  { symbol: "^AXDJ", label: "Consumer Discretionary" },
  { symbol: "^AXSJ", label: "Consumer Staples" },
  { symbol: "^AXHJ", label: "Health Care" },
  { symbol: "^AXFJ", label: "Financials" },
  { symbol: "^AXIJ", label: "Information Technology" },
  { symbol: "^AXTJ", label: "Communication Services" },
  { symbol: "^AXUJ", label: "Utilities" },
  { symbol: "^AXPJ", label: "A-REIT" },
] as const;

export interface Close {
  /** ISO date. */
  date: string;
  close: number;
}

/** Sessions in the 1Y return, and the sector chart's span. */
export const YEAR_SESSIONS = 252;

export interface Returns {
  week: number | null;
  month: number | null;
  quarter: number | null;
  ytd: number | null;
  year: number | null;
}

/** Percent returns over 5, 21, 63 and 252 sessions, and since the last close of the previous year. */
export function returns(closes: readonly Close[]): Returns {
  const last = closes.at(-1);
  if (!last) return { week: null, month: null, quarter: null, ytd: null, year: null };
  const back = (sessions: number) => {
    const then = closes[closes.length - 1 - sessions];
    return then && then.close > 0 ? (last.close / then.close - 1) * 100 : null;
  };
  const year = last.date.slice(0, 4);
  const lastOfPreviousYear = [...closes].reverse().find((point) => point.date.slice(0, 4) < year);
  return {
    week: back(5),
    month: back(21),
    quarter: back(63),
    ytd: lastOfPreviousYear && lastOfPreviousYear.close > 0 ? (last.close / lastOfPreviousYear.close - 1) * 100 : null,
    year: back(YEAR_SESSIONS),
  };
}

/**
 * Two indices as percent change from the first date both have, so a sector and
 * the ASX 200 start level on one chart. When one has no history the other is
 * rebased on its own, and the missing one comes back empty.
 */
export function sinceCommonStart(a: readonly Close[], b: readonly Close[], sessions?: number): [DatedPoint[], DatedPoint[]] {
  // With `sessions`, the lines start that many of `a`'s sessions back, so the end value is the table's return over them.
  const windowStart = sessions != null ? a[Math.max(0, a.length - 1 - sessions)]?.date : undefined;
  const start = [a[0]?.date, b[0]?.date, windowStart].filter((date): date is string => !!date).sort().at(-1);
  if (!start) return [[], []];
  const line = (closes: readonly Close[]) => cumulativeReturn(closes
    .filter((point) => point.date >= start)
    .map((point) => ({ date: point.date, value: point.close })));
  return [line(a), line(b)];
}

export type Quadrant = "Leading" | "Weakening" | "Lagging" | "Improving";

export interface Rotation {
  /** Relative strength against the benchmark, normalised so 100 is its recent average. */
  ratio: number;
  /** The ratio's rate of change, normalised so 100 is flat. */
  momentum: number;
  quadrant: Quadrant;
}

/**
 * A simplified relative rotation: relative strength (sector ÷ benchmark) over
 * its own 50-session average, and that ratio's change over 10 sessions. The
 * quadrants read as on a relative rotation graph. Not the proprietary JdK
 * formula, which is unpublished.
 */
export function rotation(sector: readonly Close[], benchmark: readonly Close[], window = 50, lag = 10): Rotation | null {
  const benchmarkByDate = new Map(benchmark.map((point) => [point.date, point.close]));
  const relative = sector.flatMap((point) => {
    const base = benchmarkByDate.get(point.date);
    return base && base > 0 ? [point.close / base] : [];
  });
  if (relative.length < window + lag) return null;
  const ratioAt = (end: number) => {
    const slice = relative.slice(end - window, end);
    const mean = slice.reduce((total, value) => total + value, 0) / slice.length;
    return (relative[end - 1]! / mean) * 100;
  };
  const ratio = ratioAt(relative.length);
  const previous = ratioAt(relative.length - lag);
  const momentum = (ratio / previous) * 100;
  const quadrant: Quadrant = ratio >= 100
    ? (momentum >= 100 ? "Leading" : "Weakening")
    : (momentum >= 100 ? "Improving" : "Lagging");
  return { ratio, momentum, quadrant };
}

export interface Mover {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  marketCap: number | null;
}

/** Gainers and losers, largest moves first, ignoring unchanged and unquoted lines. */
export function splitMovers(movers: readonly Mover[], count = 10): { gainers: Mover[]; losers: Mover[] } {
  const moved = movers.filter((mover) => Number.isFinite(mover.changePercent) && mover.changePercent !== 0);
  return {
    gainers: moved.filter((mover) => mover.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, count),
    losers: moved.filter((mover) => mover.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, count),
  };
}
